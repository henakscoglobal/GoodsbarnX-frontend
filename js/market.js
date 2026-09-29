// ==========================================================================
// GoodsbarnX — market.js
// Canonical distributor/buyer market runtime.
// Distributor dashboard remains owned by the prototype-locked inline runtime in index.html.
// Depends on config.js (`sb`) and app.js global state (`currentUser`,
// `allDistributors`, `allBuyers`, `activeCategory`, `userFavourites`).
// app.js remains the final loaded JS source.
// ==========================================================================

function updateGreeting() {
  const el = document.getElementById('greeting-name');
  if (!el) return;
  el.textContent = currentUser
    ? (currentUser.business_name || currentUser.full_name || 'User')
    : 'User';
}

async function loadDistributorsAndBuyers() {
  try {
    const { data: d, error: distError } = await sb.from("distributor_profiles")
      .select("id, business_name, location, market, category, verification_tier, profiles(phone)");
    if (!distError && d) {
      allDistributors = d;
      const a = document.getElementById("stat-distributors"); if (a) a.textContent = d.length;
      const b = document.getElementById("distributor-count"); if (b) b.textContent = d.length;
    }

    const { data: b, error: buyerError } = await sb.from("buyer_profiles")
      .select("id, name, location, market, looking_for, verification_status, profiles(full_name, phone)");
    if (!buyerError && b) {
      allBuyers = b;
      const a = document.getElementById("stat-buyers"); if (a) a.textContent = b.length;
      const c = document.getElementById("buyer-count"); if (c) c.textContent = b.length;
    }

    const { count, error: inquiryError } = await sb.from("inquiries").select("*", { count: "exact", head: true });
    if (!inquiryError) {
      const el = document.getElementById("inquiry-count-ring"); if (el) el.textContent = count ?? "–";
    }

    if (currentUser?.role === "distributor") await loadPendingRequests();
    await updateNetworkLinks();
    applyFilters();
    await updateStats();
  } catch (err) {
    console.error("GoodsbarnX market runtime:", err);
  }
}

async function loadPendingRequests() {
  if (!currentUser) return;
  try {
    // Canonical buyer relationship source. buyer_locks is intentionally excluded.
    const { data: buyerRequests } = await sb
      .from("trade_relationships")
      .select("id, buyer_id, status, created_at")
      .eq("distributor_id", currentUser.id)
      .in("status", ["pending", "pending_consent"]);

    const badge = document.getElementById("buyer-requests-count");
    if (badge) badge.textContent = buyerRequests?.length || 0;
    const attention = document.querySelector(".attention-item .badge.buyer");
    if (attention) attention.textContent = buyerRequests?.length || 0;

    const { data: agentRequests } = await sb
      .from("agent_distributor_attachments")
      .select("id, agent_id, status, created_at")
      .eq("distributor_id", currentUser.id)
      .eq("status", "pending");

    const agentBadge = document.getElementById("agent-requests-count");
    if (agentBadge) agentBadge.textContent = agentRequests?.length || 0;
    const agentAttention = document.querySelector(".attention-item .badge.agent");
    if (agentAttention) agentAttention.textContent = agentRequests?.length || 0;

    const { data: inquiries } = await sb
      .from("inquiries")
      .select("id, status")
      .eq("distributor_id", currentUser.id)
      .eq("status", "pending");

    const inquiryBadge = document.getElementById("unanswered-inquiries-count");
    if (inquiryBadge) inquiryBadge.textContent = inquiries?.length || 0;
    const urgent = document.querySelector(".attention-item .badge.urgent");
    if (urgent) urgent.textContent = inquiries?.length || 0;
  } catch (err) {
    console.error("GoodsbarnX pending-request runtime:", err);
  }
}

