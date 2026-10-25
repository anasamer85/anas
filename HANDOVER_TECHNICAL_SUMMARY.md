# 📘 وثيقة التسليم التقنية الشاملة والنهائية (Lead Tech Handover Document — v46)
**المشروع:** نظام محاضر لجان بيع المزارع (Offline-First PWA + ربط ثنائي الاتجاه مع الإكسيل + مزامنة سحابية لحظية)  
**الإصدار المستقر النهائي:** `v46` (`farm-sales-committee-v46-audit-diff-and-day-lock`)  
**تاريخ التسليم النهائي:** أكتوبر 2026  

---

## 1. هيكلة المشروع الحالية (Project Architecture & Modular File Structure)

يعمل المشروع ببنية معيارية مقسمة بالكامل (**Strict Modular PWA Architecture**) ويُحظر دمج هذه الملفات في ملف واحد أثناء التطوير، مع دعم العمل الكامل بدون إنترنت (Offline-First) والرفع المباشر على **GitHub Pages** أو أي خادم ويب ثابت:

| اسم الملف | حجم الملف | الدور والمسؤولية التقنية الكاملة |
| :--- | :--- | :--- |
| **`index.html`** | ~162 KB (2,183 سطراً) | الهيكل الرئيسي لواجهة المستخدم (6 تبويبات رئيسية، بوابة تسجيل الدخول، نافذة كشف حساب التاجر التفصيلي `#merchantDrillDownModal`، شريط الإجراءات السفلي العائم للميزان `#mobileWeighbridgeActionBar`، أزرار التحكم في إظهار/إخفاء بيانات الرقابة `#auditMetadataToggleBar`، وحاوية الطباعة المعزولة `#merchantPrintOnlyContainer`). |
| **`style.css`** | ~41 KB (553 سطراً) | نظام التنسيق الشامل (Tailwind CSS v3.4.17 Preflight & Utilities مدمج محلياً للعمل بدون إنترنت + تنسيقات الهواتف والكمبيوتر + قواعد الطباعة الحرارية والرسمية `@media print` لعرض A4 Landscape وكارتة الميزان الثلاثية). |
| **`app.js`** | ~579 KB (11,038 سطراً) | المحرك البرمجي الكامل بدون أي اختصار: إدارة الحالة، المعادلات المحاسبية، الفلترة والفرز بأسلوب الإكسيل لـ 10 جداول، محرك التصدير والاستيراد الثنائي لملف `.xlsx` المكون من 15 شيت بالمعادلات والألوان مع منع التكرار المزدوج (`excelCompositeKey`) وتنظيف البيانات (`Data Sanitization`)، محرك المزامنة المضاد للاختراق (`v46`)، مركز النسخ الاحتياطي `.json`، سجل الرقابة الزمني (`Audit Trail`) مع التحكم في إظهاره/إخفائه، ومحرك الرسم الذكي (`Smart Active-Tab Rendering`). |
| **`sw.js`** | ~3.6 KB (123 سطراً) | عامل الخدمة (Service Worker) للعمل الكامل بدون إنترنت (Offline-First Caching) تحت اسم الكاش `farm-sales-committee-v46-audit-diff-and-day-lock` مع التحديث الفوري (`skipWaiting` + `clients.claim`) واستراتيجية `Network-First (no-store)` لملفات الكود وتمرير طلبات السحابة مباشرة للشبكة. |
| **`manifest.json`** | ~0.8 KB | ملف تعريف تطبيق الويب التقدمي (PWA Manifest) لدعم التثبيت المباشر على شاشة الهاتف والكمبيوتر (`standalone`، اتجاه `rtl`، ألوان الهوية `#1b365d`). |
| **`icon-192.png` / `icon-512.png`** | ~6.3 KB | أيقونات التطبيق الرسمية لتثبيت الـ PWA على أنظمة Android و iOS وسطح المكتب. |
| **`HANDOVER_TECHNICAL_SUMMARY.md`** | هذه الوثيقة | المرجع الهندسي الشامل لاستكمال التطوير دون فقدان أي سياق برمجي أو محاسبي. |
| **`README.md`** | ~6.5 KB | دليل التشغيل السريع والنشر على GitHub Pages وملخص التحديثات المعمارية حتى الإصدار `v46`. |

