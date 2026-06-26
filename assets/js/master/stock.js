/**
 * assets/js/master/stock.js
 * 재고 관리 — 현재고 / 입고 / 입출고이력
 * 부가세: supply_price(공급가액)만 저장, VAT는 조회 시 계산
 */
'use strict';

var stState = {
  current: { page:1, pageSize:20, totalPages:1, loading:false },
  receipt: { page:1, pageSize:20, totalPages:1, loading:false },
  tx:      { page:1, pageSize:20, totalPages:1, loading:false },
};

var _gridCurrent = null;
var _gridReceipt = null;
var _gridTx      = null;

var itemCache    = [];   // 자재 목록 (id, item_name, purchase_unit, use_unit, purchase_unit_qty)
var currentCache = {};   // item_id → current qty

/* ── 유틸 ── */
function ts(v) {
  return String(v == null ? '' : v)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function val(id)       { return (document.getElementById(id)?.value || '').trim(); }
function setVal(id, v) { var el = document.getElementById(id); if (el) el.value = v ?? ''; }
function fmtN(n)       { return Number(n || 0).toLocaleString('ko-KR'); }
function fmtDate(v)    { return v ? String(v).slice(0, 10) : '-'; }

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
var _tabInited = {};  // 탭별 그리드 초기화 여부

function initTabs() {
  document.querySelectorAll('.tab-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var target = btn.dataset.tab;
      document.querySelectorAll('.tab-btn').forEach(function(b) { b.classList.remove('active'); });
      document.querySelectorAll('.tab-panel').forEach(function(p) { p.classList.remove('active'); });
      btn.classList.add('active');
      document.getElementById('tab-' + target)?.classList.add('active');

      // 탭 전환 후 그리드 lazy 초기화 + sizeColumnsToFit
      requestAnimationFrame(function() {
        if (target === 'current')  { if (!_gridCurrent) initCurrentGrid(); if (_gridCurrent) _gridCurrent.sizeColumnsToFit(); }
        if (target === 'receipt')  { if (!_gridReceipt) initReceiptGrid(); if (_gridReceipt) _gridReceipt.sizeColumnsToFit(); }
        if (target === 'txlog')    { if (!_gridTx)      initTxGrid();      if (_gridTx)      _gridTx.sizeColumnsToFit(); }
      });
    });
  });
}

/* ── 페이지네이션 ── */
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
   현재고 탭
════════════════════════════════ */
function initCurrentGrid() {
  var colDefs = [
    { headerName: '자재명', field: 'items', flex: 2,
      headerClass: 'ag-left-header',
      cellStyle: { display:'flex', alignItems:'center', justifyContent:'flex-start' },
      cellRenderer: function(p) { return ts(p.value?.item_name || '-'); }
    },
    { headerName: '카테고리', field: 'items', flex: 1,
      cellRenderer: function(p) { return ts(p.value?.category || '-'); }
    },
    { headerName: '사용단위', field: 'items', width: 80,
      cellRenderer: function(p) { return ts(p.value?.use_unit || p.value?.unit || '-'); }
    },
    { headerName: '현재고', field: 'qty', width: 90,
      cellStyle: { display:'flex', alignItems:'center', justifyContent:'flex-end' },
      cellRenderer: function(p) {
        var qty = p.value || 0;
        var item = p.data?.items;
        var reorder = item?.reorder_point;
        var cls = qty === 0 ? 'stock-qty-zero' : (reorder && qty <= reorder ? 'stock-qty-low' : 'stock-qty-ok');
        return '<span class="' + cls + '">' + fmtN(qty) + '</span>';
      }
    },
    { headerName: '재주문점', field: 'items', width: 90,
      cellStyle: { display:'flex', alignItems:'center', justifyContent:'flex-end' },
      cellRenderer: function(p) {
        var v = p.value?.reorder_point;
        return v != null ? fmtN(v) : '-';
      }
    },
    { headerName: '안전재고', field: 'items', width: 90,
      cellStyle: { display:'flex', alignItems:'center', justifyContent:'flex-end' },
      cellRenderer: function(p) {
        var v = p.value?.safety_stock;
        return v != null ? fmtN(v) : '-';
      }
    },
    { headerName: '최종갱신', field: 'last_updated_at', width: 130,
      cellRenderer: function(p) {
        return p.value ? new Date(p.value).toLocaleString('ko-KR',{hour12:false}).slice(0,16) : '-';
      }
    },
  ];
  _gridCurrent = createMgGrid('currentGrid', colDefs, [], { noRowsText: '재고 데이터가 없습니다.' });
}

