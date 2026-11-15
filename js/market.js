// ==========================================================================
// GoodsbarnX — market.js  (rev. 6 · Relationship-first + Security-hardened)
// Plain global script. Loads fourth (Canon §10).
//
// This is not a directory. It is the buyer's relationship-graph reflection
// of the marketplace, with security hardened against the classes of attack
// a marketplace exposes.
//
// Security (rev.6 · F-24):
//   V-A  All inline onclick handlers removed. Every interactive element
//        carries data-* attributes and is wired through a single delegated
//        listener on #screen-market. This eliminates the stored-XSS
//        vector where a business name containing quote characters could
//        break out of a JS string embedded in an HTML attribute.
//   V-B  Buyer roster is not loaded, not rendered, and not stored in any
//        global variable for non-distributor viewers. Injected calls to
//        renderBuyers() are rejected at the DOM layer.
//   V-C  All distributorId and buyerId values are validated as UUID v4
//        before being used in any dispatch, RPC, or storefront open.
//   V-D  openWhatsApp validates the resulting phone number against the
//        Nigerian format before constructing wa.me URL. Rejects invalid.
//   V-E  emitDistributorView is UUID-guarded and session-throttled.
//   V-F  All Supabase queries remain column-scoped (never select("*")
//        for public data).
//   V-G  The in-memory relationship graph is shape-validated after every
//        load. Corrupt rows are dropped, not carried.
//   V-H  escHtml strips C0/C1 control characters (defensive — even
//        though inline handlers are removed, all HTML interpolation
//        should be control-char-safe).
//
// Architecture (rev.5, retained):
//   L1 · RELATIONSHIP GRAPH  · per-session cache of viewer's relationships
//   L2 · ENRICHMENT          · per-distributor: status, relevance, direction
//   L3 · ENGINE CONTEXT      · reads goodsbarnxLastReplenishmentSnapshot
//   L4 · RENDER              · light sectioning: "Your network" + flat list
//   L5 · INTERACTION         · delegated events, no inline handlers
//
// Backward compatibility:
//   - All public functions preserved with the same signatures.
//   - All DOM targets preserved.
//   - All data-* attributes preserved.
//   - index.html requires ONE change: the nav-market emoji replaced with
//     the .gbx-icon-market SVG (see delivery notes).
// ==========================================================================

// ==========================================================================
// SAFE PRIMITIVES
// ==========================================================================

