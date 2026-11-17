// ==========================================================================
// GoodsbarnX — trust.js  (rev. 2 · Elite Trust · conversion-first)
// Plain global script. Loads tenth (Canon §10).
//
// V1.8.2.6 remediation Phase 1+2 (retained):
//   - Eight §8 signals exposed for distributor self-view.
//   - No fabricated values. Missing is named.
//   - Registered a "trust" screen loader.
//   - DOM lookups null-safe with deduplicated named warnings.
//
// Elite rebuild (rev. 2):
//   The Trust screen is not a data dump. It is the buyer's decision surface
//   for "which distributor do I establish my first relationship with?"
//
//   Architecture (five layers):
//     L1 Viewer Context    viewer role determines the one question the
//                          screen answers.
//     L2 Evidence Scoring  every distributor gets one honest composite
//                          tier derived from three real numbers:
//                          verification · activity · reliability.
//     L3 Composition       per-viewer sections: buyer sees "start with",
//                          distributor sees "your position", guest sees
//                          "how we verify". Section headings differ; the
//                          core card renderer is the same.
//     L4 Conversion        exactly one primary CTA per card:
//                          View storefront. No noise, no secondary stack.
//     L5 Evidence §29      every rendered number traceable to a schema field.
//                          Never a synthesized trust score. New
//                          distributors are honestly "New to the network".
//
// Preserved:
//   - loadTrustData(), renderTrustScreen() signatures.
//   - All DOM targets (#trust-summary, #trust-signals,
//     #verified-distributors-list, #disputes-list).
//   - Distributor self-view (8 §8 signals) unchanged.
//   - registerScreenLoader("trust", ...) unchanged.
// ==========================================================================

// --------------------------------------------------------------------------
// STATE + HELPERS
// --------------------------------------------------------------------------

let trustSummaryState = {
  distributors: [],           // [{ id, business_name, verification_tier }]
  distributorsMeta: {},       // id → { reliability, activity, trustTier }
  relationships: [],          // viewer's trade_relationships
  trustRows: [],              // viewer's relationship_trust rows
  events: [],                 // viewer's relationship_events
  disputes: [],               // public approved disputes (distributor viewers only)
  relationshipDisputes: [],   // viewer's relationship_disputes
  loading: false,
  loadedAt: null,
  error: null
};

// In-memory: viewer's relationships for the current session (buyer's view
// uses this to partition "start with" from "you already know").
const __gbxTrustViewerGraph = {
  distributorIdsWithRelationship: new Set(), // for buyer viewers: distributor IDs the buyer has a relationship with
  loaded: false
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
// L1 · VIEWER CONTEXT
// --------------------------------------------------------------------------

function trustViewerRole() {
  return (currentUser && currentUser.role) || "guest";
}

// --------------------------------------------------------------------------
// L2 · EVIDENCE SCORING
//
// One distributor → three real numbers → one honest tier.
//
//   verification  (0 | 1)     from distributor_profiles.verification_tier
//   activity      (0 .. 5)    min(5, count of relationship_events in last 30d)
//   reliability   (0..100|null) avg trust_score across that distributor's
//                             relationships, or null when no relationships
//
// Tiers (highest first):
//   ESTABLISHED — verification AND activity≥1 AND reliability≥60
//   VERIFIED    — verification only
//   ACTIVE      — activity≥1, no verification
//   LISTED      — neither
// --------------------------------------------------------------------------

const TRUST_TIER_ORDER = { ESTABLISHED: 0, VERIFIED: 1, ACTIVE: 2, LISTED: 3 };

function scoreDistributor(dist, activity, reliability) {
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
    reliability: reliability
  };
}

/**
 * Populate trustSummaryState.distributorsMeta for every distributor.
 * Requires that we have queried the platform's activity and reliability
 * aggregates. We do so in one batch (see loadTrustData step 2b) rather
 * than N+1 queries.
 */
