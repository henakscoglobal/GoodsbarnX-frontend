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

// ==========================================================================
// Distributor side: "My Trade Relationships" — list of all buyers with
// their relationship status, credit terms, and trade value where it exists.
// Same read-only, database-is-truth principle as the buyer card above.
// ==========================================================================

async function loadMyTradeRelationships() {
  const container = document.getElementById("my-relationships-list");
  if (!container || !currentUser || currentUser.role !== "distributor") return;

  container.innerHTML = '<div class="loading-text">Loading your trade relationships...</div>';

  const { data: relationships, error } = await sb
    .from("trade_relationships")
    .select("*")
    .eq("distributor_id", currentUser.id)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Trade relationships lookup failed:", error.message);
    container.innerHTML = "";
    return;
  }

  if (!relationships || relationships.length === 0) {
    container.innerHTML = '<div class="loading-text">No buyer relationships yet.</div>';
    return;
  }

  const buyerIds = relationships.map(r => r.buyer_id);
  const relationshipIds = relationships.map(r => r.id);

  const [{ data: buyers }, { data: trustRows }, { data: termsRows }] = await Promise.all([
    sb.from("buyer_profiles").select("id, name, profiles(full_name, phone)").in("id", buyerIds),
    sb.from("relationship_trust").select("relationship_id, total_trade_value").in("relationship_id", relationshipIds),
    sb.from("current_relationship_trade_terms").select("buyer_id, credit_enabled, credit_limit, credit_days").eq("distributor_id", currentUser.id)
  ]);

  const buyerMap = {};
  (buyers || []).forEach(b => { buyerMap[b.id] = b; });
  const trustMap = {};
  (trustRows || []).forEach(t => { trustMap[t.relationship_id] = t; });
  const termsMap = {};
  (termsRows || []).forEach(t => { termsMap[t.buyer_id] = t; });

  container.innerHTML = '<div class="section-label" style="margin-top:0;">Your Trade Relationships</div>' + relationships.map(r => {
    const buyer = buyerMap[r.buyer_id];
    const buyerName = buyer?.name || buyer?.profiles?.full_name || "Buyer";
    const phone = buyer?.profiles?.phone || "";
    const statusLabel = RELATIONSHIP_STATUS_LABELS[r.status] || r.status;
    const trust = trustMap[r.id];
    const terms = termsMap[r.buyer_id];

    return `
      <div class="manifest">
        <div class="manifest-top">
          <div>
            <div class="m-name">${buyerName}${r.is_primary ? ' <span style="font-size:10px; color:var(--brass-dark);">· PRIMARY</span>' : ""}</div>
            <div class="m-loc">${phone}</div>
          </div>
          <span class="stamp-badge" style="border-color:${r.status === "active" ? "var(--ok)" : "var(--brass)"}; color:${r.status === "active" ? "var(--ok)" : "var(--brass)"};">${statusLabel.toUpperCase()}</span>
        </div>
        <div style="font-size:12px; margin-top:6px; color:rgba(18,21,28,0.6);">
          ${trust?.total_trade_value ? `Lifetime trade: ₦${Number(trust.total_trade_value).toLocaleString()}` : "No trade history yet"}
          ${terms?.credit_enabled ? ` · Credit: ₦${Number(terms.credit_limit || 0).toLocaleString()} / ${terms.credit_days || 0}d` : ""}
        </div>
      </div>
    `;
  }).join("");
}
