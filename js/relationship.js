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

// Dispute status → color, so open/pending disputes stand out from resolved ones
const DISPUTE_STATUS_COLORS = {
  open: "var(--stamp)",
  pending: "var(--brass)",
  under_review: "var(--brass)",
  resolved: "var(--ok)",
  closed: "var(--ok)"
};

const DISPUTE_OPEN_STATUSES = ["open", "pending", "under_review"];

// Compact one-line dispute summary — used in the distributor's relationship
// list, where showing every dispute in full for every buyer would mean too
// many nested details on one screen. Full per-dispute detail lives on the
// buyer's own card (loadRelationshipDisputes below).
function renderDisputeSummaryLine(disputes) {
  if (!disputes || disputes.length === 0) return "";

  const openCount = disputes.filter(d => DISPUTE_OPEN_STATUSES.includes(d.status)).length;
  const color = openCount > 0 ? "var(--stamp)" : "var(--ok)";

  return `
    <div style="font-size:12px; margin-top:4px; color:${color}; font-weight:600;">
      ${disputes.length} dispute${disputes.length === 1 ? "" : "s"}${openCount > 0 ? ` · ${openCount} open` : " · all resolved"}
    </div>
  `;
}

async function loadRelationshipDisputes(relationshipId) {
  const container = document.getElementById("my-relationship-disputes");
  if (!container) return;

  const { data: disputes, error } = await sb
    .from("relationship_disputes")
    .select("category, description, status, resolution, created_at, resolved_at")
    .eq("relationship_id", relationshipId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Relationship disputes lookup failed:", error.message);
    container.innerHTML = "";
    return;
  }

  if (!disputes || disputes.length === 0) {
    container.innerHTML = "";
    return;
  }

  container.innerHTML = `
    <div class="section-label">Relationship Disputes</div>
    ${disputes.map(d => {
      const color = DISPUTE_STATUS_COLORS[d.status] || "var(--brass)";
      return `
        <div class="manifest">
          <div class="manifest-top">
            <div>
              <div class="m-name">${d.category || "Dispute"}</div>
              <div class="m-loc">${d.description || ""}</div>
            </div>
            <span class="stamp-badge" style="border-color:${color}; color:${color};">${(d.status || "").toUpperCase()}</span>
          </div>
          ${d.resolution ? `<div class="m-loc" style="margin-top:8px; border-top:1px dashed var(--line-dark); padding-top:8px;">Resolution: ${d.resolution}</div>` : ""}
          <div class="m-loc" style="margin-top:6px; font-size:10px;">${new Date(d.created_at).toLocaleDateString()}${d.resolved_at ? ` · Resolved ${new Date(d.resolved_at).toLocaleDateString()}` : ""}</div>
        </div>
      `;
    }).join("")}
  `;
}

// Human-readable labels for event_type values. Falls back to the raw
// value (with underscores replaced) for any type not listed here, so new
// event types added later still display reasonably without a code change.
const RELATIONSHIP_EVENT_LABELS = {
  relationship_created: "Relationship created",
  relationship_activated: "Relationship activated",
  relationship_paused: "Relationship paused",
  relationship_resumed: "Relationship resumed",
  relationship_released: "Relationship released",
  relationship_terminated: "Relationship terminated",
  commercial_terms_created: "Trade terms set",
  commercial_terms_updated: "Trade terms updated",
  agent_assigned: "Agent assigned",
  agent_unassigned: "Agent unassigned",
  payment_method_added: "Payment method added",
  payment_method_changed: "Payment method changed",
  credit_enabled: "Credit enabled",
  credit_limit_changed: "Credit limit changed",
  product_preference_added: "Product preference added",
  dispute_opened: "Dispute opened",
  dispute_resolved: "Dispute resolved"
};

function formatEventType(eventType) {
  return RELATIONSHIP_EVENT_LABELS[eventType] || eventType.replace(/_/g, " ");
}

