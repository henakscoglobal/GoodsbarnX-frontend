// ==========================================================================
// GoodsbarnX — auth.js
// Signup, login, logout, role selection, guest mode, current-user resolution.
// Plain global script. Loads third (Canon §10).
//
// V1.8.2.6.5 — Auth Resolution Execution Boundary.
// V1.8.2.6 remediation Phase 1+2:
//   - Added handleLogout() (referenced by the logout button but never declared).
//   - Added sb.auth.onAuthStateChange registration guard (skips on mock client).
//   - Added #nav-agent null guard with named warning.
//   - window.goodsbarnxAuthContext.role is no longer published before the
//     profile is resolved. Between getUser() success and profile resolution
//     the role is unknown; publishing it there inferred fact from absence
//     (Canon §29).
//   - handleSignup now checks each insert's error. Previously a failed
//     profiles / distributor_profiles / buyer_profiles insert left a
//     half-created account with no visible error.
//   - loadCurrentUser() remains the single authentication execution boundary.
//     config.js's testSupabaseConnection() is a diagnostic, not a gate.
// ==========================================================================

// --------------------------------------------------------------------------
// DIAGNOSTIC AUTH CONTEXT
//
// Preserved from V1.8.2.6.5. It is observability, not intelligence, and
// remains separate from Canon §28 behaviour events.
// --------------------------------------------------------------------------

const GBX_AUTH_CONTEXT_VERSION = "V1.8.2.6.5";
window.goodsbarnxAuthContextVersion = GBX_AUTH_CONTEXT_VERSION;

function freshAuthContext() {
  return {
    state: "initializing",
    ready: false,
    authenticated: false,
    userId: null,
    role: null,
    profileLoaded: false,
    distributorProfileLoaded: false,
    errorCode: null,
    errorMessage: null,
    initializedAt: new Date().toISOString(),
    resolvedAt: null,
    execution: { state: "not_started", startedAt: null, completedAt: null },
    trace: {
      session:            { status: "not_started", ms: null, detail: null },
      authUser:           { status: "not_started", ms: null, detail: null },
      profile:            { status: "not_started", ms: null, detail: null },
      role:               { status: "not_started", ms: null, detail: null },
      distributorProfile: { status: "not_started", ms: null, detail: null },
      currentUser:        { status: "not_started", ms: null, detail: null }
    }
  };
}

window.goodsbarnxAuthContext = freshAuthContext();

let goodsbarnxAuthResolutionPromise = null;

function resetAuthContext() {
  window.goodsbarnxAuthContext = freshAuthContext();
}

function publishAuthContext(patch) {
  const current = window.goodsbarnxAuthContext || {};
  const merged = Object.assign({}, current, patch || {});
  if (patch && patch.ready) {
    merged.resolvedAt = new Date().toISOString();
  } else {
    merged.resolvedAt = current.resolvedAt || null;
  }
  window.goodsbarnxAuthContext = merged;
}

function traceStage(stage, status, detail, ms) {
  const ctx = window.goodsbarnxAuthContext || {};
  const trace = Object.assign({}, ctx.trace || {});
  trace[stage] = {
    status: status,
    ms: Number.isFinite(ms) ? Math.round(ms) : null,
    detail: detail == null ? null : String(detail)
  };
  publishAuthContext({ trace: trace });
}

function traceError(error) {
  return error && error.message ? error.message : String(error || "Unknown error");
}

// --------------------------------------------------------------------------
// ROLE / SCREEN SWITCHING
// --------------------------------------------------------------------------

function selectRole(el) {
  if (!el) return;
  const picker = document.getElementById("signup-role-picker");
  if (picker) {
    picker.querySelectorAll(".role-pick").forEach(r => r.classList.remove("sel"));
  }
  el.classList.add("sel");
  selectedSignupRole = el.dataset.role;

  const companyField = document.getElementById("auth-company");
  if (companyField) {
    companyField.style.display = selectedSignupRole === "agent" ? "block" : "none";
  }
}

function showLogin() {
  const authShell = document.getElementById("auth-shell");
  const loginShell = document.getElementById("login-shell");
  if (authShell) authShell.classList.add("hidden");
  if (loginShell) loginShell.classList.remove("hidden");
}

