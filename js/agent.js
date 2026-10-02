// ==========================================================================
// GoodsbarnX — agent.js
// Agent relationship + agent-referred buyer layer.
// Plain global script. Loads fifteenth (Canon §10).
//
// Responsibilities:
//   1. Load the authenticated agent profile.
//   2. Load agent ↔ distributor attachment requests.
//   3. Show pending / accepted / declined attachment state.
//   4. Allow an eligible agent to request distributor attachment.
//   5. After distributor acceptance, establish distributor context.
//   6. Refer an existing buyer through create_trade_relationship().
//   7. Load relationships assigned to the agent through relationship_agents.
//
// Database authority:
//   agent_distributor_attachments → agent ↔ distributor attachment state.
//   trade_relationships           → buyer ↔ distributor trade relationship.
//   relationship_agents           → agent assignment to an existing trade
//                                   relationship.
//   create_trade_relationship()   → authoritative relationship creation RPC.
//
// IMPORTANT:
//   This frontend does NOT decide authorization. Supabase RLS, database
//   constraints, and RPC functions remain the source of truth.
//
// V1.8.2.6 remediation Phase 1+2:
//   - Removed duplicate searchBuyersForAgentReferral (owner: relationship.js).
//   - Removed duplicate createAgentReferredBuyerRelationship
//     (owner: relationship.js).
//   - Removed duplicate searchBuyersForInvite (not an agent concern; the
//     distributor invite path lives in relationship.js).
//   - Registered an "agent" screen loader (Phase 2.3).
//   - All DOM lookups null-safe with named warnings.
// ==========================================================================

// ==========================================================================
// STATE
// ==========================================================================

let agentProfile = null;
let agentAttachments = [];
let agentDistributor = null;
let agentRelationships = [];
let agentRelationshipMap = {};

const __gbxAgentWarned = Object.create(null);
function agentWarnMissing(id) {
  if (__gbxAgentWarned[id]) return;
  __gbxAgentWarned[id] = true;
  console.warn("[GoodsbarnX/agent] DOM target #" + id + " is missing from index.html.");
}

// ==========================================================================
// ESCAPING
// ==========================================================================

function agentEscapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
function agentEscapeAttr(value) { return agentEscapeHtml(value); }

function escapeAgentIlike(value) {
  return String(value == null ? "" : value)
    .replace(/\\/g, "\\\\")
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_");
}

// ==========================================================================
// GUARD
// ==========================================================================

function isCurrentUserAgent() {
  return !!(currentUser && currentUser.role === "agent");
}

// ==========================================================================
// LOAD AGENT PROFILE
// ==========================================================================

async function loadAgentProfile() {
  if (!isCurrentUserAgent()) return null;
  if (!window.sb) { agentProfile = null; return null; }

  const { data, error } = await sb
    .from("agent_profiles")
    .select("id, employment_confirmed, company_id, profiles(full_name, phone)")
    .eq("id", currentUser.id)
    .maybeSingle();

  if (error) {
    console.error("[GoodsbarnX/agent] profile lookup failed:", error.message);
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
  return agentAttachments.find(row => row.status === "accepted") || null;
}
function getPendingAgentAttachment() {
  return agentAttachments.find(row => row.status === "pending") || null;
}
function getDeclinedAgentAttachment() {
  return agentAttachments.find(row => row.status === "declined") || null;
}

// ==========================================================================
// LOAD ATTACHMENTS
//
// Source of truth: public.agent_distributor_attachments.
// A pending request does NOT mean the agent is attached; only
// status = "accepted" creates an active distributor context.
// relationship_agents is NOT used to determine attachment.
// ==========================================================================

async function loadAgentDistributorAttachments() {
  if (!isCurrentUserAgent()) return [];
  if (!window.sb) { agentAttachments = []; agentDistributor = null; return []; }

  const { data, error } = await sb
    .from("agent_distributor_attachments")
    .select("id, agent_id, distributor_id, status, created_at")
    .eq("agent_id", currentUser.id)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[GoodsbarnX/agent] attachment lookup failed:", error.message);
    agentAttachments = [];
    agentDistributor = null;
    renderAgentTools();
    return [];
  }

  agentAttachments = data || [];
  const accepted = getAcceptedAgentAttachment();

  if (!accepted) {
    agentDistributor = null;
    renderAgentTools();
    return agentAttachments;
  }

  const { data: distributor, error: distributorError } = await sb
    .from("distributor_profiles")
    .select("id, business_name, location, market, category")
    .eq("id", accepted.distributor_id)
    .maybeSingle();

  if (distributorError) {
    console.error("[GoodsbarnX/agent] accepted distributor lookup failed:", distributorError.message);
    agentDistributor = null;
  } else {
    agentDistributor = distributor || null;
  }

  renderAgentTools();
  return agentAttachments;
}