function computeDistributorMeta(activityByDistId, reliabilityByDistId) {
  var meta = {};
  (trustSummaryState.distributors || []).forEach(function (d) {
    var activity = trustNum(activityByDistId[d.id], 0);
    var reliability = reliabilityByDistId[d.id];
    meta[d.id] = scoreDistributor(d, activity, reliability);
  });
  trustSummaryState.distributorsMeta = meta;
}

// --------------------------------------------------------------------------
// §8 SIGNAL DERIVATION — retained for distributor self-view
//
// The eight Canon §8 signals are the distributor's diagnostic surface.
// We keep them for distributors. Buyers do not need them; the buyer sees
// the composite tier instead.
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
//   2b — NEW: platform-wide activity and reliability aggregates for scoring.
// --------------------------------------------------------------------------

async function loadTrustData() {
  if (!window.sb) {
    console.warn("[GoodsbarnX/trust] Supabase unavailable; trust data not loaded.");
    return;
  }
  trustSummaryState.loading = true;
  trustSummaryState.error = null;

  try {
    // Step 1 — public view.
    const [dRes, dispRes] = await Promise.all([
      sb.from("distributor_profiles").select("id, business_name, verification_tier"),
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
    // Two batched queries. Not N+1.
    //
    // activity: count of relationship_events per distributor over the last
    //           30 days. We approximate "per distributor" by way of the
    //           distributor's relationships (a distributor's activity is
    //           the events of relationships they are party to).
    //
    // reliability: avg trust_score per distributor. Same join.
    //
    // Both are computed from a single query: relationship_trust rows where
    // the relationship belongs to a verified distributor. That table carries
    // relationship_id; we join via trade_relationships to attribute to the
    // distributor side. For V1.8.2.6 we do this in two queries and reduce
    // in JS — simple, honest, and one round trip more than optimal.
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    var activityByDistId = Object.create(null);
    var reliabilityByDistId = Object.create(null);

    try {
      // Get all relationships involving any distributor we're about to score.
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
            // Activity — events in last 30 days
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

            // Reliability — avg trust_score per distributor
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
              });
            }
          }
        }
      }
    } catch (aggErr) {
      // Non-fatal — scoring simply treats all distributors as LISTED /
      // VERIFIED (activity=0, reliability=null). The screen still renders.
      console.warn("[GoodsbarnX/trust] aggregate scoring failed (non-fatal):", aggErr && aggErr.message);
    }

    computeDistributorMeta(activityByDistId, reliabilityByDistId);

    // Populate viewer's graph (buyer's partition signal)
    __gbxTrustViewerGraph.distributorIdsWithRelationship = new Set();
    if (currentUser && currentUser.role === "buyer") {
      (trustSummaryState.relationships || []).forEach(function (r) {
        if (r.distributor_id && r.status === "active") {
          __gbxTrustViewerGraph.distributorIdsWithRelationship.add(r.distributor_id);
        }
      });
    }
    __gbxTrustViewerGraph.loaded = true;

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
// L3 · RENDER — composition per viewer
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

  // Establish trust count: distributors with tier ESTABLISHED
  const established = Object.values(trustSummaryState.distributorsMeta || {}).filter(
    m => m.tier === "ESTABLISHED"
  ).length;

  if (role === "buyer") {
    // Buyer sees: how many distributors are ready to trade (verified +
    // established), not a platform-wide roster count.
    el.innerHTML =
      '<div class="trust-item"><div class="n" style="color:var(--ok);">' + verified + '</div><div class="t">Verified</div></div>' +
      (established > 0
        ? '<div class="trust-item"><div class="n" style="color:var(--gbx-green);">' + established + '</div><div class="t">Established</div></div>'
        : "") +
      '<div class="trust-item"><div class="n">' + total + '</div><div class="t">Listed</div></div>';
    return;
  }

  if (role === "distributor") {
    // Distributor sees their own position.
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

  // Guest — platform credibility numbers only.
  el.innerHTML =
    '<div class="trust-item"><div class="n" style="color:var(--ok);">' + verified + '</div><div class="t">Verified distributors</div></div>' +
    '<div class="trust-item"><div class="n">' + total + '</div><div class="t">Total listed</div></div>';
}

