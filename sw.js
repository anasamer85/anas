// Service Worker - نظام محاضر لجان بيع المزارع (يعمل بدون إنترنت على GitHub Pages)
const CACHE_NAME = "farm-sales-committee-v53-mobile-fixed";
const ASSETS_TO_CACHE = [
  "./",
  "./index.html",
  "./mobile.html",
  "./manifest-mobile.json",
  "./mobile-app.js",
  "./mobile-app.js?v=52",
  "./mobile-app.js?v=53",
  "./style.css",
  "./style.css?v=51",
  "./style.css?v=52",
  "./style.css?v=53",
  "./excel-template.js",
  "./excel-template.js?v=51",
  "./excel-template.js?v=52",
  "./excel-template.js?v=53",
  "./app.js",
  "./app.js?v=51",
  "./app.js?v=52",
  "./app.js?v=53",
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
        } catch (err) {}
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

  if (
    req.method !== "GET" ||
    url.includes("script.google.com") ||
    url.includes("googleusercontent.com") ||
    url.includes("firebaseio.com") ||
    url.includes("firebasedatabase.app")
  ) {
    return;
  }

  const isHtmlNav =
    req.mode === "navigate" ||
    (req.headers.get("accept") || "").includes("text/html") ||
    url.endsWith("/") ||
    url.includes("/index.html") ||
    url.includes("/mobile.html");
  if (
    isHtmlNav ||
    url.includes("/excel-template.js") ||
    url.includes("/app.js") ||
    url.includes("/mobile-app.js") ||
    url.includes("/style.css") ||
    url.includes("/manifest.json") ||
    url.includes("/manifest-mobile.json")
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
            if (url.includes("/mobile.html")) return caches.match("./mobile.html");
            if (isHtmlNav) return caches.match("./index.html");
            return cached;
          })
        )
    );
    return;
  }

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
