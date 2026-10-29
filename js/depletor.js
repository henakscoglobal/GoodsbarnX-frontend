/* ==========================================================================
   GoodsbarnX — js/depletor.js  (rev. 2)
   Master Stock Depletor · Conductor (Canon §14 §27 §34).

   Version: V1.8.2.6
   Load position: 14 (per D13). Loads after js/depletor-replenishment.js,
   before js/behaviour.js.

   Phase 6 Step 6 (F-1 fix):
     The original conductor scheduled its first run on
     DOMContentLoaded+1000ms and +2200ms. If auth resolution took longer
     than that (Supabase getUser + profile fetch + distributor_profile
     fetch commonly take 800–1500ms), the guard `if (!currentUser)` at
     the top of refreshDepletorPipeline short-circuited and the pipeline
     never ran. No retry, no listener to catch the late auth.

     rev. 2 adds three boot paths that all funnel into the same
     refreshDepletorPipeline:
       1. The existing DOMContentLoaded timers, unchanged.
       2. An `auth-state-changed` listener — fires when auth.js resolves
          or when a new session is dispatched.
       3. A `supabase-ready` listener — fires when config.js's
          connectivity test succeeds.
     Plus a bounded retry chain: if the first three attempts all saw
     AUTH_CONTEXT_UNAVAILABLE, retry once at +5s and once at +15s after
     the last attempt. If those also fail, log a named warning and stop.

   Canon basis:
     §14  seven-stage pipeline; conductor sequences.
     §27  the pipeline is a closed loop.
     §29  evidence integrity — this file does not produce evidence.
     §30  canonical Opportunity object; the conductor does not re-shape it.
     §34  every element on the panel connects to a Canon stage.

   This file owns:
     - runPipeline(): the full seven-stage sequence.
     - render()     : the depletor console panel.
     - public entry : window.refreshDepletorPipeline (full),
                      window.refreshDepletorAllocation (compat).
   ========================================================================== */

