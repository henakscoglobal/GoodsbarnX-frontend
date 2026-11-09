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
          historical depth to support it exists. Crucially, §29 also forbids
          amplifying one commercial reality into multiple urgency signals
          through catalog duplication.

   Server dependency:
     S3  replenishment_signals table. This stage emits REPLENISHMENT SIGNAL
         objects into the pipeline snapshot; it does not write to S3.
         Persistence is a later-phase concern; the table is named here so
         the destination is unambiguous.

   This file owns:
     - aggregateByProduct(): §26 evidence aggregation per product.
     - groupByCommercial()  : §29 commercial grouping (dedup of urgency).
     - classifySignal()     : which signal type(s) apply and why.
     - recommendQuantity()  : where derivable from evidence.
     - classifyUrgency()    : HIGH / MODERATE / LOW / UNKNOWN + reasons.
     - run()                : returns the pipeline snapshot.

   This file does NOT:
     - write to the database.
     - render UI.
     - re-run the pipeline.
     - repair product-catalog data (that is F-15).

   F-5 (V1.8.2.6 revision):
     - classifyUrgency() no longer collapses every non-trivial case to HIGH.
       Each of the five drivers is graded independently; the product band is
       the max across drivers. Band names: HIGH / MODERATE / LOW / UNKNOWN.
     - NORMAL renamed to MODERATE to align with the CSS tokens.

   F-15 mitigation (V1.8.2.6 revision, in-stage):
     - The replenishment stage cannot safely assume the catalog is clean.
       When the same physical product exists as N rows, aggregating urgency
       per row would multiply one commercial reality into N HIGH signals.
       §29 forbids that.
     - groupByCommercial() collapses the aggregation to the commercial
       level for urgency + recommendation, and tags each emitted row with
       its commercial group and (when N > 1) a DUPLICATE_CANDIDATE flag.
     - Commercial key is (name, brand, sku, distributor_id). Two rows with
       different SKUs are treated as genuinely different products (e.g.
       "Metal sheets 2MM" vs "Metal sheets 2.5MM"); two rows with the same
       name+brand+SKU+distributor are true duplicates and are grouped.
     - Every product_id still emits its own row (pipeline contract is
       preserved). Only the *urgency* and *recommendation* are shared.
   ========================================================================== */

