// ==========================================================================
// GoodsbarnX — auth.js
// V1.8.2.6.3 — AUTH CONTEXT INTEGRITY BOUNDARY
//
// Signup, login, logout, role selection, guest mode, current user loading.
//
// IMPORTANT:
// - Depends on js/config.js (`sb`) being loaded first.
// - `currentUser` remains owned by app.js.
// - This file does NOT create a second authentication mechanism.
// - V1.8.2.6.3 explicitly exposes the result of the EXISTING auth flow so
//   downstream engine components can distinguish authentication failure,
//   profile failure, role failure, and distributor-context failure.
// ==========================================================================


// ---------- Role / screen switching ----------

function selectRole(el) {
  document.querySelectorAll("#signup-role-picker .role-pick")
    .forEach(r => r.classList.remove("sel"));

  el.classList.add("sel");
  selectedSignupRole = el.dataset.role;

  document.getElementById("auth-company").style.display =
    selectedSignupRole === "agent" ? "block" : "none";
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


// ==========================================================================
// V1.8.2.6.3 — AUTH CONTEXT INTEGRITY
// ==========================================================================

const GBX_AUTH_CONTEXT_VERSION = "V1.8.2.6.3";

window.goodsbarnxAuthContextVersion = GBX_AUTH_CONTEXT_VERSION;

window.goodsbarnxAuthContext = {
  status: "NOT_INITIALIZED",
  code: "AUTH_CONTEXT_NOT_INITIALIZED",
  authenticated: false,
  userId: null,
  role: null,
  profileResolved: false,
  distributorResolved: false,
  error: null
};

function setAuthContextState(state) {
  window.goodsbarnxAuthContext = {
    ...window.goodsbarnxAuthContext,
    ...state,
    version: GBX_AUTH_CONTEXT_VERSION
  };
}


// ---------- Current user ----------

async function loadCurrentUser() {

  setAuthContextState({
    status: "AUTHENTICATING",
    code: "AUTH_INITIALIZING",
    authenticated: false,
    userId: null,
    role: null,
    profileResolved: false,
    distributorResolved: false,
    error: null
  });

  let authResult;

  try {
    authResult = await sb.auth.getUser();
  } catch (error) {

    currentUser = null;

    setAuthContextState({
      status: "FAILED",
      code: "AUTH_GET_USER_FAILED",
      error: error.message || String(error)
    });

    throw error;
  }

  if (authResult.error) {

    currentUser = null;

    setAuthContextState({
      status: "FAILED",
      code: "AUTH_GET_USER_FAILED",
      error: authResult.error.message || String(authResult.error)
    });

    throw authResult.error;
  }

  const user = authResult.data && authResult.data.user;

  if (!user) {

    currentUser = null;

    setAuthContextState({
      status: "UNAUTHENTICATED",
      code: "NO_AUTH_USER",
      authenticated: false,
      error: null
    });

    return null;
  }

  setAuthContextState({
    status: "AUTHENTICATED_USER",
    code: "AUTH_USER_RESOLVED",
    authenticated: true,
    userId: user.id
  });


  // ---------- Resolve canonical profile ----------

  let profileResult;

  try {

    profileResult = await sb
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .single();

  } catch (error) {

    currentUser = null;

    setAuthContextState({
      status: "FAILED",
      code: "PROFILE_LOAD_FAILED",
      authenticated: true,
      userId: user.id,
      error: error.message || String(error)
    });

    throw error;
  }

  if (profileResult.error) {

    currentUser = null;

    setAuthContextState({
      status: "FAILED",
      code: "PROFILE_LOAD_FAILED",
      authenticated: true,
      userId: user.id,
      error: profileResult.error.message || String(profileResult.error)
    });

    throw profileResult.error;
  }

  const profile = profileResult.data;

  if (!profile) {

    currentUser = null;

    const error = new Error("Authenticated user profile could not be resolved.");

    setAuthContextState({
      status: "FAILED",
      code: "PROFILE_MISSING",
      authenticated: true,
      userId: user.id,
      profileResolved: false,
      error: error.message
    });

    throw error;
  }


  // ---------- Establish base currentUser ----------

  currentUser = {
    id: user.id,
    ...profile
  };

  setAuthContextState({
    status: "PROFILE_RESOLVED",
    code: "PROFILE_RESOLVED",
    authenticated: true,
    userId: user.id,
    role: currentUser.role || null,
    profileResolved: true,
    error: null
  });


  // ---------- Distributor context ----------

  if (currentUser.role === "distributor") {

    let distributorResult;

    try {

      distributorResult = await sb
        .from("distributor_profiles")
        .select("*")
        .eq("id", currentUser.id)
        .single();

    } catch (error) {

      currentUser = null;

      setAuthContextState({
        status: "FAILED",
        code: "DISTRIBUTOR_PROFILE_LOAD_FAILED",
        authenticated: true,
        userId: user.id,
        role: "distributor",
        profileResolved: true,
        distributorResolved: false,
        error: error.message || String(error)
      });

      throw error;
    }

    if (distributorResult.error) {

      currentUser = null;

      setAuthContextState({
        status: "FAILED",
        code: "DISTRIBUTOR_PROFILE_LOAD_FAILED",
        authenticated: true,
        userId: user.id,
        role: "distributor",
        profileResolved: true,
        distributorResolved: false,
        error:
          distributorResult.error.message ||
          String(distributorResult.error)
      });

      throw distributorResult.error;
    }

    const distributor = distributorResult.data;

    if (!distributor) {

      currentUser = null;

      const error = new Error(
        "Distributor profile could not be resolved."
      );

      setAuthContextState({
        status: "FAILED",
        code: "DISTRIBUTOR_PROFILE_MISSING",
        authenticated: true,
        userId: user.id,
        role: "distributor",
        profileResolved: true,
        distributorResolved: false,
        error: error.message
      });

      throw error;
    }

    currentUser = {
      ...currentUser,
      ...distributor
    };

    setAuthContextState({
      status: "READY",
      code: "AUTHENTICATED_DISTRIBUTOR",
      authenticated: true,
      userId: currentUser.id,
      role: "distributor",
      profileResolved: true,
      distributorResolved: true,
      error: null
    });

  } else if (currentUser.role === "buyer") {

    const { data: buyer, error: buyerError } =
      await sb
        .from("buyer_profiles")
        .select("*")
        .eq("id", currentUser.id)
        .single();

    if (buyerError) {

      setAuthContextState({
        status: "FAILED",
        code: "BUYER_PROFILE_LOAD_FAILED",
        authenticated: true,
        userId: currentUser.id,
        role: "buyer",
        profileResolved: true,
        distributorResolved: false,
        error: buyerError.message || String(buyerError)
      });

      throw buyerError;
    }

    if (buyer) {
      currentUser = {
        ...currentUser,
        ...buyer
      };
    }

    setAuthContextState({
      status: "READY",
      code: "AUTHENTICATED_BUYER",
      authenticated: true,
      userId: currentUser.id,
      role: "buyer",
      profileResolved: true,
      distributorResolved: false,
      error: null
    });

  } else if (currentUser.role === "agent") {

    setAuthContextState({
      status: "READY",
      code: "AUTHENTICATED_AGENT",
      authenticated: true,
      userId: currentUser.id,
      role: "agent",
      profileResolved: true,
      distributorResolved: false,
      error: null
    });

  } else {

    setAuthContextState({
      status: "READY",
      code: "AUTHENTICATED_OTHER_ROLE",
      authenticated: true,
      userId: currentUser.id,
      role: currentUser.role || null,
      profileResolved: true,
      distributorResolved: false,
      error: null
    });
  }


  // ---------- Existing UI behavior ----------

  document.getElementById("logout-btn-holder").innerHTML =
    '<span class="logout-btn" onclick="handleLogout()">Log out</span>';

  if (currentUser.role === "distributor") {
    document.getElementById("nav-products").style.display = "flex";
    document.getElementById("nav-staff").style.display = "flex";
  }

  if (currentUser.role === "agent") {
    document.getElementById("nav-agent").style.display = "flex";
  }

  return currentUser;
}


// ---------- Explicit auth-context readiness helper ----------

function getGoodsbarnXAuthContext() {
  return window.goodsbarnxAuthContext || {
    status: "NOT_INITIALIZED",
    code: "AUTH_CONTEXT_NOT_INITIALIZED",
    authenticated: false,
    userId: null,
    role: null,
    profileResolved: false,
    distributorResolved: false,
    error: null
  };
}

window.getGoodsbarnXAuthContext = getGoodsbarnXAuthContext;


// ---------- Logout ----------

async function handleLogout() {

  setAuthContextState({
    status: "SIGNING_OUT",
    code: "AUTH_SIGNING_OUT"
  });

  await sb.auth.signOut();

  location.reload();
}


// ==========================================================================
// Signup
// ==========================================================================

async function handleSignup() {

  const name =
    document.getElementById("auth-name").value;

  const phone =
    document.getElementById("auth-phone").value;

  const email =
    document.getElementById("auth-email").value;

  const password =
    document.getElementById("auth-password").value;

  const confirm =
    document.getElementById("auth-password-confirm").value;

  const err =
    document.getElementById("auth-error");

  err.innerText = "";

  if (!name || !phone || !email || !password || !confirm) {
    err.innerText = "Please fill in every field.";
    return;
  }

  if (password !== confirm) {
    err.innerText = "Passwords do not match.";
    return;
  }

  const { data, error } =
    await sb.auth.signUp({
      email,
      password
    });

  if (error) {
    err.innerText = error.message;
    return;
  }

  const userId = data.user.id;

  await sb.from("profiles").insert({
    id: userId,
    full_name: name,
    phone: phone,
    role: selectedSignupRole
  });

  if (selectedSignupRole === "distributor") {

    await sb.from("distributor_profiles").insert({
      id: userId,
      business_name: name
    });

  } else if (selectedSignupRole === "buyer") {

    await sb.from("buyer_profiles").insert({
      id: userId
    });
  }

  await loadCurrentUser();

  document.getElementById("auth-shell").classList.add("hidden");
  document.getElementById("app").style.display = "block";
}


// ==========================================================================
// Login
// ==========================================================================

async function handleLogin() {

  const email =
    document.getElementById("login-email").value;

  const password =
    document.getElementById("login-password").value;

  const err =
    document.getElementById("login-error");

  err.innerText = "";

  if (!email || !password) {
    err.innerText = "Please fill in both fields.";
    return;
  }

  const { data, error } =
    await sb.auth.signInWithPassword({
      email,
      password
    });

  if (error) {
    err.innerText = error.message;
    return;
  }

  await loadCurrentUser();

  document.getElementById("login-shell").classList.add("hidden");
  document.getElementById("app").style.display = "block";
}


// ==========================================================================
// Forgot password
// ==========================================================================

function openForgotPasswordModal() {
  document.getElementById("forgot-password-email").value = "";
  document.getElementById("forgot-password-status").innerText = "";
  document.getElementById("forgot-password-modal").classList.add("active");
}

function closeForgotPasswordModal() {
  document.getElementById("forgot-password-modal").classList.remove("active");
}

async function sendPasswordReset() {

  const email =
    document.getElementById("forgot-password-email").value.trim();

  const status =
    document.getElementById("forgot-password-status");

  if (!email) {
    status.innerText = "Enter your email address.";
    return;
  }

  status.innerText = "Sending...";

  const { error } =
    await sb.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin
    });

  if (error) {
    status.innerText = "Error: " + error.message;
  } else {
    status.innerText = "Check your email for a reset link.";
    setTimeout(closeForgotPasswordModal, 2500);
  }
}


// ==========================================================================
// Password recovery
// ==========================================================================

sb.auth.onAuthStateChange((event) => {

  if (event === "PASSWORD_RECOVERY") {

    document.getElementById("new-password").value = "";
    document.getElementById("new-password-confirm").value = "";
    document.getElementById("reset-password-status").innerText = "";

    document
      .getElementById("reset-password-modal")
      .classList.add("active");
  }
});


async function submitNewPassword() {

  const password =
    document.getElementById("new-password").value;

  const confirm =
    document.getElementById("new-password-confirm").value;

  const status =
    document.getElementById("reset-password-status");

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

  const { error } =
    await sb.auth.updateUser({ password });

  if (error) {
    status.innerText = "Error: " + error.message;

  } else {

    status.innerText =
      "Password updated! Redirecting...";

    setTimeout(() => {

      document
        .getElementById("reset-password-modal")
        .classList.remove("active");

      location.href = window.location.origin;

    }, 1500);
  }
}
