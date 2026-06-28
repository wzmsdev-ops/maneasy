/**
 * assets/js/master/stock.js
 * 재고 관리 (자재담당자) — admin/manager role만 접근
 *
 *   [입고]       발주서(ORDERED/PARTIAL) 품목별 입고 처리 (부분입고 가능) → 중앙창고(dept_id=NULL) 적립
 *                발주 없이 직접 입고도 가능
 *   [불출]       중앙창고 → 부서로 자재 전달 (stock_dispatch)
 *   [부서별재고] 부서별 현재고 조회 (의원 통합 아님)
 *
 * 사용처리(부서 재고 차감)는 부서 직원 본인이 처리해야 하므로 이 화면(자재담당자 전용)이 아니라
 * 별도의 자가서비스 화면(pages/master/use-stock.html, 전체 사용자 접근)으로 분리되어 있습니다.
 *
 * 부가세: 입고 등록 시 공급가액의 10%로 자동계산해서 보여주고, 세금계산서와 다르면
 *         사용자가 직접 보정하여 stock_receipts.vat_amount에 그대로 저장합니다.
 */
'use strict';

var stState = {
  receipt:   { page:1, pageSize:20, totalPages:1, loading:false },
  dispatch:  { page:1, pageSize:20, totalPages:1, loading:false },
  deptstock: { page:1, pageSize:20, totalPages:1, loading:false },
};

var _gridReceipt   = null;
var _gridDispatch  = null;
var _gridDeptStock = null;

var itemCache    = [];   // 자재 목록
var deptCache    = [];   // 부서 목록
var centralCache = {};   // item_id → 중앙창고(dept_id=NULL) 현재고
var orderItemsMap = {};  // (입고 모달) item_id → {order_item_id, order_qty, received_qty, purchase_unit, unit_price}
var _receiptVatTouched = false; // 입고 모달에서 부가세를 사용자가 직접 수정했는지 여부

/* ── 유틸 ── */
function ts(v) {
  return String(v == null ? '' : v)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function val(id)       { return (document.getElementById(id)?.value || '').trim(); }
function setVal(id, v) { var el = document.getElementById(id); if (el) el.value = v ?? ''; }
function fmtN(n)       { return Number(n || 0).toLocaleString('ko-KR'); }
function fmtDate(v)    { return v ? String(v).slice(0, 10) : '-'; }
function calcVat(s)    { return Math.round((s || 0) * 0.1); }

var TX_LABEL = { IN:'입고', OUT:'출고', ADJ:'조정', RETURN:'반납' };
var TX_BADGE = { IN:'badge-in', OUT:'badge-out', ADJ:'badge-adj', RETURN:'badge-return' };
function badgeTx(t) {
  return '<span class="' + (TX_BADGE[t] || '') + '">' + (TX_LABEL[t] || ts(t)) + '</span>';
}

/* ── 모달 ── */
function openModal(id)  { document.getElementById(id)?.classList.add('is-open'); }
function closeModal(id) { document.getElementById(id)?.classList.remove('is-open'); }
window.closeModal = closeModal;

/* ── 탭 ── */
function initTabs() {
  document.querySelectorAll('.tab-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var target = btn.dataset.tab;
      document.querySelectorAll('.tab-btn').forEach(function(b) { b.classList.remove('active'); });
      document.querySelectorAll('.tab-panel').forEach(function(p) { p.classList.remove('active'); });
      btn.classList.add('active');
      document.getElementById('tab-' + target)?.classList.add('active');

      requestAnimationFrame(function() {
        var tabGridMap = {
          receipt:   { api: '_gridReceiptPo', id: 'receiptPoGrid', init: initReceiptPoGrid, load: loadReceiptPoList },
          dispatch:  { api: '_gridDispatchStock', id: 'dispatchStockGrid', init: initDispatchStockGrid, load: loadDispatchStock },
          deptstock: { api: '_gridDeptStock', id: 'deptStockGrid', init: initDeptStockGrid, load: function(){loadDeptStock(1);} },
        };
        var tg = tabGridMap[target];
        if (tg) {
          if (!window[tg.api]) tg.init();
          setTimeout(function() {
            var api = window[tg.api];
            var el  = document.getElementById(tg.id);
            // 매직넘버 추정 대신, 그리드가 노출하는 resolveHeight()로 부모 flex 컨테이너를
            // 실측해서 맞춘다 (탭이 숨겨져 있던 동안엔 clientHeight가 0이었을 수 있으므로,
            // 탭이 active로 바뀐 지금 다시 재측정해야 정확함)
            if (el && api && api._resolveHeight) el.style.height = api._resolveHeight() + 'px';
            if (api) api.sizeColumnsToFit();
            if (tg.load) tg.load();
          }, 0);
        }
      });
    });
  });
}

/* ── 페이지네이션 (공통) ── */
function renderPagination(areaId, state, loadFn) {
  var container = document.getElementById(areaId);
  if (!container) return;
  var page = state.page, totalPages = state.totalPages;
  if (totalPages <= 1) { container.innerHTML = ''; container.style.display = 'none'; return; }
  container.style.display = '';

  var blockSize = 10;
  var blockStart = Math.floor((page - 1) / blockSize) * blockSize + 1;
  var end = Math.min(totalPages, blockStart + blockSize - 1);
  var pages = [];
  for (var i = blockStart; i <= end; i++) {
    pages.push('<button class="pagination-btn' + (i === page ? ' is-active' : '') + '" data-page="' + i + '">' + i + '</button>');
  }
  container.innerHTML =
    '<button class="pagination-btn" data-page="' + Math.max(1, blockStart - 1) + '"' + (blockStart <= 1 ? ' disabled' : '') + '>이전</button>' +
    pages.join('') +
    '<button class="pagination-btn" data-page="' + Math.min(totalPages, end + 1) + '"' + (end >= totalPages ? ' disabled' : '') + '>다음</button>';

  Array.prototype.forEach.call(container.querySelectorAll('.pagination-btn[data-page]'), function(btn) {
    btn.addEventListener('click', function() {
      var p = Number(btn.dataset.page);
      if (p && p !== state.page) loadFn(p);
    });
  });
}

/* ════════════════════════════════
   재고 upsert 공통 (dept_id 스코프)
════════════════════════════════ */
async function upsertStockCurrent(itemId, deltaQty, deptId) {
  var q = supabaseClient.from('stock_current').select('id, qty').eq('item_id', itemId);
  q = deptId ? q.eq('dept_id', deptId) : q.is('dept_id', null);
  var { data: existing } = await q.maybeSingle();

  if (existing) {
    var newQty = existing.qty + deltaQty;
    await supabaseClient.from('stock_current')
      .update({ qty: newQty, last_updated_at: new Date().toISOString() })
      .eq('id', existing.id);
    if (!deptId) centralCache[itemId] = newQty;
    return newQty;
  } else {
    await supabaseClient.from('stock_current')
      .insert({ item_id: itemId, dept_id: deptId || null, qty: deltaQty, last_updated_at: new Date().toISOString() });
    if (!deptId) centralCache[itemId] = deltaQty;
    return deltaQty;
  }
}

async function getStockQty(itemId, deptId) {
  var q = supabaseClient.from('stock_current').select('qty').eq('item_id', itemId);
  q = deptId ? q.eq('dept_id', deptId) : q.is('dept_id', null);
  var { data } = await q.maybeSingle();
  return data?.qty || 0;
}

/* ════════════════════════════════
   입고 탭 — 발주서 품목별 입고 (부분입고 가능) / 직접 입고
════════════════════════════════ */

/* ══════════════════════════════════════════
   입고 탭 — 좌측: 발주서 목록 그리드
══════════════════════════════════════════ */
var _gridReceiptPo   = null;   // 좌측 발주서 목록
var _selectedPoId    = null;   // 선택된 발주서 ID

function initReceiptPoGrid() {
  var el = document.getElementById('receiptPoGrid');
  if (!el || typeof agGrid === 'undefined') return;

  var colDefs = [
    { headerName: '발주번호', field: 'order_no', width: 130,
      headerClass: 'ag-left-header',
      cellStyle: { display:'flex', alignItems:'center', justifyContent:'flex-start' },
      cellRenderer: function(p) { return '<code style="font-size:11px;">' + ts(p.value||'-') + '</code>'; }
    },
    { headerName: '거래처', field: 'vendors', flex: 1,
      headerClass: 'ag-left-header',
      cellStyle: { display:'flex', alignItems:'center', justifyContent:'flex-start', fontWeight:600 },
      cellRenderer: function(p) { return ts(p.value?.vendor_name || '-'); }
    },
    { headerName: '발주일', field: 'order_date', width: 95,
      cellRenderer: function(p) { return fmtDate(p.value); }
    },
    { headerName: '상태', field: 'status', width: 80,
      cellRenderer: function(p) {
        var m = { ORDERED:'발주완료', PARTIAL:'부분입고' };
        var c = { ORDERED:'#2563eb', PARTIAL:'#f59e0b' };
        var s = m[p.value] || p.value;
        return '<span style="color:' + (c[p.value]||'#6b7280') + ';font-weight:700;font-size:11px;">' + s + '</span>';
      }
    },
  ];

  _gridReceiptPo = agGrid.createGrid(el, {
    suppressCellFocus: true,
    suppressPropertyNamesCheck: true,
    columnDefs: colDefs,
    rowData: [],
    rowHeight: 34,
    headerHeight: 34,
    suppressCellFocus: true,
    suppressHorizontalScroll: true,
    rowStyle: { cursor: 'pointer' },
    defaultColDef: {
      sortable: true, resizable: true, suppressMovable: true,
      cellStyle: { display:'flex', alignItems:'center', justifyContent:'center' },
    },
    onRowClicked: function(p) { selectReceiptPo(p.data); },
    overlayNoRowsTemplate: '<span style="color:#9ca3af;font-size:12px;">조회 조건을 입력해 검색하세요.</span>',
    onGridReady: function(params) { setTimeout(function() { if (el.offsetWidth > 0) params.api.sizeColumnsToFit(); }, 0); },
  });
}

