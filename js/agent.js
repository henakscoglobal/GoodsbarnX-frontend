// ==========================================================================
// GoodsbarnX — agent.js
// Agent relationship + agent-referred buyer layer.
//
// Responsibilities:
//   1. Load the authenticated agent profile.
//   2. Load agent ↔ distributor attachment requests.
//   3. Show pending / accepted / declined attachment state.
//   4. Allow an eligible agent to request distributor attachment.
//   5. After distributor acceptance, establish distributor context.
//   6. Allow the attached agent to search existing buyers.
//   7. Refer an existing buyer through create_trade_relationship().
//   8. Load relationships assigned to the agent through relationship_agents.
//
// Database authority:
//   agent_distributor_attachments
//       → agent ↔ distributor attachment/request state.
//
//   trade_relationships
//       → buyer ↔ distributor trade relationship.
//
//   relationship_agents
//       → agent assignment to an existing trade relationship.
//
//   create_trade_relationship()
//       → authoritative relationship creation RPC.
//
// IMPORTANT:
//   This frontend does NOT decide authorization.
//
//   Supabase RLS, database constraints, and RPC functions remain the final
//   source of truth for all protected operations.
//
// Dependencies:
//   - js/config.js → global `sb`
//   - js/auth.js   → global `currentUser`
//
// Expected role:
//   currentUser.role === "agent"
// ==========================================================================


// ==========================================================================
// STATE
// ==========================================================================

let agentProfile = null;
let agentAttachments = [];
let agentDistributor = null;

let agentRelationships = [];
let agentRelationshipMap = {};


// ==========================================================================
// SAFE HTML ESCAPING
// ==========================================================================

function agentEscapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}


// ==========================================================================
// AGENT GUARD
// ==========================================================================

function isCurrentUserAgent() {
  return !!(
    currentUser &&
    currentUser.role === "agent"
  );
}


// ==========================================================================
// LOAD AGENT PROFILE
//
// agent_profiles.id is used as the agent identity.
// ==========================================================================

async function loadAgentProfile() {
  if (!isCurrentUserAgent()) return null;

  const { data, error } = await sb
    .from("agent_profiles")
    .select(
      "id, employment_confirmed, company_id, profiles(full_name, phone)"
    )
    .eq("id", currentUser.id)
    .maybeSingle();

  if (error) {
    console.error(
      "Agent profile lookup failed:",
      error.message
    );

    agentProfile = null;

    return null;
  }

  agentProfile = data || null;

  return agentProfile;
}


// ==========================================================================
// ATTACHMENT HELPERS
// ==========================================================================

function getAcceptedAgentAttachment() {
  return (
    agentAttachments.find(
      row => row.status === "accepted"
    ) || null
  );
}


function getPendingAgentAttachment() {
  return (
    agentAttachments.find(
      row => row.status === "pending"
    ) || null
  );
}


function getDeclinedAgentAttachment() {
  return (
    agentAttachments.find(
      row => row.status === "declined"
    ) || null
  );
}


// ==========================================================================
// LOAD AGENT ↔ DISTRIBUTOR ATTACHMENTS
//
// SOURCE OF TRUTH:
//
//   public.agent_distributor_attachments
//
// The agent is allowed to see their own attachment rows through the
// corresponding SELECT RLS policy.
//
// IMPORTANT:
//
//   A pending request does NOT mean the agent is attached.
//
//   Only status = "accepted" creates an active distributor context.
//
//   relationship_agents is NOT used to determine whether the agent is
//   attached to a distributor.
// ==========================================================================

async function loadAgentDistributorAttachments() {
  if (!isCurrentUserAgent()) return [];

  const { data, error } = await sb
    .from("agent_distributor_attachments")
    .select(
      "id, agent_id, distributor_id, status, created_at"
    )
    .eq("agent_id", currentUser.id)
    .order("created_at", {
      ascending: false
    });

  if (error) {
    console.error(
      "Agent distributor attachment lookup failed:",
      error.message
    );

    agentAttachments = [];
    agentDistributor = null;

    renderAgentTools();

    return [];
  }

  agentAttachments = data || [];

  // Only an accepted attachment creates an active distributor context.
  const accepted =
    getAcceptedAgentAttachment();

  if (!accepted) {
    agentDistributor = null;

    renderAgentTools();

    return agentAttachments;
  }

  const {
    data: distributor,
    error: distributorError
  } = await sb
    .from("distributor_profiles")
    .select(
      "id, business_name, location, market, category"
    )
    .eq("id", accepted.distributor_id)
    .maybeSingle();

  if (distributorError) {
    console.error(
      "Accepted distributor lookup failed:",
      distributorError.message
    );

    agentDistributor = null;
  } else {
    agentDistributor = distributor || null;
  }

  renderAgentTools();

  return agentAttachments;
}


