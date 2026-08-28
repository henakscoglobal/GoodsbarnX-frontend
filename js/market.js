// ==========================================================================
// GoodsbarnX — market.js
// Loading, filtering, and rendering distributors and buyers.
// Plain global script — depends on js/config.js (for `sb`) being loaded first.
// Depends on global state vars (allDistributors, allBuyers, activeCategory,
// userFavourites) declared in the main inline script in index.html.
// ==========================================================================

// =========================================================================
// GREETING UPDATE
// =========================================================================

function updateGreeting() {
  const greetingElement = document.getElementById('greeting-name');
  if (!greetingElement) return;
  
  if (currentUser) {
    // Show business name for distributors, full name for others
    const displayName = currentUser.business_name || currentUser.full_name || 'User';
    greetingElement.textContent = displayName;
  } else {
    greetingElement.textContent = 'User';
  }
}

// =========================================================================
// LOAD DISTRIBUTORS AND BUYERS
// =========================================================================

async function loadDistributorsAndBuyers() {
  console.log("Loading distributors and buyers...");

  try {
    // Load distributors from distributor_profiles
    const { data: d, error: distError } = await sb.from("distributor_profiles")
      .select("id, business_name, location, market, category, verification_tier, profiles(phone)");
    
    if (distError) {
      console.error("Error loading distributors:", distError);
    } else if (d) {
      allDistributors = d;
      const statEl = document.getElementById("stat-distributors");
      if (statEl) statEl.innerText = d.length;
      
      // Also update the distributor count in the redesigned UI
      const countEl = document.getElementById("distributor-count");
      if (countEl) countEl.innerText = d.length;
    }

    // Load buyers from buyer_profiles
    const { data: b, error: buyerError } = await sb.from("buyer_profiles")
      .select("id, name, location, market, looking_for, profiles(full_name, phone)");
    
    if (buyerError) {
      console.error("Error loading buyers:", buyerError);
    } else if (b) {
      allBuyers = b;
      const statEl = document.getElementById("stat-buyers");
      if (statEl) statEl.innerText = b.length;
      
      // Also update the buyer count in the redesigned UI
      const countEl = document.getElementById("buyer-count");
      if (countEl) countEl.innerText = b.length;
    }

    // Load inquiry count for the ring
    const { count, error: inquiryError } = await sb.from("inquiries").select("*", { count: "exact", head: true });
    if (!inquiryError) {
      const ringEl = document.getElementById("inquiry-count-ring");
      if (ringEl) ringEl.innerText = count ?? "–";
    }

    // Load pending buyer requests and agent requests
    if (currentUser && currentUser.role === 'distributor') {
      await loadPendingRequests();
    }

    // Update network links with real data
    await updateNetworkLinks();

    // Apply filters to render
    applyFilters();

    // Update stats
    await updateStats();

  } catch (err) {
    console.error("Error in loadDistributorsAndBuyers:", err);
  }
}

// =========================================================================
// LOAD PENDING REQUESTS
// =========================================================================

async function loadPendingRequests() {
  if (!currentUser) return;

  try {
    // Load pending buyer requests (from trade_relationships)
    const { data: buyerRequests, error: buyerReqError } = await sb
      .from("trade_relationships")
      .select("id, buyer_id, status, created_at")
      .eq("distributor_id", currentUser.id)
      .eq("status", "pending");

    if (!buyerReqError && buyerRequests) {
      const badge = document.getElementById('buyer-requests-count');
      if (badge) badge.textContent = buyerRequests.length;
      
      // Also update the attention item count
      const attentionBadge = document.querySelector('.attention-item .badge.buyer');
      if (attentionBadge) attentionBadge.textContent = buyerRequests.length;
    }

    // Load pending agent requests (from agent_distributor_attachments)
    const { data: agentRequests, error: agentReqError } = await sb
      .from("agent_distributor_attachments")
      .select("id, agent_id, status, created_at")
      .eq("distributor_id", currentUser.id)
      .eq("status", "pending");

    if (!agentReqError && agentRequests) {
      const badge = document.getElementById('agent-requests-count');
      if (badge) badge.textContent = agentRequests.length;
      
      // Also update the attention item count
      const attentionBadge = document.querySelector('.attention-item .badge.agent');
      if (attentionBadge) attentionBadge.textContent = agentRequests.length;
    }

    // Load unanswered inquiries
    const { data: inquiries, error: inquiryError } = await sb
      .from("inquiries")
      .select("id, status")
      .eq("distributor_id", currentUser.id)
      .eq("status", "pending");

    if (!inquiryError && inquiries) {
      const badge = document.getElementById('unanswered-inquiries-count');
      if (badge) badge.textContent = inquiries.length;
      
      // Also update the attention item count
      const attentionBadge = document.querySelector('.attention-item .badge.urgent');
      if (attentionBadge) attentionBadge.textContent = inquiries.length;
    }

  } catch (err) {
    console.error("Error loading pending requests:", err);
  }
}

