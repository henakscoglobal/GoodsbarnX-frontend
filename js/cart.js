// ==========================================================================
// GoodsbarnX — cart.js  (rev. 8 · Canonical Basis + Pre-Submit Reprice)
// Plain global script. Depends on the global `cart` array.
//
// rev.8 changes (F-19-D):
//   - ROOT-CAUSE FIX: price basis is normalised through normalizeCartBasis().
//     Display labels from older storefront builds ("your_negotiated_price",
//     "relationship_discount_13") were falling through the whitelist in
//     deriveCartPriceBasis() and being sent to submit_cart_group as
//     "public", so the server compared a discounted unit_price against the
//     catalogue price and raised "Price mismatch". Stored carts are repaired
//     in place (normalizeCartSnapshots) so buyers need not clear them.
//   - cartRepriceGroup(): before an order is submitted, each line is
//     re-priced against the SAME server-authoritative source the storefront
//     uses (get_relationship_pricing + products.price). If a price has
//     drifted, the snapshot is updated and the buyer is asked to review;
//     the order is never silently submitted at a different price. If the
//     check cannot run (network/RLS), it is skipped and the server remains
//     the final authority.
//   - Cart lines, WhatsApp text and idempotency key use the canonical basis.
//   - Server price-mismatch errors are logged with the raw message and
//     payload for diagnosis, and the product name is trimmed.
//
// rev.7 changes (retained):
//   - submit_cart_group is the sole price authority; the client submits the
//     snapshot and `price_basis` and surfaces the server's error.
// ==========================================================================

// ==========================================================================
// CONSTANTS
// ==========================================================================

const CART_STORAGE_KEY   = "goodsbarnx_cart";
const CART_HASH_KEY      = "goodsbarnx_cart:hash";
const CART_SCHEMA_VERSION = 8;

const CART_STALE_AFTER_MS       = 5  * 60 * 1000;
const CART_UNAVAILABLE_AFTER_MS = 30 * 60 * 1000;

// Rate limit: per (buyer, distributor) submission cooldown.
const CART_SUBMIT_COOLDOWN_MS = 30 * 1000;

// ==========================================================================
// PRICE BASIS (canonical vocabulary shared with storefront.js and the RPC)
//   public | relationship_discount | negotiated | negotiable
// ==========================================================================

function normalizeCartBasis(basis) {
  var b = String(basis == null ? "" : basis).toLowerCase();
  if (b === "public" || b === "relationship_discount" || b === "negotiated" || b === "negotiable") return b;
  if (b === "your_negotiated_price" || b.indexOf("negotiated") === 0) return "negotiated";
  if (b.indexOf("relationship_discount") === 0) return "relationship_discount";
  return "public";
}

function cartBasisLabel(basis) {
  switch (normalizeCartBasis(basis)) {
    case "negotiated":            return "Negotiated price";
    case "relationship_discount": return "Relationship discount";
    case "negotiable":            return "Negotiable";
    default:                      return "Public price";
  }
}

// Repairs lines saved by earlier builds (non-canonical basis labels).
function normalizeCartSnapshots() {
  var changed = false;
  cart.forEach(function (item) {
    if (!item || !item.price_snapshot) return;
    var norm = normalizeCartBasis(item.price_snapshot.basis);
    if (item.price_snapshot.basis !== norm) {
      item.price_snapshot.basis = norm;
      changed = true;
    }
  });
  if (changed) cartPersist();
}

function cartSb() {
  if (window.sb) return window.sb;
  try { if (typeof sb !== "undefined" && sb) return sb; } catch (_) {}
  return null;
}

// ==========================================================================
// L1 · STORE
// ==========================================================================

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
    if (!payload) return true;
    if (!stored) return false;
    return cartHash(payload) === stored;
  } catch (_) {
    return false;
  }
}

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