async function loadCurrent(page) {
  var st = stState.current;
  if (st.loading) return;
  st.loading = true;
  page = page || st.page;
  showGlobalLoading('현재고를 불러오는 중...');
  try {
    var from = (page - 1) * st.pageSize;
    var to   = from + st.pageSize - 1;
    var keyword = val('currentItemKeyword');

    var q = supabaseClient
      .from('stock_current')
      .select('*, items(item_name, category, use_unit, unit, reorder_point, safety_stock)', { count: 'exact' })
      .order('last_updated_at', { ascending: false })
      .range(from, to);

    if (keyword) {
      // items 관계를 통한 필터는 직접 지원 안 되므로 item_id 목록으로 필터
      var { data: matchItems } = await supabaseClient
        .from('items').select('id')
        .ilike('item_name', '%' + keyword + '%');
      var ids = (matchItems || []).map(function(m) { return m.id; });
      if (ids.length) q = q.in('item_id', ids);
      else { _gridCurrent?.setGridOption('rowData', []); st.loading = false; hideGlobalLoading(); return; }
    }

    var { data, error, count } = await q;
    if (error) throw new Error(error.message);

    // 현재고 캐시 갱신
    (data || []).forEach(function(r) { currentCache[r.item_id] = r.qty; });

    st.page       = page;
    st.totalPages = Math.max(1, Math.ceil((count || 0) / st.pageSize));
    _gridCurrent?.setGridOption('rowData', data || []);
    renderPagination('currentPagination', st, loadCurrent);
  } catch(e) {
    alert('현재고 로드 실패: ' + e.message);
  } finally {
    st.loading = false;
    hideGlobalLoading();
  }
}

