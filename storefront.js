// GoodsbarnX – Storefront Module

function openStorefrontModal(distId) {
  document.getElementById("storefront-content").innerHTML = '<div class="loading-text">Loading storefront...</div>';
  document.getElementById("storefront-modal").classList.add("active");
  loadStorefront(distId);
}

function closeStorefrontModal() {
  document.getElementById("storefront-modal").classList.remove("active");
}

async function loadStorefront(distId) {
  const { data: dist } = await sb.from("distributor_profiles").select("*").eq("id", distId).single();
  const { data: certs } = await sb.from("certifications").select("*").eq("distributor_id", distId);
  const { data: ratings } = await sb.from("ratings").select("*").eq("distributor_id", distId).order("created_at", { ascending: false });
  const { data: products } = await sb.from("products").select("*").eq("distributor_id", distId).order("created_at", { ascending: false });

  if (!dist) {
    document.getElementById("storefront-content").innerHTML = '<div class="loading-text">Distributor not found.</div>';
    return;
  }

  // Trade Score
  let score = 60;
  if (dist.verification_tier === "association") score += 20;
  else if (dist.verification_tier === "market board") score += 15;
  if (ratings && ratings.length > 0) {
    const avg = ratings.reduce((sum, r) => sum + r.score, 0) / ratings.length;
    score += Math.round(avg * 4);
  }
  score = Math.min(100, score);

  const available = products ? products.filter(p => p.stock_quantity > 0 && p.status === "active") : [];
  const restocking = products ? products.filter(p => p.stock_quantity === 0 && p.status === "active") : [];
  const bulkDeals = products ? products.filter(p => p.bulk_discount === true) : [];
  const newArrivals = products ? [...products].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 5) : [];
  const avgRating = ratings && ratings.length > 0 ? (ratings.reduce((sum, r) => sum + r.score, 0) / ratings.length).toFixed(1) : "—";

  const html = `
    <div class="storefront-header">
      <div>
        <h3>${dist.business_name}</h3>
        <div style="font-size:12px; color:rgba(18,21,28,0.6);">${dist.location || "Onitsha"} · ${dist.market || "Southeast"} · Nationwide</div>
      </div>
      <div>
        <span class="storefront-badge">✓ Verified</span>
        <span style="font-size:11px; color:var(--ok);">🟢 Trading Now</span>
      </div>
    </div>

    <div style="display:flex; gap:16px; margin-bottom:12px;">
      <div class="storefront-score">Trade Score: ${score}/100</div>
      <div style="font-size:12px; color:rgba(18,21,28,0.6);">${products ? products.length : 0} products · ${ratings ? ratings.length : 0} buyers</div>
    </div>

    <div style="display:flex; gap:8px; margin-bottom:16px;">
      <button class="btn-inquire" onclick="openModal('${distId}','${dist.business_name}','distributor')">Buy Now</button>
      <button class="btn-inquire" style="background:var(--ink-2); color:var(--brass-bright); border:1px solid var(--brass);" onclick="openModal('${distId}','${dist.business_name}','distributor')">Request Quote</button>
      <button class="btn-inquire" style="background:#25D366;" onclick="openWhatsApp('${dist.profiles?.phone || ''}','${dist.business_name}')">Chat</button>
    </div>

    <div class="section-label">SUPPLY WALL</div>
    <div class="supply-tabs">
      <div class="supply-tab active" onclick="switchSupplyTab(event, 'available','${distId}')">Available (${available.length})</div>
      <div class="supply-tab" onclick="switchSupplyTab(event, 'restocking','${distId}')">Restocking (${restocking.length})</div>
      <div class="supply-tab" onclick="switchSupplyTab(event, 'coming','${distId}')">Coming Soon</div>
    </div>
    <div id="supply-products-${distId}">${renderProductMiniCards(available, distId, dist.business_name)}</div>

    <div class="section-label">BEST BULK DEALS</div>
    ${bulkDeals.length > 0 ? renderProductMiniCards(bulkDeals, distId, dist.business_name) : '<p class="loading-text">No bulk deals currently.</p>'}

    <div class="section-label">NEW ARRIVALS</div>
    ${newArrivals.length > 0 ? renderProductMiniCards(newArrivals, distId, dist.business_name) : '<p class="loading-text">No new arrivals.</p>'}

    <div class="section-label">SOURCE FOR ME</div>
    <p style="font-size:12px; color:rgba(18,21,28,0.6); margin-bottom:12px;">Describe what you need and we'll source it for you.</p>
    <button class="btn-inquire" style="width:100%; margin-bottom:16px;" onclick="openModal('${distId}','${dist.business_name}','distributor')">Request Sourcing</button>

    <div class="section-label">TRUST &amp; TRADE REPUTATION</div>
    <div style="display:flex; gap:8px; margin-bottom:12px;">
      <div class="storefront-badge">Verified</div>
      <div class="storefront-badge" style="background:var(--stamp);">Fulfillment: 98%</div>
      <div class="storefront-badge" style="background:var(--brass);">Response: fast</div>
    </div>
    <div class="star-rating">${"★".repeat(Math.round(avgRating))}${"☆".repeat(5 - Math.round(avgRating))} ${avgRating}</div>

    <div class="section-label">HOW WE TRADE</div>
    <div style="display:flex; flex-wrap:wrap; gap:8px; font-size:12px; margin-bottom:12px;">
      ${products && products.length > 0 ? `<span>📦 MOQ: ${products[0].moq || "1"}</span><span>📝 Terms: ${products[0].trade_terms || "Negotiable"}</span><span>🚚 Delivery: ${products[0].delivery_available ? "Yes" : "No"}</span><span>⏱ Lead: ${products[0].lead_time || "2-3 days"}</span>` : ""}
    </div>

    <div class="section-label">OUR SPECIALTIES</div>
    <div style="display:flex; flex-wrap:wrap; gap:6px; margin-bottom:12px;">
      ${dist.category ? `<span class="storefront-badge">${dist.category}</span>` : ""}
      ${certs && certs.length > 0 ? certs.map(c => `<span class="storefront-badge">${c.name}</span>`).join(" ") : ""}
    </div>

    <div class="section-label">MARKETS WE SERVE</div>
    <p style="font-size:12px; margin-bottom:12px;">${dist.location || "Onitsha"}, ${dist.market || "Main Market"}, Nigeria</p>

    <div class="section-label">ABOUT THE BUSINESS</div>
    <p style="font-size:12px; color:rgba(18,21,28,0.7); margin-bottom:12px;">${dist.description || "Reliable distributor with years of experience in the industry."}</p>
    <p style="font-size:12px;">📍 ${dist.shop_address || "Visit our shop at the main market."}</p>
  `;

  document.getElementById("storefront-content").innerHTML = html;
}

