class Staff {
  static async render(container) {
    if (!state.currentUser || state.currentUser.role !== "distributor") {
      container.innerHTML = `
        <div class="screen active">
          <div class="loading-text">Only distributors can manage staff.</div>
        </div>
      `;
      return;
    }
    
    container.innerHTML = `
      <div class="screen active">
        <div class="section-label">Team Management</div>
        <div id="staff-list">
          <div class="loading-text">Loading staff...</div>
        </div>
        <button class="btn btn-primary btn-block" style="margin-bottom:8px;" onclick="Staff.openInviteModal()">
          + Invite Staff Member
        </button>
        <div id="staff-error" class="status-msg"></div>
      </div>
    `;
    
    await this.loadStaff();
  }
  
  static async loadStaff() {
    const { data: staff } = await sb.from("staff_members")
      .select("*")
      .eq("distributor_id", state.currentUser.id)
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
          <span class="badge badge-stamp" style="border-color:${s.status === "active" ? "var(--ok)" : "var(--stamp)"}; color:${s.status === "active" ? "var(--ok)" : "var(--stamp)"};">
            ${s.status.toUpperCase()}
          </span>
        </div>
        <div class="action-buttons">
          ${s.status === "pending" ? `
            <button class="btn btn-success" onclick="Staff.respondInvite('${s.id}', 'active')">Approve</button>
          ` : ""}
          <button class="btn btn-danger" onclick="Staff.respondInvite('${s.id}', 'inactive')">
            ${s.status === "active" ? "Deactivate" : "Remove"}
          </button>
        </div>
      </div>
    `).join("");
  }
  
  static openInviteModal() {
    const modalHtml = `
      <div class="sheet-overlay active" id="invite-staff-modal">
        <div class="sheet">
          <div class="sheet-handle"></div>
          <h3>Invite a team member</h3>
          <div class="sub">They'll receive an email to set up their account.</div>
          
          <div class="field">
            <label>Staff email</label>
            <input type="email" id="staff-email" />
          </div>
          
          <div class="field">
            <label>Role</label>
            <select id="staff-role">
              <option value="responder">Responder</option>
              <option value="manager">Manager</option>
            </select>
          </div>
          
          <button class="btn btn-primary btn-block" onclick="Staff.sendInvite()">Send invitation</button>
          <button class="btn btn-outline btn-block" onclick="Staff.closeInviteModal()">Cancel</button>
          <div class="status-msg" id="invite-staff-status"></div>
        </div>
      </div>
    `;
    
    UI.renderModal(modalHtml);
  }
  
  static closeInviteModal() {
    UI.renderModal("");
  }
  
  static async sendInvite() {
    const email = document.getElementById("staff-email").value;
    const role = document.getElementById("staff-role").value;
    
    if (!email) {
      document.getElementById("invite-staff-status").innerText = "Enter email.";
      return;
    }
    
    const { error } = await sb.from("staff_members").insert({
      distributor_id: state.currentUser.id,
      email,
      role,
      status: "pending"
    });
    
    if (error) {
      document.getElementById("invite-staff-status").innerText = "Error: " + error.message;
    } else {
      document.getElementById("invite-staff-status").innerText = "Invitation sent!";
      setTimeout(() => {
        this.closeInviteModal();
        this.render(document.getElementById("main-content"));
      }, 1500);
    }
  }
  
  static async respondInvite(staffId, status) {
    await sb.from("staff_members").update({ status }).eq("id", staffId);
    await this.loadStaff();
  }
}
