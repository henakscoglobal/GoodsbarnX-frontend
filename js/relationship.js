// ==========================================================================
// GoodsbarnX — relationship.js
// Buyer / Distributor / Agent relationship commerce layer.
//
// Plain global script.
// Depends on:
//   - js/config.js  → global `sb`
//   - js/auth.js    → global `currentUser`
//
// Database is the source of truth. Frontend displays database state and
// delegates business rules / authorization to Supabase RLS, triggers and RPCs.
//
// IMPORTANT RELATIONSHIP MODEL
// --------------------------------------------------------------------------
// 1. A distributor can establish a buyer relationship.
// 2. A distributor may assign an agent to that relationship.
// 3. An agent belongs to / works through a distributor relationship.
// 4. Agent-referred buyers must ultimately resolve through the agent's
//    distributor attachment. The frontend must not allow an agent to choose
//    an arbitrary distributor.
// 5. Buyer purchasing restrictions are enforced by the database/RLS/RPC layer.
// 6. This file is a UI/data-access layer and must not be treated as the
//    authorization boundary.
// ==========================================================================


// ==========================================================================
// SHARED CONSTANTS
// ==========================================================================

const DISPUTE_STATUS_COLORS = {
  open: "var(--stamp)",
  pending: "var(--brass)",
  under_review: "var(--brass)",
  resolved: "var(--ok)",
  closed: "var(--ok)"
};

const DISPUTE_OPEN_STATUSES = [
  "open",
  "pending",
  "under_review"
];

const RELATIONSHIP_STATUS_LABELS = {
  pending: "Pending",
  active: "Active",
  paused: "Paused",
  released: "Released",
  terminated: "Terminated"
};

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

const RELATIONSHIP_ACTIONS = {
  pending: [
    {
      label: "Activate",
      newStatus: "active"
    }
  ],

  active: [
    {
      label: "Pause",
      newStatus: "paused"
    },
    {
      label: "Release",
      newStatus: "released"
    }
  ],

  paused: [
    {
      label: "Resume",
      newStatus: "active"
    },
    {
      label: "Release",
      newStatus: "released"
    }
  ]
};


// ==========================================================================
// STATE MANAGEMENT
// ==========================================================================

let relationshipLayerInitialized = false;
let relationshipLoadInProgress = false;


// ==========================================================================
// SMALL HELPERS
// ==========================================================================

function relationshipEscapeHtml(value) {
  if (value == null) return "";

  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}


function relationshipEscapeAttribute(value) {
  return relationshipEscapeHtml(value);
}


function relationshipFormatDate(value) {
  if (!value) return "";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleDateString();
}


function relationshipFormatDateTime(value) {
  if (!value) return "";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleString();
}


function relationshipMoney(value) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return "₦0";
  }

  return `₦${number.toLocaleString()}`;
}


function relationshipSafeNumber(value, fallback = 0) {
  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : fallback;
}


function formatEventType(eventType) {
  if (!eventType) {
    return "Relationship event";
  }

  return (
    RELATIONSHIP_EVENT_LABELS[eventType] ||
    String(eventType).replace(/_/g, " ")
  );
}


function getRelationshipStatusColor(status) {
  return status === "active"
    ? "var(--ok)"
    : "var(--brass)";
}


// ==========================================================================
// SAFE QUERY WRAPPER
// ==========================================================================

async function safeSupabaseQuery(queryFn, fallbackData = null, errorContext = "") {
  if (!window.sb) {
    console.error(`Supabase client not initialized${errorContext ? ` for ${errorContext}` : ''}`);
    return { data: fallbackData, error: new Error('Supabase client not initialized') };
  }

  try {
    return await queryFn(window.sb);
  } catch (error) {
    console.error(`Query failed${errorContext ? ` (${errorContext})` : ''}:`, error);
    return { data: fallbackData, error };
  }
}


// ==========================================================================
// DISPUTES
// ==========================================================================

function renderDisputeSummaryLine(disputes) {
  if (!disputes || disputes.length === 0) {
    return "";
  }

  const openCount = disputes.filter(d =>
    DISPUTE_OPEN_STATUSES.includes(d.status)
  ).length;

  const color =
    openCount > 0
      ? "var(--stamp)"
      : "var(--ok)";

  return `
    <div
      style="
        font-size:12px;
        margin-top:4px;
        color:${color};
        font-weight:600;
      "
    >
      ${disputes.length}
      dispute${disputes.length === 1 ? "" : "s"}
      ${
        openCount > 0
          ? ` · ${openCount} open`
          : " · all resolved"
      }
    </div>
  `;
}


async function loadRelationshipDisputes(relationshipId) {
  const container = document.getElementById("my-relationship-disputes");

  if (!container || !relationshipId) {
    return;
  }

  const { data: disputes, error } = await safeSupabaseQuery(
    (sb) => sb
      .from("relationship_disputes")
      .select(`
        category,
        description,
        status,
        resolution,
        created_at,
        resolved_at
      `)
      .eq("relationship_id", relationshipId)
      .order("created_at", { ascending: false }),
    [],
    "loadRelationshipDisputes"
  );

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
    <div class="section-label">
      Relationship Disputes
    </div>

    ${disputes.map(d => {
      const color = DISPUTE_STATUS_COLORS[d.status] || "var(--brass)";

      return `
        <div class="manifest">
          <div class="manifest-top">
            <div>
              <div class="m-name">
                ${relationshipEscapeHtml(d.category || "Dispute")}
              </div>
              <div class="m-loc">
                ${relationshipEscapeHtml(d.description || "")}
              </div>
            </div>
            <span
              class="stamp-badge"
              style="border-color:${color}; color:${color};"
            >
              ${relationshipEscapeHtml(String(d.status || "").toUpperCase())}
            </span>
          </div>

          ${d.resolution ? `
            <div class="m-loc" style="margin-top:8px; border-top:1px dashed var(--line-dark); padding-top:8px;">
              Resolution: ${relationshipEscapeHtml(d.resolution)}
            </div>
          ` : ""}

          <div class="m-loc" style="margin-top:6px; font-size:10px;">
            ${relationshipEscapeHtml(relationshipFormatDate(d.created_at))}
            ${d.resolved_at ? `
              · Resolved ${relationshipEscapeHtml(relationshipFormatDate(d.resolved_at))}
            ` : ""}
          </div>
        </div>
      `;
    }).join("")}
  `;
}


// ==========================================================================
// RELATIONSHIP HISTORY
// ==========================================================================

async function loadRelationshipHistory(relationshipId) {
  const container = document.getElementById("my-relationship-history");

  if (!container || !relationshipId) {
    return;
  }

  const { data: events, error } = await safeSupabaseQuery(
    (sb) => sb
      .from("relationship_events")
      .select("event_type, created_at")
      .eq("relationship_id", relationshipId)
      .order("created_at", { ascending: false })
      .limit(10),
    [],
    "loadRelationshipHistory"
  );

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
      ${events.map((event, index) => `
        <div style="padding:10px 0; ${index < events.length - 1 ? "border-bottom:1px dashed var(--line-dark);" : ""}">
          <div style="font-size:13px; font-weight:600;">
            ${relationshipEscapeHtml(formatEventType(event.event_type))}
          </div>
          <div style="font-size:11px; color:rgba(18,21,28,0.5); margin-top:2px;">
            ${relationshipEscapeHtml(relationshipFormatDateTime(event.created_at))}
          </div>
        </div>
      `).join("")}
    </div>
  `;
}


// ==========================================================================
// TRUST
// ==========================================================================

function renderTrustLine(trust) {
  if (!trust || trust.trust_score == null) {
    return "";
  }

  const score = relationshipSafeNumber(trust.trust_score);
  const scoreColor = score >= 70 ? "var(--ok)" : score >= 40 ? "var(--brass)" : "var(--stamp)";
  const completed = relationshipSafeNumber(trust.completed_orders);
  const disputed = relationshipSafeNumber(trust.disputed_orders);

  return `
    <div style="display:flex; align-items:center; gap:6px; margin-top:6px; font-size:12px;">
      <span style="font-weight:700; color:${scoreColor};">Trust ${score}/100</span>
      <span style="color:rgba(18,21,28,0.5);">
        · ${completed} completed order${completed === 1 ? "" : "s"}
        ${disputed ? ` · ${disputed} disputed` : ""}
      </span>
    </div>
  `;
}