---

## 2. القواعد المحاسبية الصارمة وثوابت النظام (Strict Business & Accounting Rules)

> ⚠️ **تحذير هندسي صارم:** القواعد المحاسبية التالية تمثل صلب النظام المالي ولا يجوز المساس بمنطقها أو تغيير معادلاتها تحت أي ظرف:

### أ. المعادلات المحاسبية الأساسية (Core Accounting Formulas)
1. **معادلة الوزن الصافي والفاتورة اليومية (`computeSaleRow`):**
   - **شرط صحة الميزان:** يجب دائماً أن تكون `الوزنة الثانية (القائم w2) >= الوزنة الأولى (الفارغ w1)` عندما تكون `w2 > 0`. إذا أدخل المستخدم `w2 < w1` يظهر تحذير فوري (`#weightValidationAlert`) ويُمنع الحفظ النهائي.
   - **الوزن الصافي (`netWeight`):**
     $$\text{netWeight} = (w_2 \ge w_1 \text{ and } w_2 > 0) \ ? \ (w_2 - w_1) : 0$$
   - **قيمة الوزن الأساسية (`baseAmount`):**
     $$\text{baseAmount} = \text{netWeight} \times \text{price}$$
   - **إجمالي الفاتورة بالإكرامية (`totalWithTip`):**
     $$\text{totalWithTip} = \text{baseAmount} + \text{tip}$$
   - **إجمالي المسدد والآجل للفاتورة (`totalPaidAndCredit`):**
     $$\text{totalPaidAndCredit} = \text{cashSales} + \text{transferSales} + \text{creditSales}$$
   - **فرق الفاتورة (`invoiceDiff`):**
     $$\text{invoiceDiff} = \text{totalPaidAndCredit} - \text{totalWithTip}$$

2. **قاعدة الخزينة النقدية اليومية (`computeDaySummary` — قدسية النقدية الفعلية):**
   - **إجمالي النقدية الواردة للخزنة قبل المصاريف (`totalCashBeforeExpenses`):** يشمل **النقدي الفعلي فقط** (نقدي مبيعات اليوم + نقدي تحصيل مديونيات المزرعة الحالية + نقدي تحصيلات المزارع السابقة):
     $$\text{totalCashBeforeExpenses} = \sum \text{cashSales} + \sum \text{debtCash} + \sum \text{prevCash}$$
   - **صافي النقدية المطلوب توريده بالخزنة (`netCashInBox`):**
     $$\text{netCashInBox} = \text{totalCashBeforeExpenses} - \sum \text{expenses}$$
   - **فرق الخزينة اليومي (`cashBoxDiff`):**
     $$\text{cashBoxDiff} = \text{netCashInBox} - \text{deliveredCash}$$
     *(إذا كان الفرق `0` $\leftarrow$ خزينة مطابقة ✓، سالب $\leftarrow$ زيادة توريد، موجب $\leftarrow$ عجز توريد).*

3. **قاعدة التحويلات والشيكات (Transfers Rule):**
   - جميع التحويلات (`تحويل كاش / محفظة`، `تحويل بنكي`، `إنستا باي`، `شيكات`) تُعامل معاملة الآجل بالنسبة لخزينة الموقع النقدية (**لا تدخل `totalCashBeforeExpenses` أبداً**).
   - **تحويلات المزرعة الحالية (`currentFarmTransfers`):**
     $$\text{currentFarmTransfers} = \sum \text{transferSales} + \sum \text{debtTransfer}$$
     *(تُخصم بالكامل من حساب مديونية التاجر في المزرعة الحالية).*
   - **تحويلات المزارع السابقة (`sumPrevTransfer`):** تُدرج في بيان التحويلات الشامل وبيان المزارع السابقة، ولكن **لا تُخصم من مديونية المزرعة الحالية**.

