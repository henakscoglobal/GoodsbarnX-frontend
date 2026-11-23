// ==========================================================================
// GoodsbarnX — trust.js
// V1.8.2.6 · Trust Intelligence rev.4
//
// Runtime contract:
//   - Plain global script; load in the existing canonical script order.
//   - Uses existing globals: currentUser, sb, registerScreenLoader,
//     openStorefrontModal.
//   - Preserves: loadTrustData(), renderTrustScreen(), #trust-summary,
//     #trust-signals, #verified-distributors-list, #disputes-list,
//     #screen-trust, and registerScreenLoader("trust", ...).
//   - Does not create navigation, mutate trade relationships, or write data.
//
// Integrity upgrades:
//   1. Prevent stale concurrent loads from overwriting newer viewer data.
//   2. Reset viewer-scoped state before each load (including logout/account swap).
//   3. Treat null/empty numeric evidence as missing, never as zero.
//   4. Track activity and reliability query failures independently.
//   5. Never silently convert failed aggregate queries into zero evidence.
//   6. Correctly rank relationship states, including pending_consent.
//   7. Escape all database-derived text and attributes.
//   8. Restore dispute section visibility when viewer role changes.
//   9. Keep relationship mutations outside the Trust module.
// ==========================================================================

var trustSummaryState = {
  distributors: [],
  distributorsMeta: {},
  relationships: [],
  viewerRelationshipMap: {},
  viewerLookingFor: null,
  trustRows: [],
  events: [],
  disputes: [],
  relationshipDisputes: [],
  aggregateQueryFailed: false,
  aggregateStatus: { activity: "NOT_LOADED", reliability: "NOT_LOADED" },
  loading: false,
  loadedAt: null,
  error: null,
  viewerId: null,
  viewerRole: "guest"
};

var __gbxTrustWarned = Object.create(null);
var __gbxTrustLoadSequence = 0;
var __gbxTrustBoundScreens = typeof WeakSet !== "undefined" ? new WeakSet() : null;

function trustWarnMissing(id) {
  if (__gbxTrustWarned[id]) return;
  __gbxTrustWarned[id] = true;
  console.warn("[GoodsbarnX/trust] DOM target #" + id + " is missing.");
}

function trustEscHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
function trustEscAttr(value) { return trustEscHtml(value); }

function trustNum(value, fallback) {
  if (value === null || value === undefined || value === "") {
    return fallback === undefined ? null : fallback;
  }
  var n = Number(value);
  return Number.isFinite(n) ? n : (fallback === undefined ? null : fallback);
}

function trustClient() {
  return typeof window !== "undefined" && window.sb ? window.sb :
    (typeof sb !== "undefined" ? sb : null);
}

function trustUser() {
  return typeof currentUser !== "undefined" && currentUser ? currentUser : null;
}

function trustViewerRole() {
  var user = trustUser();
  return user && user.role ? String(user.role).toLowerCase() : "guest";
}

function trustSetEmptyViewerState(user) {
  trustSummaryState.relationships = [];
  trustSummaryState.trustRows = [];
  trustSummaryState.events = [];
  trustSummaryState.relationshipDisputes = [];
  trustSummaryState.viewerRelationshipMap = Object.create(null);
  trustSummaryState.viewerLookingFor = null;
  trustSummaryState.viewerId = user && user.id ? user.id : null;
  trustSummaryState.viewerRole = user && user.role ? String(user.role).toLowerCase() : "guest";
}

// --------------------------------------------------------------------------
// EVIDENCE CLASSIFICATION
// --------------------------------------------------------------------------

var TRUST_TIER_ORDER = {
  ESTABLISHED: 0,
  VERIFIED: 1,
  ACTIVE: 2,
  LISTED: 3
};

function scoreDistributor(distributor, activity, reliability, reliabilityCount, status) {
  var verificationTier = String(distributor.verification_tier || "").toLowerCase();
  var isVerified = verificationTier === "association" ||
    verificationTier === "market board";
  var hasActivity = activity !== null && activity > 0;
  var hasReliability = reliability !== null && reliabilityCount > 0;

  var tier = "LISTED";
  if (isVerified && hasActivity && hasReliability && reliability >= 60) {
    tier = "ESTABLISHED";
  } else if (isVerified) {
    tier = "VERIFIED";
  } else if (hasActivity) {
    tier = "ACTIVE";
  }

  return {
    tier: tier,
    verification: isVerified ? 1 : 0,
    activity: activity,
    reliability: reliability,
    reliabilityCount: reliabilityCount,
    activityAvailable: status.activity === "AVAILABLE",
    reliabilityAvailable: status.reliability === "AVAILABLE",
    aggregateQueryFailed: status.activity === "FAILED" || status.reliability === "FAILED"
  };
}