// ==========================================================================
// LOYALTY
// ==========================================================================

function renderLoyaltyLine(loyalty) {
  if (!loyalty || !loyalty.loyalty_level) {
    return "";
  }

  const points = loyalty.loyalty_points != null ? relationshipSafeNumber(loyalty.loyalty_points) : null;
  const consecutive = relationshipSafeNumber(loyalty.consecutive_order_count);

  return `
    <div style="display:flex; align-items:center; gap:6px; margin-top:4px; font-size:12px;">
      <span class="stamp-badge" style="font-size:9px; padding:2px 6px; border-color:var(--brass); color:var(--brass-dark); transform:none;">
        ${relationshipEscapeHtml(String(loyalty.loyalty_level).toUpperCase())}
      </span>
      <span style="color:rgba(18,21,28,0.5);">
        ${points != null ? `${points} pts` : ""}
        ${consecutive ? ` · ${consecutive} in a row` : ""}
      </span>
    </div>
  `;
}


// ==========================================================================
// BUYER — MY TRADE RELATIONSHIP
// ==========================================================================

async function loadMyTradeRelationship() {
  const container = document.getElementById("my-relationship-card");

  if (!container || !currentUser || currentUser.role !== "buyer") {
    return;
  }

  if (!window.sb) {
    console.error("Supabase client not available for buyer relationship");
    container.innerHTML = "";
    return;
  }

  container.innerHTML = `<div class="loading-text">Loading your distributor relationship...</div>`;

  const { data: relationship, error } = await safeSupabaseQuery(
    (sb) => sb
      .from("trade_relationships")
      .select("*")
      .eq("buyer_id", currentUser.id)
      .eq("is_primary", true)
      .maybeSingle(),
    null,
    "loadMyTradeRelationship"
  );

  if (error) {
    console.error("Trade relationship lookup failed:", error.message);
    container.innerHTML = "";
    return;
  }

  if (!relationship) {
    container.innerHTML = "";
    return;
  }

  // Fetch related data with individual error handling
  const [distributorResult, termsResult, trustResult, loyaltyResult] = await Promise.allSettled([
    window.sb.from("distributor_profiles")
      .select("business_name, location, market")
      .eq("id", relationship.distributor_id)
      .maybeSingle(),
    
    window.sb.from("current_relationship_trade_terms")
      .select("credit_enabled, credit_limit, credit_days")
      .eq("buyer_id", currentUser.id)
      .eq("distributor_id", relationship.distributor_id)
      .maybeSingle(),
    
    window.sb.from("relationship_trust")
      .select("trust_score, completed_orders, disputed_orders")
      .eq("relationship_id", relationship.id)
      .maybeSingle(),
    
    window.sb.from("relationship_loyalty")
      .select("loyalty_level, loyalty_points, consecutive_order_count")
      .eq("relationship_id", relationship.id)
      .maybeSingle()
  ]);

  const distributor = distributorResult.status === 'fulfilled' ? distributorResult.value.data : null;
  const terms = termsResult.status === 'fulfilled' ? termsResult.value.data : null;
  const trust = trustResult.status === 'fulfilled' ? trustResult.value.data : null;
  const loyalty = loyaltyResult.status === 'fulfilled' ? loyaltyResult.value.data : null;

  // Log any errors
  [distributorResult, termsResult, trustResult, loyaltyResult].forEach((result, index) => {
    if (result.status === 'rejected') {
      const names = ['distributor', 'terms', 'trust', 'loyalty'];
      console.warn(`Failed to load ${names[index]}:`, result.reason?.message);
    }
  });

  const distributorName = distributor?.business_name || "Your distributor";
  const statusLabel = RELATIONSHIP_STATUS_LABELS[relationship.status] || relationship.status;
  const startedDate = relationship.relationship_started_at ? relationshipFormatDate(relationship.relationship_started_at) : null;

  const creditHtml = terms?.credit_enabled ? `
    <div style="border-top:1px dashed var(--line-dark); margin-top:10px; padding-top:10px;">
      <div style="font-size:11px; text-transform:uppercase; letter-spacing:0.05em; color:rgba(18,21,28,0.5); font-weight:700; margin-bottom:4px;">
        Credit Terms (Approved)
      </div>
      <div style="font-size:13px;">
        ${terms.credit_limit != null ? `Limit: <strong>${relationshipMoney(terms.credit_limit)}</strong>` : ""}
        ${terms.credit_days != null ? ` · ${terms.credit_days} days` : ""}
      </div>
    </div>
  ` : "";

  const statusColor = getRelationshipStatusColor(relationship.status);

  container.innerHTML = `
    <div class="manifest">
      <div class="manifest-top">
        <div>
          <div class="m-name">${relationshipEscapeHtml(distributorName)}</div>
          <div class="m-loc">
            ${relationshipEscapeHtml(distributor?.location || "")}
            ${distributor?.market ? " · " + relationshipEscapeHtml(distributor.market) : ""}
          </div>
        </div>
        <span class="stamp-badge" style="border-color:${statusColor}; color:${statusColor};">
          ${relationshipEscapeHtml(String(statusLabel).toUpperCase())}
        </span>
      </div>

      ${startedDate ? `
        <div class="m-loc" style="margin-top:8px;">
          Trading together since ${relationshipEscapeHtml(startedDate)}
        </div>
      ` : ""}

      ${renderTrustLine(trust)}
      ${renderLoyaltyLine(loyalty)}
      ${creditHtml}
    </div>
  `;

  // Load related data
  loadMyPreferredProducts(relationship.id, relationship.distributor_id, distributorName);
  loadRelationshipHistory(relationship.id);
  loadRelationshipDisputes(relationship.id);
  loadRelationshipPaymentMethods(relationship.id);
}


// ==========================================================================
// BUYER — PREFERRED PRODUCTS
// ==========================================================================

async function loadMyPreferredProducts(relationshipId, distributorId, distributorName) {
  const container = document.getElementById("my-preferred-products");

  if (!container || !window.sb) {
    return;
  }

  const { data: prefs, error } = await safeSupabaseQuery(
    (sb) => sb
      .from("relationship_product_preferences")
      .select("*")
      .eq("relationship_id", relationshipId)
      .eq("preferred", true),
    [],
    "loadMyPreferredProducts"
  );

  if (error) {
    console.error("Preferred products lookup failed:", error.message);
    container.innerHTML = "";
    return;
  }

  if (!prefs || prefs.length === 0) {
    container.innerHTML = "";
    return;
  }

  const productIds = prefs.map(preference => preference.product_id);

  if (productIds.length === 0) {
    container.innerHTML = "";
    return;
  }

  const { data: products } = await safeSupabaseQuery(
    (sb) => sb
      .from("products")
      .select("id, name, sku, brand, price, image_url, stock_quantity, status")
      .in("id", productIds),
    [],
    "loadMyPreferredProducts - products"
  );

  const productMap = {};
  (products || []).forEach(product => {
    productMap[product.id] = product;
  });

  const rows = prefs
    .map(preference => ({
      pref: preference,
      product: productMap[preference.product_id]
    }))
    .filter(row => row.product && row.product.status === "active");

  if (rows.length === 0) {
    container.innerHTML = "";
    return;
  }

  container.innerHTML = `
    <div class="section-label">Your Preferred Products</div>
    ${rows.map(({ pref, product }) => {
      const publicPrice = relationshipSafeNumber(product.price);
      const hasNegotiated = pref.negotiated_unit_price != null;
      const finalPrice = hasNegotiated ? relationshipSafeNumber(pref.negotiated_unit_price) : publicPrice;

      let priceHtml;
      if (product.price == null && !hasNegotiated) {
        priceHtml = "Negotiable";
      } else if (hasNegotiated) {
        priceHtml = `
          <span style="text-decoration:line-through; color:rgba(18,21,28,0.4); font-size:11px;">
            ${relationshipMoney(publicPrice)}
          </span>
          <span style="color:var(--ok); font-weight:700;">
            ${relationshipMoney(finalPrice)}
          </span>
        `;
      } else {
        priceHtml = relationshipMoney(publicPrice);
      }

      const productName = relationshipEscapeHtml(product.name);
      const productId = relationshipEscapeAttribute(product.id);
      const distributorIdSafe = relationshipEscapeAttribute(distributorId);
      const distributorNameSafe = relationshipEscapeAttribute(distributorName);

      return `
        <div class="product-item">
          <div class="product-image" style="${product.image_url ? `background-image:url('${relationshipEscapeAttribute(product.image_url)}')` : "background-color:var(--ink-2);"}"></div>
          <div style="display:inline-block; width:calc(100% - 80px);">
            <div style="font-weight:600; font-size:13px;">
              ${productName}
              <span style="color:var(--brass-dark); font-size:11px;">★</span>
            </div>
            <div style="font-size:11px; color:rgba(18,21,28,0.55); margin-top:2px;">
              ${product.brand ? relationshipEscapeHtml(product.brand) + " · " : ""}
              ${relationshipEscapeHtml(product.sku || "No SKU")}
            </div>
            <div style="font-size:12px; margin-top:4px;">${priceHtml}</div>
            <div style="margin-top:8px;">
              <button
                class="btn btn-success"
                data-product-id="${productId}"
                data-distributor-id="${distributorIdSafe}"
                onclick="addToCart(this.dataset.productId, ${JSON.stringify(String(product.name))}, ${Number(finalPrice) || 0}, this.dataset.distributorId, ${JSON.stringify(String(distributorName))})"
              >
                Add to Cart
              </button>
            </div>
          </div>
        </div>
      `;
    }).join("")}
  `;
}