function addToCart(productId, name, price, distributorId, distributorName, qty, opts) {
  var addQty = Number(qty);
  if (!isFinite(addQty) || addQty < 1) addQty = 1;
  addQty = Math.floor(addQty);

  var o = opts || {};
  var moq = Number(o.moq) || 1;
  if (addQty < moq) addQty = moq;

  // Canonical vocabulary only; null when the caller supplied no basis.
  var basis = o.price_basis ? normalizeCartBasis(o.price_basis) : null;

  var existing = cart.find(function (item) { return item.productId === productId; });
  if (existing) {
    existing.qty = (Number(existing.qty) || 1) + addQty;
    if (isFinite(Number(price)) && Number(price) > 0) {
      var prevSnap = existing.price_snapshot || {};
      existing.price_snapshot = {
        value: Number(price),
        basis: basis || normalizeCartBasis(prevSnap.basis),
        termsRef: o.termsRef || prevSnap.termsRef || null,
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
        basis: basis || (price ? "public" : "negotiable"),
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
// L2 · GROUPING
// ==========================================================================

function getCartGroups() {
  // Repair any non-canonical basis labels before grouping, rendering or submitting.
  normalizeCartSnapshots();

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

var __cartSubmitInFlight = false;
var __cartLastSubmitByDist = Object.create(null);

async function submitCartGroup(distributorId, mode) {
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
    else                         result = await submitCartGroupOrder(group);

    if (result.ok) __cartLastSubmitByDist[distributorId] = Date.now();
    return result;
  } finally {
    __cartSubmitInFlight = false;
  }
}

// -------------------------------------------------------------------------
// F-19 · idempotency key derivation
// -------------------------------------------------------------------------
function deriveCartIdempotencyKey(group) {
  if (!group || !Array.isArray(group.items) || !group.items.length) return null;
  var parts = group.items.map(function (it) {
    var pid = String(it.productId || "");
    var qty = String(Number(it.qty) || 0);
    var basis = normalizeCartBasis(it.price_snapshot && it.price_snapshot.basis);
    return pid + ":" + qty + ":" + basis;
  });
  parts.sort();
  return "cart:" + String(group.distributorId || "") + "|" + parts.join(";");
}

// -------------------------------------------------------------------------
// F-19 · price basis mapping (canonical; never downgrades a known basis)
// -------------------------------------------------------------------------
function deriveCartPriceBasis(item) {
  return normalizeCartBasis(item && item.price_snapshot && item.price_snapshot.basis);
}

// -------------------------------------------------------------------------
// F-19-D · authoritative re-pricing
//
// Mirrors storefront.js sfComputePrice() exactly, so the cart and the
// storefront can never disagree:
//   negotiated price  >  relationship discount (active only)  >  public price
//   no public price and no negotiated price  →  negotiable (0)
// -------------------------------------------------------------------------
function cartAuthoritativePrice(publicPrice, negotiatedPrice, discountPercent) {
  var pub = Number(publicPrice) || 0;
  if (negotiatedPrice != null && negotiatedPrice !== "" && isFinite(Number(negotiatedPrice))) {
    return { value: Number(negotiatedPrice), basis: "negotiated" };
  }
  if (discountPercent > 0 && pub > 0) {
    return { value: Math.round(pub * (1 - discountPercent / 100)), basis: "relationship_discount" };
  }
  if (pub > 0) return { value: pub, basis: "public" };
  return { value: 0, basis: "negotiable" };
}

function describeRepriceChanges(changes) {
  return changes.map(function (c) {
    return c.name + ": ₦" + Number(c.from).toLocaleString() + " → ₦" + Number(c.to).toLocaleString();
  }).join("; ");
}

// Returns { checked: boolean, changes: [{name, from, to}] }.
// Fails open: if the check cannot run, the server stays the final authority.
async function cartRepriceGroup(group) {
  var client = cartSb();
  if (!client || !currentUser || currentUser.role !== "buyer" || !group.distributorId) {
    return { checked: false, changes: [] };
  }

  var pricing, priceRows;
  try {
    var pr = await client.rpc("get_relationship_pricing", {
      p_buyer_id: currentUser.id,
      p_distributor_id: group.distributorId
    });
    if (pr.error) throw pr.error;
    pricing = pr.data || {};

    var ids = group.items.map(function (it) { return String(it.productId); });
    var pq = await client.from("products").select("id, price").in("id", ids);
    if (pq.error) throw pq.error;
    priceRows = pq.data || [];
  } catch (err) {
    console.warn("[GoodsbarnX/cart] reprice check skipped:", err && err.message);
    return { checked: false, changes: [] };
  }

  var discount   = pricing.status === "active" ? (Number(pricing.discount_percent) || 0) : 0;
  var negotiated = pricing.negotiated_prices || {};
  var publicById = Object.create(null);
  priceRows.forEach(function (r) { publicById[String(r.id)] = r.price; });

  var changes = [];
  var touched = false;

  group.items.forEach(function (item) {
    var pid = String(item.productId);
    if (!(pid in publicById)) return; // not visible in the catalogue; the server reports it

    var auth = cartAuthoritativePrice(publicById[pid], negotiated[pid], discount);
    var snap = item.price_snapshot || {};
    var oldValue = Number(snap.value) || 0;
    var valueChanged = Math.abs(auth.value - oldValue) > 0.004;
    var basisChanged = normalizeCartBasis(snap.basis) !== auth.basis;
    if (!valueChanged && !basisChanged) return;

    item.price_snapshot = {
      value: auth.value,
      basis: auth.basis,
      termsRef: snap.termsRef || null,
      capturedAt: new Date().toISOString()
    };
    touched = true;
    if (valueChanged) {
      changes.push({ name: String(item.name || "an item").trim(), from: oldValue, to: auth.value });
    }
  });

  if (touched) cartPersist();
  return { checked: true, changes: changes };
}

// -------------------------------------------------------------------------
// F-19 · submitCartGroupOrder
// -------------------------------------------------------------------------
async function submitCartGroupOrder(group) {
  var client = cartSb();
  if (!currentUser || !client) return { ok: false, reason: "not_authenticated" };
  if (!group || !Array.isArray(group.items) || !group.items.length) {
    return { ok: false, reason: "empty_group" };
  }

  // Re-verify prices against server-authoritative terms BEFORE building the
  // payload. If anything drifted, show the buyer the new price instead of
  // submitting or silently changing what they agreed to.
  var reprice = await cartRepriceGroup(group);
  if (reprice.changes.length) {
    return { ok: false, reason: "price_updated:" + describeRepriceChanges(reprice.changes) };
  }

  // Build the RPC payload
  var items = group.items.map(function (it) {
    var snap = it.price_snapshot || {};
    return {
      product_id: String(it.productId),
      quantity:   Number(it.qty) || 1,
      unit_price: Number(snap.value) || 0,
      price_basis: deriveCartPriceBasis(it),
      buyer_note: null // reserved — no UI yet, but the schema accepts it
    };
  });

  var idempotencyKey = deriveCartIdempotencyKey(group);

  var result;
  try {
    result = await client.rpc("submit_cart_group", {
      p_distributor_id: group.distributorId,
      p_items: items,
      p_idempotency_key: idempotencyKey
    });
  } catch (err) {
    console.error("[GoodsbarnX/cart] submit_cart_group threw:", err && err.message);
    return { ok: false, reason: "submit_failed:" + (err && err.message || "network") };
  }

  if (result.error) {
    var msg = String(result.error.message || "");
    var code = String(result.error.code || "");

    // Map RPC-raised exceptions to cart-level reasons
    if (/price mismatch/i.test(msg)) {
      console.warn("[GoodsbarnX/cart] server price mismatch:", code, msg, JSON.stringify(items));
      var match = msg.match(/Price mismatch for (.+?) \(/);
      var productName = match && match[1] ? match[1].trim() : "an item";
      return { ok: false, reason: "price_changed:" + productName };
    }
    if (/relationship with distributor is not active/i.test(msg)) {
      return { ok: false, reason: "relationship_inactive:" + (group.distributorName || "this distributor") };
    }
    if (/insufficient stock for (.+?) \(/i.test(msg)) {
      var sMatch = msg.match(/Insufficient stock for (.+?) \(/);
      return { ok: false, reason: "insufficient_stock:" + (sMatch && sMatch[1] || "an item") };
    }
    if (/quantity below moq for (.+?) \(/i.test(msg)) {
      var qMatch = msg.match(/Quantity below MOQ for (.+?) \(/);
      return { ok: false, reason: "moq_not_met:" + (qMatch && qMatch[1] || "an item") + ":server-verified" };
    }
    if (/not your order/i.test(msg) || code === "42501") {
      return { ok: false, reason: "submit_failed:permission" };
    }
    console.warn("[GoodsbarnX/cart] submit_cart_group error:", code, msg);
    return { ok: false, reason: "submit_failed:" + (msg || "unknown") };
  }

  // Success
  var data = result.data || {};

  // Clear the group locally. The server has the authoritative record.
  clearCartGroup(group.distributorId);

  return {
    ok: true,
    mode: "order",
    order_id: data.order_id,
    status: data.status || "submitted",
    submitted: data.item_count || group.items.length
  };
}

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
    var basis = cartBasisLabel(item.price_snapshot && item.price_snapshot.basis);
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
        '<button type="button" class="cart2-action cart2-action-primary" data-cart2-action="submit-inquiry" data-distributor-id="' + escapeCartAttr(group.distributorId) + '"' + actionsDisabled + '>Submit order</button>' +
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
  var basis = normalizeCartBasis(item.price_snapshot && item.price_snapshot.basis);
  var basisLabel = cartBasisLabel(basis);

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

  if (r.indexOf("price_updated:") === 0) {
    return "Prices were updated to your current terms (" +
      r.slice("price_updated:".length) +
      "). Review your cart, then submit again.";
  }
  if (r.indexOf("moq_not_met:") === 0) {
    var parts = r.split(":");
    if (parts[2] === "server-verified") {
      return "The minimum order quantity for " + parts[1] + " has changed. Remove and re-add this item.";
    }
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
    var detail = String(r.split(":")[1] || "").trim();
    if (detail.indexOf("suspiciously_low") !== -1) {
      return "The price for this item cannot be verified. Please remove it and re-add from the storefront.";
    }
    if (detail.indexOf("higher") !== -1) {
      return "The price for this item is higher than the current catalogue. Please remove and re-add.";
    }
    return "The price for " + (detail || "this item") +
      " no longer matches your current terms with the distributor. Remove it and re-add it from the storefront.";
  }
  if (r === "phone_unavailable") {
    return "This distributor's phone number is unavailable. Try Contact instead.";
  }
  if (r === "product_lookup_failed") {
    return "Could not verify stock right now. Please try again in a moment.";
  }
  if (r.indexOf("submit_failed:") === 0) {
    var detail2 = r.split(":")[1] || "";
    if (detail2 === "permission") return "You don't have permission to submit this order.";
    return "Could not submit order: " + (detail2 || "please try again.");
  }
  if (r === "empty_group") {
    return "This cart group has no items.";
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
  if (!cartVerifyIntegrity()) {
    console.warn("[GoodsbarnX/cart] cart integrity check failed — clearing cart");
    try {
      localStorage.removeItem(CART_STORAGE_KEY);
      localStorage.removeItem(CART_HASH_KEY);
      if (typeof cart !== "undefined" && Array.isArray(cart)) cart.length = 0;
    } catch (_) {}
  }

  try { migrateLegacyCart(); } catch (_) {}

  if (typeof window !== "undefined") {
    if (document.readyState === "complete" || document.readyState === "interactive") {
      setTimeout(function () { updateCartBadge(); }, 0);
    } else {
      window.addEventListener("DOMContentLoaded", function () { updateCartBadge(); });
    }
  }
})();

console.log("[GoodsbarnX] cart.js loaded (V1.8.2.7 rev.8 · Canonical Basis + Pre-Submit Reprice)");