function escHtml(v) {
  // V-H: strip C0/C1 control chars before escaping. Otherwise null bytes
  // and similar can survive into the DOM.
  return String(v == null ? "" : v)
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
function escAttr(v) { return escHtml(v); }

// V-C: strict UUID v4 validation. Reject anything else from dispatch.
var __MARKET_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function isValidUuid(v) { return typeof v === "string" && __MARKET_UUID_RE.test(v); }

// V-D: Nigerian phone number. Accepts 234XXXXXXXXXX or 0XXXXXXXXXX.
var __MARKET_NG_PHONE_RE = /^(234|0)[789][01]\d{8}$/;
function isValidNgPhone(v) {
  var digits = String(v || "").replace(/\D/g, "");
  return __MARKET_NG_PHONE_RE.test(digits);
}

const __gbxMarketWarnedTargets = Object.create(null);
function warnMissingTarget(id) {
  if (__gbxMarketWarnedTargets[id]) return;
  __gbxMarketWarnedTargets[id] = true;
  console.warn("[GoodsbarnX/market] DOM target #" + id + " is missing from index.html.");
}

// ==========================================================================
// L1 · RELATIONSHIP GRAPH  (per-session cache, shape-validated)
// ==========================================================================

const __gbxMarketGraph = {
  viewerRole: "guest",
  myRelationships: [],
  myPendingInbound: [],
  myPendingOutbound: [],
  contactedSet: new Set(),
  loaded: false
};

/**
 * V-G: validate and normalise graph rows. Anything that doesn't match
 * the expected shape is dropped with a warning — never carried into
 * subsequent renders. This prevents a compromised backend or a partial
 * query result from corrupting the UI state.
 */
function validateGraphRows(rows, expectField) {
  if (!Array.isArray(rows)) return [];
  return rows.filter(function (r) {
    if (!r || typeof r !== "object") return false;
    if (!r[expectField] || !isValidUuid(r[expectField])) return false;
    if (r.status != null && typeof r.status !== "string") return false;
    return true;
  });
}

async function loadMarketGraph() {
  __gbxMarketGraph.viewerRole = (currentUser && currentUser.role) || "guest";
  __gbxMarketGraph.myRelationships = [];
  __gbxMarketGraph.myPendingInbound = [];
  __gbxMarketGraph.myPendingOutbound = [];
  __gbxMarketGraph.contactedSet = new Set();

  if (!currentUser || !window.sb) {
    __gbxMarketGraph.loaded = true;
    return;
  }

  try {
    if (currentUser.role === "buyer") {
      const [rels, locks] = await Promise.all([
        sb.from("trade_relationships")
          .select("distributor_id,status,is_primary,relationship_started_at,created_at")
          .eq("buyer_id", currentUser.id),
        sb.from("buyer_locks")
          .select("distributor_id,status,created_at")
          .eq("buyer_id", currentUser.id)
          .eq("status", "pending_consent")
      ]);
      validateGraphRows(rels.data || [], "distributor_id").forEach(function (r) {
        __gbxMarketGraph.myRelationships.push({
          distributor_id: r.distributor_id,
          status: String(r.status || "").toLowerCase(),
          is_primary: !!r.is_primary,
          since: r.relationship_started_at || r.created_at || null
        });
      });
      validateGraphRows(locks.data || [], "distributor_id").forEach(function (l) {
        __gbxMarketGraph.myPendingInbound.push({
          distributor_id: l.distributor_id,
          created_at: l.created_at || null
        });
      });
    } else if (currentUser.role === "distributor") {
      const [rels, locks, inq] = await Promise.all([
        sb.from("trade_relationships")
          .select("buyer_id,status,is_primary,relationship_started_at,created_at")
          .eq("distributor_id", currentUser.id),
        sb.from("buyer_locks")
          .select("buyer_id,status,created_at")
          .eq("distributor_id", currentUser.id)
          .eq("status", "pending_consent"),
        sb.from("inquiries")
          .select("buyer_id")
          .eq("distributor_id", currentUser.id)
      ]);
      validateGraphRows(rels.data || [], "buyer_id").forEach(function (r) {
        __gbxMarketGraph.myRelationships.push({
          buyer_id: r.buyer_id,
          status: String(r.status || "").toLowerCase(),
          is_primary: !!r.is_primary,
          since: r.relationship_started_at || r.created_at || null
        });
      });
      validateGraphRows(locks.data || [], "buyer_id").forEach(function (l) {
        __gbxMarketGraph.myPendingOutbound.push({
          buyer_id: l.buyer_id,
          created_at: l.created_at || null
        });
      });
      (inq.data || []).forEach(function (x) {
        if (x && isValidUuid(x.buyer_id)) __gbxMarketGraph.contactedSet.add(x.buyer_id);
      });
    }
  } catch (err) {
    console.warn("[GoodsbarnX/market] loadMarketGraph failed:", err && err.message);
  }

  __gbxMarketGraph.loaded = true;
}

// ==========================================================================
// L2 · ENRICHMENT
// ==========================================================================

function enrichDistributorForViewer(dist) {
  var viewerRole = __gbxMarketGraph.viewerRole;
  if (viewerRole !== "buyer") return { relationship: "none", relevance: 100, label: null };

  var rel = __gbxMarketGraph.myRelationships.find(function (r) { return r.distributor_id === dist.id; });
  var pendingIn = __gbxMarketGraph.myPendingInbound.find(function (p) { return p.distributor_id === dist.id; });

  if (rel) {
    if (rel.status === "active") return { relationship: "active", relevance: rel.is_primary ? 0 : 1, label: rel.is_primary ? "Primary relationship" : "Active relationship" };
    if (rel.status === "paused") return { relationship: "paused", relevance: 5, label: "Relationship paused" };
    if (rel.status === "suspended") return { relationship: "suspended", relevance: 6, label: "Relationship suspended" };
    if (rel.status === "released") return { relationship: "released", relevance: 7, label: "Released — rekindle" };
    if (rel.status === "terminated") return { relationship: "terminated", relevance: 8, label: "Terminated — rekindle" };
  }
  if (pendingIn) return { relationship: "pending_in", relevance: 2, label: "Wants to connect" };
  return { relationship: "none", relevance: 50, label: null };
}

function enrichBuyerForViewer(buyer) {
  var rel = __gbxMarketGraph.myRelationships.find(function (r) { return r.buyer_id === buyer.id; });
  var pendingOut = __gbxMarketGraph.myPendingOutbound.find(function (p) { return p.buyer_id === buyer.id; });
  var contacted = __gbxMarketGraph.contactedSet.has(buyer.id);

  if (rel && rel.status === "active") return { relationship: "active", relevance: rel.is_primary ? 0 : 1, label: rel.is_primary ? "Primary relationship" : "Active relationship" };
  if (pendingOut) return { relationship: "pending_out", relevance: 2, label: "Invitation sent" };
  if (contacted) return { relationship: "contacted", relevance: 5, label: "Previously contacted" };
  return { relationship: "none", relevance: 50, label: null };
}

// ==========================================================================
// L3 · ENGINE CONTEXT
// ==========================================================================

const MARKET_ENGINE_STALE_MS       = 5  * 60 * 1000;
const MARKET_ENGINE_UNAVAILABLE_MS = 30 * 60 * 1000;

function getMarketEngineContext() {
  var snapshot = window.goodsbarnxLastReplenishmentSnapshot || null;
  if (!snapshot || !Array.isArray(snapshot.rows)) {
    return { source: "unavailable", freshnessMs: null, highCount: 0, depletingCount: 0, totalSignals: 0 };
  }
  var updatedAt = snapshot.generatedAt || null;
  var freshnessMs = updatedAt ? (Date.now() - new Date(updatedAt).getTime()) : null;
  var source = "engine";
  if (freshnessMs == null || freshnessMs > MARKET_ENGINE_UNAVAILABLE_MS) source = "unavailable";
  else if (freshnessMs > MARKET_ENGINE_STALE_MS) source = "stale";

  var highCount = 0, depletingCount = 0;
  var seenProducts = Object.create(null);
  (snapshot.rows || []).forEach(function (r) {
    if (r.urgency === "HIGH") highCount++;
    if ((r.signal_type || "").indexOf("RESTOCK") !== -1 && r.product_id && !seenProducts[r.product_id]) {
      depletingCount++;
      seenProducts[r.product_id] = true;
    }
  });
  return { source: source, freshnessMs: freshnessMs, highCount: highCount, depletingCount: depletingCount, totalSignals: (snapshot.rows || []).length };
}

// ==========================================================================
// D36 — distributor_view emission (V-E: UUID-guarded, session-throttled)
// ==========================================================================

const __gbxMarketDistributorViewSeen = Object.create(null);
function emitDistributorView(distributorId) {
  if (!isValidUuid(distributorId)) return;
  if (__gbxMarketDistributorViewSeen[distributorId]) return;
  __gbxMarketDistributorViewSeen[distributorId] = true;

  if (typeof window.goodsbarnxBehaviourTrack !== "function") {
    if (!__gbxMarketWarnedTargets["behaviour_track"]) {
      __gbxMarketWarnedTargets["behaviour_track"] = true;
      console.warn("[GoodsbarnX/market] goodsbarnxBehaviourTrack unavailable; distributor_view not emitted.");
    }
    return;
  }
  window.goodsbarnxBehaviourTrack(
    "distributor_view",
    { distributor_id: distributorId },
    { source: "market_card" },
    "market"
  );
}

// ==========================================================================
// D33 — inquiry-count ring (unchanged)
// ==========================================================================

const ROLLING_CAP = 50;
function updateInquiryCountRing(count) {
  const ringFg = document.querySelector("#screen-market .seal-ring .fg");
  const ringText = document.getElementById("inquiry-count-ring");
  const c = Number.isFinite(Number(count)) ? Number(count) : 0;
  const ratio = ROLLING_CAP > 0 ? Math.min(1, c / ROLLING_CAP) : 0;
  if (ringFg) {
    const dashArray = 150;
    const offset = dashArray * (1 - ratio);
    ringFg.setAttribute("stroke-dashoffset", String(Math.round(offset * 100) / 100));
  }
  if (ringText) ringText.innerText = c === 0 ? "0" : String(c);
}

// ==========================================================================
// LOAD (V-B: buyer roster never loaded for non-distributors)
// ==========================================================================

async function loadDistributorsAndBuyers() {
  console.log("[GoodsbarnX/market] loading marketplace...");

  if (!window.sb || typeof window.sb.from !== "function") {
    console.error("[GoodsbarnX/market] Supabase client unavailable.");
    return;
  }

  try {
    const { data: distributors, error: distError } = await sb
      .from("distributor_profiles")
      .select("id, business_name, location, market, category, verification_tier, profiles(phone)");
    if (distError) {
      console.error("[GoodsbarnX/market] error loading distributors:", distError);
    } else if (Array.isArray(distributors)) {
      allDistributors = distributors.filter(function (d) { return d && isValidUuid(d.id); });
      const statEl = document.getElementById("stat-distributors");
      if (statEl) statEl.innerText = allDistributors.length;
      const countEl = document.getElementById("distributor-count");
      if (countEl) countEl.innerText = allDistributors.length;
    }

    const viewerIsDistributor = currentUser && currentUser.role === "distributor";

    // V-B: buyer roster is only loaded for distributors. For everyone else,
    // the global stays empty and renderBuyers() refuses to render it (also
    // guarded at the render layer below).
    if (viewerIsDistributor) {
      const { data: buyers, error: buyerError } = await sb
        .from("buyer_profiles")
        .select("id, name, location, market, looking_for, profiles(full_name, phone)");
      if (buyerError) {
        console.error("[GoodsbarnX/market] error loading buyers:", buyerError);
      } else if (Array.isArray(buyers)) {
        allBuyers = buyers.filter(function (b) { return b && isValidUuid(b.id); });
        const statEl = document.getElementById("stat-buyers");
        if (statEl) statEl.innerText = allBuyers.length;
        const countEl = document.getElementById("buyer-count");
        if (countEl) countEl.innerText = allBuyers.length;
      }
    } else {
      allBuyers = [];
    }

    const { count, error: inquiryError } = await sb
      .from("inquiries").select("*", { count: "exact", head: true });
    if (!inquiryError) updateInquiryCountRing(count);

    if (!__gbxMarketGraph.loaded) await loadMarketGraph();

    if (viewerIsDistributor) {
      await loadPendingRequests();
      await updateNetworkLinks();
    }

    applyFilters();
    await updateStats();
  } catch (error) {
    console.error("[GoodsbarnX/market] loadDistributorsAndBuyers failed:", error);
  }
}

// ==========================================================================
// PENDING REQUESTS (unchanged)
// ==========================================================================

async function loadPendingRequests() {
  if (!currentUser || !window.sb) return;
  try {
    const { data: buyerRequests, error: buyerReqError } = await sb
      .from("trade_relationships").select("id, buyer_id, status, created_at")
      .eq("distributor_id", currentUser.id).eq("status", "pending");
    if (!buyerReqError && Array.isArray(buyerRequests)) {
      const badge = document.getElementById("buyer-requests-count");
      if (badge) badge.textContent = buyerRequests.length;
      const attentionBadge = document.querySelector(".attention-item .badge.buyer");
      if (attentionBadge) attentionBadge.textContent = buyerRequests.length;
    }
    const { data: agentRequests, error: agentReqError } = await sb
      .from("agent_distributor_attachments").select("id, agent_id, status, created_at")
      .eq("distributor_id", currentUser.id).eq("status", "pending");
    if (!agentReqError && Array.isArray(agentRequests)) {
      const badge = document.getElementById("agent-requests-count");
      if (badge) badge.textContent = agentRequests.length;
      const attentionBadge = document.querySelector(".attention-item .badge.agent");
      if (attentionBadge) attentionBadge.textContent = agentRequests.length;
    }
    const { data: pendingInquiries, error: inquiryError } = await sb
      .from("inquiries").select("id, status")
      .eq("distributor_id", currentUser.id).eq("status", "pending");
    if (!inquiryError && Array.isArray(pendingInquiries)) {
      const badge = document.getElementById("unanswered-inquiries-count");
      if (badge) badge.textContent = pendingInquiries.length;
      const attentionBadge = document.querySelector(".attention-item .badge.urgent");
      if (attentionBadge) attentionBadge.textContent = pendingInquiries.length;
    }
  } catch (error) {
    console.error("[GoodsbarnX/market] loadPendingRequests failed:", error);
  }
}

// ==========================================================================
// NETWORK LINKS (unchanged)
// ==========================================================================

async function updateNetworkLinks() {
  if (!currentUser || !window.sb) return;
  try {
    const { data: relationships, error: relError } = await sb
      .from("trade_relationships").select("id, buyer_id, status")
      .eq("distributor_id", currentUser.id);
    if (!relError && Array.isArray(relationships)) {
      const buckets = { pending: 0, active: 0, paused: 0, released: 0, suspended: 0, terminated: 0 };
      let other = 0;
      relationships.forEach(function (r) {
        const s = String(r.status || "").toLowerCase();
        if (Object.prototype.hasOwnProperty.call(buckets, s)) buckets[s]++;
        else other++;
      });
      const countEl = document.getElementById("my-buyers-count");
      if (countEl) countEl.textContent = relationships.length;
      const parts = [];
      ["active", "pending", "paused", "suspended", "released", "terminated"].forEach(function (k) {
        if (buckets[k] > 0) parts.push(buckets[k] + " " + k);
      });
      if (other > 0) parts.push(other + " other");
      if (!parts.length) parts.push("none yet");
      const subEl = document.getElementById("my-buyers-sub");
      if (subEl) subEl.textContent = parts.join(" · ");
    }
    const { data: agents, error: agentError } = await sb
      .from("agent_distributor_attachments").select("id, agent_id, status")
      .eq("distributor_id", currentUser.id).eq("status", "accepted");
    if (!agentError && Array.isArray(agents)) {
      const countEl = document.getElementById("my-agents-count");
      if (countEl) countEl.textContent = agents.length;
      const subEl = document.getElementById("my-agents-sub");
      if (subEl) subEl.textContent = agents.length + " active · 0 pending";
    }
  } catch (error) {
    console.error("[GoodsbarnX/market] updateNetworkLinks failed:", error);
  }
}

// ==========================================================================
// STATS (V-B: buyer count only written for distributors)
// ==========================================================================

async function updateStats() {
  if (!window.sb) return;
  try {
    const { count: distributorCount, error: distError } = await sb
      .from("distributor_profiles").select("*", { count: "exact", head: true });
    if (!distError) {
      const statEl = document.getElementById("stat-distributors");
      if (statEl) statEl.textContent = distributorCount || 0;
    }
    if (currentUser && currentUser.role === "distributor") {
      const { count: buyerCount, error: buyerError } = await sb
        .from("buyer_profiles").select("*", { count: "exact", head: true });
      if (!buyerError) {
        const statEl = document.getElementById("stat-buyers");
        if (statEl) statEl.textContent = buyerCount || 0;
      }
    }
  } catch (error) {
    console.error("[GoodsbarnX/market] updateStats failed:", error);
  }
}

// ==========================================================================
// FILTERS + RELEVANCE SORT
// ==========================================================================

function applyFilters() {
  const searchEl = document.getElementById("search-input");
  const locEl    = document.getElementById("filter-location");
  const tierEl   = document.getElementById("filter-tier");

  const q  = searchEl ? searchEl.value.trim().toLowerCase() : "";
  const lf = locEl    ? (locEl.value || "") : "";
  const tf = tierEl   ? (tierEl.value || "") : "";

  const fd = allDistributors.filter(function (d) {
    const matchCategory = activeCategory === "All" || (d.category || "").trim() === activeCategory;
    const haystack = [d.business_name || "", d.location || "", d.market || "", d.category || ""].join(" ").toLowerCase();
    const matchSearch = !q || haystack.indexOf(q) !== -1;
    const matchLocation = !lf || (d.location || "").toLowerCase() === lf.toLowerCase();
    const matchTier = !tf || (d.verification_tier || "").toLowerCase() === tf.toLowerCase();
    return matchCategory && matchSearch && matchLocation && matchTier;
  });
  fd.sort(function (a, b) {
    return enrichDistributorForViewer(a).relevance - enrichDistributorForViewer(b).relevance;
  });

  const fb = allBuyers.filter(function (b) {
    const name = b.name || (b.profiles && b.profiles.full_name) || "";
    const matchCategory = activeCategory === "All" || (b.looking_for || "").trim() === activeCategory;
    const haystack = [name, b.location || "", b.market || "", b.looking_for || ""].join(" ").toLowerCase();
    const matchSearch = !q || haystack.indexOf(q) !== -1;
    const matchLocation = !lf || (b.location || "").toLowerCase() === lf.toLowerCase();
    return matchCategory && matchSearch && matchLocation;
  });
  fb.sort(function (a, b) {
    return enrichBuyerForViewer(a).relevance - enrichBuyerForViewer(b).relevance;
  });

  renderDistributors(fd);
  renderBuyers(fb);

  const distCountEl = document.getElementById("distributor-count");
  if (distCountEl) distCountEl.innerText = fd.length;
  const buyerCountEl = document.getElementById("buyer-count");
  if (buyerCountEl && currentUser && currentUser.role === "distributor") buyerCountEl.innerText = fb.length;
}

// ==========================================================================
// L4 · RENDER — distributor composition
// ==========================================================================

function renderDistributors(list) {
  const container = document.getElementById("distributor-list");
  if (!container) { warnMissingTarget("distributor-list"); return; }

  const engineCtx = getMarketEngineContext();

  let networkHtml = "";
  let listForRest = list;
  if (currentUser && currentUser.role === "buyer") {
    const inNetwork = list.filter(function (d) { return enrichDistributorForViewer(d).relationship !== "none"; });
    listForRest = list.filter(function (d) { return enrichDistributorForViewer(d).relationship === "none"; });
    networkHtml = renderNetworkStrip(inNetwork, engineCtx);
  } else {
    networkHtml = renderEngineStrip(engineCtx);
  }

  if (!Array.isArray(listForRest) || listForRest.length === 0) {
    container.innerHTML = networkHtml +
      '<div class="empty-state-illustration">' +
        '<div class="icon">' + MARKET_ICON_SVG + '</div>' +
        '<div class="title">No distributors found</div>' +
        '<div class="sub">Check back later or adjust your filters</div>' +
      '</div>';
    return;
  }

  const cardsHtml = listForRest.map(function (d) { return renderDistributorCard(d); }).join("");
  container.innerHTML = networkHtml + cardsHtml;
}

/**
 * The professional market SVG — replaces every emoji in this file.
 * Same shape as the nav-bar version so the app is internally consistent.
 */
const MARKET_ICON_SVG =
  '<svg class="gbx-icon-market" width="40" height="40" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
    '<path d="M2.5 7.5h15l-1.2 8.2a1 1 0 0 1-1 .8H4.7a1 1 0 0 1-1-.8L2.5 7.5z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>' +
    '<path d="M7 7.5V5a3 3 0 0 1 6 0v2.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>' +
    '<path d="M2.5 7.5h15" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>' +
  '</svg>';

const BUYER_ICON_SVG =
  '<svg class="gbx-icon-market" width="40" height="40" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
    '<circle cx="10" cy="7" r="3" stroke="currentColor" stroke-width="1.4"/>' +
    '<path d="M3.5 16.5c0-3.6 2.9-5.5 6.5-5.5s6.5 1.9 6.5 5.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>' +
  '</svg>';

function renderNetworkStrip(inNetwork, engineCtx) {
  var html = "";
  if (inNetwork.length > 0) {
    var pills = inNetwork.map(function (d) {
      var e = enrichDistributorForViewer(d);
      // V-A: data-* attributes only. No inline onclick.
      return (
        '<button type="button" class="market-network-pill" ' +
          'data-market-action="open-storefront" ' +
          'data-distributor-id="' + escAttr(d.id) + '" ' +
          'data-status="' + escAttr(e.relationship) + '">' +
          '<span class="market-network-pill-name">' + escHtml(d.business_name || "Distributor") + '</span>' +
          (e.label ? '<span class="market-network-pill-label">' + escHtml(e.label) + '</span>' : "") +
        '</button>'
      );
    }).join("");

    html +=
      '<div class="market-network-strip">' +
        '<div class="market-network-kicker">YOUR NETWORK · ' + inNetwork.length + '</div>' +
        '<div class="market-network-pills">' + pills + '</div>' +
      '</div>';
  }
  html += renderEngineStrip(engineCtx);
  return html;
}

function renderEngineStrip(engineCtx) {
  if (!engineCtx || engineCtx.source === "unavailable") return "";
  if (!engineCtx.highCount && !engineCtx.depletingCount) return "";
  var parts = [];
  if (engineCtx.highCount > 0) parts.push(engineCtx.highCount + " high-urgency signal" + (engineCtx.highCount === 1 ? "" : "s"));
  if (engineCtx.depletingCount > 0) parts.push(engineCtx.depletingCount + " depleting product" + (engineCtx.depletingCount === 1 ? "" : "s"));
  var ageLabel = engineCtx.freshnessMs != null ? " · updated " + formatMarketAge(engineCtx.freshnessMs) + " ago" : "";
  return (
    '<div class="market-engine-strip">' +
      '<span class="market-engine-dot"></span>' +
      '<span class="market-engine-copy">' + parts.join(" · ") + ageLabel + '</span>' +
    '</div>'
  );
}

function formatMarketAge(ms) {
  if (ms == null) return "";
  var m = Math.floor(ms / 60000);
  if (m < 1) return "<1m";
  if (m < 60) return m + "m";
  var h = Math.floor(m / 60);
  if (h < 24) return h + "h";
  return Math.floor(h / 24) + "d";
}

function renderDistributorCard(d) {
  const tier = d.verification_tier || "";
  let verifiedBadge = "";
  if (tier === "association") verifiedBadge = '<div class="m-verified">✓ Association Verified</div>';
  else if (tier === "market board") verifiedBadge = '<div class="m-verified market-board">✓ Market Board Verified</div>';
  else if (tier === "self-attested") verifiedBadge = '<div class="m-verified self-attested">Self-Attested</div>';

  const enrichment = enrichDistributorForViewer(d);
  let relBadge = "";
  if (enrichment.label) {
    relBadge = '<div class="market-rel-badge" data-status="' + escAttr(enrichment.relationship) + '">' +
      escHtml(enrichment.label) + '</div>';
  }

  const phone = (d.profiles && d.profiles.phone) || "";
  const isFavourite = userFavourites && typeof userFavourites.has === "function" ? userFavourites.has(d.id) : false;

  // V-A: no inline onclick. Every button carries data-market-action.
  return (
    '<div class="manifest" data-distributor-id="' + escAttr(d.id) + '">' +
      '<div class="manifest-top">' +
        '<div>' +
          '<div class="m-name">' + escHtml(d.business_name || "Distributor") + '</div>' +
          '<div class="m-loc">' + escHtml(d.location || "") +
            (d.market ? " · " + escHtml(d.market) : "") +
          '</div>' +
          relBadge + verifiedBadge +
        '</div>' +
        '<div style="display:flex; align-items:flex-start; gap:8px;">' +
          '<button class="fav-btn" data-market-action="toggle-favourite" data-distributor-id="' + escAttr(d.id) + '" aria-label="Toggle favourite">' +
            '<span data-fav-for="' + escAttr(d.id) + '">' + (isFavourite ? "❤️" : "🤍") + '</span>' +
          '</button>' +
          '<div class="stamp-badge">' + escHtml((d.category || "LISTED").toUpperCase()) + '</div>' +
        '</div>' +
      '</div>' +
      '<div class="m-meta">' +
        (phone && isValidNgPhone(phone)
          ? '<button class="btn btn-whatsapp" data-market-action="whatsapp" data-distributor-id="' + escAttr(d.id) + '">WhatsApp</button>'
          : "") +
        '<button class="btn btn-outline" data-market-action="open-storefront" data-distributor-id="' + escAttr(d.id) + '">Storefront</button>' +
        '<button class="btn btn-primary" data-market-action="inquire" data-distributor-id="' + escAttr(d.id) + '">Inquire</button>' +
      '</div>' +
      '<div class="dispute-row">' +
        '<span class="dispute-link" data-market-action="dispute" data-distributor-id="' + escAttr(d.id) + '">Report an issue</span>' +
      '</div>' +
    '</div>'
  );
}

// ==========================================================================
// L4 · RENDER — buyers (V-B: double-guarded)
// ==========================================================================

function renderBuyers(list) {
  const container = document.getElementById("buyer-list");
  if (!container) { warnMissingTarget("buyer-list"); return; }

  // V-B guard 1: only distributors can see the buyer roster.
  if (!currentUser || currentUser.role !== "distributor") {
    container.style.display = "none";
    container.innerHTML = "";
    const label = document.querySelector("#screen-market .section-label:has(+ #buyer-list)");
    if (label) label.style.display = "none";
    return;
  }
  container.style.display = "";

  if (!Array.isArray(list) || list.length === 0) {
    container.innerHTML =
      '<div class="empty-state-illustration">' +
        '<div class="icon">' + BUYER_ICON_SVG + '</div>' +
        '<div class="title">No buyers found</div>' +
        '<div class="sub">Start by inviting buyers to your network</div>' +
      '</div>';
    return;
  }

  container.innerHTML = list.map(function (b) {
    const name  = b.name || (b.profiles && b.profiles.full_name) || "Buyer";
    const phone = (b.profiles && b.profiles.phone) || "";
    const enrichment = enrichBuyerForViewer(b);

    const relBadge = enrichment.label
      ? '<div class="market-rel-badge" data-status="' + escAttr(enrichment.relationship) + '">' + escHtml(enrichment.label) + '</div>'
      : "";

    const inviteBtn = (enrichment.relationship === "none")
      ? '<button class="btn btn-primary" data-market-action="invite-buyer">Invite</button>'
      : "";

    return (
      '<div class="manifest" data-buyer-id="' + escAttr(b.id) + '">' +
        '<div class="manifest-top">' +
          '<div>' +
            '<div class="m-name">' + escHtml(name) + '</div>' +
            '<div class="m-loc">' + escHtml(b.location || "") +
              (b.market ? " · " + escHtml(b.market) : "") +
            '</div>' +
            relBadge +
          '</div>' +
          '<div class="stamp-badge" style="border-color:var(--brass); color:var(--brass);">' + escHtml((b.looking_for || "BUYER").toUpperCase()) + '</div>' +
        '</div>' +
        '<div class="m-meta">' +
          (phone && isValidNgPhone(phone)
            ? '<button class="btn btn-whatsapp" data-market-action="whatsapp" data-buyer-id="' + escAttr(b.id) + '">WhatsApp</button>'
            : "") +
          inviteBtn +
          '<button class="btn btn-primary" data-market-action="inquire-buyer" data-buyer-id="' + escAttr(b.id) + '">Inquire</button>' +
        '</div>' +
      '</div>'
    );
  }).join("");
}

// ==========================================================================
// L5 · INTERACTION — delegated event handler (V-A)
// ==========================================================================

/**
 * Single delegated click handler for #screen-market. Every interactive
 * element carries a data-market-action attribute. This replaces all
 * inline onclick handlers, which were the stored-XSS surface (V-A).
 *
 * The handler is attached exactly once per session via bindMarketEvents().
 */
async function handleMarketClick(e) {
  var t = e.target.closest("[data-market-action]");
  if (!t) return;

  var action = t.getAttribute("data-market-action");
  var distId = t.getAttribute("data-distributor-id");
  var buyerId = t.getAttribute("data-buyer-id");

  // V-C: validate before dispatch.
  if (action === "open-storefront" || action === "inquire" || action === "whatsapp" ||
      action === "dispute" || action === "toggle-favourite") {
    if (!isValidUuid(distId)) return;
  }
  if (action === "inquire-buyer" || action === "whatsapp-buyer") {
    if (!isValidUuid(buyerId)) return;
  }

  if (action === "open-storefront") {
    e.preventDefault();
    marketOpenDistributorContext(distId, "storefront");
    return;
  }
  if (action === "inquire") {
    e.preventDefault();
    var distName = distNameFor(distId);
    marketOpenDistributorContext(distId, "inquire", distName);
    return;
  }
  if (action === "whatsapp") {
    e.preventDefault();
    var phone = phoneForDistributor(distId);
    var name  = distNameFor(distId);
    if (phone) openWhatsApp(phone, name);
    return;
  }
  if (action === "dispute") {
    e.preventDefault();
    var name2 = distNameFor(distId);
    if (typeof openDisputeModal === "function") openDisputeModal(distId, name2);
    return;
  }
  if (action === "toggle-favourite") {
    e.preventDefault();
    if (typeof toggleFavourite === "function") toggleFavourite(e, distId);
    return;
  }
  if (action === "invite-buyer") {
    e.preventDefault();
    if (typeof openInviteBuyerModal === "function") openInviteBuyerModal();
    return;
  }
  if (action === "inquire-buyer") {
    e.preventDefault();
    var bName = buyerNameFor(buyerId);
    if (typeof openModal === "function") openModal(buyerId, bName, "buyer");
    return;
  }
}

function distNameFor(distId) {
  var d = allDistributors.find(function (x) { return x && x.id === distId; });
  return (d && d.business_name) || "Distributor";
}
function phoneForDistributor(distId) {
  var d = allDistributors.find(function (x) { return x && x.id === distId; });
  return (d && d.profiles && d.profiles.phone) || "";
}
function buyerNameFor(buyerId) {
  var b = allBuyers.find(function (x) { return x && x.id === buyerId; });
  return (b && (b.name || (b.profiles && b.profiles.full_name))) || "Buyer";
}

function bindMarketEvents() {
  var screen = document.getElementById("screen-market");
  if (!screen) { warnMissingTarget("screen-market"); return; }
  if (screen.__marketBound) return;
  screen.__marketBound = true;
  screen.addEventListener("click", handleMarketClick);
}

// ==========================================================================
// marketOpenDistributorContext — V-C validated
// ==========================================================================

function marketOpenDistributorContext(distributorId, action, distributorName) {
  if (!isValidUuid(distributorId)) {
    console.warn("[GoodsbarnX/market] rejected non-UUID distributor id");
    return;
  }
  emitDistributorView(distributorId);

  if (action === "storefront") {
    if (typeof openStorefrontModal === "function") openStorefrontModal(distributorId);
  } else if (action === "inquire") {
    if (typeof openModal === "function") openModal(distributorId, distributorName || "Distributor", "distributor");
  }
}

// ==========================================================================
// openWhatsApp — V-D validated
// ==========================================================================

function openWhatsApp(phone, name) {
  var digits = String(phone || "").replace(/\D/g, "");
  if (!__MARKET_NG_PHONE_RE.test(digits)) {
    console.warn("[GoodsbarnX/market] rejected invalid phone number");
    return;
  }
  var safeName = String(name || "").replace(/[\u0000-\u001F\u007F-\u009F]/g, "").slice(0, 40);
  var text = "Hi " + safeName + ", I found you on GoodsbarnX.";
  window.open("https://wa.me/" + digits + "?text=" + encodeURIComponent(text), "_blank");
}

// ==========================================================================
// SCREEN LOADER
// ==========================================================================

(function registerMarketScreen() {
  if (typeof registerScreenLoader !== "function") {
    console.warn("[GoodsbarnX/market] registerScreenLoader unavailable; market screen has no loader.");
    return;
  }
  registerScreenLoader("market", async function marketLoader() {
    bindMarketEvents();
    await loadDistributorsAndBuyers();
    await updateStats();
  });
})();

// Bind immediately on any path that isn't going through the screen loader
// (e.g. if the market screen is already visible on first paint).
if (typeof window !== "undefined") {
  if (document.readyState === "complete" || document.readyState === "interactive") {
    setTimeout(bindMarketEvents, 0);
  } else {
    window.addEventListener("DOMContentLoaded", bindMarketEvents);
  }
}

// ==========================================================================
// GLOBAL EXPORTS
// ==========================================================================

window.loadDistributorsAndBuyers = loadDistributorsAndBuyers;
window.applyFilters = applyFilters;
window.updateStats = updateStats;
window.renderDistributors = renderDistributors;
window.renderBuyers = renderBuyers;
window.openWhatsApp = openWhatsApp;
window.marketOpenDistributorContext = marketOpenDistributorContext;
window.updateInquiryCountRing = updateInquiryCountRing;

console.log("[GoodsbarnX] market.js loaded (V1.8.2.6 rev.6 · Relationship-first + Security-hardened)");
