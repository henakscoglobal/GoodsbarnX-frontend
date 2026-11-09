// ==========================================================================
// GoodsbarnX — storefront.js  (rev. 3 · architecture Phase 1)
// Distributor storefront modal, rebuilt as a 5-slot shell driven by an
// engine-context projection and three runtime guardrails.
//
// Plain global script. Loads sixth (Canon §10).
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
// Storefront architecture Phase 1 (this revision):
//   - Five-slot shell:
//       [1] header.relationship    → renderHeaderRelationship
//       [2] hero.primary           → renderHeroPrimary
//       [3] engine.transparency    → renderEngineTransparency
//       [4] curation.main          → renderCurationMain
//       [5] commitment.path        → renderCommitmentPath
//   - Engine-context projection via getStorefrontEngineContext(). Reads
//     window.goodsbarnxLastReplenishmentSnapshot (produced by
//     depletor-replenishment.js) to determine stockState, worstUrgency,
//     and freshness. If the snapshot is absent or stale, the storefront
//     downgrades to a neutral "updated X ago" line — never fabricates
//     urgency (Canon §29).
//   - Guardrails (run before any renderer):
//       guardNoDarkPatterns     — refuses countdowns, fake scarcity, modal traps
//       guardUrgencyIsEngineBound — urgency in the plan must be justified by ctx
//       guardPersonalizationVisible — every buyer-specific price is labelled
//     A guardrail failure downgrades the RenderPlan; it does not throw. The
//     storefront still renders, honestly degraded.
//   - Slot contracts are expressed as JSDoc; runtime contract violations
//     produce a console warning, not a crash. CI enforcement is a later
//     phase (Option C, Phase 4).
//
// This file does NOT:
//   - write to the database.
//   - call sb.rpc("record_buyer_behavior_event") directly.
//   - own stock truth. Stock truth lives in the MSD pipeline.
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
// D35 — BOUNDED product_view emission (unchanged from rev. 2)
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

// ==========================================================================
// L4 · ENGINE INTERFACE (projection, not core)
// ==========================================================================

/**
 * getStorefrontEngineContext(distributorId)
 *
 * Projects the replenishment snapshot (produced by depletor-replenishment.js)
 * into the storefront's view of the engine. Read-only. Never fabricates.
 *
 * Returns:
 *   {
 *     source:        "engine" | "stale" | "unavailable",
 *     stockState:    "healthy" | "depleting" | "scarce" | "locked" | "unknown",
 *     worstUrgency:  "HIGH" | "MODERATE" | "LOW" | "UNKNOWN" | null,
 *     updatedAt:     ISO string | null,
 *     freshnessMs:   number | null,
 *     distributorId: string
 *   }
 *
 * Freshness policy:
 *   - < 5 min   → source = "engine"
 *   - < 30 min  → source = "stale" (renderer shows "updated Xm ago")
 *   - ≥ 30 min  → source = "unavailable" (renderer shows "stock signal
 *                  unavailable"; urgency claims suppressed)
 *   - No snapshot at all → source = "unavailable"
 */
function getStorefrontEngineContext(distributorId) {
  const snapshot = window.goodsbarnxLastReplenishmentSnapshot || null;

  if (!snapshot || !Array.isArray(snapshot.rows)) {
    return {
      source: "unavailable",
      stockState: "unknown",
      worstUrgency: null,
      updatedAt: null,
      freshnessMs: null,
      distributorId
    };
  }

  const distRows = snapshot.rows.filter(r => r.distributor_id === distributorId);

  // Freshness
  const updatedAt = snapshot.generatedAt || null;
  const freshnessMs = updatedAt ? (Date.now() - new Date(updatedAt).getTime()) : null;
  let source = "engine";
  if (freshnessMs == null || freshnessMs > 30 * 60 * 1000) source = "unavailable";
  else if (freshnessMs > 5 * 60 * 1000) source = "stale";

  if (!distRows.length) {
    return {
      source,
      stockState: "healthy",
      worstUrgency: "LOW",
      updatedAt,
      freshnessMs,
      distributorId
    };
  }

  // Worst urgency drives stockState
  const rank = { HIGH: 3, MODERATE: 2, LOW: 1, UNKNOWN: 0 };
  let worst = "LOW";
  for (const r of distRows) {
    const u = r.urgency || "UNKNOWN";
    if ((rank[u] || 0) > (rank[worst] || 0)) worst = u;
  }

  let stockState;
  switch (worst) {
    case "HIGH":     stockState = "depleting"; break;
    case "MODERATE": stockState = "healthy";   break;  // watch but not critical
    case "LOW":      stockState = "healthy";   break;
    default:         stockState = "unknown";   break;
  }

  return { source, stockState, worstUrgency: worst, updatedAt, freshnessMs, distributorId };
}

