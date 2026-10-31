// =========================================================================
// MODULE 1: CORE STATE, TIME CALIBRATION, UUID & ENCRYPTED VAULT (js/core-state.js — v85)
// =========================================================================

// =========================================================================
// 1. INITIAL GROUNDED DATA & STATE (WITH DYNAMIC FARM NAME & FULL SYNC)
// =========================================================================
const STORAGE_KEY = 'farm_sales_committee_v70_clean_slate_state';
const LEGACY_STORAGE_KEYS = ['farm_sales_committee_v68_clean_slate_state', 'farm_sales_committee_v67_clean_slate_state'];
const ENCRYPTED_VAULT_STORAGE_KEY = 'farm_sales_encrypted_webhook_vault_v70';
const GATEWAY_HANDSHAKE_VAULT_KEY = '__gateway_auth_handshake_v70__';
const EMBEDDED_CLOUD_WEBHOOK_URL = '';
const EMBEDDED_DEFAULT_FARM_NAME = '';
let isInitialCloudPullPending = false;

// =========================================================================
// ENCRYPTED LOGIN-BOUND CLOUD WEBHOOK VAULT ENGINE (v70)
// يشفر رابط السحابة بكلمة مرور الدخول داخل index.html بحيث يفك التشفير تلقائياً فور تسجيل الدخول حتى بعد مسح بيانات المتصفح
// =========================================================================
function fnv32MixHash(str, seed = 0x811c9dc5) {
  let h = seed >>> 0;
  const s = String(str || '');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
    h ^= (h >>> 13);
  }
  return h >>> 0;
}

function deriveVaultKeyBytes(passphrase, saltHex, length) {
  const out = new Uint8Array(length);
  const passStr = String(passphrase || '');
  const saltStr = String(saltHex || '');
  let stateA = fnv32MixHash(`${saltStr}|A|${passStr}`, 0x811c9dc5);
  let stateB = fnv32MixHash(`${passStr}|B|${saltStr}`, 0x9e3779b9);
  for (let i = 0; i < length; i++) {
    stateA = fnv32MixHash(`${stateB}:${i}:${passStr}`, stateA);
    stateB = fnv32MixHash(`${stateA}:${i}:${saltStr}`, stateB);
    out[i] = ((stateA ^ (stateB >>> 8) ^ (stateA >>> 16)) & 0xff);
  }
  return out;
}

function computeVaultMacHex(plainUrl, passphrase, saltHex) {
  const payload = `${saltHex}|${plainUrl}|${passphrase}|v70_mac`;
  const h1 = fnv32MixHash(payload, 0x811c9dc5).toString(16).padStart(8, '0');
  const h2 = fnv32MixHash(`${h1}|${payload}`, 0x85ebca6b).toString(16).padStart(8, '0');
  return `${h1}${h2}`;
}

function encryptWebhookWithPassphrase(plainUrl, passphrase, customSaltHex = '') {
  const cleanUrl = String(plainUrl || '').trim();
  const cleanPass = String(passphrase || '').trim();
  if (!cleanUrl || !cleanPass) return '';
  let saltHex = customSaltHex;
  if (!saltHex) {
    const seedNum = fnv32MixHash(`${cleanUrl}|${cleanPass}|v70_salt`, 0xc2b2ae35);
    const seedNum2 = fnv32MixHash(`${cleanPass}|${cleanUrl}|v70_salt2`, 0x27d4eb2f);
    saltHex = seedNum.toString(16).padStart(8, '0') + seedNum2.toString(16).padStart(8, '0');
  }
  const utf8Bytes = new TextEncoder().encode(cleanUrl);
  const keyBytes = deriveVaultKeyBytes(cleanPass, saltHex, utf8Bytes.length);
  const cipherBytes = new Uint8Array(utf8Bytes.length);
  let binStr = '';
  for (let i = 0; i < utf8Bytes.length; i++) {
    cipherBytes[i] = utf8Bytes[i] ^ keyBytes[i];
    binStr += String.fromCharCode(cipherBytes[i]);
  }
  const b64Cipher = btoa(binStr);
  const macHex = computeVaultMacHex(cleanUrl, cleanPass, saltHex);
  return `v70_vault:${saltHex}:${macHex}:${b64Cipher}`;
}