// ==========================================================================
// RENDER AGENT TOOLS
//
// Expected index.html containers:
//
//   #agent-tools-holder
//   #agent-relationships-panel
//
// The HTML only provides the containers.
// agent.js owns the dynamic agent relationship UI.
// ==========================================================================

function renderAgentTools() {
  const holder =
    document.getElementById("agent-tools-holder");

  const panel =
    document.getElementById("agent-relationships-panel");

  if (!holder || !isCurrentUserAgent()) {
    return;
  }

  const employmentConfirmed =
    !!agentProfile?.employment_confirmed;

  const accepted =
    getAcceptedAgentAttachment();

  const pending =
    getPendingAgentAttachment();

  const declined =
    getDeclinedAgentAttachment();


  // ------------------------------------------------------------------------
  // EMPLOYMENT NOT CONFIRMED
  // ------------------------------------------------------------------------

  if (!employmentConfirmed) {
    holder.innerHTML = `
      <div class="distributor-tools">
        <div class="dt-title">
          Employment pending confirmation
        </div>

        <div class="dt-sub">
          Your supplier-agent employment is still being confirmed.
          Distributor attachment and buyer referral will become available
          after confirmation.
        </div>
      </div>
    `;

    if (panel) {
      panel.style.display = "none";
    }

    return;
  }


  let attachmentHtml = "";
  let actionsHtml = "";


  // ------------------------------------------------------------------------
  // ACCEPTED ATTACHMENT
  // ------------------------------------------------------------------------

  if (accepted && agentDistributor) {
    attachmentHtml = `
      <div
        class="manifest"
        style="margin-bottom:0;"
      >

        <div class="manifest-top">

          <div>

            <div class="m-name">
              ${agentEscapeHtml(
                agentDistributor.business_name ||
                "Distributor"
              )}
            </div>

            <div class="m-loc">
              ${agentEscapeHtml(
                agentDistributor.location || ""
              )}

              ${
                agentDistributor.market
                  ? ` · ${agentEscapeHtml(
                      agentDistributor.market
                    )}`
                  : ""
              }
            </div>

          </div>

          <span
            class="stamp-badge"
            style="
              border-color:var(--ok);
              color:var(--ok);
            "
          >
            ATTACHED
          </span>

        </div>

        <div
          class="agent-state"
          style="
            margin-top:8px;
            font-size:12px;
            opacity:.72;
          "
        >
          You are attached to this distributor.
          Buyer referrals made through this agent path are attributed
          to this distributor relationship.
        </div>

      </div>
    `;

    actionsHtml = `
      <div
        class="agent-action-row"
        style="margin-top:10px;"
      >

        <button
          type="button"
          class="distributor-tools"
          style="
            margin:0;
            padding:10px 12px;
            background:var(--brass);
            color:var(--ink);
            border:none;
            cursor:pointer;
          "
          onclick="openAgentReferralModal()"
        >
          Refer existing buyer
        </button>

      </div>
    `;
  }


  // ------------------------------------------------------------------------
  // PENDING ATTACHMENT
  // ------------------------------------------------------------------------

  else if (pending) {
    attachmentHtml = `
      <div
        class="manifest"
        style="margin-bottom:0;"
      >

        <div class="manifest-top">

          <div>

            <div class="m-name">
              Distributor attachment requested
            </div>

            <div class="m-loc">
              Waiting for the distributor to accept
              your attachment request.
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

      </div>
    `;
  }


  // ------------------------------------------------------------------------
  // DECLINED ATTACHMENT
  // ------------------------------------------------------------------------

  else if (declined) {
    attachmentHtml = `
      <div
        class="manifest"
        style="margin-bottom:0;"
      >

        <div class="manifest-top">

          <div>

            <div class="m-name">
              Previous attachment declined
            </div>

            <div class="m-loc">
              You may submit a new distributor
              attachment request.
            </div>

          </div>

          <span
            class="stamp-badge"
            style="
              border-color:var(--stamp);
              color:var(--stamp);
            "
          >
            DECLINED
          </span>

        </div>

      </div>
    `;

    actionsHtml = `
      <div
        class="agent-action-row"
        style="margin-top:10px;"
      >

        <button
          type="button"
          class="distributor-tools"
          style="
            margin:0;
            padding:10px 12px;
            background:var(--brass);
            color:var(--ink);
            border:none;
            cursor:pointer;
          "
          onclick="openAgentAttachmentModal()"
        >
          Request distributor attachment
        </button>

      </div>
    `;
  }


  // ------------------------------------------------------------------------
  // NO ATTACHMENT
  // ------------------------------------------------------------------------

  else {
    attachmentHtml = `
      <div
        class="distributor-tools"
        style="margin-bottom:0;"
      >

        <div class="dt-title">
          No distributor attachment
        </div>

        <div class="dt-sub">
          Request attachment to a distributor.
          The distributor must accept before you can
          refer buyers on their behalf.
        </div>

      </div>
    `;

    actionsHtml = `
      <div
        class="agent-action-row"
        style="margin-top:10px;"
      >

        <button
          type="button"
          class="distributor-tools"
          style="
            margin:0;
            padding:10px 12px;
            background:var(--brass);
            color:var(--ink);
            border:none;
            cursor:pointer;
          "
          onclick="openAgentAttachmentModal()"
        >
          Request distributor attachment
        </button>

      </div>
    `;
  }


  holder.innerHTML = `
    <div class="section-label">
      Supplier agent
    </div>

    ${attachmentHtml}

    ${actionsHtml}
  `;


  if (panel) {
    panel.style.display =
      accepted && agentDistributor
        ? "block"
        : "none";
  }
}


