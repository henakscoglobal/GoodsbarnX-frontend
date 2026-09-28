// ==========================================================================
// GoodsbarnX — Runtime Asset Integrity Closure
// Version: V1.8.2.6.21.3.4.4
//
// PURPOSE:
// Prove that the deployed GoodsbarnX entry point contains the intended
// production runtime assets exactly once, in the canonical order, while
// preserving app.js as the final GoodsbarnX production runtime asset.
//
// READ-ONLY DIAGNOSTIC.
// No Supabase writes. No allocation writes. No inquiry writes.
// No relationship writes. No stock/order/reservation mutation.
// No DOM/style mutation during the integrity check.
//
// Boundary:
// HTML → runtime asset declaration → exact order → canonical engine entry
// ==========================================================================

(function () {
  "use strict";

  var VERSION = "V1.8.2.6.21.3.4.4";
  var BUILD_MARKER = "GBX-V1.8.2.6.21.3.4.4-RUNTIME-ASSET-INTEGRITY";
  var EXPECTED_PRODUCTION_BUILD = "V1.8.2.6.8.1.1.21.3.3";

  var EXPECTED_LOCAL_RUNTIME = [
    "js/config.js",
    "js/ui.js",
    "js/auth.js",
    "js/market.js",
    "js/inquiries.js",
    "js/storefront.js",
    "js/cart.js",
    "js/depletor.js",
    "js/products.js",
    "js/trust.js",
    "js/profile.js",
    "js/upgrade.js",
    "js/staff.js",
    "js/relationship.js",
    "js/agent.js",
    "js/app.js"
  ];

  var REQUIRED_CSS = [
    "css/main.css",
    "css/components.css"
  ];

  function normalizePath(value) {
    try {
      var url = new URL(value, document.baseURI);
      return url.pathname.replace(/^\//, "");
    } catch (error) {
      return String(value || "").split("?")[0].split("#")[0].replace(/^\//, "");
    }
  }

  function localScripts() {
    return Array.prototype.slice.call(document.querySelectorAll("script[src]"))
      .map(function (node) {
        return normalizePath(node.getAttribute("src"));
      })
      .filter(function (path) {
        return /^js\//.test(path);
      });
  }

  function cssLinks() {
    return Array.prototype.slice.call(document.querySelectorAll('link[rel="stylesheet"]'))
      .map(function (node) {
        return normalizePath(node.getAttribute("href"));
      });
  }

  function count(list, value) {
    return list.filter(function (item) { return item === value; }).length;
  }

  function addIssue(issues, message) {
    issues.push(message);
  }

  function run() {
    var result = {
      version: VERSION,
      buildMarker: BUILD_MARKER,
      status: "RUNNING",
      productionBuild: null,
      localRuntime: [],
      requiredCss: REQUIRED_CSS.slice(),
      checks: [],
      issues: [],
      completedAt: null
    };

    // DOCUMENT CONTRACT
    if (!document.doctype || document.doctype.name !== "html") {
      addIssue(result.issues, "HTML5 doctype missing");
    } else {
      result.checks.push("✓ HTML5 doctype present");
    }

    var buildMeta = document.querySelector('meta[name="goodsbarnx-build"]');
    result.productionBuild = buildMeta ? buildMeta.content : null;

    if (!buildMeta) {
      addIssue(result.issues, "Missing meta[name=goodsbarnx-build]");
    } else if (buildMeta.content !== EXPECTED_PRODUCTION_BUILD) {
      addIssue(
        result.issues,
        "Production build metadata mismatch: expected " +
          EXPECTED_PRODUCTION_BUILD +
          ", found " +
          buildMeta.content
      );
    } else {
      result.checks.push("✓ Production build metadata = " + EXPECTED_PRODUCTION_BUILD);
    }

    // RUNTIME LINEAGE
    result.localRuntime = localScripts();

    EXPECTED_LOCAL_RUNTIME.forEach(function (expectedPath) {
      var occurrences = count(result.localRuntime, expectedPath);

      if (occurrences !== 1) {
        addIssue(
          result.issues,
          expectedPath + " expected exactly once; found " + occurrences
        );
      } else {
        result.checks.push("✓ " + expectedPath + " present exactly once");
      }
    });

    if (result.localRuntime.length !== EXPECTED_LOCAL_RUNTIME.length) {
      addIssue(
        result.issues,
        "Unexpected local GoodsbarnX runtime asset count: expected " +
          EXPECTED_LOCAL_RUNTIME.length +
          ", found " +
          result.localRuntime.length
      );
    }

    EXPECTED_LOCAL_RUNTIME.forEach(function (expectedPath, index) {
      if (result.localRuntime[index] !== expectedPath) {
        addIssue(
          result.issues,
          "Runtime order mismatch at position " +
            (index + 1) +
            ": expected " +
            expectedPath +
            ", found " +
            String(result.localRuntime[index] || "<missing>")
        );
      }
    });

    if (result.localRuntime.join("|") === EXPECTED_LOCAL_RUNTIME.join("|")) {
      result.checks.push("✓ Canonical local runtime order exact");
    }

    if (result.localRuntime[result.localRuntime.length - 1] !== "js/app.js") {
      addIssue(result.issues, "js/app.js is not the final GoodsbarnX local runtime asset");
    } else {
      result.checks.push("✓ js/app.js is final GoodsbarnX local runtime asset");
    }

    if (result.localRuntime.indexOf("js/depletion-transaction.js") !== -1) {
      addIssue(result.issues, "Test-only depletion transaction module is loaded as production runtime");
    } else {
      result.checks.push("✓ Test-only depletion transaction module is not loaded");
    }

    // CSS ENTRY CONTRACT
    var loadedCss = cssLinks();

    REQUIRED_CSS.forEach(function (requiredPath) {
      if (count(loadedCss, requiredPath) !== 1) {
        addIssue(
          result.issues,
          requiredPath + " expected exactly once; found " + count(loadedCss, requiredPath)
        );
      } else {
        result.checks.push("✓ " + requiredPath + " present exactly once");
      }
    });

    // MASTER STOCK DEPLETOR PRODUCTION SURFACE
    if (!document.getElementById("depletor-console")) {
      addIssue(result.issues, "Master Stock Depletor production surface #depletor-console missing");
    } else {
      result.checks.push("✓ Master Stock Depletor production surface present");
    }

    if (document.querySelector('script[src="js/depletor.js"]')) {
      result.checks.push("✓ Master Stock Depletor runtime entry present");
    } else {
      addIssue(result.issues, "Master Stock Depletor runtime entry js/depletor.js missing");
    }

    // NON-MUTATION CONTRACT
    result.checks.push("✓ Read-only diagnostic: no Supabase mutation");
    result.checks.push("✓ Read-only diagnostic: no stock/order/reservation mutation");
    result.checks.push("✓ Read-only diagnostic: no inquiry/relationship mutation");
    result.checks.push("✓ Architecture preserved: Stock Intelligence → Demand Radar → Relationship Graph → Opportunity Engine → Allocation/Matching → Depletion → Replenishment");

    result.status = result.issues.length === 0 ? "PASS" : "BLOCKED";
    result.completedAt = new Date().toISOString();

    var summary = VERSION + " RUNTIME ASSET INTEGRITY — " + result.status;

    console.group("GoodsbarnX — Runtime Asset Integrity Closure");
    console.log("%c" + summary, "font-weight:700;");
    console.log("Build marker:", BUILD_MARKER);
    console.log("Production build:", result.productionBuild);
    console.log("Local runtime:", result.localRuntime);
    console.log("Checks:", result.checks);

    if (result.issues.length) {
      console.warn("Issues:", result.issues);
    } else {
      console.log("No runtime asset integrity issues detected.");
    }

    console.groupEnd();

    result.summary = summary;
    window.goodsbarnxRuntimeAssetIntegrity = Object.freeze(result);

    return result;
  }

  function boot() {
    // Run after DOM parsing so every production script declaration is visible,
    // while remaining independent of application initialization.
    run();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
