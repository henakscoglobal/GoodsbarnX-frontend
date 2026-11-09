// ==========================================================================
// GoodsbarnX — storefront.js  (rev. 2)
// Distributor storefront modal: "The Merchant's Window" — merchant banner,
// relationship advantage strip, featured shelf, compact catalogue.
// §31 relationship-aware pricing preserved. D35 product_view emission
// preserved. Plain global script. Loads sixth (Canon §10).
//
// V1.8.2.6 remediation Phase 1+2 (retained):
//   - §31 pricing hierarchy: negotiated → relationship discount →
//     public → negotiable.
//
// Phase 5 rev. 1 (D35) (retained):
//   - Emits product_view for the top three rendered products via
//     window.goodsbarnxBehaviourTrack.
//   - All interpolated values inside HTML and onclick attributes are escaped.
//   - DOM lookups null-safe; sb null-guarded.
//
// Storefront redesign (rev. 2):
//   - "The Merchant's Window" layout: full-bleed merchant banner, single
//     relationship advantage strip, featured shelf (first two products),
//     compact catalogue list (rest), sticky action bar.
//   - No change to data fetching, §31 pricing logic, or D35 emission.
//   - No fabricated data: every line rendered is derived from a field that
//     was already present in the previous storefront.
//   - DOM targets are unchanged (#storefront-content, #storefront-modal).
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
// D35 — BOUNDED product_view emission (unchanged)
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
// SMALL PRESENTATION HELPERS
// --------------------------------------------------------------------------

// Trust tier → human-readable label. Only the tier names the schema already
// uses; no invented tiers.
function sfTierLabel(tier) {
  if (tier === "association") return "Association Verified";
  if (tier === "market board") return "Market Board Verified";
  if (tier === "self-attested") return "Self-Attested";
  return "Unverified";
}

// Compose the evidence line under the merchant name. Only fields we already
// fetched: tier, product count, contact availability. No fabrication.
function sfEvidenceLine(tier, productCount, hasPhone) {
  const parts = [];
  const t = sfTierLabel(tier);
  if (t && t !== "Unverified") parts.push(t);
  if (productCount > 0) parts.push(productCount + (productCount === 1 ? " product" : " products") + " in stock");
  if (hasPhone) parts.push("Contact available");
  return parts.length ? parts.join(" · ") : "";
}

// Relationship advantage strip copy. Only shown when there is an advantage.
function sfRelationshipStripCopy(discountPercent, negotiatedCount) {
  const bits = [];
  if (discountPercent && discountPercent > 0) {
    bits.push("<strong>" + sfEscHtml(String(discountPercent)) + "% off</strong>");
  }
  if (negotiatedCount > 0) {
    bits.push("<strong>" + negotiatedCount + "</strong> negotiated price" + (negotiatedCount === 1 ? "" : "s"));
  }
  if (!bits.length) return "";
  return 'Relationship advantage: ' + bits.join(" · ");
}

// Price display object for a single product under §31 rules.
function sfComputePrice(product, pref, discountPercent) {
  const publicPrice = sfNum(product.price, 0);
  const hasNegotiated = pref && pref.negotiated_unit_price != null;
  const hasDiscount   = !hasNegotiated && discountPercent && publicPrice > 0;

  let finalPrice = publicPrice;
  let advantage = "";
  let original = null;

  if (!product.price && !hasNegotiated) {
    return { finalPrice: null, original: null, advantage: "", isNegotiable: true };
  }
  if (hasNegotiated) {
    finalPrice = sfNum(pref.negotiated_unit_price, 0);
    original = publicPrice > 0 ? publicPrice : null;
    advantage = "Your price";
  } else if (hasDiscount) {
    finalPrice = Math.round(publicPrice * (1 - discountPercent / 100));
    original = publicPrice;
    advantage = "You save " + Math.round(discountPercent) + "%";
  }
  return { finalPrice, original, advantage, isNegotiable: false };
}

function sfPriceBlockHtml(price, classes) {
  if (price.isNegotiable) {
    return '<div class="' + classes.value + '">Negotiable</div>';
  }
  const originalHtml = price.original != null
    ? '<div class="' + classes.original + '">₦' + price.original.toLocaleString() + '</div>'
    : "";
  const advantageHtml = price.advantage
    ? '<div class="' + classes.advantage + '">' + sfEscHtml(price.advantage) + '</div>'
    : "";
  return (
    '<div class="' + classes.value + '">₦' + sfNum(price.finalPrice, 0).toLocaleString() + '</div>' +
    originalHtml +
    advantageHtml
  );
}

// --------------------------------------------------------------------------
// RENDERERS
// --------------------------------------------------------------------------

function sfRenderFeaturedCard(p, dist, price) {
  const safeProductId   = sfEscAttr(p.id);
  const safeDistId      = sfEscAttr(dist.id);
  const safeImageUrl    = p.image_url ? sfEscAttr(p.image_url) : null;
  const imageStyle      = safeImageUrl
    ? "background-image:url('" + safeImageUrl + "');"
    : "";
  const brand = p.brand ? sfEscHtml(p.brand) + " · " : "";
  const sku   = sfEscHtml(p.sku || "No SKU");
  const preferredMark = (p.__preferred || price.advantage === "Your price")
    ? ' · <span style="color:var(--gbx-gold);font-weight:700;">★</span>'
    : "";

  const onClick =
    "addToCart('" + safeProductId + "', " +
    JSON.stringify(String(p.name || "Product")) + ", " +
    sfNum(price.finalPrice || 0, 0) + ", '" +
    safeDistId + "', " +
    JSON.stringify(String(dist.business_name || "Distributor")) + ")";

  return (
    '<div class="sf-featured-card">' +
      '<div class="sf-featured-image" style="' + imageStyle + '"></div>' +
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
      '<button type="button" class="sf-featured-add" onclick="' + onClick + '">Add to cart</button>' +
    '</div>'
  );
}