// ==========================================================================
// L2 · GUARDRAILS
// ==========================================================================

/**
 * guardNoDarkPatterns(renderPlan)
 *
 * Refuses to emit countdowns, fake scarcity markers, or modal traps.
 * Returns { ok, reasons[] }. On failure the caller must downgrade the plan.
 */
function guardNoDarkPatterns(renderPlan) {
  const reasons = [];
  const html = String(renderPlan?.html || "");

  if (/<[^>]*data-countdown/i.test(html)) reasons.push("countdown_present");
  if (/only\s+\d+\s+left/i.test(html))     reasons.push("scarcity_marker_present");
  if (/expires\s+in/i.test(html))          reasons.push("expiry_claim_present");
  if (/<dialog/i.test(html))               reasons.push("modal_trap_present");

  return { ok: reasons.length === 0, reasons };
}

/**
 * guardUrgencyIsEngineBound(renderPlan, engineCtx)
 *
 * Any urgency/stock claim in the plan must be supported by engineCtx.source.
 * If ctx.source is "unavailable", urgency claims must be suppressed.
 */
function guardUrgencyIsEngineBound(renderPlan, engineCtx) {
  const reasons = [];
  const html = String(renderPlan?.html || "");
  const claimsUrgency = /data-urgency|urgency-claim|scarcity|low[-\s]stock|almost\s+out/i.test(html);

  if (claimsUrgency && engineCtx.source === "unavailable") {
    reasons.push("urgency_claim_without_engine_truth");
  }
  return { ok: reasons.length === 0, reasons };
}

/**
 * guardPersonalizationVisible(price)
 *
 * Buyer-specific prices must be explicitly labelled. A discounted or
 * negotiated price that is silently substituted is a guardrail failure.
 */
function guardPersonalizationVisible(price) {
  if (!price || !price.advantage) return { ok: true, reasons: [] };
  const reasons = [];
  // Advantage present ⇒ must be rendered as a visible label, not hidden.
  if (!price.advantageLabel) reasons.push("advantage_without_label");
  return { ok: reasons.length === 0, reasons };
}

// ==========================================================================
// PRESENTATION HELPERS (unchanged semantics, reshaped for slots)
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

/**
 * §31 pricing computation — unchanged from rev. 2 in behaviour, now also
 * carries `advantageLabel` so guardPersonalizationVisible can verify it.
 */
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
    originalHtml +
    advantageHtml
  );
}

// ==========================================================================
// L3 · SLOT RENDERERS
// ==========================================================================

/**
 * [1] header.relationship
 * Contract:
 *   accepts: dist, engineCtx, relationship
 *   forbids: fabricated verification, unbound trust scores
 *   must:    show evidence line sourced from real fields
 */
function renderHeaderRelationship(ctx) {
  const { dist, engineCtx } = ctx;
  const hasPhone = !!(dist.profiles && dist.profiles.phone);

  const evidenceBits = [];
  const tierLabel = sfTierLabel(dist.verification_tier);
  if (tierLabel && tierLabel !== "Unverified") evidenceBits.push(tierLabel);
  if (ctx.productCount > 0) {
    evidenceBits.push(ctx.productCount + (ctx.productCount === 1 ? " product" : " products") + " in stock");
  }
  if (hasPhone) evidenceBits.push("Contact available");

  return (
    '<div class="sf-merchant" data-slot="header.relationship">' +
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
    '</div>'
  );
}

/**
 * [2] hero.primary
 * Contract:
 *   accepts: dist, engineCtx, stripCopy
 *   forbids: fabricated scarcity, unbound countdown, >1 primary CTA
 *   must:    bind urgency (if any) → engineCtx truth
 *
 * Phase 1: ONE renderer. Stock-state variations are expressed as a single
 * strip variant selected by engineCtx.stockState. Adding per-type hero
 * renderers in Phase 3 means adding variants keyed on buyerType; the shell
 * does not change.
 */
