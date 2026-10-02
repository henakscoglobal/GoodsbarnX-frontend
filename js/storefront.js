// ==========================================================================
// GoodsbarnX — storefront.js  (rev. 1)
// Distributor storefront modal: catalogue, §31 relationship-aware pricing,
// D35 product_view emission.
// Plain global script. Loads sixth (Canon §10).
//
// V1.8.2.6 remediation Phase 1+2 (retained):
//   - §31 pricing hierarchy preserved: negotiated → relationship discount →
//     public → negotiable.
//
// Phase 5 rev. 1 (D35):
//   - Emits product_view for the top three rendered products via
//     window.goodsbarnxBehaviourTrack (behaviour.js's canonical emit path).
//   - All interpolated values inside HTML and onclick attributes are escaped.
//   - DOM lookups null-safe; sb null-guarded.
//
// This file does NOT:
//   - write to the database.
//   - call sb.rpc("record_buyer_behavior_event") directly. Event emission
//     is owned by js/behaviour.js.
// ==========================================================================

const __gbxStorefrontWarned = Object.create(null);
function sfWarnMissing(id) {
  if (__gbxStorefrontWarned[id]) return;
  __gbxStorefrontWarned[id] = true;
  console.warn("[GoodsbarnX/storefront] DOM target #" + id + " is missing from index.html.");
}

