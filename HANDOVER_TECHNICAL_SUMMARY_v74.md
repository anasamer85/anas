# 📘 وثيقة التسليم التقنية الشاملة (Comprehensive Technical Handover Document)
**المشروع:** نظام محاضر لجان بيع المزارع (Offline-First PWA + Two-Way Excel Sync + Cloud Sync)
**الإصدار المرجعي الحالي:** `v74` (Modular Architecture & Client-Side Delta Outbox Engine)[cite: 52, 53, 56]
**الهدف القادم المباشر:** تنفيذ المرحلة الرابعة والأخيرة (`v75`: End-to-End Cloud Delta Sync & GAS LockService)

---

## 1. هيكلة المشروع والملفات الحالية (v74 Modular Architecture)

اعتمد النظام بدءاً من الإصدار `v73` وحتى `v74` معمارية الوحدات البرمجية المقسمة (Modular Architecture) بدلاً من الملف الأحادي الضخم، ويتم استدعاء الملفات بالترتيب الصارم التالي داخل `index.html`[cite: 53]:

### أ. الملفات الأساسية في الجذر والمجلدات الفرعية:
| المسار / اسم الملف | الوظيفة التقنية الدقيقة في الإصدار `v74` |
| :--- | :--- |
| `index.html` | الهيكل الرئيسي للواجهة، بوابة تسجيل الدخول (`#loginGatewayOverlay`)، شاشة الإعداد الأولي للمتصفح الجديد (`#forceCreateFarmOverlay`)، نافذة السؤال عن السعر المفقود (`#askMissingPriceModal`)، الهيدر المدمج، الـ 6 تبويبات رئيسية، الشريط السفلي العائم للميزان (`#mobileWeighbridgeActionBar`)، حاوية الطباعة المعزولة (`#merchantPrintOnlyContainer`)، وسكربت تمهيد الأوفلاين (`#pwaOfflineBootstrapScript`)[cite: 53]. |
| `style.css` | التنسيقات المخصصة، قواعد الطباعة الحرجة (`@media print` بحجم A4 Landscape)، فئات التثبيت الاختياري للجداول الـ 12 (`sticky-headers-on`, `sticky-footers-on`, `sticky-right-cols-on`, `sticky-left-cols-on`)، وقواعد إخفاء العناصر غير الضرورية عند تفعيل وضع المندوب (`body.lite-field-mode-active`). |
| `excel-template.js` | القالب الهيكلي ومحرك بناء وتنسيق شيتات الإكسيل الـ 15 بالمعادلات الحية والألوان والحدود الرسمية[cite: 53]. |
| `vendor/vendor-loader.js` | **محرك التحميل المحلي الذكي للمكتبات + درع منع التحديث اللانهائي:** يحمل المكتبات الـ 4 (`XLSX`, `Chart`, `html2canvas`, `jspdf`) بترتيب (`CacheStorage -> CDN -> Local Fallback`)، ويوفر دالة `downloadAndBundleVendorPackagesLocally()` لتنزيلها محلياً للعمل أوفلاين بنسبة 100%، كما يعترض `navigator.serviceWorker.register` وحدث `controllerchange` لمنع دخول الصفحة في حلقة تحديث لا نهائية (Infinite Reload Loop). |
| `sw.js` | عامل الخدمة (Service Worker) بإصدار كاش `farm-sales-committee-v74-modular-architecture`؛ يدير التخزين المسبق للأصول المحلية والـ CDN ودالة المطابقة الذكية `matchFromCacheSmart`. |
| `manifest.json` & Icons | إعدادات تطبيق الـ PWA (`icon-192.png`, `icon-512.png`) لدعم التثبيت المباشر على شاشة الهاتف والكمبيوتر[cite: 52, 53]. |

