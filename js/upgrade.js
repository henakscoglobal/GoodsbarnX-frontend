// ==========================================================================
// GoodsbarnX — upgrade.js
// Subscription plans display.
// Plain global script.
// NOTE: "Upgrade" button currently just alerts "coming soon" — Paystack is
// loaded via CDN in index.html but not yet wired to a real charge. Revisit
// this when we build backend/api (Paystack verification needs a server-side
// step, not just client-side inline.js).
// ==========================================================================

async function loadUpgradeScreen() {
  const plans = [
    { id: "free", name: "Free", price: 0, features: ["Browse distributors", "Send 5 inquiries/day", "Basic profile"] },
    { id: "buyer_pro", name: "Buyer Pro", price: 2500, features: ["Unlimited inquiries", "Verified badge", "Priority support"] },
    { id: "distributor_pro", name: "Distributor Pro", price: 5000, features: ["Product listings", "Storefront", "Analytics"] }
  ];

  const container = document.getElementById("plan-cards");
  container.innerHTML = plans.map(plan => `
    <div style="background:var(--ink-2); border:1px solid ${plan.id === "free" ? "var(--line)" : "var(--brass)"}; border-radius:14px; padding:16px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
        <h3 style="font-size:16px;">${plan.name}</h3>
        <span style="font-size:18px; font-weight:700; color:var(--brass-bright);">${plan.price === 0 ? "Free" : "₦" + plan.price.toLocaleString() + "/mo"}</span>
      </div>
      <ul style="list-style:none; padding:0; margin:8px 0;">
        ${plan.features.map(f => `<li style="padding:4px 0; font-size:12px; color:rgba(239,233,222,0.7);">✓ ${f}</li>`).join("")}
      </ul>
      ${plan.id !== "free" ? `<button class="btn btn-primary" style="width:100%;" onclick="alert('Payment integration coming soon!')">Upgrade</button>` : '<div style="text-align:center; padding:8px; font-size:12px; color:rgba(239,233,222,0.5);">Current plan</div>'}
    </div>
  `).join("");

  document.getElementById("current-plan-info").innerHTML = '<div style="font-weight:700; font-size:14px;">Free</div><div style="font-size:12px; color:rgba(239,233,222,0.6); margin-top:4px;">Basic features</div>';
}
