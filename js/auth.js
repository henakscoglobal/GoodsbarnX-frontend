// ==========================================================================
// GoodsbarnX — auth.js
// Signup, login, logout, role selection, guest mode, current user loading.
// Plain global script — depends on js/config.js (for `sb`) being loaded first.
// ==========================================================================

// ---------- Role / screen switching (auth-specific) ----------

function selectRole(el) {
  document.querySelectorAll("#signup-role-picker .role-pick").forEach(r => r.classList.remove("sel"));
  el.classList.add("sel");
  selectedSignupRole = el.dataset.role;
  document.getElementById("auth-company").style.display = selectedSignupRole === "agent" ? "block" : "none";
}

function showLogin() {
  document.getElementById("auth-shell").classList.add("hidden");
  document.getElementById("login-shell").classList.remove("hidden");
}

function showSignup() {
  document.getElementById("login-shell").classList.add("hidden");
  document.getElementById("auth-shell").classList.remove("hidden");
}

function continueAsGuest() {
  document.getElementById("auth-shell").classList.add("hidden");
  document.getElementById("login-shell").classList.add("hidden");
  document.getElementById("app").style.display = "block";
}

function toggleLoginPassword() {
  const pw = document.getElementById("login-password");
  pw.type = pw.type === "password" ? "text" : "password";
}

// ---------- Current user ----------

async function loadCurrentUser() {
  const { data: { user } } = await sb.auth.getUser();
  if (!user) { currentUser = null; return; }

  const { data: profile } = await sb.from("profiles").select("*").eq("id", user.id).single();
  currentUser = { id: user.id, ...profile };

  if (currentUser.role === "distributor") {
    const { data: dist } = await sb.from("distributor_profiles").select("*").eq("id", currentUser.id).single();
    if (dist) currentUser = { ...currentUser, ...dist };
  } else if (currentUser.role === "buyer") {
    const { data: buyer } = await sb.from("buyer_profiles").select("*").eq("id", currentUser.id).single();
    if (buyer) currentUser = { ...currentUser, ...buyer };
  }

  document.getElementById("logout-btn-holder").innerHTML = '<span class="logout-btn" onclick="handleLogout()">Log out</span>';

  if (currentUser.role === "distributor") {
    document.getElementById("nav-products").style.display = "flex";
    document.getElementById("nav-staff").style.display = "flex";
  }
}

async function handleLogout() {
  await sb.auth.signOut();
  location.reload();
}

// ---------- Signup ----------

async function handleSignup() {
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
  await sb.from("profiles").insert({ id: userId, full_name: name, phone: phone, role: selectedSignupRole });

  if (selectedSignupRole === "distributor") {
    await sb.from("distributor_profiles").insert({ id: userId, business_name: name });
  } else if (selectedSignupRole === "buyer") {
    await sb.from("buyer_profiles").insert({ id: userId });
  }

  await loadCurrentUser();
  document.getElementById("auth-shell").classList.add("hidden");
  document.getElementById("app").style.display = "block";
}

// ---------- Login ----------

async function handleLogin() {
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

  await loadCurrentUser();
  document.getElementById("login-shell").classList.add("hidden");
  document.getElementById("app").style.display = "block";
}
