/* ==========================================================================
   GoodsbarnX — js/depletor.js  (rev. 6)
   Master Stock Depletor · Conductor (Canon §14 §27 §34).

   Version: V1.8.2.6
   Load position: 14 (per D13). Loads after js/depletor-replenishment.js,
   before js/behaviour.js.

   rev. 2 — F-1 fix: pipeline boot timing.
   rev. 3 — F-3 fix: allocation panel shows per-opportunity MOQ/stock
                       shortfall instead of the opaque "not yet allocated".
   rev. 4 — F-12 fix: render() removes the `hidden` attribute after
                       successful render for a distributor.
   rev. 5 — Collapsible panel (chevron, persistence, live summary).
   rev. 6 — F-13 fix: panel styles are injected inline, scoped to
                       #depletor-allocation-runtime and its descendants
                       only. No global CSS is touched. Any drift caused by
                       rev. 5's components.css append is reverted by
                       removing that append (see F-13 note in the ledger).

   Canon basis:
     §14  pipeline stage sequencing.
     §22  allocation / matching. §22 decides; the panel describes.
     §34  every element on the panel connects to a Canon stage.
   ========================================================================== */

(function () {
  "use strict";

  var VERSION = "V1.8.2.6";
  var STAGE = "conductor";
  var ISOLATION_MARKER = "V1.8.2.6.8.1.1.8";
  var STORAGE_KEY = "gbx_depletor_console_state";
  var STYLE_ID = "gbx-depletor-panel-style";

  window.goodsbarnxDepletorAllocationVersion = VERSION;
  window.goodsbarnxDepletorIsolationMarker = ISOLATION_MARKER;
  window.goodsbarnxDepletorPipelineVersion = VERSION;

  var state = {
    snapshot: null,
    error: null,
    running: false,
    startedAt: null,
    completedAt: null,
    bootAttempts: 0,
    collapsed: true
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

  function num(v, fallback) {
    var n = Number(v);
    return isFinite(n) ? n : (fallback == null ? 0 : fallback);
  }

  function isDistributor() {
    try {
      return !!(currentUser && String(currentUser.role || "").toLowerCase() === "distributor");
    } catch (e) {
      return false;
    }
  }

  // ------------------------------------------------------------------------
  // SCOPED STYLES — injected once, apply ONLY to the panel subtree.
  //
  // Every selector is either #depletor-allocation-runtime itself or a
  // descendant of it (via the class names that only that subtree uses).
  // No global element or class rule is introduced. If the parent stylesheet
  // changes, this block is unaffected. If this block is removed, the panel
  // still renders — it just becomes a plain unstyled section.
  // ------------------------------------------------------------------------

  function injectPanelStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent =
      "#depletor-allocation-runtime {" +
      "  margin-top: 8px;" +
      "  border-top: 1px solid var(--gbx-line);" +
      "}" +
      "#depletor-allocation-runtime .depletor-header {" +
      "  display: flex;" +
      "  align-items: center;" +
      "  justify-content: space-between;" +
      "  gap: 12px;" +
      "  padding: 14px 13px;" +
      "  cursor: pointer;" +
      "  user-select: none;" +
      "  border-radius: 12px;" +
      "  -webkit-tap-highlight-color: transparent;" +
      "}" +
      "#depletor-allocation-runtime .depletor-header:hover {" +
      "  background: rgba(255, 255, 255, 0.02);" +
      "}" +
      "#depletor-allocation-runtime .depletor-header:focus {" +
      "  outline: 2px solid var(--gbx-emerald);" +
      "  outline-offset: -2px;" +
      "}" +
      "#depletor-allocation-runtime .depletor-header-left {" +
      "  min-width: 0;" +
      "  flex: 1;" +
      "}" +
      "#depletor-allocation-runtime .depletor-header-title {" +
      "  margin-top: 3px;" +
      "  font-size: 13px;" +
      "  font-weight: 700;" +
      "  color: var(--gbx-ivory);" +
      "  letter-spacing: -0.01em;" +
      "}" +
      "#depletor-allocation-runtime .depletor-header-summary {" +
      "  margin-top: 3px;" +
      "  font-size: 10px;" +
      "  color: var(--gbx-muted);" +
      "  line-height: 1.35;" +
      "  white-space: nowrap;" +
      "  overflow: hidden;" +
      "  text-overflow: ellipsis;" +
      "}" +
      "#depletor-allocation-runtime .depletor-header-right {" +
      "  display: flex;" +
      "  align-items: center;" +
      "  gap: 6px;" +
      "  flex: 0 0 auto;" +
      "}" +
      "#depletor-allocation-runtime .depletor-refresh-btn {" +
      "  width: 30px;" +
      "  height: 30px;" +
      "  border: 1px solid var(--gbx-line);" +
      "  border-radius: 9px;" +
      "  background: rgba(255, 255, 255, 0.03);" +
      "  color: var(--gbx-green);" +
      "  font-size: 14px;" +
      "  cursor: pointer;" +
      "  display: grid;" +
      "  place-items: center;" +
      "  padding: 0;" +
      "}" +
      "#depletor-allocation-runtime .depletor-refresh-btn:hover {" +
      "  border-color: rgba(85, 217, 150, 0.4);" +
      "  background: rgba(85, 217, 150, 0.08);" +
      "}" +
      "#depletor-allocation-runtime .depletor-chevron {" +
      "  width: 24px;" +
      "  height: 24px;" +
      "  display: grid;" +
      "  place-items: center;" +
      "  font-size: 18px;" +
      "  line-height: 1;" +
      "  color: var(--gbx-muted);" +
      "  transition: transform 0.2s ease, color 0.2s ease;" +
      "}" +
      "#depletor-allocation-runtime.collapsed .depletor-chevron {" +
      "  transform: rotate(0deg);" +
      "}" +
      "#depletor-allocation-runtime:not(.collapsed) .depletor-chevron {" +
      "  transform: rotate(180deg);" +
      "  color: var(--gbx-green);" +
      "}" +
      "#depletor-allocation-runtime .depletor-body {" +
      "  padding: 4px 13px 14px;" +
      "  border-top: 1px solid var(--gbx-line);" +
      "}" +
      "#depletor-allocation-runtime.collapsed .depletor-body {" +
      "  display: none;" +
      "}";
    document.head.appendChild(style);
  }

  // ------------------------------------------------------------------------
  // PERSISTENCE
  // ------------------------------------------------------------------------

  function readCollapseState() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw === "open") return false;
      if (raw === "closed") return true;
    } catch (e) {}
    return true;
  }

  function writeCollapseState(collapsed) {
    try {
      localStorage.setItem(STORAGE_KEY, collapsed ? "closed" : "open");
    } catch (e) {}
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

    if (!isDistributor()) {
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
  // HEADER SUMMARY
  // ------------------------------------------------------------------------

  function buildHeaderSummary(snapshot) {
    if (!snapshot || !snapshot.stages) return "";
    var radar = snapshot.stages.radar;
    var allocation = snapshot.stages.allocation;
    var replenishment = snapshot.stages.replenishment;

    var signals = (radar && radar.summary && radar.summary.signalCount) || 0;
    var allocated = (allocation && allocation.summary && allocation.summary.allocatedCount) || 0;
    var restock = 0;
    if (replenishment && Array.isArray(replenishment.rows)) {
      restock = replenishment.rows.filter(function (s) {
        return s.signal_type === "RESTOCK_NOW" || s.signal_type === "RESTOCK_SOON";
      }).length;
    }

    var parts = [];
    parts.push(signals + " signal" + (signals === 1 ? "" : "s"));
    parts.push(allocated + " allocated");
    if (restock > 0) parts.push(restock + " restock");
    return parts.join(" · ");
  }

  // ------------------------------------------------------------------------
  // PANEL SHELL
  // ------------------------------------------------------------------------

  function ensurePanel() {
    injectPanelStyles();

    var root = document.getElementById("depletor-console");
    if (!root) { depletWarnMissing("depletor-console"); return null; }

    var existing = document.getElementById("depletor-allocation-runtime");
    if (existing) return existing;

    state.collapsed = readCollapseState();

    var s = document.createElement("section");
    s.id = "depletor-allocation-runtime";
    s.className = "depletor-allocation-runtime" + (state.collapsed ? " collapsed" : "");

    s.innerHTML =
      '<div class="depletor-header" role="button" tabindex="0">' +
        '<div class="depletor-header-left">' +
          '<span class="intel-label">MASTER STOCK DEPLETOR</span>' +
          '<div class="depletor-header-title">Pipeline output</div>' +
          '<div class="depletor-header-summary" id="depletor-header-summary">Waiting for evidence…</div>' +
        '</div>' +
        '<div class="depletor-header-right">' +
          '<button type="button" id="depletor-allocation-refresh" class="depletor-refresh-btn" title="Refresh">↻</button>' +
          '<span class="depletor-chevron" aria-hidden="true">⌄</span>' +
        '</div>' +
      '</div>' +

      '<div class="depletor-body">' +
        '<div id="depletor-allocation-status" class="depletor-empty">Waiting for pipeline evidence…</div>' +
        '<div id="depletor-stock-summary" class="depletor-empty">Stock intelligence not yet run.</div>' +
        '<div id="depletor-radar-summary" class="depletor-empty">Demand radar not yet run.</div>' +
        '<div id="depletor-allocation-list" class="depletor-opportunities"></div>' +
        '<div id="depletor-depletion-summary" class="depletor-empty">Depletion observation not yet run.</div>' +
        '<div id="depletor-replenishment-list" class="depletor-opportunities"></div>' +
      '</div>';

    var opportunitiesBox = document.getElementById("depletor-opportunities");
    if (opportunitiesBox && opportunitiesBox.parentNode) {
      opportunitiesBox.parentNode.insertBefore(s, opportunitiesBox.nextSibling);
    } else {
      root.appendChild(s);
    }

    var header = s.querySelector(".depletor-header");
    if (header) {
      header.addEventListener("click", function (e) {
        if (e.target && e.target.id === "depletor-allocation-refresh") return;
        toggleCollapsed();
      });
      header.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          toggleCollapsed();
        }
      });
    }

    var refreshBtn = document.getElementById("depletor-allocation-refresh");
    if (refreshBtn) {
      refreshBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        window.refreshDepletorPipeline();
      });
    }

    return s;
  }

  function toggleCollapsed() {
    state.collapsed = !state.collapsed;
    writeCollapseState(state.collapsed);
    applyCollapsed();
    if (!state.collapsed) {
      setTimeout(function () {
        var panel = document.getElementById("depletor-allocation-runtime");
        var header = panel && panel.querySelector(".depletor-header");
        if (header) header.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 60);
    }
  }

  function applyCollapsed() {
    var panel = document.getElementById("depletor-allocation-runtime");
    if (!panel) return;
    if (state.collapsed) panel.classList.add("collapsed");
    else panel.classList.remove("collapsed");
  }

  window.goodsbarnxDepletorExpand = function () {
    ensurePanel();
    state.collapsed = false;
    writeCollapseState(false);
    applyCollapsed();
  };

  // ------------------------------------------------------------------------
  // REVEAL — F-12
  // ------------------------------------------------------------------------

  function removeHiddenIfReady() {
    var root = document.getElementById("depletor-console");
    if (!root) return;
    if (!isDistributor()) return;

    var status = document.getElementById("depletor-allocation-status");
    if (!status) return;
    var text = String(status.textContent || "").trim();
    if (!text || text.indexOf("Waiting for") === 0) return;

    if (root.hasAttribute("hidden")) {
      root.removeAttribute("hidden");
      console.log("[GoodsbarnX/depletor] panel revealed for distributor");
    }
  }

  // ------------------------------------------------------------------------
  // F-3: allocation blocker description
  // ------------------------------------------------------------------------

  function describeAllocationBlocker(row) {
    var e = row.evidence || {};
    var constraints = e.commercial_constraints || {};
    var demanded = num(row.demanded_quantity, 0);
    var available = num(row.stock_quantity, 0);
    var moq = num(constraints.moq, 1);
    var moqOk = constraints.moq_satisfied === true;
    var productLabel = row.what || ("Product " + (row.product_id || "?"));

    var lines = [];

    if (!moqOk) {
      var shortfall = Math.max(0, moq - demanded);
      lines.push(
        productLabel + " — demanded " + demanded.toLocaleString() +
        ", MOQ " + moq.toLocaleString() +
        " (shortfall " + shortfall.toLocaleString() + ")"
      );
    } else if (demanded > 0 && available < demanded) {
      lines.push(
        productLabel + " — demanded " + demanded.toLocaleString() +
        ", stock " + available.toLocaleString() +
        " (shortfall " + Math.max(0, demanded - available).toLocaleString() + ")"
      );
    } else if (demanded === 0) {
      lines.push(productLabel + " — demanded quantity unknown");
    } else {
      lines.push(productLabel + " — not allocated; see next action");
    }

    if (row.next_action) {
      lines.push("Next action: " + row.next_action);
    }

    return lines;
  }

  function renderAllocationBlockers(routableRows) {
    if (!routableRows.length) {
      return '<div class="depletor-empty">No opportunity reached ROUTING-READY.</div>';
    }
    var blocks = routableRows.slice(0, 6).map(function (row) {
      var lines = describeAllocationBlocker(row);
      return '<div class="opportunity">' +
        '<div class="op-icon">⊘</div>' +
        '<div class="op-copy">' +
          '<div class="op-name">' + esc(lines[0] || "Routing-ready; not allocated") + '</div>' +
          (lines.slice(1).map(function (l) {
            return '<div class="op-detail">' + esc(l) + '</div>';
          }).join("")) +
        '</div>' +
      '</div>';
    }).join("");
    return blocks;
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
      var summaryEl0 = document.getElementById("depletor-header-summary");
      if (summaryEl0) summaryEl0.textContent = "Pipeline unavailable";
      return;
    }

    var stages = snapshot.stages || {};
    var allocation = stages.allocation;
    var opportunity = stages.opportunity;
    var stock = stages.stock;
    var radar = stages.radar;
    var depletion = stages.depletion;
    var replenishment = stages.replenishment;

    var summaryEl = document.getElementById("depletor-header-summary");
    if (summaryEl) summaryEl.textContent = buildHeaderSummary(snapshot) || "No signals yet";

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
      } else if (allocatedOnly.length) {
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
          }).join("");
      } else {
        var routableAllocatedRows = allocated.filter(function (o) {
          return o.opportunity_state === "ROUTING-READY";
        });
        list.innerHTML = renderAllocationBlockers(routableAllocatedRows);
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

    removeHiddenIfReady();
  }

  // ------------------------------------------------------------------------
  // PUBLIC ENTRY
  // ------------------------------------------------------------------------

  window.refreshDepletorPipeline = async function () {
    var root = document.getElementById("depletor-console");
    if (!root) { depletWarnMissing("depletor-console"); return null; }

    if (!isDistributor()) {
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
  // BOOT
  // ------------------------------------------------------------------------

  function attemptBoot(reason) {
    state.bootAttempts++;
    if (!isDistributor()) {
      console.log("[GoodsbarnX/depletor] boot attempt " + state.bootAttempts +
                  " (" + reason + "): no distributor context yet; will retry on auth-state-changed");
      return false;
    }
    console.log("[GoodsbarnX/depletor] boot attempt " + state.bootAttempts +
                " (" + reason + "): distributor context present; running pipeline");
    window.refreshDepletorPipeline();
    return true;
  }

  document.addEventListener("DOMContentLoaded", function () {
    setTimeout(function () { attemptBoot("DOMContentLoaded+1000"); }, 1000);
    setTimeout(function () { attemptBoot("DOMContentLoaded+2200"); }, 2200);

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

  window.addEventListener("auth-state-changed", function (event) {
    var user = event && event.detail ? event.detail.user : null;
    if (!user) return;
    if (String(user.role || "").toLowerCase() !== "distributor") return;
    console.log("[GoodsbarnX/depletor] auth-state-changed fired; running pipeline");
    setTimeout(function () { attemptBoot("auth-state-changed"); }, 50);
  });

  window.addEventListener("supabase-ready", function () {
    if (state.snapshot) return;
    console.log("[GoodsbarnX/depletor] supabase-ready fired; will attempt pipeline");
    setTimeout(function () { attemptBoot("supabase-ready"); }, 100);
  });

  console.log("[GoodsbarnX] depletar.js conductor loaded (" + VERSION + " rev.6)");
})();
