// =========================================================================
// MODULE 3: LOCAL STORAGE, INDEXEDDB & CLOUD SYNC ENGINE (js/storage-sync.js — v83)
// =========================================================================

function loadState() {
  let loaded = false;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      loaded = applyParsedStateObject(JSON.parse(raw));
    }
  } catch (e) {}
  if (!loaded) {
    for (const legKey of LEGACY_STORAGE_KEYS) {
      try {
        const legRaw = localStorage.getItem(legKey);
        if (legRaw) {
          loaded = applyParsedStateObject(JSON.parse(legRaw));
          if (loaded) break;
        }
      } catch (e) {}
    }
  }
  if (!loaded) {
    try {
      const wnPrefix = 'FARM_SALES_CLEAN_STATE_V67:';
      if (window.name && window.name.startsWith(wnPrefix)) {
        loaded = applyParsedStateObject(JSON.parse(window.name.slice(wnPrefix.length)));
      }
    } catch (e) {}
  }
  // استرجاع رابط السحابة من الملف المدمج (index.html) أو من الكاش الحالي أو السابق
  const embeddedUrl = getEmbeddedWebhookUrl();
  if (embeddedUrl) {
    appState.webhookUrl = embeddedUrl;
  }
  try {
    const savedFbUrl = localStorage.getItem(STORAGE_KEY + '_firebase_url') || localStorage.getItem('firebase_url') || '';
    const savedFbSecret = localStorage.getItem(STORAGE_KEY + '_firebase_secret') || localStorage.getItem('firebase_secret') || '';
    if (savedFbUrl && savedFbUrl.trim()) {
      appState.firebaseUrl = savedFbUrl.trim();
    }
    if (savedFbSecret && savedFbSecret.trim()) {
      appState.firebaseSecret = savedFbSecret.trim();
    }
    if (!appState.webhookUrl && appState.firebaseUrl) {
      appState.webhookUrl = composeFirebaseWebhookUrl(appState.firebaseUrl, appState.firebaseSecret);
    }
  } catch (e) {}
  if (!appState.webhookUrl) {
    try {
      const savedUrl = localStorage.getItem(STORAGE_KEY + '_webhook_url');
      if (savedUrl && savedUrl.trim()) appState.webhookUrl = savedUrl.trim();
    } catch (e) {}
  }
  if (appState.webhookUrl) {
    const parts = splitFirebaseUrlAndSecret(appState.webhookUrl);
    if (parts.firebaseUrl && !appState.firebaseUrl) appState.firebaseUrl = parts.firebaseUrl;
    if (parts.firebaseSecret && !appState.firebaseSecret) appState.firebaseSecret = parts.firebaseSecret;
    if (appState.firebaseUrl && appState.firebaseSecret && !appState.webhookUrl.includes('auth=')) {
      appState.webhookUrl = composeFirebaseWebhookUrl(appState.firebaseUrl, appState.firebaseSecret);
    }
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
    const savedStickyLite = localStorage.getItem('pref_sticky_lite_banner') ?? localStorage.getItem(STORAGE_KEY + '_sticky_lite_banner');
    if (savedStickyLite !== null && savedStickyLite !== undefined) {
      appState.stickyLiteBanner = (savedStickyLite === '1' || savedStickyLite === 'true');
    }
  } catch (e) {}
  return loaded;
}

// =========================================================================
// CLOUD DATABASE ENGINE (IndexedDB + Multi-Farm Archive + Cloud REST Sync)
// =========================================================================
const IDB_NAME = 'FarmSalesCleanSlateDB_v67';
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
  if (!rawName) {
    return;
  }
  const fName = rawName;
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

function getDeltaEventTargetKey(actionType, payload) {
  if (!payload || typeof payload !== 'object') return '';
  const fName = String(payload.farmName || (appState && appState.farmName) || '').trim();
  const dNum = Number(payload.dayNum) || 0;
  if (actionType === 'UPSERT_SALE' || actionType === 'DELETE_SALE') {
    const id = payload.record ? payload.record.id : payload.id;
    return `sale:${fName}:${dNum}:${String(id || '')}`;
  }
  if (actionType === 'UPSERT_PENDING' || actionType === 'DELETE_PENDING') {
    const id = payload.record ? payload.record.id : payload.id;
    return `pending:${fName}:${dNum}:${String(id || '')}`;
  }
  if (actionType === 'UPSERT_EXPENSE' || actionType === 'DELETE_EXPENSE') {
    const id = payload.record ? payload.record.id : payload.id;
    return `expense:${fName}:${dNum}:${String(id || '')}`;
  }
  if (actionType === 'UPDATE_DAY_META') {
    return `daymeta:${fName}:${dNum}`;
  }
  if (actionType === 'UPSERT_MERCHANT' || actionType === 'DELETE_MERCHANT') {
    const code = payload.merchant ? payload.merchant.code : payload.code;
    return `merchant:${Number(code) || 0}`;
  }
  if (actionType === 'UPSERT_USER' || actionType === 'DELETE_USER') {
    const uid = payload.user ? payload.user.id : payload.id;
    return `user:${String(uid || '')}`;
  }
  if (actionType === 'DELETE_FARM') {
    return `farm:${String(payload.farmName || '')}`;
  }
  return '';
}

function enqueueDeltaSyncEvent(actionType, payload = {}) {
  window.enqueueDeltaSyncEvent = enqueueDeltaSyncEvent;
  if (!appState) return;
  if (!Array.isArray(appState.syncOutbox)) appState.syncOutbox = [];
  const nowTs = getSyncedNow();
  const enrichedPayload = {
    ...JSON.parse(JSON.stringify(payload || {})),
    farmName: String((payload && payload.farmName) || appState.farmName || '').trim()
  };
  const targetKey = getDeltaEventTargetKey(actionType, enrichedPayload);
  const eventObj = {
    id: generateRecordUUID('dlta'),
    action: String(actionType || '').trim(),
    targetKey,
    payload: enrichedPayload,
    ts: nowTs
  };

  if (targetKey) {
    appState.syncOutbox = appState.syncOutbox.filter(ev => ev && ev.targetKey !== targetKey);
  }
  appState.syncOutbox.push(eventObj);
  if (appState.syncOutbox.length > 500) {
    appState.syncOutbox = appState.syncOutbox.slice(-500);
  }
}