// ==========================================================================
// OPEN DISTRIBUTOR ATTACHMENT MODAL
// ==========================================================================

function openAgentAttachmentModal() {
  const modal =
    document.getElementById(
      "agent-attachment-modal"
    );

  if (!modal) return;

  const input =
    document.getElementById(
      "agent-attachment-distributor-name"
    );

  const status =
    document.getElementById(
      "agent-attachment-status"
    );

  if (input) {
    input.value = "";
  }

  if (status) {
    status.innerText = "";
  }

  modal.classList.add("active");
}


// ==========================================================================
// CLOSE DISTRIBUTOR ATTACHMENT MODAL
// ==========================================================================

function closeAgentAttachmentModal() {
  const modal =
    document.getElementById(
      "agent-attachment-modal"
    );

  if (modal) {
    modal.classList.remove("active");
  }
}


// ==========================================================================
// ESCAPE ILIKE SPECIAL CHARACTERS
//
// PostgreSQL ILIKE treats % and _ as wildcards.
//
// This function escapes those characters before a business-name search.
// ==========================================================================

function escapeAgentIlike(value) {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_");
}


// ==========================================================================
// SUBMIT AGENT → DISTRIBUTOR ATTACHMENT REQUEST
//
// Writes to:
//
//   public.agent_distributor_attachments
//
// Required values:
//
//   agent_id
//   distributor_id
//   status = "pending"
//
// RLS supplied by the database is expected to enforce:
//
//   auth.uid() = agent_id
//   current_profile_role() = 'agent'
//   status = 'pending'
//
// The frontend does not bypass or replace that authorization.
// ==========================================================================

