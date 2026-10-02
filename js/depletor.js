/* ==========================================================================
   GoodsbarnX — js/depletor.js
   Master Stock Depletor · Conductor (Canon §14 §27).

   Version: V1.8.2.6
   Load position: 14 (per D13). Loads after js/depletor-replenishment.js,
   before js/products.js.

   Canon basis:
     §14  seven-stage pipeline: Stock Intelligence → Demand Radar →
          Relationship Graph → Opportunity Engine → Allocation →
          Depletion → Replenishment.
     §27  the pipeline is a closed loop. This conductor sequences the
          linear pass; the learning_signal objects emitted by §24 are the
          feedback boundary a future revision will route back into §17.
     §29  evidence integrity — this file does not produce evidence, it
          carries it. Every value rendered comes from a stage snapshot.
     §30  canonical Opportunity object; the conductor does not re-shape it.
     §34  every element on the panel connects to a Canon stage. There is
          no decorative card here.

   This file owns:
     - runPipeline(): the full seven-stage sequence.
     - render()     : the depletor console panel.
     - public entry : window.refreshDepletorPipeline (full),
                      window.refreshDepletorAllocation (compat — runs the
                      full pipeline and returns the allocation rows).

   This file does NOT:
     - read the database directly.
     - write to the database.
     - mutate stock.
     - own any stage's evidence construction.
   ========================================================================== */

