// ==========================================================================
// GoodsbarnX — auth.js
// V1.8.2.6.4 — AUTH RESOLUTION TRACE
//
// Purpose:
// Establish and expose an explicit authentication → profile → role →
// distributor-principal → currentUser resolution chain.
//
// This is NOT an Allocation upgrade.
// This file performs no business-data writes.
//
// Dependencies:
//   - js/config.js
//   - Supabase JS v2
//
// Loaded before:
//   - market.js
//   - inquiries.js
//   - storefront.js
//   - cart.js
//   - depletor.js
//   - app.js
// ==========================================================================

"use strict";

const GBX_AUTH_CONTEXT_VERSION = "V1.8.2.6.4";

window.goodsbarnxAuthContextVersion = GBX_AUTH_CONTEXT_VERSION;

window.goodsbarnxAuthContext = {
  status: "NOT_INITIALIZED",
  code: "AUTH_CONTEXT_NOT_INITIALIZED",
  authenticated: false,
  userId: null,
  role: null,
  profileResolved: false,
  distributorResolved: false,
  currentUserResolved: false,
  error: null
};

window.goodsbarnxAuthResolutionTrace = {
  version: GBX_AUTH_CONTEXT_VERSION,
  startedAt: null,
  completedAt: null,
  durationMs: null,

  session: {
    status: "NOT_EVALUATED",
    resolved: false,
    errorCode: null,
    errorMessage: null
  },

  authUser: {
    status: "NOT_EVALUATED",
    resolved: false,
    userId: null,
    errorCode: null,
    errorMessage: null
  },

  profile: {
    status: "NOT_EVALUATED",
    resolved: false,
    userId: null,
    role: null,
    errorCode: null,
    errorMessage: null
  },

  distributorProfile: {
    status: "NOT_EVALUATED",
    resolved: false,
    userId: null,
    errorCode: null,
    errorMessage: null
  },

  currentUser: {
    status: "NOT_EVALUATED",
    resolved: false,
    userId: null,
    role: null,
    synchronized: false,
    errorCode: null,
    errorMessage: null
  }
};

let goodsbarnxAuthResolutionPromise = null;


/* --------------------------------------------------------------------------
   Internal helpers
-------------------------------------------------------------------------- */

function setAuthContextState(patch) {
  window.goodsbarnxAuthContext = {
    ...window.goodsbarnxAuthContext,
    ...patch
  };
}


function setTraceStage(stage, patch) {
  window.goodsbarnxAuthResolutionTrace[stage] = {
    ...window.goodsbarnxAuthResolutionTrace[stage],
    ...patch
  };
}


function makeAuthError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}


function getErrorMessage(error) {
  if (!error) return null;

  return (
    error.message ||
    error.error_description ||
    error.details ||
    String(error)
  );
}


/* --------------------------------------------------------------------------
   Resolution trace accessor
-------------------------------------------------------------------------- */

function getGoodsbarnXAuthResolutionTrace() {
  return window.goodsbarnxAuthResolutionTrace;
}

window.getGoodsbarnXAuthResolutionTrace =
  getGoodsbarnXAuthResolutionTrace;


/* --------------------------------------------------------------------------
   Auth context accessor
-------------------------------------------------------------------------- */

function getGoodsbarnXAuthContext() {
  return window.goodsbarnxAuthContext;
}

window.getGoodsbarnXAuthContext =
  getGoodsbarnXAuthContext;


/* --------------------------------------------------------------------------
   Authoritative current-user resolution
-------------------------------------------------------------------------- */

