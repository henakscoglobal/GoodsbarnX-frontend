/* ==========================================================================
   GoodsbarnX — js/depletor-opportunity.js
   Master Stock Depletor · Stage 3 — Opportunity Engine (Canon §20) +
   Opportunity States & Blockers (Canon §21) + Canonical Opportunity Object
   (Canon §30).

   Version: V1.8.2.6
   Load position: 10 (per D13). Loads after js/depletor-radar.js, before
   js/depletor-allocation.js.

   Canon basis:
     §14  pipeline stage 3 of 7.
     §20  opportunity combines stock + demand + relationship + commercial
          compatibility + timing + route. Each opportunity explains WHAT,
          WHO, WHERE, WHY, WHO CAN MOVE IT, RELATIONSHIP, QUANTITY, URGENCY,
          NEXT ACTION.
     §21  lifecycle: DISCOVERED → EVIDENCE-BACKED → RELATIONSHIP-READY →
          ROUTING-READY → ALLOCATED → IN-MOTION → DEPLETED.
          Blockers: MISSING BUYER, MISSING RELATIONSHIP, MISSING QUANTITY,
          MISSING STOCK, MISSING ROUTE, MISSING COMMERCIAL TERMS.
          The engine never converts missing evidence into assumptions.
     §29  evidence integrity — every opportunity field is traceable.
     §30  canonical object fields.

   This file does NOT:
     - read the database. It composes §15 and §17 snapshots.
     - render UI.
     - score for urgency (that is §22).
     - allocate (that is §22).
     - claim ALLOCATED / IN-MOTION / DEPLETED (those are §22 / §24).

   Snapshot shape returned by run(stockSnapshot, radarSnapshot):
     { stage, rows, summary, evidence, generatedAt }
   where rows is an array of Canon §30 Opportunity objects.
   ========================================================================== */