function renderProductMiniCards(products, distributorId, distributorName) {
  return products.map(p => `
    <div class="product-card-mini">
      <img src="${p.product_image || p.image_url || ''}" alt="" />
      <div style="flex:1;">
        <div style="font-weight:600; font-size:13px;">${p.name}</div>
        <div style="font-size:11px; color:rgba(18,21,28,0.6);">${p.price ? "₦" + p.price : "Contact"} | MOQ: ${p.moq || 1}</div>
      </div>
      <button class="btn-add-to-cart" style="padding:4px 8px; font-size:10px;" onclick="addToCart('${p.id}','${p.name}',${p.price || 0},${p.moq || 1},${p.stock_quantity || 0},'${p.product_image || p.image_url || ''}','${distributorId}','${distributorName}')">+ Cart</button>
    </div>
  `).join("");
}

async function switchSupplyTab(event, tab, distId) {
  const tabs = document.querySelectorAll(".supply-tab");
  tabs.forEach(t => t.classList.remove("active"));
  event.target.classList.add("active");

  const { data: products } = await sb.from("products").select("*").eq("distributor_id", distId).order("created_at", { ascending: false });
  let filtered;
  if (tab === "available") filtered = products.filter(p => p.stock_quantity > 0 && p.status === "active");
  else if (tab === "restocking") filtered = products.filter(p => p.stock_quantity === 0 && p.status === "active");
  else filtered = [];

  document.getElementById(`supply-products-${distId}`).innerHTML = renderProductMiniCards(filtered, distId, "");
}

function inquireProduct(productName, distributorId) {
  closeStorefrontModal();
  selectedContactId = distributorId;
  selectedContactName = "";
  selectedContactType = "distributor";
  document.getElementById("modal-title").innerText = "Inquire about " + productName;
  document.getElementById("inquiry-item").value = productName;
  document.getElementById("inquiry-modal").classList.add("active");
}