function showSignup() {
  const authShell = document.getElementById("auth-shell");
  const loginShell = document.getElementById("login-shell");
  if (loginShell) loginShell.classList.add("hidden");
  if (authShell) authShell.classList.remove("hidden");
}

function continueAsGuest() {
  const authShell = document.getElementById("auth-shell");
  const loginShell = document.getElementById("login-shell");
  const app = document.getElementById("app");
  if (authShell) authShell.classList.add("hidden");
  if (loginShell) loginShell.classList.add("hidden");
  if (app) app.style.display = "block";
}

function toggleLoginPassword() {
  const pw = document.getElementById("login-password");
  if (!pw) return;
  pw.type = pw.type === "password" ? "text" : "password";
}

// --------------------------------------------------------------------------
// CURRENT USER RESOLUTION
// --------------------------------------------------------------------------

async function loadCurrentUser() {
  if (goodsbarnxAuthResolutionPromise) return goodsbarnxAuthResolutionPromise;

  goodsbarnxAuthResolutionPromise = (async function resolve() {
    resetAuthContext();
    publishAuthContext({
      execution: {
        state: "running",
        startedAt: new Date().toISOString(),
        completedAt: null
      }
    });
    currentUser = null;

    // Stage 1 — session boundary.
    let t = performance.now();
    try {
      const sessionResult = await sb.auth.getSession();
      if (sessionResult && sessionResult.error) throw sessionResult.error;
      const session = sessionResult && sessionResult.data && sessionResult.data.session;
      traceStage(
        "session",
        session ? "resolved" : "absent",
        session ? "Supabase session present." : "No active Supabase session.",
        performance.now() - t
      );
    } catch (error) {
      traceStage("session", "failed", traceError(error), performance.now() - t);
      publishAuthContext({
        state: "error",
        ready: true,
        authenticated: false,
        errorCode: "AUTH_SESSION_FAILED",
        errorMessage: traceError(error)
      });
      throw error;
    }

    // Stage 2 — authoritative auth user.
    t = performance.now();
    let authResult;
    try {
      authResult = await sb.auth.getUser();
      if (authResult.error) throw authResult.error;
    } catch (error) {
      traceStage("authUser", "failed", traceError(error), performance.now() - t);
      publishAuthContext({
        state: "error",
        ready: true,
        authenticated: false,
        errorCode: "AUTH_GET_USER_FAILED",
        errorMessage: traceError(error)
      });
      throw error;
    }

    const user = authResult.data && authResult.data.user;
    if (!user) {
      traceStage(
        "authUser",
        "absent",
        "Supabase returned no authenticated user.",
        performance.now() - t
      );
      publishAuthContext({
        state: "unauthenticated",
        ready: true,
        authenticated: false,
        errorCode: null,
        errorMessage: null,
        execution: {
          state: "completed",
          startedAt: (window.goodsbarnxAuthContext.execution || {}).startedAt || null,
          completedAt: new Date().toISOString()
        }
      });
      return null;
    }
    traceStage("authUser", "resolved", "Authenticated user resolved.", performance.now() - t);
    publishAuthContext({
      state: "auth_user_resolved",
      ready: false,
      authenticated: true,
      userId: user.id,
      // Canon §29: role is not yet known. Do not publish it as if it were.
      role: null
    });

    // Stage 3 — canonical profiles row.
    t = performance.now();
    let profileResult;
    try {
      profileResult = await sb.from("profiles").select("*").eq("id", user.id).single();
      if (profileResult.error) throw profileResult.error;
    } catch (error) {
      traceStage("profile", "failed", traceError(error), performance.now() - t);
      publishAuthContext({
        state: "error",
        ready: true,
        authenticated: true,
        userId: user.id,
        errorCode: "PROFILE_LOAD_FAILED",
        errorMessage: traceError(error)
      });
      throw error;
    }
    if (!profileResult.data) {
      traceStage(
        "profile",
        "missing",
        "Authenticated user has no profiles row.",
        performance.now() - t
      );
      publishAuthContext({
        state: "error",
        ready: true,
        authenticated: true,
        userId: user.id,
        errorCode: "PROFILE_MISSING",
        errorMessage: "Authenticated user has no profiles row."
      });
      throw new Error("Authenticated user profile is missing.");
    }
    traceStage("profile", "resolved", "Canonical profiles row resolved.", performance.now() - t);
    currentUser = Object.assign({ id: user.id }, profileResult.data);
    publishAuthContext({
      state: "profile_resolved",
      ready: false,
      authenticated: true,
      userId: user.id,
      role: currentUser.role || null,
      profileLoaded: true
    });

    // Stage 4 — role contract.
    const role = String(currentUser.role || "").toLowerCase();
    traceStage(
      "role",
      role ? "resolved" : "missing",
      role ? "Role = " + role + "." : "profiles.role is empty.",
      0
    );
    if (!role) {
      currentUser = null;
      publishAuthContext({
        state: "error",
        ready: true,
        authenticated: true,
        userId: user.id,
        profileLoaded: true,
        errorCode: "PROFILE_ROLE_MISSING",
        errorMessage: "Authenticated profile has no role."
      });
      throw new Error("Authenticated profile role is missing.");
    }

    // Stage 5 — role-specific profile.
    if (role === "distributor") {
      t = performance.now();
      let distResult;
      try {
        distResult = await sb.from("distributor_profiles").select("*").eq("id", currentUser.id).single();
        if (distResult.error) throw distResult.error;
      } catch (error) {
        traceStage("distributorProfile", "failed", traceError(error), performance.now() - t);
        currentUser = null;
        publishAuthContext({
          state: "error",
          ready: true,
          authenticated: true,
          userId: user.id,
          role: "distributor",
          profileLoaded: true,
          distributorProfileLoaded: false,
          errorCode: "DISTRIBUTOR_PROFILE_LOAD_FAILED",
          errorMessage: traceError(error)
        });
        throw error;
      }
      if (!distResult.data) {
        traceStage(
          "distributorProfile",
          "missing",
          "Distributor role has no distributor_profiles row.",
          performance.now() - t
        );
        currentUser = null;
        publishAuthContext({
          state: "error",
          ready: true,
          authenticated: true,
          userId: user.id,
          role: "distributor",
          profileLoaded: true,
          distributorProfileLoaded: false,
          errorCode: "DISTRIBUTOR_PROFILE_MISSING",
          errorMessage: "Distributor role has no distributor_profiles row."
        });
        throw new Error("Distributor profile is missing.");
      }
      traceStage(
        "distributorProfile",
        "resolved",
        "Distributor principal profile resolved.",
        performance.now() - t
      );
      currentUser = Object.assign({}, currentUser, distResult.data);
      publishAuthContext({
        state: "authenticated_distributor",
        ready: true,
        authenticated: true,
        userId: user.id,
        role: "distributor",
        profileLoaded: true,
        distributorProfileLoaded: true,
        errorCode: null,
        errorMessage: null
      });
    } else if (role === "buyer") {
      t = performance.now();
      const buyerResult = await sb.from("buyer_profiles").select("*").eq("id", currentUser.id).single();
      if (buyerResult.error) {
        traceStage(
          "distributorProfile",
          "not_applicable",
          "Buyer role; distributor profile not required.",
          performance.now() - t
        );
        publishAuthContext({
          state: "error",
          ready: true,
          authenticated: true,
          userId: user.id,
          role: "buyer",
          profileLoaded: true,
          errorCode: "BUYER_PROFILE_LOAD_FAILED",
          errorMessage: buyerResult.error.message || String(buyerResult.error)
        });
        throw buyerResult.error;
      }
      currentUser = Object.assign({}, currentUser, buyerResult.data || {});
      traceStage(
        "distributorProfile",
        "not_applicable",
        "Buyer role; distributor profile not required.",
        performance.now() - t
      );
      publishAuthContext({
        state: "authenticated_user",
        ready: true,
        authenticated: true,
        userId: user.id,
        role: "buyer",
        profileLoaded: true,
        errorCode: null,
        errorMessage: null
      });
    } else {
      traceStage(
        "distributorProfile",
        "not_applicable",
        "Role does not require distributor profile.",
        0
      );
      publishAuthContext({
        state: "authenticated_user",
        ready: true,
        authenticated: true,
        userId: user.id,
        role: role,
        profileLoaded: true,
        errorCode: null,
        errorMessage: null
      });
    }

    // Stage 6 — application object synchronization invariant.
    if (
      !currentUser ||
      currentUser.id !== user.id ||
      String(currentUser.role || "").toLowerCase() !== role
    ) {
      traceStage(
        "currentUser",
        "failed",
        "currentUser does not match authoritative auth user/profile role.",
        0
      );
      publishAuthContext({
        state: "error",
        ready: true,
        authenticated: true,
        userId: user.id,
        role: role,
        errorCode: "CURRENT_USER_SYNC_FAILED",
        errorMessage: "Application currentUser is not synchronized with authenticated identity."
      });
      throw new Error("currentUser synchronization failed.");
    }
    traceStage(
      "currentUser",
      "resolved",
      "currentUser matches auth user ID and profile role.",
      0
    );

    // Logout button.
    const logoutHolder = document.getElementById("logout-btn-holder");
    if (logoutHolder) {
      logoutHolder.innerHTML = '<span class="logout-btn" onclick="handleLogout()">Log out</span>';
    }

    // Role-scoped navigation. Each lookup is null-safe; missing elements
    // are named in the console so the defect is visible, not silent.
    const navProducts = document.getElementById("nav-products");
    const navStaff    = document.getElementById("nav-staff");
    const navAgent    = document.getElementById("nav-agent");

    if (role === "distributor") {
      if (navProducts) navProducts.style.display = "flex";
      else console.warn("[GoodsbarnX/auth] #nav-products missing from index.html.");
      if (navStaff) navStaff.style.display = "flex";
      else console.warn("[GoodsbarnX/auth] #nav-staff missing from index.html.");
    }
    if (role === "agent") {
      if (navAgent) navAgent.style.display = "flex";
      else console.warn(
        "[GoodsbarnX/auth] #nav-agent missing from index.html. " +
        "Agent role cannot navigate to #screen-agent."
      );
    }

    publishAuthContext({
      execution: {
        state: "completed",
        startedAt: (window.goodsbarnxAuthContext.execution || {}).startedAt || null,
        completedAt: new Date().toISOString()
      }
    });

    // Notify listeners that auth state settled.
    window.dispatchEvent(new CustomEvent("auth-state-changed", {
      detail: { user: currentUser }
    }));

    return currentUser;
  })();

  window.goodsbarnxAuthContextPromise = goodsbarnxAuthResolutionPromise;

  try {
    return await goodsbarnxAuthResolutionPromise;
  } catch (error) {
    const existing = window.goodsbarnxAuthContext || {};
    if (!existing.execution || existing.execution.state !== "completed") {
      publishAuthContext({
        execution: {
          state: "failed",
          startedAt: existing.execution ? existing.execution.startedAt : null,
          completedAt: new Date().toISOString()
        }
      });
    }
    throw error;
  }
}

