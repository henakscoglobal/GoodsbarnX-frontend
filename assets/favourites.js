// favourites.js
// Stores favourites in localStorage and exposes functions for UI integration.
(function(window){
  'use strict';

  function getFavourites(){
    try{ return JSON.parse(localStorage.getItem('favourites') || '[]'); }
    catch(e){ return []; }
  }
  function saveFavourites(list){
    localStorage.setItem('favourites', JSON.stringify(list));
  }
  function isFavourited(id){
    return getFavourites().indexOf(id) !== -1;
  }
  function updateFavIcon(id){
    var icon = document.getElementById('fav-' + id);
    if(!icon) return;
    icon.textContent = isFavourited(id) ? '❤️' : '🤍';
    var btn = document.querySelector('.fav-btn[data-distributor-id="' + id + '"]');
    if(btn) btn.classList.toggle('favourited', isFavourited(id));
  }

  function initAllFavIcons(){
    document.querySelectorAll('[id^="fav-"]').forEach(function(el){
      var id = el.id.replace('fav-','');
      updateFavIcon(id);
    });
  }

  function toggleFavourite(event, id){
    event = event || window.event;
    if(event.stopPropagation) event.stopPropagation();
    try{ event.preventDefault(); }catch(e){}

    var role = window.currentUserRole || (window.user && window.user.role) || localStorage.getItem('userRole') || null;
    if(role !== 'buyer'){
      alert('Only buyers can add distributors to favourites. Please sign in as a buyer.');
      return;
    }

    var favs = getFavourites();
    var ix = favs.indexOf(id);
    var added;
    if(ix === -1){ favs.push(id); added = true; }
    else { favs.splice(ix,1); added = false; }
    saveFavourites(favs);
    updateFavIcon(id);

    // Optional: attempt server sync if token is available on window.currentUser.token
    if(window.currentUser && window.currentUser.token){
      fetch('/api/favourites',{
        method: added ? 'POST' : 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + window.currentUser.token
        },
        body: JSON.stringify({ distributorId: id })
      }).catch(function(err){ console.warn('Favourite sync failed', err); });
    }
  }

  // Expose to global scope so onclick handlers in HTML can call toggleFavourite
  window.favourites = {
    get: getFavourites,
    save: saveFavourites,
    isFavourited: isFavourited,
    initAllFavIcons: initAllFavIcons,
    toggleFavourite: toggleFavourite,
    updateFavIcon: updateFavIcon
  };

  // Also map top-level function name used in your card HTML
  window.toggleFavourite = toggleFavourite;

  // Initialize on DOM ready
  document.addEventListener('DOMContentLoaded', function(){
    initAllFavIcons();
  });

})(window);
