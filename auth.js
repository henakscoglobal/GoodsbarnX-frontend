// GoodsbarnX – Authentication Module

let selectedSignupRole = "buyer";
let currentUser = null;

function selectRole(el) {
  document.querySelectorAll("#signup-role-picker .role-pick").forEach(r => r.classList.remove("sel"));
  el.classList.add("sel");
  selectedSignupRole = el.dataset.role;
  const companyField = document.getElementById("auth-company");
  if (companyField) companyField.style.display = selectedSignupRole === "agent" ? "block" : "none";
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
  const pwField = document.getElementById("login-password");
  const toggle = document.querySelector("#login-shell .password-toggle");
  if (pwField.type === "password") {
    pwField.type = "text";
    toggle.innerText = "Hide";
  } else {
    pwField.type = "password";
    toggle.innerText = "Show";
  }
}

async function loadCurrentUser() {
  const { data: { user } } = await sb.auth.getUser();
  if (!user) {
    currentUser = null;
    return;
  }

  const { data: profile } = await sb.from("profiles").select("*").eq("id", user.id).single();
  currentUser = { id: user.id, ...profile };

  // Merge distributor/buyer profile fields
  if (currentUser.role === "distributor") {
    const { data: dist } = await sb.from("distributor_profiles").select("*").eq("id", currentUser.id).single();
    if (dist) currentUser = { ...currentUser, ...dist };
  } else if (currentUser.role === "buyer") {
    const { data: buyer } = await sb.from("buyer_profiles").select("*").eq("id", currentUser.id).single();
    if (buyer) currentUser = { ...currentUser, ...buyer };
  }

  // Update logout button
  const logoutHolder = document.getElementById("logout-btn-holder");
  if (logoutHolder) {
    logoutHolder.innerHTML = '<span class="logout-btn" onclick="handleLogout()">Log out</span>';
  }

  // Dispatch event for other modules
  document.dispatchEvent(new CustomEvent("userLoaded", { detail: currentUser }));

  // Check onboarding
  checkOnboarding();
}

async function handleLogout() {
  await sb.auth.signOut();
  location.reload();
}

async function handleSignup() {
  const name = document.getElementById("auth-name").value;
  const phone = document.getElementById("auth-phone").value;
  const email = document.getElementById("auth-email").value;
  const password = document.getElementById("auth-password").value;
  const confirmPassword = document.getElementById("auth-password-confirm").value;
  const errorEl = document.getElementById("auth-error");

  errorEl.innerText = "";

  if (!name || !phone || !email || !password || !confirmPassword) {
    errorEl.innerText = "Please fill in every field.";
    return;
  }

  if (password !== confirmPassword) {
    errorEl.innerText = "Passwords do not match.";
    return;
  }

  const { data, error } = await sb.auth.signUp({ email, password });
  if (error) {
    errorEl.innerText = error.message;
    return;
  }

  const userId = data.user.id;
  await sb.from("profiles").insert({ id: userId, full_name: name, phone: phone, role: selectedSignupRole });

  if (selectedSignupRole === "distributor") {
    await sb.from("distributor_profiles").insert({ id: userId, business_name: name });
  } else if (selectedSignupRole === "buyer") {
    await sb.from("buyer_profiles").insert({ id: userId });
  } else if (selectedSignupRole === "agent") {
    const companyName = document.getElementById("auth-company-input").value;
    let companyId = null;
    if (companyName) {
      const { data: existingCompany } = await sb.from("companies").select("id").ilike("name", companyName).maybeSingle();
      if (existingCompany) {
        companyId = existingCompany.id;
      } else {
        const { data: newCompany } = await sb.from("companies").insert({ name: companyName }).select("id").single();
        companyId = newCompany ? newCompany.id : null;
      }
    }
    await sb.from("agent_profiles").insert({ id: userId, company_id: companyId, employment_confirmed: false });
  }

  await loadCurrentUser();
  document.getElementById("auth-shell").classList.add("hidden");
  document.getElementById("app").style.display = "block";
}

async function handleLogin() {
  const email = document.getElementById("login-email").value;
  const password = document.getElementById("login-password").value;
  const errorEl = document.getElementById("login-error");

  errorEl.innerText = "";

  if (!email || !password) {
    errorEl.innerText = "Please fill in both fields.";
    return;
  }

  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) {
    errorEl.innerText = error.message;
    return;
  }

  await loadCurrentUser();
  document.getElementById("login-shell").classList.add("hidden");
  document.getElementById("app").style.display = "block";
}

function checkOnboarding() {
  const banner = document.getElementById("onboarding-banner");
  if (!banner) return;
  if (!currentUser || currentUser.role === "agent") {
    banner.innerHTML = "";
    return;
  }

  const isDistributor = currentUser.role === "distributor";
  if (isDistributor && (!currentUser.location || !currentUser.category)) {
    banner.innerHTML = `<div class="onboarding-banner">Complete your profile to appear in searches. <a onclick="showScreen('profile')" style="color:var(--brass-bright); text-decoration:underline;">Complete now</a></div>`;
  } else if (!isDistributor && (!currentUser.location || !currentUser.looking_for)) {
    banner.innerHTML = `<div class="onboarding-banner">Tell us what you're looking for. <a onclick="showScreen('profile')" style="color:var(--brass-bright); text-decoration:underline;">Complete now</a></div>`;
  } else {
    banner.innerHTML = "";
  }
}

// Auto-restore session on page load
(async () => {
  const { data: { session } } = await sb.auth.getSession();
  if (session) {
    await loadCurrentUser();
    document.getElementById("auth-shell").classList.add("hidden");
    document.getElementById("app").style.display = "block";
  }
})();
