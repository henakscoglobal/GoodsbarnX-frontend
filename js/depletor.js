// ==========================================================================
// GoodsbarnX — Master Stock Depletor
// V1.8.2.6.3
// AUTH CONTEXT INTEGRITY BOUNDARY
//
// Allocation & Routing Runtime
//
// This build does NOT change allocation logic.
// It consumes the authenticated distributor context established by auth.js.
//
// READ-ONLY:
// - No stock mutation
// - No inquiry mutation
// - No relationship mutation
// - No allocation persistence
// - No order creation
// - No buyer-behaviour events
// ==========================================================================

(function () {
  "use strict";

  const VERSION = "V1.8.2.6";

  window.goodsbarnxDepletorAllocationVersion = VERSION;


  // ------------------------------------------------------------------------
  // Runtime state
  // ------------------------------------------------------------------------

  const state = {
    status: "NOT_EVALUATED",
    candidates: [],
    error: null,
    distributorId: null
  };

  window.goodsbarnxAllocationCandidates = [];


  // ------------------------------------------------------------------------
  // Constants
  // ------------------------------------------------------------------------

  const AUTH_WAIT_INTERVAL = 250;
  const AUTH_WAIT_TIMEOUT = 10000;


  // ------------------------------------------------------------------------
  // Utility
  // ------------------------------------------------------------------------

  function esc(value) {
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


  function money(value) {
    const number = Number(value) || 0;

    return number > 0
      ? "₦" + number.toLocaleString("en-NG", {
          maximumFractionDigits: 0
        })
      : "—";
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


  function linked(inquiry, product) {

    const inquiryTokens = tokens(inquiry.item);
    const productTokens = tokens(product.name);

    if (!inquiryTokens.length || !productTokens.length) {
      return false;
    }

    return inquiryTokens.some(function (token) {
      return productTokens.indexOf(token) >= 0;
    }) &&
    productTokens.some(function (token) {
      return inquiryTokens.indexOf(token) >= 0;
    });
  }


  function ageHours(createdAt) {

    const timestamp =
      new Date(createdAt || Date.now()).getTime();

    if (!isFinite(timestamp)) {
      return 999999;
    }

    return Math.max(
      0,
      (Date.now() - timestamp) / 3600000
    );
  }


  function freshness(age) {

    if (age <= 24) {
      return "fresh";
    }

    if (age <= 168) {
      return "active";
    }

    return "aging";
  }


  function score(matches, stock, quantity, age) {

    let value = 0;

    if (matches) {
      value += 40;
    }

    if (stock > 0) {
      value += 25;
    }

    if (quantity > 0) {
      value += 20;

      if (stock >= quantity) {
        value += 5;
      }
    }

    if (age <= 24) {
      value += 10;
    } else if (age <= 168) {
      value += 6;
    } else if (age <= 720) {
      value += 2;
    }

    return Math.min(100, value);
  }


  function tier(scoreValue, stock, matches) {

    if (
      matches &&
      stock > 0 &&
      scoreValue >= 75
    ) {
      return "ACT NOW";
    }

    if (
      matches &&
      stock > 0
    ) {
      return "READY";
    }

    if (matches) {
      return "WATCH";
    }

    if (stock <= 0) {
      return "RESTOCK";
    }

    return "MONITOR";
  }


  function activeRelationship(
    inquiry,
    relationships
  ) {

    if (!inquiry.buyer_id) {
      return null;
    }

    return relationships.find(function (relationship) {

      return (
        relationship.buyer_id === inquiry.buyer_id &&
        relationship.is_primary !== false &&
        String(relationship.status || "").toLowerCase() === "active"
      );

    }) || null;
  }


  function blockReason(
    inquiry,
    product,
    relationship,
    requestedQuantity,
    availableQuantity,
    allocatableQuantity
  ) {

    if (!linked(inquiry, product)) {
      return "No product-demand match";
    }

    if (availableQuantity <= 0) {
      return "No available stock";
    }

    if (requestedQuantity <= 0) {
      return "Requested quantity unavailable";
    }

    if (!inquiry.buyer_id) {
      return "Buyer identity unavailable";
    }

    if (!relationship) {
      return "Canonical active relationship unavailable";
    }

    if (allocatableQuantity <= 0) {
      return "No allocatable quantity";
    }

    return null;
  }


  // ------------------------------------------------------------------------
  // Authentication boundary
  // ------------------------------------------------------------------------

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
      user.id &&
      String(user.role || "").toLowerCase() === "distributor"
    );
  }


  async function waitForDistributorContext() {

    const started = Date.now();

    while (Date.now() - started < AUTH_WAIT_TIMEOUT) {

      const user = getCurrentUser();

      if (isDistributor(user)) {
        return user;
      }

      await new Promise(function (resolve) {
        setTimeout(resolve, AUTH_WAIT_INTERVAL);
      });
    }

    const context =
      typeof window.getGoodsbarnXAuthContext === "function"
        ? window.getGoodsbarnXAuthContext()
        : null;

    const code =
      context && context.code
        ? context.code
        : "AUTH_CONTEXT_UNAVAILABLE";

    const error = new Error(
      "Authenticated distributor context unavailable."
    );

    error.code = code;

    throw error;
  }


  // ------------------------------------------------------------------------
  // Evidence reader
  // ------------------------------------------------------------------------

  async function readEvidence(user) {

    if (!isDistributor(user)) {

      const error = new Error(
        "Authenticated distributor context unavailable."
      );

      error.code = "AUTH_CONTEXT_UNAVAILABLE";

      throw error;
    }

    const distributorId = user.id;

    const results = await Promise.all([

      sb
        .from("products")
        .select(
          "id,name,price,stock_quantity,status,category"
        )
        .eq("distributor_id", distributorId),

      sb
        .from("inquiries")
        .select(
          "id,item,quantity,status,created_at,buyer_id,distributor_id,inquirer_id"
        )
        .eq("distributor_id", distributorId),

      sb
        .from("trade_relationships")
        .select(
          "id,buyer_id,distributor_id,status,is_primary"
        )
        .eq("distributor_id", distributorId),

      sb
        .from("agent_distributor_attachments")
        .select(
          "id,agent_id,status"
        )
        .eq("distributor_id", distributorId)
        .eq("status", "accepted")
    ]);

    const productResult = results[0];
    const inquiryResult = results[1];
    const relationshipResult = results[2];
    const agentResult = results[3];


    if (productResult.error) {
      throw productResult.error;
    }

    if (inquiryResult.error) {
      throw inquiryResult.error;
    }

    if (relationshipResult.error) {
      throw relationshipResult.error;
    }

    if (agentResult.error) {
      throw agentResult.error;
    }


    return {
      products: productResult.data || [],
      inquiries: inquiryResult.data || [],
      relationships: relationshipResult.data || [],
      agents: agentResult.data || [],
      distributorId
    };
  }


  // ------------------------------------------------------------------------
  // Candidate generation
  // ------------------------------------------------------------------------

  function buildCandidates(evidence) {

    const products = evidence.products || [];

    const inquiries = (evidence.inquiries || [])
      .filter(function (inquiry) {

        const status =
          String(inquiry.status || "").toLowerCase();

        return (
          status === "open" ||
          status === "pending"
        );
      });


    const relationships =
      evidence.relationships || [];


    const candidates = [];


    inquiries.forEach(function (inquiry) {

      products.forEach(function (product) {

        const matches =
          linked(inquiry, product);

        if (!matches) {
          return;
        }


        const availableQuantity =
          Number(product.stock_quantity) || 0;


        const requestedQuantity =
          Number(
            String(inquiry.quantity || "")
              .trim()
          ) || 0;


        const relationship =
          activeRelationship(
            inquiry,
            relationships
          );


        const allocatableQuantity =
          (
            matches &&
            availableQuantity > 0 &&
            requestedQuantity > 0 &&
            inquiry.buyer_id &&
            relationship
          )
            ? Math.min(
                availableQuantity,
                requestedQuantity
              )
            : 0;


        const age =
          ageHours(inquiry.created_at);


        const opportunityScore =
          score(
            matches,
            availableQuantity,
            requestedQuantity,
            age
          );


        const opportunityTier =
          tier(
            opportunityScore,
            availableQuantity,
            matches
          );


        const reason =
          blockReason(
            inquiry,
            product,
            relationship,
            requestedQuantity,
            availableQuantity,
            allocatableQuantity
          );


        const ready =
          allocatableQuantity > 0 &&
          !!relationship;


        candidates.push({

          inquiryId: inquiry.id,

          productId: product.id,

          productName: product.name,

          productCategory: product.category,

          productPrice: product.price,

          buyerId: inquiry.buyer_id || null,

          distributorId: evidence.distributorId,

          relationshipId:
            relationship
              ? relationship.id
              : null,

          requestedQuantity,

          availableQuantity,

          allocatableQuantity,

          opportunityScore,

          opportunityTier,

          freshness: freshness(age),

          routeType:
            ready
              ? "DIRECT_BUYER"
              : "NONE",

          routeStatus:
            ready
              ? "READY"
              : "BLOCKED",

          blockReason:
            ready
              ? null
              : reason,

          evidence: {

            stockVerified:
              availableQuantity > 0,

            demandVerified:
              true,

            buyerIdentified:
              !!inquiry.buyer_id,

            relationshipVerified:
              !!relationship,

            relationshipStatus:
              relationship
                ? relationship.status
                : null,

            primaryRelationship:
              relationship
                ? relationship.is_primary !== false
                : false
          }

        });

      });

    });


    candidates.sort(function (a, b) {

      if (
        a.routeStatus === "READY" &&
        b.routeStatus !== "READY"
      ) {
        return -1;
      }

      if (
        a.routeStatus !== "READY" &&
        b.routeStatus === "READY"
      ) {
        return 1;
      }

      return b.opportunityScore - a.opportunityScore;
    });


    return candidates;
  }


  // ------------------------------------------------------------------------
  // UI
  // ------------------------------------------------------------------------

  function getAllocationBox() {

    return document.getElementById(
      "depletor-allocation-routing"
    );
  }


  function renderWaiting() {

    const box =
      getAllocationBox();

    if (!box) {
      return;
    }

    box.innerHTML =
      '<div class="depletor-empty">' +
      'Waiting for authenticated distributor context…' +
      '</div>';
  }


  function renderAuthUnavailable(error) {

    const box =
      getAllocationBox();

    if (!box) {
      return;
    }

    box.innerHTML =
      '<div class="depletor-empty">' +
      '<strong>Allocation evidence not evaluated</strong>' +
      '<br>' +
      esc(
        error && error.message
          ? error.message
          : "Authenticated distributor context unavailable."
      ) +
      '</div>';
  }


  function renderError(error) {

    const box =
      getAllocationBox();

    if (!box) {
      return;
    }

    box.innerHTML =
      '<div class="depletor-empty">' +
      '<strong>Allocation evidence error</strong>' +
      '<br>' +
      esc(
        error && error.message
          ? error.message
          : String(error)
      ) +
      '</div>';
  }


  function renderCandidates(candidates) {

    const box =
      getAllocationBox();

    if (!box) {
      return;
    }


    if (!candidates.length) {

      box.innerHTML =
        '<div class="depletor-empty">' +
        'No evidence-backed allocation candidates found.' +
        '</div>';

      return;
    }


    const ready =
      candidates.filter(function (candidate) {
        return candidate.routeStatus === "READY";
      }).length;


    const blocked =
      candidates.length - ready;


    const allocatable =
      candidates.reduce(function (total, candidate) {
        return total +
          (Number(candidate.allocatableQuantity) || 0);
      }, 0);


    box.innerHTML =

      '<div class="depletor-allocation-summary">' +

      '<div>' +
      '<strong>' +
      candidates.length +
      '</strong>' +
      '<span>Candidates</span>' +
      '</div>' +

      '<div>' +
      '<strong>' +
      ready +
      '</strong>' +
      '<span>Ready</span>' +
      '</div>' +

      '<div>' +
      '<strong>' +
      blocked +
      '</strong>' +
      '<span>Blocked</span>' +
      '</div>' +

      '<div>' +
      '<strong>' +
      allocatable +
      '</strong>' +
      '<span>Allocatable units</span>' +
      '</div>' +

      '</div>' +


      candidates.map(function (candidate) {

        const statusLabel =
          candidate.routeStatus === "READY"
            ? "READY"
            : "BLOCKED";


        return (

          '<div class="depletor-opportunity">' +

          '<div class="depletor-opportunity-top">' +

          '<strong>' +
          esc(candidate.productName) +
          '</strong>' +

          '<span>' +
          esc(statusLabel) +
          '</span>' +

          '</div>' +

          '<div class="depletor-opportunity-meta">' +

          'Demand: ' +
          esc(candidate.requestedQuantity) +

          ' · Stock: ' +
          esc(candidate.availableQuantity) +

          ' · Score: ' +
          esc(candidate.opportunityScore) +

          '</div>' +

          '<div class="depletor-opportunity-meta">' +

          'Route: ' +
          esc(candidate.routeType) +

          ' · Tier: ' +
          esc(candidate.opportunityTier) +

          '</div>' +

          (
            candidate.blockReason
              ? '<div class="depletor-opportunity-meta">' +
                esc(candidate.blockReason) +
                '</div>'
              : ''
          ) +

          '</div>'
        );

      }).join("");

  }


  // ------------------------------------------------------------------------
  // Runtime
  // ------------------------------------------------------------------------

  async function refreshDepletorAllocation() {

    state.status = "WAITING_FOR_AUTH";
    state.error = null;

    renderWaiting();


    let user;

    try {

      user =
        await waitForDistributorContext();

    } catch (error) {

      state.status =
        "AUTH_CONTEXT_UNAVAILABLE";

      state.error = error;

      state.candidates = [];

      window.goodsbarnxAllocationCandidates = [];

      renderAuthUnavailable(error);

      return [];
    }


    state.distributorId = user.id;


    try {

      state.status =
        "READING_EVIDENCE";

      const evidence =
        await readEvidence(user);


      const candidates =
        buildCandidates(evidence);


      state.candidates =
        candidates;

      state.status =
        "EVALUATED";

      state.error = null;


      window.goodsbarnxAllocationCandidates =
        candidates;


      renderCandidates(candidates);


      return candidates;

    } catch (error) {

      state.status =
        "EVIDENCE_ERROR";

      state.error =
        error;

      state.candidates = [];

      window.goodsbarnxAllocationCandidates = [];

      renderError(error);

      return [];
    }
  }


  // ------------------------------------------------------------------------
  // Public API
  // ------------------------------------------------------------------------

  window.refreshDepletorAllocation =
    refreshDepletorAllocation;

  window.goodsbarnxAllocationRuntimeState =
    state;


  // ------------------------------------------------------------------------
  // Runtime startup
  // ------------------------------------------------------------------------

  window.addEventListener(
    "load",
    function () {

      setTimeout(
        function () {
          refreshDepletorAllocation();
        },
        1000
      );

    }
  );

})();