(function () {
  "use strict";

  var VERSION = "V1.8.2.6";
  var STAGE = "replenishment";

  // Canon §26 signal types.
  var SIGNAL_RESTOCK_SOON      = "RESTOCK_SOON";
  var SIGNAL_RESTOCK_NOW       = "RESTOCK_NOW";
  var SIGNAL_UNFULFILLED       = "UNFULFILLED_DEMAND";
  var SIGNAL_REPEAT_DEMAND     = "REPEAT_DEMAND";
  var SIGNAL_SEASONAL_PATTERN  = "SEASONAL_PATTERN";

  var STATE_ALLOCATED = "ALLOCATED";
  var STATE_IN_MOTION = "IN-MOTION";
  var STATE_DEPLETED  = "DEPLETED";

  // Urgency bands, ordered by severity for max() and sort.
  var BAND_UNKNOWN  = "UNKNOWN";
  var BAND_LOW      = "LOW";
  var BAND_MODERATE = "MODERATE";
  var BAND_HIGH     = "HIGH";

  var BAND_RANK = { UNKNOWN: -1, LOW: 0, MODERATE: 1, HIGH: 2 };

  // Data quality flags emitted on rows (per F-15 mitigation).
  var FLAG_DUPLICATE = "DUPLICATE_CANDIDATE";

  // ------------------------------------------------------------------------
  // SMALL HELPERS
  // ------------------------------------------------------------------------

  function nowIso() { return new Date().toISOString(); }
  function num(v, fallback) {
    var n = Number(v);
    return isFinite(n) ? n : (fallback == null ? 0 : fallback);
  }
  function lower(v) { return String(v == null ? "" : v).toLowerCase(); }
  function trimLower(v) { return lower(v).trim(); }

  // ------------------------------------------------------------------------
  // AGGREGATION — one evidence bundle per product
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
          brand: seed.brand || null,
          sku: seed.sku || null,
          category: seed.category || null,
          stock_quantity: seed.stock_quantity != null ? num(seed.stock_quantity, 0) : null,

          observed_depletion_total: 0,
          predicted_depletion_total: 0,
          outcomes: { PENDING: 0, PARTIAL: 0, CONFIRMED: 0, NOT_OBSERVED: 0 },
          movement_ids: [],

          allocated_opportunity_count: 0,
          in_motion_opportunity_count: 0,
          depleted_opportunity_count: 0,
          depleted_stock_health: null,

          demand_signals: [],
          repeat_demand_buyers: {},
          unfulfilled_quantity: 0,

          first_opportunity_at: null,
          last_opportunity_at: null
        };
      }
      return byProduct[productId];
    }

    opportunities.forEach(function (o) {
      var productId = o.product_id;
      if (!productId) return;

      var p = ensure(productId, {
        distributor_id: o.distributor_id,
        product_name: o.what,
        brand: o.brand,
        sku: o.sku,
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

      if (o.buyer_id) {
        p.repeat_demand_buyers[o.buyer_id] = (p.repeat_demand_buyers[o.buyer_id] || 0) + 1;
      }

      var created = o.created_at;
      if (created) {
        if (!p.first_opportunity_at || created < p.first_opportunity_at) p.first_opportunity_at = created;
        if (!p.last_opportunity_at  || created > p.last_opportunity_at)  p.last_opportunity_at = created;
      }
    });

    signals.forEach(function (s) {
      var productMatches = s.product_matches || [];
      if (!productMatches.length) return;

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
  // COMMERCIAL GROUPING — F-15 mitigation
  //
  // Key: (name, brand, sku, distributor_id).
  //
  //   - Same name + brand + SKU + distributor ⇒ SAME physical product.
  //     Group together; compute urgency once; flag DUPLICATE_CANDIDATE.
  //   - Same name + brand + distributor but DIFFERENT SKU ⇒ legitimately
  //     distinct products (e.g. "Metal sheets 2MM" vs "Metal sheets 2.5MM").
  //     Different groups; separate urgency; NO flag.
  //   - Different distributor ⇒ never related.
  //
  // Group-level evidence rules (duplicates must not multiply demand):
  //   - unfulfilled_quantity, observed, predicted: MAX across members
  //     (not SUM — the same buyer demand was attributed to each member
  //     by the radar, so summing would fabricate).
  //   - outcomes and counts: MAX.
  //   - stock health: worst.
  //   - demand_signals: dedupe by inquiry_id.
  //   - repeat_demand_buyers: max count per buyer.
  // ------------------------------------------------------------------------

  function commercialKey(product) {
    return [
      trimLower(product.product_name || ""),
      trimLower(product.brand || ""),
      trimLower(product.sku || ""),
      String(product.distributor_id || "")
    ].join("|");
  }

  function groupByCommercial(byProduct) {
    var groups = Object.create(null);

    Object.keys(byProduct).forEach(function (productId) {
      var p = byProduct[productId];
      var key = commercialKey(p);
      if (!groups[key]) {
        groups[key] = {
          key: key,
          product_name: p.product_name,
          brand: p.brand,
          sku: p.sku,
          distributor_id: p.distributor_id,
          member_ids: [],
          unfulfilled_quantity: 0,
          observed_depletion_total: 0,
          predicted_depletion_total: 0,
          outcomes: { PENDING: 0, PARTIAL: 0, CONFIRMED: 0, NOT_OBSERVED: 0 },
          allocated_opportunity_count: 0,
          in_motion_opportunity_count: 0,
          depleted_opportunity_count: 0,
          depleted_stock_health: null,
          demand_signals_by_inquiry: Object.create(null),
          repeat_demand_buyers: Object.create(null),
          first_opportunity_at: null,
          last_opportunity_at: null
        };
      }
      var g = groups[key];
      g.member_ids.push(productId);

      if (p.unfulfilled_quantity > g.unfulfilled_quantity) g.unfulfilled_quantity = p.unfulfilled_quantity;
      if (p.observed_depletion_total > g.observed_depletion_total) g.observed_depletion_total = p.observed_depletion_total;
      if (p.predicted_depletion_total > g.predicted_depletion_total) g.predicted_depletion_total = p.predicted_depletion_total;

      ["PENDING", "PARTIAL", "CONFIRMED", "NOT_OBSERVED"].forEach(function (k) {
        if (p.outcomes[k] > g.outcomes[k]) g.outcomes[k] = p.outcomes[k];
      });

      if (p.allocated_opportunity_count > g.allocated_opportunity_count) g.allocated_opportunity_count = p.allocated_opportunity_count;
      if (p.in_motion_opportunity_count > g.in_motion_opportunity_count) g.in_motion_opportunity_count = p.in_motion_opportunity_count;
      if (p.depleted_opportunity_count > g.depleted_opportunity_count) g.depleted_opportunity_count = p.depleted_opportunity_count;

      var healthRank = { "Critical": 3, "At Risk": 2, "Low": 1, "Healthy": 0 };
      var curRank = g.depleted_stock_health ? (healthRank[g.depleted_stock_health] || 0) : -1;
      var newRank = p.depleted_stock_health ? (healthRank[p.depleted_stock_health] || 0) : -1;
      if (newRank > curRank) g.depleted_stock_health = p.depleted_stock_health;

      (p.demand_signals || []).forEach(function (s) {
        if (!g.demand_signals_by_inquiry[s.inquiry_id]) {
          g.demand_signals_by_inquiry[s.inquiry_id] = s;
        }
      });

      Object.keys(p.repeat_demand_buyers).forEach(function (bid) {
        var c = p.repeat_demand_buyers[bid];
        if (!g.repeat_demand_buyers[bid] || g.repeat_demand_buyers[bid] < c) {
          g.repeat_demand_buyers[bid] = c;
        }
      });

      if (p.first_opportunity_at && (!g.first_opportunity_at || p.first_opportunity_at < g.first_opportunity_at)) {
        g.first_opportunity_at = p.first_opportunity_at;
      }
      if (p.last_opportunity_at && (!g.last_opportunity_at || p.last_opportunity_at > g.last_opportunity_at)) {
        g.last_opportunity_at = p.last_opportunity_at;
      }
    });

    Object.keys(groups).forEach(function (k) {
      var g = groups[k];
      g.demand_signals = Object.keys(g.demand_signals_by_inquiry).map(function (id) {
        return g.demand_signals_by_inquiry[id];
      });
      g.repeat_buyer_count = Object.keys(g.repeat_demand_buyers).filter(function (b) {
        return g.repeat_demand_buyers[b] > 1;
      }).length;
    });

    return groups;
  }

  // ------------------------------------------------------------------------
  // SIGNAL CLASSIFICATION — Canon §26
  // ------------------------------------------------------------------------

  function classifySignal(product) {
    var signals = [];

    if (product.outcomes.CONFIRMED > 0 && product.observed_depletion_total > 0) {
      signals.push({
        type: SIGNAL_RESTOCK_NOW,
        reason: "Observed depletion confirmed at or above predicted quantity.",
        evidence: {
          confirmed_outcomes:       product.outcomes.CONFIRMED,
          observed_depletion_total: product.observed_depletion_total,
          predicted_depletion_total: product.predicted_depletion_total,
          movement_ids:             (product.movement_ids || []).slice(0, 20)
        }
      });
    }
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

    if (product.unfulfilled_quantity > 0) {
      signals.push({
        type: SIGNAL_UNFULFILLED,
        reason: "Demand exists for this product but no allocated opportunity satisfied it.",
        evidence: {
          unfulfilled_quantity: product.unfulfilled_quantity,
          demand_signals:       (product.demand_signals || [])
                                  .filter(function (s) { return !s.fulfilled; })
                                  .slice(0, 20)
        }
      });
    }

    var repeatBuyers = Object.keys(product.repeat_demand_buyers || {}).filter(function (bid) {
      return product.repeat_demand_buyers[bid] > 1;
    });
    if (repeatBuyers.length > 0 || (product.demand_signals || []).length > 2) {
      signals.push({
        type: SIGNAL_REPEAT_DEMAND,
        reason: repeatBuyers.length > 0
          ? "Repeated demand from the same buyer(s)."
          : "Sustained demand across multiple signals.",
        evidence: {
          repeat_buyers:       repeatBuyers,
          total_demand_signals: (product.demand_signals || []).length
        }
      });
    }

    return signals;
  }

  // ------------------------------------------------------------------------
  // RECOMMENDED QUANTITY
  // ------------------------------------------------------------------------

  function recommendQuantity(product) {
    if (product.unfulfilled_quantity > 0) {
      return {
        value: product.unfulfilled_quantity,
        basis: "SUM_OF_UNFULFILLED_DEMAND_QUANTITIES"
      };
    }
    return {
      value: null,
      basis: "INSUFFICIENT_EVIDENCE"
    };
  }

  // ------------------------------------------------------------------------
  // URGENCY BAND
  // ------------------------------------------------------------------------

  function classifyUrgency(product, signals) {
    var reasons = [];
    var band = BAND_UNKNOWN;

    function raise(candidate, reason) {
      reasons.push(reason);
      if (BAND_RANK[candidate] > BAND_RANK[band]) band = candidate;
    }

    var hasRestockNow = signals.some(function (s) { return s.type === SIGNAL_RESTOCK_NOW; });
    if (hasRestockNow) {
      var observed  = num(product.observed_depletion_total, 0);
      var predicted = num(product.predicted_depletion_total, 0);
      if (observed > 0 && observed >= predicted) {
        raise(BAND_HIGH, "restock_now:observed>=predicted (" + observed + ">=" + predicted + ")");
      } else if (observed > 0) {
        raise(BAND_MODERATE, "restock_now:partial_observed (" + observed + "/" + predicted + ")");
      } else {
        raise(BAND_MODERATE, "restock_now:confirmed_without_observed");
      }
    }

    var health = product.depleted_stock_health;
    if (health === "Critical") {
      raise(BAND_HIGH, "stock_health=Critical");
    } else if (health === "At Risk") {
      raise(BAND_MODERATE, "stock_health=At Risk");
    }

    var hasUnfulfilled = signals.some(function (s) { return s.type === SIGNAL_UNFULFILLED; });
    if (hasUnfulfilled) {
      var u = num(product.unfulfilled_quantity, 0);
      var predicted2 = num(product.predicted_depletion_total, 0);
      var threshold = Math.max(10, predicted2 * 0.25);
      if (u >= threshold && u > 0) {
        raise(BAND_HIGH, "unfulfilled:material (" + u + ">=" + threshold.toFixed(1) + ")");
      } else if (u > 0) {
        raise(BAND_MODERATE, "unfulfilled:present (" + u + ")");
      }
    }

    var hasRestockSoon = signals.some(function (s) { return s.type === SIGNAL_RESTOCK_SOON; });
    if (hasRestockSoon) {
      var inMotion = num(product.in_motion_opportunity_count, 0);
      var partial  = product.outcomes && num(product.outcomes.PARTIAL, 0);
      var allocatedOnly = num(product.allocated_opportunity_count, 0) > 0
                          && inMotion === 0 && partial === 0;
      if (inMotion > 0 || partial > 0) {
        raise(BAND_MODERATE, "restock_soon:in_motion_or_partial");
      } else if (allocatedOnly) {
        raise(BAND_LOW, "restock_soon:allocated_only");
      }
    }

    var hasRepeatDemand = signals.some(function (s) { return s.type === SIGNAL_REPEAT_DEMAND; });
    if (hasRepeatDemand) {
      var repeatBuyers = Object.keys(product.repeat_demand_buyers || {})
        .filter(function (b) { return product.repeat_demand_buyers[b] > 1; }).length;
      var demandCount = (product.demand_signals || []).length;
      if (repeatBuyers >= 2 || demandCount >= 4) {
        raise(BAND_HIGH, "repeat_demand:strong (" + repeatBuyers + " repeat, " + demandCount + " total)");
      } else if (repeatBuyers >= 1 || demandCount >= 2) {
        raise(BAND_MODERATE, "repeat_demand:present (" + repeatBuyers + " repeat, " + demandCount + " total)");
      }
    }

    if (band === BAND_UNKNOWN) {
      var noDemand     = (product.demand_signals || []).length === 0;
      var noDepletion  = num(product.observed_depletion_total, 0) === 0;
      var noPredicted  = num(product.predicted_depletion_total, 0) === 0;
      var noHealth     = !health;
      if (noDemand && noDepletion && noPredicted && noHealth) {
        band = BAND_UNKNOWN;
        reasons.push("no_evidence_available");
      } else {
        band = BAND_LOW;
        reasons.push("no_active_demand_or_depletion");
      }
    }

    return { band: band, reasons: reasons };
  }

  // ------------------------------------------------------------------------
  // BUILD ONE REPLENISHMENT SIGNAL RECORD
  // ------------------------------------------------------------------------

  function buildSignalRecord(product, signal, urgency, recommendation, group) {
    var groupSize = group ? group.member_ids.length : 1;
    var flag = groupSize > 1 ? FLAG_DUPLICATE : null;
    var note = groupSize > 1
      ? "This product shares its name + brand + SKU + distributor with " +
        (groupSize - 1) + " other active product row(s). Urgency and " +
        "recommendation are computed once for the commercial group; " +
        "merge the catalog rows to resolve (F-15)."
      : null;

    return {
      product_id:          product.product_id,
      distributor_id:      product.distributor_id,
      product_name:        product.product_name,
      brand:               product.brand || null,
      sku:                 product.sku || null,
      category:            product.category,

      signal_type:         signal.type,
      signal_reason:       signal.reason,
      signal_evidence:     signal.evidence,

      urgency:             urgency.band,
      urgency_reasons:     urgency.reasons,

      recommended_quantity: recommendation.value,
      recommendation_basis: recommendation.basis,

      commercial_group: group ? {
        key:         group.key,
        member_ids:  group.member_ids.slice(),
        size:        groupSize
      } : null,
      data_quality_flag: flag,
      data_quality_note: note,

      aggregate_evidence: {
        observed_depletion_total:    product.observed_depletion_total,
        predicted_depletion_total:   product.predicted_depletion_total,
        outcomes:                    product.outcomes,
        allocated_opportunity_count: product.allocated_opportunity_count,
        in_motion_opportunity_count: product.in_motion_opportunity_count,
        depleted_opportunity_count:  product.depleted_opportunity_count,
        unfulfilled_quantity:        product.unfulfilled_quantity,
        demand_signal_count:         product.demand_signals.length,
        repeat_buyer_count:          Object.keys(product.repeat_demand_buyers || {})
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
    var groups = groupByCommercial(byProduct);

    var signals = [];

    Object.keys(groups).forEach(function (groupKey) {
      var group = groups[groupKey];
      var groupSignals = classifySignal(group);
      if (!groupSignals.length) return;

      var groupUrgency = classifyUrgency(group, groupSignals);
      var groupRecommendation = recommendQuantity(group);

      group.member_ids.forEach(function (productId) {
        var product = byProduct[productId];
        groupSignals.forEach(function (s) {
          signals.push(buildSignalRecord(product, s, groupUrgency, groupRecommendation, group));
        });
      });
    });

    var typeOrder = {
      RESTOCK_NOW: 0,
      UNFULFILLED_DEMAND: 1,
      RESTOCK_SOON: 2,
      REPEAT_DEMAND: 3,
      SEASONAL_PATTERN: 4
    };
    var urgencyOrder = { HIGH: 0, MODERATE: 1, LOW: 2, UNKNOWN: 3 };
    signals.sort(function (a, b) {
      var ua = urgencyOrder[a.urgency] != null ? urgencyOrder[a.urgency] : 99;
      var ub = urgencyOrder[b.urgency] != null ? urgencyOrder[b.urgency] : 99;
      if (ua !== ub) return ua - ub;
      var ta = typeOrder[a.signal_type] != null ? typeOrder[a.signal_type] : 99;
      var tb = typeOrder[b.signal_type] != null ? typeOrder[b.signal_type] : 99;
      if (ta !== tb) return ta - tb;
      return String(a.product_name || "").localeCompare(String(b.product_name || ""));
    });

    var byType = Object.create(null);
    var byUrgency = { HIGH: 0, MODERATE: 0, LOW: 0, UNKNOWN: 0 };
    var duplicateRowCount = 0;
    signals.forEach(function (s) {
      byType[s.signal_type] = (byType[s.signal_type] || 0) + 1;
      if (byUrgency[s.urgency] != null) byUrgency[s.urgency]++;
      if (s.data_quality_flag === FLAG_DUPLICATE) duplicateRowCount++;
    });

    var commercialGroupCount = Object.keys(groups).length;

    return {
      stage: STAGE,
      version: VERSION,
      generatedAt: generatedAt,
      rows: signals,
      summary: {
        signalCount:           signals.length,
        productCount:          Object.keys(byProduct).length,
        commercialGroupCount:  commercialGroupCount,
        duplicateRowCount:     duplicateRowCount,
        byType:                byType,
        byUrgency:             byUrgency
      },
      evidence: {
        depletion_snapshot_available: depletionAvailable,
        radar_snapshot_available:     radarAvailable,
        products_considered:          Object.keys(byProduct).length,
        commercial_groups_considered: commercialGroupCount,
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

  console.log("[GoodsbarnX] depletor-replenishment.js loaded (" + VERSION + ", F-5 urgency + F-15 dedup A)");
})();
