// =========================================================================
// MODULE 2: ACCOUNTING FORMULAS, TREASURY & MERCHANT CODING (js/accounting.js — v81)
// =========================================================================

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
  if (typeof enqueueDeltaSyncEvent === 'function') {
    enqueueDeltaSyncEvent('UPDATE_DAY_META', {
      farmName: appState.farmName,
      dayNum: dNum,
      dateLabel: trimmedLbl,
      labelUpdatedAt: appState.days[dNum].labelUpdatedAt
    });
  }
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
  if (!hasPermission('admin')) {
    showToast('🔒 عفواً، تصفير حركات المزرعة متاح لمدير الموقع فقط!', '🔒');
    return false;
  }
  const currentFarm = appState.farmName || 'مزرعة جديدة';
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
  appState.lastVoucherNo = 0;
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
  if (!hasPermission('admin')) {
    showToast('عفواً، التصفير الشامل للموقع متاح لمدير الموقع والمستخدمين المصرح لهم.', '🔒');
    return false;
  }
  const currentFarm = appState.farmName || 'مزرعة جديدة';
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
  appState.lastVoucherNo = 0;
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
  if (!hasPermission('admin')) {
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
  appState.lastVoucherNo = 0;
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
  const currentFarm = appState.farmName || 'مزرعة جديدة';

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
    if (isRecordDebtOnlyVoucher(r)) return;
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
      if (isRecordDebtOnlyVoucher(r)) return;
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

function getNextSequentialVoucherNo() {
  const curDayObj = (appState.days && appState.days[appState.currentDay]) || {};
  const curSales = curDayObj.sales || [];
  let maxVoucher = 0;
  curSales.forEach(r => {
    if (!isRecordDebtOnlyVoucher(r)) return;
    const vn = Number(r.voucherNo || r.scaleNo) || 0;
    if (vn > maxVoucher) maxVoucher = vn;
  });
  if (maxVoucher > 0) return maxVoucher + 1;
  for (let d = appState.currentDay - 1; d >= 1; d--) {
    const dObj = (appState.days && appState.days[d]) || {};
    const dSales = dObj.sales || [];
    dSales.forEach(r => {
      if (!isRecordDebtOnlyVoucher(r)) return;
      const vn = Number(r.voucherNo || r.scaleNo) || 0;
      if (vn > maxVoucher) maxVoucher = vn;
    });
    if (maxVoucher > 0) return maxVoucher + 1;
  }
  return (Number(appState.lastVoucherNo) || 0) + 1;
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
  if (elScale) {
    elScale.value = (typeof isDebtCollectionOnlyMode === 'function' && isDebtCollectionOnlyMode())
      ? getNextSequentialVoucherNo()
      : getNextSequentialScaleNo();
  }
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
        netDebt = roundMoney2(netDebt + roundMoney2(r.creditSales - r.debtCash - r.debtTransfer));
      }
    });
  }
  return roundMoney2(netDebt);
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
  const currentFarm = String(appState.farmName || 'مزرعة جديدة').trim();
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
          fDebt = roundMoney2(fDebt + roundMoney2(r.creditSales - r.debtCash - r.debtTransfer));
        }
      });
    }
    const roundedDebt = roundMoney2(fDebt);
    if (Math.abs(roundedDebt) > 0.01) {
      result.otherFarmsDebts.push({ farmName: cleanFName, debt: roundedDebt });
      result.totalOtherFarmsDebt = roundMoney2(result.totalOtherFarmsDebt + roundedDebt);
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
  const currentFarm = String(appState.farmName || 'مزرعة جديدة').trim();
  const archive = appState.farmsArchive || {};
  const otherFarms = Object.keys(archive).filter(fn => fn && fn.trim() && fn.trim() !== currentFarm);
  dl.innerHTML = otherFarms.map(fn => `<option value="${escXmlStr(fn)}"></option>`).join('');
}

