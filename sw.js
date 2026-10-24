// Service Worker - نظام محاضر لجان بيع المزارع (يعمل بدون إنترنت على GitHub Pages)
const CACHE_NAME = "farm-sales-committee-v32";
const ASSETS_TO_CACHE = [
  "./",
  "./index.html",
  "./style.css",
  "./style.css?v=27",
  "./style.css?v=28",
  "./style.css?v=32",
  "./app.js",
  "./app.js?v=27",
  "./app.js?v=28",
  "./app.js?v=32",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
  "https://cdn.tailwindcss.com/3.4.17",
  "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js",
  "https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js",
  "https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&display=swap"
];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      for (const url of ASSETS_TO_CACHE) {
        try {
          await cache.add(url);
        } catch (err) {
          // Ignore individual asset cache failures during install
        }
      }
    })
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = req.url || "";

  // Never cache Cloud Database API calls (Google Apps Script / Firebase) or non-GET requests
  if (
    req.method !== "GET" ||
    url.includes("script.google.com") ||
    url.includes("googleusercontent.com") ||
    url.includes("firebaseio.com") ||
    url.includes("firebasedatabase.app")
  ) {
    return;
  }

  // Network-first with cache: 'no-store' for HTML, CSS, JS, and Manifest so GitHub Pages updates appear immediately on all devices
  const isHtmlNav = req.mode === "navigate" || (req.headers.get("accept") || "").includes("text/html") || url.endsWith("/") || url.includes("/index.html");
  if (
    isHtmlNav ||
    url.includes("/app.js") ||
    url.includes("/style.css") ||
    url.includes("/manifest.json")
  ) {
    event.respondWith(
      fetch(req, { cache: "no-store" })
        .then((networkRes) => {
          if (networkRes && networkRes.status === 200) {
            const copy = networkRes.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          }
          return networkRes;
        })
        .catch(() =>
          caches.match(req).then((cached) => {
            if (cached) return cached;
            if (isHtmlNav) return caches.match("./index.html");
            return cached;
          })
        )
    );
    return;
  }

  // Cache-first with network fallback for external libraries, fonts, and icons
  event.respondWith(
    caches.match(req).then((cachedRes) => {
      if (cachedRes) return cachedRes;
      return fetch(req)
        .then((networkRes) => {
          if (networkRes && networkRes.status === 200) {
            const copy = networkRes.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          }
          return networkRes;
        })
        .catch(() => cachedRes);
    })
  );
});
