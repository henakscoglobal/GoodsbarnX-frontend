// ==========================================================================
// GoodsbarnX — relationship.js
// Canonical relationship commerce layer: lifecycle, terms, agents, disputes,
// payment methods, preferred products, distributor dashboard, buyer invites.
// Plain global script. Loads fourteenth (Canon §10).
//
// V1.8.2.6 remediation Phase 1+2 (D2, D3, D4):
//   - Absorbed the inline goodsbarnx-distributor-v111 block (distributor
//     dashboard: attention, network, command grid, agent approval).
//   - Absorbed the inline Invite Buyer bridge (phone-based buyer_locks path).
//   - Absorbed the responsibility set of the deleted js/distributor.js.
//   - Defined openDistributorTools() (previously called, never declared).
//   - Registered a "relationship" screen loader.
//   - Renders into #screen-relationship containers (per D2).
//
// Canon §6: a relationship becomes active only when consent/authorization
// conditions are satisfied. The RPC create_trade_relationship() is the
// sole creation path. No direct insert path exists in this file.
// ==========================================================================

// ==========================================================================
// CONSTANTS
// ==========================================================================

const DISPUTE_STATUS_COLORS = {
  open: "var(--stamp)",
  pending: "var(--brass)",
  under_review: "var(--brass)",
  resolved: "var(--ok)",
  closed: "var(--ok)"
};

const DISPUTE_OPEN_STATUSES = ["open", "pending", "under_review"];

const RELATIONSHIP_STATUS_LABELS = {
  pending:    "Pending",
  active:     "Active",
  paused:     "Paused",
  released:   "Released",
  terminated: "Terminated"
};

const RELATIONSHIP_EVENT_LABELS = {
  relationship_created:      "Relationship created",
  relationship_activated:    "Relationship activated",
  relationship_paused:       "Relationship paused",
  relationship_resumed:      "Relationship resumed",
  relationship_released:     "Relationship released",
  relationship_terminated:   "Relationship terminated",
  commercial_terms_created:  "Trade terms set",
  commercial_terms_updated:  "Trade terms updated",
  agent_assigned:            "Agent assigned",
  agent_unassigned:          "Agent unassigned",
  payment_method_added:      "Payment method added",
  payment_method_changed:    "Payment method changed",
  credit_enabled:            "Credit enabled",
  credit_limit_changed:      "Credit limit changed",
  product_preference_added:  "Product preference added",
  dispute_opened:            "Dispute opened",
  dispute_resolved:          "Dispute resolved"
};

const RELATIONSHIP_ACTIONS = {
  pending: [{ label: "Activate", newStatus: "active" }],
  active:  [
    { label: "Pause",   newStatus: "paused"   },
    { label: "Release", newStatus: "released" }
  ],
  paused: [
    { label: "Resume",  newStatus: "active"   },
    { label: "Release", newStatus: "released" }
  ]
};

// ==========================================================================
// STATE
// ==========================================================================

let relationshipLayerInitialized = false;
let relationshipLoadInProgress = false;

let distributorDashboardState = {
  initialized: false,
  pendingAgents: [],
  acceptedAgents: [],
  buyers: [],
  loading: false,
  processingAgentId: null,
  retryCount: 0,
  maxRetries: 10
};

let editingTermsRelationshipId = null;
let assigningAgentRelationshipId = null;
let managingPaymentMethodsRelationshipId = null;
let managingPreferencesRelationshipId = null;

// ==========================================================================
// SMALL HELPERS (private)
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
function relationshipEscapeAttribute(value) { return relationshipEscapeHtml(value); }