// ==========================================================================
// RENDER AGENT TOOLS
// ==========================================================================

function renderAgentTools() {
  const holder = document.getElementById("agent-tools-holder");
  const panel  = document.getElementById("agent-relationships-panel");

  if (!holder || !isCurrentUserAgent()) return;

  const employmentConfirmed = !!agentProfile?.employment_confirmed;
  const accepted = getAcceptedAgentAttachment();
  const pending  = getPendingAgentAttachment();
  const declined = getDeclinedAgentAttachment();

  // Employment pending — Canon §8 precondition.
  if (!employmentConfirmed) {
    holder.innerHTML =
      '<div class="distributor-tools">' +
        '<div class="dt-title">Employment pending confirmation</div>' +
        '<div class="dt-sub">Your supplier-agent employment is still being confirmed. ' +
          'Distributor attachment and buyer referral will become available after confirmation.</div>' +
      '</div>';
    if (panel) panel.style.display = "none";
    return;
  }

  let attachmentHtml = "";
  let actionsHtml = "";

  if (accepted && agentDistributor) {
    attachmentHtml =
      '<div class="manifest" style="margin-bottom:0;">' +
        '<div class="manifest-top">' +
          '<div>' +
            '<div class="m-name">' + agentEscapeHtml(agentDistributor.business_name || "Distributor") + '</div>' +
            '<div class="m-loc">' + agentEscapeHtml(agentDistributor.location || "") +
              (agentDistributor.market ? " · " + agentEscapeHtml(agentDistributor.market) : "") +
            '</div>' +
          '</div>' +
          '<span class="stamp-badge" style="border-color:var(--ok); color:var(--ok);">ATTACHED</span>' +
        '</div>' +
        '<div class="agent-state" style="margin-top:8px;font-size:12px;opacity:.72;">' +
          'You are attached to this distributor. Buyer referrals made through this agent path are attributed to this distributor relationship.' +
        '</div>' +
      '</div>';
    actionsHtml =
      '<div class="agent-action-row" style="margin-top:10px;">' +
        '<button type="button" class="distributor-tools" ' +
          'style="margin:0;padding:10px 12px;background:var(--brass);color:var(--ink);border:none;cursor:pointer;" ' +
          'onclick="openAgentReferralModal()">Refer existing buyer</button>' +
      '</div>';
  } else if (pending) {
    attachmentHtml =
      '<div class="manifest" style="margin-bottom:0;">' +
        '<div class="manifest-top">' +
          '<div>' +
            '<div class="m-name">Distributor attachment requested</div>' +
            '<div class="m-loc">Waiting for the distributor to accept your attachment request.</div>' +
          '</div>' +
          '<span class="stamp-badge" style="border-color:var(--brass); color:var(--brass);">PENDING</span>' +
        '</div>' +
      '</div>';
  } else if (declined) {
    attachmentHtml =
      '<div class="manifest" style="margin-bottom:0;">' +
        '<div class="manifest-top">' +
          '<div>' +
            '<div class="m-name">Previous attachment declined</div>' +
            '<div class="m-loc">You may submit a new distributor attachment request.</div>' +
          '</div>' +
          '<span class="stamp-badge" style="border-color:var(--stamp); color:var(--stamp);">DECLINED</span>' +
        '</div>' +
      '</div>';
    actionsHtml =
      '<div class="agent-action-row" style="margin-top:10px;">' +
        '<button type="button" class="distributor-tools" ' +
          'style="margin:0;padding:10px 12px;background:var(--brass);color:var(--ink);border:none;cursor:pointer;" ' +
          'onclick="openAgentAttachmentModal()">Request distributor attachment</button>' +
      '</div>';
  } else {
    attachmentHtml =
      '<div class="distributor-tools" style="margin-bottom:0;">' +
        '<div class="dt-title">No distributor attachment</div>' +
        '<div class="dt-sub">Request attachment to a distributor. The distributor must accept before you can refer buyers on their behalf.</div>' +
      '</div>';
    actionsHtml =
      '<div class="agent-action-row" style="margin-top:10px;">' +
        '<button type="button" class="distributor-tools" ' +
          'style="margin:0;padding:10px 12px;background:var(--brass);color:var(--ink);border:none;cursor:pointer;" ' +
          'onclick="openAgentAttachmentModal()">Request distributor attachment</button>' +
      '</div>';
  }

  holder.innerHTML =
    '<div class="section-label">Supplier agent</div>' +
    attachmentHtml +
    actionsHtml;

  if (panel) {
    panel.style.display = (accepted && agentDistributor) ? "block" : "none";
  }
}

