// GoodsbarnX – Buyer Lock, Release & Agent Attachment Requests

let pendingLockId = "";
let pendingLockDistributorId = null;
let pendingLockDistributorName = null;

document.addEventListener("userLoaded", () => {
  if (!currentUser) return;
  if (currentUser.role === "distributor") {
    showDistributorTools();
    checkPendingAttachments();
    checkReleaseRequests();
  } else if (currentUser.role === "buyer") {
    checkBuyerLock();
  } else if (currentUser.role === "agent") {
    showAgentTools();
  }
});

// ---------- Distributor Tools ----------
function showDistributorTools() {
  const holder = document.getElementById("distributor-tools-holder");
  if (!holder) return;
  holder.innerHTML = `
    <div class="distributor-tools">
      <div class="dt-title">Bring your own buyer</div>
      <div class="dt-sub">Connect a buyer you already know. They'll confirm before anything is locked.</div>
      <button onclick="openAddBuyerModal('distributor')">Add a buyer</button>
    </div>`;
}

// ---------- Agent Tools ----------
async function showAgentTools() {
  const holder = document.getElementById("distributor-tools-holder");
  if (!holder) return;

  const { data: agentProfile } = await sb.from("agent_profiles").select("employment_confirmed, companies(name)").eq("id", currentUser.id).single();
  const confirmed = agentProfile && agentProfile.employment_confirmed;
  const companyName = (agentProfile && agentProfile.companies) ? agentProfile.companies.name : "your company";

  if (confirmed) {
    const { count: attachmentsCount } = await sb.from("agent_distributor_attachments").select("*", { count: "exact", head: true }).eq("agent_id", currentUser.id).eq("status", "accepted");
    const { count: buyersCount } = await sb.from("buyer_locks").select("*", { count: "exact", head: true }).eq("agent_id", currentUser.id).eq("status", "active");

    let limitText = "";
    const { data: sub } = await sb.from("subscriptions").select("plan_id").eq("user_id", currentUser.id).eq("status", "active").maybeSingle();
    const isFree = !sub || sub.plan_id === "free";
    if (isFree) {
      limitText = `<div class="dt-sub" style="margin-bottom:8px;">Free plan: ${attachmentsCount}/1 distributor, ${buyersCount}/1 buyer connection. <a onclick="showScreen('upgrade')" style="color:var(--brass-bright); text-decoration:underline;">Upgrade</a></div>`;
    }

    holder.innerHTML = `
      <div class="distributor-tools">
        <div class="dt-title">Attach to a distributor</div>
        ${limitText}
        <button onclick="openAttachModal()">Attach to a distributor</button>
      </div>
      <div class="distributor-tools" style="margin-top:12px;">
        <div class="dt-title">Add a buyer to your distributor</div>
        <button onclick="openAddBuyerModal('agent')">Add a buyer</button>
      </div>`;
  } else {
    holder.innerHTML = `
      <div class="distributor-tools">
        <div class="dt-title">Employment pending confirmation</div>
        <div class="dt-sub">We're confirming your employment with ${companyName}.</div>
      </div>`;
  }
}

// ---------- Attach Modal ----------
function openAttachModal() {
  document.getElementById("attach-distributor-name").value = "";
  document.getElementById("attach-status-msg").innerText = "";
  document.getElementById("attach-modal").classList.add("active");
}

function closeAttachModal() {
  document.getElementById("attach-modal").classList.remove("active");
}

async function submitAttach() {
  const distName = document.getElementById("attach-distributor-name").value;
  const statusEl = document.getElementById("attach-status-msg");
  if (!distName) { statusEl.innerText = "Please enter the distributor's business name."; return; }

  // Free agent limit check
  if (currentUser && currentUser.role === "agent") {
    const { data: currentSub } = await sb.from("subscriptions").select("plan_id").eq("user_id", currentUser.id).eq("status", "active").maybeSingle();
    if (!currentSub || currentSub.plan_id === "free") {
      const { count } = await sb.from("agent_distributor_attachments").select("*", { count: "exact", head: true }).eq("agent_id", currentUser.id).eq("status", "accepted");
      if (count >= 1) { statusEl.innerText = "Free plan limit: only one distributor attachment allowed. Upgrade to Pro for unlimited."; return; }
    }
  }

  const { data: match } = await sb.from("distributor_profiles").select("id").ilike("business_name", distName).maybeSingle();
  if (!match) { statusEl.innerText = "No distributor found with that exact name."; return; }

  const { error } = await sb.from("agent_distributor_attachments").insert({ agent_id: currentUser.id, distributor_id: match.id, status: "pending" });
  if (error) { statusEl.innerText = error.message.includes("Free agents") ? error.message : "Could not send request. You may already be attached."; return; }
  statusEl.innerText = "Sent! Waiting on the distributor to accept.";
  setTimeout(closeAttachModal, 1800);
}

