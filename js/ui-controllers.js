 =========================================================================
 MODULE 6: UI RENDERING, TABLE FILTERS, LITE MODE & CONTROLLERS (js/ui-controllers.js — v73)
 =========================================================================

 =========================================================================
 4. UI RENDERING FUNCTIONS
 =========================================================================
function updateConnectionAndSyncUI() {
  const isOnline = navigator.onLine;
  const dot = document.getElementById('connDot');
  const txt = document.getElementById('connText');
  const badge = document.getElementById('connStatusBadge');
  document.getElementById('pendingCountTxt').textContent = (appState.syncOutbox && appState.syncOutbox.length) || appState.pendingChanges || 0;

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

   Add "+ يوم جديد" pill button if fewer than 10 days are visible and user has permission
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

      const scaleOrVoucherCellHtml = r.isDebtCollectionOnly
        ? `سند #${escXmlStr(r.voucherNo || r.scaleNo || '-')}${r.carNo ? ' / ' + escXmlStr(r.carNo) : ''}`
        : `${escXmlStr(r.scaleNo || '-')} / ${escXmlStr(r.carNo || '-')}`;
      tr.innerHTML = `
        <td class="p-2 border text-center font-bold">${idx + 1}</td>
        <td class="p-2 border text-center font-extrabold text-blue-900">${r.code || '-'}</td>
        <td class="p-2 border font-extrabold text-slate-900">${merchantCellHtml}</td>
        <td class="p-2 border text-center text-[11px] font-extrabold ${r.isPending ? 'text-amber-900 bg-amber-100/60' : (r.isDebtCollectionOnly ? 'text-teal-900 bg-teal-50/70' : '')}">${scaleOrVoucherCellHtml}</td>
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

   Render Pending First-Weigh Cars (الوزنة الأولى المحفوظة مؤقتاً لحين استكمال الوزنة الثانية)
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

 =========================================================================
 UNIVERSAL EXCEL-LIKE SORT & FILTER ENGINE FOR ALL 10 WEBSITE TABLES
 =========================================================================
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

function renderFarmCumulativeTrialBalanceUI(summariesList) {
  const ftb = computeFarmCumulativeTrialBalance(summariesList);
  const fName = appState.farmName || 'مزرعة جديدة';

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
   Render Excel Filterable Header Row
  if (theadRow) {
    theadRow.innerHTML = cfg.columns.map(col => renderExcelHeaderCell(tableId, col, cfg.lightHeader)).join('');
  }

   Capture freshly rendered rows into cache
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

   Dynamically recalculate footer totals if table has tfoot
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
  const fName = appState.farmName || 'مزرعة جديدة';
  const titleEl = document.getElementById('dashFarmNameTitle');
  if (titleEl) titleEl.textContent = fName;

   فقط الأيام المفتوحة والتي عليها سجل حركات (الأيام غير النشطة تظل مخفية)
  const openActiveSummaries = getOpenAndActiveDashSummaries();
  const filteredSummaries = applyExcelSortAndFilter(openActiveSummaries, DASH_COLUMNS, 'dash');

  const badgeEl = document.getElementById('dashActiveDaysBadge');
  if (badgeEl) {
    badgeEl.textContent = `الأيام المفتوحة والنشطة: ${openActiveSummaries.length} يوم (المعروض: ${filteredSummaries.length})`;
  }

  updateColFilterToggleBtnUI('dash');
   Update Dashboard Filter Hint
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

   Render Excel Filterable Header Row
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

   الرسم البياني يعرض الأيام المفتوحة والتي عليها سجل حركات فقط (الأيام غير النشطة تظل مخفية)
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

function renderMerchantsAndStatements(scopeTab = 'all') {
  const fullList = computeMerchantAggregates();
  const renderMerchTable = (scopeTab === 'all' || scopeTab === 'merchants');
  const renderTransfersTables = (scopeTab === 'all' || scopeTab === 'transfers');

  if (renderMerchTable) {
  const activeList = fullList.filter(isMerchantActiveInCurrentFarm);
  const filterMode = appState.merchantsViewFilter === 'active' ? 'active' : 'all';
  const baseList = filterMode === 'active' ? activeList : fullList;
  const list = applyExcelSortAndFilter(baseList, MERCH_COLUMNS, 'merch');

   Update Filter Buttons & Counters UI
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

   Render Excel Filterable Header Row for Merchants Table
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
  }  end if (renderMerchTable)

  if (renderTransfersTables) {
   1) Transfers Table Filter (Active = merchants with transfers > 0 vs All coded merchants)
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

   2) Previous Farms Table Filter (Active = merchants with prevCash + prevTransfer > 0 vs All coded merchants)
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
  }  end if (renderTransfersTables)
  if (activeDrillDownMerchantCode > 0) {
    const mdl = document.getElementById('merchantDrillDownModal');
    if (mdl && !mdl.classList.contains('hidden')) {
      renderMerchantDrillDownModal();
    }
  }
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
  const fName = appState.farmName || 'مزرعة جديدة';

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

   Populate Merchant Switcher Dropdown inside Modal
  const selSwitcher = document.getElementById('selModalMerchantSwitcher');
  if (selSwitcher && document.activeElement !== selSwitcher) {
    const allMerchants = computeMerchantAggregates();
    selSwitcher.innerHTML = allMerchants.map(m =>
      `<option value="${m.code}" ${Number(m.code) === Number(ledger.code) ? 'selected' : ''}>${m.code} - ${escXmlStr(m.name)} (${m.cars} حركة)</option>`
    ).join('');
  }

   Render 6 KPI Summary Cards
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

   Extra Badges Strip for Standalone Custody & Previous Farms Collections
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

   Filter movements by search query
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

   Populate the dedicated print-only container for this single merchant
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
  const fName = appState.farmName || 'مزرعة جديدة';
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

   Top Header Select
  const selRole = document.getElementById('selActiveUserRole');
  if (selRole && document.activeElement !== selRole) {
    selRole.innerHTML = users.map(u =>
      `<option value="${escXmlStr(u.id)}" ${u.id === activeUser.id ? 'selected' : ''}>${u.perms && u.perms.admin ? '👑 ' : '👤 '}${escXmlStr(u.name)}</option>`
    ).join('');
  }

   Visitor Banner & Form Locking
  const isFullViewerOnly = !hasPermission('sales') && !hasPermission('expenses') && !hasPermission('merchants') && !hasPermission('farms');
  const vBanner = document.getElementById('visitorModeBanner');
  if (vBanner) {
    vBanner.classList.toggle('hidden', !isFullViewerOnly);
    if (isFullViewerOnly) {
      document.getElementById('visitorBannerText').textContent =
        `أنت تتصفح الموقع الآن بحساب (${activeUser.name}): متاح لك عرض جميع البيانات وسحب شيت الإكسيل (.xlsx) فقط.`;
    }
  }

   1. Visitor: Completely hide ⚙️ التحكم والمزامنة والصلاحيات tab & buttons
  document.querySelectorAll('[data-nav="sync"]').forEach(btn => {
    btn.classList.toggle('hidden', isVis);
  });
  const btnHdrPerm = document.getElementById('btnOpenUsersModal');
  if (btnHdrPerm) btnHdrPerm.classList.toggle('hidden', !isAdm);
  const btnDdPerm = document.getElementById('btnDropdownPermissions');
  if (btnDdPerm) btnDdPerm.classList.toggle('hidden', !isAdm);
  const btnDdProf = document.getElementById('btnOpenMyProfile');
  if (btnDdProf) btnDdProf.classList.toggle('hidden', isVis);

   If Visitor was on sync tab, redirect immediately to daily tab
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

   2. Inside #view-sync:
      - Admin sees everything.
      - Regular user sees their own account (#myProfileCardSection) + only sections explicitly permitted by Admin.
      - Users management (#usersPermissionsModal) is strictly for Admin only.
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

   Toggle Forms based on granular permissions & active day lock status
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

   Populate Personal Profile Card (#myProfileCardSection) for the active user
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

   Users Table inside Modal (Admin can edit ANY user's data! Rendered only when sync tab is active or requested)
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

 =========================================================================
 LITE FIELD MODE ENGINE (وضع شاشة المندوب المبسط المدمج - 3 عناصر فقط)
 =========================================================================
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
  if (fNameEl) fNameEl.textContent = appState.farmName || 'مزرعة جديدة';

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

   1. العنصر الأول: شريط البطاقات الأفقية للوزنات المؤقتة (Swipeable Pending Cards) مع دعم البحث السريع
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

   2. العنصر الثالث: سجل حركات البيع المسجلة اليوم بنظام بطاقات الموبايل (Mobile Sale Cards)
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
            <span class="text-[11px] font-bold text-slate-600">${isDebtOnly ? `(سند رقم: <strong class="text-teal-900">#${escXmlStr(r.voucherNo || r.scaleNo || '-')}</strong>${r.carNo ? ` | سيارة: <strong>${escXmlStr(r.carNo)}</strong>` : ''})` : `(ميزان: <strong>${escXmlStr(r.scaleNo || '-')}</strong> | سيارة: <strong>${escXmlStr(r.carNo || '-')}</strong>)`}</span>
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

 =========================================================================
 SMART ACTIVE-TAB RENDERING ENGINE (قصر إعادة الرسم على التبويب النشط لتسريع الاستجابة > 70%)
 =========================================================================
function checkAndEnforceNewFarmCreationModal() {
  const overlay = document.getElementById('forceCreateFarmOverlay');
  if (!overlay) return;
  if (!String(appState.farmName ?? '').trim() && Number(appState.factoryZeroWipeAt) === 0) {
    const embeddedFarm = getEmbeddedDefaultFarmName();
    const delFarms = (appState.deletedIds && Array.isArray(appState.deletedIds.farms)) ? appState.deletedIds.farms : [];
    const archiveKeys = Object.keys(appState.farmsArchive || {}).filter(k => k && String(k).trim() && !delFarms.includes(k));
    if (embeddedFarm && !delFarms.includes(embeddedFarm)) {
      appState.farmName = embeddedFarm;
      syncActiveFarmIntoArchive();
    } else if (archiveKeys.length > 0) {
      activateFarmFromArchive(archiveKeys[0]);
    }
  }
  const hasActiveFarm = Boolean(String(appState.farmName ?? '').trim());
  const shouldForceCreate = Boolean(appState.isLoggedIn && !hasActiveFarm && !isInitialCloudPullPending);
  overlay.classList.toggle('hidden', !shouldForceCreate);
  if (shouldForceCreate) {
    const inpUrl = document.getElementById('inpForceCloudWebhookUrl');
    const savedUrl = (appState.webhookUrl || getEmbeddedWebhookUrl() || '').trim();
    if (inpUrl && !inpUrl.value && savedUrl) {
      inpUrl.value = savedUrl;
    }
    const inp = document.getElementById('inpForceNewFarmName');
    const activeEl = document.activeElement;
    if (inp && activeEl !== inp && activeEl !== inpUrl) {
      setTimeout(() => {
        try {
          if (document.activeElement !== inpUrl) inp.focus();
        } catch (e) {}
      }, 80);
    }
  }
}

function renderAll(forceAllTabs = false, preserveInputs = false) {
  checkAndEnforceNewFarmCreationModal();
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

   قصر إعادة بناء جداول الـ DOM والرسوم البيانية على التبويب النشط فقط
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

   إذا كانت نافذة كشف حساب التاجر التفصيلي مفتوحة حالياً، يتم تحديثها لحظياً
  if (activeDrillDownMerchantCode > 0) {
    const mdl = document.getElementById('merchantDrillDownModal');
    if (mdl && !mdl.classList.contains('hidden')) {
      renderMerchantDrillDownModal();
    }
  }
}

 =========================================================================
 6. EVENT LISTENERS & INTERACTIVE HANDLERS
 =========================================================================
let prevFarmsManualToggleState = {
  merchantCode: 0,
  userExplicitlySet: null  null = auto, true = user opened, false = user closed
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

   إذا تغير التاجر المختار، نعيد ضبط التفضيل اليدوي ليسمح بالفتح التلقائي إذا كان للتاجر الجديد مديونية في الأرشيف
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

   قواعد الفتح والطيّ التلقائي:
   1) إذا كانت هناك قيم مدخلة بالفعل في حقول المزارع السابقة/الملاحظات -> نفتح القسم دائماً حتى لا تختفي بيانات مدخلة
  if (hasPrevFarmInputsNow) {
    setPrevFarmsSectionExpanded(true, false);
    return;
  }
   2) إذا قام المستخدم يدوياً بفتح أو طيّ القسم لهذا التاجر -> نحترم اختياره اليدوي
  if (prevFarmsManualToggleState.userExplicitlySet !== null) {
    setPrevFarmsSectionExpanded(prevFarmsManualToggleState.userExplicitlySet, false);
    return;
  }
   3) إذا كان للتاجر مديونية مرجعية في أرشيف المزارع السابقة -> يفتح القسم تلقائياً! وإلا يظل مطوياً افتراضياً لتقليل طول الشاشة
  setPrevFarmsSectionExpanded(hasArchiveReferenceDebt, false);
}

 =========================================================================
 DEBT-COLLECTION-ONLY MODE ENGINE (وضع سند تحصيل مديونية فقط بدون ميزان — v51)
 =========================================================================