function decryptWebhookWithPassphrase(tokenStr, passphrase) {
  const rawToken = String(tokenStr || '').trim();
  const cleanPass = String(passphrase || '').trim();
  if (!rawToken.startsWith('v70_vault:') || !cleanPass) return '';
  const parts = rawToken.split(':');
  if (parts.length < 4) return '';
  const saltHex = parts[1];
  const expectedMac = parts[2];
  const b64Cipher = parts.slice(3).join(':');
  try {
    const binStr = atob(b64Cipher);
    const cipherBytes = new Uint8Array(binStr.length);
    for (let i = 0; i < binStr.length; i++) {
      cipherBytes[i] = binStr.charCodeAt(i);
    }
    const keyBytes = deriveVaultKeyBytes(cleanPass, saltHex, cipherBytes.length);
    const plainBytes = new Uint8Array(cipherBytes.length);
    for (let i = 0; i < cipherBytes.length; i++) {
      plainBytes[i] = cipherBytes[i] ^ keyBytes[i];
    }
    const candidateUrl = new TextDecoder('utf-8').decode(plainBytes).trim();
    const actualMac = computeVaultMacHex(candidateUrl, cleanPass, saltHex);
    if (actualMac === expectedMac && candidateUrl.startsWith('http')) {
      return candidateUrl;
    }
  } catch (e) {}
  return '';
}

function buildEncryptedWebhookVaultForUsers(plainUrl, usersList) {
  const cleanUrl = String(plainUrl || '').trim();
  if (!cleanUrl || !cleanUrl.startsWith('http')) return [];
  const safeUsers = Array.isArray(usersList) && usersList.length > 0
    ? usersList
    : [{ id: 'admin', username: 'admin', password: 'admin', name: 'مدير الموقع' }];
  const passphrases = new Set();
  safeUsers.forEach(u => {
    if (!u || u.id === 'visitor') return;
    const uLogin = String(u.username || u.id || '').trim().toLowerCase();
    const uFull = String(u.name || '').trim().toLowerCase();
    const uPass = String(u.password || (u.id === 'admin' ? 'admin' : '1234')).trim();
    if (uPass) {
      passphrases.add(`p:${uPass}`);
      if (uLogin) passphrases.add(`u:${uLogin}|p:${uPass}`);
      if (uFull) passphrases.add(`u:${uFull}|p:${uPass}`);
      if (u.id === 'admin') passphrases.add(`u:admin|p:${uPass}`);
    }
  });
  passphrases.add(`u:admin|p:admin`);
  passphrases.add(`p:admin`);
  passphrases.add(GATEWAY_HANDSHAKE_VAULT_KEY);

  const tokens = [];
  passphrases.forEach(pk => {
    const tok = encryptWebhookWithPassphrase(cleanUrl, pk);
    if (tok && !tokens.includes(tok)) tokens.push(tok);
  });
  return tokens;
}

function getEmbeddedEncryptedVaultList() {
  const combined = [];
  const addTokens = (arr) => {
    if (!Array.isArray(arr)) return;
    arr.forEach(t => {
      const s = String(t || '').trim();
      if (s.startsWith('v70_vault:') && !combined.includes(s)) combined.push(s);
    });
  };
  try {
    if (typeof window !== 'undefined' && Array.isArray(window.EMBEDDED_ENCRYPTED_WEBHOOK_VAULT)) {
      addTokens(window.EMBEDDED_ENCRYPTED_WEBHOOK_VAULT);
    }
    if (typeof document !== 'undefined') {
      const metaVault = document.getElementById('metaEmbeddedEncryptedWebhookVault');
      if (metaVault) {
        const rawContent = String(metaVault.getAttribute('content') || '').trim();
        if (rawContent) {
          if (rawContent.startsWith('[')) {
            addTokens(JSON.parse(rawContent));
          } else {
            addTokens(rawContent.split('|'));
          }
        }
      }
    }
    const savedLocal = localStorage.getItem(ENCRYPTED_VAULT_STORAGE_KEY);
    if (savedLocal) {
      addTokens(JSON.parse(savedLocal));
    }
  } catch (e) {}
  return combined;
}

function hasEncryptedWebhookVaultAvailable() {
  return getEmbeddedEncryptedVaultList().length > 0;
}

