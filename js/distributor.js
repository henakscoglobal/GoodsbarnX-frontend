// ==========================================================================
// GoodsbarnX — distributor.js
// Distributor relationship management layer.
//
// Current responsibilities:
//   1. Verify the authenticated user is a distributor.
//   2. Load the distributor profile.
//   3. Load pending agent attachment requests.
//   4. Load agent profile information for each request.
//   5. Render distributor agent-request UI.
//   6. Provide Accept / Decline actions.
//   7. Refresh the request list after a decision.
//
// Database authority:
//   agent_distributor_attachments
//       → agent ↔ distributor attachment/request state.
//
//   RLS
//       → determines whether the authenticated distributor may UPDATE
//         a particular attachment.
//
//   enforce_agent_distributor_attachment_update()
//       → enforces valid status transitions.
//
// IMPORTANT:
//   Frontend authorization is NOT security.
//
//   Supabase RLS and database triggers remain the final authority.
//
// Dependencies:
//   - js/config.js → global `sb`
//   - js/auth.js   → global `currentUser`
//
// Expected role:
//   currentUser.role === "distributor"
// ==========================================================================


// ==========================================================================
// STATE
// ==========================================================================

let distributorProfile = null;
let distributorAgentRequests = [];


// ==========================================================================
// SAFE HTML ESCAPING
// ==========================================================================

function distributorEscapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}


// ==========================================================================
// DISTRIBUTOR GUARD
// ==========================================================================

function isCurrentUserDistributor() {
  return !!(
    currentUser &&
    currentUser.role === "distributor"
  );
}


// ==========================================================================
// LOAD DISTRIBUTOR PROFILE
//
// distributor_profiles.id is used as the distributor identity.
// ==========================================================================

async function loadDistributorProfile() {
  if (!isCurrentUserDistributor()) {
    return null;
  }

  const {
    data,
    error
  } = await sb
    .from("distributor_profiles")
    .select(
      "id, business_name, location, market, category"
    )
    .eq(
      "id",
      currentUser.id
    )
    .maybeSingle();

  if (error) {
    console.error(
      "Distributor profile lookup failed:",
      error.message
    );

    distributorProfile = null;

    return null;
  }

  distributorProfile = data || null;

  return distributorProfile;
}


// ==========================================================================
// LOAD PENDING AGENT ATTACHMENT REQUESTS
//
// SOURCE OF TRUTH:
//
//   public.agent_distributor_attachments
//
// Only pending requests are loaded here.
//
// RLS determines which rows the authenticated distributor may see.
//
// The distributor can only see rows where:
//
//   distributor_id = auth.uid()
//
// according to the current SELECT policy.
//
// ==========================================================================

async function loadDistributorAgentRequests() {
  const container =
    document.getElementById(
      "distributor-agent-requests-list"
    );

  if (!isCurrentUserDistributor()) {
    distributorAgentRequests = [];

    return [];
  }

  if (container) {
    container.innerHTML =
      '<div class="loading-text">Loading agent requests...</div>';
  }

  const {
    data: requests,
    error
  } = await sb
    .from("agent_distributor_attachments")
    .select(
      "id, agent_id, distributor_id, status, created_at"
    )
    .eq(
      "distributor_id",
      currentUser.id
    )
    .eq(
      "status",
      "pending"
    )
    .order(
      "created_at",
      {
        ascending: false
      }
    );

  if (error) {
    console.error(
      "Distributor agent-request lookup failed:",
      error.message
    );

    distributorAgentRequests = [];

    if (container) {
      container.innerHTML =
        '<div class="loading-text">Could not load agent requests.</div>';
    }

    return [];
  }

  if (
    !requests ||
    requests.length === 0
  ) {
    distributorAgentRequests = [];

    renderDistributorAgentRequests();

    return [];
  }


  // ------------------------------------------------------------------------
  // LOAD AGENT PROFILES
  //
  // agent_distributor_attachments.agent_id references profiles.id.
  //
  // We deliberately load the profile separately instead of assuming a
  // nested relationship exists in Supabase.
  // ------------------------------------------------------------------------

  const agentIds = [
    ...new Set(
      requests.map(
        request => request.agent_id
      )
    )
  ];

  const {
    data: agents,
    error: agentError
  } = await sb
    .from("profiles")
    .select(
      "id, full_name, phone"
    )
    .in(
      "id",
      agentIds
    );

  if (agentError) {
    console.error(
      "Agent profile lookup failed:",
      agentError.message
    );
  }


  // ------------------------------------------------------------------------
  // BUILD AGENT LOOKUP
  // ------------------------------------------------------------------------

  const agentMap = {};

  (agents || []).forEach(
    agent => {
      agentMap[agent.id] = agent;
    }
  );


  // ------------------------------------------------------------------------
  // BUILD REQUEST STATE
  // ------------------------------------------------------------------------

  distributorAgentRequests =
    requests.map(
      request => ({
        request,

        agent:
          agentMap[
            request.agent_id
          ] || null
      })
    );


  renderDistributorAgentRequests();

  return distributorAgentRequests;
}