async function loadReceiptPoList() {
  var keyword = (document.getElementById('receiptPoKeyword')?.value || '').trim();
  var status  = document.getElementById('receiptPoStatus')?.value || '';
  var dFrom   = document.getElementById('receiptDateFrom')?.value || '';
  var dTo     = document.getElementById('receiptDateTo')?.value   || '';

  showGlobalLoading('발주서 목록을 불러오는 중...');
  try {
    var q = supabaseClient.from('purchase_orders')
      .select('id, order_no, order_date, status, vendors(vendor_name)')
      .order('order_date', { ascending: false });

    if (status) q = q.eq('status', status);
    else        q = q.in('status', ['ORDERED', 'PARTIAL']);
    if (dFrom)   q = q.gte('order_date', dFrom);
    if (dTo)     q = q.lte('order_date', dTo);

    var { data, error } = await q;
    if (error) throw new Error(error.message);

    var rows = (data || []).filter(function(r) {
      if (!keyword) return true;
      return r.order_no.toLowerCase().includes(keyword.toLowerCase()) ||
             (r.vendors?.vendor_name || '').toLowerCase().includes(keyword.toLowerCase());
    });

    if (!_gridReceiptPo) initReceiptPoGrid();
    _gridReceiptPo.setGridOption('rowData', rows);

    var cnt = document.getElementById('receiptPoCount');
    if (cnt) cnt.textContent = rows.length + '건';
  } catch(e) {
    alert('발주서 목록 조회 실패: ' + e.message);
  } finally {
    hideGlobalLoading();
  }
}

async function selectReceiptPo(po) {
  _selectedPoId = po.id;
  var label = document.getElementById('receiptSelectedPoLabel');
  if (label) label.textContent = po.order_no + ' · ' + (po.vendors?.vendor_name || '');

  var { data: poItems, error } = await supabaseClient
    .from('purchase_order_items')
    .select('id, item_id, order_qty, received_qty, unit_price, purchase_unit, use_unit, items(item_name, purchase_unit_qty)')
    .eq('order_id', po.id);
  if (error) { alert('품목 조회 실패: ' + error.message); return; }

  var openItems = (poItems || []).filter(function(r) { return (r.received_qty || 0) < r.order_qty; });

  if (!_gridReceiptItem) initReceiptItemGrid();
  clearReceiptItemGrid();

  openItems.forEach(function(r) {
    var remain = r.order_qty - (r.received_qty || 0);
    addReceiptRow({
      item_id:           r.item_id,
      item_name:         r.items?.item_name || '-',
      purchase_unit:     r.purchase_unit || '',
      purchase_unit_qty: r.items?.purchase_unit_qty || 1,
      use_unit:          r.use_unit || '',
      order_item_id:     r.id,
      order_qty:         r.order_qty,
      received_qty:      r.received_qty || 0,
      qty:               remain,
      unit_price:        r.unit_price || 0,
      supply_price:      remain * (r.unit_price || 0),
      memo:              '',
    });
  });

  var saveBtn = document.getElementById('receiptSaveBtn');
  if (saveBtn) saveBtn.disabled = openItems.length === 0;

  if (openItems.length === 0) {
    alert('이 발주서의 모든 품목이 입고 완료됐습니다.');
  }
}

function initReceiptGrid() {
  var colDefs = [
    { headerName: '입고번호', field: 'receipt_no', width: 140,
      headerClass: 'ag-left-header',
      cellStyle: { display:'flex', alignItems:'center', justifyContent:'flex-start' },
      cellRenderer: function(p) { return '<code style="font-size:11px;">' + ts(p.value || '-') + '</code>'; }
    },
    { headerName: '입고일', field: 'receipt_date', width: 100,
      cellRenderer: function(p) { return fmtDate(p.value); }
    },
    { headerName: '자재명', field: 'items', flex: 2,
      headerClass: 'ag-left-header',
      cellStyle: { display:'flex', alignItems:'center', justifyContent:'flex-start' },
      cellRenderer: function(p) { return ts(p.value?.item_name || '-'); }
    },
    { headerName: '연계 발주', field: 'purchase_orders', width: 130,
      cellRenderer: function(p) { return p.value?.order_no ? '<code style="font-size:11px;">' + ts(p.value.order_no) + '</code>' : '<span style="color:#9ca3af;">직접입고</span>'; }
    },
    { headerName: '입고단위', field: 'purchase_unit', width: 80,
      cellRenderer: function(p) { return ts(p.value || '-'); }
    },
    { headerName: '입고수량', field: 'receipt_qty', width: 80,
      cellStyle: { display:'flex', alignItems:'center', justifyContent:'flex-end' },
      cellRenderer: function(p) { return fmtN(p.value); }
    },
    { headerName: '환산수량(사용단위)', field: 'use_qty', width: 120,
      cellStyle: { display:'flex', alignItems:'center', justifyContent:'flex-end' },
      cellRenderer: function(p) { return fmtN(p.value); }
    },
    { headerName: '단가', field: 'unit_price', width: 100,
      cellStyle: { display:'flex', alignItems:'center', justifyContent:'flex-end' },
      cellRenderer: function(p) { return fmtN(p.value) + '원'; }
    },
    { headerName: '공급가액', field: 'supply_price', width: 110,
      cellStyle: { display:'flex', alignItems:'center', justifyContent:'flex-end' },
      cellRenderer: function(p) { return '<strong>' + fmtN(p.value) + '원</strong>'; }
    },
    { headerName: '부가세', field: 'vat_amount', width: 100,
      cellStyle: { display:'flex', alignItems:'center', justifyContent:'flex-end' },
      cellRenderer: function(p) { return fmtN(p.value) + '원'; }
    },
  ];
  _gridReceipt = createMgGrid('receiptGrid', colDefs, [], { noRowsText: '입고 내역이 없습니다.' });
}

async function loadReceipts(page) {
  var st = stState.receipt;
  if (st.loading) return;
  st.loading = true;
  page = page || st.page;
  showGlobalLoading('입고 목록을 불러오는 중...');
  try {
    var from = (page - 1) * st.pageSize;
    var to   = from + st.pageSize - 1;
    var dateFrom = val('receiptDateFrom');
    var dateTo   = val('receiptDateTo');

    var q = supabaseClient
      .from('stock_receipts')
      .select('*, items(item_name), purchase_orders(order_no)', { count: 'exact' })
      .order('receipt_date', { ascending: false })
      .range(from, to);

    var keyword = (document.getElementById('receiptKeyword')?.value || '').trim();
    if (dateFrom) q = q.gte('receipt_date', dateFrom);
    if (dateTo)   q = q.lte('receipt_date', dateTo);
    if (keyword)  q = q.ilike('receipt_no', '%' + keyword + '%');

    var { data, error, count } = await q;
    if (error) throw new Error(error.message);

    st.page       = page;
    st.totalPages = Math.max(1, Math.ceil((count || 0) / st.pageSize));
    if (!_gridReceipt) initReceiptGrid();
    if (_gridReceipt) _gridReceipt.setGridOption('rowData', data || []);
    renderPagination('receiptPagination', st, loadReceipts);
  } catch(e) {
    alert('입고 목록 로드 실패: ' + e.message);
  } finally {
    st.loading = false;
    hideGlobalLoading();
  }
}

/* ── 입고 등록 모달 ── */
/** 입고 모달의 "연결 발주" select 채우기 — ORDERED/PARTIAL 상태만.
 *  페이지 최초 로드 시 + 입고 모달을 열 때마다 다시 호출해서, 방금 발주확정한
 *  건도 페이지를 새로고침하지 않고 곧바로 목록에 보이게 함. */
