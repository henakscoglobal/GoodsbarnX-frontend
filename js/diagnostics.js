/* ==========================================================================
   GoodsbarnX — js/diagnostics.js
   Diagnostic observability panel.

   Version: V1.8.2.6
   Load position: 22 (after js/agent.js, before js/app.js).

   GATE:
     This module is inert unless the URL contains ?diagnostics=1.
     When absent, the module loads, logs one line, and returns.
     No DOM nodes, no Supabase calls, no runtime state touched.

   WHEN ACTIVE:
     A "🔬" button is added to the header (next to the logout holder).
     Tapping it opens a full-screen report with seven sections:
       1. Environment
       2. Module load report (all 23 expected modules)
       3. MSD pipeline snapshot (window.goodsbarnxDepletorPipelineSnapshot)
       4. Live RPC probes (5 read-only RPCs)
       5. Table read probes (5 scoped .select().limit(3))
       6. Behaviour instrumentation state
       7. Copy button — copies the whole report as plain text

   WHAT IT DOES NOT DO:
     - Does NOT write to any table.
     - Does NOT call record_buyer_behavior_event (the only writing RPC
       the client normally invokes).
     - Does NOT call execute_depletion_transaction (the only stock-mutating
       RPC in the server).
     - Does NOT mutate currentUser, relationship state, or cart state.
     - Does NOT modify the DOM when the gate is off.

   WHY IT EXISTS:
     The audit that produced V1.8.2.6 verified the client against the Canon
     and against the server schema. It cannot verify that the client, at
     runtime, sees what it expects to see. This panel closes that gap by
     surfacing what the client actually receives from the server, in one
     copyable report.
   ========================================================================== */

