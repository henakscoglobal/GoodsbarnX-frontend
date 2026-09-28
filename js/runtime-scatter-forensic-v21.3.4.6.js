/* ========================================================================
   GoodsbarnX — V1.8.2.6.21.3.4.6
   RUNTIME SCATTER FORENSIC TEST — READ ONLY

   Purpose: identify the actual layer causing the UI to scatter after rollback.

   This test DOES NOT:
   - change CSS
   - change DOM production surfaces
   - remove elements
   - hide/show application surfaces
   - modify Supabase data
   - modify auth state
   - modify allocation/inquiries/relationships/behaviour

   It only reads the deployed page, loaded assets, DOM, CSSOM, computed layout,
   and same-origin JS/CSS source text. The optional diagnostic panel is the only
   DOM it creates, and it is removed automatically on page unload.

   Run with: ?scattertest=1
   ======================================================================== */
(function () {
  'use strict';

  var VERSION = 'V1.8.2.6.21.3.4.6';
  var MARKER = 'GBX-' + VERSION + '-RUNTIME-SCATTER-FORENSIC';
  var EXPECTED = {
    indexHash: '5fa02527b834a186de06d7b2f5366d7d496e3df945c2ea3c307abf49c76f798c',
    authHash: 'ccf41cbccd591a36dc1a0b86e005fd9fc2c849b2d8c6ae1d3004573014d50cff',
    appHash: '417ac7680ad32233ae3d7013201249fd6075289221b91467c44bf84188337cce',
    mainCssHash: '809cd6d6242a67d08b286e0b0461f2e920385fb49e65c66a2ae4f4856a0d9239',
    componentsCssHash: 'c6295c7423ff53de1db82ad4a55db6c41de669460411f68eaba8fc42cc784d77'
  };

  var REQUIRED_IDS = [
    'app','screen-market','screen-inquiries','screen-network','screen-profile',
    'login-shell','auth-shell','logout-btn-holder','distributor-tools-holder',
    'lock-banner-holder','distributor-list','buyer-list','history-list'
  ];

  var CRITICAL_SELECTORS = [
    '#app','header.top','.screen.active','.hero','.manifest','nav.bottom',
    '.auth-shell','.auth-box','.gbx-dashboard','.depletor-console',
    '.depletor-opportunities','.demand-signal'
  ];

  var DANGEROUS_RUNTIME_MARKERS = [
    'Distributor dashboard — migrated from the old inline runtime.',
    'Distributor dashboard - migrated from the old inline runtime.',
    'gbxDistributorDashboard',
    'loadDistributorDashboard',
    '21.3.4.2: Distributor dashboard runtime migrated to js/market.js',
    'migrated from the old inline runtime'
  ];

  var results = [];
  var running = false;

  function add(id, status, detail, evidence) {
    results.push({ id: id, status: status, detail: detail, evidence: evidence || '' });
  }

  function normalizeText(s) { return String(s || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n'); }

  async function sha256(text) {
    if (!window.crypto || !window.crypto.subtle) return null;
    var data = new TextEncoder().encode(normalizeText(text));
    var digest = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(digest)).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
  }

  function sameOrigin(path) {
    try { return new URL(path, document.baseURI).origin === location.origin; }
    catch (e) { return false; }
  }

  function localScripts() {
    return Array.from(document.scripts).map(function (s) { return s.src || ''; }).filter(function (u) { return u && sameOrigin(u); });
  }

  function countSelector(selector) {
    try { return document.querySelectorAll(selector).length; } catch (e) { return -1; }
  }

  function duplicateIds() {
    var map = {};
    Array.from(document.querySelectorAll('[id]')).forEach(function (el) {
      var id = el.id;
      if (!id) return;
      map[id] = (map[id] || 0) + 1;
    });
    return Object.keys(map).filter(function (id) { return map[id] > 1; }).map(function (id) { return id + ' ×' + map[id]; });
  }

  function visible(el) {
    if (!el) return false;
    var cs = getComputedStyle(el);
    var r = el.getBoundingClientRect();
    return cs.display !== 'none' && cs.visibility !== 'hidden' && parseFloat(cs.opacity || '1') > 0 && r.width > 0 && r.height > 0;
  }

  function layoutSnapshot(selector) {
    var el = document.querySelector(selector);
    if (!el) return { exists: false };
    var cs = getComputedStyle(el), r = el.getBoundingClientRect();
    return {
      exists: true,
      visible: visible(el),
      display: cs.display,
      position: cs.position,
      width: Math.round(r.width * 100) / 100,
      height: Math.round(r.height * 100) / 100,
      left: Math.round(r.left * 100) / 100,
      top: Math.round(r.top * 100) / 100,
      overflowX: cs.overflowX,
      overflowY: cs.overflowY,
      zIndex: cs.zIndex
    };
  }

  function cssRulePresence(selector) {
    var sheets = Array.from(document.styleSheets);
    var hits = 0;
    sheets.forEach(function (sheet) {
      try {
        Array.from(sheet.cssRules || []).forEach(function (rule) {
          if (rule.selectorText && rule.selectorText.split(',').some(function (x) { return x.trim() === selector; })) hits++;
        });
      } catch (e) {}
    });
    return hits;
  }

  async function fetchText(url) {
    try {
      var response = await fetch(url, { cache: 'no-store', credentials: 'same-origin' });
      if (!response.ok) return { ok: false, status: response.status, text: '' };
      return { ok: true, status: response.status, text: await response.text() };
    } catch (e) {
      return { ok: false, status: 0, text: '', error: e.message || String(e) };
    }
  }

  async function assetHash(path, expected, label) {
    var url = new URL(path, document.baseURI).href;
    var r = await fetchText(url);
    if (!r.ok) {
      add(label, 'BLOCKED', 'Asset could not be fetched: HTTP ' + r.status + (r.error ? ' · ' + r.error : ''), url);
      return null;
    }
    var hash = await sha256(r.text);
    var pass = expected && hash === expected;
    add(label, pass ? 'PASS' : 'MISMATCH', pass ? 'Known-good asset hash matches.' : 'Deployed asset differs from the recovered known-good asset.', 'sha256=' + hash + ' expected=' + expected);
    return r.text;
  }

  async function scanRuntimeSources() {
    var scripts = localScripts();
    var findings = [];
    for (var i = 0; i < scripts.length; i++) {
      var url = scripts[i];
      var r = await fetchText(url);
      if (!r.ok) {
        findings.push({ url: url, status: 'FETCH_FAILED', markers: [] });
        continue;
      }
      var markers = DANGEROUS_RUNTIME_MARKERS.filter(function (m) { return r.text.indexOf(m) !== -1; });
      if (markers.length) findings.push({ url: url, status: 'DANGEROUS_MARKER', markers: markers });
    }
    if (!findings.some(function (x) { return x.status === 'DANGEROUS_MARKER'; })) {
      add('runtime-source-scan', 'PASS', 'No known 21.3.4.2 dashboard-migration markers found in loaded same-origin JS assets.', scripts.join(' | '));
    } else {
      findings.filter(function (x) { return x.status === 'DANGEROUS_MARKER'; }).forEach(function (x) {
        add('runtime-source-scan', 'BLOCKED', 'A loaded JS asset still contains a known migrated-dashboard runtime marker.', x.url + ' :: ' + x.markers.join(' || '));
      });
    }
    return findings;
  }

  function checkScriptOrder() {
    var srcs = Array.from(document.scripts).map(function (s) { return s.src ? new URL(s.src, document.baseURI).pathname : '[inline]'; });
    var local = srcs.filter(function (x) { return x.indexOf('/') === 0 && x.indexOf('/js/') !== -1; });
    var config = local.filter(function (x) { return x.endsWith('/js/config.js'); }).length;
    var app = local.filter(function (x) { return x.endsWith('/js/app.js'); }).length;
    var appIndex = local.findIndex(function (x) { return x.endsWith('/js/app.js'); });
    var afterApp = appIndex >= 0 ? local.slice(appIndex + 1) : [];
    var pass = config === 1 && app === 1 && appIndex === local.length - 1;
    add('script-order', pass ? 'PASS' : 'BLOCKED', pass ? 'config.js is present once and app.js is the final local production JS asset.' : 'Production JS ordering is not the recovered contract.', 'local=' + JSON.stringify(local) + ' afterApp=' + JSON.stringify(afterApp));
  }

  function checkStaticStructure() {
    var dup = duplicateIds();
    add('duplicate-ids', dup.length ? 'BLOCKED' : 'PASS', dup.length ? 'Duplicate DOM IDs detected; this can directly cause scattered/incorrect runtime targeting.' : 'No duplicate DOM IDs detected.', dup.join(', '));

    var missing = REQUIRED_IDS.filter(function (id) { return !document.getElementById(id); });
    add('required-dom', missing.length ? 'BLOCKED' : 'PASS', missing.length ? 'Recovered baseline DOM is incomplete.' : 'All required baseline surface IDs are present.', missing.join(', '));

    var counts = {
      sections: document.querySelectorAll('section').length,
      buttons: document.querySelectorAll('button').length,
      divs: document.querySelectorAll('div').length,
      styles: document.querySelectorAll('style').length,
      inlineStyles: document.querySelectorAll('[style]').length
    };
    add('dom-shape', (counts.sections >= 7 && counts.buttons >= 40 && counts.divs >= 330 && counts.styles >= 5) ? 'PASS' : 'MISMATCH', 'Static DOM shape compared with the recovered 21.3.3 baseline envelope.', JSON.stringify(counts));
  }

  function checkCssRuntime() {
    var missingRules = CRITICAL_SELECTORS.filter(function (s) { return cssRulePresence(s) === 0; });
    add('cssom-critical', missingRules.length ? 'BLOCKED' : 'PASS', missingRules.length ? 'Critical selectors are not present in readable CSSOM.' : 'Critical selectors resolve to CSSOM rules.', missingRules.join(', '));

    var snaps = {};
    CRITICAL_SELECTORS.forEach(function (s) { snaps[s] = layoutSnapshot(s); });
    var hiddenCritical = CRITICAL_SELECTORS.filter(function (s) { return snaps[s].exists && !snaps[s].visible && s !== '#app'; });
    add('computed-layout', hiddenCritical.length ? 'BLOCKED' : 'PASS', hiddenCritical.length ? 'Critical rendered surfaces are hidden or have zero geometry.' : 'Critical rendered surfaces have non-zero geometry where expected.', JSON.stringify(snaps));

    var app = layoutSnapshot('#app');
    var body = layoutSnapshot('body');
    add('layout-root', app.exists && body.exists ? 'PASS' : 'BLOCKED', app.exists && body.exists ? 'Root layout surfaces exist.' : 'Body or app root is missing.', JSON.stringify({body:body,app:app}));
  }

  function checkAuthRuntime() {
    var login = document.getElementById('login-shell');
    var auth = document.getElementById('auth-shell');
    var app = document.getElementById('app');
    var state = {
      loginClass: login ? login.className : 'MISSING',
      authClass: auth ? auth.className : 'MISSING',
      appDisplay: app ? getComputedStyle(app).display : 'MISSING',
      currentUser: typeof window.currentUser === 'undefined' ? 'not-global' : !!window.currentUser,
      loadCurrentUser: typeof window.loadCurrentUser,
      handleLogin: typeof window.handleLogin,
      showScreen: typeof window.showScreen
    };
    var contradictory = login && app && !login.classList.contains('hidden') && getComputedStyle(app).display !== 'none';
    add('auth-surface-state', contradictory ? 'BLOCKED' : 'PASS', contradictory ? 'Login shell and app are simultaneously presented.' : 'No contradictory login/app visibility state detected at test time.', JSON.stringify(state));
  }

  async function run() {
    if (running) return;
    running = true;
    results = [];

    checkStaticStructure();
    checkScriptOrder();
    checkCssRuntime();
    checkAuthRuntime();

    await assetHash('index.html', EXPECTED.indexHash, 'asset:index.html');
    await assetHash('js/auth.js', EXPECTED.authHash, 'asset:auth.js');
    await assetHash('js/app.js', EXPECTED.appHash, 'asset:app.js');
    await assetHash('css/main.css', EXPECTED.mainCssHash, 'asset:main.css');
    await assetHash('css/components.css', EXPECTED.componentsCssHash, 'asset:components.css');
    await scanRuntimeSources();

    var blockers = results.filter(function (r) { return r.status === 'BLOCKED' || r.status === 'MISMATCH'; });
    var pass = blockers.length === 0;
    var result = {
      version: VERSION,
      marker: MARKER,
      result: pass ? 'PASS' : 'BLOCKED',
      blockers: blockers.length,
      checks: results.length,
      results: results,
      timestamp: new Date().toISOString()
    };
    window.goodsbarnxRuntimeScatterForensic = result;
    console.group('GoodsbarnX — ' + VERSION + ' — ' + result.result);
    results.forEach(function (r) { console.log((r.status === 'PASS' ? '✓ ' : '✗ ') + r.id + ' — ' + r.detail, r.evidence || ''); });
    console.log('Marker:', MARKER);
    console.log('Full result:', result);
    console.groupEnd();

    if (new URLSearchParams(location.search).get('scattertest') === '1') renderPanel(result);
    running = false;
    return result;
  }

  function renderPanel(result) {
    var old = document.getElementById('gbx-runtime-scatter-forensic-test');
    if (old) old.remove();
    var panel = document.createElement('section');
    panel.id = 'gbx-runtime-scatter-forensic-test';
    panel.style.cssText = 'position:fixed;z-index:2147483647;left:8px;right:8px;bottom:8px;max-height:76vh;overflow:auto;padding:14px;border:2px solid #C88A34;border-radius:14px;background:#12151C;color:#EFE9DE;font:11px/1.45 monospace;box-shadow:0 18px 60px rgba(0,0,0,.45)';
    var title = document.createElement('div');
    title.textContent = VERSION + ' — RUNTIME SCATTER FORENSIC — ' + result.result;
    title.style.cssText = 'font-weight:800;margin-bottom:8px';
    panel.appendChild(title);
    var pre = document.createElement('pre');
    pre.style.cssText = 'white-space:pre-wrap;margin:0';
    pre.textContent = result.results.map(function (r) { return (r.status === 'PASS' ? '✓ ' : '✗ ') + r.status + ' · ' + r.id + '\n  ' + r.detail + (r.evidence ? '\n  ' + r.evidence : ''); }).join('\n\n');
    panel.appendChild(pre);
    document.body.appendChild(panel);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run, { once: true });
  else run();
})();
