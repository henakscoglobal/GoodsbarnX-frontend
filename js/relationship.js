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
// ==========================================================================


// ==========================================================================
// DISPUTES
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

function renderDisputeSummaryLine(disputes) {
  if (!disputes || disputes.length === 0) return "";

  const openCount = disputes.filter(d =>
    DISPUTE_OPEN_STATUSES.includes(d.status)
  ).length;

  const color = openCount > 0 ? "var(--stamp)" : "var(--ok)";

  return `
    <div style="
      font-size:12px;
      margin-top:4px;
      color:${color};
      font-weight:600;
    ">
      ${disputes.length}
      dispute${disputes.length === 1 ? "" : "s"}
      ${openCount > 0
        ? ` · ${openCount} open`
        : " · all resolved"}
    </div>
  `;
}


// ==========================================================================
// BUYER — RELATIONSHIP DISPUTES
// ==========================================================================

async function loadRelationshipDisputes(relationshipId) {
  const container = document.getElementById("my-relationship-disputes");

  if (!container) return;

  const { data: disputes, error } = await sb
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
    .order("created_at", { ascending: false });

  if (error) {
    console.error(
      "Relationship disputes lookup failed:",
      error.message
    );

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

      const color =
        DISPUTE_STATUS_COLORS[d.status] || "var(--brass)";

      return `
        <div class="manifest">

          <div class="manifest-top">

            <div>

              <div class="m-name">
                ${d.category || "Dispute"}
              </div>

              <div class="m-loc">
                ${d.description || ""}
              </div>

            </div>

            <span
              class="stamp-badge"
              style="
                border-color:${color};
                color:${color};
              "
            >
              ${(d.status || "").toUpperCase()}
            </span>

          </div>

          ${
            d.resolution
              ? `
                <div
                  class="m-loc"
                  style="
                    margin-top:8px;
                    border-top:1px dashed var(--line-dark);
                    padding-top:8px;
                  "
                >
                  Resolution: ${d.resolution}
                </div>
              `
              : ""
          }

          <div
            class="m-loc"
            style="
              margin-top:6px;
              font-size:10px;
            "
          >
            ${new Date(d.created_at).toLocaleDateString()}
            ${
              d.resolved_at
                ? ` · Resolved ${new Date(
                    d.resolved_at
                  ).toLocaleDateString()}`
                : ""
            }
          </div>

        </div>
      `;
    }).join("")}
  `;
}


// ==========================================================================
// RELATIONSHIP HISTORY
// ==========================================================================

const RELATIONSHIP_EVENT_LABELS = {

  relationship_created:
    "Relationship created",

  relationship_activated:
    "Relationship activated",

  relationship_paused:
    "Relationship paused",

  relationship_resumed:
    "Relationship resumed",

  relationship_released:
    "Relationship released",

  relationship_terminated:
    "Relationship terminated",

  commercial_terms_created:
    "Trade terms set",

  commercial_terms_updated:
    "Trade terms updated",

  agent_assigned:
    "Agent assigned",

  agent_unassigned:
    "Agent unassigned",

  payment_method_added:
    "Payment method added",

  payment_method_changed:
    "Payment method changed",

  credit_enabled:
    "Credit enabled",

  credit_limit_changed:
    "Credit limit changed",

  product_preference_added:
    "Product preference added",

  dispute_opened:
    "Dispute opened",

  dispute_resolved:
    "Dispute resolved"
};

function formatEventType(eventType) {

  if (!eventType) {
    return "Relationship event";
  }

  return (
    RELATIONSHIP_EVENT_LABELS[eventType] ||
    eventType.replace(/_/g, " ")
  );
}


async function loadRelationshipHistory(relationshipId) {

  const container =
    document.getElementById("my-relationship-history");

  if (!container) return;

  const { data: events, error } = await sb
    .from("relationship_events")
    .select("event_type, created_at")
    .eq("relationship_id", relationshipId)
    .order("created_at", {
      ascending: false
    })
    .limit(10);

  if (error) {

    console.error(
      "Relationship history lookup failed:",
      error.message
    );

    container.innerHTML = "";
    return;
  }

  if (!events || events.length === 0) {

    container.innerHTML = `
      <div class="section-label">
        Relationship History
      </div>

      <div class="loading-text">
        No history yet.
      </div>
    `;

    return;
  }

  container.innerHTML = `

    <div class="section-label">
      Relationship History
    </div>

    <div
      class="manifest"
      style="padding:6px 16px;"
    >

      ${events.map((e, i) => `

        <div
          style="
            padding:10px 0;
            ${
              i < events.length - 1
                ? "border-bottom:1px dashed var(--line-dark);"
                : ""
            }
          "
        >

          <div
            style="
              font-size:13px;
              font-weight:600;
            "
          >
            ${formatEventType(e.event_type)}
          </div>

          <div
            style="
              font-size:11px;
              color:rgba(18,21,28,0.5);
              margin-top:2px;
            "
          >
            ${new Date(e.created_at).toLocaleString()}
          </div>

        </div>

      `).join("")}

    </div>
  `;
}


// ==========================================================================
// RELATIONSHIP STATUS
// ==========================================================================

const RELATIONSHIP_STATUS_LABELS = {

  pending: "Pending",

  active: "Active",

  paused: "Paused",

  released: "Released",

  terminated: "Terminated"
};


// ==========================================================================
// TRUST
// ==========================================================================

function renderTrustLine(trust) {

  if (!trust || trust.trust_score == null) {
    return "";
  }

  const score = Number(trust.trust_score);

  const scoreColor =
    score >= 70
      ? "var(--ok)"
      : score >= 40
        ? "var(--brass)"
        : "var(--stamp)";

  const completed =
    trust.completed_orders || 0;

  const disputed =
    trust.disputed_orders || 0;

  return `
    <div
      style="
        display:flex;
        align-items:center;
        gap:6px;
        margin-top:6px;
        font-size:12px;
      "
    >

      <span
        style="
          font-weight:700;
          color:${scoreColor};
        "
      >
        Trust ${score}/100
      </span>

      <span
        style="
          color:rgba(18,21,28,0.5);
        "
      >
        · ${completed}
        completed order${completed === 1 ? "" : "s"}
        ${
          disputed
            ? ` · ${disputed} disputed`
            : ""
        }
      </span>

    </div>
  `;
}


// ==========================================================================
// LOYALTY
// ==========================================================================

function renderLoyaltyLine(loyalty) {

  if (
    !loyalty ||
    !loyalty.loyalty_level
  ) {
    return "";
  }

  const points =
    loyalty.loyalty_points != null
      ? Number(loyalty.loyalty_points)
      : null;

  const consecutive =
    loyalty.consecutive_order_count || 0;

  return `
    <div
      style="
        display:flex;
        align-items:center;
        gap:6px;
        margin-top:4px;
        font-size:12px;
      "
    >

      <span
        class="stamp-badge"
        style="
          font-size:9px;
          padding:2px 6px;
          border-color:var(--brass);
          color:var(--brass-dark);
          transform:none;
        "
      >
        ${String(loyalty.loyalty_level).toUpperCase()}
      </span>

      <span
        style="
          color:rgba(18,21,28,0.5);
        "
      >
        ${points != null ? `${points} pts` : ""}
        ${
          consecutive
            ? ` · ${consecutive} in a row`
            : ""
        }
      </span>

    </div>
  `;
}


// ==========================================================================
// BUYER — MY TRADE RELATIONSHIP
// ==========================================================================

async function loadMyTradeRelationship() {

  const container =
    document.getElementById("my-relationship-card");

  if (
    !container ||
    !currentUser ||
    currentUser.role !== "buyer"
  ) {
    return;
  }

  container.innerHTML = `
    <div class="loading-text">
      Loading your distributor relationship...
    </div>
  `;

  const {
    data: relationship,
    error
  } = await sb
    .from("trade_relationships")
    .select("*")
    .eq("buyer_id", currentUser.id)
    .eq("is_primary", true)
    .maybeSingle();

  if (error) {

    console.error(
      "Trade relationship lookup failed:",
      error.message
    );

    container.innerHTML = "";
    return;
  }

  if (!relationship) {

    container.innerHTML = "";
    return;
  }


  // ------------------------------------------------------------
  // Distributor
  // ------------------------------------------------------------

  const { data: distributor } = await sb
    .from("distributor_profiles")
    .select(`
      business_name,
      location,
      market
    `)
    .eq("id", relationship.distributor_id)
    .maybeSingle();


  // ------------------------------------------------------------
  // Current approved trade terms
  // ------------------------------------------------------------

  const { data: terms } = await sb
    .from("current_relationship_trade_terms")
    .select(`
      credit_enabled,
      credit_limit,
      credit_days
    `)
    .eq("buyer_id", currentUser.id)
    .eq(
      "distributor_id",
      relationship.distributor_id
    )
    .maybeSingle();


  // ------------------------------------------------------------
  // Trust
  // ------------------------------------------------------------

  const { data: trust } = await sb
    .from("relationship_trust")
    .select(`
      trust_score,
      completed_orders,
      disputed_orders
    `)
    .eq("relationship_id", relationship.id)
    .maybeSingle();


  // ------------------------------------------------------------
  // Loyalty
  // ------------------------------------------------------------

  const { data: loyalty } = await sb
    .from("relationship_loyalty")
    .select(`
      loyalty_level,
      loyalty_points,
      consecutive_order_count
    `)
    .eq("relationship_id", relationship.id)
    .maybeSingle();


  const distributorName =
    distributor?.business_name ||
    "Your distributor";

  const statusLabel =
    RELATIONSHIP_STATUS_LABELS[
      relationship.status
    ] || relationship.status;

  const startedDate =
    relationship.relationship_started_at
      ? new Date(
          relationship.relationship_started_at
        ).toLocaleDateString()
      : null;


  // ------------------------------------------------------------
  // Approved credit
  // ------------------------------------------------------------

  const creditHtml =
    terms?.credit_enabled
      ? `
        <div
          style="
            border-top:1px dashed var(--line-dark);
            margin-top:10px;
            padding-top:10px;
          "
        >

          <div
            style="
              font-size:11px;
              text-transform:uppercase;
              letter-spacing:0.05em;
              color:rgba(18,21,28,0.5);
              font-weight:700;
              margin-bottom:4px;
            "
          >
            Credit Terms (Approved)
          </div>

          <div style="font-size:13px;">

            ${
              terms.credit_limit
                ? `
                  Limit:
                  <strong>
                    ₦${Number(
                      terms.credit_limit
                    ).toLocaleString()}
                  </strong>
                `
                : ""
            }

            ${
              terms.credit_days
                ? ` · ${terms.credit_days} days`
                : ""
            }

          </div>

        </div>
      `
      : "";


  // ------------------------------------------------------------
  // Render
  // ------------------------------------------------------------

  container.innerHTML = `

    <div class="manifest">

      <div class="manifest-top">

        <div>

          <div class="m-name">
            ${distributorName}
          </div>

          <div class="m-loc">
            ${distributor?.location || ""}
            ${
              distributor?.market
                ? " · " + distributor.market
                : ""
            }
          </div>

        </div>

        <span
          class="stamp-badge"
          style="
            border-color:
              ${
                relationship.status === "active"
                  ? "var(--ok)"
                  : "var(--brass)"
              };

            color:
              ${
                relationship.status === "active"
                  ? "var(--ok)"
                  : "var(--brass)"
              };
          "
        >
          ${String(statusLabel).toUpperCase()}
        </span>

      </div>

      ${
        startedDate
          ? `
            <div
              class="m-loc"
              style="margin-top:8px;"
            >
              Trading together since ${startedDate}
            </div>
          `
          : ""
      }

      ${renderTrustLine(trust)}

      ${renderLoyaltyLine(loyalty)}

      ${creditHtml}

    </div>

  `;


  loadMyPreferredProducts(
    relationship.id,
    relationship.distributor_id,
    distributorName
  );

  loadRelationshipHistory(
    relationship.id
  );

  loadRelationshipDisputes(
    relationship.id
  );

  loadRelationshipPaymentMethods(
    relationship.id
  );
}


// ==========================================================================
// BUYER — PREFERRED PRODUCTS
// ==========================================================================

async function loadMyPreferredProducts(
  relationshipId,
  distributorId,
  distributorName
) {

  const container =
    document.getElementById(
      "my-preferred-products"
    );

  if (!container) return;

  const {
    data: prefs,
    error
  } = await sb
    .from("relationship_product_preferences")
    .select("*")
    .eq(
      "relationship_id",
      relationshipId
    )
    .eq("preferred", true);

  if (error) {

    console.error(
      "Preferred products lookup failed:",
      error.message
    );

    container.innerHTML = "";
    return;
  }

  if (!prefs || prefs.length === 0) {

    container.innerHTML = "";
    return;
  }

  const productIds =
    prefs.map(p => p.product_id);

  const { data: products } =
    await sb
      .from("products")
      .select(`
        id,
        name,
        sku,
        brand,
        price,
        image_url,
        stock_quantity,
        status
      `)
      .in("id", productIds);

  const productMap = {};

  (products || []).forEach(p => {
    productMap[p.id] = p;
  });

  const rows =
    prefs
      .map(pref => ({
        pref,
        product: productMap[pref.product_id]
      }))
      .filter(
        ({ product }) =>
          product &&
          product.status === "active"
      );

  if (rows.length === 0) {

    container.innerHTML = "";
    return;
  }

  container.innerHTML = `

    <div class="section-label">
      Your Preferred Products
    </div>

    ${rows.map(({ pref, product }) => {

      const publicPrice =
        product.price || 0;

      const hasNegotiated =
        pref.negotiated_unit_price != null;

      const finalPrice =
        hasNegotiated
          ? pref.negotiated_unit_price
          : publicPrice;

      const priceHtml =
        !product.price &&
        !hasNegotiated

          ? "Negotiable"

          : hasNegotiated

            ? `
              <span
                style="
                  text-decoration:line-through;
                  color:rgba(18,21,28,0.4);
                  font-size:11px;
                "
              >
                ₦${publicPrice.toLocaleString()}
              </span>

              <span
                style="
                  color:var(--ok);
                  font-weight:700;
                "
              >
                ₦${Number(
                  finalPrice
                ).toLocaleString()}
              </span>
            `

            : `₦${Number(
                publicPrice
              ).toLocaleString()}`;


      return `

        <div class="product-item">

          <div
            class="product-image"
            style="
              ${
                product.image_url
                  ? `background-image:url('${product.image_url}')`
                  : "background-color:var(--ink-2);"
              }
            "
          ></div>

          <div
            style="
              display:inline-block;
              width:calc(100% - 80px);
            "
          >

            <div
              style="
                font-weight:600;
                font-size:13px;
              "
            >
              ${product.name}

              <span
                style="
                  color:var(--brass-dark);
                  font-size:11px;
                "
              >
                ★
              </span>
            </div>

            <div
              style="
                font-size:11px;
                color:rgba(18,21,28,0.55);
                margin-top:2px;
              "
            >
              ${
                product.brand
                  ? product.brand + " · "
                  : ""
              }

              ${product.sku || "No SKU"}
            </div>

            <div
              style="
                font-size:12px;
                margin-top:4px;
              "
            >
              ${priceHtml}
            </div>

            <div style="margin-top:8px;">

              <button
                class="btn btn-success"
                onclick="
                  addToCart(
                    '${product.id}',
                    '${String(product.name).replace(/'/g, "\\'")}',
                    ${Number(finalPrice) || 0},
                    '${distributorId}',
                    '${String(distributorName).replace(/'/g, "\\'")}'
                  )
                "
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
// DISTRIBUTOR — MY TRADE RELATIONSHIPS
// ==========================================================================

async function loadMyTradeRelationships() {

  const container =
    document.getElementById(
      "my-relationships-list"
    );

  if (
    !container ||
    !currentUser ||
    currentUser.role !== "distributor"
  ) {
    return;
  }

  const inviteButtonHtml = `
    <div
      class="section-label"
      style="margin-top:0;"
    >
      Your Trade Relationships
    </div>

    <button
      class="btn btn-primary btn-block"
      style="margin-bottom:14px;"
      onclick="openInviteBuyerModal()"
    >
      + Invite a Buyer
    </button>
  `;

  container.innerHTML =
    inviteButtonHtml +
    `
      <div class="loading-text">
        Loading your trade relationships...
      </div>
    `;


  const {
    data: relationships,
    error
  } = await sb
    .from("trade_relationships")
    .select("*")
    .eq(
      "distributor_id",
      currentUser.id
    )
    .order(
      "created_at",
      { ascending: false }
    );

  if (error) {

    console.error(
      "Trade relationships lookup failed:",
      error.message
    );

    container.innerHTML =
      inviteButtonHtml;

    return;
  }

  if (
    !relationships ||
    relationships.length === 0
  ) {

    container.innerHTML =
      inviteButtonHtml +
      `
        <div class="loading-text">
          No buyer relationships yet.
        </div>
      `;

    return;
  }

  const buyerIds =
    relationships.map(r => r.buyer_id);

  const relationshipIds =
    relationships.map(r => r.id);


  const [
    { data: buyers },
    { data: trustRows },
    { data: loyaltyRows },
    { data: termsRows },
    { data: disputeRows }
  ] = await Promise.all([

    sb
      .from("buyer_profiles")
      .select(
        "id, name, profiles(full_name, phone)"
      )
      .in("id", buyerIds),

    sb
      .from("relationship_trust")
      .select(`
        relationship_id,
        total_trade_value,
        trust_score,
        completed_orders,
        disputed_orders
      `)
      .in(
        "relationship_id",
        relationshipIds
      ),

    sb
      .from("relationship_loyalty")
      .select(`
        relationship_id,
        loyalty_level,
        loyalty_points,
        consecutive_order_count
      `)
      .in(
        "relationship_id",
        relationshipIds
      ),

    sb
      .from("current_relationship_trade_terms")
      .select(`
        buyer_id,
        credit_enabled,
        credit_limit,
        credit_days,
        default_discount_percent
      `)
      .eq(
        "distributor_id",
        currentUser.id
      ),

    sb
      .from("relationship_disputes")
      .select(
        "relationship_id, status"
      )
      .in(
        "relationship_id",
        relationshipIds
      )

  ]);


  const buyerMap = {};

  (buyers || []).forEach(b => {
    buyerMap[b.id] = b;
  });


  const trustMap = {};

  (trustRows || []).forEach(t => {
    trustMap[t.relationship_id] = t;
  });


  const loyaltyMap = {};

  (loyaltyRows || []).forEach(l => {
    loyaltyMap[l.relationship_id] = l;
  });


  const termsMap = {};

  (termsRows || []).forEach(t => {
    termsMap[t.buyer_id] = t;
  });


  const disputesMap = {};

  (disputeRows || []).forEach(d => {

    if (!disputesMap[d.relationship_id]) {
      disputesMap[d.relationship_id] = [];
    }

    disputesMap[d.relationship_id].push(d);

  });


  container.innerHTML =
    inviteButtonHtml +

    relationships.map(r => {

      const buyer =
        buyerMap[r.buyer_id];

      const buyerName =
        buyer?.name ||
        buyer?.profiles?.full_name ||
        "Buyer";

      const phone =
        buyer?.profiles?.phone || "";

      const statusLabel =
        RELATIONSHIP_STATUS_LABELS[
          r.status
        ] || r.status;

      const trust =
        trustMap[r.id];

      const loyalty =
        loyaltyMap[r.id];

      const terms =
        termsMap[r.buyer_id];

      const disputes =
        disputesMap[r.id];


      return `

        <div class="manifest">

          <div class="manifest-top">

            <div>

              <div class="m-name">

                ${buyerName}

                ${
                  r.is_primary
                    ? `
                      <span
                        style="
                          font-size:10px;
                          color:var(--brass-dark);
                        "
                      >
                        · PRIMARY
                      </span>
                    `
                    : ""
                }

              </div>

              <div class="m-loc">
                ${phone}
              </div>

            </div>

            <span
              class="stamp-badge"
              style="
                border-color:
                  ${
                    r.status === "active"
                      ? "var(--ok)"
                      : "var(--brass)"
                  };

                color:
                  ${
                    r.status === "active"
                      ? "var(--ok)"
                      : "var(--brass)"
                  };
              "
            >
              ${String(statusLabel).toUpperCase()}
            </span>

          </div>

          <div
            style="
              font-size:12px;
              margin-top:6px;
              color:rgba(18,21,28,0.6);
            "
          >

            ${
              trust?.total_trade_value
                ? `
                  Lifetime trade:
                  ₦${Number(
                    trust.total_trade_value
                  ).toLocaleString()}
                `
                : "No trade history yet"
            }

            ${
              terms?.credit_enabled
                ? `
                  · Credit:
                  ₦${Number(
                    terms.credit_limit || 0
                  ).toLocaleString()}
                  /
                  ${terms.credit_days || 0}d
                `
                : ""
            }

          </div>

          ${renderTrustLine(trust)}

          ${renderLoyaltyLine(loyalty)}

          ${renderDisputeSummaryLine(disputes)}

          <div
            style="
              margin-top:10px;
            "
          >

            <button
              class="btn btn-outline"
              onclick="
                openEditTermsModal('${r.id}')
              "
            >
              Edit Terms
            </button>

            <button
              class="btn btn-outline"
              onclick="
                openAssignAgentModal('${r.id}')
              "
            >
              Assign Agent
            </button>

            <button
              class="btn btn-outline"
              onclick="
                openManagePaymentMethodsModal('${r.id}')
              "
            >
              Payment Methods
            </button>

            <button
              class="btn btn-outline"
              onclick="
                openManagePreferredProductsModal('${r.id}')
              "
            >
              Preferred Products
            </button>

          </div>

          ${renderRelationshipActions(
            r.id,
            r.status
          )}

        </div>

      `;

    }).join("");


  // Cache terms for modal
  window.__relTermsCache = {};

  relationships.forEach(r => {

    const buyer =
      buyerMap[r.buyer_id];

    const terms =
      termsMap[r.buyer_id];

    window.__relTermsCache[r.id] = {

      buyerName:
        buyer?.name ||
        buyer?.profiles?.full_name ||
        "Buyer",

      discount:
        terms?.default_discount_percent ?? "",

      creditEnabled:
        terms?.credit_enabled ?? false,

      creditLimit:
        terms?.credit_limit ?? "",

      creditDays:
        terms?.credit_days ?? ""

    };

  });
}


// ==========================================================================
// AGENT — MY RELATIONSHIPS
// ==========================================================================

async function loadMyAgentRelationships() {

  const container =
    document.getElementById(
      "agent-relationships-list"
    );

  if (
    !container ||
    !currentUser ||
    currentUser.role !== "agent"
  ) {
    return;
  }

  container.innerHTML = `
    <div class="loading-text">
      Loading your assigned relationships...
    </div>
  `;


  const {
    data: assignments,
    error
  } = await sb
    .from("relationship_agents")
    .select(`
      relationship_id,
      is_primary,
      assigned_at
    `)
    .eq(
      "agent_id",
      currentUser.id
    )
    .is(
      "unassigned_at",
      null
    );


  if (error) {

    console.error(
      "Agent relationship assignments lookup failed:",
      error.message
    );

    container.innerHTML = "";

    return;
  }


  if (
    !assignments ||
    assignments.length === 0
  ) {

    container.innerHTML = `
      <div class="loading-text">
        No relationships assigned to you yet.
      </div>
    `;

    return;
  }


  const relationshipIds =
    assignments.map(
      a => a.relationship_id
    );


  const {
    data: relationships
  } = await sb
    .from("trade_relationships")
    .select("*")
    .in(
      "id",
      relationshipIds
    );


  if (
    !relationships ||
    relationships.length === 0
  ) {

    container.innerHTML = `
      <div class="loading-text">
        No relationships assigned to you yet.
      </div>
    `;

    return;
  }


  const buyerIds =
    relationships.map(
      r => r.buyer_id
    );

  const distributorIds =
    relationships.map(
      r => r.distributor_id
    );


  const [
    { data: buyers },
    { data: distributors },
    { data: trustRows }
  ] = await Promise.all([

    sb
      .from("buyer_profiles")
      .select(
        "id, name, profiles(full_name, phone)"
      )
      .in(
        "id",
        buyerIds
      ),

    sb
      .from("distributor_profiles")
      .select(
        "id, business_name, location, market"
      )
      .in(
        "id",
        distributorIds
      ),

    sb
      .from("relationship_trust")
      .select(`
        relationship_id,
        trust_score,
        completed_orders,
        disputed_orders
      `)
      .in(
        "relationship_id",
        relationshipIds
      )

  ]);


  const buyerMap = {};

  (buyers || []).forEach(b => {
    buyerMap[b.id] = b;
  });


  const distributorMap = {};

  (distributors || []).forEach(d => {
    distributorMap[d.id] = d;
  });


  const trustMap = {};

  (trustRows || []).forEach(t => {
    trustMap[t.relationship_id] = t;
  });


  const assignmentMap = {};

  assignments.forEach(a => {
    assignmentMap[a.relationship_id] = a;
  });


  container.innerHTML =
    relationships.map(r => {

      const buyer =
        buyerMap[r.buyer_id];

      const distributor =
        distributorMap[r.distributor_id];

      const buyerName =
        buyer?.name ||
        buyer?.profiles?.full_name ||
        "Buyer";

      const distributorName =
        distributor?.business_name ||
        "Distributor";

      const statusLabel =
        RELATIONSHIP_STATUS_LABELS[
          r.status
        ] || r.status;

      const trust =
        trustMap[r.id];

      const assignment =
        assignmentMap[r.id];


      return `

        <div class="manifest">

          <div class="manifest-top">

            <div>

              <div class="m-name">

                ${buyerName}

                <span
                  style="
                    color:rgba(18,21,28,0.4);
                  "
                >
                  ↔
                </span>

                ${distributorName}

              </div>

              <div class="m-loc">

                ${buyer?.profiles?.phone || ""}

                ${
                  distributor?.location
                    ? " · " +
                      distributor.location
                    : ""
                }

              </div>

            </div>

            <span
              class="stamp-badge"
              style="
                border-color:
                  ${
                    r.status === "active"
                      ? "var(--ok)"
                      : "var(--brass)"
                  };

                color:
                  ${
                    r.status === "active"
                      ? "var(--ok)"
                      : "var(--brass)"
                  };
              "
            >
              ${String(statusLabel).toUpperCase()}
            </span>

          </div>

          ${
            assignment?.is_primary
              ? `
                <div
                  class="m-loc"
                  style="margin-top:6px;"
                >
                  You are the primary agent
                </div>
              `
              : ""
          }

          ${renderTrustLine(trust)}

        </div>

      `;

    }).join("");
}


// ==========================================================================
// BUYER — APPROVED PAYMENT METHODS
// ==========================================================================

async function loadRelationshipPaymentMethods(
  relationshipId
) {

  const container =
    document.getElementById(
      "my-payment-methods"
    );

  if (!container) return;


  const {
    data: methods,
    error
  } = await sb
    .from("relationship_payment_methods")
    .select(`
      payment_method,
      is_default,
      is_active,
      transaction_limit
    `)
    .eq(
      "relationship_id",
      relationshipId
    )
    .eq(
      "is_active",
      true
    )
    .order(
      "is_default",
      { ascending: false }
    );


  if (error) {

    console.error(
      "Payment methods lookup failed:",
      error.message
    );

    container.innerHTML = "";

    return;
  }


  if (
    !methods ||
    methods.length === 0
  ) {

    container.innerHTML = "";

    return;
  }


  container.innerHTML = `

    <div class="section-label">
      Approved Payment Methods
    </div>

    <div
      class="manifest"
      style="padding:6px 16px;"
    >

      ${methods.map((m, i) => `

        <div
          style="
            padding:10px 0;
            ${
              i < methods.length - 1
                ? "border-bottom:1px dashed var(--line-dark);"
                : ""
            }
            display:flex;
            justify-content:space-between;
            align-items:center;
          "
        >

          <div>

            <span
              style="
                font-size:13px;
                font-weight:600;
              "
            >
              ${m.payment_method}
            </span>

            ${
              m.is_default
                ? `
                  <span
                    class="stamp-badge"
                    style="
                      font-size:8px;
                      padding:2px 6px;
                      border-color:var(--ok);
                      color:var(--ok);
                      transform:none;
                      margin-left:6px;
                    "
                  >
                    DEFAULT
                  </span>
                `
                : ""
            }

          </div>

          ${
            m.transaction_limit
              ? `
                <span
                  style="
                    font-size:11px;
                    color:rgba(18,21,28,0.5);
                  "
                >
                  Limit ₦${Number(
                    m.transaction_limit
                  ).toLocaleString()}
                </span>
              `
              : ""
          }

        </div>

      `).join("")}

    </div>
  `;
}


// ==========================================================================
// DISTRIBUTOR — EDIT TRADE TERMS
// ==========================================================================

let editingTermsRelationshipId = null;


function openEditTermsModal(
  relationshipId
) {

  const cached =
    window.__relTermsCache?.[
      relationshipId
    ];

  if (!cached) return;

  editingTermsRelationshipId =
    relationshipId;


  document.getElementById(
    "edit-terms-buyer-name"
  ).innerText =
    cached.buyerName;


  document.getElementById(
    "terms-discount"
  ).value =
    cached.discount;


  document.getElementById(
    "terms-credit-enabled"
  ).value =
    cached.creditEnabled
      ? "true"
      : "false";


  document.getElementById(
    "terms-credit-limit"
  ).value =
    cached.creditLimit;


  document.getElementById(
    "terms-credit-days"
  ).value =
    cached.creditDays;


  document.getElementById(
    "edit-terms-status"
  ).innerText = "";


  document.getElementById(
    "edit-terms-modal"
  ).classList.add("active");
}


function closeEditTermsModal() {

  document.getElementById(
    "edit-terms-modal"
  ).classList.remove("active");

  editingTermsRelationshipId =
    null;
}


async function saveRelationshipTerms() {

  if (!editingTermsRelationshipId) {
    return;
  }

  const status =
    document.getElementById(
      "edit-terms-status"
    );

  status.innerText =
    "Saving...";


  const discountRaw =
    document.getElementById(
      "terms-discount"
    ).value;

  const creditEnabled =
    document.getElementById(
      "terms-credit-enabled"
    ).value === "true";

  const creditLimitRaw =
    document.getElementById(
      "terms-credit-limit"
    ).value;

  const creditDaysRaw =
    document.getElementById(
      "terms-credit-days"
    ).value;


  const payload = {

    default_discount_percent:
      discountRaw !== ""
        ? parseFloat(discountRaw)
        : null,

    credit_enabled:
      creditEnabled,

    credit_limit:
      creditEnabled &&
      creditLimitRaw !== ""
        ? parseFloat(creditLimitRaw)
        : null,

    credit_days:
      creditEnabled &&
      creditDaysRaw !== ""
        ? parseInt(
            creditDaysRaw,
            10
          )
        : null

  };


  const {
    data: existing
  } = await sb
    .from(
      "relationship_trade_terms"
    )
    .select("id")
    .eq(
      "relationship_id",
      editingTermsRelationshipId
    )
    .maybeSingle();


  let error;


  if (existing) {

    ({ error } = await sb
      .from(
        "relationship_trade_terms"
      )
      .update(payload)
      .eq(
        "id",
        existing.id
      ));

  } else {

    ({
      error
    } = await sb
      .from(
        "relationship_trade_terms"
      )
      .insert({
        relationship_id:
          editingTermsRelationshipId,

        effective_from:
          new Date().toISOString(),

        ...payload
      }));

  }


  if (error) {

    status.innerText =
      "Error: " + error.message;

  } else {

    status.innerText =
      "Saved!";

    setTimeout(() => {

      closeEditTermsModal();

      loadMyTradeRelationships();

    }, 1000);

  }
}


// ==========================================================================
// DISTRIBUTOR — INVITE BUYER
// ==========================================================================

function openInviteBuyerModal() {

  document.getElementById(
    "invite-buyer-search"
  ).value = "";

  document.getElementById(
    "invite-buyer-results"
  ).innerHTML = "";

  document.getElementById(
    "invite-buyer-status"
  ).innerText = "";

  document.getElementById(
    "invite-buyer-modal"
  ).classList.add("active");
}


function closeInviteBuyerModal() {

  document.getElementById(
    "invite-buyer-modal"
  ).classList.remove("active");
}


async function searchBuyersForInvite() {

  const query =
    document.getElementById(
      "invite-buyer-search"
    ).value.trim();

  const resultsEl =
    document.getElementById(
      "invite-buyer-results"
    );


  if (query.length < 2) {

    resultsEl.innerHTML = "";

    return;
  }


  const {
    data: buyers,
    error
  } = await sb
    .from("buyer_profiles")
    .select(
      "id, name, location, profiles(full_name, phone)"
    )
    .or(
      `name.ilike.%${query}%`
    )
    .limit(10);


  if (error) {

    console.error(
      "Buyer search failed:",
      error.message
    );

    resultsEl.innerHTML = "";

    return;
  }


  if (
    !buyers ||
    buyers.length === 0
  ) {

    resultsEl.innerHTML = `
      <div class="loading-text">
        No matching buyers found.
      </div>
    `;

    return;
  }


  resultsEl.innerHTML =
    buyers.map(b => {

      const name =
        b.name ||
        b.profiles?.full_name ||
        "Buyer";

      const safeName =
        String(name)
          .replace(/\\/g, "\\\\")
          .replace(/'/g, "\\'");


      return `

        <div
          class="manifest"
          style="
            padding:12px;
            cursor:pointer;
          "
          onclick="
            inviteBuyerToRelationship(
              '${b.id}',
              '${safeName}'
            )
          "
        >

          <div class="m-name">
            ${name}
          </div>

          <div class="m-loc">

            ${b.location || ""}

            ${
              b.profiles?.phone
                ? " · " +
                  b.profiles.phone
                : ""
            }

          </div>

        </div>

      `;

    }).join("");
}


async function inviteBuyerToRelationship(
  buyerId,
  buyerName
) {

  const status =
    document.getElementById(
      "invite-buyer-status"
    );

  status.innerText =
    `Inviting ${buyerName}...`;


  const {
    error
  } = await sb.rpc(
    "create_trade_relationship",
    {
      p_buyer_id: buyerId,
      p_distributor_id:
        currentUser.id
    }
  );


  if (error) {

    status.innerText =
      "Error: " + error.message;

  } else {

    status.innerText =
      `${buyerName} added as a trade relationship!`;

    setTimeout(() => {

      closeInviteBuyerModal();

      loadMyTradeRelationships();

    }, 1200);

  }
}


// ==========================================================================
// DISTRIBUTOR — RELATIONSHIP STATUS
// ==========================================================================

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


function renderRelationshipActions(
  relationshipId,
  status
) {

  const actions =
    RELATIONSHIP_ACTIONS[status];

  if (!actions) return "";


  return `

    <div
      style="
        margin-top:10px;
        display:flex;
        gap:8px;
        flex-wrap:wrap;
      "
    >

      ${actions.map(a => `

        <button
          class="btn btn-outline"
          onclick="
            updateRelationshipStatus(
              '${relationshipId}',
              '${a.newStatus}'
            )
          "
        >
          ${a.label}
        </button>

      `).join("")}

    </div>

  `;
}


async function updateRelationshipStatus(
  relationshipId,
  newStatus
) {

  const timestampFields = {

    active:
      "activated_at",

    paused:
      "paused_at",

    released:
      "released_at",

    terminated:
      "terminated_at"

  };


  const payload = {

    status:
      newStatus,

    [timestampFields[newStatus]]:
      new Date().toISOString()

  };


  if (
    newStatus === "released"
  ) {

    const reason =
      prompt(
        "Reason for releasing this relationship (required):"
      );

    if (
      !reason ||
      !reason.trim()
    ) {
      return;
    }

    payload.release_reason =
      reason.trim();
  }


  if (
    !confirm(
      `Change this relationship's status to "${newStatus}"? This cannot be casually undone.`
    )
  ) {
    return;
  }


  const {
    error
  } = await sb
    .from(
      "trade_relationships"
    )
    .update(payload)
    .eq(
      "id",
      relationshipId
    );


  if (error) {

    alert(
      "Could not update status: " +
      error.message
    );

  } else {

    loadMyTradeRelationships();

  }
}


