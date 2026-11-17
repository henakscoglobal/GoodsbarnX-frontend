// ==========================================================================
// GoodsbarnX — profile.js  (rev. 2 · Commercial identity card)
// Plain global script. Loads thirteenth (Canon §10).
//
// V1.8.2.6 remediation Phase 1+2 (retained):
//   - Cross-module calls into relationship.js are typeof-guarded.
//   - All DOM lookups null-safe.
//   - saveProfile surfaces error.message.
//   - Registered a "profile" screen loader (Phase 2.3).
//   - toggleFavourite is canonical and lives HERE.
//
// Elite rebuild (rev. 2):
//   The Profile screen is no longer a form to be filled. It is the user's
//   commercial identity card — the same tier, trust score, and relationship
//   count that Market / Storefront / Trust show about them, shown to them.
//
//   Layers:
//     L1 · Identity view  — "as the network sees you" (read-only, above form)
//     L2 · Edit form      — existing fields, validated, save-guarded
//     L3 · Commercial     — per-role action rail below the form
//     L4 · Evidence §29   — every rendered number traceable to a schema field
//
//   Preservation contract:
//     • loadProfile(), saveProfile(), toggleFavourite() — signatures unchanged.
//     • All existing #screen-profile DOM ids preserved.
//     • All Supabase queries preserved.
//     • registerScreenLoader("profile", ...) unchanged.
//     • Two new containers are injected into #screen-profile at load time
//       if they don't exist (#profile-identity-view, #profile-actions).
//       index.html needs no change.
// ==========================================================================

// --------------------------------------------------------------------------
// SMALL HELPERS
// --------------------------------------------------------------------------

