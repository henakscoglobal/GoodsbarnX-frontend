/* ==========================================================================
   GoodsbarnX — js/depletor-stock.js
   Master Stock Depletor · Stage 1 — Stock Intelligence (Canon §15) + Stock
   Health (Canon §16).

   Version: V1.8.2.6
   Load position: 8 (per D13). Loaded after js/cart.js, before
   js/depletor-radar.js.

   Canon basis:
     §14  pipeline stage 1 of 7.
     §15  stock intelligence inputs: product, distributor, location,
          stock quantity, price, MOQ, lead time, trade terms, availability.
     §16  stock health classification: Healthy → Watch → Aging → At Risk
          → Critical. Evidence-driven, never decorative.
     §22  this stage is a producer for allocation; it does not allocate.
     §29  evidence integrity — every classification carries the evidence
          that produced it. Absence of evidence is named, never inferred.

   Server dependency:
     S1  products.received_at timestamptz null
         products.last_sold_at timestamptz null
     Until S1 is applied server-side, the stock-health classification
     degrades to "Watch" with evidence.timeBasis = "MISSING" — an explicit
     state, not a fabricated "Healthy".

   This file owns:
     - readEvidence()  : Supabase read scoped to authenticated distributor.
     - classifyHealth(): Canon §16 classifier from temporal evidence.
     - run()           : returns the pipeline snapshot for the conductor.

   This file does NOT:
     - render UI (conductor owns rendering).
     - read inquiries, trade_relationships, behaviour events, or any
       downstream domain. §15 is supply-only.
     - write to the database. Read-only runtime.
   ========================================================================== */

