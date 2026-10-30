# 📘 وثيقة التسليم التقنية الشاملة (Comprehensive Technical Handover Document)

**المشروع:** نظام محاضر لجان بيع المزارع (Offline-First PWA + Two-Way Excel Sync + Cloud Sync)
**الإصدار المرجعي الحالي:** `v77` (`farm-sales-v77-mobile-default` — Performance, QA Fortification & Enterprise Delta Sync) (Modular Architecture & Client-Side Delta Outbox Engine)
**الهدف القادم المباشر:** تنفيذ المرحلة الرابعة والأخيرة (`v75`: End-to-End Cloud Delta Sync & GAS LockService)

---

## 1. هيكلة المشروع والملفات الحالية (v74 Modular Architecture)

اعتمد النظام بدءاً من الإصدار `v73` وحتى `v74` معمارية الوحدات البرمجية المقسمة (Modular Architecture) بدلاً من الملف الأحادي الضخم، ويتم استدعاء الملفات بالترتيب الصارم التالي داخل `index.html`:

### أ. الملفات الأساسية في الجذر والمجلدات الفرعية:
| المسار / اسم الملف | الوظيفة التقنية الدقيقة في الإصدار `v74` |
| :--- | :--- |
| `index.html` | الهيكل الرئيسي للواجهة، بوابة تسجيل الدخول (`#loginGatewayOverlay`)، شاشة الإعداد الأولي للمتصفح الجديد (`#forceCreateFarmOverlay`)، نافذة السؤال عن السعر المفقود (`#askMissingPriceModal`)، الهيدر المدمج، الـ 6 تبويبات رئيسية، الشريط السفلي العائم للميزان (`#mobileWeighbridgeActionBar`)، حاوية الطباعة المعزولة (`#merchantPrintOnlyContainer`)، وسكربت تمهيد الأوفلاين (`#pwaOfflineBootstrapScript`). |
| `style.css` | التنسيقات المخصصة، قواعد الطباعة الحرجة (`@media print` بحجم A4 Landscape)، فئات التثبيت الاختياري للجداول الـ 12 (`sticky-headers-on`, `sticky-footers-on`, `sticky-right-cols-on`, `sticky-left-cols-on`)، وقواعد إخفاء العناصر غير الضرورية عند تفعيل وضع المندوب (`body.lite-field-mode-active`). |
| `excel-template.js` | القالب الهيكلي ومحرك بناء وتنسيق شيتات الإكسيل الـ 15 بالمعادلات الحية والألوان والحدود الرسمية. |
| `vendor/vendor-loader.js` | **محرك التحميل المحلي الذكي للمكتبات + درع منع التحديث اللانهائي:** يحمل المكتبات الـ 4 (`XLSX`, `Chart`, `html2canvas`, `jspdf`) بترتيب (`CacheStorage -> CDN -> Local Fallback`)، ويوفر دالة `downloadAndBundleVendorPackagesLocally()` لتنزيلها محلياً للعمل أوفلاين بنسبة 100%، كما يعترض `navigator.serviceWorker.register` وحدث `controllerchange` لمنع دخول الصفحة في حلقة تحديث لا نهائية (Infinite Reload Loop). |
| `sw.js` | عامل الخدمة (Service Worker) بإصدار كاش `farm-sales-v77-mobile-default`؛ يدير التخزين المسبق للأصول المحلية والـ CDN ودالة المطابقة الذكية `matchFromCacheSmart`. |
| `manifest.json` & Icons | إعدادات تطبيق الـ PWA (`icon-192.png`, `icon-512.png`) لدعم التثبيت المباشر على شاشة الهاتف والكمبيوتر. |

### ب. الوحدات البرمجية الـ 6 داخل مجلد `./js/` (تُحمّل بهذا الترتيب):
1. **`js/core-state.js` (النواة، الحالة، التشفير، ومعايرة الوقت):**
   - تعريف مفاتيح التخزين والدالة التأسيسية `getDefaultState()` وكائن الحالة العام `appState`.
   - محرك خزينة رابط السحابة المشفر والمربوط بكلمة مرور تسجيل الدخول (`v70_vault` عبر دوال `fnv32MixHash`, `encryptWebhookWithPassphrase`, `decryptWebhookWithPassphrase`, `unlockWebhookVaultWithCredentials`).
   - معايرة التوقيت السحابي المونوتوني (`calibrateCloudClockOffset` و `getSyncedNow`) وتوليد المعرفات الفريدة عالمياً (`generateRecordUUID` و `isCollisionProofUUID`).
   - دوال منع تكرار السجلات (`areSalesRowsDuplicate`, `arePendingSalesDuplicate`, `areExpensesDuplicate`, `deduplicateAllDaysInState`) وتوحيد سجل التجار العالمي (`unifyGlobalMerchantsRegistry`).
   - بناء بيانات الرقابة وحساب فروق التعديل النصية (`buildRecordAuditMeta`, `computeRecordFieldDiffText`, `renderAuditTrailBadgeHtml`) وإدارة قفل اليوم المحاسبي (`isDayLocked`, `toggleDayLockState`).
