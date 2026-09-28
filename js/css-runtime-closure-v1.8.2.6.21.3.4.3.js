// ==========================================================================
// GoodsbarnX — CSS Runtime Closure Diagnostic
// Version: V1.8.2.6.21.3.4.3
//
// PURPOSE:
// Prove that the deployed CSS runtime resolves correctly without changing
// the existing GoodsbarnX visual system.
//
// THIS IS A READ-ONLY DIAGNOSTIC.
// It does NOT:
// - modify CSS
// - remove inline styles
// - rewrite the DOM
// - change Supabase
// - change allocation logic
// - change inquiries
// - change relationships
// - change authentication
// - change buyer behaviour instrumentation
//
// Boundary:
// HTML → stylesheet asset → CSSOM → selector → cascade → DOM → computed style
// ==========================================================================

(function () {
  "use strict";

  const VERSION = "V1.8.2.6.21.3.4.3";
  const BUILD_MARKER =
    "GBX-V1.8.2.6.21.3.4.3-CSS-RUNTIME-CLOSURE";

  const REQUIRED_STYLESHEETS = [
    "css/main.css",
    "css/components.css"
  ];

  // ------------------------------------------------------------------------
  // Critical runtime surfaces.
  //
  // These are checked only for runtime resolution.
  // No element is created, moved, styled, or otherwise mutated unless the
  // optional ?cssclosure=1 diagnostic panel is explicitly requested.
  // ------------------------------------------------------------------------

  const CRITICAL_SELECTORS = [
    "#app",
    "header.top",
    ".hero",
    ".manifest",
    "nav.bottom",
    ".depletor-console",
    ".depletor-opportunities",
    ".demand-signal",
    ".auth-box"
  ];

  const COMPUTED_STYLE_CHECKS = [
    {
      selector: "#app",
      properties: [
        "display",
        "position"
      ]
    },
    {
      selector: "header.top",
      properties: [
        "display",
        "position"
      ]
    },
    {
      selector: "nav.bottom",
      properties: [
        "display",
        "position"
      ]
    }
  ];

  // ------------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------------

  function normalizeUrl(url) {
    try {
      return new URL(url, document.baseURI).href;
    } catch (error) {
      return String(url || "");
    }
  }

  function stylesheetMatches(linkHref, requiredPath) {
    const absoluteRequired = normalizeUrl(requiredPath);
    const absoluteHref = normalizeUrl(linkHref);

    return (
      absoluteHref === absoluteRequired ||
      absoluteHref.endsWith("/" + requiredPath)
    );
  }

  function selectorExistsInCssRules(cssRules, selector) {
    for (let i = 0; i < cssRules.length; i++) {
      const rule = cssRules[i];

      if (
        rule.type === CSSRule.STYLE_RULE &&
        rule.selectorText
      ) {
        const selectors = rule.selectorText
          .split(",")
          .map(function (item) {
            return item.trim();
          });

        if (selectors.includes(selector)) {
          return true;
        }
      }

      // Recursively inspect grouping rules such as media queries.
      if (rule.cssRules) {
        try {
          if (selectorExistsInCssRules(rule.cssRules, selector)) {
            return true;
          }
        } catch (error) {
          // Cross-origin or restricted CSS rules are handled by the
          // stylesheet-level diagnostic.
        }
      }
    }

    return false;
  }

  function findStylesheet(requiredPath) {
    const links = Array.from(
      document.querySelectorAll('link[rel="stylesheet"]')
    );

    return links.find(function (link) {
      return stylesheetMatches(link.href, requiredPath);
    }) || null;
  }

  function getAttachedStyleSheet(link) {
    return Array.from(document.styleSheets).find(function (sheet) {
      return stylesheetMatches(sheet.href, link.getAttribute("href"));
    }) || null;
  }

  function pushIssue(issues, message) {
    issues.push(message);
  }

  // ------------------------------------------------------------------------
  // Runtime state
  // ------------------------------------------------------------------------

  const startedAt = new Date().toISOString();

  const result = {
    version: VERSION,
    buildMarker: BUILD_MARKER,
    status: "RUNNING",
    startedAt: startedAt,
    completedAt: null,

    requiredStylesheets: REQUIRED_STYLESHEETS.slice(),
    stylesheets: [],
    selectors: [],
    computedStyles: [],

    issues: [],
    summary: ""
  };

  // ------------------------------------------------------------------------
  // 1. Confirm stylesheet assets are declared by the deployed HTML.
  // ------------------------------------------------------------------------

  REQUIRED_STYLESHEETS.forEach(function (requiredPath) {
    const link = findStylesheet(requiredPath);

    if (!link) {
      pushIssue(
        result.issues,
        "MISSING stylesheet asset: " + requiredPath
      );

      result.stylesheets.push({
        path: requiredPath,
        declared: false,
        loaded: false,
        cssomReadable: false
      });

      return;
    }

    result.stylesheets.push({
      path: requiredPath,
      declared: true,
      loaded: false,
      cssomReadable: false
    });
  });

  // ------------------------------------------------------------------------
  // 2. Confirm stylesheets are attached to the browser CSS runtime.
  // ------------------------------------------------------------------------

  REQUIRED_STYLESHEETS.forEach(function (requiredPath) {
    const record = result.stylesheets.find(function (item) {
      return item.path === requiredPath;
    });

    if (!record || !record.declared) {
      return;
    }

    const link = findStylesheet(requiredPath);

    if (!link) {
      return;
    }

    const sheet = getAttachedStyleSheet(link);

    if (!sheet) {
      pushIssue(
        result.issues,
        "NOT ATTACHED to document.styleSheets: " + requiredPath
      );

      return;
    }

    record.loaded = true;

    // --------------------------------------------------------------
    // 3. Confirm CSSOM can actually read the deployed stylesheet.
    // --------------------------------------------------------------

    try {
      const rules = sheet.cssRules;

      if (!rules) {
        pushIssue(
          result.issues,
          "CSSOM unavailable for stylesheet: " + requiredPath
        );
      } else {
        record.cssomReadable = true;
        record.ruleCount = rules.length;
      }
    } catch (error) {
      pushIssue(
        result.issues,
        "CSSOM read failed for " +
          requiredPath +
          ": " +
          error.message
      );
    }
  });

  // ------------------------------------------------------------------------
  // 4. Confirm critical selectors exist in the deployed CSSOM.
  // ------------------------------------------------------------------------

  CRITICAL_SELECTORS.forEach(function (selector) {
    const matchingElements = document.querySelectorAll(selector);

    let stylesheetMatch = false;
    let readableStylesheetCount = 0;

    REQUIRED_STYLESHEETS.forEach(function (requiredPath) {
      const link = findStylesheet(requiredPath);

      if (!link) {
        return;
      }

      const sheet = getAttachedStyleSheet(link);

      if (!sheet) {
        return;
      }

      try {
        if (!sheet.cssRules) {
          return;
        }

        readableStylesheetCount++;

        if (
          selectorExistsInCssRules(
            sheet.cssRules,
            selector
          )
        ) {
          stylesheetMatch = true;
        }
      } catch (error) {
        // Already reported at stylesheet level.
      }
    });

    const selectorResult = {
      selector: selector,
      domCount: matchingElements.length,
      presentInDOM: matchingElements.length > 0,
      presentInCSSOM: stylesheetMatch,
      readableStylesheetCount: readableStylesheetCount
    };

    result.selectors.push(selectorResult);

    // Only require CSSOM resolution when the corresponding surface exists
    // in the deployed DOM. This prevents diagnostic false positives from
    // optional/route-specific surfaces.
    if (
      selectorResult.presentInDOM &&
      !selectorResult.presentInCSSOM
    ) {
      pushIssue(
        result.issues,
        "DOM selector has no matching CSS rule: " + selector
      );
    }
  });

  // ------------------------------------------------------------------------
  // 5. Confirm computed styles resolve for critical DOM surfaces.
  //
  // This reads the browser's final cascade. It does not modify anything.
  // ------------------------------------------------------------------------

  COMPUTED_STYLE_CHECKS.forEach(function (check) {
    const element = document.querySelector(check.selector);

    if (!element) {
      result.computedStyles.push({
        selector: check.selector,
        presentInDOM: false,
        properties: {}
      });

      return;
    }

    const computed = window.getComputedStyle(element);
    const properties = {};

    check.properties.forEach(function (property) {
      properties[property] = computed.getPropertyValue(property);
    });

    result.computedStyles.push({
      selector: check.selector,
      presentInDOM: true,
      properties: properties
    });

    check.properties.forEach(function (property) {
      const value = computed.getPropertyValue(property);

      if (!value || !String(value).trim()) {
        pushIssue(
          result.issues,
          "Computed style unresolved: " +
            check.selector +
            " → " +
            property
        );
      }
    });
  });

  // ------------------------------------------------------------------------
  // 6. Finalize result.
  // ------------------------------------------------------------------------

  result.status =
    result.issues.length === 0
      ? "PASS"
      : "BLOCKED";

  result.completedAt = new Date().toISOString();

  if (result.status === "PASS") {
    result.summary =
      VERSION +
      " CSS RUNTIME CLOSURE — PASS";
  } else {
    result.summary =
      VERSION +
      " CSS RUNTIME CLOSURE — BLOCKED (" +
      result.issues.length +
      " issue" +
      (result.issues.length === 1 ? "" : "s") +
      ")";
  }

  // ------------------------------------------------------------------------
  // 7. Console output.
  // ------------------------------------------------------------------------

  console.group(
    "GoodsbarnX — CSS Runtime Closure"
  );

  console.log(
    "%c" + result.summary,
    "font-weight:700;"
  );

  console.log(
    "Build marker:",
    BUILD_MARKER
  );

  console.log(
    "Stylesheets:",
    result.stylesheets
  );

  console.log(
    "Selectors:",
    result.selectors
  );

  console.log(
    "Computed styles:",
    result.computedStyles
  );

  if (result.issues.length) {
    console.warn(
      "CSS Runtime Closure issues:",
      result.issues
    );
  } else {
    console.log(
      "No CSS runtime closure issues detected."
    );
  }

  console.groupEnd();

  // ------------------------------------------------------------------------
  // 8. Expose read-only diagnostic state.
  // ------------------------------------------------------------------------

  window.goodsbarnxCssRuntimeClosure = Object.freeze(result);

  // ------------------------------------------------------------------------
  // 9. Optional visible diagnostic panel.
  //
  // Activated only with:
  //
  // ?cssclosure=1
  //
  // This panel is diagnostic UI only. It does not alter production CSS.
  // ------------------------------------------------------------------------

  let showPanel = false;

  try {
    showPanel =
      new URLSearchParams(window.location.search)
        .get("cssclosure") === "1";
  } catch (error) {
    showPanel = false;
  }

  if (!showPanel) {
    return;
  }

  const panel = document.createElement("div");

  panel.setAttribute(
    "data-gbx-css-runtime-closure",
    VERSION
  );

  panel.style.position = "fixed";
  panel.style.left = "16px";
  panel.style.right = "16px";
  panel.style.bottom = "16px";
  panel.style.zIndex = "2147483647";
  panel.style.padding = "16px";
  panel.style.background = "#12151C";
  panel.style.color = "#EFE9DE";
  panel.style.border = "1px solid #C88A34";
  panel.style.borderRadius = "10px";
  panel.style.fontFamily =
    "system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
  panel.style.fontSize = "13px";
  panel.style.lineHeight = "1.5";
  panel.style.boxShadow =
    "0 12px 40px rgba(0,0,0,.35)";

  const heading = document.createElement("div");

  heading.textContent = result.summary;

  heading.style.fontWeight = "700";
  heading.style.marginBottom = "8px";

  panel.appendChild(heading);

  const marker = document.createElement("div");

  marker.textContent =
    "Marker: " + BUILD_MARKER;

  marker.style.opacity = "0.8";
  marker.style.marginBottom = "10px";

  panel.appendChild(marker);

  const stylesheetSummary =
    document.createElement("div");

  stylesheetSummary.textContent =
    "Stylesheets checked: " +
    result.stylesheets.length;

  panel.appendChild(stylesheetSummary);

  const selectorSummary =
    document.createElement("div");

  selectorSummary.textContent =
    "Critical selectors checked: " +
    result.selectors.length;

  panel.appendChild(selectorSummary);

  const issueSummary =
    document.createElement("div");

  issueSummary.textContent =
    "Issues: " + result.issues.length;

  issueSummary.style.marginBottom = "10px";

  panel.appendChild(issueSummary);

  if (result.issues.length > 0) {
    const issueList =
      document.createElement("ul");

    issueList.style.margin = "8px 0";
    issueList.style.paddingLeft = "20px";

    result.issues.forEach(function (issue) {
      const item =
        document.createElement("li");

      item.textContent = issue;

      issueList.appendChild(item);
    });

    panel.appendChild(issueList);
  }

  const closeButton =
    document.createElement("button");

  closeButton.type = "button";
  closeButton.textContent = "Close diagnostic";

  closeButton.style.marginTop = "8px";
  closeButton.style.padding = "8px 12px";
  closeButton.style.cursor = "pointer";

  closeButton.addEventListener(
    "click",
    function () {
      panel.remove();
    }
  );

  panel.appendChild(closeButton);

  document.body.appendChild(panel);
})();
