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
  'مصاريف نثرية أخرى'
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
      deliveredCash: 0
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
    webhookUrl: getEmbeddedWebhookUrl() || '',
    updatedAt: '',
    farmResetAt: 0,
    defaultPrice: 0,
    defaultTip: 0,
    lastScaleNo: 0,
    inactivityTimeoutMin: 20,
    activeUserId: 'admin',
    users: [
      { id: 'admin', username: 'admin', password: 'admin', name: 'مدير الموقع (كامل الصلاحيات)', phone: '', jobTitle: 'مدير عام المزرعة', isSystem: true, perms: { sales: true, expenses: true, merchants: true, farms: true, admin: true, showSyncExcel: true, showSyncCloud: true, showSyncWebhook: true } }
    ],
    merchants: merchants,
    days: days
  };
}

let appState = getDefaultState();
let dashChartInstance = null;
let activeRecalledPendingId = '';
let localMutationEpoch = 0;

// هامش تسامح اختلاف توقيت الساعات بين الأجهزة (Clock Skew Tolerance Buffer = 10 دقائق)
// يحمي حركات المندوبين من الحذف الخاطئ إذا كانت ساعة هاتف أحد المستخدمين متأخرة أو متقدمة عدة دقائق
const CLOCK_SKEW_BUFFER_MS = 10 * 60 * 1000;

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