async function loadOrderOptions() {
  var { data: orders } = await supabaseClient
    .from('purchase_orders').select('id, order_no')
    .in('status', ['ORDERED', 'PARTIAL'])
    .order('created_at', { ascending: false });
  var oSel = document.getElementById('r_order_id');
  if (oSel) {
    var cur = oSel.value;
    oSel.innerHTML = '<option value="">발주 없이 직접 입고</option>' +
      (orders || []).map(function(o) { return '<option value="' + o.id + '">' + ts(o.order_no) + '</option>'; }).join('');
    if (cur) oSel.value = cur;
  }
}

var _gridReceiptItem  = null;  // 입고 등록 모달의 품목 그리드
var _receiptRowIdCounter = 0;

async function openAddReceipt() {
  setVal('r_order_id', '');
  setVal('r_receipt_date', new Date().toISOString().slice(0, 10));
  setVal('r_vat_amount', '0');
  setVal('r_item_keyword', '');
  _receiptVatTouched = false;
  if (!_gridReceiptItem) initReceiptItemGrid();
  clearReceiptItemGrid();
  if (!_gridReceiptSearch) initReceiptSearchGrid();
  populateReceiptCategorySelect();
  searchReceiptItems();
  refreshReceiptTotal();
  openModal('receiptModal');
  await loadOrderOptions(); // 방금 발주확정한 건도 새로고침 없이 곧바로 목록에 보이도록 매번 재조회
}

/** 좌측 자재 검색 카테고리 select 채우기 */
function populateReceiptCategorySelect() {
  var sel = document.getElementById('r_item_category');
  if (!sel) return;
  var cur = sel.value;
  var cats = [...new Set(itemCache.map(function(i) { return i.category || ''; }))].filter(Boolean).sort();
  sel.innerHTML = '<option value="">전체 카테고리</option>' +
    cats.map(function(c) { return '<option value="' + ts(c) + '">' + ts(c) + '</option>'; }).join('');
  if (cur) sel.value = cur;
}

/** 발주 선택 시 — 그 발주의 미입고 품목들을 그리드에 한 번에 채움 */
async function onReceiptOrderChange() {
  var orderId = val('r_order_id');
  clearReceiptItemGrid();
  if (!orderId) return;

  var { data: poItems, error } = await supabaseClient
    .from('purchase_order_items')
    .select('id, item_id, order_qty, received_qty, unit_price, purchase_unit, use_unit, items(item_name, purchase_unit_qty)')
    .eq('order_id', orderId);
  if (error) { alert('발주 품목 조회 실패: ' + error.message); return; }

  var openItems = (poItems || []).filter(function(r) { return (r.received_qty || 0) < r.order_qty; });
  if (!openItems.length) {
    alert('이 발주서는 모든 품목이 입고 완료되었습니다.');
    return;
  }
  openItems.forEach(function(r) {
    var remain = r.order_qty - (r.received_qty || 0);
    addReceiptRow({
      item_id:           r.item_id,
      item_name:         r.items?.item_name || '-',
      purchase_unit:     r.purchase_unit || '',
      purchase_unit_qty: r.items?.purchase_unit_qty || 1,
      use_unit:          r.use_unit || '',
      order_item_id:     r.id,
      order_qty:         r.order_qty,
      received_qty:      r.received_qty || 0,
      qty:               remain,
      unit_price:        r.unit_price || 0,
      supply_price:      remain * (r.unit_price || 0),
      memo:              '',
    });
  });
}

/* ── 입고 품목 그리드 (발주 품목 일괄 불러오기 + 발주 외 직접 추가) ── */
function initReceiptItemGrid() {
  var el = document.getElementById('receiptItemGrid');
  if (!el || typeof agGrid === 'undefined') return;
  el.style.height = Math.max(200, window.innerHeight - 280) + 'px';

  _gridReceiptItem = agGrid.createGrid(el, {
    suppressCellFocus: true,
    suppressPropertyNamesCheck: true,
    columnDefs: [
      { headerName: '자재명', field: 'item_name', flex: 2,
        headerClass: 'ag-left-header',
        cellStyle: { display:'flex', alignItems:'center', justifyContent:'flex-start', fontWeight:600 },
        cellRenderer: function(p) { return ts(p.value || '-'); }
      },
      { headerName: '입고단위', field: 'purchase_unit', width: 80,
        cellStyle: { display:'flex', alignItems:'center', justifyContent:'center', background:'#f8fafc', color:'#6b7280' },
        cellRenderer: function(p) { return ts(p.value || '-'); }
      },
      { headerName: '발주/잔여', width: 90,
        cellStyle: { display:'flex', alignItems:'center', justifyContent:'center', background:'#f8fafc', color:'#6b7280' },
        cellRenderer: function(p) {
          if (p.data.order_qty == null) return '-';
          var remain = p.data.order_qty - (p.data.received_qty || 0);
          return Number(p.data.order_qty).toLocaleString('ko-KR') + ' / ' + Number(remain).toLocaleString('ko-KR');
        }
      },
      { headerName: '입고수량', field: 'qty', width: 90,
        headerClass: 'ag-right-header',
        cellStyle: { display:'flex', alignItems:'center', justifyContent:'flex-end' },
        editable: true,
        cellEditor: 'agNumberCellEditor',
        cellEditorParams: { min: 1 },
        cellRenderer: function(p) { return Number(p.value || 1).toLocaleString('ko-KR'); },
        onCellValueChanged: function(p) { recalcReceiptFromQtyPrice(p.node); }
      },
      { headerName: '단가 (공급가)', field: 'unit_price', width: 110,
        headerClass: 'ag-right-header',
        cellStyle: { display:'flex', alignItems:'center', justifyContent:'flex-end' },
        editable: true,
        cellEditor: 'agNumberCellEditor',
        cellEditorParams: { min: 0 },
        cellRenderer: function(p) { return Number(p.value || 0).toLocaleString('ko-KR') + '원'; },
        onCellValueChanged: function(p) { recalcReceiptFromQtyPrice(p.node); }
      },
      { headerName: '공급가액', field: 'supply_price', width: 120,
        headerClass: 'ag-right-header',
        cellStyle: { display:'flex', alignItems:'center', justifyContent:'flex-end' },
        editable: true,
        cellEditor: 'agNumberCellEditor',
        cellEditorParams: { min: 0 },
        cellRenderer: function(p) { return '<strong>' + Number(p.value || 0).toLocaleString('ko-KR') + '원</strong>'; },
        onCellValueChanged: function(p) { recalcReceiptFromSupply(p.node); }
      },
      { headerName: '메모', field: 'memo', flex: 1,
        headerClass: 'ag-left-header',
        cellStyle: { display:'flex', alignItems:'center', justifyContent:'flex-start' },
        editable: true,
        cellRenderer: function(p) { return ts(p.value || ''); }
      },
      { headerName: '', width: 44, sortable: false,
        cellStyle: { display:'flex', alignItems:'center', justifyContent:'center', padding:'0' },
        cellRenderer: function(p) {
          var btn = document.createElement('button');
          btn.className = 'tbl-btn tbl-btn--danger';
          btn.style.cssText = 'width:28px;height:22px;padding:0;display:flex;align-items:center;justify-content:center;';
          btn.innerHTML = '✕';
          btn.onclick = function() { removeReceiptRow(p.node.data._rowId); };
          return btn;
        }
      },
    ],
    defaultColDef: {
      sortable: false, resizable: true, suppressMovable: true,
      headerClass: 'ag-center-header',
      cellStyle: { display:'flex', alignItems:'center', justifyContent:'center' },
    },
    rowData: [],
    rowHeight: 34,
    headerHeight: 34,
    suppressHorizontalScroll: true,
    suppressScrollOnNewData: true,
    stopEditingWhenCellsLoseFocus: true,
    singleClickEdit: true,
    overlayNoRowsTemplate: '<span style="color:#9ca3af;font-size:12px;">발주를 선택하거나 왼쪽에서 검색해서 자재를 추가하세요.</span>',
    onGridReady: function(params) { if (el.offsetWidth > 0) params.api.sizeColumnsToFit(); },
  });
}

/* ── 좌측: 자재 검색 그리드 (발주 외 직접 추가용) ── */
var _gridReceiptSearch = null;