function profileEscHtml(v) {
  return String(v == null ? "" : v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
function profileEscAttr(v) { return profileEscHtml(v); }

function profileNum(v, fallback) {
  var n = Number(v);
  return Number.isFinite(n) ? n : (fallback == null ? 0 : fallback);
}

var __gbxProfileWarned = Object.create(null);
function profileWarnMissing(id) {
  if (__gbxProfileWarned[id]) return;
  __gbxProfileWarned[id] = true;
  console.warn("[GoodsbarnX/profile] DOM target #" + id + " is missing from index.html.");
}

// Snapshot of loaded profile — used by Cancel and by save's "did anything change" check.
var __gbxProfileSnapshot = null;

// Validation state — the save button disables until this is all true
// AND the form is dirty.
var __gbxProfileDirty = false;

// --------------------------------------------------------------------------
// DOM SCAFFOLD — inject the identity view + action rail if missing
//
// We do this instead of editing index.html so the deployment is one file.
// The containers sit inside #screen-profile, adjacent to #profile-form.
// If they already exist (e.g. from a future index.html change), the
// injection is a no-op.
// --------------------------------------------------------------------------

function ensureProfileScaffold() {
  var screen = document.getElementById("screen-profile");
  if (!screen) { profileWarnMissing("screen-profile"); return; }
  var form = document.getElementById("profile-form");
  if (!form) { profileWarnMissing("profile-form"); return; }

  if (!document.getElementById("profile-identity-view")) {
    var identity = document.createElement("div");
    identity.id = "profile-identity-view";
    identity.className = "profile-identity-view";
    form.parentNode.insertBefore(identity, form);
  }

  if (!document.getElementById("profile-actions")) {
    var actions = document.createElement("div");
    actions.id = "profile-actions";
    actions.className = "profile-actions";
    // Insert after the form
    if (form.nextSibling) {
      form.parentNode.insertBefore(actions, form.nextSibling);
    } else {
      form.parentNode.appendChild(actions);
    }
  }

  // Bind the delegated handler once
  if (!screen.__profileBound) {
    screen.__profileBound = true;
    screen.addEventListener("click", handleProfileClick);
  }
}

// --------------------------------------------------------------------------
// L1 · IDENTITY VIEW — "as the network sees you"
//
// Reads from the same schema sources Market / Storefront / Trust read.
// Never fabricates. Missing data renders as an honest line, not a zero.
// --------------------------------------------------------------------------

async function renderIdentityView() {
  var host = document.getElementById("profile-identity-view");
  if (!host) return;
  host.innerHTML = '<div class="loading-text">Loading identity…</div>';

  try {
    if (!currentUser) {
      host.innerHTML = "";
      return;
    }

    if (currentUser.role === "distributor") {
      await renderDistributorIdentity(host);
    } else if (currentUser.role === "buyer") {
      await renderBuyerIdentity(host);
    } else {
      // Agents / guests — minimal identity block
      await renderGenericIdentity(host);
    }
  } catch (err) {
    console.warn("[GoodsbarnX/profile] identity view failed:", err && err.message);
    host.innerHTML = '<div class="loading-text">Identity view temporarily unavailable.</div>';
  }
}

async function renderDistributorIdentity(host) {
  var uid = currentUser.id;

  // Parallel fetches. Every query is column-scoped (§29 evidence discipline).
  var [distRes, relRes, prodRes, trustRes] = await Promise.all([
    sb.from("distributor_profiles")
      .select("business_name, verification_tier, location, market, category")
      .eq("id", uid)
      .maybeSingle(),
    sb.from("trade_relationships")
      .select("id, status, is_primary")
      .eq("distributor_id", uid),
    sb.from("products")
      .select("id", { count: "exact", head: true })
      .eq("distributor_id", uid)
      .eq("status", "active"),
    sb.from("relationship_trust")
      .select("trust_score")
      .in("relationship_id",
        (await sb.from("trade_relationships").select("id").eq("distributor_id", uid)).data?.map(function (r) { return r.id; }) || []
      )
  ]);

  var dist = distRes.data || {};
  var rels = relRes.data || [];
  var activeRels = rels.filter(function (r) { return r.status === "active"; });
  var productsCount = prodRes.count || 0;

  var trustScores = (trustRes.data || []).map(function (t) { return profileNum(t.trust_score, null); }).filter(function (v) { return v != null; });
  var avgTrust = trustScores.length
    ? Math.round(trustScores.reduce(function (a, b) { return a + b; }, 0) / trustScores.length)
    : null;

  var tierRaw = dist.verification_tier || "";
  var tierLabel = tierRaw === "association" ? "Association Verified"
                : tierRaw === "market board" ? "Market Board Verified"
                : tierRaw === "self-attested" ? "Self-Attested"
                : "Not verified";
  var tierTone = tierRaw === "association" || tierRaw === "market board" ? "ok"
               : tierRaw === "self-attested" ? "warn"
               : "muted";

  host.innerHTML =
    '<div class="profile-identity-card">' +
      '<div class="profile-identity-kicker">HOW THE NETWORK SEES YOU</div>' +
      '<div class="profile-identity-name">' + profileEscHtml(dist.business_name || currentUser.business_name || "Your business") + '</div>' +
      '<div class="profile-identity-meta">' +
        profileEscHtml(dist.location || "Location not set") +
        (dist.market ? ' · ' + profileEscHtml(dist.market) : "") +
        (dist.category ? ' · ' + profileEscHtml(dist.category) : "") +
      '</div>' +

      '<div class="profile-identity-tier" data-tone="' + tierTone + '">' +
        '<span class="profile-identity-tier-dot"></span>' +
        '<span class="profile-identity-tier-label">' + profileEscHtml(tierLabel) + '</span>' +
      '</div>' +

      '<div class="profile-identity-stats">' +
        '<div class="profile-identity-stat">' +
          '<div class="profile-identity-stat-n">' + productsCount + '</div>' +
          '<div class="profile-identity-stat-t">Products listed</div>' +
        '</div>' +
        '<div class="profile-identity-stat">' +
          '<div class="profile-identity-stat-n">' + activeRels.length + '</div>' +
          '<div class="profile-identity-stat-t">Active relationships</div>' +
        '</div>' +
        '<div class="profile-identity-stat">' +
          '<div class="profile-identity-stat-n">' + (avgTrust != null ? avgTrust : "—") + '</div>' +
          '<div class="profile-identity-stat-t">Trust score</div>' +
        '</div>' +
      '</div>' +

      (avgTrust == null
        ? '<div class="profile-identity-note">Trust score appears once you have completed relationships.</div>'
        : "") +
    '</div>';
}

async function renderBuyerIdentity(host) {
  var uid = currentUser.id;

  var [buyerRes, relRes, trustRes] = await Promise.all([
    sb.from("buyer_profiles")
      .select("name, location, market, looking_for")
      .eq("id", uid)
      .maybeSingle(),
    sb.from("trade_relationships")
      .select("id, status")
      .eq("buyer_id", uid),
    sb.from("relationship_trust")
      .select("trust_score")
      .in("relationship_id",
        (await sb.from("trade_relationships").select("id").eq("buyer_id", uid)).data?.map(function (r) { return r.id; }) || []
      )
  ]);

  var buyer = buyerRes.data || {};
  var rels = relRes.data || [];
  var activeRels = rels.filter(function (r) { return r.status === "active"; });
  var pendingRels = rels.filter(function (r) { return r.status === "pending"; });

  var trustScores = (trustRes.data || []).map(function (t) { return profileNum(t.trust_score, null); }).filter(function (v) { return v != null; });
  var avgTrust = trustScores.length
    ? Math.round(trustScores.reduce(function (a, b) { return a + b; }, 0) / trustScores.length)
    : null;

  host.innerHTML =
    '<div class="profile-identity-card">' +
      '<div class="profile-identity-kicker">HOW DISTRIBUTORS SEE YOU</div>' +
      '<div class="profile-identity-name">' + profileEscHtml(buyer.name || currentUser.full_name || "Your account") + '</div>' +
      '<div class="profile-identity-meta">' +
        profileEscHtml(buyer.location || "Location not set") +
        (buyer.market ? ' · ' + profileEscHtml(buyer.market) : "") +
        (buyer.looking_for ? ' · Looking for: ' + profileEscHtml(buyer.looking_for) : "") +
      '</div>' +

      '<div class="profile-identity-stats">' +
        '<div class="profile-identity-stat">' +
          '<div class="profile-identity-stat-n">' + activeRels.length + '</div>' +
          '<div class="profile-identity-stat-t">Active relationships</div>' +
        '</div>' +
        '<div class="profile-identity-stat">' +
          '<div class="profile-identity-stat-n">' + pendingRels.length + '</div>' +
          '<div class="profile-identity-stat-t">Pending</div>' +
        '</div>' +
        '<div class="profile-identity-stat">' +
          '<div class="profile-identity-stat-n">' + (avgTrust != null ? avgTrust : "—") + '</div>' +
          '<div class="profile-identity-stat-t">Trust score</div>' +
        '</div>' +
      '</div>' +

      (avgTrust == null && activeRels.length === 0
        ? '<div class="profile-identity-note">Distributors will see your name and category interest when you appear in their Market screen.</div>'
        : "") +
    '</div>';
}

async function renderGenericIdentity(host) {
  host.innerHTML =
    '<div class="profile-identity-card">' +
      '<div class="profile-identity-kicker">YOUR ACCOUNT</div>' +
      '<div class="profile-identity-name">' + profileEscHtml(currentUser.full_name || "Account") + '</div>' +
      '<div class="profile-identity-meta">Role: ' + profileEscHtml(currentUser.role || "guest") + '</div>' +
    '</div>';
}

// --------------------------------------------------------------------------
// L3 · COMMERCIAL ACTIONS — per-role action rail
// --------------------------------------------------------------------------

function renderProfileActions() {
  var host = document.getElementById("profile-actions");
  if (!host || !currentUser) { if (host) host.innerHTML = ""; return; }

  var role = currentUser.role || "guest";
  var actions = [];

  if (role === "distributor") {
    actions = [
      { id: "trust",    label: "Your trust position",     hint: "See your verification tier and reliability" },
      { id: "products", label: "Manage products",         hint: "Edit your catalogue and stock" },
      { id: "relationship", label: "Your relationships",  hint: "Your buyers and pending invitations" },
      { id: "upgrade",  label: "Upgrade your tier",       hint: "Move to Association or Market Board" }
    ];
  } else if (role === "buyer") {
    actions = [
      { id: "relationship", label: "Your relationships",  hint: "Distributors you trade with" },
      { id: "market",       label: "Find distributors",   hint: "Browse and establish new relationships" },
      { id: "cart",         label: "Your cart",           hint: "Items ready to submit" }
    ];
  } else {
    actions = [
      { id: "market", label: "Browse the market" }
    ];
  }

  host.innerHTML =
    '<div class="section-label">Next actions</div>' +
    actions.map(function (a) {
      return (
        '<button type="button" class="profile-action-row" ' +
          'data-profile-action="' + profileEscAttr(a.id) + '">' +
          '<div class="profile-action-copy">' +
            '<div class="profile-action-label">' + profileEscHtml(a.label) + '</div>' +
            (a.hint ? '<div class="profile-action-hint">' + profileEscHtml(a.hint) + '</div>' : "") +
          '</div>' +
          '<span class="profile-action-arrow" aria-hidden="true">›</span>' +
        '</button>'
      );
    }).join("");
}

function handleProfileClick(e) {
  var t = e.target.closest("[data-profile-action]");
  if (!t) return;
  var action = t.getAttribute("data-profile-action");
  if (typeof showScreen !== "function") return;
  e.preventDefault();

  if (action === "trust" || action === "products" ||
      action === "relationship" || action === "upgrade" ||
      action === "market" || action === "cart") {
    showScreen(action);
  }
}

// --------------------------------------------------------------------------
// FORM STATE — dirty tracking, validation, save-guard
// --------------------------------------------------------------------------

function readProfileField(id) {
  var el = document.getElementById(id);
  return el ? String(el.value || "") : "";
}

function isProfileFieldVisible(id) {
  var el = document.getElementById(id);
  if (!el) return false;
  var field = el.closest ? el.closest(".field") : null;
  return field ? field.style.display !== "none" : true;
}

function validateProfile() {
  var isDist = currentUser && currentUser.role === "distributor";
  var errors = {};

  if (isDist) {
    if (!readProfileField("profile-business-name").trim()) {
      errors["profile-business-name"] = "Business name is required.";
    }
  } else {
    if (!readProfileField("profile-name").trim()) {
      errors["profile-name"] = "Your name is required.";
    }
  }

  var loc = readProfileField("profile-location").trim();
  var knownLocations = ["Onitsha","Nnewi","Awka","Asaba","Enugu","Owerri","Abakiliki","Agbor","Warri","Aba"];
  if (loc && knownLocations.indexOf(loc) === -1) {
    errors["profile-location"] = "Select a location from the list.";
  }

  var desc = readProfileField("profile-description");
  if (desc.length > 280) {
    errors["profile-description"] = "Description is " + desc.length + " characters (max 280).";
  }

  return errors;
}

function applyFieldErrors(errors) {
  // Clear all
  ["profile-business-name","profile-name","profile-location","profile-description"].forEach(function (id) {
    var el = document.getElementById(id);
    if (!el) return;
    var field = el.closest ? el.closest(".field") : null;
    if (!field) return;
    var errEl = field.querySelector(".profile-field-error");
    if (errEl) errEl.remove();
    field.classList.remove("profile-field-invalid");
  });

  // Apply
  Object.keys(errors || {}).forEach(function (id) {
    var el = document.getElementById(id);
    if (!el) return;
    var field = el.closest ? el.closest(".field") : null;
    if (!field) return;
    field.classList.add("profile-field-invalid");
    var errEl = document.createElement("div");
    errEl.className = "profile-field-error";
    errEl.textContent = errors[id];
    field.appendChild(errEl);
  });
}

function updateSaveButtonState() {
  var btn = document.querySelector("#profile-form .submit-btn");
  if (!btn) return;
  var errors = validateProfile();
  var hasErrors = Object.keys(errors).length > 0;
  btn.disabled = hasErrors || !__gbxProfileDirty;
  btn.classList.toggle("profile-save-disabled", btn.disabled);
}

function markProfileDirty() {
  __gbxProfileDirty = true;
  updateSaveButtonState();
}

// --------------------------------------------------------------------------
// LOAD PROFILE  (public API preserved)
// --------------------------------------------------------------------------

async function loadProfile() {
  if (!currentUser) return;
  if (!window.sb) {
    console.warn("[GoodsbarnX/profile] Supabase client unavailable; profile not loaded.");
    return;
  }

  ensureProfileScaffold();

  // Cross-module loaders — guarded (see file header).
  if (typeof loadMyTradeRelationship === "function") {
    try { loadMyTradeRelationship(); }
    catch (error) { console.error("[GoodsbarnX/profile] loadMyTradeRelationship threw:", error); }
  }
  if (typeof loadMyTradeRelationships === "function") {
    try { loadMyTradeRelationships(); }
    catch (error) { console.error("[GoodsbarnX/profile] loadMyTradeRelationships threw:", error); }
  }

  var isDist = currentUser.role === "distributor";

  // Toggle visibility of role-specific fields. Every target is null-safe.
  var setDisplay = function (id, value) {
    var el = document.getElementById(id);
    if (el) el.style.display = value;
  };
  setDisplay("profile-business-name-field", isDist ? "block" : "none");
  setDisplay("profile-category-field",      isDist ? "block" : "none");
  setDisplay("profile-name-field",          isDist ? "none"  : "block");
  setDisplay("profile-looking-for-field",   isDist ? "none"  : "block");

  // L1 — identity view (parallel to the form load)
  renderIdentityView();

  // L3 — commercial actions
  renderProfileActions();

  // L2 — form
  var table = isDist ? "distributor_profiles" : "buyer_profiles";

  var result = await sb
    .from(table)
    .select("*")
    .eq("id", currentUser.id)
    .single();

  if (result.error) {
    console.error("[GoodsbarnX/profile] profile lookup failed:", result.error.message);
    return;
  }
  if (!result.data) return;

  var fields = isDist
    ? {
        "profile-business-name": result.data.business_name,
        "profile-category":      result.data.category,
        "profile-location":      result.data.location,
        "profile-market":        result.data.market,
        "profile-shop-address":  result.data.shop_address,
        "profile-description":   result.data.description
      }
    : {
        "profile-name":          result.data.name,
        "profile-looking-for":   result.data.looking_for,
        "profile-location":      result.data.location,
        "profile-market":        result.data.market,
        "profile-shop-address":  result.data.shop_address,
        "profile-description":   result.data.description
      };

  Object.keys(fields).forEach(function (id) {
    var value = fields[id];
    var el = document.getElementById(id);
    if (el && value != null) el.value = value;
  });

  // Snapshot for cancel + dirty detection
  __gbxProfileSnapshot = JSON.parse(JSON.stringify(fields));
  __gbxProfileDirty = false;

  // Bind change listeners for dirty tracking
  Object.keys(fields).forEach(function (id) {
    var el = document.getElementById(id);
    if (!el) return;
    el.removeEventListener("input", markProfileDirty);
    el.addEventListener("input", markProfileDirty);
  });

  // Extend description with a live character count
  attachDescriptionCharCount();

  // Wire the cancel button
  wireCancelButton();

  // Initial save state
  updateSaveButtonState();
  applyFieldErrors({});
}

function attachDescriptionCharCount() {
  var desc = document.getElementById("profile-description");
  if (!desc) return;
  var field = desc.closest ? desc.closest(".field") : null;
  if (!field) return;
  if (field.querySelector(".profile-desc-count")) return; // idempotent

  var counter = document.createElement("div");
  counter.className = "profile-desc-count";
  field.appendChild(counter);

  var update = function () {
    var len = String(desc.value || "").length;
    counter.textContent = len + "/280";
    counter.classList.toggle("profile-desc-count-warn", len > 280);
    updateSaveButtonState();
  };
  desc.addEventListener("input", update);
  update();
}

function wireCancelButton() {
  var form = document.getElementById("profile-form");
  if (!form) return;
  var buttons = form.querySelectorAll("button");
  var cancelBtn = null;
  for (var i = 0; i < buttons.length; i++) {
    if (/cancel/i.test(buttons[i].textContent || "")) { cancelBtn = buttons[i]; break; }
  }
  if (!cancelBtn) {
    // If there's no cancel button yet, add one next to Save
    var saveBtn = form.querySelector(".submit-btn");
    if (!saveBtn) return;
    cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "cancel-btn";
    cancelBtn.textContent = "Cancel";
    saveBtn.parentNode.insertBefore(cancelBtn, saveBtn.nextSibling);
  }
  cancelBtn.addEventListener("click", function (e) {
    e.preventDefault();
    if (!__gbxProfileSnapshot) return;
    Object.keys(__gbxProfileSnapshot).forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.value = __gbxProfileSnapshot[id] == null ? "" : __gbxProfileSnapshot[id];
    });
    __gbxProfileDirty = false;
    applyFieldErrors({});
    updateSaveButtonState();
  });
}