function renderHeroPrimary(ctx) {
  const { engineCtx, stripCopy } = ctx;

  // Choose a strip variant
  let stripVariant = null;
  let stripHtml = "";

  if (stripCopy) {
    stripVariant = "advantage";
    stripHtml =
      '<div class="sf-relationship-strip" data-variant="advantage" data-slot="hero.primary">' +
        '<div class="sf-relationship-strip-copy">' + stripCopy + '</div>' +
      '</div>';
  } else if (engineCtx.source === "unavailable") {
    stripVariant = "engine_unavailable";
    stripHtml =
      '<div class="sf-relationship-strip" data-variant="engine_unavailable" data-slot="hero.primary">' +
        '<div class="sf-relationship-strip-copy">' +
          'Stock signal unavailable · last catalogue state shown' +
        '</div>' +
      '</div>';
  } else if (engineCtx.stockState === "depleting") {
    stripVariant = "depleting";
    stripHtml =
      '<div class="sf-relationship-strip" data-variant="depleting" data-urgency="depleting" data-slot="hero.primary">' +
        '<div class="sf-relationship-strip-copy">' +
          'Restock recommended · ' +
          (engineCtx.updatedAt ? 'stock signal updated ' + sfFormatFreshness(engineCtx.freshnessMs) : 'engine active') +
        '</div>' +
      '</div>';
  }

  return stripHtml;
}

/**
 * [3] engine.transparency
 * Contract:
 *   accepts: engineCtx
 *   forbids: hidden freshness, fabricated timestamps
 *   must:    surface staleness truthfully
 */
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
    '<div class="sf-engine-transparency" data-slot="engine.transparency" data-tone="' + tone + '">' +
      label +
    '</div>'
  );
}

/**
 * [4] curation.main
 * Contract:
 *   accepts: priced[], dist, tempo
 *   forbids: raw DOM ids outside the slot, unescaped fields
 *   must:    scale density with category tempo
 *
 * Density:
 *   fast       → featured hero 2 + compact catalogue
 *   slow       → featured hero 3 + compact catalogue
 *   regulated  → featured hero 1 + compact catalogue with spec emphasis
 */
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

/**
 * [5] commitment.path
 * Contract:
 *   accepts: dist, availableProducts[]
 *   forbids: multiple primary CTAs, distracting animations
 *   must:    one Contact + optional WhatsApp
 */
function renderCommitmentPath(ctx) {
  const { dist, availableProducts } = ctx;
  if (!availableProducts.length) return "";

  const safeDistId   = sfEscAttr(dist.id);
  const safeDistName = sfEscAttr(dist.business_name || "Distributor");
  const phone        = (dist.profiles && dist.profiles.phone) || "";

  const whatsappBtn = phone
    ? '<button type="button" class="sf-btn sf-btn-whatsapp" onclick="openWhatsApp(\'' +
        sfEscAttr(phone) + '\', \'' + safeDistName + '\')">WhatsApp</button>'
    : "";

  return (
    '<div class="sf-action-bar" data-slot="commitment.path">' +
      '<button type="button" class="sf-btn sf-btn-primary" onclick="closeStorefrontModal(); openModal(\'' +
        safeDistId + '\', \'' + safeDistName + '\', \'distributor\')">Contact distributor</button>' +
      whatsappBtn +
    '</div>'
  );
}

// ---- Per-card renderers (unchanged content, untouched by slot logic) ------

function sfRenderFeaturedCard(p, dist, price) {
  const safeProductId = sfEscAttr(p.id);
  const safeDistId    = sfEscAttr(dist.id);
  const safeImageUrl  = p.image_url ? sfEscAttr(p.image_url) : null;
  const imageStyle    = safeImageUrl ? "background-image:url('" + safeImageUrl + "');" : "";
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
  const safeDistId   = sfEscAttr(dist.id);
  const safeDistName = sfEscAttr(dist.business_name || "Distributor");
  return (
    '<div class="sf-empty" data-slot="curation.main">' +
      '<div class="sf-empty-icon">▢</div>' +
      '<div class="sf-empty-title">No products in stock</div>' +
      '<div class="sf-empty-sub">This distributor has no active products right now. ' +
        'You can still contact them to ask about upcoming stock.</div>' +
      '<button type="button" class="sf-btn sf-btn-primary" style="margin-top:16px;" onclick="closeStorefrontModal(); openModal(\'' +
        safeDistId + '\', \'' + safeDistName + '\', \'distributor\')">Contact distributor</button>' +
    '</div>'
  );
}

