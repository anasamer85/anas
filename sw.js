// Service Worker - نظام محاضر لجان بيع المزارع (يعمل بدون إنترنت على GitHub Pages)
const CACHE_NAME = "farm-sales-committee-v52-mobile";
const ASSETS_TO_CACHE = [
  "./",
  "./index.html",
  "./mobile.html",
  "./manifest-mobile.json",
  "./mobile-app.js",
  "./style.css",
  "./excel-template.js",
  "./app.js",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
  "https://cdn.tailwindcss.com/3.4.17",
  "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js",
  "https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js",
  "https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js",
  "https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js",
  "https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&display=swap"
];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      for (const url of ASSETS_TO_CACHE) {
        try { await cache.add(url); } catch (err) {}
      }
    })
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((key) => { if (key !== CACHE_NAME) return caches.delete(key); }))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = req.url || "";
  if (req.method !== "GET" || url.includes("script.google.com") || url.includes("firebaseio.com")) return;
  event.respondWith(fetch(req).catch(() => caches.match(req)));
});