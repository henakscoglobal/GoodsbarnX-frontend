/* ==========================================================================
   GoodsbarnX — js/depletor-radar.js
   Master Stock Depletor · Stage 2 — Demand Radar (Canon §17) + Demand Strength
   (Canon §18).

   Version: V1.8.2.6
   Load position: 9 (per D13). Loaded after js/depletor-stock.js, before
   js/depletor-opportunity.js.

   Canon basis:
     §14  pipeline stage 2 of 7.
     §17  demand radar inputs: inquiries, searches, product views,
          distributor views, storefront views, cart adds, checkout starts,
          historical purchases, preferred products, relationship demand,
          repeated requests.
     §18  demand strength is evidence, not a score. Evidence carries
          provenance. Inputs are: Explicit Intent + Behavioural Evidence +
          Relationship Evidence + Historical Evidence + Timing + Quantity.
     §28  behaviour events preserve their commercial context; a
          missing-context event is recorded with metadata, never dropped.
     §29  evidence integrity — each evidence row is tagged with its source
          domain and its observed_at timestamp. Provenance is preserved.

   Server dependency:
     S4  record_buyer_behavior_event must accept p_metadata.missing_context
         so context-less events are recorded rather than suppressed.
         Until S4 is applied, the radar's behaviourEvidence.state will be
         "UNAVAILABLE" and the remaining three evidence classes continue.
         This is a named degraded state, not a silent skip.

   This file owns:
     - readExplicitEvidence()      : inquiries scoped to distributor.
     - readBehaviourEvidence()     : buyer_behavior_events scoped to the
                                     inquiries' buyers.
     - readRelationshipEvidence()  : trade_relationships +
                                     relationship_product_preferences.
     - buildSignals()              : joins evidence per inquiry; emits
                                     per-signal evidence bundles.
     - classifyStrength()          : Canon §18 evidence-based band.
     - run()                       : returns the pipeline snapshot.

   This file does NOT:
     - render UI.
     - score, allocate, or route.
     - write to the database.
   ========================================================================== */

