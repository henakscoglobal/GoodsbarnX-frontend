// ==========================================================================
// GoodsbarnX — products.js
// Distributor-only product management: listing owned products, adding new ones.
// Plain global script — depends on js/config.js (for `sb`) being loaded first.
// Depends on global `currentUser` (js/auth.js) and closeAddProductModal() (js/ui.js).
// ==========================================================================

async function loadProductsManagement() {
  if (!currentUser || currentUser.role !== "distributor") {
    document.getElementById("products-management-list").innerHTML = '<div class="loading-text">Only distributors can manage products.</div>';
    return;
  }

  const { data: products } = await sb.from("products").select("*").eq("distributor_id", currentUser.id).order("created_at", { ascending: false });
  const container = document.getElementById("products-management-list");

  if (!products || products.length === 0) {
    container.innerHTML = '<div class="loading-text">No products yet. Add your first product!</div>';
    return;
  }

  container.innerHTML = products.map(p => `
    <div class="manifest">
      <div class="manifest-top">
        <div>
          <div class="m-name">${p.name}</div>
          <div class="m-loc">${p.brand || "No brand"} · SKU: ${p.sku || "N/A"}</div>
          <div style="font-size:12px; margin-top:4px;">${p.price ? "₦" + p.price : "Negotiable"} · Stock: ${p.stock_quantity}</div>
        </div>
        <span class="stamp-badge" style="border-color:${p.status === "active" ? "var(--ok)" : "var(--stamp)"}; color:${p.status === "active" ? "var(--ok)" : "var(--stamp)"};">${p.status.toUpperCase()}</span>
      </div>
    </div>
  `).join("");
}

async function addProduct() {
  const name = document.getElementById("prod-name").value;
  const category = document.getElementById("prod-category").value;

  if (!name || !category) {
    document.getElementById("add-product-status").innerText = "Name and category required.";
    return;
  }

  const product = {
    distributor_id: currentUser.id,
    name,
    category,
    sku: document.getElementById("prod-sku").value,
    brand: document.getElementById("prod-brand").value,
    moq: parseInt(document.getElementById("prod-moq").value) || 1,
    stock_quantity: parseInt(document.getElementById("prod-stock").value) || 0,
    price: parseFloat(document.getElementById("prod-price").value) || 0,
    negotiable: document.getElementById("prod-negotiable").value === "true",
    bulk_discount: document.getElementById("prod-bulk-discount").value === "true",
    lead_time: document.getElementById("prod-lead-time").value,
    trade_terms: document.getElementById("prod-trade-terms").value,
    delivery_available: document.getElementById("prod-delivery").value === "true",
    pickup_available: document.getElementById("prod-pickup").value === "true",
    description: document.getElementById("prod-desc").value,
    status: "active"
  };

  const { error } = await sb.from("products").insert(product);

  if (error) {
    document.getElementById("add-product-status").innerText = "Error: " + error.message;
  } else {
    document.getElementById("add-product-status").innerText = "Product added!";
    setTimeout(() => {
      closeAddProductModal();
      loadProductsManagement();
    }, 1500);
  }
}
