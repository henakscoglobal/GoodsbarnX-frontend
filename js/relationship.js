// ==========================================================================
// GoodsbarnX — relationship.js  (rev. 2)
// Canonical relationship commerce layer: lifecycle, terms, agents, disputes,
// payment methods, preferred products, distributor dashboard, buyer invites,
// and §7 relationship-graph query surface.
// Plain global script. Loads fourteenth (Canon §10, phase 3 amendment).
//
// V1.8.2.6 remediation Phase 1+2 (D2, D3, D4):
//   - Absorbed the inline goodsbarnx-distributor-v111 block.
//   - Absorbed the inline Invite Buyer bridge.
//   - Absorbed the responsibility set of the deleted js/distributor.js.
//   - Defined openDistributorTools().
//   - Registered a "relationship" screen loader.
//
// Phase 5 rev. 1 (D29, D33):
//   - §7 query surface: three panels — Relationship Graph, Blocked
//     Opportunities, Routing Options — each calling a server RPC per S6.
//   - Dashboard "Master Stock Depletor — Open" button now routes to the
//     Market screen and scrolls to #depletor-console, not to Products.
//
// Phase 6 Step 0.5 (D-18):
//   - `suspended` added to RELATIONSHIP_STATUS_LABELS and
//     RELATIONSHIP_ACTIONS to match the server enum
//     trade_relationship_status which has six values.
//
// Phase 6 Step 3b (D-3):
//   - The three §7 panels now call their RPCs with the arguments the RPCs
//     require, and render the shapes the RPCs return:
//       loadRelationshipGraphPanel     — passes p_distributor_id.
//       loadBlockedOpportunitiesPanel  — passes p_distributor_id; renders
//                                        item / blocker_code /
//                                        blocker_reason / product_name.
//       inspectRoutingOption           — reads data.paths (not data.rows);
//                                        recognises the RPC's provisional
//                                        flag and note.
//
// Canon §6: a relationship becomes active only when consent/authorization
// conditions are satisfied. The RPC create_trade_relationship() is the
// sole creation path.
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

// Phase 6 Step 0.5 / D-18: added `suspended` to match the server enum
// `trade_relationship_status` which has six values, not five.
const RELATIONSHIP_STATUS_LABELS = {
  pending:    "Pending",
  active:     "Active",
  paused:     "Paused",
  released:   "Released",
  suspended:  "Suspended",
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

// Phase 6 Step 0.5 / D-18: `suspended` mirrors `paused` actions per the
// reconciliation decision.
const RELATIONSHIP_ACTIONS = {
  pending: [{ label: "Activate", newStatus: "active" }],
  active:  [
    { label: "Pause",   newStatus: "paused"   },
    { label: "Release", newStatus: "released" }
  ],
  paused: [
    { label: "Resume",  newStatus: "active"   },
    { label: "Release", newStatus: "released" }
  ],
  suspended: [
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

// §7 panel cache.
let relationshipGraphCache = { state: "NOT_LOADED", data: null, error: null };
let blockedOpportunitiesCache = { state: "NOT_LOADED", data: null, error: null };
let routingOptionsCache = { state: "NOT_LOADED", data: null, error: null };

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

      return '<div class="product-item" data-product-id="' + productIdSafe + '" data-distributor-id="' + distIdSafe + '">' +
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
  } catch (error) {
    console.error("[GoodsbarnX/relationship] loadMyTradeRelationships failed:", error);
    container.innerHTML = inviteBtnHtml +
      '<div style="padding:20px; text-align:center;">' +
        '<div style="color:var(--stamp); font-weight:600; margin-bottom:10px;">Failed to load relationships</div>' +
        '<div style="font-size:12px; color:rgba(18,21,28,0.6);">' + relationshipEscapeHtml(error.message || "Unknown error") + '</div>' +
        '<button class="btn btn-outline" style="margin-top:15px;" onclick="loadMyTradeRelationships()">Retry</button>' +
      '</div>';
  } finally {
    relationshipLoadInProgress = false;
  }
}

// ==========================================================================
// RELATIONSHIP STATUS ACTIONS
// ==========================================================================

function renderRelationshipActions(relationshipId, status) {
  const actions = RELATIONSHIP_ACTIONS[status];
  if (!actions) return "";
  return '<div style="margin-top:10px; display:flex; gap:8px; flex-wrap:wrap;">' +
    actions.map(action =>
      '<button class="btn btn-outline"' +
        ' data-relationship-id="' + relationshipEscapeAttribute(relationshipId) + '"' +
        ' data-new-status="' + relationshipEscapeAttribute(action.newStatus) + '"' +
        ' onclick="updateRelationshipStatus(this.dataset.relationshipId, this.dataset.newStatus)">' +
        relationshipEscapeHtml(action.label) +
      '</button>'
    ).join("") +
  '</div>';
}

async function updateRelationshipStatus(relationshipId, newStatus) {
  if (!window.sb) return;
  if (!Object.prototype.hasOwnProperty.call(RELATIONSHIP_STATUS_LABELS, newStatus)) return;

  const payload = { status: newStatus };
  const timestampFields = {
    active:     "activated_at",
    paused:     "paused_at",
    released:   "released_at",
    terminated: "terminated_at"
  };
  if (timestampFields[newStatus]) {
    payload[timestampFields[newStatus]] = new Date().toISOString();
  }

  if (newStatus === "released") {
    const reason = prompt("Reason for releasing this relationship (required):");
    if (!reason || !reason.trim()) return;
    payload.release_reason = reason.trim();
  }

  if (!confirm('Change this relationship\'s status to "' + newStatus + '"? This cannot be casually undone.')) return;

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
// TERMS EDITOR
// ==========================================================================

function openEditTermsModal(relationshipId) {
  const cached = window.__relTermsCache?.[relationshipId];
  if (!cached) return;
  editingTermsRelationshipId = relationshipId;

  const buyerNameEl = document.getElementById("edit-terms-buyer-name");
  const discountEl  = document.getElementById("terms-discount");
  const creditEnEl  = document.getElementById("terms-credit-enabled");
  const creditLiEl  = document.getElementById("terms-credit-limit");
  const creditDyEl  = document.getElementById("terms-credit-days");
  const statusEl    = document.getElementById("edit-terms-status");
  const modal       = document.getElementById("edit-terms-modal");
  if (!modal) { relWarnMissing("edit-terms-modal"); return; }

  if (buyerNameEl) buyerNameEl.innerText = cached.buyerName;
  if (discountEl)  discountEl.value = cached.discount;
  if (creditEnEl)  creditEnEl.value = cached.creditEnabled ? "true" : "false";
  if (creditLiEl)  creditLiEl.value = cached.creditLimit;
  if (creditDyEl)  creditDyEl.value = cached.creditDays;
  if (statusEl)    statusEl.innerText = "";

  modal.classList.add("active");
}

function closeEditTermsModal() {
  const modal = document.getElementById("edit-terms-modal");
  if (modal) modal.classList.remove("active");
  editingTermsRelationshipId = null;
}

async function saveRelationshipTerms() {
  if (!editingTermsRelationshipId || !window.sb) return;
  const status = document.getElementById("edit-terms-status");
  if (!status) return;
  status.innerText = "Saving...";

  const readVal = id => { const el = document.getElementById(id); return el ? el.value : ""; };
  const discountRaw = readVal("terms-discount");
  const creditEnabled = readVal("terms-credit-enabled") === "true";
  const creditLimitRaw = readVal("terms-credit-limit");
  const creditDaysRaw = readVal("terms-credit-days");

  const discount = discountRaw !== "" ? parseFloat(discountRaw) : null;
  const creditLimit = creditEnabled && creditLimitRaw !== "" ? parseFloat(creditLimitRaw) : null;
  const creditDays = creditEnabled && creditDaysRaw !== "" ? parseInt(creditDaysRaw, 10) : null;

  if (discount != null && !Number.isFinite(discount)) { status.innerText = "Invalid discount."; return; }
  if (creditEnabled && creditLimit != null && !Number.isFinite(creditLimit)) { status.innerText = "Invalid credit limit."; return; }
  if (creditEnabled && creditDays != null && !Number.isInteger(creditDays)) { status.innerText = "Invalid credit days."; return; }

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
      ({ error } = await window.sb.from("relationship_trade_terms").update(payload).eq("id", existing.id));
    } else {
      ({ error } = await window.sb.from("relationship_trade_terms").insert(
        Object.assign({ relationship_id: editingTermsRelationshipId, effective_from: new Date().toISOString() }, payload)
      ));
    }
    if (error) throw error;

    status.innerText = "Saved!";
    setTimeout(() => { closeEditTermsModal(); loadMyTradeRelationships(); }, 1000);
  } catch (error) {
    console.error("[GoodsbarnX/relationship] saveRelationshipTerms failed:", error);
    status.innerText = "Error: " + error.message;
  }
}

