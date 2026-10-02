// ==========================================================================
// GoodsbarnX — config.js
// Supabase client + app-wide constants.
// Plain global script. Must load FIRST (Canon §10).
//
// V1.8.2.6 remediation Phase 1+2 — D12:
//   The plaintext SECRET constant has been removed. It was previously
//   embedded in the client bundle and transmitted from js/inquiries.js
//   to authenticate the /api/inquiries notification endpoint.
//
//   Replacement: notification requests are authenticated with the buyer's
//   Supabase JWT (Authorization: Bearer <access_token>). The backend
//   verifies the JWT. This removes the shared-secret exposure per
//   Canon §3 (identity outside commercial intelligence) and §29
//   (evidence integrity — no unauthenticated side channel).
//
//   Backend deliverable S5 (see Phase 1+2 plan): /api/inquiries must
//   verify Supabase JWTs before accepting notification requests.
// ==========================================================================

const SUPABASE_URL = "https://zcxecnxirfdfvywnvcjp.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpjeGVjbnhpcmZkZnZ5d252Y2pwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUxMDIyMTMsImV4cCI6MjEwMDY3ODIxM30.ooKObFp6Mj_gKlVLZXnVyeDAdfdjzDJwqx2buimmBtI";

const BACKEND = "https://shelfmatch-backend-5mjl.vercel.app/api";

// --------------------------------------------------------------------------
// Global Supabase client with initialization check.
// --------------------------------------------------------------------------

let sb = null;

// A chainable mock is used when the Supabase SDK is unavailable so that
// any consumer calling `sb.from("x").select("y").eq("z", 1).maybeSingle()`
// receives a rejected promise at the terminal method, not a TypeError at
// the second call. This keeps the failure mode observable and specific
// (Canon §29: do not silently degrade a query into a different error).
function createMockSupabase(reason) {
  const message = "Supabase not initialized: " + reason;
  const reject = () => Promise.reject(new Error(message));
  const chainable = new Proxy({}, {
    get(_target, prop) {
      if (prop === "then" || prop === "catch" || prop === "finally") {
        return reject();
      }
      if (prop === "maybeSingle" || prop === "single") {
        return reject;
      }
      // Every chain method returns the same proxy so that
      // .select().eq().order().limit() terminates in a rejected promise.
      return () => chainable;
    }
  });
  return {
    from: () => chainable,
    rpc: reject,
    auth: {
      getUser: reject,
      getSession: reject,
      signIn: reject,
      signInWithPassword: reject,
      signOut: reject,
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } })
    }
  };
}

function initializeSupabase() {
  try {
    if (typeof supabase === "undefined") {
      throw new Error(
        "Supabase SDK not loaded. Check that the Supabase CDN script is " +
        "included before config.js in index.html."
      );
    }
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      throw new Error("Missing Supabase configuration values.");
    }

    sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      },
      global: {
        headers: { "x-application-name": "goodsbarnx" }
      }
    });

    window.sb = sb;
    console.log("[GoodsbarnX] Supabase client initialized.");
    return sb;
  } catch (error) {
    console.error("[GoodsbarnX] Supabase initialization failed:", error.message);
    sb = createMockSupabase(error.message);
    window.sb = sb;
    return null;
  }
}

// Initialize immediately (Canon §3 — identity bootstrap is not deferred).
initializeSupabase();

// --------------------------------------------------------------------------
// Connection test with retry logic.
//
// This remains a diagnostic surface only. It does not gate any feature;
// callers must not treat its result as an authorization signal.
// --------------------------------------------------------------------------

async function testSupabaseConnection(retries = 3, delayMs = 1000) {
  if (!sb) {
    console.error("[GoodsbarnX] Cannot test connection: Supabase client not initialized.");
    return false;
  }

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(
        "[GoodsbarnX] Testing Supabase connection (attempt " +
        attempt + "/" + retries + ")..."
      );

      const startTime = Date.now();
      const { error } = await sb.from("profiles").select("id").limit(1);
      const responseTime = Date.now() - startTime;

      if (error) throw error;

      console.log(
        "[GoodsbarnX] Supabase connected. Response time: " +
        responseTime + "ms"
      );

      window.dispatchEvent(new CustomEvent("supabase-ready", {
        detail: { connected: true, responseTime }
      }));

      return true;
    } catch (err) {
      console.error(
        "[GoodsbarnX] Connection attempt " + attempt + " failed:",
        {
          message: err && err.message,
          code: err && err.code,
          details: err && err.details,
          hint: err && err.hint
        }
      );

      // Do not retry authentication errors — they will not resolve by waiting.
      if (
        (err && err.message && err.message.includes("invalid api key")) ||
        (err && err.code === "PGRST301")
      ) {
        console.error("[GoodsbarnX] Authentication error. Check SUPABASE_ANON_KEY.");
        break;
      }

      if (attempt < retries) {
        console.log("[GoodsbarnX] Retrying in " + delayMs + "ms...");
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
  }

  console.error("[GoodsbarnX] All connection attempts failed.");

  window.dispatchEvent(new CustomEvent("supabase-error", {
    detail: { connected: false }
  }));

  return false;
}

// Auto-test on load. Kept as a diagnostic; not a gate.
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    testSupabaseConnection();
  });
} else {
  testSupabaseConnection();
}

// Export for module usage if needed.
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    sb,
    SUPABASE_URL,
    BACKEND,
    testSupabaseConnection,
    initializeSupabase
  };
}