2. **`js/accounting.js` (المحرك المحاسبي، الخزينة، وتكويد التجار):**
   - إدارة أيام الدورة (`addSpecificDayToCycle`, `editSpecificDayInCycle`, `deleteSpecificDayFromCycle`).
   - أوضاع التصفير الذكي الثلاثة (`clearActiveFarmMovementsKeepMerchants`, `clearAllSiteMovementsAndArchiveKeepMerchants`, `clearEverythingToFactoryZeroState`).
   - الترقيم المتسلسل المستقل للميزان والسندات (`getNextSequentialScaleNo`, `getNextSequentialVoucherNo`).
   - التكويد الموحد للتجار وفصل السيارات الفرعية (`cleanMerchantBaseName`, `normalizeArabicMerchantCompareKey`, `resolveMerchantCode`, `ensureMerchantExists`).
   - المعادلات المحاسبية اليومية والتراكمية (`roundMoney2`, `computeSaleRow`, `computeDaySummary`, `computeFarmCumulativeTrialBalance`, `computeMerchantAggregates`, `computeMerchantDetailedLedger`, `computeMerchantCrossFarmDebtReference`).
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
   - العزل الطباعي (`activateIsolatedPrintMode`, `deactivateMerchantPrintMode`, `triggerTablePrint`).
   - طباعة وتصدير كارتة/بون الميزان (3 نسخ في ورقة واحدة) ومحضر تصفية اليوم الرسمي وكشف حساب التاجر كصورة `PNG` أو ملف `PDF` (`exportScaleReceiptAsImageOrPdf`, `exportMerchantStatementAsImageOrPdf`, `exportPrintTargetAsImageOrPdf`).
   - توليد ملف `index.html` خفيف لـ GitHub Pages (مشفر بتسجيل الدخول) وكود التضمين الشامل لـ Google Sites (`buildEmbeddedGoogleSitesHtml`).
6. **`js/ui-controllers.js` (المتحكمات، الرسم الذكي، الفلاتر، ووضع المندوب):**
   - دوال الرسم الذكي (`renderAll`, `renderDailyView`, `renderDashboardView`, `renderMerchantsAndStatements`, `renderExpensesStatementView`, `renderUsersAndPermissionsUI`).
   - محرك الفلترة والفرز الشبيه بالإكسيل لجميع جداول الموقع (`applyExcelSortAndFilter`, `applyDomTableExcelEngine`).
   - محرك التوزيع التلقائي المتدرج للعهدة (`distributeCustodyWaterfall`, `depositCustodySurplusToMerchantAccount`).
   - إدارة وضع المندوب المبسط (`isLiteFieldModeEffective`, `setLiteFieldMode`, `renderLiteFieldModeComponents`) ووضع سند تحصيل المديونية (`setSaleEntryMode`) والتنقل السريع بزر `Enter` داخل `initFarmSalesApp()`.

---

## 2. القواعد المحاسبية الصارمة (Strict Business & Accounting Rules)

> **⚠️ قاعدة ذهبية:** يُمنع منعاً باتاً تعديل أو تقريب أو اختصار أي معادلة من المعادلات المحاسبية التالية تحت أي ظرف. جميع العمليات الحسابية المالية تمر عبر دالة `roundMoney2(v)` لمنع أخطاء الفاصلة العائمة (`Floating-Point Precision Errors`).

### أ. معادلات الوزن والفاتورة (وشرط منع `w2 < w1`):
1. **الوزنة الأولى (`w1`):** وزن السيارة فارغة (كجم).
2. **الوزنة الثانية (`w2`):** وزن السيارة محملة/قائم (كجم).
3. **شرط التحقق الصارم:** يجب دائماً أن تكون `w2 >= w1` و `w2 > 0`.
   - إذا أدخل المستخدم `w2 < w1`، يتم إظهار بانر التحذير الأحمر (`#weightValidationAlert`) فوراً، وتكون قيمة الوزن الصافي `netWeight = 0`، ويُمنع إتمام الحفظ النهائي للحركة.
