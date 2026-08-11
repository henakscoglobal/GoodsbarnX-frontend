// GoodsbarnX – Smart Cart Module

let cart = JSON.parse(localStorage.getItem("goodsbarnx_cart") || "[]");

document.addEventListener("screenChanged", (e) => {
  if (e.detail.screen === "cart") renderCart();
});

document.addEventListener("userLoaded", () => {
  updateCartBadge();
});

function saveCart() {
  localStorage.setItem("goodsbarnx_cart", JSON.stringify(cart));
  updateCartBadge();
}

function addToCart(productId, name, price, moq, stockQty, imageUrl, distributorId, distributorName) {
  const existing = cart.find(item => item.productId === productId && item.distributorId === distributorId);
  if (existing) {
    existing.quantity += 1;
  } else {
    cart.push({
      productId,
      name,
      price,
      moq,
      stock_quantity: stockQty,
      image_url: imageUrl,
      distributorId,
      distributorName,
      quantity: 1
    });
  }
  saveCart();
  alert("Added to cart!");
}

function removeFromCart(productId, distributorId) {
  cart = cart.filter(item => !(item.productId === productId && item.distributorId === distributorId));
  saveCart();
  renderCart();
}

function updateQuantity(productId, distributorId, newQty) {
  const item = cart.find(i => i.productId === productId && i.distributorId === distributorId);
  if (item) {
    item.quantity = Math.max(1, parseInt(newQty) || 1);
    saveCart();
    renderCart();
  }
}

function updateCartBadge() {
  const totalItems = cart.reduce((sum, item) => sum + item.quantity, 0);
  const badge = document.getElementById("cart-badge");
  if (badge) {
    badge.innerText = totalItems;
    badge.style.display = totalItems > 0 ? "block" : "none";
  }
}

async function renderCart() {
  const content = document.getElementById("cart-content");
  if (!content) return;

  if (cart.length === 0) {
    content.innerHTML = '<div class="loading-text">Your cart is empty. Browse products and add to cart.</div>';
    return;
  }

  // Group by distributor
  const grouped = {};
  for (let item of cart) {
    if (!grouped[item.distributorId]) {
      grouped[item.distributorId] = {
        distributorName: item.distributorName,
        items: [],
        distributorId: item.distributorId
      };
    }
    grouped[item.distributorId].items.push(item);
  }

  // Fetch distributor profiles for min_order_value and delivery_cost
  const distIds = Object.keys(grouped);
  const distProfiles = {};
  if (distIds.length > 0) {
    const { data: dists } = await sb.from("distributor_profiles").select("id, min_order_value, delivery_cost").in("id", distIds);
    if (dists) dists.forEach(d => { distProfiles[d.id] = d; });
  }

  let html = "";
  for (let distId in grouped) {
    const group = grouped[distId];
    const profile = distProfiles[distId] || {};
    const minOrder = profile.min_order_value || 0;
    const deliveryCost = profile.delivery_cost || 0;

    let subtotal = 0;
    group.items.forEach(item => { subtotal += item.price * item.quantity; });

    let alerts = [];
    group.items.forEach(item => {
      if (item.quantity < item.moq) {
        alerts.push(`⚠️ ${item.name}: Minimum order is ${item.moq} units. Add ${item.moq - item.quantity} more.`);
      }
    });

    if (minOrder > 0 && subtotal < minOrder) {
      const short = minOrder - subtotal;
      alerts.push(`💰 You're ₦${short.toLocaleString()} short of this distributor's minimum order (₦${minOrder.toLocaleString()}).`);
    }

    if (deliveryCost > 0) {
      alerts.push(`🚚 Delivery cost: ₦${deliveryCost.toLocaleString()}`);
    }

    html += `
      <div class="manifest" style="padding:12px;">
        <div class="m-name">${group.distributorName}</div>
        <div class="m-loc">${group.items.length} product(s) | Subtotal: ₦${subtotal.toLocaleString()}</div>
        ${alerts.map(a => `<div class="cart-alert">${a}</div>`).join("")}
        ${group.items.map(item => `
          <div class="cart-item">
            <div style="flex:1;">
              <div style="font-weight:600;">${item.name}</div>
              <div style="font-size:11px; color:rgba(18,21,28,0.6);">
                ₦${item.price} x
                <input type="number" value="${item.quantity}" min="1" style="width:50px; padding:2px; margin:0 4px; border:1px solid #ccc; border-radius:4px; text-align:center;" onchange="updateQuantity('${item.productId}','${item.distributorId}',this.value)" />
                = ₦${(item.price * item.quantity).toLocaleString()}
              </div>
            </div>
            <button class="btn-inquire" style="padding:4px 8px; font-size:10px;" onclick="removeFromCart('${item.productId}','${item.distributorId}')">Remove</button>
          </div>
        `).join("")}
        <button class="btn-inquire" style="width:100%; margin-top:8px;" onclick="openModal('${distId}','${group.distributorName}','distributor')">Send Inquiry for this Distributor</button>
      </div>`;
  }

  content.innerHTML = html;
}
