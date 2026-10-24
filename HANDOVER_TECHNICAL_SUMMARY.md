# 📘 وثيقة التسليم التقنية الشاملة والنهائية (Lead Tech Handover Document — v38)
**المشروع:** نظام محاضر لجان بيع المزارع (Offline-First PWA + ربط ثنائي الاتجاه مع الإكسيل + مزامنة سحابية لحظية)  
**الإصدار المستقر الحالي:** `v38` (`farm-sales-committee-v38-bulletproof-sync-engine`)  
**تاريخ التسليم للمرحلة الثالثة:** أكتوبر 2026  

---

## 1. هيكلة المشروع الحالية (Project Architecture & File Inventory)

يعمل المشروع ببنية معيارية مقسمة بالكامل (Modular PWA Architecture) جاهزة للرفع المباشر على **GitHub Pages** أو أي استضافة ثابتة، بالإضافة إلى دعم توليد نسخة ملف واحد مدمج لـ **Google Sites**:

| اسم الملف | الحجم التقريبي | الوظيفة والمسؤولية التقنية الكاملة |
| :--- | :--- | :--- |
| **`index.html`** | ~161 KB | الهيكل الرئيسي لواجهة المستخدم (6 تبويبات رئيسية، بوابة تسجيل الدخول، نافذة كشف حساب التاجر التفصيلي، شريط الإجراءات السفلي العائم للميزان، وحاوية الطباعة المعزولة `#merchantPrintOnlyContainer`). |
| **`style.css`** | ~41 KB | نظام التنسيق الشامل (Tailwind CSS v3.4.17 Preflight & Utilities مدمج محلياً للعمل بدون إنترنت + تنسيقات الهواتف والكمبيوتر + قواعد الطباعة الحرارية والرسمية `@media print` لعرض A4 Landscape وكارتة الميزان الثلاثية). |
| **`app.js`** | ~575 KB | المحرك البرمجي الكامل بدون أي اختصار (إدارة الحالة، المعادلات المحاسبية، الفلترة والفرز بأسلوب الإكسيل لـ 10 جداول، محرك التصدير والاستيراد الثنائي لملف `.xlsx` المكون من 15 شيت بالمعادلات والألوان، محرك المزامنة المضاد للاختراق `v38`، مركز النسخ الاحتياطي `.json` وسجل الرقابة `Audit Trail`، ومحرك الرسم الذكي `Smart Active-Tab Rendering`). |
| **`sw.js`** | ~3.4 KB | عامل الخدمة (Service Worker) للعمل الكامل بدون إنترنت (Offline-First Caching) تحت اسم الكاش `farm-sales-committee-v38-bulletproof-sync-engine` مع التحديث الفوري (`skipWaiting` + `clients.claim`) وتمرير طلبات السحابة مباشرة للشبكة. |
| **`manifest.json`** | ~0.8 KB | ملف تعريف تطبيق الويب التقدمي (PWA Manifest) لدعم التثبيت المباشر على شاشة الهاتف والكمبيوتر (`standalone`، اتجاه `rtl`، ألوان الهوية `#1b365d`). |
| **`icon-192.png` / `icon-512.png`** | ~6.3 KB | أيقونات التطبيق الرسمية لتثبيت الـ PWA على أنظمة Android و iOS وسطح المكتب. |
| **`HANDOVER_TECHNICAL_SUMMARY.md`** | هذه الوثيقة | المرجع الهندسي الشامل لاستكمال التطوير في المرحلة الثالثة دون فقدان أي سياق برمجي أو محاسبي. |
| **`README.md`** | ~5.2 KB | دليل التشغيل السريع والنشر على GitHub Pages وربط Google Apps Script / Firebase. |

---

## 2. قواعد العمل الصارمة (Strict Business & Accounting Rules)

> ⚠️ **تحذير هندسي صارم للمرحلة الثالثة:** يُمنع منعاً باتاً تغيير أو تعديل أي معادلة من القواعد المحاسبية التالية تحت أي ظرف:

