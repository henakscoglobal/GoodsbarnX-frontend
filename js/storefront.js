// ==========================================================================
// GoodsbarnX — storefront.js
// Loading and rendering a distributor's storefront (products catalog) modal.
// Plain global script — depends on js/config.js (for `sb`) being loaded first.
// The "Add to Cart" and "Contact Distributor" buttons rendered here call
// addToCart() (js/cart.js) and openModal()/closeStorefrontModal() (js/ui.js).
// ==========================================================================

async function openStorefrontModal(distId) {
  document.getElementById("storefront-content").innerHTML = '<div class="loading-text">Loading...</div>';
  document.getElementById("storefront-modal").classList.add("active");

  const { data: dist } = await sb.from("distributor_profiles")
    .select("*, profiles(phone)")
    .eq("id", distId)
    .single();

  const { data: products } = await sb.from("products")
    .select("*")
    .eq("distributor_id", distId)
    .eq("status", "active")
    .order("created_at", { ascending: false });

  if (!dist) {
    document.getElementById("storefront-content").innerHTML = '<div class="loading-text">Not found.</div>';
    return;
  }

  const availableProducts = products?.filter(p => p.stock_quantity > 0) || [];

  document.getElementById("storefront-content").innerHTML = `
    <div class="storefront-header">
      <div>
        <h3>${dist.business_name}</h3>
        <div style="font-size:12px; color:rgba(18,21,28,0.6);">${dist.location || "Southeast"} · ${dist.market || "Multiple Markets"}</div>
      </div>
      <div>
        <span class="storefront-badge">✓ Verified</span>
        <div class="storefront-score">Trust Score: ${dist.verification_tier === "association" ? 80 : dist.verification_tier === "market board" ? 75 : 60}/100</div>
      </div>
    </div>

    <div class="storefront-section">
      <div class="section-label" style="margin-top:0;">Products (${availableProducts.length})</div>
      ${availableProducts.length ? availableProducts.map(p => `
        <div class="product-item">
          <div class="product-image" style="${p.image_url ? `background-image:url('${p.image_url}')` : 'background-color:var(--ink-2);'}"></div>
          <div style="display:inline-block; width:calc(100% - 80px);">
            <div style="font-weight:600; font-size:13px;">${p.name}</div>
            <div style="font-size:11px; color:rgba(18,21,28,0.55); margin-top:2px;">${p.brand ? p.brand + " · " : ""}${p.sku || "No SKU"}</div>
            <div style="font-size:12px; margin-top:4px;">${p.price ? "₦" + p.price : "Negotiable"}</div>
            <div style="margin-top:8px;">
              <button class="btn btn-success" onclick="addToCart('${p.id}', '${p.name}', ${p.price || 0}, '${p.distributor_id}', '${dist.business_name}')">Add to Cart</button>
            </div>
          </div>
        </div>
      `).join("") : '<div class="loading-text">No active products.</div>'}
    </div>

    <div class="action-buttons" style="margin-top:20px;">
      <button class="btn btn-primary" onclick="closeStorefrontModal(); openModal('${dist.id}', '${dist.business_name}', 'distributor')">Contact Distributor</button>
      ${dist.profiles?.phone ? `<button class="btn btn-whatsapp" onclick="openWhatsApp('${dist.profiles.phone}', '${dist.business_name}')">WhatsApp</button>` : ""}
    </div>
  `;
}
