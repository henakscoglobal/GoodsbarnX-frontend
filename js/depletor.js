// ==========================================================================
// GoodsbarnX — Master Stock Depletor
// Allocation & Routing Runtime
// Version: V1.8.2.6.1
//
// Purpose:
//   Convert evidence-backed stock + demand + relationship signals into
//   allocation candidates and routing readiness.
//
// IMPORTANT:
//   - READ ONLY
//   - No stock mutation
//   - No relationship mutation
//   - No inquiry mutation
//   - No order creation
//   - No cart mutation
//   - No buyer-behaviour events
//
// Canonical authorization source:
//   trade_relationships
//
// Legacy buyer_locks are intentionally NOT used.
//
// This file is loaded before app.js.
// It therefore uses the shared global `currentUser` state created by app.js
// after initialization, while exposing its runtime version immediately.
// ==========================================================================

(function () {
  "use strict";

  // ------------------------------------------------------------------------
  // Runtime identity
  // ------------------------------------------------------------------------

  var VERSION = "V1.8.2.6";

  // V1.8.2.6.1 surgical boundary fix:
  // Expose the runtime version through an explicit public interface so the
  // current-build acceptance test can verify the loaded runtime without
  // depending on internal/local variables.
  window.goodsbarnxDepletorAllocationVersion = VERSION;

  var state = {
    candidates: [],
    error: null
  };

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

    return Math.max(0, (Date.now() - created) / 3600000);
  }

  function score(match, stockAvailable, quantityKnown, stockCovers, freshness) {
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
    if (match && stockAvailable && scoreValue >= 75) {
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

  function activeRelationship(relationships, buyerId, distributorId) {
    if (!buyerId || !distributorId) {
      return null;
    }

    return (
      relationships.find(function (relationship) {
        return (
          relationship &&
          relationship.buyer_id === buyerId &&
          relationship.distributor_id === distributorId &&
          String(relationship.status || "").toLowerCase() === "active" &&
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
      reasons.push("active primary relationship unavailable");
    }

    if (!reasons.length) {
      return null;
    }

    return reasons.join("; ");
  }

  // ------------------------------------------------------------------------
  // Evidence reader
  // ------------------------------------------------------------------------

  async function readEvidence() {
    if (typeof sb === "undefined" || !sb) {
      throw new Error("Supabase client unavailable.");
    }

    if (
      typeof currentUser === "undefined" ||
      !currentUser ||
      !currentUser.id
    ) {
      throw new Error("Authenticated distributor context unavailable.");
    }

    var distributorId = currentUser.id;

    var productsResult = await sb
      .from("products")
      .select(
        "id,name,price,stock_quantity,status,category"
      )
      .eq("distributor_id", distributorId);

    if (productsResult.error) {
      throw productsResult.error;
    }

    var inquiriesResult = await sb
      .from("inquiries")
      .select(
        "id,item,quantity,status,created_at,buyer_id,distributor_id,inquirer_id"
      )
      .eq("distributor_id", distributorId)
      .order("created_at", { ascending: false });

    if (inquiriesResult.error) {
      throw inquiriesResult.error;
    }

    var relationshipsResult = await sb
      .from("trade_relationships")
      .select(
        "id,buyer_id,distributor_id,status,is_primary"
      )
      .eq("distributor_id", distributorId);

    if (relationshipsResult.error) {
      throw relationshipsResult.error;
    }

    var agentsResult = await sb
      .from("agent_distributor_attachments")
      .select(
        "id,agent_id,status"
      )
      .eq("distributor_id", distributorId)
      .eq("status", "accepted");

    if (agentsResult.error) {
      throw agentsResult.error;
    }

    return {
      distributorId: distributorId,
      products: productsResult.data || [],
      inquiries: inquiriesResult.data || [],
      relationships: relationshipsResult.data || [],
      acceptedAgents: agentsResult.data || []
    };
  }

  // ------------------------------------------------------------------------
  // Candidate generation
  // ------------------------------------------------------------------------

  function buildCandidates(evidence) {
    var distributorId = evidence.distributorId;
    var products = evidence.products || [];
    var inquiries = evidence.inquiries || [];
    var relationships = evidence.relationships || [];

    var candidates = [];

    inquiries
      .filter(function (inquiry) {
        var status = String(inquiry.status || "").toLowerCase();

        return status === "open" || status === "pending";
      })
      .forEach(function (inquiry) {
        products.forEach(function (product) {
          var productMatch = linked(product, inquiry);

          if (!productMatch) {
            return;
          }

          var rawQuantity =
            inquiry.quantity == null
              ? null
              : String(inquiry.quantity).trim();

          var requestedQuantity = null;

          if (
            rawQuantity &&
            /^\d+(\.\d+)?$/.test(rawQuantity)
          ) {
            requestedQuantity = Number(rawQuantity);
          }

          var availableQuantity = Number(product.stock_quantity || 0);

          if (!Number.isFinite(availableQuantity)) {
            availableQuantity = 0;
          }

          var stockAvailable = availableQuantity > 0;

          var quantityKnown =
            requestedQuantity !== null &&
            Number.isFinite(requestedQuantity) &&
            requestedQuantity > 0;

          var stockCovers =
            quantityKnown &&
            availableQuantity >= requestedQuantity;

          var buyerId = inquiry.buyer_id || null;

          var relationship =
            activeRelationship(
              relationships,
              buyerId,
              distributorId
            );

          var relationshipId =
            relationship && relationship.id
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
            allocatableQuantity = Math.min(
              requestedQuantity,
              availableQuantity
            );
          }

          var hours = ageHours(inquiry.created_at);

          var freshness = "unknown";

          if (hours !== null) {
            if (hours <= 24) {
              freshness = "fresh";
            } else if (hours <= 72) {
              freshness = "active";
            } else {
              freshness = "aging";
            }
          }

          var opportunityScore = score(
            productMatch,
            stockAvailable,
            quantityKnown,
            stockCovers,
            freshness
          );

          var opportunityTier = tier(
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
            distributorId: distributorId,

            buyerId: buyerId,
            relationshipId: relationshipId,

            productName: product.name || "",
            inquiryItem: inquiry.item || "",

            requestedQuantity: requestedQuantity,
            availableQuantity: availableQuantity,
            allocatableQuantity: allocatableQuantity,

            productMatch: productMatch,
            stockAvailable: stockAvailable,
            quantityKnown: quantityKnown,
            stockCovers: stockCovers,

            freshness: freshness,
            opportunityScore: opportunityScore,
            opportunityTier: opportunityTier,

            routeType: ready
              ? "DIRECT_BUYER"
              : "NONE",

            routeStatus: ready
              ? "READY"
              : "BLOCKED",

            evidence: {
              inquiryId: inquiry.id,
              productId: product.id,
              distributorId: distributorId,
              buyerId: buyerId,
              relationshipId: relationshipId,
              productMatch: productMatch,
              stockQuantity: availableQuantity,
              requestedQuantity: requestedQuantity,
              stockCoversDemand: stockCovers,
              relationshipStatus:
                relationship && relationship.status
                  ? relationship.status
                  : null,
              relationshipIsPrimary:
                relationship
                  ? relationship.is_primary === true
                  : false
            },

            blockReason: null
          };

          candidate.blockReason = blockReason(candidate);

          candidates.push(candidate);
        });
      });

    candidates.sort(function (a, b) {
      if (a.routeStatus !== b.routeStatus) {
        return a.routeStatus === "READY" ? -1 : 1;
      }

      return b.opportunityScore - a.opportunityScore;
    });

    return candidates;
  }

  // ------------------------------------------------------------------------
  // Renderer
  // ------------------------------------------------------------------------

  function ensureContainer() {
    var existing =
      document.getElementById("depletor-allocation-runtime");

    if (existing) {
      return existing;
    }

    var opportunities =
      document.getElementById("depletor-opportunities");

    if (!opportunities) {
      return null;
    }

    var wrapper = document.createElement("section");

    wrapper.id = "depletor-allocation-runtime";

    wrapper.className = "depletor-section";

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

  function renderCandidates(candidates) {
    var container = ensureContainer();

    if (!container) {
      return;
    }

    var meta =
      document.getElementById("depletor-allocation-meta");

    var list =
      document.getElementById("depletor-allocation-list");

    var ready = candidates.filter(function (candidate) {
      return candidate.routeStatus === "READY";
    }).length;

    var blocked = candidates.filter(function (candidate) {
      return candidate.routeStatus === "BLOCKED";
    }).length;

    var allocatableUnits = candidates.reduce(
      function (total, candidate) {
        return total + Number(candidate.allocatableQuantity || 0);
      },
      0
    );

    var relationshipMissing = candidates.filter(
      function (candidate) {
        return !candidate.relationshipId;
      }
    ).length;

    if (meta) {
      meta.innerHTML = `
        <div class="depletor-inline-metrics">
          <span>Candidates <strong>${candidates.length}</strong></span>
          <span>Ready <strong>${ready}</strong></span>
          <span>Blocked <strong>${blocked}</strong></span>
          <span>Allocatable units <strong>${allocatableUnits}</strong></span>
          <span>Relationship evidence missing <strong>${relationshipMissing}</strong></span>
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

    list.innerHTML = candidates
      .map(function (candidate) {
        var ready =
          candidate.routeStatus === "READY";

        return `
          <article class="depletor-opportunity-card">

            <div class="depletor-opportunity-top">

              <div>
                <strong>
                  ${esc(candidate.productName)}
                </strong>

                <div>
                  Demand:
                  ${esc(candidate.inquiryItem)}
                </div>
              </div>

              <span class="depletor-status">
                ${ready ? "READY" : "BLOCKED"}
              </span>

            </div>

            <div class="depletor-opportunity-grid">

              <div>
                <small>Requested</small>
                <strong>
                  ${
                    candidate.requestedQuantity == null
                      ? "—"
                      : esc(candidate.requestedQuantity)
                  }
                </strong>
              </div>

              <div>
                <small>Available</small>
                <strong>
                  ${esc(candidate.availableQuantity)}
                </strong>
              </div>

              <div>
                <small>Allocatable</small>
                <strong>
                  ${esc(candidate.allocatableQuantity)}
                </strong>
              </div>

              <div>
                <small>Score</small>
                <strong>
                  ${esc(candidate.opportunityScore)}
                </strong>
              </div>

            </div>

            <div class="depletor-opportunity-evidence">

              <div>
                Product match:
                <strong>
                  ${candidate.productMatch ? "YES" : "NO"}
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
                  ${esc(candidate.routeType)}
                </strong>
              </div>

            </div>

            ${
              candidate.blockReason
                ? `
                  <div class="depletor-block-reason">
                    Block reason:
                    ${esc(candidate.blockReason)}
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
  // Public runtime
  // ------------------------------------------------------------------------

  async function refreshDepletorAllocation() {
    state.error = null;

    try {
      var evidence = await readEvidence();

      var candidates = buildCandidates(evidence);

      state.candidates = candidates;

      renderCandidates(candidates);

      window.goodsbarnxAllocationCandidates = candidates;

      return candidates;
    } catch (error) {
      state.error = error;

      console.error(
        "[GoodsbarnX Depletor " + VERSION + "]",
        error
      );

      renderCandidates([]);

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
  // Runtime readiness
  // ------------------------------------------------------------------------

  window.addEventListener("load", function () {
    setTimeout(function () {
      refreshDepletorAllocation();
    }, 1000);
  });

})();