### أ. المعادلات المحاسبية الأساسية (Core Accounting Formulas)
1. **معادلة الوزن الصافي والفاتورة اليومية (`computeSaleRow`):**
   - **شرط صحة الميزان:** يجب دائماً أن تكون `الوزنة الثانية (القائم w2) >= الوزنة الأولى (الفارغ w1)` عندما تكون `w2 > 0`. إذا أدخل المستخدم `w2 < w1` يظهر تحذير فوري (`#weightValidationAlert`) ويُمنع الحفظ النهائي.
   - **الوزن الصافي (`netWeight`):**
     $$	ext{netWeight} = (w_2 \ge w_1 	ext{ and } w_2 > 0) \ ? \ (w_2 - w_1) : 0$$
   - **قيمة الوزن الأساسية (`baseAmount`):**
     $$	ext{baseAmount} = 	ext{netWeight} 	imes 	ext{price}$$
   - **إجمالي الفاتورة بالإكرامية (`totalWithTip`):**
     $$	ext{totalWithTip} = 	ext{baseAmount} + 	ext{tip}$$
   - **إجمالي المسدد والآجل للفاتورة (`totalPaidAndCredit`):**
     $$	ext{totalPaidAndCredit} = 	ext{cashSales} + 	ext{transferSales} + 	ext{creditSales}$$
   - **فرق الفاتورة (`invoiceDiff`):**
     $$	ext{invoiceDiff} = 	ext{totalPaidAndCredit} - 	ext{totalWithTip}$$

2. **قاعدة الخزينة النقدية اليومية (`computeDaySummary` — الركيزة الثالثة):**
   - **إجمالي النقدية الواردة للخزنة قبل المصاريف (`totalCashBeforeExpenses`):** يشمل **النقدي الفعلي فقط** (نقدي مبيعات اليوم + نقدي تحصيل مديونيات المزرعة الحالية + نقدي تحصيلات المزارع السابقة):
     $$	ext{totalCashBeforeExpenses} = \sum 	ext{cashSales} + \sum 	ext{debtCash} + \sum 	ext{prevCash}$$
   - **صافي النقدية المطلوب توريده بالخزنة (`netCashInBox`):**
     $$	ext{netCashInBox} = 	ext{totalCashBeforeExpenses} - \sum 	ext{expenses}$$
   - **فرق الخزينة اليومي (`cashBoxDiff`):**
     $$	ext{cashBoxDiff} = 	ext{netCashInBox} - 	ext{deliveredCash}$$
     *(إذا كان الفرق `0` $\leftarrow$ خزينة مطابقة ✓، سالب $\leftarrow$ زيادة توريد، موجب $\leftarrow$ عجز توريد).*

3. **قاعدة التحويلات والشيكات (Transfers Rule):**
   - جميع التحويلات (`تحويل كاش / محفظة`، `تحويل بنكي`، `إنستا باي`، `شيكات`) تُعامل معاملة الآجل بالنسبة لخزينة الموقع النقدية (لا تدخل `totalCashBeforeExpenses` أبداً).
   - **تحويلات المزرعة الحالية (`currentFarmTransfers`):**
     $$	ext{currentFarmTransfers} = \sum 	ext{transferSales} + \sum 	ext{debtTransfer}$$
     *(تُخصم بالكامل من حساب مديونية التاجر في المزرعة الحالية).*
   - **تحويلات المزارع السابقة (`sumPrevTransfer`):** تُدرج في بيان التحويلات الشامل وبيان المزارع السابقة، ولكن **لا تُخصم من مديونية المزرعة الحالية**.

4. **قاعدة مديونية التاجر للمزرعة الحالية (`netDebtCurrent`):**
   - غير النقدي يوم البيع (`nonCashDayOfSale`) = `creditSales + transferSales`.
   - إجمالي المسدد للمزرعة الحالية (`totalSettledCurrent`) = `cashSales + transferSales + debtCash + debtTransfer`.
   - **صافي مديونية التاجر للمزرعة الحالية (`netDebtCurrent`):**
     $$	ext{netDebtCurrent} = \sum 	ext{creditSales} - \sum 	ext{debtCash} - \sum 	ext{debtTransfer}$$
   - **تحصيلات المزارع السابقة (`prevCash` و `prevTransfer`):** تخص مواقع/مزارع أخرى؛ النقدي منها (`prevCash`) يدخل خزينة اليوم، والتحويل (`prevTransfer`) يدخل بيان التحويلات، ولكن **لا يُخصم أيٌّ منهما من مديونية المزرعة الحالية**.