// ==========================================================================
// INVITE BUYER — RPC path
// ==========================================================================

function openInviteBuyerModal() {
  const modal = document.getElementById("invite-buyer-modal");
  if (!modal) { relWarnMissing("invite-buyer-modal"); return; }
  const search = document.getElementById("invite-buyer-search");
  const results = document.getElementById("invite-buyer-results");
  const status = document.getElementById("invite-buyer-status");
  if (search) search.value = "";
  if (results) results.innerHTML = "";
  if (status) status.innerText = "";
  modal.classList.add("active");
}

function closeInviteBuyerModal() {
  const modal = document.getElementById("invite-buyer-modal");
  if (modal) modal.classList.remove("active");
}

async function searchBuyersForInvite() {
  const search = document.getElementById("invite-buyer-search");
  const resultsEl = document.getElementById("invite-buyer-results");
  if (!search || !resultsEl || !window.sb) return;
  const query = search.value.trim();
  if (query.length < 2) { resultsEl.innerHTML = ""; return; }

  const { data: buyers, error } = await safeSupabaseQuery(
    sb => sb.from("buyer_profiles")
      .select("id, name, location, profiles(full_name, phone)")
      .ilike("name", "%" + query + "%")
      .limit(10),
    [],
    "searchBuyersForInvite"
  );
  if (error) { resultsEl.innerHTML = ""; return; }
  if (!buyers || buyers.length === 0) {
    resultsEl.innerHTML = '<div class="loading-text">No matching buyers found.</div>';
    return;
  }

  resultsEl.innerHTML = buyers.map(buyer => {
    const name = buyer.name || buyer.profiles?.full_name || "Buyer";
    return '<div class="manifest" style="padding:12px; cursor:pointer;"' +
      ' data-buyer-id="' + relationshipEscapeAttribute(buyer.id) + '"' +
      ' data-buyer-name="' + relationshipEscapeAttribute(name) + '"' +
      ' onclick="inviteBuyerToRelationship(this.dataset.buyerId, this.dataset.buyerName)">' +
      '<div class="m-name">' + relationshipEscapeHtml(name) + '</div>' +
      '<div class="m-loc">' + relationshipEscapeHtml(buyer.location || "") +
        (buyer.profiles?.phone ? " · " + relationshipEscapeHtml(buyer.profiles.phone) : "") +
      '</div>' +
    '</div>';
  }).join("");
}

async function inviteBuyerToRelationship(buyerId, buyerName) {
  if (!currentUser || currentUser.role !== "distributor" || !window.sb) return;
  const status = document.getElementById("invite-buyer-status");
  if (!status) return;

  status.innerText = "Inviting " + buyerName + "...";

  const { error } = await window.sb.rpc("create_trade_relationship", {
    p_buyer_id: buyerId,
    p_distributor_id: currentUser.id
  });

  if (error) { status.innerText = "Error: " + error.message; return; }

  status.innerText = buyerName + " added as a trade relationship!";
  setTimeout(() => { closeInviteBuyerModal(); loadMyTradeRelationships(); }, 1200);
}

// ==========================================================================
// INVITE BUYER — phone-based consent path
// ==========================================================================

function openAddBuyerModal() {
  const modal = document.getElementById("add-buyer-modal");
  if (!modal) { relWarnMissing("add-buyer-modal"); return; }
  const phone = document.getElementById("add-buyer-phone");
  const status = document.getElementById("add-buyer-status-msg");
  if (phone) phone.value = "";
  if (status) status.innerText = "";
  modal.style.display = "flex";
  modal.classList.add("active");
  if (phone) setTimeout(() => { try { phone.focus(); } catch (e) {} }, 80);
}

function closeAddBuyerModal() {
  const modal = document.getElementById("add-buyer-modal");
  if (modal) { modal.classList.remove("active"); modal.style.display = "none"; }
}

async function submitAddBuyer() {
  const phoneEl  = document.getElementById("add-buyer-phone");
  const statusEl = document.getElementById("add-buyer-status-msg");
  const phone = phoneEl ? phoneEl.value.trim() : "";
  const showStatus = (msg) => { if (statusEl) statusEl.innerText = msg; };

  if (!phone) { showStatus("Please enter a phone number."); return; }
  if (!currentUser || !currentUser.id) { showStatus("Your distributor session is not ready. Please refresh."); return; }
  if (!window.sb) { showStatus("Connection service is not ready. Please refresh."); return; }

  showStatus("Checking buyer account...");

  const lookup = await window.sb
    .from("profiles")
    .select("id, role")
    .eq("phone", phone)
    .eq("role", "buyer")
    .maybeSingle();

  if (lookup.error) { showStatus("Could not verify that buyer account. Please try again."); return; }
  if (!lookup.data) { showStatus("No buyer account found with that phone number yet. They'll need to sign up first."); return; }
  if (lookup.data.id === currentUser.id) { showStatus("You cannot connect yourself as a buyer."); return; }

  showStatus("Sending connection request...");

  const insert = await window.sb.from("buyer_locks").insert({
    buyer_id: lookup.data.id,
    distributor_id: currentUser.id,
    status: "pending_consent"
  });

  if (insert.error) { showStatus("Could not send request. They may already be connected elsewhere."); return; }

  showStatus("Sent! They'll see this request next time they open GoodsbarnX.");
  setTimeout(() => {
    closeAddBuyerModal();
    if (currentUser && currentUser.role === "distributor") {
      refreshDistributorDashboard();
    }
  }, 1800);
}

// ==========================================================================
// AGENT ASSIGNMENT
// ==========================================================================

function openAssignAgentModal(relationshipId) {
  assigningAgentRelationshipId = relationshipId;
  const search = document.getElementById("assign-agent-search");
  const results = document.getElementById("assign-agent-results");
  const status = document.getElementById("assign-agent-status");
  const modal = document.getElementById("assign-agent-modal");
  if (!modal) { relWarnMissing("assign-agent-modal"); return; }
  if (search) search.value = "";
  if (results) results.innerHTML = "";
  if (status) status.innerText = "";
  modal.classList.add("active");
}

function closeAssignAgentModal() {
  const modal = document.getElementById("assign-agent-modal");
  if (modal) modal.classList.remove("active");
  assigningAgentRelationshipId = null;
}

async function searchAgentsForAssignment() {
  const search = document.getElementById("assign-agent-search");
  const resultsEl = document.getElementById("assign-agent-results");
  if (!search || !resultsEl || !window.sb) return;
  const query = search.value.trim();
  if (query.length < 2) { resultsEl.innerHTML = ""; return; }

  const { data: agents, error } = await safeSupabaseQuery(
    sb => sb.from("agent_profiles")
      .select("id, profiles(full_name, phone)")
      .limit(20),
    [],
    "searchAgentsForAssignment"
  );
  if (error) { resultsEl.innerHTML = ""; return; }

  const normalizedQuery = query.toLowerCase();
  const filtered = (agents || []).filter(
    a => (a.profiles?.full_name || "").toLowerCase().includes(normalizedQuery)
  );
  if (filtered.length === 0) {
    resultsEl.innerHTML = '<div class="loading-text">No matching agents found.</div>';
    return;
  }

  resultsEl.innerHTML = filtered.map(agent => {
    const name = agent.profiles?.full_name || "Agent";
    return '<div class="manifest" style="padding:12px; cursor:pointer;"' +
      ' data-agent-id="' + relationshipEscapeAttribute(agent.id) + '"' +
      ' data-agent-name="' + relationshipEscapeAttribute(name) + '"' +
      ' onclick="assignAgentToRelationship(this.dataset.agentId, this.dataset.agentName)">' +
      '<div class="m-name">' + relationshipEscapeHtml(name) + '</div>' +
      '<div class="m-loc">' + relationshipEscapeHtml(agent.profiles?.phone || "") + '</div>' +
    '</div>';
  }).join("");
}