// ==========================================================================
// DISTRIBUTOR — MY TRADE RELATIONSHIPS (FIXED)
// ==========================================================================

async function loadMyTradeRelationships() {
  const container = document.getElementById("my-relationships-list");

  if (!container || !currentUser || currentUser.role !== "distributor") {
    console.log('Skipping distributor relationships load:', {
      hasContainer: !!container,
      hasUser: !!currentUser,
      role: currentUser?.role
    });
    return;
  }

  if (relationshipLoadInProgress) {
    console.log('Relationship load already in progress');
    return;
  }

  if (!window.sb) {
    console.error('Supabase client not available for distributor relationships');
    container.innerHTML = `
      <div class="error-message" style="padding:20px; text-align:center; color:var(--stamp);">
        System initialization error. Please refresh the page.
      </div>
    `;
    return;
  }

  relationshipLoadInProgress = true;

  const inviteButtonHtml = `
    <div class="section-label" style="margin-top:0;">Your Trade Relationships</div>
    <button class="btn btn-primary btn-block" style="margin-bottom:14px;" onclick="openInviteBuyerModal()">
      + Invite a Buyer
    </button>
  `;

  container.innerHTML = inviteButtonHtml + `
    <div class="loading-text">Loading your trade relationships...</div>
  `;

  try {
    const { data: relationships, error: relationshipsError } = await window.sb
      .from("trade_relationships")
      .select("*")
      .eq("distributor_id", currentUser.id)
      .order("created_at", { ascending: false });

    if (relationshipsError) {
      throw relationshipsError;
    }

    if (!relationships || relationships.length === 0) {
      container.innerHTML = inviteButtonHtml + `
        <div class="loading-text">No buyer relationships yet.</div>
      `;
      relationshipLoadInProgress = false;
      return;
    }

    const buyerIds = relationships.map(r => r.buyer_id).filter(id => id);
    const relationshipIds = relationships.map(r => r.id).filter(id => id);

    if (buyerIds.length === 0 || relationshipIds.length === 0) {
      throw new Error('Invalid relationship data - missing IDs');
    }

    // Fetch related data with Promise.allSettled for resilience
    const [buyersResult, trustResult, loyaltyResult, termsResult, disputesResult] = 
      await Promise.allSettled([
        window.sb.from("buyer_profiles")
          .select("id, name, profiles(full_name, phone)")
          .in("id", buyerIds),
        
        window.sb.from("relationship_trust")
          .select("relationship_id, total_trade_value, trust_score, completed_orders, disputed_orders")
          .in("relationship_id", relationshipIds),
        
        window.sb.from("relationship_loyalty")
          .select("relationship_id, loyalty_level, loyalty_points, consecutive_order_count")
          .in("relationship_id", relationshipIds),
        
        window.sb.from("current_relationship_trade_terms")
          .select("buyer_id, credit_enabled, credit_limit, credit_days, default_discount_percent")
          .eq("distributor_id", currentUser.id),
        
        window.sb.from("relationship_disputes")
          .select("relationship_id, status")
          .in("relationship_id", relationshipIds)
      ]);

    // Extract data with fallbacks
    const buyers = buyersResult.status === 'fulfilled' ? (buyersResult.value.data || []) : [];
    const trustRows = trustResult.status === 'fulfilled' ? (trustResult.value.data || []) : [];
    const loyaltyRows = loyaltyResult.status === 'fulfilled' ? (loyaltyResult.value.data || []) : [];
    const termsRows = termsResult.status === 'fulfilled' ? (termsResult.value.data || []) : [];
    const disputeRows = disputesResult.status === 'fulfilled' ? (disputesResult.value.data || []) : [];

    // Log any failed queries
    const results = [buyersResult, trustResult, loyaltyResult, termsResult, disputesResult];
    const resultNames = ['buyers', 'trust', 'loyalty', 'terms', 'disputes'];
    
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        console.warn(`Failed to load ${resultNames[index]} data:`, result.reason?.message);
      }
    });

    // Build maps with null safety
    const buyerMap = {};
    const trustMap = {};
    const loyaltyMap = {};
    const termsMap = {};
    const disputesMap = {};

    buyers.forEach(buyer => { 
      if (buyer && buyer.id) buyerMap[buyer.id] = buyer; 
    });

    trustRows.forEach(row => { 
      if (row && row.relationship_id) trustMap[row.relationship_id] = row; 
    });

    loyaltyRows.forEach(row => { 
      if (row && row.relationship_id) loyaltyMap[row.relationship_id] = row; 
    });

    termsRows.forEach(row => { 
      if (row && row.buyer_id) termsMap[row.buyer_id] = row; 
    });

    disputeRows.forEach(dispute => {
      if (dispute && dispute.relationship_id) {
        if (!disputesMap[dispute.relationship_id]) {
          disputesMap[dispute.relationship_id] = [];
        }
        disputesMap[dispute.relationship_id].push(dispute);
      }
    });

    // Render relationships
    container.innerHTML = inviteButtonHtml + relationships.map(relationship => {
      const buyer = buyerMap[relationship.buyer_id];
      const buyerName = buyer?.name || buyer?.profiles?.full_name || "Buyer";
      const phone = buyer?.profiles?.phone || "";
      const statusLabel = RELATIONSHIP_STATUS_LABELS[relationship.status] || relationship.status;
      const trust = trustMap[relationship.id];
      const loyalty = loyaltyMap[relationship.id];
      const terms = termsMap[relationship.buyer_id];
      const disputes = disputesMap[relationship.id];
      const statusColor = getRelationshipStatusColor(relationship.status);

      return `
        <div class="manifest">
          <div class="manifest-top">
            <div>
              <div class="m-name">
                ${relationshipEscapeHtml(buyerName)}
                ${relationship.is_primary ? `
                  <span style="font-size:10px; color:var(--brass-dark);">· PRIMARY</span>
                ` : ""}
              </div>
              <div class="m-loc">${relationshipEscapeHtml(phone)}</div>
            </div>
            <span class="stamp-badge" style="border-color:${statusColor}; color:${statusColor};">
              ${relationshipEscapeHtml(String(statusLabel).toUpperCase())}
            </span>
          </div>

          <div style="font-size:12px; margin-top:6px; color:rgba(18,21,28,0.6);">
            ${trust?.total_trade_value ? `Lifetime trade: ${relationshipMoney(trust.total_trade_value)}` : "No trade history yet"}
            ${terms?.credit_enabled ? ` · Credit: ${relationshipMoney(terms.credit_limit || 0)} / ${terms.credit_days || 0}d` : ""}
          </div>

          ${renderTrustLine(trust)}
          ${renderLoyaltyLine(loyalty)}
          ${renderDisputeSummaryLine(disputes)}

          <div style="margin-top:10px;">
            <button class="btn btn-outline" onclick="openEditTermsModal('${relationshipEscapeAttribute(relationship.id)}')">
              Edit Terms
            </button>
            <button class="btn btn-outline" onclick="openAssignAgentModal('${relationshipEscapeAttribute(relationship.id)}')">
              Assign Agent
            </button>
            <button class="btn btn-outline" onclick="openManagePaymentMethodsModal('${relationshipEscapeAttribute(relationship.id)}')">
              Payment Methods
            </button>
            <button class="btn btn-outline" onclick="openManagePreferredProductsModal('${relationshipEscapeAttribute(relationship.id)}')">
              Preferred Products
            </button>
          </div>

          ${renderRelationshipActions(relationship.id, relationship.status)}
        </div>
      `;
    }).join("");

    // Set terms cache
    window.__relTermsCache = {};
    relationships.forEach(relationship => {
      const buyer = buyerMap[relationship.buyer_id];
      const terms = termsMap[relationship.buyer_id];

      window.__relTermsCache[relationship.id] = {
        buyerName: buyer?.name || buyer?.profiles?.full_name || "Buyer",
        discount: terms?.default_discount_percent ?? "",
        creditEnabled: terms?.credit_enabled ?? false,
        creditLimit: terms?.credit_limit ?? "",
        creditDays: terms?.credit_days ?? ""
      };
    });

    console.log(`Successfully loaded ${relationships.length} distributor relationships`);
    relationshipLayerInitialized = true;

  } catch (error) {
    console.error('Failed to load distributor relationships:', error);
    container.innerHTML = inviteButtonHtml + `
      <div class="error-message" style="padding:20px; text-align:center;">
        <div style="color:var(--stamp); font-weight:600; margin-bottom:10px;">
          Failed to load relationships
        </div>
        <div style="font-size:12px; color:rgba(18,21,28,0.6);">
          ${relationshipEscapeHtml(error.message || 'Unknown error')}
        </div>
        <button class="btn btn-outline" style="margin-top:15px;" onclick="loadMyTradeRelationships()">
          Retry
        </button>
      </div>
    `;
  } finally {
    relationshipLoadInProgress = false;
  }
}


