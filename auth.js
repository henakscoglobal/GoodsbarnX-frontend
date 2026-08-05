// Auth-related variables
let selectedSignupRole = "buyer";
let currentUser = null;

// Role picker UI
function selectRole(el) {
  document.querySelectorAll("#signup-role-picker .role-pick").forEach(r => r.classList.remove("sel"));
  el.classList.add("sel");
  selectedSignupRole = el.dataset.role;
  document.getElementById("auth-company").style.display = selectedSignupRole === "agent" ? "block" : "none";
}

// Show auth screens
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

// Load user profile from Supabase
async function loadCurrentUser() {
  const { data: { user } } = await sb.auth.getUser();
  if (!user) { currentUser = null; return; }
  const { data: profile } = await sb.from("profiles").select("*").eq("id", user.id).single();
  currentUser = { id: user.id, ...profile };
  document.getElementById("logout-btn-holder").innerHTML = '<span class="logout-btn" onclick="handleLogout()">Log out</span>';
  if (currentUser.role === "distributor") {
    showDistributorTools();
    checkPendingAttachments();
  } else if (currentUser.role === "buyer") {
    checkBuyerLock();
  } else if (currentUser.role === "agent") {
    showAgentTools();
  }
}

async function handleLogout() { await sb.auth.signOut(); location.reload(); }

// Sign up
async function handleSignup() {
  const name = document.getElementById("auth-name").value;
  const phone = document.getElementById("auth-phone").value;
  const email = document.getElementById("auth-email").value;
  const password = document.getElementById("auth-password").value;
  const errorEl = document.getElementById("auth-error");
  errorEl.innerText = "";
  if (!name || !phone || !email || !password) { errorEl.innerText = "Please fill in every field."; return; }
  const { data, error } = await sb.auth.signUp({ email, password });
  if (error) { errorEl.innerText = error.message; return; }
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
      if (existingCompany) companyId = existingCompany.id;
      else {
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

// Log in
async function handleLogin() {
  const email = document.getElementById("login-email").value;
  const password = document.getElementById("login-password").value;
  const errorEl = document.getElementById("login-error");
  errorEl.innerText = "";
  if (!email || !password) { errorEl.innerText = "Please fill in both fields."; return; }
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) { errorEl.innerText = error.message; return; }
  await loadCurrentUser();
  document.getElementById("login-shell").classList.add("hidden");
  document.getElementById("app").style.display = "block";
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
