// ==========================================================================
// GoodsbarnX — profile.js
// User profile load/save, and favourites (toggleFavourite).
// Plain global script — depends on js/config.js (for `sb`) being loaded first.
// Depends on global `currentUser` (js/auth.js) and `userFavourites` (declared
// in the main inline script in index.html).
// ==========================================================================

async function loadProfile() {
  if (!currentUser) return;

  const isDist = currentUser.role === "distributor";
  document.getElementById("profile-business-name-field").style.display = isDist ? "block" : "none";
  document.getElementById("profile-category-field").style.display = isDist ? "block" : "none";
  document.getElementById("profile-name-field").style.display = isDist ? "none" : "block";
  document.getElementById("profile-looking-for-field").style.display = isDist ? "none" : "block";

  const table = isDist ? "distributor_profiles" : "buyer_profiles";
  const { data } = await sb.from(table).select("*").eq("id", currentUser.id).single();

  if (data) {
    const fields = isDist ? {
      "profile-business-name": data.business_name,
      "profile-category": data.category,
      "profile-location": data.location,
      "profile-market": data.market,
      "profile-shop-address": data.shop_address,
      "profile-description": data.description
    } : {
      "profile-name": data.name,
      "profile-looking-for": data.looking_for,
      "profile-location": data.location,
      "profile-market": data.market,
      "profile-shop-address": data.shop_address,
      "profile-description": data.description
    };

    Object.entries(fields).forEach(([id, value]) => {
      const el = document.getElementById(id);
      if (el && value) el.value = value;
    });
  }
}

async function saveProfile() {
  if (!currentUser) return;

  const isDist = currentUser.role === "distributor";
  const table = isDist ? "distributor_profiles" : "buyer_profiles";

  const payload = isDist ? {
    business_name: document.getElementById("profile-business-name").value,
    category: document.getElementById("profile-category").value,
    location: document.getElementById("profile-location").value,
    market: document.getElementById("profile-market").value,
    shop_address: document.getElementById("profile-shop-address").value,
    description: document.getElementById("profile-description").value
  } : {
    name: document.getElementById("profile-name").value,
    looking_for: document.getElementById("profile-looking-for").value,
    location: document.getElementById("profile-location").value,
    market: document.getElementById("profile-market").value,
    shop_address: document.getElementById("profile-shop-address").value,
    description: document.getElementById("profile-description").value
  };

  const { error } = await sb.from(table).update(payload).eq("id", currentUser.id);

  if (error) {
    document.getElementById("profile-status").innerText = "Error saving profile.";
  } else {
    currentUser = { ...currentUser, ...payload };
    const banner = document.getElementById("profile-saved-banner");
    banner.style.display = "block";
    setTimeout(() => banner.style.display = "none", 3000);
  }
}

async function toggleFavourite(event, distributorId) {
  event.stopPropagation();
  if (!currentUser) {
    alert("Please log in.");
    return;
  }

  if (userFavourites.has(distributorId)) {
    await sb.from("favourites").delete().eq("user_id", currentUser.id).eq("distributor_id", distributorId);
    userFavourites.delete(distributorId);
  } else {
    await sb.from("favourites").insert({ user_id: currentUser.id, distributor_id: distributorId });
    userFavourites.add(distributorId);
  }

  const icon = document.getElementById("fav-" + distributorId);
  if (icon) icon.textContent = userFavourites.has(distributorId) ? "❤️" : "🤍";
}
