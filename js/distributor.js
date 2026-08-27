// ==========================================================================
// GoodsbarnX — distributor.js (FINAL FIX)
// Distributor control / relationship management layer.
// ==========================================================================

(function () {

  "use strict";

  console.log('\n=== distributor.js loaded (FINAL FIX) ===');

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
    retryCount: 0,
    maxRetries: 10
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


  // =========================================================================
  // GET CURRENT USER - WORKS WITH auth.js
  // =========================================================================

  async function getCurrentDistributor() {
    console.log('🔍 DEBUG: getCurrentDistributor called');
    
    // Method 1: Use global currentUser (set by auth.js loadCurrentUser)
    if (typeof currentUser !== 'undefined' && currentUser && currentUser.id) {
      console.log('✅ DEBUG: Using global currentUser:', { 
        id: currentUser.id, 
        role: currentUser.role,
        email: currentUser.email,
        full_name: currentUser.full_name
      });
      DistributorState.distributorId = currentUser.id;
      return currentUser;
    }

    // Method 2: Check window.currentUser
    if (typeof window.currentUser !== 'undefined' && window.currentUser && window.currentUser.id) {
      console.log('✅ DEBUG: Using window.currentUser');
      currentUser = window.currentUser;
      DistributorState.distributorId = currentUser.id;
      return currentUser;
    }

    // Method 3: Try to load current user using auth.js function
    if (typeof loadCurrentUser === 'function') {
      console.log('🔍 DEBUG: Calling loadCurrentUser()...');
      try {
        await loadCurrentUser();
        
        if (typeof currentUser !== 'undefined' && currentUser && currentUser.id) {
          console.log('✅ DEBUG: Loaded user via loadCurrentUser():', currentUser);
          DistributorState.distributorId = currentUser.id;
          return currentUser;
        }
      } catch (error) {
        console.warn('⚠️ DEBUG: loadCurrentUser() failed:', error);
      }
    }

    // Method 4: Direct Supabase auth
    if (window.sb && window.sb.auth) {
      console.log('🔍 DEBUG: Trying Supabase auth directly...');
      
      try {
        // Try getUser first
        const { data: { user }, error: userError } = await window.sb.auth.getUser();
        
        if (!userError && user) {
          console.log('✅ DEBUG: Got user from getUser():', { id: user.id, email: user.email });
          
          // Try to get profile
          try {
            const { data: profile } = await window.sb
              .from("profiles")
              .select("*")
              .eq("id", user.id)
              .single();
            
            const fullUser = { id: user.id, ...profile };
            console.log('✅ DEBUG: Full user with profile:', fullUser);
            currentUser = fullUser;
            DistributorState.distributorId = user.id;
            return fullUser;
          } catch (profileError) {
            console.warn('⚠️ DEBUG: Profile fetch failed:', profileError);
            currentUser = user;
            DistributorState.distributorId = user.id;
            return user;
          }
        }
        
        // Try getSession
        const { data: { session }, error: sessionError } = await window.sb.auth.getSession();
        
        if (!sessionError && session?.user) {
          console.log('✅ DEBUG: Got user from getSession():', { id: session.user.id });
          
          try {
            const { data: profile } = await window.sb
              .from("profiles")
              .select("*")
              .eq("id", session.user.id)
              .single();
            
            const fullUser = { id: session.user.id, ...profile };
            currentUser = fullUser;
            DistributorState.distributorId = session.user.id;
            return fullUser;
          } catch (profileError) {
            currentUser = session.user;
            DistributorState.distributorId = session.user.id;
            return session.user;
          }
        }
        
      } catch (error) {
        console.error('❌ DEBUG: Supabase auth failed:', error);
      }
    }

    console.error('❌ DEBUG: No user found');
    return null;
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
      console.error('❌ DEBUG: window.sb not available');
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


  function isDistributorRole(user) {
    if (!user) {
      return false;
    }
    
    const role = user.role || user.user_metadata?.role || '';
    return String(role).toLowerCase() === 'distributor';
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
  // INITIALIZATION - FINAL FIX
  // =========================================================================

  async function initDistributor() {
    console.log('\n=== initDistributor called ===');

    if (DistributorState.initialized) {
      console.log('Already initialized');
      return;
    }

    try {
      // Get current user
      const user = await getCurrentDistributor();

      if (!user) {
        console.log('No user found, will retry');
        
        // Retry logic
        if (DistributorState.retryCount < DistributorState.maxRetries) {
          DistributorState.retryCount++;
          console.log(`Retry attempt ${DistributorState.retryCount}/${DistributorState.maxRetries}`);
          
          setTimeout(() => {
            initDistributor();
          }, 2000); // Wait 2 seconds between retries
        } else {
          console.log('Max retries reached, showing message');
          const holder = getHolder();
          if (holder) {
            holder.innerHTML = `
              <div style="margin:16px 0; padding:20px; border-radius:12px; background:#f8d7da; color:#721c24; text-align:center;">
                <div style="font-size:16px; font-weight:600; margin-bottom:10px;">
                  Please Log In
                </div>
                <div style="font-size:14px; margin-bottom:15px;">
                  You need to be logged in as a distributor to view this section.
                </div>
                <button onclick="location.reload()" style="padding:10px 20px; background:#007bff; color:white; border:none; border-radius:5px; cursor:pointer; font-size:14px;">
                  Reload Page
                </button>
              </div>
            `;
          }
        }
        return;
      }

      // Check if user is distributor
      if (!isDistributorRole(user)) {
        console.log('User is not a distributor, hiding panel');
        const holder = getHolder();
        if (holder) {
          holder.innerHTML = '';
        }
        return;
      }

      // Initialize
      console.log('✅ User is distributor, initializing');
      DistributorState.initialized = true;
      DistributorState.distributorId = user.id;
      DistributorState.retryCount = 0;

      renderDistributorPanel();
      await refreshDistributorDashboard();

      console.log('✅ Distributor initialization complete');

    } catch (error) {
      console.error('Distributor initialization failed:', error);
      
      // Retry on error
      if (DistributorState.retryCount < DistributorState.maxRetries) {
        DistributorState.retryCount++;
        setTimeout(() => {
          initDistributor();
        }, 2000);
      }
    }
  }


  // =========================================================================
  // AUTH STATE HANDLING
  // =========================================================================

  function attachAuthListener() {
    if (!window.sb || !window.sb.auth) {
      return;
    }

    window.sb.auth.onAuthStateChange(function (event, session) {
      console.log('Auth state changed:', event);

      if (event === 'SIGNED_IN' && session) {
        console.log('User signed in, re-initializing distributor');
        DistributorState.initialized = false;
        setTimeout(() => {
          initDistributor();
        }, 1000);
      }

      if (event === 'SIGNED_OUT') {
        console.log('User signed out, clearing distributor');
        DistributorState.initialized = false;
        DistributorState.distributorId = null;
        DistributorState.retryCount = 0;
        
        const holder = getHolder();
        if (holder) {
          holder.innerHTML = '';
        }
      }
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
  // BOOT
  // =========================================================================

  function boot() {
    console.log('Booting distributor module');

    attachAuthListener();

    // Wait for app initialization
    setTimeout(() => {
      initDistributor();
    }, 1500);
  }


  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  console.log('=== distributor.js ready ===');

})();
