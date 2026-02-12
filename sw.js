// Service Worker for SyncView - No caching strategy for online PWA

// Install event - just skip waiting
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

// Activate event - claim clients
self.addEventListener('activate', (event) => {
  self.clients.claim();
});

// Fetch event - handle navigation, everything else goes to network
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return;
  }

  // App shell routing: serve index.html for navigation requests
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch('./index.html'));
    return;
  }

  // All other requests go directly to network
  event.respondWith(fetch(event.request));
});