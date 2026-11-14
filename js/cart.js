// ==========================================================================
// GoodsbarnX — cart.js  (rev. 2)
// Shopping cart: add, remove, render, badge count. Persisted to localStorage.
// Plain global script — depends on the global `cart` array (loaded from
// localStorage in the main inline script in index.html) already existing.
//
// rev.2 changes (F-17):
//   - addToCart now accepts an optional 6th `qty` argument. Defaults to 1.
//     The storefront's quantity stepper passes qty; every other call site
//     that omits it continues to add 1 per call. Existing items increment
//     by the passed qty, not always by 1.
//   - removeFromCart no longer reassigns `cart` (which fails when cart is
//     const-declared upstream). Mutates in place via splice.
//   - Cart badge shows TOTAL UNITS, not distinct products. A cart of
//     5 Kerrygold + 3 Metal sheets shows "8", matching what users expect.
//   - The blocking alert() on add is removed. Feedback is the caller's job
//     (the storefront shows inline "Added ✓"; the market screen keeps its
//     existing UX). Removing the alert does not affect any call site.
// ==========================================================================

function addToCart(productId, name, price, distributorId, distributorName, qty) {
  // qty is optional; callers that omit it (market screen, etc.) get 1.
  var addQty = Number(qty);
  if (!isFinite(addQty) || addQty < 1) addQty = 1;
  addQty = Math.floor(addQty);

  var existing = cart.find(function (item) { return item.productId === productId; });
  if (existing) {
    existing.quantity = (existing.quantity || 1) + addQty;
  } else {
    cart.push({
      productId: productId,
      name: name,
      price: price,
      distributorId: distributorId,
      distributorName: distributorName,
      quantity: addQty
    });
  }
  localStorage.setItem("goodsbarnx_cart", JSON.stringify(cart));
  updateCartBadge();

  // Give the caller a lightweight hook if it wants to show its own feedback.
  // Storefront already handles "Added ✓" inline; market screen currently
  // relies on the (now removed) alert. If the market screen needs feedback,
  // it should add its own — do not re-introduce a global alert here.
  try {
    document.dispatchEvent(new CustomEvent("goodsbarnx:cart-added", {
      detail: { productId: productId, name: name, quantity: addQty }
    }));
  } catch (_) { /* CustomEvent unsupported in older browsers — non-fatal */ }
}

function cartTotalUnits() {
  return cart.reduce(function (sum, item) {
    return sum + (Number(item.quantity) || 1);
  }, 0);
}

function updateCartBadge() {
  var badge = document.getElementById("cart-badge");
  if (!badge) return;
  var units = cartTotalUnits();
  badge.textContent = units;
  badge.style.display = units > 0 ? "block" : "none";
}

function renderCart() {
  var container = document.getElementById("cart-content");
  if (!container) return;

  if (cart.length === 0) {
    container.innerHTML = '<div class="loading-text">Your cart is empty.</div>';
    return;
  }

  container.innerHTML = cart.map(function (item) {
    var qty = Number(item.quantity) || 1;
    var priceLine = item.price
      ? "₦" + Number(item.price).toLocaleString() + " × " + qty
      : "Negotiable × " + qty;
    var subtotal = item.price
      ? "₦" + (Number(item.price) * qty).toLocaleString()
      : "";

    return '<div class="cart-item">' +
      '<div style="min-width:0;">' +
        '<div style="font-weight:600; font-size:13px;">' + escapeCartHtml(item.name) + '</div>' +
        '<div style="font-size:11px; color:rgba(239,233,222,0.5);">' + escapeCartHtml(item.distributorName) + '</div>' +
        '<div style="font-size:12px; margin-top:4px;">' + priceLine +
          (subtotal ? ' · <strong>' + subtotal + '</strong>' : '') +
        '</div>' +
      '</div>' +
      '<button class="btn btn-danger" data-cart-remove="' + escapeCartAttr(item.productId) + '" aria-label="Remove ' +
        escapeCartAttr(item.name) + '">✕</button>' +
    '</div>';
  }).join("");

  // Delegate removal — safer than inline onclick because product names can
  // contain quotes or special characters that break inline handlers.
  container.querySelectorAll("[data-cart-remove]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      removeFromCart(btn.getAttribute("data-cart-remove"));
    });
  });
}

function removeFromCart(productId) {
  // Do not reassign `cart`. It may be const-declared upstream; reassigning
  // throws in strict mode and silently fails in some browsers. Mutate in
  // place instead.
  for (var i = cart.length - 1; i >= 0; i--) {
    if (cart[i].productId === productId) cart.splice(i, 1);
  }
  localStorage.setItem("goodsbarnx_cart", JSON.stringify(cart));
  updateCartBadge();
  renderCart();
}

// Small helpers — kept local to cart.js so they don't collide with the
// escaping helpers used elsewhere (inquiries.js, relationship.js, etc.).
function escapeCartHtml(v) {
  return String(v == null ? "" : v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
function escapeCartAttr(v) { return escapeCartHtml(v); }

// Keep the badge in sync on any page that has a cart badge — call once at
// load. If the badge isn't in the DOM yet, the call is a no-op.
if (typeof window !== "undefined") {
  window.addEventListener("DOMContentLoaded", function () { updateCartBadge(); });
}
