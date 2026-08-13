class Trust {
  static async render(container) {
    container.innerHTML = `
      <div class="screen active">
        <div class="section-label">Trust & Transparency</div>
        <div id="trust-summary" class="trust-strip" style="margin-bottom:16px;">
          <div class="loading-text">Loading trust data...</div>
        </div>
        <div class="section-label">Verified Distributors</div>
        <div id="verified-distributors-list">
          <div class="loading-text">Loading...</div>
        </div>
        <div class="section-label">Recent Approved Disputes</div>
        <div id="disputes-list">
          <div class="loading-text">Loading...</div>
        </div>
      </div>
    `;
    
    await this.loadData();
  }
  
  static async loadData() {
    // Fetch distributors
    const { data: distributors } = await sb.from("distributor_profiles")
      .select("id, business_name, verification_tier")
      .order("created_at", { ascending: false });
    
    // Fetch disputes
    const { data: disputes } = await sb.from("disputes")
      .select("id, distributor_id, description, status, created_at")
      .eq("status", "Approved")
      .order("created_at", { ascending: false })
      .limit(10);
    
    this.renderSummary(distributors);
    this.renderVerified(distributors);
    this.renderDisputes(disputes, distributors);
  }
  
  static renderSummary(distributors) {
    const total = distributors?.length || 0;
    const verified = distributors?.filter(d => 
      d.verification_tier === "association" || d.verification_tier === "market board"
    ).length || 0;
    const selfAttested = total - verified;
    
    document.getElementById("trust-summary").innerHTML = `
      <div class="trust-item">
        <div class="n">${total}</div>
        <div class="t">Total</div>
      </div>
      <div class="trust-item">
        <div class="n" style="color:var(--ok);">${verified}</div>
        <div class="t">Verified</div>
      </div>
      <div class="trust-item">
        <div class="n" style="color:var(--brass-dark);">${selfAttested}</div>
        <div class="t">Self-Attested</div>
      </div>
    `;
  }
  
  static renderVerified(distributors) {
    const verified = distributors?.filter(d => 
      d.verification_tier === "association" || d.verification_tier === "market board"
    ) || [];
    
    const container = document.getElementById("verified-distributors-list");
    
    if (!verified.length) {
      container.innerHTML = '<div class="loading-text">No verified distributors yet.</div>';
      return;
    }
    
    container.innerHTML = verified.map(d => `
      <div class="manifest">
        <div class="manifest-top">
          <div>
            <div class="m-name">${d.business_name}</div>
            <div class="m-loc">${
              d.verification_tier === "association" ? "Association Verified" : "Market Board Verified"
            }</div>
          </div>
          <span style="color:var(--ok); font-size:20px;">✓</span>
        </div>
      </div>
    `).join("");
  }
  
  static renderDisputes(disputes, distributors) {
    const container = document.getElementById("disputes-list");
    
    if (!disputes?.length) {
      container.innerHTML = '<div class="loading-text">No approved disputes.</div>';
      return;
    }
    
    container.innerHTML = disputes.map(d => {
      const distributor = distributors?.find(x => x.id === d.distributor_id);
      return `
        <div class="manifest">
          <div class="manifest-top">
            <div>
              <div class="m-name">${distributor?.business_name || "Unknown"}</div>
              <div class="m-loc">${d.description || "No details"}</div>
            </div>
            <span class="badge badge-stamp" style="border-color:var(--stamp); color:var(--stamp); font-size:9px;">
              DISPUTE
            </span>
          </div>
        </div>
      `;
    }).join("");
  }
  
  static openDisputeModal(distributorId, distributorName) {
    const modalHtml = `
      <div class="sheet-overlay active" id="dispute-modal">
        <div class="sheet">
          <div class="sheet-handle"></div>
          <h3>Report an issue</h3>
          <div class="sub">About ${distributorName}.</div>
          
          <div class="field">
            <label>Your name</label>
            <input type="text" id="dispute-submitted-by" value="${state.currentUser?.full_name || ""}" />
          </div>
          
          <div class="field">
            <label>Your phone</label>
            <input type="tel" id="dispute-phone" value="${state.currentUser?.phone || ""}" />
          </div>
          
          <div class="field">
            <label>What happened</label>
            <input type="text" id="dispute-description" />
          </div>
          
          <button class="btn btn-primary btn-block" onclick="Trust.submitDispute('${distributorId}')">
            Submit for review
          </button>
          <button class="btn btn-outline btn-block" onclick="Trust.closeDisputeModal()">Cancel</button>
          <div class="status-msg" id="dispute-status-msg"></div>
        </div>
      </div>
    `;
    
    UI.renderModal(modalHtml);
  }
  
  static closeDisputeModal() {
    UI.renderModal("");
  }
  
  static async submitDispute(distributorId) {
    const submittedBy = document.getElementById("dispute-submitted-by").value;
    const phone = document.getElementById("dispute-phone").value;
    const description = document.getElementById("dispute-description").value;
    
    if (!submittedBy || !phone || !description) {
      document.getElementById("dispute-status-msg").innerText = "Fill all fields.";
      return;
    }
    
    const { error } = await sb.from("disputes").insert({
      distributor_id: distributorId,
      submitted_by: submittedBy,
      submitted_phone: phone,
      description: description,
      status: "Pending"
    });
    
    if (error) {
      document.getElementById("dispute-status-msg").innerText = "Error: " + error.message;
    } else {
      document.getElementById("dispute-status-msg").innerText = "Submitted for review!";
      setTimeout(() => this.closeDisputeModal(), 1800);
    }
  }
}
