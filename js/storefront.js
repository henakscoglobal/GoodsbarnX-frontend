// ==========================================================================
// GoodsbarnX — storefront.js
// Loading and rendering a distributor's storefront (products catalog) modal.
// Plain global script — depends on js/config.js (for `sb`) being loaded first.
// The "Add to Cart" and "Contact Distributor" buttons rendered here call
// addToCart() (js/cart.js) and openModal()/closeStorefrontModal() (js/ui.js).
//
// Relationship-aware pricing: if the logged-in buyer has an active trade
// relationship with this distributor carrying a default_discount_percent,
// show both public price and their relationship price. This reads from
// current_relationship_trade_terms — never computed locally beyond simple
// arithmetic on a value the database already gives us.
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

  // Relationship-aware pricing lookup — buyers only, silently skipped for
  // guests/distributors/agents, and silently ignored on any error so a
  // missing relationship never blocks the storefront from showing.
  let discountPercent = null;
  if (currentUser && currentUser.role === "buyer") {
    const { data: terms } = await sb
      .from("current_relationship_trade_terms")
      .select("default_discount_percent, relationship_status")
      .eq("buyer_id", currentUser.id)
      .eq("distributor_id", distId)
      .maybeSingle();

    if (terms && terms.relationship_status === "active" && terms.default_discount_percent > 0) {
      discountPercent = terms.default_discount_percent;
    }
  }

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

    ${discountPercent ? `<div style="background:rgba(63,122,78,0.12); border:1px solid rgba(63,122,78,0.3); border-radius:10px; padding:10px 12px; margin-bottom:14px; font-size:12px; color:var(--paper);">✓ You have a <strong>${discountPercent}% relationship discount</strong> with this distributor</div>` : ""}

    <div class="storefront-section">
      <div class="section-label" style="margin-top:0;">Products (${availableProducts.length})</div>
      ${availableProducts.length ? availableProducts.map(p => {
        const publicPrice = p.price || 0;
        const hasDiscount = discountPercent && publicPrice > 0;
        const yourPrice = hasDiscount ? Math.round(publicPrice * (1 - discountPercent / 100)) : publicPrice;

        const priceHtml = !p.price
          ? "Negotiable"
          : hasDiscount
            ? `<span style="text-decoration:line-through; color:rgba(18,21,28,0.4); font-size:11px;">₦${publicPrice.toLocaleString()}</span> <span style="color:var(--ok); font-weight:700;">₦${yourPrice.toLocaleString()}</span>`
            : `₦${publicPrice.toLocaleString()}`;

        return `
        <div class="product-item">
          <div class="product-image" style="${p.image_url ? `background-image:url('${p.image_url}')` : 'background-color:var(--ink-2);'}"></div>
          <div style="display:inline-block; width:calc(100% - 80px);">
            <div style="font-weight:600; font-size:13px;">${p.name}</div>
            <div style="font-size:11px; color:rgba(18,21,28,0.55); margin-top:2px;">${p.brand ? p.brand + " · " : ""}${p.sku || "No SKU"}</div>
            <div style="font-size:12px; margin-top:4px;">${priceHtml}</div>
            <div style="margin-top:8px;">
              <button class="btn btn-success" onclick="addToCart('${p.id}', '${p.name}', ${hasDiscount ? yourPrice : publicPrice}, '${p.distributor_id}', '${dist.business_name}')">Add to Cart</button>
            </div>
          </div>
        </div>
      `;
      }).join("") : '<div class="loading-text">No active products.</div>'}
    </div>

    <div class="action-buttons" style="margin-top:20px;">
      <button class="btn btn-primary" onclick="closeStorefrontModal(); openModal('${dist.id}', '${dist.business_name}', 'distributor')">Contact Distributor</button>
      ${dist.profiles?.phone ? `<button class="btn btn-whatsapp" onclick="openWhatsApp('${dist.profiles.phone}', '${dist.business_name}')">WhatsApp</button>` : ""}
    </div>
  `;
}
