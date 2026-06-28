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
  deptstock: { page:1, pageSize:20, totalPages:1, loading:false },
};

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
          dispatch:  { api: '_gridDispatchPo', id: 'dispatchPoGrid',
            init: function() {
              // dispatch 탭은 별도 처리 — 아래 tg.load에서 직접 처리
            },
            load: function() {
              setTimeout(function() {
                if (!_gridDispatchPo) initDispatchPoGrid();
                if (!_gridDispatchItem) initDispatchItemGrid();
                setTimeout(loadDispatchPoList, 50);
              }, 80);
            }
          },
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
    { headerName: '거래처', field: 'vendors', width: 130,
      headerClass: 'ag-left-header',
      cellStyle: { display:'flex', alignItems:'center', justifyContent:'flex-start', fontWeight:600 },
      cellRenderer: function(p) { return ts(p.value?.vendor_name || '-'); }
    },
    { headerName: '요청부서', field: '_deptNames', flex: 1, minWidth: 100,
      headerClass: 'ag-left-header',
      cellStyle: { display:'flex', alignItems:'center', justifyContent:'flex-start', color:'#6b7280' },
      cellRenderer: function(p) { return ts(p.value || '-'); }
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
      .select('id, order_no, order_date, status, request_id, vendors(vendor_name)')
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

    // 요청부서 — request_id → purchase_requests → departments 직접 join
    if (rows.length) {
      var reqIds = rows.map(function(r) { return r.request_id; }).filter(Boolean);
      if (reqIds.length) {
        var { data: reqData } = await supabaseClient
          .from('purchase_requests')
          .select('id, departments(dept_name)')
          .in('id', reqIds);
        var reqDeptMap = {};
        (reqData || []).forEach(function(r) {
          reqDeptMap[r.id] = r.departments?.dept_name || '-';
        });
        rows.forEach(function(r) {
          r._deptNames = r.request_id ? (reqDeptMap[r.request_id] || '-') : '-';
        });
      }
    }

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


var _gridReceiptItem  = null;  // 입고 등록 모달의 품목 그리드
var _receiptRowIdCounter = 0;


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
    overlayNoRowsTemplate: '<span style="color:#9ca3af;font-size:12px;">← 왼쪽에서 발주서를 클릭하면 품목이 자동으로 채워집니다.</span>',
    onGridReady: function(params) { if (el.offsetWidth > 0) params.api.sizeColumnsToFit(); },
  });
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


/* ── 재고 이동 ── */
function selectTransferItem(row) {
  _selectedTransferItem = {
    item_id:        row.item_id,
    item_name:      row.items?.item_name || '-',
    use_unit:       row.items?.use_unit  || '',
    qty:            row.qty,
    from_dept_id:   row.dept_id || null,
    from_dept_name: row.departments?.dept_name || '중앙창고',
  };

  // 우측 패널 채우기
  var lbl = document.getElementById('transferItemLabel');
  if (lbl) lbl.textContent = _selectedTransferItem.item_name;

  var fromEl = document.getElementById('transferFromDept');
  if (fromEl) fromEl.textContent = _selectedTransferItem.from_dept_name;

  var unitEl = document.getElementById('transferUnit');
  if (unitEl) unitEl.textContent = _selectedTransferItem.use_unit;

  var maxLbl = document.getElementById('transferMaxLabel');
  if (maxLbl) maxLbl.textContent = '(최대 ' + Number(_selectedTransferItem.qty).toLocaleString('ko-KR') + ')';

  var qtyEl = document.getElementById('transferQty');
  if (qtyEl) { qtyEl.value = 1; qtyEl.max = _selectedTransferItem.qty; }

  // 도착 부서에서 출발 부서 제외
  var toSel = document.getElementById('transferToDept');
  if (toSel) {
    toSel.innerHTML = '<option value="">도착 부서 선택</option>' +
      _deptOptions.filter(function(d) { return d.id !== _selectedTransferItem.from_dept_id; })
        .map(function(d) { return '<option value="' + d.id + '">' + d.name + '</option>'; }).join('');
  }

  // 이동 이력 로드
  loadTransferHistory(_selectedTransferItem.item_id);

  var btn = document.getElementById('transferSaveBtn');
  if (btn) btn.disabled = false;
}

