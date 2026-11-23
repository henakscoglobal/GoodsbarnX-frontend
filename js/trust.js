// ==========================================================================
// GoodsbarnX — trust.js  (rev. 3 · elite trust surface)
// Plain global script. Loads tenth (Canon §10).
//
// V1.8.2.6 remediation Phase 1+2 (retained):
//   - Eight §8 signals exposed for distributor self-view.
//   - No fabricated values. Missing is named.
//   - Registered a "trust" screen loader.
//   - DOM lookups null-safe with deduplicated named warnings.
//
// Elite rebuild (rev. 3):
//   Release-gate analysis identified five trust-surface defects in rev. 2:
//     Gate 1 — Trust score shown without denominator (fabricated meaning)
//     Gate 2 — Existing relationships not reflected on cards (commercial risk)
//     Gate 3 — Aggregate query failure collapses every distributor to LISTED
//     Gate 4 — Buyer view is an exhibit, not an instrument
//     Gate 5 — No category-aware sort; buyer interest ignored
//     Gate 6 — New distributor with real activity but no verification tier
//              is invisible
//
//   Rev. 3 rebuilds the buyer surface around "who next" and preserves the
//   distributor diagnostic surface unchanged.
//
//   Functional additions:
//     - Trust score now carries its denominator: "78/100 (12 relationships)".
//     - Card carries relationship state: active | paused | released |
//       terminated | pending_in | none.
//     - Query failure falls back honestly: verified stays verified, no
//       fake zero, "Trust data limited" line appears.
//     - Category-aware sort uses the buyer's `buyer_profiles.looking_for`.
//     - ACTIVE tier distributors are surfaced even without verification.
//
//   Preserved:
//     - loadTrustData(), renderTrustScreen() signatures.
//     - All DOM targets (#trust-summary, #trust-signals,
//       #verified-distributors-list, #disputes-list).
//     - Distributor self-view (8 §8 signals) unchanged.
//     - registerScreenLoader("trust", ...) unchanged.
// ==========================================================================

// --------------------------------------------------------------------------
// STATE + HELPERS
// --------------------------------------------------------------------------

let trustSummaryState = {
  distributors: [],           // [{ id, business_name, verification_tier, category }]
  distributorsMeta: {},       // id → { tier, verification, activity, reliability, reliabilityCount }
  relationships: [],          // viewer's trade_relationships
  viewerRelationshipMap: {},  // distributor_id → status (buyer view only)
  viewerLookingFor: null,     // buyer's looking_for category (for sort weight)
  trustRows: [],              // viewer's relationship_trust rows
  events: [],                 // viewer's relationship_events
  disputes: [],               // public approved disputes (distributor viewers only)
  relationshipDisputes: [],   // viewer's relationship_disputes
  aggregateQueryFailed: false,
  loading: false,
  loadedAt: null,
  error: null
};

const __gbxTrustWarned = Object.create(null);
function trustWarnMissing(id) {
  if (__gbxTrustWarned[id]) return;
  __gbxTrustWarned[id] = true;
  console.warn("[GoodsbarnX/trust] DOM target #" + id + " is missing from index.html.");
}

