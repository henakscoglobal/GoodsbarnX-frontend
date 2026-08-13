class Auth {
  static selectedRole = "buyer";
  
  static async init() {
    UI.renderAuth();
    const { data: { session } } = await sb.auth.getSession();
    if (session) {
      await this.loadCurrentUser();
      this.showApp();
    }
  }
  
  static async loadCurrentUser() {
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return;
    
    const { data: profile } = await sb.from("profiles")
      .select("*").eq("id", user.id).single();
    
    state.currentUser = { id: user.id, ...profile };
    
    if (profile?.role === "distributor") {
      const { data: dist } = await sb.from("distributor_profiles")
        .select("*").eq("id", user.id).single();
      if (dist) state.currentUser = { ...state.currentUser, ...dist };
    } else if (profile?.role === "buyer") {
      const { data: buyer } = await sb.from("buyer_profiles")
        .select("*").eq("id", user.id).single();
      if (buyer) state.currentUser = { ...state.currentUser, ...buyer };
    }
  }
  
  static showApp() {
    document.getElementById("auth-container").style.display = "none";
    document.getElementById("app").style.display = "block";
    UI.renderHeader();
    UI.renderNav();
    UI.showScreen("market");
  }
  
  static continueAsGuest() {
    document.getElementById("auth-container").style.display = "none";
    document.getElementById("app").style.display = "block";
    UI.renderHeader();
    UI.renderNav();
    UI.showScreen("market");
  }
  
  static selectRole(el) {
    document.querySelectorAll(".role-pick").forEach(r => r.classList.remove("sel"));
    el.classList.add("sel");
    this.selectedRole = el.dataset.role;
    document.getElementById("auth-company").style.display = 
      this.selectedRole === "agent" ? "block" : "none";
  }
  
  static showLogin() {
    document.getElementById("auth-shell").classList.add("hidden");
    document.getElementById("login-shell").classList.remove("hidden");
  }
  
  static showSignup() {
    document.getElementById("login-shell").classList.add("hidden");
    document.getElementById("auth-shell").classList.remove("hidden");
  }
  
  static toggleLoginPassword() {
    const pw = document.getElementById("login-password");
    pw.type = pw.type === "password" ? "text" : "password";
  }
  
  static async handleSignup() {
    const name = document.getElementById("auth-name").value;
    const phone = document.getElementById("auth-phone").value;
    const email = document.getElementById("auth-email").value;
    const password = document.getElementById("auth-password").value;
    const confirm = document.getElementById("auth-password-confirm").value;
    const err = document.getElementById("auth-error");
    
    err.innerText = "";
    if (!name || !phone || !email || !password || !confirm) {
      err.innerText = "Please fill in every field.";
      return;
    }
    if (password !== confirm) {
      err.innerText = "Passwords do not match.";
      return;
    }
    
    const { data, error } = await sb.auth.signUp({ email, password });
    if (error) {
      err.innerText = error.message;
      return;
    }
    
    const userId = data.user.id;
    await sb.from("profiles").insert({
      id: userId,
      full_name: name,
      phone: phone,
      role: this.selectedRole
    });
    
    if (this.selectedRole === "distributor") {
      await sb.from("distributor_profiles").insert({
        id: userId,
        business_name: name
      });
    } else if (this.selectedRole === "buyer") {
      await sb.from("buyer_profiles").insert({ id: userId });
    }
    
    await this.loadCurrentUser();
    this.showApp();
  }
  
  static async handleLogin() {
    const email = document.getElementById("login-email").value;
    const password = document.getElementById("login-password").value;
    const err = document.getElementById("login-error");
    
    err.innerText = "";
    if (!email || !password) {
      err.innerText = "Please fill in both fields.";
      return;
    }
    
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) {
      err.innerText = error.message;
      return;
    }
    
    await this.loadCurrentUser();
    this.showApp();
  }
  
  static async handleLogout() {
    await sb.auth.signOut();
    location.reload();
  }
}
