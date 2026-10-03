/* ==========================================================================
   GoodsbarnX — js/depletor-depletion.js  (rev. 1)
   Master Stock Depletor · Stage 5 — Depletion Engine (Canon §24) +
   Depletion Feedback Loop (Canon §25).

   Version: V1.8.2.6
   Load position: 12 (per D13). Loads after js/depletor-allocation.js,
   before js/depletor-replenishment.js.

   rev. 1 — Phase 6 Step 1 / S2-i:
     The Phase 3 delivery read from a table named stock_movements which does
     not exist on the server. The authoritative movement record is
     public.depletion_executions, which is RLS-enabled default-deny. This
     revision reads via the new SECURITY DEFINER RPC
     get_depletion_observations(p_distributor_id, p_since), which returns
     the calling distributor's own ledger rows for a bounded window.

   Canon basis:
     §14  pipeline stage 5 of 7.
     §24  the engine observes whether intended depletion actually occurred.
          Predicted Depletion ≠ Actual Depletion. Actual movement becomes
          feedback.
     §25  feedback loop.
     §29  evidence integrity — depletion observation is observed evidence.
          If the RPC is unavailable, the outcome is PENDING with a named
          basis; the client does not fabricate an observation.

   Server dependencies:
     - public.depletion_executions (table; RLS default-deny; server-only)
     - public.get_depletion_observations(p_distributor_id uuid,
                                         p_since timestamptz) (RPC)

   This file does NOT:
     - write to the database.
     - render UI.
     - produce replenishment signals (§26).
   ========================================================================== */