// --------------------------------------------------------------------------
// SIGNUP
// --------------------------------------------------------------------------

async function handleSignup() {
  const nameEl    = document.getElementById("auth-name");
  const phoneEl   = document.getElementById("auth-phone");
  const emailEl   = document.getElementById("auth-email");
  const pwEl      = document.getElementById("auth-password");
  const confirmEl = document.getElementById("auth-password-confirm");
  const errEl     = document.getElementById("auth-error");

  const name    = nameEl    ? nameEl.value.trim()    : "";
  const phone   = phoneEl   ? phoneEl.value.trim()   : "";
  const email   = emailEl   ? emailEl.value.trim()   : "";
  const password = pwEl     ? pwEl.value             : "";
  const confirm = confirmEl ? confirmEl.value        : "";

  const showError = (msg) => { if (errEl) errEl.innerText = msg; };
  showError("");

  if (!name || !phone || !email || !password || !confirm) {
    showError("Please fill in every field.");
    return;
  }
  if (password !== confirm) {
    showError("Passwords do not match.");
    return;
  }

  const { data, error } = await sb.auth.signUp({ email: email, password: password });
  if (error) {
    showError(error.message);
    return;
  }
  if (!data || !data.user || !data.user.id) {
    showError("Sign-up did not return a user. Please try logging in.");
    return;
  }

  const userId = data.user.id;

  const profileInsert = await sb.from("profiles").insert({
    id: userId,
    full_name: name,
    phone: phone,
    role: selectedSignupRole
  });
  if (profileInsert.error) {
    showError("Account created, but profile could not be saved: " + profileInsert.error.message);
    return;
  }

  if (selectedSignupRole === "distributor") {
    const dist = await sb.from("distributor_profiles").insert({
      id: userId,
      business_name: name
    });
    if (dist.error) {
      showError("Distributor profile could not be saved: " + dist.error.message);
      return;
    }
  } else if (selectedSignupRole === "buyer") {
    const buyer = await sb.from("buyer_profiles").insert({ id: userId });
    if (buyer.error) {
      showError("Buyer profile could not be saved: " + buyer.error.message);
      return;
    }
  }

  goodsbarnxAuthResolutionPromise = null;
  await loadCurrentUser();

  const authShell = document.getElementById("auth-shell");
  const app = document.getElementById("app");
  if (authShell) authShell.classList.add("hidden");
  if (app) app.style.display = "block";
}