4. **الوزن الصافي (`netWeight`):**
   $$\text{netWeight} = (\text{w2} \ge \text{w1} \land \text{w2} > 0) \ ? \ \text{roundMoney2}(\text{w2} - \text{w1}) : 0$$
5. **إجمالي الفاتورة بالإكرامية (`totalWithTip`):**
   $$\text{baseAmount} = \text{roundMoney2}(\text{netWeight} \times \text{price})$$
   $$\text{totalWithTip} = \text{roundMoney2}(\text{baseAmount} + \text{tip})$$
6. **مطابقة توازن الفاتورة (`invoiceDiff`):**
   $$\text{totalPaidAndCredit} = \text{roundMoney2}(\text{cashSales} + \text{transferSales} + \text{creditSales})$$
   $$\text{invoiceDiff} = \text{roundMoney2}(\text{totalPaidAndCredit} - \text{totalWithTip})$$
   *(تكون الفاتورة متزنة عندما يكون $|\text{invoiceDiff}| \le 1$)*.

### ب. معادلة الخزينة النقدية وفصل التحويلات والعهدة:
1. **إجمالي وارد النقدية لليوم قبل المصاريف (`totalCashBeforeExpenses`):**
   $$\text{totalCashBeforeExpenses} = \text{roundMoney2}(\text{sumCashSales} + \text{sumDebtCash} + \text{sumPrevCash})$$
   *(يشمل حصرياً: نقدي مبيعات اليوم + نقدي تحصيل مديونيات المزرعة الحالية + نقدي تحصيلات المزارع السابقة)*.
2. **صافي نقدية حركات اليوم بعد المصاريف (`netCashInBox`):**
   $$\text{netCashInBox} = \text{roundMoney2}(\text{totalCashBeforeExpenses} - \text{sumExpenses})$$
3. **الرصيد النقدي الافتتاحي المرحّل من أمس (`openingCashFromPrevDay`):**
   - في اليوم الأول ($d = 1$): يساوي `Number(dayObj.openingCash) || 0`.
   - في الأيام ($d > 1$): يساوي تلقائياً `carriedForwardCash` المسجل في اليوم السابق ($d - 1$).
4. **إجمالي النقدية المتاحة بالخزنة (`totalAvailableCashInBox`):**
   $$\text{totalAvailableCashInBox} = \text{roundMoney2}(\text{openingCashFromPrevDay} + \text{netCashInBox})$$
5. **إجمالي النقدية المسلمة والمرحّلة (`totalSettledAndCarriedCash`) وفرق الخزينة (`cashBoxDiff`):**
   $$\text{totalSettledAndCarriedCash} = \text{roundMoney2}(\text{deliveredCash} + \text{carriedForwardCash})$$
   $$\text{cashBoxDiff} = \text{roundMoney2}(\text{totalAvailableCashInBox} - \text{totalSettledAndCarriedCash})$$
   *(إذا كان الفرق $0$ فالخزينة مطابقة ✓، وإذا كان $> 0$ فهو عجز توريد/متبقي بالصندوق، وإذا كان $< 0$ فهو زيادة توريد)*.
   *(في ميزان المراجعة التراكمي للمزرعة بالكامل `computeFarmCumulativeTrialBalance`، يُحسب `totalCashInflowBeforeExpenses` بجمع النقدية الداخلة عبر كل الأيام دون تكرار الرصيد المرحّل بين الأيام، ويُقارن مع مجموع `sumDeliveredCash` لكل الأيام مضافاً إليه `lastDayCarriedForwardCash` لآخر يوم نشط فقط لمنع الازدواج المحاسبي)*.
6. **قاعدة فصل التحويلات البنكية والشيكات:**
   - جميع التحويلات (`transferSales`, `debtTransfer`, `prevTransfer`) **لا تدخل الخزينة النقدية إطلاقاً** وتُعامل معاملة الآجل بالنسبة لصندوق النقدية.
   - تحويلات المزرعة الحالية (`currentFarmTransfers = sumTransferSales + sumDebtTransfer`) تُخصم من مديونية التاجر في المزرعة الحالية.
   - تحويلات المزارع السابقة (`sumPrevTransfer`) ونقدي المزارع السابقة (`sumPrevCash`) تخص مواقع أخرى **ولا تُخصم أبداً من مديونية التاجر في المزرعة الحالية**.