function renderTrustSignals() {
  const container = document.getElementById("trust-signals");
  if (!container) { trustWarnMissing("trust-signals"); return; }

  const role = trustViewerRole();

  if (role === "distributor") {
    // Distributors get the full 8 §8 signals — their diagnostic surface.
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

  if (role === "buyer") {
    // Buyer sees "how we verify" explainer — not their own signals.
    // Their own reliability is aggregated into "you have relationships with"
    // section (in verified-distributors-list).
    container.innerHTML =
      '<div class="section-label">How we verify</div>' +
      '<div class="manifest">' +
        '<div class="m-name">Association Verified</div>' +
        '<div class="m-loc">The distributor\'s trade association has confirmed their identity and current trading status. This is the highest tier we recognise.</div>' +
      '</div>' +
      '<div class="manifest">' +
        '<div class="m-name">Market Board Verified</div>' +
        '<div class="m-loc">The distributor\'s market board has confirmed their stall and trading identity. Second-highest tier.</div>' +
      '</div>' +
      '<div class="manifest">' +
        '<div class="m-name">Self-Attested</div>' +
        '<div class="m-loc">The distributor attested their own identity. Not independently verified — treat as a starting point, not a guarantee.</div>' +
      '</div>' +
      '<div class="manifest">' +
        '<div class="m-name">Established</div>' +
        '<div class="m-loc">Verified <em>and</em> actively trading <em>and</em> reliable (trust score ≥ 60). The strongest tier in our network.</div>' +
      '</div>';
    return;
  }

  // Guest — same explainer, without the buyer-specific framing.
  container.innerHTML =
    '<div class="section-label">How verification works</div>' +
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
      '<div class="m-loc">Verified + actively trading + reliable. The strongest tier.</div>' +
    '</div>';
}

/**
 * Verified distributors — the conversion surface.
 * Buyer view: split into "start with" and "you already know", with one
 *   primary CTA per card. Empty network buyers see "start with" as the
 *   most prominent section.
 * Distributor view: split into "peers with ESTABLISHED" and "peers to
 *   emulate" — the aspirational view.
 * Guest view: single flat list, but only the top 5, to keep it scannable.
 */
function renderVerifiedDistributors() {
  const el = document.getElementById("verified-distributors-list");
  if (!el) { trustWarnMissing("verified-distributors-list"); return; }

  const role = trustViewerRole();
  const all = trustSummaryState.distributors || [];
  const meta = trustSummaryState.distributorsMeta || {};

  // Only consider distributors with a valid tier and, for buyers, those
  // not yet in the buyer's network.
  const scored = all
    .map(function (d) {
      var m = meta[d.id] || { tier: "LISTED", activity: 0, reliability: null };
      return { d: d, m: m };
    })
    .filter(function (x) { return x.m.tier !== "LISTED"; });

  // Sort by tier (ESTABLISHED > VERIFIED > ACTIVE), then reliability desc,
  // then activity desc, then name.
  scored.sort(function (a, b) {
    var ta = TRUST_TIER_ORDER[a.m.tier] != null ? TRUST_TIER_ORDER[a.m.tier] : 99;
    var tb = TRUST_TIER_ORDER[b.m.tier] != null ? TRUST_TIER_ORDER[b.m.tier] : 99;
    if (ta !== tb) return ta - tb;
    var ra = a.m.reliability != null ? a.m.reliability : -1;
    var rb = b.m.reliability != null ? b.m.reliability : -1;
    if (rb !== ra) return rb - ra;
    if (b.m.activity !== a.m.activity) return b.m.activity - a.m.activity;
    return String(a.d.business_name || "").localeCompare(String(b.d.business_name || ""));
  });

  if (role === "buyer") {
    const myNetwork = __gbxTrustViewerGraph.distributorIdsWithRelationship;
    const startWith = scored.filter(function (x) { return !myNetwork.has(x.d.id); }).slice(0, 3);
    const youKnow = scored.filter(function (x) { return myNetwork.has(x.d.id); });

    let html = "";

    if (startWith.length > 0) {
      html +=
        '<div class="section-label">Start with</div>' +
        startWith.map(function (x) { return renderTrustDistributorCard(x.d, x.m, "buyer-new"); }).join("");
    } else if (scored.length === 0) {
      html +=
        '<div class="section-label">Start with</div>' +
        '<div class="manifest">' +
          '<div class="m-name">No verified distributors yet</div>' +
          '<div class="m-loc">The network is still building. Check back or invite a distributor you trust.</div>' +
        '</div>';
    }

    if (youKnow.length > 0) {
      html +=
        '<div class="section-label">You have relationships with</div>' +
        youKnow.map(function (x) { return renderTrustDistributorCard(x.d, x.m, "buyer-known"); }).join("");
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
        established.slice(0, 5).map(function (x) { return renderTrustDistributorCard(x.d, x.m, "peer-established"); }).join("");
    }
    if (verified.length > 0) {
      html +=
        '<div class="section-label">Verified peers</div>' +
        verified.slice(0, 5).map(function (x) { return renderTrustDistributorCard(x.d, x.m, "peer-verified"); }).join("");
    }
    if (!html) {
      html = '<div class="loading-text">No established peers yet.</div>';
    }

    el.innerHTML = html;
    return;
  }

  // Guest — flat, top 5.
  if (!scored.length) {
    el.innerHTML = '<div class="loading-text">No verified distributors yet.</div>';
    return;
  }
  el.innerHTML = scored.slice(0, 5).map(function (x) {
    return renderTrustDistributorCard(x.d, x.m, "guest");
  }).join("");
}

/**
 * The card. Same DOM contract on every surface, one primary CTA.
 *
 * `context` is used only to decide whether to show the CTA at all:
 *   "buyer-new"        → CTA "View storefront"
 *   "buyer-known"      → CTA "View storefront"
 *   "peer-established" → CTA "View storefront" (distributors can view peers)
 *   "peer-verified"    → CTA "View storefront"
 *   "guest"            → CTA "View storefront" (guests are converted on the
 *                         storefront, which prompts signup on interaction)
 */
function renderTrustDistributorCard(d, meta, context) {
  var tierLabels = {
    ESTABLISHED: "Established",
    VERIFIED:    "Verified",
    ACTIVE:      "Active"
  };
  var tierColors = {
    ESTABLISHED: "var(--gbx-green)",
    VERIFIED:    "var(--ok)",
    ACTIVE:      "var(--brass)"
  };
  var tierLabel = tierLabels[meta.tier] || meta.tier;
  var tierColor = tierColors[meta.tier] || "var(--gbx-muted)";

  var detailParts = [];
  if (meta.reliability != null) {
    detailParts.push("Trust score " + meta.reliability + "/100");
  } else if (meta.tier === "VERIFIED") {
    detailParts.push("New to the network");
  }
  if (meta.activity > 0) {
    detailParts.push(meta.activity + " trade event" + (meta.activity === 1 ? "" : "s") + " in last 30 days");
  }
  var detailLine = detailParts.join(" · ");

  var safeId = trustEscAttr(d.id);

  return (
    '<div class="manifest trust-distributor-card" data-distributor-id="' + safeId + '">' +
      '<div class="manifest-top">' +
        '<div>' +
          '<div class="m-name">' + trustEscHtml(d.business_name || "Distributor") + '</div>' +
          (detailLine
            ? '<div class="m-loc">' + trustEscHtml(detailLine) + '</div>'
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

/**
 * Disputes — distributor view only. Buyers and guests do not see the
 * platform-wide disputes list. Distributors see it as peer intelligence
 * (who's had disputes, so they can calibrate their own conduct).
 */
function renderDisputesList() {
  const el = document.getElementById("disputes-list");
  if (!el) { trustWarnMissing("disputes-list"); return; }

  const role = trustViewerRole();
  if (role !== "distributor") {
    el.style.display = "none";
    el.innerHTML = "";
    // Hide the section label too, if present
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

// Bind immediately in case the trust screen is already visible on first paint
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

console.log("[GoodsbarnX] trust.js loaded (V1.8.2.6 rev.2 · Elite Trust)");