### ب. الوحدات البرمجية الـ 6 داخل مجلد `./js/` (تُحمّل بهذا الترتيب):
1. **`js/core-state.js` (النواة، الحالة، التشفير، ومعايرة الوقت):**
   - تعريف مفاتيح التخزين والدالة التأسيسية `getDefaultState()` وكائن الحالة العام `appState`.
   - محرك خزينة رابط السحابة المشفر والمربوط بكلمة مرور تسجيل الدخول (`v70_vault` عبر دوال `fnv32MixHash`, `encryptWebhookWithPassphrase`, `decryptWebhookWithPassphrase`, `unlockWebhookVaultWithCredentials`).
   - معايرة التوقيت السحابي المونوتوني (`calibrateCloudClockOffset` و `getSyncedNow`) وتوليد المعرفات الفريدة عالمياً (`generateRecordUUID` و `isCollisionProofUUID`).
   - دوال منع تكرار السجلات (`areSalesRowsDuplicate`, `arePendingSalesDuplicate`, `areExpensesDuplicate`, `deduplicateAllDaysInState`) وتوحيد سجل التجار العالمي (`unifyGlobalMerchantsRegistry`).
   - بناء بيانات الرقابة وحساب فروق التعديل النصية (`buildRecordAuditMeta`, `computeRecordFieldDiffText`, `renderAuditTrailBadgeHtml`) وإدارة قفل اليوم المحاسبي (`isDayLocked`, `toggleDayLockState`).
2. **`js/accounting.js` (المحرك المحاسبي، الخزينة، وتكويد التجار):**
   - إدارة أيام الدورة (`addSpecificDayToCycle`, `editSpecificDayInCycle`, `deleteSpecificDayFromCycle`)[cite: 55].
   - أوضاع التصفير الذكي الثلاثة (`clearActiveFarmMovementsKeepMerchants`, `clearAllSiteMovementsAndArchiveKeepMerchants`, `clearEverythingToFactoryZeroState`)[cite: 55].
   - الترقيم المتسلسل المستقل للميزان والسندات (`getNextSequentialScaleNo`, `getNextSequentialVoucherNo`)[cite: 55].
   - التكويد الموحد للتجار وفصل السيارات الفرعية (`cleanMerchantBaseName`, `normalizeArabicMerchantCompareKey`, `resolveMerchantCode`, `ensureMerchantExists`)[cite: 55].
   - المعادلات المحاسبية اليومية والتراكمية (`roundMoney2`, `computeSaleRow`, `computeDaySummary`, `computeFarmCumulativeTrialBalance`, `computeMerchantAggregates`, `computeMerchantDetailedLedger`, `computeMerchantCrossFarmDebtReference`)[cite: 55].
3. **`js/storage-sync.js` (التخزين المحلي، IndexedDB، الدمج السحابي، وطابور Delta Outbox):**
   - القراءة والكتابة في `LocalStorage` و `window.name` و `IndexedDB` (`loadState`, `saveState`, `saveToIndexedDB`, `loadFromIndexedDBAsync`).
   - إدارة أرشيف المزارع المتعددة (`syncActiveFarmIntoArchive`, `activateFarmFromArchive`).
   - إدارة شواهد القبور وتقليمها (`recordDeletedItem`, `unrecordDeletedItem`, `pruneDeletedTombstones`, `sanitizeMergedTombstonesAgainstLiveData`).
   - محرك الدمج الذري على مستوى السجل (`mergeArraysById`, `mergeDaysObjects`, `mergeCloudDataIntoLocal`).
   - الاتصال السحابي والمزامنة الحية (`pushDatabaseToCloud`, `pullDatabaseFromCloud`, `startLiveRealtimeSyncEngine`).
   - **محرك طابور الحركات الجزئية (`v74`):** دالة `enqueueDeltaSyncEvent(actionType, payload)` مع ميزة ضغط الطابور (Outbox Compaction) ودالة `applyIncomingDeltaEvents(eventsList)`.