(function () {
  "use strict";

  var VERSION = "V1.8.2.6";
  var STAGE = "opportunity_engine";

  // Canon §21 lifecycle — the subset reachable in this stage.
  var STATE_DISCOVERED          = "DISCOVERED";
  var STATE_EVIDENCE_BACKED     = "EVIDENCE-BACKED";
  var STATE_RELATIONSHIP_READY  = "RELATIONSHIP-READY";
  var STATE_ROUTING_READY       = "ROUTING-READY";

  // Canon §21 blocker codes.
  var BLOCK_MISSING_BUYER              = "MISSING BUYER";
  var BLOCK_MISSING_RELATIONSHIP       = "MISSING RELATIONSHIP";
  var BLOCK_MISSING_QUANTITY           = "MISSING QUANTITY";
  var BLOCK_MISSING_STOCK              = "MISSING STOCK";
  var BLOCK_MISSING_ROUTE              = "MISSING ROUTE";
  var BLOCK_MISSING_COMMERCIAL_TERMS   = "MISSING COMMERCIAL TERMS";

  // ------------------------------------------------------------------------
  // SMALL HELPERS
  // ------------------------------------------------------------------------

  function nowIso() { return new Date().toISOString(); }

  function isNonEmptyString(v) {
    return typeof v === "string" && v.length > 0;
  }

  function isPositiveNumber(v) {
    var n = Number(v);
    return isFinite(n) && n > 0;
  }

  // Deterministic, evidence-derived key. Not a UUID; used only for in-memory
  // identity and to detect duplicates across the snapshot. Real persistent
  // identifiers are assigned by whichever server-side writer consumes this
  // object in a later phase.
  function deriveKey(inquiryId, productId, buyerId) {
    return [
      String(inquiryId || ""),
      String(productId || ""),
      String(buyerId || "no-buyer")
    ].join("::");
  }

  // ------------------------------------------------------------------------
  // BLOCKER CONSTRUCTION (Canon §21)
  //
  // Every blocker carries a code, a human-readable reason, and the evidence
  // that produced it. When a blocker's evidence is absent, it is not emitted —
  // the corresponding evidence state is recorded in the opportunity's
  // evidence block instead, so a reviewer can tell the difference between
  // "blocker confirmed" and "blocker not evaluated".
  // ------------------------------------------------------------------------

  function computeBlockers(e) {
    var blockers = [];

    if (!e.buyer_identity_present) {
      blockers.push({
        code: BLOCK_MISSING_BUYER,
        reason: "Inquiry has no attributable buyer_id and no resolvable buyer identity.",
        evidence: { buyer_id: e.buyer_id }
      });
    }

    if (!e.active_primary_relationship_present) {
      blockers.push({
        code: BLOCK_MISSING_RELATIONSHIP,
        reason: e.relationship_state === "relationship_gap"
          ? "Buyer has no trade relationship with this distributor."
          : e.relationship_state === "present_not_active"
            ? "Buyer has a trade relationship but it is not active."
            : "Buyer has no active primary relationship with this distributor.",
        evidence: {
          relationship_id: e.relationship_id,
          relationship_status: e.relationship_status,
          relationship_state: e.relationship_state
        }
      });
    }

    if (!e.requested_quantity_known) {
      blockers.push({
        code: BLOCK_MISSING_QUANTITY,
        reason: "Inquiry quantity is zero, empty, or not numeric.",
        evidence: { demanded_quantity: e.demanded_quantity }
      });
    }

    if (!e.stock_available) {
      blockers.push({
        code: BLOCK_MISSING_STOCK,
        reason: "Matched stock position has zero or negative available quantity.",
        evidence: { stock_quantity: e.stock_quantity }
      });
    }

    if (!e.product_demand_match) {
      blockers.push({
        code: BLOCK_MISSING_ROUTE,
        reason: "No product in the distributor's stock matches this demand under the token-overlap heuristic.",
        evidence: { product_match_basis: e.product_match_basis }
      });
    }

    // MISSING COMMERCIAL TERMS is emitted only when commercial-terms evidence
    // was actually consulted. At this stage, trade terms are not read (that
    // is §22 / §31). If a future stage supplies terms state into this file,
    // the blocker activates. Until then, the state is recorded as
    // "not_consulted" in the opportunity's evidence block.
    if (e.commercial_terms_state === "missing") {
      blockers.push({
        code: BLOCK_MISSING_COMMERCIAL_TERMS,
        reason: "Commercial terms were consulted and are absent for this relationship.",
        evidence: e.commercial_terms_evidence || {}
      });
    }

    return blockers;
  }

  // ------------------------------------------------------------------------
  // CANON §21 LIFECYCLE
  //
  // The lifecycle is a strict progression. The state returned is the highest
  // state whose evidence is fully present, and it never advances past the
  // evidence. Later states (ALLOCATED, IN-MOTION, DEPLETED) are not
  // reachable from this stage.
  // ------------------------------------------------------------------------

  function classifyLifecycle(e) {
    // ROUTING-READY: all four pieces of routing evidence present, plus a
    // nonzero allocatable quantity is derivable.
    if (e.buyer_identity_present &&
        e.product_demand_match &&
        e.stock_available &&
        e.requested_quantity_known &&
        e.active_primary_relationship_present &&
        e.allocatable_quantity > 0) {
      return STATE_ROUTING_READY;
    }

    // RELATIONSHIP-READY: same as above minus the allocatable check.
    if (e.buyer_identity_present &&
        e.product_demand_match &&
        e.stock_available &&
        e.requested_quantity_known &&
        e.active_primary_relationship_present) {
      return STATE_RELATIONSHIP_READY;
    }

    // EVIDENCE-BACKED: product-demand match + quantity known + stock known,
    // but relationship not yet established.
    if (e.product_demand_match &&
        e.stock_available &&
        e.requested_quantity_known) {
      return STATE_EVIDENCE_BACKED;
    }

    // DISCOVERED: some evidence exists (a demand and a matched product),
    // but not enough to classify as EVIDENCE-BACKED.
    return STATE_DISCOVERED;
  }

  // ------------------------------------------------------------------------
  // EVIDENCE BUNDLE
  //
  // This is the Canon §29 evidence block. Every boolean in this bundle has
  // an observable counterpart in the snapshots that produced it. Nothing
  // here is inferred beyond what the source snapshots stated.
  // ------------------------------------------------------------------------

  function buildEvidenceBundle(signal, stock, matchBasis) {
    var buyerId = signal.buyer_id || null;

    var relationshipEvidence = signal.relationship_evidence || {};
    var relationshipRow = relationshipEvidence.present
      ? {
          relationship_id: relationshipEvidence.relationship_id,
          status: relationshipEvidence.status
        }
      : null;

    var relationshipState;
    if (relationshipEvidence.present && String(relationshipEvidence.status || "").toLowerCase() === "active") {
      relationshipState = "active_primary";
    } else if ((relationshipEvidence.rows || []).length > 0) {
      relationshipState = "present_not_active";
    } else if (buyerId) {
      relationshipState = "relationship_gap";
    } else {
      relationshipState = "buyer_unattributed";
    }

    var requested = Number(signal.quantity) || 0;
    var available = Number(stock.stock_quantity) || 0;

    var allocatable = 0;
    var buyerIdentityPresent = isNonEmptyString(buyerId);
    var activePrimaryPresent =
      relationshipState === "active_primary";
    var productDemandMatch = true; // this opportunity only exists because a match occurred
    var stockAvailable = available > 0;
    var requestedQuantityKnown = requested > 0;

    if (buyerIdentityPresent &&
        activePrimaryPresent &&
        productDemandMatch &&
        stockAvailable &&
        requestedQuantityKnown) {
      allocatable = Math.min(available, requested);
    }

    return {
      // Routing-relevant booleans.
      buyer_identity_present:              buyerIdentityPresent,
      active_primary_relationship_present: activePrimaryPresent,
      product_demand_match:                productDemandMatch,
      stock_available:                     stockAvailable,
      requested_quantity_known:            requestedQuantityKnown,

      // Canon §21 lifecycle inputs.
      relationship_state:                  relationshipState,
      relationship_id:                     relationshipRow ? relationshipRow.relationship_id : null,
      relationship_status:                 relationshipRow ? relationshipRow.status : null,

      // Product match basis (labelled heuristic, per §29).
      product_match_basis:                 matchBasis,

      // Raw values (evidence, not decisions).
      buyer_id:                            buyerId,
      demanded_quantity:                   requested,
      stock_quantity:                      available,
      allocatable_quantity:                allocatable,

      // Commercial-terms state.
      //   "not_consulted" — §31 trade terms have not been read at this stage.
      //   "present"       — §31 trade terms are present (set by a later stage).
      //   "missing"       — §31 trade terms were consulted and are absent.
      //   "not_applicable"— no relationship exists, so terms cannot apply.
      commercial_terms_state: relationshipState === "active_primary"
        ? "not_consulted"
        : "not_applicable",
      commercial_terms_evidence: null,

      // §16 stock health from the stock snapshot, carried forward.
      stock_health:          stock.health || null,
      stock_health_reason:   stock.health_reason || null,
      stock_health_basis:    stock.health_basis || null,

      // §18 demand strength from the radar snapshot, carried forward.
      demand_strength:         signal.demand_strength || null,
      demand_strength_reasons: signal.demand_strength_reasons || [],

      // The evidence classes from the radar signal (unchanged; carried for
      // the reviewer without being re-summarised).
      source_evidence: {
        explicit:     signal.explicit_evidence || null,
        behaviour:    signal.behaviour_evidence || null,
        relationship: signal.relationship_evidence || null,
        historical:   signal.historical_evidence || null
      }
    };
  }

  // ------------------------------------------------------------------------
  // BUILD ONE CANON §30 OPPORTUNITY
  // ------------------------------------------------------------------------

  function buildOpportunity(signal, stock, stockSnapshotAvailable, generatedAt) {
    var buyerId = signal.buyer_id || null;
    var evidence = buildEvidenceBundle(signal, stock, signal.product_match_basis);
    var lifecycle = classifyLifecycle(evidence);
    var blockers = computeBlockers(evidence);

    var opportunityId = deriveKey(signal.inquiry_id, stock.product_id, buyerId);

    // §20's WHAT / WHO / WHERE / WHY / WHO CAN MOVE IT / RELATIONSHIP /
    // QUANTITY / URGENCY / NEXT ACTION, expressed as first-class fields.
    // URGENCY and NEXT ACTION are finalized by §22; here they are provisional
    // and named as such.
    return {
      // --- Canon §30 canonical fields ---
      id:                 opportunityId,             // stable in-memory key; server assigns real ids in a later phase
      product_id:         stock.product_id,
      distributor_id:     stock.distributor_id,
      buyer_id:           buyerId,
      inquiry_id:         signal.inquiry_id,
      relationship_id:    evidence.relationship_id,

      stock_quantity:     evidence.stock_quantity,
      demanded_quantity:  evidence.demanded_quantity,

      demand_evidence:    evidence.source_evidence,
      relationship_state: evidence.relationship_state,

      // commercial_fit: not finalized at this stage. §31 pricing is read by §22.
      commercial_fit:     null,

      // route_state: alias of the lifecycle, provided so downstream code
      // and UI do not need to know both names. Kept identical to
      // opportunity_state for §29 honesty (no second, differently-computed
      // route signal).
      route_state:        lifecycle === STATE_ROUTING_READY ? "READY"
                          : lifecycle === STATE_RELATIONSHIP_READY ? "RELATIONSHIP_READY"
                          : lifecycle === STATE_EVIDENCE_BACKED ? "EVIDENCE_BACKED"
                          : "DISCOVERED",

      opportunity_state:  lifecycle,
      depletion_priority: null,   // §22 owns this

      // Blocker set (Canon §21) — structured, not a string.
      blockers:           blockers,

      // next_action is §22's; provisionally null with a named producer.
      next_action:        null,
      next_action_owner:  "js/depletor-allocation.js (§22)",

      created_at:         generatedAt,
      updated_at:         generatedAt,

      // --- §20 explanatory fields (not in §30 but required by §20) ---
      what:               stock.name || null,
      who:                buyerId ? { buyer_id: buyerId } : null,
      where: {
        distributor_id:   stock.distributor_id,
        distributor_name: null,   // populated by §22 if relationship terms are joined
        category:         stock.category || null
      },
      why: {
        demand_strength:         signal.demand_strength || null,
        demand_strength_reasons: signal.demand_strength_reasons || [],
        product_match_basis:     signal.product_match_basis || null
      },
      who_can_move_it: {
        // §20 asks "distributor / agent". This stage records what is known:
        // an accepted agent exists per the §15 snapshot if the agent list was
        // passed in. If not, it is null with a named producer.
        agent_id:   null,
        note:       "Agent routing is finalized by §22 once agent_distributor_attachments are joined."
      },

      // Full evidence block (Canon §29).
      evidence: evidence,

      // Provenance of this opportunity's production.
      produced_by: {
        stage:         STAGE,
        version:       VERSION,
        stock_snapshot_available: stockSnapshotAvailable,
        generated_at:  generatedAt
      }
    };
  }

  // ------------------------------------------------------------------------
  // DEDUPLICATION
  //
  // A given (inquiry, product, buyer) triple can appear more than once only
  // if the radar emitted duplicate signals. Deduplicate by `id`, keeping the
  // first occurrence. This is a data-quality guard, not a scoring decision.
  // ------------------------------------------------------------------------

  function dedupe(opportunities) {
    var seen = Object.create(null);
    var out = [];
    opportunities.forEach(function (o) {
      if (seen[o.id]) return;
      seen[o.id] = true;
      out.push(o);
    });
    return out;
  }

  // ------------------------------------------------------------------------
  // STAGE RUN
  // ------------------------------------------------------------------------

  function run(stockSnapshot, radarSnapshot) {
    var generatedAt = nowIso();
    var stockRows = (stockSnapshot && stockSnapshot.rows) || [];
    var signals = (radarSnapshot && radarSnapshot.rows) || [];

    var stockAvailable = !!stockSnapshot;
    var radarAvailable = !!radarSnapshot;

    var stockById = Object.create(null);
    stockRows.forEach(function (p) { stockById[p.product_id] = p; });

    var opportunities = [];

    signals.forEach(function (signal) {
      var matchedProductIds = signal.product_matches || [];
      matchedProductIds.forEach(function (pid) {
        var stock = stockById[pid];
        if (!stock) return; // stock snapshot did not contain this product; skip
        opportunities.push(buildOpportunity(signal, stock, stockAvailable, generatedAt));
      });
    });

    opportunities = dedupe(opportunities);

    // Stable sort: ROUTING-READY first, then RELATIONSHIP-READY, then
    // EVIDENCE-BACKED, then DISCOVERED. Within a state, more blockers last.
    // This is not a scoring decision; it is a display-order convention for
    // downstream consumers, and it is declared here so the convention lives
    // in one place.
    var order = {
      "ROUTING-READY": 0,
      "RELATIONSHIP-READY": 1,
      "EVIDENCE-BACKED": 2,
      "DISCOVERED": 3
    };
    opportunities.sort(function (a, b) {
      var oa = order[a.opportunity_state] != null ? order[a.opportunity_state] : 99;
      var ob = order[b.opportunity_state] != null ? order[b.opportunity_state] : 99;
      if (oa !== ob) return oa - ob;
      return (a.blockers.length - b.blockers.length);
    });

    // Summary.
    var byState = {
      "DISCOVERED": 0,
      "EVIDENCE-BACKED": 0,
      "RELATIONSHIP-READY": 0,
      "ROUTING-READY": 0
    };
    var blockerCounts = Object.create(null);
    opportunities.forEach(function (o) {
      if (byState[o.opportunity_state] != null) byState[o.opportunity_state]++;
      o.blockers.forEach(function (b) {
        blockerCounts[b.code] = (blockerCounts[b.code] || 0) + 1;
      });
    });

    return {
      stage: STAGE,
      version: VERSION,
      generatedAt: generatedAt,
      rows: opportunities,
      summary: {
        opportunityCount: opportunities.length,
        byState:          byState,
        blockerCounts:    blockerCounts
      },
      evidence: {
        stock_snapshot_available: stockAvailable,
        radar_snapshot_available: radarAvailable,
        stock_rows:               stockRows.length,
        signal_rows:              signals.length,
        note: "Opportunity construction reads no database directly; it composes the §15 and §17 snapshots."
      }
    };
  }

  // ------------------------------------------------------------------------
  // EXPORTS
  // ------------------------------------------------------------------------

  window.goodsbarnxDepletorOpportunity = {
    version: VERSION,
    stage: STAGE,
    run: run
  };

  console.log("[GoodsbarnX] depletor-opportunity.js loaded (" + VERSION + ")");
})();
