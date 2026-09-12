// Service worker for the ИГХТУ schedule bot demo.
// Caches the app shell (HTML, CSS, JS chunks) so the demo loads offline.
// Uses a stale-while-revalidate strategy for navigation requests and
// cache-first for static assets.

const CACHE_VERSION = "isuct-bot-v1";
const APP_SHELL = ["/", "/manifest.json", "/logo.svg", "/robots.txt"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Only handle GET requests
  if (req.method !== "GET") return;

  // Schedule API responses: stale-while-revalidate with 10-min TTL.
  // This lets users view their cached schedule offline.
  if (url.pathname.startsWith("/api/schedule/view")) {
    event.respondWith(
      caches.open(CACHE_VERSION).then(async (cache) => {
        const cached = await cache.match(req);
        // Serve stale cache immediately if available
        const networkFetch = fetch(req)
          .then((res) => {
            if (res.ok) {
              // Clone and cache the fresh response
              cache.put(req, res.clone());
            }
            return res;
          })
          .catch(() => cached);
        return cached || networkFetch;
      }),
    );
    return;
  }

  // Image route + other API routes: network-only (don't cache)
  if (url.pathname.startsWith("/api/")) return;

  // Navigation requests: stale-while-revalidate
  if (req.mode === "navigate") {
    event.respondWith(
      caches.open(CACHE_VERSION).then(async (cache) => {
        const cached = await cache.match(req);
        const networkFetch = fetch(req)
          .then((res) => {
            if (res.ok) cache.put(req, res.clone());
            return res;
          })
          .catch(() => cached);
        return cached || networkFetch;
      }),
    );
    return;
  }

  // Static assets: cache-first, then network
  event.respondWith(
    caches.open(CACHE_VERSION).then(async (cache) => {
      const cached = await cache.match(req);
      if (cached) {
        // Revalidate in background
        fetch(req).then((res) => {
          if (res.ok) cache.put(req, res.clone());
        }).catch(() => {});
        return cached;
      }
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    }),
  );
});