async function assignAgentToRelationship(agentId, agentName) {
  if (!assigningAgentRelationshipId || !window.sb) return;
  const status = document.getElementById("assign-agent-status");
  if (!status) return;
  status.innerText = "Assigning " + agentName + "...";

  const { error: unassignError } = await window.sb
    .from("relationship_agents")
    .update({ unassigned_at: new Date().toISOString() })
    .eq("relationship_id", assigningAgentRelationshipId)
    .eq("is_primary", true)
    .is("unassigned_at", null);

  if (unassignError) { status.innerText = "Error: " + unassignError.message; return; }

  const { error } = await window.sb
    .from("relationship_agents")
    .insert({
      relationship_id: assigningAgentRelationshipId,
      agent_id: agentId,
      is_primary: true,
      assigned_at: new Date().toISOString()
    });

  if (error) { status.innerText = "Error: " + error.message; return; }

  status.innerText = agentName + " assigned!";
  setTimeout(() => { closeAssignAgentModal(); loadMyTradeRelationships(); }, 1200);
}

// ==========================================================================
// PAYMENT METHODS
// ==========================================================================

function openManagePaymentMethodsModal(relationshipId) {
  managingPaymentMethodsRelationshipId = relationshipId;
  const method = document.getElementById("new-payment-method");
  const limit = document.getElementById("new-payment-method-limit");
  const status = document.getElementById("manage-payment-status");
  const modal = document.getElementById("manage-payment-modal");
  if (!modal) { relWarnMissing("manage-payment-modal"); return; }
  if (method) method.value = "";
  if (limit) limit.value = "";
  if (status) status.innerText = "";
  modal.classList.add("active");
  loadExistingPaymentMethodsForModal(relationshipId);
}

function closeManagePaymentMethodsModal() {
  const modal = document.getElementById("manage-payment-modal");
  if (modal) modal.classList.remove("active");
  managingPaymentMethodsRelationshipId = null;
}

async function loadExistingPaymentMethodsForModal(relationshipId) {
  const listEl = document.getElementById("existing-payment-methods");
  if (!listEl || !window.sb) return;
  listEl.innerHTML = '<div class="loading-text">Loading...</div>';

  const { data: methods, error } = await safeSupabaseQuery(
    sb => sb.from("relationship_payment_methods")
      .select("id, payment_method, is_default, is_active, transaction_limit")
      .eq("relationship_id", relationshipId)
      .order("created_at", { ascending: false }),
    [],
    "loadExistingPaymentMethodsForModal"
  );
  if (error) { listEl.innerHTML = '<div class="loading-text">Could not load payment methods.</div>'; return; }
  if (!methods || methods.length === 0) {
    listEl.innerHTML = '<div class="loading-text">No payment methods added yet.</div>';
    return;
  }

  listEl.innerHTML = methods.map(method =>
    '<div class="manifest" style="padding:10px 14px;">' +
      '<div class="manifest-top">' +
        '<div>' +
          '<span style="font-size:13px; font-weight:600;">' + relationshipEscapeHtml(method.payment_method) + '</span>' +
          (method.is_default ? ' <span class="stamp-badge" style="font-size:8px; padding:2px 6px; border-color:var(--ok); color:var(--ok); transform:none; margin-left:6px;">DEFAULT</span>' : "") +
          (!method.is_active ? ' <span class="stamp-badge" style="font-size:8px; padding:2px 6px; border-color:var(--brass); color:var(--brass); transform:none; margin-left:6px;">INACTIVE</span>' : "") +
        '</div>' +
      '</div>' +
      (method.transaction_limit != null ? '<div class="m-loc">Transaction limit: ' + relationshipMoney(method.transaction_limit) + '</div>' : "") +
      '<div class="action-buttons">' +
        (!method.is_default
          ? '<button class="btn btn-outline" data-method-id="' + relationshipEscapeAttribute(method.id) + '" onclick="makePaymentMethodDefault(this.dataset.methodId)">Make Default</button>'
          : "") +
        '<button class="btn ' + (method.is_active ? "btn-danger" : "btn-success") + '"' +
          ' data-method-id="' + relationshipEscapeAttribute(method.id) + '"' +
          ' data-new-active="' + (!method.is_active) + '"' +
          ' onclick="togglePaymentMethodActive(this.dataset.methodId, this.dataset.newActive === \'true\')">' +
          (method.is_active ? "Deactivate" : "Activate") +
        '</button>' +
      '</div>' +
    '</div>'
  ).join("");
}

async function addPaymentMethod() {
  const status = document.getElementById("manage-payment-status");
  if (!status || !window.sb) return;
  const methodNameEl = document.getElementById("new-payment-method");
  const limitEl = document.getElementById("new-payment-method-limit");
  const methodName = methodNameEl ? methodNameEl.value.trim() : "";
  const limitRaw = limitEl ? limitEl.value : "";

  if (!methodName) { status.innerText = "Enter a payment method name."; return; }
  if (!managingPaymentMethodsRelationshipId) { status.innerText = "No relationship selected."; return; }

  status.innerText = "Adding...";
  const transactionLimit = limitRaw !== "" ? parseFloat(limitRaw) : null;
  if (transactionLimit != null && !Number.isFinite(transactionLimit)) {
    status.innerText = "Invalid transaction limit."; return;
  }

  const { error } = await window.sb.from("relationship_payment_methods").insert({
    relationship_id: managingPaymentMethodsRelationshipId,
    payment_method: methodName,
    is_active: true,
    is_default: false,
    transaction_limit: transactionLimit
  });
  if (error) { status.innerText = "Error: " + error.message; return; }

  status.innerText = "Added!";
  if (methodNameEl) methodNameEl.value = "";
  if (limitEl) limitEl.value = "";
  loadExistingPaymentMethodsForModal(managingPaymentMethodsRelationshipId);
}

async function makePaymentMethodDefault(methodId) {
  if (!managingPaymentMethodsRelationshipId || !window.sb) return;
  const { error: clearError } = await window.sb
    .from("relationship_payment_methods")
    .update({ is_default: false })
    .eq("relationship_id", managingPaymentMethodsRelationshipId)
    .eq("is_default", true);
  if (clearError) { console.error("[GoodsbarnX/relationship] clear default failed:", clearError.message); return; }

  const { error } = await window.sb
    .from("relationship_payment_methods")
    .update({ is_default: true })
    .eq("id", methodId);
  if (error) { console.error("[GoodsbarnX/relationship] set default failed:", error.message); return; }
  loadExistingPaymentMethodsForModal(managingPaymentMethodsRelationshipId);
}

async function togglePaymentMethodActive(methodId, newActiveState) {
  if (!window.sb) return;
  const { error } = await window.sb
    .from("relationship_payment_methods")
    .update({ is_active: newActiveState })
    .eq("id", methodId);
  if (error) { console.error("[GoodsbarnX/relationship] toggle active failed:", error.message); return; }
  loadExistingPaymentMethodsForModal(managingPaymentMethodsRelationshipId);
}

// ==========================================================================
// PREFERRED PRODUCTS MANAGER
// ==========================================================================

