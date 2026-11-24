// ==========================================================================
// GoodsbarnX — js/demand.js  (rev. 1 · consumer-side demand resolution)
// Plain global script. Loads AFTER storefront.js, cart.js, and cart.js's
// helpers. Registers a delegated click handler on the storefront so it can
// present "Buy one now" affordances alongside the existing B2B cart flow.
//
// Depends on:
//   window.sb          — Supabase client
//   window.currentUser — canonical user object
//   public.resolve_consumer_demand(uuid)              — SQL-B
//   public.consumer_demand / demand_pools /
//   demand_pool_members / retailer_inventory          — SQL-A + SQL-B
//
// Does NOT:
//   - Place orders. Pool commitment is separate (see confirm_demand_pool).
//   - Modify cart.js or storefront.js. Interaction is additive.
//   - Touch any B2B table. trade_relationships, orders, order_items are
//     untouched.
// ==========================================================================

(function () {
  "use strict";

  // ------------------------------------------------------------------------
  // Constants
  // ------------------------------------------------------------------------
  const DEMAND_STORAGE_KEY    = "goodsbarnx_consumer_demand";
  const DEMAND_HASH_KEY       = "goodsbarnx_consumer_demand:hash";
  const POOL_REFRESH_INTERVAL = 60 * 1000; // 1 minute

  // ------------------------------------------------------------------------
  // Small helpers (local — do not collide with cart.js or storefront.js)
  // ------------------------------------------------------------------------
  function dmEscHtml(v) {
    return String(v == null ? "" : v)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
  function dmNum(v, fallback) {
    const n = Number(v);
    return Number.isFinite(n) ? n : (fallback == null ? 0 : fallback);
  }
  function dmIsUuid(v) {
    return typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
  }
  function dmMoney(v) {
    const n = dmNum(v, 0);
    return "₦" + n.toLocaleString();
  }
  function dmWarn(msg) {
    console.warn("[GoodsbarnX/demand] " + msg);
  }

  // ------------------------------------------------------------------------
  // Consumer check — the module is a no-op for non-consumers
  // ------------------------------------------------------------------------
  function dmIsConsumer() {
    return !!(currentUser && currentUser.role === "consumer");
  }

  // ------------------------------------------------------------------------
  // Local cache of recent route decisions, so the storefront can render
  // "Join pool" state without re-querying on every render.
  //
  // Shape:
  //   { "<product_id>": { route, evidence, pool, retailer, demand_id,
  //                       resolvedAt } }
  // ------------------------------------------------------------------------
  const __dmRouteCache = Object.create(null);

  // ------------------------------------------------------------------------
  // resolveDemandForProduct(product, requestedQty)
  //
  // Called when a consumer opens a product detail on the storefront.
  // Creates a consumer_demand row (status=OPEN), then calls
  // resolve_consumer_demand which either routes it or returns evidence.
  //
  // Returns the decision envelope, or null on error.
  //
  // Notes:
  //   - Idempotency: a fingerprint of (product_id, qty, location) is stored
  //     in localStorage. If the consumer opens the same product again with
  //     the same qty, the existing OPEN demand is reused (not duplicated).
  //   - If the demand was already routed or pooled, that route is returned.
  // ------------------------------------------------------------------------
  async function resolveDemandForProduct(product, requestedQty) {
    if (!dmIsConsumer() || !window.sb || !product || !product.id) return null;
    if (!dmIsUuid(product.id)) { dmWarn("rejected non-UUID product"); return null; }

    const qty = Math.max(1, Math.floor(dmNum(requestedQty, 1)));
    const location = (currentUser.location || "").trim() || null;

    // Fingerprint to avoid duplicate demand rows for the same query
    const fp = [product.id, qty, location || ""].join("|");

    // Check local cache first
    const cached = __dmRouteCache[product.id];
    if (cached && cached.fp === fp) {
      return cached;
    }

    // Check persisted demand for the same fingerprint
    const existing = readDemandRegistry()[fp];
    if (existing && existing.demand_id) {
      const lookup = await sb
        .from("consumer_demand")
        .select("id,status,route_decision,route_evidence")
        .eq("id", existing.demand_id)
        .maybeSingle();

      if (lookup.data) {
        const envelope = {
          fp,
          demand_id: lookup.data.id,
          route: lookup.data.route_decision || "OPEN",
          evidence: lookup.data.route_evidence || null,
          status: lookup.data.status
        };
        __dmRouteCache[product.id] = envelope;

        // If already routed/pooled, no need to re-resolve
        if (lookup.data.status !== "OPEN") return envelope;
      }
    }

    // Create the demand row
    const insert = await sb.from("consumer_demand").insert({
      consumer_id:  currentUser.id,
      product_id:   product.id,
      requested_qty: qty,
      location:     location,
      status:       "OPEN"
    }).select("id").maybeSingle();

    if (insert.error || !insert.data) {
      dmWarn("demand insert failed: " + (insert.error && insert.error.message));
      return null;
    }

    const demandId = insert.data.id;
    writeDemandRegistry(fp, demandId);

    // Resolve
    const resolveRes = await sb.rpc("resolve_consumer_demand", { p_demand_id: demandId });
    if (resolveRes.error) {
      dmWarn("resolve_consumer_demand failed: " + resolveRes.error.message);
      return null;
    }

    const decision = resolveRes.data || {};

    // Load the pool or retailer depending on route
    let pool = null;
    let retailer = null;

    if (decision.route === "COLLECTIVE_BUYING" && decision.pool_id) {
      const poolRes = await sb.from("demand_pools")
        .select("id, product_id, distributor_id, location, target_qty, current_qty, moq_units, status, unit_price, expires_at")
        .eq("id", decision.pool_id)
        .maybeSingle();
      if (poolRes.data) pool = poolRes.data;
    } else if (decision.route === "RETAILER_LED_FULFILMENT") {
      const ev = decision.evidence || {};
      if (ev.retailer_id) {
        const retRes = await sb.from("retailer_profiles")
          .select("id, business_name, location, market, supports_pickup, supports_delivery")
          .eq("id", ev.retailer_id)
          .maybeSingle();
        if (retRes.data) {
          retailer = Object.assign({}, retRes.data, {
            unit_price: ev.retailer_unit_price,
            units_available: ev.retailer_units
          });
        }
      }
    }

    const envelope = {
      fp,
      demand_id: demandId,
      route: decision.route,
      evidence: decision.evidence,
      pool: pool,
      retailer: retailer,
      status: "OPEN",
      resolvedAt: new Date().toISOString()
    };
    __dmRouteCache[product.id] = envelope;
    return envelope;
  }

  // ------------------------------------------------------------------------
  // Persisted registry: keeps a map of fingerprint → { demand_id } so a
  // consumer re-opening the same product does not create a duplicate demand.
  // Cleared by demResolveRegistry() on logout or when a demand is fulfilled.
  // ------------------------------------------------------------------------
  function readDemandRegistry() {
    try {
      const raw = localStorage.getItem(DEMAND_STORAGE_KEY);
      if (!raw) return {};
      return JSON.parse(raw);
    } catch (_) { return {}; }
  }
  function writeDemandRegistry(fp, demandId) {
    try {
      const r = readDemandRegistry();
      r[fp] = { demand_id: demandId, at: new Date().toISOString() };
      localStorage.setItem(DEMAND_STORAGE_KEY, JSON.stringify(r));
    } catch (_) {}
  }
  function clearDemandRegistry() {
    try {
      localStorage.removeItem(DEMAND_STORAGE_KEY);
      localStorage.removeItem(DEMAND_HASH_KEY);
    } catch (_) {}
  }

  // ------------------------------------------------------------------------
  // Render the demand panel on a product detail sheet.
  //
  // Called from demand.js's own click handler. Renders into a dedicated
  // container inside the sheet so it does not disturb storefront's layout.
  //
  // The panel is contextual: what it shows depends on the route.
  // ------------------------------------------------------------------------
  function renderDemandPanel(hostEl, product, envelope) {
    if (!hostEl || !envelope) return;

    const route = envelope.route || "DEMAND_ACCUMULATED";
    const ev = envelope.evidence || {};

    let html = "";

    // Retailer-led fulfilment
    if (route === "RETAILER_LED_FULFILMENT" && envelope.retailer) {
      const r = envelope.retailer;
      html =
        '<div class="dm-panel dm-panel-retailer">' +
          '<div class="dm-panel-kicker">Available now</div>' +
          '<div class="dm-panel-title">' + dmEscHtml(r.business_name || "A retailer nearby") + ' has this in stock</div>' +
          '<div class="dm-panel-meta">' +
            dmEscHtml(r.location || "") +
            (r.market ? ' · ' + dmEscHtml(r.market) : "") +
            (r.supports_pickup ? ' · Pickup available' : "") +
            (r.supports_delivery ? ' · Delivery available' : "") +
          '</div>' +
          '<div class="dm-panel-price">' + dmMoney(r.unit_price) + ' <span class="dm-panel-price-unit">per unit</span></div>' +
          '<div class="dm-panel-actions">' +
            '<button type="button" class="dm-btn-primary" data-dm-action="retailer-buy" data-demand-id="' + dmEscHtml(envelope.demand_id) + '">Buy from ' + dmEscHtml(r.business_name || "retailer") + '</button>' +
          '</div>' +
        '</div>';
    }
    // Collective buying
    else if (route === "COLLECTIVE_BUYING" && envelope.pool) {
      const p = envelope.pool;
      const current = dmNum(p.current_qty, 0);
      const target  = dmNum(p.target_qty, dmNum(p.moq_units, 1));
      const pct     = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0;
      const statusLabel = p.status === "QUALIFIED" || p.status === "CONFIRMED"
        ? "Ready to purchase"
        : "Gathering members";

      html =
        '<div class="dm-panel dm-panel-pool">' +
          '<div class="dm-panel-kicker">Collective buying · ' + dmEscHtml(statusLabel) + '</div>' +
          '<div class="dm-panel-title">Join ' + current + ' units already committed</div>' +
          '<div class="dm-panel-meta">' +
            'Target: ' + target + ' units · ' + pct + '% filled' +
            (p.location ? ' · ' + dmEscHtml(p.location) : "") +
          '</div>' +
          '<div class="dm-pool-progress"><div class="dm-pool-bar" style="width:' + pct + '%"></div></div>' +
          '<div class="dm-panel-actions">' +
            '<button type="button" class="dm-btn-primary" data-dm-action="pool-join" data-demand-id="' + dmEscHtml(envelope.demand_id) + '" data-pool-id="' + dmEscHtml(p.id) + '">Join this demand pool</button>' +
          '</div>' +
        '</div>';
    }
    // Demand accumulated — no route yet
    else {
      const shortfall = dmNum(ev.shortfall, 0);
      const moq = dmNum(ev.moq_units, 1);
      html =
        '<div class="dm-panel dm-panel-accumulated">' +
          '<div class="dm-panel-kicker">Not yet orderable</div>' +
          '<div class="dm-panel-title">No retailer has this in stock and the minimum order is not yet met</div>' +
          '<div class="dm-panel-meta">' +
            'Need ' + shortfall + ' more unit' + (shortfall === 1 ? "" : "s") + ' to reach ' + moq + ' units. ' +
            'Your interest is recorded and will resolve automatically when stock or demand arrives.' +
          '</div>' +
          '<div class="dm-panel-actions">' +
            '<button type="button" class="dm-btn-secondary" data-dm-action="accumulated-notify" data-demand-id="' + dmEscHtml(envelope.demand_id) + '">Notify me when available</button>' +
          '</div>' +
        '</div>';
    }

    hostEl.innerHTML = html;
  }

  // ------------------------------------------------------------------------
  // Load and render the demand panel for the currently-open product detail
  // (called by the storefront's delegated handler).
  //
  // Presents the panel inside the existing sheet, above the B2B Add to cart
  // button so both flows are visible.
  // ------------------------------------------------------------------------
  async function mountDemandPanelOnDetail(product, requestedQty) {
    if (!dmIsConsumer()) return;
    const sheet = document.querySelector(".sf-detail-sheet");
    if (!sheet) return;

    // Find or create the demand container inside .sf-detail-body
    let host = sheet.querySelector(".dm-demand-panel");
    if (!host) {
      host = document.createElement("div");
      host.className = "dm-demand-panel";
      const body = sheet.querySelector(".sf-detail-body");
      if (!body) return;
      const anchor = body.querySelector(".sf-detail-add");
      if (anchor) body.insertBefore(host, anchor);
      else body.appendChild(host);
    }

    host.innerHTML = '<div class="dm-panel-loading">Checking availability…</div>';

    const envelope = await resolveDemandForProduct(product, requestedQty);
    if (!envelope) {
      host.innerHTML = '';
      return;
    }
    renderDemandPanel(host, product, envelope);
  }

  // ------------------------------------------------------------------------
  // Actions
  // ------------------------------------------------------------------------

  // Consumer taps "Buy from [retailer]" — the retailer will fulfil this
  // individual purchase. This does NOT create a B2B order.
  async function consumerRetailerBuy(demandId) {
    if (!dmIsConsumer() || !dmIsUuid(demandId)) return;
    if (!window.sb) return;

    // Load demand to find the retailer + product
    const dRes = await sb.from("consumer_demand")
      .select("id, product_id, consumer_id, requested_qty, status, route_evidence")
      .eq("id", demandId)
      .maybeSingle();
    if (dRes.error || !dRes.data) {
      alert("Could not load this demand.");
      return;
    }
    const demand = dRes.data;
    if (demand.consumer_id !== currentUser.id) return;

    const evidence = demand.route_evidence || {};
    const retailerId = evidence.retailer_id;
    const unitPrice = dmNum(evidence.retailer_unit_price, 0);
    const qty = dmNum(demand.requested_qty, 1);

    // Create a lightweight consumer order row via a dedicated RPC.
    // (The RPC is part of the next delivery. For now we show the intent.)
    const rpc = await sb.rpc("submit_consumer_retail_order", {
      p_demand_id: demandId,
      p_retailer_id: retailerId
    });

    if (rpc.error) {
      const msg = String(rpc.error.message || "");
      if (/function .* does not exist/i.test(msg) || rpc.error.code === "42883") {
        // The consumer order RPC has not been deployed yet — show a clear
        // pending message instead of a stack trace.
        alert(
          "Ordering from retailers is being enabled. " +
          "Your interest is recorded; you'll be notified the moment " +
          retailerId ? "" : "" +
          "the retailer confirms their capacity."
        );
        return;
      }
      alert("Could not place the order: " + msg);
      return;
    }

    // Success
    alert("Request sent to " + (evidence.retailer_id ? "the retailer" : "retailer") + " for " +
      qty + " unit" + (qty === 1 ? "" : "s") + ". They will confirm shortly.");
  }

  // Consumer taps "Join this demand pool"
  async function consumerJoinPool(demandId, poolId) {
    if (!dmIsConsumer() || !dmIsUuid(demandId) || !dmIsUuid(poolId)) return;
    if (!window.sb) return;

    const rpc = await sb.rpc("join_demand_pool", {
      p_demand_id: demandId,
      p_pool_id: poolId
    });

    if (rpc.error) {
      const msg = String(rpc.error.message || "");
      if (/function .* does not exist/i.test(msg) || rpc.error.code === "42883") {
        alert("Joining pools is being enabled. Please try again shortly.");
        return;
      }
      alert("Could not join the pool: " + msg);
      return;
    }

    // Refresh the panel
    const sheet = document.querySelector(".sf-detail-sheet");
    if (sheet) {
      const productId = (sheet.querySelector("[data-sf-product-id]") || {}).dataset?.sfProductId;
      const product = (window.__sfCurrentStorefront?.priced || [])
        .map(x => x.p).find(p => p.id === productId);
      if (product) await mountDemandPanelOnDetail(product, 1);
    }
  }

  async function consumerNotifyAccumulated(demandId) {
    if (!dmIsConsumer() || !dmIsUuid(demandId)) return;
    // The notification is handled server-side in the eventual pool worker.
    // For now, record the intent locally and confirm to the consumer.
    try {
      const r = readDemandRegistry();
      Object.keys(r).forEach(k => {
        if (r[k].demand_id === demandId) r[k].notify = true;
      });
      localStorage.setItem(DEMAND_STORAGE_KEY, JSON.stringify(r));
    } catch (_) {}
    alert("We'll let you know when this becomes orderable.");
  }

  // ------------------------------------------------------------------------
  // Delegated click handler — mounted on document.body so it survives
  // storefront re-renders and detail sheet open/close.
  // ------------------------------------------------------------------------
  function dmHandleClick(e) {
    const t = e.target.closest("[data-dm-action]");
    if (!t) return;
    const action   = t.getAttribute("data-dm-action");
    const demandId = t.getAttribute("data-demand-id");
    const poolId   = t.getAttribute("data-pool-id");

    if (!dmIsConsumer()) return;

    if (action === "retailer-buy") {
      e.preventDefault(); e.stopPropagation();
      consumerRetailerBuy(demandId);
      return;
    }
    if (action === "pool-join") {
      e.preventDefault(); e.stopPropagation();
      consumerJoinPool(demandId, poolId);
      return;
    }
    if (action === "accumulated-notify") {
      e.preventDefault(); e.stopPropagation();
      consumerNotifyAccumulated(demandId);
      return;
    }
  }

  // ------------------------------------------------------------------------
  // Hook into the storefront's detail-sheet open
  //
  // storefront.js exposes sfOpenProductDetail but no callback. We watch the
  // DOM for the .sf-detail element appearing, then mount the panel. This
  // avoids modifying storefront.js and keeps both modules independent.
  // ------------------------------------------------------------------------
  function watchStorefrontDetail() {
    const observer = new MutationObserver(function (mutations) {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (!(node instanceof HTMLElement)) continue;
          if (node.classList && node.classList.contains("sf-detail")) {
            mountFromDetailNode(node);
          } else if (node.querySelector) {
            const inner = node.querySelector(".sf-detail");
            if (inner) mountFromDetailNode(inner);
          }
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function mountFromDetailNode(detailNode) {
    if (!dmIsConsumer()) return;
    const imageEl = detailNode.querySelector(".sf-detail-image");
    const productId = imageEl && imageEl.getAttribute("data-sf-product-id");
    if (!productId) return;

    const cur = window.__sfCurrentStorefront;
    if (!cur || !Array.isArray(cur.priced)) return;
    const entry = cur.priced.find(x => x.p && x.p.id === productId);
    if (!entry) return;

    // Read the qty from the detail sheet's value element
    const qtyEl = detailNode.querySelector(".sf-qty-value");
    const qty = Math.max(1, parseInt(qtyEl ? qtyEl.textContent : "1", 10) || 1);

    // Wait a tick for the DOM to settle
    setTimeout(function () {
      mountDemandPanelOnDetail(entry.p, qty);
    }, 60);
  }

  // ------------------------------------------------------------------------
  // Public API
  // ------------------------------------------------------------------------
  window.dmResolveDemandForProduct = resolveDemandForProduct;
  window.dmMountDemandPanelOnDetail = mountDemandPanelOnDetail;
  window.dmClearRegistry = clearDemandRegistry;

  // Attach the click handler
  document.addEventListener("click", dmHandleClick);

  // Start watching for storefront detail sheets
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", watchStorefrontDetail);
  } else {
    watchStorefrontDetail();
  }

  // Clear the demand registry on logout (avoid stale ids across sessions)
  document.addEventListener("goodsbarnx:logout", clearDemandRegistry);
  if (typeof window.handleLogout === "function") {
    const originalLogout = window.handleLogout;
    window.handleLogout = async function () {
      clearDemandRegistry();
      return originalLogout.apply(this, arguments);
    };
  }

  console.log("[GoodsbarnX] demand.js loaded (rev.1 · consumer-side demand resolution)");
})();
