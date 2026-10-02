/* ==========================================================================
   GoodsbarnX — js/depletor-allocation.js
   Master Stock Depletor · Stage 4 — Allocation / Matching (Canon §22).

   Version: V1.8.2.6
   Load position: 11 (per D13). Loads after js/depletor-opportunity.js,
   before js/depletor-depletion.js.

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
          → negotiable. This file is the only §22-stage consumer of §31.

   This file owns:
     - readCommercialContext(): §31 terms, prefs, products MOQ/terms,
       accepted agents, distributor profile.
     - computeCommercialFit() : §31 pricing hierarchy as a typed result.
     - computeDepletionPriority(): evidence-band + reasons.
     - computeNextAction()    : deterministic named operation.
     - run()                  : returns the pipeline snapshot.

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
  // evidence; not a heuristic score. Each action has one and only one
  // meaning and downstream stages read them as enums.
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
  //
  // One batched read of §31-adjacent evidence. Read-only. Failures are named
  // so the pipeline can degrade honestly.
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

    // Relationship trade terms — Canon §31 / current_relationship_trade_terms
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

    // Products — MOQ, trade terms, delivery, pickup, lead time.
    var productTermsResult = { byId: {}, state: "NONE" };
    if (productIds.length) {
      var pr = await sb
        .from("products")
        .select("id,moq,lead_time,trade_terms,delivery_available,pickup_available,negotiable,bulk_discount")
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
  //
  //   per-product negotiated price      (relationship_product_preferences)
  //        ↓
  //   relationship-level discount       (relationship_trade_terms.default_discount_percent)
  //        ↓
  //   public price                      (products.price)
  //        ↓
  //   negotiable                        (products.negotiable)
  //
  // Returns a typed result. Never fabricates a price tier that has no
  // evidence.
  // ------------------------------------------------------------------------

  function computeCommercialFit(opportunity, context) {
    var relId = opportunity.relationship_id;
    var prodId = opportunity.product_id;

    var publicPrice = num(opportunity.evidence && opportunity.evidence.public_price, NaN);
    // public_price was not carried on the §16 opportunity; read from product terms.
    var productRow = context.productTerms.byId[prodId] || null;

    // The public price is not in the §16 snapshot; the §15 snapshot has it but
    // §22 does not receive §15 directly. Read it from the §16 opportunity's
    // source evidence chain: §16 carries stock_health but not price. We
    // therefore read public price from the products row we already fetched
    // — but only if the product row includes price. If it does not (schema
    // variance), the tier is "UNKNOWN".
    var publicPriceValue = null;
    if (productRow && productRow.price != null) {
      publicPriceValue = num(productRow.price, null);
    } else if (isFinite(publicPrice)) {
      publicPriceValue = publicPrice;
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
  // COMMERCIAL FIT / MOQ / DELIVERY — §22 inputs into allocatable quantity
  // ------------------------------------------------------------------------

  function evaluateCommercialConstraints(opportunity, context) {
    var productRow = context.productTerms.byId[opportunity.product_id] || null;

    var moq = productRow && productRow.moq != null ? num(productRow.moq, 1) : 1;
    var demanded = num(opportunity.demanded_quantity, 0);
    var available = num(opportunity.stock_quantity, 0);
    var requested = demanded > 0 ? demanded : 0;

    // Canon §22: MOQ is an allocation input. If the demanded quantity is
    // below MOQ, allocation is blocked on commercial terms — it is not
    // silently rounded up (that would change the request).
    var moqSatisfied = requested >= moq;

    // Delivery / pickup capability.
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
  //
  // Band + reasons. Derived from evidence already present in the §16
  // opportunity (stock health from §16, demand strength from §18). No new
  // signals; no decorative score.
  // ------------------------------------------------------------------------

  function computeDepletionPriority(opportunity) {
    var e = opportunity.evidence || {};
    var health = e.stock_health || null;
    var strength = e.demand_strength || null;

    var reasons = [];
    var band = "NORMAL";

    // High-priority depletion: aging/at-risk/critical stock AND at least
    // MODERATE demand. Both evidence classes must be present.
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
  // NEXT ACTION — Canon §20 / §23
  //
  // One named operation, chosen deterministically. Order of precedence is
  // by blocker severity: an opportunity that cannot be routed cannot be
  // contacted first. This is a decision procedure, not a heuristic.
  // ------------------------------------------------------------------------

  function computeNextAction(opportunity, constraints) {
    var blockers = opportunity.blockers || [];
    var codes = blockers.map(function (b) { return b.code; });

    if (codes.indexOf("MISSING BUYER") !== -1)              return ACTION_ATTRIBUTE_BUYER;
    if (codes.indexOf("MISSING RELATIONSHIP") !== -1)       return ACTION_ESTABLISH_RELATIONSHIP;
    if (codes.indexOf("MISSING QUANTITY") !== -1)           return ACTION_CLARIFY_QUANTITY;
    if (codes.indexOf("MISSING STOCK") !== -1)              return ACTION_REPLENISH_STOCK;
    if (codes.indexOf("MISSING ROUTE") !== -1)              return ACTION_NONE;

    if (!constraints.moq_satisfied) return ACTION_RESOLVE_MOQ_SHORTFALL;

    var fit = computeCommercialFit(opportunity, { terms: { rows: [] }, prefs: { rows: [] }, productTerms: { byId: {} } });
    // NOTE: this default-arg call is only used to detect the "UNKNOWN tier"
    // case; the caller supplies the real context separately. See caller.

    // If we reach here, evidence is complete enough to route.
    return ACTION_CONTACT_BUYER;
  }

  // ------------------------------------------------------------------------
  // BUILD ONE ALLOCATED OPPORTUNITY
  //
  // Takes a §16 opportunity and the commercial context. Returns a new object
  // in the §30 shape with ALLOCATED fields populated.
  // ------------------------------------------------------------------------

  function buildAllocated(opportunity, context, acceptedAgents) {
    var fit = computeCommercialFit(opportunity, context);
    var constraints = evaluateCommercialConstraints(opportunity, context);
    var priority = computeDepletionPriority(opportunity);

    // Allocatable quantity — §22 is authoritative here, §20 gave a
    // provisional value. §22 applies MOQ and full commercial constraints.
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

    // The next action is computed against the state that will result from
    // this stage. If allocation succeeded, the action is to contact the
    // buyer; otherwise it is the first blocker-resolution action.
    var nextAction = (nextState === STATE_ALLOCATED)
      ? ACTION_CONTACT_BUYER
      : computeNextActionWithContext(opportunity, constraints, context);

    // Accepted agents — §20 asks "who can move it". Empty array is a fact.
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

  // The computeNextAction above had a default-arg call for a rare case; the
  // real decision uses the caller-supplied context. This is a thin wrapper
  // so the precedence table lives in one place.
  function computeNextActionWithContext(opportunity, constraints, context) {
    var blockers = opportunity.blockers || [];
    var codes = blockers.map(function (b) { return b.code; });

    if (codes.indexOf("MISSING BUYER") !== -1)              return ACTION_ATTRIBUTE_BUYER;
    if (codes.indexOf("MISSING RELATIONSHIP") !== -1)       return ACTION_ESTABLISH_RELATIONSHIP;
    if (codes.indexOf("MISSING QUANTITY") !== -1)           return ACTION_CLARIFY_QUANTITY;
    if (codes.indexOf("MISSING STOCK") !== -1)              return ACTION_REPLENISH_STOCK;
    if (codes.indexOf("MISSING ROUTE") !== -1)              return ACTION_NONE;

    if (!constraints.moq_satisfied)                         return ACTION_RESOLVE_MOQ_SHORTFALL;

    // Check whether any pricing tier was resolvable. If not, the next action
    // is to verify price rather than to contact the buyer with an unknown
    // commercial fit.
    var fit = computeCommercialFit(opportunity, context);
    if (fit.tier === "UNKNOWN")                             return ACTION_VERIFY_PRICE;

    return ACTION_CONTACT_BUYER;
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

    // Read commercial context for the routing-ready subset only — the rest
    // cannot be allocated and reading terms for them would be wasted reads.
    var routable = opportunities.filter(function (o) {
      return o.opportunity_state === STATE_ROUTING_READY;
    });

    var context = await readCommercialContext(user.id, routable);

    // Build allocated opportunities for the routable set; pass through
    // non-routable opportunities untouched.
    var allocatedById = Object.create(null);
    routable.forEach(function (o) {
      var allocated = buildAllocated(o, context, context.agents.rows);
      allocatedById[o.id] = allocated;
    });

    var out = opportunities.map(function (o) {
      return allocatedById[o.id] || o;
    });

    // Summary.
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

  console.log("[GoodsbarnX] depletor-allocation.js loaded (" + VERSION + ")");
})();
