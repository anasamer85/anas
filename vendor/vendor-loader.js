// Local Vendor Loader + Service Worker Infinite-Reload Loop Guard (v89 Modular Architecture)
(function () {
  var VENDOR_CACHE_NAME = 'farm-sales-v89-core-sync-fix';
  var UNIFIED_SW_URL = './sw.js?v=73';

  // 1. درع الحماية ضد التحديث المستمر للصفحة (Infinite Reload Loop Guard)
  if ('serviceWorker' in navigator) {
    var origRegister = navigator.serviceWorker.register.bind(navigator.serviceWorker);
    var registrationPromise = null;
    navigator.serviceWorker.register = function (scriptURL, options) {
      if (registrationPromise) return registrationPromise;
      window.__swRegisteredOnceV86 = true;
      registrationPromise = origRegister(UNIFIED_SW_URL, options || { scope: './' }).catch(function () {});
      return registrationPromise;
    };

    var origAddEventListener = navigator.serviceWorker.addEventListener.bind(navigator.serviceWorker);
    navigator.serviceWorker.addEventListener = function (type, listener, options) {
      if (type === 'controllerchange') {
        var safeListener = function (evt) {
          if (window.__manualForceUpdateRequested === true && typeof listener === 'function') {
            listener.call(this, evt);
          }
        };
        return origAddEventListener(type, safeListener, options);
      }
      return origAddEventListener(type, listener, options);
    };
  }

  // 2. محرك التحميل المحلي الذكي للمكتبات (CacheStorage -> CDN -> Local Fallback)
  var LIBRARIES = [
    { name: 'XLSX', local: './vendor/xlsx.full.min.js', cdn: 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js' },
    { name: 'Chart', local: './vendor/chart.umd.min.js', cdn: 'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js' },
    { name: 'html2canvas', local: './vendor/html2canvas.min.js', cdn: 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js' },
    { name: 'jspdf', local: './vendor/jspdf.umd.min.js', cdn: 'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js' }
  ];

  function isLibAlreadyLoaded(name) {
    if (name === 'XLSX' && typeof window.XLSX !== 'undefined') return true;
    if (name === 'Chart' && typeof window.Chart !== 'undefined') return true;
    if (name === 'html2canvas' && typeof window.html2canvas !== 'undefined') return true;
    if (name === 'jspdf' && (typeof window.jspdf !== 'undefined' || typeof window.jsPDF !== 'undefined')) return true;
    return false;
  }

  function loadScriptTag(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.async = false;
      s.setAttribute('data-dynamic-vendor-script', '1');
      s.onload = function () { resolve(src); };
      s.onerror = function () { reject(new Error('Failed to load: ' + src)); };
      document.head.appendChild(s);
    });
  }

  async function ensureLibraryLoaded(lib) {
    if (isLibAlreadyLoaded(lib.name)) return;

    if ('caches' in window) {
      try {
        var cache = await caches.open(VENDOR_CACHE_NAME);
        var cachedRes = (await cache.match(lib.local, { ignoreSearch: true })) || (await cache.match(lib.cdn, { ignoreSearch: true }));
        if (cachedRes && cachedRes.ok) {
          var codeTxt = await cachedRes.text();
          if (codeTxt && !codeTxt.trim().startsWith('<')) {
            var blob = new Blob([codeTxt], { type: 'application/javascript' });
            var blobUrl = URL.createObjectURL(blob);
            await loadScriptTag(blobUrl);
            URL.revokeObjectURL(blobUrl);
            if (isLibAlreadyLoaded(lib.name)) return;
          }
        }
      } catch (e) {}
    }

    if (navigator.onLine) {
      try {
        await loadScriptTag(lib.cdn);
        if ('caches' in window) {
          fetch(lib.cdn, { mode: 'cors' }).then(async function (res) {
            if (res && res.ok) {
              var cache = await caches.open(VENDOR_CACHE_NAME);
              await cache.put(lib.local, res.clone());
              await cache.put(lib.cdn, res.clone());
            }
          }).catch(function () {});
        }
        return;
      } catch (err) {}
    }

    try {
      await loadScriptTag(lib.local);
    } catch (e) {}
  }

  window.downloadAndBundleVendorPackagesLocally = async function () {
    if (!navigator.onLine) {
      if (typeof showToast === 'function') showToast('🟠 أنت غير متصل بالإنترنت حالياً لتنزيل المكتبات محلياً!', '🟠');
      return;
    }
    if (typeof showToast === 'function') showToast('⏳ جاري تنزيل وحفظ حزمة المكتبات محلياً في الكاش...', '⏳');
    var successCount = 0;
    var cache = 'caches' in window ? await caches.open(VENDOR_CACHE_NAME) : null;

    for (var i = 0; i < LIBRARIES.length; i++) {
      var lib = LIBRARIES[i];
      try {
        var res = await fetch(lib.cdn, { mode: 'cors' });
        if (res && res.ok) {
          var blob = await res.blob();
          if (cache) {
            await cache.put(lib.local, new Response(blob, { headers: { 'Content-Type': 'application/javascript' } }));
            await cache.put(lib.cdn, new Response(blob, { headers: { 'Content-Type': 'application/javascript' } }));
          }
          successCount++;
        }
      } catch (e) {}
    }
    if (typeof showToast === 'function') {
      showToast('✅ تم بنجاح تنزيل وحفظ (' + successCount + '/4) مكتبة محلياً للعمل أوفلاين بنسبة 100%!', '✅');
    }
  };

  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', function () {
      LIBRARIES.forEach(function (lib) { ensureLibraryLoaded(lib); });
    });
  } else {
    LIBRARIES.forEach(function (lib) { ensureLibraryLoaded(lib); });
  }
})();
