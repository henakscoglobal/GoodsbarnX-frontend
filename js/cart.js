// ==========================================================================
// GoodsbarnX — cart.js
// Shopping cart: add, remove, render, badge count. Persisted to localStorage.
// Plain global script — depends on the global `cart` array (loaded from
// localStorage in the main inline script in index.html) already existing.
// ==========================================================================

function addToCart(productId, name, price, distributorId, distributorName) {
  const existing = cart.find(item => item.productId === productId);
  if (existing) {
    existing.quantity = (existing.quantity || 1) + 1;
  } else {
    cart.push({ productId, name, price, distributorId, distributorName, quantity: 1 });
  }
  localStorage.setItem("goodsbarnx_cart", JSON.stringify(cart));
  updateCartBadge();
  alert(name + " added to cart!");
}

function updateCartBadge() {
  const badge = document.getElementById("cart-badge");
  if (badge) {
    badge.textContent = cart.length;
    badge.style.display = cart.length > 0 ? "block" : "none";
  }
}

function renderCart() {
  const container = document.getElementById("cart-content");

  if (cart.length === 0) {
    container.innerHTML = '<div class="loading-text">Your cart is empty.</div>';
    return;
  }

  container.innerHTML = cart.map((item, index) => `
    <div class="cart-item">
      <div>
        <div style="font-weight:600; font-size:13px;">${item.name}</div>
        <div style="font-size:11px; color:rgba(239,233,222,0.5);">${item.distributorName}</div>
        <div style="font-size:12px; margin-top:4px;">${item.price ? "₦" + item.price : "Negotiable"} × ${item.quantity || 1}</div>
      </div>
      <button class="btn btn-danger" onclick="removeFromCart('${item.productId}')">✕</button>
    </div>
  `).join("");
}

function removeFromCart(productId) {
  cart = cart.filter(item => item.productId !== productId);
  localStorage.setItem("goodsbarnx_cart", JSON.stringify(cart));
  updateCartBadge();
  renderCart();
}
