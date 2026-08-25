// ==========================================================================
// GoodsbarnX — agent.js
// Step 2 — Agent-Referred Buyer Path.
//
// Agent-facing relationship layer.
//
// Responsibilities:
//   - Load the agent's relationship context.
//   - Show the agent's currently assigned trade relationships.
//   - Search existing buyer accounts.
//   - Refer an existing buyer to the distributor the agent belongs to.
//   - Create the trade relationship through the existing Supabase RPC.
//
// Architecture principle:
//   The frontend does NOT decide whether an agent is authorized to refer a
//   buyer, which distributor they belong to, whether a relationship already
//   exists, or whether the relationship may be created.
//
//   Supabase / RLS / database functions remain the source of truth.
//
// Dependencies:
//   - js/config.js  → global `sb`
//   - js/auth.js    → global `currentUser`
//
// Expected role:
//   currentUser.role === "agent"
//
// Existing database objects used:
//   - agent_profiles
//   - buyer_profiles
//   - profiles
//   - trade_relationships
//   - relationship_agents
//   - relationship_trust
//   - create_trade_relationship RPC
//
// NOTE:
//   This file intentionally does NOT duplicate relationship.js.
//   relationship.js remains responsible for the broader relationship
//   management UI used by buyers and distributors.
// ==========================================================================


// ==========================================================================
// STATE
// ==========================================================================

let agentDistributor = null;
let agentRelationships = [];
let agentRelationshipMap = {};


// ==========================================================================
// SAFE HTML ESCAPING
//
// Search results and names come from database records. Escape them before
// inserting them into HTML so a business name or buyer name cannot become
// executable markup.
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
// The agent's distributor context is read from agent_profiles.
//
// IMPORTANT:
// This function does not invent or calculate an attached distributor.
// Whatever distributor relationship the database exposes is what the
// frontend displays.
// ==========================================================================

async function loadAgentProfile() {
  if (!isCurrentUserAgent()) return null;

  const { data, error } = await sb
    .from("agent_profiles")
    .select("id, profiles(full_name, phone)")
    .eq("id", currentUser.id)
    .maybeSingle();

  if (error) {
    console.error("Agent profile lookup failed:", error.message);
    return null;
  }

  return data;
}


// ==========================================================================
// LOAD AGENT RELATIONSHIPS
//
// This uses relationship_agents as the source for which relationships are
// currently assigned to this agent.
//
// unassigned_at IS NULL = currently assigned.
//
// The actual relationship belongs to the buyer/distributor pair stored in
// trade_relationships.
// ==========================================================================

