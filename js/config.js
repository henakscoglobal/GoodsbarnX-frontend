// ==========================================================================
// GoodsbarnX — config.js
// Supabase client + app-wide constants.
// Plain global script.
// ==========================================================================

const SUPABASE_URL = "https://zcxecnxirfdfvywnvcjp.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpjeGVjbnhpcmZkZnZ5d252Y2pwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUxMDIyMTMsImV4cCI6MjEwMDY3ODIxM30.ooKObFp6Mj_gKlVLZXnVyeDAdfdjzDJwqx2buimmBtI";

const BACKEND = "https://shelfmatch-backend-5mjl.vercel.app/api";

const SECRET = "shelfmatch-2026-secure";

// Global Supabase client.
const sb = supabase.createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY
);

// Expose the same client on window because some modules,
// including distributor.js, explicitly check window.sb.
window.sb = sb;


// --------------------------------------------------------------------------
// Connection test
// --------------------------------------------------------------------------

async function testSupabaseConnection() {

  try {

    const { error } = await sb
      .from("profiles")
      .select("id")
      .limit(1);

    if (error) {
      throw error;
    }

    console.log("Supabase connected ✅");

    return true;

  } catch (err) {

    console.error(
      "Supabase connection failed:",
      err.message
    );

    return false;

  }

}
