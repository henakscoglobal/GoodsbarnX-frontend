// ==========================================================================
// GoodsbarnX — app.js
// Global state declarations, app initialization, and inquiry history.
// Plain global script — MUST be the LAST js/ file loaded in index.html,
// since its init block calls functions (loadCurrentUser, loadDistributorsAndBuyers,
// updateCartBadge) that live in every other js/ file.
// ==========================================================================

// ==========================================================================
// DEBUGGING - TEMPORARY
// ==========================================================================

console.log('\n=== 🔍 DEBUG: app.js loaded ===');
console.log('Time:', new Date().toISOString());
console.log('Document readyState:', document.readyState);
console.log('window.sb exists:', typeof window.sb !== 'undefined' && window.sb !== null);
console.log('window.sb.auth exists:', !!(window.sb && window.sb.auth));
console.log('testSupabaseConnection exists:', typeof testSupabaseConnection !== 'undefined');
console.log('loadCurrentUser exists:', typeof loadCurrentUser !== 'undefined');
console.log('loadDistributorsAndBuyers exists:', typeof loadDistributorsAndBuyers !== 'undefined');
console.log('updateCartBadge exists:', typeof updateCartBadge !== 'undefined');
console.log('initDistributor exists:', typeof window.initDistributor !== 'undefined');
console.log('initRelationshipLayer exists:', typeof window.initRelationshipLayer !== 'undefined');

// Check for critical DOM elements
const criticalElements = [
  'auth-shell',
  'app',
  'distributor-tools-holder',
  'my-relationships-list'
];

console.log('Critical DOM elements:');
criticalElements.forEach(id => {
  const el = document.getElementById(id);
  console.log(`  #${id}:`, el ? '✅ Found' : '❌ NOT FOUND');
});

// Check all available IDs
console.log('All element IDs on page:', 
  Array.from(document.querySelectorAll('[id]')).map(el => el.id)
);


// ---------- Global state ----------
// Shared across every other js/ file via the browser's shared global scope.

let selectedSignupRole = "buyer";
let currentUser = null;
let productImageFile = null;
let allDistributors = [];
let allBuyers = [];
let activeCategory = "All";
let selectedContactName = "";
let selectedContactType = "";
let selectedContactId = "";
let selectedTier = "";
let userFavourites = new Set();
let disputeTargetId = "";
let disputeTargetName = "";
let cart = JSON.parse(localStorage.getItem("goodsbarnx_cart") || "[]");

console.log('✅ DEBUG: Global state variables initialized');
console.log('currentUser:', currentUser);
console.log('cart items:', cart.length);


// ---------- Initialize ----------