// =========================================================================
// 2. UNIFIED MERCHANT CODE RESOLUTION (e.g. "كرنك 1" & "كرنك 2" -> 104)
// =========================================================================
function cleanMerchantBaseName(rawName) {
  if (!rawName) return '';
  return toAsciiDigits(rawName)
    .replace(/[\u200B-\u200D\uFEFF\u0640\u064B-\u065F\u0670]/g, '')
    .replace(/[0-9\-\(\)\/#_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeArabicMerchantCompareKey(str) {
  if (!str) return '';
  return cleanMerchantBaseName(str)
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/(^|\s)ال/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function resolveMerchantCode(rawName) {
  if (!rawName || !String(rawName).trim()) return 0;
  const trimmed = String(rawName).replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\s+/g, ' ').trim();
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
      if (normTarget.length >= 3) {
        const byPartial = appState.merchants.find(m => {
          const mNorm = normalizeArabicMerchantCompareKey(m.name);
          return mNorm && mNorm.length >= 3 && (mNorm.includes(normTarget) || normTarget.includes(mNorm));
        });
        if (byPartial) return byPartial.code;
      }
    }
  }
  return 0;
}

function ensureMerchantExists(rawName, explicitCode = null) {
  const cleanedInput = String(rawName || '').replace(/\s+/g, ' ').trim();
  if (!cleanedInput) return 0;

  const code = resolveMerchantCode(cleanedInput);
  if (code > 0) {
    unrecordDeletedItem('merchants', code);
    return code;
  }

  const base = cleanMerchantBaseName(cleanedInput) || cleanedInput;
  if (!base) return 0;

  if (!Array.isArray(appState.merchants)) appState.merchants = [];

  const nextCode = explicitCode && Number(explicitCode) >= 100
    ? Number(explicitCode)
    : (appState.merchants.length > 0
        ? Math.max(100, ...appState.merchants.map(m => Number(m.code) || 100)) + 1
        : 101);

  const prevDelTs = Number(appState.deletedTimestamps && appState.deletedTimestamps.merchants && appState.deletedTimestamps.merchants[String(nextCode)]) || 0;
  unrecordDeletedItem('merchants', nextCode);

  const nowTs = Math.max(
    getSyncedNow() + 1000,
    prevDelTs + 1000,
    (Number(appState.factoryZeroWipeAt) || 0) + 1000,
    (Number(appState.farmResetAt) || 0) + 1000
  );

  const existingIdx = appState.merchants.findIndex(m => m && Number(m.code) === nextCode);
  if (existingIdx === -1) {
    appState.merchants.push({ code: nextCode, name: base, updatedAt: nowTs });
  } else {
    appState.merchants[existingIdx].name = base;
    appState.merchants[existingIdx].updatedAt = nowTs;
  }

  appState.merchants.sort((a, b) => Number(a.code) - Number(b.code));
  if (typeof enqueueDeltaSyncEvent === 'function') {
    enqueueDeltaSyncEvent('UPSERT_MERCHANT', {
      merchant: { code: nextCode, name: base, updatedAt: nowTs }
    });
  }

  const fName = String(appState.farmName || '').trim();
  if (fName && appState.farmsArchive && appState.farmsArchive[fName]) {
    appState.farmsArchive[fName].merchants = JSON.parse(JSON.stringify(appState.merchants));
  }

  return nextCode;
}

// =========================================================================
// 3. CALCULATIONS ENGINE (DAILY & 10-DAY AGGREGATION)
// =========================================================================
function roundMoney2(v) {
  const n = Number(v) || 0;
  const r = Math.round((n + Number.EPSILON) * 100) / 100;
  return Object.is(r, -0) || Math.abs(r) < 0.0001 ? 0 : r;
}
if (typeof window !== 'undefined') {
  window.roundMoney2 = roundMoney2;
}