/* ════════════════════════════════
   입고 탭
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
      .select('*, items(item_name)', { count: 'exact' })
      .order('receipt_date', { ascending: false })
      .range(from, to);

    if (dateFrom) q = q.gte('receipt_date', dateFrom);
    if (dateTo)   q = q.lte('receipt_date', dateTo);

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
  setVal('r_item_id', '');
  setVal('r_receipt_date', new Date().toISOString().slice(0, 10));
  setVal('r_receipt_qty', '1');
  setVal('r_use_qty', '');
  setVal('r_unit_price', '0');
  setVal('r_supply_price', '0');
  setVal('r_order_id', '');
  setVal('r_memo', '');
  updateReceiptInfo();
  openModal('receiptModal');
}

function updateReceiptInfo() {
  var itemId = val('r_item_id');
  var item   = itemCache.find(function(it) { return it.id === itemId; });
  if (item) {
    var qty      = Number(val('r_receipt_qty') || 1);
    var useQty   = qty * (item.purchase_unit_qty || 1);
    var price    = Number(val('r_unit_price') || 0);
    var supply   = qty * price;
    setVal('r_use_qty',     useQty);
    setVal('r_supply_price', supply);
    // 안내 정보
    document.getElementById('rPurchaseUnit').textContent = item.purchase_unit || '-';
    document.getElementById('rUseUnit').textContent      = item.use_unit      || '-';
    document.getElementById('rUnitQty').textContent      = item.purchase_unit_qty || 1;
    document.getElementById('rCurrentQty').textContent   = (currentCache[itemId] || 0) + ' ' + (item.use_unit || '');
  } else {
    setVal('r_use_qty', ''); setVal('r_supply_price', '');
  }
}

async function saveReceipt() {
  var itemId = val('r_item_id');
  if (!itemId) throw new Error('자재를 선택해주세요.');
  var item = itemCache.find(function(it) { return it.id === itemId; });
  if (!item) throw new Error('자재 정보를 찾을 수 없습니다.');

  var receiptQty = Number(val('r_receipt_qty') || 1);
  var unitPrice  = Number(val('r_unit_price') || 0);
  if (receiptQty < 1) throw new Error('입고 수량은 1 이상이어야 합니다.');

  var receiptNo = await genReceiptNo();
  var payload = {
    receipt_no:        receiptNo,
    item_id:           itemId,
    order_id:          val('r_order_id') || null,
    receipt_date:      val('r_receipt_date'),
    purchase_unit:     item.purchase_unit,
    purchase_unit_qty: item.purchase_unit_qty || 1,
    receipt_qty:       receiptQty,
    unit_price:        unitPrice,
    memo:              val('r_memo'),
  };

  var { error } = await supabaseClient.from('stock_receipts').insert(payload);
  if (error) throw new Error(error.message);

  // stock_transactions에 IN 기록
  var useQty = receiptQty * (item.purchase_unit_qty || 1);
  var { error: te } = await supabaseClient.from('stock_transactions').insert({
    item_id:  itemId,
    tx_type:  'IN',
    tx_date:  val('r_receipt_date'),
    qty:      useQty,
    use_unit: item.use_unit || item.unit || '',
    ref_type: 'receipt',
    memo:     val('r_memo'),
  });
  if (te) throw new Error('이력 기록 실패: ' + te.message);

  // stock_current upsert
  await upsertStockCurrent(itemId, useQty);
}

async function genReceiptNo() {
  var year = new Date().getFullYear();
  var { data, error } = await supabaseClient.rpc('next_doc_seq', { p_prefix: 'RC', p_year: year });
  if (error || data == null) return 'RC-' + year + '-' + Date.now().toString().slice(-6);
  return 'RC-' + year + '-' + String(data).padStart(4, '0');
}

async function upsertStockCurrent(itemId, deltaQty) {
  var { data: existing } = await supabaseClient
    .from('stock_current').select('id, qty').eq('item_id', itemId).maybeSingle();
  if (existing) {
    await supabaseClient.from('stock_current')
      .update({ qty: existing.qty + deltaQty, last_updated_at: new Date().toISOString() })
      .eq('id', existing.id);
    currentCache[itemId] = existing.qty + deltaQty;
  } else {
    await supabaseClient.from('stock_current')
      .insert({ item_id: itemId, qty: deltaQty, last_updated_at: new Date().toISOString() });
    currentCache[itemId] = deltaQty;
  }
}

/* ════════════════════════════════
   출고 모달
════════════════════════════════ */
function openAddOut() {
  setVal('o_item_id', '');
  setVal('o_tx_date', new Date().toISOString().slice(0, 10));
  setVal('o_qty', '1');
  setVal('o_memo', '');
  document.getElementById('oUseUnit').textContent   = '-';
  document.getElementById('oCurrentQty').textContent = '-';
  openModal('outModal');
}

function updateOutInfo() {
  var itemId = val('o_item_id');
  var item   = itemCache.find(function(it) { return it.id === itemId; });
  document.getElementById('oUseUnit').textContent    = item ? (item.use_unit || item.unit || '-') : '-';
  document.getElementById('oCurrentQty').textContent = item ? (fmtN(currentCache[itemId] || 0) + ' ' + (item.use_unit || '')) : '-';
}

async function saveOut() {
  var itemId = val('o_item_id');
  if (!itemId) throw new Error('자재를 선택해주세요.');
  var item = itemCache.find(function(it) { return it.id === itemId; });
  var qty  = Number(val('o_qty') || 0);
  if (qty < 1) throw new Error('출고 수량은 1 이상이어야 합니다.');
  var current = currentCache[itemId] || 0;
  if (qty > current) throw new Error('출고 수량(' + qty + ')이 현재고(' + current + ')를 초과합니다.');

  var { error } = await supabaseClient.from('stock_transactions').insert({
    item_id:  itemId,
    tx_type:  'OUT',
    tx_date:  val('o_tx_date'),
    qty:      -qty,
    use_unit: item?.use_unit || item?.unit || '',
    memo:     val('o_memo'),
  });
  if (error) throw new Error(error.message);

  await upsertStockCurrent(itemId, -qty);
}