// ==========================================================================
// ATTACHMENT REQUEST MODAL
// ==========================================================================

function openAgentAttachmentModal() {
  const modal = document.getElementById("agent-attachment-modal");
  if (!modal) { agentWarnMissing("agent-attachment-modal"); return; }
  const input = document.getElementById("agent-attachment-distributor-name");
  const status = document.getElementById("agent-attachment-status");
  if (input) input.value = "";
  if (status) status.innerText = "";
  modal.classList.add("active");
}

function closeAgentAttachmentModal() {
  const modal = document.getElementById("agent-attachment-modal");
  if (modal) modal.classList.remove("active");
}

// ==========================================================================
// SUBMIT ATTACHMENT REQUEST
// ==========================================================================

async function submitAgentAttachmentRequest() {
  const input  = document.getElementById("agent-attachment-distributor-name");
  const status = document.getElementById("agent-attachment-status");
  if (!input || !status) return;

  const name = input.value.trim();
  if (!name) { status.innerText = "Enter the distributor's business name."; return; }
  if (!isCurrentUserAgent()) { status.innerText = "Only supplier agents can request attachment."; return; }
  if (!agentProfile?.employment_confirmed) { status.innerText = "Your agent employment must be confirmed first."; return; }

  if (getPendingAgentAttachment()) { status.innerText = "You already have a pending distributor attachment request."; return; }
  if (getAcceptedAgentAttachment()) { status.innerText = "You are already attached to a distributor."; return; }

  status.innerText = "Finding distributor...";

  const { data: distributors, error: distributorError } = await sb
    .from("distributor_profiles")
    .select("id, business_name, location, market, category")
    .ilike("business_name", "%" + escapeAgentIlike(name) + "%")
    .limit(10);

  if (distributorError) {
    console.error("[GoodsbarnX/agent] distributor search failed:", distributorError.message);
    status.innerText = "Distributor search failed.";
    return;
  }

  if (!distributors || distributors.length === 0) {
    status.innerText = "No distributor found with that business name.";
    return;
  }

  if (distributors.length > 1) {
    renderAgentAttachmentDistributorChoices(distributors);
    status.innerText = "Multiple distributors found. Select the correct distributor.";
    return;
  }

  await requestAttachmentToDistributor(distributors[0].id);
}

function renderAgentAttachmentDistributorChoices(distributors) {
  const status = document.getElementById("agent-attachment-status");
  if (!status) return;
  status.innerHTML =
    '<div style="margin-top:10px;">' +
      distributors.map(d =>
        '<div class="manifest" style="margin-top:8px;padding:10px;cursor:pointer;"' +
          ' data-distributor-id="' + agentEscapeAttr(d.id) + '"' +
          ' onclick="requestAttachmentToDistributor(this.dataset.distributorId)">' +
          '<div class="m-name">' + agentEscapeHtml(d.business_name || "Distributor") + '</div>' +
          '<div class="m-loc">' + agentEscapeHtml(d.location || "") +
            (d.market ? " · " + agentEscapeHtml(d.market) : "") +
          '</div>' +
        '</div>'
      ).join("") +
    '</div>';
}

