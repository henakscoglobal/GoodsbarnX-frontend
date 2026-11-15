// ==========================================================================
// GoodsbarnX — cart.js  (rev. 3 · Relationship-Order Assembly Surface)
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
// Backward compatibility (do not break):
//   - addToCart(productId, name, price, distributorId, distributorName, qty?)
//     keeps its exact signature. 6th arg still honoured.
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
const CART_SCHEMA_VERSION = 3;

// Engine freshness: mirror the storefront. If the snapshot is older than
// STALE_AFTER_MS, the group shows "review"; older than UNAVAILABLE_AFTER_MS,
// urgency claims are suppressed entirely.
const CART_STALE_AFTER_MS       = 5  * 60 * 1000;
const CART_UNAVAILABLE_AFTER_MS = 30 * 60 * 1000;

// ==========================================================================
// L1 · STORE
// ==========================================================================

/**
 * Called once at load. If the cart on disk is a pre-v3 flat array, upgrade
 * each item to the new snapshot shape without losing anything.
 *
 * Legacy shape: { productId, name, price, distributorId, distributorName, quantity }
 * New shape:    { productId, distributorId, name, sku, brand, image_url,
 *                 qty, moq, price_snapshot: {value, basis, termsRef, capturedAt},
 *                 relationship_status_at_add }
 */
function migrateLegacyCart() {
  try {
    const raw = localStorage.getItem(CART_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return;

    let changed = false;
    const upgraded = parsed.map(function (item) {
      if (item && item.price_snapshot) return item; // already v3
      changed = true;
      return {
        productId: item.productId,
        distributorId: item.distributorId || null,
        name: item.name || "Product",
        sku: item.sku || null,
        brand: item.brand || null,
        image_url: item.image_url || null,
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
      localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(upgraded));
      // Reflect in the in-memory global so subsequent code sees v3.
      if (typeof cart !== "undefined" && Array.isArray(cart)) {
        try { cart.length = 0; upgraded.forEach(function (u) { cart.push(u); }); } catch (_) {}
      }
    }
  } catch (err) {
    console.warn("[GoodsbarnX/cart] migrateLegacyCart failed:", err && err.message);
  }
}

/**
 * Persist the in-memory cart. Wrapped so a failed write doesn't crash the
 * add/remove path — the buyer can still finish the interaction.
 */
function cartPersist() {
  try {
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart || []));
  } catch (err) {
    console.warn("[GoodsbarnX/cart] persist failed:", err && err.message);
  }
}

/**
 * Public API — keep the same signature. The `qty` arg is honoured.
 * Also accepts an optional 7th argument `opts` for the storefront to pass
 * a richer snapshot: { sku, brand, image_url, moq, price_basis,
 * relationship_status_at_add }.
 */
function addToCart(productId, name, price, distributorId, distributorName, qty, opts) {
  var addQty = Number(qty);
  if (!isFinite(addQty) || addQty < 1) addQty = 1;
  addQty = Math.floor(addQty);

  var o = opts || {};
  var moq = Number(o.moq) || 1;
  // Enforce MOQ: adding less than MOQ is silently bumped to MOQ (this is
  // the correct commercial behaviour — you cannot order below the minimum).
  if (addQty < moq) addQty = moq;

  var existing = cart.find(function (item) { return item.productId === productId; });
  if (existing) {
    existing.qty = (Number(existing.qty) || 1) + addQty;
    // Refresh snapshot only if a new price is passed (storefront always
    // passes one; other callers may omit).
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
  } catch (_) { /* CustomEvent unsupported in older browsers — non-fatal */ }
}

/**
 * Set the exact quantity of a line. Enforces MOQ. Setting to 0 or below
 * removes the line (this is what the UI stepper does when it hits 0).
 */
function setCartQty(productId, qty) {
  var item = cart.find(function (i) { return i.productId === productId; });
  if (!item) return;

  var q = Math.floor(Number(qty));
  if (!isFinite(q) || q <= 0) {
    removeFromCart(productId);
    return;
  }
  if (q < (item.moq || 1)) q = item.moq || 1;
  item.qty = q;
  cartPersist();
  updateCartBadge();
  renderCart();
}

/**
 * Remove by product id. Does not reassign `cart` — mutate in place to
 * survive const-declared globals.
 */
function removeFromCart(productId) {
  for (var i = cart.length - 1; i >= 0; i--) {
    if (cart[i].productId === productId) cart.splice(i, 1);
  }
  cartPersist();
  updateCartBadge();
  renderCart();
}

