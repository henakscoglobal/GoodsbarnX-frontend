// ==========================================================================
// GoodsbarnX — market.js
// Marketplace: distributor discovery, buyer discovery, filtering, rendering.
// Plain global script. Loads fourth (Canon §10).
//
// V1.8.2.6 remediation Phase 1+2:
//   - Removed duplicate updateGreeting (owner: app.js).
//   - Removed duplicate selectCategory / clearSearch / toggleSearchClear
//     (owner: ui.js).
//   - Removed duplicate toggleFavourite (owner: profile.js).
//   - Registered a "market" screen loader (Phase 2.3).
//   - All DOM lookups null-safe with named warnings for missing targets.
//     The payload wrote into #my-buyers-count, #my-buyers-sub, #my-agents-count,
//     #my-agents-sub, #buyer-requests-count, #agent-requests-count,
//     #unanswered-inquiries-count, and .attention-item .badge.* which do not
//     exist in index-current.html. Those silent no-ops are now explicit.
//   - Added escaping for interpolated values inside rendered HTML, closing
//     a potential attribute-injection defect on names containing quotes.
// ==========================================================================

// --------------------------------------------------------------------------
// LOCAL ESCAPING HELPERS
// --------------------------------------------------------------------------

function escHtml(v) {
  return String(v == null ? "" : v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escAttr(v) {
  return escHtml(v);
}

// Cache of already-warned missing DOM targets so the console is not flooded
// on every filter pass.
const __gbxMarketWarnedTargets = Object.create(null);
function warnMissingTarget(id) {
  if (__gbxMarketWarnedTargets[id]) return;
  __gbxMarketWarnedTargets[id] = true;
  console.warn("[GoodsbarnX/market] DOM target #" + id + " is missing from index.html.");
}

// --------------------------------------------------------------------------
// LOAD DISTRIBUTORS AND BUYERS
// --------------------------------------------------------------------------

async function loadDistributorsAndBuyers() {
  console.log("[GoodsbarnX/market] loading distributors and buyers...");

  if (!window.sb || typeof window.sb.from !== "function") {
    console.error("[GoodsbarnX/market] Supabase client unavailable. Cannot load marketplace data.");
    return;
  }

  try {
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

    // Demand signal ring — total inquiries across the network.
    const { count, error: inquiryError } = await sb
      .from("inquiries")
      .select("*", { count: "exact", head: true });
    if (!inquiryError) {
      const ringEl = document.getElementById("inquiry-count-ring");
      if (ringEl) ringEl.innerText = count == null ? "–" : count;
      else warnMissingTarget("inquiry-count-ring");
    }

    // Distributor-scoped attention surfaces.
    if (currentUser && currentUser.role === "distributor") {
      await loadPendingRequests();
    }

    await updateNetworkLinks();

    applyFilters();
    await updateStats();
  } catch (error) {
    console.error("[GoodsbarnX/market] loadDistributorsAndBuyers failed:", error);
  }
}

// --------------------------------------------------------------------------
// PENDING REQUESTS (distributor's attention surface)
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
      else warnMissingTarget("buyer-requests-count");

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
      else warnMissingTarget("agent-requests-count");

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
      else warnMissingTarget("unanswered-inquiries-count");

      const attentionBadge = document.querySelector(".attention-item .badge.urgent");
      if (attentionBadge) attentionBadge.textContent = pendingInquiries.length;
    }
  } catch (error) {
    console.error("[GoodsbarnX/market] loadPendingRequests failed:", error);
  }
}

// --------------------------------------------------------------------------
// NETWORK LINKS (distributor's buyer/agent counts)
// --------------------------------------------------------------------------