async function submitAgentAttachmentRequest() {
  const input =
    document.getElementById(
      "agent-attachment-distributor-name"
    );

  const status =
    document.getElementById(
      "agent-attachment-status"
    );

  if (!input || !status) {
    return;
  }


  // ------------------------------------------------------------------------
  // BASIC GUARDS
  // ------------------------------------------------------------------------

  const name =
    input.value.trim();

  if (!name) {
    status.innerText =
      "Enter the distributor's business name.";

    return;
  }

  if (!isCurrentUserAgent()) {
    status.innerText =
      "Only supplier agents can request attachment.";

    return;
  }

  if (!agentProfile?.employment_confirmed) {
    status.innerText =
      "Your agent employment must be confirmed first.";

    return;
  }


  // ------------------------------------------------------------------------
  // PREVENT DUPLICATE ACTIVE/PENDING REQUESTS
  // ------------------------------------------------------------------------

  const existingPending =
    getPendingAgentAttachment();

  if (existingPending) {
    status.innerText =
      "You already have a pending distributor attachment request.";

    return;
  }

  const existingAccepted =
    getAcceptedAgentAttachment();

  if (existingAccepted) {
    status.innerText =
      "You are already attached to a distributor.";

    return;
  }


  // ------------------------------------------------------------------------
  // FIND DISTRIBUTOR
  // ------------------------------------------------------------------------

  status.innerText =
    "Finding distributor...";

  const searchName =
    escapeAgentIlike(name);

  const {
    data: distributors,
    error: distributorError
  } = await sb
    .from("distributor_profiles")
    .select(
      "id, business_name, location, market, category"
    )
    .ilike(
      "business_name",
      `%${searchName}%`
    )
    .limit(10);

  if (distributorError) {
    console.error(
      "Distributor search failed:",
      distributorError.message
    );

    status.innerText =
      "Distributor search failed.";

    return;
  }


  // ------------------------------------------------------------------------
  // NO MATCH
  // ------------------------------------------------------------------------

  if (!distributors || distributors.length === 0) {
    status.innerText =
      "No distributor found with that business name.";

    return;
  }


  // ------------------------------------------------------------------------
  // EXACT MATCH
  //
  // If there is one result, use it.
  //
  // If multiple results exist, require the agent to identify the intended
  // distributor instead of silently attaching to an arbitrary company.
  // ------------------------------------------------------------------------

  if (distributors.length > 1) {
    renderAgentAttachmentDistributorChoices(
      distributors
    );

    status.innerText =
      "Multiple distributors found. Select the correct distributor.";

    return;
  }

  const distributor =
    distributors[0];


  // ------------------------------------------------------------------------
  // INSERT PENDING ATTACHMENT
  // ------------------------------------------------------------------------

  status.innerText =
    "Sending attachment request...";

  const {
    error
  } = await sb
    .from("agent_distributor_attachments")
    .insert({
      agent_id: currentUser.id,
      distributor_id: distributor.id,
      status: "pending"
    });

  if (error) {
    console.error(
      "Agent attachment request failed:",
      error.message
    );

    status.innerText =
      "Could not send request: " +
      error.message;

    return;
  }


  // ------------------------------------------------------------------------
  // SUCCESS
  // ------------------------------------------------------------------------

  status.innerText =
    "Request sent. Waiting for the distributor to accept.";

  await loadAgentDistributorAttachments();

  setTimeout(() => {
    closeAgentAttachmentModal();
  }, 1200);
}


// ==========================================================================
// RENDER MULTIPLE DISTRIBUTOR SEARCH RESULTS
// ==========================================================================

function renderAgentAttachmentDistributorChoices(
  distributors
) {
  const status =
    document.getElementById(
      "agent-attachment-status"
    );

  if (!status) return;

  status.innerHTML = `
    <div style="margin-top:10px;">
      ${distributors.map(distributor => `
        <div
          class="manifest"
          style="
            margin-top:8px;
            padding:10px;
            cursor:pointer;
          "
          onclick="requestAttachmentToDistributor('${agentEscapeHtml(distributor.id)}')"
        >

          <div class="m-name">
            ${agentEscapeHtml(
              distributor.business_name ||
              "Distributor"
            )}
          </div>

          <div class="m-loc">
            ${agentEscapeHtml(
              distributor.location || ""
            )}

            ${
              distributor.market
                ? ` · ${agentEscapeHtml(
                    distributor.market
                  )}`
                : ""
            }
          </div>

        </div>
      `).join("")}
    </div>
  `;
}


// ==========================================================================
// REQUEST ATTACHMENT TO SELECTED DISTRIBUTOR
// ==========================================================================

async function requestAttachmentToDistributor(
  distributorId
) {
  const status =
    document.getElementById(
      "agent-attachment-status"
    );

  if (!status) return;

  if (!isCurrentUserAgent()) {
    status.innerText =
      "Only supplier agents can request attachment.";

    return;
  }

  if (!agentProfile?.employment_confirmed) {
    status.innerText =
      "Your agent employment must be confirmed first.";

    return;
  }

  if (!distributorId) {
    status.innerText =
      "Invalid distributor.";

    return;
  }

  if (getAcceptedAgentAttachment()) {
    status.innerText =
      "You are already attached to a distributor.";

    return;
  }

  if (getPendingAgentAttachment()) {
    status.innerText =
      "You already have a pending attachment request.";

    return;
  }

  status.innerText =
    "Sending attachment request...";

  const {
    error
  } = await sb
    .from("agent_distributor_attachments")
    .insert({
      agent_id: currentUser.id,
      distributor_id: distributorId,
      status: "pending"
    });

  if (error) {
    console.error(
      "Selected distributor attachment request failed:",
      error.message
    );

    status.innerText =
      "Could not send request: " +
      error.message;

    return;
  }

  status.innerText =
    "Request sent. Waiting for the distributor to accept.";

  await loadAgentDistributorAttachments();

  setTimeout(() => {
    closeAgentAttachmentModal();
  }, 1200);
}


