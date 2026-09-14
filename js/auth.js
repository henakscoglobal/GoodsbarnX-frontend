// ==========================================================================
// GoodsbarnX — auth.js
// Signup, login, logout, role selection, guest mode, current user loading.
// V1.8.2.6.6 — Supabase Auth State Trace.
// Plain global script — depends on js/config.js (for `sb`) being loaded first.
// ===========================================================================

// ---------- Role / screen switching ----------

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

// ---------- V1.8.2.6.6 Supabase Auth State Trace ----------
// Diagnostic-only boundary over the existing Supabase auth/profile flow.
// No second authentication mechanism. No database writes.
const GBX_AUTH_CONTEXT_VERSION = "V1.8.2.6.6";
window.goodsbarnxAuthContextVersion = GBX_AUTH_CONTEXT_VERSION;

window.goodsbarnxAuthContext = {
  state: "initializing",
  ready: false,
  authenticated: false,
  userId: null,
  role: null,
  profileLoaded: false,
  distributorProfileLoaded: false,
  errorCode: null,
  errorMessage: null,
  initializedAt: null,
  resolvedAt: null,
  execution: { state: "not_started", startedAt: null, completedAt: null },
  authStateTrace: {
    listenerInstalledAt: null,
    events: [],
    lastEvent: null
  },
  trace: {
    session: { status: "not_started", ms: null, detail: null },
    authUser: { status: "not_started", ms: null, detail: null },
    profile: { status: "not_started", ms: null, detail: null },
    role: { status: "not_started", ms: null, detail: null },
    distributorProfile: { status: "not_started", ms: null, detail: null },
    currentUser: { status: "not_started", ms: null, detail: null }
  }
};

let goodsbarnxAuthResolutionPromise = null;

function resetAuthContext() {
  window.goodsbarnxAuthContext = {
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
      session: { status: "not_started", ms: null, detail: null },
      authUser: { status: "not_started", ms: null, detail: null },
      profile: { status: "not_started", ms: null, detail: null },
      role: { status: "not_started", ms: null, detail: null },
      distributorProfile: { status: "not_started", ms: null, detail: null },
      currentUser: { status: "not_started", ms: null, detail: null }
    }
  };
}

function publishAuthContext(patch) {
  window.goodsbarnxAuthContext = Object.assign({}, window.goodsbarnxAuthContext || {}, patch, {
    resolvedAt: patch && patch.ready ? new Date().toISOString() : (window.goodsbarnxAuthContext && window.goodsbarnxAuthContext.resolvedAt) || null
  });
}

function traceStage(stage, status, detail, ms) {
  const ctx = window.goodsbarnxAuthContext || {};
  const trace = Object.assign({}, ctx.trace || {});
  trace[stage] = { status: status, ms: Number.isFinite(ms) ? Math.round(ms) : null, detail: detail == null ? null : String(detail) };
  publishAuthContext({ trace });
}

function traceError(error) {
  return error && error.message ? error.message : String(error || "Unknown error");
}

// ---------- V1.8.2.6.6 Supabase Auth State Trace ----------
// Diagnostic-only. Records auth lifecycle events without exposing tokens or
// creating a second authentication mechanism. The resolver remains authoritative.
function recordAuthStateEvent(event, session) {
  const ctx = window.goodsbarnxAuthContext || {};
  const trace = Object.assign({}, ctx.authStateTrace || {});
  const events = Array.isArray(trace.events) ? trace.events.slice(-19) : [];
  const userId = session && session.user ? session.user.id : null;
  const entry = {
    event: String(event || "UNKNOWN"),
    at: new Date().toISOString(),
    hasSession: !!session,
    userId: userId || null
  };
  events.push(entry);
  trace.events = events;
  trace.lastEvent = entry;
  publishAuthContext({ authStateTrace: trace });
}

function installAuthStateTrace() {
  if (!window.sb || !sb.auth || typeof sb.auth.onAuthStateChange !== "function") return;
  if (window.goodsbarnxAuthStateTraceSubscription) return;
  const installedAt = new Date().toISOString();
  publishAuthContext({
    authStateTrace: Object.assign({}, window.goodsbarnxAuthContext.authStateTrace || {}, {
      listenerInstalledAt: installedAt
    })
  });
  const result = sb.auth.onAuthStateChange(function(event, session) {
    recordAuthStateEvent(event, session);
  });
  window.goodsbarnxAuthStateTraceSubscription = result && result.data && result.data.subscription ? result.data.subscription : result;
}

// Listener installation is intentionally deferred to loadCurrentUser() so the
// trace state is initialized first and cannot be wiped by resetAuthContext().

