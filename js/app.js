// ==========================================================================
// GoodsbarnX — app.js
// Global state declarations + application initialization.
// Plain global script. Loads LAST (Canon §10).
//
// V1.8.2.6 remediation Phase 1+2:
//   - Removed dead calls: loadDistributors(), loadBuyers(), openDistributorTools().
//     None of these symbols existed anywhere in the runtime; the guarded calls
//     silently no-op'd, hiding the defect (audit §A.4, §A.5, §H-6).
//   - Removed the duplicate renderHistory() (inquiries.js owns inquiry history
//     per Canon §12; the Supabase live ledger lands there in File 8).
//   - Removed the duplicate updateGreeting() (market.js will delete its copy
//     in File 5; app.js is the canonical owner of the greeting).
//   - Market refresh is now owned by market.js via registerScreenLoader.
//     app.js no longer schedules deferred market reloads.
//
// V1.8.2.6.5: loadCurrentUser() remains the single authentication execution
// boundary. config.js's testSupabaseConnection() is a diagnostic, not a gate.
// ==========================================================================

// --------------------------------------------------------------------------
// GLOBAL APPLICATION STATE
//
// Declared once, at file scope, so that every module reads/writes the same
// identifiers. Consumers must not shadow these names.
// --------------------------------------------------------------------------

let selectedSignupRole = "buyer";
let currentUser = null;
let productImageFile = null;
let allDistributors = [];
let allBuyers = [];
let activeCategory = "All";
let selectedContactName = "";
let selectedContactType = "";
let selectedContactId = "";
let selectedTier = "";
let userFavourites = new Set();
let disputeTargetId = "";
let disputeTargetName = "";

let cart = [];
try {
  cart = JSON.parse(localStorage.getItem("goodsbarnx_cart") || "[]");
  if (!Array.isArray(cart)) cart = [];
} catch (error) {
  console.warn("[GoodsbarnX/app] cart localStorage was not valid JSON; reset to empty.");
  cart = [];
}

// --------------------------------------------------------------------------
// GREETING
//
// app.js owns this function. market.js's duplicate will be removed in File 5.
// --------------------------------------------------------------------------

function updateGreeting() {
  const el = document.getElementById("greeting-name");
  if (!el) return;

  if (currentUser) {
    const displayName =
      currentUser.business_name ||
      currentUser.full_name ||
      "User";
    el.textContent = displayName;
  } else {
    el.textContent = "User";
  }
}

// --------------------------------------------------------------------------
// APPLICATION INITIALIZATION
//
// Order:
//   1. Resolve current user (auth.js boundary).
//   2. Reveal the app shell if authenticated.
//   3. Greet the user.
//   4. Confirm Supabase connectivity as a diagnostic.
//   5. Load distributors and buyers once for the initial Market render.
//   6. Update cart badge.
//   7. Register default screen loaders as a safety net for any module that
//      did not register its own loader (registered modules override these).
// --------------------------------------------------------------------------

(async () => {
  console.log("[GoodsbarnX] initializing — V1.8.2.6 (Phase 1+2)");

  try {
    // 1. Auth resolution — the single execution boundary.
    try {
      await loadCurrentUser();
    } catch (error) {
      console.error("[GoodsbarnX] auth resolution failed:", error);
    }

    // 2. Reveal app shell if authenticated.
    if (currentUser) {
      const authShell = document.getElementById("auth-shell");
      const loginShell = document.getElementById("login-shell");
      const app = document.getElementById("app");
      if (authShell) authShell.classList.add("hidden");
      if (loginShell) loginShell.classList.add("hidden");
      if (app) app.style.display = "block";
    }

    // 3. Greet.
    updateGreeting();

    // 4. Connectivity diagnostic (config.js fires its own on DOMContentLoaded;
    //    this second call runs after auth so the log ordering is deterministic).
    try {
      await testSupabaseConnection();
    } catch (error) {
      console.error("[GoodsbarnX] Supabase connection test failed:", error);
    }

    // 5. Initial Market render.
    if (typeof loadDistributorsAndBuyers === "function") {
      try {
        await loadDistributorsAndBuyers();
      } catch (error) {
        console.error("[GoodsbarnX] initial market load failed:", error);
      }
    }

    // 6. Cart badge.
    if (typeof updateCartBadge === "function") {
      updateCartBadge();
    }

    // 7. Safety-net screen loaders. Registered modules override these.
    registerDefaultScreenLoaders();

    console.log("[GoodsbarnX] initialized successfully");
  } catch (error) {
    console.error("[GoodsbarnX] initialization failed:", error);
  }
})();

// --------------------------------------------------------------------------
// DEFAULT SCREEN LOADERS
//
// Registered only if a feature module has not already registered a loader
// for the same screen name. This ensures showScreen() never becomes a
// silent no-op after File 2's registry change while other modules are still
// being migrated (Phase 1+2 is an intermediate state by design).
//
// These are named fallbacks, not silent fallbacks (Canon §38-2):
// each one logs which module is expected to register the real loader.
// --------------------------------------------------------------------------

function registerDefaultScreenLoaders() {
  if (typeof registerScreenLoader !== "function") return;

  const fallbacks = [
    ["market",    "market.js",    "loadDistributorsAndBuyers"],
    ["inquiries", "inquiries.js", null],
    ["trust",     "trust.js",     "loadTrustData"],
    ["profile",   "profile.js",   "loadProfile"],
    ["products",  "products.js",  "loadProductsManagement"],
    ["staff",     "staff.js",     "loadStaff"],
    ["agent",     "agent.js",     "loadMyAgentRelationships"],
    ["upgrade",   "upgrade.js",   "loadUpgradeScreen"],
    ["cart",      "cart.js",      "renderCart"],
    ["relationship", "relationship.js", null]
  ];

  fallbacks.forEach(([screen, owner, fnName]) => {
    if (getScreenLoader(screen)) return; // real loader already registered
    if (fnName && typeof window[fnName] === "function") {
      registerScreenLoader(screen, window[fnName]);
    } else {
      registerScreenLoader(screen, () => {
        console.warn(
          "[GoodsbarnX/app] fallback loader for '" + screen + "' invoked; " +
          "expected owner: " + owner + "."
        );
      });
    }
  });
}

// --------------------------------------------------------------------------
// EXPORTS
// --------------------------------------------------------------------------

window.updateGreeting = updateGreeting;
window.registerDefaultScreenLoaders = registerDefaultScreenLoaders;

console.log("[GoodsbarnX] app.js loaded.");