// ==========================================================================
// OPEN AGENT REFERRAL MODAL
// ==========================================================================

function openAgentReferralModal() {
  const modal =
    document.getElementById(
      "agent-referral-modal"
    );

  if (!modal) return;

  const search =
    document.getElementById(
      "agent-referral-search"
    );

  const results =
    document.getElementById(
      "agent-referral-results"
    );

  const status =
    document.getElementById(
      "agent-referral-status"
    );

  const context =
    document.getElementById(
      "agent-referral-context"
    );

  const accepted =
    getAcceptedAgentAttachment();


  if (!accepted || !agentDistributor) {
    if (status) {
      status.innerText =
        "You must have an accepted distributor attachment first.";
    }

    modal.classList.add("active");

    return;
  }


  if (search) {
    search.value = "";
  }

  if (results) {
    results.innerHTML = "";
  }

  if (status) {
    status.innerText = "";
  }

  if (context) {
    context.innerText =
      "Referral target: " +
      (agentDistributor.business_name || "Distributor") +
      ". The database will verify that this agent is authorized to create the relationship.";
  }

  modal.classList.add("active");
}


// ==========================================================================
// CLOSE AGENT REFERRAL MODAL
// ==========================================================================

function closeAgentReferralModal() {
  const modal =
    document.getElementById(
      "agent-referral-modal"
    );

  if (modal) {
    modal.classList.remove("active");
  }
}


// ==========================================================================
// SEARCH BUYERS FOR AGENT REFERRAL
//
// This searches existing buyer accounts only.
//
// It does NOT create a buyer.
//
// It does NOT create a trade relationship.
//
// It does NOT alter buyer locks.
//
// The final relationship operation is performed by the RPC.
// ==========================================================================

async function searchBuyersForAgentReferral() {
  const input =
    document.getElementById(
      "agent-referral-search"
    );

  const results =
    document.getElementById(
      "agent-referral-results"
    );

  if (!input || !results) {
    return;
  }

  const query =
    input.value.trim();

  if (query.length < 2) {
    results.innerHTML = "";
    return;
  }

  if (
    !getAcceptedAgentAttachment() ||
    !agentDistributor
  ) {
    results.innerHTML =
      '<div class="loading-text">You must be attached to a distributor first.</div>';

    return;
  }

  results.innerHTML =
    '<div class="loading-text">Searching buyers...</div>';

  const safeQuery =
    escapeAgentIlike(query);


  // ------------------------------------------------------------------------
  // SEARCH BUYER BUSINESS NAME
  // ------------------------------------------------------------------------

  const buyerNameResult =
    await sb
      .from("buyer_profiles")
      .select(
        "id, name, location, market, profiles(full_name, phone)"
      )
      .ilike(
        "name",
        `%${safeQuery}%`
      )
      .limit(10);


  // ------------------------------------------------------------------------
  // SEARCH PROFILE FULL NAME
  // ------------------------------------------------------------------------

  const profileNameResult =
    await sb
      .from("buyer_profiles")
      .select(
        "id, name, location, market, profiles!inner(full_name, phone)"
      )
      .ilike(
        "profiles.full_name",
        `%${safeQuery}%`
      )
      .limit(10);


  if (
    buyerNameResult.error &&
    profileNameResult.error
  ) {
    console.error(
      "Agent buyer search failed:",
      buyerNameResult.error?.message,
      profileNameResult.error?.message
    );

    results.innerHTML =
      '<div class="loading-text">Buyer search failed.</div>';

    return;
  }


  // ------------------------------------------------------------------------
  // DEDUPLICATE RESULTS
  // ------------------------------------------------------------------------

  const buyerMap =
    new Map();

  [
    ...(buyerNameResult.data || []),
    ...(profileNameResult.data || [])
  ].forEach(buyer => {
    if (!buyerMap.has(buyer.id)) {
      buyerMap.set(
        buyer.id,
        buyer
      );
    }
  });

  const buyers =
    [...buyerMap.values()]
      .slice(0, 10);


  if (!buyers.length) {
    results.innerHTML =
      '<div class="loading-text">No matching buyers found.</div>';

    return;
  }


  // ------------------------------------------------------------------------
  // RENDER RESULTS
  // ------------------------------------------------------------------------

  results.innerHTML =
    buyers.map(buyer => {

      const name =
        buyer.name ||
        buyer.profiles?.full_name ||
        "Buyer";

      const phone =
        buyer.profiles?.phone ||
        "";

      return `
        <div
          class="manifest"
          style="
            padding:12px;
            cursor:pointer;
          "
          onclick="referBuyerAsAgent('${agentEscapeHtml(
            buyer.id
          )}')"
        >

          <div class="m-name">
            ${agentEscapeHtml(name)}
          </div>

          <div class="m-loc">

            ${agentEscapeHtml(
              buyer.location || ""
            )}

            ${
              buyer.market
                ? ` · ${agentEscapeHtml(
                    buyer.market
                  )}`
                : ""
            }

            ${
              phone
                ? ` · ${agentEscapeHtml(
                    phone
                  )}`
                : ""
            }

          </div>

        </div>
      `;
    }).join("");
}


