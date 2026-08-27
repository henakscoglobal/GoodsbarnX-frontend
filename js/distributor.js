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
  // DEBUGGING - TEMPORARY
  // =========================================================================

  console.log('\n=== 🔍 DEBUG: distributor.js loaded ===');
  console.log('Time:', new Date().toISOString());
  console.log('window.sb exists:', typeof window.sb !== 'undefined' && window.sb !== null);
  console.log('window.sb.auth exists:', !!(window.sb && window.sb.auth));
  console.log('currentUser (global):', typeof currentUser !== 'undefined' ? currentUser : 'undefined');
  console.log('Element #distributor-tools-holder exists:', !!document.getElementById('distributor-tools-holder'));


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

    processingAgentId: null

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

    const holder = document.getElementById("distributor-tools-holder");
    
    if (!holder) {
      console.error('❌ DEBUG: Element #distributor-tools-holder NOT FOUND');
      console.log('Available IDs with "distributor":', 
        Array.from(document.querySelectorAll('[id]'))
          .map(el => el.id)
          .filter(id => id.toLowerCase().includes('distributor'))
      );
    }
    
    return holder;

  }


  function setStatus(message, type) {

    const el = document.getElementById(
      "distributor-management-status"
    );

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
  // CURRENT USER
  // =========================================================================

  async function getCurrentDistributor() {

    console.log('🔍 DEBUG: getCurrentDistributor called');

    if (!window.sb) {
      console.error('❌ DEBUG: window.sb is not available');
      throw new Error("Supabase client is not available.");
    }

    if (!window.sb.auth) {
      console.error('❌ DEBUG: window.sb.auth is not available');
      throw new Error("Supabase auth is not available.");
    }

    try {
      const {
        data: {
          user
        },
        error
      } = await sb.auth.getUser();

      if (error) {
        console.error('❌ DEBUG: getUser error:', error);
        throw error;
      }

      if (!user) {
        console.log('⚠️ DEBUG: No user logged in');
        return null;
      }

      console.log('✅ DEBUG: User found:', { id: user.id, email: user.email });
      DistributorState.distributorId = user.id;

      return user;
    } catch (error) {
      console.error('❌ DEBUG: getCurrentDistributor exception:', error);
      throw error;
    }

  }


  // =========================================================================
  // PROFILE LOOKUP
  //
  // We deliberately keep this lookup defensive because the distributor
  // control layer should continue working even when a profile has limited
  // public information.
  // =========================================================================

  async function getProfiles(ids) {

    console.log('🔍 DEBUG: getProfiles called with IDs:', ids);

    const uniqueIds = [...new Set(
      (ids || []).filter(Boolean)
    )];

    if (!uniqueIds.length) {
      console.log('⚠️ DEBUG: No unique IDs to look up');
      return {};
    }

    if (!window.sb) {
      console.error('❌ DEBUG: window.sb not available in getProfiles');
      return {};
    }

    try {
      const {
        data,
        error
      } = await sb
        .from("profiles")
        .select("id, full_name, business_name, role")
        .in("id", uniqueIds);

      if (error) {
        console.error('❌ DEBUG: Profile lookup error:', error);
        console.warn(
          "GoodsbarnX distributor.js: profile lookup failed:",
          error
        );

        return {};
      }

      console.log('✅ DEBUG: Profiles found:', data);

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
      return fallbackId
        ? `User ${fallbackId.slice(0, 8)}`
        : "Unknown user";
    }

    return (
      profile.business_name ||
      profile.full_name ||
      (
        profile.id
          ? `User ${profile.id.slice(0, 8)}`
          : "Unknown user"
      )
    );

  }


  // =========================================================================
  // DISTRIBUTOR PANEL
  // =========================================================================

  function renderDistributorPanel() {

    console.log('🔍 DEBUG: renderDistributorPanel called');

    const holder = getHolder();

    if (!holder) {
      console.error('❌ DEBUG: Cannot render panel - holder not found');
      return;
    }

    console.log('✅ DEBUG: Rendering distributor panel');

    holder.innerHTML = `

      <div
        class="distributor-control-panel"
        style="
          margin:16px 0;
          padding:16px;
          border:1px solid var(--line,#ddd);
          border-radius:14px;
          background:var(--card,#fff);
        "
      >

        <div
          style="
            display:flex;
            justify-content:space-between;
            align-items:center;
            gap:12px;
            margin-bottom:14px;
          "
        >

          <div>

            <div
              class="section-label"
              style="margin:0;"
            >
              Distributor Control
            </div>

            <div
              style="
                font-size:13px;
                opacity:.72;
                margin-top:4px;
              "
            >
              Manage your agents and buyer relationships.
            </div>

          </div>

          <button
            type="button"
            class="cancel-btn"
            onclick="refreshDistributorDashboard()"
            style="margin:0;"
          >
            Refresh
          </button>

        </div>


        <div
          id="distributor-management-status"
          class="status-msg"
        ></div>


        <!-- PENDING AGENT REQUESTS -->

        <div style="margin-top:12px;">

          <div
            style="
              display:flex;
              justify-content:space-between;
              align-items:center;
              margin-bottom:8px;
            "
          >

            <strong>
              Agent Requests
            </strong>

            <span
              class="mono"
              id="distributor-pending-agent-count"
            >
              0
            </span>

          </div>

          <div id="distributor-pending-agents">

            <div class="loading-text">
              Loading agent requests...
            </div>

          </div>

        </div>


        <!-- ACCEPTED AGENTS -->

        <div style="margin-top:20px;">

          <div
            style="
              display:flex;
              justify-content:space-between;
              align-items:center;
              margin-bottom:8px;
            "
          >

            <strong>
              My Agents
            </strong>

            <span
              class="mono"
              id="distributor-accepted-agent-count"
            >
              0
            </span>

          </div>

          <div id="distributor-accepted-agents">

            <div class="loading-text">
              Loading agents...
            </div>

          </div>

        </div>


        <!-- BUYER RELATIONSHIPS -->

        <div style="margin-top:20px;">

          <div
            style="
              display:flex;
              justify-content:space-between;
              align-items:center;
              margin-bottom:8px;
            "
          >

            <strong>
              My Buyers
            </strong>

            <span
              class="mono"
              id="distributor-buyer-count"
            >
              0
            </span>

          </div>

          <div id="distributor-buyers">

            <div class="loading-text">
              Loading buyers...
            </div>

          </div>

        </div>

      </div>

    `;

    console.log('✅ DEBUG: Distributor panel rendered');

  }


  // =========================================================================
  // LOAD PENDING AGENT REQUESTS
  // =========================================================================

  async function loadPendingAgentRequests() {

    console.log('🔍 DEBUG: loadPendingAgentRequests called');
    console.log('Distributor ID:', DistributorState.distributorId);

    const list = document.getElementById(
      "distributor-pending-agents"
    );

    const count = document.getElementById(
      "distributor-pending-agent-count"
    );

    if (!list) {
      console.error('❌ DEBUG: Element #distributor-pending-agents not found');
      return;
    }

    list.innerHTML = `
      <div class="loading-text">
        Loading agent requests...
      </div>
    `;

    if (!window.sb) {
      console.error('❌ DEBUG: window.sb not available in loadPendingAgentRequests');
      list.innerHTML = '<div style="color:red;">Supabase not initialized</div>';
      return;
    }

    try {

      console.log('🔍 DEBUG: Querying agent_distributor_attachments...');

      const {
        data,
        error
      } = await sb
        .from("agent_distributor_attachments")
        .select(`
          id,
          agent_id,
          distributor_id,
          status,
          created_at
        `)
        .eq("distributor_id", DistributorState.distributorId)
        .eq("status", "pending")
        .order("created_at", {
          ascending: false
        });

      console.log('🔍 DEBUG: Pending agents query result:', { data, error });

      if (error) {
        console.error('❌ DEBUG: Pending agents query error:', error);
        throw error;
      }

      DistributorState.pendingAgents = data || [];

      console.log('✅ DEBUG: Pending agents found:', DistributorState.pendingAgents.length);

      if (count) {
        count.textContent =
          DistributorState.pendingAgents.length;
      }

      if (!DistributorState.pendingAgents.length) {

        list.innerHTML = `
          <div
            style="
              padding:12px;
              border-radius:10px;
              background:var(--soft,#f6f6f6);
              font-size:13px;
              opacity:.75;
            "
          >
            No pending agent requests.
          </div>
        `;

        return;
      }


      const agentIds =
        DistributorState.pendingAgents.map(
          item => item.agent_id
        );

      console.log('🔍 DEBUG: Agent IDs for profile lookup:', agentIds);

      const profiles =
        await getProfiles(agentIds);

      console.log('✅ DEBUG: Profiles retrieved for pending agents:', profiles);


      list.innerHTML =
        DistributorState.pendingAgents
          .map(request => {

            const profile =
              profiles[request.agent_id];

            const name =
              profileDisplayName(
                profile,
                request.agent_id
              );

            return `

              <div
                class="distributor-agent-request"
                style="
                  padding:12px;
                  border:1px solid var(--line,#ddd);
                  border-radius:10px;
                  margin-bottom:8px;
                "
              >

                <div
                  style="
                    display:flex;
                    justify-content:space-between;
                    gap:10px;
                  "
                >

                  <div>

                    <strong>
                      ${escapeHTML(name)}
                    </strong>

                    <div
                      style="
                        font-size:12px;
                        opacity:.7;
                        margin-top:4px;
                      "
                    >
                      Requested ${escapeHTML(
                        formatDate(request.created_at)
                      )}
                    </div>

                  </div>

                  <span
                    style="
                      font-size:11px;
                      padding:4px 7px;
                      border-radius:999px;
                      background:var(--soft,#f3f4f6);
                    "
                  >
                    Pending
                  </span>

                </div>


                <div
                  style="
                    display:flex;
                    gap:8px;
                    margin-top:12px;
                  "
                >

                  <button
                    type="button"
                    class="submit-btn"
                    style="flex:1;margin:0;"
                    onclick="approveDistributorAgent(
                      '${request.id}'
                    )"
                  >
                    Approve
                  </button>

                  <button
                    type="button"
                    class="cancel-btn"
                    style="flex:1;margin:0;"
                    onclick="declineDistributorAgent(
                      '${request.id}'
                    )"
                  >
                    Decline
                  </button>

                </div>

              </div>

            `;

          })
          .join("");

      console.log('✅ DEBUG: Pending agents rendered');

    } catch (error) {

      console.error(
        "❌ DEBUG: load pending agents failed:",
        error
      );

      list.innerHTML = `
        <div
          style="
            padding:12px;
            border-radius:10px;
            background:var(--soft,#f6f6f6);
            color:var(--danger,#b42318);
            font-size:13px;
          "
        >
          Unable to load agent requests: ${escapeHTML(error.message || 'Unknown error')}
        </div>
      `;

      setStatus(
        error.message ||
        "Unable to load agent requests.",
        "error"
      );

    }

  }


  // =========================================================================
  // LOAD ACCEPTED AGENTS
  // =========================================================================

  async function loadAcceptedAgents() {

    console.log('🔍 DEBUG: loadAcceptedAgents called');

    const list = document.getElementById(
      "distributor-accepted-agents"
    );

    const count = document.getElementById(
      "distributor-accepted-agent-count"
    );

    if (!list) {
      console.error('❌ DEBUG: Element #distributor-accepted-agents not found');
      return;
    }

    list.innerHTML = `
      <div class="loading-text">
        Loading agents...
      </div>
    `;

    if (!window.sb) {
      console.error('❌ DEBUG: window.sb not available in loadAcceptedAgents');
      return;
    }

    try {

      console.log('🔍 DEBUG: Querying accepted agents...');

      const {
        data,
        error
      } = await sb
        .from("agent_distributor_attachments")
        .select(`
          id,
          agent_id,
          distributor_id,
          status,
          created_at
        `)
        .eq("distributor_id", DistributorState.distributorId)
        .eq("status", "accepted")
        .order("created_at", {
          ascending: false
        });

      console.log('🔍 DEBUG: Accepted agents query result:', { data, error });

      if (error) {
        console.error('❌ DEBUG: Accepted agents query error:', error);
        throw error;
      }

      DistributorState.acceptedAgents = data || [];

      console.log('✅ DEBUG: Accepted agents found:', DistributorState.acceptedAgents.length);

      if (count) {
        count.textContent =
          DistributorState.acceptedAgents.length;
      }

      if (!DistributorState.acceptedAgents.length) {

        list.innerHTML = `
          <div
            style="
              padding:12px;
              border-radius:10px;
              background:var(--soft,#f6f6f6);
              font-size:13px;
              opacity:.75;
            "
          >
            No approved agents yet.
          </div>
        `;

        return;
      }


      const agentIds =
        DistributorState.acceptedAgents.map(
          item => item.agent_id
        );


      const profiles =
        await getProfiles(agentIds);


      list.innerHTML =
        DistributorState.acceptedAgents
          .map(attachment => {

            const profile =
              profiles[attachment.agent_id];

            const name =
              profileDisplayName(
                profile,
                attachment.agent_id
              );

            return `

              <div
                style="
                  padding:12px;
                  border:1px solid var(--line,#ddd);
                  border-radius:10px;
                  margin-bottom:8px;
                "
              >

                <div
                  style="
                    display:flex;
                    justify-content:space-between;
                    gap:10px;
                  "
                >

                  <div>

                    <strong>
                      ${escapeHTML(name)}
                    </strong>

                    <div
                      style="
                        font-size:12px;
                        opacity:.7;
                        margin-top:4px;
                      "
                    >
                      Attached ${escapeHTML(
                        formatDate(attachment.created_at)
                      )}
                    </div>

                  </div>

                  <span
                    style="
                      font-size:11px;
                      padding:4px 7px;
                      border-radius:999px;
                      background:var(--soft,#f3f4f6);
                    "
                  >
                    Active
                  </span>

                </div>

              </div>

            `;

          })
          .join("");

      console.log('✅ DEBUG: Accepted agents rendered');

    } catch (error) {

      console.error(
        "❌ DEBUG: load accepted agents failed:",
        error
      );

      list.innerHTML = `
        <div
          style="
            padding:12px;
            border-radius:10px;
            background:var(--soft,#f6f6f6);
            color:var(--danger,#b42318);
            font-size:13px;
          "
        >
          Unable to load agents: ${escapeHTML(error.message || 'Unknown error')}
        </div>
      `;

    }

  }


  // =========================================================================
  // APPROVE AGENT
  // =========================================================================

  async function approveDistributorAgent(attachmentId) {

    console.log('🔍 DEBUG: approveDistributorAgent called with ID:', attachmentId);

    if (!attachmentId) {
      return;
    }

    if (DistributorState.processingAgentId) {
      return;
    }

    DistributorState.processingAgentId = attachmentId;

    setStatus(
      "Approving agent attachment..."
    );


    try {

      const {
        data,
        error
      } = await sb
        .from("agent_distributor_attachments")
        .update({
          status: "accepted"
        })
        .eq("id", attachmentId)
        .eq(
          "distributor_id",
          DistributorState.distributorId
        )
        .eq("status", "pending")
        .select()
        .single();


      if (error) {
        throw error;
      }


      if (!data) {

        throw new Error(
          "The agent request could not be approved. It may have already been processed."
        );

      }


      setStatus(
        "Agent attachment approved.",
        "success"
      );


      await refreshDistributorDashboard();


      // Let the agent layer refresh itself if it is present.
      if (
        typeof window.refreshAgentDashboard ===
        "function"
      ) {

        try {
          await window.refreshAgentDashboard();
        } catch (refreshError) {
          console.warn(
            "Agent dashboard refresh failed:",
            refreshError
          );
        }

      }

    } catch (error) {

      console.error(
        "❌ DEBUG: approve agent failed:",
        error
      );

      setStatus(
        error.message ||
        "Unable to approve agent attachment.",
        "error"
      );

    } finally {

      DistributorState.processingAgentId = null;

    }

  }


  // =========================================================================
  // DECLINE AGENT
  // =========================================================================

  async function declineDistributorAgent(attachmentId) {

    console.log('🔍 DEBUG: declineDistributorAgent called with ID:', attachmentId);

    if (!attachmentId) {
      return;
    }

    if (DistributorState.processingAgentId) {
      return;
    }


    const confirmed =
      window.confirm(
        "Decline this agent attachment request?"
      );

    if (!confirmed) {
      return;
    }


    DistributorState.processingAgentId = attachmentId;

    setStatus(
      "Declining agent attachment..."
    );


    try {

      const {
        data,
        error
      } = await sb
        .from("agent_distributor_attachments")
        .update({
          status: "declined"
        })
        .eq("id", attachmentId)
        .eq(
          "distributor_id",
          DistributorState.distributorId
        )
        .eq("status", "pending")
        .select()
        .single();


      if (error) {
        throw error;
      }


      if (!data) {

        throw new Error(
          "The agent request could not be declined. It may have already been processed."
        );

      }


      setStatus(
        "Agent attachment declined.",
        "success"
      );


      await refreshDistributorDashboard();


      if (
        typeof window.refreshAgentDashboard ===
        "function"
      ) {

        try {
          await window.refreshAgentDashboard();
        } catch (refreshError) {
          console.warn(
            "Agent dashboard refresh failed:",
            refreshError
          );
        }

      }

    } catch (error) {

      console.error(
        "❌ DEBUG: decline agent failed:",
        error
      );

      setStatus(
        error.message ||
        "Unable to decline agent attachment.",
        "error"
      );

    } finally {

      DistributorState.processingAgentId = null;

    }

  }


  // =========================================================================
  // LOAD DISTRIBUTOR BUYER RELATIONSHIPS
  // =========================================================================

  async function loadDistributorBuyers() {

    console.log('🔍 DEBUG: loadDistributorBuyers called');
    console.log('Distributor ID:', DistributorState.distributorId);

    const list = document.getElementById(
      "distributor-buyers"
    );

    const count = document.getElementById(
      "distributor-buyer-count"
    );

    if (!list) {
      console.error('❌ DEBUG: Element #distributor-buyers not found');
      return;
    }

    list.innerHTML = `
      <div class="loading-text">
        Loading buyers...
      </div>
    `;

    if (!window.sb) {
      console.error('❌ DEBUG: window.sb not available in loadDistributorBuyers');
      return;
    }


    try {

      console.log('🔍 DEBUG: Querying trade_relationships...');

      const {
        data,
        error
      } = await sb
        .from("trade_relationships")
        .select(`
          id,
          buyer_id,
          distributor_id,
          status,
          is_primary,
          created_by,
          created_at
        `)
        .eq(
          "distributor_id",
          DistributorState.distributorId
        )
        .order("created_at", {
          ascending: false
        });

      console.log('🔍 DEBUG: Trade relationships query result:', { data, error });


      if (error) {
        console.error('❌ DEBUG: Trade relationships query error:', error);
        throw error;
      }


      DistributorState.buyers = data || [];

      console.log('✅ DEBUG: Buyers found:', DistributorState.buyers.length);


      if (count) {
        count.textContent =
          DistributorState.buyers.length;
      }


      if (!DistributorState.buyers.length) {

        list.innerHTML = `
          <div
            style="
              padding:12px;
              border-radius:10px;
              background:var(--soft,#f6f6f6);
              font-size:13px;
              opacity:.75;
            "
          >
            No buyer relationships yet.
          </div>
        `;

        return;

      }


      const buyerIds =
        DistributorState.buyers.map(
          relationship => relationship.buyer_id
        );

      console.log('🔍 DEBUG: Buyer IDs:', buyerIds);


      const profiles =
        await getProfiles(buyerIds);

      console.log('✅ DEBUG: Buyer profiles:', profiles);


      list.innerHTML =
        DistributorState.buyers
          .map(relationship => {

            const profile =
              profiles[relationship.buyer_id];

            const name =
              profileDisplayName(
                profile,
                relationship.buyer_id
              );


            const status =
              relationship.status ||
              "unknown";


            return `

              <div
                style="
                  padding:12px;
                  border:1px solid var(--line,#ddd);
                  border-radius:10px;
                  margin-bottom:8px;
                "
              >

                <div
                  style="
                    display:flex;
                    justify-content:space-between;
                    gap:10px;
                  "
                >

                  <div>

                    <strong>
                      ${escapeHTML(name)}
                    </strong>

                    <div
                      style="
                        font-size:12px;
                        opacity:.7;
                        margin-top:4px;
                      "
                    >
                      Relationship created
                      ${escapeHTML(
                        formatDate(
                          relationship.created_at
                        )
                      )}
                    </div>

                  </div>


                  <span
                    style="
                      font-size:11px;
                      padding:4px 7px;
                      border-radius:999px;
                      background:var(--soft,#f3f4f6);
                      text-transform:capitalize;
                    "
                  >
                    ${escapeHTML(status)}
                  </span>

                </div>


                ${
                  relationship.is_primary
                    ? `
                      <div
                        style="
                          margin-top:8px;
                          font-size:11px;
                          opacity:.7;
                        "
                      >
                        Primary relationship
                      </div>
                    `
                    : ""
                }

              </div>

            `;

          })
          .join("");

      console.log('✅ DEBUG: Buyers rendered');

    } catch (error) {

      console.error(
        "❌ DEBUG: load buyers failed:",
        error
      );

      list.innerHTML = `
        <div
          style="
            padding:12px;
            border-radius:10px;
            background:var(--soft,#f6f6f6);
            color:var(--danger,#b42318);
            font-size:13px;
          "
        >
          Unable to load buyer relationships: ${escapeHTML(error.message || 'Unknown error')}
        </div>
      `;

    }

  }


  // =========================================================================
  // REFRESH
  // =========================================================================

  async function refreshDistributorDashboard() {

    console.log('🔍 DEBUG: refreshDistributorDashboard called');

    if (!DistributorState.distributorId) {
      console.error('❌ DEBUG: No distributor ID set');
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

      console.error(
        "❌ DEBUG: dashboard refresh failed:",
        error
      );

    } finally {

      DistributorState.loading = false;

    }

  }


  // =========================================================================
  // INITIALIZATION
  // =========================================================================

  async function initDistributor() {

    console.log('\n=== 🔍 DEBUG: initDistributor called ===');

    if (DistributorState.initialized) {
      console.log('⚠️ DEBUG: Already initialized, skipping');
      return;
    }

    try {

      console.log('1. Getting current distributor...');
      const user = await getCurrentDistributor();

      if (!user) {
        console.log('⚠️ DEBUG: No user, aborting initialization');
        return;
      }

      console.log('2. User found:', { id: user.id, email: user.email });

      // ---------------------------------------------------------------
      // Verify distributor role.
      //
      // We use the existing profiles table rather than trusting a role
      // supplied by the browser.
      // ---------------------------------------------------------------

      console.log('3. Fetching profile for role check...');
      const profiles = await getProfiles([user.id]);

      const profile = profiles[user.id];

      console.log('4. Profile:', profile);
      console.log('5. Is distributor role?', isDistributorRole(profile));

      if (!isDistributorRole(profile)) {
        console.error('❌ DEBUG: User is NOT a distributor. Role:', profile?.role);
        return;
      }

      console.log('✅ DEBUG: User is confirmed as distributor');

      DistributorState.initialized = true;

      console.log('6. Rendering distributor panel...');
      renderDistributorPanel();

      console.log('7. Refreshing dashboard...');
      await refreshDistributorDashboard();

      console.log('✅ DEBUG: Distributor initialization complete');

    } catch (error) {

      console.error(
        "❌ DEBUG: initialization failed:",
        error
      );

      const holder = getHolder();

      if (holder) {

        holder.innerHTML = `
          <div
            style="
              margin:16px 0;
              padding:14px;
              border-radius:12px;
              background:var(--soft,#f6f6f6);
              color:var(--danger,#b42318);
            "
          >
            Unable to load distributor controls: ${escapeHTML(error.message || 'Unknown error')}
          </div>
        `;

      }

    }

  }


  // =========================================================================
  // AUTH STATE HANDLING
  // =========================================================================

  function attachAuthListener() {

    console.log('🔍 DEBUG: attachAuthListener called');

    if (!window.sb || !sb.auth) {
      console.error('❌ DEBUG: Cannot attach auth listener - sb.auth not available');
      return;
    }

    console.log('✅ DEBUG: Attaching auth listener');

    sb.auth.onAuthStateChange(function (
      event,
      session
    ) {

      console.log('🔍 DEBUG: Auth state changed:', event, 'Session:', session ? 'exists' : 'null');

      if (!session) {

        DistributorState.initialized = false;
        DistributorState.distributorId = null;
        DistributorState.pendingAgents = [];
        DistributorState.acceptedAgents = [];
        DistributorState.buyers = [];

        const holder = getHolder();

        if (holder) {
          holder.innerHTML = "";
        }

        return;

      }


      // Avoid doing database work inside the auth callback itself.
      setTimeout(function () {
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
  // BOOT
  // =========================================================================

  function boot() {

    console.log('\n=== 🔍 DEBUG: distributor.js boot called ===');
    console.log('Document readyState:', document.readyState);

    attachAuthListener();

    setTimeout(function () {
      console.log('🔍 DEBUG: Calling initDistributor from setTimeout');
      initDistributor();
    }, 0);

  }


  if (document.readyState === "loading") {

    console.log('🔍 DEBUG: Document still loading, waiting for DOMContentLoaded');
    
    document.addEventListener(
      "DOMContentLoaded",
      boot
    );

  } else {

    console.log('🔍 DEBUG: Document already loaded, calling boot directly');
    boot();

  }

  console.log('=== 🔍 DEBUG: distributor.js loaded and ready ===');

})();