function applyIncomingDeltaEvents(eventsList) {
  if (!Array.isArray(eventsList) || eventsList.length === 0) return false;
  let changed = false;
  appState.deletedIds = ensureDeletedIdsStructure(appState.deletedIds);
  appState.deletedTimestamps = ensureDeletedTimestampsStructure(appState.deletedTimestamps);

  const sortedEvents = [...eventsList].sort((a, b) => (Number(a && a.ts) || 0) - (Number(b && b.ts) || 0));

  sortedEvents.forEach(ev => {
    if (!ev || !ev.action) return;
    const evTs = Number(ev.ts) || getSyncedNow();
    if (evTs > 0) calibrateCloudClockOffset(evTs);
    const p = ev.payload || {};
    const targetFarm = String(p.farmName || appState.farmName || '').trim();
    const isCurrentFarm = (!targetFarm || targetFarm === String(appState.farmName || '').trim());
    const getTargetDaysMap = () => {
      if (isCurrentFarm) return appState.days;
      if (targetFarm && appState.farmsArchive && appState.farmsArchive[targetFarm]) {
        if (!appState.farmsArchive[targetFarm].days) {
          appState.farmsArchive[targetFarm].days = ensureDaysSchemaIntact({});
        }
        return appState.farmsArchive[targetFarm].days;
      }
      return null;
    };

    const dNum = Number(p.dayNum) || 1;
    const daysMap = getTargetDaysMap();

    switch (ev.action) {
      case 'UPSERT_SALE':
      case 'UPSERT_PENDING':
      case 'UPSERT_EXPENSE': {
        const cat = ev.action === 'UPSERT_SALE' ? 'sales' : (ev.action === 'UPSERT_PENDING' ? 'pendingSales' : 'expenses');
        const dupFn = ev.action === 'UPSERT_SALE' ? areSalesRowsDuplicate : (ev.action === 'UPSERT_PENDING' ? arePendingSalesDuplicate : areExpensesDuplicate);
        const rec = p.record;
        if (!rec || !rec.id || !daysMap || !daysMap[dNum]) break;
        const idStr = String(rec.id);
        const delTs = Number(appState.deletedTimestamps[cat] && appState.deletedTimestamps[cat][idStr]) || 0;
        const recTs = Math.max(extractTimestampFromRecord(rec), evTs);
        if (delTs > recTs) break;
        unrecordDeletedItem(cat, idStr);
        daysMap[dNum][cat] = mergeArraysById(daysMap[dNum][cat] || [], [rec], appState.deletedIds[cat], 'id', true, dupFn);
        if (cat !== 'expenses') {
          daysMap[dNum][cat] = sortSalesListByScaleNo(daysMap[dNum][cat]);
        }
        if (ev.action === 'UPSERT_SALE' && Array.isArray(daysMap[dNum].pendingSales)) {
          daysMap[dNum].pendingSales = daysMap[dNum].pendingSales.filter(x => x && String(x.id) !== idStr);
        }
        daysMap[dNum].isHidden = false;
        daysMap[dNum].addedAt = Math.max(Number(daysMap[dNum].addedAt) || 0, recTs);
        if (isCurrentFarm && Array.isArray(appState.visibleDays) && !appState.visibleDays.includes(dNum)) {
          appState.visibleDays.push(dNum);
          appState.visibleDays.sort((a, b) => a - b);
        }
        changed = true;
        break;
      }
      case 'DELETE_SALE':
      case 'DELETE_PENDING':
      case 'DELETE_EXPENSE': {
        const cat = ev.action === 'DELETE_SALE' ? 'sales' : (ev.action === 'DELETE_PENDING' ? 'pendingSales' : 'expenses');
        const idStr = String(p.id || '');
        if (!idStr) break;
        recordDeletedItem(cat, idStr, evTs, false);
        const removeFromDays = (dMap) => {
          if (!dMap) return;
          for (let d = 1; d <= 10; d++) {
            if (dMap[d] && Array.isArray(dMap[d][cat])) {
              dMap[d][cat] = dMap[d][cat].filter(x => x && String(x.id) !== idStr);
            }
          }
        };
        removeFromDays(appState.days);
        if (appState.farmsArchive && typeof appState.farmsArchive === 'object') {
          Object.values(appState.farmsArchive).forEach(arch => { if (arch && arch.days) removeFromDays(arch.days); });
        }
        changed = true;
        break;
      }
      case 'UPDATE_DAY_META': {
        if (!daysMap || !daysMap[dNum]) break;
        const dayObj = daysMap[dNum];
        if (p.dateLabel !== undefined && (Number(p.labelUpdatedAt) || evTs) >= (Number(dayObj.labelUpdatedAt) || 0)) {
          dayObj.dateLabel = p.dateLabel;
          dayObj.labelUpdatedAt = Math.max(Number(p.labelUpdatedAt) || 0, evTs);
        }
        if (p.deliveredCash !== undefined && (Number(p.deliveredCashUpdatedAt) || evTs) >= (Number(dayObj.deliveredCashUpdatedAt) || 0)) {
          dayObj.deliveredCash = Number(p.deliveredCash) || 0;
          dayObj.deliveredCashUpdatedAt = Math.max(Number(p.deliveredCashUpdatedAt) || 0, evTs);
        }
        if (p.carriedForwardCash !== undefined && (Number(p.carriedForwardCashUpdatedAt) || evTs) >= (Number(dayObj.carriedForwardCashUpdatedAt) || 0)) {
          dayObj.carriedForwardCash = Number(p.carriedForwardCash) || 0;
          dayObj.carriedForwardCashUpdatedAt = Math.max(Number(p.carriedForwardCashUpdatedAt) || 0, evTs);
        }
        if (p.isLocked !== undefined && (Number(p.lockUpdatedAt) || evTs) >= (Number(dayObj.lockUpdatedAt) || 0)) {
          dayObj.isLocked = Boolean(p.isLocked);
          dayObj.lockedBy = String(p.lockedBy || '');
          dayObj.lockedAtTxt = String(p.lockedAtTxt || '');
          dayObj.lockUpdatedAt = Math.max(Number(p.lockUpdatedAt) || 0, evTs);
        }
        changed = true;
        break;
      }
      case 'UPSERT_MERCHANT': {
        const m = p.merchant;
        if (!m || !m.code) break;
        const codeNum = Number(m.code);
        const delTs = Number(appState.deletedTimestamps.merchants && appState.deletedTimestamps.merchants[String(codeNum)]) || 0;
        const mTs = Math.max(Number(m.updatedAt) || 0, evTs);
        if (delTs > mTs) break;
        const existingMerch = (appState.merchants || []).find(x => x && Number(x.code) === codeNum);
        const oldBaseName = existingMerch ? String(existingMerch.name || '').trim() : String(p.oldName || '').trim();
        const newBaseName = String(m.name || '').trim();
        unrecordDeletedItem('merchants', codeNum);
        appState.merchants = mergeArraysById(appState.merchants || [], [{ code: codeNum, name: newBaseName, updatedAt: mTs }], appState.deletedIds.merchants, 'code', true)
          .sort((a, b) => Number(a.code) - Number(b.code));
        if (oldBaseName && newBaseName && oldBaseName !== newBaseName) {
          const renameInDays = (dMap) => {
            if (!dMap || typeof dMap !== 'object') return;
            for (let d = 1; d <= 10; d++) {
              if (!dMap[d]) continue;
              (dMap[d].sales || []).forEach(r => { if (r && r.merchant === oldBaseName) r.merchant = newBaseName; });
              (dMap[d].pendingSales || []).forEach(pr => { if (pr && pr.merchant === oldBaseName) pr.merchant = newBaseName; });
            }
          };
          renameInDays(appState.days);
          if (appState.farmsArchive && typeof appState.farmsArchive === 'object') {
            Object.values(appState.farmsArchive).forEach(fObj => { if (fObj && fObj.days) renameInDays(fObj.days); });
          }
        }
        changed = true;
        break;
      }
      case 'DELETE_MERCHANT': {
        const codeNum = Number(p.code);
        if (!codeNum) break;
        recordDeletedItem('merchants', codeNum, evTs, false);
        appState.merchants = (appState.merchants || []).filter(m => m && Number(m.code) !== codeNum);
        changed = true;
        break;
      }
      case 'UPSERT_USER': {
        const u = p.user;
        if (!u || !u.id || u.id === 'visitor') break;
        unrecordDeletedItem('users', String(u.id));
        appState.users = mergeArraysById(appState.users || [], [u], appState.deletedIds.users, 'id', true);
        changed = true;
        break;
      }
      case 'DELETE_USER': {
        const uid = String(p.id || '');
        if (!uid || uid === 'admin') break;
        recordDeletedItem('users', uid, evTs, false);
        appState.users = (appState.users || []).filter(u => u && String(u.id) !== uid);
        changed = true;
        break;
      }
      case 'DELETE_FARM': {
        const fn = String(p.farmName || '').trim();
        if (!fn) break;
        recordDeletedItem('farms', fn, evTs, false);
        if (appState.farmsArchive) delete appState.farmsArchive[fn];
        changed = true;
        break;
      }
    }
    if (evTs > (Number(appState.lastDeltaSyncAt) || 0)) {
      appState.lastDeltaSyncAt = evTs;
    }
  });

  if (changed) {
    deduplicateAllDaysInState(appState);
    unifyGlobalMerchantsRegistry();
    syncActiveFarmIntoArchive();
    appState.updatedAt = new Date(getSyncedNow()).toISOString();
    appState.hasLocalEdits = true;
  }
  return changed;
}

