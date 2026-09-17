// ============================================================================
// GoodsbarnX — V1.8.2.6.8.1.1.4
// DEPLOYMENT LINEAGE INTEGRITY BOUNDARY
//
// Read-only deployment proof. No Supabase calls. No commerce mutation.
// Verifies that the browser is executing the intended package lineage rather
// than merely displaying the expected version in a stale test label.
// ============================================================================
(() => {
  "use strict";

  const VERSION = "V1.8.2.6.8.1.1.4";
  const TEST_ID = "goodsbarnx-deployment-lineage-v18268114";
  const GLOBAL = "__GBX_V18268114_DEPLOYMENT_LINEAGE__";

  // These are the exact hashes of the preserved runtime assets in this build.
  const EXPECTED = {
    "js/app.js": "ad20576704790f4deb49aa2eab02e6e1be9a2a795fe03619b6275138321b0621",
    "js/auth.js": "862aa70b482ec013bee20bf01b89ad992bd23d19396db05a8e218094923d1232",
    "js/depletor.js": "fb151f439a746798bd82d46aa3edd9f81f69834c33c423d4f689bb3918f6a76e",
    "css/allocation-evidence-integrity.css": "080e3a698a39618e3d052a4b190e06d31a337a68c8e7de6e2869034a1ae059b6",
    "css/deployment-lineage.css": null
  };

  const state = window[GLOBAL] || {
    version: VERSION,
    testId: TEST_ID,
    checks: [],
    status: "RUNNING"
  };
  window[GLOBAL] = state;

  function add(name, ok, evidence) {
    state.checks.push({name, ok, evidence: String(evidence ?? "")});
  }

  function pathOf(url) {
    try {
      const u = new URL(url, location.href);
      return u.pathname.replace(/^\//, "");
    } catch (_) {
      return String(url || "").replace(/^\.\//, "");
    }
  }

  function scripts() {
    return Array.from(document.scripts)
      .map(s => s.src || s.getAttribute("src"))
      .filter(Boolean);
  }

  function normaliseHex(buffer) {
    return Array.from(new Uint8Array(buffer))
      .map(b => b.toString(16).padStart(2, "0"))
      .join("");
  }

  async function sha256Text(text) {
    if (!window.crypto?.subtle) throw new Error("Web Crypto SHA-256 unavailable.");
    const bytes = new TextEncoder().encode(text);
    return normaliseHex(await crypto.subtle.digest("SHA-256", bytes));
  }

  async function fetchHash(path) {
    const response = await fetch(path + "?gbx_lineage=" + encodeURIComponent(VERSION), {
      cache: "no-store",
      credentials: "same-origin"
    });
    if (!response.ok) throw new Error(path + " returned HTTP " + response.status);
    return sha256Text(await response.text());
  }

  async function run() {
    if (state.completed) return;
    state.startedAt = new Date().toISOString();

    const srcs = scripts();
    const paths = srcs.map(pathOf);

    // 1. Exact test identity.
    add("Test identity", VERSION === "V1.8.2.6.8.1.1.4", VERSION);

    // 2. Application document declares the same deployment.
    const meta = document.querySelector('meta[name="goodsbarnx-build"]');
    const declared = meta?.getAttribute("content") ||
      document.documentElement.getAttribute("data-gbx-build") || "not declared";
    add("Document build declaration", declared === VERSION, declared);

    // 3. Exactly one lineage script is loaded.
    const lineageScripts = paths.filter(p => p.endsWith("js/deployment-lineage.js"));
    add("Lineage asset uniqueness", lineageScripts.length === 1, lineageScripts.join(" | ") || "0 lineage assets");

    // 4. Required runtime assets are actually present in the document.
    ["js/config.js","js/ui.js","js/auth.js","js/market.js","js/inquiries.js","js/storefront.js","js/cart.js","js/depletor.js","js/products.js","js/trust.js","js/profile.js","js/upgrade.js","js/staff.js","js/app.js"]
      .forEach(p => add("Runtime asset loaded · " + p, paths.includes(p), paths.includes(p) ? "loaded" : "missing"));

    // 5. app.js remains last among local runtime scripts, preserving the
    // established GoodsbarnX initialization boundary.
    const localRuntime = paths.filter(p => p.startsWith("js/") && !p.includes("deployment-lineage.js"));
    add("app.js remains final runtime asset", localRuntime[localRuntime.length - 1] === "js/app.js", localRuntime[localRuntime.length - 1] || "none");

    // 6. Old 1.1.3 boundary must not remain in the new deployment document.
    const html = document.documentElement?.outerHTML || "";
    const stale113 = html.includes("V1.8.2.6.8.1.1.3") || html.includes("allocation-evidence-integrity-v1-8-2-6-8-1-1-3.js");
    add("Previous 1.1.3 test removed", !stale113, stale113 ? "V1.8.2.6.8.1.1.3 residue detected" : "no 1.1.3 test residue in document");

    // 7. The executing asset proves it contains this exact version marker.
    try {
      const selfPath = lineageScripts[0];
      const selfResponse = await fetch(selfPath + "?gbx_lineage_self=" + Date.now(), {cache:"no-store", credentials:"same-origin"});
      const selfText = await selfResponse.text();
      const selfOk = selfResponse.ok && selfText.includes('const VERSION = "' + VERSION + '";') && selfText.includes('const TEST_ID = "' + TEST_ID + '";');
      add("Executing lineage asset identity", selfOk, selfOk ? VERSION : "lineage asset content mismatch");
    } catch (e) {
      add("Executing lineage asset identity", false, e.message || String(e));
    }

    // 8. Hash-prove preserved critical runtime files.
    for (const [path, expected] of Object.entries(EXPECTED)) {
      if (!expected) continue;
      try {
        const actual = await fetchHash(path);
        add("Asset hash · " + path, actual === expected, actual === expected ? "exact hash match" : "EXPECTED=" + expected + " ACTUAL=" + actual);
      } catch (e) {
        add("Asset hash · " + path, false, e.message || String(e));
      }
    }

    // 9. CSS lineage asset is loaded exactly once.
    const lineageCss = paths.filter(p => p.endsWith("css/deployment-lineage.css"));
    add("Lineage CSS uniqueness", lineageCss.length === 1, lineageCss.join(" | ") || "0 lineage CSS assets");

    // 10. No duplicate core runtime asset paths.
    const duplicates = [...new Set(paths.filter(p => p.startsWith("js/")).filter((p, i, a) => a.indexOf(p) !== i))];
    add("Duplicate runtime asset detection", duplicates.length === 0, duplicates.length ? duplicates.join(", ") : "none");

    const blocked = state.checks.filter(c => !c.ok);
    state.status = blocked.length ? "BLOCKED" : "PASSED";
    state.blockingCount = blocked.length;
    state.passCount = state.checks.length - blocked.length;
    state.completed = true;
    state.completedAt = new Date().toISOString();

    render();
    console.group("[GoodsbarnX] " + VERSION + " Deployment Lineage");
    console.log(state);
    console.groupEnd();
  }

  function render() {
    const panel = document.getElementById("gbx-v18268114-lineage-test");
    if (!panel) return;
    panel.classList.add("gbx-lineage-visible");

    const status = panel.querySelector("[data-lineage-status]");
    const metrics = panel.querySelector("[data-lineage-metrics]");
    const output = panel.querySelector("[data-lineage-output]");

    const lines = state.checks.map(c =>
      (c.ok ? "✓ VALID — " : "✕ BLOCK — ") + c.name + (c.evidence ? ": " + c.evidence : "")
    );

    status.className = "gbx-lineage-status " + (state.status === "PASSED" ? "gbx-lineage-pass" : "gbx-lineage-block");
    status.textContent = VERSION + " DEPLOYMENT LINEAGE INTEGRITY " + state.status + "\n\n" + lines.join("\n");
    metrics.innerHTML = '<div class="gbx-lineage-grid"><div class="gbx-lineage-stat"><strong>' + state.passCount + '</strong><span>VALID</span></div><div class="gbx-lineage-stat"><strong>' + state.blockingCount + '</strong><span>BLOCKED</span></div></div>';
    output.textContent = "Deployment lineage only.\nNo Supabase query.\nNo stock mutation.\nNo relationship mutation.\nNo inquiry mutation.\nNo allocation mutation.";
  }

  function mount() {
    render();
    run().catch(error => {
      state.status = "BLOCKED";
      state.completed = true;
      state.blockingCount = (state.blockingCount || 0) + 1;
      const panel = document.getElementById("gbx-v18268114-lineage-test");
      if (panel) {
        panel.classList.add("gbx-lineage-visible");
        const status = panel.querySelector("[data-lineage-status]");
        if (status) {
          status.className = "gbx-lineage-status gbx-lineage-block";
          status.textContent = VERSION + " DEPLOYMENT LINEAGE INTEGRITY BLOCKED\n\n" + (error.message || String(error));
        }
      }
      console.error("[GoodsbarnX] " + VERSION + " lineage boundary", error);
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount, {once:true});
  else mount();
})();
