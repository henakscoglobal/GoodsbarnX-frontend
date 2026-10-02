// ==========================================================================
// GoodsbarnX — trust.js  (rev. 1)
// Trust & Transparency screen: eight §8 signals, verified distributors,
// approved disputes.
// Plain global script. Loads tenth (Canon §10).
//
// V1.8.2.6 remediation Phase 1+2 (this file was deferred and returns here in
// Phase 5 rev. 1):
//   - Expanded from 2 of 8 §8 signals to 8 of 8.
//   - Every signal carries a named state: AVAILABLE | MISSING | DERIVED.
//   - No fabricated values. Missing is named.
//   - Registered a "trust" screen loader.
//   - DOM lookups null-safe with deduplicated named warnings.
//   - Escaping on every interpolated value.
//
// Canon §8 trust signals:
//   1. Verification Tier
//   2. Association Verification
//   3. Market Board Verification
//   4. Self-Attestation
//   5. Relationship History
//   6. Transaction History
//   7. Dispute History
//   8. Behavioural Reliability
// ==========================================================================

// --------------------------------------------------------------------------
// STATE + HELPERS
// --------------------------------------------------------------------------

let trustSummaryState = {
  distributors: [],
  relationships: [],
  trustRows: [],
  events: [],
  disputes: [],
  relationshipDisputes: [],
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
// §8 SIGNAL DERIVATION
//
// Each signal returns an object of shape:
//   { key, label, value, state, reason }
// where state is one of:
//   "AVAILABLE" — the signal was read from the schema and has a value
//   "DERIVED"   — the signal is computed from other evidence
//   "MISSING"   — the signal cannot be derived from the payload schema
//
// The label always names the Canon §8 signal. The value is text, never a
// fabricated number. reason explains a MISSING or DERIVED state.
// --------------------------------------------------------------------------

function deriveTrustSignals(d) {
  // Signal 1 — Verification Tier (from distributor_profiles).
  const tierRaw = (d && d.verification_tier) || null;
  const signal1 = tierRaw
    ? { key: "verification_tier", label: "Verification Tier", value: tierRaw, state: "AVAILABLE", reason: null }
    : { key: "verification_tier", label: "Verification Tier", value: "Not set", state: "MISSING", reason: "distributor_profiles.verification_tier is null." };

  // Signals 2 / 3 / 4 — Association / Market Board / Self-Attestation are
  // derived from the tier value. They are not separate columns.
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

  // Signals 5 / 6 / 7 / 8 — the aggregate signals for a single distributor
  // are held at screen-level (they are computed from the trust row map and
  // disputes map). We return them with a deferred state here so the caller
  // can fill them in with the screen-level aggregates.
  return [signal1, signal2, signal3, signal4];
}

function deriveAggregateSignals() {
  const s = trustSummaryState;

  // Signal 5 — Relationship History (count of trade_relationships + events).
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

  // Signal 6 — Transaction History (aggregated from relationship_trust).
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

  // Signal 7 — Dispute History.
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

  // Signal 8 — Behavioural Reliability (aggregated from trust_score).
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
// --------------------------------------------------------------------------

async function loadTrustData() {
  if (!window.sb) {
    console.warn("[GoodsbarnX/trust] Supabase unavailable; trust data not loaded.");
    return;
  }
  trustSummaryState.loading = true;
  trustSummaryState.error = null;

  try {
    // Step 1 — distributor directory + approved disputes (public view).
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

  const total = trustSummaryState.distributors.length;
  const verified = trustSummaryState.distributors.filter(
    x => x.verification_tier === "association" || x.verification_tier === "market board"
  ).length;
  const selfAttested = trustSummaryState.distributors.filter(
    x => x.verification_tier === "self-attested"
  ).length;
  const unset = total - verified - selfAttested;

  el.innerHTML =
    '<div class="trust-item"><div class="n">' + total + '</div><div class="t">Total</div></div>' +
    '<div class="trust-item"><div class="n" style="color:var(--ok);">' + verified + '</div><div class="t">Verified</div></div>' +
    '<div class="trust-item"><div class="n" style="color:var(--brass-dark);">' + selfAttested + '</div><div class="t">Self-Attested</div></div>' +
    (unset > 0
      ? '<div class="trust-item"><div class="n" style="color:var(--gbx-muted);">' + unset + '</div><div class="t">Unset</div></div>'
      : "");
}

function renderTrustSignals() {
  const container = document.getElementById("trust-signals");
  if (!container) {
    trustWarnMissing("trust-signals");
    return;
  }

  const perDistributor = currentUser && currentUser.role === "distributor"
    ? deriveTrustSignals(currentUser)
    : [];
  const aggregates = deriveAggregateSignals();
  const all = perDistributor.concat(aggregates);

  const stateColor = (s) => s === "AVAILABLE" ? "var(--ok)"
                        : s === "DERIVED" ? "var(--brass)"
                        : "var(--gbx-muted)";
  const stateLabel = (s) => s === "AVAILABLE" ? "READ"
                        : s === "DERIVED" ? "DERIVED"
                        : "MISSING";

  container.innerHTML =
    '<div class="section-label">Trust Signals (§8)</div>' +
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
}

function renderVerifiedDistributors() {
  const el = document.getElementById("verified-distributors-list");
  if (!el) { trustWarnMissing("verified-distributors-list"); return; }

  const verified = trustSummaryState.distributors.filter(
    x => x.verification_tier === "association" || x.verification_tier === "market board"
  );

  if (!verified.length) {
    el.innerHTML = '<div class="loading-text">None yet.</div>';
    return;
  }

  el.innerHTML = verified.map(x => {
    const tierLabel = x.verification_tier === "association"
      ? "Association Verified"
      : x.verification_tier === "market board"
        ? "Market Board Verified"
        : "Verified";
    return '<div class="manifest">' +
      '<div class="manifest-top">' +
        '<div>' +
          '<div class="m-name">' + trustEscHtml(x.business_name || "Distributor") + '</div>' +
          '<div class="m-loc">' + trustEscHtml(tierLabel) + '</div>' +
        '</div>' +
        '<span style="color:var(--ok);">✓</span>' +
      '</div>' +
    '</div>';
  }).join("");
}

function renderDisputesList() {
  const el = document.getElementById("disputes-list");
  if (!el) { trustWarnMissing("disputes-list"); return; }

  const disp = trustSummaryState.disputes || [];
  if (!disp.length) {
    el.innerHTML = '<div class="loading-text">No approved disputes.</div>';
    return;
  }

  const distributorMap = {};
  trustSummaryState.distributors.forEach(d => { distributorMap[d.id] = d.business_name; });

  el.innerHTML = disp.map(x => {
    const name = distributorMap[x.distributor_id] || "Unknown distributor";
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
// SCREEN LOADER REGISTRATION (Phase 2.3)
// --------------------------------------------------------------------------

(function registerTrustScreen() {
  if (typeof registerScreenLoader !== "function") {
    console.warn("[GoodsbarnX/trust] registerScreenLoader unavailable; trust screen has no loader.");
    return;
  }
  registerScreenLoader("trust", function trustLoader() {
    return loadTrustData();
  });
})();

// --------------------------------------------------------------------------
// GLOBAL EXPORTS
// --------------------------------------------------------------------------

window.loadTrustData = loadTrustData;

console.log("[GoodsbarnX] trust.js loaded (V1.8.2.6 rev.1)");