async function loadAgentRelationships() {
  const container = document.getElementById("agent-relationships-list");

  if (!container || !isCurrentUserAgent()) return;

  container.innerHTML =
    '<div class="loading-text">Loading your relationships...</div>';

  const { data: assignments, error: assignmentError } = await sb
    .from("relationship_agents")
    .select("relationship_id, is_primary, assigned_at")
    .eq("agent_id", currentUser.id)
    .is("unassigned_at", null)
    .order("assigned_at", { ascending: false });

  if (assignmentError) {
    console.error(
      "Agent relationship assignment lookup failed:",
      assignmentError.message
    );

    container.innerHTML =
      '<div class="loading-text">Could not load your relationships.</div>';

    return;
  }

  if (!assignments || assignments.length === 0) {
    agentRelationships = [];
    agentRelationshipMap = {};

    container.innerHTML =
      '<div class="loading-text">No trade relationships assigned to you yet.</div>';

    return;
  }

  const relationshipIds = assignments.map(
    assignment => assignment.relationship_id
  );

  const { data: relationships, error: relationshipError } = await sb
    .from("trade_relationships")
    .select("*")
    .in("id", relationshipIds)
    .order("created_at", { ascending: false });

  if (relationshipError) {
    console.error(
      "Agent trade relationship lookup failed:",
      relationshipError.message
    );

    container.innerHTML =
      '<div class="loading-text">Could not load trade relationships.</div>';

    return;
  }

  if (!relationships || relationships.length === 0) {
    agentRelationships = [];
    agentRelationshipMap = {};

    container.innerHTML =
      '<div class="loading-text">No trade relationships found.</div>';

    return;
  }

  const buyerIds = relationships.map(r => r.buyer_id);
  const distributorIds = relationships.map(r => r.distributor_id);

  const [
    { data: buyers },
    { data: distributors },
    { data: trustRows }
  ] = await Promise.all([

    sb
      .from("buyer_profiles")
      .select("id, name, location, market, profiles(full_name, phone)")
      .in("id", buyerIds),

    sb
      .from("distributor_profiles")
      .select("id, business_name, location, market")
      .in("id", distributorIds),

    sb
      .from("relationship_trust")
      .select(
        "relationship_id, trust_score, completed_orders, disputed_orders"
      )
      .in("relationship_id", relationshipIds)

  ]);

  const buyerMap = {};
  const distributorMap = {};
  const trustMap = {};
  const assignmentMap = {};

  (buyers || []).forEach(buyer => {
    buyerMap[buyer.id] = buyer;
  });

  (distributors || []).forEach(distributor => {
    distributorMap[distributor.id] = distributor;
  });

  (trustRows || []).forEach(trust => {
    trustMap[trust.relationship_id] = trust;
  });

  assignments.forEach(assignment => {
    assignmentMap[assignment.relationship_id] = assignment;
  });

  agentRelationships = relationships.map(relationship => ({
    relationship,
    buyer: buyerMap[relationship.buyer_id] || null,
    distributor: distributorMap[relationship.distributor_id] || null,
    trust: trustMap[relationship.id] || null,
    assignment: assignmentMap[relationship.id] || null
  }));

  agentRelationshipMap = {};

  agentRelationships.forEach(item => {
    agentRelationshipMap[item.relationship.id] = item;
  });

  renderAgentRelationships();
}


// ==========================================================================
// RENDER AGENT RELATIONSHIPS
// ==========================================================================