function computeDistributorMeta(activityById, reliabilityById, countById) {
  var meta = Object.create(null);
  var status = trustSummaryState.aggregateStatus;

  (trustSummaryState.distributors || []).forEach(function (distributor) {
    var activity = status.activity === "AVAILABLE"
      ? trustNum(activityById[distributor.id], 0) : null;
    var reliability = status.reliability === "AVAILABLE"
      ? trustNum(reliabilityById[distributor.id], null) : null;
    var count = status.reliability === "AVAILABLE"
      ? trustNum(countById[distributor.id], 0) : null;

    meta[distributor.id] = scoreDistributor(
      distributor, activity, reliability, count, status
    );
  });

  trustSummaryState.distributorsMeta = meta;
  trustSummaryState.aggregateQueryFailed =
    status.activity === "FAILED" || status.reliability === "FAILED";
}

// --------------------------------------------------------------------------
// §8 SIGNAL DERIVATION — existing distributor self-view contract
// --------------------------------------------------------------------------

function deriveTrustSignals(distributor) {
  var tierRaw = distributor && distributor.verification_tier
    ? String(distributor.verification_tier) : null;

  var signal1 = tierRaw
    ? { key: "verification_tier", label: "Verification Tier", value: tierRaw, state: "AVAILABLE", reason: null }
    : { key: "verification_tier", label: "Verification Tier", value: "Not set", state: "MISSING", reason: "distributor_profiles.verification_tier is null." };

  var signal2 = {
    key: "association_verification",
    label: "Association Verification",
    value: tierRaw === "association" ? "Yes" : "No",
    state: tierRaw ? "DERIVED" : "MISSING",
    reason: tierRaw ? "Derived from verification_tier." : "No verification_tier evidence."
  };
  var signal3 = {
    key: "market_board_verification",
    label: "Market Board Verification",
    value: tierRaw === "market board" ? "Yes" : "No",
    state: tierRaw ? "DERIVED" : "MISSING",
    reason: tierRaw ? "Derived from verification_tier." : "No verification_tier evidence."
  };
  var signal4 = {
    key: "self_attestation",
    label: "Self-Attestation",
    value: tierRaw === "self-attested" ? "Yes" : "No",
    state: tierRaw ? "DERIVED" : "MISSING",
    reason: tierRaw ? "Derived from verification_tier." : "No verification_tier evidence."
  };

  return [signal1, signal2, signal3, signal4];
}

function deriveAggregateSignals() {
  var state = trustSummaryState;
  var relationshipCount = state.relationships.length;
  var eventCount = state.events.length;

  var signal5 = relationshipCount
    ? {
        key: "relationship_history",
        label: "Relationship History",
        value: relationshipCount + " relationship" + (relationshipCount === 1 ? "" : "s") +
          " · " + eventCount + " recorded event" + (eventCount === 1 ? "" : "s"),
        state: "DERIVED",
        reason: "Visible trade_relationships and relationship_events for this account."
      }
    : {
        key: "relationship_history",
        label: "Relationship History",
        value: "No relationships yet",
        state: "MISSING",
        reason: "No trade_relationships rows are visible to this account."
      };

  var trustRows = state.trustRows;
  var tradeValue = trustRows.reduce(function (sum, row) {
    return sum + (trustNum(row.total_trade_value, 0) || 0);
  }, 0);
  var completedOrders = trustRows.reduce(function (sum, row) {
    return sum + (trustNum(row.completed_orders, 0) || 0);
  }, 0);

  var signal6 = trustRows.length
    ? {
        key: "transaction_history",
        label: "Transaction History",
        value: "₦" + tradeValue.toLocaleString() + " across " + completedOrders +
          " completed order" + (completedOrders === 1 ? "" : "s"),
        state: "DERIVED",
        reason: "Aggregated from relationship_trust rows visible to this account."
      }
    : {
        key: "transaction_history",
        label: "Transaction History",
        value: "No trade history yet",
        state: "MISSING",
        reason: "No relationship_trust rows are visible to this account."
      };

  var distributorDisputes = state.disputes.length;
  var relationshipDisputes = state.relationshipDisputes.length;
  var totalDisputes = distributorDisputes + relationshipDisputes;
  var signal7 = {
    key: "dispute_history",
    label: "Dispute History",
    value: totalDisputes
      ? totalDisputes + " dispute" + (totalDisputes === 1 ? "" : "s") +
        " · " + distributorDisputes + " distributor · " + relationshipDisputes + " relationship"
      : "No disputes recorded",
    state: "DERIVED",
    reason: "Counted from dispute records visible to this account."
  };

  var scores = trustRows.map(function (row) {
    return trustNum(row.trust_score, null);
  }).filter(function (score) { return score !== null; });

  var average = scores.length
    ? Math.round(scores.reduce(function (a, b) { return a + b; }, 0) / scores.length)
    : null;

  var signal8 = average !== null
    ? {
        key: "behavioural_reliability",
        label: "Behavioural Reliability",
        value: "Average trust score " + average + "/100 across " +
          scores.length + " relationship" + (scores.length === 1 ? "" : "s"),
        state: "DERIVED",
        reason: "Averaged from non-null relationship_trust.trust_score values."
      }
    : {
        key: "behavioural_reliability",
        label: "Behavioural Reliability",
        value: "No reliability evidence yet",
        state: "MISSING",
        reason: "No non-null relationship_trust.trust_score values are visible."
      };

  return [signal5, signal6, signal7, signal8];
}

