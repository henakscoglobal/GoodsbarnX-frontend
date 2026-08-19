// ==========================================================================
// GoodsbarnX — trust.js
// Trust & Transparency screen: summary stats, verified distributors,
// approved disputes list.
// Plain global script — depends on js/config.js (for `sb`) being loaded first.
// ==========================================================================

async function loadTrustData() {
  const { data: d } = await sb.from("distributor_profiles").select("id, business_name, verification_tier");
  const { data: disp } = await sb.from("disputes").select("id, distributor_id, description, status, created_at").eq("status", "Approved").order("created_at", { ascending: false }).limit(10);

  const total = d?.length || 0;
  const verified = d?.filter(x => x.verification_tier === "association" || x.verification_tier === "market board").length || 0;

  document.getElementById("trust-summary").innerHTML = `
    <div class="trust-item"><div class="n">${total}</div><div class="t">Total</div></div>
    <div class="trust-item"><div class="n" style="color:var(--ok);">${verified}</div><div class="t">Verified</div></div>
    <div class="trust-item"><div class="n" style="color:var(--brass-dark);">${total - verified}</div><div class="t">Self-Attested</div></div>
  `;

  const vd = d?.filter(x => x.verification_tier === "association" || x.verification_tier === "market board") || [];
  document.getElementById("verified-distributors-list").innerHTML = vd.length ?
    vd.map(x => `<div class="manifest"><div class="manifest-top"><div><div class="m-name">${x.business_name}</div><div class="m-loc">${x.verification_tier === "association" ? "Association Verified" : "Market Board Verified"}</div></div><span style="color:var(--ok);">✓</span></div></div>`).join("") :
    '<div class="loading-text">None yet.</div>';

  document.getElementById("disputes-list").innerHTML = disp?.length ?
    disp.map(x => `<div class="manifest"><div class="manifest-top"><div><div class="m-name">${d?.find(y => y.id === x.distributor_id)?.business_name || "Unknown"}</div><div class="m-loc">${x.description || "No details"}</div></div><span style="color:var(--stamp); font-size:10px;">DISPUTE</span></div></div>`).join("") :
    '<div class="loading-text">No approved disputes.</div>';
}