function computeSaleRow(row) {
  const w1 = roundMoney2(Math.max(0, Number(row.w1) || 0));
  const w2 = roundMoney2(Math.max(0, Number(row.w2) || 0));
  // الوزنة الثانية يجب أن تكون أكبر من أو تساوي الوزنة الأولى
  const netWeight = (w2 >= w1 && w2 > 0) ? roundMoney2(w2 - w1) : 0;
  const price = roundMoney2(Math.max(0, Number(row.price) || 0));
  const tip = roundMoney2(Math.max(0, Number(row.tip) || 0));
  const baseAmount = roundMoney2(netWeight * price);
  const totalWithTip = roundMoney2(baseAmount + tip);

  // Custody is a standalone statement (مجرد بيان مستقل لا يرتبط بالفاتورة أو الخزنة)
  const custodyCash = roundMoney2(Math.max(0, Number(row.custodyCash) || 0));
  const custodyTransfer = roundMoney2(Math.max(0, Number(row.custodyTransfer) || 0));
  const custodyTransferType = row.custodyTransferType || '';
  const totalCustody = roundMoney2(custodyCash + custodyTransfer);

  const cashSales = roundMoney2(Math.max(0, Number(row.cashSales) || 0));
  const transferSales = roundMoney2(Math.max(0, Number(row.transferSales) || 0));
  const transferSalesType = row.transferSalesType || '';
  const creditSales = roundMoney2(Math.max(0, Number(row.creditSales) || 0));
  const debtCash = roundMoney2(Math.max(0, Number(row.debtCash) || 0));
  const debtTransfer = roundMoney2(Math.max(0, Number(row.debtTransfer) || 0));
  const prevCash = roundMoney2(Math.max(0, Number(row.prevCash) || 0));
  const prevTransfer = roundMoney2(Math.max(0, Number(row.prevTransfer) || 0));

  // صافي متبقي العهدة بعد خصم سداد المديونيات وسداد فاتورة اليوم (مع التوافق التام مع السجلات القديمة)
  const custodyUsedForDebt = roundMoney2(debtCash + debtTransfer);
  const custodyUsedForInvoice = roundMoney2(cashSales + transferSales);
  const totalSettledFromCustody = roundMoney2(custodyUsedForDebt + custodyUsedForInvoice);
  const netCustodyAfterDebt = roundMoney2(totalCustody - custodyUsedForDebt);
  const netCustodyRemaining = totalCustody > 0
    ? roundMoney2(totalCustody >= totalSettledFromCustody ? (totalCustody - totalSettledFromCustody) : netCustodyAfterDebt)
    : 0;

  const totalPaidAndCredit = roundMoney2(cashSales + transferSales + creditSales);
  const invoiceDiff = roundMoney2(totalPaidAndCredit - totalWithTip);
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

  const voucherNo = isDebtCollectionOnly ? (Number(row.voucherNo || row.scaleNo) || 0) : 0;
  return {
    ...row,
    code,
    voucherNo,
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

  sumW1 = roundMoney2(sumW1);
  sumW2 = roundMoney2(sumW2);
  sumNetW = roundMoney2(sumNetW);
  sumTip = roundMoney2(sumTip);
  sumBase = roundMoney2(sumBase);
  sumTotalWithTip = roundMoney2(sumTotalWithTip);
  sumCashSales = roundMoney2(sumCashSales);
  sumTransferSales = roundMoney2(sumTransferSales);
  sumCreditSales = roundMoney2(sumCreditSales);
  sumDebtCash = roundMoney2(sumDebtCash);
  sumDebtTransfer = roundMoney2(sumDebtTransfer);
  sumPrevCash = roundMoney2(sumPrevCash);
  sumPrevTransfer = roundMoney2(sumPrevTransfer);
  sumPaidAndCredit = roundMoney2(sumPaidAndCredit);
  sumInvoiceDiff = roundMoney2(sumInvoiceDiff);

  const avgPrice = sumNetW > 0 ? roundMoney2(sumBase / sumNetW) : 0;
  const avgCarWeight = countCars > 0 ? Math.round(sumNetW / countCars) : 0;
  const pendingCarsCount = pendingRows.length;
  const sumExpenses = roundMoney2(expenses.reduce((acc, e) => acc + (Number(e.amount) || 0), 0));

  // 1. حساب حركة الذمم والمديونية اليومية (المطابقة الاستحقاقية للمزرعة الحالية)
  let openingDayDebt = 0;
  for (let prevD = 1; prevD < dayNum; prevD++) {
    const prevDayObj = appState.days && appState.days[prevD];
    const prevSales = (prevDayObj && prevDayObj.sales) || [];
    prevSales.forEach(rawR => {
      const cr = Number(rawR.creditSales) || 0;
      const dc = Number(rawR.debtCash) || 0;
      const dt = Number(rawR.debtTransfer) || 0;
      openingDayDebt = roundMoney2(openingDayDebt + (cr - dc - dt));
    });
  }
  const dayDebtCollected = roundMoney2(sumDebtCash + sumDebtTransfer);
  const netDayDebtChange = roundMoney2(sumCreditSales - dayDebtCollected);
  const closingDayDebt = roundMoney2(openingDayDebt + netDayDebtChange);

  // 2. حساب ميزان الخزينة النقدية شامل الرصيد النقدي المرحّل بين الأيام
  const openingCashFromPrevDay = roundMoney2(
    dayNum > 1
      ? (Number(appState.days && appState.days[dayNum - 1] && appState.days[dayNum - 1].carriedForwardCash) || 0)
      : (Number(dayObj.openingCash) || 0)
  );
  const totalCashBeforeExpenses = roundMoney2(sumCashSales + sumDebtCash + sumPrevCash);
  const netCashInBox = roundMoney2(totalCashBeforeExpenses - sumExpenses);
  const totalAvailableCashInBox = roundMoney2(openingCashFromPrevDay + netCashInBox);
  const deliveredCash = roundMoney2(Number(dayObj.deliveredCash) || 0);
  const carriedForwardCash = roundMoney2(Number(dayObj.carriedForwardCash) || 0);
  const totalSettledAndCarriedCash = roundMoney2(deliveredCash + carriedForwardCash);
  const cashBoxDiff = roundMoney2(totalAvailableCashInBox - totalSettledAndCarriedCash);

  const currentFarmTransfers = roundMoney2(sumTransferSales + sumDebtTransfer);
  const totalAllTransfers = roundMoney2(currentFarmTransfers + sumPrevTransfer);

  const weightAuditDiff = roundMoney2(sumNetW - (sumW2 - sumW1));
  const invoiceAuditDiff = roundMoney2((sumPaidAndCredit - sumTotalWithTip) - sumInvoiceDiff);
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

function enrichDashSummaryRow(s) {
  const statusOk = s.weightAuditDiff === 0 && s.invoiceAuditDiff === 0;
  const locked = isDayLocked(s.dayNum);
  const baseStatus = s.countCars === 0 && (s.countDebtVouchers || 0) === 0 && s.sumExpenses === 0 && s.deliveredCash === 0
    ? 'مفتوح (بدون حركات)'
    : (statusOk ? 'مطابق ومتزن ✓' : 'راجع الميزان!');
  const statusText = locked ? `🔒 معتمد ومقفل (${baseStatus})` : baseStatus;
  const netRemDebt = roundMoney2(s.sumCreditSales - s.sumDebtCash - s.sumDebtTransfer);
  return { ...s, statusOk, statusText, netRemDebt };
}

function enrichMerchantRow(m) {
  const nonCashDayOfSale = roundMoney2(m.creditSales + m.transferSales);
  const totalSettledCurrent = roundMoney2(m.cashSales + m.transferSales + m.debtCash + m.debtTransfer);
  const netDebtCurrent = roundMoney2(nonCashDayOfSale - m.transferSales - m.debtCash - m.debtTransfer);
  const prevAll = roundMoney2(m.prevCash + m.prevTransfer);
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
    sumW1 = roundMoney2(sumW1 + (Number(s.sumW1) || 0));
    sumW2 = roundMoney2(sumW2 + (Number(s.sumW2) || 0));
    sumNetW = roundMoney2(sumNetW + (Number(s.sumNetW) || 0));
    sumBase = roundMoney2(sumBase + (Number(s.sumBase) || 0));
    sumTip = roundMoney2(sumTip + (Number(s.sumTip) || 0));
    sumTotalWithTip = roundMoney2(sumTotalWithTip + (Number(s.sumTotalWithTip) || 0));
    sumCashSales = roundMoney2(sumCashSales + (Number(s.sumCashSales) || 0));
    sumTransferSales = roundMoney2(sumTransferSales + (Number(s.sumTransferSales) || 0));
    sumCreditSales = roundMoney2(sumCreditSales + (Number(s.sumCreditSales) || 0));
    sumDebtCash = roundMoney2(sumDebtCash + (Number(s.sumDebtCash) || 0));
    sumDebtTransfer = roundMoney2(sumDebtTransfer + (Number(s.sumDebtTransfer) || 0));
    sumPrevCash = roundMoney2(sumPrevCash + (Number(s.sumPrevCash) || 0));
    sumPrevTransfer = roundMoney2(sumPrevTransfer + (Number(s.sumPrevTransfer) || 0));
    sumPaidAndCredit = roundMoney2(sumPaidAndCredit + (Number(s.sumPaidAndCredit) || 0));
    sumInvoiceDiff = roundMoney2(sumInvoiceDiff + (Number(s.sumInvoiceDiff) || 0));
    sumExpenses = roundMoney2(sumExpenses + (Number(s.sumExpenses) || 0));
    sumDeliveredCash = roundMoney2(sumDeliveredCash + (Number(s.deliveredCash) || 0));
    if (s.dayNum >= latestDayWithCarry) {
      latestDayWithCarry = s.dayNum;
      lastDayCarriedForwardCash = roundMoney2(Number(s.carriedForwardCash) || 0);
    }
  });

  const avgPrice = sumNetW > 0 ? roundMoney2(sumBase / sumNetW) : 0;
  const avgCarWeight = countCars > 0 ? Math.round(sumNetW / countCars) : 0;
  const weightAuditDiff = roundMoney2(sumNetW - roundMoney2(sumW2 - sumW1));

  const currentFarmTransfers = roundMoney2(sumTransferSales + sumDebtTransfer);
  const totalAllTransfers = roundMoney2(currentFarmTransfers + sumPrevTransfer);
  const totalDebtCollected = roundMoney2(sumDebtCash + sumDebtTransfer);
  const closingFarmDebt = roundMoney2(sumCreditSales - totalDebtCollected);

  // إجمالي النقدية التراكمية التي دخلت خزنة المزرعة عبر كل الأيام (بدون ازدواج الرصيد المرحّل بين الأيام)
  const totalCashInflowBeforeExpenses = roundMoney2(sumCashSales + sumDebtCash + sumPrevCash);
  const netCumulativeCashInBox = roundMoney2(totalCashInflowBeforeExpenses - sumExpenses);
  // إجمالي ما تم توريده للإدارة عبر كل الأيام + الرصيد المتبقي المرحّل في خزنة آخر يوم نشط
  const totalSettledAndFinalCarry = roundMoney2(sumDeliveredCash + lastDayCarriedForwardCash);
  const cumulativeCashBoxDiff = roundMoney2(netCumulativeCashInBox - totalSettledAndFinalCarry);

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
      if (!r.isDebtCollectionOnly && (r.w1 > 0 || r.w2 > 0 || r.totalWithTip > 0 || r.cashSales > 0 || r.transferSales > 0 || r.creditSales > 0)) {
        m.cars += 1;
      }
      m.netW = roundMoney2(m.netW + r.netWeight);
      m.totalSales = roundMoney2(m.totalSales + r.totalWithTip);
      m.cashSales = roundMoney2(m.cashSales + r.cashSales);
      m.creditSales = roundMoney2(m.creditSales + r.creditSales);
      m.transferSales = roundMoney2(m.transferSales + r.transferSales);
      m.debtCash = roundMoney2(m.debtCash + r.debtCash);
      m.debtTransfer = roundMoney2(m.debtTransfer + r.debtTransfer);
      m.prevCash = roundMoney2(m.prevCash + r.prevCash);
      m.prevTransfer = roundMoney2(m.prevTransfer + r.prevTransfer);

      if (r.transferSales > 0 && m.byType[r.transferSalesType] !== undefined) {
        m.byType[r.transferSalesType] = roundMoney2(m.byType[r.transferSalesType] + r.transferSales);
      }
      if (r.debtTransfer > 0 && m.byType[r.debtTransferType] !== undefined) {
        m.byType[r.debtTransferType] = roundMoney2(m.byType[r.debtTransferType] + r.debtTransfer);
      }
      if (r.prevTransfer > 0 && m.byType[r.prevTransferType] !== undefined) {
        m.byType[r.prevTransferType] = roundMoney2(m.byType[r.prevTransferType] + r.prevTransfer);
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
      const settledInRow = r.isPending ? 0 : roundMoney2(r.cashSales + r.transferSales + r.debtCash + r.debtTransfer);
      const netDebtImpact = r.isPending ? 0 : roundMoney2(r.creditSales - r.debtCash - r.debtTransfer);
      runningBalance = roundMoney2(runningBalance + netDebtImpact);

      if (r.isPending) {
        totalPendingCars++;
      } else {
        if (!r.isDebtCollectionOnly && (r.w1 > 0 || r.w2 > 0 || r.totalWithTip > 0 || r.cashSales > 0 || r.transferSales > 0 || r.creditSales > 0)) {
          totalCompletedCars++;
        }
        sumW1 = roundMoney2(sumW1 + r.w1);
        sumW2 = roundMoney2(sumW2 + r.w2);
        sumNetWeight = roundMoney2(sumNetWeight + r.netWeight);
        sumBaseAmount = roundMoney2(sumBaseAmount + r.baseAmount);
        sumTip = roundMoney2(sumTip + r.tip);
        sumTotalSales = roundMoney2(sumTotalSales + r.totalWithTip);
        sumCashSales = roundMoney2(sumCashSales + r.cashSales);
        sumTransferSales = roundMoney2(sumTransferSales + r.transferSales);
        sumCreditSales = roundMoney2(sumCreditSales + r.creditSales);
        sumDebtCash = roundMoney2(sumDebtCash + r.debtCash);
        sumDebtTransfer = roundMoney2(sumDebtTransfer + r.debtTransfer);
        sumTotalSettledCurrent = roundMoney2(sumTotalSettledCurrent + settledInRow);
        sumPrevCash = roundMoney2(sumPrevCash + r.prevCash);
        sumPrevTransfer = roundMoney2(sumPrevTransfer + r.prevTransfer);
        sumCustodyCash = roundMoney2(sumCustodyCash + r.custodyCash);
        sumCustodyTransfer = roundMoney2(sumCustodyTransfer + r.custodyTransfer);
        sumTotalCustody = roundMoney2(sumTotalCustody + r.totalCustody);
        sumNetCustodyRem = roundMoney2(sumNetCustodyRem + r.netCustodyRemaining);
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

  const avgPrice = sumNetWeight > 0 ? roundMoney2(sumBaseAmount / sumNetWeight) : 0;

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
    finalRunningBalance: roundMoney2(runningBalance),
    sumPrevCash,
    sumPrevTransfer,
    sumCustodyCash,
    sumCustodyTransfer,
    sumTotalCustody,
    sumNetCustodyRem
  };
}