(function () {
  "use strict";

  var VERSION = "V1.8.2.6";
  var STAGE = "depletion";

  var STATE_ALLOCATED = "ALLOCATED";
  var STATE_IN_MOTION = "IN-MOTION";
  var STATE_DEPLETED  = "DEPLETED";

  // Canon §24 outcome taxonomy.
  var OUTCOME_PENDING       = "PENDING";
  var OUTCOME_PARTIAL       = "PARTIAL";
  var OUTCOME_CONFIRMED     = "CONFIRMED";
  var OUTCOME_NOT_OBSERVED  = "NOT_OBSERVED";

  // Observation window. The RPC defaults to 90 days; the client asks for
  // 30 days to keep the read bounded to the opportunity set in flight.
  var OBSERVATION_WINDOW_DAYS = 30;
  var OBSERVATION_WINDOW_MS   = OBSERVATION_WINDOW_DAYS * 24 * 3600 * 1000;

  // ------------------------------------------------------------------------
  // SMALL HELPERS
  // ------------------------------------------------------------------------

  function nowIso() { return new Date().toISOString(); }

  function parseMs(v) {
    if (typeof v !== "string" || !v) return null;
    var t = new Date(v).getTime();
    return isFinite(t) ? t : null;
  }

  function num(v, fallback) {
    var n = Number(v);
    return isFinite(n) ? n : (fallback == null ? 0 : fallback);
  }

  function lower(v) { return String(v == null ? "" : v).toLowerCase(); }

  // ------------------------------------------------------------------------
  // STOCK MOVEMENT READ — via RPC (S2-i)
  //
  // Returns one of:
  //   { state: "AVAILABLE",  rows: [...], note: null }
  //   { state: "EMPTY",      rows: [],    note: null }
  //   { state: "S2_RPC_UNAVAILABLE", rows: [], note: "<error>" }
  //   { state: "NO_PRODUCTS", rows: [],   note: null }
  // ------------------------------------------------------------------------

  async function readDepletionObservations(userId, productIds) {
    if (!productIds.length) {
      return { state: "NO_PRODUCTS", rows: [], note: null };
    }

    if (!window.sb || typeof window.sb.rpc !== "function") {
      return {
        state: "S2_RPC_UNAVAILABLE",
        rows: [],
        note: "sb.rpc unavailable."
      };
    }

    var since = new Date(Date.now() - OBSERVATION_WINDOW_MS).toISOString();

    var r;
    try {
      r = await window.sb.rpc("get_depletion_observations", {
        p_distributor_id: userId,
        p_since: since
      });
    } catch (e) {
      return {
        state: "S2_RPC_UNAVAILABLE",
        rows: [],
        note: (e && e.message) || String(e)
      };
    }

    if (r && r.error) {
      return {
        state: "S2_RPC_UNAVAILABLE",
        rows: [],
        note: r.error.message || String(r.error)
      };
    }

    var payload = (r && r.data) || {};
    var raw = Array.isArray(payload.observations) ? payload.observations : [];

    // Defensive: only keep rows whose product_id is one of the requested
    // products. This mirrors the previous behaviour and guards against a
    // future RPC that returns a broader set.
    var wanted = Object.create(null);
    productIds.forEach(function (id) { wanted[id] = true; });

    var rows = raw
      .filter(function (o) { return o && wanted[o.product_id]; })
      .map(function (o) {
        return {
          id:                 o.id,
          idempotency_key:    o.idempotency_key,
          inquiry_id:         o.inquiry_id,
          product_id:         o.product_id,
          buyer_id:           o.buyer_id,
          relationship_id:    o.relationship_id,
          route_type:         o.route_type,
          requested_quantity: num(o.requested_quantity, 0),
          allocatable_quantity: num(o.allocatable_quantity, 0),
          stock_before:       num(o.stock_before, 0),
          stock_after:        num(o.stock_after, 0),
          status:             o.status,
          created_at:         o.created_at || null,
          completed_at:       o.completed_at || null,
          created_at_ms:      parseMs(o.created_at),
          // Observed depletion for this single movement = stock_before - stock_after.
          observed_quantity:  Math.max(0, num(o.stock_before, 0) - num(o.stock_after, 0))
        };
      });

    if (!rows.length) {
      return { state: "EMPTY", rows: [], note: null };
    }
    return { state: "AVAILABLE", rows: rows, note: null };
  }

  // ------------------------------------------------------------------------
  // OBSERVED DEPLETION FOR ONE OPPORTUNITY
  //
  // Sums observed_quantity across every movement whose (inquiry_id,
  // product_id) matches the opportunity and whose created_at falls inside
  // the opportunity's observation window. Movements outside the window are
  // ignored, matching the previous file's semantics.
  // ------------------------------------------------------------------------

  function observedDepletion(opportunity, movements) {
    var productId  = opportunity.product_id;
    var inquiryId  = opportunity.inquiry_id;
    var createdMs  = parseMs(opportunity.created_at) || Date.now();
    var windowEnd  = createdMs + OBSERVATION_WINDOW_MS;

    var relevant = movements.filter(function (m) {
      if (m.product_id !== productId) return false;
      if (m.inquiry_id !== inquiryId) return false;
      if (m.created_at_ms == null) return false;
      if (m.created_at_ms < createdMs) return false;
      if (m.created_at_ms > windowEnd) return false;
      return true;
    });

    var sum = 0;
    relevant.forEach(function (m) { sum += num(m.observed_quantity, 0); });

    return {
      observed_quantity: sum,
      movement_ids: relevant.map(function (m) { return m.id; }),
      window_start: new Date(createdMs).toISOString(),
      window_end:   new Date(windowEnd).toISOString(),
      window_ms:    OBSERVATION_WINDOW_MS
    };
  }

  // ------------------------------------------------------------------------
  // OUTCOME CLASSIFICATION — Canon §24
  //
  // Evidence-based. Never infers a confirmation from a non-observation.
  // ------------------------------------------------------------------------

  function classifyOutcome(predicted, observed, rpcState, windowClosed) {
    if (rpcState === "S2_RPC_UNAVAILABLE" || rpcState === "NO_PRODUCTS") {
      // The observation is not possible. Different from observed-zero.
      return {
        outcome: OUTCOME_PENDING,
        reason:  "Depletion observation RPC is unavailable; observation is not possible.",
        basis:   "S2_RPC_UNAVAILABLE"
      };
    }

    if (observed === 0) {
      if (windowClosed) {
        return {
          outcome: OUTCOME_NOT_OBSERVED,
          reason:  "Observation window elapsed with zero observed stock reduction.",
          basis:   "OBSERVED"
        };
      }
      return {
        outcome: OUTCOME_PENDING,
        reason:  "Observation window still open; no reduction observed yet.",
        basis:   "OBSERVED"
      };
    }

    if (observed >= predicted) {
      return {
        outcome: OUTCOME_CONFIRMED,
        reason:  "Observed reduction meets or exceeds predicted depletion.",
        basis:   "OBSERVED"
      };
    }

    return {
      outcome: OUTCOME_PARTIAL,
      reason:  "Observed reduction is less than predicted depletion.",
      basis:   "OBSERVED"
    };
  }

  // ------------------------------------------------------------------------
  // LIFECYCLE TRANSITION — Canon §21
  // ------------------------------------------------------------------------

  function advanceState(priorState, outcome) {
    if (priorState !== STATE_ALLOCATED) return priorState;
    if (outcome === OUTCOME_CONFIRMED) return STATE_DEPLETED;
    if (outcome === OUTCOME_PARTIAL)   return STATE_IN_MOTION;
    return priorState;
  }

  // ------------------------------------------------------------------------
  // LEARNING SIGNAL — Canon §25
  // ------------------------------------------------------------------------

  function buildLearningSignal(opportunity, predicted, observed, outcome, outcomeReason) {
    if (outcome === OUTCOME_PENDING) return null;

    return {
      product_id:        opportunity.product_id,
      distributor_id:    opportunity.distributor_id,
      buyer_id:          opportunity.buyer_id,
      inquiry_id:        opportunity.inquiry_id,
      relationship_id:   opportunity.relationship_id,

      predicted_quantity: predicted,
      observed_quantity:  observed,

      outcome:            outcome,
      outcome_reason:     outcomeReason,

      demand_strength:         opportunity.evidence && opportunity.evidence.demand_strength,
      demand_strength_reasons: opportunity.evidence && opportunity.evidence.demand_strength_reasons,

      commercial_fit_tier:     opportunity.commercial_fit && opportunity.commercial_fit.tier,

      recorded_at: nowIso()
    };
  }

  // ------------------------------------------------------------------------
  // BUILD ONE DEPLETION RECORD
  // ------------------------------------------------------------------------

  function buildDepletionRecord(opportunity, movements, rpcState) {
    var predicted = num(opportunity.allocatable_quantity, 0);
    var observed = observedDepletion(opportunity, movements);
    var windowClosed = Date.now() >= (parseMs(observed.window_end) || 0);

    var outcome = classifyOutcome(predicted, observed.observed_quantity, rpcState, windowClosed);
    var nextState = advanceState(opportunity.opportunity_state, outcome.outcome);

    var learningSignal = buildLearningSignal(
      opportunity,
      predicted,
      observed.observed_quantity,
      outcome.outcome,
      outcome.reason
    );

    return {
      // Canon §30 fields — carry forward unchanged.
      id:                 opportunity.id,
      product_id:         opportunity.product_id,
      distributor_id:     opportunity.distributor_id,
      buyer_id:           opportunity.buyer_id,
      inquiry_id:         opportunity.inquiry_id,
      relationship_id:    opportunity.relationship_id,

      stock_quantity:     opportunity.stock_quantity,
      demanded_quantity:  opportunity.demanded_quantity,

      demand_evidence:    opportunity.demand_evidence,
      relationship_state: opportunity.relationship_state,
      commercial_fit:     opportunity.commercial_fit,
      route_state:        opportunity.route_state,
      opportunity_state:  nextState,
      depletion_priority: opportunity.depletion_priority,
      blockers:           opportunity.blockers,
      next_action:        opportunity.next_action,
      created_at:         opportunity.created_at,
      updated_at:         nowIso(),

      what:               opportunity.what,
      who:                opportunity.who,
      where:              opportunity.where,
      why:                opportunity.why,
      who_can_move_it:    opportunity.who_can_move_it,
      allocatable_quantity: opportunity.allocatable_quantity,

      // §24 observation block.
      depletion: {
        predicted_quantity: predicted,
        observed_quantity:  observed.observed_quantity,
        outcome:            outcome.outcome,
        outcome_reason:     outcome.reason,
        outcome_basis:      outcome.basis,
        observation: {
          window_start:   observed.window_start,
          window_end:     observed.window_end,
          window_ms:      observed.window_ms,
          window_closed:  windowClosed,
          movement_ids:   observed.movement_ids,
          movement_count: observed.movement_ids.length
        }
      },

      evidence: Object.assign({}, opportunity.evidence, {
        s2_state:         rpcState,
        depletion_basis:  outcome.basis
      }),

      learning_signal: learningSignal,

      produced_by: {
        stage:        STAGE,
        version:      VERSION,
        generated_at: nowIso(),
        prior_stage:  opportunity.produced_by || null
      }
    };
  }

  // ------------------------------------------------------------------------
  // STAGE RUN
  // ------------------------------------------------------------------------

  async function run(allocationSnapshot) {
    var user = null;
    try { user = currentUser; } catch (e) {}
    if (!user || String(user.role || "").toLowerCase() !== "distributor") {
      throw new Error("AUTH_CONTEXT_UNAVAILABLE");
    }
    if (!window.sb || typeof window.sb.from !== "function") {
      throw new Error("SUPABASE_UNAVAILABLE");
    }

    var generatedAt = nowIso();

    var opportunities = (allocationSnapshot && allocationSnapshot.rows) || [];
    var allocationSnapshotAvailable = !!allocationSnapshot;

    var observableStates = [STATE_ALLOCATED, STATE_IN_MOTION, STATE_DEPLETED];
    var observable = opportunities.filter(function (o) {
      return observableStates.indexOf(o.opportunity_state) !== -1;
    });

    var productIds = observable.map(function (o) { return o.product_id; })
      .filter(Boolean)
      .filter(function (v, k, a) { return a.indexOf(v) === k; });

    var movementsRead = await readDepletionObservations(user.id, productIds);
    var movements = movementsRead.rows;

    var observedById = Object.create(null);
    observable.forEach(function (o) {
      observedById[o.id] = buildDepletionRecord(o, movements, movementsRead.state);
    });

    var out = opportunities.map(function (o) {
      return observedById[o.id] || o;
    });

    // Summary.
    var byState = Object.create(null);
    var byOutcome = { PENDING: 0, PARTIAL: 0, CONFIRMED: 0, NOT_OBSERVED: 0 };
    var learningSignalCount = 0;
    out.forEach(function (o) {
      byState[o.opportunity_state] = (byState[o.opportunity_state] || 0) + 1;
      if (o.depletion && byOutcome[o.depletion.outcome] != null) {
        byOutcome[o.depletion.outcome]++;
      }
      if (o.learning_signal) learningSignalCount++;
    });

    return {
      stage: STAGE,
      version: VERSION,
      generatedAt: generatedAt,
      rows: out,
      summary: {
        opportunityCount:    out.length,
        observableCount:     observable.length,
        byState:             byState,
        byOutcome:           byOutcome,
        learningSignals:     learningSignalCount
      },
      evidence: {
        allocation_snapshot_available: allocationSnapshotAvailable,
        movements_state:               movementsRead.state,
        movements_note:                movementsRead.note,
        movements_count:               movements.length,
        s2_source:                     "public.get_depletion_observations",
        s2_dependency_note:            "Canon §24 requires observed stock transitions. The authoritative source is public.depletion_executions, read via the SECURITY DEFINER RPC get_depletion_observations. If the RPC is unavailable, outcome is PENDING with basis S2_RPC_UNAVAILABLE and no lifecycle transition past ALLOCATED occurs."
      }
    };
  }

  // ------------------------------------------------------------------------
  // EXPORTS
  // ------------------------------------------------------------------------

  window.goodsbarnxDepletorDepletion = {
    version: VERSION,
    stage: STAGE,
    run: run
  };

  console.log("[GoodsbarnX] depletar-depletion.js loaded (" + VERSION + " rev.1)");
})();