// --------------------------------------------------------------------------
// DATA ACCESS
// --------------------------------------------------------------------------

function trustCheckResult(result, label) {
  if (result && result.error) {
    var error = new Error(label + ": " + (result.error.message || "query failed"));
    error.cause = result.error;
    throw error;
  }
  return result && result.data ? result.data : [];
}

function trustBuildRelationshipMap(rows) {
  var rank = {
    active: 7,
    pending_consent: 6,
    pending: 6,
    paused: 5,
    suspended: 4,
    released: 2,
    terminated: 1
  };
  var map = Object.create(null);

  (rows || []).forEach(function (row) {
    if (!row.distributor_id) return;
    var status = String(row.status || "").toLowerCase();
    var current = map[row.distributor_id];
    if (!current || (Object.prototype.hasOwnProperty.call(rank, status) ? rank[status] : 0) >
        (Object.prototype.hasOwnProperty.call(rank, current) ? rank[current] : 0)) {
      map[row.distributor_id] = status || "unknown";
    }
  });
  return map;
}

async function trustLoadViewerEvidence(client, user, sequence) {
  if (!user || !user.id) {
    trustSetEmptyViewerState(null);
    return;
  }

  var uid = user.id;
  var relationshipResult = await client.from("trade_relationships")
    .select("id, buyer_id, distributor_id, status, is_primary")
    .or("buyer_id.eq." + uid + ",distributor_id.eq." + uid);

  var relationships = trustCheckResult(relationshipResult, "Relationship evidence");
  if (sequence !== __gbxTrustLoadSequence) return;

  trustSummaryState.relationships = relationships;
  trustSummaryState.viewerRelationshipMap = user.role === "buyer"
    ? trustBuildRelationshipMap(relationships) : Object.create(null);

  var relationshipIds = relationships.map(function (row) { return row.id; })
    .filter(Boolean);

  if (relationshipIds.length) {
    var results = await Promise.all([
      client.from("relationship_trust")
        .select("relationship_id, trust_score, total_trade_value, completed_orders, disputed_orders")
        .in("relationship_id", relationshipIds),
      client.from("relationship_events")
        .select("id, relationship_id, event_type, created_at")
        .in("relationship_id", relationshipIds)
        .order("created_at", { ascending: false })
        .limit(500),
      client.from("relationship_disputes")
        .select("id, relationship_id, status, created_at")
        .in("relationship_id", relationshipIds)
    ]);

    if (sequence !== __gbxTrustLoadSequence) return;
    trustSummaryState.trustRows = trustCheckResult(results[0], "Relationship trust");
    trustSummaryState.events = trustCheckResult(results[1], "Relationship events");
    trustSummaryState.relationshipDisputes = trustCheckResult(results[2], "Relationship disputes");
  } else {
    trustSummaryState.trustRows = [];
    trustSummaryState.events = [];
    trustSummaryState.relationshipDisputes = [];
  }

  if (user.role === "buyer") {
    try {
      var profileResult = await client.from("buyer_profiles")
        .select("looking_for")
        .eq("id", uid)
        .maybeSingle();
      if (sequence !== __gbxTrustLoadSequence) return;
      if (!profileResult.error && profileResult.data) {
        trustSummaryState.viewerLookingFor =
          String(profileResult.data.looking_for || "").trim() || null;
      } else if (profileResult.error) {
        console.warn("[GoodsbarnX/trust] Buyer category unavailable:", profileResult.error.message);
      }
    } catch (profileError) {
      console.warn("[GoodsbarnX/trust] Buyer category unavailable:", profileError.message);
    }
  }
}

