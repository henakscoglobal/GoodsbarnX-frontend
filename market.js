// GoodsbarnX – Market Module (Search, Filters, Distributor/Buyer Rendering)

let allDistributors = [];
let allBuyers = [];
let activeCategory = "All";
let selectedContactName = "";
let selectedContactType = "";
let selectedContactId = "";
let selectedTier = "";

document.addEventListener("userLoaded", () => {
  loadDistributorsAndBuyers();
});

// ---------- Data Loading ----------
async function loadDistributorsAndBuyers() {
  const { data: distributors } = await sb.from("distributor_profiles").select("id, business_name, location, market, shop_address, category, verification_tier, profiles(phone)");
  if (distributors) {
    allDistributors = distributors;
    document.getElementById("stat-distributors").innerText = allDistributors.length;
  }

  const { data: buyers } = await sb.from("buyer_profiles").select("id, name, location, market, shop_address, looking_for, description, profiles(full_name, phone)");
  if (buyers) {
    allBuyers = buyers;
    document.getElementById("stat-buyers").innerText = allBuyers.length;
  }

  applyFilters();
}

// Total inquiries count
sb.from("inquiries").select("*", { count: "exact", head: true }).then(({ count }) => {
  const ring = document.getElementById("inquiry-count-ring");
  if (ring) ring.innerText = count != null ? count : "–";
});

// ---------- Rendering ----------
function renderDistributors(list) {
  const c = document.getElementById("distributor-list");
  c.innerHTML = "";
  if (list.length === 0) { c.innerHTML = '<div class="loading-text">No distributors found.</div>'; return; }

  list.forEach(d => {
    const tier = d.verification_tier || "";
    let verifiedBadge = "";
    if (tier.toLowerCase() === "association") verifiedBadge = '<div class="m-verified">✓ Association Verified</div>';
    else if (tier.toLowerCase() === "market board") verifiedBadge = '<div class="m-verified market-board">✓ Market Board Verified</div>';
    else if (tier.toLowerCase() === "self-attested") verifiedBadge = '<div class="m-verified self-attested">Self-Attested</div>';

    const phone = d.profiles ? d.profiles.phone : "";
    const card = document.createElement("div");
    card.className = "manifest";
    card.innerHTML = `
      <div class="manifest-top">
        <div>
          <div class="m-name">${d.business_name}</div>
          <div class="m-loc">${d.location || ""}${d.market ? ' · ' + d.market : ''}</div>
          ${verifiedBadge}
        </div>
        <div style="display:flex; align-items:flex-start; gap:8px;">
          <button class="fav-btn" onclick="toggleFavourite(event, '${d.id}')"><span class="fav-icon" id="fav-${d.id}">🤍</span></button>
          <div class="stamp-badge">${d.category ? d.category.toUpperCase() : "LISTED"}</div>
        </div>
      </div>
      <div class="m-meta">
        ${phone ? `<button class="btn-whatsapp" onclick="openWhatsApp('${phone}','${d.business_name}')">WhatsApp</button>` : ''}
        <button class="btn-storefront" onclick="openStorefrontModal('${d.id}')">Storefront</button>
        <button class="btn-inquire" onclick="openModal('${d.id}','${d.business_name}','distributor')">Inquire</button>
      </div>
      <div class="dispute-row"><span class="dispute-link" onclick="openDisputeModal('${d.id}','${d.business_name}')">Report an issue</span></div>`;
    c.appendChild(card);
  });
}

function renderBuyers(list) {
  const c = document.getElementById("buyer-list");
  c.innerHTML = "";
  if (list.length === 0) { c.innerHTML = '<div class="loading-text">No buyers found.</div>'; return; }

  list.forEach(b => {
    const name = b.name || (b.profiles ? b.profiles.full_name : "Buyer");
    const phone = b.profiles ? b.profiles.phone : "";
    const card = document.createElement("div");
    card.className = "manifest";
    card.innerHTML = `
      <div class="manifest-top">
        <div>
          <div class="m-name">${name}</div>
          <div class="m-loc">${b.location || ""}${b.market ? ' · ' + b.market : ''}</div>
        </div>
        <div class="stamp-badge" style="border-color:var(--brass); color:var(--brass);">${b.looking_for ? b.looking_for.toUpperCase() : "BUYER"}</div>
      </div>
      <div class="m-meta">
        ${phone ? `<button class="btn-whatsapp" onclick="openWhatsApp('${phone}','${name}')">WhatsApp</button>` : ''}
        <button class="btn-inquire" onclick="openModal('${b.id}','${name}','buyer')">Inquire</button>
      </div>`;
    c.appendChild(card);
  });
}

