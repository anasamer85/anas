// =========================================================================
// MOBILE COMPANION ENGINE (mobile-app.js — v51)
// يُستدعى في mobile.html مباشرة بعد app.js لربط واجهة الموبايل اللمسية
// بقاعدة البيانات الموحدة (appState) والدوال المحاسبية والمزامنة اللحظية
// =========================================================================

(function () {
  'use strict';

  // حالة الفلترة المحلية لبطاقات حركات اليوم على الموبايل ('all' | 'completed' | 'pending' | 'debt_only')
  let mobileActiveCardFilter = 'all';
  // معرّف البطاقة المفتوح لها تأكيد الحذف المضمن (بديل window.confirm المحظور)
  let mobilePendingDeleteConfirmId = '';

  // -----------------------------------------------------------------------
  // 1. حارس عناصر الـ DOM الآمن (Safe DOM Shims for app.js Compatibility)
  // يضمن عدم حدوث أي خطأ TypeError في دوال app.js التي تحدث عناصر سطح المكتب
  // -----------------------------------------------------------------------
  function installSafeMobileDomGuard() {
    if (typeof document === 'undefined' || !document.body) return;
    let shimBox = document.getElementById('mobileAppJsCompatibilityShim');
    if (!shimBox) {
      shimBox = document.createElement('div');
      shimBox.id = 'mobileAppJsCompatibilityShim';
      shimBox.className = 'hidden';
      shimBox.style.display = 'none';
      shimBox.setAttribute('aria-hidden', 'true');
      document.body.appendChild(shimBox);
    }

    const requiredIds = [
      { id: 'inpTopFarmName', tag: 'input' },
      { id: 'inpSettingsFarmName', tag: 'input' },
      { id: 'dailyFarmNameBadge', tag: 'span' },
      { id: 'dashFarmNameTitle', tag: 'span' },
      { id: 'linkedExcelNameTxt', tag: 'span' },
      { id: 'daySelectorContainer', tag: 'div' },
      { id: 'currentDayDateInput', tag: 'input' },
      { id: 'expDayTitle', tag: 'span' },
      { id: 'tbDayTitle', tag: 'span' },
      { id: 'dayKpiTotalSales', tag: 'span' },
      { id: 'dayKpiExpenses', tag: 'span' },
      { id: 'dayKpiTransfers', tag: 'span' },
      { id: 'dailySalesTbody', tag: 'tbody', wrapTable: 'dailySalesTable', theadRowId: 'dailySalesTheadRow', tfootId: 'dailySalesTfoot' },
      { id: 'pendingWeighInsTbody', tag: 'tbody', wrapTable: 'pendingWeighInsTable', theadRowId: 'pendingWeighInsTheadRow' },
      { id: 'dailyExpensesTbody', tag: 'tbody', wrapTable: 'dailyExpensesTable', theadRowId: 'dailyExpensesTheadRow' },
      { id: 'dayTotalExpensesBadge', tag: 'span' },
      { id: 'tbPillar1', tag: 'div' },
      { id: 'tbPillar2', tag: 'div' },
      { id: 'tbPillar3', tag: 'div' },
      { id: 'inpDeliveredCash', tag: 'input' },
      { id: 'inpCarriedForwardCash', tag: 'input' },
      { id: 'tbCashDiffBox', tag: 'div' },
      { id: 'btnSaveSale', tag: 'button' },
      { id: 'btnSaveSaleText', tag: 'span' },
      { id: 'btnSavePendingW1', tag: 'button' },
      { id: 'btnCancelEditSale', tag: 'button' },
      { id: 'btnCancelEditSaleText', tag: 'span' },
      { id: 'stickyBarNetWeight', tag: 'strong' },
      { id: 'stickyBarTotalInvoice', tag: 'strong' },
      { id: 'stickyBarRemCredit', tag: 'strong' },
      { id: 'btnStickyAutoCredit', tag: 'button' },
      { id: 'btnStickyDistributeCustody', tag: 'button' },
      { id: 'mobileWeighbridgeActionBar', tag: 'div' }
    ];

    requiredIds.forEach(item => {
      if (document.getElementById(item.id)) return;
      if (item.wrapTable) {
        const tbl = document.createElement('table');
        tbl.id = item.wrapTable;
        if (item.theadRowId) {
          const thead = document.createElement('thead');
          const tr = document.createElement('tr');
          tr.id = item.theadRowId;
          thead.appendChild(tr);
          tbl.appendChild(thead);
        }
        const tbody = document.createElement('tbody');
        tbody.id = item.id;
        tbl.appendChild(tbody);
        if (item.tfootId) {
          const tfoot = document.createElement('tfoot');
          tfoot.id = item.tfootId;
          tbl.appendChild(tfoot);
        }
        shimBox.appendChild(tbl);
      } else {
        const el = document.createElement(item.tag || 'div');
        el.id = item.id;
        shimBox.appendChild(el);
      }
    });
  }

  // تثبيت الحارس فوراً قبل إطلاق DOMContentLoaded
  installSafeMobileDomGuard();

  // -----------------------------------------------------------------------
  // 2. تحديث قائمة اختيار اليوم في هيدر الموبايل (Day Switcher Sync)
  // -----------------------------------------------------------------------
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

  // -----------------------------------------------------------------------
  // 3. إدارة التبديل السريع بين (🚛 حركة ميزان) و (💵 سند تحصيل مديونية فقط)
  // -----------------------------------------------------------------------
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
      if (hdrTitleTxt) {
        hdrTitleTxt.textContent = isDebtOnly ? 'تسجيل سند تحصيل مديونية' : 'تسجيل حركة جديدة';
      }
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

    if (typeof updateLiveFormCalculation === 'function') {
      updateLiveFormCalculation();
    }
    syncSmartPrimaryActionButton();
  }

  // -----------------------------------------------------------------------
  // 4. المكون الأول: شريط البطاقات الأفقية للوزنات المؤقتة (Swipeable Pending Cards)
  // -----------------------------------------------------------------------
  function renderMobilePendingSwipeCards() {
    const d = Number(appState.currentDay) || 1;
    const dayObj = (appState.days && appState.days[d]) || { pendingSales: [] };
    const dayLocked = typeof isDayLocked === 'function' && isDayLocked(d);
    const canEditSales = typeof hasPermission === 'function' && hasPermission('sales') && !dayLocked;

    const sec = document.getElementById('pendingWeighInsSection');
    const listContainer = document.getElementById('pendingCardsHorizontalList');
    const badge = document.getElementById('pendingWeighInsCountBadge');
    const searchInp = document.getElementById('inpFilterPendingSales');

    if (!sec || !listContainer) return;

    const rawPending = sortSalesListByScaleNo(dayObj.pendingSales || []);
    if (badge) badge.textContent = `${rawPending.length} سيارة`;

    // إظهار القسم دائماً إذا كانت هناك سيارات مؤقتة أو إذا كان المستخدم يبحث
    const q = String((searchInp && searchInp.value) || '').trim().toLowerCase();
    const filteredPending = q
      ? rawPending.filter(item =>
          String(item.merchant || '').toLowerCase().includes(q) ||
          String(item.carNo || '').toLowerCase().includes(q) ||
          String(item.scaleNo || '').toLowerCase().includes(q) ||
          String(item.notes || '').toLowerCase().includes(q)
        )
      : rawPending;

    if (rawPending.length === 0) {
      listContainer.innerHTML = `
        <div id="pendingCardsEmptyHint" class="w-full py-2.5 px-3 text-center text-xs font-bold text-amber-900/80 bg-white/80 rounded-xl border border-dashed border-amber-300">
          لا توجد سيارات منتظرة حالياً — عند حفظ (وزنة 1 فارغ) ستظهر بطاقتها هنا للمسها واستكمال الوزنة الثانية فوراً.
        </div>
      `;
      return;
    }

    if (filteredPending.length === 0) {
      listContainer.innerHTML = `
        <div class="w-full py-2.5 px-3 text-center text-xs font-bold text-slate-600 bg-white rounded-xl border border-amber-300">
          لا توجد سيارة مؤقتة مطابقة للبحث (${escXmlStr(q)})
        </div>
      `;
      return;
    }

    listContainer.innerHTML = filteredPending.map(item => {
      const safeId = escXmlStr(item.id);
      const safeMerchant = escXmlStr(item.merchant || '-');
      const safeCar = escXmlStr(item.carNo || '-');
      const safeScale = escXmlStr(item.scaleNo || '-');
      const isCurrentlyRecalled = String(activeRecalledPendingId) === String(item.id);
      const custodyTotal = (Number(item.custodyCash) || 0) + (Number(item.custodyTransfer) || 0);
      const timeTxt = escXmlStr(item.updatedTimeTxt || item.createdTimeTxt || '');

      return `
        <div class="pending-card-item rounded-2xl border-2 ${isCurrentlyRecalled ? 'border-emerald-600 bg-emerald-50 ring-2 ring-emerald-400' : 'border-amber-400 bg-white'} p-2.5 shadow-sm flex flex-col justify-between gap-2 transition">
          <div>
            <div class="flex items-center justify-between gap-1 border-b border-amber-200 pb-1">
              <span class="px-2 py-0.5 rounded-lg bg-amber-400 text-slate-950 text-[10px] font-extrabold">
                بون #${safeScale}
              </span>
              <span class="text-[10px] font-extrabold text-slate-600">
                🚚 سيارة: <strong class="text-slate-900">${safeCar}</strong>
              </span>
            </div>
            <div class="font-extrabold text-slate-900 text-xs mt-1.5 truncate" title="${safeMerchant}">
              👤 ${safeMerchant}
            </div>
            <div class="flex items-center justify-between text-[11px] font-bold mt-1 bg-amber-50/90 px-2 py-1 rounded-lg border border-amber-200">
              <span class="text-amber-900">وزنة 1 (فارغ):</span>
              <strong class="text-amber-950 font-extrabold">${fmtInt(item.w1)} كجم</strong>
            </div>
            ${custodyTotal > 0 ? `<div class="text-[10px] font-extrabold text-teal-900 mt-1">💼 عهدة مسجلة: ${fmtInt(custodyTotal)} ج.م</div>` : ''}
            ${timeTxt ? `<div class="text-[9px] font-bold text-slate-400 mt-0.5">🕒 ${timeTxt}</div>` : ''}
          </div>

          ${canEditSales ? `
            <div class="flex items-center gap-1.5 pt-1 border-t border-slate-100">
              <button type="button" data-mobile-recall-pending="${safeId}"
                class="flex-1 py-2 px-2.5 rounded-xl ${isCurrentlyRecalled ? 'bg-emerald-700 text-white' : 'bg-emerald-600 hover:bg-emerald-500 text-white'} font-extrabold text-xs shadow transition flex items-center justify-center gap-1">
                <span>🔄</span>
                <span>${isCurrentlyRecalled ? 'قيد الاستكمال...' : 'استكمال وزنة 2'}</span>
              </button>
              <button type="button" data-mobile-print-receipt="${safeId}"
                class="py-2 px-2 rounded-xl bg-indigo-100 hover:bg-indigo-200 text-indigo-9