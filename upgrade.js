// GoodsbarnX – Subscription & Upgrade Module

document.addEventListener("screenChanged", (e) => {
  if (e.detail.screen === "upgrade") loadUpgradeScreen();
});

async function loadUpgradeScreen() {
  if (!currentUser) return;

  const { data: plans } = await sb.from("subscription_plans").select("*").order("price_monthly_ngn", { ascending: true });
  if (!plans) return;

  const { data: currentSub } = await sb.from("subscriptions").select("*, subscription_plans(*)").eq("user_id", currentUser.id).eq("status", "active").maybeSingle();

  // Current plan info
  const infoDiv = document.getElementById("current-plan-info");
  if (infoDiv) {
    if (currentSub && currentSub.subscription_plans) {
      infoDiv.innerHTML = `
        <div class="m-name">${currentSub.subscription_plans.name}</div>
        <div class="m-loc">${currentSub.subscription_plans.price_monthly_ngn === 0 ? "Free forever" : "₦" + currentSub.subscription_plans.price_monthly_ngn + "/month"}</div>
        <div style="margin-top:4px; font-size:11px; color:rgba(18,21,28,0.5);">
          ${currentSub.status === "active" ? "Active · Renews " + new Date(currentSub.current_period_end).toLocaleDateString() : "Inactive"}
        </div>
      `;
    } else {
      infoDiv.innerHTML = '<div class="loading-text">No active subscription</div>';
    }
  }

  // Plan cards
  const cardsDiv = document.getElementById("plan-cards");
  if (cardsDiv) {
    cardsDiv.innerHTML = plans.map(plan => {
      const isCurrent = currentSub && currentSub.plan_id === plan.id;
      const featuresList = plan.features ? Object.values(plan.features).flat() : [];
      const isRecommended = plan.id === "pro";
      return `
        <div class="manifest" style="padding:16px; ${isRecommended ? "border:2px solid var(--brass-bright);" : ""}">
          <div class="manifest-top">
            <div>
              <div class="m-name">${plan.name} ${isRecommended ? '<span style="font-size:10px; background:var(--brass-bright); color:var(--ink); padding:2px 6px; border-radius:4px; margin-left:6px;">Recommended</span>' : ""}</div>
              <div class="m-loc">${plan.price_monthly_ngn === 0 ? "Free forever" : "₦" + plan.price_monthly_ngn + "/month"}</div>
            </div>
            ${isCurrent ? '<span style="color:var(--ok); font-weight:700;">Current</span>' : ""}
          </div>
          <ul style="font-size:12px; margin:8px 0 0 16px; color:rgba(18,21,28,0.7);">
            ${featuresList.map(f => `<li>${f}</li>`).join("")}
          </ul>
          ${!isCurrent ? `<button class="btn-inquire" style="width:100%; margin-top:10px;" onclick="selectUpgradePlan('${plan.id}', ${plan.price_monthly_ngn})">Choose ${plan.name}</button>` : ""}
        </div>
      `;
    }).join("");
  }
}

function selectUpgradePlan(planId, price) {
  if (!currentUser) {
    alert("Please log in first.");
    return;
  }
  if (price === 0) {
    activateFreePlan();
  } else {
    payWithPaystack(planId, price);
  }
}

async function activateFreePlan() {
  const { error } = await sb.from("subscriptions").upsert({
    user_id: currentUser.id,
    plan_id: "free",
    status: "active",
    current_period_start: new Date(),
    current_period_end: new Date(Date.now() + 100 * 365 * 24 * 60 * 60 * 1000)
  }, { onConflict: "user_id" });

  const statusEl = document.getElementById("upgrade-status");
  if (error) {
    if (statusEl) statusEl.innerText = "Error activating plan.";
  } else {
    if (statusEl) statusEl.innerText = "Free plan activated!";
    loadUpgradeScreen();
    if (typeof loadCurrentUser === "function") loadCurrentUser();
  }
}

function payWithPaystack(planId, amountNgn) {
  const handler = PaystackPop.setup({
    key: "pk_test_xxxxxxxxxxxxxxxxxxxxxxxx", // Replace with your Paystack public key
    email: currentUser.email || "user@example.com",
    amount: amountNgn * 100,
    currency: "NGN",
    ref: "GSX_" + Date.now(),
    metadata: {
      user_id: currentUser.id,
      plan_id: planId
    },
    onClose: function() {
      const statusEl = document.getElementById("upgrade-status");
      if (statusEl) statusEl.innerText = "Payment cancelled.";
    },
    callback: function(response) {
      verifyPayment(response.reference, planId);
    }
  });
  handler.openIframe();
}

async function verifyPayment(reference, planId) {
  const statusEl = document.getElementById("upgrade-status");
  if (statusEl) statusEl.innerText = "Verifying payment...";

  const res = await fetch(BACKEND + "/verify-payment", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reference, planId, userId: currentUser.id })
  });

  const data = await res.json();
  if (data.success) {
    if (statusEl) statusEl.innerText = "Subscription activated!";
    loadUpgradeScreen();
    if (typeof loadCurrentUser === "function") loadCurrentUser();
  } else {
    if (statusEl) statusEl.innerText = "Payment verification failed. Please contact support.";
  }
}
