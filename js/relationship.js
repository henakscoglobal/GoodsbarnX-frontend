// ==========================================================================
// GoodsbarnX — relationship.js
// Buyer-facing "My Distributor" card: shows the buyer's primary trade
// relationship (distributor name, status, start date, approved credit terms).
// Read-only.
// Plain global script — depends on js/config.js (for `sb`) and global
// `currentUser` (js/auth.js).
//
// Per the Relationship Commerce architecture principle: the frontend does
// NOT compute relationship status or validity — it only displays exactly
// what the database returns. All business rules (valid statuses, current
// terms, access control) live in Supabase / RLS, not here.
//
// NOTE on credit: only APPROVED credit terms (limit, days) are shown.
// "Used" and "available" credit are intentionally NOT shown — there is no
// orders/invoices/payments table anywhere in the schema to calculate them
// from yet. Showing a fabricated "available" number would be misleading.
// Revisit once real order/payment tracking exists.
// ==========================================================================

// Human-readable labels for the trade_relationship_status enum
const RELATIONSHIP_STATUS_LABELS = {
  pending: "Pending",
  active: "Active",
  paused: "Paused",
  released: "Released",
  terminated: "Terminated"
};

async function loadMyTradeRelationship() {
  const container = document.getElementById("my-relationship-card");
  if (!container || !currentUser || currentUser.role !== "buyer") return;

  container.innerHTML = '<div class="loading-text">Loading your distributor relationship...</div>';

  const { data: relationship, error } = await sb
    .from("trade_relationships")
    .select("*")
    .eq("buyer_id", currentUser.id)
    .eq("is_primary", true)
    .maybeSingle();

  if (error) {
    console.error("Trade relationship lookup failed:", error.message);
    container.innerHTML = "";
    return;
  }

  if (!relationship) {
    container.innerHTML = "";
    return;
  }

  // Second lookup: business name lives in distributor_profiles, not
  // directly reachable from trade_relationships (its FK points to profiles.id).
  const { data: distributor } = await sb
    .from("distributor_profiles")
    .select("business_name, location, market")
    .eq("id", relationship.distributor_id)
    .maybeSingle();

  // Third lookup: approved credit terms, if any exist for this relationship.
  const { data: terms } = await sb
    .from("current_relationship_trade_terms")
    .select("credit_enabled, credit_limit, credit_days")
    .eq("buyer_id", currentUser.id)
    .eq("distributor_id", relationship.distributor_id)
    .maybeSingle();

  const distributorName = distributor?.business_name || "Your distributor";
  const statusLabel = RELATIONSHIP_STATUS_LABELS[relationship.status] || relationship.status;
  const startedDate = relationship.relationship_started_at
    ? new Date(relationship.relationship_started_at).toLocaleDateString()
    : null;

  const creditHtml = terms?.credit_enabled
    ? `
      <div style="border-top:1px dashed var(--line-dark); margin-top:10px; padding-top:10px;">
        <div style="font-size:11px; text-transform:uppercase; letter-spacing:0.05em; color:rgba(18,21,28,0.5); font-weight:700; margin-bottom:4px;">Credit Terms (Approved)</div>
        <div style="font-size:13px;">
          ${terms.credit_limit ? `Limit: <strong>₦${Number(terms.credit_limit).toLocaleString()}</strong>` : ""}
          ${terms.credit_days ? ` · ${terms.credit_days} days` : ""}
        </div>
      </div>
    `
    : "";

  container.innerHTML = `
    <div class="manifest">
      <div class="manifest-top">
        <div>
          <div class="m-name">${distributorName}</div>
          <div class="m-loc">${distributor?.location || ""}${distributor?.market ? " · " + distributor.market : ""}</div>
        </div>
        <span class="stamp-badge" style="border-color:${relationship.status === "active" ? "var(--ok)" : "var(--brass)"}; color:${relationship.status === "active" ? "var(--ok)" : "var(--brass)"};">${statusLabel.toUpperCase()}</span>
      </div>
      ${startedDate ? `<div class="m-loc" style="margin-top:8px;">Trading together since ${startedDate}</div>` : ""}
      ${creditHtml}
    </div>
  `;
}