// --------------------------------------------------------------------------
// SAVE PROFILE  (public API preserved; validation + guarded currentUser)
// --------------------------------------------------------------------------

async function saveProfile() {
  if (!currentUser) return;
  if (!window.sb) {
    var s1 = document.getElementById("profile-status");
    if (s1) s1.innerText = "Connection service unavailable. Please refresh.";
    return;
  }

  var isDist = currentUser.role === "distributor";
  var table  = isDist ? "distributor_profiles" : "buyer_profiles";

  // Validate
  var errors = validateProfile();
  applyFieldErrors(errors);
  if (Object.keys(errors).length > 0) {
    var sErr = document.getElementById("profile-status");
    if (sErr) sErr.innerText = "Please fix the errors above.";
    return;
  }

  var payload = isDist
    ? {
        business_name: readProfileField("profile-business-name").trim(),
        category:      readProfileField("profile-category"),
        location:      readProfileField("profile-location"),
        market:        readProfileField("profile-market").trim(),
        shop_address:  readProfileField("profile-shop-address").trim(),
        description:   readProfileField("profile-description").trim()
      }
    : {
        name:          readProfileField("profile-name").trim(),
        looking_for:   readProfileField("profile-looking-for"),
        location:      readProfileField("profile-location"),
        market:        readProfileField("profile-market").trim(),
        shop_address:  readProfileField("profile-shop-address").trim(),
        description:   readProfileField("profile-description").trim()
      };

  var statusEl = document.getElementById("profile-status");
  var showStatus = function (msg) { if (statusEl) statusEl.innerText = msg; };
  showStatus("Saving...");

  var btn = document.querySelector("#profile-form .submit-btn");
  if (btn) btn.disabled = true;

  try {
    var result = await sb.from(table).update(payload).eq("id", currentUser.id);
    if (result.error) {
      console.error("[GoodsbarnX/profile] save failed:", result.error.message);
      showStatus("Error: " + result.error.message);
      if (btn) btn.disabled = false;
      return;
    }

    // Guarded currentUser mutation — only after confirmed save.
    currentUser = Object.assign({}, currentUser, payload);

    // Refresh snapshot + dirty flag
    __gbxProfileSnapshot = JSON.parse(JSON.stringify(
      isDist
        ? {
            "profile-business-name": payload.business_name,
            "profile-category":      payload.category,
            "profile-location":      payload.location,
            "profile-market":        payload.market,
            "profile-shop-address":  payload.shop_address,
            "profile-description":   payload.description
          }
        : {
            "profile-name":          payload.name,
            "profile-looking-for":   payload.looking_for,
            "profile-location":      payload.location,
            "profile-market":        payload.market,
            "profile-shop-address":  payload.shop_address,
            "profile-description":   payload.description
          }
    ));
    __gbxProfileDirty = false;
    updateSaveButtonState();

    showStatus("");

    var banner = document.getElementById("profile-saved-banner");
    if (banner) {
      banner.style.display = "block";
      setTimeout(function () { banner.style.display = "none"; }, 3000);
    }

    // Refresh identity view — saved changes should be reflected immediately.
    renderIdentityView();
  } finally {
    if (btn) btn.disabled = false;
  }
}