function initReceiptSearchGrid() {
  var el = document.getElementById('receiptSearchGrid');
  if (!el || typeof agGrid === 'undefined') return;

  _gridReceiptSearch = agGrid.createGrid(el, {
    suppressCellFocus: true,
    suppressPropertyNamesCheck: true,
    columnDefs: [
      { headerName: '카테고리', field: 'category', width: 90,
        cellStyle: { justifyContent:'center', fontSize:'10px', color:'#6b7280' }
      },
      { headerName: '자재명', field: 'item_name', flex: 2, minWidth: 120,
        headerClass: 'ag-left-header',
        cellStyle: { justifyContent:'flex-start', fontWeight:600 }
      },
      { headerName: '입고단위', field: 'purchase_unit', width: 75,
        cellStyle: { justifyContent:'center', color:'#6b7280' }
      },
      { headerName: '단가', field: 'standard_price', width: 90,
        cellStyle: { justifyContent:'flex-end' },
        valueFormatter: function(p) { return p.value ? Number(p.value).toLocaleString('ko-KR') + '원' : '-'; }
      },
      { headerName: '', width: 56, sortable: false,
        cellStyle: { justifyContent:'center', padding:'0 4px' },
        cellRenderer: function(p) {
          var btn = document.createElement('button');
          btn.className = 'btn btn-sm btn-primary';
          btn.style.cssText = 'padding:2px 8px;font-size:11px;';
          var added = isReceiptItemAdded(p.data.id);
          btn.textContent = added ? '추가됨' : '추가';
          btn.disabled = added;
          if (added) { btn.style.background = '#059669'; btn.style.borderColor = '#059669'; }
          btn.onclick = function() {
            addReceiptRow({
              item_id:           p.data.id,
              item_name:         p.data.item_name,
              purchase_unit:     p.data.purchase_unit || '',
              purchase_unit_qty: p.data.purchase_unit_qty || 1,
              use_unit:          p.data.use_unit || p.data.unit || '',
              qty:               1,
              unit_price:        p.data.standard_price || 0,
              supply_price:      p.data.standard_price || 0,
              memo:              '',
            });
            btn.textContent = '추가됨';
            btn.disabled = true;
            btn.style.background = '#059669';
            btn.style.borderColor = '#059669';
          };
          return btn;
        }
      },
    ],
    rowData: [],
    rowHeight: 34,
    headerHeight: 34,
    suppressCellFocus: true,
    defaultColDef: {
      sortable: true, resizable: true, suppressMovable: true,
      cellStyle: { display:'flex', alignItems:'center', justifyContent:'center' },
    },
    suppressHorizontalScroll: true,
    overlayNoRowsTemplate: '<span style="color:#9ca3af;font-size:12px;">카테고리/자재명을 입력해 검색하세요.</span>',
    onGridReady: function(params) {
      setTimeout(function() { if (el.offsetWidth > 0) params.api.sizeColumnsToFit(); }, 0);
    },
  });
}

function searchReceiptItems() {
  var kw  = (document.getElementById('r_item_keyword')?.value || '').toLowerCase();
  var cat = document.getElementById('r_item_category')?.value || '';
  var filtered = itemCache.filter(function(i) {
    var matchCat = !cat || i.category === cat;
    var matchKw  = !kw  || i.item_name.toLowerCase().includes(kw) || (i.item_code || '').toLowerCase().includes(kw);
    return matchCat && matchKw;
  });
  if (_gridReceiptSearch) _gridReceiptSearch.setGridOption('rowData', filtered);
}

function isReceiptItemAdded(itemId) {
  if (!_gridReceiptItem) return false;
  var found = false;
  _gridReceiptItem.forEachNode(function(n) { if (n.data.item_id === itemId) found = true; });
  return found;
}

function addReceiptRow(preset) {
  if (!_gridReceiptItem) initReceiptItemGrid();
  _receiptRowIdCounter++;
  var row = Object.assign({
    _rowId:        _receiptRowIdCounter,
    item_id:       '',
    item_name:     '',
    purchase_unit: '',
    use_unit:      '',
    qty:           1,
    unit_price:    0,
    supply_price:  0,
    memo:          '',
  }, preset || {});
  if (_gridReceiptItem) {
    _gridReceiptItem.applyTransaction({ add: [row] });
    refreshReceiptTotal();
    updateReceiptItemCount();
  }
}

function removeReceiptRow(rowId) {
  if (!_gridReceiptItem) return;
  var toRemove = null;
  _gridReceiptItem.forEachNode(function(node) { if (node.data._rowId === rowId) toRemove = node.data; });
  if (toRemove) {
    _gridReceiptItem.applyTransaction({ remove: [toRemove] });
    refreshReceiptTotal();
    updateReceiptItemCount();
    if (_gridReceiptSearch) _gridReceiptSearch.refreshCells({ force: true });
  }
}

function clearReceiptItemGrid() {
  if (!_gridReceiptItem) return;
  var all = [];
  _gridReceiptItem.forEachNode(function(n) { all.push(n.data); });
  if (all.length) _gridReceiptItem.applyTransaction({ remove: all });
  refreshReceiptTotal();
  updateReceiptItemCount();
}

function updateReceiptItemCount() {
  var cnt = 0;
  if (_gridReceiptItem) _gridReceiptItem.forEachNode(function() { cnt++; });
  var el = document.getElementById('receiptItemCount');
  if (el) el.textContent = cnt ? cnt + '건' : '';
}

/** 수량/단가 변경 시 공급가액 재계산 — setDataValue 대신 직접 수정 + refreshCells를
 *  사용해서, 공급가액 컬럼의 "직접수정 감지" onCellValueChanged를 잘못 발생시키지 않게 함
 *  (그러면 두번째 수정부터 자동계산이 멈추는 버그가 생김 — 발주 모달에서 겪었던 것과 동일) */
/** 입고수량 또는 단가를 고쳤을 때 — 공급가액 = 수량 × 단가로 다시 계산 */
function recalcReceiptFromQtyPrice(node) {
  var qty   = Number(node.data.qty        || 1);
  var price = Number(node.data.unit_price || 0);
  var sp    = qty * price;
  node.setDataValue('supply_price', sp);
  refreshReceiptTotal();
}

/** 공급가액을 직접 고쳤을 때 — 거래처 세금계산서 기준 공급가에 맞춰 단가를 거꾸로 재계산
 *  (입고수량은 실제 받은 수량이라 그대로 두고, 단가 = 공급가액 ÷ 수량) */
function recalcReceiptFromSupply(node) {
  var qty = Number(node.data.qty || 1);
  if (qty > 0) {
    var up = Math.round(Number(node.data.supply_price || 0) / qty);
    node.setDataValue('unit_price', up);
  }
  refreshReceiptTotal();
}

function refreshReceiptTotal() {
  var supplyTotal = 0;
  if (_gridReceiptItem) {
    _gridReceiptItem.forEachNode(function(node) { supplyTotal += Number(node.data.supply_price || 0); });
  }
  var vatInput = document.getElementById('r_vat_amount');
  if (vatInput && !_receiptVatTouched) vatInput.value = calcVat(supplyTotal);
  var vat   = Number(vatInput?.value || 0);
  var total = supplyTotal + vat;
  var s = document.getElementById('rTotalSupply');
  var t = document.getElementById('rTotalAmount');
  if (s) s.textContent = fmtN(supplyTotal) + '원';
  if (t) t.textContent = fmtN(total) + '원';
}

/** 부가세 입력칸을 사용자가 직접 수정했을 때 — 이후 품목 변경으로 자동계산되어 덮어써지지 않도록 표시 */
function onReceiptVatInput() {
  _receiptVatTouched = true;
  refreshReceiptTotal();
}

