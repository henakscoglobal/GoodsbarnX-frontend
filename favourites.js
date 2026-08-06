// Favourites management
let userFavourites = new Set(); // store distributor IDs

// Load favourites for current user on login
async function loadFavourites() {
  if (!currentUser) return;
  const { data } = await sb
    .from('favourites')
    .select('distributor_id')
    .eq('user_id', currentUser.id);
  if (data) {
    userFavourites = new Set(data.map(f => f.distributor_id));
    updateAllHeartIcons();
  }
}

// Toggle favourite
async function toggleFavourite(event, distributorId) {
  event.stopPropagation(); // prevent card click
  if (!currentUser) {
    alert('Please log in to save favourites.');
    return;
  }
  if (userFavourites.has(distributorId)) {
    // Remove from database
    const { error } = await sb
      .from('favourites')
      .delete()
      .eq('user_id', currentUser.id)
      .eq('distributor_id', distributorId);
    if (!error) {
      userFavourites.delete(distributorId);
      updateHeartIcon(distributorId);
    }
  } else {
    // Add to database
    const { error } = await sb
      .from('favourites')
      .insert({ user_id: currentUser.id, distributor_id: distributorId });
    if (!error) {
      userFavourites.add(distributorId);
      updateHeartIcon(distributorId);
    }
  }
}

// Update a single icon
function updateHeartIcon(distributorId) {
  const icon = document.getElementById(`fav-${distributorId}`);
  if (icon) {
    icon.textContent = userFavourites.has(distributorId) ? '❤️' : '🤍';
  }
}

// Update all visible icons after load
function updateAllHeartIcons() {
  userFavourites.forEach(id => updateHeartIcon(id));
  // Also reset any others that might have stale state
  document.querySelectorAll('.fav-icon').forEach(icon => {
    const id = icon.id.replace('fav-', '');
    if (!userFavourites.has(id)) icon.textContent = '🤍';
    else icon.textContent = '❤️';
  });
}

// Call loadFavourites after user login
// We'll hook into the existing loadCurrentUser function.