4. **`js/excel-engine.js` (محرك الربط الثنائي مع الإكسيل والنسخ الاحتياطي JSON):**
   - استيراد وتصدير ملف الإكسيل الكامل المكون من 15 شيت (`importWorkbookIntoAppState`, `exportFullWorkbookXlsx`) وتصدير كشف حساب تاجر منفرد (`exportMerchantDrillDownToExcel`).
   - تصدير واسترجاع النسخة الاحتياطية الشاملة بصيغة JSON (`exportFullJsonBackup`, `restoreFullJsonBackupFromText`) وعرض جدول سجل الرقابة الزمني (`renderBackupAndAuditCenterUI`).
5. **`js/print-export.js` (محرك الطباعة المعزولة، البون، الصور، والـ PDF):**
   - العزل الطباعي (`activateIsolatedPrintMode`, `deactivateMerchantPrintMode`, `triggerTablePrint`)[cite: 57].
   - طباعة وتصدير كارتة/بون الميزان (3 نسخ في ورقة واحدة) ومحضر تصفية اليوم الرسمي وكشف حساب التاجر كصورة `PNG` أو ملف `PDF` (`exportScaleReceiptAsImageOrPdf`, `exportMerchantStatementAsImageOrPdf`, `exportPrintTargetAsImageOrPdf`)[cite: 57].
   - توليد ملف `index.html` خفيف لـ GitHub Pages (مشفر بتسجيل الدخول) وكود التضمين الشامل لـ Google Sites (`buildEmbeddedGoogleSitesHtml`).
6. **`js/ui-controllers.js` (المتحكمات، الرسم الذكي، الفلاتر، ووضع المندوب):**
   - دوال الرسم الذكي (`renderAll`, `renderDailyView`, `renderDashboardView`, `renderMerchantsAndStatements`, `renderExpensesStatementView`, `renderUsersAndPermissionsUI`)[cite: 57].
   - محرك الفلترة والفرز الشبيه بالإكسيل لجميع جداول الموقع (`applyExcelSortAndFilter`, `applyDomTableExcelEngine`)[cite: 57].
   - محرك التوزيع التلقائي المتدرج للعهدة (`distributeCustodyWaterfall`, `depositCustodySurplusToMerchantAccount`)[cite: 57].
   - إدارة وضع المندوب المبسط (`isLiteFieldModeEffective`, `setLiteFieldMode`, `renderLiteFieldModeComponents`) ووضع سند تحصيل المديونية (`setSaleEntryMode`) والتنقل السريع بزر `Enter` داخل `initFarmSalesApp()`[cite: 57].

---

## 2. القواعد المحاسبية الصارمة (Strict Business & Accounting Rules)

> **⚠️ قاعدة ذهبية:** يُمنع منعاً باتاً تعديل أو تقريب أو اختصار أي معادلة من المعادلات المحاسبية التالية تحت أي ظرف. جميع العمليات الحسابية المالية تمر عبر دالة `roundMoney2(v)` لمنع أخطاء الفاصلة العائمة (`Floating-Point Precision Errors`)[cite: 55].

### أ. معادلات الوزن والفاتورة (وشرط منع `w2 < w1`):
1. **الوزنة الأولى (`w1`):** وزن السيارة فارغة (كجم)[cite: 53, 55].
2. **الوزنة الثانية (`w2`):** وزن السيارة محملة/قائم (كجم)[cite: 53, 55].
3. **شرط التحقق الصارم:** يجب دائماً أن تكون `w2 >= w1` و `w2 > 0`.
   - إذا أدخل المستخدم `w2 < w1`، يتم إظهار بانر التحذير الأحمر (`#weightValidationAlert`) فوراً، وتكون قيمة الوزن الصافي `netWeight = 0`، ويُمنع إتمام الحفظ النهائي للحركة[cite: 53, 55, 57].
4. **الوزن الصافي (`netWeight`):**
   $$\text{netWeight} = (\text{w2} \ge \text{w1} \land \text{w2} > 0) \ ? \ \text{roundMoney2}(\text{w2} - \text{w1}) : 0$$[cite: 55]
5. **إجمالي الفاتورة بالإكرامية (`totalWithTip`):**
   $$\text{baseAmount} = \text{roundMoney2}(\text{netWeight} \times \text{price})$$[cite: 55]
   $$\text{totalWithTip} = \text{roundMoney2}(\text{baseAmount} + \text{tip})$$[cite: 55]