7. **قاعدة العهدة المستقلة والتوزيع المتدرج (`Custody Waterfall`):**
   - حقول العهدة (`custodyCash`, `custodyTransfer`, `custodyTransferType`) هي بيان مستقل يُوزع تلقائياً عبر دالة `distributeCustodyWaterfall` بالترتيب المحاسبي التالي:
     1. **أولاً:** سداد المديونية السابقة على التاجر في المزرعة الحالية (`debtCash`, `debtTransfer`).
     2. **ثانياً:** توجيه المتبقي من العهدة لسداد فاتورة اليوم (`cashSales`, `transferSales`) عند إدخال الوزنة الثانية.
     3. **ثالثاً:** حساب باقي الفاتورة آجلاً (`creditSales`)، أو إظهار الفائض في `netCustodyRemaining` مع توفير زر (`#btnDepositCustodySurplusToAccount`) لإيداع الفائض كرصيد دائن تحت حساب التاجر.

### ج. آليات "سند تحصيل مديونية فقط" (`isDebtCollectionOnly`) وحساب الذمم:
1. **تعريف سند التحصيل المستقل:** يُصنف السجل كـ `isDebtCollectionOnly = true` إذا لم يكن وزنة مؤقتة (`!row.isPending`) وكانت (`w1 === 0 && w2 === 0 && totalWithTip === 0 && cashSales === 0 && transferSales === 0 && creditSales === 0`) مع وجود تحصيل فعلي (`debtCash > 0 || debtTransfer > 0 || prevCash > 0 || prevTransfer > 0` أو `entryMode === 'debt_only'`).
2. **معاملته برمجياً ومحاسبياً:**
   - يأخذ رقم سند متسلسل مستقل (`voucherNo` عبر `getNextSequentialVoucherNo`) منفصل عن مسلسل الميزان (`scaleNo`).
   - لا يُضاف إلى عدد سيارات التحميل (`countCars`) حتى لا يشوه متوسط وزن السيارة (`avgCarWeight`)، بل يُحصى في `countDebtVouchers`.
   - يُرتب دائماً في نهاية جدول المبيعات اليومي بعد جميع حركات الميزان عبر دالة `sortSalesListByScaleNo`.
