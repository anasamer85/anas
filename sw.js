// Service Worker - نظام محاضر لجان بيع المزارع (يعمل بدون إنترنت على GitHub Pages)
const CACHE_NAME = "farm-sales-committee-v65-accounting-stress-test-hardened";
const ASSETS_TO_CACHE = [
  "./",
  "./index.html",
  "./style.css",
  "./style.css?v=27",
  "./style.css?v=28",
  "./style.css?v=32",
  "./style.css?v=38",
  "./style.css?v=40",
  "./style.css?v=41",
  "./style.css?v=42",
  "./style.css?v=43",
  "./style.css?v=44",
  "./style.css?v=45",
  "./style.css?v=46",
  "./style.css?v=47",
  "./style.css?v=48",
  "./style.css?v=49",
  "./style.css?v=50",
  "./style.css?v=51",
  "./style.css?v=52",
  "./style.css?v=53",
  "./style.css?v=54",
  "./style.css?v=55",
  "./style.css?v=56",
  "./style.css?v=57",
  "./style.css?v=58",
  "./style.css?v=59",
  "./style.css?v=60",
  "./style.css?v=61",
  "./style.css?v=62",
  "./style.css?v=63",
  "./style.css?v=64",
  "./style.css?v=65",
  "./excel-template.js",
  "./excel-template.js?v=45",
  "./excel-template.js?v=46",
  "./excel-template.js?v=47",
  "./excel-template.js?v=48",
  "./excel-template.js?v=49",
  "./excel-template.js?v=50",
  "./excel-template.js?v=51",
  "./excel-template.js?v=52",
  "./excel-template.js?v=53",
  "./excel-template.js?v=54",
  "./excel-template.js?v=55",
  "./excel-template.js?v=56",
  "./excel-template.js?v=57",
  "./excel-template.js?v=58",
  "./excel-template.js?v=59",
  "./excel-template.js?v=60",
  "./excel-template.js?v=61",
  "./excel-template.js?v=62",
  "./excel-template.js?v=63",
  "./excel-template.js?v=64",
  "./excel-template.js?v=65",
  "./app.js",
  "./app.js?v=27",
  "./app.js?v=28",
  "./app.js?v=32",
  "./app.js?v=38",
  "./app.js?v=40",
  "./app.js?v=41",
  "./app.js?v=42",
  "./app.js?v=43",
  "./app.js?v=44",
  "./app.js?v=45",
  "./app.js?v=46",
  "./app.js?v=47",
  "./app.js?v=48",
  "./app.js?v=49",
  "./app.js?v=50",
  "./app.js?v=51",
  "./app.js?v=52",
  "./app.js?v=53",
  "./app.js?v=54",
  "./app.js?v=55",
  "./app.js?v=56",
  "./app.js?v=57",
  "./app.js?v=58",
  "./app.js?v=59",
  "./app.js?v=60",
  "./app.js?v=61",
  "./app.js?v=62",
  "./app.js?v=63",
  "./app.js?v=64",
  "./app.js?v=65",
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
    url.includes("/excel-template.js") ||
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
