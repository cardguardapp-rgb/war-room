// Minimal service worker: makes the app installable and shows a friendly
// offline page for navigations. It deliberately does NOT cache the app's
// JS/CSS (which would risk serving a stale SPA) — only the offline shell.
const CACHE = "warroom-shell-v1";
const OFFLINE_URL = "/offline.html";
const PRECACHE = [OFFLINE_URL, "/manifest.webmanifest", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  // Page navigations: try the network, fall back to the offline page.
  if (req.mode === "navigate") {
    event.respondWith(fetch(req).catch(() => caches.match(OFFLINE_URL)));
    return;
  }

  // Precached shell assets: serve from cache if the network is unavailable.
  const url = new URL(req.url);
  if (PRECACHE.includes(url.pathname)) {
    event.respondWith(fetch(req).catch(() => caches.match(req)));
  }
});
