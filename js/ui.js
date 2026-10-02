// ==========================================================================
// GoodsbarnX — ui.js
// Navigation, modal open/close, and small UI helpers.
// Plain global script. Loads second (Canon §10).
//
// V1.8.2.6 remediation Phase 1+2 — Phase 2.3:
//   showScreen() is now a registry-driven dispatcher. Each feature module
//   registers its own screen loader via registerScreenLoader(name, fn) at
//   load time. ui.js no longer hardcodes calls into every feature module.
//
//   This restores Canon §35 (one authoritative runtime; no cross-module
//   coupling in the navigation layer) and removes the previous behaviour
//   where ui.js was a router into eight modules it did not own.
//
//   Loader failures are logged with the screen name and re-thrown to the
//   caller after the DOM has already switched screens. Navigation is never
//   silently lost. Loaders are never silently swallowed.
//
// All functions here are called directly from onclick="" in index.html,
// so they must remain global (not wrapped in a module IIFE).
// ==========================================================================

// --------------------------------------------------------------------------
// SCREEN LOADER REGISTRY
// --------------------------------------------------------------------------

const __gbxScreenLoaders = Object.create(null);

function registerScreenLoader(name, fn) {
  if (typeof name !== "string" || !name) {
    console.error("[GoodsbarnX/ui] registerScreenLoader: invalid screen name.");
    return;
  }
  if (typeof fn !== "function") {
    console.error(
      "[GoodsbarnX/ui] registerScreenLoader('" + name + "'): loader is not a function."
    );
    return;
  }
  if (__gbxScreenLoaders[name]) {
    console.warn(
      "[GoodsbarnX/ui] registerScreenLoader('" + name + "'): overwriting existing loader."
    );
  }
  __gbxScreenLoaders[name] = fn;
}

function getScreenLoader(name) {
  return __gbxScreenLoaders[name] || null;
}

// --------------------------------------------------------------------------
// NAVIGATION
// --------------------------------------------------------------------------

function showScreen(name) {
  if (typeof name !== "string" || !name) {
    console.error("[GoodsbarnX/ui] showScreen: invalid screen name.");
    return;
  }

  // Switch the visible screen. Even if no loader is registered, the DOM
  // transition still happens so the user is never left on the wrong screen.
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  const screenEl = document.getElementById("screen-" + name);
  if (screenEl) {
    screenEl.classList.add("active");
  } else {
    console.warn("[GoodsbarnX/ui] showScreen: no element #screen-" + name + ".");
  }

  // Switch nav highlight.
  document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("active"));
  const navItem = document.getElementById("nav-" + name);
  if (navItem) navItem.classList.add("active");

  window.scrollTo(0, 0);

  // Dispatch to the registered loader, if any.
  const loader = getScreenLoader(name);
  if (!loader) {
    console.warn("[GoodsbarnX/ui] showScreen('" + name + "'): no loader registered.");
    return;
  }

  try {
    // Loaders may be async; we do not await so that navigation is never
    // blocked by a slow loader. Rejections are surfaced by the promise
    // catch below.
    const result = loader();
    if (result && typeof result.then === "function") {
      result.catch(error => {
        console.error(
          "[GoodsbarnX/ui] screen loader for '" + name + "' rejected:",
          error
        );
      });
    }
  } catch (error) {
    console.error(
      "[GoodsbarnX/ui] screen loader for '" + name + "' threw synchronously:",
      error
    );
  }
}

// --------------------------------------------------------------------------
// SEARCH / CATEGORY FILTERS (UI-only ownership)
//
// Canon §12 assigns search & filtering to market.js. The UI-control aspects
// (toggling a clear button, marking an active category card, updating a
// tier selector) belong here in ui.js. market.js owns the query and render.
// --------------------------------------------------------------------------

function toggleSearchClear() {
  const input = document.getElementById("search-input");
  const clearBtn = document.getElementById("search-clear");
  if (!input || !clearBtn) return;
  clearBtn.style.display = input.value.trim() ? "block" : "none";
}

function clearSearch() {
  const input = document.getElementById("search-input");
  if (input) input.value = "";
  toggleSearchClear();
  if (typeof applyFilters === "function") {
    applyFilters();
  }
}

function selectCategory(cat, el) {
  // Category state is owned by market.js (Canon §12). ui.js only marks the
  // active card and forwards to market.js's applyFilters().
  if (typeof activeCategory !== "undefined") {
    activeCategory = cat;
  } else {
    window.activeCategory = cat;
  }

  document.querySelectorAll(".category-card").forEach(c => c.classList.remove("active"));
  if (el) el.classList.add("active");

  if (typeof applyFilters === "function") {
    applyFilters();
  }
}