async function requestAttachmentToDistributor(distributorId) {
  const status = document.getElementById("agent-attachment-status");
  if (!status) return;

  if (!isCurrentUserAgent()) { status.innerText = "Only supplier agents can request attachment."; return; }
  if (!agentProfile?.employment_confirmed) { status.innerText = "Your agent employment must be confirmed first."; return; }
  if (!distributorId) { status.innerText = "Invalid distributor."; return; }
  if (getAcceptedAgentAttachment()) { status.innerText = "You are already attached to a distributor."; return; }
  if (getPendingAgentAttachment()) { status.innerText = "You already have a pending attachment request."; return; }

  status.innerText = "Sending attachment request...";

  const { error } = await sb.from("agent_distributor_attachments").insert({
    agent_id: currentUser.id,
    distributor_id: distributorId,
    status: "pending"
  });

  if (error) {
    console.error("[GoodsbarnX/agent] attachment request failed:", error.message);
    status.innerText = "Could not send request: " + error.message;
    return;
  }

  status.innerText = "Request sent. Waiting for the distributor to accept.";
  await loadAgentDistributorAttachments();
  setTimeout(closeAgentAttachmentModal, 1200);
}

// ==========================================================================
// REFERRAL MODAL
// ==========================================================================

function openAgentReferralModal() {
  const modal = document.getElementById("agent-referral-modal");
  if (!modal) { agentWarnMissing("agent-referral-modal"); return; }
  const search  = document.getElementById("agent-referral-search");
  const results = document.getElementById("agent-referral-results");
  const status  = document.getElementById("agent-referral-status");
  const context = document.getElementById("agent-referral-context");
  const accepted = getAcceptedAgentAttachment();

  if (search) search.value = "";
  if (results) results.innerHTML = "";
  if (status) status.innerText = "";

  if (!accepted || !agentDistributor) {
    if (status) status.innerText = "You must have an accepted distributor attachment first.";
    modal.classList.add("active");
    return;
  }

  if (context) {
    context.innerText = "Referral target: " + (agentDistributor.business_name || "Distributor") +
      ". The database will verify that this agent is authorized to create the relationship.";
  }
  modal.classList.add("active");
}

function closeAgentReferralModal() {
  const modal = document.getElementById("agent-referral-modal");
  if (modal) modal.classList.remove("active");
}

// ==========================================================================
// BUYER SEARCH FOR REFERRAL
//
// The search input is bound here; the row's onclick dispatches to
// relationship.js's canonical createAgentReferredBuyerRelationship()
// (single owner after Phase 1+2 dedup).
// ==========================================================================

async function searchBuyersForAgentReferral() {
  const input   = document.getElementById("agent-referral-search");
  const results = document.getElementById("agent-referral-results");
  if (!input || !results || !window.sb) return;

  const query = input.value.trim();
  if (query.length < 2) { results.innerHTML = ""; return; }

  if (!getAcceptedAgentAttachment() || !agentDistributor) {
    results.innerHTML = '<div class="loading-text">You must be attached to a distributor first.</div>';
    return;
  }

  results.innerHTML = '<div class="loading-text">Searching buyers...</div>';

  const safe = escapeAgentIlike(query);

  const [buyerNameResult, profileNameResult] = await Promise.all([
    sb.from("buyer_profiles")
      .select("id, name, location, market, profiles(full_name, phone)")
      .ilike("name", "%" + safe + "%")
      .limit(10),
    sb.from("buyer_profiles")
      .select("id, name, location, market, profiles!inner(full_name, phone)")
      .ilike("profiles.full_name", "%" + safe + "%")
      .limit(10)
  ]);

  if (buyerNameResult.error && profileNameResult.error) {
    console.error("[GoodsbarnX/agent] buyer search failed:",
      buyerNameResult.error?.message, profileNameResult.error?.message);
    results.innerHTML = '<div class="loading-text">Buyer search failed.</div>';
    return;
  }

  const buyerMap = new Map();
  [...(buyerNameResult.data || []), ...(profileNameResult.data || [])].forEach(buyer => {
    if (!buyerMap.has(buyer.id)) buyerMap.set(buyer.id, buyer);
  });

  const buyers = [...buyerMap.values()].slice(0, 10);

  if (!buyers.length) {
    results.innerHTML = '<div class="loading-text">No matching buyers found.</div>';
    return;
  }

  results.innerHTML = buyers.map(buyer => {
    const name = buyer.name || buyer.profiles?.full_name || "Buyer";
    const phone = buyer.profiles?.phone || "";
    return '<div class="manifest" style="padding:12px;cursor:pointer;"' +
      ' data-buyer-id="' + agentEscapeAttr(buyer.id) + '"' +
      ' data-buyer-name="' + agentEscapeAttr(name) + '"' +
      ' onclick="createAgentReferredBuyerRelationship(this.dataset.buyerId, this.dataset.buyerName)">' +
      '<div class="m-name">' + agentEscapeHtml(name) + '</div>' +
      '<div class="m-loc">' + agentEscapeHtml(buyer.location || "") +
        (buyer.market ? " · " + agentEscapeHtml(buyer.market) : "") +
        (phone ? " · " + agentEscapeHtml(phone) : "") +
      '</div>' +
    '</div>';
  }).join("");
}

