// ==========================================================================
// GoodsbarnX — Master Stock Depletor
// V1.8.2.6 — Allocation & Routing Runtime
//
// Purpose:
//   Convert evidence-backed stock + demand + relationship intelligence
//   into allocation candidates and routing readiness.
//
// IMPORTANT:
//   - READ ONLY
//   - No stock mutations
//   - No relationship mutations
//   - No order creation
//   - No allocation persistence
//   - No synthetic events
//   - Canonical relationship evidence only
//
// This file is intentionally separate from the Supabase SQL validation.
// ==========================================================================

(function () {
  "use strict";

  const VERSION = "V1.8.2.6";

  const state = {
    candidates: [],
    error: null
  };

  // ------------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------------

  function esc(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function tokens(value) {
    return String(value ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter(Boolean);
  }

  function linked(a, b) {
    const left = new Set(tokens(a));
    const right = tokens(b);

    if (!left.size || !right.length) return false;

    return right.some(token => left.has(token));
  }

  function ageHours(createdAt) {
    if (!createdAt) return Infinity;

    const timestamp = new Date(createdAt).getTime();

    if (!Number.isFinite(timestamp)) return Infinity;

    return Math.max(0, (Date.now() - timestamp) / 3600000);
  }

  function numeric(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function activeRelationship(relationships, buyerId, distributorId) {
    if (!buyerId || !distributorId) return null;

    return (
      relationships.find(row =>
        row &&
        row.buyer_id === buyerId &&
        row.distributor_id === distributorId &&
        row.status === "active" &&
        row.is_primary === true
      ) || null
    );
  }

  function scoreCandidate({
    productMatch,
    stockAvailable,
    quantityKnown,
    stockCoversDemand,
    demandAgeHours
  }) {
    let score = 0;

    if (productMatch) score += 40;
    if (stockAvailable) score += 25;
    if (quantityKnown) score += 20;
    if (stockCoversDemand) score += 5;

    if (Number.isFinite(demandAgeHours)) {
      if (demandAgeHours <= 24) {
        score += 10;
      } else if (demandAgeHours <= 72) {
        score += 6;
      } else {
        score += 2;
      }
    }

    return score;
  }

  function tier({
    productMatch,
    stockAvailable,
    score
  }) {
    if (productMatch && stockAvailable && score >= 75) {
      return "ACT NOW";
    }

    if (productMatch && stockAvailable) {
      return "READY";
    }

    if (productMatch) {
      return "WATCH";
    }

    if (!stockAvailable) {
      return "RESTOCK";
    }

    return "MONITOR";
  }

  function blockReason({
    productMatch,
    stockAvailable,
    requestedQuantity,
    buyerId,
    relationship
  }) {
    if (!productMatch) {
      return "NO_PRODUCT_DEMAND_MATCH";
    }

    if (!stockAvailable) {
      return "NO_AVAILABLE_STOCK";
    }

    if (!requestedQuantity || requestedQuantity <= 0) {
      return "INVALID_OR_UNKNOWN_DEMAND_QUANTITY";
    }

    if (!buyerId) {
      return "BUYER_IDENTITY_MISSING";
    }

    if (!relationship) {
      return "ACTIVE_PRIMARY_RELATIONSHIP_MISSING";
    }

    return null;
  }

  // ------------------------------------------------------------------------
  // Evidence reader
  // ------------------------------------------------------------------------

  async function readEvidence(distributorId) {
    if (!window.sb) {
      throw new Error("Supabase client is unavailable.");
    }

    if (!distributorId) {
      throw new Error("Distributor context is unavailable.");
    }

    const [
      productsResult,
      inquiriesResult,
      relationshipsResult,
      agentsResult
    ] = await Promise.all([
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
        .eq("distributor_id", distributorId)
        .order("created_at", { ascending: false }),

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

    if (productsResult.error) {
      throw productsResult.error;
    }

    if (inquiriesResult.error) {
      throw inquiriesResult.error;
    }

    if (relationshipsResult.error) {
      throw relationshipsResult.error;
    }

    if (agentsResult.error) {
      throw agentsResult.error;
    }

    return {
      products: productsResult.data || [],
      inquiries: inquiriesResult.data || [],
      relationships: relationshipsResult.data || [],
      agents: agentsResult.data || []
    };
  }

  // ------------------------------------------------------------------------
  // Candidate generation
  // ------------------------------------------------------------------------

  function generateCandidates(evidence, distributorId) {
    const products = evidence.products || [];
    const inquiries = evidence.inquiries || [];
    const relationships = evidence.relationships || [];

    const openInquiries = inquiries.filter(inquiry => {
      const status = String(inquiry.status || "").toLowerCase();

      return (
        status === "open" ||
        status === "pending"
      );
    });

    const candidates = [];

    openInquiries.forEach(inquiry => {
      const requestedQuantity = numeric(inquiry.quantity);

      products.forEach(product => {
        const productMatch =
          linked(product.name, inquiry.item) ||
          linked(product.category, inquiry.item);

        if (!productMatch) {
          return;
        }

        const availableQuantity =
          Math.max(0, numeric(product.stock_quantity) || 0);

        const stockAvailable = availableQuantity > 0;

        const quantityKnown =
          requestedQuantity !== null &&
          requestedQuantity > 0;

        const stockCoversDemand =
          quantityKnown &&
          availableQuantity >= requestedQuantity;

        const relationship = activeRelationship(
          relationships,
          inquiry.buyer_id,
          distributorId
        );

        const opportunityScore = scoreCandidate({
          productMatch,
          stockAvailable,
          quantityKnown,
          stockCoversDemand,
          demandAgeHours: ageHours(inquiry.created_at)
        });

        const opportunityTier = tier({
          productMatch,
          stockAvailable,
          score: opportunityScore
        });

        const reason = blockReason({
          productMatch,
          stockAvailable,
          requestedQuantity,
          buyerId: inquiry.buyer_id,
          relationship
        });

        const ready =
          !reason &&
          relationship &&
          quantityKnown &&
          stockAvailable;

        const allocatableQuantity =
          ready
            ? Math.min(
                requestedQuantity,
                availableQuantity
              )
            : 0;

        candidates.push({
          inquiryId: inquiry.id,
          productId: product.id,
          distributorId,

          buyerId: inquiry.buyer_id || null,
          inquirerId: inquiry.inquirer_id || null,

          relationshipId:
            relationship?.id || null,

          productName: product.name || null,
          inquiryItem: inquiry.item || null,

          requestedQuantity,
          availableQuantity,
          allocatableQuantity,

          productMatch,
          quantityKnown,
          stockAvailable,
          stockCoversDemand,

          opportunityScore,
          opportunityTier,

          routeType:
            ready
              ? "DIRECT_BUYER"
              : "NONE",

          routeStatus:
            ready
              ? "READY"
              : "BLOCKED",

          blockReason: reason,

          evidence: {
            inquiryId: inquiry.id,
            productId: product.id,
            distributorId,
            buyerId: inquiry.buyer_id || null,
            relationshipId:
              relationship?.id || null,

            productDemandMatch:
              productMatch,

            requestedQuantity,
            availableQuantity,

            activePrimaryRelationship:
              Boolean(relationship),

            acceptedAgentCapacity:
              (evidence.agents || []).length
          }
        });
      });
    });

    return candidates.sort((a, b) => {
      if (a.routeStatus !== b.routeStatus) {
        return a.routeStatus === "READY" ? -1 : 1;
      }

      return b.opportunityScore - a.opportunityScore;
    });
  }

  // ------------------------------------------------------------------------
  // Public runtime
  // ------------------------------------------------------------------------

  async function refreshDepletorAllocation() {
    state.error = null;

    try {
      if (!window.currentUser) {
        throw new Error(
          "Authenticated distributor context is required."
        );
      }

      const distributorId =
        window.currentUser.id;

      const evidence =
        await readEvidence(distributorId);

      const candidates =
        generateCandidates(
          evidence,
          distributorId
        );

      state.candidates = candidates;

      renderAllocationRuntime(
        candidates,
        evidence
      );

      window.goodsbarnxAllocationCandidates =
        candidates;

      return candidates;

    } catch (error) {
      console.error(
        "GoodsbarnX V1.8.2.6 Allocation Runtime:",
        error
      );

      state.error =
        error?.message ||
        String(error);

      renderAllocationError(
        state.error
      );

      return [];
    }
  }

  // ------------------------------------------------------------------------
  // UI
  // ------------------------------------------------------------------------

  function ensureAllocationContainer() {
    let container =
      document.getElementById(
        "depletor-allocation-runtime"
      );

    if (container) {
      return container;
    }

    const opportunities =
      document.getElementById(
        "depletor-opportunities"
      );

    if (!opportunities) {
      return null;
    }

    container =
      document.createElement("section");

    container.id =
      "depletor-allocation-runtime";

    container.className =
      "depletor-section";

    opportunities.insertAdjacentElement(
      "afterend",
      container
    );

    return container;
  }

  function renderAllocationRuntime(
    candidates,
    evidence
  ) {
    const container =
      ensureAllocationContainer();

    if (!container) {
      return;
    }

    const ready =
      candidates.filter(
        candidate =>
          candidate.routeStatus === "READY"
      );

    const blocked =
      candidates.filter(
        candidate =>
          candidate.routeStatus === "BLOCKED"
      );

    const allocatableUnits =
      ready.reduce(
        (sum, candidate) =>
          sum +
          (numeric(
            candidate.allocatableQuantity
          ) || 0),
        0
      );

    const relationshipMissing =
      blocked.filter(
        candidate =>
          candidate.blockReason ===
          "ACTIVE_PRIMARY_RELATIONSHIP_MISSING"
      ).length;

    container.innerHTML = `
      <div class="depletor-card">

        <div class="depletor-card-header">
          <div>
            <div class="depletor-eyebrow">
              V1.8.2.6 · ALLOCATION & ROUTING RUNTIME
            </div>

            <h3>
              Evidence-backed fulfillment paths
            </h3>

            <p>
              Allocation is permitted only when
              stock, demand, buyer identity and
              canonical relationship evidence align.
            </p>
          </div>

          <div class="depletor-runtime-version">
            ${esc(VERSION)}
          </div>
        </div>

        <div class="depletor-metrics">

          <div class="depletor-metric">
            <strong>${candidates.length}</strong>
            <span>Candidates</span>
          </div>

          <div class="depletor-metric">
            <strong>${ready.length}</strong>
            <span>Ready</span>
          </div>

          <div class="depletor-metric">
            <strong>${blocked.length}</strong>
            <span>Blocked</span>
          </div>

          <div class="depletor-metric">
            <strong>${allocatableUnits}</strong>
            <span>Allocatable Units</span>
          </div>

          <div class="depletor-metric">
            <strong>${relationshipMissing}</strong>
            <span>Relationship Evidence Missing</span>
          </div>

        </div>

        <div class="depletor-runtime-boundary">
          <strong>Runtime boundary:</strong>

          Read-only.
          No allocation persisted.
          No stock depleted.
          No relationship activated.
          No order created.

          Accepted agent capacity is detected as
          evidence only; it is not silently selected
          as a route because the current inquiry
          schema does not provide explicit agent
          routing evidence.
        </div>

        <div class="depletor-allocation-list">

          ${
            candidates.length
              ? candidates
                  .map(renderCandidate)
                  .join("")
              : `
                <div class="depletor-empty">
                  No evidence-backed allocation
                  candidates were generated.
                </div>
              `
          }

        </div>

      </div>
    `;
  }

  function renderCandidate(candidate) {
    const statusClass =
      candidate.routeStatus === "READY"
        ? "ready"
        : "blocked";

    const routeLabel =
      candidate.routeStatus === "READY"
        ? "READY"
        : "BLOCKED";

    const relationshipText =
      candidate.relationshipId
        ? `Canonical relationship: ${esc(
            candidate.relationshipId
          )}`
        : "Canonical active primary relationship: missing";

    return `
      <article
        class="depletor-allocation-candidate ${statusClass}"
      >

        <div class="depletor-candidate-header">

          <div>
            <strong>
              ${esc(
                candidate.productName ||
                "Unnamed product"
              )}
            </strong>

            <span>
              Demand:
              ${esc(
                candidate.inquiryItem ||
                "Unspecified"
              )}
            </span>
          </div>

          <span class="depletor-route-status">
            ${routeLabel}
          </span>

        </div>

        <div class="depletor-candidate-grid">

          <div>
            <small>Requested</small>
            <strong>
              ${
                candidate.requestedQuantity ??
                "Unknown"
              }
            </strong>
          </div>

          <div>
            <small>Available</small>
            <strong>
              ${candidate.availableQuantity}
            </strong>
          </div>

          <div>
            <small>Allocatable</small>
            <strong>
              ${candidate.allocatableQuantity}
            </strong>
          </div>

          <div>
            <small>Score</small>
            <strong>
              ${candidate.opportunityScore}
            </strong>
          </div>

        </div>

        <div class="depletor-candidate-evidence">

          <div>
            <strong>Product-demand match</strong>
            <span>
              ${
                candidate.productMatch
                  ? "Verified"
                  : "Not verified"
              }
            </span>
          </div>

          <div>
            <strong>Buyer identity</strong>
            <span>
              ${
                candidate.buyerId
                  ? "Identified"
                  : "Missing"
              }
            </span>
          </div>

          <div>
            <strong>Relationship</strong>
            <span>
              ${relationshipText}
            </span>
          </div>

          <div>
            <strong>Route</strong>
            <span>
              ${
                candidate.routeType ===
                "DIRECT_BUYER"
                  ? "Direct buyer"
                  : "No authorized route"
              }
            </span>
          </div>

        </div>

        ${
          candidate.blockReason
            ? `
              <div class="depletor-block-reason">
                Block reason:
                <strong>
                  ${esc(candidate.blockReason)}
                </strong>
              </div>
            `
            : `
              <div class="depletor-ready-reason">
                Authorized direct-buyer
                fulfillment path verified by
                current evidence.
              </div>
            `
        }

      </article>
    `;
  }

  function renderAllocationError(message) {
    const container =
      ensureAllocationContainer();

    if (!container) {
      return;
    }

    container.innerHTML = `
      <div class="depletor-card">

        <div class="depletor-eyebrow">
          V1.8.2.6 · ALLOCATION & ROUTING RUNTIME
        </div>

        <h3>
          Runtime could not execute
        </h3>

        <p>
          ${esc(message)}
        </p>

      </div>
    `;
  }

  // ------------------------------------------------------------------------
  // Public API
  // ------------------------------------------------------------------------

  window.GoodsbarnXDepletorAllocation = {
    version: VERSION,
    refresh: refreshDepletorAllocation,
    getState: function () {
      return {
        version: VERSION,
        candidates: state.candidates,
        error: state.error
      };
    }
  };

  window.refreshDepletorAllocation =
    refreshDepletorAllocation;

  window.goodsbarnxAllocationCandidates =
    state.candidates;

  // ------------------------------------------------------------------------
  // Automatic execution
  // ------------------------------------------------------------------------

  function boot() {
    if (!window.sb) {
      return;
    }

    if (!window.currentUser) {
      return;
    }

    refreshDepletorAllocation();
  }

  if (
    document.readyState ===
    "loading"
  ) {
    document.addEventListener(
      "DOMContentLoaded",
      boot,
      { once: true }
    );
  } else {
    boot();
  }

})();
