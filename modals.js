// ---------- Distributor tools ----------
function showDistributorTools() {
  const holder = document.getElementById("distributor-tools-holder");
  holder.innerHTML = `
    <div class="distributor-tools">
      <div class="dt-title">Bring your own buyer</div>
      <div class="dt-sub">Connect a buyer you already know. They'll confirm before anything is locked.</div>
      <button onclick="openAddBuyerModal('distributor')">Add a buyer</button>
    </div>`;
}

async function showAgentTools() {
  const holder = document.getElementById("distributor-tools-holder");
  const { data: agentProfile } = await sb.from("agent_profiles").select("employment_confirmed, companies(name)").eq("id", currentUser.id).single();
  const confirmed = agentProfile && agentProfile.employment_confirmed;
  const companyName = agentProfile && agentProfile.companies ? agentProfile.companies.name : "your company";
  if (confirmed) {
    holder.innerHTML = `
      <div class="distributor-tools">
        <div class="dt-title">Attach to a distributor</div>
        <div class="dt-sub">Propose a relationship. The distributor must accept before it's active.</div>
        <button onclick="openAttachModal()">Attach to a distributor</button>
      </div>
      <div class="distributor-tools" style="margin-top:12px;">
        <div class="dt-title">Add a buyer to your distributor</div>
        <div class="dt-sub">Bring a buyer you're working with. They'll be connected directly to your attached distributor.</div>
        <button onclick="openAddBuyerModal('agent')">Add a buyer</button>
      </div>`;
  } else {
    holder.innerHTML = `
      <div class="distributor-tools">
        <div class="dt-title">Employment pending confirmation</div>
        <div class="dt-sub">We're confirming your employment with ${companyName}. You'll be able to attach to distributors and add buyers once that's verified.</div>
      </div>`;
  }
}

// ---------- Attach modal ----------
function openAttachModal() {
  document.getElementById("attach-distributor-name").value = "";
  document.getElementById("attach-status-msg").innerText = "";
  document.getElementById("attach-modal").classList.add("active");
}
function closeAttachModal() { document.getElementById("attach-modal").classList.remove("active"); }

async function submitAttach() {
  const distName = document.getElementById("attach-distributor-name").value;
  const statusEl = document.getElementById("attach-status-msg");
  if (!distName) { statusEl.innerText = "Please enter the distributor's business name."; return; }
  const { data: match } = await sb.from("distributor_profiles").select("id").ilike("business_name", distName).maybeSingle();
  if (!match) { statusEl.innerText = "No distributor found with that exact name."; return; }
  const { error } = await sb.from("agent_distributor_attachments").insert({ agent_id: currentUser.id, distributor_id: match.id, status: "pending" });
  if (error) { statusEl.innerText = "Could not send request. You may already be attached."; return; }
  statusEl.innerText = "Sent! Waiting on the distributor to accept.";
  setTimeout(closeAttachModal, 1800);
}

// ---------- Pending attachment requests (distributor sees this) ----------
async function checkPendingAttachments() {
  const { data: pending } = await sb.from("agent_distributor_attachments").select("id, agent_id, profiles!agent_distributor_attachments_agent_id_fkey(full_name)").eq("distributor_id", currentUser.id).eq("status", "pending");
  if (!pending || pending.length === 0) return;
  const holder = document.getElementById("lock-banner-holder");
  const rows = pending.map(p => {
    const agentName = p.profiles ? p.profiles.full_name : "An agent";
    return `<div style="padding:8px 0; border-bottom:1px dashed rgba(63,122,78,0.3);"><div style="font-size:12.5px; color:var(--paper); margin-bottom:6px;">${agentName} wants to attach as your supplier agent.</div><button onclick="respondAttachment('${p.id}','accepted')" style="margin-right:8px;">Accept</button><button onclick="respondAttachment('${p.id}','declined')" style="background:none; border:1.3px solid rgba(239,233,222,0.3); color:rgba(239,233,222,0.6);">Decline</button></div>`;
  }).join("");
  holder.innerHTML = `<div class="lock-banner"><div class="lb-title">Agent requests</div>${rows}</div>`;
}

async function respondAttachment(id, decision) {
  await sb.from("agent_distributor_attachments").update({ status: decision }).eq("id", id);
  checkPendingAttachments();
}

// ---------- Add buyer (distributor or agent) ----------
let addBuyerMode = "";
function openAddBuyerModal(mode) {
  addBuyerMode = mode;
  document.getElementById("add-buyer-phone").value = "";
  document.getElementById("add-buyer-status-msg").innerText = "";
  document.getElementById("add-buyer-modal").classList.add("active");
  const submitBtn = document.getElementById("add-buyer-submit-btn");
  submitBtn.onclick = (mode === "agent") ? submitAgentAddBuyer : submitDistributorAddBuyer;
}
function closeAddBuyerModal() { document.getElementById("add-buyer-modal").classList.remove("active"); }