function trustEscHtml(v) {
  return String(v == null ? "" : v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
function trustEscAttr(v) { return trustEscHtml(v); }

function trustNum(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : (fallback == null ? 0 : fallback);
}

// --------------------------------------------------------------------------
// VIEWER ROLE
// --------------------------------------------------------------------------

function trustViewerRole() {
  return (currentUser && currentUser.role) || "guest";
}

// --------------------------------------------------------------------------
// L2 · EVIDENCE SCORING
//
// One distributor → one honest tier from three real numbers.
//
//   verification       (0 | 1)   from distributor_profiles.verification_tier
//   activity           (0 .. 5)  count of relationship_events in last 30 days
//   reliability        (0..100|null) avg trust_score across relationships
//   reliabilityCount   (int)     number of relationships with a trust_score
//
// Tiers (highest first):
//   ESTABLISHED — verification AND activity≥1 AND reliability≥60
//   VERIFIED    — verification only
//   ACTIVE      — activity≥1, no verification (Gate 6 — new distributor
//                 with real trading, honestly labelled)
//   LISTED      — neither
//
// Gate 3 fallback: if the aggregate query failed, `reliabilityCount` is 0
// and `activity` is 0 for everyone. Verified distributors stay VERIFIED
// (not collapsed to LISTED). The card shows "Trust data limited" instead
// of a fake zero.
// --------------------------------------------------------------------------

const TRUST_TIER_ORDER = { ESTABLISHED: 0, VERIFIED: 1, ACTIVE: 2, LISTED: 3 };

function scoreDistributor(dist, activity, reliability, reliabilityCount) {
  var isVerified = dist.verification_tier === "association" || dist.verification_tier === "market board";
  var isEstablished = isVerified && activity >= 1 && reliability != null && reliability >= 60;

  var tier = "LISTED";
  if (isEstablished) tier = "ESTABLISHED";
  else if (isVerified) tier = "VERIFIED";
  else if (activity >= 1) tier = "ACTIVE";

  return {
    tier: tier,
    verification: isVerified ? 1 : 0,
    activity: activity,
    reliability: reliability,
    reliabilityCount: reliabilityCount
  };
}

function computeDistributorMeta(activityByDistId, reliabilityByDistId, countByDistId, aggFailed) {
  var meta = {};
  (trustSummaryState.distributors || []).forEach(function (d) {
    var activity = trustNum(activityByDistId[d.id], 0);
    var reliability = reliabilityByDistId[d.id];
    var count = trustNum(countByDistId[d.id], 0);
    meta[d.id] = scoreDistributor(d, activity, reliability, count);
    meta[d.id].aggregateQueryFailed = !!aggFailed;
  });
  trustSummaryState.distributorsMeta = meta;
}

// --------------------------------------------------------------------------
// §8 SIGNAL DERIVATION — retained verbatim for distributor self-view
// --------------------------------------------------------------------------

function deriveTrustSignals(d) {
  const tierRaw = (d && d.verification_tier) || null;
  const signal1 = tierRaw
    ? { key: "verification_tier", label: "Verification Tier", value: tierRaw, state: "AVAILABLE", reason: null }
    : { key: "verification_tier", label: "Verification Tier", value: "Not set", state: "MISSING", reason: "distributor_profiles.verification_tier is null." };

  const isAssociation = tierRaw === "association";
  const isMarketBoard = tierRaw === "market board";
  const isSelfAttested = tierRaw === "self-attested";

  const signal2 = {
    key: "association_verification",
    label: "Association Verification",
    value: isAssociation ? "Yes" : "No",
    state: tierRaw ? "DERIVED" : "MISSING",
    reason: tierRaw ? "Derived from verification_tier." : "No verification_tier evidence."
  };
  const signal3 = {
    key: "market_board_verification",
    label: "Market Board Verification",
    value: isMarketBoard ? "Yes" : "No",
    state: tierRaw ? "DERIVED" : "MISSING",
    reason: tierRaw ? "Derived from verification_tier." : "No verification_tier evidence."
  };
  const signal4 = {
    key: "self_attestation",
    label: "Self-Attestation",
    value: isSelfAttested ? "Yes" : "No",
    state: tierRaw ? "DERIVED" : "MISSING",
    reason: tierRaw ? "Derived from verification_tier." : "No verification_tier evidence."
  };

  return [signal1, signal2, signal3, signal4];
}

function deriveAggregateSignals() {
  const s = trustSummaryState;

  const relCount = s.relationships.length;
  const eventCount = s.events.length;
  const signal5 = relCount > 0
    ? {
        key: "relationship_history",
        label: "Relationship History",
        value: relCount + " relationship" + (relCount === 1 ? "" : "s") +
               " · " + eventCount + " recorded event" + (eventCount === 1 ? "" : "s"),
        state: "DERIVED",
        reason: "Counted from trade_relationships and relationship_events for the authenticated account."
      }
    : {
        key: "relationship_history",
        label: "Relationship History",
        value: "No relationships yet",
        state: "MISSING",
        reason: "No trade_relationships rows visible to this account."
      };

  const trustRows = s.trustRows;
  const totalTradeValue = trustRows.reduce((sum, r) => sum + trustNum(r.total_trade_value, 0), 0);
  const completedOrders  = trustRows.reduce((sum, r) => sum + trustNum(r.completed_orders, 0), 0);
  const signal6 = trustRows.length > 0
    ? {
        key: "transaction_history",
        label: "Transaction History",
        value: "₦" + totalTradeValue.toLocaleString() + " across " +
               completedOrders + " completed order" + (completedOrders === 1 ? "" : "s"),
        state: "DERIVED",
        reason: "Aggregated from relationship_trust for this account."
      }
    : {
        key: "transaction_history",
        label: "Transaction History",
        value: "No trade history yet",
        state: "MISSING",
        reason: "No relationship_trust rows visible to this account."
      };

  const distributorDisputes = s.disputes.length;
  const relationshipDisputes = s.relationshipDisputes.length;
  const totalDisputes = distributorDisputes + relationshipDisputes;
  const signal7 = {
    key: "dispute_history",
    label: "Dispute History",
    value: totalDisputes === 0
      ? "No disputes recorded"
      : totalDisputes + " dispute" + (totalDisputes === 1 ? "" : "s") +
        " · " + distributorDisputes + " distributor · " + relationshipDisputes + " relationship",
    state: "DERIVED",
    reason: "Counted from disputes and relationship_disputes visible to this account."
  };

  const trustScores = trustRows.map(r => trustNum(r.trust_score, null)).filter(v => v != null);
  const avgScore = trustScores.length
    ? Math.round(trustScores.reduce((a, b) => a + b, 0) / trustScores.length)
    : null;
  const signal8 = avgScore != null
    ? {
        key: "behavioural_reliability",
        label: "Behavioural Reliability",
        value: "Average trust score " + avgScore + "/100 across " +
               trustScores.length + " relationship" + (trustScores.length === 1 ? "" : "s"),
        state: "DERIVED",
        reason: "Averaged from relationship_trust.trust_score for this account."
      }
    : {
        key: "behavioural_reliability",
        label: "Behavioural Reliability",
        value: "No reliability evidence yet",
        state: "MISSING",
        reason: "No relationship_trust.trust_score rows visible to this account."
      };

  return [signal5, signal6, signal7, signal8];
}

// --------------------------------------------------------------------------
// LOAD TRUST DATA
//
// Retained steps:
//   1 — distributor directory + approved disputes (public view).
//   2 — authenticated-account-scoped relationship evidence.
//   2b — NEW: platform-wide activity and reliability aggregates.
//   2c — NEW: viewer's own relationship map (buyer-only) for card state.
//   2d — NEW: viewer's looking_for category (buyer-only) for sort weight.
// --------------------------------------------------------------------------

async function loadTrustData() {
  if (!window.sb) {
    console.warn("[GoodsbarnX/trust] Supabase unavailable; trust data not loaded.");
    return;
  }
  trustSummaryState.loading = true;
  trustSummaryState.error = null;
  trustSummaryState.aggregateQueryFailed = false;

  try {
    // Step 1 — public view.
    const [dRes, dispRes] = await Promise.all([
      sb.from("distributor_profiles").select("id, business_name, verification_tier, category"),
      sb.from("disputes").select("id, distributor_id, description, status, created_at")
        .eq("status", "Approved")
        .order("created_at", { ascending: false })
        .limit(10)
    ]);
    if (dRes.error) throw dRes.error;
    if (dispRes.error) throw dispRes.error;

    trustSummaryState.distributors = dRes.data || [];
    trustSummaryState.disputes = dispRes.data || [];

    // Step 2 — authenticated-account-scoped relationship evidence.
    let relRes = null, trustRowRes = null, evRes = null, relDispRes = null;
    if (currentUser && currentUser.id) {
      const uid = currentUser.id;

      relRes = await sb.from("trade_relationships")
        .select("id, buyer_id, distributor_id, status, is_primary")
        .or("buyer_id.eq." + uid + ",distributor_id.eq." + uid);

      if (relRes.error) throw relRes.error;
      trustSummaryState.relationships = relRes.data || [];

      const relIds = trustSummaryState.relationships.map(r => r.id).filter(Boolean);

      if (relIds.length) {
        [trustRowRes, evRes, relDispRes] = await Promise.all([
          sb.from("relationship_trust")
            .select("relationship_id, trust_score, total_trade_value, completed_orders, disputed_orders")
            .in("relationship_id", relIds),
          sb.from("relationship_events")
            .select("id, relationship_id, event_type, created_at")
            .in("relationship_id", relIds)
            .limit(500),
          sb.from("relationship_disputes")
            .select("id, relationship_id, status, created_at")
            .in("relationship_id", relIds)
        ]);

        if (trustRowRes.error) throw trustRowRes.error;
        if (evRes.error) throw evRes.error;
        if (relDispRes.error) throw relDispRes.error;

        trustSummaryState.trustRows = trustRowRes.data || [];
        trustSummaryState.events = evRes.data || [];
        trustSummaryState.relationshipDisputes = relDispRes.data || [];
      } else {
        trustSummaryState.trustRows = [];
        trustSummaryState.events = [];
        trustSummaryState.relationshipDisputes = [];
      }
    } else {
      trustSummaryState.relationships = [];
      trustSummaryState.trustRows = [];
      trustSummaryState.events = [];
      trustSummaryState.relationshipDisputes = [];
    }

    // Step 2b — platform-wide activity and reliability aggregates.
    // Two batched queries. Any failure is caught and degrades honestly:
    // verified distributors stay VERIFIED, and the card shows
    // "Trust data limited" instead of a fake zero.
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    var activityByDistId = Object.create(null);
    var reliabilityByDistId = Object.create(null);
    var countByDistId = Object.create(null);

    try {
      const distIds = trustSummaryState.distributors.map(function (d) { return d.id; }).filter(Boolean);
      if (distIds.length) {
        const relAll = await sb.from("trade_relationships")
          .select("id, distributor_id")
          .in("distributor_id", distIds);
        if (!relAll.error && Array.isArray(relAll.data)) {
          var relToDist = Object.create(null);
          relAll.data.forEach(function (r) { relToDist[r.id] = r.distributor_id; });
          var relIds = relAll.data.map(function (r) { return r.id; }).filter(Boolean);

          if (relIds.length) {
            const evAgg = await sb.from("relationship_events")
              .select("relationship_id, created_at")
              .in("relationship_id", relIds)
              .gte("created_at", thirtyDaysAgo);
            if (!evAgg.error && Array.isArray(evAgg.data)) {
              evAgg.data.forEach(function (e) {
                var distId = relToDist[e.relationship_id];
                if (!distId) return;
                activityByDistId[distId] = (activityByDistId[distId] || 0) + 1;
              });
            }

            const trustAgg = await sb.from("relationship_trust")
              .select("relationship_id, trust_score")
              .in("relationship_id", relIds);
            if (!trustAgg.error && Array.isArray(trustAgg.data)) {
              var scoresByDist = Object.create(null);
              trustAgg.data.forEach(function (t) {
                var distId = relToDist[t.relationship_id];
                if (!distId) return;
                var s = trustNum(t.trust_score, null);
                if (s == null) return;
                if (!scoresByDist[distId]) scoresByDist[distId] = [];
                scoresByDist[distId].push(s);
              });
              Object.keys(scoresByDist).forEach(function (distId) {
                var arr = scoresByDist[distId];
                var avg = arr.reduce(function (a, b) { return a + b; }, 0) / arr.length;
                reliabilityByDistId[distId] = Math.round(avg);
                countByDistId[distId] = arr.length;
              });
            }
          }
        }
      }
    } catch (aggErr) {
      console.warn("[GoodsbarnX/trust] aggregate scoring failed (non-fatal):", aggErr && aggErr.message);
      trustSummaryState.aggregateQueryFailed = true;
    }

    computeDistributorMeta(activityByDistId, reliabilityByDistId, countByDistId, trustSummaryState.aggregateQueryFailed);

    // Step 2c — viewer's own relationship map (buyer only).
    // Gate 2 fix: buyers see relationship state on the card.
    trustSummaryState.viewerRelationshipMap = Object.create(null);
    if (currentUser && currentUser.role === "buyer") {
      (trustSummaryState.relationships || []).forEach(function (r) {
        if (r.distributor_id) {
          var status = String(r.status || "").toLowerCase();
          // If multiple, keep the strongest (active > pending > paused > released > terminated)
          var rank = { active: 4, pending: 3, paused: 2, suspended: 1, released: 0, terminated: -1 };
          var cur = trustSummaryState.viewerRelationshipMap[r.distributor_id];
          if (!cur || (rank[status] || -2) > (rank[cur] || -2)) {
            trustSummaryState.viewerRelationshipMap[r.distributor_id] = status;
          }
        }
      });
    }

    // Step 2d — viewer's looking_for category (buyer only).
    trustSummaryState.viewerLookingFor = null;
    if (currentUser && currentUser.role === "buyer") {
      try {
        const lp = await sb.from("buyer_profiles")
          .select("looking_for")
          .eq("id", currentUser.id)
          .maybeSingle();
        if (!lp.error && lp.data) {
          trustSummaryState.viewerLookingFor = (lp.data.looking_for || "").trim() || null;
        }
      } catch (_) { /* non-fatal */ }
    }

    trustSummaryState.loadedAt = new Date().toISOString();
    renderTrustScreen();
  } catch (error) {
    trustSummaryState.error = error;
    console.error("[GoodsbarnX/trust] loadTrustData failed:", error);
    renderTrustError(error);
  } finally {
    trustSummaryState.loading = false;
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

function renderTrustSummary() {
  const el = document.getElementById("trust-summary");
  if (!el) { trustWarnMissing("trust-summary"); return; }

  const role = trustViewerRole();
  const total = trustSummaryState.distributors.length;
  const verified = trustSummaryState.distributors.filter(
    x => x.verification_tier === "association" || x.verification_tier === "market board"
  ).length;
  const established = Object.values(trustSummaryState.distributorsMeta || {}).filter(
    m => m.tier === "ESTABLISHED"
  ).length;

  if (role === "buyer") {
    el.innerHTML =
      '<div class="trust-item"><div class="n" style="color:var(--ok);">' + verified + '</div><div class="t">Verified</div></div>' +
      (established > 0
        ? '<div class="trust-item"><div class="n" style="color:var(--gbx-green);">' + established + '</div><div class="t">Established</div></div>'
        : "") +
      '<div class="trust-item"><div class="n">' + total + '</div><div class="t">Listed</div></div>';
    return;
  }

  if (role === "distributor") {
    const myId = currentUser && currentUser.id;
    const myMeta = myId ? trustSummaryState.distributorsMeta[myId] : null;
    if (!myMeta) {
      el.innerHTML = '<div class="trust-item"><div class="n">—</div><div class="t">Your position</div></div>';
      return;
    }
    const labels = { ESTABLISHED: "Established", VERIFIED: "Verified", ACTIVE: "Active", LISTED: "Listed" };
    const colors = { ESTABLISHED: "var(--gbx-green)", VERIFIED: "var(--ok)", ACTIVE: "var(--brass)", LISTED: "var(--gbx-muted)" };
    el.innerHTML =
      '<div class="trust-item"><div class="n" style="color:' + colors[myMeta.tier] + ';">' + labels[myMeta.tier] + '</div><div class="t">Your tier</div></div>' +
      '<div class="trust-item"><div class="n">' + myMeta.activity + '</div><div class="t">Activity (30d)</div></div>' +
      '<div class="trust-item"><div class="n">' + (myMeta.reliability != null ? myMeta.reliability : "—") + '</div><div class="t">Reliability</div></div>';
    return;
  }

  el.innerHTML =
    '<div class="trust-item"><div class="n" style="color:var(--ok);">' + verified + '</div><div class="t">Verified distributors</div></div>' +
    '<div class="trust-item"><div class="n">' + total + '</div><div class="t">Total listed</div></div>';
}

function renderTrustSignals() {
  const container = document.getElementById("trust-signals");
  if (!container) { trustWarnMissing("trust-signals"); return; }

  const role = trustViewerRole();

  if (role === "distributor") {
    const perDistributor = deriveTrustSignals(currentUser);
    const aggregates = deriveAggregateSignals();
    const all = perDistributor.concat(aggregates);

    const stateColor = (s) => s === "AVAILABLE" ? "var(--ok)"
                          : s === "DERIVED" ? "var(--brass)"
                          : "var(--gbx-muted)";
    const stateLabel = (s) => s === "AVAILABLE" ? "READ"
                          : s === "DERIVED" ? "DERIVED"
                          : "MISSING";

    container.innerHTML =
      '<div class="section-label">Your trust signals (§8)</div>' +
      all.map(signal =>
        '<div class="manifest">' +
          '<div class="manifest-top">' +
            '<div>' +
              '<div class="m-name">' + trustEscHtml(signal.label) + '</div>' +
              '<div class="m-loc">' + trustEscHtml(signal.value) + '</div>' +
              (signal.reason
                ? '<div class="m-loc" style="font-size:10.5px; opacity:.72;">' + trustEscHtml(signal.reason) + '</div>'
                : "") +
            '</div>' +
            '<span class="stamp-badge" style="border-color:' + stateColor(signal.state) + '; color:' + stateColor(signal.state) + ';">' +
              trustEscHtml(stateLabel(signal.state)) +
            '</span>' +
          '</div>' +
        '</div>'
      ).join("");
    return;
  }

  // Buyer + guest explainer
  const explainer =
    '<div class="section-label">How we verify</div>' +
    '<div class="manifest">' +
      '<div class="m-name">Association Verified</div>' +
      '<div class="m-loc">Confirmed by the distributor\'s trade association. Highest tier.</div>' +
    '</div>' +
    '<div class="manifest">' +
      '<div class="m-name">Market Board Verified</div>' +
      '<div class="m-loc">Confirmed by the distributor\'s market board.</div>' +
    '</div>' +
    '<div class="manifest">' +
      '<div class="m-name">Self-Attested</div>' +
      '<div class="m-loc">Distributor-declared identity. Unverified.</div>' +
    '</div>' +
    '<div class="manifest">' +
      '<div class="m-name">Established</div>' +
      '<div class="m-loc">Verified + actively trading + reliable (trust ≥ 60). The strongest tier.</div>' +
    '</div>';

  container.innerHTML = explainer;
}

/**
 * Verified distributors — the conversion surface.
 *
 * Buyer: split "start with" (no relationship) from "you trade with" (has
 * relationship). Sort by tier, then category match, then reliability.
 * Gate 2 fix: card carries relationship state.
 * Gate 5 fix: category-aware sort.
 * Gate 6 fix: ACTIVE-tier distributors surfaced honestly.
 *
 * Distributor: peers with ESTABLISHED / VERIFIED.
 * Guest: top 5 flat.
 */
function renderVerifiedDistributors() {
  const el = document.getElementById("verified-distributors-list");
  if (!el) { trustWarnMissing("verified-distributors-list"); return; }

  const role = trustViewerRole();
  const all = trustSummaryState.distributors || [];
  const meta = trustSummaryState.distributorsMeta || {};
  const lookingFor = trustSummaryState.viewerLookingFor;
  const relMap = trustSummaryState.viewerRelationshipMap || {};

  const scored = all
    .map(function (d) {
      var m = meta[d.id] || { tier: "LISTED", activity: 0, reliability: null, reliabilityCount: 0 };
      return { d: d, m: m };
    })
    .filter(function (x) { return x.m.tier !== "LISTED" || x.m.activity > 0; });

  // Sort by: tier rank, then category match (buyer only), then reliability,
  // then activity, then name.
  scored.sort(function (a, b) {
    var ta = TRUST_TIER_ORDER[a.m.tier] != null ? TRUST_TIER_ORDER[a.m.tier] : 99;
    var tb = TRUST_TIER_ORDER[b.m.tier] != null ? TRUST_TIER_ORDER[b.m.tier] : 99;
    if (ta !== tb) return ta - tb;

    if (lookingFor) {
      var ca = (a.d.category || "").trim() === lookingFor ? 0 : 1;
      var cb = (b.d.category || "").trim() === lookingFor ? 0 : 1;
      if (ca !== cb) return ca - cb;
    }

    var ra = a.m.reliability != null ? a.m.reliability : -1;
    var rb = b.m.reliability != null ? b.m.reliability : -1;
    if (rb !== ra) return rb - ra;
    if (b.m.activity !== a.m.activity) return b.m.activity - a.m.activity;
    return String(a.d.business_name || "").localeCompare(String(b.d.business_name || ""));
  });

  if (role === "buyer") {
    const startWith = scored.filter(function (x) { return !relMap[x.d.id]; }).slice(0, 3);
    const youKnow   = scored.filter(function (x) { return !!relMap[x.d.id]; });

    let html = "";

    if (startWith.length > 0) {
      html +=
        '<div class="section-label">Start with</div>' +
        startWith.map(function (x) {
          return renderTrustDistributorCard(x.d, x.m, null);
        }).join("");
    } else if (scored.length === 0) {
      html +=
        '<div class="section-label">Start with</div>' +
        '<div class="manifest">' +
          '<div class="m-name">No distributors match your criteria yet</div>' +
          '<div class="m-loc">The network is growing. Check back or adjust your looking-for category in Profile.</div>' +
        '</div>';
    }

    if (youKnow.length > 0) {
      html +=
        '<div class="section-label">You trade with</div>' +
        youKnow.map(function (x) {
          return renderTrustDistributorCard(x.d, x.m, relMap[x.d.id]);
        }).join("");
    }

    el.innerHTML = html;
    return;
  }

  if (role === "distributor") {
    const myId = currentUser && currentUser.id;
    const established = scored.filter(function (x) { return x.m.tier === "ESTABLISHED" && x.d.id !== myId; });
    const verified   = scored.filter(function (x) { return x.m.tier === "VERIFIED"   && x.d.id !== myId; });

    let html = "";
    if (established.length > 0) {
      html +=
        '<div class="section-label">Established peers</div>' +
        established.slice(0, 5).map(function (x) { return renderTrustDistributorCard(x.d, x.m, null); }).join("");
    }
    if (verified.length > 0) {
      html +=
        '<div class="section-label">Verified peers</div>' +
        verified.slice(0, 5).map(function (x) { return renderTrustDistributorCard(x.d, x.m, null); }).join("");
    }
    if (!html) html = '<div class="loading-text">No established peers yet.</div>';

    el.innerHTML = html;
    return;
  }

  // Guest
  if (!scored.length) {
    el.innerHTML = '<div class="loading-text">No verified distributors yet.</div>';
    return;
  }
  el.innerHTML = scored.slice(0, 5).map(function (x) {
    return renderTrustDistributorCard(x.d, x.m, null);
  }).join("");
}

/**
 * Distributor card.
 * Gate 1 fix: trust score carries its denominator.
 * Gate 2 fix: relationship state is displayed honestly.
 * Gate 3 fix: aggregate failure is named, not hidden.
 * Gate 6 fix: ACTIVE tier is shown with honest "not verified" label.
 *
 * `relationshipState` param:
 *   "active" | "paused" | "released" | "terminated" | "pending" | null (none)
 */
function renderTrustDistributorCard(d, meta, relationshipState) {
  var tierLabels = {
    ESTABLISHED: "Established",
    VERIFIED:    "Verified",
    ACTIVE:      "Active trader",
    LISTED:      "Listed"
  };
  var tierColors = {
    ESTABLISHED: "var(--gbx-green)",
    VERIFIED:    "var(--ok)",
    ACTIVE:      "var(--brass)",
    LISTED:      "var(--gbx-muted)"
  };
  var tierLabel = tierLabels[meta.tier] || meta.tier;
  var tierColor = tierColors[meta.tier] || "var(--gbx-muted)";

  // Trust score line — carries its denominator (Gate 1)
  var trustLine = "";
  if (meta.reliability != null && meta.reliabilityCount > 0) {
    trustLine = "Trust " + meta.reliability + "/100 across " +
      meta.reliabilityCount + " relationship" + (meta.reliabilityCount === 1 ? "" : "s");
  } else if (meta.aggregateQueryFailed) {
    trustLine = "Trust data limited";
  } else if (meta.tier === "VERIFIED") {
    trustLine = "Verified · new to the network";
  } else if (meta.tier === "ACTIVE") {
    trustLine = "Trading · not yet verified";
  }

  // Relationship state badge (Gate 2)
  var relBadge = "";
  if (relationshipState) {
    var relLabel = relationshipState === "active" ? "You trade with them"
                 : relationshipState === "pending" ? "Connection pending"
                 : relationshipState === "paused" ? "Relationship paused"
                 : relationshipState === "released" ? "Released — rekindle"
                 : relationshipState === "terminated" ? "Terminated"
                 : null;
    var relTone = relationshipState === "active" ? "active"
                : relationshipState === "pending" ? "pending"
                : "inactive";
    if (relLabel) {
      relBadge = '<span class="trust-rel-badge" data-tone="' + relTone + '">' +
        trustEscHtml(relLabel) + '</span>';
    }
  }

  // Category line
  var categoryLine = d.category ? " · " + d.category : "";

  var safeId = trustEscAttr(d.id);

  return (
    '<div class="manifest trust-distributor-card" data-distributor-id="' + safeId + '">' +
      '<div class="manifest-top">' +
        '<div>' +
          '<div class="m-name">' + trustEscHtml(d.business_name || "Distributor") + relBadge + '</div>' +
          (trustLine
            ? '<div class="m-loc">' + trustEscHtml(trustLine) + '</div>'
            : "") +
          (categoryLine
            ? '<div class="m-loc" style="font-size:10.5px; opacity:.72;">' + trustEscHtml(categoryLine.slice(3)) + '</div>'
            : "") +
        '</div>' +
        '<span class="trust-tier-badge" style="border-color:' + tierColor + '; color:' + tierColor + ';">' +
          trustEscHtml(tierLabel) +
        '</span>' +
      '</div>' +
      '<div class="m-meta">' +
        '<button class="btn btn-primary" data-trust-action="open-storefront" data-distributor-id="' + safeId + '">' +
          'View storefront' +
        '</button>' +
      '</div>' +
    '</div>'
  );
}

function renderDisputesList() {
  const el = document.getElementById("disputes-list");
  if (!el) { trustWarnMissing("disputes-list"); return; }

  const role = trustViewerRole();
  if (role !== "distributor") {
    el.style.display = "none";
    el.innerHTML = "";
    var labels = document.querySelectorAll("#screen-trust .section-label");
    labels.forEach(function (l) {
      if (l.textContent && /dispute/i.test(l.textContent)) l.style.display = "none";
    });
    return;
  }
  el.style.display = "";

  const disp = trustSummaryState.disputes || [];
  if (!disp.length) {
    el.innerHTML = '<div class="loading-text">No approved disputes on the network.</div>';
    return;
  }

  const distributorMap = {};
  trustSummaryState.distributors.forEach(function (d) { distributorMap[d.id] = d.business_name; });

  el.innerHTML = disp.map(function (x) {
    var name = distributorMap[x.distributor_id] || "Unknown distributor";
    return '<div class="manifest">' +
      '<div class="manifest-top">' +
        '<div>' +
          '<div class="m-name">' + trustEscHtml(name) + '</div>' +
          '<div class="m-loc">' + trustEscHtml(x.description || "No details") + '</div>' +
        '</div>' +
        '<span style="color:var(--stamp); font-size:10px;">DISPUTE</span>' +
      '</div>' +
    '</div>';
  }).join("");
}

function renderTrustError(error) {
  const el = document.getElementById("trust-summary");
  if (el) {
    el.innerHTML = '<div class="loading-text" style="color:var(--stamp);">' +
      'Trust data temporarily unavailable: ' + trustEscHtml(error.message || String(error)) +
      '</div>';
  }
  const signalsEl = document.getElementById("trust-signals");
  if (signalsEl) signalsEl.innerHTML = "";
  const verifiedEl = document.getElementById("verified-distributors-list");
  if (verifiedEl) verifiedEl.innerHTML = "";
  const disputesEl = document.getElementById("disputes-list");
  if (disputesEl) disputesEl.innerHTML = "";
}

// --------------------------------------------------------------------------
// L4 · CONVERSION — delegated click handler for "View storefront"
// --------------------------------------------------------------------------

function bindTrustEvents() {
  var screen = document.getElementById("screen-trust");
  if (!screen) return;
  if (screen.__trustBound) return;
  screen.__trustBound = true;

  screen.addEventListener("click", function (e) {
    var t = e.target.closest("[data-trust-action]");
    if (!t) return;
    if (t.getAttribute("data-trust-action") === "open-storefront") {
      var distId = t.getAttribute("data-distributor-id");
      if (!distId) return;
      e.preventDefault();
      if (typeof openStorefrontModal === "function") {
        openStorefrontModal(distId);
      }
    }
  });
}

// --------------------------------------------------------------------------
// SCREEN LOADER REGISTRATION (Phase 2.3)
// --------------------------------------------------------------------------

(function registerTrustScreen() {
  if (typeof registerScreenLoader !== "function") {
    console.warn("[GoodsbarnX/trust] registerScreenLoader unavailable; trust screen has no loader.");
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

// --------------------------------------------------------------------------
// GLOBAL EXPORTS
// --------------------------------------------------------------------------

window.loadTrustData = loadTrustData;

console.log("[GoodsbarnX] trust.js loaded (V1.8.2.6 rev.3 · elite trust surface)");
