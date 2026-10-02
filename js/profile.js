// ==========================================================================
// GoodsbarnX — profile.js
// User profile load/save, and the canonical toggleFavourite (DB write).
// Plain global script. Loads thirteenth (Canon §10).
//
// V1.8.2.6 remediation Phase 1+2:
//   - Cross-module calls into relationship.js are now typeof-guarded.
//     The payload called loadMyTradeRelationship() and
//     loadMyTradeRelationships() unguarded; both are declared in
//     relationship.js (position 14), which is loaded after this file
//     (position 13). At the moment a user clicks Profile, relationship.js
//     may or may not have finished parsing. The guard makes both cases
//     deterministic.
//   - All DOM lookups null-safe.
//   - saveProfile now surfaces error.message instead of a generic string.
//   - Registered a "profile" screen loader (Phase 2.3).
//
// Ownership note (D-register):
//   toggleFavourite lives HERE (canonical). market.js's duplicate was
//   removed in File 5. market.js's rendered cards still call
//   toggleFavourite(event, id) — resolution happens at click time.
// ==========================================================================

// --------------------------------------------------------------------------
// LOAD PROFILE
// --------------------------------------------------------------------------

async function loadProfile() {
  if (!currentUser) return;
  if (!window.sb) {
    console.warn("[GoodsbarnX/profile] Supabase client unavailable; profile not loaded.");
    return;
  }

  // Cross-module loaders — guarded (see file header).
  if (typeof loadMyTradeRelationship === "function") {
    try {
      loadMyTradeRelationship();
    } catch (error) {
      console.error("[GoodsbarnX/profile] loadMyTradeRelationship threw:", error);
    }
  }
  if (typeof loadMyTradeRelationships === "function") {
    try {
      loadMyTradeRelationships();
    } catch (error) {
      console.error("[GoodsbarnX/profile] loadMyTradeRelationships threw:", error);
    }
  }

  const isDist = currentUser.role === "distributor";

  // Toggle visibility of role-specific fields. Every target is null-safe.
  const setDisplay = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.style.display = value;
  };
  setDisplay("profile-business-name-field", isDist ? "block" : "none");
  setDisplay("profile-category-field",      isDist ? "block" : "none");
  setDisplay("profile-name-field",          isDist ? "none"  : "block");
  setDisplay("profile-looking-for-field",   isDist ? "none"  : "block");

  const table = isDist ? "distributor_profiles" : "buyer_profiles";

  const { data, error } = await sb
    .from(table)
    .select("*")
    .eq("id", currentUser.id)
    .single();

  if (error) {
    console.error("[GoodsbarnX/profile] profile lookup failed:", error.message);
    return;
  }
  if (!data) return;

  const fields = isDist
    ? {
        "profile-business-name": data.business_name,
        "profile-category":      data.category,
        "profile-location":      data.location,
        "profile-market":        data.market,
        "profile-shop-address":  data.shop_address,
        "profile-description":   data.description
      }
    : {
        "profile-name":          data.name,
        "profile-looking-for":   data.looking_for,
        "profile-location":      data.location,
        "profile-market":        data.market,
        "profile-shop-address":  data.shop_address,
        "profile-description":   data.description
      };

  Object.keys(fields).forEach(id => {
    const value = fields[id];
    const el = document.getElementById(id);
    if (el && value != null) el.value = value;
  });
}

// --------------------------------------------------------------------------
// SAVE PROFILE
// --------------------------------------------------------------------------

async function saveProfile() {
  if (!currentUser) return;
  if (!window.sb) {
    const statusEl = document.getElementById("profile-status");
    if (statusEl) statusEl.innerText = "Connection service unavailable. Please refresh.";
    return;
  }

  const isDist = currentUser.role === "distributor";
  const table  = isDist ? "distributor_profiles" : "buyer_profiles";

  const readValue = (id) => {
    const el = document.getElementById(id);
    return el ? el.value : "";
  };

  const payload = isDist
    ? {
        business_name: readValue("profile-business-name"),
        category:      readValue("profile-category"),
        location:      readValue("profile-location"),
        market:        readValue("profile-market"),
        shop_address:  readValue("profile-shop-address"),
        description:   readValue("profile-description")
      }
    : {
        name:          readValue("profile-name"),
        looking_for:   readValue("profile-looking-for"),
        location:      readValue("profile-location"),
        market:        readValue("profile-market"),
        shop_address:  readValue("profile-shop-address"),
        description:   readValue("profile-description")
      };

  const statusEl = document.getElementById("profile-status");
  const showStatus = (msg) => { if (statusEl) statusEl.innerText = msg; };
  showStatus("Saving...");

  const { error } = await sb.from(table).update(payload).eq("id", currentUser.id);

  if (error) {
    console.error("[GoodsbarnX/profile] save failed:", error.message);
    showStatus("Error: " + error.message);
    return;
  }

  currentUser = Object.assign({}, currentUser, payload);
  showStatus("");

  const banner = document.getElementById("profile-saved-banner");
  if (banner) {
    banner.style.display = "block";
    setTimeout(() => { banner.style.display = "none"; }, 3000);
  }
}

// --------------------------------------------------------------------------
// TOGGLE FAVOURITE (canonical — DB write)
//
// Called from market.js's rendered cards: onclick="toggleFavourite(event, id)".
// Signature preserved.
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

  const isFavourite =
    userFavourites && typeof userFavourites.has === "function"
      ? userFavourites.has(distributorId)
      : false;

  if (isFavourite) {
    const { error } = await sb
      .from("favourites")
      .delete()
      .eq("user_id", currentUser.id)
      .eq("distributor_id", distributorId);
    if (error) {
      console.error("[GoodsbarnX/profile] favourite delete failed:", error.message);
      return;
    }
    if (userFavourites && typeof userFavourites.delete === "function") {
      userFavourites.delete(distributorId);
    }
  } else {
    const { error } = await sb
      .from("favourites")
      .insert({ user_id: currentUser.id, distributor_id: distributorId });
    if (error) {
      console.error("[GoodsbarnX/profile] favourite insert failed:", error.message);
      return;
    }
    if (userFavourites && typeof userFavourites.add === "function") {
      userFavourites.add(distributorId);
    }
  }

  const icon = document.getElementById("fav-" + distributorId);
  if (icon) {
    icon.textContent =
      userFavourites && typeof userFavourites.has === "function" && userFavourites.has(distributorId)
        ? "❤️"
        : "🤍";
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

console.log("[GoodsbarnX] profile.js loaded.");