(async () => {
  console.log('\n=== 🔍 DEBUG: App initialization started ===');
  console.log('Time:', new Date().toISOString());
  
  try {
    // Step 1: Test Supabase connection
    console.log('\n📡 Step 1: Testing Supabase connection...');
    console.log('testSupabaseConnection type:', typeof testSupabaseConnection);
    
    if (typeof testSupabaseConnection === 'function') {
      const connectionResult = await testSupabaseConnection();
      console.log('Connection test result:', connectionResult);
      
      if (!connectionResult) {
        console.error('❌ DEBUG: Supabase connection failed');
      }
    } else {
      console.error('❌ DEBUG: testSupabaseConnection is not a function');
    }
    
    // Step 2: Get session
    console.log('\n🔐 Step 2: Getting session...');
    console.log('sb exists:', !!window.sb);
    console.log('sb.auth exists:', !!(window.sb && window.sb.auth));
    
    if (!window.sb || !window.sb.auth) {
      console.error('❌ DEBUG: Supabase client or auth not available');
      return;
    }
    
    const { data: { session }, error: sessionError } = await sb.auth.getSession();
    
    console.log('Session result:', { 
      hasSession: !!session, 
      sessionError: sessionError,
      user: session?.user ? { id: session.user.id, email: session.user.email } : null
    });
    
    if (sessionError) {
      console.error('❌ DEBUG: Session error:', sessionError);
      return;
    }
    
    if (session) {
      console.log('✅ DEBUG: Session found, loading current user...');
      
      // Step 3: Load current user
      console.log('\n👤 Step 3: Loading current user...');
      console.log('loadCurrentUser type:', typeof loadCurrentUser);
      
      if (typeof loadCurrentUser === 'function') {
        await loadCurrentUser();
        console.log('✅ DEBUG: Current user loaded:', currentUser);
      } else {
        console.error('❌ DEBUG: loadCurrentUser is not a function');
      }
      
      // Show app, hide auth
      const authShell = document.getElementById("auth-shell");
      const appElement = document.getElementById("app");
      
      console.log('auth-shell element:', authShell ? '✅ Found' : '❌ NOT FOUND');
      console.log('app element:', appElement ? '✅ Found' : '❌ NOT FOUND');
      
      if (authShell) {
        authShell.classList.add("hidden");
        console.log('✅ DEBUG: Auth shell hidden');
      }
      
      if (appElement) {
        appElement.style.display = "block";
        console.log('✅ DEBUG: App displayed');
      }
      
      // Step 4: Initialize role-specific layers
      console.log('\n🎭 Step 4: Initializing role-specific layers...');
      console.log('User role:', currentUser?.role);
      
      if (currentUser?.role === 'distributor') {
        console.log('✅ DEBUG: User is distributor, initializing distributor layer...');
        
        if (typeof window.initDistributor === 'function') {
          console.log('Calling initDistributor...');
          await window.initDistributor();
          console.log('✅ DEBUG: initDistributor completed');
        } else {
          console.error('❌ DEBUG: initDistributor is not a function');
        }
        
        if (typeof window.initRelationshipLayer === 'function') {
          console.log('Calling initRelationshipLayer...');
          await window.initRelationshipLayer();
          console.log('✅ DEBUG: initRelationshipLayer completed');
        } else {
          console.error('❌ DEBUG: initRelationshipLayer is not a function');
        }
      }
    } else {
      console.log('⚠️ DEBUG: No active session, skipping user load');
    }
    
    // Step 5: Load distributors and buyers
    console.log('\n📊 Step 5: Loading distributors and buyers...');
    console.log('loadDistributorsAndBuyers type:', typeof loadDistributorsAndBuyers);
    
    if (typeof loadDistributorsAndBuyers === 'function') {
      await loadDistributorsAndBuyers();
      console.log('✅ DEBUG: Distributors and buyers loaded');
      console.log('Distributors count:', allDistributors?.length || 0);
      console.log('Buyers count:', allBuyers?.length || 0);
    } else {
      console.error('❌ DEBUG: loadDistributorsAndBuyers is not a function');
    }
    
    // Step 6: Update cart badge
    console.log('\n🛒 Step 6: Updating cart badge...');
    console.log('updateCartBadge type:', typeof updateCartBadge);
    
    if (typeof updateCartBadge === 'function') {
      updateCartBadge();
      console.log('✅ DEBUG: Cart badge updated');
    } else {
      console.error('❌ DEBUG: updateCartBadge is not a function');
    }
    
    console.log('\n✅ DEBUG: GoodsbarnX initialized successfully');
    console.log('=== 🔍 DEBUG: App initialization complete ===\n');
    
  } catch (error) {
    console.error('\n❌ DEBUG: App initialization failed:', error);
    console.error('Error stack:', error.stack);
  }
})();

// ---------- Inquiry history ----------

function renderHistory() {
  const history = JSON.parse(localStorage.getItem("goodsbarnx_history") || "[]");
  const container = document.getElementById("history-list");

  if (!history.length) {
    container.innerHTML = '<div class="loading-text">No inquiries yet.</div>';
    return;
  }

  container.innerHTML = history.map(h => `
    <div class="manifest">
      <div class="manifest-top">
        <div>
          <div class="m-name">${h.name}</div>
          <div class="m-loc">${h.type} · ${new Date(h.date).toLocaleDateString()}</div>
        </div>
        <span class="stamp-badge" style="border-color:var(--ok); color:var(--ok);">SENT</span>
      </div>
    </div>
  `).join("");
}

console.log('✅ DEBUG: GoodsbarnX app loaded successfully');
console.log('=== 🔍 DEBUG: app.js execution complete ===\n');
