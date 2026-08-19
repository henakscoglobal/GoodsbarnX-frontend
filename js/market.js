// ==========================================================================
// GoodsbarnX — market.js
// Loading, filtering, and rendering distributors and buyers.
// Plain global script — depends on js/config.js (for `sb`) being loaded first.
// Depends on global state vars (allDistributors, allBuyers, activeCategory,
// userFavourites) declared in the main inline script in index.html.
// ==========================================================================

async function loadDistributorsAndBuyers() {
  console.log("Loading distributors and buyers...");

  const { data: d } = await sb.from("distributor_profiles")
    .select("id, business_name, location, market, category, verification_tier, profiles(phone)");
  if (d) {
    allDistributors = d;
    document.getElementById("stat-distributors").innerText = d.length;
  }

  const { data: b } = await sb.from("buyer_profiles")
    .select("id, name, location, market, looking_for, profiles(full_name, phone)");
  if (b) {
    allBuyers = b;
    document.getElementById("stat-buyers").innerText = b.length;
  }

  sb.from("inquiries").select("*", { count: "exact", head: true }).then(({ count }) => {
    document.getElementById("inquiry-count-ring").innerText = count ?? "–";
  });

  applyFilters();
}

function applyFilters() {
  const q = document.getElementById("search-input").value.trim().toLowerCase();
  const lf = document.getElementById("filter-location").value;
  const tf = document.getElementById("filter-tier").value;

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

  document.getElementById("distributor-count").innerText = fd.length;
  document.getElementById("buyer-count").innerText = fb.length;
}

function renderDistributors(list) {
  const container = document.getElementById("distributor-list");

  if (list.length === 0) {
    container.innerHTML = '<div class="loading-text">No distributors found.</div>';
    return;
  }

  container.innerHTML = list.map(d => {
    const tier = d.verification_tier || "";
    let vb = "";
    if (tier === "association") vb = '<div class="m-verified">✓ Association Verified</div>';
    else if (tier === "market board") vb = '<div class="m-verified market-board">✓ Market Board Verified</div>';
    else if (tier === "self-attested") vb = '<div class="m-verified self-attested">Self-Attested</div>';

    const phone = d.profiles?.phone || "";

    return `
      <div class="manifest">
        <div class="manifest-top">
          <div>
            <div class="m-name">${d.business_name}</div>
            <div class="m-loc">${d.location || ""}${d.market ? " · " + d.market : ""}</div>
            ${vb}
          </div>
          <div style="display:flex; align-items:flex-start; gap:8px;">
            <button class="fav-btn" onclick="toggleFavourite(event, '${d.id}')">
              <span id="fav-${d.id}">${userFavourites.has(d.id) ? "❤️" : "🤍"}</span>
            </button>
            <div class="stamp-badge">${(d.category || "LISTED").toUpperCase()}</div>
          </div>
        </div>
        <div class="m-meta">
          ${phone ? `<button class="btn btn-whatsapp" onclick="openWhatsApp('${phone}', '${d.business_name}')">WhatsApp</button>` : ""}
          <button class="btn btn-outline" onclick="openStorefrontModal('${d.id}')">Storefront</button>
          <button class="btn btn-primary" onclick="openModal('${d.id}', '${d.business_name}', 'distributor')">Inquire</button>
        </div>
        <div class="dispute-row">
          <span class="dispute-link" onclick="openDisputeModal('${d.id}', '${d.business_name}')">Report an issue</span>
        </div>
      </div>
    `;
  }).join("");
}

function renderBuyers(list) {
  const container = document.getElementById("buyer-list");

  if (list.length === 0) {
    container.innerHTML = '<div class="loading-text">No buyers found.</div>';
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

function openWhatsApp(phone, name) {
  window.open("https://wa.me/" + (phone || "").replace(/[^0-9]/g, "") + "?text=" + encodeURIComponent("Hi " + name + ", I found you on GoodsbarnX."), "_blank");
}