// ==========================================================================
// RENDER DISTRIBUTOR AGENT REQUESTS
// ==========================================================================

function renderDistributorAgentRequests() {
  const container =
    document.getElementById(
      "distributor-agent-requests-list"
    );

  if (!container) {
    return;
  }

  if (!isCurrentUserDistributor()) {
    container.innerHTML = "";

    return;
  }


  // ------------------------------------------------------------------------
  // EMPTY STATE
  // ------------------------------------------------------------------------

  if (!distributorAgentRequests.length) {
    container.innerHTML = `
      <div class="loading-text">
        No pending agent attachment requests.
      </div>
    `;

    return;
  }


  // ------------------------------------------------------------------------
  // REQUEST CARDS
  // ------------------------------------------------------------------------

  container.innerHTML =
    distributorAgentRequests.map(
      item => {

        const request =
          item.request;

        const agent =
          item.agent;

        const agentName =
          agent?.full_name ||
          "Supplier agent";

        const agentPhone =
          agent?.phone ||
          "";

        const createdAt =
          request.created_at
            ? new Date(
                request.created_at
              ).toLocaleString()
            : "";


        return `
          <div
            class="manifest"
            data-agent-request-id="${distributorEscapeHtml(
              request.id
            )}"
            style="
              margin-bottom:10px;
            "
          >

            <div class="manifest-top">

              <div>

                <div class="m-name">
                  ${distributorEscapeHtml(
                    agentName
                  )}
                </div>

                <div class="m-loc">

                  ${
                    agentPhone
                      ? distributorEscapeHtml(
                          agentPhone
                        )
                      : ""
                  }

                  ${
                    createdAt
                      ? ` · Requested ${
                          distributorEscapeHtml(
                            createdAt
                          )
                        }`
                      : ""
                  }

                </div>

              </div>

              <span
                class="stamp-badge"
                style="
                  border-color:var(--brass);
                  color:var(--brass);
                "
              >
                PENDING
              </span>

            </div>


            <div
              style="
                display:flex;
                gap:8px;
                margin-top:12px;
                flex-wrap:wrap;
              "
            >

              <button
                type="button"
                class="distributor-tools"
                style="
                  margin:0;
                  padding:9px 12px;
                  background:var(--ok);
                  color:white;
                  border:none;
                  cursor:pointer;
                "
                onclick="approveDistributorAgentAttachment(
                  '${distributorEscapeHtml(
                    request.id
                  )}'
                )"
              >
                Accept agent
              </button>


              <button
                type="button"
                class="distributor-tools"
                style="
                  margin:0;
                  padding:9px 12px;
                  background:transparent;
                  color:var(--stamp);
                  border:1px solid var(--stamp);
                  cursor:pointer;
                "
                onclick="declineDistributorAgentAttachment(
                  '${distributorEscapeHtml(
                    request.id
                  )}'
                )"
              >
                Decline
              </button>

            </div>

          </div>
        `;
      }
    ).join("");
}


// ==========================================================================
// FIND LOCAL REQUEST
// ==========================================================================

function getDistributorAgentRequest(
  requestId
) {
  return (
    distributorAgentRequests.find(
      item =>
        item.request?.id === requestId
    ) || null
  );
}


// ==========================================================================
// UPDATE ATTACHMENT STATUS
//
// IMPORTANT:
//
// The frontend does not decide whether the update is authorized.
//
// Supabase RLS currently requires:
//
//   auth.uid() = distributor_id
//   current_profile_role() = 'distributor'
//
// The database trigger additionally enforces:
//
//   pending → accepted
//   pending → declined
//
// ==========================================================================

