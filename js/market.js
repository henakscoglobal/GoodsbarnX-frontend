// ==========================================================================
// GoodsbarnX — market.js  (rev. 5 · Relationship-first Market)
// Plain global script. Loads fourth (Canon §10).
//
// This is not a directory. It is the buyer's relationship-graph reflection
// of the marketplace. Active relationships surface first. Pending
// invitations carry directionality (inbound vs outbound). The depleting-
// stock engine signal is a strip above the listings, not a console below.
// The buyer roster is role-scoped: only distributors see buyers.
//
// Layers:
//   L1 · RELATIONSHIP GRAPH      per-session cache of the viewer's relationships
//   L2 · ENRICHMENT              per-distributor: status, relevance, direction
//   L3 · ENGINE CONTEXT          reads window.goodsbarnxLastReplenishmentSnapshot
//   L4 · RENDER                  light sectioning: "Your network" + flat list
//   L5 · INTERACTION             delegated + original handlers preserved
//
// Backward compatibility (do not break):
//   - loadDistributorsAndBuyers()      same signature
//   - applyFilters(), renderDistributors(), renderBuyers(), updateStats()
//     all preserved with the same public behaviour
//   - marketOpenDistributorContext(), openWhatsApp() unchanged
//   - updateInquiryCountRing(), emitDistributorView() unchanged
//   - all filter inputs in index.html continue to work identically
//   - all card onclick handlers preserved
//   - allDistributors / allBuyers globals still populated (same shapes)
//
// Role-scoped visibility (Q1 answer):
//   - distributor: sees distributors + buyers (with "Invite" on buyer cards)
//   - buyer:       sees distributors only; buyer roster is not loaded
//   - agent:       sees distributors only; buyer roster is not loaded
//   - guest:       sees distributors only; buyer roster is not loaded
// ==========================================================================

