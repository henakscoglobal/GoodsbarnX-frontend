// ==========================================================================
// GoodsbarnX — app.js
// Global state declarations, app initialization, and inquiry history.
// Plain global script — MUST be the LAST js/ file loaded in index.html,
// since its init block calls functions (loadCurrentUser, loadDistributorsAndBuyers,
// updateCartBadge) that live in every other js/ file.
// V1.8.2.6.5 — Auth Resolution Execution Boundary.
// ==========================================================================

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
let cart = JSON.parse(localStorage.getItem("goodsbarnx_cart") || "[]");

(async () => {
  console.log("GoodsbarnX initializing — V1.8.2.6.5 Auth Resolution Execution Boundary");
  try {
    // V1.8.2.6.5: loadCurrentUser() is now the single authentication execution boundary.
    // Do NOT preflight sb.auth.getSession() here. That duplicate gate could block the
    // resolver before it publishes its own session-stage diagnostic.
    try {
      await loadCurrentUser();
    } catch (error) {
      console.error("GoodsbarnX auth resolution failed:", error);
    }

    if (currentUser) {
      const authShell = document.getElementById("auth-shell");
      const app = document.getElementById("app");
      if (authShell) authShell.classList.add("hidden");
      if (app) app.style.display = "block";
      updateGreeting();
      if (currentUser.role === 'distributor' && typeof openDistributorTools === 'function') {
        openDistributorTools();
      }
    }

    // Preserve the existing connectivity test as a separate diagnostic.
    try {
      await testSupabaseConnection();
    } catch (error) {
      console.error("GoodsbarnX Supabase connection test failed:", error);
    }

    await loadDistributorsAndBuyers();
    updateCartBadge();

    setTimeout(() => {
      if (typeof loadDistributors === 'function') loadDistributors();
      if (typeof loadBuyers === 'function') loadBuyers();
      if (typeof updateStats === 'function') updateStats();
    }, 500);

    console.log("GoodsbarnX initialized successfully");
  } catch (error) {
    console.error("GoodsbarnX initialization failed:", error);
  }
})();

function renderHistory() {
  const history = JSON.parse(localStorage.getItem("goodsbarnx_history") || "[]");
  const container = document.getElementById("history-list");
  if (!history.length) {
    container.innerHTML = '<div class="loading-text">No inquiries yet.</div>';
    return;
  }
  container.innerHTML = history.map(h => `
    <div class="manifest">
      <div class="manifest-top">
        <div>
          <div class="m-name">${h.name}</div>
          <div class="m-loc">${h.type} · ${new Date(h.date).toLocaleDateString()}</div>
        </div>
        <span class="stamp-badge" style="border-color:var(--ok); color:var(--ok);">SENT</span>
      </div>
    </div>
  `).join("");
}

function updateGreeting() {
  const greetingElement = document.getElementById('greeting-name');
  if (!greetingElement) return;
  if (currentUser) {
    const displayName = currentUser.business_name || currentUser.full_name || 'User';
    greetingElement.textContent = displayName;
  } else {
    greetingElement.textContent = 'User';
  }
}

window.updateGreeting = updateGreeting;

console.log("GoodsbarnX app loaded successfully");
