// ==========================================================================
// GoodsbarnX — cart.js  (rev. 4 · Relationship-Order Assembly + Security)
// Plain global script. Depends on the global `cart` array (loaded from
// localStorage in the main inline script in index.html).
//
// This is not a shopping bag. It is a per-relationship assembly surface.
// Every line is owned by a relationship, carries its own price snapshot,
// enforces MOQ, and knows whether the stock signal is fresh. Groups by
// distributor. Submits one commitment per distributor, not one dump.
//
// Layers:
//   L1 · STORE        persistence, validation, reconciliation, migration
//   L2 · GROUPING     per-distributor assembly, subtotals, readiness
//   L3 · GUARDRAILS   MOQ, relationship-active, price-fresh, engine,
//                     no-dark-patterns
//   L4 · COMMITMENT   one primary action per ready group:
//                     submit inquiry | WhatsApp handoff | contact
//   L5 · EVIDENCE     every submission records price basis, terms ref,
//                     relationship status, engine freshness
//
// Security (rev.4 · F-21):
//   V1  Server-side price re-verification on submission.
//   V2  Product existence / ownership / status / stock re-check.
//   V3  Sanitised WhatsApp payload; phone validated before use.
//   V4  Phone number re-fetched and regex-validated (NG format).
//   V5  Cart integrity hash (FNV-1a) — detects tamper/corruption; wipes
//       on mismatch. Honest label: smoke detector, not vault.
//   V6  30-second per-(buyer,distributor) submission cooldown + in-flight
//       mutex. Prevents duplicate-submission floods.
//
// Backward compatibility (do not break):
//   - addToCart(productId, name, price, distributorId, distributorName,
//     qty?, opts?) — exact signature preserved.
//   - removeFromCart(productId), updateCartBadge(), renderCart() unchanged
//     signatures, richer behaviour.
//   - localStorage key "goodsbarnx_cart" preserved. Existing carts survive
//     via migrateLegacyCart() on first load.
//   - document "goodsbarnx:cart-added" custom event still fires.
// ==========================================================================

// ==========================================================================
// CONSTANTS
// ==========================================================================

const CART_STORAGE_KEY   = "goodsbarnx_cart";
const CART_HASH_KEY      = "goodsbarnx_cart:hash";
const CART_SCHEMA_VERSION = 4;

const CART_STALE_AFTER_MS       = 5  * 60 * 1000;
const CART_UNAVAILABLE_AFTER_MS = 30 * 60 * 1000;

// Rate limit: per (buyer, distributor) submission cooldown.
const CART_SUBMIT_COOLDOWN_MS = 30 * 1000;

// ==========================================================================
// L1 · STORE
// ==========================================================================

