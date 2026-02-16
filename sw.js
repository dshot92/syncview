// Service Worker for SyncView - Minimal PWA support with state preservation

// Install event - skip waiting to activate immediately
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

// Activate event - claim all clients immediately
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Fetch event - minimal handling for PWA
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return;
  }

  // For navigation requests in PWA, we need to serve index.html
  // but the browser keeps the original URL with query params
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch('./index.html', { cache: 'no-store' })
        .catch(() => new Response(
          '<!DOCTYPE html><html><head><meta http-equiv="refresh" content="0;url=./"></head></html>',
          { headers: { 'Content-Type': 'text/html' } }
        ))
    );
    return;
  }

  // All other requests go directly to network - no caching
  event.respondWith(fetch(event.request));
});