// =========================================================================
// UPDATE NETWORK LINKS
// =========================================================================

async function updateNetworkLinks() {
  if (!currentUser) return;

  try {
    // Get buyer relationships
    const { data: relationships, error: relError } = await sb
      .from("trade_relationships")
      .select("id, buyer_id, status")
      .eq("distributor_id", currentUser.id);

    if (!relError && relationships) {
      const activeBuyers = relationships.filter(r => r.status === 'active').length;
      const pendingBuyers = relationships.filter(r => r.status === 'pending').length;
      
      const countEl = document.getElementById('my-buyers-count');
      if (countEl) countEl.textContent = relationships.length;
      
      const subEl = document.getElementById('my-buyers-sub');
      if (subEl) subEl.textContent = `${activeBuyers} active • ${pendingBuyers} pending`;
    }

    // Get agent relationships
    const { data: agents, error: agentError } = await sb
      .from("agent_distributor_attachments")
      .select("id, agent_id, status")
      .eq("distributor_id", currentUser.id)
      .eq("status", "accepted");

    if (!agentError && agents) {
      const countEl = document.getElementById('my-agents-count');
      if (countEl) countEl.textContent = agents.length;
      
      const subEl = document.getElementById('my-agents-sub');
      if (subEl) subEl.textContent = `${agents.length} active • 0 pending`;
    }

  } catch (err) {
    console.error("Error updating network links:", err);
  }
}

// =========================================================================
// UPDATE STATS
// =========================================================================

async function updateStats() {
  try {
    // Get counts from database for accuracy
    const { count: buyerCount, error: buyerError } = await sb
      .from("buyer_profiles")
      .select("*", { count: "exact", head: true });
    
    const { count: distributorCount, error: distError } = await sb
      .from("distributor_profiles")
      .select("*", { count: "exact", head: true });
    
    if (!buyerError) {
      const statEl = document.getElementById('stat-buyers');
      if (statEl) statEl.textContent = buyerCount || 0;
    }
    
    if (!distError) {
      const statEl = document.getElementById('stat-distributors');
      if (statEl) statEl.textContent = distributorCount || 0;
    }
    
  } catch (err) {
    console.error('Error updating stats:', err);
  }
}

// =========================================================================
// APPLY FILTERS
// =========================================================================

function applyFilters() {
  const q = document.getElementById("search-input").value.trim().toLowerCase();
  const lf = document.getElementById("filter-location")?.value || "";
  const tf = document.getElementById("filter-tier")?.value || "";

  // Filter distributors
  const fd = allDistributors.filter(d => {
    const matchCategory = activeCategory === "All" || d.category?.trim() === activeCategory;
    const matchSearch = !q || (d.business_name || "").toLowerCase().includes(q) ||
      (d.location || "").toLowerCase().includes(q) ||
      (d.market || "").toLowerCase().includes(q) ||
      (d.category || "").toLowerCase().includes(q);
    const matchLocation = !lf || d.location?.toLowerCase() === lf.toLowerCase();
    const matchTier = !tf || d.verification_tier?.toLowerCase() === tf.toLowerCase();
    return matchCategory && matchSearch && matchLocation && matchTier;
  });

  // Filter buyers
  const fb = allBuyers.filter(b => {
    const name = b.name || b.profiles?.full_name || "";
    const matchCategory = activeCategory === "All" || b.looking_for?.trim() === activeCategory;
    const matchSearch = !q || name.toLowerCase().includes(q) ||
      (b.location || "").toLowerCase().includes(q) ||
      (b.market || "").toLowerCase().includes(q) ||
      (b.looking_for || "").toLowerCase().includes(q);
    const matchLocation = !lf || b.location?.toLowerCase() === lf.toLowerCase();
    return matchCategory && matchSearch && matchLocation;
  });

  renderDistributors(fd);
  renderBuyers(fb);

  const distCountEl = document.getElementById("distributor-count");
  if (distCountEl) distCountEl.innerText = fd.length;
  
  const buyerCountEl = document.getElementById("buyer-count");
  if (buyerCountEl) buyerCountEl.innerText = fb.length;
}

// =========================================================================
// SELECT CATEGORY
// =========================================================================

function selectCategory(category, element) {
  activeCategory = category;
  
  // Update active class on pills
  document.querySelectorAll('.category-pill').forEach(pill => {
    pill.classList.remove('active');
  });
  
  if (element) {
    element.classList.add('active');
  }
  
  applyFilters();
}

// =========================================================================
// SEARCH HELPERS
// =========================================================================

function clearSearch() {
  const input = document.getElementById('search-input');
  if (input) {
    input.value = '';
    applyFilters();
    const clearBtn = document.getElementById('search-clear');
    if (clearBtn) {
      clearBtn.style.display = 'none';
    }
  }
}

function toggleSearchClear() {
  const input = document.getElementById('search-input');
  const clearBtn = document.getElementById('search-clear');
  if (input && clearBtn) {
    clearBtn.style.display = input.value.length > 0 ? 'block' : 'none';
  }
}