3. **معادلة التكويد الموحد ومديونية التاجر:**
   - أي سيارة فرعية تحمل رقماً (مثل: `كرنك 1`، `كرنك 2`) تُربط تلقائياً بنفس الكود الموحد للتاجر الأساسي (`104 - كرنك`) عبر `resolveMerchantCode`.
   - صافي مديونية التاجر أو المزرعة الحالية في أي لحظة:
     $$\text{ClosingDebt} = \sum (\text{creditSales} - \text{debtCash} - \text{debtTransfer})$$

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
  webhookUrl: "https://script.google.com/macros/s/.../exec",
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
```

### ب. هيكل سجل الحركة الفردية (Sale / Pending / Expense Record Schema):
كل حركة داخل `sales` أو `pendingSales` أو `expenses` تحمل معرّف UUID مانعاً للتصادم (`d1_173..._...`) بالإضافة إلى بصمة الرقابة الكاملة: 
- `id`: معرف نصي فريد عالمياً يطابق النمط `/^[0-9]{10,}_[0-9a-z]{6,}_[0-9a-z]{8,}$/i`. 
- `createdAt`, `createdBy`, `createdTimeTxt`: ختم الإنشاء الأصلي واسم المندوب المسجل (لا يتغير أبداً عند التعديل). 
- `updatedAt`, `updatedBy`, `updatedTimeTxt`: ختم آخر تعديل واسم المعدل. 
- `isEdited`, `editVersion`: مؤشر التعديل ورقم الإصدار المتزايد (1, 2, 3...) لكسر التعادل عند الدمج. 
- `lastEditDiffText`, `editHistory`: سجل نصي تفصيلي للتعديلات بصيغة (قبل ⬅️ بعد) بحد أقصى 20 تعديلاً لكل حركة. 
- `importedAt`, `excelCompositeKey`: ختم الاستيراد من الإكسيل والمفتاح المركب لمنع تكرار صفوف الإكسيل المستوردة. 

### ج. مفاتيح التخزين المحلي (LocalStorage & IndexedDB):
- `STORAGE_KEY`: `'farm_sales_committee_v70_clean_slate_state'`.
- `LEGACY_STORAGE_KEYS`: `['farm_sales_committee_v68_clean_slate_state', 'farm_sales_committee_v67_clean_slate_state']`.
- `ENCRYPTED_VAULT_STORAGE_KEY`: `'farm_sales_encrypted_webhook_vault_v70'`.
- **مفاتيح التفضيلات المشتقة من `STORAGE_KEY`:**
  - `_webhook_url` (رابط السحابة). 
  - `_show_floating_bar` (إظهار/إخفاء الشريط العائم). 
  - `_show_audit_metadata` (إظهار/إخفاء شارات الرقابة بجدول البيع). 
  - `_lite_field_mode` و `_auto_lite_on_mobile` (تفضيلات وضع المندوب المبسط). 
  - `_sticky_table_options` (تفضيلات تثبيت الرؤوس والأعمدة الأربعة). 
- `window.name Fallback`: `'FARM_SALES_CLEAN_STATE_V67:' + serialized` (لضمان عمل الموقع داخل بيئات الـ iframe المقيدة مثل Google Sites). 
- **قاعدة بيانات IndexedDB:**
  - اسم القاعدة: `'FarmSalesCleanSlateDB_v67'`. 
  - اسم المخزن: `'farm_database_store'`. 
  - مفتاح السجل الرئيسي: `'master_cloud_state'`. 

---

## 4. محرك المزامنة الحالي والهدف القادم (Sync Engine - v74 to v75)

### أ. آليات الحماية والدمج المطبقة حالياً في v74:
- **منع الحذف الشبحي (Anti-Ghost Deletion & OR-Set Tombstones):**
  - عند حذف أي عنصر، يُسجل في `deletedIds[category]` مع توقيت حذفه الدقيق في `deletedTimestamps[category][id]` عبر `recordDeletedItem` (بحيث يكون وقت الحذف أكبر دائماً من وقت إنشاء/تحديث العنصر). 
  - قبل أي دمج سحابي، تعمل دالة `sanitizeMergedTombstonesAgainstLiveData` لمقارنة شواهد القبور مع السجلات الحية في الطرفين؛ فإذا وُجد سجل حي يحمل `updatedAt` أو `importedAt` أحدث من ختم الحذف (`deletedAt`)، يتم إبطال شاهد القبر القديم فوراً واستبقاء السجل الحي.
  - تعمل دالة `pruneDeletedTombstones` على تقليم شواهد القبور بحيث لا تتجاوز 2000 معرف لكل فئة لمنع تضخم حجم JSON.
- **معايرة فروق توقيت الأجهزة (Clock Skew Tolerance):**
  - يعتمد النظام هامش تسامح زمني قدره 60 دقيقة (`CLOCK_SKEW_BUFFER_MS = 60 * 60 * 1000`) لحماية حركات المندوبين الذين تعاني هواتفهم من تأخر الساعة.
  - دالة `calibrateCloudClockOffset(cloudUpdatedAtIso)` تعاير متغير `cloudClockOffsetMs` للأمام فقط (Monotonic Forward Calibration) إذا كان توقيت السحابة متقدماً على ساعة الجهاز المحلي، وتُقرأ جميع الأختام الزمنية عبر `getSyncedNow()`.
- **حل التعديلات المتزامنة ومطابقة الإكسيل (Concurrent Edits & Excel Composite Key):**
  - تدمج دالة `mergeArraysById` العناصر بناءً على المعرف الفريد (`id` أو `code`) أولاً؛ وعند وجود نسختين لنفس المعرف، تفوز النسخة صاحبة `updatedAt` الأحدث، وفي حال التساوي تفوز النسخة ذات `editVersion` الأكبر، مع دمج مصفوفة `editHistory` والحفاظ على `createdBy` الأصلي.
  - لمنع تكرار الحركات عند استيراد نفس ملف الإكسيل من جهازين مختلفين، تفحص دوال `areSalesRowsDuplicate` و `arePendingSalesDuplicate` و `areExpensesDuplicate` قيمة `excelCompositeKey` وتطابق بيانات التاجر والسيارة والأوزان والمبالغ المالية.
  - لمنع تداخل النبض الخلفي مع الإدخال المحلي (Race Conditions)، يتوقف السحب التلقائي الخلفي في `pullDatabaseFromCloud` إذا كان هناك رفع جاري (`isCloudSyncInProgress`) أو تعديلات معلقة أو خلال 10 ثوانٍ من آخر تعديل محلي (`Date.now() - lastLocalMutationAt < 10000`).
- **محرك طابور الحركات الجزئية المحلي (v74 Delta Outbox):**
  - دالة `enqueueDeltaSyncEvent(actionType, payload)` تلتقط كافة العمليات (`UPSERT_SALE`, `UPSERT_PENDING`, `UPSERT_EXPENSE`, `UPDATE_DAY_META`, `UPSERT_MERCHANT`, `UPSERT_USER`, `DELETE_*`) وتطبق خوارزمية Outbox Compaction لدمج الأحداث المتكررة لنفس المعرف داخل `appState.syncOutbox`. 
  - دالة `applyIncomingDeltaEvents(eventsList)` تطبق الحركات الجزئية الواردة مباشرة على الحالة المحلية مع احترام `updatedAt` و `deletedTimestamps`.

### ب. 🎯 خارطة الطريق والمطلوب تنفيذه في المحادثة الجديدة (المرحلة الرابعة: الإصدار v75):
المهمة الوحيدة والقادمة في المحادثة الجديدة هي تفعيل المزامنة الجزئية السحابية اللحظية (End-to-End Cloud Delta Sync & GAS LockService) لإصدار النسخة النهائية v75 عبر الخطوات الثلاث التالية:
1. **تطوير دوال `pushDatabaseToCloud` و `pullDatabaseFromCloud` في `js/storage-sync.js` لبروتوكول Delta Sync:**
   - عند الرفع (`pushDatabaseToCloud`): إذا كان `appState.syncOutbox.length > 0` ولم يكن الرفع تصفيرًا شاملاً (`!skipPreFetchMerge`)، يتم إرسال حزمة جزئية صغيرة (`mode: 'delta_sync'`, `deltaEvents: appState.syncOutbox`, `since: appState.lastDeltaSyncAt`, `farmName: appState.farmName`) بدلاً من إرسال قاعدة البيانات بالكامل. وعند استلام رد النجاح من السيرفر، يتم تفريغ العناصر التي تم رفعها من `appState.syncOutbox`، وتحديث `appState.lastDeltaSyncAt`، وتطبيق أي `incomingDeltaEvents` أعادها السيرفر في نفس الرد.
   - عند السحب الدوري الخلفي (`pullDatabaseFromCloud` في وضع `isLiveBackgroundTick`): إذا كان `appState.lastDeltaSyncAt > 0` والمتصفح يحتوي على بيانات المزرعة، يطلب المتصفح فقط الحركات التي تغيرت بعد آخر طابع زمني عبر (`?mode=delta_pull&since=${appState.lastDeltaSyncAt}&_t=${Date.now()}`)، ويطبقها فوراً عبر `applyIncomingDeltaEvents`، مما يقلل استهلاك البيانات بنسبة 98%.
2. **التوافق التلقائي الرجعي (Auto-Fallback):**
   - الحفاظ التام على آلية السحب الكامل والرفع الكامل (Full State Snapshot) عند فتح متصفح جديد لأول مرة (`lastDeltaSyncAt === 0` أو عدم وجود مزرعة محلياً)، أو عند تنفيذ تصفير للمزرعة، أو في حال أعاد سكربت جوجل القديم لدى المستخدم الحالة الكاملة بدلاً من رد `delta_sync`، بالإضافة إلى دعم طلبات PATCH الجزئية لروابط Firebase (`firebaseio.com` / `firebasedatabase.app`).
3. **تحديث كود Google Apps Script داخل زر (`#btnCopyCloudScriptCode`) في `js/ui-controllers.js`:**
   - دعم قفل التزامن الذري `LockService.getScriptLock()` (`lock.waitLock(15000)` / `lock.tryLock(15000)`) لمنع أي تضارب عند وصول طلبات من عدة مندوبين في نفس اللحظة.
   - قراءة الحالة المخزنة من القطع المقسمة (`DB_CHUNK_0` .. `DB_CHUNK_N` بحجم 2500 حرف لكل قطعة لتفادي حد 9KB في `PropertiesService`)، ومعالجة طلبات `mode === 'delta_sync'` بدمج `deltaEvents` الواردة داخل الحالة السحابية بالمعرفات والطوابع الزمنية، وحفظ سجل آخر حركات جزئية (`DELTA_LOG_EVENTS` مقلماً لآخر 300 حدث) لخدمة طلبات `doGet` عندما يكون `e.parameter.mode === 'delta_pull'` وإرجاع الأحداث التي لها `ts > since` فقط.
