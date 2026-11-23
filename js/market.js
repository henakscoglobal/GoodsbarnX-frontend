// ==========================================================================
// GoodsbarnX — market.js  (rev. 7 · Relationship Desk)
// Plain global script. Loads fourth (Canon §10).
//
// The market is not a directory. It is the viewer's relationship graph:
//   BUYER        → "Relationship desk" (what needs you now), "Your network"
//                  (live trading relationships), "Discover" (ranked by trust,
//                  proximity and prior contact).
//   DISTRIBUTOR  → desk of unanswered invitations and inquiry→relationship
//                  conversions; buyer roster segmented by relationship state.
//   GUEST        → ranked directory with a clear path into the network.
//
// Security contract (rev.6, retained in full):
//   V-A  No inline handlers. One delegated click + change listener.
//   V-B  Buyer roster is loaded/rendered for distributors only.
//   V-C  Every distributor/buyer id is UUID-validated before dispatch.
//   V-D  Phone numbers are normalised + validated before any wa.me URL.
//   V-E  distributor_view emission is UUID-guarded and session-throttled.
//   V-F  All queries are column-scoped (head-only count for inquiries).
//   V-G  Graph rows are shape-validated; corrupt rows are dropped.
//   V-H  escHtml strips C0/C1 control characters.
//   V-I  (rev.7) Every enum that reaches the DOM (sort, chip, segment,
//        status) is whitelisted; nothing user-controlled is interpolated
//        unescaped.
//
// Fixed in rev.7:
//   F-1  Buyer-card WhatsApp button was dead (action/id mismatch).
//   F-2  wa.me links used the local leading 0 (must be 234…).
//   F-3  `:has()` selector could throw on older Android WebViews and abort
//        applyFilters(); replaced with sibling lookup + try/catch.
//   F-4  Relationship graph never refreshed (stale after accepting a
//        request, or after switching account). Now keyed by user id with a
//        45s TTL and window.marketInvalidateGraph().
//   F-5  A failed load left "Loading…" forever; now shows a retry state.
//   F-6  Own listing offered Inquire/WhatsApp to yourself.
//   F-7  Reads of globals that may not exist (userFavourites etc.) could
//        throw ReferenceError; all reads are typeof-guarded.
//   F-8  Relevance sort re-enriched on every comparison; now cached.
//   F-9  Serial awaits on load replaced with parallel fetch.
//   F-10 Duplicate stat queries removed from the screen loader.
//
// Backward compatibility (unchanged):
//   - Public functions/exports: loadDistributorsAndBuyers, applyFilters,
//     updateStats, renderDistributors, renderBuyers, openWhatsApp,
//     marketOpenDistributorContext, updateInquiryCountRing.
//   - Globals used: allDistributors, allBuyers, activeCategory, currentUser,
//     userFavourites, sb, selectCategory, toggleFavourite, openModal,
//     openStorefrontModal, openDisputeModal, openInviteBuyerModal,
//     showScreen, registerScreenLoader, goodsbarnxBehaviourTrack.
//   - DOM targets: #screen-market, #distributor-list, #buyer-list, stat ids.
//   - index.html: no structural change. Cache-bust the script tag only.
// ==========================================================================

// ==========================================================================
// SAFE PRIMITIVES
// ==========================================================================