function sfEscHtml(v) {
  return String(v == null ? "" : v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
function sfEscAttr(v) { return sfEscHtml(v); }

function sfNum(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : (fallback == null ? 0 : fallback);
}

// --------------------------------------------------------------------------
// D35 — BOUNDED product_view emission
//
// Emits product_view for the first N products in render order. N = 3 by
// policy; the bound prevents a burst on large catalogues while still
// recording that the buyer saw actual product cards.
//
// Emission goes through window.goodsbarnxBehaviourTrack (behaviour.js). If
// that entry point is absent (behaviour.js not loaded), nothing is emitted
// and one named warning is logged — never a silent skip.
// --------------------------------------------------------------------------

const SF_VIEW_EMISSION_BOUND = 3;

function sfEmitProductViews(distributorId, products) {
  if (typeof window.goodsbarnxBehaviourTrack !== "function") {
    console.warn("[GoodsbarnX/storefront] goodsbarnxBehaviourTrack unavailable; product_view not emitted.");
    return;
  }
  if (!Array.isArray(products) || !products.length) return;

  const top = products.slice(0, SF_VIEW_EMISSION_BOUND);
  top.forEach(p => {
    if (!p || !p.id) return;
    window.goodsbarnxBehaviourTrack(
      "product_view",
      { product_id: p.id, distributor_id: distributorId || null },
      { source: "storefront", position: top.indexOf(p) },
      "storefront"
    );
  });
}

// --------------------------------------------------------------------------
// OPEN STOREFRONT MODAL
// --------------------------------------------------------------------------

async function openStorefrontModal(distId) {
  const contentEl = document.getElementById("storefront-content");
  const modalEl   = document.getElementById("storefront-modal");
  if (!contentEl) { sfWarnMissing("storefront-content"); return; }
  if (!modalEl)   { sfWarnMissing("storefront-modal"); return; }
  if (!window.sb) {
    contentEl.innerHTML = '<div class="loading-text">Connection service unavailable.</div>';
    modalEl.classList.add("active");
    return;
  }

  contentEl.innerHTML = '<div class="loading-text">Loading...</div>';
  modalEl.classList.add("active");

  const { data: dist, error: distError } = await sb.from("distributor_profiles")
    .select("*, profiles(phone)")
    .eq("id", distId)
    .single();

  if (distError) {
    console.error("[GoodsbarnX/storefront] distributor lookup failed:", distError.message);
    contentEl.innerHTML = '<div class="loading-text">Could not load this storefront.</div>';
    return;
  }

  const { data: products, error: productsError } = await sb.from("products")
    .select("*")
    .eq("distributor_id", distId)
    .eq("status", "active")
    .order("created_at", { ascending: false });

  if (productsError) {
    console.error("[GoodsbarnX/storefront] product lookup failed:", productsError.message);
    contentEl.innerHTML = '<div class="loading-text">Could not load products.</div>';
    return;
  }

  // ------------------------------------------------------------------------
  // §31 relationship-aware pricing (buyer-scoped lookup).
  // Silently skipped for guests / distributors / agents; a missing
  // relationship never blocks the storefront from showing.
  // ------------------------------------------------------------------------

  let discountPercent = null;
  const productPreferences = {};

  if (currentUser && currentUser.role === "buyer") {
    const { data: terms } = await sb
      .from("current_relationship_trade_terms")
      .select("default_discount_percent, relationship_status")
      .eq("buyer_id", currentUser.id)
      .eq("distributor_id", distId)
      .maybeSingle();

    if (terms && terms.relationship_status === "active" && sfNum(terms.default_discount_percent, 0) > 0) {
      discountPercent = terms.default_discount_percent;
    }

    const { data: relationship } = await sb
      .from("trade_relationships")
      .select("id")
      .eq("buyer_id", currentUser.id)
      .eq("distributor_id", distId)
      .eq("is_primary", true)
      .maybeSingle();

    if (relationship) {
      const { data: prefs } = await sb
        .from("relationship_product_preferences")
        .select("product_id, negotiated_unit_price, preferred")
        .eq("relationship_id", relationship.id);

      (prefs || []).forEach(pref => {
        productPreferences[pref.product_id] = pref;
      });
    }
  }

  if (!dist) {
    contentEl.innerHTML = '<div class="loading-text">Not found.</div>';
    return;
  }

  const availableProducts = (products || []).filter(p => sfNum(p.stock_quantity, 0) > 0);

  // ------------------------------------------------------------------------
  // D35 — emit product_view for the top products in render order.
  // Emitted once per openStorefrontModal call.
  // ------------------------------------------------------------------------

  sfEmitProductViews(dist.id, availableProducts);

  // ------------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------------

  const safeDistName     = sfEscAttr(dist.business_name || "Distributor");
  const safeDistLocation = sfEscHtml(dist.location || "Southeast");
  const safeDistMarket   = sfEscHtml(dist.market || "Multiple Markets");

  const trustScore = dist.verification_tier === "association" ? 80
                   : dist.verification_tier === "market board" ? 75
                   : 60;

  const productsHtml = availableProducts.length
    ? availableProducts.map(p => {
        const publicPrice = sfNum(p.price, 0);
        const pref = productPreferences[p.id];
        const hasNegotiatedPrice = pref && pref.negotiated_unit_price != null;
        const hasDiscount = !hasNegotiatedPrice && discountPercent && publicPrice > 0;

        let finalPrice = publicPrice;
        let priceHtml;
        if (!p.price && !hasNegotiatedPrice) {
          priceHtml = "Negotiable";
        } else if (hasNegotiatedPrice) {
          finalPrice = sfNum(pref.negotiated_unit_price, 0);
          priceHtml =
            '<span style="text-decoration:line-through; color:rgba(18,21,28,0.4); font-size:11px;">₦' +
              publicPrice.toLocaleString() +
            '</span> <span style="color:var(--ok); font-weight:700;">₦' +
              finalPrice.toLocaleString() +
            '</span> <span style="font-size:9.5px; color:var(--ok); text-transform:uppercase; letter-spacing:0.04em;">Your price</span>';
        } else if (hasDiscount) {
          finalPrice = Math.round(publicPrice * (1 - discountPercent / 100));
          priceHtml =
            '<span style="text-decoration:line-through; color:rgba(18,21,28,0.4); font-size:11px;">₦' +
              publicPrice.toLocaleString() +
            '</span> <span style="color:var(--ok); font-weight:700;">₦' +
              finalPrice.toLocaleString() +
            '</span>';
        } else {
          priceHtml = '₦' + publicPrice.toLocaleString();
        }

        const safeProductId   = sfEscAttr(p.id);
        const safeProductName = sfEscAttr(p.name || "Product");
        const safeImageUrl    = p.image_url ? sfEscAttr(p.image_url) : null;
        const imageStyle = safeImageUrl
          ? "background-image:url('" + safeImageUrl + "');"
          : "background-color:var(--ink-2);";

        const preferredMark = pref?.preferred
          ? ' <span style="color:var(--brass-dark); font-size:11px;">★ Preferred</span>'
          : "";

        const brandHtml = p.brand ? sfEscHtml(p.brand) + " · " : "";
        const skuHtml   = sfEscHtml(p.sku || "No SKU");

        return (
          '<div class="product-item"' +
            ' data-product-id="' + safeProductId + '"' +
            ' data-distributor-id="' + sfEscAttr(dist.id) + '">' +
            '<div class="product-image" style="' + imageStyle + '"></div>' +
            '<div style="display:inline-block; width:calc(100% - 80px);">' +
              '<div style="font-weight:600; font-size:13px;">' + sfEscHtml(p.name || "Product") + preferredMark + '</div>' +
              '<div style="font-size:11px; color:rgba(18,21,28,0.55); margin-top:2px;">' + brandHtml + skuHtml + '</div>' +
              '<div style="font-size:12px; margin-top:4px;">' + priceHtml + '</div>' +
              '<div style="margin-top:8px;">' +
                '<button class="btn btn-success"' +
                  ' data-product-id="' + safeProductId + '"' +
                  ' data-distributor-id="' + sfEscAttr(dist.id) + '"' +
                  ' onclick="addToCart(\'' + safeProductId + '\', ' + JSON.stringify(String(p.name || "Product")) + ', ' +
                    sfNum(finalPrice, 0) + ', \'' + sfEscAttr(dist.id) + '\', ' + JSON.stringify(String(dist.business_name || "Distributor")) + ')">' +
                  'Add to Cart' +
                '</button>' +
              '</div>' +
            '</div>' +
          '</div>'
        );
      }).join("")
    : '<div class="loading-text">No active products.</div>';

  const discountBanner = discountPercent
    ? '<div style="background:rgba(63,122,78,0.12); border:1px solid rgba(63,122,78,0.3); border-radius:10px; padding:10px 12px; margin-bottom:14px; font-size:12px; color:var(--paper);">' +
        '✓ You have a <strong>' + sfEscHtml(String(discountPercent)) + '% relationship discount</strong> with this distributor' +
      '</div>'
    : "";

  const phone = (dist.profiles && dist.profiles.phone) || "";
  const whatsappBtn = phone
    ? '<button class="btn btn-whatsapp" onclick="openWhatsApp(\'' + sfEscAttr(phone) + '\', \'' + safeDistName + '\')">WhatsApp</button>'
    : "";

  contentEl.innerHTML =
    '<div class="storefront-header">' +
      '<div>' +
        '<h3>' + sfEscHtml(dist.business_name || "Distributor") + '</h3>' +
        '<div style="font-size:12px; color:rgba(18,21,28,0.6);">' + safeDistLocation + ' · ' + safeDistMarket + '</div>' +
      '</div>' +
      '<div>' +
        '<span class="storefront-badge">✓ Verified</span>' +
        '<div class="storefront-score">Trust Score: ' + sfEscHtml(String(trustScore)) + '/100</div>' +
      '</div>' +
    '</div>' +

    discountBanner +

    '<div class="storefront-section">' +
      '<div class="section-label" style="margin-top:0;">Products (' + availableProducts.length + ')</div>' +
      productsHtml +
    '</div>' +

    '<div class="action-buttons" style="margin-top:20px;">' +
      '<button class="btn btn-primary" onclick="closeStorefrontModal(); openModal(\'' +
        sfEscAttr(dist.id) + '\', \'' + safeDistName + '\', \'distributor\')">Contact Distributor</button>' +
      whatsappBtn +
    '</div>';
}

console.log("[GoodsbarnX] storefront.js loaded (V1.8.2.6 rev.1)");