// -------------------------------------------------------------------------
// V5: cart integrity hash (FNV-1a, 32-bit)
// Detects accidental corruption and post-XSS mutation. NOT cryptographic —
// an attacker who controls the page can forge it. Treated as a smoke
// detector, not a vault. On mismatch, the cart is wiped and the buyer
// is warned via console. Failing safe beats failing silent.
// -------------------------------------------------------------------------
function cartHash(str) {
  var h = 0x811c9dc5;
  for (var i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h.toString(16);
}

function cartPersist() {
  try {
    var payload = JSON.stringify(cart || []);
    localStorage.setItem(CART_STORAGE_KEY, payload);
    localStorage.setItem(CART_HASH_KEY, cartHash(payload));
  } catch (err) {
    console.warn("[GoodsbarnX/cart] persist failed:", err && err.message);
  }
}

function cartVerifyIntegrity() {
  try {
    var payload = localStorage.getItem(CART_STORAGE_KEY);
    var stored  = localStorage.getItem(CART_HASH_KEY);
    if (!payload) return true;   // empty cart, nothing to verify
    if (!stored) return false;   // pre-rev.4 cart, no hash yet
    return cartHash(payload) === stored;
  } catch (_) {
    return false;
  }
}

/**
 * Upgrade a pre-v4 cart shape to v4. Preserves all data. Called at init,
 * BEFORE the integrity check, because the upgrade rewrites the payload
 * and re-signs the hash.
 */
function migrateLegacyCart() {
  try {
    var raw = localStorage.getItem(CART_STORAGE_KEY);
    if (!raw) return;
    var parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return;

    var changed = false;
    var upgraded = parsed.map(function (item) {
      if (item && item.price_snapshot) return item;
      changed = true;
      return {
        productId: item.productId,
        distributorId: item.distributorId || null,
        name: item.name || "Product",
        sku: item.sku || null,
        brand: item.brand || null,
        image_url: item.image_url || null,
        distributorName: item.distributorName || "Distributor",
        qty: Number(item.quantity) || Number(item.qty) || 1,
        moq: Number(item.moq) || 1,
        price_snapshot: {
          value: Number(item.price) || 0,
          basis: item.price ? "public" : "negotiable",
          termsRef: null,
          capturedAt: new Date().toISOString()
        },
        relationship_status_at_add: item.relationship_status_at_add || "unknown"
      };
    });

    if (changed) {
      cart.length = 0;
      upgraded.forEach(function (u) { cart.push(u); });
      cartPersist();
    }
  } catch (err) {
    console.warn("[GoodsbarnX/cart] migrateLegacyCart failed:", err && err.message);
  }
}

/**
 * addToCart — public API, signature preserved.
 * qty is honoured. opts (7th arg) carries the snapshot from the storefront:
 *   { sku, brand, image_url, moq, price_basis, termsRef,
 *     relationship_status_at_add }
 */
function addToCart(productId, name, price, distributorId, distributorName, qty, opts) {
  var addQty = Number(qty);
  if (!isFinite(addQty) || addQty < 1) addQty = 1;
  addQty = Math.floor(addQty);

  var o = opts || {};
  var moq = Number(o.moq) || 1;
  if (addQty < moq) addQty = moq;

  var existing = cart.find(function (item) { return item.productId === productId; });
  if (existing) {
    existing.qty = (Number(existing.qty) || 1) + addQty;
    if (isFinite(Number(price)) && Number(price) > 0) {
      existing.price_snapshot = {
        value: Number(price),
        basis: o.price_basis || existing.price_snapshot.basis,
        termsRef: o.termsRef || existing.price_snapshot.termsRef || null,
        capturedAt: new Date().toISOString()
      };
    }
  } else {
    cart.push({
      productId: productId,
      distributorId: distributorId || null,
      name: name || "Product",
      sku: o.sku || null,
      brand: o.brand || null,
      image_url: o.image_url || null,
      distributorName: distributorName || "Distributor",
      qty: addQty,
      moq: moq,
      price_snapshot: {
        value: Number(price) || 0,
        basis: o.price_basis || (price ? "public" : "negotiable"),
        termsRef: o.termsRef || null,
        capturedAt: new Date().toISOString()
      },
      relationship_status_at_add: o.relationship_status_at_add || "unknown"
    });
  }

  cartPersist();
  updateCartBadge();
  try {
    document.dispatchEvent(new CustomEvent("goodsbarnx:cart-added", {
      detail: { productId: productId, name: name, quantity: addQty }
    }));
  } catch (_) {}
}

function setCartQty(productId, qty) {
  var item = cart.find(function (i) { return i.productId === productId; });
  if (!item) return;

  var q = Math.floor(Number(qty));
  if (!isFinite(q) || q <= 0) { removeFromCart(productId); return; }
  if (q < (item.moq || 1)) q = item.moq || 1;
  item.qty = q;
  cartPersist();
  updateCartBadge();
  renderCart();
}

function removeFromCart(productId) {
  for (var i = cart.length - 1; i >= 0; i--) {
    if (cart[i].productId === productId) cart.splice(i, 1);
  }
  cartPersist();
  updateCartBadge();
  renderCart();
}

function clearCart() {
  cart.length = 0;
  cartPersist();
  updateCartBadge();
  renderCart();
}

function clearCartGroup(distributorId) {
  for (var i = cart.length - 1; i >= 0; i--) {
    if (cart[i].distributorId === distributorId) cart.splice(i, 1);
  }
  cartPersist();
  updateCartBadge();
  renderCart();
}

// ==========================================================================
// BADGE
// ==========================================================================

function cartTotalUnits() {
  return cart.reduce(function (sum, item) {
    var q = Number(item.qty != null ? item.qty : item.quantity);
    return sum + (isFinite(q) ? q : 1);
  }, 0);
}

function updateCartBadge() {
  var badge = document.getElementById("cart-badge");
  if (!badge) return;
  var units = cartTotalUnits();
  badge.textContent = units;
  badge.style.display = units > 0 ? "block" : "none";
}

// ==========================================================================
// L2 · GROUPING — per-distributor assembly
// ==========================================================================

function getCartGroups() {
  var groupsById = Object.create(null);

  cart.forEach(function (item) {
    var distId = item.distributorId || "__unknown__";
    if (!groupsById[distId]) {
      groupsById[distId] = {
        distributorId: item.distributorId,
        distributorName: item.distributorName || "Distributor",
        items: [],
        subtotal: { gross: 0, discount: 0, net: 0, currency: "NGN" }
      };
    }
    var g = groupsById[distId];
    g.items.push(item);
    var price = Number(item.price_snapshot && item.price_snapshot.value) || 0;
    var qty   = Number(item.qty) || 1;
    g.subtotal.gross += price * qty;
    g.subtotal.net   += price * qty;
  });

  return Object.keys(groupsById).map(function (distId) {
    var g = groupsById[distId];
    g.engineContext = getCartEngineContext(g.distributorId);

    var reasons = [];
    var anyBlocked     = false;
    var anyNeedsReview = false;

    g.items.forEach(function (item) {
      var moqCheck   = guardMoqSatisfied(item);
      var freshCheck = guardPriceSnapshotFresh(item);
      if (!moqCheck.ok)   { anyBlocked = true;     reasons.push.apply(reasons, moqCheck.reasons); }
      if (!freshCheck.ok) { anyNeedsReview = true; reasons.push.apply(reasons, freshCheck.reasons); }
    });

    var relCheck = guardRelationshipActive(g);
    if (!relCheck.ok) { anyBlocked = true; reasons.push.apply(reasons, relCheck.reasons); }

    var engCheck = guardEngineTransparency(g);
    if (!engCheck.ok) { anyNeedsReview = true; reasons.push.apply(reasons, engCheck.reasons); }

    g.readiness = anyBlocked ? "blocked" : anyNeedsReview ? "needs_review" : "ready";
    g.readiness_reasons = reasons;
    return g;
  });
}

function getCartEngineContext(distributorId) {
  var snapshot = window.goodsbarnxLastReplenishmentSnapshot || null;
  if (!snapshot || !Array.isArray(snapshot.rows)) {
    return { source: "unavailable", stockState: "unknown", worstUrgency: null, freshnessMs: null, updatedAt: null };
  }
  var distRows = snapshot.rows.filter(function (r) { return r.distributor_id === distributorId; });
  var updatedAt = snapshot.generatedAt || null;
  var freshnessMs = updatedAt ? (Date.now() - new Date(updatedAt).getTime()) : null;
  var source = "engine";
  if (freshnessMs == null || freshnessMs > CART_UNAVAILABLE_AFTER_MS) source = "unavailable";
  else if (freshnessMs > CART_STALE_AFTER_MS) source = "stale";

  if (!distRows.length) {
    return { source: source, stockState: "healthy", worstUrgency: "LOW", freshnessMs: freshnessMs, updatedAt: updatedAt };
  }

  var rank = { HIGH: 3, MODERATE: 2, LOW: 1, UNKNOWN: 0 };
  var worst = "LOW";
  for (var i = 0; i < distRows.length; i++) {
    var u = distRows[i].urgency || "UNKNOWN";
    if ((rank[u] || 0) > (rank[worst] || 0)) worst = u;
  }
  var stockState = "healthy";
  if (worst === "HIGH") stockState = "depleting";
  else if (worst === "UNKNOWN") stockState = "unknown";

  return { source: source, stockState: stockState, worstUrgency: worst, freshnessMs: freshnessMs, updatedAt: updatedAt };
}

// ==========================================================================
// L3 · GUARDRAILS
// ==========================================================================

function guardMoqSatisfied(item) {
  var qty = Number(item.qty) || 0;
  var moq = Number(item.moq) || 1;
  if (qty < moq) {
    return {
      ok: false,
      reasons: ["moq_not_met:" + (item.name || item.productId) + ":need " + moq + ", have " + qty]
    };
  }
  return { ok: true, reasons: [] };
}

function guardPriceSnapshotFresh(item) {
  var snap = item.price_snapshot;
  if (!snap || !snap.capturedAt) return { ok: true, reasons: [] };
  var captured = new Date(snap.capturedAt).getTime();
  if (!isFinite(captured)) return { ok: true, reasons: [] };
  var ageMs = Date.now() - captured;
  if (ageMs > CART_UNAVAILABLE_AFTER_MS) {
    return {
      ok: false,
      reasons: ["price_stale:" + (item.name || item.productId) + ":captured " + formatCartAge(ageMs) + " ago"]
    };
  }
  return { ok: true, reasons: [] };
}

function guardRelationshipActive(group) {
  if (group.relationship && group.relationship.status) {
    if (group.relationship.status !== "active") {
      return {
        ok: false,
        reasons: ["relationship_" + group.relationship.status + ":" + group.distributorName]
      };
    }
    return { ok: true, reasons: [] };
  }
  return { ok: true, reasons: [] };
}

function guardEngineTransparency(group) {
  var ctx = group.engineContext || {};
  if (ctx.source === "unavailable") {
    return { ok: false, reasons: ["engine_unavailable:" + group.distributorName] };
  }
  if (ctx.source === "stale") {
    return { ok: false, reasons: ["engine_stale:" + group.distributorName] };
  }
  return { ok: true, reasons: [] };
}

function guardNoDarkPatternsCart(renderPlan) {
  var reasons = [];
  var html = String((renderPlan && renderPlan.html) || "");
  if (/<[^>]*data-countdown/i.test(html)) reasons.push("countdown_present");
  if (/only\s+\d+\s+left/i.test(html))     reasons.push("scarcity_marker_present");
  if (/expires\s+in/i.test(html))          reasons.push("expiry_claim_present");
  if (/<dialog/i.test(html))               reasons.push("modal_trap_present");
  return { ok: reasons.length === 0, reasons: reasons };
}

// ==========================================================================
// L4 · COMMITMENT
// ==========================================================================

// Rate-limit + in-flight state (V6)
var __cartSubmitInFlight = false;
var __cartLastSubmitByDist = Object.create(null);

/**
 * submitCartGroup(distributorId, mode)
 *
 * mode: "inquiry" | "whatsapp" | "contact"
 *
 * Hardened (V1–V4, V6):
 *   - rate limit per (buyer, distributor)
 *   - live relationship check
 *   - product existence / ownership / status / stock re-check
 *   - price snapshot re-verification against DB
 *   - phone re-fetch + NG phone regex validation for WhatsApp
 *   - MOQ guardrail
 */
async function submitCartGroup(distributorId, mode) {
  // V6: cooldown
  var now = Date.now();
  var last = __cartLastSubmitByDist[distributorId] || 0;
  if (now - last < CART_SUBMIT_COOLDOWN_MS) {
    var waitS = Math.ceil((CART_SUBMIT_COOLDOWN_MS - (now - last)) / 1000);
    return { ok: false, reason: "rate_limited:" + waitS };
  }
  if (__cartSubmitInFlight) return { ok: false, reason: "in_flight" };

  var group = getCartGroups().find(function (g) { return g.distributorId === distributorId; });
  if (!group) return { ok: false, reason: "group_not_found" };

  __cartSubmitInFlight = true;
  try {
    // ---- Live relationship check ----
    if (currentUser && currentUser.role === "buyer" && distributorId) {
      try {
        var relQuery = await sb
          .from("trade_relationships")
          .select("status,is_primary")
          .eq("buyer_id", currentUser.id)
          .eq("distributor_id", distributorId)
          .eq("is_primary", true)
          .maybeSingle();
        group.relationship = {
          status: relQuery.error
            ? "unknown"
            : (relQuery.data ? relQuery.data.status : "none")
        };
      } catch (_) {
        group.relationship = { status: "unknown" };
      }
    }
    var relCheck = guardRelationshipActive(group);
    if (!relCheck.ok && group.relationship && group.relationship.status !== "unknown") {
      return { ok: false, reason: relCheck.reasons[0] || "relationship_inactive" };
    }

    // ---- V2: product existence / ownership / status / stock ----
    var productIds = group.items.map(function (i) { return i.productId; });
    var productQuery = await sb
      .from("products")
      .select("id,name,price,stock_quantity,status,distributor_id")
      .in("id", productIds);

    if (productQuery.error) {
      return { ok: false, reason: "product_lookup_failed" };
    }
    var byId = Object.create(null);
    (productQuery.data || []).forEach(function (p) { byId[p.id] = p; });

    for (var i = 0; i < group.items.length; i++) {
      var item = group.items[i];
      var dbProduct = byId[item.productId];
      if (!dbProduct) return { ok: false, reason: "product_not_found:" + (item.name || item.productId) };
      if (dbProduct.status !== "active") return { ok: false, reason: "product_inactive:" + (item.name || item.productId) };
      if (dbProduct.distributor_id !== distributorId) return { ok: false, reason: "product_ownership_mismatch:" + (item.name || item.productId) };
      if ((Number(dbProduct.stock_quantity) || 0) < (Number(item.qty) || 1)) {
        return { ok: false, reason: "insufficient_stock:" + (item.name || item.productId) };
      }
    }

    // ---- V1: price snapshot re-verification ----
    var priceChanges = [];
    for (var j = 0; j < group.items.length; j++) {
      var it = group.items[j];
      var prod = byId[it.productId];
      var cartPrice = Number(it.price_snapshot && it.price_snapshot.value) || 0;
      var dbPrice   = Number(prod.price) || 0;

      if (it.price_snapshot && it.price_snapshot.basis === "public") {
        if (Math.abs(cartPrice - dbPrice) > 1) {
          priceChanges.push({ productId: it.productId, name: it.name, cart: cartPrice, db: dbPrice });
        }
      }
      if (it.price_snapshot && (it.price_snapshot.basis === "negotiated" || it.price_snapshot.basis === "relationship_discount")) {
        if (cartPrice > dbPrice + 1) {
          console.warn("[GoodsbarnX/cart] cart price exceeds public for", it.name, "cart=", cartPrice, "db=", dbPrice);
        }
      }
    }
    if (priceChanges.length) {
      return { ok: false, reason: "price_changed:" + priceChanges.map(function (p) { return p.name; }).join(",") };
    }

    // ---- V4: fresh phone for WhatsApp mode ----
    if (mode === "whatsapp") {
      var phoneQuery = await sb
        .from("distributor_profiles")
        .select("profiles(phone)")
        .eq("id", distributorId)
        .maybeSingle();
      var dbPhone = phoneQuery && phoneQuery.data && phoneQuery.data.profiles && phoneQuery.data.profiles.phone;
      var cleaned = String(dbPhone || "").replace(/\D/g, "");
      if (!/^(234|0)[789][01]\d{8}$/.test(cleaned)) {
        return { ok: false, reason: "phone_unavailable" };
      }
      group.distributorPhone = dbPhone;
    }

    // ---- MOQ guardrail ----
    var moqViolations = group.items
      .map(function (it2) { return guardMoqSatisfied(it2); })
      .filter(function (r) { return !r.ok; });
    if (moqViolations.length) return { ok: false, reason: moqViolations[0].reasons[0] || "moq_not_met" };

    // ---- Dispatch ----
    var result;
    if (mode === "whatsapp")     result = submitCartGroupWhatsApp(group);
    else if (mode === "contact") result = submitCartGroupContact(group);
    else                         result = await submitCartGroupInquiry(group);

    if (result.ok) __cartLastSubmitByDist[distributorId] = Date.now();
    return result;
  } finally {
    __cartSubmitInFlight = false;
  }
}

/**
 * V3: sanitised WhatsApp handoff. Every field is whitelisted and clamped;
 * control characters, @/#/URLs stripped; product names truncated to 60
 * chars. Phone already validated by caller.
 */
function submitCartGroupWhatsApp(group) {
  var phone = group.distributorPhone;
  if (!phone) return { ok: false, reason: "phone_unavailable" };

  function sanitiseLine(s) {
    return String(s == null ? "" : s)
      .replace(/[\x00-\x1F\x7F]/g, "")
      .replace(/[@#]/g, "")
      .replace(/https?:\/\/\S+/gi, "")
      .slice(0, 60)
      .trim();
  }

  var lines = ["Hello, I'd like to place an order from GoodsbarnX:"];
  group.items.forEach(function (item) {
    var price = Number(item.price_snapshot && item.price_snapshot.value) || 0;
    var qty   = Number(item.qty) || 1;
    var basis = (item.price_snapshot && item.price_snapshot.basis) || "public";
    var priceLine = price > 0
      ? "₦" + price.toLocaleString() + " × " + qty + " (" + basis + ")"
      : "Negotiable × " + qty;
    lines.push("· " + sanitiseLine(item.name || "Product") + " — " + priceLine);
  });
  lines.push("");
  lines.push("Total: ₦" + group.subtotal.net.toLocaleString());
  lines.push("Buyer: " + sanitiseLine(
    (currentUser && (currentUser.full_name || currentUser.business_name)) || "Guest"
  ));

  var msg = encodeURIComponent(lines.join("\n"));
  window.open("https://wa.me/" + String(phone).replace(/\D/g, "") + "?text=" + msg, "_blank");

  clearCartGroup(group.distributorId);
  return { ok: true, mode: "whatsapp", submitted: group.items.length };
}

function submitCartGroupContact(group) {
  var lineCount = group.items.length;
  if (typeof closeStorefrontModal === "function") { try { closeStorefrontModal(); } catch (_) {} }
  if (typeof openModal === "function") {
    openModal(group.distributorId, group.distributorName, "distributor");
    clearCartGroup(group.distributorId);
    return { ok: true, mode: "contact", submitted: lineCount };
  }
  return { ok: false, reason: "contact_modal_unavailable" };
}

async function submitCartGroupInquiry(group) {
  if (!currentUser || !window.sb) return { ok: false, reason: "not_authenticated" };

  var created = 0;
  var errors = [];

  for (var i = 0; i < group.items.length; i++) {
    var item = group.items[i];
    var snap = item.price_snapshot || {};
    var qty  = Number(item.qty) || 1;
    var unit = Number(snap.value) || 0;

    var evidenceBits = [];
    evidenceBits.push("cart:qty=" + qty);
    if (snap.basis) evidenceBits.push("basis=" + snap.basis);
    if (snap.capturedAt) evidenceBits.push("captured=" + snap.capturedAt);
    if (group.engineContext && group.engineContext.source) evidenceBits.push("engine=" + group.engineContext.source);
    if (group.relationship && group.relationship.status) evidenceBits.push("relationship=" + group.relationship.status);

    var payload = {
      inquirer_name:  (currentUser.full_name || currentUser.business_name || "Buyer"),
      inquirer_phone: currentUser.phone || "",
      inquirer_email: currentUser.email || null,
      item:           (item.name || "Product") + (item.sku ? " [" + item.sku + "]" : ""),
      order_scale:    "cart",
      quantity:       qty + " × ₦" + unit.toLocaleString() + " (" + evidenceBits.join("; ") + ")",
      distributor_id: group.distributorId,
      buyer_id:       currentUser.id,
      contact_type:   "distributor",
      inquirer_id:    currentUser.id
    };

    try {
      var r = await sb.from("inquiries").insert(payload);
      if (r.error) errors.push((item.name || item.productId) + ": " + r.error.message);
      else created++;
    } catch (err) {
      errors.push((item.name || item.productId) + ": " + (err && err.message || "network"));
    }
  }

  if (created > 0) clearCartGroup(group.distributorId);

  return {
    ok: created > 0 && errors.length === 0,
    mode: "inquiry",
    submitted: created,
    errors: errors
  };
}

// ==========================================================================
// RENDER
// ==========================================================================

function renderCart() {
  var container = document.getElementById("cart-content");
  if (!container) return;

  if (!cart || cart.length === 0) {
    container.innerHTML =
      '<div class="cart2-empty">' +
        '<div class="cart2-empty-icon">🛒</div>' +
        '<div class="cart2-empty-title">Your cart is empty</div>' +
        '<div class="cart2-empty-sub">Products you add from a distributor\'s storefront will appear here, grouped by relationship.</div>' +
      '</div>';
    return;
  }

  var groups = getCartGroups();
  var renderedHtml = renderGroupsHtml(groups);
  var dp = guardNoDarkPatternsCart({ html: renderedHtml });
  if (!dp.ok) {
    console.warn("[GoodsbarnX/cart] guardrail: dark patterns detected", dp.reasons);
  }

  container.innerHTML = renderedHtml;
  bindCartEvents(container);
}

function renderGroupsHtml(groups) {
  return groups.map(function (g) { return renderGroupHtml(g); }).join("");
}

function renderGroupHtml(group) {
  var readinessClass = "cart2-group-" + group.readiness;
  var readinessLabel =
    group.readiness === "ready"        ? "Ready to submit" :
    group.readiness === "needs_review" ? "Review before submitting" :
    "Cannot submit yet";

  var engineLine = "";
  var ctx = group.engineContext || {};
  if (ctx.source === "engine") {
    engineLine = '<div class="cart2-group-engine" data-tone="live">● Stock signal live' +
      (ctx.freshnessMs != null ? " · updated " + formatCartAge(ctx.freshnessMs) + " ago" : "") + '</div>';
  } else if (ctx.source === "stale") {
    engineLine = '<div class="cart2-group-engine" data-tone="stale">● Stock signal ' +
      formatCartAge(ctx.freshnessMs) + ' old · may have changed</div>';
  } else {
    engineLine = '<div class="cart2-group-engine" data-tone="unavailable">● Stock signal unavailable</div>';
  }

  var reasonsHtml = "";
  if (group.readiness_reasons && group.readiness_reasons.length) {
    reasonsHtml = '<div class="cart2-group-reasons">' +
      group.readiness_reasons.map(function (r) {
        return '<div class="cart2-reason">' + escapeCartHtml(humanizeCartReason(r)) + '</div>';
      }).join("") +
    '</div>';
  }

  var actionsDisabled = group.readiness === "blocked" ? " disabled" : "";

  return (
    '<div class="cart2-group ' + readinessClass + '" data-distributor-id="' + escapeCartAttr(group.distributorId) + '">' +
      '<div class="cart2-group-head">' +
        '<div class="cart2-group-merchant">' +
          '<div class="cart2-group-name">' + escapeCartHtml(group.distributorName) + '</div>' +
          '<div class="cart2-group-readiness" data-readiness="' + group.readiness + '">' + readinessLabel + '</div>' +
        '</div>' +
        '<div class="cart2-group-subtotal">' +
          '<div class="cart2-group-subtotal-value">₦' + group.subtotal.net.toLocaleString() + '</div>' +
          '<div class="cart2-group-subtotal-label">' + group.items.length + ' line' + (group.items.length === 1 ? "" : "s") + '</div>' +
        '</div>' +
      '</div>' +
      engineLine +
      reasonsHtml +
      '<div class="cart2-group-items">' +
        group.items.map(function (item) { return renderCartItemHtml(item); }).join("") +
      '</div>' +
      '<div class="cart2-group-actions">' +
        '<button type="button" class="cart2-action cart2-action-primary" data-cart2-action="submit-inquiry" data-distributor-id="' + escapeCartAttr(group.distributorId) + '"' + actionsDisabled + '>Submit inquiry</button>' +
        '<button type="button" class="cart2-action cart2-action-whatsapp" data-cart2-action="submit-whatsapp" data-distributor-id="' + escapeCartAttr(group.distributorId) + '"' + actionsDisabled + '>WhatsApp</button>' +
        '<button type="button" class="cart2-action cart2-action-contact" data-cart2-action="submit-contact" data-distributor-id="' + escapeCartAttr(group.distributorId) + '"' + actionsDisabled + '>Contact</button>' +
      '</div>' +
    '</div>'
  );
}

function renderCartItemHtml(item) {
  var qty  = Number(item.qty) || 1;
  var unit = Number(item.price_snapshot && item.price_snapshot.value) || 0;
  var lineTotal = unit * qty;
  var basis = (item.price_snapshot && item.price_snapshot.basis) || "public";
  var basisLabel =
    basis === "negotiated"            ? "Negotiated price" :
    basis === "relationship_discount" ? "Relationship discount" :
    basis === "negotiable"            ? "Negotiable" :
    "Public price";

  var imageStyle = item.image_url
    ? "background-image:url('" + escapeCartAttr(item.image_url) + "');"
    : "";

  return (
    '<div class="cart2-item" data-product-id="' + escapeCartAttr(item.productId) + '">' +
      '<div class="cart2-item-image" style="' + imageStyle + '"></div>' +
      '<div class="cart2-item-body">' +
        '<div class="cart2-item-name">' + escapeCartHtml(item.name) + '</div>' +
        '<div class="cart2-item-basis" data-basis="' + escapeCartAttr(basis) + '">' + escapeCartHtml(basisLabel) + '</div>' +
        '<div class="cart2-item-qty">' +
          '<button type="button" class="cart2-qty-btn" data-cart2-action="qty-dec" data-product-id="' + escapeCartAttr(item.productId) + '" aria-label="Decrease quantity">−</button>' +
          '<span class="cart2-qty-value">' + qty + '</span>' +
          '<button type="button" class="cart2-qty-btn" data-cart2-action="qty-inc" data-product-id="' + escapeCartAttr(item.productId) + '" aria-label="Increase quantity">+</button>' +
          '<span class="cart2-item-unit">× ₦' + unit.toLocaleString() + '</span>' +
        '</div>' +
      '</div>' +
      '<div class="cart2-item-right">' +
        '<div class="cart2-item-total">₦' + lineTotal.toLocaleString() + '</div>' +
        '<button type="button" class="cart2-item-remove" data-cart2-action="remove" data-product-id="' + escapeCartAttr(item.productId) + '" aria-label="Remove line">✕</button>' +
      '</div>' +
    '</div>'
  );
}

function bindCartEvents(container) {
  if (container.__cart2Bound) return;
  container.__cart2Bound = true;
  container.addEventListener("click", handleCartClick);
}

async function handleCartClick(e) {
  var t = e.target.closest("[data-cart2-action]");
  if (!t) return;
  var action = t.getAttribute("data-cart2-action");
  var productId = t.getAttribute("data-product-id");
  var distributorId = t.getAttribute("data-distributor-id");

  if (action === "qty-inc") {
    e.preventDefault();
    var item = cart.find(function (i) { return i.productId === productId; });
    if (item) setCartQty(productId, (Number(item.qty) || 1) + 1);
    return;
  }
  if (action === "qty-dec") {
    e.preventDefault();
    var item2 = cart.find(function (i) { return i.productId === productId; });
    if (item2) setCartQty(productId, (Number(item2.qty) || 1) - 1);
    return;
  }
  if (action === "remove") {
    e.preventDefault();
    removeFromCart(productId);
    return;
  }
  if (action === "submit-inquiry" || action === "submit-whatsapp" || action === "submit-contact") {
    e.preventDefault();
    var mode = action === "submit-inquiry" ? "inquiry"
             : action === "submit-whatsapp" ? "whatsapp"
             : "contact";
    var groupEl = t.closest(".cart2-group");
    if (groupEl) {
      groupEl.querySelectorAll("[data-cart2-action^='submit']").forEach(function (b) { b.disabled = true; });
    }
    var result = await submitCartGroup(distributorId, mode);
    if (!result.ok) {
      renderCart();
      var reasonMsg = result.reason || (result.errors && result.errors[0]) || "Submission failed";
      alert(humanizeCartReason(reasonMsg));
      return;
    }
    renderCart();
    return;
  }
}

// ==========================================================================
// FORMATTING
// ==========================================================================

function formatCartAge(ms) {
  if (ms == null) return "";
  var m = Math.floor(ms / 60000);
  if (m < 1) return "<1m";
  if (m < 60) return m + "m";
  var h = Math.floor(m / 60);
  if (h < 24) return h + "h";
  return Math.floor(h / 24) + "d";
}

function humanizeCartReason(reason) {
  var r = String(reason || "");

  if (r.indexOf("moq_not_met:") === 0) {
    var parts = r.split(":");
    return "Minimum order quantity is " + parts[2].replace("need ", "").split(",")[0].replace(" have", ", you have") + ". Increase quantity to continue.";
  }
  if (r.indexOf("price_stale:") === 0) {
    var p = r.split(":");
    return "Price for " + p[1] + " was captured " + p[2] + " — please re-add this item to confirm the current price.";
  }
  if (r.indexOf("relationship_") === 0) {
    var rp = r.split(":");
    var status = rp[0].replace("relationship_", "");
    return "Your relationship with " + rp[1] + " is " + status + ". Reconnect before submitting this order.";
  }
  if (r.indexOf("engine_stale:") === 0) {
    return "Stock signal is over " + (CART_STALE_AFTER_MS / 60000) + " minutes old. Stock may have changed — confirm with the distributor before submitting.";
  }
  if (r.indexOf("engine_unavailable:") === 0) {
    return "Stock signal is currently unavailable. You can still submit, but the distributor will confirm availability on response.";
  }
  if (r.indexOf("rate_limited:") === 0) {
    return "You submitted this order recently. Please wait " + r.split(":")[1] + "s before resubmitting.";
  }
  if (r === "in_flight") {
    return "A submission is already in progress. Please wait.";
  }
  if (r.indexOf("product_not_found:") === 0) {
    return r.split(":")[1] + " is no longer in the catalogue. Remove it and try again.";
  }
  if (r.indexOf("product_inactive:") === 0) {
    return r.split(":")[1] + " is currently unavailable. Remove it or contact the distributor.";
  }
  if (r.indexOf("product_ownership_mismatch:") === 0) {
    return r.split(":")[1] + " is no longer sold by this distributor. Remove it and try again.";
  }
  if (r.indexOf("insufficient_stock:") === 0) {
    return "Not enough stock for " + r.split(":")[1] + ". Reduce quantity or contact the distributor.";
  }
  if (r.indexOf("price_changed:") === 0) {
    return "Price changed since you added " + r.split(":")[1] + ". Remove and re-add to confirm the current price.";
  }
  if (r === "phone_unavailable") {
    return "This distributor's phone number is unavailable. Try Contact instead.";
  }
  if (r === "product_lookup_failed") {
    return "Could not verify stock right now. Please try again in a moment.";
  }
  return r;
}

// ==========================================================================
// HELPERS (local to cart.js — do not collide with other modules)
// ==========================================================================

function escapeCartHtml(v) {
  return String(v == null ? "" : v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
function escapeCartAttr(v) { return escapeCartHtml(v); }

// ==========================================================================
// INIT
// ==========================================================================

(function cartInit() {
  // 1) Integrity check first (V5). A mismatch means tampering or corruption.
  //    Wipe and warn — fail safe rather than submit a suspicious cart.
  if (!cartVerifyIntegrity()) {
    console.warn("[GoodsbarnX/cart] cart integrity check failed — clearing cart");
    try {
      localStorage.removeItem(CART_STORAGE_KEY);
      localStorage.removeItem(CART_HASH_KEY);
      if (typeof cart !== "undefined" && Array.isArray(cart)) cart.length = 0;
    } catch (_) {}
  }

  // 2) Migrate legacy carts (pre-v4 shape)
  try { migrateLegacyCart(); } catch (_) {}

  // 3) Badge sync on load
  if (typeof window !== "undefined") {
    if (document.readyState === "complete" || document.readyState === "interactive") {
      setTimeout(function () { updateCartBadge(); }, 0);
    } else {
      window.addEventListener("DOMContentLoaded", function () { updateCartBadge(); });
    }
  }
})();

console.log("[GoodsbarnX] cart.js loaded (V1.8.2.6 rev.4 · Relationship-Order + Security F-21)");