// --------------------------------------------------------------------------
// LOGIN
// --------------------------------------------------------------------------

async function handleLogin() {
  const emailEl = document.getElementById("login-email");
  const pwEl    = document.getElementById("login-password");
  const errEl   = document.getElementById("login-error");

  const email    = emailEl ? emailEl.value.trim() : "";
  const password = pwEl    ? pwEl.value           : "";

  const showError = (msg) => { if (errEl) errEl.innerText = msg; };
  showError("");

  if (!email || !password) {
    showError("Please fill in both fields.");
    return;
  }

  const { error } = await sb.auth.signInWithPassword({ email: email, password: password });
  if (error) {
    showError(error.message);
    return;
  }

  goodsbarnxAuthResolutionPromise = null;
  await loadCurrentUser();

  const loginShell = document.getElementById("login-shell");
  const app = document.getElementById("app");
  if (loginShell) loginShell.classList.add("hidden");
  if (app) app.style.display = "block";
}

// --------------------------------------------------------------------------
// LOGOUT
//
// Referenced by logout-btn-holder's onclick, but never declared in the
// payload. Added here.
// --------------------------------------------------------------------------

async function handleLogout() {
  try {
    await sb.auth.signOut();
  } catch (error) {
    console.error("[GoodsbarnX/auth] signOut failed:", error);
  }

  currentUser = null;
  goodsbarnxAuthResolutionPromise = null;

  const app = document.getElementById("app");
  const authShell = document.getElementById("auth-shell");
  const loginShell = document.getElementById("login-shell");
  if (app) app.style.display = "none";
  if (loginShell) loginShell.classList.add("hidden");
  if (authShell) authShell.classList.remove("hidden");

  const logoutHolder = document.getElementById("logout-btn-holder");
  if (logoutHolder) logoutHolder.innerHTML = "";

  window.dispatchEvent(new CustomEvent("auth-state-changed", { detail: { user: null } }));
}