// ==========================================================================
// REFER EXISTING BUYER
//
// IMPORTANT:
//
// This does NOT insert directly into:
//
//   trade_relationships
//
// Instead it calls:
//
//   create_trade_relationship()
//
// The database RPC remains responsible for:
//
//   - authorization
//   - duplicate prevention
//   - relationship creation
//   - trust initialization
//   - loyalty initialization
//   - relationship events
//   - RLS/business rules
//
// The distributor supplied here comes only from an ACCEPTED
// agent_distributor_attachments row.
//
// relationship_agents remains a separate downstream relationship-assignment
// structure.
// ==========================================================================

async function referBuyerAsAgent(
  buyerId
) {
  const status =
    document.getElementById(
      "agent-referral-status"
    );

  if (!status) return;


  // ------------------------------------------------------------------------
  // GUARD
  // ------------------------------------------------------------------------

  if (!isCurrentUserAgent()) {
    status.innerText =
      "Only supplier agents can use buyer referral.";

    return;
  }


  // ------------------------------------------------------------------------
  // ACTIVE ATTACHMENT REQUIRED
  // ------------------------------------------------------------------------

  const accepted =
    getAcceptedAgentAttachment();

  if (
    !accepted ||
    !agentDistributor?.id
  ) {
    status.innerText =
      "You are not currently attached to a distributor.";

    return;
  }


  // ------------------------------------------------------------------------
  // BUYER ID REQUIRED
  // ------------------------------------------------------------------------

  if (!buyerId) {
    status.innerText =
      "Invalid buyer.";

    return;
  }


  // ------------------------------------------------------------------------
  // CREATE RELATIONSHIP THROUGH RPC
  // ------------------------------------------------------------------------

  status.innerText =
    "Creating buyer relationship...";

  const {
    error
  } = await sb.rpc(
    "create_trade_relationship",
    {
      p_buyer_id: buyerId,
      p_distributor_id:
        agentDistributor.id
    }
  );


  if (error) {
    console.error(
      "Agent buyer referral failed:",
      error.message
    );

    status.innerText =
      "Could not create relationship: " +
      error.message;

    return;
  }


  // ------------------------------------------------------------------------
  // SUCCESS
  // ------------------------------------------------------------------------

  status.innerText =
    "Buyer successfully referred.";

  await loadAgentRelationships();

  setTimeout(() => {
    closeAgentReferralModal();
  }, 1200);
}


// ==========================================================================
// LOAD AGENT TRADE RELATIONSHIPS
//
// IMPORTANT:
//
// This is where relationship_agents belongs.
//
// It does NOT establish the agent's distributor attachment.
//
// Instead:
//
//   agent_distributor_attachments
//       = agent ↔ distributor attachment
//
//   relationship_agents
//       = agent ↔ trade relationship assignment
//
// Therefore we only use relationship_agents here to display relationships
// that are already assigned to this agent.
// ==========================================================================