function escHtml(v) {
  return String(v == null ? "" : v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
function escAttr(v) { return escHtml(v); }

const __gbxMarketWarnedTargets = Object.create(null);
function warnMissingTarget(id) {
  if (__gbxMarketWarnedTargets[id]) return;
  __gbxMarketWarnedTargets[id] = true;
  console.warn("[GoodsbarnX/market] DOM target #" + id + " is missing from index.html.");
}

// --------------------------------------------------------------------------
// L1 · RELATIONSHIP GRAPH  (per-session cache)
// --------------------------------------------------------------------------

const __gbxMarketGraph = {
  viewerRole: "guest",
  myRelationships: [],     // [{distributor_id, status, is_primary, since}]
  myPendingInbound: [],    // [{distributor_id, created_at}] — buyer_locks awaiting my accept (buyer view)
  myPendingOutbound: [],   // [{distributor_id, created_at}] — buyer_locks I initiated (distributor view: pending, buyer view: pending on my side)
  contactedSet: new Set(), // distributor_ids the viewer has touched (any inquiry ever)
  loaded: false
};

/**
 * Populate the relationship graph for the current viewer.
 * Idempotent within a session — call once on auth-state-changed or on load.
 *
 * Role-specific queries:
 *   buyer:        trade_relationships WHERE buyer_id = me
 *                 buyer_locks WHERE buyer_id = me AND status = 'pending_consent'
 *   distributor:  trade_relationships WHERE distributor_id = me
 *                 buyer_locks WHERE distributor_id = me AND status = 'pending_consent'
 *                 inquiries WHERE distributor_id = me (populates contactedSet for buyer cards)
 *   other/guest:  empty graph
 */
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
      (rels.data || []).forEach(r => {
        __gbxMarketGraph.myRelationships.push({
          distributor_id: r.distributor_id,
          status: String(r.status || "").toLowerCase(),
          is_primary: !!r.is_primary,
          since: r.relationship_started_at || r.created_at || null
        });
      });
      (locks.data || []).forEach(l => {
        __gbxMarketGraph.myPendingInbound.push({
          distributor_id: l.distributor_id,
          created_at: l.created_at
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
      (rels.data || []).forEach(r => {
        // For distributor view, we key by buyer_id, not distributor_id.
        // Enrichment for distributor cards uses this same array but checks
        // against distributor_id, so this pushes only serve buyer-card
        // enrichment. See enrichDistributorForViewer() for details.
        __gbxMarketGraph.myRelationships.push({
          buyer_id: r.buyer_id,
          distributor_id: null,
          status: String(r.status || "").toLowerCase(),
          is_primary: !!r.is_primary,
          since: r.relationship_started_at || r.created_at || null
        });
      });
      (locks.data || []).forEach(l => {
        __gbxMarketGraph.myPendingOutbound.push({
          buyer_id: l.buyer_id,
          created_at: l.created_at
        });
      });
      (inq.data || []).forEach(x => {
        if (x.buyer_id) __gbxMarketGraph.contactedSet.add(x.buyer_id);
      });
    }
  } catch (err) {
    console.warn("[GoodsbarnX/market] loadMarketGraph failed:", err && err.message);
  }

  __gbxMarketGraph.loaded = true;
}

// --------------------------------------------------------------------------
// L2 · ENRICHMENT  (per-distributor, per-viewer)
// --------------------------------------------------------------------------

/**
 * enrichDistributorForViewer(dist) → returns {relationship, relevance, label}
 * where:
 *   relationship  = "active" | "pending_in" | "pending_out" | "paused" |
 *                   "suspended" | "released" | "terminated" | "none"
 *   relevance     = numeric priority, lower = more relevant
 *   label         = display string for the badge, or null
 *
 * Called for every distributor on render. Pure function of the cache.
 */
function enrichDistributorForViewer(dist) {
  var viewerRole = __gbxMarketGraph.viewerRole;

  if (viewerRole !== "buyer") {
    // Distributors / agents / guests do not have buyer relationship contexts
    // on the market screen. Return a neutral relevance based on category.
    return {
      relationship: "none",
      relevance: 100,
      label: null
    };
  }

  // Buyer: check graph
  var rel = __gbxMarketGraph.myRelationships.find(r => r.distributor_id === dist.id);
  var pendingIn = __gbxMarketGraph.myPendingInbound.find(p => p.distributor_id === dist.id);

  if (rel) {
    if (rel.status === "active") {
      return {
        relationship: "active",
        relevance: rel.is_primary ? 0 : 1,
        label: rel.is_primary ? "Primary relationship" : "Active relationship"
      };
    }
    if (rel.status === "paused") return { relationship: "paused", relevance: 5, label: "Relationship paused" };
    if (rel.status === "suspended") return { relationship: "suspended", relevance: 6, label: "Relationship suspended" };
    if (rel.status === "released") return { relationship: "released", relevance: 7, label: "Released — rekindle" };
    if (rel.status === "terminated") return { relationship: "terminated", relevance: 8, label: "Terminated — rekindle" };
  }

  if (pendingIn) {
    return { relationship: "pending_in", relevance: 2, label: "Wants to connect" };
  }

  // No relationship, no pending. Fall through to category relevance.
  return { relationship: "none", relevance: 50, label: null };
}

/**
 * Relevance for a distributor in a distributor-viewer session.
 * Distributors see other distributors for benchmarking / co-trade, so
 * relationship status does not apply, but category match does.
 */
function relevanceForDistributor(dist, viewerCategory) {
  if (!viewerCategory) return 50;
  if ((dist.category || "").trim() === viewerCategory) return 40;
  return 60;
}

/**
 * Relevance for a buyer, in a distributor-viewer session.
 * - Active relationships first (with is_primary preference)
 * - Pending outbound (I invited, they haven't responded)
 * - Contacted (any inquiry ever)
 * - No relationship
 */
function enrichBuyerForViewer(buyer) {
  var rel = __gbxMarketGraph.myRelationships.find(r => r.buyer_id === buyer.id);
  var pendingOut = __gbxMarketGraph.myPendingOutbound.find(p => p.buyer_id === buyer.id);
  var contacted = __gbxMarketGraph.contactedSet.has(buyer.id);

  if (rel && rel.status === "active") {
    return {
      relationship: "active",
      relevance: rel.is_primary ? 0 : 1,
      label: rel.is_primary ? "Primary relationship" : "Active relationship",
      actionable: false
    };
  }
  if (pendingOut) {
    return { relationship: "pending_out", relevance: 2, label: "Invitation sent", actionable: false };
  }
  if (contacted) {
    return { relationship: "contacted", relevance: 5, label: "Previously contacted", actionable: false };
  }
  return { relationship: "none", relevance: 50, label: null, actionable: true };
}

// --------------------------------------------------------------------------
// L3 · ENGINE CONTEXT  (reads the same source as cart + storefront)
// --------------------------------------------------------------------------

const MARKET_ENGINE_STALE_MS       = 5  * 60 * 1000;
const MARKET_ENGINE_UNAVAILABLE_MS = 30 * 60 * 1000;

/**
 * Aggregate the replenishment snapshot into a market-level summary.
 * Returns { source, freshnessMs, highCount, depletingCount, categoryCounts }.
 * Never fabricates. If snapshot is absent or stale, source = "unavailable".
 */
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
  return {
    source: source,
    freshnessMs: freshnessMs,
    highCount: highCount,
    depletingCount: depletingCount,
    totalSignals: (snapshot.rows || []).length
  };
}

// --------------------------------------------------------------------------
// D36 — BOUNDED distributor_view EMISSION
// --------------------------------------------------------------------------

const __gbxMarketDistributorViewSeen = Object.create(null);
function emitDistributorView(distributorId) {
  if (!distributorId) return;
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

// --------------------------------------------------------------------------
// D33 — INQUIRY-COUNT RING
// --------------------------------------------------------------------------

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
  if (ringText) {
    ringText.innerText = c === 0 ? "0" : String(c);
  }
}

// --------------------------------------------------------------------------
// LOAD DISTRIBUTORS AND BUYERS
// Role-scoped (Q1 answer): buyer roster only loaded for distributors.
// --------------------------------------------------------------------------

async function loadDistributorsAndBuyers() {
  console.log("[GoodsbarnX/market] loading marketplace...");

  if (!window.sb || typeof window.sb.from !== "function") {
    console.error("[GoodsbarnX/market] Supabase client unavailable.");
    return;
  }

  try {
    // Distributors — everyone sees them.
    const { data: distributors, error: distError } = await sb
      .from("distributor_profiles")
      .select("id, business_name, location, market, category, verification_tier, profiles(phone)");

    if (distError) {
      console.error("[GoodsbarnX/market] error loading distributors:", distError);
    } else if (Array.isArray(distributors)) {
      allDistributors = distributors;
      const statEl = document.getElementById("stat-distributors");
      if (statEl) statEl.innerText = distributors.length;
      else warnMissingTarget("stat-distributors");
      const countEl = document.getElementById("distributor-count");
      if (countEl) countEl.innerText = distributors.length;
      else warnMissingTarget("distributor-count");
    }

    // Buyers — only distributors see them (Q1).
    const viewerIsDistributor = currentUser && currentUser.role === "distributor";
    if (viewerIsDistributor) {
      const { data: buyers, error: buyerError } = await sb
        .from("buyer_profiles")
        .select("id, name, location, market, looking_for, profiles(full_name, phone)");
      if (buyerError) {
        console.error("[GoodsbarnX/market] error loading buyers:", buyerError);
      } else if (Array.isArray(buyers)) {
        allBuyers = buyers;
        const statEl = document.getElementById("stat-buyers");
        if (statEl) statEl.innerText = buyers.length;
        else warnMissingTarget("stat-buyers");
        const countEl = document.getElementById("buyer-count");
        if (countEl) countEl.innerText = buyers.length;
        else warnMissingTarget("buyer-count");
      }
    } else {
      // Buyer / agent / guest: do not expose the roster. Set empty list so
      // renderBuyers() returns early and no buyer section renders.
      allBuyers = [];
    }

    // Inquiry count ring (global, no role leak — just a total count).
    const { count, error: inquiryError } = await sb
      .from("inquiries")
      .select("*", { count: "exact", head: true });
    if (!inquiryError) updateInquiryCountRing(count);

    // Relationship graph (once per session).
    if (!__gbxMarketGraph.loaded) {
      await loadMarketGraph();
    }

    // Distributor-only: pending requests + network counts (relationship screen data,
    // still populated here to keep parity with existing behaviour).
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

// --------------------------------------------------------------------------
// PENDING REQUESTS (unchanged)
// --------------------------------------------------------------------------

async function loadPendingRequests() {
  if (!currentUser || !window.sb) return;

  try {
    const { data: buyerRequests, error: buyerReqError } = await sb
      .from("trade_relationships")
      .select("id, buyer_id, status, created_at")
      .eq("distributor_id", currentUser.id)
      .eq("status", "pending");

    if (!buyerReqError && Array.isArray(buyerRequests)) {
      const badge = document.getElementById("buyer-requests-count");
      if (badge) badge.textContent = buyerRequests.length;
      const attentionBadge = document.querySelector(".attention-item .badge.buyer");
      if (attentionBadge) attentionBadge.textContent = buyerRequests.length;
    }

    const { data: agentRequests, error: agentReqError } = await sb
      .from("agent_distributor_attachments")
      .select("id, agent_id, status, created_at")
      .eq("distributor_id", currentUser.id)
      .eq("status", "pending");

    if (!agentReqError && Array.isArray(agentRequests)) {
      const badge = document.getElementById("agent-requests-count");
      if (badge) badge.textContent = agentRequests.length;
      const attentionBadge = document.querySelector(".attention-item .badge.agent");
      if (attentionBadge) attentionBadge.textContent = agentRequests.length;
    }

    const { data: pendingInquiries, error: inquiryError } = await sb
      .from("inquiries")
      .select("id, status")
      .eq("distributor_id", currentUser.id)
      .eq("status", "pending");

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

// --------------------------------------------------------------------------
// NETWORK LINKS (unchanged)
// --------------------------------------------------------------------------

async function updateNetworkLinks() {
  if (!currentUser || !window.sb) return;

  try {
    const { data: relationships, error: relError } = await sb
      .from("trade_relationships")
      .select("id, buyer_id, status")
      .eq("distributor_id", currentUser.id);

    if (!relError && Array.isArray(relationships)) {
      const buckets = { pending: 0, active: 0, paused: 0, released: 0, suspended: 0, terminated: 0 };
      let other = 0;
      relationships.forEach(r => {
        const s = String(r.status || "").toLowerCase();
        if (Object.prototype.hasOwnProperty.call(buckets, s)) buckets[s]++;
        else other++;
      });

      const countEl = document.getElementById("my-buyers-count");
      if (countEl) countEl.textContent = relationships.length;

      const parts = [];
      ["active", "pending", "paused", "suspended", "released", "terminated"].forEach(k => {
        if (buckets[k] > 0) parts.push(buckets[k] + " " + k);
      });
      if (other > 0) parts.push(other + " other");
      if (!parts.length) parts.push("none yet");

      const subEl = document.getElementById("my-buyers-sub");
      if (subEl) subEl.textContent = parts.join(" · ");
    }

    const { data: agents, error: agentError } = await sb
      .from("agent_distributor_attachments")
      .select("id, agent_id, status")
      .eq("distributor_id", currentUser.id)
      .eq("status", "accepted");

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

// --------------------------------------------------------------------------
// STATS (unchanged)
// --------------------------------------------------------------------------

async function updateStats() {
  if (!window.sb) return;
  try {
    const { count: buyerCount, error: buyerError } = await sb
      .from("buyer_profiles").select("*", { count: "exact", head: true });
    const { count: distributorCount, error: distError } = await sb
      .from("distributor_profiles").select("*", { count: "exact", head: true });

    if (!buyerError && currentUser && currentUser.role === "distributor") {
      const statEl = document.getElementById("stat-buyers");
      if (statEl) statEl.textContent = buyerCount || 0;
    }
    if (!distError) {
      const statEl = document.getElementById("stat-distributors");
      if (statEl) statEl.textContent = distributorCount || 0;
    }
  } catch (error) {
    console.error("[GoodsbarnX/market] updateStats failed:", error);
  }
}

// --------------------------------------------------------------------------
// FILTERS
// --------------------------------------------------------------------------

function applyFilters() {
  const searchEl = document.getElementById("search-input");
  const locEl    = document.getElementById("filter-location");
  const tierEl   = document.getElementById("filter-tier");

  const q  = searchEl ? searchEl.value.trim().toLowerCase() : "";
  const lf = locEl    ? (locEl.value || "") : "";
  const tf = tierEl   ? (tierEl.value || "") : "";

  const fd = allDistributors.filter(d => {
    const matchCategory = activeCategory === "All" || (d.category || "").trim() === activeCategory;
    const haystack = [d.business_name || "", d.location || "", d.market || "", d.category || ""]
      .join(" ").toLowerCase();
    const matchSearch = !q || haystack.indexOf(q) !== -1;
    const matchLocation = !lf || (d.location || "").toLowerCase() === lf.toLowerCase();
    const matchTier = !tf || (d.verification_tier || "").toLowerCase() === tf.toLowerCase();
    return matchCategory && matchSearch && matchLocation && matchTier;
  });

  // Relevance sort — relationship/enrichment first
  fd.sort((a, b) => {
    const ea = enrichDistributorForViewer(a);
    const eb = enrichDistributorForViewer(b);
    return ea.relevance - eb.relevance;
  });

  const fb = allBuyers.filter(b => {
    const name = b.name || (b.profiles && b.profiles.full_name) || "";
    const matchCategory = activeCategory === "All" || (b.looking_for || "").trim() === activeCategory;
    const haystack = [name, b.location || "", b.market || "", b.looking_for || ""]
      .join(" ").toLowerCase();
    const matchSearch = !q || haystack.indexOf(q) !== -1;
    const matchLocation = !lf || (b.location || "").toLowerCase() === lf.toLowerCase();
    return matchCategory && matchSearch && matchLocation;
  });

  fb.sort((a, b) => {
    const ea = enrichBuyerForViewer(a);
    const eb = enrichBuyerForViewer(b);
    return ea.relevance - eb.relevance;
  });

  renderDistributors(fd);
  renderBuyers(fb);

  const distCountEl = document.getElementById("distributor-count");
  if (distCountEl) distCountEl.innerText = fd.length;
  const buyerCountEl = document.getElementById("buyer-count");
  if (buyerCountEl) buyerCountEl.innerText = fb.length;
}

// --------------------------------------------------------------------------
// L4 · RENDER — MARKET COMPOSITION
// Light sectioning (Q2 answer): a "Your network" strip above the list.
// --------------------------------------------------------------------------

function renderDistributors(list) {
  const container = document.getElementById("distributor-list");
  if (!container) { warnMissingTarget("distributor-list"); return; }

  // Compute engine context (safe even if unavailable)
  const engineCtx = getMarketEngineContext();

  // Split "your network" vs the rest, ONLY for authenticated buyers.
  let networkHtml = "";
  let listForRest = list;
  if (currentUser && currentUser.role === "buyer") {
    const inNetwork = list.filter(d => {
      const e = enrichDistributorForViewer(d);
      return e.relationship !== "none";
    });
    listForRest = list.filter(d => {
      const e = enrichDistributorForViewer(d);
      return e.relationship === "none";
    });
    networkHtml = renderNetworkStrip(inNetwork, engineCtx);
  } else {
    networkHtml = renderEngineStrip(engineCtx);
  }

  if (!Array.isArray(listForRest) || listForRest.length === 0) {
    container.innerHTML = networkHtml +
      '<div class="empty-state-illustration">' +
        '<div class="icon">🏪</div>' +
        '<div class="title">No distributors found</div>' +
        '<div class="sub">Check back later or adjust your filters</div>' +
      '</div>';
    return;
  }

  const cardsHtml = listForRest.map(d => renderDistributorCard(d)).join("");
  container.innerHTML = networkHtml + cardsHtml;
}

/**
 * Light "Your network" strip (Q2 · option b).
 * Only for authenticated buyers with non-zero network relationships.
 * Shows each active/pending relationship as a compact pill.
 */
function renderNetworkStrip(inNetwork, engineCtx) {
  var html = "";

  // Relationship strip — only if there is something to show
  if (inNetwork.length > 0) {
    var pills = inNetwork.map(d => {
      var e = enrichDistributorForViewer(d);
      var statusClass = e.relationship;
      var safeId = escAttr(d.id);
      var safeName = escAttr(d.business_name || "Distributor");
      return (
        '<button type="button" class="market-network-pill" ' +
          'data-distributor-id="' + safeId + '" ' +
          'data-status="' + escAttr(statusClass) + '" ' +
          'onclick="marketOpenDistributorContext(this.dataset.distributorId, \'storefront\')">' +
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

  // Engine strip — under the network strip, before the flat list
  html += renderEngineStrip(engineCtx);

  return html;
}

/**
 * Engine strip — one line. Only rendered when there is real signal.
 * Never fabricates. If source is unavailable, returns empty (silence
 * is more honest than a fake urgency line).
 */
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

/**
 * One distributor card. Same DOM contract as before, with optional
 * relationship badge prepended into the verified-badge slot when the
 * viewer has a relationship with this distributor.
 */
function renderDistributorCard(d) {
  const tier = d.verification_tier || "";
  let verifiedBadge = "";
  if (tier === "association") {
    verifiedBadge = '<div class="m-verified">✓ Association Verified</div>';
  } else if (tier === "market board") {
    verifiedBadge = '<div class="m-verified market-board">✓ Market Board Verified</div>';
  } else if (tier === "self-attested") {
    verifiedBadge = '<div class="m-verified self-attested">Self-Attested</div>';
  }

  // Relationship badge (only for buyers with a relationship to this dist)
  const enrichment = enrichDistributorForViewer(d);
  let relBadge = "";
  if (enrichment.label) {
    relBadge = '<div class="market-rel-badge" data-status="' + escAttr(enrichment.relationship) + '">' +
      escHtml(enrichment.label) + '</div>';
  }

  const phone = (d.profiles && d.profiles.phone) || "";
  const isFavourite = userFavourites && typeof userFavourites.has === "function" ? userFavourites.has(d.id) : false;

  const safeId    = escAttr(d.id);
  const safeName  = escAttr(d.business_name || "Distributor");
  const safePhone = escAttr(phone);
  const safeCat   = escHtml((d.category || "LISTED").toUpperCase());

  return (
    '<div class="manifest" data-distributor-id="' + safeId + '">' +
      '<div class="manifest-top">' +
        '<div>' +
          '<div class="m-name">' + escHtml(d.business_name || "Distributor") + '</div>' +
          '<div class="m-loc">' + escHtml(d.location || "") +
            (d.market ? " · " + escHtml(d.market) : "") +
          '</div>' +
          relBadge + verifiedBadge +
        '</div>' +
        '<div style="display:flex; align-items:flex-start; gap:8px;">' +
          '<button class="fav-btn" onclick="toggleFavourite(event, \'' + safeId + '\')">' +
            '<span id="fav-' + safeId + '">' + (isFavourite ? "❤️" : "🤍") + '</span>' +
          '</button>' +
          '<div class="stamp-badge">' + safeCat + '</div>' +
        '</div>' +
      '</div>' +
      '<div class="m-meta">' +
        (phone ? '<button class="btn btn-whatsapp" onclick="openWhatsApp(\'' + safePhone + '\', \'' + safeName + '\')">WhatsApp</button>' : "") +
        '<button class="btn btn-outline" ' +
          'data-distributor-id="' + safeId + '" ' +
          'onclick="marketOpenDistributorContext(this.dataset.distributorId, \'storefront\')">Storefront</button>' +
        '<button class="btn btn-primary" ' +
          'data-distributor-id="' + safeId + '" ' +
          'onclick="marketOpenDistributorContext(this.dataset.distributorId, \'inquire\', \'' + safeName + '\')">Inquire</button>' +
      '</div>' +
      '<div class="dispute-row">' +
        '<span class="dispute-link" onclick="openDisputeModal(\'' + safeId + '\', \'' + safeName + '\')">Report an issue</span>' +
      '</div>' +
    '</div>'
  );
}

function marketOpenDistributorContext(distributorId, action, distributorName) {
  if (!distributorId) return;
  emitDistributorView(distributorId);
  if (action === "storefront") {
    if (typeof openStorefrontModal === "function") openStorefrontModal(distributorId);
  } else if (action === "inquire") {
    if (typeof openModal === "function") openModal(distributorId, distributorName || "Distributor", "distributor");
  }
}

// --------------------------------------------------------------------------
// RENDER — BUYERS (Q1: only renders when distributor viewer, roster loaded)
// --------------------------------------------------------------------------

function renderBuyers(list) {
  const container = document.getElementById("buyer-list");
  if (!container) { warnMissingTarget("buyer-list"); return; }

  // Hide buyer roster for non-distributor viewers
  if (!currentUser || currentUser.role !== "distributor") {
    container.style.display = "none";
    container.innerHTML = "";
    // Also hide the section label if present
    const label = document.querySelector('div.section-label + #buyer-list');
    if (label) label.style.display = "none";
    return;
  }
  container.style.display = "";

  if (!Array.isArray(list) || list.length === 0) {
    container.innerHTML =
      '<div class="empty-state-illustration">' +
        '<div class="icon">👤</div>' +
        '<div class="title">No buyers found</div>' +
        '<div class="sub">Start by inviting buyers to your network</div>' +
      '</div>';
    return;
  }

  container.innerHTML = list.map(b => {
    const name  = b.name || (b.profiles && b.profiles.full_name) || "Buyer";
    const phone = (b.profiles && b.profiles.phone) || "";
    const enrichment = enrichBuyerForViewer(b);

    const safeId    = escAttr(b.id);
    const safeName  = escAttr(name);
    const safePhone = escAttr(phone);
    const safeCat   = escHtml((b.looking_for || "BUYER").toUpperCase());

    const relBadge = enrichment.label
      ? '<div class="market-rel-badge" data-status="' + escAttr(enrichment.relationship) + '">' + escHtml(enrichment.label) + '</div>'
      : "";

    // Invite button only if buyer is not already in the relationship graph
    const inviteBtn = (enrichment.relationship === "none")
      ? '<button class="btn btn-primary" onclick="openInviteBuyerModal()">Invite</button>'
      : "";

    return (
      '<div class="manifest" data-buyer-id="' + safeId + '">' +
        '<div class="manifest-top">' +
          '<div>' +
            '<div class="m-name">' + escHtml(name) + '</div>' +
            '<div class="m-loc">' + escHtml(b.location || "") +
              (b.market ? " · " + escHtml(b.market) : "") +
            '</div>' +
            relBadge +
          '</div>' +
          '<div class="stamp-badge" style="border-color:var(--brass); color:var(--brass);">' + safeCat + '</div>' +
        '</div>' +
        '<div class="m-meta">' +
          (phone ? '<button class="btn btn-whatsapp" onclick="openWhatsApp(\'' + safePhone + '\', \'' + safeName + '\')">WhatsApp</button>' : "") +
          inviteBtn +
          '<button class="btn btn-primary" onclick="openModal(\'' + safeId + '\', \'' + safeName + '\', \'buyer\')">Inquire</button>' +
        '</div>' +
      '</div>'
    );
  }).join("");
}

// --------------------------------------------------------------------------
// WHATSAPP (unchanged)
// --------------------------------------------------------------------------

function openWhatsApp(phone, name) {
  const cleanPhone = String(phone || "").replace(/[^0-9]/g, "");
  if (!cleanPhone) { alert("No phone number available for this contact."); return; }
  const text = "Hi " + name + ", I found you on GoodsbarnX.";
  window.open("https://wa.me/" + cleanPhone + "?text=" + encodeURIComponent(text), "_blank");
}

// --------------------------------------------------------------------------
// SCREEN LOADER REGISTRATION
// --------------------------------------------------------------------------

(function registerMarketScreen() {
  if (typeof registerScreenLoader !== "function") {
    console.warn("[GoodsbarnX/market] registerScreenLoader unavailable; market screen has no loader.");
    return;
  }
  registerScreenLoader("market", async function marketLoader() {
    await loadDistributorsAndBuyers();
    await updateStats();
  });
})();

// --------------------------------------------------------------------------
// GLOBAL EXPORTS
// --------------------------------------------------------------------------

window.loadDistributorsAndBuyers = loadDistributorsAndBuyers;
window.applyFilters = applyFilters;
window.updateStats = updateStats;
window.renderDistributors = renderDistributors;
window.renderBuyers = renderBuyers;
window.openWhatsApp = openWhatsApp;
window.marketOpenDistributorContext = marketOpenDistributorContext;
window.updateInquiryCountRing = updateInquiryCountRing;

console.log("[GoodsbarnX] market.js loaded (V1.8.2.6 rev.5 · Relationship-first Market)");