5. **قاعدة العهدة المستقلة (`Standalone Custody Statement`):**
   - الحقول `custodyCash` و `custodyTransfer` و `custodyTransferType` هي **بيان مستقل تماماً** للعهدة التي دفعها التاجر، ولا تدخل في حساب الفاتورة أو الخزينة النقدية، ويُخصم منها تلقائياً ما سدده التاجر من مديونيات المزرعة الحالية:
     $$	ext{totalCustody} = 	ext{custodyCash} + 	ext{custodyTransfer}$$
     $$	ext{netCustodyRemaining} = 	ext{totalCustody} - (	ext{debtCash} + 	ext{debtTransfer})$$

### ب. قاعدة توحيد كود التاجر والسيارات الفرعية (Unified Merchant Coding)
- دليل التجار الأساسي (`appState.merchants`) يبدأ من الكود `101` وهو **موحد وثابت عالمياً عبر جميع المزارع والدورات** (`unifyGlobalMerchantsRegistry()`).
- الدالة `cleanMerchantBaseName(rawName)` تحذف الأرقام والشرطات والأقواس (`/[0-9\-\(\)]/g`) لاستخراج اسم التاجر الأساسي.
- الدالة `resolveMerchantCode(rawName)` تربط أي سيارة فرعية تلقائياً بكود التاجر الأساسي (مثال: `كرنك 1` و `كرنك 2` يأخذان تلقائياً الكود الموحد `104` الخاص بالتاجر الأساسي `كرنك`، وتُجمع كافة حركاتهما في كشف حساب `104 - كرنك`).

### ج. القواعد الصارمة لواجهة المستخدم والأمان (UI/UX & Security Constraints)
- **منع النوافذ المنبثقة الافتراضية نهائياً:** يُحظر استخدام `window.alert()` أو `window.confirm()` أو `window.prompt()` (لأنها تتوقف داخل بيئات العرض المدمجة مثل Google Sites و Canvas). يتم استخدام `showToast(msg, icon)` واللوحات التفاعلية المضمنة (`#dayMgmtBoxDelete`, `#dayMgmtBoxAdd`, `#dayMgmtBoxEdit`).
- **تحصين النصوص ضد ثغرات XSS (`escXmlStr`):** جميع المدخلات النصية المعروضة داخل `innerHTML` في كافة الجداول والنوافذ وشاشات الطباعة تمر عبر دالة التعقيم `escXmlStr()`.
- **قصر إعادة الرسم على التبويب النشط (`Smart Active-Tab Rendering`):** الدالة `renderAll(forceAllTabs, preserveInputs)` تعيد بناء جدول التبويب النشط فقط (`appState.activeTab`) لتسريع استجابة الهواتف المتوسطة بأكثر من 70%.

---

## 3. هيكل البيانات الدقيق (Exact Data Schema — `LocalStorage` & `IndexedDB`)

### أ. مفاتيح التخزين المحلي (`LocalStorage` & `IndexedDB`)
- **المفتاح الرئيسي في `LocalStorage`:** `'abouzekry_farm_sales_v5_clean_state'`
- **مفتاح رابط السحابة الاحتياطي:** `'abouzekry_farm_sales_v5_clean_state_webhook_url'`
- **مفتاح تفضيل إظهار/إخفاء الشريط العائم:** `'abouzekry_farm_sales_v5_clean_state_show_floating_bar'`
- **قاعدة بيانات `IndexedDB`:** اسم القاعدة `'AbouZekryCloudDB_v5'`، اسم المخزن `'farm_database_store'`، المفتاح `'master_cloud_state'`.

### ب. نموذج JSON الكامل لكائن الحالة (`appState` Data Schema)