// ==========================================================================
// AGENT — MY RELATIONSHIPS (FIXED)
// ==========================================================================

async function loadMyAgentRelationships() {
  const container = document.getElementById("agent-relationships-list");

  if (!container || !currentUser || currentUser.role !== "agent") {
    return;
  }

  if (!window.sb) {
    console.error("Supabase client not available for agent relationships");
    container.innerHTML = "";
    return;
  }

  container.innerHTML = `<div class="loading-text">Loading your assigned relationships...</div>`;

  const { data: assignments, error } = await safeSupabaseQuery(
    (sb) => sb
      .from("relationship_agents")
      .select("relationship_id, is_primary, assigned_at")
      .eq("agent_id", currentUser.id)
      .is("unassigned_at", null),
    [],
    "loadMyAgentRelationships"
  );

  if (error) {
    console.error("Agent relationship assignments lookup failed:", error.message);
    container.innerHTML = "";
    return;
  }

  if (!assignments || assignments.length === 0) {
    container.innerHTML = `<div class="loading-text">No relationships assigned to you yet.</div>`;
    return;
  }

  const relationshipIds = assignments.map(a => a.relationship_id).filter(id => id);

  if (relationshipIds.length === 0) {
    container.innerHTML = `<div class="loading-text">No relationships assigned to you yet.</div>`;
    return;
  }

  const { data: relationships } = await safeSupabaseQuery(
    (sb) => sb
      .from("trade_relationships")
      .select("*")
      .in("id", relationshipIds),
    [],
    "loadMyAgentRelationships - relationships"
  );

  if (!relationships || relationships.length === 0) {
    container.innerHTML = `<div class="loading-text">No relationships assigned to you yet.</div>`;
    return;
  }

  const buyerIds = relationships.map(r => r.buyer_id).filter(id => id);
  const distributorIds = relationships.map(r => r.distributor_id).filter(id => id);

  const [buyersResult, distributorsResult, trustResult] = await Promise.allSettled([
    window.sb.from("buyer_profiles")
      .select("id, name, profiles(full_name, phone)")
      .in("id", buyerIds),
    
    window.sb.from("distributor_profiles")
      .select("id, business_name, location, market")
      .in("id", distributorIds),
    
    window.sb.from("relationship_trust")
      .select("relationship_id, trust_score, completed_orders, disputed_orders")
      .in("relationship_id", relationshipIds)
  ]);

  const buyers = buyersResult.status === 'fulfilled' ? (buyersResult.value.data || []) : [];
  const distributors = distributorsResult.status === 'fulfilled' ? (distributorsResult.value.data || []) : [];
  const trustRows = trustResult.status === 'fulfilled' ? (trustResult.value.data || []) : [];

  const buyerMap = {};
  const distributorMap = {};
  const trustMap = {};
  const assignmentMap = {};

  buyers.forEach(buyer => { if (buyer && buyer.id) buyerMap[buyer.id] = buyer; });
  distributors.forEach(distributor => { if (distributor && distributor.id) distributorMap[distributor.id] = distributor; });
  trustRows.forEach(trust => { if (trust && trust.relationship_id) trustMap[trust.relationship_id] = trust; });
  assignments.forEach(assignment => { 
    if (assignment && assignment.relationship_id) assignmentMap[assignment.relationship_id] = assignment; 
  });

  container.innerHTML = relationships.map(relationship => {
    const buyer = buyerMap[relationship.buyer_id];
    const distributor = distributorMap[relationship.distributor_id];
    const buyerName = buyer?.name || buyer?.profiles?.full_name || "Buyer";
    const distributorName = distributor?.business_name || "Distributor";
    const statusLabel = RELATIONSHIP_STATUS_LABELS[relationship.status] || relationship.status;
    const trust = trustMap[relationship.id];
    const assignment = assignmentMap[relationship.id];
    const statusColor = getRelationshipStatusColor(relationship.status);

    return `
      <div class="manifest">
        <div class="manifest-top">
          <div>
            <div class="m-name">
              ${relationshipEscapeHtml(buyerName)}
              <span style="color:rgba(18,21,28,0.4);">↔</span>
              ${relationshipEscapeHtml(distributorName)}
            </div>
            <div class="m-loc">
              ${relationshipEscapeHtml(buyer?.profiles?.phone || "")}
              ${distributor?.location ? " · " + relationshipEscapeHtml(distributor.location) : ""}
            </div>
          </div>
          <span class="stamp-badge" style="border-color:${statusColor}; color:${statusColor};">
            ${relationshipEscapeHtml(String(statusLabel).toUpperCase())}
          </span>
        </div>

        ${assignment?.is_primary ? `
          <div class="m-loc" style="margin-top:6px;">You are the primary agent</div>
        ` : ""}

        ${renderTrustLine(trust)}
      </div>
    `;
  }).join("");
}


// ==========================================================================
// BUYER — APPROVED PAYMENT METHODS
// ==========================================================================

async function loadRelationshipPaymentMethods(relationshipId) {
  const container = document.getElementById("my-payment-methods");

  if (!container || !relationshipId) {
    return;
  }

  const { data: methods, error } = await safeSupabaseQuery(
    (sb) => sb
      .from("relationship_payment_methods")
      .select("payment_method, is_default, is_active, transaction_limit")
      .eq("relationship_id", relationshipId)
      .eq("is_active", true)
      .order("is_default", { ascending: false }),
    [],
    "loadRelationshipPaymentMethods"
  );

  if (error) {
    console.error("Payment methods lookup failed:", error.message);
    container.innerHTML = "";
    return;
  }

  if (!methods || methods.length === 0) {
    container.innerHTML = "";
    return;
  }

  container.innerHTML = `
    <div class="section-label">Approved Payment Methods</div>
    <div class="manifest" style="padding:6px 16px;">
      ${methods.map((method, index) => `
        <div style="padding:10px 0; ${index < methods.length - 1 ? "border-bottom:1px dashed var(--line-dark);" : ""} display:flex; justify-content:space-between; align-items:center;">
          <div>
            <span style="font-size:13px; font-weight:600;">
              ${relationshipEscapeHtml(method.payment_method)}
            </span>
            ${method.is_default ? `
              <span class="stamp-badge" style="font-size:8px; padding:2px 6px; border-color:var(--ok); color:var(--ok); transform:none; margin-left:6px;">
                DEFAULT
              </span>
            ` : ""}
          </div>
          ${method.transaction_limit != null ? `
            <span style="font-size:11px; color:rgba(18,21,28,0.5);">
              Limit ${relationshipMoney(method.transaction_limit)}
            </span>
          ` : ""}
        </div>
      `).join("")}
    </div>
  `;
}


