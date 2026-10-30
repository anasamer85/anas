# 🏡 نظام محاضر لجان بيع المزارع والميزان (Offline-First Modular PWA — الإصدار v76 Performance & Enterprise Sync)

تطبيق ويب تقدمي متكامل (**Offline-First Modular PWA**) لإدارة محاضر لجان بيع المزارع وموازين السيارات على مدار **10 أيام** لكل دورة، مع **ربط ثنائي الاتجاه (Two-Way Sync)** مع شيت الإكسيل المكون من **15 شيت بالمعادلات الحية**، ومحرك **المزامنة الجزئية السحابية اللحظية (End-to-End Cloud Delta Sync & GAS LockService)**، وتحسينات الأداء والذاكرة الميدانية (**v76**).

---

## 📁 هيكلة ملفات المشروع المقسمة (`v76 Modular Architecture`)
1. **`index.html`**: الهيكل الرئيسي للواجهة، بوابة تسجيل الدخول، شاشة الإعداد الأولي، الـ 6 تبويبات رئيسية، الشريط السفلي العائم للميزان، وسكربت تمهيد الأوفلاين (`#pwaOfflineBootstrapScript`) مع تحميل غير حاجب (`defer`) لمكتبة Tailwind.
2. **`style.css`**: التنسيقات المخصصة، قواعد الطباعة (`@media print` بحجم A4 Landscape)، فئات التثبيت الاختياري للجداول الـ 12، وقواعد وضع شاشة المندوب المبسط (`body.lite-field-mode-active` و `.sticky-lite-banner`).
3. **`excel-template.js`**: القالب الهيكلي ومحرك بناء وتنسيق شيتات الإكسيل الـ 15 بالمعادلات الحية والألوان والحدود الرسمية.
4. **`vendor/vendor-loader.js`**: محرك التحميل المحلي الذكي للمكتبات (`XLSX`, `Chart`, `html2canvas`, `jspdf`) + درع منع التحديث اللانهائي (`Infinite Reload Loop Guard`).
5. **`sw.js`**: عامل الخدمة بإصدار الكاش الجديد (`farm-sales-v76-performance-sync`) المزود بمهلة شبكة زمنية (`3 ثوانٍ`) عبر `Promise.race` و `AbortController` ودالة المطابقة الذكية `matchFromCacheSmart`.
6. **الوحدات البرمجية الـ 6 داخل مجلد `./js/`**:
   - `js/core-state.js`: النواة، كائن الحالة العام `appState` (شاملاً `syncOutbox` و `lastDeltaSyncAt` و `stickyLiteBanner`)، تشفير رابط السحابة، ومعايرة التوقيت السحابي المونوتوني.
   - `js/accounting.js`: المحرك المحاسبي الصارم، معادلات الخزينة والترحيل، التوزيع المتدرج للعهدة، وتكويد التجار الموحد مع حماية شاملة ضد أخطاء الفاصلة العائمة عبر `roundMoney2`.
   - `js/storage-sync.js`: التخزين المحلي و IndexedDB، محرك طابور الحركات الجزئية (`enqueueDeltaSyncEvent` و `applyIncomingDeltaEvents`)، وبروتوكول المزامنة السحابية الجزئية (`delta_sync` و `delta_pull`).
   - `js/excel-engine.js`: محرك الربط الثنائي مع الإكسيل (15 شيت) والمفتاح المركب المحصّن (`buildExcelSaleCompositeKey`) والنسخ الاحتياطي الشامل بصيغة JSON.
   - `js/print-export.js`: محرك الطباعة المعزولة، كارتة/بون الميزان (3 نسخ)، وتصدير الصور `PNG` وملفات `PDF`.
   - `js/ui-controllers.js`: المتحكمات، الرسم الذكي للتبويب النشط، محرك الفلاتر ذو الاستنساخ المؤجل (`Lazy DOM Cloning`)، وضع المندوب المبسط، وكود السحابة المطور (`Google Apps Script v76`).

---

## 🚀 ملخص التحديثات والتحسينات الشاملة في الإصدار `v76`

1. **إحكام طابور المزامنة الجزئية (`syncOutbox` للتجار والمستخدمين):**
   - إدراج تعديلات أسماء التجار (`UPSERT_MERCHANT`) وإضافة وتعديل المستخدمين وتحديث الملف الشخصي وكلمة المرور (`UPSERT_USER`) داخل طابور `syncOutbox` قبل الحفظ لضمان رفعها فوراً عبر مسار `delta_sync` وتحديثها لحظياً على جميع الأجهزة.

2. **حماية كاملة من أخطاء الفاصلة العائمة (`100% Floating-Point Precision`):**
   - تغليف كافة عمليات الجمع والطرح المباشرة والتراكمية بدالة `roundMoney2` في `renderCloudDatabaseHub` و `computeMerchantDetailedLedger` و `computeMerchantCurrentDebtExcluding` و `computeFarmCumulativeTrialBalance` لمنع أي كسور عشرية وهمية.

3. **تحسينات واجهة وتجربة المندوب على الهواتف (`Lite Field Mode UI/UX`):**
   - إلغاء ازدواجية الهيدر العلوي بإخفاء `#mainHeader` تماماً عند تفعيل `body.lite-field-mode-active` والاكتفاء بشريط المندوب (`#liteFieldModeActiveBanner`).
   - إضافة خيار **"📌 تثبيت شريط المندوب في أعلى الشاشة أثناء التمرير"** (`#chkStickyLiteBanner` والفئة `.sticky-lite-banner`) مع حفظ تفضيل المندوب تلقائياً في `LocalStorage` (`pref_sticky_lite_banner`).
   - زيادة الهامش السفلي (`padding-bottom: 135px` للموبايل و `150px` للشاشات `<= 400px`) لمنع الشريط السفلي العائم (`#mobileWeighbridgeActionBar`) من تغطية البطاقات السفلية عند ظهور زر توزيع العهدة.

4. **تطوير محرك الأوفلاين ومهلة الشبكة (`3s Network Timeout & Cache v76`):**
   - ترقية اسم الكاش في `sw.js` و `vendor-loader.js` و `index.html` إلى `farm-sales-v76-performance-sync` لضمان تحميل التحديثات فوراً على هواتف المندوبين، مع حصر `caches.delete` داخل حدث `activate` في `sw.js` فقط.
   - إضافة مهلة زمنية قدرها **3 ثوانٍ** (`fetchCoreWithTimeout` عبر `Promise.race`) في `sw.js` لقطع محاولات الشبكة البطيئة في المزارع والتحول الفوري للكاش المحلي.

5. **تحسين الأداء وتقليل استهلاك الذاكرة (`Performance & Lazy DOM Cloning`):**
   - تأجيل استنساخ صفوف الجداول (`cloneNode(true)`) في دالة `applyDomTableExcelEngine` (`domTableRawCache`) ليتم تنفيذه **فقط** عند تفعيل أو استخدام الفلتر/الفرز فعلياً (`captureDomTableRawRows`)، مما يوفر الذاكرة ويسرّع الرسم اليومي على الهواتف الاقتصادية.
   - تحديث دوال النسخ للحافظة (`copyTextToClipboardReliable`) لتعتمد على `navigator.clipboard.writeText` أولاً مع بديل احتياطي `document.execCommand('copy')`، وإضافة السمة `defer` لسكربت Tailwind CDN، وتنظيف الأكواد والمتغيرات غير المستخدمة.