async function loadCurrentUser() {

  const trace = window.goodsbarnxAuthResolutionTrace;

  trace.startedAt = new Date().toISOString();
  trace.completedAt = null;
  trace.durationMs = null;

  setAuthContextState({
    status: "AUTH_INITIALIZING",
    code: "AUTH_INITIALIZING",
    authenticated: false,
    userId: null,
    role: null,
    profileResolved: false,
    distributorResolved: false,
    currentUserResolved: false,
    error: null
  });

  /*
   * ------------------------------------------------------------------------
   * STEP 1 — Supabase session
   * ------------------------------------------------------------------------
   */

  try {

    const {
      data: { session },
      error
    } = await sb.auth.getSession();

    if (error) {
      setTraceStage("session", {
        status: "FAILED",
        resolved: false,
        errorCode: "AUTH_SESSION_FAILED",
        errorMessage: getErrorMessage(error)
      });

      throw makeAuthError(
        "AUTH_SESSION_FAILED",
        getErrorMessage(error) || "Unable to resolve Supabase session."
      );
    }

    if (!session || !session.user) {

      setTraceStage("session", {
        status: "RESOLVED_NO_SESSION",
        resolved: false,
        errorCode: "NO_AUTH_SESSION",
        errorMessage: "No authenticated Supabase session exists."
      });

      setAuthContextState({
        status: "NO_AUTH_SESSION",
        code: "NO_AUTH_SESSION",
        authenticated: false,
        error: "No authenticated Supabase session exists."
      });

      trace.completedAt = new Date().toISOString();
      trace.durationMs =
        new Date(trace.completedAt).getTime() -
        new Date(trace.startedAt).getTime();

      return null;
    }

    setTraceStage("session", {
      status: "RESOLVED",
      resolved: true,
      errorCode: null,
      errorMessage: null
    });

  } catch (error) {

    if (error && error.code === "AUTH_SESSION_FAILED") {
      throw error;
    }

    throw makeAuthError(
      "AUTH_SESSION_FAILED",
      getErrorMessage(error) || "Supabase session resolution failed."
    );
  }


  /*
   * ------------------------------------------------------------------------
   * STEP 2 — Authenticated Supabase user
   * ------------------------------------------------------------------------
   */

  let authUser = null;

  try {

    const {
      data: { user },
      error
    } = await sb.auth.getUser();

    if (error) {

      setTraceStage("authUser", {
        status: "FAILED",
        resolved: false,
        userId: null,
        errorCode: "AUTH_GET_USER_FAILED",
        errorMessage: getErrorMessage(error)
      });

      throw makeAuthError(
        "AUTH_GET_USER_FAILED",
        getErrorMessage(error) || "Unable to resolve authenticated user."
      );
    }

    if (!user) {

      setTraceStage("authUser", {
        status: "FAILED",
        resolved: false,
        userId: null,
        errorCode: "NO_AUTH_USER",
        errorMessage: "Supabase session exists but authenticated user is unavailable."
      });

      throw makeAuthError(
        "NO_AUTH_USER",
        "Supabase session exists but authenticated user is unavailable."
      );
    }

    authUser = user;

    setTraceStage("authUser", {
      status: "RESOLVED",
      resolved: true,
      userId: user.id,
      errorCode: null,
      errorMessage: null
    });

    setAuthContextState({
      status: "AUTH_USER_RESOLVED",
      code: "AUTH_USER_RESOLVED",
      authenticated: true,
      userId: user.id,
      error: null
    });

  } catch (error) {

    trace.completedAt = new Date().toISOString();
    trace.durationMs =
      new Date(trace.completedAt).getTime() -
      new Date(trace.startedAt).getTime();

    setAuthContextState({
      status: "AUTH_GET_USER_FAILED",
      code: error.code || "AUTH_GET_USER_FAILED",
      authenticated: false,
      error: getErrorMessage(error)
    });

    throw error;
  }


  /*
   * ------------------------------------------------------------------------
   * STEP 3 — Canonical profiles row
   * ------------------------------------------------------------------------
   */

  let profile = null;

  try {

    const {
      data,
      error
    } = await sb
      .from("profiles")
      .select("*")
      .eq("id", authUser.id)
      .single();

    if (error) {

      setTraceStage("profile", {
        status: "FAILED",
        resolved: false,
        userId: authUser.id,
        role: null,
        errorCode: "PROFILE_LOAD_FAILED",
        errorMessage: getErrorMessage(error)
      });

      throw makeAuthError(
        "PROFILE_LOAD_FAILED",
        getErrorMessage(error) || "Unable to load canonical profile."
      );
    }

    if (!data) {

      setTraceStage("profile", {
        status: "FAILED",
        resolved: false,
        userId: authUser.id,
        role: null,
        errorCode: "PROFILE_MISSING",
        errorMessage: "Authenticated user has no canonical profiles row."
      });

      throw makeAuthError(
        "PROFILE_MISSING",
        "Authenticated user has no canonical profiles row."
      );
    }

    profile = data;

    const role = String(profile.role || "").trim().toLowerCase();

    setTraceStage("profile", {
      status: "RESOLVED",
      resolved: true,
      userId: authUser.id,
      role: role || null,
      errorCode: null,
      errorMessage: null
    });

    setAuthContextState({
      status: "PROFILE_RESOLVED",
      code: "PROFILE_RESOLVED",
      authenticated: true,
      userId: authUser.id,
      role: role || null,
      profileResolved: true,
      error: null
    });

  } catch (error) {

    trace.completedAt = new Date().toISOString();
    trace.durationMs =
      new Date(trace.completedAt).getTime() -
      new Date(trace.startedAt).getTime();

    setAuthContextState({
      status: error.code || "PROFILE_LOAD_FAILED",
      code: error.code || "PROFILE_LOAD_FAILED",
      authenticated: true,
      userId: authUser.id,
      profileResolved: false,
      error: getErrorMessage(error)
    });

    throw error;
  }


  /*
   * ------------------------------------------------------------------------
   * STEP 4 — Distributor principal
   * ------------------------------------------------------------------------
   */

  if (String(profile.role || "").trim().toLowerCase() === "distributor") {

    let distributorProfile = null;

    try {

      const {
        data,
        error
      } = await sb
        .from("distributor_profiles")
        .select("*")
        .eq("id", authUser.id)
        .single();

      if (error) {

        setTraceStage("distributorProfile", {
          status: "FAILED",
          resolved: false,
          userId: authUser.id,
          errorCode: "DISTRIBUTOR_PROFILE_LOAD_FAILED",
          errorMessage: getErrorMessage(error)
        });

        throw makeAuthError(
          "DISTRIBUTOR_PROFILE_LOAD_FAILED",
          getErrorMessage(error) ||
            "Unable to load distributor profile."
        );
      }

      if (!data) {

        setTraceStage("distributorProfile", {
          status: "FAILED",
          resolved: false,
          userId: authUser.id,
          errorCode: "DISTRIBUTOR_PROFILE_MISSING",
          errorMessage:
            "Distributor role exists but distributor_profiles row is missing."
        });

        throw makeAuthError(
          "DISTRIBUTOR_PROFILE_MISSING",
          "Distributor role exists but distributor_profiles row is missing."
        );
      }

      distributorProfile = data;

      setTraceStage("distributorProfile", {
        status: "RESOLVED",
        resolved: true,
        userId: authUser.id,
        errorCode: null,
        errorMessage: null
      });

      currentUser = {
        id: authUser.id,
        ...profile,
        ...distributorProfile
      };

      const synchronized =
        !!currentUser &&
        String(currentUser.id) === String(authUser.id) &&
        String(currentUser.role || "").trim().toLowerCase() ===
          "distributor";

      if (!synchronized) {

        setTraceStage("currentUser", {
          status: "FAILED",
          resolved: false,
          userId: currentUser ? currentUser.id : null,
          role: currentUser ? currentUser.role : null,
          synchronized: false,
          errorCode: "CURRENT_USER_SYNC_FAILED",
          errorMessage:
            "currentUser does not contain the authenticated distributor identity."
        });

        throw makeAuthError(
          "CURRENT_USER_SYNC_FAILED",
          "currentUser does not contain the authenticated distributor identity."
        );
      }

      setTraceStage("currentUser", {
        status: "RESOLVED",
        resolved: true,
        userId: currentUser.id,
        role: currentUser.role,
        synchronized: true,
        errorCode: null,
        errorMessage: null
      });

      setAuthContextState({
        status: "AUTHENTICATED_DISTRIBUTOR",
        code: "AUTHENTICATED_DISTRIBUTOR",
        authenticated: true,
        userId: authUser.id,
        role: "distributor",
        profileResolved: true,
        distributorResolved: true,
        currentUserResolved: true,
        error: null
      });

    } catch (error) {

      currentUser = null;

      trace.completedAt = new Date().toISOString();
      trace.durationMs =
        new Date(trace.completedAt).getTime() -
        new Date(trace.startedAt).getTime();

      setAuthContextState({
        status: error.code || "DISTRIBUTOR_CONTEXT_FAILED",
        code: error.code || "DISTRIBUTOR_CONTEXT_FAILED",
        authenticated: true,
        userId: authUser.id,
        role: "distributor",
        profileResolved: true,
        distributorResolved: false,
        currentUserResolved: false,
        error: getErrorMessage(error)
      });

      throw error;
    }

  }


  /*
   * ------------------------------------------------------------------------
   * STEP 5 — Buyer
   * ------------------------------------------------------------------------
   */

  if (String(profile.role || "").trim().toLowerCase() === "buyer") {

    try {

      const {
        data: buyerProfile,
        error
      } = await sb
        .from("buyer_profiles")
        .select("*")
        .eq("id", authUser.id)
        .single();

      if (error) {

        setTraceStage("currentUser", {
          status: "FAILED",
          resolved: false,
          userId: authUser.id,
          role: "buyer",
          synchronized: false,
          errorCode: "BUYER_PROFILE_LOAD_FAILED",
          errorMessage: getErrorMessage(error)
        });

        throw makeAuthError(
          "BUYER_PROFILE_LOAD_FAILED",
          getErrorMessage(error) || "Unable to load buyer profile."
        );
      }

      currentUser = {
        id: authUser.id,
        ...profile,
        ...(buyerProfile || {})
      };

      setTraceStage("currentUser", {
        status: "RESOLVED",
        resolved: true,
        userId: currentUser.id,
        role: currentUser.role,
        synchronized: true,
        errorCode: null,
        errorMessage: null
      });

      setAuthContextState({
        status: "AUTHENTICATED_BUYER",
        code: "AUTHENTICATED_BUYER",
        authenticated: true,
        userId: authUser.id,
        role: "buyer",
        profileResolved: true,
        distributorResolved: false,
        currentUserResolved: true,
        error: null
      });

    } catch (error) {

      currentUser = null;

      trace.completedAt = new Date().toISOString();
      trace.durationMs =
        new Date(trace.completedAt).getTime() -
        new Date(trace.startedAt).getTime();

      throw error;
    }

  }


  /*
   * ------------------------------------------------------------------------
   * Other roles
   * ------------------------------------------------------------------------
   */

  if (
    !["distributor", "buyer"].includes(
      String(profile.role || "").trim().toLowerCase()
    )
  ) {

    currentUser = {
      id: authUser.id,
      ...profile
    };

    setTraceStage("currentUser", {
      status: "RESOLVED",
      resolved: true,
      userId: currentUser.id,
      role: currentUser.role || null,
      synchronized: true,
      errorCode: null,
      errorMessage: null
    });

    setAuthContextState({
      status: "AUTHENTICATED_OTHER_ROLE",
      code: "AUTHENTICATED_OTHER_ROLE",
      authenticated: true,
      userId: authUser.id,
      role: profile.role || null,
      profileResolved: true,
      distributorResolved: false,
      currentUserResolved: true,
      error: null
    });
  }


  trace.completedAt = new Date().toISOString();
  trace.durationMs =
    new Date(trace.completedAt).getTime() -
    new Date(trace.startedAt).getTime();

  return currentUser;
}


