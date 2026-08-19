// ==========================================================================
// GoodsbarnX — ui.js
// Navigation, modal open/close, and small UI helpers.
// Plain global script — depends on js/config.js (for `sb`) being loaded first.
// Functions here are called directly from onclick="" in index.html, so they
// must NOT be wrapped in anything that hides them from the global scope.
// ==========================================================================

// ---------- Navigation ----------

function showScreen(name) {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  const screenEl = document.getElementById("screen-" + name);
  if (screenEl) screenEl.classList.add("active");

  document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("active"));
  const navItem = document.getElementById("nav-" + name);
  if (navItem) navItem.classList.add("active");

  window.scrollTo(0, 0);

  if (name === "inquiries") renderHistory();
  if (name === "trust") loadTrustData();
  if (name === "profile") loadProfile();
  if (name === "products") loadProductsManagement();
  if (name === "staff") loadStaff();
  if (name === "upgrade") loadUpgradeScreen();
  if (name === "cart") renderCart();
}

// ---------- Search / category filters (UI-only parts) ----------

function toggleSearchClear() {
  document.getElementById("search-clear").style.display =
    document.getElementById("search-input").value.trim() ? "block" : "none";
}

function clearSearch() {
  document.getElementById("search-input").value = "";
  toggleSearchClear();
  applyFilters();
}

function selectCategory(cat, el) {
  activeCategory = cat;
  document.querySelectorAll(".category-card").forEach(c => c.classList.remove("active"));
  el.classList.add("active");
  applyFilters();
}

function selectTier(el) {
  document.querySelectorAll(".tier-opt").forEach(o => o.classList.remove("sel"));
  el.classList.add("sel");
  selectedTier = el.dataset.tier;
}

// ---------- Inquiry modal ----------

function openModal(id, name, type) {
  selectedContactId = id;
  selectedContactName = name;
  selectedContactType = type;
  document.getElementById("modal-title").innerText = "Contact " + name;
  document.getElementById("inquiry-modal").classList.add("active");
}

function closeModal() {
  document.getElementById("inquiry-modal").classList.remove("active");
}

// ---------- Dispute modal ----------

function openDisputeModal(id, name) {
  disputeTargetId = id;
  disputeTargetName = name;
  document.getElementById("dispute-target-name").innerText = name;
  document.getElementById("dispute-modal").classList.add("active");
}

function closeDisputeModal() {
  document.getElementById("dispute-modal").classList.remove("active");
}

// ---------- Storefront modal ----------

function closeStorefrontModal() {
  document.getElementById("storefront-modal").classList.remove("active");
}

// ---------- Add product modal ----------

function openAddProductModal() {
  document.getElementById("add-product-modal").classList.add("active");
}

function closeAddProductModal() {
  document.getElementById("add-product-modal").classList.remove("active");
}

function showCategoryFields() {
  const category = document.getElementById("prod-category").value;
  const container = document.getElementById("category-specific-fields");

  const fields = {
    "Auto Parts": `<div class="field"><label>Vehicle Make</label><input type="text" id="ap-make" /></div><div class="field"><label>Model</label><input type="text" id="ap-model" /></div><div class="field"><label>Year</label><input type="text" id="ap-year" /></div>`,
    "Building Materials": `<div class="field"><label>Brand</label><input type="text" id="bm-brand" /></div><div class="field"><label>Grade</label><input type="text" id="bm-grade" /></div>`,
    "Agriculture": `<div class="field"><label>Crop/Product</label><input type="text" id="ag-crop" /></div><div class="field"><label>Grade</label><input type="text" id="ag-grade" /></div>`,
    "Pharma": `<div class="field"><label>Active Ingredient</label><input type="text" id="ph-ingredient" /></div><div class="field"><label>NAFDAC Number</label><input type="text" id="ph-nafdac" /></div>`,
    "Electronics": `<div class="field"><label>Brand</label><input type="text" id="el-brand" /></div><div class="field"><label>Model</label><input type="text" id="el-model" /></div>`
  };

  container.innerHTML = fields[category] || "";
}

function previewProductImage() {
  const input = document.getElementById("prod-image-input");
  const preview = document.getElementById("prod-image-preview");
  if (input.files && input.files[0]) {
    productImageFile = input.files[0];
    const reader = new FileReader();
    reader.onload = (e) => {
      preview.style.backgroundImage = `url('${e.target.result}')`;
      preview.classList.add("has-image");
    };
    reader.readAsDataURL(productImageFile);
  }
}