function unlockWebhookVaultWithCredentials(usernameInput, passwordInput, allowGatewayHandshake = false) {
  const vaultTokens = getEmbeddedEncryptedVaultList();
  if (vaultTokens.length === 0) return { url: '', matchedByDirectPassword: false };
  const uClean = String(usernameInput || '').trim().toLowerCase();
  const pClean = String(passwordInput || '').trim();
  const candidateKeys = [];
  if (uClean && pClean) candidateKeys.push(`u:${uClean}|p:${pClean}`);
  if (pClean) candidateKeys.push(`p:${pClean}`);

  for (const key of candidateKeys) {
    for (const tok of vaultTokens) {
      const dec = decryptWebhookWithPassphrase(tok, key);
      if (dec && dec.startsWith('http')) {
        return { url: dec, matchedByDirectPassword: true };
      }
    }
  }

  if (allowGatewayHandshake && uClean && pClean) {
    for (const tok of vaultTokens) {
      const dec = decryptWebhookWithPassphrase(tok, GATEWAY_HANDSHAKE_VAULT_KEY);
      if (dec && dec.startsWith('http')) {
        return { url: dec, matchedByDirectPassword: false };
      }
    }
  }
  return { url: '', matchedByDirectPassword: false };
}

function updateEncryptedWebhookVaultUI() {
  const currentUrl = String((appState && appState.webhookUrl) || getEmbeddedWebhookUrl() || '').trim();
  if (currentUrl && currentUrl.startsWith('http')) {
    const vaultTokens = buildEncryptedWebhookVaultForUsers(currentUrl, appState ? appState.users : []);
    try {
      window.EMBEDDED_ENCRYPTED_WEBHOOK_VAULT = vaultTokens;
      const metaVault = document.getElementById('metaEmbeddedEncryptedWebhookVault');
      if (metaVault) metaVault.setAttribute('content', vaultTokens.join('|'));
      localStorage.setItem(ENCRYPTED_VAULT_STORAGE_KEY, JSON.stringify(vaultTokens));
    } catch (e) {}
  }

  const vaultList = getEmbeddedEncryptedVaultList();
  const hasVault = vaultList.length > 0 || Boolean(currentUrl);

  const loginBadge = document.getElementById('loginEncryptedVaultBadge');
  const lblToggleLogin = document.getElementById('lblToggleLoginCloudBox');
  if (loginBadge) {
    loginBadge.classList.toggle('hidden', !hasVault);
  }
  if (lblToggleLogin) {
    lblToggleLogin.textContent = hasVault
      ? 'تغيير رابط السحابة المشفر (مربوط حالياً بتسجيل الدخول ✓)'
      : 'دخول من جهاز جديد؟ ربط وتشفير رابط السحابة (اختياري)';
  }

  const syncBadge = document.getElementById('webhookEncryptionStatusBadge');
  if (syncBadge) {
    if (currentUrl || vaultList.length > 0) {
      const usersCnt = Array.isArray(appState && appState.users) ? appState.users.length : 1;
      syncBadge.textContent = `🔐 مشفر ومربوط بكلمة مرور الدخول (${usersCnt} حساب مستخدم) ✓`;
      syncBadge.className = 'px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-950 text-[11px] font-extrabold border border-emerald-400 shadow-sm';
    } else {
      syncBadge.textContent = '🔓 غير مشفر بعد — الصق الرابط واضغط حفظ وتشفير';
      syncBadge.className = 'px-2.5 py-1 rounded-full bg-slate-200 text-slate-800 text-[11px] font-extrabold border border-slate-300';
    }
  }
}


function splitFirebaseUrlAndSecret(rawFullUrl) {
  const clean = String(rawFullUrl || '').trim();
  if (!clean) return { firebaseUrl: '', firebaseSecret: '' };
  try {
    const u = new URL(clean);
    const secret = u.searchParams.get('auth') || '';
    u.searchParams.delete('auth');
    u.searchParams.delete('_t');
    let cleanPath = (u.pathname || '/').replace(/\/abouzekry_cloud_db(?:\.json)?$/i, '');
    if (!cleanPath || cleanPath === '/') cleanPath = '';
    const baseFbUrl = `${u.origin}${cleanPath}`;
    return { firebaseUrl: baseFbUrl, firebaseSecret: secret };
  } catch (e) {
    const qIdx = clean.indexOf('?');
    if (qIdx === -1) return { firebaseUrl: clean, firebaseSecret: '' };
    const basePart = clean.slice(0, qIdx).replace(/\/abouzekry_cloud_db(?:\.json)?$/i, '');
    const params = new URLSearchParams(clean.slice(qIdx + 1));
    return { firebaseUrl: basePart, firebaseSecret: params.get('auth') || '' };
  }
}