// --------------------------------------------------------------------------
// TOGGLE FAVOURITE  (canonical — DB write)
//
// Called from market.js's rendered cards: onclick="toggleFavourite(event, id)".
// Signature preserved. DOM icon updated from trust.js-safe SVG set:
// filled heart vs hollow heart, so no emoji dependency.
// --------------------------------------------------------------------------

async function toggleFavourite(event, distributorId) {
  if (event && typeof event.stopPropagation === "function") {
    event.stopPropagation();
  }

  if (!currentUser) {
    alert("Please log in.");
    return;
  }
  if (!window.sb) {
    console.warn("[GoodsbarnX/profile] Supabase client unavailable; favourite not changed.");
    return;
  }

  var isFavourite =
    userFavourites && typeof userFavourites.has === "function"
      ? userFavourites.has(distributorId)
      : false;

  if (isFavourite) {
    var delRes = await sb
      .from("favourites")
      .delete()
      .eq("user_id", currentUser.id)
      .eq("distributor_id", distributorId);
    if (delRes.error) {
      console.error("[GoodsbarnX/profile] favourite delete failed:", delRes.error.message);
      return;
    }
    if (userFavourites && typeof userFavourites.delete === "function") {
      userFavourites.delete(distributorId);
    }
  } else {
    var insRes = await sb
      .from("favourites")
      .insert({ user_id: currentUser.id, distributor_id: distributorId });
    if (insRes.error) {
      console.error("[GoodsbarnX/profile] favourite insert failed:", insRes.error.message);
      return;
    }
    if (userFavourites && typeof userFavourites.add === "function") {
      userFavourites.add(distributorId);
    }
  }

  // Update the icon in place. Emoji removed — SVG heart.
  var icon = document.getElementById("fav-" + distributorId);
  if (icon) {
    var active = userFavourites && typeof userFavourites.has === "function" && userFavourites.has(distributorId);
    icon.innerHTML = active
      ? '<svg class="gbx-icon" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="color:var(--gbx-danger);"><path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.7A4 4 0 0 1 19 10c0 5.5-7 10-7 10z"/></svg>'
      : '<svg class="gbx-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.7A4 4 0 0 1 19 10c0 5.5-7 10-7 10z"/></svg>';
  }
}

// --------------------------------------------------------------------------
// SCREEN LOADER REGISTRATION (Phase 2.3)
// --------------------------------------------------------------------------

(function registerProfileScreen() {
  if (typeof registerScreenLoader !== "function") {
    console.warn("[GoodsbarnX/profile] registerScreenLoader unavailable; profile screen has no loader.");
    return;
  }
  registerScreenLoader("profile", function profileLoader() {
    return loadProfile();
  });
})();

// --------------------------------------------------------------------------
// GLOBAL EXPORTS
// --------------------------------------------------------------------------

window.loadProfile = loadProfile;
window.saveProfile = saveProfile;
window.toggleFavourite = toggleFavourite;

console.log("[GoodsbarnX] profile.js loaded (V1.8.2.6 rev.2 · Commercial identity)");
