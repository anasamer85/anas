// =========================================================================
// MOBILE COMPANION ENGINE (mobile-app.js — v52)
// =========================================================================
(function () {
  'use strict';
  let mobileActiveCardFilter = 'all';
  let mobilePendingDeleteConfirmId = '';

  function installSafeMobileDomGuard() {
    if (typeof document === 'undefined' || !document.body) return;
    let shimBox = document.getElementById('mobileAppJsCompatibilityShim');
    if (!shimBox) {
      shimBox = document.createElement('div');
      shimBox.id = 'mobileAppJsCompatibilityShim';
      shimBox.style.display = 'none';
      shimBox.setAttribute('aria-hidden', 'true');
      document.body.appendChild(shimBox);
    }
    const requiredIds = [
      'inpTopFarmName', 'inpSettingsFarmName', 'dailyFarmNameBadge', 'dashFarmNameTitle',
      'linkedExcelNameTxt', 'daySelectorContainer', 'currentDayDateInput', 'expDayTitle',
      'tbDayTitle', 'dayKpiTotalSales', 'dayKpiExpenses', 'dayKpiTransfers', 'dayTotalExpensesBadge',
      'tbPillar1', 'tbPillar2', 'tbPillar3', 'inpDeliveredCash', 'inpCarriedForwardCash', 'tbCashDiffBox',
      'btnSaveSale', 'btnSaveSaleText', 'btnSavePendingW1', 'btnCancelEditSale', 'btnCancelEditSaleText',
      'stickyBarNetWeight', 'stickyBarTotalInvoice', 'stickyBarRemCredit', 'btnStickyAutoCredit',
      'btnStickyDistributeCustody', 'mobileWeighbridgeActionBar'
    ];
    requiredIds.forEach(id => {
      if (!document.getElementById(id)) {
        const el = document.createElement('div');
        el.id = id;
        shimBox.appendChild(el);
      }
    });
  }
  installSafeMobileDomGuard();

  function renderMobileDayPicker() {
    const selDay = document.getElementById('selMobileCurrentDay');
    if (!selDay || typeof appState === 'undefined') return;
    const visDays = typeof getVisibleDays === 'function' ? getVisibleDays() : [1];
    const curDay = Number(appState.currentDay) || 1;
    selDay.innerHTML = visDays.map(d => {
      const dObj = (appState.days && appState.days[d]) || { dayNumber: d, dateLabel: `اليوم ${d}` };
      const summary = typeof computeDaySummary === 'function' ? computeDaySummary(d) : { countCars: 0 };
      const locked = typeof isDayLocked === 'function' && isDayLocked(d);
      const lbl = String(dObj.dateLabel || `اليوم ${d}`).trim();
      const shortLbl = lbl !== `اليوم ${d}` ? ` (${lbl})` : '';
      return `<option value="${d}" class="text-slate-900 font-bold" ${d === curDay ? 'selected' : ''}>${locked ? '🔒 ' : ''}يوم ${d}${shortLbl} — ${summary.countCars} سيارة</option>`;
    }).join('');
    if (visDays.length < 10 && typeof hasPermission === 'function' && hasPermission('sales')) {
      selDay.innerHTML += `<option value="__add_new_day__" class="text-emerald-800 font-extrabold">➕ فتح يوم جديد في الدورة...</option>`;
    }
  }

  function setMobileEntryModeUI(mode) {
    const isDebtOnly = mode === 'debt_only';
    const inpMode = document.getElementById('inpSaleEntryMode');
    if (inpMode) inpMode.value = isDebtOnly ? 'debt_only' : 'sale';

    const btnScale = document.getElementById('btnModeScaleSale');
    const btnDebt = document.getElementById('btnModeDebtCollectionOnly');
    if (btnScale && btnDebt) {
      if (isDebtOnly) {
        btnDebt.className = 'touch-btn py-2 px-2 rounded-lg bg-amber-400 text-slate-950 font-extrabold text-xs shadow transition flex items-center justify-center gap-1.5';
        btnScale.className = 'touch-btn py-2 px-2 rounded-lg text-slate-200 hover:bg-white/10 font-extrabold text-xs transition flex items-center justify-center gap-1.5';
      } else {
        btnScale.className = 'touch-btn py-2 px-2 rounded-lg bg-amber-400 text-slate-950 font-extrabold text-xs shadow transition flex items-center justify-center gap-1.5';
        btnDebt.className = 'touch-btn py-2 px-2 rounded-lg text-slate-200 hover:bg-white/10 font-extrabold text-xs transition flex items-center justify-center gap-1.5';
      }
    }

    const banner = document.getElementById('debtCollectionOnlyModeBanner');
    if (banner) banner.classList.toggle('hidden', !isDebtOnly);
    const weightsRow = document.getElementById('saleWeightsAndPriceRow');
    if (weightsRow) weightsRow.classList.toggle('hidden', isDebtOnly);
    const invCard = document.getElementById('currentInvoiceCollectionCard');
    if (invCard) invCard.classList.toggle('hidden', isDebtOnly);

    const kpiNetW = document.getElementById('kpiBoxNetWeight');
    const kpiTotTip = document.getElementById('kpiBoxTotalWithTip');
    const liveBanner = document.getElementById('saleLiveCalcBannerGrid');
    if (kpiNetW) kpiNetW.classList.toggle('hidden', isDebtOnly);
    if (kpiTotTip) kpiTotTip.classList.toggle('hidden', isDebtOnly);
    if (liveBanner) {
      liveBanner.className = isDebtOnly
        ? 'grid grid-cols-1 bg-teal-950 text-white p-2.5 rounded-2xl text-center shadow-inner'
        : 'grid grid-cols-3 gap-1.5 bg-blue-950 text-white p-2.5 rounded-2xl text-center shadow-inner';
    }

    const hdrIcon = document.getElementById('saleFormHeaderIcon');
    const hdrTitleTxt = document.getElementById('saleFormTitleActionText');
    const editId = (document.getElementById('editSaleId') && document.getElementById('editSaleId').value) || '';
    if (!editId && !activeRecalledPendingId) {
      if (hdrIcon) hdrIcon.textContent = isDebtOnly ? '💵' : '🚛';
      if (hdrTitleTxt) hdrTitleTxt.textContent = isDebtOnly ? 'تسجيل سند تحصيل مديونية' : 'تسجيل حركة جديدة';
    }

    const lblScale = document.getElementById('lblScaleOrVoucherNo');
    if (lblScale) {
      lblScale.innerHTML = isDebtOnly
        ? '🔢 رقم السند <span class="text-teal-700 text-[10px]">(تلقائي)</span>'
        : '🔢 رقم بون الميزان <span class="text-emerald-700 text-[10px]">(تلقائي)</span>';
    }
    const wrapCar = document.getElementById('wrapCarNoField');
    if (wrapCar) wrapCar.classList.toggle('hidden', isDebtOnly);

    if (isDebtOnly) {
      ['inpW1', 'inpW2', 'inpCashSales', 'inpTransferSales', 'inpCreditSales'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
      });
      const selTrSales = document.getElementById('selTransferSalesType');
      if (selTrSales) selTrSales.value = '';
    } else if (!editId && !activeRecalledPendingId) {
      if (typeof applyStickySaleDefaults === 'function') applyStickySaleDefaults();
    }

    if (typeof updateLiveFormCalculation === 'function') updateLiveFormCalculation();
    syncSmartPrimaryActionButton();
  }

  function renderMobilePendingSwipeCards() {
    const d = Number(appState.currentDay) || 1;
    const dayObj = (appState.days && appState.days[d]) || { pendingSales: [] };
    const dayLocked = typeof isDayLocked === 'function' && isDayLocked(d);
    const canEditSales = typeof hasPermission === 'function' && hasPermission('sales') && !dayLocked;
    const listContainer = document.getElementById('pendingCardsHorizontalList');
    const badge = document.getElementById('pendingWeighInsCountBadge');
    const searchInp = document.getElementById('inpFilterPendingSales');
    if (!listContainer) return;

    const rawPending = sortSalesListByScaleNo(dayObj.pendingSales || []);
    if (badge) badge.textContent = `${rawPending.length} سيارة`;
    const q = String((searchInp && searchInp.value) || '').trim().toLowerCase();
    const filteredPending = q
      ? rawPending.filter(item =>
          String(item.merchant || '').toLowerCase().includes(q) ||
          String(item.carNo || '').toLowerCase().includes(q) ||
          String(item.scaleNo || '').toLowerCase().includes(q)
        )
      : rawPending;

    if (rawPending.length === 0) {
      listContainer.innerHTML = `<div class="w-full py-2.5 px-3 text-center text-xs font-bold text-amber-900/80 bg-white/80 rounded-xl border border-dashed border-amber-300">لا توجد سيارات منتظرة حالياً — عند حفظ (وزنة 1 فارغ) ستظهر بطاقتها هنا للمسها واستكمال الوزنة الثانية فوراً.</div>`;
      return;
    }
    if (filteredPending.length === 0) {
      listContainer.innerHTML = `<div class="w-full py-2.5 px-3 text-center text-xs font-bold text-slate-600 bg-white rounded-xl border border-amber-300">لا توجد سيارة مؤقتة مطابقة للبحث</div>`;
      return;
    }

    listContainer.innerHTML = filteredPending.map(item => {
      const safeId = escXmlStr(item.id);
      const safeMerchant = escXmlStr(item.merchant || '-');
      const safeCar = escXmlStr(item.carNo || '-');
      const safeScale = escXmlStr(item.scaleNo || '-');
      const isCurrentlyRecalled = String(activeRecalledPendingId) === String(item.id);
      const custodyTotal = (Number(item.custodyCash) || 0) + (Number(item.custodyTransfer) || 0);

      return `
        <div class="pending-card-item rounded-2xl border-2 ${isCurrentlyRecalled ? 'border-emerald-600 bg-emerald-50 ring-2 ring-emerald-400' : 'border-amber-400 bg-white'} p-2.5 shadow-sm flex flex-col justify-between gap-2 transition">
          <div>
            <div class="flex items-center justify-between gap-1 border-b border-amber-200 pb-1">
              <span class="px-2 py-0.5 rounded-lg bg-amber-400 text-slate-950 text-[10px] font-extrabold">بون #${safeScale}</span>
              <span class="text-[10px] font-extrabold text-slate-600">سيارة: <strong class="text-slate-900">${safeCar}</strong></span>
            </div>
            <div class="font-extrabold text-slate-900 text-xs mt-1.5 truncate" title="${safeMerchant}">👤 ${safeMerchant}</div>
            <div class="flex items-center justify-between text-[11px] font-bold mt-1 bg-amber-50/90 px-2 py-1 rounded-lg border border-amber-200">
              <span class="text-amber-900">وزنة 1 (فارغ):</span><strong class="text-amber-950 font-extrabold">${fmtInt(item.w1)} كجم</strong>
            </div>
            ${custodyTotal > 0 ? `<div class="text-[10px] font-extrabold text-teal-900 mt-1">💼 عهدة مسجلة: ${fmtInt(custodyTotal)} ج.م</div>` : ''}
          </div>
          ${canEditSales ? `
            <div class="flex items-center gap-1.5 pt-1 border-t border-slate-100">
              <button type="button" data-mobile-recall-pending="${safeId}" class="flex-1 py-2 px-2.5 rounded-xl ${isCurrentlyRecalled ? 'bg-emerald-700 text-white' : 'bg-emerald-600 hover:bg-emerald-500 text-white'} font-extrabold text-xs shadow transition flex items-center justify-center gap-1"><span>🔄</span><span>${isCurrentlyRecalled ? 'قيد الاستكمال...' : 'استكمال وزنة 2'}</span></button>
              <button type="button" data-mobile-print-receipt="${safeId}" class="py-2 px-2 rounded-xl bg-indigo-100 hover:bg-indigo-200 text-indigo-900 font-extrabold text-xs" title="طباعة بون">🖨️</button>
              <button type="button" data-mobile-del-pending="${safeId}" class="py-2 px-2 rounded-xl bg-rose-100 hover:bg-rose-200 text-rose-800 font-extrabold text-xs" title="حذف">🗑️</button>
            </div>
          ` : `<div class="text-[10px] text-center font-bold text-slate-400">🔒 اليوم مقفل</div>`}
        </div>
      `;
    }).join('');
  }

  function syncSmartPrimaryActionButton() {
    const btnMain = document.getElementById('btnInlineSaveSale');
    const btnMainIcon = document.getElementById('btnInlineSaveSaleIcon');
    const btnMainTxt = document.getElementById('btnInlineSaveSaleText');
    const btnPend = document.getElementById('btnInlineSavePendingW1');
    const stateBadge = document.getElementById('mobileFormStateBadge');
    if (!btnMain || !btnMainTxt) return;

    const mode = (document.getElementById('inpSaleEntryMode') && document.getElementById('inpSaleEntryMode').value) || 'sale';
    const isDebtOnly = mode === 'debt_only';
    const editId = (document.getElementById('editSaleId') && document.getElementById('editSaleId').value) || '';
    const w1 = parseNum(document.getElementById('inpW1') ? document.getElementById('inpW1').value : 0);
    const w2 = parseNum(document.getElementById('inpW2') ? document.getElementById('inpW2').value : 0);

    if (stateBadge) {
      if (editId) {
        stateBadge.textContent = '✏️ تعديل حركة محفوظة';
        stateBadge.className = 'px-2.5 py-0.5 rounded-full bg-sky-400 text-slate-950 text-[11px] font-extrabold shadow';
        stateBadge.classList.remove('hidden');
      } else if (activeRecalledPendingId) {
        stateBadge.textContent = '🔄 استكمال وزنة 2 لسيارة محجوزة';
        stateBadge.className = 'px-2.5 py-0.5 rounded-full bg-amber-400 text-slate-950 text-[11px] font-extrabold shadow';
        stateBadge.classList.remove('hidden');
      } else {
        stateBadge.classList.add('hidden');
      }
    }

    if (isDebtOnly) {
      if (btnPend) btnPend.classList.add('hidden');
      btnMain.dataset.smartAction = 'final_submit';
      btnMain.className = 'touch-btn w-full py-3.5 px-4 rounded-2xl bg-teal-700 hover:bg-teal-600 text-white font-extrabold text-base shadow-lg border-2 border-teal-400 transition flex items-center justify-center gap-2';
      if (btnMainIcon) btnMainIcon.textContent = '💵';
      btnMainTxt.textContent = editId ? 'حفظ تعديل سند التحصيل 💵' : 'حفظ سند التحصيل 💵';
      return;
    }

    if (btnPend) btnPend.classList.remove('hidden');
    if (!editId && w1 > 0 && w2 === 0) {
      btnMain.dataset.smartAction = 'save_pending_w1';
      btnMain.className = 'touch-btn w-full py-3.5 px-4 rounded-2xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-extrabold text-base shadow-lg border-2 border-amber-600 transition flex items-center justify-center gap-2';
      if (btnMainIcon) btnMainIcon.textContent = '⏳';
      btnMainTxt.textContent = activeRecalledPendingId ? 'تحديث بيانات الوزنة الأولى المؤقتة ⏳' : 'حفظ مؤقت للوزنة الأولى (فارغ) ⏳';
    } else {
      btnMain.dataset.smartAction = 'final_submit';
      btnMain.className = 'touch-btn w-full py-3.5 px-4 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-base shadow-lg border-2 border-emerald-400 transition flex items-center justify-center gap-2';
      if (btnMainIcon) btnMainIcon.textContent = '💾';
      btnMainTxt.textContent = editId ? 'حفظ التعديلات النهائية للحركة ✓' : (activeRecalledPendingId ? 'اعتماد الوزنة الثانية وحفظ الفاتورة ✓' : 'حفظ نهائي للحركة والفاتورة');
    }
  }

  function buildSingleSaleWhatsappText(r, dayNum, dateLabel) {
    const fName = appState.farmName || 'أبوذكري';
    if (r.isPending) {
      return [`⏳ *كارتة وزنة أولى مؤقتة — مزرعة ${fName}*`, `📅 اليوم: يوم ${dayNum} (${dateLabel})`, `👤 التاجر: *${r.merchant}* (كود ${r.code || '-'})`, `🔢 بون ميزان: ${r.scaleNo || '-'} | 🚚 سيارة: ${r.carNo || '-'}`, `⚖️ وزنة 1 (فارغ): *${fmtInt(r.w1)} كجم* (تحت التحميل)`].join('
');
    }
    if (r.isDebtCollectionOnly) {
      const paidDebt = (r.debtCash || 0) + (r.debtTransfer || 0);
      const paidPrev = (r.prevCash || 0) + (r.prevTransfer || 0);
      return [`💵 *إيصال تحصيل مديونية — مزرعة ${fName}*`, `📅 اليوم: يوم ${dayNum} (${dateLabel}) | سند #${r.scaleNo || '-'}`, `👤 التاجر: *${r.merchant}* (كود ${r.code || '-'})`, paidDebt > 0 ? `✅ مسدد مديونية المزرعة الحالية: *${fmtInt(paidDebt)} ج.م*` : '', paidPrev > 0 ? `🏦 تحصيل مزرعة سابقة: *${fmtInt(paidPrev)} ج.م*` : ''].filter(Boolean).join('
');
    }
    return [`⚖️ *بون ميزان وفاتورة بيع — مزرعة ${fName}*`, `📅 اليوم: يوم ${dayNum} (${dateLabel}) | بون #${r.scaleNo || '-'}`, `👤 التاجر: *${r.merchant}* | 🚚 سيارة: ${r.carNo || '-'}`, `⚖️ الأوزان: فارغ (${fmtInt(r.w1)}) - قائم (${fmtInt(r.w2)}) = *صافي ${fmtInt(r.netWeight)} كجم*`, `💰 *إجمالي الفاتورة: ${fmtDec(r.totalWithTip)} ج.م*`].join('
');
  }

  function renderMobileSalesCards() {
    const d = Number(appState.currentDay) || 1;
    const summary = typeof computeDaySummary === 'function' ? computeDaySummary(d) : null;
    if (!summary) return;

    const dayLocked = typeof isDayLocked === 'function' && isDayLocked(d);
    const canEditSales = typeof hasPermission === 'function' && hasPermission('sales') && !dayLocked;

    const elDayKpiCount = document.getElementById('dayKpiCount');
    if (elDayKpiCount) elDayKpiCount.textContent = fmtInt(summary.countCars);
    const elDayKpiNetW = document.getElementById('dayKpiNetWeight');
    if (elDayKpiNetW) elDayKpiNetW.textContent = fmtInt(summary.sumNetW);
    const elDayKpiNetCash = document.getElementById('dayKpiNetCash');
    if (elDayKpiNetCash) elDayKpiNetCash.textContent = fmtInt(summary.netCashInBox);

    const elTblTitle = document.getElementById('tblDayTitle');
    if (elTblTitle) elTblTitle.textContent = `يوم ${d} — ${summary.dateLabel}`;
    const elFormDayLbl = document.getElementById('saleFormDayLabel');
    if (elFormDayLbl) elFormDayLbl.textContent = `يوم ${d} — ${appState.farmName || 'أبوذكري'}`;

    const footNetW = document.getElementById('footMobileSumNetW');
    if (footNetW) footNetW.textContent = `${fmtInt(summary.sumNetW)} كجم`;
    const footSales = document.getElementById('footMobileSumSales');
    if (footSales) footSales.textContent = `${fmtDec(summary.sumTotalWithTip)} ج.م`;
    const footCash = document.getElementById('footMobileSumCashCollected');
    if (footCash) footCash.textContent = `${fmtInt(summary.totalCashBeforeExpenses)} ج.م`;

    document.querySelectorAll('#mobileSalesFilterPills [data-card-filter]').forEach(btn => {
      const fKey = btn.getAttribute('data-card-filter');
      const isActive = fKey === mobileActiveCardFilter;
      btn.className = isActive ? 'py-1.5 px-2 rounded-xl bg-blue-900 text-amber-300 font-extrabold shadow-sm border border-blue-950' : 'py-1.5 px-2 rounded-xl bg-slate-100 text-slate-700 font-bold hover:bg-slate-200';
    });

    const allRows = summary.allOrderedRows || summary.rows || [];
    const q = String((document.getElementById('inpFilterDailySales') && document.getElementById('inpFilterDailySales').value) || '').trim().toLowerCase();

    const filteredRows = allRows.filter(r => {
      if (mobileActiveCardFilter === 'completed' && (r.isPending || r.isDebtCollectionOnly)) return false;
      if (mobileActiveCardFilter === 'pending' && !r.isPending) return false;
      if (mobileActiveCardFilter === 'debt_only' && !r.isDebtCollectionOnly) return false;
      if (!q) return true;
      return String(r.merchant || '').toLowerCase().includes(q) || String(r.code || '').toLowerCase().includes(q) || String(r.scaleNo || '').toLowerCase().includes(q) || String(r.carNo || '').toLowerCase().includes(q);
    });

    const countBadge = document.getElementById('mobileRecordedSalesCountBadge');
    if (countBadge) countBadge.textContent = `${filteredRows.length} من ${allRows.length} حركة`;

    const container = document.getElementById('mobileSalesCardsContainer');
    if (!container) return;

    if (filteredRows.length === 0) {
      container.innerHTML = `<div id="mobileSalesEmptyState" class="p-6 text-center bg-slate-50 rounded-2xl border border-dashed border-slate-300 space-y-1"><div class="text-2xl">🚛</div><div class="text-xs font-extrabold text-slate-700">لا توجد حركات مسجلة</div></div>`;
      return;
    }

    container.innerHTML = filteredRows.map((r, idx) => {
      const safeId = escXmlStr(r.id);
      const safeMerch = escXmlStr(r.merchant || '-');
      const safeScale = escXmlStr(r.scaleNo || '-');
      const safeCar = escXmlStr(r.carNo || '-');
      const isAskingDelete = mobilePendingDeleteConfirmId === String(r.id);
      const borderCls = r.isPending ? 'border-amber-400 bg-amber-50/70' : (r.isDebtCollectionOnly ? 'border-teal-500 bg-teal-50/40' : 'border-slate-200 bg-white');

      let bodyMetricsHtml = '';
      if (r.isPending) {
        bodyMetricsHtml = `<div class="grid grid-cols-3 gap-1.5 bg-white p-2 rounded-xl border border-amber-300 text-center text-xs"><div><span class="text-[10px] text-slate-500 block font-bold">السيارة</span><strong class="font-extrabold text-slate-900">${safeCar}</strong></div><div><span class="text-[10px] text-amber-900 block font-bold">وزنة 1</span><strong class="font-extrabold text-amber-950">${fmtInt(r.w1)} ك</strong></div><div><span class="text-[10px] text-slate-500 block font-bold">السعر</span><strong class="font-extrabold text-blue-900">${fmtDec(r.price)}</strong></div></div>`;
      } else if (r.isDebtCollectionOnly) {
        const totDebtPaid = (r.debtCash || 0) + (r.debtTransfer || 0);
        bodyMetricsHtml = `<div class="grid grid-cols-2 gap-1.5 bg-white p-2 rounded-xl border border-teal-300 text-center text-xs"><div><span class="text-[10px] text-teal-800 block font-bold">سداد المديونية</span><strong class="font-extrabold text-teal-950">${fmtInt(totDebtPaid)} ج.م</strong></div><div><span class="text-[10px] text-purple-900 block font-bold">ملاحظات</span><strong class="font-extrabold text-purple-950">${escXmlStr(r.notes || '-')}</strong></div></div>`;
      } else {
        const totDebtPaid = (r.debtCash || 0) + (r.debtTransfer || 0);
        bodyMetricsHtml = `<div class="grid grid-cols-3 gap-1.5 bg-slate-50 p-2 rounded-xl border border-slate-200 text-center text-xs"><div class="border-l border-slate-200 pl-1"><span class="text-[10px] text-slate-500 block font-bold">الصافي</span><strong class="font-extrabold text-blue-950">${fmtInt(r.netWeight)} ك</strong></div><div class="border-l border-slate-200 pl-1"><span class="text-[10px] text-slate-500 block font-bold">الفاتورة</span><strong class="font-extrabold text-slate-950">${fmtDec(r.totalWithTip)} ج</strong></div><div><span class="text-[10px] text-slate-500 block font-bold">آجل الفاتورة</span><strong class="font-extrabold ${r.creditSales > 0 ? 'text-rose-800' : 'text-emerald-800'}">${fmtInt(r.creditSales)} ج</strong></div></div>`;
      }

      let actionsFooterHtml = '';
      if (isAskingDelete && canEditSales) {
        actionsFooterHtml = `<div class="p-2 rounded-xl bg-rose-100 border-2 border-rose-400 flex items-center justify-between gap-2"><span class="text-xs font-extrabold text-rose-950">🗑️ تأكيد الحذف؟</span><div class="flex items-center gap-1.5"><button type="button" data-mobile-confirm-del="${safeId}" data-is-pending="${r.isPending ? '1' : '0'}" class="px-3 py-1.5 rounded-lg bg-rose-700 text-white font-extrabold text-xs">نعم</button><button type="button" data-mobile-cancel-del="1" class="px-2.5 py-1.5 rounded-lg bg-white text-slate-800 font-bold text-xs border">تراجع</button></div></div>`;
      } else {
        actionsFooterHtml = `<div class="flex items-center justify-between gap-1.5 pt-1.5 border-t border-slate-200/80 flex-wrap"><div class="flex items-center gap-1 flex-wrap">${canEditSales ? (r.isPending ? `<button type="button" data-mobile-recall-pending="${safeId}" class="px-3 py-1.5 rounded-xl bg-emerald-600 text-white font-extrabold text-xs"><span>🔄</span><span>استكمال</span></button>` : `<button type="button" data-mobile-edit-sale="${safeId}" class="px-3 py-1.5 rounded-xl bg-blue-100 text-blue-950 font-extrabold text-xs"><span>✏️</span><span>تعديل</span></button>`) : ''}${canEditSales ? `<button type="button" data-mobile-ask-del="${safeId}" class="px-2.5 py-1.5 rounded-xl bg-rose-50 text-rose-800 border font-bold text-xs">🗑️ حذف</button>` : ''}</div><div class="flex items-center gap-1"><button type="button" data-mobile-share-wa="${safeId}" class="px-2.5 py-1.5 rounded-xl bg-emerald-50 text-emerald-900 border font-extrabold text-xs">📲 واتساب</button><button type="button" data-mobile-print-receipt="${safeId}" class="px-2.5 py-1.5 rounded-xl bg-indigo-50 text-indigo-900 border font-extrabold text-xs">🖨️ بون</button></div></div>`;
      }

      return `<article class="rounded-2xl border-2 ${borderCls} p-3 shadow-sm space-y-2 transition"><div class="flex items-center justify-between gap-1.5 flex-wrap"><div class="flex items-center gap-1.5 min-w-0"><span class="w-6 h-6 rounded-full bg-slate-800 text-white text-[11px] font-extrabold flex items-center justify-center shrink-0">${idx + 1}</span><span class="font-extrabold text-slate-900 text-sm truncate">${safeMerch}</span><span class="px-1.5 py-0.5 rounded bg-blue-50 text-blue-900 border text-[10px] font-extrabold shrink-0">كود ${r.code || '-'}</span></div><div class="flex items-center gap-1 shrink-0">${!r.isDebtCollectionOnly && r.carNo ? `<span class="text-[11px] font-extrabold text-slate-600 bg-slate-100 px-2 py-0.5 rounded-lg">🚚 ${safeCar}</span>` : ''}${r.isPending ? `<span class="px-2 py-0.5 rounded-lg bg-amber-400 text-slate-950 text-[10px] font-extrabold">⏳ مؤقت</span>` : (r.isDebtCollectionOnly ? `<span class="px-2 py-0.5 rounded-lg bg-teal-700 text-white text-[10px] font-extrabold">💵 سند</span>` : `<span class="px-2 py-0.5 rounded-lg bg-blue-900 text-amber-300 text-[10px] font-extrabold">بون #${safeScale}</span>`)}</div></div>${bodyMetricsHtml}${actionsFooterHtml}</article>`;
    }).join('');
  }

  function recallPendingCarIntoMobileForm(pendId) {
    const d = Number(appState.currentDay) || 1;
    const pendingList = (appState.days[d] && appState.days[d].pendingSales) || [];
    const item = pendingList.find(x => String(x.id) === String(pendId));
    if (!item) return;
    activeRecalledPendingId = item.id;
    document.getElementById('activeRecalledPendingIdInput').value = item.id;
    document.getElementById('editSaleId').value = '';
    setMobileEntryModeUI('sale');
    document.getElementById('inpMerchantName').value = item.merchant || '';
    document.getElementById('inpScaleNo').value = item.scaleNo || '';
    document.getElementById('inpCarNo').value = item.carNo || '';
    document.getElementById('inpW1').value = item.w1 ? fmtMoney(item.w1) : '';
    document.getElementById('inpW2').value = '';
    document.getElementById('inpPrice').value = item.price ? fmtMoney(item.price) : (appState.defaultPrice ? fmtMoney(appState.defaultPrice) : '');
    document.getElementById('inpTip').value = item.tip !== undefined ? fmtMoney(item.tip) : (appState.defaultTip ? fmtMoney(appState.defaultTip) : '');
    if (typeof updateLiveFormCalculation === 'function') updateLiveFormCalculation();
    renderMobilePendingSwipeCards();
    syncSmartPrimaryActionButton();
    document.getElementById('saleFormCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
    setTimeout(() => { const w2 = document.getElementById('inpW2'); if (w2) { w2.focus(); w2.select(); } }, 220);
    showToast(`استكمال وزنة 2 للسيارة (${item.merchant}) ⚖️`, '🔄');
  }

  function loadCompletedSaleIntoMobileForm(saleId) {
    const d = Number(appState.currentDay) || 1;
    const salesList = (appState.days[d] && appState.days[d].sales) || [];
    const row = salesList.find(x => String(x.id) === String(saleId));
    if (!row) return;
    activeRecalledPendingId = '';
    document.getElementById('activeRecalledPendingIdInput').value = '';
    document.getElementById('editSaleId').value = row.id;
    const comp = computeSaleRow(row);
    setMobileEntryModeUI(comp.isDebtCollectionOnly ? 'debt_only' : 'sale');
    document.getElementById('inpMerchantName').value = row.merchant || '';
    document.getElementById('inpScaleNo').value = row.scaleNo || '';
    document.getElementById('inpCarNo').value = row.carNo || '';
    document.getElementById('inpW1').value = row.w1 ? fmtMoney(row.w1) : '';
    document.getElementById('inpW2').value = row.w2 ? fmtMoney(row.w2) : '';
    document.getElementById('inpPrice').value = row.price ? fmtMoney(row.price) : '';
    document.getElementById('inpTip').value = row.tip ? fmtMoney(row.tip) : '';
    document.getElementById('inpCashSales').value = row.cashSales ? fmtMoney(row.cashSales) : '';
    document.getElementById('inpCreditSales').value = row.creditSales ? fmtMoney(row.creditSales) : '';
    document.getElementById('inpDebtCash').value = row.debtCash ? fmtMoney(row.debtCash) : '';
    if (typeof updateLiveFormCalculation === 'function') updateLiveFormCalculation();
    syncSmartPrimaryActionButton();
    document.getElementById('saleFormCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
    showToast(`تعديل حركة (${row.merchant}) ✏️`, '✏️');
  }

  function resetMobileSaleFormClean() {
    activeRecalledPendingId = '';
    document.getElementById('activeRecalledPendingIdInput').value = '';
    document.getElementById('editSaleId').value = '';
    const form = document.getElementById('saleEntryForm');
    if (form) form.reset();
    setMobileEntryModeUI('sale');
    if (typeof applyStickySaleDefaults === 'function') applyStickySaleDefaults();
    if (typeof updateLiveFormCalculation === 'function') updateLiveFormCalculation();
    renderMobilePendingSwipeCards();
    syncSmartPrimaryActionButton();
  }

  function renderMobileCompanionUI() {
    renderMobileDayPicker();
    renderMobilePendingSwipeCards();
    renderMobileSalesCards();
    syncSmartPrimaryActionButton();
  }

  function attachMobileCompanionEvents() {
    if (typeof window.renderDailyView === 'function' && !window._mobileRenderDailyHooked) {
      const orig = window.renderDailyView;
      window.renderDailyView = function() { try { orig.apply(this, arguments); } catch(e){} renderMobileCompanionUI(); };
      window._mobileRenderDailyHooked = true;
    }
    if (typeof window.renderAll === 'function' && !window._mobileRenderAllHooked) {
      const orig = window.renderAll;
      window.renderAll = function() { try { orig.apply(this, arguments); } catch(e){} renderMobileCompanionUI(); };
      window._mobileRenderAllHooked = true;
    }

    const selDay = document.getElementById('selMobileCurrentDay');
    if (selDay) {
      selDay.addEventListener('change', (e) => {
        const val = e.target.value;
        if (val === '__add_new_day__') {
          const vis = typeof getVisibleDays === 'function' ? getVisibleDays() : [1];
          let nextD = 1;
          for (let i = 1; i <= 10; i++) { if (!vis.includes(i)) { nextD = i; break; } }
          if (typeof addSpecificDayToCycle === 'function') addSpecificDayToCycle(nextD, `اليوم ${nextD}`);
          renderMobileCompanionUI();
          return;
        }
        appState.currentDay = Number(val) || 1;
        resetMobileSaleFormClean();
        saveState(false);
        renderAll();
        showToast(`الانتقال إلى (يوم ${appState.currentDay}) 📅`, '📅');
      });
    }

    const btnScale = document.getElementById('btnModeScaleSale');
    const btnDebt = document.getElementById('btnModeDebtCollectionOnly');
    const btnBackScale = document.getElementById('btnSwitchBackToScaleMode');
    if (btnScale) btnScale.addEventListener('click', () => setMobileEntryModeUI('sale'));
    if (btnDebt) btnDebt.addEventListener('click', () => setMobileEntryModeUI('debt_only'));
    if (btnBackScale) btnBackScale.addEventListener('click', () => setMobileEntryModeUI('sale'));

    const prevHeader = document.getElementById('prevFarmsCollectionHeader');
    if (prevHeader) {
      prevHeader.addEventListener('click', () => {
        const body = document.getElementById('prevFarmsCollapsibleBody');
        const icon = document.getElementById('btnTogglePrevFarmsIcon');
        const txt = document.getElementById('btnTogglePrevFarmsText');
        if (body) {
          const isOpen = body.classList.toggle('hidden');
          if (icon) icon.textContent = isOpen ? '➕' : '➖';
          if (txt) txt.textContent = isOpen ? 'فتح ▾' : 'طيّ ▴';
        }
      });
    }

    const btnMainSave = document.getElementById('btnInlineSaveSale');
    if (btnMainSave) {
      btnMainSave.addEventListener('click', (e) => {
        if (btnMainSave.dataset.smartAction === 'save_pending_w1') {
          e.preventDefault();
          e.stopPropagation();
          const hiddenPendBtn = document.getElementById('btnSavePendingW1');
          if (hiddenPendBtn) hiddenPendBtn.click();
          setTimeout(() => { resetMobileSaleFormClean(); renderMobileCompanionUI(); }, 50);
        }
      });
    }

    const btnInlineCancel = document.getElementById('btnInlineCancelSale');
    if (btnInlineCancel) {
      btnInlineCancel.addEventListener('click', () => { resetMobileSaleFormClean(); showToast('تم تفريغ الحقول ✕', 'ℹ️'); });
    }

    const saleForm = document.getElementById('saleEntryForm');
    if (saleForm) {
      saleForm.addEventListener('submit', () => {
        setTimeout(() => { setMobileEntryModeUI('sale'); renderMobileCompanionUI(); }, 60);
      });
    }

    const inpSearchPending = document.getElementById('inpFilterPendingSales');
    if (inpSearchPending) inpSearchPending.addEventListener('input', () => renderMobilePendingSwipeCards());
    const inpSearchDaily = document.getElementById('inpFilterDailySales');
    if (inpSearchDaily) inpSearchDaily.addEventListener('input', () => renderMobileSalesCards());
    const btnClearDaily = document.getElementById('btnClearDailySalesFilters');
    if (btnClearDaily) btnClearDaily.addEventListener('click', () => { mobileActiveCardFilter = 'all'; if (inpSearchDaily) inpSearchDaily.value = ''; renderMobileSalesCards(); });

    const filterPillsBox = document.getElementById('mobileSalesFilterPills');
    if (filterPillsBox) {
      filterPillsBox.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-card-filter]');
        if (!btn) return;
        mobileActiveCardFilter = btn.getAttribute('data-card-filter') || 'all';
        renderMobileSalesCards();
      });
    }

    document.body.addEventListener('click', (e) => {
      const recallBtn = e.target.closest('[data-mobile-recall-pending]');
      if (recallBtn) { recallPendingCarIntoMobileForm(recallBtn.getAttribute('data-mobile-recall-pending')); return; }

      const delPendQuickBtn = e.target.closest('[data-mobile-del-pending]');
      if (delPendQuickBtn) {
        const pid = delPendQuickBtn.getAttribute('data-mobile-del-pending');
        const d = Number(appState.currentDay) || 1;
        recordDeletedItem('pendingSales', pid);
        appState.days[d].pendingSales = (appState.days[d].pendingSales || []).filter(x => String(x.id) !== String(pid));
        if (String(activeRecalledPendingId) === String(pid)) resetMobileSaleFormClean();
        saveState(true);
        renderAll();
        showToast('تم حذف الوزنة المؤقتة 🗑️', '🗑️');
        return;
      }

      const editSaleBtn = e.target.closest('[data-mobile-edit-sale]');
      if (editSaleBtn) { loadCompletedSaleIntoMobileForm(editSaleBtn.getAttribute('data-mobile-edit-sale')); return; }

      const askDelBtn = e.target.closest('[data-mobile-ask-del]');
      if (askDelBtn) { mobilePendingDeleteConfirmId = String(askDelBtn.getAttribute('data-mobile-ask-del') || ''); renderMobileSalesCards(); return; }

      const cancelDelBtn = e.target.closest('[data-mobile-cancel-del]');
      if (cancelDelBtn) { mobilePendingDeleteConfirmId = ''; renderMobileSalesCards(); return; }

      const confirmDelBtn = e.target.closest('[data-mobile-confirm-del]');
      if (confirmDelBtn) {
        const targetId = String(confirmDelBtn.getAttribute('data-mobile-confirm-del') || '');
        const isPend = confirmDelBtn.getAttribute('data-is-pending') === '1';
        const d = Number(appState.currentDay) || 1;
        mobilePendingDeleteConfirmId = '';
        if (isPend) {
          recordDeletedItem('pendingSales', targetId);
          appState.days[d].pendingSales = (appState.days[d].pendingSales || []).filter(x => String(x.id) !== targetId);
        } else {
          recordDeletedItem('sales', targetId);
          appState.days[d].sales = (appState.days[d].sales || []).filter(x => String(x.id) !== targetId);
        }
        saveState(true);
        renderAll();
        showToast('تم حذف الحركة 🗑️', '🗑️');
        return;
      }

      const shareWaBtn = e.target.closest('[data-mobile-share-wa]');
      if (shareWaBtn) {
        const sid = String(shareWaBtn.getAttribute('data-mobile-share-wa') || '');
        const d = Number(appState.currentDay) || 1;
        const summary = computeDaySummary(d);
        const row = (summary.allOrderedRows || []).find(x => String(x.id) === sid);
        if (!row) return;
        const waText = buildSingleSaleWhatsappText(row, d, summary.dateLabel);
        if (navigator.clipboard) navigator.clipboard.writeText(waText).catch(()=>{});
        window.open(`https://wa.me/?text=${encodeURIComponent(waText)}`, '_blank', 'noopener,noreferrer');
        showToast('تم فتح واتساب للمشاركة 📲', '📲');
        return;
      }

      const printReceiptBtn = e.target.closest('[data-mobile-print-receipt]');
      if (printReceiptBtn) {
        const sid = String(printReceiptBtn.getAttribute('data-mobile-print-receipt') || '');
        const d = Number(appState.currentDay) || 1;
        if (typeof triggerTablePrint === 'function') triggerTablePrint(`scaleReceipt:${d}:${sid}`);
      }
    });

    renderMobileCompanionUI();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', attachMobileCompanionEvents);
  } else {
    attachMobileCompanionEvents();
  }
})();