function openManagePreferredProductsModal(relationshipId) {
  managingPreferencesRelationshipId = relationshipId;
  const search = document.getElementById("preference-product-search");
  const results = document.getElementById("preference-search-results");
  const status = document.getElementById("manage-preferences-status");
  const modal = document.getElementById("manage-preferences-modal");
  if (!modal) { relWarnMissing("manage-preferences-modal"); return; }
  if (search) search.value = "";
  if (results) results.innerHTML = "";
  if (status) status.innerText = "";
  modal.classList.add("active");
  loadExistingPreferredProducts(relationshipId);
}

function closeManagePreferredProductsModal() {
  const modal = document.getElementById("manage-preferences-modal");
  if (modal) modal.classList.remove("active");
  managingPreferencesRelationshipId = null;
}

async function loadExistingPreferredProducts(relationshipId) {
  const listEl = document.getElementById("existing-preferred-products");
  if (!listEl || !window.sb) return;
  listEl.innerHTML = '<div class="loading-text">Loading...</div>';

  const { data: prefs, error } = await safeSupabaseQuery(
    sb => sb.from("relationship_product_preferences")
      .select("id, product_id, negotiated_unit_price")
      .eq("relationship_id", relationshipId)
      .eq("preferred", true),
    [],
    "loadExistingPreferredProducts"
  );
  if (error) { listEl.innerHTML = '<div class="loading-text">Could not load preferred products.</div>'; return; }
  if (!prefs || prefs.length === 0) {
    listEl.innerHTML = '<div class="loading-text">No preferred products marked yet.</div>';
    return;
  }

  const productIds = prefs.map(p => p.product_id).filter(Boolean);
  if (productIds.length === 0) {
    listEl.innerHTML = '<div class="loading-text">No preferred products marked yet.</div>';
    return;
  }

  const { data: products } = await safeSupabaseQuery(
    sb => sb.from("products").select("id, name, price").in("id", productIds),
    [],
    "loadExistingPreferredProducts/products"
  );
  const productMap = {};
  (products || []).forEach(p => { productMap[p.id] = p; });

  listEl.innerHTML = prefs.map(pref => {
    const product = productMap[pref.product_id];
    if (!product) return "";
    return '<div class="manifest" style="padding:10px 14px;">' +
      '<div class="manifest-top">' +
        '<div>' +
          '<span style="font-size:13px; font-weight:600;">' + relationshipEscapeHtml(product.name) + ' ★</span>' +
          '<div class="m-loc">' +
            'Public: ' + relationshipMoney(product.price || 0) +
            (pref.negotiated_unit_price != null ? ' · Negotiated: ' + relationshipMoney(pref.negotiated_unit_price) : "") +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="action-buttons">' +
        '<button class="btn btn-outline" data-pref-id="' + relationshipEscapeAttribute(pref.id) + '" onclick="setNegotiatedPrice(this.dataset.prefId)">' +
          (pref.negotiated_unit_price != null ? "Change" : "Set") + ' Price' +
        '</button>' +
        '<button class="btn btn-danger" data-pref-id="' + relationshipEscapeAttribute(pref.id) + '" onclick="removeProductPreference(this.dataset.prefId)">Remove</button>' +
      '</div>' +
    '</div>';
  }).join("");
}

async function searchDistributorProductsForPreference() {
  const search = document.getElementById("preference-product-search");
  const resultsEl = document.getElementById("preference-search-results");
  if (!search || !resultsEl || !window.sb) return;
  const query = search.value.trim();
  if (query.length < 2) { resultsEl.innerHTML = ""; return; }

  const { data: products, error } = await safeSupabaseQuery(
    sb => sb.from("products")
      .select("id, name, price, sku")
      .eq("distributor_id", currentUser.id)
      .ilike("name", "%" + query + "%")
      .limit(10),
    [],
    "searchDistributorProductsForPreference"
  );
  if (error) { resultsEl.innerHTML = ""; return; }
  if (!products || products.length === 0) {
    resultsEl.innerHTML = '<div class="loading-text">No matching products found.</div>';
    return;
  }

  resultsEl.innerHTML = products.map(p =>
    '<div class="manifest" style="padding:10px 14px; cursor:pointer;"' +
      ' data-product-id="' + relationshipEscapeAttribute(p.id) + '"' +
      ' onclick="addProductPreference(this.dataset.productId)">' +
      '<div class="m-name">' + relationshipEscapeHtml(p.name) + '</div>' +
      '<div class="m-loc">' + relationshipEscapeHtml(p.sku || "No SKU") + ' · ' + relationshipMoney(p.price || 0) + '</div>' +
    '</div>'
  ).join("");
}

async function addProductPreference(productId) {
  const status = document.getElementById("manage-preferences-status");
  if (!status || !window.sb) return;
  if (!managingPreferencesRelationshipId) { status.innerText = "No relationship selected."; return; }
  status.innerText = "Adding...";
  const { error } = await window.sb.from("relationship_product_preferences").insert({
    relationship_id: managingPreferencesRelationshipId,
    product_id: productId,
    preferred: true
  });
  if (error) { status.innerText = "Error: " + error.message; return; }
  status.innerText = "Added!";
  const search = document.getElementById("preference-product-search");
  const results = document.getElementById("preference-search-results");
  if (search) search.value = "";
  if (results) results.innerHTML = "";
  loadExistingPreferredProducts(managingPreferencesRelationshipId);
}

async function setNegotiatedPrice(prefId) {
  if (!window.sb) return;
  const priceInput = prompt("Enter the negotiated price for this product (₦), or leave blank to clear it:");
  if (priceInput === null) return;
  const trimmed = priceInput.trim();
  const price = trimmed === "" ? null : parseFloat(trimmed);
  if (price !== null && (!Number.isFinite(price) || price < 0)) {
    alert("Enter a valid non-negative price."); return;
  }
  const { error } = await window.sb
    .from("relationship_product_preferences")
    .update({ negotiated_unit_price: price })
    .eq("id", prefId);
  if (error) { alert("Could not update negotiated price: " + error.message); return; }
  loadExistingPreferredProducts(managingPreferencesRelationshipId);
}

async function removeProductPreference(prefId) {
  if (!window.sb) return;
  if (!confirm("Remove this product from preferred?")) return;
  const { error } = await window.sb
    .from("relationship_product_preferences").delete().eq("id", prefId);
  if (error) { alert("Could not remove product preference: " + error.message); return; }
  loadExistingPreferredProducts(managingPreferencesRelationshipId);
}

// ==========================================================================
// BUYER — APPROVED PAYMENT METHODS (buyer view)
// ==========================================================================

async function loadRelationshipPaymentMethods(relationshipId) {
  const container = document.getElementById("my-payment-methods");
  if (!container || !relationshipId) return;

  const { data: methods, error } = await safeSupabaseQuery(
    sb => sb.from("relationship_payment_methods")
      .select("payment_method, is_default, is_active, transaction_limit")
      .eq("relationship_id", relationshipId)
      .eq("is_active", true)
      .order("is_default", { ascending: false }),
    [],
    "loadRelationshipPaymentMethods"
  );
  if (error || !methods || methods.length === 0) { container.innerHTML = ""; return; }

  container.innerHTML =
    '<div class="section-label">Approved Payment Methods</div>' +
    '<div class="manifest" style="padding:6px 16px;">' +
      methods.map((method, index) =>
        '<div style="padding:10px 0; ' + (index < methods.length - 1 ? "border-bottom:1px dashed var(--line-dark);" : "") + ' display:flex; justify-content:space-between; align-items:center;">' +
          '<div>' +
            '<span style="font-size:13px; font-weight:600;">' + relationshipEscapeHtml(method.payment_method) + '</span>' +
            (method.is_default ? ' <span class="stamp-badge" style="font-size:8px; padding:2px 6px; border-color:var(--ok); color:var(--ok); transform:none; margin-left:6px;">DEFAULT</span>' : "") +
          '</div>' +
          (method.transaction_limit != null
            ? '<span style="font-size:11px; color:rgba(18,21,28,0.5);">Limit ' + relationshipMoney(method.transaction_limit) + '</span>'
            : "") +
        '</div>'
      ).join("") +
    '</div>';
}