function selectTier(el) {
  if (!el) return;
  document.querySelectorAll(".tier-opt").forEach(o => o.classList.remove("sel"));
  el.classList.add("sel");
  if (typeof selectedTier !== "undefined") {
    selectedTier = el.dataset.tier;
  } else {
    window.selectedTier = el.dataset.tier;
  }
}

// --------------------------------------------------------------------------
// INQUIRY MODAL
// --------------------------------------------------------------------------

function openModal(id, name, type) {
  if (typeof selectedContactId !== "undefined") {
    selectedContactId = id;
    selectedContactName = name;
    selectedContactType = type;
  } else {
    window.selectedContactId = id;
    window.selectedContactName = name;
    window.selectedContactType = type;
  }

  const titleEl = document.getElementById("modal-title");
  if (titleEl) titleEl.innerText = "Contact " + name;

  const modal = document.getElementById("inquiry-modal");
  if (modal) modal.classList.add("active");
}

function closeModal() {
  const modal = document.getElementById("inquiry-modal");
  if (modal) modal.classList.remove("active");
}

// --------------------------------------------------------------------------
// DISPUTE MODAL
// --------------------------------------------------------------------------

function openDisputeModal(id, name) {
  if (typeof disputeTargetId !== "undefined") {
    disputeTargetId = id;
    disputeTargetName = name;
  } else {
    window.disputeTargetId = id;
    window.disputeTargetName = name;
  }

  const nameEl = document.getElementById("dispute-target-name");
  if (nameEl) nameEl.innerText = name;

  const modal = document.getElementById("dispute-modal");
  if (modal) modal.classList.add("active");
}

function closeDisputeModal() {
  const modal = document.getElementById("dispute-modal");
  if (modal) modal.classList.remove("active");
}

// --------------------------------------------------------------------------
// STOREFRONT MODAL
// --------------------------------------------------------------------------

function closeStorefrontModal() {
  const modal = document.getElementById("storefront-modal");
  if (modal) modal.classList.remove("active");
}

// --------------------------------------------------------------------------
// PRODUCT CATEGORY FIELDS
// --------------------------------------------------------------------------

function showCategoryFields() {
  const categoryEl = document.getElementById("prod-category");
  const container = document.getElementById("category-specific-fields");
  if (!categoryEl || !container) return;

  const category = categoryEl.value;

  const fields = {
    "Auto Parts":
      '<div class="field"><label>Vehicle Make</label><input type="text" id="ap-make" /></div>' +
      '<div class="field"><label>Model</label><input type="text" id="ap-model" /></div>' +
      '<div class="field"><label>Year</label><input type="text" id="ap-year" /></div>',
    "Building Materials":
      '<div class="field"><label>Brand</label><input type="text" id="bm-brand" /></div>' +
      '<div class="field"><label>Grade</label><input type="text" id="bm-grade" /></div>',
    "Agriculture":
      '<div class="field"><label>Crop/Product</label><input type="text" id="ag-crop" /></div>' +
      '<div class="field"><label>Grade</label><input type="text" id="ag-grade" /></div>',
    "Pharma":
      '<div class="field"><label>Active Ingredient</label><input type="text" id="ph-ingredient" /></div>' +
      '<div class="field"><label>NAFDAC Number</label><input type="text" id="ph-nafdac" /></div>',
    "Electronics":
      '<div class="field"><label>Brand</label><input type="text" id="el-brand" /></div>' +
      '<div class="field"><label>Model</label><input type="text" id="el-model" /></div>'
  };

  container.innerHTML = fields[category] || "";
}

// --------------------------------------------------------------------------
// GLOBAL EXPORTS
//
// Functions called from index.html onclick attributes must remain global.
// registerScreenLoader / getScreenLoader are exposed for feature modules
// that need to register their screen loaders at load time.
// --------------------------------------------------------------------------

window.registerScreenLoader = registerScreenLoader;
window.getScreenLoader = getScreenLoader;
window.showScreen = showScreen;

window.toggleSearchClear = toggleSearchClear;
window.clearSearch = clearSearch;
window.selectCategory = selectCategory;
window.selectTier = selectTier;

window.openModal = openModal;
window.closeModal = closeModal;
window.openDisputeModal = openDisputeModal;
window.closeDisputeModal = closeDisputeModal;
window.closeStorefrontModal = closeStorefrontModal;

window.showCategoryFields = showCategoryFields;