function renderAgentRelationships() {
  const container = document.getElementById("agent-relationships-list");

  if (!container) return;

  if (!agentRelationships.length) {
    container.innerHTML =
      '<div class="loading-text">No trade relationships assigned to you yet.</div>';

    return;
  }

  container.innerHTML = agentRelationships.map(item => {

    const relationship = item.relationship;
    const buyer = item.buyer;
    const distributor = item.distributor;
    const trust = item.trust;
    const assignment = item.assignment;

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
          <div style="
            font-size:12px;
            margin-top:6px;
            color:${Number(trust.trust_score) >= 70
              ? "var(--ok)"
              : Number(trust.trust_score) >= 40
                ? "var(--brass)"
                : "var(--stamp)"};
            font-weight:700;
          ">
            Trust ${Number(trust.trust_score)}/100
            <span style="
              color:rgba(18,21,28,0.5);
              font-weight:400;
            ">
              · ${trust.completed_orders || 0} completed
              ${trust.disputed_orders
                ? ` · ${trust.disputed_orders} disputed`
                : ""}
            </span>
          </div>
        `
        : "";

    const primaryHtml =
      assignment?.is_primary
        ? `
          <div class="m-loc" style="margin-top:5px;">
            You are the primary agent
          </div>
        `
        : "";

    return `
      <div class="manifest">

        <div class="manifest-top">

          <div>

            <div class="m-name">
              ${agentEscapeHtml(buyerName)}
              <span style="color:rgba(18,21,28,0.4);">↔</span>
              ${agentEscapeHtml(distributorName)}
            </div>

            <div class="m-loc">
              ${agentEscapeHtml(buyer?.profiles?.phone || "")}
              ${distributor?.location
                ? ` · ${agentEscapeHtml(distributor.location)}`
                : ""}
            </div>

          </div>

          <span
            class="stamp-badge"
            style="
              border-color:${statusColor};
              color:${statusColor};
            "
          >
            ${agentEscapeHtml(status).toUpperCase()}
          </span>

        </div>

        ${primaryHtml}

        ${trustHtml}

      </div>
    `;
  }).join("");
}


// ==========================================================================
// FIND THE DISTRIBUTOR CONTEXT FOR THE AGENT
//
// The first implementation deliberately uses the agent's active trade
// relationships to establish the distributor context instead of assuming
// an undocumented column on agent_profiles.
//
// If the agent has already been assigned to a relationship, the distributor
// attached to that relationship becomes the distributor context.
//
// This prevents us from inventing a schema field that may not exist.
//
// The database RPC remains the final authority when the referral is made.
// ==========================================================================

async function loadAgentDistributorContext() {
  if (!isCurrentUserAgent()) return null;

  const { data: assignments, error } = await sb
    .from("relationship_agents")
    .select("relationship_id")
    .eq("agent_id", currentUser.id)
    .is("unassigned_at", null)
    .limit(1);

  if (error) {
    console.error(
      "Agent distributor context lookup failed:",
      error.message
    );

    return null;
  }

  if (!assignments || assignments.length === 0) {
    agentDistributor = null;
    return null;
  }

  const relationshipId = assignments[0].relationship_id;

  const { data: relationship, error: relationshipError } = await sb
    .from("trade_relationships")
    .select("distributor_id")
    .eq("id", relationshipId)
    .maybeSingle();

  if (relationshipError || !relationship) {
    agentDistributor = null;
    return null;
  }

  const { data: distributor, error: distributorError } = await sb
    .from("distributor_profiles")
    .select("id, business_name, location, market")
    .eq("id", relationship.distributor_id)
    .maybeSingle();

  if (distributorError) {
    console.error(
      "Distributor context lookup failed:",
      distributorError.message
    );

    agentDistributor = null;
    return null;
  }

  agentDistributor = distributor || null;

  renderAgentDistributorContext();

  return agentDistributor;
}


// ==========================================================================
// RENDER AGENT DISTRIBUTOR CONTEXT
// ==========================================================================

function renderAgentDistributorContext() {
  const container =
    document.getElementById("agent-distributor-context");

  if (!container) return;

  if (!agentDistributor) {
    container.innerHTML = `
      <div class="manifest">
        <div class="m-name">Distributor relationship not established</div>
        <div class="m-loc">
          You must be attached to a distributor before referring buyers.
        </div>
      </div>
    `;

    return;
  }

  container.innerHTML = `
    <div class="manifest">

      <div class="manifest-top">

        <div>
          <div class="m-name">
            ${agentEscapeHtml(agentDistributor.business_name)}
          </div>

          <div class="m-loc">
            ${agentEscapeHtml(agentDistributor.location || "")}
            ${agentDistributor.market
              ? ` · ${agentEscapeHtml(agentDistributor.market)}`
              : ""}
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

    </div>
  `;
}


// ==========================================================================
// OPEN AGENT REFERRAL MODAL
// ==========================================================================

function openAgentReferralModal() {
  const modal =
    document.getElementById("agent-referral-modal");

  if (!modal) return;

  const search =
    document.getElementById("agent-referral-search");

  const results =
    document.getElementById("agent-referral-results");

  const status =
    document.getElementById("agent-referral-status");

  if (search) search.value = "";
  if (results) results.innerHTML = "";
  if (status) status.innerText = "";

  if (!agentDistributor) {
    if (status) {
      status.innerText =
        "No distributor relationship is available for this agent.";
    }

    modal.classList.add("active");
    return;
  }

  modal.classList.add("active");
}


// ==========================================================================
// CLOSE AGENT REFERRAL MODAL
// ==========================================================================

function closeAgentReferralModal() {
  const modal =
    document.getElementById("agent-referral-modal");

  if (modal) {
    modal.classList.remove("active");
  }
}


// ==========================================================================
// SEARCH BUYERS FOR AGENT REFERRAL
//
// This searches buyer_profiles only.
// It does not create anything.
//
// IMPORTANT:
// We deliberately search by buyer name and profile name. Phone/email
// searching can be added later once the privacy/RLS rules for exposing those
// fields to agents are explicitly established.
// ==========================================================================

async function searchBuyersForAgentReferral() {
  const searchInput =
    document.getElementById("agent-referral-search");

  const resultsEl =
    document.getElementById("agent-referral-results");

  if (!searchInput || !resultsEl) return;

  const query =
    searchInput.value.trim();

  if (query.length < 2) {
    resultsEl.innerHTML = "";
    return;
  }

  resultsEl.innerHTML =
    '<div class="loading-text">Searching buyers...</div>';

  const safeQuery =
    query.replace(/[%_]/g, "\\$&");

  const { data: buyers, error } = await sb
    .from("buyer_profiles")
    .select("id, name, location, market, profiles(full_name, phone)")
    .or(
      `name.ilike.%${safeQuery}%,profiles.full_name.ilike.%${safeQuery}%`
    )
    .limit(10);

  if (error) {
    console.error(
      "Agent buyer search failed:",
      error.message
    );

    resultsEl.innerHTML =
      '<div class="loading-text">Buyer search failed.</div>';

    return;
  }

  if (!buyers || buyers.length === 0) {
    resultsEl.innerHTML =
      '<div class="loading-text">No matching buyers found.</div>';

    return;
  }

  resultsEl.innerHTML = buyers.map(buyer => {

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
        style="padding:12px; cursor:pointer;"
        onclick="referBuyerAsAgent('${agentEscapeHtml(buyer.id)}')"
      >

        <div class="m-name">
          ${agentEscapeHtml(name)}
        </div>

        <div class="m-loc">
          ${agentEscapeHtml(buyer.location || "")}
          ${phone
            ? ` · ${agentEscapeHtml(phone)}`
            : ""}
        </div>

      </div>
    `;
  }).join("");
}


