// GoodsbarnX – Service Worker for offline support
const CACHE_NAME = 'goodsbarnx-v1';
const urlsToCache = [
  '/',
  '/index.html',
  '/css/style.css',
  '/js/config.js',
  '/js/router.js',
  '/js/auth.js',
  '/js/profile.js',
  '/js/favourites.js',
  '/js/requests.js',
  '/js/market.js',
  '/js/storefront.js',
  '/js/products.js',
  '/js/cart.js',
  '/js/trust.js',
  '/js/upgrade.js',
  '/js/staff.js',
  '/js/offline.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(urlsToCache))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  // Skip Supabase API calls
  if (event.request.url.includes('supabase.co') || event.request.url.includes('vercel.app/api')) {
    return;
  }

  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        if (response) {
          return response;
        }
        return fetch(event.request).then((response) => {
          if (!response || response.status !== 200 || response.type !== 'basic') {
            return response;
          }
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
          return response;
        });
      })
  );
});