// ==========================================================================
// DISTRIBUTOR — EDIT TRADE TERMS
// ==========================================================================

let editingTermsRelationshipId = null;


function openEditTermsModal(relationshipId) {
  const cached = window.__relTermsCache?.[relationshipId];

  if (!cached) {
    return;
  }

  editingTermsRelationshipId = relationshipId;

  const buyerNameEl = document.getElementById("edit-terms-buyer-name");
  const discountEl = document.getElementById("terms-discount");
  const creditEnabledEl = document.getElementById("terms-credit-enabled");
  const creditLimitEl = document.getElementById("terms-credit-limit");
  const creditDaysEl = document.getElementById("terms-credit-days");
  const statusEl = document.getElementById("edit-terms-status");
  const modal = document.getElementById("edit-terms-modal");

  if (!modal) {
    return;
  }

  if (buyerNameEl) {
    buyerNameEl.innerText = cached.buyerName;
  }

  if (discountEl) {
    discountEl.value = cached.discount;
  }

  if (creditEnabledEl) {
    creditEnabledEl.value = cached.creditEnabled ? "true" : "false";
  }

  if (creditLimitEl) {
    creditLimitEl.value = cached.creditLimit;
  }

  if (creditDaysEl) {
    creditDaysEl.value = cached.creditDays;
  }

  if (statusEl) {
    statusEl.innerText = "";
  }

  modal.classList.add("active");
}


function closeEditTermsModal() {
  const modal = document.getElementById("edit-terms-modal");

  if (modal) {
    modal.classList.remove("active");
  }

  editingTermsRelationshipId = null;
}


async function saveRelationshipTerms() {
  if (!editingTermsRelationshipId) {
    return;
  }

  if (!window.sb) {
    console.error("Supabase client not available");
    return;
  }

  const status = document.getElementById("edit-terms-status");

  if (!status) {
    return;
  }

  status.innerText = "Saving...";

  const discountRaw = document.getElementById("terms-discount")?.value ?? "";
  const creditEnabled = (document.getElementById("terms-credit-enabled")?.value) === "true";
  const creditLimitRaw = document.getElementById("terms-credit-limit")?.value ?? "";
  const creditDaysRaw = document.getElementById("terms-credit-days")?.value ?? "";

  const discount = discountRaw !== "" ? parseFloat(discountRaw) : null;
  const creditLimit = creditEnabled && creditLimitRaw !== "" ? parseFloat(creditLimitRaw) : null;
  const creditDays = creditEnabled && creditDaysRaw !== "" ? parseInt(creditDaysRaw, 10) : null;

  if (discount != null && !Number.isFinite(discount)) {
    status.innerText = "Invalid discount.";
    return;
  }

  if (creditEnabled && creditLimit != null && !Number.isFinite(creditLimit)) {
    status.innerText = "Invalid credit limit.";
    return;
  }

  if (creditEnabled && creditDays != null && !Number.isInteger(creditDays)) {
    status.innerText = "Invalid credit days.";
    return;
  }

  const payload = {
    default_discount_percent: discount,
    credit_enabled: creditEnabled,
    credit_limit: creditLimit,
    credit_days: creditDays
  };

  try {
    const { data: existing } = await window.sb
      .from("relationship_trade_terms")
      .select("id")
      .eq("relationship_id", editingTermsRelationshipId)
      .maybeSingle();

    let error;

    if (existing) {
      ({ error } = await window.sb
        .from("relationship_trade_terms")
        .update(payload)
        .eq("id", existing.id));
    } else {
      ({ error } = await window.sb
        .from("relationship_trade_terms")
        .insert({
          relationship_id: editingTermsRelationshipId,
          effective_from: new Date().toISOString(),
          ...payload
        }));
    }

    if (error) {
      throw error;
    }

    status.innerText = "Saved!";

    setTimeout(() => {
      closeEditTermsModal();
      loadMyTradeRelationships();
    }, 1000);
  } catch (error) {
    console.error("Failed to save terms:", error);
    status.innerText = "Error: " + error.message;
  }
}


// ==========================================================================
// DISTRIBUTOR — INVITE BUYER
// ==========================================================================

function openInviteBuyerModal() {
  const modal = document.getElementById("invite-buyer-modal");

  if (!modal) {
    return;
  }

  const search = document.getElementById("invite-buyer-search");
  const results = document.getElementById("invite-buyer-results");
  const status = document.getElementById("invite-buyer-status");

  if (search) {
    search.value = "";
  }

  if (results) {
    results.innerHTML = "";
  }

  if (status) {
    status.innerText = "";
  }

  modal.classList.add("active");
}


function closeInviteBuyerModal() {
  const modal = document.getElementById("invite-buyer-modal");

  if (modal) {
    modal.classList.remove("active");
  }
}


async function searchBuyersForInvite() {
  const search = document.getElementById("invite-buyer-search");
  const resultsEl = document.getElementById("invite-buyer-results");

  if (!search || !resultsEl || !window.sb) {
    return;
  }

  const query = search.value.trim();

  if (query.length < 2) {
    resultsEl.innerHTML = "";
    return;
  }

  const { data: buyers, error } = await safeSupabaseQuery(
    (sb) => sb
      .from("buyer_profiles")
      .select("id, name, location, profiles(full_name, phone)")
      .or(`name.ilike.%${query}%`)
      .limit(10),
    [],
    "searchBuyersForInvite"
  );

  if (error) {
    console.error("Buyer search failed:", error.message);
    resultsEl.innerHTML = "";
    return;
  }

  if (!buyers || buyers.length === 0) {
    resultsEl.innerHTML = `<div class="loading-text">No matching buyers found.</div>`;
    return;
  }

  resultsEl.innerHTML = buyers.map(buyer => {
    const name = buyer.name || buyer.profiles?.full_name || "Buyer";

    return `
      <div class="manifest" style="padding:12px; cursor:pointer;" 
           data-buyer-id="${relationshipEscapeAttribute(buyer.id)}"
           data-buyer-name="${relationshipEscapeAttribute(name)}"
           onclick="inviteBuyerToRelationship(this.dataset.buyerId, this.dataset.buyerName)">
        <div class="m-name">${relationshipEscapeHtml(name)}</div>
        <div class="m-loc">
          ${relationshipEscapeHtml(buyer.location || "")}
          ${buyer.profiles?.phone ? " · " + relationshipEscapeHtml(buyer.profiles.phone) : ""}
        </div>
      </div>
    `;
  }).join("");
}


async function inviteBuyerToRelationship(buyerId, buyerName) {
  if (!currentUser || currentUser.role !== "distributor" || !window.sb) {
    return;
  }

  const status = document.getElementById("invite-buyer-status");

  if (!status) {
    return;
  }

  status.innerText = `Inviting ${buyerName}...`;

  const { error } = await window.sb.rpc("create_trade_relationship", {
    p_buyer_id: buyerId,
    p_distributor_id: currentUser.id
  });

  if (error) {
    status.innerText = "Error: " + error.message;
    return;
  }

  status.innerText = `${buyerName} added as a trade relationship!`;

  setTimeout(() => {
    closeInviteBuyerModal();
    loadMyTradeRelationships();
  }, 1200);
}


// ==========================================================================
// RELATIONSHIP STATUS
// ==========================================================================

function renderRelationshipActions(relationshipId, status) {
  const actions = RELATIONSHIP_ACTIONS[status];

  if (!actions) {
    return "";
  }

  return `
    <div style="margin-top:10px; display:flex; gap:8px; flex-wrap:wrap;">
      ${actions.map(action => `
        <button
          class="btn btn-outline"
          data-relationship-id="${relationshipEscapeAttribute(relationshipId)}"
          data-new-status="${relationshipEscapeAttribute(action.newStatus)}"
          onclick="updateRelationshipStatus(this.dataset.relationshipId, this.dataset.newStatus)"
        >
          ${relationshipEscapeHtml(action.label)}
        </button>
      `).join("")}
    </div>
  `;
}