6. **مطابقة توازن الفاتورة (`invoiceDiff`):**
   $$\text{totalPaidAndCredit} = \text{roundMoney2}(\text{cashSales} + \text{transferSales} + \text{creditSales})$$[cite: 55]
   $$\text{invoiceDiff} = \text{roundMoney2}(\text{totalPaidAndCredit} - \text{totalWithTip})$$[cite: 55]
   *(تكون الفاتورة متزنة عندما يكون $|\text{invoiceDiff}| \le 1$)*[cite: 55, 57].

### ب. معادلة الخزينة النقدية وفصل التحويلات والعهدة:
1. **إجمالي وارد النقدية لليوم قبل المصاريف (`totalCashBeforeExpenses`):**
   $$\text{totalCashBeforeExpenses} = \text{roundMoney2}(\text{sumCashSales} + \text{sumDebtCash} + \text{sumPrevCash})$$[cite: 55]
   *(يشمل حصرياً: نقدي مبيعات اليوم + نقدي تحصيل مديونيات المزرعة الحالية + نقدي تحصيلات المزارع السابقة)*[cite: 55].
2. **صافي نقدية حركات اليوم بعد المصاريف (`netCashInBox`):**
   $$\text{netCashInBox} = \text{roundMoney2}(\text{totalCashBeforeExpenses} - \text{sumExpenses})$$[cite: 55]
3. **الرصيد النقدي الافتتاحي المرحّل من أمس (`openingCashFromPrevDay`):**
   - في اليوم الأول ($d = 1$): يساوي `Number(dayObj.openingCash) || 0`[cite: 55].
   - في الأيام ($d > 1$): يساوي تلقائياً `carriedForwardCash` المسجل في اليوم السابق ($d - 1$)[cite: 55].
4. **إجمالي النقدية المتاحة بالخزنة (`totalAvailableCashInBox`):**
   $$\text{totalAvailableCashInBox} = \text{roundMoney2}(\text{openingCashFromPrevDay} + \text{netCashInBox})$$[cite: 55]
5. **إجمالي النقدية المسلمة والمرحّلة (`totalSettledAndCarriedCash`) وفرق الخزينة (`cashBoxDiff`):**
   $$\text{totalSettledAndCarriedCash} = \text{roundMoney2}(\text{deliveredCash} + \text{carriedForwardCash})$$[cite: 55]
   $$\text{cashBoxDiff} = \text{roundMoney2}(\text{totalAvailableCashInBox} - \text{totalSettledAndCarriedCash})$$[cite: 55]
   *(إذا كان الفرق $0$ فالخزينة مطابقة ✓، وإذا كان $> 0$ فهو عجز توريد/متبقي بالصندوق، وإذا كان $< 0$ فهو زيادة توريد)*[cite: 55, 57].
   *(في ميزان المراجعة التراكمي للمزرعة بالكامل `computeFarmCumulativeTrialBalance`، يُحسب `totalCashInflowBeforeExpenses` بجمع النقدية الداخلة عبر كل الأيام دون تكرار الرصيد المرحّل بين الأيام، ويُقارن مع مجموع `sumDeliveredCash` لكل الأيام مضافاً إليه `lastDayCarriedForwardCash` لآخر يوم نشط فقط لمنع الازدواج المحاسبي)*[cite: 55].
6. **قاعدة فصل التحويلات البنكية والشيكات:**
   - جميع التحويلات (`transferSales`, `debtTransfer`, `prevTransfer`) **لا تدخل الخزينة النقدية إطلاقاً** وتُعامل معاملة الآجل بالنسبة لصندوق النقدية[cite: 53, 55].
   - تحويلات المزرعة الحالية (`currentFarmTransfers = sumTransferSales + sumDebtTransfer`) تُخصم من مديونية التاجر في المزرعة الحالية[cite: 53, 55].
   - تحويلات المزارع السابقة (`sumPrevTransfer`) ونقدي المزارع السابقة (`sumPrevCash`) تخص مواقع أخرى **ولا تُخصم أبداً من مديونية التاجر في المزرعة الحالية**[cite: 53, 55].