// ==========================================================================
// AGENT REFERRAL
// ==========================================================================

async function searchBuyersForAgentReferral() {
  const search = document.getElementById("agent-refer-buyer-search");
  const resultsEl = document.getElementById("agent-refer-buyer-results");
  if (!search || !resultsEl || !window.sb) return;
  const query = search.value.trim();
  if (query.length < 2) { resultsEl.innerHTML = ""; return; }

  const { data: buyers, error } = await safeSupabaseQuery(
    sb => sb.from("buyer_profiles")
      .select("id, name, location, profiles(full_name, phone)")
      .ilike("name", "%" + query + "%")
      .limit(10),
    [],
    "searchBuyersForAgentReferral"
  );
  if (error) { resultsEl.innerHTML = ""; return; }
  if (!buyers || buyers.length === 0) {
    resultsEl.innerHTML = '<div class="loading-text">No matching buyers found.</div>';
    return;
  }

  resultsEl.innerHTML = buyers.map(buyer => {
    const name = buyer.name || buyer.profiles?.full_name || "Buyer";
    return '<div class="manifest" style="padding:12px; cursor:pointer;"' +
      ' data-buyer-id="' + relationshipEscapeAttribute(buyer.id) + '"' +
      ' data-buyer-name="' + relationshipEscapeAttribute(name) + '"' +
      ' onclick="createAgentReferredBuyerRelationship(this.dataset.buyerId, this.dataset.buyerName)">' +
      '<div class="m-name">' + relationshipEscapeHtml(name) + '</div>' +
      '<div class="m-loc">' + relationshipEscapeHtml(buyer.location || "") +
        (buyer.profiles?.phone ? " · " + relationshipEscapeHtml(buyer.profiles.phone) : "") +
      '</div>' +
    '</div>';
  }).join("");
}

async function createAgentReferredBuyerRelationship(buyerId, buyerName) {
  if (!currentUser || currentUser.role !== "agent" || !window.sb) return;
  const status = document.getElementById("agent-refer-buyer-status");
  if (!status) return;
  if (!buyerId) { status.innerText = "Buyer is required."; return; }

  status.innerText = "Creating buyer relationship for " + (buyerName || "buyer") + "...";
  const { error } = await window.sb.rpc("create_agent_referred_buyer_relationship", {
    p_buyer_id: buyerId
  });
  if (error) { status.innerText = "Error: " + error.message; return; }
  status.innerText = (buyerName || "Buyer") + " added through your distributor relationship.";
  loadMyTradeRelationships();
}

// ==========================================================================
// DISTRIBUTOR DASHBOARD
// ==========================================================================

function mountDistributorDashboard() {
  const host = document.getElementById("distributor-tools-holder");
  if (!host) return null;
  let panel = document.getElementById("gbx-distributor-dashboard");
  if (!panel) {
    panel = document.createElement("section");
    panel.id = "gbx-distributor-dashboard";
    panel.className = "gbx-dashboard";
    host.parentNode.insertBefore(panel, host);
  }
  return panel;
}

function timeGreeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning," : h < 18 ? "Good afternoon," : "Good evening,";
}

function initialsFromName(name) {
  return String(name || "User")
    .split(/\s+/).filter(Boolean).slice(0, 2)
    .map(x => x[0]).join("").toUpperCase() || "U";
}

function renderDistributorDashboard() {
  const el = mountDistributorDashboard();
  if (!el) return;

  if (!currentUser || currentUser.role !== "distributor") {
    el.classList.remove("active");
    return;
  }
  el.classList.add("active");

  const name = currentUser.business_name || currentUser.full_name || "Distributor";
  const s = distributorDashboardState;

  const pendingBuyer = s.buyers.filter(r => r.status === "pending").length;
  const activeBuyer  = s.buyers.filter(r => r.status === "active").length;
  const buyerPending = s.pendingAgents.length;
  const agentPending = s.pendingAgents.length;
  const agentActive  = s.acceptedAgents.length;

  const agentHtml = s.pendingAgents.length
    ? s.pendingAgents.map(x =>
        '<div class="gbx-agent-row">' +
          '<div class="gbx-agent-top">' +
            '<div class="gbx-avatar">' + relationshipEscapeHtml(initialsFromName(x.name)) + '</div>' +
            '<div class="gbx-agent-copy">' +
              '<div class="gbx-agent-name">' + relationshipEscapeHtml(x.name) + '</div>' +
              '<div class="gbx-agent-date">Attachment request · ' +
                relationshipEscapeHtml(x.created_at ? new Date(x.created_at).toLocaleDateString("en-GB") : "recent") +
              '</div>' +
            '</div>' +
            '<span class="gbx-status">PENDING</span>' +
          '</div>' +
          '<div class="gbx-agent-actions">' +
            '<button class="primary" onclick="approveDistributorAgent(\'' + relationshipEscapeAttribute(x.id) + '\')">Accept</button>' +
            '<button onclick="declineDistributorAgent(\'' + relationshipEscapeAttribute(x.id) + '\')">Decline</button>' +
          '</div>' +
        '</div>'
      ).join("")
    : '<div class="gbx-empty">No pending agent requests.</div>';

  let acceptedHtml = "";
  if (s.acceptedAgents.length) {
    acceptedHtml = s.acceptedAgents.map(x =>
      '<div class="gbx-agent-row">' +
        '<div class="gbx-agent-top">' +
          '<div class="gbx-avatar">' + relationshipEscapeHtml(initialsFromName(x.name)) + '</div>' +
          '<div class="gbx-agent-copy">' +
            '<div class="gbx-agent-name">' + relationshipEscapeHtml(x.name) + '</div>' +
            '<div class="gbx-agent-date">Active supplier-agent attachment</div>' +
          '</div>' +
          '<span class="gbx-status">ACTIVE</span>' +
        '</div>' +
      '</div>'
    ).join("");
  }

  el.innerHTML =
    '<section class="gbx-dash-hero">' +
      '<div class="gbx-dash-kicker">DISTRIBUTOR NETWORK</div>' +
      '<div class="gbx-greeting">' + timeGreeting() + '<br><span class="name">' + relationshipEscapeHtml(name) + ' 👋</span></div>' +
      '<div class="gbx-greeting-sub">Your trade network is active.</div>' +
      '<div class="gbx-verified"><span class="gbx-verified-dot">✓</span> Verified Distributor</div>' +
      '<div class="gbx-primary-grid">' +
        '<button class="gbx-primary" onclick="showScreen(\'market\')">' +
          '<div class="gbx-primary-value">' + activeBuyer + '</div>' +
          '<div class="gbx-primary-label">Buyers</div>' +
          '<div class="gbx-primary-note"><strong>● Active</strong></div>' +
        '</button>' +
        '<button class="gbx-primary" onclick="showScreen(\'market\')">' +
          '<div class="gbx-primary-value">' + agentActive + '</div>' +
          '<div class="gbx-primary-label">Agents</div>' +
          '<div class="gbx-primary-note"><strong>● Active</strong></div>' +
        '</button>' +
      '</div>' +
    '</section>' +

    '<section class="gbx-section">' +
      '<div class="gbx-section-head">' +
        '<div class="gbx-section-title alert">⚠ NEEDS YOUR ATTENTION</div>' +
        '<button class="gbx-view" onclick="showScreen(\'inquiries\')">View all</button>' +
      '</div>' +
      '<div class="gbx-attention">' +
        '<div class="gbx-attention-row" onclick="openAddBuyerModal()">' +
          '<div class="gbx-attention-icon">♙</div>' +
          '<div class="gbx-attention-copy">' +
            '<div class="gbx-attention-main">Buyer requests</div>' +
            '<div class="gbx-attention-sub">New buyers want to connect</div>' +
          '</div>' +
          '<div class="gbx-count ' + (pendingBuyer ? "hot" : "") + '">' + pendingBuyer + '</div>' +
          '<div class="gbx-arrow">›</div>' +
        '</div>' +
        '<div class="gbx-attention-row" onclick="document.getElementById(\'gbx-distributor-dashboard\').scrollIntoView({behavior:\'smooth\'})">' +
          '<div class="gbx-attention-icon">♙</div>' +
          '<div class="gbx-attention-copy">' +
            '<div class="gbx-attention-main">Agent request</div>' +
            '<div class="gbx-attention-sub">New agent wants to join</div>' +
          '</div>' +
          '<div class="gbx-count ' + (agentPending ? "hot" : "") + '">' + agentPending + '</div>' +
          '<div class="gbx-arrow">›</div>' +
        '</div>' +
        '<div class="gbx-attention-row" onclick="showScreen(\'inquiries\')">' +
          '<div class="gbx-attention-icon">▱</div>' +
          '<div class="gbx-attention-copy">' +
            '<div class="gbx-attention-main">Unanswered inquiries</div>' +
            '<div class="gbx-attention-sub">Buyers waiting for your response</div>' +
          '</div>' +
          '<div class="gbx-count">—</div>' +
          '<div class="gbx-arrow">›</div>' +
        '</div>' +
      '</div>' +
    '</section>' +

    '<section class="gbx-section">' +
      '<div class="gbx-section-head">' +
        '<div class="gbx-section-title">MY NETWORK</div>' +
      '</div>' +
      '<div class="gbx-network">' +
        '<button class="gbx-network-card" onclick="showScreen(\'relationship\')">' +
          '<span class="gbx-network-value">' + activeBuyer + '</span>' +
          '<div class="gbx-network-head">' +
            '<span class="gbx-network-title">My Buyers</span>' +
            '<span class="gbx-network-meta">' + activeBuyer + ' active · ' + pendingBuyer + ' pending</span>' +
          '</div>' +
          '<div class="gbx-network-sub">Active relationships <span class="gbx-network-dot"></span></div>' +
        '</button>' +
        '<button class="gbx-network-card" onclick="showScreen(\'relationship\')">' +
          '<span class="gbx-network-value">' + agentActive + '</span>' +
          '<div class="gbx-network-head">' +
            '<span class="gbx-network-title">My Agents</span>' +
            '<span class="gbx-network-meta">' + agentActive + ' active · ' + agentPending + ' pending</span>' +
          '</div>' +
          '<div class="gbx-network-sub">Attached agents <span class="gbx-network-dot"></span></div>' +
        '</button>' +
      '</div>' +
    '</section>' +

    '<section class="gbx-command">' +
      '<div class="gbx-command-title">📊 Distributor Dashboard</div>' +
      '<div class="gbx-command-sub">Manage your products, track inquiries, and grow your network.</div>' +
      '<div class="gbx-command-grid">' +
        '<button class="gbx-command-btn primary" onclick="showScreen(\'products\')">' +
          '<div class="gbx-command-icon">📦</div><span>Manage Products</span>' +
        '</button>' +
        '<button class="gbx-command-btn" onclick="openInviteBuyerModal()">' +
          '<div class="gbx-command-icon">♙</div><span>Invite Buyer</span>' +
        '</button>' +
        '<button class="gbx-command-btn" onclick="showScreen(\'staff\')">' +
          '<div class="gbx-command-icon">♙</div><span>Manage Staff</span>' +
        '</button>' +
        '<button class="gbx-command-btn" onclick="showScreen(\'profile\')">' +
          '<div class="gbx-command-icon">⚙</div><span>Settings</span>' +
        '</button>' +
      '</div>' +
      '<div class="gbx-depletor-mini">' +
        '<div class="gbx-depletor-mark">▣</div>' +
        '<div class="gbx-depletor-copy">' +
          '<strong>Master Stock Depletor</strong>' +
          '<small>Find demand. Reach relationships. Move stock.</small>' +
        '</div>' +
        // D33 (rev. 1): routes to the Market screen and scrolls to the depletor
        // console, rather than to Products.
        '<button class="gbx-depletor-open" onclick="showScreen(\'market\'); setTimeout(function(){ var el = document.getElementById(\'depletor-console\'); if (el) el.scrollIntoView({behavior:\'smooth\', block:\'start\'}); }, 60);">Open</button>' +
      '</div>' +
    '</section>' +

    '<section class="gbx-agent">' +
      '<div class="gbx-section-head">' +
        '<div>' +
          '<div class="gbx-section-title">AGENT MANAGEMENT</div>' +
          '<div style="font-size:9.5px;color:var(--gbx-muted);margin-top:3px">Approve or decline agent attachment requests.</div>' +
        '</div>' +
        '<button class="gbx-view" onclick="refreshDistributorDashboard()">↻ Refresh</button>' +
      '</div>' +
      '<div class="gbx-agent-list">' + agentHtml + acceptedHtml + '</div>' +
    '</section>';
}

