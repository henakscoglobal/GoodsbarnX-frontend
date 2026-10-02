/* ==========================================================================
   GoodsbarnX — js/depletor-allocation.js  (rev. 1)
   Master Stock Depletor · Stage 4 — Allocation / Matching (Canon §22).

   Version: V1.8.2.6
   Load position: 11 (per D13). Loads after js/depletor-opportunity.js,
   before js/depletor-depletion.js.

   rev. 1 — dead-code remediation:
     The original delivery introduced two functions
     (computeNextAction and computeNextActionWithContext) where one was
     needed. rev. 1 collapses them to a single computeNextAction that
     takes (opportunity, constraints, context) explicitly. No behaviour
     change. No other file is affected.

   Canon basis:
     §14  pipeline stage 4 of 7.
     §21  transitions ROUTING-READY → ALLOCATED. Never transitions to
          IN-MOTION or DEPLETED (those are §24).
     §22  allocation inputs: product compatibility, quantity compatibility,
          stock availability, buyer demand, distributor ownership,
          relationship availability, location, delivery capability, MOQ,
          price, trade terms, urgency, historical relationship.
     §23  allocation principle: not "who wants this product" but "which
          available stock can be moved through which relationship to
          satisfy which demonstrated demand with the least friction and
          highest depletion value".
     §29  evidence integrity.
     §30  canonical object fields: commercial_fit, depletion_priority,
          next_action now populated.
     §31  pricing hierarchy: negotiated → relationship discount → public
          → negotiable.

   This file does NOT:
     - render UI.
     - write to the database.
     - observe depletion (§24) or produce replenishment (§26).
   ========================================================================== */

