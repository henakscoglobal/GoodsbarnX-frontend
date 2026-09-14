// ==========================================================================
// GoodsbarnX — depletor.js
// V1.8.2.6 — ALLOCATION & ROUTING RUNTIME
//
// V1.8.2.6.4 boundary compatibility:
// This runtime consumes the Auth Resolution Boundary established by auth.js.
//
// IMPORTANT:
// - Allocation runtime version remains V1.8.2.6.
// - Read-only.
// - No stock mutations.
// - No relationship mutations.
// - No inquiry mutations.
// - No cart mutations.
// - No order creation.
// - No depletion execution.
//
// V1.8.2.6.4 is an Auth Resolution Trace build, NOT an Allocation upgrade.
// ==========================================================================

(function () {

  "use strict";


  const VERSION =
    "V1.8.2.6";

  window.goodsbarnxDepletorAllocationVersion =
    VERSION;


  const state = {

    status: "NOT_EVALUATED",

    candidates: [],

    error: null,

    distributorId: null

  };


  window.goodsbarnxAllocationCandidates =
    [];


  const AUTH_WAIT_INTERVAL =
    250;

  const AUTH_WAIT_TIMEOUT =
    10000;


  // ------------------------------------------------------------------------
  // Utility
  // ------------------------------------------------------------------------

  function escapeHtml(value) {

    return String(value ?? "")
      .replace(/[&<>"']/g, function (character) {

        return {
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#039;"
        }[character];

      });

  }


  function tokens(value) {

    return String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter(function (token) {

        return token.length > 2;

      });

  }


  function productMatchesInquiry(
    inquiry,
    product
  ) {

    const inquiryTokens =
      tokens(inquiry.item);

    const productTokens =
      tokens(product.name);

    if (
      !inquiryTokens.length ||
      !productTokens.length
    ) {
      return false;
    }

    return inquiryTokens.some(function (token) {

      return productTokens.indexOf(token) >= 0;

    });
  }


  function getCurrentUser() {

    try {
      return currentUser || null;
    } catch (error) {
      return null;
    }

  }


  function isDistributor(user) {

    return !!(
      user &&
      String(user.role || "")
        .trim()
        .toLowerCase() === "distributor"
    );

  }


  // ------------------------------------------------------------------------
  // Auth boundary wait
  // ------------------------------------------------------------------------

  async function waitForDistributorContext() {

    const started =
      Date.now();

    while (
      Date.now() - started <
      AUTH_WAIT_TIMEOUT
    ) {

      const user =
        getCurrentUser();

      if (isDistributor(user)) {

        return user;

      }


      /*
       * Prefer the authoritative Auth Resolution Boundary.
       */

      if (
        typeof window.getGoodsbarnXAuthContext ===
        "function"
      ) {

        const context =
          window.getGoodsbarnXAuthContext();

        if (
          context &&
          context.status &&
          context.status !==
            "AUTH_INITIALIZING"
        ) {

          if (
            context.status !==
              "AUTHENTICATED_DISTRIBUTOR"
          ) {

            const error =
              new Error(
                context.error ||
                "Authenticated distributor context unavailable."
              );

            error.code =
              context.code ||
              "AUTH_CONTEXT_UNAVAILABLE";

            throw error;
          }

        }

      }


      await new Promise(function (resolve) {

        setTimeout(
          resolve,
          AUTH_WAIT_INTERVAL
        );

      });

    }


    const timeoutError =
      new Error(
        "Authenticated distributor context unavailable."
      );

    timeoutError.code =
      "AUTH_CONTEXT_TIMEOUT";

    throw timeoutError;
  }


  // ------------------------------------------------------------------------
  // Evidence reader
  // ------------------------------------------------------------------------

  async function readEvidence(user) {

    if (!isDistributor(user)) {

      const error =
        new Error(
          "Allocation runtime requires authenticated distributor context."
        );

      error.code =
        "AUTH_CONTEXT_UNAVAILABLE";

      throw error;
    }


    const distributorId =
      user.id;


    const results =
      await Promise.all([

        sb
          .from("products")
          .select(
            "id,name,price,stock_quantity,status,category"
          )
          .eq(
            "distributor_id",
            distributorId
          ),

        sb
          .from("inquiries")
          .select(
            "id,item,quantity,status,created_at,buyer_id,distributor_id,inquirer_id"
          )
          .eq(
            "distributor_id",
            distributorId
          ),

        sb
          .from("trade_relationships")
          .select(
            "id,buyer_id,distributor_id,status,is_primary,relationship_started_at,activated_at"
          )
          .eq(
            "distributor_id",
            distributorId
          ),

        sb
          .from("agent_distributor_attachments")
          .select(
            "id,agent_id,distributor_id,status,created_at"
          )
          .eq(
            "distributor_id",
            distributorId
          )

      ]);


    const productsResult =
      results[0];

    const inquiriesResult =
      results[1];

    const relationshipsResult =
      results[2];

    const attachmentsResult =
      results[3];


    if (productsResult.error) {
      throw productsResult.error;
    }

    if (inquiriesResult.error) {
      throw inquiriesResult.error;
    }

    if (relationshipsResult.error) {
      throw relationshipsResult.error;
    }

    if (attachmentsResult.error) {
      throw attachmentsResult.error;
    }


    return {

      products:
        productsResult.data || [],

      inquiries:
        inquiriesResult.data || [],

      relationships:
        relationshipsResult.data || [],

      attachments:
        attachmentsResult.data || []

    };

  }


  // ------------------------------------------------------------------------
  // Candidate construction
  // ------------------------------------------------------------------------

  function buildCandidates(evidence) {

    const products =
      evidence.products || [];

    const inquiries =
      evidence.inquiries || [];

    const relationships =
      evidence.relationships || [];

    const candidates = [];


    inquiries.forEach(function (inquiry) {

      const inquiryStatus =
        String(
          inquiry.status || ""
        ).toLowerCase();

      if (
        inquiryStatus &&
        ![
          "open",
          "pending",
          "new"
        ].includes(inquiryStatus)
      ) {
        return;
      }


      const requestedQuantity =
        Number(
          String(
            inquiry.quantity || ""
          ).trim()
        );


      if (
        !Number.isFinite(
          requestedQuantity
        ) ||
        requestedQuantity <= 0
      ) {
        return;
      }


      products.forEach(function (product) {

        const stock =
          Number(
            product.stock_quantity || 0
          );


        if (
          !productMatchesInquiry(
            inquiry,
            product
          )
        ) {
          return;
        }


        const buyerRelationship =
          inquiry.buyer_id
            ? relationships.find(
                function (relationship) {

                  return (
                    String(
                      relationship.buyer_id
                    ) ===
                      String(
                        inquiry.buyer_id
                      ) &&

                    String(
                      relationship.status || ""
                    ).toLowerCase() ===
                      "active" &&

                    relationship.is_primary !==
                      false
                  );

                }
              )
            : null;


        const allocatableQuantity =
          Math.min(
            stock,
            requestedQuantity
          );


        const relationshipReady =
          !!buyerRelationship;


        const directRoute =
          !!(
            inquiry.buyer_id &&
            buyerRelationship &&
            stock > 0 &&
            requestedQuantity > 0
          );


        let score = 0;


        score += 40;


        if (stock > 0) {
          score += 25;
        }


        if (requestedQuantity > 0) {
          score += 20;
        }


        if (
          stock >=
          requestedQuantity
        ) {
          score += 5;
        }


        const ageMs =
          Date.now() -
          new Date(
            inquiry.created_at ||
            Date.now()
          ).getTime();


        const ageHours =
          Math.max(
            0,
            ageMs / 3600000
          );


        if (ageHours <= 24) {
          score += 10;
        } else if (
          ageHours <= 168
        ) {
          score += 6;
        } else if (
          ageHours <= 720
        ) {
          score += 2;
        }


        score =
          Math.min(
            100,
            score
          );


        let tier =
          "MONITOR";


        if (
          directRoute &&
          score >= 75
        ) {

          tier =
            "ACT NOW";

        } else if (
          stock > 0 &&
          relationshipReady
        ) {

          tier =
            "READY";

        } else if (
          stock > 0
        ) {

          tier =
            "RELATIONSHIP GAP";

        } else {

          tier =
            "STOCK GAP";
        }


        candidates.push({

          inquiry_id:
            inquiry.id,

          product_id:
            product.id,

          buyer_id:
            inquiry.buyer_id ||
            null,

          relationship_id:
            buyerRelationship
              ? buyerRelationship.id
              : null,

          distributor_id:
            product.distributor_id ||
            null,

          requested_quantity:
            requestedQuantity,

          stock_quantity:
            stock,

          allocatable_quantity:
            allocatableQuantity,

          relationship_ready:
            relationshipReady,

          direct_route:
            directRoute,

          score:

            score,

          tier:
            tier,

          evidence: {

            product_match:
              true,

            stock_available:
              stock > 0,

            quantity_valid:
              requestedQuantity > 0,

            buyer_identified:
              !!inquiry.buyer_id,

            active_primary_relationship:
              !!buyerRelationship

          }

        });

      });

    });


    candidates.sort(function (a, b) {

      return (
        Number(b.score || 0) -
        Number(a.score || 0)
      );

    });


    return candidates;

  }


  // ------------------------------------------------------------------------
  // Candidate rendering
  // ------------------------------------------------------------------------

  function renderCandidates(
    candidates
  ) {

    const root =
      document.getElementById(
        "depletor-console"
      );

    if (!root) return;


    const container =
      document.getElementById(
        "depletor-opportunities"
      );

    if (!container) return;


    if (!candidates.length) {

      container.innerHTML =
        '<div class="depletor-empty">No evidence-backed allocation candidates.</div>';

      return;
    }


    container.innerHTML =
      candidates
        .map(function (candidate) {

          return `
            <div class="manifest">

              <div class="manifest-top">

                <div>

                  <div class="m-name">
                    ${escapeHtml(
                      candidate.tier
                    )}
                  </div>

                  <div class="m-loc">
                    Requested:
                    ${candidate.requested_quantity}
                    · Stock:
                    ${candidate.stock_quantity}
                    · Allocatable:
                    ${candidate.allocatable_quantity}
                  </div>

                </div>

                <span class="stamp-badge">
                  ${candidate.score}
                </span>

              </div>

            </div>
          `;

        })
        .join("");

  }


  // ------------------------------------------------------------------------
  // Allocation runtime
  // ------------------------------------------------------------------------

  window.refreshDepletorAllocation =
    async function () {

      state.status =
        "WAITING_FOR_AUTH";

      state.error =
        null;

      state.candidates =
        [];

      window.goodsbarnxAllocationCandidates =
        [];


      let user = null;


      /*
       * ---------------------------------------------------------------
       * AUTH BOUNDARY
       * ---------------------------------------------------------------
       */

      try {

        user =
          await waitForDistributorContext();

      } catch (error) {

        state.status =
          "AUTH_CONTEXT_UNAVAILABLE";

        state.error =
          error;

        state.candidates =
          [];

        window.goodsbarnxAllocationCandidates =
          [];

        renderCandidates([]);

        return [];

      }


      state.distributorId =
        user.id;


      /*
       * ---------------------------------------------------------------
       * LIVE EVIDENCE
       * ---------------------------------------------------------------
       */

      try {

        const evidence =
          await readEvidence(
            user
          );


        const candidates =
          buildCandidates(
            evidence
          );


        state.candidates =
          candidates;

        state.status =
          "EVALUATED";

        window.goodsbarnxAllocationCandidates =
          candidates;


        renderCandidates(
          candidates
        );


        return candidates;

      } catch (error) {

        state.status =
          "EVIDENCE_ERROR";

        state.error =
          error;

        state.candidates =
          [];

        window.goodsbarnxAllocationCandidates =
          [];

        renderCandidates([]);

        return [];

      }

    };


  // ------------------------------------------------------------------------
  // Runtime state
  // ------------------------------------------------------------------------

  window.goodsbarnxAllocationRuntimeState =
    state;


  // ------------------------------------------------------------------------
  // Startup
  // ------------------------------------------------------------------------

  window.addEventListener(
    "load",
    function () {

      setTimeout(
        function () {

          if (
            typeof window.refreshDepletorAllocation ===
            "function"
          ) {

            window.refreshDepletorAllocation();

          }

        },
        1000
      );

    }
  );


  console.log(
    "GoodsbarnX Allocation Runtime loaded — V1.8.2.6"
  );

})();