async function loadAgentRelationships() {
  const container =
    document.getElementById(
      "agent-relationships-list"
    );

  if (
    !container ||
    !isCurrentUserAgent()
  ) {
    return;
  }


  // ------------------------------------------------------------------------
  // REQUIRE ACCEPTED DISTRIBUTOR ATTACHMENT
  // ------------------------------------------------------------------------

  const accepted =
    getAcceptedAgentAttachment();

  if (!accepted) {
    agentRelationships = [];
    agentRelationshipMap = {};

    renderAgentRelationships();

    return;
  }


  container.innerHTML =
    '<div class="loading-text">Loading your relationships...</div>';


  // ------------------------------------------------------------------------
  // LOAD CURRENT AGENT ASSIGNMENTS
  //
  // relationship_agents.agent_id references the authenticated profile
  // identity according to the current schema.
  // ------------------------------------------------------------------------

  const {
    data: assignments,
    error: assignmentError
  } = await sb
    .from("relationship_agents")
    .select(
      "relationship_id, is_primary, assigned_at"
    )
    .eq(
      "agent_id",
      currentUser.id
    )
    .is(
      "unassigned_at",
      null
    )
    .order(
      "assigned_at",
      {
        ascending: false
      }
    );


  if (assignmentError) {
    console.error(
      "Agent relationship assignment lookup failed:",
      assignmentError.message
    );

    container.innerHTML =
      '<div class="loading-text">Could not load your relationships.</div>';

    return;
  }


  if (
    !assignments ||
    assignments.length === 0
  ) {
    agentRelationships = [];
    agentRelationshipMap = {};

    renderAgentRelationships();

    return;
  }


  // ------------------------------------------------------------------------
  // LOAD RELATIONSHIPS
  // ------------------------------------------------------------------------

  const relationshipIds =
    assignments.map(
      assignment =>
        assignment.relationship_id
    );


  const {
    data: relationships,
    error: relationshipError
  } = await sb
    .from("trade_relationships")
    .select("*")
    .in(
      "id",
      relationshipIds
    )
    .order(
      "created_at",
      {
        ascending: false
      }
    );


  if (relationshipError) {
    console.error(
      "Agent trade relationship lookup failed:",
      relationshipError.message
    );

    container.innerHTML =
      '<div class="loading-text">Could not load trade relationships.</div>';

    return;
  }


  if (
    !relationships ||
    relationships.length === 0
  ) {
    agentRelationships = [];
    agentRelationshipMap = {};

    renderAgentRelationships();

    return;
  }


  // ------------------------------------------------------------------------
  // RELATED IDS
  // ------------------------------------------------------------------------

  const buyerIds =
    relationships.map(
      row => row.buyer_id
    );

  const distributorIds =
    relationships.map(
      row => row.distributor_id
    );


  // ------------------------------------------------------------------------
  // LOAD BUYERS, DISTRIBUTORS, TRUST
  // ------------------------------------------------------------------------

  const [
    buyersResult,
    distributorsResult,
    trustResult
  ] = await Promise.all([

    sb
      .from("buyer_profiles")
      .select(
        "id, name, location, market, profiles(full_name, phone)"
      )
      .in(
        "id",
        buyerIds
      ),

    sb
      .from("distributor_profiles")
      .select(
        "id, business_name, location, market"
      )
      .in(
        "id",
        distributorIds
      ),

    sb
      .from("relationship_trust")
      .select(
        "relationship_id, trust_score, completed_orders, disputed_orders"
      )
      .in(
        "relationship_id",
        relationshipIds
      )

  ]);


  // ------------------------------------------------------------------------
  // BUILD LOOKUP MAPS
  // ------------------------------------------------------------------------

  const buyerMap = {};
  const distributorMap = {};
  const trustMap = {};
  const assignmentMap = {};


  (buyersResult.data || []).forEach(
    buyer => {
      buyerMap[buyer.id] = buyer;
    }
  );


  (distributorsResult.data || []).forEach(
    distributor => {
      distributorMap[distributor.id] =
        distributor;
    }
  );


  (trustResult.data || []).forEach(
    trust => {
      trustMap[trust.relationship_id] =
        trust;
    }
  );


  assignments.forEach(
    assignment => {
      assignmentMap[
        assignment.relationship_id
      ] = assignment;
    }
  );


  // ------------------------------------------------------------------------
  // BUILD AGENT RELATIONSHIP STATE
  // ------------------------------------------------------------------------

  agentRelationships =
    relationships.map(
      relationship => ({
        relationship,

        buyer:
          buyerMap[
            relationship.buyer_id
          ] || null,

        distributor:
          distributorMap[
            relationship.distributor_id
          ] || null,

        trust:
          trustMap[
            relationship.id
          ] || null,

        assignment:
          assignmentMap[
            relationship.id
          ] || null
      })
    );


  agentRelationshipMap = {};


  agentRelationships.forEach(
    item => {
      agentRelationshipMap[
        item.relationship.id
      ] = item;
    }
  );


  renderAgentRelationships();
}


// ==========================================================================
// RENDER AGENT TRADE RELATIONSHIPS
// ==========================================================================

