// ==========================================================================
// GoodsbarnX — storefront.js  (rev. 6 · architecture Phase 1 + interaction + media)
// Plain global script. Loads sixth (Canon §10).
//
// rev.6 changes:
//   - Patched `sfRenderFeaturedCard` and `sfRenderCatalogueRow` to pass the
//     7th argument (opts) to `addToCart`. This carries `price_basis` and `moq`,
//     allowing the F-19 server-authoritative order system to correctly
//     validate discounted/negotiated prices.
//
// rev.5 changes (retained):
//   - Scroll FABs on storefront body when it overflows.
//   - Image viewer: full-screen, pinch-zoom, swipe between images.
//   - Reads product.image_urls (array) if present, else product.image_url.
//   - Featured / detail images use object-contain (no crop); catalogue thumb
//     is bigger (56px) and still crops.
//
// rev.4 changes (retained):
//   - Delegated click handler via data-sf-action (iOS momentum-scroll fix).
//   - Topbar with close × and handle, always visible.
//   - Tappable product cards, quantity stepper.
//   - Merchant header → Trust screen; transparency line → Depletor.
//
// rev.3 changes (retained):
//   - 5-slot shell (header / hero / transparency / curation / commitment).
//   - Engine context projection, 3 guardrails.
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

// ----- D35 product_view emission -----
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

// ==========================================================================
// L4 · ENGINE INTERFACE (projection)
// ==========================================================================
function getStorefrontEngineContext(distributorId) {
  const snapshot = window.goodsbarnxLastReplenishmentSnapshot || null;
  if (!snapshot || !Array.isArray(snapshot.rows)) {
    return { source: "unavailable", stockState: "unknown", worstUrgency: null, updatedAt: null, freshnessMs: null, distributorId };
  }
  const distRows = snapshot.rows.filter(r => r.distributor_id === distributorId);
  const updatedAt = snapshot.generatedAt || null;
  const freshnessMs = updatedAt ? (Date.now() - new Date(updatedAt).getTime()) : null;
  let source = "engine";
  if (freshnessMs == null || freshnessMs > 30 * 60 * 1000) source = "unavailable";
  else if (freshnessMs > 5 * 60 * 1000) source = "stale";

  if (!distRows.length) {
    return { source, stockState: "healthy", worstUrgency: "LOW", updatedAt, freshnessMs, distributorId };
  }
  const rank = { HIGH: 3, MODERATE: 2, LOW: 1, UNKNOWN: 0 };
  let worst = "LOW";
  for (const r of distRows) {
    const u = r.urgency || "UNKNOWN";
    if ((rank[u] || 0) > (rank[worst] || 0)) worst = u;
  }
  let stockState = "healthy";
  if (worst === "HIGH") stockState = "depleting";
  else if (worst === "UNKNOWN") stockState = "unknown";
  return { source, stockState, worstUrgency: worst, updatedAt, freshnessMs, distributorId };
}

// ==========================================================================
// L2 · GUARDRAILS
// ==========================================================================
function guardNoDarkPatterns(renderPlan) {
  const reasons = [];
  const html = String(renderPlan?.html || "");
  if (/<[^>]*data-countdown/i.test(html)) reasons.push("countdown_present");
  if (/only\s+\d+\s+left/i.test(html))     reasons.push("scarcity_marker_present");
  if (/expires\s+in/i.test(html))          reasons.push("expiry_claim_present");
  if (/<dialog/i.test(html))               reasons.push("modal_trap_present");
  return { ok: reasons.length === 0, reasons };
}
function guardUrgencyIsEngineBound(renderPlan, engineCtx) {
  const reasons = [];
  const html = String(renderPlan?.html || "");
  const claimsUrgency = /data-urgency|urgency-claim|scarcity|low[-\s]stock|almost\s+out/i.test(html);
  if (claimsUrgency && engineCtx.source === "unavailable") reasons.push("urgency_claim_without_engine_truth");
  return { ok: reasons.length === 0, reasons };
}
function guardPersonalizationVisible(price) {
  if (!price || !price.advantage) return { ok: true, reasons: [] };
  const reasons = [];
  if (!price.advantageLabel) reasons.push("advantage_without_label");
  return { ok: reasons.length === 0, reasons };
}

