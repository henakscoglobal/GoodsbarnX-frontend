// ==========================================================================
// GoodsbarnX — app.js
// V1.8.2.6.4 — AUTH RESOLUTION TRACE BOOT BOUNDARY
//
// Global state declarations, application initialization and inquiry history.
//
// IMPORTANT:
// app.js MUST remain the LAST external JS file loaded in index.html.
//
// V1.8.2.6.4 change:
// Authentication context resolution is completed before the rest of the
// application initialization proceeds.
//
// This is NOT an Allocation upgrade.
// Allocation runtime remains V1.8.2.6.
// ==========================================================================


// --------------------------------------------------------------------------
// Global state
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

let cart = JSON.parse(
  localStorage.getItem("goodsbarnx_cart") || "[]"
);


// --------------------------------------------------------------------------
// Application initialization
// --------------------------------------------------------------------------

(async () => {

  console.log(
    "GoodsbarnX initializing — V1.8.2.6.4 Auth Resolution Trace"
  );

  try {

    /*
     * ----------------------------------------------------------------------
     * STEP 1
     * Wait for the authoritative Auth Resolution Boundary.
     *
     * auth.js is loaded before app.js and exposes the promise.
     * This prevents Allocation or downstream application code from racing
     * against currentUser resolution.
     * ----------------------------------------------------------------------
     */

    if (
      window.goodsbarnxAuthResolutionPromise &&
      typeof window.goodsbarnxAuthResolutionPromise.then === "function"
    ) {

      await window.goodsbarnxAuthResolutionPromise;

    } else if (
      typeof loadCurrentUser === "function"
    ) {

      /*
       * Defensive fallback.
       * Normally unreachable because auth.js initializes the promise.
       */

      try {
        await loadCurrentUser();
      } catch (error) {
        console.error(
          "GoodsbarnX auth resolution failed:",
          error
        );
      }
    }


    /*
     * ----------------------------------------------------------------------
     * STEP 2
     * Supabase connectivity check.
     *
     * This is deliberately AFTER auth resolution.
     * The connectivity test must not prevent the auth boundary from
     * producing its diagnostic trace.
     * ----------------------------------------------------------------------
     */

    try {

      if (typeof testSupabaseConnection === "function") {
        await testSupabaseConnection();
      }

    } catch (error) {

      console.error(
        "GoodsbarnX Supabase connection test failed:",
        error
      );

    }


    /*
     * ----------------------------------------------------------------------
     * STEP 3
     * Resolve session for application presentation.
     * ----------------------------------------------------------------------
     */

    let session = null;

    try {

      const {
        data: { session: activeSession },
        error
      } = await sb.auth.getSession();

      if (error) {
        console.error(
          "GoodsbarnX session lookup failed:",
          error
        );
      } else {
        session = activeSession;
      }

    } catch (error) {

      console.error(
        "GoodsbarnX session lookup exception:",
        error
      );
    }


    /*
     * ----------------------------------------------------------------------
     * STEP 4
     * Present authenticated application state.
     *
     * currentUser has already been resolved by the Auth Boundary.
     * ----------------------------------------------------------------------
     */

    if (session && currentUser) {

      const authShell =
        document.getElementById("auth-shell");

      const app =
        document.getElementById("app");

      if (authShell) {
        authShell.classList.add("hidden");
      }

      if (app) {
        app.style.display = "block";
      }

      if (typeof updateGreeting === "function") {
        updateGreeting();
      }


      /*
       * Distributor-specific presentation.
       */

      if (
        currentUser &&
        String(currentUser.role || "").toLowerCase() ===
          "distributor"
      ) {

        if (
          typeof openDistributorTools === "function"
        ) {
          openDistributorTools();
        }
      }
    }


    /*
     * ----------------------------------------------------------------------
     * STEP 5
     * Existing marketplace initialization.
     *
     * These functions remain unchanged.
     * ----------------------------------------------------------------------
     */

    if (
      typeof loadDistributorsAndBuyers === "function"
    ) {

      await loadDistributorsAndBuyers();

    }


    /*
     * ----------------------------------------------------------------------
     * STEP 6
     * Cart state.
     * ----------------------------------------------------------------------
     */

    if (
      typeof updateCartBadge === "function"
    ) {

      updateCartBadge();

    }


    /*
     * ----------------------------------------------------------------------
     * STEP 7
     * Existing delayed presentation refresh.
     * ----------------------------------------------------------------------
     */

    setTimeout(() => {

      if (
        typeof loadDistributors === "function"
      ) {
        loadDistributors();
      }

      if (
        typeof loadBuyers === "function"
      ) {
        loadBuyers();
      }

      if (
        typeof updateStats === "function"
      ) {
        updateStats();
      }

    }, 500);


    console.log(
      "GoodsbarnX initialized successfully"
    );

  } catch (error) {

    console.error(
      "GoodsbarnX initialization failed:",
      error
    );

  }

})();


// --------------------------------------------------------------------------
// Inquiry history
// --------------------------------------------------------------------------

function renderHistory() {

  const history =
    JSON.parse(
      localStorage.getItem(
        "goodsbarnx_history"
      ) || "[]"
    );

  const container =
    document.getElementById(
      "history-list"
    );

  if (!container) return;

  if (!history.length) {

    container.innerHTML =
      '<div class="loading-text">No inquiries yet.</div>';

    return;
  }

  container.innerHTML =
    history.map(function (h) {

      return `
        <div class="manifest">
          <div class="manifest-top">

            <div>

              <div class="m-name">
                ${h.name}
              </div>

              <div class="m-loc">
                ${h.type} ·
                ${new Date(h.date).toLocaleDateString()}
              </div>

            </div>

            <span
              class="stamp-badge"
              style="border-color:var(--ok); color:var(--ok);"
            >
              SENT
            </span>

          </div>
        </div>
      `;

    }).join("");
}


// --------------------------------------------------------------------------
// Greeting
// --------------------------------------------------------------------------

function updateGreeting() {

  const greetingElement =
    document.getElementById(
      "greeting-name"
    );

  if (!greetingElement) return;

  if (currentUser) {

    const displayName =
      currentUser.business_name ||
      currentUser.full_name ||
      "User";

    greetingElement.textContent =
      displayName;

  } else {

    greetingElement.textContent =
      "User";
  }
}


window.updateGreeting =
  updateGreeting;


console.log(
  "GoodsbarnX app loaded successfully — V1.8.2.6.4"
);