4. **تحديث الإصدار والوثائق وتغليف الحزمة النهائية (v75):**
   - تحديث رقم الإصدار والكاش في `index.html`، `sw.js`، `vendor/vendor-loader.js`، `README.md`، و `HANDOVER_TECHNICAL_SUMMARY.md` إلى `v75`، وإرفاق الملف المضغوط النهائي الشامل للمشروع باسم `farm-sales-committee-v75-enterprise-delta-sync.zip`.

---

## 5. واجهة وتجربة المستخدم (UI/UX & Mobile Mode)

### أ. آلية عمل "وضع شاشة المندوب المبسط" (Lite Field Mode):
- **الفلسفة الهندسية:** عند تفعيل وضع المندوب، يُضاف الكلاس `lite-field-mode-active` إلى وسم `<body>`، ويتم تثبيت التبويب النشط على `daily`، وإخفاء كافة الجداول المحاسبية المعقدة والتبويبات الأخرى للإبقاء حصرياً على 3 عناصر ميدانية فقط مصممة للاستخدام السريع بيد واحدة على الهاتف بدون تمرير أفقي: 
  1. **العنصر الأول (`#litePendingCardsStripContainer`):** شريط بطاقات أفقية قابلة للسحب للسيارات المحجوزة مؤقتاً بانتظار الوزنة الثانية، مزود بزر وشريط بحث سريع مدمج (`#inpLiteFilterPendingCards`)، وبمجرد لمس البطاقة يتم استدعاء `recallPendingSaleById` والتركيز فوراً على خانة الوزنة الثانية (`#inpW2`).
  2. **العنصر الثاني (`#saleFormCard`):** نموذج تسجيل حركة بيع / تحصيل مديونية مع التنقل السريع بزر Enter والشريط السفلي العائم للميزان (`#mobileWeighbridgeActionBar`).
  3. **العنصر الثالث (`#liteSalesCardsContainer`):** عرض حركات البيع المسجلة اليوم في شكل بطاقات موبايل مدمجة وواضحة بدلاً من الجدول ذي الـ 17 عموداً، مع أزرار طباعة البون والتعديل والحذف.