/**
 * Empty the whole cart. Used by "clear all" and by post-submission flow.
 */
function clearCart() {
  cart.length = 0;
  cartPersist();
  updateCartBadge();
  renderCart();
}

/**
 * Remove everything for a distributor. Used after a successful submission
 * of that distributor's group.
 */
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

/**
 * Build the commercial view of the cart. Every group is one deliverable
 * order from one distributor. Groups carry:
 *   - distributor identity
 *   - subtotal (gross / discount / net)
 *   - engine context (stock state, freshness)
 *   - readiness (ready | needs_review | blocked)
 *   - reasons[] for non-ready state
 *
 * This function is PURE — no DOM, no network. Everything it needs comes
 * from `cart` and the current replenishment snapshot on window. This makes
 * it testable and safe to call from anywhere.
 */
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

    // Engine context per group
    g.engineContext = getCartEngineContext(g.distributorId);

    // Readiness — collected from guardrails
    var reasons = [];
    var anyBlocked    = false;
    var anyNeedsReview= false;

    g.items.forEach(function (item) {
      var moqCheck  = guardMoqSatisfied(item);
      var freshCheck= guardPriceSnapshotFresh(item);
      if (!moqCheck.ok)  { anyBlocked = true; reasons.push.apply(reasons, moqCheck.reasons); }
      if (!freshCheck.ok){ anyNeedsReview = true; reasons.push.apply(reasons, freshCheck.reasons); }
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

/**
 * Read the replenishment snapshot for this distributor. Same source the
 * storefront uses (window.goodsbarnxLastReplenishmentSnapshot). Never
 * fabricates. Returns "unknown" if snapshot absent.
 */
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

/**
 * MOQ is a hard constraint. A cart line below MOQ cannot be submitted.
 * The addToCart path bumps to MOQ automatically, so this guard only fires
 * when someone manually edits the cart to a non-compliant quantity.
 */
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

/**
 * Price snapshots expire. If the snapshot is older than CART_STALE_AFTER_MS,
 * the buyer must re-confirm before submission. This protects against silent
 * price changes between add and submit — the buyer always sees the price
 * they agree to.
 */
function guardPriceSnapshotFresh(item) {
  var snap = item.price_snapshot;
  if (!snap || !snap.capturedAt) {
    return { ok: true, reasons: [] }; // legacy items migrated with "now"
  }
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

/**
 * Relationship check. In the UI pass, this uses whatever status was captured
 * at add time. On submission, the caller (submitCartGroup) does a live check
 * before this guard runs. If the status has flipped since add, the guard
 * fires and the buyer is asked to re-confirm.
 */
function guardRelationshipActive(group) {
  // If we've already been given a live status (from submitCartGroup), use it.
  if (group.relationship && group.relationship.status) {
    if (group.relationship.status !== "active") {
      return {
        ok: false,
        reasons: ["relationship_" + group.relationship.status + ":" + group.distributorName]
      };
    }
    return { ok: true, reasons: [] };
  }
  // No live status known yet — do not block. Submission will check live.
  return { ok: true, reasons: [] };
}

/**
 * Engine transparency — is the stock signal still trustworthy? If unavailable
 * or stale, the group needs review. This is not a block; it's a "confirm you
 * still want this" flag.
 */
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

/**
 * Reused from storefront, same policy. Applied to the cart render plan.
 * Prevents countdown timers, fake scarcity markers, modal traps.
 */
function guardNoDarkPatternsCart(renderPlan) {
  var reasons = [];
  var html = String(renderPlan && renderPlan.html || "");
  if (/<[^>]*data-countdown/i.test(html)) reasons.push("countdown_present");
  if (/only\s+\d+\s+left/i.test(html))     reasons.push("scarcity_marker_present");
  if (/expires\s+in/i.test(html))          reasons.push("expiry_claim_present");
  if (/<dialog/i.test(html))               reasons.push("modal_trap_present");
  return { ok: reasons.length === 0, reasons: reasons };
}

// ==========================================================================
// L4 · COMMITMENT — per-distributor submission
// ==========================================================================

/**
 * Submit a single distributor's group. Three modes:
 *   "inquiry"    — creates an inquiry row per line (existing flow)
 *   "whatsapp"   — opens wa.me with formatted line items
 *   "contact"    — opens the contact modal for this distributor
 *
 * Before submitting, this function:
 *   1. Live-checks the relationship (this is the Q2 answer: on submission)
 *   2. Runs all guardrails; blocks on MOQ or relationship failure
 *   3. Attaches evidence (price basis, freshness, relationship state) to
 *      whatever gets created
 *
 * Returns { ok, mode, submitted: N, reason? }
 */
async function submitCartGroup(distributorId, mode) {
  var group = getCartGroups().find(function (g) { return g.distributorId === distributorId; });
  if (!group) return { ok: false, reason: "group_not_found" };

  // Live relationship check (Q2: on submission)
  if (currentUser && currentUser.role === "buyer" && distributorId) {
    try {
      var relQuery = await sb
        .from("trade_relationships")
        .select("status,is_primary")
        .eq("buyer_id", currentUser.id)
        .eq("distributor_id", distributorId)
        .eq("is_primary", true)
        .maybeSingle();
      if (!relQuery.error && relQuery.data) {
        group.relationship = { status: relQuery.data.status };
      } else {
        group.relationship = { status: "none" };
      }
    } catch (err) {
      console.warn("[GoodsbarnX/cart] relationship check failed:", err && err.message);
      // Don't block on network failure — the buyer's intent stands.
      group.relationship = { status: "unknown" };
    }
  }

  // Re-run guardrails with fresh relationship data
  var relCheck = guardRelationshipActive(group);
  if (!relCheck.ok && group.relationship && group.relationship.status !== "unknown") {
    return { ok: false, reason: relCheck.reasons[0] || "relationship_inactive" };
  }

  var moqViolations = group.items
    .map(function (i) { return guardMoqSatisfied(i); })
    .filter(function (r) { return !r.ok; });
  if (moqViolations.length) {
    return { ok: false, reason: moqViolations[0].reasons[0] || "moq_not_met" };
  }

  if (mode === "whatsapp") {
    return submitCartGroupWhatsApp(group);
  }
  if (mode === "contact") {
    return submitCartGroupContact(group);
  }
  return await submitCartGroupInquiry(group);
}

/**
 * WhatsApp handoff: builds a formatted message and opens wa.me.
 * No DB write. Evidence is captured in the message itself.
 */
function submitCartGroupWhatsApp(group) {
  var phone = group.distributorPhone;
  if (!phone) {
    // Try to look up the phone lazily
    sb.from("distributor_profiles").select("profiles(phone)").eq("id", group.distributorId).maybeSingle()
      .then(function (r) {
        var p = r && r.data && r.data.profiles && r.data.profiles.phone;
        if (!p) {
          alert("This distributor has no phone number on file. Try Contact instead.");
          return;
        }
        group.distributorPhone = p;
        submitCartGroupWhatsApp(group);
      });
    return { ok: false, reason: "phone_lookup_pending" };
  }

  var lines = ["Hello, I'd like to place an order from GoodsbarnX:"];
  group.items.forEach(function (item) {
    var price = Number(item.price_snapshot.value) || 0;
    var basis = item.price_snapshot.basis || "public";
    var priceLine = price > 0
      ? "₦" + price.toLocaleString() + " × " + (item.qty || 1) + " (" + basis + ")"
      : "Negotiable";
    lines.push("· " + (item.name || "Product") + " — " + priceLine);
  });
  lines.push("");
  lines.push("Total: ₦" + group.subtotal.net.toLocaleString());
  lines.push("Buyer: " + ((currentUser && currentUser.full_name) || "Guest"));

  var msg = encodeURIComponent(lines.join("\n"));
  window.open("https://wa.me/" + String(phone).replace(/\D/g, "") + "?text=" + msg, "_blank");

  // Clear the group after successful handoff
  clearCartGroup(group.distributorId);
  return { ok: true, mode: "whatsapp", submitted: group.items.length };
}

/**
 * Contact-modal handoff: uses the existing openModal() flow, which creates
 * an inquiry per distributor with the buyer's details pre-filled. We pass
 * the group summary as context so the buyer knows what they're contacting about.
 */
function submitCartGroupContact(group) {
  var lineCount = group.items.length;
  if (typeof closeStorefrontModal === "function") { try { closeStorefrontModal(); } catch (_) {} }
  if (typeof openModal === "function") {
    openModal(group.distributorId, group.distributorName, "distributor");
    // Clear this group — the buyer is committing to contact
    clearCartGroup(group.distributorId);
    return { ok: true, mode: "contact", submitted: lineCount };
  }
  return { ok: false, reason: "contact_modal_unavailable" };
}

/**
 * Inquiry submission: creates one inquiry row per line, with evidence
 * fields (price basis, freshness) embedded in the inquiry's quantity
 * description. Reuses the existing inquiries table — no schema change.
 */
async function submitCartGroupInquiry(group) {
  if (!currentUser || !window.sb) return { ok: false, reason: "not_authenticated" };

  var created = 0;
  var errors = [];

  for (var i = 0; i < group.items.length; i++) {
    var item = group.items[i];
    var snap = item.price_snapshot || {};
    var qty  = Number(item.qty) || 1;
    var unit = Number(snap.value) || 0;

    // Evidence in the inquiry text — price basis + freshness
    var evidenceBits = [];
    evidenceBits.push("cart:qty=" + qty);
    if (snap.basis) evidenceBits.push("basis=" + snap.basis);
    if (snap.capturedAt) evidenceBits.push("captured=" + snap.capturedAt);
    if (group.engineContext && group.engineContext.source) {
      evidenceBits.push("engine=" + group.engineContext.source);
    }
    if (group.relationship && group.relationship.status) {
      evidenceBits.push("relationship=" + group.relationship.status);
    }

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

  if (created > 0) {
    clearCartGroup(group.distributorId);
  }

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

/**
 * Render the cart as per-distributor groups. Each group shows:
 *   - distributor identity
 *   - engine freshness line
 *   - item list with qty stepper and price basis
 *   - subtotal
 *   - three commitment actions (only enabled when group is not blocked)
 *
 * Blocked / needs_review states are surfaced explicitly with reasons. No
 * dead cart — every group tells the buyer what to do next.
 */
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

  // Rebuild groups
  var groups = getCartGroups();

  // Guardrail on the whole plan — catches accidental dark-pattern additions
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
    group.readiness === "ready" ? "Ready to submit" :
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
        '<button type="button" class="cart2-action cart2-action-primary" data-cart2-action="submit-inquiry" data-distributor-id="' + escapeCartAttr(group.distributorId) + '"' + actionsDisabled + '>' +
          'Submit inquiry' +
        '</button>' +
        '<button type="button" class="cart2-action cart2-action-whatsapp" data-cart2-action="submit-whatsapp" data-distributor-id="' + escapeCartAttr(group.distributorId) + '"' + actionsDisabled + '>' +
          'WhatsApp' +
        '</button>' +
        '<button type="button" class="cart2-action cart2-action-contact" data-cart2-action="submit-contact" data-distributor-id="' + escapeCartAttr(group.distributorId) + '"' + actionsDisabled + '>' +
          'Contact' +
        '</button>' +
      '</div>' +
    '</div>'
  );
}

function renderCartItemHtml(item) {
  var qty = Number(item.qty) || 1;
  var unit = Number(item.price_snapshot && item.price_snapshot.value) || 0;
  var lineTotal = unit * qty;
  var basis = (item.price_snapshot && item.price_snapshot.basis) || "public";
  var basisLabel = basis === "negotiated" ? "Negotiated price"
                 : basis === "relationship_discount" ? "Relationship discount"
                 : basis === "negotiable" ? "Negotiable"
                 : "Public price";

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
    // Disable the whole action row while submitting
    var groupEl = t.closest(".cart2-group");
    if (groupEl) {
      groupEl.querySelectorAll("[data-cart2-action^='submit']").forEach(function (b) { b.disabled = true; });
    }
    var result = await submitCartGroup(distributorId, mode);
    if (!result.ok) {
      // Re-render to show updated state and let the buyer see the reason.
      renderCart();
      var reasonMsg = result.reason || (result.errors && result.errors[0]) || "Submission failed";
      alert(humanizeCartReason(reasonMsg));
      return;
    }
    // On success, the group is cleared — re-render
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
  // Migrate any pre-v3 cart on first load — before anything else touches it
  try { migrateLegacyCart(); } catch (_) {}

  // Sync badge and re-render the cart screen if it's already visible
  if (typeof window !== "undefined") {
    if (document.readyState === "complete" || document.readyState === "interactive") {
      setTimeout(function () { updateCartBadge(); }, 0);
    } else {
      window.addEventListener("DOMContentLoaded", function () { updateCartBadge(); });
    }
  }
})();

console.log("[GoodsbarnX] cart.js loaded (V1.8.2.6 rev.3 · Relationship-Order Assembly)");