async function loadTransferHistory(itemId) {
  var el = document.getElementById('transferHistoryList');
  if (!el) return;
  el.textContent = '불러오는 중...';

  var { data } = await supabaseClient
    .from('stock_transfers')
    .select('transfer_no, transfer_date, qty, use_unit, from_dept_id, to_dept_id, departments!stock_transfers_from_dept_id_fkey(dept_name), departments!stock_transfers_to_dept_id_fkey(dept_name)')
    .eq('item_id', itemId)
    .order('created_at', { ascending: false })
    .limit(5);

  if (!data || !data.length) {
    el.textContent = '이동 이력이 없습니다.';
    return;
  }

  el.innerHTML = data.map(function(r) {
    var from = r['departments!stock_transfers_from_dept_id_fkey']?.dept_name || '중앙창고';
    var to   = r['departments!stock_transfers_to_dept_id_fkey']?.dept_name   || '중앙창고';
    return '<div style="padding:6px 0;border-bottom:1px solid #f3f4f6;display:flex;gap:8px;">' +
      '<span style="color:#9ca3af;flex-shrink:0;">' + (r.transfer_date||'').slice(0,10) + '</span>' +
      '<span>' + from + ' → ' + to + '</span>' +
      '<span style="margin-left:auto;font-weight:700;">' + Number(r.qty).toLocaleString('ko-KR') + ' ' + (r.use_unit||'') + '</span>' +
    '</div>';
  }).join('');
}