// =========================================================================
// RENDER DISTRIBUTORS - UPDATED FOR REDESIGN
// =========================================================================

function renderDistributors(list) {
  const container = document.getElementById("distributor-list");

  if (!list || list.length === 0) {
    container.innerHTML = `
      <div class="empty-state-illustration">
        <div class="icon">🏪</div>
        <div class="title">No distributors found</div>
        <div class="sub">Check back later or adjust your filters</div>
      </div>
    `;
    return;
  }

  container.innerHTML = list.map(d => {
    const tier = d.verification_tier || "";
    let vb = "";
    if (tier === "association") vb = '<div class="m-verified">✓ Association Verified</div>';
    else if (tier === "market board") vb = '<div class="m-verified market-board">✓ Market Board Verified</div>';
    else if (tier === "self-attested") vb = '<div class="m-verified self-attested">Self-Attested</div>';

    const phone = d.profiles?.phone || "";
    const isFavourite = userFavourites && userFavourites.has ? userFavourites.has(d.id) : false;

    return `
      <div class="manifest">
        <div class="manifest-top">
          <div>
            <div class="m-name">${d.business_name || 'Distributor'}</div>
            <div class="m-loc">${d.location || ""}${d.market ? " · " + d.market : ""}</div>
            ${vb}
          </div>
          <div style="display:flex; align-items:flex-start; gap:8px;">
            <button class="fav-btn" onclick="toggleFavourite(event, '${d.id}')">
              <span id="fav-${d.id}">${isFavourite ? "❤️" : "🤍"}</span>
            </button>
            <div class="stamp-badge">${(d.category || "LISTED").toUpperCase()}</div>
          </div>
        </div>
        <div class="m-meta">
          ${phone ? `<button class="btn btn-whatsapp" onclick="openWhatsApp('${phone}', '${d.business_name || 'Distributor'}')">WhatsApp</button>` : ""}
          <button class="btn btn-outline" onclick="openStorefrontModal('${d.id}')">Storefront</button>
          <button class="btn btn-primary" onclick="openModal('${d.id}', '${d.business_name || 'Distributor'}', 'distributor')">Inquire</button>
        </div>
        <div class="dispute-row">
          <span class="dispute-link" onclick="openDisputeModal('${d.id}', '${d.business_name || 'Distributor'}')">Report an issue</span>
        </div>
      </div>
    `;
  }).join("");
}

// =========================================================================
// RENDER BUYERS - UPDATED FOR REDESIGN
// =========================================================================

function renderBuyers(list) {
  const container = document.getElementById("buyer-list");

  if (!list || list.length === 0) {
    container.innerHTML = `
      <div class="empty-state-illustration">
        <div class="icon">👤</div>
        <div class="title">No buyers found</div>
        <div class="sub">Start by inviting buyers to your network</div>
      </div>
    `;
    return;
  }

  container.innerHTML = list.map(b => {
    const name = b.name || b.profiles?.full_name || "Buyer";
    const phone = b.profiles?.phone || "";

    return `
      <div class="manifest">
        <div class="manifest-top">
          <div>
            <div class="m-name">${name}</div>
            <div class="m-loc">${b.location || ""}${b.market ? " · " + b.market : ""}</div>
            ${b.verification_status ? `
              <div class="m-verified ${b.verification_status.toLowerCase().replace(' ', '-')}">
                ✓ ${b.verification_status}
              </div>
            ` : ''}
          </div>
          <div class="stamp-badge" style="border-color:var(--brass); color:var(--brass);">
            ${(b.looking_for || "BUYER").toUpperCase()}
          </div>
        </div>
        <div class="m-meta">
          ${phone ? `<button class="btn btn-whatsapp" onclick="openWhatsApp('${phone}', '${name}')">WhatsApp</button>` : ""}
          <button class="btn btn-primary" onclick="openModal('${b.id}', '${name}', 'buyer')">Inquire</button>
        </div>
      </div>
    `;
  }).join("");
}

// =========================================================================
// WHATSAPP HELPER
// =========================================================================

function openWhatsApp(phone, name) {
  const cleanPhone = (phone || "").replace(/[^0-9]/g, "");
  if (!cleanPhone) {
    alert("No phone number available for this contact.");
    return;
  }
  window.open("https://wa.me/" + cleanPhone + "?text=" + encodeURIComponent("Hi " + name + ", I found you on GoodsbarnX."), "_blank");
}

// =========================================================================
// TOGGLE FAVOURITE
// =========================================================================

function toggleFavourite(event, id) {
  if (event) {
    event.stopPropagation();
  }
  
  if (userFavourites.has(id)) {
    userFavourites.delete(id);
  } else {
    userFavourites.add(id);
  }
  
  const favEl = document.getElementById(`fav-${id}`);
  if (favEl) {
    favEl.textContent = userFavourites.has(id) ? "❤️" : "🤍";
  }
}

// =========================================================================
// EXPOSE FUNCTIONS GLOBALLY
// =========================================================================

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
