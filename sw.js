// Service Worker - نظام محاضر لجان بيع المزارع (Local Vendors PWA v72 - No Loop Fix)
const CACHE_NAME = "farm-sales-committee-v72-local-vendors";

const CORE_LOCAL_ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./style.css?v=72",
  "./excel-template.js",
  "./excel-template.js?v=72",
  "./app.js",
  "./app.js?v=72",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
  "./vendor/vendor-loader.js",
  "./vendor/vendor-loader.js?v=72"
];

const EXTERNAL_CDN_ASSETS = [
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
      await Promise.allSettled(
        CORE_LOCAL_ASSETS.map(async (url) => {
          try {
            const res = await fetch(url, { cache: "reload" });
            if (res && res.ok) {
              await cache.put(url, res.clone());
              const cleanUrl = url.split("?")[0];
              if (cleanUrl !== url) {
                await cache.put(cleanUrl, res.clone());
              }
            }
          } catch (e) {}
        })
      );
      await Promise.allSettled(
        EXTERNAL_CDN_ASSETS.map(async (url) => {
          try {
            await cache.add(url);
          } catch (e) {
            try {
              const noCorsRes = await fetch(url, { mode: "no-cors" });
              if (noCorsRes) await cache.put(url, noCorsRes);
            } catch (err2) {}
          }
        })
      );
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
    )
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

async function matchFromCacheSmart(req, isHtmlNav = false) {
  const cache = await caches.open(CACHE_NAME);

  let cached = await cache.match(req);
  if (cached) return cached;

  cached = await cache.match(req, { ignoreSearch: true });
  if (cached) return cached;

  if (isHtmlNav) {
    const htmlFallbacks = ["./index.html", "index.html", "./", "/"];
    for (const fb of htmlFallbacks) {
      const matchFb = await cache.match(fb, { ignoreSearch: true });
      if (matchFb) return matchFb;
    }
  }

  try {
    const urlObj = new URL(req.url);
    const fileName = urlObj.pathname.split("/").pop();
    if (fileName) {
      cached = await cache.match("./" + fileName, { ignoreSearch: true });
      if (cached) return cached;
      cached = await cache.match("./vendor/" + fileName, { ignoreSearch: true });
      if (cached) return cached;
    }
  } catch (e) {}

  return null;
}

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

  const acceptHeader = req.headers.get("accept") || "";
  const isHtmlNav =
    req.mode === "navigate" ||
    acceptHeader.includes("text/html") ||
    url.endsWith("/") ||
    url.includes("/index.html");

  const isLocalCoreAsset =
    isHtmlNav ||
    url.includes("/excel-template.js") ||
    url.includes("/app.js") ||
    url.includes("/style.css") ||
    url.includes("/manifest.json") ||
    url.includes("/vendor/vendor-loader.js");

  if (isLocalCoreAsset) {
    event.respondWith(
      fetch(req)
        .then(async (networkRes) => {
          if (networkRes && networkRes.status === 200) {
            const copy = networkRes.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(req, copy.clone());
              if (isHtmlNav) {
                cache.put("./index.html", copy.clone());
                cache.put("./", copy.clone());
              } else {
                try {
                  const fileName = new URL(req.url).pathname.split("/").pop();
                  if (fileName) cache.put("./" + fileName, copy.clone());
                } catch (e) {}
              }
            });
          }
          return networkRes;
        })
        .catch(async () => {
          const cachedRes = await matchFromCacheSmart(req, isHtmlNav);
          if (cachedRes) return cachedRes;
          if (isHtmlNav) return caches.match("./index.html", { ignoreSearch: true });
          return new Response("", { status: 404 });
        })
    );
    return;
  }

  event.respondWith(
    matchFromCacheSmart(req, false).then((cachedRes) => {
      if (cachedRes) return cachedRes;
      return fetch(req)
        .then((networkRes) => {
          if (networkRes && (networkRes.status === 200 || networkRes.type === "opaque")) {
            const copy = networkRes.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          }
          return networkRes;
        })
        .catch(() => {
          if (url.endsWith(".css") || url.includes("fonts.googleapis.com")) {
            return new Response("", { status: 200, headers: { "Content-Type": "text/css" } });
          }
          if (url.endsWith(".js") || url.includes("cdn.tailwindcss.com") || url.includes("cdn.jsdelivr.net")) {
            return new Response("", { status: 200, headers: { "Content-Type": "application/javascript" } });
          }
          return new Response("", { status: 404 });
        });
    })
  );
});