async function saveReceipt() {
  // ── 사전 검증 (try 바깥 — 로딩 없이 즉시 alert) ──
  if (!_gridReceiptItem) { alert('처리할 품목이 없습니다.'); return; }
  var rows = [];
  _gridReceiptItem.forEachNode(function(node) { rows.push(node.data); });
  if (!rows.length) { alert('입고할 품목을 1개 이상 추가해주세요.'); return; }

  var invalid = rows.find(function(r) { return !r.qty || r.qty < 1; });
  if (invalid) { alert(invalid.item_name + '의 입고수량은 1 이상이어야 합니다.'); return; }

  var receiptDate = val('receiptDate');
  if (!receiptDate) { alert('입고일을 입력해주세요.'); return; }

  var orderId = _selectedPoId || null;
  var overRow = rows.find(function(r) {
    return r.order_qty != null && r.qty > (r.order_qty - (r.received_qty || 0));
  });
  if (overRow) {
    var remain = overRow.order_qty - (overRow.received_qty || 0);
    if (!confirm(overRow.item_name + '의 입고수량이 발주 잔여수량(' + remain + ')을 초과합니다. 계속하시겠습니까?')) return;
  }

  // ── 저장 처리 ──
  var saveBtn = document.getElementById('receiptSaveBtn');
  if (saveBtn) saveBtn.disabled = true;
  showGlobalLoading('입고 등록 중...');
  try {
  var vatTotal     = Number(val('r_vat_amount') || 0);
  var supplyTotal  = rows.reduce(function(sum, r) { return sum + Number(r.supply_price || 0); }, 0);
  var vatAssigned  = 0;
  var touchedOrders = new Set();

  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    var qty   = Number(r.qty);
    var price = Number(r.unit_price || 0);
    var supply = Number(r.supply_price || 0);

    // 부가세를 각 행의 공급가액 비중대로 배분 (마지막 행은 나머지를 받아 합계가 정확히 맞도록)
    var vatShare;
    if (i === rows.length - 1) {
      vatShare = vatTotal - vatAssigned;
    } else {
      vatShare = supplyTotal > 0 ? Math.round(vatTotal * (supply / supplyTotal)) : 0;
      vatAssigned += vatShare;
    }

    var receiptNo = await genDocNo('RC');
    var { error } = await supabaseClient.from('stock_receipts').insert({
      receipt_no:        receiptNo,
      item_id:           r.item_id,
      order_id:          orderId,
      order_item_id:     r.order_item_id || null,
      receipt_date:      receiptDate,
      purchase_unit:     r.purchase_unit,
      purchase_unit_qty: r.purchase_unit_qty || 1,
      receipt_qty:       qty,
      unit_price:        price,
      vat_amount:        vatShare,
      memo:              r.memo || '',
    });
    if (error) throw new Error('[' + r.item_name + '] ' + error.message);

    // stock_transactions에 IN 기록 (중앙창고, dept_id=NULL)
    var useQty = qty * (r.purchase_unit_qty || 1);
    var { error: te } = await supabaseClient.from('stock_transactions').insert({
      item_id:  r.item_id,
      dept_id:  null,
      tx_type:  'IN',
      tx_date:  receiptDate,
      qty:      useQty,
      use_unit: r.use_unit || '',
      ref_type: 'receipt',
      memo:     r.memo || '',
    });
    if (te) throw new Error('[' + r.item_name + '] 이력 기록 실패: ' + te.message);

    // 중앙창고 재고 적립
    await upsertStockCurrent(r.item_id, useQty, null);

    // 발주서 품목별 입고 처리 (부분입고)
    if (r.order_item_id) {
      var newReceived = (r.received_qty || 0) + qty;
      await supabaseClient.from('purchase_order_items')
        .update({ received_qty: newReceived }).eq('id', r.order_item_id);
      if (orderId) touchedOrders.add(orderId);
    }
  }

  for (var oid of touchedOrders) {
    await recalcOrderStatus(oid);
  }

    // ── 성공 처리 ──
    alert('입고 등록이 완료됐습니다.');
    // 우측 그리드/합계 리셋
    clearReceiptItemGrid();
    _selectedPoId = null;
    var label = document.getElementById('receiptSelectedPoLabel');
    if (label) label.textContent = '';
    var saveBtn2 = document.getElementById('receiptSaveBtn');
    if (saveBtn2) saveBtn2.disabled = true;
    // 발주서 목록 갱신
    loadReceiptPoList();

  } catch(e) {
    if (e.message !== '입고 취소됨') alert('입고 등록 실패: ' + e.message);
  } finally {
    hideGlobalLoading();
    var saveBtn3 = document.getElementById('receiptSaveBtn');
    if (saveBtn3) saveBtn3.disabled = false;
  }
}

/** 발주서의 모든 품목 입고 상태를 보고 PARTIAL/COMPLETED 로 갱신 + 연계 발주요청 상태 동기화 */
async function recalcOrderStatus(orderId) {
  var { data: items } = await supabaseClient
    .from('purchase_order_items').select('order_qty, received_qty').eq('order_id', orderId);
  if (!items || !items.length) return;

  var allDone  = items.every(function(i) { return (i.received_qty || 0) >= i.order_qty; });
  var anyDone  = items.some(function(i) { return (i.received_qty || 0) > 0; });
  var newStatus = allDone ? 'COMPLETED' : (anyDone ? 'PARTIAL' : null);
  if (newStatus) {
    await supabaseClient.from('purchase_orders')
      .update({ status: newStatus, updated_at: new Date().toISOString() }).eq('id', orderId);
  }
  await syncLinkedRequestStatuses(orderId);
}

/** 발주요청 상태를 발주서 진행상황에 맞춰 재계산 (procurement.js 와 동일 로직의 로컬 사본) */
async function syncLinkedRequestStatuses(orderId) {
  try {
    var { data: poItems } = await supabaseClient
      .from('purchase_order_items').select('id').eq('order_id', orderId);
    var poItemIds = (poItems || []).map(function(i) { return i.id; });
    if (!poItemIds.length) return;

    var { data: reqItems } = await supabaseClient
      .from('purchase_request_items').select('request_id, order_item_id').in('order_item_id', poItemIds);
    var requestIds = Array.from(new Set((reqItems || []).map(function(r) { return r.request_id; })));

    for (var i = 0; i < requestIds.length; i++) {
      var { data: items } = await supabaseClient
        .from('purchase_request_items')
        .select('order_item_id, purchase_order_items(order_qty, received_qty, purchase_orders(status))')
        .eq('request_id', requestIds[i]);
      var linked = (items || []).filter(function(it) { return it.order_item_id; });
      if (!linked.length) continue;
      var statuses = linked.map(function(it) { return it.purchase_order_items?.purchase_orders?.status; });
      var newStatus = 'PROCESSING';
      if (statuses.every(function(s) { return s === 'COMPLETED'; })) newStatus = 'COMPLETED';
      else if (statuses.some(function(s) { return s === 'PARTIAL' || s === 'COMPLETED'; })) newStatus = 'PARTIAL';
      else if (statuses.some(function(s) { return s === 'ORDERED'; })) newStatus = 'ORDERED';

      await supabaseClient.from('purchase_requests')
        .update({ status: newStatus, updated_at: new Date().toISOString() }).eq('id', requestIds[i]);
    }
  } catch(e) {
    console.warn('[syncLinkedRequestStatuses]', e);
  }
}

/* ════════════════════════════════
   불출 탭 — 중앙창고 → 부서
════════════════════════════════ */


/* ══════════════════════════════════════════
   불출 탭 — 우측: 선택된 품목 ag-grid
══════════════════════════════════════════ */
var _gridDispatchItem = null;
var _dispatchRowId    = 0;

function initDispatchItemGrid() {
  var el = document.getElementById('dispatchItemGrid');
  if (!el || typeof agGrid === 'undefined') return;
  el.style.height = Math.max(200, window.innerHeight - 280) + 'px';

  var colDefs = [
    { headerName: '자재명', field: 'item_name', flex: 2, minWidth: 120,
      headerClass: 'ag-left-header',
      cellStyle: { display:'flex', alignItems:'center', justifyContent:'flex-start', fontWeight:600 }
    },
    { headerName: '단위', field: 'use_unit', width: 65,
      cellStyle: { display:'flex', alignItems:'center', justifyContent:'center', color:'#6b7280' }
    },
    { headerName: '현재고', field: 'current_qty', width: 80,
      cellStyle: { display:'flex', alignItems:'center', justifyContent:'flex-end', color:'#059669' },
      valueFormatter: function(p) { return Number(p.value||0).toLocaleString('ko-KR'); }
    },
    { headerName: '불출수량', field: 'qty', width: 90,
      cellStyle: { display:'flex', alignItems:'center', justifyContent:'flex-end' },
      editable: true, singleClickEdit: true,
      cellEditor: 'agNumberCellEditor',
      cellEditorParams: { min: 1 },
      valueFormatter: function(p) { return Number(p.value||1).toLocaleString('ko-KR'); },
      onCellValueChanged: function(p) {
        var max = p.data.current_qty || 9999;
        if (p.newValue > max) p.node.setDataValue('qty', max);
        updateDispatchSummary();
      }
    },
    { headerName: '', width: 44, sortable: false,
      cellStyle: { display:'flex', alignItems:'center', justifyContent:'center', padding:'0' },
      cellRenderer: function(p) {
        var btn = document.createElement('button');
        btn.style.cssText = 'width:26px;height:22px;border:none;background:none;color:#ef4444;font-size:16px;cursor:pointer;';
        btn.textContent = '×';
        btn.onclick = function() {
          removeDispatchItemRow(p.data._rowId);
        };
        return btn;
      }
    },
  ];

  _gridDispatchItem = agGrid.createGrid(el, {
    suppressCellFocus: true,
    suppressPropertyNamesCheck: true,
    columnDefs: colDefs,
    rowData: [],
    rowHeight: 34,
    headerHeight: 34,
    suppressHorizontalScroll: true,
    stopEditingWhenCellsLoseFocus: true,
    defaultColDef: {
      sortable: false, resizable: true, suppressMovable: true,
      cellStyle: { display:'flex', alignItems:'center', justifyContent:'center' },
    },
    overlayNoRowsTemplate: '<span style="color:#9ca3af;font-size:12px;">← 왼쪽에서 자재를 선택하세요</span>',
    onGridReady: function(params) {
      setTimeout(function() { if (el.offsetWidth > 0) params.api.sizeColumnsToFit(); }, 0);
    },
  });
}

function addDispatchItemRow(stockRow) {
  if (!_gridDispatchItem) return;
  // 중복 체크
  var dup = false;
  _gridDispatchItem.forEachNode(function(n) { if (n.data.item_id === stockRow.item_id) dup = true; });
  if (dup) return;

  _dispatchRowId++;
  _gridDispatchItem.applyTransaction({ add: [{
    _rowId:      _dispatchRowId,
    item_id:     stockRow.item_id,
    item_name:   stockRow.item_name,
    use_unit:    stockRow.use_unit,
    current_qty: stockRow.qty,
    qty:         1,
  }]});
  updateDispatchSummary();
}

