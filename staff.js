// GoodsbarnX – Staff Management Module

document.addEventListener("screenChanged", (e) => {
  if (e.detail.screen === "staff") loadStaffList();
});

async function loadStaffList() {
  if (!currentUser || currentUser.role !== "distributor") return;

  const { data: invitations, error } = await sb.from("staff_invitations").select("*").eq("distributor_id", currentUser.id);
  if (error) return;

  const list = document.getElementById("staff-list");
  if (!list) return;

  if (invitations.length === 0) {
    list.innerHTML = '<div class="loading-text">No staff members yet. Invite your first team member.</div>';
    return;
  }

  list.innerHTML = invitations.map(inv => `
    <div class="manifest">
      <div class="manifest-top">
        <div>
          <div class="m-name">${inv.email}</div>
          <div class="m-loc">${inv.role} · ${inv.status}</div>
        </div>
        ${inv.status === "accepted" ? '<span style="color:var(--ok); font-weight:700;">Active</span>' : '<span style="color:var(--brass-dark);">Pending</span>'}
      </div>
    </div>
  `).join("");
}

function openInviteStaffModal() {
  document.getElementById("staff-email").value = "";
  document.getElementById("invite-staff-status").innerText = "";
  document.getElementById("invite-staff-modal").classList.add("active");
}

function closeInviteStaffModal() {
  document.getElementById("invite-staff-modal").classList.remove("active");
}

async function sendStaffInvite() {
  const email = document.getElementById("staff-email").value;
  const role = document.getElementById("staff-role").value;
  const statusEl = document.getElementById("invite-staff-status");

  if (!email) {
    statusEl.innerText = "Please enter an email address.";
    return;
  }

  // Check subscription plan
  const { data: sub } = await sb.from("subscriptions").select("plan_id").eq("user_id", currentUser.id).eq("status", "active").maybeSingle();
  if (!sub || (sub.plan_id !== "business" && sub.plan_id !== "enterprise")) {
    statusEl.innerText = "Staff management requires a Business or Enterprise plan. Upgrade now.";
    return;
  }

  const { error } = await sb.from("staff_invitations").insert({
    distributor_id: currentUser.id,
    email: email,
    role: role,
    status: "pending"
  });

  if (error) {
    if (error.message.includes("duplicate")) statusEl.innerText = "An invitation has already been sent to this email.";
    else if (error.message.includes("Business plan allows up to 5")) statusEl.innerText = "You've reached the maximum of 5 staff members for your Business plan.";
    else statusEl.innerText = error.message;
    return;
  }

  statusEl.innerText = "Invitation sent!";
  setTimeout(closeInviteStaffModal, 2000);
  loadStaffList();
}