function renderAgentRelationships() {
  const container =
    document.getElementById(
      "agent-relationships-list"
    );

  if (!container) {
    return;
  }


  if (!agentRelationships.length) {
    container.innerHTML =
      '<div class="loading-text">No trade relationships assigned to you yet.</div>';

    return;
  }


  container.innerHTML =
    agentRelationships.map(
      item => {

        const relationship =
          item.relationship;

        const buyer =
          item.buyer;

        const distributor =
          item.distributor;

        const trust =
          item.trust;

        const assignment =
          item.assignment;


        const buyerName =
          buyer?.name ||
          buyer?.profiles?.full_name ||
          "Buyer";


        const distributorName =
          distributor?.business_name ||
          "Distributor";


        const status =
          relationship.status ||
          "unknown";


        const statusColor =
          status === "active"
            ? "var(--ok)"
            : "var(--brass)";


        const trustHtml =
          trust?.trust_score != null
            ? `
              <div
                style="
                  font-size:12px;
                  margin-top:6px;
                  color:${
                    Number(
                      trust.trust_score
                    ) >= 70
                      ? "var(--ok)"
                      : Number(
                          trust.trust_score
                        ) >= 40
                        ? "var(--brass)"
                        : "var(--stamp)"
                  };
                  font-weight:700;
                "
              >

                Trust ${
                  Number(
                    trust.trust_score
                  )
                }/100

                <span
                  style="
                    color:rgba(18,21,28,0.5);
                    font-weight:400;
                  "
                >
                  · ${
                    trust.completed_orders || 0
                  } completed

                  ${
                    trust.disputed_orders
                      ? ` · ${
                          trust.disputed_orders
                        } disputed`
                      : ""
                  }
                </span>

              </div>
            `
            : "";


        const primaryHtml =
          assignment?.is_primary
            ? `
              <div
                class="m-loc"
                style="margin-top:5px;"
              >
                You are the primary agent
              </div>
            `
            : "";


        return `
          <div class="manifest">

            <div class="manifest-top">

              <div>

                <div class="m-name">

                  ${agentEscapeHtml(
                    buyerName
                  )}

                  <span
                    style="
                      color:rgba(18,21,28,0.4);
                    "
                  >
                    ↔
                  </span>

                  ${agentEscapeHtml(
                    distributorName
                  )}

                </div>

                <div class="m-loc">

                  ${agentEscapeHtml(
                    buyer?.profiles?.phone ||
                    ""
                  )}

                  ${
                    distributor?.location
                      ? ` · ${
                          agentEscapeHtml(
                            distributor.location
                          )
                        }`
                      : ""
                  }

                </div>

              </div>


              <span
                class="stamp-badge"
                style="
                  border-color:${statusColor};
                  color:${statusColor};
                "
              >
                ${agentEscapeHtml(
                  status
                ).toUpperCase()}
              </span>

            </div>


            ${primaryHtml}

            ${trustHtml}

          </div>
        `;
      }
    ).join("");
}


// ==========================================================================
// REFRESH AGENT SCREEN
//
// Sequence:
//
//   1. Agent profile
//   2. Distributor attachment state
//   3. Agent relationship assignments
//
// This order matters because relationship loading depends on the accepted
// distributor attachment state.
// ==========================================================================

async function loadAgentScreen() {
  if (!isCurrentUserAgent()) {
    return;
  }

  await loadAgentProfile();

  await loadAgentDistributorAttachments();

  await loadAgentRelationships();
}


// ==========================================================================
// INITIALIZE
//
// index.html / auth layer should call:
//
//   initAgentScreen()
//
// after currentUser has been established.
// ==========================================================================

function initAgentScreen() {
  if (!isCurrentUserAgent()) {
    return;
  }

  loadAgentScreen();
}


// ==========================================================================
// GLOBAL EXPORTS
//
// Plain global-script architecture.
//
// These functions are intentionally exposed so index.html can call them
// without importing or embedding this file's source.
// ==========================================================================

window.initAgentScreen =
  initAgentScreen;

window.loadAgentScreen =
  loadAgentScreen;

window.loadAgentProfile =
  loadAgentProfile;

window.loadAgentDistributorAttachments =
  loadAgentDistributorAttachments;

window.loadAgentRelationships =
  loadAgentRelationships;

window.renderAgentTools =
  renderAgentTools;

window.renderAgentRelationships =
  renderAgentRelationships;

window.openAgentAttachmentModal =
  openAgentAttachmentModal;

window.closeAgentAttachmentModal =
  closeAgentAttachmentModal;

window.submitAgentAttachmentRequest =
  submitAgentAttachmentRequest;

window.requestAttachmentToDistributor =
  requestAttachmentToDistributor;

window.openAgentReferralModal =
  openAgentReferralModal;

window.closeAgentReferralModal =
  closeAgentReferralModal;

window.searchBuyersForAgentReferral =
  searchBuyersForAgentReferral;

window.referBuyerAsAgent =
  referBuyerAsAgent;