async function trustLoadPublicAggregates(client, sequence) {
  var activityById = Object.create(null);
  var reliabilityById = Object.create(null);
  var countById = Object.create(null);
  var distributorIds = trustSummaryState.distributors.map(function (row) {
    return row.id;
  }).filter(Boolean);

  trustSummaryState.aggregateStatus = {
    activity: "NOT_LOADED",
    reliability: "NOT_LOADED"
  };

  if (!distributorIds.length) {
    trustSummaryState.aggregateStatus.activity = "AVAILABLE";
    trustSummaryState.aggregateStatus.reliability = "AVAILABLE";
    computeDistributorMeta(activityById, reliabilityById, countById);
    return;
  }

  try {
    var relationshipResult = await client.from("trade_relationships")
      .select("id, distributor_id")
      .in("distributor_id", distributorIds);

    if (relationshipResult.error) throw relationshipResult.error;
    if (sequence !== __gbxTrustLoadSequence) return;

    var relationshipRows = relationshipResult.data || [];
    var relationshipToDistributor = Object.create(null);
    var relationshipIds = [];

    relationshipRows.forEach(function (row) {
      if (!row.id || !row.distributor_id) return;
      relationshipToDistributor[row.id] = row.distributor_id;
      relationshipIds.push(row.id);
    });

    if (!relationshipIds.length) {
      trustSummaryState.aggregateStatus.activity = "AVAILABLE";
      trustSummaryState.aggregateStatus.reliability = "AVAILABLE";
      computeDistributorMeta(activityById, reliabilityById, countById);
      return;
    }

    var thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    // Independent retrieval status: a failure in one evidence stream must not
    // erase successful evidence from the other stream.
    var activityPromise = client.from("relationship_events")
      .select("relationship_id, created_at")
      .in("relationship_id", relationshipIds)
      .gte("created_at", thirtyDaysAgo);

    var reliabilityPromise = client.from("relationship_trust")
      .select("relationship_id, trust_score")
      .in("relationship_id", relationshipIds);

    var aggregateResults = await Promise.all([activityPromise, reliabilityPromise]);
    if (sequence !== __gbxTrustLoadSequence) return;

    var activityResult = aggregateResults[0];
    var reliabilityResult = aggregateResults[1];

    if (activityResult.error) {
      trustSummaryState.aggregateStatus.activity = "FAILED";
      console.warn("[GoodsbarnX/trust] Activity evidence unavailable:", activityResult.error.message);
    } else {
      trustSummaryState.aggregateStatus.activity = "AVAILABLE";
      (activityResult.data || []).forEach(function (event) {
        var distributorId = relationshipToDistributor[event.relationship_id];
        if (distributorId) activityById[distributorId] = (activityById[distributorId] || 0) + 1;
      });
    }

    if (reliabilityResult.error) {
      trustSummaryState.aggregateStatus.reliability = "FAILED";
      console.warn("[GoodsbarnX/trust] Reliability evidence unavailable:", reliabilityResult.error.message);
    } else {
      trustSummaryState.aggregateStatus.reliability = "AVAILABLE";
      var scoresByDistributor = Object.create(null);

      (reliabilityResult.data || []).forEach(function (row) {
        var distributorId = relationshipToDistributor[row.relationship_id];
        var score = trustNum(row.trust_score, null);
        if (!distributorId || score === null) return;
        if (!scoresByDistributor[distributorId]) scoresByDistributor[distributorId] = [];
        scoresByDistributor[distributorId].push(score);
      });

      Object.keys(scoresByDistributor).forEach(function (distributorId) {
        var scores = scoresByDistributor[distributorId];
        reliabilityById[distributorId] = Math.round(
          scores.reduce(function (a, b) { return a + b; }, 0) / scores.length
        );
        countById[distributorId] = scores.length;
      });
    }
  } catch (error) {
    // The relationship-to-distributor map is a prerequisite for both public
    // aggregate streams, so its failure makes both streams unavailable.
    trustSummaryState.aggregateStatus.activity = "FAILED";
    trustSummaryState.aggregateStatus.reliability = "FAILED";
    console.warn("[GoodsbarnX/trust] Aggregate relationship retrieval failed:", error.message);
  }

  computeDistributorMeta(activityById, reliabilityById, countById);
}

// --------------------------------------------------------------------------
// LOAD TRUST DATA
// --------------------------------------------------------------------------

