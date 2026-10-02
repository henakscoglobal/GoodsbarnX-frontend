/* ==========================================================================
   GoodsbarnX — js/depletor-replenishment.js
   Master Stock Depletor · Stage 6 — Replenishment Engine (Canon §26).

   Version: V1.8.2.6
   Load position: 13 (per D13). Loads after js/depletor-depletion.js, before
   js/depletor.js (the conductor).

   Canon basis:
     §14  pipeline stage 6 of 7.
     §26  replenishment uses: actual depletion rate, repeated demand,
          unfulfilled demand, buyer preferences, distributor stock patterns,
          historical purchasing, seasonality, market signals.
     §29  evidence integrity — every signal carries the evidence that
          produced it. Signals that cannot be derived from evidence are not
          emitted; SEASONAL_PATTERN is declared but not emitted unless the
          historical depth to support it exists.

   Server dependency:
     S3  replenishment_signals table. This stage emits REPLENISHMENT SIGNAL
         objects into the pipeline snapshot; it does not write to S3.
         Persistence is a later-phase concern; the table is named here so
         the destination is unambiguous.

   This file owns:
     - aggregateByProduct(): §26 evidence aggregation per product.
     - classifySignal()    : which signal type(s) apply and why.
     - recommendQuantity() : where derivable from evidence.
     - classifyUrgency()   : HIGH / NORMAL / LOW + reasons.
     - run()               : returns the pipeline snapshot.

   This file does NOT:
     - write to the database.
     - render UI.
     - re-run the pipeline.
   ========================================================================== */

