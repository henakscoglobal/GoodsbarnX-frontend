// Main App Initialization
class App {
  static async init() {
    console.log("Initializing GoodsbarnX...");
    
    // Initialize auth
    await Auth.init();
    
    // Load favourites if logged in
    if (state.currentUser) {
      await this.loadFavourites();
    }
    
    // Update cart badge
    this.updateCartBadge();
    
    // Set up online/offline handlers
    window.addEventListener("online", () => {
      console.log("Back online - syncing...");
      this.syncOfflineQueue();
    });
    
    // Start periodic updates
    this.startPeriodicUpdates();
  }
  
  static async loadFavourites() {
    if (!state.currentUser) return;
    const { data } = await sb.from("favourites")
      .select("distributor_id")
      .eq("user_id", state.currentUser.id);
    if (data) {
      state.userFavourites = new Set(data.map(f => f.distributor_id));
    }
  }
  
  static updateCartBadge() {
    const badge = document.getElementById("cart-badge");
    if (badge) {
      badge.textContent = state.cart.length;
      badge.style.display = state.cart.length > 0 ? "block" : "none";
    }
  }
  
  static async syncOfflineQueue() {
    const queue = JSON.parse(localStorage.getItem("goodsbarnx_queue") || "[]");
    if (!queue.length) return;
    
    for (const payload of queue) {
      try {
        await sb.from("inquiries").insert(payload);
      } catch (e) {
        console.error("Failed to sync:", e);
      }
    }
    localStorage.removeItem("goodsbarnx_queue");
    UI.toast("Synced offline inquiries");
  }
  
  static startPeriodicUpdates() {
    // Update inquiry count every 30 seconds
    setInterval(() => {
      if (state.currentScreen === "market") {
        sb.from("inquiries").select("*", { count: "exact", head: true })
          .then(({ count }) => {
            const el = document.getElementById("inquiry-count-ring");
            if (el) el.innerText = count ?? "–";
          });
      }
    }, 30000);
  }
}

// Initialize app when DOM is ready
document.addEventListener("DOMContentLoaded", () => {
  App.init();
});