async function updateNetworkLinks() {
  if (!currentUser || !window.sb) return;

  try {
    const { data: relationships, error: relError } = await sb
      .from("trade_relationships")
      .select("id, buyer_id, status")
      .eq("distributor_id", currentUser.id);

    if (!relError && Array.isArray(relationships)) {
      const activeBuyers  = relationships.filter(r => r.status === "active").length;
      const pendingBuyers = relationships.filter(r => r.status === "pending").length;

      const countEl = document.getElementById("my-buyers-count");
      if (countEl) countEl.textContent = relationships.length;
      else warnMissingTarget("my-buyers-count");

      const subEl = document.getElementById("my-buyers-sub");
      if (subEl) subEl.textContent = activeBuyers + " active • " + pendingBuyers + " pending";
      else warnMissingTarget("my-buyers-sub");
    }

    const { data: agents, error: agentError } = await sb
      .from("agent_distributor_attachments")
      .select("id, agent_id, status")
      .eq("distributor_id", currentUser.id)
      .eq("status", "accepted");

    if (!agentError && Array.isArray(agents)) {
      const countEl = document.getElementById("my-agents-count");
      if (countEl) countEl.textContent = agents.length;
      else warnMissingTarget("my-agents-count");

      const subEl = document.getElementById("my-agents-sub");
      if (subEl) subEl.textContent = agents.length + " active • 0 pending";
      else warnMissingTarget("my-agents-sub");
    }
  } catch (error) {
    console.error("[GoodsbarnX/market] updateNetworkLinks failed:", error);
  }
}

// --------------------------------------------------------------------------
// STATS
// --------------------------------------------------------------------------

async function updateStats() {
  if (!window.sb) return;

  try {
    const { count: buyerCount, error: buyerError } = await sb
      .from("buyer_profiles")
      .select("*", { count: "exact", head: true });

    const { count: distributorCount, error: distError } = await sb
      .from("distributor_profiles")
      .select("*", { count: "exact", head: true });

    if (!buyerError) {
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
    const haystack = [
      d.business_name || "",
      d.location || "",
      d.market || "",
      d.category || ""
    ].join(" ").toLowerCase();
    const matchSearch = !q || haystack.indexOf(q) !== -1;
    const matchLocation = !lf || (d.location || "").toLowerCase() === lf.toLowerCase();
    const matchTier = !tf || (d.verification_tier || "").toLowerCase() === tf.toLowerCase();
    return matchCategory && matchSearch && matchLocation && matchTier;
  });

  const fb = allBuyers.filter(b => {
    const name = b.name || (b.profiles && b.profiles.full_name) || "";
    const matchCategory = activeCategory === "All" || (b.looking_for || "").trim() === activeCategory;
    const haystack = [
      name,
      b.location || "",
      b.market || "",
      b.looking_for || ""
    ].join(" ").toLowerCase();
    const matchSearch = !q || haystack.indexOf(q) !== -1;
    const matchLocation = !lf || (b.location || "").toLowerCase() === lf.toLowerCase();
    return matchCategory && matchSearch && matchLocation;
  });

  renderDistributors(fd);
  renderBuyers(fb);

  const distCountEl = document.getElementById("distributor-count");
  if (distCountEl) distCountEl.innerText = fd.length;

  const buyerCountEl = document.getElementById("buyer-count");
  if (buyerCountEl) buyerCountEl.innerText = fb.length;
}

// --------------------------------------------------------------------------
// RENDER — DISTRIBUTORS
// --------------------------------------------------------------------------

