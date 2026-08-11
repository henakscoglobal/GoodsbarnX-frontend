// GoodsbarnX – Trust & Transparency Module

document.addEventListener("screenChanged", (e) => {
  if (e.detail.screen === "trust") loadTrustData();
});

async function loadTrustData() {
  const { data: distributors } = await sb.from("distributor_profiles").select("id, business_name, verification_tier");
  const { data: disputes } = await sb.from("disputes").select("id, distributor_id, description, status, created_at").eq("status", "Approved").order("created_at", { ascending: false }).limit(10);

  const totalDist = distributors ? distributors.length : 0;
  const verified = distributors ? distributors.filter(d => d.verification_tier === "association" || d.verification_tier === "market board").length : 0;
  const selfAttested = totalDist - verified;

  // Summary strip
  const summaryEl = document.getElementById("trust-summary");
  if (summaryEl) {
    summaryEl.innerHTML = `
      <div class="trust-item"><div class="n">${totalDist}</div><div class="t">Total</div></div>
      <div class="trust-item"><div class="n" style="color:var(--ok);">${verified}</div><div class="t">Verified</div></div>
      <div class="trust-item"><div class="n" style="color:var(--brass-dark);">${selfAttested}</div><div class="t">Self-Attested</div></div>
    `;
  }

  // Verified distributors list
  const verifiedList = document.getElementById("verified-distributors-list");
  if (verifiedList) {
    const verifiedDists = distributors ? distributors.filter(d => d.verification_tier === "association" || d.verification_tier === "market board") : [];
    if (verifiedDists.length === 0) {
      verifiedList.innerHTML = '<div class="loading-text">No verified distributors yet.</div>';
    } else {
      verifiedList.innerHTML = verifiedDists.map(d => {
        const tierLabel = d.verification_tier === "association" ? "Association Verified" : "Market Board Verified";
        return `<div class="manifest"><div class="manifest-top"><div><div class="m-name">${d.business_name}</div><div class="m-loc">${tierLabel}</div></div><span style="color:var(--ok); font-weight:700;">✓</span></div></div>`;
      }).join("");
    }
  }

  // Approved disputes list
  const disputesList = document.getElementById("disputes-list");
  if (disputesList) {
    if (!disputes || disputes.length === 0) {
      disputesList.innerHTML = '<div class="loading-text">No approved disputes on record.</div>';
    } else {
      disputesList.innerHTML = disputes.map(disp => {
        const dist = distributors ? distributors.find(d => d.id === disp.distributor_id) : null;
        const distName = dist ? dist.business_name : "Unknown Distributor";
        return `<div class="manifest"><div class="manifest-top"><div><div class="m-name">${distName}</div><div class="m-loc">${disp.description || "No details"}</div></div><span style="color:var(--stamp); font-size:10px;">DISPUTE</span></div></div>`;
      }).join("");
    }
  }
}