7. **قاعدة العهدة المستقلة والتوزيع المتدرج (`Custody Waterfall`):**
   - حقول العهدة (`custodyCash`, `custodyTransfer`, `custodyTransferType`) هي بيان مستقل يُوزع تلقائياً عبر دالة `distributeCustodyWaterfall` بالترتيب المحاسبي التالي[cite: 55, 57]:
     1. **أولاً:** سداد المديونية السابقة على التاجر في المزرعة الحالية (`debtCash`, `debtTransfer`).
     2. **ثانياً:** توجيه المتبقي من العهدة لسداد فاتورة اليوم (`cashSales`, `transferSales`) عند إدخال الوزنة الثانية.
     3. **ثالثاً:** حساب باقي الفاتورة آجلاً (`creditSales`)، أو إظهار الفائض في `netCustodyRemaining` مع توفير زر (`#btnDepositCustodySurplusToAccount`) لإيداع الفائض كرصيد دائن تحت حساب التاجر[cite: 53, 55, 57].

### ج. آليات "سند تحصيل مديونية فقط" (`isDebtCollectionOnly`) وحساب الذمم:
1. **تعريف سند التحصيل المستقل:** يُصنف السجل كـ `isDebtCollectionOnly = true` إذا لم يكن وزنة مؤقتة (`!row.isPending`) وكانت (`w1 === 0 && w2 === 0 && totalWithTip === 0 && cashSales === 0 && transferSales === 0 && creditSales === 0`) مع وجود تحصيل فعلي (`debtCash > 0 || debtTransfer > 0 || prevCash > 0 || prevTransfer > 0` أو `entryMode === 'debt_only'`)[cite: 54, 55].
2. **معاملته برمجياً ومحاسبياً:**
   - يأخذ رقم سند متسلسل مستقل (`voucherNo` عبر `getNextSequentialVoucherNo`) منفصل عن مسلسل الميزان (`scaleNo`)[cite: 55, 57].
   - لا يُضاف إلى عدد سيارات التحميل (`countCars`) حتى لا يشوه متوسط وزن السيارة (`avgCarWeight`)، بل يُحصى في `countDebtVouchers`[cite: 55].
   - يُرتب دائماً في نهاية جدول المبيعات اليومي بعد جميع حركات الميزان عبر دالة `sortSalesListByScaleNo`[cite: 54, 55].
3. **معادلة التكويد الموحد ومديونية التاجر:**
   - أي سيارة فرعية تحمل رقماً (مثل: `كرنك 1`، `كرنك 2`) تُربط تلقائياً بنفس الكود الموحد للتاجر الأساسي (`104 - كرنك`) عبر `resolveMerchantCode`[cite: 53, 55].
   - صافي مديونية التاجر أو المزرعة الحالية في أي لحظة:
     $$\text{ClosingDebt} = \sum (\text{creditSales} - \text{debtCash} - \text{debtTransfer})$$[cite: 55]

---

## 3. هيكل البيانات الدقيق (Data Schema & Storage - v74)

### أ. الهيكل الكامل لكائن الحالة `appState` في `v74`:
> **⚠️ تنبيه هيكلي هام:** يقع الحقلان `syncOutbox: []` و `lastDeltaSyncAt: 0` في **المستوى الأعلى (Root Level)** لكائن `appState`، ويُحظر وضعهما داخل كائن `deletedIds`.