// ---------- Current user / resolution trace ----------
async function loadCurrentUser() {
  if (goodsbarnxAuthResolutionPromise) return goodsbarnxAuthResolutionPromise;

  goodsbarnxAuthResolutionPromise = (async function() {
    resetAuthContext();
    // V1.8.2.6.6.1: install/rebind the diagnostic listener AFTER trace state
    // initialization but BEFORE the first getSession() call. This preserves the
    // listener marker/events and guarantees the lifecycle trace belongs to this
    // resolver execution.
    installAuthStateTrace();
    publishAuthContext({
      execution: {
        state: "running",
        startedAt: new Date().toISOString(),
        completedAt: null
      }
    });
    currentUser = null;

    // Stage 1: Supabase client/session boundary.
    let t = performance.now();
    try {
      const sessionResult = await sb.auth.getSession();
      const session = sessionResult && sessionResult.data && sessionResult.data.session;
      if (sessionResult && sessionResult.error) throw sessionResult.error;
      traceStage("session", session ? "resolved" : "absent", session ? "Supabase session present." : "No active Supabase session.", performance.now() - t);
    } catch (error) {
      traceStage("session", "failed", traceError(error), performance.now() - t);
      publishAuthContext({ state: "error", ready: true, authenticated: false, errorCode: "AUTH_SESSION_FAILED", errorMessage: traceError(error) });
      throw error;
    }

    // Stage 2: authoritative Supabase auth user.
    t = performance.now();
    let authResult;
    try {
      authResult = await sb.auth.getUser();
      if (authResult.error) throw authResult.error;
    } catch (error) {
      traceStage("authUser", "failed", traceError(error), performance.now() - t);
      publishAuthContext({ state: "error", ready: true, authenticated: false, errorCode: "AUTH_GET_USER_FAILED", errorMessage: traceError(error) });
      throw error;
    }

    const user = authResult.data && authResult.data.user;
    if (!user) {
      traceStage("authUser", "absent", "Supabase returned no authenticated user.", performance.now() - t);
      publishAuthContext({ state: "unauthenticated", ready: true, authenticated: false, errorCode: null, errorMessage: null, execution: { state: "completed", startedAt: (window.goodsbarnxAuthContext.execution || {}).startedAt || null, completedAt: new Date().toISOString() } });
      return null;
    }
    traceStage("authUser", "resolved", "Authenticated user resolved.", performance.now() - t);
    publishAuthContext({ state: "auth_user_resolved", ready: false, authenticated: true, userId: user.id });

    // Stage 3: canonical profiles row.
    t = performance.now();
    let profileResult;
    try {
      profileResult = await sb.from("profiles").select("*").eq("id", user.id).single();
      if (profileResult.error) throw profileResult.error;
    } catch (error) {
      traceStage("profile", "failed", traceError(error), performance.now() - t);
      publishAuthContext({ state: "error", ready: true, authenticated: true, userId: user.id, errorCode: "PROFILE_LOAD_FAILED", errorMessage: traceError(error) });
      throw error;
    }
    if (!profileResult.data) {
      traceStage("profile", "missing", "Authenticated user has no profiles row.", performance.now() - t);
      publishAuthContext({ state: "error", ready: true, authenticated: true, userId: user.id, errorCode: "PROFILE_MISSING", errorMessage: "Authenticated user has no profiles row." });
      throw new Error("Authenticated user profile is missing.");
    }
    traceStage("profile", "resolved", "Canonical profiles row resolved.", performance.now() - t);
    currentUser = { id: user.id, ...profileResult.data };
    publishAuthContext({ state: "profile_resolved", ready: false, authenticated: true, userId: user.id, role: currentUser.role || null, profileLoaded: true });

    // Stage 4: role contract.
    const role = String(currentUser.role || "").toLowerCase();
    traceStage("role", role ? "resolved" : "missing", role ? "Role = " + role + "." : "profiles.role is empty.", 0);
    if (!role) {
      currentUser = null;
      publishAuthContext({ state: "error", ready: true, authenticated: true, userId: user.id, profileLoaded: true, errorCode: "PROFILE_ROLE_MISSING", errorMessage: "Authenticated profile has no role." });
      throw new Error("Authenticated profile role is missing.");
    }

    // Stage 5: distributor principal profile when role requires it.
    if (role === "distributor") {
      t = performance.now();
      let distResult;
      try {
        distResult = await sb.from("distributor_profiles").select("*").eq("id", currentUser.id).single();
        if (distResult.error) throw distResult.error;
      } catch (error) {
        traceStage("distributorProfile", "failed", traceError(error), performance.now() - t);
        currentUser = null;
        publishAuthContext({ state: "error", ready: true, authenticated: true, userId: user.id, role: "distributor", profileLoaded: true, distributorProfileLoaded: false, errorCode: "DISTRIBUTOR_PROFILE_LOAD_FAILED", errorMessage: traceError(error) });
        throw error;
      }
      if (!distResult.data) {
        traceStage("distributorProfile", "missing", "Distributor role has no distributor_profiles row.", performance.now() - t);
        currentUser = null;
        publishAuthContext({ state: "error", ready: true, authenticated: true, userId: user.id, role: "distributor", profileLoaded: true, distributorProfileLoaded: false, errorCode: "DISTRIBUTOR_PROFILE_MISSING", errorMessage: "Distributor role has no distributor_profiles row." });
        throw new Error("Distributor profile is missing.");
      }
      traceStage("distributorProfile", "resolved", "Distributor principal profile resolved.", performance.now() - t);
      currentUser = { ...currentUser, ...distResult.data };
      publishAuthContext({ state: "authenticated_distributor", ready: true, authenticated: true, userId: user.id, role: "distributor", profileLoaded: true, distributorProfileLoaded: true, errorCode: null, errorMessage: null });
    } else if (role === "buyer") {
      t = performance.now();
      const buyerResult = await sb.from("buyer_profiles").select("*").eq("id", currentUser.id).single();
      if (buyerResult.error) {
        traceStage("distributorProfile", "not_applicable", "Buyer role; distributor profile not required.", performance.now() - t);
        publishAuthContext({ state: "error", ready: true, authenticated: true, userId: user.id, role: "buyer", profileLoaded: true, errorCode: "BUYER_PROFILE_LOAD_FAILED", errorMessage: buyerResult.error.message || String(buyerResult.error) });
        throw buyerResult.error;
      }
      currentUser = { ...currentUser, ...(buyerResult.data || {}) };
      traceStage("distributorProfile", "not_applicable", "Buyer role; distributor profile not required.", performance.now() - t);
      publishAuthContext({ state: "authenticated_user", ready: true, authenticated: true, userId: user.id, role: "buyer", profileLoaded: true, errorCode: null, errorMessage: null });
    } else {
      traceStage("distributorProfile", "not_applicable", "Role does not require distributor profile.", 0);
      publishAuthContext({ state: "authenticated_user", ready: true, authenticated: true, userId: user.id, role: role, profileLoaded: true, errorCode: null, errorMessage: null });
    }

    // Stage 6: application object synchronization invariant.
    const syncMs = 0;
    if (!currentUser || currentUser.id !== user.id || String(currentUser.role || "").toLowerCase() !== role) {
      traceStage("currentUser", "failed", "currentUser does not match authoritative auth user/profile role.", syncMs);
      publishAuthContext({ state: "error", ready: true, authenticated: true, userId: user.id, role: role, errorCode: "CURRENT_USER_SYNC_FAILED", errorMessage: "Application currentUser is not synchronized with authenticated identity." });
      throw new Error("currentUser synchronization failed.");
    }
    traceStage("currentUser", "resolved", "currentUser matches auth user ID and profile role.", syncMs);

    const logoutHolder = document.getElementById("logout-btn-holder");
    if (logoutHolder) logoutHolder.innerHTML = '<span class="logout-btn" onclick="handleLogout()">Log out</span>';
    if (currentUser.role === "distributor") {
      const navProducts = document.getElementById("nav-products");
      const navStaff = document.getElementById("nav-staff");
      if (navProducts) navProducts.style.display = "flex";
      if (navStaff) navStaff.style.display = "flex";
    }
    if (currentUser.role === "agent") {
      const navAgent = document.getElementById("nav-agent");
      if (navAgent) navAgent.style.display = "flex";
    }
    publishAuthContext({
      execution: {
        state: "completed",
        startedAt: (window.goodsbarnxAuthContext.execution || {}).startedAt || null,
        completedAt: new Date().toISOString()
      }
    });
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
  } finally {
    // A successful resolution remains authoritative for this page session.
    // A failed resolution may be retried only by an explicit caller after a new auth action.
  }
}

window.getGoodsbarnXAuthContext = function() {
  return window.goodsbarnxAuthContext || null;
};
window.getGoodsbarnXAuthResolutionTrace = function() {
  const c = window.goodsbarnxAuthContext || {};
  return { version: GBX_AUTH_CONTEXT_VERSION, state: c.state, ready: c.ready, authenticated: c.authenticated, userId: c.userId, role: c.role, trace: c.trace || {}, errorCode: c.errorCode, errorMessage: c.errorMessage };
};

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

  goodsbarnxAuthResolutionPromise = null;
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

  goodsbarnxAuthResolutionPromise = null;
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

// ---------- Set new password ----------

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