async function updateNetworkLinks() {
  if (!currentUser) return;
  try {
    const { data: relationships, error: relError } = await sb
      .from("trade_relationships")
      .select("id, buyer_id, status, is_primary")
      .eq("distributor_id", currentUser.id);

    if (!relError && relationships) {
      const active = relationships.filter(r => r.status === "active");
      const pending = relationships.filter(r => ["pending", "pending_consent"].includes(r.status));
      const el = document.getElementById("my-buyers-count"); if (el) el.textContent = relationships.length;
      const sub = document.getElementById("my-buyers-sub");
      if (sub) sub.textContent = `${active.length} active • ${pending.length} pending`;
    }

    const { data: agents, error: agentError } = await sb
      .from("agent_distributor_attachments")
      .select("id, agent_id, status")
      .eq("distributor_id", currentUser.id)
      .eq("status", "accepted");

    if (!agentError && agents) {
      const el = document.getElementById("my-agents-count"); if (el) el.textContent = agents.length;
      const sub = document.getElementById("my-agents-sub");
      if (sub) sub.textContent = `${agents.length} active • 0 pending`;
    }
  } catch (err) {
    console.error("GoodsbarnX network runtime:", err);
  }
}

async function updateStats() {
  try {
    const [{ count: buyerCount, error: buyerError }, { count: distributorCount, error: distError }] =
      await Promise.all([
        sb.from("buyer_profiles").select("*", { count: "exact", head: true }),
        sb.from("distributor_profiles").select("*", { count: "exact", head: true })
      ]);
    if (!buyerError) { const el = document.getElementById("stat-buyers"); if (el) el.textContent = buyerCount || 0; }
    if (!distError) { const el = document.getElementById("stat-distributors"); if (el) el.textContent = distributorCount || 0; }
  } catch (err) {
    console.error("GoodsbarnX stats runtime:", err);
  }
}

function applyFilters() {
  const input = document.getElementById("search-input");
  const q = (input?.value || "").trim().toLowerCase();
  const lf = document.getElementById("filter-location")?.value || "";
  const tf = document.getElementById("filter-tier")?.value || "";

  const fd = (allDistributors || []).filter(d => {
    const category = activeCategory === "All" || d.category?.trim() === activeCategory;
    const search = !q || [d.business_name, d.location, d.market, d.category].some(v => (v || "").toLowerCase().includes(q));
    const location = !lf || d.location?.toLowerCase() === lf.toLowerCase();
    const tier = !tf || d.verification_tier?.toLowerCase() === tf.toLowerCase();
    return category && search && location && tier;
  });

  const fb = (allBuyers || []).filter(b => {
    const name = b.name || b.profiles?.full_name || "";
    const category = activeCategory === "All" || b.looking_for?.trim() === activeCategory;
    const search = !q || [name, b.location, b.market, b.looking_for].some(v => (v || "").toLowerCase().includes(q));
    const location = !lf || b.location?.toLowerCase() === lf.toLowerCase();
    return category && search && location;
  });

  renderDistributors(fd);
  renderBuyers(fb);
  const dc = document.getElementById("distributor-count"); if (dc) dc.textContent = fd.length;
  const bc = document.getElementById("buyer-count"); if (bc) bc.textContent = fb.length;
}

function selectCategory(category, element) {
  activeCategory = category;
  document.querySelectorAll(".category-pill").forEach(p => p.classList.remove("active"));
  if (element) element.classList.add("active");
  applyFilters();
}

function clearSearch() {
  const input = document.getElementById("search-input");
  if (!input) return;
  input.value = "";
  applyFilters();
  const clear = document.getElementById("search-clear");
  if (clear) clear.style.display = "none";
}

function toggleSearchClear() {
  const input = document.getElementById("search-input");
  const clear = document.getElementById("search-clear");
  if (input && clear) clear.style.display = input.value.length ? "block" : "none";
}

