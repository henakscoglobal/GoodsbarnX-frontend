/* ==========================================================================
   GoodsbarnX — js/depletor-depletion.js
   Master Stock Depletor · Stage 5 — Depletion Engine (Canon §24) +
   Depletion Feedback Loop (Canon §25).

   Version: V1.8.2.6
   Load position: 12 (per D13). Loads after js/depletor-allocation.js,
   before js/depletor-replenishment.js.

   Canon basis:
     §14  pipeline stage 5 of 7.
     §24  the engine observes whether intended depletion actually occurred.
          Predicted Depletion ≠ Actual Depletion. Actual movement becomes
          feedback.
     §25  feedback loop: STOCK → DEMAND → OPPORTUNITY → ALLOCATION →
          ACTION → TRANSACTION → STOCK REDUCTION → OUTCOME → LEARNING →
          DEMAND RADAR.
     §29  evidence integrity — depletion observation is observed evidence,
          never inference. If S2 is unavailable, the outcome is PENDING
          (not CONFIRMED, not NOT_OBSERVED).

   Server dependency:
     S2  stock_movements table with at least:
           id              uuid
           product_id      uuid
           distributor_id  uuid
           delta_quantity  integer  (negative for reduction)
           reason          text      e.g. 'sale','adjustment','return'
           observed_at     timestamptz
         Populated by a server-side trigger on products.stock_quantity
         updates. The client never writes to stock_movements; it only reads.

   This file owns:
     - readStockMovements(): S2 read for the allocated products.
     - compare(): predicted vs actual for each opportunity.
     - classifyOutcome(): PENDING | PARTIAL | CONFIRMED | NOT_OBSERVED.
     - buildLearningSignal(): §25 evidence-only feedback.
     - run()                : returns the pipeline snapshot.

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
  var OUTCOME_PENDING       = "PENDING";       // no observation window yet, or S2 unavailable
  var OUTCOME_PARTIAL       = "PARTIAL";       // some but not all predicted depletion observed
  var OUTCOME_CONFIRMED     = "CONFIRMED";     // full predicted depletion observed
  var OUTCOME_NOT_OBSERVED  = "NOT_OBSERVED";  // observation window elapsed with zero delta

  // The observation window during which we consider a movement attributable
  // to a specific opportunity. Movements outside the window are not counted.
  // This is a policy constant, declared here so it can be cited.
  var OBSERVATION_WINDOW_MS = 30 * 24 * 3600 * 1000; // 30 days

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

  // ------------------------------------------------------------------------
  // STOCK MOVEMENT READ — Canon §24, server deliverable S2
  // ------------------------------------------------------------------------

  async function readStockMovements(userId, productIds) {
    if (!productIds.length) {
      return { state: "NO_PRODUCTS", rows: [], note: null };
    }

    // S2 table. If the table does not exist, Supabase returns an error; we
    // treat that as S2_UNAVAILABLE rather than a hard failure. The pipeline
    // continues with outcomes set to PENDING.
    var r = await sb
      .from("stock_movements")
      .select("id,product_id,distributor_id,delta_quantity,reason,observed_at")
      .eq("distributor_id", userId)
      .in("product_id", productIds)
      .order("observed_at", { ascending: false })
      .limit(1000);

    if (r.error) {
      return {
        state: "S2_UNAVAILABLE",
        note: "stock_movements read failed: " + r.error.message +
              " — server migration S2 has not been applied, or the caller " +
              "lacks SELECT on stock_movements.",
        rows: []
      };
    }

    var rows = (r.data || []).map(function (m) {
      return {
        id: m.id,
        product_id: m.product_id,
        delta_quantity: num(m.delta_quantity, 0),
        reason: m.reason || null,
        observed_at: m.observed_at || null,
        observed_at_ms: parseMs(m.observed_at)
      };
    });

    if (!rows.length) {
      return {
        state: "EMPTY",
        note: "No stock movements observed for these products yet.",
        rows: []
      };
    }

    return { state: "AVAILABLE", rows: rows, note: null };
  }

  // ------------------------------------------------------------------------
  // OBSERVED DEPLETION FOR ONE OPPORTUNITY
  //
  // Sums all negative deltas for the opportunity's product within the
  // observation window starting at the opportunity's created_at.
  // Positive deltas are excluded — they represent replenishment, not
  // depletion, and counting them would misstate observed movement.
  // ------------------------------------------------------------------------

  function observedDepletion(opportunity, movements) {
    var productId = opportunity.product_id;
    var createdMs = parseMs(opportunity.created_at) || Date.now();
    var windowEnd = createdMs + OBSERVATION_WINDOW_MS;

    var relevant = movements.filter(function (m) {
      if (m.product_id !== productId) return false;
      if (m.observed_at_ms == null) return false;
      if (m.observed_at_ms < createdMs) return false;
      if (m.observed_at_ms > windowEnd) return false;
      if (m.delta_quantity >= 0) return false; // only reductions count as depletion
      return true;
    });

    var sum = 0;
    relevant.forEach(function (m) { sum += Math.abs(m.delta_quantity); });

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

  function classifyOutcome(predicted, observed, s2State, windowClosed) {
    if (s2State !== "AVAILABLE" && s2State !== "EMPTY") {
      // S2 is not available. We cannot observe. This is not "not observed" —
      // it is "not observable". Different state.
      return {
        outcome: OUTCOME_PENDING,
        reason: "S2 unavailable; observation is not possible.",
        basis: "S2_UNAVAILABLE"
      };
    }

    if (observed === 0) {
      if (windowClosed) {
        return {
          outcome: OUTCOME_NOT_OBSERVED,
          reason: "Observation window elapsed with zero observed stock reduction.",
          basis: "OBSERVED"
        };
      }
      return {
        outcome: OUTCOME_PENDING,
        reason: "Observation window still open; no reduction observed yet.",
        basis: "OBSERVED"
      };
    }

    if (observed >= predicted) {
      return {
        outcome: OUTCOME_CONFIRMED,
        reason: "Observed reduction meets or exceeds predicted depletion.",
        basis: "OBSERVED"
      };
    }

    return {
      outcome: OUTCOME_PARTIAL,
      reason: "Observed reduction is less than predicted depletion.",
      basis: "OBSERVED"
    };
  }

  // ------------------------------------------------------------------------
  // LIFECYCLE TRANSITION — Canon §21
  //
  // §24 advances ALLOCATED → IN-MOTION when observed > 0, and
  // ALLOCATED → DEPLETED when observed >= predicted. It never advances on
  // the basis of allocation alone.
  // ------------------------------------------------------------------------

  function advanceState(priorState, outcome) {
    if (priorState !== STATE_ALLOCATED) return priorState;
    if (outcome === OUTCOME_CONFIRMED) return STATE_DEPLETED;
    if (outcome === OUTCOME_PARTIAL)   return STATE_IN_MOTION;
    return priorState;
  }

  // ------------------------------------------------------------------------
  // LEARNING SIGNAL — Canon §25
  //
  // A structured record of what actually happened. It feeds back into the
  // Demand Radar in a later revision; for V1.8.2.6 the signal is produced
  // and consumed read-only by the conductor's panel. The shape is stable so
  // a future behaviour-layer feedback can consume it without schema change.
  // ------------------------------------------------------------------------

  function buildLearningSignal(opportunity, predicted, observed, outcome, outcomeReason) {
    // Signals are only emitted when they carry observed evidence. A
    // PENDING outcome with S2_UNAVAILABLE carries no observation and
    // therefore no learning.
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

      // Which evidence classes were present in the §17 signal that generated
      // this opportunity — carried through so a future learning layer can
      // correlate demand-strength bands with realized depletion.
      demand_strength:           opportunity.evidence && opportunity.evidence.demand_strength,
      demand_strength_reasons:   opportunity.evidence && opportunity.evidence.demand_strength_reasons,

      // Which pricing tier was applied — carried through from §22.
      commercial_fit_tier:       opportunity.commercial_fit && opportunity.commercial_fit.tier,

      recorded_at: nowIso()
    };
  }

  // ------------------------------------------------------------------------
  // BUILD ONE DEPLETION RECORD
  // ------------------------------------------------------------------------

  function buildDepletionRecord(opportunity, movements, s2State) {
    var predicted = num(opportunity.allocatable_quantity, 0);
    var observed = observedDepletion(opportunity, movements);
    var windowClosed = Date.now() >= (parseMs(observed.window_end) || 0);

    var outcome = classifyOutcome(predicted, observed.observed_quantity, s2State, windowClosed);
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

      // Explanatory fields — carry forward.
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

      // Evidence block — §22 evidence extended with §24 additions.
      evidence: Object.assign({}, opportunity.evidence, {
        s2_state:         s2State,
        depletion_basis:  outcome.basis
      }),

      // §25 learning signal, or null when there is no observation to learn from.
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

    // Only ALLOCATED (and already IN-MOTION / DEPLETED, for idempotency)
    // opportunities are subject to depletion observation. Everything else
    // is passed through unchanged.
    var observableStates = [STATE_ALLOCATED, STATE_IN_MOTION, STATE_DEPLETED];
    var observable = opportunities.filter(function (o) {
      return observableStates.indexOf(o.opportunity_state) !== -1;
    });

    var productIds = observable.map(function (o) { return o.product_id; })
      .filter(Boolean)
      .filter(function (v, k, a) { return a.indexOf(v) === k; });

    var movementsRead = await readStockMovements(user.id, productIds);
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
        s2_dependency_note:            "Canon §24 requires observed stock transitions. Until server migration S2 populates stock_movements, outcome is PENDING with basis S2_UNAVAILABLE and no lifecycle transition past ALLOCATED occurs."
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

  console.log("[GoodsbarnX] depletor-depletion.js loaded (" + VERSION + ")");
})();