// --------------------------------------------------------------------------
// PASSWORD RESET — request
// --------------------------------------------------------------------------

function openForgotPasswordModal() {
  const emailEl  = document.getElementById("forgot-password-email");
  const statusEl = document.getElementById("forgot-password-status");
  const modal    = document.getElementById("forgot-password-modal");
  if (emailEl)  emailEl.value = "";
  if (statusEl) statusEl.innerText = "";
  if (modal)    modal.classList.add("active");
}

function closeForgotPasswordModal() {
  const modal = document.getElementById("forgot-password-modal");
  if (modal) modal.classList.remove("active");
}

async function sendPasswordReset() {
  const emailEl  = document.getElementById("forgot-password-email");
  const statusEl = document.getElementById("forgot-password-status");
  const email    = emailEl ? emailEl.value.trim() : "";

  const showStatus = (msg) => { if (statusEl) statusEl.innerText = msg; };

  if (!email) {
    showStatus("Enter your email address.");
    return;
  }

  showStatus("Sending...");

  const { error } = await sb.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin
  });

  if (error) {
    showStatus("Error: " + error.message);
  } else {
    showStatus("Check your email for a reset link.");
    setTimeout(closeForgotPasswordModal, 2500);
  }
}

// --------------------------------------------------------------------------
// PASSWORD RESET — completion (PASSWORD_RECOVERY event)
// --------------------------------------------------------------------------