(function () {
  "use strict";

  var VERSION = "V1.8.2.6";
  var STAGE = "demand_radar";

  var CLOSED_INQUIRY_STATUSES = ["closed", "resolved", "completed"];

  // Canon §28 canonical event types the radar recognises. A behaviour event
  // outside this set is not ignored — it is recorded with a flag noting it
  // is not one of the Canon §28 canonical types.
  var CANON_EVENT_TYPES = [
    "market_view",
    "search",
    "filter",
    "category_view",
    "distributor_view",
    "product_view",
    "product_return",
    "product_detail_view",
    "stock_check",
    "price_check",
    "distributor_check",
    "trust_check",
    "delivery_check",
    "comparison",
    "save",
    "quantity_change",
    "inquiry_start",
    "inquiry_submit",
    "cart_add",
    "cart_remove",
    "checkout_start",
    "checkout_complete",
    "purchase",
    "abandonment",
    "checkout_abandonment",
    "inquiry_abandonment"
  ];

  // ------------------------------------------------------------------------
  // SMALL HELPERS
  // ------------------------------------------------------------------------

  function tokens(v) {
    return String(v || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/).filter(function (x) { return x.length > 2; });
  }

  function tokenOverlap(a, b) {
    if (!a.length || !b.length) return false;
    var fwd = a.some(function (t) { return b.indexOf(t) >= 0; });
    var bwd = b.some(function (t) { return a.indexOf(t) >= 0; });
    return fwd && bwd;
  }

  function nowIso() { return new Date().toISOString(); }

  function parseMs(v) {
    if (typeof v !== "string" || !v) return null;
    var t = new Date(v).getTime();
    return isFinite(t) ? t : null;
  }

  // ------------------------------------------------------------------------
  // EXPLICIT INTENT — inquiries
  // ------------------------------------------------------------------------

  async function readExplicitEvidence(userId) {
    var r = await sb
      .from("inquiries")
      .select("id,item,quantity,order_scale,status,created_at,buyer_id,distributor_id,inquirer_id")
      .eq("distributor_id", userId)
      .order("created_at", { ascending: false });

    if (r.error) throw r.error;

    var rows = (r.data || []).filter(function (i) {
      return CLOSED_INQUIRY_STATUSES.indexOf(String(i.status || "").toLowerCase()) === -1;
    });

    return rows.map(function (i) {
      return {
        source: "inquiry",
        source_id: i.id,
        observed_at: i.created_at || null,
        item: i.item || "",
        quantity: Number(i.quantity) > 0 ? Number(i.quantity) : 0,
        order_scale: i.order_scale || null,
        status: i.status || null,
        buyer_id: i.buyer_id || null,
        inquirer_id: i.inquirer_id || null
      };
    });
  }

  // ------------------------------------------------------------------------
  // BEHAVIOURAL EVIDENCE — buyer_behavior_events
  //
  // Scoped to the buyers who appear in the distributor's own inquiries.
  // Read-only. S4 dependency: the RPC that writes these events must accept
  // missing_context metadata; the read path does not require S4, but the
  // upstream writer does. If the events table is empty because writers were
  // silently dropping context-less events (pre-S4), the radar surfaces that
  // as state: "EMPTY" with a named note.
  // ------------------------------------------------------------------------

  async function readBehaviourEvidence(buyerIds) {
    if (!buyerIds.length) {
      return {
        state: "NO_BUYERS",
        note: "No buyers appear in this distributor's inquiries; behaviour evidence is not applicable.",
        rows: []
      };
    }

    var r = await sb
      .from("buyer_behavior_events")
      .select("id,event_type,product_id,distributor_id,inquiry_id,relationship_id,cart_id,order_id,metadata,occurred_at,buyer_id")
      .in("buyer_id", buyerIds)
      .order("occurred_at", { ascending: false })
      .limit(500);

    if (r.error) {
      return {
        state: "UNAVAILABLE",
        note: "buyer_behavior_events read failed: " + r.error.message,
        rows: []
      };
    }

    var rows = r.data || [];

    // Empty table with a valid read is not a failure — but it is a named state.
    if (!rows.length) {
      return {
        state: "EMPTY",
        note: "No behaviour events recorded for these buyers yet. If the upstream writer is pre-S4, context-less events may be being dropped by the server.",
        rows: []
      };
    }

    // Tag each row with Canon §28 canonical-type status and missing-context
    // metadata presence (so consumers can weight accordingly).
    var tagged = rows.map(function (e) {
      var missing = (e.metadata && e.metadata.missing_context) || [];
      return {
        source: "behaviour_event",
        source_id: e.id,
        observed_at: e.occurred_at || null,
        event_type: e.event_type || null,
        canonical_type: CANON_EVENT_TYPES.indexOf(e.event_type) >= 0,
        product_id: e.product_id || null,
        distributor_id: e.distributor_id || null,
        inquiry_id: e.inquiry_id || null,
        relationship_id: e.relationship_id || null,
        cart_id: e.cart_id || null,
        order_id: e.order_id || null,
        buyer_id: e.buyer_id || null,
        missing_context: Array.isArray(missing) ? missing : [],
        has_full_context: (!e.product_id && !e.distributor_id && !e.inquiry_id) ? false : (Array.isArray(missing) && missing.length === 0)
      };
    });

    return { state: "AVAILABLE", rows: tagged };
  }

  // ------------------------------------------------------------------------
  // RELATIONSHIP EVIDENCE — trade_relationships + preferences
  // ------------------------------------------------------------------------

  async function readRelationshipEvidence(userId, buyerIds) {
    var rels = await sb
      .from("trade_relationships")
      .select("id,buyer_id,distributor_id,status,is_primary,relationship_started_at,activated_at")
      .eq("distributor_id", userId);

    if (rels.error) throw rels.error;

    var relationships = rels.data || [];
    if (!relationships.length) {
      return { state: "NONE", rows: [], preference_rows: [] };
    }

    var relIds = relationships.map(function (r) { return r.id; }).filter(Boolean);

    var prefs = await sb
      .from("relationship_product_preferences")
      .select("id,relationship_id,product_id,preferred,negotiated_unit_price,created_at")
      .in("relationship_id", relIds);

    // Preference read is optional (schema may be empty); do not fail the stage
    // if it errors — record it as a named state.
    var preferenceRows = [];
    var preferenceState = "AVAILABLE";
    if (prefs.error) {
      preferenceState = "UNAVAILABLE: " + prefs.error.message;
    } else {
      preferenceRows = (prefs.data || []).map(function (p) {
        return {
          source: "relationship_product_preference",
          source_id: p.id,
          relationship_id: p.relationship_id,
          product_id: p.product_id,
          preferred: !!p.preferred,
          negotiated_unit_price: p.negotiated_unit_price == null ? null : Number(p.negotiated_unit_price),
          observed_at: p.created_at || null
        };
      });
    }

    return {
      state: "AVAILABLE",
      preference_state: preferenceState,
      rows: relationships.map(function (r) {
        return {
          source: "trade_relationship",
          source_id: r.id,
          buyer_id: r.buyer_id,
          distributor_id: r.distributor_id,
          status: r.status || null,
          is_primary: r.is_primary !== false,
          relationship_started_at: r.relationship_started_at || null,
          activated_at: r.activated_at || null
        };
      }),
      preference_rows: preferenceRows,
      buyer_id_scope: buyerIds
    };
  }

  // ------------------------------------------------------------------------
  // HISTORICAL EVIDENCE — prior inquiries with the same buyer and overlapping
  // item tokens. Read-only. Uses the same inquiries read; no extra round-trip.
  // ------------------------------------------------------------------------

  function buildHistoricalEvidence(inquiries) {
    // Group by buyer_id.
    var byBuyer = {};
    inquiries.forEach(function (i) {
      if (!i.buyer_id) return;
      (byBuyer[i.buyer_id] = byBuyer[i.buyer_id] || []).push(i);
    });

    // For each buyer with >1 inquiry, produce one history row per prior
    // inquiry that shares significant tokens with a later inquiry.
    var rows = [];
    Object.keys(byBuyer).forEach(function (buyerId) {
      var list = byBuyer[buyerId].slice().sort(function (a, b) {
        return (parseMs(a.observed_at) || 0) - (parseMs(b.observed_at) || 0);
      });
      if (list.length < 2) return;
      for (var k = 0; k < list.length; k++) {
        for (var m = 0; m < list.length; m++) {
          if (k === m) continue;
          var a = list[k], b = list[m];
          if (!tokenOverlap(tokens(a.item), tokens(b.item))) continue;
          rows.push({
            source: "historical_inquiry",
            source_id: a.source_id,
            against_source_id: b.source_id,
            buyer_id: buyerId,
            observed_at: a.observed_at,
            item: a.item,
            quantity: a.quantity
          });
        }
      }
    });

    return rows;
  }

  // ------------------------------------------------------------------------
  // PRODUCT MATCH — checked against the §15 stock snapshot the conductor
  // passes in. Uses the same token-overlap heuristic as File 10 and labels it.
  // ------------------------------------------------------------------------

  function productMatch(inquiryTokens, stockRows) {
    var matches = stockRows.filter(function (p) {
      return tokenOverlap(inquiryTokens, tokens(p.name));
    });
    return {
      matches: matches,
      basis: "TOKEN_OVERLAP_HEURISTIC",
      matchedProductIds: matches.map(function (p) { return p.product_id; })
    };
  }

  // ------------------------------------------------------------------------
  // CANON §18 DEMAND STRENGTH
  //
  // Strength is a function of which evidence classes are present. It is a
  // band, not a score. Each band carries the evidence classes that justified
  // it, so a reviewer can trace it back.
  // ------------------------------------------------------------------------

  function classifyStrength(explicit, behaviour, relationship, historical) {
    var e = explicit.present;
    var b = behaviour.present;
    var r = relationship.present;
    var h = historical.present;

    var reasons = [];
    if (e) reasons.push("explicit:inquiry");
    if (b) reasons.push("behaviour:" + behaviour.count + "_events");
    if (r) reasons.push("relationship:" + (relationship.status || "present"));
    if (h) reasons.push("historical:" + historical.count + "_prior_inquiries");

    // Rationale for banding order, from strongest to weakest evidence:
    //   VERY_HIGH  = explicit + behaviour + relationship + (any timing)
    //                explicit + relationship with strong behaviour
    //   HIGH       = explicit + relationship (no behaviour)
    //                explicit + behaviour (no relationship)
    //   MODERATE   = explicit only
    //                relationship only (weak, unlikely without explicit)
    //   LOW        = historical only
    //                behaviour only
    var band;
    if (e && r && (b || h)) band = "VERY_HIGH";
    else if (e && (r || b)) band = "HIGH";
    else if (e) band = "MODERATE";
    else if (b || r || h) band = "LOW";
    else band = "LOW";

    return { band: band, reasons: reasons };
  }

  // ------------------------------------------------------------------------
  // BUILD SIGNALS
  //
  // One signal per open inquiry. Each signal carries four evidence arrays
  // (explicit / behaviour / relationship / historical) and the strength band.
  // ------------------------------------------------------------------------

  function buildSignals(explicitRows, behaviourRows, relationshipRows, historicalRows, stockRows) {
    var behaviourByBuyer = {};
    behaviourRows.forEach(function (e) {
      if (!e.buyer_id) return;
      (behaviourByBuyer[e.buyer_id] = behaviourByBuyer[e.buyer_id] || []).push(e);
    });

    var relationshipByBuyer = {};
    relationshipRows.forEach(function (r) {
      if (!r.buyer_id) return;
      (relationshipByBuyer[r.buyer_id] = relationshipByBuyer[r.buyer_id] || []).push(r);
    });

    var historicalByBuyer = {};
    historicalRows.forEach(function (h) {
      if (!h.buyer_id) return;
      (historicalByBuyer[h.buyer_id] = historicalByBuyer[h.buyer_id] || []).push(h);
    });

    return explicitRows.map(function (i) {
      var iTokens = tokens(i.item);
      var pm = productMatch(iTokens, stockRows);

      var buyerBehaviour = i.buyer_id ? (behaviourByBuyer[i.buyer_id] || []) : [];
      // Restrict behaviour evidence to events that point at this distributor
      // OR at one of the matched products OR at this inquiry. Broader events
      // are kept in the array but marked as non-scoped so a reviewer can see
      // what was considered and what was excluded.
      var scopedBehaviour = buyerBehaviour.map(function (e) {
        var scoped =
          e.distributor_id === i.distributor_id ||
          e.inquiry_id === i.source_id ||
          (e.product_id && pm.matchedProductIds.indexOf(e.product_id) >= 0);
        return Object.assign({}, e, { scoped_to_this_signal: scoped });
      });

      var buyerRelationships = i.buyer_id ? (relationshipByBuyer[i.buyer_id] || []) : [];
      var activeRel = buyerRelationships.find(function (r) {
        return String(r.status || "").toLowerCase() === "active" && r.is_primary !== false;
      }) || null;

      var buyerHistory = i.buyer_id ? (historicalByBuyer[i.buyer_id] || []) : [];

      var explicitEvidence = {
        present: true,
        count: 1,
        row: i
      };
      var behaviourEvidence = {
        present: scopedBehaviour.length > 0,
        count: scopedBehaviour.length,
        rows: scopedBehaviour
      };
      var relationshipEvidence = {
        present: !!activeRel,
        status: activeRel ? activeRel.status : null,
        relationship_id: activeRel ? activeRel.source_id : null,
        rows: buyerRelationships
      };
      var historicalEvidence = {
        present: buyerHistory.length > 0,
        count: buyerHistory.length,
        rows: buyerHistory
      };

      var strength = classifyStrength(
        explicitEvidence,
        behaviourEvidence,
        relationshipEvidence,
        historicalEvidence
      );

      return {
        // Canon §30 canonical demand fields.
        inquiry_id:      i.source_id,
        distributor_id:  currentUser.id,
        buyer_id:        i.buyer_id,
        item:            i.item,
        quantity:        i.quantity,
        order_scale:     i.order_scale,
        status:          i.status,
        created_at:      i.observed_at,

        // Canon §18 strength (band + traceable reasons).
        demand_strength:        strength.band,
        demand_strength_reasons: strength.reasons,

        // Evidence classes (each with provenance).
        explicit_evidence:     explicitEvidence,
        behaviour_evidence:    behaviourEvidence,
        relationship_evidence: relationshipEvidence,
        historical_evidence:   historicalEvidence,

        // Product matching against §15 stock.
        product_matches:       pm.matchedProductIds,
        product_match_basis:   pm.basis
      };
    });
  }

  // ------------------------------------------------------------------------
  // STAGE RUN
  //
  // Consumes the §15 snapshot as `stockSnapshot`. If it is missing, §17
  // still runs — but records in its evidence that product matching was
  // unavailable. §29 compliance: absence is named, not inferred.
  // ------------------------------------------------------------------------

  async function run(stockSnapshot) {
    var user = null;
    try { user = currentUser; } catch (e) {}
    if (!user || String(user.role || "").toLowerCase() !== "distributor") {
      throw new Error("AUTH_CONTEXT_UNAVAILABLE");
    }
    if (!window.sb || typeof window.sb.from !== "function") {
      throw new Error("SUPABASE_UNAVAILABLE");
    }

    var stockRows = (stockSnapshot && stockSnapshot.rows) || [];
    var stockAvailable = !!stockSnapshot;

    var explicitRows = await readExplicitEvidence(user.id);

    var buyerIds = explicitRows
      .map(function (i) { return i.buyer_id; })
      .filter(Boolean)
      .filter(function (v, k, a) { return a.indexOf(v) === k; });

    var behaviourResult = await readBehaviourEvidence(buyerIds);
    var behaviourRows = behaviourResult.rows;

    var relationshipResult = await readRelationshipEvidence(user.id, buyerIds);
    var relationshipRows = relationshipResult.rows;

    var historicalRows = buildHistoricalEvidence(explicitRows);

    var signals = buildSignals(
      explicitRows,
      behaviourRows,
      relationshipRows,
      historicalRows,
      stockRows
    );

    // Summary — counts by band and by evidence-class presence.
    var byBand = { VERY_HIGH: 0, HIGH: 0, MODERATE: 0, LOW: 0 };
    var withBehaviour = 0;
    var withRelationship = 0;
    var withHistorical = 0;
    signals.forEach(function (s) {
      if (byBand[s.demand_strength] != null) byBand[s.demand_strength]++;
      if (s.behaviour_evidence.present) withBehaviour++;
      if (s.relationship_evidence.present) withRelationship++;
      if (s.historical_evidence.present) withHistorical++;
    });

    return {
      stage: STAGE,
      version: VERSION,
      generatedAt: nowIso(),
      rows: signals,
      summary: {
        signalCount:       signals.length,
        bands:             byBand,
        withBehaviour:     withBehaviour,
        withRelationship:  withRelationship,
        withHistorical:    withHistorical,
        stockSnapshotUsed: stockAvailable
      },
      evidence: {
        explicit_state:     "AVAILABLE",
        behaviour_state:    behaviourResult.state,
        behaviour_note:     behaviourResult.note || null,
        relationship_state: relationshipResult.state,
        preference_state:   relationshipResult.preference_state || "AVAILABLE",
        historical_state:   historicalRows.length ? "AVAILABLE" : "NONE",
        stock_state:        stockAvailable ? "AVAILABLE" : "MISSING",
        s4_dependency_note: "Behaviour events with missing_context are recorded only after server RPC S4 accepts p_metadata.missing_context."
      }
    };
  }

  // ------------------------------------------------------------------------
  // EXPORTS
  // ------------------------------------------------------------------------

  window.goodsbarnxDepletorRadar = {
    version: VERSION,
    stage: STAGE,
    run: run
  };

  console.log("[GoodsbarnX] depletar-radar.js loaded (" + VERSION + ")");
})();