async function loadRelationshipHistory(relationshipId) {
  const container = document.getElementById("my-relationship-history");
  if (!container) return;

  const { data: events, error } = await sb
    .from("relationship_events")
    .select("event_type, created_at")
    .eq("relationship_id", relationshipId)
    .order("created_at", { ascending: false })
    .limit(10);

  if (error) {
    console.error("Relationship history lookup failed:", error.message);
    container.innerHTML = "";
    return;
  }

  if (!events || events.length === 0) {
    container.innerHTML = `
      <div class="section-label">Relationship History</div>
      <div class="loading-text">No history yet.</div>
    `;
    return;
  }

  container.innerHTML = `
    <div class="section-label">Relationship History</div>
    <div class="manifest" style="padding:6px 16px;">
      ${events.map((e, i) => `
        <div style="padding:10px 0; ${i < events.length - 1 ? 'border-bottom:1px dashed var(--line-dark);' : ''}">
          <div style="font-size:13px; font-weight:600;">${formatEventType(e.event_type)}</div>
          <div style="font-size:11px; color:rgba(18,21,28,0.5); margin-top:2px;">${new Date(e.created_at).toLocaleString()}</div>
        </div>
      `).join("")}
    </div>
  `;
}
const RELATIONSHIP_STATUS_LABELS = {
  pending: "Pending",
  active: "Active",
  paused: "Paused",
  released: "Released",
  terminated: "Terminated"
};

// Shared trust-score rendering — used on both the buyer's own card and the
// distributor's relationship list, so the two stay visually consistent.
// Returns "" (nothing) if no trust record exists yet, rather than showing
// a fabricated 0 that would look like a bad score.
function renderTrustLine(trust) {
  if (!trust || trust.trust_score == null) return "";

  const score = Number(trust.trust_score);
  const scoreColor = score >= 70 ? "var(--ok)" : score >= 40 ? "var(--brass)" : "var(--stamp)";
  const completed = trust.completed_orders || 0;
  const disputed = trust.disputed_orders || 0;

  return `
    <div style="display:flex; align-items:center; gap:6px; margin-top:6px; font-size:12px;">
      <span style="font-weight:700; color:${scoreColor};">Trust ${score}/100</span>
      <span style="color:rgba(18,21,28,0.5);">· ${completed} completed order${completed === 1 ? "" : "s"}${disputed ? ` · ${disputed} disputed` : ""}</span>
    </div>
  `;
}

