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
          receipt:   { api: '_gridReceipt',   id: 'receiptGrid',   init: initReceiptGrid,   load: function(){loadReceipts(1);} },
          dispatch:  { api: '_gridDispatch',  id: 'dispatchGrid',  init: initDispatchGrid,  load: function(){loadDispatches(1);} },
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
  if (totalPages <= 1) { container.innerHTML = ''; return; }

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
function openAddReceipt() {
  setVal('r_order_id', '');
  setVal('r_item_id', '');
  setVal('r_receipt_date', new Date().toISOString().slice(0, 10));
  setVal('r_receipt_qty', '1');
  setVal('r_use_qty', '');
  setVal('r_unit_price', '0');
  setVal('r_supply_price', '0');
  setVal('r_vat_amount', '0');
  setVal('r_total_price', '0');
  setVal('r_memo', '');
  orderItemsMap = {};
  _receiptVatTouched = false;
  populateReceiptItemSelect(itemCache);
  updateReceiptInfo();
  openModal('receiptModal');
}

/** 발주 선택에 따라 자재 select 옵션 갱신 */
function populateReceiptItemSelect(list, labelFn) {
  var sel = document.getElementById('r_item_id');
  if (!sel) return;
  sel.innerHTML = '<option value="">자재 선택</option>' +
    list.map(function(it) {
      var label = labelFn ? labelFn(it) : it.item_name;
      return '<option value="' + it.id + '">' + ts(label) + '</option>';
    }).join('');
}

async function onReceiptOrderChange() {
  var orderId = val('r_order_id');
  orderItemsMap = {};
  if (!orderId) {
    populateReceiptItemSelect(itemCache);
    updateReceiptInfo();
    return;
  }
  var { data: poItems, error } = await supabaseClient
    .from('purchase_order_items')
    .select('id, item_id, order_qty, received_qty, unit_price, purchase_unit, use_unit, items(item_name)')
    .eq('order_id', orderId);
  if (error) { alert('발주 품목 조회 실패: ' + error.message); return; }

  var openItems = (poItems || []).filter(function(r) { return (r.received_qty || 0) < r.order_qty; });
  openItems.forEach(function(r) {
    orderItemsMap[r.item_id] = {
      order_item_id: r.id,
      order_qty:     r.order_qty,
      received_qty:  r.received_qty || 0,
      unit_price:    r.unit_price,
      purchase_unit: r.purchase_unit,
      use_unit:      r.use_unit,
    };
  });

  var listForSelect = openItems.map(function(r) {
    return { id: r.item_id, item_name: r.items?.item_name || '-', _remain: r.order_qty - (r.received_qty || 0) };
  });
  if (!listForSelect.length) {
    populateReceiptItemSelect([]);
    alert('이 발주서는 모든 품목이 입고 완료되었습니다.');
  } else {
    populateReceiptItemSelect(listForSelect, function(it) {
      return it.item_name + ' (잔여 ' + it._remain + ')';
    });
  }
  updateReceiptInfo();
}

function updateReceiptInfo() {
  var itemId = val('r_item_id');
  var item   = itemCache.find(function(it) { return it.id === itemId; });
  var ordInfo = orderItemsMap[itemId];

  if (item) {
    var purchaseUnit = ordInfo?.purchase_unit || item.purchase_unit;
    var useUnit      = ordInfo?.use_unit      || item.use_unit;
    var unitQty      = item.purchase_unit_qty || 1;

    if (ordInfo) {
      setVal('r_receipt_qty', Math.max(1, ordInfo.order_qty - ordInfo.received_qty));
      setVal('r_unit_price',  ordInfo.unit_price || 0);
    }

    var qty    = Number(val('r_receipt_qty') || 1);
    var useQty = qty * unitQty;
    var price  = Number(val('r_unit_price') || 0);
    setVal('r_use_qty',      useQty);
    var supply = qty * price;
    setVal('r_supply_price', supply);
    refreshReceiptVatTotal(supply);

    document.getElementById('rPurchaseUnit').textContent = purchaseUnit || '-';
    document.getElementById('rUseUnit').textContent      = useUnit      || '-';
    document.getElementById('rUnitQty').textContent      = unitQty;
    document.getElementById('rCurrentQty').textContent   = (centralCache[itemId] || 0) + ' ' + (useUnit || '');
    document.getElementById('rItemInfo').style.display   = 'flex';
  } else {
    setVal('r_use_qty', ''); setVal('r_supply_price', '');
    setVal('r_vat_amount', '0'); setVal('r_total_price', '0');
    document.getElementById('rItemInfo').style.display = 'none';
  }
}

/** 공급가액 기준으로 부가세(자동계산, 보정값 유지)와 합계를 갱신 */
function refreshReceiptVatTotal(supply) {
  var vatInput = document.getElementById('r_vat_amount');
  if (vatInput && !_receiptVatTouched) vatInput.value = calcVat(supply);
  var vat = Number(vatInput?.value || 0);
  setVal('r_total_price', (supply || 0) + vat);
}

/** 부가세 입력칸을 사용자가 직접 수정했을 때 — 이후 수량/단가 변경으로 덮어쓰지 않도록 표시 */
function onReceiptVatInput() {
  _receiptVatTouched = true;
  var supply = Number(val('r_supply_price') || 0);
  refreshReceiptVatTotal(supply);
}

function recalcReceiptInfo() {
  var itemId = val('r_item_id');
  var item   = itemCache.find(function(it) { return it.id === itemId; });
  if (!item) return;
  var unitQty = item.purchase_unit_qty || 1;
  var qty     = Number(val('r_receipt_qty') || 1);
  var price   = Number(val('r_unit_price') || 0);
  setVal('r_use_qty', qty * unitQty);
  var supply = qty * price;
  setVal('r_supply_price', supply);
  refreshReceiptVatTotal(supply);
}

