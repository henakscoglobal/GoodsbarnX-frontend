// ==========================================================================
// GoodsbarnX — distributor.js
// Distributor control / relationship management layer.
//
// Responsibilities:
//   - Distributor dashboard tools
//   - Agent attachment approval / decline
//   - Accepted-agent visibility
//   - Distributor buyer relationship visibility
//   - Distributor-side relationship controls
//
// Depends on:
//   - js/config.js       → global `sb`
//   - js/auth.js         → authentication/current-user state
//   - js/ui.js           → UI helpers
//   - js/relationship.js → relationship commerce layer
//
// Required database tables:
//   - public.agent_distributor_attachments
//   - public.trade_relationships
//   - public.relationship_agents
//
// Important:
//   - Agent attachment decisions are performed through the existing
//     distributor RLS policy and database trigger.
//   - The frontend does NOT attempt to bypass database authorization.
//   - Pending → accepted/declined is enforced server-side.
// ==========================================================================

(function () {

  "use strict";

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


  function isDistributorRole(user) {
    if (!user) {
      return false;
    }
    const role = user.role || user.user_metadata?.role || '';
    return String(role).toLowerCase() === 'distributor';
  }


  // =========================================================================
  // GET CURRENT DISTRIBUTOR
  // =========================================================================

  async function getCurrentDistributor() {
    // Method 1: Use global currentUser (set by auth.js loadCurrentUser)
    if (typeof currentUser !== 'undefined' && currentUser && currentUser.id) {
      DistributorState.distributorId = currentUser.id;
      return currentUser;
    }

    // Method 2: Check window.currentUser
    if (typeof window.currentUser !== 'undefined' && window.currentUser && window.currentUser.id) {
      currentUser = window.currentUser;
      DistributorState.distributorId = currentUser.id;
      return currentUser;
    }

    // Method 3: Try to load current user using auth.js function
    if (typeof loadCurrentUser === 'function') {
      try {
        await loadCurrentUser();
        if (typeof currentUser !== 'undefined' && currentUser && currentUser.id) {
          DistributorState.distributorId = currentUser.id;
          return currentUser;
        }
      } catch (error) {
        console.warn("loadCurrentUser() failed:", error);
      }
    }

    // Method 4: Direct Supabase auth
    if (window.sb && window.sb.auth) {
      try {
        const { data: { user }, error: userError } = await window.sb.auth.getUser();
        
        if (!userError && user) {
          try {
            const { data: profile } = await window.sb
              .from("profiles")
              .select("*")
              .eq("id", user.id)
              .single();
            
            const fullUser = { id: user.id, ...profile };
            currentUser = fullUser;
            DistributorState.distributorId = user.id;
            return fullUser;
          } catch (profileError) {
            currentUser = user;
            DistributorState.distributorId = user.id;
            return user;
          }
        }
        
        const { data: { session }, error: sessionError } = await window.sb.auth.getSession();
        
        if (!sessionError && session?.user) {
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
        console.error("Supabase auth failed:", error);
      }
    }

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
      console.error("getProfiles exception:", error);
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
  // UPDATED: DISTRIBUTOR PANEL - REDESIGNED
  // =========================================================================

  function renderDistributorPanel() {
    const holder = getHolder();

    if (!holder) {
      return;
    }

    // Check if user is distributor
    if (!currentUser || currentUser.role !== 'distributor') {
      holder.innerHTML = `
        <div class="lock-banner">
          <div class="lb-title">🔒 Distributor Tools</div>
          <div class="lb-sub">Upgrade to a distributor account to access these tools.</div>
          <button onclick="showScreen('upgrade')">Upgrade Now</button>
        </div>
      `;
      return;
    }

    // Show redesigned distributor tools
    holder.innerHTML = `
      <div class="distributor-tools" style="margin-bottom: 16px;">
        <div class="dt-title">📊 Distributor Dashboard</div>
        <div class="dt-sub">
          Manage your products, track inquiries, and grow your network.
        </div>
        <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:8px;">
          <button onclick="showScreen('products')">📦 Manage Products</button>
          <button onclick="openInviteBuyerModal()">👤 Invite Buyer</button>
          <button onclick="showScreen('staff')">👥 Manage Staff</button>
          <button onclick="showScreen('profile')">⚙️ Settings</button>
        </div>
      </div>

      <div class="distributor-control-panel" style="margin:0 0 16px 0; padding:16px; border:1px solid var(--line); border-radius:14px; background:var(--ink-2);">
        <div style="display:flex; justify-content:space-between; align-items:center; gap:12px; margin-bottom:14px;">
          <div>
            <div style="font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.05em; color:rgba(239,233,222,0.3); margin:0;">Agent Management</div>
            <div style="font-size:13px; color:rgba(239,233,222,0.5); margin-top:4px;">Approve or decline agent attachment requests.</div>
          </div>
          <button type="button" class="btn btn-outline" onclick="refreshDistributorDashboard()" style="margin:0; padding:6px 12px; font-size:11px;">↻ Refresh</button>
        </div>

        <div id="distributor-management-status" class="status-msg" style="margin-bottom:8px;"></div>

        <!-- Pending Agents -->
        <div style="margin-top:12px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
            <span style="font-size:13px; font-weight:600; color:var(--paper);">Agent Requests</span>
            <span class="mono" id="distributor-pending-agent-count" style="font-size:14px; font-weight:700; color:var(--brass-bright);">0</span>
          </div>
          <div id="distributor-pending-agents">
            <div class="loading-text">Loading agent requests...</div>
          </div>
        </div>

        <!-- Accepted Agents -->
        <div style="margin-top:20px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
            <span style="font-size:13px; font-weight:600; color:var(--paper);">My Agents</span>
            <span class="mono" id="distributor-accepted-agent-count" style="font-size:14px; font-weight:700; color:var(--ok);">0</span>
          </div>
          <div id="distributor-accepted-agents">
            <div class="loading-text">Loading agents...</div>
          </div>
        </div>

        <!-- Buyers -->
        <div style="margin-top:20px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
            <span style="font-size:13px; font-weight:600; color:var(--paper);">My Buyers</span>
            <span class="mono" id="distributor-buyer-count" style="font-size:14px; font-weight:700; color:var(--ok);">0</span>
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
        
        // Also update the attention badge
        const badge = document.getElementById('agent-requests-count');
        if (badge) {
          badge.textContent = DistributorState.pendingAgents.length;
        }
      }

      if (!DistributorState.pendingAgents.length) {
        list.innerHTML = '<div style="padding:12px; border-radius:10px; background:rgba(239,233,222,0.03); font-size:13px; color:rgba(239,233,222,0.3);">No pending agent requests.</div>';
        return;
      }

      const agentIds = DistributorState.pendingAgents.map(item => item.agent_id);
      const profiles = await getProfiles(agentIds);

      list.innerHTML = DistributorState.pendingAgents.map(request => {
        const profile = profiles[request.agent_id];
        const name = profileDisplayName(profile, request.agent_id);

        return `
          <div style="padding:12px; border:1px solid var(--line); border-radius:10px; margin-bottom:8px; background:var(--ink-2);">
            <div style="display:flex; justify-content:space-between; gap:10px;">
              <div>
                <strong style="color:var(--paper);">${escapeHTML(name)}</strong>
                <div style="font-size:12px; color:rgba(239,233,222,0.4); margin-top:4px;">Requested ${escapeHTML(formatDate(request.created_at))}</div>
              </div>
              <span style="font-size:11px; padding:4px 10px; border-radius:999px; background:rgba(200,138,52,0.12); color:var(--brass-bright);">Pending</span>
            </div>
            <div style="display:flex; gap:8px; margin-top:12px;">
              <button type="button" class="btn btn-success" style="flex:1;margin:0; padding:8px 12px; font-size:12px; background:var(--ok); color:#fff; border:none; border-radius:8px; cursor:pointer;" onclick="approveDistributorAgent('${request.id}')">✓ Approve</button>
              <button type="button" class="btn btn-danger" style="flex:1;margin:0; padding:8px 12px; font-size:12px; background:var(--stamp); color:#fff; border:none; border-radius:8px; cursor:pointer;" onclick="declineDistributorAgent('${request.id}')">✕ Decline</button>
            </div>
          </div>
        `;
      }).join("");

    } catch (error) {
      console.error("Load pending agents failed:", error);
      list.innerHTML = '<div style="padding:12px; border-radius:10px; background:rgba(239,233,222,0.03); color:var(--stamp-bright); font-size:13px;">Unable to load agent requests.</div>';
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
        
        // Update my agents count in network links
        const myAgentsCount = document.getElementById('my-agents-count');
        if (myAgentsCount) {
          myAgentsCount.textContent = DistributorState.acceptedAgents.length;
        }
        const myAgentsSub = document.getElementById('my-agents-sub');
        if (myAgentsSub) {
          myAgentsSub.textContent = `${DistributorState.acceptedAgents.length} active • 0 pending`;
        }
      }

      if (!DistributorState.acceptedAgents.length) {
        list.innerHTML = '<div style="padding:12px; border-radius:10px; background:rgba(239,233,222,0.03); font-size:13px; color:rgba(239,233,222,0.3);">No approved agents yet.</div>';
        return;
      }

      const agentIds = DistributorState.acceptedAgents.map(item => item.agent_id);
      const profiles = await getProfiles(agentIds);

      list.innerHTML = DistributorState.acceptedAgents.map(attachment => {
        const profile = profiles[attachment.agent_id];
        const name = profileDisplayName(profile, attachment.agent_id);

        return `
          <div style="padding:12px; border:1px solid var(--line); border-radius:10px; margin-bottom:8px; background:var(--ink-2);">
            <div style="display:flex; justify-content:space-between; gap:10px;">
              <div>
                <strong style="color:var(--paper);">${escapeHTML(name)}</strong>
                <div style="font-size:12px; color:rgba(239,233,222,0.4); margin-top:4px;">Attached ${escapeHTML(formatDate(attachment.created_at))}</div>
              </div>
              <span style="font-size:11px; padding:4px 10px; border-radius:999px; background:rgba(63,122,78,0.12); color:var(--ok);">Active</span>
            </div>
          </div>
        `;
      }).join("");

    } catch (error) {
      console.error("Load accepted agents failed:", error);
      list.innerHTML = '<div style="padding:12px; border-radius:10px; background:rgba(239,233,222,0.03); color:var(--stamp-bright); font-size:13px;">Unable to load agents.</div>';
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
        
        // Update my buyers count in network links
        const myBuyersCount = document.getElementById('my-buyers-count');
        if (myBuyersCount) {
          myBuyersCount.textContent = DistributorState.buyers.length;
        }
        const myBuyersSub = document.getElementById('my-buyers-sub');
        if (myBuyersSub) {
          const activeBuyers = DistributorState.buyers.filter(r => r.status === 'active').length;
          const pendingBuyers = DistributorState.buyers.filter(r => r.status === 'pending').length;
          myBuyersSub.textContent = `${activeBuyers} active • ${pendingBuyers} pending`;
        }
      }

      if (!DistributorState.buyers.length) {
        list.innerHTML = '<div style="padding:12px; border-radius:10px; background:rgba(239,233,222,0.03); font-size:13px; color:rgba(239,233,222,0.3);">No buyer relationships yet.</div>';
        return;
      }

      const buyerIds = DistributorState.buyers.map(relationship => relationship.buyer_id);
      const profiles = await getProfiles(buyerIds);

      list.innerHTML = DistributorState.buyers.map(relationship => {
        const profile = profiles[relationship.buyer_id];
        const name = profileDisplayName(profile, relationship.buyer_id);
        const status = relationship.status || "unknown";

        return `
          <div style="padding:12px; border:1px solid var(--line); border-radius:10px; margin-bottom:8px; background:var(--ink-2);">
            <div style="display:flex; justify-content:space-between; gap:10px;">
              <div>
                <strong style="color:var(--paper);">${escapeHTML(name)}</strong>
                <div style="font-size:12px; color:rgba(239,233,222,0.4); margin-top:4px;">Relationship created ${escapeHTML(formatDate(relationship.created_at))}</div>
              </div>
              <span style="font-size:11px; padding:4px 10px; border-radius:999px; background:${status === 'active' ? 'rgba(63,122,78,0.12)' : 'rgba(200,138,52,0.12)'}; color:${status === 'active' ? 'var(--ok)' : 'var(--brass-bright)'}; text-transform:capitalize;">${escapeHTML(status)}</span>
            </div>
            ${relationship.is_primary ? '<div style="margin-top:8px; font-size:11px; color:var(--brass-bright);">◆ Primary relationship</div>' : ""}
          </div>
        `;
      }).join("");

    } catch (error) {
      console.error("Load buyers failed:", error);
      list.innerHTML = '<div style="padding:12px; border-radius:10px; background:rgba(239,233,222,0.03); color:var(--stamp-bright); font-size:13px;">Unable to load buyer relationships.</div>';
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
    setStatus("Approving agent attachment...", "success");

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

      setStatus("✅ Agent attachment approved.", "success");
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
      return;
    }

    DistributorState.loading = true;

    try {
      await Promise.all([
        loadPendingAgentRequests(),
        loadAcceptedAgents(),
        loadDistributorBuyers()
      ]);
    } catch (error) {
      console.error("Dashboard refresh failed:", error);
    } finally {
      DistributorState.loading = false;
    }
  }


  // =========================================================================
  // INVITE BUYER FUNCTIONS (NEW)
  // =========================================================================

  function openInviteBuyerModal() {
    const modal = document.getElementById('invite-buyer-modal');
    if (modal) {
      modal.classList.add('active');
      const searchInput = document.getElementById('invite-buyer-search');
      if (searchInput) {
        searchInput.value = '';
      }
      const resultsContainer = document.getElementById('invite-buyer-results');
      if (resultsContainer) {
        resultsContainer.innerHTML = '<div style="color:rgba(239,233,222,0.3);font-size:12px;padding:8px;">Type to search for buyers</div>';
      }
      const statusEl = document.getElementById('invite-buyer-status');
      if (statusEl) {
        statusEl.textContent = '';
      }
    }
  }

  function closeInviteBuyerModal() {
    const modal = document.getElementById('invite-buyer-modal');
    if (modal) {
      modal.classList.remove('active');
      const statusEl = document.getElementById('invite-buyer-status');
      if (statusEl) {
        statusEl.textContent = '';
      }
    }
  }

  async function searchBuyersForInvite() {
    const searchInput = document.getElementById('invite-buyer-search');
    const resultsContainer = document.getElementById('invite-buyer-results');
    
    if (!searchInput || !resultsContainer) return;
    
    const query = searchInput.value.trim();
    
    if (query.length < 2) {
      resultsContainer.innerHTML = '<div style="color:rgba(239,233,222,0.3);font-size:12px;padding:8px;">Type at least 2 characters to search</div>';
      return;
    }
    
    try {
      const { data: buyers, error } = await window.sb
        .from('profiles')
        .select('id, full_name, business_name, location, category')
        .eq('role', 'buyer')
        .or(`full_name.ilike.%${query}%, business_name.ilike.%${query}%`)
        .limit(10);
      
      if (error) throw error;
      
      if (!buyers || buyers.length === 0) {
        resultsContainer.innerHTML = '<div style="color:rgba(239,233,222,0.3);font-size:12px;padding:8px;">No buyers found</div>';
        return;
      }
      
      resultsContainer.innerHTML = buyers.map(buyer => `
        <div style="
          padding:12px;
          border:1px solid var(--line);
          border-radius:8px;
          margin-bottom:8px;
          cursor:pointer;
          transition: all 0.15s;
          display:flex;
          justify-content:space-between;
          align-items:center;
          background:var(--ink-2);
        " onclick="sendBuyerInvite('${buyer.id}')" 
        onmouseover="this.style.borderColor='var(--brass)'" 
        onmouseout="this.style.borderColor='var(--line)'">
          <div>
            <div style="font-weight:600;color:var(--paper);">
              ${buyer.business_name || buyer.full_name || 'Buyer'}
            </div>
            <div style="font-size:11px;color:rgba(239,233,222,0.5);">
              ${buyer.location || 'No location'} • ${buyer.category || 'General'}
            </div>
          </div>
          <div style="font-size:12px;color:var(--brass-bright);font-weight:600;">+ Invite</div>
        </div>
      `).join('');
      
    } catch (err) {
      console.error('Error searching buyers:', err);
      resultsContainer.innerHTML = '<div style="color:var(--stamp-bright);font-size:12px;">Error searching. Please try again.</div>';
    }
  }

  async function sendBuyerInvite(buyerId) {
    if (!currentUser) {
      alert('Please log in first');
      return;
    }
    
    try {
      // Check if relationship already exists
      const { data: existing, error: checkError } = await window.sb
        .from('trade_relationships')
        .select('id, status')
        .eq('distributor_id', currentUser.id)
        .eq('buyer_id', buyerId)
        .maybeSingle();
      
      if (existing) {
        const statusEl = document.getElementById('invite-buyer-status');
        if (statusEl) {
          if (existing.status === 'pending') {
            statusEl.textContent = '⏳ Invite already pending';
            statusEl.style.color = 'var(--brass-bright)';
          } else if (existing.status === 'active') {
            statusEl.textContent = '✅ Already connected with this buyer';
            statusEl.style.color = 'var(--ok)';
          }
        }
        return;
      }
      
      // Create relationship
      const { data, error } = await window.sb
        .from('trade_relationships')
        .insert({
          distributor_id: currentUser.id,
          buyer_id: buyerId,
          status: 'pending',
          created_by: currentUser.id
        })
        .select()
        .single();
      
      if (error) throw error;
      
      const statusEl = document.getElementById('invite-buyer-status');
      if (statusEl) {
        statusEl.textContent = '✅ Invite sent successfully!';
        statusEl.style.color = 'var(--ok)';
      }
      
      // Refresh data
      setTimeout(() => {
        closeInviteBuyerModal();
        refreshDistributorDashboard();
        if (typeof loadDistributorsAndBuyers === 'function') {
          loadDistributorsAndBuyers();
        }
      }, 1500);
      
    } catch (err) {
      console.error('Error sending invite:', err);
      const statusEl = document.getElementById('invite-buyer-status');
      if (statusEl) {
        statusEl.textContent = '❌ Failed to send invite. Please try again.';
        statusEl.style.color = 'var(--stamp)';
      }
    }
  }


  // =========================================================================
  // ATTENTION CLICK HANDLER
  // =========================================================================

  function handleAttentionClick(type) {
    switch(type) {
      case 'buyer-requests':
        showScreen('profile');
        // Try to scroll to buyer requests section
        setTimeout(() => {
          const element = document.getElementById('my-relationship-card');
          if (element) {
            element.scrollIntoView({ behavior: 'smooth', block: 'center' });
            element.style.borderColor = 'var(--brass)';
            setTimeout(() => {
              element.style.borderColor = 'var(--line)';
            }, 2000);
          }
        }, 300);
        break;
        
      case 'agent-request':
        showScreen('profile');
        break;
        
      case 'inquiries':
        showScreen('inquiries');
        break;
        
      default:
        console.warn('Unknown attention type:', type);
        break;
    }
  }


  // =========================================================================
  // INITIALIZATION
  // =========================================================================

  async function initDistributor() {
    if (DistributorState.initialized) {
      return;
    }

    try {
      const user = await getCurrentDistributor();

      if (!user) {
        if (DistributorState.retryCount < DistributorState.maxRetries) {
          DistributorState.retryCount++;
          setTimeout(() => {
            initDistributor();
          }, 2000);
        }
        return;
      }

      if (!isDistributorRole(user)) {
        const holder = getHolder();
        if (holder) {
          holder.innerHTML = `
            <div class="lock-banner">
              <div class="lb-title">🔒 Distributor Tools</div>
              <div class="lb-sub">Upgrade to a distributor account to access these tools.</div>
              <button onclick="showScreen('upgrade')">Upgrade Now</button>
            </div>
          `;
        }
        return;
      }

      DistributorState.initialized = true;
      DistributorState.distributorId = user.id;
      DistributorState.retryCount = 0;

      renderDistributorPanel();
      await refreshDistributorDashboard();

    } catch (error) {
      console.error("Distributor initialization failed:", error);
      
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
      if (event === 'SIGNED_IN' && session) {
        DistributorState.initialized = false;
        setTimeout(() => {
          initDistributor();
        }, 1000);
      }

      if (event === 'SIGNED_OUT') {
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
  
  // New public functions
  window.openInviteBuyerModal = openInviteBuyerModal;
  window.closeInviteBuyerModal = closeInviteBuyerModal;
  window.searchBuyersForInvite = searchBuyersForInvite;
  window.sendBuyerInvite = sendBuyerInvite;
  window.handleAttentionClick = handleAttentionClick;


  // =========================================================================
  // BOOT
  // =========================================================================

  function boot() {
    attachAuthListener();

    setTimeout(() => {
      initDistributor();
    }, 1500);
  }


  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

})();
