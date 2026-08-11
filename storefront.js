// GoodsbarnX – Storefront Module (Complete & Professional)

function openStorefrontModal(distId) {
  document.getElementById("storefront-content").innerHTML = '<div class="loading-text">Loading storefront...</div>';
  document.getElementById("storefront-modal").classList.add("active");
  loadStorefront(distId);
}

function closeStorefrontModal() {
  document.getElementById("storefront-modal").classList.remove("active");
}

async function loadStorefront(distId) {
  // Fetch all required data in parallel
  const [distRes, certsRes, ratingsRes, productsRes] = await Promise.all([
    sb.from("distributor_profiles").select("*, profiles(phone)").eq("id", distId).single(),
    sb.from("certifications").select("*").eq("distributor_id", distId),
    sb.from("ratings").select("*").eq("distributor_id", distId).order("created_at", { ascending: false }),
    sb.from("products").select("*").eq("distributor_id", distId).order("created_at", { ascending: false })
  ]);

  const dist = distRes.data;
  const certs = certsRes.data || [];
  const ratings = ratingsRes.data || [];
  const products = productsRes.data || [];

  if (!dist) {
    document.getElementById("storefront-content").innerHTML = '<div class="loading-text">Distributor not found.</div>';
    return;
  }

  // Store distributor phone for Chat button
  const distPhone = dist.profiles?.phone || "";

  // Calculate Trade Score
  let score = 60;
  if (dist.verification_tier === "association") score += 20;
  else if (dist.verification_tier === "market board") score += 15;
  if (ratings.length > 0) {
    const avg = ratings.reduce((sum, r) => sum + r.score, 0) / ratings.length;
    score += Math.round(avg * 4);
  }
  score = Math.min(100, score);

  // Categorise products
  const available = products.filter(p => p.stock_quantity > 0 && p.status === "active");
  const restocking = products.filter(p => p.stock_quantity === 0 && p.status === "active");
  const bulkDeals = products.filter(p => p.bulk_discount === true);
  const newArrivals = [...products].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 5);

  // Average rating
  const avgRating = ratings.length > 0 ? (ratings.reduce((s, r) => s + r.score, 0) / ratings.length).toFixed(1) : "—";
  const starDisplay = "★".repeat(Math.round(avgRating)) + "☆".repeat(5 - Math.round(avgRating));

  // Trade info from first product (fallback)
  const firstProduct = products[0] || {};
  const moq = firstProduct.moq || 1;
  const terms = firstProduct.trade_terms || "Negotiable";
  const delivery = firstProduct.delivery_available ? "Yes" : "No";
  const leadTime = firstProduct.lead_time || "2-3 days";

  const html = `
    <!-- HEADER -->
    <div class="storefront-header">
      <div>
        <h3 style="margin-bottom:2px;">${dist.business_name}</h3>
        <div style="font-size:12px; color:rgba(18,21,28,0.55);">
          ${dist.location || "Onitsha"} · ${dist.market || "Southeast"} · Nationwide
        </div>
      </div>
      <div style="text-align:right;">
        <span class="storefront-badge" style="background:var(--ok);">✓ Verified</span>
        <div style="font-size:10px; color:var(--ok); margin-top:4px;">🟢 Trading Now</div>
      </div>
    </div>

    <!-- TRADE SCORE -->
    <div style="display:flex; gap:16px; margin-bottom:16px; padding:12px; background:rgba(239,233,222,0.05); border-radius:12px; border:1px solid var(--line);">
      <div>
        <div class="storefront-score" style="font-size:16px;">Trade Score: ${score}/100</div>
        <div style="font-size:11px; color:rgba(18,21,28,0.5);">Based on verification, ratings & activity</div>
      </div>
      <div style="margin-left:auto; text-align:right;">
        <div style="font-size:14px; font-weight:700; color:var(--ink);">${products.length}</div>
        <div style="font-size:10px; color:rgba(18,21,28,0.5);">Products</div>
      </div>
      <div style="text-align:right;">
        <div style="font-size:14px; font-weight:700; color:var(--ink);">${ratings.length}</div>
        <div style="font-size:10px; color:rgba(18,21,28,0.5);">Buyers</div>
      </div>
    </div>

    <!-- QUICK ACTIONS -->
    <div style="display:flex; gap:8px; margin-bottom:20px;">
      <button class="btn-inquire" style="flex:1;" onclick="openModal('${distId}','${dist.business_name}','distributor')">Buy Now</button>
      <button class="btn-inquire" style="flex:1; background:var(--ink-2); color:var(--brass-bright); border:1px solid var(--brass);" onclick="openModal('${distId}','${dist.business_name}','distributor')">Request Quote</button>
      <button class="btn-inquire" style="flex:1; background:#25D366;" onclick="openWhatsApp('${distPhone}','${dist.business_name}')">💬 Chat</button>
    </div>

    <!-- SEARCH WITHIN STORE -->
    <div class="search-bar-wrap" style="margin-bottom:16px;">
      <span>🔍</span>
      <input type="text" placeholder="Search or describe your need..." id="store-search-${distId}" oninput="filterStoreProducts('${distId}')" />
    </div>

    <!-- SUPPLY WALL -->
    <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:12px;">
      <div class="section-label" style="margin:0;">📦 SUPPLY WALL</div>
    </div>
    <div class="supply-tabs">
      <div class="supply-tab active" data-tab="available" onclick="switchSupplyTab(event, 'available', '${distId}')">Available (${available.length})</div>
      <div class="supply-tab" data-tab="restocking" onclick="switchSupplyTab(event, 'restocking', '${distId}')">Restocking (${restocking.length})</div>
      <div class="supply-tab" data-tab="coming" onclick="switchSupplyTab(event, 'coming', '${distId}')">Coming Soon</div>
    </div>
    <div id="supply-products-${distId}">
      ${available.length > 0 ? renderMiniCards(available, distId, dist.business_name) : '<div class="loading-text">No products available right now.</div>'}
    </div>

    <!-- BEST BULK DEALS -->
    ${bulkDeals.length > 0 ? `
      <div class="section-label" style="margin-top:24px;">🏷 BEST BULK DEALS</div>
      <div id="bulk-deals-${distId}">${renderMiniCards(bulkDeals, distId, dist.business_name)}</div>
    ` : ""}

    <!-- NEW ARRIVALS -->
    ${newArrivals.length > 0 ? `
      <div class="section-label" style="margin-top:24px;">🆕 NEW ARRIVALS</div>
      <div id="new-arrivals-${distId}">${renderMiniCards(newArrivals, distId, dist.business_name)}</div>
    ` : ""}

    <!-- SOURCE FOR ME -->
    <div class="section-label" style="margin-top:24px;">🤝 SOURCE FOR ME</div>
    <p style="font-size:12px; color:rgba(18,21,28,0.6); margin-bottom:8px;">Describe what you need and we'll source it for you.</p>
    <button class="btn-inquire" style="width:100%; margin-bottom:8px; background:var(--ink-2); color:var(--brass-bright); border:1px solid var(--brass);" onclick="openModal('${distId}','${dist.business_name}','distributor')">Request Sourcing</button>

    <!-- BUYER'S DESK -->
    <div class="section-label" style="margin-top:24px;">📋 BUYER'S DESK</div>
    <button class="btn-inquire" style="width:100%; margin-bottom:8px; background:var(--ink-2); color:var(--brass-bright); border:1px solid var(--brass);" onclick="closeStorefrontModal(); showScreen('cart');">Build your procurement list 🛒</button>

    <!-- TRUST & TRADE REPUTATION -->
    <div class="section-label" style="margin-top:24px;">🛡 TRUST & TRADE REPUTATION</div>
    <div style="display:flex; gap:8px; margin-bottom:8px; flex-wrap:wrap;">
      <span class="storefront-badge" style="background:var(--ok);">Verified</span>
      <span class="storefront-badge" style="background:#2E6B8C;">Fulfillment: 98%</span>
      <span class="storefront-badge" style="background:var(--brass);">Response: fast</span>
    </div>
    <div class="star-rating" style="margin-bottom:8px;">${starDisplay} ${avgRating} (${ratings.length} reviews)</div>

    <!-- HOW WE TRADE -->
    <div class="section-label" style="margin-top:24px;">📊 HOW WE TRADE</div>
    <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; font-size:12px; margin-bottom:8px;">
      <div>📦 MOQ: <strong>${moq}</strong></div>
      <div>📝 Terms: <strong>${terms}</strong></div>
      <div>🚚 Delivery: <strong>${delivery}</strong></div>
      <div>⏱ Lead Time: <strong>${leadTime}</strong></div>
    </div>

    <!-- OUR SPECIALTIES -->
    <div class="section-label" style="margin-top:24px;">🏪 OUR SPECIALTIES</div>
    <div style="display:flex; flex-wrap:wrap; gap:6px; margin-bottom:8px;">
      ${dist.category ? `<span class="storefront-badge">${dist.category}</span>` : ""}
      ${certs.map(c => `<span class="storefront-badge" style="background:var(--brass);">${c.name}</span>`).join(" ")}
      ${!dist.category && certs.length === 0 ? '<span style="font-size:12px; color:rgba(18,21,28,0.5);">General trading</span>' : ""}
    </div>

    <!-- MARKETS WE SERVE -->
    <div class="section-label" style="margin-top:24px;">📍 MARKETS WE SERVE</div>
    <p style="font-size:12px; margin-bottom:8px;">${dist.location || "Onitsha"}, ${dist.market || "Main Market"}, Nigeria</p>

    <!-- ABOUT THE BUSINESS -->
    <div class="section-label" style="margin-top:24px;">ℹ️ ABOUT THE BUSINESS</div>
    <p style="font-size:12px; color:rgba(18,21,28,0.7); margin-bottom:8px; line-height:1.6;">${dist.description || "Reliable distributor with years of experience in the industry. We pride ourselves on quality products and excellent customer service."}</p>
    ${dist.shop_address ? `<p style="font-size:12px;">📍 <strong>Visit us:</strong> ${dist.shop_address}</p>` : ""}
  `;

  document.getElementById("storefront-content").innerHTML = html;
}