4. **قاعدة مديونية التاجر للمزرعة الحالية (`netDebtCurrent`) مقابل المزارع السابقة:**
   - غير النقدي يوم البيع (`nonCashDayOfSale`) = `creditSales + transferSales`.
   - إجمالي المسدد للمزرعة الحالية (`totalSettledCurrent`) = `cashSales + transferSales + debtCash + debtTransfer`.
   - **صافي مديونية التاجر للمزرعة الحالية (`netDebtCurrent`):**
     $$\text{netDebtCurrent} = \text{openingBalance} + \sum \text{creditSales} - \sum \text{debtCash} - \sum \text{debtTransfer}$$
   - **تحصيلات المزارع السابقة (`prevCash` و `prevTransfer`):** تخص مواقع/مزارع أخرى؛ النقدي منها (`prevCash`) يدخل خزينة اليوم، والتحويل (`prevTransfer`) يدخل بيان التحويلات، ولكن **لا يُخصم أيٌّ منهما من مديونية المزرعة الحالية**.

5. **قاعدة العهدة المستقلة (`Standalone Custody Statement`):**
   - الحقول `custodyCash` و `custodyTransfer` و `custodyTransferType` هي **بيان مستقل تماماً** للعهدة التي دفعها التاجر، ولا تدخل في حساب الفاتورة أو الخزينة النقدية، ويُخصم منها تلقائياً ما سدده التاجر من مديونيات المزرعة الحالية:
     $$\text{totalCustody} = \text{custodyCash} + \text{custodyTransfer}$$
     $$\text{netCustodyRemaining} = \text{totalCustody} - (\text{debtCash} + \text{debtTransfer})$$

6. **تصنيفات المصروفات التسعة (`EXPENSE_CATEGORIES`):**
   - تشمل 8 بنود أساسية مصنفة + البند التاسع `'منصرفات أخرى (بدون تصنيف محدد)'` لضمان التطابق المحاسبي التام (100%) مع الصف رقم 14 في شيت `5_ملخص_المصروفات` داخل ملف الإكسيل.

### ب. قاعدة توحيد كود التاجر والسيارات الفرعية وتطبيع الأسماء (`Unified Merchant Coding`)
- دليل التجار الأساسي (`appState.merchants`) يبدأ من الكود `101` وهو **موحد وثابت عالمياً عبر جميع المزارع والدورات** (`unifyGlobalMerchantsRegistry()`).
- الدالة `cleanMerchantBaseName(rawName)` تنظف المسافات الزائدة وتحذف الأرقام والشرطات والأقواس (`/[0-9\-\(\)]/g`) لاستخراج اسم التاجر الأساسي.
- الدالة `normalizeArabicMerchantCompareKey(name)` تطبع الحروف العربية (`أ/إ/آ` $\leftarrow$ `ا`، `ة` $\leftarrow$ `ه`، `ى` $\leftarrow$ `ي`) وتوحد الأسماء المعرفة بـ `ال` (مثل توحيد `'مزرعه'` مع `'المزرعه'` كود `131`).
- الدالة `resolveMerchantCode(rawName)` تربط أي سيارة فرعية تلقائياً بكود التاجر الأساسي (مثال: `كرنك 1` و `كرنك 2` يأخذان تلقائياً الكود الموحد `104` الخاص بالتاجر الأساسي `كرنك`، وتُجمع كافة حركاتهما في كشف حساب `104 - كرنك`).

### ج. القواعد الصارمة لواجهة المستخدم والرقابة والأمان (UI/UX & Audit Constraints)
- **منع النوافذ المنبثقة الافتراضية نهائياً:** يُحظر استخدام `window.alert()` أو `window.confirm()` أو `window.prompt()` (لأنها تتوقف داخل بيئات العرض المدمجة مثل Google Sites و Canvas). يتم استخدام `showToast(msg, icon)` واللوحات التفاعلية المضمنة (`#dayMgmtBoxDelete`, `#dayMgmtBoxAdd`, `#dayMgmtBoxEdit`).
- **التحكم في إظهار وإخفاء بيانات الرقابة (`Audit Metadata Visibility Toggle`):**
  - يمكن للمستخدم إظهار أو إخفاء النصوص التفصيلية أسفل الحركات (مثل `👤 مدير الموقع | 🕒 01:39 ص`) داخل جدول حركات البيع المسجلة والموازين المعلقة والمصروفات عبر زر التبديل الموجود في "لوحة التحكم" داخل قسم `🕵️ سجل الرقابة الزمني لحركات المندوبين (Audit Trail)` (`#btnToggleAuditMetadata` / `#chkShowAuditMetadata`).
  - يُحفظ هذا التفضيل في `appState.showAuditMetadata` وفي مفتاح `LocalStorage` المستقل (`abouzekry_farm_sales_v5_clean_state_show_audit_metadata`) ليتذكر الموقع تفضيل المستخدم حتى بعد تحديث الصفحة أو استيراد ملف إكسيل.