(function () {
  "use strict";

  var VERSION = "V1.8.2.6";
  var STAGE = "conductor";
  var ISOLATION_MARKER = "V1.8.2.6.8.1.1.8"; // preserved for the isolated marker test

  window.goodsbarnxDepletorAllocationVersion = VERSION;
  window.goodsbarnxDepletorIsolationMarker = ISOLATION_MARKER;
  window.goodsbarnxDepletorPipelineVersion = VERSION;

  var state = {
    snapshot: null,
    error: null,
    running: false,
    startedAt: null,
    completedAt: null
  };

  // ------------------------------------------------------------------------
  // SMALL HELPERS
  // ------------------------------------------------------------------------

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c];
    });
  }

  var __depletorWarned = Object.create(null);
  function depletWarnMissing(id) {
    if (__depletorWarned[id]) return;
    __depletorWarned[id] = true;
    console.warn("[GoodsbarnX/depletor] DOM target #" + id + " is missing.");
  }

  // ------------------------------------------------------------------------
  // STAGE AVAILABILITY
  //
  // Every stage is loaded before this file per D13. If any is missing, the
  // conductor names which one and does not proceed silently — §29.
  // ------------------------------------------------------------------------

  function stagesAvailable() {
    return {
      stock:         !!(window.goodsbarnxDepletorStock && typeof window.goodsbarnxDepletorStock.run === "function"),
      radar:         !!(window.goodsbarnxDepletorRadar && typeof window.goodsbarnxDepletorRadar.run === "function"),
      opportunity:   !!(window.goodsbarnxDepletorOpportunity && typeof window.goodsbarnxDepletorOpportunity.run === "function"),
      allocation:    !!(window.goodsbarnxDepletorAllocation && typeof window.goodsbarnxDepletorAllocation.run === "function"),
      depletion:     !!(window.goodsbarnxDepletorDepletion && typeof window.goodsbarnxDepletorDepletion.run === "function"),
      replenishment: !!(window.goodsbarnxDepletorReplenishment && typeof window.goodsbarnxDepletorReplenishment.run === "function")
    };
  }

  // ------------------------------------------------------------------------
  // RUN ONE STAGE
  //
  // Wraps a stage's run() so the conductor can:
  //   - time it
  //   - catch its error without aborting the entire pipeline
  //   - record whether it succeeded, failed, or was skipped
  //
  // A failing stage does NOT abort the pipeline. Downstream stages receive
  // whatever the upstream produced (possibly null). If a stage receives a
  // null input because its predecessor failed, it emits its own named error
  // state per its own §29 discipline, and the pipeline continues.
  // ------------------------------------------------------------------------

  async function runStage(name, fn, input) {
    var t0 = Date.now();
    try {
      var result = await fn(input);
      return { name: name, ok: true, ms: Date.now() - t0, result: result, error: null };
    } catch (e) {
      return { name: name, ok: false, ms: Date.now() - t0, result: null, error: e };
    }
  }

  // ------------------------------------------------------------------------
  // FULL PIPELINE — Canon §14 §27
  // ------------------------------------------------------------------------

  async function runPipeline() {
    if (state.running) {
      console.warn("[GoodsbarnX/depletor] pipeline already running; call ignored.");
      return state.snapshot;
    }
    state.running = true;
    state.startedAt = new Date().toISOString();
    state.error = null;

    var avail = stagesAvailable();
    var missing = Object.keys(avail).filter(function (k) { return !avail[k]; });
    if (missing.length) {
      var msg = "MSD stage(s) not loaded: " + missing.join(", ") +
                ". Verify index.html loads all seven depletor files in Canon §10 order.";
      console.error("[GoodsbarnX/depletor] " + msg);
      state.error = new Error(msg);
      state.running = false;
      state.completedAt = new Date().toISOString();
      return null;
    }

    var user = null;
    try { user = currentUser; } catch (e) {}
    if (!user || String(user.role || "").toLowerCase() !== "distributor") {
      state.error = new Error("AUTH_CONTEXT_UNAVAILABLE");
      state.running = false;
      state.completedAt = new Date().toISOString();
      return null;
    }

    var trace = [];

    // Stage 1 — §15 Stock Intelligence
    var t1 = await runStage("stock", window.goodsbarnxDepletorStock.run, null);
    trace.push({ stage: "stock", ok: t1.ok, ms: t1.ms, error: t1.error ? t1.error.message : null });
    var stockSnapshot = t1.result;

    // Stage 2 — §17 Demand Radar (needs stock for product matching)
    var t2 = await runStage("radar", function () {
      return window.goodsbarnxDepletorRadar.run(stockSnapshot);
    }, null);
    trace.push({ stage: "radar", ok: t2.ok, ms: t2.ms, error: t2.error ? t2.error.message : null });
    var radarSnapshot = t2.result;

    // Stage 3 — §20 Opportunity Engine (needs stock + radar)
    var t3 = await runStage("opportunity", function () {
      return Promise.resolve(window.goodsbarnxDepletorOpportunity.run(stockSnapshot, radarSnapshot));
    }, null);
    trace.push({ stage: "opportunity", ok: t3.ok, ms: t3.ms, error: t3.error ? t3.error.message : null });
    var opportunitySnapshot = t3.result;

    // Stage 4 — §22 Allocation (needs opportunity)
    var t4 = await runStage("allocation", function () {
      return window.goodsbarnxDepletorAllocation.run(opportunitySnapshot);
    }, null);
    trace.push({ stage: "allocation", ok: t4.ok, ms: t4.ms, error: t4.error ? t4.error.message : null });
    var allocationSnapshot = t4.result;

    // Stage 5 — §24 Depletion (needs allocation)
    var t5 = await runStage("depletion", function () {
      return window.goodsbarnxDepletorDepletion.run(allocationSnapshot);
    }, null);
    trace.push({ stage: "depletion", ok: t5.ok, ms: t5.ms, error: t5.error ? t5.error.message : null });
    var depletionSnapshot = t5.result;

    // Stage 6 — §26 Replenishment (needs depletion + radar)
    var t6 = await runStage("replenishment", function () {
      return Promise.resolve(window.goodsbarnxDepletorReplenishment.run(depletionSnapshot, radarSnapshot));
    }, null);
    trace.push({ stage: "replenishment", ok: t6.ok, ms: t6.ms, error: t6.error ? t6.error.message : null });
    var replenishmentSnapshot = t6.result;

    state.completedAt = new Date().toISOString();
    state.running = false;

    var snapshot = {
      stage: STAGE,
      version: VERSION,
      generatedAt: state.completedAt,
      startedAt: state.startedAt,
      stages: {
        stock:         stockSnapshot,
        radar:         radarSnapshot,
        opportunity:   opportunitySnapshot,
        allocation:    allocationSnapshot,
        depletion:     depletionSnapshot,
        replenishment: replenishmentSnapshot
      },
      trace: trace,
      ok: trace.every(function (t) { return t.ok; })
    };

    state.snapshot = snapshot;
    window.goodsbarnxDepletorPipelineSnapshot = snapshot;

    render(snapshot);
    return snapshot;
  }

  // ------------------------------------------------------------------------
  // RENDER — the depletor console panel
  //
  // Sections, in order:
  //   1. Stock intelligence summary (§15)
  //   2. Demand radar summary (§17)
  //   3. Allocation & routing (§22) — candidates with their §21 state
  //   4. Depletion observation (§24) — predicted vs observed
  //   5. Replenishment signals (§26)
  //
  // Every section renders from a stage snapshot. Sections whose stage
  // failed or produced no rows render a named empty state — never a
  // fabricated summary.
  // ------------------------------------------------------------------------

  function ensurePanel() {
    var root = document.getElementById("depletor-console");
    if (!root) { depletWarnMissing("depletor-console"); return null; }

    var existing = document.getElementById("depletor-allocation-runtime");
    if (existing) return existing;

    var s = document.createElement("section");
    s.id = "depletor-allocation-runtime";
    s.className = "depletor-allocation-runtime";
    s.innerHTML =
      '<div class="depletor-heading">' +
        '<div>' +
          '<span class="intel-label">MASTER STOCK DEPLETOR</span>' +
          '<h3>Pipeline output</h3>' +
        '</div>' +
        '<button type="button" id="depletor-allocation-refresh">Refresh</button>' +
      '</div>' +
      '<div id="depletor-allocation-status" class="depletor-empty">Waiting for pipeline evidence…</div>' +
      '<div id="depletor-stock-summary" class="depletor-empty">Stock intelligence not yet run.</div>' +
      '<div id="depletor-radar-summary" class="depletor-empty">Demand radar not yet run.</div>' +
      '<div id="depletor-allocation-list" class="depletor-opportunities"></div>' +
      '<div id="depletor-depletion-summary" class="depletor-empty">Depletion observation not yet run.</div>' +
      '<div id="depletor-replenishment-list" class="depletor-opportunities"></div>';

    var opportunitiesBox = document.getElementById("depletor-opportunities");
    if (opportunitiesBox && opportunitiesBox.parentNode) {
      opportunitiesBox.parentNode.insertBefore(s, opportunitiesBox.nextSibling);
    } else {
      root.appendChild(s);
    }

    var refreshBtn = document.getElementById("depletor-allocation-refresh");
    if (refreshBtn) {
      refreshBtn.addEventListener("click", function () { window.refreshDepletorPipeline(); });
    }
    return s;
  }

  function render(snapshot) {
    ensurePanel();

    var status = document.getElementById("depletor-allocation-status");
    if (!status) return;

    if (!snapshot) {
      var message = state.error && state.error.message;
      status.textContent = message === "AUTH_CONTEXT_UNAVAILABLE"
        ? "Waiting for authenticated distributor context…"
        : "Depletor pipeline unavailable. " + (message || "See console for details.");
      return;
    }

    var stages = snapshot.stages || {};
    var allocation = stages.allocation;
    var opportunity = stages.opportunity;
    var stock = stages.stock;
    var radar = stages.radar;
    var depletion = stages.depletion;
    var replenishment = stages.replenishment;

    // Trace summary for the status line.
    var okCount = snapshot.trace.filter(function (t) { return t.ok; }).length;
    var totalMs = snapshot.trace.reduce(function (s, t) { return s + t.ms; }, 0);
    status.innerHTML =
      "<strong>" + okCount + "/6</strong> stages ok · " +
      totalMs + "ms · pipeline " +
      (snapshot.ok ? "complete" : "partial") +
      " · read-only runtime";

    // --- §15 Stock Intelligence ---
    var stockEl = document.getElementById("depletor-stock-summary");
    if (stockEl) {
      if (!stock || !stock.summary) {
        stockEl.textContent = "Stock intelligence did not complete; health bands unavailable.";
      } else {
        var b = stock.summary.bands || {};
        stockEl.innerHTML =
          '<span class="intel-label">STOCK HEALTH (§15)</span>' +
          '<div class="op-detail">' +
            'Healthy ' + (b.Healthy || 0) + ' · ' +
            'Watch ' + (b.Watch || 0) + ' · ' +
            'Aging ' + (b.Aging || 0) + ' · ' +
            'At Risk ' + (b["At Risk"] || 0) + ' · ' +
            'Critical ' + (b.Critical || 0) +
          '</div>' +
          '<div class="op-detail">' +
            (stock.summary.productCount || 0) + ' product positions · ' +
            (stock.summary.s1Applied
              ? "temporal evidence available (S1 applied)"
              : "temporal evidence MISSING (S1 not applied)") +
          '</div>';
      }
    }

    // --- §17 Demand Radar ---
    var radarEl = document.getElementById("depletor-radar-summary");
    if (radarEl) {
      if (!radar || !radar.summary) {
        radarEl.textContent = "Demand radar did not complete; signal strength unavailable.";
      } else {
        var rb = radar.summary.bands || {};
        radarEl.innerHTML =
          '<span class="intel-label">DEMAND RADAR (§17)</span>' +
          '<div class="op-detail">' +
            'Very high ' + (rb.VERY_HIGH || 0) + ' · ' +
            'High ' + (rb.HIGH || 0) + ' · ' +
            'Moderate ' + (rb.MODERATE || 0) + ' · ' +
            'Low ' + (rb.LOW || 0) +
          '</div>' +
          '<div class="op-detail">' +
            (radar.summary.signalCount || 0) + ' signals · ' +
            (radar.summary.withBehaviour || 0) + ' with behaviour evidence · ' +
            (radar.summary.withRelationship || 0) + ' with relationship evidence' +
          '</div>' +
          (radar.evidence && radar.evidence.behaviour_state && radar.evidence.behaviour_state !== "AVAILABLE"
            ? '<div class="op-detail">Behaviour evidence: ' + esc(radar.evidence.behaviour_state) + '</div>'
            : "");
      }
    }

    // --- §22 Allocation & Routing (candidates with their §21 state) ---
    var list = document.getElementById("depletor-allocation-list");
    if (list) {
      var opps = (opportunity && opportunity.rows) || [];
      var routable = opps.filter(function (o) { return o.opportunity_state === "ROUTING-READY"; });
      var allocated = (allocation && allocation.rows) || [];
      var allocatedOnly = allocated.filter(function (o) {
        return o.opportunity_state === "ALLOCATED" ||
               o.opportunity_state === "IN-MOTION" ||
               o.opportunity_state === "DEPLETED";
      });

      if (!opps.length) {
        list.innerHTML = '<div class="depletor-empty">No evidence-backed opportunity yet.</div>';
      } else {
        list.innerHTML =
          allocatedOnly.slice(0, 6).map(function (o) {
            var isReady = o.opportunity_state === "ALLOCATED" || o.opportunity_state === "IN-MOTION" || o.opportunity_state === "DEPLETED";
            var fit = o.commercial_fit || {};
            var detailQty = o.demanded_quantity
              ? (o.allocatable_quantity || 0).toLocaleString() + " / " + o.demanded_quantity.toLocaleString() + " units allocatable"
              : "Requested quantity unknown";
            var priority = o.depletion_priority && o.depletion_priority.band
              ? o.depletion_priority.band : "NORMAL";
            var nextAction = o.next_action || "NONE";
            return '<div class="opportunity">' +
              '<div class="op-icon">' + (isReady ? "↗" : "⊘") + '</div>' +
              '<div class="op-copy">' +
                '<div class="op-name">Product ' + esc(o.product_id) + '</div>' +
                '<div class="op-detail">' +
                  '<span class="' + (isReady ? "stock-healthy" : "stock-attention") + '">' +
                    esc(o.opportunity_state) +
                  '</span> · ' + esc(detailQty) + ' · priority ' + esc(priority) +
                '</div>' +
                '<div class="op-detail">' +
                  'Tier ' + esc(fit.tier || "UNKNOWN") +
                  (fit.unit_price != null ? ' · ' + esc(String(fit.unit_price)) : "") +
                  ' · next action ' + esc(nextAction) +
                '</div>' +
                '<div class="op-detail">' +
                  'Inquiry ' + esc(o.inquiry_id || "") +
                  ' · relationship ' + esc(o.relationship_id || "none") +
                  (o.relationship_state ? ' (' + esc(o.relationship_state) + ')' : "") +
                '</div>' +
              '</div>' +
            '</div>';
          }).join("") +
          (!allocatedOnly.length
            ? '<div class="depletor-empty">' +
                (routable.length
                  ? routable.length + ' opportunity(ies) are routing-ready but not yet allocated.'
                  : 'No opportunity reached ROUTING-READY.') +
              '</div>'
            : "");
      }
    }

    // --- §24 Depletion observation ---
    var depletionEl = document.getElementById("depletor-depletion-summary");
    if (depletionEl) {
      if (!depletion || !depletion.summary) {
        depletionEl.textContent = "Depletion observation did not complete.";
      } else {
        var od = depletion.summary.byOutcome || {};
        var s2Note = depletion.evidence && depletion.evidence.movements_state;
        depletionEl.innerHTML =
          '<span class="intel-label">DEPLETION OBSERVATION (§24)</span>' +
          '<div class="op-detail">' +
            'Pending ' + (od.PENDING || 0) + ' · ' +
            'Partial ' + (od.PARTIAL || 0) + ' · ' +
            'Confirmed ' + (od.CONFIRMED || 0) + ' · ' +
            'Not observed ' + (od.NOT_OBSERVED || 0) +
          '</div>' +
          (s2Note && s2Note !== "AVAILABLE"
            ? '<div class="op-detail">Stock movement evidence: ' + esc(s2Note) + '</div>'
            : "");
      }
    }

    // --- §26 Replenishment signals ---
    var repList = document.getElementById("depletor-replenishment-list");
    if (repList) {
      if (!replenishment || !replenishment.rows || !replenishment.rows.length) {
        repList.innerHTML = '<div class="depletor-empty">No replenishment signals derived from current evidence.</div>';
      } else {
        repList.innerHTML =
          '<div class="depletor-heading"><div><span class="intel-label">REPLENISHMENT SIGNALS (§26)</span></div></div>' +
          replenishment.rows.slice(0, 6).map(function (s) {
            var urgencyClass = s.urgency === "HIGH" ? "stock-attention" : "stock-healthy";
            return '<div class="opportunity">' +
              '<div class="op-icon">' + (s.urgency === "HIGH" ? "▲" : "▣") + '</div>' +
              '<div class="op-copy">' +
                '<div class="op-name">' + esc(s.product_name || ("Product " + s.product_id)) + '</div>' +
                '<div class="op-detail">' +
                  '<span class="' + urgencyClass + '">' + esc(s.signal_type) + '</span> · ' +
                  'urgency ' + esc(s.urgency) +
                  (s.recommended_quantity != null
                    ? ' · recommend ' + esc(String(s.recommended_quantity)) + ' units'
                    : "") +
                '</div>' +
                '<div class="op-detail">' + esc(s.signal_reason || "") + '</div>' +
              '</div>' +
            '</div>';
          }).join("");
      }
    }
  }

  // ------------------------------------------------------------------------
  // PUBLIC ENTRY
  // ------------------------------------------------------------------------

  window.refreshDepletorPipeline = async function () {
    var root = document.getElementById("depletor-console");
    if (!root) { depletWarnMissing("depletor-console"); return null; }

    var user = null;
    try { user = currentUser; } catch (e) {}
    if (!user || String(user.role || "").toLowerCase() !== "distributor") {
      state.error = new Error("AUTH_CONTEXT_UNAVAILABLE");
      state.snapshot = null;
      render(null);
      return null;
    }

    ensurePanel();

    try {
      return await runPipeline();
    } catch (e) {
      state.error = e;
      state.running = false;
      state.completedAt = new Date().toISOString();
      console.warn("[GoodsbarnX/depletor] pipeline threw:", e);
      render(null);
      return null;
    }
  };

  // Compat alias: the payload's `refreshDepletorAllocation` now runs the full
  // pipeline and returns the §22 allocation rows (the previous shape).
  window.refreshDepletorAllocation = async function () {
    var snapshot = await window.refreshDepletorPipeline();
    return snapshot && snapshot.stages && snapshot.stages.allocation
      ? snapshot.stages.allocation.rows
      : [];
  };

  // ------------------------------------------------------------------------
  // BOOT
  // ------------------------------------------------------------------------

  document.addEventListener("DOMContentLoaded", function () {
    setTimeout(window.refreshDepletorPipeline, 1000);
    setTimeout(window.refreshDepletorPipeline, 2200);
  });

  console.log("[GoodsbarnX] depletar.js conductor loaded (" + VERSION + ")");
})();