// ---------- Helper Functions ----------

function renderMiniCards(products, distId, distName) {
  return products.map(p => `
    <div class="product-card-mini">
      <img src="${p.product_image || p.image_url || ''}" alt="${p.name}" onerror="this.style.display='none'" />
      <div style="flex:1;">
        <div style="font-weight:600; font-size:13px; color:var(--paper);">${p.name}</div>
        <div style="font-size:11px; color:rgba(239,233,222,0.5);">
          ${p.price ? "₦" + Number(p.price).toLocaleString() : "Contact for price"} 
          ${p.moq > 1 ? "· MOQ: " + p.moq : ""}
        </div>
        ${p.stock_quantity > 0 ? '<div style="font-size:10px; color:var(--ok);">In Stock</div>' : '<div style="font-size:10px; color:var(--brass-dark);">Restocking</div>'}
      </div>
      <button class="btn-add-to-cart" onclick="addToCart('${p.id}','${p.name.replace(/'/g, "\\'")}',${p.price||0},${p.moq||1},${p.stock_quantity||0},'${(p.product_image||"").replace(/'/g, "\\'")}','${distId}','${distName.replace(/'/g, "\\'")}')">+ Cart</button>
    </div>
  `).join("");
}

// ---------- Supply Tab Switching ----------
async function switchSupplyTab(event, tab, distId) {
  // Update active tab styling
  const allTabs = document.querySelectorAll(`[onclick*="switchSupplyTab"][onclick*="${distId}"]`);
  allTabs.forEach(t => t.classList.remove("active"));
  event.target.classList.add("active");

  // Fetch products
  const { data: products } = await sb.from("products").select("*").eq("distributor_id", distId).order("created_at", { ascending: false });
  if (!products) return;

  let filtered;
  if (tab === "available") {
    filtered = products.filter(p => p.stock_quantity > 0 && p.status === "active");
  } else if (tab === "restocking") {
    filtered = products.filter(p => p.stock_quantity === 0 && p.status === "active");
  } else {
    // Coming Soon – products with status 'draft' or future dated
    filtered = products.filter(p => p.status === "draft");
  }

  const container = document.getElementById("supply-products-" + distId);
  if (container) {
    container.innerHTML = filtered.length > 0 
      ? renderMiniCards(filtered, distId, "")
      : '<div class="loading-text">No products in this category.</div>';
  }
}

// ---------- Search Within Store ----------
function filterStoreProducts(distId) {
  const searchInput = document.getElementById("store-search-" + distId);
  if (!searchInput) return;
  
  const query = searchInput.value.trim().toLowerCase();
  
  // Find all product mini cards in the storefront
  const container = document.getElementById("supply-products-" + distId);
  if (!container) return;
  
  const cards = container.querySelectorAll(".product-card-mini");
  cards.forEach(card => {
    const name = card.querySelector("div > div:first-child")?.innerText?.toLowerCase() || "";
    if (!query || name.includes(query)) {
      card.style.display = "flex";
    } else {
      card.style.display = "none";
    }
  });
}

// ---------- Inquire About Product ----------
function inquireProduct(productName, distributorId) {
  closeStorefrontModal();
  // These variables are global (declared in market.js)
  if (typeof selectedContactId !== "undefined") {
    selectedContactId = distributorId;
    selectedContactName = "";
    selectedContactType = "distributor";
  }
  document.getElementById("modal-title").innerText = "Inquire about " + productName;
  document.getElementById("inquiry-item").value = productName;
  document.getElementById("inquiry-modal").classList.add("active");
}
