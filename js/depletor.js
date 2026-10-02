/* ==========================================================================
   GoodsbarnX — depletor.js
   Master Stock Depletor: Allocation & Routing runtime (Phase 1+2 boundary).

   Version markers (both preserved for compatibility with the removed inline
   regression tests during the Phase 1+2 migration):
     V1.8.2.6
     V1.8.2.6.8.1.1.8

   Canon basis:
     §14  seven-stage pipeline (Phase 3 will split this file into six
          per-stage modules: stock, radar, opportunity, allocation,
          depletion, replenishment — decision D8)
     §19  relationship gate — a demand cannot route without an active
          primary relationship
     §20  opportunity shape
     §21  structured blockers (MISSING BUYER / MISSING RELATIONSHIP /
          MISSING QUANTITY / MISSING STOCK / MISSING ROUTE /
          MISSING COMMERCIAL TERMS)
     §22  allocation inputs
     §29  evidence integrity — this file never fabricates evidence
     §30  canonical Opportunity field contract (aliased alongside the
          legacy camelCase surface during Phase 1+2)

   Read-only runtime. No writes. No stock mutation. No invented
   opportunity IDs or order IDs.
   ========================================================================== */

(function () {
  "use strict";

  var VERSION = "V1.8.2.6";
  var ISOLATION_MARKER = "V1.8.2.6.8.1.1.8"; // temporary scaffold; see file header
  window.goodsbarnxDepletorAllocationVersion = VERSION;
  window.goodsbarnxDepletorIsolationMarker = ISOLATION_MARKER;

  var state = { candidates: [], error: null };

  // ------------------------------------------------------------------------
  // SMALL HELPERS
  // ------------------------------------------------------------------------

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c];
    });
  }

  function tokens(v) {
    return String(v || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/).filter(function (x) { return x.length > 2; });
  }

  // Evidence-preserving name match: both sides must share at least one
  // significant token. This is a heuristic, not a semantic matcher; it is
  // labelled as such in the opportunity evidence so no consumer treats it
  // as a fact (Canon §29).
  function linked(i, p) {
    var a = tokens(i.item), b = tokens(p.name);
    if (!a.length || !b.length) return false;
    var forward = a.some(function (t) { return b.indexOf(t) >= 0; });
    var backward = b.some(function (t) { return a.indexOf(t) >= 0; });
    return forward && backward;
  }

  function ageHours(v) {
    var t = new Date(v || Date.now()).getTime();
    return isFinite(t) ? Math.max(0, (Date.now() - t) / 3600000) : 999999;
  }

  function score(matches, stock, qty, age) {
    var s = 0;
    if (matches) s += 40;
    if (stock > 0) s += 25;
    if (qty > 0) {
      s += 20;
      if (stock >= qty) s += 5;
    }
    if (age <= 24) s += 10;
    else if (age <= 168) s += 6;
    else if (age <= 720) s += 2;
    return Math.min(100, s);
  }

  // Tier taxonomy is carried forward unchanged from the payload. Canon §21
  // replaces this in Phase 3 with the seven-state lifecycle.
  function tier(s, stock, matches) {
    if (matches && stock > 0 && s >= 75) return "ACT NOW";
    if (matches && stock > 0) return "READY";
    if (matches) return "WATCH";
    if (stock <= 0) return "RESTOCK";
    return "MONITOR";
  }

  // ------------------------------------------------------------------------
  // RELATIONSHIP GATE (Canon §19)
  //
  // Returns the active primary relationship, or null. The lifecycle state
  // is retained on the candidate so downstream stages do not flatten
  // pending / paused / released / terminated into a single boolean.
  // ------------------------------------------------------------------------

  function activeRelationship(i, rels) {
    if (!i.buyer_id) return null;
    return rels.find(function (r) {
      return r.buyer_id === i.buyer_id
        && r.is_primary !== false
        && String(r.status || "").toLowerCase() === "active";
    }) || null;
  }

  function anyRelationship(i, rels) {
    if (!i.buyer_id) return null;
    return rels.find(function (r) {
      return r.buyer_id === i.buyer_id && r.is_primary !== false;
    }) || null;
  }

  // ------------------------------------------------------------------------
  // BLOCKERS (Canon §21) — structured set, not a joined string
  // ------------------------------------------------------------------------

  function computeBlockers(e) {
    var blockers = [];
    if (!e.demandIdentity)                blockers.push("MISSING BUYER");
    if (!e.activePrimaryRelationship)     blockers.push("MISSING RELATIONSHIP");
    if (!e.requestedQuantityKnown)        blockers.push("MISSING QUANTITY");
    if (!e.stockAvailable)                blockers.push("MISSING STOCK");
    if (!e.productDemandMatch)            blockers.push("MISSING ROUTE");
    // MISSING COMMERCIAL TERMS is not derivable from the current schema
    // surface; it is reserved for Phase 3 when relationship trade terms are
    // loaded by the allocation producer. Left absent here rather than
    // fabricated (Canon §29).
    return blockers;
  }

  // ------------------------------------------------------------------------
  // EVIDENCE READ
  //
  // All reads are scoped to the authenticated distributor. No cross-tenant
  // reads. No writes. sb-null is a named failure, not a silent skip.
  // ------------------------------------------------------------------------

  async function readEvidence() {
    var user = null;
    try { user = currentUser; } catch (e) {}
    if (!user || String(user.role || "").toLowerCase() !== "distributor") {
      throw new Error("AUTH_CONTEXT_UNAVAILABLE");
    }
    if (!window.sb || typeof window.sb.from !== "function") {
      throw new Error("SUPABASE_UNAVAILABLE");
    }

    var rs = await Promise.all([
      sb.from("products")
        .select("id,name,price,stock_quantity,status,category")
        .eq("distributor_id", user.id),
      sb.from("inquiries")
        .select("id,item,quantity,status,created_at,buyer_id,distributor_id,inquirer_id")
        .eq("distributor_id", user.id)
        .order("created_at", { ascending: false }),
      sb.from("trade_relationships")
        .select("id,buyer_id,distributor_id,status,is_primary")
        .eq("distributor_id", user.id),
      sb.from("agent_distributor_attachments")
        .select("id,agent_id,status")
        .eq("distributor_id", user.id)
        .eq("status", "accepted")
    ]);

    rs.forEach(function (r) { if (r.error) throw r.error; });

    var products = rs[0].data || [];
    var inquiries = (rs[1].data || []).filter(function (i) {
      return ["closed", "resolved", "completed"]
        .indexOf(String(i.status || "").toLowerCase()) === -1;
    });
    var relationships = rs[2].data || [];
    var agents = rs[3].data || [];

    var out = [];

    inquiries.forEach(function (i) {
      var matches = products.filter(function (p) { return linked(i, p); });
      var qty = Number(i.quantity) > 0 ? Number(i.quantity) : 0;
      var age = ageHours(i.created_at);
      var rel = activeRelationship(i, relationships);
      var anyRel = anyRelationship(i, relationships);

      matches.forEach(function (p) {
        var stock = Number(p.stock_quantity) || 0;
        var sc = score(matches.length, stock, qty, age);

        var evidence = {
          demandIdentity:           !!i.buyer_id,
          activePrimaryRelationship:!!rel,
          relationshipExists:       !!anyRel,
          productDemandMatch:       true,
          stockAvailable:           stock > 0,
          requestedQuantityKnown:   qty > 0,
          stockCoversRequest:       qty > 0 && stock >= qty,
          acceptedAgentCapacity:    agents.length > 0,
          freshnessHours:           Math.round(age * 10) / 10,
          matchBasis:               "TOKEN_OVERLAP_HEURISTIC"
        };

        var allocatable =
          evidence.productDemandMatch &&
          evidence.stockAvailable &&
          evidence.requestedQuantityKnown &&
          evidence.demandIdentity &&
          evidence.activePrimaryRelationship;

        var blockers = allocatable ? [] : computeBlockers(evidence);
        var blockReasonStr = allocatable ? null : blockers.join("; ");

        var candidate = {
          // Canon §30 canonical fields.
          inquiry_id:           i.id,
          product_id:           p.id,
          distributor_id:       user.id,
          buyer_id:             i.buyer_id || null,
          relationship_id:      rel ? rel.id : null,
          relationship_status:  anyRel ? anyRel.status : null,
          stock_quantity:       stock,
          demanded_quantity:    qty,
          allocatable_quantity: allocatable ? Math.min(stock, qty) : 0,
          opportunity_score:    sc,
          route_state:          allocatable ? "READY" : "BLOCKED",
          route_type:           allocatable ? "DIRECT_BUYER" : "NONE",
          blockers:             blockers,
          evidence:             evidence,

          // Legacy camelCase aliases retained during Phase 1+2 so the
          // renderer and any consumer ported from the payload continue
          // to function. Phase 3 (D8 split) drops these.
          inquiryId:            i.id,
          productId:            p.id,
          distributorId:        user.id,
          buyerId:              i.buyer_id || null,
          relationshipId:       rel ? rel.id : null,
          requestedQuantity:    qty,
          availableQuantity:    stock,
          allocatableQuantity:  allocatable ? Math.min(stock, qty) : 0,
          opportunityScore:     sc,
          opportunityTier:      tier(sc, stock, matches.length),
          routeType:            allocatable ? "DIRECT_BUYER" : "NONE",
          routeStatus:          allocatable ? "READY" : "BLOCKED",
          blockReason:          blockReasonStr
        };

        out.push(candidate);
      });
    });

    out.sort(function (a, b) {
      return (Number(b.allocatable_quantity > 0) - Number(a.allocatable_quantity > 0))
        || (b.opportunity_score - a.opportunity_score);
    });

    return { candidates: out, acceptedAgents: agents.length };
  }

  // ------------------------------------------------------------------------
  // PANEL
  // ------------------------------------------------------------------------

  var __depletorWarned = Object.create(null);
  function depletWarnMissing(id) {
    if (__depletorWarned[id]) return;
    __depletorWarned[id] = true;
    console.warn("[GoodsbarnX/depletor] DOM target #" + id + " is missing.");
  }

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
          '<span class="intel-label">ALLOCATION &amp; ROUTING</span>' +
          '<h3>Evidence-backed fulfillment paths</h3>' +
        '</div>' +
        '<button type="button" id="depletor-allocation-refresh">Refresh</button>' +
      '</div>' +
      '<div id="depletor-allocation-status" class="depletor-empty">Waiting for allocation evidence…</div>' +
      '<div id="depletor-allocation-list" class="depletor-opportunities"></div>';

    var opportunitiesBox = document.getElementById("depletor-opportunities");
    if (opportunitiesBox && opportunitiesBox.parentNode) {
      opportunitiesBox.parentNode.insertBefore(s, opportunitiesBox.nextSibling);
    } else {
      // File 11 removes the V1.6 inline depletor console markup that owned
      // #depletor-opportunities. In that state the allocation panel is
      // appended directly into #depletor-console.
      root.appendChild(s);
    }

    var refreshBtn = document.getElementById("depletor-allocation-refresh");
    if (refreshBtn) {
      refreshBtn.addEventListener("click", function () {
        window.refreshDepletorAllocation();
      });
    }
    return s;
  }

  // ------------------------------------------------------------------------
  // RENDER
  // ------------------------------------------------------------------------

  function render() {
    ensurePanel();
    var status = document.getElementById("depletor-allocation-status");
    var list   = document.getElementById("depletor-allocation-list");
    if (!status || !list) return;

    if (state.error) {
      var message = state.error.message || String(state.error);
      if (message === "AUTH_CONTEXT_UNAVAILABLE") {
        status.textContent = "Waiting for authenticated distributor context…";
      } else if (message === "SUPABASE_UNAVAILABLE") {
        status.textContent = "Connection service unavailable.";
      } else {
        status.textContent = "Allocation runtime unavailable. Existing intelligence remains read-only.";
      }
      list.innerHTML = "";
      return;
    }

    var c = state.candidates || [];
    var ready = c.filter(function (x) {
      return x.allocatable_quantity > 0 && x.route_state === "READY";
    }).length;

    if (!c.length) {
      status.textContent = "No evidence-backed allocation candidate is currently available.";
      list.innerHTML = "";
      return;
    }

    status.innerHTML =
      "<strong>" + ready + "</strong> routing-ready candidate" + (ready === 1 ? "" : "s") +
      " · " + c.length + " evidence-backed candidate" + (c.length === 1 ? "" : "s") +
      " · read-only runtime";

    list.innerHTML = c.slice(0, 8).map(function (x) {
      var isReady = x.allocatable_quantity > 0 && x.route_state === "READY";
      var icon = isReady ? "↗" : "⊘";
      var detailQty = x.demanded_quantity
        ? x.allocatable_quantity.toLocaleString() + " / " + x.demanded_quantity.toLocaleString() + " units allocatable"
        : "Requested quantity unknown";
      var blockerText = x.blockers && x.blockers.length
        ? x.blockers.join(" · ")
        : (isReady ? "Evidence complete. Route is ready for execution handoff." : "Evidence incomplete.");
      return '<div class="opportunity">' +
        '<div class="op-icon">' + icon + '</div>' +
        '<div class="op-copy">' +
          '<div class="op-name">Product ' + esc(x.product_id) + '</div>' +
          '<div class="op-detail">' +
            '<span class="' + (isReady ? "stock-healthy" : "stock-attention") + '">' +
              esc(isReady ? x.route_type : "BLOCKED") +
            '</span> · ' + esc(detailQty) + ' · score ' + x.opportunity_score + '/100' +
          '</div>' +
          '<div class="op-detail">' +
            'Inquiry ' + esc(x.inquiry_id) +
            ' · relationship ' + esc(x.relationship_id || "none") +
            (x.relationship_status ? ' (' + esc(x.relationship_status) + ')' : "") +
          '</div>' +
          '<div class="op-detail">' + esc(blockerText) + '</div>' +
        '</div>' +
      '</div>';
    }).join("");
  }

  // ------------------------------------------------------------------------
  // PUBLIC ENTRY
  // ------------------------------------------------------------------------

  window.refreshDepletorAllocation = async function () {
    var root = document.getElementById("depletor-console");
    var user = null;
    try { user = currentUser; } catch (e) {}

    if (!root) { depletWarnMissing("depletor-console"); return; }
    if (!user || String(user.role || "").toLowerCase() !== "distributor") {
      state.error = new Error("AUTH_CONTEXT_UNAVAILABLE");
      state.candidates = [];
      render();
      return;
    }

    ensurePanel();
    state.error = null;

    var status = document.getElementById("depletor-allocation-status");
    var list   = document.getElementById("depletor-allocation-list");
    if (status) status.textContent = "Validating allocation evidence…";
    if (list) list.innerHTML = "";

    try {
      var r = await readEvidence();
      state.candidates = r.candidates || [];
      window.goodsbarnxAllocationCandidates = state.candidates;
      render();
      return state.candidates;
    } catch (e) {
      state.error = e;
      state.candidates = [];
      console.warn("[GoodsbarnX/depletor] " + VERSION + ":", e);
      render();
      throw e;
    }
  };

  // ------------------------------------------------------------------------
  // BOOT
  // ------------------------------------------------------------------------

  document.addEventListener("DOMContentLoaded", function () {
    setTimeout(window.refreshDepletorAllocation, 1000);
    setTimeout(window.refreshDepletorAllocation, 2200);
  });

})();
