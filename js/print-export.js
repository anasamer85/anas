// =========================================================================
// MODULE 5: ISOLATED PRINTING, SCALE RECEIPTS & PNG/PDF EXPORT (js/print-export.js — v84)
// =========================================================================

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
  const fName = appState.farmName || 'مزرعة جديدة';
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
  const fName = appState.farmName || 'مزرعة جديدة';
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
  const fName = appState.farmName || 'مزرعة جديدة';

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
            ${r.isDebtCollectionOnly ? 'سند' : 'بون'} #${escXmlStr((r.isDebtCollectionOnly ? (r.voucherNo || r.scaleNo) : r.scaleNo) || '-')}
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
  const fName = appState.farmName || 'مزرعة جديدة';
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
        <td style="text-align:center; font-weight:700;">${r.isDebtCollectionOnly ? `سند #${escXmlStr(r.voucherNo || r.scaleNo || '-')}${r.carNo ? ' / ' + escXmlStr(r.carNo) : ''}` : `${escXmlStr(r.scaleNo || '-')} / ${escXmlStr(r.carNo || '-')}`}</td>
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

  const fName = appState.farmName || 'مزرعة جديدة';
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
  const fName = appState.farmName || 'مزرعة جديدة';
  const fileBase = `كشف_حساب_${ledger.code}_${ledger.name}_مزرعة_${fName}`;
  await exportPrintTargetAsImageOrPdf('merchantDrillDown', format, fileBase);
}

async function exportScaleReceiptAsImageOrPdf(saleId, dayNumInput, format = 'png') {
  if (!saleId) return;
  const d = Number(dayNumInput) || appState.currentDay || 1;
  const dayObj = (appState.days && appState.days[d]) || {};
  const row = (dayObj.sales || []).find(x => String(x.id) === String(saleId)) ||
              (dayObj.pendingSales || []).find(x => String(x.id) === String(saleId)) || {};
  const fName = appState.farmName || 'مزرعة جديدة';
  const scaleLabel = row.scaleNo ? `بون_${row.scaleNo}` : `وزنة`;
  const merchLabel = row.merchant || 'تاجر';
  const fileBase = `كارتة_ميزان_${scaleLabel}_${merchLabel}_يوم${d}_مزرعة_${fName}`;
  await exportPrintTargetAsImageOrPdf(`scaleReceipt:${d}:${saleId}`, format, fileBase);
}

function renderMerchantPrintOnlyContainer(ledger, filteredMovements) {
  const printContainer = ensureMerchantPrintDomElements();
  if (!printContainer || !ledger) return;
  const fName = appState.farmName || 'مزرعة جديدة';
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