- **تحصين النصوص ضد ثغرات XSS (`escXmlStr`):** جميع المدخلات النصية المعروضة داخل `innerHTML` تمر عبر دالة التعقيم `escXmlStr()`.
- **قصر إعادة الرسم على التبويب النشط (`Smart Active-Tab Rendering`):** الدالة `renderAll(forceAllTabs, preserveInputs)` تعيد بناء جدول التبويب النشط فقط (`appState.activeTab`) لضمان سرعة فائقة على الهواتف.

---

## 3. هيكل البيانات الدقيق (Exact Data Schema — `LocalStorage` & `IndexedDB`)

### أ. مفاتيح التخزين المحلي (`LocalStorage` & `IndexedDB`)
| المفتاح / القاعدة | الغرض التقني |
| :--- | :--- |
| **`abouzekry_farm_sales_v5_clean_state`** | المفتاح الرئيسي لكائن الحالة الكامل (`appState`) في `LocalStorage`. |
| **`abouzekry_farm_sales_v5_clean_state_webhook_url`** | مفتاح حفظ رابط السحابة الاحتياطي (`webhookUrl`) لضمان عدم ضياعه عند مسح الكاش. |
| **`abouzekry_farm_sales_v5_clean_state_show_floating_bar`** | مفتاح حفظ تفضيل إظهار/إخفاء شريط الميزان السفلي العائم (`'1'` أو `'0'`). |
| **`abouzekry_farm_sales_v5_clean_state_show_audit_metadata`** | مفتاح حفظ تفضيل إظهار/إخفاء نصوص الرقابة الزمنية أسفل الحركات (`'1'` أو `'0'`). |
| **`AbouZekryCloudDB_v5` (`IndexedDB`)** | قاعدة البيانات المحلية واسعة السعة؛ المخزن: `'farm_database_store'`، المفتاح: `'master_cloud_state'`. |

### ب. نموذج JSON الكامل لكائن الحالة (`appState` Data Schema)