async function saveReceipt() {
  var itemId = val('r_item_id');
  if (!itemId) throw new Error('자재를 선택해주세요.');
  var item = itemCache.find(function(it) { return it.id === itemId; });
  if (!item) throw new Error('자재 정보를 찾을 수 없습니다.');

  var receiptQty = Number(val('r_receipt_qty') || 1);
  var unitPrice  = Number(val('r_unit_price') || 0);
  if (receiptQty < 1) throw new Error('입고 수량은 1 이상이어야 합니다.');

  var orderId = val('r_order_id') || null;
  var ordInfo = orderId ? orderItemsMap[itemId] : null;
  if (orderId && ordInfo && receiptQty > (ordInfo.order_qty - ordInfo.received_qty)) {
    if (!confirm('입고수량이 발주 잔여수량(' + (ordInfo.order_qty - ordInfo.received_qty) + ')을 초과합니다. 계속하시겠습니까?')) {
      throw new Error('입고 취소됨');
    }
  }

  var receiptNo = await genDocNo('RC');
  var payload = {
    receipt_no:        receiptNo,
    item_id:           itemId,
    order_id:          orderId,
    order_item_id:     ordInfo ? ordInfo.order_item_id : null,
    receipt_date:      val('r_receipt_date'),
    purchase_unit:     ordInfo?.purchase_unit || item.purchase_unit,
    purchase_unit_qty: item.purchase_unit_qty || 1,
    receipt_qty:       receiptQty,
    unit_price:        unitPrice,
    vat_amount:        Number(val('r_vat_amount') || 0),
    memo:              val('r_memo'),
  };

  var { error } = await supabaseClient.from('stock_receipts').insert(payload);
  if (error) throw new Error(error.message);

  // stock_transactions에 IN 기록 (중앙창고, dept_id=NULL)
  var useQty = receiptQty * (item.purchase_unit_qty || 1);
  var { error: te } = await supabaseClient.from('stock_transactions').insert({
    item_id:  itemId,
    dept_id:  null,
    tx_type:  'IN',
    tx_date:  val('r_receipt_date'),
    qty:      useQty,
    use_unit: ordInfo?.use_unit || item.use_unit || item.unit || '',
    ref_type: 'receipt',
    memo:     val('r_memo'),
  });
  if (te) throw new Error('이력 기록 실패: ' + te.message);

  // 중앙창고 재고 적립
  await upsertStockCurrent(itemId, useQty, null);

  // 발주서 품목별 입고 처리 (부분입고)
  if (ordInfo) {
    var newReceived = ordInfo.received_qty + receiptQty;
    await supabaseClient.from('purchase_order_items')
      .update({ received_qty: newReceived }).eq('id', ordInfo.order_item_id);
    await recalcOrderStatus(orderId);
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
  document.getElementById('d_item_id').innerHTML = opts;

  // 부서 select 채우기 (필터들 + 모달)
  var deptOpts = deptCache.map(function(d) { return '<option value="' + d.id + '">' + ts(d.dept_name) + '</option>'; }).join('');
  ['dispatchDeptFilter', 'd_dept_id', 'deptStockDeptFilter'].forEach(function(id) {
    var el = document.getElementById(id);
    if (!el) return;
    var placeholder = id === 'd_dept_id' ? '<option value="">부서 선택</option>' : '<option value="">전체</option>';
    el.innerHTML = placeholder + deptOpts;
  });

  // 중앙창고(dept_id=NULL) 현재고 캐시
  var { data: sc } = await supabaseClient.from('stock_current').select('item_id, qty').is('dept_id', null);
  (sc || []).forEach(function(r) { centralCache[r.item_id] = r.qty; });

  // 연결 발주 select (입고 모달) — ORDERED/PARTIAL 상태만
  var { data: orders } = await supabaseClient
    .from('purchase_orders').select('id, order_no')
    .in('status', ['ORDERED', 'PARTIAL'])
    .order('created_at', { ascending: false });
  var oSel = document.getElementById('r_order_id');
  if (oSel) {
    oSel.innerHTML = '<option value="">발주 없이 직접 입고</option>' +
      (orders || []).map(function(o) { return '<option value="' + o.id + '">' + ts(o.order_no) + '</option>'; }).join('');
  }
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
  document.getElementById('r_item_id')?.addEventListener('change', updateReceiptInfo);
  document.getElementById('r_receipt_qty')?.addEventListener('input', recalcReceiptInfo);
  document.getElementById('r_unit_price')?.addEventListener('input', recalcReceiptInfo);

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

  initTabs();
  initSearch();

  initReceiptGrid();  // receipt 탭이 기본 활성 → 즉시 초기화
  // dispatchGrid, deptStockGrid는 탭 전환 시 lazy 초기화

  document.getElementById('addReceiptBtn')?.addEventListener('click', openAddReceipt);
  document.getElementById('addDispatchBtn')?.addEventListener('click', openAddDispatch);

  bindSaveBtn('receiptSaveBtn', saveReceipt, 'receiptModal', function() {
    return loadReceipts(1);
  });
  bindSaveBtn('dispatchSaveBtn', saveDispatch, 'dispatchModal', function() {
    return loadDispatches(1);
  });

  showGlobalLoading('데이터를 불러오는 중...');
  try {
    await loadCaches();
    await loadReceipts(1);
  } catch(e) {
    alert('초기화 실패: ' + e.message);
  } finally {
    hideGlobalLoading();
  }
}

document.addEventListener('DOMContentLoaded', init);
