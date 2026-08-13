class Upgrade {
  static async render(container) {
    const plans = [
      {
        id: "free",
        name: "Free",
        price: 0,
        features: ["Browse distributors", "Send 5 inquiries/day", "Basic profile"]
      },
      {
        id: "buyer_pro",
        name: "Buyer Pro",
        price: 2500,
        features: ["Unlimited inquiries", "Verified badge", "Priority support", "Advanced filters"]
      },
      {
        id: "distributor_pro",
        name: "Distributor Pro",
        price: 5000,
        features: ["Product listings", "Storefront", "Analytics", "Verified badge", "Priority placement"]
      },
      {
        id: "agent_pro",
        name: "Agent Pro",
        price: 7500,
        features: ["Unlimited attachments", "Multiple buyers", "Commission tracking", "Priority support"]
      }
    ];
    
    container.innerHTML = `
      <div class="screen active">
        <div class="section-label">Choose Your Plan</div>
        <div id="plan-cards" style="display:flex; flex-direction:column; gap:16px; margin-bottom:16px;">
          ${plans.map(plan => `
            <div style="background:var(--ink-2); border:1px solid ${plan.id === "free" ? "var(--line)" : "var(--brass)"}; border-radius:14px; padding:16px;">
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                <h3 style="font-size:16px;">${plan.name}</h3>
                <span style="font-size:18px; font-weight:700; color:var(--brass-bright);">
                  ${plan.price === 0 ? "Free" : "₦" + plan.price.toLocaleString() + "/mo"}
                </span>
              </div>
              <ul style="list-style:none; padding:0; margin:8px 0;">
                ${plan.features.map(f => `
                  <li style="padding:4px 0; font-size:12px; color:rgba(239,233,222,0.7);">✓ ${f}</li>
                `).join("")}
              </ul>
              ${plan.id !== "free" ? `
                <button class="btn btn-primary btn-block" onclick="Upgrade.upgradeToPlan('${plan.id}', ${plan.price})">
                  Upgrade
                </button>
              ` : `
                <div style="text-align:center; padding:8px; font-size:12px; color:rgba(239,233,222,0.5);">
                  Current plan
                </div>
              `}
            </div>
          `).join("")}
        </div>
        
        <div class="section-label">Current Plan</div>
        <div id="current-plan-info" class="manifest" style="padding:14px;">
          <div class="loading-text">Loading...</div>
        </div>
        <div id="upgrade-status" class="status-msg"></div>
      </div>
    `;
    
    await this.loadCurrentPlan(plans);
  }
  
  static async loadCurrentPlan(plans) {
    if (!state.currentUser) {
      document.getElementById("current-plan-info").innerHTML = 
        '<div class="loading-text">Please log in to view your plan.</div>';
      return;
    }
    
    const { data: subscription } = await sb.from("subscriptions")
      .select("*")
      .eq("user_id", state.currentUser.id)
      .eq("status", "active")
      .maybeSingle();
    
    const currentPlan = subscription 
      ? plans.find(p => p.id === subscription.plan_id) 
      : plans[0];
    
    document.getElementById("current-plan-info").innerHTML = `
      <div style="font-weight:700; font-size:14px;">${currentPlan?.name || "Free"}</div>
      <div style="font-size:12px; color:rgba(239,233,222,0.6); margin-top:4px;">
        ${currentPlan?.features.join(", ") || "Basic features"}
      </div>
    `;
  }
  
  static async upgradeToPlan(planId, amount) {
    if (!state.currentUser) {
      alert("Please log in.");
      return;
    }
    
    if (amount === 0) {
      await sb.from("subscriptions").upsert({
        user_id: state.currentUser.id,
        plan_id: planId,
        status: "active"
      });
      UI.toast("Plan updated!");
      this.render(document.getElementById("main-content"));
      return;
    }
    
    // Initialize Paystack payment
    const handler = PaystackPop.setup({
      key: CONFIG.PAYSTACK_PUBLIC_KEY,
      email: state.currentUser.email || "user@example.com",
      amount: amount * 100, // Convert to kobo
      currency: "NGN",
      callback: async (response) => {
        await sb.from("subscriptions").upsert({
          user_id: state.currentUser.id,
          plan_id: planId,
          status: "active",
          paystack_ref: response.reference
        });
        UI.toast("Payment successful! Plan upgraded.");
        this.render(document.getElementById("main-content"));
      },
      onClose: () => {
        UI.toast("Payment cancelled.", "error");
      }
    });
    
    handler.openIframe();
  }
}