(function () {
  "use strict";

  var VERSION = "V1.8.2.6";
  var STAGE = "replenishment";

  // Canon §26 signal types. Seasonal is declared but only emitted when
  // evidence for it exists — see classifySignal().
  var SIGNAL_RESTOCK_SOON      = "RESTOCK_SOON";
  var SIGNAL_RESTOCK_NOW       = "RESTOCK_NOW";
  var SIGNAL_UNFULFILLED       = "UNFULFILLED_DEMAND";
  var SIGNAL_REPEAT_DEMAND     = "REPEAT_DEMAND";
  var SIGNAL_SEASONAL_PATTERN  = "SEASONAL_PATTERN";

  var STATE_ALLOCATED = "ALLOCATED";
  var STATE_IN_MOTION = "IN-MOTION";
  var STATE_DEPLETED  = "DEPLETED";

  // ------------------------------------------------------------------------
  // SMALL HELPERS
  // ------------------------------------------------------------------------

  function nowIso() { return new Date().toISOString(); }
  function num(v, fallback) {
    var n = Number(v);
    return isFinite(n) ? n : (fallback == null ? 0 : fallback);
  }
  function lower(v) { return String(v == null ? "" : v).toLowerCase(); }

  // ------------------------------------------------------------------------
  // AGGREGATION — one evidence bundle per product
  //
  // The inputs are the §24 depletion snapshot (which carries §22 allocation
  // data) and the §17 demand-radar snapshot (for unfulfilled demand).
  // ------------------------------------------------------------------------

  function aggregateByProduct(depletionSnapshot, radarSnapshot) {
    var opportunities = (depletionSnapshot && depletionSnapshot.rows) || [];
    var signals = (radarSnapshot && radarSnapshot.rows) || [];

    var byProduct = Object.create(null);

    function ensure(productId, seed) {
      if (!byProduct[productId]) {
        byProduct[productId] = {
          product_id: productId,
          distributor_id: seed.distributor_id || null,
          product_name: seed.product_name || null,
          category: seed.category || null,
          stock_quantity: seed.stock_quantity != null ? num(seed.stock_quantity, 0) : null,

          // Observed depletion from §24
          observed_depletion_total: 0,
          predicted_depletion_total: 0,
          outcomes: { PENDING: 0, PARTIAL: 0, CONFIRMED: 0, NOT_OBSERVED: 0 },
          movement_ids: [],

          // Allocation breadth
          allocated_opportunity_count: 0,
          in_motion_opportunity_count: 0,
          depleted_opportunity_count: 0,
          depleted_stock_health: null,   // stock health from the §16 evidence carried forward

          // Demand evidence
          demand_signals: [],
          repeat_demand_buyers: {},      // buyer_id -> count of signals
          unfulfilled_quantity: 0,

          // Timing
          first_opportunity_at: null,
          last_opportunity_at: null
        };
      }
      return byProduct[productId];
    }

    // --- Fold in the depletion records ---
    opportunities.forEach(function (o) {
      var productId = o.product_id;
      if (!productId) return;

      var p = ensure(productId, {
        distributor_id: o.distributor_id,
        product_name: o.what,
        stock_quantity: o.stock_quantity
      });

      var dep = o.depletion;
      if (dep) {
        p.predicted_depletion_total += num(dep.predicted_quantity, 0);
        p.observed_depletion_total  += num(dep.observed_quantity, 0);
        if (dep.outcome && p.outcomes[dep.outcome] != null) p.outcomes[dep.outcome]++;
        if (dep.observation && Array.isArray(dep.observation.movement_ids)) {
          dep.observation.movement_ids.forEach(function (id) {
            if (p.movement_ids.indexOf(id) === -1) p.movement_ids.push(id);
          });
        }
      }

      if (o.opportunity_state === STATE_ALLOCATED) p.allocated_opportunity_count++;
      if (o.opportunity_state === STATE_IN_MOTION) p.in_motion_opportunity_count++;
      if (o.opportunity_state === STATE_DEPLETED)  p.depleted_opportunity_count++;

      var health = o.evidence && o.evidence.stock_health;
      if (health) p.depleted_stock_health = health;

      // Buyer preferences from the §17 relationship evidence (carried through).
      if (o.buyer_id) {
        p.repeat_demand_buyers[o.buyer_id] = (p.repeat_demand_buyers[o.buyer_id] || 0) + 1;
      }

      var created = o.created_at;
      if (created) {
        if (!p.first_opportunity_at || created < p.first_opportunity_at) p.first_opportunity_at = created;
        if (!p.last_opportunity_at  || created > p.last_opportunity_at)  p.last_opportunity_at = created;
      }
    });

    // --- Fold in the §17 radar signals for unfulfilled demand ---
    signals.forEach(function (s) {
      var productMatches = s.product_matches || [];
      if (!productMatches.length) return;

      // The radar signal's quantity is unfulfilled if it has no matching
      // allocated opportunity for that product. We cannot know that here
      // directly; we approximate by checking whether any opportunity with
      // this inquiry_id was allocated. If not, the quantity is unfulfilled.
      var anyAllocatedForInquiry = opportunities.some(function (o) {
        return o.inquiry_id === s.inquiry_id &&
               (o.opportunity_state === STATE_ALLOCATED ||
                o.opportunity_state === STATE_IN_MOTION ||
                o.opportunity_state === STATE_DEPLETED);
      });

      productMatches.forEach(function (productId) {
        var p = ensure(productId, {
          distributor_id: s.distributor_id,
          stock_quantity: null
        });
        p.demand_signals.push({
          inquiry_id: s.inquiry_id,
          buyer_id: s.buyer_id,
          item: s.item,
          quantity: s.quantity,
          demand_strength: s.demand_strength,
          fulfilled: anyAllocatedForInquiry
        });
        if (!anyAllocatedForInquiry && num(s.quantity, 0) > 0) {
          p.unfulfilled_quantity += num(s.quantity, 0);
        }
      });
    });

    return byProduct;
  }

  // ------------------------------------------------------------------------
  // SIGNAL CLASSIFICATION — Canon §26
  //
  // The rules are ordered by precedence. Each rule produces a signal type
  // only when its evidence is present. Multiple signals per product are
  // allowed when multiple independent justifications exist.
  // ------------------------------------------------------------------------

  function classifySignal(product) {
    var signals = [];

    // RESTOCK_NOW — observed depletion confirmed and stock is now zero or
    // below a minimum. Actually we do not track a minimum; we use the
    // evidence we have: confirmed depletion at or above predicted, plus
    // observed reduction.
    if (product.outcomes.CONFIRMED > 0 && product.observed_depletion_total > 0) {
      signals.push({
        type: SIGNAL_RESTOCK_NOW,
        reason: "Observed depletion confirmed at or above predicted quantity.",
        evidence: {
          confirmed_outcomes:       product.outcomes.CONFIRMED,
          observed_depletion_total: product.observed_depletion_total,
          predicted_depletion_total: product.predicted_depletion_total,
          movement_ids:             product.movement_ids.slice(0, 20)
        }
      });
    }
    // RESTOCK_SOON — partial depletion observed, or confirmed outcomes
    // without full depletion, or in-motion opportunities.
    else if (product.outcomes.PARTIAL > 0 ||
             product.in_motion_opportunity_count > 0 ||
             product.allocated_opportunity_count > 0) {
      signals.push({
        type: SIGNAL_RESTOCK_SOON,
        reason: "Partial depletion observed or allocation in progress; monitor for further reduction.",
        evidence: {
          partial_outcomes:            product.outcomes.PARTIAL,
          in_motion_opportunities:     product.in_motion_opportunity_count,
          allocated_opportunities:     product.allocated_opportunity_count,
          observed_depletion_total:    product.observed_depletion_total,
          predicted_depletion_total:   product.predicted_depletion_total
        }
      });
    }

    // UNFULFILLED_DEMAND — demand signals with no matching allocation.
    if (product.unfulfilled_quantity > 0) {
      signals.push({
        type: SIGNAL_UNFULFILLED,
        reason: "Demand exists for this product but no allocated opportunity satisfied it.",
        evidence: {
          unfulfilled_quantity: product.unfulfilled_quantity,
          demand_signals:       product.demand_signals
                                  .filter(function (s) { return !s.fulfilled; })
                                  .slice(0, 20)
        }
      });
    }

    // REPEAT_DEMAND — multiple signals from the same buyer, or multiple
    // demand signals total.
    var repeatBuyers = Object.keys(product.repeat_demand_buyers).filter(function (bid) {
      return product.repeat_demand_buyers[bid] > 1;
    });
    if (repeatBuyers.length > 0 || product.demand_signals.length > 2) {
      signals.push({
        type: SIGNAL_REPEAT_DEMAND,
        reason: repeatBuyers.length > 0
          ? "Repeated demand from the same buyer(s)."
          : "Sustained demand across multiple signals.",
        evidence: {
          repeat_buyers:       repeatBuyers,
          total_demand_signals: product.demand_signals.length
        }
      });
    }

    // SEASONAL_PATTERN is not emitted by this stage. It requires historical
    // depth (multiple seasons of inquiry data) that is not guaranteed to
    // exist for any given distributor. When the schema and data support it,
    // a future revision of this file can emit it with a clearly-cited
    // evidence trail. Emitting it now would be fabrication (§29).

    return signals;
  }

  // ------------------------------------------------------------------------
  // RECOMMENDED QUANTITY — derived from evidence only
  // ------------------------------------------------------------------------

  function recommendQuantity(product) {
    // The evidence-based quantity to recommend: the sum of unfulfilled
    // demand quantity, if positive. Otherwise null.
    if (product.unfulfilled_quantity > 0) {
      return {
        value: product.unfulfilled_quantity,
        basis: "SUM_OF_UNFULFILLED_DEMAND_QUANTITIES"
      };
    }
    // If predicted depletion exceeds observed, the difference is the
    // remaining shortfall — but this is a prediction, not a demand, and
    // we do not recommend replenishing against a prediction alone.
    return {
      value: null,
      basis: "INSUFFICIENT_EVIDENCE"
    };
  }

  // ------------------------------------------------------------------------
  // URGENCY BAND — Canon §26
  // ------------------------------------------------------------------------

  function classifyUrgency(product, signals) {
    var reasons = [];

    var hasRestockNow = signals.some(function (s) { return s.type === SIGNAL_RESTOCK_NOW; });
    var hasUnfulfilled = signals.some(function (s) { return s.type === SIGNAL_UNFULFILLED; });
    var health = product.depleted_stock_health;

    if (hasRestockNow) {
      reasons.push("restock_now_signal_present");
    }
    if (hasUnfulfilled) {
      reasons.push("unfulfilled_demand_present");
    }
    if (health === "Critical" || health === "At Risk") {
      reasons.push("stock_health=" + health);
    }

    var band = "NORMAL";
    if (hasRestockNow || health === "Critical") band = "HIGH";
    else if (hasUnfulfilled || health === "At Risk") band = "HIGH";
    else if (product.demand_signals.length === 0 && product.observed_depletion_total === 0) {
      band = "LOW";
      reasons.push("no_active_demand_or_depletion");
    }

    return { band: band, reasons: reasons };
  }

  // ------------------------------------------------------------------------
  // BUILD ONE REPLENISHMENT SIGNAL RECORD — Canon §26
  // ------------------------------------------------------------------------

  function buildSignalRecord(product, signal, urgency, recommendation) {
    return {
      // Canon §30-adjacent canonical fields (this is a Canon §26 record,
      // not a Canon §30 opportunity).
      product_id:          product.product_id,
      distributor_id:      product.distributor_id,
      product_name:        product.product_name,
      category:            product.category,

      signal_type:         signal.type,
      signal_reason:       signal.reason,
      signal_evidence:     signal.evidence,

      urgency:             urgency.band,
      urgency_reasons:     urgency.reasons,

      recommended_quantity: recommendation.value,
      recommendation_basis: recommendation.basis,

      // Aggregated evidence — full block so a reviewer can see everything
      // that was considered.
      aggregate_evidence: {
        observed_depletion_total:    product.observed_depletion_total,
        predicted_depletion_total:   product.predicted_depletion_total,
        outcomes:                    product.outcomes,
        allocated_opportunity_count: product.allocated_opportunity_count,
        in_motion_opportunity_count: product.in_motion_opportunity_count,
        depleted_opportunity_count:  product.depleted_opportunity_count,
        unfulfilled_quantity:        product.unfulfilled_quantity,
        demand_signal_count:         product.demand_signals.length,
        repeat_buyer_count:          Object.keys(product.repeat_demand_buyers)
                                        .filter(function (b) { return product.repeat_demand_buyers[b] > 1; }).length,
        stock_health:                product.depleted_stock_health,
        first_opportunity_at:        product.first_opportunity_at,
        last_opportunity_at:         product.last_opportunity_at
      },

      created_at: nowIso(),

      produced_by: {
        stage:   STAGE,
        version: VERSION
      }
    };
  }

  // ------------------------------------------------------------------------
  // STAGE RUN
  // ------------------------------------------------------------------------

  function run(depletionSnapshot, radarSnapshot) {
    var generatedAt = nowIso();

    var depletionAvailable = !!depletionSnapshot;
    var radarAvailable = !!radarSnapshot;

    var byProduct = aggregateByProduct(depletionSnapshot, radarSnapshot);

    var signals = [];

    Object.keys(byProduct).forEach(function (productId) {
      var product = byProduct[productId];
      var productSignals = classifySignal(product);
      if (!productSignals.length) return;

      var urgency = classifyUrgency(product, productSignals);
      var recommendation = recommendQuantity(product);

      productSignals.forEach(function (s) {
        signals.push(buildSignalRecord(product, s, urgency, recommendation));
      });
    });

    // Sort: HIGH urgency first, then by signal type priority.
    var typeOrder = {
      RESTOCK_NOW: 0,
      UNFULFILLED_DEMAND: 1,
      RESTOCK_SOON: 2,
      REPEAT_DEMAND: 3,
      SEASONAL_PATTERN: 4
    };
    var urgencyOrder = { HIGH: 0, NORMAL: 1, LOW: 2 };
    signals.sort(function (a, b) {
      var ua = urgencyOrder[a.urgency] != null ? urgencyOrder[a.urgency] : 99;
      var ub = urgencyOrder[b.urgency] != null ? urgencyOrder[b.urgency] : 99;
      if (ua !== ub) return ua - ub;
      var ta = typeOrder[a.signal_type] != null ? typeOrder[a.signal_type] : 99;
      var tb = typeOrder[b.signal_type] != null ? typeOrder[b.signal_type] : 99;
      return ta - tb;
    });

    // Summary.
    var byType = Object.create(null);
    var byUrgency = { HIGH: 0, NORMAL: 0, LOW: 0 };
    signals.forEach(function (s) {
      byType[s.signal_type] = (byType[s.signal_type] || 0) + 1;
      if (byUrgency[s.urgency] != null) byUrgency[s.urgency]++;
    });

    return {
      stage: STAGE,
      version: VERSION,
      generatedAt: generatedAt,
      rows: signals,
      summary: {
        signalCount:   signals.length,
        productCount:  Object.keys(byProduct).length,
        byType:        byType,
        byUrgency:     byUrgency
      },
      evidence: {
        depletion_snapshot_available: depletionAvailable,
        radar_snapshot_available:     radarAvailable,
        products_considered:          Object.keys(byProduct).length,
        s3_dependency_note:           "Signals produced by this stage are Canon §26 REPLENISHMENT SIGNAL objects. Persistence to a replenishment_signals table is server deliverable S3; this stage is read-only."
      }
    };
  }

  // ------------------------------------------------------------------------
  // EXPORTS
  // ------------------------------------------------------------------------

  window.goodsbarnxDepletorReplenishment = {
    version: VERSION,
    stage: STAGE,
    run: run
  };

  console.log("[GoodsbarnX] depletor-replenishment.js loaded (" + VERSION + ")");
})();
