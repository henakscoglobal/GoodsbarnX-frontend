// ==========================================================================
// GoodsbarnX — distributor.js (FIXED)
// Distributor control / relationship management layer.
// ==========================================================================

(function () {

  "use strict";

  console.log('\n=== 🔍 DEBUG: distributor.js loaded (FIXED VERSION) ===');

  // =========================================================================
  // STATE
  // =========================================================================

  const DistributorState = {
    initialized: false,
    distributorId: null,
    pendingAgents: [],
    acceptedAgents: [],
    buyers: [],
    loading: false,
    processingAgentId: null,
    authChecked: false,
    retryCount: 0,
    maxRetries: 5
  };


  // =========================================================================
  // SMALL HELPERS
  // =========================================================================

  function escapeHTML(value) {
    if (value === null || value === undefined) {
      return "";
    }
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }


  function formatDate(value) {
    if (!value) {
      return "—";
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return "—";
    }
    return date.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric"
    });
  }


  function getHolder() {
    return document.getElementById("distributor-tools-holder");
  }


  function setStatus(message, type) {
    const el = document.getElementById("distributor-management-status");
    if (!el) {
      return;
    }
    el.textContent = message || "";
    el.className = "status-msg";
    if (type === "error") {
      el.style.color = "var(--danger, #b42318)";
    } else if (type === "success") {
      el.style.color = "var(--ok, #087443)";
    } else {
      el.style.color = "";
    }
  }


  function isDistributorRole(profile) {
    if (!profile) {
      return false;
    }
    return String(profile.role || "").toLowerCase() === "distributor";
  }


  // =========================================================================
  // GET CURRENT USER WITH RETRY (FIXED)
  // =========================================================================

  async function getCurrentUserWithRetry() {
    console.log('🔍 DEBUG: getCurrentUserWithRetry called');

    if (!window.sb) {
      console.error('❌ DEBUG: window.sb is not available');
      throw new Error("Supabase client is not available.");
    }

    // Try multiple methods to get the user
    let user = null;
    let sessionData = null;

    // Method 1: Try getUser()
    try {
      console.log('🔍 DEBUG: Trying sb.auth.getUser()...');
      const { data: { user: authUser }, error: userError } = await window.sb.auth.getUser();
      
      if (!userError && authUser) {
        user = authUser;
        console.log('✅ DEBUG: Got user from getUser():', { id: user.id, email: user.email });
      } else {
        console.warn('⚠️ DEBUG: getUser() failed:', userError);
      }
    } catch (error) {
      console.warn('⚠️ DEBUG: getUser() exception:', error.message);
    }

    // Method 2: Try getSession()
    if (!user) {
      try {
        console.log('🔍 DEBUG: Trying sb.auth.getSession()...');
        const { data: { session }, error: sessionError } = await window.sb.auth.getSession();
        
        if (!sessionError && session?.user) {
          user = session.user;
          sessionData = session;
          console.log('✅ DEBUG: Got user from getSession():', { id: user.id, email: user.email });
        } else {
          console.warn('⚠️ DEBUG: getSession() failed:', sessionError);
        }
      } catch (error) {
        console.warn('⚠️ DEBUG: getSession() exception:', error.message);
      }
    }

    // Method 3: Check global currentUser
    if (!user && typeof currentUser !== 'undefined' && currentUser) {
      console.log('🔍 DEBUG: Using global currentUser:', currentUser);
      user = {
        id: currentUser.id,
        email: currentUser.email,
        ...currentUser
      };
    }

    // Method 4: Check localStorage for session
    if (!user) {
      try {
        console.log('🔍 DEBUG: Checking localStorage for session...');
        const supabaseSession = localStorage.getItem('supabase.auth.token');
        
        if (supabaseSession) {
          const parsedSession = JSON.parse(supabaseSession);
          console.log('🔍 DEBUG: Found session in localStorage:', parsedSession);
          
          if (parsedSession?.currentSession?.user) {
            user = parsedSession.currentSession.user;
            console.log('✅ DEBUG: Got user from localStorage:', { id: user.id, email: user.email });
          }
        } else {
          console.warn('⚠️ DEBUG: No session in localStorage');
        }
      } catch (error) {
        console.warn('⚠️ DEBUG: localStorage check failed:', error.message);
      }
    }

    if (!user) {
      console.error('❌ DEBUG: No user found in any method');
      throw new Error("No authenticated user found. Please log in again.");
    }

    console.log('✅ DEBUG: Successfully got user:', { id: user.id, email: user.email });
    DistributorState.distributorId = user.id;
    
    return user;
  }


  // =========================================================================
  // PROFILE LOOKUP
  // =========================================================================

  async function getProfiles(ids) {
    const uniqueIds = [...new Set((ids || []).filter(Boolean))];

    if (!uniqueIds.length) {
      return {};
    }

    if (!window.sb) {
      console.error('❌ DEBUG: window.sb not available in getProfiles');
      return {};
    }

    try {
      const { data, error } = await window.sb
        .from("profiles")
        .select("id, full_name, business_name, role")
        .in("id", uniqueIds);

      if (error) {
        console.warn("Profile lookup failed:", error);
        return {};
      }

      const map = {};
      (data || []).forEach(profile => {
        map[profile.id] = profile;
      });

      return map;
    } catch (error) {
      console.error('❌ DEBUG: getProfiles exception:', error);
      return {};
    }
  }


  function profileDisplayName(profile, fallbackId) {
    if (!profile) {
      return fallbackId ? `User ${fallbackId.slice(0, 8)}` : "Unknown user";
    }
    return (
      profile.business_name ||
      profile.full_name ||
      (profile.id ? `User ${profile.id.slice(0, 8)}` : "Unknown user")
    );
  }


  // =========================================================================
  // DISTRIBUTOR PANEL
  // =========================================================================

  function renderDistributorPanel() {
    const holder = getHolder();

    if (!holder) {
      console.error('❌ DEBUG: Cannot render panel - holder not found');
      return;
    }

    holder.innerHTML = `
      <div class="distributor-control-panel" style="margin:16px 0; padding:16px; border:1px solid var(--line,#ddd); border-radius:14px; background:var(--card,#fff);">
        <div style="display:flex; justify-content:space-between; align-items:center; gap:12px; margin-bottom:14px;">
          <div>
            <div class="section-label" style="margin:0;">Distributor Control</div>
            <div style="font-size:13px; opacity:.72; margin-top:4px;">Manage your agents and buyer relationships.</div>
          </div>
          <button type="button" class="cancel-btn" onclick="refreshDistributorDashboard()" style="margin:0;">Refresh</button>
        </div>

        <div id="distributor-management-status" class="status-msg"></div>

        <div style="margin-top:12px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
            <strong>Agent Requests</strong>
            <span class="mono" id="distributor-pending-agent-count">0</span>
          </div>
          <div id="distributor-pending-agents">
            <div class="loading-text">Loading agent requests...</div>
          </div>
        </div>

        <div style="margin-top:20px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
            <strong>My Agents</strong>
            <span class="mono" id="distributor-accepted-agent-count">0</span>
          </div>
          <div id="distributor-accepted-agents">
            <div class="loading-text">Loading agents...</div>
          </div>
        </div>

        <div style="margin-top:20px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
            <strong>My Buyers</strong>
            <span class="mono" id="distributor-buyer-count">0</span>
          </div>
          <div id="distributor-buyers">
            <div class="loading-text">Loading buyers...</div>
          </div>
        </div>
      </div>
    `;
  }


  // =========================================================================
  // LOAD PENDING AGENT REQUESTS
  // =========================================================================

  async function loadPendingAgentRequests() {
    const list = document.getElementById("distributor-pending-agents");
    const count = document.getElementById("distributor-pending-agent-count");

    if (!list || !window.sb || !DistributorState.distributorId) {
      return;
    }

    list.innerHTML = '<div class="loading-text">Loading agent requests...</div>';

    try {
      const { data, error } = await window.sb
        .from("agent_distributor_attachments")
        .select("id, agent_id, distributor_id, status, created_at")
        .eq("distributor_id", DistributorState.distributorId)
        .eq("status", "pending")
        .order("created_at", { ascending: false });

      if (error) {
        throw error;
      }

      DistributorState.pendingAgents = data || [];

      if (count) {
        count.textContent = DistributorState.pendingAgents.length;
      }

      if (!DistributorState.pendingAgents.length) {
        list.innerHTML = '<div style="padding:12px; border-radius:10px; background:var(--soft,#f6f6f6); font-size:13px; opacity:.75;">No pending agent requests.</div>';
        return;
      }

      const agentIds = DistributorState.pendingAgents.map(item => item.agent_id);
      const profiles = await getProfiles(agentIds);

      list.innerHTML = DistributorState.pendingAgents.map(request => {
        const profile = profiles[request.agent_id];
        const name = profileDisplayName(profile, request.agent_id);

        return `
          <div class="distributor-agent-request" style="padding:12px; border:1px solid var(--line,#ddd); border-radius:10px; margin-bottom:8px;">
            <div style="display:flex; justify-content:space-between; gap:10px;">
              <div>
                <strong>${escapeHTML(name)}</strong>
                <div style="font-size:12px; opacity:.7; margin-top:4px;">Requested ${escapeHTML(formatDate(request.created_at))}</div>
              </div>
              <span style="font-size:11px; padding:4px 7px; border-radius:999px; background:var(--soft,#f3f4f6);">Pending</span>
            </div>
            <div style="display:flex; gap:8px; margin-top:12px;">
              <button type="button" class="submit-btn" style="flex:1;margin:0;" onclick="approveDistributorAgent('${request.id}')">Approve</button>
              <button type="button" class="cancel-btn" style="flex:1;margin:0;" onclick="declineDistributorAgent('${request.id}')">Decline</button>
            </div>
          </div>
        `;
      }).join("");

    } catch (error) {
      console.error("Load pending agents failed:", error);
      list.innerHTML = `<div style="padding:12px; border-radius:10px; background:var(--soft,#f6f6f6); color:var(--danger,#b42318); font-size:13px;">Unable to load agent requests.</div>`;
      setStatus(error.message || "Unable to load agent requests.", "error");
    }
  }


  // =========================================================================
  // LOAD ACCEPTED AGENTS
  // =========================================================================

  async function loadAcceptedAgents() {
    const list = document.getElementById("distributor-accepted-agents");
    const count = document.getElementById("distributor-accepted-agent-count");

    if (!list || !window.sb || !DistributorState.distributorId) {
      return;
    }

    list.innerHTML = '<div class="loading-text">Loading agents...</div>';

    try {
      const { data, error } = await window.sb
        .from("agent_distributor_attachments")
        .select("id, agent_id, distributor_id, status, created_at")
        .eq("distributor_id", DistributorState.distributorId)
        .eq("status", "accepted")
        .order("created_at", { ascending: false });

      if (error) {
        throw error;
      }

      DistributorState.acceptedAgents = data || [];

      if (count) {
        count.textContent = DistributorState.acceptedAgents.length;
      }

      if (!DistributorState.acceptedAgents.length) {
        list.innerHTML = '<div style="padding:12px; border-radius:10px; background:var(--soft,#f6f6f6); font-size:13px; opacity:.75;">No approved agents yet.</div>';
        return;
      }

      const agentIds = DistributorState.acceptedAgents.map(item => item.agent_id);
      const profiles = await getProfiles(agentIds);

      list.innerHTML = DistributorState.acceptedAgents.map(attachment => {
        const profile = profiles[attachment.agent_id];
        const name = profileDisplayName(profile, attachment.agent_id);

        return `
          <div style="padding:12px; border:1px solid var(--line,#ddd); border-radius:10px; margin-bottom:8px;">
            <div style="display:flex; justify-content:space-between; gap:10px;">
              <div>
                <strong>${escapeHTML(name)}</strong>
                <div style="font-size:12px; opacity:.7; margin-top:4px;">Attached ${escapeHTML(formatDate(attachment.created_at))}</div>
              </div>
              <span style="font-size:11px; padding:4px 7px; border-radius:999px; background:var(--soft,#f3f4f6);">Active</span>
            </div>
          </div>
        `;
      }).join("");

    } catch (error) {
      console.error("Load accepted agents failed:", error);
      list.innerHTML = `<div style="padding:12px; border-radius:10px; background:var(--soft,#f6f6f6); color:var(--danger,#b42318); font-size:13px;">Unable to load agents.</div>`;
    }
  }


  // =========================================================================
  // APPROVE / DECLINE AGENT
  // =========================================================================

  async function approveDistributorAgent(attachmentId) {
    if (!attachmentId || DistributorState.processingAgentId || !window.sb) {
      return;
    }

    DistributorState.processingAgentId = attachmentId;
    setStatus("Approving agent attachment...");

    try {
      const { data, error } = await window.sb
        .from("agent_distributor_attachments")
        .update({ status: "accepted" })
        .eq("id", attachmentId)
        .eq("distributor_id", DistributorState.distributorId)
        .eq("status", "pending")
        .select()
        .single();

      if (error) {
        throw error;
      }

      if (!data) {
        throw new Error("The agent request could not be approved. It may have already been processed.");
      }

      setStatus("Agent attachment approved.", "success");
      await refreshDistributorDashboard();

    } catch (error) {
      console.error("Approve agent failed:", error);
      setStatus(error.message || "Unable to approve agent attachment.", "error");
    } finally {
      DistributorState.processingAgentId = null;
    }
  }


  async function declineDistributorAgent(attachmentId) {
    if (!attachmentId || DistributorState.processingAgentId || !window.sb) {
      return;
    }

    const confirmed = window.confirm("Decline this agent attachment request?");
    if (!confirmed) {
      return;
    }

    DistributorState.processingAgentId = attachmentId;
    setStatus("Declining agent attachment...");

    try {
      const { data, error } = await window.sb
        .from("agent_distributor_attachments")
        .update({ status: "declined" })
        .eq("id", attachmentId)
        .eq("distributor_id", DistributorState.distributorId)
        .eq("status", "pending")
        .select()
        .single();

      if (error) {
        throw error;
      }

      if (!data) {
        throw new Error("The agent request could not be declined. It may have already been processed.");
      }

      setStatus("Agent attachment declined.", "success");
      await refreshDistributorDashboard();

    } catch (error) {
      console.error("Decline agent failed:", error);
      setStatus(error.message || "Unable to decline agent attachment.", "error");
    } finally {
      DistributorState.processingAgentId = null;
    }
  }


  // =========================================================================
  // LOAD DISTRIBUTOR BUYER RELATIONSHIPS
  // =========================================================================

  async function loadDistributorBuyers() {
    const list = document.getElementById("distributor-buyers");
    const count = document.getElementById("distributor-buyer-count");

    if (!list || !window.sb || !DistributorState.distributorId) {
      return;
    }

    list.innerHTML = '<div class="loading-text">Loading buyers...</div>';

    try {
      const { data, error } = await window.sb
        .from("trade_relationships")
        .select("id, buyer_id, distributor_id, status, is_primary, created_by, created_at")
        .eq("distributor_id", DistributorState.distributorId)
        .order("created_at", { ascending: false });

      if (error) {
        throw error;
      }

      DistributorState.buyers = data || [];

      if (count) {
        count.textContent = DistributorState.buyers.length;
      }

      if (!DistributorState.buyers.length) {
        list.innerHTML = '<div style="padding:12px; border-radius:10px; background:var(--soft,#f6f6f6); font-size:13px; opacity:.75;">No buyer relationships yet.</div>';
        return;
      }

      const buyerIds = DistributorState.buyers.map(relationship => relationship.buyer_id);
      const profiles = await getProfiles(buyerIds);

      list.innerHTML = DistributorState.buyers.map(relationship => {
        const profile = profiles[relationship.buyer_id];
        const name = profileDisplayName(profile, relationship.buyer_id);
        const status = relationship.status || "unknown";

        return `
          <div style="padding:12px; border:1px solid var(--line,#ddd); border-radius:10px; margin-bottom:8px;">
            <div style="display:flex; justify-content:space-between; gap:10px;">
              <div>
                <strong>${escapeHTML(name)}</strong>
                <div style="font-size:12px; opacity:.7; margin-top:4px;">Relationship created ${escapeHTML(formatDate(relationship.created_at))}</div>
              </div>
              <span style="font-size:11px; padding:4px 7px; border-radius:999px; background:var(--soft,#f3f4f6); text-transform:capitalize;">${escapeHTML(status)}</span>
            </div>
            ${relationship.is_primary ? '<div style="margin-top:8px; font-size:11px; opacity:.7;">Primary relationship</div>' : ""}
          </div>
        `;
      }).join("");

    } catch (error) {
      console.error("Load buyers failed:", error);
      list.innerHTML = `<div style="padding:12px; border-radius:10px; background:var(--soft,#f6f6f6); color:var(--danger,#b42318); font-size:13px;">Unable to load buyer relationships.</div>`;
    }
  }


  // =========================================================================
  // REFRESH
  // =========================================================================

  async function refreshDistributorDashboard() {
    if (!DistributorState.distributorId) {
      console.error('❌ DEBUG: No distributor ID in refresh');
      return;
    }

    DistributorState.loading = true;

    try {
      await Promise.all([
        loadPendingAgentRequests(),
        loadAcceptedAgents(),
        loadDistributorBuyers()
      ]);
      console.log('✅ DEBUG: Dashboard refresh complete');
    } catch (error) {
      console.error("Dashboard refresh failed:", error);
    } finally {
      DistributorState.loading = false;
    }
  }


  // =========================================================================
  // INITIALIZATION (FIXED)
  // =========================================================================

  async function initDistributor() {
    console.log('\n=== 🔍 DEBUG: initDistributor called (FIXED) ===');

    if (DistributorState.initialized) {
      console.log('⚠️ DEBUG: Already initialized');
      return;
    }

    try {
      // Get user with retry logic
      const user = await getCurrentUserWithRetry();

      if (!user) {
        console.error('❌ DEBUG: No user found');
        return;
      }

      console.log('✅ DEBUG: User found:', { id: user.id, email: user.email });

      // Check role from global currentUser first (faster)
      if (typeof currentUser !== 'undefined' && currentUser) {
        console.log('🔍 DEBUG: Global currentUser role:', currentUser.role);
        
        if (currentUser.role && currentUser.role.toLowerCase() === 'distributor') {
          console.log('✅ DEBUG: User is distributor (from global currentUser)');
          proceedWithDistributorInit(user);
          return;
        }
      }

      // Check role from profiles table
      const profiles = await getProfiles([user.id]);
      const profile = profiles[user.id];

      console.log('🔍 DEBUG: Profile from DB:', profile);

      if (!isDistributorRole(profile)) {
        console.error('❌ DEBUG: User is NOT a distributor. Role:', profile?.role);
        return;
      }

      console.log('✅ DEBUG: User is confirmed as distributor');
      proceedWithDistributorInit(user);

    } catch (error) {
      console.error('❌ DEBUG: initDistributor failed:', error);

      // Retry logic
      if (DistributorState.retryCount < DistributorState.maxRetries) {
        DistributorState.retryCount++;
        console.log(`🔄 DEBUG: Retrying initDistributor (attempt ${DistributorState.retryCount}/${DistributorState.maxRetries})...`);
        
        setTimeout(() => {
          initDistributor();
        }, 1000 * DistributorState.retryCount); // Increasing delay
      } else {
        console.error('❌ DEBUG: Max retries reached');
        
        const holder = getHolder();
        if (holder) {
          holder.innerHTML = `
            <div style="margin:16px 0; padding:14px; border-radius:12px; background:var(--soft,#f6f6f6); color:var(--danger,#b42318);">
              Unable to load distributor controls: ${escapeHTML(error.message || 'Unknown error')}
              <br><br>
              <button onclick="location.reload()" style="padding:8px 16px; background:var(--primary); color:white; border:none; border-radius:5px; cursor:pointer;">
                Reload Page
              </button>
            </div>
          `;
        }
      }
    }
  }


  function proceedWithDistributorInit(user) {
    console.log('✅ DEBUG: Proceeding with distributor initialization');
    
    DistributorState.initialized = true;
    DistributorState.distributorId = user.id;
    DistributorState.retryCount = 0;

    renderDistributorPanel();
    refreshDistributorDashboard();

    console.log('✅ DEBUG: Distributor initialization complete');
  }


  // =========================================================================
  // AUTH STATE HANDLING
  // =========================================================================

  function attachAuthListener() {
    if (!window.sb || !window.sb.auth) {
      console.error('❌ DEBUG: Cannot attach auth listener');
      return;
    }

    console.log('✅ DEBUG: Attaching auth listener');

    window.sb.auth.onAuthStateChange(function (event, session) {
      console.log('🔍 DEBUG: Auth state changed:', event);

      if (!session) {
        console.log('⚠️ DEBUG: No session, resetting state');
        DistributorState.initialized = false;
        DistributorState.distributorId = null;
        DistributorState.retryCount = 0;
        
        const holder = getHolder();
        if (holder) {
          holder.innerHTML = "";
        }
        return;
      }

      console.log('✅ DEBUG: Session found, re-initializing');
      
      setTimeout(function () {
        DistributorState.initialized = false;
        initDistributor();
      }, 0);
    });
  }


  // =========================================================================
  // PUBLIC API
  // =========================================================================

  window.initDistributor = initDistributor;
  window.refreshDistributorDashboard = refreshDistributorDashboard;
  window.approveDistributorAgent = approveDistributorAgent;
  window.declineDistributorAgent = declineDistributorAgent;


  // =========================================================================
  // BOOT (FIXED)
  // =========================================================================

  function boot() {
    console.log('\n=== 🔍 DEBUG: distributor.js boot called (FIXED) ===');
    console.log('Document readyState:', document.readyState);

    attachAuthListener();

    // Wait for Supabase to be ready
    if (window.sb) {
      console.log('✅ DEBUG: Supabase available, initializing immediately');
      setTimeout(function () {
        initDistributor();
      }, 500); // Small delay to ensure everything is loaded
    } else {
      console.log('⚠️ DEBUG: Supabase not ready, waiting for supabase-ready event');
      window.addEventListener('supabase-ready', function() {
        console.log('✅ DEBUG: Supabase ready event received');
        setTimeout(function () {
          initDistributor();
        }, 500);
      }, { once: true });
    }
  }


  if (document.readyState === "loading") {
    console.log('🔍 DEBUG: Document loading, waiting for DOMContentLoaded');
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    console.log('🔍 DEBUG: Document already loaded, calling boot directly');
    boot();
  }

  console.log('=== 🔍 DEBUG: distributor.js loaded and ready (FIXED) ===');

})();