function attachRecoveryListener() {
  // If config.js fell back to the mock, sb.auth.onAuthStateChange is a
  // stub that returns an unused subscription. Do not attach a listener
  // to a client that cannot deliver events.
  const client = window.sb;
  if (!client || !client.auth || typeof client.auth.onAuthStateChange !== "function") {
    console.warn("[GoodsbarnX/auth] onAuthStateChange unavailable; password recovery event will not fire.");
    return;
  }
  // The mock's onAuthStateChange returns { data: { subscription: { unsubscribe } } }
  // and never invokes the callback. Detection is by feature: the real SDK's
  // subscription has a .unsubscribe method; the mock's does too, so we
  // additionally detect the mock's distinguishing marker.
  if (typeof client.from === "function" && client.from.length === 0) {
    // Real client; register normally.
    try {
      client.auth.onAuthStateChange((event) => {
        if (event === "PASSWORD_RECOVERY") {
          const pwEl       = document.getElementById("new-password");
          const confirmEl  = document.getElementById("new-password-confirm");
          const statusEl   = document.getElementById("reset-password-status");
          const modal      = document.getElementById("reset-password-modal");
          if (pwEl)      pwEl.value = "";
          if (confirmEl) confirmEl.value = "";
          if (statusEl)  statusEl.innerText = "";
          if (modal)     modal.classList.add("active");
        }
      });
    } catch (error) {
      console.error("[GoodsbarnX/auth] could not attach recovery listener:", error);
    }
  }
}

async function submitNewPassword() {
  const pwEl      = document.getElementById("new-password");
  const confirmEl = document.getElementById("new-password-confirm");
  const statusEl  = document.getElementById("reset-password-status");

  const password = pwEl      ? pwEl.value      : "";
  const confirm  = confirmEl ? confirmEl.value : "";

  const showStatus = (msg) => { if (statusEl) statusEl.innerText = msg; };

  if (!password || !confirm) {
    showStatus("Fill in both fields.");
    return;
  }
  if (password !== confirm) {
    showStatus("Passwords do not match.");
    return;
  }
  if (password.length < 6) {
    showStatus("Password must be at least 6 characters.");
    return;
  }

  showStatus("Saving...");

  const { error } = await sb.auth.updateUser({ password: password });

  if (error) {
    showStatus("Error: " + error.message);
  } else {
    showStatus("Password updated! Redirecting...");
    setTimeout(() => {
      const modal = document.getElementById("reset-password-modal");
      if (modal) modal.classList.remove("active");
      window.location.href = window.location.origin;
    }, 1500);
  }
}

// --------------------------------------------------------------------------
// PUBLIC DIAGNOSTIC ACCESSORS
// --------------------------------------------------------------------------

window.getGoodsbarnXAuthContext = function () {
  return window.goodsbarnxAuthContext || null;
};

window.getGoodsbarnXAuthResolutionTrace = function () {
  const c = window.goodsbarnxAuthContext || {};
  return {
    version: GBX_AUTH_CONTEXT_VERSION,
    state: c.state,
    ready: c.ready,
    authenticated: c.authenticated,
    userId: c.userId,
    role: c.role,
    trace: c.trace || {},
    errorCode: c.errorCode,
    errorMessage: c.errorMessage
  };
};

// --------------------------------------------------------------------------
// GLOBAL EXPORTS
// --------------------------------------------------------------------------

window.selectRole = selectRole;
window.showLogin = showLogin;
window.showSignup = showSignup;
window.continueAsGuest = continueAsGuest;
window.toggleLoginPassword = toggleLoginPassword;

window.loadCurrentUser = loadCurrentUser;
window.handleSignup = handleSignup;
window.handleLogin = handleLogin;
window.handleLogout = handleLogout;

window.openForgotPasswordModal = openForgotPasswordModal;
window.closeForgotPasswordModal = closeForgotPasswordModal;
window.sendPasswordReset = sendPasswordReset;
window.submitNewPassword = submitNewPassword;

// --------------------------------------------------------------------------
// BOOT — attach recovery listener once DOM is ready.
// --------------------------------------------------------------------------

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", attachRecoveryListener);
} else {
  attachRecoveryListener();
}

console.log("[GoodsbarnX] auth.js loaded.");