// ==========================================================================
// REFER BUYER
//
// The frontend does NOT insert directly into trade_relationships.
//
// It calls the existing create_trade_relationship() database function.
//
// This is important because the database is responsible for:
//
//   - authorization
//   - duplicate prevention
//   - relationship creation
//   - trust initialization
//   - loyalty initialization
//   - relationship event creation
//   - any RLS/business rules
//
// The agent's distributor ID is supplied from the distributor context, but
// the database must still verify that the current agent is actually allowed
// to act for that distributor.
// ==========================================================================

async function referBuyerAsAgent(buyerId) {
  const status =
    document.getElementById("agent-referral-status");

  if (!status) return;

  if (!isCurrentUserAgent()) {
    status.innerText =
      "Only agents can use buyer referral.";

    return;
  }

  if (!agentDistributor?.id) {
    status.innerText =
      "You are not attached to a distributor.";

    return;
  }

  if (!buyerId) {
    status.innerText =
      "Invalid buyer.";

    return;
  }

  status.innerText =
    "Creating buyer relationship...";

  const { error } = await sb.rpc(
    "create_trade_relationship",
    {
      p_buyer_id: buyerId,
      p_distributor_id: agentDistributor.id
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

  status.innerText =
    "Buyer successfully referred.";

  await loadAgentRelationships();

  setTimeout(() => {
    closeAgentReferralModal();
  }, 1200);
}


// ==========================================================================
// REFRESH AGENT SCREEN
//
// Useful after authentication or when returning to the agent dashboard.
// ==========================================================================

async function loadAgentScreen() {
  if (!isCurrentUserAgent()) return;

  await loadAgentProfile();
  await loadAgentRelationships();
  await loadAgentDistributorContext();
}


// ==========================================================================
// INITIALIZE
//
// This function is intentionally explicit rather than automatically firing
// at script-load time. The main application already controls authentication
// and screen loading, so index.html can call loadAgentScreen() after
// currentUser has been established.
// ==========================================================================

function initAgentScreen() {
  if (!isCurrentUserAgent()) return;

  loadAgentScreen();
}


// ==========================================================================
// GLOBAL EXPORTS
//
// Plain global script architecture: expose functions to inline HTML
// onclick handlers and the main application.
// ==========================================================================

window.loadAgentScreen = loadAgentScreen;
window.initAgentScreen = initAgentScreen;

window.loadAgentRelationships = loadAgentRelationships;
window.loadAgentDistributorContext = loadAgentDistributorContext;

window.openAgentReferralModal = openAgentReferralModal;
window.closeAgentReferralModal = closeAgentReferralModal;

window.searchBuyersForAgentReferral =
  searchBuyersForAgentReferral;

window.referBuyerAsAgent =
  referBuyerAsAgent;