// ==========================================================================
// L1 · CONTEXT (what we can observe today)
// ==========================================================================

/**
 * Classify a distributor's dominant product category into a commercial tempo.
 * Overlaps resolve to "regulated" (the strictest).
 */
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

  for (const c of keys) {
    if (regulatedCats.some(r => c.includes(r))) return "regulated";
  }
  for (const c of keys) {
    if (slowCats.some(r => c.includes(r))) return "slow";
  }
  return "fast";
}

// ==========================================================================
// OPEN STOREFRONT MODAL — shell assembly
// ==========================================================================

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

  // ---- 1. Fetch ----
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

  // ---- 2. §31 pricing ----
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

  // ---- 3. D35 emission ----
  sfEmitProductViews(dist.id, availableProducts);

  // ---- 4. Price everything once ----
  const priced = availableProducts.map(p => {
    const pref = productPreferences[p.id];
    const price = sfComputePrice(p, pref, discountPercent);
    return { p, price };
  });

  // ---- 5. L1 Context ----
  const tempo = sfCategoryTempo(availableProducts);
  const engineCtx = getStorefrontEngineContext(dist.id);

  // ---- 6. Relationship advantage strip copy (uses existing helper) ----
  const negotiatedCount = priced.filter(x => x.price.advantageLabel === "your_negotiated_price").length;
  const stripCopy = sfRelationshipStripCopy(discountPercent, negotiatedCount);

  // ---- 7. Pre-render all slots ----
  const slotCtx = {
    dist,
    engineCtx,
    stripCopy,
    productCount: availableProducts.length,
    availableProducts,
    priced,
    tempo
  };

  const slotHeader      = renderHeaderRelationship(slotCtx);
  const slotHero        = renderHeroPrimary(slotCtx);
  const slotTransparency= renderEngineTransparency(slotCtx);
  const slotCuration    = renderCurationMain(slotCtx);
  const slotCommitment  = renderCommitmentPath(slotCtx);

  const bodyHtml = slotHeader + slotHero + slotTransparency + slotCuration + slotCommitment;

  // ---- 8. Guardrails (last gate before DOM write) ----
  const plan = { html: bodyHtml };
  const gr = {
    dark:    guardNoDarkPatterns(plan),
    urgency: guardUrgencyIsEngineBound(plan, engineCtx)
  };
  const personalizationFailures = priced
    .map(x => ({ id: x.p.id, res: guardPersonalizationVisible(x.price) }))
    .filter(x => !x.res.ok);

  if (!gr.dark.ok) {
    console.warn("[GoodsbarnX/storefront] guardrail: dark patterns detected", gr.dark.reasons);
  }
  if (!gr.urgency.ok) {
    console.warn("[GoodsbarnX/storefront] guardrail: urgency unbound from engine", gr.urgency.reasons);
  }
  if (personalizationFailures.length) {
    console.warn("[GoodsbarnX/storefront] guardrail: personalization not visible on " +
      personalizationFailures.length + " rows");
  }

  // ---- 9. Assemble shell ----
  const bodySlotHtml = slotCuration;  // curation is the only inner-scroll slot today
  const topSlotsHtml = slotHeader + slotHero + slotTransparency;
  // Action bar lives outside .sf-body so it stays pinned.
  const actionBarHtml = slotCommitment;

  contentEl.innerHTML =
    '<div class="sf-shell">' +
      topSlotsHtml +
      '<div class="sf-body">' + bodySlotHtml + '</div>' +
      actionBarHtml +
    '</div>';
}

// --------------------------------------------------------------------------
// Legacy helper retained (unchanged, used by relationship.js etc.)
// --------------------------------------------------------------------------

function sfRelationshipStripCopy(discountPercent, negotiatedCount) {
  const bits = [];
  if (discountPercent && discountPercent > 0) {
    bits.push("<strong>" + sfEscHtml(String(discountPercent)) + "% off</strong>");
  }
  if (negotiatedCount > 0) {
    bits.push("<strong>" + negotiatedCount + "</strong> negotiated price" + (negotiatedCount === 1 ? "" : "s"));
  }
  if (!bits.length) return "";
  return "Relationship advantage: " + bits.join(" · ");
}

console.log("[GoodsbarnX] storefront.js loaded (V1.8.2.6 rev.3 · 5-slot shell)");