(function () {
  "use strict";

  var VERSION = "V1.8.2.6";
  var STAGE = "stock_intelligence";

  // ------------------------------------------------------------------------
  // TEMPORAL EVIDENCE — Canon §16
  //
  // Age is measured in hours since the evidence timestamp. The classifier
  // reads only values that are actually present. A missing timestamp is a
  // named MISSING, not a zero.
  // ------------------------------------------------------------------------

  function parseTs(v) {
    if (typeof v !== "string" || !v) return null;
    var t = new Date(v).getTime();
    return isFinite(t) ? t : null;
  }

  function hoursSince(tsMs, nowMs) {
    if (tsMs == null) return null;
    return Math.max(0, (nowMs - tsMs) / 3600000);
  }

  // Canon §16 classifier. Thresholds are policy, and are declared here so a
  // future audit can cite them. They are heuristic until S1 is applied and
  // the review layer establishes empirical baselines.
  function classifyHealth(evidence) {
    var receivedAge = evidence.receivedAgeHours;
    var lastSoldAge = evidence.lastSoldAgeHours;

    // No temporal basis at all — evidence is MISSING. Never claim Healthy.
    if (receivedAge == null && lastSoldAge == null) {
      return {
        band: "Watch",
        reason: "No temporal evidence available; S1 columns absent or null.",
        basis: "MISSING"
      };
    }

    // Prefer last_sold_at when present — it is the strongest depletion signal.
    // Fall back to received_at.
    var basis = lastSoldAge != null ? "last_sold_at" : "received_at";
    var age = lastSoldAge != null ? lastSoldAge : receivedAge;

    // Heuristic thresholds (hours). Canon §16 lists five bands; the boundaries
    // are declared here rather than hardcoded at each comparison site.
    if (age <= 24 * 7)          return { band: "Healthy",   reason: "Sold or received within 7 days.",       basis: basis };
    if (age <= 24 * 30)         return { band: "Watch",     reason: "Within 30 days.",                       basis: basis };
    if (age <= 24 * 90)         return { band: "Aging",     reason: "30–90 days without recent movement.",   basis: basis };
    if (age <= 24 * 180)        return { band: "At Risk",   reason: "90–180 days without recent movement.",  basis: basis };
    return                             { band: "Critical",  reason: "180+ days without recent movement.",   basis: basis };
  }

  // ------------------------------------------------------------------------
  // EVIDENCE READ
  //
  // Read-only. Scoped to the authenticated distributor. Failures are named
  // and re-thrown so the conductor can surface them without inventing state.
  // ------------------------------------------------------------------------

  async function readEvidence() {
    var user = null;
    try { user = currentUser; } catch (e) {}
    if (!user || String(user.role || "").toLowerCase() !== "distributor") {
      throw new Error("AUTH_CONTEXT_UNAVAILABLE");
    }
    if (!window.sb || typeof window.sb.from !== "function") {
      throw new Error("SUPABASE_UNAVAILABLE");
    }

    // S1 columns are requested optimistically. If S1 has not been applied,
    // Supabase returns an error naming the missing columns; we retry the
    // read without them and mark the temporal evidence MISSING. This makes
    // the S1 dependency explicit at the call site and prevents a hard
    // failure of the pipeline while the server migration is in flight.
    var withS1 = await sb
      .from("products")
      .select("id,name,price,stock_quantity,status,category,received_at,last_sold_at")
      .eq("distributor_id", user.id);

    var rows = null;
    var s1Applied = true;

    if (withS1.error) {
      // Retry without S1 columns.
      var withoutS1 = await sb
        .from("products")
        .select("id,name,price,stock_quantity,status,category")
        .eq("distributor_id", user.id);
      if (withoutS1.error) throw withoutS1.error;
      rows = withoutS1.data || [];
      s1Applied = false;
      console.warn(
        "[GoodsbarnX/depletor-stock] S1 columns unavailable; stock health " +
        "will be classified as Watch with timeBasis=MISSING. " +
        "Apply server migration S1 to enable §16 evidence-driven health."
      );
    } else {
      rows = withS1.data || [];
    }

    return { products: rows, s1Applied: s1Applied };
  }

  // ------------------------------------------------------------------------
  // STAGE RUN
  //
  // Returns the pipeline snapshot. Snapshot shape is stable across stages:
  //   { stage, rows, summary, evidence, generatedAt }
  // ------------------------------------------------------------------------

  async function run() {
    var read = await readEvidence();
    var products = read.products;
    var nowMs = Date.now();

    var out = products.map(function (p) {
      var receivedMs = parseTs(p.received_at);
      var lastSoldMs = parseTs(p.last_sold_at);

      var evidence = {
        receivedAt:      p.received_at   || null,
        lastSoldAt:      p.last_sold_at  || null,
        receivedAgeHours: hoursSince(receivedMs, nowMs),
        lastSoldAgeHours: hoursSince(lastSoldMs, nowMs),
        s1Applied:        read.s1Applied,
      };

      var health = classifyHealth(evidence);

      return {
        // Canon §30 canonical supply fields.
        product_id:      p.id,
        distributor_id:  currentUser.id,
        name:            p.name || "",
        category:        p.category || null,
        status:          p.status || null,
        price:           Number(p.price) || 0,
        stock_quantity:  Number(p.stock_quantity) || 0,

        // Canon §16 stock health (evidence-tagged).
        health:          health.band,
        health_reason:   health.reason,
        health_basis:    health.basis,

        // Canon §29 evidence block — provenance travels with the row.
        evidence:        evidence,

        // Legacy camelCase aliases (dropped in a later phase).
        id:              p.id,
        stock_quantity_legacy: Number(p.stock_quantity) || 0,
      };
    });

    // Summary — the numbers the conductor's panel surfaces for §15.
    var total = out.length;
    var byBand = { Healthy: 0, Watch: 0, Aging: 0, "At Risk": 0, Critical: 0 };
    var value = 0;
    out.forEach(function (r) {
      if (byBand[r.health] != null) byBand[r.health]++;
      value += r.price * r.stock_quantity;
    });

    return {
      stage: STAGE,
      version: VERSION,
      generatedAt: new Date().toISOString(),
      rows: out,
      summary: {
        productCount: total,
        totalValue:   value,
        bands:        byBand,
        s1Applied:    read.s1Applied
      },
      evidence: {
        source: "products",
        scope:  "distributor_id = currentUser.id",
        s1Applied: read.s1Applied
      }
    };
  }

  // ------------------------------------------------------------------------
  // EXPORTS
  //
  // Stage files export a run() that the conductor sequences. They do not
  // expose internal helpers; the conductor does not reach into evidence
  // construction.
  // ------------------------------------------------------------------------

  window.goodsbarnxDepletorStock = {
    version: VERSION,
    stage: STAGE,
    run: run
  };

  console.log("[GoodsbarnX] depletor-stock.js loaded (" + VERSION + ")");
})();