// توليد معرّف فريد عالمياً (Collision-Proof UUID) للإدخالات اليدوية لمنع تصادم المعرفات بين الأجهزة في وضع الأوفلاين
function generateRecordUUID(prefix = 'rec') {
  const nowMs = Date.now();
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
  if (Number(rec.updatedAt) > 0) return Number(rec.updatedAt);
  if (Number(rec.createdAt) > 0) return Number(rec.createdAt);
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

function areSalesRowsDuplicate(a, b) {
  if (!a || !b) return false;
  if (a.id !== undefined && b.id !== undefined && String(a.id) === String(b.id)) return true;
  const ma = String(a.merchant || '').trim();
  const mb = String(b.merchant || '').trim();
  if (!ma || !mb || ma !== mb) return false;

  const sa = Number(a.scaleNo) || 0;
  const sb = Number(b.scaleNo) || 0;
  const ca = String(a.carNo || '').trim();
  const cb = String(b.carNo || '').trim();
  const w1a = Number(a.w1) || 0, w1b = Number(b.w1) || 0;
  const w2a = Number(a.w2) || 0, w2b = Number(b.w2) || 0;

  // 1. نفس التاجر ونفس رقم مسلسل الميزان مع تطابق الأوزان (حتى لا تُحذف حركة مندوب آخر أوفلاين تصادف أخذها لنفس رقم الميزان التلقائي بأوزان مختلفة)
  if (sa > 0 && sb > 0 && sa === sb && w1a === w1b && w2a === w2b) return true;

  // 2. نفس التاجر ونفس رقم السيارة ونفس الأوزان الفعلية (وزنة 1 ووزنة 2)
  if ((w1a > 0 || w2a > 0) && w1a === w1b && w2a === w2b && ca === cb) return true;

  // 3. تطابق كامل في الأوزان والمبالغ المالية لنفس التاجر
  const sameWeights = (w1a === w1b && w2a === w2b);
  const sameFinancials =
    (Number(a.price) || 0) === (Number(b.price) || 0) &&
    (Number(a.tip) || 0) === (Number(b.tip) || 0) &&
    (Number(a.cashSales) || 0) === (Number(b.cashSales) || 0) &&
    (Number(a.transferSales) || 0) === (Number(b.transferSales) || 0) &&
    (Number(a.creditSales) || 0) === (Number(b.creditSales) || 0) &&
    (Number(a.debtCash) || 0) === (Number(b.debtCash) || 0) &&
    (Number(a.debtTransfer) || 0) === (Number(b.debtTransfer) || 0) &&
    (Number(a.prevCash) || 0) === (Number(b.prevCash) || 0) &&
    (Number(a.prevTransfer) || 0) === (Number(b.prevTransfer) || 0);

  return sameWeights && sameFinancials;
}

function arePendingSalesDuplicate(a, b) {
  if (!a || !b) return false;
  if (a.id !== undefined && b.id !== undefined && String(a.id) === String(b.id)) return true;
  const ma = String(a.merchant || '').trim();
  const mb = String(b.merchant || '').trim();
  if (!ma || !mb || ma !== mb) return false;
  const sa = Number(a.scaleNo) || 0;
  const sb = Number(b.scaleNo) || 0;
  const w1a_chk = Number(a.w1) || 0, w1b_chk = Number(b.w1) || 0;
  if (sa > 0 && sb > 0 && sa === sb && w1a_chk === w1b_chk) return true;
  const ca = String(a.carNo || '').trim();
  const cb = String(b.carNo || '').trim();
  const w1a = Number(a.w1) || 0, w1b = Number(b.w1) || 0;
  return ca === cb && w1a === w1b;
}

function areExpensesDuplicate(a, b) {
  if (!a || !b) return false;
  if (a.id !== undefined && b.id !== undefined && String(a.id) === String(b.id)) return true;
  return (
    String(a.category || '').trim() === String(b.category || '').trim() &&
    String(a.desc || '').trim() === String(b.desc || '').trim() &&
    String(a.recipient || '').trim() === String(b.recipient || '').trim() &&
    (Number(a.amount) || 0) === (Number(b.amount) || 0)
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

function applyParsedStateObject(parsed) {
  if (!parsed || !parsed.days || !parsed.merchants) return false;
  const savedWebhook = (getEmbeddedWebhookUrl() || parsed.webhookUrl || appState.webhookUrl || '').trim();
  appState = { ...getDefaultState(), ...parsed, webhookUrl: savedWebhook };
  appState.deletedIds = ensureDeletedIdsStructure(appState.deletedIds);
  if (appState.liveSyncEnabled === undefined) appState.liveSyncEnabled = true;
  if (!appState.liveSyncIntervalSec) appState.liveSyncIntervalSec = 5;
  if (appState.inactivityTimeoutMin === undefined || appState.inactivityTimeoutMin === null || isNaN(Number(appState.inactivityTimeoutMin))) {
    appState.inactivityTimeoutMin = 20;
  } else {
    appState.inactivityTimeoutMin = Math.max(0, Number(appState.inactivityTimeoutMin));
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
  const baseDefaults = getDefaultState().merchants || [];
  if (!Array.isArray(appState.merchants)) appState.merchants = [];
  if (appState.merchants.length === 0) {
    baseDefaults.forEach(dm => {
      if (!delSet.has(Number(dm.code))) {
        appState.merchants.push({ code: Number(dm.code), name: dm.name });
      }
    });
  }
  if (appState.farmsArchive && typeof appState.farmsArchive === 'object') {
    Object.values(appState.farmsArchive).forEach(fObj => {
      if (fObj && Array.isArray(fObj.merchants)) {
        fObj.merchants.forEach(fm => {
          const c = Number(fm && fm.code);
          const n = String((fm && fm.name) || '').trim();
          if (c >= 100 && n && !delSet.has(c)) {
            if (!appState.merchants.some(m => Number(m.code) === c || m.name === n)) {
              appState.merchants.push({ code: c, name: n });
            }
          }
        });
      }
    });
  }
  appState.merchants = appState.merchants
    .filter(m => m && m.code && m.name && !delSet.has(Number(m.code)))
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
  const nowTs = Date.now();
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
  appState.days[dNum].addedAt = Date.now();
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
    return;
  }
  const currentFarm = appState.farmName || 'أبوذكري';
  const nowTs = Date.now();
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
  appState.hasLocalEdits = true;
  unifyGlobalMerchantsRegistry();
  syncActiveFarmIntoArchive();
  saveState(true, true);
  renderAll();
  showToast(
    customMsg || `تم تصفير جميع حركات مزرعة (${currentFarm}) نهائياً وحفظ التصفير في السحابة مع بقاء التجار المكودين!`,
    customIcon
  );
}

function deleteSpecificDayFromCycle(targetDayNum) {
  if (!hasPermission('sales')) {
    showToast('عفواً، حذف أو تصفير اليوم متاح لمدير الموقع والمستخدمين المصرح لهم.', '🔒');
    return false;
  }
  const cur = Number(targetDayNum) || appState.currentDay || 1;
  const vis = getVisibleDays();
  const nowTs = Date.now();
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
    saveState(true, true);
    renderAll();
    showToast(`تم تصفير ومسح جميع بيانات (يوم ${cur}) نهائياً مع بقائه مفتوحاً كاليوم الأساسي الوحيد`, '🗑️');
    return true;
  }

  appState.visibleDays = otherVisibleDays;
  const remaining = getVisibleDays();
  if (!remaining.includes(appState.currentDay)) {
    appState.currentDay = remaining[remaining.length - 1] || remaining[0] || 1;
  }
  saveState(true, true);
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
  const fName = appState.farmName || 'أبوذكري';
  appState.farmsArchive[fName] = {
    farmName: fName,
    updatedAt: new Date().toLocaleTimeString('ar-EG'),
    farmResetAt: Number(appState.farmResetAt) || 0,
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
  appState.farmName = targetFarm;
  appState.farmResetAt = Number(fObj.farmResetAt) || 0;
  appState.days = JSON.parse(JSON.stringify(fObj.days || {}));
  appState.visibleDays = Array.isArray(fObj.visibleDays) && fObj.visibleDays.length > 0 ? [...fObj.visibleDays] : [1];
  appState.defaultPrice = fObj.defaultPrice !== undefined ? Number(fObj.defaultPrice) : 0;
  appState.defaultTip = fObj.defaultTip !== undefined ? Number(fObj.defaultTip) : 0;
  appState.lastScaleNo = fObj.lastScaleNo !== undefined ? Number(fObj.lastScaleNo) : 0;
  // الكود الموحد واسم التاجر الأساسي ثابت وموحد دائماً في جميع المزارع
  deduplicateAllDaysInState(appState);
  unifyGlobalMerchantsRegistry();
  appState.currentDay = 1;
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

function recordDeletedItem(category, itemId) {
  appState.deletedIds = ensureDeletedIdsStructure(appState.deletedIds);
  const list = appState.deletedIds[category];
  if (Array.isArray(list) && itemId !== undefined && itemId !== null && itemId !== '') {
    const normId = category === 'merchants' ? Number(itemId) : String(itemId);
    if (!list.includes(normId)) {
      list.push(normId);
      if (list.length > 5000) list.shift();
    }
  }
}

function unrecordDeletedItem(category, itemId) {
  appState.deletedIds = ensureDeletedIdsStructure(appState.deletedIds);
  const list = appState.deletedIds[category];
  if (Array.isArray(list) && itemId !== undefined && itemId !== null) {
    const strId = String(itemId);
    appState.deletedIds[category] = list.filter(x => String(x) !== strId);
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
    const ignoreIds = ['inpFilterDailySales', 'inpFilterPendingSales', 'inpFilterDailyExpenses', 'inpDashQuickSearch', 'inpMerchQuickSearch', 'inpFilterTransfers', 'inpFilterPrevFarms', 'inpFilterExpSummary', 'inpFilterUsersList', 'inpFilterCloudFarms', 'inpFilterMerchantModal', 'selModalMerchantSwitcher', 'chkEnableLiveSync', 'selLiveSyncInterval', 'selTopCloudFarm'];
    if (!ignoreIds.includes(ae.id)) return true;
  }
  return false;
}

function renderAllPreservingActiveInputs() {
  if (!verifyActiveUserSession()) return;
  if (isUserActivelyTypingInForm()) {
    updateConnectionAndSyncUI();
    renderUsersAndPermissionsUI();
    renderDaySelector();
    renderDailyView();
    renderDashboardView();
    renderMerchantsAndStatements();
    renderExpensesStatementView();
    renderCloudDatabaseHub();
    updateLiveFormCalculation();
  } else {
    renderAll();
  }
}

// دمج جزئي عميق للسجلات (Deep Granular Record-Level Merge) بناءً على معرف الحركة (ID) مع دعم هامش اختلاف توقيت الأجهزة (Clock Skew Buffer)
function mergeArraysById(localArr, cloudArr, deletedList, idKey = 'id', preferCloudItem = true, isDuplicateFn = null) {
  const delSet = new Set((deletedList || []).map(String));
  const safeLocal = Array.isArray(localArr) ? localArr : [];
  const safeCloud = Array.isArray(cloudArr) ? cloudArr : [];
  const result = [];

  // دمج نسختين لنفس السجل عند تعديله من جهازين مع مراعاة الطابع الزمني للسجل (updatedAt) وهامش اختلاف التوقيت
  const mergeSameRecordVersions = (localItem, cloudItem) => {
    if (!localItem) return { ...cloudItem };
    if (!cloudItem) return { ...localItem };
    const lUpdated = extractTimestampFromRecord(localItem);
    const cUpdated = extractTimestampFromRecord(cloudItem);

    if (lUpdated > 0 && cUpdated > 0 && lUpdated !== cUpdated) {
      if (isTimestampSignificantlyNewer(lUpdated, cUpdated, CLOCK_SKEW_BUFFER_MS)) {
        return { ...cloudItem, ...localItem, updatedAt: lUpdated };
      }
      if (isTimestampSignificantlyNewer(cUpdated, lUpdated, CLOCK_SKEW_BUFFER_MS)) {
        return { ...localItem, ...cloudItem, updatedAt: cUpdated };
      }
      // داخل هامش التسامح الزمني (Clock Skew Buffer): نعتمد الأحدث زمنياً أو الأولوية المحددة مع الحفاظ على الحقول المحدثة
      return (cUpdated > lUpdated || (cUpdated === lUpdated && preferCloudItem))
        ? { ...localItem, ...cloudItem, updatedAt: Math.max(lUpdated, cUpdated) }
        : { ...cloudItem, ...localItem, updatedAt: Math.max(lUpdated, cUpdated) };
    }
    return preferCloudItem
      ? { ...localItem, ...cloudItem, updatedAt: Math.max(lUpdated, cUpdated) || undefined }
      : { ...cloudItem, ...localItem, updatedAt: Math.max(lUpdated, cUpdated) || undefined };
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
      result[existingIdx] = isFromCloud
        ? mergeSameRecordVersions(existingItem, item)
        : mergeSameRecordVersions(item, existingItem);
    }
  };

  primaryArr.forEach(item => upsertGranularItem(item, preferCloudItem));
  secondaryArr.forEach(item => upsertGranularItem(item, !preferCloudItem));
  return result;
}

function mergeDaysObjects(localDays, cloudDays, deletedIds, preferCloud, localResetAt = 0, cloudResetAt = 0) {
  const mergedDays = {};
  const lReset = Number(localResetAt) || 0;
  const cReset = Number(cloudResetAt) || 0;

  for (let d = 1; d <= 10; d++) {
    const defaultLbl = `اليوم ${d}`;
    const lDay = (localDays && localDays[d]) || { dayNumber: d, dateLabel: defaultLbl, sales: [], pendingSales: [], expenses: [], deliveredCash: 0, clearedAt: 0 };
    const cDay = (cloudDays && cloudDays[d]) || { dayNumber: d, dateLabel: defaultLbl, sales: [], pendingSales: [], expenses: [], deliveredCash: 0, clearedAt: 0 };
    const lDayClear = Math.max(lReset, Number(lDay.clearedAt) || 0);
    const cDayClear = Math.max(cReset, Number(cDay.clearedAt) || 0);

    const lHasMov = ((lDay.sales && lDay.sales.length > 0) || (lDay.pendingSales && lDay.pendingSales.length > 0) || (lDay.expenses && lDay.expenses.length > 0));
    const cHasMov = ((cDay.sales && cDay.sales.length > 0) || (cDay.pendingSales && cDay.pendingSales.length > 0) || (cDay.expenses && cDay.expenses.length > 0));

    const lAdded = getLatestDayActivityTimestamp(lDay, lDayClear);
    const cAdded = getLatestDayActivityTimestamp(cDay, cDayClear);
    const maxAdded = Math.max(lAdded, cAdded);
    const maxClear = Math.max(lDayClear, cDayClear);

    // 1. حالة التصفير الصريح المحلي لليوم أو المزرعة:
    // لا يتم مسح حركات السحابة إلا إذا كان الجهاز المحلي فارغاً تماماً (!lHasMov) وكان وقت التصفير المحلي أحدث بشكل قاطع (يتجاوز هامش تسامح اختلاف الساعات CLOCK_SKEW_BUFFER_MS) من آخر إضافة في السحابة.
    // أما إذا كانت حركات السحابة ضمن هامش اختلاف التوقيت (أو أحدث)، فيتم اللجوء للدمج الجزئي بالمعرفات (IDs) بدلاً من الحذف الأعمى!
    if (lDayClear > cDayClear && !lHasMov && isTimestampSignificantlyNewer(lDayClear, cAdded, CLOCK_SKEW_BUFFER_MS)) {
      (cDay.sales || []).forEach(r => { if (r && r.id && !deletedIds.sales.includes(String(r.id))) deletedIds.sales.push(String(r.id)); });
      (cDay.pendingSales || []).forEach(r => { if (r && r.id && !deletedIds.pendingSales.includes(String(r.id))) deletedIds.pendingSales.push(String(r.id)); });
      (cDay.expenses || []).forEach(e => { if (e && e.id && !deletedIds.expenses.includes(String(e.id))) deletedIds.expenses.push(String(e.id)); });
      mergedDays[d] = {
        dayNumber: d,
        dateLabel: lDay.dateLabel || defaultLbl,
        sales: [],
        pendingSales: [],
        expenses: [],
        deliveredCash: Number(lDay.deliveredCash) || 0,
        clearedAt: lDayClear,
        addedAt: lAdded,
        isHidden: Boolean(lDay.isHidden)
      };
      continue;
    }

    // 2. حالة التصفير الصريح السحابي لليوم أو المزرعة:
    // لا يتم مسح الحركات المحلية إلا إذا كانت السحابة فارغة تماماً (!cHasMov) وكان وقت التصفير السحابي أحدث بشكل قاطع (خارج هامش CLOCK_SKEW_BUFFER_MS) من آخر إضافة محلية.
    if (cDayClear > lDayClear && !cHasMov && isTimestampSignificantlyNewer(cDayClear, lAdded, CLOCK_SKEW_BUFFER_MS)) {
      (lDay.sales || []).forEach(r => { if (r && r.id && !deletedIds.sales.includes(String(r.id))) deletedIds.sales.push(String(r.id)); });
      (lDay.pendingSales || []).forEach(r => { if (r && r.id && !deletedIds.pendingSales.includes(String(r.id))) deletedIds.pendingSales.push(String(r.id)); });
      (lDay.expenses || []).forEach(e => { if (e && e.id && !deletedIds.expenses.includes(String(e.id))) deletedIds.expenses.push(String(e.id)); });
      mergedDays[d] = {
        dayNumber: d,
        dateLabel: cDay.dateLabel || defaultLbl,
        sales: [],
        pendingSales: [],
        expenses: [],
        deliveredCash: Number(cDay.deliveredCash) || 0,
        clearedAt: cDayClear,
        addedAt: cAdded,
        isHidden: Boolean(cDay.isHidden)
      };
      continue;
    }

    // 3. رفع الحظر عن معرفات السجلات المستوردة/المضافة بعد تصفير سابق (أو ضمن هامش اختلاف التوقيت مع تصفير سابق فقط)
    // ملاحظة هامة: لا نمسح deletedIds في الأيام العادية (حيث lDayClear === 0 و cDayClear === 0) حتى نحترم الحذف الفردي لأي حركة بعينها!
    if (lDayClear > 0 && cHasMov && !isTimestampSignificantlyNewer(lDayClear, cAdded, CLOCK_SKEW_BUFFER_MS)) {
      const cSaleIds = new Set((cDay.sales || []).map(r => r && r.id !== undefined ? String(r.id) : ''));
      const cPendIds = new Set((cDay.pendingSales || []).map(r => r && r.id !== undefined ? String(r.id) : ''));
      const cExpIds = new Set((cDay.expenses || []).map(e => e && e.id !== undefined ? String(e.id) : ''));
      deletedIds.sales = (deletedIds.sales || []).filter(id => !cSaleIds.has(String(id)));
      deletedIds.pendingSales = (deletedIds.pendingSales || []).filter(id => !cPendIds.has(String(id)));
      deletedIds.expenses = (deletedIds.expenses || []).filter(id => !cExpIds.has(String(id)));
    }
    if (cDayClear > 0 && lHasMov && !isTimestampSignificantlyNewer(cDayClear, lAdded, CLOCK_SKEW_BUFFER_MS)) {
      const lSaleIds = new Set((lDay.sales || []).map(r => r && r.id !== undefined ? String(r.id) : ''));
      const lPendIds = new Set((lDay.pendingSales || []).map(r => r && r.id !== undefined ? String(r.id) : ''));
      const lExpIds = new Set((lDay.expenses || []).map(e => e && e.id !== undefined ? String(e.id) : ''));
      deletedIds.sales = (deletedIds.sales || []).filter(id => !lSaleIds.has(String(id)));
      deletedIds.pendingSales = (deletedIds.pendingSales || []).filter(id => !lPendIds.has(String(id)));
      deletedIds.expenses = (deletedIds.expenses || []).filter(id => !lExpIds.has(String(id)));
    }

    // 4. الدمج الجزئي العميق للمصفوفات (Deep Granular Array Merging by ID):
    // لا يتم استبدال مصفوفة sales أو pendingSales أو expenses بالكامل أبداً؛ بل تُدمج حركة بحركة بناءً على المعرف (id) وسجل deletedIds
    const mergedSales = sortSalesListByScaleNo(
      mergeArraysById(lDay.sales, cDay.sales, deletedIds.sales, 'id', preferCloud, areSalesRowsDuplicate)
    );
    const mergedPending = sortSalesListByScaleNo(
      mergeArraysById(lDay.pendingSales, cDay.pendingSales, deletedIds.pendingSales, 'id', preferCloud, arePendingSalesDuplicate)
    );
    const mergedExpenses = mergeArraysById(
      lDay.expenses, cDay.expenses, deletedIds.expenses, 'id', preferCloud, areExpensesDuplicate
    );
    const hasAnyMovement = mergedSales.length > 0 || mergedPending.length > 0 || mergedExpenses.length > 0;

    // اختيار اسم/تاريخ اليوم بذكاء (تفضيل التسمية المخصصة عن التسمية الافتراضية "اليوم X")
    const lLbl = String(lDay.dateLabel || '').trim() || defaultLbl;
    const cLbl = String(cDay.dateLabel || '').trim() || defaultLbl;
    let chosenLabel = preferCloud ? cLbl : lLbl;
    if (chosenLabel === defaultLbl && (lLbl !== defaultLbl || cLbl !== defaultLbl)) {
      chosenLabel = cLbl !== defaultLbl ? cLbl : lLbl;
    }

    // اختيار النقدية المسلمة للخزينة بذكاء دون مسح قيم الأيام الأخرى أثناء الرفع
    const lDeliv = Number(lDay.deliveredCash) || 0;
    const cDeliv = Number(cDay.deliveredCash) || 0;
    let chosenDeliveredCash = preferCloud ? cDeliv : lDeliv;
    if (!preferCloud && lDeliv === 0 && cDeliv > 0 && d !== Number(appState.currentDay)) {
      chosenDeliveredCash = cDeliv;
    } else if (preferCloud && cDeliv === 0 && lDeliv > 0) {
      chosenDeliveredCash = lDeliv;
    } else if (!preferCloud && cDeliv > 0 && lDeliv === 0 && !lHasMov && cHasMov) {
      chosenDeliveredCash = cDeliv;
    }

    const mergedIsHidden = hasAnyMovement
      ? false
      : (!isTimestampSignificantlyNewer(maxClear, maxAdded, CLOCK_SKEW_BUFFER_MS) && maxAdded > 0
        ? false
        : (preferCloud ? Boolean(cDay.isHidden) : Boolean(lDay.isHidden)));

    const mergedDayObj = {
      dayNumber: d,
      dateLabel: chosenLabel,
      sales: mergedSales,
      pendingSales: mergedPending,
      expenses: mergedExpenses,
      deliveredCash: chosenDeliveredCash,
      clearedAt: hasAnyMovement ? 0 : maxClear,
      addedAt: hasAnyMovement ? Math.max(maxAdded, maxClear + 1) : maxAdded,
      isHidden: mergedIsHidden
    };
    deduplicateDayRecords(mergedDayObj, deletedIds);
    mergedDays[d] = mergedDayObj;
  }
  return mergedDays;
}

function mergeCloudDataIntoLocal(cloudData, preferCloud = true) {
  if (!cloudData || !cloudData.days || !cloudData.merchants) return false;

  // 1. دمج سجل المحذوفات من الجهازين
  const localDel = ensureDeletedIdsStructure(appState.deletedIds);
  const cloudDel = ensureDeletedIdsStructure(cloudData.deletedIds);
  const mergedDeletedIds = {
    sales: Array.from(new Set([...localDel.sales, ...cloudDel.sales].map(String))),
    pendingSales: Array.from(new Set([...localDel.pendingSales, ...cloudDel.pendingSales].map(String))),
    expenses: Array.from(new Set([...localDel.expenses, ...cloudDel.expenses].map(String))),
    merchants: Array.from(new Set([...localDel.merchants, ...cloudDel.merchants].map(Number))),
    users: Array.from(new Set([...localDel.users, ...cloudDel.users].map(String))),
    farms: Array.from(new Set([...localDel.farms, ...cloudDel.farms].map(String)))
  };
  appState.deletedIds = mergedDeletedIds;

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
  const localFarmName = appState.farmName || 'أبوذكري';
  const cloudFarmName = cloudData.farmName || localFarmName;
  const sameActiveFarm = (localFarmName === cloudFarmName);
  const localResetAt = Number(appState.farmResetAt) || 0;
  const cloudResetAt = Number(cloudData.farmResetAt) || 0;

  // 4. دمج أرشيف المزارع المتعددة مع فصل قاعدة بيانات كل مزرعة على حدة ودمج أيامها جزئياً بالمعرفات
  const mergedArchive = { ...(appState.farmsArchive || {}) };
  if (cloudData.farmsArchive && typeof cloudData.farmsArchive === 'object') {
    Object.keys(cloudData.farmsArchive).forEach(fKey => {
      const cArch = cloudData.farmsArchive[fKey];
      const lArch = mergedArchive[fKey];
      if (lArch && lArch.days && cArch && cArch.days) {
        const lArchReset = Number(lArch.farmResetAt) || 0;
        const cArchReset = Number(cArch.farmResetAt) || 0;
        mergedArchive[fKey] = {
          ...lArch,
          ...cArch,
          farmResetAt: Math.max(lArchReset, cArchReset),
          merchants: mergeArraysById(lArch.merchants || [], cArch.merchants || [], mergedDeletedIds.merchants, 'code', preferCloud),
          days: mergeDaysObjects(lArch.days, cArch.days, mergedDeletedIds, preferCloud, lArchReset, cArchReset)
        };
      } else if (cArch) {
        mergedArchive[fKey] = cArch;
      }
    });
  }
  mergedDeletedIds.farms.forEach(fn => { delete mergedArchive[fn]; });
  appState.farmsArchive = mergedArchive;

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
  const cloudMaxAddedAt = getMaxAddedAcrossDays(cloudData.days, cloudResetAt);
  const localMaxAddedAt = getMaxAddedAcrossDays(appState.days, localResetAt);

  // المتصفح يُعتبر فارغاً فقط إذا كان عدد حركاته المحلية = 0 تماماً، ولم يقم بتصفير المزرعة بوقت أحدث بشكل قاطع (خارج هامش CLOCK_SKEW_BUFFER_MS) من إضافات السحابة
  const isLocalEffectivelyFresh = (localMovementsCount === 0) && (
    !appState.hasLocalEdits ||
    (cloudMovementsCount > 0 && !isTimestampSignificantlyNewer(localResetAt, Math.max(cloudResetAt, cloudMaxAddedAt), CLOCK_SKEW_BUFFER_MS))
  );

  if (isLocalEffectivelyFresh && cloudMovementsCount > 0) {
    // تنظيف سجل المحذوفات المحلي من أي معرفات موجودة فعلياً في بيانات السحابة الحالية
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
    appState.farmResetAt = Math.max(localResetAt, cloudResetAt);
    appState.merchants = mergeArraysById(appState.merchants, cloudData.merchants, mergedDeletedIds.merchants, 'code', preferCloud)
      .sort((a, b) => Number(a.code) - Number(b.code));
    appState.days = mergeDaysObjects(appState.days, cloudData.days, mergedDeletedIds, preferCloud, localResetAt, cloudResetAt);

    if (isTimestampSignificantlyNewer(localResetAt, Math.max(cloudResetAt, cloudMaxAddedAt), CLOCK_SKEW_BUFFER_MS) && localMovementsCount === 0) {
      appState.visibleDays = getVisibleDays();
    } else if (isTimestampSignificantlyNewer(cloudResetAt, Math.max(localResetAt, localMaxAddedAt), CLOCK_SKEW_BUFFER_MS) && cloudMovementsCount === 0) {
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
    const existingCloudArch = (appState.farmsArchive && appState.farmsArchive[cloudFarmName]) || {};
    const archResetAt = Number(existingCloudArch.farmResetAt) || 0;
    appState.farmsArchive[cloudFarmName] = {
      farmName: cloudFarmName,
      updatedAt: new Date().toLocaleTimeString('ar-EG'),
      farmResetAt: Math.max(archResetAt, cloudResetAt),
      visibleDays: Array.isArray(cloudData.visibleDays) ? cloudData.visibleDays : [1],
      defaultPrice: cloudData.defaultPrice !== undefined ? Number(cloudData.defaultPrice) : 0,
      defaultTip: cloudData.defaultTip !== undefined ? Number(cloudData.defaultTip) : 0,
      lastScaleNo: cloudData.lastScaleNo !== undefined ? Number(cloudData.lastScaleNo) : 0,
      merchants: JSON.parse(JSON.stringify(appState.merchants)),
      days: mergeDaysObjects(existingCloudArch.days || {}, cloudData.days, mergedDeletedIds, true, archResetAt, cloudResetAt)
    };
    if (preferCloud && !mergedDeletedIds.farms.includes(cloudFarmName)) {
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

  // حماية صارمة ضد مسح السحابة بالبيانات الافتراضية أو بصفوف فارغة من متصفح آخر!
  const localMovCntNow = countMovementsInDays(appState.days);
  const isExplicitFarmReset = Boolean(skipPreFetchMerge && Number(appState.farmResetAt) > 0 && localMovCntNow === 0);
  if (!isExplicitFarmReset && (!appState.hasLocalEdits || (localMovCntNow === 0 && Number(appState.farmResetAt) === 0))) {
    const pulled = await pullDatabaseFromCloud(silent, true);
    if (pulled && countMovementsInDays(appState.days) > 0) {
      return true;
    }
  }

  isCloudSyncInProgress = true;
  try {
    const baseEndpoint = isFirebase ? (url.replace(/\/$/, '') + '/abouzekry_cloud_db.json') : url;

    // سحب ودمج آخر تحديثات الأجهزة الأخرى قبل الرفع (يتم تخطي دمج الأيام القديمة عند التصفير الصريح أو استيراد الإكسيل)
    if (!skipPreFetchMerge) {
      try {
        const sep = baseEndpoint.includes('?') ? '&' : '?';
        const preEndpoint = `${baseEndpoint}${sep}_t=${Date.now()}`;
        const preRes = await fetch(preEndpoint, { method: 'GET', redirect: 'follow', cache: 'no-store' });
        const preText = await preRes.text();
        if (preText && preText.trim() !== '{}' && preText.trim() !== 'null') {
          const remoteData = JSON.parse(preText);
          if (remoteData && remoteData.days && remoteData.merchants) {
            const remoteMovCnt = countMovementsInDays(remoteData.days);
            const currLocalMovCnt = countMovementsInDays(appState.days);
            const preferCloudOnEmptyLocal = (currLocalMovCnt === 0 && remoteMovCnt > 0 && Number(appState.farmResetAt) <= (Number(remoteData.farmResetAt) || 0));
            mergeCloudDataIntoLocal(remoteData, preferCloudOnEmptyLocal);
            if (preferCloudOnEmptyLocal) {
              renderAllPreservingActiveInputs();
            }
          }
        }
      } catch (preErr) {}
    }

    const method = isFirebase ? 'PUT' : 'POST';
    const nowIso = new Date().toISOString();
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
      farmResetAt: Number(appState.farmResetAt) || 0,
      currentDay: appState.currentDay,
      visibleDays: appState.visibleDays,
      defaultPrice: appState.defaultPrice,
      defaultTip: appState.defaultTip,
      lastScaleNo: appState.lastScaleNo,
      inactivityTimeoutMin: appState.inactivityTimeoutMin,
      deletedIds: ensureDeletedIdsStructure(appState.deletedIds),
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
  if (isCloudSyncInProgress && isLiveBackgroundTick) return false;
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
    // إذا قام المستخدم بتصفير المزرعة أو استيراد إكسيل أو تعديل محلي أثناء انتظار رد الشبكة، نتجاهل الرد القديم فوراً
    if (isLiveBackgroundTick && (localMutationEpoch !== pullStartEpoch || isCloudSyncInProgress)) {
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
      mergeCloudDataIntoLocal(data, true);
      appState.pendingChanges = 0;
      appState.lastExcelSync = `متزامن لحظياً ✓ (${new Date().toLocaleTimeString('ar-EG')})`;
      saveState(false);

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
          const packet = JSON.parse(evt.data);
          if (packet && packet.data && packet.data.days) {
            mergeCloudDataIntoLocal(packet.data, true);
            saveState(false);
            if (verifyActiveUserSession()) {
              renderAllPreservingActiveInputs();
            }
          }
        } catch (err) {}
      });
    } catch (err) {}
  }

  // 2. مؤقت النبض اللحظي الذكي (يعمل مع Google Apps Script ومع Firebase)
  liveSyncTimerId = setInterval(() => {
    if (!appState.liveSyncEnabled || !navigator.onLine || document.hidden) return;
    const activeUrl = (appState.webhookUrl || getEmbeddedWebhookUrl() || '').trim();
    if (activeUrl && !isCloudSyncInProgress) {
      pullDatabaseFromCloud(true, true, true);
    }
  }, intervalMs);
}

function renderCloudDatabaseHub() {
  syncActiveFarmIntoArchive();
  const archive = appState.farmsArchive || {};
  const farmNames = Object.keys(archive);

  // Populate Top Header Farm Switcher Dropdown
  const selTop = document.getElementById('selTopCloudFarm');
  if (selTop) {
    selTop.innerHTML = farmNames.map(fn =>
      `<option value="${fn}" ${fn === appState.farmName ? 'selected' : ''}>☁️ ${fn}</option>`
    ).join('');
  }

  // Compute Cloud KPIs across all archived farms
  let totalSalesRowsAllFarms = 0;
  const tbody = document.getElementById('cloudFarmsTbody');
  if (tbody) tbody.innerHTML = '';

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
      const tr = document.createElement('tr');
      tr.className = isCurrent ? 'bg-emerald-50/70 font-bold' : 'hover:bg-slate-50';
      tr.innerHTML = `
        <td class="p-2 border font-extrabold text-slate-900">
          ${fn}
          ${isCurrent ? '<span class="mr-1 px-2 py-0.5 rounded-full bg-emerald-600 text-white text-[10px]">المزرعة النشطة</span>' : ''}
        </td>
        <td class="p-2 border text-center font-bold">${fmtInt(fCars)} سيارة</td>
        <td class="p-2 border text-left font-bold text-blue-900">${fmtInt(fNetW)} كجم</td>
        <td class="p-2 border text-left font-extrabold">${fmtDec(fSales)} ج.م</td>
        <td class="p-2 border text-left font-extrabold text-emerald-800">${fmtInt(fCashInBox)} ج.م</td>
        <td class="p-2 border text-left font-bold text-amber-900">${fmtInt(fNetDebt)} ج.م</td>
        <td class="p-1 border text-center">
          <button type="button" data-switch-farm="${fn}" class="px-2 py-1 rounded-lg ${isCurrent ? 'bg-slate-200 text-slate-700' : 'bg-blue-900 text-white hover:bg-blue-800'} font-bold text-xs ml-1">
            ${isCurrent ? 'مفتوحة' : '📂 فتح'}
          </button>
          <button type="button" data-export-farm="${fn}" class="px-2 py-1 rounded-lg gold-badge font-extrabold text-xs shadow hover:opacity-90 ml-1">
            📥 سحب إكسيل
          </button>
          ${hasPermission('farms') ? `
            <button type="button" data-rename-farm="${fn}" class="px-2 py-1 rounded-lg bg-amber-100 text-amber-900 hover:bg-amber-200 font-bold text-xs ml-1">✏️ تعديل</button>
            <button type="button" data-delete-farm="${fn}" class="px-2 py-1 rounded-lg bg-rose-100 text-rose-800 hover:bg-rose-200 font-bold text-xs">🗑️ حذف</button>
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
    appState.pendingChanges = (appState.pendingChanges || 0) + 1;
    appState.hasLocalEdits = true;
    appState.updatedAt = new Date().toISOString();
  }
  deduplicateAllDaysInState(appState);
  syncActiveFarmIntoArchive();
  const serialized = JSON.stringify(appState);
  try {
    localStorage.setItem(STORAGE_KEY, serialized);
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
  const cleaned = String(newName || '').trim() || 'أبوذكري';
  appState.farmName = cleaned;
  document.getElementById('inpTopFarmName').value = cleaned;
  document.getElementById('inpSettingsFarmName').value = cleaned;
  document.getElementById('headerFarmBadge').textContent = cleaned;
  document.getElementById('dailyFarmNameBadge').textContent = cleaned;
  document.getElementById('dashFarmNameTitle').textContent = cleaned;
  document.title = `نظام محاضر لجان بيع المزارع - ${cleaned}`;
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
  return String(rawName).replace(/[0-9\-\(\)]/g, '').trim();
}

function resolveMerchantCode(rawName) {
  if (!rawName || !String(rawName).trim()) return 0;
  const trimmed = String(rawName).trim();
  const exact = appState.merchants.find(m => m.name === trimmed);
  if (exact) return exact.code;

  const cleaned = cleanMerchantBaseName(trimmed);
  if (cleaned) {
    const byClean = appState.merchants.find(m => m.name === cleaned);
    if (byClean) return byClean.code;
    const byPartial = appState.merchants.find(m => m.name.includes(cleaned) || cleaned.includes(m.name));
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
    appState.merchants.push({ code: nextCode, name: base });
  }
  if (appState.deletedIds && Array.isArray(appState.deletedIds.merchants)) {
    appState.deletedIds.merchants = appState.deletedIds.merchants.filter(c => Number(c) !== Number(nextCode));
  }
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

  // Remaining Custody after deducting Current-Farm Debt Collection
  const netCustodyRemaining = totalCustody - (debtCash + debtTransfer);

  const totalPaidAndCredit = cashSales + transferSales + creditSales;
  const invoiceDiff = totalPaidAndCredit - totalWithTip;
  const code = resolveMerchantCode(row.merchant);

  return {
    ...row,
    code,
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
  let sumW1 = 0, sumW2 = 0, sumNetW = 0, sumTip = 0, sumBase = 0, sumTotalWithTip = 0;
  let sumCashSales = 0, sumTransferSales = 0, sumCreditSales = 0;
  let sumDebtCash = 0, sumDebtTransfer = 0;
  let sumPrevCash = 0, sumPrevTransfer = 0;
  let sumPaidAndCredit = 0, sumInvoiceDiff = 0;

  rows.forEach(r => {
    if (r.w1 > 0 || r.w2 > 0 || r.totalWithTip > 0 || r.cashSales > 0 || r.debtCash > 0 || r.prevCash > 0) {
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
  const sumExpenses = expenses.reduce((acc, e) => acc + (Number(e.amount) || 0), 0);

  const totalCashBeforeExpenses = sumCashSales + sumDebtCash + sumPrevCash;
  const netCashInBox = totalCashBeforeExpenses - sumExpenses;
  const deliveredCash = Number(dayObj.deliveredCash) || 0;
  const cashBoxDiff = netCashInBox - deliveredCash;

  const currentFarmTransfers = sumTransferSales + sumDebtTransfer;
  const totalAllTransfers = currentFarmTransfers + sumPrevTransfer;

  const weightAuditDiff = sumNetW - (sumW2 - sumW1);
  const invoiceAuditDiff = Number(((sumPaidAndCredit - sumTotalWithTip) - sumInvoiceDiff).toFixed(2));

  return {
    dayNum,
    dateLabel: dayObj.dateLabel,
    rows,
    pendingRows,
    allOrderedRows,
    expenses,
    countCars,
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
    sumPrevCash,
    sumPrevTransfer,
    sumPaidAndCredit,
    sumInvoiceDiff,
    sumExpenses,
    totalCashBeforeExpenses,
    netCashInBox,
    deliveredCash,
    cashBoxDiff,
    currentFarmTransfers,
    totalAllTransfers,
    weightAuditDiff,
    invoiceAuditDiff
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

  const fName = appState.farmName || 'أبوذكري';
  document.getElementById('inpTopFarmName').value = fName;
  document.getElementById('inpSettingsFarmName').value = fName;
  document.getElementById('headerFarmBadge').textContent = fName;
  document.getElementById('dailyFarmNameBadge').textContent = fName;
  document.getElementById('dashFarmNameTitle').textContent = fName;

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
    const btn = document.createElement('button');
    btn.type = 'button';
    const isActive = d === appState.currentDay;
    btn.className = `p-2 rounded-xl border text-center transition flex flex-col items-center justify-center ${
      isActive
        ? 'day-pill-active shadow-md'
        : 'bg-slate-50 hover:bg-slate-100 text-slate-800 border-slate-300 font-bold'
    }`;
    btn.innerHTML = `
      <span class="text-xs font-extrabold">يوم ${d}</span>
      <span class="text-[10px] ${isActive ? 'text-amber-300' : 'text-slate-500'}">${summary.countCars} حركة</span>
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

  document.getElementById('currentDayDateInput').value = summary.dateLabel;
  document.getElementById('saleFormDayLabel').textContent = `يوم ${d} - مزرعة ${appState.farmName}`;
  document.getElementById('tblDayTitle').textContent = `يوم ${d} (${summary.dateLabel}) - مزرعة ${appState.farmName}`;
  document.getElementById('expDayTitle').textContent = `يوم ${d}`;
  document.getElementById('tbDayTitle').textContent = `يوم ${d} - مزرعة ${appState.farmName}`;

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

      const merchantCellHtml = r.isPending
        ? `${r.merchant} <span class="inline-block mr-1 px-1.5 py-0.5 rounded bg-amber-400 text-slate-950 text-[10px] font-extrabold shadow-sm">⏳ محجوز (وزنة 1)</span>`
        : r.merchant;
      const w2CellHtml = r.isPending
        ? '<span class="text-amber-800 font-extrabold text-[11px]">⏳ بانتظار وزنة 2</span>'
        : fmtInt(r.w2);
      const actionCellHtml = !hasPermission('sales')
        ? '<span class="text-slate-400 text-[11px]">🔒 عرض فقط</span>'
        : (r.isPending
          ? `<button type="button" data-recall-pending="${r.id}" class="px-2 py-1 rounded bg-emerald-600 text-white font-extrabold hover:bg-emerald-500 ml-1 shadow-sm" title="استرجاع الحركة المحجوزة لاستكمال الوزنة الثانية">🔄 استكمال</button>
             <button type="button" data-del-pending="${r.id}" class="px-2 py-1 rounded bg-rose-100 text-rose-800 font-bold hover:bg-rose-200">حذف</button>`
          : `<button type="button" data-edit-sale="${r.id}" class="px-2 py-1 rounded bg-blue-100 text-blue-900 font-bold hover:bg-blue-200 ml-1">تعديل</button>
             <button type="button" data-del-sale="${r.id}" class="px-2 py-1 rounded bg-rose-100 text-rose-800 font-bold hover:bg-rose-200">حذف</button>`);

      tr.innerHTML = `
        <td class="p-2 border text-center font-bold">${idx + 1}</td>
        <td class="p-2 border text-center font-extrabold text-blue-900">${r.code || '-'}</td>
        <td class="p-2 border font-extrabold text-slate-900">${merchantCellHtml}</td>
        <td class="p-2 border text-center text-[11px] font-extrabold ${r.isPending ? 'text-amber-900 bg-amber-100/60' : ''}">${r.scaleNo || '-'} / ${r.carNo || '-'}</td>
        <td class="p-2 border text-left font-bold">${fmtInt(r.w1)}</td>
        <td class="p-2 border text-left">${w2CellHtml}</td>
        <td class="p-2 border text-left font-extrabold bg-blue-50/50 text-blue-950">${r.isPending ? '0' : fmtInt(r.netWeight)}</td>
        <td class="p-2 border text-left">${fmtDec(r.price)}</td>
        <td class="p-2 border text-left">${fmtInt(r.tip)}</td>
        <td class="p-2 border text-left font-extrabold bg-blue-50/50">${r.isPending ? '0' : fmtDec(r.totalWithTip)}</td>
        <td class="p-2 border text-left font-bold text-emerald-800">${r.cashSales ? fmtInt(r.cashSales) : '-'}</td>
        <td class="p-2 border text-left font-bold text-amber-900">${r.transferSales ? `${fmtInt(r.transferSales)} (${r.transferSalesType || 'تحويل'})` : '-'}</td>
        <td class="p-2 border text-left font-bold text-slate-800">${r.creditSales ? fmtInt(r.creditSales) : '-'}</td>
        <td class="p-2 border text-left font-bold text-teal-900">${debtTxt}</td>
        <td class="p-2 border text-left font-bold text-purple-900">${prevTxt}</td>
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
      const tr = document.createElement('tr');
      tr.className = 'hover:bg-rose-50/40';
      tr.innerHTML = `
        <td class="p-2 border text-center font-bold">${idx + 1}</td>
        <td class="p-2 border font-extrabold text-rose-950">${exp.category}</td>
        <td class="p-2 border">${exp.desc || '-'}</td>
        <td class="p-2 border font-bold">${exp.recipient || '-'}</td>
        <td class="p-2 border font-extrabold text-rose-800 text-left">${fmtInt(exp.amount)} ج.م</td>
        <td class="p-1.5 border text-center whitespace-nowrap">
          ${hasPermission('expenses') ? `
            <button type="button" data-edit-exp="${exp.id}" class="px-2 py-0.5 rounded bg-blue-100 text-blue-900 font-bold hover:bg-blue-200 ml-1">✏️ تعديل</button>
            <button type="button" data-del-exp="${exp.id}" class="px-2 py-0.5 rounded bg-rose-100 text-rose-800 font-bold hover:bg-rose-200">🗑️ حذف</button>
          ` : '<span class="text-slate-400 text-[11px]">🔒 عرض فقط</span>'}
        </td>
      `;
      expTbody.appendChild(tr);
    });
  }

  document.getElementById('tbPillar1').innerHTML = `
    <div class="flex justify-between py-1 border-b"><span>عدد حركات البيع (سيارات):</span><strong>${fmtInt(summary.countCars)}</strong></div>
    <div class="flex justify-between py-1 border-b"><span>إجمالي الوزنة الثانية (القائم):</span><strong>${fmtInt(summary.sumW2)} كجم</strong></div>
    <div class="flex justify-between py-1 border-b"><span>(-) إجمالي الوزنة الأولى (الفارغ):</span><strong>${fmtInt(summary.sumW1)} كجم</strong></div>
    <div class="flex justify-between py-1 border-b"><span>صافي الوزن المحسوب:</span><strong>${fmtInt(summary.sumNetW)} كجم</strong></div>
    <div class="flex justify-between p-1.5 rounded bg-emerald-100 text-emerald-950 font-extrabold">
      <span>فرق ميزان الأوزان:</span>
      <span>${fmtInt(summary.weightAuditDiff)} (${summary.weightAuditDiff === 0 ? 'وزن مطابق ✓' : 'راجع الوزن!'})</span>
    </div>
  `;

  document.getElementById('tbPillar2').innerHTML = `
    <div class="flex justify-between py-1 border-b bg-amber-50 px-1.5 rounded font-extrabold"><span>إجمالي المبيعات شامل الإكرامية:</span><span>${fmtDec(summary.sumTotalWithTip)}</span></div>
    <div class="flex justify-between py-1 border-b"><span>إجمالي غير النقدي يوم البيع (آجل+تحويل):</span><strong>${fmtInt(summary.sumCreditSales + summary.sumTransferSales)}</strong></div>
    <div class="flex justify-between py-1 border-b text-teal-900"><span>تحويلات المزرعة الحالية (مبيعات+مديونيات):</span><strong>${fmtInt(summary.currentFarmTransfers)}</strong></div>
    <div class="flex justify-between py-1 border-b text-purple-900"><span>تحويلات مزارع سابقة (لا تخصم من الحالية):</span><strong>${fmtInt(summary.sumPrevTransfer)}</strong></div>
    <div class="flex justify-between p-1.5 rounded bg-emerald-100 text-emerald-950 font-extrabold">
      <span>إجمالي جميع التحويلات اليوم:</span>
      <span>${fmtInt(summary.totalAllTransfers)} ج.م</span>
    </div>
  `;

  document.getElementById('tbPillar3').innerHTML = `
    <div class="flex justify-between py-1 border-b"><span>(+) نقدي المبيعات + نقدي مديونيات الحالية:</span><strong>${fmtInt(summary.sumCashSales + summary.sumDebtCash)}</strong></div>
    <div class="flex justify-between py-1 border-b"><span>(+) نقدي مزارع سابقة (للخزنة فقط):</span><strong>${fmtInt(summary.sumPrevCash)}</strong></div>
    <div class="flex justify-between py-1.5 px-1.5 rounded bg-amber-100 text-slate-950 font-extrabold">
      <span>إجمالي النقدية بالخزنة (قبل المصاريف):</span>
      <span>${fmtInt(summary.totalCashBeforeExpenses)}</span>
    </div>
    <div class="flex justify-between py-1 border-b text-rose-800 font-bold"><span>(-) يخصم: إجمالي المصروفات والمكافآت:</span><span>${fmtInt(summary.sumExpenses)}</span></div>
    <div class="flex justify-between py-1.5 px-1.5 rounded bg-emerald-100 text-emerald-950 font-extrabold">
      <span>(=) صافي رصيد النقدية المطلوب توريده:</span>
      <span>${fmtInt(summary.netCashInBox)} ج.م</span>
    </div>
  `;

  document.getElementById('inpDeliveredCash').value = summary.deliveredCash ? fmtMoney(summary.deliveredCash) : '0';
  const diffBox = document.getElementById('tbCashDiffBox');
  const statusTxt = summary.cashBoxDiff === 0
    ? 'خزينة مطابقة ✓'
    : (summary.cashBoxDiff < 0 ? 'زيادة توريد' : 'عجز توريد');
  diffBox.className = `p-2 rounded-lg font-extrabold flex items-center justify-between text-xs mt-1 ${
    summary.cashBoxDiff === 0 ? 'bg-emerald-100 text-emerald-950' : 'bg-rose-100 text-rose-900'
  }`;
  diffBox.innerHTML = `
    <span>فرق الخزينة اليومي (الصافي - المسلم):</span>
    <span>${fmtInt(summary.cashBoxDiff)} ج.م (${statusTxt})</span>
  `;

  // Render Pending First-Weigh Cars (الوزنة الأولى المحفوظة مؤقتاً لحين استكمال الوزنة الثانية)
  const pendingList = (appState.days[d] && appState.days[d].pendingSales) || [];
  const pendSec = document.getElementById('pendingWeighInsSection');
  const pendTbody = document.getElementById('pendingWeighInsTbody');
  const pendBadge = document.getElementById('pendingWeighInsCountBadge');
  if (pendSec && pendTbody && pendBadge) {
    pendBadge.textContent = `${pendingList.length} سيارة`;
    if (pendingList.length === 0 || !hasPermission('sales')) {
      pendSec.classList.add('hidden');
    } else {
      pendSec.classList.remove('hidden');
      pendTbody.innerHTML = pendingList.map(item => `
        <tr class="hover:bg-amber-50/60">
          <td class="p-1.5 border text-center font-extrabold text-blue-900">${item.scaleNo || '-'}</td>
          <td class="p-1.5 border font-extrabold text-slate-900">${item.merchant}</td>
          <td class="p-1.5 border text-center font-bold">${item.carNo || '-'}</td>
          <td class="p-1.5 border text-left font-extrabold text-amber-900">${fmtMoney(item.w1)} كجم</td>
          <td class="p-1.5 border text-left">${fmtMoney(item.price)} | إكرامية: ${fmtMoney(item.tip)}</td>
          <td class="p-1.5 border text-right text-[11px]">${(item.custodyCash || item.custodyTransfer) ? `عهدة: ${fmtMoney((Number(item.custodyCash)||0)+(Number(item.custodyTransfer)||0))}` : (item.notes || 'بانتظار الوزنة الثانية')}</td>
          <td class="p-1 border text-center">
            <button type="button" data-recall-pending="${item.id}" class="px-2 py-0.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-[11px] ml-1 shadow-sm">
              🔄 استرجاع
            </button>
            <button type="button" data-del-pending="${item.id}" class="px-2 py-0.5 rounded-lg bg-rose-100 hover:bg-rose-200 text-rose-800 font-bold text-[11px]">
              🗑️ حذف
            </button>
          </td>
        </tr>
      `).join('');
    }
  }
  if (typeof applyDomTableExcelEngine === 'function') {
    applyDomTableExcelEngine('dailySales');
    applyDomTableExcelEngine('dailyExpenses');
    applyDomTableExcelEngine('pendingWeighIns');
  }
}

// =========================================================================
// UNIVERSAL EXCEL-LIKE SORT & FILTER ENGINE FOR ALL 10 WEBSITE TABLES
// =========================================================================
const excelTableState = {
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
  const statusText = s.countCars === 0 && s.sumExpenses === 0 && s.deliveredCash === 0
    ? 'مفتوح (بدون حركات)'
    : (statusOk ? 'مطابق ومتزن ✓' : 'راجع الميزان!');
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
    const hasMovements = s.countCars > 0 || s.sumExpenses > 0 || s.deliveredCash > 0 ||
      ((appState.days[d] && appState.days[d].pendingSales && appState.days[d].pendingSales.length > 0));
    if (visDays.includes(d) || hasMovements) {
      rows.push(enrichDashSummaryRow(s));
    }
  }
  return rows;
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
        <td class="p-2 border font-bold">${s.dateLabel}</td>
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
          ${s.statusText}
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
      m.cars += 1;
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

function renderMerchantsAndStatements() {
  const fullList = computeMerchantAggregates();
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
        <button type="button" data-drill-merchant="${m.code}" class="text-right text-blue-900 hover:text-amber-700 underline font-extrabold inline-flex items-center gap-1 transition group" title="اضغط لفتح كشف الحساب التفصيلي بالحركات للتاجر (${m.name})">
          <span>${m.name}</span>
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
        <button type="button" data-drill-merchant="${m.code}" class="text-right text-blue-900 hover:text-amber-700 underline font-extrabold inline-flex items-center gap-1 transition" title="اضغط لفتح كشف الحساب التفصيلي بالحركات للتاجر (${m.name})">
          <span>${m.name}</span>
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
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="p-2 border text-center font-bold text-blue-900">${m.code}</td>
      <td class="p-2 border font-extrabold">
        <button type="button" data-drill-merchant="${m.code}" class="text-right text-blue-900 hover:text-amber-700 underline font-extrabold inline-flex items-center gap-1 transition" title="اضغط لفتح كشف الحساب التفصيلي بالحركات للتاجر (${m.name})">
          <span>${m.name}</span>
          <span class="text-[10px] text-blue-700">📋</span>
        </button>
      </td>
      <td class="p-2 border text-left font-bold text-emerald-900">${fmtInt(m.prevCash)}</td>
      <td class="p-2 border text-left font-bold text-amber-900">${fmtInt(m.prevTransfer)}</td>
      <td class="p-2 border text-left font-extrabold bg-purple-50 text-purple-950">${fmtInt(totPf)}</td>
      <td class="p-2 border text-slate-700 font-semibold">${m.prevNotes.join(' | ') || (totPf > 0 ? 'مديونية موقع سابق' : '-')}</td>
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
        totalCompletedCars++;
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

function openMerchantDrillDownModal(merchantCode) {
  const code = Number(merchantCode) || 0;
  if (!code) return;
  activeDrillDownMerchantCode = code;
  const searchInp = document.getElementById('inpFilterMerchantModal');
  if (searchInp) searchInp.value = '';
  renderMerchantDrillDownModal();
  const modal = document.getElementById('merchantDrillDownModal');
  if (modal) modal.classList.remove('hidden');
}

function closeMerchantDrillDownModal() {
  activeDrillDownMerchantCode = 0;
  const modal = document.getElementById('merchantDrillDownModal');
  if (modal) modal.classList.add('hidden');
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
      `<option value="${m.code}" ${Number(m.code) === Number(ledger.code) ? 'selected' : ''}>${m.code} - ${m.name} (${m.cars} حركة)</option>`
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
        ? `${fmtInt(r.transferSales)} <span class="text-[10px] text-teal-800">(${r.transferSalesType || 'تحويل'})</span>`
        : '-';
      const debtPaidTotal = r.debtCash + r.debtTransfer;
      const debtPaidTxt = debtPaidTotal > 0
        ? `${fmtInt(debtPaidTotal)} <span class="text-[10px]">(${r.debtCash > 0 && r.debtTransfer > 0 ? `نقدي ${fmtInt(r.debtCash)} + ${r.debtTransferType || 'تحويل'} ${fmtInt(r.debtTransfer)}` : (r.debtTransfer > 0 ? (r.debtTransferType || 'تحويل') : 'نقدي')})</span>`
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

      tr.innerHTML = `
        <td class="p-2 border text-center font-bold">${idx + 1}</td>
        <td class="p-2 border font-extrabold text-blue-950 whitespace-nowrap">يوم ${r.dayNum} <span class="text-[10px] text-slate-500 font-bold">(${r.dateLabel})</span></td>
        <td class="p-2 border font-extrabold text-slate-900">${r.merchant} ${r.isPending ? '<span class="px-1.5 py-0.5 rounded bg-amber-400 text-slate-950 text-[10px]">⏳ مؤقت</span>' : ''}</td>
        <td class="p-2 border text-center font-extrabold text-blue-900">${r.scaleNo || '-'}</td>
        <td class="p-2 border text-center font-bold">${r.carNo || '-'}</td>
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
        <td class="p-2 border text-right text-[11px] font-bold text-purple-900">${notesCellTxt}</td>
        <td class="p-1.5 border text-center">
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
      <td colspan="2" class="p-2 border text-center">${ledger.sumPrevCash + ledger.sumPrevTransfer > 0 ? `مزارع سابقة: ${fmtInt(ledger.sumPrevCash + ledger.sumPrevTransfer)} ج.م` : 'رصيد المزرعة الحالية ✓'}</td>
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
        <td class="p-2 border font-extrabold text-slate-900">${cat}</td>
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

function renderUsersAndPermissionsUI() {
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
  if (selRole) {
    selRole.innerHTML = users.map(u =>
      `<option value="${u.id}" ${u.id === activeUser.id ? 'selected' : ''}>${u.perms && u.perms.admin ? '👑 ' : '👤 '}${u.name}</option>`
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
  if (cardQuick) cardQuick.classList.toggle('hidden', !showQuickCtrl);
  const cardCloud = document.getElementById('syncCloudDbHubCard');
  if (cardCloud) cardCloud.classList.toggle('hidden', !showCloudHub);
  const cardTwoWay = document.getElementById('syncTwoWayExcelCard');
  if (cardTwoWay) cardTwoWay.classList.toggle('hidden', !showTwoWay);
  const usersModalCard = document.getElementById('usersPermissionsModal');
  if (usersModalCard) usersModalCard.classList.toggle('hidden', !isAdm);

  // Toggle Forms based on granular permissions
  const saleCard = document.getElementById('saleFormCard');
  if (saleCard) saleCard.classList.toggle('hidden', !hasPermission('sales'));
  const expForm = document.getElementById('expenseEntryForm');
  if (expForm) expForm.classList.toggle('hidden', !hasPermission('expenses'));
  const merchForm = document.getElementById('addMerchantForm');
  if (merchForm) merchForm.classList.toggle('hidden', !hasPermission('merchants'));
  const usrForm = document.getElementById('addUserForm');
  if (usrForm) usrForm.classList.toggle('hidden', !hasPermission('admin'));
  const topFarmInp = document.getElementById('inpTopFarmName');
  if (topFarmInp) topFarmInp.disabled = !hasPermission('farms');
  const setFarmInp = document.getElementById('inpSettingsFarmName');
  if (setFarmInp) setFarmInp.disabled = !hasPermission('farms');
  const delivCashInp = document.getElementById('inpDeliveredCash');
  if (delivCashInp) delivCashInp.disabled = !hasPermission('sales');
  const dayDateInp = document.getElementById('currentDayDateInput');
  if (dayDateInp) dayDateInp.disabled = !hasPermission('sales');
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

  // Users Table inside Modal (Admin can edit ANY user's data!)
  const uTbody = document.getElementById('usersListTbody');
  if (uTbody) {
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
        if (pList.length === 0) pList.push('👁️ عرض البيانات + حسابه الشخصي فقط');
      }
      const isCurr = u.id === activeUser.id;
      return `
        <tr class="${isCurr ? 'bg-amber-50 font-bold' : ''}">
          <td class="p-2 border font-extrabold">${u.name} ${isCurr ? '<span class="px-2 py-0.5 rounded bg-emerald-600 text-white text-[10px] mr-1">المستخدم النشط</span>' : ''}</td>
          <td class="p-2 border text-center font-bold text-blue-900">${u.username || u.id}</td>
          <td class="p-2 border text-center font-mono text-xs">${isAdminUser ? (u.password ? u.password : '<span class="text-slate-400">بدون كلمة مرور</span>') : '••••••'}</td>
          <td class="p-2 border text-center text-[11px]">${[u.jobTitle, u.phone].filter(Boolean).join(' | ') || '-'}</td>
          <td class="p-2 border text-center">${u.perms.admin ? 'مدير الموقع' : (pList[0].includes('عرض') ? 'زائر / عرض فقط' : 'مستخدم مخصص')}</td>
          <td class="p-2 border text-slate-700">${pList.join(' + ')}</td>
          <td class="p-1 border text-center">
            ${isAdminUser ? `
              <button type="button" data-activate-user="${u.id}" class="px-2 py-1 rounded bg-emerald-100 text-emerald-900 font-bold text-xs ml-1">تفعيل</button>
              <button type="button" data-edit-user="${u.id}" class="px-2 py-1 rounded bg-blue-100 text-blue-900 font-bold text-xs ml-1">✏️ تعديل البيانات</button>
              ${!u.isSystem ? `
                <button type="button" data-del-user="${u.id}" class="px-2 py-1 rounded bg-rose-100 text-rose-800 font-bold text-xs">🗑️ حذف</button>
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

function renderAll() {
  updateConnectionAndSyncUI();
  renderUsersAndPermissionsUI();
  renderDaySelector();
  renderDailyView();
  renderDashboardView();
  renderMerchantsAndStatements();
  renderExpensesStatementView();
  renderCloudDatabaseHub();
  applyStickySaleDefaults();
  updateLiveFormCalculation();
}

// =========================================================================
// 5. TWO-WAY EXCEL (.XLSX) ENGINE: FULL STYLED 15-SHEET EXPORT & IMPORT
// =========================================================================
const STYLED_XLSX_TEMPLATE_B64 = '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';
let _cachedStyledXlsxTemplate = null;

function tinyInflateRaw(data) {
  let pos = 0, bitBuf = 0, bitCnt = 0;
  const out = [];
  function bits(n) {
    while (bitCnt < n) {
      bitBuf |= (data[pos++] || 0) << bitCnt;
      bitCnt += 8;
    }
    const v = bitBuf & ((1 << n) - 1);
    bitBuf >>>= n;
    bitCnt -= n;
    return v;
  }
  function buildTree(lengths) {
    const counts = new Int32Array(16), nextCode = new Int32Array(16);
    for (let i = 0; i < lengths.length; i++) counts[lengths[i]]++;
    counts[0] = 0;
    let code = 0;
    for (let b = 1; b <= 15; b++) {
      code = (code + counts[b - 1]) << 1;
      nextCode[b] = code;
    }
    const map = new Map();
    for (let sym = 0; sym < lengths.length; sym++) {
      const len = lengths[sym];
      if (len > 0) {
        const c = nextCode[len]++;
        let rev = 0;
        for (let i = 0; i < len; i++) rev = (rev << 1) | ((c >>> i) & 1);
        map.set((len << 16) | rev, sym);
      }
    }
    return map;
  }
  function decodeSym(tree) {
    let code = 0;
    for (let len = 1; len <= 15; len++) {
      code |= bits(1) << (len - 1);
      const sym = tree.get((len << 16) | code);
      if (sym !== undefined) return sym;
    }
    throw new Error('Invalid deflate stream');
  }
  const fixedLitLengths = new Uint8Array(288);
  for (let i = 0; i <= 143; i++) fixedLitLengths[i] = 8;
  for (let i = 144; i <= 255; i++) fixedLitLengths[i] = 9;
  for (let i = 256; i <= 279; i++) fixedLitLengths[i] = 7;
  for (let i = 280; i <= 287; i++) fixedLitLengths[i] = 8;
  const fixedDistLengths = new Uint8Array(32);
  fixedDistLengths.fill(5);
  const fixedLitTree = buildTree(fixedLitLengths);
  const fixedDistTree = buildTree(fixedDistLengths);
  const lenBase = [3,4,5,6,7,8,9,10,11,13,15,17,19,23,27,31,35,43,51,59,67,83,99,115,131,163,195,227,258];
  const lenExtra = [0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0];
  const distBase = [1,2,3,4,5,7,9,13,17,25,33,49,65,97,129,193,257,385,513,769,1025,1537,2049,3073,4097,6145,8193,12289,16385,24577];
  const distExtra = [0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13];
  const clOrder = [16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15];

  let bfinal = 0;
  while (!bfinal) {
    bfinal = bits(1);
    const btype = bits(2);
    if (btype === 0) {
      bitBuf = 0; bitCnt = 0;
      const len = data[pos] | (data[pos + 1] << 8);
      pos += 4;
      for (let i = 0; i < len; i++) out.push(data[pos++]);
    } else {
      let litTree = fixedLitTree, distTree = fixedDistTree;
      if (btype === 2) {
        const hlit = bits(5) + 257, hdist = bits(5) + 1, hclen = bits(4) + 4;
        const clLengths = new Uint8Array(19);
        for (let i = 0; i < hclen; i++) clLengths[clOrder[i]] = bits(3);
        const clTree = buildTree(clLengths);
        const allLengths = new Uint8Array(hlit + hdist);
        let idx = 0;
        while (idx < hlit + hdist) {
          const s = decodeSym(clTree);
          if (s < 16) allLengths[idx++] = s;
          else if (s === 16) {
            const rep = bits(2) + 3, prev = allLengths[idx - 1];
            for (let r = 0; r < rep; r++) allLengths[idx++] = prev;
          } else if (s === 17) {
            const rep = bits(3) + 3;
            for (let r = 0; r < rep; r++) allLengths[idx++] = 0;
          } else {
            const rep = bits(7) + 11;
            for (let r = 0; r < rep; r++) allLengths[idx++] = 0;
          }
        }
        litTree = buildTree(allLengths.subarray(0, hlit));
        distTree = buildTree(allLengths.subarray(hlit));
      }
      while (true) {
        const sym = decodeSym(litTree);
        if (sym === 256) break;
        if (sym < 256) out.push(sym);
        else {
          const lIdx = sym - 257;
          const length = lenBase[lIdx] + (lenExtra[lIdx] ? bits(lenExtra[lIdx]) : 0);
          const dSym = decodeSym(distTree);
          const dist = distBase[dSym] + (distExtra[dSym] ? bits(distExtra[dSym]) : 0);
          let srcIdx = out.length - dist;
          for (let i = 0; i < length; i++) out.push(out[srcIdx++]);
        }
      }
    }
  }
  return new Uint8Array(out);
}

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
        eXml = setXmlCellVal(eXml, `C${er}`, ex.category, false);
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
    dayXml = setXmlFormulaVal(dayXml, 'M102', s.sumTransferSales);
    dayXml = setXmlFormulaVal(dayXml, 'O102', s.sumCreditSales);
    dayXml = setXmlFormulaVal(dayXml, 'P102', s.sumDebtCash);
    dayXml = setXmlFormulaVal(dayXml, 'Q102', s.sumDebtTransfer);
    dayXml = setXmlFormulaVal(dayXml, 'S102', s.sumPrevCash);
    dayXml = setXmlFormulaVal(dayXml, 'T102', s.sumPrevTransfer);
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
        appState.pendingChanges = 0;
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

    appState.pendingChanges = 0;
    appState.lastExcelSync = `آخر تصدير للإكسيل: ${new Date().toLocaleTimeString('ar-EG')}`;
    saveState(false);
    showToast(`تم تحميل شيت الإكسيل (${fileName}) بنفس التنسيق الكامل والألوان والمعادلات لآخر إصدار!`, '📥');
  } catch (err) {
    showToast('حدث خطأ أثناء تجهيز ملف الإكسيل، حاول مرة أخرى', '⚠️');
  }
}

function importWorkbookIntoAppState(workbook, sourceFileName = '') {
  let importedSalesCount = 0;
  let importedExpCount = 0;
  let importedMerchantsCount = 0;

  // 1. Always target and update the currently active farm (المزرعة النشطة)
  const activeFarmName = (appState.farmName || '').trim() || 'أبوذكري';
  appState.farmName = activeFarmName;

  // 2. Read Unified Merchants List from `تكويد التجار وكشف الحساب` (دمج وتثبيت الكود الموحد واسم التاجر الأساسي عبر جميع المزارع)
  const merchSheet = workbook.Sheets['تكويد التجار وكشف الحساب'];
  if (merchSheet) {
    const mRows = XLSX.utils.sheet_to_json(merchSheet, { header: 1, defval: '' });
    mRows.forEach(r => {
      const code = Number(r[1]);
      const name = String(r[2] || '').trim();
      if (code >= 101 && code <= 999 && name && !name.includes('اسم التاجر') && !name.includes('إجمالي')) {
        const byName = appState.merchants.find(x => x.name === name);
        const byCode = appState.merchants.find(x => Number(x.code) === code);
        if (!byName && !byCode) {
          appState.merchants.push({ code, name });
          importedMerchantsCount++;
        }
      }
    });
    unifyGlobalMerchantsRegistry();
  }

  // 3. Read Daily Sheets (`يوم 1`..`يوم 10`) OR single-sheet uploaded file
  const hasTenDaySheets = workbook.SheetNames.some(n => n.startsWith('يوم '));
  const targetSheets = hasTenDaySheets
    ? [1,2,3,4,5,6,7,8,9,10].map(d => ({ dayNum: d, name: `يوم ${d}` }))
    : [{ dayNum: appState.currentDay, name: workbook.SheetNames[0] }];

  targetSheets.forEach(({ dayNum, name }) => {
    const ws = workbook.Sheets[name];
    if (!ws) return;
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

    const oldSales = (appState.days[dayNum] && appState.days[dayNum].sales) || [];
    const oldPendingSales = (appState.days[dayNum] && appState.days[dayNum].pendingSales) || [];
    const oldExpenses = (appState.days[dayNum] && appState.days[dayNum].expenses) || [];

    // Extract Date from Row 2 Col C (rows[1][2])
    if (rows[1] && rows[1][2] && String(rows[1][2]).trim()) {
      appState.days[dayNum].dateLabel = String(rows[1][2]).trim();
    }

    const newSales = [];
    const newPendingSales = [];
    const newExpenses = [];
    let inExpensesSection = false;

    rows.forEach((r, rIdx) => {
      const colA = String(r[0] || '').trim();
      const colR = String(r[17] || '').trim();
      const colP = String(r[15] || '').trim();

      // Detect start of Daily Expenses section (`رابعاً: بيان المصروفات`)
      if (colA.includes('رابعاً:') || colA.includes('بيان المصروفات والمكافآت')) {
        inExpensesSection = true;
        return;
      }

      // Detect Delivered Cash in Trial Balance
      if (colR.includes('النقدية المسلمة فعلياً') || colP.includes('النقدية المسلمة فعلياً')) {
        const delivVal = Number(r[23]) || Number(r[19]) || 0;
        if (delivVal >= 0) appState.days[dayNum].deliveredCash = delivVal;
      }

      if (!inExpensesSection) {
        // Sales rows: sequence 1..45 in colA (and row index < 103)
        const seq = Number(r[0]);
        if (seq >= 1 && seq <= 45 && rIdx < 103) {
          const is25Col = r.length >= 23;
          const is21Col = !is25Col && r.length >= 20;

          const merch = String(is25Col || is21Col ? r[2] : r[1] || '').trim();
          if (!merch || merch.includes('اسم التاجر') || merch.includes('الإجمالي')) return;

          const w1 = Number(is25Col || is21Col ? r[5] : r[4]) || 0;
          const w2 = Number(is25Col || is21Col ? r[6] : r[5]) || 0;
          const price = Number(is25Col || is21Col ? r[8] : r[7]) || 0;
          const cashSales = Number(is25Col || is21Col ? r[11] : r[10]) || 0;
          const creditSales = Number(is25Col || is21Col ? r[14] : r[12]) || 0;
          const debtCash = Number(is25Col || is21Col ? r[15] : r[13]) || 0;
          const prevCash = Number(is25Col ? r[18] : (is21Col ? r[16] : r[14])) || 0;

          if (w1 > 0 || w2 > 0 || price > 0 || cashSales > 0 || creditSales > 0 || debtCash > 0 || prevCash > 0) {
            ensureMerchantExists(merch, is25Col || is21Col ? r[1] : null);
            const scaleNoVal = Number(is25Col || is21Col ? r[3] : r[2]) || '';
            const carNoVal = Number(is25Col || is21Col ? r[4] : r[3]) || '';
            const isPendingRow = (w1 > 0 && w2 <= 0 && cashSales === 0 && creditSales === 0 && debtCash === 0 && prevCash === 0);

            const recObj = {
              id: '',
              merchant: merch,
              scaleNo: scaleNoVal,
              carNo: carNoVal,
              w1,
              w2,
              price,
              tip: Number(is25Col || is21Col ? r[9] : r[8]) || 0,
              cashSales,
              transferSales: Number(is25Col || is21Col ? r[12] : r[11]) || 0,
              transferSalesType: is25Col || is21Col ? String(r[13] || '') : '',
              creditSales,
              debtCash,
              debtTransfer: is25Col ? (Number(r[16]) || 0) : 0,
              debtTransferType: is25Col ? String(r[17] || '') : '',
              prevCash,
              prevTransfer: is25Col ? (Number(r[19]) || 0) : 0,
              prevTransferType: is25Col ? String(r[20] || '') : '',
              notes: String(is25Col ? (r[21] || '') : (is21Col ? (r[17] || '') : (r[15] || ''))).trim()
            };

            if (isPendingRow) {
              // Match existing pending sale to reuse ID and avoid duplication
              const matchedOldPend = oldPendingSales.find(op => arePendingSalesDuplicate(op, recObj));
              if (matchedOldPend) {
                recObj.id = matchedOldPend.id;
                if (matchedOldPend.custodyCash && !recObj.custodyCash) recObj.custodyCash = matchedOldPend.custodyCash;
                if (matchedOldPend.custodyTransfer && !recObj.custodyTransfer) recObj.custodyTransfer = matchedOldPend.custodyTransfer;
                if (matchedOldPend.custodyTransferType && !recObj.custodyTransferType) recObj.custodyTransferType = matchedOldPend.custodyTransferType;
              } else {
                recObj.id = `pend_d${dayNum}_s${scaleNoVal || seq}_c${carNoVal || 0}_w${w1}`;
              }
              unrecordDeletedItem('pendingSales', recObj.id);

              const dupPendIdx = newPendingSales.findIndex(ep => arePendingSalesDuplicate(ep, recObj));
              if (dupPendIdx === -1) {
                newPendingSales.push(recObj);
                importedSalesCount++;
              } else {
                recObj.id = newPendingSales[dupPendIdx].id;
                newPendingSales[dupPendIdx] = recObj;
              }
            } else {
              // Match existing completed sale to reuse ID and avoid duplication
              const matchedOldSale = oldSales.find(os => areSalesRowsDuplicate(os, recObj));
              if (matchedOldSale) {
                recObj.id = matchedOldSale.id;
                if (matchedOldSale.custodyCash && !recObj.custodyCash) recObj.custodyCash = matchedOldSale.custodyCash;
                if (matchedOldSale.custodyTransfer && !recObj.custodyTransfer) recObj.custodyTransfer = matchedOldSale.custodyTransfer;
                if (matchedOldSale.custodyTransferType && !recObj.custodyTransferType) recObj.custodyTransferType = matchedOldSale.custodyTransferType;
              } else {
                recObj.id = `d${dayNum}_s${scaleNoVal || seq}_c${carNoVal || 0}_w${w1}_${w2}`;
              }
              unrecordDeletedItem('sales', recObj.id);

              const dupSaleIdx = newSales.findIndex(es => areSalesRowsDuplicate(es, recObj));
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
        // Inside Daily Expenses Section (rows 116..125)
        const expSeq = Number(r[0]);
        if (expSeq >= 1 && expSeq <= 10) {
          const cat = String(r[2] || '').trim() || 'مصاريف موقع وتشغيل';
          const desc = String(r[7] || r[6] || '').trim();
          const recip = String(r[15] || r[12] || '').trim();
          const amt = Number(r[20]) || Number(r[16]) || 0;
          if (amt > 0) {
            const expObj = {
              id: '',
              category: cat,
              desc,
              recipient: recip,
              amount: amt
            };
            const matchedOldExp = oldExpenses.find(oe => areExpensesDuplicate(oe, expObj));
            expObj.id = matchedOldExp ? matchedOldExp.id : `exp_d${dayNum}_${expSeq}_${amt}`;
            unrecordDeletedItem('expenses', expObj.id);

            if (!newExpenses.some(ee => areExpensesDuplicate(ee, expObj))) {
              newExpenses.push(expObj);
              importedExpCount++;
            }
          }
        }
      }
    });

    // Record any previous day items that were removed/replaced by the Excel import as deleted so Cloud Sync never resurrects them
    const keptSaleIds = new Set(newSales.map(s => String(s.id)));
    oldSales.forEach(os => {
      if (os && os.id !== undefined && !keptSaleIds.has(String(os.id))) {
        recordDeletedItem('sales', String(os.id));
      }
    });
    const keptPendIds = new Set(newPendingSales.map(p => String(p.id)));
    oldPendingSales.forEach(op => {
      if (op && op.id !== undefined && !keptPendIds.has(String(op.id))) {
        recordDeletedItem('pendingSales', String(op.id));
      }
    });
    const keptExpIds = new Set(newExpenses.map(e => String(e.id)));
    oldExpenses.forEach(oe => {
      if (oe && oe.id !== undefined && !keptExpIds.has(String(oe.id))) {
        recordDeletedItem('expenses', String(oe.id));
      }
    });

    const importNowTs = Date.now();
    appState.days[dayNum].sales = sortSalesListByScaleNo(newSales);
    appState.days[dayNum].pendingSales = sortSalesListByScaleNo(newPendingSales);
    appState.days[dayNum].expenses = newExpenses;
    appState.days[dayNum].clearedAt = 0;
    if (newSales.length > 0 || newPendingSales.length > 0 || newExpenses.length > 0) {
      appState.days[dayNum].addedAt = importNowTs;
      appState.days[dayNum].isHidden = false;
    }
    deduplicateDayRecords(appState.days[dayNum], appState.deletedIds);
  });

  // Also check `بيان المصروفات والمكافآت` if daily expenses were stored in simple format
  const expSheet = workbook.Sheets['بيان المصروفات والمكافآت'];
  if (expSheet && importedExpCount === 0) {
    const eRows = XLSX.utils.sheet_to_json(expSheet, { header: 1, defval: '' });
    eRows.forEach((r, idx) => {
      const dayTxt = String(r[0] || r[1] || '');
      const m = dayTxt.match(/يوم\s+(\d+)/);
      if (m) {
        const dNum = Number(m[1]);
        const amt = Number(r[5]) || Number(r[11]) || 0;
        const cat = String(r[2] || r[3] || '').trim();
        if (dNum >= 1 && dNum <= 10 && amt > 0 && cat && !cat.includes('تصنيف')) {
          const expObj = {
            id: `exp_imp_${dNum}_${idx}_${amt}`,
            category: cat,
            desc: String(r[3] || r[5] || '').trim(),
            recipient: String(r[4] || r[9] || '').trim(),
            amount: amt
          };
          unrecordDeletedItem('expenses', expObj.id);
          if (!appState.days[dNum].expenses.some(ee => areExpensesDuplicate(ee, expObj))) {
            appState.days[dNum].expenses.push(expObj);
            importedExpCount++;
          }
        }
      }
    });
  }

  // Update visibleDays, sticky price/tip, and scale number for the active farm from imported sales
  const importedVisDays = [1];
  let maxImportedScale = 0;
  let lastImportedPrice = Number(appState.defaultPrice) || 0;
  let lastImportedTip = Number(appState.defaultTip) || 0;
  for (let d = 1; d <= 10; d++) {
    const dSales = (appState.days[d] && appState.days[d].sales) || [];
    const dPend = (appState.days[d] && appState.days[d].pendingSales) || [];
    const dExps = (appState.days[d] && appState.days[d].expenses) || [];
    if (dSales.length > 0 || dPend.length > 0 || dExps.length > 0) {
      if (!importedVisDays.includes(d)) importedVisDays.push(d);
    }
    [...dSales, ...dPend].forEach(s => {
      if (Number(s.scaleNo) > maxImportedScale) maxImportedScale = Number(s.scaleNo);
      if (Number(s.price) > 0) lastImportedPrice = Number(s.price);
      if (Number(s.tip) >= 0) lastImportedTip = Number(s.tip);
    });
  }
  const finalImportTs = Date.now();
  for (let d = 1; d <= 10; d++) {
    const dm = appState.days[d];
    if (dm && ((dm.sales && dm.sales.length > 0) || (dm.pendingSales && dm.pendingSales.length > 0) || (dm.expenses && dm.expenses.length > 0))) {
      dm.addedAt = finalImportTs + 10;
      dm.clearedAt = 0;
      dm.isHidden = false;
    }
  }
  appState.farmResetAt = 0;
  appState.visibleDays = importedVisDays.sort((a, b) => a - b);
  appState.lastScaleNo = maxImportedScale;
  appState.defaultPrice = lastImportedPrice;
  appState.defaultTip = lastImportedTip;
  appState.pendingChanges = 0;
  appState.lastExcelSync = `تم التحديث من (${sourceFileName || 'شيت الإكسيل'}) الساعة ${new Date().toLocaleTimeString('ar-EG')}`;
  syncActiveFarmIntoArchive();
  saveState(true, true);
  renderAll();
  showToast(
    `تم تحديث الموقع بالكامل من الإكسيل: مزرعة (${appState.farmName}) | ${importedSalesCount} حركة بيع | ${appState.merchants.length} تاجر | ${importedExpCount} مصروف`,
    '📤'
  );
}

// =========================================================================
// 6. EVENT LISTENERS & INTERACTIVE HANDLERS
// =========================================================================
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

  // 2. Standalone Custody Statement:
  //    Custody Total = custodyCash (e.g. 200,000) + custodyTransfer (e.g. 50,000) = 250,000
  //    Deduct Current-Farm Debt Collection (e.g. 100,000 in نقدي تحصيل مديونيات) -> Remaining Custody = 150,000
  const custCash = parseNum(document.getElementById('inpCustodyCash') ? document.getElementById('inpCustodyCash').value : 0) || 0;
  const custTr = parseNum(document.getElementById('inpCustodyTransfer') ? document.getElementById('inpCustodyTransfer').value : 0) || 0;
  const custTrType = document.getElementById('selCustodyTransferType') ? document.getElementById('selCustodyTransferType').value : '';
  const totalCustody = custCash + custTr;
  const remainingCustody = totalCustody - deductedDebtNow;

  const lblTotCust = document.getElementById('lblTotalCustodyEntered');
  const lblNetCust = document.getElementById('lblNetCustodyRemaining');
  if (lblTotCust) lblTotCust.textContent = fmtInt(totalCustody);
  if (lblNetCust) lblNetCust.textContent = fmtInt(remainingCustody);

  const balEl = document.getElementById('calcMerchantBalance');
  const subEl = document.getElementById('calcMerchantBalanceSub');
  if (balEl && subEl) {
    balEl.textContent = `${fmtInt(remainingCustody)} ج.م`;
    subEl.textContent = `إجمالي العهدة (${fmtInt(totalCustody)}${custTr > 0 && custTrType ? ' - ' + custTrType : ''}) - تحصيل مديونيات (${fmtInt(deductedDebtNow)})`;
  }
}

function initFarmSalesApp() {
  if (window.__farmAppInitialized) return;
  window.__farmAppInitialized = true;
  const loadedFromLocal = loadState();
  renderAll();
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
            mergeCloudDataIntoLocal(parsed, true);
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
        mergeCloudDataIntoLocal(parsed, true);
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
      switchActiveTabUI(appState.activeTab || 'daily');
      saveState(false);
      renderAll();
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
      switchActiveTabUI(appState.activeTab || 'daily');
      saveState(false);
      renderAll();
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
      saveState(false);
      renderAll();
      showToast(`تم التبديل إلى قاعدة بيانات مزرعة (${targetFarm})`);
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
    appState.farmName = newName;
    appState.days = emptyDays;
    appState.currentDay = 1;
    appState.visibleDays = [1];
    appState.defaultPrice = 0;
    appState.defaultTip = 0;
    appState.lastScaleNo = 0;
    unifyGlobalMerchantsRegistry();
    appState.farmsArchive[newName] = {
      farmName: newName,
      updatedAt: new Date().toLocaleTimeString('ar-EG'),
      visibleDays: [1],
      defaultPrice: 0,
      defaultTip: 0,
      lastScaleNo: 0,
      merchants: JSON.parse(JSON.stringify(appState.merchants || [])),
      days: emptyDays
    };
    const saleForm = document.getElementById('saleEntryForm');
    if (saleForm) saleForm.reset();
    inp.value = '';
    saveState(true);
    renderAll();
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
        saveState(false);
        renderAll();
        showToast(`تم فتح قاعدة بيانات مزرعة (${fn})`);
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
        updatedAt: Date.now(),
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
    appState.days[appState.currentDay].dateLabel = e.target.value.trim() || `اليوم ${appState.currentDay}`;
    saveState(true);
    renderAll();
  });

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

  // Delivered Cash Input in Trial Balance
  document.getElementById('inpDeliveredCash').addEventListener('input', (e) => {
    appState.days[appState.currentDay].deliveredCash = parseNum(e.target.value) || 0;
    saveState(true);
    renderDailyView();
  });

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

    const candidates = [
      ...appState.merchants.map(m => ({ label: m.name, code: m.code })),
      { label: 'كرنك 1', code: 104 },
      { label: 'كرنك 2', code: 104 }
    ];
    const filtered = val
      ? candidates.filter(c => c.label.includes(val) || String(c.code).includes(val))
      : candidates.slice(0, 10);

    if (filtered.length === 0) {
      suggestBox.classList.add('hidden');
      return;
    }

    suggestBox.innerHTML = filtered.map(c => `
      <div data-pick-merchant="${c.label}" class="px-3 py-2 hover:bg-blue-50 cursor-pointer flex items-center justify-between text-xs font-bold border-b border-slate-100">
        <span class="text-slate-900">${c.label}</span>
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
      updateLiveFormCalculation();
    }
  });

  document.addEventListener('click', (e) => {
    if (!inpMerch.contains(e.target) && !suggestBox.contains(e.target)) {
      suggestBox.classList.add('hidden');
    }
  });

  ['inpW1', 'inpW2', 'inpPrice', 'inpTip', 'inpCashSales', 'inpTransferSales', 'inpCreditSales', 'inpCustodyCash', 'inpCustodyTransfer', 'selCustodyTransferType', 'inpDebtCash', 'inpDebtTransfer', 'inpMerchantName'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', updateLiveFormCalculation);
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

  document.getElementById('btnAutoFillCredit').addEventListener('click', () => {
    const w1 = Math.max(0, parseNum(document.getElementById('inpW1').value) || 0);
    const w2 = Math.max(0, parseNum(document.getElementById('inpW2').value) || 0);
    if ((w1 > 0 || w2 > 0) && w2 < w1) {
      showToast('خطأ: الوزنة الثانية يجب أن تكون أكبر من أو تساوي الوزنة الأولى!', '⚠️');
      return;
    }
    const netW = (w2 >= w1 && w2 > 0) ? (w2 - w1) : 0;
    const price = parseNum(document.getElementById('inpPrice').value) || 0;
    const tip = parseNum(document.getElementById('inpTip').value) || 0;
    const totalWithTip = (netW * price) + tip;
    const cashS = parseNum(document.getElementById('inpCashSales').value) || 0;
    const trS = parseNum(document.getElementById('inpTransferSales').value) || 0;
    const rem = Math.max(0, Math.round(totalWithTip - cashS - trS));
    document.getElementById('inpCreditSales').value = rem;
    updateLiveFormCalculation();
  });

  // حفظ مؤقت للوزنة الأولى والبيانات لحين استكمال الوزنة الثانية
  activeRecalledPendingId = '';

  function recallPendingSaleById(pid) {
    if (!hasPermission('sales')) return;
    const dayObj = appState.days[appState.currentDay];
    const item = (dayObj.pendingSales || []).find(x => x.id === pid);
    if (!item) return;
    activeRecalledPendingId = item.id;
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
    document.getElementById('btnCancelEditSale').classList.remove('hidden');
    document.getElementById('btnSaveSaleText').textContent = `استكمال الوزنة الثانية وحفظ الحركة المحجوزة (ميزان رقم ${item.scaleNo || ''})`;
    updateMerchantSuggestions();
    updateLiveFormCalculation();
    document.getElementById('saleFormCard').scrollIntoView({ behavior: 'smooth' });
    setTimeout(() => document.getElementById('inpW2').focus(), 100);
    showToast(`تم استرجاع حركة (${item.merchant}) المحجوزة بمسلسل ميزان (${item.scaleNo || '-'}) — أدخل الآن (الوزنة الثانية) واضغط حفظ!`, '🔄');
  }

  function deletePendingSaleById(pid) {
    if (!hasPermission('sales')) return;
    recordDeletedItem('pendingSales', pid);
    const dayObj = appState.days[appState.currentDay];
    dayObj.pendingSales = (dayObj.pendingSales || []).filter(x => x.id !== pid);
    if (activeRecalledPendingId === pid) {
      activeRecalledPendingId = '';
      document.getElementById('saleEntryForm').reset();
      document.getElementById('btnCancelEditSale').classList.add('hidden');
      document.getElementById('btnSaveSaleText').textContent = 'حفظ حركة البيع في محضر اليوم (تخزين فوري)';
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

    const pendingObj = {
      id: activeRecalledPendingId || generateRecordUUID(`pend_d${appState.currentDay}`),
      updatedAt: Date.now(),
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
    dayObj.addedAt = Date.now();
    dayObj.clearedAt = 0;
    dayObj.isHidden = false;
    const existingIdx = dayObj.pendingSales.findIndex(x => x.id === pendingObj.id);
    if (existingIdx !== -1) dayObj.pendingSales[existingIdx] = pendingObj;
    else dayObj.pendingSales.push(pendingObj);
    dayObj.pendingSales = sortSalesListByScaleNo(dayObj.pendingSales);

    activeRecalledPendingId = '';
    document.getElementById('saleEntryForm').reset();
    document.getElementById('editSaleId').value = '';
    document.getElementById('btnCancelEditSale').classList.add('hidden');
    document.getElementById('btnSaveSaleText').textContent = 'حفظ حركة البيع في محضر اليوم (تخزين فوري)';
    document.getElementById('dispMerchantCode').textContent = 'يُحدد تلقائياً';
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
    const checkW1 = parseNum(document.getElementById('inpW1').value) || 0;
    const checkW2 = parseNum(document.getElementById('inpW2').value) || 0;
    if (checkW2 <= 0) {
      document.getElementById('inpW2').focus();
      showToast('⚠️ لا يمكن حفظ النتيجة النهائية إلا بعد إدخال (الوزنة الثانية)! إذا كانت السيارة تحت التحميل اضغط (⏳ حفظ مؤقت للوزنة الأولى).', '⚠️');
      return;
    }
    if (checkW2 < checkW1) {
      const wAlert = document.getElementById('weightValidationAlert');
      if (wAlert) wAlert.classList.remove('hidden');
      document.getElementById('inpW2').focus();
      showToast('خطأ في الميزان: الوزنة الثانية يجب أن تكون أكبر من أو تساوي الوزنة الأولى!', '❌');
      return;
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

    const enteredPrice = parseNum(document.getElementById('inpPrice').value) || 0;
    const enteredTip = parseNum(document.getElementById('inpTip').value) || 0;

    appState.defaultPrice = enteredPrice;
    appState.defaultTip = enteredTip;
    appState.lastScaleNo = Math.max(Number(appState.lastScaleNo) || 0, enteredScale);

    const rowObj = {
      id: editId || generateRecordUUID(`d${appState.currentDay}`),
      updatedAt: Date.now(),
      merchant: mName,
      scaleNo: enteredScale,
      carNo: Number(document.getElementById('inpCarNo').value) || '',
      w1: parseNum(document.getElementById('inpW1').value) || 0,
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

    const isDuplicateSale = daySales.some(r => {
      if (editId && r.id === editId) return false;
      const sameMerchant = String(r.merchant || '').trim() === rowObj.merchant;
      const sameCar = String(r.carNo || '').trim() === String(rowObj.carNo || '').trim();
      const sameWeights = Number(r.w1) === Number(rowObj.w1) && Number(r.w2) === Number(rowObj.w2);
      const sameFinancials = Number(r.price) === Number(rowObj.price) &&
        Number(r.cashSales) === Number(rowObj.cashSales) &&
        Number(r.creditSales) === Number(rowObj.creditSales) &&
        Number(r.transferSales) === Number(rowObj.transferSales) &&
        Number(r.debtCash) === Number(rowObj.debtCash);
      return (sameMerchant && sameCar && sameWeights) || (sameMerchant && sameWeights && sameFinancials);
    });
    if (isDuplicateSale) {
      showToast('❌ لا يُسمح بحفظ سجلين بنفس البيانات في جدول حركات البيع المسجلة!', '⚠️');
      return;
    }

    unrecordDeletedItem('sales', rowObj.id);
    dayObj.addedAt = Date.now();
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
    activeRecalledPendingId = '';

    document.getElementById('saleEntryForm').reset();
    document.getElementById('editSaleId').value = '';
    document.getElementById('btnCancelEditSale').classList.add('hidden');
    document.getElementById('btnSaveSaleText').textContent = 'حفظ حركة البيع في محضر اليوم (تخزين فوري)';
    document.getElementById('dispMerchantCode').textContent = 'يُحدد تلقائياً';
    updateLiveFormCalculation();
    saveState(true);
    renderAll();
  });

  document.getElementById('btnCancelEditSale').addEventListener('click', () => {
    activeRecalledPendingId = '';
    document.getElementById('saleEntryForm').reset();
    document.getElementById('editSaleId').value = '';
    document.getElementById('btnCancelEditSale').classList.add('hidden');
    document.getElementById('btnSaveSaleText').textContent = 'حفظ حركة البيع في محضر اليوم (تخزين فوري)';
    applyStickySaleDefaults();
    updateLiveFormCalculation();
  });

  // Edit / Delete / Recall Sale Row Delegation (Protected by Sales Permission)
  document.getElementById('dailySalesTbody').addEventListener('click', (e) => {
    if (!hasPermission('sales')) {
      showToast('عفواً، التعديل والحذف غير متاح للزائر (عرض فقط).', '🔒');
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

      document.getElementById('btnCancelEditSale').classList.remove('hidden');
      document.getElementById('btnSaveSaleText').textContent = 'تحديث حركة البيع المحددة';
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
        dayExps[idx] = {
          ...dayExps[idx],
          updatedAt: Date.now(),
          category,
          desc,
          recipient,
          amount
        };
      }
      if (expDayObj) {
        expDayObj.addedAt = Date.now();
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
    unrecordDeletedItem('expenses', newExpId);
    dayExps.push({
      id: newExpId,
      updatedAt: Date.now(),
      category,
      desc,
      recipient,
      amount
    });
    if (expDayObj) {
      expDayObj.addedAt = Date.now();
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
      const escapedV = v.replace(/"/g, '&quot;');
      return `
        <label data-excel-val-row="${escapedV.toLowerCase()}" class="flex items-center justify-between gap-2 px-1.5 py-1 rounded hover:bg-blue-50 cursor-pointer">
          <span class="inline-flex items-center gap-1.5 truncate">
            <input type="checkbox" class="chk-excel-val-item rounded text-blue-900 w-3.5 h-3.5" value="${escapedV}" ${isChecked ? 'checked' : ''} />
            <span class="truncate">${v || '(فارغ)'}</span>
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
    else if (tableId === 'merch' || tableId === 'transfers' || tableId === 'prevFarms') renderMerchantsAndStatements();
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
      window.print();
    });
  }

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
      `💸 (-) إجمالي المصروفات والمكافآت: ${fmtInt(s.sumExpenses)} ج.م`,
      `✅ *صافي رصيد النقدية بالخزنة للتوريد: ${fmtInt(s.netCashInBox)} ج.م*`
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

  // Export Excel Buttons
  document.getElementById('btnQuickExportXlsx').addEventListener('click', exportFullWorkbookXlsx);
  document.getElementById('btnExportFullExcel2').addEventListener('click', exportFullWorkbookXlsx);

  // Sync Button (Smart Sync: pulls if fresh browser without local edits, pushes if local edits exist)
  document.getElementById('btnSyncNow').addEventListener('click', async () => {
    if (liveExcelFileHandle) {
      await exportFullWorkbookXlsx();
      return;
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

  // Generate clean index.html with permanently embedded Webhook URL for GitHub Pages & Google Sites
  function buildEmbeddedGoogleSitesHtml() {
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

    // Clone the document and clean runtime DOM mutations so the downloaded index.html is pristine for GitHub Pages
    const cloneDoc = document.documentElement.cloneNode(true);

    // 1. Remove runtime <style> tags injected by Tailwind Play CDN if ./style.css link is present
    const hasExternalStyleLink = Boolean(cloneDoc.querySelector('link[href*="style.css"]'));
    if (hasExternalStyleLink) {
      cloneDoc.querySelectorAll('head style').forEach(st => st.remove());
    }

    // 2. Embed the Webhook URL in <meta id="metaEmbeddedCloudWebhookUrl"> and <script id="embeddedWebhookConfigScript">
    const safeUrl = url.replace(/'/g, "\\'");
    let metaNode = cloneDoc.querySelector('#metaEmbeddedCloudWebhookUrl');
    if (!metaNode) {
      metaNode = document.createElement('meta');
      metaNode.id = 'metaEmbeddedCloudWebhookUrl';
      metaNode.setAttribute('name', 'cloud-webhook-url');
      const headEl = cloneDoc.querySelector('head') || cloneDoc;
      headEl.insertBefore(metaNode, headEl.firstChild);
    }
    metaNode.setAttribute('content', url);

    let cfgScript = cloneDoc.querySelector('#embeddedWebhookConfigScript');
    if (!cfgScript) {
      cfgScript = document.createElement('script');
      cfgScript.id = 'embeddedWebhookConfigScript';
      const headEl = cloneDoc.querySelector('head') || cloneDoc;
      headEl.appendChild(cfgScript);
    }
    cfgScript.textContent = `\n    // رابط المزامنة السحابية المدمج في ملف index.html ليسمع تلقائياً في جميع الأجهزة على GitHub Pages\n    window.EMBEDDED_CLOUD_WEBHOOK_URL = '${safeUrl}';\n  `;

    const cloneInp = cloneDoc.querySelector('#inpCloudWebhookUrl');
    if (cloneInp) {
      cloneInp.setAttribute('value', url);
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
      '#expSummaryTbody',
      '#daySelectorContainer',
      '#dashKpiGrid',
      '#merchantDrillDownTbody',
      '#merchantDrillDownTfoot',
      '#mdlMerchKpiGrid'
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
    ['daily', 'dashboard', 'merchants', 'transfers', 'expenses', 'sync'].forEach(v => {
      const sec = cloneDoc.querySelector(`#view-${v}`);
      if (sec) sec.classList.toggle('hidden', v !== 'daily');
    });
    cloneDoc.querySelectorAll('.nav-tab-btn').forEach(b => {
      b.classList.toggle('tab-btn-active', b.getAttribute('data-nav') === 'daily');
    });

    let rawHtml = '<!DOC' + 'TYPE html>\n' + cloneDoc.outerHTML;
    if (url) {
      rawHtml = rawHtml.replace(
        /const EMBEDDED_CLOUD_WEBHOOK_URL = '[^']*';/g,
        `const EMBEDDED_CLOUD_WEBHOOK_URL = '${safeUrl}';`
      );
      rawHtml = rawHtml.replace(
        /window\.EMBEDDED_CLOUD_WEBHOOK_URL = '[^']*';/g,
        `window.EMBEDDED_CLOUD_WEBHOOK_URL = '${safeUrl}';`
      );
    }
    return { rawHtml, url };
  }

  document.getElementById('btnCopyHtmlWithWebhook').addEventListener('click', async () => {
    const hadMeaningfulLocalEdits = Boolean(appState.hasLocalEdits && (countMovementsInDays(appState.days) > 0 || Number(appState.farmResetAt) > 0));
    const { rawHtml, url } = buildEmbeddedGoogleSitesHtml();
    if (!url) {
      showToast('⚠️ الصق رابط السكربت (script.google.com) في الخانة أعلاه أولاً قبل نسخ الكود لـ Google Sites!', '⚠️');
      document.getElementById('inpCloudWebhookUrl').focus();
      return;
    }
    const ta = document.createElement('textarea');
    ta.value = rawHtml;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (err) {}
    document.body.removeChild(ta);
    if (!hadMeaningfulLocalEdits) {
      const pulled = await pullDatabaseFromCloud(true, true);
      if (!pulled) {
        await pushDatabaseToCloud(true, true);
      }
    } else {
      await pushDatabaseToCloud(true, true);
    }
    showToast('✅ تم نسخ كود index.html مدمجاً به رابط السحابة! الصقه أو ارفعه الآن ليسمع في جميع الأجهزة.', '📋');
  });

  document.getElementById('btnDownloadHtmlWithWebhook').addEventListener('click', async () => {
    const hadMeaningfulLocalEdits = Boolean(appState.hasLocalEdits && (countMovementsInDays(appState.days) > 0 || Number(appState.farmResetAt) > 0));
    const { rawHtml, url } = buildEmbeddedGoogleSitesHtml();
    if (!url) {
      showToast('⚠️ الصق رابط السكربت (script.google.com) في الخانة أعلاه أولاً قبل التحميل!', '⚠️');
      document.getElementById('inpCloudWebhookUrl').focus();
      return;
    }
    const blob = new Blob([rawHtml], { type: 'text/html;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'index.html';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    if (!hadMeaningfulLocalEdits) {
      const pulled = await pullDatabaseFromCloud(true, true);
      if (!pulled) {
        await pushDatabaseToCloud(true, true);
      }
    } else {
      await pushDatabaseToCloud(true, true);
    }
    showToast('✅ تم تحميل ملف index.html مدمجاً به رابط السحابة! ارفعه إلى GitHub ليسمع تلقائياً في كل الأجهزة.', '📥');
  });

  // Reset / Clear Current Farm Movements while keeping Merchants & Cloud Sync
  document.getElementById('btnResetDemoData').addEventListener('click', () => {
    clearActiveFarmMovementsKeepMerchants(
      `تم تصفير جميع حركات مزرعة (${appState.farmName || 'أبوذكري'}) نهائياً مع الحفاظ على الكود الموحد وأسماء التجار الأساسيين`,
      '🗑️'
    );
  });

  // Import Excel (.xlsx) or JSON file (Full Two-Way Parser)
  document.getElementById('fileImportXlsx').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data = new Uint8Array(evt.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        importWorkbookIntoAppState(workbook, file.name);
      } catch (err) {
        showToast('تعذر قراءة الملف، تأكد من اختيار ملف إكسيل صحيح (.xlsx)', '⚠️');
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