function renderDistributors(list) {
  const container = document.getElementById("distributor-list");
  if (!container) return;
  if (!list?.length) {
    container.innerHTML = '<div class="empty-state-illustration"><div class="icon">🏪</div><div class="title">No distributors found</div><div class="sub">Check back later or adjust your filters</div></div>';
    return;
  }
  container.innerHTML = list.map(d => {
    const tier = d.verification_tier || "";
    const verified = tier === "association" ? '<div class="m-verified">✓ Association Verified</div>'
      : tier === "market board" ? '<div class="m-verified market-board">✓ Market Board Verified</div>'
      : tier === "self-attested" ? '<div class="m-verified self-attested">Self-Attested</div>' : "";
    const phone = d.profiles?.phone || "";
    const fav = userFavourites?.has?.(d.id);
    const safeName = String(d.business_name || "Distributor").replace(/'/g, "\\'");
    return `<div class="manifest"><div class="manifest-top"><div><div class="m-name">${d.business_name || "Distributor"}</div><div class="m-loc">${d.location || ""}${d.market ? " · " + d.market : ""}</div>${verified}</div><div style="display:flex;align-items:flex-start;gap:8px;"><button class="fav-btn" onclick="toggleFavourite(event,'${d.id}')"><span id="fav-${d.id}">${fav ? "❤️" : "🤍"}</span></button><div class="stamp-badge">${(d.category || "LISTED").toUpperCase()}</div></div></div><div class="m-meta">${phone ? `<button class="btn btn-whatsapp" onclick="openWhatsApp('${phone}','${safeName}')">WhatsApp</button>` : ""}<button class="btn btn-outline" onclick="openStorefrontModal('${d.id}')">Storefront</button><button class="btn btn-primary" onclick="openModal('${d.id}','${safeName}','distributor')">Inquire</button></div><div class="dispute-row"><span class="dispute-link" onclick="openDisputeModal('${d.id}','${safeName}')">Report an issue</span></div></div>`;
  }).join("");
}

function renderBuyers(list) {
  const container = document.getElementById("buyer-list");
  if (!container) return;
  if (!list?.length) {
    container.innerHTML = '<div class="empty-state-illustration"><div class="icon">👤</div><div class="title">No buyers found</div><div class="sub">Start by inviting buyers to your network</div></div>';
    return;
  }
  container.innerHTML = list.map(b => {
    const name = b.name || b.profiles?.full_name || "Buyer";
    const phone = b.profiles?.phone || "";
    const safeName = String(name).replace(/'/g, "\\'");
    return `<div class="manifest"><div class="manifest-top"><div><div class="m-name">${name}</div><div class="m-loc">${b.location || ""}${b.market ? " · " + b.market : ""}</div>${b.verification_status ? `<div class="m-verified ${String(b.verification_status).toLowerCase().replace(" ","-")}">✓ ${b.verification_status}</div>` : ""}</div><div class="stamp-badge" style="border-color:var(--brass);color:var(--brass);">${(b.looking_for || "BUYER").toUpperCase()}</div></div><div class="m-meta">${phone ? `<button class="btn btn-whatsapp" onclick="openWhatsApp('${phone}','${safeName}')">WhatsApp</button>` : ""}<button class="btn btn-primary" onclick="openModal('${b.id}','${safeName}','buyer')">Inquire</button></div></div>`;
  }).join("");
}

function openWhatsApp(phone, name) {
  const cleanPhone = String(phone || "").replace(/[^0-9]/g, "");
  if (!cleanPhone) return alert("No phone number available for this contact.");
  window.open("https://wa.me/" + cleanPhone + "?text=" + encodeURIComponent("Hi " + name + ", I found you on GoodsbarnX."), "_blank");
}

function toggleFavourite(event, id) {
  event?.stopPropagation();
  if (userFavourites.has(id)) userFavourites.delete(id); else userFavourites.add(id);
  const el = document.getElementById(`fav-${id}`);
  if (el) el.textContent = userFavourites.has(id) ? "❤️" : "🤍";
}

window.loadDistributorsAndBuyers = loadDistributorsAndBuyers;
window.applyFilters = applyFilters;
window.selectCategory = selectCategory;
window.clearSearch = clearSearch;
window.toggleSearchClear = toggleSearchClear;
window.updateGreeting = updateGreeting;
window.updateStats = updateStats;
window.renderDistributors = renderDistributors;
window.renderBuyers = renderBuyers;
window.openWhatsApp = openWhatsApp;
window.toggleFavourite = toggleFavourite;