function removeDispatchItemRow(rowId) {
  if (!_gridDispatchItem) return;
  var toRemove = null;
  _gridDispatchItem.forEachNode(function(n) { if (n.data._rowId === rowId) toRemove = n.data; });
  if (toRemove) {
    _gridDispatchItem.applyTransaction({ remove: [toRemove] });
    updateDispatchSummary();
    if (_gridDispatchStock) _gridDispatchStock.refreshCells({ force: true });
  }
}

function clearDispatchItemGrid() {
  if (!_gridDispatchItem) return;
  var rows = [];
  _gridDispatchItem.forEachNode(function(n) { rows.push(n.data); });
  if (rows.length) _gridDispatchItem.applyTransaction({ remove: rows });
  updateDispatchSummary();
  if (_gridDispatchStock) _gridDispatchStock.refreshCells({ force: true });
}

function updateDispatchSummary() {
  var cnt = 0;
  if (_gridDispatchItem) _gridDispatchItem.forEachNode(function() { cnt++; });
  var el = document.getElementById('dispatchItemCount');
  if (el) el.textContent = cnt ? cnt + '건' : '';
  var btn = document.getElementById('dispatchSaveBtn');
  if (btn) btn.disabled = cnt === 0;
  var sum = document.getElementById('dispatchSummary');
  if (sum) sum.textContent = cnt ? cnt + '개 품목 선택됨' : '선택된 품목이 없습니다';
}

/* ══════════════════════════════════════════
   불출 탭 — 좌측: 중앙창고 현재고 그리드
══════════════════════════════════════════ */
var _gridDispatchStock = null;
var _dispatchItems     = [];   // 우측 선택된 품목 [{item_id, item_name, use_unit, current_qty, qty}]

function initDispatchStockGrid() {
  var el = document.getElementById('dispatchStockGrid');
  if (!el || typeof agGrid === 'undefined') return;

  var colDefs = [
    { headerName: '카테고리', field: 'category', width: 90,
      cellStyle: { justifyContent:'center', fontSize:'10px', color:'#6b7280' }
    },
    { headerName: '자재명', field: 'item_name', flex: 2, minWidth: 120,
      headerClass: 'ag-left-header',
      cellStyle: { display:'flex', alignItems:'center', justifyContent:'flex-start', fontWeight:600 }
    },
    { headerName: '단위', field: 'use_unit', width: 60,
      cellStyle: { justifyContent:'center', color:'#6b7280' }
    },
    { headerName: '현재고', field: 'qty', width: 80,
      cellStyle: { justifyContent:'flex-end' },
      cellRenderer: function(p) {
        var color = p.value <= 0 ? '#dc2626' : '#059669';
        return '<span style="color:' + color + ';font-weight:700;">' + Number(p.value||0).toLocaleString('ko-KR') + '</span>';
      }
    },
    { headerName: '', width: 52, sortable: false,
      cellStyle: { justifyContent:'center', padding:'0 4px' },
      cellRenderer: function(p) {
        var btn = document.createElement('button');
        btn.className = 'btn btn-sm btn-primary';
        btn.style.cssText = 'padding:2px 8px;font-size:11px;';
        var added = _dispatchItems.some(function(i) { return i.item_id === p.data.item_id; });
        btn.textContent = added ? '추가됨' : '추가';
        if (added) { btn.style.background = '#059669'; btn.style.borderColor = '#059669'; }
        btn.onclick = function() {
          if (!p.data.qty || p.data.qty <= 0) { alert('현재고가 없습니다.'); return; }
          addDispatchItem(p.data);
          btn.textContent = '추가됨';
          btn.style.background = '#059669';
          btn.style.borderColor = '#059669';
        };
        return btn;
      }
    },
  ];

  _gridDispatchStock = agGrid.createGrid(el, {
    suppressCellFocus: true,
    suppressPropertyNamesCheck: true,
    columnDefs: colDefs,
    rowData: [],
    rowHeight: 34,
    headerHeight: 34,
    suppressCellFocus: true,
    suppressHorizontalScroll: true,
    defaultColDef: {
      sortable: true, resizable: true, suppressMovable: true,
      cellStyle: { display:'flex', alignItems:'center', justifyContent:'center' },
    },
    overlayNoRowsTemplate: '<span style="color:#9ca3af;font-size:12px;">검색 조건을 입력하세요.</span>',
    onGridReady: function(params) { setTimeout(function() { if (el.offsetWidth > 0) params.api.sizeColumnsToFit(); }, 0); },
  });
}

async function loadDispatchStock() {
  var kw  = (document.getElementById('dispatchKeyword')?.value || '').toLowerCase();
  var cat = document.getElementById('dispatchCategoryFilter')?.value || '';

  showGlobalLoading('재고를 불러오는 중...');
  try {
    var { data, error } = await supabaseClient
      .from('stock_current')
      .select('item_id, qty, items(item_name, category, use_unit)')
      .is('dept_id', null)
      .gt('qty', 0);
    if (error) throw new Error(error.message);

    var rows = (data || []).map(function(r) {
      return {
        item_id:   r.item_id,
        item_name: r.items?.item_name || '-',
        category:  r.items?.category  || '-',
        use_unit:  r.items?.use_unit  || '',
        qty:       r.qty,
      };
    }).filter(function(r) {
      var matchKw  = !kw  || r.item_name.toLowerCase().includes(kw);
      var matchCat = !cat || r.category === cat;
      return matchKw && matchCat;
    });

    if (!_gridDispatchStock) initDispatchStockGrid();
    _gridDispatchStock.setGridOption('rowData', rows);

    var cnt = document.getElementById('dispatchStockCount');
    if (cnt) cnt.textContent = rows.length + '건';
  } catch(e) {
    alert('재고 조회 실패: ' + e.message);
  } finally {
    hideGlobalLoading();
  }
}

function addDispatchItem(stockRow) {
  addDispatchItemRow(stockRow);
}

function renderDispatchRight() {
  var body = document.getElementById('dispatchRightBody');
  var cnt  = document.getElementById('dispatchItemCount');
  var btn  = document.getElementById('dispatchSaveBtn');
  var summary = document.getElementById('dispatchSummary');
  if (!body) return;

  if (!_dispatchItems.length) {
    body.innerHTML = '<div class="panel-empty"><i class="ti ti-arrow-left"></i><span>왼쪽에서 자재를 선택하세요</span></div>';
    if (cnt) cnt.textContent = '';
    if (btn) btn.disabled = true;
    if (summary) summary.textContent = '선택된 품목이 없습니다';
    return;
  }

  body.innerHTML = _dispatchItems.map(function(item, idx) {
    return '<div class="dispatch-item-row" data-idx="' + idx + '">' +
      '<div class="dispatch-item-name">' + ts(item.item_name) + '</div>' +
      '<div class="dispatch-item-stock">재고: ' + Number(item.current_qty).toLocaleString('ko-KR') + '</div>' +
      '<input type="number" class="dispatch-qty-input" min="1" max="' + item.current_qty + '" value="' + item.qty + '" ' +
        'onchange="updateDispatchQty(' + idx + ', this.value)" />' +
      '<div class="dispatch-item-unit">' + ts(item.use_unit) + '</div>' +
      '<button class="dispatch-item-remove" onclick="removeDispatchItem(' + idx + ')">×</button>' +
    '</div>';
  }).join('');

  if (cnt) cnt.textContent = _dispatchItems.length + '건';
  if (btn) btn.disabled = !_dispatchItems.length;
  if (summary) summary.textContent = _dispatchItems.length + '개 품목 선택됨';
}

function updateDispatchQty(idx, value) {
  var qty = Math.max(1, Math.min(Number(value) || 1, _dispatchItems[idx]?.current_qty || 9999));
  if (_dispatchItems[idx]) _dispatchItems[idx].qty = qty;
}

function removeDispatchItem(idx) {
  _dispatchItems.splice(idx, 1);
  renderDispatchRight();
  if (_gridDispatchStock) _gridDispatchStock.refreshCells({ force: true });
}

function clearDispatchItems() {
  clearDispatchItemGrid();
}