async function loadTrustData() {
  var client = trustClient();
  var user = trustUser();
  var sequence = ++__gbxTrustLoadSequence;

  if (!client) {
    var unavailable = new Error("Supabase client is unavailable.");
    trustSummaryState.error = unavailable;
    renderTrustError(unavailable);
    return;
  }

  trustSummaryState.loading = true;
  trustSummaryState.error = null;
  trustSummaryState.loadedAt = null;
  trustSummaryState.distributors = [];
  trustSummaryState.distributorsMeta = Object.create(null);
  trustSummaryState.disputes = [];
  trustSummaryState.aggregateQueryFailed = false;
  trustSummaryState.aggregateStatus = {
    activity: "NOT_LOADED",
    reliability: "NOT_LOADED"
  };
  trustSetEmptyViewerState(user);

  try {
    var publicResults = await Promise.all([
      client.from("distributor_profiles")
        .select("id, business_name, verification_tier, category"),
      client.from("disputes")
        .select("id, distributor_id, description, status, created_at")
        .eq("status", "Approved")
        .order("created_at", { ascending: false })
        .limit(10)
    ]);

    if (sequence !== __gbxTrustLoadSequence) return;

    trustSummaryState.distributors = trustCheckResult(publicResults[0], "Distributor directory");
    trustSummaryState.disputes = trustCheckResult(publicResults[1], "Approved disputes");

    await trustLoadViewerEvidence(client, user, sequence);
    if (sequence !== __gbxTrustLoadSequence) return;

    await trustLoadPublicAggregates(client, sequence);
    if (sequence !== __gbxTrustLoadSequence) return;

    trustSummaryState.loadedAt = new Date().toISOString();
    trustSummaryState.error = null;
    renderTrustScreen();
  } catch (error) {
    if (sequence !== __gbxTrustLoadSequence) return;
    trustSummaryState.error = error;
    console.error("[GoodsbarnX/trust] loadTrustData failed:", error);
    renderTrustError(error);
  } finally {
    if (sequence === __gbxTrustLoadSequence) {
      trustSummaryState.loading = false;
    }
  }
}

// --------------------------------------------------------------------------
// RENDER
// --------------------------------------------------------------------------

function renderTrustScreen() {
  renderTrustSummary();
  renderTrustSignals();
  renderVerifiedDistributors();
  renderDisputesList();
}

function trustTierLabel(tier) {
  return ({
    ESTABLISHED: "Established",
    VERIFIED: "Verified",
    ACTIVE: "Active trader",
    LISTED: "Listed"
  })[tier] || tier || "Unclassified";
}

function trustAggregateNotice() {
  var status = trustSummaryState.aggregateStatus;
  var failed = [];
  if (status.activity === "FAILED") failed.push("recent activity");
  if (status.reliability === "FAILED") failed.push("reliability");
  if (!failed.length) return "";
  return '<div class="trust-data-notice" role="status">Trust data limited: ' +
    trustEscHtml(failed.join(" and ")) +
    ' evidence could not be retrieved. Missing evidence is not a zero score.</div>';
}

function renderTrustSummary() {
  var element = document.getElementById("trust-summary");
  if (!element) { trustWarnMissing("trust-summary"); return; }

  var role = trustViewerRole();
  var distributors = trustSummaryState.distributors || [];
  var verified = distributors.filter(function (row) {
    var tier = String(row.verification_tier || "").toLowerCase();
    return tier === "association" || tier === "market board";
  }).length;
  var established = Object.keys(trustSummaryState.distributorsMeta || {}).filter(function (id) {
    return trustSummaryState.distributorsMeta[id].tier === "ESTABLISHED";
  }).length;
  var active = Object.keys(trustSummaryState.distributorsMeta || {}).filter(function (id) {
    return trustSummaryState.distributorsMeta[id].tier === "ACTIVE";
  }).length;

  if (role === "buyer") {
    element.innerHTML =
      '<div class="trust-item"><div class="n">' + verified + '</div><div class="t">Verified</div></div>' +
      '<div class="trust-item"><div class="n">' + established + '</div><div class="t">Established</div></div>' +
      '<div class="trust-item"><div class="n">' + active + '</div><div class="t">Active traders</div></div>' +
      '<div class="trust-item"><div class="n">' + distributors.length + '</div><div class="t">Listed</div></div>' +
      trustAggregateNotice();
    return;
  }

  if (role === "distributor") {
    var user = trustUser();
    var myMeta = user && trustSummaryState.distributorsMeta[user.id];
    if (!myMeta) {
      element.innerHTML =
        '<div class="trust-item"><div class="n">—</div><div class="t">Your network position</div></div>' +
        trustAggregateNotice();
      return;
    }

    var activityValue = myMeta.activityAvailable ? myMeta.activity : "—";
    var reliabilityValue = myMeta.reliabilityAvailable && myMeta.reliability !== null
      ? myMeta.reliability + "/100" : "—";

    element.innerHTML =
      '<div class="trust-item"><div class="n">' + trustEscHtml(trustTierLabel(myMeta.tier)) + '</div><div class="t">Your tier</div></div>' +
      '<div class="trust-item"><div class="n">' + trustEscHtml(activityValue) + '</div><div class="t">Activity (30d)</div></div>' +
      '<div class="trust-item"><div class="n">' + trustEscHtml(reliabilityValue) + '</div><div class="t">Reliability</div></div>' +
      trustAggregateNotice();
    return;
  }

  element.innerHTML =
    '<div class="trust-item"><div class="n">' + verified + '</div><div class="t">Verified distributors</div></div>' +
    '<div class="trust-item"><div class="n">' + distributors.length + '</div><div class="t">Total listed</div></div>' +
    trustAggregateNotice();
}