// ==========================================================================
// PRESENTATION HELPERS
// ==========================================================================
function sfTierLabel(tier) {
  if (tier === "association") return "Association Verified";
  if (tier === "market board") return "Market Board Verified";
  if (tier === "self-attested") return "Self-Attested";
  return "Unverified";
}
function sfFormatFreshness(freshnessMs) {
  if (freshnessMs == null) return "";
  const mins = Math.floor(freshnessMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return mins + "m ago";
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + "h ago";
  return Math.floor(hrs / 24) + "d ago";
}
function sfComputePrice(product, pref, discountPercent) {
  const publicPrice = sfNum(product.price, 0);
  const hasNegotiated = pref && pref.negotiated_unit_price != null;
  const hasDiscount   = !hasNegotiated && discountPercent && publicPrice > 0;
  let finalPrice = publicPrice;
  let advantage = "";
  let advantageLabel = "";
  let original = null;

  if (!product.price && !hasNegotiated) {
    return { finalPrice: null, original: null, advantage: "", advantageLabel: "", isNegotiable: true };
  }
  if (hasNegotiated) {
    finalPrice = sfNum(pref.negotiated_unit_price, 0);
    original = publicPrice > 0 ? publicPrice : null;
    advantage = "Your price";
    advantageLabel = "your_negotiated_price";
  } else if (hasDiscount) {
    finalPrice = Math.round(publicPrice * (1 - discountPercent / 100));
    original = publicPrice;
    advantage = "You save " + Math.round(discountPercent) + "%";
    advantageLabel = "relationship_discount_" + Math.round(discountPercent);
  }
  return { finalPrice, original, advantage, advantageLabel, isNegotiable: false };
}
function sfPriceBlockHtml(price, classes) {
  if (price.isNegotiable) {
    return '<div class="' + classes.value + '">Negotiable</div>';
  }
  const originalHtml = price.original != null
    ? '<div class="' + classes.original + '">₦' + price.original.toLocaleString() + '</div>'
    : "";
  const advantageHtml = price.advantage
    ? '<div class="' + classes.advantage + '" data-advantage-label="' + sfEscAttr(price.advantageLabel || "") + '">' +
      sfEscHtml(price.advantage) + '</div>'
    : "";
  return (
    '<div class="' + classes.value + '">₦' + sfNum(price.finalPrice, 0).toLocaleString() + '</div>' +
    originalHtml + advantageHtml
  );
}

// ==========================================================================
// INTERACTION STATE
// ==========================================================================
let __sfQtyByProductId = Object.create(null);
let __sfCurrentStorefront = null;

// ==========================================================================
// L3 · SLOT RENDERERS
// ==========================================================================
function renderTopbar() {
  return (
    '<div class="sf-topbar" data-slot="shell.topbar">' +
      '<button type="button" class="sf-topbar-close" data-sf-action="close-storefront" aria-label="Close storefront">×</button>' +
      '<div class="sf-topbar-handle" aria-hidden="true"></div>' +
      '<div></div>' +
    '</div>'
  );
}
function renderHeaderRelationship(ctx) {
  const { dist } = ctx;
  const hasPhone = !!(dist.profiles && dist.profiles.phone);
  const evidenceBits = [];
  const tierLabel = sfTierLabel(dist.verification_tier);
  if (tierLabel && tierLabel !== "Unverified") evidenceBits.push(tierLabel);
  if (ctx.productCount > 0) {
    evidenceBits.push(ctx.productCount + (ctx.productCount === 1 ? " product" : " products") + " in stock");
  }
  if (hasPhone) evidenceBits.push("Contact available");

  return (
    '<div class="sf-merchant" data-slot="header.relationship" ' +
      'data-sf-action="open-trust" data-sf-distributor-id="' + sfEscAttr(dist.id) + '" ' +
      'role="button" tabindex="0" aria-label="View trust details">' +
      '<div class="sf-merchant-row">' +
        '<div style="min-width:0;">' +
          '<h2 class="sf-merchant-name">' + sfEscHtml(dist.business_name || "Distributor") + '</h2>' +
          '<div class="sf-merchant-sub">' +
            sfEscHtml(dist.location || "Southeast") +
            (dist.market ? ' · ' + sfEscHtml(dist.market) : "") +
          '</div>' +
        '</div>' +
        '<span class="sf-merchant-verified">Verified</span>' +
      '</div>' +
      (evidenceBits.length
        ? '<div class="sf-merchant-evidence">' + evidenceBits.map(sfEscHtml).join(" · ") + '</div>'
        : "") +
      '<div class="sf-merchant-chevron" aria-hidden="true">›</div>' +
    '</div>'
  );
}
function renderHeroPrimary(ctx) {
  const { engineCtx, stripCopy } = ctx;
  let stripHtml = "";
  if (stripCopy) {
    stripHtml =
      '<div class="sf-relationship-strip" data-variant="advantage" data-slot="hero.primary">' +
        '<div class="sf-relationship-strip-copy">' + stripCopy + '</div>' +
      '</div>';
  } else if (engineCtx.source === "unavailable") {
    stripHtml =
      '<div class="sf-relationship-strip" data-variant="engine_unavailable" data-slot="hero.primary">' +
        '<div class="sf-relationship-strip-copy">Stock signal unavailable · last catalogue state shown</div>' +
      '</div>';
  } else if (engineCtx.stockState === "depleting") {
    stripHtml =
      '<div class="sf-relationship-strip" data-variant="depleting" data-urgency="depleting" data-slot="hero.primary">' +
        '<div class="sf-relationship-strip-copy">Restock recommended · ' +
          (engineCtx.updatedAt ? 'stock signal updated ' + sfFormatFreshness(engineCtx.freshnessMs) : 'engine active') +
        '</div>' +
      '</div>';
  }
  return stripHtml;
}
function renderEngineTransparency(ctx) {
  const { engineCtx } = ctx;
  const src = engineCtx.source;
  let label, tone;
  if (src === "engine") {
    label = "Stock signal live" + (engineCtx.updatedAt ? " · updated " + sfFormatFreshness(engineCtx.freshnessMs) : "");
    tone = "live";
  } else if (src === "stale") {
    label = "Stock signal " + sfFormatFreshness(engineCtx.freshnessMs) + " · may have changed";
    tone = "stale";
  } else {
    label = "Stock signal unavailable · showing catalogue only";
    tone = "unavailable";
  }
  return (
    '<div class="sf-engine-transparency" data-slot="engine.transparency" ' +
      'data-tone="' + tone + '" data-sf-action="open-depletor" role="button" tabindex="0">' +
      label +
      '<span class="sf-engine-transparency-arrow" aria-hidden="true">›</span>' +
    '</div>'
  );
}
function renderCurationMain(ctx) {
  const { priced, dist, tempo } = ctx;
  if (!priced.length) return sfRenderEmptyState(dist);
  const featuredCount = tempo === "slow" ? 3 : tempo === "regulated" ? 1 : 2;
  const featured = priced.slice(0, featuredCount);
  const rest     = priced.slice(featuredCount);

  const featuredHtml = featured.length
    ? '<div class="sf-featured" data-slot="curation.main">' +
        '<div class="sf-featured-kicker">Featured</div>' +
        featured.map(x => sfRenderFeaturedCard(x.p, dist, x.price)).join("") +
      '</div>'
    : "";

  const catalogueHtml = rest.length
    ? '<div class="sf-catalogue">' +
        '<div class="sf-catalogue-kicker">' +
          '<span>Catalogue</span>' +
          '<span class="sf-catalogue-count">' + rest.length + ' more</span>' +
        '</div>' +
        rest.map(x => sfRenderCatalogueRow(x.p, dist, x.price)).join("") +
      '</div>'
    : "";

  return featuredHtml + catalogueHtml;
}
function renderCommitmentPath(ctx) {
  const { dist, availableProducts } = ctx;
  if (!availableProducts.length) return "";
  const phone = (dist.profiles && dist.profiles.phone) || "";

  return (
    '<div class="sf-action-bar" data-slot="commitment.path">' +
      '<button type="button" class="sf-btn sf-btn-primary" ' +
        'data-sf-action="contact" ' +
        'data-sf-distributor-id="' + sfEscAttr(dist.id) + '" ' +
        'data-sf-distributor-name="' + sfEscAttr(dist.business_name || "Distributor") + '">' +
        'Contact distributor' +
      '</button>' +
      (phone
        ? '<button type="button" class="sf-btn sf-btn-whatsapp" ' +
            'data-sf-action="whatsapp" ' +
            'data-sf-phone="' + sfEscAttr(phone) + '" ' +
            'data-sf-distributor-name="' + sfEscAttr(dist.business_name || "Distributor") + '">' +
            'WhatsApp' +
          '</button>'
        : "") +
    '</div>'
  );
}
function sfRenderFeaturedCard(p, dist, price) {
  const qty = __sfQtyByProductId[p.id] || 1;
  const step = p.moq || 1;
  const safeId   = sfEscAttr(p.id);
  const safeName = sfEscAttr(p.name || "Product");
  const safeDistId   = sfEscAttr(dist.id);
  const safeDistName = sfEscAttr(dist.business_name || "Distributor");
  const imageStyle = p.image_url ? "background-image:url('" + sfEscAttr(p.image_url) + "');" : "";
  const brand = p.brand ? sfEscHtml(p.brand) + " · " : "";
  const sku   = sfEscHtml(p.sku || "No SKU");
  const preferredMark = (p.__preferred || price.advantage === "Your price")
    ? ' · <span style="color:var(--gbx-gold);font-weight:700;">★</span>'
    : "";

  // F-19 Patch: Include the 7th argument (opts) for price_basis and moq.
  const onClick =
    "addToCart('" + safeId + "', " +
    JSON.stringify(String(p.name || "Product")) + ", " +
    sfNum(price.finalPrice || 0, 0) + ", '" +
    safeDistId + "', " +
    JSON.stringify(String(dist.business_name || "Distributor")) + ", " +
    qty + ", " +
    JSON.stringify({
      moq: step,
      price_basis: price.advantageLabel || "public",
      sku: p.sku || null
    }) +
    ")";

  return (
    '<div class="sf-featured-card" data-sf-action="open-product-detail" ' +
        'data-sf-product-id="' + safeId + '" ' +
        'data-sf-distributor-id="' + safeDistId + '" ' +
        'data-sf-distributor-name="' + safeDistName + '">' +
      '<div class="sf-featured-image" style="' + imageStyle + '" ' +
        'data-sf-action="open-viewer" data-sf-product-id="' + safeId + '" data-sf-image-index="0" ' +
        'role="button" aria-label="View image"></div>' +
      '<div class="sf-featured-copy">' +
        '<div class="sf-featured-name">' + sfEscHtml(p.name || "Product") + preferredMark + '</div>' +
        '<div class="sf-featured-meta">' + brand + sku + '</div>' +
      '</div>' +
      '<div class="sf-featured-price">' +
        sfPriceBlockHtml(price, {
          value:     "sf-featured-price-value",
          original:  "sf-featured-price-original",
          advantage: "sf-featured-advantage"
        }) +
      '</div>' +
      '<div class="sf-qty-row">' +
        '<button type="button" class="sf-qty-btn" data-sf-action="qty-dec" data-sf-product-id="' + safeId + '" aria-label="Decrease quantity">−</button>' +
        '<span class="sf-qty-value" data-sf-qty-for="' + safeId + '">' + qty + '</span>' +
        '<button type="button" class="sf-qty-btn" data-sf-action="qty-inc" data-sf-product-id="' + safeId + '" data-sf-step="' + step + '" aria-label="Increase quantity">+</button>' +
        '<button type="button" class="sf-featured-add" onclick="' + onClick + '">' +
          'Add · ₦' + sfNum((price.finalPrice || 0) * qty, 0).toLocaleString() +
        '</button>' +
      '</div>' +
    '</div>'
  );
}
function sfRenderCatalogueRow(p, dist, price) {
  const qty = __sfQtyByProductId[p.id] || 1;
  const step = p.moq || 1;
  const safeId   = sfEscAttr(p.id);
  const safeDistId   = sfEscAttr(dist.id);
  const safeDistName = sfEscAttr(dist.business_name || "Distributor");
  const brand = p.brand ? sfEscHtml(p.brand) + " · " : "";
  const sku   = sfEscHtml(p.sku || "No SKU");
  const imageStyle = p.image_url ? "background-image:url('" + sfEscAttr(p.image_url) + "');" : "";

  // F-19 Patch: Include the 7th argument (opts) for price_basis and moq.
  const onClick =
    "addToCart('" + safeId + "', " +
    JSON.stringify(String(p.name || "Product")) + ", " +
    sfNum(price.finalPrice || 0, 0) + ", '" +
    safeDistId + "', " +
    JSON.stringify(String(dist.business_name || "Distributor")) + ", " +
    "1, " + // Default qty for compact row
    JSON.stringify({
      moq: step,
      price_basis: price.advantageLabel || "public",
      sku: p.sku || null
    }) +
    ")";

  return (
    '<div class="sf-catalogue-row" data-sf-action="open-product-detail" ' +
        'data-sf-product-id="' + safeId + '" ' +
        'data-sf-distributor-id="' + safeDistId + '" ' +
        'data-sf-distributor-name="' + safeDistName + '">' +
      '<div class="sf-catalogue-thumb" style="' + imageStyle + '" ' +
        'data-sf-action="open-viewer" data-sf-product-id="' + safeId + '" data-sf-image-index="0" ' +
        'role="button" aria-label="View image"></div>' +
      '<div class="sf-catalogue-copy">' +
        '<div class="sf-catalogue-name">' + sfEscHtml(p.name || "Product") + '</div>' +
        '<div class="sf-catalogue-meta">' + brand + sku + '</div>' +
      '</div>' +
      '<div class="sf-catalogue-right">' +
        sfPriceBlockHtml(price, {
          value:     "sf-catalogue-price",
          original:  "sf-catalogue-price-original",
          advantage: "sf-catalogue-advantage"
        }) +
        '<button type="button" class="sf-catalogue-add" onclick="' + onClick + '">Add</button>' +
      '</div>' +
    '</div>'
  );
}
function sfRenderEmptyState(dist) {
  return (
    '<div class="sf-empty" data-slot="curation.main">' +
      '<div class="sf-empty-icon">▢</div>' +
      '<div class="sf-empty-title">No products in stock</div>' +
      '<div class="sf-empty-sub">This distributor has no active products right now. ' +
        'You can still contact them to ask about upcoming stock.</div>' +
      '<button type="button" class="sf-btn sf-btn-primary" style="margin-top:16px;" ' +
        'data-sf-action="contact" ' +
        'data-sf-distributor-id="' + sfEscAttr(dist.id) + '" ' +
        'data-sf-distributor-name="' + sfEscAttr(dist.business_name || "Distributor") + '">' +
        'Contact distributor</button>' +
    '</div>'
  );
}

// ==========================================================================
// PRODUCT DETAIL SUB-SHEET
// ==========================================================================
function sfOpenProductDetail(productId, distributorId, distributorName) {
  const cur = __sfCurrentStorefront;
  if (!cur) return;
  const entry = cur.priced.find(x => x.p.id === productId);
  if (!entry) { console.warn("[GoodsbarnX/storefront] product not in current storefront:", productId); return; }

  const { p, price } = entry;
  const qty = __sfQtyByProductId[p.id] || 1;
  const step = p.moq || 1;
  const safeId   = sfEscAttr(p.id);
  const safeDistId   = sfEscAttr(distributorId);
  const safeDistName = sfEscAttr(distributorName || "Distributor");
  const safeProductName = sfEscAttr(p.name || "Product");
  const imageStyle = p.image_url ? "background-image:url('" + sfEscAttr(p.image_url) + "');" : "";

  const rows = [
    ["SKU", p.sku || "—"],
    ["Brand", p.brand || "—"],
    ["Category", p.category || "—"],
    ["MOQ", p.moq != null ? String(p.moq) : "1"],
    ["In stock", p.stock_quantity != null ? String(p.stock_quantity) : "—"],
    ["Lead time", p.lead_time || "—"]
  ];

  // F-19 Patch for the detail sheet button
  const onClick =
    "addToCart('" + safeId + "', " +
    JSON.stringify(String(p.name || "Product")) + ", " +
    sfNum(price.finalPrice || 0, 0) + ", '" +
    safeDistId + "', " +
    JSON.stringify(String(distributorName || "Distributor")) + ", " +
    qty + ", " +
    JSON.stringify({
      moq: step,
      price_basis: price.advantageLabel || "public",
      sku: p.sku || null
    }) +
    ")";

  const detailHtml =
    '<div class="sf-detail" role="dialog" aria-modal="true" aria-label="Product detail">' +
      '<div class="sf-detail-backdrop" data-sf-action="close-product-detail"></div>' +
      '<div class="sf-detail-sheet">' +
        '<div class="sf-detail-topbar">' +
          '<button type="button" class="sf-detail-close" data-sf-action="close-product-detail" aria-label="Close">×</button>' +
        '</div>' +
        '<div class="sf-detail-image" style="' + imageStyle + '" ' +
          'data-sf-action="open-viewer" data-sf-product-id="' + safeId + '" data-sf-image-index="0" ' +
          'role="button" aria-label="View image"></div>' +
        '<div class="sf-detail-body">' +
          '<div class="sf-detail-name">' + sfEscHtml(p.name || "Product") + '</div>' +
          '<div class="sf-detail-price">' +
            sfPriceBlockHtml(price, {
              value:     "sf-detail-price-value",
              original:  "sf-detail-price-original",
              advantage: "sf-detail-advantage"
            }) +
          '</div>' +
          '<div class="sf-detail-rows">' +
            rows.map(([k, v]) =>
              '<div class="sf-detail-row"><span>' + sfEscHtml(k) + '</span><strong>' + sfEscHtml(v) + '</strong></div>'
            ).join("") +
          '</div>' +
          '<div class="sf-qty-row sf-qty-row-detail">' +
            '<button type="button" class="sf-qty-btn" data-sf-action="qty-dec" data-sf-product-id="' + safeId + '" aria-label="Decrease quantity">−</button>' +
            '<span class="sf-qty-value" data-sf-qty-for="' + safeId + '">' + qty + '</span>' +
            '<button type="button" class="sf-qty-btn" data-sf-action="qty-inc" data-sf-product-id="' + safeId + '" data-sf-step="' + step + '" aria-label="Increase quantity">+</button>' +
          '</div>' +
          '<button type="button" class="sf-detail-add" onclick="' + onClick + '">' +
            'Add to cart · ₦' + sfNum((price.finalPrice || 0) * qty, 0).toLocaleString() +
          '</button>' +
          '<button type="button" class="sf-detail-contact" ' +
            'data-sf-action="contact" ' +
            'data-sf-distributor-id="' + safeDistId + '" ' +
            'data-sf-distributor-name="' + safeDistName + '">' +
            'Ask about bulk pricing' +
          '</button>' +
        '</div>' +
      '</div>' +
    '</div>';

  const host = document.getElementById("storefront-content");
  if (!host) return;
  const old = host.querySelector(".sf-detail");
  if (old) old.remove();
  host.insertAdjacentHTML("beforeend", detailHtml);
}
function sfCloseProductDetail() {
  const host = document.getElementById("storefront-content");
  if (!host) return;
  const d = host.querySelector(".sf-detail");
  if (d) d.remove();
}

// ==========================================================================
// IMAGE VIEWER
// ==========================================================================
function sfOpenImageViewer(product, startIndex) {
  const urls = Array.isArray(product.image_urls) && product.image_urls.length
    ? product.image_urls.filter(Boolean)
    : (product.image_url ? [product.image_url] : []);
  if (!urls.length) return;

  const idx = Math.max(0, Math.min(startIndex || 0, urls.length - 1));
  const host = document.getElementById("storefront-content");
  if (!host) return;
  const old = host.querySelector(".sf-viewer");
  if (old) old.remove();

  const dots = urls.length > 1
    ? '<div class="sf-viewer-dots">' +
        urls.map((_, i) =>
          '<span class="sf-viewer-dot' + (i === idx ? ' active' : '') + '" data-sf-index="' + i + '"></span>'
        ).join("") +
      '</div>'
    : "";

  const html =
    '<div class="sf-viewer" role="dialog" aria-modal="true" aria-label="Product image">' +
      '<div class="sf-viewer-backdrop" data-sf-action="close-viewer"></div>' +
      '<button type="button" class="sf-viewer-close" data-sf-action="close-viewer" aria-label="Close">×</button>' +
      '<div class="sf-viewer-track" data-sf-track>' +
        urls.map((url, i) =>
          '<div class="sf-viewer-slide" data-sf-slide="' + i + '">' +
            '<div class="sf-viewer-img" style="background-image:url(\'' + sfEscAttr(url) + '\');"></div>' +
          '</div>'
        ).join("") +
      '</div>' +
      dots +
    '</div>';

  host.insertAdjacentHTML("beforeend", html);
  sfWireViewer(host, urls.length, idx);
}
function sfWireViewer(host, count, startIndex) {
  const viewer = host.querySelector(".sf-viewer");
  const track  = viewer.querySelector("[data-sf-track]");
  if (!viewer || !track) return;

  let index = startIndex;
  const setIndex = (i) => {
    index = Math.max(0, Math.min(i, count - 1));
    track.style.transform = "translateX(" + (-index * 100) + "%)";
    viewer.querySelectorAll(".sf-viewer-dot").forEach((d, k) => {
      d.classList.toggle("active", k === index);
    });
  };
  setIndex(startIndex);

  let startX = 0, startY = 0, dragging = false;
  track.addEventListener("touchstart", (e) => {
    if (!e.touches[0]) return;
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    dragging = true;
  }, { passive: true });
  track.addEventListener("touchend", (e) => {
    if (!dragging) return;
    dragging = false;
    const t = e.changedTouches[0];
    if (!t) return;
    const dx = t.clientX - startX;
    const dy = t.clientY - startY;
    if (Math.abs(dx) < 40) return;
    if (Math.abs(dx) < Math.abs(dy)) return;
    if (dx < 0 && index < count - 1) setIndex(index + 1);
    else if (dx > 0 && index > 0) setIndex(index - 1);
  }, { passive: true });

  let mDown = false, mStartX = 0, mStartY = 0;
  track.addEventListener("mousedown", (e) => { mDown = true; mStartX = e.clientX; mStartY = e.clientY; });
  track.addEventListener("mouseup", (e) => {
    if (!mDown) return;
    mDown = false;
    const dx = e.clientX - mStartX;
    const dy = e.clientY - mStartY;
    if (Math.abs(dx) < 60) return;
    if (Math.abs(dx) < Math.abs(dy)) return;
    if (dx < 0 && index < count - 1) setIndex(index + 1);
    else if (dx > 0 && index > 0) setIndex(index - 1);
  });

  viewer.querySelectorAll(".sf-viewer-dot").forEach((dot) => {
    dot.addEventListener("click", (e) => {
      e.stopPropagation();
      setIndex(parseInt(dot.dataset.sfIndex, 10) || 0);
    });
  });

  const onKey = (e) => {
    if (e.key === "Escape") { sfCloseViewer(); }
    else if (e.key === "ArrowRight" && index < count - 1) setIndex(index + 1);
    else if (e.key === "ArrowLeft" && index > 0) setIndex(index - 1);
  };
  document.addEventListener("keydown", onKey, { once: false });
  viewer.__sfKeyHandler = onKey;
}
function sfCloseViewer() {
  const host = document.getElementById("storefront-content");
  if (!host) return;
  const v = host.querySelector(".sf-viewer");
  if (!v) return;
  if (v.__sfKeyHandler) document.removeEventListener("keydown", v.__sfKeyHandler);
  v.remove();
}

// ==========================================================================
// SCROLL CONTROLLER
// ==========================================================================
function sfEnsureScrollButtons() {
  const shell = document.querySelector(".sf-shell");
  if (!shell) return;
  const body = shell.querySelector(".sf-body");
  if (!body) return;

  if (!shell.querySelector(".sf-scroll-fabs")) {
    const fabs = document.createElement("div");
    fabs.className = "sf-scroll-fabs";
    fabs.innerHTML =
      '<button type="button" class="sf-fab sf-fab-up" data-sf-action="scroll-up" aria-label="Scroll up">▲</button>' +
      '<button type="button" class="sf-fab sf-fab-down" data-sf-action="scroll-down" aria-label="Scroll down">▼</button>';
    shell.appendChild(fabs);

    const update = () => {
      const canScroll = body.scrollHeight > body.clientHeight + 8;
      const atTop     = body.scrollTop < 40;
      const atBottom  = body.scrollTop + body.clientHeight >= body.scrollHeight - 40;
      fabs.style.display = canScroll ? "flex" : "none";
      const up = fabs.querySelector(".sf-fab-up");
      const dn = fabs.querySelector(".sf-fab-down");
      if (up) { up.style.opacity = atTop ? "0" : "1"; up.style.pointerEvents = atTop ? "none" : "auto"; }
      if (dn) { dn.style.opacity = atBottom ? "0" : "1"; dn.style.pointerEvents = atBottom ? "none" : "auto"; }
    };

    body.addEventListener("scroll", update, { passive: true });
    setTimeout(update, 60);
    setTimeout(update, 300);

    const mo = new MutationObserver(() => update());
    mo.observe(body, { childList: true, subtree: true });
  }
}

// ==========================================================================
// DELEGATED CLICK HANDLER
// ==========================================================================
function sfHandleDelegatedClick(e) {
  const t = e.target.closest("[data-sf-action]");
  if (!t) return;
  const action = t.dataset.sfAction;

  if (action === "close-storefront") {
    e.preventDefault(); e.stopPropagation();
    closeStorefrontModal();
    return;
  }
  if (action === "open-product-detail") {
    e.preventDefault(); e.stopPropagation();
    sfOpenProductDetail(t.dataset.sfProductId, t.dataset.sfDistributorId, t.dataset.sfDistributorName);
    return;
  }
  if (action === "close-product-detail") {
    e.preventDefault(); e.stopPropagation();
    sfCloseProductDetail();
    return;
  }
  if (action === "open-viewer") {
    e.preventDefault(); e.stopPropagation();
    const cur = __sfCurrentStorefront;
    if (!cur) return;
    const entry = cur.priced.find(x => x.p.id === t.dataset.sfProductId);
    if (!entry) return;
    const startIdx = parseInt(t.dataset.sfImageIndex || "0", 10) || 0;
    sfOpenImageViewer(entry.p, startIdx);
    return;
  }
  if (action === "close-viewer") {
    e.preventDefault(); e.stopPropagation();
    sfCloseViewer();
    return;
  }
  if (action === "qty-inc") {
    e.preventDefault(); e.stopPropagation();
    const id = t.dataset.sfProductId;
    const step = parseFloat(t.dataset.sfStep) || 1;
    __sfQtyByProductId[id] = (__sfQtyByProductId[id] || 1) + step;
    sfSyncQty(id);
    return;
  }
  if (action === "qty-dec") {
    e.preventDefault(); e.stopPropagation();
    const id = t.dataset.sfProductId;
    __sfQtyByProductId[id] = Math.max(1, (__sfQtyByProductId[id] || 1) - 1);
    sfSyncQty(id);
    return;
  }
  if (action === "contact") {
    e.preventDefault(); e.stopPropagation();
    closeStorefrontModal();
    openModal(t.dataset.sfDistributorId, t.dataset.sfDistributorName, "distributor");
    return;
  }
  if (action === "whatsapp") {
    e.preventDefault(); e.stopPropagation();
    openWhatsApp(t.dataset.sfPhone, t.dataset.sfDistributorName);
    return;
  }
  if (action === "open-trust") {
    e.preventDefault(); e.stopPropagation();
    closeStorefrontModal();
    if (typeof showScreen === "function") showScreen("trust");
    return;
  }
  if (action === "open-depletor") {
    e.preventDefault(); e.stopPropagation();
    closeStorefrontModal();
    if (typeof showScreen === "function") showScreen("market");
    setTimeout(() => {
      const el = document.getElementById("depletor-console");
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);
    return;
  }
  if (action === "scroll-up") {
    e.preventDefault(); e.stopPropagation();
    const body = document.querySelector(".sf-shell .sf-body");
    if (body) body.scrollBy({ top: -Math.round(body.clientHeight * 0.7), behavior: "smooth" });
    return;
  }
  if (action === "scroll-down") {
    e.preventDefault(); e.stopPropagation();
    const body = document.querySelector(".sf-shell .sf-body");
    if (body) body.scrollBy({ top: Math.round(body.clientHeight * 0.7), behavior: "smooth" });
    return;
  }
}
function sfSyncQty(productId) {
  const qty = __sfQtyByProductId[productId] || 1;
  document.querySelectorAll('[data-sf-qty-for="' + productId + '"]').forEach(el => {
    el.textContent = String(qty);
  });
  const cur = __sfCurrentStorefront;
  if (!cur) return;
  const entry = cur.priced.find(x => x.p.id === productId);
  if (!entry) return;
  const finalPrice = sfNum(entry.price.finalPrice, 0);
  document.querySelectorAll('[data-sf-action="add-to-cart"][data-sf-product-id="' + productId + '"], .sf-featured-add, .sf-detail-add').forEach(btn => {
    if (btn.getAttribute("data-sf-product-id") === productId) {
      const prefix = btn.classList.contains("sf-detail-add") ? "Add to cart · " : "Add · ";
      btn.textContent = prefix + "₦" + (finalPrice * qty).toLocaleString();
    }
  });
}

// ==========================================================================
// L1 · CONTEXT
// ==========================================================================
function sfCategoryTempo(products) {
  const counts = Object.create(null);
  (products || []).forEach(p => {
    const c = String(p.category || "").trim().toLowerCase();
    if (c) counts[c] = (counts[c] || 0) + 1;
  });
  const keys = Object.keys(counts);
  if (!keys.length) return "fast";
  const regulatedCats = ["pharma", "baby products", "baby"];
  const slowCats      = ["furniture", "building materials", "home appliances", "raw materials"];
  for (const c of keys) if (regulatedCats.some(r => c.includes(r))) return "regulated";
  for (const c of keys) if (slowCats.some(r => c.includes(r))) return "slow";
  return "fast";
}
function sfRelationshipStripCopy(discountPercent, negotiatedCount) {
  const bits = [];
  if (discountPercent && discountPercent > 0) bits.push("<strong>" + sfEscHtml(String(discountPercent)) + "% off</strong>");
  if (negotiatedCount > 0) bits.push("<strong>" + negotiatedCount + "</strong> negotiated price" + (negotiatedCount === 1 ? "" : "s"));
  if (!bits.length) return "";
  return "Relationship advantage: " + bits.join(" · ");
}

// ==========================================================================
// OPEN STOREFRONT MODAL
// ==========================================================================
async function openStorefrontModal(distId) {
  const contentEl = document.getElementById("storefront-content");
  const modalEl   = document.getElementById("storefront-modal");
  if (!contentEl) { sfWarnMissing("storefront-content"); return; }
  if (!modalEl)   { sfWarnMissing("storefront-modal"); return; }

  __sfQtyByProductId = Object.create(null);
  __sfCurrentStorefront = null;

  if (!contentEl.dataset.sfDelegated) {
    contentEl.addEventListener("click", sfHandleDelegatedClick);
    contentEl.dataset.sfDelegated = "1";
  }

  if (!window.sb) {
    contentEl.innerHTML = '<div class="loading-text">Connection service unavailable.</div>';
    modalEl.classList.add("active");
    return;
  }

  contentEl.innerHTML = '<div class="loading-text">Loading…</div>';
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
      (prefs || []).forEach(pref => { productPreferences[pref.product_id] = pref; });
    }
  }

  if (!dist) {
    contentEl.innerHTML = '<div class="loading-text">Not found.</div>';
    return;
  }

  const availableProducts = (products || []).filter(p => sfNum(p.stock_quantity, 0) > 0);
  sfEmitProductViews(dist.id, availableProducts);

  const priced = availableProducts.map(p => {
    const pref = productPreferences[p.id];
    const price = sfComputePrice(p, pref, discountPercent);
    return { p, price };
  });

  const tempo = sfCategoryTempo(availableProducts);
  const engineCtx = getStorefrontEngineContext(dist.id);

  const negotiatedCount = priced.filter(x => x.price.advantageLabel === "your_negotiated_price").length;
  const stripCopy = sfRelationshipStripCopy(discountPercent, negotiatedCount);

  const slotCtx = {
    dist, engineCtx, stripCopy,
    productCount: availableProducts.length,
    availableProducts, priced, tempo
  };

  const plan = {
    html:
      renderTopbar() +
      renderHeaderRelationship(slotCtx) +
      renderHeroPrimary(slotCtx) +
      renderEngineTransparency(slotCtx) +
      renderCurationMain(slotCtx) +
      renderCommitmentPath(slotCtx)
  };
  const gr = {
    dark:    guardNoDarkPatterns(plan),
    urgency: guardUrgencyIsEngineBound(plan, engineCtx)
  };
  if (!gr.dark.ok)    console.warn("[GoodsbarnX/storefront] guardrail: dark patterns detected", gr.dark.reasons);
  if (!gr.urgency.ok) console.warn("[GoodsbarnX/storefront] guardrail: urgency unbound from engine", gr.urgency.reasons);

  __sfCurrentStorefront = { dist, priced, engineCtx, tempo };

  contentEl.innerHTML =
    '<div class="sf-shell">' +
      renderTopbar() +
      '<div class="sf-body">' +
        renderHeaderRelationship(slotCtx) +
        renderHeroPrimary(slotCtx) +
        renderEngineTransparency(slotCtx) +
        renderCurationMain(slotCtx) +
      '</div>' +
      renderCommitmentPath(slotCtx) +
    '</div>';

  sfEnsureScrollButtons();
}

console.log("[GoodsbarnX] storefront.js loaded (V1.8.2.6 rev.6 · F-19 patched)");