// Loyalty is intentionally free-text at the database level (per the
// architecture doc — levels are configurable, not hardcoded), so this
// renders whatever string is stored rather than assuming a fixed set.
function renderLoyaltyLine(loyalty) {
  if (!loyalty || !loyalty.loyalty_level) return "";

  const points = loyalty.loyalty_points != null ? Number(loyalty.loyalty_points) : null;
  const consecutive = loyalty.consecutive_order_count || 0;

  return `
    <div style="display:flex; align-items:center; gap:6px; margin-top:4px; font-size:12px;">
      <span class="stamp-badge" style="font-size:9px; padding:2px 6px; border-color:var(--brass); color:var(--brass-dark); transform:none;">${loyalty.loyalty_level.toUpperCase()}</span>
      <span style="color:rgba(18,21,28,0.5);">${points != null ? `${points} pts` : ""}${consecutive ? ` · ${consecutive} in a row` : ""}</span>
    </div>
  `;
}

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

  // Fourth lookup: trust score for this specific relationship.
  const { data: trust } = await sb
    .from("relationship_trust")
    .select("trust_score, completed_orders, disputed_orders")
    .eq("relationship_id", relationship.id)
    .maybeSingle();

  // Fifth lookup: loyalty status for this specific relationship.
  const { data: loyalty } = await sb
    .from("relationship_loyalty")
    .select("loyalty_level, loyalty_points, consecutive_order_count")
    .eq("relationship_id", relationship.id)
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
      ${renderTrustLine(trust)}
      ${renderLoyaltyLine(loyalty)}
      ${creditHtml}
    </div>
  `;

  loadMyPreferredProducts(relationship.id, relationship.distributor_id, distributorName);
  loadRelationshipHistory(relationship.id);
  loadRelationshipDisputes(relationship.id);
}

// ==========================================================================
// Buyer's "Your Preferred Products" — the products marked preferred=true
// for this buyer's primary relationship. This is the "usual products" list
// from the architecture doc (Section 9) — so a buyer doesn't have to search
// the whole marketplace every time for what they always order.
// ==========================================================================

async function loadMyPreferredProducts(relationshipId, distributorId, distributorName) {
  const container = document.getElementById("my-preferred-products");
  if (!container) return;

  const { data: prefs, error } = await sb
    .from("relationship_product_preferences")
    .select("*")
    .eq("relationship_id", relationshipId)
    .eq("preferred", true);

  if (error) {
    console.error("Preferred products lookup failed:", error.message);
    container.innerHTML = "";
    return;
  }

  if (!prefs || prefs.length === 0) {
    container.innerHTML = "";
    return;
  }

  const productIds = prefs.map(p => p.product_id);
  const { data: products } = await sb
    .from("products")
    .select("id, name, sku, brand, price, image_url, stock_quantity, status")
    .in("id", productIds);

  const productMap = {};
  (products || []).forEach(p => { productMap[p.id] = p; });

  const rows = prefs
    .map(pref => ({ pref, product: productMap[pref.product_id] }))
    .filter(({ product }) => product && product.status === "active");

  if (rows.length === 0) {
    container.innerHTML = "";
    return;
  }

  container.innerHTML = `
    <div class="section-label">Your Preferred Products</div>
    ${rows.map(({ pref, product }) => {
      const publicPrice = product.price || 0;
      const hasNegotiated = pref.negotiated_unit_price != null;
      const finalPrice = hasNegotiated ? pref.negotiated_unit_price : publicPrice;
      const priceHtml = !product.price && !hasNegotiated
        ? "Negotiable"
        : hasNegotiated
          ? `<span style="text-decoration:line-through; color:rgba(18,21,28,0.4); font-size:11px;">₦${publicPrice.toLocaleString()}</span> <span style="color:var(--ok); font-weight:700;">₦${finalPrice.toLocaleString()}</span>`
          : `₦${publicPrice.toLocaleString()}`;

      return `
        <div class="product-item">
          <div class="product-image" style="${product.image_url ? `background-image:url('${product.image_url}')` : 'background-color:var(--ink-2);'}"></div>
          <div style="display:inline-block; width:calc(100% - 80px);">
            <div style="font-weight:600; font-size:13px;">${product.name} <span style="color:var(--brass-dark); font-size:11px;">★</span></div>
            <div style="font-size:11px; color:rgba(18,21,28,0.55); margin-top:2px;">${product.brand ? product.brand + " · " : ""}${product.sku || "No SKU"}</div>
            <div style="font-size:12px; margin-top:4px;">${priceHtml}</div>
            <div style="margin-top:8px;">
              <button class="btn btn-success" onclick="addToCart('${product.id}', '${product.name}', ${finalPrice}, '${distributorId}', '${distributorName}')">Add to Cart</button>
            </div>
          </div>
        </div>
      `;
    }).join("")}
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

  const [{ data: buyers }, { data: trustRows }, { data: loyaltyRows }, { data: termsRows }, { data: disputeRows }] = await Promise.all([
    sb.from("buyer_profiles").select("id, name, profiles(full_name, phone)").in("id", buyerIds),
    sb.from("relationship_trust").select("relationship_id, total_trade_value, trust_score, completed_orders, disputed_orders").in("relationship_id", relationshipIds),
    sb.from("relationship_loyalty").select("relationship_id, loyalty_level, loyalty_points, consecutive_order_count").in("relationship_id", relationshipIds),
    sb.from("current_relationship_trade_terms").select("buyer_id, credit_enabled, credit_limit, credit_days").eq("distributor_id", currentUser.id),
    sb.from("relationship_disputes").select("relationship_id, status").in("relationship_id", relationshipIds)
  ]);

  const buyerMap = {};
  (buyers || []).forEach(b => { buyerMap[b.id] = b; });
  const trustMap = {};
  (trustRows || []).forEach(t => { trustMap[t.relationship_id] = t; });
  const loyaltyMap = {};
  (loyaltyRows || []).forEach(l => { loyaltyMap[l.relationship_id] = l; });
  const termsMap = {};
  (termsRows || []).forEach(t => { termsMap[t.buyer_id] = t; });
  const disputesMap = {};
  (disputeRows || []).forEach(d => {
    if (!disputesMap[d.relationship_id]) disputesMap[d.relationship_id] = [];
    disputesMap[d.relationship_id].push(d);
  });

  container.innerHTML = '<div class="section-label" style="margin-top:0;">Your Trade Relationships</div>' + relationships.map(r => {
    const buyer = buyerMap[r.buyer_id];
    const buyerName = buyer?.name || buyer?.profiles?.full_name || "Buyer";
    const phone = buyer?.profiles?.phone || "";
    const statusLabel = RELATIONSHIP_STATUS_LABELS[r.status] || r.status;
    const trust = trustMap[r.id];
    const loyalty = loyaltyMap[r.id];
    const terms = termsMap[r.buyer_id];
    const disputes = disputesMap[r.id];

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
        ${renderTrustLine(trust)}
        ${renderLoyaltyLine(loyalty)}
        ${renderDisputeSummaryLine(disputes)}
      </div>
    `;
  }).join("");
}

// ==========================================================================
// Agent side: "My Relationships" — the relationships this agent is
// currently assigned to (relationship_agents.unassigned_at IS NULL means
// still active). Read-only, same principles as buyer/distributor views.
// ==========================================================================

async function loadMyAgentRelationships() {
  const container = document.getElementById("agent-relationships-list");
  if (!container || !currentUser || currentUser.role !== "agent") return;

  container.innerHTML = '<div class="loading-text">Loading your assigned relationships...</div>';

  const { data: assignments, error } = await sb
    .from("relationship_agents")
    .select("relationship_id, is_primary, assigned_at")
    .eq("agent_id", currentUser.id)
    .is("unassigned_at", null);

  if (error) {
    console.error("Agent relationship assignments lookup failed:", error.message);
    container.innerHTML = "";
    return;
  }

  if (!assignments || assignments.length === 0) {
    container.innerHTML = '<div class="loading-text">No relationships assigned to you yet.</div>';
    return;
  }

  const relationshipIds = assignments.map(a => a.relationship_id);

  const { data: relationships } = await sb
    .from("trade_relationships")
    .select("*")
    .in("id", relationshipIds);

  if (!relationships || relationships.length === 0) {
    container.innerHTML = '<div class="loading-text">No relationships assigned to you yet.</div>';
    return;
  }

  const buyerIds = relationships.map(r => r.buyer_id);
  const distributorIds = relationships.map(r => r.distributor_id);

  const [{ data: buyers }, { data: distributors }, { data: trustRows }] = await Promise.all([
    sb.from("buyer_profiles").select("id, name, profiles(full_name, phone)").in("id", buyerIds),
    sb.from("distributor_profiles").select("id, business_name, location, market").in("id", distributorIds),
    sb.from("relationship_trust").select("relationship_id, trust_score, completed_orders, disputed_orders").in("relationship_id", relationshipIds)
  ]);

  const buyerMap = {};
  (buyers || []).forEach(b => { buyerMap[b.id] = b; });
  const distributorMap = {};
  (distributors || []).forEach(d => { distributorMap[d.id] = d; });
  const trustMap = {};
  (trustRows || []).forEach(t => { trustMap[t.relationship_id] = t; });
  const assignmentMap = {};
  assignments.forEach(a => { assignmentMap[a.relationship_id] = a; });

  container.innerHTML = relationships.map(r => {
    const buyer = buyerMap[r.buyer_id];
    const distributor = distributorMap[r.distributor_id];
    const buyerName = buyer?.name || buyer?.profiles?.full_name || "Buyer";
    const distributorName = distributor?.business_name || "Distributor";
    const statusLabel = RELATIONSHIP_STATUS_LABELS[r.status] || r.status;
    const trust = trustMap[r.id];
    const assignment = assignmentMap[r.id];

    return `
      <div class="manifest">
        <div class="manifest-top">
          <div>
            <div class="m-name">${buyerName} <span style="color:rgba(18,21,28,0.4);">↔</span> ${distributorName}</div>
            <div class="m-loc">${buyer?.profiles?.phone || ""}${distributor?.location ? " · " + distributor.location : ""}</div>
          </div>
          <span class="stamp-badge" style="border-color:${r.status === "active" ? "var(--ok)" : "var(--brass)"}; color:${r.status === "active" ? "var(--ok)" : "var(--brass)"};">${statusLabel.toUpperCase()}</span>
        </div>
        ${assignment?.is_primary ? '<div class="m-loc" style="margin-top:6px;">You are the primary agent</div>' : ""}
        ${renderTrustLine(trust)}
      </div>
    `;
  }).join("");
}
