class Profile {
  static async render(container) {
    if (!state.currentUser) {
      container.innerHTML = `
        <div class="screen active">
          <div class="loading-text">Please log in to view your profile.</div>
        </div>
      `;
      return;
    }
    
    const isDistributor = state.currentUser.role === "distributor";
    
    container.innerHTML = `
      <div class="screen active">
        <div class="section-label">Your Profile</div>
        <div id="profile-saved-banner" style="display:none; background:var(--ok); color:white; padding:8px; border-radius:8px; text-align:center; margin-bottom:12px;">
          Profile saved successfully!
        </div>
        
        <div id="profile-form">
          ${isDistributor ? `
            <div class="field">
              <label>Business Name</label>
              <input type="text" id="profile-business-name" placeholder="Your business name" />
            </div>
            <div class="field">
              <label>Category</label>
              <select id="profile-category">
                <option value="">Select category</option>
                ${CATEGORIES.map(cat => `<option value="${cat}">${cat}</option>`).join("")}
              </select>
            </div>
          ` : `
            <div class="field">
              <label>Your Name</label>
              <input type="text" id="profile-name" placeholder="Your full name" />
            </div>
            <div class="field">
              <label>I'm looking for</label>
              <select id="profile-looking-for">
                <option value="">Select interest</option>
                ${CATEGORIES.map(cat => `<option value="${cat}">${cat}</option>`).join("")}
              </select>
            </div>
          `}
          
          <div class="field">
            <label>Location</label>
            <select id="profile-location">
              <option value="">Select location</option>
              ${LOCATIONS.map(loc => `<option value="${loc}">${loc}</option>`).join("")}
            </select>
          </div>
          
          <div class="field">
            <label>Market</label>
            <input type="text" id="profile-market" placeholder="Which market?" />
          </div>
          
          <div class="field">
            <label>Shop Address</label>
            <input type="text" id="profile-shop-address" placeholder="Street address or landmark" />
          </div>
          
          <div class="field">
            <label>Description</label>
            <textarea id="profile-description" rows="3" placeholder="Brief description"></textarea>
          </div>
          
          <button class="btn btn-primary btn-block" onclick="Profile.save()">Save Profile</button>
          <div class="status-msg" id="profile-status"></div>
        </div>
      </div>
    `;
    
    await this.load();
  }
  
  static async load() {
    const isDistributor = state.currentUser.role === "distributor";
    const table = isDistributor ? "distributor_profiles" : "buyer_profiles";
    
    const { data } = await sb.from(table)
      .select("*")
      .eq("id", state.currentUser.id)
      .single();
    
    if (data) {
      const fields = isDistributor ? {
        "profile-business-name": data.business_name,
        "profile-category": data.category,
        "profile-location": data.location,
        "profile-market": data.market,
        "profile-shop-address": data.shop_address,
        "profile-description": data.description
      } : {
        "profile-name": data.name,
        "profile-looking-for": data.looking_for,
        "profile-location": data.location,
        "profile-market": data.market,
        "profile-shop-address": data.shop_address,
        "profile-description": data.description
      };
      
      Object.entries(fields).forEach(([id, value]) => {
        const el = document.getElementById(id);
        if (el && value) el.value = value;
      });
    }
  }
  
  static async save() {
    const isDistributor = state.currentUser.role === "distributor";
    const table = isDistributor ? "distributor_profiles" : "buyer_profiles";
    
    const payload = isDistributor ? {
      business_name: document.getElementById("profile-business-name").value,
      category: document.getElementById("profile-category").value,
      location: document.getElementById("profile-location").value,
      market: document.getElementById("profile-market").value,
      shop_address: document.getElementById("profile-shop-address").value,
      description: document.getElementById("profile-description").value
    } : {
      name: document.getElementById("profile-name").value,
      looking_for: document.getElementById("profile-looking-for").value,
      location: document.getElementById("profile-location").value,
      market: document.getElementById("profile-market").value,
      shop_address: document.getElementById("profile-shop-address").value,
      description: document.getElementById("profile-description").value
    };
    
    const { error } = await sb.from(table)
      .update(payload)
      .eq("id", state.currentUser.id);
    
    if (error) {
      document.getElementById("profile-status").innerText = "Error saving profile.";
    } else {
      state.currentUser = { ...state.currentUser, ...payload };
      const banner = document.getElementById("profile-saved-banner");
      banner.style.display = "block";
      setTimeout(() => banner.style.display = "none", 3000);
    }
  }
}