// ==========================================================================
// DISTRIBUTOR — ASSIGN AGENT
// ==========================================================================

let assigningAgentRelationshipId =
  null;


function openAssignAgentModal(
  relationshipId
) {

  assigningAgentRelationshipId =
    relationshipId;

  document.getElementById(
    "assign-agent-search"
  ).value = "";

  document.getElementById(
    "assign-agent-results"
  ).innerHTML = "";

  document.getElementById(
    "assign-agent-status"
  ).innerText = "";

  document.getElementById(
    "assign-agent-modal"
  ).classList.add("active");
}


function closeAssignAgentModal() {

  document.getElementById(
    "assign-agent-modal"
  ).classList.remove("active");

  assigningAgentRelationshipId =
    null;
}


async function searchAgentsForAssignment() {

  const query =
    document.getElementById(
      "assign-agent-search"
    ).value.trim();

  const resultsEl =
    document.getElementById(
      "assign-agent-results"
    );


  if (query.length < 2) {

    resultsEl.innerHTML = "";

    return;
  }


  const {
    data: agents,
    error
  } = await sb
    .from("agent_profiles")
    .select(
      "id, profiles(full_name, phone)"
    )
    .limit(20);


  if (error) {

    console.error(
      "Agent search failed:",
      error.message
    );

    resultsEl.innerHTML = "";

    return;
  }


  const filtered =
    (agents || []).filter(a =>
      (
        a.profiles?.full_name || ""
      )
        .toLowerCase()
        .includes(
          query.toLowerCase()
        )
    );


  if (
    filtered.length === 0
  ) {

    resultsEl.innerHTML = `
      <div class="loading-text">
        No matching agents found.
      </div>
    `;

    return;
  }


  resultsEl.innerHTML =
    filtered.map(a => {

      const name =
        a.profiles?.full_name ||
        "Agent";

      const safeName =
        String(name)
          .replace(/\\/g, "\\\\")
          .replace(/'/g, "\\'");


      return `

        <div
          class="manifest"
          style="
            padding:12px;
            cursor:pointer;
          "
          onclick="
            assignAgentToRelationship(
              '${a.id}',
              '${safeName}'
            )
          "
        >

          <div class="m-name">
            ${name}
          </div>

          <div class="m-loc">
            ${a.profiles?.phone || ""}
          </div>

        </div>

      `;

    }).join("");
}


async function assignAgentToRelationship(
  agentId,
  agentName
) {

  const status =
    document.getElementById(
      "assign-agent-status"
    );

  status.innerText =
    `Assigning ${agentName}...`;


  // Preserve existing primary assignment
  // history.

  await sb
    .from("relationship_agents")
    .update({
      unassigned_at:
        new Date().toISOString()
    })
    .eq(
      "relationship_id",
      assigningAgentRelationshipId
    )
    .eq(
      "is_primary",
      true
    )
    .is(
      "unassigned_at",
      null
    );


  const {
    error
  } = await sb
    .from(
      "relationship_agents"
    )
    .insert({

      relationship_id:
        assigningAgentRelationshipId,

      agent_id:
        agentId,

      is_primary:
        true,

      assigned_at:
        new Date().toISOString()

    });


  if (error) {

    status.innerText =
      "Error: " + error.message;

  } else {

    status.innerText =
      `${agentName} assigned!`;

    setTimeout(() => {

      closeAssignAgentModal();

      loadMyTradeRelationships();

    }, 1200);

  }
}


// ==========================================================================
// DISTRIBUTOR — PAYMENT METHODS
// ==========================================================================

let managingPaymentMethodsRelationshipId =
  null;


function openManagePaymentMethodsModal(
  relationshipId
) {

  managingPaymentMethodsRelationshipId =
    relationshipId;

  document.getElementById(
    "new-payment-method"
  ).value = "";

  document.getElementById(
    "new-payment-method-limit"
  ).value = "";

  document.getElementById(
    "manage-payment-status"
  ).innerText = "";

  document.getElementById(
    "manage-payment-modal"
  ).classList.add("active");


  loadExistingPaymentMethodsForModal(
    relationshipId
  );
}


function closeManagePaymentMethodsModal() {

  document.getElementById(
    "manage-payment-modal"
  ).classList.remove("active");

  managingPaymentMethodsRelationshipId =
    null;
}


async function loadExistingPaymentMethodsForModal(
  relationshipId
) {

  const listEl =
    document.getElementById(
      "existing-payment-methods"
    );

  listEl.innerHTML = `
    <div class="loading-text">
      Loading...
    </div>
  `;


  const {
    data: methods
  } = await sb
    .from(
      "relationship_payment_methods"
    )
    .select(`
      id,
      payment_method,
      is_default,
      is_active,
      transaction_limit
    `)
    .eq(
      "relationship_id",
      relationshipId
    )
    .order(
      "created_at",
      { ascending: false }
    );


  if (
    !methods ||
    methods.length === 0
  ) {

    listEl.innerHTML = `
      <div class="loading-text">
        No payment methods added yet.
      </div>
    `;

    return;
  }


  listEl.innerHTML =
    methods.map(m => `

      <div
        class="manifest"
        style="padding:10px 14px;"
      >

        <div class="manifest-top">

          <div>

            <span
              style="
                font-size:13px;
                font-weight:600;
              "
            >
              ${m.payment_method}
            </span>

            ${
              m.is_default
                ? `
                  <span
                    class="stamp-badge"
                    style="
                      font-size:8px;
                      padding:2px 6px;
                      border-color:var(--ok);
                      color:var(--ok);
                      transform:none;
                      margin-left:6px;
                    "
                  >
                    DEFAULT
                  </span>
                `
                : ""
            }

            ${
              !m.is_active
                ? `
                  <span
                    class="stamp-badge"
                    style="
                      font-size:8px;
                      padding:2px 6px;
                      border-color:var(--brass);
                      color:var(--brass);
                      transform:none;
                      margin-left:6px;
                    "
                  >
                    INACTIVE
                  </span>
                `
                : ""
            }

          </div>

        </div>

        <div class="action-buttons">

          ${
            !m.is_default
              ? `
                <button
                  class="btn btn-outline"
                  onclick="
                    makePaymentMethodDefault(
                      '${m.id}'
                    )
                  "
                >
                  Make Default
                </button>
              `
              : ""
          }

          <button
            class="
              btn
              ${
                m.is_active
                  ? "btn-danger"
                  : "btn-success"
              }
            "
            onclick="
              togglePaymentMethodActive(
                '${m.id}',
                ${!m.is_active}
              )
            "
          >
            ${
              m.is_active
                ? "Deactivate"
                : "Activate"
            }
          </button>

        </div>

      </div>

    `).join("");
}


async function addPaymentMethod() {

  const status =
    document.getElementById(
      "manage-payment-status"
    );

  const methodName =
    document.getElementById(
      "new-payment-method"
    ).value.trim();

  const limitRaw =
    document.getElementById(
      "new-payment-method-limit"
    ).value;


  if (!methodName) {

    status.innerText =
      "Enter a payment method name.";

    return;
  }


  status.innerText =
    "Adding...";


  const {
    error
  } = await sb
    .from(
      "relationship_payment_methods"
    )
    .insert({

      relationship_id:
        managingPaymentMethodsRelationshipId,

      payment_method:
        methodName,

      is_active:
        true,

      is_default:
        false,

      transaction_limit:
        limitRaw !== ""
          ? parseFloat(limitRaw)
          : null

    });


  if (error) {

    status.innerText =
      "Error: " + error.message;

  } else {

    status.innerText =
      "Added!";

    document.getElementById(
      "new-payment-method"
    ).value = "";

    document.getElementById(
      "new-payment-method-limit"
    ).value = "";


    loadExistingPaymentMethodsForModal(
      managingPaymentMethodsRelationshipId
    );
  }
}


async function makePaymentMethodDefault(
  methodId
) {

  await sb
    .from(
      "relationship_payment_methods"
    )
    .update({
      is_default: false
    })
    .eq(
      "relationship_id",
      managingPaymentMethodsRelationshipId
    )
    .eq(
      "is_default",
      true
    );


  await sb
    .from(
      "relationship_payment_methods"
    )
    .update({
      is_default: true
    })
    .eq(
      "id",
      methodId
    );


  loadExistingPaymentMethodsForModal(
    managingPaymentMethodsRelationshipId
  );
}


async function togglePaymentMethodActive(
  methodId,
  newActiveState
) {

  await sb
    .from(
      "relationship_payment_methods"
    )
    .update({
      is_active:
        newActiveState
    })
    .eq(
      "id",
      methodId
    );


  loadExistingPaymentMethodsForModal(
    managingPaymentMethodsRelationshipId
  );
}


// ==========================================================================
// DISTRIBUTOR — PREFERRED PRODUCTS
// ==========================================================================

let managingPreferencesRelationshipId =
  null;


function openManagePreferredProductsModal(
  relationshipId
) {

  managingPreferencesRelationshipId =
    relationshipId;

  document.getElementById(
    "preference-product-search"
  ).value = "";

  document.getElementById(
    "preference-search-results"
  ).innerHTML = "";

  document.getElementById(
    "manage-preferences-status"
  ).innerText = "";

  document.getElementById(
    "manage-preferences-modal"
  ).classList.add("active");


  loadExistingPreferredProducts(
    relationshipId
  );
}


function closeManagePreferredProductsModal() {

  document.getElementById(
    "manage-preferences-modal"
  ).classList.remove("active");

  managingPreferencesRelationshipId =
    null;
}


async function loadExistingPreferredProducts(
  relationshipId
) {

  const listEl =
    document.getElementById(
      "existing-preferred-products"
    );

  listEl.innerHTML = `
    <div class="loading-text">
      Loading...
    </div>
  `;


  const {
    data: prefs
  } = await sb
    .from(
      "relationship_product_preferences"
    )
    .select(`
      id,
      product_id,
      negotiated_unit_price
    `)
    .eq(
      "relationship_id",
      relationshipId
    )
    .eq(
      "preferred",
      true
    );


  if (
    !prefs ||
    prefs.length === 0
  ) {

    listEl.innerHTML = `
      <div class="loading-text">
        No preferred products marked yet.
      </div>
    `;

    return;
  }


  const productIds =
    prefs.map(
      p => p.product_id
    );


  const {
    data: products
  } = await sb
    .from("products")
    .select(
      "id, name, price"
    )
    .in(
      "id",
      productIds
    );


  const productMap = {};

  (products || []).forEach(p => {
    productMap[p.id] = p;
  });


  listEl.innerHTML =
    prefs.map(pref => {

      const product =
        productMap[
          pref.product_id
        ];

      if (!product) {
        return "";
      }


      return `

        <div
          class="manifest"
          style="padding:10px 14px;"
        >

          <div class="manifest-top">

            <div>

              <span
                style="
                  font-size:13px;
                  font-weight:600;
                "
              >
                ${product.name} ★
              </span>

              <div class="m-loc">

                Public:
                ₦${(
                  product.price || 0
                ).toLocaleString()}

                ${
                  pref.negotiated_unit_price != null
                    ? `
                      · Negotiated:
                      ₦${Number(
                        pref.negotiated_unit_price
                      ).toLocaleString()}
                    `
                    : ""
                }

              </div>

            </div>

          </div>

          <div class="action-buttons">

            <button
              class="btn btn-outline"
              onclick="
                setNegotiatedPrice(
                  '${pref.id}'
                )
              "
            >
              ${
                pref.negotiated_unit_price != null
                  ? "Change"
                  : "Set"
              }
              Price
            </button>

            <button
              class="btn btn-danger"
              onclick="
                removeProductPreference(
                  '${pref.id}'
                )
              "
            >
              Remove
            </button>

          </div>

        </div>

      `;

    }).join("");
}


async function searchDistributorProductsForPreference() {

  const query =
    document.getElementById(
      "preference-product-search"
    ).value.trim();

  const resultsEl =
    document.getElementById(
      "preference-search-results"
    );


  if (query.length < 2) {

    resultsEl.innerHTML = "";

    return;
  }


  const {
    data: products,
    error
  } = await sb
    .from("products")
    .select(
      "id, name, price, sku"
    )
    .eq(
      "distributor_id",
      currentUser.id
    )
    .ilike(
      "name",
      `%${query}%`
    )
    .limit(10);


  if (error) {

    console.error(
      "Product search failed:",
      error.message
    );

    return;
  }


  if (
    !products ||
    products.length === 0
  ) {

    resultsEl.innerHTML = `
      <div class="loading-text">
        No matching products found.
      </div>
    `;

    return;
  }


  resultsEl.innerHTML =
    products.map(p => `

      <div
        class="manifest"
        style="
          padding:10px 14px;
          cursor:pointer;
        "
        onclick="
          addProductPreference(
            '${p.id}'
          )
        "
      >

        <div class="m-name">
          ${p.name}
        </div>

        <div class="m-loc">

          ${p.sku || "No SKU"}

          ·

          ₦${(
            p.price || 0
          ).toLocaleString()}

        </div>

      </div>

    `).join("");
}


async function addProductPreference(
  productId
) {

  const status =
    document.getElementById(
      "manage-preferences-status"
    );

  status.innerText =
    "Adding...";


  const {
    error
  } = await sb
    .from(
      "relationship_product_preferences"
    )
    .insert({

      relationship_id:
        managingPreferencesRelationshipId,

      product_id:
        productId,

      preferred:
        true

    });


  if (error) {

    status.innerText =
      "Error: " + error.message;

  } else {

    status.innerText =
      "Added!";

    document.getElementById(
      "preference-product-search"
    ).value = "";

    document.getElementById(
      "preference-search-results"
    ).innerHTML = "";


    loadExistingPreferredProducts(
      managingPreferencesRelationshipId
    );
  }
}


async function setNegotiatedPrice(
  prefId
) {

  const priceInput =
    prompt(
      "Enter the negotiated price for this product (₦), or leave blank to clear it:"
    );


  if (priceInput === null) {
    return;
  }


  const price =
    priceInput.trim() === ""
      ? null
      : parseFloat(
          priceInput
        );


  await sb
    .from(
      "relationship_product_preferences"
    )
    .update({
      negotiated_unit_price:
        price
    })
    .eq(
      "id",
      prefId
    );


  loadExistingPreferredProducts(
    managingPreferencesRelationshipId
  );
}


async function removeProductPreference(
  prefId
) {

  if (
    !confirm(
      "Remove this product from preferred?"
    )
  ) {
    return;
  }


  await sb
    .from(
      "relationship_product_preferences"
    )
    .delete()
    .eq(
      "id",
      prefId
    );


  loadExistingPreferredProducts(
    managingPreferencesRelationshipId
  );
}


// ==========================================================================
// END OF RELATIONSHIP.JS
// ==========================================================================
