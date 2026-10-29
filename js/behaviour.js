/* ==========================================================================
   GoodsbarnX — js/behaviour.js  (rev. 2)
   Buyer behaviour instrumentation (Canon §28, §29, D1, D11, D25–D28).

   Version: V1.8.2.6
   Load position: 15 (per D25).

   rev. 1 — dead-code remediation (contextFromSelectedContact buyer branch
            removed; buyer_id is derived from auth.uid() server-side).

   rev. 2 — wider telemetry (diagnostic only; no emission change):
     The `recent` array in window.goodsbarnxBehaviourState().recent now
     stores per-event detail rather than a single boolean:
       - event_type      : the canonical type
       - source          : ui | producer | market | storefront | screen | function
       - missing         : array of missing context field names
       - had_context     : object with per-field booleans
     The emission path, context extraction, RPC call, error handling, and
     failure counters are unchanged. This revision purely widens the
     observability surface so a diagnostic report can name which event
     types are failing to carry context.

   Canon basis:
     §28  behaviour events preserve their commercial context.
     §29  evidence integrity.
     §38-2 no silent fallback.
   ========================================================================== */

(function () {
  "use strict";

  var VERSION = "V1.8.2.6";
  var SESSION_KEY = "gbx_v180_session_id";

  var CANON_EVENT_TYPES = [
    "market_view",
    "search",
    "filter",
    "category_view",
    "distributor_view",
    "product_view",
    "product_return",
    "product_detail_view",
    "stock_check",
    "price_check",
    "distributor_check",
    "trust_check",
    "delivery_check",
    "comparison",
    "save",
    "quantity_change",
    "inquiry_start",
    "inquiry_submit",
    "cart_add",
    "cart_remove",
    "checkout_start",
    "checkout_complete",
    "purchase",
    "abandonment",
    "checkout_abandonment",
    "inquiry_abandonment"
  ];
  var CANON_EVENT_SET = Object.create(null);
  CANON_EVENT_TYPES.forEach(function (t) { CANON_EVENT_SET[t] = true; });

  var PRODUCER_EVENT_MAP = {
    "openModal":       "inquiry_start",
    "submitInquiry":   "inquiry_submit",
    "addToCart":       "cart_add",
    "removeFromCart":  "cart_remove",
    "startCheckout":   "checkout_start"
  };

  var telemetry = {
    emitted: 0,
    emitted_with_missing_context: 0,
    failed: 0,
    last_failure: null,
    recent: []
  };
  var RECENT_CAP = 50;

  var sessionId = null;
  var lastScreen = "";
  var booted = false;

  // ------------------------------------------------------------------------
  // SMALL HELPERS
  // ------------------------------------------------------------------------

  function uuid() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      var v = c === "x" ? r : ((r & 0x3) | 0x8);
      return v.toString(16);
    });
  }

  function getSessionId() {
    if (sessionId) return sessionId;
    try { sessionId = sessionStorage.getItem(SESSION_KEY); } catch (e) {}
    if (!sessionId) sessionId = uuid();
    try { sessionStorage.setItem(SESSION_KEY, sessionId); } catch (e) {}
    return sessionId;
  }

  function isBuyer() {
    try {
      return !!(currentUser && String(currentUser.role || "").toLowerCase() === "buyer");
    } catch (e) {
      return false;
    }
  }

  function isUuid(v) {
    return typeof v === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
  }

  function putIfUuid(o, k, v) {
    if (v != null && isUuid(String(v))) o[k] = String(v);
  }

  // ------------------------------------------------------------------------
  // CONTEXT EXTRACTION
  // ------------------------------------------------------------------------

  function contextFromElement(el) {
    var out = {
      product_id: null,
      distributor_id: null,
      inquiry_id: null,
      relationship_id: null,
      cart_id: null,
      order_id: null,
      category: null,
      _source: "element"
    };
    if (!el || !el.dataset) return out;

    putIfUuid(out, "product_id",      el.dataset.productId || el.dataset.product_id);
    putIfUuid(out, "distributor_id",  el.dataset.distributorId || el.dataset.distributor_id);
    putIfUuid(out, "inquiry_id",      el.dataset.inquiryId || el.dataset.inquiry_id);
    putIfUuid(out, "relationship_id", el.dataset.relationshipId || el.dataset.relationship_id);
    putIfUuid(out, "cart_id",         el.dataset.cartId || el.dataset.cart_id);
    putIfUuid(out, "order_id",        el.dataset.orderId || el.dataset.order_id);

    if (typeof el.dataset.gbxCategory === "string" && el.dataset.gbxCategory.length) {
      out.category = el.dataset.gbxCategory;
    }
    return out;
  }

  function contextFromSelectedContact() {
    var out = {
      product_id: null,
      distributor_id: null,
      inquiry_id: null,
      relationship_id: null,
      cart_id: null,
      order_id: null,
      category: null,
      _source: "selected_contact"
    };
    var id = null, type = null;
    try { id = selectedContactId; } catch (e) {}
    try { type = selectedContactType; } catch (e) {}

    if (type === "distributor") putIfUuid(out, "distributor_id", id);
    return out;
  }

  function mergeContext(a, b) {
    var out = {
      product_id: null,
      distributor_id: null,
      inquiry_id: null,
      relationship_id: null,
      cart_id: null,
      order_id: null,
      category: null
    };
    ["product_id","distributor_id","inquiry_id","relationship_id","cart_id","order_id"].forEach(function (k) {
      out[k] = (a && a[k]) || (b && b[k]) || null;
    });
    out.category = (a && a.category) || (b && b.category) || null;
    return out;
  }

  function meaningfulContext(c) {
    return !!(c && (c.product_id || c.distributor_id || c.inquiry_id ||
                    c.relationship_id || c.cart_id || c.order_id));
  }

  function missingContextFields(c) {
    var names = [];
    if (!c.product_id)      names.push("product_id");
    if (!c.distributor_id)  names.push("distributor_id");
    if (!c.inquiry_id)      names.push("inquiry_id");
    if (!c.relationship_id) names.push("relationship_id");
    if (!c.cart_id)         names.push("cart_id");
    if (!c.order_id)        names.push("order_id");
    return names;
  }

  function contextPresence(c) {
    return {
      product_id:      !!c.product_id,
      distributor_id:  !!c.distributor_id,
      inquiry_id:      !!c.inquiry_id,
      relationship_id: !!c.relationship_id,
      cart_id:         !!c.cart_id,
      order_id:        !!c.order_id
    };
  }

  // ------------------------------------------------------------------------
  // TRACK — the single emit path
  // ------------------------------------------------------------------------

  async function track(type, ctx, meta, source) {
    if (!CANON_EVENT_SET[type]) {
      console.warn("[GoodsbarnX/behaviour] non-canonical event type: " + type);
      return null;
    }
    if (!isBuyer()) return null;
    if (!window.sb || typeof window.sb.rpc !== "function") {
      console.warn("[GoodsbarnX/behaviour] sb.rpc unavailable; event not emitted: " + type);
      telemetry.failed++;
      telemetry.last_failure = { type: type, reason: "sb_unavailable", at: new Date().toISOString() };
      recordRecent(type, source, ["sb_unavailable"], {});
      return null;
    }

    ctx = ctx || {};
    var missing = missingContextFields(ctx);
    var presence = contextPresence(ctx);
    var metadata = Object.assign({}, meta || {});
    metadata.source = source || metadata.source || "behaviour";
    metadata.instrumentation_version = VERSION;
    if (missing.length) metadata.missing_context = missing;

    var payload = {
      p_session_id:      getSessionId(),
      p_event_type:      type,
      p_event_source:    source || "app",
      p_product_id:      ctx.product_id || null,
      p_distributor_id:  ctx.distributor_id || null,
      p_inquiry_id:      ctx.inquiry_id || null,
      p_relationship_id: ctx.relationship_id || null,
      p_cart_id:         ctx.cart_id || null,
      p_order_id:        ctx.order_id || null,
      p_metadata:        metadata,
      p_occurred_at:     new Date().toISOString()
    };

    var first = await safeRpc(payload);
    if (first.ok) {
      recordSuccess(missing.length);
      recordRecent(type, source, missing, presence);
      return first.data;
    }

    var reducedPayload = {
      p_session_id:  payload.p_session_id,
      p_event_type:  payload.p_event_type,
      p_event_source: payload.p_event_source,
      p_metadata: Object.assign({}, metadata, { s4_unavailable: true }),
      p_occurred_at: payload.p_occurred_at
    };
    ["p_product_id","p_distributor_id","p_inquiry_id","p_relationship_id","p_cart_id","p_order_id"].forEach(function (k) {
      if (payload[k] != null) reducedPayload[k] = payload[k];
    });

    var second = await safeRpc(reducedPayload);
    if (second.ok) {
      recordSuccess(missing.length);
      recordRecent(type, source, missing, presence);
      return second.data;
    }

    telemetry.failed++;
    telemetry.last_failure = {
      type: type,
      at: new Date().toISOString(),
      first_error: first.error,
      second_error: second.error
    };
    recordRecent(type, source, missing.concat(["FAILED"]), presence);
    console.warn(
      "[GoodsbarnX/behaviour] event emission failed after 2 attempts: " +
      type + " — " + (second.error || first.error)
    );
    return null;
  }

  async function safeRpc(payload) {
    try {
      var r = await window.sb.rpc("record_buyer_behavior_event", payload);
      if (r && r.error) return { ok: false, error: r.error.message || String(r.error), data: null };
      return { ok: true, error: null, data: (r && r.data) || null };
    } catch (e) {
      return { ok: false, error: (e && e.message) || String(e), data: null };
    }
  }

  function recordSuccess(hadMissing) {
    if (hadMissing) telemetry.emitted_with_missing_context++;
    else telemetry.emitted++;
  }

  function recordRecent(type, source, missing, presence) {
    telemetry.recent.push({
      at: new Date().toISOString(),
      event_type: type,
      source: source || "unknown",
      missing: Array.isArray(missing) ? missing : [],
      had_context: presence || {}
    });
    if (telemetry.recent.length > RECENT_CAP) telemetry.recent.shift();
  }

  // ------------------------------------------------------------------------
  // PRODUCER HOOKS
  // ------------------------------------------------------------------------

  function wrapProducer(name, eventType) {
    if (window["__gbxBehaviourWrapped_" + name]) return;
    if (typeof window[name] !== "function") return;

    var original = window[name];
    window[name] = function () {
      var args = Array.prototype.slice.call(arguments);

      var ctx = { product_id: null, distributor_id: null, inquiry_id: null,
                  relationship_id: null, cart_id: null, order_id: null,
                  category: null, _source: "producer_args" };

      if (name === "openModal") {
        var contactId = args[0];
        var contactType = args[2];
        if (contactType === "distributor") putIfUuid(ctx, "distributor_id", contactId);
      } else if (name === "addToCart" || name === "removeFromCart") {
        var productId = args[0];
        putIfUuid(ctx, "product_id", productId);
      } else if (name === "submitInquiry") {
        ctx = mergeContext(ctx, contextFromSelectedContact());
      } else if (name === "startCheckout") {
        putIfUuid(ctx, "cart_id", args[0]);
      }

      if (!meaningfulContext(ctx)) {
        ctx = mergeContext(ctx, contextFromSelectedContact());
      }

      var result = original.apply(this, args);

      var meta = { function_name: name, instrumentation_version: VERSION };
      track(eventType, ctx, meta, "producer");

      return result;
    };

    window["__gbxBehaviourWrapped_" + name] = true;
  }

  function hookProducerFunctions() {
    Object.keys(PRODUCER_EVENT_MAP).forEach(function (name) {
      wrapProducer(name, PRODUCER_EVENT_MAP[name]);
    });
  }

  // ------------------------------------------------------------------------
  // DOM LISTENERS
  // ------------------------------------------------------------------------

  function textOf(el) {
    return String(el && el.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
  }

  function passiveClickContext(el) {
    var node = el;
    for (var depth = 0; node && depth < 6; depth++) {
      var c = contextFromElement(node);
      if (meaningfulContext(c)) return c;
      node = node.parentElement;
    }
    return contextFromElement(el);
  }

  function instrumentPassiveClick(el) {
    if (!isBuyer() || !el) return;
    if (el.closest && el.closest("[data-gbx-event]")) return;

    var t = textOf(el);
    var ctx = passiveClickContext(el);
    var meta = { source_element: el.tagName.toLowerCase(), label: t.slice(0, 100) };

    if (/\bstorefront\b|view distributor|distributor profile/.test(t)) {
      if (ctx.distributor_id) track("distributor_view", ctx, meta, "ui");
      return;
    }
    if (/\bcheck stock\b|availability|stock/.test(t) && !/add to cart/.test(t)) {
      track("stock_check", ctx, meta, "ui");
      return;
    }
    if (/\bdelivery\b|shipping|dispatch/.test(t)) {
      track("delivery_check", ctx, meta, "ui");
      return;
    }
    if (/\btrust\b|verified|rating|reputation/.test(t)) {
      track("trust_check", ctx, meta, "ui");
      return;
    }
    if (/\bsave\b|wishlist|favorite/.test(t)) {
      track("save", ctx, meta, "ui");
      return;
    }
  }

  function activeScreen() {
    var x = document.querySelector(".screen.active");
    return x ? x.id.replace(/^screen-/, "") : "";
  }

  function observeScreen() {
    var screen = activeScreen();
    if (!screen || screen === lastScreen) return;
    lastScreen = screen;
    if (screen === "market") {
      track("market_view", {}, { screen: "market", path: location.pathname }, "screen");
    }
  }

  function hookShowScreen() {
    if (typeof window.showScreen !== "function" || window.__gbxBehaviourShowScreenHooked) return;
    var original = window.showScreen;
    window.showScreen = function () {
      var r = original.apply(this, arguments);
      setTimeout(observeScreen, 0);
      return r;
    };
    window.__gbxBehaviourShowScreenHooked = true;
  }

  function attachListeners() {
    document.addEventListener("click", function (e) {
      if (!isBuyer()) return;
      var el = e.target && e.target.closest ? e.target.closest("[data-gbx-event]") : null;
      if (el) {
        var type = el.getAttribute("data-gbx-event");
        if (CANON_EVENT_SET[type]) {
          var functionBacked = {
            inquiry_start: true,
            inquiry_submit: true,
            cart_add: true,
            cart_remove: true,
            checkout_start: true
          };
          if (!functionBacked[type]) {
            track(type, contextFromElement(el), {
              source_element: el.tagName.toLowerCase(),
              category: el.getAttribute("data-gbx-category") || null
            }, "ui");
          }
        }
        return;
      }
      var clickable = e.target && e.target.closest
        ? e.target.closest("button,a,[role=button],.product-card,.distributor-card,.buyer-card,.storefront-card")
        : null;
      if (clickable) instrumentPassiveClick(clickable);
    }, true);

    var searchTimer = null;
    document.addEventListener("input", function (e) {
      if (!isBuyer()) return;
      var el = e.target;
      if (!el || el.id !== "search-input") return;
      if (searchTimer) clearTimeout(searchTimer);
      searchTimer = setTimeout(function () {
        var q = String(el.value || "").trim();
        if (q) {
          track("search", contextFromElement(el), {
            query_length: q.length,
            query_present: true
          }, "ui");
        }
      }, 500);
    }, true);

    document.addEventListener("change", function (e) {
      if (!isBuyer()) return;
      var el = e.target;
      if (el && el.matches && el.matches('[data-gbx-event="filter"]')) {
        track("filter", contextFromElement(el), {
          filter_id: el.id || null,
          selected_value: el.value || null
        }, "ui");
      }
    }, true);
  }

  // ------------------------------------------------------------------------
  // BOOT
  // ------------------------------------------------------------------------

  function boot() {
    if (booted) return;
    booted = true;
    hookProducerFunctions();
    hookShowScreen();
    attachListeners();
    observeScreen();
  }

  function reconcile() {
    hookProducerFunctions();
    hookShowScreen();
  }

  document.addEventListener("DOMContentLoaded", function () {
    boot();
    setTimeout(reconcile, 500);
  });

  window.addEventListener("load", function () {
    boot();
    setTimeout(reconcile, 500);
  });

  // ------------------------------------------------------------------------
  // TELEMETRY ACCESSOR
  // ------------------------------------------------------------------------

  window.goodsbarnxBehaviourState = function () {
    return {
      version: VERSION,
      session_id: getSessionId(),
      buyer_session: isBuyer(),
      emitted: telemetry.emitted,
      emitted_with_missing_context: telemetry.emitted_with_missing_context,
      failed: telemetry.failed,
      last_failure: telemetry.last_failure,
      recent: telemetry.recent.slice()
    };
  };

  window.goodsbarnxBehaviourTrack = track;

  console.log("[GoodsbarnX] behaviour.js loaded (" + VERSION + " rev.2)");
})();