let activeSaleEntryMode = 'sale';  'sale' | 'debt_only'

function isDebtCollectionOnlyMode() {
  return activeSaleEntryMode === 'debt_only';
}

function setSaleEntryMode(mode = 'sale', options = {}) {
  const { clearWeightFields = true, focusMerchantOrDebt = false, showModeToast = false } = options;
  activeSaleEntryMode = (mode === 'debt_only') ? 'debt_only' : 'sale';
  const isDebtOnly = (activeSaleEntryMode === 'debt_only');

  const inpModeEl = document.getElementById('inpSaleEntryMode');
  if (inpModeEl) inpModeEl.value = activeSaleEntryMode;

   1. Toggle Header Buttons & Title Styling
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

   2. Hide/Show Row 2 (Weights w1, w2, Price, Tip) and Car No / Scale Labels
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

   3. Adapt Blue Live KPI Banner & Hide Group 1 (سداد فاتورة اليوم) in Debt-Only Mode
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

   4. Hide "⏳ حفظ مؤقت وزنة 1" & "⚡ باقي الفاتورة آجل" buttons when in Debt-Only Mode
  ['btnSavePendingW1', 'btnInlineSavePendingW1', 'btnStickyAutoCredit'].forEach(btnId => {
    const b = document.getElementById(btnId);
    if (b) b.classList.toggle('hidden', isDebtOnly);
  });

   5. Clear weight & current-day invoice fields when switching to Debt-Only Mode & set independent Voucher No
  const editIdNow = document.getElementById('editSaleId') ? document.getElementById('editSaleId').value : '';
  if (isDebtOnly && clearWeightFields) {
    ['inpW1', 'inpW2', 'inpPrice', 'inpTip', 'inpCashSales', 'inpTransferSales', 'inpCreditSales'].forEach(fid => {
      const inp = document.getElementById(fid);
      if (inp) inp.value = '';
    });
    const selTrS = document.getElementById('selTransferSalesType');
    if (selTrS) selTrS.value = '';
    const wAlert = document.getElementById('weightValidationAlert');
    if (wAlert) wAlert.classList.add('hidden');
    if (!editIdNow && !activeRecalledPendingId) {
      const elScale = document.getElementById('inpScaleNo');
      if (elScale) elScale.value = getNextSequentialVoucherNo();
    }
  } else if (!isDebtOnly && clearWeightFields) {
    applyStickySaleDefaults();
  }

   Update Save Button Label according to mode & edit state
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

   التحقق من أن الوزنة الثانية أكبر من أو تساوي الوزنة الأولى
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

   Invoice collections (not linked to Custody)
  const cashS = parseNum(document.getElementById('inpCashSales').value) || 0;
  const trS = parseNum(document.getElementById('inpTransferSales').value) || 0;
  const credS = parseNum(document.getElementById('inpCreditSales').value) || 0;
  const diff = (cashS + trS + credS) - totalWithTip;

  document.getElementById('calcNetWeight').textContent = `${fmtInt(netW)} كجم`;
  document.getElementById('calcTotalWithTip').textContent = `${fmtDec(totalWithTip)} ج.م`;
  document.getElementById('calcInvoiceDiff').textContent = `${fmtDec(diff)} ج.م`;

   تحديث شريط الإجراءات السفلي العائم للموبايل (Mobile Weighbridge Sticky Action Bar)
  const stickyNetEl = document.getElementById('stickyBarNetWeight');
  if (stickyNetEl) stickyNetEl.textContent = `${fmtInt(netW)} كجم`;
  const stickyTotEl = document.getElementById('stickyBarTotalInvoice');
  if (stickyTotEl) stickyTotEl.textContent = `${fmtDec(totalWithTip)} ج.م`;
  const stickyRemEl = document.getElementById('stickyBarRemCredit');
  if (stickyRemEl) {
    const remCreditPreview = Math.max(0, Math.round(totalWithTip - cashS - trS));
    stickyRemEl.textContent = `${fmtInt(remCreditPreview)} ج.م`;
  }

   1. Previous Debt Statement in Current Farm for Selected Merchant (e.g., تاجر -> 0 ج.م)
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

   2. Smart Custody Waterfall & Unified Collection Statement:
      التوزيع التلقائي المتدرج للعهدة: (1) سداد المديونية السابقة أولاً ⬅️ (2) سداد فاتورة اليوم ⬅️ (3) حساب الآجل أو فائض العهدة
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

   3. الربط المرجعي الذكي لتحصيلات المزارع السابقة + الطيّ والفتح التلقائي الذكي للقسم (Collapsible Section 3)
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

   تحديث شارة الملخص في رأس القسم المطوي وفتح القسم تلقائياً إذا كان للتاجر مديونية مرجعية في الأرشيف أو قيم مدخلة
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

   4. تنبيهات الرقابة الذكية والقيود الاسترشادية الفورية غير المانعة (Smart Non-Blocking Audit Alerts)
  const alerts = [];
  const trSalesTypeVal = document.getElementById('selTransferSalesType') ? document.getElementById('selTransferSalesType').value : '';
  const debtTrTypeVal = document.getElementById('selDebtTransferType') ? document.getElementById('selDebtTransferType').value : '';

   أ) تنبيه فرق مطابقة فاتورة اليوم
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

   ب) تنبيه تجاوز سداد المديونية لرصيد مديونية المزرعة الحالية
  if (mName && deductedDebtNow > 0 && deductedDebtNow > (prevDebt + 1)) {
    alerts.push({
      level: 'warn',
      icon: '⚠️',
      text: `تنبيه سداد المديونية: المبلغ المدخل في تحصيل مديونيات المزرعة الحالية (${fmtInt(deductedDebtNow)} ج.م) أكبر من رصيد مديونية التاجر المسجل حالياً بالمزرعة (${fmtInt(prevDebt)} ج.م)! إذا كان المبلغ يخص مزرعة أخرى ضعه في قسم (3. تحصيلات مزارع سابقة).`
    });
  }

   ج) تنبيه فائض العهدة أو تجاوز الموزع لإجمالي العهدة
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

   د) تنبيهات عدم اختيار نوع التحويل عند إدخال مبلغ تحويل
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

   هـ) تنبيهات المزارع السابقة (عدم كتابة اسم المزرعة السابقة أو تجاوز المديونية المرجعية بالأرشيف)
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

   و) تنبيه انحراف السعر عن السعر الافتراضي لليوم بأكثر من 15%
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
  const hasWebhookNow = Boolean((appState.webhookUrl || getEmbeddedWebhookUrl()) && navigator.onLine);
  if (hasWebhookNow && !String(appState.farmName || '').trim()) {
    isInitialCloudPullPending = true;
  }
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
        isInitialCloudPullPending = !String(appState.farmName || '').trim();
        pullDatabaseFromCloud(true, true).finally(() => {
          isInitialCloudPullPending = false;
          checkAndEnforceNewFarmCreationModal();
          renderAll(true);
        });
      } else {
        isInitialCloudPullPending = false;
        checkAndEnforceNewFarmCreationModal();
      }
      window.buildEmbeddedGoogleSitesHtml = buildEmbeddedGoogleSitesHtml;
      startLiveRealtimeSyncEngine();
    }).catch(() => {
      if ((appState.webhookUrl || getEmbeddedWebhookUrl()) && navigator.onLine) {
        pullDatabaseFromCloud(true, true).finally(() => {
          isInitialCloudPullPending = false;
          checkAndEnforceNewFarmCreationModal();
          renderAll(true);
        });
      } else {
        isInitialCloudPullPending = false;
        checkAndEnforceNewFarmCreationModal();
      }
      startLiveRealtimeSyncEngine();
    });
  } else {
    if ((appState.webhookUrl || getEmbeddedWebhookUrl()) && navigator.onLine) {
      pullDatabaseFromCloud(true, true).finally(() => {
        isInitialCloudPullPending = false;
        checkAndEnforceNewFarmCreationModal();
        renderAll(true);
      });
    } else {
      isInitialCloudPullPending = false;
      checkAndEnforceNewFarmCreationModal();
    }
    startLiveRealtimeSyncEngine();
  }

   Toggle Live Sync from Header Button
  const btnBundleVendors = document.getElementById('btnBundleVendorsLocally');
  if (btnBundleVendors) {
    btnBundleVendors.addEventListener('click', () => {
      if (typeof window.downloadAndBundleVendorPackagesLocally === 'function') {
        window.downloadAndBundleVendorPackagesLocally();
      } else {
        showToast('⚠️ أداة تنزيل المكتبات غير محملة بعد.', '⚠️');
      }
    });
  }

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

   Toggle & Interval Select from Sync Settings Card
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

   Cross-Tab & Same-Browser Instant Sync + Immediate Forced Logout when User Deleted
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
         PWA Install Prompt Handler (زر تثبيت التطبيق المباشر على الموبايل والكمبيوتر)
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
  const ACTIVE_PWA_CACHE_NAME = 'farm-sales-committee-v73-modular-architecture';

   Force app hard reload & clear service worker caches (only when online so offline cache is never lost)
  async function forceAppHardReload() {
    if (!navigator.onLine) {
      showToast('🟠 أنت غير متصل بالإنترنت حالياً — يرجى الاتصال بالإنترنت أولاً لتحديث نسخة التطبيق!', '🟠');
      return;
    }
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

   Purge only outdated caches while preserving ACTIVE_PWA_CACHE_NAME ('farm-sales-committee-v73-modular-architecture')
  try {
    if ('caches' in window && navigator.onLine) {
      caches.keys().then(keys => {
        keys.forEach(k => {
          if (k !== ACTIVE_PWA_CACHE_NAME) {
            caches.delete(k).catch(() => {});
          }
        });
      }).catch(() => {});
    }
  } catch (e) {}

   Register Offline Service Worker (v73) without automatic reload loops
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    if (!window.__swRegisteredOnceV73) {
      window.__swRegisteredOnceV73 = true;
      navigator.serviceWorker.register('./sw.js?v=73', { scope: './' }).catch(() => {});
    }
  }

   1. إلغاء تغيير القيم ببكرة الفأرة (Mouse Wheel) ومفاتيح الأسهم على جميع خانات الإدخال الرقمية والمالية
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

   تنسيق الفلوس والأرقام في جميع الإدخالات (502,698.80 مع إخفاء العلامة العشرية عند عدم وجودها)
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

   2. إدارة جلسة تسجيل الدخول، البقاء في نفس الصفحة عند التحديث (Refresh)، وتسجيل الخروج التلقائي حسب الزمن الذي يحدده المدير
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

   Restore session and active tab on page load / refresh!
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

   Monitor activity and auto-logout after Admin-configured idle time
  ['mousemove', 'mousedown', 'keydown', 'touchstart', 'click', 'input', 'scroll'].forEach(evtName => {
    window.addEventListener(evtName, recordUserActivity, { passive: true });
  });

  setInterval(() => {
    const limitMs = getInactivityLimitMs();
    if (limitMs > 0 && appState.isLoggedIn && appState.lastActivityAt && (Date.now() - appState.lastActivityAt >= limitMs)) {
      performLogout(`تم تسجيل الخروج تلقائياً لعدم وجود حركة أو إدخال لمدة ${getInactivityTimeoutMinutes()} دقيقة 🔒`);
    }
  }, 5000);

   Admin handlers for configuring Inactivity Auto-Logout Timeout
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

  function applyCloudWebhookUrlFromStartScreen(rawUrl) {
    const cleanUrl = String(rawUrl || '').trim();
    if (!cleanUrl) return '';
    appState.webhookUrl = cleanUrl;
    window.EMBEDDED_CLOUD_WEBHOOK_URL = cleanUrl;
    const liveMeta = document.getElementById('metaEmbeddedCloudWebhookUrl');
    if (liveMeta) liveMeta.setAttribute('content', cleanUrl);
    const syncInpEl = document.getElementById('inpCloudWebhookUrl');
    if (syncInpEl) {
      syncInpEl.value = cleanUrl;
      syncInpEl.setAttribute('value', cleanUrl);
    }
    const forceInpEl = document.getElementById('inpForceCloudWebhookUrl');
    if (forceInpEl && forceInpEl.value !== cleanUrl) {
      forceInpEl.value = cleanUrl;
    }
    const loginInpEl = document.getElementById('inpLoginCloudWebhookUrl');
    if (loginInpEl && loginInpEl.value !== cleanUrl) {
      loginInpEl.value = cleanUrl;
    }
    try { localStorage.setItem(STORAGE_KEY + '_webhook_url', cleanUrl); } catch (e) {}
    return cleanUrl;
  }

  const btnToggleLoginCloud = document.getElementById('btnToggleLoginCloudBox');
  const loginCloudBox = document.getElementById('loginCloudLinkCollapseBox');
  const iconToggleLoginCloud = document.getElementById('iconToggleLoginCloudBox');
  if (btnToggleLoginCloud && loginCloudBox) {
    btnToggleLoginCloud.addEventListener('click', () => {
      const isHidden = loginCloudBox.classList.toggle('hidden');
      if (iconToggleLoginCloud) iconToggleLoginCloud.textContent = isHidden ? '▾' : '▴';
      if (!isHidden) {
        const inpLUrl = document.getElementById('inpLoginCloudWebhookUrl');
        if (inpLUrl) {
          if (!inpLUrl.value && (appState.webhookUrl || getEmbeddedWebhookUrl())) {
            inpLUrl.value = appState.webhookUrl || getEmbeddedWebhookUrl();
          }
          setTimeout(() => { try { inpLUrl.focus(); } catch (e) {} }, 50);
        }
      }
    });
  }

  const btnLoginPullCloud = document.getElementById('btnLoginPullCloudNow');
  if (btnLoginPullCloud) {
    btnLoginPullCloud.addEventListener('click', async () => {
      const inpLUrl = document.getElementById('inpLoginCloudWebhookUrl');
      const statusMsg = document.getElementById('loginCloudSyncStatusMsg');
      const enteredUrl = (inpLUrl ? inpLUrl.value : '').trim();
      if (!enteredUrl || !enteredUrl.startsWith('http')) {
        if (statusMsg) {
          statusMsg.textContent = '⚠️ يرجى لصق رابط سحابة صحيح يبدأ بـ https: أولاً!';
          statusMsg.className = 'p-2 rounded-lg text-[11px] font-extrabold text-center bg-amber-100 text-amber-950 border border-amber-400';
          statusMsg.classList.remove('hidden');
        }
        if (inpLUrl) inpLUrl.focus();
        return;
      }
      const isFb = enteredUrl.includes('firebaseio.com') || enteredUrl.includes('firebasedatabase.app');
      if (!isFb && enteredUrl.includes('script.google.com') && !enteredUrl.endsWith('/exec')) {
        if (statusMsg) {
          statusMsg.textContent = '❌ رابط Google Apps Script يجب أن ينتهي بـ /exec';
          statusMsg.className = 'p-2 rounded-lg text-[11px] font-extrabold text-center bg-rose-100 text-rose-900 border border-rose-400';
          statusMsg.classList.remove('hidden');
        }
        return;
      }
      applyCloudWebhookUrlFromStartScreen(enteredUrl);
      appState.hasLocalEdits = false;
      appState.factoryZeroWipeAt = 0;
      btnLoginPullCloud.disabled = true;
      if (statusMsg) {
        statusMsg.textContent = '⏳ جاري الاتصال بالسحابة وجلب الحسابات والمزرعة...';
        statusMsg.className = 'p-2 rounded-lg text-[11px] font-extrabold text-center bg-sky-100 text-sky-900 border border-sky-300';
        statusMsg.classList.remove('hidden');
      }
      const pulled = await pullDatabaseFromCloud(true, true);
      btnLoginPullCloud.disabled = false;
      if (pulled && String(appState.farmName || '').trim()) {
        if (statusMsg) {
          statusMsg.textContent = `✅ تم ربط السحابة وجلب مزرعة (${appState.farmName}) بنجاح! يمكنك تسجيل الدخول الآن.`;
          statusMsg.className = 'p-2 rounded-lg text-[11px] font-extrabold text-center bg-emerald-100 text-emerald-950 border border-emerald-400';
        }
      } else {
        if (statusMsg) {
          statusMsg.textContent = '✅ تم حفظ الرابط! السحابة جاهزة — سجل الدخول الآن للبدء.';
          statusMsg.className = 'p-2 rounded-lg text-[11px] font-extrabold text-center bg-emerald-100 text-emerald-950 border border-emerald-400';
        }
      }
    });
  }

  document.getElementById('gatewayLoginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const uName = (document.getElementById('inpLoginUsername').value || '').trim().toLowerCase();
    const uPass = (document.getElementById('inpLoginPassword').value || '').trim();
    const btnLoginSubmitEl = document.getElementById('btnLoginAdminSubmit');
    const origBtnHtml = btnLoginSubmitEl ? btnLoginSubmitEl.innerHTML : '';

    const loginWebhookInp = document.getElementById('inpLoginCloudWebhookUrl');
    const enteredLoginWebhook = (loginWebhookInp ? loginWebhookInp.value : '').trim();

    let unlockedFromVault = { url: '', matchedByDirectPassword: false };
    if (enteredLoginWebhook && enteredLoginWebhook.startsWith('http')) {
      applyCloudWebhookUrlFromStartScreen(enteredLoginWebhook);
      unlockedFromVault = { url: enteredLoginWebhook, matchedByDirectPassword: true };
    } else {
      unlockedFromVault = unlockWebhookVaultWithCredentials(uName, uPass, true);
      if (unlockedFromVault.url) {
        appState.webhookUrl = unlockedFromVault.url;
      }
    }

    const activeWebhookForLogin = (appState.webhookUrl || getEmbeddedWebhookUrl() || '').trim();
    if (activeWebhookForLogin && navigator.onLine) {
      const isFreshWipedBrowser = !String(appState.farmName || '').trim() && countMovementsInDays(appState.days) === 0;
      if (isFreshWipedBrowser) {
        appState.hasLocalEdits = false;
        appState.factoryZeroWipeAt = 0;
        appState.farmResetAt = 0;
        isInitialCloudPullPending = true;
      }
      if (btnLoginSubmitEl) {
        btnLoginSubmitEl.disabled = true;
        btnLoginSubmitEl.innerHTML = '<span>🔐⏳</span><span>جاري فك تشفير السحابة واسترجاع المزرعة...</span>';
      }
      try {
        await pullDatabaseFromCloud(true, true);
      } catch (err) {}
      isInitialCloudPullPending = false;
      if (btnLoginSubmitEl) {
        btnLoginSubmitEl.disabled = false;
        btnLoginSubmitEl.innerHTML = origBtnHtml;
      }
    }

     Check Admin user (supports updated username/password from Profile or default admin/admin)
    const adminObj = (appState.users || []).find(u => u.id === 'admin') || { username: 'admin', password: 'admin' };
    const adminUsername = String(adminObj.username || 'admin').trim().toLowerCase();
    const adminPassword = String(adminObj.password || 'admin').trim();

    if ((uName === adminUsername || uName === 'admin') && uPass === adminPassword) {
      if (activeWebhookForLogin) {
        applyCloudWebhookUrlFromStartScreen(activeWebhookForLogin);
      }
      appState.activeUserId = 'admin';
      appState.isLoggedIn = true;
      appState.lastActivityAt = Date.now();
      loginErr.classList.add('hidden');
      loginOverlay.classList.add('hidden');
      unifyGlobalMerchantsRegistry();
      applyAutoLiteFieldModeOnLoginOrSwitch();
      switchActiveTabUI(appState.activeTab || 'daily');
      updateEncryptedWebhookVaultUI();
      saveState(false);
      checkAndEnforceNewFarmCreationModal();
      renderAll(true);
      startLiveRealtimeSyncEngine();
      const farmReadyMsg = appState.farmName ? ` وتم فتح مزرعة (${appState.farmName}) تلقائياً من السحابة ☁️` : '';
      showToast(`مرحباً بك (${adminObj.name || 'مدير الموقع'})! تم تسجيل الدخول بصلاحيات المدير الكاملة${farmReadyMsg} 👑`);
      return;
    }

    const matchedUser = (appState.users || []).find(u =>
      u.id !== 'admin' && u.id !== 'visitor' &&
      (String(u.username || u.name).trim().toLowerCase() === uName || String(u.name).trim().toLowerCase() === uName) &&
      String(u.password || '1234').trim() === uPass
    );
    if (matchedUser) {
      if (activeWebhookForLogin) {
        applyCloudWebhookUrlFromStartScreen(activeWebhookForLogin);
      }
      appState.activeUserId = matchedUser.id;
      appState.isLoggedIn = true;
      appState.lastActivityAt = Date.now();
      loginErr.classList.add('hidden');
      loginOverlay.classList.add('hidden');
      unifyGlobalMerchantsRegistry();
      applyAutoLiteFieldModeOnLoginOrSwitch();
      switchActiveTabUI(appState.activeTab || 'daily');
      updateEncryptedWebhookVaultUI();
      saveState(false);
      checkAndEnforceNewFarmCreationModal();
      renderAll(true);
      startLiveRealtimeSyncEngine();
      const farmReadyMsg = appState.farmName ? ` — مزرعة (${appState.farmName})` : '';
      showToast(`مرحباً بك (${matchedUser.name})! تم تسجيل الدخول بنجاح${farmReadyMsg}`, '👤');
      return;
    }

     إذا فشل تسجيل الدخول بكلمة مرور خاطئة، لا نحتفظ برابط السحابة المؤقت في الذاكرة
    if (unlockedFromVault.url && !unlockedFromVault.matchedByDirectPassword) {
      appState.webhookUrl = '';
    }
    loginErr.textContent = '❌ اسم المستخدم أو كلمة المرور غير صحيحة (أو تم حذف الحساب من قِبل المدير)!';
    loginErr.classList.remove('hidden');
  });



  document.getElementById('btnShowLoginScreen').addEventListener('click', () => {
    const dd = document.getElementById('headerUserDropdownMenu');
    if (dd) dd.classList.add('hidden');
    performLogout('تم تسجيل الخروج بنجاح 👋');
  });

   Dynamic Farm Name Inputs (Top Header + Settings Panel + Quick Presets)
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

   Start a New Clean 10-Day Cycle for a New Farm (keeping coded merchants)
  document.getElementById('btnNewCleanCycle').addEventListener('click', () => {
    clearActiveFarmMovementsKeepMerchants(
      `تم فتح دورة 10 أيام جديدة فارغة لمزرعة (${appState.farmName}) مع الاحتفاظ بأكواد التجار!`,
      '🆕'
    );
  });

   Live File Binding via File System Access API (`showOpenFilePicker`)
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

   Online / Offline listeners with Automatic Cloud Sync on Reconnect
  window.addEventListener('online', () => {
    updateConnectionAndSyncUI();
    pushDatabaseToCloud(true);
    showToast('عاد الاتصال بالإنترنت وتمت مزامنة قاعدة البيانات السحابية تلقائياً!', '🟢');
  });

   Top Header Cloud Farm Switcher
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

   Add or Rename Farm in Cloud Database
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
    appState.factoryZeroWipeAt = 0;
    appState.hasLocalEdits = true;
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

   Switch, Export, Rename, or Delete specific farm from Cloud Farms Table
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

   Users & Permissions Modal Handlers (with password check if switching from Visitor to Admin)
  document.getElementById('selActiveUserRole').addEventListener('change', (e) => {
    const targetId = e.target.value;
    if (targetId !== 'visitor' && !hasPermission('admin')) {
       Require login via Login Overlay
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

   Unified Header User Dropdown Menu Toggle & Actions
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
         Ensure primary admin keeps admin perm
        if (uObj.id === 'admin') perms.admin = true;
        uObj.perms = perms;
        if (typeof enqueueDeltaSyncEvent === 'function') enqueueDeltaSyncEvent('UPSERT_USER', uObj);
      }
      document.getElementById('editUserIdInput').value = '';
      document.getElementById('btnSaveUserSubmit').textContent = '➕ حفظ المستخدم';
      document.getElementById('btnCancelUserEdit').classList.add('hidden');
      showToast(`تم تحديث جميع بيانات وصلاحيات المستخدم (${fullName}) بنجاح`);
    } else {
      const newUserObj = {
        id: generateRecordUUID('usr'),
        updatedAt: getSyncedNow(),
        username: username,
        password: pwd || '1234',
        name: fullName,
        phone: phone,
        jobTitle: jobTitle,
        isSystem: false,
        perms
      };
      appState.users.push(newUserObj);
      if (typeof enqueueDeltaSyncEvent === 'function') enqueueDeltaSyncEvent('UPSERT_USER', newUserObj);
      /*
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
      */
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

   Push / Pull Cloud DB Buttons
  document.getElementById('btnPushCloudNow').addEventListener('click', () => pushDatabaseToCloud(false, true));
  document.getElementById('btnPullCloudNow').addEventListener('click', () => pullDatabaseFromCloud(false, true));

   Copy Ready-Made Google Apps Script Cloud Database Code (Chunked at 2500 chars to stay well below 9KB UTF-8 limit for Arabic!)
  document.getElementById('btnCopyCloudScriptCode').addEventListener('click', () => {
    const scriptCode = [
      " كود قاعدة البيانات السحابية المطور لـ GitHub Pages و Google Sites (يدعم اللغة العربية والأحجام الكبيرة بدون أخطاء 9KB)",
      " 1. افتح script.google.com وامسح الكود القديم بالكامل والصق هذا الكود ثم اضغط حفظ (Save 💾)",
      " 2. اضغط Deploy -> Manage deployments -> Edit (أيقونة القلم ✏️) -> اختر Version: New version -> Deploy",
      "    (أو Deploy -> New deployment -> Web app -> Execute as: Me -> Who has access: Anyone)",
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

   Navigation Tabs
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

   Quick In-Page Jump Buttons on Daily View
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

   Date / Label change for current day + Interactive Add / Edit / Delete Day Boxes
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

   Helper to populate and refresh all Day Management selectors & pills
  function refreshDayManagementBoxesUI() {
    window.refreshDayManagementBoxesUI = refreshDayManagementBoxesUI;
    const visDays = getVisibleDays();
    const allDays = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const hiddenDays = allDays.filter(d => !visDays.includes(d));

     1) Populate Add Day Selector & Pills (#selAddDayTarget, #addDayQuickPills) + Daily Quick Add (#selDailyQuickAddDay, #dailyQuickAddDayPills)
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

     2) Populate Edit Day Selector & Pills (#selEditDayTarget, #editDayQuickPills, #inpEditDayCustomLabel)
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

     3) Populate Delete Day Selector & Pills (#selDeleteDayTarget, #deleteDayQuickPills, #deleteDaySummaryText)
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

   Top 3 Day Management Buttons in #syncQuickControlCard
  document.getElementById('btnAddDayTop').addEventListener('click', () => openDayManagementBox('add'));
  document.getElementById('btnSaveDayLabel').addEventListener('click', () => openDayManagementBox('edit'));
  document.getElementById('btnDeleteDayTop').addEventListener('click', () => openDayManagementBox('delete'));

   Close / Cancel buttons for the Day Management boxes
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

   Sync dropdown changes & pill clicks in Add Day Box
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

   Sync dropdown changes & pill clicks in Daily Quick Add Day Box
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

   Sync dropdown changes & pill clicks in Edit Day Box
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

   Sync dropdown changes & pill clicks in Delete Day Box
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

   Delivered Cash & Carried-Forward Cash Inputs + Quick Settlement Buttons in Trial Balance
  document.getElementById('inpDeliveredCash').addEventListener('input', (e) => {
    if (isDayLocked(appState.currentDay)) {
      showToast('🔒 هذا اليوم مقفل ومعتمد محاسبياً — لا يمكن تعديل النقدية المسلمة إلا بعد فك القفل بواسطة مدير الموقع!', '🔒');
      renderDailyView();
      return;
    }
    const curD = appState.days[appState.currentDay];
    curD.deliveredCash = parseNum(e.target.value) || 0;
    curD.deliveredCashUpdatedAt = Math.max(getSyncedNow(), (Number(curD.deliveredCashUpdatedAt) || 0) + 10);
    if (typeof enqueueDeltaSyncEvent === 'function') enqueueDeltaSyncEvent('UPDATE_DAY_META', { farmName: appState.farmName, dayNumber: appState.currentDay, deliveredCash: curD.deliveredCash, deliveredCashUpdatedAt: curD.deliveredCashUpdatedAt });
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
      if (typeof enqueueDeltaSyncEvent === 'function') enqueueDeltaSyncEvent('UPDATE_DAY_META', { farmName: appState.farmName, dayNumber: appState.currentDay, carriedForwardCash: curD.carriedForwardCash, carriedForwardCashUpdatedAt: curD.carriedForwardCashUpdatedAt });
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
      const targetDeliver = roundMoney2(Math.max(0, s.totalAvailableCashInBox - s.carriedForwardCash));
      curD.deliveredCash = targetDeliver;
      curD.deliveredCashUpdatedAt = Math.max(getSyncedNow(), (Number(curD.deliveredCashUpdatedAt) || 0) + 10);
    if (typeof enqueueDeltaSyncEvent === 'function') enqueueDeltaSyncEvent('UPDATE_DAY_META', { farmName: appState.farmName, dayNumber: appState.currentDay, deliveredCash: curD.deliveredCash, deliveredCashUpdatedAt: curD.deliveredCashUpdatedAt });
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
      const remToCarry = roundMoney2(Math.max(0, s.totalAvailableCashInBox - s.deliveredCash));
      curD.carriedForwardCash = remToCarry;
      curD.carriedForwardCashUpdatedAt = Math.max(getSyncedNow(), (Number(curD.carriedForwardCashUpdatedAt) || 0) + 10);
      if (typeof enqueueDeltaSyncEvent === 'function') enqueueDeltaSyncEvent('UPDATE_DAY_META', { farmName: appState.farmName, dayNumber: appState.currentDay, carriedForwardCash: curD.carriedForwardCash, carriedForwardCashUpdatedAt: curD.carriedForwardCashUpdatedAt });
      const inpEl = document.getElementById('inpCarriedForwardCash');
      if (inpEl) inpEl.value = fmtMoney(remToCarry);
      saveState(true);
      renderDailyView();
      showToast(`🔄 تم ترحيل باقي النقدية بالخزنة (${fmtInt(remToCarry)} ج.م) تلقائياً لليوم التالي ومطابقة الصندوق!`, '✅');
    });
  }

   Merchant Instant Auto-Suggest without arrow
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

    const candidates = (appState.merchants || []).map(m => ({ label: m.name, code: m.code }));
    const cleanedVal = cleanMerchantBaseName(val);
    const filtered = val
      ? candidates.filter(c =>
          c.label.includes(val) ||
          (cleanedVal && c.label.includes(cleanedVal)) ||
          String(c.code).includes(val)
        )
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

   Persist Sticky Price and Tip whenever edited by user
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

   =========================================================================
   SMART CUSTODY WATERFALL ENGINE (التوزيع المحاسبي التلقائي المتدرج للعهدة)
   1. سداد المديونية السابقة أولاً ⬅️ 2. سداد فاتورة اليوم ⬅️ 3. حساب الآجل تلقائياً
   =========================================================================
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
    const positivePrevDebt = roundMoney2(Math.max(0, rawPrevDebt));

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
        inpCreditSalesEl.value = hasValidW2 && totalWithTip > 0 ? fmtMoney(totalWithTip) : '';
      }
      updateLiveFormCalculation();
      if (!silent) {
        showToast('💡 أدخل مبلغ العهدة (نقدية أو تحويل) أولاً ليتم توزيعه تلقائياً على المديونية والفاتورة!', 'ℹ️');
      }
      return false;
    }

     احترام أي مبلغ سداد مديونية بتحويل بنكي (أو نقدي) أدخله المستخدم يدوياً في خانة تحصيل المديونيات إذا كانت قناة العهدة المقابلة = 0
    const manualDebtTr = custTr <= 0 ? roundMoney2(Math.max(0, parseNum(inpDebtTrEl?.value) || 0)) : 0;
    const manualDebtCash = custCash <= 0 ? roundMoney2(Math.max(0, parseNum(inpDebtCashEl?.value) || 0)) : 0;
    const effectivePrevDebtAfterManual = roundMoney2(Math.max(0, positivePrevDebt - manualDebtTr - manualDebtCash));

     الخطوة 1: سداد المديونية السابقة للمزرعة الحالية أولاً (وفي وضع سند تحصيل مديونية فقط، توجه العهدة بالكامل لسداد المديونية)
    const debtOnlyActive = isDebtCollectionOnlyMode();
    const allocDebtCash = custCash > 0
      ? (debtOnlyActive ? custCash : roundMoney2(Math.min(custCash, effectivePrevDebtAfterManual)))
      : manualDebtCash;
    const remCashAfterDebt = roundMoney2(Math.max(0, custCash - (custCash > 0 ? allocDebtCash : 0)));
    const remDebtNeeded = roundMoney2(Math.max(0, effectivePrevDebtAfterManual - (custCash > 0 ? allocDebtCash : 0)));
    const allocDebtTr = custTr > 0
      ? (debtOnlyActive ? custTr : roundMoney2(Math.min(custTr, remDebtNeeded)))
      : manualDebtTr;
    const remTrAfterDebt = roundMoney2(Math.max(0, custTr - (custTr > 0 ? allocDebtTr : 0)));

    if (inpDebtCashEl) inpDebtCashEl.value = allocDebtCash > 0 ? fmtMoney(allocDebtCash) : '';
    if (inpDebtTrEl) inpDebtTrEl.value = allocDebtTr > 0 ? fmtMoney(allocDebtTr) : '';
    if (custTr > 0 && allocDebtTr > 0 && custTrType && selDebtTrTypeEl) {
      selDebtTrTypeEl.value = custTrType;
    }

     الخطوة 2: توجيه المتبقي من العهدة لسداد فاتورة الوزنة الحالية (إذا تم إدخال الوزنة الثانية)
    let allocSalesCash = 0;
    let allocSalesTr = 0;
    let remCredit = 0;

    if (hasValidW2 && totalWithTip > 0) {
      allocSalesCash = roundMoney2(Math.min(remCashAfterDebt, totalWithTip));
      const remInvoiceAfterCash = roundMoney2(Math.max(0, totalWithTip - allocSalesCash));
      allocSalesTr = roundMoney2(Math.min(remTrAfterDebt, remInvoiceAfterCash));
      remCredit = roundMoney2(Math.max(0, totalWithTip - allocSalesCash - allocSalesTr));

      if (inpCashSalesEl) inpCashSalesEl.value = allocSalesCash > 0 ? fmtMoney(allocSalesCash) : '';
      if (inpTrSalesEl) inpTrSalesEl.value = allocSalesTr > 0 ? fmtMoney(allocSalesTr) : '';
      if (allocSalesTr > 0 && custTrType && selTrSalesTypeEl) {
        selTrSalesTypeEl.value = custTrType;
      }
      if (inpCreditSalesEl) inpCreditSalesEl.value = remCredit > 0 ? fmtMoney(remCredit) : '0';
    } else {
       لم تُدخل الوزنة الثانية بعد (السيارة تحت التحميل - وزنة 1)
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

   Trigger automatic waterfall distribution when Custody fields or Weight/Price/Merchant change (if chkAutoDistributeCustody is checked)
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

   مستمعات خيارات تثبيت الجداول الـ 12 (رؤوس الجداول، الإجماليات السفلية، الأعمدة اليمنى، أعمدة الإجراءات اليسرى)
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

   أزرار التحكم في وضع شاشة المندوب المبسط (Lite Field Mode)
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

   تفويض أحداث شريط البطاقات الأفقية للوزنات المؤقتة في وضع المندوب
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

   تفويض أحداث بطاقات سجل حركات البيع المسجلة في وضع المندوب
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

   تحديث بطاقات وضع المندوب عند البحث السريع
  const inpSearchDailyLite = document.getElementById('inpFilterDailySales');
  if (inpSearchDailyLite) {
    inpSearchDailyLite.addEventListener('input', () => {
      if (isLiteFieldModeEffective()) {
        const d = appState.currentDay || 1;
        renderLiteFieldModeComponents(d, computeDaySummary(d), hasPermission('sales') && !isDayLocked(d), isDayLocked(d));
      }
    });
  }

   أحداث أيقونة وشريط البحث السريع في سيارات تحت التحميل بانتظار الوزنة 2 (وضع المندوب)
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

   تفعيل التنقل السريع بزر Enter بين حقول الميزان والبيع (وزنة 1 ⬅️ وزنة 2 ⬅️ نقدي مبيعات ⬅️ باقي الفاتورة آجل)
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
          const hasSubCarNum = /\d+/.test(curVal) && resolveMerchantCode(curVal) > 0;
          if (firstPick && curVal && !hasSubCarNum && !appState.merchants.some(m => m.name === curVal)) {
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

       1) وزنة 1 ⬅️ وزنة 2
      if (fieldId === 'inpW1') {
        updateLiveFormCalculation();
        focusAndSelectField('inpW2');
        return;
      }

       2) وزنة 2 ⬅️ التحقق من السعر أولاً (إذا كان فارغاً ينتقل للسعر)، ثم توزيع العهدة أو الانتقال لنقدي المبيعات
      if (fieldId === 'inpW2') {
        const w1 = Math.max(0, parseNum(document.getElementById('inpW1').value) || 0);
        const w2 = Math.max(0, parseNum(document.getElementById('inpW2').value) || 0);
        if (w2 > 0 && w2 < w1) {
          updateLiveFormCalculation();
          showToast('⚠️ الوزنة الثانية (القائم) يجب أن تكون أكبر من أو تساوي الوزنة الأولى!', '⚠️');
          return;
        }
        const curPrice = parseNum(document.getElementById('inpPrice')?.value) || 0;
        if (curPrice <= 0) {
          updateLiveFormCalculation();
          focusAndSelectField('inpPrice');
          showToast('💡 يرجى كتابة (السعر ج.م / كجم) أولاً!', '💰');
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

       3) نقدي مبيعات ⬅️ باقي الفاتورة آجل (حساب تلقائي + تركيز على حقل الآجل)
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

       4) باقي الفاتورة آجل ⬅️ حفظ الحركة النهائية (أو حفظ مؤقت إذا كانت وزنة 1 فقط)
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

   حفظ مؤقت للوزنة الأولى والبيانات لحين استكمال الوزنة الثانية
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
    const recalledPrice = Number(item.price) > 0 ? Number(item.price) : (Number(appState.defaultPrice) > 0 ? Number(appState.defaultPrice) : 0);
    document.getElementById('inpPrice').value = recalledPrice > 0 ? fmtMoney(recalledPrice) : '';
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

  let pendingPriceActionMode = '';

  function openAskMissingPriceModal(actionMode = 'pending', merchantName = '') {
    pendingPriceActionMode = actionMode;
    const modal = document.getElementById('askMissingPriceModal');
    const subEl = document.getElementById('askMissingPriceModalSub');
    const inpModalPrice = document.getElementById('inpModalMissingPrice');
    if (subEl) {
      const actionLabel = actionMode === 'pending' ? 'حفظ الوزنة الأولى مؤقتاً' : 'الحفظ النهائي للفاتورة';
      subEl.textContent = `لم يتم كتابة السعر للتاجر (${merchantName || 'الحالي'}). يرجى إدخال سعر الكيلو (ج.م / كجم) لإتمام (${actionLabel}):`;
    }
    if (modal) {
      modal.classList.remove('hidden');
      if (inpModalPrice) {
        inpModalPrice.value = Number(appState.defaultPrice) > 0 ? fmtMoney(appState.defaultPrice) : '';
        setTimeout(() => {
          try {
            inpModalPrice.focus();
            inpModalPrice.select();
          } catch (e) {}
        }, 60);
      }
    } else {
      focusAndSelectField('inpPrice');
    }
    showToast('💰 يرجى إدخال سعر الكيلو (ج.م / كجم) أولاً لإتمام الحفظ!', '⚠️');
  }

  function closeAskMissingPriceModal(focusMainPriceInput = false) {
    const modal = document.getElementById('askMissingPriceModal');
    if (modal) modal.classList.add('hidden');
    if (focusMainPriceInput) {
      const inpPriceEl = document.getElementById('inpPrice');
      if (inpPriceEl) {
        inpPriceEl.classList.add('ring-4', 'ring-amber-400', 'border-amber-500');
        setTimeout(() => {
          inpPriceEl.classList.remove('ring-4', 'ring-amber-400', 'border-amber-500');
        }, 2500);
      }
      focusAndSelectField('inpPrice');
    }
  }

  const askPriceFormEl = document.getElementById('askMissingPriceForm');
  if (askPriceFormEl) {
    askPriceFormEl.addEventListener('submit', (e) => {
      e.preventDefault();
      const inpModalPrice = document.getElementById('inpModalMissingPrice');
      const priceVal = parseNum(inpModalPrice ? inpModalPrice.value : 0);
      if (priceVal <= 0) {
        showToast('⚠️ يرجى كتابة سعر كيلو صحيح أكبر من صفر!', '⚠️');
        if (inpModalPrice) inpModalPrice.focus();
        return;
      }
      const mainPriceInp = document.getElementById('inpPrice');
      if (mainPriceInp) {
        mainPriceInp.value = fmtMoney(priceVal);
      }
      appState.defaultPrice = priceVal;
      updateLiveFormCalculation();
      const modeToResume = pendingPriceActionMode;
      pendingPriceActionMode = '';
      closeAskMissingPriceModal(false);
      if (modeToResume === 'pending') {
        const btnPend = document.getElementById('btnSavePendingW1');
        if (btnPend) btnPend.click();
      } else if (modeToResume === 'final') {
        const btnFinal = document.getElementById('btnSaveSale');
        if (btnFinal) btnFinal.click();
      }
    });
  }

  const btnCancelMissingPriceEl = document.getElementById('btnCancelMissingPriceModal');
  if (btnCancelMissingPriceEl) {
    btnCancelMissingPriceEl.addEventListener('click', () => {
      pendingPriceActionMode = '';
      closeAskMissingPriceModal(true);
    });
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
    const scaleConflict = [
      ...(dayObj.sales || []).filter(x => !isRecordDebtOnlyVoucher(x)),
      ...(dayObj.pendingSales || [])
    ].find(x =>
      x.id !== activeRecalledPendingId && Number(x.scaleNo) > 0 && Number(x.scaleNo) === enteredScale
    );
    if (scaleConflict) {
      const nextFree = getNextSequentialScaleNo();
      showToast(`⚠️ مسلسل الميزان (${enteredScale}) محجوز بالفعل للتاجر (${scaleConflict.merchant})! تم حجز المسلسل التلقائي (${nextFree}).`, '⚠️');
      enteredScale = nextFree;
      document.getElementById('inpScaleNo').value = enteredScale;
    }

    const enteredPrice = parseNum(document.getElementById('inpPrice').value);
    if (enteredPrice <= 0) {
      openAskMissingPriceModal('pending', mName);
      return;
    }
    const enteredTip = parseNum(document.getElementById('inpTip').value) || 0;

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
    if (typeof enqueueDeltaSyncEvent === 'function') enqueueDeltaSyncEvent('UPSERT_PENDING', { ...pendingObj, dayNum: appState.currentDay, farmName: appState.farmName });
    else dayObj.pendingSales.push(pendingObj);
    if (typeof enqueueDeltaSyncEvent === 'function') enqueueDeltaSyncEvent('UPSERT_PENDING', { ...pendingObj, dayNum: appState.currentDay, farmName: appState.farmName });
    dayObj.pendingSales = sortSalesListByScaleNo(dayObj.pendingSales);

    cancelOrClearCurrentSaleEntry(false);
    saveState(true);
    renderAll();
    showToast(`تم حجز مسلسل الميزان رقم (${enteredScale}) للتاجر (${mName}) وحفظ ترتيبه في جدول حركات البيع المسجلة (وزنة أولى: ${fmtMoney(w1Val)} كجم)!`, '⏳');
  });

   استرجاع أو حذف سيارة محفوظة مؤقتاً (وزنة أولى)
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

   Save or Update Final Sale Entry (Requires Weight 2!)
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
    const enteredScale = Number(document.getElementById('inpScaleNo').value) ||
      (isStandaloneDebtVoucher ? getNextSequentialVoucherNo() : getNextSequentialScaleNo());

    if (isStandaloneDebtVoucher) {
      const voucherConflict = (daySales || []).find(x => {
        if (editId && x.id === editId) return false;
        if (!isRecordDebtOnlyVoucher(x)) return false;
        const xNum = Number(x.voucherNo || x.scaleNo) || 0;
        if (String(x.merchant || '').trim() === mName && xNum === enteredScale) return false;
        return xNum > 0 && xNum === enteredScale;
      });
      if (voucherConflict) {
        const nextFreeV = getNextSequentialVoucherNo();
        showToast(`⚠️ رقم السند (${enteredScale}) محجوز بالفعل للتاجر (${voucherConflict.merchant})! تم وضع رقم السند المتاح (${nextFreeV}).`, '⚠️');
        document.getElementById('inpScaleNo').value = nextFreeV;
        document.getElementById('inpScaleNo').focus();
        return;
      }
    } else {
      const scaleConflict = [
        ...(daySales || []).filter(x => !isRecordDebtOnlyVoucher(x)),
        ...(dayObj.pendingSales || [])
      ].find(x => {
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
    }

    const enteredPrice = isStandaloneDebtVoucher ? 0 : (parseNum(document.getElementById('inpPrice').value) || 0);
    if (!isStandaloneDebtVoucher && enteredPrice <= 0) {
      openAskMissingPriceModal('final', mName);
      return;
    }
    const enteredTip = isStandaloneDebtVoucher ? 0 : (parseNum(document.getElementById('inpTip').value) || 0);

    if (isStandaloneDebtVoucher) {
      appState.lastVoucherNo = Math.max(Number(appState.lastVoucherNo) || 0, enteredScale);
    } else {
      if (enteredPrice > 0) {
        appState.defaultPrice = enteredPrice;
        appState.defaultTip = enteredTip;
      }
      appState.lastScaleNo = Math.max(Number(appState.lastScaleNo) || 0, enteredScale);
    }

    const existingSaleForAudit = editId ? daySales.find(x => x.id === editId) : null;
    const recalledPendForAudit = (!isStandaloneDebtVoucher && !existingSaleForAudit && Array.isArray(dayObj.pendingSales))
      ? dayObj.pendingSales.find(pItem =>
          (activeRecalledPendingId && pItem.id === activeRecalledPendingId) ||
          (String(pItem.merchant || '').trim() === mName && Number(pItem.scaleNo) > 0 && Number(pItem.scaleNo) === enteredScale)
        )
      : null;
    const candidateSaleFields = {
      entryMode: isStandaloneDebtVoucher ? 'debt_only' : 'sale',
      merchant: mName,
      scaleNo: enteredScale,
      voucherNo: isStandaloneDebtVoucher ? enteredScale : 0,
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
      if (typeof enqueueDeltaSyncEvent === 'function') enqueueDeltaSyncEvent('UPSERT_SALE', { ...rowObj, dayNum: appState.currentDay, farmName: appState.farmName });
      dayObj.sales = sortSalesListByScaleNo(daySales);
      showToast(
        isStandaloneDebtVoucher
          ? `تم تحديث سند تحصيل مديونية التاجر (${mName}) برقم سند (${enteredScale}) في آخر الجدول 💵`
          : `تم تحديث حركة التاجر (${mName}) مع حفظ ترتيبه بمسلسل ميزان (${enteredScale})`
      );
    } else {
      if (daySales.length >= 45) {
        showToast('وصلت للحد الأقصى (45 حركة بيع في اليوم الواحد)', '⚠️');
        return;
      }
      daySales.push(rowObj);
      if (typeof enqueueDeltaSyncEvent === 'function') enqueueDeltaSyncEvent('UPSERT_SALE', { ...rowObj, dayNum: appState.currentDay, farmName: appState.farmName });
      dayObj.sales = sortSalesListByScaleNo(daySales);
      showToast(
        isStandaloneDebtVoucher
          ? `تم تسجيل سند تحصيل مديونية للتاجر (${mName}) برقم سند مستقل (${enteredScale}) ووضعه في آخر الجدول 💵`
          : `تم تسجيل حركة (${mName}) في ترتيبها المحجوز بمسلسل ميزان (${enteredScale})`
      );
    }

     إزالة السيارة تلقائياً من قائمة (سيارات محفوظة مؤقتاً - وزنة أولى) فور إتمام الوزنة الثانية والحفظ النهائي (لحركات الميزان فقط)!
    const curDayObj = appState.days[appState.currentDay];
    if (!isStandaloneDebtVoucher && curDayObj && Array.isArray(curDayObj.pendingSales) && curDayObj.pendingSales.length > 0) {
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

   Edit / Delete / Recall Sale Row Delegation (Protected by Sales Permission)
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
      document.getElementById('inpScaleNo').value = (compRow.isDebtCollectionOnly ? (row.voucherNo || row.scaleNo) : row.scaleNo) || '';
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

   Daily sales search handled by universal Excel filter bindings below

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

   Add or Edit Daily Expense / Bonus
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
        if (typeof enqueueDeltaSyncEvent === 'function') enqueueDeltaSyncEvent('UPSERT_EXPENSE', { ...dayExps[idx], dayNum: appState.currentDay, farmName: appState.farmName });
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
    const expFullObj = {
      id: newExpId,
      ...newExpAuditMeta,
      category,
      desc,
      recipient,
      amount
    };
    dayExps.push(expFullObj);
    if (typeof enqueueDeltaSyncEvent === 'function') enqueueDeltaSyncEvent('UPSERT_EXPENSE', { ...expFullObj, dayNum: appState.currentDay, farmName: appState.farmName });
    
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

   Edit or Delete Expense Row (Protected by Expenses Permission)
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

   Open specific day from Dashboard Table (auto-adding to visibleDays if needed)
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

   Add or Edit Base Merchant + Delete Merchant
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
        if (typeof enqueueDeltaSyncEvent === 'function') enqueueDeltaSyncEvent('UPSERT_MERCHANT', mObj);
         Update sales rows that used oldName in active farm and across all archived farms
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
      if (excelTableState && excelTableState.merch) {
        excelTableState.merch.searchQuery = '';
        excelTableState.merch.colFilters = {};
      }
      const inpSearchM = document.getElementById('inpMerchQuickSearch');
      if (inpSearchM) inpSearchM.value = '';
      const code = ensureMerchantExists(name);
      appState.merchantsViewFilter = 'all';
      showToast(`✅ تم تكويد التاجر (${name}) بالكود الموحد (${code}) وإدراجه في الدليل وقائمة الاقتراحات`);
    }
    document.getElementById('inpNewMerchantBase').value = '';
    saveState(true);
    renderAll(true);
  });

   Start Screen Option 1: Connect Cloud Webhook URL & Pull Existing Farm Immediately
  const btnForceSyncCloud = document.getElementById('btnForceSyncFromCloud');
  const inpForceCloudUrl = document.getElementById('inpForceCloudWebhookUrl');
  const forceCloudStatusEl = document.getElementById('forceCloudSyncStatusMsg');

  async function handleStartScreenCloudSync() {
    if (!inpForceCloudUrl) return;
    const enteredUrl = (inpForceCloudUrl.value || '').trim();
    if (!enteredUrl || !enteredUrl.startsWith('http')) {
      if (forceCloudStatusEl) {
        forceCloudStatusEl.textContent = '⚠️ يرجى لصق رابط السحابة الصحيح (يبدأ بـ https:) أولاً!';
        forceCloudStatusEl.className = 'p-2.5 rounded-xl text-xs font-extrabold text-center bg-amber-100 text-amber-950 border border-amber-400';
        forceCloudStatusEl.classList.remove('hidden');
      }
      showToast('⚠️ يرجى لصق رابط السحابة أولاً!', '⚠️');
      inpForceCloudUrl.focus();
      return;
    }
    const isFb = enteredUrl.includes('firebaseio.com') || enteredUrl.includes('firebasedatabase.app');
    if (!isFb && enteredUrl.includes('script.google.com') && !enteredUrl.endsWith('/exec')) {
      if (forceCloudStatusEl) {
        forceCloudStatusEl.textContent = '❌ خطأ في الرابط: رابط Google Apps Script يجب أن ينتهي بـ /exec';
        forceCloudStatusEl.className = 'p-2.5 rounded-xl text-xs font-extrabold text-center bg-rose-100 text-rose-900 border border-rose-400';
        forceCloudStatusEl.classList.remove('hidden');
      }
      showToast('❌ رابط Google Apps Script يجب أن ينتهي بـ /exec', '❌');
      inpForceCloudUrl.focus();
      return;
    }
    if (!navigator.onLine) {
      if (forceCloudStatusEl) {
        forceCloudStatusEl.textContent = '🟠 لا يوجد اتصال بالإنترنت حالياً للسحب من السحابة!';
        forceCloudStatusEl.className = 'p-2.5 rounded-xl text-xs font-extrabold text-center bg-amber-100 text-amber-950 border border-amber-400';
        forceCloudStatusEl.classList.remove('hidden');
      }
      showToast('🟠 لا يوجد اتصال بالإنترنت حالياً!', '🟠');
      return;
    }

    applyCloudWebhookUrlFromStartScreen(enteredUrl);
    appState.hasLocalEdits = false;
    appState.factoryZeroWipeAt = 0;
    appState.farmResetAt = 0;
    appState.deletedIds = { sales: [], pendingSales: [], expenses: [], merchants: [], users: [], farms: [] };
    appState.deletedTimestamps = { sales: {}, pendingSales: {}, expenses: {}, merchants: {}, users: {}, farms: {} };

    if (btnForceSyncCloud) btnForceSyncCloud.disabled = true;
    if (forceCloudStatusEl) {
      forceCloudStatusEl.textContent = '⏳ جاري الاتصال بالسحابة وسحب المزرعة والتجار والحركات...';
      forceCloudStatusEl.className = 'p-2.5 rounded-xl text-xs font-extrabold text-center bg-sky-100 text-sky-900 border border-sky-300';
      forceCloudStatusEl.classList.remove('hidden');
    }

    const pulled = await pullDatabaseFromCloud(true, true);
    if (btnForceSyncCloud) btnForceSyncCloud.disabled = false;

    const activeFarmNow = String(appState.farmName ?? '').trim();
    if (pulled && activeFarmNow) {
      if (forceCloudStatusEl) {
        forceCloudStatusEl.classList.add('hidden');
      }
      saveState(false);
      startLiveRealtimeSyncEngine();
      checkAndEnforceNewFarmCreationModal();
      renderAll(true);
      showToast(`✅ تم ربط السحابة واسترجاع مزرعة (${activeFarmNow}) بجميع بياناتها بنجاح!`, '☁️');
    } else {
      saveState(false);
      startLiveRealtimeSyncEngine();
      if (forceCloudStatusEl) {
        forceCloudStatusEl.textContent = '✅ تم حفظ وربط رابط السحابة بنجاح! السحابة فارغة حالياً ولا توجد بها مزرعة مسجلة بعد — اكتب اسم المزرعة الجديدة في الخيار (2) بالأسفل واضغط (إنشاء المزرعة) ليتم رفعها للسحابة فوراً.';
        forceCloudStatusEl.className = 'p-2.5 rounded-xl text-xs font-extrabold text-center bg-emerald-100 text-emerald-950 border border-emerald-400';
        forceCloudStatusEl.classList.remove('hidden');
      }
      const inpNewFarm = document.getElementById('inpForceNewFarmName');
      if (inpNewFarm) inpNewFarm.focus();
      showToast('✅ تم ربط رابط السحابة! اكتب اسم المزرعة الجديدة بالأسفل لبدء الدورة ورفعها للسحابة.', '☁️');
    }
  }

  if (btnForceSyncCloud) {
    btnForceSyncCloud.addEventListener('click', handleStartScreenCloudSync);
  }
  if (inpForceCloudUrl) {
    inpForceCloudUrl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleStartScreenCloudSync();
      }
    });
  }

   Start Screen Option 3: Quick Restore from JSON / Excel Backup File
  const btnForceRestoreFile = document.getElementById('btnForceRestoreBackupFile');
  if (btnForceRestoreFile) {
    btnForceRestoreFile.addEventListener('click', () => {
      const fileInp = document.getElementById('fileImportXlsx');
      if (fileInp) fileInp.click();
    });
  }

   Start Screen Option 2: Mandatory New Farm Creation Modal Submit Handler
  const forceFarmForm = document.getElementById('forceCreateFarmForm');
  if (forceFarmForm) {
    forceFarmForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const inp = document.getElementById('inpForceNewFarmName');
      const newName = (inp ? inp.value : '').trim();
      if (!newName) {
        showToast('⚠️ يرجى كتابة اسم المزرعة الجديدة أولاً!', '⚠️');
        if (inp) inp.focus();
        return;
      }
       إذا قام المستخدم بلصق رابط السحابة في الخيار (1) أعلاه ثم كتب اسم المزرعة وضغط إنشاء، نحفظ رابط السحابة أيضاً ونرفع المزرعة الجديدة إليها فوراً
      if (inpForceCloudUrl && inpForceCloudUrl.value && inpForceCloudUrl.value.trim().startsWith('http')) {
        applyCloudWebhookUrlFromStartScreen(inpForceCloudUrl.value.trim());
      }
      const nowCreateTs = Math.max(getSyncedNow() + 1000, (Number(appState.factoryZeroWipeAt) || 0) + 1000);
      const emptyDays = {};
      for (let d = 1; d <= 10; d++) {
        emptyDays[d] = {
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
      appState.farmName = newName;
      appState.lastFarmSwitchAt = nowCreateTs;
      appState.farmResetAt = 0;
      appState.factoryZeroWipeAt = 0;
      appState.hasLocalEdits = true;
      appState.currentDay = 1;
      appState.visibleDays = [1];
      appState.days = emptyDays;
      unrecordDeletedItem('farms', newName);
      if (!appState.farmsArchive || typeof appState.farmsArchive !== 'object') {
        appState.farmsArchive = {};
      }
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
      if (inp) inp.value = '';
      if (forceCloudStatusEl) forceCloudStatusEl.classList.add('hidden');
      checkAndEnforceNewFarmCreationModal();
      saveState(true, true);
      startLiveRealtimeSyncEngine();
      renderAll(true);
      showToast(`✅ تم إنشاء وفتح مزرعة (${newName}) بنجاح — يمكنك الآن تكويد التجار وتسجيل حركات البيع!`, '🏡');
    });
  }

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

   =======================================================================
   EXCEL SORT & FILTER POPOVER INTERACTIVE HANDLERS (FOR DASH & MERCH)
   =======================================================================
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

     Position popover near trigger button within viewport bounds
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

   Wire up Quick Search & Clear Filter buttons for all other 8 tables
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

   Global delegation for opening Merchant Drill-Down Modal from any table ([data-drill-merchant])
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
      const waUrl = `https:wa.me/?text=${encodeURIComponent(txt)}`;
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

   Quick Jump & Export/Share Handlers for Full Farm Cumulative Trial Balance in Executive Summary
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
      const fName = appState.farmName || 'مزرعة جديدة';
      exportPrintTargetAsImageOrPdf('farmTrialBalance', 'png', `ميزان_مراجعة_المزرعة_الكامل_${fName}`);
    });
  }
  const btnExpFarmTbPdf = document.getElementById('btnExportFarmTbPdf');
  if (btnExpFarmTbPdf) {
    btnExpFarmTbPdf.addEventListener('click', () => {
      const fName = appState.farmName || 'مزرعة جديدة';
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

   Copy WhatsApp Daily Summary
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

   Export Excel Buttons & Full JSON Backup / Restore Buttons
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

   Sync Button (Smart Sync: pulls if fresh browser without local edits, pushes if local edits exist)
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
      const hadMeaningfulLocalEdits = hasMeaningfulLocalData();
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

   Save Webhook URL & Smart Sync (Pulls from cloud first if this browser has no local edits, preventing accidental overwrite!)
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
    const hadMeaningfulLocalEdits = hasMeaningfulLocalData();
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

   Pre-fetch and cache external style.css, vendor-loader.js, excel-template.js & the 6 modular ./js/*.js files (v73)
  const MODULAR_JS_SCRIPTS_ORDER = [
    './js/core-state.js?v=73',
    './js/accounting.js?v=73',
    './js/storage-sync.js?v=73',
    './js/excel-engine.js?v=73',
    './js/print-export.js?v=73',
    './js/ui-controllers.js?v=73'
  ];

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
      const vendorScript = document.querySelector('script[src*="vendor-loader.js"]');
      if (vendorScript && !window.__cachedExternalVendorLoaderJs) {
        const resVendor = await fetch(vendorScript.getAttribute('src'), { cache: 'no-store' });
        if (resVendor.ok) {
          window.__cachedExternalVendorLoaderJs = await resVendor.text();
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
      if (!window.__cachedExternalAppJs) {
        const domModScripts = Array.from(document.querySelectorAll('script[src*="js/"]'));
        const urlsToFetch = domModScripts.length > 0
          ? domModScripts.map(s => s.getAttribute('src'))
          : MODULAR_JS_SCRIPTS_ORDER;
        const chunks = [];
        for (const u of urlsToFetch) {
          try {
            const r = await fetch(u, { cache: 'no-store' });
            if (r.ok) {
              chunks.push(await r.text());
            }
          } catch (err) {}
        }
        if (chunks.length > 0) {
          window.__cachedExternalAppJs = chunks.join('\n\n');
        } else {
          const legacyAppScript = document.querySelector('script[src*="app.js"]');
          if (legacyAppScript) {
            const resJs = await fetch(legacyAppScript.getAttribute('src'), { cache: 'no-store' });
            if (resJs.ok) window.__cachedExternalAppJs = await resJs.text();
          }
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

   Generate clean self-contained HTML for Google Sites Embed (inlineAllAssets = true) or modular index.html for GitHub Pages (v73)
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

     Remove any runtime-injected dynamic vendor scripts (blob: or data-dynamic-vendor-script) from cloned <head>
    cloneDoc.querySelectorAll('script[data-dynamic-vendor-script="1"], script[src^="blob:"]').forEach(s => s.remove());

     1. Handle CSS & JS assets:
        - When inlineAllAssets = true (for Google Sites Embed / 1MB Single-File HTML), inline ./style.css, ./vendor/vendor-loader.js, ./excel-template.js, and all 6 modular ./js/*.js files!
        - When inlineAllAssets = false (for GitHub Pages lightweight index.html download), keep external ./style.css and the 6 ./js/*.js links clean.
    const extStyleLink = cloneDoc.querySelector('link[href*="style.css"]');
    const extVendorScript = cloneDoc.querySelector('script[src*="vendor-loader.js"]');
    const extModularScripts = Array.from(cloneDoc.querySelectorAll('script[src*="js/"]'));
    const extLegacyAppScript = cloneDoc.querySelector('script[src*="app.js"]');

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
      if (extVendorScript) {
        const vendorText = window.__cachedExternalVendorLoaderJs || '';
        if (vendorText) {
          const inlineVendorScript = document.createElement('script');
          inlineVendorScript.id = 'bundledGoogleSitesVendorLoaderJs';
          inlineVendorScript.textContent = vendorText;
          extVendorScript.replaceWith(inlineVendorScript);
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
      if (extModularScripts.length > 0) {
        const jsText = window.__cachedExternalAppJs || '';
        if (jsText) {
          const inlineScript = document.createElement('script');
          inlineScript.id = 'bundledGoogleSitesAppJs';
          inlineScript.textContent = jsText;
          extModularScripts[0].replaceWith(inlineScript);
          extModularScripts.slice(1).forEach(s => s.remove());
        } else if (window.location.href.startsWith('http')) {
          extModularScripts.forEach(s => {
            s.setAttribute('src', new URL(s.getAttribute('src'), window.location.href).href);
          });
        }
      } else if (extLegacyAppScript) {
        const jsText = window.__cachedExternalAppJs || '';
        if (jsText) {
          const inlineScript = document.createElement('script');
          inlineScript.id = 'bundledGoogleSitesAppJs';
          inlineScript.textContent = jsText;
          extLegacyAppScript.replaceWith(inlineScript);
        }
      }
       Remove Tailwind CDN runtime-generated style tags ONLY if we still have the Tailwind CDN script in <head> so the copied HTML stays compact and fast
      if (cloneDoc.querySelector('script[src*="tailwindcss"]')) {
        cloneDoc.querySelectorAll('head style:not(#bundledGoogleSitesStyleCss):not(#criticalPrintStyles):not(#criticalMobileWeighbridgeStyles)').forEach(st => {
          if ((st.textContent || '').includes('--tw-')) st.remove();
        });
      }
    } else {
      if (extStyleLink) {
        cloneDoc.querySelectorAll('head style:not(#criticalPrintStyles):not(#criticalMobileWeighbridgeStyles)').forEach(st => st.remove());
      }
       If opened from a single-file bundle and user clicks Download Lightweight GitHub HTML, restore the modular external script tags cleanly
      const bundledAppEl = cloneDoc.querySelector('#bundledGoogleSitesAppJs');
      if (bundledAppEl) {
        const frag = document.createDocumentFragment();
        MODULAR_JS_SCRIPTS_ORDER.forEach(srcPath => {
          const sc = document.createElement('script');
          sc.setAttribute('src', srcPath);
          frag.appendChild(sc);
        });
        bundledAppEl.replaceWith(frag);
      }
      const bundledTplEl = cloneDoc.querySelector('#bundledGoogleSitesExcelTemplateJs');
      if (bundledTplEl) {
        const scTpl = document.createElement('script');
        scTpl.setAttribute('src', './excel-template.js?v=73');
        bundledTplEl.replaceWith(scTpl);
      }
      const bundledStyleEl = cloneDoc.querySelector('#bundledGoogleSitesStyleCss');
      if (bundledStyleEl) {
        const lnk = document.createElement('link');
        lnk.setAttribute('rel', 'stylesheet');
        lnk.setAttribute('href', './style.css?v=73');
        bundledStyleEl.replaceWith(lnk);
      }
    }

     2. Embed the Encrypted Webhook Vault (bound to login credentials) cleanly in <meta> and <script id="embeddedWebhookConfigScript">
     لا نضع الرابط النصي المكشوف ولا نثبت اسم المزرعة في الكود حتى يُفك تشفير الرابط بكلمة المرور ويُسحب اسم المزرعة الحقيقي من السحابة تلقائياً
    const vaultTokens = url ? buildEncryptedWebhookVaultForUsers(url, appState.users) : getEmbeddedEncryptedVaultList();
    const vaultJoined = vaultTokens.join('|');
    const vaultJson = JSON.stringify(vaultTokens);

    let metaNode = cloneDoc.querySelector('#metaEmbeddedCloudWebhookUrl');
    if (!metaNode) {
      metaNode = document.createElement('meta');
      metaNode.id = 'metaEmbeddedCloudWebhookUrl';
      metaNode.setAttribute('name', 'cloud-webhook-url');
      headEl.insertBefore(metaNode, headEl.firstChild);
    }
    metaNode.setAttribute('content', '');

    let metaVaultNode = cloneDoc.querySelector('#metaEmbeddedEncryptedWebhookVault');
    if (!metaVaultNode) {
      metaVaultNode = document.createElement('meta');
      metaVaultNode.id = 'metaEmbeddedEncryptedWebhookVault';
      metaVaultNode.setAttribute('name', 'encrypted-webhook-vault');
      headEl.insertBefore(metaVaultNode, headEl.firstChild);
    }
    metaVaultNode.setAttribute('content', vaultJoined);

    let metaFarmNode = cloneDoc.querySelector('#metaEmbeddedDefaultFarmName');
    if (!metaFarmNode) {
      metaFarmNode = document.createElement('meta');
      metaFarmNode.id = 'metaEmbeddedDefaultFarmName';
      metaFarmNode.setAttribute('name', 'default-farm-name');
      headEl.insertBefore(metaFarmNode, headEl.firstChild);
    }
    metaFarmNode.setAttribute('content', '');

    let cfgScript = cloneDoc.querySelector('#embeddedWebhookConfigScript');
    if (!cfgScript) {
      cfgScript = document.createElement('script');
      cfgScript.id = 'embeddedWebhookConfigScript';
      headEl.appendChild(cfgScript);
    }
    cfgScript.textContent = `\n     خزينة رابط المزامنة السحابية المشفرة والمربوطة بتسجيل الدخول (تُفك تلقائياً عند إدخال اسم المستخدم وكلمة المرور)\n    window.EMBEDDED_CLOUD_WEBHOOK_URL = '';\n    window.EMBEDDED_ENCRYPTED_WEBHOOK_VAULT = ${vaultJson};\n    window.EMBEDDED_DEFAULT_FARM_NAME = '';\n  `;

    const cloneInp = cloneDoc.querySelector('#inpCloudWebhookUrl');
    if (cloneInp) {
      cloneInp.setAttribute('value', '');
    }
    const cloneLoginVaultBadge = cloneDoc.querySelector('#loginEncryptedVaultBadge');
    if (cloneLoginVaultBadge) {
      cloneLoginVaultBadge.classList.toggle('hidden', vaultTokens.length === 0);
    }

     Hide the Google Sites code preview box in the cloned output
    const cloneGsPreview = cloneDoc.querySelector('#googleSitesEmbedCodePreviewBox');
    if (cloneGsPreview) {
      cloneGsPreview.classList.add('hidden');
    }
    const cloneGsTa = cloneDoc.querySelector('#txtGoogleSitesEmbedCodeOutput');
    if (cloneGsTa) {
      cloneGsTa.textContent = '';
      cloneGsTa.value = '';
    }

     3. Clear runtime-populated table bodies & dynamic containers so the template HTML is 100% clean
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

     4. Reset login overlay & default tab state in the cloned HTML so opening on any device starts cleanly
    const cloneLogin = cloneDoc.querySelector('#loginGatewayOverlay');
    if (cloneLogin) {
      cloneLogin.classList.remove('hidden');
      cloneLogin.removeAttribute('style');
    }
    const cloneForceCreateFarm = cloneDoc.querySelector('#forceCreateFarmOverlay');
    if (cloneForceCreateFarm) {
      cloneForceCreateFarm.classList.add('hidden');
    }
    const cloneForceUrl = cloneDoc.querySelector('#inpForceCloudWebhookUrl');
    if (cloneForceUrl) cloneForceUrl.setAttribute('value', '');
    const cloneLoginUrl = cloneDoc.querySelector('#inpLoginCloudWebhookUrl');
    if (cloneLoginUrl) cloneLoginUrl.setAttribute('value', '');
    const cloneForceStatus = cloneDoc.querySelector('#forceCloudSyncStatusMsg');
    if (cloneForceStatus) cloneForceStatus.classList.add('hidden');
    const cloneLoginStatus = cloneDoc.querySelector('#loginCloudSyncStatusMsg');
    if (cloneLoginStatus) cloneLoginStatus.classList.add('hidden');
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
    const hadMeaningfulLocalEdits = hasMeaningfulLocalData();
    await preloadExternalAssetsForGoogleSitesEmbed();
    const { rawHtml, url } = buildEmbeddedGoogleSitesHtml(true);

    copyTextToClipboardReliable(rawHtml);

     Show interactive Google Sites Embed Code Preview Box so user can also inspect/copy with 1 tap on any device
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

  const btnDlLightGithub = document.getElementById('btnDownloadLightweightGithubHtml');
  if (btnDlLightGithub) {
    btnDlLightGithub.addEventListener('click', async () => {
      const inpEl = document.getElementById('inpCloudWebhookUrl');
      const currentUrl = ((inpEl ? inpEl.value : '') || appState.webhookUrl || getEmbeddedWebhookUrl() || '').trim();
      if (!currentUrl || !currentUrl.startsWith('http')) {
        showToast('⚠️ يرجى لصق رابط السحابة في الخانة أعلاه أولاً لتشفيره وربطه بملف index.html!', '⚠️');
        if (inpEl) inpEl.focus();
        return;
      }
      appState.webhookUrl = currentUrl;
      updateEncryptedWebhookVaultUI();
      const hadMeaningfulLocalEdits = hasMeaningfulLocalData();
      const { rawHtml, url } = buildEmbeddedGoogleSitesHtml(false);
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
      const sizeKb = Math.round(rawHtml.length / 1024);
      showToast(`🔐📥 تم تحميل ملف index.html الخفيف (${sizeKb} KB) مدمجاً به رابط السحابة مشفراً بكلمة مرور الدخول! ارفعه على GitHub Pages مرة واحدة فقط.`, '🔐');
    });
  }

  document.getElementById('btnDownloadHtmlWithWebhook').addEventListener('click', async () => {
    const hadMeaningfulLocalEdits = hasMeaningfulLocalData();
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

   Smart Triple-Mode Reset Inline Box Handlers (#btnResetDemoData & #smartResetInlineBox)
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
    const fName = appState.farmName || 'مزرعة جديدة';
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

   Import Excel (.xlsx) or JSON Backup file (Full Two-Way Parser)
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

