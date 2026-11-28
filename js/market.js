// ==========================================================================
// GoodsbarnX — market.js  (rev. 10 · Industry-Grade Network Dashboard)
// Plain global script. Loads fourth (Canon §10).
//
// The market is not a directory. It is a live, actionable view of your
// relationship graph.
//   - Desk: High-priority actions (requests, unanswered inquiries).
//   - Network: Your established partners, rendered as rich contextual cards.
//   - Discover: Verified nodes ranked by proximity and trust.
//   - Retail: A visually distinct B2C discovery grid for consumers.
//
// Architecture & Security:
//   - Strict delegated click/change handlers (no inline JS).
//   - Full UUID & phone validation before actions.
//   - XSS escaping on all interpolated data.
//   - Auto-cleans stale graph caches on role switch.
//   - Enrichment logic handles all 10 relationship states.
// ==========================================================================

// ==========================================================================
// SAFE PRIMITIVES
// ==========================================================================

function escHtml(v) {
  return String(v == null ? "" : v)
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
function escAttr(v) { return escHtml(v); }

// UUID v4 validation
var __MARKET_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function isValidUuid(v) { return typeof v === "string" && __MARKET_UUID_RE.test(v); }

// Nigerian phone normalization (234XXXXXXXXXX)
var __MARKET_NG_CANON_RE = /^234[789][01]\d{8}$/;
function normalizeNgPhone(v) {
  var d = String(v || "").replace(/\D/g, "");
  if (d.length === 10 && /^[789]/.test(d)) d = "234" + d;
  else if (d.length === 11 && d.charAt(0) === "0") d = "234" + d.slice(1);
  return __MARKET_NG_CANON_RE.test(d) ? d : "";
}
function isValidNgPhone(v) { return normalizeNgPhone(v) !== ""; }

const __gbxMarketWarnedTargets = Object.create(null);
function warnMissingTarget(id) {
  if (__gbxMarketWarnedTargets[id]) return;
  __gbxMarketWarnedTargets[id] = true;
  console.warn("[GoodsbarnX/market] DOM target #" + id + " is missing from index.html.");
}

// ==========================================================================
// GLOBAL STATE ACCESSORS
// ==========================================================================

var allRetailers = [];

function gmUser() {
  try { return (typeof currentUser !== "undefined" && currentUser) ? currentUser : null; } catch (e) { return null; }
}
function gmRole() { var u = gmUser(); return (u && u.role) || "guest"; }
function gmDists() {
  try { return (typeof allDistributors !== "undefined" && Array.isArray(allDistributors)) ? allDistributors : []; } catch (e) { return []; }
}
function gmBuyers() {
  try { return (typeof allBuyers !== "undefined" && Array.isArray(allBuyers)) ? allBuyers : []; } catch (e) { return []; }
}
function gmRetailers() {
  try { return (typeof allRetailers !== "undefined" && Array.isArray(allRetailers)) ? allRetailers : []; } catch (e) { return []; }
}
function gmCategory() {
  try { return (typeof activeCategory !== "undefined" && activeCategory) ? activeCategory : "All"; } catch (e) { return "All"; }
}
function gmIsFav(id) {
  try {
    return (typeof userFavourites !== "undefined" && userFavourites && typeof userFavourites.has === "function")
      ? !!userFavourites.has(id) : false;
  } catch (e) { return false; }
}
function gmUserCity() {
  var u = gmUser();
  if (!u) return "";
  return String(u.location || (u.profile && u.profile.location) || "").trim();
}

// ==========================================================================
// TIME & DATE HELPERS
// ==========================================================================

function gmDaysSince(iso) {
  var t = Date.parse(iso);
  if (!isFinite(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 86400000));
}
function gmAgo(iso) {
  var t = Date.parse(iso);
  if (!isFinite(t)) return "";
  var ms = Math.max(0, Date.now() - t);
  var m = Math.floor(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return m + "m ago";
  var h = Math.floor(m / 60);
  if (h < 24) return h + "h ago";
  var d = Math.floor(h / 24);
  if (d < 30) return d + "d ago";
  return Math.floor(d / 30) + "mo ago";
}
function gmTenure(iso) {
  var t = Date.parse(iso);
  if (!isFinite(t)) return "";
  var dt = new Date(t);
  var months = Math.max(0, Math.floor((Date.now() - t) / (86400000 * 30.4)));
  var since = dt.toLocaleDateString("en-NG", { month: "short", year: "numeric" });
  var span = months < 1 ? "new" : (months < 12 ? months + " mo" : (Math.floor(months / 12) + " yr"));
  return "Partner since " + since + " · " + span;
}
function formatMarketAge(ms) {
  if (ms == null) return "";
  var m = Math.floor(ms / 60000);
  if (m < 1) return "<1m";
  if (m < 60) return m + "m";
  var h = Math.floor(m / 60);
  if (h < 24) return h + "h";
  return Math.floor(h / 24) + "d";
}

// ==========================================================================
// ICONS & SVGs
// ==========================================================================

var MK_ICONS = {
  shield:  '<path d="M12 3l7 3v5.5c0 4.2-3 7.7-7 9-4-1.3-7-4.8-7-9V6l7-3z"/><path d="M9 12l2 2 4-4"/>',
  pin:     '<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>',
  store:   '<path d="M3 9h18l-1.4 10.1A2 2 0 0 1 17.6 21H6.4a2 2 0 0 1-2-1.9L3 9z"/><path d="M8.5 9V7a3.5 3.5 0 0 1 7 0v2"/>',
  chat:    '<path d="M20 12a8 8 0 0 1-11.6 7.1L4 20l1-4A8 8 0 1 1 20 12z"/>',
  msg:     '<path d="M4 5h16v11H9l-5 4V5z"/>',
  heart:   '<path d="M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.6 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z"/>',
  link:    '<circle cx="8" cy="9" r="3"/><circle cx="16" cy="15" r="3"/><path d="M10.5 11l3 2"/>',
  clock:   '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  userplus:'<circle cx="10" cy="8" r="3.3"/><path d="M3.5 19c0-3.4 2.9-5.5 6.5-5.5s6.5 2.1 6.5 5.5"/><path d="M19 8v6M16 11h6"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14-4L4 9"/><path d="M4 4v5h5"/><path d="M4 13a8 8 0 0 0 14 4l2-2"/><path d="M20 20v-5h-5"/>',
  bolt:    '<path d="M13 3L5 13h6l-1 8 8-10h-6l1-8z"/>',
  edit:    '<path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/>',
  user:    '<circle cx="12" cy="8" r="3.5"/><path d="M4.5 20c0-3.6 3.2-6 7.5-6s7.5 2.4 7.5 6"/>',
  alert:   '<path d="M12 4l9 16H3L12 4z"/><path d="M12 10v4M12 17.2v.1"/>'
};

function ico(name, size) {
  var s = size || 16;
  return '<svg class="mk-i" width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (MK_ICONS[name] || "") + '</svg>';
}

function mkFavIcon(on) {
  return '<svg class="mk-i mk-heart' + (on ? " is-on" : "") + '" width="20" height="20" viewBox="0 0 24 24" ' +
    'fill="' + (on ? "currentColor" : "none") + '" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    MK_ICONS.heart + '</svg>';
}

const MARKET_ICON_SVG = '<svg class="mk-i" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 9h18l-1.4 10.1A2 2 0 0 1 17.6 21H6.4a2 2 0 0 1-2-1.9L3 9z"/><path d="M8.5 9V7a3.5 3.5 0 0 1 7 0v2"/></svg>';
const BUYER_ICON_SVG = '<svg class="mk-i" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="3.5"/><path d="M4.5 20c0-3.6 3.2-6 7.5-6s7.5 2.4 7.5 6"/></svg>';

// ==========================================================================
// ELITE CSS ENGINE (Scoped under #screen-market .mk-)
// ==========================================================================

var MK_CSS = [
"#screen-market{--mk-bg:#0b1121;--mk-card:#151c2c;--mk-card2:#1e2940;--mk-line:rgba(255,255,255,0.08);--mk-line2:rgba(255,255,255,0.16);--mk-tx:#f8fafc;--mk-mut:#94a3b8;--mk-grn:#10b981;--mk-grnd:#059669;--mk-gold:#f59e0b;--mk-blue:#3b82f6;--mk-red:#ef4444;--mk-radius:16px}",
"#screen-market .mk-i{flex:0 0 auto;display:inline-block;vertical-align:middle}",
"#screen-market .mk-mute{color:var(--mk-mut)}",

/* Horizontal Rail (Categories) */
"#screen-market .category-grid{display:flex;gap:10px;overflow-x:auto;margin:0 0 16px;padding:4px 0 12px;scrollbar-width:none}",
"#screen-market .category-grid::-webkit-scrollbar{display:none}",
"#screen-market .category-card{flex:0 0 auto;display:inline-flex;align-items:center;gap:8px;padding:10px 16px;border-radius:12px;background:var(--mk-card);border:1px solid var(--mk-line);font-size:0;line-height:1;transition:all .2s}",
"#screen-market .category-card span{font-size:13px;font-weight:600;color:var(--mk-mut);margin:0}",
"#screen-market .category-card.active{border-color:var(--mk-grn);background:rgba(16,185,129,.1)}",
"#screen-market .category-card.active span{color:var(--mk-tx)}",
"#screen-market .category-card .mk-cat-n{font:600 10px/1 'DM Mono',monospace;color:var(--mk-tx);background:rgba(255,255,255,.1);padding:4px 6px;border-radius:6px}",

/* Layout & Search */
"#screen-market .search-bar-wrap{background:var(--mk-card);border:1px solid var(--mk-line);border-radius:14px;padding:12px 16px;margin-bottom:16px}",
"#screen-market .search-bar-wrap input{color:var(--mk-tx);font-size:14px}",
"#screen-market .adv-filters{display:none}",
"#screen-market .mk-toolbar{display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:12px}",
"#screen-market .mk-chips{display:flex;gap:8px;overflow-x:auto;scrollbar-width:none}",
"#screen-market .mk-chip{display:inline-flex;align-items:center;gap:6px;padding:8px 14px;border-radius:999px;background:var(--mk-card);border:1px solid var(--mk-line);color:var(--mk-mut);font:500 12px/1 'Inter',sans-serif;cursor:pointer;transition:all .2s}",
"#screen-market .mk-chip[aria-pressed=true]{background:rgba(16,185,129,.15);border-color:var(--mk-grn);color:var(--mk-grn)}",
"#screen-market .mk-sort select{background:var(--mk-card);color:var(--mk-tx);border:1px solid var(--mk-line);border-radius:10px;padding:8px 12px;font:500 12px/1 'Inter',sans-serif;outline:none}",

/* Desk / Action Center */
"#screen-market .mk-desk{background:linear-gradient(145deg,rgba(16,185,129,.1),rgba(15,23,42,.6));border:1px solid rgba(16,185,129,.3);border-radius:var(--mk-radius);padding:16px;margin-bottom:20px;box-shadow:0 8px 32px rgba(0,0,0,.2)}",
"#screen-market .mk-desk-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}",
"#screen-market .mk-desk-title{font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--mk-grn);display:flex;align-items:center;gap:6px}",
"#screen-market .mk-desk-title::before{content:'';width:6px;height:6px;background:var(--mk-grn);border-radius:50%;box-shadow:0 0 0 3px rgba(16,185,129,.2)}",
"#screen-market .mk-att{list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:10px}",
"#screen-market .mk-att-item{display:flex;align-items:center;gap:12px;background:var(--mk-card);border:1px solid var(--mk-line);border-radius:12px;padding:12px}",
"#screen-market .mk-att-ic{width:36px;height:36px;border-radius:10px;display:grid;place-items:center;background:rgba(255,255,255,.05);color:var(--mk-mut)}",
"#screen-market .mk-att-item[data-tone=warn] .mk-att-ic{background:rgba(245,158,11,.15);color:var(--mk-gold)}",
"#screen-market .mk-att-item[data-tone=info] .mk-att-ic{background:rgba(59,130,246,.15);color:var(--mk-blue)}",
"#screen-market .mk-att-item[data-tone=ok] .mk-att-ic{background:rgba(16,185,129,.15);color:var(--mk-grn)}",
"#screen-market .mk-att-body{flex:1;min-width:0}",
"#screen-market .mk-att-title{font-size:13px;font-weight:600;color:var(--mk-tx)}",
"#screen-market .mk-att-meta{font-size:11px;color:var(--mk-mut);margin-top:2px}",

/* Section Heads */
"#screen-market .mk-sec{display:flex;align-items:baseline;gap:10px;margin:24px 0 12px}",
"#screen-market .mk-sec:first-child{margin-top:0}",
"#screen-market .mk-sec-title{font-size:14px;font-weight:700;color:var(--mk-tx);letter-spacing:-.01em}",
"#screen-market .mk-sec-count{font:600 11px/1 'DM Mono',monospace;color:var(--mk-grn);background:rgba(16,185,129,.1);padding:2px 8px;border-radius:999px}",
"#screen-market .mk-sec-hint{font-size:11px;color:var(--mk-mut);margin-left:auto}",

/* Rich Cards */
"#screen-market .mk-card{background:var(--mk-card);border:1px solid var(--mk-line);border-radius:var(--mk-radius);padding:16px;margin-bottom:12px;transition:border-color .2s,box-shadow .2s}",
"#screen-market .mk-card[data-rel=active]{border-color:rgba(16,185,129,.4);background:linear-gradient(180deg,rgba(16,185,129,.05),var(--mk-card) 40%)}",
"#screen-market .mk-card[data-rel=pending_in],#screen-market .mk-card[data-rel=pending_out]{border-color:rgba(59,130,246,.4)}",
"#screen-market .mk-card[data-rel=paused],#screen-market .mk-card[data-rel=suspended]{border-color:rgba(245,158,11,.3)}",
"#screen-market .mk-card[data-rel=self]{border-style:dashed;border-color:var(--mk-line2)}",
"#screen-market .mk-head{display:flex;align-items:flex-start;gap:14px}",
"#screen-market .mk-av{flex:0 0 auto;width:46px;height:46px;border-radius:14px;display:grid;place-items:center;font:700 15px/1 'Inter',sans-serif;color:#0F172A;letter-spacing:-.02em}",
"#screen-market .mk-av-0{background:#6ee7b7}#screen-market .mk-av-1{background:#fcd34d}#screen-market .mk-av-2{background:#93c5fd}#screen-market .mk-av-3{background:#f9a8d4}#screen-market .mk-av-4{background:#cbd5e1}",
"#screen-market .mk-id{flex:1;min-width:0}",
"#screen-market .mk-name{font-size:16px;font-weight:700;color:var(--mk-tx);line-height:1.2;margin-bottom:2px}",
"#screen-market .mk-loc{display:flex;align-items:center;gap:4px;font-size:12px;color:var(--mk-mut)}",
"#screen-market .mk-tenure{font-size:11px;color:var(--mk-grn);font-weight:500;margin-top:4px}",
"#screen-market .mk-fav{flex:0 0 auto;width:40px;height:40px;margin:-8px -8px 0 0;display:grid;place-items:center;background:none;border:none;color:var(--mk-mut);cursor:pointer}",
"#screen-market .mk-fav .mk-heart.is-on{color:var(--mk-red)}",

/* Tags */
"#screen-market .mk-tags{display:flex;flex-wrap:wrap;gap:6px;margin-top:14px}",
"#screen-market .mk-tag{display:inline-flex;align-items:center;gap:4px;padding:5px 10px;border-radius:6px;font:600 10px/1 'DM Mono',monospace;letter-spacing:.04em;text-transform:uppercase}",
"#screen-market .mk-tag--ok{background:rgba(16,185,129,.15);color:#6ee7b7}",
"#screen-market .mk-tag--blue{background:rgba(59,130,246,.15);color:#93c5fd}",
"#screen-market .mk-tag--gold{background:rgba(245,158,11,.15);color:#fcd34d}",
"#screen-market .mk-tag--mut{background:rgba(255,255,255,.06);color:var(--mk-mut)}",

/* Buttons */
"#screen-market .mk-acts{display:flex;gap:10px;margin-top:16px}",
"#screen-market .mk-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:42px;padding:0 16px;border-radius:10px;border:1px solid var(--mk-line2);background:transparent;color:var(--mk-tx);font:600 13px/1 'Inter',sans-serif;cursor:pointer;transition:transform .1s,background .2s}",
"#screen-market .mk-btn:active{transform:scale(.97)}",
"#screen-market .mk-btn--pri{background:var(--mk-grnd);border-color:var(--mk-grnd);color:#fff;flex:1}",
"#screen-market .mk-btn--gst{flex:1}",
"#screen-market .mk-btn--wa{flex:0 0 42px;padding:0;background:rgba(16,185,129,.15);border-color:rgba(16,185,129,.3);color:#6ee7b7}",
"#screen-market .mk-btn--sm{min-height:32px;padding:0 12px;font-size:12px;border-radius:8px;flex:0 0 auto}",

/* Segments */
"#screen-market .mk-seg{display:flex;gap:8px;margin-bottom:16px;overflow-x:auto;padding-bottom:4px;scrollbar-width:none}",
"#screen-market .mk-seg button{flex:0 0 auto;padding:8px 16px;border-radius:999px;background:var(--mk-card);border:1px solid var(--mk-line);color:var(--mk-mut);font:500 12px/1 'Inter',sans-serif;cursor:pointer}",
"#screen-market .mk-seg button[aria-pressed=true]{background:rgba(16,185,129,.15);border-color:var(--mk-grn);color:var(--mk-grn);font-weight:600}",

/* Empty States */
"#screen-market .mk-empty{text-align:center;padding:40px 20px;color:var(--mk-mut)}",
"#screen-market .mk-empty svg{opacity:.5;margin-bottom:12px}",
"#screen-market .mk-empty h4{font-size:16px;color:var(--mk-tx);margin:0 0 4px}",
"#screen-market .mk-empty p{font-size:13px;margin:0 0 16px}",
"@media(max-width:480px){#screen-market .mk-acts{flex-wrap:wrap}#screen-market .mk-btn--pri{flex:1 0 100%}}"
].join("\n");

function ensureMarketStyles() {
  if (document.getElementById("mk-style")) return;
  var s = document.createElement("style");
  s.id = "mk-style";
  s.textContent = MK_CSS;
  (document.head || document.documentElement).appendChild(s);
}

// ==========================================================================
// GRAPH & ENRICHMENT ENGINE
// ==========================================================================

const __gbxMarketGraph = {
  viewerRole: "guest", viewerId: null, myRelationships: [], myPendingInbound: [],
  myPendingOutbound: [], contactedSet: new Set(), myInquiries: Object.create(null),
  loaded: false, loadedAt: 0
};
var GM_GRAPH_TTL_MS = 45 * 1000;

function validateGraphRows(rows, expectField) {
  if (!Array.isArray(rows)) return [];
  return rows.filter(function (r) { return r && typeof r === "object" && isValidUuid(r[expectField]); });
}
function marketInvalidateGraph() { __gbxMarketGraph.loaded = false; __gbxMarketGraph.loadedAt = 0; }
function gmGraphIsCurrent() { var u = gmUser(); return __gbxMarketGraph.loaded && __gbxMarketGraph.viewerId === (u ? u.id : null) && (Date.now() - __gbxMarketGraph.loadedAt) < GM_GRAPH_TTL_MS; }
function gmGraph() {
  var u = gmUser();
  if (__gbxMarketGraph.viewerId !== (u ? u.id : null)) return { myRelationships: [], myPendingInbound: [], myPendingOutbound: [], contactedSet: new Set(), myInquiries: Object.create(null) };
  return __gbxMarketGraph;
}

async function loadMarketGraph() {
  var u = gmUser();
  var G = __gbxMarketGraph;
  G.viewerRole = (u && u.role) || "guest"; G.viewerId = u ? u.id : null;
  G.myRelationships = []; G.myPendingInbound = []; G.myPendingOutbound = [];
  G.contactedSet = new Set(); G.myInquiries = Object.create(null);

  if (!u || !window.sb) { G.loaded = true; G.loadedAt = Date.now(); return; }

  try {
    if (u.role === "buyer") {
      const res = await Promise.all([
        sb.from("trade_relationships").select("distributor_id,status,is_primary,relationship_started_at").eq("buyer_id", u.id),
        sb.from("buyer_locks").select("distributor_id,created_at").eq("buyer_id", u.id).eq("status", "pending_consent"),
        sb.from("inquiries").select("distributor_id,status,created_at").eq("buyer_id", u.id).order("created_at", { ascending: false }).limit(100)
      ]);
      validateGraphRows(res[0].data || [], "distributor_id").forEach(r => G.myRelationships.push({ distributor_id: r.distributor_id, status: String(r.status || "").toLowerCase(), is_primary: !!r.is_primary, since: r.relationship_started_at }));
      validateGraphRows(res[1].data || [], "distributor_id").forEach(l => G.myPendingInbound.push({ distributor_id: l.distributor_id, created_at: l.created_at }));
      (res[2].data || []).forEach(q => {
        var k = q.distributor_id;
        var rec = G.myInquiries[k] || (G.myInquiries[k] = { total: 0, pending: 0, lastAt: null, lastPendingAt: null });
        rec.total++;
        if (String(q.status || "").toLowerCase() === "pending") { rec.pending++; rec.lastPendingAt = q.created_at; }
      });
    } else if (u.role === "distributor") {
      const res = await Promise.all([
        sb.from("trade_relationships").select("buyer_id,status,is_primary,relationship_started_at").eq("distributor_id", u.id),
        sb.from("buyer_locks").select("buyer_id,created_at").eq("distributor_id", u.id).eq("status", "pending_consent"),
        sb.from("inquiries").select("buyer_id").eq("distributor_id", u.id)
      ]);
      validateGraphRows(res[0].data || [], "buyer_id").forEach(r => G.myRelationships.push({ buyer_id: r.buyer_id, status: String(r.status || "").toLowerCase(), is_primary: !!r.is_primary, since: r.relationship_started_at }));
      validateGraphRows(res[1].data || [], "buyer_id").forEach(l => G.myPendingOutbound.push({ buyer_id: l.buyer_id, created_at: l.created_at }));
      (res[2].data || []).forEach(x => { if (isValidUuid(x.buyer_id)) G.contactedSet.add(x.buyer_id); });
    }
  } catch (err) { console.warn("[GoodsbarnX/market] loadMarketGraph failed:", err); }
  G.loaded = true; G.loadedAt = Date.now();
}

var MK_TIER_RANK = { "association": 3, "market board": 2, "self-attested": 1 };
function mkTierRank(d) { return MK_TIER_RANK[String((d && d.verification_tier) || "").toLowerCase()] || 0; }
function mkSameCity(d) { var c = gmUserCity().toLowerCase(); return !!c && String((d && d.location) || "").trim().toLowerCase() === c; }
function mkPhoneOf(d) { return (d && d.profiles && d.profiles.phone) || ""; }

function enrichDist(d) {
  var u = gmUser();
  if (u && d.id === u.id) return { rel: "self", label: "Your listing" };
  
  var G = gmGraph();
  var rel = G.myRelationships.find(r => r.distributor_id === d.id);
  var pend = G.myPendingInbound.find(p => p.distributor_id === d.id);
  var iq = G.myInquiries[d.id];

  if (rel) {
    if (rel.status === "active") return { rel: "active", label: rel.is_primary ? "Primary relationship" : "Active relationship", since: rel.since };
    if (rel.status === "pending") return { rel: "pending_out", label: "Request sent" };
    return { rel: rel.status, label: rel.status.charAt(0).toUpperCase() + rel.status.slice(1), since: rel.since };
  }
  if (pend) return { rel: "pending_in", label: "Wants to connect", since: pend.created_at };
  if (iq && iq.pending > 0) return { rel: "none", label: null, inquiry: iq };
  return { rel: "none", label: null };
}

function enrichBuyer(b) {
  var G = gmGraph();
  var rel = G.myRelationships.find(r => r.buyer_id === b.id);
  var pend = G.myPendingOutbound.find(p => p.buyer_id === b.id);
  var cont = G.contactedSet.has(b.id);

  if (rel && rel.status === "active") return { rel: "active", label: rel.is_primary ? "Primary relationship" : "Active relationship", since: rel.since };
  if (rel && rel.status === "pending") return { rel: "pending_in", label: "Requested to connect", since: rel.since };
  if (pend) return { rel: "pending_out", label: "Invitation sent", since: pend.created_at };
  if (cont) return { rel: "contacted", label: "Prior contact" };
  return { rel: "none", label: null };
}

function mkFindDist(id) { return gmDists().find(x => x.id === id); }
function mkFindBuyer(id) { return gmBuyers().find(x => x.id === id); }
function mkDistName(id) { var d = mkFindDist(id); return d ? d.business_name : "Distributor"; }
function mkBuyerName(id) { var b = mkFindBuyer(id); return b ? (b.name || (b.profiles && b.profiles.full_name)) : "Buyer"; }

// ==========================================================================
// UI RENDERING ENGINE
// ==========================================================================

var __mk = { 
  sort: "best", 
  chips: { network: false, verified: false, saved: false }, 
  segment: "all", 
  loadError: null,
  enrich: Object.create(null),
  enrichB: Object.create(null)
};

function gmSegmentOf(e) {
  switch (e.rel) {
    case "active": case "paused": case "suspended": case "pending_in": return "network";
    case "pending_out": return "invited";
    case "contacted": case "released": case "terminated": return "prior";
    default: return "new";
  }
}

function ensureMarketUI() {
  var screen = document.getElementById("screen-market");
  if (!screen) return;
  ensureMarketStyles();

  if (!document.getElementById("mk-toolbar")) {
    var bar = document.createElement("div");
    bar.id = "mk-toolbar";
    bar.className = "mk-toolbar";
    bar.innerHTML =
      '<div class="mk-chips">' +
        '<button class="mk-chip" data-mk-action="chip" data-chip="network" aria-pressed="false">' + ico("link", 14) + 'My Network</button>' +
        '<button class="mk-chip" data-mk-action="chip" data-chip="verified" aria-pressed="false">' + ico("shield", 14) + 'Verified</button>' +
        '<button class="mk-chip" data-mk-action="chip" data-chip="saved" aria-pressed="false">' + ico("heart", 14) + 'Saved</button>' +
      '</div>' +
      '<div class="mk-sort"><select id="mk-sort-select" data-mk-sort="1"><option value="best">Best Match</option><option value="nearest">Nearest</option><option value="trusted">Most Trusted</option><option value="az">A-Z</option></select></div>';
    var list = document.getElementById("distributor-list");
    if (list && list.parentNode) list.parentNode.insertBefore(bar, list);
  }

  if (!document.getElementById("mk-desk-host")) {
    var desk = document.createElement("div");
    desk.id = "mk-desk-host";
    var anchor = screen.querySelector(".search-bar-wrap") || document.getElementById("distributor-list");
    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(desk, anchor);
  }
}

function mkEmptyState(title, text, btn, icon) {
  return '<div class="mk-empty">' + (icon || MARKET_ICON_SVG) + '<h4>' + escHtml(title) + '</h4><p>' + escHtml(text) + '</p>' + (btn || "") + '</div>';
}

function mkSecHead(title, count, hint) {
  return '<div class="mk-sec"><span class="mk-sec-title">' + escHtml(title) + '</span>' +
    (count !== null ? '<span class="mk-sec-count">' + escHtml(count) + '</span>' : '') +
    (hint ? '<span class="mk-sec-hint">' + escHtml(hint) + '</span>' : '') + '</div>';
}

// --- Desk & Alerts ---
function renderDesk() {
  var host = document.getElementById("mk-desk-host");
  if (!host) return;
  var role = gmRole();
  
  if (role === "consumer") {
    host.innerHTML = '<div class="mk-desk"><div class="mk-desk-head"><div class="mk-desk-title">Retail Discovery</div></div>' +
      '<p style="font-size:13px;color:var(--mk-mut);margin:0;line-height:1.5;">Select a retailer below to purchase individual units. Local pickup and delivery options available.</p></div>';
    return;
  }

  if (role === "guest") {
    host.innerHTML = '<div class="mk-desk"><div class="mk-desk-head"><div class="mk-desk-title">Network Access</div></div>' +
      '<p style="font-size:13px;color:var(--mk-mut);margin:0 0 12px;line-height:1.5;">Log in to see your live relationship graph, pending invites, and trade terms.</p>' +
      '<button class="mk-btn mk-btn--pri" data-mk-action="login">Log in to network</button></div>';
    return;
  }

  var G = gmGraph();
  var items = [];
  
  if (role === "buyer") {
    G.myPendingInbound.forEach(p => {
      var d = mkFindDist(p.distributor_id); if (!d) return;
      items.push({ tone: "info", icon: "link", title: d.business_name + " wants to connect", meta: "Connection request", btn: '<button class="mk-btn mk-btn--pri mk-btn--sm" data-mk-action="review-requests">Review</button>' });
    });
    Object.keys(G.myInquiries).forEach(did => {
      var iq = G.myInquiries[did]; var d = mkFindDist(did);
      if (!d || iq.pending < 1) return;
      items.push({ tone: "warn", icon: "clock", title: d.business_name + " hasn't replied", meta: "Inquiry sent " + gmAgo(iq.lastPendingAt), btn: '<button class="mk-btn mk-btn--wa mk-btn--sm" data-mk-action="nudge" data-dist="' + d.id + '">' + ico("chat", 14) + '</button>' });
    });
    G.myRelationships.forEach(r => {
      if (r.status !== "paused" && r.status !== "released") return;
      var d = mkFindDist(r.distributor_id); if (!d) return;
      items.push({ tone: "gold", icon: "refresh", title: "Rekindle with " + d.business_name, meta: "Relationship " + r.status, btn: '<button class="mk-btn mk-btn--pri mk-btn--sm" data-mk-action="rekindle" data-dist="' + d.id + '">Resume</button>' });
    });
  } else if (role === "distributor") {
    G.myPendingOutbound.forEach(p => {
      var b = mkFindBuyer(p.buyer_id); if (!b) return;
      items.push({ tone: "warn", icon: "clock", title: "Invite to " + (b.name || "Buyer") + " pending", meta: "Sent " + gmAgo(p.created_at), btn: '<button class="mk-btn mk-btn--wa mk-btn--sm" data-mk-action="nudge-buyer" data-buyer="' + b.id + '">' + ico("chat", 14) + '</button>' });
    });
  }

  if (!items.length) { host.innerHTML = ''; return; }

  host.innerHTML = '<div class="mk-desk"><div class="mk-desk-head"><div class="mk-desk-title">Relationship Desk</div></div>' +
    '<ul class="mk-att">' + items.slice(0, 4).map(i => 
      '<li class="mk-att-item" data-tone="' + i.tone + '"><div class="mk-att-ic">' + ico(i.icon, 18) + '</div>' +
      '<div class="mk-att-body"><div class="mk-att-title">' + escHtml(i.title) + '</div><div class="mk-att-meta">' + escHtml(i.meta) + '</div></div>' +
      i.btn + '</li>'
    ).join("") + '</ul></div>';
}

// --- Cards ---
function gmHue(id) {
  var h = 0, s = String(id || "");
  for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 5;
}
function gmInitials(name) {
  var parts = String(name || "").replace(/[\u0000-\u001F\u007F-\u009F]/g, "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts.length === 1 ? parts[0].slice(0, 2) : parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase();
}

function renderDistCard(d) {
  var e = enrichDist(d);
  var phoneOk = isValidNgPhone(mkPhoneOf(d));
  var fav = gmIsFav(d.id);
  
  var loc = (d.location ? ico("pin", 12) + d.location : "No location");
  var tags = '';
  if (e.label && e.rel !== 'self') tags += '<span class="mk-tag ' + (e.rel === 'active' ? 'mk-tag--ok' : 'mk-tag--blue') + '">' + e.label + '</span>';
  if (d.verification_tier) tags += '<span class="mk-tag mk-tag--gold">' + ico("shield", 10) + d.verification_tier + '</span>';
  if (d.category) tags += '<span class="mk-tag mk-tag--mut">' + d.category + '</span>';
  if (e.inquiry && e.inquiry.pending > 0) tags += '<span class="mk-tag mk-tag--gold">' + ico("clock", 10) + 'Pending reply</span>';

  var acts = '';
  if (e.rel === 'self') {
    acts = '<button class="mk-btn mk-btn--gst" data-mk-action="edit-profile">Edit profile</button><button class="mk-btn mk-btn--pri" data-mk-action="storefront" data-dist="' + d.id + '">View storefront</button>';
  } else if (e.rel === 'active') {
    acts = '<button class="mk-btn mk-btn--pri" data-mk-action="storefront" data-dist="' + d.id + '">Storefront</button>' +
           '<button class="mk-btn mk-btn--gst" data-mk-action="inquire" data-dist="' + d.id + '">Inquire</button>' +
           (phoneOk ? '<button class="mk-btn mk-btn--wa" data-mk-action="whatsapp" data-dist="' + d.id + '">' + ico("chat", 16) + '</button>' : '');
  } else if (e.rel === 'pending_in') {
    acts = '<button class="mk-btn mk-btn--pri" data-mk-action="review-requests">Review request</button>';
  } else if (e.rel === 'pending_out') {
    acts = '<button class="mk-btn mk-btn--pri" data-mk-action="storefront" data-dist="' + d.id + '">Storefront</button>' +
           '<button class="mk-btn mk-btn--gst" data-mk-action="inquire" data-dist="' + d.id + '">Inquire</button>';
  } else {
    acts = '<button class="mk-btn mk-btn--gst" data-mk-action="storefront" data-dist="' + d.id + '">Storefront</button>' +
           '<button class="mk-btn mk-btn--pri" data-mk-action="inquire" data-dist="' + d.id + '">Inquire</button>' +
           (phoneOk ? '<button class="mk-btn mk-btn--wa" data-mk-action="whatsapp" data-dist="' + d.id + '">' + ico("chat", 16) + '</button>' : '');
  }

  return '<article class="mk-card" data-rel="' + e.rel + '">' +
    '<div class="mk-head">' +
      '<div class="mk-av mk-av-' + gmHue(d.id) + '">' + escHtml(gmInitials(d.business_name)) + '</div>' +
      '<div class="mk-id">' +
        '<div class="mk-name">' + escHtml(d.business_name) + '</div>' +
        '<div class="mk-loc">' + loc + '</div>' +
        (e.since && e.rel === 'active' ? '<div class="mk-tenure">' + escHtml(gmTenure(e.since)) + '</div>' : '') +
      '</div>' +
      (e.rel === 'self' ? '' : '<button class="mk-fav" data-mk-action="fav" data-dist="' + d.id + '">' + mkFavIcon(fav) + '</button>') +
    '</div>' +
    '<div class="mk-tags">' + tags + '</div>' +
    '<div class="mk-acts">' + acts + '</div>' +
  '</article>';
}

function renderBuyerCard(b) {
  var e = enrichBuyer(b);
  var name = b.name || (b.profiles && b.profiles.full_name) || "Buyer";
  var loc = (b.location ? ico("pin", 12) + b.location : "No location");
  var phoneOk = isValidNgPhone(b.profiles && b.profiles.phone);

  var tags = '';
  if (e.label) tags += '<span class="mk-tag ' + (e.rel === 'active' ? 'mk-tag--ok' : 'mk-tag--blue') + '">' + e.label + (e.since && e.rel === 'active' ? ' · ' + gmTenure(e.since) : '') + '</span>';
  tags += '<span class="mk-tag mk-tag--gold">' + (b.looking_for || "General") + '</span>';

  var acts = '';
  if (e.rel === 'none' || e.rel === 'contacted') {
    acts = '<button class="mk-btn mk-btn--pri" data-mk-action="invite-buyer" data-buyer="' + b.id + '">Invite</button>';
  } else if (e.rel === 'active') {
    acts = '<button class="mk-btn mk-btn--pri" data-mk-action="inquire-buyer" data-buyer="' + b.id + '">Inquire</button>' +
           (phoneOk ? '<button class="mk-btn mk-btn--wa" data-mk-action="whatsapp-buyer" data-buyer="' + b.id + '">' + ico("chat", 16) + '</button>' : '');
  } else if (e.rel === 'pending_out') {
    acts = '<button class="mk-btn mk-btn--gst" data-mk-action="inquire-buyer" data-buyer="' + b.id + '">Inquire</button>';
  }

  return '<article class="mk-card" data-rel="' + e.rel + '">' +
    '<div class="mk-head">' +
      '<div class="mk-av mk-av-' + gmHue(b.id) + '">' + escHtml(gmInitials(name)) + '</div>' +
      '<div class="mk-id">' +
        '<div class="mk-name">' + escHtml(name) + '</div>' +
        '<div class="mk-loc">' + loc + '</div>' +
      '</div>' +
    '</div>' +
    '<div class="mk-tags">' + tags + '</div>' +
    '<div class="mk-acts">' + acts + '</div>' +
  '</article>';
}

function renderRetailerCard(r) {
  var name = r.business_name || "Retailer";
  var loc = (r.location ? ico("pin", 12) + r.location : "No location");
  var perks = [];
  if (r.supports_pickup) perks.push('<span class="mk-tag mk-tag--ok">Pickup</span>');
  if (r.supports_delivery) perks.push('<span class="mk-tag mk-tag--blue">Delivery</span>');
  if (!perks.length) perks.push('<span class="mk-tag mk-tag--mut">In-store</span>');

  return '<article class="mk-card">' +
    '<div class="mk-head">' +
      '<div class="mk-av mk-av-' + gmHue(r.id) + '">' + escHtml(gmInitials(name)) + '</div>' +
      '<div class="mk-id">' +
        '<div class="mk-name">' + escHtml(name) + '</div>' +
        '<div class="mk-loc">' + loc + '</div>' +
      '</div>' +
    '</div>' +
    '<div class="mk-tags">' + perks.join("") + '<span class="mk-tag mk-tag--gold">Retailer</span></div>' +
    '<div class="mk-acts">' +
      '<button class="mk-btn mk-btn--pri" data-mk-action="shop-retailer" data-retail="' + r.id + '">Shop individual units</button>' +
    '</div>' +
  '</article>';
}

// ==========================================================================
// CORE PIPELINE
// ==========================================================================

function applyFilters() {
  ensureMarketUI();
  renderDesk();
  __mk.enrich = Object.create(null);
  __mk.enrichB = Object.create(null);
  
  var role = gmRole();
  var q = String(document.getElementById("search-input")?.value || "").toLowerCase();
  var loc = String(document.getElementById("filter-location")?.value || "").toLowerCase();
  var cat = gmCategory();

  if (role === "consumer") {
    var retailers = gmRetailers();
    var fr = retailers.filter(r => {
      var h = [r.business_name || "", r.location || "", r.market || ""].join(" ").toLowerCase();
      return (!q || h.includes(q)) && (!loc || (r.location||"").toLowerCase() === loc);
    });
    
    var list = document.getElementById("distributor-list");
    if (list) {
      list.innerHTML = '<div class="mk-sec"><span class="mk-sec-title">Retailers</span><span class="mk-sec-count">' + fr.length + '</span></div>' +
        (fr.length ? fr.map(renderRetailerCard).join("") : mkEmptyState("No retailers found", "Check back later or try a different search."));
    }
    var buyerList = document.getElementById("buyer-list");
    if (buyerList) buyerList.style.display = "none";
    return;
  }

  // B2B Flow
  var dists = gmDists();
  var buyers = gmBuyers();

  var fd = dists.filter(d => {
    var h = [d.business_name||"", d.location||"", d.market||"", d.category||""].join(" ").toLowerCase();
    if (q && !h.includes(q)) return false;
    if (loc && (d.location||"").toLowerCase() !== loc) return false;
    if (cat !== "All" && (d.category||"").trim() !== cat) return false;
    if (__mk.chips.network && enrichDist(d).rel === "none") return false;
    if (__mk.chips.verified && mkTierRank(d) < 2) return false;
    if (__mk.chips.saved && !gmIsFav(d.id)) return false;
    return true;
  });

  fd.sort((a,b) => {
    var ea = enrichDist(a), eb = enrichDist(b);
    var r = { active: 0, pending_in: 1, pending_out: 2, paused: 3, none: 4, self: -1 };
    if (r[ea.rel] !== r[eb.rel]) return r[ea.rel] - r[eb.rel];
    return String(a.business_name||"").localeCompare(String(b.business_name||""));
  });

  var list = document.getElementById("distributor-list");
  if (list) {
    var network = fd.filter(d => enrichDist(d).rel !== 'none' && enrichDist(d).rel !== 'self');
    var discover = fd.filter(d => enrichDist(d).rel === 'none');
    var self = fd.filter(d => enrichDist(d).rel === 'self');

    var html = '';
    if (self.length) html += self.map(renderDistCard).join("");
    if (network.length) html += mkSecHead("Your Network", network.length) + network.map(renderDistCard).join("");
    if (discover.length) html += mkSecHead("Discover", discover.length) + discover.map(renderDistCard).join("");
    if (!fd.length) html = mkEmptyState("No matches", "Try adjusting your search or filters.", '<button class="mk-btn mk-btn--pri" data-mk-action="clear-filters">Clear filters</button>');
    
    list.innerHTML = html;
  }

  var buyerList = document.getElementById("buyer-list");
  if (buyerList && role === "distributor") {
    buyerList.style.display = "";
    var label = buyerList.previousElementSibling;
    if (label && label.classList.contains("section-label")) label.style.display = "";

    var fb = buyers.filter(b => {
      var h = [b.name||"", b.location||"", b.looking_for||""].join(" ").toLowerCase();
      return (!q || h.includes(q)) && (!loc || (b.location||"").toLowerCase() === loc) && (cat === "All" || (b.looking_for||"") === cat);
    });

    buyerList.innerHTML = mkSecHead("Buyer Roster", fb.length) + 
      (fb.length ? fb.map(renderBuyerCard).join("") : mkEmptyState("No buyers", "Invite buyers to grow your network.", "", BUYER_ICON_SVG));
  }
}

// ==========================================================================
// LOADER
// ==========================================================================

async function loadDistributorsAndBuyers() {
  if (!window.sb) return;
  var role = gmRole();
  var hadData = gmDists().length > 0 || gmRetailers().length > 0;
  if (!hadData) {
    var l = document.getElementById("distributor-list");
    if (l) l.innerHTML = '<div style="text-align:center;padding:40px;color:var(--mk-mut);">Syncing network…</div>';
  }

  var res = await Promise.all([
    role === "consumer" 
      ? window.sb.from("retailer_profiles").select("id, business_name, location, market, supports_pickup, supports_delivery")
      : window.sb.from("distributor_profiles").select("id, business_name, location, market, category, verification_tier, profiles(phone)"),
    role === "distributor"
      ? window.sb.from("buyer_profiles").select("id, name, location, market, looking_for, profiles(full_name, phone)")
      : Promise.resolve({ data: [] }),
    gmGraphIsCurrent() ? Promise.resolve() : loadMarketGraph()
  ]);

  if (role === "consumer") {
    allRetailers = (res[0].data || []).filter(r => isValidUuid(r.id));
    allDistributors = []; allBuyers = [];
  } else {
    allDistributors = (res[0].data || []).filter(d => isValidUuid(d.id));
    allBuyers = role === "distributor" ? (res[1].data || []).filter(b => isValidUuid(b.id)) : [];
    allRetailers = [];
  }

  applyFilters();
}

// ==========================================================================
// INTERACTION HANDLERS
// ==========================================================================

async function handleMarketClick(e) {
  var t = e.target.closest("[data-mk-action]");
  if (!t) return;
  var action = t.getAttribute("data-mk-action");
  var distId = t.getAttribute("data-dist");
  var buyerId = t.getAttribute("data-buyer");
  var retailId = t.getAttribute("data-retail");
  
  e.preventDefault();
  try {
    if (action === "login" && window.showAuthShell) return window.showAuthShell("login");
    if (action === "review-requests" && window.showScreen) return window.showScreen("relationship");
    if (action === "edit-profile" && window.showScreen) return window.showScreen("profile");
    if (action === "storefront") return window.openStorefrontModal(distId);
    if (action === "inquire") {
      if (window.openModal) window.openModal(distId, mkDistName(distId), "distributor");
      return;
    }
    if (action === "rekindle") {
      if (window.openModal) window.openModal(distId, mkDistName(distId), "distributor");
      var item = document.getElementById("inquiry-item");
      if (item && !item.value) item.value = "Rekindle trading relationship";
      return;
    }
    if (action === "whatsapp") {
      var d = mkFindDist(distId);
      if (d) window.openWhatsApp(mkPhoneOf(d), d.business_name);
      return;
    }
    if (action === "nudge") {
      var d2 = mkFindDist(distId);
      if (d2) window.openWhatsApp(mkPhoneOf(d2), d2.business_name, "Hi, following up on my inquiry on GoodsbarnX.");
      return;
    }
    if (action === "fav") {
      if (window.toggleFavourite) window.toggleFavourite(e, distId);
      return;
    }
    if (action === "invite-buyer") {
      if (window.openInviteBuyerModal) window.openInviteBuyerModal();
      return;
    }
    if (action === "inquire-buyer") {
      if (window.openModal) window.openModal(buyerId, mkBuyerName(buyerId), "buyer");
      return;
    }
    if (action === "whatsapp-buyer") {
      var b = mkFindBuyer(buyerId);
      if (b) window.openWhatsApp(b.profiles?.phone, b.name);
      return;
    }
    if (action === "chip") {
      var c = t.getAttribute("data-chip");
      __mk.chips[c] = !__mk.chips[c];
      t.setAttribute("aria-pressed", __mk.chips[c] ? "true" : "false");
      applyFilters();
      return;
    }
    if (action === "clear-filters") {
      document.getElementById("search-input").value = "";
      document.getElementById("filter-location").value = "";
      __mk.chips = { network: false, verified: false, saved: false };
      document.querySelectorAll("[data-chip]").forEach(c => c.setAttribute("aria-pressed", "false"));
      applyFilters();
      return;
    }
    if (action === "shop-retailer") {
      if (window.openConsumerStorefront) return window.openConsumerStorefront(retailId);
      alert("Retailer storefront coming soon!");
      return;
    }
  } catch (err) {
    console.error("[GoodsbarnX/market] action failed:", err);
  }
}

function handleMarketChange(e) {
  if (e.target.getAttribute("data-mk-sort")) {
    __mk.sort = e.target.value;
    applyFilters();
  }
}

// ==========================================================================
// EXPORTS & BINDING
// ==========================================================================

window.loadDistributorsAndBuyers = loadDistributorsAndBuyers;
window.applyFilters = applyFilters;
window.marketInvalidateGraph = marketInvalidateGraph;

(function init() {
  var screen = document.getElementById("screen-market");
  if (screen && !screen.__mkBound) {
    screen.__mkBound = true;
    screen.addEventListener("click", handleMarketClick);
    screen.addEventListener("change", handleMarketChange);
    screen.addEventListener("input", function(e) {
      if (e.target.id === "search-input") applyFilters();
    });
  }
  
  if (typeof registerScreenLoader === "function") {
    registerScreenLoader("market", loadDistributorsAndBuyers);
  }
  
  if (document.readyState === "complete" || document.readyState === "interactive") {
    setTimeout(init, 0);
  } else {
    window.addEventListener("DOMContentLoaded", init);
  }
})();

console.log("[GoodsbarnX] market.js loaded (V1.8.2.7 rev.10 · Industry-Grade Network)");