function sfRenderCatalogueRow(p, dist, price) {
  const safeProductId = sfEscAttr(p.id);
  const safeDistId    = sfEscAttr(dist.id);
  const brand = p.brand ? sfEscHtml(p.brand) + " · " : "";
  const sku   = sfEscHtml(p.sku || "No SKU");

  const onClick =
    "addToCart('" + safeProductId + "', " +
    JSON.stringify(String(p.name || "Product")) + ", " +
    sfNum(price.finalPrice || 0, 0) + ", '" +
    safeDistId + "', " +
    JSON.stringify(String(dist.business_name || "Distributor")) + ")";

  return (
    '<div class="sf-catalogue-row">' +
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
      '</div>' +
      '<button type="button" class="sf-catalogue-add" onclick="' + onClick + '">Add</button>' +
    '</div>'
  );
}

function sfRenderEmptyState(dist) {
  const safeDistId = sfEscAttr(dist.id);
  const safeDistName = sfEscAttr(dist.business_name || "Distributor");
  return (
    '<div class="sf-empty">' +
      '<div class="sf-empty-icon">▢</div>' +
      '<div class="sf-empty-title">No products in stock</div>' +
      '<div class="sf-empty-sub">This distributor has no active products right now. ' +
        'You can still contact them to ask about upcoming stock.</div>' +
      '<div class="sf-action-bar" style="margin-top:20px;padding:0;background:none;border:none;">' +
        '<button type="button" class="sf-btn sf-btn-primary" onclick="closeStorefrontModal(); openModal(\'' +
          safeDistId + '\', \'' + safeDistName + '\', \'distributor\')">Contact distributor</button>' +
      '</div>' +
    '</div>'
  );
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

  contentEl.innerHTML = '<div class="loading-text">Loading…</div>';
  modalEl.classList.add("active");

  // ---- 1. Data fetch (unchanged from rev. 1) ----
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

  // ---- 2. §31 relationship-aware pricing (unchanged) ----
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

  // ---- 3. D35 emission (unchanged) ----
  sfEmitProductViews(dist.id, availableProducts);

  // ---- 4. Pre-compute prices for every product (single pass) ----
  const priced = availableProducts.map(p => {
    const pref = productPreferences[p.id];
    const price = sfComputePrice(p, pref, discountPercent);
    return { p, price };
  });

  // ---- 5. Relationship advantage strip ----
  const negotiatedCount = priced.filter(x => x.price.advantage === "Your price").length;
  const stripCopy = sfRelationshipStripCopy(discountPercent, negotiatedCount);

  // ---- 6. Merchant banner ----
  const hasPhone = !!(dist.profiles && dist.profiles.phone);
  const evidence = sfEvidenceLine(dist.verification_tier, availableProducts.length, hasPhone);

  const bannerHtml =
    '<div class="sf-merchant">' +
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
      (evidence
        ? '<div class="sf-merchant-evidence">' + evidence.replace(/&/g, "&amp;") + '</div>'
        : "") +
    '</div>';

  const stripHtml = stripCopy
    ? '<div class="sf-relationship-strip"><div class="sf-relationship-strip-copy">' + stripCopy + '</div></div>'
    : "";

  // ---- 7. Featured shelf (first two) + catalogue (rest) ----
  const featured = priced.slice(0, 2);
  const rest     = priced.slice(2);

  const featuredHtml = featured.length
    ? '<div class="sf-featured">' +
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

  const bodyHtml = availableProducts.length
    ? (featuredHtml + catalogueHtml)
    : sfRenderEmptyState(dist);

  // ---- 8. Action bar (contact + WhatsApp) ----
  const safeDistId   = sfEscAttr(dist.id);
  const safeDistName = sfEscAttr(dist.business_name || "Distributor");
  const phone        = (dist.profiles && dist.profiles.phone) || "";
  const whatsappBtn = phone
    ? '<button type="button" class="sf-btn sf-btn-whatsapp" onclick="openWhatsApp(\'' +
        sfEscAttr(phone) + '\', \'' + safeDistName + '\')">WhatsApp</button>'
    : "";

  // Suppress the action bar when the empty state is showing (it has its own).
  const actionBarHtml = availableProducts.length
    ? '<div class="sf-action-bar">' +
        '<button type="button" class="sf-btn sf-btn-primary" onclick="closeStorefrontModal(); openModal(\'' +
          safeDistId + '\', \'' + safeDistName + '\', \'distributor\')">Contact distributor</button>' +
        whatsappBtn +
      '</div>'
    : "";

  // ---- 9. Assemble ----
  contentEl.innerHTML =
    '<div class="sf-shell">' +
      bannerHtml +
      stripHtml +
      '<div class="sf-body">' + bodyHtml + '</div>' +
      actionBarHtml +
    '</div>';
}

console.log("[GoodsbarnX] storefront.js loaded (V1.8.2.6 rev.2 · Merchant's Window)");