function renderTrustSignals() {
  var container = document.getElementById("trust-signals");
  if (!container) { trustWarnMissing("trust-signals"); return; }

  if (trustViewerRole() === "distributor") {
    var user = trustUser();
    var signals = deriveTrustSignals(user).concat(deriveAggregateSignals());
    var colors = {
      AVAILABLE: "var(--ok)",
      DERIVED: "var(--brass)",
      MISSING: "var(--gbx-muted)"
    };
    var labels = { AVAILABLE: "READ", DERIVED: "DERIVED", MISSING: "MISSING" };

    container.innerHTML =
      '<div class="section-label">Your trust signals (§8)</div>' +
      signals.map(function (signal) {
        var color = colors[signal.state] || "var(--gbx-muted)";
        return '<div class="manifest trust-signal" data-signal="' + trustEscAttr(signal.key) + '">' +
          '<div class="manifest-top"><div>' +
          '<div class="m-name">' + trustEscHtml(signal.label) + '</div>' +
          '<div class="m-loc">' + trustEscHtml(signal.value) + '</div>' +
          (signal.reason ? '<div class="m-loc trust-evidence-reason">' +
            trustEscHtml(signal.reason) + '</div>' : '') +
          '</div><span class="stamp-badge" style="border-color:' + color +
          ';color:' + color + ';">' + labels[signal.state] + '</span></div></div>';
      }).join("");
    return;
  }

  container.innerHTML =
    '<div class="section-label">How trust evidence is classified</div>' +
    '<div class="manifest"><div class="m-name">Association verified</div><div class="m-loc">Verification tier recorded as association.</div></div>' +
    '<div class="manifest"><div class="m-name">Market board verified</div><div class="m-loc">Verification tier recorded as market board.</div></div>' +
    '<div class="manifest"><div class="m-name">Self-attested</div><div class="m-loc">Distributor-declared status; not independent verification.</div></div>' +
    '<div class="manifest"><div class="m-name">Established</div><div class="m-loc">Verified, with recent relationship activity and an average recorded trust score of at least 60. This is an evidence classification, not a guarantee.</div></div>' +
    '<div class="manifest"><div class="m-name">Active trader</div><div class="m-loc">Recent relationship activity is visible; independent verification is not recorded.</div></div>';
}

function trustCategoryMatch(distributorCategory, lookingFor) {
  if (!distributorCategory || !lookingFor) return false;
  return String(distributorCategory).trim().toLowerCase() ===
    String(lookingFor).trim().toLowerCase();
}