async function updateRelationshipStatus(relationshipId, newStatus) {
  if (!window.sb) {
    console.error("Supabase client not available");
    return;
  }

  const timestampFields = {
    active: "activated_at",
    paused: "paused_at",
    released: "released_at",
    terminated: "terminated_at"
  };

  if (!Object.prototype.hasOwnProperty.call(RELATIONSHIP_STATUS_LABELS, newStatus)) {
    return;
  }

  const payload = {
    status: newStatus
  };

  if (timestampFields[newStatus]) {
    payload[timestampFields[newStatus]] = new Date().toISOString();
  }

  if (newStatus === "released") {
    const reason = prompt("Reason for releasing this relationship (required):");

    if (!reason || !reason.trim()) {
      return;
    }

    payload.release_reason = reason.trim();
  }

  if (!confirm(`Change this relationship's status to "${newStatus}"? This cannot be casually undone.`)) {
    return;
  }

  const { error } = await window.sb
    .from("trade_relationships")
    .update(payload)
    .eq("id", relationshipId);

  if (error) {
    alert("Could not update status: " + error.message);
    return;
  }

  loadMyTradeRelationships();
}


// ==========================================================================
// DISTRIBUTOR — ASSIGN AGENT
// ==========================================================================

let assigningAgentRelationshipId = null;


function openAssignAgentModal(relationshipId) {
  assigningAgentRelationshipId = relationshipId;

  const search = document.getElementById("assign-agent-search");
  const results = document.getElementById("assign-agent-results");
  const status = document.getElementById("assign-agent-status");
  const modal = document.getElementById("assign-agent-modal");

  if (!modal) {
    return;
  }

  if (search) {
    search.value = "";
  }

  if (results) {
    results.innerHTML = "";
  }

  if (status) {
    status.innerText = "";
  }

  modal.classList.add("active");
}


function closeAssignAgentModal() {
  const modal = document.getElementById("assign-agent-modal");

  if (modal) {
    modal.classList.remove("active");
  }

  assigningAgentRelationshipId = null;
}


async function searchAgentsForAssignment() {
  const search = document.getElementById("assign-agent-search");
  const resultsEl = document.getElementById("assign-agent-results");

  if (!search || !resultsEl || !window.sb) {
    return;
  }

  const query = search.value.trim();

  if (query.length < 2) {
    resultsEl.innerHTML = "";
    return;
  }

  const { data: agents, error } = await safeSupabaseQuery(
    (sb) => sb
      .from("agent_profiles")
      .select("id, profiles(full_name, phone)")
      .limit(20),
    [],
    "searchAgentsForAssignment"
  );

  if (error) {
    console.error("Agent search failed:", error.message);
    resultsEl.innerHTML = "";
    return;
  }

  const normalizedQuery = query.toLowerCase();

  const filtered = (agents || []).filter(
    agent => (agent.profiles?.full_name || "").toLowerCase().includes(normalizedQuery)
  );

  if (filtered.length === 0) {
    resultsEl.innerHTML = `<div class="loading-text">No matching agents found.</div>`;
    return;
  }

  resultsEl.innerHTML = filtered.map(agent => {
    const name = agent.profiles?.full_name || "Agent";

    return `
      <div class="manifest" style="padding:12px; cursor:pointer;"
           data-agent-id="${relationshipEscapeAttribute(agent.id)}"
           data-agent-name="${relationshipEscapeAttribute(name)}"
           onclick="assignAgentToRelationship(this.dataset.agentId, this.dataset.agentName)">
        <div class="m-name">${relationshipEscapeHtml(name)}</div>
        <div class="m-loc">${relationshipEscapeHtml(agent.profiles?.phone || "")}</div>
      </div>
    `;
  }).join("");
}


async function assignAgentToRelationship(agentId, agentName) {
  if (!assigningAgentRelationshipId || !window.sb) {
    return;
  }

  const status = document.getElementById("assign-agent-status");

  if (!status) {
    return;
  }

  status.innerText = `Assigning ${agentName}...`;

  // Preserve assignment history
  const { error: unassignError } = await window.sb
    .from("relationship_agents")
    .update({ unassigned_at: new Date().toISOString() })
    .eq("relationship_id", assigningAgentRelationshipId)
    .eq("is_primary", true)
    .is("unassigned_at", null);

  if (unassignError) {
    status.innerText = "Error: " + unassignError.message;
    return;
  }

  const { error } = await window.sb
    .from("relationship_agents")
    .insert({
      relationship_id: assigningAgentRelationshipId,
      agent_id: agentId,
      is_primary: true,
      assigned_at: new Date().toISOString()
    });

  if (error) {
    status.innerText = "Error: " + error.message;
    return;
  }

  status.innerText = `${agentName} assigned!`;

  setTimeout(() => {
    closeAssignAgentModal();
    loadMyTradeRelationships();
  }, 1200);
}


// ==========================================================================
// DISTRIBUTOR — PAYMENT METHODS
// ==========================================================================

let managingPaymentMethodsRelationshipId = null;


function openManagePaymentMethodsModal(relationshipId) {
  managingPaymentMethodsRelationshipId = relationshipId;

  const method = document.getElementById("new-payment-method");
  const limit = document.getElementById("new-payment-method-limit");
  const status = document.getElementById("manage-payment-status");
  const modal = document.getElementById("manage-payment-modal");

  if (!modal) {
    return;
  }

  if (method) {
    method.value = "";
  }

  if (limit) {
    limit.value = "";
  }

  if (status) {
    status.innerText = "";
  }

  modal.classList.add("active");

  loadExistingPaymentMethodsForModal(relationshipId);
}


function closeManagePaymentMethodsModal() {
  const modal = document.getElementById("manage-payment-modal");

  if (modal) {
    modal.classList.remove("active");
  }

  managingPaymentMethodsRelationshipId = null;
}


async function loadExistingPaymentMethodsForModal(relationshipId) {
  const listEl = document.getElementById("existing-payment-methods");

  if (!listEl || !window.sb) {
    return;
  }

  listEl.innerHTML = `<div class="loading-text">Loading...</div>`;

  const { data: methods, error } = await safeSupabaseQuery(
    (sb) => sb
      .from("relationship_payment_methods")
      .select("id, payment_method, is_default, is_active, transaction_limit")
      .eq("relationship_id", relationshipId)
      .order("created_at", { ascending: false }),
    [],
    "loadExistingPaymentMethodsForModal"
  );

  if (error) {
    console.error("Payment methods lookup failed:", error.message);
    listEl.innerHTML = `<div class="loading-text">Could not load payment methods.</div>`;
    return;
  }

  if (!methods || methods.length === 0) {
    listEl.innerHTML = `<div class="loading-text">No payment methods added yet.</div>`;
    return;
  }

  listEl.innerHTML = methods.map(method => `
    <div class="manifest" style="padding:10px 14px;">
      <div class="manifest-top">
        <div>
          <span style="font-size:13px; font-weight:600;">
            ${relationshipEscapeHtml(method.payment_method)}
          </span>
          ${method.is_default ? `
            <span class="stamp-badge" style="font-size:8px; padding:2px 6px; border-color:var(--ok); color:var(--ok); transform:none; margin-left:6px;">
              DEFAULT
            </span>
          ` : ""}
          ${!method.is_active ? `
            <span class="stamp-badge" style="font-size:8px; padding:2px 6px; border-color:var(--brass); color:var(--brass); transform:none; margin-left:6px;">
              INACTIVE
            </span>
          ` : ""}
        </div>
      </div>

      ${method.transaction_limit != null ? `
        <div class="m-loc">Transaction limit: ${relationshipMoney(method.transaction_limit)}</div>
      ` : ""}

      <div class="action-buttons">
        ${!method.is_default ? `
          <button class="btn btn-outline" 
                  data-method-id="${relationshipEscapeAttribute(method.id)}"
                  onclick="makePaymentMethodDefault(this.dataset.methodId)">
            Make Default
          </button>
        ` : ""}

        <button class="btn ${method.is_active ? "btn-danger" : "btn-success"}"
                data-method-id="${relationshipEscapeAttribute(method.id)}"
                data-new-active="${!method.is_active}"
                onclick="togglePaymentMethodActive(this.dataset.methodId, this.dataset.newActive === 'true')">
          ${method.is_active ? "Deactivate" : "Activate"}
        </button>
      </div>
    </div>
  `).join("");
}