/* --------------------------------------------------------------------------
   Auth-resolution promise
-------------------------------------------------------------------------- */

window.goodsbarnxAuthResolutionPromise =
  (async function () {

    try {
      return await loadCurrentUser();
    } catch (error) {

      console.error(
        "[GoodsbarnX Auth Resolution]",
        error
      );

      return null;
    }

  })();


/* --------------------------------------------------------------------------
   Existing authentication UI
-------------------------------------------------------------------------- */

function selectRole(el) {

  document
    .querySelectorAll("#signup-role-picker .role-pick")
    .forEach(function (r) {
      r.classList.remove("sel");
    });

  el.classList.add("sel");

  selectedSignupRole = el.dataset.role;

  const company =
    document.getElementById("auth-company");

  if (company) {
    company.style.display =
      selectedSignupRole === "agent"
        ? "block"
        : "none";
  }
}


function showLogin() {

  document
    .getElementById("auth-shell")
    .classList.add("hidden");

  document
    .getElementById("login-shell")
    .classList.remove("hidden");
}


function showSignup() {

  document
    .getElementById("login-shell")
    .classList.add("hidden");

  document
    .getElementById("auth-shell")
    .classList.remove("hidden");
}


function continueAsGuest() {

  document
    .getElementById("auth-shell")
    .classList.add("hidden");

  document
    .getElementById("login-shell")
    .classList.add("hidden");

  document
    .getElementById("app")
    .style.display = "block";
}


function toggleLoginPassword() {

  const pw =
    document.getElementById("login-password");

  if (!pw) return;

  pw.type =
    pw.type === "password"
      ? "text"
      : "password";
}


async function handleLogout() {

  await sb.auth.signOut();

  location.reload();
}


console.log(
  "GoodsbarnX auth loaded — V1.8.2.6.4 Auth Resolution Trace"
);
