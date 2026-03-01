// Service Worker for SyncView - Enhanced PWA support with intelligent caching

const CACHE_NAME = 'syncview-v1';
const STATIC_ASSETS = [
  './',
  './index.html',
  './style.css',
  './main.js',
  './manifest.json',
  './images/icon.svg',
  './images/icon.png'
];

// Install event - cache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    }).catch((err) => {
      console.warn('Cache install failed:', err);
    })
  );
  self.skipWaiting();
});

// Activate event - clean up old caches and claim clients
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch event - intelligent caching strategy
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  
  // Skip non-http(s) protocols
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return;
  }

  // Skip chrome-extension and other non-standard protocols
  if (!url.protocol.startsWith('http')) {
    return;
  }

  // Strategy 1: Navigation requests - Network First with Cache Fallback
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          // Cache successful navigation responses
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
          return response;
        })
        .catch(() => {
          return caches.match(event.request).then((cached) => {
            if (cached) return cached;
            // Fallback if not in cache
            return caches.match('./index.html').then((fallback) => {
              return fallback || new Response(
                '<!DOCTYPE html><html><head><meta http-equiv="refresh" content="0;url=./"></head></html>',
                { headers: { 'Content-Type': 'text/html' } }
              );
            });
          });
        })
    );
    return;
  }

  // Strategy 2: Static assets (CSS, JS, SVG, images) - Cache First
  const isStaticAsset = 
    url.pathname.match(/\.(css|js|svg|png|jpg|jpeg|webp|woff2?)$/i) ||
    url.host.includes('unpkg.com') ||
    url.host.includes('cdnjs.cloudflare.com');

  if (isStaticAsset) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) {
          // Return cached version and update cache in background
          fetch(event.request).then((response) => {
            if (response.ok) {
              caches.open(CACHE_NAME).then((cache) => {
                cache.put(event.request, response.clone());
              });
            }
          }).catch(() => {});
          return cached;
        }
        
        // Not in cache, fetch and cache
        return fetch(event.request).then((response) => {
          if (!response.ok) return response;
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
          return response;
        });
      })
    );
    return;
  }

  // Strategy 3: API calls (Photon search) - Network Only
  if (url.host.includes('photon.komoot.io')) {
    event.respondWith(fetch(event.request));
    return;
  }

  // Strategy 4: Map tiles - Cache First with frequent updates
  if (url.host.includes('mt1.google.com') || url.host.includes('google.com')) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        // Return cached version immediately if available
        const fetchPromise = fetch(event.request).then((response) => {
          if (response.ok) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseClone);
            });
          }
          return response;
        }).catch(() => cached);
        
        return cached || fetchPromise;
      })
    );
    return;
  }

  // Default: Network First with Cache Fallback
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
        }
        return response;
      })
      .catch(() => {
        return caches.match(event.request).then((cached) => {
          return cached || new Response('Offline', { status: 503 });
        });
      })
  );
});