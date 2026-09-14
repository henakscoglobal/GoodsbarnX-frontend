// ==========================================================================
// GoodsbarnX — Master Stock Depletor
// Allocation & Routing Runtime
// Runtime Version: V1.8.2.6
// Surgical Build: V1.8.2.6.2
//
// PURPOSE
//   Convert evidence-backed stock + demand + canonical relationship signals
//   into allocation candidates and routing readiness.
//
// READ-ONLY BOUNDARY
//   - No stock mutation
//   - No relationship mutation
//   - No inquiry mutation
//   - No order creation
//   - No cart mutation
//   - No buyer-behaviour events
//
// CANONICAL AUTHORIZATION
//   trade_relationships
//
// LEGACY
//   buyer_locks are intentionally not used.
//
// V1.8.2.6.2 SURGICAL CHANGE
//   Authentication readiness is explicitly distinguished from an empty
//   allocation result. The runtime waits for the existing GoodsbarnX
//   currentUser initialization before evaluating live evidence.
//
// IMPORTANT
//   This file loads before app.js.
//   currentUser is therefore resolved through the existing shared global
//   state after GoodsbarnX authentication initialization completes.
// ==========================================================================

(function () {
  "use strict";

  // ------------------------------------------------------------------------
  // Runtime identity
  // ------------------------------------------------------------------------

  var VERSION = "V1.8.2.6";

  // Public runtime identity used by the current-build acceptance test.
  window.goodsbarnxDepletorAllocationVersion = VERSION;

  // ------------------------------------------------------------------------
  // Runtime state
  // ------------------------------------------------------------------------

  var state = {
    status: "INITIALIZING",
    candidates: [],
    error: null,
    distributorId: null,
    authWaitStartedAt: null
  };

  // ------------------------------------------------------------------------
  // Constants
  // ------------------------------------------------------------------------

  var AUTH_WAIT_INTERVAL = 250;
  var AUTH_WAIT_TIMEOUT = 10000;

  // ------------------------------------------------------------------------
  // Utilities
  // ------------------------------------------------------------------------

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function tokens(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter(function (token) {
        return token.length >= 2;
      });
  }

  function linked(product, inquiry) {
    var productTokens = tokens(product && product.name);
    var inquiryTokens = tokens(inquiry && inquiry.item);

    if (!productTokens.length || !inquiryTokens.length) {
      return false;
    }

    return productTokens.some(function (token) {
      return inquiryTokens.indexOf(token) !== -1;
    });
  }

  function ageHours(createdAt) {
    if (!createdAt) {
      return null;
    }

    var created = new Date(createdAt).getTime();

    if (!Number.isFinite(created)) {
      return null;
    }

    return Math.max(
      0,
      (Date.now() - created) / 3600000
    );
  }

  function freshnessFromAge(hours) {
    if (hours === null) {
      return "unknown";
    }

    if (hours <= 24) {
      return "fresh";
    }

    if (hours <= 72) {
      return "active";
    }

    return "aging";
  }

  function score(
    match,
    stockAvailable,
    quantityKnown,
    stockCovers,
    freshness
  ) {
    var value = 0;

    if (match) {
      value += 40;
    }

    if (stockAvailable) {
      value += 25;
    }

    if (quantityKnown) {
      value += 20;
    }

    if (stockCovers) {
      value += 5;
    }

    if (freshness === "fresh") {
      value += 10;
    } else if (freshness === "active") {
      value += 6;
    } else if (freshness === "aging") {
      value += 2;
    }

    return value;
  }

  function tier(match, stockAvailable, scoreValue) {
    if (
      match &&
      stockAvailable &&
      scoreValue >= 75
    ) {
      return "ACT NOW";
    }

    if (match && stockAvailable) {
      return "READY";
    }

    if (match && !stockAvailable) {
      return "RESTOCK";
    }

    return "MONITOR";
  }

  function activeRelationship(
    relationships,
    buyerId,
    distributorId
  ) {
    if (!buyerId || !distributorId) {
      return null;
    }

    return (
      relationships.find(function (relationship) {
        return (
          relationship &&
          relationship.buyer_id === buyerId &&
          relationship.distributor_id === distributorId &&
          String(
            relationship.status || ""
          ).toLowerCase() === "active" &&
          relationship.is_primary === true
        );
      }) || null
    );
  }

  function blockReason(candidate) {
    var reasons = [];

    if (!candidate.productMatch) {
      reasons.push("no product-demand match");
    }

    if (!candidate.stockAvailable) {
      reasons.push("no available stock");
    }

    if (!candidate.quantityKnown) {
      reasons.push("requested quantity unavailable");
    }

    if (!candidate.buyerId) {
      reasons.push("buyer identity unavailable");
    }

    if (!candidate.relationshipId) {
      reasons.push(
        "active primary relationship unavailable"
      );
    }

    if (!reasons.length) {
      return null;
    }

    return reasons.join("; ");
  }

  // ------------------------------------------------------------------------
  // Existing GoodsbarnX authentication boundary
  // ------------------------------------------------------------------------

  function getCurrentUser() {
    try {
      if (
        typeof currentUser !== "undefined" &&
        currentUser
      ) {
        return currentUser;
      }
    } catch (error) {
      // currentUser may not yet exist during early script execution.
    }

    return null;
  }

  function isDistributor(user) {
    return Boolean(
      user &&
      user.id &&
      String(user.role || "").toLowerCase() ===
        "distributor"
    );
  }

  function waitForDistributorContext() {
    return new Promise(function (resolve, reject) {
      var started = Date.now();

      state.status = "WAITING_FOR_AUTH";
      state.authWaitStartedAt = started;

      function check() {
        var user = getCurrentUser();

        if (isDistributor(user)) {
          state.status = "AUTHENTICATED";
          state.distributorId = user.id;

          resolve(user);
          return;
        }

        if (
          Date.now() - started >=
          AUTH_WAIT_TIMEOUT
        ) {
          state.status =
            "AUTH_CONTEXT_UNAVAILABLE";

          reject(
            new Error(
              "Authenticated distributor context unavailable."
            )
          );

          return;
        }

        window.setTimeout(
          check,
          AUTH_WAIT_INTERVAL
        );
      }

      check();
    });
  }

  // ------------------------------------------------------------------------
  // Evidence reader
  // ------------------------------------------------------------------------

  async function readEvidence(user) {
    if (typeof sb === "undefined" || !sb) {
      throw new Error(
        "Supabase client unavailable."
      );
    }

    if (!isDistributor(user)) {
      var authError = new Error(
        "Authenticated distributor context unavailable."
      );

      authError.code =
        "AUTH_CONTEXT_UNAVAILABLE";

      throw authError;
    }

    var distributorId = user.id;

    var productsResult = await sb
      .from("products")
      .select(
        "id,name,price,stock_quantity,status,category"
      )
      .eq(
        "distributor_id",
        distributorId
      );

    if (productsResult.error) {
      throw productsResult.error;
    }

    var inquiriesResult = await sb
      .from("inquiries")
      .select(
        "id,item,quantity,status,created_at,buyer_id,distributor_id,inquirer_id"
      )
      .eq(
        "distributor_id",
        distributorId
      )
      .order(
        "created_at",
        { ascending: false }
      );

    if (inquiriesResult.error) {
      throw inquiriesResult.error;
    }

    var relationshipsResult = await sb
      .from("trade_relationships")
      .select(
        "id,buyer_id,distributor_id,status,is_primary"
      )
      .eq(
        "distributor_id",
        distributorId
      );

    if (relationshipsResult.error) {
      throw relationshipsResult.error;
    }

    var agentsResult = await sb
      .from("agent_distributor_attachments")
      .select(
        "id,agent_id,status"
      )
      .eq(
        "distributor_id",
        distributorId
      )
      .eq(
        "status",
        "accepted"
      );

    if (agentsResult.error) {
      throw agentsResult.error;
    }

    return {
      distributorId: distributorId,
      products: productsResult.data || [],
      inquiries: inquiriesResult.data || [],
      relationships:
        relationshipsResult.data || [],
      acceptedAgents:
        agentsResult.data || []
    };
  }

  // ------------------------------------------------------------------------
  // Candidate generation
  // ------------------------------------------------------------------------

  function buildCandidates(evidence) {
    var distributorId =
      evidence.distributorId;

    var products =
      evidence.products || [];

    var inquiries =
      evidence.inquiries || [];

    var relationships =
      evidence.relationships || [];

    var candidates = [];

    inquiries
      .filter(function (inquiry) {
        var status = String(
          inquiry.status || ""
        ).toLowerCase();

        return (
          status === "open" ||
          status === "pending"
        );
      })
      .forEach(function (inquiry) {
        products.forEach(function (product) {
          var productMatch =
            linked(product, inquiry);

          if (!productMatch) {
            return;
          }

          var rawQuantity =
            inquiry.quantity == null
              ? null
              : String(
                  inquiry.quantity
                ).trim();

          var requestedQuantity = null;

          if (
            rawQuantity &&
            /^\d+(\.\d+)?$/.test(
              rawQuantity
            )
          ) {
            requestedQuantity =
              Number(rawQuantity);
          }

          var availableQuantity =
            Number(
              product.stock_quantity || 0
            );

          if (
            !Number.isFinite(
              availableQuantity
            )
          ) {
            availableQuantity = 0;
          }

          var stockAvailable =
            availableQuantity > 0;

          var quantityKnown =
            requestedQuantity !== null &&
            Number.isFinite(
              requestedQuantity
            ) &&
            requestedQuantity > 0;

          var stockCovers =
            quantityKnown &&
            availableQuantity >=
              requestedQuantity;

          var buyerId =
            inquiry.buyer_id || null;

          var relationship =
            activeRelationship(
              relationships,
              buyerId,
              distributorId
            );

          var relationshipId =
            relationship &&
            relationship.id
              ? relationship.id
              : null;

          var allocatableQuantity = 0;

          if (
            productMatch &&
            stockAvailable &&
            quantityKnown &&
            buyerId &&
            relationshipId
          ) {
            allocatableQuantity =
              Math.min(
                requestedQuantity,
                availableQuantity
              );
          }

          var hours =
            ageHours(
              inquiry.created_at
            );

          var freshness =
            freshnessFromAge(hours);

          var opportunityScore =
            score(
              productMatch,
              stockAvailable,
              quantityKnown,
              stockCovers,
              freshness
            );

          var opportunityTier =
            tier(
              productMatch,
              stockAvailable,
              opportunityScore
            );

          var ready =
            Boolean(relationshipId) &&
            allocatableQuantity > 0;

          var candidate = {
            inquiryId: inquiry.id,
            productId: product.id,
            distributorId:
              distributorId,

            buyerId: buyerId,
            relationshipId:
              relationshipId,

            productName:
              product.name || "",

            inquiryItem:
              inquiry.item || "",

            requestedQuantity:
              requestedQuantity,

            availableQuantity:
              availableQuantity,

            allocatableQuantity:
              allocatableQuantity,

            productMatch:
              productMatch,

            stockAvailable:
              stockAvailable,

            quantityKnown:
              quantityKnown,

            stockCovers:
              stockCovers,

            freshness:
              freshness,

            opportunityScore:
              opportunityScore,

            opportunityTier:
              opportunityTier,

            routeType: ready
              ? "DIRECT_BUYER"
              : "NONE",

            routeStatus: ready
              ? "READY"
              : "BLOCKED",

            evidence: {
              inquiryId:
                inquiry.id,

              productId:
                product.id,

              distributorId:
                distributorId,

              buyerId:
                buyerId,

              relationshipId:
                relationshipId,

              productMatch:
                productMatch,

              stockQuantity:
                availableQuantity,

              requestedQuantity:
                requestedQuantity,

              stockCoversDemand:
                stockCovers,

              relationshipStatus:
                relationship &&
                relationship.status
                  ? relationship.status
                  : null,

              relationshipIsPrimary:
                relationship
                  ? relationship.is_primary ===
                    true
                  : false
            },

            blockReason:
              null
          };

          candidate.blockReason =
            blockReason(candidate);

          candidates.push(candidate);
        });
      });

    candidates.sort(function (a, b) {
      if (
        a.routeStatus !==
        b.routeStatus
      ) {
        return a.routeStatus ===
          "READY"
          ? -1
          : 1;
      }

      return (
        b.opportunityScore -
        a.opportunityScore
      );
    });

    return candidates;
  }

  // ------------------------------------------------------------------------
  // Allocation runtime UI
  // ------------------------------------------------------------------------

  function ensureContainer() {
    var existing =
      document.getElementById(
        "depletor-allocation-runtime"
      );

    if (existing) {
      return existing;
    }

    var opportunities =
      document.getElementById(
        "depletor-opportunities"
      );

    if (!opportunities) {
      return null;
    }

    var wrapper =
      document.createElement(
        "section"
      );

    wrapper.id =
      "depletor-allocation-runtime";

    wrapper.className =
      "depletor-section";

    wrapper.innerHTML = `
      <div class="depletor-section-header">
        <div>
          <div class="depletor-section-kicker">
            ALLOCATION &amp; ROUTING
          </div>

          <h3>
            Evidence-backed fulfillment paths
          </h3>

          <p>
            Converts verified stock, demand and canonical relationship
            evidence into routing readiness.
          </p>
        </div>
      </div>

      <div id="depletor-allocation-meta"></div>

      <div id="depletor-allocation-list"></div>
    `;

    opportunities.parentNode.insertBefore(
      wrapper,
      opportunities.nextSibling
    );

    return wrapper;
  }

  function renderWaitingForAuth() {
    var container =
      ensureContainer();

    if (!container) {
      return;
    }

    var meta =
      document.getElementById(
        "depletor-allocation-meta"
      );

    var list =
      document.getElementById(
        "depletor-allocation-list"
      );

    if (meta) {
      meta.innerHTML = `
        <div class="depletor-inline-metrics">
          <span>Status <strong>WAITING</strong></span>
        </div>
      `;
    }

    if (list) {
      list.innerHTML = `
        <div class="depletor-empty">
          Waiting for authenticated distributor context…
        </div>
      `;
    }
  }

  function renderAuthUnavailable() {
    var container =
      ensureContainer();

    if (!container) {
      return;
    }

    var meta =
      document.getElementById(
        "depletor-allocation-meta"
      );

    var list =
      document.getElementById(
        "depletor-allocation-list"
      );

    if (meta) {
      meta.innerHTML = `
        <div class="depletor-inline-metrics">
          <span>Status <strong>NOT EVALUATED</strong></span>
        </div>
      `;
    }

    if (list) {
      list.innerHTML = `
        <div class="depletor-empty">
          Allocation evidence was not evaluated because
          authenticated distributor context is unavailable.
        </div>
      `;
    }
  }

  function renderEvidenceError(error) {
    var container =
      ensureContainer();

    if (!container) {
      return;
    }

    var meta =
      document.getElementById(
        "depletor-allocation-meta"
      );

    var list =
      document.getElementById(
        "depletor-allocation-list"
      );

    if (meta) {
      meta.innerHTML = `
        <div class="depletor-inline-metrics">
          <span>Status <strong>EVIDENCE ERROR</strong></span>
        </div>
      `;
    }

    if (list) {
      list.innerHTML = `
        <div class="depletor-empty">
          Allocation evidence could not be evaluated.
          ${esc(
            error &&
              error.message
              ? error.message
              : "Unknown evidence error."
          )}
        </div>
      `;
    }
  }

  function renderCandidates(
    candidates
  ) {
    var container =
      ensureContainer();

    if (!container) {
      return;
    }

    var meta =
      document.getElementById(
        "depletor-allocation-meta"
      );

    var list =
      document.getElementById(
        "depletor-allocation-list"
      );

    var ready =
      candidates.filter(
        function (candidate) {
          return (
            candidate.routeStatus ===
            "READY"
          );
        }
      ).length;

    var blocked =
      candidates.filter(
        function (candidate) {
          return (
            candidate.routeStatus ===
            "BLOCKED"
          );
        }
      ).length;

    var allocatableUnits =
      candidates.reduce(
        function (
          total,
          candidate
        ) {
          return (
            total +
            Number(
              candidate.allocatableQuantity ||
                0
            )
          );
        },
        0
      );

    var relationshipMissing =
      candidates.filter(
        function (candidate) {
          return !candidate.relationshipId;
        }
      ).length;

    if (meta) {
      meta.innerHTML = `
        <div class="depletor-inline-metrics">
          <span>
            Candidates
            <strong>${candidates.length}</strong>
          </span>

          <span>
            Ready
            <strong>${ready}</strong>
          </span>

          <span>
            Blocked
            <strong>${blocked}</strong>
          </span>

          <span>
            Allocatable units
            <strong>${allocatableUnits}</strong>
          </span>

          <span>
            Relationship evidence missing
            <strong>${relationshipMissing}</strong>
          </span>
        </div>
      `;
    }

    if (!list) {
      return;
    }

    if (!candidates.length) {
      list.innerHTML = `
        <div class="depletor-empty">
          No evidence-backed allocation candidates found.
        </div>
      `;

      return;
    }

    list.innerHTML =
      candidates
        .map(function (candidate) {
          var ready =
            candidate.routeStatus ===
            "READY";

          return `
            <article class="depletor-opportunity-card">

              <div class="depletor-opportunity-top">

                <div>
                  <strong>
                    ${esc(
                      candidate.productName
                    )}
                  </strong>

                  <div>
                    Demand:
                    ${esc(
                      candidate.inquiryItem
                    )}
                  </div>
                </div>

                <span class="depletor-status">
                  ${
                    ready
                      ? "READY"
                      : "BLOCKED"
                  }
                </span>

              </div>

              <div class="depletor-opportunity-grid">

                <div>
                  <small>Requested</small>
                  <strong>
                    ${
                      candidate.requestedQuantity ==
                      null
                        ? "—"
                        : esc(
                            candidate.requestedQuantity
                          )
                    }
                  </strong>
                </div>

                <div>
                  <small>Available</small>
                  <strong>
                    ${esc(
                      candidate.availableQuantity
                    )}
                  </strong>
                </div>

                <div>
                  <small>Allocatable</small>
                  <strong>
                    ${esc(
                      candidate.allocatableQuantity
                    )}
                  </strong>
                </div>

                <div>
                  <small>Score</small>
                  <strong>
                    ${esc(
                      candidate.opportunityScore
                    )}
                  </strong>
                </div>

              </div>

              <div class="depletor-opportunity-evidence">

                <div>
                  Product match:
                  <strong>
                    ${
                      candidate.productMatch
                        ? "YES"
                        : "NO"
                    }
                  </strong>
                </div>

                <div>
                  Buyer:
                  <strong>
                    ${
                      candidate.buyerId
                        ? "IDENTIFIED"
                        : "UNRESOLVED"
                    }
                  </strong>
                </div>

                <div>
                  Relationship:
                  <strong>
                    ${
                      candidate.relationshipId
                        ? "ACTIVE PRIMARY"
                        : "MISSING"
                    }
                  </strong>
                </div>

                <div>
                  Route:
                  <strong>
                    ${esc(
                      candidate.routeType
                    )}
                  </strong>
                </div>

              </div>

              ${
                candidate.blockReason
                  ? `
                    <div class="depletor-block-reason">
                      Block reason:
                      ${esc(
                        candidate.blockReason
                      )}
                    </div>
                  `
                  : ""
              }

            </article>
          `;
        })
        .join("");
  }

  // ------------------------------------------------------------------------
  // Public allocation runtime
  // ------------------------------------------------------------------------

  async function refreshDepletorAllocation() {
    state.error = null;

    renderWaitingForAuth();

    var user;

    try {
      user =
        await waitForDistributorContext();
    } catch (error) {
      state.error = error;
      state.candidates = [];
      state.distributorId = null;

      renderAuthUnavailable();

      window.goodsbarnxAllocationCandidates =
        [];

      window.goodsbarnxDepletorAllocationState =
        state;

      console.warn(
        "[GoodsbarnX Depletor " +
          VERSION +
          "] Authentication boundary:",
        error
      );

      return [];
    }

    try {
      var evidence =
        await readEvidence(user);

      var candidates =
        buildCandidates(
          evidence
        );

      state.status =
        "EVIDENCE_EVALUATED";

      state.candidates =
        candidates;

      state.distributorId =
        evidence.distributorId;

      renderCandidates(
        candidates
      );

      window.goodsbarnxAllocationCandidates =
        candidates;

      window.goodsbarnxDepletorAllocationState =
        state;

      return candidates;
    } catch (error) {
      state.status =
        "EVIDENCE_ERROR";

      state.error =
        error;

      state.candidates =
        [];

      renderEvidenceError(
        error
      );

      window.goodsbarnxAllocationCandidates =
        [];

      window.goodsbarnxDepletorAllocationState =
        state;

      console.error(
        "[GoodsbarnX Depletor " +
          VERSION +
          "] Evidence error:",
        error
      );

      return [];
    }
  }

  // ------------------------------------------------------------------------
  // Public interfaces
  // ------------------------------------------------------------------------

  window.refreshDepletorAllocation =
    refreshDepletorAllocation;

  window.goodsbarnxAllocationCandidates =
    state.candidates;

  window.goodsbarnxDepletorAllocationState =
    state;

  // ------------------------------------------------------------------------
  // Runtime startup
  //
  // The runtime may load before app.js has completed authentication.
  // Delaying execution here prevents an early authentication race from
  // becoming a false "zero candidates" result.
  // ------------------------------------------------------------------------

  window.addEventListener(
    "load",
    function () {
      window.setTimeout(
        function () {
          refreshDepletorAllocation();
        },
        1000
      );
    }
  );

})();
