// ==========================================================================
// GoodsbarnX — Master Stock Depletor
// V1.8.2.6 — Allocation & Routing Runtime
//
// PURPOSE
// -------
// Converts validated Master Stock Depletor opportunities into
// evidence-backed allocation candidates.
//
// PIPELINE
// --------
// Opportunity
//      ↓
// Evidence Validation
//      ↓
// Allocation Candidate
//      ↓
// Relationship Route
//      ↓
// Execution Handoff
//
// IMPORTANT
// ---------
// • READ-ONLY
// • No stock mutation
// • No order creation
// • No fake opportunity IDs
// • No buyer assignment without evidence
// • No relationship bypass
// • No agent routing without explicit routing evidence
//
// ARCHITECTURE
// ------------
// This file runs in the browser and uses the existing global Supabase
// client `sb` supplied by js/config.js.
//
// ==========================================================================

(function () {
  "use strict";

  const VERSION = "V1.8.2.6";

  // ------------------------------------------------------------------------
  // Runtime state
  // ------------------------------------------------------------------------

  const state = {
    candidates: [],
    error: null
  };

  // ------------------------------------------------------------------------
  // Utility helpers
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
    return String(value || "")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean);
  }

  function linked(inquiryItem, productName) {
    const inquiryTokens = tokens(inquiryItem);
    const productTokens = tokens(productName);

    if (!inquiryTokens.length || !productTokens.length) {
      return false;
    }

    return inquiryTokens.some(token =>
      productTokens.includes(token)
    );
  }

  function ageHours(createdAt) {
    if (!createdAt) return Infinity;

    const created = new Date(createdAt).getTime();

    if (!Number.isFinite(created)) {
      return Infinity;
    }

    return Math.max(
      0,
      (Date.now() - created) / (1000 * 60 * 60)
    );
  }

  // ------------------------------------------------------------------------
  // Opportunity score
  // ------------------------------------------------------------------------
  //
  // Score is deliberately evidence-based.
  //
  // Product-demand match       +40
  // Stock available            +25
  // Quantity known             +20
  // Stock covers demand         +5
  // Demand freshness            +2/+6/+10
  //
  // ------------------------------------------------------------------------

  function score({
    matched,
    stockAvailable,
    quantityKnown,
    stockCovers,
    freshnessHours
  }) {
    let total = 0;

    if (matched) total += 40;
    if (stockAvailable) total += 25;
    if (quantityKnown) total += 20;
    if (stockCovers) total += 5;

    if (freshnessHours <= 24) {
      total += 10;
    } else if (freshnessHours <= 72) {
      total += 6;
    } else if (freshnessHours <= 168) {
      total += 2;
    }

    return total;
  }

  function tier({
    matched,
    stockAvailable,
    opportunityScore
  }) {
    if (
      matched &&
      stockAvailable &&
      opportunityScore >= 75
    ) {
      return "ACT NOW";
    }

    if (matched && stockAvailable) {
      return "READY";
    }

    if (matched) {
      return "WATCH";
    }

    if (!stockAvailable) {
      return "RESTOCK";
    }

    return "MONITOR";
  }

  // ------------------------------------------------------------------------
  // Relationship validation
  // ------------------------------------------------------------------------

  function activeRelationship(
    buyerId,
    relationships
  ) {
    if (!buyerId) {
      return null;
    }

    return (
      relationships.find(
        relationship =>
          relationship.buyer_id === buyerId &&
          relationship.status === "active" &&
          relationship.is_primary === true
      ) || null
    );
  }

  // ------------------------------------------------------------------------
  // Determine why an allocation cannot proceed
  // ------------------------------------------------------------------------

  function blockReason({
    matched,
    stockAvailable,
    quantityKnown,
    buyerId,
    relationship
  }) {
    if (!matched) {
      return "No product-demand match";
    }

    if (!stockAvailable) {
      return "No available stock";
    }

    if (!quantityKnown) {
      return "Demand quantity unavailable";
    }

    if (!buyerId) {
      return "Buyer identity unavailable";
    }

    if (!relationship) {
      return "No active primary relationship";
    }

    return null;
  }

  // ------------------------------------------------------------------------
  // Read authoritative evidence
  // ------------------------------------------------------------------------

  async function readEvidence() {
    if (
      typeof sb === "undefined" ||
      !sb ||
      typeof sb.from !== "function"
    ) {
      throw new Error(
        "Supabase client `sb` is not available."
      );
    }

    if (!window.currentUser || !window.currentUser.id) {
      throw new Error(
        "Authenticated distributor context is unavailable."
      );
    }

    const distributorId = window.currentUser.id;

    // ----------------------------------------------------------------------
    // Products / Stock
    // ----------------------------------------------------------------------

    const {
      data: products,
      error: productsError
    } = await sb
      .from("products")
      .select(
        "id,name,price,stock_quantity,status,category"
      )
      .eq("distributor_id", distributorId);

    if (productsError) {
      throw productsError;
    }

    // ----------------------------------------------------------------------
    // Demand / Inquiries
    // ----------------------------------------------------------------------

    const {
      data: inquiries,
      error: inquiriesError
    } = await sb
      .from("inquiries")
      .select(
        "id,item,quantity,status,created_at,buyer_id,distributor_id,inquirer_id"
      )
      .eq("distributor_id", distributorId)
      .order("created_at", {
        ascending: false
      });

    if (inquiriesError) {
      throw inquiriesError;
    }

    // ----------------------------------------------------------------------
    // Canonical relationships
    // ----------------------------------------------------------------------

    const {
      data: relationships,
      error: relationshipsError
    } = await sb
      .from("trade_relationships")
      .select(
        "id,buyer_id,distributor_id,status,is_primary"
      )
      .eq("distributor_id", distributorId);

    if (relationshipsError) {
      throw relationshipsError;
    }

    // ----------------------------------------------------------------------
    // Accepted agent attachments
    // ----------------------------------------------------------------------

    const {
      data: agentAttachments,
      error: agentError
    } = await sb
      .from("agent_distributor_attachments")
      .select(
        "id,agent_id,status"
      )
      .eq("distributor_id", distributorId)
      .eq("status", "accepted");

    if (agentError) {
      throw agentError;
    }

    return {
      distributorId,
      products: products || [],
      inquiries: inquiries || [],
      relationships: relationships || [],
      agentAttachments: agentAttachments || []
    };
  }

  // ------------------------------------------------------------------------
  // Build allocation candidates
  // ------------------------------------------------------------------------

  function buildCandidates(evidence) {
    const {
      distributorId,
      products,
      inquiries,
      relationships,
      agentAttachments
    } = evidence;

    const openInquiries = inquiries.filter(
      inquiry =>
        inquiry.status === "open" ||
        inquiry.status === "pending"
    );

    const candidates = [];

    for (const inquiry of openInquiries) {
      for (const product of products) {
        const matched = linked(
          inquiry.item,
          product.name
        );

        if (!matched) {
          continue;
        }

        const requestedQuantity =
          Number(inquiry.quantity) || 0;

        const availableQuantity =
          Number(product.stock_quantity) || 0;

        const stockAvailable =
          availableQuantity > 0;

        const quantityKnown =
          requestedQuantity > 0;

        const stockCovers =
          quantityKnown &&
          availableQuantity >= requestedQuantity;

        const buyerId =
          inquiry.buyer_id || null;

        const relationship =
          activeRelationship(
            buyerId,
            relationships
          );

        const freshnessHours =
          ageHours(inquiry.created_at);

        const opportunityScore =
          score({
            matched,
            stockAvailable,
            quantityKnown,
            stockCovers,
            freshnessHours
          });

        const opportunityTier =
          tier({
            matched,
            stockAvailable,
            opportunityScore
          });

        const reason =
          blockReason({
            matched,
            stockAvailable,
            quantityKnown,
            buyerId,
            relationship
          });

        // ------------------------------------------------------------------
        // Allocation is only considered executable when ALL critical
        // evidence exists.
        // ------------------------------------------------------------------

        const allocatableQuantity =
          matched &&
          stockAvailable &&
          quantityKnown &&
          buyerId &&
          relationship
            ? Math.min(
                requestedQuantity,
                availableQuantity
              )
            : 0;

        const ready =
          allocatableQuantity > 0;

        // ------------------------------------------------------------------
        // Routing rule
        // ------------------------------------------------------------------
        //
        // Direct buyer routing is authoritative when the inquiry already
        // identifies a buyer and that buyer has an active primary
        // relationship with the distributor.
        //
        // Accepted agents are detected as network capacity, but are NOT
        // silently selected because the inquiry schema does not currently
        // provide explicit agent-routing evidence.
        // ------------------------------------------------------------------

        let routeType = "NONE";

        if (ready && relationship) {
          routeType = "DIRECT_BUYER";
        }

        const routeStatus =
          ready
            ? "READY"
            : "BLOCKED";

        candidates.push({
          inquiryId: inquiry.id,

          productId: product.id,

          distributorId,

          buyerId,

          relationshipId:
            relationship
              ? relationship.id
              : null,

          agentId: null,

          requestedQuantity,

          availableQuantity,

          allocatableQuantity,

          opportunityScore,

          opportunityTier,

          routeType,

          routeStatus,

          evidence: {
            demandMatched: matched,

            stockAvailable,

            quantityKnown,

            stockCovers,

            buyerIdentified: !!buyerId,

            activePrimaryRelationship:
              !!relationship,

            acceptedAgentCapacity:
              agentAttachments.length > 0,

            demandAgeHours:
              Number.isFinite(freshnessHours)
                ? Number(
                    freshnessHours.toFixed(2)
                  )
                : null
          },

          blockReason: reason
        });
      }
    }

    // ----------------------------------------------------------------------
    // Ready candidates first.
    // Then highest opportunity score.
    // Then newest demand.
    // ----------------------------------------------------------------------

    candidates.sort((a, b) => {
      if (
        a.routeStatus !== b.routeStatus
      ) {
        return (
          a.routeStatus === "READY"
            ? -1
            : 1
        );
      }

      if (
        b.opportunityScore !==
        a.opportunityScore
      ) {
        return (
          b.opportunityScore -
          a.opportunityScore
        );
      }

      return (
        a.requestedQuantity -
        b.requestedQuantity
      );
    });

    return candidates;
  }

  // ------------------------------------------------------------------------
  // Render allocation section
  // ------------------------------------------------------------------------

  function renderCandidates(candidates) {
    const existing =
      document.getElementById(
        "depletor-allocation"
      );

    if (existing) {
      existing.remove();
    }

    const opportunities =
      document.getElementById(
        "depletor-opportunities"
      );

    if (!opportunities) {
      return;
    }

    const section =
      document.createElement("section");

    section.id =
      "depletor-allocation";

    section.className =
      "depletor-section";

    const readyCount =
      candidates.filter(
        candidate =>
          candidate.routeStatus === "READY"
      ).length;

    const blockedCount =
      candidates.filter(
        candidate =>
          candidate.routeStatus === "BLOCKED"
      ).length;

    section.innerHTML = `
      <div class="depletor-heading">
        <div>
          <span class="eyebrow">
            MASTER STOCK DEPLETOR
          </span>

          <h3>
            Allocation &amp; Routing
          </h3>

          <p>
            Evidence-backed fulfillment paths.
          </p>
        </div>

        <button
          type="button"
          id="depletor-allocation-refresh"
        >
          Refresh
        </button>
      </div>

      <div class="depletor-stock-meta">
        <span>
          ${esc(VERSION)}
        </span>

        <span>
          ${readyCount} ready
        </span>

        <span>
          ${blockedCount} blocked
        </span>
      </div>

      <div
        id="depletor-allocation-list"
        class="depletor-opportunities"
      ></div>
    `;

    opportunities.insertAdjacentElement(
      "afterend",
      section
    );

    const list =
      section.querySelector(
        "#depletor-allocation-list"
      );

    if (!candidates.length) {
      list.innerHTML = `
        <div class="depletor-empty">
          <strong>
            No allocation candidates
          </strong>

          <p>
            No open demand currently has
            evidence-backed product matching.
          </p>
        </div>
      `;

      return;
    }

    list.innerHTML =
      candidates
        .map(candidate => {
          const ready =
            candidate.routeStatus === "READY";

          const statusClass =
            ready
              ? "stock-healthy"
              : "stock-attention";

          const routeText =
            ready
              ? "DIRECT BUYER ROUTE"
              : "ROUTE BLOCKED";

          const detail =
            ready
              ? `${candidate.allocatableQuantity} units allocatable`
              : candidate.blockReason;

          return `
            <article
              class="opportunity ${statusClass}"
            >
              <div class="op-icon">
                ${ready ? "→" : "!"}
              </div>

              <div class="op-copy">

                <div class="op-name">
                  ${esc(
                    candidate.routeType ||
                    "Allocation Candidate"
                  )}
                </div>

                <div class="op-detail">
                  ${esc(detail)}
                </div>

                <div class="op-detail">
                  Product:
                  ${esc(candidate.productId)}
                </div>

                <div class="op-detail">
                  Inquiry:
                  ${esc(candidate.inquiryId)}
                </div>

                <div class="op-detail">
                  Relationship:
                  ${esc(
                    candidate.relationshipId ||
                    "None"
                  )}
                </div>

                <div class="op-detail">
                  Score:
                  ${esc(candidate.opportunityScore)}
                  ·
                  ${esc(candidate.opportunityTier)}
                </div>

              </div>
            </article>
          `;
        })
        .join("");

    const refreshButton =
      section.querySelector(
        "#depletor-allocation-refresh"
      );

    if (refreshButton) {
      refreshButton.addEventListener(
        "click",
        () => {
          refreshAllocationRuntime();
        }
      );
    }
  }

  // ------------------------------------------------------------------------
  // Runtime refresh
  // ------------------------------------------------------------------------

  async function refreshAllocationRuntime() {
    state.error = null;

    try {
      const evidence =
        await readEvidence();

      state.candidates =
        buildCandidates(evidence);

      window.goodsbarnxAllocationCandidates =
        state.candidates;

      renderCandidates(
        state.candidates
      );

      return state.candidates;

    } catch (error) {
      console.error(
        `[GoodsbarnX ${VERSION}] Allocation runtime failed:`,
        error
      );

      state.error = error;

      const existing =
        document.getElementById(
          "depletor-allocation"
        );

      if (existing) {
        existing.remove();
      }

      const opportunities =
        document.getElementById(
          "depletor-opportunities"
        );

      if (opportunities) {
        const section =
          document.createElement("section");

        section.id =
          "depletor-allocation";

        section.className =
          "depletor-section";

        section.innerHTML = `
          <div class="depletor-heading">
            <div>
              <span class="eyebrow">
                MASTER STOCK DEPLETOR
              </span>

              <h3>
                Allocation &amp; Routing
              </h3>

              <p>
                Runtime could not validate
                allocation evidence.
              </p>
            </div>
          </div>

          <div class="depletor-empty">
            <strong>
              Evidence read failed
            </strong>

            <p>
              ${esc(
                error?.message ||
                "Unknown runtime error."
              )}
            </p>
          </div>
        `;

        opportunities.insertAdjacentElement(
          "afterend",
          section
        );
      }

      return [];
    }
  }

  // ------------------------------------------------------------------------
  // Public API
  // ------------------------------------------------------------------------

  window.refreshDepletorAllocation =
    refreshAllocationRuntime;

  window.goodsbarnxAllocationCandidates =
    state.candidates;

  window.goodsbarnxDepletorAllocationVersion =
    VERSION;

  // ------------------------------------------------------------------------
  // Boot
  // ------------------------------------------------------------------------

  function boot() {
    // Allow the existing GoodsbarnX application
    // initialization to establish currentUser first.

    setTimeout(() => {
      refreshAllocationRuntime();
    }, 1000);
  }

  if (
    document.readyState === "loading"
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