async function addPaymentMethod() {
  const status = document.getElementById("manage-payment-status");

  if (!status || !window.sb) {
    return;
  }

  const methodName = document.getElementById("new-payment-method")?.value.trim() || "";
  const limitRaw = document.getElementById("new-payment-method-limit")?.value || "";

  if (!methodName) {
    status.innerText = "Enter a payment method name.";
    return;
  }

  if (!managingPaymentMethodsRelationshipId) {
    status.innerText = "No relationship selected.";
    return;
  }

  status.innerText = "Adding...";

  const transactionLimit = limitRaw !== "" ? parseFloat(limitRaw) : null;

  if (transactionLimit != null && !Number.isFinite(transactionLimit)) {
    status.innerText = "Invalid transaction limit.";
    return;
  }

  const { error } = await window.sb
    .from("relationship_payment_methods")
    .insert({
      relationship_id: managingPaymentMethodsRelationshipId,
      payment_method: methodName,
      is_active: true,
      is_default: false,
      transaction_limit: transactionLimit
    });

  if (error) {
    status.innerText = "Error: " + error.message;
    return;
  }

  status.innerText = "Added!";

  const methodInput = document.getElementById("new-payment-method");
  const limitInput = document.getElementById("new-payment-method-limit");

  if (methodInput) {
    methodInput.value = "";
  }

  if (limitInput) {
    limitInput.value = "";
  }

  loadExistingPaymentMethodsForModal(managingPaymentMethodsRelationshipId);
}


async function makePaymentMethodDefault(methodId) {
  if (!managingPaymentMethodsRelationshipId || !window.sb) {
    return;
  }

  const { error: clearError } = await window.sb
    .from("relationship_payment_methods")
    .update({ is_default: false })
    .eq("relationship_id", managingPaymentMethodsRelationshipId)
    .eq("is_default", true);

  if (clearError) {
    console.error("Could not clear default payment method:", clearError.message);
    return;
  }

  const { error } = await window.sb
    .from("relationship_payment_methods")
    .update({ is_default: true })
    .eq("id", methodId);

  if (error) {
    console.error("Could not make payment method default:", error.message);
    return;
  }

  loadExistingPaymentMethodsForModal(managingPaymentMethodsRelationshipId);
}


async function togglePaymentMethodActive(methodId, newActiveState) {
  if (!window.sb) {
    return;
  }

  const { error } = await window.sb
    .from("relationship_payment_methods")
    .update({ is_active: newActiveState })
    .eq("id", methodId);

  if (error) {
    console.error("Could not update payment method:", error.message);
    return;
  }

  loadExistingPaymentMethodsForModal(managingPaymentMethodsRelationshipId);
}


// ==========================================================================
// DISTRIBUTOR — PREFERRED PRODUCTS
// ==========================================================================

let managingPreferencesRelationshipId = null;


function openManagePreferredProductsModal(relationshipId) {
  managingPreferencesRelationshipId = relationshipId;

  const search = document.getElementById("preference-product-search");
  const results = document.getElementById("preference-search-results");
  const status = document.getElementById("manage-preferences-status");
  const modal = document.getElementById("manage-preferences-modal");

  if (!modal) {
    return;
  }

  if (search) {
    search.value = "";
  }

  if (results) {
    results.innerHTML = "";
  }

  if (status) {
    status.innerText = "";
  }

  modal.classList.add("active");

  loadExistingPreferredProducts(relationshipId);
}


function closeManagePreferredProductsModal() {
  const modal = document.getElementById("manage-preferences-modal");

  if (modal) {
    modal.classList.remove("active");
  }

  managingPreferencesRelationshipId = null;
}


async function loadExistingPreferredProducts(relationshipId) {
  const listEl = document.getElementById("existing-preferred-products");

  if (!listEl || !window.sb) {
    return;
  }

  listEl.innerHTML = `<div class="loading-text">Loading...</div>`;

  const { data: prefs, error } = await safeSupabaseQuery(
    (sb) => sb
      .from("relationship_product_preferences")
      .select("id, product_id, negotiated_unit_price")
      .eq("relationship_id", relationshipId)
      .eq("preferred", true),
    [],
    "loadExistingPreferredProducts"
  );

  if (error) {
    console.error("Preferred products lookup failed:", error.message);
    listEl.innerHTML = `<div class="loading-text">Could not load preferred products.</div>`;
    return;
  }

  if (!prefs || prefs.length === 0) {
    listEl.innerHTML = `<div class="loading-text">No preferred products marked yet.</div>`;
    return;
  }

  const productIds = prefs.map(preference => preference.product_id).filter(id => id);

  if (productIds.length === 0) {
    listEl.innerHTML = `<div class="loading-text">No preferred products marked yet.</div>`;
    return;
  }

  const { data: products } = await safeSupabaseQuery(
    (sb) => sb
      .from("products")
      .select("id, name, price")
      .in("id", productIds),
    [],
    "loadExistingPreferredProducts - products"
  );

  const productMap = {};
  (products || []).forEach(product => {
    productMap[product.id] = product;
  });

  listEl.innerHTML = prefs.map(preference => {
    const product = productMap[preference.product_id];

    if (!product) {
      return "";
    }

    return `
      <div class="manifest" style="padding:10px 14px;">
        <div class="manifest-top">
          <div>
            <span style="font-size:13px; font-weight:600;">
              ${relationshipEscapeHtml(product.name)} ★
            </span>
            <div class="m-loc">
              Public: ${relationshipMoney(product.price || 0)}
              ${preference.negotiated_unit_price != null ? `
                · Negotiated: ${relationshipMoney(preference.negotiated_unit_price)}
              ` : ""}
            </div>
          </div>
        </div>

        <div class="action-buttons">
          <button class="btn btn-outline"
                  data-pref-id="${relationshipEscapeAttribute(preference.id)}"
                  onclick="setNegotiatedPrice(this.dataset.prefId)">
            ${preference.negotiated_unit_price != null ? "Change" : "Set"} Price
          </button>

          <button class="btn btn-danger"
                  data-pref-id="${relationshipEscapeAttribute(preference.id)}"
                  onclick="removeProductPreference(this.dataset.prefId)">
            Remove
          </button>
        </div>
      </div>
    `;
  }).join("");
}


async function searchDistributorProductsForPreference() {
  const search = document.getElementById("preference-product-search");
  const resultsEl = document.getElementById("preference-search-results");

  if (!search || !resultsEl || !window.sb) {
    return;
  }

  const query = search.value.trim();

  if (query.length < 2) {
    resultsEl.innerHTML = "";
    return;
  }

  const { data: products, error } = await safeSupabaseQuery(
    (sb) => sb
      .from("products")
      .select("id, name, price, sku")
      .eq("distributor_id", currentUser.id)
      .ilike("name", `%${query}%`)
      .limit(10),
    [],
    "searchDistributorProductsForPreference"
  );

  if (error) {
    console.error("Product search failed:", error.message);
    resultsEl.innerHTML = "";
    return;
  }

  if (!products || products.length === 0) {
    resultsEl.innerHTML = `<div class="loading-text">No matching products found.</div>`;
    return;
  }

  resultsEl.innerHTML = products.map(product => `
    <div class="manifest" style="padding:10px 14px; cursor:pointer;"
         data-product-id="${relationshipEscapeAttribute(product.id)}"
         onclick="addProductPreference(this.dataset.productId)">
      <div class="m-name">${relationshipEscapeHtml(product.name)}</div>
      <div class="m-loc">
        ${relationshipEscapeHtml(product.sku || "No SKU")} · ${relationshipMoney(product.price || 0)}
      </div>
    </div>
  `).join("");
}


async function addProductPreference(productId) {
  const status = document.getElementById("manage-preferences-status");

  if (!status || !window.sb) {
    return;
  }

  if (!managingPreferencesRelationshipId) {
    status.innerText = "No relationship selected.";
    return;
  }

  status.innerText = "Adding...";

  const { error } = await window.sb
    .from("relationship_product_preferences")
    .insert({
      relationship_id: managingPreferencesRelationshipId,
      product_id: productId,
      preferred: true
    });

  if (error) {
    status.innerText = "Error: " + error.message;
    return;
  }

  status.innerText = "Added!";

  const search = document.getElementById("preference-product-search");
  const results = document.getElementById("preference-search-results");

  if (search) {
    search.value = "";
  }

  if (results) {
    results.innerHTML = "";
  }

  loadExistingPreferredProducts(managingPreferencesRelationshipId);
}