async function saveTransfer() {
  if (!_selectedTransferItem) { alert('이동할 품목을 선택하세요.'); return; }
  var toDeptId    = val('transferToDept');
  var qty         = Number(document.getElementById('transferQty')?.value || 0);
  var transferDate = val('transferDate');
  var memo        = val('transferMemo');

  if (!toDeptId)      { alert('도착 부서를 선택하세요.'); return; }
  if (qty < 1)        { alert('이동 수량을 1 이상 입력하세요.'); return; }
  if (qty > _selectedTransferItem.qty) { alert('현재고(' + _selectedTransferItem.qty + ')를 초과합니다.'); return; }
  if (!transferDate)  { alert('이동일을 입력하세요.'); return; }

  var btn = document.getElementById('transferSaveBtn');
  if (btn) btn.disabled = true;
  showGlobalLoading('재고 이동 중...');
  try {
    var session = await supabaseClient.auth.getSession();
    var userId  = session.data?.session?.user?.id || null;

    var transferNo = await genDocNo('TR');

    // stock_transfers 기록
    var { error: te } = await supabaseClient.from('stock_transfers').insert({
      transfer_no:  transferNo,
      item_id:      _selectedTransferItem.item_id,
      from_dept_id: _selectedTransferItem.from_dept_id,
      to_dept_id:   toDeptId,
      qty:          qty,
      use_unit:     _selectedTransferItem.use_unit,
      transfer_date: transferDate,
      memo:         memo,
      created_by:   userId,
    });
    if (te) throw new Error('이동 기록 실패: ' + te.message);

    // stock_transactions (출발 OUT + 도착 IN)
    var { error: txe } = await supabaseClient.from('stock_transactions').insert([
      { item_id: _selectedTransferItem.item_id, dept_id: _selectedTransferItem.from_dept_id || null, tx_type:'OUT', tx_date: transferDate, qty: -qty, use_unit: _selectedTransferItem.use_unit, ref_type:'transfer', created_by: userId },
      { item_id: _selectedTransferItem.item_id, dept_id: toDeptId, tx_type:'IN', tx_date: transferDate, qty: qty, use_unit: _selectedTransferItem.use_unit, ref_type:'transfer', created_by: userId },
    ]);
    if (txe) throw new Error('재고 이동 실패: ' + txe.message);

    // stock_current 갱신
    await upsertStockCurrent(_selectedTransferItem.item_id, -qty, _selectedTransferItem.from_dept_id);
    await upsertStockCurrent(_selectedTransferItem.item_id,  qty, toDeptId);

    alert('재고 이동 완료! (' + _selectedTransferItem.from_dept_name + ' → ' +
      (_deptOptions.find(function(d){ return d.id===toDeptId; })?.name||'') + ' ' + qty + _selectedTransferItem.use_unit + ')');

    // 초기화
    _selectedTransferItem = null;
    var lbl = document.getElementById('transferItemLabel'); if(lbl) lbl.textContent = '';
    var fromEl = document.getElementById('transferFromDept'); if(fromEl) fromEl.textContent = '-';
    var maxLbl = document.getElementById('transferMaxLabel'); if(maxLbl) maxLbl.textContent = '';
    var histEl = document.getElementById('transferHistoryList'); if(histEl) histEl.textContent = '품목을 선택하세요';
    if(btn) btn.disabled = true;

    // 목록 갱신
    loadDeptStock(1);

  } catch(e) {
    alert('이동 실패: ' + e.message);
  } finally {
    hideGlobalLoading();
    if(btn) btn.disabled = false;
  }
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
    var { data: newReceiptArr, error } = await supabaseClient.from('stock_receipts').insert({
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
    }).select('id');
    if (error) throw new Error('[' + r.item_name + '] ' + error.message);
    var newReceiptId = newReceiptArr?.[0]?.id || null;

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
      ref_id:   newReceiptId,
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

/* ══════════════════════════════════════════
   불출 탭 — 발주서 기반 불출
══════════════════════════════════════════ */
var _gridDispatchPo   = null;
var _gridDispatchItem = null;
var _dispatchRowId    = 0;
var _deptOptions      = [];
var _selectedDispatchPoId = null;

function initDispatchPoGrid() {
  var el = document.getElementById('dispatchPoGrid');
  if (!el || typeof agGrid === 'undefined') return;
  var parentH = el.closest('.panel-left')?.clientHeight || 0;
  var headH   = el.closest('.panel-left')?.querySelector('.panel-head')?.offsetHeight || 40;
  var h = parentH > 100 ? parentH - headH : Math.max(200, window.innerHeight - 200);
  el.style.height = h + 'px';
  _gridDispatchPo = agGrid.createGrid(el, {
    suppressCellFocus:true, suppressPropertyNamesCheck:true,
    columnDefs: [
      { headerName:'발주번호', field:'order_no', width:130, headerClass:'ag-left-header',
        cellStyle:{display:'flex',alignItems:'center',justifyContent:'flex-start'},
        cellRenderer:function(p){return '<code style="font-size:11px;">'+ts(p.value||'-')+'</code>';}
      },
      { headerName:'거래처', field:'_vendorName', flex:1, minWidth:100, headerClass:'ag-left-header',
        cellStyle:{display:'flex',alignItems:'center',justifyContent:'flex-start',fontWeight:600}
      },
      { headerName:'요청부서', field:'_deptName', width:90, headerClass:'ag-left-header',
        cellStyle:{display:'flex',alignItems:'center',justifyContent:'flex-start',color:'#2563eb',fontSize:'11px'}
      },
      { headerName:'발주일', field:'order_date', width:95,
        cellRenderer:function(p){return fmtDate(p.value);}
      },
      { headerName:'상태', field:'status', width:75,
        cellRenderer:function(p){
          var m={ORDERED:'발주완료',PARTIAL:'부분불출',COMPLETED:'완료'};
          var c={ORDERED:'#2563eb',PARTIAL:'#f59e0b',COMPLETED:'#059669'};
          return '<span style="color:'+(c[p.value]||'#6b7280')+';font-weight:700;font-size:11px;">'+(m[p.value]||p.value)+'</span>';
        }
      },
    ],
    rowData:[], rowHeight:34, headerHeight:34, suppressHorizontalScroll:true,
    rowStyle:{cursor:'pointer'},
    defaultColDef:{sortable:true,resizable:true,suppressMovable:true,cellStyle:{display:'flex',alignItems:'center',justifyContent:'center'}},
    onRowClicked:function(p){selectDispatchPo(p.data);},
    overlayNoRowsTemplate:'<span style="color:#9ca3af;font-size:12px;">조회 조건을 입력해 검색하세요.</span>',
    onGridReady:function(params){setTimeout(function(){if(el.offsetWidth>0)params.api.sizeColumnsToFit();},0);},
  });
}

async function loadDispatchPoList() {
  var keyword=(document.getElementById('dispatchKeyword')?.value||'').trim();
  var status=document.getElementById('dispatchPoStatus')?.value||'';
  var dFrom=document.getElementById('dispatchDateFrom')?.value||'';
  var dTo=document.getElementById('dispatchDateTo')?.value||'';
  showGlobalLoading('발주서 목록을 불러오는 중...');
  try {
    var q=supabaseClient.from('purchase_orders')
      .select('id,order_no,order_date,status,request_id,vendors(vendor_name),purchase_requests(dept_id,departments(dept_name))')
      .in('status',status?[status]:['COMPLETED','PARTIAL'])
      .order('order_date',{ascending:false});
    if(dFrom) q=q.gte('order_date',dFrom);
    if(dTo) q=q.lte('order_date',dTo);
    var {data,error}=await q;
    if(error) throw new Error(error.message);
    var rows=(data||[]).filter(function(r){
      if(!keyword) return true;
      return (r.order_no||'').toLowerCase().includes(keyword.toLowerCase())||
             (r.vendors?.vendor_name||'').toLowerCase().includes(keyword.toLowerCase());
    }).map(function(r){
      return Object.assign(r,{
        _vendorName:r.vendors?.vendor_name||'-',
        _deptName:r.purchase_requests?.departments?.dept_name||'-',
      });
    });
    if(!_gridDispatchPo) initDispatchPoGrid();
    if(_gridDispatchPo) _gridDispatchPo.setGridOption('rowData',rows);
    var cnt=document.getElementById('dispatchPoCount'); if(cnt) cnt.textContent=rows.length+'건';
  } catch(e){alert('발주서 목록 조회 실패: '+e.message);
  } finally{hideGlobalLoading();}
}

function initDispatchItemGrid() {
  var el=document.getElementById('dispatchItemGrid');
  if(!el||typeof agGrid==='undefined') return;
  el.style.height=Math.max(200,window.innerHeight-200)+'px';
  _gridDispatchItem=agGrid.createGrid(el,{
    suppressPropertyNamesCheck:true,
    suppressCellFocus:false,
    columnDefs:[
      {headerName:'자재명',field:'item_name',flex:2,minWidth:120,headerClass:'ag-left-header',
        suppressCellFocus:true,
        cellStyle:{display:'flex',alignItems:'center',justifyContent:'flex-start',fontWeight:600}
      },
      {headerName:'입고단위',field:'purchase_unit',width:80,
        suppressCellFocus:true,
        cellStyle:{display:'flex',alignItems:'center',justifyContent:'center',color:'#6b7280'}
      },
      {headerName:'발주',field:'order_qty',width:65,
        suppressCellFocus:true,
        cellStyle:{display:'flex',alignItems:'center',justifyContent:'flex-end'},
        valueFormatter:function(p){return Number(p.value||0).toLocaleString('ko-KR');}
      },
      {headerName:'기불출',field:'dispatched_qty',width:65,
        suppressCellFocus:true,
        cellStyle:{display:'flex',alignItems:'center',justifyContent:'flex-end',color:'#6b7280'},
        valueFormatter:function(p){return Number(p.value||0).toLocaleString('ko-KR');}
      },
      {headerName:'불출수량',field:'dispatch_qty',width:90,
        editable:true, singleClickEdit:true,
        cellEditor:'agNumberCellEditor', cellEditorParams:{min:0},
        valueFormatter:function(p){return Number(p.value||0).toLocaleString('ko-KR');},
        cellStyle:function(p){
          var remain=(p.data.order_qty||0)-(p.data.dispatched_qty||0);
          var over=(p.value||0)>remain;
          return {display:'flex',alignItems:'center',justifyContent:'flex-end',color:over?'#dc2626':'#111827',fontWeight:'600'};
        },
        onCellValueChanged:function(p){
          var remain=(p.data.order_qty||0)-(p.data.dispatched_qty||0);
          if(Number(p.newValue)>remain){alert('잔여수량('+remain+')을 초과할 수 없습니다.');p.node.setDataValue('dispatch_qty',remain);}
          updateDispatchSummary();
        }
      },
    ],
    rowData:[], rowHeight:34, headerHeight:34, suppressHorizontalScroll:true,
    stopEditingWhenCellsLoseFocus:true,
    defaultColDef:{sortable:false,resizable:true,suppressMovable:true,cellStyle:{display:'flex',alignItems:'center',justifyContent:'center'}},
    overlayNoRowsTemplate:'<span style="color:#9ca3af;font-size:12px;">← 왼쪽에서 발주서를 클릭하세요</span>',
    onGridReady:function(params){setTimeout(function(){if(el.offsetWidth>0)params.api.sizeColumnsToFit();},0);},
  });
}

async function selectDispatchPo(po) {
  _selectedDispatchPoId=po.id;
  var label=document.getElementById('dispatchSelectedPoLabel');
  if(label) label.textContent=po.order_no+' · '+po._vendorName+(po._deptName!=='-'?' · '+po._deptName:'');
  var {data:items,error}=await supabaseClient
    .from('purchase_order_items')
    .select('id,item_id,order_qty,received_qty,dispatched_qty,purchase_unit,purchase_unit_qty,use_unit,memo,items(item_name)')
    .eq('order_id',po.id);
  if(error){alert('품목 조회 실패: '+error.message);return;}
  var openItems=(items||[]).filter(function(r){return (r.dispatched_qty||0)<r.order_qty;});
  if(!_gridDispatchItem) initDispatchItemGrid();
  _gridDispatchItem.setGridOption('rowData',openItems.map(function(r){
    return {
      _poiId:r.id, item_id:r.item_id,
      item_name:r.items?.item_name||'-',
      purchase_unit:r.purchase_unit||'', purchase_unit_qty:r.purchase_unit_qty||1,
      use_unit:r.use_unit||'', order_qty:r.order_qty,
      received_qty:r.received_qty||0, dispatched_qty:r.dispatched_qty||0,
      dispatch_qty:r.order_qty-(r.dispatched_qty||0),
    };
  }));
  var cnt=document.getElementById('dispatchItemCount'); if(cnt) cnt.textContent=openItems.length?openItems.length+'건':'';
  var btn=document.getElementById('dispatchSaveBtn'); if(btn) btn.disabled=!openItems.length;
  updateDispatchSummary();
}

function updateDispatchSummary() {
  var total=0,items=0;
  if(_gridDispatchItem) _gridDispatchItem.forEachNode(function(n){if((n.data.dispatch_qty||0)>0){items++;total+=n.data.dispatch_qty;}});
  var sum=document.getElementById('dispatchSummary');
  if(sum) sum.textContent=items>0?items+'개 품목, 총 '+total+'개 불출 예정':'불출 수량을 입력하세요';
  var btn=document.getElementById('dispatchSaveBtn'); if(btn) btn.disabled=items===0;
}

async function saveDispatch() {
  if(!_selectedDispatchPoId){alert('발주서를 선택하세요.');return;}
  var rows=[];
  if(_gridDispatchItem) _gridDispatchItem.forEachNode(function(n){if((n.data.dispatch_qty||0)>0) rows.push(n.data);});
  if(!rows.length){alert('불출 수량을 1개 이상 입력하세요.');return;}
  var dispatchDate=val('dispatchDate');
  if(!dispatchDate){alert('불출일을 입력하세요.');return;}
  var {data:poData}=await supabaseClient.from('purchase_orders')
    .select('request_id,purchase_requests(dept_id,departments(dept_name))')
    .eq('id',_selectedDispatchPoId).single();
  var deptId=poData?.purchase_requests?.dept_id||null;
  var deptName=poData?.purchase_requests?.departments?.dept_name||'';
  if(!deptId){alert('이 발주서에 연결된 요청부서가 없습니다.');return;}
  var saveBtn=document.getElementById('dispatchSaveBtn'); if(saveBtn) saveBtn.disabled=true;
  showGlobalLoading('불출 처리 중...');
  try {
    var session=await supabaseClient.auth.getSession();
    var userId=session.data?.session?.user?.id||null;
    for(var i=0;i<rows.length;i++){
      var r=rows[i];
      var qty=Number(r.dispatch_qty);
      var useQty=qty*(r.purchase_unit_qty||1);
      var dispatchNo=await genDocNo('SD');
      var {data:newDispatch,error:de}=await supabaseClient.from('stock_dispatch').insert({
        dispatch_no:dispatchNo,item_id:r.item_id,dept_id:deptId,
        dispatch_date:dispatchDate,dispatch_qty:qty,use_unit:r.use_unit,created_by:userId,
      }).select('id').single();
      if(de) throw new Error('불출 기록 실패: '+de.message);
      var {error:te}=await supabaseClient.from('stock_transactions').insert([
        {item_id:r.item_id,dept_id:null,  tx_type:'OUT',tx_date:dispatchDate,qty:-useQty,use_unit:r.use_unit,ref_type:'dispatch',ref_id:newDispatch.id,created_by:userId},
        {item_id:r.item_id,dept_id:deptId,tx_type:'IN', tx_date:dispatchDate,qty: useQty,use_unit:r.use_unit,ref_type:'dispatch',ref_id:newDispatch.id,created_by:userId},
      ]);
      if(te) throw new Error('재고 이동 실패: '+te.message);
      await upsertStockCurrent(r.item_id,-useQty,null);
      await upsertStockCurrent(r.item_id, useQty,deptId);
      await supabaseClient.from('purchase_order_items').update({dispatched_qty:(r.dispatched_qty||0)+qty}).eq('id',r._poiId);
    }
    var {data:allItems}=await supabaseClient.from('purchase_order_items').select('order_qty,dispatched_qty').eq('order_id',_selectedDispatchPoId);
    var allDone=(allItems||[]).every(function(i){return (i.dispatched_qty||0)>=i.order_qty;});
    var anyDone=(allItems||[]).some(function(i){return (i.dispatched_qty||0)>0;});
    await supabaseClient.from('purchase_orders').update({status:allDone?'COMPLETED':(anyDone?'PARTIAL':'ORDERED')}).eq('id',_selectedDispatchPoId);
    alert('불출 완료! ('+deptName+'에 '+rows.length+'개 품목)');
    _selectedDispatchPoId=null;
    if(_gridDispatchItem) _gridDispatchItem.setGridOption('rowData',[]);
    var lbl=document.getElementById('dispatchSelectedPoLabel'); if(lbl) lbl.textContent='';
    var sum=document.getElementById('dispatchSummary'); if(sum) sum.textContent='← 왼쪽에서 발주서를 선택하세요';
    if(saveBtn) saveBtn.disabled=true;
    loadDispatchPoList();
  } catch(e){alert('불출 실패: '+e.message);
  } finally{hideGlobalLoading();if(saveBtn) saveBtn.disabled=false;}
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
  var el = document.getElementById('deptStockGrid');
  if (el) el.style.height = Math.max(200, window.innerHeight - 200) + 'px';
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
    var deptId  = val('deptStockDeptFilter');  // 빈 값이면 전체(중앙창고 포함)
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
    var dcnt = document.getElementById('deptStockCount'); if(dcnt) dcnt.textContent = (count||0) + '건';
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
  _deptOptions = (depts || []).map(function(d){ return { id: d.id, name: d.dept_name }; });
  ['dispatchDeptFilter', 'd_dept_id', 'deptStockDeptFilter', 'dispatchDeptTarget'].forEach(function(id) {
    var el = document.getElementById(id);
    if (!el) return;
    var placeholder = id === 'd_dept_id' ? '<option value="">부서 선택</option>' : '<option value="">전체</option>';
    el.innerHTML = placeholder + deptOpts;
  });

  // 중앙창고(dept_id=NULL) 현재고 캐시
  var { data: sc } = await supabaseClient.from('stock_current').select('item_id, qty').is('dept_id', null);
  (sc || []).forEach(function(r) { centralCache[r.item_id] = r.qty; });
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
  document.getElementById('dispatchSearchBtn')?.addEventListener('click', function() { loadDispatchPoList(); });
  document.getElementById('deptStockSearchBtn')?.addEventListener('click', function() { loadDeptStock(1); });
  document.getElementById('deptStockKeyword')?.addEventListener('keydown', function(e) { if (e.key==='Enter') loadDeptStock(1); });
  document.getElementById('deptStockDeptFilter')?.addEventListener('change', function() { loadDeptStock(1); });

  // 도착부서 select 채우기
  var transferToSel = document.getElementById('transferToDept');
  if (transferToSel && _deptOptions.length) {
    transferToSel.innerHTML = '<option value="">도착 부서 선택</option>' +
      _deptOptions.map(function(d){ return '<option value="' + d.id + '">' + d.name + '</option>'; }).join('');
  }

  // 입고 모달

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

  // 날짜 기본값 추가
  setVal('receiptDate',  todayStr);
  setVal('dispatchDate', todayStr);
  setVal('transferDate', todayStr);

  // 입고 조회 버튼
  document.getElementById('receiptPoSearchBtn')?.addEventListener('click', loadReceiptPoList);
  document.getElementById('receiptPoKeyword')?.addEventListener('keydown', function(e) { if (e.key === 'Enter') loadReceiptPoList(); });
  document.getElementById('receiptPoStatus')?.addEventListener('change', loadReceiptPoList);
  document.getElementById('receiptSaveBtn')?.addEventListener('click', saveReceipt);

  // 불출 조회 버튼
  document.getElementById('dispatchSearchBtn')?.addEventListener('click', loadDispatchPoList);
  document.getElementById('dispatchKeyword')?.addEventListener('keydown', function(e) { if (e.key === 'Enter') loadDispatchPoList(); });
  document.getElementById('dispatchPoStatus')?.addEventListener('change', loadDispatchPoList);

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
