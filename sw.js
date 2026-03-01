// Service Worker for SyncView - Online only, no caching

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Pass-through fetch - no caching
self.addEventListener('fetch', (event) => {
  // Let the browser handle the request normally
});