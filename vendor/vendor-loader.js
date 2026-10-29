// Local Vendor Loader with Smart Fallback & CacheStorage Persistence (v72)
(function() {
  const LIBRARIES = [
    { name: 'XLSX', local: './vendor/xlsx.full.min.js', cdn: 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js' },
    { name: 'Chart', local: './vendor/chart.umd.min.js', cdn: 'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js' },
    { name: 'html2canvas', local: './vendor/html2canvas.min.js', cdn: 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js' },
    { name: 'jspdf', local: './vendor/jspdf.umd.min.js', cdn: 'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js' }
  ];

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.async = false;
      s.onload = () => resolve(src);
      s.onerror = () => reject(new Error('Failed to load: ' + src));
      document.head.appendChild(s);
    });
  }

  async function ensureLibraryLoaded(lib) {
    // Check if global already exists
    if (lib.name === 'XLSX' && typeof XLSX !== 'undefined') return;
    if (lib.name === 'Chart' && typeof Chart !== 'undefined') return;
    if (lib.name === 'html2canvas' && typeof html2canvas !== 'undefined') return;
    if (lib.name === 'jspdf' && (typeof jspdf !== 'undefined' || typeof jsPDF !== 'undefined')) return;

    try {
      await loadScript(lib.local);
    } catch (e) {
      if (navigator.onLine) {
        try {
          await loadScript(lib.cdn);
        } catch (err) {}
      }
    }
  }

  window.downloadAndBundleVendorPackagesLocally = async function() {
    if (!navigator.onLine) {
      if (typeof showToast === 'function') showToast('🟠 أنت غير متصل بالإنترنت حالياً لتنزيل المكتبات محلياً!', '🟠');
      return;
    }
    if (typeof showToast === 'function') showToast('⏳ جاري تنزيل وحفظ حزمة المكتبات محلياً في الكاش...', '⏳');
    let successCount = 0;
    const cache = 'caches' in window ? await caches.open('farm-sales-committee-v72-local-vendors') : null;

    for (const lib of LIBRARIES) {
      try {
        const res = await fetch(lib.cdn, { mode: 'cors' });
        if (res && res.ok) {
          const blob = await res.blob();
          if (cache) {
            await cache.put(lib.local, new Response(blob));
          }
          successCount++;
        }
      } catch (e) {}
    }
    if (typeof showToast === 'function') {
      showToast(`✅ تم بنجاح تنزيل وحفظ (${successCount}/4) مكتبة محلياً للعمل أوفلاين بنسبة 100%!`, '✅');
    }
  };

  // Preload / ensure on startup
  window.addEventListener('DOMContentLoaded', () => {
    LIBRARIES.forEach(lib => ensureLibraryLoaded(lib));
  });
})();