async function loadDistributorDashboardData() {
  if (!currentUser || currentUser.role !== "distributor" || !window.sb) {
    renderDistributorDashboard();
    return;
  }
  const uid = currentUser.id;

  try {
    const [rels, locks, atts, inq] = await Promise.all([
      window.sb.from("trade_relationships").select("buyer_id,status").eq("distributor_id", uid),
      window.sb.from("buyer_locks").select("id,buyer_id,status,created_at").eq("distributor_id", uid),
      window.sb.from("agent_distributor_attachments").select("id,agent_id,status,created_at").eq("distributor_id", uid),
      window.sb.from("inquiries").select("id,item,quantity,status,created_at").eq("distributor_id", uid).order("created_at", { ascending: false })
    ]);

    [rels, locks, atts, inq].forEach(r => { if (r.error) throw r.error; });

    const relationships = rels.data || [];
    const buyerLocks = locks.data || [];
    const attachments = atts.data || [];

    const buyers = relationships.filter(r => String(r.status || "").toLowerCase() === "active").map(r => r.buyer_id);
    const agents = attachments.filter(a => String(a.status || "").toLowerCase() === "accepted").map(a => a.agent_id);
    const pendingAttachments = attachments.filter(a => String(a.status || "").toLowerCase() === "pending");

    const ids = [...new Set(
      buyers
        .concat(agents)
        .concat(buyerLocks.map(l => l.buyer_id))
        .concat(pendingAttachments.map(a => a.agent_id))
    )];
    const profileMap = await getProfiles(ids);

    distributorDashboardState.buyers = relationships.map(r => ({
      id: r.buyer_id,
      name: profileDisplayName(profileMap[r.buyer_id], r.buyer_id),
      status: r.status
    }));
    distributorDashboardState.acceptedAgents = agents.map(id => ({
      id, name: profileDisplayName(profileMap[id], id)
    }));
    distributorDashboardState.pendingAgents = pendingAttachments.map(a => ({
      id: a.id,
      agent_id: a.agent_id,
      name: profileDisplayName(profileMap[a.agent_id], a.agent_id),
      created_at: a.created_at
    }));

    renderDistributorDashboard();
  } catch (error) {
    console.error("[GoodsbarnX/relationship] distributor dashboard load failed:", error);
    renderDistributorDashboard();
  }
}

async function refreshDistributorDashboard() {
  await loadDistributorDashboardData();
}

async function approveDistributorAgent(attachmentId) {
  if (!attachmentId || !window.sb || !currentUser) return;
  distributorDashboardState.processingAgentId = attachmentId;
  setDistributorStatus("Approving agent attachment...", "success");
  try {
    const { data, error } = await window.sb
      .from("agent_distributor_attachments")
      .update({ status: "accepted" })
      .eq("id", attachmentId)
      .eq("distributor_id", currentUser.id)
      .eq("status", "pending")
      .select()
      .single();
    if (error) throw error;
    if (!data) throw new Error("The agent request could not be approved. It may have already been processed.");
    setDistributorStatus("Agent attachment approved.", "success");
    await refreshDistributorDashboard();
  } catch (error) {
    console.error("[GoodsbarnX/relationship] approve agent failed:", error);
    setDistributorStatus(error.message || "Unable to approve agent attachment.", "error");
  } finally {
    distributorDashboardState.processingAgentId = null;
  }
}

