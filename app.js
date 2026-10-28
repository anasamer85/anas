// =========================================================================
// 1. INITIAL GROUNDED DATA & STATE (WITH DYNAMIC FARM NAME & FULL SYNC)
// =========================================================================
const STORAGE_KEY = 'abouzekry_farm_sales_v5_clean_state';
const LEGACY_STORAGE_KEYS = ['abouzekry_farm_sales_v4_state', 'abouzekry_farm_sales_v3_state'];
const EMBEDDED_CLOUD_WEBHOOK_URL = '';

function getEmbeddedWebhookUrl() {
  try {
    if (typeof window !== 'undefined' && window.EMBEDDED_CLOUD_WEBHOOK_URL && String(window.EMBEDDED_CLOUD_WEBHOOK_URL).trim()) {
      return String(window.EMBEDDED_CLOUD_WEBHOOK_URL).trim();
    }
    if (typeof document !== 'undefined') {
      const metaEl = document.getElementById('metaEmbeddedCloudWebhookUrl');
      if (metaEl) {
        const content = String(metaEl.getAttribute('content') || '').trim();
        if (content) return content;
      }
      const inpEl = document.getElementById('inpCloudWebhookUrl');
      if (inpEl) {
        const attrVal = String(inpEl.getAttribute('value') || '').trim();
        if (attrVal && attrVal.startsWith('http')) return attrVal;
      }
    }
  } catch (e) {}
  return String(EMBEDDED_CLOUD_WEBHOOK_URL || '').trim();
}
function countMovementsInDays(daysMap) {
  if (!daysMap || typeof daysMap !== 'object') return 0;
  let cnt = 0;
  for (let d = 1; d <= 10; d++) {
    const dm = daysMap[d];
    if (!dm) continue;
    cnt += (dm.sales ? dm.sales.length : 0) + (dm.pendingSales ? dm.pendingSales.length : 0) + (dm.expenses ? dm.expenses.length : 0);
  }
  return cnt;
}

let liveExcelFileHandle = null;

const EXPENSE_CATEGORIES = [
  'مكافآت وحوافز',
  'مصاريف موقع وتشغيل',
  'مشال وتحميل وعمال',
  'إكراميات وميزان',
  'تغذية وضيافة',
  'انتقالات وسولار',
  'سلف وعهد نقدية',
  'مصاريف نثرية أخرى',
  'منصرفات أخرى (بدون تصنيف محدد)'
];

function getDefaultState(customFarmName = 'أبوذكري') {
  // جميع بيانات قاعدة البيانات فارغة ما عدا الكود الموحد واسم التاجر الأساسي فقط
  const merchants = [
    { code: 101, name: 'محمود مدني' },
    { code: 102, name: 'رضا المنياوى' },
    { code: 103, name: 'السيد رشدي' },
    { code: 104, name: 'كرنك' },
    { code: 105, name: 'عبدالستار السيد' },
    { code: 106, name: 'استشوار' },
    { code: 107, name: 'احمد عمار' },
    { code: 108, name: 'احمد التهامى' },
    { code: 109, name: 'عبدة على' },
    { code: 110, name: 'عادل زغلول' },
    { code: 111, name: 'مسعد رمضان' },
    { code: 112, name: 'احمد النون' },
    { code: 113, name: 'الروبي' },
    { code: 114, name: 'رمضان شوقي' },
    { code: 115, name: 'التهامى احمد' },
    { code: 116, name: 'عطية زغلول' },
    { code: 117, name: 'الجزار' },
    { code: 118, name: 'محمود صلاح' }
  ];

  const days = {};
  for (let d = 1; d <= 10; d++) {
    days[d] = {
      dayNumber: d,
      dateLabel: `اليوم ${d}`,
      sales: [],
      pendingSales: [],
      expenses: [],
      deliveredCash: 0,
      carriedForwardCash: 0,
      isLocked: false,
      lockedBy: '',
      lockedAtTxt: '',
      lockUpdatedAt: 0
    };
  }

  return {
    farmName: customFarmName,
    lastExcelSync: '',
    currentDay: 1,
    visibleDays: [1],
    activeTab: 'daily',
    merchantsViewFilter: 'all',
    transfersViewFilter: 'all',
    prevFarmsViewFilter: 'all',
    expensesViewFilter: 'all',
    pendingChanges: 0,
    hasLocalEdits: false,
    liveSyncEnabled: true,
    liveSyncIntervalSec: 5,
    deletedIds: { sales: [], pendingSales: [], expenses: [], merchants: [], users: [], farms: [] },
    deletedTimestamps: { sales: {}, pendingSales: {}, expenses: {}, merchants: {}, users: {}, farms: {} },
    webhookUrl: getEmbeddedWebhookUrl() || '',
    updatedAt: '',
    farmResetAt: 0,
    factoryZeroWipeAt: 0,
    lastBulkImportAt: 0,
    defaultPrice: 0,
    defaultTip: 0,
    lastScaleNo: 0,
    inactivityTimeoutMin: 20,
    showFloatingActionBar: true,
    showAuditMetadata: true,
    liteFieldMode: false,
    autoLiteFieldOnMobile: true,
    stickyTableOptions: {
      headers: true,
      footers: true,
      rightCols: true,
      leftCols: true
    },
    activeUserId: 'admin',
    users: [
      { id: 'admin', username: 'admin', password: 'admin', name: 'مدير الموقع (كامل الصلاحيات)', phone: '', jobTitle: 'مدير عام المزرعة', isSystem: true, perms: { sales: true, expenses: true, merchants: true, farms: true, admin: true, liteFieldMode: false, showSyncExcel: true, showSyncCloud: true, showSyncWebhook: true } }
    ],
    merchants: merchants,
    days: days
  };
}

let appState = getDefaultState();
let dashChartInstance = null;
let activeRecalledPendingId = '';
let localMutationEpoch = 0;
let lastLocalMutationAt = 0;

// هامش تسامح اختلاف توقيت الساعات بين الأجهزة (Clock Skew Tolerance Buffer = 60 دقيقة)
// يحمي حركات المندوبين من الحذف أو الرفض الخاطئ حتى لو كانت ساعة هاتف المندوب متأخرة 15 دقيقة أو أكثر (حتى ساعة كاملة)
const CLOCK_SKEW_BUFFER_MS = 60 * 60 * 1000;
let cloudClockOffsetMs = 0;

// معايرة فرق التوقيت مع السحابة تلقائياً بالاتجاهين لتعويض تأخر أو تقديم ساعة هاتف المندوب (Bidirectional Clock Skew Calibration)
function calibrateCloudClockOffset(cloudUpdatedAtIso) {
  if (!cloudUpdatedAtIso) return;
  try {
    const cloudMs = typeof cloudUpdatedAtIso === 'number' ? cloudUpdatedAtIso : Date.parse(String(cloudUpdatedAtIso));
    if (!isNaN(cloudMs) && cloudMs > 0) {
      const localMs = Date.now();
      const diff = cloudMs - localMs;
      // تعويض الانحراف الزمني بالاتجاهين (تأخر الساعة diff > 5s أو تقديم الساعة diff < -5s حتى 24 ساعة) لضمان دقة وعدالة المقارنات الزمنية
      if (Math.abs(diff) > 5000 && Math.abs(diff) < 24 * 60 * 60 * 1000) {
        cloudClockOffsetMs = diff;
      }
    }
  } catch (e) {}
}

function getSyncedNow() {
  return Date.now() + (Number(cloudClockOffsetMs) || 0);
}

function isTimestampSignificantlyNewer(newerTs, olderTs, bufferMs = CLOCK_SKEW_BUFFER_MS) {
  const a = Number(newerTs) || 0;
  const b = Number(olderTs) || 0;
  if (a <= 0) return false;
  if (b <= 0) return true;
  return (a - b) > bufferMs;
}

function areTimestampsWithinSkewBuffer(tsA, tsB, bufferMs = CLOCK_SKEW_BUFFER_MS) {
  const a = Number(tsA) || 0;
  const b = Number(tsB) || 0;
  if (a <= 0 || b <= 0) return false;
  return Math.abs(a - b) <= bufferMs;
}

// فحص ما إذا كان المعرّف (ID) معرّفاً فريداً عالمياً (UUID) مانعاً للتصادم
function isCollisionProofUUID(idVal) {
  if (idVal === undefined || idVal === null) return false;
  const s = String(idVal).trim();
  return /_[0-9]{10,}_[0-9a-z]{6,}_[0-9a-z]{8,}$/i.test(s);
}

// توليد معرّف فريد عالمياً (Collision-Proof UUID) للإدخالات اليدوية والمستوردة لمنع تصادم المعرفات بين الأجهزة في وضع الأوفلاين
function generateRecordUUID(prefix = 'rec') {
  const nowMs = getSyncedNow();
  const tsBase36 = nowMs.toString(36);
  let randomHex = '';
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      randomHex = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
    } else if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
      const bytes = new Uint8Array(6);
      crypto.getRandomValues(bytes);
      randomHex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
    }
  } catch (e) {}
  if (!randomHex) {
    randomHex = Math.random().toString(36).substring(2, 10) + Math.random().toString(36).substring(2, 6);
  }
  return `${prefix}_${nowMs}_${tsBase36}_${randomHex}`;
}

function extractTimestampFromRecord(rec) {
  if (!rec || typeof rec !== 'object') return 0;
  const u = Number(rec.updatedAt) || 0;
  const c = Number(rec.createdAt) || 0;
  const imp = Number(rec.importedAt) || 0;
  const best = Math.max(u, c, imp);
  if (best > 0) return best;
  const idStr = String(rec.id || '');
  const m = idStr.match(/_(17\d{11})/);
  if (m && m[1]) return Number(m[1]) || 0;
  return 0;
}

function getLatestDayActivityTimestamp(dayObj, clearTs = 0) {
  if (!dayObj || typeof dayObj !== 'object') return 0;
  let maxTs = Number(dayObj.addedAt) || 0;
  const scanArr = (arr) => {
    if (!Array.isArray(arr)) return;
    arr.forEach(item => {
      const t = extractTimestampFromRecord(item);
      if (t > maxTs) maxTs = t;
    });
  };
  scanArr(dayObj.sales);
  scanArr(dayObj.pendingSales);
  scanArr(dayObj.expenses);
  const hasMov = ((dayObj.sales && dayObj.sales.length > 0) || (dayObj.pendingSales && dayObj.pendingSales.length > 0) || (dayObj.expenses && dayObj.expenses.length > 0));
  if (hasMov && maxTs <= clearTs) {
    maxTs = clearTs + 1;
  }
  return maxTs;
}

function sortSalesListByScaleNo(list) {
  if (!Array.isArray(list)) return [];
  return [...list].sort((a, b) => {
    const sa = Number(a && a.scaleNo) || 0;
    const sb = Number(b && b.scaleNo) || 0;
    if (sa > 0 && sb > 0 && sa !== sb) return sa - sb;
    return 0;
  });
}

function isSameNumVal(x, y, eps = 0.05) {
  return Math.abs((Number(x) || 0) - (Number(y) || 0)) <= eps;
}

function isSameMerchantIdentity(maRaw, mbRaw) {
  const ma = String(maRaw || '').replace(/\s+/g, ' ').trim();
  const mb = String(mbRaw || '').replace(/\s+/g, ' ').trim();
  if (!ma || !mb) return false;
  if (ma === mb) return true;
  // إذا كان كلاهما يشير لنفس التاجر الأساسي ونفس رقم السيارة الفرعية (أو بدون رقم فرعي) مثل "مزرعه" و "المزرعه" أو "عصفور محمد " و "عصفور محمد"
  const subA = (ma.match(/\d+/) || [''])[0];
  const subB = (mb.match(/\d+/) || [''])[0];
  if (subA === subB && normalizeArabicMerchantCompareKey(ma) === normalizeArabicMerchantCompareKey(mb)) {
    return true;
  }
  return false;
}

function areSalesRowsDuplicate(a, b, ignoreDifferentUUIDs = false) {
  if (!a || !b) return false;
  const hasIdA = a.id !== undefined && a.id !== null && String(a.id).trim() !== '';
  const hasIdB = b.id !== undefined && b.id !== null && String(b.id).trim() !== '';
  if (hasIdA && hasIdB) {
    if (String(a.id).trim() === String(b.id).trim()) return true;
    // إذا كان كلا السجلين يحملان معرّفين مختلفين، لا نعتبرهما مكررين أبداً أثناء المزامنة العادية حتى لا يبتلع سجلٌ قديمٌ سجلاً معدلاً
    if (!ignoreDifferentUUIDs) return false;
  }
  if (!a.isEdited && !b.isEdited && a.excelCompositeKey && b.excelCompositeKey && String(a.excelCompositeKey) === String(b.excelCompositeKey)) return true;
  if (!isSameMerchantIdentity(a.merchant, b.merchant)) return false;

  const sa = Number(a.scaleNo) || 0;
  const sb = Number(b.scaleNo) || 0;
  const ca = String(a.carNo || '').trim();
  const cb = String(b.carNo || '').trim();
  const w1a = Number(a.w1) || 0, w1b = Number(b.w1) || 0;
  const w2a = Number(a.w2) || 0, w2b = Number(b.w2) || 0;

  const sameFinancials =
    isSameNumVal(a.price, b.price) &&
    isSameNumVal(a.tip, b.tip) &&
    isSameNumVal(a.cashSales, b.cashSales, 0.5) &&
    isSameNumVal(a.transferSales, b.transferSales, 0.5) &&
    isSameNumVal(a.creditSales, b.creditSales, 0.5) &&
    isSameNumVal(a.debtCash, b.debtCash, 0.5) &&
    isSameNumVal(a.debtTransfer, b.debtTransfer, 0.5) &&
    isSameNumVal(a.prevCash, b.prevCash, 0.5) &&
    isSameNumVal(a.prevTransfer, b.prevTransfer, 0.5);

  // 1. نفس التاجر ونفس رقم مسلسل الميزان مع تطابق الأوزان والمبالغ المالية (أو عند تحديث نفس رقم الميزان من الإكسيل)
  if (sa > 0 && sb > 0 && sa === sb && (ignoreDifferentUUIDs || (isSameNumVal(w1a, w1b) && isSameNumVal(w2a, w2b) && sameFinancials))) return true;

  // 2. نفس التاجر ونفس رقم السيارة ونفس الأوزان الفعلية والمبالغ المالية
  if ((w1a > 0 || w2a > 0) && isSameNumVal(w1a, w1b) && isSameNumVal(w2a, w2b) && ca === cb && (ignoreDifferentUUIDs || sameFinancials)) return true;

  // 3. تطابق كامل في الأوزان والمبالغ المالية لنفس التاجر
  const sameWeights = isSameNumVal(w1a, w1b) && isSameNumVal(w2a, w2b);
  return sameWeights && sameFinancials;
}

function arePendingSalesDuplicate(a, b, ignoreDifferentUUIDs = false) {
  if (!a || !b) return false;
  const hasIdA = a.id !== undefined && a.id !== null && String(a.id).trim() !== '';
  const hasIdB = b.id !== undefined && b.id !== null && String(b.id).trim() !== '';
  if (hasIdA && hasIdB) {
    if (String(a.id).trim() === String(b.id).trim()) return true;
    if (!ignoreDifferentUUIDs) return false;
  }
  if (!a.isEdited && !b.isEdited && a.excelCompositeKey && b.excelCompositeKey && String(a.excelCompositeKey) === String(b.excelCompositeKey)) return true;
  if (!isSameMerchantIdentity(a.merchant, b.merchant)) return false;
  const sa = Number(a.scaleNo) || 0;
  const sb = Number(b.scaleNo) || 0;
  const w1a = Number(a.w1) || 0, w1b = Number(b.w1) || 0;
  if (sa > 0 && sb > 0 && sa === sb && (ignoreDifferentUUIDs || isSameNumVal(w1a, w1b))) return true;
  const ca = String(a.carNo || '').trim();
  const cb = String(b.carNo || '').trim();
  return ca === cb && isSameNumVal(w1a, w1b);
}

function areExpensesDuplicate(a, b, ignoreDifferentUUIDs = false) {
  if (!a || !b) return false;
  const hasIdA = a.id !== undefined && a.id !== null && String(a.id).trim() !== '';
  const hasIdB = b.id !== undefined && b.id !== null && String(b.id).trim() !== '';
  if (hasIdA && hasIdB) {
    if (String(a.id).trim() === String(b.id).trim()) return true;
    if (!ignoreDifferentUUIDs) return false;
  }
  if (!a.isEdited && !b.isEdited && a.excelCompositeKey && b.excelCompositeKey && String(a.excelCompositeKey) === String(b.excelCompositeKey)) return true;
  return (
    String(a.category || '').replace(/\s+/g, ' ').trim() === String(b.category || '').replace(/\s+/g, ' ').trim() &&
    String(a.desc || '').replace(/\s+/g, ' ').trim() === String(b.desc || '').replace(/\s+/g, ' ').trim() &&
    String(a.recipient || '').replace(/\s+/g, ' ').trim() === String(b.recipient || '').replace(/\s+/g, ' ').trim() &&
    isSameNumVal(a.amount, b.amount)
  );
}

function deduplicateDayRecords(dayObj, deletedIds) {
  if (!dayObj || typeof dayObj !== 'object') return;
  const delSalesSet = new Set(((deletedIds && deletedIds.sales) || []).map(String));
  const delPendSet = new Set(((deletedIds && deletedIds.pendingSales) || []).map(String));
  const delExpSet = new Set(((deletedIds && deletedIds.expenses) || []).map(String));

  // Deduplicate completed sales without poisoning deletedIds
  const cleanSales = [];
  (dayObj.sales || []).forEach(item => {
    if (!item) return;
    const sid = item.id !== undefined ? String(item.id) : '';
    if (sid && delSalesSet.has(sid)) return;
    const dupIdx = cleanSales.findIndex(existing => areSalesRowsDuplicate(existing, item));
    if (dupIdx === -1) {
      cleanSales.push(item);
    }
  });
  dayObj.sales = sortSalesListByScaleNo(cleanSales);

  // Deduplicate pending sales & remove any that already exist in completed sales
  const cleanPending = [];
  (dayObj.pendingSales || []).forEach(item => {
    if (!item) return;
    const pid = item.id !== undefined ? String(item.id) : '';
    if (pid && delPendSet.has(pid)) return;
    const alreadyCompleted = dayObj.sales.some(s =>
      String(s.merchant || '').trim() === String(item.merchant || '').trim() &&
      ((Number(s.scaleNo) > 0 && Number(s.scaleNo) === Number(item.scaleNo)) ||
       (String(s.carNo || '').trim() === String(item.carNo || '').trim() && Number(s.w1) === Number(item.w1)))
    );
    if (alreadyCompleted) return;
    const dupIdx = cleanPending.findIndex(existing => arePendingSalesDuplicate(existing, item));
    if (dupIdx === -1) {
      cleanPending.push(item);
    }
  });
  dayObj.pendingSales = sortSalesListByScaleNo(cleanPending);

  // Deduplicate expenses
  const cleanExpenses = [];
  (dayObj.expenses || []).forEach(item => {
    if (!item) return;
    const eid = item.id !== undefined ? String(item.id) : '';
    if (eid && delExpSet.has(eid)) return;
    const dupIdx = cleanExpenses.findIndex(existing => areExpensesDuplicate(existing, item));
    if (dupIdx === -1) {
      cleanExpenses.push(item);
    }
  });
  dayObj.expenses = cleanExpenses;
}

function deduplicateAllDaysInState(stateObj) {
  if (!stateObj || typeof stateObj !== 'object') return;
  stateObj.deletedIds = ensureDeletedIdsStructure(stateObj.deletedIds);
  if (stateObj.days && typeof stateObj.days === 'object') {
    for (let d = 1; d <= 10; d++) {
      if (stateObj.days[d]) deduplicateDayRecords(stateObj.days[d], stateObj.deletedIds);
    }
  }
  if (stateObj.farmsArchive && typeof stateObj.farmsArchive === 'object') {
    Object.values(stateObj.farmsArchive).forEach(fObj => {
      if (fObj && fObj.days && typeof fObj.days === 'object') {
        for (let d = 1; d <= 10; d++) {
          if (fObj.days[d]) deduplicateDayRecords(fObj.days[d], stateObj.deletedIds);
        }
      }
    });
  }
}

function ensureDeletedIdsStructure(obj) {
  const base = { sales: [], pendingSales: [], expenses: [], merchants: [], users: [], farms: [] };
  if (!obj || typeof obj !== 'object') return base;
  return {
    sales: Array.isArray(obj.sales) ? obj.sales : [],
    pendingSales: Array.isArray(obj.pendingSales) ? obj.pendingSales : [],
    expenses: Array.isArray(obj.expenses) ? obj.expenses : [],
    merchants: Array.isArray(obj.merchants) ? obj.merchants : [],
    users: Array.isArray(obj.users) ? obj.users : [],
    farms: Array.isArray(obj.farms) ? obj.farms : []
  };
}

function ensureDeletedTimestampsStructure(obj) {
  const base = { sales: {}, pendingSales: {}, expenses: {}, merchants: {}, users: {}, farms: {} };
  if (!obj || typeof obj !== 'object') return base;
  const copyMap = (m) => (m && typeof m === 'object' && !Array.isArray(m)) ? { ...m } : {};
  return {
    sales: copyMap(obj.sales),
    pendingSales: copyMap(obj.pendingSales),
    expenses: copyMap(obj.expenses),
    merchants: copyMap(obj.merchants),
    users: copyMap(obj.users),
    farms: copyMap(obj.farms)
  };
}

function applyParsedStateObject(parsed) {
  if (!parsed || !parsed.days || !parsed.merchants) return false;
  const savedWebhook = (getEmbeddedWebhookUrl() || parsed.webhookUrl || appState.webhookUrl || '').trim();
  appState = { ...getDefaultState(), ...parsed, webhookUrl: savedWebhook };
  appState.deletedIds = ensureDeletedIdsStructure(appState.deletedIds);
  appState.deletedTimestamps = ensureDeletedTimestampsStructure(appState.deletedTimestamps);
  if (appState.liveSyncEnabled === undefined) appState.liveSyncEnabled = true;
  if (!appState.liveSyncIntervalSec) appState.liveSyncIntervalSec = 5;
  if (appState.inactivityTimeoutMin === undefined || appState.inactivityTimeoutMin === null || isNaN(Number(appState.inactivityTimeoutMin))) {
    appState.inactivityTimeoutMin = 20;
  } else {
    appState.inactivityTimeoutMin = Math.max(0, Number(appState.inactivityTimeoutMin));
  }
  if (appState.showFloatingActionBar === undefined || appState.showFloatingActionBar === null) {
    try {
      const savedFloatPref = localStorage.getItem(STORAGE_KEY + '_show_floating_bar');
      appState.showFloatingActionBar = savedFloatPref !== null ? (savedFloatPref === '1' || savedFloatPref === 'true') : true;
    } catch (e) {
      appState.showFloatingActionBar = true;
    }
  } else {
    appState.showFloatingActionBar = Boolean(appState.showFloatingActionBar);
  }
  try {
    const savedAuditPref = localStorage.getItem(STORAGE_KEY + '_show_audit_metadata');
    if (savedAuditPref !== null) {
      appState.showAuditMetadata = (savedAuditPref === '1' || savedAuditPref === 'true');
    } else if (appState.showAuditMetadata === undefined || appState.showAuditMetadata === null) {
      appState.showAuditMetadata = true;
    } else {
      appState.showAuditMetadata = Boolean(appState.showAuditMetadata);
    }
  } catch (e) {
    appState.showAuditMetadata = appState.showAuditMetadata !== undefined && appState.showAuditMetadata !== null
      ? Boolean(appState.showAuditMetadata)
      : true;
  }
  try {
    const savedLitePref = localStorage.getItem(STORAGE_KEY + '_lite_field_mode');
    if (savedLitePref !== null) {
      appState.liteFieldMode = (savedLitePref === '1' || savedLitePref === 'true');
    } else {
      appState.liteFieldMode = Boolean(appState.liteFieldMode);
    }
    const savedAutoLite = localStorage.getItem(STORAGE_KEY + '_auto_lite_on_mobile');
    if (savedAutoLite !== null) {
      appState.autoLiteFieldOnMobile = (savedAutoLite === '1' || savedAutoLite === 'true');
    } else if (appState.autoLiteFieldOnMobile === undefined) {
      appState.autoLiteFieldOnMobile = true;
    }
  } catch (e) {
    appState.liteFieldMode = Boolean(appState.liteFieldMode);
    if (appState.autoLiteFieldOnMobile === undefined) appState.autoLiteFieldOnMobile = true;
  }
  try {
    const defaultSticky = { headers: true, footers: true, rightCols: true, leftCols: true };
    const savedStickyRaw = localStorage.getItem(STORAGE_KEY + '_sticky_table_options');
    if (savedStickyRaw) {
      const parsedSticky = JSON.parse(savedStickyRaw);
      appState.stickyTableOptions = {
        headers: parsedSticky.headers !== undefined ? Boolean(parsedSticky.headers) : true,
        footers: parsedSticky.footers !== undefined ? Boolean(parsedSticky.footers) : true,
        rightCols: parsedSticky.rightCols !== undefined ? Boolean(parsedSticky.rightCols) : true,
        leftCols: parsedSticky.leftCols !== undefined ? Boolean(parsedSticky.leftCols) : true
      };
    } else if (appState.stickyTableOptions && typeof appState.stickyTableOptions === 'object') {
      appState.stickyTableOptions = {
        headers: appState.stickyTableOptions.headers !== undefined ? Boolean(appState.stickyTableOptions.headers) : true,
        footers: appState.stickyTableOptions.footers !== undefined ? Boolean(appState.stickyTableOptions.footers) : true,
        rightCols: appState.stickyTableOptions.rightCols !== undefined ? Boolean(appState.stickyTableOptions.rightCols) : true,
        leftCols: appState.stickyTableOptions.leftCols !== undefined ? Boolean(appState.stickyTableOptions.leftCols) : true
      };
    } else {
      appState.stickyTableOptions = defaultSticky;
    }
  } catch (e) {
    appState.stickyTableOptions = { headers: true, footers: true, rightCols: true, leftCols: true };
  }
  if (!Array.isArray(appState.users) || appState.users.length === 0) {
    appState.users = getDefaultState().users;
  }
  // إزالة حساب الزائر الملغى وضمان وجود حساب مدير الموقع الأساسي
  appState.users = appState.users.filter(u => u && u.id !== 'visitor' && (u.isSystem || !appState.deletedIds.users.includes(u.id)));
  if (!appState.users.some(u => u.id === 'admin')) {
    appState.users.unshift(getDefaultState().users[0]);
  }
  if (appState.activeUserId === 'visitor') {
    appState.activeUserId = 'admin';
    appState.isLoggedIn = false;
  }
  if (!appState.merchantsViewFilter) appState.merchantsViewFilter = 'all';
  if (!appState.transfersViewFilter) appState.transfersViewFilter = 'all';
  if (!appState.prevFarmsViewFilter) appState.prevFarmsViewFilter = 'all';
  if (!appState.expensesViewFilter) appState.expensesViewFilter = 'all';
  if (!Array.isArray(appState.visibleDays) || appState.visibleDays.length === 0) {
    appState.visibleDays = [1];
  }
  deduplicateAllDaysInState(appState);
  unifyGlobalMerchantsRegistry();
  return true;
}

function unifyGlobalMerchantsRegistry() {
  const delSet = new Set(((appState.deletedIds && appState.deletedIds.merchants) || []).map(Number));
  const isFactoryZeroWiped = Number(appState.factoryZeroWipeAt) > 0;
  const baseDefaults = isFactoryZeroWiped ? [] : (getDefaultState().merchants || []);
  if (!Array.isArray(appState.merchants)) appState.merchants = [];

  // 1. ضمان وجود التجار الأساسيين (101..118) إلا إذا كان الموقع في وضع التصفير الجذري الشامل (factoryZeroWipeAt > 0)
  if (!isFactoryZeroWiped) {
    baseDefaults.forEach(dm => {
      const c = Number(dm.code);
      const n = String(dm.name || '').trim();
      if (c >= 100 && n && !delSet.has(c)) {
        if (!appState.merchants.some(m => m && (Number(m.code) === c || isSameMerchantIdentity(m.name, n)))) {
          appState.merchants.push({ code: c, name: n });
        }
      }
    });
  }

  // 2. دمج أي تجار مكودين في أرشيف المزارع (farmsArchive) غير محذوفين
  if (appState.farmsArchive && typeof appState.farmsArchive === 'object') {
    Object.values(appState.farmsArchive).forEach(fObj => {
      if (fObj && Array.isArray(fObj.merchants)) {
        fObj.merchants.forEach(fm => {
          const c = Number(fm && fm.code);
          const n = String((fm && fm.name) || '').trim();
          if (c >= 100 && n && !delSet.has(c)) {
            if (!appState.merchants.some(m => m && (Number(m.code) === c || isSameMerchantIdentity(m.name, n)))) {
              appState.merchants.push({ code: c, name: n });
            }
          }
        });
      }
    });
  }

  // 3. إذا تم بالخطأ حذف جميع التجار (ولم يكن الموقع في وضع التصفير الجذري الشامل Mode 3)، نعيد التجار الأساسيين الـ 18 تلقائياً
  const validNow = appState.merchants.filter(m => m && m.code && m.name && !delSet.has(Number(m.code)));
  if (validNow.length === 0 && !isFactoryZeroWiped) {
    if (appState.deletedIds) appState.deletedIds.merchants = [];
    if (appState.deletedTimestamps) appState.deletedTimestamps.merchants = {};
    delSet.clear();
    baseDefaults.forEach(dm => {
      appState.merchants.push({ code: Number(dm.code), name: String(dm.name).trim() });
    });
  }

  // 4. استخراج وتكويد أي تاجر موجود في حركات البيع أو الوزنات المؤقتة في الأيام الحالية أو الأرشيف غير موجود في الدليل
  const scanDaysForMissingMerchants = (daysMap) => {
    if (!daysMap || typeof daysMap !== 'object') return;
    for (let d = 1; d <= 10; d++) {
      const dayObj = daysMap[d];
      if (!dayObj) continue;
      [...(dayObj.sales || []), ...(dayObj.pendingSales || [])].forEach(row => {
        if (!row || !row.merchant) return;
        const baseName = cleanMerchantBaseName(row.merchant);
        if (!baseName) return;
        const existingCode = resolveMerchantCode(baseName);
        if (existingCode <= 0) {
          const nextCode = appState.merchants.length > 0
            ? Math.max(100, ...appState.merchants.map(m => Number(m.code) || 100)) + 1
            : 101;
          appState.merchants.push({ code: nextCode, name: baseName });
        }
      });
    }
  };
  scanDaysForMissingMerchants(appState.days);
  if (appState.farmsArchive && typeof appState.farmsArchive === 'object') {
    Object.values(appState.farmsArchive).forEach(fObj => {
      if (fObj && fObj.days) scanDaysForMissingMerchants(fObj.days);
    });
  }

  appState.merchants = appState.merchants
    .filter(m => m && m.code && m.name && !delSet.has(Number(m.code)))
    .map(m => ({ code: Number(m.code), name: String(m.name).trim(), ...(m.updatedAt ? { updatedAt: Number(m.updatedAt) } : {}) }))
    .sort((a, b) => Number(a.code) - Number(b.code));

  if (appState.farmsArchive && typeof appState.farmsArchive === 'object') {
    Object.values(appState.farmsArchive).forEach(fObj => {
      if (fObj && typeof fObj === 'object') {
        fObj.merchants = JSON.parse(JSON.stringify(appState.merchants));
      }
    });
  }
}

function loadState() {
  let loaded = false;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      loaded = applyParsedStateObject(JSON.parse(raw));
    }
  } catch (e) {}
  if (!loaded) {
    try {
      if (window.name && window.name.startsWith('ABOUZEKRY_STATE_V5:')) {
        loaded = applyParsedStateObject(JSON.parse(window.name.slice(19)));
      }
    } catch (e) {}
  }
  // استرجاع رابط السحابة من الملف المدمج (index.html) أو من الكاش الحالي أو السابق
  const embeddedUrl = getEmbeddedWebhookUrl();
  if (embeddedUrl) {
    appState.webhookUrl = embeddedUrl;
  }
  if (!appState.webhookUrl) {
    try {
      const savedUrl = localStorage.getItem(STORAGE_KEY + '_webhook_url');
      if (savedUrl && savedUrl.trim()) appState.webhookUrl = savedUrl.trim();
    } catch (e) {}
  }
  if (!appState.webhookUrl) {
    for (const legKey of LEGACY_STORAGE_KEYS) {
      try {
        const legUrl = localStorage.getItem(legKey + '_webhook_url');
        if (legUrl && legUrl.trim()) {
          appState.webhookUrl = legUrl.trim();
          break;
        }
        const legRaw = localStorage.getItem(legKey);
        if (legRaw) {
          const legParsed = JSON.parse(legRaw);
          if (legParsed && legParsed.webhookUrl && String(legParsed.webhookUrl).trim()) {
            appState.webhookUrl = String(legParsed.webhookUrl).trim();
            break;
          }
        }
      } catch (e) {}
    }
  }
  try {
    const savedAuditPref = localStorage.getItem(STORAGE_KEY + '_show_audit_metadata');
    if (savedAuditPref !== null) {
      appState.showAuditMetadata = (savedAuditPref === '1' || savedAuditPref === 'true');
    }
  } catch (e) {}
  return loaded;
}

function getActiveUser() {
  const users = appState.users || [];
  return users.find(u => u.id === appState.activeUserId) || users[0] || {
    id: 'admin', name: 'مدير الموقع', perms: { sales: true, expenses: true, merchants: true, farms: true, admin: true }
  };
}

function hasPermission(permKey) {
  const u = getActiveUser();
  if (!u || !u.perms) return false;
  if (u.perms.admin) return true;
  return Boolean(u.perms[permKey]);
}

function getActiveUserShortLabel() {
  const u = getActiveUser();
  if (!u) return 'مدير الموقع';
  const raw = String(u.name || u.username || u.id || 'مدير الموقع')
    .replace('(كامل الصلاحيات)', '')
    .replace('(عرض وسحب إكسيل فقط)', '')
    .trim();
  return raw || 'مدير الموقع';
}

function formatAuditTimeArabic(tsInput) {
  const ts = Number(tsInput) || Date.now();
  try {
    const dt = new Date(ts);
    if (isNaN(dt.getTime())) return '';
    const timeStr = dt.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
    const dateStr = dt.toLocaleDateString('ar-EG', { month: 'numeric', day: 'numeric' });
    return `${timeStr} (${dateStr})`;
  } catch (e) {
    return '';
  }
}

function computeRecordFieldDiffText(oldRec, newRec, recordType = 'sale') {
  if (!oldRec || !newRec || typeof oldRec !== 'object' || typeof newRec !== 'object') return '';
  const diffs = [];
  const checkStr = (label, oldVal, newVal) => {
    const a = String(oldVal ?? '').replace(/\s+/g, ' ').trim();
    const b = String(newVal ?? '').replace(/\s+/g, ' ').trim();
    if (a !== b) {
      diffs.push(`${label}: (${a || 'فارغ'} ⬅️ ${b || 'فارغ'})`);
    }
  };
  const checkNum = (label, oldVal, newVal, unit = '') => {
    const a = Number(oldVal) || 0;
    const b = Number(newVal) || 0;
    if (Math.abs(a - b) > 0.009) {
      const u = unit ? ` ${unit}` : '';
      diffs.push(`${label}: (${fmtMoney(a)}${u} ⬅️ ${fmtMoney(b)}${u})`);
    }
  };

  if (recordType === 'expense') {
    checkStr('البند', oldRec.category, newRec.category);
    checkStr('البيان', oldRec.desc, newRec.desc);
    checkStr('المستلم', oldRec.recipient, newRec.recipient);
    checkNum('المبلغ', oldRec.amount, newRec.amount, 'ج.م');
    checkStr('ملاحظات', oldRec.notes, newRec.notes);
  } else {
    checkStr('التاجر', oldRec.merchant, newRec.merchant);
    checkStr('الميزان', oldRec.scaleNo, newRec.scaleNo);
    checkStr('السيارة', oldRec.carNo, newRec.carNo);
    checkNum('وزنة 1', oldRec.w1, newRec.w1, 'كجم');
    checkNum('وزنة 2', oldRec.w2, newRec.w2, 'كجم');
    checkNum('السعر', oldRec.price, newRec.price);
    checkNum('الإكرامية', oldRec.tip, newRec.tip);
    checkNum('نقدي المبيعات', oldRec.cashSales, newRec.cashSales);
    checkNum('تحويل المبيعات', oldRec.transferSales, newRec.transferSales);
    if ((Number(oldRec.transferSales) || 0) > 0 || (Number(newRec.transferSales) || 0) > 0) {
      checkStr('نوع تحويل المبيعات', oldRec.transferSalesType, newRec.transferSalesType);
    }
    checkNum('آجل اليوم', oldRec.creditSales, newRec.creditSales);
    checkNum('سداد مديونية نقدي', oldRec.debtCash, newRec.debtCash);
    checkNum('سداد مديونية تحويل', oldRec.debtTransfer, newRec.debtTransfer);
    if ((Number(oldRec.debtTransfer) || 0) > 0 || (Number(newRec.debtTransfer) || 0) > 0) {
      checkStr('نوع تحويل المديونية', oldRec.debtTransferType, newRec.debtTransferType);
    }
    checkNum('نقدي مزرعة سابقة', oldRec.prevCash, newRec.prevCash);
    checkNum('تحويل مزرعة سابقة', oldRec.prevTransfer, newRec.prevTransfer);
    if ((Number(oldRec.prevTransfer) || 0) > 0 || (Number(newRec.prevTransfer) || 0) > 0) {
      checkStr('نوع تحويل السابقة', oldRec.prevTransferType, newRec.prevTransferType);
    }
    checkNum('عهدة نقدية', oldRec.custodyCash, newRec.custodyCash);
    checkNum('عهدة تحويل', oldRec.custodyTransfer, newRec.custodyTransfer);
    if ((Number(oldRec.custodyTransfer) || 0) > 0 || (Number(newRec.custodyTransfer) || 0) > 0) {
      checkStr('نوع تحويل العهدة', oldRec.custodyTransferType, newRec.custodyTransferType);
    }
    checkStr('الملاحظات', oldRec.notes, newRec.notes);
  }
  return diffs.join(' ، ');
}

function buildRecordAuditMeta(existingRec = null, isEdit = false, newCandidateRec = null, recordType = 'sale') {
  const actor = getActiveUserShortLabel();
  const prevMaxTs = existingRec
    ? Math.max(
        Number(existingRec.updatedAt) || 0,
        Number(existingRec.createdAt) || 0,
        Number(existingRec.importedAt) || 0,
        extractTimestampFromRecord(existingRec) || 0
      )
    : 0;
  // ضمان أن الطابع الزمني للتعديل الجديد أكبر دائماً من أي طابع سابق للسجل (بما فيه importedAt) لمنع ارتداد التعديلات
  const nowMs = Math.max(getSyncedNow(), prevMaxTs > 0 ? (prevMaxTs + 10) : 0);
  const nowTxt = formatAuditTimeArabic(nowMs);
  const prevEditVer = Number(existingRec && existingRec.editVersion) || 0;
  const prevHistory = (existingRec && Array.isArray(existingRec.editHistory))
    ? [...existingRec.editHistory]
    : [];
  let lastEditDiffText = String((existingRec && existingRec.lastEditDiffText) || '').trim();

  if (existingRec && isEdit && newCandidateRec) {
    const computedDiff = computeRecordFieldDiffText(existingRec, newCandidateRec, recordType);
    if (computedDiff) {
      lastEditDiffText = computedDiff;
      prevHistory.push({
        by: actor,
        at: nowMs,
        timeTxt: nowTxt,
        diffText: computedDiff
      });
      if (prevHistory.length > 20) prevHistory.splice(0, prevHistory.length - 20);
    }
  }

  if (existingRec && (existingRec.createdBy || existingRec.createdAt || prevMaxTs > 0)) {
    const origCreatedAt = Number(existingRec.createdAt) || prevMaxTs || nowMs;
    const origCreatedBy = String(existingRec.createdBy || existingRec.updatedBy || actor).trim();
    const origCreatedTxt = String(existingRec.createdTimeTxt || formatAuditTimeArabic(origCreatedAt)).trim();
    return {
      createdAt: origCreatedAt,
      createdBy: origCreatedBy,
      createdTimeTxt: origCreatedTxt,
      updatedAt: nowMs,
      updatedBy: actor,
      updatedTimeTxt: nowTxt,
      isEdited: Boolean(isEdit || origCreatedBy !== actor || (nowMs - origCreatedAt > 2000) || lastEditDiffText),
      editVersion: isEdit ? (prevEditVer + 1) : Math.max(1, prevEditVer),
      lastEditDiffText,
      editHistory: prevHistory,
      importedAt: 0,
      excelCompositeKey: ''
    };
  }
  return {
    createdAt: nowMs,
    createdBy: actor,
    createdTimeTxt: nowTxt,
    updatedAt: nowMs,
    updatedBy: actor,
    updatedTimeTxt: nowTxt,
    isEdited: Boolean(isEdit),
    editVersion: isEdit ? 1 : 0,
    lastEditDiffText: '',
    editHistory: [],
    importedAt: 0,
    excelCompositeKey: ''
  };
}

function renderAuditTrailBadgeHtml(rec) {
  if (appState && appState.showAuditMetadata === false) return '';
  if (!rec || typeof rec !== 'object') return '';
  const ts = Number(rec.updatedAt) || Number(rec.createdAt) || extractTimestampFromRecord(rec) || 0;
  const createdBy = String(rec.createdBy || rec.updatedBy || (ts > 0 ? 'مدير الموقع' : '')).trim();
  const updatedBy = String(rec.updatedBy || createdBy).trim();
  const timeTxt = String(rec.updatedTimeTxt || rec.createdTimeTxt || (ts > 0 ? formatAuditTimeArabic(ts) : '')).trim();
  if (!createdBy && !timeTxt) return '';

  const diffTxt = String(rec.lastEditDiffText || '').trim();
  const wasEdited = Boolean(rec.isEdited || diffTxt || (createdBy && updatedBy && createdBy !== updatedBy));
  const titleTip = wasEdited
    ? `سجل الرقابة — سجّله: ${createdBy} (${rec.createdTimeTxt || timeTxt}) | عدّله: ${updatedBy} (${rec.updatedTimeTxt || timeTxt})${diffTxt ? ` | التعديلات: ${diffTxt}` : ''}`
    : `سجل الرقابة — سجّله: ${createdBy || 'مدير الموقع'} | وقت الحركة: ${timeTxt || '-'}`;

  const labelHtml = wasEdited
    ? (createdBy !== updatedBy
        ? `<span>👤 ${escXmlStr(createdBy)}</span><span class="text-amber-700">✏️ ${escXmlStr(updatedBy)}</span>`
        : `<span>👤 ${escXmlStr(updatedBy)}</span><span class="text-amber-700">(✏️ معدّل)</span>`)
    : `<span>👤 ${escXmlStr(createdBy || 'مدير الموقع')}</span>`;

  const diffSnippetHtml = (wasEdited && diffTxt)
    ? `<span class="text-rose-800 font-bold max-w-[140px] truncate inline-block align-bottom" title="${escXmlStr(diffTxt)}">| 🔍 ${escXmlStr(diffTxt)}</span>`
    : '';

  return `<span class="audit-metadata-badge print-hide-col inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-slate-100 border border-slate-300 text-slate-800 text-[10px] font-extrabold ml-1 whitespace-nowrap" title="${escXmlStr(titleTip)}">${labelHtml}${timeTxt ? `<span class="text-blue-900 font-bold">| 🕒 ${escXmlStr(timeTxt)}</span>` : ''}${diffSnippetHtml}</span>`;
}

function isDayLocked(dayNum = appState.currentDay) {
  const dObj = appState.days && appState.days[Number(dayNum) || 1];
  return Boolean(dObj && dObj.isLocked);
}

function toggleDayLockState(dayNum = appState.currentDay) {
  if (!hasPermission('admin')) {
    showToast('🔒 عفواً، إقفال واعتماد اليوم أو فك القفل متاح لمدير الموقع فقط!', '🔒');
    return false;
  }
  const d = Number(dayNum) || appState.currentDay || 1;
  if (!appState.days[d]) return false;
  const dayObj = appState.days[d];
  const nowMs = Math.max(getSyncedNow(), (Number(dayObj.lockUpdatedAt) || 0) + 10);
  const nowTxt = formatAuditTimeArabic(nowMs);
  const actor = getActiveUserShortLabel();

  if (dayObj.isLocked) {
    dayObj.isLocked = false;
    dayObj.lockUpdatedAt = nowMs;
    saveState(true, false);
    renderAll();
    showToast(`🔓 تم فك قفل (يوم ${d} — ${dayObj.dateLabel}) بواسطة (${actor}) وإعادة فتحه للتعديل!`, '🔓');
  } else {
    const pendCnt = Array.isArray(dayObj.pendingSales) ? dayObj.pendingSales.length : 0;
    dayObj.isLocked = true;
    dayObj.lockedBy = actor;
    dayObj.lockedAtTxt = nowTxt;
    dayObj.lockUpdatedAt = nowMs;
    activeRecalledPendingId = '';
    const saleForm = document.getElementById('saleEntryForm');
    if (saleForm) saleForm.reset();
    const editIdEl = document.getElementById('editSaleId');
    if (editIdEl) editIdEl.value = '';
    saveState(true, false);
    renderAll();
    const pendWarnTxt = pendCnt > 0 ? ` (⚠️ تنبيه رقابي: يوجد ${pendCnt} سيارة مؤقتة تحت التحميل لم تستكمل الوزنة الثانية!)` : '';
    showToast(`🔒 تم إقفال واعتماد (يوم ${d} — ${dayObj.dateLabel}) محاسبياً وتشميعه ضد أي تعديل أو حذف!${pendWarnTxt}`, '🔒');
  }
  return true;
}

function getVisibleDays() {
  if (!Array.isArray(appState.visibleDays) || appState.visibleDays.length === 0) {
    appState.visibleDays = [1];
  }
  const set = new Set(appState.visibleDays.map(Number).filter(d => d >= 1 && d <= 10));
  // Automatically show any day (1..10) that already has recorded sales, pending sales, or expenses
  for (let d = 1; d <= 10; d++) {
    const dObj = appState.days && appState.days[d];
    if (!dObj) continue;
    const hasMovements = (dObj.sales && dObj.sales.length > 0) ||
                         (dObj.pendingSales && dObj.pendingSales.length > 0) ||
                         (dObj.expenses && dObj.expenses.length > 0);
    if (hasMovements) {
      dObj.isHidden = false;
      set.add(d);
    } else if (dObj.isHidden) {
      set.delete(d);
    }
  }
  if (set.size === 0) {
    set.add(1);
    if (appState.days && appState.days[1]) appState.days[1].isHidden = false;
  }
  appState.visibleDays = Array.from(set).sort((a, b) => a - b);
  return appState.visibleDays;
}

function addSpecificDayToCycle(targetDayNum, customLabel = '') {
  if (!hasPermission('sales')) {
    showToast('عفواً، إضافة يوم جديد متاحة لمدير الموقع والمستخدمين المصرح لهم.', '🔒');
    return false;
  }
  const dNum = Number(targetDayNum);
  if (!dNum || dNum < 1 || dNum > 10) {
    showToast('يرجى اختيار رقم يوم صحيح من (يوم 1) إلى (يوم 10)!', '⚠️');
    return false;
  }
  const nowTs = getSyncedNow();
  if (!appState.days[dNum]) {
    appState.days[dNum] = {
      dayNumber: dNum,
      dateLabel: `اليوم ${dNum}`,
      sales: [],
      pendingSales: [],
      expenses: [],
      deliveredCash: 0
    };
  }
  const trimmedLbl = String(customLabel || '').trim();
  if (trimmedLbl) {
    appState.days[dNum].dateLabel = trimmedLbl;
  } else if (!appState.days[dNum].dateLabel) {
    appState.days[dNum].dateLabel = `اليوم ${dNum}`;
  }
  appState.days[dNum].isHidden = false;
  appState.days[dNum].addedAt = nowTs;

  if (!Array.isArray(appState.visibleDays)) appState.visibleDays = [1];
  if (!appState.visibleDays.includes(dNum)) {
    appState.visibleDays.push(dNum);
  }
  appState.visibleDays.sort((a, b) => a - b);
  appState.currentDay = dNum;
  saveState(true, false);
  renderAll();
  showToast(`تم إضافة وفتح (يوم ${dNum} — ${appState.days[dNum].dateLabel}) بنجاح وربطه تراكمياً بباقي الأيام!`, '➕');
  return true;
}

function editSpecificDayInCycle(targetDayNum, newLabel) {
  if (!hasPermission('sales')) {
    showToast('عفواً، تعديل اليوم متاح لمدير الموقع والمستخدمين المصرح لهم.', '🔒');
    return false;
  }
  const dNum = Number(targetDayNum) || appState.currentDay || 1;
  if (isDayLocked(dNum)) {
    showToast(`🔒 عفواً، (يوم ${dNum}) مقفل ومعتمد محاسبياً! يجب فك القفل أولاً بواسطة مدير الموقع قبل تعديل اسم/تاريخ اليوم.`, '🔒');
    return false;
  }
  if (dNum < 1 || dNum > 10) return false;
  const trimmedLbl = String(newLabel || '').trim() || `اليوم ${dNum}`;
  if (!appState.days[dNum]) {
    appState.days[dNum] = {
      dayNumber: dNum,
      dateLabel: trimmedLbl,
      sales: [],
      pendingSales: [],
      expenses: [],
      deliveredCash: 0
    };
  } else {
    appState.days[dNum].dateLabel = trimmedLbl;
  }
  appState.days[dNum].isHidden = false;
  appState.days[dNum].addedAt = getSyncedNow();
  appState.days[dNum].labelUpdatedAt = getSyncedNow();
  if (!Array.isArray(appState.visibleDays)) appState.visibleDays = [1];
  if (!appState.visibleDays.includes(dNum)) {
    appState.visibleDays.push(dNum);
    appState.visibleDays.sort((a, b) => a - b);
  }
  appState.currentDay = dNum;
  saveState(true, false);
  renderAll();
  showToast(`تم تعديل اسم/تاريخ (يوم ${dNum}) إلى: (${trimmedLbl}) بنجاح!`, '✏️');
  return true;
}

function addNextDayToCycle() {
  if (!hasPermission('sales')) {
    showToast('عفواً، إضافة يوم جديد متاحة لمدير الموقع والمستخدمين المصرح لهم.', '🔒');
    return;
  }
  const vis = getVisibleDays();
  if (vis.length >= 10) {
    showToast('تم بالفعل إظهار جميع الـ 10 أيام كاملة في هذه الدورة!', 'ℹ️');
    return;
  }
  openDayManagementBox('add');
}

function recordDayItemsAsDeleted(dayObj) {
  if (!dayObj || typeof dayObj !== 'object') return;
  (dayObj.sales || []).forEach(r => { if (r && r.id !== undefined) recordDeletedItem('sales', String(r.id)); });
  (dayObj.pendingSales || []).forEach(r => { if (r && r.id !== undefined) recordDeletedItem('pendingSales', String(r.id)); });
  (dayObj.expenses || []).forEach(e => { if (e && e.id !== undefined) recordDeletedItem('expenses', String(e.id)); });
}

function clearActiveFarmMovementsKeepMerchants(customMsg = '', customIcon = '🗑️') {
  if (!hasPermission('farms') && !hasPermission('sales')) {
    showToast('عفواً، تصفير حركات المزرعة متاح لمدير الموقع والمستخدمين المصرح لهم.', '🔒');
    return false;
  }
  const currentFarm = appState.farmName || 'أبوذكري';
  const nowTs = getSyncedNow() + 100;
  for (let d = 1; d <= 10; d++) {
    if (appState.days && appState.days[d]) {
      recordDayItemsAsDeleted(appState.days[d]);
    }
    if (appState.farmsArchive && appState.farmsArchive[currentFarm] && appState.farmsArchive[currentFarm].days && appState.farmsArchive[currentFarm].days[d]) {
      recordDayItemsAsDeleted(appState.farmsArchive[currentFarm].days[d]);
    }
    appState.days[d] = {
      dayNumber: d,
      dateLabel: `اليوم ${d}`,
      sales: [],
      pendingSales: [],
      expenses: [],
      deliveredCash: 0,
      deliveredCashUpdatedAt: nowTs,
      clearedAt: nowTs
    };
  }
  activeRecalledPendingId = '';
  appState.currentDay = 1;
  appState.visibleDays = [1];
  appState.defaultPrice = 0;
  appState.defaultTip = 0;
  appState.lastScaleNo = 0;
  appState.farmResetAt = nowTs;
  appState.lastBulkImportAt = 0;
  appState.hasLocalEdits = true;
  unifyGlobalMerchantsRegistry();
  syncActiveFarmIntoArchive();
  // رفع التصفير فوراً للسحابة مع تخطي الجلب المسبق (skipCloudPreMerge = true) لمنع عودة البيانات المصفرّة من السحابة
  saveState(true, true);
  renderAll();
  showToast(
    customMsg || `تم تصفير جميع حركات مزرعة (${currentFarm}) نهائياً وإعادتها إلى (يوم 1) دون المساس بباقي المزارع في الأرشيف!`,
    customIcon
  );
  return true;
}

function clearAllSiteMovementsAndArchiveKeepMerchants(customMsg = '', customIcon = '🧨') {
  if (!hasPermission('farms') && !hasPermission('admin')) {
    showToast('عفواً، التصفير الشامل للموقع متاح لمدير الموقع والمستخدمين المصرح لهم.', '🔒');
    return false;
  }
  const currentFarm = appState.farmName || 'أبوذكري';
  const nowTs = getSyncedNow() + 100;

  // 1. تسجيل جميع حركات المزرعة النشطة في deletedIds
  for (let d = 1; d <= 10; d++) {
    if (appState.days && appState.days[d]) {
      recordDayItemsAsDeleted(appState.days[d]);
    }
  }

  // 2. تسجيل جميع حركات المزارع المحفوظة في الأرشيف (farmsArchive) في deletedIds وتسجيل أسماء المزارع الأخرى كمحذوفة
  if (appState.farmsArchive && typeof appState.farmsArchive === 'object') {
    Object.keys(appState.farmsArchive).forEach(fKey => {
      const fObj = appState.farmsArchive[fKey];
      if (fObj && fObj.days && typeof fObj.days === 'object') {
        for (let d = 1; d <= 10; d++) {
          if (fObj.days[d]) recordDayItemsAsDeleted(fObj.days[d]);
        }
      }
      if (fKey !== currentFarm) {
        recordDeletedItem('farms', fKey, nowTs);
      }
    });
  }

  // 3. تصفير أيام المزرعة النشطة وإعادتها لـ (يوم 1) ومسح أرشيف المزارع الأخرى بالكامل
  for (let d = 1; d <= 10; d++) {
    appState.days[d] = {
      dayNumber: d,
      dateLabel: `اليوم ${d}`,
      sales: [],
      pendingSales: [],
      expenses: [],
      deliveredCash: 0,
      deliveredCashUpdatedAt: nowTs,
      clearedAt: nowTs
    };
  }
  activeRecalledPendingId = '';
  appState.currentDay = 1;
  appState.visibleDays = [1];
  appState.defaultPrice = 0;
  appState.defaultTip = 0;
  appState.lastScaleNo = 0;
  appState.farmResetAt = nowTs;
  appState.lastBulkImportAt = 0;
  appState.farmsArchive = {};
  appState.hasLocalEdits = true;
  unifyGlobalMerchantsRegistry();
  unrecordDeletedItem('farms', currentFarm);
  syncActiveFarmIntoArchive();
  // رفع التصفير الشامل فوراً للسحابة مع تخطي الجلب المسبق (skipCloudPreMerge = true) لمنع ارتداد أي مزرعة أو حركة قديمة
  saveState(true, true);
  renderAll();
  showToast(
    customMsg || `🧨 تم التصفير الشامل للموقع بالكامل (مسح حركات المزرعة النشطة + مسح أرشيف المزارع) مع بقاء دليل التجار والمستخدمين وإعدادات السحابة!`,
    customIcon
  );
  return true;
}

function clearEverythingToFactoryZeroState(customMsg = '', customIcon = '☢️') {
  if (!hasPermission('farms') && !hasPermission('admin')) {
    showToast('عفواً، المسح الجذري الشامل للموقع والسحابة متاح لمدير الموقع والمستخدمين المصرح لهم فقط.', '🔒');
    return false;
  }
  const nowTs = getSyncedNow() + 500;

  // 1. تسجيل جميع حركات المزرعة النشطة في سجل المحذوفات (Tombstones) لضمان مسحها من أي جهاز آخر متصل
  for (let d = 1; d <= 10; d++) {
    if (appState.days && appState.days[d]) {
      recordDayItemsAsDeleted(appState.days[d]);
    }
  }
  if (appState.farmName && String(appState.farmName).trim()) {
    recordDeletedItem('farms', String(appState.farmName).trim(), nowTs);
  }
  recordDeletedItem('farms', 'أبوذكري', nowTs);

  // 2. تسجيل جميع حركات وأسماء المزارع والتجار في الأرشيف داخل سجل المحذوفات
  if (appState.farmsArchive && typeof appState.farmsArchive === 'object') {
    Object.keys(appState.farmsArchive).forEach(fKey => {
      const fObj = appState.farmsArchive[fKey];
      if (fObj && fObj.days && typeof fObj.days === 'object') {
        for (let d = 1; d <= 10; d++) {
          if (fObj.days[d]) recordDayItemsAsDeleted(fObj.days[d]);
        }
      }
      if (fObj && Array.isArray(fObj.merchants)) {
        fObj.merchants.forEach(fm => {
          if (fm && fm.code) recordDeletedItem('merchants', Number(fm.code), nowTs);
        });
      }
      if (fKey && String(fKey).trim()) {
        recordDeletedItem('farms', String(fKey).trim(), nowTs);
      }
    });
  }

  // 3. تسجيل جميع التجار الحاليين + التجار الافتراضيين الـ 18 (101..118) كمحذوفين بطابع زمني حديث حتى لا يعود أي تاجر من السحابة أو الأجهزة الأخرى
  const allMerchantCodesToWipe = new Set([
    ...((appState.merchants || []).map(m => Number(m && m.code)).filter(Boolean)),
    ...((getDefaultState().merchants || []).map(m => Number(m.code)).filter(Boolean))
  ]);
  allMerchantCodesToWipe.forEach(code => {
    recordDeletedItem('merchants', code, nowTs);
  });

  // 4. تسجيل جميع المستخدمين الإضافيين (غير حساب admin الأساسي) كمحذوفين
  (appState.users || []).forEach(u => {
    if (u && u.id && u.id !== 'admin' && !u.isSystem) {
      recordDeletedItem('users', String(u.id), nowTs);
    }
  });
  const adminExisting = (appState.users || []).find(u => u && u.id === 'admin') || getDefaultState().users[0];
  appState.users = [JSON.parse(JSON.stringify(adminExisting))];
  appState.activeUserId = 'admin';

  // 5. تصفير كافة الأيام (1..10) واسم المزرعة والأرشيف والتجار بالكامل (0 مزرعة، 0 تاجر، 0 حركة، 0 مصروف، 0 أرشيف)
  for (let d = 1; d <= 10; d++) {
    appState.days[d] = {
      dayNumber: d,
      dateLabel: `اليوم ${d}`,
      sales: [],
      pendingSales: [],
      expenses: [],
      deliveredCash: 0,
      deliveredCashUpdatedAt: nowTs,
      carriedForwardCash: 0,
      carriedForwardCashUpdatedAt: nowTs,
      isLocked: false,
      lockedBy: '',
      lockedAtTxt: '',
      lockUpdatedAt: nowTs,
      clearedAt: nowTs
    };
  }

  activeRecalledPendingId = '';
  appState.farmName = '';
  appState.lastFarmSwitchAt = nowTs;
  appState.currentDay = 1;
  appState.visibleDays = [1];
  appState.defaultPrice = 0;
  appState.defaultTip = 0;
  appState.lastScaleNo = 0;
  appState.farmResetAt = nowTs;
  appState.factoryZeroWipeAt = nowTs;
  appState.lastBulkImportAt = 0;
  appState.merchants = [];
  appState.farmsArchive = {};
  appState.hasLocalEdits = true;

  const saleForm = document.getElementById('saleEntryForm');
  if (saleForm) saleForm.reset();
  const editSaleIdEl = document.getElementById('editSaleId');
  if (editSaleIdEl) editSaleIdEl.value = '';
  const suggestBoxEl = document.getElementById('merchantSuggestBox');
  if (suggestBoxEl) {
    suggestBoxEl.innerHTML = '';
    suggestBoxEl.classList.add('hidden');
  }
  const dispCodeEl = document.getElementById('dispMerchantCode');
  if (dispCodeEl) dispCodeEl.textContent = 'يُحدد تلقائياً';
  const expForm = document.getElementById('expenseEntryForm');
  if (expForm) expForm.reset();
  const editExpIdEl = document.getElementById('editExpenseId');
  if (editExpIdEl) editExpIdEl.value = '';

  // 6. رفع التصفير الجذري الشامل فوراً للسحابة مع تخطي الجلب المسبق (skipCloudPreMerge = true) لمسح السحابة بالكامل واعتماد حالة الصفر
  saveState(true, true);
  renderAll(true);
  showToast(
    customMsg || '☢️ تم التصفير الجذري الشامل للموقع والسحابة بالكامل (0 مزارع، 0 تجار، 0 حركات، 0 مصروفات) — الموقع الآن جديد تماماً بدون أي بيانات!',
    customIcon
  );
  return true;
}

function deleteSpecificDayFromCycle(targetDayNum) {
  if (!hasPermission('sales')) {
    showToast('عفواً، حذف أو تصفير اليوم متاح لمدير الموقع والمستخدمين المصرح لهم.', '🔒');
    return false;
  }
  const cur = Number(targetDayNum) || appState.currentDay || 1;
  if (isDayLocked(cur)) {
    showToast(`🔒 عفواً، (يوم ${cur}) مقفل ومعتمد محاسبياً! لا يمكن حذف أو تصفير يوم مقفل إلا بعد فك القفل بواسطة مدير الموقع.`, '🔒');
    return false;
  }
  const vis = getVisibleDays();
  const nowTs = getSyncedNow();
  const currentFarm = appState.farmName || 'أبوذكري';

  if (appState.days && appState.days[cur]) {
    recordDayItemsAsDeleted(appState.days[cur]);
  }
  if (appState.farmsArchive && appState.farmsArchive[currentFarm] && appState.farmsArchive[currentFarm].days && appState.farmsArchive[currentFarm].days[cur]) {
    recordDayItemsAsDeleted(appState.farmsArchive[currentFarm].days[cur]);
  }

  const otherVisibleDays = vis.filter(d => d !== cur);
  const isOnlyDayLeft = otherVisibleDays.length === 0;

  appState.days[cur] = {
    dayNumber: cur,
    dateLabel: `اليوم ${cur}`,
    sales: [],
    pendingSales: [],
    expenses: [],
    deliveredCash: 0,
    clearedAt: nowTs,
    addedAt: 0,
    isHidden: !isOnlyDayLeft
  };

  if (isOnlyDayLeft) {
    appState.visibleDays = [cur];
    appState.currentDay = cur;
    saveState(true, false);
    renderAll();
    showToast(`تم تصفير ومسح جميع بيانات (يوم ${cur}) نهائياً مع بقائه مفتوحاً كاليوم الأساسي الوحيد`, '🗑️');
    return true;
  }

  appState.visibleDays = otherVisibleDays;
  const remaining = getVisibleDays();
  if (!remaining.includes(appState.currentDay)) {
    appState.currentDay = remaining[remaining.length - 1] || remaining[0] || 1;
  }
  saveState(true, false);
  renderAll();
  showToast(`تم حذف وتصفير (يوم ${cur}) نهائياً والانتقال إلى (يوم ${appState.currentDay}) وتحديث الحسابات التراكمية`, '🗑️');
  return true;
}

function deleteOrClearCurrentDay() {
  if (!hasPermission('sales')) {
    showToast('عفواً، حذف أو تصفير اليوم متاح لمدير الموقع والمستخدمين المصرح لهم.', '🔒');
    return;
  }
  openDayManagementBox('delete');
}

function getNextSequentialScaleNo() {
  const curDayObj = (appState.days && appState.days[appState.currentDay]) || {};
  const curSales = curDayObj.sales || [];
  const curPending = curDayObj.pendingSales || [];
  let maxScale = 0;
  curSales.forEach(r => {
    const sn = Number(r.scaleNo) || 0;
    if (sn > maxScale) maxScale = sn;
  });
  curPending.forEach(r => {
    const sn = Number(r.scaleNo) || 0;
    if (sn > maxScale) maxScale = sn;
  });
  if (maxScale > 0) return maxScale + 1;
  for (let d = appState.currentDay - 1; d >= 1; d--) {
    const dObj = (appState.days && appState.days[d]) || {};
    const dSales = dObj.sales || [];
    const dPending = dObj.pendingSales || [];
    dSales.forEach(r => {
      const sn = Number(r.scaleNo) || 0;
      if (sn > maxScale) maxScale = sn;
    });
    dPending.forEach(r => {
      const sn = Number(r.scaleNo) || 0;
      if (sn > maxScale) maxScale = sn;
    });
    if (maxScale > 0) return maxScale + 1;
  }
  return (Number(appState.lastScaleNo) || 0) + 1;
}

function applyStickySaleDefaults() {
  const editId = document.getElementById('editSaleId') ? document.getElementById('editSaleId').value : '';
  if (editId || activeRecalledPendingId) return;
  const elPrice = document.getElementById('inpPrice');
  const elTip = document.getElementById('inpTip');
  const elScale = document.getElementById('inpScaleNo');
  const dp = Number(appState.defaultPrice) || 0;
  const dt = Number(appState.defaultTip) || 0;
  if (elPrice) elPrice.value = dp > 0 ? fmtMoney(dp) : '';
  if (elTip) elTip.value = dt > 0 ? fmtMoney(dt) : '';
  if (elScale) elScale.value = getNextSequentialScaleNo();
}

function computeMerchantCurrentDebtExcluding(merchantCode, excludeSaleId = '') {
  if (!merchantCode) return 0;
  let netDebt = 0;
  for (let d = 1; d <= 10; d++) {
    const dSales = (appState.days[d] && appState.days[d].sales) || [];
    dSales.forEach(rawRow => {
      if (excludeSaleId && rawRow.id === excludeSaleId) return;
      const r = computeSaleRow(rawRow);
      if (r.code === merchantCode) {
        netDebt += (r.creditSales - r.debtCash - r.debtTransfer);
      }
    });
  }
  return netDebt;
}

// حساب المديونية المرجعية الاسترشادية للتاجر في مزارع الأرشيف السابقة (Cross-Farm Debt Reference — استرشادي فقط ولا يمس معادلات المزرعة الحالية نهائياً)
function computeMerchantCrossFarmDebtReference(merchantCode, rawNotesOrFarmQuery = '') {
  const result = {
    matchedFarmName: '',
    matchedFarmDebt: 0,
    otherFarmsDebts: [],
    totalOtherFarmsDebt: 0
  };
  if (!merchantCode || !appState.farmsArchive || typeof appState.farmsArchive !== 'object') {
    return result;
  }
  const currentFarm = String(appState.farmName || 'أبوذكري').trim();
  const normQuery = normalizeArabicMerchantCompareKey(String(rawNotesOrFarmQuery || '').trim());

  Object.keys(appState.farmsArchive).forEach(fName => {
    const cleanFName = String(fName || '').trim();
    if (!cleanFName || cleanFName === currentFarm) return;
    const fObj = appState.farmsArchive[fName];
    if (!fObj || !fObj.days || typeof fObj.days !== 'object') return;

    let fDebt = 0;
    for (let d = 1; d <= 10; d++) {
      const dSales = (fObj.days[d] && fObj.days[d].sales) || [];
      dSales.forEach(rawRow => {
        const r = computeSaleRow(rawRow);
        if (Number(r.code) === Number(merchantCode)) {
          fDebt += (r.creditSales - r.debtCash - r.debtTransfer);
        }
      });
    }
    const roundedDebt = Math.round(fDebt * 100) / 100;
    if (Math.abs(roundedDebt) > 0.01) {
      result.otherFarmsDebts.push({ farmName: cleanFName, debt: roundedDebt });
      result.totalOtherFarmsDebt += roundedDebt;
    }

    const normFarm = normalizeArabicMerchantCompareKey(cleanFName);
    if (normQuery && normFarm && (normQuery.includes(normFarm) || normFarm.includes(normQuery))) {
      result.matchedFarmName = cleanFName;
      result.matchedFarmDebt = roundedDebt;
    }
  });

  return result;
}

function updatePrevFarmsArchiveDatalistUI() {
  const dl = document.getElementById('prevFarmsArchiveDatalist');
  if (!dl) return;
  const currentFarm = String(appState.farmName || 'أبوذكري').trim();
  const archive = appState.farmsArchive || {};
  const otherFarms = Object.keys(archive).filter(fn => fn && fn.trim() && fn.trim() !== currentFarm);
  dl.innerHTML = otherFarms.map(fn => `<option value="${escXmlStr(fn)}"></option>`).join('');
}

// =========================================================================
// CLOUD DATABASE ENGINE (IndexedDB + Multi-Farm Archive + Cloud REST Sync)
// =========================================================================
const IDB_NAME = 'AbouZekryCloudDB_v5';
const IDB_STORE = 'farm_database_store';

function saveToIndexedDB(stateObj) {
  try {
    if (!window.indexedDB) return;
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = (e) => {
      const db = e.target.result;
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(JSON.parse(JSON.stringify(stateObj)), 'master_cloud_state');
    };
  } catch (err) {}
}

function loadFromIndexedDBAsync() {
  return new Promise((resolve) => {
    try {
      if (!window.indexedDB) return resolve(null);
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE);
        }
      };
      req.onsuccess = (e) => {
        try {
          const db = e.target.result;
          const tx = db.transaction(IDB_STORE, 'readonly');
          const getReq = tx.objectStore(IDB_STORE).get('master_cloud_state');
          getReq.onsuccess = () => resolve(getReq.result || null);
          getReq.onerror = () => resolve(null);
        } catch (err) {
          resolve(null);
        }
      };
      req.onerror = () => resolve(null);
    } catch (err) {
      resolve(null);
    }
  });
}

function syncActiveFarmIntoArchive() {
  if (!appState.farmsArchive || typeof appState.farmsArchive !== 'object') {
    appState.farmsArchive = {};
  }
  unifyGlobalMerchantsRegistry();
  const rawName = String(appState.farmName ?? '').trim();
  if (!rawName && Number(appState.factoryZeroWipeAt) > 0) {
    return;
  }
  const fName = rawName || 'أبوذكري';
  appState.farmsArchive[fName] = {
    farmName: fName,
    updatedAt: new Date(getSyncedNow()).toISOString(),
    farmResetAt: Number(appState.farmResetAt) || 0,
    lastBulkImportAt: Number(appState.lastBulkImportAt) || 0,
    visibleDays: getVisibleDays(),
    defaultPrice: appState.defaultPrice !== undefined ? appState.defaultPrice : 0,
    defaultTip: appState.defaultTip !== undefined ? appState.defaultTip : 0,
    lastScaleNo: appState.lastScaleNo !== undefined ? Number(appState.lastScaleNo) : 0,
    merchants: JSON.parse(JSON.stringify(appState.merchants || [])),
    days: JSON.parse(JSON.stringify(appState.days))
  };
}

function activateFarmFromArchive(targetFarm) {
  if (!targetFarm || !appState.farmsArchive || !appState.farmsArchive[targetFarm]) return false;
  syncActiveFarmIntoArchive();
  const fObj = appState.farmsArchive[targetFarm];
  const nowSwitchTs = getSyncedNow();
  appState.farmName = targetFarm;
  appState.lastFarmSwitchAt = nowSwitchTs;
  appState.hasLocalEdits = true;
  localMutationEpoch++;
  lastLocalMutationAt = Date.now();
  appState.farmResetAt = Number(fObj.farmResetAt) || 0;
  appState.lastBulkImportAt = Number(fObj.lastBulkImportAt) || 0;
  appState.days = JSON.parse(JSON.stringify(fObj.days || {}));
  appState.visibleDays = Array.isArray(fObj.visibleDays) && fObj.visibleDays.length > 0 ? [...fObj.visibleDays] : [1];
  appState.defaultPrice = fObj.defaultPrice !== undefined ? Number(fObj.defaultPrice) : 0;
  appState.defaultTip = fObj.defaultTip !== undefined ? Number(fObj.defaultTip) : 0;
  appState.lastScaleNo = fObj.lastScaleNo !== undefined ? Number(fObj.lastScaleNo) : 0;
  // الكود الموحد واسم التاجر الأساسي ثابت وموحد دائماً في جميع المزارع
  deduplicateAllDaysInState(appState);
  unifyGlobalMerchantsRegistry();
  syncActiveFarmIntoArchive();
  appState.currentDay = 1;
  activeRecalledPendingId = '';
  const saleForm = document.getElementById('saleEntryForm');
  if (saleForm) saleForm.reset();
  const editIdEl = document.getElementById('editSaleId');
  if (editIdEl) editIdEl.value = '';
  return true;
}

let isCloudSyncInProgress = false;
let liveSyncTimerId = null;
let firebaseEventSource = null;
let liveBroadcastChannel = null;
try {
  if (typeof BroadcastChannel !== 'undefined') {
    liveBroadcastChannel = new BroadcastChannel('abouzekry_live_realtime_channel');
  }
} catch (e) {}

function findExistingItemTimestampForDeletion(category, normId) {
  let maxTs = 0;
  const strId = String(normId);
  try {
    if (category === 'sales' || category === 'pendingSales' || category === 'expenses') {
      const scanDays = (dMap) => {
        if (!dMap || typeof dMap !== 'object') return;
        for (let d = 1; d <= 10; d++) {
          const arr = dMap[d] && dMap[d][category];
          if (!Array.isArray(arr)) continue;
          arr.forEach(r => {
            if (r && String(r.id) === strId) {
              const t = Math.max(extractTimestampFromRecord(r), Number(r.importedAt) || 0);
              if (t > maxTs) maxTs = t;
            }
          });
        }
      };
      scanDays(appState.days);
      if (appState.farmsArchive && typeof appState.farmsArchive === 'object') {
        Object.values(appState.farmsArchive).forEach(arch => { if (arch && arch.days) scanDays(arch.days); });
      }
    } else if (category === 'merchants') {
      const m = (appState.merchants || []).find(x => x && Number(x.code) === Number(normId));
      if (m && Number(m.updatedAt) > maxTs) maxTs = Number(m.updatedAt);
    } else if (category === 'users') {
      const u = (appState.users || []).find(x => x && String(x.id) === strId);
      if (u && Number(u.updatedAt) > maxTs) maxTs = Number(u.updatedAt);
    }
  } catch (e) {}
  return maxTs;
}

function pruneDeletedTombstones(deletedIds, deletedTimestamps, maxPerCategory = 2000) {
  if (!deletedIds || typeof deletedIds !== 'object') return;
  const cats = ['sales', 'pendingSales', 'expenses', 'merchants', 'users', 'farms'];
  cats.forEach(cat => {
    if (!Array.isArray(deletedIds[cat])) deletedIds[cat] = [];
    const tsMap = (deletedTimestamps && deletedTimestamps[cat] && typeof deletedTimestamps[cat] === 'object')
      ? deletedTimestamps[cat]
      : {};
    if (deletedIds[cat].length > maxPerCategory) {
      const sorted = [...deletedIds[cat]].sort((a, b) => {
        const ta = Number(tsMap[String(a)]) || 0;
        const tb = Number(tsMap[String(b)]) || 0;
        return ta - tb;
      });
      const toKeep = sorted.slice(sorted.length - maxPerCategory);
      deletedIds[cat] = toKeep;
    }
    const activeSet = new Set(deletedIds[cat].map(String));
    Object.keys(tsMap).forEach(k => {
      if (!activeSet.has(String(k))) {
        delete tsMap[k];
      }
    });
  });
}

function recordDeletedItem(category, itemId, customTs = 0) {
  appState.deletedIds = ensureDeletedIdsStructure(appState.deletedIds);
  appState.deletedTimestamps = ensureDeletedTimestampsStructure(appState.deletedTimestamps);
  const list = appState.deletedIds[category];
  if (Array.isArray(list) && itemId !== undefined && itemId !== null && itemId !== '') {
    const normId = category === 'merchants' ? Number(itemId) : String(itemId);
    const existingItemTs = findExistingItemTimestampForDeletion(category, normId);
    const baseTs = Number(customTs) > 0 ? Number(customTs) : getSyncedNow();
    const monotonicDelTs = Math.max(baseTs, existingItemTs > 0 ? (existingItemTs + 1) : 0);
    if (!list.includes(normId)) {
      list.push(normId);
    }
    const tsMap = appState.deletedTimestamps[category];
    if (tsMap && typeof tsMap === 'object') {
      tsMap[String(normId)] = Math.max(Number(tsMap[String(normId)]) || 0, monotonicDelTs);
    }
    pruneDeletedTombstones(appState.deletedIds, appState.deletedTimestamps, 2000);
  }
}

function unrecordDeletedItem(category, itemId) {
  appState.deletedIds = ensureDeletedIdsStructure(appState.deletedIds);
  appState.deletedTimestamps = ensureDeletedTimestampsStructure(appState.deletedTimestamps);
  const list = appState.deletedIds[category];
  if (Array.isArray(list) && itemId !== undefined && itemId !== null) {
    const strId = String(itemId);
    appState.deletedIds[category] = list.filter(x => String(x) !== strId);
    if (appState.deletedTimestamps[category]) {
      delete appState.deletedTimestamps[category][strId];
    }
  }
}

// التحقق الفوري من صلاحية حساب المستخدم المتصل وتسجيل خروجه إجبارياً إذا حذفه المدير
function verifyActiveUserSession() {
  if (!appState.isLoggedIn) return true;
  const currentUid = appState.activeUserId;
  if (currentUid === 'admin') return true;

  appState.deletedIds = ensureDeletedIdsStructure(appState.deletedIds);
  const isDeletedInLog = !currentUid || currentUid === 'visitor' || appState.deletedIds.users.includes(currentUid);
  const stillExistsInUsers = Array.isArray(appState.users) && appState.users.some(u => u.id === currentUid && u.id !== 'visitor');

  if (isDeletedInLog || !stillExistsInUsers) {
    appState.isLoggedIn = false;
    appState.activeUserId = 'admin';
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(appState)); } catch (e) {}
    const loginOverlay = document.getElementById('loginGatewayOverlay');
    const loginErr = document.getElementById('loginErrorMsg');
    const dd = document.getElementById('headerUserDropdownMenu');
    if (dd) dd.classList.add('hidden');
    if (loginErr && currentUid !== 'visitor') {
      loginErr.textContent = '🚫 تم إنهاء جلستك وتسجيل خروجك تلقائياً نظراً لحذف هذا الحساب من قِبل مدير الموقع!';
      loginErr.classList.remove('hidden');
    }
    if (loginOverlay) loginOverlay.classList.remove('hidden');
    if (currentUid !== 'visitor') {
      showToast('🚫 تم تسجيل خروجك تلقائياً لأن مدير الموقع قام بحذف هذا الحساب!', '🚪');
    }
    return false;
  }
  return true;
}

function isUserActivelyTypingInForm() {
  const ae = document.activeElement;
  if (!ae || !ae.tagName) return false;
  if (ae.tagName === 'INPUT' || ae.tagName === 'SELECT' || ae.tagName === 'TEXTAREA') {
    const ignoreIds = ['inpFilterDailySales', 'inpFilterPendingSales', 'inpLiteFilterPendingCards', 'chkStickyTableHeaders', 'chkStickyTableFooters', 'chkStickyTableRightCols', 'chkStickyTableLeftCols', 'inpFilterDailyExpenses', 'inpDashQuickSearch', 'inpMerchQuickSearch', 'inpFilterTransfers', 'inpFilterPrevFarms', 'inpFilterExpSummary', 'inpFilterUsersList', 'inpFilterCloudFarms', 'inpFilterMerchantModal', 'selModalMerchantSwitcher', 'chkEnableLiveSync', 'selLiveSyncInterval', 'selTopCloudFarm', 'chkShowFloatingActionBar', 'chkShowAuditMetadata', 'inpFilterAuditTrail', 'selFilterAuditType'];
    if (!ignoreIds.includes(ae.id)) return true;
  }
  return false;
}

function renderAllPreservingActiveInputs(forceAllTabs = false) {
  if (!verifyActiveUserSession()) return;
  if (isUserActivelyTypingInForm()) {
    renderAll(forceAllTabs, true);
  } else {
    renderAll(forceAllTabs, false);
  }
}

// دمج جزئي عميق للسجلات (Deep Granular Record-Level Merge) بناءً على معرف الحركة (ID) مع دعم هامش اختلاف توقيت الأجهزة (Clock Skew Buffer)
function mergeArraysById(localArr, cloudArr, deletedList, idKey = 'id', preferCloudItem = true, isDuplicateFn = null) {
  const delSet = new Set((deletedList || []).map(String));
  const safeLocal = Array.isArray(localArr) ? localArr : [];
  const safeCloud = Array.isArray(cloudArr) ? cloudArr : [];
  const result = [];

  // دمج نسختين لنفس السجل (نفس الـ id) مع الاعتماد المباشر والحاسم على رقم إصدار التعديل (editVersion) ثم أحدث طابع زمني (updatedAt) بدون تعطيله بهامش CLOCK_SKEW_BUFFER_MS
  const mergeSameRecordVersions = (localItem, cloudItem) => {
    if (!localItem) return { ...cloudItem };
    if (!cloudItem) return { ...localItem };
    const lUpdated = extractTimestampFromRecord(localItem);
    const cUpdated = extractTimestampFromRecord(cloudItem);
    const lVer = Number(localItem.editVersion) || 0;
    const cVer = Number(cloudItem.editVersion) || 0;
    const lEdited = Boolean(localItem.isEdited);
    const cEdited = Boolean(cloudItem.isEdited);
    const lCreated = Number(localItem.createdAt) || lUpdated || 0;
    const cCreated = Number(cloudItem.createdAt) || cUpdated || 0;
    const earliestCreatedAt = (lCreated > 0 && cCreated > 0) ? Math.min(lCreated, cCreated) : (lCreated || cCreated || undefined);
    const origCreatedBy = (lCreated > 0 && cCreated > 0 && lCreated <= cCreated)
      ? (localItem.createdBy || cloudItem.createdBy)
      : (cloudItem.createdBy || localItem.createdBy);
    const origCreatedTimeTxt = (lCreated > 0 && cCreated > 0 && lCreated <= cCreated)
      ? (localItem.createdTimeTxt || cloudItem.createdTimeTxt)
      : (cloudItem.createdTimeTxt || localItem.createdTimeTxt);

    let localWins;
    if (lVer !== cVer) {
      localWins = lVer > cVer;
    } else if (lUpdated > 0 && cUpdated > 0 && lUpdated !== cUpdated) {
      localWins = lUpdated > cUpdated;
    } else if (lEdited !== cEdited) {
      localWins = lEdited;
    } else if (lUpdated > 0 && cUpdated === 0) {
      localWins = true;
    } else if (cUpdated > 0 && lUpdated === 0) {
      localWins = false;
    } else {
      localWins = !preferCloudItem;
    }

    const maxUpdated = Math.max(lUpdated, cUpdated);
    const maxVer = Math.max(lVer, cVer);
    const mergedObj = localWins
      ? { ...cloudItem, ...localItem, ...(maxUpdated > 0 ? { updatedAt: maxUpdated } : {}), ...(maxVer > 0 ? { editVersion: maxVer } : {}) }
      : { ...localItem, ...cloudItem, ...(maxUpdated > 0 ? { updatedAt: maxUpdated } : {}), ...(maxVer > 0 ? { editVersion: maxVer } : {}) };

    if (origCreatedBy) mergedObj.createdBy = origCreatedBy;
    if (earliestCreatedAt) mergedObj.createdAt = earliestCreatedAt;
    if (origCreatedTimeTxt) mergedObj.createdTimeTxt = origCreatedTimeTxt;

    // دمج وتوحيد سجل التعديلات التفصيلي (editHistory & lastEditDiffText) من النسختين دون ضياع أي تعديل سابق
    const lHist = Array.isArray(localItem.editHistory) ? localItem.editHistory : [];
    const cHist = Array.isArray(cloudItem.editHistory) ? cloudItem.editHistory : [];
    if (lHist.length > 0 || cHist.length > 0) {
      const seenKeys = new Set();
      const combinedHist = [...cHist, ...lHist].filter(h => {
        if (!h || !h.diffText) return false;
        const k = `${h.at || 0}_${h.by || ''}_${h.diffText}`;
        if (seenKeys.has(k)) return false;
        seenKeys.add(k);
        return true;
      }).sort((a, b) => (Number(a.at) || 0) - (Number(b.at) || 0));
      mergedObj.editHistory = combinedHist.slice(-20);
      if (!mergedObj.lastEditDiffText && mergedObj.editHistory.length > 0) {
        mergedObj.lastEditDiffText = mergedObj.editHistory[mergedObj.editHistory.length - 1].diffText;
      }
    }
    if (!mergedObj.lastEditDiffText) {
      const fallbackDiff = (localWins ? (localItem.lastEditDiffText || cloudItem.lastEditDiffText) : (cloudItem.lastEditDiffText || localItem.lastEditDiffText)) || '';
      if (fallbackDiff) mergedObj.lastEditDiffText = fallbackDiff;
    }
    return mergedObj;
  };

  const primaryArr = preferCloudItem ? safeCloud : safeLocal;
  const secondaryArr = preferCloudItem ? safeLocal : safeCloud;

  const upsertGranularItem = (item, isFromCloud) => {
    if (!item || item[idKey] === undefined || item[idKey] === null || item[idKey] === '') return;
    const k = String(item[idKey]);
    if (delSet.has(k)) return;

    // 1. البحث بمعرف الحركة الدقيق (ID) أولاً لضمان عدم ضياع أي حركة فريدة
    let existingIdx = result.findIndex(ex => ex && ex[idKey] !== undefined && String(ex[idKey]) === k);

    // 2. البحث بدالة التطابق الموضوعي (Duplicate Check) فقط إذا لم يتطابق المعرف
    if (existingIdx === -1 && typeof isDuplicateFn === 'function') {
      existingIdx = result.findIndex(ex => ex && isDuplicateFn(ex, item));
    }

    if (existingIdx === -1) {
      result.push({ ...item });
    } else {
      const existingItem = result[existingIdx];
      // استدعاء mergeSameRecordVersions دائماً بترتيب (localItem, cloudItem) الصحيح لضمان عدم انقلاب أولوية التعديل المحلي
      result[existingIdx] = isFromCloud
        ? mergeSameRecordVersions(existingItem, item)
        : mergeSameRecordVersions(item, existingItem);
    }
  };

  primaryArr.forEach(item => upsertGranularItem(item, preferCloudItem));
  secondaryArr.forEach(item => upsertGranularItem(item, !preferCloudItem));
  return result;
}

// بنية الدمج القائمة على المجموعات المراقبة (Observed-Remove Set / OR-Set Architecture):
// لا نقوم أبداً بالحذف الجماعي الأعمى للسجلات ذات المعرفات الفريدة (UUID) غير الموجودة في سجل المحذوفات (deletedIds)،
// مما يحمي حركات المندوبين بنسبة 100% ضد تأخر ساعة الهاتف (Clock Skew) أو التصفير القديم على جهاز آخر (Ghost Deletion).
function mergeDaysObjects(localDays, cloudDays, deletedIds, preferCloud, localResetAt = 0, cloudResetAt = 0) {
  const mergedDays = {};
  const lReset = Number(localResetAt) || 0;
  const cReset = Number(cloudResetAt) || 0;

  // تصفية السجلات القديمة فقط التي تفتقر لمعرف UUID وليس لها طابع زمني إذا كانت أقدم بشكل قاطع من تصفير صريح
  const filterLegacyPreClearItems = (arr, otherSideClearTs, delCategoryList) => {
    if (!Array.isArray(arr)) return [];
    if (!otherSideClearTs || otherSideClearTs <= 0) return arr;
    const delSet = new Set((delCategoryList || []).map(String));
    return arr.filter(item => {
      if (!item) return false;
      const idStr = item.id !== undefined ? String(item.id) : '';
      if (idStr && delSet.has(idStr)) return false;
      // السجلات المزودة بمعرف UUID فريد أو المستوردة حديثاً لا تُمسح أبداً بالتصفير الجماعي إلا إذا كان معرفها مسجلاً صراحةً في deletedIds!
      if (isCollisionProofUUID(idStr) || Number(item.importedAt) > 0) {
        return true;
      }
      const itemTs = extractTimestampFromRecord(item);
      if (itemTs > 0 && isTimestampSignificantlyNewer(otherSideClearTs, itemTs, CLOCK_SKEW_BUFFER_MS)) {
        if (idStr && Array.isArray(delCategoryList) && !delCategoryList.includes(idStr)) {
          delCategoryList.push(idStr);
        }
        return false;
      }
      return true;
    });
  };

  for (let d = 1; d <= 10; d++) {
    const defaultLbl = `اليوم ${d}`;
    const lDay = (localDays && localDays[d]) || { dayNumber: d, dateLabel: defaultLbl, sales: [], pendingSales: [], expenses: [], deliveredCash: 0, clearedAt: 0 };
    const cDay = (cloudDays && cloudDays[d]) || { dayNumber: d, dateLabel: defaultLbl, sales: [], pendingSales: [], expenses: [], deliveredCash: 0, clearedAt: 0 };
    const lDayClear = Math.max(lReset, Number(lDay.clearedAt) || 0);
    const cDayClear = Math.max(cReset, Number(cDay.clearedAt) || 0);

    const lAdded = getLatestDayActivityTimestamp(lDay, lDayClear);
    const cAdded = getLatestDayActivityTimestamp(cDay, cDayClear);
    const maxAdded = Math.max(lAdded, cAdded);
    const maxClear = Math.max(lDayClear, cDayClear);

    const safeLSales = filterLegacyPreClearItems(lDay.sales, cDayClear, deletedIds.sales);
    const safeLPending = filterLegacyPreClearItems(lDay.pendingSales, cDayClear, deletedIds.pendingSales);
    const safeLExpenses = filterLegacyPreClearItems(lDay.expenses, cDayClear, deletedIds.expenses);

    const safeCSales = filterLegacyPreClearItems(cDay.sales, lDayClear, deletedIds.sales);
    const safeCPending = filterLegacyPreClearItems(cDay.pendingSales, lDayClear, deletedIds.pendingSales);
    const safeCExpenses = filterLegacyPreClearItems(cDay.expenses, lDayClear, deletedIds.expenses);

    // الدمج الجزئي العميق للمصفوفات (Deep Granular Array Merging by UUID):
    // لا يتم استبدال مصفوفة sales أو pendingSales أو expenses بالكامل أبداً؛ بل تُدمج حركة بحركة بناءً على المعرف (id) وسجل deletedIds المصفّى
    const mergedSales = sortSalesListByScaleNo(
      mergeArraysById(safeLSales, safeCSales, deletedIds.sales, 'id', preferCloud, areSalesRowsDuplicate)
    );
    const mergedPending = sortSalesListByScaleNo(
      mergeArraysById(safeLPending, safeCPending, deletedIds.pendingSales, 'id', preferCloud, arePendingSalesDuplicate)
    );
    const mergedExpenses = mergeArraysById(
      safeLExpenses, safeCExpenses, deletedIds.expenses, 'id', preferCloud, areExpensesDuplicate
    );
    const hasAnyMovement = mergedSales.length > 0 || mergedPending.length > 0 || mergedExpenses.length > 0;
    const lHasMov = safeLSales.length > 0 || safeLPending.length > 0 || safeLExpenses.length > 0;
    const cHasMov = safeCSales.length > 0 || safeCPending.length > 0 || safeCExpenses.length > 0;

    // اختيار اسم/تاريخ اليوم بذكاء بناءً على الطابع الزمني للتسمية (labelUpdatedAt) مع تفضيل التسمية المخصصة عن الافتراضية
    const lLbl = String(lDay.dateLabel || '').trim() || defaultLbl;
    const cLbl = String(cDay.dateLabel || '').trim() || defaultLbl;
    const lLblTs = Number(lDay.labelUpdatedAt) || 0;
    const cLblTs = Number(cDay.labelUpdatedAt) || 0;
    let chosenLabel = (lLblTs > 0 || cLblTs > 0)
      ? (lLblTs > cLblTs ? lLbl : (cLblTs > lLblTs ? cLbl : (preferCloud ? cLbl : lLbl)))
      : (preferCloud ? cLbl : lLbl);
    if (chosenLabel === defaultLbl && (lLbl !== defaultLbl || cLbl !== defaultLbl)) {
      chosenLabel = cLbl !== defaultLbl ? cLbl : lLbl;
    }

    // اختيار النقدية المسلمة للخزينة والرصيد النقدي المرحّل للغد بذكاء بناءً على الطابع الزمني دون مسح قيم الأيام الأخرى أثناء الرفع أو السحب
    const lDeliv = Number(lDay.deliveredCash) || 0;
    const cDeliv = Number(cDay.deliveredCash) || 0;
    const lDelivTs = Number(lDay.deliveredCashUpdatedAt) || 0;
    const cDelivTs = Number(cDay.deliveredCashUpdatedAt) || 0;
    let chosenDeliveredCash = preferCloud ? cDeliv : lDeliv;
    if (lDelivTs > 0 || cDelivTs > 0) {
      chosenDeliveredCash = lDelivTs > cDelivTs ? lDeliv : (cDelivTs > lDelivTs ? cDeliv : (preferCloud ? cDeliv : lDeliv));
    } else if (!preferCloud && lDeliv === 0 && cDeliv > 0 && d !== Number(appState.currentDay)) {
      chosenDeliveredCash = cDeliv;
    } else if (preferCloud && cDeliv === 0 && lDeliv > 0) {
      chosenDeliveredCash = lDeliv;
    } else if (!preferCloud && cDeliv > 0 && lDeliv === 0 && !lHasMov && cHasMov) {
      chosenDeliveredCash = cDeliv;
    }

    const lCarry = Number(lDay.carriedForwardCash) || 0;
    const cCarry = Number(cDay.carriedForwardCash) || 0;
    const lCarryTs = Number(lDay.carriedForwardCashUpdatedAt) || 0;
    const cCarryTs = Number(cDay.carriedForwardCashUpdatedAt) || 0;
    let chosenCarriedForwardCash = preferCloud ? cCarry : lCarry;
    if (lCarryTs > 0 || cCarryTs > 0) {
      chosenCarriedForwardCash = lCarryTs > cCarryTs ? lCarry : (cCarryTs > lCarryTs ? cCarry : (preferCloud ? cCarry : lCarry));
    } else if (!preferCloud && lCarry === 0 && cCarry > 0 && d !== Number(appState.currentDay)) {
      chosenCarriedForwardCash = cCarry;
    } else if (preferCloud && cCarry === 0 && lCarry > 0) {
      chosenCarriedForwardCash = lCarry;
    } else if (!preferCloud && cCarry > 0 && lCarry === 0 && !lHasMov && cHasMov) {
      chosenCarriedForwardCash = cCarry;
    }

    const mergedIsHidden = hasAnyMovement
      ? false
      : (!isTimestampSignificantlyNewer(maxClear, maxAdded, CLOCK_SKEW_BUFFER_MS) && maxAdded > 0
        ? false
        : (preferCloud ? Boolean(cDay.isHidden) : Boolean(lDay.isHidden)));

    // دمج حالة إقفال واعتماد اليوم المحاسبي (Day Lock / Audit Seal) بناءً على أحدث طابع زمني للقفل (lockUpdatedAt)
    const lLockTs = Number(lDay.lockUpdatedAt) || 0;
    const cLockTs = Number(cDay.lockUpdatedAt) || 0;
    let chosenIsLocked = false;
    let chosenLockedBy = '';
    let chosenLockedAtTxt = '';
    if (lLockTs > 0 || cLockTs > 0) {
      const lLockWins = (lLockTs > cLockTs) || (lLockTs === cLockTs && !preferCloud);
      const winningLockDay = lLockWins ? lDay : cDay;
      chosenIsLocked = Boolean(winningLockDay.isLocked);
      chosenLockedBy = String(winningLockDay.lockedBy || '').trim();
      chosenLockedAtTxt = String(winningLockDay.lockedAtTxt || '').trim();
    } else {
      const winningLockDay = preferCloud ? cDay : lDay;
      chosenIsLocked = Boolean(winningLockDay.isLocked);
      chosenLockedBy = String(winningLockDay.lockedBy || '').trim();
      chosenLockedAtTxt = String(winningLockDay.lockedAtTxt || '').trim();
    }

    const mergedDayObj = {
      dayNumber: d,
      dateLabel: chosenLabel,
      labelUpdatedAt: Math.max(lLblTs, cLblTs),
      sales: mergedSales,
      pendingSales: mergedPending,
      expenses: mergedExpenses,
      deliveredCash: chosenDeliveredCash,
      deliveredCashUpdatedAt: Math.max(lDelivTs, cDelivTs),
      carriedForwardCash: chosenCarriedForwardCash,
      carriedForwardCashUpdatedAt: Math.max(lCarryTs, cCarryTs),
      isLocked: chosenIsLocked,
      lockedBy: chosenLockedBy,
      lockedAtTxt: chosenLockedAtTxt,
      lockUpdatedAt: Math.max(lLockTs, cLockTs),
      clearedAt: hasAnyMovement ? 0 : maxClear,
      addedAt: hasAnyMovement ? Math.max(maxAdded, maxClear + 1) : maxAdded,
      isHidden: mergedIsHidden
    };
    deduplicateDayRecords(mergedDayObj, deletedIds);
    mergedDays[d] = mergedDayObj;
  }
  return mergedDays;
}

// تطهير سجل المحذوفات (Anti-Ghost Tombstone Sanitizer):
// يمنع أي جهاز يحمل سجل محذوفات قديم (deletedIds) أو حالة تصفير سابقة من مسح البيانات الحديثة المستوردة من الإكسيل أو المحدثة على السحابة
function sanitizeMergedTombstonesAgainstLiveData(localState, cloudData, mergedDeletedIds, mergedDeletedTimestamps) {
  const localBulkTs = Number(localState && localState.lastBulkImportAt) || 0;
  const cloudBulkTs = Number(cloudData && cloudData.lastBulkImportAt) || 0;
  const localResetTs = Number(localState && localState.farmResetAt) || 0;
  const cloudResetTs = Number(cloudData && cloudData.farmResetAt) || 0;
  const localDel = ensureDeletedIdsStructure(localState && localState.deletedIds);
  const cloudDel = ensureDeletedIdsStructure(cloudData && cloudData.deletedIds);
  const localDelTsMap = ensureDeletedTimestampsStructure(localState && localState.deletedTimestamps);
  const cloudDelTsMap = ensureDeletedTimestampsStructure(cloudData && cloudData.deletedTimestamps);

  const localDelSets = {
    sales: new Set(localDel.sales.map(String)),
    pendingSales: new Set(localDel.pendingSales.map(String)),
    expenses: new Set(localDel.expenses.map(String))
  };
  const cloudDelSets = {
    sales: new Set(cloudDel.sales.map(String)),
    pendingSales: new Set(cloudDel.pendingSales.map(String)),
    expenses: new Set(cloudDel.expenses.map(String))
  };

  // جمع السجلات الحية وأحدث طابع زمني لكل معرف في كل من الجهاز المحلي والسحابة
  const collectLiveRecordsMeta = (daysMap, archiveMap, sideBulkTs) => {
    const meta = { sales: {}, pendingSales: {}, expenses: {} };
    const scanDays = (dMap, fBulkTs) => {
      if (!dMap || typeof dMap !== 'object') return;
      for (let d = 1; d <= 10; d++) {
        const dayObj = dMap[d];
        if (!dayObj || typeof dayObj !== 'object') continue;
        const dayAdded = Number(dayObj.addedAt) || 0;
        ['sales', 'pendingSales', 'expenses'].forEach(cat => {
          (dayObj[cat] || []).forEach(rec => {
            if (!rec || rec.id === undefined || rec.id === null) return;
            const idStr = String(rec.id);
            const ownRecTs = Math.max(extractTimestampFromRecord(rec), Number(rec.importedAt) || 0);
            const recTs = ownRecTs > 0 ? ownRecTs : Math.max(fBulkTs || 0, dayAdded || 0);
            const isImported = Boolean(Number(rec.importedAt) > 0 || (ownRecTs === 0 && fBulkTs > 0));
            if (!meta[cat][idStr] || recTs > meta[cat][idStr].ts) {
              meta[cat][idStr] = { ts: recTs, isImported };
            }
          });
        });
      }
    };
    scanDays(daysMap, sideBulkTs);
    if (archiveMap && typeof archiveMap === 'object') {
      Object.values(archiveMap).forEach(arch => {
        if (arch && arch.days) {
          scanDays(arch.days, Math.max(sideBulkTs, Number(arch.lastBulkImportAt) || 0));
        }
      });
    }
    return meta;
  };

  const cloudLive = collectLiveRecordsMeta(cloudData.days, cloudData.farmsArchive, cloudBulkTs);
  const localLive = collectLiveRecordsMeta(localState.days, localState.farmsArchive, localBulkTs);

  ['sales', 'pendingSales', 'expenses'].forEach(cat => {
    mergedDeletedIds[cat] = (mergedDeletedIds[cat] || []).filter(rawId => {
      const idStr = String(rawId);
      const inLocalDel = localDelSets[cat].has(idStr);
      const inCloudDel = cloudDelSets[cat].has(idStr);
      const lDelTs = Number(localDelTsMap[cat] && localDelTsMap[cat][idStr]) || 0;
      const cDelTs = Number(cloudDelTsMap[cat] && cloudDelTsMap[cat][idStr]) || 0;

      // الحالة أ: المعرف محذوف محلياً فقط (تاريخياً) لكنه موجود حيّاً في السحابة (ولم تحذفه السحابة)
      if (inLocalDel && !inCloudDel && cloudLive[cat][idStr]) {
        const cRec = cloudLive[cat][idStr];
        const effectiveLocalDelTs = lDelTs || localResetTs || 0;
        // 1) إذا تم استيراد بيانات السحابة من الإكسيل أو تحديث السجل في السحابة بعد وقت الحذف المحلي -> نبطل الحذف القديم فوراً!
        if (cRec.ts > 0 && effectiveLocalDelTs > 0 && cRec.ts > effectiveLocalDelTs) {
          delete mergedDeletedTimestamps[cat][idStr];
          return false;
        }
        // 2) إذا كان سجل الحذف المحلي قديماً بلا طابع زمني (effectiveLocalDelTs === 0) والسجل في السحابة مستورد من إكسيل أو له طابع زمني حديث -> نبطل الحذف الشبح!
        if (effectiveLocalDelTs === 0 && (cRec.isImported || cRec.ts > 0 || cloudBulkTs > 0)) {
          delete mergedDeletedTimestamps[cat][idStr];
          return false;
        }
      }

      // الحالة ب: المعرف محذوف في السحابة قديماً لكن تم إعادة استيراده أو تحديثه محلياً بوقت أحدث
      if (inCloudDel && !inLocalDel && localLive[cat][idStr]) {
        const lRec = localLive[cat][idStr];
        const effectiveCloudDelTs = cDelTs || cloudResetTs || 0;
        if (lRec.ts > 0 && effectiveCloudDelTs > 0 && lRec.ts > effectiveCloudDelTs) {
          delete mergedDeletedTimestamps[cat][idStr];
          return false;
        }
        if (effectiveCloudDelTs === 0 && (lRec.isImported || localBulkTs > 0)) {
          delete mergedDeletedTimestamps[cat][idStr];
          return false;
        }
      }

      return true;
    });
  });

  // تطهير شواهد قبور التجار والمستخدمين والمزارع ضد الحذف الشبح إذا أُعيدت إضافتها أو استيرادها بوقت أحدث (updatedAt > deletedAt)
  const localMerchDelSet = new Set(localDel.merchants.map(Number));
  const cloudMerchDelSet = new Set(cloudDel.merchants.map(Number));
  mergedDeletedIds.merchants = (mergedDeletedIds.merchants || []).filter(rawCode => {
    const codeNum = Number(rawCode);
    const idStr = String(codeNum);
    const inL = localMerchDelSet.has(codeNum);
    const inC = cloudMerchDelSet.has(codeNum);
    const lDelTs = Number(localDelTsMap.merchants && localDelTsMap.merchants[idStr]) || 0;
    const cDelTs = Number(cloudDelTsMap.merchants && cloudDelTsMap.merchants[idStr]) || 0;
    if (inL && !inC) {
      const cM = (cloudData.merchants || []).find(m => m && Number(m.code) === codeNum);
      const cMTs = Math.max(Number(cM && cM.updatedAt) || 0, cloudBulkTs);
      if (cM && ((lDelTs > 0 && cMTs > lDelTs) || (lDelTs === 0 && cloudBulkTs > 0))) {
        delete mergedDeletedTimestamps.merchants[idStr];
        return false;
      }
    }
    if (inC && !inL) {
      const lM = (localState.merchants || []).find(m => m && Number(m.code) === codeNum);
      const lMTs = Math.max(Number(lM && lM.updatedAt) || 0, localBulkTs);
      if (lM && ((cDelTs > 0 && lMTs > cDelTs) || (cDelTs === 0 && localBulkTs > 0))) {
        delete mergedDeletedTimestamps.merchants[idStr];
        return false;
      }
    }
    return true;
  });
}

function mergeCloudDataIntoLocal(cloudData, preferCloud = true) {
  if (!cloudData || !cloudData.days || !cloudData.merchants) return false;

  // معايرة ساعة الجهاز المحلي مع طابع وقت السحابة لتعويض أي تأخر في ساعة الهاتف (Clock Skew Calibration)
  if (cloudData.updatedAt) {
    calibrateCloudClockOffset(cloudData.updatedAt);
  }

  // 1. دمج سجل المحذوفات وطوابعها الزمنية من الجهازين ثم تطهيرها ضد الحذف الشبح (Ghost Deletion)
  const localDel = ensureDeletedIdsStructure(appState.deletedIds);
  const cloudDel = ensureDeletedIdsStructure(cloudData.deletedIds);
  const localDelTs = ensureDeletedTimestampsStructure(appState.deletedTimestamps);
  const cloudDelTs = ensureDeletedTimestampsStructure(cloudData.deletedTimestamps);

  const mergedDeletedTimestamps = {
    sales: { ...cloudDelTs.sales, ...localDelTs.sales },
    pendingSales: { ...cloudDelTs.pendingSales, ...localDelTs.pendingSales },
    expenses: { ...cloudDelTs.expenses, ...localDelTs.expenses },
    merchants: { ...cloudDelTs.merchants, ...localDelTs.merchants },
    users: { ...cloudDelTs.users, ...localDelTs.users },
    farms: { ...cloudDelTs.farms, ...localDelTs.farms }
  };
  ['sales', 'pendingSales', 'expenses', 'merchants', 'users', 'farms'].forEach(cat => {
    Object.keys(cloudDelTs[cat] || {}).forEach(k => {
      const a = Number(localDelTs[cat] && localDelTs[cat][k]) || 0;
      const b = Number(cloudDelTs[cat] && cloudDelTs[cat][k]) || 0;
      mergedDeletedTimestamps[cat][k] = Math.max(a, b);
    });
  });

  const mergedDeletedIds = {
    sales: Array.from(new Set([...localDel.sales, ...cloudDel.sales].map(String))),
    pendingSales: Array.from(new Set([...localDel.pendingSales, ...cloudDel.pendingSales].map(String))),
    expenses: Array.from(new Set([...localDel.expenses, ...cloudDel.expenses].map(String))),
    merchants: Array.from(new Set([...localDel.merchants, ...cloudDel.merchants].map(Number))),
    users: Array.from(new Set([...localDel.users, ...cloudDel.users].map(String))),
    farms: Array.from(new Set([...localDel.farms, ...cloudDel.farms].map(String)))
  };

  // تشغيل فلتر الحماية ضد الارتداد العكسي للحذف (Anti-Ghost Tombstone Sanitizer) وتقليم شواهد القبور القديمة قبل أي دمج
  sanitizeMergedTombstonesAgainstLiveData(appState, cloudData, mergedDeletedIds, mergedDeletedTimestamps);
  pruneDeletedTombstones(mergedDeletedIds, mergedDeletedTimestamps, 2000);

  appState.deletedIds = mergedDeletedIds;
  appState.deletedTimestamps = mergedDeletedTimestamps;

  // 2. دمج المستخدمين مع استبعاد حساب الزائر الملغى وأي حساب حذفه المدير فوراً
  if (Array.isArray(cloudData.users) && cloudData.users.length >= 1) {
    const mergedUsers = mergeArraysById(appState.users, cloudData.users, mergedDeletedIds.users, 'id', preferCloud);
    appState.users = mergedUsers.filter(u => u && u.id !== 'visitor' && (u.isSystem || !mergedDeletedIds.users.includes(u.id)));
    if (!appState.users.some(u => u.id === 'admin')) {
      appState.users.unshift(getDefaultState().users[0]);
    }
  }
  if (preferCloud && cloudData.inactivityTimeoutMin !== undefined && cloudData.inactivityTimeoutMin !== null) {
    appState.inactivityTimeoutMin = Math.max(0, Number(cloudData.inactivityTimeoutMin) || 0);
  }

  // 3. حفظ المزرعة المحلية الحالية في الأرشيف أولاً قبل الدمج حتى لا تضيع بيانات أي مزرعة أخرى
  syncActiveFarmIntoArchive();
  const localFactoryWipeAt = Number(appState.factoryZeroWipeAt) || 0;
  const cloudFactoryWipeAt = Number(cloudData.factoryZeroWipeAt) || 0;
  appState.factoryZeroWipeAt = Math.max(localFactoryWipeAt, cloudFactoryWipeAt);
  const isZeroWiped = (localFactoryWipeAt > 0 || cloudFactoryWipeAt > 0);
  const localFarmName = String(appState.farmName ?? '').trim() || (isZeroWiped ? '' : 'أبوذكري');
  const cloudFarmName = String(cloudData.farmName ?? '').trim() || localFarmName;
  const sameActiveFarm = (localFarmName === cloudFarmName);
  const rawLocalResetAt = Number(appState.farmResetAt) || 0;
  const rawCloudResetAt = Number(cloudData.farmResetAt) || 0;
  const localBulkImportAt = Number(appState.lastBulkImportAt) || 0;
  const cloudBulkImportAt = Number(cloudData.lastBulkImportAt) || 0;
  appState.lastBulkImportAt = Math.max(localBulkImportAt, cloudBulkImportAt);

  const countMovements = (daysMap) => {
    if (!daysMap || typeof daysMap !== 'object') return 0;
    let cnt = 0;
    for (let d = 1; d <= 10; d++) {
      const dm = daysMap[d];
      if (!dm) continue;
      cnt += (dm.sales ? dm.sales.length : 0) + (dm.pendingSales ? dm.pendingSales.length : 0) + (dm.expenses ? dm.expenses.length : 0);
    }
    return cnt;
  };
  const getMaxAddedAcrossDays = (daysMap, resetTs = 0) => {
    if (!daysMap || typeof daysMap !== 'object') return 0;
    let maxA = 0;
    for (let d = 1; d <= 10; d++) {
      const dm = daysMap[d];
      if (!dm) continue;
      const a = getLatestDayActivityTimestamp(dm, Math.max(resetTs, Number(dm.clearedAt) || 0));
      if (a > maxA) maxA = a;
    }
    return maxA;
  };

  const localMovementsCount = countMovements(appState.days);
  const cloudMovementsCount = countMovements(cloudData.days);
  const cloudMaxAddedAt = Math.max(getMaxAddedAcrossDays(cloudData.days, rawCloudResetAt), cloudBulkImportAt);
  const localMaxAddedAt = Math.max(getMaxAddedAcrossDays(appState.days, rawLocalResetAt), localBulkImportAt);

  // إبطال أي تصفير قديم (Stale Reset Neutralization) إذا كانت هناك بيانات مستوردة أو مضافة أحدث منه على الطرف الآخر
  const localResetAt = (rawLocalResetAt > 0 && cloudMovementsCount > 0 && (cloudBulkImportAt >= rawLocalResetAt || cloudMaxAddedAt >= rawLocalResetAt))
    ? 0
    : rawLocalResetAt;
  const cloudResetAt = (rawCloudResetAt > 0 && localMovementsCount > 0 && (localBulkImportAt >= rawCloudResetAt || localMaxAddedAt >= rawCloudResetAt))
    ? 0
    : rawCloudResetAt;

  // 4. دمج أرشيف المزارع المتعددة ذرياً (mergeFarmSnapshots) مع فصل قاعدة بيانات كل مزرعة على حدة ودمج أيامها بالمعرفات
  const mergeFarmSnapshots = (lArch, cArch, fKey) => {
    if (!lArch || !lArch.days) return cArch;
    if (!cArch || !cArch.days) return lArch;
    const lArchBulk = Number(lArch.lastBulkImportAt) || 0;
    const cArchBulk = Number(cArch.lastBulkImportAt) || 0;
    const rawLArchReset = Number(lArch.farmResetAt) || 0;
    const rawCArchReset = Number(cArch.farmResetAt) || 0;
    const lArchMovCnt = countMovements(lArch.days);
    const cArchMovCnt = countMovements(cArch.days);
    const lArchMaxAdded = Math.max(getMaxAddedAcrossDays(lArch.days, rawLArchReset), lArchBulk);
    const cArchMaxAdded = Math.max(getMaxAddedAcrossDays(cArch.days, rawCArchReset), cArchBulk);
    const lArchReset = (rawLArchReset > 0 && cArchMovCnt > 0 && (cArchBulk >= rawLArchReset || cArchMaxAdded >= rawLArchReset)) ? 0 : rawLArchReset;
    const cArchReset = (rawCArchReset > 0 && lArchMovCnt > 0 && (lArchBulk >= rawCArchReset || lArchMaxAdded >= rawCArchReset)) ? 0 : rawCArchReset;
    const lUpdMs = Date.parse(String(lArch.updatedAt || '')) || lArchMaxAdded || 0;
    const cUpdMs = Date.parse(String(cArch.updatedAt || '')) || cArchMaxAdded || 0;
    const cWinsMeta = (cUpdMs > lUpdMs) || (cUpdMs === lUpdMs && preferCloud);
    const mergedArchDays = mergeDaysObjects(lArch.days, cArch.days, mergedDeletedIds, preferCloud, lArchReset, cArchReset);
    const archMovAfterMerge = countMovements(mergedArchDays);
    const visSet = new Set([
      ...(Array.isArray(lArch.visibleDays) ? lArch.visibleDays : [1]),
      ...(Array.isArray(cArch.visibleDays) ? cArch.visibleDays : [1])
    ]);
    for (let d = 1; d <= 10; d++) {
      const dm = mergedArchDays[d];
      if (dm && ((dm.sales && dm.sales.length > 0) || (dm.pendingSales && dm.pendingSales.length > 0) || (dm.expenses && dm.expenses.length > 0))) {
        visSet.add(d);
      }
    }
    const mergedVisDays = Array.from(visSet).filter(d => d >= 1 && d <= 10 && !(mergedArchDays[d] && mergedArchDays[d].isHidden)).sort((a, b) => a - b);
    return {
      ...lArch,
      ...cArch,
      farmName: fKey,
      updatedAt: new Date(Math.max(lUpdMs, cUpdMs, getSyncedNow())).toISOString(),
      farmResetAt: archMovAfterMerge > 0 ? 0 : Math.max(lArchReset, cArchReset),
      lastBulkImportAt: Math.max(lArchBulk, cArchBulk),
      visibleDays: mergedVisDays.length > 0 ? mergedVisDays : [1],
      defaultPrice: cWinsMeta ? (Number(cArch.defaultPrice) || Number(lArch.defaultPrice) || 0) : (Number(lArch.defaultPrice) || Number(cArch.defaultPrice) || 0),
      defaultTip: cWinsMeta ? (Number(cArch.defaultTip) || Number(lArch.defaultTip) || 0) : (Number(lArch.defaultTip) || Number(cArch.defaultTip) || 0),
      lastScaleNo: Math.max(Number(lArch.lastScaleNo) || 0, Number(cArch.lastScaleNo) || 0),
      merchants: mergeArraysById(lArch.merchants || [], cArch.merchants || [], mergedDeletedIds.merchants, 'code', preferCloud),
      days: mergedArchDays
    };
  };

  const mergedArchive = { ...(appState.farmsArchive || {}) };
  if (cloudData.farmsArchive && typeof cloudData.farmsArchive === 'object') {
    Object.keys(cloudData.farmsArchive).forEach(fKey => {
      const cArch = cloudData.farmsArchive[fKey];
      const lArch = mergedArchive[fKey];
      if (lArch && lArch.days && cArch && cArch.days) {
        mergedArchive[fKey] = mergeFarmSnapshots(lArch, cArch, fKey);
      } else if (cArch) {
        mergedArchive[fKey] = cArch;
      }
    });
  }
  mergedDeletedIds.farms.forEach(fn => { delete mergedArchive[fn]; });
  appState.farmsArchive = mergedArchive;

  // المتصفح يُعتبر جديداً/فارغاً فقط إذا لم يكن لديه تعديلات أو حذف محلي معلّق، وكان عدد حركاته المحلية = 0 تماماً
  const hasRecentLocalDeletions = Boolean(
    appState.hasLocalEdits && (
      localDel.sales.length > 0 ||
      localDel.pendingSales.length > 0 ||
      localDel.expenses.length > 0 ||
      Number(appState.pendingChanges) > 0
    )
  );
  const archiveFarmsCount = Object.keys(appState.farmsArchive || {}).length;
  // لا نعتبر المتصفح جديداً/فارغاً إذا كان المستخدم يمتلك أرشيف مزارع متعددة أو قام بالتبديل اليدوي بين المزارع!
  const isLocalEffectivelyFresh = (localMovementsCount === 0) && !hasRecentLocalDeletions && archiveFarmsCount <= 1 && !Number(appState.lastFarmSwitchAt) && (
    !appState.hasLocalEdits ||
    localResetAt === 0 ||
    (cloudMovementsCount > 0 && !isTimestampSignificantlyNewer(localResetAt, Math.max(cloudResetAt, cloudMaxAddedAt), CLOCK_SKEW_BUFFER_MS))
  );

  if (isLocalEffectivelyFresh && !appState.hasLocalEdits && cloudMovementsCount > 0) {
    // تنظيف سجل المحذوفات المحلي للمتصفح الجديد الذي لم يجرِ أي تعديلات محلية من أي معرفات موجودة فعلياً في السحابة
    for (let d = 1; d <= 10; d++) {
      const cd = cloudData.days && cloudData.days[d];
      if (!cd) continue;
      const cSaleIds = new Set((cd.sales || []).map(r => r && r.id !== undefined ? String(r.id) : ''));
      const cPendIds = new Set((cd.pendingSales || []).map(r => r && r.id !== undefined ? String(r.id) : ''));
      const cExpIds = new Set((cd.expenses || []).map(e => e && e.id !== undefined ? String(e.id) : ''));
      mergedDeletedIds.sales = mergedDeletedIds.sales.filter(id => !cSaleIds.has(String(id)));
      mergedDeletedIds.pendingSales = mergedDeletedIds.pendingSales.filter(id => !cPendIds.has(String(id)));
      mergedDeletedIds.expenses = mergedDeletedIds.expenses.filter(id => !cExpIds.has(String(id)));
    }
    appState.deletedIds = mergedDeletedIds;
  }

  if (isLocalEffectivelyFresh) {
    // متصفح جديد أو فارغ يسحب من السحابة مع استخدام الدمج الجزئي بالمعرفات (mergeDaysObjects & mergeArraysById) لضمان عدم ضياع أي عنصر
    appState.farmName = cloudFarmName;
    appState.farmResetAt = cloudResetAt;
    appState.merchants = mergeArraysById(appState.merchants, cloudData.merchants, mergedDeletedIds.merchants, 'code', true)
      .sort((a, b) => Number(a.code) - Number(b.code));
    appState.days = mergeDaysObjects(appState.days, cloudData.days, mergedDeletedIds, true, 0, cloudResetAt);
    appState.visibleDays = Array.isArray(cloudData.visibleDays) && cloudData.visibleDays.length > 0 ? [...cloudData.visibleDays] : [1];
    appState.defaultPrice = cloudData.defaultPrice !== undefined ? Number(cloudData.defaultPrice) : 0;
    appState.defaultTip = cloudData.defaultTip !== undefined ? Number(cloudData.defaultTip) : 0;
    appState.lastScaleNo = cloudData.lastScaleNo !== undefined ? Number(cloudData.lastScaleNo) : 0;
  } else if (sameActiveFarm) {
    // الجهازان يعملان على نفس المزرعة النشطة: دمج جزئي عميق للسجلات والأسعار مع احترام هامش اختلاف التوقيت
    const mergedDaysResult = mergeDaysObjects(appState.days, cloudData.days, mergedDeletedIds, preferCloud, localResetAt, cloudResetAt);
    const totalMovAfterMerge = countMovements(mergedDaysResult);
    appState.farmResetAt = totalMovAfterMerge > 0 ? 0 : Math.max(localResetAt, cloudResetAt);
    appState.merchants = mergeArraysById(appState.merchants, cloudData.merchants, mergedDeletedIds.merchants, 'code', preferCloud)
      .sort((a, b) => Number(a.code) - Number(b.code));
    appState.days = mergedDaysResult;

    if (isTimestampSignificantlyNewer(localResetAt, Math.max(cloudResetAt, cloudMaxAddedAt), CLOCK_SKEW_BUFFER_MS) && totalMovAfterMerge === 0) {
      appState.visibleDays = getVisibleDays();
    } else if (isTimestampSignificantlyNewer(cloudResetAt, Math.max(localResetAt, localMaxAddedAt), CLOCK_SKEW_BUFFER_MS) && totalMovAfterMerge === 0) {
      appState.visibleDays = Array.isArray(cloudData.visibleDays) && cloudData.visibleDays.length > 0 ? [...cloudData.visibleDays] : [1];
      appState.defaultPrice = Number(cloudData.defaultPrice) || 0;
      appState.defaultTip = Number(cloudData.defaultTip) || 0;
      appState.lastScaleNo = Number(cloudData.lastScaleNo) || 0;
    } else {
      const visSet = new Set([
        ...(Array.isArray(appState.visibleDays) ? appState.visibleDays : [1]),
        ...(Array.isArray(cloudData.visibleDays) ? cloudData.visibleDays : [1])
      ]);
      for (let d = 1; d <= 10; d++) {
        const dm = appState.days[d];
        if (dm && ((dm.sales && dm.sales.length > 0) || (dm.pendingSales && dm.pendingSales.length > 0) || (dm.expenses && dm.expenses.length > 0))) {
          visSet.add(d);
        }
      }
      appState.visibleDays = Array.from(visSet).filter(d => !(appState.days[d] && appState.days[d].isHidden)).sort((a, b) => a - b);
      getVisibleDays();

      if (cloudData.defaultPrice !== undefined && (preferCloud || !Number(appState.defaultPrice))) {
        appState.defaultPrice = Number(cloudData.defaultPrice) || Number(appState.defaultPrice) || 0;
      }
      if (cloudData.defaultTip !== undefined && (preferCloud || !Number(appState.defaultTip))) {
        appState.defaultTip = Number(cloudData.defaultTip) || Number(appState.defaultTip) || 0;
      }
      if (cloudData.lastScaleNo !== undefined) {
        appState.lastScaleNo = Math.max(Number(appState.lastScaleNo) || 0, Number(cloudData.lastScaleNo) || 0);
      }
    }
  } else {
    // السحابة تشير لمزرعة مختلفة: ندمج قائمة التجار الموحدة عالمياً لجميع المزارع، وندمج حركات مزرعة السحابة جزئياً بالمعرفات في أرشيفها المستقل
    appState.merchants = mergeArraysById(appState.merchants, cloudData.merchants, mergedDeletedIds.merchants, 'code', preferCloud)
      .sort((a, b) => Number(a.code) - Number(b.code));
    const existingCloudArch = (appState.farmsArchive && appState.farmsArchive[cloudFarmName]) || null;
    const incomingCloudArch = {
      farmName: cloudFarmName,
      updatedAt: cloudData.updatedAt || new Date(getSyncedNow()).toISOString(),
      farmResetAt: cloudResetAt,
      lastBulkImportAt: cloudBulkImportAt,
      visibleDays: Array.isArray(cloudData.visibleDays) ? cloudData.visibleDays : [1],
      defaultPrice: cloudData.defaultPrice !== undefined ? Number(cloudData.defaultPrice) : 0,
      defaultTip: cloudData.defaultTip !== undefined ? Number(cloudData.defaultTip) : 0,
      lastScaleNo: cloudData.lastScaleNo !== undefined ? Number(cloudData.lastScaleNo) : 0,
      merchants: JSON.parse(JSON.stringify(appState.merchants)),
      days: cloudData.days
    };
    appState.farmsArchive[cloudFarmName] = existingCloudArch
      ? mergeFarmSnapshots(existingCloudArch, incomingCloudArch, cloudFarmName)
      : incomingCloudArch;
    // Also merge our currently active local farm with its counterpart inside cloudData.farmsArchive (if present) so its data stays 100% up-to-date without switching away from it!
    if (cloudData.farmsArchive && cloudData.farmsArchive[localFarmName] && appState.farmsArchive[localFarmName]) {
      const mergedActiveSnap = mergeFarmSnapshots(appState.farmsArchive[localFarmName], cloudData.farmsArchive[localFarmName], localFarmName);
      appState.farmsArchive[localFarmName] = mergedActiveSnap;
      appState.days = JSON.parse(JSON.stringify(mergedActiveSnap.days || appState.days));
      appState.visibleDays = Array.isArray(mergedActiveSnap.visibleDays) && mergedActiveSnap.visibleDays.length > 0 ? [...mergedActiveSnap.visibleDays] : [1];
    }
    // Never hijack or overwrite the user's active farm selection during background sync if the user has local edits or multiple farms in archive!
    const userExplicitlySelectedFarm = Boolean(appState.hasLocalEdits || Number(appState.lastFarmSwitchAt) > 0 || Object.keys(appState.farmsArchive || {}).length > 1);
    if (preferCloud && !userExplicitlySelectedFarm && !mergedDeletedIds.farms.includes(cloudFarmName)) {
      activateFarmFromArchive(cloudFarmName);
    }
  }
  deduplicateAllDaysInState(appState);
  syncActiveFarmIntoArchive();
  if (cloudData.updatedAt) appState.updatedAt = cloudData.updatedAt;
  appState.hasLocalEdits = true;
  return true;
}

async function pushDatabaseToCloud(silent = false, forcePush = false, skipPreFetchMerge = false) {
  if (isCloudSyncInProgress && !forcePush) return false;
  syncActiveFarmIntoArchive();
  const url = (appState.webhookUrl || getEmbeddedWebhookUrl() || '').trim();
  if (!navigator.onLine) {
    if (!silent) showToast('أنت في وضع الأوفلاين — تم حفظ البيانات على المتصفح وستُرفع للسحابة تلقائياً فور توفر الإنترنت.', '🟠');
    return false;
  }
  if (!url) {
    appState.pendingChanges = 0;
    appState.lastExcelSync = `محفوظ محلياً (${new Date().toLocaleTimeString('ar-EG')}) — غير مربوط بالسحابة بعد`;
    saveState(false);
    if (!silent) showToast('⚠️ تم الحفظ على هذا المتصفح فقط! لمشاركة البيانات بين المتصفحات، الصق رابط السحابة في تبويب (⚙️ التحكم والمزامنة).', '⚠️');
    return true;
  }
  const isFirebase = url.includes('firebaseio.com') || url.includes('firebasedatabase.app');
  if (!isFirebase && url.includes('script.google.com') && !url.endsWith('/exec')) {
    if (!silent) showToast('❌ خطأ في الرابط: رابط Google Apps Script يجب أن ينتهي بـ /exec (من قائمة Deploy -> Web app)!', '❌');
    return false;
  }

  // حماية صارمة ضد مسح السحابة بالبيانات الافتراضية من متصفح جديد لم يجرِ تعديلات، مع السماح برفع الحذف الفردي إذا حذف المستخدم آخر حركة!
  const localMovCntNow = countMovementsInDays(appState.days);
  const hasRecordedDeletions = Boolean(
    appState.deletedIds && (
      (appState.deletedIds.sales && appState.deletedIds.sales.length > 0) ||
      (appState.deletedIds.pendingSales && appState.deletedIds.pendingSales.length > 0) ||
      (appState.deletedIds.expenses && appState.deletedIds.expenses.length > 0) ||
      (appState.deletedIds.merchants && appState.deletedIds.merchants.length > 0) ||
      (appState.deletedIds.users && appState.deletedIds.users.length > 0) ||
      (appState.deletedIds.farms && appState.deletedIds.farms.length > 0)
    )
  );
  const isExplicitFarmReset = Boolean(skipPreFetchMerge && Number(appState.farmResetAt) > 0 && localMovCntNow === 0);
  if (!isExplicitFarmReset && (!appState.hasLocalEdits || (localMovCntNow === 0 && Number(appState.farmResetAt) === 0 && !hasRecordedDeletions && Number(appState.pendingChanges) === 0))) {
    const pulled = await pullDatabaseFromCloud(silent, true);
    if (pulled && countMovementsInDays(appState.days) > 0) {
      return true;
    }
  }

  isCloudSyncInProgress = true;
  try {
    const baseEndpoint = isFirebase ? (url.replace(/\/$/, '') + '/abouzekry_cloud_db.json') : url;

    // سحب ودمج آخر تحديثات الأجهزة الأخرى قبل الرفع (قفل أمان ذري Atomic Read-Modify-Write) مع إعطاء الأولوية الصارمة للتعديلات المحلية (preferCloud = false):
    if (!skipPreFetchMerge) {
      try {
        const sep = baseEndpoint.includes('?') ? '&' : '?';
        const preEndpoint = `${baseEndpoint}${sep}_t=${Date.now()}`;
        const preRes = await fetch(preEndpoint, { method: 'GET', redirect: 'follow', cache: 'no-store' });
        if (!preRes.ok) {
          throw new Error(`HTTP ${preRes.status}`);
        }
        const preText = await preRes.text();
        if (preText && preText.trim() !== '{}' && preText.trim() !== 'null') {
          const remoteData = JSON.parse(preText);
          if (remoteData && remoteData.days && remoteData.merchants) {
            // نعطي الأولوية دائماً للتعديلات المحلية أثناء خطوة الجلب المسبق داخل الرفع (preferCloud = false) لمنع ارتداد التعديلات
            mergeCloudDataIntoLocal(remoteData, false);
            renderAllPreservingActiveInputs();
          }
        }
      } catch (preErr) {
        if (!silent) showToast('⏳ الشبكة غير مستقرة حالياً — تم تأجيل الرفع التلقائي لحين استقرار الاتصال لمنع الكتابة فوق حركات المندوبين الآخرين.', '🟠');
        return false;
      }
    }

    const method = isFirebase ? 'PUT' : 'POST';
    const nowIso = new Date(getSyncedNow()).toISOString();
    appState.updatedAt = nowIso;

    // تقليل حجم البيانات المرسلة بعدم تكرار المزرعة الحالية داخل الأرشيف أثناء الإرسال
    const compactArchive = {};
    if (appState.farmsArchive && typeof appState.farmsArchive === 'object') {
      Object.keys(appState.farmsArchive).forEach(k => {
        if (k !== appState.farmName) {
          compactArchive[k] = appState.farmsArchive[k];
        }
      });
    }

    const payloadStr = JSON.stringify({
      updatedAt: nowIso,
      hasLocalEdits: true,
      farmName: appState.farmName,
      lastFarmSwitchAt: Number(appState.lastFarmSwitchAt) || 0,
      farmResetAt: Number(appState.farmResetAt) || 0,
      factoryZeroWipeAt: Number(appState.factoryZeroWipeAt) || 0,
      lastBulkImportAt: Number(appState.lastBulkImportAt) || 0,
      currentDay: appState.currentDay,
      visibleDays: appState.visibleDays,
      defaultPrice: appState.defaultPrice,
      defaultTip: appState.defaultTip,
      lastScaleNo: appState.lastScaleNo,
      inactivityTimeoutMin: appState.inactivityTimeoutMin,
      deletedIds: ensureDeletedIdsStructure(appState.deletedIds),
      deletedTimestamps: ensureDeletedTimestampsStructure(appState.deletedTimestamps),
      users: appState.users,
      merchants: appState.merchants,
      days: appState.days,
      farmsArchive: compactArchive
    });

    const res = await fetch(baseEndpoint, {
      method,
      redirect: 'follow',
      headers: {
        'Content-Type': isFirebase ? 'application/json' : 'text/plain;charset=utf-8'
      },
      body: payloadStr
    });
    const resText = await res.text();
    if (!isFirebase) {
      let parsedRes = null;
      try { parsedRes = JSON.parse(resText); } catch (e) {}
      if (!parsedRes || (parsedRes.status !== 'ok' && !parsedRes.days)) {
        if (resText.includes('Argument too large')) {
          if (!silent) showToast('❌ السكربت القديم في جوجل لا يدعم هذا الحجم! انسخ كود السحابة المطور الجديد من الزر الأزرق وانشره كـ New version.', '❌');
        } else {
          if (!silent) showToast('❌ لم يقبل سكربت جوجل الحفظ! تأكد من نشر السكربت بصلاحية (Who has access: Anyone) واختيار (New version).', '❌');
        }
        return false;
      }
    }
    appState.pendingChanges = 0;
    appState.lastExcelSync = `مزامنة حية مؤكدة ✓ (${new Date().toLocaleTimeString('ar-EG')})`;
    saveState(false);
    if (liveBroadcastChannel) {
      try { liveBroadcastChannel.postMessage({ type: 'STATE_UPDATED', updatedAt: nowIso }); } catch (e) {}
    }
    verifyActiveUserSession();
    if (!silent) showToast('✅ تم دمج ورفع وحفظ جميع التعديلات والموازين في السحابة بنجاح!', '☁️');
    return true;
  } catch (err) {
    if (!silent) showToast('⚠️ تعذر الاتصال بالسحابة، تأكد من اتصال الإنترنت ومن إعداد (Who has access: Anyone) في السكربت.', '🟠');
    return false;
  } finally {
    isCloudSyncInProgress = false;
  }
}

async function pullDatabaseFromCloud(silent = false, skipPushIfEmpty = false, isLiveBackgroundTick = false) {
  // منع التداخل (Race Condition) بين الرفع/التعديل المحلي والنبض الخلفي: إيقاف السحب الخلفي أثناء الرفع أو لمدة 10 ثوانٍ بعد أي تعديل محلي أو عند وجود تعديلات معلقة
  if (isLiveBackgroundTick) {
    if (isCloudSyncInProgress) return false;
    if (Number(appState.pendingChanges) > 0) return false;
    if (lastLocalMutationAt > 0 && (Date.now() - lastLocalMutationAt < 10000)) return false;
  }
  const url = (appState.webhookUrl || getEmbeddedWebhookUrl() || '').trim();
  if (!url) {
    if (!silent) showToast('⚠️ الصق رابط السحابة (Google Apps Script URL) أولاً ثم اضغط حفظ وسحب من السحابة!', 'ℹ️');
    return false;
  }
  if (!navigator.onLine) {
    if (!silent) showToast('لا يوجد اتصال بالإنترنت حالياً للسحب من السحابة.', '🟠');
    return false;
  }
  const pullStartEpoch = localMutationEpoch;
  try {
    const isFirebase = url.includes('firebaseio.com') || url.includes('firebasedatabase.app');
    const baseEndpoint = isFirebase ? (url.replace(/\/$/, '') + '/abouzekry_cloud_db.json') : url;
    const sep = baseEndpoint.includes('?') ? '&' : '?';

    // إذا كانت نبضة خلفية سريعة على Google Apps Script، يمكننا جلب التحديثات ومقارنة بصمة الوقت
    const endpoint = `${baseEndpoint}${sep}_t=${Date.now()}`;
    const res = await fetch(endpoint, { method: 'GET', redirect: 'follow', cache: 'no-store' });
    const text = await res.text();
    // إذا قام المستخدم بتصفير المزرعة أو استيراد إكسيل أو تعديل محلي أثناء انتظار رد الشبكة (أو خلال 10 ثوانٍ)، نتجاهل الرد القديم فوراً
    if (isLiveBackgroundTick && (localMutationEpoch !== pullStartEpoch || isCloudSyncInProgress || Number(appState.pendingChanges) > 0 || (lastLocalMutationAt > 0 && (Date.now() - lastLocalMutationAt < 10000)))) {
      return false;
    }
    if (!text || text.trim() === '{}' || text.trim() === 'null') {
      if (!skipPushIfEmpty) {
        await pushDatabaseToCloud(silent, true);
      }
      return false;
    }
    const data = JSON.parse(text);
    if (data && data.days && data.merchants) {
      // في وضع النبض اللحظي الخلفي، إذا لم تتغير بصمة السحابة وكان الحساب سارياً، لا نعيد الرسم بدون داعٍ
      const prevUpdatedAt = appState.updatedAt;
      const hadUnsyncedLocalChanges = (Number(appState.pendingChanges) > 0);
      mergeCloudDataIntoLocal(data, !hadUnsyncedLocalChanges);
      if (hadUnsyncedLocalChanges && navigator.onLine) {
        saveState(false);
        pushDatabaseToCloud(true, true, true);
      } else {
        appState.pendingChanges = 0;
        appState.lastExcelSync = `متزامن لحظياً ✓ (${new Date().toLocaleTimeString('ar-EG')})`;
        saveState(false);
      }

      // تحقق فوري مما إذا كان المدير قد حذف حساب المستخدم الحالي المتصل!
      if (!verifyActiveUserSession()) {
        return true;
      }

      if (!isLiveBackgroundTick || data.updatedAt !== prevUpdatedAt) {
        renderAllPreservingActiveInputs();
      }
      if (!silent) showToast(`✅ تم سحب ودمج أحدث التعديلات والموازين من السحابة لمزرعة (${appState.farmName}) بنجاح!`, '☁️');
      return true;
    } else {
      if (!silent) showToast('⚠️ السحابة فارغة حالياً أو لم يتم رفع تعديلات إليها بعد.', 'ℹ️');
    }
  } catch (err) {
    if (!silent) showToast('❌ تعذر قراءة بيانات السحابة! تأكد أن الرابط ينتهي بـ /exec ومنشور بصلاحية (Anyone).', '⚠️');
  }
  return false;
}

function updateLiveSyncIndicatorsUI() {
  const enabled = Boolean(appState.liveSyncEnabled);
  const intervalSec = Number(appState.liveSyncIntervalSec) || 5;
  const hasUrl = Boolean((appState.webhookUrl || getEmbeddedWebhookUrl() || '').trim());
  const btn = document.getElementById('btnToggleLiveSync');
  const dot = document.getElementById('liveSyncHeaderDot');
  const txt = document.getElementById('liveSyncHeaderTxt');
  const chk = document.getElementById('chkEnableLiveSync');
  const sel = document.getElementById('selLiveSyncInterval');
  const badge = document.getElementById('liveSyncEngineBadge');

  if (chk) chk.checked = enabled;
  if (sel) sel.value = String(intervalSec);

  if (btn && dot && txt) {
    if (enabled) {
      btn.className = 'px-2 md:px-2.5 py-0.5 md:py-1 rounded-lg bg-emerald-600/90 hover:bg-emerald-500 text-white font-extrabold text-[11px] md:text-xs transition flex items-center gap-1 md:gap-1.5 shadow-sm border border-emerald-300/50';
      dot.className = 'w-1.5 h-1.5 md:w-2 md:h-2 rounded-full bg-amber-300 animate-ping';
      txt.innerHTML = hasUrl
        ? `<span>⚡</span><span class="hidden md:inline"> مباشر (${intervalSec}ث)</span><span class="md:hidden">${intervalSec}ث</span>`
        : `<span>⚡</span><span class="hidden md:inline"> مباشر (محلي)</span>`;
    } else {
      btn.className = 'px-2 md:px-2.5 py-0.5 md:py-1 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 font-bold text-[11px] md:text-xs transition flex items-center gap-1 md:gap-1.5 shadow-sm border border-slate-500';
      dot.className = 'w-1.5 h-1.5 md:w-2 md:h-2 rounded-full bg-slate-400';
      txt.innerHTML = `<span>⏸️</span><span class="hidden md:inline"> مباشر متوقف</span>`;
    }
  }
  if (badge) {
    if (!enabled) {
      badge.textContent = '⏸️ المزامنة اللحظية متوقفة مؤقتاً (تعمل المزامنة اليدوية وعند الحفظ)';
      badge.className = 'text-[11px] font-extrabold text-slate-700 bg-slate-100 px-2.5 py-0.5 rounded-full border border-slate-300';
    } else if (hasUrl) {
      const isFb = (appState.webhookUrl || getEmbeddedWebhookUrl() || '').includes('firebase');
      badge.textContent = isFb
        ? '⚡ بث لحظي حي عبر Firebase Stream + دمج ذكي للسجلات ✓'
        : `⚡ مزامنة لحظية حية نشطة (كل ${intervalSec} ثوانٍ) + دمج ذكي متوافق مع السحابة ✓`;
      badge.className = 'text-[11px] font-extrabold text-emerald-900 bg-white px-2.5 py-0.5 rounded-full border border-emerald-300';
    } else {
      badge.textContent = '⚡ مزامنة لحظية عبر التبويبات نشطة (الصق رابط السحابة بالأسفل للمزامنة عبر الأجهزة)';
      badge.className = 'text-[11px] font-extrabold text-amber-900 bg-amber-50 px-2.5 py-0.5 rounded-full border border-amber-300';
    }
  }
}

function startLiveRealtimeSyncEngine() {
  if (liveSyncTimerId) {
    clearInterval(liveSyncTimerId);
    liveSyncTimerId = null;
  }
  if (firebaseEventSource) {
    try { firebaseEventSource.close(); } catch (e) {}
    firebaseEventSource = null;
  }
  updateLiveSyncIndicatorsUI();

  if (!appState.liveSyncEnabled) return;

  const url = (appState.webhookUrl || getEmbeddedWebhookUrl() || '').trim();
  const intervalMs = Math.max(3, Number(appState.liveSyncIntervalSec) || 5) * 1000;

  // 1. إذا كان الرابط Firebase Realtime Database، نفتح اتصال EventSource لحظي حي (Server-Sent Events)
  if (url && (url.includes('firebaseio.com') || url.includes('firebasedatabase.app')) && typeof EventSource !== 'undefined') {
    try {
      const sseUrl = url.replace(/\/$/, '') + '/abouzekry_cloud_db.json';
      firebaseEventSource = new EventSource(sseUrl);
      firebaseEventSource.addEventListener('put', (evt) => {
        try {
          if (isCloudSyncInProgress || Number(appState.pendingChanges) > 0 || (lastLocalMutationAt > 0 && (Date.now() - lastLocalMutationAt < 10000))) {
            return;
          }
          const packet = JSON.parse(evt.data);
          if (packet && packet.data && packet.data.days) {
            mergeCloudDataIntoLocal(packet.data, false);
            saveState(false);
            if (verifyActiveUserSession()) {
              renderAllPreservingActiveInputs();
            }
          }
        } catch (err) {}
      });
    } catch (err) {}
  }

  // 2. مؤقت النبض اللحظي الذكي (يعمل مع Google Apps Script ومع Firebase) مع التوقف المؤقت لمدة 10 ثوانٍ بعد أي تعديل محلي أو أثناء الرفع
  liveSyncTimerId = setInterval(() => {
    if (!appState.liveSyncEnabled || !navigator.onLine || document.hidden) return;
    if (isCloudSyncInProgress || Number(appState.pendingChanges) > 0) return;
    if (lastLocalMutationAt > 0 && (Date.now() - lastLocalMutationAt < 10000)) return;
    const activeUrl = (appState.webhookUrl || getEmbeddedWebhookUrl() || '').trim();
    if (activeUrl) {
      pullDatabaseFromCloud(true, true, true);
    }
  }, intervalMs);
}

function updateTopCloudFarmDropdownUI() {
  syncActiveFarmIntoArchive();
  if (typeof updatePrevFarmsArchiveDatalistUI === 'function') updatePrevFarmsArchiveDatalistUI();
  const archive = appState.farmsArchive || {};
  const farmNames = Object.keys(archive);
  const selTop = document.getElementById('selTopCloudFarm');
  if (selTop && document.activeElement !== selTop) {
    if (farmNames.length === 0) {
      selTop.innerHTML = `<option value="" selected>☁️ بدون مزرعة (0)</option>`;
    } else {
      selTop.innerHTML = farmNames.map(fn => {
        const safeFn = escXmlStr(fn);
        return `<option value="${safeFn}" ${fn === appState.farmName ? 'selected' : ''}>☁️ ${safeFn}</option>`;
      }).join('');
    }
  }
}

function renderCloudDatabaseHub() {
  updateTopCloudFarmDropdownUI();
  const archive = appState.farmsArchive || {};
  const farmNames = Object.keys(archive);

  // Compute Cloud KPIs across all archived farms
  let totalSalesRowsAllFarms = 0;
  const tbody = document.getElementById('cloudFarmsTbody');
  if (tbody) tbody.innerHTML = '';

  if (farmNames.length === 0 && tbody) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" class="p-5 text-center text-slate-500 font-extrabold">
          لا توجد أي مزارع مسجلة حالياً (0 مزرعة) — اكتب اسم المزرعة في الخانة أعلاه واضغط <strong>"➕ إنشاء مزرعة جديدة بالسحابة"</strong> للبدء.
        </td>
      </tr>
    `;
  }
  farmNames.forEach(fn => {
    const fObj = archive[fn];
    const savedDays = fObj.days || {};
    let fCars = 0, fNetW = 0, fSales = 0, fCashInBox = 0, fNetDebt = 0;

    for (let d = 1; d <= 10; d++) {
      const dObj = savedDays[d] || { sales: [], expenses: [] };
      const rows = (dObj.sales || []).map(computeSaleRow);
      const exps = dObj.expenses || [];
      const dayExp = exps.reduce((a, e) => a + (Number(e.amount) || 0), 0);
      rows.forEach(r => {
        if (r.w1 > 0 || r.w2 > 0 || r.totalWithTip > 0 || r.cashSales > 0 || r.debtCash > 0 || r.prevCash > 0) {
          fCars++;
          totalSalesRowsAllFarms++;
        }
        fNetW += r.netWeight;
        fSales += r.totalWithTip;
        fCashInBox += (r.cashSales + r.debtCash + r.prevCash);
        fNetDebt += (r.creditSales - r.debtCash - r.debtTransfer);
      });
      fCashInBox -= dayExp;
    }

    if (tbody) {
      const isCurrent = fn === appState.farmName;
      const safeFn = escXmlStr(fn);
      const tr = document.createElement('tr');
      tr.className = isCurrent ? 'bg-emerald-50/70 font-bold' : 'hover:bg-slate-50';
      tr.innerHTML = `
        <td class="p-2 border font-extrabold text-slate-900">
          ${safeFn}
          ${isCurrent ? '<span class="mr-1 px-2 py-0.5 rounded-full bg-emerald-600 text-white text-[10px]">المزرعة النشطة</span>' : ''}
        </td>
        <td class="p-2 border text-center font-bold">${fmtInt(fCars)} سيارة</td>
        <td class="p-2 border text-left font-bold text-blue-900">${fmtInt(fNetW)} كجم</td>
        <td class="p-2 border text-left font-extrabold">${fmtDec(fSales)} ج.م</td>
        <td class="p-2 border text-left font-extrabold text-emerald-800">${fmtInt(fCashInBox)} ج.م</td>
        <td class="p-2 border text-left font-bold text-amber-900">${fmtInt(fNetDebt)} ج.م</td>
        <td class="p-1 border text-center">
          <button type="button" data-switch-farm="${safeFn}" class="px-2 py-1 rounded-lg ${isCurrent ? 'bg-slate-200 text-slate-700' : 'bg-blue-900 text-white hover:bg-blue-800'} font-bold text-xs ml-1">
            ${isCurrent ? 'مفتوحة' : '📂 فتح'}
          </button>
          <button type="button" data-export-farm="${safeFn}" class="px-2 py-1 rounded-lg gold-badge font-extrabold text-xs shadow hover:opacity-90 ml-1">
            📥 سحب إكسيل
          </button>
          ${hasPermission('farms') ? `
            <button type="button" data-rename-farm="${safeFn}" class="px-2 py-1 rounded-lg bg-amber-100 text-amber-900 hover:bg-amber-200 font-bold text-xs ml-1">✏️ تعديل</button>
            <button type="button" data-delete-farm="${safeFn}" class="px-2 py-1 rounded-lg bg-rose-100 text-rose-800 hover:bg-rose-200 font-bold text-xs">🗑️ حذف</button>
          ` : ''}
        </td>
      `;
      tbody.appendChild(tr);
    }
  });

  const elFarms = document.getElementById('cloudKpiFarmsCount');
  if (elFarms) elFarms.textContent = `${farmNames.length} مزرعة / دورة`;
  const elMerch = document.getElementById('cloudKpiMerchantsCount');
  if (elMerch) elMerch.textContent = `${appState.merchants.length} تاجر مكود`;
  const elRows = document.getElementById('cloudKpiTotalSalesRows');
  if (elRows) elRows.textContent = `${fmtInt(totalSalesRowsAllFarms)} حركة بيع`;
  const elSync = document.getElementById('cloudKpiLastSyncTime');
  if (elSync) elSync.textContent = appState.lastExcelSync || 'مُحدّث ومحفوظ تلقائياً ✓';
  if (typeof applyDomTableExcelEngine === 'function') applyDomTableExcelEngine('cloudFarms');
}

function saveState(incrementPending = true, skipCloudPreMerge = false) {
  if (incrementPending) {
    localMutationEpoch++;
    lastLocalMutationAt = Date.now();
    appState.pendingChanges = (appState.pendingChanges || 0) + 1;
    appState.hasLocalEdits = true;
    appState.updatedAt = new Date(getSyncedNow()).toISOString();
  }
  deduplicateAllDaysInState(appState);
  syncActiveFarmIntoArchive();
  const serialized = JSON.stringify(appState);
  try {
    localStorage.setItem(STORAGE_KEY, serialized);
    localStorage.setItem(STORAGE_KEY + '_show_audit_metadata', appState.showAuditMetadata !== false ? '1' : '0');
    if (appState.webhookUrl) {
      localStorage.setItem(STORAGE_KEY + '_webhook_url', appState.webhookUrl);
    }
  } catch (e) {
    // Ignore storage error in restricted iframe
  }
  try {
    window.name = 'ABOUZEKRY_STATE_V5:' + serialized;
  } catch (e) {}
  saveToIndexedDB(appState);
  if (incrementPending && liveBroadcastChannel) {
    try { liveBroadcastChannel.postMessage({ type: 'LOCAL_STATE_CHANGED', updatedAt: appState.updatedAt }); } catch (e) {}
  }
  if (incrementPending && navigator.onLine && (appState.webhookUrl || getEmbeddedWebhookUrl())) {
    pushDatabaseToCloud(true, skipCloudPreMerge, skipCloudPreMerge);
  }
  updateConnectionAndSyncUI();
  updateLiveSyncIndicatorsUI();
}

function setFarmName(newName) {
  const cleaned = String(newName ?? '').trim();
  appState.farmName = cleaned;
  if (cleaned) {
    unrecordDeletedItem('farms', cleaned);
  }
  const dispName = cleaned || 'بدون مزرعة';
  const topInp = document.getElementById('inpTopFarmName');
  if (topInp && document.activeElement !== topInp) topInp.value = cleaned;
  const setInp = document.getElementById('inpSettingsFarmName');
  if (setInp && document.activeElement !== setInp) setInp.value = cleaned;
  document.getElementById('headerFarmBadge').textContent = dispName;
  document.getElementById('dailyFarmNameBadge').textContent = dispName;
  document.getElementById('dashFarmNameTitle').textContent = dispName;
  document.title = cleaned ? `نظام محاضر لجان بيع المزارع - ${cleaned}` : 'نظام محاضر لجان بيع المزارع';
  saveState(true);
}

function showToast(msg, icon = '✅') {
  const box = document.getElementById('toastContainer');
  document.getElementById('toastIcon').textContent = icon;
  document.getElementById('toastMsg').textContent = msg;
  box.classList.remove('hidden');
  if (window._toastTimer) clearTimeout(window._toastTimer);
  window._toastTimer = setTimeout(() => {
    box.classList.add('hidden');
  }, 3600);
}

// =========================================================================
// 2. UNIFIED MERCHANT CODE RESOLUTION (e.g. "كرنك 1" & "كرنك 2" -> 104)
// =========================================================================
function cleanMerchantBaseName(rawName) {
  if (!rawName) return '';
  return String(rawName)
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[0-9\-\(\)]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeArabicMerchantCompareKey(str) {
  if (!str) return '';
  return cleanMerchantBaseName(str)
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/^ال/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function resolveMerchantCode(rawName) {
  if (!rawName || !String(rawName).trim()) return 0;
  const trimmed = String(rawName).replace(/\s+/g, ' ').trim();
  const exact = appState.merchants.find(m => String(m.name || '').trim() === trimmed);
  if (exact) return exact.code;

  const cleaned = cleanMerchantBaseName(trimmed);
  if (cleaned) {
    const byClean = appState.merchants.find(m => cleanMerchantBaseName(m.name) === cleaned);
    if (byClean) return byClean.code;
    const normTarget = normalizeArabicMerchantCompareKey(cleaned);
    if (normTarget) {
      const byNorm = appState.merchants.find(m => normalizeArabicMerchantCompareKey(m.name) === normTarget);
      if (byNorm) return byNorm.code;
    }
    const byPartial = appState.merchants.find(m => {
      const mClean = cleanMerchantBaseName(m.name);
      return mClean && (mClean.includes(cleaned) || cleaned.includes(mClean));
    });
    if (byPartial) return byPartial.code;
  }
  return 0;
}

function ensureMerchantExists(rawName, explicitCode = null) {
  const code = resolveMerchantCode(rawName);
  if (code > 0) return code;
  const base = cleanMerchantBaseName(rawName) || String(rawName).trim();
  if (!base) return 0;
  const nextCode = explicitCode && Number(explicitCode) >= 100
    ? Number(explicitCode)
    : (appState.merchants.length > 0 ? Math.max(...appState.merchants.map(m => m.code)) + 1 : 101);
  if (!appState.merchants.some(m => m.code === nextCode)) {
    appState.merchants.push({ code: nextCode, name: base, updatedAt: getSyncedNow() });
  }
  unrecordDeletedItem('merchants', nextCode);
  return nextCode;
}

// =========================================================================
// 3. CALCULATIONS ENGINE (DAILY & 10-DAY AGGREGATION)
// =========================================================================
function computeSaleRow(row) {
  const w1 = Math.max(0, Number(row.w1) || 0);
  const w2 = Math.max(0, Number(row.w2) || 0);
  // الوزنة الثانية يجب أن تكون أكبر من أو تساوي الوزنة الأولى
  const netWeight = (w2 >= w1 && w2 > 0) ? (w2 - w1) : 0;
  const price = Number(row.price) || 0;
  const tip = Number(row.tip) || 0;
  const baseAmount = netWeight * price;
  const totalWithTip = baseAmount + tip;

  // Custody is a standalone statement (مجرد بيان مستقل لا يرتبط بالفاتورة أو الخزنة)
  const custodyCash = Number(row.custodyCash) || 0;
  const custodyTransfer = Number(row.custodyTransfer) || 0;
  const custodyTransferType = row.custodyTransferType || '';
  const totalCustody = custodyCash + custodyTransfer;

  const cashSales = Number(row.cashSales) || 0;
  const transferSales = Number(row.transferSales) || 0;
  const transferSalesType = row.transferSalesType || '';
  const creditSales = Number(row.creditSales) || 0;
  const debtCash = Number(row.debtCash) || 0;
  const debtTransfer = Number(row.debtTransfer) || 0;
  const prevCash = Number(row.prevCash) || 0;
  const prevTransfer = Number(row.prevTransfer) || 0;

  // صافي متبقي العهدة بعد خصم سداد المديونيات وسداد فاتورة اليوم (مع التوافق التام مع السجلات القديمة)
  const custodyUsedForDebt = debtCash + debtTransfer;
  const custodyUsedForInvoice = cashSales + transferSales;
  const totalSettledFromCustody = custodyUsedForDebt + custodyUsedForInvoice;
  const netCustodyAfterDebt = totalCustody - custodyUsedForDebt;
  const netCustodyRemaining = totalCustody > 0
    ? (totalCustody >= totalSettledFromCustody ? (totalCustody - totalSettledFromCustody) : netCustodyAfterDebt)
    : 0;

  const totalPaidAndCredit = cashSales + transferSales + creditSales;
  const invoiceDiff = totalPaidAndCredit - totalWithTip;
  const code = resolveMerchantCode(row.merchant);
  const isDebtCollectionOnly = Boolean(
    !row.isPending &&
    w1 === 0 &&
    w2 === 0 &&
    totalWithTip === 0 &&
    cashSales === 0 &&
    transferSales === 0 &&
    creditSales === 0 &&
    (debtCash > 0 || debtTransfer > 0 || prevCash > 0 || prevTransfer > 0 || row.entryMode === 'debt_only')
  );

  return {
    ...row,
    code,
    isDebtCollectionOnly,
    w1,
    w2,
    netWeight,
    price,
    tip,
    baseAmount,
    totalWithTip,
    custodyCash,
    custodyTransfer,
    custodyTransferType,
    totalCustody,
    netCustodyRemaining,
    cashSales,
    transferSales,
    transferSalesType,
    creditSales,
    debtCash,
    debtTransfer,
    prevCash,
    prevTransfer,
    totalPaidAndCredit,
    invoiceDiff
  };
}

function computeDaySummary(dayNum) {
  const dayObj = appState.days[dayNum] || { dayNumber: dayNum, dateLabel: `اليوم ${dayNum}`, sales: [], pendingSales: [], expenses: [], deliveredCash: 0 };
  const rows = sortSalesListByScaleNo(dayObj.sales || []).map(r => ({ ...computeSaleRow(r), isPending: false }));
  const pendingRows = sortSalesListByScaleNo(dayObj.pendingSales || []).map(r => ({
    ...computeSaleRow({ ...r, w2: 0 }),
    isPending: true
  }));
  const allOrderedRows = sortSalesListByScaleNo([...rows, ...pendingRows]);
  const expenses = dayObj.expenses || [];

  let countCars = 0;
  let countDebtVouchers = 0;
  let sumW1 = 0, sumW2 = 0, sumNetW = 0, sumTip = 0, sumBase = 0, sumTotalWithTip = 0;
  let sumCashSales = 0, sumTransferSales = 0, sumCreditSales = 0;
  let sumDebtCash = 0, sumDebtTransfer = 0;
  let sumPrevCash = 0, sumPrevTransfer = 0;
  let sumPaidAndCredit = 0, sumInvoiceDiff = 0;

  rows.forEach(r => {
    if (r.isDebtCollectionOnly) {
      countDebtVouchers++;
    } else if (r.w1 > 0 || r.w2 > 0 || r.totalWithTip > 0 || r.cashSales > 0 || r.transferSales > 0 || r.creditSales > 0) {
      countCars++;
    }
    sumW1 += r.w1;
    sumW2 += r.w2;
    sumNetW += r.netWeight;
    sumTip += r.tip;
    sumBase += r.baseAmount;
    sumTotalWithTip += r.totalWithTip;
    sumCashSales += r.cashSales;
    sumTransferSales += r.transferSales;
    sumCreditSales += r.creditSales;
    sumDebtCash += r.debtCash;
    sumDebtTransfer += r.debtTransfer;
    sumPrevCash += r.prevCash;
    sumPrevTransfer += r.prevTransfer;
    sumPaidAndCredit += r.totalPaidAndCredit;
    sumInvoiceDiff += r.invoiceDiff;
  });

  const avgPrice = sumNetW > 0 ? (sumBase / sumNetW) : 0;
  const avgCarWeight = countCars > 0 ? Math.round(sumNetW / countCars) : 0;
  const pendingCarsCount = pendingRows.length;
  const sumExpenses = expenses.reduce((acc, e) => acc + (Number(e.amount) || 0), 0);

  // 1. حساب حركة الذمم والمديونية اليومية (المطابقة الاستحقاقية للمزرعة الحالية)
  let openingDayDebt = 0;
  for (let prevD = 1; prevD < dayNum; prevD++) {
    const prevDayObj = appState.days && appState.days[prevD];
    const prevSales = (prevDayObj && prevDayObj.sales) || [];
    prevSales.forEach(rawR => {
      const cr = Number(rawR.creditSales) || 0;
      const dc = Number(rawR.debtCash) || 0;
      const dt = Number(rawR.debtTransfer) || 0;
      openingDayDebt += (cr - dc - dt);
    });
  }
  const dayDebtCollected = sumDebtCash + sumDebtTransfer;
  const netDayDebtChange = sumCreditSales - dayDebtCollected;
  const closingDayDebt = openingDayDebt + netDayDebtChange;

  // 2. حساب ميزان الخزينة النقدية شامل الرصيد النقدي المرحّل بين الأيام
  const openingCashFromPrevDay = dayNum > 1
    ? (Number(appState.days && appState.days[dayNum - 1] && appState.days[dayNum - 1].carriedForwardCash) || 0)
    : (Number(dayObj.openingCash) || 0);
  const totalCashBeforeExpenses = sumCashSales + sumDebtCash + sumPrevCash;
  const netCashInBox = totalCashBeforeExpenses - sumExpenses;
  const totalAvailableCashInBox = openingCashFromPrevDay + netCashInBox;
  const deliveredCash = Number(dayObj.deliveredCash) || 0;
  const carriedForwardCash = Number(dayObj.carriedForwardCash) || 0;
  const totalSettledAndCarriedCash = deliveredCash + carriedForwardCash;
  const cashBoxDiff = totalAvailableCashInBox - totalSettledAndCarriedCash;

  const currentFarmTransfers = sumTransferSales + sumDebtTransfer;
  const totalAllTransfers = currentFarmTransfers + sumPrevTransfer;

  const weightAuditDiff = sumNetW - (sumW2 - sumW1);
  const invoiceAuditDiff = Number(((sumPaidAndCredit - sumTotalWithTip) - sumInvoiceDiff).toFixed(2));
  const isInvoicesBalanced = Math.abs(sumInvoiceDiff) <= 1 && invoiceAuditDiff === 0;

  return {
    dayNum,
    dateLabel: dayObj.dateLabel,
    rows,
    pendingRows,
    allOrderedRows,
    expenses,
    countCars,
    countDebtVouchers,
    pendingCarsCount,
    avgCarWeight,
    sumW1,
    sumW2,
    sumNetW,
    avgPrice,
    sumTip,
    sumBase,
    sumTotalWithTip,
    sumCashSales,
    sumTransferSales,
    sumCreditSales,
    sumDebtCash,
    sumDebtTransfer,
    dayDebtCollected,
    openingDayDebt,
    netDayDebtChange,
    closingDayDebt,
    sumPrevCash,
    sumPrevTransfer,
    sumPaidAndCredit,
    sumInvoiceDiff,
    sumExpenses,
    openingCashFromPrevDay,
    totalCashBeforeExpenses,
    netCashInBox,
    totalAvailableCashInBox,
    deliveredCash,
    carriedForwardCash,
    totalSettledAndCarriedCash,
    cashBoxDiff,
    currentFarmTransfers,
    totalAllTransfers,
    weightAuditDiff,
    invoiceAuditDiff,
    isInvoicesBalanced
  };
}

function parseNum(v) {
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  if (v === null || v === undefined) return 0;
  const cleaned = String(v).replace(/,/g, '').trim();
  const num = parseFloat(cleaned);
  return isFinite(num) ? num : 0;
}

function fmtMoney(n) {
  const num = parseNum(n);
  const rounded = Math.round(num * 100) / 100;
  const hasDec = Math.abs(rounded % 1) > 0.0001;
  return rounded.toLocaleString('en-US', {
    minimumFractionDigits: hasDec ? 2 : 0,
    maximumFractionDigits: 2
  });
}

function fmtInt(n) {
  return fmtMoney(n);
}

function fmtDec(n) {
  return fmtMoney(n);
}

function formatLiveMoneyInputString(rawStr) {
  const cleaned = String(rawStr || '').replace(/[^0-9.]/g, '');
  if (!cleaned) return '';
  const parts = cleaned.split('.');
  const intPart = parts[0] ? Number(parts[0]).toLocaleString('en-US') : '0';
  if (parts.length > 1) {
    return `${intPart}.${parts[1].slice(0, 2)}`;
  }
  return intPart;
}

// =========================================================================
// 4. UI RENDERING FUNCTIONS
// =========================================================================
function updateConnectionAndSyncUI() {
  const isOnline = navigator.onLine;
  const dot = document.getElementById('connDot');
  const txt = document.getElementById('connText');
  const badge = document.getElementById('connStatusBadge');
  document.getElementById('pendingCountTxt').textContent = appState.pendingChanges || 0;

  const rawFarmName = String(appState.farmName ?? '').trim();
  const dispFarmName = rawFarmName || 'بدون مزرعة';
  const topInp = document.getElementById('inpTopFarmName');
  if (topInp && document.activeElement !== topInp) topInp.value = rawFarmName;
  const setInp = document.getElementById('inpSettingsFarmName');
  if (setInp && document.activeElement !== setInp) setInp.value = rawFarmName;
  document.getElementById('headerFarmBadge').textContent = dispFarmName;
  document.getElementById('dailyFarmNameBadge').textContent = dispFarmName;
  document.getElementById('dashFarmNameTitle').textContent = dispFarmName;

  if (liveExcelFileHandle) {
    document.getElementById('linkedExcelNameTxt').textContent = `مرتبط مباشرة بملف: ${liveExcelFileHandle.name}`;
  } else if (appState.lastExcelSync) {
    document.getElementById('linkedExcelNameTxt').textContent = appState.lastExcelSync;
  }

  if (isOnline) {
    dot.className = 'w-1.5 h-1.5 md:w-2 md:h-2 rounded-full bg-emerald-400 animate-pulse';
    txt.innerHTML = '<span class="md:hidden">متصل</span><span class="hidden md:inline">متصل (حفظ فوري)</span>';
    badge.className = 'inline-flex items-center gap-1 px-1.5 md:px-2 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-400/40 text-emerald-200 font-semibold whitespace-nowrap';
  } else {
    dot.className = 'w-1.5 h-1.5 md:w-2 md:h-2 rounded-full bg-amber-400';
    txt.innerHTML = '<span class="md:hidden">أوفلاين</span><span class="hidden md:inline">أوفلاين (محفوظ على المتصفح)</span>';
    badge.className = 'inline-flex items-center gap-1 px-1.5 md:px-2 py-0.5 rounded-full bg-amber-500/30 border border-amber-300/50 text-amber-100 font-semibold whitespace-nowrap';
  }
}

function renderDaySelector() {
  const container = document.getElementById('daySelectorContainer');
  container.innerHTML = '';
  const visDays = getVisibleDays();
  if (!visDays.includes(appState.currentDay)) {
    appState.currentDay = visDays[0] || 1;
  }

  visDays.forEach(d => {
    const summary = computeDaySummary(d);
    const locked = isDayLocked(d);
    const btn = document.createElement('button');
    btn.type = 'button';
    const isActive = d === appState.currentDay;
    btn.className = `p-2 rounded-xl border text-center transition flex flex-col items-center justify-center ${
      isActive
        ? 'day-pill-active shadow-md'
        : (locked ? 'bg-amber-50 hover:bg-amber-100 text-slate-900 border-amber-400 font-extrabold' : 'bg-slate-50 hover:bg-slate-100 text-slate-800 border-slate-300 font-bold')
    }`;
    btn.title = locked ? `يوم ${d} مقفل ومعتمد محاسبياً 🔒` : `فتح محضر يوم ${d}`;
    btn.innerHTML = `
      <span class="text-xs font-extrabold">${locked ? '🔒 ' : ''}يوم ${d}</span>
      <span class="text-[10px] ${isActive ? 'text-amber-300' : (locked ? 'text-amber-900 font-bold' : 'text-slate-500')}">${summary.countCars} حركة${locked ? ' (معتمد)' : ''}</span>
    `;
    btn.addEventListener('click', () => {
      appState.currentDay = d;
      saveState(false);
      renderAll();
    });
    container.appendChild(btn);
  });

  // Add "+ يوم جديد" pill button if fewer than 10 days are visible and user has permission
  if (visDays.length < 10 && hasPermission('sales')) {
    let nextAvailable = 1;
    for (let d = 1; d <= 10; d++) {
      if (!visDays.includes(d)) { nextAvailable = d; break; }
    }
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'p-2 rounded-xl border-2 border-dashed border-emerald-500 bg-emerald-50/70 hover:bg-emerald-100 text-emerald-900 text-center transition flex flex-col items-center justify-center font-extrabold';
    addBtn.innerHTML = `
      <span class="text-xs">➕ إضافة يوم</span>
      <span class="text-[10px] text-emerald-700">اختيار اليوم (يوم ${nextAvailable})</span>
    `;
    addBtn.addEventListener('click', () => {
      openDailyQuickAddDayBox();
    });
    container.appendChild(addBtn);
  }
  if (typeof window.refreshDayManagementBoxesUI === 'function') window.refreshDayManagementBoxesUI();
}

function renderDailyView() {
  const d = appState.currentDay;
  const summary = computeDaySummary(d);
  const dayObj = appState.days[d] || {};
  const dayLocked = Boolean(dayObj.isLocked);
  const isAdminUser = hasPermission('admin');
  const canEditSalesToday = hasPermission('sales') && !dayLocked;
  const canEditExpensesToday = hasPermission('expenses') && !dayLocked;

  document.getElementById('currentDayDateInput').value = summary.dateLabel;
  document.getElementById('currentDayDateInput').disabled = !canEditSalesToday;
  document.getElementById('saleFormDayLabel').textContent = `يوم ${d} - مزرعة ${appState.farmName}`;
  document.getElementById('tblDayTitle').textContent = `يوم ${d} (${summary.dateLabel})${dayLocked ? ' 🔒 [معتمد ومقفل]' : ''} - مزرعة ${appState.farmName}`;
  document.getElementById('expDayTitle').textContent = `يوم ${d}${dayLocked ? ' 🔒' : ''}`;
  document.getElementById('tbDayTitle').textContent = `يوم ${d}${dayLocked ? ' 🔒 [معتمد]' : ''} - مزرعة ${appState.farmName}`;

  const btnLock = document.getElementById('btnToggleDayLock');
  const btnLockIcon = document.getElementById('btnToggleDayLockIcon');
  const btnLockText = document.getElementById('btnToggleDayLockText');
  if (btnLock) {
    btnLock.classList.toggle('hidden', !isAdminUser);
    if (dayLocked) {
      btnLock.className = 'px-2.5 py-1 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 border-2 border-amber-700 text-xs font-extrabold shadow-sm flex items-center gap-1 transition';
      if (btnLockIcon) btnLockIcon.textContent = '🔓';
      if (btnLockText) btnLockText.textContent = `فك قفل اليوم (يوم ${d})`;
    } else {
      btnLock.className = 'px-2.5 py-1 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white border border-emerald-400 text-xs font-extrabold shadow-sm flex items-center gap-1 transition';
      if (btnLockIcon) btnLockIcon.textContent = '🔒';
      if (btnLockText) btnLockText.textContent = `إقفال واعتماد اليوم (يوم ${d})`;
    }
  }

  const lockBanner = document.getElementById('dayLockedNoticeBanner');
  const lockNoticeTxt = document.getElementById('dayLockedNoticeText');
  const lockMetaBadge = document.getElementById('dayLockedMetaBadge');
  if (lockBanner) {
    lockBanner.classList.toggle('hidden', !dayLocked);
    if (dayLocked) {
      if (lockNoticeTxt) {
        lockNoticeTxt.textContent = `🔒 محضر (يوم ${d} — ${summary.dateLabel}) مقفل ومعتمد محاسبياً بعد المراجعة — جميع الحركات والأوزان والخزينة محمية ضد الإضافة أو التعديل أو الحذف.${isAdminUser ? ' (يمكنك فك القفل من الزر العلوي عند الضرورة).' : ''}`;
      }
      if (lockMetaBadge) {
        const byWho = dayObj.lockedBy || 'مدير الموقع';
        const atWhen = dayObj.lockedAtTxt ? ` | 🕒 ${dayObj.lockedAtTxt}` : '';
        lockMetaBadge.textContent = `اعتمد بواسطة: ${byWho}${atWhen}`;
      }
    }
  }

  const saleCardEl = document.getElementById('saleFormCard');
  if (saleCardEl) saleCardEl.classList.toggle('hidden', !canEditSalesToday);
  const expFormEl = document.getElementById('expenseEntryForm');
  if (expFormEl) expFormEl.classList.toggle('hidden', !canEditExpensesToday);
  const delivInpEl = document.getElementById('inpDeliveredCash');
  if (delivInpEl) delivInpEl.disabled = !canEditSalesToday;
  const carryInpEl = document.getElementById('inpCarriedForwardCash');
  if (carryInpEl) carryInpEl.disabled = !canEditSalesToday;
  const btnDelivAllEl = document.getElementById('btnDeliverAllAvailableCash');
  if (btnDelivAllEl) btnDelivAllEl.classList.toggle('hidden', !canEditSalesToday);
  const btnCarryRemEl = document.getElementById('btnCarryForwardRemainingCash');
  if (btnCarryRemEl) btnCarryRemEl.classList.toggle('hidden', !canEditSalesToday);
  const jumpSaleBtn = document.getElementById('btnJumpSaleForm');
  if (jumpSaleBtn) jumpSaleBtn.classList.toggle('hidden', !canEditSalesToday);
  const jumpExpBtn = document.getElementById('btnJumpExpenseForm');
  if (jumpExpBtn) jumpExpBtn.classList.toggle('hidden', !canEditExpensesToday);

  document.getElementById('dayKpiCount').textContent = fmtInt(summary.countCars);
  document.getElementById('dayKpiNetWeight').textContent = fmtInt(summary.sumNetW);
  document.getElementById('dayKpiTotalSales').textContent = fmtDec(summary.sumTotalWithTip);
  document.getElementById('dayKpiExpenses').textContent = fmtInt(summary.sumExpenses);
  document.getElementById('dayKpiTransfers').textContent = fmtInt(summary.totalAllTransfers);
  document.getElementById('dayKpiNetCash').textContent = fmtInt(summary.netCashInBox);

  const tbody = document.getElementById('dailySalesTbody');
  tbody.innerHTML = '';
  const filteredRows = summary.allOrderedRows || summary.rows;

  if (filteredRows.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="17" class="p-6 text-center text-slate-500 font-bold">
          لا توجد حركات بيع مسجلة في هذا اليوم حتى الآن — استخدم النموذج أعلاه لإضافة حركة بيع أو ارفع شيت الإكسيل.
        </td>
      </tr>
    `;
  } else {
    filteredRows.forEach((r, idx) => {
      const tr = document.createElement('tr');
      if (r.isPending) {
        tr.className = 'bg-amber-50/85 hover:bg-amber-100/75 border-y border-amber-300';
      } else {
        tr.className = idx % 2 === 0 ? 'bg-white hover:bg-blue-50/40' : 'bg-slate-50/70 hover:bg-blue-50/40';
      }
      const debtTxt = (r.debtCash + r.debtTransfer) > 0
        ? `${fmtInt(r.debtCash + r.debtTransfer)} ${r.debtTransfer > 0 ? `(${r.debtTransferType || 'تحويل'})` : '(نقدي)'}`
        : '-';
      const custodyBadge = r.totalCustody > 0
        ? ` [عهدة: ${fmtInt(r.totalCustody)} | متبقي عهدة: ${fmtInt(r.netCustodyRemaining)}]`
        : '';
      const prevTxt = (r.prevCash + r.prevTransfer) > 0
        ? `${fmtInt(r.prevCash + r.prevTransfer)} ${r.notes ? `[${r.notes}]` : ''}${custodyBadge}`
        : ((r.notes || '') + custodyBadge || (r.isPending ? '⏳ محجوز (بانتظار الوزنة 2)' : '-'));

      const safeMerchant = escXmlStr(r.merchant);
      const safeId = escXmlStr(r.id);
      const merchantCellHtml = r.isPending
        ? `${safeMerchant} <span class="inline-block mr-1 px-1.5 py-0.5 rounded bg-amber-400 text-slate-950 text-[10px] font-extrabold shadow-sm">⏳ محجوز (وزنة 1)</span>`
        : (r.isDebtCollectionOnly
            ? `${safeMerchant} <span class="inline-block mr-1 px-1.5 py-0.5 rounded bg-teal-700 text-white text-[10px] font-extrabold shadow-sm">💵 سند تحصيل مديونية</span>`
            : safeMerchant);
      const w2CellHtml = r.isPending
        ? '<span class="text-amber-800 font-extrabold text-[11px]">⏳ بانتظار وزنة 2</span>'
        : (r.isDebtCollectionOnly ? '<span class="text-teal-800 font-extrabold text-[10px]">💵 سند تحصيل</span>' : fmtInt(r.w2));
      const showReceiptBtn = Boolean(excelTableState && excelTableState.showScaleReceiptButtons);
      const receiptBtnHtml = showReceiptBtn
        ? `<span class="inline-flex items-center gap-0.5 ml-1 bg-indigo-50 p-0.5 rounded-lg border border-indigo-200">
            <button type="button" data-print-receipt="${safeId}" data-receipt-day="${d}" class="px-1.5 py-0.5 rounded bg-indigo-800 text-white font-extrabold hover:bg-indigo-700 text-[10px] shadow-sm" title="طباعة كارتة/بون ميزان (3 نسخ في ورقة واحدة)">🖨️ بون</button>
            <button type="button" data-export-receipt-img="${safeId}" data-receipt-day="${d}" class="px-1.5 py-0.5 rounded bg-teal-700 text-white font-extrabold hover:bg-teal-600 text-[10px] shadow-sm" title="حفظ كارتة/بون الميزان كصورة PNG عالية الدقة">🖼️ صورة</button>
            <button type="button" data-export-receipt-pdf="${safeId}" data-receipt-day="${d}" class="px-1.5 py-0.5 rounded bg-rose-700 text-white font-extrabold hover:bg-rose-600 text-[10px] shadow-sm" title="حفظ كارتة/بون الميزان كملف PDF">📄 PDF</button>
          </span>`
        : '';
      const auditBadgeHtml = renderAuditTrailBadgeHtml(r);
      const actionCellHtml = !canEditSalesToday
        ? `${auditBadgeHtml}${receiptBtnHtml}<span class="text-slate-500 text-[11px] font-bold">${dayLocked ? '🔒 يوم معتمد ومقفل' : '🔒 عرض فقط'}</span>`
        : (r.isPending
          ? `${auditBadgeHtml}${receiptBtnHtml}<button type="button" data-recall-pending="${safeId}" class="px-2 py-1 rounded bg-emerald-600 text-white font-extrabold hover:bg-emerald-500 ml-1 shadow-sm" title="استرجاع الحركة المحجوزة لاستكمال الوزنة الثانية">🔄 استكمال</button>
             <button type="button" data-del-pending="${safeId}" class="px-2 py-1 rounded bg-rose-100 text-rose-800 font-bold hover:bg-rose-200">حذف</button>`
          : `${auditBadgeHtml}${receiptBtnHtml}<button type="button" data-edit-sale="${safeId}" class="px-2 py-1 rounded bg-blue-100 text-blue-900 font-bold hover:bg-blue-200 ml-1">تعديل</button>
             <button type="button" data-del-sale="${safeId}" class="px-2 py-1 rounded bg-rose-100 text-rose-800 font-bold hover:bg-rose-200">حذف</button>`);

      tr.innerHTML = `
        <td class="p-2 border text-center font-bold">${idx + 1}</td>
        <td class="p-2 border text-center font-extrabold text-blue-900">${r.code || '-'}</td>
        <td class="p-2 border font-extrabold text-slate-900">${merchantCellHtml}</td>
        <td class="p-2 border text-center text-[11px] font-extrabold ${r.isPending ? 'text-amber-900 bg-amber-100/60' : ''}">${escXmlStr(r.scaleNo || '-')} / ${escXmlStr(r.carNo || '-')}</td>
        <td class="p-2 border text-left font-bold">${fmtInt(r.w1)}</td>
        <td class="p-2 border text-left">${w2CellHtml}</td>
        <td class="p-2 border text-left font-extrabold bg-blue-50/50 text-blue-950">${r.isPending ? '0' : fmtInt(r.netWeight)}</td>
        <td class="p-2 border text-left">${fmtDec(r.price)}</td>
        <td class="p-2 border text-left">${fmtInt(r.tip)}</td>
        <td class="p-2 border text-left font-extrabold bg-blue-50/50">${r.isPending ? '0' : fmtDec(r.totalWithTip)}</td>
        <td class="p-2 border text-left font-bold text-emerald-800">${r.cashSales ? fmtInt(r.cashSales) : '-'}</td>
        <td class="p-2 border text-left font-bold text-amber-900">${r.transferSales ? `${fmtInt(r.transferSales)} (${escXmlStr(r.transferSalesType || 'تحويل')})` : '-'}</td>
        <td class="p-2 border text-left font-bold text-slate-800">${r.creditSales ? fmtInt(r.creditSales) : '-'}</td>
        <td class="p-2 border text-left font-bold text-teal-900">${escXmlStr(debtTxt)}</td>
        <td class="p-2 border text-left font-bold text-purple-900">${escXmlStr(prevTxt)}</td>
        <td class="p-2 border text-left font-bold ${!r.isPending && Math.abs(r.invoiceDiff) > 5 ? 'text-rose-700' : 'text-slate-600'}">${r.isPending ? '0' : fmtDec(r.invoiceDiff)}</td>
        <td class="p-1 border text-center">${actionCellHtml}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  const pendingCountLabel = (summary.pendingRows && summary.pendingRows.length > 0)
    ? ` + ${summary.pendingRows.length} محجوزة مؤقتاً`
    : '';
  document.getElementById('dailySalesTfoot').innerHTML = `
    <tr>
      <td colspan="4" class="p-2 border text-center">إجمالي اليوم (${summary.countCars} حركة مكتملة${pendingCountLabel})</td>
      <td class="p-2 border text-left">${fmtInt(summary.sumW1)}</td>
      <td class="p-2 border text-left">${fmtInt(summary.sumW2)}</td>
      <td class="p-2 border text-left">${fmtInt(summary.sumNetW)}</td>
      <td class="p-2 border text-left">${fmtDec(summary.avgPrice)}</td>
      <td class="p-2 border text-left">${fmtInt(summary.sumTip)}</td>
      <td class="p-2 border text-left">${fmtDec(summary.sumTotalWithTip)}</td>
      <td class="p-2 border text-left">${fmtInt(summary.sumCashSales)}</td>
      <td class="p-2 border text-left">${fmtInt(summary.sumTransferSales)}</td>
      <td class="p-2 border text-left">${fmtInt(summary.sumCreditSales)}</td>
      <td class="p-2 border text-left">${fmtInt(summary.sumDebtCash + summary.sumDebtTransfer)}</td>
      <td class="p-2 border text-left">${fmtInt(summary.sumPrevCash + summary.sumPrevTransfer)}</td>
      <td class="p-2 border text-left">${fmtDec(summary.sumInvoiceDiff)}</td>
      <td class="p-2 border"></td>
    </tr>
  `;

  document.getElementById('dayTotalExpensesBadge').textContent = fmtInt(summary.sumExpenses);
  const expTbody = document.getElementById('dailyExpensesTbody');
  expTbody.innerHTML = '';
  if (summary.expenses.length === 0) {
    expTbody.innerHTML = `
      <tr>
        <td colspan="6" class="p-4 text-center text-slate-400 font-bold">لا توجد مصروفات أو مكافآت مسجلة في هذا اليوم</td>
      </tr>
    `;
  } else {
    summary.expenses.forEach((exp, idx) => {
      const safeExpId = escXmlStr(exp.id);
      const tr = document.createElement('tr');
      tr.className = 'hover:bg-rose-50/40';
      tr.innerHTML = `
        <td class="p-2 border text-center font-bold">${idx + 1}</td>
        <td class="p-2 border font-extrabold text-rose-950">${escXmlStr(exp.category)}</td>
        <td class="p-2 border">${escXmlStr(exp.desc || '-')}</td>
        <td class="p-2 border font-bold">${escXmlStr(exp.recipient || '-')}</td>
        <td class="p-2 border font-extrabold text-rose-800 text-left">${fmtInt(exp.amount)} ج.م</td>
        <td class="p-1.5 border text-center whitespace-nowrap">
          ${renderAuditTrailBadgeHtml(exp)}
          ${canEditExpensesToday ? `
            <button type="button" data-edit-exp="${safeExpId}" class="px-2 py-0.5 rounded bg-blue-100 text-blue-900 font-bold hover:bg-blue-200 ml-1">✏️ تعديل</button>
            <button type="button" data-del-exp="${safeExpId}" class="px-2 py-0.5 rounded bg-rose-100 text-rose-800 font-bold hover:bg-rose-200">🗑️ حذف</button>
          ` : `<span class="text-slate-500 text-[11px] font-bold">${dayLocked ? '🔒 يوم معتمد ومقفل' : '🔒 عرض فقط'}</span>`}
        </td>
      `;
      expTbody.appendChild(tr);
    });
  }

  const pendStatusHtml = summary.pendingCarsCount > 0
    ? `<span class="px-2 py-0.5 rounded bg-amber-200 text-rose-900 border border-rose-400 font-extrabold">⚠️ ${fmtInt(summary.pendingCarsCount)} سيارة لم تستكمل وزنة 2!</span>`
    : `<strong class="text-emerald-800">0 سيارة (لا توجد سيارات معلقة ✓)</strong>`;

  document.getElementById('tbPillar1').innerHTML = `
    <div class="flex justify-between py-1 border-b">
      <span>عدد السيارات المكتملة (متوسط السيارة):</span>
      <strong>${fmtInt(summary.countCars)} سيارة <span class="text-[11px] text-slate-500">(${fmtInt(summary.avgCarWeight)} كجم)</span></strong>
    </div>
    <div class="flex justify-between items-center py-1 border-b ${summary.pendingCarsCount > 0 ? 'bg-amber-50 px-1.5 rounded border-amber-300' : ''}">
      <span>إجمالي السيارات المؤقتة (تحت التحميل):</span>
      ${pendStatusHtml}
    </div>
    <div class="flex justify-between py-1 border-b"><span>إجمالي الوزنة الثانية (القائم):</span><strong>${fmtInt(summary.sumW2)} كجم</strong></div>
    <div class="flex justify-between py-1 border-b"><span>(-) إجمالي الوزنة الأولى (الفارغ):</span><strong>${fmtInt(summary.sumW1)} كجم</strong></div>
    <div class="flex justify-between py-1 border-b bg-sky-50/70 px-1.5 rounded font-extrabold text-sky-950">
      <span>(=) صافي الوزن المحسوب:</span>
      <strong>${fmtInt(summary.sumNetW)} كجم</strong>
    </div>
    <div class="flex justify-between py-1 border-b text-indigo-950">
      <span>متوسط سعر الكيلو المرجح لليوم:</span>
      <strong>${fmtDec(summary.avgPrice)} ج.م/كجم <span class="text-[10px] text-slate-500">(إكرامية: ${fmtInt(summary.sumTip)})</span></strong>
    </div>
    <div class="flex justify-between p-1.5 rounded ${summary.weightAuditDiff === 0 ? 'bg-emerald-100 text-emerald-950' : 'bg-rose-100 text-rose-900'} font-extrabold">
      <span>فرق ميزان الأوزان:</span>
      <span>${fmtInt(summary.weightAuditDiff)} (${summary.weightAuditDiff === 0 ? 'وزن مطابق ✓' : 'راجع الوزن!'})</span>
    </div>
  `;

  const invBalancedOk = Math.abs(summary.sumInvoiceDiff) <= 1;
  document.getElementById('tbPillar2').innerHTML = `
    <div class="flex justify-between py-1 border-b bg-amber-50 px-1.5 rounded font-extrabold"><span>إجمالي المبيعات شامل الإكرامية:</span><span>${fmtDec(summary.sumTotalWithTip)} ج.م</span></div>
    <div class="flex justify-between py-1 border-b"><span>إجمالي غير النقدي يوم البيع (آجل+تحويل):</span><strong>${fmtInt(summary.sumCreditSales + summary.sumTransferSales)} ج.م</strong></div>
    <div class="flex justify-between py-1 border-b text-teal-900"><span>تحويلات المزرعة الحالية (مبيعات+مديونيات):</span><strong>${fmtInt(summary.currentFarmTransfers)} ج.م</strong></div>
    <div class="flex justify-between py-1 border-b text-purple-900"><span>تحويلات مزارع سابقة (لا تخصم من الحالية):</span><strong>${fmtInt(summary.sumPrevTransfer)} ج.م</strong></div>
    <div class="flex justify-between p-1.5 rounded bg-emerald-100 text-emerald-950 font-extrabold">
      <span>إجمالي جميع التحويلات اليوم:</span>
      <span>${fmtInt(summary.totalAllTransfers)} ج.م</span>
    </div>
    <div class="flex justify-between p-1.5 rounded border ${invBalancedOk ? 'bg-slate-50 border-slate-200 text-emerald-900' : 'bg-rose-50 border-rose-300 text-rose-900'} font-extrabold text-[11px]">
      <span>مطابقة توازن الفواتير (المسدد والآجل - الفواتير):</span>
      <span>${fmtDec(summary.sumInvoiceDiff)} ج.م (${invBalancedOk ? 'فواتير متزنة ✓' : '⚠️ فرق توازن!'})</span>
    </div>
    <!-- معادلة المطابقة الاستحقاقية لحركة الذمم والمديونية اليومية -->
    <div class="mt-1.5 p-2 rounded-xl bg-indigo-50/80 border border-indigo-200 space-y-1 text-[11px]">
      <div class="font-extrabold text-indigo-950 border-b border-indigo-200 pb-1 flex items-center justify-between">
        <span>📌 حركة الذمم والمديونية اليومية (المزرعة الحالية):</span>
        <span class="text-[10px] px-1.5 py-0.5 rounded bg-indigo-900 text-amber-300">مطابقة استحقاقية</span>
      </div>
      <div class="flex justify-between text-slate-700">
        <span>مديونية أول اليوم (مرحّلة من الأيام السابقة):</span>
        <strong>${fmtInt(summary.openingDayDebt)} ج.م</strong>
      </div>
      <div class="flex justify-between text-amber-950">
        <span>(+) آجل فواتير اليوم المضاف:</span>
        <strong>${fmtInt(summary.sumCreditSales)} ج.م</strong>
      </div>
      <div class="flex justify-between text-teal-900">
        <span>(-) مسدد المديونية اليوم (نقدي ${fmtInt(summary.sumDebtCash)} + تحويل ${fmtInt(summary.sumDebtTransfer)}):</span>
        <strong>${fmtInt(summary.dayDebtCollected)} ج.م</strong>
      </div>
      <div class="flex justify-between pt-1 border-t border-indigo-200 font-extrabold text-indigo-950 text-xs">
        <span>(=) صافي مديونية المزرعة آخر اليوم:</span>
        <span>${fmtInt(summary.closingDayDebt)} ج.م</span>
      </div>
    </div>
  `;

  document.getElementById('tbPillar3').innerHTML = `
    <div class="flex justify-between py-1 px-1.5 rounded ${summary.openingCashFromPrevDay > 0 ? 'bg-teal-100/90 text-teal-950 border border-teal-300 font-extrabold' : 'border-b text-slate-600'}">
      <span>(+) رصيد نقدي مرحّل من خزنة أمس${d > 1 ? ` (يوم ${d - 1})` : ''}:</span>
      <strong>${fmtInt(summary.openingCashFromPrevDay)} ج.م</strong>
    </div>
    <div class="flex justify-between py-1 border-b"><span>(+) نقدي المبيعات + نقدي مديونيات الحالية:</span><strong>${fmtInt(summary.sumCashSales + summary.sumDebtCash)} ج.م</strong></div>
    <div class="flex justify-between py-1 border-b"><span>(+) نقدي مزارع سابقة (للخزنة فقط):</span><strong>${fmtInt(summary.sumPrevCash)} ج.م</strong></div>
    <div class="flex justify-between py-1 px-1.5 rounded bg-amber-100 text-slate-950 font-extrabold">
      <span>إجمالي وارد النقدية اليوم (قبل المصاريف):</span>
      <span>${fmtInt(summary.totalCashBeforeExpenses)} ج.م</span>
    </div>
    <div class="flex justify-between py-1 border-b text-rose-800 font-bold"><span>(-) يخصم: إجمالي المصروفات والمكافآت:</span><span>${fmtInt(summary.sumExpenses)} ج.م</span></div>
    <div class="flex justify-between py-1 border-b text-slate-800 font-extrabold">
      <span>(=) صافي نقدية حركات اليوم (بعد المصاريف):</span>
      <span>${fmtInt(summary.netCashInBox)} ج.م</span>
    </div>
    <div class="flex justify-between py-1.5 px-2 rounded-lg bg-emerald-100 border border-emerald-400 text-emerald-950 font-extrabold">
      <span>(=) إجمالي النقدية المتاحة بالخزنة (شامل المرحّل):</span>
      <span>${fmtInt(summary.totalAvailableCashInBox)} ج.م</span>
    </div>
  `;

  const inpDelivEl = document.getElementById('inpDeliveredCash');
  if (inpDelivEl && document.activeElement !== inpDelivEl) {
    inpDelivEl.value = summary.deliveredCash ? fmtMoney(summary.deliveredCash) : '0';
  }
  const inpCarryEl = document.getElementById('inpCarriedForwardCash');
  if (inpCarryEl && document.activeElement !== inpCarryEl) {
    inpCarryEl.value = summary.carriedForwardCash ? fmtMoney(summary.carriedForwardCash) : '0';
  }
  const diffBox = document.getElementById('tbCashDiffBox');
  const statusTxt = summary.cashBoxDiff === 0
    ? 'خزينة مطابقة ✓'
    : (summary.cashBoxDiff < 0 ? 'زيادة توريد' : 'عجز توريد');
  diffBox.className = `p-2 rounded-lg font-extrabold flex flex-col gap-1 text-xs mt-1 ${
    summary.cashBoxDiff === 0 ? 'bg-emerald-100 text-emerald-950 border border-emerald-300' : 'bg-rose-100 text-rose-900 border border-rose-300'
  }`;
  const carryNextDayNote = summary.carriedForwardCash > 0
    ? `<div class="text-[11px] text-teal-900 bg-white/80 px-2 py-0.5 rounded border border-teal-300 flex items-center justify-between">
         <span>🔄 يُرحّل تلقائياً كرصيد افتتاحي لخزنة (${d < 10 ? `يوم ${d + 1}` : 'الدورة التالية'}):</span>
         <strong>${fmtInt(summary.carriedForwardCash)} ج.م</strong>
       </div>`
    : '';
  diffBox.innerHTML = `
    <div class="flex items-center justify-between">
      <span>فرق الخزينة اليومي (المتاح - المورد والمرحّل):</span>
      <span>${fmtInt(summary.cashBoxDiff)} ج.م (${statusTxt})</span>
    </div>
    ${carryNextDayNote}
  `;

  // Render Pending First-Weigh Cars (الوزنة الأولى المحفوظة مؤقتاً لحين استكمال الوزنة الثانية)
  const pendingList = (appState.days[d] && appState.days[d].pendingSales) || [];
  const pendSec = document.getElementById('pendingWeighInsSection');
  const pendTbody = document.getElementById('pendingWeighInsTbody');
  const pendBadge = document.getElementById('pendingWeighInsCountBadge');
  if (pendSec && pendTbody && pendBadge) {
    pendBadge.textContent = `${pendingList.length} سيارة`;
    if (pendingList.length === 0 || !canEditSalesToday) {
      pendSec.classList.add('hidden');
    } else {
      pendSec.classList.remove('hidden');
      pendTbody.innerHTML = pendingList.map(item => {
        const safePendId = escXmlStr(item.id);
        return `
        <tr class="hover:bg-amber-50/60">
          <td class="p-1.5 border text-center font-extrabold text-blue-900">${escXmlStr(item.scaleNo || '-')}</td>
          <td class="p-1.5 border font-extrabold text-slate-900">${escXmlStr(item.merchant)}</td>
          <td class="p-1.5 border text-center font-bold">${escXmlStr(item.carNo || '-')}</td>
          <td class="p-1.5 border text-left font-extrabold text-amber-900">${fmtMoney(item.w1)} كجم</td>
          <td class="p-1.5 border text-left">${fmtMoney(item.price)} | إكرامية: ${fmtMoney(item.tip)}</td>
          <td class="p-1.5 border text-right text-[11px]">${(item.custodyCash || item.custodyTransfer) ? `عهدة: ${fmtMoney((Number(item.custodyCash)||0)+(Number(item.custodyTransfer)||0))}` : escXmlStr(item.notes || 'بانتظار الوزنة الثانية')}</td>
          <td class="p-1 border text-center whitespace-nowrap">
            ${renderAuditTrailBadgeHtml(item)}
            ${excelTableState && excelTableState.showScaleReceiptButtons ? `<span class="inline-flex items-center gap-0.5 ml-1 bg-indigo-50 p-0.5 rounded-lg border border-indigo-200">
              <button type="button" data-print-receipt="${safePendId}" data-receipt-day="${d}" class="px-1.5 py-0.5 rounded bg-indigo-800 hover:bg-indigo-700 text-white font-extrabold text-[10px] shadow-sm" title="طباعة كارتة/بون ميزان (3 نسخ في ورقة واحدة)">🖨️ بون</button>
              <button type="button" data-export-receipt-img="${safePendId}" data-receipt-day="${d}" class="px-1.5 py-0.5 rounded bg-teal-700 hover:bg-teal-600 text-white font-extrabold text-[10px] shadow-sm" title="حفظ كارتة/بون الميزان كصورة PNG">🖼️ صورة</button>
              <button type="button" data-export-receipt-pdf="${safePendId}" data-receipt-day="${d}" class="px-1.5 py-0.5 rounded bg-rose-700 hover:bg-rose-600 text-white font-extrabold text-[10px] shadow-sm" title="حفظ كارتة/بون الميزان كملف PDF">📄 PDF</button>
            </span>` : ''}
            <button type="button" data-recall-pending="${safePendId}" class="px-2 py-0.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-[11px] ml-1 shadow-sm">
              🔄 استرجاع
            </button>
            <button type="button" data-del-pending="${safePendId}" class="px-2 py-0.5 rounded-lg bg-rose-100 hover:bg-rose-200 text-rose-800 font-bold text-[11px]">
              🗑️ حذف
            </button>
          </td>
        </tr>
      `;
      }).join('');
    }
  }
  if (typeof updateReceiptToggleBtnsUI === 'function') updateReceiptToggleBtnsUI();
  if (typeof applyDomTableExcelEngine === 'function') {
    applyDomTableExcelEngine('dailySales');
    applyDomTableExcelEngine('dailyExpenses');
    applyDomTableExcelEngine('pendingWeighIns');
  }
  if (typeof updateLiteFieldModeUI === 'function') updateLiteFieldModeUI();
  if (typeof renderLiteFieldModeComponents === 'function') {
    renderLiteFieldModeComponents(d, summary, canEditSalesToday, dayLocked);
  }
}

// =========================================================================
// UNIVERSAL EXCEL-LIKE SORT & FILTER ENGINE FOR ALL 10 WEBSITE TABLES
// =========================================================================
const excelTableState = {
  showScaleReceiptButtons: false,
  dash: { searchQuery: '', sortCol: null, sortDir: 'asc', colFilters: {}, showColFilters: false },
  merch: { searchQuery: '', sortCol: null, sortDir: 'asc', colFilters: {}, showColFilters: false },
  dailySales: { searchQuery: '', sortCol: null, sortDir: 'asc', colFilters: {}, showColFilters: false },
  pendingWeighIns: { searchQuery: '', sortCol: null, sortDir: 'asc', colFilters: {}, showColFilters: false },
  dailyExpenses: { searchQuery: '', sortCol: null, sortDir: 'asc', colFilters: {}, showColFilters: false },
  transfers: { searchQuery: '', sortCol: null, sortDir: 'asc', colFilters: {}, showColFilters: false },
  prevFarms: { searchQuery: '', sortCol: null, sortDir: 'asc', colFilters: {}, showColFilters: false },
  expSummary: { searchQuery: '', sortCol: null, sortDir: 'asc', colFilters: {}, showColFilters: false },
  usersList: { searchQuery: '', sortCol: null, sortDir: 'asc', colFilters: {}, showColFilters: false },
  cloudFarms: { searchQuery: '', sortCol: null, sortDir: 'asc', colFilters: {}, showColFilters: false },
  activePopover: null
};

const DASH_COLUMNS = [
  { key: 'dayNum', label: 'اليوم', type: 'number', getVal: s => s.dayNum, getDisp: s => `يوم ${s.dayNum}` },
  { key: 'dateLabel', label: 'التاريخ', type: 'text', getVal: s => s.dateLabel || '', getDisp: s => s.dateLabel || '' },
  { key: 'countCars', label: 'السيارات', type: 'number', getVal: s => s.countCars, getDisp: s => fmtInt(s.countCars) },
  { key: 'sumNetW', label: 'الوزن الصافي', type: 'number', getVal: s => s.sumNetW, getDisp: s => fmtInt(s.sumNetW) },
  { key: 'sumTotalWithTip', label: 'إجمالي المبيعات بالإكرامية', type: 'number', getVal: s => Number(s.sumTotalWithTip.toFixed(2)), getDisp: s => fmtDec(s.sumTotalWithTip) },
  { key: 'sumCashSales', label: 'نقدي المبيعات', type: 'number', getVal: s => s.sumCashSales, getDisp: s => fmtInt(s.sumCashSales) },
  { key: 'sumCreditSales', label: 'آجل الفواتير', type: 'number', getVal: s => s.sumCreditSales, getDisp: s => fmtInt(s.sumCreditSales) },
  { key: 'sumDebtCash', label: 'تحصيل مديونيات (نقدي)', type: 'number', getVal: s => s.sumDebtCash, getDisp: s => fmtInt(s.sumDebtCash) },
  { key: 'currentFarmTransfers', label: 'تحويلات المزرعة الحالية', type: 'number', getVal: s => s.currentFarmTransfers, getDisp: s => fmtInt(s.currentFarmTransfers) },
  { key: 'sumPrevCash', label: 'مزارع سابقة (نقدي)', type: 'number', getVal: s => s.sumPrevCash, getDisp: s => fmtInt(s.sumPrevCash) },
  { key: 'sumPrevTransfer', label: 'تحويلات سابقة', type: 'number', getVal: s => s.sumPrevTransfer, getDisp: s => fmtInt(s.sumPrevTransfer) },
  { key: 'totalCashBeforeExpenses', label: 'إجمالي النقدية (قبل المصاريف)', type: 'number', getVal: s => s.totalCashBeforeExpenses, getDisp: s => fmtInt(s.totalCashBeforeExpenses), thClass: 'bg-amber-500 text-slate-950', lightBg: true },
  { key: 'sumExpenses', label: '(-) المصروفات', type: 'number', getVal: s => s.sumExpenses, getDisp: s => fmtInt(s.sumExpenses), thClass: 'bg-rose-800 text-white' },
  { key: 'netCashInBox', label: 'صافي النقدية بالخزنة', type: 'number', getVal: s => s.netCashInBox, getDisp: s => fmtInt(s.netCashInBox), thClass: 'bg-emerald-800 text-white' },
  { key: 'deliveredCash', label: 'المسلم للخزينة', type: 'number', getVal: s => s.deliveredCash, getDisp: s => fmtInt(s.deliveredCash) },
  { key: 'cashBoxDiff', label: 'فرق الخزينة', type: 'number', getVal: s => s.cashBoxDiff, getDisp: s => fmtInt(s.cashBoxDiff) },
  { key: 'statusText', label: 'حالة الميزان', type: 'text', getVal: s => s.statusText, getDisp: s => s.statusText }
];

const MERCH_COLUMNS = [
  { key: 'code', label: 'الكود الموحد', type: 'number', getVal: m => m.code, getDisp: m => String(m.code) },
  { key: 'name', label: 'اسم التاجر الأساسي', type: 'text', getVal: m => m.name || '', getDisp: m => m.name || '', alignRight: true },
  { key: 'cars', label: 'عدد السيارات', type: 'number', getVal: m => m.cars, getDisp: m => fmtInt(m.cars) },
  { key: 'netW', label: 'إجمالي الصافي (كجم)', type: 'number', getVal: m => m.netW, getDisp: m => fmtInt(m.netW) },
  { key: 'totalSales', label: 'إجمالي المبيعات', type: 'number', getVal: m => Number(m.totalSales.toFixed(2)), getDisp: m => fmtDec(m.totalSales) },
  { key: 'cashSales', label: 'نقدي يوم البيع', type: 'number', getVal: m => m.cashSales, getDisp: m => fmtInt(m.cashSales) },
  { key: 'nonCashDayOfSale', label: 'غير النقدي يوم البيع (آجل+تحويل)', type: 'number', getVal: m => m.nonCashDayOfSale, getDisp: m => fmtInt(m.nonCashDayOfSale) },
  { key: 'creditSales', label: 'آجل الفواتير الصافي', type: 'number', getVal: m => m.creditSales, getDisp: m => fmtInt(m.creditSales) },
  { key: 'transferSales', label: '(-) تحويلات المبيعات', type: 'number', getVal: m => m.transferSales, getDisp: m => fmtInt(m.transferSales) },
  { key: 'debtCash', label: '(-) تحصيل مديونيات نقدي', type: 'number', getVal: m => m.debtCash, getDisp: m => fmtInt(m.debtCash) },
  { key: 'debtTransfer', label: '(-) تحصيل مديونيات تحويل', type: 'number', getVal: m => m.debtTransfer, getDisp: m => fmtInt(m.debtTransfer) },
  { key: 'totalSettledCurrent', label: 'إجمالي المسدد للمزرعة الحالية', type: 'number', getVal: m => m.totalSettledCurrent, getDisp: m => fmtInt(m.totalSettledCurrent), thClass: 'bg-emerald-800 text-white' },
  { key: 'netDebtCurrent', label: 'صافي مديونية المزرعة الحالية', type: 'number', getVal: m => m.netDebtCurrent, getDisp: m => fmtInt(m.netDebtCurrent), thClass: 'bg-amber-500 text-slate-950', lightBg: true },
  { key: 'prevAll', label: 'مزارع سابقة (نقدي+تحويل)', type: 'number', getVal: m => m.prevAll, getDisp: m => fmtInt(m.prevAll), thClass: 'bg-purple-900 text-white' }
];

function enrichDashSummaryRow(s) {
  const statusOk = s.weightAuditDiff === 0 && s.invoiceAuditDiff === 0;
  const locked = isDayLocked(s.dayNum);
  const baseStatus = s.countCars === 0 && (s.countDebtVouchers || 0) === 0 && s.sumExpenses === 0 && s.deliveredCash === 0
    ? 'مفتوح (بدون حركات)'
    : (statusOk ? 'مطابق ومتزن ✓' : 'راجع الميزان!');
  const statusText = locked ? `🔒 معتمد ومقفل (${baseStatus})` : baseStatus;
  const netRemDebt = s.sumCreditSales - s.sumDebtCash - s.sumDebtTransfer;
  return { ...s, statusOk, statusText, netRemDebt };
}

function enrichMerchantRow(m) {
  const nonCashDayOfSale = m.creditSales + m.transferSales;
  const totalSettledCurrent = m.cashSales + m.transferSales + m.debtCash + m.debtTransfer;
  const netDebtCurrent = nonCashDayOfSale - m.transferSales - m.debtCash - m.debtTransfer;
  const prevAll = m.prevCash + m.prevTransfer;
  return { ...m, nonCashDayOfSale, totalSettledCurrent, netDebtCurrent, prevAll };
}

function getOpenAndActiveDashSummaries() {
  const visDays = getVisibleDays();
  const rows = [];
  for (let d = 1; d <= 10; d++) {
    const s = computeDaySummary(d);
    const hasMovements = s.countCars > 0 || (s.countDebtVouchers || 0) > 0 || s.sumExpenses > 0 || s.deliveredCash > 0 ||
      ((appState.days[d] && appState.days[d].pendingSales && appState.days[d].pendingSales.length > 0));
    if (visDays.includes(d) || hasMovements) {
      rows.push(enrichDashSummaryRow(s));
    }
  }
  return rows;
}

function computeFarmCumulativeTrialBalance(summariesList = null) {
  const list = Array.isArray(summariesList) ? summariesList : getOpenAndActiveDashSummaries();
  let activeDaysCount = list.length;
  let lockedDaysCount = 0;
  let countCars = 0;
  let countDebtVouchers = 0;
  let pendingCarsCount = 0;
  let sumW1 = 0, sumW2 = 0, sumNetW = 0, sumBase = 0, sumTip = 0, sumTotalWithTip = 0;
  let sumCashSales = 0, sumTransferSales = 0, sumCreditSales = 0;
  let sumDebtCash = 0, sumDebtTransfer = 0;
  let sumPrevCash = 0, sumPrevTransfer = 0;
  let sumPaidAndCredit = 0, sumInvoiceDiff = 0;
  let sumExpenses = 0, sumDeliveredCash = 0;
  let latestDayWithCarry = 0, lastDayCarriedForwardCash = 0;

  list.forEach(s => {
    if (isDayLocked(s.dayNum)) lockedDaysCount++;
    countCars += (Number(s.countCars) || 0);
    countDebtVouchers += (Number(s.countDebtVouchers) || 0);
    pendingCarsCount += (Number(s.pendingCarsCount) || 0);
    sumW1 += (Number(s.sumW1) || 0);
    sumW2 += (Number(s.sumW2) || 0);
    sumNetW += (Number(s.sumNetW) || 0);
    sumBase += (Number(s.sumBase) || 0);
    sumTip += (Number(s.sumTip) || 0);
    sumTotalWithTip += (Number(s.sumTotalWithTip) || 0);
    sumCashSales += (Number(s.sumCashSales) || 0);
    sumTransferSales += (Number(s.sumTransferSales) || 0);
    sumCreditSales += (Number(s.sumCreditSales) || 0);
    sumDebtCash += (Number(s.sumDebtCash) || 0);
    sumDebtTransfer += (Number(s.sumDebtTransfer) || 0);
    sumPrevCash += (Number(s.sumPrevCash) || 0);
    sumPrevTransfer += (Number(s.sumPrevTransfer) || 0);
    sumPaidAndCredit += (Number(s.sumPaidAndCredit) || 0);
    sumInvoiceDiff += (Number(s.sumInvoiceDiff) || 0);
    sumExpenses += (Number(s.sumExpenses) || 0);
    sumDeliveredCash += (Number(s.deliveredCash) || 0);
    if (s.dayNum >= latestDayWithCarry) {
      latestDayWithCarry = s.dayNum;
      lastDayCarriedForwardCash = Number(s.carriedForwardCash) || 0;
    }
  });

  const avgPrice = sumNetW > 0 ? (sumBase / sumNetW) : 0;
  const avgCarWeight = countCars > 0 ? Math.round(sumNetW / countCars) : 0;
  const weightAuditDiff = sumNetW - (sumW2 - sumW1);

  const currentFarmTransfers = sumTransferSales + sumDebtTransfer;
  const totalAllTransfers = currentFarmTransfers + sumPrevTransfer;
  const totalDebtCollected = sumDebtCash + sumDebtTransfer;
  const closingFarmDebt = sumCreditSales - totalDebtCollected;

  // إجمالي النقدية التراكمية التي دخلت خزنة المزرعة عبر كل الأيام (بدون ازدواج الرصيد المرحّل بين الأيام)
  const totalCashInflowBeforeExpenses = sumCashSales + sumDebtCash + sumPrevCash;
  const netCumulativeCashInBox = totalCashInflowBeforeExpenses - sumExpenses;
  // إجمالي ما تم توريده للإدارة عبر كل الأيام + الرصيد المتبقي المرحّل في خزنة آخر يوم نشط
  const totalSettledAndFinalCarry = sumDeliveredCash + lastDayCarriedForwardCash;
  const cumulativeCashBoxDiff = netCumulativeCashInBox - totalSettledAndFinalCarry;

  return {
    activeDaysCount,
    lockedDaysCount,
    countCars,
    countDebtVouchers,
    pendingCarsCount,
    avgCarWeight,
    sumW1,
    sumW2,
    sumNetW,
    avgPrice,
    sumBase,
    sumTip,
    sumTotalWithTip,
    sumCashSales,
    sumTransferSales,
    sumCreditSales,
    sumDebtCash,
    sumDebtTransfer,
    totalDebtCollected,
    closingFarmDebt,
    sumPrevCash,
    sumPrevTransfer,
    currentFarmTransfers,
    totalAllTransfers,
    sumPaidAndCredit,
    sumInvoiceDiff,
    sumExpenses,
    totalCashInflowBeforeExpenses,
    netCumulativeCashInBox,
    sumDeliveredCash,
    latestDayWithCarry,
    lastDayCarriedForwardCash,
    totalSettledAndFinalCarry,
    cumulativeCashBoxDiff,
    weightAuditDiff
  };
}

function renderFarmCumulativeTrialBalanceUI(summariesList) {
  const ftb = computeFarmCumulativeTrialBalance(summariesList);
  const fName = appState.farmName || 'أبوذكري';

  const titleEl = document.getElementById('farmTbTitle');
  if (titleEl) titleEl.textContent = `${fName} — ${ftb.activeDaysCount} يوم نشط`;
  const subEl = document.getElementById('farmTbActiveDaysSub');
  if (subEl) {
    subEl.textContent = `${ftb.activeDaysCount} يوم نشط/مفتوح${ftb.lockedDaysCount > 0 ? ` (منها ${ftb.lockedDaysCount} يوم معتمد ومقفل 🔒)` : ''}`;
  }

  const p1El = document.getElementById('farmTbPillar1');
  if (p1El) {
    const pendHtml = ftb.pendingCarsCount > 0
      ? `<span class="px-2 py-0.5 rounded bg-amber-200 text-rose-900 border border-rose-400 font-extrabold">⚠️ ${fmtInt(ftb.pendingCarsCount)} سيارة مؤقتة تحت التحميل!</span>`
      : `<strong class="text-emerald-800">0 سيارة (لا توجد سيارات معلقة ✓)</strong>`;
    p1El.innerHTML = `
      <div class="flex justify-between py-1 border-b">
        <span>إجمالي الأيام النشطة (والمعتمدة):</span>
        <strong>${fmtInt(ftb.activeDaysCount)} يوم <span class="text-[11px] text-emerald-800">(${fmtInt(ftb.lockedDaysCount)} يوم معتمد 🔒)</span></strong>
      </div>
      <div class="flex justify-between py-1 border-b">
        <span>إجمالي السيارات المكتملة (متوسط السيارة):</span>
        <strong>${fmtInt(ftb.countCars)} سيارة <span class="text-[11px] text-slate-500">(${fmtInt(ftb.avgCarWeight)} كجم)</span></strong>
      </div>
      <div class="flex justify-between items-center py-1 border-b ${ftb.pendingCarsCount > 0 ? 'bg-amber-50 px-1.5 rounded border-amber-300' : ''}">
        <span>إجمالي السيارات المؤقتة بالمزرعة:</span>
        ${pendHtml}
      </div>
      <div class="flex justify-between py-1 border-b"><span>إجمالي الوزنة الثانية (القائم التراكمي):</span><strong>${fmtInt(ftb.sumW2)} كجم</strong></div>
      <div class="flex justify-between py-1 border-b"><span>(-) إجمالي الوزنة الأولى (الفارغ التراكمي):</span><strong>${fmtInt(ftb.sumW1)} كجم</strong></div>
      <div class="flex justify-between py-1.5 border-b bg-sky-50/80 px-1.5 rounded font-extrabold text-sky-950">
        <span>(=) إجمالي الوزن الصافي التراكمي للمزرعة:</span>
        <strong>${fmtInt(ftb.sumNetW)} كجم</strong>
      </div>
      <div class="flex justify-between py-1 border-b text-indigo-950">
        <span>متوسط سعر الكيلو المرجح للمزرعة:</span>
        <strong>${fmtDec(ftb.avgPrice)} ج.م/كجم <span class="text-[10px] text-slate-500">(إكراميات: ${fmtInt(ftb.sumTip)})</span></strong>
      </div>
      <div class="flex justify-between p-1.5 rounded ${ftb.weightAuditDiff === 0 ? 'bg-emerald-100 text-emerald-950' : 'bg-rose-100 text-rose-900'} font-extrabold">
        <span>فرق ميزان الأوزان التراكمي (جميع الأيام):</span>
        <span>${fmtInt(ftb.weightAuditDiff)} (${ftb.weightAuditDiff === 0 ? 'أوزان المزرعة مطابقة ✓' : 'راجع الأوزان!'})</span>
      </div>
    `;
  }

  const p2El = document.getElementById('farmTbPillar2');
  if (p2El) {
    const invBalancedOk = Math.abs(ftb.sumInvoiceDiff) <= 1;
    p2El.innerHTML = `
      <div class="flex justify-between py-1.5 border-b bg-amber-50 px-1.5 rounded font-extrabold text-amber-950">
        <span>إجمالي مبيعات المزرعة شامل الإكرامية:</span>
        <span>${fmtDec(ftb.sumTotalWithTip)} ج.م</span>
      </div>
      <div class="flex justify-between py-1 border-b">
        <span>إجمالي النقدي يوم البيع + غير النقدي (آجل+تحويل):</span>
        <strong>نقدي: ${fmtInt(ftb.sumCashSales)} | غير نقدي: ${fmtInt(ftb.sumCreditSales + ftb.sumTransferSales)}</strong>
      </div>
      <div class="flex justify-between py-1 border-b text-teal-900">
        <span>تحويلات المزرعة الحالية (مبيعات ${fmtInt(ftb.sumTransferSales)} + مديونيات ${fmtInt(ftb.sumDebtTransfer)}):</span>
        <strong>${fmtInt(ftb.currentFarmTransfers)} ج.م</strong>
      </div>
      <div class="flex justify-between py-1 border-b text-purple-900">
        <span>تحويلات مزارع سابقة (لا تخصم من الحالية):</span>
        <strong>${fmtInt(ftb.sumPrevTransfer)} ج.م</strong>
      </div>
      <div class="flex justify-between p-1.5 rounded bg-emerald-100 text-emerald-950 font-extrabold">
        <span>إجمالي جميع التحويلات والشيكات بالمزرعة:</span>
        <span>${fmtInt(ftb.totalAllTransfers)} ج.م</span>
      </div>
      <div class="flex justify-between p-1.5 rounded border ${invBalancedOk ? 'bg-slate-50 border-slate-200 text-emerald-900' : 'bg-rose-50 border-rose-300 text-rose-900'} font-extrabold text-[11px]">
        <span>مطابقة توازن فواتير المزرعة (المسدد والآجل - الفواتير):</span>
        <span>${fmtDec(ftb.sumInvoiceDiff)} ج.م (${invBalancedOk ? 'فواتير متزنة ✓' : '⚠️ فرق توازن!'})</span>
      </div>
      <!-- معادلة المطابقة الاستحقاقية التراكمية لذمم ومديونية المزرعة عبر كل الأيام -->
      <div class="mt-1.5 p-2 rounded-xl bg-indigo-50/80 border border-indigo-200 space-y-1 text-[11px]">
        <div class="font-extrabold text-indigo-950 border-b border-indigo-200 pb-1 flex items-center justify-between">
          <span>📌 الخلاصة التراكمية لذمم ومديونية المزرعة:</span>
          <span class="text-[10px] px-1.5 py-0.5 rounded bg-indigo-900 text-amber-300">شامل كل الأيام</span>
        </div>
        <div class="flex justify-between text-amber-950">
          <span>(+) إجمالي آجل الفواتير المسجل بكل الأيام:</span>
          <strong>${fmtInt(ftb.sumCreditSales)} ج.م</strong>
        </div>
        <div class="flex justify-between text-teal-900">
          <span>(-) إجمالي المسدد من المديونية (نقدي ${fmtInt(ftb.sumDebtCash)} + تحويل ${fmtInt(ftb.sumDebtTransfer)}):</span>
          <strong>${fmtInt(ftb.totalDebtCollected)} ج.م</strong>
        </div>
        <div class="flex justify-between pt-1 border-t border-indigo-200 font-extrabold text-indigo-950 text-xs">
          <span>(=) صافي مديونية المزرعة المتبقية لدى التجار:</span>
          <span>${fmtInt(ftb.closingFarmDebt)} ج.م</span>
        </div>
      </div>
    `;
  }

  const p3El = document.getElementById('farmTbPillar3');
  if (p3El) {
    p3El.innerHTML = `
      <div class="flex justify-between py-1 border-b">
        <span>(+) إجمالي نقدي المبيعات (جميع الأيام):</span>
        <strong>${fmtInt(ftb.sumCashSales)} ج.م</strong>
      </div>
      <div class="flex justify-between py-1 border-b">
        <span>(+) إجمالي نقدي تحصيل مديونيات المزرعة الحالية:</span>
        <strong>${fmtInt(ftb.sumDebtCash)} ج.م</strong>
      </div>
      <div class="flex justify-between py-1 border-b text-purple-900">
        <span>(+) إجمالي نقدي مزارع سابقة (للخزنة فقط):</span>
        <strong>${fmtInt(ftb.sumPrevCash)} ج.م</strong>
      </div>
      <div class="flex justify-between py-1 px-1.5 rounded bg-amber-100 text-slate-950 font-extrabold">
        <span>(=) إجمالي وارد النقدية التراكمي (قبل المصاريف):</span>
        <span>${fmtInt(ftb.totalCashInflowBeforeExpenses)} ج.م</span>
      </div>
      <div class="flex justify-between py-1 border-b text-rose-800 font-bold">
        <span>(-) يخصم: إجمالي المصروفات والمكافآت (جميع الأيام):</span>
        <span>${fmtInt(ftb.sumExpenses)} ج.م</span>
      </div>
      <div class="flex justify-between py-1.5 px-2 rounded-lg bg-emerald-100 border border-emerald-400 text-emerald-950 font-extrabold">
        <span>(=) صافي النقدية التراكمية بالخزنة (بعد المصاريف):</span>
        <span>${fmtInt(ftb.netCumulativeCashInBox)} ج.م</span>
      </div>
      <div class="flex justify-between py-1 border-b text-blue-950 font-extrabold mt-1">
        <span>(-) إجمالي النقدية الموردة للإدارة (عبر كل الأيام):</span>
        <span>${fmtInt(ftb.sumDeliveredCash)} ج.م</span>
      </div>
      <div class="flex justify-between py-1 border-b text-teal-900 font-bold">
        <span>(-) الرصيد النقدي المرحّل بآخر يوم نشط${ftb.latestDayWithCarry > 0 ? ` (يوم ${ftb.latestDayWithCarry})` : ''}:</span>
        <span>${fmtInt(ftb.lastDayCarriedForwardCash)} ج.م</span>
      </div>
    `;
  }

  const diffBox = document.getElementById('farmTbCashDiffBox');
  if (diffBox) {
    const statusTxt = ftb.cumulativeCashBoxDiff === 0
      ? 'خزينة المزرعة مطابقة تماماً ✓'
      : (ftb.cumulativeCashBoxDiff < 0 ? 'زيادة توريد تراكمية' : 'متبقي بالخزنة غير مورد / عجز');
    diffBox.className = `p-2.5 rounded-lg font-extrabold flex flex-col gap-1 text-xs mt-2 ${
      ftb.cumulativeCashBoxDiff === 0
        ? 'bg-emerald-100 text-emerald-950 border border-emerald-300'
        : 'bg-rose-100 text-rose-900 border border-rose-300'
    }`;
    diffBox.innerHTML = `
      <div class="flex items-center justify-between">
        <span>فرق الخزينة التراكمي للمزرعة (صافي النقدية - المورد والمرحّل):</span>
        <span>${fmtInt(ftb.cumulativeCashBoxDiff)} ج.م (${statusTxt})</span>
      </div>
    `;
  }
}

function checkConditionFilter(rawVal, dispVal, colType, op, targetStr) {
  if (!op || targetStr === '' || targetStr === null || targetStr === undefined) return true;
  const tClean = String(targetStr).replace(/,/g, '').trim();
  if (op === 'contains') {
    return String(dispVal).toLowerCase().includes(tClean.toLowerCase()) || String(rawVal).toLowerCase().includes(tClean.toLowerCase());
  }
  if (colType === 'number') {
    const nVal = Number(rawVal) || 0;
    const nTarget = parseFloat(tClean);
    if (isNaN(nTarget)) return true;
    if (op === 'eq') return Math.abs(nVal - nTarget) < 0.005;
    if (op === 'neq') return Math.abs(nVal - nTarget) >= 0.005;
    if (op === 'gt') return nVal > nTarget;
    if (op === 'gte') return nVal >= nTarget;
    if (op === 'lt') return nVal < nTarget;
    if (op === 'lte') return nVal <= nTarget;
  } else {
    const sVal = String(dispVal).trim().toLowerCase();
    const sTarget = tClean.toLowerCase();
    if (op === 'eq') return sVal === sTarget;
    if (op === 'neq') return sVal !== sTarget;
    if (op === 'gt') return sVal > sTarget;
    if (op === 'gte') return sVal >= sTarget;
    if (op === 'lt') return sVal < sTarget;
    if (op === 'lte') return sVal <= sTarget;
  }
  return true;
}

function applyExcelSortAndFilter(rows, columns, tableId, excludeColKey = null) {
  const st = excelTableState[tableId];
  if (!st) return rows;
  const q = (st.searchQuery || '').trim().toLowerCase();

  let filtered = rows.filter(row => {
    if (q) {
      const matchAny = columns.some(col => {
        const d = String(col.getDisp(row) || '').toLowerCase();
        const v = String(col.getVal(row) || '').toLowerCase();
        return d.includes(q) || v.includes(q);
      });
      if (!matchAny) return false;
    }
    for (const col of columns) {
      if (excludeColKey && col.key === excludeColKey) continue;
      const cf = st.colFilters[col.key];
      if (!cf) continue;
      const disp = String(col.getDisp(row));
      const raw = col.getVal(row);
      if (cf.allowedValues && Array.isArray(cf.allowedValues)) {
        if (!cf.allowedValues.includes(disp)) return false;
      }
      if (cf.op && cf.val !== '') {
        if (!checkConditionFilter(raw, disp, col.type, cf.op, cf.val)) return false;
      }
    }
    return true;
  });

  if (st.sortCol && !excludeColKey) {
    const sortColObj = columns.find(c => c.key === st.sortCol);
    if (sortColObj) {
      const dir = st.sortDir === 'desc' ? -1 : 1;
      filtered = [...filtered].sort((a, b) => {
        const va = sortColObj.getVal(a);
        const vb = sortColObj.getVal(b);
        if (sortColObj.type === 'number') {
          return ((Number(va) || 0) - (Number(vb) || 0)) * dir;
        }
        return String(va).localeCompare(String(vb), 'ar') * dir;
      });
    }
  }
  return filtered;
}

function isColumnFilteredOrSorted(tableId, colKey) {
  const st = excelTableState[tableId];
  if (!st) return { sorted: false, sortDir: '', filtered: false };
  const sorted = st.sortCol === colKey;
  const cf = st.colFilters[colKey];
  const filtered = Boolean(cf && ((cf.allowedValues && Array.isArray(cf.allowedValues)) || (cf.op && cf.val !== '')));
  return { sorted, sortDir: st.sortDir, filtered };
}

function updateReceiptToggleBtnsUI() {
  const isShowing = Boolean(excelTableState.showScaleReceiptButtons);
  document.querySelectorAll('[data-toggle-receipt-btns]').forEach(btn => {
    if (isShowing) {
      btn.innerHTML = '<span>🔼</span><span>إخفاء بون الميزان ✓</span>';
      btn.className = 'px-2.5 py-1 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-xs shadow-sm transition inline-flex items-center gap-1 border border-emerald-300';
    } else {
      btn.innerHTML = '<span>🖨️</span><span>إظهار بون الميزان</span>';
      btn.className = 'px-2.5 py-1 rounded-xl bg-indigo-900 hover:bg-indigo-800 text-amber-300 font-extrabold text-xs shadow-sm transition inline-flex items-center gap-1 border border-indigo-700';
    }
  });
}

function updateColFilterToggleBtnUI(tableId) {
  const st = excelTableState[tableId];
  if (!st) return;
  const isShowing = Boolean(st.showColFilters);
  const activeColCount = Object.keys(st.colFilters || {}).filter(k => isColumnFilteredOrSorted(tableId, k).filtered).length + (st.sortCol ? 1 : 0);
  document.querySelectorAll(`[data-toggle-col-filters="${tableId}"]`).forEach(btn => {
    if (isShowing) {
      btn.innerHTML = `<span>🔼</span><span>إخفاء الفلاتر${activeColCount > 0 ? ` (${activeColCount} نشط)` : ''}</span>`;
      btn.className = 'px-2.5 py-1 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-xs shadow-sm transition inline-flex items-center gap-1 border border-emerald-300';
    } else if (activeColCount > 0) {
      btn.innerHTML = `<span>⏳</span><span>الفلاتر نشطة (${activeColCount}) — إظهار</span>`;
      btn.className = 'px-2.5 py-1 rounded-xl bg-indigo-700 hover:bg-indigo-600 text-white font-extrabold text-xs shadow-sm transition inline-flex items-center gap-1 border border-amber-300';
    } else {
      btn.innerHTML = `<span>🔽</span><span>تفعيل الفلاتر</span>`;
      btn.className = 'px-2.5 py-1 rounded-xl bg-blue-900 hover:bg-blue-800 text-white font-extrabold text-xs shadow-sm transition inline-flex items-center gap-1 border border-blue-700';
    }
  });
}

function renderExcelHeaderCell(tableId, col, isLightHeader = false) {
  const thBase = col.thClass || '';
  const alignCls = col.alignRight ? 'text-right' : 'text-center';
  const showButtons = Boolean(excelTableState[tableId] && excelTableState[tableId].showColFilters);
  if (col.noFilter || !showButtons) {
    return `<th class="p-1 border ${thBase} ${alignCls} select-none align-middle">${col.label}</th>`;
  }
  const state = isColumnFilteredOrSorted(tableId, col.key);
  const activeHighlight = state.sorted || state.filtered;
  const icon = state.sorted ? (state.sortDir === 'asc' ? '🔼' : '🔽') : (state.filtered ? '⏳' : '▼');
  const defaultBtnCls = (isLightHeader || col.lightBg)
    ? 'bg-slate-200/80 hover:bg-slate-300 text-slate-800 border-slate-300'
    : 'bg-white/15 hover:bg-white/30 text-white border-white/25';
  const btnCls = activeHighlight
    ? 'bg-amber-400 text-slate-950 border-amber-600 font-extrabold shadow-sm'
    : defaultBtnCls;
  return `
    <th class="p-1 border ${thBase} ${alignCls} select-none align-middle">
      <div class="leading-tight">
        <span>${col.label}</span>
        <button type="button" data-excel-filter-btn="${tableId}:${col.key}"
          title="فرز وتصفية عمود (${col.label}) مثل الإكسيل"
          class="inline-flex items-center justify-center px-1 py-0 mr-0.5 rounded text-[9px] leading-none border transition align-middle ${btnCls}">
          ${icon}
        </button>
      </div>
    </th>
  `;
}

function extractCellRawVal(tr, idx, type) {
  if (!tr || !tr.children || !tr.children[idx]) return type === 'number' ? 0 : '';
  const txt = (tr.children[idx].textContent || '').trim();
  if (type === 'number') {
    const cleaned = txt.replace(/[^0-9.-]/g, '');
    const n = parseFloat(cleaned);
    return isFinite(n) ? n : 0;
  }
  return txt;
}

function extractCellDispVal(tr, idx) {
  if (!tr || !tr.children || !tr.children[idx]) return '';
  return (tr.children[idx].textContent || '').replace(/\s+/g, ' ').trim();
}

function makeDomCols(defs) {
  return defs.map((d, idx) => ({
    key: `c${idx}`,
    colIdx: idx,
    label: d.label,
    type: d.type || 'text',
    thClass: d.thClass || '',
    lightBg: Boolean(d.lightBg),
    alignRight: Boolean(d.alignRight),
    noFilter: Boolean(d.noFilter),
    sumInFooter: Boolean(d.sumInFooter),
    isDec: Boolean(d.isDec),
    getVal: tr => extractCellRawVal(tr, idx, d.type || 'text'),
    getDisp: tr => extractCellDispVal(tr, idx)
  }));
}

const DOM_EXCEL_TABLES = {
  dailySales: {
    theadRowId: 'dailySalesTheadRow',
    tbodyId: 'dailySalesTbody',
    tfootId: 'dailySalesTfoot',
    lightHeader: true,
    seqColIdx: 0,
    footerLabelColspan: 4,
    footerLabelText: cnt => `إجمالي المعروض (${cnt} حركة)`,
    columns: makeDomCols([
      { label: 'م', type: 'number' },
      { label: 'كود', type: 'number' },
      { label: 'اسم التاجر / السيارة', type: 'text', alignRight: true },
      { label: 'ميزان/سيارة', type: 'text' },
      { label: 'وزنة 1', type: 'number', sumInFooter: true },
      { label: 'وزنة 2', type: 'number', sumInFooter: true },
      { label: 'الصافي', type: 'number', thClass: 'bg-blue-50', lightBg: true, sumInFooter: true },
      { label: 'السعر', type: 'number', isDec: true },
      { label: 'إكرامية', type: 'number', sumInFooter: true },
      { label: 'الإجمالي بالإكرامية', type: 'number', thClass: 'bg-blue-50', lightBg: true, sumInFooter: true, isDec: true },
      { label: 'نقدي مبيعات', type: 'number', thClass: 'bg-emerald-50', lightBg: true, sumInFooter: true },
      { label: 'تحويل مبيعات', type: 'number', thClass: 'bg-amber-50', lightBg: true, sumInFooter: true },
      { label: 'آجل اليوم', type: 'number', sumInFooter: true },
      { label: 'مديونيات (نقدي/تحويل)', type: 'number', thClass: 'bg-teal-50', lightBg: true, sumInFooter: true },
      { label: 'سابقة (نقدي/تحويل)', type: 'number', thClass: 'bg-purple-50', lightBg: true, sumInFooter: true },
      { label: 'الفرق', type: 'number', sumInFooter: true, isDec: true },
      { label: 'إجراء', noFilter: true }
    ])
  },
  pendingWeighIns: {
    theadRowId: 'pendingWeighInsTheadRow',
    tbodyId: 'pendingWeighInsTbody',
    lightHeader: true,
    columns: makeDomCols([
      { label: 'ميزان رقم', type: 'number' },
      { label: 'اسم التاجر', type: 'text', alignRight: true },
      { label: 'رقم السيارة', type: 'number' },
      { label: 'وزنة أولى (فارغ)', type: 'number' },
      { label: 'السعر / الإكرامية', type: 'text' },
      { label: 'العهدة / البيانات المحفوظة', type: 'text', alignRight: true },
      { label: 'إجراء', noFilter: true }
    ])
  },
  dailyExpenses: {
    theadRowId: 'dailyExpensesTheadRow',
    tbodyId: 'dailyExpensesTbody',
    lightHeader: true,
    seqColIdx: 0,
    columns: makeDomCols([
      { label: 'م', type: 'number' },
      { label: 'تصنيف المنصرف', type: 'text', alignRight: true },
      { label: 'بيان الصرف التفصيلي', type: 'text', alignRight: true },
      { label: 'اسم المستلم', type: 'text' },
      { label: 'المبلغ المخصوم من النقدية', type: 'number' },
      { label: 'إجراء (تعديل / حذف)', noFilter: true }
    ])
  },
  transfers: {
    theadRowId: 'transfersTheadRow',
    tbodyId: 'transfersTbody',
    tfootId: 'transfersTfoot',
    lightHeader: false,
    footerLabelColspan: 2,
    footerLabelText: cnt => `إجمالي التحويلات والشيكات (${cnt} تاجر)`,
    columns: makeDomCols([
      { label: 'الكود', type: 'number' },
      { label: 'اسم التاجر', type: 'text', alignRight: true },
      { label: 'تحويلات مبيعات (حالية)', type: 'number', sumInFooter: true },
      { label: 'تحويلات مديونيات (حالية)', type: 'number', sumInFooter: true },
      { label: 'إجمالي تحويلات المزرعة الحالية (تخصم)', type: 'number', thClass: 'bg-emerald-800', sumInFooter: true },
      { label: 'تحويلات مزارع سابقة (لا تخصم)', type: 'number', thClass: 'bg-purple-900', sumInFooter: true },
      { label: 'تحويل كاش / محفظة', type: 'number', thClass: 'bg-amber-500 text-slate-950', lightBg: true, sumInFooter: true },
      { label: 'تحويل بنكي', type: 'number', thClass: 'bg-amber-500 text-slate-950', lightBg: true, sumInFooter: true },
      { label: 'إنستا باي', type: 'number', thClass: 'bg-amber-500 text-slate-950', lightBg: true, sumInFooter: true },
      { label: 'شيكات', type: 'number', thClass: 'bg-amber-500 text-slate-950', lightBg: true, sumInFooter: true },
      { label: 'الإجمالي العام لتحويلات التاجر', type: 'number', thClass: 'bg-slate-900', sumInFooter: true }
    ])
  },
  prevFarms: {
    theadRowId: 'prevFarmsTheadRow',
    tbodyId: 'prevFarmsTbody',
    tfootId: 'prevFarmsTfoot',
    lightHeader: false,
    footerLabelColspan: 2,
    footerLabelText: cnt => `إجمالي تحصيلات المزارع السابقة (${cnt} تاجر)`,
    columns: makeDomCols([
      { label: 'الكود', type: 'number' },
      { label: 'اسم التاجر', type: 'text', alignRight: true },
      { label: 'محصل نقدي (يضاف للخزنة)', type: 'number', thClass: 'bg-emerald-800', sumInFooter: true },
      { label: 'محصل بتحويل (معاملة التحويلات)', type: 'number', thClass: 'bg-amber-600', sumInFooter: true },
      { label: 'إجمالي تحصيلات المزارع السابقة', type: 'number', thClass: 'bg-purple-800', sumInFooter: true },
      { label: 'بيان الموقع السابق / الملاحظات والأيام', type: 'text', alignRight: true }
    ])
  },
  expSummary: {
    theadRowId: 'expSummaryTheadRow',
    tbodyId: 'expSummaryTbody',
    tfootId: 'expSummaryTfoot',
    lightHeader: false,
    seqColIdx: 0,
    footerLabelColspan: 2,
    footerLabelText: cnt => `إجمالي المصروفات والمكافآت (${cnt} بند)`,
    columns: makeDomCols([
      { label: 'م', type: 'number' },
      { label: 'بند / تصنيف المصروفات والمكافآت', type: 'text', alignRight: true },
      { label: 'إجمالي المنصرف (10 أيام)', type: 'number', thClass: 'bg-rose-800', sumInFooter: true },
      { label: 'النسبة %', type: 'number' },
      { label: 'يوم 1', type: 'number', sumInFooter: true },
      { label: 'يوم 2', type: 'number', sumInFooter: true },
      { label: 'يوم 3', type: 'number', sumInFooter: true },
      { label: 'يوم 4', type: 'number', sumInFooter: true },
      { label: 'يوم 5', type: 'number', sumInFooter: true },
      { label: 'يوم 6', type: 'number', sumInFooter: true },
      { label: 'يوم 7', type: 'number', sumInFooter: true },
      { label: 'يوم 8', type: 'number', sumInFooter: true },
      { label: 'يوم 9', type: 'number', sumInFooter: true },
      { label: 'يوم 10', type: 'number', sumInFooter: true }
    ])
  },
  usersList: {
    theadRowId: 'usersListTheadRow',
    tbodyId: 'usersListTbody',
    lightHeader: true,
    columns: makeDomCols([
      { label: 'الاسم الكامل / المسمى', type: 'text', alignRight: true },
      { label: 'اسم الدخول (Username)', type: 'text' },
      { label: 'كلمة المرور', type: 'text' },
      { label: 'الهاتف / الوظيفة', type: 'text' },
      { label: 'نوع الحساب', type: 'text' },
      { label: 'الصلاحيات الممنوحة', type: 'text', alignRight: true },
      { label: 'إجراء (تفعيل / تعديل بيانات / حذف)', noFilter: true }
    ])
  },
  cloudFarms: {
    theadRowId: 'cloudFarmsTheadRow',
    tbodyId: 'cloudFarmsTbody',
    lightHeader: true,
    columns: makeDomCols([
      { label: 'اسم المزرعة / الدورة', type: 'text', alignRight: true },
      { label: 'عدد السيارات', type: 'number' },
      { label: 'إجمالي الوزن الصافي', type: 'number' },
      { label: 'إجمالي المبيعات', type: 'number' },
      { label: 'صافي الخزنة النقدية', type: 'number' },
      { label: 'صافي مديونية المزرعة', type: 'number' },
      { label: 'استخراج الإكسيل / فتح', noFilter: true }
    ])
  }
};

const domTableRawCache = {};

function applyDomTableExcelEngine(tableId) {
  const cfg = DOM_EXCEL_TABLES[tableId];
  if (!cfg) return;
  const theadRow = document.getElementById(cfg.theadRowId);
  const tbody = document.getElementById(cfg.tbodyId);
  if (!tbody) return;

  updateColFilterToggleBtnUI(tableId);
  // Render Excel Filterable Header Row
  if (theadRow) {
    theadRow.innerHTML = cfg.columns.map(col => renderExcelHeaderCell(tableId, col, cfg.lightHeader)).join('');
  }

  // Capture freshly rendered rows into cache
  const currentTrs = Array.from(tbody.querySelectorAll('tr'));
  const isSingleEmptyMessage = currentTrs.length === 1 && currentTrs[0].children.length === 1 && currentTrs[0].children[0].colSpan > 1;
  if (!isSingleEmptyMessage) {
    domTableRawCache[tableId] = currentTrs.map(tr => tr.cloneNode(true));
  } else {
    domTableRawCache[tableId] = [];
  }

  const rawRows = domTableRawCache[tableId] || [];
  if (rawRows.length === 0) return;

  const st = excelTableState[tableId];
  const hasAnyFilterOrSort = Boolean(
    (st.searchQuery && st.searchQuery.trim()) ||
    st.sortCol ||
    Object.keys(st.colFilters).some(k => isColumnFilteredOrSorted(tableId, k).filtered)
  );

  if (!hasAnyFilterOrSort) return;

  const filteredRows = applyExcelSortAndFilter(rawRows, cfg.columns, tableId);
  tbody.innerHTML = '';

  if (filteredRows.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="${cfg.columns.length}" class="p-4 text-center text-slate-500 font-bold">
          لا توجد نتائج مطابقة للفلتر الحالي في هذا الجدول — اضغط على <strong>"🔄 مسح الفلتر"</strong> لإظهار جميع السجلات.
        </td>
      </tr>
    `;
  } else {
    filteredRows.forEach((trClone, idx) => {
      const node = trClone.cloneNode(true);
      if (cfg.seqColIdx !== undefined && node.children[cfg.seqColIdx]) {
        node.children[cfg.seqColIdx].textContent = String(idx + 1);
      }
      tbody.appendChild(node);
    });
  }

  // Dynamically recalculate footer totals if table has tfoot
  if (cfg.tfootId && cfg.footerLabelColspan) {
    const tfoot = document.getElementById(cfg.tfootId);
    if (tfoot) {
      const span = cfg.footerLabelColspan;
      let cellsHtml = `<td colspan="${span}" class="p-1.5 border text-center">${cfg.footerLabelText(filteredRows.length)}</td>`;
      for (let cIdx = span; cIdx < cfg.columns.length; cIdx++) {
        const col = cfg.columns[cIdx];
        if (col.sumInFooter) {
          const sum = filteredRows.reduce((acc, r) => acc + (Number(col.getVal(r)) || 0), 0);
          cellsHtml += `<td class="p-1.5 border text-left">${col.isDec ? fmtDec(sum) : fmtInt(sum)}</td>`;
        } else {
          cellsHtml += `<td class="p-1.5 border text-center"></td>`;
        }
      }
      tfoot.innerHTML = `<tr>${cellsHtml}</tr>`;
    }
  }
}

function renderDashboardView() {
  const fName = appState.farmName || 'أبوذكري';
  const titleEl = document.getElementById('dashFarmNameTitle');
  if (titleEl) titleEl.textContent = fName;

  // فقط الأيام المفتوحة والتي عليها سجل حركات (الأيام غير النشطة تظل مخفية)
  const openActiveSummaries = getOpenAndActiveDashSummaries();
  const filteredSummaries = applyExcelSortAndFilter(openActiveSummaries, DASH_COLUMNS, 'dash');

  const badgeEl = document.getElementById('dashActiveDaysBadge');
  if (badgeEl) {
    badgeEl.textContent = `الأيام المفتوحة والنشطة: ${openActiveSummaries.length} يوم (المعروض: ${filteredSummaries.length})`;
  }

  updateColFilterToggleBtnUI('dash');
  // Update Dashboard Filter Hint
  const dashSt = excelTableState.dash;
  const activeColFiltersCount = Object.keys(dashSt.colFilters).filter(k => isColumnFilteredOrSorted('dash', k).filtered).length;
  const dashHint = document.getElementById('dashFilterStatusHint');
  if (dashHint) {
    if (activeColFiltersCount > 0 || dashSt.sortCol || dashSt.searchQuery) {
      dashHint.textContent = `✅ الفلتر/الفرز نشط: معروض (${filteredSummaries.length}) من إجمالي (${openActiveSummaries.length}) يوم مفتوح`;
      dashHint.className = 'text-[11px] font-extrabold text-amber-950 bg-amber-100 border border-amber-300 px-2.5 py-1 rounded-lg';
    } else if (dashSt.showColFilters) {
      dashHint.textContent = 'أزرار الفلاتر مفعلة الآن — اضغط على زر (▼) في رأس أي عمود للفرز أو التصفية';
      dashHint.className = 'text-[11px] font-extrabold text-emerald-900 bg-emerald-50 border border-emerald-300 px-2.5 py-1 rounded-lg';
    } else {
      dashHint.textContent = 'البحث السريع متاح دائماً — اضغط (🔽 تفعيل الفلاتر) لإظهار الفلاتر على الأعمدة';
      dashHint.className = 'text-[11px] font-bold text-blue-900 bg-blue-50 border border-blue-200 px-2.5 py-1 rounded-lg';
    }
  }

  const totals = filteredSummaries.reduce((acc, s) => {
    acc.cars += s.countCars;
    acc.netW += s.sumNetW;
    acc.sales += s.sumTotalWithTip;
    acc.cashSales += s.sumCashSales;
    acc.creditSales += s.sumCreditSales;
    acc.debtCash += s.sumDebtCash;
    acc.debtTransfer += s.sumDebtTransfer;
    acc.currTransfers += s.currentFarmTransfers;
    acc.prevCash += s.sumPrevCash;
    acc.prevTransfers += s.sumPrevTransfer;
    acc.cashBeforeExp += s.totalCashBeforeExpenses;
    acc.expenses += s.sumExpenses;
    acc.netCash += s.netCashInBox;
    acc.delivered += s.deliveredCash;
    acc.cashDiff += s.cashBoxDiff;
    return acc;
  }, {
    cars: 0, netW: 0, sales: 0, cashSales: 0, creditSales: 0, debtCash: 0, debtTransfer: 0,
    currTransfers: 0, prevCash: 0, prevTransfers: 0, cashBeforeExp: 0,
    expenses: 0, netCash: 0, delivered: 0, cashDiff: 0
  });

  const netRemainingCurrentFarmDebt = totals.creditSales - totals.debtCash - totals.debtTransfer;
  const totalAllTransfersDisplayed = totals.currTransfers + totals.prevTransfers;

  const kpis = [
    { lbl: 'إجمالي الوزن الصافي', val: `${fmtInt(totals.netW)} كجم`, bg: 'bg-blue-50 border-blue-200 text-blue-950' },
    { lbl: 'إجمالي المبيعات بالإكرامية', val: `${fmtDec(totals.sales)}`, bg: 'bg-amber-50 border-amber-200 text-amber-950' },
    { lbl: 'إجمالي النقدية (قبل المصاريف)', val: `${fmtInt(totals.cashBeforeExp)}`, bg: 'bg-slate-100 border-slate-300 text-slate-900' },
    { lbl: '(-) إجمالي المصروفات والمكافآت', val: `${fmtInt(totals.expenses)}`, bg: 'bg-rose-50 border-rose-200 text-rose-900' },
    { lbl: 'صافي النقدية بالخزنة (بعد المصاريف)', val: `${fmtInt(totals.netCash)}`, bg: 'bg-emerald-50 border-emerald-300 text-emerald-950' },
    { lbl: 'صافي مديونية المزرعة الحالية', val: `${fmtInt(netRemainingCurrentFarmDebt)}`, bg: 'bg-amber-100/70 border-amber-300 text-slate-950' },
    { lbl: 'إجمالي التحويلات الشامل', val: `${fmtInt(totalAllTransfersDisplayed)}`, bg: 'bg-teal-50 border-teal-200 text-teal-950' }
  ];

  document.getElementById('dashKpiGrid').innerHTML = kpis.map(k => `
    <div class="p-2.5 rounded-xl border ${k.bg}">
      <div class="text-[11px] font-bold opacity-80">${k.lbl}</div>
      <div class="text-sm md:text-base font-extrabold mt-0.5">${k.val}</div>
    </div>
  `).join('');

  // Render Excel Filterable Header Row
  const theadRow = document.getElementById('dashTableTheadRow');
  if (theadRow) {
    theadRow.innerHTML = DASH_COLUMNS.map(col => renderExcelHeaderCell('dash', col)).join('');
  }

  const tbody = document.getElementById('dashTableTbody');
  tbody.innerHTML = '';
  if (filteredSummaries.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="17" class="p-6 text-center text-slate-500 font-bold">
          لا توجد أيام مطابقة للفلتر الحالي — اضغط على <strong>"🔄 مسح فلاتر وفرز الملخص"</strong> لإظهار جميع الأيام المفتوحة.
        </td>
      </tr>
    `;
  } else {
    filteredSummaries.forEach(s => {
      const tr = document.createElement('tr');
      tr.className = 'hover:bg-blue-50/50';
      tr.innerHTML = `
        <td class="p-2 border text-center">
          <button type="button" data-open-day="${s.dayNum}" class="px-2.5 py-1 rounded-lg bg-blue-100 hover:bg-blue-200 text-blue-950 font-extrabold underline">
            فتح يوم ${s.dayNum}
          </button>
        </td>
        <td class="p-2 border font-bold">${escXmlStr(s.dateLabel)}</td>
        <td class="p-2 border text-center font-bold">${fmtInt(s.countCars)}</td>
        <td class="p-2 border text-left font-bold">${fmtInt(s.sumNetW)}</td>
        <td class="p-2 border text-left font-extrabold">${fmtDec(s.sumTotalWithTip)}</td>
        <td class="p-2 border text-left">${fmtInt(s.sumCashSales)}</td>
        <td class="p-2 border text-left">${fmtInt(s.sumCreditSales)}</td>
        <td class="p-2 border text-left">${fmtInt(s.sumDebtCash)}</td>
        <td class="p-2 border text-left font-bold text-teal-900">${fmtInt(s.currentFarmTransfers)}</td>
        <td class="p-2 border text-left text-purple-900">${fmtInt(s.sumPrevCash)}</td>
        <td class="p-2 border text-left text-purple-900">${fmtInt(s.sumPrevTransfer)}</td>
        <td class="p-2 border text-left font-extrabold bg-amber-50">${fmtInt(s.totalCashBeforeExpenses)}</td>
        <td class="p-2 border text-left font-bold text-rose-800 bg-rose-50/50">${fmtInt(s.sumExpenses)}</td>
        <td class="p-2 border text-left font-extrabold text-emerald-900 bg-emerald-50/60">${fmtInt(s.netCashInBox)}</td>
        <td class="p-2 border text-left">${fmtInt(s.deliveredCash)}</td>
        <td class="p-2 border text-left font-bold">${fmtInt(s.cashBoxDiff)}</td>
        <td class="p-2 border text-center font-bold ${s.countCars === 0 && s.sumExpenses === 0 ? 'text-slate-500' : (s.statusOk ? 'text-emerald-800' : 'text-rose-700')}">
          ${escXmlStr(s.statusText)}
        </td>
      `;
      tbody.appendChild(tr);
    });
  }

  document.getElementById('dashTableTfoot').innerHTML = `
    <tr>
      <td colspan="2" class="p-2 border text-center">الإجمالي التراكمي (${filteredSummaries.length} يوم نشط/مفتوح)</td>
      <td class="p-2 border text-center">${fmtInt(totals.cars)}</td>
      <td class="p-2 border text-left">${fmtInt(totals.netW)}</td>
      <td class="p-2 border text-left">${fmtDec(totals.sales)}</td>
      <td class="p-2 border text-left">${fmtInt(totals.cashSales)}</td>
      <td class="p-2 border text-left">${fmtInt(totals.creditSales)}</td>
      <td class="p-2 border text-left">${fmtInt(totals.debtCash)}</td>
      <td class="p-2 border text-left">${fmtInt(totals.currTransfers)}</td>
      <td class="p-2 border text-left">${fmtInt(totals.prevCash)}</td>
      <td class="p-2 border text-left">${fmtInt(totals.prevTransfers)}</td>
      <td class="p-2 border text-left">${fmtInt(totals.cashBeforeExp)}</td>
      <td class="p-2 border text-left">${fmtInt(totals.expenses)}</td>
      <td class="p-2 border text-left">${fmtInt(totals.netCash)}</td>
      <td class="p-2 border text-left">${fmtInt(totals.delivered)}</td>
      <td class="p-2 border text-left">${fmtInt(totals.cashDiff)}</td>
      <td class="p-2 border text-center">الأيام النشطة متزنة ✓</td>
    </tr>
  `;

  renderFarmCumulativeTrialBalanceUI(filteredSummaries);

  // الرسم البياني يعرض الأيام المفتوحة والتي عليها سجل حركات فقط (الأيام غير النشطة تظل مخفية)
  const chartDays = filteredSummaries;
  const ctx = document.getElementById('dashSalesChart');
  if (ctx && typeof Chart !== 'undefined') {
    if (dashChartInstance) dashChartInstance.destroy();
    dashChartInstance = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: chartDays.map(s => `يوم ${s.dayNum} (${s.dateLabel})`),
        datasets: [
          {
            label: 'إجمالي المبيعات بالإكرامية',
            data: chartDays.map(s => Math.round(s.sumTotalWithTip)),
            backgroundColor: '#1b365d'
          },
          {
            label: 'صافي النقدية بالخزنة (بعد المصاريف)',
            data: chartDays.map(s => Math.round(s.netCashInBox)),
            backgroundColor: '#10b981'
          },
          {
            label: 'صافي المديونية / آجل الفواتير',
            data: chartDays.map(s => Math.round(s.sumCreditSales)),
            backgroundColor: '#f59e0b'
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'top', labels: { font: { family: 'Cairo', weight: 'bold' } } }
        }
      }
    });
  }
}

function computeMerchantAggregates() {
  const map = {};
  appState.merchants.forEach(m => {
    map[m.code] = {
      code: m.code,
      name: m.name,
      cars: 0,
      netW: 0,
      totalSales: 0,
      cashSales: 0,
      creditSales: 0,
      transferSales: 0,
      debtCash: 0,
      debtTransfer: 0,
      prevCash: 0,
      prevTransfer: 0,
      byType: { 'تحويل كاش': 0, 'تحويل بنكي': 0, 'إنستا باي': 0, 'شيكات': 0 },
      prevNotes: []
    };
  });

  for (let d = 1; d <= 10; d++) {
    const summary = computeDaySummary(d);
    summary.rows.forEach(r => {
      if (!r.code || !map[r.code]) return;
      const m = map[r.code];
      if (!r.isDebtCollectionOnly) {
        m.cars += 1;
      }
      m.netW += r.netWeight;
      m.totalSales += r.totalWithTip;
      m.cashSales += r.cashSales;
      m.creditSales += r.creditSales;
      m.transferSales += r.transferSales;
      m.debtCash += r.debtCash;
      m.debtTransfer += r.debtTransfer;
      m.prevCash += r.prevCash;
      m.prevTransfer += r.prevTransfer;

      if (r.transferSales > 0 && m.byType[r.transferSalesType] !== undefined) {
        m.byType[r.transferSalesType] += r.transferSales;
      }
      if (r.debtTransfer > 0 && m.byType[r.debtTransferType] !== undefined) {
        m.byType[r.debtTransferType] += r.debtTransfer;
      }
      if (r.prevTransfer > 0 && m.byType[r.prevTransferType] !== undefined) {
        m.byType[r.prevTransferType] += r.prevTransfer;
      }
      if ((r.prevCash > 0 || r.prevTransfer > 0) && r.notes) {
        m.prevNotes.push(`يوم ${d}: ${r.notes}`);
      }
    });
  }

  return Object.values(map).map(enrichMerchantRow).sort((a, b) => a.code - b.code);
}

function isMerchantActiveInCurrentFarm(m) {
  if (!m) return false;
  return (
    m.cars > 0 ||
    m.netW > 0 ||
    m.totalSales > 0 ||
    m.cashSales > 0 ||
    m.creditSales > 0 ||
    m.transferSales > 0 ||
    m.debtCash > 0 ||
    m.debtTransfer > 0 ||
    m.prevCash > 0 ||
    m.prevTransfer > 0
  );
}

function renderMerchantsAndStatements(scopeTab = 'all') {
  const fullList = computeMerchantAggregates();
  const renderMerchTable = (scopeTab === 'all' || scopeTab === 'merchants');
  const renderTransfersTables = (scopeTab === 'all' || scopeTab === 'transfers');

  if (renderMerchTable) {
  const activeList = fullList.filter(isMerchantActiveInCurrentFarm);
  const filterMode = appState.merchantsViewFilter === 'active' ? 'active' : 'all';
  const baseList = filterMode === 'active' ? activeList : fullList;
  const list = applyExcelSortAndFilter(baseList, MERCH_COLUMNS, 'merch');

  // Update Filter Buttons & Counters UI
  const btnAct = document.getElementById('btnFilterMerchActive');
  const btnAll = document.getElementById('btnFilterMerchAll');
  const bdgAct = document.getElementById('badgeActiveMerchCount');
  const bdgAll = document.getElementById('badgeAllMerchCount');
  const hintEl = document.getElementById('merchFilterStatusHint');

  if (bdgAct) bdgAct.textContent = activeList.length;
  if (bdgAll) bdgAll.textContent = fullList.length;

  const merchSt = excelTableState.merch;
  const activeMerchColFilters = Object.keys(merchSt.colFilters).filter(k => isColumnFilteredOrSorted('merch', k).filtered).length;

  if (btnAct && btnAll) {
    if (filterMode === 'active') {
      btnAct.className = 'px-2.5 py-1 rounded-lg text-xs font-extrabold transition flex items-center gap-1 bg-blue-900 text-white shadow-sm';
      btnAll.className = 'px-2.5 py-1 rounded-lg text-xs font-extrabold transition flex items-center gap-1 text-slate-700 hover:bg-white/60';
    } else {
      btnAll.className = 'px-2.5 py-1 rounded-lg text-xs font-extrabold transition flex items-center gap-1 bg-blue-900 text-white shadow-sm';
      btnAct.className = 'px-2.5 py-1 rounded-lg text-xs font-extrabold transition flex items-center gap-1 text-slate-700 hover:bg-white/60';
    }
    updateColFilterToggleBtnUI('merch');
    if (hintEl) {
      if (activeMerchColFilters > 0 || merchSt.sortCol || merchSt.searchQuery) {
        hintEl.textContent = `✅ الفلتر/الفرز نشط: معروض (${list.length}) من (${baseList.length}) تاجر`;
        hintEl.className = 'text-[11px] font-extrabold text-amber-950 bg-amber-100 border border-amber-300 px-2 py-0.5 rounded-lg';
      } else if (merchSt.showColFilters) {
        hintEl.textContent = `أزرار الفلاتر مفعلة — اضغط (▼) في رأس أي عمود للفرز أو التصفية المتعددة`;
        hintEl.className = 'text-[11px] font-extrabold text-emerald-900 bg-emerald-50 border border-emerald-300 px-2 py-0.5 rounded-lg';
      } else if (filterMode === 'active') {
        hintEl.textContent = `معروض (${activeList.length}) تاجر نشط — اضغط (🔽 تفعيل الفلاتر) لإظهار فلاتر الأعمدة`;
        hintEl.className = 'text-[11px] font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-lg';
      } else {
        hintEl.textContent = `معروض دليل التجار المكودين (${fullList.length} تاجر) — اضغط (🔽 تفعيل الفلاتر) لإظهار فلاتر الأعمدة`;
        hintEl.className = 'text-[11px] font-bold text-blue-900 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-lg';
      }
    }
  }

  // Render Excel Filterable Header Row for Merchants Table
  const mTheadRow = document.getElementById('merchantsTheadRow');
  if (mTheadRow) {
    mTheadRow.innerHTML = `
      <th class="p-2 border text-center">م</th>
      ${MERCH_COLUMNS.map(col => renderExcelHeaderCell('merch', col)).join('')}
      <th class="p-2 border bg-slate-800 text-center">إجراء (تعديل / حذف)</th>
    `;
  }

  const mTbody = document.getElementById('merchantsTbody');
  mTbody.innerHTML = '';
  let totCars = 0, totW = 0, totSales = 0, totCash = 0, totNonCash = 0, totCredit = 0;
  let totTrSales = 0, totDebtCash = 0, totDebtTr = 0, totSettled = 0, totNetDebt = 0, totPrevAll = 0;

  if (list.length === 0) {
    mTbody.innerHTML = `
      <tr>
        <td colspan="16" class="p-6 text-center text-slate-500 font-bold">
          لا توجد بيانات مطابقة للفلتر الحالي — يمكنك الضغط على <strong>"📋 جميع التجار المكودين (${fullList.length})"</strong> أو <strong>"🔄 مسح الفلاتر والفرز"</strong> أعلاه.
        </td>
      </tr>
    `;
  }

  list.forEach((m, idx) => {
    const nonCashDayOfSale = m.nonCashDayOfSale;
    const totalSettledCurrent = m.totalSettledCurrent;
    const netDebtCurrent = m.netDebtCurrent;
    const prevAll = m.prevAll;

    totCars += m.cars;
    totW += m.netW;
    totSales += m.totalSales;
    totCash += m.cashSales;
    totNonCash += nonCashDayOfSale;
    totCredit += m.creditSales;
    totTrSales += m.transferSales;
    totDebtCash += m.debtCash;
    totDebtTr += m.debtTransfer;
    totSettled += totalSettledCurrent;
    totNetDebt += netDebtCurrent;
    totPrevAll += prevAll;

    const tr = document.createElement('tr');
    tr.className = idx % 2 === 0 ? 'bg-white' : 'bg-slate-50';
    tr.innerHTML = `
      <td class="p-2 border text-center">${idx + 1}</td>
      <td class="p-2 border text-center font-extrabold text-blue-900">${m.code}</td>
      <td class="p-2 border font-extrabold text-slate-900">
        <button type="button" data-drill-merchant="${m.code}" class="text-right text-blue-900 hover:text-amber-700 underline font-extrabold inline-flex items-center gap-1 transition group" title="اضغط لفتح كشف الحساب التفصيلي بالحركات للتاجر (${escXmlStr(m.name)})">
          <span>${escXmlStr(m.name)}</span>
          <span class="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-800 border border-blue-200">📋 كشف تفصيلي</span>
        </button>
      </td>
      <td class="p-2 border text-center font-bold">${fmtInt(m.cars)}</td>
      <td class="p-2 border text-left">${fmtInt(m.netW)}</td>
      <td class="p-2 border text-left font-bold">${fmtDec(m.totalSales)}</td>
      <td class="p-2 border text-left">${fmtInt(m.cashSales)}</td>
      <td class="p-2 border text-left font-bold">${fmtInt(nonCashDayOfSale)}</td>
      <td class="p-2 border text-left">${fmtInt(m.creditSales)}</td>
      <td class="p-2 border text-left text-teal-900">${fmtInt(m.transferSales)}</td>
      <td class="p-2 border text-left text-teal-900">${fmtInt(m.debtCash)}</td>
      <td class="p-2 border text-left text-teal-900">${fmtInt(m.debtTransfer)}</td>
      <td class="p-2 border text-left font-extrabold bg-emerald-50 text-emerald-950">${fmtInt(totalSettledCurrent)}</td>
      <td class="p-2 border text-left font-extrabold bg-amber-50 text-slate-950">${fmtInt(netDebtCurrent)}</td>
      <td class="p-2 border text-left font-bold text-purple-900">${fmtInt(prevAll)}</td>
      <td class="p-1 border text-center">
        ${hasPermission('merchants') ? `
          <button type="button" data-edit-merchant="${m.code}" class="px-2 py-1 rounded bg-blue-100 text-blue-900 font-bold hover:bg-blue-200 ml-1">✏️ تعديل</button>
          <button type="button" data-del-merchant="${m.code}" class="px-2 py-1 rounded bg-rose-100 text-rose-800 font-bold hover:bg-rose-200">🗑️ حذف</button>
        ` : '<span class="text-slate-400 text-[11px]">🔒 للعرض فقط</span>'}
      </td>
    `;
    mTbody.appendChild(tr);
  });

  document.getElementById('merchantsTfoot').innerHTML = `
    <tr>
      <td colspan="3" class="p-2 border text-center">إجمالي التجار المعروضين (${list.length} تاجر)</td>
      <td class="p-2 border text-center">${fmtInt(totCars)}</td>
      <td class="p-2 border text-left">${fmtInt(totW)}</td>
      <td class="p-2 border text-left">${fmtDec(totSales)}</td>
      <td class="p-2 border text-left">${fmtInt(totCash)}</td>
      <td class="p-2 border text-left">${fmtInt(totNonCash)}</td>
      <td class="p-2 border text-left">${fmtInt(totCredit)}</td>
      <td class="p-2 border text-left">${fmtInt(totTrSales)}</td>
      <td class="p-2 border text-left">${fmtInt(totDebtCash)}</td>
      <td class="p-2 border text-left">${fmtInt(totDebtTr)}</td>
      <td class="p-2 border text-left">${fmtInt(totSettled)}</td>
      <td class="p-2 border text-left">${fmtInt(totNetDebt)}</td>
      <td class="p-2 border text-left">${fmtInt(totPrevAll)}</td>
      <td class="p-2 border"></td>
    </tr>
  `;
  } // end if (renderMerchTable)

  if (renderTransfersTables) {
  // 1) Transfers Table Filter (Active = merchants with transfers > 0 vs All coded merchants)
  const activeTransfersList = fullList.filter(m => (m.transferSales + m.debtTransfer + m.prevTransfer) > 0);
  const trFilterMode = appState.transfersViewFilter === 'active' ? 'active' : 'all';
  const trListToRender = trFilterMode === 'active' ? activeTransfersList : fullList;

  const btnTrAct = document.getElementById('btnFilterTransfersActive');
  const btnTrAll = document.getElementById('btnFilterTransfersAll');
  const bdgTrAct = document.getElementById('badgeActiveTransfersCount');
  const bdgTrAll = document.getElementById('badgeAllTransfersCount');
  if (bdgTrAct) bdgTrAct.textContent = activeTransfersList.length;
  if (bdgTrAll) bdgTrAll.textContent = fullList.length;
  if (btnTrAct && btnTrAll) {
    if (trFilterMode === 'active') {
      btnTrAct.className = 'px-2.5 py-1 rounded-lg text-xs font-extrabold transition flex items-center gap-1 bg-blue-900 text-white shadow-sm';
      btnTrAll.className = 'px-2.5 py-1 rounded-lg text-xs font-extrabold transition flex items-center gap-1 text-slate-700 hover:bg-white/60';
    } else {
      btnTrAll.className = 'px-2.5 py-1 rounded-lg text-xs font-extrabold transition flex items-center gap-1 bg-blue-900 text-white shadow-sm';
      btnTrAct.className = 'px-2.5 py-1 rounded-lg text-xs font-extrabold transition flex items-center gap-1 text-slate-700 hover:bg-white/60';
    }
  }

  const trTbody = document.getElementById('transfersTbody');
  trTbody.innerHTML = '';
  let sumTrCurrSales = 0, sumTrCurrDebt = 0, sumTrPrev = 0;
  let sumCashW = 0, sumBank = 0, sumInsta = 0, sumCheck = 0;

  if (trListToRender.length === 0) {
    trTbody.innerHTML = `<tr><td colspan="11" class="p-4 text-center text-slate-500 font-bold">لا توجد تحويلات مسجلة لتجار نشطين في هذه المزرعة حتى الآن — اضغط على <strong>"📋 عرض دليل جميع التجار المكودين (${fullList.length})"</strong> لإظهار الدليل الكامل.</td></tr>`;
  }

  trListToRender.forEach(m => {
    const currTr = m.transferSales + m.debtTransfer;
    const allTr = currTr + m.prevTransfer;
    sumTrCurrSales += m.transferSales;
    sumTrCurrDebt += m.debtTransfer;
    sumTrPrev += m.prevTransfer;
    sumCashW += m.byType['تحويل كاش'];
    sumBank += m.byType['تحويل بنكي'];
    sumInsta += m.byType['إنستا باي'];
    sumCheck += m.byType['شيكات'];

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="p-2 border text-center font-bold text-blue-900">${m.code}</td>
      <td class="p-2 border font-extrabold">
        <button type="button" data-drill-merchant="${m.code}" class="text-right text-blue-900 hover:text-amber-700 underline font-extrabold inline-flex items-center gap-1 transition" title="اضغط لفتح كشف الحساب التفصيلي بالحركات للتاجر (${escXmlStr(m.name)})">
          <span>${escXmlStr(m.name)}</span>
          <span class="text-[10px] text-blue-700">📋</span>
        </button>
      </td>
      <td class="p-2 border text-left">${fmtInt(m.transferSales)}</td>
      <td class="p-2 border text-left">${fmtInt(m.debtTransfer)}</td>
      <td class="p-2 border text-left font-extrabold bg-emerald-50">${fmtInt(currTr)}</td>
      <td class="p-2 border text-left text-purple-900">${fmtInt(m.prevTransfer)}</td>
      <td class="p-2 border text-left bg-amber-50/50 font-bold">${fmtInt(m.byType['تحويل كاش'])}</td>
      <td class="p-2 border text-left bg-amber-50/50 font-bold">${fmtInt(m.byType['تحويل بنكي'])}</td>
      <td class="p-2 border text-left bg-amber-50/50 font-bold">${fmtInt(m.byType['إنستا باي'])}</td>
      <td class="p-2 border text-left bg-amber-50/50 font-bold">${fmtInt(m.byType['شيكات'])}</td>
      <td class="p-2 border text-left font-extrabold bg-slate-100">${fmtInt(allTr)}</td>
    `;
    trTbody.appendChild(tr);
  });

  document.getElementById('transfersTfoot').innerHTML = `
    <tr>
      <td colspan="2" class="p-2 border text-center">إجمالي التحويلات والشيكات (${trListToRender.length} تاجر)</td>
      <td class="p-2 border text-left">${fmtInt(sumTrCurrSales)}</td>
      <td class="p-2 border text-left">${fmtInt(sumTrCurrDebt)}</td>
      <td class="p-2 border text-left">${fmtInt(sumTrCurrSales + sumTrCurrDebt)}</td>
      <td class="p-2 border text-left">${fmtInt(sumTrPrev)}</td>
      <td class="p-2 border text-left">${fmtInt(sumCashW)}</td>
      <td class="p-2 border text-left">${fmtInt(sumBank)}</td>
      <td class="p-2 border text-left">${fmtInt(sumInsta)}</td>
      <td class="p-2 border text-left">${fmtInt(sumCheck)}</td>
      <td class="p-2 border text-left">${fmtInt(sumTrCurrSales + sumTrCurrDebt + sumTrPrev)}</td>
    </tr>
  `;

  // 2) Previous Farms Table Filter (Active = merchants with prevCash + prevTransfer > 0 vs All coded merchants)
  const activePrevFarmsList = fullList.filter(m => (m.prevCash + m.prevTransfer) > 0 || m.prevNotes.length > 0);
  const pfFilterMode = appState.prevFarmsViewFilter === 'active' ? 'active' : 'all';
  const pfListToRender = pfFilterMode === 'active' ? activePrevFarmsList : fullList;

  const btnPfAct = document.getElementById('btnFilterPrevFarmsActive');
  const btnPfAll = document.getElementById('btnFilterPrevFarmsAll');
  const bdgPfAct = document.getElementById('badgeActivePrevFarmsCount');
  const bdgPfAll = document.getElementById('badgeAllPrevFarmsCount');
  if (bdgPfAct) bdgPfAct.textContent = activePrevFarmsList.length;
  if (bdgPfAll) bdgPfAll.textContent = fullList.length;
  if (btnPfAct && btnPfAll) {
    if (pfFilterMode === 'active') {
      btnPfAct.className = 'px-2.5 py-1 rounded-lg text-xs font-extrabold transition flex items-center gap-1 bg-blue-900 text-white shadow-sm';
      btnPfAll.className = 'px-2.5 py-1 rounded-lg text-xs font-extrabold transition flex items-center gap-1 text-slate-700 hover:bg-white/60';
    } else {
      btnPfAll.className = 'px-2.5 py-1 rounded-lg text-xs font-extrabold transition flex items-center gap-1 bg-blue-900 text-white shadow-sm';
      btnPfAct.className = 'px-2.5 py-1 rounded-lg text-xs font-extrabold transition flex items-center gap-1 text-slate-700 hover:bg-white/60';
    }
  }

  const pfTbody = document.getElementById('prevFarmsTbody');
  pfTbody.innerHTML = '';
  let sumPfCash = 0, sumPfTr = 0;

  if (pfListToRender.length === 0) {
    pfTbody.innerHTML = `<tr><td colspan="6" class="p-4 text-center text-slate-500 font-bold">لا توجد تحصيلات مزارع سابقة مسجلة في هذه المزرعة حتى الآن — اضغط على <strong>"📋 عرض دليل جميع التجار المكودين (${fullList.length})"</strong> لإظهار الدليل الكامل.</td></tr>`;
  }

  pfListToRender.forEach(m => {
    sumPfCash += m.prevCash;
    sumPfTr += m.prevTransfer;
    const totPf = m.prevCash + m.prevTransfer;
    const safeMName = escXmlStr(m.name);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="p-2 border text-center font-bold text-blue-900">${m.code}</td>
      <td class="p-2 border font-extrabold">
        <button type="button" data-drill-merchant="${m.code}" class="text-right text-blue-900 hover:text-amber-700 underline font-extrabold inline-flex items-center gap-1 transition" title="اضغط لفتح كشف الحساب التفصيلي بالحركات للتاجر (${safeMName})">
          <span>${safeMName}</span>
          <span class="text-[10px] text-blue-700">📋</span>
        </button>
      </td>
      <td class="p-2 border text-left font-bold text-emerald-900">${fmtInt(m.prevCash)}</td>
      <td class="p-2 border text-left font-bold text-amber-900">${fmtInt(m.prevTransfer)}</td>
      <td class="p-2 border text-left font-extrabold bg-purple-50 text-purple-950">${fmtInt(totPf)}</td>
      <td class="p-2 border text-slate-700 font-semibold">${escXmlStr(m.prevNotes.join(' | ') || (totPf > 0 ? 'مديونية موقع سابق' : '-'))}</td>
    `;
    pfTbody.appendChild(tr);
  });

  document.getElementById('prevFarmsTfoot').innerHTML = `
    <tr>
      <td colspan="2" class="p-2 border text-center">إجمالي تحصيلات المزارع السابقة (${pfListToRender.length} تاجر)</td>
      <td class="p-2 border text-left">${fmtInt(sumPfCash)}</td>
      <td class="p-2 border text-left">${fmtInt(sumPfTr)}</td>
      <td class="p-2 border text-left">${fmtInt(sumPfCash + sumPfTr)}</td>
      <td class="p-2 border text-center">النقدي يضاف للخزنة فقط ولا يخصم من المزرعة الحالية</td>
    </tr>
  `;
  if (typeof applyDomTableExcelEngine === 'function') {
    applyDomTableExcelEngine('transfers');
    applyDomTableExcelEngine('prevFarms');
  }
  } // end if (renderTransfersTables)
  if (activeDrillDownMerchantCode > 0) {
    const mdl = document.getElementById('merchantDrillDownModal');
    if (mdl && !mdl.classList.contains('hidden')) {
      renderMerchantDrillDownModal();
    }
  }
}

// =========================================================================
// MERCHANT DRILL-DOWN MODAL ENGINE (كشف حساب التاجر التفصيلي بالحركات - 10 أيام)
// =========================================================================
let activeDrillDownMerchantCode = 0;

function computeMerchantDetailedLedger(merchantCode) {
  const code = Number(merchantCode) || 0;
  const merchObj = (appState.merchants || []).find(m => Number(m.code) === code) || { code, name: `تاجر #${code}` };

  const movements = [];
  let runningBalance = 0;
  let totalCompletedCars = 0;
  let totalPendingCars = 0;
  let sumW1 = 0, sumW2 = 0, sumNetWeight = 0, sumBaseAmount = 0, sumTip = 0, sumTotalSales = 0;
  let sumCashSales = 0, sumTransferSales = 0, sumCreditSales = 0;
  let sumDebtCash = 0, sumDebtTransfer = 0;
  let sumTotalSettledCurrent = 0;
  let sumPrevCash = 0, sumPrevTransfer = 0;
  let sumCustodyCash = 0, sumCustodyTransfer = 0, sumTotalCustody = 0, sumNetCustodyRem = 0;
  const subCarNamesSet = new Set();

  for (let d = 1; d <= 10; d++) {
    const dayObj = (appState.days && appState.days[d]) || { dayNumber: d, dateLabel: `اليوم ${d}`, sales: [], pendingSales: [] };
    const completedRows = sortSalesListByScaleNo(dayObj.sales || []).map(r => ({ ...computeSaleRow(r), isPending: false }));
    const pendingRows = sortSalesListByScaleNo(dayObj.pendingSales || []).map(r => ({ ...computeSaleRow({ ...r, w2: 0 }), isPending: true }));
    const dayRows = sortSalesListByScaleNo([...completedRows, ...pendingRows]).filter(r => Number(r.code) === code);

    dayRows.forEach(r => {
      if (r.merchant) subCarNamesSet.add(r.merchant);
      const settledInRow = r.isPending ? 0 : (r.cashSales + r.transferSales + r.debtCash + r.debtTransfer);
      const netDebtImpact = r.isPending ? 0 : (r.creditSales - r.debtCash - r.debtTransfer);
      runningBalance += netDebtImpact;

      if (r.isPending) {
        totalPendingCars++;
      } else {
        if (!r.isDebtCollectionOnly) {
          totalCompletedCars++;
        }
        sumW1 += r.w1;
        sumW2 += r.w2;
        sumNetWeight += r.netWeight;
        sumBaseAmount += r.baseAmount;
        sumTip += r.tip;
        sumTotalSales += r.totalWithTip;
        sumCashSales += r.cashSales;
        sumTransferSales += r.transferSales;
        sumCreditSales += r.creditSales;
        sumDebtCash += r.debtCash;
        sumDebtTransfer += r.debtTransfer;
        sumTotalSettledCurrent += settledInRow;
        sumPrevCash += r.prevCash;
        sumPrevTransfer += r.prevTransfer;
        sumCustodyCash += r.custodyCash;
        sumCustodyTransfer += r.custodyTransfer;
        sumTotalCustody += r.totalCustody;
        sumNetCustodyRem += r.netCustodyRemaining;
      }

      movements.push({
        ...r,
        dayNum: d,
        dateLabel: dayObj.dateLabel || `اليوم ${d}`,
        settledInRow,
        netDebtImpact,
        runningBalanceAfter: runningBalance
      });
    });
  }

  const avgPrice = sumNetWeight > 0 ? (sumBaseAmount / sumNetWeight) : 0;

  return {
    code,
    name: merchObj.name,
    subCarNames: Array.from(subCarNamesSet),
    movements,
    totalCompletedCars,
    totalPendingCars,
    sumW1,
    sumW2,
    sumNetWeight,
    avgPrice,
    sumBaseAmount,
    sumTip,
    sumTotalSales,
    sumCashSales,
    sumTransferSales,
    sumCreditSales,
    sumDebtCash,
    sumDebtTransfer,
    sumTotalSettledCurrent,
    finalRunningBalance: runningBalance,
    sumPrevCash,
    sumPrevTransfer,
    sumCustodyCash,
    sumCustodyTransfer,
    sumTotalCustody,
    sumNetCustodyRem
  };
}

function ensureMerchantPrintDomElements() {
  if (typeof document === 'undefined') return null;
  if (!document.getElementById('criticalPrintStyles')) {
    const st = document.createElement('style');
    st.id = 'criticalPrintStyles';
    st.textContent = `
      #merchantPrintOnlyContainer { display: none; }
      @page { size: A4 landscape; margin: 5mm 4mm; }
      @media print {
        html, body {
          background: #ffffff !important;
          margin: 0 !important;
          padding: 0 !important;
          width: 100% !important;
          height: auto !important;
          min-height: 0 !important;
          overflow: visible !important;
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
        }
        body.printing-merchant-modal > *:not(#merchantPrintOnlyContainer) {
          display: none !important;
        }
        body.printing-merchant-modal > #merchantPrintOnlyContainer {
          display: block !important;
          position: static !important;
          width: 100% !important;
          max-width: 100% !important;
          margin: 0 !important;
          padding: 0 !important;
          background: #ffffff !important;
          color: #0f172a !important;
          direction: rtl !important;
        }
        #merchantPrintTable {
          width: 100% !important;
          max-width: 100% !important;
          min-width: 0 !important;
          table-layout: fixed !important;
          border-collapse: collapse !important;
        }
        #merchantPrintTable th,
        #merchantPrintTable td,
        #merchantPrintTable tfoot td {
          box-sizing: border-box !important;
          padding: 3px 2px !important;
          font-size: 8.5px !important;
          line-height: 1.2 !important;
          white-space: normal !important;
          word-break: break-word !important;
          overflow-wrap: anywhere !important;
          border: 1px solid #334155 !important;
        }
        #merchantPrintTable thead { display: table-header-group !important; }
        #merchantPrintTable tfoot { display: table-row-group !important; }
        #merchantPrintTable tr,
        body.printing-merchant-modal #merchantPrintOnlyContainer tr { page-break-inside: avoid !important; break-inside: avoid !important; }
        body.printing-merchant-modal #merchantPrintOnlyContainer table.print-clean-table {
          width: 100% !important;
          max-width: 100% !important;
          min-width: 0 !important;
          table-layout: fixed !important;
          border-collapse: collapse !important;
        }
        body.printing-merchant-modal #merchantPrintOnlyContainer table.print-clean-table th,
        body.printing-merchant-modal #merchantPrintOnlyContainer table.print-clean-table td {
          box-sizing: border-box !important;
          white-space: normal !important;
          word-break: break-word !important;
          overflow-wrap: anywhere !important;
        }
        body.printing-merchant-modal #merchantPrintOnlyContainer .scale-receipt-print-sheet,
        body.printing-merchant-modal #merchantPrintOnlyContainer .scale-receipt-single-copy {
          page-break-inside: avoid !important;
          break-inside: avoid !important;
        }
      }
    `;
    (document.head || document.documentElement).appendChild(st);
  }
  let printContainer = document.getElementById('merchantPrintOnlyContainer');
  if (!printContainer) {
    printContainer = document.createElement('div');
    printContainer.id = 'merchantPrintOnlyContainer';
    printContainer.setAttribute('dir', 'rtl');
    document.body.appendChild(printContainer);
  } else if (printContainer.parentElement !== document.body) {
    document.body.appendChild(printContainer);
  }
  return printContainer;
}

let isMerchantPrintActive = false;
let activePrintTargetKey = '';

const UNIVERSAL_PRINT_TABLE_CONFIGS = {
  pendingWeighIns: {
    tableId: 'pendingWeighInsTable',
    titleFn: () => `⏳ بيان السيارات المحفوظة مؤقتاً (وزنة أولى فقط) — يوم ${appState.currentDay} (${(appState.days[appState.currentDay] && appState.days[appState.currentDay].dateLabel) || ('اليوم ' + appState.currentDay)})`,
    subTitleFn: (cnt) => `سيارات تحت التحميل بانتظار استكمال الوزنة الثانية | إجمالي المعروض: ${cnt} سيارة`,
    excludeColIndices: [6],
    colWidths: ['9.0%', '24.0%', '11.0%', '14.0%', '18.0%', '24.0%'],
    alignRightCols: [1, 5],
    fontSize: '9.5px'
  },
  dailySales: {
    tableId: 'dailySalesTable',
    titleFn: () => `📋 محضر حركات البيع المسجلة — يوم ${appState.currentDay} (${(appState.days[appState.currentDay] && appState.days[appState.currentDay].dateLabel) || ('اليوم ' + appState.currentDay)})`,
    subTitleFn: (cnt) => {
      const s = computeDaySummary(appState.currentDay);
      const pendCnt = (s.pendingRows && s.pendingRows.length) || 0;
      return `عدد الحركات المكتملة: ${s.countCars} سيارة${pendCnt > 0 ? ` (+ ${pendCnt} محجوزة مؤقتاً)` : ''} | المعروض بالجدول: ${cnt} حركة`;
    },
    kpiHtmlFn: () => {
      const s = computeDaySummary(appState.currentDay);
      return `
        <table style="width:100%; table-layout:fixed; border-collapse:collapse; margin-bottom:4px; font-size:9px; text-align:center;">
          <tbody>
            <tr>
              <td style="border:1px solid #94a3b8; padding:3px 4px; background:#f8fafc;">
                <div style="font-size:8px; color:#475569; font-weight:700;">عدد السيارات / الوزن الصافي</div>
                <div style="font-weight:800; color:#0f172a;">${fmtInt(s.countCars)} سيارة | ${fmtInt(s.sumNetW)} كجم</div>
              </td>
              <td style="border:1px solid #94a3b8; padding:3px 4px; background:#fffbeb;">
                <div style="font-size:8px; color:#92400e; font-weight:700;">إجمالي مبيعات اليوم بالإكرامية</div>
                <div style="font-weight:800; color:#451a03;">${fmtDec(s.sumTotalWithTip)} ج.م</div>
              </td>
              <td style="border:1px solid #94a3b8; padding:3px 4px; background:#fff1f2;">
                <div style="font-size:8px; color:#9f1239; font-weight:700;">إجمالي المصروفات / التحويلات</div>
                <div style="font-weight:800; color:#881337;">مصاريف: ${fmtInt(s.sumExpenses)} | تحويلات: ${fmtInt(s.totalAllTransfers)}</div>
              </td>
              <td style="border:1.5px solid #065f46; padding:3px 4px; background:#ecfdf5;">
                <div style="font-size:8px; color:#065f46; font-weight:800;">صافي النقدية بالخزنة (بعد المصاريف)</div>
                <div style="font-size:10px; font-weight:800; color:#064e3b;">${fmtInt(s.netCashInBox)} ج.م</div>
              </td>
            </tr>
          </tbody>
        </table>
      `;
    },
    excludeColIndices: [16],
    colWidths: ['2.4%', '3.6%', '11.2%', '6.0%', '5.4%', '5.4%', '5.8%', '4.6%', '4.2%', '7.6%', '6.8%', '7.8%', '6.8%', '7.8%', '9.8%', '4.8%'],
    alignRightCols: [2, 14],
    fontSize: '8.5px'
  },
  dailyExpenses: {
    tableId: 'dailyExpensesTable',
    titleFn: () => `💸 بيان المصروفات والمكافآت والمنصرف من النقدية — يوم ${appState.currentDay} (${(appState.days[appState.currentDay] && appState.days[appState.currentDay].dateLabel) || ('اليوم ' + appState.currentDay)})`,
    subTitleFn: (cnt) => {
      const s = computeDaySummary(appState.currentDay);
      return `عدد بنود الصرف المعروضة: ${cnt} بند | إجمالي منصرف اليوم المخصوم من الخزنة: ${fmtInt(s.sumExpenses)} ج.م`;
    },
    excludeColIndices: [5],
    colWidths: ['6.0%', '22.0%', '38.0%', '18.0%', '16.0%'],
    alignRightCols: [1, 2, 3],
    fontSize: '10px',
    buildCustomTfootFn: () => {
      const s = computeDaySummary(appState.currentDay);
      return `<tr style="background:#fbbf24; color:#0f172a; font-weight:800; text-align:center;">
        <td colspan="4" style="text-align:center;">إجمالي المصروفات والمكافآت المخصومة من نقدية (يوم ${appState.currentDay})</td>
        <td style="text-align:center;">${fmtInt(s.sumExpenses)} ج.م</td>
      </tr>`;
    }
  },
  dash: {
    tableId: 'dashSummaryTable',
    titleFn: () => `📊 جدول الملخص التنفيذي الشامل للأيام النشطة والمفتوحة`,
    subTitleFn: (cnt) => `مقارنة الأوزان والمبيعات والتحصيلات والمصروفات وصافي الخزينة النقدية | عدد الأيام المعروضة: ${cnt} يوم`,
    kpiHtmlFn: () => {
      const kpiCards = Array.from(document.querySelectorAll('#dashKpiGrid > div'));
      if (kpiCards.length === 0) return '';
      const cells = kpiCards.map(card => {
        const divs = card.querySelectorAll('div');
        const lbl = divs[0] ? divs[0].textContent.trim() : '';
        const val = divs[1] ? divs[1].textContent.trim() : '';
        return `<td style="border:1px solid #94a3b8; padding:3px 4px; background:#f8fafc;">
          <div style="font-size:7.5px; color:#475569; font-weight:700;">${lbl}</div>
          <div style="font-size:9px; font-weight:800; color:#0f172a;">${val}</div>
        </td>`;
      }).join('');
      return `<table style="width:100%; table-layout:fixed; border-collapse:collapse; margin-bottom:4px; text-align:center;"><tbody><tr>${cells}</tr></tbody></table>`;
    },
    excludeColIndices: [],
    colWidths: ['4.6%', '7.8%', '4.0%', '5.8%', '7.2%', '6.2%', '6.2%', '6.0%', '6.0%', '5.5%', '5.2%', '6.8%', '5.2%', '6.8%', '6.0%', '5.2%', '5.5%'],
    alignRightCols: [1],
    fontSize: '8px'
  },
  merch: {
    tableId: 'merchantsLedgerTable',
    titleFn: () => `👥 جدول تكويد التجار الموحد وكشف حساب مديونيات المزرعة الحالية (10 أيام)`,
    subTitleFn: (cnt) => {
      const modeTxt = appState.merchantsViewFilter === 'active' ? 'تجار المزرعة النشطين فقط' : 'الدليل الكامل لجميع التجار المكودين';
      return `نطاق العرض: ${modeTxt} | عدد التجار المعروضين بالجدول: ${cnt} تاجر`;
    },
    excludeColIndices: [15],
    colWidths: ['2.6%', '4.4%', '11.4%', '4.4%', '6.6%', '7.8%', '6.8%', '7.4%', '6.8%', '6.4%', '6.8%', '6.4%', '7.8%', '7.8%', '6.6%'],
    alignRightCols: [2],
    fontSize: '8.5px'
  },
  transfers: {
    tableId: 'transfersTable',
    titleFn: () => `💳 بيان التحويلات والشيكات الشامل (مبيعات + تحصيل مديونيات + مزارع سابقة)`,
    subTitleFn: (cnt) => {
      const modeTxt = appState.transfersViewFilter === 'active' ? 'التجار النشطين في التحويلات فقط' : 'دليل جميع التجار المكودين';
      return `نطاق العرض: ${modeTxt} | عدد التجار المعروضين: ${cnt} تاجر`;
    },
    excludeColIndices: [],
    colWidths: ['5.0%', '15.0%', '8.8%', '8.8%', '9.6%', '8.8%', '8.5%', '8.5%', '8.5%', '8.5%', '10.0%'],
    alignRightCols: [1],
    fontSize: '9px'
  },
  prevFarms: {
    tableId: 'prevFarmsTable',
    titleFn: () => `🏦 بيان تحصيلات مديونيات المواقع والمزارع السابقة (نقدي للخزنة + تحويلات)`,
    subTitleFn: (cnt) => {
      const modeTxt = appState.prevFarmsViewFilter === 'active' ? 'التجار النشطين في تحصيلات المزارع السابقة فقط' : 'دليل جميع التجار المكودين';
      return `هذه المبالغ تخص مزارع سابقة ولا تُخصم من مديونية المزرعة الحالية (${modeTxt} — ${cnt} تاجر)`;
    },
    excludeColIndices: [],
    colWidths: ['7.0%', '19.0%', '15.0%', '15.0%', '16.0%', '28.0%'],
    alignRightCols: [1, 5],
    fontSize: '9.5px'
  },
  expSummary: {
    tableId: 'expSummaryTable',
    titleFn: () => `💸 بيان المصروفات والمكافآت المجمع (حسب البند وعلى مدار الـ 10 أيام)`,
    subTitleFn: (cnt) => {
      const modeTxt = appState.expensesViewFilter === 'active' ? 'البنود النشطة بالمزرعة فقط' : 'دليل جميع البنود المكودة';
      return `نطاق العرض: ${modeTxt} | عدد البنود المعروضة: ${cnt} بند`;
    },
    excludeColIndices: [],
    colWidths: ['3.5%', '18.5%', '9.5%', '5.5%', '6.3%', '6.3%', '6.3%', '6.3%', '6.3%', '6.3%', '6.3%', '6.3%', '6.3%', '6.3%'],
    alignRightCols: [1],
    fontSize: '8.5px'
  }
};

function cleanPrintCellText(cellEl) {
  if (!cellEl) return '';
  const clone = cellEl.cloneNode(true);
  clone.querySelectorAll('[data-excel-filter-btn], .print-hide-col').forEach(el => el.remove());
  // حذف شارة (📋 كشف تفصيلي / 📋) التفاعلية داخل أزرار أسماء التجار بدون استخدام أقواس مربعة في محدد CSS
  clone.querySelectorAll('[data-drill-merchant] span').forEach(spanEl => {
    const cls = String(spanEl.className || '');
    const txt = (spanEl.textContent || '').trim();
    if (cls.includes('text-[10px]') || txt.includes('كشف تفصيلي') || txt === '📋') {
      spanEl.remove();
    }
  });
  return (clone.textContent || '').replace(/\s+/g, ' ').trim();
}

function renderFarmTrialBalancePrintView() {
  const printContainer = ensureMerchantPrintDomElements();
  if (!printContainer) return false;
  const openActiveSummaries = getOpenAndActiveDashSummaries();
  const filteredSummaries = applyExcelSortAndFilter(openActiveSummaries, DASH_COLUMNS, 'dash');
  const ftb = computeFarmCumulativeTrialBalance(filteredSummaries);
  const fName = appState.farmName || 'أبوذكري';
  const printDateStr = new Date().toLocaleDateString('ar-EG', { year: 'numeric', month: 'short', day: 'numeric' });
  const statusTxt = ftb.cumulativeCashBoxDiff === 0
    ? 'خزينة المزرعة مطابقة تماماً ✓'
    : (ftb.cumulativeCashBoxDiff < 0 ? 'زيادة توريد تراكمية' : 'متبقي بالخزنة غير مورد / عجز');
  const diffBg = ftb.cumulativeCashBoxDiff === 0 ? '#d1fae5' : '#ffe4e6';
  const diffColor = ftb.cumulativeCashBoxDiff === 0 ? '#064e3b' : '#881337';

  printContainer.innerHTML = `
    <div style="border:2px solid #1b365d; border-radius:6px; padding:8px 10px; background:#ffffff; color:#0f172a; font-family:'Cairo',sans-serif;">
      <div style="display:flex; align-items:center; justify-content:space-between; border-bottom:2px solid #1b365d; padding-bottom:5px; margin-bottom:8px;">
        <div>
          <div style="font-size:14px; font-weight:800; color:#1b365d;">
            ⚖️ ميزان المراجعة والتصفية الكامل لجميع أيام المزرعة — مزرعة <span style="color:#b45309;">${escXmlStr(fName)}</span>
          </div>
          <div style="font-size:9.5px; font-weight:700; color:#475569; margin-top:2px;">
            المطابقة الوزنية والمحاسبية والنقدية التراكمية الشاملة على مدار (${ftb.activeDaysCount} يوم نشط/مفتوح — منها ${ftb.lockedDaysCount} يوم معتمد 🔒)
          </div>
        </div>
        <div style="text-align:left; font-size:9px; font-weight:700; color:#334155;">
          <div>نظام محاضر لجان بيع المزارع</div>
          <div>تاريخ الطباعة: ${printDateStr}</div>
        </div>
      </div>

      <table id="merchantPrintTable" dir="rtl" style="width:100%; max-width:100%; table-layout:fixed; border-collapse:collapse;">
        <colgroup>
          <col style="width:23.0%;" />
          <col style="width:10.3%;" />
          <col style="width:23.0%;" />
          <col style="width:10.3%;" />
          <col style="width:23.0%;" />
          <col style="width:10.4%;" />
        </colgroup>
        <thead>
          <tr style="background:#1b365d; color:#ffffff; font-weight:800; text-align:center;">
            <th colspan="2" style="background:#0c4a6e; font-size:10px; padding:5px;">أولاً: ميزان مراجعة الأوزان والحركات التراكمي (كجم)</th>
            <th colspan="2" style="background:#312e81; font-size:10px; padding:5px;">ثانياً: ميزان المبيعات وحركة الذمم والتحويلات التراكمي</th>
            <th colspan="2" style="background:#064e3b; font-size:10px; padding:5px;">ثالثاً: ميزان الخزينة النقدية التراكمي للمزرعة</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style="text-align:right; font-weight:700; font-size:9px; padding:4px;">عدد الأيام النشطة | السيارات المكتملة:</td>
            <td style="text-align:center; font-weight:800; font-size:9px; padding:4px;">${fmtInt(ftb.activeDaysCount)} يوم | ${fmtInt(ftb.countCars)} سيارة (${fmtInt(ftb.avgCarWeight)} كجم)</td>
            <td style="text-align:right; font-weight:800; font-size:9px; padding:4px; background:#fffbeb;">إجمالي مبيعات المزرعة شامل الإكرامية:</td>
            <td style="text-align:center; font-weight:800; font-size:9px; padding:4px; background:#fffbeb;">${fmtDec(ftb.sumTotalWithTip)} ج.م</td>
            <td style="text-align:right; font-weight:800; font-size:9px; padding:4px; background:#f0fdfa;">(+) إجمالي نقدي المبيعات (جميع الأيام):</td>
            <td style="text-align:center; font-weight:800; font-size:9px; padding:4px; background:#f0fdfa;">${fmtInt(ftb.sumCashSales)} ج.م</td>
          </tr>
          <tr style="background:#f8fafc;">
            <td style="text-align:right; font-weight:700; font-size:9px; padding:4px;">إجمالي السيارات المؤقتة (تحت التحميل):</td>
            <td style="text-align:center; font-weight:800; font-size:9px; padding:4px; color:${ftb.pendingCarsCount > 0 ? '#9f1239' : '#065f46'};">${ftb.pendingCarsCount > 0 ? `⚠️ ${fmtInt(ftb.pendingCarsCount)} سيارة مؤقتة` : '0 سيارة (مكتمل ✓)'}</td>
            <td style="text-align:right; font-weight:700; font-size:9px; padding:4px;">تحويلات المزرعة الحالية + تحويلات سابقة:</td>
            <td style="text-align:center; font-weight:800; font-size:9px; padding:4px;">حالية: ${fmtInt(ftb.currentFarmTransfers)} | سابقة: ${fmtInt(ftb.sumPrevTransfer)}</td>
            <td style="text-align:right; font-weight:700; font-size:9px; padding:4px;">(+) نقدي مديونيات الحالية + نقدي مزارع سابقة:</td>
            <td style="text-align:center; font-weight:800; font-size:9px; padding:4px;">مديونيات: ${fmtInt(ftb.sumDebtCash)} | سابقة: ${fmtInt(ftb.sumPrevCash)}</td>
          </tr>
          <tr>
            <td style="text-align:right; font-weight:700; font-size:9px; padding:4px;">إجمالي الوزنة الثانية (القائم) - الأولى (الفارغ):</td>
            <td style="text-align:center; font-weight:800; font-size:9px; padding:4px;">${fmtInt(ftb.sumW2)} - ${fmtInt(ftb.sumW1)} كجم</td>
            <td style="text-align:right; font-weight:800; font-size:9px; padding:4px; background:#d1fae5; color:#064e3b;">إجمالي جميع التحويلات والشيكات بالمزرعة:</td>
            <td style="text-align:center; font-weight:800; font-size:9px; padding:4px; background:#d1fae5; color:#064e3b;">${fmtInt(ftb.totalAllTransfers)} ج.م</td>
            <td style="text-align:right; font-weight:800; font-size:9px; padding:4px; background:#fef3c7;">(=) إجمالي وارد النقدية التراكمي (قبل المصاريف):</td>
            <td style="text-align:center; font-weight:800; font-size:9px; padding:4px; background:#fef3c7;">${fmtInt(ftb.totalCashInflowBeforeExpenses)} ج.م</td>
          </tr>
          <tr style="background:#f8fafc;">
            <td style="text-align:right; font-weight:800; font-size:9px; padding:4px; background:#eff6ff;">(=) إجمالي الوزن الصافي التراكمي للمزرعة:</td>
            <td style="text-align:center; font-weight:800; font-size:9px; padding:4px; background:#eff6ff;">${fmtInt(ftb.sumNetW)} كجم</td>
            <td style="text-align:right; font-weight:700; font-size:9px; padding:4px; color:#115e59;">(+) إجمالي آجل الفواتير (${fmtInt(ftb.sumCreditSales)}) - مسدد المديونية (${fmtInt(ftb.totalDebtCollected)}):</td>
            <td style="text-align:center; font-weight:800; font-size:9px; padding:4px; color:#115e59;">مسدد: ${fmtInt(ftb.totalDebtCollected)} ج.م</td>
            <td style="text-align:right; font-weight:700; font-size:9px; padding:4px; color:#9f1239;">(-) يخصم: إجمالي المصروفات والمكافآت (كل الأيام):</td>
            <td style="text-align:center; font-weight:800; font-size:9px; padding:4px; color:#9f1239;">${fmtInt(ftb.sumExpenses)} ج.م</td>
          </tr>
          <tr>
            <td style="text-align:right; font-weight:700; font-size:9px; padding:4px;">متوسط سعر الكيلو المرجح للمزرعة:</td>
            <td style="text-align:center; font-weight:800; font-size:9px; padding:4px;">${fmtDec(ftb.avgPrice)} ج.م/كجم (إكراميات: ${fmtInt(ftb.sumTip)})</td>
            <td style="text-align:right; font-weight:800; font-size:9px; padding:4px; background:#eef2ff; color:#1e1b4b;">(=) صافي مديونية المزرعة المتبقية لدى التجار:</td>
            <td style="text-align:center; font-weight:800; font-size:9px; padding:4px; background:#eef2ff; color:#1e1b4b;">${fmtInt(ftb.closingFarmDebt)} ج.م</td>
            <td style="text-align:right; font-weight:800; font-size:9px; padding:4px; background:#d1fae5; color:#064e3b;">(=) صافي النقدية التراكمية بالخزنة (بعد المصاريف):</td>
            <td style="text-align:center; font-weight:800; font-size:9px; padding:4px; background:#d1fae5; color:#064e3b;">${fmtInt(ftb.netCumulativeCashInBox)} ج.م</td>
          </tr>
          <tr style="background:#f8fafc;">
            <td style="text-align:right; font-weight:800; font-size:9px; padding:4px; background:#d1fae5; color:#064e3b;">فرق ميزان الأوزان التراكمي:</td>
            <td style="text-align:center; font-weight:800; font-size:9px; padding:4px; background:#d1fae5; color:#064e3b;">${fmtInt(ftb.weightAuditDiff)} (${ftb.weightAuditDiff === 0 ? 'مطابق ✓' : 'راجع الوزن!'})</td>
            <td style="text-align:right; font-weight:700; font-size:9px; padding:4px;">مطابقة توازن الفواتير (المسدد والآجل - الفواتير):</td>
            <td style="text-align:center; font-weight:800; font-size:9px; padding:4px;">${fmtDec(ftb.sumInvoiceDiff)} ج.م (${Math.abs(ftb.sumInvoiceDiff) <= 1 ? 'متزنة ✓' : 'فرق توازن!'})</td>
            <td style="text-align:right; font-weight:800; font-size:9px; padding:4px; background:#eff6ff;">(-) إجمالي المورد للإدارة (${fmtInt(ftb.sumDeliveredCash)}) + مرحّل (${fmtInt(ftb.lastDayCarriedForwardCash)}):</td>
            <td style="text-align:center; font-weight:800; font-size:9px; padding:4px; background:#eff6ff;">${fmtInt(ftb.totalSettledAndFinalCarry)} ج.م</td>
          </tr>
        </tbody>
        <tfoot>
          <tr style="background:${diffBg}; color:${diffColor}; font-weight:800;">
            <td colspan="4" style="text-align:left; font-size:10px; padding:5px;">فرق الخزينة التراكمي للمزرعة (صافي النقدية التراكمية بعد المصاريف - [إجمالي النقدية الموردة للإدارة + الرصيد المرحّل بآخر يوم]):</td>
            <td colspan="2" style="text-align:center; font-size:10.5px; padding:5px;">${fmtInt(ftb.cumulativeCashBoxDiff)} ج.م (${statusTxt})</td>
          </tr>
        </tfoot>
      </table>

      <table class="print-clean-table" dir="rtl" style="width:100%; table-layout:fixed; border-collapse:collapse; margin-top:8px; text-align:center; font-size:9px;">
        <tbody>
          <tr>
            <td style="border:1px solid #334155; padding:6px 4px; background:#f8fafc;">
              <div style="font-weight:800; color:#1b365d; margin-bottom:16px;">مشرف الميزان والوزن</div>
              <div style="color:#475569; font-weight:700;">الاسم والتوقيع: ........................</div>
            </td>
            <td style="border:1px solid #334155; padding:6px 4px; background:#f8fafc;">
              <div style="font-weight:800; color:#1b365d; margin-bottom:16px;">أعضاء لجنة البيع</div>
              <div style="color:#475569; font-weight:700;">الاسم والتوقيع: ........................</div>
            </td>
            <td style="border:1px solid #334155; padding:6px 4px; background:#f8fafc;">
              <div style="font-weight:800; color:#1b365d; margin-bottom:16px;">محاسب الموقع والمراجعة</div>
              <div style="color:#475569; font-weight:700;">الاسم والتوقيع: ........................</div>
            </td>
            <td style="border:1px solid #334155; padding:6px 4px; background:#ecfdf5;">
              <div style="font-weight:800; color:#064e3b; margin-bottom:16px;">أمين الخزينة المستلم</div>
              <div style="color:#065f46; font-weight:700;">الاسم والتوقيع: ........................</div>
            </td>
            <td style="border:1px solid #334155; padding:6px 4px; background:#fffbeb;">
              <div style="font-weight:800; color:#78350f; margin-bottom:16px;">يعتمد ،، مدير المزرعة</div>
              <div style="color:#92400e; font-weight:700;">التوقيع والختم: ........................</div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  `;
  return true;
}

function renderDailyTrialBalancePrintView() {
  const printContainer = ensureMerchantPrintDomElements();
  if (!printContainer) return false;
  const d = appState.currentDay || 1;
  const s = computeDaySummary(d);
  const fName = appState.farmName || 'أبوذكري';
  const printDateStr = new Date().toLocaleDateString('ar-EG', { year: 'numeric', month: 'short', day: 'numeric' });
  const statusTxt = s.cashBoxDiff === 0
    ? 'خزينة مطابقة ✓'
    : (s.cashBoxDiff < 0 ? 'زيادة توريد' : 'عجز توريد');
  const diffBg = s.cashBoxDiff === 0 ? '#d1fae5' : '#ffe4e6';
  const diffColor = s.cashBoxDiff === 0 ? '#064e3b' : '#881337';

  printContainer.innerHTML = `
    <div style="border:2px solid #1b365d; border-radius:6px; padding:8px 10px; background:#ffffff; color:#0f172a; font-family:'Cairo',sans-serif;">
      <div style="display:flex; align-items:center; justify-content:space-between; border-bottom:2px solid #1b365d; padding-bottom:5px; margin-bottom:8px;">
        <div>
          <div style="font-size:14px; font-weight:800; color:#1b365d;">
            ⚖️ ميزان مراجعة وتصفية اليوم (يوم ${d} — ${s.dateLabel}) — مزرعة <span style="color:#b45309;">${fName}</span>
          </div>
          <div style="font-size:9.5px; font-weight:700; color:#475569; margin-top:2px;">
            المطابقة الوزنية والمحاسبية والنقدية الشاملة (الركائز الثلاث لليوم)
          </div>
        </div>
        <div style="text-align:left; font-size:9px; font-weight:700; color:#334155;">
          <div>نظام محاضر لجان بيع المزارع</div>
          <div>تاريخ الطباعة: ${printDateStr}</div>
        </div>
      </div>

      <table id="merchantPrintTable" dir="rtl" style="width:100%; max-width:100%; table-layout:fixed; border-collapse:collapse;">
        <colgroup>
          <col style="width:23.0%;" />
          <col style="width:10.3%;" />
          <col style="width:23.0%;" />
          <col style="width:10.3%;" />
          <col style="width:23.0%;" />
          <col style="width:10.4%;" />
        </colgroup>
        <thead>
          <tr style="background:#1b365d; color:#ffffff; font-weight:800; text-align:center;">
            <th colspan="2" style="background:#0c4a6e; font-size:10px; padding:5px;">أولاً: ميزان مراجعة الأوزان والحركات (كجم)</th>
            <th colspan="2" style="background:#312e81; font-size:10px; padding:5px;">ثانياً: ميزان المبيعات والآجل والتحويلات الشامل</th>
            <th colspan="2" style="background:#064e3b; font-size:10px; padding:5px;">ثالثاً: ميزان الخزينة النقدية (بعد خصم المصروفات)</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style="text-align:right; font-weight:700; font-size:9px; padding:4px;">عدد السيارات المكتملة (متوسط السيارة):</td>
            <td style="text-align:center; font-weight:800; font-size:9px; padding:4px;">${fmtInt(s.countCars)} سيارة (${fmtInt(s.avgCarWeight)} كجم)</td>
            <td style="text-align:right; font-weight:800; font-size:9px; padding:4px; background:#fffbeb;">إجمالي المبيعات شامل الإكرامية:</td>
            <td style="text-align:center; font-weight:800; font-size:9px; padding:4px; background:#fffbeb;">${fmtDec(s.sumTotalWithTip)} ج.م</td>
            <td style="text-align:right; font-weight:800; font-size:9px; padding:4px; background:#f0fdfa;">(+) رصيد نقدي مرحّل من خزنة أمس:</td>
            <td style="text-align:center; font-weight:800; font-size:9px; padding:4px; background:#f0fdfa;">${fmtInt(s.openingCashFromPrevDay)} ج.م</td>
          </tr>
          <tr style="background:#f8fafc;">
            <td style="text-align:right; font-weight:700; font-size:9px; padding:4px;">السيارات المؤقتة (تحت التحميل - وزنة 1):</td>
            <td style="text-align:center; font-weight:800; font-size:9px; padding:4px; color:${s.pendingCarsCount > 0 ? '#9f1239' : '#065f46'};">${s.pendingCarsCount > 0 ? `⚠️ ${fmtInt(s.pendingCarsCount)} سيارة مؤقتة` : '0 سيارة (مكتمل ✓)'}</td>
            <td style="text-align:right; font-weight:700; font-size:9px; padding:4px;">غير النقدي يوم البيع + جميع التحويلات:</td>
            <td style="text-align:center; font-weight:800; font-size:9px; padding:4px;">غير نقدي: ${fmtInt(s.sumCreditSales + s.sumTransferSales)} | تحويلات: ${fmtInt(s.totalAllTransfers)}</td>
            <td style="text-align:right; font-weight:700; font-size:9px; padding:4px;">(+) نقدي المبيعات + نقدي مديونيات + سابقة:</td>
            <td style="text-align:center; font-weight:800; font-size:9px; padding:4px;">حالية: ${fmtInt(s.sumCashSales + s.sumDebtCash)} | سابقة: ${fmtInt(s.sumPrevCash)}</td>
          </tr>
          <tr>
            <td style="text-align:right; font-weight:700; font-size:9px; padding:4px;">إجمالي الوزنة الثانية (القائم) - الأولى (الفارغ):</td>
            <td style="text-align:center; font-weight:800; font-size:9px; padding:4px;">${fmtInt(s.sumW2)} - ${fmtInt(s.sumW1)} كجم</td>
            <td style="text-align:right; font-weight:700; font-size:9px; padding:4px; color:#312e81;">مديونية أول اليوم (مرحّلة من الأيام السابقة):</td>
            <td style="text-align:center; font-weight:800; font-size:9px; padding:4px; color:#312e81;">${fmtInt(s.openingDayDebt)} ج.م</td>
            <td style="text-align:right; font-weight:800; font-size:9px; padding:4px; background:#fef3c7;">إجمالي وارد النقدية اليوم (قبل المصاريف):</td>
            <td style="text-align:center; font-weight:800; font-size:9px; padding:4px; background:#fef3c7;">${fmtInt(s.totalCashBeforeExpenses)} ج.م</td>
          </tr>
          <tr style="background:#f8fafc;">
            <td style="text-align:right; font-weight:800; font-size:9px; padding:4px; background:#eff6ff;">(=) صافي الوزن المحسوب:</td>
            <td style="text-align:center; font-weight:800; font-size:9px; padding:4px; background:#eff6ff;">${fmtInt(s.sumNetW)} كجم</td>
            <td style="text-align:right; font-weight:700; font-size:9px; padding:4px; color:#115e59;">(+) آجل اليوم (${fmtInt(s.sumCreditSales)}) - سداد المديونية (${fmtInt(s.dayDebtCollected)}):</td>
            <td style="text-align:center; font-weight:800; font-size:9px; padding:4px; color:#115e59;">${fmtInt(s.netDayDebtChange)} ج.م</td>
            <td style="text-align:right; font-weight:700; font-size:9px; padding:4px; color:#9f1239;">(-) يخصم: إجمالي المصروفات والمكافآت:</td>
            <td style="text-align:center; font-weight:800; font-size:9px; padding:4px; color:#9f1239;">${fmtInt(s.sumExpenses)} ج.م</td>
          </tr>
          <tr>
            <td style="text-align:right; font-weight:700; font-size:9px; padding:4px;">متوسط سعر الكيلو المرجح لليوم:</td>
            <td style="text-align:center; font-weight:800; font-size:9px; padding:4px;">${fmtDec(s.avgPrice)} ج.م/كجم</td>
            <td style="text-align:right; font-weight:800; font-size:9px; padding:4px; background:#eef2ff; color:#1e1b4b;">(=) صافي مديونية المزرعة آخر اليوم:</td>
            <td style="text-align:center; font-weight:800; font-size:9px; padding:4px; background:#eef2ff; color:#1e1b4b;">${fmtInt(s.closingDayDebt)} ج.م</td>
            <td style="text-align:right; font-weight:800; font-size:9px; padding:4px; background:#d1fae5; color:#064e3b;">(=) إجمالي النقدية المتاحة بالخزنة (شامل المرحّل):</td>
            <td style="text-align:center; font-weight:800; font-size:9px; padding:4px; background:#d1fae5; color:#064e3b;">${fmtInt(s.totalAvailableCashInBox)} ج.م</td>
          </tr>
          <tr style="background:#f8fafc;">
            <td style="text-align:right; font-weight:800; font-size:9px; padding:4px; background:#d1fae5; color:#064e3b;">فرق ميزان الأوزان:</td>
            <td style="text-align:center; font-weight:800; font-size:9px; padding:4px; background:#d1fae5; color:#064e3b;">${fmtInt(s.weightAuditDiff)} (${s.weightAuditDiff === 0 ? 'مطابق ✓' : 'راجع الوزن!'})</td>
            <td style="text-align:right; font-weight:700; font-size:9px; padding:4px;">مطابقة توازن الفواتير (المسدد والآجل - الفواتير):</td>
            <td style="text-align:center; font-weight:800; font-size:9px; padding:4px;">${fmtDec(s.sumInvoiceDiff)} ج.م (${Math.abs(s.sumInvoiceDiff) <= 1 ? 'متزنة ✓' : 'فرق توازن!'})</td>
            <td style="text-align:right; font-weight:800; font-size:9px; padding:4px; background:#eff6ff;">(-) المورد للإدارة (${fmtInt(s.deliveredCash)}) + مرحّل للغد (${fmtInt(s.carriedForwardCash)}):</td>
            <td style="text-align:center; font-weight:800; font-size:9px; padding:4px; background:#eff6ff;">${fmtInt(s.totalSettledAndCarriedCash)} ج.م</td>
          </tr>
        </tbody>
        <tfoot>
          <tr style="background:${diffBg}; color:${diffColor}; font-weight:800;">
            <td colspan="4" style="text-align:left; font-size:10px; padding:5px;">فرق الخزينة اليومي (إجمالي النقدية المتاحة بالخزنة - [النقدية الموردة للإدارة + الرصيد المرحّل للغد]):</td>
            <td colspan="2" style="text-align:center; font-size:10.5px; padding:5px;">${fmtInt(s.cashBoxDiff)} ج.م (${statusTxt})</td>
          </tr>
        </tfoot>
      </table>

      <table class="print-clean-table" dir="rtl" style="width:100%; table-layout:fixed; border-collapse:collapse; margin-top:8px; text-align:center; font-size:9px;">
        <tbody>
          <tr>
            <td style="border:1px solid #334155; padding:6px 4px; background:#f8fafc;">
              <div style="font-weight:800; color:#1b365d; margin-bottom:16px;">مشرف الميزان والوزن</div>
              <div style="color:#475569; font-weight:700;">الاسم والتوقيع: ........................</div>
            </td>
            <td style="border:1px solid #334155; padding:6px 4px; background:#f8fafc;">
              <div style="font-weight:800; color:#1b365d; margin-bottom:16px;">أعضاء لجنة البيع</div>
              <div style="color:#475569; font-weight:700;">الاسم والتوقيع: ........................</div>
            </td>
            <td style="border:1px solid #334155; padding:6px 4px; background:#f8fafc;">
              <div style="font-weight:800; color:#1b365d; margin-bottom:16px;">محاسب الموقع والمراجعة</div>
              <div style="color:#475569; font-weight:700;">الاسم والتوقيع: ........................</div>
            </td>
            <td style="border:1px solid #334155; padding:6px 4px; background:#ecfdf5;">
              <div style="font-weight:800; color:#064e3b; margin-bottom:16px;">أمين الخزينة المستلم</div>
              <div style="color:#065f46; font-weight:700;">الاسم والتوقيع: ........................</div>
            </td>
            <td style="border:1px solid #334155; padding:6px 4px; background:#fffbeb;">
              <div style="font-weight:800; color:#78350f; margin-bottom:16px;">يعتمد ،، مدير المزرعة</div>
              <div style="color:#92400e; font-weight:700;">التوقيع والختم: ........................</div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  `;
  return true;
}

function renderScaleReceiptPrintView(saleId, dayNumInput) {
  const printContainer = ensureMerchantPrintDomElements();
  if (!printContainer || !saleId) return false;
  const d = Number(dayNumInput) || appState.currentDay || 1;
  const dayObj = (appState.days && appState.days[d]) || { dayNumber: d, dateLabel: `اليوم ${d}`, sales: [], pendingSales: [] };
  const fName = appState.farmName || 'أبوذكري';

  let rawRow = (dayObj.sales || []).find(x => String(x.id) === String(saleId));
  let isPending = false;
  if (!rawRow) {
    rawRow = (dayObj.pendingSales || []).find(x => String(x.id) === String(saleId));
    if (rawRow) isPending = true;
  }
  if (!rawRow) {
    for (let searchD = 1; searchD <= 10; searchD++) {
      const sDay = appState.days && appState.days[searchD];
      if (!sDay) continue;
      const foundSale = (sDay.sales || []).find(x => String(x.id) === String(saleId));
      if (foundSale) {
        rawRow = foundSale;
        isPending = false;
        break;
      }
      const foundPend = (sDay.pendingSales || []).find(x => String(x.id) === String(saleId));
      if (foundPend) {
        rawRow = foundPend;
        isPending = true;
        break;
      }
    }
  }
  if (!rawRow) return false;

  const r = isPending
    ? { ...computeSaleRow({ ...rawRow, w2: 0 }), isPending: true }
    : { ...computeSaleRow(rawRow), isPending: false };

  // حساب رصيد التاجر السابق قبل هذه الحركة والرصيد التراكمي بعدها من كشف الحساب التفصيلي
  let prevBalanceBefore = 0;
  let runningBalanceAfter = 0;
  let baseMerchantName = r.merchant || '-';
  if (r.code > 0) {
    const ledger = computeMerchantDetailedLedger(r.code);
    baseMerchantName = ledger.name || r.merchant;
    const movMatch = (ledger.movements || []).find(m => String(m.id) === String(r.id));
    if (movMatch) {
      runningBalanceAfter = movMatch.runningBalanceAfter;
      const rowDelta = movMatch.isPending ? 0 : (movMatch.creditSales - movMatch.debtCash - movMatch.debtTransfer);
      prevBalanceBefore = runningBalanceAfter - rowDelta;
    } else {
      prevBalanceBefore = computeMerchantCurrentDebtExcluding(r.code, r.id);
      const rowDelta = isPending ? 0 : (r.creditSales - r.debtCash - r.debtTransfer);
      runningBalanceAfter = prevBalanceBefore + rowDelta;
    }
  }

  const now = new Date();
  const printDateStr = now.toLocaleDateString('ar-EG', { year: 'numeric', month: 'short', day: 'numeric' });
  const printTimeStr = now.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
  const statusBadgeTxt = isPending
    ? '⏳ كارتة وزنة أولى (تحت التحميل)'
    : (r.isDebtCollectionOnly ? '💵 إيصال / سند تحصيل مديونية (بدون ميزان)' : '✅ كارتة ميزان وفاتورة مكتملة');
  const statusBadgeBg = isPending ? '#fef3c7' : '#d1fae5';
  const statusBadgeColor = isPending ? '#92400e' : '#065f46';

  const totalSettledTodayForFarm = r.cashSales + r.transferSales + r.debtCash + r.debtTransfer;
  const balStateTxt = runningBalanceAfter > 0
    ? 'عليه للمزرعة'
    : (runningBalanceAfter < 0 ? 'له رصيد دائن' : 'خالص ✓');

  const extraInlineNotes = [];
  if (r.totalCustody > 0) {
    extraInlineNotes.push(`💼 عهدة التاجر: ${fmtInt(r.totalCustody)} ج.م (نقدي: ${fmtInt(r.custodyCash)}${r.custodyTransfer > 0 ? ` + ${r.custodyTransferType || 'تحويل'}: ${fmtInt(r.custodyTransfer)}` : ''} | متبقي العهدة: ${fmtInt(r.netCustodyRemaining)} ج.م)`);
  }
  if ((r.prevCash + r.prevTransfer) > 0) {
    extraInlineNotes.push(`🏦 مزارع سابقة: ${fmtInt(r.prevCash + r.prevTransfer)} ج.م (نقدي: ${fmtInt(r.prevCash)}${r.prevTransfer > 0 ? ` + ${r.prevTransferType || 'تحويل'}: ${fmtInt(r.prevTransfer)}` : ''})${r.notes ? ` [${escXmlStr(r.notes)}]` : ''}`);
  } else if (r.notes) {
    extraInlineNotes.push(`📝 بيان/ملاحظات: ${escXmlStr(r.notes)}`);
  }
  const extraStripHtml = extraInlineNotes.length > 0
    ? `<div style="margin-top:2px; padding:1.5px 5px; background:#f8fafc; border:1px solid #cbd5e1; border-radius:3px; font-size:7.5px; font-weight:800; color:#1e293b; line-height:1.2;">${extraInlineNotes.join(' &nbsp;|&nbsp; ')}</div>`
    : '';

  const copiesMeta = [
    { num: 1, title: 'نسخة (1): أصل التاجر / المشتري', bg: '#eff6ff', border: '#1d4ed8', color: '#1e3a8a' },
    { num: 2, title: 'نسخة (2): السائق / بوابة الخروج والميزان', bg: '#fffbeb', border: '#b45309', color: '#78350f' },
    { num: 3, title: 'نسخة (3): أرشيف لجنة البيع وخزينة المزرعة', bg: '#ecfdf5', border: '#047857', color: '#064e3b' }
  ];

  const buildSingleCopyHtml = (copyInfo) => `
    <div class="scale-receipt-single-copy" style="border:1.5px solid #0f172a; border-radius:5px; padding:4px 7px; background:#ffffff; color:#0f172a; page-break-inside:avoid; break-inside:avoid;">
      <!-- ترويسة النسخة -->
      <div style="display:flex; align-items:center; justify-content:space-between; border-bottom:1.5px solid #1b365d; padding-bottom:2.5px; margin-bottom:3px; gap:4px;">
        <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
          <span style="font-size:11px; font-weight:800; color:#1b365d;">
            ⚖️ كارتة ميزان وفاتورة بيع — مزرعة <span style="color:#b45309;">${escXmlStr(fName)}</span>
          </span>
          <span style="font-size:8.5px; font-weight:700; color:#334155;">
            | يوم ${d} (${escXmlStr(dayObj.dateLabel || ('اليوم ' + d))}) — ${printDateStr} (${printTimeStr})
          </span>
        </div>
        <div style="display:flex; align-items:center; gap:4px;">
          <span style="padding:1.5px 6px; border-radius:4px; background:${copyInfo.bg}; color:${copyInfo.color}; border:1px solid ${copyInfo.border}; font-size:8.5px; font-weight:800;">
            ${copyInfo.title}
          </span>
          <span style="padding:1.5px 6px; border-radius:4px; background:${statusBadgeBg}; color:${statusBadgeColor}; border:1px solid ${statusBadgeColor}; font-size:8px; font-weight:800;">
            ${statusBadgeTxt}
          </span>
          <span style="padding:1.5px 8px; border-radius:4px; background:#1b365d; color:#ffffff; font-size:10px; font-weight:800;">
            بون #${escXmlStr(r.scaleNo || '-')}
          </span>
        </div>
      </div>

      <!-- الجدول الأول: بيانات التاجر والسيارة والأوزان وإجمالي الفاتورة -->
      <table class="print-clean-table" dir="rtl" style="width:100%; table-layout:fixed; border-collapse:collapse; margin-bottom:2.5px; text-align:center; font-size:8.5px; line-height:1.15;">
        <colgroup>
          <col style="width:15%;" />
          <col style="width:11%;" />
          <col style="width:8%;" />
          <col style="width:9.5%;" />
          <col style="width:9.5%;" />
          <col style="width:11.5%;" />
          <col style="width:8%;" />
          <col style="width:7.5%;" />
          <col style="width:20%;" />
        </colgroup>
        <thead>
          <tr style="background:#0c4a6e; color:#ffffff; font-weight:800; font-size:8px;">
            <th style="border:1px solid #0f172a; padding:2px;">اسم التاجر / السيارة</th>
            <th style="border:1px solid #0f172a; padding:2px;">الكود الموحد</th>
            <th style="border:1px solid #0f172a; padding:2px;">رقم السيارة</th>
            <th style="border:1px solid #0f172a; padding:2px;">وزنة 1 (فارغ)</th>
            <th style="border:1px solid #0f172a; padding:2px;">وزنة 2 (قائم)</th>
            <th style="border:1px solid #0f172a; padding:2px; background:#1e3a8a; color:#fde68a;">الوزن الصافي</th>
            <th style="border:1px solid #0f172a; padding:2px;">السعر</th>
            <th style="border:1px solid #0f172a; padding:2px;">الإكرامية</th>
            <th style="border:1px solid #0f172a; padding:2px; background:#78350f; color:#fef3c7;">إجمالي الفاتورة بالإكرامية</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style="border:1px solid #0f172a; padding:2.5px; font-weight:800; font-size:9.5px; background:#f8fafc;">${escXmlStr(r.merchant)}</td>
            <td style="border:1px solid #0f172a; padding:2.5px; font-weight:800; color:#1e3a8a;">(${r.code || '-'}) ${escXmlStr(baseMerchantName)}</td>
            <td style="border:1px solid #0f172a; padding:2.5px; font-weight:800; font-size:9.5px;">${escXmlStr(r.carNo || '-')}</td>
            <td style="border:1px solid #0f172a; padding:2.5px; font-weight:800;">${fmtInt(r.w1)} كجم</td>
            <td style="border:1px solid #0f172a; padding:2.5px; font-weight:800;">${isPending ? '⏳ تحت التحميل' : `${fmtInt(r.w2)} كجم`}</td>
            <td style="border:1.5px solid #1e3a8a; padding:2.5px; font-weight:800; font-size:10.5px; background:#eff6ff; color:#1e3a8a;">${isPending ? 'بانتظار وزنة 2' : `${fmtInt(r.netWeight)} كجم`}</td>
            <td style="border:1px solid #0f172a; padding:2.5px; font-weight:800;">${fmtDec(r.price)}</td>
            <td style="border:1px solid #0f172a; padding:2.5px; font-weight:800;">${fmtInt(r.tip)}</td>
            <td style="border:1.5px solid #78350f; padding:2.5px; font-weight:800; font-size:10.5px; background:#fffbeb; color:#78350f;">${isPending ? 'تُحدد بعد الوزنة 2' : `${fmtDec(r.totalWithTip)} ج.م`}</td>
          </tr>
        </tbody>
      </table>

      <!-- الجدول الثاني: السداد والتحصيلات والرصيد التراكمي للتاجر -->
      <table class="print-clean-table" dir="rtl" style="width:100%; table-layout:fixed; border-collapse:collapse; text-align:center; font-size:8px; line-height:1.15;">
        <colgroup>
          <col style="width:13%;" />
          <col style="width:16%;" />
          <col style="width:13%;" />
          <col style="width:17%;" />
          <col style="width:13%;" />
          <col style="width:12%;" />
          <col style="width:16%;" />
        </colgroup>
        <thead>
          <tr style="background:#334155; color:#ffffff; font-weight:800;">
            <th style="border:1px solid #0f172a; padding:2px;">المسدد نقداً اليوم</th>
            <th style="border:1px solid #0f172a; padding:2px;">المسدد بتحويل اليوم</th>
            <th style="border:1px solid #0f172a; padding:2px;">المتبقي آجل اليوم</th>
            <th style="border:1px solid #0f172a; padding:2px;">سداد مديونية سابقة</th>
            <th style="border:1px solid #0f172a; padding:2px; background:#065f46;">إجمالي المسدد بالحركة</th>
            <th style="border:1px solid #0f172a; padding:2px;">الرصيد قبل الحركة</th>
            <th style="border:1px solid #0f172a; padding:2px; background:#b45309; color:#ffffff;">الرصيد التراكمي (${balStateTxt})</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style="border:1px solid #0f172a; padding:2px; font-weight:800; color:#065f46;">${fmtInt(r.cashSales)} ج.م</td>
            <td style="border:1px solid #0f172a; padding:2px; font-weight:800; color:#115e59;">${r.transferSales > 0 ? `${fmtInt(r.transferSales)} (${escXmlStr(r.transferSalesType || 'تحويل')})` : '0 ج.م'}</td>
            <td style="border:1px solid #0f172a; padding:2px; font-weight:800; color:#9f1239;">${fmtInt(r.creditSales)} ج.م</td>
            <td style="border:1px solid #0f172a; padding:2px; font-weight:800; color:#115e59;">${(r.debtCash + r.debtTransfer) > 0 ? `${fmtInt(r.debtCash + r.debtTransfer)} (${r.debtCash > 0 ? `نقدي ${fmtInt(r.debtCash)}` : ''}${r.debtTransfer > 0 ? ` ${escXmlStr(r.debtTransferType || 'تحويل')} ${fmtInt(r.debtTransfer)}` : ''})` : '0 ج.م'}</td>
            <td style="border:1px solid #0f172a; padding:2px; font-weight:800; background:#ecfdf5; color:#064e3b;">${fmtInt(totalSettledTodayForFarm)} ج.م</td>
            <td style="border:1px solid #0f172a; padding:2px; font-weight:800; background:#f8fafc;">${fmtInt(prevBalanceBefore)} ج.م</td>
            <td style="border:1.5px solid #0f172a; padding:2px; font-weight:800; font-size:9.5px; background:#fef3c7; color:#0f172a;">${fmtInt(runningBalanceAfter)} ج.م</td>
          </tr>
        </tbody>
      </table>

      ${extraStripHtml}

      <!-- شريط التوقيعات المختصر للنسخة -->
      <div style="display:flex; align-items:center; justify-content:space-between; margin-top:3px; padding-top:2px; border-top:1px dotted #64748b; font-size:8px; font-weight:800; color:#1e293b;">
        <span>✍️ القائم بالوزن (الميزان): ....................................</span>
        <span>✍️ توقيع السائق / التاجر المستلم: ....................................</span>
        <span>✍️ محاسب الموقع / لجنة البيع: ....................................</span>
      </div>
    </div>
  `;

  const cutLineHtml = `
    <div style="margin:3px 0; border-top:1.5px dashed #475569; text-align:center; font-size:8px; font-weight:800; color:#334155; line-height:1; letter-spacing:0.3px;">
      ✂️ — — — — — — — — — — — — خط قص وفصل الكارتة — — — — — — — — — — — — ✂️
    </div>
  `;

  printContainer.innerHTML = `
    <div class="scale-receipt-print-sheet" style="width:100%; max-width:100%; margin:0 auto; padding:0; background:#ffffff; color:#0f172a; font-family:'Cairo',sans-serif; direction:rtl; page-break-inside:avoid; break-inside:avoid;">
      ${buildSingleCopyHtml(copiesMeta[0])}
      ${cutLineHtml}
      ${buildSingleCopyHtml(copiesMeta[1])}
      ${cutLineHtml}
      ${buildSingleCopyHtml(copiesMeta[2])}
    </div>
  `;
  return true;
}

function renderOfficialDaySettlementReportPrintView(dayNumInput) {
  const printContainer = ensureMerchantPrintDomElements();
  if (!printContainer) return false;
  const d = Number(dayNumInput) || appState.currentDay || 1;
  const s = computeDaySummary(d);
  const fName = appState.farmName || 'أبوذكري';
  const now = new Date();
  const printDateStr = now.toLocaleDateString('ar-EG', { year: 'numeric', month: 'short', day: 'numeric' });
  const printTimeStr = now.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });

  const statusTxt = s.cashBoxDiff === 0
    ? 'خزينة مطابقة تماماً ✓'
    : (s.cashBoxDiff < 0 ? 'زيادة توريد بالخزينة' : 'عجز توريد بالخزينة');
  const diffBg = s.cashBoxDiff === 0 ? '#d1fae5' : '#ffe4e6';
  const diffColor = s.cashBoxDiff === 0 ? '#064e3b' : '#881337';

  // بناء صفوف جدول حركات البيع المسجلة في اليوم
  const allRows = s.allOrderedRows || s.rows || [];
  let salesRowsHtml = '';
  if (allRows.length === 0) {
    salesRowsHtml = `<tr><td colspan="15" style="padding:8px; text-align:center; font-weight:700;">لا توجد حركات بيع مسجلة في هذا اليوم.</td></tr>`;
  } else {
    salesRowsHtml = allRows.map((r, idx) => {
      const debtTxt = (r.debtCash + r.debtTransfer) > 0
        ? `${fmtInt(r.debtCash + r.debtTransfer)} ${r.debtTransfer > 0 ? `(${r.debtTransferType || 'تحويل'})` : '(نقدي)'}`
        : '-';
      const custodyBadge = r.totalCustody > 0 ? ` [عهدة:${fmtInt(r.totalCustody)}]` : '';
      const prevTxt = (r.prevCash + r.prevTransfer) > 0
        ? `${fmtInt(r.prevCash + r.prevTransfer)} ${r.notes ? `[${r.notes}]` : ''}${custodyBadge}`
        : ((r.notes || '') + custodyBadge || (r.isPending ? '⏳ مؤقت' : '-'));
      const rowBg = r.isPending ? '#fef3c7' : (idx % 2 === 0 ? '#ffffff' : '#f8fafc');
      return `<tr style="background:${rowBg};">
        <td style="text-align:center; font-weight:800;">${idx + 1}</td>
        <td style="text-align:center; font-weight:800; color:#1e3a8a;">${r.code || '-'}</td>
        <td style="text-align:right; font-weight:800;">${escXmlStr(r.merchant)}${r.isPending ? ' (وزنة 1)' : ''}</td>
        <td style="text-align:center; font-weight:700;">${escXmlStr(r.scaleNo || '-')} / ${escXmlStr(r.carNo || '-')}</td>
        <td style="text-align:center; font-weight:700;">${fmtInt(r.w1)}</td>
        <td style="text-align:center; font-weight:700;">${r.isPending ? 'مؤقت' : fmtInt(r.w2)}</td>
        <td style="text-align:center; font-weight:800; background:#eff6ff;">${r.isPending ? '0' : fmtInt(r.netWeight)}</td>
        <td style="text-align:center;">${fmtDec(r.price)}</td>
        <td style="text-align:center;">${fmtInt(r.tip)}</td>
        <td style="text-align:center; font-weight:800; background:#eff6ff;">${r.isPending ? '0' : fmtDec(r.totalWithTip)}</td>
        <td style="text-align:center; font-weight:700; color:#065f46;">${r.cashSales ? fmtInt(r.cashSales) : '-'}</td>
        <td style="text-align:center; font-weight:700; color:#78350f;">${r.transferSales ? `${fmtInt(r.transferSales)} (${escXmlStr(r.transferSalesType || 'تحويل')})` : '-'}</td>
        <td style="text-align:center; font-weight:700;">${r.creditSales ? fmtInt(r.creditSales) : '-'}</td>
        <td style="text-align:center; font-weight:700; color:#115e59;">${escXmlStr(debtTxt)}</td>
        <td style="text-align:right; font-size:7.5px; font-weight:700;">${escXmlStr(prevTxt)}</td>
      </tr>`;
    }).join('');
  }

  // بناء صفوف جدول المصروفات اليومية إن وجدت
  let expensesBlockHtml = '';
  if (s.expenses && s.expenses.length > 0) {
    const expRows = s.expenses.map((ex, i) => `
      <tr style="background:${i % 2 === 0 ? '#ffffff' : '#fff1f2'};">
        <td style="border:1px solid #334155; padding:3px; text-align:center; font-weight:800;">${i + 1}</td>
        <td style="border:1px solid #334155; padding:3px 5px; text-align:right; font-weight:800; color:#881337;">${escXmlStr(ex.category)}</td>
        <td style="border:1px solid #334155; padding:3px 5px; text-align:right; font-weight:700;">${escXmlStr(ex.desc || '-')}</td>
        <td style="border:1px solid #334155; padding:3px 5px; text-align:right; font-weight:700;">${escXmlStr(ex.recipient || '-')}</td>
        <td style="border:1px solid #334155; padding:3px 5px; text-align:center; font-weight:800; color:#881337;">${fmtInt(ex.amount)} ج.م</td>
      </tr>
    `).join('');
    expensesBlockHtml = `
      <div style="margin-top:5px;">
        <div style="font-size:9.5px; font-weight:800; color:#881337; margin-bottom:2px;">
          ثالثاً: بيان المصروفات والمكافآت المنصرفة من نقدية اليوم (${s.expenses.length} بند — إجمالي: ${fmtInt(s.sumExpenses)} ج.م):
        </div>
        <table class="print-clean-table" dir="rtl" style="width:100%; table-layout:fixed; border-collapse:collapse; font-size:8px;">
          <colgroup>
            <col style="width:5%;" />
            <col style="width:22%;" />
            <col style="width:41%;" />
            <col style="width:18%;" />
            <col style="width:14%;" />
          </colgroup>
          <thead>
            <tr style="background:#881337; color:#ffffff; font-weight:800; text-align:center;">
              <th style="border:1px solid #334155; padding:3px;">م</th>
              <th style="border:1px solid #334155; padding:3px;">بند / تصنيف المنصرف</th>
              <th style="border:1px solid #334155; padding:3px;">بيان الصرف التفصيلي</th>
              <th style="border:1px solid #334155; padding:3px;">اسم المستلم</th>
              <th style="border:1px solid #334155; padding:3px;">المبلغ المنصرف</th>
            </tr>
          </thead>
          <tbody>${expRows}</tbody>
        </table>
      </div>
    `;
  } else {
    expensesBlockHtml = `
      <div style="margin-top:4px; padding:3px 6px; border:1px solid #cbd5e1; border-radius:4px; background:#f8fafc; font-size:8.5px; font-weight:800; color:#334155;">
        ثالثاً: بيان المصروفات والمكافآت اليومية: لا توجد مصروفات أو مكافآت منصرفة من نقدية هذا اليوم (إجمالي المصروفات = 0 ج.م).
      </div>
    `;
  }

  printContainer.innerHTML = `
    <div style="border:2px solid #0f172a; border-radius:6px; padding:6px 8px; background:#ffffff; color:#0f172a; font-family:'Cairo',sans-serif; direction:rtl;">
      <!-- الترويسة الرسمية وديباجة المحضر -->
      <div style="display:flex; align-items:center; justify-content:space-between; border-bottom:2px solid #1b365d; padding-bottom:4px; margin-bottom:4px;">
        <div>
          <div style="font-size:13.5px; font-weight:800; color:#1b365d;">
            📜 محضر تصفية وميزان مراجعة أعمال لجنة البيع اليومي — مزرعة <span style="color:#b45309;">${escXmlStr(fName)}</span>
          </div>
          <div style="font-size:9px; font-weight:700; color:#334155; margin-top:1px;">
            إنه في <strong>يوم ${d} (${escXmlStr(s.dateLabel)})</strong>، اجتمعت لجنة البيع والوزن والتحصيل لتصفية ومطابقة أوزان ومبيعات ونقدية خزينة اليوم، وأسفرت المراجعة عما يلي:
          </div>
        </div>
        <div style="text-align:left; font-size:8.5px; font-weight:800; color:#1e293b; background:${isDayLocked(d) ? '#ecfdf5' : '#f1f5f9'}; padding:3px 8px; border-radius:4px; border:1.5px solid ${isDayLocked(d) ? '#047857' : '#cbd5e1'};">
          <div>${isDayLocked(d) ? `🔒 محضر مقفل ومعتمد محاسبياً (${escXmlStr((appState.days[d] && appState.days[d].lockedBy) || 'مدير الموقع')})` : `محضر قيد المراجعة — يوم ${d}`}</div>
          <div>${isDayLocked(d) && appState.days[d] && appState.days[d].lockedAtTxt ? `وقت الاعتماد: ${escXmlStr(appState.days[d].lockedAtTxt)} | ` : ''}تاريخ الطباعة: ${printDateStr} (${printTimeStr})</div>
        </div>
      </div>

      <!-- أولاً: جدول المطابقة الوزنية والمحاسبية والنقدية (الركائز الثلاث) -->
      <div style="font-size:9.5px; font-weight:800; color:#1b365d; margin-bottom:2px;">أولاً: ميزان المراجعة والتصفية الشامل (الأوزان + المبيعات والتحويلات + الخزينة النقدية):</div>
      <table class="print-clean-table" dir="rtl" style="width:100%; max-width:100%; table-layout:fixed; border-collapse:collapse; margin-bottom:5px; font-size:8.5px;">
        <colgroup>
          <col style="width:23.0%;" />
          <col style="width:10.3%;" />
          <col style="width:23.0%;" />
          <col style="width:10.3%;" />
          <col style="width:23.0%;" />
          <col style="width:10.4%;" />
        </colgroup>
        <thead>
          <tr style="background:#1b365d; color:#ffffff; font-weight:800; text-align:center;">
            <th colspan="2" style="background:#0c4a6e; padding:3px; border:1px solid #334155;">1. ميزان مراجعة الأوزان (كجم)</th>
            <th colspan="2" style="background:#312e81; padding:3px; border:1px solid #334155;">2. ميزان المبيعات والآجل والتحويلات</th>
            <th colspan="2" style="background:#064e3b; padding:3px; border:1px solid #334155;">3. ميزان الخزينة النقدية للتوريد</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style="border:1px solid #334155; padding:3px 4px; font-weight:700;">عدد السيارات (الحركات المكتملة):</td>
            <td style="border:1px solid #334155; padding:3px 4px; text-align:center; font-weight:800;">${fmtInt(s.countCars)} سيارة</td>
            <td style="border:1px solid #334155; padding:3px 4px; font-weight:800; background:#fffbeb;">إجمالي المبيعات شامل الإكرامية:</td>
            <td style="border:1px solid #334155; padding:3px 4px; text-align:center; font-weight:800; background:#fffbeb;">${fmtDec(s.sumTotalWithTip)} ج.م</td>
            <td style="border:1px solid #334155; padding:3px 4px; font-weight:700;">(+) نقدي المبيعات + نقدي مديونيات الحالية:</td>
            <td style="border:1px solid #334155; padding:3px 4px; text-align:center; font-weight:800;">${fmtInt(s.sumCashSales + s.sumDebtCash)} ج.م</td>
          </tr>
          <tr style="background:#f8fafc;">
            <td style="border:1px solid #334155; padding:3px 4px; font-weight:700;">إجمالي الوزنة الثانية (القائم) - الأولى (الفارغ):</td>
            <td style="border:1px solid #334155; padding:3px 4px; text-align:center; font-weight:800;">${fmtInt(s.sumW2)} - ${fmtInt(s.sumW1)}</td>
            <td style="border:1px solid #334155; padding:3px 4px; font-weight:700;">آجل الفواتير + تحويلات المزرعة الحالية:</td>
            <td style="border:1px solid #334155; padding:3px 4px; text-align:center; font-weight:800;">آجل: ${fmtInt(s.sumCreditSales)} | تحويل: ${fmtInt(s.currentFarmTransfers)}</td>
            <td style="border:1px solid #334155; padding:3px 4px; font-weight:700;">(+) نقدي مزارع سابقة (للخزنة فقط):</td>
            <td style="border:1px solid #334155; padding:3px 4px; text-align:center; font-weight:800;">${fmtInt(s.sumPrevCash)} ج.م</td>
          </tr>
          <tr>
            <td style="border:1px solid #334155; padding:3px 4px; font-weight:800; background:#eff6ff;">إجمالي الوزن الصافي المحسوب:</td>
            <td style="border:1px solid #334155; padding:3px 4px; text-align:center; font-weight:800; background:#eff6ff;">${fmtInt(s.sumNetW)} كجم</td>
            <td style="border:1px solid #334155; padding:3px 4px; font-weight:700; color:#581c87;">تحويلات مزارع سابقة (لا تخصم من الحالية):</td>
            <td style="border:1px solid #334155; padding:3px 4px; text-align:center; font-weight:800; color:#581c87;">${fmtInt(s.sumPrevTransfer)} ج.م</td>
            <td style="border:1px solid #334155; padding:3px 4px; font-weight:800; background:#fef3c7;">إجمالي النقدية بالخزنة (قبل المصاريف):</td>
            <td style="border:1px solid #334155; padding:3px 4px; text-align:center; font-weight:800; background:#fef3c7;">${fmtInt(s.totalCashBeforeExpenses)} ج.م</td>
          </tr>
          <tr style="background:#f8fafc;">
            <td style="border:1px solid #334155; padding:3px 4px; font-weight:800; background:#d1fae5; color:#064e3b;">مطابقة ميزان الأوزان:</td>
            <td style="border:1px solid #334155; padding:3px 4px; text-align:center; font-weight:800; background:#d1fae5; color:#064e3b;">${s.weightAuditDiff === 0 ? 'وزن مطابق ✓ (0)' : fmtInt(s.weightAuditDiff)}</td>
            <td style="border:1px solid #334155; padding:3px 4px; font-weight:800; background:#d1fae5; color:#064e3b;">إجمالي جميع التحويلات اليوم:</td>
            <td style="border:1px solid #334155; padding:3px 4px; text-align:center; font-weight:800; background:#d1fae5; color:#064e3b;">${fmtInt(s.totalAllTransfers)} ج.م</td>
            <td style="border:1px solid #334155; padding:3px 4px; font-weight:800; color:#9f1239;">(-) يخصم: إجمالي المصروفات والمكافآت:</td>
            <td style="border:1px solid #334155; padding:3px 4px; text-align:center; font-weight:800; color:#9f1239;">${fmtInt(s.sumExpenses)} ج.م</td>
          </tr>
          <tr>
            <td style="border:1px solid #334155; padding:3px 4px; font-weight:700;">متوسط سعر الكيلو المرجح | سيارات مؤقتة:</td>
            <td style="border:1px solid #334155; padding:3px 4px; text-align:center; font-weight:800;">${fmtDec(s.avgPrice)} ج.م | مؤقت: ${fmtInt(s.pendingCarsCount)}</td>
            <td style="border:1px solid #334155; padding:3px 4px; font-weight:800; background:#eef2ff; color:#1e1b4b;">حركة المديونية (أول ${fmtInt(s.openingDayDebt)} + آجل - سداد):</td>
            <td style="border:1px solid #334155; padding:3px 4px; text-align:center; font-weight:800; background:#eef2ff; color:#1e1b4b;">آخر اليوم: ${fmtInt(s.closingDayDebt)} ج.م</td>
            <td style="border:1px solid #334155; padding:3px 4px; font-weight:800; background:#f0fdfa; color:#0f766e;">(+) مرحّل من أمس (${fmtInt(s.openingCashFromPrevDay)}) + صافي اليوم:</td>
            <td style="border:1px solid #334155; padding:3px 4px; text-align:center; font-weight:800; background:#f0fdfa; color:#0f766e;">متاح: ${fmtInt(s.totalAvailableCashInBox)} ج.م</td>
          </tr>
          <tr style="background:${diffBg}; color:${diffColor}; font-weight:800;">
            <td colspan="2" style="border:1.5px solid #0f172a; padding:4px; text-align:center;">
              إجمالي النقدية المتاحة بالخزنة: <strong>${fmtInt(s.totalAvailableCashInBox)} ج.م</strong>
            </td>
            <td colspan="2" style="border:1.5px solid #0f172a; padding:4px; text-align:center;">
              المورد للإدارة: <strong>${fmtInt(s.deliveredCash)}</strong> | مرحّل للغد: <strong>${fmtInt(s.carriedForwardCash)} ج.م</strong>
            </td>
            <td colspan="2" style="border:1.5px solid #0f172a; padding:4px; text-align:center;">
              فرق الخزينة: <strong>${fmtInt(s.cashBoxDiff)} ج.م (${statusTxt})</strong>
            </td>
          </tr>
        </tbody>
      </table>

      <!-- ثانياً: جدول حركات البيع والوزنات والتحصيلات المسجلة باليوم -->
      <div style="font-size:9.5px; font-weight:800; color:#1b365d; margin-bottom:2px;">ثانياً: بيان حركات البيع والوزنات والتحصيلات المسجلة بالمحضر (${s.countCars} حركة مكتملة):</div>
      <table id="merchantPrintTable" dir="rtl" style="width:100%; max-width:100%; table-layout:fixed; border-collapse:collapse;">
        <colgroup>
          <col style="width:2.5%;" />
          <col style="width:3.8%;" />
          <col style="width:11.5%;" />
          <col style="width:6.2%;" />
          <col style="width:5.5%;" />
          <col style="width:5.5%;" />
          <col style="width:6.0%;" />
          <col style="width:4.6%;" />
          <col style="width:4.2%;" />
          <col style="width:7.8%;" />
          <col style="width:7.0%;" />
          <col style="width:8.0%;" />
          <col style="width:7.0%;" />
          <col style="width:8.0%;" />
          <col style="width:12.4%;" />
        </colgroup>
        <thead>
          <tr style="background:#1b365d; color:#ffffff; font-weight:800; text-align:center;">
            <th>م</th>
            <th>كود</th>
            <th>اسم التاجر / السيارة</th>
            <th>ميزان/سيارة</th>
            <th>وزنة 1</th>
            <th>وزنة 2</th>
            <th>الصافي</th>
            <th>السعر</th>
            <th>إكرامية</th>
            <th>الإجمالي بالإكرامية</th>
            <th>نقدي مبيعات</th>
            <th>تحويل مبيعات</th>
            <th>آجل اليوم</th>
            <th>سداد مديونيات</th>
            <th>سابقة / ملاحظات</th>
          </tr>
        </thead>
        <tbody>
          ${salesRowsHtml}
        </tbody>
        <tfoot>
          <tr style="background:#fbbf24; color:#0f172a; font-weight:800; text-align:center;">
            <td colspan="4" style="text-align:center;">إجمالي حركات اليوم (${s.countCars} سيارة)</td>
            <td>${fmtInt(s.sumW1)}</td>
            <td>${fmtInt(s.sumW2)}</td>
            <td>${fmtInt(s.sumNetW)}</td>
            <td>${fmtDec(s.avgPrice)}</td>
            <td>${fmtInt(s.sumTip)}</td>
            <td>${fmtDec(s.sumTotalWithTip)}</td>
            <td>${fmtInt(s.sumCashSales)}</td>
            <td>${fmtInt(s.sumTransferSales)}</td>
            <td>${fmtInt(s.sumCreditSales)}</td>
            <td>${fmtInt(s.sumDebtCash + s.sumDebtTransfer)}</td>
            <td>سابقة: ${fmtInt(s.sumPrevCash + s.sumPrevTransfer)}</td>
          </tr>
        </tfoot>
      </table>

      <!-- ثالثاً: بيان المصروفات والمكافآت اليومية -->
      ${expensesBlockHtml}

      <!-- رابعاً: إقرار تصفية الخزينة والتوقيعات الرسمية للجنة البيع وأمين الخزينة -->
      <div style="margin-top:6px; padding:4px 8px; border:1.5px solid #1b365d; border-radius:5px; background:#f8fafc; font-size:8.5px; font-weight:800; color:#0f172a;">
        ✍️ <strong>إقرار لجنة البيع وأمين الخزينة:</strong> تقر لجنة البيع والميزان بصحة الأوزان والفواتير والتحصيلات الموضحة أعلاه عن <strong>(يوم ${d} — ${escXmlStr(s.dateLabel)})</strong>، وأن إجمالي النقدية المتاحة بالخزينة بعد خصم مصروفات اليوم (شاملاً المرحّل من أمس ${fmtInt(s.openingCashFromPrevDay)} ج.م) هو <strong>(${fmtInt(s.totalAvailableCashInBox)} ج.م)</strong>، وقد تم تسليم وتوريد مبلغ <strong>(${fmtInt(s.deliveredCash)} ج.م)</strong> نقداً إلى السيد أمين الخزينة وإبقاء مبلغ <strong>(${fmtInt(s.carriedForwardCash)} ج.م)</strong> مرحّلاً بالخزينة لليوم التالي، وهذا محضر رسمي بذلك للتوقيع والاعتماد.
      </div>

      <table class="print-clean-table" dir="rtl" style="width:100%; table-layout:fixed; border-collapse:collapse; margin-top:5px; text-align:center; font-size:8.5px;">
        <tbody>
          <tr>
            <td style="border:1.5px solid #334155; padding:5px 4px; background:#ffffff;">
              <div style="font-weight:800; color:#1b365d; margin-bottom:15px;">1. مشرف الميزان والوزن</div>
              <div style="color:#334155; font-weight:700;">الاسم: .................................</div>
              <div style="color:#334155; font-weight:700; margin-top:3px;">التوقيع: ...............................</div>
            </td>
            <td style="border:1.5px solid #334155; padding:5px 4px; background:#ffffff;">
              <div style="font-weight:800; color:#1b365d; margin-bottom:15px;">2. عضو لجنة البيع (أول)</div>
              <div style="color:#334155; font-weight:700;">الاسم: .................................</div>
              <div style="color:#334155; font-weight:700; margin-top:3px;">التوقيع: ...............................</div>
            </td>
            <td style="border:1.5px solid #334155; padding:5px 4px; background:#ffffff;">
              <div style="font-weight:800; color:#1b365d; margin-bottom:15px;">3. عضو لجنة البيع / المحاسب</div>
              <div style="color:#334155; font-weight:700;">الاسم: .................................</div>
              <div style="color:#334155; font-weight:700; margin-top:3px;">التوقيع: ...............................</div>
            </td>
            <td style="border:1.5px solid #065f46; padding:5px 4px; background:#ecfdf5;">
              <div style="font-weight:800; color:#064e3b; margin-bottom:15px;">4. أمين الخزينة المستلم</div>
              <div style="color:#065f46; font-weight:700;">الاسم: .................................</div>
              <div style="color:#065f46; font-weight:700; margin-top:3px;">التوقيع بالاستلام: ....................</div>
            </td>
            <td style="border:1.5px solid #b45309; padding:5px 4px; background:#fffbeb;">
              <div style="font-weight:800; color:#78350f; margin-bottom:15px;">5. يعتمد ،، مدير المزرعة</div>
              <div style="color:#92400e; font-weight:700;">الاسم: .................................</div>
              <div style="color:#92400e; font-weight:700; margin-top:3px;">التوقيع والختم: ........................</div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  `;
  return true;
}

function ensureTableRenderedForPrint(tableKey) {
  if (tableKey === 'dailySales' || tableKey === 'pendingWeighIns' || tableKey === 'dailyExpenses') {
    renderDailyView();
  } else if (tableKey === 'dash') {
    renderDashboardView();
  } else if (tableKey === 'merch') {
    renderMerchantsAndStatements('merchants');
  } else if (tableKey === 'transfers' || tableKey === 'prevFarms') {
    renderMerchantsAndStatements('transfers');
  } else if (tableKey === 'expSummary') {
    renderExpensesStatementView();
  }
}

function renderGenericTablePrintView(tableKey) {
  if (tableKey === 'merchantDrillDown') {
    if (!activeDrillDownMerchantCode) return false;
    renderMerchantDrillDownModal();
    return true;
  }
  if (tableKey === 'dailyTrialBalance') {
    return renderDailyTrialBalancePrintView();
  }
  if (tableKey === 'farmTrialBalance') {
    return renderFarmTrialBalancePrintView();
  }
  if (tableKey === 'officialDaySettlement') {
    return renderOfficialDaySettlementReportPrintView(appState.currentDay);
  }
  if (typeof tableKey === 'string' && tableKey.startsWith('scaleReceipt:')) {
    const parts = tableKey.split(':');
    const rDay = Number(parts[1]) || appState.currentDay || 1;
    const rId = parts.slice(2).join(':');
    return renderScaleReceiptPrintView(rId, rDay);
  }
  ensureTableRenderedForPrint(tableKey);
  const cfg = UNIVERSAL_PRINT_TABLE_CONFIGS[tableKey];
  if (!cfg) return false;
  const printContainer = ensureMerchantPrintDomElements();
  const tableEl = document.getElementById(cfg.tableId);
  if (!printContainer || !tableEl) return false;

  const fName = appState.farmName || 'أبوذكري';
  const printDateStr = new Date().toLocaleDateString('ar-EG', { year: 'numeric', month: 'short', day: 'numeric' });
  const excludeSet = new Set(cfg.excludeColIndices || []);
  const alignRightSet = new Set(cfg.alignRightCols || []);
  const numCols = cfg.colWidths.length;

  // 1. Extract Header Row
  const theadTr = tableEl.querySelector('thead tr');
  const thCells = [];
  if (theadTr) {
    Array.from(theadTr.children).forEach((th, idx) => {
      if (excludeSet.has(idx)) return;
      thCells.push(`<th style="font-size:${cfg.fontSize || '8.5px'};">${escXmlStr(cleanPrintCellText(th))}</th>`);
    });
  }

  // 2. Extract Body Rows
  const tbodyTrs = Array.from(tableEl.querySelectorAll('tbody tr'));
  const bodyRowsHtml = [];
  let validRowsCount = 0;

  tbodyTrs.forEach((tr, rIdx) => {
    const children = Array.from(tr.children);
    if (children.length === 1 && children[0].colSpan > 1) {
      const msg = cleanPrintCellText(children[0]);
      bodyRowsHtml.push(`<tr><td colspan="${numCols}" style="padding:10px; text-align:center; font-weight:700; font-size:9.5px;">${escXmlStr(msg)}</td></tr>`);
      return;
    }
    validRowsCount++;
    const isPendingRow = tr.className && tr.className.includes('amber');
    const rowBg = isPendingRow ? '#fef3c7' : (rIdx % 2 === 0 ? '#ffffff' : '#f8fafc');
    const tds = [];
    children.forEach((td, cIdx) => {
      if (excludeSet.has(cIdx)) return;
      const txt = cleanPrintCellText(td);
      const align = alignRightSet.has(cIdx) ? 'right' : 'center';
      const isStrong = td.className && (td.className.includes('font-extrabold') || cIdx === 0 || alignRightSet.has(cIdx));
      let cellBg = '';
      if (td.className && td.className.includes('bg-emerald-50')) cellBg = 'background:#ecfdf5; color:#064e3b;';
      else if (td.className && td.className.includes('bg-amber-50')) cellBg = 'background:#fffbeb; color:#78350f;';
      else if (td.className && td.className.includes('bg-blue-50')) cellBg = 'background:#eff6ff; color:#1e3a8a;';
      else if (td.className && td.className.includes('bg-rose-50')) cellBg = 'background:#fff1f2; color:#881337;';
      else if (td.className && td.className.includes('bg-purple-50')) cellBg = 'background:#faf5ff; color:#581c87;';
      tds.push(`<td style="text-align:${align}; font-weight:${isStrong ? '800' : '700'}; font-size:${cfg.fontSize || '8.5px'}; ${cellBg}">${escXmlStr(txt)}</td>`);
    });
    bodyRowsHtml.push(`<tr style="background:${rowBg};">${tds.join('')}</tr>`);
  });

  // 3. Extract or Build Footer Row
  let tfootHtml = '';
  if (typeof cfg.buildCustomTfootFn === 'function') {
    tfootHtml = cfg.buildCustomTfootFn();
  } else {
    const tfootTr = tableEl.querySelector('tfoot tr');
    if (tfootTr) {
      const fCells = [];
      let spannedCols = 0;
      Array.from(tfootTr.children).forEach((td, idx) => {
        const span = Number(td.getAttribute('colspan')) || 1;
        // Skip trailing action column cell in tfoot if total columns reached numCols
        if (spannedCols >= numCols) return;
        const effectiveSpan = Math.min(span, numCols - spannedCols);
        spannedCols += effectiveSpan;
        const txt = cleanPrintCellText(td);
        const spanAttr = effectiveSpan > 1 ? ` colspan="${effectiveSpan}"` : '';
        fCells.push(`<td${spanAttr} style="text-align:center; font-size:${cfg.fontSize || '8.5px'};">${escXmlStr(txt)}</td>`);
      });
      tfootHtml = `<tr style="background:#fbbf24; color:#0f172a; font-weight:800; text-align:center;">${fCells.join('')}</tr>`;
    }
  }

  const colgroupHtml = cfg.colWidths.map(w => `<col style="width:${w};" />`).join('');
  const kpiBlockHtml = typeof cfg.kpiHtmlFn === 'function' ? cfg.kpiHtmlFn() : '';
  const reportTitle = cfg.titleFn();
  const reportSubTitle = cfg.subTitleFn(validRowsCount);

  printContainer.innerHTML = `
    <div style="border:2px solid #1b365d; border-radius:6px; padding:6px 8px; background:#ffffff; color:#0f172a; font-family:'Cairo',sans-serif;">
      <div style="display:flex; align-items:center; justify-content:space-between; border-bottom:2px solid #1b365d; padding-bottom:4px; margin-bottom:5px;">
        <div>
          <div style="font-size:13px; font-weight:800; color:#1b365d;">
            ${reportTitle} — مزرعة <span style="color:#b45309;">${fName}</span>
          </div>
          <div style="font-size:9px; font-weight:700; color:#475569; margin-top:1px;">
            ${reportSubTitle}
          </div>
        </div>
        <div style="text-align:left; font-size:9px; font-weight:700; color:#334155;">
          <div>نظام محاضر لجان بيع المزارع</div>
          <div>تاريخ الطباعة: ${printDateStr}</div>
        </div>
      </div>

      ${kpiBlockHtml}

      <table id="merchantPrintTable" dir="rtl" style="width:100%; max-width:100%; table-layout:fixed; border-collapse:collapse; margin-top:4px;">
        <colgroup>${colgroupHtml}</colgroup>
        <thead>
          <tr style="background:#1b365d; color:#ffffff; font-weight:800; text-align:center;">
            ${thCells.join('')}
          </tr>
        </thead>
        <tbody>
          ${bodyRowsHtml.join('')}
        </tbody>
        ${tfootHtml ? `<tfoot>${tfootHtml}</tfoot>` : ''}
      </table>
    </div>
  `;
  return true;
}

function activateIsolatedPrintMode(targetKey = '') {
  const keyToPrint = targetKey || activePrintTargetKey || (activeDrillDownMerchantCode ? 'merchantDrillDown' : '');
  if (!keyToPrint) return false;
  activePrintTargetKey = keyToPrint;
  if (!renderGenericTablePrintView(keyToPrint)) return false;
  const printContainer = ensureMerchantPrintDomElements();
  if (!printContainer) return false;
  isMerchantPrintActive = true;
  document.body.classList.add('printing-merchant-modal');
  Array.from(document.body.children).forEach(el => {
    if (!el || !el.style || el.tagName === 'SCRIPT' || el.tagName === 'STYLE') return;
    if (el.id === 'merchantPrintOnlyContainer') {
      el.style.setProperty('display', 'block', 'important');
    } else {
      if (el.dataset.prevPrintDisplay === undefined) {
        el.dataset.prevPrintDisplay = el.style.getPropertyValue('display') || '';
        el.dataset.prevPrintPriority = el.style.getPropertyPriority('display') || '';
      }
      el.style.setProperty('display', 'none', 'important');
    }
  });
  return true;
}

function activateMerchantPrintMode() {
  return activateIsolatedPrintMode('merchantDrillDown');
}

function deactivateMerchantPrintMode() {
  if (!isMerchantPrintActive) return;
  isMerchantPrintActive = false;
  activePrintTargetKey = '';
  Array.from(document.body.children).forEach(el => {
    if (!el || !el.style || el.tagName === 'SCRIPT' || el.tagName === 'STYLE') return;
    if (el.id === 'merchantPrintOnlyContainer') {
      el.style.removeProperty('display');
    } else if (el.dataset.prevPrintDisplay !== undefined) {
      const prevVal = el.dataset.prevPrintDisplay;
      const prevPrio = el.dataset.prevPrintPriority;
      delete el.dataset.prevPrintDisplay;
      delete el.dataset.prevPrintPriority;
      if (prevVal) {
        el.style.setProperty('display', prevVal, prevPrio);
      } else {
        el.style.removeProperty('display');
      }
    }
  });
  const modal = document.getElementById('merchantDrillDownModal');
  if (!modal || modal.classList.contains('hidden')) {
    document.body.classList.remove('printing-merchant-modal');
  }
}

function triggerTablePrint(tableKey) {
  if (!tableKey) return;
  if (activateIsolatedPrintMode(tableKey)) {
    setTimeout(() => {
      try {
        window.print();
      } finally {
        setTimeout(deactivateMerchantPrintMode, 250);
      }
    }, 60);
  }
}

function triggerMerchantStatementPrint() {
  if (!activeDrillDownMerchantCode) return;
  triggerTablePrint('merchantDrillDown');
}

// =========================================================================
// ADVANCED EXPORT ENGINE (PNG IMAGE, PDF DOCUMENT, & STANDALONE EXCEL .XLSX)
// =========================================================================
async function capturePrintContainerCanvas(targetKey) {
  if (!renderGenericTablePrintView(targetKey)) {
    showToast('⚠️ تعذر تجهيز محتوى التصدير!', '⚠️');
    return null;
  }
  const printContainer = ensureMerchantPrintDomElements();
  if (!printContainer) return null;
  if (typeof html2canvas !== 'function') {
    showToast('⚠️ مكتبة تصوير المستندات (html2canvas) غير محملة حالياً — تأكد من الاتصال بالإنترنت لأول مرة.', '⚠️');
    return null;
  }

  // عرض حاوية الطباعة مؤقتاً خارج الشاشة المرئية بدقة قياسية (1120px عرض A4 Landscape) لالتقاطها عبر html2canvas مع دعم كامل للخط العربي RTL
  const prevCssText = printContainer.style.cssText;
  printContainer.style.cssText = 'display:block !important; position:fixed !important; top:0 !important; left:-9999px !important; width:1120px !important; max-width:1120px !important; padding:12px !important; background:#ffffff !important; color:#0f172a !important; direction:rtl !important; z-index:-10 !important;';

  try {
    await new Promise(r => setTimeout(r, 90));
    const canvas = await html2canvas(printContainer, {
      scale: 2,
      useCORS: true,
      allowTaint: true,
      backgroundColor: '#ffffff',
      logging: false,
      windowWidth: 1160
    });
    return canvas;
  } catch (err) {
    showToast('⚠️ حدث خطأ أثناء التقاط صورة المستند!', '⚠️');
    return null;
  } finally {
    printContainer.style.cssText = prevCssText;
  }
}

async function exportPrintTargetAsImageOrPdf(targetKey, format = 'png', customFileBaseName = 'مستند') {
  const cleanBaseName = String(customFileBaseName || 'مستند').replace(/[\/:*?"<>|\s]+/g, '_');
  const dateSlug = new Date().toISOString().slice(0, 10);
  showToast(format === 'pdf' ? '⏳ جاري تجهيز ملف الـ PDF بدقة عالية...' : '⏳ جاري تجهيز الصورة عالية الدقة (PNG)...', '⏳');

  const canvas = await capturePrintContainerCanvas(targetKey);
  if (!canvas) return false;

  if (format === 'png') {
    try {
      const dataUrl = canvas.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `${cleanBaseName}_${dateSlug}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      showToast(`🖼️ تم حفظ وتنزيل الصورة (${cleanBaseName}_${dateSlug}.png) بنجاح!`, '✅');
      return true;
    } catch (e) {
      showToast('⚠️ تعذر حفظ ملف الصورة (.png)', '⚠️');
      return false;
    }
  } else if (format === 'pdf') {
    try {
      const jsPDFConstructor = (window.jspdf && window.jspdf.jsPDF) || window.jsPDF;
      if (!jsPDFConstructor) {
        showToast('⚠️ مكتبة توليد الـ PDF (jsPDF) غير محملة حالياً — تأكد من الاتصال بالإنترنت لأول مرة.', '⚠️');
        return false;
      }
      const imgData = canvas.toDataURL('image/png');
      const isLandscape = canvas.width >= canvas.height;
      const pdf = new jsPDFConstructor({
        orientation: isLandscape ? 'landscape' : 'portrait',
        unit: 'mm',
        format: 'a4',
        compress: true
      });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const marginMm = 6;
      const usableW = pageWidth - (marginMm * 2);
      const usableH = pageHeight - (marginMm * 2);
      const imgHeightMm = (canvas.height * usableW) / canvas.width;

      if (imgHeightMm <= usableH + 2) {
        pdf.addImage(imgData, 'PNG', marginMm, marginMm, usableW, Math.min(imgHeightMm, usableH), undefined, 'FAST');
      } else {
        // تقسيم المستند الطويل إلى صفحات A4 متتالية تلقائياً بدون قص الصفوف
        let heightLeft = imgHeightMm;
        let positionMm = marginMm;
        pdf.addImage(imgData, 'PNG', marginMm, positionMm, usableW, imgHeightMm, undefined, 'FAST');
        heightLeft -= usableH;
        while (heightLeft > 2) {
          positionMm = heightLeft - imgHeightMm + marginMm;
          pdf.addPage();
          pdf.addImage(imgData, 'PNG', marginMm, positionMm, usableW, imgHeightMm, undefined, 'FAST');
          heightLeft -= usableH;
        }
      }
      pdf.save(`${cleanBaseName}_${dateSlug}.pdf`);
      showToast(`📄 تم حفظ وتنزيل ملف الـ PDF (${cleanBaseName}_${dateSlug}.pdf) بنجاح!`, '✅');
      return true;
    } catch (e) {
      showToast('⚠️ تعذر إنشاء ملف الـ PDF!', '⚠️');
      return false;
    }
  }
  return false;
}

async function exportMerchantStatementAsImageOrPdf(format = 'png') {
  if (!activeDrillDownMerchantCode) return;
  const ledger = computeMerchantDetailedLedger(activeDrillDownMerchantCode);
  const fName = appState.farmName || 'أبوذكري';
  const fileBase = `كشف_حساب_${ledger.code}_${ledger.name}_مزرعة_${fName}`;
  await exportPrintTargetAsImageOrPdf('merchantDrillDown', format, fileBase);
}

async function exportScaleReceiptAsImageOrPdf(saleId, dayNumInput, format = 'png') {
  if (!saleId) return;
  const d = Number(dayNumInput) || appState.currentDay || 1;
  const dayObj = (appState.days && appState.days[d]) || {};
  const row = (dayObj.sales || []).find(x => String(x.id) === String(saleId)) ||
              (dayObj.pendingSales || []).find(x => String(x.id) === String(saleId)) || {};
  const fName = appState.farmName || 'أبوذكري';
  const scaleLabel = row.scaleNo ? `بون_${row.scaleNo}` : `وزنة`;
  const merchLabel = row.merchant || 'تاجر';
  const fileBase = `كارتة_ميزان_${scaleLabel}_${merchLabel}_يوم${d}_مزرعة_${fName}`;
  await exportPrintTargetAsImageOrPdf(`scaleReceipt:${d}:${saleId}`, format, fileBase);
}

function exportMerchantDrillDownToExcel() {
  if (!activeDrillDownMerchantCode) return;
  if (typeof XLSX === 'undefined') {
    showToast('⚠️ مكتبة الإكسيل (XLSX) غير متوفرة حالياً!', '⚠️');
    return;
  }
  const ledger = computeMerchantDetailedLedger(activeDrillDownMerchantCode);
  const fName = appState.farmName || 'أبوذكري';
  const q = (document.getElementById('inpFilterMerchantModal')?.value || '').trim().toLowerCase();
  const filteredMovements = q
    ? ledger.movements.filter(m =>
        `يوم ${m.dayNum}`.includes(q) ||
        String(m.dateLabel || '').toLowerCase().includes(q) ||
        String(m.merchant || '').toLowerCase().includes(q) ||
        String(m.scaleNo || '').toLowerCase().includes(q) ||
        String(m.carNo || '').toLowerCase().includes(q) ||
        String(m.transferSalesType || '').toLowerCase().includes(q) ||
        String(m.debtTransferType || '').toLowerCase().includes(q) ||
        String(m.prevTransferType || '').toLowerCase().includes(q) ||
        String(m.notes || '').toLowerCase().includes(q)
      )
    : ledger.movements;

  const aoa = [
    [`كشف حساب تفصيلي للتاجر: ${ledger.name} (الكود الموحد: ${ledger.code}) — مزرعة ${fName}`],
    [`إجمالي السيارات المكتملة: ${ledger.totalCompletedCars} سيارة | إجمالي الوزن الصافي: ${ledger.sumNetWeight} كجم | إجمالي المبيعات بالإكرامية: ${Number(ledger.sumTotalSales.toFixed(2))} ج.م | إجمالي المسدد للمزرعة الحالية: ${Number(ledger.sumTotalSettledCurrent.toFixed(2))} ج.م | صافي المديونية المتبقية: ${Number(ledger.finalRunningBalance.toFixed(2))} ج.م`],
    [],
    [
      'م',
      'اليوم',
      'التاريخ / البيان',
      'اسم التاجر / السيارة الفرعية',
      'ميزان رقم',
      'رقم السيارة',
      'وزنة أولى (فارغ)',
      'وزنة ثانية (قائم)',
      'الوزن الصافي (كجم)',
      'السعر',
      'الإكرامية',
      'إجمالي الفاتورة بالإكرامية',
      'نقدي يوم البيع',
      'تحويل مبيعات',
      'نوع تحويل المبيعات',
      'آجل فاتورة اليوم',
      'سداد مديونية نقدي',
      'سداد مديونية تحويل',
      'نوع تحويل المديونية',
      'إجمالي المسدد بالحركة',
      'الرصيد التراكمي بعد الحركة',
      'تحصيل مزارع سابقة (نقدي)',
      'تحصيل مزارع سابقة (تحويل)',
      'إجمالي العهدة المستقلة',
      'متبقي العهدة',
      'الملاحظات / المزرعة السابقة'
    ]
  ];

  filteredMovements.forEach((r, idx) => {
    aoa.push([
      idx + 1,
      `يوم ${r.dayNum}`,
      r.dateLabel || '',
      r.merchant || '',
      r.scaleNo || '',
      r.carNo || '',
      Number(r.w1) || 0,
      r.isPending ? 'بانتظار وزنة 2' : (Number(r.w2) || 0),
      r.isPending ? 0 : (Number(r.netWeight) || 0),
      Number(r.price) || 0,
      Number(r.tip) || 0,
      r.isPending ? 0 : Number((r.totalWithTip || 0).toFixed(2)),
      Number(r.cashSales) || 0,
      Number(r.transferSales) || 0,
      r.transferSalesType || '',
      Number(r.creditSales) || 0,
      Number(r.debtCash) || 0,
      Number(r.debtTransfer) || 0,
      r.debtTransferType || '',
      r.isPending ? 0 : Number((r.settledInRow || 0).toFixed(2)),
      Number((r.runningBalanceAfter || 0).toFixed(2)),
      Number(r.prevCash) || 0,
      Number(r.prevTransfer) || 0,
      Number(r.totalCustody) || 0,
      Number(r.netCustodyRemaining) || 0,
      r.notes || (r.isPending ? 'محجوز مؤقتاً (وزنة 1)' : '')
    ]);
  });

  aoa.push([
    'الإجمالي',
    `(${ledger.totalCompletedCars} حركة مكتملة)`,
    '',
    ledger.name,
    '',
    '',
    Number(ledger.sumW1) || 0,
    Number(ledger.sumW2) || 0,
    Number(ledger.sumNetWeight) || 0,
    Number((ledger.avgPrice || 0).toFixed(2)),
    Number(ledger.sumTip) || 0,
    Number((ledger.sumTotalSales || 0).toFixed(2)),
    Number(ledger.sumCashSales) || 0,
    Number(ledger.sumTransferSales) || 0,
    '',
    Number(ledger.sumCreditSales) || 0,
    Number(ledger.sumDebtCash) || 0,
    Number(ledger.sumDebtTransfer) || 0,
    '',
    Number((ledger.sumTotalSettledCurrent || 0).toFixed(2)),
    Number((ledger.finalRunningBalance || 0).toFixed(2)),
    Number(ledger.sumPrevCash) || 0,
    Number(ledger.sumPrevTransfer) || 0,
    Number(ledger.sumTotalCustody) || 0,
    Number(ledger.sumNetCustodyRem) || 0,
    ''
  ]);

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!views'] = [{ rightToLeft: true }];
  ws['!cols'] = [
    { wch: 6 }, { wch: 9 }, { wch: 14 }, { wch: 18 }, { wch: 10 }, { wch: 10 },
    { wch: 13 }, { wch: 13 }, { wch: 14 }, { wch: 10 }, { wch: 10 }, { wch: 18 },
    { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 15 }, { wch: 15 },
    { wch: 14 }, { wch: 16 }, { wch: 18 }, { wch: 14 }, { wch: 14 }, { wch: 14 },
    { wch: 14 }, { wch: 24 }
  ];

  const wb = XLSX.utils.book_new();
  wb.Workbook = { Views: [{ RTL: true }] };
  const safeSheetName = `كشف_${ledger.code}_${ledger.name}`.replace(/[\/?*\[\]:]/g, '_').slice(0, 31);
  XLSX.utils.book_append_sheet(wb, ws, safeSheetName);

  const dateSlug = new Date().toISOString().slice(0, 10);
  const fileName = `كشف_حساب_${ledger.code}_${ledger.name.replace(/\s+/g, '_')}_مزرعة_${fName.replace(/\s+/g, '_')}_${dateSlug}.xlsx`;
  XLSX.writeFile(wb, fileName);
  showToast(`📊 تم تصدير وتنزيل شيت إكسيل كشف حساب التاجر (${ledger.name}) بنجاح!`, '✅');
}

function renderMerchantPrintOnlyContainer(ledger, filteredMovements) {
  const printContainer = ensureMerchantPrintDomElements();
  if (!printContainer || !ledger) return;
  const fName = appState.farmName || 'أبوذكري';
  const pendTxt = ledger.totalPendingCars > 0 ? ` (+${ledger.totalPendingCars} مؤقت)` : '';
  const balLabel = ledger.finalRunningBalance > 0
    ? 'عليه للمزرعة'
    : (ledger.finalRunningBalance < 0 ? 'له رصيد دائن' : 'خالص ✓');
  const balBg = ledger.finalRunningBalance > 0 ? '#fef3c7' : (ledger.finalRunningBalance < 0 ? '#e0f2fe' : '#d1fae5');
  const subCarsTxt = ledger.subCarNames && ledger.subCarNames.length > 1
    ? `السيارات التابعة للكود: (${ledger.subCarNames.join(' ، ')})`
    : `اسم التاجر الأساسي: ${ledger.name}`;
  const printDateStr = new Date().toLocaleDateString('ar-EG', { year: 'numeric', month: 'short', day: 'numeric' });

  let extraLineHtml = '';
  const extraParts = [];
  if (ledger.sumTotalCustody > 0) {
    extraParts.push(`💼 بيان العهدة المستقلة: إجمالي العهدة المدفوعة = ${fmtInt(ledger.sumTotalCustody)} ج.م | المتبقي من العهدة بعد سداد المديونيات = ${fmtInt(ledger.sumNetCustodyRem)} ج.م`);
  }
  if ((ledger.sumPrevCash + ledger.sumPrevTransfer) > 0) {
    extraParts.push(`🏦 تحصيلات مزارع سابقة (لا تخصم من الحالية): نقدي = ${fmtInt(ledger.sumPrevCash)} ج.م | تحويل = ${fmtInt(ledger.sumPrevTransfer)} ج.م`);
  }
  if (extraParts.length > 0) {
    extraLineHtml = `<div style="margin-top:4px; padding:3px 6px; border:1px solid #cbd5e1; border-radius:4px; background:#f8fafc; font-size:8.5px; font-weight:700; color:#1e293b;">${extraParts.join(' &nbsp;|&nbsp; ')}</div>`;
  }

  let rowsHtml = '';
  if (!filteredMovements || filteredMovements.length === 0) {
    rowsHtml = `<tr><td colspan="18" style="padding:10px; text-align:center; font-weight:700;">لا توجد حركات مسجلة لهذا التاجر في المزرعة الحالية.</td></tr>`;
  } else {
    rowsHtml = filteredMovements.map((r, idx) => {
      const trSalesTxt = r.transferSales > 0
        ? `${fmtInt(r.transferSales)} (${r.transferSalesType || 'تحويل'})`
        : '-';
      const debtPaidTotal = r.debtCash + r.debtTransfer;
      const debtPaidTxt = debtPaidTotal > 0
        ? `${fmtInt(debtPaidTotal)} (${r.debtCash > 0 && r.debtTransfer > 0 ? `نقدي ${fmtInt(r.debtCash)}+${r.debtTransferType || 'تحويل'} ${fmtInt(r.debtTransfer)}` : (r.debtTransfer > 0 ? (r.debtTransferType || 'تحويل') : 'نقدي')})`
        : '-';
      const extraNotesArr = [];
      if ((r.prevCash + r.prevTransfer) > 0) {
        extraNotesArr.push(`سابقة: ${fmtInt(r.prevCash + r.prevTransfer)}${r.prevTransfer > 0 ? ` (${r.prevTransferType || 'تحويل'})` : ' (نقدي)'}`);
      }
      if (r.totalCustody > 0) {
        extraNotesArr.push(`عهدة: ${fmtInt(r.totalCustody)} (متبقي: ${fmtInt(r.netCustodyRemaining)})`);
      }
      if (r.notes) extraNotesArr.push(r.notes);
      const notesCellTxt = extraNotesArr.join(' | ') || (r.isPending ? '⏳ محجوز (وزنة 1)' : '-');
      const rowBg = r.isPending ? '#fef3c7' : (idx % 2 === 0 ? '#ffffff' : '#f8fafc');
      const runBalBg = r.runningBalanceAfter > 0 ? '#fffbeb' : (r.runningBalanceAfter < 0 ? '#f0f9ff' : '#ecfdf5');

      return `<tr style="background:${rowBg};">
        <td style="text-align:center; font-weight:700;">${idx + 1}</td>
        <td style="text-align:right; font-weight:800;">يوم ${r.dayNum} (${escXmlStr(r.dateLabel)})</td>
        <td style="text-align:right; font-weight:800;">${escXmlStr(r.merchant)}${r.isPending ? ' (مؤقت)' : ''}</td>
        <td style="text-align:center; font-weight:700;">${escXmlStr(r.scaleNo || '-')}</td>
        <td style="text-align:center; font-weight:700;">${escXmlStr(r.carNo || '-')}</td>
        <td style="text-align:center; font-weight:700;">${fmtInt(r.w1)}</td>
        <td style="text-align:center; font-weight:700;">${r.isPending ? 'مؤقت' : fmtInt(r.w2)}</td>
        <td style="text-align:center; font-weight:800; background:#eff6ff;">${r.isPending ? '0' : fmtInt(r.netWeight)}</td>
        <td style="text-align:center;">${fmtDec(r.price)}</td>
        <td style="text-align:center;">${fmtInt(r.tip)}</td>
        <td style="text-align:center; font-weight:800; background:#eff6ff;">${r.isPending ? '0' : fmtDec(r.totalWithTip)}</td>
        <td style="text-align:center; font-weight:700; color:#065f46;">${r.cashSales > 0 ? fmtInt(r.cashSales) : '-'}</td>
        <td style="text-align:center; font-weight:700; color:#115e59;">${escXmlStr(trSalesTxt)}</td>
        <td style="text-align:center; font-weight:700; color:#78350f;">${r.creditSales > 0 ? fmtInt(r.creditSales) : '-'}</td>
        <td style="text-align:center; font-weight:700; color:#115e59;">${escXmlStr(debtPaidTxt)}</td>
        <td style="text-align:center; font-weight:800; background:#ecfdf5; color:#064e3b;">${r.isPending ? '0' : fmtInt(r.settledInRow)}</td>
        <td style="text-align:center; font-weight:800; background:${runBalBg};">${fmtInt(r.runningBalanceAfter)}</td>
        <td style="text-align:right; font-size:8px; font-weight:700;">${escXmlStr(notesCellTxt)}</td>
      </tr>`;
    }).join('');
  }

  printContainer.innerHTML = `
    <div style="border:2px solid #1b365d; border-radius:6px; padding:6px 8px; background:#ffffff; color:#0f172a; font-family:'Cairo',sans-serif;">
      <div style="display:flex; align-items:center; justify-content:space-between; border-bottom:2px solid #1b365d; padding-bottom:4px; margin-bottom:5px;">
        <div>
          <div style="font-size:13px; font-weight:800; color:#1b365d;">
            📋 كشف حساب تفصيلي للتاجر: <span style="color:#b45309;">${ledger.name}</span> (الكود الموحد: ${ledger.code}) — مزرعة ${fName}
          </div>
          <div style="font-size:9px; font-weight:700; color:#475569; margin-top:1px;">
            ${subCarsTxt} &nbsp;|&nbsp; عدد الحركات المعروضة: ${filteredMovements.length} حركة
          </div>
        </div>
        <div style="text-align:left; font-size:9px; font-weight:700; color:#334155;">
          <div>نظام محاضر لجان بيع المزارع</div>
          <div>تاريخ الطباعة: ${printDateStr}</div>
        </div>
      </div>

      <table style="width:100%; table-layout:fixed; border-collapse:collapse; margin-bottom:4px; font-size:9px; text-align:center;">
        <tbody>
          <tr>
            <td style="border:1px solid #94a3b8; padding:3px 4px; background:#f8fafc;">
              <div style="font-size:8px; color:#475569; font-weight:700;">عدد السيارات / الصافي</div>
              <div style="font-weight:800; color:#0f172a;">${fmtInt(ledger.totalCompletedCars)} سيارة${pendTxt} | ${fmtInt(ledger.sumNetWeight)} كجم</div>
            </td>
            <td style="border:1px solid #94a3b8; padding:3px 4px; background:#eff6ff;">
              <div style="font-size:8px; color:#1e3a8a; font-weight:700;">إجمالي الفواتير بالإكرامية</div>
              <div style="font-weight:800; color:#172554;">${fmtDec(ledger.sumTotalSales)} ج.م</div>
            </td>
            <td style="border:1px solid #94a3b8; padding:3px 4px; background:#ecfdf5;">
              <div style="font-size:8px; color:#065f46; font-weight:700;">مسدد نقدي (مبيعات+مديونيات)</div>
              <div style="font-weight:800; color:#064e3b;">${fmtInt(ledger.sumCashSales + ledger.sumDebtCash)} ج.م</div>
            </td>
            <td style="border:1px solid #94a3b8; padding:3px 4px; background:#f0fdfa;">
              <div style="font-size:8px; color:#115e59; font-weight:700;">مسدد بتحويل (مبيعات+مديونيات)</div>
              <div style="font-weight:800; color:#134e4a;">${fmtInt(ledger.sumTransferSales + ledger.sumDebtTransfer)} ج.م</div>
            </td>
            <td style="border:1px solid #94a3b8; padding:3px 4px; background:#d1fae5;">
              <div style="font-size:8px; color:#064e3b; font-weight:700;">إجمالي المسدد للمزرعة الحالية</div>
              <div style="font-weight:800; color:#022c22;">${fmtInt(ledger.sumTotalSettledCurrent)} ج.م</div>
            </td>
            <td style="border:1.5px solid #1e293b; padding:3px 4px; background:${balBg};">
              <div style="font-size:8px; color:#0f172a; font-weight:800;">صافي المديونية (${balLabel})</div>
              <div style="font-size:10px; font-weight:800; color:#0f172a;">${fmtInt(ledger.finalRunningBalance)} ج.م</div>
            </td>
          </tr>
        </tbody>
      </table>

      ${extraLineHtml}

      <table id="merchantPrintTable" dir="rtl" style="width:100%; max-width:100%; table-layout:fixed; border-collapse:collapse; margin-top:4px;">
        <colgroup>
          <col style="width:2.2%;" />
          <col style="width:7.0%;" />
          <col style="width:6.8%;" />
          <col style="width:3.8%;" />
          <col style="width:3.8%;" />
          <col style="width:4.8%;" />
          <col style="width:4.8%;" />
          <col style="width:5.2%;" />
          <col style="width:4.2%;" />
          <col style="width:3.8%;" />
          <col style="width:6.8%;" />
          <col style="width:6.0%;" />
          <col style="width:6.6%;" />
          <col style="width:6.0%;" />
          <col style="width:6.6%;" />
          <col style="width:6.4%;" />
          <col style="width:6.8%;" />
          <col style="width:8.4%;" />
        </colgroup>
        <thead>
          <tr style="background:#1b365d; color:#ffffff; font-weight:800; text-align:center;">
            <th>م</th>
            <th>اليوم والتاريخ</th>
            <th>السيارة / البيان</th>
            <th>ميزان</th>
            <th>سيارة</th>
            <th>وزنة 1</th>
            <th>وزنة 2</th>
            <th>الصافي</th>
            <th>السعر</th>
            <th>إكرامية</th>
            <th>إجمالي الفاتورة</th>
            <th>نقدي مبيعات</th>
            <th>تحويل مبيعات</th>
            <th>آجل اليوم</th>
            <th>سداد مديونية</th>
            <th>إجمالي المسدد</th>
            <th>الرصيد التراكمي</th>
            <th>ملاحظات / سابقة</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
        <tfoot>
          <tr style="background:#fbbf24; color:#0f172a; font-weight:800; text-align:center;">
            <td colspan="5" style="text-align:center;">إجمالي التاجر (${ledger.name} — ${ledger.totalCompletedCars} حركة)</td>
            <td>${fmtInt(ledger.sumW1)}</td>
            <td>${fmtInt(ledger.sumW2)}</td>
            <td>${fmtInt(ledger.sumNetWeight)}</td>
            <td>${fmtDec(ledger.avgPrice)}</td>
            <td>${fmtInt(ledger.sumTip)}</td>
            <td>${fmtDec(ledger.sumTotalSales)}</td>
            <td>${fmtInt(ledger.sumCashSales)}</td>
            <td>${fmtInt(ledger.sumTransferSales)}</td>
            <td>${fmtInt(ledger.sumCreditSales)}</td>
            <td>${fmtInt(ledger.sumDebtCash + ledger.sumDebtTransfer)}</td>
            <td>${fmtInt(ledger.sumTotalSettledCurrent)}</td>
            <td>${fmtInt(ledger.finalRunningBalance)} ج.م</td>
            <td>${ledger.sumPrevCash + ledger.sumPrevTransfer > 0 ? `سابقة: ${fmtInt(ledger.sumPrevCash + ledger.sumPrevTransfer)}` : 'المزرعة الحالية ✓'}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  `;
}

function openMerchantDrillDownModal(merchantCode) {
  const code = Number(merchantCode) || 0;
  if (!code) return;
  activeDrillDownMerchantCode = code;
  const searchInp = document.getElementById('inpFilterMerchantModal');
  if (searchInp) searchInp.value = '';
  renderMerchantDrillDownModal();
  const modal = document.getElementById('merchantDrillDownModal');
  if (modal) modal.classList.remove('hidden');
  document.body.classList.add('printing-merchant-modal');
}

function closeMerchantDrillDownModal() {
  deactivateMerchantPrintMode();
  activeDrillDownMerchantCode = 0;
  const modal = document.getElementById('merchantDrillDownModal');
  if (modal) modal.classList.add('hidden');
  document.body.classList.remove('printing-merchant-modal');
}

function renderMerchantDrillDownModal() {
  if (!activeDrillDownMerchantCode) return;
  const ledger = computeMerchantDetailedLedger(activeDrillDownMerchantCode);
  const fName = appState.farmName || 'أبوذكري';

  const elCode = document.getElementById('mdlMerchCode');
  if (elCode) elCode.textContent = ledger.code;
  const elName = document.getElementById('mdlMerchName');
  if (elName) elName.textContent = ledger.name;
  const elFarm = document.getElementById('mdlMerchFarmName');
  if (elFarm) elFarm.textContent = fName;

  const subTitle = document.getElementById('mdlMerchSubTitle');
  if (subTitle) {
    const subCarsTxt = ledger.subCarNames.length > 1
      ? `السيارات المسجلة تحت هذا الكود: (${ledger.subCarNames.join(' ، ')})`
      : 'سجل الحركات التفصيلي للأوزان والفواتير والمسدد والرصيد التراكمي على مدار الـ 10 أيام';
    subTitle.textContent = subCarsTxt;
  }

  // Populate Merchant Switcher Dropdown inside Modal
  const selSwitcher = document.getElementById('selModalMerchantSwitcher');
  if (selSwitcher && document.activeElement !== selSwitcher) {
    const allMerchants = computeMerchantAggregates();
    selSwitcher.innerHTML = allMerchants.map(m =>
      `<option value="${m.code}" ${Number(m.code) === Number(ledger.code) ? 'selected' : ''}>${m.code} - ${escXmlStr(m.name)} (${m.cars} حركة)</option>`
    ).join('');
  }

  // Render 6 KPI Summary Cards
  const kpiGrid = document.getElementById('mdlMerchKpiGrid');
  if (kpiGrid) {
    const pendTxt = ledger.totalPendingCars > 0 ? ` (+${ledger.totalPendingCars} مؤقت)` : '';
    const balColor = ledger.finalRunningBalance > 0
      ? 'bg-amber-100 border-amber-400 text-amber-950'
      : (ledger.finalRunningBalance < 0 ? 'bg-sky-100 border-sky-400 text-sky-950' : 'bg-emerald-100 border-emerald-400 text-emerald-950');
    const balLabel = ledger.finalRunningBalance > 0
      ? 'عليه للمزرعة'
      : (ledger.finalRunningBalance < 0 ? 'له رصيد دائن' : 'خالص ✓');

    kpiGrid.innerHTML = `
      <div class="p-2.5 rounded-xl border bg-slate-50 border-slate-200">
        <div class="text-[11px] font-bold text-slate-500">عدد السيارات / الصافي</div>
        <div class="text-xs md:text-sm font-extrabold text-slate-900 mt-0.5">
          ${fmtInt(ledger.totalCompletedCars)} سيارة${pendTxt} | <span class="text-blue-800">${fmtInt(ledger.sumNetWeight)} كجم</span>
        </div>
      </div>
      <div class="p-2.5 rounded-xl border bg-blue-50/70 border-blue-200">
        <div class="text-[11px] font-bold text-blue-900">إجمالي الفواتير بالإكرامية</div>
        <div class="text-xs md:text-sm font-extrabold text-blue-950 mt-0.5">${fmtDec(ledger.sumTotalSales)} ج.م</div>
      </div>
      <div class="p-2.5 rounded-xl border bg-emerald-50/70 border-emerald-200">
        <div class="text-[11px] font-bold text-emerald-900">مسدد نقدي (مبيعات + مديونيات)</div>
        <div class="text-xs md:text-sm font-extrabold text-emerald-950 mt-0.5">${fmtInt(ledger.sumCashSales + ledger.sumDebtCash)} ج.م</div>
      </div>
      <div class="p-2.5 rounded-xl border bg-teal-50/70 border-teal-200">
        <div class="text-[11px] font-bold text-teal-900">مسدد بتحويل (مبيعات + مديونيات)</div>
        <div class="text-xs md:text-sm font-extrabold text-teal-950 mt-0.5">${fmtInt(ledger.sumTransferSales + ledger.sumDebtTransfer)} ج.م</div>
      </div>
      <div class="p-2.5 rounded-xl border bg-emerald-100/80 border-emerald-300">
        <div class="text-[11px] font-bold text-emerald-950">إجمالي المسدد للمزرعة الحالية</div>
        <div class="text-xs md:text-sm font-extrabold text-emerald-950 mt-0.5">${fmtInt(ledger.sumTotalSettledCurrent)} ج.م</div>
      </div>
      <div class="p-2.5 rounded-xl border-2 ${balColor}">
        <div class="text-[11px] font-extrabold">صافي المديونية المتبقية (${balLabel})</div>
        <div class="text-sm md:text-base font-extrabold mt-0.5">${fmtInt(ledger.finalRunningBalance)} ج.م</div>
      </div>
    `;
  }

  // Extra Badges Strip for Standalone Custody & Previous Farms Collections
  const extraStrip = document.getElementById('mdlMerchExtraBadges');
  if (extraStrip) {
    const parts = [];
    if (ledger.sumTotalCustody > 0) {
      parts.push(`💼 <span>بيان العهدة المستقلة: إجمالي العهدة المدفوعة = <strong>${fmtInt(ledger.sumTotalCustody)} ج.م</strong> | المتبقي من العهدة بعد خصم سداد المديونيات = <strong class="text-emerald-900">${fmtInt(ledger.sumNetCustodyRem)} ج.م</strong></span>`);
    }
    if ((ledger.sumPrevCash + ledger.sumPrevTransfer) > 0) {
      parts.push(`🏦 <span>تحصيلات مزارع سابقة (لا تُخصم من المزرعة الحالية): نقدي للخزنة = <strong>${fmtInt(ledger.sumPrevCash)} ج.م</strong> | تحويلات سابقة = <strong>${fmtInt(ledger.sumPrevTransfer)} ج.م</strong></span>`);
    }
    if (parts.length > 0) {
      extraStrip.innerHTML = parts.map(p => `<div class="flex items-center gap-1.5">${p}</div>`).join('');
      extraStrip.classList.remove('hidden');
      extraStrip.classList.add('flex');
    } else {
      extraStrip.classList.add('hidden');
      extraStrip.classList.remove('flex');
    }
  }

  // Filter movements by search query
  const q = (document.getElementById('inpFilterMerchantModal')?.value || '').trim().toLowerCase();
  const filteredMovements = q
    ? ledger.movements.filter(m =>
        `يوم ${m.dayNum}`.includes(q) ||
        String(m.dateLabel || '').toLowerCase().includes(q) ||
        String(m.merchant || '').toLowerCase().includes(q) ||
        String(m.scaleNo || '').toLowerCase().includes(q) ||
        String(m.carNo || '').toLowerCase().includes(q) ||
        String(m.transferSalesType || '').toLowerCase().includes(q) ||
        String(m.debtTransferType || '').toLowerCase().includes(q) ||
        String(m.prevTransferType || '').toLowerCase().includes(q) ||
        String(m.notes || '').toLowerCase().includes(q)
      )
    : ledger.movements;

  // Populate the dedicated print-only container for this single merchant
  if (typeof updateReceiptToggleBtnsUI === 'function') updateReceiptToggleBtnsUI();
  renderMerchantPrintOnlyContainer(ledger, filteredMovements);

  const countBadge = document.getElementById('mdlMerchMovementsCountBadge');
  if (countBadge) {
    countBadge.textContent = q
      ? `معروض ${filteredMovements.length} من ${ledger.movements.length} حركة`
      : `${ledger.movements.length} حركة مسجلة في الدورة`;
  }

  const tbody = document.getElementById('merchantDrillDownTbody');
  const tfoot = document.getElementById('merchantDrillDownTfoot');
  if (!tbody || !tfoot) return;
  tbody.innerHTML = '';

  if (filteredMovements.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="19" class="p-6 text-center text-slate-500 font-bold">
          لا توجد حركات مسجلة لهذا التاجر في المزرعة الحالية حتى الآن.
        </td>
      </tr>
    `;
  } else {
    filteredMovements.forEach((r, idx) => {
      const tr = document.createElement('tr');
      if (r.isPending) {
        tr.className = 'bg-amber-50/90 hover:bg-amber-100/75 border-y border-amber-300';
      } else {
        tr.className = idx % 2 === 0 ? 'bg-white hover:bg-blue-50/40' : 'bg-slate-50/70 hover:bg-blue-50/40';
      }

      const trSalesTxt = r.transferSales > 0
        ? `${fmtInt(r.transferSales)} <span class="text-[10px] text-teal-800">(${escXmlStr(r.transferSalesType || 'تحويل')})</span>`
        : '-';
      const debtPaidTotal = r.debtCash + r.debtTransfer;
      const debtPaidTxt = debtPaidTotal > 0
        ? `${fmtInt(debtPaidTotal)} <span class="text-[10px]">(${r.debtCash > 0 && r.debtTransfer > 0 ? `نقدي ${fmtInt(r.debtCash)} + ${escXmlStr(r.debtTransferType || 'تحويل')} ${fmtInt(r.debtTransfer)}` : (r.debtTransfer > 0 ? escXmlStr(r.debtTransferType || 'تحويل') : 'نقدي')})</span>`
        : '-';

      const extraNotesArr = [];
      if ((r.prevCash + r.prevTransfer) > 0) {
        extraNotesArr.push(`سابقة: ${fmtInt(r.prevCash + r.prevTransfer)}${r.prevTransfer > 0 ? ` (${r.prevTransferType || 'تحويل'})` : ' (نقدي)'}`);
      }
      if (r.totalCustody > 0) {
        extraNotesArr.push(`عهدة: ${fmtInt(r.totalCustody)} (متبقي: ${fmtInt(r.netCustodyRemaining)})`);
      }
      if (r.notes) extraNotesArr.push(r.notes);
      const notesCellTxt = extraNotesArr.join(' | ') || (r.isPending ? '⏳ محجوز (بانتظار الوزنة 2)' : '-');

      const runBalCls = r.runningBalanceAfter > 0
        ? 'text-rose-900 bg-amber-50/80'
        : (r.runningBalanceAfter < 0 ? 'text-sky-900 bg-sky-50' : 'text-emerald-900 bg-emerald-50');

      const safeMovId = escXmlStr(r.id);
      tr.innerHTML = `
        <td class="p-2 border text-center font-bold">${idx + 1}</td>
        <td class="p-2 border font-extrabold text-blue-950 whitespace-nowrap">يوم ${r.dayNum} <span class="text-[10px] text-slate-500 font-bold">(${escXmlStr(r.dateLabel)})</span></td>
        <td class="p-2 border font-extrabold text-slate-900">${escXmlStr(r.merchant)} ${r.isPending ? '<span class="px-1.5 py-0.5 rounded bg-amber-400 text-slate-950 text-[10px]">⏳ مؤقت</span>' : ''}</td>
        <td class="p-2 border text-center font-extrabold text-blue-900">${escXmlStr(r.scaleNo || '-')}</td>
        <td class="p-2 border text-center font-bold">${escXmlStr(r.carNo || '-')}</td>
        <td class="p-2 border text-left font-bold">${fmtInt(r.w1)}</td>
        <td class="p-2 border text-left">${r.isPending ? '<span class="text-amber-800 font-extrabold text-[10px]">⏳ بانتظار وزنة 2</span>' : fmtInt(r.w2)}</td>
        <td class="p-2 border text-left font-extrabold bg-blue-50/60 text-blue-950">${r.isPending ? '0' : fmtInt(r.netWeight)}</td>
        <td class="p-2 border text-left">${fmtDec(r.price)}</td>
        <td class="p-2 border text-left">${fmtInt(r.tip)}</td>
        <td class="p-2 border text-left font-extrabold bg-blue-50/60">${r.isPending ? '0' : fmtDec(r.totalWithTip)}</td>
        <td class="p-2 border text-left font-bold text-emerald-800">${r.cashSales > 0 ? fmtInt(r.cashSales) : '-'}</td>
        <td class="p-2 border text-left font-bold text-teal-900">${trSalesTxt}</td>
        <td class="p-2 border text-left font-bold text-amber-950">${r.creditSales > 0 ? fmtInt(r.creditSales) : '-'}</td>
        <td class="p-2 border text-left font-bold text-teal-900">${debtPaidTxt}</td>
        <td class="p-2 border text-left font-extrabold bg-emerald-50 text-emerald-950">${r.isPending ? '0' : fmtInt(r.settledInRow)}</td>
        <td class="p-2 border text-left font-extrabold ${runBalCls}">${fmtInt(r.runningBalanceAfter)}</td>
        <td class="p-2 border text-right text-[11px] font-bold text-purple-900">${escXmlStr(notesCellTxt)}</td>
        <td class="p-1.5 border text-center print-hide-col whitespace-nowrap">
          ${renderAuditTrailBadgeHtml(r)}
          ${excelTableState && excelTableState.showScaleReceiptButtons ? `<span class="inline-flex items-center gap-0.5 ml-1 bg-indigo-50 p-0.5 rounded-lg border border-indigo-200">
            <button type="button" data-print-receipt="${safeMovId}" data-receipt-day="${r.dayNum}" class="px-1.5 py-0.5 rounded bg-indigo-800 hover:bg-indigo-700 text-white font-extrabold text-[10px] whitespace-nowrap shadow-sm" title="طباعة كارتة/بون ميزان (3 نسخ في ورقة واحدة)">🖨️ بون</button>
            <button type="button" data-export-receipt-img="${safeMovId}" data-receipt-day="${r.dayNum}" class="px-1.5 py-0.5 rounded bg-teal-700 hover:bg-teal-600 text-white font-extrabold text-[10px] whitespace-nowrap shadow-sm" title="حفظ كارتة/بون الميزان كصورة PNG">🖼️ صورة</button>
            <button type="button" data-export-receipt-pdf="${safeMovId}" data-receipt-day="${r.dayNum}" class="px-1.5 py-0.5 rounded bg-rose-700 hover:bg-rose-600 text-white font-extrabold text-[10px] whitespace-nowrap shadow-sm" title="حفظ كارتة/بون الميزان كملف PDF">📄 PDF</button>
          </span>` : ''}
          <button type="button" data-modal-jump-day="${r.dayNum}" class="px-2 py-1 rounded-lg bg-blue-100 hover:bg-blue-200 text-blue-900 font-extrabold text-[11px] whitespace-nowrap">
            📂 يوم ${r.dayNum}
          </button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  }

  tfoot.innerHTML = `
    <tr>
      <td colspan="5" class="p-2 border text-center">إجمالي كشف حساب التاجر (${ledger.name} — ${ledger.totalCompletedCars} حركة مكتملة)</td>
      <td class="p-2 border text-left">${fmtInt(ledger.sumW1)}</td>
      <td class="p-2 border text-left">${fmtInt(ledger.sumW2)}</td>
      <td class="p-2 border text-left">${fmtInt(ledger.sumNetWeight)} كجم</td>
      <td class="p-2 border text-left">${fmtDec(ledger.avgPrice)}</td>
      <td class="p-2 border text-left">${fmtInt(ledger.sumTip)}</td>
      <td class="p-2 border text-left">${fmtDec(ledger.sumTotalSales)}</td>
      <td class="p-2 border text-left">${fmtInt(ledger.sumCashSales)}</td>
      <td class="p-2 border text-left">${fmtInt(ledger.sumTransferSales)}</td>
      <td class="p-2 border text-left">${fmtInt(ledger.sumCreditSales)}</td>
      <td class="p-2 border text-left">${fmtInt(ledger.sumDebtCash + ledger.sumDebtTransfer)}</td>
      <td class="p-2 border text-left bg-emerald-300/60">${fmtInt(ledger.sumTotalSettledCurrent)}</td>
      <td class="p-2 border text-left bg-amber-300 text-slate-950">${fmtInt(ledger.finalRunningBalance)} ج.م</td>
      <td class="p-2 border text-center">${ledger.sumPrevCash + ledger.sumPrevTransfer > 0 ? `مزارع سابقة: ${fmtInt(ledger.sumPrevCash + ledger.sumPrevTransfer)} ج.م` : 'رصيد المزرعة الحالية ✓'}</td>
      <td class="p-2 border text-center print-hide-col"></td>
    </tr>
  `;
}

function buildMerchantWhatsappStatementText(merchantCode) {
  const ledger = computeMerchantDetailedLedger(merchantCode);
  const fName = appState.farmName || 'أبوذكري';
  const lines = [
    `📋 *كشف حساب تفصيلي للتاجر: ${ledger.name} (كود ${ledger.code})*`,
    `🏡 *المزرعة:* ${fName}`,
    `━━━━━━━━━━━━━━━━━━━━`
  ];

  if (ledger.movements.length === 0) {
    lines.push('لا توجد حركات مسجلة في هذه الدورة حتى الآن.');
  } else {
    ledger.movements.forEach((r, idx) => {
      if (r.isPending) {
        lines.push(
          `⏳ *حركة ${idx + 1} [يوم ${r.dayNum} - ${r.dateLabel}] (محجوزة مؤقتاً):*`,
          `   • السيارة: ${r.merchant} | ميزان: ${r.scaleNo || '-'} | سيارة رقم: ${r.carNo || '-'}`,
          `   • وزنة أولى (فارغ): ${fmtInt(r.w1)} كجم (بانتظار الوزنة الثانية)`
        );
      } else {
        const payParts = [];
        if (r.cashSales > 0) payParts.push(`نقدي مبيعات: ${fmtInt(r.cashSales)}`);
        if (r.transferSales > 0) payParts.push(`تحويل مبيعات (${r.transferSalesType || 'تحويل'}): ${fmtInt(r.transferSales)}`);
        if (r.creditSales > 0) payParts.push(`آجل اليوم: ${fmtInt(r.creditSales)}`);
        if (r.debtCash > 0) payParts.push(`سداد مديونية نقدي: ${fmtInt(r.debtCash)}`);
        if (r.debtTransfer > 0) payParts.push(`سداد مديونية تحويل (${r.debtTransferType || 'تحويل'}): ${fmtInt(r.debtTransfer)}`);
        if ((r.prevCash + r.prevTransfer) > 0) payParts.push(`تحصيل مزرعة سابقة: ${fmtInt(r.prevCash + r.prevTransfer)}${r.notes ? ` (${r.notes})` : ''}`);

        lines.push(
          `🔹 *حركة ${idx + 1} [يوم ${r.dayNum} - ${r.dateLabel}]:*`,
          `   • البيان: ${r.merchant} | ميزان: ${r.scaleNo || '-'} | سيارة: ${r.carNo || '-'}`,
          `   • الوزن: أولى (${fmtInt(r.w1)}) - ثانية (${fmtInt(r.w2)}) = *صافي ${fmtInt(r.netWeight)} كجم* × سعر ${fmtDec(r.price)}${r.tip > 0 ? ` + إكرامية ${fmtInt(r.tip)}` : ''}`,
          `   • إجمالي الفاتورة: *${fmtDec(r.totalWithTip)} ج.م*`,
          `   • السداد: ${payParts.join(' | ') || 'بدون دفعات'}`,
          `   • إجمالي المسدد بالحركة: ${fmtInt(r.settledInRow)} ج.م | *الرصيد التراكمي بعد الحركة: ${fmtInt(r.runningBalanceAfter)} ج.م*`
        );
      }
    });
  }

  lines.push(
    `━━━━━━━━━━━━━━━━━━━━`,
    `📊 *ملخص حساب التاجر (${ledger.name}) في مزرعة ${fName}:*`,
    `🚛 إجمالي السيارات المكتملة: ${fmtInt(ledger.totalCompletedCars)} سيارة`,
    `⚖️ إجمالي الوزن الصافي: ${fmtInt(ledger.sumNetWeight)} كجم`,
    `💰 إجمالي قيمة الفواتير بالإكرامية: ${fmtDec(ledger.sumTotalSales)} ج.م`,
    `💵 إجمالي المسدد نقداً (مبيعات + مديونيات): ${fmtInt(ledger.sumCashSales + ledger.sumDebtCash)} ج.م`,
    `💳 إجمالي المسدد بتحويل (مبيعات + مديونيات): ${fmtInt(ledger.sumTransferSales + ledger.sumDebtTransfer)} ج.م`,
    `✅ *إجمالي المسدد للمزرعة الحالية: ${fmtInt(ledger.sumTotalSettledCurrent)} ج.م*`,
    `📌 *صافي المديونية المتبقية للمزرعة الحالية: ${fmtInt(ledger.finalRunningBalance)} ج.م*`
  );

  if (ledger.sumTotalCustody > 0) {
    lines.push(`💼 *بيان العهدة المستقلة:* إجمالي العهدة (${fmtInt(ledger.sumTotalCustody)} ج.م) | المتبقي بعد خصم سداد المديونيات (${fmtInt(ledger.sumNetCustodyRem)} ج.م)`);
  }
  if ((ledger.sumPrevCash + ledger.sumPrevTransfer) > 0) {
    lines.push(`🏦 *تحصيلات مزارع سابقة:* ${fmtInt(ledger.sumPrevCash + ledger.sumPrevTransfer)} ج.م`);
  }

  return lines.join('\n');
}

function renderExpensesStatementView() {
  const inpW = document.getElementById('inpCloudWebhookUrl');
  if (inpW && document.activeElement !== inpW) {
    const resolvedUrl = (appState.webhookUrl || getEmbeddedWebhookUrl() || inpW.value || '').trim();
    if (resolvedUrl && !appState.webhookUrl) appState.webhookUrl = resolvedUrl;
    inpW.value = resolvedUrl;
  }

  const catMatrix = {};
  EXPENSE_CATEGORIES.forEach(c => {
    catMatrix[c] = Array(11).fill(0);
  });

  let grandTotalExp = 0;
  const dayTotals = Array(11).fill(0);

  for (let d = 1; d <= 10; d++) {
    const exps = appState.days[d].expenses || [];
    exps.forEach(e => {
      const amt = Number(e.amount) || 0;
      const cat = catMatrix[e.category] ? e.category : 'مصاريف نثرية أخرى';
      catMatrix[cat][d] += amt;
      dayTotals[d] += amt;
      grandTotalExp += amt;
    });
  }

  const activeCategories = EXPENSE_CATEGORIES.filter(cat => catMatrix[cat].slice(1).reduce((a, b) => a + b, 0) > 0);
  const expFilterMode = appState.expensesViewFilter === 'active' ? 'active' : 'all';
  const catsToRender = expFilterMode === 'active' ? activeCategories : EXPENSE_CATEGORIES;

  const btnExpAct = document.getElementById('btnFilterExpSummaryActive');
  const btnExpAll = document.getElementById('btnFilterExpSummaryAll');
  const bdgExpAct = document.getElementById('badgeActiveExpSummaryCount');
  const bdgExpAll = document.getElementById('badgeAllExpSummaryCount');
  if (bdgExpAct) bdgExpAct.textContent = activeCategories.length;
  if (bdgExpAll) bdgExpAll.textContent = EXPENSE_CATEGORIES.length;
  if (btnExpAct && btnExpAll) {
    if (expFilterMode === 'active') {
      btnExpAct.className = 'px-2.5 py-1 rounded-lg text-xs font-extrabold transition flex items-center gap-1 bg-blue-900 text-white shadow-sm';
      btnExpAll.className = 'px-2.5 py-1 rounded-lg text-xs font-extrabold transition flex items-center gap-1 text-slate-700 hover:bg-white/60';
    } else {
      btnExpAll.className = 'px-2.5 py-1 rounded-lg text-xs font-extrabold transition flex items-center gap-1 bg-blue-900 text-white shadow-sm';
      btnExpAct.className = 'px-2.5 py-1 rounded-lg text-xs font-extrabold transition flex items-center gap-1 text-slate-700 hover:bg-white/60';
    }
  }

  const tbody = document.getElementById('expSummaryTbody');
  tbody.innerHTML = '';

  if (catsToRender.length === 0) {
    tbody.innerHTML = `<tr><td colspan="14" class="p-4 text-center text-slate-500 font-bold">لا توجد مصروفات مسجلة في هذه المزرعة حتى الآن — اضغط على <strong>"📋 عرض دليل جميع البنود المكودة (${EXPENSE_CATEGORIES.length})"</strong> لإظهار جميع البنود.</td></tr>`;
  } else {
    catsToRender.forEach((cat, idx) => {
      const rowArr = catMatrix[cat];
      const rowSum = rowArr.slice(1).reduce((a, b) => a + b, 0);
      const pct = grandTotalExp > 0 ? ((rowSum / grandTotalExp) * 100).toFixed(1) + '%' : '0.0%';

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="p-2 border text-center font-bold">${idx + 1}</td>
        <td class="p-2 border font-extrabold text-slate-900">${escXmlStr(cat)}</td>
        <td class="p-2 border text-left font-extrabold bg-rose-50 text-rose-900">${fmtInt(rowSum)}</td>
        <td class="p-2 border text-center">${pct}</td>
        ${[1,2,3,4,5,6,7,8,9,10].map(d => `<td class="p-2 border text-left">${fmtInt(rowArr[d])}</td>`).join('')}
      `;
      tbody.appendChild(tr);
    });
  }

  document.getElementById('expSummaryTfoot').innerHTML = `
    <tr>
      <td colspan="2" class="p-2 border text-center">إجمالي المصروفات والمكافآت المخصومة من النقدية (${catsToRender.length} بند)</td>
      <td class="p-2 border text-left">${fmtInt(grandTotalExp)}</td>
      <td class="p-2 border text-center">100%</td>
      ${[1,2,3,4,5,6,7,8,9,10].map(d => `<td class="p-2 border text-left">${fmtInt(dayTotals[d])}</td>`).join('')}
    </tr>
  `;
  if (typeof applyDomTableExcelEngine === 'function') {
    applyDomTableExcelEngine('expSummary');
  }
}

function getInactivityTimeoutMinutes() {
  const v = Number(appState.inactivityTimeoutMin);
  return (isFinite(v) && v >= 0) ? v : 20;
}

function getInactivityLimitMs() {
  const mins = getInactivityTimeoutMinutes();
  return mins > 0 ? mins * 60 * 1000 : 0;
}

function renderUsersAndPermissionsUI(renderTable = true) {
  appState.users = (appState.users || []).filter(u => u && u.id !== 'visitor');
  const users = appState.users;
  const timeoutMin = getInactivityTimeoutMinutes();
  const inpTimeout = document.getElementById('inpInactivityTimeoutMin');
  if (inpTimeout && document.activeElement !== inpTimeout) {
    inpTimeout.value = String(timeoutMin);
  }
  const selPreset = document.getElementById('selInactivityPreset');
  if (selPreset && document.activeElement !== selPreset) {
    const presetOpts = ['0', '5', '10', '15', '20', '30', '45', '60', '120'];
    if (presetOpts.includes(String(timeoutMin))) {
      selPreset.value = String(timeoutMin);
    }
  }
  const bdgTimeout = document.getElementById('inactivityStatusBadge');
  if (bdgTimeout) {
    if (timeoutMin <= 0) {
      bdgTimeout.textContent = '⏸️ الخروج التلقائي متوقف (مفتوح)';
      bdgTimeout.className = 'px-2.5 py-1 rounded-lg bg-slate-200 text-slate-800 border border-slate-300 text-xs font-extrabold';
    } else {
      bdgTimeout.textContent = `✅ نشط: خروج بعد ${timeoutMin} دقيقة سكون`;
      bdgTimeout.className = 'px-2.5 py-1 rounded-lg bg-emerald-100 text-emerald-950 border border-emerald-300 text-xs font-extrabold';
    }
  }
  const activeUser = getActiveUser();
  const isAdm = Boolean(activeUser.perms && activeUser.perms.admin);
  const isVis = activeUser.id === 'visitor' && !isAdm;
  const shortDisplayName = activeUser.name
    ? String(activeUser.name).replace('(كامل الصلاحيات)', '').replace('(عرض وسحب إكسيل فقط)', '').trim()
    : (activeUser.username || 'المستخدم');

  const hdrIcon = document.getElementById('hdrActiveUserIcon');
  if (hdrIcon) hdrIcon.textContent = isAdm ? '👑' : (isVis ? '👁️' : '👤');

  const hdrDispName = document.getElementById('hdrActiveUserDisplayName');
  if (hdrDispName) hdrDispName.textContent = shortDisplayName;

  const ddFull = document.getElementById('ddUserFullName');
  if (ddFull) ddFull.textContent = activeUser.name || shortDisplayName;

  const ddSub = document.getElementById('ddUserRoleSub');
  if (ddSub) {
    const roleTxt = isAdm ? '👑 مدير الموقع' : (isVis ? '👁️ زائر (عرض فقط)' : '👤 مستخدم مسجل');
    ddSub.textContent = activeUser.jobTitle ? `${roleTxt} — ${activeUser.jobTitle}` : roleTxt;
  }

  const hdrShort = document.getElementById('hdrCurrentUserShort');
  if (hdrShort) {
    hdrShort.textContent = `تسجيل خروج (${shortDisplayName})`;
  }

  // Top Header Select
  const selRole = document.getElementById('selActiveUserRole');
  if (selRole && document.activeElement !== selRole) {
    selRole.innerHTML = users.map(u =>
      `<option value="${escXmlStr(u.id)}" ${u.id === activeUser.id ? 'selected' : ''}>${u.perms && u.perms.admin ? '👑 ' : '👤 '}${escXmlStr(u.name)}</option>`
    ).join('');
  }

  // Visitor Banner & Form Locking
  const isFullViewerOnly = !hasPermission('sales') && !hasPermission('expenses') && !hasPermission('merchants') && !hasPermission('farms');
  const vBanner = document.getElementById('visitorModeBanner');
  if (vBanner) {
    vBanner.classList.toggle('hidden', !isFullViewerOnly);
    if (isFullViewerOnly) {
      document.getElementById('visitorBannerText').textContent =
        `أنت تتصفح الموقع الآن بحساب (${activeUser.name}): متاح لك عرض جميع البيانات وسحب شيت الإكسيل (.xlsx) فقط.`;
    }
  }

  // 1. Visitor: Completely hide ⚙️ التحكم والمزامنة والصلاحيات tab & buttons
  document.querySelectorAll('[data-nav="sync"]').forEach(btn => {
    btn.classList.toggle('hidden', isVis);
  });
  const btnHdrPerm = document.getElementById('btnOpenUsersModal');
  if (btnHdrPerm) btnHdrPerm.classList.toggle('hidden', !isAdm);
  const btnDdPerm = document.getElementById('btnDropdownPermissions');
  if (btnDdPerm) btnDdPerm.classList.toggle('hidden', !isAdm);
  const btnDdProf = document.getElementById('btnOpenMyProfile');
  if (btnDdProf) btnDdProf.classList.toggle('hidden', isVis);

  // If Visitor was on sync tab, redirect immediately to daily tab
  if (isVis && appState.activeTab === 'sync') {
    appState.activeTab = 'daily';
    document.querySelectorAll('.nav-tab-btn').forEach(b => {
      b.classList.toggle('tab-btn-active', b.getAttribute('data-nav') === 'daily');
    });
    const vSync = document.getElementById('view-sync');
    if (vSync) vSync.classList.add('hidden');
    const vDaily = document.getElementById('view-daily');
    if (vDaily) vDaily.classList.remove('hidden');
  }

  // 2. Inside #view-sync:
  //    - Admin sees everything.
  //    - Regular user sees their own account (#myProfileCardSection) + only sections explicitly permitted by Admin.
  //    - Users management (#usersPermissionsModal) is strictly for Admin only.
  const uPerms = (activeUser && activeUser.perms) || {};
  const showQuickCtrl = isAdm || (!isVis && Boolean(uPerms.showSyncExcel));
  const showCloudHub = isAdm || (!isVis && Boolean(uPerms.showSyncCloud || uPerms.farms));
  const showTwoWay = isAdm || (!isVis && Boolean(uPerms.showSyncWebhook));

  const cardQuick = document.getElementById('syncQuickControlCard');
  if (cardQuick) cardQuick.classList.toggle('hidden', isVis);
  const excelHdrRow = document.getElementById('syncQuickExcelHeaderRow');
  if (excelHdrRow) excelHdrRow.classList.toggle('hidden', !showQuickCtrl);
  const dayMgmtSec = document.getElementById('syncDayMgmtSection');
  if (dayMgmtSec) dayMgmtSec.classList.toggle('hidden', !showQuickCtrl);
  const cardCloud = document.getElementById('syncCloudDbHubCard');
  if (cardCloud) cardCloud.classList.toggle('hidden', !showCloudHub);
  const cardBackupAudit = document.getElementById('fullJsonBackupAndAuditCard');
  if (cardBackupAudit) cardBackupAudit.classList.toggle('hidden', isVis);
  const cardTwoWay = document.getElementById('syncTwoWayExcelCard');
  if (cardTwoWay) cardTwoWay.classList.toggle('hidden', !showTwoWay);
  const usersModalCard = document.getElementById('usersPermissionsModal');
  if (usersModalCard) usersModalCard.classList.toggle('hidden', !isAdm);

  // Toggle Forms based on granular permissions & active day lock status
  const curDayLocked = isDayLocked(appState.currentDay);
  const saleCard = document.getElementById('saleFormCard');
  if (saleCard) saleCard.classList.toggle('hidden', !(hasPermission('sales') && !curDayLocked));
  const expForm = document.getElementById('expenseEntryForm');
  if (expForm) expForm.classList.toggle('hidden', !(hasPermission('expenses') && !curDayLocked));
  const merchForm = document.getElementById('addMerchantForm');
  if (merchForm) merchForm.classList.toggle('hidden', !hasPermission('merchants'));
  const usrForm = document.getElementById('addUserForm');
  if (usrForm) usrForm.classList.toggle('hidden', !hasPermission('admin'));
  const topFarmInp = document.getElementById('inpTopFarmName');
  if (topFarmInp) topFarmInp.disabled = !hasPermission('farms');
  const setFarmInp = document.getElementById('inpSettingsFarmName');
  if (setFarmInp) setFarmInp.disabled = !hasPermission('farms');
  const delivCashInp = document.getElementById('inpDeliveredCash');
  if (delivCashInp) delivCashInp.disabled = !(hasPermission('sales') && !curDayLocked);
  const dayDateInp = document.getElementById('currentDayDateInput');
  if (dayDateInp) dayDateInp.disabled = !(hasPermission('sales') && !curDayLocked);
  ['btnAddDayTop', 'btnSaveDayLabel', 'btnDeleteDayTop'].forEach(bid => {
    const b = document.getElementById(bid);
    if (b) b.classList.toggle('hidden', !hasPermission('sales'));
  });
  ['btnAddNewCloudFarm', 'inpNewCloudFarmName', 'btnResetDemoData', 'btnNewCleanCycle', 'btnSaveWebhook', 'inpCloudWebhookUrl', 'btnLinkLiveExcel'].forEach(bid => {
    const b = document.getElementById(bid);
    if (b) b.classList.toggle('hidden', !(hasPermission('farms') || showTwoWay || showQuickCtrl));
  });
  const lblImp = document.querySelector('label[for="fileImportXlsx"]');
  if (lblImp) lblImp.classList.toggle('hidden', !(hasPermission('farms') || showQuickCtrl));

  // Populate Personal Profile Card (#myProfileCardSection) for the active user
  const profCard = document.getElementById('myProfileCardSection');
  if (profCard) {
    profCard.classList.toggle('hidden', isVis);
    document.getElementById('profHeaderUserName').textContent = activeUser.name || activeUser.username || 'مستخدم';
    document.getElementById('profRoleBadge').textContent = activeUser.perms && activeUser.perms.admin
      ? '👑 مدير الموقع (كامل الصلاحيات)'
      : (activeUser.id === 'visitor' ? '👁️ زائر (عرض فقط)' : '👤 حسابي الشخصي');
    const isVisitorAcc = activeUser.id === 'visitor' && !hasPermission('admin');
    document.getElementById('inpProfFullName').value = activeUser.name || '';
    document.getElementById('inpProfUsername').value = activeUser.username || activeUser.id || '';
    document.getElementById('inpProfPhone').value = activeUser.phone || '';
    document.getElementById('inpProfJobTitle').value = activeUser.jobTitle || '';
    document.getElementById('inpProfPassword').value = activeUser.password || '';
    ['inpProfFullName', 'inpProfUsername', 'inpProfPhone', 'inpProfJobTitle', 'inpProfPassword', 'btnSaveMyProfile'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.disabled = isVisitorAcc;
    });
  }

  // Users Table inside Modal (Admin can edit ANY user's data! Rendered only when sync tab is active or requested)
  const uTbody = document.getElementById('usersListTbody');
  if (uTbody && renderTable) {
    const isAdminUser = hasPermission('admin');
    uTbody.innerHTML = users.map(u => {
      const pList = [];
      if (u.perms.admin) pList.push('👑 جميع الصلاحيات (مدير الموقع)');
      else {
        if (u.perms.sales) pList.push('المبيعات والتحصيلات');
        if (u.perms.expenses) pList.push('المصروفات');
        if (u.perms.merchants) pList.push('تكويد التجار');
        if (u.perms.farms) pList.push('إدارة المزارع');
        if (u.perms.showSyncExcel) pList.push('عرض الإكسيل والأيام بالتحكم');
        if (u.perms.showSyncCloud) pList.push('عرض السحابة بالتحكم');
        if (u.perms.showSyncWebhook) pList.push('عرض الربط الثنائي بالتحكم');
        if (u.perms.liteFieldMode) pList.push('📱 شاشة المندوب المبسط تلقائياً');
        if (pList.length === 0) pList.push('👁️ عرض البيانات + حسابه الشخصي فقط');
      }
      const isCurr = u.id === activeUser.id;
      const safeUid = escXmlStr(u.id);
      return `
        <tr class="${isCurr ? 'bg-amber-50 font-bold' : ''}">
          <td class="p-2 border font-extrabold">${escXmlStr(u.name)} ${isCurr ? '<span class="px-2 py-0.5 rounded bg-emerald-600 text-white text-[10px] mr-1">المستخدم النشط</span>' : ''}</td>
          <td class="p-2 border text-center font-bold text-blue-900">${escXmlStr(u.username || u.id)}</td>
          <td class="p-2 border text-center font-mono text-xs">${isAdminUser ? (u.password ? escXmlStr(u.password) : '<span class="text-slate-400">بدون كلمة مرور</span>') : '••••••'}</td>
          <td class="p-2 border text-center text-[11px]">${escXmlStr([u.jobTitle, u.phone].filter(Boolean).join(' | ') || '-')}</td>
          <td class="p-2 border text-center">${u.perms.admin ? 'مدير الموقع' : (pList[0].includes('عرض') ? 'زائر / عرض فقط' : 'مستخدم مخصص')}</td>
          <td class="p-2 border text-slate-700">${escXmlStr(pList.join(' + '))}</td>
          <td class="p-1 border text-center">
            ${isAdminUser ? `
              <button type="button" data-activate-user="${safeUid}" class="px-2 py-1 rounded bg-emerald-100 text-emerald-900 font-bold text-xs ml-1">تفعيل</button>
              <button type="button" data-edit-user="${safeUid}" class="px-2 py-1 rounded bg-blue-100 text-blue-900 font-bold text-xs ml-1">✏️ تعديل البيانات</button>
              ${!u.isSystem ? `
                <button type="button" data-del-user="${safeUid}" class="px-2 py-1 rounded bg-rose-100 text-rose-800 font-bold text-xs">🗑️ حذف</button>
              ` : ''}
            ` : '<span class="text-slate-400 text-[11px]">🔒 خاص بالمدير</span>'}
          </td>
        </tr>
      `;
    }).join('');
    if (typeof applyDomTableExcelEngine === 'function') {
      applyDomTableExcelEngine('usersList');
    }
  }
}

function updateFloatingActionBarVisibilityUI() {
  const isVisible = appState.showFloatingActionBar !== false;
  const barEl = document.getElementById('mobileWeighbridgeActionBar');
  if (barEl) {
    barEl.classList.toggle('hidden', !isVisible);
  }
  if (typeof document !== 'undefined' && document.body) {
    document.body.classList.toggle('floating-bar-hidden', !isVisible);
  }
  const chkEl = document.getElementById('chkShowFloatingActionBar');
  if (chkEl) {
    chkEl.checked = isVisible;
  }
  const badgeEl = document.getElementById('floatingBarStatusBadge');
  if (badgeEl) {
    if (isVisible) {
      badgeEl.textContent = '✅ ظاهر ومثبت (للهاتف والكمبيوتر)';
      badgeEl.className = 'px-2.5 py-1 rounded-lg bg-emerald-100 text-emerald-950 border border-emerald-300 text-xs font-extrabold';
    } else {
      badgeEl.textContent = '🙈 مخفي حالياً (على الهاتف والكمبيوتر)';
      badgeEl.className = 'px-2.5 py-1 rounded-lg bg-slate-200 text-slate-800 border border-slate-300 text-xs font-extrabold';
    }
  }
  const btnEl = document.getElementById('btnToggleFloatingActionBar');
  const btnIcon = document.getElementById('btnToggleFloatingBarIcon');
  const btnTxt = document.getElementById('btnToggleFloatingBarText');
  if (btnEl) {
    btnEl.className = isVisible
      ? 'px-3.5 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-amber-300 font-extrabold text-xs shadow transition flex items-center gap-1.5'
      : 'px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-xs shadow transition flex items-center gap-1.5';
  }
  if (btnIcon) btnIcon.textContent = isVisible ? '🙈' : '👁️';
  if (btnTxt) btnTxt.textContent = isVisible ? 'إخفاء الشريط العائم' : 'إظهار الشريط العائم';
}

function setFloatingActionBarVisibility(showFlag, notify = true) {
  appState.showFloatingActionBar = Boolean(showFlag);
  try {
    localStorage.setItem(STORAGE_KEY + '_show_floating_bar', appState.showFloatingActionBar ? '1' : '0');
  } catch (e) {}
  updateFloatingActionBarVisibilityUI();
  saveState(true);
  if (notify) {
    showToast(
      appState.showFloatingActionBar
        ? 'تم إظهار وتثبيت شريط الإجراءات السفلي العائم للهاتف والكمبيوتر 📌'
        : 'تم إخفاء شريط الإجراءات السفلي العائم للهاتف والكمبيوتر 🙈',
      appState.showFloatingActionBar ? '📌' : '🙈'
    );
  }
}

function ensureStickyTableOptionsStructure() {
  if (!appState.stickyTableOptions || typeof appState.stickyTableOptions !== 'object') {
    appState.stickyTableOptions = { headers: true, footers: true, rightCols: true, leftCols: true };
  }
  return {
    headers: appState.stickyTableOptions.headers !== false,
    footers: appState.stickyTableOptions.footers !== false,
    rightCols: appState.stickyTableOptions.rightCols !== false,
    leftCols: appState.stickyTableOptions.leftCols !== false
  };
}

function updateStickyTablesOptionsUI() {
  const opts = ensureStickyTableOptionsStructure();
  appState.stickyTableOptions = opts;

  if (typeof document !== 'undefined' && document.body) {
    document.body.classList.toggle('sticky-headers-on', Boolean(opts.headers));
    document.body.classList.toggle('sticky-footers-on', Boolean(opts.footers));
    document.body.classList.toggle('sticky-right-cols-on', Boolean(opts.rightCols));
    document.body.classList.toggle('sticky-left-cols-on', Boolean(opts.leftCols));
  }

  const chkH = document.getElementById('chkStickyTableHeaders');
  if (chkH) chkH.checked = Boolean(opts.headers);
  const chkF = document.getElementById('chkStickyTableFooters');
  if (chkF) chkF.checked = Boolean(opts.footers);
  const chkR = document.getElementById('chkStickyTableRightCols');
  if (chkR) chkR.checked = Boolean(opts.rightCols);
  const chkL = document.getElementById('chkStickyTableLeftCols');
  if (chkL) chkL.checked = Boolean(opts.leftCols);

  const activeCount = [opts.headers, opts.footers, opts.rightCols, opts.leftCols].filter(Boolean).length;
  const badgeEl = document.getElementById('stickyTablesSummaryBadge');
  if (badgeEl) {
    if (activeCount === 4) {
      badgeEl.textContent = '✅ مثبت حالياً: 4 من 4 عناصر (الكل نشط)';
      badgeEl.className = 'px-2.5 py-1 rounded-lg bg-emerald-100 text-emerald-950 border border-emerald-300 text-xs font-extrabold';
    } else if (activeCount === 0) {
      badgeEl.textContent = '🔓 التثبيت متوقف حالياً (0 من 4)';
      badgeEl.className = 'px-2.5 py-1 rounded-lg bg-slate-200 text-slate-800 border border-slate-300 text-xs font-extrabold';
    } else {
      badgeEl.textContent = `📌 مثبت حالياً: ${activeCount} من 4 عناصر`;
      badgeEl.className = 'px-2.5 py-1 rounded-lg bg-amber-100 text-amber-950 border border-amber-300 text-xs font-extrabold';
    }
  }

  const ddPill = document.getElementById('ddStickyTablesCountPill');
  if (ddPill) {
    ddPill.textContent = `${activeCount}/4 نشط`;
    ddPill.className = activeCount > 0
      ? 'px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-900 border border-emerald-300 text-[10px] font-extrabold'
      : 'px-1.5 py-0.5 rounded bg-slate-200 text-slate-700 text-[10px] font-bold';
  }
}

function setStickyTableOptions(newOptsPartial, notifyMsg = '') {
  const current = ensureStickyTableOptionsStructure();
  appState.stickyTableOptions = {
    ...current,
    ...newOptsPartial
  };
  try {
    localStorage.setItem(STORAGE_KEY + '_sticky_table_options', JSON.stringify(appState.stickyTableOptions));
  } catch (e) {}
  updateStickyTablesOptionsUI();
  saveState(false);
  if (notifyMsg) {
    showToast(notifyMsg, '📐');
  }
}

function updateAuditMetadataVisibilityUI() {
  const isVisible = appState.showAuditMetadata !== false;
  if (typeof document !== 'undefined' && document.body) {
    document.body.classList.toggle('audit-metadata-hidden', !isVisible);
  }
  const chkEl = document.getElementById('chkShowAuditMetadata');
  if (chkEl) {
    chkEl.checked = isVisible;
  }
  const badgeEl = document.getElementById('auditMetadataStatusBadge');
  if (badgeEl) {
    if (isVisible) {
      badgeEl.textContent = '✅ ظاهرة في جدول البيع';
      badgeEl.className = 'px-2.5 py-1 rounded-lg bg-emerald-100 text-emerald-950 border border-emerald-300 text-xs font-extrabold';
    } else {
      badgeEl.textContent = '🙈 مخفية حالياً من جدول البيع';
      badgeEl.className = 'px-2.5 py-1 rounded-lg bg-slate-200 text-slate-800 border border-slate-300 text-xs font-extrabold';
    }
  }
  const btnEl = document.getElementById('btnToggleAuditMetadata');
  const btnIcon = document.getElementById('btnToggleAuditMetadataIcon');
  const btnTxt = document.getElementById('btnToggleAuditMetadataText');
  if (btnEl) {
    btnEl.className = isVisible
      ? 'px-3.5 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-amber-300 font-extrabold text-xs shadow transition flex items-center gap-1.5'
      : 'px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-xs shadow transition flex items-center gap-1.5';
  }
  if (btnIcon) btnIcon.textContent = isVisible ? '🙈' : '👁️';
  if (btnTxt) btnTxt.textContent = isVisible ? 'إخفاء نصوص الرقابة' : 'إظهار نصوص الرقابة';

  const hdrBtnEl = document.getElementById('btnToggleAuditMetadataHeader');
  const hdrBtnIcon = document.getElementById('btnToggleAuditMetadataHeaderIcon');
  const hdrBtnTxt = document.getElementById('btnToggleAuditMetadataHeaderText');
  if (hdrBtnEl) {
    hdrBtnEl.className = isVisible
      ? 'px-2.5 py-1 rounded-lg bg-amber-400 hover:bg-amber-300 text-slate-950 font-extrabold text-xs shadow-sm transition flex items-center gap-1'
      : 'px-2.5 py-1 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-extrabold text-xs shadow-sm transition flex items-center gap-1';
  }
  if (hdrBtnIcon) hdrBtnIcon.textContent = isVisible ? '🙈' : '👁️';
  if (hdrBtnTxt) hdrBtnTxt.textContent = isVisible ? 'إخفاء نصوص الرقابة بجدول البيع' : 'إظهار نصوص الرقابة بجدول البيع';
}

function setAuditMetadataVisibility(showFlag, notify = true) {
  appState.showAuditMetadata = Boolean(showFlag);
  try {
    localStorage.setItem(STORAGE_KEY + '_show_audit_metadata', appState.showAuditMetadata ? '1' : '0');
  } catch (e) {}
  updateAuditMetadataVisibilityUI();
  saveState(false);
  renderDailyView();
  if (activeDrillDownMerchantCode > 0) {
    const mdl = document.getElementById('merchantDrillDownModal');
    if (mdl && !mdl.classList.contains('hidden')) {
      renderMerchantDrillDownModal();
    }
  }
  if (notify) {
    showToast(
      appState.showAuditMetadata
        ? 'تم إظهار نصوص الرقابة التفصيلية (👤 اسم المندوب | 🕒 وقت الحركة) في جدول حركات البيع المسجلة 👁️'
        : 'تم إخفاء نصوص الرقابة التفصيلية من جدول حركات البيع المسجلة وحفظ تفضيلك 🙈',
      appState.showAuditMetadata ? '👁️' : '🙈'
    );
  }
}

// =========================================================================
// LITE FIELD MODE ENGINE (وضع شاشة المندوب المبسط المدمج - 3 عناصر فقط)
// =========================================================================
function isMobileViewportDevice() {
  if (typeof window === 'undefined') return false;
  return window.innerWidth < 768 || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '');
}

function isUserLockedToLiteFieldMode(userObj = getActiveUser()) {
  if (!userObj || !userObj.perms) return false;
  if (userObj.perms.admin) return false;
  return Boolean(userObj.perms.liteFieldMode);
}

function isLiteFieldModeEffective() {
  const u = getActiveUser();
  if (isUserLockedToLiteFieldMode(u)) {
    if (appState.autoLiteFieldOnMobile !== false && isMobileViewportDevice()) {
      return true;
    }
    return Boolean(appState.liteFieldMode);
  }
  return Boolean(appState.liteFieldMode);
}

function applyAutoLiteFieldModeOnLoginOrSwitch() {
  const u = getActiveUser();
  if (isUserLockedToLiteFieldMode(u) && isMobileViewportDevice() && appState.autoLiteFieldOnMobile !== false) {
    appState.liteFieldMode = true;
    appState.activeTab = 'daily';
    try {
      localStorage.setItem(STORAGE_KEY + '_lite_field_mode', '1');
    } catch (e) {}
  }
  updateLiteFieldModeUI();
}

function setLiteFieldMode(enableFlag, notify = true) {
  appState.liteFieldMode = Boolean(enableFlag);
  try {
    localStorage.setItem(STORAGE_KEY + '_lite_field_mode', appState.liteFieldMode ? '1' : '0');
  } catch (e) {}
  if (appState.liteFieldMode) {
    appState.activeTab = 'daily';
    ['daily', 'dashboard', 'merchants', 'transfers', 'expenses', 'sync'].forEach(v => {
      const sec = document.getElementById(`view-${v}`);
      if (sec) sec.classList.toggle('hidden', v !== 'daily');
    });
  }
  updateLiteFieldModeUI();
  saveState(false);
  renderDailyView();
  if (notify) {
    showToast(
      appState.liteFieldMode
        ? '📱 تم تفعيل "شاشة المندوب المبسط" (الـ 3 عناصر الأساسية فقط: المؤقت + تسجيل البيع/التحصيل + بطاقات حركات اليوم)'
        : '🖥️ تم العودة إلى وضع الموقع الكامل بجميع الجداول والتبويبات',
      appState.liteFieldMode ? '📱' : '🖥️'
    );
  }
}

function updateLiteFieldModeUI() {
  const active = isLiteFieldModeEffective();
  if (typeof document !== 'undefined' && document.body) {
    document.body.classList.toggle('lite-field-mode-active', active);
  }

  if (active && appState.activeTab !== 'daily') {
    appState.activeTab = 'daily';
    ['daily', 'dashboard', 'merchants', 'transfers', 'expenses', 'sync'].forEach(v => {
      const sec = document.getElementById(`view-${v}`);
      if (sec) sec.classList.toggle('hidden', v !== 'daily');
    });
  }

  const bannerEl = document.getElementById('liteFieldModeActiveBanner');
  if (bannerEl) {
    bannerEl.classList.toggle('hidden', !active);
  }
  const fNameEl = document.getElementById('liteBannerFarmName');
  if (fNameEl) fNameEl.textContent = appState.farmName || 'أبوذكري';

  const curDay = Number(appState.currentDay) || 1;
  const curDayObj = (appState.days && appState.days[curDay]) || { dateLabel: `اليوم ${curDay}` };
  const dayLblEl = document.getElementById('liteBannerDayLabel');
  if (dayLblEl) dayLblEl.textContent = `يوم ${curDay} (${curDayObj.dateLabel || ('اليوم ' + curDay)})`;

  const selDaySwitcher = document.getElementById('selLiteQuickDaySwitcher');
  if (selDaySwitcher && document.activeElement !== selDaySwitcher) {
    const visDays = getVisibleDays();
    selDaySwitcher.innerHTML = visDays.map(d => {
      const dObj = (appState.days && appState.days[d]) || {};
      const locked = Boolean(dObj.isLocked);
      return `<option value="${d}" ${d === curDay ? 'selected' : ''}>${locked ? '🔒 ' : ''}يوم ${d} — ${escXmlStr(dObj.dateLabel || ('اليوم ' + d))}</option>`;
    }).join('');
  }

  const hdrBtn = document.getElementById('btnHeaderToggleLiteFieldMode');
  const hdrIcon = document.getElementById('hdrLiteModeIcon');
  const hdrTxt = document.getElementById('hdrLiteModeTxt');
  if (hdrBtn) {
    hdrBtn.className = active
      ? 'px-2 md:px-2.5 py-0.5 md:py-1 rounded-lg bg-amber-400 hover:bg-amber-300 text-slate-950 font-extrabold text-[11px] md:text-xs transition flex items-center gap-1 shadow-md border-2 border-white'
      : 'px-2 md:px-2.5 py-0.5 md:py-1 rounded-lg bg-teal-500/95 hover:bg-teal-400 text-slate-950 font-extrabold text-[11px] md:text-xs transition flex items-center gap-1 shadow-sm border border-teal-200';
  }
  if (hdrIcon) hdrIcon.textContent = active ? '🖥️' : '📱';
  if (hdrTxt) hdrTxt.textContent = active ? 'الوضع الكامل' : 'وضع المندوب';

  const ddLbl = document.getElementById('ddLiteModeLabel');
  const ddPill = document.getElementById('ddLiteModeStatePill');
  if (ddLbl) {
    ddLbl.textContent = active ? 'العودة لوضع الموقع الكامل' : 'تفعيل شاشة المندوب المبسط (3 عناصر)';
  }
  if (ddPill) {
    ddPill.textContent = active ? 'نشط ✓' : 'مغلق';
    ddPill.className = active
      ? 'px-1.5 py-0.5 rounded bg-emerald-600 text-white text-[10px] font-extrabold'
      : 'px-1.5 py-0.5 rounded bg-slate-200 text-slate-700 text-[10px] font-bold';
  }

  const chkLite = document.getElementById('chkEnableLiteFieldMode');
  if (chkLite) chkLite.checked = active;
  const chkAuto = document.getElementById('chkAutoLiteFieldOnMobile');
  if (chkAuto) chkAuto.checked = appState.autoLiteFieldOnMobile !== false;

  const statusBdg = document.getElementById('liteFieldModeStatusBadge');
  if (statusBdg) {
    if (active) {
      statusBdg.textContent = '📱 شاشة المندوب المبسط نشطة (3 عناصر فقط)';
      statusBdg.className = 'px-2.5 py-1 rounded-lg bg-teal-100 text-teal-950 border border-teal-400 text-xs font-extrabold';
    } else {
      statusBdg.textContent = '🖥️ الوضع الكامل نشط حالياً';
      statusBdg.className = 'px-2.5 py-1 rounded-lg bg-slate-200 text-slate-800 border border-slate-300 text-xs font-extrabold';
    }
  }
  const btnCard = document.getElementById('btnToggleLiteFieldModeCard');
  const btnCardIcon = document.getElementById('btnToggleLiteFieldModeIcon');
  const btnCardTxt = document.getElementById('btnToggleLiteFieldModeText');
  if (btnCard) {
    btnCard.className = active
      ? 'px-3.5 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-amber-300 font-extrabold text-xs shadow transition flex items-center gap-1.5'
      : 'px-3.5 py-1.5 rounded-xl bg-teal-800 hover:bg-teal-700 text-white font-extrabold text-xs shadow transition flex items-center gap-1.5';
  }
  if (btnCardIcon) btnCardIcon.textContent = active ? '🖥️' : '📱';
  if (btnCardTxt) btnCardTxt.textContent = active ? 'العودة للوضع الكامل' : 'تفعيل وضع المندوب';
}

function renderLiteFieldModeComponents(dayNum, summary, canEditSalesToday, dayLocked) {
  const active = isLiteFieldModeEffective();
  const pendStripBox = document.getElementById('litePendingCardsStripContainer');
  const pendHorizList = document.getElementById('litePendingCardsHorizontalList');
  const pendCntBadge = document.getElementById('litePendingCardsCountBadge');
  const salesCardsBox = document.getElementById('liteSalesCardsContainer');

  const pendingList = (appState.days[dayNum] && appState.days[dayNum].pendingSales) || [];

  // 1. العنصر الأول: شريط البطاقات الأفقية للوزنات المؤقتة (Swipeable Pending Cards) مع دعم البحث السريع
  if (pendStripBox && pendHorizList && pendCntBadge) {
    const pendQuery = (document.getElementById('inpLiteFilterPendingCards')?.value || '').trim().toLowerCase();
    const filteredPendingList = pendQuery
      ? pendingList.filter(item =>
          String(item.merchant || '').toLowerCase().includes(pendQuery) ||
          String(item.carNo || '').toLowerCase().includes(pendQuery) ||
          String(item.scaleNo || '').toLowerCase().includes(pendQuery) ||
          String(item.w1 || '').toLowerCase().includes(pendQuery) ||
          String(item.notes || '').toLowerCase().includes(pendQuery)
        )
      : pendingList;

    pendCntBadge.textContent = pendQuery
      ? `معروض ${filteredPendingList.length} من ${pendingList.length} سيارة`
      : `${pendingList.length} سيارة`;

    const btnTogglePendSearch = document.getElementById('btnToggleLitePendingSearch');
    const lblTogglePendSearch = document.getElementById('lblToggleLitePendingSearch');
    const pendSearchWrap = document.getElementById('litePendingSearchBoxWrapper');
    const isSearchOpen = pendSearchWrap && !pendSearchWrap.classList.contains('hidden');
    if (btnTogglePendSearch && lblTogglePendSearch) {
      if (pendQuery || isSearchOpen) {
        btnTogglePendSearch.className = 'px-2.5 py-1 rounded-xl bg-slate-900 text-amber-300 border-2 border-amber-400 text-xs font-extrabold shadow-sm transition flex items-center gap-1';
        lblTogglePendSearch.textContent = pendQuery ? `بحث نشط (${filteredPendingList.length})` : 'إغلاق البحث';
      } else {
        btnTogglePendSearch.className = 'px-2.5 py-1 rounded-xl bg-white hover:bg-amber-100 text-slate-900 border-2 border-amber-500 text-xs font-extrabold shadow-sm transition flex items-center gap-1';
        lblTogglePendSearch.textContent = 'بحث سريع';
      }
    }

    if (!active || pendingList.length === 0 || !canEditSalesToday) {
      pendStripBox.classList.add('hidden');
      pendHorizList.innerHTML = '';
    } else if (filteredPendingList.length === 0) {
      pendStripBox.classList.remove('hidden');
      pendHorizList.innerHTML = `
        <div class="w-full bg-white rounded-xl border border-amber-300 p-3 text-center text-xs font-extrabold text-slate-600">
          لا توجد سيارة تحت التحميل مطابقة للبحث (${escXmlStr(pendQuery)}) — اضغط <strong>"مسح ✕"</strong> لإظهار كل السيارات (${pendingList.length}).
        </div>
      `;
    } else {
      pendStripBox.classList.remove('hidden');
      pendHorizList.innerHTML = filteredPendingList.map(item => {
        const safeId = escXmlStr(item.id);
        const custodyAmt = (Number(item.custodyCash) || 0) + (Number(item.custodyTransfer) || 0);
        return `
          <div class="lite-pending-card bg-white rounded-xl border-2 border-amber-500 p-2.5 shadow-sm flex flex-col justify-between gap-2">
            <div class="cursor-pointer" data-recall-pending="${safeId}" title="المس لاسترجاع السيارة وإدخال الوزنة الثانية فوراً">
              <div class="flex items-center justify-between gap-1 border-b border-amber-200 pb-1">
                <span class="px-2 py-0.5 rounded-md bg-slate-900 text-amber-300 text-[11px] font-extrabold">ميزان #${escXmlStr(item.scaleNo || '-')}</span>
                <span class="text-[11px] font-extrabold text-slate-600">سيارة: <strong class="text-slate-950">${escXmlStr(item.carNo || '-')}</strong></span>
              </div>
              <div class="font-extrabold text-sm text-blue-950 mt-1 truncate">${escXmlStr(item.merchant)}</div>
              <div class="flex items-center justify-between text-xs font-extrabold text-amber-900 mt-1 bg-amber-50 px-2 py-1 rounded-lg border border-amber-200">
                <span>وزنة 1 (فارغ):</span>
                <span>${fmtInt(item.w1)} كجم</span>
              </div>
              ${custodyAmt > 0 ? `<div class="text-[10px] font-extrabold text-emerald-800 mt-1">💼 عهدة: ${fmtInt(custodyAmt)} ج.م</div>` : ''}
            </div>
            <div class="flex items-center gap-1.5 pt-1 border-t border-slate-100">
              <button type="button" data-recall-pending="${safeId}" class="flex-1 py-1.5 px-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-xs shadow-sm flex items-center justify-center gap-1">
                <span>🔄</span>
                <span>استكمال وزنة 2</span>
              </button>
              <button type="button" data-print-receipt="${safeId}" data-receipt-day="${dayNum}" class="py-1.5 px-2 rounded-lg bg-indigo-800 hover:bg-indigo-700 text-white font-extrabold text-xs shadow-sm" title="طباعة بون وزنة أولى">
                🖨️
              </button>
              <button type="button" data-del-pending="${safeId}" class="py-1.5 px-2 rounded-lg bg-rose-100 hover:bg-rose-200 text-rose-800 font-extrabold text-xs" title="حذف المؤقت">
                🗑️
              </button>
            </div>
          </div>
        `;
      }).join('');
    }
  }

  // 2. العنصر الثالث: سجل حركات البيع المسجلة اليوم بنظام بطاقات الموبايل (Mobile Sale Cards)
  if (!salesCardsBox) return;
  if (!active) {
    salesCardsBox.classList.add('hidden');
    return;
  }
  salesCardsBox.classList.remove('hidden');

  const q = (document.getElementById('inpFilterDailySales')?.value || '').trim().toLowerCase();
  const allRows = (summary && (summary.allOrderedRows || summary.rows)) || [];
  const filteredRows = q
    ? allRows.filter(r =>
        String(r.merchant || '').toLowerCase().includes(q) ||
        String(r.code || '').includes(q) ||
        String(r.scaleNo || '').includes(q) ||
        String(r.carNo || '').includes(q) ||
        String(r.notes || '').toLowerCase().includes(q)
      )
    : allRows;

  if (filteredRows.length === 0) {
    salesCardsBox.innerHTML = `
      <div class="bg-white rounded-xl border border-slate-200 p-5 text-center text-slate-500 font-extrabold text-xs">
        لا توجد حركات بيع مسجلة في هذا اليوم حتى الآن — استخدم لوحة التسجيل أعلاه لإضافة وزنة أو سند تحصيل.
      </div>
    `;
    return;
  }

  salesCardsBox.innerHTML = filteredRows.map((r, idx) => {
    const safeId = escXmlStr(r.id);
    const safeMerchant = escXmlStr(r.merchant);
    const auditBadge = renderAuditTrailBadgeHtml(r);
    const isPend = Boolean(r.isPending);
    const isDebtOnly = Boolean(r.isDebtCollectionOnly);

    const cardBorder = isPend
      ? 'border-2 border-amber-400 bg-amber-50/90'
      : (isDebtOnly ? 'border-2 border-teal-500 bg-teal-50/40' : 'border border-slate-300 bg-white');

    const statusBadge = isPend
      ? '<span class="px-2 py-0.5 rounded-md bg-amber-400 text-slate-950 text-[10px] font-extrabold">⏳ بانتظار وزنة 2</span>'
      : (isDebtOnly
          ? '<span class="px-2 py-0.5 rounded-md bg-teal-700 text-white text-[10px] font-extrabold">💵 سند تحصيل مديونية</span>'
          : `<span class="px-2 py-0.5 rounded-md bg-blue-900 text-amber-300 text-[11px] font-extrabold">صافي: ${fmtInt(r.netWeight)} كجم</span>`);

    const settledToday = r.cashSales + r.transferSales + r.debtCash + r.debtTransfer;
    const debtCollected = r.debtCash + r.debtTransfer;

    const actionsHtml = !canEditSalesToday
      ? `<span class="text-slate-500 text-[11px] font-bold">${dayLocked ? '🔒 يوم معتمد ومقفل' : '🔒 عرض فقط'}</span>`
      : (isPend
          ? `<button type="button" data-recall-pending="${safeId}" class="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-xs shadow-sm">🔄 استكمال وزنة 2</button>
             <button type="button" data-del-pending="${safeId}" class="px-2.5 py-1.5 rounded-lg bg-rose-100 hover:bg-rose-200 text-rose-800 font-bold text-xs">🗑️ حذف</button>`
          : `<button type="button" data-edit-sale="${safeId}" class="px-3 py-1.5 rounded-lg bg-blue-100 hover:bg-blue-200 text-blue-900 font-extrabold text-xs">✏️ تعديل</button>
             <button type="button" data-del-sale="${safeId}" class="px-2.5 py-1.5 rounded-lg bg-rose-100 hover:bg-rose-200 text-rose-800 font-bold text-xs">🗑️ حذف</button>`);

    return `
      <div class="rounded-2xl p-3 shadow-sm ${cardBorder} space-y-2">
        <!-- السطر الأول: المسلسل + التاجر والكود + رقم الميزان والسيارة + شارة الصافي/الحالة -->
        <div class="flex items-center justify-between gap-2 flex-wrap border-b border-slate-200/80 pb-1.5">
          <div class="flex items-center gap-1.5 flex-wrap">
            <span class="w-6 h-6 rounded-full bg-slate-800 text-white text-[11px] font-extrabold inline-flex items-center justify-center">${idx + 1}</span>
            <span class="px-1.5 py-0.5 rounded bg-blue-50 text-blue-900 border border-blue-200 text-[11px] font-extrabold">كود ${r.code || '-'}</span>
            <span class="font-extrabold text-sm text-slate-900">${safeMerchant}</span>
            <span class="text-[11px] font-bold text-slate-600">(ميزان: <strong>${escXmlStr(r.scaleNo || '-')}</strong> | سيارة: <strong>${escXmlStr(r.carNo || '-')}</strong>)</span>
          </div>
          ${statusBadge}
        </div>

        <!-- السطر الثاني: الأوزان والفاتورة والمسدد والآجل -->
        ${isDebtOnly ? `
          <div class="grid grid-cols-2 sm:grid-cols-3 gap-1.5 text-xs font-extrabold">
            <div class="bg-white p-1.5 rounded-lg border border-teal-200">
              <span class="text-slate-500 block text-[10px]">سداد مديونية نقدي:</span>
              <span class="text-emerald-800">${fmtInt(r.debtCash)} ج.م</span>
            </div>
            <div class="bg-white p-1.5 rounded-lg border border-teal-200">
              <span class="text-slate-500 block text-[10px]">سداد مديونية تحويل:</span>
              <span class="text-teal-900">${r.debtTransfer > 0 ? `${fmtInt(r.debtTransfer)} (${escXmlStr(r.debtTransferType || 'تحويل')})` : '0 ج.م'}</span>
            </div>
            <div class="bg-teal-100/80 p-1.5 rounded-lg border border-teal-300 col-span-2 sm:col-span-1">
              <span class="text-teal-900 block text-[10px]">إجمالي السند المحصل:</span>
              <span class="text-teal-950">${fmtInt(debtCollected + r.prevCash + r.prevTransfer)} ج.م</span>
            </div>
          </div>
        ` : `
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-1.5 text-xs font-extrabold">
            <div class="bg-slate-50 p-1.5 rounded-lg border border-slate-200">
              <span class="text-slate-500 block text-[10px]">وزنة 1 ⬅️ وزنة 2:</span>
              <span class="text-slate-900">${fmtInt(r.w1)} ⬅️ ${isPend ? '⏳' : fmtInt(r.w2)} كجم</span>
            </div>
            <div class="bg-blue-50/70 p-1.5 rounded-lg border border-blue-200">
              <span class="text-blue-800 block text-[10px]">إجمالي الفاتورة (${fmtDec(r.price)}):</span>
              <span class="text-blue-950">${isPend ? 'بانتظار وزنة 2' : `${fmtDec(r.totalWithTip)} ج.م`}</span>
            </div>
            <div class="bg-emerald-50/70 p-1.5 rounded-lg border border-emerald-200">
              <span class="text-emerald-800 block text-[10px]">المسدد بالحركة:</span>
              <span class="text-emerald-950">${fmtInt(settledToday)} ج.م</span>
            </div>
            <div class="bg-amber-50/80 p-1.5 rounded-lg border border-amber-300">
              <span class="text-amber-900 block text-[10px]">آجل اليوم / سداد قديم:</span>
              <span class="text-slate-950">آجل: ${fmtInt(r.creditSales)}${debtCollected > 0 ? ` | مديونية: ${fmtInt(debtCollected)}` : ''}</span>
            </div>
          </div>
        `}

        <!-- السطر الثالث: أزرار الإجراءات السريعة وبون الميزان -->
        <div class="flex items-center justify-between gap-2 flex-wrap pt-1 border-t border-slate-100">
          <div class="flex items-center gap-1 flex-wrap">
            ${auditBadge}
            <button type="button" data-print-receipt="${safeId}" data-receipt-day="${dayNum}" class="px-2.5 py-1 rounded-lg bg-indigo-800 hover:bg-indigo-700 text-white font-extrabold text-[11px] shadow-sm">
              🖨️ بون
            </button>
            <button type="button" data-export-receipt-img="${safeId}" data-receipt-day="${dayNum}" class="px-2 py-1 rounded-lg bg-teal-700 hover:bg-teal-600 text-white font-extrabold text-[11px] shadow-sm">
              🖼️ صورة
            </button>
          </div>
          <div class="flex items-center gap-1.5">
            ${actionsHtml}
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function renderBackupAndAuditCenterUI() {
  syncActiveFarmIntoArchive();
  updateAuditMetadataVisibilityUI();
  const archive = appState.farmsArchive || {};
  const farmNames = Object.keys(archive);
  const merchCount = (appState.merchants || []).length;
  const usersCount = (appState.users || []).filter(u => u && u.id !== 'visitor').length;
  const activeUser = getActiveUser();
  const isAdm = Boolean(activeUser && activeUser.perms && activeUser.perms.admin);

  const elFarms = document.getElementById('backupKpiFarmsCount');
  if (elFarms) elFarms.textContent = `${farmNames.length} مزرعة محفوظة`;

  const elMerchUsers = document.getElementById('backupKpiMerchUsersCount');
  if (elMerchUsers) elMerchUsers.textContent = `${merchCount} تاجر | ${usersCount} مستخدم`;

  const elDel = document.getElementById('backupKpiActiveDelegate');
  if (elDel) {
    elDel.textContent = `${isAdm ? '👑' : '👤'} ${getActiveUserShortLabel()}`;
  }

  const lastBadge = document.getElementById('backupLastStatusBadge');
  if (lastBadge && appState.lastJsonBackup) {
    lastBadge.textContent = appState.lastJsonBackup;
  }

  // Collect all movements in active farm for Audit Trail Table
  const auditEntries = [];
  for (let d = 1; d <= 10; d++) {
    const dayObj = (appState.days && appState.days[d]) || {};
    const dateLbl = dayObj.dateLabel || `اليوم ${d}`;

    (dayObj.sales || []).forEach(s => {
      const comp = computeSaleRow(s);
      const ts = Number(s.updatedAt) || Number(s.createdAt) || extractTimestampFromRecord(s) || 0;
      const cBy = String(s.createdBy || s.updatedBy || 'مدير الموقع').trim();
      const uBy = String(s.updatedBy || cBy).trim();
      const cTxt = String(s.createdTimeTxt || (ts > 0 ? formatAuditTimeArabic(Number(s.createdAt) || ts) : '-')).trim();
      const uTxt = String(s.updatedTimeTxt || cTxt).trim();
      const diffTxt = String(s.lastEditDiffText || '').trim();
      const editHist = Array.isArray(s.editHistory) ? s.editHistory : [];
      auditEntries.push({
        type: 'sale',
        typeLabel: '🚛 وزنة بيع مكتملة',
        typeBadgeCls: 'bg-emerald-100 text-emerald-950 border-emerald-300',
        dayNum: d,
        dateLabel: dateLbl,
        title: `${s.merchant || '-'} (ميزان ${s.scaleNo || '-'} / سيارة ${s.carNo || '-'})`,
        detail: `صافي: ${fmtInt(comp.netWeight)} كجم | فاتورة: ${fmtDec(comp.totalWithTip)} ج.م`,
        createdBy: cBy,
        updatedBy: uBy,
        createdTimeTxt: cTxt,
        updatedTimeTxt: uTxt,
        lastEditDiffText: diffTxt,
        editHistory: editHist,
        isEdited: Boolean(s.isEdited || diffTxt || cBy !== uBy),
        sortTs: ts
      });
    });

    (dayObj.pendingSales || []).forEach(p => {
      const ts = Number(p.updatedAt) || Number(p.createdAt) || extractTimestampFromRecord(p) || 0;
      const cBy = String(p.createdBy || p.updatedBy || 'مدير الموقع').trim();
      const uBy = String(p.updatedBy || cBy).trim();
      const cTxt = String(p.createdTimeTxt || (ts > 0 ? formatAuditTimeArabic(Number(p.createdAt) || ts) : '-')).trim();
      const uTxt = String(p.updatedTimeTxt || cTxt).trim();
      const diffTxt = String(p.lastEditDiffText || '').trim();
      const editHist = Array.isArray(p.editHistory) ? p.editHistory : [];
      auditEntries.push({
        type: 'pending',
        typeLabel: '⏳ وزنة أولى مؤقتة',
        typeBadgeCls: 'bg-amber-100 text-amber-950 border-amber-300',
        dayNum: d,
        dateLabel: dateLbl,
        title: `${p.merchant || '-'} (ميزان ${p.scaleNo || '-'} / سيارة ${p.carNo || '-'})`,
        detail: `وزنة 1 (فارغ): ${fmtInt(p.w1)} كجم`,
        createdBy: cBy,
        updatedBy: uBy,
        createdTimeTxt: cTxt,
        updatedTimeTxt: uTxt,
        lastEditDiffText: diffTxt,
        editHistory: editHist,
        isEdited: Boolean(p.isEdited || diffTxt || cBy !== uBy),
        sortTs: ts
      });
    });

    (dayObj.expenses || []).forEach(ex => {
      const ts = Number(ex.updatedAt) || Number(ex.createdAt) || extractTimestampFromRecord(ex) || 0;
      const cBy = String(ex.createdBy || ex.updatedBy || 'مدير الموقع').trim();
      const uBy = String(ex.updatedBy || cBy).trim();
      const cTxt = String(ex.createdTimeTxt || (ts > 0 ? formatAuditTimeArabic(Number(ex.createdAt) || ts) : '-')).trim();
      const uTxt = String(ex.updatedTimeTxt || cTxt).trim();
      const diffTxt = String(ex.lastEditDiffText || '').trim();
      const editHist = Array.isArray(ex.editHistory) ? ex.editHistory : [];
      auditEntries.push({
        type: 'expense',
        typeLabel: '💸 مصروف / مكافأة',
        typeBadgeCls: 'bg-rose-100 text-rose-950 border-rose-300',
        dayNum: d,
        dateLabel: dateLbl,
        title: `${ex.category || '-'} — ${ex.desc || '-'}${ex.recipient ? ` (المستلم: ${ex.recipient})` : ''}`,
        detail: `المنصرف: ${fmtInt(ex.amount)} ج.م`,
        createdBy: cBy,
        updatedBy: uBy,
        createdTimeTxt: cTxt,
        updatedTimeTxt: uTxt,
        lastEditDiffText: diffTxt,
        editHistory: editHist,
        isEdited: Boolean(ex.isEdited || diffTxt || cBy !== uBy),
        sortTs: ts
      });
    });
  }

  auditEntries.sort((a, b) => (b.sortTs - a.sortTs) || (b.dayNum - a.dayNum));

  const elTotMov = document.getElementById('backupKpiTotalMovements');
  if (elTotMov) elTotMov.textContent = `${fmtInt(auditEntries.length)} حركة موثقة`;

  const q = (document.getElementById('inpFilterAuditTrail')?.value || '').trim().toLowerCase();
  const typeFilter = document.getElementById('selFilterAuditType')?.value || 'all';

  const filteredAudit = auditEntries.filter(item => {
    if (typeFilter !== 'all' && item.type !== typeFilter) return false;
    if (!q) return true;
    const histConcat = (item.editHistory || []).map(h => `${h.by || ''} ${h.diffText || ''}`).join(' ').toLowerCase();
    return (
      item.title.toLowerCase().includes(q) ||
      item.detail.toLowerCase().includes(q) ||
      item.createdBy.toLowerCase().includes(q) ||
      item.updatedBy.toLowerCase().includes(q) ||
      (item.lastEditDiffText || '').toLowerCase().includes(q) ||
      histConcat.includes(q) ||
      `يوم ${item.dayNum}`.includes(q) ||
      item.dateLabel.toLowerCase().includes(q) ||
      item.typeLabel.toLowerCase().includes(q)
    );
  });

  const cntBadge = document.getElementById('auditTrailCountBadge');
  if (cntBadge) {
    cntBadge.textContent = q || typeFilter !== 'all'
      ? `معروض ${filteredAudit.length} من ${auditEntries.length} حركة`
      : `${auditEntries.length} حركة في مزرعة (${appState.farmName || 'أبوذكري'})`;
  }

  const tbody = document.getElementById('auditTrailTbody');
  if (!tbody) return;
  if (filteredAudit.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" class="p-5 text-center text-slate-500 font-bold">
          لا توجد حركات مسجلة في سجل الرقابة حتى الآن — عند إضافة أو تعديل أي وزنة أو مصروف سيظهر هنا اسم المندوب ووقت الحركة وتفاصيل التعديل (قبل ⬅️ بعد) تلقائياً.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = filteredAudit.map((item, idx) => {
    const timeCellHtml = item.isEdited
      ? `<span class="text-slate-600">إنشاء: ${escXmlStr(item.createdTimeTxt)}</span> <span class="text-blue-900 font-extrabold">| آخر تعديل: ${escXmlStr(item.updatedTimeTxt)}</span>`
      : `<span class="text-emerald-900 font-extrabold">🕒 ${escXmlStr(item.createdTimeTxt)}</span>`;

    let diffBlockHtml = '';
    if (item.lastEditDiffText) {
      const prevHistCount = (item.editHistory || []).length;
      const fullHistTooltip = prevHistCount > 1
        ? item.editHistory.map((h, i) => `(${i + 1}) [${h.by || '-'} - ${h.timeTxt || ''}]: ${h.diffText || ''}`).join(' | ')
        : item.lastEditDiffText;
      diffBlockHtml = `<div class="mt-1 px-2 py-1 rounded-lg bg-rose-50 border border-rose-300 text-rose-950 text-[10px] font-bold text-right leading-relaxed" title="${escXmlStr(fullHistTooltip)}">🔍 <strong>قبل ⬅️ بعد:</strong> ${escXmlStr(item.lastEditDiffText)}${prevHistCount > 1 ? ` <span class="text-blue-900">(${prevHistCount} تعديلات)</span>` : ''}</div>`;
    }

    return `
      <tr class="hover:bg-slate-50">
        <td class="p-2 border text-center font-bold">${idx + 1}</td>
        <td class="p-2 border text-center">
          <span class="px-2 py-0.5 rounded-lg border text-[11px] font-extrabold ${item.typeBadgeCls}">${item.typeLabel}</span>
        </td>
        <td class="p-2 border text-center font-extrabold text-blue-950">يوم ${item.dayNum} <span class="text-[10px] text-slate-500">(${escXmlStr(item.dateLabel)})</span></td>
        <td class="p-2 border font-extrabold text-slate-900">${escXmlStr(item.title)}</td>
        <td class="p-2 border text-center font-extrabold text-blue-900">${escXmlStr(item.detail)}</td>
        <td class="p-2 border text-center font-extrabold bg-emerald-50/50 text-emerald-950">👤 ${escXmlStr(item.createdBy)}</td>
        <td class="p-2 border text-center font-extrabold ${item.isEdited ? 'bg-amber-50 text-amber-950' : 'text-slate-600'}">
          <div>${item.isEdited ? `✏️ ${escXmlStr(item.updatedBy)}` : `✓ نفس المسجل (${escXmlStr(item.updatedBy)})`}</div>
          ${diffBlockHtml}
        </td>
        <td class="p-2 border text-center text-[11px] font-bold">${timeCellHtml}</td>
      </tr>
    `;
  }).join('');
}

function exportFullJsonBackup() {
  try {
    syncActiveFarmIntoArchive();
    unifyGlobalMerchantsRegistry();
    const now = new Date();
    const dateSlug = now.toISOString().slice(0, 10);
    const timeStr = now.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
    const actor = getActiveUserShortLabel();
    const fName = (appState.farmName || 'أبوذكري').trim();
    const fSlug = fName.replace(/\s+/g, '_');

    appState.lastJsonBackup = `آخر نسخة (.json): ${timeStr} بواسطة (${actor}) ✓`;
    const backupPayload = {
      backupFormat: 'ABOUZEKRY_FULL_JSON_BACKUP_V51',
      version: 38,
      exportedAtIso: now.toISOString(),
      exportedAtArabic: `${now.toLocaleDateString('ar-EG')} — ${timeStr}`,
      exportedBy: actor,
      activeFarmName: fName,
      summary: {
        farmsCount: Object.keys(appState.farmsArchive || {}).length,
        merchantsCount: (appState.merchants || []).length,
        usersCount: (appState.users || []).length
      },
      state: JSON.parse(JSON.stringify(appState))
    };

    const jsonStr = JSON.stringify(backupPayload, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const fileName = `نسخة_احتياطية_شاملة_مبيعات_المزارع_${fSlug}_${dateSlug}.json`;
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);

    saveState(false);
    renderBackupAndAuditCenterUI();
    const farmsCnt = Object.keys(appState.farmsArchive || {}).length;
    showToast(
      `📦 تم تحميل النسخة الاحتياطية الشاملة (${fileName}) شاملة (${farmsCnt} مزرعة، ${(appState.merchants || []).length} تاجر، وجميع المستخدمين والحركات)!`,
      '📦'
    );
  } catch (err) {
    showToast('حدث خطأ أثناء تجهيز ملف النسخة الاحتياطية (.json)', '⚠️');
  }
}

function restoreFullJsonBackupFromText(rawText, sourceFileName = '') {
  try {
    const parsed = JSON.parse(rawText);
    const targetState = (parsed && parsed.state && parsed.state.days && parsed.state.merchants)
      ? parsed.state
      : ((parsed && parsed.days && parsed.merchants) ? parsed : null);

    if (!targetState) {
      showToast('⚠️ ملف (.json) غير صالح أو لا يحتوي على هيكل بيانات المزارع والتجار!', '⚠️');
      return false;
    }

    const wasLoggedIn = Boolean(appState.isLoggedIn);
    const prevActiveUserId = appState.activeUserId || 'admin';
    const currentWebhook = (appState.webhookUrl || getEmbeddedWebhookUrl() || '').trim();

    if (!applyParsedStateObject(targetState)) {
      showToast('⚠️ تعذر استرجاع البيانات من الملف المختار!', '⚠️');
      return false;
    }

    if (currentWebhook && !appState.webhookUrl) {
      appState.webhookUrl = currentWebhook;
    }
    if (wasLoggedIn) {
      appState.isLoggedIn = true;
      const userStillExists = (appState.users || []).some(u => u && u.id === prevActiveUserId);
      appState.activeUserId = userStillExists ? prevActiveUserId : 'admin';
      appState.lastActivityAt = Date.now();
    }

    const restoreTs = getSyncedNow();
    const nowTime = new Date(restoreTs).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
    appState.lastBulkImportAt = restoreTs;
    appState.farmResetAt = 0;
    appState.lastJsonBackup = `تم الاسترجاع من (${sourceFileName || 'ملف .json'}) الساعة ${nowTime} ✓`;
    appState.lastExcelSync = `استرجاع نسخة شاملة (.json) الساعة ${nowTime}`;
    appState.hasLocalEdits = true;
    syncActiveFarmIntoArchive();
    saveState(true, true);
    renderAll();

    const farmsCnt = Object.keys(appState.farmsArchive || {}).length;
    const merchCnt = (appState.merchants || []).length;
    const usersCnt = (appState.users || []).length;
    showToast(
      `✅ تم استرجاع النسخة الاحتياطية الشاملة بنجاح: (${farmsCnt} مزرعة | ${merchCnt} تاجر | ${usersCnt} مستخدم) بجميع الحركات وسجل الرقابة!`,
      '📂'
    );
    return true;
  } catch (err) {
    showToast('⚠️ تعذر قراءة ملف النسخة الاحتياطية (.json)، تأكد من صحة الملف!', '⚠️');
    return false;
  }
}

// =========================================================================
// SMART ACTIVE-TAB RENDERING ENGINE (قصر إعادة الرسم على التبويب النشط لتسريع الاستجابة > 70%)
// =========================================================================
function renderAll(forceAllTabs = false, preserveInputs = false) {
  updateConnectionAndSyncUI();
  updateTopCloudFarmDropdownUI();
  const activeTab = appState.activeTab || 'daily';
  const isSyncTab = (activeTab === 'sync');
  renderUsersAndPermissionsUI(Boolean(forceAllTabs || isSyncTab));
  updateFloatingActionBarVisibilityUI();
  updateStickyTablesOptionsUI();
  updateAuditMetadataVisibilityUI();
  updateLiteFieldModeUI();

  if (forceAllTabs) {
    renderDaySelector();
    renderDailyView();
    renderDashboardView();
    renderMerchantsAndStatements('all');
    renderExpensesStatementView();
    renderCloudDatabaseHub();
    renderBackupAndAuditCenterUI();
    if (!preserveInputs) applyStickySaleDefaults();
    updateLiveFormCalculation();
    return;
  }

  // قصر إعادة بناء جداول الـ DOM والرسوم البيانية على التبويب النشط فقط
  switch (activeTab) {
    case 'daily':
      renderDaySelector();
      renderDailyView();
      if (!preserveInputs) applyStickySaleDefaults();
      updateLiveFormCalculation();
      break;
    case 'dashboard':
      renderDashboardView();
      break;
    case 'merchants':
      renderMerchantsAndStatements('merchants');
      break;
    case 'transfers':
      renderMerchantsAndStatements('transfers');
      break;
    case 'expenses':
      renderExpensesStatementView();
      break;
    case 'sync':
      if (typeof window.refreshDayManagementBoxesUI === 'function') {
        window.refreshDayManagementBoxesUI();
      }
      renderCloudDatabaseHub();
      renderBackupAndAuditCenterUI();
      break;
    default:
      renderDaySelector();
      renderDailyView();
      if (!preserveInputs) applyStickySaleDefaults();
      updateLiveFormCalculation();
      break;
  }

  // إذا كانت نافذة كشف حساب التاجر التفصيلي مفتوحة حالياً، يتم تحديثها لحظياً
  if (activeDrillDownMerchantCode > 0) {
    const mdl = document.getElementById('merchantDrillDownModal');
    if (mdl && !mdl.classList.contains('hidden')) {
      renderMerchantDrillDownModal();
    }
  }
}

// =========================================================================
// 5. TWO-WAY EXCEL (.XLSX) ENGINE: FULL STYLED 15-SHEET EXPORT & IMPORT
// =========================================================================
// تم فصل STYLED_XLSX_TEMPLATE_B64 ودالة tinyInflateRaw في ملف مستقل (excel-template.js) لتخفيف حجم app.js وتسريع الأداء (v45)
var _cachedStyledXlsxTemplate = window._cachedStyledXlsxTemplate || null;

const _CRC32_TABLE = (() => {
  const tbl = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    tbl[i] = c >>> 0;
  }
  return tbl;
})();

function computeCrc32(bytes) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) {
    crc = _CRC32_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

async function deflateRawBytesBrowser(rawBytes) {
  if (typeof CompressionStream === 'undefined' || typeof Response === 'undefined' || typeof Blob === 'undefined') return null;
  try {
    const stream = new Blob([rawBytes]).stream().pipeThrough(new CompressionStream('deflate'));
    const ab = await new Response(stream).arrayBuffer();
    if (ab.byteLength > 6) {
      return new Uint8Array(ab, 2, ab.byteLength - 6);
    }
    return null;
  } catch (e) {
    return null;
  }
}

function buildZipBytesFromEntries(entries) {
  let totalLen = 22;
  for (const e of entries) {
    totalLen += 30 + e.nameBytes.length + e.compBytes.length + 46 + e.nameBytes.length;
  }
  const out = new Uint8Array(totalLen);
  const dv = new DataView(out.buffer);
  let offset = 0;
  const localOffsets = [];

  for (const e of entries) {
    localOffsets.push(offset);
    dv.setUint32(offset, 0x04034b50, true);
    dv.setUint16(offset + 4, 20, true);
    dv.setUint16(offset + 6, 0x0800, true);
    dv.setUint16(offset + 8, e.method, true);
    dv.setUint16(offset + 10, 0, true);
    dv.setUint16(offset + 12, 0x5541, true);
    dv.setUint32(offset + 14, e.crc, true);
    dv.setUint32(offset + 18, e.compBytes.length, true);
    dv.setUint32(offset + 22, e.rawBytes.length, true);
    dv.setUint16(offset + 26, e.nameBytes.length, true);
    dv.setUint16(offset + 28, 0, true);
    out.set(e.nameBytes, offset + 30);
    offset += 30 + e.nameBytes.length;
    out.set(e.compBytes, offset);
    offset += e.compBytes.length;
  }

  const cdStart = offset;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    dv.setUint32(offset, 0x02014b50, true);
    dv.setUint16(offset + 4, 20, true);
    dv.setUint16(offset + 6, 20, true);
    dv.setUint16(offset + 8, 0x0800, true);
    dv.setUint16(offset + 10, e.method, true);
    dv.setUint16(offset + 12, 0, true);
    dv.setUint16(offset + 14, 0x5541, true);
    dv.setUint32(offset + 16, e.crc, true);
    dv.setUint32(offset + 20, e.compBytes.length, true);
    dv.setUint32(offset + 24, e.rawBytes.length, true);
    dv.setUint16(offset + 28, e.nameBytes.length, true);
    dv.setUint16(offset + 30, 0, true);
    dv.setUint16(offset + 32, 0, true);
    dv.setUint16(offset + 34, 0, true);
    dv.setUint16(offset + 36, 0, true);
    dv.setUint32(offset + 38, 0, true);
    dv.setUint32(offset + 42, localOffsets[i], true);
    out.set(e.nameBytes, offset + 46);
    offset += 46 + e.nameBytes.length;
  }

  const cdSize = offset - cdStart;
  dv.setUint32(offset, 0x06054b50, true);
  dv.setUint16(offset + 4, 0, true);
  dv.setUint16(offset + 6, 0, true);
  dv.setUint16(offset + 8, entries.length, true);
  dv.setUint16(offset + 10, entries.length, true);
  dv.setUint32(offset + 12, cdSize, true);
  dv.setUint32(offset + 16, cdStart, true);
  dv.setUint16(offset + 20, 0, true);
  return out;
}

function getStyledXlsxTemplateObj() {
  if (_cachedStyledXlsxTemplate) return _cachedStyledXlsxTemplate;
  const binStr = atob(STYLED_XLSX_TEMPLATE_B64);
  const bytes = new Uint8Array(binStr.length);
  for (let i = 0; i < binStr.length; i++) bytes[i] = binStr.charCodeAt(i);
  const inflated = tinyInflateRaw(bytes);
  const jsonStr = new TextDecoder('utf-8').decode(inflated);
  _cachedStyledXlsxTemplate = JSON.parse(jsonStr);
  return _cachedStyledXlsxTemplate;
}

function escXmlStr(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function setXmlCellVal(xml, ref, val, isNum = false, keepZero = false) {
  const re = new RegExp(`<c r="${ref}" s="(\\d+)"(?:[^/>]*\\/>|[^>]*>(?:<is><t>[^<]*<\\/t><\\/is>|<v>[^<]*<\\/v>)?<\\/c>)`);
  if (val === null || val === undefined || val === '' || (isNum && !keepZero && Number(val) === 0)) {
    return xml.replace(re, `<c r="${ref}" s="$1"/>`);
  }
  if (isNum) {
    const n = Number(val) || 0;
    return xml.replace(re, `<c r="${ref}" s="$1" t="n"><v>${n}</v></c>`);
  }
  return xml.replace(re, `<c r="${ref}" s="$1" t="inlineStr"><is><t>${escXmlStr(val)}</t></is></c>`);
}

function setXmlFormulaVal(xml, ref, cachedVal, newFormulaXml = null) {
  const escV = escXmlStr(String(cachedVal ?? 0));
  const re = new RegExp(`(<c r="${ref}"[^>]*><f[^>]*>)([^<]*)(<\\/f>)(?:<v>[^<]*<\\/v>)?(<\\/c>)`);
  return xml.replace(re, (_, p1, oldF, p3, p4) => {
    const fContent = newFormulaXml !== null ? newFormulaXml : oldF;
    return `${p1}${fContent}${p3}<v>${escV}</v>${p4}`;
  });
}

function cloneXmlTemplateRow(baseRowXml, baseR, targetR, seqVal) {
  let out = baseRowXml
    .replace(new RegExp(`([A-Z])${baseR}(?!\\d)`, 'g'), `$1${targetR}`)
    .replace(`<row r="${baseR}"`, `<row r="${targetR}"`);
  if (seqVal !== undefined && seqVal !== null) {
    out = out.replace(new RegExp(`(<c r="A${targetR}"[^>]*><v>)\\d+(<\\/v><\\/c>)`), `$1${seqVal}$2`);
  }
  return out;
}

async function buildStyled15SheetExcelBytes() {
  const tpl = getStyledXlsxTemplateObj();
  const outFiles = {};
  for (const k of Object.keys(tpl)) {
    if (!k.startsWith('__')) outFiles[k] = tpl[k];
  }

  const fName = appState.farmName || 'أبوذكري';
  const summaries = {};
  for (let d = 1; d <= 10; d++) {
    summaries[d] = computeDaySummary(d);
  }
  const mList = computeMerchantAggregates();

  // 1. Sheet 1: لوحة التحكم والملخص
  {
    let s1 = outFiles['xl/worksheets/sheet1.xml'];
    s1 = setXmlCellVal(s1, 'C3', fName, false);
    s1 = setXmlFormulaVal(s1, 'A1', `لوحة التحكم والملخص التنفيذي - نظام محاضر بيع مزرعة ${fName} (يمكنك تغيير اسم المزرعة من الخلية C3 بالأسفل)`);

    let totCars = 0, totNetW = 0, totBase = 0, totTip = 0, totSales = 0;
    let totCashS = 0, totCredS = 0, totDebtC = 0, totCurrTr = 0, totPrevC = 0, totPrevTr = 0;
    let totCashBef = 0, totExp = 0, totNetCash = 0, totDeliv = 0, totCashDiff = 0, totInvDiff = 0;

    for (let d = 1; d <= 10; d++) {
      const s = summaries[d];
      const r = 7 + d;
      totCars += s.countCars;
      totNetW += s.sumNetW;
      totBase += s.sumBase;
      totTip += s.sumTip;
      totSales += s.sumTotalWithTip;
      totCashS += s.sumCashSales;
      totCredS += s.sumCreditSales;
      totDebtC += s.sumDebtCash;
      totCurrTr += s.currentFarmTransfers;
      totPrevC += s.sumPrevCash;
      totPrevTr += s.sumPrevTransfer;
      totCashBef += s.totalCashBeforeExpenses;
      totExp += s.sumExpenses;
      totNetCash += s.netCashInBox;
      totDeliv += s.deliveredCash;
      totCashDiff += s.cashBoxDiff;
      totInvDiff += s.sumInvoiceDiff;

      s1 = setXmlFormulaVal(s1, `C${r}`, s.dateLabel);
      s1 = setXmlFormulaVal(s1, `D${r}`, s.countCars);
      s1 = setXmlFormulaVal(s1, `E${r}`, s.sumNetW);
      s1 = setXmlFormulaVal(s1, `F${r}`, Number(s.avgPrice.toFixed(2)));
      s1 = setXmlFormulaVal(s1, `G${r}`, Number(s.sumBase.toFixed(2)));
      s1 = setXmlFormulaVal(s1, `H${r}`, s.sumTip);
      s1 = setXmlFormulaVal(s1, `I${r}`, Number(s.sumTotalWithTip.toFixed(2)));
      s1 = setXmlFormulaVal(s1, `J${r}`, s.sumCashSales);
      s1 = setXmlFormulaVal(s1, `K${r}`, s.sumCreditSales);
      s1 = setXmlFormulaVal(s1, `L${r}`, s.sumDebtCash);
      s1 = setXmlFormulaVal(s1, `M${r}`, s.currentFarmTransfers);
      s1 = setXmlFormulaVal(s1, `N${r}`, s.sumPrevCash);
      s1 = setXmlFormulaVal(s1, `O${r}`, s.sumPrevTransfer);
      s1 = setXmlFormulaVal(s1, `P${r}`, s.totalCashBeforeExpenses);
      s1 = setXmlFormulaVal(s1, `Q${r}`, s.sumExpenses);
      s1 = setXmlFormulaVal(s1, `R${r}`, s.netCashInBox);
      s1 = setXmlFormulaVal(s1, `S${r}`, s.deliveredCash);
      s1 = setXmlFormulaVal(s1, `T${r}`, s.cashBoxDiff);
      s1 = setXmlFormulaVal(s1, `U${r}`, Number(s.sumInvoiceDiff.toFixed(2)));
      const stTxt = s.countCars === 0
        ? 'لم يبدأ بعد (اضغط للميزان)'
        : (s.weightAuditDiff === 0 && s.invoiceAuditDiff === 0 ? 'مطابق ومتزن ✓ (الميزان)' : 'يوجد فرق بالميزان !');
      s1 = setXmlFormulaVal(s1, `V${r}`, stTxt);
    }

    const totAvgPrice = totNetW > 0 ? Number((totBase / totNetW).toFixed(2)) : 0;
    const totNetDebtCurrent = mList.reduce((acc, m) => acc + m.netDebtCurrent, 0);
    const totAllTransfers = totCurrTr + totPrevTr;

    const activeDaysForAvg = Math.max(1, [1,2,3,4,5,6,7,8,9,10].filter(d => summaries[d].sumNetW > 0 || summaries[d].countCars > 0).length);
    s1 = setXmlFormulaVal(s1, 'D18', Number((totCars / activeDaysForAvg).toFixed(1)));
    s1 = setXmlFormulaVal(s1, 'E18', Number((totNetW / activeDaysForAvg).toFixed(1)));
    s1 = setXmlFormulaVal(s1, 'F18', totAvgPrice);
    s1 = setXmlFormulaVal(s1, 'G18', Number((totBase / activeDaysForAvg).toFixed(2)));
    s1 = setXmlFormulaVal(s1, 'H18', Number((totTip / activeDaysForAvg).toFixed(1)));
    s1 = setXmlFormulaVal(s1, 'I18', Number((totSales / activeDaysForAvg).toFixed(2)));
    s1 = setXmlFormulaVal(s1, 'J18', Number((totCashS / activeDaysForAvg).toFixed(2)));
    s1 = setXmlFormulaVal(s1, 'K18', Number((totCredS / activeDaysForAvg).toFixed(2)));
    s1 = setXmlFormulaVal(s1, 'L18', Number((totDebtC / activeDaysForAvg).toFixed(2)));
    s1 = setXmlFormulaVal(s1, 'M18', Number((totCurrTr / activeDaysForAvg).toFixed(2)));
    s1 = setXmlFormulaVal(s1, 'N18', Number((totPrevC / activeDaysForAvg).toFixed(2)));
    s1 = setXmlFormulaVal(s1, 'O18', Number((totPrevTr / activeDaysForAvg).toFixed(2)));
    s1 = setXmlFormulaVal(s1, 'P18', Number((totCashBef / activeDaysForAvg).toFixed(2)));
    s1 = setXmlFormulaVal(s1, 'Q18', Number((totExp / activeDaysForAvg).toFixed(2)));
    s1 = setXmlFormulaVal(s1, 'R18', Number((totNetCash / activeDaysForAvg).toFixed(2)));
    s1 = setXmlFormulaVal(s1, 'S18', Number((totDeliv / activeDaysForAvg).toFixed(2)));
    s1 = setXmlFormulaVal(s1, 'T18', Number((totCashDiff / activeDaysForAvg).toFixed(2)));
    s1 = setXmlFormulaVal(s1, 'U18', Number((totInvDiff / activeDaysForAvg).toFixed(2)));

    s1 = setXmlFormulaVal(s1, 'D19', totCars);
    s1 = setXmlFormulaVal(s1, 'E19', totNetW);
    s1 = setXmlFormulaVal(s1, 'F19', totAvgPrice);
    s1 = setXmlFormulaVal(s1, 'G19', Number(totBase.toFixed(2)));
    s1 = setXmlFormulaVal(s1, 'H19', totTip);
    s1 = setXmlFormulaVal(s1, 'I19', Number(totSales.toFixed(2)));
    s1 = setXmlFormulaVal(s1, 'J19', totCashS);
    s1 = setXmlFormulaVal(s1, 'K19', totCredS);
    s1 = setXmlFormulaVal(s1, 'L19', totDebtC);
    s1 = setXmlFormulaVal(s1, 'M19', totCurrTr);
    s1 = setXmlFormulaVal(s1, 'N19', totPrevC);
    s1 = setXmlFormulaVal(s1, 'O19', totPrevTr);
    s1 = setXmlFormulaVal(s1, 'P19', totCashBef);
    s1 = setXmlFormulaVal(s1, 'Q19', totExp);
    s1 = setXmlFormulaVal(s1, 'R19', totNetCash);
    s1 = setXmlFormulaVal(s1, 'S19', totDeliv);
    s1 = setXmlFormulaVal(s1, 'T19', totCashDiff);
    s1 = setXmlFormulaVal(s1, 'U19', Number(totInvDiff.toFixed(2)));

    s1 = setXmlFormulaVal(s1, 'A5', totNetW);
    s1 = setXmlFormulaVal(s1, 'D5', Number(totSales.toFixed(2)));
    s1 = setXmlFormulaVal(s1, 'G5', totCashBef);
    s1 = setXmlFormulaVal(s1, 'J5', totExp);
    s1 = setXmlFormulaVal(s1, 'M5', totNetCash);
    s1 = setXmlFormulaVal(s1, 'P5', totNetDebtCurrent);
    s1 = setXmlFormulaVal(s1, 'S5', totAllTransfers);

    outFiles['xl/worksheets/sheet1.xml'] = s1;
  }

  // Precompute daily per-merchant transfers & previous farm collections for sheets 3 and 4
  const dailyMerchTransfers = {};
  const dailyMerchPrev = {};
  mList.forEach(m => {
    dailyMerchTransfers[m.code] = Array(11).fill(0);
    dailyMerchPrev[m.code] = Array(11).fill(0);
  });
  for (let d = 1; d <= 10; d++) {
    summaries[d].rows.forEach(r => {
      if (r.code && dailyMerchTransfers[r.code]) {
        dailyMerchTransfers[r.code][d] += (r.transferSales + r.debtTransfer + r.prevTransfer);
        dailyMerchPrev[r.code][d] += (r.prevCash + r.prevTransfer);
      }
    });
  }

  // 2. Sheet 2: تكويد التجار وكشف الحساب
  {
    let s2 = outFiles['xl/worksheets/sheet2.xml'];
    s2 = setXmlFormulaVal(s2, 'A1', `شاشة تكويد التجار الموحد وكشف حساب مديونيات المزرعة الحالية (10 أيام) - مزرعة ${fName}`);
    const rows = [];
    let sumD = 0, sumE = 0, sumF = 0, sumG = 0, sumH = 0, sumI = 0, sumJ = 0, sumK = 0, sumL = 0, sumM = 0, sumN = 0, sumO = 0, sumP = 0;

    for (let i = 0; i < 50; i++) {
      const r = 6 + i;
      const baseR = (r % 2 === 0) ? 6 : 7;
      const baseXml = (r % 2 === 0) ? tpl.__S2_R6__ : tpl.__S2_R7__;
      let rXml = cloneXmlTemplateRow(baseXml, baseR, r, i + 1);
      const m = mList[i];
      if (m) {
        rXml = setXmlFormulaVal(rXml, `B${r}`, m.code, `IF(C${r}=&quot;&quot;,0,${m.code})`);
        rXml = setXmlCellVal(rXml, `C${r}`, m.name, false);
        rXml = setXmlFormulaVal(rXml, `D${r}`, m.cars);
        rXml = setXmlFormulaVal(rXml, `E${r}`, m.netW);
        rXml = setXmlFormulaVal(rXml, `F${r}`, Number(m.totalSales.toFixed(2)));
        rXml = setXmlFormulaVal(rXml, `G${r}`, m.cashSales);
        rXml = setXmlFormulaVal(rXml, `H${r}`, m.nonCashDayOfSale);
        rXml = setXmlFormulaVal(rXml, `I${r}`, m.creditSales);
        rXml = setXmlFormulaVal(rXml, `J${r}`, m.transferSales);
        rXml = setXmlFormulaVal(rXml, `K${r}`, m.debtCash);
        rXml = setXmlFormulaVal(rXml, `L${r}`, m.debtTransfer);
        rXml = setXmlFormulaVal(rXml, `M${r}`, m.totalSettledCurrent);
        rXml = setXmlFormulaVal(rXml, `N${r}`, m.netDebtCurrent);
        rXml = setXmlFormulaVal(rXml, `O${r}`, m.prevCash);
        rXml = setXmlFormulaVal(rXml, `P${r}`, m.prevTransfer);

        sumD += m.cars; sumE += m.netW; sumF += m.totalSales; sumG += m.cashSales;
        sumH += m.nonCashDayOfSale; sumI += m.creditSales; sumJ += m.transferSales;
        sumK += m.debtCash; sumL += m.debtTransfer; sumM += m.totalSettledCurrent;
        sumN += m.netDebtCurrent; sumO += m.prevCash; sumP += m.prevTransfer;
      }
      rows.push(rXml);
    }
    s2 = s2.replace('__MERCH_ROWS_6_55__', rows.join(''));
    s2 = setXmlFormulaVal(s2, 'D56', sumD);
    s2 = setXmlFormulaVal(s2, 'E56', sumE);
    s2 = setXmlFormulaVal(s2, 'F56', Number(sumF.toFixed(2)));
    s2 = setXmlFormulaVal(s2, 'G56', sumG);
    s2 = setXmlFormulaVal(s2, 'H56', sumH);
    s2 = setXmlFormulaVal(s2, 'I56', sumI);
    s2 = setXmlFormulaVal(s2, 'J56', sumJ);
    s2 = setXmlFormulaVal(s2, 'K56', sumK);
    s2 = setXmlFormulaVal(s2, 'L56', sumL);
    s2 = setXmlFormulaVal(s2, 'M56', sumM);
    s2 = setXmlFormulaVal(s2, 'N56', sumN);
    s2 = setXmlFormulaVal(s2, 'O56', sumO);
    s2 = setXmlFormulaVal(s2, 'P56', sumP);
    outFiles['xl/worksheets/sheet2.xml'] = s2;
  }

  // 3. Sheet 3: بيان التحويلات والشيكات
  {
    let s3 = outFiles['xl/worksheets/sheet3.xml'];
    s3 = setXmlFormulaVal(s3, 'A1', `بيان التحويلات والشيكات الشامل (10 أيام) - مزرعة ${fName}`);
    const rows = [];
    let sumD = 0, sumE = 0, sumF = 0, sumG = 0, sumH = 0, sumI = 0, sumJ = 0, sumK = 0, sumL = 0;
    const dayColLetters = ['', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V'];

    for (let i = 0; i < 50; i++) {
      const r = 6 + i;
      const baseR = (r % 2 === 0) ? 6 : 7;
      const baseXml = (r % 2 === 0) ? tpl.__S3_R6__ : tpl.__S3_R7__;
      let rXml = cloneXmlTemplateRow(baseXml, baseR, r, i + 1);
      const m = mList[i];
      if (m) {
        const currTr = m.transferSales + m.debtTransfer;
        const allTr = currTr + m.prevTransfer;
        rXml = setXmlFormulaVal(rXml, `B${r}`, m.code);
        rXml = setXmlFormulaVal(rXml, `C${r}`, m.name);
        rXml = setXmlFormulaVal(rXml, `D${r}`, m.transferSales);
        rXml = setXmlFormulaVal(rXml, `E${r}`, m.debtTransfer);
        rXml = setXmlFormulaVal(rXml, `F${r}`, currTr);
        rXml = setXmlFormulaVal(rXml, `G${r}`, m.prevTransfer);
        rXml = setXmlFormulaVal(rXml, `H${r}`, m.byType['تحويل كاش']);
        rXml = setXmlFormulaVal(rXml, `I${r}`, m.byType['تحويل بنكي']);
        rXml = setXmlFormulaVal(rXml, `J${r}`, m.byType['إنستا باي']);
        rXml = setXmlFormulaVal(rXml, `K${r}`, m.byType['شيكات']);
        rXml = setXmlFormulaVal(rXml, `L${r}`, allTr);
        for (let d = 1; d <= 10; d++) {
          const dVal = (dailyMerchTransfers[m.code] && dailyMerchTransfers[m.code][d]) || 0;
          rXml = setXmlFormulaVal(rXml, `${dayColLetters[d]}${r}`, dVal);
        }
        sumD += m.transferSales; sumE += m.debtTransfer; sumF += currTr; sumG += m.prevTransfer;
        sumH += m.byType['تحويل كاش']; sumI += m.byType['تحويل بنكي'];
        sumJ += m.byType['إنستا باي']; sumK += m.byType['شيكات']; sumL += allTr;
      }
      rows.push(rXml);
    }
    s3 = s3.replace('__MERCH_ROWS_6_55__', rows.join(''));
    s3 = setXmlFormulaVal(s3, 'D56', sumD);
    s3 = setXmlFormulaVal(s3, 'E56', sumE);
    s3 = setXmlFormulaVal(s3, 'F56', sumF);
    s3 = setXmlFormulaVal(s3, 'G56', sumG);
    s3 = setXmlFormulaVal(s3, 'H56', sumH);
    s3 = setXmlFormulaVal(s3, 'I56', sumI);
    s3 = setXmlFormulaVal(s3, 'J56', sumJ);
    s3 = setXmlFormulaVal(s3, 'K56', sumK);
    s3 = setXmlFormulaVal(s3, 'L56', sumL);
    for (let d = 1; d <= 10; d++) {
      s3 = setXmlFormulaVal(s3, `${dayColLetters[d]}56`, summaries[d].totalAllTransfers);
    }
    outFiles['xl/worksheets/sheet3.xml'] = s3;
  }

  // 4. Sheet 4: بيان تحصيلات مزارع سابقة
  {
    let s4 = outFiles['xl/worksheets/sheet4.xml'];
    s4 = setXmlFormulaVal(s4, 'A1', `بيان تحصيلات مديونيات المواقع والمزارع السابقة - مزرعة ${fName}`);
    const rows = [];
    let sumD = 0, sumE = 0, sumF = 0;
    const dayColLetters = ['', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P'];

    for (let i = 0; i < 50; i++) {
      const r = 6 + i;
      const baseR = (r % 2 === 0) ? 6 : 7;
      const baseXml = (r % 2 === 0) ? tpl.__S4_R6__ : tpl.__S4_R7__;
      let rXml = cloneXmlTemplateRow(baseXml, baseR, r, i + 1);
      const m = mList[i];
      if (m) {
        const totPf = m.prevCash + m.prevTransfer;
        rXml = setXmlFormulaVal(rXml, `B${r}`, m.code);
        rXml = setXmlFormulaVal(rXml, `C${r}`, m.name);
        rXml = setXmlFormulaVal(rXml, `D${r}`, m.prevCash);
        rXml = setXmlFormulaVal(rXml, `E${r}`, m.prevTransfer);
        rXml = setXmlFormulaVal(rXml, `F${r}`, totPf);
        for (let d = 1; d <= 10; d++) {
          const dVal = (dailyMerchPrev[m.code] && dailyMerchPrev[m.code][d]) || 0;
          rXml = setXmlFormulaVal(rXml, `${dayColLetters[d]}${r}`, dVal);
        }
        rXml = setXmlFormulaVal(rXml, `Q${r}`, m.prevNotes.join(' | ') || (totPf > 0 ? 'مديونية موقع سابق' : ''));
        sumD += m.prevCash; sumE += m.prevTransfer; sumF += totPf;
      }
      rows.push(rXml);
    }
    s4 = s4.replace('__MERCH_ROWS_6_55__', rows.join(''));
    s4 = setXmlFormulaVal(s4, 'D56', sumD);
    s4 = setXmlFormulaVal(s4, 'E56', sumE);
    s4 = setXmlFormulaVal(s4, 'F56', sumF);
    for (let d = 1; d <= 10; d++) {
      s4 = setXmlFormulaVal(s4, `${dayColLetters[d]}56`, summaries[d].sumPrevCash + summaries[d].sumPrevTransfer);
    }
    outFiles['xl/worksheets/sheet4.xml'] = s4;
  }

  // 5. Sheet 5: بيان المصروفات والمكافآت
  {
    let s5 = outFiles['xl/worksheets/sheet5.xml'];
    s5 = setXmlFormulaVal(s5, 'A1', `بيان المصروفات والمكافآت والمنصرف من النقدية (10 أيام) - مزرعة ${fName}`);

    const catMatrix = {};
    EXPENSE_CATEGORIES.forEach(c => { catMatrix[c] = Array(11).fill(0); });
    let grandTotalExp = 0;
    const dayExpTotals = Array(11).fill(0);

    for (let d = 1; d <= 10; d++) {
      (summaries[d].expenses || []).forEach(e => {
        const amt = Number(e.amount) || 0;
        const cat = catMatrix[e.category] ? e.category : 'مصاريف نثرية أخرى';
        catMatrix[cat][d] += amt;
        dayExpTotals[d] += amt;
        grandTotalExp += amt;
      });
    }

    const dayColLetters = ['', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N'];
    EXPENSE_CATEGORIES.forEach((cat, idx) => {
      const r = 6 + idx;
      const rowArr = catMatrix[cat];
      const rowSum = rowArr.slice(1).reduce((a, b) => a + b, 0);
      const pct = grandTotalExp > 0 ? Number((rowSum / grandTotalExp).toFixed(4)) : 0;
      s5 = setXmlFormulaVal(s5, `C${r}`, rowSum);
      s5 = setXmlFormulaVal(s5, `D${r}`, pct);
      for (let d = 1; d <= 10; d++) {
        s5 = setXmlFormulaVal(s5, `${dayColLetters[d]}${r}`, rowArr[d]);
      }
    });

    s5 = setXmlFormulaVal(s5, 'C15', grandTotalExp);
    s5 = setXmlFormulaVal(s5, 'D15', grandTotalExp > 0 ? 1 : 0);
    let totCashBefAll = 0;
    for (let d = 1; d <= 10; d++) {
      const cb = summaries[d].totalCashBeforeExpenses;
      const ex = dayExpTotals[d];
      totCashBefAll += cb;
      s5 = setXmlFormulaVal(s5, `${dayColLetters[d]}15`, ex);
      s5 = setXmlFormulaVal(s5, `${dayColLetters[d]}16`, cb);
      s5 = setXmlFormulaVal(s5, `${dayColLetters[d]}17`, ex);
      s5 = setXmlFormulaVal(s5, `${dayColLetters[d]}18`, cb - ex);
    }
    s5 = setXmlFormulaVal(s5, 'C16', totCashBefAll);
    s5 = setXmlFormulaVal(s5, 'C17', grandTotalExp);
    s5 = setXmlFormulaVal(s5, 'C18', totCashBefAll - grandTotalExp);

    const logRows = [];
    for (let d = 1; d <= 10; d++) {
      const dayExps = summaries[d].expenses || [];
      for (let eIdx = 0; eIdx < 10; eIdx++) {
        const seq = (d - 1) * 10 + eIdx + 1;
        const r = 21 + seq;
        const srcR = 116 + eIdx;
        const baseR = (r % 2 === 0) ? 22 : 23;
        const baseSrcR = (r % 2 === 0) ? 116 : 117;
        const baseXml = (r % 2 === 0) ? tpl.__S5_R22__ : tpl.__S5_R23__;
        let rXml = cloneXmlTemplateRow(baseXml, baseR, r, seq)
          .replace(/يوم 1/g, `يوم ${d}`)
          .replace(new RegExp(`\\(بند ${baseR - 21}\\)`, 'g'), `(بند ${eIdx + 1})`)
          .replace(new RegExp(`([A-Z])${baseSrcR}`, 'g'), `$1${srcR}`);
        const exObj = dayExps[eIdx];
        if (exObj && Number(exObj.amount) > 0) {
          rXml = setXmlFormulaVal(rXml, `C${r}`, summaries[d].dateLabel);
          rXml = setXmlFormulaVal(rXml, `D${r}`, exObj.category || '');
          rXml = setXmlFormulaVal(rXml, `F${r}`, exObj.desc || '');
          rXml = setXmlFormulaVal(rXml, `J${r}`, exObj.recipient || '');
          rXml = setXmlFormulaVal(rXml, `L${r}`, Number(exObj.amount) || 0);
          rXml = setXmlFormulaVal(rXml, `N${r}`, exObj.notes || '');
        }
        logRows.push(rXml);
      }
    }
    s5 = s5.replace('__EXP_LOG_ROWS_22_121__', logRows.join(''));
    s5 = setXmlFormulaVal(s5, 'L122', grandTotalExp);
    outFiles['xl/worksheets/sheet5.xml'] = s5;
  }

  // 6. Shared AutoComplete rows (Rows 5..54) for Daily Sheets
  let sharedR3_56 = tpl.__R3_56__;
  for (let c = 0; c < 50; c++) {
    const m = appState.merchants[c];
    sharedR3_56 = setXmlFormulaVal(sharedR3_56, `C${5 + c}`, m ? m.name : 'ـ');
  }

  // 7. Sheets 6..15: يوم 1 .. يوم 10
  for (let d = 1; d <= 10; d++) {
    const sname = `xl/worksheets/sheet${5 + d}.xml`;
    const s = summaries[d];
    const orderedRows = s.allOrderedRows || s.rows;

    const salesRowsXml = [];
    for (let idx = 0; idx < 45; idx++) {
      const r = 57 + idx;
      const baseR = (r % 2 === 1) ? 57 : 58;
      const baseXml = (r % 2 === 1) ? tpl.__DAY_R57__ : tpl.__DAY_R58__;
      let rXml = cloneXmlTemplateRow(baseXml, baseR, r, idx + 1);
      const row = orderedRows[idx];
      if (row) {
        const notesWithCustody = (row.totalCustody > 0 && !String(row.notes || '').includes('عهدة:'))
          ? `${row.notes ? row.notes + ' | ' : ''}عهدة: ${row.totalCustody} (متبقي: ${row.netCustodyRemaining})`
          : (row.notes || '');

        rXml = setXmlFormulaVal(rXml, `B${r}`, row.code || 0);
        rXml = setXmlCellVal(rXml, `C${r}`, row.merchant, false);
        rXml = setXmlCellVal(rXml, `D${r}`, row.scaleNo, true);
        rXml = setXmlCellVal(rXml, `E${r}`, row.carNo, true);
        rXml = setXmlCellVal(rXml, `F${r}`, row.w1, true, true);
        if (row.isPending) {
          rXml = setXmlCellVal(rXml, `G${r}`, '', true);
          rXml = setXmlFormulaVal(rXml, `H${r}`, 0);
          rXml = setXmlCellVal(rXml, `I${r}`, row.price, true);
          rXml = setXmlCellVal(rXml, `J${r}`, row.tip, true);
          rXml = setXmlFormulaVal(rXml, `K${r}`, 0);
        } else {
          rXml = setXmlCellVal(rXml, `G${r}`, row.w2, true, true);
          rXml = setXmlFormulaVal(rXml, `H${r}`, row.netWeight);
          rXml = setXmlCellVal(rXml, `I${r}`, row.price, true, true);
          rXml = setXmlCellVal(rXml, `J${r}`, row.tip, true);
          rXml = setXmlFormulaVal(rXml, `K${r}`, Number(row.baseAmount.toFixed(2)));
        }
        rXml = setXmlCellVal(rXml, `L${r}`, row.cashSales, true);
        rXml = setXmlCellVal(rXml, `M${r}`, row.transferSales, true);
        rXml = setXmlCellVal(rXml, `N${r}`, row.transferSalesType, false);
        rXml = setXmlCellVal(rXml, `O${r}`, row.creditSales, true);
        rXml = setXmlCellVal(rXml, `P${r}`, row.debtCash, true);
        rXml = setXmlCellVal(rXml, `Q${r}`, row.debtTransfer, true);
        rXml = setXmlCellVal(rXml, `R${r}`, row.debtTransferType, false);
        rXml = setXmlCellVal(rXml, `S${r}`, row.prevCash, true);
        rXml = setXmlCellVal(rXml, `T${r}`, row.prevTransfer, true);
        rXml = setXmlCellVal(rXml, `U${r}`, row.prevTransferType, false);
        rXml = setXmlCellVal(rXml, `V${r}`, notesWithCustody, false);
        if (!row.isPending) {
          rXml = setXmlFormulaVal(rXml, `W${r}`, Number(row.totalWithTip.toFixed(2)));
          rXml = setXmlFormulaVal(rXml, `X${r}`, row.totalPaidAndCredit);
          rXml = setXmlFormulaVal(rXml, `Y${r}`, Number(row.invoiceDiff.toFixed(2)));
        }
      }
      salesRowsXml.push(rXml);
    }

    const expRowsXml = [];
    for (let eIdx = 0; eIdx < 10; eIdx++) {
      const er = 116 + eIdx;
      const baseR = (er % 2 === 0) ? 116 : 117;
      const baseXml = (er % 2 === 0) ? tpl.__DAY_R116__ : tpl.__DAY_R117__;
      let eXml = cloneXmlTemplateRow(baseXml, baseR, er, eIdx + 1);
      const ex = s.expenses[eIdx];
      if (ex && Number(ex.amount) > 0) {
        const exportCat = ex.category === 'منصرفات أخرى (بدون تصنيف محدد)' ? '' : (ex.category || '');
        eXml = setXmlCellVal(eXml, `C${er}`, exportCat, false);
        eXml = setXmlCellVal(eXml, `H${er}`, ex.desc || '', false);
        eXml = setXmlCellVal(eXml, `P${er}`, ex.recipient || '', false);
        eXml = setXmlCellVal(eXml, `U${er}`, Number(ex.amount) || 0, true, true);
        eXml = setXmlCellVal(eXml, `X${er}`, ex.notes || '', false);
      }
      expRowsXml.push(eXml);
    }

    let r105_113 = tpl.__R105_113__;
    r105_113 = setXmlFormulaVal(r105_113, 'F106', s.countCars);
    r105_113 = setXmlFormulaVal(r105_113, 'O106', Number(s.sumTotalWithTip.toFixed(2)));
    r105_113 = setXmlFormulaVal(r105_113, 'X106', s.sumCashSales + s.sumDebtCash);
    r105_113 = setXmlFormulaVal(r105_113, 'F107', s.sumW2);
    r105_113 = setXmlFormulaVal(r105_113, 'O107', s.sumCreditSales + s.sumTransferSales);
    r105_113 = setXmlFormulaVal(r105_113, 'X107', s.sumPrevCash);
    r105_113 = setXmlFormulaVal(r105_113, 'F108', s.sumW1);
    r105_113 = setXmlFormulaVal(r105_113, 'O108', s.currentFarmTransfers);
    r105_113 = setXmlFormulaVal(r105_113, 'X108', s.totalCashBeforeExpenses);
    r105_113 = setXmlFormulaVal(r105_113, 'F109', s.sumNetW);
    r105_113 = setXmlFormulaVal(r105_113, 'O109', s.sumPrevTransfer);
    r105_113 = setXmlFormulaVal(r105_113, 'X109', s.sumExpenses);
    r105_113 = setXmlFormulaVal(r105_113, 'F110', s.sumNetW);
    r105_113 = setXmlFormulaVal(r105_113, 'O110', s.totalAllTransfers);
    r105_113 = setXmlFormulaVal(r105_113, 'X110', s.netCashInBox);
    r105_113 = setXmlFormulaVal(r105_113, 'F111', s.countCars > 0 ? Math.round(s.sumNetW / s.countCars) : 0);
    r105_113 = setXmlFormulaVal(r105_113, 'O111', Number(s.sumInvoiceDiff.toFixed(2)));
    r105_113 = setXmlCellVal(r105_113, 'X111', s.deliveredCash, true, true);
    r105_113 = setXmlFormulaVal(r105_113, 'F112', s.weightAuditDiff);
    r105_113 = setXmlFormulaVal(r105_113, 'G112', s.weightAuditDiff === 0 ? 'وزن مطابق' : 'خطأ وزن');
    r105_113 = setXmlFormulaVal(r105_113, 'O112', s.invoiceAuditDiff);
    r105_113 = setXmlFormulaVal(r105_113, 'P112', s.invoiceAuditDiff === 0 ? 'فواتير متزنة' : 'فرق بالفواتير');
    r105_113 = setXmlFormulaVal(r105_113, 'X112', s.cashBoxDiff);
    r105_113 = setXmlFormulaVal(r105_113, 'Y112', s.cashBoxDiff === 0 ? 'خزينة مطابقة' : (s.cashBoxDiff < 0 ? 'زيادة توريد' : 'عجز توريد'));

    let dayXml = outFiles[sname]
      .replace('__DAY_HEAD__', tpl.__DAY_HEAD__)
      .replace('__R3_56__', sharedR3_56)
      .replace('__DAY_SALES_ROWS_57_101__', salesRowsXml.join(''))
      .replace('__R105_113__', r105_113)
      .replace('__DAY_EXP_ROWS_116_125__', expRowsXml.join(''))
      .replace('__DAY_TAIL__', tpl.__DAY_TAIL__);

    dayXml = setXmlFormulaVal(dayXml, 'A1', `محضر بيع وميزان مراجعة (يوم ${d}) - مزرعة ${fName}`);
    dayXml = setXmlCellVal(dayXml, 'C2', s.dateLabel, false);
    dayXml = setXmlFormulaVal(dayXml, 'V2', `صافي الخزنة: ${fmtInt(s.netCashInBox)} ج.م`);

    // Row 102 Totals
    dayXml = setXmlFormulaVal(dayXml, 'F102', s.sumW1);
    dayXml = setXmlFormulaVal(dayXml, 'G102', s.sumW2);
    dayXml = setXmlFormulaVal(dayXml, 'H102', s.sumNetW);
    dayXml = setXmlFormulaVal(dayXml, 'I102', Number(s.avgPrice.toFixed(2)));
    dayXml = setXmlFormulaVal(dayXml, 'J102', s.sumTip);
    dayXml = setXmlFormulaVal(dayXml, 'K102', Number(s.sumBase.toFixed(2)));
    dayXml = setXmlFormulaVal(dayXml, 'L102', s.sumCashSales);
    const cntTrSales = (s.rows || []).filter(r => r.transferSales > 0).length;
    const cntDebtTr = (s.rows || []).filter(r => r.debtTransfer > 0).length;
    const cntPrevTr = (s.rows || []).filter(r => r.prevTransfer > 0).length;
    dayXml = setXmlFormulaVal(dayXml, 'M102', s.sumTransferSales);
    dayXml = setXmlFormulaVal(dayXml, 'N102', `${cntTrSales} تحويل`);
    dayXml = setXmlFormulaVal(dayXml, 'O102', s.sumCreditSales);
    dayXml = setXmlFormulaVal(dayXml, 'P102', s.sumDebtCash);
    dayXml = setXmlFormulaVal(dayXml, 'Q102', s.sumDebtTransfer);
    dayXml = setXmlFormulaVal(dayXml, 'R102', `${cntDebtTr} تحويل`);
    dayXml = setXmlFormulaVal(dayXml, 'S102', s.sumPrevCash);
    dayXml = setXmlFormulaVal(dayXml, 'T102', s.sumPrevTransfer);
    dayXml = setXmlFormulaVal(dayXml, 'U102', `${cntPrevTr} تحويل`);
    dayXml = setXmlFormulaVal(dayXml, 'W102', Number(s.sumTotalWithTip.toFixed(2)));
    dayXml = setXmlFormulaVal(dayXml, 'X102', s.sumPaidAndCredit);
    dayXml = setXmlFormulaVal(dayXml, 'Y102', Number(s.sumInvoiceDiff.toFixed(2)));
    dayXml = setXmlFormulaVal(dayXml, 'U126', s.sumExpenses);

    outFiles[sname] = dayXml;
  }

  const enc = new TextEncoder();
  const entries = [];
  for (const name of Object.keys(outFiles)) {
    const nameBytes = enc.encode(name);
    const rawBytes = enc.encode(outFiles[name]);
    const crc = computeCrc32(rawBytes);
    const deflated = await deflateRawBytesBrowser(rawBytes);
    if (deflated) {
      entries.push({ nameBytes, rawBytes, compBytes: deflated, method: 8, crc });
    } else {
      entries.push({ nameBytes, rawBytes, compBytes: rawBytes, method: 0, crc });
    }
  }
  return buildZipBytesFromEntries(entries);
}

async function exportFullWorkbookXlsx() {
  const fName = (appState.farmName || 'أبوذكري').replace(/\s+/g, '_');
  const fileName = `نظام_محاضر_بيع_مزرعة_${fName}_10_ايام.xlsx`;

  try {
    const xlsxBytes = await buildStyled15SheetExcelBytes();
    const blob = new Blob([xlsxBytes], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });

    if (liveExcelFileHandle) {
      try {
        const writable = await liveExcelFileHandle.createWritable();
        await writable.write(blob);
        await writable.close();
        if (!(appState.webhookUrl || getEmbeddedWebhookUrl())) {
          appState.pendingChanges = 0;
        }
        appState.lastExcelSync = `تم تحديث الملف المرتبط (${liveExcelFileHandle.name}) الساعة ${new Date().toLocaleTimeString('ar-EG')}`;
        saveState(false);
        showToast(`تم تحديث ملف الإكسيل المرتبط (${liveExcelFileHandle.name}) مباشرة بنفس التنسيق والمعادلات!`, '💾');
        return;
      } catch (err) {
        // Fallback to standard download if permission expired
      }
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);

    if (!(appState.webhookUrl || getEmbeddedWebhookUrl())) {
      appState.pendingChanges = 0;
    }
    appState.lastExcelSync = `آخر تصدير للإكسيل: ${new Date().toLocaleTimeString('ar-EG')}`;
    saveState(false);
    showToast(`تم تحميل شيت الإكسيل (${fileName}) بنفس التنسيق الكامل والألوان والمعادلات لآخر إصدار!`, '📥');
  } catch (err) {
    showToast('حدث خطأ أثناء تجهيز ملف الإكسيل، حاول مرة أخرى', '⚠️');
  }
}

// =========================================================================
// EXCEL DATA SANITIZATION & COMPOSITE KEY ENGINE (تنظيف وتحصين بيانات الإكسيل ومنع التكرار)
// =========================================================================
function sanitizeExcelText(val) {
  if (val === null || val === undefined) return '';
  const cleaned = String(val)
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned === 'ـ' || cleaned === '-' || cleaned === '—' || cleaned === 'null' || cleaned === 'undefined' || cleaned.startsWith('#')) {
    return '';
  }
  return cleaned;
}

function sanitizeExcelNum(val, roundDecimals = 2) {
  if (typeof val === 'number') {
    if (!isFinite(val)) return 0;
    const factor = Math.pow(10, roundDecimals);
    return Math.round(val * factor) / factor;
  }
  if (val === null || val === undefined || val === '') return 0;
  let s = String(val)
    .replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[,،\s]/g, '')
    .replace(/ج\.م|كجم|تحويل/g, '')
    .trim();
  if (!s || s === '-' || s === 'ـ' || s.startsWith('#')) return 0;
  const n = parseFloat(s);
  if (!isFinite(n)) return 0;
  const factor = Math.pow(10, roundDecimals);
  return Math.round(n * factor) / factor;
}

function sanitizeExcelPositiveIntOrEmpty(val) {
  const n = Math.round(sanitizeExcelNum(val, 0));
  return n > 0 ? n : '';
}

function normalizeExcelTransferType(rawType, amount = 0) {
  const t = sanitizeExcelText(rawType);
  if (!t && !(Number(amount) > 0)) return '';
  if (!t && Number(amount) > 0) return 'تحويل كاش';
  if (t.includes('شيك')) return 'شيكات';
  if (t.includes('إنستا') || t.includes('انستا') || /insta/i.test(t)) return 'إنستا باي';
  if (t.includes('بنك')) return 'تحويل بنكي';
  if (t.includes('كاش') || t.includes('محفظ')) return 'تحويل كاش';
  return t;
}

function normalizeExcelExpenseCategory(rawCat) {
  const c = sanitizeExcelText(rawCat);
  if (!c) return 'منصرفات أخرى (بدون تصنيف محدد)';
  const exact = EXPENSE_CATEGORIES.find(x => x === c);
  if (exact) return exact;
  if (c.includes('مكاف') || c.includes('حوافز')) return 'مكافآت وحوافز';
  if (c.includes('موقع') || c.includes('تشغيل')) return 'مصاريف موقع وتشغيل';
  if (c.includes('مشال') || c.includes('تحميل') || c.includes('عمال')) return 'مشال وتحميل وعمال';
  if (c.includes('إكرامي') || c.includes('اكرامي') || c.includes('ميزان')) return 'إكراميات وميزان';
  if (c.includes('تغذي') || c.includes('ضياف')) return 'تغذية وضيافة';
  if (c.includes('انتقال') || c.includes('سولار')) return 'انتقالات وسولار';
  if (c.includes('سلف') || c.includes('عهد')) return 'سلف وعهد نقدية';
  if (c.includes('نثري')) return 'مصاريف نثرية أخرى';
  return 'منصرفات أخرى (بدون تصنيف محدد)';
}

function extractCustodyAndCleanNotesFromExcel(rawNotes, colZVal, colAAVal) {
  let notes = sanitizeExcelText(rawNotes);
  let custodyCash = 0;
  let custodyTransfer = 0;
  let custodyTransferType = '';

  // 1) فحص أعمدة العهدة الإضافية في شيت الإكسيل (Col Z = r[25], Col AA = r[26]) مثل (500000 | شيك) في يوم 5
  const extraAmt = Math.max(0, sanitizeExcelNum(colZVal, 2));
  const extraType = sanitizeExcelText(colAAVal);
  if (extraAmt > 0) {
    if (extraType && (extraType.includes('شيك') || extraType.includes('بنك') || extraType.includes('إنستا') || extraType.includes('انستا') || extraType.includes('تحويل') || extraType.includes('كاش') || extraType.includes('محفظ'))) {
      custodyTransfer = extraAmt;
      custodyTransferType = normalizeExcelTransferType(extraType, extraAmt);
    } else {
      custodyCash = extraAmt;
    }
  }

  // 2) استخلاص العهدة المدمجة نصياً في عمود الملاحظات عند إعادة استيراد ملف تم تصديره من الموقع لمنع تكرار نص "[عهدة: ...]"
  const custodyRegex = /(?:\s*\|\s*)?عهدة:\s*([0-9,.]+)\s*\(متبقي:\s*[-0-9,.]+\)/g;
  const match = custodyRegex.exec(notes);
  if (match && match[1]) {
    const parsedCust = Math.max(0, sanitizeExcelNum(match[1], 2));
    if (parsedCust > 0 && custodyCash === 0 && custodyTransfer === 0) {
      custodyCash = parsedCust;
    }
    notes = notes.replace(custodyRegex, '').trim();
  }
  return { notes, custodyCash, custodyTransfer, custodyTransferType };
}

function buildExcelSaleCompositeKey(dayNum, seq, rec) {
  const mKey = normalizeArabicMerchantCompareKey(rec.merchant) || sanitizeExcelText(rec.merchant);
  const subNo = (String(rec.merchant || '').match(/\d+/) || [''])[0];
  const sNo = Number(rec.scaleNo) || 0;
  if (sNo > 0) {
    return `d${dayNum}_scale_${sNo}_m_${mKey}${subNo}`;
  }
  const cNo = String(rec.carNo || '').trim() || 'nocar';
  const w1 = Number(rec.w1) || 0;
  const w2 = Number(rec.w2) || 0;
  if (w1 > 0 || w2 > 0) {
    return `d${dayNum}_car_${cNo}_m_${mKey}${subNo}_w_${w1}_${w2}`;
  }
  return `d${dayNum}_seq_${seq}_m_${mKey}${subNo}_coll_${rec.debtCash}_${rec.debtTransfer}_${rec.prevCash}_${rec.prevTransfer}`;
}

function buildExcelExpenseCompositeKey(dayNum, expSeq, exp) {
  const cat = normalizeExcelExpenseCategory(exp.category);
  const desc = sanitizeExcelText(exp.desc);
  const recip = sanitizeExcelText(exp.recipient);
  const amt = Number(exp.amount) || 0;
  return `exp_d${dayNum}_s${expSeq}_${cat}_${desc}_${recip}_${amt}`;
}

function isSaleRecordUnchanged(oldRec, newRec) {
  if (!oldRec || !newRec) return false;
  return (
     sanitizeExcelText(oldRec.merchant) === sanitizeExcelText(newRec.merchant) &&
    (Number(oldRec.scaleNo) || 0) === (Number(newRec.scaleNo) || 0) &&
    String(oldRec.carNo || '').trim() === String(newRec.carNo || '').trim() &&
    isSameNumVal(oldRec.w1, newRec.w1) &&
    isSameNumVal(oldRec.w2, newRec.w2) &&
    isSameNumVal(oldRec.price, newRec.price) &&
    isSameNumVal(oldRec.tip, newRec.tip) &&
    isSameNumVal(oldRec.custodyCash, newRec.custodyCash) &&
    isSameNumVal(oldRec.custodyTransfer, newRec.custodyTransfer) &&
    sanitizeExcelText(oldRec.custodyTransferType) === sanitizeExcelText(newRec.custodyTransferType) &&
    isSameNumVal(oldRec.cashSales, newRec.cashSales) &&
    isSameNumVal(oldRec.transferSales, newRec.transferSales) &&
    sanitizeExcelText(oldRec.transferSalesType) === sanitizeExcelText(newRec.transferSalesType) &&
    isSameNumVal(oldRec.creditSales, newRec.creditSales) &&
    isSameNumVal(oldRec.debtCash, newRec.debtCash) &&
    isSameNumVal(oldRec.debtTransfer, newRec.debtTransfer) &&
    sanitizeExcelText(oldRec.debtTransferType) === sanitizeExcelText(newRec.debtTransferType) &&
    isSameNumVal(oldRec.prevCash, newRec.prevCash) &&
    isSameNumVal(oldRec.prevTransfer, newRec.prevTransfer) &&
    sanitizeExcelText(oldRec.prevTransferType) === sanitizeExcelText(newRec.prevTransferType) &&
    sanitizeExcelText(oldRec.notes) === sanitizeExcelText(newRec.notes)
  );
}

function importWorkbookIntoAppState(workbook, sourceFileName = '') {
  if (!workbook || !workbook.Sheets || !Array.isArray(workbook.SheetNames) || workbook.SheetNames.length === 0) {
    showToast('⚠️ ملف الإكسيل فارغ أو غير صالح للقراءة!', '⚠️');
    return false;
  }

  let importedSalesCount = 0;
  let updatedExistingSalesCount = 0;
  let unchangedSalesCount = 0;
  let importedExpCount = 0;
  let importedMerchantsCount = 0;
  const masterImportTs = getSyncedNow();

  // 1. استخلاص أو تثبيت اسم المزرعة النشطة بذكاء من شيت الملخص (الخلية C3 أو عنوان الخلية A1)
  let detectedFarmName = sanitizeExcelText(appState.farmName) || 'أبوذكري';
  const summarySheet = workbook.Sheets['لوحة التحكم والملخص'];
  if (summarySheet) {
    const c3Cell = summarySheet['C3'];
    const a1Cell = summarySheet['A1'];
    const c3Val = c3Cell && c3Cell.v ? sanitizeExcelText(c3Cell.v) : '';
    const a1Val = a1Cell && a1Cell.v ? sanitizeExcelText(a1Cell.v) : '';
    if (c3Val && !c3Val.includes('فتح محضر') && !c3Val.includes('يوم')) {
      detectedFarmName = c3Val;
    } else if (a1Val) {
      const mFarm = a1Val.match(/مزرعة\s+([^(\n\r\-]+)/);
      if (mFarm && mFarm[1]) {
        const cand = sanitizeExcelText(mFarm[1]);
        if (cand) detectedFarmName = cand;
      }
    }
  }
  appState.farmName = detectedFarmName;

  // 2. قراءة وتنظيف دليل التجار الموحد من شيت `تكويد التجار وكشف الحساب`
  const merchSheet = workbook.Sheets['تكويد التجار وكشف الحساب'];
  if (merchSheet) {
    const mRows = XLSX.utils.sheet_to_json(merchSheet, { header: 1, defval: '' });
    mRows.forEach(r => {
      if (!Array.isArray(r)) return;
      const code = Math.round(sanitizeExcelNum(r[1], 0));
      const name = sanitizeExcelText(r[2]);
      if (code >= 101 && code <= 999 && name && !name.includes('اسم التاجر') && !name.includes('إجمالي')) {
        unrecordDeletedItem('merchants', code);
        const byCode = appState.merchants.find(x => Number(x.code) === code);
        const byName = appState.merchants.find(x => isSameMerchantIdentity(x.name, name));
        if (byCode) {
          byCode.name = name;
          byCode.updatedAt = masterImportTs;
        } else if (byName) {
          byName.code = code;
          byName.name = name;
          byName.updatedAt = masterImportTs;
        } else {
          appState.merchants.push({ code, name, updatedAt: masterImportTs });
          importedMerchantsCount++;
        }
      }
    });
    unifyGlobalMerchantsRegistry();
  }

  // 3. قراءة شيتات الأيام (`يوم 1`..`يوم 10`) أو الشيت المنفرد مع التنظيف الشامل ومنع التكرار
  const daySheetRegex = /^يوم\s*(\d+)$/;
  const matchedDaySheets = [];
  workbook.SheetNames.forEach(sName => {
    const m = String(sName || '').trim().match(daySheetRegex);
    if (m && Number(m[1]) >= 1 && Number(m[1]) <= 10) {
      matchedDaySheets.push({ dayNum: Number(m[1]), name: sName });
    }
  });
  const targetSheets = matchedDaySheets.length > 0
    ? matchedDaySheets.sort((a, b) => a.dayNum - b.dayNum)
    : [{ dayNum: appState.currentDay || 1, name: workbook.SheetNames[0] }];

  targetSheets.forEach(({ dayNum, name }) => {
    const ws = workbook.Sheets[name];
    if (!ws) return;
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    if (!appState.days[dayNum]) {
      appState.days[dayNum] = {
        dayNumber: dayNum,
        dateLabel: `اليوم ${dayNum}`,
        sales: [],
        pendingSales: [],
        expenses: [],
        deliveredCash: 0,
        clearedAt: 0,
        addedAt: 0
      };
    }

    const oldSales = Array.isArray(appState.days[dayNum].sales) ? [...appState.days[dayNum].sales] : [];
    const oldPendingSales = Array.isArray(appState.days[dayNum].pendingSales) ? [...appState.days[dayNum].pendingSales] : [];
    const oldExpenses = Array.isArray(appState.days[dayNum].expenses) ? [...appState.days[dayNum].expenses] : [];
    const usedOldSaleIds = new Set();
    const usedOldPendIds = new Set();
    const usedOldExpIds = new Set();

    // استخلاص تاريخ/عنوان اليوم من الصف الثاني العمود C (rows[1][2])
    if (rows[1] && rows[1][2]) {
      const cleanDateLbl = sanitizeExcelText(rows[1][2]);
      if (cleanDateLbl && !cleanDateLbl.includes('إجمالي اليوم')) {
        appState.days[dayNum].dateLabel = cleanDateLbl;
        appState.days[dayNum].labelUpdatedAt = masterImportTs;
      }
    }

    // اكتشاف تخطيط الأعمدة من صف الترويسة (Row 3 / Row 4)بدلاً من الاعتماد على r.length المتغير
    let sheetLayoutMode = '25col'; // Default 25-column standard layout
    for (let hIdx = 0; hIdx < Math.min(rows.length, 56); hIdx++) {
      const hr = rows[hIdx];
      if (!Array.isArray(hr)) continue;
      const joined = hr.map(x => String(x || '')).join(' ');
      if (joined.includes('اسم التاجر') && joined.includes('وزنة أولى')) {
        const c2 = String(hr[2] || '');
        if (!c2.includes('اسم التاجر') && String(hr[1] || '').includes('اسم التاجر')) {
          sheetLayoutMode = 'legacy16col';
        } else if (hr.length < 22 && !joined.includes('نوع تحويل المديونية')) {
          sheetLayoutMode = '21col';
        } else {
          sheetLayoutMode = '25col';
        }
        break;
      }
    }

    const newSales = [];
    const newPendingSales = [];
    const newExpenses = [];
    let inExpensesSection = false;
    let inTrialBalanceSection = false;

    rows.forEach((r, rIdx) => {
      if (!Array.isArray(r)) return;
      const colA = sanitizeExcelText(r[0]);
      const colR = sanitizeExcelText(r[17]);
      const colP = sanitizeExcelText(r[15]);

      if (colA.includes('ميزان مراجعة وتصفية اليوم') || colA.includes('أولاً: ميزان مراجعة')) {
        inTrialBalanceSection = true;
      }

      // اكتشاف بداية قسم المصروفات اليومية (`رابعاً: بيان المصروفات`)
      if (colA.includes('رابعاً:') || colA.includes('بيان المصروفات والمكافآت والمنصرف')) {
        inExpensesSection = true;
        return;
      }

      // قراءة النقدية المسلمة فعلياً للخزينة من ميزان المراجعة
      if (colR.includes('النقدية المسلمة فعلياً') || colP.includes('النقدية المسلمة فعلياً')) {
        const delivVal = Math.max(0, sanitizeExcelNum(r[23] !== '' && r[23] !== undefined ? r[23] : r[19], 2));
        appState.days[dayNum].deliveredCash = delivVal;
        appState.days[dayNum].deliveredCashUpdatedAt = masterImportTs;
      }

      if (!inExpensesSection && !inTrialBalanceSection) {
        // صفوف المبيعات: المسلسل 1..45 في العمود A (قبل صف الإجمالي 102)
        const seq = Math.round(sanitizeExcelNum(r[0], 0));
        if (seq >= 1 && seq <= 45 && rIdx < 103) {
          const is25Col = sheetLayoutMode === '25col';
          const is21Col = sheetLayoutMode === '21col';

          let merch = sanitizeExcelText(is25Col || is21Col ? r[2] : r[1]);
          if (!merch || merch.includes('اسم التاجر') || merch.includes('الإجمالي') || merch.includes('ملاحظات')) return;

          const explicitCode = Math.round(sanitizeExcelNum(is25Col || is21Col ? r[1] : 0, 0));
          // إذا كان اسم التاجر في الشيت بدون رقم سيارة فرعية وله كود صريح في العمود B يطابق تاجراً مكوداً (مثل "مزرعه" -> كود 131 "المزرعه")، نستخدم الاسم الرسمي الموحد
          const hasSubCarNumber = /\d/.test(merch);
          if (!hasSubCarNumber && explicitCode >= 101) {
            const officialMerch = appState.merchants.find(m => Number(m.code) === explicitCode);
            if (officialMerch && isSameMerchantIdentity(officialMerch.name, merch)) {
              merch = officialMerch.name;
            }
          }

          const scaleNoVal = sanitizeExcelPositiveIntOrEmpty(is25Col || is21Col ? r[3] : r[2]);
          const carNoVal = sanitizeExcelPositiveIntOrEmpty(is25Col || is21Col ? r[4] : r[3]);
          const w1 = Math.max(0, sanitizeExcelNum(is25Col || is21Col ? r[5] : r[4], 2));
          const w2 = Math.max(0, sanitizeExcelNum(is25Col || is21Col ? r[6] : r[5], 2));
          const price = Math.max(0, sanitizeExcelNum(is25Col || is21Col ? r[8] : r[7], 2));
          const tip = Math.max(0, sanitizeExcelNum(is25Col || is21Col ? r[9] : r[8], 2));

          // معالجة ذكية لنقدي المبيعات: في بعض شيتات الإكسيل توضع معادلة فروق التقريب (=O57-W57) في خلية النقدي فتعطي قيماً عشرية ضئيلة مثل 0.30 أو -0.20 ج.م
          let rawCashSales = sanitizeExcelNum(is25Col || is21Col ? r[11] : r[10], 2);
          const cashSales = (rawCashSales < 0 || (rawCashSales > 0 && rawCashSales < 1 && (w2 > 0 || w1 > 0)))
            ? 0
            : Math.max(0, rawCashSales);

          const transferSales = Math.max(0, sanitizeExcelNum(is25Col || is21Col ? r[12] : r[11], 2));
          const transferSalesType = normalizeExcelTransferType(is25Col || is21Col ? r[13] : '', transferSales);
          const creditSales = Math.max(0, sanitizeExcelNum(is25Col || is21Col ? r[14] : r[12], 2));
          const debtCash = Math.max(0, sanitizeExcelNum(is25Col || is21Col ? r[15] : r[13], 2));
          const debtTransfer = Math.max(0, sanitizeExcelNum(is25Col ? r[16] : 0, 2));
          const debtTransferType = normalizeExcelTransferType(is25Col ? r[17] : '', debtTransfer);
          const prevCash = Math.max(0, sanitizeExcelNum(is25Col ? r[18] : (is21Col ? r[16] : r[14]), 2));
          const prevTransfer = Math.max(0, sanitizeExcelNum(is25Col ? r[19] : 0, 2));
          const prevTransferType = normalizeExcelTransferType(is25Col ? r[20] : '', prevTransfer);

          const rawNotesCell = is25Col ? r[21] : (is21Col ? r[17] : r[15]);
          const { notes, custodyCash, custodyTransfer, custodyTransferType } = extractCustodyAndCleanNotesFromExcel(
            rawNotesCell,
            is25Col ? r[25] : '',
            is25Col ? r[26] : ''
          );

          // قبول أي صف يحتوي على أوزان أو أسعار أو أي حركة مالية (نقدي، آجل، تحويل مبيعات، سداد مديونية، تحصيل مزرعة سابقة، أو عهدة)
          const hasAnyRowActivity = (
            w1 > 0 || w2 > 0 || price > 0 ||
            cashSales > 0 || transferSales > 0 || creditSales > 0 ||
            debtCash > 0 || debtTransfer > 0 ||
            prevCash > 0 || prevTransfer > 0 ||
            custodyCash > 0 || custodyTransfer > 0
          );

          if (hasAnyRowActivity) {
            ensureMerchantExists(merch, explicitCode >= 101 ? explicitCode : null);

            // الحركة تعتبر "مؤقتة (وزنة 1 فقط)" فقط إذا سُجلت الوزنة الأولى (w1 > 0) ولم تُسجل الوزنة الثانية ولا أي مبالغ تحصيل أو آجل أو تحويلات
            const isPendingRow = (
              w1 > 0 && w2 <= 0 &&
              cashSales === 0 && transferSales === 0 && creditSales === 0 &&
              debtCash === 0 && debtTransfer === 0 &&
              prevCash === 0 && prevTransfer === 0
            );

            const recObj = {
              id: '',
              excelCompositeKey: '',
              merchant: merch,
              scaleNo: scaleNoVal,
              carNo: carNoVal,
              w1,
              w2,
              price,
              tip,
              custodyCash,
              custodyTransfer,
              custodyTransferType,
              cashSales,
              transferSales,
              transferSalesType,
              creditSales,
              debtCash,
              debtTransfer,
              debtTransferType,
              prevCash,
              prevTransfer,
              prevTransferType,
              notes
            };
            recObj.excelCompositeKey = buildExcelSaleCompositeKey(dayNum, seq, recObj);

            if (isPendingRow) {
              // البحث عن الحركة المؤقتة المطابقة في البيانات الحالية (بالمفتاح المركب أو رقم الميزان أو التطابق الموضوعي حتى لو اختلف الـ UUID)
              const matchedOldPend = oldPendingSales.find(op =>
                op && !usedOldPendIds.has(String(op.id)) && arePendingSalesDuplicate(op, recObj, true)
              );
              if (matchedOldPend) {
                usedOldPendIds.add(String(matchedOldPend.id));
                recObj.id = isCollisionProofUUID(matchedOldPend.id)
                  ? String(matchedOldPend.id)
                  : generateRecordUUID(`imp_pend_d${dayNum}`);
                if (matchedOldPend.custodyCash && !recObj.custodyCash) recObj.custodyCash = matchedOldPend.custodyCash;
                if (matchedOldPend.custodyTransfer && !recObj.custodyTransfer) recObj.custodyTransfer = matchedOldPend.custodyTransfer;
                if (matchedOldPend.custodyTransferType && !recObj.custodyTransferType) recObj.custodyTransferType = matchedOldPend.custodyTransferType;
              } else {
                recObj.id = generateRecordUUID(`imp_pend_d${dayNum}`);
              }

              const unchanged = matchedOldPend && isSaleRecordUnchanged(matchedOldPend, recObj);
              if (unchanged) {
                Object.assign(recObj, {
                  createdAt: Number(matchedOldPend.createdAt) || masterImportTs,
                  createdBy: matchedOldPend.createdBy || getActiveUserShortLabel(),
                  createdTimeTxt: matchedOldPend.createdTimeTxt || formatAuditTimeArabic(masterImportTs),
                  updatedAt: Number(matchedOldPend.updatedAt) || masterImportTs,
                  updatedBy: matchedOldPend.updatedBy || getActiveUserShortLabel(),
                  updatedTimeTxt: matchedOldPend.updatedTimeTxt || formatAuditTimeArabic(masterImportTs),
                  importedAt: Number(matchedOldPend.importedAt) || masterImportTs,
                  isEdited: Boolean(matchedOldPend.isEdited)
                });
                unchangedSalesCount++;
              } else {
                Object.assign(recObj, buildRecordAuditMeta(matchedOldPend || null, Boolean(matchedOldPend)), {
                  updatedAt: masterImportTs,
                  importedAt: masterImportTs
                });
                if (matchedOldPend) updatedExistingSalesCount++;
              }
              unrecordDeletedItem('pendingSales', recObj.id);

              const dupPendIdx = newPendingSales.findIndex(ep => arePendingSalesDuplicate(ep, recObj, true));
              if (dupPendIdx === -1) {
                newPendingSales.push(recObj);
                importedSalesCount++;
              } else {
                recObj.id = newPendingSales[dupPendIdx].id;
                newPendingSales[dupPendIdx] = recObj;
              }
            } else {
              // البحث عن حركة البيع المكتملة المطابقة في البيانات الحالية (أو ترقية حركة مؤقتة تم استكمال وزنتها الثانية في الإكسيل!)
              let matchedOldSale = oldSales.find(os =>
                os && !usedOldSaleIds.has(String(os.id)) && areSalesRowsDuplicate(os, recObj, true)
              );
              // fallback: مطابقة بنفس رقم الميزان ونفس التاجر إذا تم تعديل الأوزان أو المبالغ داخل الإكسيل
              if (!matchedOldSale && scaleNoVal) {
                matchedOldSale = oldSales.find(os =>
                  os && !usedOldSaleIds.has(String(os.id)) &&
                  Number(os.scaleNo) === Number(scaleNoVal) &&
                  isSameMerchantIdentity(os.merchant, recObj.merchant)
                );
              }
              const upgradedFromPending = !matchedOldSale
                ? oldPendingSales.find(op =>
                    op && !usedOldPendIds.has(String(op.id)) &&
                    isSameMerchantIdentity(op.merchant, recObj.merchant) &&
                    ((scaleNoVal && Number(op.scaleNo) === Number(scaleNoVal)) ||
                     (carNoVal && String(op.carNo) === String(carNoVal) && isSameNumVal(op.w1, recObj.w1)))
                  )
                : null;
              if (upgradedFromPending) {
                usedOldPendIds.add(String(upgradedFromPending.id));
                recordDeletedItem('pendingSales', String(upgradedFromPending.id), masterImportTs);
              }

              const baseExistingRec = matchedOldSale || upgradedFromPending || null;
              if (matchedOldSale) {
                usedOldSaleIds.add(String(matchedOldSale.id));
              }

              if (baseExistingRec && isCollisionProofUUID(baseExistingRec.id) && !upgradedFromPending) {
                recObj.id = String(baseExistingRec.id);
              } else {
                recObj.id = generateRecordUUID(`imp_sale_d${dayNum}`);
              }

              if (baseExistingRec) {
                if (baseExistingRec.custodyCash && !recObj.custodyCash) recObj.custodyCash = baseExistingRec.custodyCash;
                if (baseExistingRec.custodyTransfer && !recObj.custodyTransfer) recObj.custodyTransfer = baseExistingRec.custodyTransfer;
                if (baseExistingRec.custodyTransferType && !recObj.custodyTransferType) recObj.custodyTransferType = baseExistingRec.custodyTransferType;
              }

              const unchanged = matchedOldSale && isSaleRecordUnchanged(matchedOldSale, recObj);
              if (unchanged) {
                Object.assign(recObj, {
                  createdAt: Number(matchedOldSale.createdAt) || masterImportTs,
                  createdBy: matchedOldSale.createdBy || getActiveUserShortLabel(),
                  createdTimeTxt: matchedOldSale.createdTimeTxt || formatAuditTimeArabic(masterImportTs),
                  updatedAt: Number(matchedOldSale.updatedAt) || masterImportTs,
                  updatedBy: matchedOldSale.updatedBy || getActiveUserShortLabel(),
                  updatedTimeTxt: matchedOldSale.updatedTimeTxt || formatAuditTimeArabic(masterImportTs),
                  importedAt: Number(matchedOldSale.importedAt) || masterImportTs,
                  isEdited: Boolean(matchedOldSale.isEdited)
                });
                unchangedSalesCount++;
              } else {
                Object.assign(recObj, buildRecordAuditMeta(baseExistingRec, Boolean(baseExistingRec)), {
                  updatedAt: masterImportTs,
                  importedAt: masterImportTs
                });
                if (baseExistingRec) updatedExistingSalesCount++;
              }
              unrecordDeletedItem('sales', recObj.id);

              const dupSaleIdx = newSales.findIndex(es => areSalesRowsDuplicate(es, recObj, true));
              if (dupSaleIdx === -1) {
                newSales.push(recObj);
                importedSalesCount++;
              } else {
                recObj.id = newSales[dupSaleIdx].id;
                newSales[dupSaleIdx] = recObj;
              }
            }
          }
        }
      } else {
        // قسم المصروفات اليومية (الصفوف 116..125)
        const expSeq = Math.round(sanitizeExcelNum(r[0], 0));
        if (expSeq >= 1 && expSeq <= 10) {
          const cat = normalizeExcelExpenseCategory(r[2]);
          const desc = sanitizeExcelText(r[7] !== '' && r[7] !== undefined ? r[7] : r[6]);
          const recip = sanitizeExcelText(r[15] !== '' && r[15] !== undefined ? r[15] : r[12]);
          const amt = Math.max(0, sanitizeExcelNum(r[20] !== '' && r[20] !== undefined ? r[20] : r[16], 2));
          const expNotes = sanitizeExcelText(r[23]);
          if (amt > 0) {
            const expObj = {
              id: '',
              excelCompositeKey: '',
              category: cat,
              desc,
              recipient: recip,
              amount: amt,
              ...(expNotes ? { notes: expNotes } : {})
            };
            expObj.excelCompositeKey = buildExcelExpenseCompositeKey(dayNum, expSeq, expObj);

            const matchedOldExp = oldExpenses.find(oe =>
              oe && !usedOldExpIds.has(String(oe.id)) && areExpensesDuplicate(oe, expObj, true)
            );
            if (matchedOldExp) {
              usedOldExpIds.add(String(matchedOldExp.id));
              expObj.id = isCollisionProofUUID(matchedOldExp.id)
                ? String(matchedOldExp.id)
                : generateRecordUUID(`imp_exp_d${dayNum}`);
              Object.assign(expObj, {
                createdAt: Number(matchedOldExp.createdAt) || masterImportTs,
                createdBy: matchedOldExp.createdBy || getActiveUserShortLabel(),
                createdTimeTxt: matchedOldExp.createdTimeTxt || formatAuditTimeArabic(masterImportTs),
                updatedAt: Number(matchedOldExp.updatedAt) || masterImportTs,
                updatedBy: matchedOldExp.updatedBy || getActiveUserShortLabel(),
                updatedTimeTxt: matchedOldExp.updatedTimeTxt || formatAuditTimeArabic(masterImportTs),
                importedAt: Number(matchedOldExp.importedAt) || masterImportTs,
                isEdited: Boolean(matchedOldExp.isEdited)
              });
            } else {
              expObj.id = generateRecordUUID(`imp_exp_d${dayNum}`);
              Object.assign(expObj, buildRecordAuditMeta(null, false), {
                createdAt: masterImportTs,
                updatedAt: masterImportTs,
                importedAt: masterImportTs
              });
            }
            unrecordDeletedItem('expenses', expObj.id);

            if (!newExpenses.some(ee => areExpensesDuplicate(ee, expObj, true))) {
              newExpenses.push(expObj);
              importedExpCount++;
            }
          }
        }
      }
    });

    // تسجيل أي حركات قديمة أُزيلت من شيت الإكسيل في سجل المحذوفات بطابع زمني دقيق حتى لا ترتد من السحابة
    const keptSaleIds = new Set(newSales.map(s => String(s.id)));
    oldSales.forEach(os => {
      if (os && os.id !== undefined && !keptSaleIds.has(String(os.id))) {
        recordDeletedItem('sales', String(os.id), masterImportTs);
      }
    });
    const keptPendIds = new Set(newPendingSales.map(p => String(p.id)));
    oldPendingSales.forEach(op => {
      if (op && op.id !== undefined && !keptPendIds.has(String(op.id))) {
        recordDeletedItem('pendingSales', String(op.id), masterImportTs);
      }
    });
    const keptExpIds = new Set(newExpenses.map(e => String(e.id)));
    oldExpenses.forEach(oe => {
      if (oe && oe.id !== undefined && !keptExpIds.has(String(oe.id))) {
        recordDeletedItem('expenses', String(oe.id), masterImportTs);
      }
    });

    appState.days[dayNum].sales = sortSalesListByScaleNo(newSales);
    appState.days[dayNum].pendingSales = sortSalesListByScaleNo(newPendingSales);
    appState.days[dayNum].expenses = newExpenses;
    appState.days[dayNum].clearedAt = 0;
    if (newSales.length > 0 || newPendingSales.length > 0 || newExpenses.length > 0 || appState.days[dayNum].deliveredCash > 0) {
      appState.days[dayNum].addedAt = masterImportTs;
      appState.days[dayNum].isHidden = false;
    }
    deduplicateDayRecords(appState.days[dayNum], appState.deletedIds);
  });

  // 4. فحص شيت `بيان المصروفات والمكافآت` الاحتياطي إذا لم تكن المصروفات مسجلة في الشيتات اليومية
  const expSheet = workbook.Sheets['بيان المصروفات والمكافآت'];
  if (expSheet && importedExpCount === 0) {
    const eRows = XLSX.utils.sheet_to_json(expSheet, { header: 1, defval: '' });
    eRows.forEach((r, idx) => {
      if (!Array.isArray(r)) return;
      const dayTxt = sanitizeExcelText(r[1] || r[0]);
      const m = dayTxt.match(/يوم\s+(\d+)/);
      if (m) {
        const dNum = Number(m[1]);
        const amt = Math.max(0, sanitizeExcelNum(r[11] !== '' && r[11] !== undefined ? r[11] : r[5], 2));
        const rawCat = sanitizeExcelText(r[3] !== '' && r[3] !== undefined ? r[3] : r[2]);
        if (dNum >= 1 && dNum <= 10 && amt > 0 && !rawCat.includes('تصنيف')) {
          const cat = normalizeExcelExpenseCategory(rawCat);
          const desc = sanitizeExcelText(r[5] !== '' && r[5] !== undefined ? r[5] : r[3]);
          const recip = sanitizeExcelText(r[9] !== '' && r[9] !== undefined ? r[9] : r[4]);
          const expObj = {
            id: generateRecordUUID(`imp_exp_d${dNum}`),
            excelCompositeKey: buildExcelExpenseCompositeKey(dNum, idx + 1, { category: cat, desc, recipient: recip, amount: amt }),
            category: cat,
            desc,
            recipient: recip,
            amount: amt,
            createdAt: masterImportTs,
            updatedAt: masterImportTs,
            importedAt: masterImportTs,
            createdBy: getActiveUserShortLabel(),
            updatedBy: getActiveUserShortLabel()
          };
          unrecordDeletedItem('expenses', expObj.id);
          if (!appState.days[dNum].expenses.some(ee => areExpensesDuplicate(ee, expObj, true))) {
            appState.days[dNum].expenses.push(expObj);
            importedExpCount++;
          }
        }
      }
    });
  }

  // 5. تحديث الأيام المفتوحة، السعر والإكرامية الافتراضية، وآخر مسلسل ميزان، وضبط طوابع المزامنة (`addedAt` / `clearedAt` / `lastBulkImportAt`)
  const importedVisDays = [1];
  let maxImportedScale = 0;
  let lastImportedPrice = Number(appState.defaultPrice) || 0;
  let lastImportedTip = Number(appState.defaultTip) || 0;
  for (let d = 1; d <= 10; d++) {
    const dm = appState.days[d];
    if (!dm) continue;
    const dSales = dm.sales || [];
    const dPend = dm.pendingSales || [];
    const dExps = dm.expenses || [];
    const hasMov = (dSales.length > 0 || dPend.length > 0 || dExps.length > 0 || Number(dm.deliveredCash) > 0);
    if (hasMov) {
      if (!importedVisDays.includes(d)) importedVisDays.push(d);
      dm.addedAt = masterImportTs + 10;
      dm.clearedAt = 0;
      dm.isHidden = false;
    }
    [...dSales, ...dPend].forEach(s => {
      if (Number(s.scaleNo) > maxImportedScale) maxImportedScale = Number(s.scaleNo);
      if (Number(s.price) > 0) lastImportedPrice = Number(s.price);
      if (Number(s.tip) >= 0) lastImportedTip = Number(s.tip);
    });
  }

  unifyGlobalMerchantsRegistry();
  appState.farmResetAt = 0;
  appState.lastBulkImportAt = masterImportTs + 10;
  appState.visibleDays = importedVisDays.sort((a, b) => a - b);
  if (!appState.visibleDays.includes(Number(appState.currentDay))) {
    appState.currentDay = appState.visibleDays[0] || 1;
  }
  appState.lastScaleNo = maxImportedScale;
  appState.defaultPrice = lastImportedPrice;
  appState.defaultTip = lastImportedTip;
  appState.lastExcelSync = `تم التحديث من (${sourceFileName || 'شيت الإكسيل'}) الساعة ${new Date().toLocaleTimeString('ar-EG')}`;
  syncActiveFarmIntoArchive();
  // نمرر skipCloudPreMerge = false حتى يندمج تحديث الإكسيل بأمان مع طابور المزامنة السحابية الذري (Atomic Pre-Fetch Merge) دون تضارب
  saveState(true, false);
  renderAll();
  showToast(
    `تم تحديث الموقع بالكامل من الإكسيل: مزرعة (${appState.farmName}) | ${importedSalesCount} حركة بيع | ${appState.merchants.length} تاجر | ${importedExpCount} مصروف`,
    '📤'
  );
  return true;
}

// =========================================================================
// 6. EVENT LISTENERS & INTERACTIVE HANDLERS
// =========================================================================
let prevFarmsManualToggleState = {
  merchantCode: 0,
  userExplicitlySet: null // null = auto, true = user opened, false = user closed
};

function setPrevFarmsSectionExpanded(isExpanded, isManualUserAction = false) {
  const bodyEl = document.getElementById('prevFarmsCollapsibleBody');
  const cardEl = document.getElementById('prevFarmsCollectionCard');
  const gridEl = document.getElementById('saleCollectionsRow3Grid');
  const btnEl = document.getElementById('btnTogglePrevFarmsSection');
  const iconEl = document.getElementById('btnTogglePrevFarmsIcon');
  const txtEl = document.getElementById('btnTogglePrevFarmsText');
  if (!bodyEl) return;

  const expand = Boolean(isExpanded);
  bodyEl.classList.toggle('hidden', !expand);

  if (gridEl && cardEl) {
    if (expand) {
      gridEl.classList.remove('lg:grid-cols-2');
      gridEl.classList.add('lg:grid-cols-3');
      cardEl.classList.remove('lg:col-span-2');
      cardEl.classList.add('lg:col-span-1');
    } else {
      gridEl.classList.remove('lg:grid-cols-3');
      gridEl.classList.add('lg:grid-cols-2');
      cardEl.classList.remove('lg:col-span-1');
      cardEl.classList.add('lg:col-span-2');
    }
  }

  if (btnEl) {
    btnEl.setAttribute('aria-expanded', expand ? 'true' : 'false');
    btnEl.className = expand
      ? 'px-2.5 py-1 rounded-lg bg-purple-200 hover:bg-purple-300 text-purple-950 border border-purple-400 font-extrabold text-[11px] shadow-sm transition flex items-center gap-1'
      : 'px-2.5 py-1 rounded-lg bg-purple-800 hover:bg-purple-700 text-white font-extrabold text-[11px] shadow-sm transition flex items-center gap-1';
  }
  if (iconEl) iconEl.textContent = expand ? '🔼' : '➕';
  if (txtEl) txtEl.textContent = expand ? 'طيّ وإخفاء القسم' : 'فتح القسم / ملاحظات ▾';

  if (isManualUserAction) {
    const mName = (document.getElementById('inpMerchantName')?.value || '').trim();
    const mCode = resolveMerchantCode(mName);
    prevFarmsManualToggleState.merchantCode = mCode;
    prevFarmsManualToggleState.userExplicitlySet = expand;
  }
}

function resetPrevFarmsCollapsibleToDefault() {
  prevFarmsManualToggleState = { merchantCode: 0, userExplicitlySet: null };
  setPrevFarmsSectionExpanded(false, false);
}

function syncPrevFarmsCollapsibleState(info = {}) {
  const {
    mCode = 0,
    mName = '',
    hasPrevFarmInputsNow = false,
    hasArchiveReferenceDebt = false,
    crossRef = null,
    totalPrevEntered = 0,
    notesVal = ''
  } = info;

  // إذا تغير التاجر المختار، نعيد ضبط التفضيل اليدوي ليسمح بالفتح التلقائي إذا كان للتاجر الجديد مديونية في الأرشيف
  if (mCode !== prevFarmsManualToggleState.merchantCode) {
    prevFarmsManualToggleState.merchantCode = mCode;
    prevFarmsManualToggleState.userExplicitlySet = null;
  }

  const badgeEl = document.getElementById('prevFarmsCollapsedSummaryBadge');
  if (badgeEl) {
    if (totalPrevEntered > 0) {
      badgeEl.textContent = `✅ محصل مزرعة سابقة: ${fmtInt(totalPrevEntered)} ج.م${notesVal ? ` (${notesVal})` : ''}`;
      badgeEl.className = 'text-[10px] font-extrabold text-emerald-950 bg-emerald-100 border border-emerald-400 px-2 py-0.5 rounded-lg';
    } else if (hasArchiveReferenceDebt && crossRef) {
      const breakdownStr = crossRef.otherFarmsDebts.map(x => `${x.farmName}: ${fmtInt(x.debt)}`).join(' | ');
      badgeEl.textContent = `📌 مديونية أرشيف سابقة (${breakdownStr || fmtInt(crossRef.totalOtherFarmsDebt)} ج.م) — فُتح تلقائياً`;
      badgeEl.className = 'text-[10px] font-extrabold text-amber-950 bg-amber-200 border border-amber-500 px-2 py-0.5 rounded-lg animate-pulse';
    } else if (notesVal) {
      badgeEl.textContent = `📝 ملاحظة: ${notesVal}`;
      badgeEl.className = 'text-[10px] font-extrabold text-purple-950 bg-purple-200 border border-purple-400 px-2 py-0.5 rounded-lg';
    } else {
      badgeEl.textContent = 'مطوي افتراضياً — يفتح بضغطة زر أو تلقائياً عند وجود مديونية بالأرشيف';
      badgeEl.className = 'text-[10px] font-extrabold text-purple-800 bg-purple-100 border border-purple-200 px-2 py-0.5 rounded-lg';
    }
  }

  // قواعد الفتح والطيّ التلقائي:
  // 1) إذا كانت هناك قيم مدخلة بالفعل في حقول المزارع السابقة/الملاحظات -> نفتح القسم دائماً حتى لا تختفي بيانات مدخلة
  if (hasPrevFarmInputsNow) {
    setPrevFarmsSectionExpanded(true, false);
    return;
  }
  // 2) إذا قام المستخدم يدوياً بفتح أو طيّ القسم لهذا التاجر -> نحترم اختياره اليدوي
  if (prevFarmsManualToggleState.userExplicitlySet !== null) {
    setPrevFarmsSectionExpanded(prevFarmsManualToggleState.userExplicitlySet, false);
    return;
  }
  // 3) إذا كان للتاجر مديونية مرجعية في أرشيف المزارع السابقة -> يفتح القسم تلقائياً! وإلا يظل مطوياً افتراضياً لتقليل طول الشاشة
  setPrevFarmsSectionExpanded(hasArchiveReferenceDebt, false);
}

// =========================================================================
// DEBT-COLLECTION-ONLY MODE ENGINE (وضع سند تحصيل مديونية فقط بدون ميزان — v51)
// =========================================================================
let activeSaleEntryMode = 'sale'; // 'sale' | 'debt_only'

function isDebtCollectionOnlyMode() {
  return activeSaleEntryMode === 'debt_only';
}

function setSaleEntryMode(mode = 'sale', options = {}) {
  const { clearWeightFields = true, focusMerchantOrDebt = false, showModeToast = false } = options;
  activeSaleEntryMode = (mode === 'debt_only') ? 'debt_only' : 'sale';
  const isDebtOnly = (activeSaleEntryMode === 'debt_only');

  const inpModeEl = document.getElementById('inpSaleEntryMode');
  if (inpModeEl) inpModeEl.value = activeSaleEntryMode;

  // 1. Toggle Header Buttons & Title Styling
  const btnScale = document.getElementById('btnModeScaleSale');
  const btnDebt = document.getElementById('btnModeDebtCollectionOnly');
  const hdrEl = document.getElementById('saleFormCardHeader');
  const hdrIcon = document.getElementById('saleFormHeaderIcon');
  const titleActTxt = document.getElementById('saleFormTitleActionText');
  const debtBanner = document.getElementById('debtCollectionOnlyModeBanner');

  if (btnScale && btnDebt) {
    if (isDebtOnly) {
      btnDebt.className = 'px-2.5 py-1 rounded-lg bg-emerald-400 text-slate-950 font-extrabold text-xs shadow transition flex items-center gap-1';
      btnScale.className = 'px-2.5 py-1 rounded-lg text-slate-200 hover:bg-white/10 font-extrabold text-xs transition flex items-center gap-1';
    } else {
      btnScale.className = 'px-2.5 py-1 rounded-lg bg-amber-400 text-slate-950 font-extrabold text-xs shadow transition flex items-center gap-1';
      btnDebt.className = 'px-2.5 py-1 rounded-lg text-slate-200 hover:bg-white/10 font-extrabold text-xs transition flex items-center gap-1';
    }
  }
  if (hdrEl) {
    hdrEl.className = isDebtOnly
      ? 'bg-teal-950 text-white px-4 py-2.5 rounded-t-2xl flex flex-wrap items-center justify-between gap-2 border-b-2 border-teal-400'
      : 'navy-gradient text-white px-4 py-2.5 rounded-t-2xl flex flex-wrap items-center justify-between gap-2';
  }
  if (hdrIcon) hdrIcon.textContent = isDebtOnly ? '💵' : '🚛';
  if (titleActTxt) {
    titleActTxt.textContent = isDebtOnly
      ? 'سند تحصيل مديونية فقط — بدون ميزان'
      : 'تسجيل حركة بيع / تحصيل جديدة';
  }
  if (debtBanner) {
    debtBanner.classList.toggle('hidden', !isDebtOnly);
  }

  // 2. Hide/Show Row 2 (Weights w1, w2, Price, Tip) and Car No / Scale Labels
  const weightsRow = document.getElementById('saleWeightsAndPriceRow');
  if (weightsRow) {
    weightsRow.classList.toggle('hidden', isDebtOnly);
  }
  const lblScaleNo = document.getElementById('lblScaleOrVoucherNo');
  if (lblScaleNo) {
    lblScaleNo.innerHTML = isDebtOnly
      ? 'رقم السند <span class="text-teal-700 font-normal">(متسلسل تلقائي)</span>'
      : 'ميزان رقم <span class="text-emerald-700 font-normal">(متسلسل تلقائي)</span>';
  }
  const lblCarNo = document.getElementById('lblCarNoField');
  if (lblCarNo) {
    lblCarNo.innerHTML = isDebtOnly
      ? 'رقم السيارة <span class="text-slate-400 font-normal">(اختياري)</span>'
      : 'رقم السيارة';
  }

  // 3. Adapt Blue Live KPI Banner & Hide Group 1 (سداد فاتورة اليوم) in Debt-Only Mode
  ['kpiBoxNetWeight', 'kpiBoxTotalWithTip', 'kpiBoxInvoiceDiff'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('hidden', isDebtOnly);
  });
  const liveBannerGrid = document.getElementById('saleLiveCalcBannerGrid');
  if (liveBannerGrid) {
    liveBannerGrid.className = isDebtOnly
      ? 'grid grid-cols-1 sm:grid-cols-2 gap-2 bg-teal-950 text-white p-2.5 rounded-xl text-center'
      : 'grid grid-cols-2 sm:grid-cols-5 gap-2 bg-blue-950 text-white p-2.5 rounded-xl text-center';
  }

  const grp1Card = document.getElementById('currentInvoiceCollectionCard');
  if (grp1Card) {
    grp1Card.classList.toggle('hidden', isDebtOnly);
  }
  const grp2Card = document.getElementById('currentDebtCollectionCard');
  if (grp2Card) {
    grp2Card.className = isDebtOnly
      ? 'lg:col-span-2 border-2 border-teal-600 bg-teal-50/80 rounded-xl p-3 space-y-2 shadow-sm'
      : 'border-2 border-teal-800/20 bg-teal-50/40 rounded-xl p-2.5 space-y-2';
  }

  // 4. Hide "⏳ حفظ مؤقت وزنة 1" & "⚡ باقي الفاتورة آجل" buttons when in Debt-Only Mode
  ['btnSavePendingW1', 'btnInlineSavePendingW1', 'btnStickyAutoCredit'].forEach(btnId => {
    const b = document.getElementById(btnId);
    if (b) b.classList.toggle('hidden', isDebtOnly);
  });

  // 5. Clear weight & current-day invoice fields when switching to Debt-Only Mode
  if (isDebtOnly && clearWeightFields) {
    ['inpW1', 'inpW2', 'inpPrice', 'inpTip', 'inpCashSales', 'inpTransferSales', 'inpCreditSales'].forEach(fid => {
      const inp = document.getElementById(fid);
      if (inp) inp.value = '';
    });
    const selTrS = document.getElementById('selTransferSalesType');
    if (selTrS) selTrS.value = '';
    const wAlert = document.getElementById('weightValidationAlert');
    if (wAlert) wAlert.classList.add('hidden');
  } else if (!isDebtOnly && clearWeightFields) {
    applyStickySaleDefaults();
  }

  // Update Save Button Label according to mode & edit state
  const editIdVal = document.getElementById('editSaleId')?.value || '';
  const s1 = document.getElementById('btnSaveSaleText');
  const s2 = document.getElementById('btnInlineSaveSaleText');
  if (!editIdVal && !activeRecalledPendingId) {
    const defaultSaveLbl = isDebtOnly ? 'حفظ سند التحصيل 💵' : 'حفظ نهائي';
    if (s1) s1.textContent = defaultSaveLbl;
    if (s2) s2.textContent = defaultSaveLbl;
  }

  updateLiveFormCalculation();

  if (focusMerchantOrDebt) {
    const mName = (document.getElementById('inpMerchantName')?.value || '').trim();
    const targetFocusId = mName ? (isDebtOnly ? 'inpDebtCash' : 'inpW1') : 'inpMerchantName';
    const targetEl = document.getElementById(targetFocusId);
    if (targetEl) {
      setTimeout(() => {
        targetEl.focus();
        if (typeof targetEl.select === 'function') {
          try { targetEl.select(); } catch (e) {}
        }
      }, 40);
    }
  }

  if (showModeToast) {
    showToast(
      isDebtOnly
        ? '💵 تم تفعيل وضع (سند تحصيل مديونية فقط بدون ميزان) — أدخل التاجر والمبلغ المسدد نقداً أو تحويلاً واضغط حفظ السند!'
        : '🚛 تم التبديل إلى وضع (حركة ميزان وبيع سيارة) وإظهار حقول الأوزان والسعر والإكرامية.',
      isDebtOnly ? '💵' : '🚛'
    );
  }
}

function updateLiveFormCalculation() {
  const rawW1 = document.getElementById('inpW1').value;
  const rawW2 = document.getElementById('inpW2').value;
  const w1 = Math.max(0, parseNum(rawW1));
  const w2 = Math.max(0, parseNum(rawW2));
  const price = parseNum(document.getElementById('inpPrice').value) || 0;
  const tip = parseNum(document.getElementById('inpTip').value) || 0;

  // التحقق من أن الوزنة الثانية أكبر من أو تساوي الوزنة الأولى
  const hasInvalidWeight = (rawW2 !== '' && w2 < w1);
  const wAlert = document.getElementById('weightValidationAlert');
  const inpW2El = document.getElementById('inpW2');
  if (wAlert) wAlert.classList.toggle('hidden', !hasInvalidWeight);
  if (inpW2El) {
    inpW2El.classList.toggle('border-rose-600', hasInvalidWeight);
    inpW2El.classList.toggle('bg-rose-50', hasInvalidWeight);
  }

  const netW = (!hasInvalidWeight && w2 >= w1 && w2 > 0) ? (w2 - w1) : 0;
  const totalWithTip = (netW * price) + tip;

  // Invoice collections (not linked to Custody)
  const cashS = parseNum(document.getElementById('inpCashSales').value) || 0;
  const trS = parseNum(document.getElementById('inpTransferSales').value) || 0;
  const credS = parseNum(document.getElementById('inpCreditSales').value) || 0;
  const diff = (cashS + trS + credS) - totalWithTip;

  document.getElementById('calcNetWeight').textContent = `${fmtInt(netW)} كجم`;
  document.getElementById('calcTotalWithTip').textContent = `${fmtDec(totalWithTip)} ج.م`;
  document.getElementById('calcInvoiceDiff').textContent = `${fmtDec(diff)} ج.م`;

  // تحديث شريط الإجراءات السفلي العائم للموبايل (Mobile Weighbridge Sticky Action Bar)
  const stickyNetEl = document.getElementById('stickyBarNetWeight');
  if (stickyNetEl) stickyNetEl.textContent = `${fmtInt(netW)} كجم`;
  const stickyTotEl = document.getElementById('stickyBarTotalInvoice');
  if (stickyTotEl) stickyTotEl.textContent = `${fmtDec(totalWithTip)} ج.م`;
  const stickyRemEl = document.getElementById('stickyBarRemCredit');
  if (stickyRemEl) {
    const remCreditPreview = Math.max(0, Math.round(totalWithTip - cashS - trS));
    stickyRemEl.textContent = `${fmtInt(remCreditPreview)} ج.م`;
  }

  // 1. Previous Debt Statement in Current Farm for Selected Merchant (e.g., محمود مدني -> 159,120 ج.م)
  const mName = (document.getElementById('inpMerchantName').value || '').trim();
  const editId = document.getElementById('editSaleId').value || '';
  const mCode = resolveMerchantCode(mName);
  const prevDebt = mCode > 0 ? computeMerchantCurrentDebtExcluding(mCode, editId) : 0;

  const debtCash = parseNum(document.getElementById('inpDebtCash').value) || 0;
  const debtTr = parseNum(document.getElementById('inpDebtTransfer').value) || 0;
  const deductedDebtNow = debtCash + debtTr;

  const prevDebtEl = document.getElementById('calcPrevMerchantDebt');
  const prevDebtSubEl = document.getElementById('calcPrevMerchantDebtSub');
  if (prevDebtEl && prevDebtSubEl) {
    if (!mName) {
      prevDebtEl.textContent = '0 ج.م';
      prevDebtSubEl.textContent = 'اختر التاجر لعرض مديونيته السابقة';
    } else {
      prevDebtEl.textContent = `${fmtInt(prevDebt)} ج.م`;
      const afterColl = prevDebt - deductedDebtNow + credS;
      prevDebtSubEl.textContent = deductedDebtNow > 0 || credS > 0
        ? `بعد تحصيل اليوم (${fmtInt(deductedDebtNow)}): ${fmtInt(afterColl)} ج.م`
        : `إجمالي مديونية (${mName}) بالمزرعة الحالية`;
    }
  }

  // 2. Smart Custody Waterfall & Unified Collection Statement:
  //    التوزيع التلقائي المتدرج للعهدة: (1) سداد المديونية السابقة أولاً ⬅️ (2) سداد فاتورة اليوم ⬅️ (3) حساب الآجل أو فائض العهدة
  const custCash = parseNum(document.getElementById('inpCustodyCash') ? document.getElementById('inpCustodyCash').value : 0) || 0;
  const custTr = parseNum(document.getElementById('inpCustodyTransfer') ? document.getElementById('inpCustodyTransfer').value : 0) || 0;
  const custTrType = document.getElementById('selCustodyTransferType') ? document.getElementById('selCustodyTransferType').value : '';
  const totalCustody = custCash + custTr;
  const paidToInvoiceNow = cashS + trS;
  const totalUsedFromCustody = deductedDebtNow + paidToInvoiceNow;
  const custodyAfterDebt = Math.max(0, totalCustody - deductedDebtNow);
  const remainingCustody = totalCustody > 0 ? (totalCustody - totalUsedFromCustody) : 0;

  const lblTotCust = document.getElementById('lblTotalCustodyEntered');
  const lblToDebt = document.getElementById('lblCustodyToDebt');
  const lblAfterDebt = document.getElementById('lblCustodyAfterDebt');
  const lblToInv = document.getElementById('lblCustodyToInvoice');
  const lblNetCust = document.getElementById('lblNetCustodyRemaining');
  const lblNetCustTitle = document.getElementById('lblNetCustodyRemainingTitle');
  const btnDepositSurplus = document.getElementById('btnDepositCustodySurplusToAccount');
  const btnStickyDistCust = document.getElementById('btnStickyDistributeCustody');

  if (lblTotCust) lblTotCust.textContent = fmtInt(totalCustody);
  if (lblToDebt) lblToDebt.textContent = fmtInt(deductedDebtNow);
  if (lblAfterDebt) lblAfterDebt.textContent = fmtInt(custodyAfterDebt);
  if (lblToInv) lblToInv.textContent = fmtInt(paidToInvoiceNow);
  if (lblNetCust) {
    lblNetCust.textContent = fmtInt(Math.max(0, remainingCustody));
  }
  if (lblNetCustTitle) {
    if (totalCustody > 0 && w2 > 0 && remainingCustody > 0) {
      lblNetCustTitle.textContent = '3️⃣ فائض العهدة المتبقي:';
    } else if (totalCustody > 0 && w2 === 0) {
      lblNetCustTitle.textContent = '3️⃣ متاح لوزنة 2:';
    } else {
      lblNetCustTitle.textContent = '3️⃣ متبقي العهدة:';
    }
  }
  if (btnDepositSurplus) {
    const hasPositiveSurplusAfterInvoice = (totalCustody > 0 && w2 >= w1 && w2 > 0 && remainingCustody >= 1);
    btnDepositSurplus.classList.toggle('hidden', !hasPositiveSurplusAfterInvoice);
    btnDepositSurplus.classList.toggle('inline-flex', hasPositiveSurplusAfterInvoice);
  }
  if (btnStickyDistCust) {
    btnStickyDistCust.classList.toggle('hidden', totalCustody <= 0);
    btnStickyDistCust.classList.toggle('inline-flex', totalCustody > 0);
  }

  const balEl = document.getElementById('calcMerchantBalance');
  const subEl = document.getElementById('calcMerchantBalanceSub');
  if (balEl && subEl) {
    if (totalCustody > 0) {
      balEl.textContent = remainingCustody > 0 ? `فائض: ${fmtInt(remainingCustody)} ج.م` : `موزعة بالكامل ✓`;
      subEl.textContent = `عهدة (${fmtInt(totalCustody)}) ⬅️ مديونية (${fmtInt(deductedDebtNow)}) + فاتورة (${fmtInt(paidToInvoiceNow)})`;
    } else {
      balEl.textContent = `0 ج.م`;
      subEl.textContent = `أدخل العهدة للتوزيع التلقائي على المديونية والفاتورة`;
    }
  }

  // 3. الربط المرجعي الذكي لتحصيلات المزارع السابقة + الطيّ والفتح التلقائي الذكي للقسم (Collapsible Section 3)
  const prevCashVal = parseNum(document.getElementById('inpPrevCash') ? document.getElementById('inpPrevCash').value : 0) || 0;
  const prevTrVal = parseNum(document.getElementById('inpPrevTransfer') ? document.getElementById('inpPrevTransfer').value : 0) || 0;
  const prevTrTypeVal = document.getElementById('selPrevTransferType') ? document.getElementById('selPrevTransferType').value : '';
  const notesVal = (document.getElementById('inpNotes') ? document.getElementById('inpNotes').value : '').trim();
  const totalPrevEntered = prevCashVal + prevTrVal;

  const crossRef = computeMerchantCrossFarmDebtReference(mCode, notesVal);
  const hasPrevFarmInputsNow = (totalPrevEntered > 0 || notesVal !== '' || prevTrTypeVal !== '');
  const hasArchiveReferenceDebt = Boolean(
    mCode > 0 && (
      crossRef.otherFarmsDebts.length > 0 ||
      Math.abs(crossRef.totalOtherFarmsDebt) > 0.01 ||
      (crossRef.matchedFarmName && Math.abs(crossRef.matchedFarmDebt) > 0.01)
    )
  );

  // تحديث شارة الملخص في رأس القسم المطوي وفتح القسم تلقائياً إذا كان للتاجر مديونية مرجعية في الأرشيف أو قيم مدخلة
  if (typeof syncPrevFarmsCollapsibleState === 'function') {
    syncPrevFarmsCollapsibleState({
      mCode,
      mName,
      hasPrevFarmInputsNow,
      hasArchiveReferenceDebt,
      crossRef,
      totalPrevEntered,
      notesVal
    });
  }
  const refBox = document.getElementById('crossFarmDebtRefBox');
  const refLbl = document.getElementById('crossFarmDebtRefLabel');
  const refVal = document.getElementById('crossFarmDebtRefValue');
  if (refBox && refLbl && refVal) {
    if (!mName || mCode <= 0) {
      refBox.className = 'mt-1 px-2.5 py-1.5 rounded-lg bg-purple-100/90 border border-purple-300 text-[11px] font-extrabold text-purple-950 flex items-center justify-between gap-1.5 flex-wrap';
      refLbl.textContent = '🔎 مرجع أرشيف المزارع السابقة: اختر التاجر واسم المزرعة السابقة لعرض رصيده المرجعي';
      refVal.textContent = 'مرجع استرشادي فقط';
    } else if (crossRef.matchedFarmName) {
      const remRef = crossRef.matchedFarmDebt - totalPrevEntered;
      refBox.className = 'mt-1 px-2.5 py-1.5 rounded-lg bg-purple-200/90 border-2 border-purple-500 text-[11px] font-extrabold text-purple-950 flex items-center justify-between gap-1.5 flex-wrap';
      refLbl.textContent = `📌 المديونية المرجعية للتاجر (${mName}) في مزرعة [${crossRef.matchedFarmName}]: ${fmtInt(crossRef.matchedFarmDebt)} ج.م`;
      refVal.textContent = totalPrevEntered > 0
        ? `المحصل الآن: ${fmtInt(totalPrevEntered)} | المتبقي مرجعياً: ${fmtInt(remRef)} ج.م`
        : `الرصيد بالأرشيف: ${fmtInt(crossRef.matchedFarmDebt)} ج.م`;
    } else if (crossRef.otherFarmsDebts.length > 0) {
      const breakdownStr = crossRef.otherFarmsDebts.map(x => `${x.farmName}: ${fmtInt(x.debt)}`).join(' | ');
      refBox.className = 'mt-1 px-2.5 py-1.5 rounded-lg bg-amber-100/90 border border-amber-400 text-[11px] font-extrabold text-amber-950 flex items-center justify-between gap-1.5 flex-wrap';
      refLbl.textContent = `📌 مديونيات مرجعية للتاجر (${mName}) في الأرشيف: (${breakdownStr}) ج.م`;
      refVal.textContent = `إجمالي أرشيف سابق: ${fmtInt(crossRef.totalOtherFarmsDebt)} ج.م`;
    } else {
      refBox.className = 'mt-1 px-2.5 py-1.5 rounded-lg bg-emerald-50 border border-emerald-300 text-[11px] font-extrabold text-emerald-950 flex items-center justify-between gap-1.5 flex-wrap';
      refLbl.textContent = `✅ لا توجد مديونية مسجلة للتاجر (${mName}) في أرشيف المزارع الأخرى المحفوظة`;
      refVal.textContent = 'رصيد الأرشيف: 0 ج.م';
    }
  }

  // 4. تنبيهات الرقابة الذكية والقيود الاسترشادية الفورية غير المانعة (Smart Non-Blocking Audit Alerts)
  const alerts = [];
  const trSalesTypeVal = document.getElementById('selTransferSalesType') ? document.getElementById('selTransferSalesType').value : '';
  const debtTrTypeVal = document.getElementById('selDebtTransferType') ? document.getElementById('selDebtTransferType').value : '';

  // أ) تنبيه فرق مطابقة فاتورة اليوم
  if (w2 > 0 && !hasInvalidWeight && totalWithTip > 0 && (cashS > 0 || trS > 0 || credS > 0) && Math.abs(diff) > 1) {
    alerts.push({
      level: 'warn',
      icon: '⚖️',
      text: `تنبيه مطابقة الفاتورة: مجموع (نقدي المبيعات + التحويل + الآجل = ${fmtDec(cashS + trS + credS)} ج.م) يختلف عن إجمالي الفاتورة بالإكرامية (${fmtDec(totalWithTip)} ج.م) بفرق (${fmtDec(diff)} ج.م). اضغط "⚡ باقي الفاتورة آجل" للمطابقة التلقائية.`
    });
  } else if (w2 > 0 && !hasInvalidWeight && totalWithTip > 0 && cashS === 0 && trS === 0 && credS === 0) {
    alerts.push({
      level: 'info',
      icon: '💡',
      text: `تذكير استرشادي: لم يتم توزيع طريقة سداد الفاتورة (${fmtDec(totalWithTip)} ج.م) بعد بين (نقدي مبيعات / تحويل / آجل اليوم).`
    });
  }

  // ب) تنبيه تجاوز سداد المديونية لرصيد مديونية المزرعة الحالية
  if (mName && deductedDebtNow > 0 && deductedDebtNow > (prevDebt + 1)) {
    alerts.push({
      level: 'warn',
      icon: '⚠️',
      text: `تنبيه سداد المديونية: المبلغ المدخل في تحصيل مديونيات المزرعة الحالية (${fmtInt(deductedDebtNow)} ج.م) أكبر من رصيد مديونية التاجر المسجل حالياً بالمزرعة (${fmtInt(prevDebt)} ج.م)! إذا كان المبلغ يخص مزرعة أخرى ضعه في قسم (3. تحصيلات مزارع سابقة).`
    });
  }

  // ج) تنبيه فائض العهدة أو تجاوز الموزع لإجمالي العهدة
  if (totalCustody > 0 && (deductedDebtNow + cashS + trS) > (totalCustody + 1)) {
    alerts.push({
      level: 'warn',
      icon: '💼',
      text: `تنبيه رصيد العهدة: إجمالي المبالغ المسددة بالأسفل (مديونية ${fmtInt(deductedDebtNow)} + مبيعات ${fmtInt(cashS + trS)} = ${fmtInt(deductedDebtNow + cashS + trS)} ج.م) أكبر من إجمالي العهدة المدخلة (${fmtInt(totalCustody)} ج.م). اضغط "⚡ توزيع العهدة تلقائياً" لضبط التوزيع.`
    });
  } else if (totalCustody > 0 && w2 >= w1 && w2 > 0 && remainingCustody >= 1) {
    alerts.push({
      level: 'info',
      icon: '💼',
      text: `فائض عهدة للتاجر (${fmtInt(remainingCustody)} ج.م) بعد سداد المديونية السابقة (${fmtInt(deductedDebtNow)} ج.م) وفاتورة اليوم (${fmtInt(cashS + trS)} ج.م): إذا ترك السائق الفائض بالخزنة تحت الحساب اضغط زر (📥 إيداع الفائض بالخزنة)، أو اتركه كما هو إذا استرد السائق الفائض نقداً.`
    });
  }

  // د) تنبيهات عدم اختيار نوع التحويل عند إدخال مبلغ تحويل
  if (trS > 0 && !trSalesTypeVal) {
    alerts.push({
      level: 'warn',
      icon: '💳',
      text: `تنبيه نوع التحويل: تم إدخال تحويل مبيعات بقيمة (${fmtInt(trS)} ج.م) بدون تحديد (نوع تحويل المبيعات: كاش / بنكي / إنستا / شيك).`
    });
  }
  if (debtTr > 0 && !debtTrTypeVal) {
    alerts.push({
      level: 'warn',
      icon: '💳',
      text: `تنبيه نوع التحويل: تم إدخال تحويل سداد مديونية بقيمة (${fmtInt(debtTr)} ج.م) بدون تحديد (نوع تحويل المديونية).`
    });
  }
  if (prevTrVal > 0 && !prevTrTypeVal) {
    alerts.push({
      level: 'warn',
      icon: '💳',
      text: `تنبيه نوع التحويل: تم إدخال تحويل مزارع سابقة بقيمة (${fmtInt(prevTrVal)} ج.م) بدون تحديد (نوع تحويل السابقة).`
    });
  }
  if (custTr > 0 && !custTrType) {
    alerts.push({
      level: 'warn',
      icon: '💼',
      text: `تنبيه نوع تحويل العهدة: تم إدخال عهدة تحويل بقيمة (${fmtInt(custTr)} ج.م) بدون تحديد (نوع تحويل العهدة).`
    });
  }

  // هـ) تنبيهات المزارع السابقة (عدم كتابة اسم المزرعة السابقة أو تجاوز المديونية المرجعية بالأرشيف)
  if (totalPrevEntered > 0 && !notesVal) {
    alerts.push({
      level: 'warn',
      icon: '🏦',
      text: `تنبيه المزارع السابقة: تم إدخال تحصيل مزارع سابقة (${fmtInt(totalPrevEntered)} ج.م) — يُرجى كتابة أو اختيار (اسم المزرعة السابقة) في حقل الملاحظات لتوثيقها في بيان المزارع السابقة.`
    });
  }
  if (totalPrevEntered > 0 && crossRef.matchedFarmName && totalPrevEntered > (crossRef.matchedFarmDebt + 1)) {
    alerts.push({
      level: 'warn',
      icon: '🔎',
      text: `ملاحظة رقابية مرجعية: المبلغ المحصل للمزرعة السابقة [${crossRef.matchedFarmName}] (${fmtInt(totalPrevEntered)} ج.م) أكبر من المديونية المرجعية المسجلة للتاجر في أرشيف تلك المزرعة (${fmtInt(crossRef.matchedFarmDebt)} ج.م).`
    });
  }

  // و) تنبيه انحراف السعر عن السعر الافتراضي لليوم بأكثر من 15%
  const defP = Number(appState.defaultPrice) || 0;
  if (price > 0 && defP > 0 && Math.abs(price - defP) / defP > 0.15) {
    alerts.push({
      level: 'info',
      icon: '📊',
      text: `ملاحظة سعرية: السعر المدخل (${fmtDec(price)} ج.م) يختلف بأكثر من 15% عن آخر سعر افتراضي مسجل باليوم (${fmtDec(defP)} ج.م).`
    });
  }

  const alertsBox = document.getElementById('smartAuditAlertsBox');
  const alertsList = document.getElementById('smartAuditAlertsList');
  const alertsBadge = document.getElementById('smartAuditAlertsCountBadge');
  if (alertsBox && alertsList && alertsBadge) {
    if (alerts.length === 0) {
      alertsBox.classList.add('hidden');
      alertsList.innerHTML = '';
    } else {
      alertsBox.classList.remove('hidden');
      alertsBadge.textContent = `${alerts.length} تنبيه استرشادي`;
      alertsList.innerHTML = alerts.map(a => `
        <div class="px-2.5 py-1.5 rounded-lg border flex items-start gap-1.5 ${a.level === 'warn' ? 'bg-amber-100/90 border-amber-400 text-amber-950' : 'bg-blue-50 border-blue-300 text-blue-950'}">
          <span>${a.icon}</span>
          <span>${escXmlStr(a.text)}</span>
        </div>
      `).join('');
    }
  }
}

function initFarmSalesApp() {
  if (window.__farmAppInitialized) return;
  window.__farmAppInitialized = true;
  const loadedFromLocal = loadState();
  unifyGlobalMerchantsRegistry();
  renderAll(true);
  if (!loadedFromLocal) {
    loadFromIndexedDBAsync().then((idbState) => {
      const wasLoggedInNow = Boolean(appState.isLoggedIn);
      const currentActiveUser = appState.activeUserId;
      if (!appState.hasLocalEdits && idbState && applyParsedStateObject(idbState)) {
        if (wasLoggedInNow) {
          appState.isLoggedIn = true;
          appState.activeUserId = currentActiveUser || 'admin';
          appState.lastActivityAt = Date.now();
        }
        renderAll();
      }
      if ((appState.webhookUrl || getEmbeddedWebhookUrl()) && navigator.onLine) {
        pullDatabaseFromCloud(true, true);
      }
      window.buildEmbeddedGoogleSitesHtml = buildEmbeddedGoogleSitesHtml;
  startLiveRealtimeSyncEngine();
    }).catch(() => {
      if ((appState.webhookUrl || getEmbeddedWebhookUrl()) && navigator.onLine) {
        pullDatabaseFromCloud(true, true);
      }
      startLiveRealtimeSyncEngine();
    });
  } else {
    if ((appState.webhookUrl || getEmbeddedWebhookUrl()) && navigator.onLine) {
      pullDatabaseFromCloud(true, true);
    }
    startLiveRealtimeSyncEngine();
  }

  // Toggle Live Sync from Header Button
  const btnToggleLive = document.getElementById('btnToggleLiveSync');
  if (btnToggleLive) {
    btnToggleLive.addEventListener('click', () => {
      appState.liveSyncEnabled = !appState.liveSyncEnabled;
      saveState(false);
      startLiveRealtimeSyncEngine();
      if (appState.liveSyncEnabled) {
        if ((appState.webhookUrl || getEmbeddedWebhookUrl()) && navigator.onLine) {
          pullDatabaseFromCloud(true, true, true);
        }
        showToast(`⚡ تم تفعيل المزامنة اللحظية الحية (كل ${appState.liveSyncIntervalSec || 5} ثوانٍ)`, '⚡');
      } else {
        showToast('⏸️ تم إيقاف المزامنة الدورية التلقائية — ستستمر المزامنة عند الحفظ أو الضغط اليدوي.', '⏸️');
      }
    });
  }

  // Toggle & Interval Select from Sync Settings Card
  const chkLive = document.getElementById('chkEnableLiveSync');
  if (chkLive) {
    chkLive.addEventListener('change', (e) => {
      appState.liveSyncEnabled = e.target.checked;
      saveState(false);
      startLiveRealtimeSyncEngine();
      showToast(appState.liveSyncEnabled ? '⚡ تم تفعيل المزامنة اللحظية الحية' : '⏸️ تم إيقاف المزامنة اللحظية الحية');
    });
  }

  const selInterval = document.getElementById('selLiveSyncInterval');
  if (selInterval) {
    selInterval.addEventListener('change', (e) => {
      appState.liveSyncIntervalSec = Number(e.target.value) || 5;
      saveState(false);
      startLiveRealtimeSyncEngine();
      showToast(`⚡ تم ضبط سرعة المزامنة اللحظية الحية إلى كل (${appState.liveSyncIntervalSec}) ثوانٍ`);
    });
  }

  // Cross-Tab & Same-Browser Instant Sync + Immediate Forced Logout when User Deleted
  if (liveBroadcastChannel) {
    liveBroadcastChannel.onmessage = (evt) => {
      try {
        const msg = evt.data || {};
        if (msg.type === 'USER_DELETED' || msg.type === 'LOCAL_STATE_CHANGED' || msg.type === 'STATE_UPDATED') {
          const raw = localStorage.getItem(STORAGE_KEY);
          if (raw) {
            const parsed = JSON.parse(raw);
            mergeCloudDataIntoLocal(parsed, !(Number(appState.pendingChanges) > 0));
            if (verifyActiveUserSession()) {
              renderAllPreservingActiveInputs();
            }
          }
        }
      } catch (err) {}
    };
  }

  window.addEventListener('storage', (evt) => {
    if (evt.key === STORAGE_KEY && evt.newValue) {
      try {
        const parsed = JSON.parse(evt.newValue);
        mergeCloudDataIntoLocal(parsed, !(Number(appState.pendingChanges) > 0));
        if (verifyActiveUserSession()) {
          renderAllPreservingActiveInputs();
        }
      } catch (err) {}
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && appState.liveSyncEnabled && navigator.onLine && (appState.webhookUrl || getEmbeddedWebhookUrl())) {
      pullDatabaseFromCloud(true, true, true);
    }
  });
        // PWA Install Prompt Handler (زر تثبيت التطبيق المباشر على الموبايل والكمبيوتر)
  let deferredPwaPrompt = null;
  const btnInstallPwa = document.getElementById("btnInstallPwaApp");
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPwaPrompt = e;
    if (btnInstallPwa) btnInstallPwa.classList.remove("hidden");
  });
  if (btnInstallPwa) {
    btnInstallPwa.addEventListener("click", async () => {
      if (!deferredPwaPrompt) {
        showToast("التطبيق مثبت بالفعل أو يمكنك اختيار (تثبيت التطبيق / الإضافة للشاشة الرئيسية) من قائمة متصفح كروم 📲", "ℹ️");
        return;
      }
      deferredPwaPrompt.prompt();
      const { outcome } = await deferredPwaPrompt.userChoice;
      if (outcome === "accepted") {
        btnInstallPwa.classList.add("hidden");
        showToast("✅ جاري تثبيت تطبيق مبيعات المزرعة على شاشاتك الرئيسية!", "📲");
      }
      deferredPwaPrompt = null;
    });
  }
  window.addEventListener("appinstalled", () => {
    if (btnInstallPwa) btnInstallPwa.classList.add("hidden");
    deferredPwaPrompt = null;
  });
  // Force app hard reload & clear service worker caches
  async function forceAppHardReload() {
    showToast('جاري تحديث التطبيق ومسح الكاش القديم...', '⏳');
    try {
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map(k => caches.delete(k)));
      }
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        for (const r of regs) {
          await r.update();
        }
      }
    } catch (e) {}
    setTimeout(() => {
      window.location.reload();
    }, 350);
  }

  const btnDropUpdate = document.getElementById('btnDropdownForceUpdate');
  if (btnDropUpdate) btnDropUpdate.addEventListener('click', forceAppHardReload);
  const btnQuickUpdate = document.getElementById('btnQuickForceUpdate');
  if (btnQuickUpdate) btnQuickUpdate.addEventListener('click', forceAppHardReload);

  // Auto-purge legacy Service Worker caches (v25/v26) so updated print styles & scripts apply immediately
  try {
    if ('caches' in window) {
      caches.keys().then(keys => {
        keys.forEach(k => {
          if (k !== 'farm-sales-committee-v60-login-syntax-hotfix') {
            caches.delete(k).catch(() => {});
          }
        });
      }).catch(() => {});
    }
  } catch (e) {}

  // Register Offline Service Worker with auto-update detection
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('./sw.js').then((reg) => {
      // Immediately check for updates whenever the app is opened
      reg.update().catch(() => {});
      reg.addEventListener('updatefound', () => {
        const newWorker = reg.installing;
        if (newWorker) {
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              showToast('🚀 يتوفر تحديث جديد للتطبيق! جاري التحديث التلقائي...', '🔄');
              newWorker.postMessage({ type: 'SKIP_WAITING' });
            }
          });
        }
      });
    }).catch(() => {});

    let isRefreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!isRefreshing) {
        isRefreshing = true;
        window.location.reload();
      }
    });
  }

  // 1. إلغاء تغيير القيم ببكرة الفأرة (Mouse Wheel) ومفاتيح الأسهم على جميع خانات الإدخال الرقمية والمالية
  document.addEventListener('wheel', (e) => {
    const ae = document.activeElement;
    if (ae && ae.tagName === 'INPUT' && (ae.type === 'number' || ae.hasAttribute('data-money-input'))) {
      e.preventDefault();
    }
  }, { passive: false });

  document.querySelectorAll('input[type="number"], input[data-money-input="1"]').forEach(inp => {
    inp.addEventListener('wheel', (e) => e.preventDefault(), { passive: false });
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
      }
    });
  });

  // تنسيق الفلوس والأرقام في جميع الإدخالات (502,698.80 مع إخفاء العلامة العشرية عند عدم وجودها)
  document.querySelectorAll('input[data-money-input="1"]').forEach(inp => {
    inp.addEventListener('input', (e) => {
      const formatted = formatLiveMoneyInputString(e.target.value);
      if (e.target.value !== formatted) {
        e.target.value = formatted;
      }
      updateLiveFormCalculation();
    });
    inp.addEventListener('blur', (e) => {
      const val = parseNum(e.target.value);
      e.target.value = val > 0 ? fmtMoney(val) : (e.target.id === 'inpDeliveredCash' ? '0' : '');
      updateLiveFormCalculation();
    });
  });

  // 2. إدارة جلسة تسجيل الدخول، البقاء في نفس الصفحة عند التحديث (Refresh)، وتسجيل الخروج التلقائي حسب الزمن الذي يحدده المدير
  const loginOverlay = document.getElementById('loginGatewayOverlay');
  const loginErr = document.getElementById('loginErrorMsg');

  function switchActiveTabUI(targetTab) {
    const validTabs = ['daily', 'dashboard', 'merchants', 'transfers', 'expenses', 'sync'];
    const tab = validTabs.includes(targetTab) ? targetTab : 'daily';
    appState.activeTab = tab;
    document.querySelectorAll('.nav-tab-btn').forEach(b => {
      if (b.getAttribute('data-nav') === tab) b.classList.add('tab-btn-active');
      else b.classList.remove('tab-btn-active');
    });
    validTabs.forEach(v => {
      const sec = document.getElementById(`view-${v}`);
      if (sec) sec.classList.toggle('hidden', v !== tab);
    });
  }

  function performLogout(reasonMsg = 'تم تسجيل الخروج بنجاح 👋') {
    appState.isLoggedIn = false;
    saveState(false);
    document.getElementById('inpLoginUsername').value = '';
    document.getElementById('inpLoginPassword').value = '';
    loginErr.classList.add('hidden');
    loginOverlay.classList.remove('hidden');
    showToast(reasonMsg, '🚪');
  }

  function recordUserActivity() {
    if (!appState.isLoggedIn) return;
    const now = Date.now();
    if (!appState.lastActivityAt || (now - appState.lastActivityAt > 5000)) {
      appState.lastActivityAt = now;
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(appState)); } catch (e) {}
    }
  }

  // Restore session and active tab on page load / refresh!
  const nowInit = Date.now();
  const initLimitMs = getInactivityLimitMs();
  const isWithinIdleLimit = (initLimitMs <= 0) || (appState.lastActivityAt && (nowInit - appState.lastActivityAt < initLimitMs));
  if (appState.isLoggedIn && isWithinIdleLimit && verifyActiveUserSession()) {
    loginOverlay.classList.add('hidden');
    appState.lastActivityAt = nowInit;
    applyAutoLiteFieldModeOnLoginOrSwitch();
    switchActiveTabUI(appState.activeTab || 'daily');
    saveState(false);
    renderAll();
  } else {
    appState.isLoggedIn = false;
    loginOverlay.classList.remove('hidden');
  }

  // Monitor activity and auto-logout after Admin-configured idle time
  ['mousemove', 'mousedown', 'keydown', 'touchstart', 'click', 'input', 'scroll'].forEach(evtName => {
    window.addEventListener(evtName, recordUserActivity, { passive: true });
  });

  setInterval(() => {
    const limitMs = getInactivityLimitMs();
    if (limitMs > 0 && appState.isLoggedIn && appState.lastActivityAt && (Date.now() - appState.lastActivityAt >= limitMs)) {
      performLogout(`تم تسجيل الخروج تلقائياً لعدم وجود حركة أو إدخال لمدة ${getInactivityTimeoutMinutes()} دقيقة 🔒`);
    }
  }, 5000);

  // Admin handlers for configuring Inactivity Auto-Logout Timeout
  function applyAdminInactivityTimeout(newMinutes) {
    if (!hasPermission('admin')) {
      showToast('عفواً، تحديد زمن الخروج التلقائي متاح لمدير الموقع فقط.', '🔒');
      return;
    }
    const mins = Math.max(0, Math.min(1440, Math.round(Number(newMinutes) || 0)));
    appState.inactivityTimeoutMin = mins;
    appState.lastActivityAt = Date.now();
    saveState(true);
    renderUsersAndPermissionsUI();
    if (mins <= 0) {
      showToast('تم إيقاف تسجيل الخروج التلقائي عند السكون (الجلسة مفتوحة)', '⏱️');
    } else {
      showToast(`تم ضبط زمن تسجيل الخروج التلقائي لعدم النشاط على (${mins} دقيقة) بنجاح!`, '⏱️');
    }
  }

  const selInactPresetEl = document.getElementById('selInactivityPreset');
  if (selInactPresetEl) {
    selInactPresetEl.addEventListener('change', (e) => {
      const v = Number(e.target.value);
      const inpEl = document.getElementById('inpInactivityTimeoutMin');
      if (inpEl) inpEl.value = String(v);
      applyAdminInactivityTimeout(v);
    });
  }

  const btnSaveInactEl = document.getElementById('btnSaveInactivityTimeout');
  if (btnSaveInactEl) {
    btnSaveInactEl.addEventListener('click', () => {
      const inpEl = document.getElementById('inpInactivityTimeoutMin');
      const v = inpEl ? Number(inpEl.value) : 20;
      applyAdminInactivityTimeout(v);
    });
  }

  document.getElementById('gatewayLoginForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const uName = (document.getElementById('inpLoginUsername').value || '').trim().toLowerCase();
    const uPass = (document.getElementById('inpLoginPassword').value || '').trim();

    // Check Admin user (supports updated username/password from Profile or default admin/admin)
    const adminObj = (appState.users || []).find(u => u.id === 'admin') || { username: 'admin', password: 'admin' };
    const adminUsername = String(adminObj.username || 'admin').trim().toLowerCase();
    const adminPassword = String(adminObj.password || 'admin').trim();

    if ((uName === adminUsername || uName === 'admin') && uPass === adminPassword) {
      appState.activeUserId = 'admin';
      appState.isLoggedIn = true;
      appState.lastActivityAt = Date.now();
      loginErr.classList.add('hidden');
      loginOverlay.classList.add('hidden');
      unifyGlobalMerchantsRegistry();
      applyAutoLiteFieldModeOnLoginOrSwitch();
      switchActiveTabUI(appState.activeTab || 'daily');
      saveState(false);
      renderAll(true);
      if ((appState.webhookUrl || getEmbeddedWebhookUrl()) && navigator.onLine) {
        pullDatabaseFromCloud(true, true);
      }
      startLiveRealtimeSyncEngine();
      showToast(`مرحباً بك (${adminObj.name || 'مدير الموقع'})! تم تسجيل الدخول بصلاحيات المدير الكاملة 👑`);
      return;
    }

    const matchedUser = (appState.users || []).find(u =>
      u.id !== 'admin' && u.id !== 'visitor' &&
      (String(u.username || u.name).trim().toLowerCase() === uName || String(u.name).trim().toLowerCase() === uName) &&
      String(u.password || '1234').trim() === uPass
    );
    if (matchedUser) {
      appState.activeUserId = matchedUser.id;
      appState.isLoggedIn = true;
      appState.lastActivityAt = Date.now();
      loginErr.classList.add('hidden');
      loginOverlay.classList.add('hidden');
      unifyGlobalMerchantsRegistry();
      applyAutoLiteFieldModeOnLoginOrSwitch();
      switchActiveTabUI(appState.activeTab || 'daily');
      saveState(false);
      renderAll(true);
      if ((appState.webhookUrl || getEmbeddedWebhookUrl()) && navigator.onLine) {
        pullDatabaseFromCloud(true, true);
      }
      startLiveRealtimeSyncEngine();
      showToast(`مرحباً بك (${matchedUser.name})! تم تسجيل الدخول بنجاح`, '👤');
      return;
    }

    loginErr.textContent = '❌ اسم المستخدم أو كلمة المرور غير صحيحة (أو تم حذف الحساب من قِبل المدير)!';
    loginErr.classList.remove('hidden');
  });



  document.getElementById('btnShowLoginScreen').addEventListener('click', () => {
    const dd = document.getElementById('headerUserDropdownMenu');
    if (dd) dd.classList.add('hidden');
    performLogout('تم تسجيل الخروج بنجاح 👋');
  });

  // Dynamic Farm Name Inputs (Top Header + Settings Panel + Quick Presets)
  document.getElementById('inpTopFarmName').addEventListener('input', (e) => {
    setFarmName(e.target.value);
    renderDailyView();
  });
  document.getElementById('inpSettingsFarmName').addEventListener('input', (e) => {
    setFarmName(e.target.value);
    renderDailyView();
  });
  document.querySelectorAll('[data-quick-farm]').forEach(btn => {
    btn.addEventListener('click', () => {
      const name = btn.getAttribute('data-quick-farm');
      setFarmName(name);
      renderAll();
      showToast(`تم تغيير اسم المزرعة إلى (${name}) في الموقع وشيت الإكسيل`);
    });
  });

  // Start a New Clean 10-Day Cycle for a New Farm (keeping coded merchants)
  document.getElementById('btnNewCleanCycle').addEventListener('click', () => {
    clearActiveFarmMovementsKeepMerchants(
      `تم فتح دورة 10 أيام جديدة فارغة لمزرعة (${appState.farmName}) مع الاحتفاظ بأكواد التجار!`,
      '🆕'
    );
  });

  // Live File Binding via File System Access API (`showOpenFilePicker`)
  document.getElementById('btnLinkLiveExcel').addEventListener('click', async () => {
    if (window.showOpenFilePicker) {
      try {
        const [handle] = await window.showOpenFilePicker({
          types: [{ description: 'Excel Workbook', accept: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'] } }],
          multiple: false
        });
        liveExcelFileHandle = handle;
        const file = await handle.getFile();
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(new Uint8Array(buf), { type: 'array' });
        importWorkbookIntoAppState(wb, file.name);
        showToast(`تم الربط المباشر بملف (${file.name})! أي تحديث ستصدره سيُكتب في نفس الملف مباشرة.`, '🔗');
      } catch (err) {
        if (err.name !== 'AbortError') {
          document.getElementById('fileImportXlsx').click();
        }
      }
    } else {
      document.getElementById('fileImportXlsx').click();
    }
  });

  // Online / Offline listeners with Automatic Cloud Sync on Reconnect
  window.addEventListener('online', () => {
    updateConnectionAndSyncUI();
    pushDatabaseToCloud(true);
    showToast('عاد الاتصال بالإنترنت وتمت مزامنة قاعدة البيانات السحابية تلقائياً!', '🟢');
  });

  // Top Header Cloud Farm Switcher
  document.getElementById('selTopCloudFarm').addEventListener('change', (e) => {
    const targetFarm = e.target.value;
    if (activateFarmFromArchive(targetFarm)) {
      if (excelTableState && excelTableState.cloudFarms) {
        excelTableState.cloudFarms.searchQuery = '';
        excelTableState.cloudFarms.sortCol = null;
        excelTableState.cloudFarms.colFilters = {};
      }
      const inpCf = document.getElementById('inpFilterCloudFarms');
      if (inpCf) inpCf.value = '';
      saveState(true);
      renderAll(true);
      showToast(`✅ تم تنشيط وفتح قاعدة بيانات مزرعة (${targetFarm}) في جميع تبويبات الموقع!`);
    }
  });

  // Add or Rename Farm in Cloud Database
  document.getElementById('btnAddNewCloudFarm').addEventListener('click', () => {
    if (!hasPermission('farms')) {
      showToast('عفواً، لا تملك صلاحية إضافة أو تعديل المزارع.', '🔒');
      return;
    }
    const inp = document.getElementById('inpNewCloudFarmName');
    const newName = inp.value.trim();
    if (!newName) {
      showToast('اكتب اسم المزرعة أو الدورة أولاً', '⚠️');
      inp.focus();
      return;
    }
    syncActiveFarmIntoArchive();
    const oldEditName = document.getElementById('editCloudFarmOldName').value;
    if (oldEditName && appState.farmsArchive[oldEditName]) {
      const farmData = appState.farmsArchive[oldEditName];
      delete appState.farmsArchive[oldEditName];
      farmData.farmName = newName;
      appState.farmsArchive[newName] = farmData;
      if (appState.farmName === oldEditName) {
        appState.farmName = newName;
      }
      document.getElementById('editCloudFarmOldName').value = '';
      document.getElementById('btnAddNewCloudFarm').textContent = '➕ إنشاء مزرعة جديدة بالسحابة';
      document.getElementById('btnCancelCloudFarmEdit').classList.add('hidden');
      inp.value = '';
      saveState(true);
      renderAll();
      showToast(`تم تعديل اسم المزرعة من (${oldEditName}) إلى (${newName})`);
      return;
    }

    const emptyDays = {};
    for (let d = 1; d <= 10; d++) {
      emptyDays[d] = { dayNumber: d, dateLabel: `اليوم ${d}`, sales: [], pendingSales: [], expenses: [], deliveredCash: 0 };
    }
    const nowCreateTs = getSyncedNow();
    appState.farmName = newName;
    appState.lastFarmSwitchAt = nowCreateTs;
    appState.farmResetAt = 0;
    appState.lastBulkImportAt = 0;
    appState.days = emptyDays;
    appState.currentDay = 1;
    appState.visibleDays = [1];
    appState.defaultPrice = 0;
    appState.defaultTip = 0;
    appState.lastScaleNo = 0;
    activeRecalledPendingId = '';
    unrecordDeletedItem('farms', newName);
    unifyGlobalMerchantsRegistry();
    appState.farmsArchive[newName] = {
      farmName: newName,
      updatedAt: new Date(nowCreateTs).toISOString(),
      farmResetAt: 0,
      lastBulkImportAt: 0,
      visibleDays: [1],
      defaultPrice: 0,
      defaultTip: 0,
      lastScaleNo: 0,
      merchants: JSON.parse(JSON.stringify(appState.merchants || [])),
      days: emptyDays
    };
    const saleForm = document.getElementById('saleEntryForm');
    if (saleForm) saleForm.reset();
    const editIdEl = document.getElementById('editSaleId');
    if (editIdEl) editIdEl.value = '';
    inp.value = '';
    saveState(true);
    renderAll(true);
    showToast(`تم إنشاء مزرعة (${newName}) جديدة فارغة مع ثبات الكود الموحد وأسماء التجار الأساسيين!`, '☁️');
  });

  document.getElementById('btnCancelCloudFarmEdit').addEventListener('click', () => {
    document.getElementById('editCloudFarmOldName').value = '';
    document.getElementById('inpNewCloudFarmName').value = '';
    document.getElementById('btnAddNewCloudFarm').textContent = '➕ إنشاء مزرعة جديدة بالسحابة';
    document.getElementById('btnCancelCloudFarmEdit').classList.add('hidden');
  });

  // Switch, Export, Rename, or Delete specific farm from Cloud Farms Table
  document.getElementById('cloudFarmsTbody').addEventListener('click', (e) => {
    const swBtn = e.target.closest('[data-switch-farm]');
    if (swBtn) {
      const fn = swBtn.getAttribute('data-switch-farm');
      if (activateFarmFromArchive(fn)) {
        if (excelTableState && excelTableState.cloudFarms) {
          excelTableState.cloudFarms.searchQuery = '';
          excelTableState.cloudFarms.sortCol = null;
          excelTableState.cloudFarms.colFilters = {};
        }
        const inpCf = document.getElementById('inpFilterCloudFarms');
        if (inpCf) inpCf.value = '';
        saveState(true);
        renderAll(true);
        showToast(`✅ تم تنشيط وفتح قاعدة بيانات مزرعة (${fn}) في جميع تبويبات الموقع!`);
      }
      return;
    }
    const exBtn = e.target.closest('[data-export-farm]');
    if (exBtn) {
      const fn = exBtn.getAttribute('data-export-farm');
      if (fn && appState.farmsArchive[fn]) {
        const prevFarm = appState.farmName;
        activateFarmFromArchive(fn);
        exportFullWorkbookXlsx();
        activateFarmFromArchive(prevFarm);
        renderAll();
      }
      return;
    }
    const renBtn = e.target.closest('[data-rename-farm]');
    if (renBtn) {
      if (!hasPermission('farms')) return;
      const fn = renBtn.getAttribute('data-rename-farm');
      document.getElementById('editCloudFarmOldName').value = fn;
      document.getElementById('inpNewCloudFarmName').value = fn;
      document.getElementById('btnAddNewCloudFarm').textContent = `💾 حفظ الاسم الجديد`;
      document.getElementById('btnCancelCloudFarmEdit').classList.remove('hidden');
      document.getElementById('inpNewCloudFarmName').focus();
      return;
    }
    const delBtn = e.target.closest('[data-delete-farm]');
    if (delBtn) {
      if (!hasPermission('farms')) return;
      const fn = delBtn.getAttribute('data-delete-farm');
      const keys = Object.keys(appState.farmsArchive || {});
      if (keys.length <= 1) {
        showToast('لا يمكن حذف المزرعة الوحيدة في قاعدة البيانات — يمكنك تعديل اسمها أو تصفيرها.', '⚠️');
        return;
      }
      recordDeletedItem('farms', fn);
      delete appState.farmsArchive[fn];
      if (appState.farmName === fn) {
        const nextFn = Object.keys(appState.farmsArchive)[0];
        appState.farmName = nextFn;
        appState.days = JSON.parse(JSON.stringify(appState.farmsArchive[nextFn].days));
      }
      saveState(true);
      renderAll();
      showToast(`تم حذف مزرعة (${fn}) من سجل قاعدة البيانات`, '🗑️');
    }
  });

  // Users & Permissions Modal Handlers (with password check if switching from Visitor to Admin)
  document.getElementById('selActiveUserRole').addEventListener('change', (e) => {
    const targetId = e.target.value;
    if (targetId !== 'visitor' && !hasPermission('admin')) {
      // Require login via Login Overlay
      e.target.value = appState.activeUserId;
      document.getElementById('btnShowLoginScreen').click();
      showToast('يرجى تسجيل الدخول بحساب المدير أولاً لتفعيل هذه الصلاحية', '🔐');
      return;
    }
    appState.activeUserId = targetId;
    saveState(false);
    renderAll();
    const u = getActiveUser();
    showToast(`تم التبديل إلى حساب: ${u.name}`, '👤');
  });

  // Unified Header User Dropdown Menu Toggle & Actions
  const userMenuBtn = document.getElementById('btnHeaderUserMenuToggle');
  const userMenuDropdown = document.getElementById('headerUserDropdownMenu');
  const userMenuContainer = document.getElementById('headerUserDropdownContainer');

  if (userMenuBtn && userMenuDropdown) {
    userMenuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      userMenuDropdown.classList.toggle('hidden');
    });
    document.addEventListener('click', (e) => {
      if (userMenuContainer && !userMenuContainer.contains(e.target)) {
        userMenuDropdown.classList.add('hidden');
      }
    });
  }

  document.getElementById('btnOpenMyProfile').addEventListener('click', (e) => {
    e.preventDefault();
    if (userMenuDropdown) userMenuDropdown.classList.add('hidden');
    const syncTabBtn = document.querySelector('[data-nav="sync"]');
    if (syncTabBtn) syncTabBtn.click();
    setTimeout(() => {
      const profSec = document.getElementById('myProfileCardSection');
      if (profSec) profSec.scrollIntoView({ behavior: 'smooth' });
      document.getElementById('inpProfFullName').focus();
    }, 80);
  });

  document.getElementById('btnDropdownPermissions').addEventListener('click', () => {
    if (userMenuDropdown) userMenuDropdown.classList.add('hidden');
    document.getElementById('btnOpenUsersModal').click();
  });

  document.getElementById('btnDropdownExportExcel').addEventListener('click', () => {
    if (userMenuDropdown) userMenuDropdown.classList.add('hidden');
    exportFullWorkbookXlsx();
  });

  document.getElementById('myProfileForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const activeUser = getActiveUser();
    if (!activeUser || (activeUser.id === 'visitor' && !hasPermission('admin'))) {
      showToast('عفواً، حساب الزائر للعرض فقط ولا يملك ملفاً شخصياً قابلاً للتعديل.', '🔒');
      return;
    }
    const fullName = document.getElementById('inpProfFullName').value.trim();
    const usrName = document.getElementById('inpProfUsername').value.trim();
    const phone = document.getElementById('inpProfPhone').value.trim();
    const jobTitle = document.getElementById('inpProfJobTitle').value.trim();
    const newPass = document.getElementById('inpProfPassword').value.trim();

    if (!fullName || !usrName) {
      showToast('يرجى إدخال الاسم الكامل واسم الدخول', '⚠️');
      return;
    }
    activeUser.name = fullName;
    activeUser.username = usrName;
    activeUser.phone = phone;
    activeUser.jobTitle = jobTitle;
    activeUser.updatedAt = getSyncedNow();
    if (newPass) {
      activeUser.password = newPass;
    }
    saveState(true);
    renderAll();
    showToast('تم حفظ وتحديث بيانات ملفك الشخصي وكلمة المرور بنجاح! 👤');
  });

  document.getElementById('btnOpenUsersModal').addEventListener('click', (e) => {
    e.preventDefault();
    const syncTabBtn = document.querySelector('[data-nav="sync"]');
    if (syncTabBtn) syncTabBtn.click();
    setTimeout(() => {
      const permSec = document.getElementById('usersPermissionsModal');
      if (permSec) permSec.scrollIntoView({ behavior: 'smooth' });
    }, 80);
  });

  document.getElementById('btnCloseUsersModal').addEventListener('click', () => {
    document.getElementById('usersPermissionsModal').classList.add('hidden');
  });

  document.getElementById('btnCancelUserEdit').addEventListener('click', () => {
    document.getElementById('editUserIdInput').value = '';
    document.getElementById('inpNewUserFullName').value = '';
    document.getElementById('inpNewUserName').value = '';
    document.getElementById('inpNewUserPassword').value = '1234';
    document.getElementById('inpNewUserPhone').value = '';
    document.getElementById('inpNewUserJobTitle').value = '';
    document.getElementById('btnSaveUserSubmit').textContent = '➕ حفظ المستخدم';
    document.getElementById('btnCancelUserEdit').classList.add('hidden');
  });

  document.getElementById('addUserForm').addEventListener('submit', (e) => {
    e.preventDefault();
    if (!hasPermission('admin')) {
      showToast('عفواً، إدارة وتعديل المستخدمين متاحة لمدير الموقع فقط.', '🔒');
      return;
    }
    const username = document.getElementById('inpNewUserName').value.trim();
    if (!username) return;
    const fullName = document.getElementById('inpNewUserFullName').value.trim() || username;
    const pwd = document.getElementById('inpNewUserPassword').value.trim();
    const phone = document.getElementById('inpNewUserPhone').value.trim();
    const jobTitle = document.getElementById('inpNewUserJobTitle').value.trim();
    const editId = document.getElementById('editUserIdInput').value;
    const perms = {
      sales: document.getElementById('chkPermSales').checked,
      expenses: document.getElementById('chkPermExpenses').checked,
      merchants: document.getElementById('chkPermMerchants').checked,
      farms: document.getElementById('chkPermFarms').checked,
      admin: document.getElementById('chkPermAdmin').checked,
      liteFieldMode: Boolean(document.getElementById('chkPermLiteFieldMode')?.checked),
      showSyncExcel: document.getElementById('chkPermShowSyncExcel').checked,
      showSyncCloud: document.getElementById('chkPermShowSyncCloud').checked,
      showSyncWebhook: document.getElementById('chkPermShowSyncWebhook').checked
    };
    if (editId) {
      const uObj = appState.users.find(u => u.id === editId);
      if (uObj) {
        uObj.name = fullName;
        uObj.username = username;
        uObj.password = pwd;
        uObj.phone = phone;
        uObj.jobTitle = jobTitle;
        uObj.updatedAt = getSyncedNow();
        // Ensure primary admin keeps admin perm
        if (uObj.id === 'admin') perms.admin = true;
        uObj.perms = perms;
      }
      document.getElementById('editUserIdInput').value = '';
      document.getElementById('btnSaveUserSubmit').textContent = '➕ حفظ المستخدم';
      document.getElementById('btnCancelUserEdit').classList.add('hidden');
      showToast(`تم تحديث جميع بيانات وصلاحيات المستخدم (${fullName}) بنجاح`);
    } else {
      appState.users.push({
        id: generateRecordUUID('usr'),
        updatedAt: getSyncedNow(),
        username: username,
        password: pwd || '1234',
        name: fullName,
        phone: phone,
        jobTitle: jobTitle,
        isSystem: false,
        perms
      });
      showToast(`تم إنشاء المستخدم (${fullName}) وتحديد صلاحياته بنجاح`);
    }
    document.getElementById('inpNewUserFullName').value = '';
    document.getElementById('inpNewUserName').value = '';
    document.getElementById('inpNewUserPassword').value = '1234';
    document.getElementById('inpNewUserPhone').value = '';
    document.getElementById('inpNewUserJobTitle').value = '';
    saveState(true);
    renderAll();
  });

  document.getElementById('usersListTbody').addEventListener('click', (e) => {
    if (!hasPermission('admin')) return;
    const actBtn = e.target.closest('[data-activate-user]');
    if (actBtn) {
      appState.activeUserId = actBtn.getAttribute('data-activate-user');
      saveState(false);
      renderAll();
      showToast(`تم تفعيل حساب: ${getActiveUser().name}`, '👤');
      return;
    }
    const edBtn = e.target.closest('[data-edit-user]');
    if (edBtn) {
      const uid = edBtn.getAttribute('data-edit-user');
      const uObj = appState.users.find(u => u.id === uid);
      if (!uObj) return;
      document.getElementById('editUserIdInput').value = uObj.id;
      document.getElementById('inpNewUserFullName').value = uObj.name || '';
      document.getElementById('inpNewUserName').value = uObj.username || uObj.id || '';
      document.getElementById('inpNewUserPassword').value = uObj.password || '';
      document.getElementById('inpNewUserPhone').value = uObj.phone || '';
      document.getElementById('inpNewUserJobTitle').value = uObj.jobTitle || '';
      document.getElementById('chkPermSales').checked = Boolean(uObj.perms.sales);
      document.getElementById('chkPermExpenses').checked = Boolean(uObj.perms.expenses);
      document.getElementById('chkPermMerchants').checked = Boolean(uObj.perms.merchants);
      document.getElementById('chkPermFarms').checked = Boolean(uObj.perms.farms);
      document.getElementById('chkPermAdmin').checked = Boolean(uObj.perms.admin);
      const chkLitePermEl = document.getElementById('chkPermLiteFieldMode');
      if (chkLitePermEl) chkLitePermEl.checked = Boolean(uObj.perms.liteFieldMode);
      document.getElementById('chkPermShowSyncExcel').checked = Boolean(uObj.perms.showSyncExcel);
      document.getElementById('chkPermShowSyncCloud').checked = Boolean(uObj.perms.showSyncCloud);
      document.getElementById('chkPermShowSyncWebhook').checked = Boolean(uObj.perms.showSyncWebhook);
      document.getElementById('btnSaveUserSubmit').textContent = `💾 حفظ تعديلات (${uObj.name})`;
      document.getElementById('btnCancelUserEdit').classList.remove('hidden');
      document.getElementById('inpNewUserFullName').focus();
      return;
    }
    const delBtn = e.target.closest('[data-del-user]');
    if (delBtn) {
      const uid = delBtn.getAttribute('data-del-user');
      const deletedUserObj = appState.users.find(u => u.id === uid);
      recordDeletedItem('users', uid);
      appState.users = appState.users.filter(u => u.id !== uid);
      const wasCurrentActiveUser = (appState.activeUserId === uid);
      saveState(true);
      if (liveBroadcastChannel) {
        try { liveBroadcastChannel.postMessage({ type: 'USER_DELETED', deletedUserId: uid }); } catch (err) {}
      }
      if (wasCurrentActiveUser) {
        verifyActiveUserSession();
      } else {
        renderAll();
        showToast(`تم حذف حساب (${deletedUserObj ? deletedUserObj.name : uid}) وتسجيل خروجه فوراً من أي جهاز متصل!`, '🗑️');
      }
    }
  });

  // Push / Pull Cloud DB Buttons
  document.getElementById('btnPushCloudNow').addEventListener('click', () => pushDatabaseToCloud(false, true));
  document.getElementById('btnPullCloudNow').addEventListener('click', () => pullDatabaseFromCloud(false, true));

  // Copy Ready-Made Google Apps Script Cloud Database Code (Chunked at 2500 chars to stay well below 9KB UTF-8 limit for Arabic!)
  document.getElementById('btnCopyCloudScriptCode').addEventListener('click', () => {
    const scriptCode = [
      "// كود قاعدة البيانات السحابية المطور لـ GitHub Pages و Google Sites (يدعم اللغة العربية والأحجام الكبيرة بدون أخطاء 9KB)",
      "// 1. افتح script.google.com وامسح الكود القديم بالكامل والصق هذا الكود ثم اضغط حفظ (Save 💾)",
      "// 2. اضغط Deploy -> Manage deployments -> Edit (أيقونة القلم ✏️) -> اختر Version: New version -> Deploy",
      "//    (أو Deploy -> New deployment -> Web app -> Execute as: Me -> Who has access: Anyone)",
      "function doGet(e) {",
      "  var store = PropertiesService.getScriptProperties();",
      "  var count = Number(store.getProperty('DB_CHUNK_COUNT') || 0);",
      "  var out = '';",
      "  if (count > 0) {",
      "    for (var i = 0; i < count; i++) {",
      "      out += (store.getProperty('DB_CHUNK_' + i) || '');",
      "    }",
      "  } else {",
      "    out = store.getProperty('FARM_CLOUD_DB') || '{}';",
      "  }",
      "  return ContentService.createTextOutput(out || '{}').setMimeType(ContentService.MimeType.JSON);",
      "}",
      "function doPost(e) {",
      "  var lock = LockService.getScriptLock();",
      "  lock.tryLock(10000);",
      "  try {",
      "    var raw = (e && e.postData && e.postData.contents) ? e.postData.contents : '{}';",
      "    var store = PropertiesService.getScriptProperties();",
      "    var chunkSize = 2500;",
      "    var totalChunks = Math.ceil(raw.length / chunkSize);",
      "    var props = { 'DB_CHUNK_COUNT': String(totalChunks) };",
      "    for (var i = 0; i < totalChunks; i++) {",
      "      props['DB_CHUNK_' + i] = raw.slice(i * chunkSize, (i + 1) * chunkSize);",
      "    }",
      "    store.deleteAllProperties();",
      "    store.setProperties(props, false);",
      "    return ContentService.createTextOutput(JSON.stringify({status:'ok', chunks: totalChunks, length: raw.length})).setMimeType(ContentService.MimeType.JSON);",
      "  } finally {",
      "    lock.releaseLock();",
      "  }",
      "}"
    ].join('\n');
    const ta = document.createElement('textarea');
    ta.value = scriptCode;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (err) {}
    document.body.removeChild(ta);
    showToast('تم نسخ كود السحابة المطور! حدثه في script.google.com واختر (New version) عند النشر.', '📋');
  });
  window.addEventListener('offline', () => {
    updateConnectionAndSyncUI();
    showToast('انقطع الإنترنت — يعمل البرنامج الآن في وضع الأوفلاين ويحفظ كل حركة على المتصفح.', '🟠');
  });

  // Navigation Tabs
  document.querySelectorAll('.nav-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.getAttribute('data-nav');
      appState.activeTab = target;
      document.querySelectorAll('.nav-tab-btn').forEach(b => {
        if (b.getAttribute('data-nav') === target) {
          b.classList.add('tab-btn-active');
        } else {
          b.classList.remove('tab-btn-active');
        }
      });
      ['daily', 'dashboard', 'merchants', 'transfers', 'expenses', 'sync'].forEach(v => {
        const sec = document.getElementById(`view-${v}`);
        if (sec) sec.classList.toggle('hidden', v !== target);
      });
      saveState(false);
      renderAll();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  });

  // Quick In-Page Jump Buttons on Daily View
  document.getElementById('btnJumpSaleForm').addEventListener('click', () => {
    document.getElementById('saleFormCard').scrollIntoView({ behavior: 'smooth' });
    document.getElementById('inpMerchantName').focus();
  });
  document.getElementById('btnJumpExpenseForm').addEventListener('click', () => {
    document.getElementById('dailyExpensesSection').scrollIntoView({ behavior: 'smooth' });
    document.getElementById('inpExpDesc').focus();
  });
  document.getElementById('btnJumpTrialBalance').addEventListener('click', () => {
    document.getElementById('dailyTrialBalanceCard').scrollIntoView({ behavior: 'smooth' });
  });

  // Date / Label change for current day + Interactive Add / Edit / Delete Day Boxes
  document.getElementById('currentDayDateInput').addEventListener('change', (e) => {
    if (!hasPermission('sales')) return;
    if (isDayLocked(appState.currentDay)) {
      showToast('🔒 هذا اليوم مقفل ومعتمد محاسبياً — لا يمكن تعديل اسم أو تاريخ اليوم إلا بعد فك القفل بواسطة مدير الموقع!', '🔒');
      renderDailyView();
      return;
    }
    const curD = appState.days[appState.currentDay];
    curD.dateLabel = e.target.value.trim() || `اليوم ${appState.currentDay}`;
    curD.labelUpdatedAt = Math.max(getSyncedNow(), (Number(curD.labelUpdatedAt) || 0) + 10);
    saveState(true);
    renderAll();
  });

  const btnToggleLockEl = document.getElementById('btnToggleDayLock');
  if (btnToggleLockEl) {
    btnToggleLockEl.addEventListener('click', () => {
      toggleDayLockState(appState.currentDay);
    });
  }

  // Helper to populate and refresh all Day Management selectors & pills
  function refreshDayManagementBoxesUI() {
    window.refreshDayManagementBoxesUI = refreshDayManagementBoxesUI;
    const visDays = getVisibleDays();
    const allDays = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const hiddenDays = allDays.filter(d => !visDays.includes(d));

    // 1) Populate Add Day Selector & Pills (#selAddDayTarget, #addDayQuickPills) + Daily Quick Add (#selDailyQuickAddDay, #dailyQuickAddDayPills)
    const selAdd = document.getElementById('selAddDayTarget');
    const inpAddLbl = document.getElementById('inpAddDayCustomLabel');
    const pillsAdd = document.getElementById('addDayQuickPills');

    const selDailyAdd = document.getElementById('selDailyQuickAddDay');
    const inpDailyAddLbl = document.getElementById('inpDailyQuickAddLabel');
    const pillsDailyAdd = document.getElementById('dailyQuickAddDayPills');

    const defaultAddDay = hiddenDays.length > 0 ? hiddenDays[0] : (visDays[visDays.length - 1] || 1);

    if (selAdd && document.activeElement !== selAdd) {
      const prevAddVal = Number(selAdd.value);
      const chosenAdd = (prevAddVal >= 1 && prevAddVal <= 10 && (!visDays.includes(prevAddVal) || hiddenDays.length === 0))
        ? prevAddVal
        : defaultAddDay;
      selAdd.innerHTML = allDays.map(d => {
        const isAlreadyOpen = visDays.includes(d);
        const lbl = (appState.days[d] && appState.days[d].dateLabel) || `اليوم ${d}`;
        return `<option value="${d}" ${d === chosenAdd ? 'selected' : ''}>يوم ${d} (${lbl})${isAlreadyOpen ? ' — [مضاف حالياً]' : ' — [متاح للإضافة ➕]'}</option>`;
      }).join('');
      if (inpAddLbl && document.activeElement !== inpAddLbl) {
        const dObj = appState.days[chosenAdd];
        inpAddLbl.value = (dObj && dObj.dateLabel) ? dObj.dateLabel : `اليوم ${chosenAdd}`;
      }
      if (pillsAdd) {
        pillsAdd.innerHTML = allDays.map(d => {
          const isOpen = visDays.includes(d);
          const isSel = d === Number(selAdd.value);
          const cls = isSel
            ? 'bg-emerald-700 text-white border-emerald-900 shadow-sm'
            : (isOpen ? 'bg-slate-200 text-slate-600 border-slate-300' : 'bg-white hover:bg-emerald-100 text-emerald-900 border-emerald-400');
          return `<button type="button" data-pick-add-day="${d}" class="px-2.5 py-1 rounded-lg border text-xs font-extrabold transition ${cls}">
            ${isOpen ? '✓ ' : '➕ '}يوم ${d}
          </button>`;
        }).join('');
      }
    }

    if (selDailyAdd && document.activeElement !== selDailyAdd) {
      const prevDailyVal = Number(selDailyAdd.value);
      const chosenDailyAdd = (prevDailyVal >= 1 && prevDailyVal <= 10 && (!visDays.includes(prevDailyVal) || hiddenDays.length === 0))
        ? prevDailyVal
        : defaultAddDay;
      selDailyAdd.innerHTML = allDays.map(d => {
        const isAlreadyOpen = visDays.includes(d);
        const lbl = (appState.days[d] && appState.days[d].dateLabel) || `اليوم ${d}`;
        return `<option value="${d}" ${d === chosenDailyAdd ? 'selected' : ''}>يوم ${d} (${lbl})${isAlreadyOpen ? ' — [مضاف حالياً]' : ' — [متاح للإضافة ➕]'}</option>`;
      }).join('');
      if (inpDailyAddLbl && document.activeElement !== inpDailyAddLbl) {
        const dObj = appState.days[chosenDailyAdd];
        inpDailyAddLbl.value = (dObj && dObj.dateLabel) ? dObj.dateLabel : `اليوم ${chosenDailyAdd}`;
      }
      if (pillsDailyAdd) {
        pillsDailyAdd.innerHTML = allDays.map(d => {
          const isOpen = visDays.includes(d);
          const isSel = d === Number(selDailyAdd.value);
          const cls = isSel
            ? 'bg-emerald-700 text-white border-emerald-900 shadow-sm'
            : (isOpen ? 'bg-slate-200 text-slate-600 border-slate-300' : 'bg-white hover:bg-emerald-100 text-emerald-900 border-emerald-400');
          return `<button type="button" data-pick-daily-add-day="${d}" class="px-2.5 py-1 rounded-lg border text-xs font-extrabold transition ${cls}">
            ${isOpen ? '✓ ' : '➕ '}يوم ${d}
          </button>`;
        }).join('');
      }
    }

    // 2) Populate Edit Day Selector & Pills (#selEditDayTarget, #editDayQuickPills, #inpEditDayCustomLabel)
    const selEdit = document.getElementById('selEditDayTarget');
    const inpEditLbl = document.getElementById('inpEditDayCustomLabel');
    const pillsEdit = document.getElementById('editDayQuickPills');
    if (selEdit && document.activeElement !== selEdit) {
      const prevEditVal = Number(selEdit.value);
      const chosenEdit = (prevEditVal >= 1 && prevEditVal <= 10) ? prevEditVal : (appState.currentDay || 1);
      selEdit.innerHTML = allDays.map(d => {
        const isOpen = visDays.includes(d);
        const lbl = (appState.days[d] && appState.days[d].dateLabel) || `اليوم ${d}`;
        return `<option value="${d}" ${d === chosenEdit ? 'selected' : ''}>يوم ${d} — (${lbl})${isOpen ? ' [مفتوح]' : ''}</option>`;
      }).join('');
      if (inpEditLbl && document.activeElement !== inpEditLbl) {
        inpEditLbl.value = (appState.days[chosenEdit] && appState.days[chosenEdit].dateLabel) || `اليوم ${chosenEdit}`;
      }
      if (pillsEdit) {
        pillsEdit.innerHTML = visDays.map(d => {
          const isSel = d === Number(selEdit.value);
          const lbl = (appState.days[d] && appState.days[d].dateLabel) || `اليوم ${d}`;
          return `<button type="button" data-pick-edit-day="${d}" class="px-2.5 py-1 rounded-lg border text-xs font-extrabold transition ${
            isSel ? 'bg-blue-900 text-white border-blue-950 shadow-sm' : 'bg-white hover:bg-blue-100 text-blue-900 border-blue-300'
          }">✏️ يوم ${d} (${lbl})</button>`;
        }).join('');
      }
    }

    // 3) Populate Delete Day Selector & Pills (#selDeleteDayTarget, #deleteDayQuickPills, #deleteDaySummaryText)
    const selDel = document.getElementById('selDeleteDayTarget');
    const pillsDel = document.getElementById('deleteDayQuickPills');
    const sumDelTxt = document.getElementById('deleteDaySummaryText');
    if (selDel && document.activeElement !== selDel) {
      const prevDelVal = Number(selDel.value);
      const chosenDel = visDays.includes(prevDelVal) ? prevDelVal : (appState.currentDay || visDays[visDays.length - 1] || 1);
      selDel.innerHTML = visDays.map(d => {
        const sm = computeDaySummary(d);
        const pendCnt = (appState.days[d] && appState.days[d].pendingSales) ? appState.days[d].pendingSales.length : 0;
        return `<option value="${d}" ${d === chosenDel ? 'selected' : ''}>يوم ${d} (${sm.dateLabel}) — ${sm.countCars} حركة بيع${pendCnt > 0 ? ` + ${pendCnt} مؤقت` : ''} | ${sm.expenses.length} مصروف</option>`;
      }).join('');
      if (pillsDel) {
        pillsDel.innerHTML = visDays.map(d => {
          const isSel = d === Number(selDel.value);
          const sm = computeDaySummary(d);
          return `<button type="button" data-pick-del-day="${d}" class="px-2.5 py-1 rounded-lg border text-xs font-extrabold transition ${
            isSel ? 'bg-rose-700 text-white border-rose-900 shadow-sm' : 'bg-white hover:bg-rose-100 text-rose-900 border-rose-300'
          }">🗑️ يوم ${d} (${sm.countCars} حركة)</button>`;
        }).join('');
      }
      if (sumDelTxt) {
        const sm = computeDaySummary(chosenDel);
        sumDelTxt.textContent = visDays.length <= 1
          ? `تنبيه: (يوم ${chosenDel} - ${sm.dateLabel}) هو اليوم الوحيد المفتوح؛ سيتم تصفير جميع حركاته (${sm.countCars} حركة) بالكامل.`
          : `سيتم حذف وتصفير (يوم ${chosenDel} - ${sm.dateLabel}) شاملاً (${sm.countCars} حركة بيع و ${sm.expenses.length} مصروف).`;
      }
    }
  };

  function openDayManagementBox(mode) {
    window.openDayManagementBox = openDayManagementBox;
    if (!hasPermission('sales')) {
      showToast('عفواً، إدارة الأيام متاحة لمدير الموقع والمستخدمين المصرح لهم.', '🔒');
      return;
    }
    const boxAdd = document.getElementById('dayMgmtBoxAdd');
    const boxEdit = document.getElementById('dayMgmtBoxEdit');
    const boxDel = document.getElementById('dayMgmtBoxDelete');
    if (boxAdd) boxAdd.classList.toggle('hidden', mode !== 'add');
    if (boxEdit) boxEdit.classList.toggle('hidden', mode !== 'edit');
    if (boxDel) boxDel.classList.toggle('hidden', mode !== 'delete');

    if (typeof window.refreshDayManagementBoxesUI === 'function') window.refreshDayManagementBoxesUI();

    if (mode === 'add') {
      const vis = getVisibleDays();
      let nextFree = 1;
      for (let d = 1; d <= 10; d++) {
        if (!vis.includes(d)) { nextFree = d; break; }
      }
      const selAdd = document.getElementById('selAddDayTarget');
      const inpAdd = document.getElementById('inpAddDayCustomLabel');
      if (selAdd) selAdd.value = String(nextFree);
      if (inpAdd) {
        inpAdd.value = (appState.days[nextFree] && appState.days[nextFree].dateLabel) || `اليوم ${nextFree}`;
        setTimeout(() => { inpAdd.focus(); inpAdd.select(); }, 60);
      }
      if (typeof window.refreshDayManagementBoxesUI === 'function') window.refreshDayManagementBoxesUI();
    } else if (mode === 'edit') {
      const selEdit = document.getElementById('selEditDayTarget');
      const inpEdit = document.getElementById('inpEditDayCustomLabel');
      if (selEdit) selEdit.value = String(appState.currentDay || 1);
      if (inpEdit) {
        const curD = appState.currentDay || 1;
        inpEdit.value = (appState.days[curD] && appState.days[curD].dateLabel) || `اليوم ${curD}`;
        setTimeout(() => { inpEdit.focus(); inpEdit.select(); }, 60);
      }
      if (typeof window.refreshDayManagementBoxesUI === 'function') window.refreshDayManagementBoxesUI();
    } else if (mode === 'delete') {
      const selDel = document.getElementById('selDeleteDayTarget');
      if (selDel) selDel.value = String(appState.currentDay || 1);
      if (typeof window.refreshDayManagementBoxesUI === 'function') window.refreshDayManagementBoxesUI();
    }
  };

  function openDailyQuickAddDayBox() {
    window.openDailyQuickAddDayBox = openDailyQuickAddDayBox;
    if (!hasPermission('sales')) {
      showToast('عفواً، إضافة يوم جديد متاحة لمدير الموقع والمستخدمين المصرح لهم.', '🔒');
      return;
    }
    const box = document.getElementById('dailyQuickAddDayBox');
    if (!box) return;
    const vis = getVisibleDays();
    let nextFree = 1;
    for (let d = 1; d <= 10; d++) {
      if (!vis.includes(d)) { nextFree = d; break; }
    }
    box.classList.remove('hidden');
    const sel = document.getElementById('selDailyQuickAddDay');
    const inp = document.getElementById('inpDailyQuickAddLabel');
    if (sel) sel.value = String(nextFree);
    if (typeof window.refreshDayManagementBoxesUI === 'function') window.refreshDayManagementBoxesUI();
    if (inp) {
      inp.value = (appState.days[nextFree] && appState.days[nextFree].dateLabel) || `اليوم ${nextFree}`;
      setTimeout(() => { inp.focus(); inp.select(); }, 60);
    }
  };

  // Top 3 Day Management Buttons in #syncQuickControlCard
  document.getElementById('btnAddDayTop').addEventListener('click', () => openDayManagementBox('add'));
  document.getElementById('btnSaveDayLabel').addEventListener('click', () => openDayManagementBox('edit'));
  document.getElementById('btnDeleteDayTop').addEventListener('click', () => openDayManagementBox('delete'));

  // Close / Cancel buttons for the Day Management boxes
  document.getElementById('btnCancelAddDayBox').addEventListener('click', () => {
    document.getElementById('dayMgmtBoxAdd').classList.add('hidden');
  });
  document.getElementById('btnCancelEditDayBox').addEventListener('click', () => {
    document.getElementById('dayMgmtBoxEdit').classList.add('hidden');
  });
  document.getElementById('btnCancelDeleteDayBox').addEventListener('click', () => {
    document.getElementById('dayMgmtBoxDelete').classList.add('hidden');
  });
  document.getElementById('btnCloseDailyQuickAddDay').addEventListener('click', () => {
    document.getElementById('dailyQuickAddDayBox').classList.add('hidden');
  });

  // Sync dropdown changes & pill clicks in Add Day Box
  document.getElementById('selAddDayTarget').addEventListener('change', (e) => {
    const d = Number(e.target.value) || 1;
    const inp = document.getElementById('inpAddDayCustomLabel');
    if (inp) inp.value = (appState.days[d] && appState.days[d].dateLabel) || `اليوم ${d}`;
    if (typeof window.refreshDayManagementBoxesUI === 'function') window.refreshDayManagementBoxesUI();
  });
  document.getElementById('addDayQuickPills').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-pick-add-day]');
    if (!btn) return;
    const d = Number(btn.getAttribute('data-pick-add-day')) || 1;
    document.getElementById('selAddDayTarget').value = String(d);
    const inp = document.getElementById('inpAddDayCustomLabel');
    if (inp) {
      inp.value = (appState.days[d] && appState.days[d].dateLabel) || `اليوم ${d}`;
      inp.focus();
    }
    if (typeof window.refreshDayManagementBoxesUI === 'function') window.refreshDayManagementBoxesUI();
  });
  document.getElementById('btnConfirmAddSelectedDay').addEventListener('click', () => {
    const d = Number(document.getElementById('selAddDayTarget').value) || 1;
    const lbl = document.getElementById('inpAddDayCustomLabel').value.trim();
    if (addSpecificDayToCycle(d, lbl)) {
      document.getElementById('dayMgmtBoxAdd').classList.add('hidden');
    }
  });

  // Sync dropdown changes & pill clicks in Daily Quick Add Day Box
  document.getElementById('selDailyQuickAddDay').addEventListener('change', (e) => {
    const d = Number(e.target.value) || 1;
    const inp = document.getElementById('inpDailyQuickAddLabel');
    if (inp) inp.value = (appState.days[d] && appState.days[d].dateLabel) || `اليوم ${d}`;
    if (typeof window.refreshDayManagementBoxesUI === 'function') window.refreshDayManagementBoxesUI();
  });
  document.getElementById('dailyQuickAddDayPills').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-pick-daily-add-day]');
    if (!btn) return;
    const d = Number(btn.getAttribute('data-pick-daily-add-day')) || 1;
    document.getElementById('selDailyQuickAddDay').value = String(d);
    const inp = document.getElementById('inpDailyQuickAddLabel');
    if (inp) {
      inp.value = (appState.days[d] && appState.days[d].dateLabel) || `اليوم ${d}`;
      inp.focus();
    }
    if (typeof window.refreshDayManagementBoxesUI === 'function') window.refreshDayManagementBoxesUI();
  });
  document.getElementById('btnConfirmDailyQuickAddDay').addEventListener('click', () => {
    const d = Number(document.getElementById('selDailyQuickAddDay').value) || 1;
    const lbl = document.getElementById('inpDailyQuickAddLabel').value.trim();
    if (addSpecificDayToCycle(d, lbl)) {
      document.getElementById('dailyQuickAddDayBox').classList.add('hidden');
    }
  });

  // Sync dropdown changes & pill clicks in Edit Day Box
  document.getElementById('selEditDayTarget').addEventListener('change', (e) => {
    const d = Number(e.target.value) || 1;
    const inp = document.getElementById('inpEditDayCustomLabel');
    if (inp) {
      inp.value = (appState.days[d] && appState.days[d].dateLabel) || `اليوم ${d}`;
      inp.focus();
      inp.select();
    }
    if (typeof window.refreshDayManagementBoxesUI === 'function') window.refreshDayManagementBoxesUI();
  });
  document.getElementById('editDayQuickPills').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-pick-edit-day]');
    if (!btn) return;
    const d = Number(btn.getAttribute('data-pick-edit-day')) || 1;
    document.getElementById('selEditDayTarget').value = String(d);
    const inp = document.getElementById('inpEditDayCustomLabel');
    if (inp) {
      inp.value = (appState.days[d] && appState.days[d].dateLabel) || `اليوم ${d}`;
      inp.focus();
      inp.select();
    }
    if (typeof window.refreshDayManagementBoxesUI === 'function') window.refreshDayManagementBoxesUI();
  });
  document.getElementById('btnConfirmEditSelectedDay').addEventListener('click', () => {
    const d = Number(document.getElementById('selEditDayTarget').value) || appState.currentDay || 1;
    const newLbl = document.getElementById('inpEditDayCustomLabel').value.trim();
    if (editSpecificDayInCycle(d, newLbl)) {
      document.getElementById('dayMgmtBoxEdit').classList.add('hidden');
    }
  });
  document.getElementById('inpEditDayCustomLabel').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      document.getElementById('btnConfirmEditSelectedDay').click();
    }
  });

  // Sync dropdown changes & pill clicks in Delete Day Box
  document.getElementById('selDeleteDayTarget').addEventListener('change', () => {
    if (typeof window.refreshDayManagementBoxesUI === 'function') window.refreshDayManagementBoxesUI();
  });
  document.getElementById('deleteDayQuickPills').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-pick-del-day]');
    if (!btn) return;
    const d = Number(btn.getAttribute('data-pick-del-day')) || 1;
    document.getElementById('selDeleteDayTarget').value = String(d);
    if (typeof window.refreshDayManagementBoxesUI === 'function') window.refreshDayManagementBoxesUI();
  });
  document.getElementById('btnConfirmDeleteSelectedDay').addEventListener('click', () => {
    const d = Number(document.getElementById('selDeleteDayTarget').value) || appState.currentDay || 1;
    if (deleteSpecificDayFromCycle(d)) {
      document.getElementById('dayMgmtBoxDelete').classList.add('hidden');
    }
  });

  // Delivered Cash & Carried-Forward Cash Inputs + Quick Settlement Buttons in Trial Balance
  document.getElementById('inpDeliveredCash').addEventListener('input', (e) => {
    if (isDayLocked(appState.currentDay)) {
      showToast('🔒 هذا اليوم مقفل ومعتمد محاسبياً — لا يمكن تعديل النقدية المسلمة إلا بعد فك القفل بواسطة مدير الموقع!', '🔒');
      renderDailyView();
      return;
    }
    const curD = appState.days[appState.currentDay];
    curD.deliveredCash = parseNum(e.target.value) || 0;
    curD.deliveredCashUpdatedAt = Math.max(getSyncedNow(), (Number(curD.deliveredCashUpdatedAt) || 0) + 10);
    saveState(true);
    renderDailyView();
  });

  const inpCarryForwardEl = document.getElementById('inpCarriedForwardCash');
  if (inpCarryForwardEl) {
    inpCarryForwardEl.addEventListener('input', (e) => {
      if (isDayLocked(appState.currentDay)) {
        showToast('🔒 هذا اليوم مقفل ومعتمد محاسبياً — لا يمكن تعديل الرصيد المرحّل إلا بعد فك القفل بواسطة مدير الموقع!', '🔒');
        renderDailyView();
        return;
      }
      const curD = appState.days[appState.currentDay];
      curD.carriedForwardCash = parseNum(e.target.value) || 0;
      curD.carriedForwardCashUpdatedAt = Math.max(getSyncedNow(), (Number(curD.carriedForwardCashUpdatedAt) || 0) + 10);
      saveState(true);
      renderDailyView();
    });
  }

  const btnDeliverAllCashEl = document.getElementById('btnDeliverAllAvailableCash');
  if (btnDeliverAllCashEl) {
    btnDeliverAllCashEl.addEventListener('click', () => {
      if (isDayLocked(appState.currentDay)) {
        showToast('🔒 هذا اليوم مقفل ومعتمد محاسبياً!', '🔒');
        return;
      }
      const s = computeDaySummary(appState.currentDay);
      const curD = appState.days[appState.currentDay];
      const targetDeliver = Math.max(0, Math.round(s.totalAvailableCashInBox - s.carriedForwardCash));
      curD.deliveredCash = targetDeliver;
      curD.deliveredCashUpdatedAt = Math.max(getSyncedNow(), (Number(curD.deliveredCashUpdatedAt) || 0) + 10);
      const inpEl = document.getElementById('inpDeliveredCash');
      if (inpEl) inpEl.value = fmtMoney(targetDeliver);
      saveState(true);
      renderDailyView();
      showToast(`⚡ تم تسجيل توريد المتاح بالخزنة (${fmtInt(targetDeliver)} ج.م) ومطابقة الصندوق بنجاح!`, '✅');
    });
  }

  const btnCarryRemCashEl = document.getElementById('btnCarryForwardRemainingCash');
  if (btnCarryRemCashEl) {
    btnCarryRemCashEl.addEventListener('click', () => {
      if (isDayLocked(appState.currentDay)) {
        showToast('🔒 هذا اليوم مقفل ومعتمد محاسبياً!', '🔒');
        return;
      }
      const s = computeDaySummary(appState.currentDay);
      const curD = appState.days[appState.currentDay];
      const remToCarry = Math.max(0, Math.round(s.totalAvailableCashInBox - s.deliveredCash));
      curD.carriedForwardCash = remToCarry;
      curD.carriedForwardCashUpdatedAt = Math.max(getSyncedNow(), (Number(curD.carriedForwardCashUpdatedAt) || 0) + 10);
      const inpEl = document.getElementById('inpCarriedForwardCash');
      if (inpEl) inpEl.value = fmtMoney(remToCarry);
      saveState(true);
      renderDailyView();
      showToast(`🔄 تم ترحيل باقي النقدية بالخزنة (${fmtInt(remToCarry)} ج.م) تلقائياً لليوم التالي ومطابقة الصندوق!`, '✅');
    });
  }

  // Merchant Instant Auto-Suggest without arrow
  const inpMerch = document.getElementById('inpMerchantName');
  const suggestBox = document.getElementById('merchantSuggestBox');

  function updateMerchantSuggestions() {
    const val = inpMerch.value.trim();
    const code = resolveMerchantCode(val);
    const codeDisp = document.getElementById('dispMerchantCode');
    if (code > 0) {
      const baseObj = appState.merchants.find(m => m.code === code);
      codeDisp.textContent = `كود ${code} (${baseObj ? baseObj.name : ''})`;
    } else if (val) {
      codeDisp.textContent = 'تاجر جديد (سيُكوّد تلقائياً)';
    } else {
      codeDisp.textContent = 'يُحدد تلقائياً';
    }

    const hasKarnak104 = Array.isArray(appState.merchants) && appState.merchants.some(m => m && Number(m.code) === 104 && String(m.name || '').includes('كرنك'));
    const candidates = [
      ...(appState.merchants || []).map(m => ({ label: m.name, code: m.code })),
      ...(hasKarnak104 ? [{ label: 'كرنك 1', code: 104 }, { label: 'كرنك 2', code: 104 }] : [])
    ];
    const filtered = val
      ? candidates.filter(c => c.label.includes(val) || String(c.code).includes(val))
      : candidates;

    if (filtered.length === 0) {
      suggestBox.classList.add('hidden');
      return;
    }

    suggestBox.innerHTML = filtered.map(c => `
      <div data-pick-merchant="${escXmlStr(c.label)}" class="px-3 py-2 hover:bg-blue-50 cursor-pointer flex items-center justify-between text-xs font-bold border-b border-slate-100">
        <span class="text-slate-900">${escXmlStr(c.label)}</span>
        <span class="px-2 py-0.5 rounded bg-blue-100 text-blue-900">كود ${c.code}</span>
      </div>
    `).join('');
    suggestBox.classList.remove('hidden');
  }

  inpMerch.addEventListener('input', updateMerchantSuggestions);
  inpMerch.addEventListener('focus', updateMerchantSuggestions);

  suggestBox.addEventListener('click', (e) => {
    const item = e.target.closest('[data-pick-merchant]');
    if (item) {
      inpMerch.value = item.getAttribute('data-pick-merchant');
      suggestBox.classList.add('hidden');
      updateMerchantSuggestions();
      const autoChk = document.getElementById('chkAutoDistributeCustody');
      const cCash = parseNum(document.getElementById('inpCustodyCash')?.value) || 0;
      const cTr = parseNum(document.getElementById('inpCustodyTransfer')?.value) || 0;
      if ((!autoChk || autoChk.checked) && (cCash > 0 || cTr > 0)) {
        distributeCustodyWaterfall({ silent: true, focusTarget: false });
      }
      updateLiveFormCalculation();
      if (isDebtCollectionOnlyMode()) {
        focusAndSelectField('inpDebtCash');
      } else {
        const carVal = (document.getElementById('inpCarNo').value || '').trim();
        focusAndSelectField(carVal ? 'inpW1' : 'inpCarNo');
      }
    }
  });

  document.addEventListener('click', (e) => {
    if (!inpMerch.contains(e.target) && !suggestBox.contains(e.target)) {
      suggestBox.classList.add('hidden');
    }
  });

  ['inpW1', 'inpW2', 'inpPrice', 'inpTip', 'inpCashSales', 'inpTransferSales', 'selTransferSalesType', 'inpCreditSales', 'inpCustodyCash', 'inpCustodyTransfer', 'selCustodyTransferType', 'inpDebtCash', 'inpDebtTransfer', 'selDebtTransferType', 'inpPrevCash', 'inpPrevTransfer', 'selPrevTransferType', 'inpNotes', 'inpMerchantName'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('input', updateLiveFormCalculation);
      el.addEventListener('change', updateLiveFormCalculation);
    }
  });

  // Persist Sticky Price and Tip whenever edited by user
  document.getElementById('inpPrice').addEventListener('change', (e) => {
    const v = parseNum(e.target.value);
    if (v >= 0) { appState.defaultPrice = v; saveState(false); }
  });
  document.getElementById('inpTip').addEventListener('change', (e) => {
    const v = parseNum(e.target.value);
    if (v >= 0) { appState.defaultTip = v; saveState(false); }
  });

  function calculateAndFillRemainingCredit(focusCreditInput = false) {
    const w1 = Math.max(0, parseNum(document.getElementById('inpW1').value) || 0);
    const w2 = Math.max(0, parseNum(document.getElementById('inpW2').value) || 0);
    if ((w1 > 0 || w2 > 0) && w2 < w1) {
      showToast('خطأ: الوزنة الثانية يجب أن تكون أكبر من أو تساوي الوزنة الأولى!', '⚠️');
      return false;
    }
    const netW = (w2 >= w1 && w2 > 0) ? (w2 - w1) : 0;
    const price = parseNum(document.getElementById('inpPrice').value) || 0;
    const tip = parseNum(document.getElementById('inpTip').value) || 0;
    const totalWithTip = (netW * price) + tip;
    const cashS = parseNum(document.getElementById('inpCashSales').value) || 0;
    const trS = parseNum(document.getElementById('inpTransferSales').value) || 0;
    const rem = Math.max(0, Math.round(totalWithTip - cashS - trS));
    const creditEl = document.getElementById('inpCreditSales');
    if (creditEl) {
      creditEl.value = rem > 0 ? fmtMoney(rem) : '0';
      if (focusCreditInput) {
        creditEl.focus();
        creditEl.select();
      }
    }
    updateLiveFormCalculation();
    return true;
  }

  document.getElementById('btnAutoFillCredit').addEventListener('click', () => {
    calculateAndFillRemainingCredit(true);
  });

  // =========================================================================
  // SMART CUSTODY WATERFALL ENGINE (التوزيع المحاسبي التلقائي المتدرج للعهدة)
  // 1. سداد المديونية السابقة أولاً ⬅️ 2. سداد فاتورة اليوم ⬅️ 3. حساب الآجل تلقائياً
  // =========================================================================
  function distributeCustodyWaterfall(options = {}) {
    const { silent = false, focusTarget = false } = options;
    const custCashEl = document.getElementById('inpCustodyCash');
    const custTrEl = document.getElementById('inpCustodyTransfer');
    const custTrTypeEl = document.getElementById('selCustodyTransferType');

    const custCash = Math.max(0, parseNum(custCashEl ? custCashEl.value : 0) || 0);
    const custTr = Math.max(0, parseNum(custTrEl ? custTrEl.value : 0) || 0);
    const custTrType = custTrTypeEl ? custTrTypeEl.value : '';
    const totalCustody = custCash + custTr;

    const w1 = Math.max(0, parseNum(document.getElementById('inpW1')?.value) || 0);
    const w2 = Math.max(0, parseNum(document.getElementById('inpW2')?.value) || 0);
    const hasValidW2 = (w2 >= w1 && w2 > 0);
    const netW = hasValidW2 ? (w2 - w1) : 0;
    const price = Math.max(0, parseNum(document.getElementById('inpPrice')?.value) || 0);
    const tip = Math.max(0, parseNum(document.getElementById('inpTip')?.value) || 0);
    const totalWithTip = hasValidW2 ? Math.round(((netW * price) + tip) * 100) / 100 : 0;

    const mName = (document.getElementById('inpMerchantName')?.value || '').trim();
    const editId = document.getElementById('editSaleId')?.value || '';
    const mCode = resolveMerchantCode(mName);
    const rawPrevDebt = mCode > 0 ? computeMerchantCurrentDebtExcluding(mCode, editId) : 0;
    const positivePrevDebt = Math.max(0, Math.round(rawPrevDebt));

    const inpDebtCashEl = document.getElementById('inpDebtCash');
    const inpDebtTrEl = document.getElementById('inpDebtTransfer');
    const selDebtTrTypeEl = document.getElementById('selDebtTransferType');
    const inpCashSalesEl = document.getElementById('inpCashSales');
    const inpTrSalesEl = document.getElementById('inpTransferSales');
    const selTrSalesTypeEl = document.getElementById('selTransferSalesType');
    const inpCreditSalesEl = document.getElementById('inpCreditSales');

    if (totalCustody <= 0) {
      if (inpDebtCashEl) inpDebtCashEl.value = '';
      if (inpDebtTrEl) inpDebtTrEl.value = '';
      if (inpCashSalesEl) inpCashSalesEl.value = '';
      if (inpTrSalesEl) inpTrSalesEl.value = '';
      if (inpCreditSalesEl) {
        inpCreditSalesEl.value = hasValidW2 && totalWithTip > 0 ? fmtMoney(Math.round(totalWithTip)) : '';
      }
      updateLiveFormCalculation();
      if (!silent) {
        showToast('💡 أدخل مبلغ العهدة (نقدية أو تحويل) أولاً ليتم توزيعه تلقائياً على المديونية والفاتورة!', 'ℹ️');
      }
      return false;
    }

    // الخطوة 1: سداد المديونية السابقة للمزرعة الحالية أولاً (وفي وضع سند تحصيل مديونية فقط، توجه العهدة بالكامل لسداد المديونية)
    const debtOnlyActive = isDebtCollectionOnlyMode();
    const allocDebtCash = debtOnlyActive ? custCash : Math.min(custCash, positivePrevDebt);
    const remCashAfterDebt = Math.max(0, custCash - allocDebtCash);
    const remDebtNeeded = Math.max(0, positivePrevDebt - allocDebtCash);
    const allocDebtTr = debtOnlyActive ? custTr : Math.min(custTr, remDebtNeeded);
    const remTrAfterDebt = Math.max(0, custTr - allocDebtTr);

    if (inpDebtCashEl) inpDebtCashEl.value = allocDebtCash > 0 ? fmtMoney(allocDebtCash) : '';
    if (inpDebtTrEl) inpDebtTrEl.value = allocDebtTr > 0 ? fmtMoney(allocDebtTr) : '';
    if (allocDebtTr > 0 && custTrType && selDebtTrTypeEl) {
      selDebtTrTypeEl.value = custTrType;
    }

    // الخطوة 2: توجيه المتبقي من العهدة لسداد فاتورة الوزنة الحالية (إذا تم إدخال الوزنة الثانية)
    let allocSalesCash = 0;
    let allocSalesTr = 0;
    let remCredit = 0;

    if (hasValidW2 && totalWithTip > 0) {
      allocSalesCash = Math.min(remCashAfterDebt, Math.round(totalWithTip));
      const remInvoiceAfterCash = Math.max(0, Math.round(totalWithTip) - allocSalesCash);
      allocSalesTr = Math.min(remTrAfterDebt, remInvoiceAfterCash);
      remCredit = Math.max(0, Math.round(totalWithTip - allocSalesCash - allocSalesTr));

      if (inpCashSalesEl) inpCashSalesEl.value = allocSalesCash > 0 ? fmtMoney(allocSalesCash) : '';
      if (inpTrSalesEl) inpTrSalesEl.value = allocSalesTr > 0 ? fmtMoney(allocSalesTr) : '';
      if (allocSalesTr > 0 && custTrType && selTrSalesTypeEl) {
        selTrSalesTypeEl.value = custTrType;
      }
      if (inpCreditSalesEl) inpCreditSalesEl.value = remCredit > 0 ? fmtMoney(remCredit) : '0';
    } else {
      // لم تُدخل الوزنة الثانية بعد (السيارة تحت التحميل - وزنة 1)
      if (inpCashSalesEl) inpCashSalesEl.value = '';
      if (inpTrSalesEl) inpTrSalesEl.value = '';
      if (inpCreditSalesEl) inpCreditSalesEl.value = '';
    }

    updateLiveFormCalculation();

    if (focusTarget) {
      if (hasValidW2) {
        focusAndSelectField('inpCreditSales');
      } else if (w1 <= 0) {
        focusAndSelectField('inpW1');
      } else {
        focusAndSelectField('inpW2');
      }
    }

    if (!silent) {
      const totalDebtPaid = allocDebtCash + allocDebtTr;
      const totalInvPaid = allocSalesCash + allocSalesTr;
      const surplus = Math.max(0, totalCustody - totalDebtPaid - totalInvPaid);
      if (hasValidW2) {
        showToast(
          `⚡ تم توزيع العهدة (${fmtInt(totalCustody)}): سداد مديونية (${fmtInt(totalDebtPaid)}) + سداد فاتورة اليوم (${fmtInt(totalInvPaid)}) + آجل (${fmtInt(remCredit)})${surplus > 0 ? ` | فائض عهدة: ${fmtInt(surplus)} ج.م` : ''}`,
          '✅'
        );
      } else {
        showToast(
          `⚡ تم خصم المديونية السابقة (${fmtInt(totalDebtPaid)} ج.م) من العهدة، والمتبقي (${fmtInt(surplus)} ج.م) سيُخصم من الفاتورة تلقائياً فور إدخال الوزنة الثانية!`,
          '⏳'
        );
      }
    }
    return true;
  }

  function depositCustodySurplusToMerchantAccount() {
    const custCash = Math.max(0, parseNum(document.getElementById('inpCustodyCash')?.value) || 0);
    const custTr = Math.max(0, parseNum(document.getElementById('inpCustodyTransfer')?.value) || 0);
    const custTrType = document.getElementById('selCustodyTransferType')?.value || '';
    const cashS = Math.max(0, parseNum(document.getElementById('inpCashSales')?.value) || 0);
    const trS = Math.max(0, parseNum(document.getElementById('inpTransferSales')?.value) || 0);
    const debtCash = Math.max(0, parseNum(document.getElementById('inpDebtCash')?.value) || 0);
    const debtTr = Math.max(0, parseNum(document.getElementById('inpDebtTransfer')?.value) || 0);

    const surplusCash = Math.max(0, custCash - debtCash - cashS);
    const surplusTr = Math.max(0, custTr - debtTr - trS);
    if ((surplusCash + surplusTr) <= 0) {
      showToast('لا يوجد فائض عهدة غير موزع حالياً.', 'ℹ️');
      return;
    }
    const inpDebtCashEl = document.getElementById('inpDebtCash');
    const inpDebtTrEl = document.getElementById('inpDebtTransfer');
    const selDebtTrTypeEl = document.getElementById('selDebtTransferType');
    if (surplusCash > 0 && inpDebtCashEl) {
      inpDebtCashEl.value = fmtMoney(debtCash + surplusCash);
    }
    if (surplusTr > 0 && inpDebtTrEl) {
      inpDebtTrEl.value = fmtMoney(debtTr + surplusTr);
      if (custTrType && selDebtTrTypeEl) selDebtTrTypeEl.value = custTrType;
    }
    updateLiveFormCalculation();
    showToast(
      `📥 تم إيداع فائض العهدة (${fmtInt(surplusCash + surplusTr)} ج.م) بالكامل في الخزنة/التحويلات وتسجيله كرصيد دائن تحت حساب التاجر!`,
      '✅'
    );
  }

  const btnDistCustEl = document.getElementById('btnDistributeCustodyWaterfall');
  if (btnDistCustEl) {
    btnDistCustEl.addEventListener('click', () => {
      distributeCustodyWaterfall({ silent: false, focusTarget: false });
    });
  }

  const btnStickyDistCustEl = document.getElementById('btnStickyDistributeCustody');
  if (btnStickyDistCustEl) {
    btnStickyDistCustEl.addEventListener('click', () => {
      distributeCustodyWaterfall({ silent: false, focusTarget: true });
    });
  }

  const btnDepSurplusEl = document.getElementById('btnDepositCustodySurplusToAccount');
  if (btnDepSurplusEl) {
    btnDepSurplusEl.addEventListener('click', () => {
      depositCustodySurplusToMerchantAccount();
    });
  }

  // Trigger automatic waterfall distribution when Custody fields or Weight/Price/Merchant change (if chkAutoDistributeCustody is checked)
  ['inpCustodyCash', 'inpCustodyTransfer', 'selCustodyTransferType'].forEach(cid => {
    const cel = document.getElementById(cid);
    if (!cel) return;
    const handler = () => {
      const autoChk = document.getElementById('chkAutoDistributeCustody');
      if (!autoChk || autoChk.checked) {
        const cCash = parseNum(document.getElementById('inpCustodyCash')?.value) || 0;
        const cTr = parseNum(document.getElementById('inpCustodyTransfer')?.value) || 0;
        if (cCash > 0 || cTr > 0 || cid !== 'selCustodyTransferType') {
          distributeCustodyWaterfall({ silent: true, focusTarget: false });
        }
      }
    };
    cel.addEventListener('input', handler);
    cel.addEventListener('change', handler);
    if (cid === 'inpCustodyCash' || cid === 'inpCustodyTransfer') {
      cel.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          distributeCustodyWaterfall({ silent: false, focusTarget: true });
        }
      });
    }
  });

  ['inpW1', 'inpW2', 'inpPrice', 'inpTip', 'inpMerchantName'].forEach(wid => {
    const wel = document.getElementById(wid);
    if (!wel) return;
    const wHandler = () => {
      const autoChk = document.getElementById('chkAutoDistributeCustody');
      const cCash = parseNum(document.getElementById('inpCustodyCash')?.value) || 0;
      const cTr = parseNum(document.getElementById('inpCustodyTransfer')?.value) || 0;
      if ((!autoChk || autoChk.checked) && (cCash > 0 || cTr > 0)) {
        distributeCustodyWaterfall({ silent: true, focusTarget: false });
      }
    };
    wel.addEventListener('input', wHandler);
    wel.addEventListener('change', wHandler);
  });

  function setSaleFormActionLabels(saveText = 'حفظ نهائي', isEditingOrRecalling = false) {
    const s1 = document.getElementById('btnSaveSaleText');
    const s2 = document.getElementById('btnInlineSaveSaleText');
    if (s1) s1.textContent = saveText;
    if (s2) s2.textContent = saveText;
    const cancelText = isEditingOrRecalling ? 'إلغاء التعديل' : 'إلغاء الإدخال';
    const c1 = document.getElementById('btnCancelEditSaleText');
    const c2 = document.getElementById('btnInlineCancelSaleText');
    if (c1) c1.textContent = cancelText;
    if (c2) c2.textContent = cancelText;
  }

  function cancelOrClearCurrentSaleEntry(showFeedbackToast = true) {
    const wasEditing = Boolean((document.getElementById('editSaleId') && document.getElementById('editSaleId').value) || activeRecalledPendingId);
    activeRecalledPendingId = '';
    const formEl = document.getElementById('saleEntryForm');
    if (formEl) formEl.reset();
    const editIdEl = document.getElementById('editSaleId');
    if (editIdEl) editIdEl.value = '';
    const codeDispEl = document.getElementById('dispMerchantCode');
    if (codeDispEl) codeDispEl.textContent = 'يُحدد تلقائياً';
    const suggestBoxEl = document.getElementById('merchantSuggestBox');
    if (suggestBoxEl) suggestBoxEl.classList.add('hidden');
    setSaleEntryMode('sale', { clearWeightFields: false, focusMerchantOrDebt: false, showModeToast: false });
    setSaleFormActionLabels('حفظ نهائي', false);
    resetPrevFarmsCollapsibleToDefault();
    applyStickySaleDefaults();
    updateLiveFormCalculation();
    if (showFeedbackToast) {
      showToast(
        wasEditing ? 'تم إلغاء التعديل وتفريغ خانات الإدخال بنجاح ✕' : 'تم إلغاء وتفريغ الإدخال الحالي بنجاح ✕',
        '↩️'
      );
    }
  }

  const btnInlineCancelEl = document.getElementById('btnInlineCancelSale');
  if (btnInlineCancelEl) {
    btnInlineCancelEl.addEventListener('click', () => {
      cancelOrClearCurrentSaleEntry(true);
    });
  }

  const btnModeScaleEl = document.getElementById('btnModeScaleSale');
  if (btnModeScaleEl) {
    btnModeScaleEl.addEventListener('click', () => {
      setSaleEntryMode('sale', { clearWeightFields: true, focusMerchantOrDebt: true, showModeToast: true });
    });
  }

  const btnModeDebtOnlyEl = document.getElementById('btnModeDebtCollectionOnly');
  if (btnModeDebtOnlyEl) {
    btnModeDebtOnlyEl.addEventListener('click', () => {
      setSaleEntryMode('debt_only', { clearWeightFields: true, focusMerchantOrDebt: true, showModeToast: true });
    });
  }

  const btnSwitchBackScaleEl = document.getElementById('btnSwitchBackToScaleMode');
  if (btnSwitchBackScaleEl) {
    btnSwitchBackScaleEl.addEventListener('click', () => {
      setSaleEntryMode('sale', { clearWeightFields: true, focusMerchantOrDebt: true, showModeToast: true });
    });
  }

  const prevFarmsHdrEl = document.getElementById('prevFarmsCollectionHeader');
  if (prevFarmsHdrEl) {
    prevFarmsHdrEl.addEventListener('click', (e) => {
      e.preventDefault();
      const bodyEl = document.getElementById('prevFarmsCollapsibleBody');
      const isCurrentlyHidden = bodyEl ? bodyEl.classList.contains('hidden') : true;
      setPrevFarmsSectionExpanded(isCurrentlyHidden, true);
      if (isCurrentlyHidden) {
        setTimeout(() => {
          const inpPrevCashEl = document.getElementById('inpPrevCash');
          if (inpPrevCashEl) inpPrevCashEl.focus();
        }, 60);
      }
    });
  }

  const btnInlineW1 = document.getElementById('btnInlineSavePendingW1');
  if (btnInlineW1) {
    btnInlineW1.addEventListener('click', () => {
      const mainBtnW1 = document.getElementById('btnSavePendingW1');
      if (mainBtnW1) mainBtnW1.click();
    });
  }

  const btnStickyAutoCreditEl = document.getElementById('btnStickyAutoCredit');
  if (btnStickyAutoCreditEl) {
    btnStickyAutoCreditEl.addEventListener('click', () => {
      if (calculateAndFillRemainingCredit(true)) {
        showToast('⚡ تم حساب باقي الفاتورة آجل تلقائياً', '⚡');
      }
    });
  }

  const chkFloatingBarEl = document.getElementById('chkShowFloatingActionBar');
  if (chkFloatingBarEl) {
    chkFloatingBarEl.addEventListener('change', (e) => {
      setFloatingActionBarVisibility(Boolean(e.target.checked), true);
    });
  }

  const btnToggleFloatingBarEl = document.getElementById('btnToggleFloatingActionBar');
  if (btnToggleFloatingBarEl) {
    btnToggleFloatingBarEl.addEventListener('click', () => {
      setFloatingActionBarVisibility(appState.showFloatingActionBar === false, true);
    });
  }

  // مستمعات خيارات تثبيت الجداول الـ 12 (رؤوس الجداول، الإجماليات السفلية، الأعمدة اليمنى، أعمدة الإجراءات اليسرى)
  const stickyCheckboxMap = [
    { id: 'chkStickyTableHeaders', key: 'headers', label: 'رؤوس الجداول (Sticky Headers)' },
    { id: 'chkStickyTableFooters', key: 'footers', label: 'صفوف الإجماليات السفلية (Sticky Footers)' },
    { id: 'chkStickyTableRightCols', key: 'rightCols', label: 'الأعمدة المحورية يميناً (اسم التاجر/البيان)' },
    { id: 'chkStickyTableLeftCols', key: 'leftCols', label: 'أعمدة الإجراءات يساراً (أزرار التعديل والحذف)' }
  ];

  stickyCheckboxMap.forEach(item => {
    const chkEl = document.getElementById(item.id);
    if (chkEl) {
      chkEl.addEventListener('change', (e) => {
        const isChecked = Boolean(e.target.checked);
        setStickyTableOptions(
          { [item.key]: isChecked },
          isChecked ? `📌 تم تفعيل تثبيت: ${item.label} في جميع الجداول` : `🔓 تم إيقاف تثبيت: ${item.label}`
        );
      });
    }
  });

  const btnStickyAllOn = document.getElementById('btnStickyTablesEnableAll');
  if (btnStickyAllOn) {
    btnStickyAllOn.addEventListener('click', () => {
      setStickyTableOptions(
        { headers: true, footers: true, rightCols: true, leftCols: true },
        '📌 تم تفعيل تثبيت جميع العناصر الـ 4 (الرؤوس + الإجماليات + الأعمدة اليمنى واليسرى) في كل الجداول!'
      );
    });
  }

  const btnStickyAllOff = document.getElementById('btnStickyTablesDisableAll');
  if (btnStickyAllOff) {
    btnStickyAllOff.addEventListener('click', () => {
      setStickyTableOptions(
        { headers: false, footers: false, rightCols: false, leftCols: false },
        '🔓 تم إلغاء تثبيت جميع الرؤوس والأعمدة في الجداول'
      );
    });
  }

  const btnDdStickySettings = document.getElementById('btnDropdownStickyTablesSettings');
  if (btnDdStickySettings) {
    btnDdStickySettings.addEventListener('click', (e) => {
      e.preventDefault();
      if (userMenuDropdown) userMenuDropdown.classList.add('hidden');
      if (isLiteFieldModeEffective()) {
        setLiteFieldMode(false, false);
      }
      const syncTabBtn = document.querySelector('[data-nav="sync"]');
      if (syncTabBtn) syncTabBtn.click();
      setTimeout(() => {
        const box = document.getElementById('stickyTablesControlBox');
        if (box) box.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 90);
    });
  }

  const chkAuditMetaEl = document.getElementById('chkShowAuditMetadata');
  if (chkAuditMetaEl) {
    chkAuditMetaEl.addEventListener('change', (e) => {
      setAuditMetadataVisibility(Boolean(e.target.checked), true);
    });
  }

  const btnToggleAuditMetaEl = document.getElementById('btnToggleAuditMetadata');
  if (btnToggleAuditMetaEl) {
    btnToggleAuditMetaEl.addEventListener('click', () => {
      setAuditMetadataVisibility(appState.showAuditMetadata === false, true);
    });
  }

  const btnToggleAuditMetaHdrEl = document.getElementById('btnToggleAuditMetadataHeader');
  if (btnToggleAuditMetaHdrEl) {
    btnToggleAuditMetaHdrEl.addEventListener('click', () => {
      setAuditMetadataVisibility(appState.showAuditMetadata === false, true);
    });
  }

  // أزرار التحكم في وضع شاشة المندوب المبسط (Lite Field Mode)
  ['btnHeaderToggleLiteFieldMode', 'btnToggleLiteFieldModeCard'].forEach(btnId => {
    const el = document.getElementById(btnId);
    if (el) {
      el.addEventListener('click', () => {
        setLiteFieldMode(!isLiteFieldModeEffective(), true);
      });
    }
  });

  const btnDdLite = document.getElementById('btnDropdownToggleLiteFieldMode');
  if (btnDdLite) {
    btnDdLite.addEventListener('click', () => {
      if (userMenuDropdown) userMenuDropdown.classList.add('hidden');
      setLiteFieldMode(!isLiteFieldModeEffective(), true);
    });
  }

  const btnExitLiteBanner = document.getElementById('btnExitLiteFieldModeBanner');
  if (btnExitLiteBanner) {
    btnExitLiteBanner.addEventListener('click', () => {
      setLiteFieldMode(false, true);
    });
  }

  const chkLiteEl = document.getElementById('chkEnableLiteFieldMode');
  if (chkLiteEl) {
    chkLiteEl.addEventListener('change', (e) => {
      setLiteFieldMode(Boolean(e.target.checked), true);
    });
  }

  const chkAutoLiteMobileEl = document.getElementById('chkAutoLiteFieldOnMobile');
  if (chkAutoLiteMobileEl) {
    chkAutoLiteMobileEl.addEventListener('change', (e) => {
      appState.autoLiteFieldOnMobile = Boolean(e.target.checked);
      try {
        localStorage.setItem(STORAGE_KEY + '_auto_lite_on_mobile', appState.autoLiteFieldOnMobile ? '1' : '0');
      } catch (err) {}
      updateLiteFieldModeUI();
      renderDailyView();
      saveState(true);
      showToast(
        appState.autoLiteFieldOnMobile
          ? '📱 تم تفعيل التحويل التلقائي لشاشة المندوب المبسط عند الدخول من الموبايل'
          : '⏸️ تم إيقاف التحويل التلقائي على الموبايل (يمكن التفعيل يدوياً من الزر العلوي)',
        '📱'
      );
    });
  }

  const selLiteDayEl = document.getElementById('selLiteQuickDaySwitcher');
  if (selLiteDayEl) {
    selLiteDayEl.addEventListener('change', (e) => {
      const targetDay = Number(e.target.value) || 1;
      appState.currentDay = targetDay;
      saveState(false);
      renderAll();
      showToast(`تم الانتقال إلى محضر (يوم ${targetDay})`, '📅');
    });
  }

  // تفويض أحداث شريط البطاقات الأفقية للوزنات المؤقتة في وضع المندوب
  const litePendListEl = document.getElementById('litePendingCardsHorizontalList');
  if (litePendListEl) {
    litePendListEl.addEventListener('click', (e) => {
      const printBtn = e.target.closest('[data-print-receipt]');
      if (printBtn) {
        e.preventDefault();
        e.stopPropagation();
        const sId = printBtn.getAttribute('data-print-receipt');
        const sDay = Number(printBtn.getAttribute('data-receipt-day')) || appState.currentDay || 1;
        if (sId) triggerTablePrint(`scaleReceipt:${sDay}:${sId}`);
        return;
      }
      const delBtn = e.target.closest('[data-del-pending]');
      if (delBtn) {
        e.preventDefault();
        e.stopPropagation();
        deletePendingSaleById(delBtn.getAttribute('data-del-pending'));
        return;
      }
      const recBtn = e.target.closest('[data-recall-pending]');
      if (recBtn) {
        e.preventDefault();
        recallPendingSaleById(recBtn.getAttribute('data-recall-pending'));
      }
    });
  }

  // تفويض أحداث بطاقات سجل حركات البيع المسجلة في وضع المندوب
  const liteSalesCardsEl = document.getElementById('liteSalesCardsContainer');
  if (liteSalesCardsEl) {
    liteSalesCardsEl.addEventListener('click', (e) => {
      const targetBtn = e.target.closest('button');
      if (!targetBtn) return;
      const printRecBtn = e.target.closest('[data-print-receipt]');
      if (printRecBtn) {
        const sId = printRecBtn.getAttribute('data-print-receipt');
        const sDay = Number(printRecBtn.getAttribute('data-receipt-day')) || appState.currentDay || 1;
        if (sId) triggerTablePrint(`scaleReceipt:${sDay}:${sId}`);
        return;
      }
      const expImgRecBtn = e.target.closest('[data-export-receipt-img]');
      if (expImgRecBtn) {
        const sId = expImgRecBtn.getAttribute('data-export-receipt-img');
        const sDay = Number(expImgRecBtn.getAttribute('data-receipt-day')) || appState.currentDay || 1;
        if (sId) exportScaleReceiptAsImageOrPdf(sId, sDay, 'png');
        return;
      }
      if (!hasPermission('sales') || isDayLocked(appState.currentDay)) {
        showToast('🔒 عفواً، اليوم مقفل أو الحساب للعرض فقط!', '🔒');
        return;
      }
      const recPend = e.target.closest('[data-recall-pending]');
      if (recPend) {
        recallPendingSaleById(recPend.getAttribute('data-recall-pending'));
        return;
      }
      const delPend = e.target.closest('[data-del-pending]');
      if (delPend) {
        deletePendingSaleById(delPend.getAttribute('data-del-pending'));
        return;
      }
      const editSaleBtn = e.target.closest('[data-edit-sale]');
      if (editSaleBtn) {
        const sId = editSaleBtn.getAttribute('data-edit-sale');
        const tblEditBtn = document.querySelector(`#dailySalesTbody [data-edit-sale="${CSS.escape(sId)}"]`);
        if (tblEditBtn) tblEditBtn.click();
        return;
      }
      const delSaleBtn = e.target.closest('[data-del-sale]');
      if (delSaleBtn) {
        const sId = delSaleBtn.getAttribute('data-del-sale');
        const tblDelBtn = document.querySelector(`#dailySalesTbody [data-del-sale="${CSS.escape(sId)}"]`);
        if (tblDelBtn) tblDelBtn.click();
      }
    });
  }

  // تحديث بطاقات وضع المندوب عند البحث السريع
  const inpSearchDailyLite = document.getElementById('inpFilterDailySales');
  if (inpSearchDailyLite) {
    inpSearchDailyLite.addEventListener('input', () => {
      if (isLiteFieldModeEffective()) {
        const d = appState.currentDay || 1;
        renderLiteFieldModeComponents(d, computeDaySummary(d), hasPermission('sales') && !isDayLocked(d), isDayLocked(d));
      }
    });
  }

  // أحداث أيقونة وشريط البحث السريع في سيارات تحت التحميل بانتظار الوزنة 2 (وضع المندوب)
  const btnToggleLitePendSearch = document.getElementById('btnToggleLitePendingSearch');
  const litePendSearchWrap = document.getElementById('litePendingSearchBoxWrapper');
  const inpLitePendSearch = document.getElementById('inpLiteFilterPendingCards');
  const btnClearLitePendSearch = document.getElementById('btnClearLitePendingSearch');

  if (btnToggleLitePendSearch && litePendSearchWrap) {
    btnToggleLitePendSearch.addEventListener('click', () => {
      const willShow = litePendSearchWrap.classList.contains('hidden');
      litePendSearchWrap.classList.toggle('hidden', !willShow);
      if (willShow && inpLitePendSearch) {
        setTimeout(() => inpLitePendSearch.focus(), 40);
      } else if (!willShow && inpLitePendSearch && inpLitePendSearch.value) {
        inpLitePendSearch.value = '';
      }
      const d = appState.currentDay || 1;
      renderLiteFieldModeComponents(d, computeDaySummary(d), hasPermission('sales') && !isDayLocked(d), isDayLocked(d));
    });
  }

  if (inpLitePendSearch) {
    inpLitePendSearch.addEventListener('input', () => {
      const d = appState.currentDay || 1;
      renderLiteFieldModeComponents(d, computeDaySummary(d), hasPermission('sales') && !isDayLocked(d), isDayLocked(d));
    });
  }

  if (btnClearLitePendSearch) {
    btnClearLitePendSearch.addEventListener('click', () => {
      if (inpLitePendSearch) inpLitePendSearch.value = '';
      if (litePendSearchWrap) litePendSearchWrap.classList.add('hidden');
      const d = appState.currentDay || 1;
      renderLiteFieldModeComponents(d, computeDaySummary(d), hasPermission('sales') && !isDayLocked(d), isDayLocked(d));
    });
  }

  // تفعيل التنقل السريع بزر Enter بين حقول الميزان والبيع (وزنة 1 ⬅️ وزنة 2 ⬅️ نقدي مبيعات ⬅️ باقي الفاتورة آجل)
  function focusAndSelectField(fieldId) {
    const el = document.getElementById(fieldId);
    if (!el) return;
    el.focus();
    if (typeof el.select === 'function') {
      setTimeout(() => {
        try { el.select(); } catch (err) {}
      }, 10);
    }
  }

  const fastEnterSaleFields = [
    'inpMerchantName',
    'inpScaleNo',
    'inpCarNo',
    'inpW1',
    'inpW2',
    'inpPrice',
    'inpTip',
    'inpCashSales',
    'inpCreditSales',
    'inpDebtCash',
    'inpDebtTransfer'
  ];

  fastEnterSaleFields.forEach((fieldId) => {
    const inpEl = document.getElementById(fieldId);
    if (!inpEl) return;
    inpEl.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();

      if (fieldId === 'inpMerchantName') {
        if (suggestBox && !suggestBox.classList.contains('hidden')) {
          const firstPick = suggestBox.querySelector('[data-pick-merchant]');
          const curVal = inpMerch.value.trim();
          if (firstPick && curVal && !appState.merchants.some(m => m.name === curVal)) {
            inpMerch.value = firstPick.getAttribute('data-pick-merchant');
          }
          suggestBox.classList.add('hidden');
        }
        updateMerchantSuggestions();
        updateLiveFormCalculation();
        const carVal = (document.getElementById('inpCarNo').value || '').trim();
        focusAndSelectField(carVal ? 'inpW1' : 'inpCarNo');
        return;
      }

      if (fieldId === 'inpScaleNo') {
        focusAndSelectField('inpCarNo');
        return;
      }

      if (fieldId === 'inpCarNo') {
        focusAndSelectField(isDebtCollectionOnlyMode() ? 'inpDebtCash' : 'inpW1');
        return;
      }

      // 1) وزنة 1 ⬅️ وزنة 2
      if (fieldId === 'inpW1') {
        updateLiveFormCalculation();
        focusAndSelectField('inpW2');
        return;
      }

      // 2) وزنة 2 ⬅️ توزيع العهدة تلقائياً (إن وجدت) أو الانتقال لنقدي المبيعات
      if (fieldId === 'inpW2') {
        const w1 = Math.max(0, parseNum(document.getElementById('inpW1').value) || 0);
        const w2 = Math.max(0, parseNum(document.getElementById('inpW2').value) || 0);
        if (w2 > 0 && w2 < w1) {
          updateLiveFormCalculation();
          showToast('⚠️ الوزنة الثانية (القائم) يجب أن تكون أكبر من أو تساوي الوزنة الأولى!', '⚠️');
          return;
        }
        const cCash = parseNum(document.getElementById('inpCustodyCash')?.value) || 0;
        const cTr = parseNum(document.getElementById('inpCustodyTransfer')?.value) || 0;
        if (cCash > 0 || cTr > 0) {
          distributeCustodyWaterfall({ silent: false, focusTarget: true });
          return;
        }
        updateLiveFormCalculation();
        focusAndSelectField('inpCashSales');
        return;
      }

      if (fieldId === 'inpPrice') {
        updateLiveFormCalculation();
        focusAndSelectField('inpTip');
        return;
      }

      if (fieldId === 'inpTip') {
        updateLiveFormCalculation();
        focusAndSelectField('inpCashSales');
        return;
      }

      // 3) نقدي مبيعات ⬅️ باقي الفاتورة آجل (حساب تلقائي + تركيز على حقل الآجل)
      if (fieldId === 'inpCashSales') {
        if (calculateAndFillRemainingCredit(true)) {
          showToast('⚡ تم حساب باقي الفاتورة آجل تلقائياً — اضغط Enter للحفظ النهائي', '⚡');
        }
        return;
      }

      if (fieldId === 'inpDebtCash') {
        updateLiveFormCalculation();
        if (isDebtCollectionOnlyMode()) {
          const dcVal = parseNum(document.getElementById('inpDebtCash').value) || 0;
          const dtVal = parseNum(document.getElementById('inpDebtTransfer').value) || 0;
          if (dcVal > 0 || dtVal > 0) {
            const btnSave = document.getElementById('btnSaveSale');
            if (btnSave) btnSave.click();
          } else {
            focusAndSelectField('inpDebtTransfer');
          }
        }
        return;
      }

      if (fieldId === 'inpDebtTransfer') {
        updateLiveFormCalculation();
        if (isDebtCollectionOnlyMode()) {
          const dtVal = parseNum(document.getElementById('inpDebtTransfer').value) || 0;
          const dtType = document.getElementById('selDebtTransferType')?.value || '';
          if (dtVal > 0 && !dtType) {
            document.getElementById('selDebtTransferType')?.focus();
          } else {
            const btnSave = document.getElementById('btnSaveSale');
            if (btnSave) btnSave.click();
          }
        }
        return;
      }

      // 4) باقي الفاتورة آجل ⬅️ حفظ الحركة النهائية (أو حفظ مؤقت إذا كانت وزنة 1 فقط)
      if (fieldId === 'inpCreditSales') {
        updateLiveFormCalculation();
        const w1 = Math.max(0, parseNum(document.getElementById('inpW1').value) || 0);
        const w2 = Math.max(0, parseNum(document.getElementById('inpW2').value) || 0);
        if (w2 >= w1 && w2 > 0) {
          const btnSave = document.getElementById('btnSaveSale');
          if (btnSave) btnSave.click();
        } else if (w1 > 0 && w2 <= 0) {
          const btnPend = document.getElementById('btnSavePendingW1');
          if (btnPend) btnPend.focus();
          showToast('💡 أدخل الوزنة الثانية للحفظ النهائي أو اضغط (⏳ حفظ مؤقت وزنة 1)', '⏳');
        }
      }
    });
  });

  // حفظ مؤقت للوزنة الأولى والبيانات لحين استكمال الوزنة الثانية
  activeRecalledPendingId = '';

  function recallPendingSaleById(pid) {
    if (!hasPermission('sales')) return;
    if (isDayLocked(appState.currentDay)) {
      showToast('🔒 هذا اليوم مقفل ومعتمد محاسبياً — لا يمكن تعديل أو استرجاع حركات إلا بعد فك القفل!', '🔒');
      return;
    }
    const dayObj = appState.days[appState.currentDay];
    const item = (dayObj.pendingSales || []).find(x => x.id === pid);
    if (!item) return;
    activeRecalledPendingId = item.id;
    setSaleEntryMode('sale', { clearWeightFields: false, focusMerchantOrDebt: false, showModeToast: false });
    document.getElementById('editSaleId').value = '';
    document.getElementById('inpMerchantName').value = item.merchant;
    document.getElementById('inpScaleNo').value = item.scaleNo || '';
    document.getElementById('inpCarNo').value = item.carNo || '';
    document.getElementById('inpW1').value = item.w1 ? fmtMoney(item.w1) : '';
    document.getElementById('inpW2').value = item.w2 ? fmtMoney(item.w2) : '';
    document.getElementById('inpPrice').value = item.price ? fmtMoney(item.price) : '';
    document.getElementById('inpTip').value = item.tip !== undefined ? fmtMoney(item.tip) : '';
    document.getElementById('inpCustodyCash').value = item.custodyCash ? fmtMoney(item.custodyCash) : '';
    document.getElementById('inpCustodyTransfer').value = item.custodyTransfer ? fmtMoney(item.custodyTransfer) : '';
    document.getElementById('selCustodyTransferType').value = item.custodyTransferType || '';
    document.getElementById('inpCashSales').value = item.cashSales ? fmtMoney(item.cashSales) : '';
    document.getElementById('inpTransferSales').value = item.transferSales ? fmtMoney(item.transferSales) : '';
    document.getElementById('selTransferSalesType').value = item.transferSalesType || '';
    document.getElementById('inpCreditSales').value = item.creditSales ? fmtMoney(item.creditSales) : '';
    document.getElementById('inpDebtCash').value = item.debtCash ? fmtMoney(item.debtCash) : '';
    document.getElementById('inpDebtTransfer').value = item.debtTransfer ? fmtMoney(item.debtTransfer) : '';
    document.getElementById('selDebtTransferType').value = item.debtTransferType || '';
    document.getElementById('inpPrevCash').value = item.prevCash ? fmtMoney(item.prevCash) : '';
    document.getElementById('inpPrevTransfer').value = item.prevTransfer ? fmtMoney(item.prevTransfer) : '';
    document.getElementById('selPrevTransferType').value = item.prevTransferType || '';
    document.getElementById('inpNotes').value = item.notes || '';
    setSaleFormActionLabels(`حفظ نهائي (ميزان ${item.scaleNo || ''})`, true);
    updateMerchantSuggestions();
    updateLiveFormCalculation();
    document.getElementById('saleFormCard').scrollIntoView({ behavior: 'smooth' });
    setTimeout(() => document.getElementById('inpW2').focus(), 100);
    showToast(`تم استرجاع حركة (${item.merchant}) المحجوزة بمسلسل ميزان (${item.scaleNo || '-'}) — أدخل الآن (الوزنة الثانية) واضغط حفظ!`, '🔄');
  }

  function deletePendingSaleById(pid) {
    if (!hasPermission('sales')) return;
    if (isDayLocked(appState.currentDay)) {
      showToast('🔒 هذا اليوم مقفل ومعتمد محاسبياً — لا يمكن حذف حركات إلا بعد فك القفل!', '🔒');
      return;
    }
    recordDeletedItem('pendingSales', pid);
    const dayObj = appState.days[appState.currentDay];
    dayObj.pendingSales = (dayObj.pendingSales || []).filter(x => x.id !== pid);
    if (activeRecalledPendingId === pid) {
      cancelOrClearCurrentSaleEntry(false);
    }
    saveState(true);
    renderAll();
    showToast('تم حذف الوزنة المؤقتة المحجوزة وتحديث الجدول', '🗑️');
  }

  document.getElementById('btnSavePendingW1').addEventListener('click', () => {
    if (!hasPermission('sales')) {
      showToast('عفواً، هذه الصلاحية غير متاحة لحسابك الحالي.', '🔒');
      return;
    }
    if (isDayLocked(appState.currentDay)) {
      showToast('🔒 هذا اليوم مقفل ومعتمد محاسبياً — لا يمكن إضافة أو تعديل حركات بيع إلا بعد فك القفل بواسطة مدير الموقع!', '🔒');
      return;
    }
    if (isDayLocked(appState.currentDay)) {
      showToast('🔒 هذا اليوم مقفل ومعتمد محاسبياً — لا يمكن إضافة أو تعديل وزنات مؤقتة إلا بعد فك القفل بواسطة مدير الموقع!', '🔒');
      return;
    }
    const mName = document.getElementById('inpMerchantName').value.trim();
    const w1Val = parseNum(document.getElementById('inpW1').value);
    if (!mName) {
      showToast('يرجى إدخال اسم التاجر / السيارة أولاً لحفظ الوزنة الأولى مؤقتاً!', '⚠️');
      document.getElementById('inpMerchantName').focus();
      return;
    }
    if (w1Val <= 0) {
      showToast('يرجى إدخال (الوزنة الأولى - فارغ) لحفظ الحركة مؤقتاً!', '⚠️');
      document.getElementById('inpW1').focus();
      return;
    }
    ensureMerchantExists(mName);
    const dayObj = appState.days[appState.currentDay];
    if (!Array.isArray(dayObj.pendingSales)) dayObj.pendingSales = [];

    let enteredScale = Number(document.getElementById('inpScaleNo').value) || getNextSequentialScaleNo();
    const scaleConflict = [...(dayObj.sales || []), ...(dayObj.pendingSales || [])].find(x =>
      x.id !== activeRecalledPendingId && Number(x.scaleNo) > 0 && Number(x.scaleNo) === enteredScale
    );
    if (scaleConflict) {
      const nextFree = getNextSequentialScaleNo();
      showToast(`⚠️ مسلسل الميزان (${enteredScale}) محجوز بالفعل للتاجر (${scaleConflict.merchant})! تم حجز المسلسل التلقائي (${nextFree}).`, '⚠️');
      enteredScale = nextFree;
      document.getElementById('inpScaleNo').value = enteredScale;
    }

    const enteredPrice = parseNum(document.getElementById('inpPrice').value) || appState.defaultPrice || 78.02;
    const enteredTip = parseNum(document.getElementById('inpTip').value);

    appState.defaultPrice = enteredPrice;
    appState.defaultTip = enteredTip;
    appState.lastScaleNo = Math.max(Number(appState.lastScaleNo) || 0, enteredScale);

    const existingPendingForAudit = activeRecalledPendingId
      ? dayObj.pendingSales.find(x => x.id === activeRecalledPendingId)
      : null;
    const candidatePendingFields = {
      merchant: mName,
      scaleNo: enteredScale,
      carNo: Number(document.getElementById('inpCarNo').value) || '',
      w1: w1Val,
      w2: parseNum(document.getElementById('inpW2').value) || 0,
      price: enteredPrice,
      tip: enteredTip,
      custodyCash: parseNum(document.getElementById('inpCustodyCash').value) || 0,
      custodyTransfer: parseNum(document.getElementById('inpCustodyTransfer').value) || 0,
      custodyTransferType: document.getElementById('selCustodyTransferType').value,
      cashSales: parseNum(document.getElementById('inpCashSales').value) || 0,
      transferSales: parseNum(document.getElementById('inpTransferSales').value) || 0,
      transferSalesType: document.getElementById('selTransferSalesType').value,
      creditSales: parseNum(document.getElementById('inpCreditSales').value) || 0,
      debtCash: parseNum(document.getElementById('inpDebtCash').value) || 0,
      debtTransfer: parseNum(document.getElementById('inpDebtTransfer').value) || 0,
      debtTransferType: document.getElementById('selDebtTransferType').value,
      prevCash: parseNum(document.getElementById('inpPrevCash').value) || 0,
      prevTransfer: parseNum(document.getElementById('inpPrevTransfer').value) || 0,
      prevTransferType: document.getElementById('selPrevTransferType').value,
      notes: document.getElementById('inpNotes').value.trim()
    };
    const pendingAuditMeta = buildRecordAuditMeta(
      existingPendingForAudit,
      Boolean(existingPendingForAudit),
      candidatePendingFields,
      'pending'
    );
    const pendingObj = {
      id: activeRecalledPendingId || generateRecordUUID(`pend_d${appState.currentDay}`),
      ...pendingAuditMeta,
      ...candidatePendingFields
    };

    const dupPending = dayObj.pendingSales.find(x =>
      x.id !== pendingObj.id &&
      String(x.merchant || '').trim() === pendingObj.merchant &&
      String(x.carNo || '').trim() === String(pendingObj.carNo || '').trim() &&
      Number(x.w1) === Number(pendingObj.w1)
    );
    if (dupPending) {
      showToast('⚠️ هذه السيارة محفوظة مؤقتاً بالفعل بنفس الوزنة الأولى والبيانات!', '⚠️');
      return;
    }

    unrecordDeletedItem('pendingSales', pendingObj.id);
    dayObj.addedAt = getSyncedNow();
    dayObj.clearedAt = 0;
    dayObj.isHidden = false;
    const existingIdx = dayObj.pendingSales.findIndex(x => x.id === pendingObj.id);
    if (existingIdx !== -1) dayObj.pendingSales[existingIdx] = pendingObj;
    else dayObj.pendingSales.push(pendingObj);
    dayObj.pendingSales = sortSalesListByScaleNo(dayObj.pendingSales);

    cancelOrClearCurrentSaleEntry(false);
    saveState(true);
    renderAll();
    showToast(`تم حجز مسلسل الميزان رقم (${enteredScale}) للتاجر (${mName}) وحفظ ترتيبه في جدول حركات البيع المسجلة (وزنة أولى: ${fmtMoney(w1Val)} كجم)!`, '⏳');
  });

  // استرجاع أو حذف سيارة محفوظة مؤقتاً (وزنة أولى)
  document.getElementById('pendingWeighInsTbody').addEventListener('click', (e) => {
    const recBtn = e.target.closest('[data-recall-pending]');
    if (recBtn) {
      recallPendingSaleById(recBtn.getAttribute('data-recall-pending'));
      return;
    }
    const delBtn = e.target.closest('[data-del-pending]');
    if (delBtn) {
      deletePendingSaleById(delBtn.getAttribute('data-del-pending'));
    }
  });

  // Save or Update Final Sale Entry (Requires Weight 2!)
  document.getElementById('saleEntryForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const mName = document.getElementById('inpMerchantName').value.trim();
    if (!mName) return;

    ensureMerchantExists(mName);
    const editId = document.getElementById('editSaleId').value;
    const dayObj = appState.days[appState.currentDay];
    const daySales = dayObj.sales;

    if (!hasPermission('sales')) {
      showToast('عفواً، هذه الصلاحية غير متاحة لحسابك الحالي.', '🔒');
      return;
    }
    if (isDayLocked(appState.currentDay)) {
      showToast('🔒 هذا اليوم مقفل ومعتمد محاسبياً — لا يمكن إضافة أو تعديل حركات بيع إلا بعد فك القفل بواسطة مدير الموقع!', '🔒');
      return;
    }
    const debtOnlyMode = isDebtCollectionOnlyMode();
    const checkW1 = debtOnlyMode ? 0 : (parseNum(document.getElementById('inpW1').value) || 0);
    const checkW2 = debtOnlyMode ? 0 : (parseNum(document.getElementById('inpW2').value) || 0);
    const checkDebtCash = parseNum(document.getElementById('inpDebtCash').value) || 0;
    const checkDebtTr = parseNum(document.getElementById('inpDebtTransfer').value) || 0;
    const checkPrevCash = parseNum(document.getElementById('inpPrevCash').value) || 0;
    const checkPrevTr = parseNum(document.getElementById('inpPrevTransfer').value) || 0;
    const totalDebtOrPrevCollected = checkDebtCash + checkDebtTr + checkPrevCash + checkPrevTr;
    const isStandaloneDebtVoucher = Boolean(debtOnlyMode || (checkW1 <= 0 && checkW2 <= 0 && totalDebtOrPrevCollected > 0));

    if (isStandaloneDebtVoucher) {
      if (totalDebtOrPrevCollected <= 0) {
        focusAndSelectField('inpDebtCash');
        showToast('⚠️ في وضع (سند تحصيل مديونية فقط): يرجى إدخال المبلغ المحصل نقداً أو تحويلاً أولاً قبل الحفظ!', '⚠️');
        return;
      }
    } else {
      if (checkW2 <= 0) {
        document.getElementById('inpW2').focus();
        showToast('⚠️ لا يمكن حفظ النتيجة النهائية إلا بعد إدخال (الوزنة الثانية)! إذا كانت السيارة تحت التحميل اضغط (⏳ حفظ مؤقت وزنة 1) أو اختر وضع (💵 سند تحصيل مديونية فقط).', '⚠️');
        return;
      }
      if (checkW2 < checkW1) {
        const wAlert = document.getElementById('weightValidationAlert');
        if (wAlert) wAlert.classList.remove('hidden');
        document.getElementById('inpW2').focus();
        showToast('خطأ في الميزان: الوزنة الثانية يجب أن تكون أكبر من أو تساوي الوزنة الأولى!', '❌');
        return;
      }
    }
    const enteredScale = Number(document.getElementById('inpScaleNo').value) || getNextSequentialScaleNo();
    const scaleConflict = [...(daySales || []), ...(dayObj.pendingSales || [])].find(x => {
      if (editId && x.id === editId) return false;
      if (activeRecalledPendingId && x.id === activeRecalledPendingId) return false;
      if (String(x.merchant || '').trim() === mName && Number(x.scaleNo) === enteredScale) return false;
      return Number(x.scaleNo) > 0 && Number(x.scaleNo) === enteredScale;
    });
    if (scaleConflict) {
      const nextFree = getNextSequentialScaleNo();
      showToast(`⚠️ مسلسل الميزان (${enteredScale}) محجوز بالفعل للتاجر (${scaleConflict.merchant})! تم وضع المسلسل المتاح (${nextFree}).`, '⚠️');
      document.getElementById('inpScaleNo').value = nextFree;
      document.getElementById('inpScaleNo').focus();
      return;
    }

    const enteredPrice = isStandaloneDebtVoucher ? 0 : (parseNum(document.getElementById('inpPrice').value) || 0);
    const enteredTip = isStandaloneDebtVoucher ? 0 : (parseNum(document.getElementById('inpTip').value) || 0);

    if (!isStandaloneDebtVoucher && enteredPrice > 0) {
      appState.defaultPrice = enteredPrice;
      appState.defaultTip = enteredTip;
    }
    appState.lastScaleNo = Math.max(Number(appState.lastScaleNo) || 0, enteredScale);

    const existingSaleForAudit = editId ? daySales.find(x => x.id === editId) : null;
    const recalledPendForAudit = !existingSaleForAudit && Array.isArray(dayObj.pendingSales)
      ? dayObj.pendingSales.find(pItem =>
          (activeRecalledPendingId && pItem.id === activeRecalledPendingId) ||
          (String(pItem.merchant || '').trim() === mName && Number(pItem.scaleNo) > 0 && Number(pItem.scaleNo) === enteredScale)
        )
      : null;
    const candidateSaleFields = {
      entryMode: isStandaloneDebtVoucher ? 'debt_only' : 'sale',
      merchant: mName,
      scaleNo: enteredScale,
      carNo: Number(document.getElementById('inpCarNo').value) || '',
      w1: isStandaloneDebtVoucher ? 0 : (parseNum(document.getElementById('inpW1').value) || 0),
      w2: isStandaloneDebtVoucher ? 0 : (parseNum(document.getElementById('inpW2').value) || 0),
      price: enteredPrice,
      tip: enteredTip,
      custodyCash: parseNum(document.getElementById('inpCustodyCash').value) || 0,
      custodyTransfer: parseNum(document.getElementById('inpCustodyTransfer').value) || 0,
      custodyTransferType: document.getElementById('selCustodyTransferType').value,
      cashSales: isStandaloneDebtVoucher ? 0 : (parseNum(document.getElementById('inpCashSales').value) || 0),
      transferSales: isStandaloneDebtVoucher ? 0 : (parseNum(document.getElementById('inpTransferSales').value) || 0),
      transferSalesType: isStandaloneDebtVoucher ? '' : document.getElementById('selTransferSalesType').value,
      creditSales: isStandaloneDebtVoucher ? 0 : (parseNum(document.getElementById('inpCreditSales').value) || 0),
      debtCash: parseNum(document.getElementById('inpDebtCash').value) || 0,
      debtTransfer: parseNum(document.getElementById('inpDebtTransfer').value) || 0,
      debtTransferType: document.getElementById('selDebtTransferType').value,
      prevCash: parseNum(document.getElementById('inpPrevCash').value) || 0,
      prevTransfer: parseNum(document.getElementById('inpPrevTransfer').value) || 0,
      prevTransferType: document.getElementById('selPrevTransferType').value,
      notes: document.getElementById('inpNotes').value.trim()
    };
    const saleAuditMeta = buildRecordAuditMeta(
      existingSaleForAudit || recalledPendForAudit || null,
      Boolean(existingSaleForAudit || (recalledPendForAudit && recalledPendForAudit.createdBy)),
      candidateSaleFields,
      'sale'
    );
    const rowObj = {
      id: editId || generateRecordUUID(`d${appState.currentDay}`),
      ...saleAuditMeta,
      ...candidateSaleFields
    };

    const isDuplicateSale = daySales.some(r => {
      if (editId && r.id === editId) return false;
      const sameMerchant = String(r.merchant || '').trim() === rowObj.merchant;
      const sameCar = String(r.carNo || '').trim() === String(rowObj.carNo || '').trim();
      const sameWeights = Number(r.w1) === Number(rowObj.w1) && Number(r.w2) === Number(rowObj.w2);
      const hasWeights = Number(rowObj.w1) > 0 || Number(rowObj.w2) > 0;
      const sameFinancials = Number(r.price) === Number(rowObj.price) &&
        Number(r.cashSales) === Number(rowObj.cashSales) &&
        Number(r.creditSales) === Number(rowObj.creditSales) &&
        Number(r.transferSales) === Number(rowObj.transferSales) &&
        Number(r.debtCash) === Number(rowObj.debtCash) &&
        Number(r.debtTransfer) === Number(rowObj.debtTransfer) &&
        Number(r.prevCash) === Number(rowObj.prevCash) &&
        Number(r.prevTransfer) === Number(rowObj.prevTransfer);
      return (hasWeights && sameMerchant && sameCar && sameWeights) || (sameMerchant && sameWeights && sameFinancials);
    });
    if (isDuplicateSale) {
      showToast('❌ لا يُسمح بحفظ سجلين بنفس البيانات في جدول حركات البيع المسجلة!', '⚠️');
      return;
    }

    unrecordDeletedItem('sales', rowObj.id);
    dayObj.addedAt = getSyncedNow();
    dayObj.clearedAt = 0;
    dayObj.isHidden = false;
    if (editId) {
      const idx = daySales.findIndex(x => x.id === editId);
      if (idx !== -1) daySales[idx] = rowObj;
      dayObj.sales = sortSalesListByScaleNo(daySales);
      showToast(`تم تحديث حركة التاجر (${mName}) مع حفظ ترتيبه بمسلسل ميزان (${enteredScale})`);
    } else {
      if (daySales.length >= 45) {
        showToast('وصلت للحد الأقصى (45 حركة بيع في اليوم الواحد)', '⚠️');
        return;
      }
      daySales.push(rowObj);
      dayObj.sales = sortSalesListByScaleNo(daySales);
      showToast(`تم تسجيل حركة (${mName}) في ترتيبها المحجوز بمسلسل ميزان (${enteredScale})`);
    }

    // إزالة السيارة تلقائياً من قائمة (سيارات محفوظة مؤقتاً - وزنة أولى) فور إتمام الوزنة الثانية والحفظ النهائي!
    const curDayObj = appState.days[appState.currentDay];
    if (curDayObj && Array.isArray(curDayObj.pendingSales) && curDayObj.pendingSales.length > 0) {
      curDayObj.pendingSales = curDayObj.pendingSales.filter(pItem => {
        const isRecalled = Boolean(activeRecalledPendingId && pItem.id === activeRecalledPendingId);
        const matchSameCarAndW1 = String(pItem.merchant || '').trim() === rowObj.merchant &&
          String(pItem.carNo || '').trim() === String(rowObj.carNo || '').trim() &&
          Number(pItem.w1) === Number(rowObj.w1);
        const matchSameScale = rowObj.scaleNo && Number(pItem.scaleNo) === Number(rowObj.scaleNo) &&
          String(pItem.merchant || '').trim() === rowObj.merchant;
        if (isRecalled || matchSameCarAndW1 || matchSameScale) {
          recordDeletedItem('pendingSales', pItem.id);
          return false;
        }
        return true;
      });
    }
    cancelOrClearCurrentSaleEntry(false);
    saveState(true);
    renderAll();
  });

  document.getElementById('btnCancelEditSale').addEventListener('click', () => {
    cancelOrClearCurrentSaleEntry(true);
  });

  // Edit / Delete / Recall Sale Row Delegation (Protected by Sales Permission)
  document.getElementById('dailySalesTbody').addEventListener('click', (e) => {
    const printRecBtn = e.target.closest('[data-print-receipt]');
    if (printRecBtn) {
      e.preventDefault();
      const sId = printRecBtn.getAttribute('data-print-receipt');
      const sDay = Number(printRecBtn.getAttribute('data-receipt-day')) || appState.currentDay || 1;
      if (sId) triggerTablePrint(`scaleReceipt:${sDay}:${sId}`);
      return;
    }
    const expImgRecBtn = e.target.closest('[data-export-receipt-img]');
    if (expImgRecBtn) {
      e.preventDefault();
      const sId = expImgRecBtn.getAttribute('data-export-receipt-img');
      const sDay = Number(expImgRecBtn.getAttribute('data-receipt-day')) || appState.currentDay || 1;
      if (sId) exportScaleReceiptAsImageOrPdf(sId, sDay, 'png');
      return;
    }
    const expPdfRecBtn = e.target.closest('[data-export-receipt-pdf]');
    if (expPdfRecBtn) {
      e.preventDefault();
      const sId = expPdfRecBtn.getAttribute('data-export-receipt-pdf');
      const sDay = Number(expPdfRecBtn.getAttribute('data-receipt-day')) || appState.currentDay || 1;
      if (sId) exportScaleReceiptAsImageOrPdf(sId, sDay, 'pdf');
      return;
    }
    if (!hasPermission('sales')) {
      showToast('عفواً، التعديل والحذف غير متاح للزائر (عرض فقط).', '🔒');
      return;
    }
    if (isDayLocked(appState.currentDay)) {
      showToast('🔒 هذا اليوم مقفل ومعتمد محاسبياً — لا يمكن تعديل أو حذف الحركات إلا بعد فك القفل بواسطة مدير الموقع!', '🔒');
      return;
    }
    const recPendingBtn = e.target.closest('[data-recall-pending]');
    if (recPendingBtn) {
      recallPendingSaleById(recPendingBtn.getAttribute('data-recall-pending'));
      return;
    }
    const delPendingBtn = e.target.closest('[data-del-pending]');
    if (delPendingBtn) {
      deletePendingSaleById(delPendingBtn.getAttribute('data-del-pending'));
      return;
    }
    const editBtn = e.target.closest('[data-edit-sale]');
    if (editBtn) {
      const id = editBtn.getAttribute('data-edit-sale');
      const row = appState.days[appState.currentDay].sales.find(x => x.id === id);
      if (!row) return;
      const compRow = computeSaleRow(row);
      setSaleEntryMode(compRow.isDebtCollectionOnly ? 'debt_only' : 'sale', { clearWeightFields: false, focusMerchantOrDebt: false, showModeToast: false });
      document.getElementById('editSaleId').value = row.id;
      document.getElementById('inpMerchantName').value = row.merchant;
      document.getElementById('inpScaleNo').value = row.scaleNo || '';
      document.getElementById('inpCarNo').value = row.carNo || '';
      document.getElementById('inpW1').value = row.w1 ? fmtMoney(row.w1) : '';
      document.getElementById('inpW2').value = row.w2 ? fmtMoney(row.w2) : '';
      document.getElementById('inpPrice').value = row.price ? fmtMoney(row.price) : '';
      document.getElementById('inpTip').value = row.tip !== undefined ? fmtMoney(row.tip) : '';
      document.getElementById('inpCustodyCash').value = row.custodyCash ? fmtMoney(row.custodyCash) : '';
      document.getElementById('inpCustodyTransfer').value = row.custodyTransfer ? fmtMoney(row.custodyTransfer) : '';
      document.getElementById('selCustodyTransferType').value = row.custodyTransferType || '';
      document.getElementById('inpCashSales').value = row.cashSales ? fmtMoney(row.cashSales) : '';
      document.getElementById('inpTransferSales').value = row.transferSales ? fmtMoney(row.transferSales) : '';
      document.getElementById('selTransferSalesType').value = row.transferSalesType || '';
      document.getElementById('inpCreditSales').value = row.creditSales ? fmtMoney(row.creditSales) : '';
      document.getElementById('inpDebtCash').value = row.debtCash ? fmtMoney(row.debtCash) : '';
      document.getElementById('inpDebtTransfer').value = row.debtTransfer ? fmtMoney(row.debtTransfer) : '';
      document.getElementById('selDebtTransferType').value = row.debtTransferType || '';
      document.getElementById('inpPrevCash').value = row.prevCash ? fmtMoney(row.prevCash) : '';
      document.getElementById('inpPrevTransfer').value = row.prevTransfer ? fmtMoney(row.prevTransfer) : '';
      document.getElementById('selPrevTransferType').value = row.prevTransferType || '';
      document.getElementById('inpNotes').value = row.notes || '';

      setSaleFormActionLabels('حفظ التعديل', true);
      updateLiveFormCalculation();
      document.getElementById('saleFormCard').scrollIntoView({ behavior: 'smooth' });
      return;
    }

    const delBtn = e.target.closest('[data-del-sale]');
    if (delBtn) {
      const id = delBtn.getAttribute('data-del-sale');
      recordDeletedItem('sales', id);
      appState.days[appState.currentDay].sales = appState.days[appState.currentDay].sales.filter(x => x.id !== id);
      saveState(true);
      renderAll();
      showToast('تم حذف الحركة وتحديث ميزان الخزنة على جميع الأجهزة', '🗑️');
    }
  });

  // Daily sales search handled by universal Excel filter bindings below

  function resetExpenseFormEditMode() {
    const expForm = document.getElementById('expenseEntryForm');
    if (expForm) expForm.reset();
    const editExpEl = document.getElementById('editExpenseId');
    if (editExpEl) editExpEl.value = '';
    const btnSubExp = document.getElementById('btnSubmitExpenseForm');
    if (btnSubExp) btnSubExp.textContent = '➕ خصم وإضافة للبيان';
    const btnCancelExp = document.getElementById('btnCancelEditExpense');
    if (btnCancelExp) btnCancelExp.classList.add('hidden');
  }

  const btnCancelExpEl = document.getElementById('btnCancelEditExpense');
  if (btnCancelExpEl) {
    btnCancelExpEl.addEventListener('click', () => {
      resetExpenseFormEditMode();
      showToast('تم إلغاء تعديل بند المصروف', 'ℹ️');
    });
  }

  // Add or Edit Daily Expense / Bonus
  document.getElementById('expenseEntryForm').addEventListener('submit', (e) => {
    e.preventDefault();
    if (!hasPermission('expenses')) {
      showToast('عفواً، هذه الصلاحية غير متاحة لحسابك الحالي.', '🔒');
      return;
    }
    if (isDayLocked(appState.currentDay)) {
      showToast('🔒 هذا اليوم مقفل ومعتمد محاسبياً — لا يمكن إضافة أو تعديل المصروفات إلا بعد فك القفل بواسطة مدير الموقع!', '🔒');
      return;
    }
    const category = document.getElementById('selExpCategory').value;
    const desc = document.getElementById('inpExpDesc').value.trim();
    const recipient = document.getElementById('inpExpRecipient').value.trim();
    const amount = parseNum(document.getElementById('inpExpAmount').value) || 0;
    if (amount <= 0) return;

    const editExpId = (document.getElementById('editExpenseId').value || '').trim();
    const dayExps = appState.days[appState.currentDay].expenses || [];

    const expDayObj = appState.days[appState.currentDay];
    if (editExpId) {
      const idx = dayExps.findIndex(x => x.id === editExpId);
      if (idx !== -1) {
        const candidateExpFields = { category, desc, recipient, amount };
        const expAuditMeta = buildRecordAuditMeta(dayExps[idx], true, candidateExpFields, 'expense');
        dayExps[idx] = {
          ...dayExps[idx],
          ...expAuditMeta,
          ...candidateExpFields
        };
      }
      if (expDayObj) {
        expDayObj.addedAt = getSyncedNow();
        expDayObj.clearedAt = 0;
        expDayObj.isHidden = false;
      }
      resetExpenseFormEditMode();
      saveState(true);
      renderAll();
      showToast(`تم تعديل بند المصروف (${fmtInt(amount)} ج.م - ${category}) وتحديث رصيد الخزنة بنجاح`, '✅');
      return;
    }

    const newExpId = generateRecordUUID(`exp_d${appState.currentDay}`);
    const newExpAuditMeta = buildRecordAuditMeta(null, false);
    unrecordDeletedItem('expenses', newExpId);
    dayExps.push({
      id: newExpId,
      ...newExpAuditMeta,
      category,
      desc,
      recipient,
      amount
    });
    if (expDayObj) {
      expDayObj.addedAt = getSyncedNow();
      expDayObj.clearedAt = 0;
      expDayObj.isHidden = false;
    }
    resetExpenseFormEditMode();
    saveState(true);
    renderAll();
    showToast(`تم خصم (${fmtInt(amount)} ج.م - ${category}) من نقدية الخزنة`);
  });

  // Edit or Delete Expense Row (Protected by Expenses Permission)
  document.getElementById('dailyExpensesTbody').addEventListener('click', (e) => {
    if (!hasPermission('expenses')) {
      showToast('عفواً، التعديل والحذف غير متاح للزائر (عرض فقط).', '🔒');
      return;
    }
    if (isDayLocked(appState.currentDay)) {
      showToast('🔒 هذا اليوم مقفل ومعتمد محاسبياً — لا يمكن تعديل أو حذف المصروفات إلا بعد فك القفل بواسطة مدير الموقع!', '🔒');
      return;
    }
    const editBtn = e.target.closest('[data-edit-exp]');
    if (editBtn) {
      const id = editBtn.getAttribute('data-edit-exp');
      const expObj = (appState.days[appState.currentDay].expenses || []).find(x => x.id === id);
      if (!expObj) return;
      document.getElementById('editExpenseId').value = expObj.id;
      document.getElementById('selExpCategory').value = expObj.category || 'مصاريف موقع وتشغيل';
      document.getElementById('inpExpDesc').value = expObj.desc || '';
      document.getElementById('inpExpRecipient').value = expObj.recipient || '';
      document.getElementById('inpExpAmount').value = expObj.amount ? fmtMoney(expObj.amount) : '';
      const btnSubExp = document.getElementById('btnSubmitExpenseForm');
      if (btnSubExp) btnSubExp.textContent = '💾 حفظ التعديل';
      const btnCancelExp = document.getElementById('btnCancelEditExpense');
      if (btnCancelExp) btnCancelExp.classList.remove('hidden');
      document.getElementById('dailyExpensesSection').scrollIntoView({ behavior: 'smooth' });
      document.getElementById('inpExpAmount').focus();
      showToast(`تم تحميل بند (${expObj.category}) للتعديل — عدّل البيانات واضغط حفظ التعديل`, '✏️');
      return;
    }
    const delBtn = e.target.closest('[data-del-exp]');
    if (delBtn) {
      const id = delBtn.getAttribute('data-del-exp');
      recordDeletedItem('expenses', id);
      appState.days[appState.currentDay].expenses = appState.days[appState.currentDay].expenses.filter(x => x.id !== id);
      if (document.getElementById('editExpenseId').value === id) {
        resetExpenseFormEditMode();
      }
      saveState(true);
      renderAll();
      showToast('تم حذف بند المصروف وإعادة المبلغ لرصيد الخزنة');
    }
  });

  // Open specific day from Dashboard Table (auto-adding to visibleDays if needed)
  document.getElementById('dashTableTbody').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-open-day]');
    if (btn) {
      const dNum = Number(btn.getAttribute('data-open-day')) || 1;
      if (!appState.visibleDays.includes(dNum)) {
        appState.visibleDays.push(dNum);
        appState.visibleDays.sort((a, b) => a - b);
      }
      appState.currentDay = dNum;
      document.querySelector('[data-nav="daily"]').click();
    }
  });

  // Add or Edit Base Merchant + Delete Merchant
  document.getElementById('addMerchantForm').addEventListener('submit', (e) => {
    e.preventDefault();
    if (!hasPermission('merchants')) {
      showToast('عفواً، لا تملك صلاحية تعديل أو إضافة التجار.', '🔒');
      return;
    }
    const name = document.getElementById('inpNewMerchantBase').value.trim();
    if (!name) return;
    const editCode = Number(document.getElementById('editMerchantCodeInput').value) || 0;
    if (editCode > 0) {
      const mObj = appState.merchants.find(m => m.code === editCode);
      if (mObj) {
        const oldName = mObj.name;
        mObj.name = name;
        mObj.updatedAt = getSyncedNow();
        // Update sales rows that used oldName in active farm and across all archived farms
        for (let d = 1; d <= 10; d++) {
          (appState.days[d].sales || []).forEach(r => {
            if (r.merchant === oldName) r.merchant = name;
          });
        }
        if (appState.farmsArchive && typeof appState.farmsArchive === 'object') {
          Object.values(appState.farmsArchive).forEach(fObj => {
            if (fObj && fObj.days) {
              for (let d = 1; d <= 10; d++) {
                ((fObj.days[d] && fObj.days[d].sales) || []).forEach(r => {
                  if (r.merchant === oldName) r.merchant = name;
                });
              }
            }
          });
        }
        showToast(`تم تعديل اسم التاجر كود (${editCode}) إلى (${name}) وتثبيته في جميع المزارع`);
      }
      document.getElementById('editMerchantCodeInput').value = '';
      document.getElementById('btnSubmitMerchantForm').textContent = '➕ تكويد تاجر جديد';
      document.getElementById('btnCancelMerchantEdit').classList.add('hidden');
    } else {
      const code = ensureMerchantExists(name);
      appState.merchantsViewFilter = 'all';
      showToast(`تم تكويد التاجر (${name}) بالكود الموحد (${code}) وعرض الدليل الكامل`);
    }
    document.getElementById('inpNewMerchantBase').value = '';
    saveState(true);
    renderAll();
  });

  const btnFilterActEl = document.getElementById('btnFilterMerchActive');
  if (btnFilterActEl) {
    btnFilterActEl.addEventListener('click', () => {
      appState.merchantsViewFilter = 'active';
      saveState(false);
      renderMerchantsAndStatements();
      showToast('تم عرض تجار المزرعة النشطين فقط وإخفاء الأصفار تلقائياً', '✅');
    });
  }
  const btnFilterAllEl = document.getElementById('btnFilterMerchAll');
  if (btnFilterAllEl) {
    btnFilterAllEl.addEventListener('click', () => {
      appState.merchantsViewFilter = 'all';
      saveState(false);
      renderMerchantsAndStatements();
      showToast('تم عرض الدليل الكامل لجميع التجار المكودين', '📋');
    });
  }

  const btnTrActEl = document.getElementById('btnFilterTransfersActive');
  if (btnTrActEl) {
    btnTrActEl.addEventListener('click', () => {
      appState.transfersViewFilter = 'active';
      saveState(false);
      renderMerchantsAndStatements();
      showToast('تم عرض تجار المزرعة النشطين في التحويلات فقط وإخفاء الأصفار', '✅');
    });
  }
  const btnTrAllEl = document.getElementById('btnFilterTransfersAll');
  if (btnTrAllEl) {
    btnTrAllEl.addEventListener('click', () => {
      appState.transfersViewFilter = 'all';
      saveState(false);
      renderMerchantsAndStatements();
      showToast('تم عرض دليل جميع التجار المكودين في بيان التحويلات', '📋');
    });
  }

  const btnPfActEl = document.getElementById('btnFilterPrevFarmsActive');
  if (btnPfActEl) {
    btnPfActEl.addEventListener('click', () => {
      appState.prevFarmsViewFilter = 'active';
      saveState(false);
      renderMerchantsAndStatements();
      showToast('تم عرض تجار المزرعة النشطين في تحصيلات المزارع السابقة فقط وإخفاء الأصفار', '✅');
    });
  }
  const btnPfAllEl = document.getElementById('btnFilterPrevFarmsAll');
  if (btnPfAllEl) {
    btnPfAllEl.addEventListener('click', () => {
      appState.prevFarmsViewFilter = 'all';
      saveState(false);
      renderMerchantsAndStatements();
      showToast('تم عرض دليل جميع التجار المكودين في بيان المزارع السابقة', '📋');
    });
  }

  const btnExpSumActEl = document.getElementById('btnFilterExpSummaryActive');
  if (btnExpSumActEl) {
    btnExpSumActEl.addEventListener('click', () => {
      appState.expensesViewFilter = 'active';
      saveState(false);
      renderExpensesStatementView();
      showToast('تم عرض بنود المصروفات النشطة في المزرعة فقط وإخفاء الأصفار', '✅');
    });
  }
  const btnExpSumAllEl = document.getElementById('btnFilterExpSummaryAll');
  if (btnExpSumAllEl) {
    btnExpSumAllEl.addEventListener('click', () => {
      appState.expensesViewFilter = 'all';
      saveState(false);
      renderExpensesStatementView();
      showToast('تم عرض دليل جميع بنود المصروفات المكودة', '📋');
    });
  }

  // =======================================================================
  // EXCEL SORT & FILTER POPOVER INTERACTIVE HANDLERS (FOR DASH & MERCH)
  // =======================================================================
  const excelPopoverEl = document.getElementById('excelFilterPopover');
  const excelChecklistEl = document.getElementById('excelValuesChecklist');
  const chkSelectAllEl = document.getElementById('chkExcelSelectAllValues');
  const inpValueSearchEl = document.getElementById('inpExcelValueSearch');
  const selCondOpEl = document.getElementById('selExcelCondOp');
  const inpCondValEl = document.getElementById('inpExcelCondVal');

  function getTableColumnsAndBaseRows(tableId) {
    if (tableId === 'dash') {
      return { columns: DASH_COLUMNS, rawBaseRows: getOpenAndActiveDashSummaries() };
    }
    if (tableId === 'merch') {
      const rawBaseRows = appState.merchantsViewFilter === 'active'
        ? computeMerchantAggregates().filter(isMerchantActiveInCurrentFarm)
        : computeMerchantAggregates();
      return { columns: MERCH_COLUMNS, rawBaseRows };
    }
    const domCfg = DOM_EXCEL_TABLES[tableId];
    if (domCfg) {
      return { columns: domCfg.columns, rawBaseRows: domTableRawCache[tableId] || [] };
    }
    return { columns: [], rawBaseRows: [] };
  }

  function openExcelFilterPopover(tableId, colKey, triggerBtn) {
    const { columns, rawBaseRows } = getTableColumnsAndBaseRows(tableId);
    const col = columns.find(c => c.key === colKey);
    if (!col || !excelPopoverEl) return;

    excelTableState.activePopover = { tableId, colKey };
    document.getElementById('excelPopoverColTitle').textContent = `فرز وتصفية: ${col.label}`;

    const rowsForUnique = applyExcelSortAndFilter(rawBaseRows, columns, tableId, colKey);

    const valueCounts = new Map();
    rowsForUnique.forEach(r => {
      const d = String(col.getDisp(r));
      valueCounts.set(d, (valueCounts.get(d) || 0) + 1);
    });
    const uniqueVals = Array.from(valueCounts.keys()).sort((a, b) => {
      if (col.type === 'number') {
        return parseNum(a) - parseNum(b);
      }
      return a.localeCompare(b, 'ar');
    });

    const st = excelTableState[tableId];
    const existingCf = st.colFilters[colKey] || {};
    selCondOpEl.value = existingCf.op || '';
    inpCondValEl.value = existingCf.val !== undefined ? existingCf.val : '';
    inpValueSearchEl.value = '';

    const allowedSet = existingCf.allowedValues ? new Set(existingCf.allowedValues) : null;

    excelChecklistEl.innerHTML = uniqueVals.map(v => {
      const isChecked = allowedSet ? allowedSet.has(v) : true;
      const cnt = valueCounts.get(v) || 0;
      const escapedV = escXmlStr(v);
      return `
        <label data-excel-val-row="${escapedV.toLowerCase()}" class="flex items-center justify-between gap-2 px-1.5 py-1 rounded hover:bg-blue-50 cursor-pointer">
          <span class="inline-flex items-center gap-1.5 truncate">
            <input type="checkbox" class="chk-excel-val-item rounded text-blue-900 w-3.5 h-3.5" value="${escapedV}" ${isChecked ? 'checked' : ''} />
            <span class="truncate">${escapedV || '(فارغ)'}</span>
          </span>
          <span class="text-[10px] text-slate-400 px-1.5 py-0.5 rounded bg-slate-100">${cnt}</span>
        </label>
      `;
    }).join('');

    const allBoxes = Array.from(excelChecklistEl.querySelectorAll('.chk-excel-val-item'));
    chkSelectAllEl.checked = allBoxes.length > 0 && allBoxes.every(b => b.checked);

    excelPopoverEl.classList.remove('hidden');

    // Position popover near trigger button within viewport bounds
    const rect = triggerBtn.getBoundingClientRect();
    const popW = 300;
    const popH = 380;
    let top = rect.bottom + 6;
    let left = Math.min(window.innerWidth - popW - 12, Math.max(12, rect.left - 120));
    if (top + popH > window.innerHeight - 12) {
      top = Math.max(12, rect.top - popH - 6);
    }
    excelPopoverEl.style.top = `${top}px`;
    excelPopoverEl.style.left = `${left}px`;
  }

  document.addEventListener('click', (e) => {
    const toggleReceiptBtn = e.target.closest('[data-toggle-receipt-btns]');
    if (toggleReceiptBtn) {
      e.stopPropagation();
      excelTableState.showScaleReceiptButtons = !excelTableState.showScaleReceiptButtons;
      updateReceiptToggleBtnsUI();
      renderDailyView();
      if (activeDrillDownMerchantCode) {
        renderMerchantDrillDownModal();
      }
      showToast(
        excelTableState.showScaleReceiptButtons
          ? 'تم إظهار أيقونة (🖨️ طباعة بون ميزان) في الجدول ✓'
          : 'تم إخفاء أيقونة (🖨️ طباعة بون ميزان) لتوفير المساحة في الجدول ✓',
        excelTableState.showScaleReceiptButtons ? '🖨️' : '🔼'
      );
      return;
    }
    const toggleColBtn = e.target.closest('[data-toggle-col-filters]');
    if (toggleColBtn) {
      e.stopPropagation();
      const tId = toggleColBtn.getAttribute('data-toggle-col-filters');
      if (excelTableState[tId]) {
        excelTableState[tId].showColFilters = !excelTableState[tId].showColFilters;
        if (!excelTableState[tId].showColFilters && excelPopoverEl) {
          excelPopoverEl.classList.add('hidden');
        }
        refreshTableById(tId);
        showToast(
          excelTableState[tId].showColFilters
            ? 'تم تفعيل وإظهار فلاتر الأعمدة (▼) في الجدول ✓'
            : 'تم إخفاء فلاتر الأعمدة من الجدول مع بقاء البحث السريع نشطاً ✓',
          excelTableState[tId].showColFilters ? '🔽' : '🔼'
        );
      }
      return;
    }
    const filterBtn = e.target.closest('[data-excel-filter-btn]');
    if (filterBtn) {
      e.stopPropagation();
      const [tId, cKey] = filterBtn.getAttribute('data-excel-filter-btn').split(':');
      openExcelFilterPopover(tId, cKey, filterBtn);
      return;
    }
    if (excelPopoverEl && !excelPopoverEl.classList.contains('hidden') && !excelPopoverEl.contains(e.target)) {
      excelPopoverEl.classList.add('hidden');
    }
  });

  document.getElementById('btnExcelPopoverClose').addEventListener('click', () => {
    excelPopoverEl.classList.add('hidden');
  });

  chkSelectAllEl.addEventListener('change', (e) => {
    const checked = e.target.checked;
    excelChecklistEl.querySelectorAll('label:not(.hidden) .chk-excel-val-item').forEach(cb => {
      cb.checked = checked;
    });
  });

  excelChecklistEl.addEventListener('change', () => {
    const visibleBoxes = Array.from(excelChecklistEl.querySelectorAll('label:not(.hidden) .chk-excel-val-item'));
    chkSelectAllEl.checked = visibleBoxes.length > 0 && visibleBoxes.every(b => b.checked);
  });

  inpValueSearchEl.addEventListener('input', (e) => {
    const q = (e.target.value || '').trim().toLowerCase();
    excelChecklistEl.querySelectorAll('[data-excel-val-row]').forEach(lbl => {
      const valTxt = lbl.getAttribute('data-excel-val-row') || '';
      lbl.classList.toggle('hidden', Boolean(q && !valTxt.includes(q)));
    });
  });

  function refreshTableById(tableId) {
    if (tableId === 'dash') renderDashboardView();
    else if (tableId === 'merch') renderMerchantsAndStatements('merchants');
    else if (tableId === 'transfers' || tableId === 'prevFarms') renderMerchantsAndStatements('transfers');
    else if (tableId === 'dailySales' || tableId === 'pendingWeighIns' || tableId === 'dailyExpenses') renderDailyView();
    else if (tableId === 'expSummary') renderExpensesStatementView();
    else if (tableId === 'usersList') renderUsersAndPermissionsUI();
    else if (tableId === 'cloudFarms') renderCloudDatabaseHub();
    else renderAll();
  }

  document.getElementById('btnExcelSortAsc').addEventListener('click', () => {
    const act = excelTableState.activePopover;
    if (!act) return;
    excelTableState[act.tableId].sortCol = act.colKey;
    excelTableState[act.tableId].sortDir = 'asc';
    excelPopoverEl.classList.add('hidden');
    refreshTableById(act.tableId);
    showToast('تم الفرز تصاعدياً (من الأصغر للأكبر / أ → ي)', '🔼');
  });

  document.getElementById('btnExcelSortDesc').addEventListener('click', () => {
    const act = excelTableState.activePopover;
    if (!act) return;
    excelTableState[act.tableId].sortCol = act.colKey;
    excelTableState[act.tableId].sortDir = 'desc';
    excelPopoverEl.classList.add('hidden');
    refreshTableById(act.tableId);
    showToast('تم الفرز تنازلياً (من الأكبر للأصغر / ي → أ)', '🔽');
  });

  document.getElementById('btnExcelApplyColFilter').addEventListener('click', () => {
    const act = excelTableState.activePopover;
    if (!act) return;
    const allBoxes = Array.from(excelChecklistEl.querySelectorAll('.chk-excel-val-item'));
    const checkedBoxes = allBoxes.filter(b => b.checked);
    const op = selCondOpEl.value;
    const val = inpCondValEl.value.trim();

    const allowedValues = (allBoxes.length > 0 && checkedBoxes.length < allBoxes.length)
      ? checkedBoxes.map(b => b.value)
      : null;

    if (!allowedValues && (!op || val === '')) {
      delete excelTableState[act.tableId].colFilters[act.colKey];
    } else {
      excelTableState[act.tableId].colFilters[act.colKey] = {
        allowedValues,
        op,
        val
      };
    }
    excelPopoverEl.classList.add('hidden');
    refreshTableById(act.tableId);
    showToast('تم تطبيق فلتر الإكسيل وتحديث الإجماليات', '✅');
  });

  document.getElementById('btnExcelClearColFilter').addEventListener('click', () => {
    const act = excelTableState.activePopover;
    if (!act) return;
    delete excelTableState[act.tableId].colFilters[act.colKey];
    if (excelTableState[act.tableId].sortCol === act.colKey) {
      excelTableState[act.tableId].sortCol = null;
    }
    excelPopoverEl.classList.add('hidden');
    refreshTableById(act.tableId);
    showToast('تم مسح فلتر وفرز هذا العمود', '🗑️');
  });

  const inpDashSearch = document.getElementById('inpDashQuickSearch');
  if (inpDashSearch) {
    inpDashSearch.addEventListener('input', (e) => {
      excelTableState.dash.searchQuery = e.target.value;
      renderDashboardView();
    });
  }

  const btnClearDash = document.getElementById('btnClearDashExcelFilters');
  if (btnClearDash) {
    btnClearDash.addEventListener('click', () => {
      excelTableState.dash.searchQuery = '';
      excelTableState.dash.sortCol = null;
      excelTableState.dash.sortDir = 'asc';
      excelTableState.dash.colFilters = {};
      if (inpDashSearch) inpDashSearch.value = '';
      renderDashboardView();
      showToast('تم مسح جميع الفلاتر والفرز من جدول الملخص التنفيذي', '🔄');
    });
  }

  const inpMerchSearch = document.getElementById('inpMerchQuickSearch');
  if (inpMerchSearch) {
    inpMerchSearch.addEventListener('input', (e) => {
      excelTableState.merch.searchQuery = e.target.value;
      renderMerchantsAndStatements();
    });
  }

  const btnClearMerch = document.getElementById('btnClearMerchExcelFilters');
  if (btnClearMerch) {
    btnClearMerch.addEventListener('click', () => {
      excelTableState.merch.searchQuery = '';
      excelTableState.merch.sortCol = null;
      excelTableState.merch.sortDir = 'asc';
      excelTableState.merch.colFilters = {};
      if (inpMerchSearch) inpMerchSearch.value = '';
      renderMerchantsAndStatements();
      showToast('تم مسح جميع الفلاتر والفرز من جدول كشف حساب التجار', '🔄');
    });
  }

  // Wire up Quick Search & Clear Filter buttons for all other 8 tables
  const extraFilterBindings = [
    { tableId: 'dailySales', inpId: 'inpFilterDailySales', btnId: 'btnClearDailySalesFilters', label: 'جدول حركات البيع اليومية' },
    { tableId: 'pendingWeighIns', inpId: 'inpFilterPendingSales', btnId: 'btnClearPendingSalesFilters', label: 'جدول الوزنات المؤقتة' },
    { tableId: 'dailyExpenses', inpId: 'inpFilterDailyExpenses', btnId: 'btnClearDailyExpensesFilters', label: 'جدول مصروفات اليوم' },
    { tableId: 'transfers', inpId: 'inpFilterTransfers', btnId: 'btnClearTransfersFilters', label: 'جدول بيان التحويلات والشيكات' },
    { tableId: 'prevFarms', inpId: 'inpFilterPrevFarms', btnId: 'btnClearPrevFarmsFilters', label: 'جدول تحصيلات المزارع السابقة' },
    { tableId: 'expSummary', inpId: 'inpFilterExpSummary', btnId: 'btnClearExpSummaryFilters', label: 'جدول بيان المصروفات المجمع' },
    { tableId: 'usersList', inpId: 'inpFilterUsersList', btnId: 'btnClearUsersListFilters', label: 'جدول المستخدمين والصلاحيات' },
    { tableId: 'cloudFarms', inpId: 'inpFilterCloudFarms', btnId: 'btnClearCloudFarmsFilters', label: 'جدول سجل المزارع المحفوظة' }
  ];

  extraFilterBindings.forEach(({ tableId, inpId, btnId, label }) => {
    const inpEl = document.getElementById(inpId);
    if (inpEl) {
      inpEl.addEventListener('input', (e) => {
        excelTableState[tableId].searchQuery = e.target.value;
        refreshTableById(tableId);
      });
    }
    const btnEl = document.getElementById(btnId);
    if (btnEl) {
      btnEl.addEventListener('click', () => {
        excelTableState[tableId].searchQuery = '';
        excelTableState[tableId].sortCol = null;
        excelTableState[tableId].sortDir = 'asc';
        excelTableState[tableId].colFilters = {};
        if (inpEl) inpEl.value = '';
        refreshTableById(tableId);
        showToast(`تم مسح جميع الفلاتر والفرز من ${label}`, '🔄');
      });
    }
  });

  document.getElementById('btnCancelMerchantEdit').addEventListener('click', () => {
    document.getElementById('editMerchantCodeInput').value = '';
    document.getElementById('inpNewMerchantBase').value = '';
    document.getElementById('btnSubmitMerchantForm').textContent = '➕ تكويد تاجر جديد';
    document.getElementById('btnCancelMerchantEdit').classList.add('hidden');
  });

  // Global delegation for opening Merchant Drill-Down Modal from any table ([data-drill-merchant])
  document.addEventListener('click', (e) => {
    const drillBtn = e.target.closest('[data-drill-merchant]');
    if (drillBtn) {
      e.preventDefault();
      const code = Number(drillBtn.getAttribute('data-drill-merchant'));
      if (code > 0) openMerchantDrillDownModal(code);
      return;
    }
    const jumpDayBtn = e.target.closest('[data-modal-jump-day]');
    if (jumpDayBtn) {
      const dNum = Number(jumpDayBtn.getAttribute('data-modal-jump-day')) || 1;
      closeMerchantDrillDownModal();
      if (!appState.visibleDays.includes(dNum)) {
        appState.visibleDays.push(dNum);
        appState.visibleDays.sort((a, b) => a - b);
      }
      appState.currentDay = dNum;
      const dailyTabBtn = document.querySelector('[data-nav="daily"]');
      if (dailyTabBtn) dailyTabBtn.click();
      showToast(`تم الانتقال إلى محضر (يوم ${dNum})`, '📂');
      return;
    }
  });

  const mdlOverlay = document.getElementById('merchantDrillDownModal');
  if (mdlOverlay) {
    mdlOverlay.addEventListener('click', (e) => {
      if (e.target === mdlOverlay) closeMerchantDrillDownModal();
    });
  }
  const btnCloseMdl = document.getElementById('btnCloseMerchantModal');
  if (btnCloseMdl) {
    btnCloseMdl.addEventListener('click', closeMerchantDrillDownModal);
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && activeDrillDownMerchantCode > 0) {
      closeMerchantDrillDownModal();
    }
  });
  const selMdlSwitch = document.getElementById('selModalMerchantSwitcher');
  if (selMdlSwitch) {
    selMdlSwitch.addEventListener('change', (e) => {
      const newCode = Number(e.target.value);
      if (newCode > 0) openMerchantDrillDownModal(newCode);
    });
  }
  const inpFilterMdl = document.getElementById('inpFilterMerchantModal');
  if (inpFilterMdl) {
    inpFilterMdl.addEventListener('input', () => {
      renderMerchantDrillDownModal();
    });
  }
  const btnCopyMerchStmt = document.getElementById('btnCopyMerchantStatement');
  if (btnCopyMerchStmt) {
    btnCopyMerchStmt.addEventListener('click', () => {
      if (!activeDrillDownMerchantCode) return;
      const txt = buildMerchantWhatsappStatementText(activeDrillDownMerchantCode);
      const ta = document.createElement('textarea');
      ta.value = txt;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch (err) {}
      document.body.removeChild(ta);
      showToast('تم نسخ كشف حساب التاجر التفصيلي للحافظة بنجاح! 📋');
    });
  }
  const btnShareMerchWa = document.getElementById('btnShareMerchantWhatsapp');
  if (btnShareMerchWa) {
    btnShareMerchWa.addEventListener('click', () => {
      if (!activeDrillDownMerchantCode) return;
      const txt = buildMerchantWhatsappStatementText(activeDrillDownMerchantCode);
      const ta = document.createElement('textarea');
      ta.value = txt;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch (err) {}
      document.body.removeChild(ta);
      const waUrl = `https://wa.me/?text=${encodeURIComponent(txt)}`;
      window.open(waUrl, '_blank', 'noopener,noreferrer');
      showToast('تم نسخ الكشف وفتح واتساب لمشاركة كشف حساب التاجر مباشرة! 📲');
    });
  }
  const btnPrintMerchStmt = document.getElementById('btnPrintMerchantStatement');
  if (btnPrintMerchStmt) {
    btnPrintMerchStmt.addEventListener('click', () => {
      triggerMerchantStatementPrint();
    });
  }
  const btnExportMerchImg = document.getElementById('btnExportMerchantImage');
  if (btnExportMerchImg) {
    btnExportMerchImg.addEventListener('click', () => {
      exportMerchantStatementAsImageOrPdf('png');
    });
  }
  const btnExportMerchPdf = document.getElementById('btnExportMerchantPdf');
  if (btnExportMerchPdf) {
    btnExportMerchPdf.addEventListener('click', () => {
      exportMerchantStatementAsImageOrPdf('pdf');
    });
  }
  const btnExportMerchXlsx = document.getElementById('btnExportMerchantExcel');
  if (btnExportMerchXlsx) {
    btnExportMerchXlsx.addEventListener('click', () => {
      exportMerchantDrillDownToExcel();
    });
  }
  document.addEventListener('click', (e) => {
    const printRecBtn = e.target.closest('[data-print-receipt]');
    if (printRecBtn) {
      e.preventDefault();
      const sId = printRecBtn.getAttribute('data-print-receipt');
      const sDay = Number(printRecBtn.getAttribute('data-receipt-day')) || appState.currentDay || 1;
      if (sId) triggerTablePrint(`scaleReceipt:${sDay}:${sId}`);
      return;
    }
    const expImgRecBtn = e.target.closest('[data-export-receipt-img]');
    if (expImgRecBtn) {
      e.preventDefault();
      const sId = expImgRecBtn.getAttribute('data-export-receipt-img');
      const sDay = Number(expImgRecBtn.getAttribute('data-receipt-day')) || appState.currentDay || 1;
      if (sId) exportScaleReceiptAsImageOrPdf(sId, sDay, 'png');
      return;
    }
    const expPdfRecBtn = e.target.closest('[data-export-receipt-pdf]');
    if (expPdfRecBtn) {
      e.preventDefault();
      const sId = expPdfRecBtn.getAttribute('data-export-receipt-pdf');
      const sDay = Number(expPdfRecBtn.getAttribute('data-receipt-day')) || appState.currentDay || 1;
      if (sId) exportScaleReceiptAsImageOrPdf(sId, sDay, 'pdf');
      return;
    }
    const printTblBtn = e.target.closest('[data-print-table]');
    if (printTblBtn) {
      e.preventDefault();
      const tblKey = printTblBtn.getAttribute('data-print-table');
      if (tblKey) triggerTablePrint(tblKey);
    }
  });
  window.addEventListener('beforeprint', () => {
    if (isMerchantPrintActive) return;
    const mdl = document.getElementById('merchantDrillDownModal');
    if ((mdl && !mdl.classList.contains('hidden')) || activeDrillDownMerchantCode > 0) {
      activateIsolatedPrintMode('merchantDrillDown');
      return;
    }
    const tabMap = {
      daily: 'dailySales',
      dashboard: 'dash',
      merchants: 'merch',
      transfers: 'transfers',
      expenses: 'expSummary'
    };
    const defaultKey = tabMap[appState.activeTab];
    if (defaultKey) {
      activateIsolatedPrintMode(defaultKey);
    }
  });
  window.addEventListener('afterprint', () => {
    deactivateMerchantPrintMode();
  });

  document.getElementById('merchantsTbody').addEventListener('click', (e) => {
    const editBtn = e.target.closest('[data-edit-merchant]');
    if (editBtn) {
      if (!hasPermission('merchants')) return;
      const code = Number(editBtn.getAttribute('data-edit-merchant'));
      const mObj = appState.merchants.find(m => m.code === code);
      if (!mObj) return;
      document.getElementById('editMerchantCodeInput').value = mObj.code;
      document.getElementById('inpNewMerchantBase').value = mObj.name;
      document.getElementById('btnSubmitMerchantForm').textContent = `💾 حفظ تعديل التاجر (كود ${mObj.code})`;
      document.getElementById('btnCancelMerchantEdit').classList.remove('hidden');
      document.getElementById('inpNewMerchantBase').focus();
      return;
    }
    const delBtn = e.target.closest('[data-del-merchant]');
    if (delBtn) {
      if (!hasPermission('merchants')) return;
      const code = Number(delBtn.getAttribute('data-del-merchant'));
      const mObj = appState.merchants.find(m => m.code === code);
      recordDeletedItem('merchants', code);
      appState.merchants = appState.merchants.filter(m => m.code !== code);
      saveState(true);
      renderAll();
      showToast(`تم حذف التاجر (${mObj ? mObj.name : code}) من قائمة التكويد`, '🗑️');
    }
  });

  // Quick Jump & Export/Share Handlers for Full Farm Cumulative Trial Balance in Executive Summary
  const btnJumpFarmTb = document.getElementById('btnJumpFarmTrialBalance');
  if (btnJumpFarmTb) {
    btnJumpFarmTb.addEventListener('click', () => {
      const card = document.getElementById('farmTrialBalanceCard');
      if (card) card.scrollIntoView({ behavior: 'smooth' });
    });
  }
  const btnExpFarmTbImg = document.getElementById('btnExportFarmTbImage');
  if (btnExpFarmTbImg) {
    btnExpFarmTbImg.addEventListener('click', () => {
      const fName = appState.farmName || 'أبوذكري';
      exportPrintTargetAsImageOrPdf('farmTrialBalance', 'png', `ميزان_مراجعة_المزرعة_الكامل_${fName}`);
    });
  }
  const btnExpFarmTbPdf = document.getElementById('btnExportFarmTbPdf');
  if (btnExpFarmTbPdf) {
    btnExpFarmTbPdf.addEventListener('click', () => {
      const fName = appState.farmName || 'أبوذكري';
      exportPrintTargetAsImageOrPdf('farmTrialBalance', 'pdf', `ميزان_مراجعة_المزرعة_الكامل_${fName}`);
    });
  }
  const btnShareWaFarm = document.getElementById('btnShareWhatsappFarmSummary');
  if (btnShareWaFarm) {
    btnShareWaFarm.addEventListener('click', () => {
      const openActiveSummaries = getOpenAndActiveDashSummaries();
      const filteredSummaries = applyExcelSortAndFilter(openActiveSummaries, DASH_COLUMNS, 'dash');
      const ftb = computeFarmCumulativeTrialBalance(filteredSummaries);
      const statusTxt = ftb.cumulativeCashBoxDiff === 0
        ? 'خزينة المزرعة مطابقة ✓'
        : (ftb.cumulativeCashBoxDiff < 0 ? 'زيادة توريد' : 'متبقي غير مورد / عجز');
      const text = [
        `⚖️ *ميزان المراجعة والتصفية الكامل لمزرعة ${appState.farmName}*`,
        `📅 عدد الأيام النشطة: ${fmtInt(ftb.activeDaysCount)} يوم (منها ${fmtInt(ftb.lockedDaysCount)} يوم معتمد 🔒)`,
        `🚛 إجمالي السيارات المكتملة: ${fmtInt(ftb.countCars)} سيارة (متوسط: ${fmtInt(ftb.avgCarWeight)} كجم)`,
        `⚖️ إجمالي الوزن الصافي التراكمي: *${fmtInt(ftb.sumNetW)} كجم* (قائم: ${fmtInt(ftb.sumW2)} - فارغ: ${fmtInt(ftb.sumW1)})`,
        `📈 متوسط سعر الكيلو المرجح للمزرعة: ${fmtDec(ftb.avgPrice)} ج.م/كجم (إجمالي الإكراميات: ${fmtInt(ftb.sumTip)} ج.م)`,
        `💰 *إجمالي المبيعات شامل الإكرامية: ${fmtDec(ftb.sumTotalWithTip)} ج.م*`,
        `💳 إجمالي التحويلات والشيكات: ${fmtInt(ftb.totalAllTransfers)} ج.م (حالية: ${fmtInt(ftb.currentFarmTransfers)} + سابقة: ${fmtInt(ftb.sumPrevTransfer)})`,
        `📌 *الخلاصة التراكمية لمديونية المزرعة:* إجمالي الآجل (${fmtInt(ftb.sumCreditSales)}) - إجمالي المسدد من المديونية (${fmtInt(ftb.totalDebtCollected)}) = *صافي مديونية المزرعة المتبقية: ${fmtInt(ftb.closingFarmDebt)} ج.م*`,
        `💵 إجمالي وارد النقدية التراكمي (قبل المصاريف): ${fmtInt(ftb.totalCashInflowBeforeExpenses)} ج.م (نقدي مبيعات: ${fmtInt(ftb.sumCashSales)} + نقدي مديونيات: ${fmtInt(ftb.sumDebtCash)} + نقدي سابقة: ${fmtInt(ftb.sumPrevCash)})`,
        `💸 (-) يخصم إجمالي المصروفات والمكافآت: ${fmtInt(ftb.sumExpenses)} ج.م`,
        `✅ *صافي النقدية التراكمية بالخزنة (بعد المصاريف): ${fmtInt(ftb.netCumulativeCashInBox)} ج.م*`,
        `🏦 إجمالي النقدية الموردة للإدارة: ${fmtInt(ftb.sumDeliveredCash)} ج.م${ftb.lastDayCarriedForwardCash > 0 ? ` | مرحّل بآخر يوم: ${fmtInt(ftb.lastDayCarriedForwardCash)} ج.م` : ''}`,
        `📊 فرق الخزينة التراكمي: ${fmtInt(ftb.cumulativeCashBoxDiff)} ج.م (${statusTxt})`
      ].join('\n');
      copyTextToClipboardReliable(text);
      showToast('تم نسخ ميزان المراجعة الكامل للمزرعة للحافظة — جاهز للصق في واتساب! 📲');
    });
  }

  // Copy WhatsApp Daily Summary
  document.getElementById('btnShareWhatsappSummary').addEventListener('click', () => {
    const s = computeDaySummary(appState.currentDay);
    const text = [
      `📊 *ملخص محضر بيع وميزان خزنة مزرعة ${appState.farmName}*`,
      `📅 اليوم: يوم ${s.dayNum} (${s.dateLabel})`,
      `🚛 عدد السيارات: ${fmtInt(s.countCars)} سيارة`,
      `⚖️ إجمالي الوزن الصافي: ${fmtInt(s.sumNetW)} كجم`,
      `💰 إجمالي المبيعات بالإكرامية: ${fmtDec(s.sumTotalWithTip)} ج.م`,
      `💵 نقدي المبيعات + تحصيل مديونيات: ${fmtInt(s.sumCashSales + s.sumDebtCash)} ج.م`,
      `🏦 تحصيلات مزارع سابقة (نقدي للخزنة): ${fmtInt(s.sumPrevCash)} ج.م`,
      `💳 إجمالي التحويلات (كاش/بنكي/إنستا/شيك): ${fmtInt(s.totalAllTransfers)} ج.م`,
      `⚖️ متوسط سعر الكيلو المرجح: ${fmtDec(s.avgPrice)} ج.م/كجم${s.pendingCarsCount > 0 ? ` | ⚠️ سيارات مؤقتة: ${fmtInt(s.pendingCarsCount)}` : ''}`,
      `📌 حركة مديونية المزرعة: أول اليوم (${fmtInt(s.openingDayDebt)}) + آجل اليوم (${fmtInt(s.sumCreditSales)}) - مسدد المديونية (${fmtInt(s.dayDebtCollected)}) = *صافي المديونية آخر اليوم: ${fmtInt(s.closingDayDebt)} ج.م*`,
      `💸 (-) إجمالي المصروفات والمكافآت: ${fmtInt(s.sumExpenses)} ج.م`,
      ...(s.openingCashFromPrevDay > 0 ? [`🔄 (+) رصيد نقدي مرحّل من خزنة أمس: ${fmtInt(s.openingCashFromPrevDay)} ج.م`] : []),
      `✅ *إجمالي النقدية المتاحة بالخزنة: ${fmtInt(s.totalAvailableCashInBox)} ج.م* (المورد للإدارة: ${fmtInt(s.deliveredCash)} ج.م${s.carriedForwardCash > 0 ? ` | مرحّل للغد: ${fmtInt(s.carriedForwardCash)} ج.م` : ''} | فرق الخزينة: ${fmtInt(s.cashBoxDiff)} ج.م)`
    ].join('\n');

    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      showToast('تم نسخ ملخص اليوم وميزان الخزنة — يمكنك لصقه في واتساب مباشرة!', '📲');
    } catch (err) {
      showToast('تم تجهيز الملخص', '📲');
    }
    document.body.removeChild(ta);
  });

  // Export Excel Buttons & Full JSON Backup / Restore Buttons
  document.getElementById('btnQuickExportXlsx').addEventListener('click', exportFullWorkbookXlsx);
  document.getElementById('btnExportFullExcel2').addEventListener('click', exportFullWorkbookXlsx);

  const btnQuickJsonEl = document.getElementById('btnQuickExportJsonBackup');
  if (btnQuickJsonEl) btnQuickJsonEl.addEventListener('click', exportFullJsonBackup);

  const btnFullJsonEl = document.getElementById('btnDownloadFullJsonBackup');
  if (btnFullJsonEl) btnFullJsonEl.addEventListener('click', exportFullJsonBackup);

  const btnDdJsonEl = document.getElementById('btnDropdownJsonBackup');
  if (btnDdJsonEl) {
    btnDdJsonEl.addEventListener('click', () => {
      const dd = document.getElementById('headerUserDropdownMenu');
      if (dd) dd.classList.add('hidden');
      const syncTabBtn = document.querySelector('[data-nav="sync"]');
      if (syncTabBtn) syncTabBtn.click();
      setTimeout(() => {
        const cardEl = document.getElementById('fullJsonBackupAndAuditCard');
        if (cardEl) cardEl.scrollIntoView({ behavior: 'smooth' });
      }, 80);
    });
  }

  const btnTrigRestoreEl = document.getElementById('btnTriggerRestoreJsonBackup');
  if (btnTrigRestoreEl) {
    btnTrigRestoreEl.addEventListener('click', () => {
      const fileInp = document.getElementById('fileRestoreJsonBackup');
      if (fileInp) fileInp.click();
    });
  }

  const fileRestoreJsonEl = document.getElementById('fileRestoreJsonBackup');
  if (fileRestoreJsonEl) {
    fileRestoreJsonEl.addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (evt) => {
        restoreFullJsonBackupFromText(String(evt.target.result || ''), file.name);
      };
      reader.readAsText(file, 'utf-8');
      e.target.value = '';
    });
  }

  const inpAuditFilterEl = document.getElementById('inpFilterAuditTrail');
  if (inpAuditFilterEl) {
    inpAuditFilterEl.addEventListener('input', renderBackupAndAuditCenterUI);
  }
  const selAuditTypeEl = document.getElementById('selFilterAuditType');
  if (selAuditTypeEl) {
    selAuditTypeEl.addEventListener('change', renderBackupAndAuditCenterUI);
  }

  // Sync Button (Smart Sync: pulls if fresh browser without local edits, pushes if local edits exist)
  document.getElementById('btnSyncNow').addEventListener('click', async () => {
    if (liveExcelFileHandle) {
      await exportFullWorkbookXlsx();
      if (!(appState.webhookUrl || getEmbeddedWebhookUrl()) || !navigator.onLine) {
        return;
      }
    }
    if (!navigator.onLine) {
      showToast('أنت الآن في وضع الأوفلاين — جميع بياناتك محفوظة بأمان على المتصفح.', '🟠');
      return;
    }
    if (appState.webhookUrl || getEmbeddedWebhookUrl()) {
      const hadMeaningfulLocalEdits = Boolean(appState.hasLocalEdits && (countMovementsInDays(appState.days) > 0 || Number(appState.farmResetAt) > 0));
      if (!hadMeaningfulLocalEdits) {
        const pulled = await pullDatabaseFromCloud(false, true);
        if (!pulled) {
          await pushDatabaseToCloud(false, true);
        }
      } else {
        await pushDatabaseToCloud(false, true);
      }
      return;
    }
    appState.pendingChanges = 0;
    saveState(false);
    showToast('⚠️ تم الحفظ على هذا المتصفح فقط — الصق رابط السحابة في تبويب (⚙️ التحكم والمزامنة) لمشاركتها عبر المتصفحات!', '🔄');
  });

  // Save Webhook URL & Smart Sync (Pulls from cloud first if this browser has no local edits, preventing accidental overwrite!)
  const inpCloudWebhookEl = document.getElementById('inpCloudWebhookUrl');
  if (inpCloudWebhookEl) {
    inpCloudWebhookEl.addEventListener('input', () => {
      const v = inpCloudWebhookEl.value.trim();
      if (v.startsWith('http')) {
        appState.webhookUrl = v;
        try { localStorage.setItem(STORAGE_KEY + '_webhook_url', v); } catch (e) {}
      }
    });
  }

  document.getElementById('btnSaveWebhook').addEventListener('click', async () => {
    const enteredUrl = document.getElementById('inpCloudWebhookUrl').value.trim();
    const hadMeaningfulLocalEdits = Boolean(appState.hasLocalEdits && (countMovementsInDays(appState.days) > 0 || Number(appState.farmResetAt) > 0));
    appState.webhookUrl = enteredUrl;
    if (enteredUrl) {
      window.EMBEDDED_CLOUD_WEBHOOK_URL = enteredUrl;
      const liveMeta = document.getElementById('metaEmbeddedCloudWebhookUrl');
      if (liveMeta) liveMeta.setAttribute('content', enteredUrl);
      const inpEl = document.getElementById('inpCloudWebhookUrl');
      if (inpEl) inpEl.setAttribute('value', enteredUrl);
    }
    saveState(false);
    startLiveRealtimeSyncEngine();
    if (enteredUrl) {
      if (!hadMeaningfulLocalEdits) {
        const pulled = await pullDatabaseFromCloud(false, true);
        if (!pulled) {
          await pushDatabaseToCloud(false, true);
        }
      } else {
        await pushDatabaseToCloud(false, true);
      }
    } else {
      showToast('تم مسح رابط المزامنة السحابية');
    }
  });

  // Pre-fetch and cache external style.css & app.js so Google Sites Embed generator can inline them into a 100% standalone HTML
  async function preloadExternalAssetsForGoogleSitesEmbed() {
    try {
      const styleLink = document.querySelector('link[href*="style.css"]');
      if (styleLink && !window.__cachedExternalStyleCss) {
        const resCss = await fetch(styleLink.getAttribute('href'), { cache: 'no-store' });
        if (resCss.ok) {
          window.__cachedExternalStyleCss = await resCss.text();
        }
      }
    } catch (e) {}
    try {
      const tplScript = document.querySelector('script[src*="excel-template.js"]');
      if (tplScript && !window.__cachedExternalExcelTemplateJs) {
        const resTpl = await fetch(tplScript.getAttribute('src'), { cache: 'no-store' });
        if (resTpl.ok) {
          window.__cachedExternalExcelTemplateJs = await resTpl.text();
        }
      }
    } catch (e) {}
    try {
      const appScript = document.querySelector('script[src*="app.js"]');
      if (appScript && !window.__cachedExternalAppJs) {
        const resJs = await fetch(appScript.getAttribute('src'), { cache: 'no-store' });
        if (resJs.ok) {
          window.__cachedExternalAppJs = await resJs.text();
        }
      }
    } catch (e) {}
  }
  preloadExternalAssetsForGoogleSitesEmbed();

  function copyTextToClipboardReliable(text) {
    let copied = false;
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '0';
      ta.style.left = '-9999px';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      try { ta.setSelectionRange(0, text.length); } catch (e) {}
      copied = Boolean(document.execCommand('copy'));
      document.body.removeChild(ta);
    } catch (err) {}
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      navigator.clipboard.writeText(text).catch(() => {});
      copied = true;
    }
    return copied;
  }

  // Generate clean self-contained HTML for Google Sites Embed (inlineAllAssets = true) or modular index.html for GitHub Pages
  function buildEmbeddedGoogleSitesHtml(inlineAllAssets = true) {
    window.buildEmbeddedGoogleSitesHtml = buildEmbeddedGoogleSitesHtml;
    const inpEl = document.getElementById('inpCloudWebhookUrl');
    const url = ((inpEl ? inpEl.value : '') || appState.webhookUrl || getEmbeddedWebhookUrl() || '').trim();
    if (url) {
      window.EMBEDDED_CLOUD_WEBHOOK_URL = url;
      appState.webhookUrl = url;
      const liveMeta = document.getElementById('metaEmbeddedCloudWebhookUrl');
      if (liveMeta) liveMeta.setAttribute('content', url);
      if (inpEl) inpEl.setAttribute('value', url);
      saveState(false);
      startLiveRealtimeSyncEngine();
    }

    const cloneDoc = document.documentElement.cloneNode(true);
    const headEl = cloneDoc.querySelector('head') || cloneDoc;
    const bodyEl = cloneDoc.querySelector('body') || cloneDoc;

    // 1. Handle CSS & JS assets:
    //    - When inlineAllAssets = true (for Google Sites Embed), inline ./style.css and ./app.js so the copied code works 100% standalone inside Google Sites iframe!
    //    - When inlineAllAssets = false (for GitHub Pages index.html download), keep external ./style.css and ./app.js links clean.
    const extStyleLink = cloneDoc.querySelector('link[href*="style.css"]');
    const extAppScript = cloneDoc.querySelector('script[src*="app.js"]');

    if (inlineAllAssets) {
      if (extStyleLink) {
        let cssText = window.__cachedExternalStyleCss || '';
        if (!cssText) {
          try {
            cssText = Array.from(document.styleSheets)
              .map(sheet => {
                try { return Array.from(sheet.cssRules || []).map(r => r.cssText).join('\n'); } catch (e) { return ''; }
              })
              .join('\n');
          } catch (e) {}
        }
        if (cssText) {
          const inlineStyle = document.createElement('style');
          inlineStyle.id = 'bundledGoogleSitesStyleCss';
          inlineStyle.textContent = cssText;
          extStyleLink.replaceWith(inlineStyle);
        } else if (window.location.href.startsWith('http')) {
          extStyleLink.setAttribute('href', new URL(extStyleLink.getAttribute('href'), window.location.href).href);
        }
      }
      const extTplScript = cloneDoc.querySelector('script[src*="excel-template.js"]');
      if (extTplScript) {
        const tplText = window.__cachedExternalExcelTemplateJs || '';
        if (tplText) {
          const inlineTplScript = document.createElement('script');
          inlineTplScript.id = 'bundledGoogleSitesExcelTemplateJs';
          inlineTplScript.textContent = tplText;
          extTplScript.replaceWith(inlineTplScript);
        } else if (window.location.href.startsWith('http')) {
          extTplScript.setAttribute('src', new URL(extTplScript.getAttribute('src'), window.location.href).href);
        }
      }
      if (extAppScript) {
        const jsText = window.__cachedExternalAppJs || '';
        if (jsText) {
          const inlineScript = document.createElement('script');
          inlineScript.id = 'bundledGoogleSitesAppJs';
          inlineScript.textContent = jsText;
          extAppScript.replaceWith(inlineScript);
        } else if (window.location.href.startsWith('http')) {
          extAppScript.setAttribute('src', new URL(extAppScript.getAttribute('src'), window.location.href).href);
        }
      }
      // Remove Tailwind CDN runtime-generated style tags ONLY if we still have the Tailwind CDN script in <head> so the copied HTML stays compact and fast
      if (cloneDoc.querySelector('script[src*="tailwindcss"]')) {
        cloneDoc.querySelectorAll('head style:not(#bundledGoogleSitesStyleCss):not(#criticalPrintStyles):not(#criticalMobileWeighbridgeStyles)').forEach(st => {
          if ((st.textContent || '').includes('--tw-')) st.remove();
        });
      }
    } else if (extStyleLink) {
      cloneDoc.querySelectorAll('head style:not(#criticalPrintStyles):not(#criticalMobileWeighbridgeStyles)').forEach(st => st.remove());
    }

    // 2. Embed the Webhook URL cleanly in <meta id="metaEmbeddedCloudWebhookUrl"> and <script id="embeddedWebhookConfigScript">
    const safeUrl = url.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    let metaNode = cloneDoc.querySelector('#metaEmbeddedCloudWebhookUrl');
    if (!metaNode) {
      metaNode = document.createElement('meta');
      metaNode.id = 'metaEmbeddedCloudWebhookUrl';
      metaNode.setAttribute('name', 'cloud-webhook-url');
      headEl.insertBefore(metaNode, headEl.firstChild);
    }
    metaNode.setAttribute('content', url);

    let cfgScript = cloneDoc.querySelector('#embeddedWebhookConfigScript');
    if (!cfgScript) {
      cfgScript = document.createElement('script');
      cfgScript.id = 'embeddedWebhookConfigScript';
      headEl.appendChild(cfgScript);
    }
    cfgScript.textContent = `\n    // رابط المزامنة السحابية المدمج ليسمع تلقائياً في Google Sites و GitHub Pages\n    window.EMBEDDED_CLOUD_WEBHOOK_URL = '${safeUrl}';\n  `;

    const cloneInp = cloneDoc.querySelector('#inpCloudWebhookUrl');
    if (cloneInp) {
      cloneInp.setAttribute('value', url);
    }

    // Hide the Google Sites code preview box in the cloned output
    const cloneGsPreview = cloneDoc.querySelector('#googleSitesEmbedCodePreviewBox');
    if (cloneGsPreview) {
      cloneGsPreview.classList.add('hidden');
    }
    const cloneGsTa = cloneDoc.querySelector('#txtGoogleSitesEmbedCodeOutput');
    if (cloneGsTa) {
      cloneGsTa.textContent = '';
      cloneGsTa.value = '';
    }

    // 3. Clear runtime-populated table bodies & dynamic containers so the template HTML is 100% clean
    [
      '#pendingWeighInsTbody',
      '#dailySalesTbody',
      '#dailyExpensesTbody',
      '#dashTableTbody',
      '#merchantsTbody',
      '#transfersTbody',
      '#prevFarmsTbody',
      '#usersListTbody',
      '#cloudFarmsTbody',
      '#auditTrailTbody',
      '#expSummaryTbody',
      '#daySelectorContainer',
      '#dashKpiGrid',
      '#merchantDrillDownTbody',
      '#merchantDrillDownTfoot',
      '#mdlMerchKpiGrid',
      '#merchantPrintOnlyContainer'
    ].forEach(sel => {
      const el = cloneDoc.querySelector(sel);
      if (el) el.innerHTML = '';
    });

    // 4. Reset login overlay & default tab state in the cloned HTML so opening on any device starts cleanly
    const cloneLogin = cloneDoc.querySelector('#loginGatewayOverlay');
    if (cloneLogin) {
      cloneLogin.classList.remove('hidden');
      cloneLogin.removeAttribute('style');
    }
    const cloneLoginUser = cloneDoc.querySelector('#inpLoginUsername');
    if (cloneLoginUser) cloneLoginUser.setAttribute('value', '');
    const cloneLoginPass = cloneDoc.querySelector('#inpLoginPassword');
    if (cloneLoginPass) cloneLoginPass.setAttribute('value', '');
    const cloneToast = cloneDoc.querySelector('#toastContainer');
    if (cloneToast) {
      cloneToast.classList.add('hidden');
    }
    const cloneMerchModal = cloneDoc.querySelector('#merchantDrillDownModal');
    if (cloneMerchModal) {
      cloneMerchModal.classList.add('hidden');
    }
    if (bodyEl) {
      bodyEl.classList.remove('printing-merchant-modal', 'floating-bar-hidden', 'audit-metadata-hidden', 'lite-field-mode-active');
    }
    const cloneFloatBar = cloneDoc.querySelector('#mobileWeighbridgeActionBar');
    if (cloneFloatBar) {
      cloneFloatBar.classList.remove('hidden');
    }
    const cloneSmartReset = cloneDoc.querySelector('#smartResetInlineBox');
    if (cloneSmartReset) {
      cloneSmartReset.classList.add('hidden');
    }
    ['daily', 'dashboard', 'merchants', 'transfers', 'expenses', 'sync'].forEach(v => {
      const sec = cloneDoc.querySelector(`#view-${v}`);
      if (sec) sec.classList.toggle('hidden', v !== 'daily');
    });
    cloneDoc.querySelectorAll('.nav-tab-btn').forEach(b => {
      b.classList.toggle('tab-btn-active', b.getAttribute('data-nav') === 'daily');
    });

    const rawHtml = '<!DOC' + 'TYPE html>\n' + cloneDoc.outerHTML;
    return { rawHtml, url };
  }

  document.getElementById('btnCopyHtmlWithWebhook').addEventListener('click', async () => {
    const hadMeaningfulLocalEdits = Boolean(appState.hasLocalEdits && (countMovementsInDays(appState.days) > 0 || Number(appState.farmResetAt) > 0));
    await preloadExternalAssetsForGoogleSitesEmbed();
    const { rawHtml, url } = buildEmbeddedGoogleSitesHtml(true);

    copyTextToClipboardReliable(rawHtml);

    // Show interactive Google Sites Embed Code Preview Box so user can also inspect/copy with 1 tap on any device
    const previewBox = document.getElementById('googleSitesEmbedCodePreviewBox');
    const previewTa = document.getElementById('txtGoogleSitesEmbedCodeOutput');
    const previewStatus = document.getElementById('lblGoogleSitesEmbedStatus');
    if (previewBox && previewTa) {
      previewTa.value = rawHtml;
      previewBox.classList.remove('hidden');
      if (previewStatus) {
        const sizeKb = Math.round(rawHtml.length / 1024);
        previewStatus.textContent = url
          ? `✅ كود Google Sites المدمج جاهز ومنسوخ للحافظة (${sizeKb} KB — شامل التصميم والبرمجة ورابط السحابة)`
          : `✅ كود Google Sites المدمج جاهز ومنسوخ للحافظة (${sizeKb} KB — بدون رابط سحابة مدمج)`;
      }
      setTimeout(() => {
        try {
          previewTa.focus();
          previewTa.select();
        } catch (e) {}
      }, 60);
    }

    if (url && navigator.onLine) {
      if (!hadMeaningfulLocalEdits) {
        const pulled = await pullDatabaseFromCloud(true, true);
        if (!pulled) {
          await pushDatabaseToCloud(true, true);
        }
      } else {
        await pushDatabaseToCloud(true, true);
      }
    }
    showToast(
      url
        ? '✅ تم نسخ كود Google Sites المدمج بالكامل (شاملاً التنسيق والبرمجة ورابط السحابة)! الصقه في Google Sites -> Embed -> Embed code.'
        : '✅ تم نسخ كود Google Sites المدمج بالكامل! (للمزامنة التلقائية يمكنك لصق رابط السكربت أولاً ثم النسخ).',
      '📋'
    );
  });

  const btnSelectAllGsCode = document.getElementById('btnSelectAndCopyGoogleSitesCode');
  if (btnSelectAllGsCode) {
    btnSelectAllGsCode.addEventListener('click', () => {
      const previewTa = document.getElementById('txtGoogleSitesEmbedCodeOutput');
      if (!previewTa || !previewTa.value) return;
      copyTextToClipboardReliable(previewTa.value);
      previewTa.focus();
      previewTa.select();
      showToast('✅ تم تحديد ونسخ كود Google Sites المدمج بالكامل للحافظة!', '📋');
    });
  }

  const btnCloseGsPreview = document.getElementById('btnCloseGoogleSitesCodePreview');
  if (btnCloseGsPreview) {
    btnCloseGsPreview.addEventListener('click', () => {
      const previewBox = document.getElementById('googleSitesEmbedCodePreviewBox');
      if (previewBox) previewBox.classList.add('hidden');
    });
  }

  document.getElementById('btnDownloadHtmlWithWebhook').addEventListener('click', async () => {
    const hadMeaningfulLocalEdits = Boolean(appState.hasLocalEdits && (countMovementsInDays(appState.days) > 0 || Number(appState.farmResetAt) > 0));
    await preloadExternalAssetsForGoogleSitesEmbed();
    const { rawHtml, url } = buildEmbeddedGoogleSitesHtml(true);
    const blob = new Blob([rawHtml], { type: 'text/html;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'index.html';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    if (url && navigator.onLine) {
      if (!hadMeaningfulLocalEdits) {
        const pulled = await pullDatabaseFromCloud(true, true);
        if (!pulled) {
          await pushDatabaseToCloud(true, true);
        }
      } else {
        await pushDatabaseToCloud(true, true);
      }
    }
    showToast('✅ تم تحميل ملف index.html الشامل مدمجاً به رابط السحابة! يعمل مباشرة على GitHub Pages و Google Sites وكل الأجهزة.', '📥');
  });

  // Smart Triple-Mode Reset Inline Box Handlers (#btnResetDemoData & #smartResetInlineBox)
  const smartResetBox = document.getElementById('smartResetInlineBox');
  const radResetActive = document.getElementById('radResetModeActiveFarm');
  const radResetFull = document.getElementById('radResetModeFullSite');
  const radResetFactoryZero = document.getElementById('radResetModeFactoryZero');
  const lblResetActive = document.getElementById('lblResetModeActiveFarm');
  const lblResetFull = document.getElementById('lblResetModeFullSite');
  const lblResetFactoryZero = document.getElementById('lblResetModeFactoryZero');
  const badgeResetActive = document.getElementById('smartResetActiveFarmBadge');
  const badgeResetAll = document.getElementById('smartResetAllFarmsCountBadge');
  const badgeResetFactoryZero = document.getElementById('smartResetFactoryZeroBadge');
  const summaryResetWarn = document.getElementById('smartResetWarningSummary');
  const btnConfirmSmartReset = document.getElementById('btnConfirmExecuteSmartReset');
  const btnConfirmSmartResetTxt = document.getElementById('btnConfirmExecuteSmartResetTxt');

  function updateSmartResetModeSelectionUI() {
    const fName = appState.farmName || 'أبوذكري';
    syncActiveFarmIntoArchive();
    const farmsCount = Object.keys(appState.farmsArchive || {}).length;
    const merchCount = (appState.merchants || []).length;
    if (badgeResetActive) badgeResetActive.textContent = `مزرعة ${fName}`;
    if (badgeResetAll) badgeResetAll.textContent = `${farmsCount} مزرعة بالأرشيف`;
    if (badgeResetFactoryZero) badgeResetFactoryZero.textContent = `مسح ${farmsCount} مزرعة + ${merchCount} تاجر + السحابة`;

    const isFactoryZeroMode = Boolean(radResetFactoryZero && radResetFactoryZero.checked);
    const isFullMode = Boolean(!isFactoryZeroMode && radResetFull && radResetFull.checked);

    const inactiveCardCls = 'cursor-pointer rounded-xl border-2 border-slate-300 bg-white hover:bg-slate-50 p-3 flex items-start gap-2.5 transition shadow-sm';
    if (lblResetActive) {
      lblResetActive.className = (!isFullMode && !isFactoryZeroMode)
        ? 'cursor-pointer rounded-xl border-2 border-amber-500 bg-amber-50/90 p-3 flex items-start gap-2.5 transition shadow-md'
        : inactiveCardCls;
    }
    if (lblResetFull) {
      lblResetFull.className = isFullMode
        ? 'cursor-pointer rounded-xl border-2 border-rose-600 bg-rose-100/80 p-3 flex items-start gap-2.5 transition shadow-md'
        : inactiveCardCls;
    }
    if (lblResetFactoryZero) {
      lblResetFactoryZero.className = isFactoryZeroMode
        ? 'cursor-pointer rounded-xl border-2 border-slate-950 bg-rose-200/90 p-3 flex items-start gap-2.5 transition shadow-lg ring-2 ring-rose-500'
        : inactiveCardCls;
    }

    if (summaryResetWarn) {
      if (isFactoryZeroMode) {
        summaryResetWarn.textContent = `☢️ تحذير قصوى (الوضع الثالث): سيتم مسح كل شيء نهائياً في الموقع والسحابة (مسح الـ ${merchCount} تاجر بالكامل + مسح الـ ${farmsCount} مزرعة والأرشيف + مسح جميع الحركات والمصروفات) ليعود الموقع جديداً تماماً بدون أي بيانات!`;
        summaryResetWarn.className = 'text-[11px] font-extrabold text-amber-300 bg-slate-900 border-2 border-rose-500 px-3 py-1.5 rounded-lg shadow-sm';
      } else if (isFullMode) {
        summaryResetWarn.textContent = `🚨 تحذير (الوضع الثاني): سيتم مسح حركات (${fName}) + مسح جميع المزارع الـ (${farmsCount}) من الأرشيف والسحابة نهائياً (مع بقاء دليل التجار والمستخدمين)!`;
        summaryResetWarn.className = 'text-[11px] font-extrabold text-rose-950 bg-rose-200 border border-rose-400 px-3 py-1 rounded-lg';
      } else {
        summaryResetWarn.textContent = `📌 محدد حالياً (الوضع الأول): تصفير حركات مزرعة (${fName}) فقط وإعادتها لـ (يوم 1) دون المساس بباقي المزارع في الأرشيف`;
        summaryResetWarn.className = 'text-[11px] font-extrabold text-amber-950 bg-amber-100 border border-amber-300 px-3 py-1 rounded-lg';
      }
    }
    if (btnConfirmSmartReset && btnConfirmSmartResetTxt) {
      if (isFactoryZeroMode) {
        btnConfirmSmartReset.className = 'px-4 py-2 rounded-xl bg-slate-950 hover:bg-slate-800 text-amber-300 border-2 border-rose-500 font-extrabold text-xs shadow-lg transition flex items-center gap-1.5';
        btnConfirmSmartResetTxt.textContent = `☢️ تأكيد المسح الجذري الشامل لكل شيء (الموقع + السحابة + التجار)`;
      } else if (isFullMode) {
        btnConfirmSmartReset.className = 'px-4 py-2 rounded-xl bg-rose-700 hover:bg-rose-600 text-white font-extrabold text-xs shadow-lg transition flex items-center gap-1.5';
        btnConfirmSmartResetTxt.textContent = `🧨 تأكيد تصفير جميع المزارع (${farmsCount} مزرعة) مع بقاء التجار`;
      } else {
        btnConfirmSmartReset.className = 'px-4 py-2 rounded-xl bg-rose-700 hover:bg-rose-600 text-white font-extrabold text-xs shadow-lg transition flex items-center gap-1.5';
        btnConfirmSmartResetTxt.textContent = `🧹 تأكيد تصفير حركات مزرعة (${fName}) فقط`;
      }
    }
  }

  document.getElementById('btnResetDemoData').addEventListener('click', () => {
    if (!hasPermission('farms') && !hasPermission('sales')) {
      showToast('عفواً، تصفير الحركات متاح لمدير الموقع والمستخدمين المصرح لهم.', '🔒');
      return;
    }
    if (!smartResetBox) {
      clearActiveFarmMovementsKeepMerchants();
      return;
    }
    if (radResetActive) radResetActive.checked = true;
    if (radResetFull) radResetFull.checked = false;
    if (radResetFactoryZero) radResetFactoryZero.checked = false;
    updateSmartResetModeSelectionUI();
    smartResetBox.classList.remove('hidden');
    smartResetBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });

  if (radResetActive) radResetActive.addEventListener('change', updateSmartResetModeSelectionUI);
  if (radResetFull) radResetFull.addEventListener('change', updateSmartResetModeSelectionUI);
  if (radResetFactoryZero) radResetFactoryZero.addEventListener('change', updateSmartResetModeSelectionUI);

  ['btnCancelSmartResetBox', 'btnCancelSmartResetBox2'].forEach(cid => {
    const cancelEl = document.getElementById(cid);
    if (cancelEl && smartResetBox) {
      cancelEl.addEventListener('click', () => {
        smartResetBox.classList.add('hidden');
      });
    }
  });

  if (btnConfirmSmartReset) {
    btnConfirmSmartReset.addEventListener('click', () => {
      const isFactoryZeroMode = Boolean(radResetFactoryZero && radResetFactoryZero.checked);
      const isFullMode = Boolean(!isFactoryZeroMode && radResetFull && radResetFull.checked);
      if (isFactoryZeroMode) {
        if (clearEverythingToFactoryZeroState()) {
          if (smartResetBox) smartResetBox.classList.add('hidden');
        }
      } else if (isFullMode) {
        if (clearAllSiteMovementsAndArchiveKeepMerchants()) {
          if (smartResetBox) smartResetBox.classList.add('hidden');
        }
      } else {
        if (clearActiveFarmMovementsKeepMerchants()) {
          if (smartResetBox) smartResetBox.classList.add('hidden');
        }
      }
    });
  }

  // Import Excel (.xlsx) or JSON Backup file (Full Two-Way Parser)
  document.getElementById('fileImportXlsx').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.name.toLowerCase().endsWith('.json')) {
      const textReader = new FileReader();
      textReader.onload = (evt) => {
        restoreFullJsonBackupFromText(String(evt.target.result || ''), file.name);
      };
      textReader.readAsText(file, 'utf-8');
      e.target.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data = new Uint8Array(evt.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        importWorkbookIntoAppState(workbook, file.name);
      } catch (err) {
        showToast('تعذر قراءة الملف، تأكد من اختيار ملف إكسيل (.xlsx) أو نسخة احتياطية (.json)', '⚠️');
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
  });
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', initFarmSalesApp);
} else {
  initFarmSalesApp();
}
