// ==========================================================================
// GoodsbarnX — config.js
// Supabase client + app-wide constants.
// Plain global script.
// ==========================================================================

const SUPABASE_URL = "https://zcxecnxirfdfvywnvcjp.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpjeGVjbnhpcmZkZnZ5d252Y2pwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUxMDIyMTMsImV4cCI6MjEwMDY3ODIxM30.ooKObFp6Mj_gKlVLZXnVyeDAdfdjzDJwqx2buimmBtI";

const BACKEND = "https://shelfmatch-backend-5mjl.vercel.app/api";

const SECRET = "shelfmatch-2026-secure";

// Global Supabase client with initialization check
let sb = null;

function initializeSupabase() {
  try {
    // Check if Supabase SDK is loaded
    if (typeof supabase === 'undefined') {
      throw new Error('Supabase SDK not loaded. Check if CDN script is included before config.js');
    }

    // Validate required config values
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      throw new Error('Missing Supabase configuration values');
    }

    // Create client
    sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      },
      global: {
        headers: { 'x-application-name': 'goodsbarnx' }
      }
    });

    // Expose on window
    window.sb = sb;
    
    console.log('✅ Supabase client initialized');
    return sb;
    
  } catch (error) {
    console.error('❌ Supabase initialization failed:', error.message);
    
    // Create a mock client that returns clear errors
    sb = {
      from: () => ({
        select: () => Promise.reject(new Error('Supabase not initialized: ' + error.message)),
        insert: () => Promise.reject(new Error('Supabase not initialized: ' + error.message)),
        update: () => Promise.reject(new Error('Supabase not initialized: ' + error.message)),
        delete: () => Promise.reject(new Error('Supabase not initialized: ' + error.message))
      }),
      rpc: () => Promise.reject(new Error('Supabase not initialized: ' + error.message)),
      auth: {
        getUser: () => Promise.reject(new Error('Supabase not initialized: ' + error.message)),
        signIn: () => Promise.reject(new Error('Supabase not initialized: ' + error.message)),
        signOut: () => Promise.reject(new Error('Supabase not initialized: ' + error.message))
      }
    };
    
    window.sb = sb;
    return null;
  }
}

// Initialize immediately
initializeSupabase();

// --------------------------------------------------------------------------
// Connection test with retry logic
// --------------------------------------------------------------------------

async function testSupabaseConnection(retries = 3, delayMs = 1000) {
  if (!sb) {
    console.error('❌ Cannot test connection: Supabase client not initialized');
    return false;
  }

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`🔄 Testing Supabase connection (attempt ${attempt}/${retries})...`);
      
      const startTime = Date.now();
      const { data, error } = await sb
        .from("profiles")
        .select("id")
        .limit(1);
      
      const responseTime = Date.now() - startTime;

      if (error) {
        throw error;
      }

      console.log(`✅ Supabase connected! Response time: ${responseTime}ms`);
      
      // Dispatch event for other modules
      window.dispatchEvent(new CustomEvent('supabase-ready', { 
        detail: { connected: true, responseTime } 
      }));
      
      return true;

    } catch (err) {
      console.error(`❌ Connection attempt ${attempt} failed:`, {
        message: err.message,
        code: err.code,
        details: err.details,
        hint: err.hint
      });

      // Check for specific error types
      if (err.message?.includes('invalid api key') || err.code === 'PGRST301') {
        console.error('🔑 Authentication error - check SUPABASE_ANON_KEY');
        break; // Don't retry auth errors
      }

      if (attempt < retries) {
        console.log(`⏳ Retrying in ${delayMs}ms...`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
  }

  console.error('❌ All connection attempts failed');
  
  // Dispatch failure event
  window.dispatchEvent(new CustomEvent('supabase-error', { 
    detail: { connected: false } 
  }));
  
  return false;
}

// Auto-test on load (optional - can be removed if you want manual control)
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    testSupabaseConnection();
  });
} else {
  testSupabaseConnection();
}

// Export for module usage if needed
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    sb,
    SUPABASE_URL,
    BACKEND,
    SECRET,
    testSupabaseConnection,
    initializeSupabase
  };
}