```json
{
  "farmName": "أبوذكري",
  "lastExcelSync": "تم التحديث من الإكسيل (02:15:00 ص)",
  "lastJsonBackup": "آخر نسخة (.json): 02:10 ص بواسطة (مدير الموقع) ✓",
  "currentDay": 1,
  "visibleDays": [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
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
  "updatedAt": "2026-10-25T07:30:00.000Z",
  "farmResetAt": 0,
  "lastBulkImportAt": 1761377400000,
  "meta": {
    "lastBulkImportAt": 1761377400000
  },
  "defaultPrice": 78.02,
  "defaultTip": 250,
  "lastScaleNo": 5225,
  "inactivityTimeoutMin": 20,
  "showFloatingActionBar": true,
  "showAuditMetadata": true,
  "isLoggedIn": true,
  "lastActivityAt": 1761377450000,
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
    { "code": 101, "name": "محمود مدني", "openingBalance": 0 },
    { "code": 104, "name": "كرنك", "openingBalance": 0 }
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
          "excelCompositeKey": "d1|s0|m104|كرنك1|sc5222|car6923|w2100_3100|p78.02|c50000|tr10000|dc5000|dt0|pc0|pt0",
          "createdAt": 1761345000000,
          "createdBy": "مدير الموقع",
          "createdTimeTxt": "01:30 ص (24/10)",
          "updatedAt": 1761345000000,
          "updatedBy": "مدير الموقع",
          "updatedTimeTxt": "01:30 ص (24/10)",
          "importedAt": 1761377400000,
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
          "excelCompositeKey": "exp_d1|s0|cat:مشالوتحميلوعمال|amt:1500|desc:مكافاهعمالالتحميل|rec:ريسس",
          "createdAt": 1761345100000,
          "createdBy": "مدير الموقع",
          "createdTimeTxt": "01:31 ص (24/10)",
          "updatedAt": 1761345100000,
          "updatedBy": "مدير الموقع",
          "updatedTimeTxt": "01:31 ص (24/10)",
          "importedAt": 1761377400000,
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
      "updatedAt": "2026-10-25T07:30:00.000Z",
      "farmResetAt": 0,
      "lastBulkImportAt": 1761377400000,
      "visibleDays": [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
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

## 4. آلية المزامنة النهائية وتكامل الإكسيل المحصن (Bulletproof Sync & Excel QA — `v46`)

تم تصميم وتحصين محرك المزامنة وتكامل الإكسيل في `app.js` ليصمد أمام أصعب ظروف التشغيل الميداني (انقطاع الشبكة، التعديل المتزامن من عدة أجهزة، اختلاف ساعات الهواتف، وتكرار استيراد ملفات الإكسيل):

### أ. استخدام الختم الزمني المعاير ومعالجة اختلاف التوقيت (`Clock Skew & Calibrated Timestamps`)
1. **معايرة وقت السحابة (`calibrateCloudClockOffset` & `getSyncedNow`):**
   - يقيس النظام تلقائياً الفارق الزمني بين ساعة هاتف المندوب المحلي ووقت السحابة (`cloudData.updatedAt`) ويخزنه في `cloudClockOffsetMs`، بحيث تُختم جميع الحركات والتعديلات والحذوفات عبر `getSyncedNow()` بتوقيت معاير دقيق حتى لو كانت ساعة الهاتف المحلي متأخرة أو متقدمة.
2. **هامش التسامح الزمني (`CLOCK_SKEW_BUFFER_MS`):**
   - مضبوط على **60 دقيقة كاملة (`3,600,000 ms`)** لحماية السجلات المضافة حديثاً من أي مسح خاطئ ناتج عن تفاوت توقيت الأجهزة.
3. **الدمج على مستوى الحقول للسجل الواحد (`mergeSameRecordVersions`):**
   - إذا عدّل جهازان نفس السجل (نفس الـ `id`)، يفوز التعديل ذو الختم الزمني الأحدث (`updatedAt`) مع الاحتفاظ الدائم ببيانات المنشئ الأصلي (`createdBy`, `createdAt`, `createdTimeTxt`) والحفاظ على قيم العهدة إذا لم تتغير.

### ب. الحماية ضد الـ 0 حركات وتصفير الأيام (`Zero-Record & Reset Protection`)
1. **بنية المجموعات المراقبة (`Observed-Remove Set / OR-Set` في `mergeDaysObjects`):**
   - لا يتم استبدال مصفوفات `sales` أو `pendingSales` أو `expenses` بمصفوفة فارغة أبداً عند المزامنة.
   - إذا قام جهاز بمسح يوم (`clearedAt`) أو تصفير المزرعة (`farmResetAt`) بينما أضاف جهاز آخر حركات جديدة، فإن الدالة تحسب `effectiveClearTime = Math.max(localClearedAt, cloudClearedAt)` ولا تحذف إلا الحركات القديمة غير المعدلة التي أُنشئت قبل `effectiveClearTime - CLOCK_SKEW_BUFFER_MS`، بينما تظل أي حركة جديدة أو مستوردة حديثاً (`recLatestActivity > effectiveClearTime`) محمية بالكامل.
2. **حماية الأرشيف من الكتابة الفوقية (`mergeFarmSnapshots`):**
   - عند دمج أرشيف المزارع (`farmsArchive`)، لا يتم استبدال المزرعة بالكامل بل يتم دمج أيامها وحركاتها ذرياً عبر `mergeDaysObjects` مع مقارنة الطوابع الزمنية القياسية (`ISO 8601`).
3. **قفل الجلب المسبق الذري قبل الرفع (`Atomic Pre-Fetch Lock` في `pushDatabaseToCloud`):**
   - قبل رفع أي بيانات للسحابة (`POST`), يقوم النظام بطلب `GET` لجلب أحدث نسخة سحابية ودمجها مع الحالة المحلية أولاً. وإذا فشل الجلب المسبق بسبب ضعف الشبكة، يُلغى الرفع مؤقتاً وتُحفظ التعديلات في `pendingChanges` لمنع الكتابة العمياء فوق حركات المندوبين الآخرين.

### ج. تطهير سجل المحذوفات ومنع الارتداد العكسي للحذف (`deletedIds` & `deletedTimestamps` Sanitization)
1. **أختام الحذف الزمنية (`deletedTimestamps`):**
   - كل عملية حذف تسجل معرف الحركة في `deletedIds[category]` وتختم وقت الحذف الفعلي في `deletedTimestamps[category][id] = getSyncedNow()`.
2. **التطهير الذكي ضد شواهد القبور القديمة (`sanitizeMergedTombstonesAgainstLiveData`):**
   - قبل تطبيق `deletedIds` أثناء المزامنة، يقارن النظام وقت الحذف (`delTs`) مع وقت آخر نشاط أو استيراد للسجل (`recLatest = Math.max(updatedAt, importedAt, createdAt, lastBulkImportAt)`).
   - إذا كان السجل قد أُعيد استيراده من الإكسيل أو عُدّل في وقت أحدث من وقت حذفه القديم (`recLatest > delTs`)، يتم تطهير معرفه تلقائياً من `deletedIds` و`deletedTimestamps`، مما يقضي نهائياً على مشكلة "الارتداد العكسي للحذف" (Ghost Deletion).
3. **التقليم الدوري لمنع تضخم الذاكرة (`Garbage Collection / Pruning`):**
   - يتم تلقائياً تقليم `deletedIds` و`deletedTimestamps` للاحتفاظ بآخر `2000` معرف فقط لكل فئة، مما يحافظ على خفة وسرعة `LocalStorage`.

### د. تحصين تكامل الإكسيل ومنع التكرار المزدوج (`Excel Integration QA & Duplication Prevention`)
1. **المفاتيح المركبة القياسية (`buildExcelSaleCompositeKey` & `buildExcelExpenseCompositeKey`):**
   - عند استيراد ملف الإكسيل (عبر زر `📤 تحديث الموقع من الإكسيل` أو عبر `🔗 ربط ملف مباشر`)، يولد النظام مفتاحاً مركباً (`excelCompositeKey`) لكل حركة، ويقارن الحركات عبر `areSalesRowsDuplicate(..., ignoreDifferentUUIDs = true)`.
   - إذا كانت الحركة موجودة مسبقاً بنفس القيم (`isSaleRecordUnchanged`), يحتفظ النظام بمعرفها الأصلي (`UUID`) وبيانات الرقابة الزمنية الخاصة بها دون إنشاء نسخة مكررة أو تلويث سجل الرقابة.
2. **تنظيف البيانات القادمة من الإكسيل (`Data Sanitization`):**
   - تحديد هيكل أعمدة الشيت (`is25Col` / `is21Col`) على مستوى الشيت بالكامل من صف العناوين، وتخطي الصفوف الفارغة وصفوف الإجماليات.
   - تنظيف أسماء التجار من المسافات الزائدة وتوحيدها مع كود التاجر في العمود `B` (`101..999`).
   - تصفية أرقام الموازين الفارغة المكونة من مسافات (`sanitizeExcelPositiveIntOrEmpty`)، وإهمال فروق التقريب العشرية السالبة أو الأقل من 1 جنيه الناتجة عن معادلات طرح الإكسيل في عمود النقدي.
   - قراءة أعمدة العهدة الإضافية (`Z` و`AA`) وتنظيف نص `[عهدة: ...]` المضاف آلياً في عمود الملاحظات عند إعادة الاستيراد لمنع تكرار الملاحظات.
   - استدعاء `saveState(true, false)` بعد الاستيراد لضمان المزامنة السلسة مع السحابة، وعدم تصفير `pendingChanges` عند تصدير ملف إكسيل محلي.