// ---------- Pending Agent Attachments (Distributor View) ----------
async function checkPendingAttachments() {
  const { data: pending } = await sb.from("agent_distributor_attachments").select("id, agent_id, profiles!agent_distributor_attachments_agent_id_fkey(full_name)").eq("distributor_id", currentUser.id).eq("status", "pending");
  const holder = document.getElementById("lock-banner-holder");
  if (!pending || pending.length === 0) return;

  const rows = pending.map(p => {
    const agentName = (p.profiles && p.profiles.full_name) ? p.profiles.full_name : "An agent";
    return `<div style="padding:8px 0; border-bottom:1px dashed rgba(63,122,78,0.3);"><div style="font-size:12.5px; color:var(--paper); margin-bottom:6px;">${agentName} wants to attach as your supplier agent.</div><div class="action-buttons"><button class="btn-accept" onclick="respondAttachment('${p.id}','accepted')">Accept</button><button class="btn-decline" onclick="respondAttachment('${p.id}','declined')">Decline</button><button class="btn-message" onclick="messageAboutAttachment('${agentName}','${p.agent_id}')">Message</button></div></div>`;
  }).join("");

  holder.innerHTML += `<div class="lock-banner"><div class="lb-title">Agent Requests</div>${rows}</div>`;
}

async function respondAttachment(id, decision) {
  await sb.from("agent_distributor_attachments").update({ status: decision }).eq("id", id);
  document.getElementById("lock-banner-holder").innerHTML = "";
  checkPendingAttachments();
  checkReleaseRequests();
}

function messageAboutAttachment(agentName, agentId) {
  document.getElementById("modal-title").innerText = "Message " + agentName;
  document.getElementById("inquiry-item").value = "Regarding your attachment request";
  document.getElementById("inquiry-modal").classList.add("active");
}

// ---------- Add Buyer Modal ----------
let addBuyerMode = "";

function openAddBuyerModal(mode) {
  addBuyerMode = mode;
  document.getElementById("add-buyer-phone").value = "";
  document.getElementById("add-buyer-status-msg").innerText = "";
  document.getElementById("add-buyer-modal").classList.add("active");
  const submitBtn = document.getElementById("add-buyer-submit-btn");
  submitBtn.onclick = (mode === "agent") ? submitAgentAddBuyer : submitDistributorAddBuyer;
}

function closeAddBuyerModal() {
  document.getElementById("add-buyer-modal").classList.remove("active");
}

async function submitDistributorAddBuyer() {
  const phone = document.getElementById("add-buyer-phone").value;
  const statusEl = document.getElementById("add-buyer-status-msg");
  if (!phone) { statusEl.innerText = "Please enter a phone number."; return; }

  const { data: matchingProfile } = await sb.from("profiles").select("id, role").eq("phone", phone).eq("role", "buyer").single();
  if (!matchingProfile) { statusEl.innerText = "No buyer account found with that phone number yet."; return; }

  const { error } = await sb.from("buyer_locks").insert({ buyer_id: matchingProfile.id, distributor_id: currentUser.id, status: "pending_consent" });
  if (error) { statusEl.innerText = "Could not send request."; return; }
  statusEl.innerText = "Sent! They'll see this request next time they open GoodsbarnX.";
  setTimeout(closeAddBuyerModal, 1800);
}

async function submitAgentAddBuyer() {
  const phone = document.getElementById("add-buyer-phone").value;
  const statusEl = document.getElementById("add-buyer-status-msg");
  if (!phone) { statusEl.innerText = "Please enter a phone number."; return; }

  // Free agent limit check
  if (currentUser && currentUser.role === "agent") {
    const { data: currentSub } = await sb.from("subscriptions").select("plan_id").eq("user_id", currentUser.id).eq("status", "active").maybeSingle();
    if (!currentSub || currentSub.plan_id === "free") {
      const { count } = await sb.from("buyer_locks").select("*", { count: "exact", head: true }).eq("agent_id", currentUser.id).eq("status", "active");
      if (count >= 1) { statusEl.innerText = "Free plan limit: only one buyer connection allowed."; return; }
    }
  }

  const { data: attachment } = await sb.from("agent_distributor_attachments").select("distributor_id").eq("agent_id", currentUser.id).eq("status", "accepted").order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!attachment) { statusEl.innerText = "You need an accepted distributor attachment first."; return; }

  const distributorId = attachment.distributor_id;
  const { data: matchingProfile } = await sb.from("profiles").select("id, role").eq("phone", phone).eq("role", "buyer").single();
  if (!matchingProfile) { statusEl.innerText = "No buyer account found with that phone number yet."; return; }

  const { error } = await sb.from("buyer_locks").insert({ buyer_id: matchingProfile.id, distributor_id: distributorId, agent_id: currentUser.id, status: "pending_consent" });
  if (error) { statusEl.innerText = "Could not send request."; return; }
  statusEl.innerText = "Sent!";
  setTimeout(closeAddBuyerModal, 1800);
}