/* ════════════════════════════════
   입출고 이력 탭
════════════════════════════════ */
function initTxGrid() {
  var colDefs = [
    { headerName: '유형', field: 'tx_type', width: 80,
      cellRenderer: function(p) {
        var s = document.createElement('span');
        s.innerHTML = badgeTx(p.value);
        return s;
      }
    },
    { headerName: '날짜', field: 'tx_date', width: 100,
      cellRenderer: function(p) { return fmtDate(p.value); }
    },
    { headerName: '자재명', field: 'items', flex: 2,
      headerClass: 'ag-left-header',
      cellStyle: { display:'flex', alignItems:'center', justifyContent:'flex-start' },
      cellRenderer: function(p) { return ts(p.value?.item_name || '-'); }
    },
    { headerName: '수량', field: 'qty', width: 90,
      cellStyle: { display:'flex', alignItems:'center', justifyContent:'flex-end' },
      cellRenderer: function(p) {
        var v = p.value || 0;
        var color = v > 0 ? '#059669' : '#dc2626';
        return '<span style="color:' + color + ';font-weight:700;">' + (v > 0 ? '+' : '') + fmtN(v) + '</span>';
      }
    },
    { headerName: '사용단위', field: 'use_unit', width: 80,
      cellRenderer: function(p) { return ts(p.value || '-'); }
    },
    { headerName: '참조유형', field: 'ref_type', width: 90,
      cellRenderer: function(p) { return ts(p.value || '-'); }
    },
    { headerName: '메모', field: 'memo', flex: 1,
      headerClass: 'ag-left-header',
      cellStyle: { display:'flex', alignItems:'center', justifyContent:'flex-start' },
      cellRenderer: function(p) { return ts(p.value || '-'); }
    },
    { headerName: '등록일시', field: 'created_at', width: 130,
      cellRenderer: function(p) {
        return p.value ? new Date(p.value).toLocaleString('ko-KR',{hour12:false}).slice(0,16) : '-';
      }
    },
  ];
  _gridTx = createMgGrid('txGrid', colDefs, [], { noRowsText: '이력이 없습니다.' });
}

async function loadTxLog(page) {
  var st = stState.tx;
  if (st.loading) return;
  st.loading = true;
  page = page || st.page;
  showGlobalLoading('이력을 불러오는 중...');
  try {
    var from = (page - 1) * st.pageSize;
    var to   = from + st.pageSize - 1;
    var txType   = val('txTypeFilter');
    var dateFrom = val('txDateFrom');
    var dateTo   = val('txDateTo');

    var q = supabaseClient
      .from('stock_transactions')
      .select('*, items(item_name)', { count: 'exact' })
      .order('tx_date', { ascending: false })
      .order('created_at', { ascending: false })
      .range(from, to);

    if (txType)   q = q.eq('tx_type', txType);
    if (dateFrom) q = q.gte('tx_date', dateFrom);
    if (dateTo)   q = q.lte('tx_date', dateTo);

    var { data, error, count } = await q;
    if (error) throw new Error(error.message);

    st.page       = page;
    st.totalPages = Math.max(1, Math.ceil((count || 0) / st.pageSize));
    if (!_gridTx) initTxGrid();
    if (_gridTx) _gridTx.setGridOption('rowData', data || []);
    renderPagination('txPagination', st, loadTxLog);
  } catch(e) {
    alert('이력 로드 실패: ' + e.message);
  } finally {
    st.loading = false;
    hideGlobalLoading();
  }
}