function renderVerifiedDistributors() {
  var element = document.getElementById("verified-distributors-list");
  if (!element) { trustWarnMissing("verified-distributors-list"); return; }

  var role = trustViewerRole();
  var all = trustSummaryState.distributors || [];
  var meta = trustSummaryState.distributorsMeta || {};
  var lookingFor = trustSummaryState.viewerLookingFor;
  var relationshipMap = trustSummaryState.viewerRelationshipMap || {};

  var scored = all.map(function (distributor) {
    var evidence = meta[distributor.id] || {
      tier: "LISTED",
      activity: null,
      reliability: null,
      reliabilityCount: null,
      activityAvailable: false,
      reliabilityAvailable: false,
      aggregateQueryFailed: true
    };
    return { d: distributor, m: evidence };
  }).filter(function (item) {
    // Include LISTED distributors when evidence retrieval failed: do not
    // accidentally hide the directory because an aggregate query was denied.
    return item.m.tier !== "LISTED" ||
      item.m.activity > 0 ||
      item.m.aggregateQueryFailed;
  });

  scored.sort(function (a, b) {
    var tierA = TRUST_TIER_ORDER[a.m.tier] === undefined ? 99 : TRUST_TIER_ORDER[a.m.tier];
    var tierB = TRUST_TIER_ORDER[b.m.tier] === undefined ? 99 : TRUST_TIER_ORDER[b.m.tier];
    if (tierA !== tierB) return tierA - tierB;

    if (lookingFor) {
      var categoryA = trustCategoryMatch(a.d.category, lookingFor) ? 0 : 1;
      var categoryB = trustCategoryMatch(b.d.category, lookingFor) ? 0 : 1;
      if (categoryA !== categoryB) return categoryA - categoryB;
    }

    var reliabilityA = a.m.reliability === null ? -1 : a.m.reliability;
    var reliabilityB = b.m.reliability === null ? -1 : b.m.reliability;
    if (reliabilityA !== reliabilityB) return reliabilityB - reliabilityA;

    var activityA = a.m.activity === null ? -1 : a.m.activity;
    var activityB = b.m.activity === null ? -1 : b.m.activity;
    if (activityA !== activityB) return activityB - activityA;

    return String(a.d.business_name || "").localeCompare(String(b.d.business_name || ""));
  });

  if (role === "buyer") {
    var startWith = scored.filter(function (item) {
      return !relationshipMap[item.d.id] || item.m.aggregateQueryFailed;
    }).slice(0, 3);
    var known = scored.filter(function (item) {
      return !!relationshipMap[item.d.id];
    });

    var html = "";
    if (startWith.length) {
      html += '<div class="section-label">Potential trade partners</div>' +
        startWith.map(function (item) {
          return renderTrustDistributorCard(item.d, item.m, null);
        }).join("");
    } else if (!scored.length) {
      html += '<div class="section-label">Potential trade partners</div>' +
        '<div class="manifest"><div class="m-name">No distributor evidence to rank yet</div>' +
        '<div class="m-loc">The directory may be empty or the available evidence is limited.</div></div>';
    }

    if (known.length) {
      html += '<div class="section-label">Your relationship network</div>' +
        known.map(function (item) {
          return renderTrustDistributorCard(item.d, item.m, relationshipMap[item.d.id]);
        }).join("");
    }
    element.innerHTML = html;
    return;
  }

  if (role === "distributor") {
    var user = trustUser();
    var ownId = user && user.id;
    var peers = scored.filter(function (item) { return item.d.id !== ownId; });
    var established = peers.filter(function (item) { return item.m.tier === "ESTABLISHED"; });
    var verified = peers.filter(function (item) { return item.m.tier === "VERIFIED"; });
    var active = peers.filter(function (item) { return item.m.tier === "ACTIVE"; });
    var htmlPeers = "";

    if (established.length) {
      htmlPeers += '<div class="section-label">Established peers</div>' +
        established.slice(0, 5).map(function (item) {
          return renderTrustDistributorCard(item.d, item.m, null);
        }).join("");
    }
    if (verified.length) {
      htmlPeers += '<div class="section-label">Verified peers</div>' +
        verified.slice(0, 5).map(function (item) {
          return renderTrustDistributorCard(item.d, item.m, null);
        }).join("");
    }
    if (active.length) {
      htmlPeers += '<div class="section-label">Active, not yet verified</div>' +
        active.slice(0, 5).map(function (item) {
          return renderTrustDistributorCard(item.d, item.m, null);
        }).join("");
    }
    element.innerHTML = htmlPeers || '<div class="loading-text">No peer evidence is available yet.</div>';
    return;
  }

  element.innerHTML = scored.length
    ? scored.slice(0, 5).map(function (item) {
        return renderTrustDistributorCard(item.d, item.m, null);
      }).join("")
    : '<div class="loading-text">No distributor evidence is available yet.</div>';
}

function renderTrustDistributorCard(distributor, meta, relationshipState) {
  meta = meta || {};
  var tier = meta.tier || "LISTED";
  var tierColors = {
    ESTABLISHED: "var(--gbx-green)",
    VERIFIED: "var(--ok)",
    ACTIVE: "var(--brass)",
    LISTED: "var(--gbx-muted)"
  };
  var tierColor = tierColors[tier] || "var(--gbx-muted)";
  var trustLine = "";

  if (meta.reliability !== null && meta.reliability !== undefined &&
      meta.reliabilityCount > 0) {
    trustLine = "Trust " + meta.reliability + "/100 across " +
      meta.reliabilityCount + " scored relationship" +
      (meta.reliabilityCount === 1 ? "" : "s");
  } else if (meta.reliabilityAvailable === false ||
      (meta.aggregateQueryFailed && trustSummaryState.aggregateStatus.reliability === "FAILED")) {
    trustLine = "Reliability evidence unavailable";
  } else if (tier === "VERIFIED") {
    trustLine = "Verified · relationship performance not yet evidenced";
  } else if (tier === "ACTIVE") {
    trustLine = "Recent activity · not independently verified";
  } else if (tier === "LISTED") {
    trustLine = "Listed · insufficient activity evidence";
  }

  var relationshipLabels = {
    active: "Active relationship",
    pending_consent: "Awaiting buyer consent",
    pending: "Connection pending",
    paused: "Relationship paused",
    suspended: "Relationship suspended",
    released: "Relationship released",
    terminated: "Relationship terminated",
    unknown: "Relationship status unavailable"
  };
  var relationshipTone = relationshipState === "active" ? "active" :
    (relationshipState === "pending" || relationshipState === "pending_consent" ? "pending" : "inactive");
  var relationshipBadge = relationshipState
    ? '<span class="trust-rel-badge" data-tone="' + relationshipTone + '">' +
      trustEscHtml(relationshipLabels[relationshipState] || relationshipState) + '</span>'
    : "";

  var category = distributor.category
    ? '<div class="m-loc trust-category">' + trustEscHtml(distributor.category) + '</div>'
    : "";
  var safeId = trustEscAttr(distributor.id);

  return '<div class="manifest trust-distributor-card" data-distributor-id="' + safeId + '">' +
    '<div class="manifest-top"><div>' +
    '<div class="m-name">' + trustEscHtml(distributor.business_name || "Distributor") +
    relationshipBadge + '</div>' +
    (trustLine ? '<div class="m-loc">' + trustEscHtml(trustLine) + '</div>' : '') +
    category +
    '</div><span class="trust-tier-badge" style="border-color:' + tierColor +
    ';color:' + tierColor + ';">' + trustEscHtml(trustTierLabel(tier)) + '</span></div>' +
    '<div class="m-meta"><button type="button" class="btn btn-primary" ' +
    'data-trust-action="open-storefront" data-distributor-id="' + safeId + '">' +
    'View storefront</button></div></div>';
}