function escHtml(v) {
  // V-H: strip C0/C1 control chars before escaping.
  return String(v == null ? "" : v)
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
function escAttr(v) { return escHtml(v); }

// V-C: strict UUID v4.
var __MARKET_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function isValidUuid(v) { return typeof v === "string" && __MARKET_UUID_RE.test(v); }

// V-D: Nigerian numbers. Legacy regex kept for compatibility; the
// normaliser is the source of truth (accepts +234…, 234…, 0…, and bare
// 10-digit national format, returns canonical 234XXXXXXXXXX or "").
var __MARKET_NG_PHONE_RE = /^(234|0)[789][01]\d{8}$/;
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

// F-7: typeof-guarded reads of cross-module globals.
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
// TIME HELPERS
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
  var mo = Math.floor(d / 30);
  if (mo < 12) return mo + "mo ago";
  return Math.floor(mo / 12) + "y ago";
}
function gmTenure(iso) {
  var t = Date.parse(iso);
  if (!isFinite(t)) return "";
  var dt = new Date(t);
  var months = Math.max(0, Math.floor((Date.now() - t) / (86400000 * 30.4)));
  var since;
  try { since = dt.toLocaleDateString("en-NG", { month: "short", year: "numeric" }); }
  catch (e) { since = dt.getFullYear() + ""; }
  var span = months < 1 ? "new" : (months < 12 ? months + " mo" : (Math.floor(months / 12) + " yr" + (months % 12 ? " " + (months % 12) + " mo" : "")));
  return "Trading since " + since + " · " + span;
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
// ICONS (inline SVG, stroke-based, one visual language)
// ==========================================================================

var GM_ICONS = {
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
  x:       '<path d="M6 6l12 12M18 6L6 18"/>',
  alert:   '<path d="M12 4l9 16H3L12 4z"/><path d="M12 10v4M12 17.2v.1"/>'
};
function ico(name, size, cls) {
  var s = size || 16;
  return '<svg class="gm-i' + (cls ? " " + cls : "") + '" width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" ' +
    'stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    (GM_ICONS[name] || "") + '</svg>';
}
function gmFavIcon(on) {
  return '<svg class="gm-i gm-heart' + (on ? " is-on" : "") + '" width="20" height="20" viewBox="0 0 24 24" ' +
    'fill="' + (on ? "currentColor" : "none") + '" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    GM_ICONS.heart + '</svg>';
}

const MARKET_ICON_SVG =
  '<svg class="gbx-icon-market" width="40" height="40" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
    '<path d="M2.5 7.5h15l-1.2 8.2a1 1 0 0 1-1 .8H4.7a1 1 0 0 1-1-.8L2.5 7.5z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>' +
    '<path d="M7 7.5V5a3 3 0 0 1 6 0v2.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>' +
  '</svg>';
const BUYER_ICON_SVG =
  '<svg class="gbx-icon-market" width="40" height="40" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
    '<circle cx="10" cy="7" r="3" stroke="currentColor" stroke-width="1.4"/>' +
    '<path d="M3.5 16.5c0-3.6 2.9-5.5 6.5-5.5s6.5 1.9 6.5 5.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>' +
  '</svg>';

// ==========================================================================
// STYLES — injected once, every rule scoped under #screen-market (gm- prefix)
// ==========================================================================

var GM_CSS = [
"#screen-market{--gm-card:#131917;--gm-card2:#18201d;--gm-line:rgba(255,255,255,.08);--gm-line2:rgba(255,255,255,.15);--gm-tx:#e9eeea;--gm-mut:#8f9b95;--gm-green:#22b26a;--gm-greend:#0f7a4b;--gm-brass:var(--brass,#c19a3e);--gm-warn:#e2a93b;--gm-bad:#e5645a;--gm-info:#5aa9e6}",
"#screen-market .gm-i{flex:0 0 auto;display:inline-block;vertical-align:middle}",
"#screen-market .gm-mute{color:var(--gm-mut)}",

/* ---- Vertical rail (replaces the 8-row emoji grid; same elements, same onclick) ---- */
"#screen-market .category-grid{display:flex;flex-wrap:nowrap;gap:8px;overflow-x:auto;overflow-y:hidden;margin:0 0 14px;padding:2px 0 8px;scroll-snap-type:x proximity;scrollbar-width:none;-webkit-overflow-scrolling:touch;-webkit-mask-image:linear-gradient(90deg,#000 90%,transparent);mask-image:linear-gradient(90deg,#000 90%,transparent)}",
"#screen-market .category-grid::-webkit-scrollbar{display:none}",
"#screen-market .category-grid .category-card{flex:0 0 auto;display:inline-flex;align-items:center;gap:7px;width:auto;min-width:0;height:auto;aspect-ratio:auto;margin:0;padding:9px 13px;border-radius:999px;font-size:0;line-height:1;white-space:nowrap;scroll-snap-align:start;background:var(--gm-card);border:1px solid var(--gm-line);cursor:pointer;-webkit-tap-highlight-color:transparent;transition:border-color .15s,background .15s,opacity .15s}",
"#screen-market .category-grid .category-card span{font-size:13px;font-weight:600;color:var(--gm-tx);letter-spacing:.01em;margin:0;line-height:1}",
"#screen-market .category-grid .category-card .gm-cat-n{font:600 10.5px/1 'DM Mono',ui-monospace,monospace;color:var(--gm-mut);background:rgba(255,255,255,.07);padding:3px 6px;border-radius:999px}",
"#screen-market .category-grid .category-card.active{background:rgba(34,178,106,.14);border-color:var(--gm-green)}",
"#screen-market .category-grid .category-card.active span{color:#86e3b0}",
"#screen-market .category-grid .category-card.active .gm-cat-n{color:#06130c;background:var(--gm-green)}",
"#screen-market .category-grid .category-card.gm-empty{opacity:.42}",

/* ---- Toolbar ---- */
"#screen-market .gm-toolbar{margin:0 0 12px}",
"#screen-market .gm-toolbar-row{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px;min-height:26px}",
"#screen-market .gm-summary{font-size:12.5px;color:var(--gm-mut)}",
"#screen-market .gm-summary b{color:var(--gm-tx);font-weight:600}",
"#screen-market .gm-link{background:none;border:0;padding:6px 4px;color:var(--gm-green);font:600 12.5px/1 inherit;font-family:inherit;cursor:pointer;text-decoration:underline;text-underline-offset:3px}",
"#screen-market .gm-sort{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--gm-mut)}",
"#screen-market .gm-sort select{background:var(--gm-card);color:var(--gm-tx);border:1px solid var(--gm-line);border-radius:10px;padding:7px 8px;font:500 12.5px/1 inherit;font-family:inherit;max-width:150px}",
"#screen-market .gm-chips{display:flex;gap:8px;flex-wrap:wrap}",
"#screen-market .gm-chip{display:inline-flex;align-items:center;gap:6px;min-height:36px;padding:0 13px;border-radius:999px;background:var(--gm-card);border:1px solid var(--gm-line);color:var(--gm-tx);font:500 12.5px/1 inherit;font-family:inherit;cursor:pointer;-webkit-tap-highlight-color:transparent}",
"#screen-market .gm-chip[aria-pressed=true]{background:rgba(34,178,106,.14);border-color:var(--gm-green);color:#86e3b0}",

/* ---- Section heads ---- */
"#screen-market .gm-sec{display:flex;align-items:baseline;gap:8px;margin:18px 0 10px}",
"#screen-market .gm-sec:first-child{margin-top:4px}",
"#screen-market .gm-kicker{font:600 10.5px/1 'DM Mono',ui-monospace,monospace;letter-spacing:.16em;text-transform:uppercase;color:var(--gm-green)}",
"#screen-market .gm-sec .gm-kicker{color:var(--gm-mut)}",
"#screen-market .gm-sec .gm-n{font:600 11px/1 'DM Mono',ui-monospace,monospace;color:var(--gm-tx)}",
"#screen-market .gm-sec .gm-hint{font-size:11.5px;color:var(--gm-mut);margin-left:auto}",

/* ---- Relationship desk ---- */
"#screen-market .gm-console{background:linear-gradient(180deg,rgba(34,178,106,.09),rgba(34,178,106,.02));border:1px solid rgba(34,178,106,.28);border-radius:16px;padding:14px;margin:0 0 14px}",
"#screen-market .gm-console-head{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px 12px;margin-bottom:2px}",
"#screen-market .gm-pulse{display:flex;flex-wrap:wrap;gap:6px}",
"#screen-market .gm-pulse span{font-size:11.5px;color:var(--gm-mut);background:rgba(255,255,255,.05);border-radius:999px;padding:5px 9px}",
"#screen-market .gm-pulse b{color:var(--gm-tx);font-weight:700;margin-right:2px}",
"#screen-market .gm-pulse .is-warn b{color:var(--gm-warn)}",
"#screen-market .gm-pulse .is-info b{color:var(--gm-info)}",
"#screen-market .gm-lead{font-size:13px;color:var(--gm-mut);margin:8px 0 0;line-height:1.45}",
"#screen-market .gm-att{list-style:none;margin:10px 0 0;padding:0;display:flex;flex-direction:column;gap:8px}",
"#screen-market .gm-att-item{display:flex;align-items:center;gap:10px;background:var(--gm-card);border:1px solid var(--gm-line);border-radius:12px;padding:10px 10px 10px 12px}",
"#screen-market .gm-att-ic{width:32px;height:32px;border-radius:10px;display:grid;place-items:center;background:rgba(255,255,255,.06);color:var(--gm-mut)}",
"#screen-market .gm-att-item[data-tone=warn] .gm-att-ic{background:rgba(226,169,59,.14);color:var(--gm-warn)}",
"#screen-market .gm-att-item[data-tone=info] .gm-att-ic{background:rgba(90,169,230,.14);color:var(--gm-info)}",
"#screen-market .gm-att-item[data-tone=ok] .gm-att-ic{background:rgba(34,178,106,.14);color:var(--gm-green)}",
"#screen-market .gm-att-body{flex:1;min-width:0}",
"#screen-market .gm-att-title{font-size:13.5px;font-weight:600;color:var(--gm-tx);line-height:1.3;overflow-wrap:anywhere}",
"#screen-market .gm-att-meta{font-size:11.5px;color:var(--gm-mut);margin-top:2px}",

/* ---- Engine strip ---- */
"#screen-market .gm-engine{display:flex;align-items:center;gap:9px;width:100%;text-align:left;background:var(--gm-card);border:1px solid var(--gm-line);border-radius:12px;padding:10px 12px;margin:0 0 12px;color:var(--gm-tx);font:500 12.5px/1.3 inherit;font-family:inherit}",
"#screen-market button.gm-engine{cursor:pointer}",
"#screen-market .gm-engine-dot{width:8px;height:8px;border-radius:50%;background:var(--gm-warn);box-shadow:0 0 0 4px rgba(226,169,59,.18);flex:0 0 auto}",
"#screen-market .gm-engine[data-fresh=stale] .gm-engine-dot{background:var(--gm-mut);box-shadow:none}",
"#screen-market .gm-engine-go{margin-left:auto;color:var(--gm-green);font-weight:600}",

/* ---- Guest banner ---- */
"#screen-market .gm-guest{display:flex;align-items:center;gap:12px;background:var(--gm-card);border:1px dashed var(--gm-line2);border-radius:14px;padding:12px 14px;margin:0 0 14px}",
"#screen-market .gm-guest p{margin:0;font-size:12.5px;color:var(--gm-mut);flex:1;line-height:1.4}",
"#screen-market .gm-guest p b{color:var(--gm-tx)}",

/* ---- Cards ---- */
"#screen-market .gm-card{position:relative;background:var(--gm-card);border:1px solid var(--gm-line);border-radius:16px;padding:14px;margin:0 0 12px;box-shadow:none}",
"#screen-market .gm-card[data-rel=active]{border-color:rgba(34,178,106,.4);background:linear-gradient(180deg,rgba(34,178,106,.07),var(--gm-card) 60%)}",
"#screen-market .gm-card[data-rel=pending_in],#screen-market .gm-card[data-rel=pending_out]{border-color:rgba(90,169,230,.4)}",
"#screen-market .gm-card[data-rel=paused],#screen-market .gm-card[data-rel=suspended],#screen-market .gm-card[data-rel=released],#screen-market .gm-card[data-rel=terminated]{border-color:rgba(226,169,59,.32)}",
"#screen-market .gm-card[data-rel=self]{border-style:dashed;border-color:var(--gm-line2)}",
"#screen-market .gm-head{display:flex;align-items:flex-start;gap:12px}",
"#screen-market .gm-av{flex:0 0 auto;width:42px;height:42px;border-radius:12px;display:grid;place-items:center;font:700 14px/1 inherit;font-family:inherit;letter-spacing:.02em;color:#0a120e}",
"#screen-market .gm-av-0{background:#7fd3a6}#screen-market .gm-av-1{background:#e2c277}#screen-market .gm-av-2{background:#8ec1ee}#screen-market .gm-av-3{background:#d6a0d9}#screen-market .gm-av-4{background:#9fb0a8}",
"#screen-market .gm-id{flex:1;min-width:0}",
"#screen-market .gm-name{font-size:15.5px;font-weight:700;color:var(--gm-tx);line-height:1.25;overflow-wrap:anywhere}",
"#screen-market .gm-loc{display:flex;align-items:center;gap:5px;margin-top:3px;font-size:12.5px;color:var(--gm-mut);line-height:1.3}",
"#screen-market .gm-tenure{margin-top:6px;font:500 11px/1.3 'DM Mono',ui-monospace,monospace;color:#86e3b0;letter-spacing:.02em}",
"#screen-market .gm-fav{flex:0 0 auto;width:40px;height:40px;margin:-6px -6px 0 0;display:grid;place-items:center;background:none;border:0;border-radius:12px;color:var(--gm-mut);cursor:pointer;-webkit-tap-highlight-color:transparent}",
"#screen-market .gm-fav .gm-heart.is-on{color:#ef6b73}",
"#screen-market .gm-tags{display:flex;flex-wrap:wrap;gap:6px;margin-top:11px}",
"#screen-market .gm-tag{display:inline-flex;align-items:center;gap:5px;padding:5px 9px;border-radius:999px;font:600 10.5px/1 'DM Mono',ui-monospace,monospace;letter-spacing:.06em;text-transform:uppercase;color:var(--gm-mut);background:rgba(255,255,255,.06)}",
"#screen-market .gm-tag--ok{color:#86e3b0;background:rgba(34,178,106,.13)}",
"#screen-market .gm-tag--brass{color:var(--gm-brass);background:rgba(193,154,62,.13)}",
"#screen-market .gm-tag--info{color:var(--gm-info);background:rgba(90,169,230,.13)}",
"#screen-market .gm-tag--warn{color:var(--gm-warn);background:rgba(226,169,59,.13)}",
"#screen-market .gm-tag--rel{color:#06130c;background:var(--gm-green)}",
"#screen-market .gm-acts{display:flex;gap:8px;margin-top:13px}",
"#screen-market .gm-btn{display:inline-flex;align-items:center;justify-content:center;gap:7px;min-height:44px;padding:0 14px;border-radius:12px;border:1px solid var(--gm-line2);background:transparent;color:var(--gm-tx);font:600 13.5px/1 inherit;font-family:inherit;cursor:pointer;-webkit-tap-highlight-color:transparent;transition:transform .08s,background .15s}",
"#screen-market .gm-btn:active{transform:scale(.97)}",
"#screen-market .gm-btn--primary{background:var(--gm-greend);border-color:var(--gm-greend);color:#fff;flex:1}",
"#screen-market .gm-btn--ghost{flex:1}",
"#screen-market .gm-btn--wa{flex:0 0 44px;padding:0;background:rgba(34,178,106,.12);border-color:rgba(34,178,106,.4);color:#5fdc9c}",
"#screen-market .gm-btn--sm{min-height:36px;padding:0 12px;font-size:12.5px;border-radius:10px;flex:0 0 auto}",
"#screen-market .gm-foot{margin-top:10px;display:flex;justify-content:flex-end}",
"#screen-market .gm-report{background:none;border:0;padding:6px 0;color:var(--gm-mut);font:500 11.5px/1 inherit;font-family:inherit;text-decoration:underline;text-underline-offset:3px;cursor:pointer}",
"#screen-market .gm-btn:focus-visible,#screen-market .gm-chip:focus-visible,#screen-market .gm-fav:focus-visible,#screen-market .gm-link:focus-visible,#screen-market .gm-report:focus-visible,#screen-market .gm-sort select:focus-visible,#screen-market .category-card:focus-visible{outline:2px solid var(--gm-green);outline-offset:2px}",

/* ---- Segments (demand desk) ---- */
"#screen-market .gm-seg{display:flex;gap:6px;overflow-x:auto;margin:0 0 12px;padding-bottom:2px;scrollbar-width:none}",
"#screen-market .gm-seg::-webkit-scrollbar{display:none}",
"#screen-market .gm-seg button{flex:0 0 auto;display:inline-flex;align-items:center;gap:6px;min-height:34px;padding:0 12px;border-radius:999px;background:var(--gm-card);border:1px solid var(--gm-line);color:var(--gm-tx);font:500 12.5px/1 inherit;font-family:inherit;cursor:pointer}",
"#screen-market .gm-seg button[aria-pressed=true]{background:rgba(34,178,106,.14);border-color:var(--gm-green);color:#86e3b0}",
"#screen-market .gm-seg b{font:600 10.5px/1 'DM Mono',ui-monospace,monospace;color:var(--gm-mut)}",

/* ---- Empty / error / skeleton ---- */
"#screen-market .gm-empty-state{text-align:center;padding:30px 18px;border:1px dashed var(--gm-line2);border-radius:16px;color:var(--gm-mut)}",
"#screen-market .gm-empty-state .gm-ico{color:var(--gm-mut);opacity:.8;margin-bottom:8px}",
"#screen-market .gm-empty-state h4{margin:0 0 4px;font-size:15px;color:var(--gm-tx)}",
"#screen-market .gm-empty-state p{margin:0 0 14px;font-size:12.5px;line-height:1.45}",
"#screen-market .gm-skel{height:148px;border-radius:16px;margin:0 0 12px;background:linear-gradient(100deg,var(--gm-card) 30%,var(--gm-card2) 50%,var(--gm-card) 70%);background-size:200% 100%;animation:gm-shimmer 1.3s linear infinite}",
"@keyframes gm-shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}",
"@media (prefers-reduced-motion:reduce){#screen-market .gm-skel{animation:none}#screen-market .gm-btn{transition:none}}",
"@media (min-width:720px){#screen-market .gm-acts .gm-btn--primary{flex:0 1 auto;min-width:150px}}"
].join("\n");

function ensureMarketStyles() {
  if (document.getElementById("gm-style")) return;
  var s = document.createElement("style");
  s.id = "gm-style";
  s.textContent = GM_CSS;
  (document.head || document.documentElement).appendChild(s);
}

// ==========================================================================
// UI STATE (view-only; never persisted, never trusted by the backend)
// ==========================================================================

var GM_SORTS = ["best", "nearest", "trusted", "az"];
var GM_CHIPS = ["network", "verified", "saved"];
var GM_SEGMENTS = ["all", "network", "invited", "prior", "new"];

var __gm = {
  sort: "best",
  chips: { network: false, verified: false, saved: false },
  segment: "all",
  enrich: Object.create(null),   // per-render enrichment cache (F-8)
  enrichB: Object.create(null),
  filtersActive: false,
  loadError: null,
  lastCat: "All"
};

// ==========================================================================
// L1 · RELATIONSHIP GRAPH  (per-session cache, shape-validated, keyed by user)
// ==========================================================================

const __gbxMarketGraph = {
  viewerRole: "guest",
  viewerId: null,
  myRelationships: [],
  myPendingInbound: [],
  myPendingOutbound: [],
  contactedSet: new Set(),
  myInquiries: Object.create(null),   // distributor_id -> {total, pending, lastAt, lastPendingAt}
  loaded: false,
  loadedAt: 0
};

var GM_GRAPH_TTL_MS = 45 * 1000;

function validateGraphRows(rows, expectField) {
  if (!Array.isArray(rows)) return [];
  return rows.filter(function (r) {
    if (!r || typeof r !== "object") return false;
    if (!r[expectField] || !isValidUuid(r[expectField])) return false;
    if (r.status != null && typeof r.status !== "string") return false;
    return true;
  });
}

function marketInvalidateGraph() {
  __gbxMarketGraph.loaded = false;
  __gbxMarketGraph.loadedAt = 0;
}

function gmGraphIsCurrent() {
  var u = gmUser();
  return __gbxMarketGraph.loaded &&
    __gbxMarketGraph.viewerId === (u ? u.id : null) &&
    (Date.now() - __gbxMarketGraph.loadedAt) < GM_GRAPH_TTL_MS;
}

// Graph data is only trusted while it belongs to the current viewer. After an
// account switch, stale rows can never decorate another user's market (F-4).
function gmGraph() {
  var u = gmUser();
  if (__gbxMarketGraph.viewerId !== (u ? u.id : null)) {
    return { myRelationships: [], myPendingInbound: [], myPendingOutbound: [], contactedSet: new Set(), myInquiries: Object.create(null) };
  }
  return __gbxMarketGraph;
}

async function loadMarketGraph() {
  var u = gmUser();
  var G = __gbxMarketGraph;
  G.viewerRole = (u && u.role) || "guest";
  G.viewerId = u ? u.id : null;
  G.myRelationships = [];
  G.myPendingInbound = [];
  G.myPendingOutbound = [];
  G.contactedSet = new Set();
  G.myInquiries = Object.create(null);

  if (!u || !window.sb) {
    G.loaded = true; G.loadedAt = Date.now();
    return;
  }

  try {
    if (u.role === "buyer") {
      const res = await Promise.all([
        sb.from("trade_relationships")
          .select("distributor_id,status,is_primary,relationship_started_at,created_at")
          .eq("buyer_id", u.id),
        sb.from("buyer_locks")
          .select("distributor_id,status,created_at")
          .eq("buyer_id", u.id)
          .eq("status", "pending_consent"),
        loadBuyerInquiries(u.id)
      ]);
      validateGraphRows(res[0].data || [], "distributor_id").forEach(function (r) {
        G.myRelationships.push({
          distributor_id: r.distributor_id,
          status: String(r.status || "").toLowerCase(),
          is_primary: !!r.is_primary,
          since: r.relationship_started_at || r.created_at || null
        });
      });
      validateGraphRows(res[1].data || [], "distributor_id").forEach(function (l) {
        G.myPendingInbound.push({ distributor_id: l.distributor_id, created_at: l.created_at || null });
      });
      validateGraphRows(res[2] || [], "distributor_id").forEach(function (q) {
        var k = q.distributor_id;
        var rec = G.myInquiries[k] || (G.myInquiries[k] = { total: 0, pending: 0, lastAt: null, lastPendingAt: null });
        rec.total++;
        var at = q.created_at || null;
        if (at && (!rec.lastAt || Date.parse(at) > Date.parse(rec.lastAt))) rec.lastAt = at;
        if (String(q.status || "").toLowerCase() === "pending") {
          rec.pending++;
          if (at && (!rec.lastPendingAt || Date.parse(at) > Date.parse(rec.lastPendingAt))) rec.lastPendingAt = at;
        }
      });
    } else if (u.role === "distributor") {
      const res = await Promise.all([
        sb.from("trade_relationships")
          .select("buyer_id,status,is_primary,relationship_started_at,created_at")
          .eq("distributor_id", u.id),
        sb.from("buyer_locks")
          .select("buyer_id,status,created_at")
          .eq("distributor_id", u.id)
          .eq("status", "pending_consent"),
        sb.from("inquiries")
          .select("buyer_id")
          .eq("distributor_id", u.id)
      ]);
      validateGraphRows(res[0].data || [], "buyer_id").forEach(function (r) {
        G.myRelationships.push({
          buyer_id: r.buyer_id,
          status: String(r.status || "").toLowerCase(),
          is_primary: !!r.is_primary,
          since: r.relationship_started_at || r.created_at || null
        });
      });
      validateGraphRows(res[1].data || [], "buyer_id").forEach(function (l) {
        G.myPendingOutbound.push({ buyer_id: l.buyer_id, created_at: l.created_at || null });
      });
      (res[2].data || []).forEach(function (x) {
        if (x && isValidUuid(x.buyer_id)) G.contactedSet.add(x.buyer_id);
      });
    }
  } catch (err) {
    console.warn("[GoodsbarnX/market] loadMarketGraph failed:", err && err.message);
  }

  G.loaded = true;
  G.loadedAt = Date.now();
}

// Optional enrichment: the buyer's own inquiries. If the columns or RLS differ
// in a given deployment this degrades to "no inquiry state" and never throws.
async function loadBuyerInquiries(buyerId) {
  try {
    var r = await sb.from("inquiries")
      .select("distributor_id,status,created_at")
      .eq("buyer_id", buyerId)
      .order("created_at", { ascending: false })
      .limit(300);
    if (!r.error && Array.isArray(r.data)) return r.data;
    var r2 = await sb.from("inquiries")
      .select("distributor_id,status")
      .eq("buyer_id", buyerId)
      .limit(300);
    return (!r2.error && Array.isArray(r2.data)) ? r2.data : [];
  } catch (e) { return []; }
}

// ==========================================================================
// L2 · ENRICHMENT
// ==========================================================================

var GM_TIER_RANK = { "association": 3, "market board": 2, "self-attested": 1 };
function gmTierRank(d) { return GM_TIER_RANK[String((d && d.verification_tier) || "").toLowerCase()] || 0; }
function gmSameCity(d) {
  var c = gmUserCity().toLowerCase();
  return !!c && String((d && d.location) || "").trim().toLowerCase() === c;
}
function gmPhoneOf(d) { return (d && d.profiles && d.profiles.phone) || ""; }

var GM_REL_STATES = {
  active:     { r: 1, l: "Active relationship" },
  paused:     { r: 5, l: "Relationship paused" },
  suspended:  { r: 6, l: "Relationship suspended" },
  released:   { r: 7, l: "Released — rekindle" },
  terminated: { r: 8, l: "Terminated — rekindle" }
};

function gmIsInNetwork(e) { return !!e && e.relationship !== "none" && e.relationship !== "self"; }

function enrichDistributorForViewer(dist) {
  var cached = __gm.enrich[dist && dist.id];
  if (cached) return cached;

  var u = gmUser();
  var out = { relationship: "none", relevance: 100, label: null, since: null, isPrimary: false, isSelf: false, inquiry: null };

  if (u && dist && u.id === dist.id) {
    out.relationship = "self"; out.relevance = -1; out.label = "Your listing"; out.isSelf = true;
    return (__gm.enrich[dist.id] = out);
  }

  var base = 50 - gmTierRank(dist) - (gmSameCity(dist) ? 2 : 0);
  out.relevance = base;

  if (gmRole() === "buyer") {
    var G = gmGraph();
    var rel = G.myRelationships.find(function (r) { return r.distributor_id === dist.id; });
    var pendingIn = G.myPendingInbound.find(function (p) { return p.distributor_id === dist.id; });
    var iq = G.myInquiries[dist.id] || null;
    out.inquiry = iq;

    if (rel) {
      out.since = rel.since; out.isPrimary = rel.is_primary;
      if (rel.status === "active") {
        out.relationship = "active"; out.relevance = rel.is_primary ? 0 : 1;
        out.label = rel.is_primary ? "Primary relationship" : "Active relationship";
      } else if (rel.status === "pending") {
        out.relationship = "pending_out"; out.relevance = 3; out.label = "Request sent";
      } else if (GM_REL_STATES[rel.status]) {
        out.relationship = rel.status; out.relevance = GM_REL_STATES[rel.status].r; out.label = GM_REL_STATES[rel.status].l;
      }
    }
    if (out.relationship === "none" && pendingIn) {
      out.relationship = "pending_in"; out.relevance = 2; out.label = "Wants to connect";
      out.since = pendingIn.created_at;
    }
    if (out.relationship === "none" && iq && iq.pending > 0) out.relevance = Math.min(out.relevance, 4);
  }
  return (__gm.enrich[dist.id] = out);
}

function enrichBuyerForViewer(buyer) {
  var cached = __gm.enrichB[buyer && buyer.id];
  if (cached) return cached;

  var G = gmGraph();
  var out = { relationship: "none", relevance: 50, label: null, since: null, isPrimary: false, pendingAt: null };
  var rel = G.myRelationships.find(function (r) { return r.buyer_id === buyer.id; });
  var pendingOut = G.myPendingOutbound.find(function (p) { return p.buyer_id === buyer.id; });
  var contacted = G.contactedSet.has(buyer.id);

  if (rel && rel.status === "active") {
    out = { relationship: "active", relevance: rel.is_primary ? 0 : 1, label: rel.is_primary ? "Primary relationship" : "Active relationship", since: rel.since, isPrimary: rel.is_primary };
  } else if (rel && rel.status === "pending") {
    out = { relationship: "pending_in", relevance: 1, label: "Requested to connect", since: rel.since };
  } else if (pendingOut) {
    out = { relationship: "pending_out", relevance: 2, label: "Invitation sent", pendingAt: pendingOut.created_at };
  } else if (rel && (rel.status === "paused" || rel.status === "suspended")) {
    out = { relationship: rel.status, relevance: GM_REL_STATES[rel.status].r, label: GM_REL_STATES[rel.status].l, since: rel.since };
  } else if (rel && (rel.status === "released" || rel.status === "terminated")) {
    out = { relationship: rel.status, relevance: GM_REL_STATES[rel.status].r, label: GM_REL_STATES[rel.status].l, since: rel.since };
  } else if (contacted) {
    out = { relationship: "contacted", relevance: 5, label: "Previously contacted" };
  }
  return (__gm.enrichB[buyer.id] = out);
}

// ==========================================================================
// L3 · ENGINE CONTEXT
// ==========================================================================

const MARKET_ENGINE_STALE_MS       = 5  * 60 * 1000;
const MARKET_ENGINE_UNAVAILABLE_MS = 30 * 60 * 1000;

function getMarketEngineContext() {
  var snapshot = window.goodsbarnxLastReplenishmentSnapshot || null;
  if (!snapshot || !Array.isArray(snapshot.rows)) {
    return { source: "unavailable", freshnessMs: null, highCount: 0, depletingCount: 0, totalSignals: 0 };
  }
  var updatedAt = snapshot.generatedAt || null;
  var freshnessMs = updatedAt ? (Date.now() - new Date(updatedAt).getTime()) : null;
  var source = "engine";
  if (freshnessMs == null || !isFinite(freshnessMs) || freshnessMs > MARKET_ENGINE_UNAVAILABLE_MS) source = "unavailable";
  else if (freshnessMs > MARKET_ENGINE_STALE_MS) source = "stale";

  var highCount = 0, depletingCount = 0;
  var seenProducts = Object.create(null);
  (snapshot.rows || []).forEach(function (r) {
    if (!r) return;
    if (r.urgency === "HIGH") highCount++;
    if ((r.signal_type || "").indexOf("RESTOCK") !== -1 && r.product_id && !seenProducts[r.product_id]) {
      depletingCount++;
      seenProducts[r.product_id] = true;
    }
  });
  return { source: source, freshnessMs: freshnessMs, highCount: highCount, depletingCount: depletingCount, totalSignals: (snapshot.rows || []).length };
}

// ==========================================================================
// D36 — distributor_view emission (V-E)
// ==========================================================================

const __gbxMarketDistributorViewSeen = Object.create(null);
function emitDistributorView(distributorId) {
  if (!isValidUuid(distributorId)) return;
  if (__gbxMarketDistributorViewSeen[distributorId]) return;
  __gbxMarketDistributorViewSeen[distributorId] = true;

  if (typeof window.goodsbarnxBehaviourTrack !== "function") {
    if (!__gbxMarketWarnedTargets["behaviour_track"]) {
      __gbxMarketWarnedTargets["behaviour_track"] = true;
      console.warn("[GoodsbarnX/market] goodsbarnxBehaviourTrack unavailable; distributor_view not emitted.");
    }
    return;
  }
  window.goodsbarnxBehaviourTrack("distributor_view", { distributor_id: distributorId }, { source: "market_card" }, "market");
}

// ==========================================================================
// D33 — inquiry-count ring
// ==========================================================================

const ROLLING_CAP = 50;
function updateInquiryCountRing(count) {
  const ringFg = document.querySelector("#screen-market .seal-ring .fg");
  const ringText = document.getElementById("inquiry-count-ring");
  const c = Number.isFinite(Number(count)) ? Number(count) : 0;
  const ratio = ROLLING_CAP > 0 ? Math.min(1, c / ROLLING_CAP) : 0;
  if (ringFg) {
    const dashArray = 150;
    const offset = dashArray * (1 - ratio);
    ringFg.setAttribute("stroke-dashoffset", String(Math.round(offset * 100) / 100));
  }
  if (ringText) ringText.textContent = String(c);
}

// ==========================================================================
// LOAD  (parallel; V-B: buyer roster only for distributors)
// ==========================================================================

function gmSafe(p) {
  return Promise.resolve(p).then(function (v) { return v; }, function (err) { return { data: null, count: null, error: err || new Error("request failed") }; });
}

var __gmLoadPromise = null;

async function loadDistributorsAndBuyers() {
  if (__gmLoadPromise) return __gmLoadPromise;
  __gmLoadPromise = (async function () {
    try { await __gmLoadInternal(); } finally { __gmLoadPromise = null; }
  })();
  return __gmLoadPromise;
}

async function __gmLoadInternal() {
  if (!window.sb || typeof window.sb.from !== "function") {
    console.error("[GoodsbarnX/market] Supabase client unavailable.");
    __gm.loadError = "The marketplace connection is unavailable.";
    applyFilters();
    return;
  }

  ensureMarketStyles();
  var hadData = gmDists().length > 0;
  if (!hadData) renderMarketSkeleton();

  var u = gmUser();
  var viewerIsDistributor = !!(u && u.role === "distributor");

  var res = await Promise.all([
    gmSafe(sb.from("distributor_profiles")
      .select("id, business_name, location, market, category, verification_tier, profiles(phone)")),
    viewerIsDistributor
      ? gmSafe(sb.from("buyer_profiles").select("id, name, location, market, looking_for, profiles(full_name, phone)"))
      : Promise.resolve({ data: [], error: null }),
    gmSafe(sb.from("inquiries").select("*", { count: "exact", head: true })),
    gmGraphIsCurrent() ? Promise.resolve() : loadMarketGraph()
  ]);

  var distRes = res[0], buyerRes = res[1], inqRes = res[2];

  if (distRes.error) {
    console.error("[GoodsbarnX/market] error loading distributors:", distRes.error);
    if (!hadData) __gm.loadError = "We couldn't load distributors. Check your connection and try again.";
  } else if (Array.isArray(distRes.data)) {
    __gm.loadError = null;
    allDistributors = distRes.data.filter(function (d) { return d && isValidUuid(d.id); });
  }

  if (viewerIsDistributor) {
    if (buyerRes.error) console.error("[GoodsbarnX/market] error loading buyers:", buyerRes.error);
    else if (Array.isArray(buyerRes.data)) allBuyers = buyerRes.data.filter(function (b) { return b && isValidUuid(b.id); });
  } else {
    allBuyers = [];
  }

  if (!inqRes.error) updateInquiryCountRing(inqRes.count);

  if (viewerIsDistributor) {
    await loadPendingRequests();
    await updateNetworkLinks();
  }

  applyFilters();
  await updateStats();
}

// ==========================================================================
// PENDING REQUESTS / NETWORK LINKS / STATS (behaviour unchanged)
// ==========================================================================

async function loadPendingRequests() {
  if (!gmUser() || !window.sb) return;
  var u = gmUser();
  try {
    const { data: buyerRequests, error: buyerReqError } = await sb
      .from("trade_relationships").select("id, buyer_id, status, created_at")
      .eq("distributor_id", u.id).eq("status", "pending");
    if (!buyerReqError && Array.isArray(buyerRequests)) {
      const badge = document.getElementById("buyer-requests-count");
      if (badge) badge.textContent = buyerRequests.length;
      const attentionBadge = document.querySelector(".attention-item .badge.buyer");
      if (attentionBadge) attentionBadge.textContent = buyerRequests.length;
    }
    const { data: agentRequests, error: agentReqError } = await sb
      .from("agent_distributor_attachments").select("id, agent_id, status, created_at")
      .eq("distributor_id", u.id).eq("status", "pending");
    if (!agentReqError && Array.isArray(agentRequests)) {
      const badge = document.getElementById("agent-requests-count");
      if (badge) badge.textContent = agentRequests.length;
      const attentionBadge = document.querySelector(".attention-item .badge.agent");
      if (attentionBadge) attentionBadge.textContent = agentRequests.length;
    }
    const { data: pendingInquiries, error: inquiryError } = await sb
      .from("inquiries").select("id, status")
      .eq("distributor_id", u.id).eq("status", "pending");
    if (!inquiryError && Array.isArray(pendingInquiries)) {
      const badge = document.getElementById("unanswered-inquiries-count");
      if (badge) badge.textContent = pendingInquiries.length;
      const attentionBadge = document.querySelector(".attention-item .badge.urgent");
      if (attentionBadge) attentionBadge.textContent = pendingInquiries.length;
    }
  } catch (error) {
    console.error("[GoodsbarnX/market] loadPendingRequests failed:", error);
  }
}

async function updateNetworkLinks() {
  if (!gmUser() || !window.sb) return;
  var u = gmUser();
  try {
    const { data: relationships, error: relError } = await sb
      .from("trade_relationships").select("id, buyer_id, status")
      .eq("distributor_id", u.id);
    if (!relError && Array.isArray(relationships)) {
      const buckets = { pending: 0, active: 0, paused: 0, released: 0, suspended: 0, terminated: 0 };
      let other = 0;
      relationships.forEach(function (r) {
        const s = String(r.status || "").toLowerCase();
        if (Object.prototype.hasOwnProperty.call(buckets, s)) buckets[s]++;
        else other++;
      });
      const countEl = document.getElementById("my-buyers-count");
      if (countEl) countEl.textContent = relationships.length;
      const parts = [];
      ["active", "pending", "paused", "suspended", "released", "terminated"].forEach(function (k) {
        if (buckets[k] > 0) parts.push(buckets[k] + " " + k);
      });
      if (other > 0) parts.push(other + " other");
      if (!parts.length) parts.push("none yet");
      const subEl = document.getElementById("my-buyers-sub");
      if (subEl) subEl.textContent = parts.join(" · ");
    }
    const { data: agents, error: agentError } = await sb
      .from("agent_distributor_attachments").select("id, agent_id, status")
      .eq("distributor_id", u.id).eq("status", "accepted");
    if (!agentError && Array.isArray(agents)) {
      const countEl = document.getElementById("my-agents-count");
      if (countEl) countEl.textContent = agents.length;
      const subEl = document.getElementById("my-agents-sub");
      if (subEl) subEl.textContent = agents.length + " active · 0 pending";
    }
  } catch (error) {
    console.error("[GoodsbarnX/market] updateNetworkLinks failed:", error);
  }
}

async function updateStats() {
  if (!window.sb) return;
  try {
    const { count: distributorCount, error: distError } = await sb
      .from("distributor_profiles").select("*", { count: "exact", head: true });
    if (!distError) {
      const statEl = document.getElementById("stat-distributors");
      if (statEl) statEl.textContent = distributorCount || 0;
    }
    if (gmRole() === "distributor") {
      const { count: buyerCount, error: buyerError } = await sb
        .from("buyer_profiles").select("*", { count: "exact", head: true });
      if (!buyerError) {
        const statEl = document.getElementById("stat-buyers");
        if (statEl) statEl.textContent = buyerCount || 0;
      }
    }
  } catch (error) {
    console.error("[GoodsbarnX/market] updateStats failed:", error);
  }
  syncHeroStats();
}

// The hero's "Buyers" tile is meaningless to a buyer. For buyers it becomes
// "In your network" (their active relationships); for everyone else it is
// restored to the original label.
function syncHeroStats() {
  var statEl = document.getElementById("stat-buyers");
  if (!statEl || !statEl.parentNode) return;
  var labelEl = statEl.parentNode.querySelector(".t");
  if (gmRole() === "buyer") {
    var G = gmGraph();
    var n = G.myRelationships.filter(function (r) { return r.status === "active"; }).length;
    statEl.textContent = String(n);
    if (labelEl) labelEl.textContent = "In your network";
  } else if (labelEl && labelEl.textContent === "In your network") {
    labelEl.textContent = "Buyers";
  }
}

// ==========================================================================
// TOOLBAR  (created once; updated in place so focus is never lost)
// ==========================================================================

function ensureToolbar() {
  var list = document.getElementById("distributor-list");
  if (!list || !list.parentNode) return null;
  var bar = document.getElementById("gm-toolbar");
  if (bar) return bar;

  bar = document.createElement("div");
  bar.id = "gm-toolbar";
  bar.className = "gm-toolbar";
  bar.innerHTML =
    '<div class="gm-toolbar-row">' +
      '<div class="gm-summary" id="gm-summary" aria-live="polite"></div>' +
      '<label class="gm-sort"><span>Sort</span>' +
        '<select id="gm-sort-select" data-market-sort="1" aria-label="Sort distributors">' +
          '<option value="best">Best match</option>' +
          '<option value="nearest">Nearest to me</option>' +
          '<option value="trusted">Most trusted</option>' +
          '<option value="az">A–Z</option>' +
        '</select>' +
      '</label>' +
    '</div>' +
    '<div class="gm-chips" id="gm-chips">' +
      '<button type="button" class="gm-chip" data-market-action="toggle-chip" data-chip="network" aria-pressed="false" id="gm-chip-network">' + ico("link", 14) + 'My network</button>' +
      '<button type="button" class="gm-chip" data-market-action="toggle-chip" data-chip="verified" aria-pressed="false">' + ico("shield", 14) + 'Verified</button>' +
      '<button type="button" class="gm-chip" data-market-action="toggle-chip" data-chip="saved" aria-pressed="false">' + ico("heart", 14) + 'Saved</button>' +
    '</div>';
  list.parentNode.insertBefore(bar, list);
  return bar;
}

function ensureDeskHost() {
  var h = document.getElementById("gm-desk");
  if (h) return h;
  var screen = document.getElementById("screen-market");
  if (!screen) return null;
  var anchor = screen.querySelector(".search-bar-wrap") || document.getElementById("distributor-list");
  if (!anchor || !anchor.parentNode) return null;
  h = document.createElement("div");
  h.id = "gm-desk";
  anchor.parentNode.insertBefore(h, anchor);
  return h;
}

function syncToolbar(shown, total) {
  var bar = ensureToolbar();
  if (!bar) return;
  var role = gmRole();

  var sum = document.getElementById("gm-summary");
  if (sum) {
    sum.innerHTML = (__gm.filtersActive
      ? 'Showing <b>' + shown + '</b> of ' + total + ' <button type="button" class="gm-link" data-market-action="clear-filters">Clear</button>'
      : '<b>' + total + '</b> distributor' + (total === 1 ? "" : "s"));
  }

  var sortEl = document.getElementById("gm-sort-select");
  if (sortEl) {
    var near = sortEl.querySelector('option[value="nearest"]');
    var hasCity = !!gmUserCity();
    if (near) { near.disabled = !hasCity; near.hidden = !hasCity; }
    if (__gm.sort === "nearest" && !hasCity) __gm.sort = "best";
    if (sortEl.value !== __gm.sort) sortEl.value = __gm.sort;
  }

  var netChip = document.getElementById("gm-chip-network");
  if (netChip) netChip.style.display = role === "buyer" ? "" : "none";
  bar.querySelectorAll("[data-chip]").forEach(function (c) {
    var k = c.getAttribute("data-chip");
    c.setAttribute("aria-pressed", __gm.chips[k] ? "true" : "false");
  });
}

// Vertical rail: decorate the existing .category-card elements with live
// counts. We never replace them, so selectCategory() / analytics attributes
// in index.html keep working.
function decorateCategoryRail(counts) {
  var cards = document.querySelectorAll("#screen-market .category-grid .category-card");
  var activeEl = null;
  cards.forEach(function (card) {
    var key = card.getAttribute("data-gbx-category") || "";
    var n = key === "All" ? (counts.All || 0) : (counts[key] || 0);
    var badge = card.querySelector(".gm-cat-n");
    if (!badge) {
      badge = document.createElement("b");
      badge.className = "gm-cat-n";
      card.appendChild(badge);
    }
    badge.textContent = String(n);
    card.classList.toggle("gm-empty", key !== "All" && n === 0);
    if (card.classList.contains("active")) activeEl = card;
  });
  var cat = gmCategory();
  if (cat !== __gm.lastCat) {
    __gm.lastCat = cat;
    if (activeEl && typeof activeEl.scrollIntoView === "function") {
      try { activeEl.scrollIntoView({ inline: "center", block: "nearest" }); } catch (e) { /* ignore */ }
    }
  }
}

// ==========================================================================
// FILTERS + RANKING
// ==========================================================================

function gmSearchTokens() {
  var el = document.getElementById("search-input");
  var q = el ? String(el.value || "").trim().toLowerCase() : "";
  return q ? q.split(/\s+/).filter(Boolean) : [];
}

function gmSortDistributors(arr, mode) {
  if (GM_SORTS.indexOf(mode) === -1) mode = "best";
  arr.sort(function (a, b) {
    var ea = enrichDistributorForViewer(a), eb = enrichDistributorForViewer(b);
    if (ea.isSelf !== eb.isSelf) return ea.isSelf ? -1 : 1;
    var c = 0;
    if (mode === "nearest") c = (gmSameCity(b) ? 1 : 0) - (gmSameCity(a) ? 1 : 0);
    else if (mode === "trusted") c = gmTierRank(b) - gmTierRank(a);
    if (c) return c;
    if (mode !== "az") { c = ea.relevance - eb.relevance; if (c) return c; }
    return String(a.business_name || "").localeCompare(String(b.business_name || ""));
  });
}

function applyFilters() {
  try { __gmApplyFilters(); }
  catch (err) { console.error("[GoodsbarnX/market] applyFilters failed:", err); }
}

function __gmApplyFilters() {
  __gm.enrich = Object.create(null);
  __gm.enrichB = Object.create(null);
  ensureMarketStyles();

  var tokens = gmSearchTokens();
  var locEl = document.getElementById("filter-location");
  var tierEl = document.getElementById("filter-tier");
  var lf = locEl ? String(locEl.value || "").toLowerCase() : "";
  var tf = tierEl ? String(tierEl.value || "").toLowerCase() : "";
  var cat = gmCategory();
  var role = gmRole();
  if (role !== "buyer") __gm.chips.network = false;

  var dists = gmDists();
  var buyers = gmBuyers();

  function hay(parts) { return parts.join(" ").toLowerCase(); }
  function tokensMatch(h) { return tokens.every(function (t) { return h.indexOf(t) !== -1; }); }

  // Everything except the vertical, so the rail can show what each vertical would give you.
  var base = dists.filter(function (d) {
    if (tokens.length && !tokensMatch(hay([d.business_name || "", d.location || "", d.market || "", d.category || ""]))) return false;
    if (lf && String(d.location || "").toLowerCase() !== lf) return false;
    if (tf && String(d.verification_tier || "").toLowerCase() !== tf) return false;
    if (__gm.chips.verified && gmTierRank(d) < 2) return false;
    if (__gm.chips.saved && !gmIsFav(d.id)) return false;
    if (__gm.chips.network && !gmIsInNetwork(enrichDistributorForViewer(d))) return false;
    return true;
  });

  var counts = { All: base.length };
  base.forEach(function (d) { var c = String(d.category || "").trim(); if (c) counts[c] = (counts[c] || 0) + 1; });

  var fd = cat === "All" ? base.slice() : base.filter(function (d) { return String(d.category || "").trim() === cat; });
  gmSortDistributors(fd, __gm.sort);

  __gm.filtersActive = !!(tokens.length || lf || tf || cat !== "All" || __gm.chips.verified || __gm.chips.saved || __gm.chips.network);

  // Buyers (distributor viewers only — V-B)
  var myCat = "";
  var selfRec = dists.find(function (d) { return gmUser() && d.id === gmUser().id; });
  if (selfRec) myCat = String(selfRec.category || "").trim();

  var fbBase = buyers.filter(function (b) {
    var name = b.name || (b.profiles && b.profiles.full_name) || "";
    if (tokens.length && !tokensMatch(hay([name, b.location || "", b.market || "", b.looking_for || ""]))) return false;
    if (lf && String(b.location || "").toLowerCase() !== lf) return false;
    if (cat !== "All" && String(b.looking_for || "").trim() !== cat) return false;
    return true;
  });
  var segCounts = { all: fbBase.length, network: 0, invited: 0, prior: 0, "new": 0 };
  fbBase.forEach(function (b) { segCounts[gmSegmentOf(enrichBuyerForViewer(b))]++; });
  var fb = __gm.segment === "all" ? fbBase.slice() : fbBase.filter(function (b) { return gmSegmentOf(enrichBuyerForViewer(b)) === __gm.segment; });
  fb.sort(function (a, b) {
    var ra = enrichBuyerForViewer(a).relevance - (myCat && String(a.looking_for || "").trim() === myCat ? 1 : 0);
    var rb = enrichBuyerForViewer(b).relevance - (myCat && String(b.looking_for || "").trim() === myCat ? 1 : 0);
    if (ra !== rb) return ra - rb;
    return String(a.name || "").localeCompare(String(b.name || ""));
  });
  __gm.myCat = myCat;
  __gm.segCounts = segCounts;

  renderDistributors(fd);
  renderBuyers(fb);
  syncToolbar(fd.length, dists.length);
  decorateCategoryRail(counts);
  syncHeroStats();

  var distCountEl = document.getElementById("distributor-count");
  if (distCountEl) distCountEl.textContent = fd.length;
  var buyerCountEl = document.getElementById("buyer-count");
  if (buyerCountEl && role === "distributor") buyerCountEl.textContent = fb.length;
}

function gmSegmentOf(e) {
  switch (e.relationship) {
    case "active": case "paused": case "suspended": case "pending_in": return "network";
    case "pending_out": return "invited";
    case "contacted": case "released": case "terminated": return "prior";
    default: return "new";
  }
}

// ==========================================================================
// L4 · RENDER HELPERS
// ==========================================================================

function gmInitials(name) {
  var parts = String(name || "").replace(/[\u0000-\u001F\u007F-\u009F]/g, "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  var s = parts.length === 1 ? parts[0].slice(0, 2) : parts[0].charAt(0) + parts[1].charAt(0);
  return s.toUpperCase();
}
function gmHue(id) {
  var h = 0, s = String(id || "");
  for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 5;
}

function gmBtn(action, label, o) {
  o = o || {};
  var cls = "gm-btn" + (o.kind ? " gm-btn--" + o.kind : "") + (o.sm ? " gm-btn--sm" : "");
  return '<button type="button" class="' + cls + '" data-market-action="' + escAttr(action) + '"' +
    (o.dist ? ' data-distributor-id="' + escAttr(o.dist) + '"' : "") +
    (o.buyer ? ' data-buyer-id="' + escAttr(o.buyer) + '"' : "") +
    (o.aria ? ' aria-label="' + escAttr(o.aria) + '"' : "") + '>' +
    (o.icon ? ico(o.icon, o.sm ? 15 : 17) : "") + (label ? '<span>' + escHtml(label) + '</span>' : "") +
  '</button>';
}

function gmSecHead(kicker, n, hint) {
  return '<div class="gm-sec"><span class="gm-kicker">' + escHtml(kicker) + '</span>' +
    (n != null ? '<span class="gm-n">' + escHtml(n) + '</span>' : "") +
    (hint ? '<span class="gm-hint">' + escHtml(hint) + '</span>' : "") + '</div>';
}

function gmTierTag(tier) {
  var t = String(tier || "").toLowerCase();
  if (t === "association") return '<span class="gm-tag gm-tag--ok">' + ico("shield", 12) + 'Association verified</span>';
  if (t === "market board") return '<span class="gm-tag gm-tag--ok">' + ico("shield", 12) + 'Market board</span>';
  if (t === "self-attested") return '<span class="gm-tag">Self-attested</span>';
  return "";
}

function gmEmptyState(title, text, btnHtml, iconSvg) {
  return '<div class="gm-empty-state"><div class="gm-ico">' + (iconSvg || MARKET_ICON_SVG) + '</div>' +
    '<h4>' + escHtml(title) + '</h4><p>' + escHtml(text) + '</p>' + (btnHtml || "") + '</div>';
}

function renderMarketSkeleton() {
  var c = document.getElementById("distributor-list");
  if (c) c.innerHTML = '<div class="gm-skel"></div><div class="gm-skel"></div><div class="gm-skel"></div>';
}

// ==========================================================================
// L4 · RENDER — console (relationship desk)
// ==========================================================================

function gmFindDist(id) { return gmDists().find(function (x) { return x && x.id === id; }); }
function gmFindBuyer(id) { return gmBuyers().find(function (x) { return x && x.id === id; }); }

function gmBuyerAttention() {
  var G = gmGraph(), items = [];
  G.myPendingInbound.forEach(function (p) {
    var d = gmFindDist(p.distributor_id); if (!d) return;
    items.push({ prio: 1, tone: "info", icon: "link", title: (d.business_name || "A distributor") + " wants to connect",
      meta: "Connection request" + (p.created_at ? " · " + gmAgo(p.created_at) : ""),
      btns: gmBtn("review-requests", "Review", { kind: "primary", sm: true, dist: d.id }) });
  });
  Object.keys(G.myInquiries).forEach(function (did) {
    var d = gmFindDist(did), iq = G.myInquiries[did];
    if (!d || !iq || iq.pending < 1) return;
    var e = enrichDistributorForViewer(d);
    if (e.relationship === "active") return;
    var days = iq.lastPendingAt ? gmDaysSince(iq.lastPendingAt) : null;
    if (days != null && days < 1) return;
    items.push({ prio: 3, tone: "warn", icon: "clock", title: (d.business_name || "Distributor") + " hasn't replied",
      meta: "Inquiry sent" + (iq.lastPendingAt ? " " + gmAgo(iq.lastPendingAt) : "") + (iq.pending > 1 ? " · " + iq.pending + " open" : ""),
      btns: isValidNgPhone(gmPhoneOf(d))
        ? gmBtn("nudge", "Nudge", { kind: "wa", sm: true, icon: "chat", dist: d.id, aria: "Follow up with " + (d.business_name || "distributor") + " on WhatsApp" })
        : gmBtn("open-storefront", "Storefront", { sm: true, dist: d.id }) });
  });
  G.myRelationships.forEach(function (r) {
    if (r.status !== "released" && r.status !== "terminated" && r.status !== "paused") return;
    var d = gmFindDist(r.distributor_id); if (!d) return;
    items.push({ prio: 4, tone: "ok", icon: "refresh", title: (r.status === "paused" ? "Resume with " : "Rekindle ") + (d.business_name || "distributor"),
      meta: GM_REL_STATES[r.status].l + (r.since ? " · " + gmTenure(r.since).replace("Trading since ", "since ") : ""),
      btns: gmBtn("rekindle", r.status === "paused" ? "Resume" : "Rekindle", { kind: "primary", sm: true, dist: d.id }) });
  });
  items.sort(function (a, b) { return a.prio - b.prio; });
  return items;
}

function gmBuyerConsole() {
  var G = gmGraph();
  var active = G.myRelationships.filter(function (r) { return r.status === "active"; }).length;
  var requests = G.myPendingInbound.length;
  var awaiting = Object.keys(G.myInquiries).filter(function (k) { return G.myInquiries[k].pending > 0; }).length;
  var items = gmBuyerAttention().slice(0, 4);

  var pulse = '<span><b>' + active + '</b> active</span>' +
    (requests ? '<span class="is-info"><b>' + requests + '</b> request' + (requests === 1 ? "" : "s") + '</span>' : "") +
    (awaiting ? '<span class="is-warn"><b>' + awaiting + '</b> awaiting reply</span>' : "");

  if (!items.length && !active && !requests && !awaiting) {
    return '<section class="gm-console" aria-label="Relationship desk"><div class="gm-console-head"><span class="gm-kicker">Relationship desk</span></div>' +
      '<p class="gm-lead">No trading relationships yet. Inquire with a verified distributor, or open a storefront, to start your first trade line.</p></section>';
  }
  return '<section class="gm-console" aria-label="Relationship desk"><div class="gm-console-head"><span class="gm-kicker">Relationship desk</span>' +
    '<div class="gm-pulse">' + pulse + '</div></div>' +
    (items.length ? gmAttList(items) : '<p class="gm-lead">All caught up — nothing needs your attention.</p>') + '</section>';
}

function gmAttList(items) {
  return '<ul class="gm-att">' + items.map(function (it) {
    return '<li class="gm-att-item" data-tone="' + escAttr(it.tone) + '"><span class="gm-att-ic">' + ico(it.icon, 17) + '</span>' +
      '<div class="gm-att-body"><div class="gm-att-title">' + escHtml(it.title) + '</div><div class="gm-att-meta">' + escHtml(it.meta) + '</div></div>' +
      it.btns + '</li>';
  }).join("") + '</ul>';
}

function gmDistributorAttention() {
  var G = gmGraph(), items = [];
  G.myPendingOutbound.forEach(function (p) {
    var days = p.created_at ? gmDaysSince(p.created_at) : null;
    if (days != null && days < 2) return;
    var b = gmFindBuyer(p.buyer_id); if (!b) return;
    var name = b.name || (b.profiles && b.profiles.full_name) || "A buyer";
    items.push({ prio: 1, tone: "warn", icon: "clock", title: "Invitation to " + name + " is unanswered",
      meta: "Sent" + (p.created_at ? " " + gmAgo(p.created_at) : ""),
      btns: isValidNgPhone(gmPhoneOf({ profiles: b.profiles }))
        ? gmBtn("nudge-buyer", "Nudge", { kind: "wa", sm: true, icon: "chat", buyer: b.id, aria: "Follow up with " + name + " on WhatsApp" })
        : "" });
  });
  var related = new Set();
  G.myRelationships.forEach(function (r) { related.add(r.buyer_id); });
  G.myPendingOutbound.forEach(function (p) { related.add(p.buyer_id); });
  var conv = 0;
  G.contactedSet.forEach(function (bid) {
    if (related.has(bid) || conv >= 3) return;
    var b = gmFindBuyer(bid); if (!b) return;
    conv++;
    items.push({ prio: 2, tone: "ok", icon: "userplus", title: (b.name || (b.profiles && b.profiles.full_name) || "A buyer") + " — prior contact, not in your network",
      meta: "Turn this conversation into a trading relationship",
      btns: gmBtn("invite-buyer", "Invite", { kind: "primary", sm: true, buyer: b.id }) });
  });
  items.sort(function (a, b) { return a.prio - b.prio; });
  return items;
}

function gmDistributorConsole() {
  var G = gmGraph();
  var active = G.myRelationships.filter(function (r) { return r.status === "active"; }).length;
  var invited = G.myPendingOutbound.length;
  var requests = G.myRelationships.filter(function (r) { return r.status === "pending"; }).length;
  var items = gmDistributorAttention().slice(0, 4);
  var pulse = '<span><b>' + active + '</b> active</span>' +
    (requests ? '<span class="is-info"><b>' + requests + '</b> requested you</span>' : "") +
    (invited ? '<span class="is-warn"><b>' + invited + '</b> invited</span>' : "");
  return '<section class="gm-console" aria-label="Relationship desk"><div class="gm-console-head"><span class="gm-kicker">Relationship desk</span>' +
    '<div class="gm-pulse">' + pulse + '</div></div>' +
    (items.length ? gmAttList(items) : '<p class="gm-lead">No follow-ups due. Invite buyers from the roster below to grow your network.</p>') + '</section>';
}

function renderEngineStrip(engineCtx) {
  if (!engineCtx || engineCtx.source === "unavailable") return "";
  if (!engineCtx.highCount && !engineCtx.depletingCount) return "";
  var parts = [];
  if (engineCtx.highCount > 0) parts.push(engineCtx.highCount + " high-urgency signal" + (engineCtx.highCount === 1 ? "" : "s"));
  if (engineCtx.depletingCount > 0) parts.push(engineCtx.depletingCount + " depleting product" + (engineCtx.depletingCount === 1 ? "" : "s"));
  var ageLabel = engineCtx.freshnessMs != null ? " · updated " + formatMarketAge(engineCtx.freshnessMs) + " ago" : "";
  var consoleEl = document.getElementById("depletor-console");
  var actionable = !!(consoleEl && !consoleEl.hidden);
  var inner = '<span class="gm-engine-dot"></span><span>' + escHtml(parts.join(" · ") + ageLabel) + '</span>' +
    (actionable ? '<span class="gm-engine-go">View ›</span>' : "");
  return actionable
    ? '<button type="button" class="gm-engine" data-fresh="' + escAttr(engineCtx.source) + '" data-market-action="scroll-signals">' + inner + '</button>'
    : '<div class="gm-engine" data-fresh="' + escAttr(engineCtx.source) + '">' + inner + '</div>';
}

// ==========================================================================
// L4 · RENDER — distributors
// ==========================================================================

function renderDistributors(list) {
  const container = document.getElementById("distributor-list");
  if (!container) { warnMissingTarget("distributor-list"); return; }
  ensureMarketStyles();

  if (__gm.loadError && !gmDists().length) {
    var dh = ensureDeskHost(); if (dh) dh.innerHTML = "";
    container.innerHTML = gmEmptyState("Couldn't load the market", __gm.loadError,
      gmBtn("retry-load", "Try again", { kind: "primary", icon: "refresh" }));
    return;
  }

  list = Array.isArray(list) ? list : [];
  var role = gmRole();
  var html = "";

  // The desk lives in its own host above the search bar so it is the first
  // thing after the hero and never jumps while the viewer types a search.
  var desk = "";
  if (!gmUser()) {
    desk += '<div class="gm-guest"><p><b>Browsing as a guest.</b> Log in to see your network, track inquiries and trade with relationship terms.</p>' +
      gmBtn("login", "Log in", { kind: "primary", sm: true }) + '</div>';
  }
  if (role === "buyer") desk += gmBuyerConsole();
  else if (role === "distributor") desk += gmDistributorConsole();
  desk += renderEngineStrip(getMarketEngineContext());

  var host = ensureDeskHost();
  if (host) host.innerHTML = desk; else html += desk;

  if (!list.length) {
    html += __gm.filtersActive
      ? gmEmptyState("No distributors match", "Try a different vertical or loosen a filter.", gmBtn("clear-filters", "Clear filters", { kind: "primary" }))
      : gmEmptyState("No distributors yet", "Check back soon — new distributors are verified daily.", "");
    container.innerHTML = html;
    return;
  }

  var selfs = list.filter(function (d) { return enrichDistributorForViewer(d).isSelf; });
  var rest = list.filter(function (d) { return !enrichDistributorForViewer(d).isSelf; });

  if (selfs.length) html += selfs.map(function (d) { return renderDistributorCard(d); }).join("");

  if (role === "buyer") {
    var net = rest.filter(function (d) { return gmIsInNetwork(enrichDistributorForViewer(d)); });
    var disc = rest.filter(function (d) { return !gmIsInNetwork(enrichDistributorForViewer(d)); });
    if (net.length) html += gmSecHead("Your network", net.length) + net.map(function (d) { return renderDistributorCard(d, { net: true }); }).join("");
    if (disc.length) html += gmSecHead(net.length ? "Discover" : "Distributors", disc.length, __gm.sort === "best" ? "Ranked by trust & proximity" : "") +
      disc.map(function (d) { return renderDistributorCard(d); }).join("");
  } else {
    html += rest.map(function (d) { return renderDistributorCard(d); }).join("");
  }
  container.innerHTML = html;
}

function gmDistActions(d, e, phoneOk) {
  var id = d.id, nm = d.business_name || "distributor";
  var wa = phoneOk ? gmBtn("whatsapp", "", { kind: "wa", icon: "chat", dist: id, aria: "WhatsApp " + nm }) : "";
  var store = function (kind) { return gmBtn("open-storefront", "Storefront", { kind: kind, icon: "store", dist: id }); };
  var inq = function (kind) { return gmBtn("inquire", "Inquire", { kind: kind, icon: "msg", dist: id }); };

  if (e.isSelf) return gmBtn("edit-profile", "Edit profile", { kind: "ghost", icon: "edit" }) + store("primary");
  switch (e.relationship) {
    case "active":      return store("primary") + inq("ghost") + wa;
    case "pending_in":  return gmBtn("review-requests", "Review request", { kind: "primary", icon: "link", dist: id }) + store("ghost");
    case "pending_out": return store("primary") + inq("ghost") + wa;
    case "paused": case "released": case "terminated":
      return gmBtn("rekindle", e.relationship === "paused" ? "Resume" : "Rekindle", { kind: "primary", icon: "refresh", dist: id }) + store("ghost") + wa;
    default:            return store("ghost") + inq("primary") + wa;
  }
}

function renderDistributorCard(d, opts) {
  opts = opts || {};
  var e = enrichDistributorForViewer(d);
  var id = escAttr(d.id);
  var name = d.business_name || "Distributor";
  var phoneOk = isValidNgPhone(gmPhoneOf(d));
  var fav = gmIsFav(d.id);

  var locBits = [];
  if (d.location) locBits.push(escHtml(d.location));
  if (d.market) locBits.push(escHtml(d.market));
  var loc = locBits.length
    ? ico("pin", 13) + '<span>' + locBits.join(" · ") + '</span>'
    : '<span class="gm-mute">Location not set</span>';

  var tags = "";
  if (e.label && !e.isSelf) tags += '<span class="gm-tag ' + (e.relationship === "active" ? "gm-tag--rel" : (e.relationship === "pending_in" || e.relationship === "pending_out") ? "gm-tag--info" : "gm-tag--warn") + '">' + escHtml(e.label) + '</span>';
  if (e.isSelf) tags += '<span class="gm-tag gm-tag--brass">Your listing</span>';
  tags += gmTierTag(d.verification_tier);
  tags += d.category
    ? '<span class="gm-tag gm-tag--brass">' + escHtml(String(d.category)) + '</span>'
    : '<span class="gm-tag">Unclassified</span>';
  if (!e.isSelf && gmSameCity(d)) tags += '<span class="gm-tag gm-tag--info">' + ico("pin", 11) + 'Your city</span>';
  if (!e.isSelf && e.relationship === "none" && e.inquiry && e.inquiry.pending > 0) {
    var dd = e.inquiry.lastPendingAt ? gmDaysSince(e.inquiry.lastPendingAt) : null;
    tags += '<span class="gm-tag gm-tag--warn">' + ico("clock", 11) + 'Inquiry sent' + (e.inquiry.lastPendingAt ? " · " + escHtml(gmAgo(e.inquiry.lastPendingAt)) : "") + (dd != null && dd >= 1 ? " · no reply" : "") + '</span>';
  }

  var tenure = (opts.net && e.since && e.relationship === "active") ? '<div class="gm-tenure">' + escHtml(gmTenure(e.since)) + '</div>' : "";

  return '<article class="manifest gm-card" data-distributor-id="' + id + '" data-rel="' + escAttr(e.relationship) + '">' +
    '<div class="gm-head">' +
      '<div class="gm-av gm-av-' + gmHue(d.id) + '" aria-hidden="true">' + escHtml(gmInitials(name)) + '</div>' +
      '<div class="gm-id"><div class="gm-name">' + escHtml(name) + '</div><div class="gm-loc">' + loc + '</div>' + tenure + '</div>' +
      (e.isSelf ? "" :
        '<button type="button" class="fav-btn gm-fav" data-market-action="toggle-favourite" data-distributor-id="' + id + '" aria-pressed="' + (fav ? "true" : "false") + '" aria-label="Save ' + escAttr(name) + '">' +
          '<span data-fav-for="' + id + '">' + gmFavIcon(fav) + '</span></button>') +
    '</div>' +
    '<div class="gm-tags">' + tags + '</div>' +
    '<div class="gm-acts">' + gmDistActions(d, e, phoneOk) + '</div>' +
    (e.isSelf ? "" : '<div class="gm-foot"><button type="button" class="gm-report" data-market-action="dispute" data-distributor-id="' + id + '">Report an issue</button></div>') +
  '</article>';
}

// ==========================================================================
// L4 · RENDER — buyers (V-B: double-guarded)
// ==========================================================================

function renderBuyers(list) {
  const container = document.getElementById("buyer-list");
  if (!container) { warnMissingTarget("buyer-list"); return; }

  // F-3: sibling lookup instead of :has() (throws on older WebViews).
  var label = container.previousElementSibling;
  if (label && !(label.classList && label.classList.contains("section-label"))) label = null;

  // V-B guard: only distributors can see the buyer roster.
  if (gmRole() !== "distributor") {
    container.style.display = "none";
    container.innerHTML = "";
    if (label) label.style.display = "none";
    return;
  }
  container.style.display = "";
  if (label) label.style.display = "";
  ensureMarketStyles();

  var sc = __gm.segCounts || { all: 0, network: 0, invited: 0, prior: 0, "new": 0 };
  var segLabels = { all: "All", network: "In network", invited: "Invited", prior: "Prior contact", "new": "New" };
  var seg = '<div class="gm-seg" role="group" aria-label="Filter buyers by relationship">' +
    GM_SEGMENTS.map(function (k) {
      return '<button type="button" data-market-action="buyer-segment" data-segment="' + k + '" aria-pressed="' + (__gm.segment === k ? "true" : "false") + '">' +
        segLabels[k] + ' <b>' + (sc[k] || 0) + '</b></button>';
    }).join("") + '</div>';

  if (!Array.isArray(list) || list.length === 0) {
    container.innerHTML = seg + gmEmptyState("No buyers here", __gm.segment === "all" ? "Start by inviting buyers to your network." : "No buyers in this segment — try another.", "", BUYER_ICON_SVG);
    return;
  }

  container.innerHTML = seg + list.map(function (b) {
    const name = b.name || (b.profiles && b.profiles.full_name) || "Buyer";
    const phoneOk = isValidNgPhone(b.profiles && b.profiles.phone);
    const e = enrichBuyerForViewer(b);
    const bid = escAttr(b.id);

    var tags = "";
    if (e.label) tags += '<span class="gm-tag ' + (e.relationship === "active" ? "gm-tag--rel" : (e.relationship === "pending_out" || e.relationship === "pending_in") ? "gm-tag--info" : "gm-tag--warn") + '">' + escHtml(e.label) + (e.relationship === "pending_out" && e.pendingAt ? " · " + escHtml(gmAgo(e.pendingAt)) : "") + '</span>';
    tags += '<span class="gm-tag gm-tag--brass">' + escHtml(String(b.looking_for || "Buyer")) + '</span>';
    if (__gm.myCat && String(b.looking_for || "").trim() === __gm.myCat) tags += '<span class="gm-tag gm-tag--ok">' + ico("bolt", 11) + 'Matches your vertical</span>';

    var locBits = [];
    if (b.location) locBits.push(escHtml(b.location));
    if (b.market) locBits.push(escHtml(b.market));
    var loc = locBits.length ? ico("pin", 13) + '<span>' + locBits.join(" · ") + '</span>' : '<span class="gm-mute">Location not set</span>';

    var wa = phoneOk ? gmBtn("whatsapp-buyer", "", { kind: "wa", icon: "chat", buyer: b.id, aria: "WhatsApp " + name }) : "";
    var acts;
    if (e.relationship === "none") acts = gmBtn("invite-buyer", "Invite to network", { kind: "primary", icon: "userplus", buyer: b.id }) + gmBtn("inquire-buyer", "Inquire", { kind: "ghost", icon: "msg", buyer: b.id }) + wa;
    else if (e.relationship === "pending_out") acts = gmBtn("inquire-buyer", "Inquire", { kind: "ghost", icon: "msg", buyer: b.id }) + (phoneOk ? gmBtn("nudge-buyer", "Nudge", { kind: "primary", icon: "chat", buyer: b.id }) : "");
    else if (e.relationship === "pending_in") acts = gmBtn("review-requests", "Review request", { kind: "primary", icon: "link", buyer: b.id }) + gmBtn("inquire-buyer", "Inquire", { kind: "ghost", icon: "msg", buyer: b.id }) + wa;
    else if (e.relationship === "active") acts = gmBtn("inquire-buyer", "Inquire", { kind: "primary", icon: "msg", buyer: b.id }) + wa;
    else acts = gmBtn("invite-buyer", e.relationship === "contacted" ? "Invite to network" : "Re-invite", { kind: "primary", icon: "userplus", buyer: b.id }) + gmBtn("inquire-buyer", "Inquire", { kind: "ghost", icon: "msg", buyer: b.id }) + wa;

    return '<article class="manifest gm-card" data-buyer-id="' + bid + '" data-rel="' + escAttr(e.relationship) + '">' +
      '<div class="gm-head"><div class="gm-av gm-av-' + gmHue(b.id) + '" aria-hidden="true">' + escHtml(gmInitials(name)) + '</div>' +
      '<div class="gm-id"><div class="gm-name">' + escHtml(name) + '</div><div class="gm-loc">' + loc + '</div>' +
      (e.since && e.relationship === "active" ? '<div class="gm-tenure">' + escHtml(gmTenure(e.since)) + '</div>' : "") + '</div></div>' +
      '<div class="gm-tags">' + tags + '</div><div class="gm-acts">' + acts + '</div></article>';
  }).join("");
}

// ==========================================================================
// L5 · INTERACTION — delegated handlers (V-A)
// ==========================================================================

var GM_NEEDS_DIST = { "open-storefront": 1, "inquire": 1, "whatsapp": 1, "nudge": 1, "dispute": 1, "toggle-favourite": 1, "rekindle": 1 };
var GM_NEEDS_BUYER = { "inquire-buyer": 1, "whatsapp-buyer": 1, "nudge-buyer": 1 };

async function handleMarketClick(e) {
  var t = e.target && e.target.closest ? e.target.closest("[data-market-action]") : null;
  if (!t) return;

  var action = t.getAttribute("data-market-action");
  var distId = t.getAttribute("data-distributor-id");
  var buyerId = t.getAttribute("data-buyer-id");

  // V-C: validate before dispatch.
  if (GM_NEEDS_DIST[action] && !isValidUuid(distId)) return;
  if (GM_NEEDS_BUYER[action] && !isValidUuid(buyerId)) return;
  if (buyerId && !isValidUuid(buyerId)) buyerId = null;   // optional ids must still be valid

  e.preventDefault();
  try {
    switch (action) {
      case "open-storefront":
        marketOpenDistributorContext(distId, "storefront"); return;

      case "inquire":
        marketOpenDistributorContext(distId, "inquire", gmDistName(distId)); return;

      case "rekindle":
        marketOpenDistributorContext(distId, "inquire", gmDistName(distId));
        gmPrefill("inquiry-item", "Resume trading relationship");
        return;

      case "whatsapp": {
        var d = gmFindDist(distId);
        if (d) openWhatsApp(gmPhoneOf(d), gmDistName(distId));
        return;
      }
      case "nudge": {
        var d2 = gmFindDist(distId);
        if (d2) openWhatsApp(gmPhoneOf(d2), gmDistName(distId), "Hi " + gmSafeName(gmDistName(distId)) + ", following up on my inquiry on GoodsbarnX. Are you able to help?");
        return;
      }
      case "dispute":
        if (typeof openDisputeModal === "function") openDisputeModal(distId, gmDistName(distId));
        return;

      case "toggle-favourite":
        if (typeof toggleFavourite === "function") {
          var r = toggleFavourite(e, distId);
          Promise.resolve(r).then(function () {
            gmSyncFav(distId);
            if (__gm.chips.saved) applyFilters();
          }, function () { gmSyncFav(distId); });
        }
        return;

      case "review-requests":
        if (typeof showScreen === "function") showScreen("relationship");
        return;

      case "edit-profile":
        if (typeof showScreen === "function") showScreen("profile");
        return;

      case "login":
        if (typeof window.showAuthShell === "function") window.showAuthShell("login");
        return;

      case "invite-buyer":
        if (typeof openInviteBuyerModal === "function") {
          openInviteBuyerModal();
          if (buyerId) {
            var bn = gmBuyerName(buyerId);
            var inp = document.getElementById("invite-buyer-search");
            if (inp && bn && bn !== "Buyer") {
              inp.value = bn.slice(0, 40);
              if (typeof searchBuyersForInvite === "function") searchBuyersForInvite();
            }
          }
        }
        return;

      case "inquire-buyer":
        if (typeof openModal === "function") openModal(buyerId, gmBuyerName(buyerId), "buyer");
        return;

      case "whatsapp-buyer": {
        var b = gmFindBuyer(buyerId);
        if (b) openWhatsApp(b.profiles && b.profiles.phone, gmBuyerName(buyerId));
        return;
      }
      case "nudge-buyer": {
        var b2 = gmFindBuyer(buyerId);
        if (b2) openWhatsApp(b2.profiles && b2.profiles.phone, gmBuyerName(buyerId), "Hi " + gmSafeName(gmBuyerName(buyerId)) + ", I sent you a connection invite on GoodsbarnX. Please check your Network tab when you can.");
        return;
      }

      case "toggle-chip": {
        var chip = t.getAttribute("data-chip");
        if (GM_CHIPS.indexOf(chip) === -1) return;
        __gm.chips[chip] = !__gm.chips[chip];
        applyFilters(); return;
      }
      case "buyer-segment": {
        var seg = t.getAttribute("data-segment");
        if (GM_SEGMENTS.indexOf(seg) === -1) return;
        __gm.segment = seg;
        applyFilters(); return;
      }
      case "clear-filters":
        gmClearFilters(); return;

      case "retry-load":
        __gm.loadError = null;
        marketInvalidateGraph();
        await loadDistributorsAndBuyers(); return;

      case "scroll-signals": {
        var el = document.getElementById("depletor-console");
        if (el && !el.hidden && el.scrollIntoView) el.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
    }
  } catch (err) {
    console.error("[GoodsbarnX/market] action '" + action + "' failed:", err);
  }
}

function handleMarketChange(e) {
  var t = e.target;
  if (!t || !t.getAttribute || !t.getAttribute("data-market-sort")) return;
  var v = String(t.value || "");
  if (GM_SORTS.indexOf(v) === -1) return;
  __gm.sort = v;
  applyFilters();
}

function gmClearFilters() {
  var s = document.getElementById("search-input"); if (s) s.value = "";
  var l = document.getElementById("filter-location"); if (l) l.value = "";
  var t = document.getElementById("filter-tier"); if (t) t.value = "";
  __gm.chips = { network: false, verified: false, saved: false };
  __gm.segment = "all";
  if (typeof toggleSearchClear === "function") { try { toggleSearchClear(); } catch (e) { /* ignore */ } }
  var allCard = document.querySelector('#screen-market .category-card[data-gbx-category="All"]');
  if (typeof selectCategory === "function" && allCard) {
    try { selectCategory("All", allCard); } catch (e) { /* ignore */ }
  }
  if (gmCategory() !== "All") {
    try { activeCategory = "All"; } catch (e) { /* declared const elsewhere: leave */ }
    document.querySelectorAll("#screen-market .category-card").forEach(function (c) {
      c.classList.toggle("active", c === allCard);
    });
  }
  applyFilters();
}

function gmSyncFav(distId) {
  if (!isValidUuid(distId)) return;
  var on = gmIsFav(distId);
  document.querySelectorAll('#screen-market [data-fav-for="' + distId + '"]').forEach(function (sp) {
    sp.innerHTML = gmFavIcon(on);
    if (sp.parentNode && sp.parentNode.setAttribute) sp.parentNode.setAttribute("aria-pressed", on ? "true" : "false");
  });
}

function gmPrefill(id, text) {
  var el = document.getElementById(id);
  if (el && !el.value) el.value = text;
}
function gmSafeName(n) { return String(n || "").replace(/[\u0000-\u001F\u007F-\u009F]/g, "").slice(0, 40); }
function gmDistName(id) { var d = gmFindDist(id); return (d && d.business_name) || "Distributor"; }
function gmBuyerName(id) { var b = gmFindBuyer(id); return (b && (b.name || (b.profiles && b.profiles.full_name))) || "Buyer"; }

// Legacy helper names (kept; other modules or console tooling may call them).
function distNameFor(distId) { return gmDistName(distId); }
function phoneForDistributor(distId) { var d = gmFindDist(distId); return gmPhoneOf(d); }
function buyerNameFor(buyerId) { return gmBuyerName(buyerId); }

function bindMarketEvents() {
  var screen = document.getElementById("screen-market");
  if (!screen) { warnMissingTarget("screen-market"); return; }
  ensureMarketStyles();
  if (screen.__marketBound) return;
  screen.__marketBound = true;
  screen.addEventListener("click", handleMarketClick);
  screen.addEventListener("change", handleMarketChange);
}

// ==========================================================================
// marketOpenDistributorContext — V-C validated
// ==========================================================================

function marketOpenDistributorContext(distributorId, action, distributorName) {
  if (!isValidUuid(distributorId)) {
    console.warn("[GoodsbarnX/market] rejected non-UUID distributor id");
    return;
  }
  emitDistributorView(distributorId);

  if (action === "storefront") {
    if (typeof openStorefrontModal === "function") openStorefrontModal(distributorId);
  } else if (action === "inquire") {
    if (typeof openModal === "function") openModal(distributorId, distributorName || "Distributor", "distributor");
  }
}

// ==========================================================================
// openWhatsApp — V-D validated, F-2 canonical 234… format
// ==========================================================================

function openWhatsApp(phone, name, message) {
  var digits = normalizeNgPhone(phone);
  if (!digits) {
    console.warn("[GoodsbarnX/market] rejected invalid phone number");
    return;
  }
  var safeName = gmSafeName(name);
  var text = message ? String(message).replace(/[\u0000-\u001F\u007F-\u009F]/g, "").slice(0, 300)
                     : "Hi " + safeName + ", I found you on GoodsbarnX.";
  window.open("https://wa.me/" + digits + "?text=" + encodeURIComponent(text), "_blank", "noopener,noreferrer");
}

// ==========================================================================
// SCREEN LOADER
// ==========================================================================

(function registerMarketScreen() {
  if (typeof registerScreenLoader !== "function") {
    console.warn("[GoodsbarnX/market] registerScreenLoader unavailable; market screen has no loader.");
    return;
  }
  registerScreenLoader("market", async function marketLoader() {
    bindMarketEvents();
    ensureToolbar();
    await loadDistributorsAndBuyers();   // F-10: updateStats already runs inside
  });
})();

if (typeof window !== "undefined") {
  if (document.readyState === "complete" || document.readyState === "interactive") {
    setTimeout(function () { bindMarketEvents(); ensureToolbar(); }, 0);
  } else {
    window.addEventListener("DOMContentLoaded", function () { bindMarketEvents(); ensureToolbar(); });
  }
}

// ==========================================================================
// GLOBAL EXPORTS
// ==========================================================================

window.loadDistributorsAndBuyers = loadDistributorsAndBuyers;
window.applyFilters = applyFilters;
window.updateStats = updateStats;
window.renderDistributors = renderDistributors;
window.renderBuyers = renderBuyers;
window.openWhatsApp = openWhatsApp;
window.marketOpenDistributorContext = marketOpenDistributorContext;
window.updateInquiryCountRing = updateInquiryCountRing;
window.marketInvalidateGraph = marketInvalidateGraph;   // call after accept/decline/terminate to refresh the desk

console.log("[GoodsbarnX] market.js loaded (V1.8.2.7 rev.7 · Relationship Desk)");