async function saveDispatch() {
  var _dispatchItems = [];
  if (_gridDispatchItem) _gridDispatchItem.forEachNode(function(n) { _dispatchItems.push(n.data); });
  if (!_dispatchItems.length) { alert('불출할 품목을 선택하세요.'); return; }
  var deptId     = val('dispatchDeptTarget');
  var dispatchDate = val('dispatchDate');
  if (!deptId)       { alert('불출 대상 부서를 선택하세요.'); return; }
  if (!dispatchDate) { alert('불출일을 입력하세요.'); return; }

  // 수량 초과 검증
  var overItems = _dispatchItems.filter(function(i) { return i.qty > i.current_qty; });
  if (overItems.length) {
    alert('현재고 초과:\n' + overItems.map(function(i) {
      return i.item_name + ' (재고:' + i.current_qty + ', 요청:' + i.qty + ')';
    }).join('\n'));
    return;
  }

  var btn = document.getElementById('dispatchSaveBtn');
  btn.disabled = true;
  showGlobalLoading('불출 처리 중...');
  try {
    var session = await supabaseClient.auth.getSession();
    var userId  = session.data?.session?.user?.id || null;

    for (var i = 0; i < _dispatchItems.length; i++) {
      var item = _dispatchItems[i];

      // stock_dispatch 기록
      var dispatchNo = await genDocNo('SD');
      var { data: newDispatch, error: de } = await supabaseClient.from('stock_dispatch').insert({
        dispatch_no:   dispatchNo,
        item_id:       item.item_id,
        dept_id:       deptId,
        dispatch_date: dispatchDate,
        qty:           item.qty,
        use_unit:      item.use_unit,
        created_by:    userId,
      }).select().single();
      if (de) throw new Error('불출 기록 실패: ' + de.message);

      // stock_transactions (중앙창고 OUT + 부서 IN)
      var txs = [
        { item_id: item.item_id, dept_id: null,   tx_type:'OUT', tx_date: dispatchDate, qty: -item.qty, use_unit: item.use_unit, ref_type:'dispatch', ref_id: newDispatch.id, created_by: userId },
        { item_id: item.item_id, dept_id: deptId, tx_type:'IN',  tx_date: dispatchDate, qty:  item.qty, use_unit: item.use_unit, ref_type:'dispatch', ref_id: newDispatch.id, created_by: userId },
      ];
      var { error: te } = await supabaseClient.from('stock_transactions').insert(txs);
      if (te) throw new Error('재고 이동 실패: ' + te.message);
    }

    var cnt = _dispatchItems.length;
    clearDispatchItems();
    loadDispatchStock();
    alert(cnt + '개 품목 일괄 불출 완료!');
  } catch(e) {
    alert('불출 실패: ' + e.message);
  } finally {
    btn.disabled = false;
    hideGlobalLoading();
  }
}

function initDispatchGrid() {
  var colDefs = [
    { headerName: '불출번호', field: 'dispatch_no', width: 140,
      headerClass: 'ag-left-header',
      cellStyle: { display:'flex', alignItems:'center', justifyContent:'flex-start' },
      cellRenderer: function(p) { return '<code style="font-size:11px;">' + ts(p.value || '-') + '</code>'; }
    },
    { headerName: '불출일', field: 'dispatch_date', width: 100,
      cellRenderer: function(p) { return fmtDate(p.value); }
    },
    { headerName: '자재명', field: 'items', flex: 2,
      headerClass: 'ag-left-header',
      cellStyle: { display:'flex', alignItems:'center', justifyContent:'flex-start' },
      cellRenderer: function(p) { return ts(p.value?.item_name || '-'); }
    },
    { headerName: '받은 부서', field: 'departments', flex: 1,
      headerClass: 'ag-left-header',
      cellStyle: { display:'flex', alignItems:'center', justifyContent:'flex-start' },
      cellRenderer: function(p) { return ts(p.value?.dept_name || '-'); }
    },
    { headerName: '불출수량', field: 'dispatch_qty', width: 100,
      cellStyle: { display:'flex', alignItems:'center', justifyContent:'flex-end' },
      cellRenderer: function(p) { return fmtN(p.value) + ' ' + ts(p.data.use_unit || ''); }
    },
    { headerName: '메모', field: 'memo', flex: 1,
      headerClass: 'ag-left-header',
      cellStyle: { display:'flex', alignItems:'center', justifyContent:'flex-start' },
      cellRenderer: function(p) { return ts(p.value || '-'); }
    },
  ];
  _gridDispatch = createMgGrid('dispatchGrid', colDefs, [], { noRowsText: '불출 내역이 없습니다.' });
}

async function loadDispatches(page) {
  var st = stState.dispatch;
  if (st.loading) return;
  st.loading = true;
  page = page || st.page;
  showGlobalLoading('불출 목록을 불러오는 중...');
  try {
    var from = (page - 1) * st.pageSize;
    var to   = from + st.pageSize - 1;
    var deptId   = val('dispatchDeptFilter');
    var dateFrom = val('dispatchDateFrom');
    var dateTo   = val('dispatchDateTo');

    var q = supabaseClient
      .from('stock_dispatch')
      .select('*, items(item_name), departments(dept_name)', { count: 'exact' })
      .order('dispatch_date', { ascending: false })
      .range(from, to);

    var dispatchKw = (document.getElementById('dispatchKeyword')?.value || '').trim();
    if (deptId)      q = q.eq('dept_id', deptId);
    if (dateFrom)    q = q.gte('dispatch_date', dateFrom);
    if (dateTo)      q = q.lte('dispatch_date', dateTo);
    if (dispatchKw)  q = q.ilike('dispatch_no', '%' + dispatchKw + '%');

    var { data, error, count } = await q;
    if (error) throw new Error(error.message);

    st.page       = page;
    st.totalPages = Math.max(1, Math.ceil((count || 0) / st.pageSize));
    if (!_gridDispatch) initDispatchGrid();
    if (_gridDispatch) _gridDispatch.setGridOption('rowData', data || []);
    renderPagination('dispatchPagination', st, loadDispatches);
  } catch(e) {
    alert('불출 목록 로드 실패: ' + e.message);
  } finally {
    st.loading = false;
    hideGlobalLoading();
  }
}

function openAddDispatch() {
  setVal('d_item_id', '');
  setVal('d_dept_id', '');
  setVal('d_dispatch_date', new Date().toISOString().slice(0, 10));
  setVal('d_qty', '1');
  setVal('d_memo', '');
  document.getElementById('dUseUnit').textContent    = '-';
  document.getElementById('dCurrentQty').textContent = '-';
  openModal('dispatchModal');
}

function updateDispatchInfo() {
  var itemId = val('d_item_id');
  var item   = itemCache.find(function(it) { return it.id === itemId; });
  document.getElementById('dUseUnit').textContent    = item ? (item.use_unit || item.unit || '-') : '-';
  document.getElementById('dCurrentQty').textContent = item ? (fmtN(centralCache[itemId] || 0) + ' ' + (item.use_unit || '')) : '-';
}

async function saveDispatch() {
  var itemId = val('d_item_id');
  var deptId = val('d_dept_id');
  if (!itemId) throw new Error('자재를 선택해주세요.');
  if (!deptId) throw new Error('받을 부서를 선택해주세요.');
  var item = itemCache.find(function(it) { return it.id === itemId; });
  var qty  = Number(val('d_qty') || 0);
  if (qty < 1) throw new Error('불출 수량은 1 이상이어야 합니다.');

  var central = await getStockQty(itemId, null);
  if (qty > central) throw new Error('불출 수량(' + qty + ')이 중앙창고 현재고(' + central + ')를 초과합니다.');

  var dispatchNo = await genDocNo('SD');
  var useUnit = item?.use_unit || item?.unit || '';

  var { data: newDispatch, error } = await supabaseClient.from('stock_dispatch').insert({
    dispatch_no:   dispatchNo,
    item_id:       itemId,
    dept_id:       deptId,
    dispatch_date: val('d_dispatch_date'),
    dispatch_qty:  qty,
    use_unit:      useUnit,
    memo:          val('d_memo'),
  }).select().single();
  if (error) throw new Error(error.message);

  // 이력: 중앙창고 OUT, 부서 IN
  var { error: te1 } = await supabaseClient.from('stock_transactions').insert([
    { item_id: itemId, dept_id: null,   tx_type: 'OUT', tx_date: val('d_dispatch_date'), qty: -qty, use_unit: useUnit, ref_type: 'dispatch', ref_id: newDispatch.id, memo: val('d_memo') },
    { item_id: itemId, dept_id: deptId, tx_type: 'IN',  tx_date: val('d_dispatch_date'), qty:  qty, use_unit: useUnit, ref_type: 'dispatch', ref_id: newDispatch.id, memo: val('d_memo') },
  ]);
  if (te1) throw new Error('이력 기록 실패: ' + te1.message);

  await upsertStockCurrent(itemId, -qty, null);
  await upsertStockCurrent(itemId,  qty, deptId);
}

