// ==========================================================================
// GoodsbarnX — app.js
// Global state declarations, app initialization, and inquiry history.
// Plain global script — MUST be the LAST js/ file loaded in index.html,
// since its init block calls functions (loadCurrentUser, loadDistributorsAndBuyers,
// updateCartBadge) that live in every other js/ file.
// ==========================================================================

// ---------- Global state ----------
// Shared across every other js/ file via the browser's shared global scope.

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

// ---------- Initialize ----------

(async () => {
  console.log("GoodsbarnX initializing...");
  await testSupabaseConnection();
  const { data: { session } } = await sb.auth.getSession();
  if (session) {
    await loadCurrentUser();
    document.getElementById("auth-shell").classList.add("hidden");
    document.getElementById("app").style.display = "block";
  }
  await loadDistributorsAndBuyers();
  updateCartBadge();
  console.log("GoodsbarnX initialized successfully");
})();

// ---------- Inquiry history ----------

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

console.log("GoodsbarnX app loaded successfully");
