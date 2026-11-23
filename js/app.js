// ==========================================================================
// GoodsbarnX — app.js
// Global state declarations + application initialization.
// Plain global script. Loads LAST (Canon §10).
//
// V1.8.2.7 — Login remediation.
//   - app.js is the SOLE owner of `let selectedSignupRole`. index.html used
//     to declare it too; a duplicate top-level `let` across classic scripts
//     is a SyntaxError that stopped this entire file from executing.
//   - Boot reveals the app through showAppShell() (auth.js) instead of
//     toggling a `hidden` class on shells that do not use it.
//   - Removes the `auth-booting` veil once the session check settles
//     (success OR failure), so the auth screen can never stay invisible.
//   - testSupabaseConnection() is guarded (typeof) — it is a diagnostic.
//   - Listens for "auth-state-changed" so greeting/cart badge refresh after
//     login, signup and logout.
//
// Retained from V1.8.2.6: no dead calls, no duplicate renderHistory() or
// updateGreeting(), market refresh owned by market.js.
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
// app.js owns this function.
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
// AUTH STATE LISTENER
//
// auth.js dispatches "auth-state-changed" after every resolution/logout.
// --------------------------------------------------------------------------

window.addEventListener("auth-state-changed", function () {
  updateGreeting();
  if (typeof updateCartBadge === "function") {
    try { updateCartBadge(); } catch (error) { /* non-fatal */ }
  }
});

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
//   7. Register default screen loaders as a safety net.
// The auth screen is always un-veiled at the end, whatever happened above.
// --------------------------------------------------------------------------

(async () => {
  console.log("[GoodsbarnX] initializing — V1.8.2.7");

  try {
    // 1. Auth resolution — the single execution boundary.
    try {
      await loadCurrentUser();
    } catch (error) {
      console.error("[GoodsbarnX] auth resolution failed:", error);
    }

    // 2. Reveal app shell if authenticated.
    if (currentUser) {
      if (typeof window.showAppShell === "function") {
        window.showAppShell();
      } else {
        // auth.js failed to load; reveal manually so a valid session is not stranded.
        document.body.classList.remove("auth-active", "auth-booting");
        const authShell = document.getElementById("auth-shell");
        const app = document.getElementById("app");
        if (authShell) authShell.style.display = "none";
        if (app) app.style.display = "block";
      }
    } else {
      // Not authenticated: make sure the auth screen is visible.
      document.body.classList.remove("auth-booting");
    }

    // 3. Greet.
    updateGreeting();

    // 4. Connectivity diagnostic (optional; defined by config.js).
    if (typeof testSupabaseConnection === "function") {
      try {
        await testSupabaseConnection();
      } catch (error) {
        console.error("[GoodsbarnX] Supabase connection test failed:", error);
      }
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
  } finally {
    // Whatever happened, never leave the auth screen veiled.
    document.body.classList.remove("auth-booting");
  }
})();

// --------------------------------------------------------------------------
// DEFAULT SCREEN LOADERS
//
// Registered only if a feature module has not already registered a loader
// for the same screen name, so showScreen() never becomes a silent no-op.
// Each fallback names the module expected to own the real loader
// (Canon §38-2: named fallbacks, not silent fallbacks).
// --------------------------------------------------------------------------

function registerDefaultScreenLoaders() {
  if (typeof registerScreenLoader !== "function") return;
  if (typeof getScreenLoader !== "function") return;

  const fallbacks = [
    ["market",       "market.js",       "loadDistributorsAndBuyers"],
    ["inquiries",    "inquiries.js",    null],
    ["trust",        "trust.js",        "loadTrustData"],
    ["profile",      "profile.js",      "loadProfile"],
    ["products",     "products.js",     "loadProductsManagement"],
    ["staff",        "staff.js",        "loadStaff"],
    ["agent",        "agent.js",        "loadMyAgentRelationships"],
    ["upgrade",      "upgrade.js",      "loadUpgradeScreen"],
    ["cart",         "cart.js",         "renderCart"],
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