// ---------- Filters ----------
function selectCategory(cat, el) {
  activeCategory = cat;
  document.querySelectorAll(".category-card").forEach(c => c.classList.remove("active"));
  el.classList.add("active");
  applyFilters();
}

function toggleSearchClear() {
  const input = document.getElementById("search-input");
  const clearBtn = document.getElementById("search-clear");
  clearBtn.style.display = input.value.trim() ? "block" : "none";
}

function clearSearch() {
  document.getElementById("search-input").value = "";
  toggleSearchClear();
  applyFilters();
}

function applyFilters() {
  const q = document.getElementById("search-input").value.trim().toLowerCase();
  const locFilter = document.getElementById("filter-location").value;
  const tierFilter = document.getElementById("filter-tier").value;
  const isActive = q || activeCategory !== "All" || locFilter || tierFilter;

  if (!isActive) {
    document.getElementById("distributor-list").innerHTML = '<div class="loading-text">Select a category or search to view distributors.</div>';
    document.getElementById("buyer-list").innerHTML = '<div class="loading-text">Select a category or search to view buyers.</div>';
    document.getElementById("distributor-count").innerText = "0";
    document.getElementById("buyer-count").innerText = "0";
    return;
  }

  const fd = allDistributors.filter(d => {
    const mc = activeCategory === "All" || (d.category && d.category.trim() === activeCategory);
    const ms = !q || (d.business_name || "").toLowerCase().includes(q) || (d.location || "").toLowerCase().includes(q) || (d.market || "").toLowerCase().includes(q) || (d.category || "").toLowerCase().includes(q);
    const ml = !locFilter || (d.location || "").toLowerCase() === locFilter.toLowerCase();
    const mt = !tierFilter || (d.verification_tier || "").toLowerCase() === tierFilter.toLowerCase();
    return mc && ms && ml && mt;
  });

  const fb = allBuyers.filter(b => {
    const bName = b.name || (b.profiles ? b.profiles.full_name : "");
    const mc = activeCategory === "All" || (b.looking_for && b.looking_for.trim() === activeCategory);
    const ms = !q || (bName || "").toLowerCase().includes(q) || (b.location || "").toLowerCase().includes(q) || (b.market || "").toLowerCase().includes(q) || (b.looking_for || "").toLowerCase().includes(q);
    const ml = !locFilter || (b.location || "").toLowerCase() === locFilter.toLowerCase();
    return mc && ms && ml;
  });

  renderDistributors(fd);
  renderBuyers(fb);
  document.getElementById("distributor-count").innerText = fd.length;
  document.getElementById("buyer-count").innerText = fb.length;
}

// ---------- Contact Modal ----------
function openWhatsApp(phone, name) {
  const cleanPhone = (phone || "").replace(/[^0-9]/g, "");
  const message = encodeURIComponent("Hi " + name + ", I found you on GoodsbarnX and I'm interested in connecting.");
  window.open("https://wa.me/" + cleanPhone + "?text=" + message, "_blank");
}

function openModal(id, name, type) {
  selectedContactId = id;
  selectedContactName = name;
  selectedContactType = type;
  document.getElementById("modal-title").innerText = "Contact " + name;
  document.getElementById("status-msg").innerText = "";
  document.getElementById("inquiry-modal").classList.add("active");
}

function closeModal() {
  document.getElementById("inquiry-modal").classList.remove("active");
}

function selectTier(el) {
  document.querySelectorAll(".tier-opt").forEach(o => o.classList.remove("sel"));
  el.classList.add("sel");
  selectedTier = el.dataset.tier;
}