async function declineDistributorAgent(attachmentId) {
  if (!attachmentId || !window.sb || !currentUser) return;
  if (!window.confirm("Decline this agent attachment request?")) return;
  distributorDashboardState.processingAgentId = attachmentId;
  setDistributorStatus("Declining agent attachment...");
  try {
    const { data, error } = await window.sb
      .from("agent_distributor_attachments")
      .update({ status: "declined" })
      .eq("id", attachmentId)
      .eq("distributor_id", currentUser.id)
      .eq("status", "pending")
      .select()
      .single();
    if (error) throw error;
    if (!data) throw new Error("The agent request could not be declined. It may have already been processed.");
    setDistributorStatus("Agent attachment declined.", "success");
    await refreshDistributorDashboard();
  } catch (error) {
    console.error("[GoodsbarnX/relationship] decline agent failed:", error);
    setDistributorStatus(error.message || "Unable to decline agent attachment.", "error");
  } finally {
    distributorDashboardState.processingAgentId = null;
  }
}

// ==========================================================================
// PUBLIC API
// ==========================================================================

function openDistributorTools() {
  if (!currentUser || currentUser.role !== "distributor") return;
  const panel = mountDistributorDashboard();
  if (panel) panel.classList.add("active");
  loadDistributorDashboardData();
}

// ==========================================================================
// §7 RELATIONSHIP GRAPH — THREE-PANEL QUERY SURFACE (rev. 2)
// ==========================================================================

// --- Panel 1: Relationship Graph ----------------------------------------

async function loadRelationshipGraphPanel() {
  const container = document.getElementById("gbx-graph-panel");
  if (!container) return;
  if (!currentUser || currentUser.role !== "distributor") { container.innerHTML = ""; return; }
  if (!window.sb) {
    container.innerHTML = '<div class="section-label">Relationship Graph</div>' +
      '<div class="loading-text">Connection service unavailable.</div>';
    return;
  }

  container.innerHTML =
    '<div class="section-label">Relationship Graph</div>' +
    '<div class="loading-text">Reading relationship graph…</div>';

  const { data, error } = await safeSupabaseQuery(
    sb => sb.rpc("get_relationship_graph", { p_distributor_id: currentUser.id }),
    null,
    "loadRelationshipGraphPanel"
  );

  if (error) {
    relationshipGraphCache = { state: "S6_UNAVAILABLE", data: null, error: error.message };
    container.innerHTML =
      '<div class="section-label">Relationship Graph</div>' +
      '<div class="manifest" style="padding:14px;">' +
        '<div class="m-loc">Server RPC get_relationship_graph is not available. ' +
        'The graph query surface will activate once the RPC is applied.</div>' +
      '</div>';
    return;
  }

  const graph = data || {};
  const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
  const edges = Array.isArray(graph.edges) ? graph.edges : [];

  relationshipGraphCache = { state: "AVAILABLE", data: graph, error: null };

  if (!nodes.length && !edges.length) {
    container.innerHTML =
      '<div class="section-label">Relationship Graph</div>' +
      '<div class="manifest" style="padding:14px;">' +
        '<div class="m-loc">No nodes or edges in this distributor\'s graph yet.</div>' +
      '</div>';
    return;
  }

  const nodesByKind = nodes.reduce((acc, n) => {
    const k = n.kind || "unknown";
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});

  const nodesHtml = nodes.slice(0, 20).map(n =>
    '<div class="m-loc" style="margin-top:4px;">' +
      '<strong>' + relationshipEscapeHtml(n.label || n.id || "node") + '</strong>' +
      (n.kind ? ' · ' + relationshipEscapeHtml(n.kind) : "") +
      (n.status ? ' · ' + relationshipEscapeHtml(n.status) : "") +
    '</div>'
  ).join("");

  const edgesHtml = edges.slice(0, 20).map(e =>
    '<div class="m-loc" style="margin-top:4px;">' +
      relationshipEscapeHtml(String(e.from || "").slice(0, 8)) + ' → ' +
      relationshipEscapeHtml(String(e.to   || "").slice(0, 8)) +
      (e.kind ? ' · ' + relationshipEscapeHtml(e.kind) : "") +
      (e.status ? ' · ' + relationshipEscapeHtml(e.status) : "") +
    '</div>'
  ).join("");

  container.innerHTML =
    '<div class="section-label">Relationship Graph</div>' +
    '<div class="manifest" style="padding:14px;">' +
      '<div style="font-size:12px; font-weight:600;">' +
        nodes.length + ' node' + (nodes.length === 1 ? "" : "s") +
        ' · ' + edges.length + ' edge' + (edges.length === 1 ? "" : "s") +
      '</div>' +
      '<div class="m-loc" style="margin-top:6px;">' +
        Object.keys(nodesByKind).map(k => k + ': ' + nodesByKind[k]).join(' · ') +
      '</div>' +
      (nodesHtml ? '<div style="margin-top:10px;">' + nodesHtml + '</div>' : "") +
      (edgesHtml ? '<div style="margin-top:10px; border-top:1px dashed var(--line-dark); padding-top:10px;">' + edgesHtml + '</div>' : "") +
    '</div>';
}

// --- Panel 2: Blocked Opportunities -------------------------------------

async function loadBlockedOpportunitiesPanel() {
  const container = document.getElementById("gbx-blocked-panel");
  if (!container) return;
  if (!currentUser || currentUser.role !== "distributor") { container.innerHTML = ""; return; }
  if (!window.sb) {
    container.innerHTML = '<div class="section-label">Blocked Opportunities</div>' +
      '<div class="loading-text">Connection service unavailable.</div>';
    return;
  }

  container.innerHTML =
    '<div class="section-label">Blocked Opportunities</div>' +
    '<div class="loading-text">Reading blocked opportunities…</div>';

  const { data, error } = await safeSupabaseQuery(
    sb => sb.rpc("get_blocked_opportunities", { p_distributor_id: currentUser.id }),
    null,
    "loadBlockedOpportunitiesPanel"
  );

  if (error) {
    blockedOpportunitiesCache = { state: "S6_UNAVAILABLE", data: null, error: error.message };
    container.innerHTML =
      '<div class="section-label">Blocked Opportunities</div>' +
      '<div class="manifest" style="padding:14px;">' +
        '<div class="m-loc">Server RPC get_blocked_opportunities is not available. ' +
        'Blocked-opportunity resolution will activate once the RPC is applied.</div>' +
      '</div>';
    return;
  }

  const rows = Array.isArray(data) ? data : (Array.isArray(data?.rows) ? data.rows : []);

  blockedOpportunitiesCache = { state: "AVAILABLE", data: rows, error: null };

  if (!rows.length) {
    container.innerHTML =
      '<div class="section-label">Blocked Opportunities</div>' +
      '<div class="manifest" style="padding:14px;">' +
        '<div class="m-loc">No blocked opportunities from current evidence.</div>' +
      '</div>';
    return;
  }

  container.innerHTML =
    '<div class="section-label">Blocked Opportunities</div>' +
    rows.slice(0, 20).map(r =>
      '<div class="manifest" style="padding:10px 14px;">' +
        '<div style="font-size:12px; font-weight:600;">' +
          relationshipEscapeHtml(r.item || "Unspecified demand") +
          (r.blocker_code ? ' · <span style="color:var(--stamp);">' + relationshipEscapeHtml(r.blocker_code) + '</span>' : "") +
        '</div>' +
        (r.blocker_reason ? '<div class="m-loc">' + relationshipEscapeHtml(r.blocker_reason) + '</div>' : "") +
        (r.product_name
          ? '<div class="m-loc">Matched product: ' + relationshipEscapeHtml(r.product_name) +
            (r.stock_quantity != null ? ' · stock ' + relationshipEscapeHtml(String(r.stock_quantity)) : "") +
            '</div>'
          : "") +
      '</div>'
    ).join("");
}

// --- Panel 3: Routing Options -------------------------------------------