```json
{
  "farmName": "أبوذكري",
  "lastExcelSync": "متزامن لحظياً ✓ (01:30:00 ص)",
  "lastJsonBackup": "آخر نسخة (.json): 01:25 ص بواسطة (مدير الموقع) ✓",
  "currentDay": 1,
  "visibleDays": [1, 2],
  "activeTab": "daily",
  "merchantsViewFilter": "all",
  "transfersViewFilter": "all",
  "prevFarmsViewFilter": "all",
  "expensesViewFilter": "all",
  "pendingChanges": 0,
  "hasLocalEdits": true,
  "liveSyncEnabled": true,
  "liveSyncIntervalSec": 5,
  "webhookUrl": "https://script.google.com/macros/s/.../exec",
  "updatedAt": "2026-10-24T22:30:00.000Z",
  "farmResetAt": 0,
  "lastBulkImportAt": 1761345000000,
  "defaultPrice": 78.02,
  "defaultTip": 250,
  "lastScaleNo": 5225,
  "inactivityTimeoutMin": 20,
  "showFloatingActionBar": true,
  "isLoggedIn": true,
  "lastActivityAt": 1761345050000,
  "activeUserId": "admin",
  "deletedIds": {
    "sales": ["d1_1761340000000_m2k9x1_a1b2c3d4e5f6"],
    "pendingSales": [],
    "expenses": [],
    "merchants": [],
    "users": [],
    "farms": []
  },
  "deletedTimestamps": {
    "sales": {
      "d1_1761340000000_m2k9x1_a1b2c3d4e5f6": 1761341000000
    },
    "pendingSales": {},
    "expenses": {},
    "merchants": {},
    "users": {},
    "farms": {}
  },
  "users": [
    {
      "id": "admin",
      "username": "admin",
      "password": "admin",
      "name": "مدير الموقع (كامل الصلاحيات)",
      "phone": "01000000000",
      "jobTitle": "مدير عام المزرعة",
      "isSystem": true,
      "perms": {
        "sales": true,
        "expenses": true,
        "merchants": true,
        "farms": true,
        "admin": true,
        "showSyncExcel": true,
        "showSyncCloud": true,
        "showSyncWebhook": true
      }
    }
  ],
  "merchants": [
    { "code": 101, "name": "محمود مدني" },
    { "code": 104, "name": "كرنك" }
  ],
  "days": {
    "1": {
      "dayNumber": 1,
      "dateLabel": "الإثنين 12-10",
      "deliveredCash": 50000,
      "addedAt": 1761345000000,
      "clearedAt": 0,
      "isHidden": false,
      "sales": [
        {
          "id": "d1_1761345000000_m2k9z8_9f8e7d6c5b4a",
          "createdAt": 1761345000000,
          "createdBy": "مدير الموقع",
          "createdTimeTxt": "01:30 ص (24/10)",
          "updatedAt": 1761345000000,
          "updatedBy": "مدير الموقع",
          "updatedTimeTxt": "01:30 ص (24/10)",
          "importedAt": 0,
          "isEdited": false,
          "merchant": "كرنك 1",
          "scaleNo": 5222,
          "carNo": 6923,
          "w1": 2100,
          "w2": 3100,
          "price": 78.02,
          "tip": 250,
          "custodyCash": 200000,
          "custodyTransfer": 50000,
          "custodyTransferType": "تحويل بنكي",
          "cashSales": 50000,
          "transferSales": 10000,
          "transferSalesType": "إنستا باي",
          "creditSales": 18270,
          "debtCash": 5000,
          "debtTransfer": 0,
          "debtTransferType": "",
          "prevCash": 0,
          "prevTransfer": 0,
          "prevTransferType": "",
          "notes": ""
        }
      ],
      "pendingSales": [],
      "expenses": [
        {
          "id": "exp_d1_1761345100000_m2k9aa_112233445566",
          "createdAt": 1761345100000,
          "createdBy": "مدير الموقع",
          "createdTimeTxt": "01:31 ص (24/10)",
          "updatedAt": 1761345100000,
          "updatedBy": "مدير الموقع",
          "updatedTimeTxt": "01:31 ص (24/10)",
          "isEdited": false,
          "category": "مشال وتحميل وعمال",
          "desc": "مكافأة عمال التحميل",
          "recipient": "ريس العمال",
          "amount": 1500
        }
      ]
    }
  },
  "farmsArchive": {
    "أبوذكري": {
      "farmName": "أبوذكري",
      "updatedAt": "01:31:00 ص",
      "farmResetAt": 0,
      "lastBulkImportAt": 1761345000000,
      "visibleDays": [1, 2],
      "defaultPrice": 78.02,
      "defaultTip": 250,
      "lastScaleNo": 5225,
      "merchants": [],
      "days": {}
    }
  }
}
```

