// GoodsbarnX – Favourites Module

let userFavourites = new Set();

document.addEventListener("userLoaded", () => {
  if (currentUser) loadFavourites();
});

async function loadFavourites() {
  if (!currentUser) return;
  const { data } = await sb.from("favourites").select("distributor_id").eq("user_id", currentUser.id);
  if (data) {
    userFavourites = new Set(data.map(f => f.distributor_id));
    updateAllHeartIcons();
  }
}

async function toggleFavourite(event, distributorId) {
  event.stopPropagation();
  if (!currentUser) {
    alert("Please log in to save favourites.");
    return;
  }

  if (userFavourites.has(distributorId)) {
    const { error } = await sb.from("favourites").delete().eq("user_id", currentUser.id).eq("distributor_id", distributorId);
    if (!error) {
      userFavourites.delete(distributorId);
      updateHeartIcon(distributorId);
    }
  } else {
    const { error } = await sb.from("favourites").insert({ user_id: currentUser.id, distributor_id: distributorId });
    if (!error) {
      userFavourites.add(distributorId);
      updateHeartIcon(distributorId);
    }
  }
}

function updateHeartIcon(distributorId) {
  const icon = document.getElementById(`fav-${distributorId}`);
  if (icon) icon.textContent = userFavourites.has(distributorId) ? "❤️" : "🤍";
}

function updateAllHeartIcons() {
  document.querySelectorAll(".fav-icon").forEach(icon => {
    const id = icon.id.replace("fav-", "");
    icon.textContent = userFavourites.has(id) ? "❤️" : "🤍";
  });
}