```javascript
{
  farmName: "اسم المزرعة النشطة",
  lastFarmSwitchAt: 1730000000000,
  lastExcelSync: "نص حالة آخر مزامنة",
  currentDay: 1,                  // اليوم المفتوح حالياً (1..10)
  visibleDays: [1],               // مصفوفة أرقام الأيام المفتوحة والنشطة
  activeTab: "daily",             // daily | dashboard | merchants | transfers | expenses | sync
  merchantsViewFilter: "all",     // all | active
  transfersViewFilter: "all",     // all | active
  prevFarmsViewFilter: "all",     // all | active
  expensesViewFilter: "all",      // all | active
  pendingChanges: 0,              // عداد التعديلات المحلية
  hasLocalEdits: false,
  liveSyncEnabled: true,
  liveSyncIntervalSec: 5,
  syncOutbox: [],                 // [v74] طابور الحركات الجزئية المعلقة للرفع: [{ action, payload, ts }]
  lastDeltaSyncAt: 0,             // [v74] آخر طابع زمني (Timestamp ms) لمزامنة جزئية ناجحة مع السحابة
  deletedIds: {                   // قوائم المعرفات المحذوفة (Tombstone IDs)
    sales: [],
    pendingSales: [],
    expenses: [],
    merchants: [],
    users: [],
    farms: []
  },
  deletedTimestamps: {            // خرائط وقت الحذف الدقيق لكل معرف { [id]: timestampMs }
    sales: {},
    pendingSales: {},
    expenses: {},
    merchants: {},
    users: {},
    farms: {}
  },
  webhookUrl: "[https://script.google.com/macros/s/.../exec](https://script.google.com/macros/s/.../exec)",
  updatedAt: "2026-10-29T...",
  farmResetAt: 0,
  factoryZeroWipeAt: 0,
  lastBulkImportAt: 0,
  defaultPrice: 0,                // السعر الافتراضي الثابت لليوم
  defaultTip: 0,                  // الإكرامية الافتراضية الثابتة
  lastScaleNo: 0,
  lastVoucherNo: 0,
  inactivityTimeoutMin: 20,       // زمن الخروج التلقائي لعدم النشاط بالدقائق (0 = متوقف)
  showFloatingActionBar: true,
  showAuditMetadata: true,
  liteFieldMode: false,           // حالة تفعيل وضع شاشة المندوب المبسط
  autoLiteFieldOnMobile: true,    // التفعيل التلقائي لوضع المندوب على شاشات الهاتف
  stickyTableOptions: {
    headers: true,
    footers: true,
    rightCols: true,
    leftCols: true
  },
  activeUserId: "admin",
  isLoggedIn: false,
  lastActivityAt: 1730000000000,
  users: [
    {
      id: "admin",
      username: "admin",
      password: "admin",
      name: "مدير الموقع (كامل الصلاحيات)",
      phone: "",
      jobTitle: "مدير عام المزرعة",
      isSystem: true,
      updatedAt: 1730000000000,
      perms: {
        sales: true, expenses: true, merchants: true, farms: true, admin: true,
        liteFieldMode: false, showSyncExcel: true, showSyncCloud: true, showSyncWebhook: true
      }
    }
  ],
  merchants: [
    { code: 101, name: "اسم التاجر الأساسي", updatedAt: 1730000000000 }
  ],
  days: {
    "1": {
      dayNumber: 1,
      dateLabel: "اليوم 1",
      labelUpdatedAt: 0,
      sales: [],                  // حركات البيع المكتملة وسندات التحصيل
      pendingSales: [],           // السيارات المحجوزة مؤقتاً بانتظار الوزنة 2
      expenses: [],               // مصروفات ومكافآت اليوم
      deliveredCash: 0,           // النقدية الموردة للإدارة/البنك
      deliveredCashUpdatedAt: 0,
      carriedForwardCash: 0,      // الرصيد النقدي المرحّل لليوم التالي بالخزنة
      carriedForwardCashUpdatedAt: 0,
      isLocked: false,            // حالة تشميع وإقفال اليوم محاسبياً
      lockedBy: "",
      lockedAtTxt: "",
      lockUpdatedAt: 0,
      clearedAt: 0,
      addedAt: 0,
      isHidden: false
    }
    // ... حتى اليوم "10"
  },
  farmsArchive: {
    "اسم المزرعة": { /* نسخة كاملة مستقلة من بيانات المزرعة وأيامها الـ 10 */ }
  }
}