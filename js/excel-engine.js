// =========================================================================
// MODULE 4: 15-SHEET EXCEL (.XLSX) ENGINE & JSON BACKUP (js/excel-engine.js — v89)
// =========================================================================

function exportMerchantDrillDownToExcel() {
  if (!activeDrillDownMerchantCode) return;
  if (typeof XLSX === 'undefined') {
    showToast('⚠️ مكتبة الإكسيل (XLSX) غير متوفرة حالياً!', '⚠️');
    return;
  }
  const ledger = computeMerchantDetailedLedger(activeDrillDownMerchantCode);
  const fName = appState.farmName || 'مزرعة جديدة';
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
      : `${auditEntries.length} حركة في مزرعة (${appState.farmName || 'مزرعة جديدة'})`;
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
    const fName = (appState.farmName || 'مزرعة جديدة').trim();
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
// 5. TWO-WAY EXCEL (.XLSX) ENGINE: FULL STYLED 15-SHEET EXPORT & IMPORT
// =========================================================================
// تم فصل STYLED_XLSX_TEMPLATE_B64 ودالة tinyInflateRaw في ملف مستقل (excel-template.js) لتخفيف حجم app.js وتسريع الأداء (v45)

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

  const fName = appState.farmName || 'مزرعة جديدة';
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
  const fName = (appState.farmName || 'مزرعة جديدة').replace(/\s+/g, '_');
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

// تنظيف المبالغ المالية المستوردة من خلايا الإكسيل وتجاهل القيم السالبة وفروق التقريب العشرية الضئيلة (< 1 ج.م) الناتجة عن معادلات الإكسيل
function sanitizeExcelFinancialAmount(val, ignoreSubPoundRoundingResidue = true) {
  const raw = sanitizeExcelNum(val, 2);
  if (!isFinite(raw) || raw <= 0) return 0;
  if (ignoreSubPoundRoundingResidue && raw > 0 && raw < 1) return 0;
  return roundMoney2(raw);
}

function buildExcelSaleCompositeKey(dayNum, seq, rec) {
  const mKey = normalizeArabicMerchantCompareKey(rec.merchant) || sanitizeExcelText(rec.merchant);
  const subNo = extractMerchantSubCarNumber(rec.merchant);
  const isDebtOnly = isRecordDebtOnlyVoucher(rec);
  const sNo = Number(isDebtOnly ? (rec.voucherNo || rec.scaleNo) : rec.scaleNo) || 0;
  if (sNo > 0 && !isDebtOnly) {
    return `d${dayNum}_scale_${sNo}_m_${mKey}${subNo}`;
  }
  if (sNo > 0 && isDebtOnly) {
    return `d${dayNum}_voucher_${sNo}_m_${mKey}${subNo}_coll_${rec.debtCash}_${rec.debtTransfer}_${rec.prevCash}_${rec.prevTransfer}`;
  }
  const rawCar = toAsciiDigits(rec.carNo || '').trim();
  const cNo = rawCar || `nocar_seq${seq}`;
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
  let importedExpCount = 0;
  const masterImportTs = getSyncedNow();

  // 1. استخلاص أو تثبيت اسم المزرعة النشطة بذكاء من شيت الملخص (الخلية C3 أو عنوان الخلية A1)
  let detectedFarmName = sanitizeExcelText(appState.farmName) || 'مزرعة جديدة';
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
          const subCarNumStr = extractMerchantSubCarNumber(merch);
          if (!subCarNumStr && explicitCode >= 101) {
            const officialMerch = appState.merchants.find(m => Number(m.code) === explicitCode);
            if (officialMerch && isSameMerchantIdentity(officialMerch.name, merch)) {
              merch = officialMerch.name;
            }
          } else if (subCarNumStr) {
            const cleanedBase = cleanMerchantBaseName(merch);
            if (cleanedBase) {
              merch = `${cleanedBase} ${subCarNumStr}`;
            }
          }

          const scaleNoVal = sanitizeExcelPositiveIntOrEmpty(is25Col || is21Col ? r[3] : r[2]);
          const carNoVal = sanitizeExcelPositiveIntOrEmpty(is25Col || is21Col ? r[4] : r[3]);
          const w1 = Math.max(0, sanitizeExcelNum(is25Col || is21Col ? r[5] : r[4], 2));
          const w2 = Math.max(0, sanitizeExcelNum(is25Col || is21Col ? r[6] : r[5], 2));
          const price = Math.max(0, sanitizeExcelNum(is25Col || is21Col ? r[8] : r[7], 2));
          const tip = sanitizeExcelFinancialAmount(is25Col || is21Col ? r[9] : r[8], false);

          // معالجة ذكية للمبالغ المالية: تجاهل أي قيم سالبة أو فروق تقريب عشرية ضئيلة (< 1 ج.م مثل 0.30 أو -0.20 ج.م) ناتجة عن معادلات الإكسيل حتى لا تتحول إلى مديونية أو عجز وهمي
          const cashSales = sanitizeExcelFinancialAmount(is25Col || is21Col ? r[11] : r[10], true);
          const transferSales = sanitizeExcelFinancialAmount(is25Col || is21Col ? r[12] : r[11], true);
          const transferSalesType = normalizeExcelTransferType(is25Col || is21Col ? r[13] : '', transferSales);
          let creditSales = sanitizeExcelFinancialAmount(is25Col || is21Col ? r[14] : r[12], true);
          const debtCash = sanitizeExcelFinancialAmount(is25Col || is21Col ? r[15] : r[13], true);
          const debtTransfer = sanitizeExcelFinancialAmount(is25Col ? r[16] : 0, true);
          const debtTransferType = normalizeExcelTransferType(is25Col ? r[17] : '', debtTransfer);
          const prevCash = sanitizeExcelFinancialAmount(is25Col ? r[18] : (is21Col ? r[16] : r[14]), true);
          const prevTransfer = sanitizeExcelFinancialAmount(is25Col ? r[19] : 0, true);
          const prevTransferType = normalizeExcelTransferType(is25Col ? r[20] : '', prevTransfer);

          // مطابقة فروق التقريب العشرية البسيطة (<= 0.05 ج.م) في خانة الآجل الناتجة عن معادلات الإكسيل (=W57-L57-M57)
          if (w2 >= w1 && w2 > 0 && price > 0 && creditSales > 0) {
            const expectedInvTotal = roundMoney2(roundMoney2((w2 - w1) * price) + tip);
            const expectedRemCredit = roundMoney2(Math.max(0, expectedInvTotal - cashSales - transferSales));
            if (Math.abs(creditSales - expectedRemCredit) > 0 && Math.abs(creditSales - expectedRemCredit) <= 0.05) {
              creditSales = expectedRemCredit;
            }
          }

          const rawNotesCell = is25Col ? r[21] : (is21Col ? r[17] : r[15]);
          const { notes, custodyCash, custodyTransfer, custodyTransferType } = extractCustodyAndCleanNotesFromExcel(
            rawNotesCell,
            is25Col ? r[25] : '',
            is25Col ? r[26] : ''
          );

          // قبول الصف فقط إذا كان يحتوي على أوزان فعلية أو مبالغ مالية حقيقية (تجاهل الصفوف الفارغة التي تحتوي على سعر افتراضي فقط)
          const hasAnyRowActivity = (
            w1 > 0 || w2 > 0 ||
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
            const isDebtOnlyRow = Boolean(
              !isPendingRow &&
              w1 === 0 && w2 === 0 &&
              cashSales === 0 && transferSales === 0 && creditSales === 0 &&
              (debtCash > 0 || debtTransfer > 0 || prevCash > 0 || prevTransfer > 0)
            );

            const recObj = {
              id: '',
              excelCompositeKey: '',
              merchant: merch,
              scaleNo: scaleNoVal,
              ...(isDebtOnlyRow ? { entryMode: 'debt_only', voucherNo: Number(scaleNoVal) || 0 } : {}),
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
            const generatedCompositeKey = buildExcelSaleCompositeKey(dayNum, seq, recObj);
            recObj.excelCompositeKey = generatedCompositeKey;

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
                  updatedAt: Math.max(Number(matchedOldPend.updatedAt) || 0, masterImportTs),
                  updatedBy: matchedOldPend.updatedBy || getActiveUserShortLabel(),
                  updatedTimeTxt: matchedOldPend.updatedTimeTxt || formatAuditTimeArabic(masterImportTs),
                  importedAt: masterImportTs,
                  excelCompositeKey: generatedCompositeKey,
                  isEdited: Boolean(matchedOldPend.isEdited),
                  editVersion: Number(matchedOldPend.editVersion) || 0,
                  lastEditDiffText: matchedOldPend.lastEditDiffText || '',
                  editHistory: Array.isArray(matchedOldPend.editHistory) ? [...matchedOldPend.editHistory] : []
                });
              } else {
                Object.assign(recObj, buildRecordAuditMeta(matchedOldPend || null, Boolean(matchedOldPend), recObj, 'sale'), {
                  updatedAt: masterImportTs,
                  importedAt: masterImportTs,
                  excelCompositeKey: generatedCompositeKey
                });
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
              // fallback: مطابقة بنفس رقم الميزان/السند ونفس التاجر ونفس نوع الحركة إذا تم تعديل الأوزان أو المبالغ داخل الإكسيل
              if (!matchedOldSale && scaleNoVal) {
                matchedOldSale = oldSales.find(os =>
                  os && !usedOldSaleIds.has(String(os.id)) &&
                  isRecordDebtOnlyVoucher(os) === isRecordDebtOnlyVoucher(recObj) &&
                  Number(isRecordDebtOnlyVoucher(os) ? (os.voucherNo || os.scaleNo) : os.scaleNo) === Number(scaleNoVal) &&
                  isSameMerchantIdentity(os.merchant, recObj.merchant)
                );
              }
              const upgradedFromPending = (!matchedOldSale && !isDebtOnlyRow)
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
                  updatedAt: Math.max(Number(matchedOldSale.updatedAt) || 0, masterImportTs),
                  updatedBy: matchedOldSale.updatedBy || getActiveUserShortLabel(),
                  updatedTimeTxt: matchedOldSale.updatedTimeTxt || formatAuditTimeArabic(masterImportTs),
                  importedAt: masterImportTs,
                  excelCompositeKey: generatedCompositeKey,
                  isEdited: Boolean(matchedOldSale.isEdited),
                  editVersion: Number(matchedOldSale.editVersion) || 0,
                  lastEditDiffText: matchedOldSale.lastEditDiffText || '',
                  editHistory: Array.isArray(matchedOldSale.editHistory) ? [...matchedOldSale.editHistory] : []
                });
              } else {
                Object.assign(recObj, buildRecordAuditMeta(baseExistingRec, Boolean(baseExistingRec), recObj, 'sale'), {
                  updatedAt: masterImportTs,
                  importedAt: masterImportTs,
                  excelCompositeKey: generatedCompositeKey
                });
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
                updatedAt: Math.max(Number(matchedOldExp.updatedAt) || 0, masterImportTs),
                updatedBy: matchedOldExp.updatedBy || getActiveUserShortLabel(),
                updatedTimeTxt: matchedOldExp.updatedTimeTxt || formatAuditTimeArabic(masterImportTs),
                importedAt: masterImportTs,
                isEdited: Boolean(matchedOldExp.isEdited),
                editVersion: Number(matchedOldExp.editVersion) || 0,
                lastEditDiffText: matchedOldExp.lastEditDiffText || '',
                editHistory: Array.isArray(matchedOldExp.editHistory) ? [...matchedOldExp.editHistory] : []
              });
            } else {
              const expCompKey = expObj.excelCompositeKey;
              expObj.id = generateRecordUUID(`imp_exp_d${dayNum}`);
              Object.assign(expObj, buildRecordAuditMeta(null, false), {
                createdAt: masterImportTs,
                updatedAt: masterImportTs,
                importedAt: masterImportTs,
                excelCompositeKey: expCompKey
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