// ==========================================================================
// LOAD AGENT TRADE RELATIONSHIPS
//
// relationship_agents is the assignment table; it does NOT establish the
// agent's distributor attachment. We use it only to display relationships
// that are already assigned to this agent.
// ==========================================================================

async function loadAgentRelationships() {
  const container = document.getElementById("agent-relationships-list");
  if (!container || !isCurrentUserAgent()) return;
  if (!window.sb) {
    container.innerHTML = '<div class="loading-text">Connection service unavailable.</div>';
    return;
  }

  const accepted = getAcceptedAgentAttachment();
  if (!accepted) {
    agentRelationships = [];
    agentRelationshipMap = {};
    renderAgentRelationships();
    return;
  }

  container.innerHTML = '<div class="loading-text">Loading your relationships...</div>';

  const { data: assignments, error: assignmentError } = await sb
    .from("relationship_agents")
    .select("relationship_id, is_primary, assigned_at")
    .eq("agent_id", currentUser.id)
    .is("unassigned_at", null)
    .order("assigned_at", { ascending: false });

  if (assignmentError) {
    console.error("[GoodsbarnX/agent] assignment lookup failed:", assignmentError.message);
    container.innerHTML = '<div class="loading-text">Could not load your relationships.</div>';
    return;
  }

  if (!assignments || assignments.length === 0) {
    agentRelationships = [];
    agentRelationshipMap = {};
    renderAgentRelationships();
    return;
  }

  const relationshipIds = assignments.map(a => a.relationship_id).filter(Boolean);

  const { data: relationships, error: relationshipError } = await sb
    .from("trade_relationships")
    .select("*")
    .in("id", relationshipIds)
    .order("created_at", { ascending: false });

  if (relationshipError) {
    console.error("[GoodsbarnX/agent] relationship lookup failed:", relationshipError.message);
    container.innerHTML = '<div class="loading-text">Could not load trade relationships.</div>';
    return;
  }

  if (!relationships || relationships.length === 0) {
    agentRelationships = [];
    agentRelationshipMap = {};
    renderAgentRelationships();
    return;
  }

  const buyerIds        = relationships.map(r => r.buyer_id).filter(Boolean);
  const distributorIds  = relationships.map(r => r.distributor_id).filter(Boolean);
  const relIds          = relationships.map(r => r.id).filter(Boolean);

  const [buyersResult, distributorsResult, trustResult] = await Promise.all([
    sb.from("buyer_profiles").select("id, name, location, market, profiles(full_name, phone)").in("id", buyerIds),
    sb.from("distributor_profiles").select("id, business_name, location, market").in("id", distributorIds),
    sb.from("relationship_trust").select("relationship_id, trust_score, completed_orders, disputed_orders").in("relationship_id", relIds)
  ]);

  const buyerMap = {};
  const distributorMap = {};
  const trustMap = {};
  const assignmentMap = {};

  (buyersResult.data || []).forEach(b => { buyerMap[b.id] = b; });
  (distributorsResult.data || []).forEach(d => { distributorMap[d.id] = d; });
  (trustResult.data || []).forEach(t => { trustMap[t.relationship_id] = t; });
  assignments.forEach(a => { assignmentMap[a.relationship_id] = a; });

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
    container.innerHTML = '<div class="loading-text">No trade relationships assigned to you yet.</div>';
    return;
  }

  container.innerHTML = agentRelationships.map(item => {
    const relationship  = item.relationship;
    const buyer         = item.buyer;
    const distributor   = item.distributor;
    const trust         = item.trust;
    const assignment    = item.assignment;

    const buyerName       = buyer?.name || buyer?.profiles?.full_name || "Buyer";
    const distributorName = distributor?.business_name || "Distributor";
    const status          = relationship.status || "unknown";
    const statusColor     = status === "active" ? "var(--ok)" : "var(--brass)";

    const trustHtml = trust?.trust_score != null
      ? '<div style="font-size:12px;margin-top:6px;color:' +
          (Number(trust.trust_score) >= 70 ? "var(--ok)" :
           Number(trust.trust_score) >= 40 ? "var(--brass)" : "var(--stamp)") +
          ';font-weight:700;">Trust ' + Number(trust.trust_score) + '/100' +
          '<span style="color:rgba(18,21,28,0.5);font-weight:400;"> · ' +
            (trust.completed_orders || 0) + ' completed' +
            (trust.disputed_orders ? ' · ' + trust.disputed_orders + ' disputed' : "") +
          '</span>' +
        '</div>'
      : "";

    const primaryHtml = assignment?.is_primary
      ? '<div class="m-loc" style="margin-top:5px;">You are the primary agent</div>'
      : "";

    return '<div class="manifest">' +
      '<div class="manifest-top">' +
        '<div>' +
          '<div class="m-name">' +
            agentEscapeHtml(buyerName) +
            ' <span style="color:rgba(18,21,28,0.4);">↔</span> ' +
            agentEscapeHtml(distributorName) +
          '</div>' +
          '<div class="m-loc">' +
            agentEscapeHtml(buyer?.profiles?.phone || "") +
            (distributor?.location ? ' · ' + agentEscapeHtml(distributor.location) : "") +
          '</div>' +
        '</div>' +
        '<span class="stamp-badge" style="border-color:' + statusColor + '; color:' + statusColor + ';">' +
          agentEscapeHtml(String(status).toUpperCase()) +
        '</span>' +
      '</div>' +
      primaryHtml +
      trustHtml +
    '</div>';
  }).join("");
}