function renderDisputesList() {
  var element = document.getElementById("disputes-list");
  if (!element) { trustWarnMissing("disputes-list"); return; }

  var role = trustViewerRole();
  var section = element.closest ? element.closest(".trust-disputes-section") : null;

  if (role !== "distributor") {
    element.style.display = "none";
    element.innerHTML = "";
    if (section) section.style.display = "none";
    return;
  }

  element.style.display = "";
  if (section) section.style.display = "";

  var disputes = trustSummaryState.disputes || [];
  if (!disputes.length) {
    element.innerHTML = '<div class="loading-text">No approved public disputes are recorded.</div>';
    return;
  }

  var distributorNames = Object.create(null);
  trustSummaryState.distributors.forEach(function (distributor) {
    distributorNames[distributor.id] = distributor.business_name;
  });

  element.innerHTML = disputes.map(function (dispute) {
    var name = distributorNames[dispute.distributor_id] || "Distributor not identified";
    return '<div class="manifest trust-dispute-item">' +
      '<div class="manifest-top"><div>' +
      '<div class="m-name">' + trustEscHtml(name) + '</div>' +
      '<div class="m-loc">' + trustEscHtml(dispute.description || "No public details supplied.") + '</div>' +
      '</div><span class="stamp-badge">APPROVED DISPUTE</span></div></div>';
  }).join("");
}

function renderTrustError(error) {
  var message = error && error.message ? error.message : String(error || "Unknown error");
  var summary = document.getElementById("trust-summary");
  if (summary) {
    summary.innerHTML = '<div class="loading-text" role="alert">Trust data temporarily unavailable: ' +
      trustEscHtml(message) + '</div>';
  }
  var signals = document.getElementById("trust-signals");
  var distributors = document.getElementById("verified-distributors-list");
  var disputes = document.getElementById("disputes-list");
  if (signals) signals.innerHTML = "";
  if (distributors) distributors.innerHTML = "";
  if (disputes) disputes.innerHTML = "";
}

// --------------------------------------------------------------------------
// DELEGATED STOREFRONT ACTION
// --------------------------------------------------------------------------

function bindTrustEvents() {
  var screen = document.getElementById("screen-trust");
  if (!screen) return;

  if (__gbxTrustBoundScreens) {
    if (__gbxTrustBoundScreens.has(screen)) return;
    __gbxTrustBoundScreens.add(screen);
  } else {
    if (screen.__gbxTrustBound) return;
    screen.__gbxTrustBound = true;
  }

  screen.addEventListener("click", function (event) {
    var target = event.target && event.target.closest
      ? event.target.closest("[data-trust-action]") : null;
    if (!target || !screen.contains(target)) return;

    if (target.getAttribute("data-trust-action") === "open-storefront") {
      var distributorId = target.getAttribute("data-distributor-id");
      if (!distributorId) return;
      event.preventDefault();

      if (typeof openStorefrontModal === "function") {
        openStorefrontModal(distributorId);
      } else {
        console.warn("[GoodsbarnX/trust] Storefront action unavailable: openStorefrontModal is not registered.");
      }
    }
  });
}

// --------------------------------------------------------------------------
// SCREEN LOADER REGISTRATION
// --------------------------------------------------------------------------

(function registerTrustScreen() {
  if (typeof registerScreenLoader !== "function") {
    console.warn("[GoodsbarnX/trust] registerScreenLoader unavailable; Trust loader not registered.");
    return;
  }

  registerScreenLoader("trust", function trustLoader() {
    bindTrustEvents();
    return loadTrustData();
  });
})();

if (typeof window !== "undefined") {
  if (document.readyState === "complete" || document.readyState === "interactive") {
    setTimeout(bindTrustEvents, 0);
  } else {
    window.addEventListener("DOMContentLoaded", bindTrustEvents);
  }
}

if (typeof window !== "undefined") {
  window.loadTrustData = loadTrustData;
  window.renderTrustScreen = renderTrustScreen;
}

console.log("[GoodsbarnX] trust.js loaded (V1.8.2.6 rev.4 · Trust Intelligence)");