- **حفظ الحالة والتفعيل التلقائي:**
  - يُحفظ الوضع في `appState.liteFieldMode` (`STORAGE_KEY + '_lite_field_mode'`) وخيار التفعيل التلقائي للموبايل في `appState.autoLiteFieldOnMobile` (`STORAGE_KEY + '_auto_lite_on_mobile'`). 
  - إذا كان حساب المستخدم يمتلك صلاحية `perms.liteFieldMode === true` (وليس مديراً)، فإن دالة `applyAutoLiteFieldModeOnLoginOrSwitch()` تفعل وضع المندوب تلقائياً فور دخوله من شاشة موبايل (`window.innerWidth < 768`).

### ب. منع النوافذ المعيقة والاعتماد على Toast والنوافذ المدمجة:
- يُمنع استخدام `alert()` أو `confirm()` أو `prompt()` التقليدية لأنها توقف خيط التنفيذ (Main Thread) وغالباً ما تُحظر داخل بيئات الـ iframe مثل Google Sites.
- يتم استخدام دالة `showToast(msg, icon)` لعرض تنبيهات عائمة غير معيقة تختفي تلقائياً بعد 3600ms.
- القرارات التفاعلية تتم عبر نوافذ DOM مدمجة مثل نافذة إدخال السعر المفقود (`#askMissingPriceModal`) ولوحة التصفير الذكي ثلاثية الأوضاع (`#smartResetInlineBox`).

---

## 6. ⚠️ قواعد حماية محرك الأوفلاين (Offline Engine Guardrails - CRITICAL)

> 🚨 **تحذير معماري صارم:** أي إخلال بالقواعد الأربع التالية سيؤدي إما إلى تعطل العمل بدون إنترنت (Offline Mode) أو دخول المتصفح في حلقة تحديث لا نهائية (Infinite Reload Loop) أو توقف الأزرار عن العمل:

1. **الفصل الهندسي لإدارة الكاش ومنع حلقات التحديث (Cache Lifecycle & Loop Guard):**
   - إدارة الكاش وحذف الكاشات القديمة عند الترقية هي مسؤولية حدث `activate` في `sw.js` (أو عند ضغط المستخدم يدوياً على زر التحديث الصريح `forceAppHardReload` وهو متصل بالإنترنت فقط). 
   - يُمنع منعاً باتاً استدعاء `caches.delete` عشوائياً أثناء التشغيل العادي أو عندما يكون المتصفح أوفلاين (`!navigator.onLine`).
   - في `vendor/vendor-loader.js`، يقوم درع الحماية باعتراض `navigator.serviceWorker.addEventListener('controllerchange', ...)` ولا يسمح بإعادة تحميل الصفحة إلا إذا كان `window.__manualForceUpdateRequested === true`.
2. **التخزين الاستباقي من الصفحة (`#pwaOfflineBootstrapScript`):**
   - يحتوي `index.html` في نهايته على سكربت `initOfflineFirstPwaEngine` الذي يعمل عند حدث `window.load` (في حال الاتصال بالإنترنت) ليقوم بفتح الكاش النشط وتخزين الصفحة الحالية وجميع ملفات `CORE_URLS` (سواء بالمسار المجرد `./js/...` أو بالمسار المزود بـ `?v=...`) باستخدام `fetch(url, { cache: 'no-store' })` ثم `cache.put`، مما يضمن توفر جميع الملفات في CacheStorage حتى في البيئات التي يتأخر فيها تنشيط الـ Service Worker في الزيارة الأولى.