// ---------- Buyer Lock Check ----------
async function checkBuyerLock() {
  const { data: pendingLock } = await sb.from("buyer_locks").select("id, distributor_id, distributor_profiles(business_name)").eq("buyer_id", currentUser.id).eq("status", "pending_consent").maybeSingle();

  if (pendingLock) {
    pendingLockId = pendingLock.id;
    pendingLockDistributorId = pendingLock.distributor_id;
    pendingLockDistributorName = (pendingLock.distributor_profiles && pendingLock.distributor_profiles.business_name) ? pendingLock.distributor_profiles.business_name : "A distributor";

    document.getElementById("consent-sub").innerHTML = `${pendingLockDistributorName} wants to connect you as their buyer.<div class="action-buttons"><button class="btn-accept" onclick="acceptLock()">Accept</button><button class="btn-decline" onclick="declineLock()">Decline</button><button class="btn-message" onclick="messageAboutLock()">Message</button></div>`;
    document.getElementById("consent-modal").classList.add("active");
    return;
  }

  const { data: lock } = await sb.from("buyer_locks").select("id, status, distributor_id, distributor_profiles(business_name)").eq("buyer_id", currentUser.id).in("status", ["active", "release_requested"]).maybeSingle();

  const holder = document.getElementById("lock-banner-holder");
  if (!lock) { holder.innerHTML = ""; return; }

  const distName = (lock.distributor_profiles && lock.distributor_profiles.business_name) ? lock.distributor_profiles.business_name : "a distributor";

  if (lock.status === "active") {
    holder.innerHTML = `<div class="lock-banner"><div class="lb-title">Connected to ${distName}</div><div class="lb-sub">You can browse everyone, but you're primarily connected to this distributor.</div><button onclick="requestRelease('${lock.id}')">Request open-market access</button></div>`;
  } else if (lock.status === "release_requested") {
    holder.innerHTML = `<div class="lock-banner"><div class="lb-title">Release requested</div><div class="lb-sub">Waiting on ${distName}. You can cancel if you change your mind.</div><button onclick="cancelReleaseRequest('${lock.id}')">Cancel Release Request</button></div>`;
  }
}

async function acceptLock() {
  await sb.from("buyer_locks").update({ status: "active" }).eq("id", pendingLockId);
  document.getElementById("consent-modal").classList.remove("active");
  checkBuyerLock();
}

async function declineLock() {
  await sb.from("buyer_locks").delete().eq("id", pendingLockId);
  document.getElementById("consent-modal").classList.remove("active");
}

function messageAboutLock() {
  document.getElementById("consent-modal").classList.remove("active");
  if (pendingLockDistributorId && pendingLockDistributorName) {
    openModal(pendingLockDistributorId, pendingLockDistributorName, "distributor");
  }
}

async function requestRelease(lockId) {
  await sb.from("buyer_locks").update({ status: "release_requested" }).eq("id", lockId);
  checkBuyerLock();
}

async function cancelReleaseRequest(lockId) {
  await sb.from("buyer_locks").update({ status: "active" }).eq("id", lockId);
  checkBuyerLock();
}

// ---------- Release Requests (Distributor View) ----------
async function checkReleaseRequests() {
  const { data: requests } = await sb.from("buyer_locks").select("id, buyer_id, profiles!buyer_id(full_name)").eq("distributor_id", currentUser.id).eq("status", "release_requested");
  if (!requests || requests.length === 0) return;

  const holder = document.getElementById("lock-banner-holder");
  const rows = requests.map(r => {
    const buyerName = (r.profiles && r.profiles.full_name) ? r.profiles.full_name : "A buyer";
    return `<div style="padding:8px 0; border-bottom:1px dashed rgba(63,122,78,0.3);"><div style="font-size:12.5px; color:var(--paper); margin-bottom:6px;">${buyerName} has requested to be released.</div><div class="action-buttons"><button class="btn-accept" onclick="respondRelease('${r.id}')">Release</button><button class="btn-message" onclick="messageAboutRelease('${buyerName}','${r.buyer_id}')">Message</button></div></div>`;
  }).join("");

  holder.innerHTML += `<div class="lock-banner"><div class="lb-title">Release Requests</div>${rows}</div>`;
}

async function respondRelease(lockId) {
  await sb.from("buyer_locks").delete().eq("id", lockId);
  document.getElementById("lock-banner-holder").innerHTML = "";
  checkPendingAttachments();
  checkReleaseRequests();
}

function messageAboutRelease(buyerName, buyerId) {
  selectedContactId = buyerId;
  selectedContactName = buyerName;
  selectedContactType = "buyer";
  document.getElementById("modal-title").innerText = "Message " + buyerName;
  document.getElementById("inquiry-item").value = "Regarding your release request";
  document.getElementById("inquiry-modal").classList.add("active");
}