async function setNegotiatedPrice(prefId) {
  if (!window.sb) {
    return;
  }

  const priceInput = prompt("Enter the negotiated price for this product (₦), or leave blank to clear it:");

  if (priceInput === null) {
    return;
  }

  const trimmed = priceInput.trim();
  const price = trimmed === "" ? null : parseFloat(trimmed);

  if (price !== null && (!Number.isFinite(price) || price < 0)) {
    alert("Enter a valid non-negative price.");
    return;
  }

  const { error } = await window.sb
    .from("relationship_product_preferences")
    .update({ negotiated_unit_price: price })
    .eq("id", prefId);

  if (error) {
    alert("Could not update negotiated price: " + error.message);
    return;
  }

  loadExistingPreferredProducts(managingPreferencesRelationshipId);
}


async function removeProductPreference(prefId) {
  if (!window.sb) {
    return;
  }

  if (!confirm("Remove this product from preferred?")) {
    return;
  }

  const { error } = await window.sb
    .from("relationship_product_preferences")
    .delete()
    .eq("id", prefId);

  if (error) {
    alert("Could not remove product preference: " + error.message);
    return;
  }

  loadExistingPreferredProducts(managingPreferencesRelationshipId);
}


// ==========================================================================
// AGENT — RELATIONSHIP / BUYER REFERRAL FOUNDATION
// ==========================================================================
//
// This section deliberately does NOT let an agent select an arbitrary
// distributor.
//
// The agent's active distributor attachment is the authority for the
// referral path. The database RPC should verify the agent's attachment and
// create the relationship using that distributor.
//
// Expected RPC contract:
//
//   create_agent_referred_buyer_relationship
//
// Parameters:
//   p_buyer_id
//
// The server/database resolves the distributor from the authenticated
// agent's active attachment.
//
// This prevents a malicious/modified frontend from doing:
//
//   agent → arbitrary distributor_id
//
// ==========================================================================

async function createAgentReferredBuyerRelationship(buyerId, buyerName) {
  if (!currentUser || currentUser.role !== "agent" || !window.sb) {
    return;
  }

  const status = document.getElementById("agent-refer-buyer-status");

  if (!status) {
    return;
  }

  if (!buyerId) {
    status.innerText = "Buyer is required.";
    return;
  }

  status.innerText = `Creating buyer relationship for ${buyerName || "buyer"}...`;

  const { error } = await window.sb.rpc("create_agent_referred_buyer_relationship", {
    p_buyer_id: buyerId
  });

  if (error) {
    status.innerText = "Error: " + error.message;
    return;
  }

  status.innerText = `${buyerName || "Buyer"} added through your distributor relationship.`;

  loadMyAgentRelationships();
}


// ==========================================================================
// OPTIONAL AGENT BUYER SEARCH
// ==========================================================================
//
// The UI may call this function from an agent referral modal.
//
// The function only searches buyers. It does NOT expose distributor
// selection. Distributor resolution belongs to the RPC/database layer.
// ==========================================================================

async function searchBuyersForAgentReferral() {
  const search = document.getElementById("agent-refer-buyer-search");
  const resultsEl = document.getElementById("agent-refer-buyer-results");

  if (!search || !resultsEl || !window.sb) {
    return;
  }

  const query = search.value.trim();

  if (query.length < 2) {
    resultsEl.innerHTML = "";
    return;
  }

  const { data: buyers, error } = await safeSupabaseQuery(
    (sb) => sb
      .from("buyer_profiles")
      .select("id, name, location, profiles(full_name, phone)")
      .or(`name.ilike.%${query}%`)
      .limit(10),
    [],
    "searchBuyersForAgentReferral"
  );

  if (error) {
    console.error("Agent buyer search failed:", error.message);
    resultsEl.innerHTML = "";
    return;
  }

  if (!buyers || buyers.length === 0) {
    resultsEl.innerHTML = `<div class="loading-text">No matching buyers found.</div>`;
    return;
  }

  resultsEl.innerHTML = buyers.map(buyer => {
    const name = buyer.name || buyer.profiles?.full_name || "Buyer";

    return `
      <div class="manifest" style="padding:12px; cursor:pointer;"
           data-buyer-id="${relationshipEscapeAttribute(buyer.id)}"
           data-buyer-name="${relationshipEscapeAttribute(name)}"
           onclick="createAgentReferredBuyerRelationship(this.dataset.buyerId, this.dataset.buyerName)">
        <div class="m-name">${relationshipEscapeHtml(name)}</div>
        <div class="m-loc">
          ${relationshipEscapeHtml(buyer.location || "")}
          ${buyer.profiles?.phone ? " · " + relationshipEscapeHtml(buyer.profiles.phone) : ""}
        </div>
      </div>
    `;
  }).join("");
}


// ==========================================================================
// INITIALIZATION (FIXED)
// ==========================================================================
//
// Safe to call after auth.js has established currentUser.
// Also safe to call again when the application changes view.
// ==========================================================================

async function initRelationshipLayer() {
  // Check all dependencies
  if (!window.sb) {
    console.error('Supabase client not initialized. Waiting for supabase-ready event...');
    
    // Listen for supabase-ready event
    window.addEventListener('supabase-ready', () => {
      console.log('Supabase ready event received, re-initializing relationship layer');
      initRelationshipLayer();
    }, { once: true });
    
    return;
  }
  
  if (!currentUser) {
    console.log('No current user, skipping relationship layer init');
    return;
  }

  if (relationshipLayerInitialized) {
    console.log('Relationship layer already initialized');
    return;
  }

  console.log('Initializing relationship layer for role:', currentUser.role);

  try {
    if (currentUser.role === "buyer") {
      await loadMyTradeRelationship();
    } else if (currentUser.role === "distributor") {
      await loadMyTradeRelationships();
    } else if (currentUser.role === "agent") {
      await loadMyAgentRelationships();
    }
    
    relationshipLayerInitialized = true;
    console.log('Relationship layer initialized successfully');
  } catch (error) {
    console.error('Relationship layer initialization failed:', error);
  }
}

// Listen for Supabase ready event
window.addEventListener('supabase-ready', () => {
  console.log('Supabase ready, re-initializing relationship layer');
  relationshipLayerInitialized = false;
  initRelationshipLayer();
});

// Listen for auth state changes (assuming auth.js dispatches this event)
window.addEventListener('auth-state-changed', (event) => {
  if (event.detail?.user) {
    console.log('Auth state changed, re-initializing relationship layer');
    currentUser = event.detail.user;
    relationshipLayerInitialized = false;
    initRelationshipLayer();
  }
});

// Initialize on DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    initRelationshipLayer();
  });
} else {
  initRelationshipLayer();
}

// Export functions for global scope
window.loadMyTradeRelationship = loadMyTradeRelationship;
window.loadMyTradeRelationships = loadMyTradeRelationships;
window.loadMyAgentRelationships = loadMyAgentRelationships;
window.initRelationshipLayer = initRelationshipLayer;
window.openEditTermsModal = openEditTermsModal;
window.closeEditTermsModal = closeEditTermsModal;
window.saveRelationshipTerms = saveRelationshipTerms;
window.openInviteBuyerModal = openInviteBuyerModal;
window.closeInviteBuyerModal = closeInviteBuyerModal;
window.searchBuyersForInvite = searchBuyersForInvite;
window.inviteBuyerToRelationship = inviteBuyerToRelationship;
window.updateRelationshipStatus = updateRelationshipStatus;
window.openAssignAgentModal = openAssignAgentModal;
window.closeAssignAgentModal = closeAssignAgentModal;
window.searchAgentsForAssignment = searchAgentsForAssignment;
window.assignAgentToRelationship = assignAgentToRelationship;
window.openManagePaymentMethodsModal = openManagePaymentMethodsModal;
window.closeManagePaymentMethodsModal = closeManagePaymentMethodsModal;
window.addPaymentMethod = addPaymentMethod;
window.makePaymentMethodDefault = makePaymentMethodDefault;
window.togglePaymentMethodActive = togglePaymentMethodActive;
window.openManagePreferredProductsModal = openManagePreferredProductsModal;
window.closeManagePreferredProductsModal = closeManagePreferredProductsModal;
window.searchDistributorProductsForPreference = searchDistributorProductsForPreference;
window.addProductPreference = addProductPreference;
window.setNegotiatedPrice = setNegotiatedPrice;
window.removeProductPreference = removeProductPreference;
window.searchBuyersForAgentReferral = searchBuyersForAgentReferral;
window.createAgentReferredBuyerRelationship = createAgentReferredBuyerRelationship;

// ==========================================================================
// END OF RELATIONSHIP.JS
// ==========================================================================