3. **المطابقة الذكية في عامل الخدمة (`matchFromCacheSmart` & `{ ignoreSearch: true }`):**
   - في `sw.js`، تعتمد دالة `matchFromCacheSmart(req, isHtmlNav)` استراتيجية بحث متعددة الطبقات:
     - المطابقة الدقيقة للطلب `cache.match(req)`. 
     - المطابقة مع تجاهل معاملات الاستعلام `cache.match(req, { ignoreSearch: true })` لضمان أن طلب `./js/core-state.js?v=75` يطابق `./js/core-state.js` المخزن في الكاش. 
     - لطلبات التصفح (`isHtmlNav`)، إرجاع `./index.html` أو `./` كبديل فوري عند انقطاع الشبكة. 
     - استخلاص اسم الملف (`fileName`) والبحث عنه في `./` و `./js/` و `./vendor/` مع `{ ignoreSearch: true }`.
4. **سلامة الصياغة البرمجية عند تعديل الملفات (Syntax & Comment Integrity):**
   - عند إجراء أي تعديل برمجي أو نصي على ملفات `./js/*.js` (وخاصة `js/ui-controllers.js`)، يجب الحفاظ التام على بادئة التعليقات الثنائية (`//`) في جميع الأسطر التعليقية، والتحقق من توازن الأقواس (`{}`) وسلامة جمل `if / else` قبل توليد ملف الـ `.zip` النهائي لضمان عدم حدوث أي SyntaxError يوقف تهيئة `initFarmSalesApp()`.

---

## 7. ✅ سجل إنجازات وترقيات الإصدار `v77` (`farm-sales-v77-mobile-default`)

تم في الإصدار **`v77`** إغلاق كافة ملاحظات الفحص التقني والجودة الشاملة (QA Audit) واعتماد التحسينات المعمارية والمحاسبية التالية:
1. **إحكام طابور المزامنة الجزئية (`syncOutbox`):** إدراج أحداث تعديل أسماء التجار (`UPSERT_MERCHANT`) وإضافة/تعديل المستخدمين وتحديث الملف الشخصي (`UPSERT_USER`) في طابور `syncOutbox` لضمان مزامنتها اللحظية عبر بروتوكول `delta_sync`.
2. **دقة الفاصلة العائمة بنسبة 100% (`roundMoney2`):** تغليف كافة العمليات الحسابية التراكمية والفرعية في `js/accounting.js` و `js/storage-sync.js` بدالة `roundMoney2`.
3. **تطوير تجربة المندوب الميداني (`Lite Field Mode`):** إخفاء الهيدر الرئيسي (`#mainHeader`) في وضع المندوب لمنع الازدواجية، ورفع الهامش السفلي (`padding-bottom: 135px / 150px`)، وإضافة خيار تثبيت شريط المندوب العلوي (`#chkStickyLiteBanner` / `.sticky-lite-banner`) المحفوظ في `LocalStorage` (`pref_sticky_lite_banner`).
4. **مهلة الشبكة الذكية (`3s Network Timeout`) وترقية الكاش (`v77`):** إضافة مهلة 3 ثوانٍ باستخدام `Promise.race` و `AbortController` لطلبات الملفات الأساسية في `sw.js` للتحول الفوري للكاش عند ضعف شبكة المزرعة، وترقية الكاش الموحد إلى `farm-sales-v77-mobile-default` دون استخدام `caches.delete` خارج حدث `activate`.
5. **الاستنساخ الكسول للفلاتر (`Lazy DOM Cloning`):** تأجيل استنساخ عقد الـ DOM (`cloneNode(true)`) في `applyDomTableExcelEngine` ليتم فقط عند تفعيل الفلتر أو الفرز فعلياً عبر `captureDomTableRawRows` لتقليل استهلاك الذاكرة على الهواتف الضعيفة.

6. **تحديثات الإصدار `v77` (`farm-sales-v77-mobile-default`):**
   - **إصلاح ظهور شريط المندوب في صفحة الدخول:** إزالة الكلاس `lite-field-mode-active` وإخفاء `#liteFieldModeActiveBanner` (`style.display = 'none'`) فور تسجيل الخروج اليدوي أو التلقائي (`Session Timeout`) أو عند عدم تسجيل الدخول.
   - **جعل وضع المندوب المبسط هو الوضع الافتراضي للموبايل:** تفعيل وضع المندوب المبسط تلقائياً وإظهار شريط المندوب فور تسجيل الدخول من الهواتف المحمولة (`window.innerWidth <= 768`) دون الحاجة لتفعيله يدوياً في كل جلسة.
