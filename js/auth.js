// ==========================================================================
// GoodsbarnX — auth.js
// Signup, login, logout, role selection, guest mode, current-user resolution.
// Plain global script. Loads third (Canon §10).
//
// V1.8.2.7 — Login remediation.
//   FIXED
//   - handleLogin/handleSignup were defined twice (index.html inline + here);
//     this file now OWNS them. They call preventDefault (the old version did
//     not, so the form natively submitted and reloaded the page) and they
//     switch the UI through showAppShell(), which hides #auth-shell and
//     reveals #app (the old code hid a #login-shell that does not exist).
//   - Supabase client is resolved by sbClient() (window.sb or global sb).
//   - getSession() short-circuit: a logged-out visitor is "unauthenticated",
//     not an AUTH_GET_USER_FAILED error.
//   - profiles / distributor_profiles / buyer_profiles use maybeSingle() so
//     "no row" is reported as MISSING instead of an opaque PGRST116 error.
//   - Signup supports email-confirmation projects (no session after signUp):
//     the pending profile is stored locally and created on first login.
//     Signup is idempotent (duplicate-key errors are tolerated).
//   - agent_profiles insert restored (it lived only in the inline handler).
//   - Password-recovery listener actually attaches (old guard
//     `client.from.length === 0` was never true on the real client).
//   - Role navigation is reset on every resolution so a buyer logging in
//     after a distributor never inherits distributor nav.
//   - A failed resolution is no longer cached; login does not leave a
//     half-signed-in session behind.
//   - Buttons always re-enable (finally blocks); double submit guarded.
//   PRESERVED
//   - Auth context diagnostics + trace (V1.8.2.6.5), public accessors,
//     "auth-state-changed" event, all window exports.
// ==========================================================================

// --------------------------------------------------------------------------
// CONSTANTS & MODULE STATE
// --------------------------------------------------------------------------

const GBX_AUTH_CONTEXT_VERSION = "V1.8.2.7";
window.goodsbarnxAuthContextVersion = GBX_AUTH_CONTEXT_VERSION;

const GBX_PENDING_SIGNUP_KEY = "goodsbarnx_pending_signup";
const GBX_MIN_PASSWORD = 8;
const GBX_ROLES = ["buyer", "distributor", "agent"];

let gbxAuthBusy = false;
let gbxLogoutInFlight = false;

// --------------------------------------------------------------------------
// DIAGNOSTIC AUTH CONTEXT (observability, not intelligence — Canon §28 apart)
// --------------------------------------------------------------------------

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

function completedExecution() {
  return {
    state: "completed",
    startedAt: ((window.goodsbarnxAuthContext || {}).execution || {}).startedAt || null,
    completedAt: new Date().toISOString()
  };
}

// --------------------------------------------------------------------------
// SMALL HELPERS
// --------------------------------------------------------------------------

// Resolve the Supabase client whether config.js exposed it as window.sb or
// as a top-level `sb` binding.
function sbClient() {
  if (window.sb) return window.sb;
  try {
    if (typeof sb !== "undefined" && sb) return sb;
  } catch (e) { /* binding not initialised */ }
  return null;
}

function requireSb() {
  const client = sbClient();
  if (!client) {
    throw new Error("Could not reach the authentication service. Check your connection and refresh the page.");
  }
  return client;
}

// currentUser is declared in app.js; read it defensively.
function gbxCurrentUser() {
  try { return currentUser; } catch (e) { return window.currentUser || null; }
}

function authEl(id) { return document.getElementById(id); }

function authValue(id) {
  const el = authEl(id);
  return el ? el.value : "";
}

function setAuthMessage(id, msg) {
  const el = authEl(id);
  if (el) el.textContent = msg || "";
}

function setAuthNotice(msg) { setAuthMessage("login-notice", msg); }