async function submitDistributorAddBuyer() {
  const phone = document.getElementById("add-buyer-phone").value;
  const statusEl = document.getElementById("add-buyer-status-msg");
  if (!phone) { statusEl.innerText = "Please enter a phone number."; return; }
  const { data: matchingProfile } = await sb.from("profiles").select("id, role").eq("phone", phone).eq("role", "buyer").single();
  if (!matchingProfile) { statusEl.innerText = "No buyer account found with that phone number yet. They'll need to sign up first."; return; }
  const { error } = await sb.from("buyer_locks").insert({ buyer_id: matchingProfile.id, distributor_id: currentUser.id, status: "pending_consent" });
  if (error) { statusEl.innerText = "Could not send request. They may already be connected elsewhere."; return; }
  statusEl.innerText = "Sent! They'll see this request next time they open ShelfMatch.";
  setTimeout(closeAddBuyerModal, 1800);
}

async function submitAgentAddBuyer() {
  const phone = document.getElementById("add-buyer-phone").value;
  const statusEl = document.getElementById("add-buyer-status-msg");
  if (!phone) { statusEl.innerText = "Please enter a phone number."; return; }
  const { data: attachment } = await sb.from("agent_distributor_attachments").select("distributor_id").eq("agent_id", currentUser.id).eq("status", "accepted").order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!attachment) { statusEl.innerText = "You don't have an accepted distributor attachment yet. Please attach to a distributor first."; return; }
  const distributorId = attachment.distributor_id;
  const { data: matchingProfile } = await sb.from("profiles").select("id, role").eq("phone", phone).eq("role", "buyer").single();
  if (!matchingProfile) { statusEl.innerText = "No buyer account found with that phone number yet. They'll need to sign up first."; return; }
  const { error } = await sb.from("buyer_locks").insert({ buyer_id: matchingProfile.id, distributor_id: distributorId, agent_id: currentUser.id, status: "pending_consent" });
  if (error) { statusEl.innerText = "Could not send request. They may already be connected elsewhere."; return; }
  statusEl.innerText = "Sent! They'll see this request next time they open ShelfMatch.";
  setTimeout(closeAddBuyerModal, 1800);
}

// ---------- Buyer lock check & consent ----------
let pendingLockId = "";
async function checkBuyerLock() {
  const { data: pendingLock } = await sb.from("buyer_locks").select("id, distributor_id, distributor_profiles(business_name)").eq("buyer_id", currentUser.id).eq("status", "pending_consent").maybeSingle();
  if (pendingLock) {
    pendingLockId = pendingLock.id;
    const distName = pendingLock.distributor_profiles ? pendingLock.distributor_profiles.business_name : "A distributor";
    document.getElementById("consent-sub").innerText = distName + " wants to connect you as their buyer. You'll be primarily connected to them, but can still browse everyone else.";
    document.getElementById("consent-modal").classList.add("active");
    return;
  }
  const { data: lock } = await sb.from("buyer_locks").select("id, status, distributor_id, distributor_profiles(business_name)").eq("buyer_id", currentUser.id).in("status", ["active", "release_requested"]).maybeSingle();
  if (!lock) return;
  const holder = document.getElementById("lock-banner-holder");
  const distName = lock.distributor_profiles ? lock.distributor_profiles.business_name : "a distributor";
  if (lock.status === "active") {
    holder.innerHTML = `<div class="lock-banner"><div class="lb-title">Connected to ${distName}</div><div class="lb-sub">You can browse everyone, but you're primarily connected to this distributor.</div><button onclick="requestRelease('${lock.id}')">Request open-market access</button></div>`;
  } else if (lock.status === "release_requested") {
    holder.innerHTML = `<div class="lock-banner"><div class="lb-title">Release requested</div><div class="lb-sub">Waiting on ${distName} to approve your open-market access. You'll keep your connection to them either way.</div></div>`;
  }
}

async function requestRelease(lockId) { await sb.from("buyer_locks").update({ status: "release_requested" }).eq("id", lockId); checkBuyerLock(); }
async function acceptLock() { await sb.from("buyer_locks").update({ status: "active" }).eq("id", pendingLockId); document.getElementById("consent-modal").classList.remove("active"); checkBuyerLock(); }
async function declineLock() { await sb.from("buyer_locks").delete().eq("id", pendingLockId); document.getElementById("consent-modal").classList.remove("active"); }