/* ════════════════════════════════
   부서별재고 탭
════════════════════════════════ */
function initDeptStockGrid() {
  var colDefs = [
    { headerName: '부서', field: 'departments', flex: 1,
      headerClass: 'ag-left-header',
      cellStyle: { display:'flex', alignItems:'center', justifyContent:'flex-start' },
      cellRenderer: function(p) { return ts(p.value?.dept_name || '-'); }
    },
    { headerName: '자재명', field: 'items', flex: 2,
      headerClass: 'ag-left-header',
      cellStyle: { display:'flex', alignItems:'center', justifyContent:'flex-start' },
      cellRenderer: function(p) { return ts(p.value?.item_name || '-'); }
    },
    { headerName: '사용단위', field: 'items', width: 80,
      cellRenderer: function(p) { return ts(p.value?.use_unit || p.value?.unit || '-'); }
    },
    { headerName: '현재고', field: 'qty', width: 100,
      cellStyle: { display:'flex', alignItems:'center', justifyContent:'flex-end' },
      cellRenderer: function(p) {
        var qty = p.value || 0;
        var item = p.data?.items;
        var reorder = item?.reorder_point;
        var cls = qty === 0 ? 'stock-qty-zero' : (reorder && qty <= reorder ? 'stock-qty-low' : 'stock-qty-ok');
        return '<span class="' + cls + '">' + fmtN(qty) + '</span>';
      }
    },
    { headerName: '최종갱신', field: 'last_updated_at', width: 140,
      cellRenderer: function(p) {
        return p.value ? new Date(p.value).toLocaleString('ko-KR',{hour12:false}).slice(0,16) : '-';
      }
    },
  ];
  _gridDeptStock = createMgGrid('deptStockGrid', colDefs, [], { noRowsText: '부서별 재고 데이터가 없습니다.' });
}

async function loadDeptStock(page) {
  var st = stState.deptstock;
  if (st.loading) return;
  st.loading = true;
  page = page || st.page;
  showGlobalLoading('부서별 재고를 불러오는 중...');
  try {
    var from = (page - 1) * st.pageSize;
    var to   = from + st.pageSize - 1;
    var deptId  = val('deptStockDeptFilter');
    var keyword = val('deptStockKeyword');

    var q = supabaseClient
      .from('stock_current')
      .select('*, items(item_name, use_unit, unit, reorder_point), departments(dept_name)', { count: 'exact' })
      .not('dept_id', 'is', null)
      .order('last_updated_at', { ascending: false })
      .range(from, to);

    if (deptId) q = q.eq('dept_id', deptId);
    if (keyword) {
      var { data: matchItems } = await supabaseClient
        .from('items').select('id').ilike('item_name', '%' + keyword + '%');
      var ids = (matchItems || []).map(function(m) { return m.id; });
      if (ids.length) q = q.in('item_id', ids);
      else { _gridDeptStock?.setGridOption('rowData', []); st.loading = false; hideGlobalLoading(); return; }
    }

    var { data, error, count } = await q;
    if (error) throw new Error(error.message);

    st.page       = page;
    st.totalPages = Math.max(1, Math.ceil((count || 0) / st.pageSize));
    if (!_gridDeptStock) initDeptStockGrid();
    if (_gridDeptStock) _gridDeptStock.setGridOption('rowData', data || []);
    renderPagination('deptStockPagination', st, loadDeptStock);
  } catch(e) {
    alert('부서별 재고 로드 실패: ' + e.message);
  } finally {
    st.loading = false;
    hideGlobalLoading();
  }
}

/* ── 자재/부서 캐시 로드 ── */
async function loadCaches() {
  var { data: items } = await supabaseClient
    .from('items')
    .select('id, item_name, category, purchase_unit, use_unit, purchase_unit_qty, unit, reorder_point, safety_stock, standard_price')
    .eq('active', 'Y')
    .order('item_name');
  itemCache = items || [];

  var { data: depts } = await supabaseClient
    .from('departments').select('id, dept_name').eq('active', 'Y').order('sort_order');
  deptCache = depts || [];

  // 입고/불출 모달 자재 select 채우기
  var opts = '<option value="">자재 선택</option>' +
    itemCache.map(function(it) { return '<option value="' + it.id + '">' + ts(it.item_name) + '</option>'; }).join('');
  var _dEl = document.getElementById('d_item_id'); if (_dEl) _dEl.innerHTML = opts;

  // 부서 select 채우기 (필터들 + 모달)
  var deptOpts = deptCache.map(function(d) { return '<option value="' + d.id + '">' + ts(d.dept_name) + '</option>'; }).join('');
  ['dispatchDeptFilter', 'd_dept_id', 'deptStockDeptFilter', 'dispatchDeptTarget'].forEach(function(id) {
    var el = document.getElementById(id);
    if (!el) return;
    var placeholder = id === 'd_dept_id' ? '<option value="">부서 선택</option>' : '<option value="">전체</option>';
    el.innerHTML = placeholder + deptOpts;
  });

  // 중앙창고(dept_id=NULL) 현재고 캐시
  var { data: sc } = await supabaseClient.from('stock_current').select('item_id, qty').is('dept_id', null);
  (sc || []).forEach(function(r) { centralCache[r.item_id] = r.qty; });

  // 연결 발주 select (입고 모달) — ORDERED/PARTIAL 상태만
  await loadOrderOptions();
}

/* ── 채번 ── */
async function genDocNo(prefix) {
  var year = new Date().getFullYear();
  var { data, error } = await supabaseClient.rpc('next_doc_seq', { p_prefix: prefix, p_year: year });
  if (error || data == null) return prefix + '-' + year + '-' + Date.now().toString().slice(-6);
  return prefix + '-' + year + '-' + String(data).padStart(6, '0');
}

/* ── 저장 버튼 공통 ── */
function bindSaveBtn(btnId, saveFn, modalId, refreshFn) {
  document.getElementById(btnId)?.addEventListener('click', async function() {
    var btn = document.getElementById(btnId);
    btn.disabled = true;
    showGlobalLoading('저장하는 중...');
    try {
      await saveFn();
      closeModal(modalId);
      await refreshFn();
    } catch(e) {
      if (e.message !== '입고 취소됨') alert('저장 실패: ' + e.message);
    } finally {
      btn.disabled = false;
      hideGlobalLoading();
    }
  });
}

/* ── 검색 이벤트 ── */
function initSearch() {
  document.getElementById('receiptSearchBtn')?.addEventListener('click',  function() { loadReceipts(1); });
  document.getElementById('dispatchSearchBtn')?.addEventListener('click', function() { loadDispatches(1); });
  document.getElementById('deptStockSearchBtn')?.addEventListener('click', function() { loadDeptStock(1); });
  document.getElementById('deptStockKeyword')?.addEventListener('keydown', function(e) { if (e.key==='Enter') loadDeptStock(1); });

  // 입고 모달
  document.getElementById('r_order_id')?.addEventListener('change', onReceiptOrderChange);

  // 불출 모달
  document.getElementById('d_item_id')?.addEventListener('change', updateDispatchInfo);
}

/* ── 접근 권한 (자재담당자 = manager 또는 admin) ── */
async function guardAccess() {
  var session = await auth.requireAuth();
  if (!session) return null;
  var user = await auth.getSession();
  if (user.role !== 'admin' && user.role !== 'manager') {
    alert('자재담당자(또는 관리자)만 접근할 수 있습니다.');
    location.replace(CONFIG.SITE_BASE_URL + '/app.html');
    return null;
  }
  return user;
}

/* ── 초기화 ── */
async function init() {
  var user = await guardAccess();
  if (!user) return;

  // 검색 날짜 기본값 — 시작일: 일주일 전, 종료일: 오늘 (다른 화면과 동일)
  var today = new Date();
  var weekAgo = new Date(today);
  weekAgo.setDate(today.getDate() - 7);
  var todayStr   = today.toISOString().slice(0, 10);
  var weekAgoStr = weekAgo.toISOString().slice(0, 10);
  setVal('receiptDateFrom',  weekAgoStr);
  setVal('receiptDateTo',    todayStr);
  setVal('dispatchDateFrom', weekAgoStr);
  setVal('dispatchDateTo',   todayStr);

  initTabs();
  initSearch();

  // receipt 탭 기본 활성 → 즉시 초기화
  initReceiptPoGrid();
  initReceiptItemGrid();  // 우측 그리드도 즉시 초기화 (헤더 표시)
  initDispatchStockGrid();  // 불출 좌측 그리드
  initDispatchItemGrid();   // 불출 우측 그리드

  // 날짜 기본값 추가
  setVal('receiptDate',  todayStr);
  setVal('dispatchDate', todayStr);

  // 입고 조회 버튼
  document.getElementById('receiptPoSearchBtn')?.addEventListener('click', loadReceiptPoList);
  document.getElementById('receiptPoKeyword')?.addEventListener('keydown', function(e) { if (e.key === 'Enter') loadReceiptPoList(); });
  document.getElementById('receiptPoStatus')?.addEventListener('change', loadReceiptPoList);
  document.getElementById('receiptSaveBtn')?.addEventListener('click', saveReceipt);

  // 불출 조회 버튼
  document.getElementById('dispatchSearchBtn')?.addEventListener('click', loadDispatchStock);
  document.getElementById('dispatchKeyword')?.addEventListener('keydown', function(e) { if (e.key === 'Enter') loadDispatchStock(); });
  document.getElementById('dispatchCategoryFilter')?.addEventListener('change', loadDispatchStock);

  showGlobalLoading('데이터를 불러오는 중...');
  try {
    await loadCaches();
    await loadReceiptPoList();
  } catch(e) {
    alert('초기화 실패: ' + e.message);
  } finally {
    hideGlobalLoading();
  }
}

document.addEventListener('DOMContentLoaded', init);