// ==========================================================================
// LOAD AGENT SCREEN (composite)
// ==========================================================================

async function loadAgentScreen() {
  if (!isCurrentUserAgent()) return;
  await loadAgentProfile();
  await loadAgentDistributorAttachments();
  await loadAgentRelationships();
}

function initAgentScreen() {
  if (!isCurrentUserAgent()) return;
  loadAgentScreen();
}

// ==========================================================================
// SCREEN LOADER REGISTRATION (Phase 2.3)
// ==========================================================================

(function registerAgentScreen() {
  if (typeof registerScreenLoader !== "function") {
    console.warn("[GoodsbarnX/agent] registerScreenLoader unavailable; agent screen has no loader.");
    return;
  }
  registerScreenLoader("agent", function agentLoader() {
    return loadAgentScreen();
  });
})();

// ==========================================================================
// AUTH EVENT LISTENERS
//
// Coordinated with relationship.js's listener; both act on the same
// auth-state-changed event, but they write to distinct DOM. No conflict.
// ==========================================================================

window.addEventListener("auth-state-changed", function (event) {
  if (event.detail?.user && isCurrentUserAgent()) {
    loadAgentScreen();
  }
});

// ==========================================================================
// GLOBAL EXPORTS
// ==========================================================================

window.initAgentScreen                  = initAgentScreen;
window.loadAgentScreen                  = loadAgentScreen;
window.loadAgentProfile                 = loadAgentProfile;
window.loadAgentDistributorAttachments  = loadAgentDistributorAttachments;
window.loadAgentRelationships           = loadAgentRelationships;
window.renderAgentTools                 = renderAgentTools;
window.renderAgentRelationships         = renderAgentRelationships;
window.openAgentAttachmentModal         = openAgentAttachmentModal;
window.closeAgentAttachmentModal        = closeAgentAttachmentModal;
window.submitAgentAttachmentRequest     = submitAgentAttachmentRequest;
window.requestAttachmentToDistributor   = requestAttachmentToDistributor;
window.openAgentReferralModal           = openAgentReferralModal;
window.closeAgentReferralModal          = closeAgentReferralModal;
window.searchBuyersForAgentReferral     = searchBuyersForAgentReferral;

console.log("[GoodsbarnX] agent.js loaded.");