function composeFirebaseWebhookUrl(fbUrlInput, fbSecretInput) {
  const cleanUrl = String(fbUrlInput || '').trim();
  const cleanSecret = String(fbSecretInput || '').trim();
  if (!cleanUrl) return '';
  try {
    const u = new URL(cleanUrl);
    if (cleanSecret) {
      u.searchParams.set('auth', cleanSecret);
    }
    return u.toString();
  } catch (e) {
    if (cleanSecret && !cleanUrl.includes('auth=')) {
      const sep = cleanUrl.includes('?') ? '&' : '?';
      return `${cleanUrl}${sep}auth=${encodeURIComponent(cleanSecret)}`;
    }
    return cleanUrl;
  }
}

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

function getEmbeddedDefaultFarmName() {
  try {
    if (typeof window !== 'undefined' && window.EMBEDDED_DEFAULT_FARM_NAME && String(window.EMBEDDED_DEFAULT_FARM_NAME).trim()) {
      return String(window.EMBEDDED_DEFAULT_FARM_NAME).trim();
    }
    if (typeof document !== 'undefined') {
      const metaFarmEl = document.getElementById('metaEmbeddedDefaultFarmName');
      if (metaFarmEl) {
        const content = String(metaFarmEl.getAttribute('content') || '').trim();
        if (content) return content;
      }
    }
  } catch (e) {}
  return String(EMBEDDED_DEFAULT_FARM_NAME || '').trim();
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

function hasMeaningfulLocalData() {
  if (!appState) return false;
  const hasFarm = Boolean(String(appState.farmName ?? '').trim()) || Object.keys(appState.farmsArchive || {}).length > 0 || Number(appState.lastFarmSwitchAt) > 0;
  const hasMerchants = Array.isArray(appState.merchants) && appState.merchants.length > 0;
  const hasMovements = countMovementsInDays(appState.days) > 0;
  const hasExtraUsers = Array.isArray(appState.users) && appState.users.length > 1;
  const hasResets = Number(appState.farmResetAt) > 0 || Number(appState.factoryZeroWipeAt) > 0;
  return Boolean(appState.hasLocalEdits && (hasFarm || hasMerchants || hasMovements || hasExtraUsers || hasResets || Number(appState.pendingChanges) > 0));
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

function createEmptyDayObject(d) {
  const dayNum = Number(d) || 1;
  return {
    dayNumber: dayNum,
    dateLabel: `اليوم ${dayNum}`,
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

function ensureDaysSchemaIntact(daysObj) {
  const target = (daysObj && typeof daysObj === 'object') ? daysObj : {};
  for (let d = 1; d <= 10; d++) {
    if (!target[d] || typeof target[d] !== 'object') {
      target[d] = createEmptyDayObject(d);
    } else {
      if (!Array.isArray(target[d].sales)) target[d].sales = [];
      if (!Array.isArray(target[d].pendingSales)) target[d].pendingSales = [];
      if (!Array.isArray(target[d].expenses)) target[d].expenses = [];
      if (target[d].deliveredCash === undefined) target[d].deliveredCash = 0;
      if (target[d].carriedForwardCash === undefined) target[d].carriedForwardCash = 0;
      if (!target[d].dateLabel) target[d].dateLabel = `اليوم ${d}`;
      target[d].dayNumber = d;
    }
  }
  return target;
}

function getDefaultState(customFarmName = '') {
  // نسخة بيضاء / صفرية (Clean Slate Version): مصفوفة التجار وسجل الأيام وأرشيف المزارع فارغة تماماً مع دعم اسم المزرعة المدمج إن وُجد
  const initialFarm = String(customFarmName || getEmbeddedDefaultFarmName() || '').trim();
  const merchants = [];
  const days = ensureDaysSchemaIntact({});
  const farmsArchive = {};
  if (initialFarm) {
    farmsArchive[initialFarm] = {
      farmName: initialFarm,
      updatedAt: new Date().toISOString(),
      farmResetAt: 0,
      lastBulkImportAt: 0,
      visibleDays: [1],
      defaultPrice: 0,
      defaultTip: 0,
      lastScaleNo: 0,
      merchants: [],
      days: JSON.parse(JSON.stringify(days))
    };
  }

  return {
    farmName: initialFarm,
    lastExcelSync: '',
    currentDay: 1,
    visibleDays: [1],
    activeTab: 'daily',
    activeSyncSubTab: 'farms_excel',
    activeTransfersSubTab: 'transfers',
    merchantsViewFilter: 'all',
    transfersViewFilter: 'all',
    prevFarmsViewFilter: 'all',
    expensesViewFilter: 'all',
    pendingChanges: 0,
    hasLocalEdits: false,
    liveSyncEnabled: true,
    liveSyncIntervalSec: 5,
    syncOutbox: [],
    lastDeltaSyncAt: 0,
    deletedIds: { sales: [], pendingSales: [], expenses: [], merchants: [], users: [], farms: [] },
    deletedTimestamps: { sales: {}, pendingSales: {}, expenses: {}, merchants: {}, users: {}, farms: {} },
    webhookUrl: getEmbeddedWebhookUrl() || '',
    firebaseUrl: '',
    firebaseSecret: '',
    updatedAt: '',
    farmResetAt: 0,
    factoryZeroWipeAt: 0,
    lastBulkImportAt: 0,
    defaultPrice: 0,
    defaultTip: 0,
    lastScaleNo: 0,
    lastVoucherNo: 0,
    inactivityTimeoutMin: 20,
    showFloatingActionBar: true,
    showAuditMetadata: true,
    liteFieldMode: false,
    autoLiteFieldOnMobile: true,
    stickyLiteBanner: true,
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
    days: ensureDaysSchemaIntact(days),
    farmsArchive: farmsArchive
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

// معايرة فرق التوقيت مع السحابة بأمان (Safe Monotonic Clock Skew Calibration):
// نظراً لأن cloudUpdatedAtIso يمثل وقت آخر حفظ بالسحابة (وليس ساعة حية للسيرفر)، لا يجوز أبداً إرجاع ساعة الجهاز للماضي عندما يكون آخر حفظ قديماً (diff < 0)،
// بل نعاير للأمام فقط إذا كان ختم السحابة متقدماً على ساعة الجهاز المحلي (تأخر ساعة هاتف المندوب) وبحد أقصى هامش CLOCK_SKEW_BUFFER_MS (60 دقيقة) لمنع أي جهاز ساعته مختلة بساعات من تلويث التوقيت.
function calibrateCloudClockOffset(cloudUpdatedAtIso) {
  if (!cloudUpdatedAtIso) return;
  try {
    const cloudMs = typeof cloudUpdatedAtIso === 'number' ? cloudUpdatedAtIso : Date.parse(String(cloudUpdatedAtIso));
    if (!isNaN(cloudMs) && cloudMs > 0) {
      const localMs = Date.now();
      const diff = cloudMs - localMs;
      if (diff > 5000 && diff <= CLOCK_SKEW_BUFFER_MS) {
        cloudClockOffsetMs = Math.max(Number(cloudClockOffsetMs) || 0, diff);
      } else if (diff <= 5000 && cloudClockOffsetMs < 0) {
        cloudClockOffsetMs = 0;
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

function isRecordDebtOnlyVoucher(row) {
  if (!row || typeof row !== 'object') return false;
  if (row.isPending) return false;
  if (row.entryMode === 'debt_only' || row.isDebtCollectionOnly) return true;
  const w1 = Math.max(0, Number(row.w1) || 0);
  const w2 = Math.max(0, Number(row.w2) || 0);
  const price = Number(row.price) || 0;
  const tip = Number(row.tip) || 0;
  const netWeight = (w2 >= w1 && w2 > 0) ? (w2 - w1) : 0;
  const totalWithTip = (netWeight * price) + tip;
  const cashSales = Number(row.cashSales) || 0;
  const transferSales = Number(row.transferSales) || 0;
  const creditSales = Number(row.creditSales) || 0;
  const debtCash = Number(row.debtCash) || 0;
  const debtTransfer = Number(row.debtTransfer) || 0;
  const prevCash = Number(row.prevCash) || 0;
  const prevTransfer = Number(row.prevTransfer) || 0;
  return Boolean(
    w1 === 0 &&
    w2 === 0 &&
    totalWithTip === 0 &&
    cashSales === 0 &&
    transferSales === 0 &&
    creditSales === 0 &&
    (debtCash > 0 || debtTransfer > 0 || prevCash > 0 || prevTransfer > 0)
  );
}

function sortSalesListByScaleNo(list) {
  if (!Array.isArray(list)) return [];
  return [...list].sort((a, b) => {
    const aDebtOnly = isRecordDebtOnlyVoucher(a);
    const bDebtOnly = isRecordDebtOnlyVoucher(b);
    // وضع حركات (سند تحصيل مديونية فقط - بدون ميزان) دائماً في آخر الجدول بعد حركات الميزان
    if (aDebtOnly !== bDebtOnly) {
      return aDebtOnly ? 1 : -1;
    }
    const sa = Number(a && (aDebtOnly ? (a.voucherNo || a.scaleNo) : a.scaleNo)) || 0;
    const sb = Number(b && (bDebtOnly ? (b.voucherNo || b.scaleNo) : b.scaleNo)) || 0;
    if (sa > 0 && sb > 0 && sa !== sb) return sa - sb;
    return 0;
  });
}

function isSameNumVal(x, y, eps = 0.05) {
  return Math.abs((Number(x) || 0) - (Number(y) || 0)) <= eps;
}

function toAsciiDigits(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
}

function extractMerchantSubCarNumber(rawName) {
  if (!rawName) return '';
  const ascii = toAsciiDigits(rawName);
  return (ascii.match(/\d+/) || [''])[0];
}

function isSameMerchantIdentity(maRaw, mbRaw) {
  const ma = String(maRaw || '').replace(/\s+/g, ' ').trim();
  const mb = String(mbRaw || '').replace(/\s+/g, ' ').trim();
  if (!ma || !mb) return false;
  if (ma === mb) return true;
  // إذا كان كلاهما يشير لنفس التاجر الأساسي ونفس رقم السيارة الفرعية (حتى لو كُتب بأرقام هندية مثل "كرنك ١" و"كرنك 1" أو "مزرعه" و"المزرعه")
  const subA = extractMerchantSubCarNumber(ma);
  const subB = extractMerchantSubCarNumber(mb);
  if (subA === subB && normalizeArabicMerchantCompareKey(ma) === normalizeArabicMerchantCompareKey(mb)) {
    return true;
  }
  return false;
}

function areSalesRowsDuplicate(a, b, ignoreDifferentUUIDs = false) {
  if (!a || !b) return false;
  const hasIdA = a.id !== undefined && a.id !== null && String(a.id).trim() !== '';
  const hasIdB = b.id !== undefined && b.id !== null && String(b.id).trim() !== '';
  if (hasIdA && hasIdB && String(a.id).trim() === String(b.id).trim()) {
    return true;
  }
  if (isRecordDebtOnlyVoucher(a) !== isRecordDebtOnlyVoucher(b)) return false;

  // فحص المفتاح المركب للإكسيل (excelCompositeKey) أولاً حتى لو اختلف الـ UUID بين جهازين استوردا نفس الشيت
  if (!a.isEdited && !b.isEdited && a.excelCompositeKey && b.excelCompositeKey && String(a.excelCompositeKey) === String(b.excelCompositeKey)) {
    return true;
  }

  // إذا كان كلا السجلين يحملان معرّفين مختلفين وليس أي منهما مستورداً من الإكسيل، نحترم اختلاف الـ UUID أثناء المزامنة العادية
  const involvesExcelImport = Boolean(
    ignoreDifferentUUIDs ||
    Number(a.importedAt) > 0 ||
    Number(b.importedAt) > 0 ||
    (a.excelCompositeKey && String(a.excelCompositeKey).trim() !== '') ||
    (b.excelCompositeKey && String(b.excelCompositeKey).trim() !== '')
  );
  if (hasIdA && hasIdB && !involvesExcelImport) {
    return false;
  }

  if (!isSameMerchantIdentity(a.merchant, b.merchant)) return false;

  const isDebtOnly = isRecordDebtOnlyVoucher(a);
  const sa = Number(isDebtOnly ? (a.voucherNo || a.scaleNo) : a.scaleNo) || 0;
  const sb = Number(isDebtOnly ? (b.voucherNo || b.scaleNo) : b.scaleNo) || 0;
  const ca = toAsciiDigits(a.carNo || '').trim();
  const cb = toAsciiDigits(b.carNo || '').trim();
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

  // 1. نفس التاجر ونفس رقم مسلسل الميزان (أو السند) مع تطابق الأوزان والمبالغ المالية (أو عند تحديث نفس رقم الميزان من الإكسيل)
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
  if (hasIdA && hasIdB && String(a.id).trim() === String(b.id).trim()) {
    return true;
  }
  if (!a.isEdited && !b.isEdited && a.excelCompositeKey && b.excelCompositeKey && String(a.excelCompositeKey) === String(b.excelCompositeKey)) {
    return true;
  }
  const involvesExcelImport = Boolean(
    ignoreDifferentUUIDs ||
    Number(a.importedAt) > 0 ||
    Number(b.importedAt) > 0 ||
    (a.excelCompositeKey && String(a.excelCompositeKey).trim() !== '') ||
    (b.excelCompositeKey && String(b.excelCompositeKey).trim() !== '')
  );
  if (hasIdA && hasIdB && !involvesExcelImport) {
    return false;
  }
  if (!isSameMerchantIdentity(a.merchant, b.merchant)) return false;
  const sa = Number(a.scaleNo) || 0;
  const sb = Number(b.scaleNo) || 0;
  const w1a = Number(a.w1) || 0, w1b = Number(b.w1) || 0;
  if (sa > 0 && sb > 0 && sa === sb && (ignoreDifferentUUIDs || isSameNumVal(w1a, w1b))) return true;
  const ca = toAsciiDigits(a.carNo || '').trim();
  const cb = toAsciiDigits(b.carNo || '').trim();
  return ca === cb && isSameNumVal(w1a, w1b);
}

function areExpensesDuplicate(a, b, ignoreDifferentUUIDs = false) {
  if (!a || !b) return false;
  const hasIdA = a.id !== undefined && a.id !== null && String(a.id).trim() !== '';
  const hasIdB = b.id !== undefined && b.id !== null && String(b.id).trim() !== '';
  if (hasIdA && hasIdB && String(a.id).trim() === String(b.id).trim()) {
    return true;
  }
  if (!a.isEdited && !b.isEdited && a.excelCompositeKey && b.excelCompositeKey && String(a.excelCompositeKey) === String(b.excelCompositeKey)) {
    return true;
  }
  const involvesExcelImport = Boolean(
    ignoreDifferentUUIDs ||
    Number(a.importedAt) > 0 ||
    Number(b.importedAt) > 0 ||
    (a.excelCompositeKey && String(a.excelCompositeKey).trim() !== '') ||
    (b.excelCompositeKey && String(b.excelCompositeKey).trim() !== '')
  );
  if (hasIdA && hasIdB && !involvesExcelImport) {
    return false;
  }
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
      !isRecordDebtOnlyVoucher(s) &&
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

function sanitizeAccidentalHardcodedPrice(stateObj) {
  if (!stateObj || typeof stateObj !== 'object') return;
  if (Math.abs((Number(stateObj.defaultPrice) || 0) - 78.02) < 0.001) {
    stateObj.defaultPrice = 0;
  }
  const cleanDaysPrice = (dMap) => {
    if (!dMap || typeof dMap !== 'object') return;
    for (let d = 1; d <= 10; d++) {
      const dayObj = dMap[d];
      if (!dayObj || !Array.isArray(dayObj.pendingSales)) continue;
      dayObj.pendingSales.forEach(p => {
        if (p && Math.abs((Number(p.price) || 0) - 78.02) < 0.001) {
          p.price = 0;
        }
      });
    }
  };
  cleanDaysPrice(stateObj.days);
  if (stateObj.farmsArchive && typeof stateObj.farmsArchive === 'object') {
    Object.values(stateObj.farmsArchive).forEach(fObj => {
      if (fObj && typeof fObj === 'object') {
        if (Math.abs((Number(fObj.defaultPrice) || 0) - 78.02) < 0.001) {
          fObj.defaultPrice = 0;
        }
        cleanDaysPrice(fObj.days);
      }
    });
  }
}

function deduplicateAllDaysInState(stateObj) {
  if (!stateObj || typeof stateObj !== 'object') return;
  sanitizeAccidentalHardcodedPrice(stateObj);
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
  if (!Array.isArray(appState.syncOutbox)) appState.syncOutbox = [];
  appState.lastDeltaSyncAt = Math.max(0, Number(appState.lastDeltaSyncAt) || 0);
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
    const savedStickyLite = localStorage.getItem('pref_sticky_lite_banner') ?? localStorage.getItem(STORAGE_KEY + '_sticky_lite_banner');
    if (savedStickyLite !== null && savedStickyLite !== undefined) {
      appState.stickyLiteBanner = (savedStickyLite === '1' || savedStickyLite === 'true');
    } else if (appState.stickyLiteBanner === undefined) {
      appState.stickyLiteBanner = true;
    } else {
      appState.stickyLiteBanner = Boolean(appState.stickyLiteBanner);
    }
  } catch (e) {
    appState.liteFieldMode = Boolean(appState.liteFieldMode);
    if (appState.autoLiteFieldOnMobile === undefined) appState.autoLiteFieldOnMobile = true;
    if (appState.stickyLiteBanner === undefined) appState.stickyLiteBanner = true;
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
  if (!Array.isArray(appState.merchants)) appState.merchants = [];
  appState.days = ensureDaysSchemaIntact(appState.days);
  if (!appState.farmsArchive || typeof appState.farmsArchive !== 'object') {
    appState.farmsArchive = {};
  }

  // 1. دمج أي تجار مكودين في أرشيف المزارع (farmsArchive) غير محذوفين
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

  // 4. استخراج وتكويد أي تاجر موجود في حركات البيع أو الوزنات المؤقتة في الأيام الحالية أو الأرشيف غير موجود في الدليل
  const scanDaysForMissingMerchants = (daysMap) => {
    if (!daysMap || typeof daysMap !== 'object') return;
    for (let d = 1; d <= 10; d++) {
      const dayObj = daysMap[d];
      if (!dayObj) continue;
      [...(dayObj.sales || []), ...(dayObj.pendingSales || [])].forEach(row => {
        if (!row || !row.merchant) return;
        const baseName = cleanMerchantBaseName(row.merchant) || String(row.merchant).trim();
        if (!baseName) return;
        const existingCode = resolveMerchantCode(baseName);
        if (existingCode <= 0) {
          const nextCode = appState.merchants.length > 0
            ? Math.max(100, ...appState.merchants.map(m => Number(m.code) || 100)) + 1
            : 101;
          unrecordDeletedItem('merchants', nextCode);
          delSet.delete(Number(nextCode));
          const safeTs = Math.max(getSyncedNow() + 1000, (Number(appState.factoryZeroWipeAt) || 0) + 1000);
          appState.merchants.push({ code: nextCode, name: baseName, updatedAt: safeTs });
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

  // أي تاجر أُضيف بطابع زمني أحدث من التصفير الجذري أو الحذف يُرفع من قائمة الحذف تلقائياً
  appState.merchants.forEach(m => {
    if (!m || !m.code) return;
    const cNum = Number(m.code);
    const mTs = Number(m.updatedAt) || 0;
    const delTs = Number(appState.deletedTimestamps && appState.deletedTimestamps.merchants && appState.deletedTimestamps.merchants[String(cNum)]) || 0;
    if (mTs > 0 && (mTs >= delTs || mTs > Number(appState.factoryZeroWipeAt || 0))) {
      unrecordDeletedItem('merchants', cNum);
      delSet.delete(cNum);
    }
  });

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
      excelCompositeKey: isEdit ? '' : String((existingRec && existingRec.excelCompositeKey) || '')
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
    excelCompositeKey: String((existingRec && existingRec.excelCompositeKey) || '')
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
    if (typeof enqueueDeltaSyncEvent === 'function') {
      enqueueDeltaSyncEvent('UPDATE_DAY_META', {
        farmName: appState.farmName,
        dayNum: d,
        isLocked: false,
        lockedBy: dayObj.lockedBy || '',
        lockedAtTxt: dayObj.lockedAtTxt || '',
        lockUpdatedAt: nowMs
      });
    }
    saveState(true, false);
    renderAll();
    showToast(`🔓 تم فك قفل (يوم ${d} — ${dayObj.dateLabel}) بواسطة (${actor}) وإعادة فتحه للتعديل!`, '🔓');
  } else {
    const pendCnt = Array.isArray(dayObj.pendingSales) ? dayObj.pendingSales.length : 0;
    dayObj.isLocked = true;
    dayObj.lockedBy = actor;
    dayObj.lockedAtTxt = nowTxt;
    dayObj.lockUpdatedAt = nowMs;
    if (typeof enqueueDeltaSyncEvent === 'function') {
      enqueueDeltaSyncEvent('UPDATE_DAY_META', {
        farmName: appState.farmName,
        dayNum: d,
        isLocked: true,
        lockedBy: actor,
        lockedAtTxt: nowTxt,
        lockUpdatedAt: nowMs
      });
    }
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