(function () {
  "use strict";

  var VERSION = "V1.8.2.6";
  var STAGE = "allocation";

  var STATE_ROUTING_READY = "ROUTING-READY";
  var STATE_ALLOCATED     = "ALLOCATED";

  // Canon §23 — allocation action names. Chosen deterministically from
  // evidence; not a heuristic score. Downstream stages read them as enums.
  var ACTION_CONTACT_BUYER          = "CONTACT_BUYER";
  var ACTION_RESOLVE_MOQ_SHORTFALL   = "RESOLVE_MOQ_SHORTFALL";
  var ACTION_VERIFY_PRICE           = "VERIFY_PRICE";
  var ACTION_CLARIFY_QUANTITY       = "CLARIFY_QUANTITY";
  var ACTION_REPLENISH_STOCK        = "REPLENISH_STOCK";
  var ACTION_ESTABLISH_RELATIONSHIP = "ESTABLISH_RELATIONSHIP";
  var ACTION_ATTRIBUTE_BUYER        = "ATTRIBUTE_BUYER";
  var ACTION_NONE                   = "NONE";

  // ------------------------------------------------------------------------
  // SMALL HELPERS
  // ------------------------------------------------------------------------

  function nowIso() { return new Date().toISOString(); }
  function num(v, fallback) {
    var n = Number(v);
    return isFinite(n) ? n : (fallback == null ? 0 : fallback);
  }
  function lower(v) { return String(v == null ? "" : v).toLowerCase(); }

  // ------------------------------------------------------------------------
  // COMMERCIAL CONTEXT READ
  // ------------------------------------------------------------------------

  async function readCommercialContext(userId, opportunities) {
    if (!window.sb || typeof window.sb.from !== "function") {
      throw new Error("SUPABASE_UNAVAILABLE");
    }

    var relationshipIds = [];
    var productIds = [];
    opportunities.forEach(function (o) {
      if (o.relationship_id) relationshipIds.push(o.relationship_id);
      if (o.product_id) productIds.push(o.product_id);
    });
    relationshipIds = relationshipIds.filter(function (v, k, a) { return a.indexOf(v) === k; });
    productIds = productIds.filter(function (v, k, a) { return a.indexOf(v) === k; });

    // Relationship trade terms — Canon §31.
    var termsResult = { rows: [], state: "NONE" };
    if (relationshipIds.length) {
      var t = await sb
        .from("relationship_trade_terms")
        .select("id,relationship_id,effective_from,default_discount_percent,credit_enabled,credit_limit,credit_days");
      if (t.error) {
        termsResult.state = "UNAVAILABLE: " + t.error.message;
      } else {
        termsResult.rows = (t.data || []).filter(function (r) {
          return relationshipIds.indexOf(r.relationship_id) !== -1;
        });
        termsResult.state = termsResult.rows.length ? "AVAILABLE" : "NONE";
      }
    }

    // Relationship product preferences — Canon §31 per-product tier.
    var prefsResult = { rows: [], state: "NONE" };
    if (relationshipIds.length) {
      var p = await sb
        .from("relationship_product_preferences")
        .select("id,relationship_id,product_id,preferred,negotiated_unit_price");
      if (p.error) {
        prefsResult.state = "UNAVAILABLE: " + p.error.message;
      } else {
        prefsResult.rows = (p.data || []).filter(function (r) {
          return relationshipIds.indexOf(r.relationship_id) !== -1 &&
                 productIds.indexOf(r.product_id) !== -1;
        });
        prefsResult.state = prefsResult.rows.length ? "AVAILABLE" : "NONE";
      }
    }

    // Products — MOQ, trade terms, delivery, pickup, lead time, negotiable,
    // bulk_discount. Price is also read here so commercial fit can resolve
    // public tier without a second round-trip.
    var productTermsResult = { byId: {}, state: "NONE" };
    if (productIds.length) {
      var pr = await sb
        .from("products")
        .select("id,price,moq,lead_time,trade_terms,delivery_available,pickup_available,negotiable,bulk_discount")
        .in("id", productIds);
      if (pr.error) {
        productTermsResult.state = "UNAVAILABLE: " + pr.error.message;
      } else {
        (pr.data || []).forEach(function (r) { productTermsResult.byId[r.id] = r; });
        productTermsResult.state = Object.keys(productTermsResult.byId).length ? "AVAILABLE" : "NONE";
      }
    }

    // Accepted agents — Canon §20's "who can move it".
    var agentsResult = { rows: [], state: "NONE" };
    var a = await sb
      .from("agent_distributor_attachments")
      .select("id,agent_id,status")
      .eq("distributor_id", userId)
      .eq("status", "accepted");
    if (a.error) {
      agentsResult.state = "UNAVAILABLE: " + a.error.message;
    } else {
      agentsResult.rows = a.data || [];
      agentsResult.state = agentsResult.rows.length ? "AVAILABLE" : "NONE";
    }

    // Distributor profile — location is a §22 input.
    var profileResult = { row: null, state: "NONE" };
    var dp = await sb
      .from("distributor_profiles")
      .select("id,business_name,location,market,category")
      .eq("id", userId)
      .maybeSingle();
    if (dp.error) {
      profileResult.state = "UNAVAILABLE: " + dp.error.message;
    } else {
      profileResult.row = dp.data || null;
      profileResult.state = profileResult.row ? "AVAILABLE" : "NONE";
    }

    return {
      terms: termsResult,
      prefs: prefsResult,
      productTerms: productTermsResult,
      agents: agentsResult,
      profile: profileResult
    };
  }

  // ------------------------------------------------------------------------
  // COMMERCIAL FIT — Canon §31 pricing hierarchy
  // ------------------------------------------------------------------------

  function computeCommercialFit(opportunity, context) {
    var relId = opportunity.relationship_id;
    var prodId = opportunity.product_id;

    var productRow = context.productTerms.byId[prodId] || null;

    // Public price — read from the product terms row (which now includes
    // price). If absent, fall back to null and the tier becomes UNKNOWN.
    var publicPriceValue = null;
    if (productRow && productRow.price != null) {
      publicPriceValue = num(productRow.price, null);
    }

    // Negotiated tier.
    var negotiated = null;
    if (relId) {
      var pref = context.prefs.rows.find(function (r) {
        return r.relationship_id === relId && r.product_id === prodId;
      });
      if (pref && pref.negotiated_unit_price != null) {
        negotiated = num(pref.negotiated_unit_price, null);
      }
    }

    // Relationship discount tier.
    var relationshipDiscountPercent = null;
    if (relId) {
      var term = context.terms.rows.find(function (r) { return r.relationship_id === relId; });
      if (term && term.default_discount_percent != null) {
        relationshipDiscountPercent = num(term.default_discount_percent, null);
      }
    }

    var tier = "UNKNOWN";
    var unitPrice = null;
    var discountPercent = null;

    if (negotiated != null) {
      tier = "negotiated";
      unitPrice = negotiated;
    } else if (relationshipDiscountPercent != null && publicPriceValue != null && publicPriceValue > 0) {
      tier = "relationship_discount";
      discountPercent = relationshipDiscountPercent;
      unitPrice = Math.round(publicPriceValue * (1 - relationshipDiscountPercent / 100));
    } else if (publicPriceValue != null) {
      tier = productRow && productRow.negotiable ? "negotiable" : "public";
      unitPrice = publicPriceValue;
    }

    return {
      tier: tier,
      unit_price: unitPrice,
      discount_percent: discountPercent,
      public_price: publicPriceValue,
      evidence: {
        relationship_terms_state: context.terms.state,
        preferences_state: context.prefs.state,
        product_terms_state: context.productTerms.state,
        negotiated_source: negotiated != null ? "relationship_product_preferences" : null,
        discount_source: relationshipDiscountPercent != null ? "relationship_trade_terms" : null,
        public_source: publicPriceValue != null ? "products.price" : null
      }
    };
  }

  // ------------------------------------------------------------------------
  // COMMERCIAL CONSTRAINTS — MOQ / delivery / pickup / lead time / trade terms
  // ------------------------------------------------------------------------

  function evaluateCommercialConstraints(opportunity, context) {
    var productRow = context.productTerms.byId[opportunity.product_id] || null;

    var moq = productRow && productRow.moq != null ? num(productRow.moq, 1) : 1;
    var demanded = num(opportunity.demanded_quantity, 0);
    var requested = demanded > 0 ? demanded : 0;

    // Canon §22: MOQ is an allocation input. If the demanded quantity is
    // below MOQ, allocation is blocked on commercial terms — it is not
    // silently rounded up (that would change the request).
    var moqSatisfied = requested >= moq;

    var deliveryAvailable = productRow ? !!productRow.delivery_available : null;
    var pickupAvailable   = productRow ? !!productRow.pickup_available   : null;

    return {
      moq:              moq,
      moq_satisfied:    moqSatisfied,
      delivery_available: deliveryAvailable,
      pickup_available:   pickupAvailable,
      lead_time:        productRow ? (productRow.lead_time || null) : null,
      trade_terms:      productRow ? (productRow.trade_terms || null) : null
    };
  }

  // ------------------------------------------------------------------------
  // DEPLETION PRIORITY — Canon §30
  // ------------------------------------------------------------------------

  function computeDepletionPriority(opportunity) {
    var e = opportunity.evidence || {};
    var health = e.stock_health || null;
    var strength = e.demand_strength || null;

    var reasons = [];
    var band = "NORMAL";

    var highHealth =
      health === "Aging" || health === "At Risk" || health === "Critical";
    var highDemand =
      strength === "HIGH" || strength === "VERY_HIGH";

    if (highHealth && highDemand) {
      band = "HIGH";
      reasons.push("stock_health=" + health);
      reasons.push("demand_strength=" + strength);
    } else if (highHealth) {
      band = "HIGH";
      reasons.push("stock_health=" + health);
    } else {
      reasons.push("stock_health=" + (health || "MISSING"));
    }

    return { band: band, reasons: reasons };
  }

  // ------------------------------------------------------------------------
  // NEXT ACTION — Canon §20 / §23  (rev. 1: single function)
  //
  // Precedence:
  //   1. Blocker resolution (attribution → relationship → quantity → stock
  //      → route → commercial terms). A blocked opportunity cannot be
  //      contacted first.
  //   2. MOQ shortfall. Commercial constraint.
  //   3. Price verification. Unknown tier cannot be routed with confidence.
  //   4. Contact buyer.
  //
  // The order is a decision procedure, not a heuristic.
  // ------------------------------------------------------------------------

  function computeNextAction(opportunity, constraints, context) {
    var blockers = opportunity.blockers || [];
    var codes = blockers.map(function (b) { return b.code; });

    if (codes.indexOf("MISSING BUYER") !== -1)              return ACTION_ATTRIBUTE_BUYER;
    if (codes.indexOf("MISSING RELATIONSHIP") !== -1)       return ACTION_ESTABLISH_RELATIONSHIP;
    if (codes.indexOf("MISSING QUANTITY") !== -1)           return ACTION_CLARIFY_QUANTITY;
    if (codes.indexOf("MISSING STOCK") !== -1)              return ACTION_REPLENISH_STOCK;
    if (codes.indexOf("MISSING ROUTE") !== -1)              return ACTION_NONE;
    if (codes.indexOf("MISSING COMMERCIAL TERMS") !== -1)   return ACTION_VERIFY_PRICE;

    if (!constraints.moq_satisfied)                         return ACTION_RESOLVE_MOQ_SHORTFALL;

    var fit = computeCommercialFit(opportunity, context);
    if (fit.tier === "UNKNOWN")                             return ACTION_VERIFY_PRICE;

    return ACTION_CONTACT_BUYER;
  }

  // ------------------------------------------------------------------------
  // BUILD ONE ALLOCATED OPPORTUNITY
  // ------------------------------------------------------------------------

  function buildAllocated(opportunity, context, acceptedAgents) {
    var fit = computeCommercialFit(opportunity, context);
    var constraints = evaluateCommercialConstraints(opportunity, context);
    var priority = computeDepletionPriority(opportunity);

    var demanded = num(opportunity.demanded_quantity, 0);
    var available = num(opportunity.stock_quantity, 0);

    var allocatable = 0;
    var routeReady = opportunity.opportunity_state === STATE_ROUTING_READY;
    if (routeReady && constraints.moq_satisfied) {
      allocatable = Math.min(demanded, available);
    }

    // Canon §21: transition to ALLOCATED only when the routing evidence is
    // fully present and the allocatable quantity is > 0. Otherwise the
    // opportunity remains ROUTING-READY with its blockers attached; §22 does
    // not promote on a partial basis.
    var nextState = opportunity.opportunity_state;
    if (routeReady && allocatable > 0) {
      nextState = STATE_ALLOCATED;
    }

    var nextAction = (nextState === STATE_ALLOCATED)
      ? ACTION_CONTACT_BUYER
      : computeNextAction(opportunity, constraints, context);

    var agentIds = (acceptedAgents || []).map(function (r) { return r.agent_id; }).filter(Boolean);

    // Clone the §16 opportunity into the §30 shape; override the fields §22
    // owns. Do not mutate the input.
    return {
      // --- Canon §30 canonical fields ---
      id:                 opportunity.id,
      product_id:         opportunity.product_id,
      distributor_id:     opportunity.distributor_id,
      buyer_id:           opportunity.buyer_id,
      inquiry_id:         opportunity.inquiry_id,
      relationship_id:    opportunity.relationship_id,

      stock_quantity:     opportunity.stock_quantity,
      demanded_quantity:  opportunity.demanded_quantity,

      demand_evidence:    opportunity.demand_evidence,
      relationship_state: opportunity.relationship_state,

      commercial_fit:     fit,
      route_state:        nextState === STATE_ALLOCATED ? "ALLOCATED"
                          : opportunity.route_state,
      opportunity_state:  nextState,
      depletion_priority: priority,

      blockers:           opportunity.blockers,
      next_action:        nextAction,

      created_at:         opportunity.created_at,
      updated_at:         nowIso(),

      // --- §20 explanatory fields (carried + extended) ---
      what:               opportunity.what,
      who:                opportunity.who,
      where:              opportunity.where,
      why:                opportunity.why,
      who_can_move_it: {
        agent_id: agentIds.length === 1 ? agentIds[0] : null,
        agents:   agentIds,
        note:     agentIds.length === 0
          ? "No accepted agent attachments on this distributor."
          : (agentIds.length === 1
              ? "One accepted agent is available for routing."
              : agentIds.length + " accepted agents are available for routing.")
      },

      // Allocatable quantity — §22 authoritative.
      allocatable_quantity: allocatable,

      // Full evidence block — carried forward with §22 additions.
      evidence: Object.assign({}, opportunity.evidence, {
        commercial_constraints: constraints,
        commercial_fit_evidence: fit.evidence,
        depletion_priority_reasons: priority.reasons
      }),

      produced_by: {
        stage:        STAGE,
        version:      VERSION,
        generated_at: nowIso(),
        prior_stage:  opportunity.produced_by || null
      }
    };
  }

  // ------------------------------------------------------------------------
  // STAGE RUN
  // ------------------------------------------------------------------------

  async function run(opportunitySnapshot) {
    var user = null;
    try { user = currentUser; } catch (e) {}
    if (!user || String(user.role || "").toLowerCase() !== "distributor") {
      throw new Error("AUTH_CONTEXT_UNAVAILABLE");
    }

    var generatedAt = nowIso();

    var opportunities = (opportunitySnapshot && opportunitySnapshot.rows) || [];
    var opportunitySnapshotAvailable = !!opportunitySnapshot;

    var routable = opportunities.filter(function (o) {
      return o.opportunity_state === STATE_ROUTING_READY;
    });

    var context = await readCommercialContext(user.id, routable);

    var allocatedById = Object.create(null);
    routable.forEach(function (o) {
      var allocated = buildAllocated(o, context, context.agents.rows);
      allocatedById[o.id] = allocated;
    });

    var out = opportunities.map(function (o) {
      return allocatedById[o.id] || o;
    });

    var byState = Object.create(null);
    var allocatedCount = 0;
    var totalAllocatable = 0;
    out.forEach(function (o) {
      byState[o.opportunity_state] = (byState[o.opportunity_state] || 0) + 1;
      if (o.opportunity_state === STATE_ALLOCATED) allocatedCount++;
      if (typeof o.allocatable_quantity === "number") {
        totalAllocatable += o.allocatable_quantity;
      }
    });

    return {
      stage: STAGE,
      version: VERSION,
      generatedAt: generatedAt,
      rows: out,
      summary: {
        opportunityCount:    out.length,
        routableCount:       routable.length,
        allocatedCount:      allocatedCount,
        totalAllocatable:    totalAllocatable,
        byState:             byState
      },
      evidence: {
        opportunity_snapshot_available: opportunitySnapshotAvailable,
        commercial_context: {
          terms:        context.terms.state,
          preferences:  context.prefs.state,
          product_terms: context.productTerms.state,
          agents:       context.agents.state,
          profile:      context.profile.state
        },
        note: "Allocation is authoritative for allocatable_quantity, commercial_fit, depletion_priority, next_action, and the ROUTING-READY → ALLOCATED transition. Depletion observation (§24) is a later stage."
      }
    };
  }

  // ------------------------------------------------------------------------
  // EXPORTS
  // ------------------------------------------------------------------------

  window.goodsbarnxDepletorAllocation = {
    version: VERSION,
    stage: STAGE,
    run: run
  };

  console.log("[GoodsbarnX] depletar-allocation.js loaded (" + VERSION + " rev.1)");
})();