/* ── 자재 캐시 로드 ── */
async function loadItemCache() {
  var { data } = await supabaseClient
    .from('items')
    .select('id, item_name, category, purchase_unit, use_unit, purchase_unit_qty, unit, reorder_point, safety_stock, standard_price')
    .eq('active', 'Y')
    .order('item_name');
  itemCache = data || [];

  // 입고/출고 모달 자재 select 채우기
  var opts = '<option value="">자재 선택</option>' +
    itemCache.map(function(it) { return '<option value="' + it.id + '">' + ts(it.item_name) + '</option>'; }).join('');
  var rSel = document.getElementById('r_item_id');
  var oSel = document.getElementById('o_item_id');
  if (rSel) rSel.innerHTML = opts;
  if (oSel) oSel.innerHTML = opts;

  // 현재고 캐시
  var { data: sc } = await supabaseClient.from('stock_current').select('item_id, qty');
  (sc || []).forEach(function(r) { currentCache[r.item_id] = r.qty; });

  // 연결 발주 select (입고 모달)
  var { data: orders } = await supabaseClient
    .from('purchase_orders').select('id, order_no')
    .in('status', ['ORDERED', 'PARTIAL'])
    .order('created_at', { ascending: false });
  var oSel2 = document.getElementById('r_order_id');
  if (oSel2) {
    oSel2.innerHTML = '<option value="">발주 없이 직접 입고</option>' +
      (orders || []).map(function(o) { return '<option value="' + o.id + '">' + ts(o.order_no) + '</option>'; }).join('');
  }
}

/* ── 저장 버튼 공통 ── */
function bindSaveBtn(btnId, saveFn, modalId, refreshFn) {
  document.getElementById(btnId)?.addEventListener('click', async function() {
    var btn = document.getElementById(btnId);
    btn.disabled = true;
    try {
      await saveFn();
      closeModal(modalId);
      await refreshFn();
    } catch(e) {
      alert('저장 실패: ' + e.message);
    } finally {
      btn.disabled = false;
    }
  });
}

/* ── 검색 이벤트 ── */
function initSearch() {
  document.getElementById('currentSearchBtn')?.addEventListener('click',  function() { loadCurrent(1);  });
  document.getElementById('receiptSearchBtn')?.addEventListener('click',  function() { loadReceipts(1); });
  document.getElementById('txSearchBtn')?.addEventListener('click',        function() { loadTxLog(1);    });
  document.getElementById('currentItemKeyword')?.addEventListener('keydown', function(e) { if (e.key==='Enter') loadCurrent(1);  });

  // 입고 모달 — 자재/수량/단가 변경 시 자동 계산
  document.getElementById('r_item_id')?.addEventListener('change', updateReceiptInfo);
  document.getElementById('r_receipt_qty')?.addEventListener('input', updateReceiptInfo);
  document.getElementById('r_unit_price')?.addEventListener('input', updateReceiptInfo);

  // 출고 모달 — 자재 변경 시 정보 갱신
  document.getElementById('o_item_id')?.addEventListener('change', updateOutInfo);
}

/* ── 초기화 ── */
async function init() {
  var currentUser = await auth.requireAuth();
  if (!currentUser) return;

  initTabs();
  initSearch();

  initCurrentGrid();  // current 탭이 기본 활성 → 즉시 초기화
  // receiptGrid, txGrid는 탭 전환 시 lazy 초기화 (display:none 상태에서 height=0 방지)

  document.getElementById('addReceiptBtn')?.addEventListener('click', openAddReceipt);
  document.getElementById('outBtn')?.addEventListener('click', openAddOut);

  bindSaveBtn('receiptSaveBtn', saveReceipt, 'receiptModal', function() {
    return Promise.all([loadCurrent(1), loadReceipts(1)]);
  });
  bindSaveBtn('outSaveBtn', saveOut, 'outModal', function() {
    return Promise.all([loadCurrent(1), loadTxLog(1)]);
  });

  showGlobalLoading('데이터를 불러오는 중...');
  try {
    await loadItemCache();
    await Promise.all([loadCurrent(1), loadReceipts(1), loadTxLog(1)]);
  } catch(e) {
    alert('초기화 실패: ' + e.message);
  } finally {
    hideGlobalLoading();
  }
}

document.addEventListener('DOMContentLoaded', init);