function relationshipFormatDate(value) {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString();
}
function relationshipFormatDateTime(value) {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString();
}
function relationshipMoney(value) {
  const n = Number(value);
  return Number.isFinite(n) ? "₦" + n.toLocaleString() : "₦0";
}
function relationshipSafeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
function formatEventType(eventType) {
  if (!eventType) return "Relationship event";
  return RELATIONSHIP_EVENT_LABELS[eventType] || String(eventType).replace(/_/g, " ");
}
function getRelationshipStatusColor(status) {
  return status === "active" ? "var(--ok)" : "var(--brass)";
}
function profileDisplayName(profile, fallbackId) {
  if (!profile) return fallbackId ? "User " + String(fallbackId).slice(0, 8) : "Unknown user";
  return profile.business_name || profile.full_name ||
    (profile.id ? "User " + String(profile.id).slice(0, 8) : "Unknown user");
}
function formatShortDate(value) {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" :
    d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

const __gbxRelWarned = Object.create(null);
function relWarnMissing(id) {
  if (__gbxRelWarned[id]) return;
  __gbxRelWarned[id] = true;
  console.warn("[GoodsbarnX/relationship] DOM target #" + id + " is missing from index.html.");
}

async function safeSupabaseQuery(queryFn, fallbackData = null, errorContext = "") {
  if (!window.sb) {
    console.error("[GoodsbarnX/relationship] Supabase not initialized for " + errorContext);
    return { data: fallbackData, error: new Error("Supabase client not initialized") };
  }
  try {
    return await queryFn(window.sb);
  } catch (error) {
    console.error("[GoodsbarnX/relationship] query failed (" + errorContext + "):", error);
    return { data: fallbackData, error: error };
  }
}

async function getProfiles(ids) {
  const unique = [...new Set((ids || []).filter(Boolean))];
  if (!unique.length || !window.sb) return {};
  try {
    const { data, error } = await window.sb
      .from("profiles")
      .select("id, full_name, business_name, role")
      .in("id", unique);
    if (error) {
      console.warn("[GoodsbarnX/relationship] profile lookup failed:", error.message);
      return {};
    }
    const map = {};
    (data || []).forEach(p => { map[p.id] = p; });
    return map;
  } catch (error) {
    console.error("[GoodsbarnX/relationship] getProfiles exception:", error);
    return {};
  }
}

function setDistributorStatus(message, type) {
  const el = document.getElementById("distributor-management-status");
  if (!el) return;
  el.textContent = message || "";
  el.className = "status-msg";
  el.style.color = type === "error" ? "var(--stamp)" :
                   type === "success" ? "var(--ok)" : "";
}

// ==========================================================================
// DISPUTES
// ==========================================================================

function renderDisputeSummaryLine(disputes) {
  if (!disputes || disputes.length === 0) return "";
  const open = disputes.filter(d => DISPUTE_OPEN_STATUSES.indexOf(d.status) !== -1).length;
  const color = open > 0 ? "var(--stamp)" : "var(--ok)";
  return '<div style="font-size:12px; margin-top:4px; color:' + color + '; font-weight:600;">' +
    disputes.length + ' dispute' + (disputes.length === 1 ? "" : "s") +
    (open > 0 ? " · " + open + " open" : " · all resolved") +
    '</div>';
}

async function loadRelationshipDisputes(relationshipId) {
  const container = document.getElementById("my-relationship-disputes");
  if (!container || !relationshipId) return;

  const { data: disputes, error } = await safeSupabaseQuery(
    sb => sb.from("relationship_disputes")
      .select("category, description, status, resolution, created_at, resolved_at")
      .eq("relationship_id", relationshipId)
      .order("created_at", { ascending: false }),
    [],
    "loadRelationshipDisputes"
  );
  if (error) { container.innerHTML = ""; return; }

  if (!disputes || disputes.length === 0) { container.innerHTML = ""; return; }

  container.innerHTML =
    '<div class="section-label">Relationship Disputes</div>' +
    disputes.map(d => {
      const color = DISPUTE_STATUS_COLORS[d.status] || "var(--brass)";
      return '<div class="manifest">' +
        '<div class="manifest-top">' +
          '<div>' +
            '<div class="m-name">' + relationshipEscapeHtml(d.category || "Dispute") + '</div>' +
            '<div class="m-loc">' + relationshipEscapeHtml(d.description || "") + '</div>' +
          '</div>' +
          '<span class="stamp-badge" style="border-color:' + color + '; color:' + color + ';">' +
            relationshipEscapeHtml(String(d.status || "").toUpperCase()) +
          '</span>' +
        '</div>' +
        (d.resolution
          ? '<div class="m-loc" style="margin-top:8px; border-top:1px dashed var(--line-dark); padding-top:8px;">Resolution: ' + relationshipEscapeHtml(d.resolution) + '</div>'
          : "") +
        '<div class="m-loc" style="margin-top:6px; font-size:10px;">' +
          relationshipEscapeHtml(relationshipFormatDate(d.created_at)) +
          (d.resolved_at ? ' · Resolved ' + relationshipEscapeHtml(relationshipFormatDate(d.resolved_at)) : "") +
        '</div>' +
      '</div>';
    }).join("");
}

// ==========================================================================
// RELATIONSHIP HISTORY
// ==========================================================================

async function loadRelationshipHistory(relationshipId) {
  const container = document.getElementById("my-relationship-history");
  if (!container || !relationshipId) return;

  const { data: events, error } = await safeSupabaseQuery(
    sb => sb.from("relationship_events")
      .select("event_type, created_at")
      .eq("relationship_id", relationshipId)
      .order("created_at", { ascending: false })
      .limit(10),
    [],
    "loadRelationshipHistory"
  );
  if (error) { container.innerHTML = ""; return; }

  if (!events || events.length === 0) {
    container.innerHTML =
      '<div class="section-label">Relationship History</div>' +
      '<div class="loading-text">No history yet.</div>';
    return;
  }

  container.innerHTML =
    '<div class="section-label">Relationship History</div>' +
    '<div class="manifest" style="padding:6px 16px;">' +
      events.map((event, index) =>
        '<div style="padding:10px 0; ' + (index < events.length - 1 ? "border-bottom:1px dashed var(--line-dark);" : "") + '">' +
          '<div style="font-size:13px; font-weight:600;">' + relationshipEscapeHtml(formatEventType(event.event_type)) + '</div>' +
          '<div style="font-size:11px; color:rgba(18,21,28,0.5); margin-top:2px;">' + relationshipEscapeHtml(relationshipFormatDateTime(event.created_at)) + '</div>' +
        '</div>'
      ).join("") +
    '</div>';
}

// ==========================================================================
// TRUST / LOYALTY
// ==========================================================================

function renderTrustLine(trust) {
  if (!trust || trust.trust_score == null) return "";
  const score = relationshipSafeNumber(trust.trust_score);
  const color = score >= 70 ? "var(--ok)" : score >= 40 ? "var(--brass)" : "var(--stamp)";
  const completed = relationshipSafeNumber(trust.completed_orders);
  const disputed  = relationshipSafeNumber(trust.disputed_orders);
  return '<div style="display:flex; align-items:center; gap:6px; margin-top:6px; font-size:12px;">' +
    '<span style="font-weight:700; color:' + color + ';">Trust ' + score + '/100</span>' +
    '<span style="color:rgba(18,21,28,0.5);">' +
      '· ' + completed + ' completed order' + (completed === 1 ? "" : "s") +
      (disputed ? ' · ' + disputed + ' disputed' : "") +
    '</span>' +
  '</div>';
}

function renderLoyaltyLine(loyalty) {
  if (!loyalty || !loyalty.loyalty_level) return "";
  const points = loyalty.loyalty_points != null ? relationshipSafeNumber(loyalty.loyalty_points) : null;
  const consecutive = relationshipSafeNumber(loyalty.consecutive_order_count);
  return '<div style="display:flex; align-items:center; gap:6px; margin-top:4px; font-size:12px;">' +
    '<span class="stamp-badge" style="font-size:9px; padding:2px 6px; border-color:var(--brass); color:var(--brass-dark); transform:none;">' +
      relationshipEscapeHtml(String(loyalty.loyalty_level).toUpperCase()) +
    '</span>' +
    '<span style="color:rgba(18,21,28,0.5);">' +
      (points != null ? points + ' pts' : "") +
      (consecutive ? ' · ' + consecutive + ' in a row' : "") +
    '</span>' +
  '</div>';
}

// ==========================================================================
// BUYER — MY TRADE RELATIONSHIP
// ==========================================================================

async function loadMyTradeRelationship() {
  const container = document.getElementById("my-relationship-card");
  if (!container || !currentUser || currentUser.role !== "buyer") return;

  if (!window.sb) { container.innerHTML = ""; return; }

  container.innerHTML = '<div class="loading-text">Loading your distributor relationship...</div>';

  const { data: relationship, error } = await safeSupabaseQuery(
    sb => sb.from("trade_relationships").select("*")
      .eq("buyer_id", currentUser.id)
      .eq("is_primary", true)
      .maybeSingle(),
    null,
    "loadMyTradeRelationship"
  );
  if (error) { container.innerHTML = ""; return; }
  if (!relationship) { container.innerHTML = ""; return; }

  const [distributorResult, termsResult, trustResult, loyaltyResult] = await Promise.allSettled([
    window.sb.from("distributor_profiles")
      .select("business_name, location, market")
      .eq("id", relationship.distributor_id).maybeSingle(),
    window.sb.from("current_relationship_trade_terms")
      .select("credit_enabled, credit_limit, credit_days")
      .eq("buyer_id", currentUser.id)
      .eq("distributor_id", relationship.distributor_id).maybeSingle(),
    window.sb.from("relationship_trust")
      .select("trust_score, completed_orders, disputed_orders")
      .eq("relationship_id", relationship.id).maybeSingle(),
    window.sb.from("relationship_loyalty")
      .select("loyalty_level, loyalty_points, consecutive_order_count")
      .eq("relationship_id", relationship.id).maybeSingle()
  ]);

  const distributor = distributorResult.status === "fulfilled" ? distributorResult.value.data : null;
  const terms       = termsResult.status === "fulfilled" ? termsResult.value.data : null;
  const trust       = trustResult.status === "fulfilled" ? trustResult.value.data : null;
  const loyalty     = loyaltyResult.status === "fulfilled" ? loyaltyResult.value.data : null;

  const distributorName = distributor?.business_name || "Your distributor";
  const statusLabel = RELATIONSHIP_STATUS_LABELS[relationship.status] || relationship.status;
  const startedDate = relationship.relationship_started_at
    ? relationshipFormatDate(relationship.relationship_started_at) : null;

  const creditHtml = terms?.credit_enabled
    ? '<div style="border-top:1px dashed var(--line-dark); margin-top:10px; padding-top:10px;">' +
        '<div style="font-size:11px; text-transform:uppercase; letter-spacing:0.05em; color:rgba(18,21,28,0.5); font-weight:700; margin-bottom:4px;">Credit Terms (Approved)</div>' +
        '<div style="font-size:13px;">' +
          (terms.credit_limit != null ? 'Limit: <strong>' + relationshipMoney(terms.credit_limit) + '</strong>' : "") +
          (terms.credit_days != null ? ' · ' + terms.credit_days + ' days' : "") +
        '</div>' +
      '</div>'
    : "";

  const statusColor = getRelationshipStatusColor(relationship.status);

  container.innerHTML =
    '<div class="manifest">' +
      '<div class="manifest-top">' +
        '<div>' +
          '<div class="m-name">' + relationshipEscapeHtml(distributorName) + '</div>' +
          '<div class="m-loc">' + relationshipEscapeHtml(distributor?.location || "") +
            (distributor?.market ? " · " + relationshipEscapeHtml(distributor.market) : "") +
          '</div>' +
        '</div>' +
        '<span class="stamp-badge" style="border-color:' + statusColor + '; color:' + statusColor + ';">' +
          relationshipEscapeHtml(String(statusLabel).toUpperCase()) +
        '</span>' +
      '</div>' +
      (startedDate ? '<div class="m-loc" style="margin-top:8px;">Trading together since ' + relationshipEscapeHtml(startedDate) + '</div>' : "") +
      renderTrustLine(trust) +
      renderLoyaltyLine(loyalty) +
      creditHtml +
    '</div>';

  loadMyPreferredProducts(relationship.id, relationship.distributor_id, distributorName);
  loadRelationshipHistory(relationship.id);
  loadRelationshipDisputes(relationship.id);
  loadRelationshipPaymentMethods(relationship.id);
}

// ==========================================================================
// BUYER — PREFERRED PRODUCTS (Canon §31 per-product negotiated tier)
// ==========================================================================

async function loadMyPreferredProducts(relationshipId, distributorId, distributorName) {
  const container = document.getElementById("my-preferred-products");
  if (!container || !window.sb) return;

  const { data: prefs, error } = await safeSupabaseQuery(
    sb => sb.from("relationship_product_preferences").select("*")
      .eq("relationship_id", relationshipId)
      .eq("preferred", true),
    [],
    "loadMyPreferredProducts"
  );
  if (error) { container.innerHTML = ""; return; }
  if (!prefs || prefs.length === 0) { container.innerHTML = ""; return; }

  const productIds = prefs.map(p => p.product_id);
  if (productIds.length === 0) { container.innerHTML = ""; return; }

  const { data: products } = await safeSupabaseQuery(
    sb => sb.from("products")
      .select("id, name, sku, brand, price, image_url, stock_quantity, status")
      .in("id", productIds),
    [],
    "loadMyPreferredProducts/products"
  );

  const productMap = {};
  (products || []).forEach(p => { productMap[p.id] = p; });

  const rows = prefs
    .map(pref => ({ pref, product: productMap[pref.product_id] }))
    .filter(row => row.product && row.product.status === "active");
  if (rows.length === 0) { container.innerHTML = ""; return; }

  container.innerHTML =
    '<div class="section-label">Your Preferred Products</div>' +
    rows.map(({ pref, product }) => {
      const publicPrice = relationshipSafeNumber(product.price);
      const hasNegotiated = pref.negotiated_unit_price != null;
      const finalPrice = hasNegotiated
        ? relationshipSafeNumber(pref.negotiated_unit_price)
        : publicPrice;

      let priceHtml;
      if (product.price == null && !hasNegotiated) {
        priceHtml = "Negotiable";
      } else if (hasNegotiated) {
        priceHtml =
          '<span style="text-decoration:line-through; color:rgba(18,21,28,0.4); font-size:11px;">' + relationshipMoney(publicPrice) + '</span> ' +
          '<span style="color:var(--ok); font-weight:700;">' + relationshipMoney(finalPrice) + '</span>';
      } else {
        priceHtml = relationshipMoney(publicPrice);
      }

      const productName   = relationshipEscapeHtml(product.name);
      const productIdSafe = relationshipEscapeAttribute(product.id);
      const distIdSafe    = relationshipEscapeAttribute(distributorId);
      const nameAttr      = relationshipEscapeAttribute(String(product.name));
      const distNameAttr  = relationshipEscapeAttribute(String(distributorName));

      return '<div class="product-item">' +
        '<div class="product-image" style="' +
          (product.image_url
            ? "background-image:url('" + relationshipEscapeAttribute(product.image_url) + "');"
            : "background-color:var(--ink-2);") +
        '"></div>' +
        '<div style="display:inline-block; width:calc(100% - 80px);">' +
          '<div style="font-weight:600; font-size:13px;">' +
            productName +
            ' <span style="color:var(--brass-dark); font-size:11px;">★</span>' +
          '</div>' +
          '<div style="font-size:11px; color:rgba(18,21,28,0.55); margin-top:2px;">' +
            (product.brand ? relationshipEscapeHtml(product.brand) + " · " : "") +
            relationshipEscapeHtml(product.sku || "No SKU") +
          '</div>' +
          '<div style="font-size:12px; margin-top:4px;">' + priceHtml + '</div>' +
          '<div style="margin-top:8px;">' +
            '<button class="btn btn-success"' +
              ' data-product-id="' + productIdSafe + '"' +
              ' data-distributor-id="' + distIdSafe + '"' +
              ' onclick="addToCart(this.dataset.productId, ' + JSON.stringify(String(product.name)) + ', ' +
                (Number(finalPrice) || 0) + ', this.dataset.distributorId, ' + JSON.stringify(String(distributorName)) + ')">' +
              'Add to Cart' +
            '</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    }).join("");
}

// ==========================================================================
// DISTRIBUTOR — MY TRADE RELATIONSHIPS
// ==========================================================================

async function loadMyTradeRelationships() {
  const container = document.getElementById("my-relationships-list");
  if (!container || !currentUser || currentUser.role !== "distributor") return;
  if (relationshipLoadInProgress) return;
  if (!window.sb) {
    container.innerHTML = '<div class="loading-text">System initialization error. Please refresh.</div>';
    return;
  }

  relationshipLoadInProgress = true;

  const inviteBtnHtml =
    '<div class="section-label" style="margin-top:0;">Your Trade Relationships</div>' +
    '<button class="btn btn-primary btn-block" style="margin-bottom:14px;" onclick="openInviteBuyerModal()">+ Invite a Buyer</button>';

  container.innerHTML = inviteBtnHtml + '<div class="loading-text">Loading your trade relationships...</div>';

  try {
    const { data: relationships, error: relationshipsError } = await window.sb
      .from("trade_relationships")
      .select("*")
      .eq("distributor_id", currentUser.id)
      .order("created_at", { ascending: false });

    if (relationshipsError) throw relationshipsError;

    if (!relationships || relationships.length === 0) {
      container.innerHTML = inviteBtnHtml + '<div class="loading-text">No buyer relationships yet.</div>';
      return;
    }

    const buyerIds        = relationships.map(r => r.buyer_id).filter(Boolean);
    const relationshipIds = relationships.map(r => r.id).filter(Boolean);
    if (buyerIds.length === 0 || relationshipIds.length === 0) {
      throw new Error("Invalid relationship data — missing IDs");
    }

    const [buyersResult, trustResult, loyaltyResult, termsResult, disputesResult] =
      await Promise.allSettled([
        window.sb.from("buyer_profiles").select("id, name, profiles(full_name, phone)").in("id", buyerIds),
        window.sb.from("relationship_trust").select("relationship_id, total_trade_value, trust_score, completed_orders, disputed_orders").in("relationship_id", relationshipIds),
        window.sb.from("relationship_loyalty").select("relationship_id, loyalty_level, loyalty_points, consecutive_order_count").in("relationship_id", relationshipIds),
        window.sb.from("current_relationship_trade_terms").select("buyer_id, credit_enabled, credit_limit, credit_days, default_discount_percent").eq("distributor_id", currentUser.id),
        window.sb.from("relationship_disputes").select("relationship_id, status").in("relationship_id", relationshipIds)
      ]);

    const buyers = buyersResult.status === "fulfilled" ? (buyersResult.value.data || []) : [];
    const trustRows = trustResult.status === "fulfilled" ? (trustResult.value.data || []) : [];
    const loyaltyRows = loyaltyResult.status === "fulfilled" ? (loyaltyResult.value.data || []) : [];
    const termsRows = termsResult.status === "fulfilled" ? (termsResult.value.data || []) : [];
    const disputeRows = disputesResult.status === "fulfilled" ? (disputesResult.value.data || []) : [];

    const buyerMap = {};
    const trustMap = {};
    const loyaltyMap = {};
    const termsMap = {};
    const disputesMap = {};

    buyers.forEach(b => { if (b && b.id) buyerMap[b.id] = b; });
    trustRows.forEach(r => { if (r && r.relationship_id) trustMap[r.relationship_id] = r; });
    loyaltyRows.forEach(r => { if (r && r.relationship_id) loyaltyMap[r.relationship_id] = r; });
    termsRows.forEach(r => { if (r && r.buyer_id) termsMap[r.buyer_id] = r; });
    disputeRows.forEach(d => {
      if (d && d.relationship_id) {
        if (!disputesMap[d.relationship_id]) disputesMap[d.relationship_id] = [];
        disputesMap[d.relationship_id].push(d);
      }
    });

    container.innerHTML = inviteBtnHtml + relationships.map(relationship => {
      const buyer = buyerMap[relationship.buyer_id];
      const buyerName = buyer?.name || buyer?.profiles?.full_name || "Buyer";
      const phone = buyer?.profiles?.phone || "";
      const statusLabel = RELATIONSHIP_STATUS_LABELS[relationship.status] || relationship.status;
      const trust = trustMap[relationship.id];
      const loyalty = loyaltyMap[relationship.id];
      const terms = termsMap[relationship.buyer_id];
      const disputes = disputesMap[relationship.id];
      const statusColor = getRelationshipStatusColor(relationship.status);

      return '<div class="manifest">' +
        '<div class="manifest-top">' +
          '<div>' +
            '<div class="m-name">' +
              relationshipEscapeHtml(buyerName) +
              (relationship.is_primary ? ' <span style="font-size:10px; color:var(--brass-dark);">· PRIMARY</span>' : "") +
            '</div>' +
            '<div class="m-loc">' + relationshipEscapeHtml(phone) + '</div>' +
          '</div>' +
          '<span class="stamp-badge" style="border-color:' + statusColor + '; color:' + statusColor + ';">' +
            relationshipEscapeHtml(String(statusLabel).toUpperCase()) +
          '</span>' +
        '</div>' +
        '<div style="font-size:12px; margin-top:6px; color:rgba(18,21,28,0.6);">' +
          (trust?.total_trade_value ? 'Lifetime trade: ' + relationshipMoney(trust.total_trade_value) : "No trade history yet") +
          (terms?.credit_enabled ? ' · Credit: ' + relationshipMoney(terms.credit_limit || 0) + ' / ' + (terms.credit_days || 0) + 'd' : "") +
        '</div>' +
        renderTrustLine(trust) +
        renderLoyaltyLine(loyalty) +
        renderDisputeSummaryLine(disputes) +
        '<div style="margin-top:10px;">' +
          '<button class="btn btn-outline" onclick="openEditTermsModal(\'' + relationshipEscapeAttribute(relationship.id) + '\')">Edit Terms</button>' +
          '<button class="btn btn-outline" onclick="openAssignAgentModal(\'' + relationshipEscapeAttribute(relationship.id) + '\')">Assign Agent</button>' +
          '<button class="btn btn-outline" onclick="openManagePaymentMethodsModal(\'' + relationshipEscapeAttribute(relationship.id) + '\')">Payment Methods</button>' +
          '<button class="btn btn-outline" onclick="openManagePreferredProductsModal(\'' + relationshipEscapeAttribute(relationship.id) + '\')">Preferred Products</button>' +
        '</div>' +
        renderRelationshipActions(relationship.id, relationship.status) +
      '</div>';
    }).join("");

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

    relationshipLayerInitialized = true;
  } catch