async function loadRoutingOptionsPanel() {
  const container = document.getElementById("gbx-routing-panel");
  if (!container) return;
  if (!currentUser || currentUser.role !== "distributor") { container.innerHTML = ""; return; }

  const candidates = Array.isArray(window.goodsbarnxAllocationCandidates)
    ? window.goodsbarnxAllocationCandidates
    : [];

  const routable = candidates.filter(c =>
    c.route_state === "ALLOCATED" || c.route_state === "READY" ||
    c.routeStatus === "READY"
  );

  if (!routable.length) {
    container.innerHTML =
      '<div class="section-label">Routing Options</div>' +
      '<div class="manifest" style="padding:14px;">' +
        '<div class="m-loc">No routing-ready opportunity in the current pipeline snapshot. ' +
        'Run the Master Stock Depletor to refresh.</div>' +
      '</div>';
    return;
  }

  routingOptionsCache = { state: "AVAILABLE", data: routable, error: null };

  container.innerHTML =
    '<div class="section-label">Routing Options</div>' +
    routable.slice(0, 10).map(c => {
      const productId = c.product_id || c.productId || "—";
      const buyerId   = c.buyer_id   || c.buyerId   || null;
      const qty = (c.allocatable_quantity != null ? c.allocatable_quantity : c.allocatableQuantity) || 0;
      const agent = (c.who_can_move_it && c.who_can_move_it.agent_id) || null;
      return '<div class="manifest" style="padding:10px 14px;">' +
        '<div class="m-name">Product ' + relationshipEscapeHtml(String(productId)) + '</div>' +
        '<div class="m-loc">' +
          relationshipEscapeHtml(String(qty)) + ' units allocatable' +
          (agent ? ' · via agent ' + relationshipEscapeHtml(String(agent).slice(0, 8)) : ' · direct') +
        '</div>' +
        (buyerId
          ? '<div style="margin-top:8px;">' +
              '<button class="btn btn-outline" data-product-id="' + relationshipEscapeAttribute(String(productId)) + '" data-buyer-id="' + relationshipEscapeAttribute(String(buyerId)) + '" onclick="inspectRoutingOption(this.dataset.productId, this.dataset.buyerId)">Inspect route</button>' +
            '</div>'
          : "") +
      '</div>';
    }).join("");
}

async function inspectRoutingOption(productId, buyerId) {
  if (!window.sb) return;
  const { data, error } = await safeSupabaseQuery(
    sb => sb.rpc("get_routing_options", { p_product_id: productId, p_buyer_id: buyerId }),
    null,
    "inspectRoutingOption"
  );

  if (error) {
    alert("Routing options RPC unavailable: " + (error.message || error));
    return;
  }

  // Step 3b: the RPC returns { product_id, buyer_id, distributor_id,
  // paths: [...], path_count, provisional, provisional_note, read_only }.
  // Read `paths`, not `rows`.
  const paths = Array.isArray(data?.paths) ? data.paths : [];
  if (!paths.length) { alert("No alternative routes for this opportunity."); return; }

  const text = paths.map(r =>
    "· " + (r.route_type || r.routeType || "route") +
    (r.distributor_id ? " via distributor " + String(r.distributor_id).slice(0, 8) : "") +
    (r.agent_id ? " via agent " + String(r.agent_id).slice(0, 8) : "") +
    (r.status ? " (" + r.status + ")" : "") +
    (r.stock_available === false ? " — no stock" : "")
  ).join("\n");

  const header = data && data.provisional
    ? "Routing options (provisional):\n\n"
    : "Routing options:\n\n";
  const footer = data && data.provisional_note
    ? "\n\nNote: " + data.provisional_note
    : "";

  alert(header + text + footer);
}

// ==========================================================================
// INITIALIZATION
// ==========================================================================

async function initRelationshipLayer() {
  if (!window.sb) {
    window.addEventListener("supabase-ready", () => { initRelationshipLayer(); }, { once: true });
    return;
  }
  if (!currentUser) return;
  if (relationshipLayerInitialized) return;

  try {
    if (currentUser.role === "buyer") {
      await loadMyTradeRelationship();
    } else if (currentUser.role === "distributor") {
      await loadMyTradeRelationships();
      await loadDistributorDashboardData();

      await Promise.all([
        loadRelationshipGraphPanel(),
        loadBlockedOpportunitiesPanel(),
        loadRoutingOptionsPanel()
      ]);
    } else if (currentUser.role === "agent") {
      // agent.js owns the agent-role relationship list.
    }
    relationshipLayerInitialized = true;
  } catch (error) {
    console.error("[GoodsbarnX/relationship] initRelationshipLayer failed:", error);
  }
}

window.addEventListener("supabase-ready", () => {
  relationshipLayerInitialized = false;
  initRelationshipLayer();
});

window.addEventListener("auth-state-changed", (event) => {
  if (event.detail?.user) {
    currentUser = event.detail.user;
    relationshipLayerInitialized = false;
    initRelationshipLayer();
  }
});

(function registerRelationshipScreen() {
  if (typeof registerScreenLoader !== "function") {
    console.warn("[GoodsbarnX/relationship] registerScreenLoader unavailable; relationship screen has no loader.");
    return;
  }
  registerScreenLoader("relationship", function relationshipLoader() {
    return initRelationshipLayer();
  });
})();

// ==========================================================================
// GLOBAL EXPORTS
// ==========================================================================

window.loadMyTradeRelationship    = loadMyTradeRelationship;
window.loadMyTradeRelationships   = loadMyTradeRelationships;
window.initRelationshipLayer      = initRelationshipLayer;
window.openEditTermsModal         = openEditTermsModal;
window.closeEditTermsModal        = closeEditTermsModal;
window.saveRelationshipTerms      = saveRelationshipTerms;
window.openInviteBuyerModal       = openInviteBuyerModal;
window.closeInviteBuyerModal      = closeInviteBuyerModal;
window.searchBuyersForInvite      = searchBuyersForInvite;
window.inviteBuyerToRelationship  = inviteBuyerToRelationship;
window.openAddBuyerModal          = openAddBuyerModal;
window.closeAddBuyerModal         = closeAddBuyerModal;
window.submitAddBuyer             = submitAddBuyer;
window.updateRelationshipStatus   = updateRelationshipStatus;
window.openAssignAgentModal       = openAssignAgentModal;
window.closeAssignAgentModal      = closeAssignAgentModal;
window.searchAgentsForAssignment  = searchAgentsForAssignment;
window.assignAgentToRelationship  = assignAgentToRelationship;
window.openManagePaymentMethodsModal    = openManagePaymentMethodsModal;
window.closeManagePaymentMethodsModal   = closeManagePaymentMethodsModal;
window.addPaymentMethod                 = addPaymentMethod;
window.makePaymentMethodDefault         = makePaymentMethodDefault;
window.togglePaymentMethodActive        = togglePaymentMethodActive;
window.openManagePreferredProductsModal = openManagePreferredProductsModal;
window.closeManagePreferredProductsModal= closeManagePreferredProductsModal;
window.searchDistributorProductsForPreference = searchDistributorProductsForPreference;
window.addProductPreference             = addProductPreference;
window.setNegotiatedPrice               = setNegotiatedPrice;
window.removeProductPreference          = removeProductPreference;
window.searchBuyersForAgentReferral     = searchBuyersForAgentReferral;
window.createAgentReferredBuyerRelationship = createAgentReferredBuyerRelationship;
window.openDistributorTools             = openDistributorTools;
window.refreshDistributorDashboard      = refreshDistributorDashboard;
window.approveDistributorAgent          = approveDistributorAgent;
window.declineDistributorAgent          = declineDistributorAgent;
window.loadRelationshipGraphPanel       = loadRelationshipGraphPanel;
window.loadBlockedOpportunitiesPanel    = loadBlockedOpportunitiesPanel;
window.loadRoutingOptionsPanel          = loadRoutingOptionsPanel;
window.inspectRoutingOption             = inspectRoutingOption;

console.log("[GoodsbarnX] relationship.js loaded (V1.8.2.6 rev.2)");