(function () {
  "use strict";

  var VERSION = "V1.8.2.6";
  var PARAM = "diagnostics";

  // ------------------------------------------------------------------------
  // GATE
  // ------------------------------------------------------------------------

  var enabled = false;
  try {
    enabled = new URLSearchParams(window.location.search).get(PARAM) === "1";
  } catch (e) {
    enabled = false;
  }

  if (!enabled) {
    console.log("[GoodsbarnX/diagnostics] gate off (add ?diagnostics=1 to activate)");
    return;
  }

  console.log("[GoodsbarnX/diagnostics] gate on — button will appear once app initialises");

  // ------------------------------------------------------------------------
  // SMALL HELPERS
  // ------------------------------------------------------------------------

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c];
    });
  }

  function safe(fn, fallback) {
    try { return fn(); } catch (e) { return fallback; }
  }

  function now() { return new Date().toISOString(); }

  function msSince(t0) { return Date.now() - t0; }

  function truncate(v, n) {
    var s = typeof v === "string" ? v : JSON.stringify(v);
    if (s == null) return "null";
    return s.length > n ? s.slice(0, n) + "…" : s;
  }

  // ------------------------------------------------------------------------
  // MODULE LOAD REPORT
  //
  // For each expected module, name the global it is expected to expose.
  // A missing global means the module did not load or threw at parse.
  // ------------------------------------------------------------------------

  var MODULES = [
    { file: "config.js",                global: null,                     note: "side-effect: window.sb, initializeSupabase" },
    { file: "ui.js",                    global: "registerScreenLoader",   note: "showScreen + loader registry" },
    { file: "auth.js",                  global: "loadCurrentUser",        note: "single auth execution boundary" },
    { file: "market.js",                global: "loadDistributorsAndBuyers", note: "market + network summary" },
    { file: "inquiries.js",             global: "submitInquiry",          note: "inquiry submission + ledger" },
    { file: "storefront.js",            global: "openStorefrontModal",    note: "storefront + §31 pricing" },
    { file: "cart.js",                  global: "addToCart",              note: "cart (localStorage)" },
    { file: "depletor-stock.js",        global: "goodsbarnxDepletorStock",        note: "MSD §15/§16" },
    { file: "depletor-radar.js",        global: "goodsbarnxDepletorRadar",        note: "MSD §17/§18" },
    { file: "depletor-opportunity.js",  global: "goodsbarnxDepletorOpportunity",  note: "MSD §20/§21/§30" },
    { file: "depletor-allocation.js",   global: "goodsbarnxDepletorAllocation",   note: "MSD §22/§23/§31" },
    { file: "depletor-depletion.js",    global: "goodsbarnxDepletorDepletion",    note: "MSD §24/§25" },
    { file: "depletor-replenishment.js",global: "goodsbarnxDepletorReplenishment",note: "MSD §26" },
    { file: "depletor.js",              global: "refreshDepletorPipeline", note: "MSD conductor + §34 panel" },
    { file: "behaviour.js",             global: "goodsbarnxBehaviourState",       note: "§28 instrumentation" },
    { file: "products.js",              global: "loadProductsManagement",         note: "product management" },
    { file: "trust.js",                 global: "loadTrustData",                  note: "§8 trust signals" },
    { file: "profile.js",               global: "loadProfile",                    note: "profile load/save" },
    { file: "upgrade.js",               global: "loadUpgradeScreen",              note: "upgrade plans" },
    { file: "staff.js",                 global: "loadStaff",                      note: "staff invitations" },
    { file: "relationship.js",          global: "loadMyTradeRelationships",       note: "§6/§7 relationship layer" },
    { file: "agent.js",                 global: "loadAgentScreen",                note: "agent attachments + referral" },
    { file: "app.js",                   global: "updateGreeting",                 note: "app init + global state" }
  ];

  function probeModules() {
    var out = [];
    for (var i = 0; i < MODULES.length; i++) {
      var m = MODULES[i];
      var present = null;
      if (m.global) {
        present = typeof window[m.global] !== "undefined";
      } else {
        // config.js is checked by side effect.
        present = (typeof window.sb !== "undefined" && window.sb !== null);
      }
      out.push({ file: m.file, global: m.global, present: present, note: m.note });
    }
    return out;
  }

  // ------------------------------------------------------------------------
  // ENVIRONMENT
  // ------------------------------------------------------------------------

  function probeEnvironment() {
    var cu = null;
    try { cu = currentUser; } catch (e) {}
    var authCtx = safe(function () { return window.getGoodsbarnXAuthContext(); }, null);
    var sbOk = (typeof window.sb !== "undefined" && window.sb !== null);
    var sbHasFrom = sbOk && typeof window.sb.from === "function";
    var sbIsMock = false;
    try {
      // Mock from config.js uses a Proxy that returns the same object for
      // every chain method. Detect by checking whether sb.auth.onAuthStateChange
      // returns a stub subscription with no real callback behaviour.
      // A simpler heuristic: real clients have a `realtime` property.
      sbIsMock = sbOk && !window.sb.realtime;
    } catch (e) {}

    return {
      url: window.location.href,
      at: now(),
      sb_present: sbOk,
      sb_has_from: sbHasFrom,
      sb_looks_like_mock: sbIsMock,
      auth_context: authCtx,
      current_user: cu ? {
        id: cu.id || null,
        role: cu.role || null,
        full_name: cu.full_name || null,
        business_name: cu.business_name || null
      } : null,
      msd_version: safe(function () { return window.goodsbarnxDepletorAllocationVersion; }, null),
      msd_pipeline_version: safe(function () { return window.goodsbarnxDepletorPipelineVersion; }, null),
      behaviour_version: safe(function () {
        var s = window.goodsbarnxBehaviourState && window.goodsbarnxBehaviourState();
        return s ? s.version : null;
      }, null)
    };
  }

  // ------------------------------------------------------------------------
  // PIPELINE SNAPSHOT
  // ------------------------------------------------------------------------

  function probePipeline() {
    var snap = safe(function () { return window.goodsbarnxDepletorPipelineSnapshot; }, null);
    if (!snap) return { available: false };
    var stages = snap.stages || {};
    var stageLines = [];
    Object.keys(stages).forEach(function (name) {
      var s = stages[name];
      if (!s) {
        stageLines.push({ name: name, present: false });
        return;
      }
      stageLines.push({
        name: name,
        present: true,
        version: s.version || null,
        generatedAt: s.generatedAt || null,
        rowCount: Array.isArray(s.rows) ? s.rows.length : null,
        summary: s.summary || null,
        evidence: s.evidence || null
      });
    });
    return {
      available: true,
      version: snap.version || null,
      ok: !!snap.ok,
      generatedAt: snap.generatedAt || null,
      startedAt: snap.startedAt || null,
      trace: Array.isArray(snap.trace) ? snap.trace : [],
      stages: stageLines
    };
  }

  // ------------------------------------------------------------------------
  // RPC PROBES
  //
  // All read-only. Called only when the panel is opened.
  // ------------------------------------------------------------------------

  async function probeRpc(name, args, describe) {
    var t0 = Date.now();
    if (!window.sb || typeof window.sb.rpc !== "function") {
      return { name: name, ok: false, ms: 0, error: "sb.rpc unavailable" };
    }
    try {
      var r = await window.sb.rpc(name, args || {});
      var ms = msSince(t0);
      if (r && r.error) {
        return { name: name, ok: false, ms: ms, error: r.error.message || String(r.error) };
      }
      var data = (r && r.data) || null;
      return {
        name: name,
        ok: true,
        ms: ms,
        top_keys: data && typeof data === "object" && !Array.isArray(data)
          ? Object.keys(data).slice(0, 20)
          : (Array.isArray(data) ? ["<array length=" + data.length + ">"] : []),
        describe: describe ? describe(data) : null,
        size: data ? JSON.stringify(data).length : 0
      };
    } catch (e) {
      return { name: name, ok: false, ms: msSince(t0), error: (e && e.message) || String(e) };
    }
  }

  async function probeRpcs(cu) {
    var out = [];
    if (!cu || cu.role !== "distributor") {
      out.push({ name: "all distributor RPCs", ok: false, ms: 0, error: "current user is not a distributor; RPC probes skipped" });
      return out;
    }
    out.push(await probeRpc("get_depletion_observations", { p_distributor_id: cu.id }, function (d) {
      return d && typeof d === "object" ? "observation_count=" + (d.observation_count || 0) : "non-object";
    }));
    out.push(await probeRpc("get_relationship_graph", { p_distributor_id: cu.id }, function (d) {
      return d && typeof d === "object"
        ? "nodes=" + (d.node_count || 0) + " edges=" + (d.edge_count || 0)
        : "non-object";
    }));
    out.push(await probeRpc("get_blocked_opportunities", { p_distributor_id: cu.id }, function (d) {
      return d && typeof d === "object"
        ? "row_count=" + (d.row_count || 0)
        : (Array.isArray(d) ? "array length=" + d.length : "non-object");
    }));

    // Probe get_routing_options with a real product+buyer if the MSD pipeline
    // has produced any opportunity. Otherwise report skip.
    var snap = safe(function () { return window.goodsbarnxDepletorPipelineSnapshot; }, null);
    var opportunities = snap && snap.stages && snap.stages.opportunity && snap.stages.opportunity.rows;
    var firstPair = null;
    if (Array.isArray(opportunities)) {
      for (var i = 0; i < opportunities.length; i++) {
        var o = opportunities[i];
        if (o && o.product_id && o.buyer_id) { firstPair = { product_id: o.product_id, buyer_id: o.buyer_id }; break; }
      }
    }
    if (firstPair) {
      out.push(await probeRpc("get_routing_options", { p_product_id: firstPair.product_id, p_buyer_id: firstPair.buyer_id }, function (d) {
        return d && typeof d === "object"
          ? "path_count=" + (d.path_count || 0) + (d.provisional ? " (provisional)" : "")
          : "non-object";
      }));
    } else {
      out.push({ name: "get_routing_options", ok: null, ms: 0, error: null, describe: "skipped — no opportunity with product_id + buyer_id in current pipeline snapshot" });
    }
    return out;
  }

  // ------------------------------------------------------------------------
  // TABLE READ PROBES
  //
  // Each is a scoped, bounded read confirming RLS permits what the client
  // expects to see. All reads. All limited to 3 rows.
  // ------------------------------------------------------------------------

  async function probeTable(table, queryFn, describe) {
    if (!window.sb || typeof window.sb.from !== "function") {
      return { table: table, ok: false, error: "sb.from unavailable" };
    }
    var t0 = Date.now();
    try {
      var r = await queryFn(window.sb);
      var ms = msSince(t0);
      if (r && r.error) {
        return { table: table, ok: false, ms: ms, error: r.error.message || String(r.error) };
      }
      var rows = Array.isArray(r.data) ? r.data : (r.data ? [r.data] : []);
      return {
        table: table,
        ok: true,
        ms: ms,
        row_count: rows.length,
        describe: describe ? describe(rows) : null
      };
    } catch (e) {
      return { table: table, ok: false, ms: msSince(t0), error: (e && e.message) || String(e) };
    }
  }

  async function probeTables(cu) {
    var out = [];
    out.push(await probeTable("products", function (sb) {
      return sb.from("products").select("id,name,stock_quantity,status").limit(3);
    }, function (rows) {
      return rows.map(function (r) { return (r.name || "unnamed") + " stock=" + r.stock_quantity; }).join(" · ");
    }));

    if (cu && cu.role === "distributor") {
      out.push(await probeTable("inquiries (distributor-scoped)", function (sb) {
        return sb.from("inquiries").select("id,item,quantity,status").eq("distributor_id", cu.id).limit(3);
      }, function (rows) {
        return rows.map(function (r) { return (r.item || "no item") + " status=" + r.status; }).join(" · ");
      }));
      out.push(await probeTable("trade_relationships (distributor-scoped)", function (sb) {
        return sb.from("trade_relationships").select("id,buyer_id,status,is_primary").eq("distributor_id", cu.id).limit(3);
      }, function (rows) {
        return rows.map(function (r) { return r.status + (r.is_primary ? "*" : ""); }).join(" · ");
      }));
      out.push(await probeTable("buyer_behavior_events", function (sb) {
        return sb.from("buyer_behavior_events").select("id,buyer_id,event_type").limit(3);
      }, function (rows) {
        return rows.map(function (r) { return (r.event_type || "?") + " " + String(r.buyer_id || "").slice(0, 8); }).join(" · ");
      }));
      out.push(await probeTable("agent_distributor_attachments (distributor-scoped)", function (sb) {
        return sb.from("agent_distributor_attachments").select("id,agent_id,status").eq("distributor_id", cu.id).limit(3);
      }, function (rows) {
        return rows.map(function (r) { return r.status; }).join(" · ");
      }));
    } else {
      out.push({ table: "(distributor-only probes)", ok: null, describe: "skipped — current user is not a distributor" });
    }
    return out;
  }

  // ------------------------------------------------------------------------
  // BEHAVIOUR STATE
  // ------------------------------------------------------------------------

  function probeBehaviour() {
    if (typeof window.goodsbarnxBehaviourState !== "function") {
      return { available: false };
    }
    var s = safe(function () { return window.goodsbarnxBehaviourState(); }, null);
    if (!s) return { available: false };
    return {
      available: true,
      version: s.version || null,
      buyer_session: !!s.buyer_session,
      emitted: s.emitted || 0,
      emitted_with_missing_context: s.emitted_with_missing_context || 0,
      failed: s.failed || 0,
      last_failure: s.last_failure || null,
      recent_count: Array.isArray(s.recent) ? s.recent.length : 0
    };
  }

  // ------------------------------------------------------------------------
  // RENDER
  // ------------------------------------------------------------------------

  var report = { state: "NOT_RUN", built_at: null };

  function mountButton() {
    var holder = document.getElementById("logout-btn-holder");
    if (!holder) return false;
    if (document.getElementById("gbx-diag-open-btn")) return true;
    var btn = document.createElement("button");
    btn.id = "gbx-diag-open-btn";
    btn.type = "button";
    btn.textContent = "🔬";
    btn.title = "Open diagnostic panel";
    btn.style.cssText =
      "background:none;border:1px solid var(--gbx-line);border-radius:8px;" +
      "padding:6px 10px;font-size:14px;cursor:pointer;color:var(--gbx-ivory);" +
      "margin-left:8px;";
    btn.onclick = openPanel;
    holder.parentNode.insertBefore(btn, holder);
    return true;
  }

  async function buildReport() {
    var cu = null;
    try { cu = currentUser; } catch (e) {}

    report.state = "RUNNING";
    renderReport();

    var env = probeEnvironment();
    var modules = probeModules();
    var pipeline = probePipeline();
    var rpcs = await probeRpcs(cu);
    var tables = await probeTables(cu);
    var behaviour = probeBehaviour();

    report = {
      state: "BUILT",
      built_at: now(),
      environment: env,
      modules: modules,
      pipeline: pipeline,
      rpcs: rpcs,
      tables: tables,
      behaviour: behaviour
    };
    renderReport();
  }

  function renderReport() {
    var el = document.getElementById("gbx-diag-body");
    if (!el) return;

    if (report.state === "NOT_RUN") {
      el.innerHTML = '<div class="loading-text">Press "Rebuild" to collect a fresh report.</div>';
      return;
    }
    if (report.state === "RUNNING") {
      el.innerHTML = '<div class="loading-text">Collecting… (this calls 5 read-only RPCs and 5 scoped reads)</div>';
      return;
    }

    var html = "";

    // Environment
    html += sectionHeader("1. ENVIRONMENT");
    html += kvTable(report.environment);

    // Modules
    html += sectionHeader("2. MODULE LOAD REPORT");
    html += modulesTable(report.modules);

    // Pipeline
    html += sectionHeader("3. MSD PIPELINE SNAPSHOT");
    html += pipelineBlock(report.pipeline);

    // RPCs
    html += sectionHeader("4. LIVE RPC PROBES");
    html += rpcTable(report.rpcs);

    // Tables
    html += sectionHeader("5. TABLE READ PROBES");
    html += tableTable(report.tables);

    // Behaviour
    html += sectionHeader("6. BEHAVIOUR INSTRUMENTATION");
    html += kvTable(report.behaviour);

    el.innerHTML = html;
  }

  function sectionHeader(t) {
    return '<div style="margin-top:20px;padding-top:14px;border-top:1px solid var(--gbx-line);' +
      'font-size:10px;font-weight:800;letter-spacing:.14em;color:var(--gbx-green);">' + esc(t) + '</div>';
  }

  function kvTable(obj) {
    if (!obj) return '<div class="m-loc">null</div>';
    var rows = Object.keys(obj).map(function (k) {
      var v = obj[k];
      var display = (v && typeof v === "object") ? JSON.stringify(v) : String(v);
      return '<div style="display:flex;justify-content:space-between;gap:10px;padding:4px 0;font-size:10px;">' +
        '<span style="color:var(--gbx-muted);flex:0 0 45%;word-break:break-all;">' + esc(k) + '</span>' +
        '<span style="color:var(--gbx-ivory);flex:1;text-align:right;word-break:break-all;font-family:var(--font-mono);">' +
          esc(truncate(display, 200)) +
        '</span>' +
      '</div>';
    }).join("");
    return '<div style="padding:10px;background:rgba(255,255,255,.03);border-radius:10px;">' + rows + '</div>';
  }

  function modulesTable(mods) {
    var bad = mods.filter(function (m) { return m.present === false; }).length;
    var html = '<div style="font-size:10px;margin-bottom:8px;color:' +
      (bad === 0 ? "var(--gbx-green)" : "var(--gbx-danger)") + ';font-weight:700;">' +
      (bad === 0 ? "ALL " + mods.length + " MODULES PRESENT" : bad + " of " + mods.length + " MODULES MISSING") +
      '</div>';
    html += mods.map(function (m) {
      var present = m.present !== false;
      var color = present ? "var(--gbx-green)" : "var(--gbx-danger)";
      return '<div style="display:flex;gap:8px;padding:3px 0;font-size:10px;font-family:var(--font-mono);">' +
        '<span style="color:' + color + ';flex:0 0 20px;">' + (present ? "✓" : "✗") + '</span>' +
        '<span style="color:var(--gbx-ivory);flex:0 0 160px;">' + esc(m.file) + '</span>' +
        '<span style="color:var(--gbx-muted);flex:1;">' + esc(m.global || "(side-effect)") + '</span>' +
      '</div>';
    }).join("");
    return '<div style="padding:10px;background:rgba(255,255,255,.03);border-radius:10px;">' + html + '</div>';
  }

  function pipelineBlock(p) {
    if (!p || !p.available) {
      return '<div class="m-loc" style="padding:10px;background:rgba(255,255,255,.03);border-radius:10px;">' +
        'Pipeline snapshot not yet produced. The conductor runs on DOMContentLoaded +1s and +2.2s. Wait a moment and rebuild.</div>';
    }
    var html = '<div style="font-size:10px;margin-bottom:8px;color:' +
      (p.ok ? "var(--gbx-green)" : "var(--gbx-gold)") + ';font-weight:700;">' +
      'version=' + esc(p.version) + ' · ok=' + p.ok + ' · generated=' + esc(p.generatedAt) +
      '</div>';

    html += '<div style="font-size:9px;font-weight:700;color:var(--gbx-muted);margin-top:8px;letter-spacing:.1em;">TRACE</div>';
    html += (p.trace || []).map(function (t) {
      var color = t.ok ? "var(--gbx-green)" : "var(--gbx-danger)";
      return '<div style="display:flex;gap:8px;padding:2px 0;font-size:10px;font-family:var(--font-mono);">' +
        '<span style="color:' + color + ';flex:0 0 20px;">' + (t.ok ? "✓" : "✗") + '</span>' +
        '<span style="color:var(--gbx-ivory);flex:0 0 120px;">' + esc(t.stage) + '</span>' +
        '<span style="color:var(--gbx-muted);flex:0 0 60px;">' + (t.ms || 0) + 'ms</span>' +
        '<span style="color:var(--gbx-muted);flex:1;">' + esc(t.error || "") + '</span>' +
      '</div>';
    }).join("");

    html += '<div style="font-size:9px;font-weight:700;color:var(--gbx-muted);margin-top:12px;letter-spacing:.1em;">STAGES</div>';
    html += (p.stages || []).map(function (s) {
      if (!s.present) {
        return '<div style="font-size:10px;padding:2px 0;color:var(--gbx-danger);">✗ ' + esc(s.name) + ' — null</div>';
      }
      var summaryStr = s.summary ? truncate(JSON.stringify(s.summary), 300) : "(none)";
      return '<div style="padding:6px 0;font-size:10px;border-top:1px dashed var(--gbx-line);">' +
        '<div style="color:var(--gbx-ivory);font-weight:700;">' + esc(s.name) + ' · rows=' + (s.rowCount == null ? "?" : s.rowCount) + '</div>' +
        '<div style="color:var(--gbx-muted);font-family:var(--font-mono);margin-top:3px;word-break:break-all;">' + esc(summaryStr) + '</div>' +
      '</div>';
    }).join("");

    return '<div style="padding:10px;background:rgba(255,255,255,.03);border-radius:10px;">' + html + '</div>';
  }

  function rpcTable(list) {
    if (!Array.isArray(list)) return '<div class="m-loc">null</div>';
    return list.map(function (r) {
      var color = r.ok === true ? "var(--gbx-green)" :
                  r.ok === false ? "var(--gbx-danger)" : "var(--gbx-muted)";
      var symbol = r.ok === true ? "✓" : r.ok === false ? "✗" : "·";
      return '<div style="padding:6px 0;border-top:1px dashed var(--gbx-line);font-size:10px;">' +
        '<div style="display:flex;gap:8px;">' +
          '<span style="color:' + color + ';flex:0 0 20px;">' + symbol + '</span>' +
          '<span style="color:var(--gbx-ivory);flex:1;font-family:var(--font-mono);">' + esc(r.name) + '</span>' +
          '<span style="color:var(--gbx-muted);flex:0 0 60px;text-align:right;">' + (r.ms || 0) + 'ms</span>' +
        '</div>' +
        (r.describe ? '<div style="color:var(--gbx-muted);margin-left:28px;margin-top:2px;">' + esc(r.describe) + '</div>' : "") +
        (r.error ? '<div style="color:var(--gbx-danger);margin-left:28px;margin-top:2px;">' + esc(r.error) + '</div>' : "") +
        (r.top_keys && r.top_keys.length ? '<div style="color:var(--gbx-muted-2);margin-left:28px;margin-top:2px;font-family:var(--font-mono);">' + esc(r.top_keys.join(", ")) + '</div>' : "") +
      '</div>';
    }).join("");
  }

  function tableTable(list) {
    if (!Array.isArray(list)) return '<div class="m-loc">null</div>';
    return list.map(function (r) {
      if (r.ok === null) {
        return '<div style="padding:6px 0;font-size:10px;color:var(--gbx-muted);">· ' + esc(r.table) + ' — ' + esc(r.describe || "skipped") + '</div>';
      }
      var color = r.ok === true ? "var(--gbx-green)" : "var(--gbx-danger)";
      var symbol = r.ok === true ? "✓" : "✗";
      return '<div style="padding:6px 0;border-top:1px dashed var(--gbx-line);font-size:10px;">' +
        '<div style="display:flex;gap:8px;">' +
          '<span style="color:' + color + ';flex:0 0 20px;">' + symbol + '</span>' +
          '<span style="color:var(--gbx-ivory);flex:1;font-family:var(--font-mono);">' + esc(r.table) + '</span>' +
          '<span style="color:var(--gbx-muted);flex:0 0 90px;text-align:right;">' + (r.row_count || 0) + ' rows · ' + (r.ms || 0) + 'ms</span>' +
        '</div>' +
        (r.describe ? '<div style="color:var(--gbx-muted);margin-left:28px;margin-top:2px;">' + esc(r.describe) + '</div>' : "") +
        (r.error ? '<div style="color:var(--gbx-danger);margin-left:28px;margin-top:2px;">' + esc(r.error) + '</div>' : "") +
      '</div>';
    }).join("");
  }

  // ------------------------------------------------------------------------
  // OPEN / CLOSE
  // ------------------------------------------------------------------------

  function buildOverlay() {
    if (document.getElementById("gbx-diag-overlay")) return;
    var overlay = document.createElement("div");
    overlay.id = "gbx-diag-overlay";
    overlay.style.cssText =
      "position:fixed;inset:0;z-index:99999;background:#0F1411;color:#F5F3EC;" +
      "overflow-y:auto;padding:16px 16px 40px;font-family:var(--font-sans);";
    overlay.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">' +
        '<div style="font-size:12px;font-weight:800;letter-spacing:.14em;color:var(--gbx-green);">DIAGNOSTICS · V1.8.2.6</div>' +
        '<button id="gbx-diag-close" type="button" style="background:none;border:1px solid var(--gbx-line);border-radius:8px;padding:6px 10px;font-size:14px;color:var(--gbx-ivory);cursor:pointer;">✕</button>' +
      '</div>' +
      '<div style="display:flex;gap:8px;margin-bottom:8px;">' +
        '<button id="gbx-diag-rebuild" type="button" style="flex:1;background:var(--gbx-emerald);border:0;border-radius:8px;padding:10px;color:#fff;font-size:11px;font-weight:800;cursor:pointer;">REBUILD</button>' +
        '<button id="gbx-diag-copy" type="button" style="flex:1;background:transparent;border:1px solid var(--gbx-green);border-radius:8px;padding:10px;color:var(--gbx-green);font-size:11px;font-weight:800;cursor:pointer;">COPY</button>' +
      '</div>' +
      '<div id="gbx-diag-body"><div class="loading-text">Press REBUILD to collect.</div></div>';
    document.body.appendChild(overlay);

    document.getElementById("gbx-diag-close").onclick = closePanel;
    document.getElementById("gbx-diag-rebuild").onclick = buildReport;
    document.getElementById("gbx-diag-copy").onclick = copyReport;
  }

  function openPanel() {
    buildOverlay();
    if (report.state === "NOT_RUN") {
      buildReport();
    } else {
      renderReport();
    }
  }

  function closePanel() {
    var o = document.getElementById("gbx-diag-overlay");
    if (o) o.remove();
  }

  // ------------------------------------------------------------------------
  // COPY — produces a compact plain-text report suitable for pasting
  // ------------------------------------------------------------------------

  function copyReport() {
    var text = plainTextReport();
    try {
      navigator.clipboard.writeText(text).then(function () {
        var btn = document.getElementById("gbx-diag-copy");
        if (btn) {
          var original = btn.textContent;
          btn.textContent = "COPIED";
          setTimeout(function () { btn.textContent = original; }, 1400);
        }
      }, function () {
        alert("Copy failed. Select the report text manually.");
      });
    } catch (e) {
      alert("Copy failed: " + (e && e.message));
    }
  }

  function plainTextReport() {
    if (report.state !== "BUILT") {
      return "GOODSBARNX DIAGNOSTICS — report not built yet.";
    }
    var lines = [];
    lines.push("=== GOODSBARNX DIAGNOSTICS · V1.8.2.6 ===");
    lines.push("built_at: " + report.built_at);
    lines.push("");

    lines.push("--- 1. ENVIRONMENT ---");
    Object.keys(report.environment).forEach(function (k) {
      var v = report.environment[k];
      lines.push(k + ": " + (v && typeof v === "object" ? JSON.stringify(v) : String(v)));
    });
    lines.push("");

    lines.push("--- 2. MODULES ---");
    report.modules.forEach(function (m) {
      lines.push((m.present ? "OK   " : "FAIL ") + m.file + " → " + (m.global || "(side-effect)"));
    });
    lines.push("");

    lines.push("--- 3. PIPELINE ---");
    if (!report.pipeline.available) {
      lines.push("(no pipeline snapshot yet)");
    } else {
      lines.push("version=" + report.pipeline.version + " ok=" + report.pipeline.ok + " generated=" + report.pipeline.generatedAt);
      report.pipeline.trace.forEach(function (t) {
        lines.push((t.ok ? "OK   " : "FAIL ") + t.stage + " " + t.ms + "ms " + (t.error || ""));
      });
      lines.push("");
      report.pipeline.stages.forEach(function (s) {
        lines.push((s.present ? "STAGE " : "NULL  ") + s.name +
          " rows=" + (s.rowCount == null ? "?" : s.rowCount) +
          (s.summary ? " summary=" + truncate(JSON.stringify(s.summary), 300) : ""));
      });
    }
    lines.push("");

    lines.push("--- 4. RPC PROBES ---");
    report.rpcs.forEach(function (r) {
      var status = r.ok === true ? "OK   " : r.ok === false ? "FAIL " : "SKIP ";
      lines.push(status + r.name + " " + (r.ms || 0) + "ms" +
        (r.describe ? " · " + r.describe : "") +
        (r.error ? " · error=" + r.error : "") +
        (r.top_keys && r.top_keys.length ? " · keys=" + r.top_keys.join(",") : ""));
    });
    lines.push("");

    lines.push("--- 5. TABLE PROBES ---");
    report.tables.forEach(function (r) {
      var status = r.ok === true ? "OK   " : r.ok === false ? "FAIL " : "SKIP ";
      lines.push(status + r.table + " rows=" + (r.row_count || 0) + " " + (r.ms || 0) + "ms" +
        (r.describe ? " · " + r.describe : "") +
        (r.error ? " · error=" + r.error : ""));
    });
    lines.push("");

    lines.push("--- 6. BEHAVIOUR ---");
    Object.keys(report.behaviour).forEach(function (k) {
      var v = report.behaviour[k];
      lines.push(k + ": " + (v && typeof v === "object" ? JSON.stringify(v) : String(v)));
    });

    return lines.join("\n");
  }

  // ------------------------------------------------------------------------
  // BOOT — attach the button once the header exists
  // ------------------------------------------------------------------------

  function boot() {
    if (mountButton()) return;
    // The header may not be rendered yet if the auth shell is showing.
    // Poll a few times; the button appears once currentUser resolves.
    var tries = 0;
    var interval = setInterval(function () {
      tries++;
      if (mountButton() || tries > 30) clearInterval(interval);
    }, 500);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  // Also expose a programmatic opener for convenience.
  window.goodsbarnxDiagnosticsOpen = openPanel;
})();
