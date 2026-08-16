// ==========================================================================
// GoodsbarnX — staff.js
// Distributor-only: invite staff by email, approve/deactivate.
// Plain global script — depends on js/config.js (for `sb`) and global
// `currentUser` (js/auth.js) being loaded first.
// Uses the existing static-modal pattern (#invite-staff-modal in index.html),
// same as inquiry/dispute/add-product modals — no separate UI.renderModal
// helper, consistent with the rest of the app.
// ==========================================================================

async function loadStaff() {
  if (!currentUser || currentUser.role !== "distributor") {
    document.getElementById("staff-list").innerHTML = '<div class="loading-text">Only distributors can manage staff.</div>';
    return;
  }

  const { data: staff } = await sb.from("staff_invitations")
    .select("*")
    .eq("distributor_id", currentUser.id)
    .order("created_at", { ascending: false });

  const container = document.getElementById("staff-list");

  if (!staff || staff.length === 0) {
    container.innerHTML = '<div class="loading-text">No staff members yet.</div>';
    return;
  }

  container.innerHTML = staff.map(s => `
    <div class="manifest">
      <div class="manifest-top">
        <div>
          <div class="m-name">${s.email}</div>
          <div class="m-loc">${s.role} · ${s.status}</div>
        </div>
        <span class="stamp-badge" style="border-color:${s.status === "active" ? "var(--ok)" : "var(--stamp)"}; color:${s.status === "active" ? "var(--ok)" : "var(--stamp)"};">
          ${s.status.toUpperCase()}
        </span>
      </div>
      <div class="action-buttons">
        ${s.status === "pending" ? `<button class="btn btn-success" onclick="respondStaffInvite('${s.id}', 'active')">Approve</button>` : ""}
        <button class="btn btn-danger" onclick="respondStaffInvite('${s.id}', 'inactive')">${s.status === "active" ? "Deactivate" : "Remove"}</button>
      </div>
    </div>
  `).join("");
}

function openInviteStaffModal() {
  document.getElementById("invite-staff-modal").classList.add("active");
}

function closeInviteStaffModal() {
  document.getElementById("invite-staff-modal").classList.remove("active");
}

async function sendStaffInvite() {
  const email = document.getElementById("staff-email").value;
  const role = document.getElementById("staff-role").value;

  if (!email) {
    document.getElementById("invite-staff-status").innerText = "Enter email.";
    return;
  }

  const { error } = await sb.from("staff_invitations").insert({
    distributor_id: currentUser.id,
    email,
    role,
    status: "pending"
  });

  if (error) {
    document.getElementById("invite-staff-status").innerText = "Error: " + error.message;
  } else {
    document.getElementById("invite-staff-status").innerText = "Invitation sent!";
    setTimeout(() => {
      closeInviteStaffModal();
      loadStaff();
    }, 1500);
  }
}

async function respondStaffInvite(staffId, status) {
  await sb.from("staff_invitations").update({ status }).eq("id", staffId);
  await loadStaff();
}
