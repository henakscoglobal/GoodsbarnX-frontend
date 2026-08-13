// UI Helper Functions
class UI {
  static renderAuth() {
    const container = document.getElementById("auth-container");
    container.innerHTML = `
      <div class="auth-shell" id="auth-shell">
        ${UI.authBrand("GoodsbarnX", "Onitsha • Nnewi • Awka • Asaba • Enugu • Owerri • Abakiliki • Agbor • Warri • Aba")}
        <div class="auth-box">
          <div class="role-picker" id="signup-role-picker">
            ${["buyer", "distributor", "agent"].map((role, i) => `
              <div class="role-pick ${i === 0 ? "sel" : ""}" data-role="${role}" onclick="Auth.selectRole(this)">
                ${role === "buyer" ? "Buyer" : role === "distributor" ? "Distributor" : "Supplier Agent"}
              </div>
            `).join("")}
          </div>
          <input type="text" id="auth-name" placeholder="Full name" />
          <input type="tel" id="auth-phone" placeholder="Phone number" />
          <div id="auth-company" style="display:none;">
            <input type="text" id="auth-company-input" placeholder="Company name" />
          </div>
          <input type="email" id="auth-email" placeholder="Email address" />
          <input type="password" id="auth-password" placeholder="Password" />
          <input type="password" id="auth-password-confirm" placeholder="Confirm password" />
          <button class="btn btn-primary btn-block" onclick="Auth.handleSignup()">Create account</button>
          <div class="auth-error" id="auth-error"></div>
        </div>
        <div class="auth-switch">Already have an account? <span onclick="Auth.showLogin()">Log in</span></div>
        <div class="auth-guest" onclick="Auth.continueAsGuest()">Continue browsing without an account</div>
      </div>
      
      <div class="auth-shell hidden" id="login-shell">
        ${UI.authBrand("Welcome back", "Log in to GoodsbarnX")}
        <div class="auth-box">
          <input type="email" id="login-email" placeholder="Email address" />
          <div style="position:relative;">
            <input type="password" id="login-password" placeholder="Password" />
            <span class="password-toggle" onclick="Auth.toggleLoginPassword()">Show</span>
          </div>
          <button class="btn btn-primary btn-block" onclick="Auth.handleLogin()">Log in</button>
          <div class="auth-error" id="login-error"></div>
        </div>
        <div class="auth-switch">New here? <span onclick="Auth.showSignup()">Create an account</span></div>
        <div class="auth-guest" onclick="Auth.continueAsGuest()">Continue browsing without an account</div>
      </div>
    `;
  }
  
  static authBrand(title, subtitle) {
    return `
      <div class="auth-brand">
        <h1>${title}</h1>
        <p>${subtitle}</p>
      </div>
    `;
  }
  
  static renderHeader() {
    const header = document.getElementById("app-header");
    header.innerHTML = `
      <header class="top">
        <div class="brand">
          <div class="brand-name">GoodsbarnX</div>
          <div class="brand-sub">Stock meets buyer</div>
        </div>
        ${state.currentUser ? '<span class="logout-btn" onclick="Auth.handleLogout()">Log out</span>' : ""}
      </header>
    `;
  }
  
  static renderNav() {
    const nav = document.getElementById("bottom-nav");
    const isDistributor = state.currentUser?.role === "distributor";
    nav.innerHTML = `
      <nav class="bottom">
        <div class="nav-item active" data-screen="market">
          <span class="ic">🏬</span>Market
        </div>
        <div class="nav-item" data-screen="cart">
          <span class="ic">🛒</span>
          <span class="nav-badge" id="cart-badge">${state.cart.length}</span>
          Cart
        </div>
        <div class="nav-item" data-screen="trust">
          <span class="ic">🛡️</span>Trust
        </div>
        <div class="nav-item" data-screen="profile">
          <span class="ic">👤</span>Profile
        </div>
        ${isDistributor ? `
        <div class="nav-item" data-screen="products">
          <span class="ic">📦</span>Products
        </div>
        ` : ""}
        <div class="nav-item" data-screen="upgrade">
          <span class="ic">⭐</span>Upgrade
        </div>
      </nav>
    `;
    
    nav.querySelectorAll(".nav-item").forEach(item => {
      item.addEventListener("click", () => UI.showScreen(item.dataset.screen));
    });
  }
  
  static showScreen(screenName) {
    state.currentScreen = screenName;
    document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("active"));
    document.querySelector(`[data-screen="${screenName}"]`)?.classList.add("active");
    
    const main = document.getElementById("main-content");
    main.innerHTML = "";
    
    switch(screenName) {
      case "market":
        Market.render(main);
        break;
      case "cart":
        Cart.render(main);
        break;
      case "trust":
        Trust.render(main);
        break;
      case "profile":
        Profile.render(main);
        break;
      case "products":
        Products.render(main);
        break;
      case "upgrade":
        Upgrade.render(main);
        break;
    }
    
    window.scrollTo(0, 0);
  }
  
  static showModal(modalId) {
    document.getElementById(modalId)?.classList.add("active");
  }
  
  static hideModal(modalId) {
    document.getElementById(modalId)?.classList.remove("active");
  }
  
  static renderModal(html) {
    const container = document.getElementById("modal-container");
    container.innerHTML = html;
  }
  
  static toast(message, type = "success") {
    // Simple toast implementation
    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
  }
  
  static formatPrice(price) {
    return `₦${parseFloat(price).toLocaleString()}`;
  }
}