function setBusy(btn, busy, busyLabel) {
  if (!btn) return;
  if (busy) {
    if (!btn.dataset.idleLabel) btn.dataset.idleLabel = btn.textContent;
    btn.textContent = busyLabel;
    btn.disabled = true;
  } else {
    if (btn.dataset.idleLabel) btn.textContent = btn.dataset.idleLabel;
    btn.disabled = false;
  }
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

// Nigerian numbers → E.164 (+234XXXXXXXXXX). Returns null if not valid.
function normalizeNgPhone(raw) {
  let d = String(raw || "").replace(/\D/g, "");
  if (d.length > 10 && d.indexOf("234") === 0) d = d.slice(3);
  if (d.length === 11 && d.charAt(0) === "0") d = d.slice(1);
  return d.length === 10 ? "+234" + d : null;
}

function normalizeRole(role) {
  const r = String(role || "").toLowerCase();
  return GBX_ROLES.indexOf(r) >= 0 ? r : "buyer";
}

function friendlyAuthError(error, fallback) {
  const msg = (error && error.message) ? String(error.message) : "";
  const lower = msg.toLowerCase();
  if (lower.indexOf("invalid login credentials") >= 0) return "Incorrect email or password.";
  if (lower.indexOf("email not confirmed") >= 0) return "Please confirm your email address first (check your inbox), then log in.";
  if (lower.indexOf("rate limit") >= 0 || lower.indexOf("too many") >= 0) return "Too many attempts. Please wait a minute and try again.";
  if (lower.indexOf("already registered") >= 0 || lower.indexOf("already been registered") >= 0) return "An account with this email already exists. Please log in instead.";
  if (lower.indexOf("failed to fetch") >= 0 || lower.indexOf("networkerror") >= 0 || lower.indexOf("network request failed") >= 0) return "Network problem. Check your connection and try again.";
  return msg || fallback || "Something went wrong. Please try again.";
}

function describeResolutionFailure(error) {
  const code = (window.goodsbarnxAuthContext || {}).errorCode;
  const map = {
    PROFILE_MISSING: "We couldn't find a trade profile for this account. Please create an account or contact support.",
    PROFILE_ROLE_MISSING: "Your profile has no role assigned. Please contact support.",
    DISTRIBUTOR_PROFILE_MISSING: "Your distributor profile is incomplete. Please contact support.",
    PROFILE_LOAD_FAILED: "We couldn't load your profile. Please try again.",
    BUYER_PROFILE_LOAD_FAILED: "We couldn't load your buyer profile. Please try again."
  };
  return map[code] || traceError(error);
}

async function safeSignOut() {
  try {
    const client = sbClient();
    if (client) await client.auth.signOut();
  } catch (error) {
    console.warn("[GoodsbarnX/auth] signOut during cleanup failed:", error);
  }
}

// --------------------------------------------------------------------------
// SHELL VISIBILITY (single place that switches between auth screen and app)
// --------------------------------------------------------------------------

function showAppShell() {
  document.body.classList.remove("auth-active", "auth-booting");
  const authShell = authEl("auth-shell");
  const loginShell = authEl("login-shell"); // legacy markup, if present
  const app = authEl("app");
  if (authShell) authShell.style.display = "none";
  if (loginShell) loginShell.style.display = "none";
  if (app) app.style.display = "block";
}

function showAuthShell(view) {
  document.body.classList.add("auth-active");
  document.body.classList.remove("auth-booting");
  const authShell = authEl("auth-shell");
  const app = authEl("app");
  if (app) app.style.display = "none";
  if (authShell) authShell.style.display = "";
  if (view === "signup") {
    if (typeof window.showSignupView === "function") window.showSignupView();
  } else if (typeof window.showLoginView === "function") {
    window.showLoginView();
  }
}

function clearAuthForms() {
  ["login-password", "auth-password", "auth-password-confirm"].forEach(function (id) {
    const el = authEl(id);
    if (el) el.value = "";
  });
  const bar = authEl("pw-strength");
  if (bar) bar.style.width = "0";
}

function enterApp() {
  clearAuthForms();
  showAppShell();
  if (typeof updateGreeting === "function") updateGreeting();
  if (typeof updateCartBadge === "function") {
    try { updateCartBadge(); } catch (e) { /* non-fatal */ }
  }
  if (typeof window.showScreen === "function") {
    try { window.showScreen("market"); }
    catch (error) { console.error("[GoodsbarnX/auth] showScreen('market') failed:", error); }
  }
}

// --------------------------------------------------------------------------
// ROLE-SCOPED NAVIGATION
// --------------------------------------------------------------------------

function applyRoleNavigation(role) {
  const navProducts = authEl("nav-products");
  const navStaff    = authEl("nav-staff");
  const navAgent    = authEl("nav-agent");

  // Reset first so nav from a previous session never leaks into this one.
  if (navProducts) navProducts.style.display = "none";
  if (navStaff)    navStaff.style.display = "none";
  if (navAgent)    navAgent.style.display = "none";

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
}

// --------------------------------------------------------------------------
// LEGACY ROLE / SCREEN SWITCHING (kept for backward compatibility)
// --------------------------------------------------------------------------

function selectRole(el) {
  if (!el) return;
  const picker = authEl("signup-role-picker");
  if (picker) picker.querySelectorAll(".role-pick").forEach(r => r.classList.remove("sel"));
  el.classList.add("sel");
  selectedSignupRole = el.dataset.role;

  const companyField = authEl("auth-company");
  if (companyField) {
    companyField.style.display = selectedSignupRole === "agent" ? "block" : "none";
  }
}

function showLogin()  { showAuthShell("login"); }
function showSignup() { showAuthShell("signup"); }

function continueAsGuest() {
  showAppShell();
}

function toggleLoginPassword() {
  const pw = authEl("login-password");
  if (!pw) return;
  pw.type = pw.type === "password" ? "text" : "password";
}

// --------------------------------------------------------------------------
// PENDING SIGNUP (email-confirmation projects / interrupted signups)
// --------------------------------------------------------------------------

function savePendingSignup(payload) {
  try { localStorage.setItem(GBX_PENDING_SIGNUP_KEY, JSON.stringify(payload)); }
  catch (e) { console.warn("[GoodsbarnX/auth] could not store pending signup:", e); }
}

function readPendingSignup() {
  try {
    const raw = localStorage.getItem(GBX_PENDING_SIGNUP_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

function clearPendingSignup() {
  try { localStorage.removeItem(GBX_PENDING_SIGNUP_KEY); } catch (e) { /* ignore */ }
}

async function insertRow(client, table, row, label) {
  const res = await client.from(table).insert(row);
  // 23505 = unique_violation: the row already exists, which is fine (idempotent).
  if (res.error && res.error.code !== "23505") {
    throw new Error(label + " could not be saved: " + (res.error.message || "unknown error"));
  }
}

async function provisionSignupRecords(userId, p) {
  const client = requireSb();
  const role = normalizeRole(p.role);

  await insertRow(client, "profiles", {
    id: userId,
    full_name: p.name,
    phone: p.phone,
    role: role
  }, "Profile");

  if (role === "distributor") {
    await insertRow(client, "distributor_profiles", {
      id: userId,
      business_name: p.business || p.name
    }, "Distributor profile");
  } else if (role === "buyer") {
    await insertRow(client, "buyer_profiles", { id: userId }, "Buyer profile");
  } else if (role === "agent") {
    await insertRow(client, "agent_profiles", {
      id: userId,
      company_name: p.company || p.name
    }, "Agent profile");
  }
}

// Called from loadCurrentUser once the authenticated user is known.
async function resumePendingSignup(user) {
  const p = readPendingSignup();
  if (!p || p.userId !== user.id) return;
  try {
    await provisionSignupRecords(user.id, p);
    clearPendingSignup();
  } catch (error) {
    // Do not block: the profile stage reports the precise failure.
    console.warn("[GoodsbarnX/auth] could not finish pending signup:", traceError(error));
  }
}

// --------------------------------------------------------------------------
// CURRENT USER RESOLUTION — the single authentication execution boundary
// --------------------------------------------------------------------------

async function loadCurrentUser() {
  if (goodsbarnxAuthResolutionPromise) return goodsbarnxAuthResolutionPromise;

  goodsbarnxAuthResolutionPromise = (async function resolve() {
    resetAuthContext();
    publishAuthContext({
      execution: { state: "running", startedAt: new Date().toISOString(), completedAt: null }
    });
    currentUser = null;

    const client = sbClient();
    if (!client) {
      publishAuthContext({
        state: "error",
        ready: true,
        authenticated: false,
        errorCode: "SB_CLIENT_MISSING",
        errorMessage: "Supabase client is not available."
      });
      throw new Error("Supabase client is not available.");
    }

    // Stage 1 — session boundary.
    let t = performance.now();
    let session = null;
    try {
      const sessionResult = await client.auth.getSession();
      if (sessionResult && sessionResult.error) throw sessionResult.error;
      session = sessionResult && sessionResult.data && sessionResult.data.session;
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

    // A visitor with no session is simply unauthenticated — not an error.
    if (!session) {
      traceStage("authUser", "absent", "No session; user lookup skipped.", 0);
      publishAuthContext({
        state: "unauthenticated",
        ready: true,
        authenticated: false,
        errorCode: null,
        errorMessage: null,
        execution: completedExecution()
      });
      return null;
    }

    // Stage 2 — authoritative auth user.
    t = performance.now();
    let authResult;
    try {
      authResult = await client.auth.getUser();
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
    const authError = authResult && authResult.error;
    if (authError && authError.name !== "AuthSessionMissingError") {
      traceStage("authUser", "failed", traceError(authError), performance.now() - t);
      publishAuthContext({
        state: "error",
        ready: true,
        authenticated: false,
        errorCode: "AUTH_GET_USER_FAILED",
        errorMessage: traceError(authError)
      });
      throw authError;
    }

    const user = !authError && authResult && authResult.data ? authResult.data.user : null;
    if (!user) {
      traceStage("authUser", "absent", "Supabase returned no authenticated user.", performance.now() - t);
      publishAuthContext({
        state: "unauthenticated",
        ready: true,
        authenticated: false,
        errorCode: null,
        errorMessage: null,
        execution: completedExecution()
      });
      return null;
    }
    traceStage("authUser", "resolved", "Authenticated user resolved.", performance.now() - t);
    publishAuthContext({
      state: "auth_user_resolved",
      ready: false,
      authenticated: true,
      userId: user.id,
      role: null // Canon §29: role is unknown until the profile resolves.
    });

    // Finish an interrupted / email-confirmed signup, if one is pending.
    await resumePendingSignup(user);

    // Stage 3 — canonical profiles row.
    t = performance.now();
    let profileResult;
    try {
      profileResult = await client.from("profiles").select("*").eq("id", user.id).maybeSingle();
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
      traceStage("profile", "missing", "Authenticated user has no profiles row.", performance.now() - t);
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
        distResult = await client.from("distributor_profiles").select("*").eq("id", currentUser.id).maybeSingle();
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
        traceStage("distributorProfile", "missing", "Distributor role has no distributor_profiles row.", performance.now() - t);
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
      traceStage("distributorProfile", "resolved", "Distributor principal profile resolved.", performance.now() - t);
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
      const buyerResult = await client.from("buyer_profiles").select("*").eq("id", currentUser.id).maybeSingle();
      if (buyerResult.error) {
        traceStage("distributorProfile", "not_applicable", "Buyer role; distributor profile not required.", performance.now() - t);
        currentUser = null;
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
      let buyerRow = buyerResult.data;
      if (!buyerRow) {
        // Self-heal an interrupted signup: the buyer row carries no required data.
        const healed = await client.from("buyer_profiles").insert({ id: currentUser.id });
        if (healed.error && healed.error.code !== "23505") {
          console.warn("[GoodsbarnX/auth] buyer_profiles row missing and could not be created:", healed.error.message);
        }
      }
      currentUser = Object.assign({}, currentUser, buyerRow || {});
      traceStage("distributorProfile", "not_applicable", "Buyer role; distributor profile not required.", performance.now() - t);
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
      traceStage("distributorProfile", "not_applicable", "Role does not require distributor profile.", 0);
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
      traceStage("currentUser", "failed", "currentUser does not match authoritative auth user/profile role.", 0);
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
    traceStage("currentUser", "resolved", "currentUser matches auth user ID and profile role.", 0);

    // Logout button.
    const logoutHolder = authEl("logout-btn-holder");
    if (logoutHolder) {
      logoutHolder.innerHTML = '<span class="logout-btn" onclick="handleLogout()">Log out</span>';
    }

    // Role-scoped navigation (reset, then apply; missing elements are named).
    applyRoleNavigation(role);

    publishAuthContext({ execution: completedExecution() });

    window.dispatchEvent(new CustomEvent("auth-state-changed", {
      detail: { user: currentUser }
    }));

    return currentUser;
  })();

  window.goodsbarnxAuthContextPromise = goodsbarnxAuthResolutionPromise;

  try {
    return await goodsbarnxAuthResolutionPromise;
  } catch (error) {
    // Never cache a failed resolution: the next attempt must run fresh.
    goodsbarnxAuthResolutionPromise = null;
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

// Wait for any in-flight resolution, then clear the cache so the next
// loadCurrentUser() re-resolves from Supabase (used right after login/signup).
async function settleAuthResolution() {
  if (goodsbarnxAuthResolutionPromise) {
    try { await goodsbarnxAuthResolutionPromise; } catch (e) { /* surfaced elsewhere */ }
  }
  goodsbarnxAuthResolutionPromise = null;
}

async function refreshCurrentUser() {
  await settleAuthResolution();
  return loadCurrentUser();
}

// --------------------------------------------------------------------------
// SIGNUP
// --------------------------------------------------------------------------

async function handleSignup(e) {
  if (e && typeof e.preventDefault === "function") e.preventDefault();
  if (gbxAuthBusy) return;

  const btn = authEl("signup-btn");
  setAuthMessage("auth-error", "");

  const name     = authValue("auth-name").trim();
  const phoneRaw = authValue("auth-phone").trim();
  const email    = normalizeEmail(authValue("auth-email"));
  const password = authValue("auth-password");
  const confirm  = authValue("auth-password-confirm");
  const business = authValue("auth-business").trim();
  const company  = authValue("auth-company").trim();

  let role = "buyer";
  try { role = normalizeRole(selectedSignupRole); } catch (err) { /* default buyer */ }

  const fail = (msg) => setAuthMessage("auth-error", msg);

  if (!name || !phoneRaw || !email || !password || !confirm) {
    return fail("Please fill in every field.");
  }
  if (name.length < 2) return fail("Please enter your full name.");
  if (!isValidEmail(email)) return fail("Please enter a valid email address.");
  const phone = normalizeNgPhone(phoneRaw);
  if (!phone) return fail("Enter a valid Nigerian phone number, e.g. 803 123 4567.");
  if (password.length < GBX_MIN_PASSWORD) {
    return fail("Password must be at least " + GBX_MIN_PASSWORD + " characters.");
  }
  if (password !== confirm) return fail("Passwords do not match.");
  if (role === "distributor" && !business) return fail("Please enter your business name.");
  if (role === "agent" && !company) return fail("Please enter your agency or company name.");

  gbxAuthBusy = true;
  setBusy(btn, true, "Creating Account...");

  let accountCreated = false;
  let hadSession = false;

  try {
    await settleAuthResolution();
    const client = requireSb();

    // 1. Auth account.
    const { data, error } = await client.auth.signUp({ email: email, password: password });
    if (error) throw error;

    const user = data && data.user;
    if (!user || !user.id) {
      throw new Error("Sign-up did not return a user. Please try logging in.");
    }
    // Supabase returns an obfuscated user with no identities for an existing email.
    if (Array.isArray(user.identities) && user.identities.length === 0) {
      throw new Error("An account with this email already exists. Please log in instead.");
    }
    accountCreated = true;
    hadSession = !!(data && data.session);

    const payload = {
      userId: user.id,
      email: email,
      role: role,
      name: name,
      phone: phone,
      business: business,
      company: company
    };

    // Persist intent first so an interruption heals on the next login.
    savePendingSignup(payload);

    // Email confirmation required: no session yet, so RLS would reject inserts.
    if (!hadSession) {
      if (typeof window.showLoginView === "function") window.showLoginView();
      const loginEmail = authEl("login-email");
      if (loginEmail) loginEmail.value = email;
      setAuthNotice("Account created. Check your email to confirm your address, then log in to finish setup.");
      return;
    }

    // 2. Profile rows (canonical + role-specific).
    await provisionSignupRecords(user.id, payload);
    clearPendingSignup();

    // 3. Resolve the user and enter the app.
    await refreshCurrentUser();
    if (!gbxCurrentUser()) throw new Error("Account created, but we could not load it. Please log in.");
    enterApp();
  } catch (error) {
    let msg = friendlyAuthError(error, "Failed to create account.");
    if (accountCreated && hadSession) {
      msg = msg + " Your account was created — log in and we'll finish setting it up.";
      await safeSignOut();
      if (typeof window.showLoginView === "function") window.showLoginView();
      const loginEmail = authEl("login-email");
      if (loginEmail) loginEmail.value = email;
      setAuthMessage("login-error", msg);
      setAuthMessage("auth-error", "");
    } else {
      fail(msg);
    }
  } finally {
    gbxAuthBusy = false;
    setBusy(btn, false);
  }
}

// --------------------------------------------------------------------------
// LOGIN
// --------------------------------------------------------------------------

async function handleLogin(e) {
  if (e && typeof e.preventDefault === "function") e.preventDefault();
  if (gbxAuthBusy) return;

  const btn = authEl("login-btn");
  setAuthMessage("login-error", "");
  setAuthNotice("");

  const email    = normalizeEmail(authValue("login-email"));
  const password = authValue("login-password");

  if (!email || !password) {
    setAuthMessage("login-error", "Please enter your email and password.");
    return;
  }
  if (!isValidEmail(email)) {
    setAuthMessage("login-error", "Please enter a valid email address.");
    return;
  }

  gbxAuthBusy = true;
  setBusy(btn, true, "Logging in...");

  try {
    await settleAuthResolution();
    const client = requireSb();

    const { error } = await client.auth.signInWithPassword({ email: email, password: password });
    if (error) throw error;

    try {
      await refreshCurrentUser();
    } catch (resolveError) {
      // Do not leave a half-signed-in session behind.
      await safeSignOut();
      throw new Error(describeResolutionFailure(resolveError));
    }

    if (!gbxCurrentUser()) {
      await safeSignOut();
      throw new Error("We couldn't load your account. Please try again.");
    }

    enterApp();
  } catch (error) {
    setAuthMessage("login-error", friendlyAuthError(error, "Invalid credentials."));
  } finally {
    gbxAuthBusy = false;
    setBusy(btn, false);
  }
}

// --------------------------------------------------------------------------
// LOGOUT
// --------------------------------------------------------------------------

function resetSignedOutState() {
  currentUser = null;
  goodsbarnxAuthResolutionPromise = null;
  publishAuthContext({
    state: "unauthenticated",
    ready: true,
    authenticated: false,
    userId: null,
    role: null,
    profileLoaded: false,
    distributorProfileLoaded: false,
    errorCode: null,
    errorMessage: null
  });

  applyRoleNavigation(null);
  const logoutHolder = authEl("logout-btn-holder");
  if (logoutHolder) logoutHolder.innerHTML = "";

  clearAuthForms();
  showAuthShell("login");

  window.dispatchEvent(new CustomEvent("auth-state-changed", { detail: { user: null } }));
}

async function handleLogout() {
  gbxLogoutInFlight = true;
  try {
    await requireSb().auth.signOut();
  } catch (error) {
    console.error("[GoodsbarnX/auth] signOut failed:", error);
  } finally {
    gbxLogoutInFlight = false;
  }
  resetSignedOutState();
}

// Session ended elsewhere (other tab, expiry): return to the auth screen.
function handleExternalSignOut() {
  if (gbxLogoutInFlight) return;
  if (!gbxCurrentUser()) return;
  resetSignedOutState();
}

// --------------------------------------------------------------------------
// PASSWORD RESET — request
// --------------------------------------------------------------------------

function openForgotPasswordModal() {
  const emailEl  = authEl("forgot-password-email");
  const statusEl = authEl("forgot-password-status");
  const modal    = authEl("forgot-password-modal");
  const loginEmail = normalizeEmail(authValue("login-email"));
  if (emailEl)  emailEl.value = isValidEmail(loginEmail) ? loginEmail : "";
  if (statusEl) statusEl.textContent = "";
  if (modal)    modal.classList.add("active");
  if (emailEl) setTimeout(function () { emailEl.focus(); }, 50);
}

function closeForgotPasswordModal() {
  const modal = authEl("forgot-password-modal");
  if (modal) modal.classList.remove("active");
}

async function sendPasswordReset() {
  const email = normalizeEmail(authValue("forgot-password-email"));
  const showStatus = (msg) => setAuthMessage("forgot-password-status", msg);

  if (!email) { showStatus("Enter your email address."); return; }
  if (!isValidEmail(email)) { showStatus("Enter a valid email address."); return; }

  showStatus("Sending...");
  try {
    const { error } = await requireSb().auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin
    });
    if (error) {
      showStatus("Error: " + friendlyAuthError(error));
    } else {
      showStatus("Check your email for a reset link.");
      setTimeout(closeForgotPasswordModal, 2500);
    }
  } catch (error) {
    showStatus("Error: " + friendlyAuthError(error));
  }
}

// --------------------------------------------------------------------------
// PASSWORD RESET — completion (PASSWORD_RECOVERY event)
// --------------------------------------------------------------------------

function openResetPasswordModal() {
  const modal = authEl("reset-password-modal");
  if (!modal || modal.classList.contains("active")) return;
  const pwEl      = authEl("new-password");
  const confirmEl = authEl("new-password-confirm");
  if (pwEl)      pwEl.value = "";
  if (confirmEl) confirmEl.value = "";
  setAuthMessage("reset-password-status", "");
  modal.classList.add("active");
  if (pwEl) setTimeout(function () { pwEl.focus(); }, 50);
}

let gbxRecoveryListenerAttached = false;

function attachRecoveryListener() {
  if (gbxRecoveryListenerAttached) return;
  const client = sbClient();
  if (!client || !client.auth || typeof client.auth.onAuthStateChange !== "function") {
    console.warn("[GoodsbarnX/auth] onAuthStateChange unavailable; password recovery event will not fire.");
    return;
  }
  try {
    client.auth.onAuthStateChange(function (event) {
      // Defer: never call back into Supabase from inside this callback.
      if (event === "PASSWORD_RECOVERY") {
        setTimeout(openResetPasswordModal, 0);
      } else if (event === "SIGNED_OUT") {
        setTimeout(handleExternalSignOut, 0);
      }
    });
    gbxRecoveryListenerAttached = true;
  } catch (error) {
    console.error("[GoodsbarnX/auth] could not attach auth listener:", error);
  }
}

// Fallback: if the recovery event fired before the listener existed, the URL still says so.
function detectRecoveryInUrl() {
  const marker = (window.location.hash || "") + (window.location.search || "");
  if (/type=recovery/.test(marker)) setTimeout(openResetPasswordModal, 600);
}

async function submitNewPassword() {
  const password = authValue("new-password");
  const confirm  = authValue("new-password-confirm");
  const showStatus = (msg) => setAuthMessage("reset-password-status", msg);

  if (!password || !confirm) { showStatus("Fill in both fields."); return; }
  if (password !== confirm)  { showStatus("Passwords do not match."); return; }
  if (password.length < GBX_MIN_PASSWORD) {
    showStatus("Password must be at least " + GBX_MIN_PASSWORD + " characters.");
    return;
  }

  showStatus("Saving...");
  try {
    const { error } = await requireSb().auth.updateUser({ password: password });
    if (error) {
      showStatus("Error: " + friendlyAuthError(error));
      return;
    }
    showStatus("Password updated! Redirecting...");
    setTimeout(function () {
      const modal = authEl("reset-password-modal");
      if (modal) modal.classList.remove("active");
      window.location.href = window.location.origin;
    }, 1500);
  } catch (error) {
    showStatus("Error: " + friendlyAuthError(error));
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

window.showAppShell = showAppShell;
window.showAuthShell = showAuthShell;
window.enterApp = enterApp;

window.loadCurrentUser = loadCurrentUser;
window.refreshCurrentUser = refreshCurrentUser;
window.handleSignup = handleSignup;
window.handleLogin = handleLogin;
window.handleLogout = handleLogout;

window.openForgotPasswordModal = openForgotPasswordModal;
window.closeForgotPasswordModal = closeForgotPasswordModal;
window.sendPasswordReset = sendPasswordReset;
window.submitNewPassword = submitNewPassword;

// --------------------------------------------------------------------------
// BOOT
// The Supabase client already exists (config.js loads first), so attach the
// listener immediately — waiting for DOMContentLoaded can miss the
// PASSWORD_RECOVERY event.
// --------------------------------------------------------------------------

attachRecoveryListener();

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", function () {
    attachRecoveryListener();
    detectRecoveryInUrl();
  });
} else {
  detectRecoveryInUrl();
}

console.log("[GoodsbarnX] auth.js loaded (" + GBX_AUTH_CONTEXT_VERSION + ").");
