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

// ---------- Forgot password ----------

function openForgotPasswordModal() {
  document.getElementById("forgot-password-email").value = "";
  document.getElementById("forgot-password-status").innerText = "";
  document.getElementById("forgot-password-modal").classList.add("active");
}

function closeForgotPasswordModal() {
  document.getElementById("forgot-password-modal").classList.remove("active");
}

async function sendPasswordReset() {
  const email = document.getElementById("forgot-password-email").value.trim();
  const status = document.getElementById("forgot-password-status");

  if (!email) {
    status.innerText = "Enter your email address.";
    return;
  }

  status.innerText = "Sending...";

  const { error } = await sb.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin
  });

  if (error) {
    status.innerText = "Error: " + error.message;
  } else {
    status.innerText = "Check your email for a reset link.";
    setTimeout(closeForgotPasswordModal, 2500);
  }
}

// ---------- Set new password (after clicking the email link) ----------
// Supabase redirects the person back here with a recovery session already
// active. We listen for that specific event and show the modal automatically
// — the person never needs to know this mechanism exists, it just works.

sb.auth.onAuthStateChange((event) => {
  if (event === "PASSWORD_RECOVERY") {
    document.getElementById("new-password").value = "";
    document.getElementById("new-password-confirm").value = "";
    document.getElementById("reset-password-status").innerText = "";
    document.getElementById("reset-password-modal").classList.add("active");
  }
});

async function submitNewPassword() {
  const password = document.getElementById("new-password").value;
  const confirm = document.getElementById("new-password-confirm").value;
  const status = document.getElementById("reset-password-status");

  if (!password || !confirm) {
    status.innerText = "Fill in both fields.";
    return;
  }
  if (password !== confirm) {
    status.innerText = "Passwords do not match.";
    return;
  }
  if (password.length < 6) {
    status.innerText = "Password must be at least 6 characters.";
    return;
  }

  status.innerText = "Saving...";

  const { error } = await sb.auth.updateUser({ password });

  if (error) {
    status.innerText = "Error: " + error.message;
  } else {
    status.innerText = "Password updated! Redirecting...";
    setTimeout(() => {
      document.getElementById("reset-password-modal").classList.remove("active");
      location.href = window.location.origin;
    }, 1500);
  }
}