---

## 4. آلية المزامنة المحدثة والمضادة للاختراق (Bulletproof Sync Logic — `v38`)

يعتمد محرك المزامنة في `app.js` على بنية **Observed-Remove Set (OR-Set)** مع طوابع زمنية معايرة لمنع فقدان أي حركة بيع أو مصروف تحت أي ظرف:

1. **توليد وفحص المعرّفات الفريدة عالمياً (`generateRecordUUID` & `isCollisionProofUUID`):**
   - كل حركة يدوية أو مستوردة من الإكسيل تحصل على معرّف فريد بصيغة: `${prefix}_${nowMs}_${tsBase36}_${randomHex12}` (مثال: `d1_1761345000000_m2k9z8_9f8e7d6c5b4a`).
   - الدالة `isCollisionProofUUID(id)` تتحقق من البصمة، وتمنع دوال `areSalesRowsDuplicate` و `arePendingSalesDuplicate` و `areExpensesDuplicate` من دمج أو مسح أي سجلين يحملان معرّفين فريدين مختلفين (`a.id !== b.id`) حتى لو أُدخلا في وضع الأوفلاين بنفس رقم الميزان التلقائي أو تشابهت الأوزان والتاجر.

2. **الدمج الجزئي العميق للمصفوفات (`mergeArraysById` & `mergeDaysObjects`):**
   - لا يتم استبدال مصفوفات `sales` أو `pendingSales` أو `expenses` بالكامل أبداً؛ بل يتم دمجها عنصراً بعنصر عبر `mergeArraysById`.
   - إذا عدّل جهازان نفس السجل (نفس الـ `id`)، تقارن دالة `mergeSameRecordVersions` الطابع الزمني `updatedAt` مع الحفاظ الدائم على بيانات المنشئ الأصلي (`createdBy`, `createdAt`, `createdTimeTxt`).
   - تعمل `mergeDaysObjects` ببنية **OR-Set**: أي سجل يحمل معرّف `UUID` غير موجود في `deletedIds` يُحفظ دائماً ولا يتأثر بأي مسح جماعي (`clearedAt` / `farmResetAt`) من جهاز آخر.

3. **معالجة اختلاف وتأخر التوقيت بين الهواتف (`Clock Skew Tolerance & Calibration`):**
   - هامش التسامح الزمني `CLOCK_SKEW_BUFFER_MS` مضبوط على **60 دقيقة كاملة (`3,600,000 ms`)**.
   - الدالة `calibrateCloudClockOffset(cloudData.updatedAt)` تقيس تأخر ساعة الهاتف المحلي مقارنة بوقت السحابة وتخزن الفرق في `cloudClockOffsetMs`، وتستخدم الدالة `getSyncedNow()` هذا الفرق لضمان دقة الطوابع الزمنية الجديدة حتى لو كانت ساعة هاتف المندوب متأخرة.

4. **الحماية ضد الارتداد العكسي للحذف (`Anti-Ghost Deletion` & `deletedTimestamps`):**
   - كل عملية حذف تسجل وقت الحذف في `appState.deletedTimestamps[category][id] = getSyncedNow()`.
   - عند استيراد ملف إكسيل (`importWorkbookIntoAppState`) أو استرجاع نسخة احتياطية (`restoreFullJsonBackupFromText`)، تُختم السجلات بـ `importedAt` ويُختم `appState.lastBulkImportAt`.
   - قبل أي دمج سحابي، تعمل دالة `sanitizeMergedTombstonesAgainstLiveData` على تطهير `deletedIds` من أي شواهد قبور قديمة (Stale Tombstones) أقدم من `importedAt` أو `lastBulkImportAt`، كما تُبطل أي `farmResetAt` قديم إذا كانت السحابة تحتوي على بيانات مستوردة أو مضافة أحدث منه.