(function () {
  "use strict";

  var VERSION = "V1.8.2.6";
  var STAGE = "conductor";
  var ISOLATION_MARKER = "V1.8.2.6.8.1.1.8";

  window.goodsbarnxDepletorAllocationVersion = VERSION;
  window.goodsbarnxDepletorIsolationMarker = ISOLATION_MARKER;
  window.goodsbarnxDepletorPipelineVersion = VERSION;

  var state = {
    snapshot: null,
    error: null,
    running: false,
    startedAt: null,
    completedAt: null,
    bootAttempts: 0
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
  // FULL PIPELINE
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

    var t1 = await runStage("stock", window.goodsbarnxDepletorStock.run, null);
    trace.push({ stage: "stock", ok: t1.ok, ms: t1.ms, error: t1.error ? t1.error.message : null });
    var stockSnapshot = t1.result;

    var t2 = await runStage("radar", function () {
      return window.goodsbarnxDepletorRadar.run(stockSnapshot);
    }, null);
    trace.push({ stage: "radar", ok: t2.ok, ms: t2.ms, error: t2.error ? t2.error.message : null });
    var radarSnapshot = t2.result;

    var t3 = await runStage("opportunity", function () {
      return Promise.resolve(window.goodsbarnxDepletorOpportunity.run(stockSnapshot, radarSnapshot));
    }, null);
    trace.push({ stage: "opportunity", ok: t3.ok, ms: t3.ms, error: t3.error ? t3.error.message : null });
    var opportunitySnapshot = t3.result;

    var t4 = await runStage("allocation", function () {
      return window.goodsbarnxDepletorAllocation.run(opportunitySnapshot);
    }, null);
    trace.push({ stage: "allocation", ok: t4.ok, ms: t4.ms, error: t4.error ? t4.error.message : null });
    var allocationSnapshot = t4.result;

    var t5 = await runStage("depletion", function () {
      return window.goodsbarnxDepletorDepletion.run(allocationSnapshot);
    }, null);
    trace.push({ stage: "depletion", ok: t5.ok, ms: t5.ms, error: t5.error ? t5.error.message : null });
    var depletionSnapshot = t5.result;

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

    var okCount = snapshot.trace.filter(function (t) { return t.ok; }).length;
    var totalMs = snapshot.trace.reduce(function (s, t) { return s + t.ms; }, 0);
    status.innerHTML =
      "<strong>" + okCount + "/6</strong> stages ok · " +
      totalMs + "ms · pipeline " +
      (snapshot.ok ? "complete" : "partial") +
      " · read-only runtime";

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

  window.refreshDepletorAllocation = async function () {
    var snapshot = await window.refreshDepletorPipeline();
    return snapshot && snapshot.stages && snapshot.stages.allocation
      ? snapshot.stages.allocation.rows
      : [];
  };

  // ------------------------------------------------------------------------
  // BOOT — three paths into the same entry point, plus bounded retry
  //
  // Rationale for rev. 2:
  //   The auth pipeline (getUser → profile → distributor_profile) commonly
  //   takes 800–1500ms. DOMContentLoaded fires before that. The original
  //   timers at +1000ms and +2200ms sometimes landed before auth resolved,
  //   in which case refreshDepletorPipeline saw !currentUser and gave up.
  //   This session's diagnostic report showed exactly that: auth resolved
  //   at +1000ms, pipeline never produced a snapshot.
  //
  //   rev. 2 adds three boot paths and a bounded retry. If any path succeeds
  //   in producing a snapshot, later retries stop. If all attempts fail,
  //   one named warning is logged and the retry chain stops.
  // ------------------------------------------------------------------------

  function attemptBoot(reason) {
    state.bootAttempts++;
    var user = null;
    try { user = currentUser; } catch (e) {}
    if (!user || String(user.role || "").toLowerCase() !== "distributor") {
      // Not a distributor yet. The listener will fire again on auth-state-changed.
      console.log("[GoodsbarnX/depletor] boot attempt " + state.bootAttempts +
                  " (" + reason + "): no distributor context yet; will retry on auth-state-changed");
      return false;
    }
    console.log("[GoodsbarnX/depletor] boot attempt " + state.bootAttempts +
                " (" + reason + "): distributor context present; running pipeline");
    window.refreshDepletorPipeline();
    return true;
  }

  // Path 1 — DOMContentLoaded timers (unchanged from File 20)
  document.addEventListener("DOMContentLoaded", function () {
    setTimeout(function () { attemptBoot("DOMContentLoaded+1000"); }, 1000);
    setTimeout(function () { attemptBoot("DOMContentLoaded+2200"); }, 2200);

    // Path 4 — bounded retry at +5s and +15s, only if still no snapshot
    setTimeout(function () {
      if (!state.snapshot) {
        console.warn("[GoodsbarnX/depletor] retry at +5s (no snapshot yet)");
        attemptBoot("retry+5000");
      }
    }, 5000);
    setTimeout(function () {
      if (!state.snapshot) {
        console.warn("[GoodsbarnX/depletor] retry at +15s (no snapshot yet)");
        attemptBoot("retry+15000");
      }
    }, 15000);
  });

  // Path 2 — auth resolution. auth.js dispatches this after loadCurrentUser.
  window.addEventListener("auth-state-changed", function (event) {
    var user = event && event.detail ? event.detail.user : null;
    if (!user) return;
    if (String(user.role || "").toLowerCase() !== "distributor") return;
    console.log("[GoodsbarnX/depletor] auth-state-changed fired; running pipeline");
    setTimeout(function () { attemptBoot("auth-state-changed"); }, 50);
  });

  // Path 3 — supabase-ready. config.js dispatches this on connectivity success.
  window.addEventListener("supabase-ready", function () {
    if (state.snapshot) return;
    console.log("[GoodsbarnX/depletor] supabase-ready fired; will attempt pipeline");
    setTimeout(function () { attemptBoot("supabase-ready"); }, 100);
  });

  console.log("[GoodsbarnX] depletar.js conductor loaded (" + VERSION + " rev.2)");
})();
