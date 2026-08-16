// ==========================================================================
// GoodsbarnX — config.js
// Supabase client + app-wide constants.
// Plain global script (no import/export) so every other js/ file, and every
// onclick="" handler in index.html, can use these directly.
// Load this AFTER the Supabase CDN script, and BEFORE every other js/ file.
// ==========================================================================

const SUPABASE_URL = "https://zcxecnxirfdfvywnvcjp.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpjeGVjbnhpcmZkZnZ5d252Y2pwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUxMDIyMTMsImV4cCI6MjEwMDY3ODIxM30.ooKObFp6Mj_gKlVLZXnVyeDAdfdjzDJwqx2buimmBtI";
const BACKEND = "https://shelfmatch-backend-5mjl.vercel.app/api";

// NOTE: this "SECRET" constant is visible to anyone who views page source —
// it provides no real security. We'll revisit this on the backend/api day
// rather than leave a false sense of protection in place.
const SECRET = "shelfmatch-2026-secure";

// Global Supabase client — every other js/ file uses this variable directly.
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Quick visible connection check — used only for today's test, safe to keep.
async function testSupabaseConnection() {
  try {
    const { error } = await sb.from("profiles").select("id").limit(1);
    if (error) throw error;
    console.log("Supabase connected ✅");
    return true;
  } catch (err) {
    console.error("Supabase connection failed:", err.message);
    return false;
  }
}