function recordDeletedItem(category, itemId, customTs = 0, enqueueDelta = true) {
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
    if (enqueueDelta && typeof enqueueDeltaSyncEvent === 'function') {
      const actionMap = {
        sales: 'DELETE_SALE',
        pendingSales: 'DELETE_PENDING',
        expenses: 'DELETE_EXPENSE',
        merchants: 'DELETE_MERCHANT',
        users: 'DELETE_USER',
        farms: 'DELETE_FARM'
      };
      const act = actionMap[category];
      if (act) {
        enqueueDeltaSyncEvent(act, category === 'merchants'
          ? { code: Number(normId), dayNum: appState.currentDay }
          : (category === 'farms' ? { farmName: String(normId) } : { id: String(normId), dayNum: appState.currentDay })
        );
      }
    }
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
    if (typeof document !== 'undefined' && document.body) {
      document.body.classList.remove('lite-field-mode-active');
      const liteBannerEl = document.getElementById('liteFieldModeActiveBanner');
      if (liteBannerEl) {
        liteBannerEl.style.display = 'none';
        liteBannerEl.classList.add('hidden');
      }
    }
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
    const ignoreIds = ['inpFilterDailySales', 'inpFilterPendingSales', 'inpLiteFilterPendingCards', 'chkStickyLiteBanner', 'chkStickyTableHeaders', 'chkStickyTableFooters', 'chkStickyTableRightCols', 'chkStickyTableLeftCols', 'inpFilterDailyExpenses', 'inpDashQuickSearch', 'inpMerchQuickSearch', 'inpFilterTransfers', 'inpFilterPrevFarms', 'inpFilterExpSummary', 'inpFilterUsersList', 'inpFilterCloudFarms', 'inpFilterMerchantModal', 'selModalMerchantSwitcher', 'chkEnableLiveSync', 'selLiveSyncInterval', 'selTopCloudFarm', 'chkShowFloatingActionBar', 'chkShowAuditMetadata', 'inpFilterAuditTrail', 'selFilterAuditType'];
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

  // دمج نسختين لنفس السجل (نفس الـ id) مع الاعتماد الحاسم على أحدث ختم زمني (updatedAt) أولاً، ثم رقم إصدار التعديل (editVersion) ككاسر تعادل، مع الحفاظ التام على بيانات المنشئ الأصلي (createdBy)
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
    if (lUpdated > 0 && cUpdated > 0 && lUpdated !== cUpdated) {
      localWins = lUpdated > cUpdated;
    } else if (lVer !== cVer) {
      localWins = lVer > cVer;
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
    const maxImported = Math.max(Number(localItem.importedAt) || 0, Number(cloudItem.importedAt) || 0);
    const mergedObj = localWins
      ? { ...cloudItem, ...localItem, ...(maxUpdated > 0 ? { updatedAt: maxUpdated } : {}), ...(maxVer > 0 ? { editVersion: maxVer } : {}), ...(maxImported > 0 ? { importedAt: maxImported } : {}) }
      : { ...localItem, ...cloudItem, ...(maxUpdated > 0 ? { updatedAt: maxUpdated } : {}), ...(maxVer > 0 ? { editVersion: maxVer } : {}), ...(maxImported > 0 ? { importedAt: maxImported } : {}) };

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
      if (mergedObj.editHistory.length > 0) {
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
            const impTs = Number(rec.importedAt) || 0;
            const ownRecTs = Math.max(extractTimestampFromRecord(rec), impTs);
            const isImported = Boolean(impTs > 0 || (ownRecTs === 0 && fBulkTs > 0));
            const recTs = isImported
              ? Math.max(ownRecTs, fBulkTs || 0, dayAdded || 0)
              : (ownRecTs > 0 ? ownRecTs : Math.max(fBulkTs || 0, dayAdded || 0));
            if (!meta[cat][idStr] || recTs > meta[cat][idStr].ts) {
              meta[cat][idStr] = { ts: recTs, impTs: Math.max(impTs, isImported ? (fBulkTs || 0) : 0), isImported };
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

      // الحالة أ: السجل موجود حيّاً في السحابة وتم استيراده أو تحديثه بختم زمني أحدث من ختم الحذف المحلي
      if (inLocalDel && cloudLive[cat][idStr]) {
        const cRec = cloudLive[cat][idStr];
        const effectiveLocalDelTs = Math.max(lDelTs, cDelTs, !lDelTs ? localResetTs : 0);
        // 1) إذا تم استيراد السجل من الإكسيل أو تحديثه في السحابة بعد وقت الحذف (cRec.ts > effectiveLocalDelTs) -> نبطل الحذف القديم فوراً!
        if (cRec.ts > 0 && effectiveLocalDelTs > 0 && (cRec.ts > effectiveLocalDelTs || cRec.impTs > effectiveLocalDelTs)) {
          delete mergedDeletedTimestamps[cat][idStr];
          return false;
        }
        // 2) إذا كان سجل الحذف المحلي قديماً بلا طابع زمني (effectiveLocalDelTs === 0) والسجل في السحابة مستورد من إكسيل أو له طابع زمني حديث -> نبطل الحذف الشبح!
        if (effectiveLocalDelTs === 0 && !inCloudDel && (cRec.isImported || cRec.ts > 0 || cloudBulkTs > 0)) {
          delete mergedDeletedTimestamps[cat][idStr];
          return false;
        }
      }

      // الحالة ب: السجل موجود حيّاً محلياً وتم إعادة استيراده أو تحديثه محلياً بختم زمني أحدث من ختم الحذف في السحابة
      if (inCloudDel && localLive[cat][idStr]) {
        const lRec = localLive[cat][idStr];
        const effectiveCloudDelTs = Math.max(cDelTs, lDelTs, !cDelTs ? cloudResetTs : 0);
        if (lRec.ts > 0 && effectiveCloudDelTs > 0 && (lRec.ts > effectiveCloudDelTs || lRec.impTs > effectiveCloudDelTs)) {
          delete mergedDeletedTimestamps[cat][idStr];
          return false;
        }
        if (effectiveCloudDelTs === 0 && !inLocalDel && (lRec.isImported || localBulkTs > 0)) {
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
      if (cM && ((lDelTs > 0 && cMTs >= lDelTs) || (lDelTs === 0 && (cMTs > 0 || cloudBulkTs > 0)))) {
        delete mergedDeletedTimestamps.merchants[idStr];
        return false;
      }
    }
    if (inC && !inL) {
      const lM = (localState.merchants || []).find(m => m && Number(m.code) === codeNum);
      const lMTs = Math.max(Number(lM && lM.updatedAt) || 0, localBulkTs);
      if (lM && ((cDelTs > 0 && lMTs >= cDelTs) || (cDelTs === 0 && (lMTs > 0 || localBulkTs > 0)))) {
        delete mergedDeletedTimestamps.merchants[idStr];
        return false;
      }
    }
    return true;
  });

  // تطهير شواهد قبور المزارع (farms) إذا أُعيد إنشاء المزرعة محلياً أو في السحابة بعد التصفير
  const localFarmDelSet = new Set(localDel.farms.map(String));
  const cloudFarmDelSet = new Set(cloudDel.farms.map(String));
  mergedDeletedIds.farms = (mergedDeletedIds.farms || []).filter(rawFName => {
    const fnStr = String(rawFName || '').trim();
    if (!fnStr) return false;
    const inL = localFarmDelSet.has(fnStr);
    const inC = cloudFarmDelSet.has(fnStr);
    const lDelTs = Number(localDelTsMap.farms && localDelTsMap.farms[fnStr]) || 0;
    const cDelTs = Number(cloudDelTsMap.farms && cloudDelTsMap.farms[fnStr]) || 0;
    if (inC && !inL) {
      const existsLocally = (String(localState.farmName || '').trim() === fnStr) || Boolean(localState.farmsArchive && localState.farmsArchive[fnStr]);
      const lFarmTs = Math.max(Number(localState.lastFarmSwitchAt) || 0, localBulkTs);
      if (existsLocally && (cDelTs === 0 || lFarmTs >= cDelTs || Boolean(localState.hasLocalEdits))) {
        delete mergedDeletedTimestamps.farms[fnStr];
        return false;
      }
    }
    if (inL && !inC) {
      const existsInCloud = (String(cloudData.farmName || '').trim() === fnStr) || Boolean(cloudData.farmsArchive && cloudData.farmsArchive[fnStr]);
      const cFarmTs = Math.max(Number(cloudData.lastFarmSwitchAt) || 0, cloudBulkTs);
      if (existsInCloud && ((lDelTs > 0 && cFarmTs > lDelTs) || (lDelTs === 0 && cFarmTs > 0))) {
        delete mergedDeletedTimestamps.farms[fnStr];
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
  const localFarmName = String(appState.farmName ?? '').trim();
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

  // إبطال أي تصفير قديم (Stale Reset Neutralization) مع احترام هامش التفاوت الزمني للساعات (CLOCK_SKEW_BUFFER_MS = 60 دقيقة)
  const localResetAt = (rawLocalResetAt > 0 && cloudMovementsCount > 0 && !isTimestampSignificantlyNewer(rawLocalResetAt, Math.max(cloudBulkImportAt, cloudMaxAddedAt), CLOCK_SKEW_BUFFER_MS))
    ? 0
    : rawLocalResetAt;
  const cloudResetAt = (rawCloudResetAt > 0 && localMovementsCount > 0 && !isTimestampSignificantlyNewer(rawCloudResetAt, Math.max(localBulkImportAt, localMaxAddedAt), CLOCK_SKEW_BUFFER_MS))
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
    const lArchReset = (rawLArchReset > 0 && cArchMovCnt > 0 && !isTimestampSignificantlyNewer(rawLArchReset, Math.max(cArchBulk, cArchMaxAdded), CLOCK_SKEW_BUFFER_MS)) ? 0 : rawLArchReset;
    const cArchReset = (rawCArchReset > 0 && lArchMovCnt > 0 && !isTimestampSignificantlyNewer(rawCArchReset, Math.max(lArchBulk, lArchMaxAdded), CLOCK_SKEW_BUFFER_MS)) ? 0 : rawCArchReset;
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
    const userExplicitlySelectedFarm = Boolean((appState.hasLocalEdits && localFarmName) || Number(appState.lastFarmSwitchAt) > 0 || Object.keys(appState.farmsArchive || {}).length > 1);
    if ((preferCloud || !localFarmName) && !userExplicitlySelectedFarm && cloudFarmName && !mergedDeletedIds.farms.includes(cloudFarmName)) {
      activateFarmFromArchive(cloudFarmName);
    }
  }

  // إذا كان المتصفح المحلي بدون اسم مزرعة نشطة (جهاز جديد أو بعد مسح الكاش)، نعتمد اسم المزرعة القادم من السحابة أو الأرشيف فوراً
  if (!String(appState.farmName ?? '').trim()) {
    const candCloudFarm = String(cloudData.farmName ?? '').trim();
    const archKeys = Object.keys(appState.farmsArchive || {}).filter(k => k && String(k).trim() && !mergedDeletedIds.farms.includes(k));
    if (candCloudFarm && !mergedDeletedIds.farms.includes(candCloudFarm)) {
      appState.farmName = candCloudFarm;
      if (appState.farmsArchive && appState.farmsArchive[candCloudFarm]) {
        activateFarmFromArchive(candCloudFarm);
      }
    } else if (archKeys.length > 0) {
      activateFarmFromArchive(archKeys[0]);
    }
  }
  if (String(appState.farmName ?? '').trim()) {
    appState.factoryZeroWipeAt = 0;
  }
  deduplicateAllDaysInState(appState);
  syncActiveFarmIntoArchive();
  if (cloudData.updatedAt) appState.updatedAt = cloudData.updatedAt;
  appState.hasLocalEdits = true;
  return true;
}

// =========================================================================
// FIREBASE & CLOUD URL BUILDER ENGINE (Standard URL Object + ?auth= Support)
// يضمن إضافة المسار /abouzekry_cloud_db.json في نهاية pathname دائماً قبل معاملات الاستعلام مثل ?auth=SECRET و &_t=...
// =========================================================================
function buildCloudEndpointUrl(rawUrl, extraQueryParams = {}) {
  const cleanUrl = String(rawUrl || '').trim();
  if (!cleanUrl) return '';
  const isFirebase = cleanUrl.includes('firebaseio.com') || cleanUrl.includes('firebasedatabase.app');
  try {
    const parsedUrl = new URL(cleanUrl);
    if (isFirebase) {
      let path = parsedUrl.pathname || '/';
      // إزالة أي شرطة مائلة زائدة في النهاية
      path = path.replace(/\/+$/, '');
      if (!path.endsWith('.json')) {
        if (!path.endsWith('/abouzekry_cloud_db')) {
          path = (path ? path : '') + '/abouzekry_cloud_db.json';
        } else {
          path = path + '.json';
        }
      }
      parsedUrl.pathname = path.startsWith('/') ? path : ('/' + path);
      if (!parsedUrl.searchParams.get('auth')) {
        const fallbackSecret = String((appState && appState.firebaseSecret) || '').trim();
        if (fallbackSecret) {
          parsedUrl.searchParams.set('auth', fallbackSecret);
        }
      }
    }
    if (extraQueryParams && typeof extraQueryParams === 'object') {
      Object.keys(extraQueryParams).forEach(k => {
        const val = extraQueryParams[k];
        if (val !== undefined && val !== null && val !== '') {
          parsedUrl.searchParams.set(k, String(val));
        }
      });
    }
    return parsedUrl.toString();
  } catch (e) {
    // Fallback آمن في حال كان الرابط غير قياسي
    let fallbackBase = cleanUrl;
    let queryPart = '';
    const qIdx = cleanUrl.indexOf('?');
    if (qIdx !== -1) {
      fallbackBase = cleanUrl.slice(0, qIdx);
      queryPart = cleanUrl.slice(qIdx + 1);
    }
    if (isFirebase) {
      fallbackBase = fallbackBase.replace(/\/+$/, '');
      if (!fallbackBase.endsWith('.json')) {
        fallbackBase += '/abouzekry_cloud_db.json';
      }
    }
    const params = new URLSearchParams(queryPart);
    if (extraQueryParams && typeof extraQueryParams === 'object') {
      Object.keys(extraQueryParams).forEach(k => {
        const val = extraQueryParams[k];
        if (val !== undefined && val !== null && val !== '') {
          params.set(k, String(val));
        }
      });
    }
    const qs = params.toString();
    return qs ? `${fallbackBase}?${qs}` : fallbackBase;
  }
}

async function performAtomicPreFetchMerge(rawUrl) {
  const preEndpoint = buildCloudEndpointUrl(rawUrl, { _t: Date.now() });
  const preRes = await fetch(preEndpoint, { method: 'GET', redirect: 'follow', cache: 'no-store' });
  if (!preRes.ok) {
    const err = new Error(`HTTP ${preRes.status}`);
    err.status = preRes.status;
    throw err;
  }
  const preText = await preRes.text();
  if (preText && preText.trim() !== '{}' && preText.trim() !== 'null') {
    const remoteData = JSON.parse(preText);
    if (remoteData && remoteData.days && remoteData.merchants) {
      // دمج ذري مع تفضيل التعديلات المحلية الحديثة (preferCloud = false) لمنع مسح أو استبدال فواتير المندوبين الآخرين
      mergeCloudDataIntoLocal(remoteData, false);
      renderAllPreservingActiveInputs();
    }
  }
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
  const hasActiveOrArchivedFarm = Boolean(String(appState.farmName ?? '').trim()) || Object.keys(appState.farmsArchive || {}).length > 0;
  const isExplicitFarmReset = Boolean(skipPreFetchMerge && (Number(appState.farmResetAt) > 0 || Number(appState.factoryZeroWipeAt) > 0 || hasActiveOrArchivedFarm) && localMovCntNow === 0);
  if (!forcePush && !isExplicitFarmReset && (!appState.hasLocalEdits || (!hasActiveOrArchivedFarm && localMovCntNow === 0 && Number(appState.farmResetAt) === 0 && !hasRecordedDeletions && Number(appState.pendingChanges) === 0))) {
    const pulled = await pullDatabaseFromCloud(silent, true);
    if (pulled && (countMovementsInDays(appState.days) > 0 || Boolean(String(appState.farmName ?? '').trim()))) {
      return true;
    }
  }

  isCloudSyncInProgress = true;
  try {
    const baseEndpoint = buildCloudEndpointUrl(url);
    const outboxBatch = Array.isArray(appState.syncOutbox) ? [...appState.syncOutbox] : [];
    const canUseDeltaPush = Boolean(
      outboxBatch.length > 0 &&
      !skipPreFetchMerge &&
      !isExplicitFarmReset &&
      Number(appState.lastDeltaSyncAt) > 0 &&
      String(appState.farmName || '').trim()
    );

    // 1. المسار الجزئي السريع لـ Google Apps Script (Delta Sync Push)
    if (canUseDeltaPush && !isFirebase) {
      try {
        const deltaPayloadStr = JSON.stringify({
          mode: 'delta_sync',
          farmName: appState.farmName,
          since: Number(appState.lastDeltaSyncAt) || 0,
          deltaEvents: outboxBatch,
          updatedAt: new Date(getSyncedNow()).toISOString()
        });
        const deltaRes = await fetch(baseEndpoint, {
          method: 'POST',
          redirect: 'follow',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: deltaPayloadStr
        });
        if (deltaRes.ok) {
          const deltaResText = await deltaRes.text();
          let parsedDelta = null;
          try { parsedDelta = JSON.parse(deltaResText); } catch (e) {}
          if (parsedDelta && parsedDelta.status === 'ok' && parsedDelta.mode === 'delta_sync') {
            const sentIds = new Set(outboxBatch.map(ev => ev.id));
            appState.syncOutbox = (appState.syncOutbox || []).filter(ev => !sentIds.has(ev.id));
            if (Array.isArray(parsedDelta.incomingDeltaEvents) && parsedDelta.incomingDeltaEvents.length > 0) {
              applyIncomingDeltaEvents(parsedDelta.incomingDeltaEvents);
              renderAllPreservingActiveInputs();
            }
            appState.lastDeltaSyncAt = Math.max(Number(appState.lastDeltaSyncAt) || 0, Number(parsedDelta.serverTs) || getSyncedNow());
            appState.pendingChanges = appState.syncOutbox.length;
            appState.lastExcelSync = `مزامنة جزئية فورية ⚡ (${new Date().toLocaleTimeString('ar-EG')})`;
            saveState(false);
            if (liveBroadcastChannel) {
              try { liveBroadcastChannel.postMessage({ type: 'STATE_UPDATED', updatedAt: appState.updatedAt }); } catch (e) {}
            }
            verifyActiveUserSession();
            if (!silent) showToast('✅ تم رفع ودمج الحركات الجديدة لحظياً عبر المزامنة الجزئية السريعة (Delta Sync)!', '⚡');
            return true;
          }
        }
      } catch (deltaErr) {
        // Auto-Fallback إلى الرفع الكامل إذا كان السكربت قديماً أو تعذر المسار الجزئي
      }
    }

    // 2. جلب ودمج مسبق ذري (Atomic Pre-Fetch & Merge) قبل إرسال PATCH أو PUT إلى Firebase (أو Full POST إلى GAS)
    // يحمي مصفوفات المبيعات والوزنات المؤقتة والمصروفات من الاستبدال المتبادل (Array Overwrite Protection) في حال التزامن في نفس الثانية
    if (!skipPreFetchMerge) {
      try {
        await performAtomicPreFetchMerge(url);
      } catch (preErr) {
        if (preErr.status === 401 || preErr.status === 403) {
          if (!silent) showToast('❌ فشل الاتصال: الرمز السري لـ Firebase (Secret) غير صحيح أو لا توجد صلاحية!', '❌');
        } else if (preErr.status === 404) {
          if (!silent) showToast('❌ فشل الاتصال: مسار قاعدة البيانات غير موجود (تأكد من رابط فايربيز)!', '❌');
        } else if (preErr.status === 400) {
          if (!silent) showToast('❌ فشل الاتصال: تنسيق الرابط أو الطلب غير صالح!', '❌');
        } else {
          if (!silent) showToast('⏳ تعذر الاتصال بالسحابة (تأكد من جودة الإنترنت أو صحة الرابط) — تم التأجيل لحماية البيانات.', '🟠');
        }
        return false;
      }
    }

    // 3. دعم طلبات PATCH الجزئية المحصّنة لروابط Firebase (بعد إتمام الجلب والدمج المسبق الذري بنجاح)
    if (canUseDeltaPush && isFirebase) {
      try {
        const nowMsPatch = getSyncedNow();
        const nowIsoPatch = new Date(nowMsPatch).toISOString();
        appState.updatedAt = nowIsoPatch;
        syncActiveFarmIntoArchive();

        // تحديد الأيام التي تأثرت في syncOutbox بالإضافة إلى اليوم الحالي لدمجها وتحديثها ذرياً عبر PATCH
        const touchedDaysSet = new Set([Number(appState.currentDay) || 1]);
        outboxBatch.forEach(ev => {
          const dNum = Number(ev && ev.payload && ev.payload.dayNum);
          if (dNum >= 1 && dNum <= 10) touchedDaysSet.add(dNum);
        });

        const patchObj = {
          updatedAt: nowIsoPatch,
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
          merchants: appState.merchants,
          users: appState.users
        };
        touchedDaysSet.forEach(dNum => {
          if (appState.days && appState.days[dNum]) {
            patchObj[`days/${dNum}`] = appState.days[dNum];
          }
        });

        const patchRes = await fetch(baseEndpoint, {
          method: 'PATCH',
          redirect: 'follow',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patchObj)
        });
        if (patchRes.ok) {
          const sentIds = new Set(outboxBatch.map(ev => ev.id));
          appState.syncOutbox = (appState.syncOutbox || []).filter(ev => !sentIds.has(ev.id));
          appState.lastDeltaSyncAt = nowMsPatch;
          appState.pendingChanges = appState.syncOutbox.length;
          appState.lastExcelSync = `مزامنة جزئية ذرية Firebase PATCH ⚡ (${new Date().toLocaleTimeString('ar-EG')})`;
          saveState(false);
          if (liveBroadcastChannel) {
            try { liveBroadcastChannel.postMessage({ type: 'STATE_UPDATED', updatedAt: nowIsoPatch }); } catch (e) {}
          }
          verifyActiveUserSession();
          if (!silent) showToast('✅ تم دمج وتحديث الحركات جزئياً عبر Firebase PATCH الذري بنجاح!', '⚡');
          return true;
        }
      } catch (fbPatchErr) {
        // Auto-Fallback إلى PUT الكامل بالأسفل
      }
    }

    // 4. المسار الشامل (Full State Snapshot PUT لـ Firebase أو POST لـ GAS)
    const method = isFirebase ? 'PUT' : 'POST';
    const nowMs = getSyncedNow();
    const nowIso = new Date(nowMs).toISOString();
    appState.updatedAt = nowIso;

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
      farmsArchive: compactArchive,
      deltaEvents: outboxBatch
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
      if (parsedRes && parsedRes.serverTs) {
        appState.lastDeltaSyncAt = Math.max(Number(appState.lastDeltaSyncAt) || 0, Number(parsedRes.serverTs));
      } else {
        appState.lastDeltaSyncAt = nowMs;
      }
    } else {
      if (!res.ok) {
        if (!silent) showToast(`❌ رفضت قاعدة بيانات Firebase الحفظ (HTTP ${res.status})! تحقق من صلاحيات القواعد أو مفتاح ?auth=`, '❌');
        return false;
      }
      appState.lastDeltaSyncAt = nowMs;
    }

    appState.syncOutbox = [];
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
    if (!silent) showToast('⚠️ تعذر الاتصال بالسحابة، تأكد من اتصال الإنترنتوصحة رابط السحابة.', '🟠');
    return false;
  } finally {
    isCloudSyncInProgress = false;
  }
}

async function pullDatabaseFromCloud(silent = false, skipPushIfEmpty = false, isLiveBackgroundTick = false) {
  if (isLiveBackgroundTick) {
    if (isCloudSyncInProgress) return false;
    if (Number(appState.pendingChanges) > 0 || (Array.isArray(appState.syncOutbox) && appState.syncOutbox.length > 0)) return false;
    if (lastLocalMutationAt > 0 && (Date.now() - lastLocalMutationAt < 10000)) return false;
  }
  const url = (appState.webhookUrl || getEmbeddedWebhookUrl() || '').trim();
  if (!url) {
    if (!silent) showToast('⚠️ الصق رابط السحابة (Firebase / Google Apps Script URL) أولاً ثم اضغط حفظ وسحب من السحابة!', 'ℹ️');
    return false;
  }
  if (!navigator.onLine) {
    if (!silent) showToast('لا يوجد اتصال بالإنترنت حالياً للسحب من السحابة.', '🟠');
    return false;
  }
  const pullStartEpoch = localMutationEpoch;
  try {
    const isFirebase = url.includes('firebaseio.com') || url.includes('firebasedatabase.app');

    // في النبض الدوري الخلفي (Live Sync)، يطلب المتصفح من GAS فقط الحركات التي تغيرت بعد lastDeltaSyncAt، بينما يستخدم مع Firebase رابط JSON المدمج مع ?auth=
    const canUseDeltaPull = Boolean(
      isLiveBackgroundTick &&
      !isFirebase &&
      Number(appState.lastDeltaSyncAt) > 0 &&
      String(appState.farmName || '').trim()
    );
    const endpoint = canUseDeltaPull
      ? buildCloudEndpointUrl(url, { mode: 'delta_pull', since: Number(appState.lastDeltaSyncAt), _t: Date.now() })
      : buildCloudEndpointUrl(url, { _t: Date.now() });

    const res = await fetch(endpoint, { method: 'GET', redirect: 'follow', cache: 'no-store' });
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    const text = await res.text();
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

    // 1. معالجة رد المزامنة الجزئية (mode === 'delta_pull')
    if (data && data.mode === 'delta_pull') {
      if (data.serverTs) {
        calibrateCloudClockOffset(Number(data.serverTs));
      }
      const events = Array.isArray(data.deltaEvents) ? data.deltaEvents : [];
      if (events.length > 0) {
        const applied = applyIncomingDeltaEvents(events);
        appState.lastDeltaSyncAt = Math.max(Number(appState.lastDeltaSyncAt) || 0, Number(data.serverTs) || getSyncedNow());
        appState.lastExcelSync = `متزامن جزئياً ⚡ (${new Date().toLocaleTimeString('ar-EG')})`;
        saveState(false);
        if (!verifyActiveUserSession()) return true;
        if (applied) {
          renderAllPreservingActiveInputs();
        }
      } else if (data.serverTs) {
        appState.lastDeltaSyncAt = Math.max(Number(appState.lastDeltaSyncAt) || 0, Number(data.serverTs));
      }
      return true;
    }

    // 2. التوافق التلقائي الرجعي (Auto-Fallback) للسحب الكامل (Firebase JSON أو GAS Full Snapshot)
    if (data && data.days && data.merchants) {
      const prevUpdatedAt = appState.updatedAt;
      const hadUnsyncedLocalChanges = (Number(appState.pendingChanges) > 0 || (Array.isArray(appState.syncOutbox) && appState.syncOutbox.length > 0));
      mergeCloudDataIntoLocal(data, !hadUnsyncedLocalChanges);
      appState.lastDeltaSyncAt = Math.max(Number(appState.lastDeltaSyncAt) || 0, Date.parse(String(data.updatedAt || '')) || getSyncedNow());
      if (hadUnsyncedLocalChanges && navigator.onLine) {
        saveState(false);
        pushDatabaseToCloud(true, true, true);
      } else {
        appState.pendingChanges = 0;
        appState.lastExcelSync = `متزامن لحظياً ✓ (${new Date().toLocaleTimeString('ar-EG')})`;
        saveState(false);
      }

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
    if (err.status === 401 || err.status === 403) {
      if (!silent) showToast('❌ فشل الاتصال: الرمز السري لـ Firebase (Secret) غير صحيح!', '❌');
    } else if (err.status === 404) {
      if (!silent) showToast('❌ فشل الاتصال: مسار قاعدة البيانات غير موجود!', '❌');
    } else {
      if (!silent) showToast('❌ تعذر قراءة بيانات السحابة! تأكد من جودة الإنترنت أو صحة الرابط.', '⚠️');
    }
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
        ? '⚡ بث لحظي حي عبر Firebase Stream + دمج ذري للسجلات ✓'
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

  // 1. إذا كان الرابط Firebase Realtime Database، نفتح اتصال EventSource لحظي حي (Server-Sent Events) مع بناء الرابط السليم الداعم لـ ?auth=
  if (url && (url.includes('firebaseio.com') || url.includes('firebasedatabase.app')) && typeof EventSource !== 'undefined') {
    try {
      const sseUrl = buildCloudEndpointUrl(url);
      firebaseEventSource = new EventSource(sseUrl);
      const handleFirebaseStreamEvent = (evt) => {
        try {
          if (isCloudSyncInProgress || Number(appState.pendingChanges) > 0 || (Array.isArray(appState.syncOutbox) && appState.syncOutbox.length > 0) || (lastLocalMutationAt > 0 && (Date.now() - lastLocalMutationAt < 10000))) {
            return;
          }
          const packet = JSON.parse(evt.data);
          if (!packet || !packet.data) return;
          if (packet.path === '/' && packet.data.days && packet.data.merchants) {
            mergeCloudDataIntoLocal(packet.data, false);
            saveState(false);
            if (verifyActiveUserSession()) {
              renderAllPreservingActiveInputs();
            }
          } else {
            // إذا وصل حدث PATCH فرعي، نسحب الحالة المدمجة الذرية بهدوء
            pullDatabaseFromCloud(true, true, true);
          }
        } catch (err) {}
      };
      firebaseEventSource.addEventListener('put', handleFirebaseStreamEvent);
      firebaseEventSource.addEventListener('patch', handleFirebaseStreamEvent);
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
      const dayExp = roundMoney2(exps.reduce((a, e) => roundMoney2(a + (Number(e.amount) || 0)), 0));
      rows.forEach(r => {
        const hasLoadedSaleActivity = !r.isDebtCollectionOnly && (
          r.w1 > 0 || r.w2 > 0 || r.totalWithTip > 0 || r.cashSales > 0 || r.transferSales > 0 || r.creditSales > 0
        );
        if (hasLoadedSaleActivity) {
          fCars++;
        }
        if (hasLoadedSaleActivity || r.isDebtCollectionOnly || r.debtCash > 0 || r.debtTransfer > 0 || r.prevCash > 0 || r.prevTransfer > 0) {
          totalSalesRowsAllFarms++;
        }
        fNetW = roundMoney2(fNetW + r.netWeight);
        fSales = roundMoney2(fSales + r.totalWithTip);
        fCashInBox = roundMoney2(fCashInBox + roundMoney2(r.cashSales + r.debtCash + r.prevCash));
        fNetDebt = roundMoney2(fNetDebt + roundMoney2(r.creditSales - r.debtCash - r.debtTransfer));
      });
      fCashInBox = roundMoney2(fCashInBox - dayExp);
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
    localStorage.setItem('pref_sticky_lite_banner', appState.stickyLiteBanner !== false ? '1' : '0');
    localStorage.setItem(STORAGE_KEY + '_sticky_lite_banner', appState.stickyLiteBanner !== false ? '1' : '0');
    if (appState.webhookUrl) {
      localStorage.setItem(STORAGE_KEY + '_webhook_url', appState.webhookUrl);
    }
    if (appState.firebaseUrl !== undefined) {
      localStorage.setItem(STORAGE_KEY + '_firebase_url', String(appState.firebaseUrl || ''));
      localStorage.setItem('firebase_url', String(appState.firebaseUrl || ''));
    }
    if (appState.firebaseSecret !== undefined) {
      localStorage.setItem(STORAGE_KEY + '_firebase_secret', String(appState.firebaseSecret || ''));
      localStorage.setItem('firebase_secret', String(appState.firebaseSecret || ''));
    }
  } catch (e) {
    // Ignore storage error in restricted iframe
  }
  try {
    window.name = 'FARM_SALES_CLEAN_STATE_V67:' + serialized;
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
  updateEncryptedWebhookVaultUI();
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


if (typeof window !== 'undefined') {
  window.enqueueDeltaSyncEvent = enqueueDeltaSyncEvent;
  window.applyIncomingDeltaEvents = applyIncomingDeltaEvents;
}

if (typeof window !== 'undefined') {
  window.buildCloudEndpointUrl = buildCloudEndpointUrl;
}