async function submitInquiry() {
  const name = document.getElementById("inquiry-name").value;
  const phone = document.getElementById("inquiry-phone").value;
  const email = document.getElementById("inquiry-email").value;
  const item = document.getElementById("inquiry-item").value;
  const quantity = document.getElementById("inquiry-quantity").value;

  if (!name || !phone) {
    document.getElementById("status-msg").innerText = "Please fill in name and phone.";
    return;
  }

  const payload = {
    inquirer_name: name,
    inquirer_phone: phone,
    inquirer_email: email || null,
    item: item || null,
    order_scale: selectedTier || null,
    quantity: quantity || null,
    distributor_id: selectedContactType === "distributor" ? selectedContactId : null,
    buyer_id: selectedContactType === "buyer" ? selectedContactId : null,
    contact_type: selectedContactType,
    inquirer_id: currentUser ? currentUser.id : null
  };

  if (!navigator.onLine) {
    queueInquiry(payload, selectedContactName, selectedContactType);
    document.getElementById("status-msg").innerText = "No connection — saved, will send automatically.";
    clearForm();
    setTimeout(closeModal, 2000);
    return;
  }

  const { error } = await sb.from("inquiries").insert(payload);
  if (error) {
    queueInquiry(payload, selectedContactName, selectedContactType);
    document.getElementById("status-msg").innerText = "Connection issue — saved, will send automatically.";
    clearForm();
    setTimeout(closeModal, 2000);
    return;
  }

  saveInquiryToHistory(selectedContactName, selectedContactType);
  fetch(BACKEND + "/notify-inquiry", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      secret: SECRET, name, phone, email, item,
      orderScale: selectedTier, quantity,
      contactedName: selectedContactName,
      contactType: selectedContactType
    }),
  }).catch(() => {});

  document.getElementById("status-msg").innerText = "Sent! We'll be in touch.";
  clearForm();
  setTimeout(closeModal, 1500);
}

function clearForm() {
  document.getElementById("inquiry-name").value = "";
  document.getElementById("inquiry-phone").value = "";
  document.getElementById("inquiry-email").value = "";
  document.getElementById("inquiry-item").value = "";
  document.getElementById("inquiry-quantity").value = "";
  document.querySelectorAll(".tier-opt").forEach(o => o.classList.remove("sel"));
  selectedTier = "";
}

// ---------- Dispute Modal ----------
let disputeTargetId = "";
let disputeTargetName = "";

function openDisputeModal(distributorId, distributorName) {
  disputeTargetId = distributorId;
  disputeTargetName = distributorName;
  document.getElementById("dispute-target-name").innerText = distributorName;
  document.getElementById("dispute-status-msg").innerText = "";
  document.getElementById("dispute-modal").classList.add("active");
}

function closeDisputeModal() {
  document.getElementById("dispute-modal").classList.remove("active");
}

async function submitDispute() {
  const submittedBy = document.getElementById("dispute-submitted-by").value;
  const phone = document.getElementById("dispute-phone").value;
  const description = document.getElementById("dispute-description").value;

  if (!submittedBy || !phone || !description) {
    document.getElementById("dispute-status-msg").innerText = "Please fill in all fields.";
    return;
  }

  const { error } = await sb.from("disputes").insert({
    distributor_id: disputeTargetId,
    submitted_by: submittedBy,
    submitted_phone: phone,
    description: description,
    status: "Pending"
  });

  if (error) {
    document.getElementById("dispute-status-msg").innerText = "Something went wrong. Try again.";
    return;
  }

  document.getElementById("dispute-status-msg").innerText = "Submitted for review. Thank you.";
  document.getElementById("dispute-submitted-by").value = "";
  document.getElementById("dispute-phone").value = "";
  document.getElementById("dispute-description").value = "";
  setTimeout(closeDisputeModal, 1800);
}

// Load approved dispute counts
sb.from("disputes").select("distributor_id").eq("status", "Approved").then(({ data }) => {
  const counts = {};
  (data || []).forEach(d => { counts[d.distributor_id] = (counts[d.distributor_id] || 0) + 1; });
  Object.keys(counts).forEach(distributorId => {
    const el = document.getElementById("dispute-count-" + distributorId);
    if (el) {
      const span = document.createElement("span");
      span.className = "dispute-count";
      span.innerText = counts[distributorId] + " dispute" + (counts[distributorId] > 1 ? "s" : "") + " on record";
      el.appendChild(span);
    }
  });
});