function renderDistributors(list) {
  const container = document.getElementById("distributor-list");
  if (!container) {
    warnMissingTarget("distributor-list");
    return;
  }

  if (!Array.isArray(list) || list.length === 0) {
    container.innerHTML =
      '<div class="empty-state-illustration">' +
        '<div class="icon">🏪</div>' +
        '<div class="title">No distributors found</div>' +
        '<div class="sub">Check back later or adjust your filters</div>' +
      '</div>';
    return;
  }

  container.innerHTML = list.map(d => {
    const tier = d.verification_tier || "";
    let verifiedBadge = "";
    if (tier === "association") {
      verifiedBadge = '<div class="m-verified">✓ Association Verified</div>';
    } else if (tier === "market board") {
      verifiedBadge = '<div class="m-verified market-board">✓ Market Board Verified</div>';
    } else if (tier === "self-attested") {
      verifiedBadge = '<div class="m-verified self-attested">Self-Attested</div>';
    }

    const phone = (d.profiles && d.profiles.phone) || "";
    const isFavourite = userFavourites && typeof userFavourites.has === "function"
      ? userFavourites.has(d.id)
      : false;

    const safeId    = escAttr(d.id);
    const safeName  = escAttr(d.business_name || "Distributor");
    const safePhone = escAttr(phone);
    const safeCat   = escHtml((d.category || "LISTED").toUpperCase());

    return (
      '<div class="manifest">' +
        '<div class="manifest-top">' +
          '<div>' +
            '<div class="m-name">' + escHtml(d.business_name || "Distributor") + '</div>' +
            '<div class="m-loc">' + escHtml(d.location || "") +
              (d.market ? " · " + escHtml(d.market) : "") +
            '</div>' +
            verifiedBadge +
          '</div>' +
          '<div style="display:flex; align-items:flex-start; gap:8px;">' +
            '<button class="fav-btn" onclick="toggleFavourite(event, \'' + safeId + '\')">' +
              '<span id="fav-' + safeId + '">' + (isFavourite ? "❤️" : "🤍") + '</span>' +
            '</button>' +
            '<div class="stamp-badge">' + safeCat + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="m-meta">' +
          (phone
            ? '<button class="btn btn-whatsapp" onclick="openWhatsApp(\'' + safePhone + '\', \'' + safeName + '\')">WhatsApp</button>'
            : "") +
          '<button class="btn btn-outline" onclick="openStorefrontModal(\'' + safeId + '\')">Storefront</button>' +
          '<button class="btn btn-primary" onclick="openModal(\'' + safeId + '\', \'' + safeName + '\', \'distributor\')">Inquire</button>' +
        '</div>' +
        '<div class="dispute-row">' +
          '<span class="dispute-link" onclick="openDisputeModal(\'' + safeId + '\', \'' + safeName + '\')">Report an issue</span>' +
        '</div>' +
      '</div>'
    );
  }).join("");
}

// --------------------------------------------------------------------------
// RENDER — BUYERS
// --------------------------------------------------------------------------

function renderBuyers(list) {
  const container = document.getElementById("buyer-list");
  if (!container) {
    warnMissingTarget("buyer-list");
    return;
  }

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

    const safeId    = escAttr(b.id);
    const safeName  = escAttr(name);
    const safePhone = escAttr(phone);
    const safeCat   = escHtml((b.looking_for || "BUYER").toUpperCase());

    const verifiedBadge = b.verification_status
      ? '<div class="m-verified ' + escAttr(String(b.verification_status).toLowerCase().replace(" ", "-")) + '">✓ ' +
        escHtml(b.verification_status) +
        '</div>'
      : "";

    return (
      '<div class="manifest">' +
        '<div class="manifest-top">' +
          '<div>' +
            '<div class="m-name">' + escHtml(name) + '</div>' +
            '<div class="m-loc">' + escHtml(b.location || "") +
              (b.market ? " · " + escHtml(b.market) : "") +
            '</div>' +
            verifiedBadge +
          '</div>' +
          '<div class="stamp-badge" style="border-color:var(--brass); color:var(--brass);">' + safeCat + '</div>' +
        '</div>' +
        '<div class="m-meta">' +
          (phone
            ? '<button class="btn btn-whatsapp" onclick="openWhatsApp(\'' + safePhone + '\', \'' + safeName + '\')">WhatsApp</button>'
            : "") +
          '<button class="btn btn-primary" onclick="openModal(\'' + safeId + '\', \'' + safeName + '\', \'buyer\')">Inquire</button>' +
        '</div>' +
      '</div>'
    );
  }).join("");
}

// --------------------------------------------------------------------------
// WHATSAPP
// --------------------------------------------------------------------------

function openWhatsApp(phone, name) {
  const cleanPhone = String(phone || "").replace(/[^0-9]/g, "");
  if (!cleanPhone) {
    alert("No phone number available for this contact.");
    return;
  }
  const text = "Hi " + name + ", I found you on GoodsbarnX.";
  window.open("https://wa.me/" + cleanPhone + "?text=" + encodeURIComponent(text), "_blank");
}

// --------------------------------------------------------------------------
// SCREEN LOADER REGISTRATION (Phase 2.3)
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

console.log("[GoodsbarnX] market.js loaded.");