5. **قفل الجلب المسبق الذري قبل الرفع (`Atomic Pre-Fetch Lock` في `pushDatabaseToCloud`):**
   - قبل إرسال `POST` / `PUT` للسحابة، يقوم النظام بطلب `GET` لجلب أحدث بيانات السحابة ودمجها محلياً أولاً.
   - إذا فشل طلب `GET` بسبب ضعف شبكة الهاتف (`!preRes.ok` أو خطأ اتصال)، يُلغى الرفع فوراً (`return false`) وتبقى التعديلات محفوظة في الطابور المحلي (`pendingChanges`) للمحاولة التالية دون الكتابة فوق تعديلات المندوبين الآخرين.

---

## 5. الميزات المنجزة حتى نهاية المرحلة الثانية والمهام المقترحة للمرحلة الثالثة (Phase 3 Roadmap)

### أ. ما تم إنجازه واستقراره بالكامل حتى الإصدار `v38`
- [x] منظومة الطباعة الحرارية والتقارير الرسمية (`@media print`) شاملة: كارتة الميزان الثلاثية (3 نسخ في ورقة واحدة مع خطوط القص ✂️)، زر إظهار/إخفاء أيقونة بون الميزان، وطباعة محضر تصفية اليوم الرسمي بتوقيعات لجنة البيع وأمين الخزينة.
- [x] تحسين تجربة الميزان للهاتف والكمبيوتر: شريط إجراءات سفلي عائم (`#mobileWeighbridgeActionBar`) مع خيار إظهاره وإخفائه من تبويب التحكم، والتنقل السريع بزر `Enter` (`وزنة 1 ⬅️ وزنة 2 ⬅️ نقدي مبيعات ⬅️ باقي الفاتورة آجل ⚡`).
- [x] مركز النسخ الاحتياطي الشامل (`.json`) وسجل الرقابة الزمني (`Audit Trail — createdBy / updatedBy`) أمام كل حركة وفي جدول الرقابة المخصص.
- [x] تحسين السرعة (`Smart Active-Tab Rendering`) وتحصين الأمان (`XSS Sanitization`) وأداة توليد ونسخ كود التضمين الشامل لـ Google Sites.
- [x] الفحص العميق وتطوير محرك المزامنة المضاد للاختراق (`v38 Bulletproof Sync Engine`).

### ب. قائمة المهام المقترحة للبدء بها في المحادثة الجديدة (المرحلة الثالثة — To-Do List)
1. **إيصالات القبض وسندات الصرف المستقلة (Standalone Vouchers & Receipts):**
   - إضافة إمكانية طباعة "إيصال استلام نقدية / سداد مديونية" للتاجر عند سداد دفعة نقدية أو تحويل، وطباعة "سند صرف نقدية" لبنود المصروفات والمكافآت اليومية.
2. **تقارير مقارنة المزارع والدورات (Multi-Farm Comparative Analytics):**
   - إضافة لوحة مقارنة تحليلية في تبويب السحابة أو الملخص التنفيذي لمقارنة أداء عدة مزارع محفوظة في الأرشيف (إجمالي الأوزان، متوسط السعر، المصروفات، وصافي الخزينة لكل مزرعة).
3. **نظام التنبيهات الذكية لسقف مديونية التجار (Merchant Credit Limit Alerts):**
   - إتاحة تحديد "سقف ائتماني اختياري" لكل تاجر وإظهار تنبيه لوني داخل نموذج البيع إذا تجاوزت مديونية التاجر السقف المحدد.
4. **تصدير كشف حساب التاجر المستقل كملف Excel أو PDF بضغطة زر:**
   - إضافة زر داخل نافذة كشف حساب التاجر التفصيلي (`#merchantDrillDownModal`) لتصدير حركات هذا التاجر وحده في ملف `.xlsx` منسق مستقل.