async function updateDistributorAgentAttachmentStatus(
  requestId,
  newStatus
) {
  if (!isCurrentUserDistributor()) {
    return {
      success: false,
      error: "Only distributors can manage agent attachments."
    };
  }


  // ------------------------------------------------------------------------
  // VALID STATUS
  // ------------------------------------------------------------------------

  if (
    newStatus !== "accepted" &&
    newStatus !== "declined"
  ) {
    return {
      success: false,
      error: "Invalid attachment decision."
    };
  }


  // ------------------------------------------------------------------------
  // REQUEST ID
  // ------------------------------------------------------------------------

  if (!requestId) {
    return {
      success: false,
      error: "Invalid attachment request."
    };
  }


  // ------------------------------------------------------------------------
  // LOCAL REQUEST CHECK
  //
  // This is only a UX guard.
  //
  // Database RLS remains authoritative.
  // ------------------------------------------------------------------------

  const localRequest =
    getDistributorAgentRequest(
      requestId
    );

  if (
    localRequest &&
    localRequest.request.status !== "pending"
  ) {
    return {
      success: false,
      error: "This attachment request is no longer pending."
    };
  }


  // ------------------------------------------------------------------------
  // DATABASE UPDATE
  // ------------------------------------------------------------------------

  const {
    error
  } = await sb
    .from("agent_distributor_attachments")
    .update({
      status: newStatus
    })
    .eq(
      "id",
      requestId
    )
    .eq(
      "distributor_id",
      currentUser.id
    )
    .eq(
      "status",
      "pending"
    );


  // ------------------------------------------------------------------------
  // DATABASE AUTHORITY
  // ------------------------------------------------------------------------

  if (error) {
    console.error(
      "Agent attachment status update failed:",
      error.message
    );

    return {
      success: false,
      error: error.message
    };
  }


  // ------------------------------------------------------------------------
  // REFRESH
  // ------------------------------------------------------------------------

  await loadDistributorAgentRequests();


  return {
    success: true,
    status: newStatus
  };
}


// ==========================================================================
// APPROVE AGENT ATTACHMENT
// ==========================================================================

async function approveDistributorAgentAttachment(
  requestId
) {
  const result =
    await updateDistributorAgentAttachmentStatus(
      requestId,
      "accepted"
    );

  if (!result.success) {
    alert(
      "Could not accept agent:\n\n" +
      result.error
    );

    return;
  }

  alert(
    "Agent attachment accepted."
  );
}


// ==========================================================================
// DECLINE AGENT ATTACHMENT
// ==========================================================================

async function declineDistributorAgentAttachment(
  requestId
) {
  const confirmed =
    window.confirm(
      "Decline this agent's distributor attachment request?"
    );

  if (!confirmed) {
    return;
  }

  const result =
    await updateDistributorAgentAttachmentStatus(
      requestId,
      "declined"
    );

  if (!result.success) {
    alert(
      "Could not decline agent:\n\n" +
      result.error
    );

    return;
  }

  alert(
    "Agent attachment declined."
  );
}


// ==========================================================================
// LOAD DISTRIBUTOR SCREEN
//
// Sequence:
//
//   1. Load distributor profile.
//   2. Load pending agent requests.
//   3. Render request UI.
//
// ==========================================================================

async function loadDistributorScreen() {
  if (!isCurrentUserDistributor()) {
    return;
  }

  await loadDistributorProfile();

  await loadDistributorAgentRequests();
}


// ==========================================================================
// INITIALIZE
//
// index.html / auth layer should call:
//
//   initDistributorScreen()
//
// after currentUser has been established.
// ==========================================================================

function initDistributorScreen() {
  if (!isCurrentUserDistributor()) {
    return;
  }

  loadDistributorScreen();
}


// ==========================================================================
// GLOBAL EXPORTS
//
// Plain global-script architecture.
// ==========================================================================

window.initDistributorScreen =
  initDistributorScreen;

window.loadDistributorScreen =
  loadDistributorScreen;

window.loadDistributorProfile =
  loadDistributorProfile;

window.loadDistributorAgentRequests =
  loadDistributorAgentRequests;

window.renderDistributorAgentRequests =
  renderDistributorAgentRequests;

window.updateDistributorAgentAttachmentStatus =
  updateDistributorAgentAttachmentStatus;

window.approveDistributorAgentAttachment =
  approveDistributorAgentAttachment;

window.declineDistributorAgentAttachment =
  declineDistributorAgentAttachment;
