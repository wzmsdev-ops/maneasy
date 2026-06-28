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
                if (!_gridDispatchHistory) initDispatchHistoryGrid();
                setTimeout(loadDispatchPoList, 50);
              }, 80);
            }
          },
          deptstock: { api: '_gridDeptStock', id: 'deptStockGrid',
            init: function() {
              initDeptStockGrid();
              if (!_gridTransferInfo) initTransferInfoGrid();
            },
            load: function(){loadDeptStock(1);} },
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
    refitGridColumns(_gridReceiptPo);

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
      { headerName: '자재명', field: 'item_name', flex: 3,
        headerClass: 'ag-left-header',
        cellStyle: { display:'flex', alignItems:'center', justifyContent:'flex-start', fontWeight:600 },
        cellRenderer: function(p) { return ts(p.value || '-'); }
      },
      { headerName: '단위', field: 'purchase_unit', width: 60,
        cellStyle: { display:'flex', alignItems:'center', justifyContent:'center', background:'#f8fafc', color:'#6b7280' },
        cellRenderer: function(p) { return ts(p.value || '-'); }
      },
      { headerName: '발주/잔여', width: 80,
        cellStyle: { display:'flex', alignItems:'center', justifyContent:'center', background:'#f8fafc', color:'#6b7280' },
        cellRenderer: function(p) {
          if (p.data.order_qty == null) return '-';
          var remain = p.data.order_qty - (p.data.received_qty || 0);
          return Number(p.data.order_qty).toLocaleString('ko-KR') + ' / ' + Number(remain).toLocaleString('ko-KR');
        }
      },
      { headerName: '수량', field: 'qty', width: 70,
        headerClass: 'ag-right-header',
        cellStyle: { display:'flex', alignItems:'center', justifyContent:'flex-end' },
        editable: true,
        cellEditor: 'agNumberCellEditor',
        cellEditorParams: { min: 0 },
        cellRenderer: function(p) {
          var v = Number(p.value || 0);
          return v === 0
            ? '<span style="color:#d1d5db;">0</span>'
            : v.toLocaleString('ko-KR');
        },
        onCellValueChanged: function(p) { recalcReceiptFromQtyPrice(p.node); }
      },
      { headerName: '단가', field: 'unit_price', width: 90,
        headerClass: 'ag-right-header',
        cellStyle: { display:'flex', alignItems:'center', justifyContent:'flex-end' },
        editable: true,
        cellEditor: 'agNumberCellEditor',
        cellEditorParams: { min: 0 },
        cellRenderer: function(p) { return Number(p.value || 0).toLocaleString('ko-KR') + '원'; },
        onCellValueChanged: function(p) { recalcReceiptFromQtyPrice(p.node); }
      },
      { headerName: '공급가액', field: 'supply_price', width: 90,
        headerClass: 'ag-right-header',
        cellStyle: { display:'flex', alignItems:'center', justifyContent:'flex-end' },
        editable: true,
        cellEditor: 'agNumberCellEditor',
        cellEditorParams: { min: 0 },
        cellRenderer: function(p) { return '<strong>' + Number(p.value || 0).toLocaleString('ko-KR') + '원</strong>'; },
        onCellValueChanged: function(p) { recalcReceiptFromSupply(p.node); }
      },
      { headerName: 'LOT번호', field: 'lot_no', width: 130,
        headerClass: 'ag-left-header',
        cellStyle: { display:'flex', alignItems:'center', justifyContent:'flex-start', color:'#1d4ed8', fontFamily:'Consolas,monospace' },
        editable: true,
        cellRenderer: function(p) {
          if (!p.value) return '<span style="color:#d1d5db;">LOT번호 입력</span>';
          return ts(p.value);
        }
      },
      { headerName: '메모', field: 'memo', flex: 1,
        headerClass: 'ag-left-header',
        cellStyle: { display:'flex', alignItems:'center', justifyContent:'flex-start' },
        editable: true,
        cellRenderer: function(p) { return ts(p.value || ''); }
      },
      { headerName: '', width: 60, sortable: false,
        cellStyle: { display:'flex', alignItems:'center', justifyContent:'center', gap:'2px', padding:'0 2px' },
        cellRenderer: function(p) {
          var wrap = document.createElement('div');
          wrap.style.cssText = 'display:flex;gap:2px;';
          // + 버튼: 같은 자재를 다른 LOT로 추가
          var addBtn = document.createElement('button');
          addBtn.className = 'tbl-btn';
          addBtn.style.cssText = 'width:24px;height:22px;padding:0;display:flex;align-items:center;justify-content:center;color:#2563eb;';
          addBtn.innerHTML = '+';
          addBtn.title = '같은 자재 LOT 분리 추가';
          addBtn.onclick = function() {
            addReceiptRow({
              item_id: p.data.item_id, item_name: p.data.item_name,
              purchase_unit: p.data.purchase_unit, purchase_unit_qty: p.data.purchase_unit_qty,
              use_unit: p.data.use_unit, order_item_id: p.data.order_item_id,
              order_qty: p.data.order_qty, received_qty: p.data.received_qty,
              qty: 0, unit_price: p.data.unit_price, supply_price: 0,
              lot_no: '', memo: '',
            });
          };
          // ✕ 버튼
          var delBtn = document.createElement('button');
          delBtn.className = 'tbl-btn tbl-btn--danger';
          delBtn.style.cssText = 'width:24px;height:22px;padding:0;display:flex;align-items:center;justify-content:center;';
          delBtn.innerHTML = '✕';
          delBtn.onclick = function() { removeReceiptRow(p.node.data._rowId); };
          wrap.appendChild(addBtn);
          wrap.appendChild(delBtn);
          return wrap;
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
    qty:           0,
    unit_price:    0,
    supply_price:  0,
    memo:          '',
  }, preset || {});
  if (_gridReceiptItem) {
    _gridReceiptItem.applyTransaction({ add: [row] });
    refreshReceiptTotal();
    updateReceiptItemCount();
    refitGridColumns(_gridReceiptItem);
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
var _gridTransferInfo = null;
var _selectedTransferItem = null;

function initTransferInfoGrid() {
  var el = document.getElementById('transferInfoGrid');
  if (!el || typeof agGrid === 'undefined') return;
  el.style.height = Math.max(200, window.innerHeight - 250) + 'px';

  _gridTransferInfo = agGrid.createGrid(el, {
    suppressPropertyNamesCheck: true,
    suppressCellFocus: false,
    columnDefs: [
      { headerName: '항목', field: 'label', width: 90, flex: 0,
        headerClass: 'ag-left-header',
        cellStyle: { display:'flex', alignItems:'center', justifyContent:'flex-start',
                     fontWeight:600, color:'#6b7280', fontSize:'11px', background:'#f8fafc' },
        suppressCellFocus: true,
      },
      { headerName: '값', field: 'value', flex: 1,
        headerClass: 'ag-left-header',
        editable: function(p) { return p.data.editable === true; },
        singleClickEdit: true,
        cellEditorSelector: function(p) {
          if (!p.data.editable) return undefined;
          return { component: p.data.editor || 'agTextCellEditor', params: p.data.editorParams || {} };
        },
        cellStyle: function(p) {
          var base = { display:'flex', alignItems:'center', justifyContent:'flex-start' };
          if (p.data.editable) Object.assign(base, { color:'#111827', cursor:'pointer' });
          else Object.assign(base, { color:'#374151' });
          if (p.data.key === 'from') Object.assign(base, { color:'#2563eb', fontWeight:700 });
          if (p.data.key === 'qty') Object.assign(base, { fontWeight:700, color:'#059669' });
          return base;
        },
        cellRenderer: function(p) {
          if (p.data.key === 'to' && !p.value) return '<span style="color:#d1d5db;">도착 부서 클릭하여 선택</span>';
          if (p.data.key === 'qty') return p.value + ' ' + (_selectedTransferItem?.use_unit||'') + '<span style="color:#9ca3af;font-size:10px;margin-left:6px;">최대 ' + (_selectedTransferItem?.qty||0) + '</span>';
          if (p.data.key === 'history') return p.value || '<span style="color:#9ca3af;">이동 이력 없음</span>';
          return ts(p.value || '-');
        },
        onCellValueChanged: function(p) {
          if (p.data.key === 'to') {
            var dept = _deptOptions.find(function(d) { return d.name === p.newValue; });
            _selectedTransferItem._toDeptId   = dept?.id   || '';
            _selectedTransferItem._toDeptName = dept?.name || '';
          }
          if (p.data.key === 'qty') {
            var max = _selectedTransferItem?.qty || 0;
            if (Number(p.newValue) > max) {
              alert('현재고(' + max + ')를 초과합니다.');
              p.node.setDataValue('value', max);
            }
          }
        }
      },
    ],
    rowData: [],
    rowHeight: 38, headerHeight: 34,
    suppressHorizontalScroll: true,
    stopEditingWhenCellsLoseFocus: true,
    defaultColDef: { sortable:false, resizable:false, suppressMovable:true },
    overlayNoRowsTemplate: '<span style="color:#9ca3af;font-size:12px;">← 왼쪽에서 품목을 클릭하세요</span>',
    onGridReady: function(params) {
      setTimeout(function() { if (el.offsetWidth > 0) params.api.sizeColumnsToFit(); }, 0);
    },
  });
}

function selectTransferItem(row) {
  _selectedTransferItem = {
    lot_id:         row.id,           // stock_lots.id
    item_id:        row.item_id,
    item_name:      row.items?.item_name || '-',
    lot_no:         row.lot_no || '-',
    receipt_date:   row.receipt_date || '',
    unit_price:     row.unit_price || 0,
    use_unit:       row.use_unit || row.items?.use_unit || '',
    qty:            row.qty,
    from_dept_id:   row.dept_id || null,
    from_dept_name: row.departments?.dept_name || '중앙창고',
    _toDeptId:      '',
    _toDeptName:    '',
  };

  var lbl = document.getElementById('transferItemLabel');
  if (lbl) lbl.textContent = _selectedTransferItem.item_name + ' [' + _selectedTransferItem.lot_no + ']';

  var sum = document.getElementById('transferSummary');
  if (sum) sum.textContent = _selectedTransferItem.from_dept_name + ' · 잔여 ' +
    Number(_selectedTransferItem.qty).toLocaleString('ko-KR') + ' ' + _selectedTransferItem.use_unit;

  var deptNames = _deptOptions
    .filter(function(d) { return d.id !== _selectedTransferItem.from_dept_id; })
    .map(function(d) { return d.name; });

  if (!_gridTransferInfo) initTransferInfoGrid();

  _gridTransferInfo.setGridOption('rowData', [
    { key:'lot',     label:'LOT번호',   value: _selectedTransferItem.lot_no, editable:false },
    { key:'date',    label:'입고일',     value: _selectedTransferItem.receipt_date, editable:false },
    { key:'price',   label:'단가',       value: fmtN(_selectedTransferItem.unit_price) + '원', editable:false },
    { key:'from',    label:'출발 부서',  value: _selectedTransferItem.from_dept_name, editable:false },
    { key:'to',      label:'도착 부서',  value: '', editable:true,
      editor:'agSelectCellEditor', editorParams:{ values: deptNames } },
    { key:'qty',     label:'이동 수량',  value: 1,  editable:true,
      editor:'agNumberCellEditor', editorParams:{ min:1, max:_selectedTransferItem.qty } },
    { key:'history', label:'최근 이력',  value: '불러오는 중...', editable:false },
  ]);

  var btn = document.getElementById('transferSaveBtn');
  if (btn) btn.disabled = false;

  loadTransferHistory(_selectedTransferItem.item_id);
}

async function loadTransferHistory(itemId) {
  var { data } = await supabaseClient
    .from('stock_transfers')
    .select('transfer_date, qty, use_unit, from_dept_id, to_dept_id')
    .eq('item_id', itemId)
    .order('created_at', { ascending: false })
    .limit(3);

  if (!_gridTransferInfo) return;
  var histText = '이동 이력 없음';
  if (data && data.length) {
    // 부서명 별도 조회
    var deptIds = [...new Set([
      ...(data.map(function(r){return r.from_dept_id;}).filter(Boolean)),
      ...(data.map(function(r){return r.to_dept_id;}).filter(Boolean)),
    ])];
    var deptNameMap = {};
    if (deptIds.length) {
      var { data:depts } = await supabaseClient.from('departments').select('id,dept_name').in('id',deptIds);
      (depts||[]).forEach(function(d){ deptNameMap[d.id] = d.dept_name; });
    }
    histText = data.map(function(r) {
      var from = r.from_dept_id ? (deptNameMap[r.from_dept_id]||'?') : '중앙창고';
      var to   = r.to_dept_id   ? (deptNameMap[r.to_dept_id]||'?')   : '중앙창고';
      return (r.transfer_date||'').slice(0,10) + '  ' + from + ' → ' + to +
             '  ' + Number(r.qty).toLocaleString('ko-KR') + (r.use_unit||'');
    }).join(' | ');
  }

  // history 행 업데이트
  _gridTransferInfo.forEachNode(function(node) {
    if (node.data.key === 'history') node.setDataValue('value', histText);
  });
}

async function saveTransfer() {
  if (!_selectedTransferItem) { alert('이동할 품목을 선택하세요.'); return; }
  var toDeptId = _selectedTransferItem._toDeptId || '';
  var qty = 1;
  if (_gridTransferInfo) {
    _gridTransferInfo.forEachNode(function(node) {
      if (node.data.key === 'to')  toDeptId = _selectedTransferItem._toDeptId || '';
      if (node.data.key === 'qty') qty = Number(node.data.value) || 1;
    });
  }
  var transferDate = val('transferDate');
  var memo         = val('transferMemo');

  if (!toDeptId)     { alert('도착 부서를 선택하세요.'); return; }
  if (qty < 1)       { alert('이동 수량을 1 이상 입력하세요.'); return; }
  if (qty > _selectedTransferItem.qty) { alert('LOT 잔여수량(' + _selectedTransferItem.qty + ')을 초과합니다.'); return; }
  if (!transferDate) { alert('이동일을 입력하세요.'); return; }

  var btn = document.getElementById('transferSaveBtn');
  if (btn) btn.disabled = true;
  showGlobalLoading('재고 이동 중...');
  try {
    var session = await supabaseClient.auth.getSession();
    var userId  = session.data?.session?.user?.id || null;

    // 1. 출발 LOT 잔여수량 차감
    var { error: lotOutErr } = await supabaseClient.from('stock_lots')
      .update({ qty: _selectedTransferItem.qty - qty })
      .eq('id', _selectedTransferItem.lot_id);
    if (lotOutErr) throw new Error('LOT 차감 실패: ' + lotOutErr.message);

    // 2. 도착 부서 LOT 생성 (단가 승계)
    var { data: newLot, error: lotInErr } = await supabaseClient.from('stock_lots').insert({
      item_id:      _selectedTransferItem.item_id,
      receipt_id:   null,
      lot_no:       _selectedTransferItem.lot_no,
      receipt_date: _selectedTransferItem.receipt_date,
      unit_price:   _selectedTransferItem.unit_price,
      purchase_unit: '',
      use_unit:     _selectedTransferItem.use_unit,
      dept_id:      toDeptId,
      qty:          qty,
    }).select('id').single();
    if (lotInErr) throw new Error('도착 LOT 생성 실패: ' + lotInErr.message);

    var transferNo = await genDocNo('TR');

    // 3. stock_transfers 기록
    var { error: te } = await supabaseClient.from('stock_transfers').insert({
      transfer_no:   transferNo,
      item_id:       _selectedTransferItem.item_id,
      from_dept_id:  _selectedTransferItem.from_dept_id,
      to_dept_id:    toDeptId,
      qty:           qty,
      use_unit:      _selectedTransferItem.use_unit,
      lot_no:        _selectedTransferItem.lot_no,
      lot_id:        _selectedTransferItem.lot_id,
      unit_price:    _selectedTransferItem.unit_price,
      transfer_date: transferDate,
      memo:          memo,
      created_by:    userId,
    });
    if (te) throw new Error('이동 기록 실패: ' + te.message);

    // 4. stock_transactions (출발 OUT + 도착 IN) — lot_id + unit_price 포함
    var { error: txe } = await supabaseClient.from('stock_transactions').insert([
      { item_id: _selectedTransferItem.item_id, dept_id: _selectedTransferItem.from_dept_id || null,
        tx_type:'OUT', tx_date: transferDate, qty: -qty, use_unit: _selectedTransferItem.use_unit,
        ref_type:'transfer', lot_id: _selectedTransferItem.lot_id, unit_price: _selectedTransferItem.unit_price, created_by: userId },
      { item_id: _selectedTransferItem.item_id, dept_id: toDeptId,
        tx_type:'IN', tx_date: transferDate, qty: qty, use_unit: _selectedTransferItem.use_unit,
        ref_type:'transfer', lot_id: newLot.id, unit_price: _selectedTransferItem.unit_price, created_by: userId },
    ]);
    if (txe) throw new Error('재고 이동 실패: ' + txe.message);

    // 5. stock_current 갱신
    await upsertStockCurrent(_selectedTransferItem.item_id, -qty, _selectedTransferItem.from_dept_id);
    await upsertStockCurrent(_selectedTransferItem.item_id,  qty, toDeptId);

    var toDeptName = _deptOptions.find(function(d){ return d.id===toDeptId; })?.name || '';
    alert('재고 이동 완료! [' + _selectedTransferItem.lot_no + '] ' +
      _selectedTransferItem.from_dept_name + ' → ' + toDeptName + ' ' + qty + _selectedTransferItem.use_unit);

    _selectedTransferItem = null;
    var lbl = document.getElementById('transferItemLabel'); if(lbl) lbl.textContent = '';
    var sum = document.getElementById('transferSummary'); if(sum) sum.textContent = '← 왼쪽에서 품목을 선택하세요';
    if(btn) btn.disabled = true;
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

  var invalid = rows.find(function(r) { return !r.qty || Number(r.qty) <= 0; });
  if (invalid) { alert('[' + invalid.item_name + '] 수량을 1 이상 입력해 주세요.'); return; }

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
  var receivedQtyMap = {};  // order_item_id → { base, added } — LOT 분리 행 합산용

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
      lot_no:            r.lot_no || '',
      memo:              r.memo || '',
    }).select('id');
    if (error) throw new Error('[' + r.item_name + '] ' + error.message);
    var newReceiptId = newReceiptArr?.[0]?.id || null;

    // stock_lots 생성 (중앙창고 LOT)
    var useQty = qty * (r.purchase_unit_qty || 1);
    var { data: newLotArr, error: le } = await supabaseClient.from('stock_lots').insert({
      item_id:      r.item_id,
      receipt_id:   newReceiptId,
      lot_no:       r.lot_no || receiptNo,
      receipt_date: receiptDate,
      unit_price:   price,
      purchase_unit: r.purchase_unit || '',
      use_unit:     r.use_unit || '',
      dept_id:      null,
      qty:          useQty,
    }).select('id');
    if (le) throw new Error('[' + r.item_name + '] LOT 생성 실패: ' + le.message);
    var newLotId = newLotArr?.[0]?.id || null;

    // stock_transactions에 IN 기록 (중앙창고, dept_id=NULL)
    var { error: te } = await supabaseClient.from('stock_transactions').insert({
      item_id:    r.item_id,
      dept_id:    null,
      tx_type:    'IN',
      tx_date:    receiptDate,
      qty:        useQty,
      use_unit:   r.use_unit || '',
      ref_type:   'receipt',
      ref_id:     newReceiptId,
      lot_id:     newLotId,
      unit_price: price,
      memo:       r.memo || '',
    });
    if (te) throw new Error('[' + r.item_name + '] 이력 기록 실패: ' + te.message);

    // 중앙창고 재고 적립
    await upsertStockCurrent(r.item_id, useQty, null);

    // 발주서 품목별 입고 처리 — order_item_id별 합산은 루프 후 한 번에 처리
    if (r.order_item_id) {
      if (!receivedQtyMap[r.order_item_id]) {
        receivedQtyMap[r.order_item_id] = { base: r.received_qty || 0, added: 0 };
      }
      receivedQtyMap[r.order_item_id].added += qty;
      if (orderId) touchedOrders.add(orderId);
    }
  }

  // order_item_id별 received_qty 일괄 업데이트 (같은 품목 여러 LOT 입고 시 덮어쓰기 방지)
  for (var poiId in receivedQtyMap) {
    var rec = receivedQtyMap[poiId];
    await supabaseClient.from('purchase_order_items')
      .update({ received_qty: rec.base + rec.added }).eq('id', poiId);
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

/** 불출 발주서 목록 체크박스 컬럼의 헤더 — 화면에 보이는 발주서를 한 번에 전체선택/해제 */
function DispatchSelectAllHeader() {}
DispatchSelectAllHeader.prototype.init = function(params) {
  this.eGui = document.createElement('div');
  this.eGui.style.cssText = 'display:flex;align-items:center;justify-content:center;width:100%;height:100%;';
  var cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.title = '발주서 전체선택';
  cb.style.cssText = 'width:15px;height:15px;cursor:pointer;margin:0;';
  this.eGui.appendChild(cb);
  _dispatchSelectAllCheckbox = cb;
  cb.onclick = function() {
    var checked = _dispatchSelectAllCheckbox.checked;
    params.api.forEachNode(function(node) {
      if (checked) _selectedDispatchPoIds.add(node.data.id);
      else _selectedDispatchPoIds.delete(node.data.id);
    });
    params.api.refreshCells({ force: true, columns: [params.column.getColId()] });
    updateBulkDispatchBtn();
  };
};
DispatchSelectAllHeader.prototype.getGui = function() { return this.eGui; };
var _dispatchSelectAllCheckbox = null;
var _selectedDispatchPoIds = new Set(); // 일괄불출용 — 체크된 발주서 id 모음

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
      { headerName: '', width: 36, sortable: false, suppressMovable: true,
        headerComponent: DispatchSelectAllHeader,
        cellStyle: { display:'flex', alignItems:'center', justifyContent:'center' },
        cellRenderer: function(p) {
          var cb = document.createElement('input');
          cb.type = 'checkbox';
          cb.style.cssText = 'width:15px;height:15px;cursor:pointer;';
          cb.checked = _selectedDispatchPoIds.has(p.data.id);
          cb.onclick = function(e) { e.stopPropagation(); toggleDispatchPoSelection(p.data.id, cb.checked); };
          return cb;
        }
      },
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
  // '불출완료'는 실제 status 컬럼 값이 아니라(이미 'COMPLETED'에 입고완료/불출완료가 같이 섞여있음),
  // 모든 품목이 다 불출됐는지로 판단하는 가상 필터라 쿼리에는 COMPLETED로 보냄
  var isDispatchedFilter = status === 'DISPATCHED';
  var statusQuery = isDispatchedFilter ? 'COMPLETED' : status;
  _selectedDispatchPoIds.clear();
  updateBulkDispatchBtn();
  showGlobalLoading('발주서 목록을 불러오는 중...');
  try {
    var q=supabaseClient.from('purchase_orders')
      .select('id,order_no,order_date,status,request_id,vendors(vendor_name),purchase_requests(dept_id,departments(dept_name))')
      .in('status',statusQuery?[statusQuery]:['COMPLETED','PARTIAL'])
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

    // 발주 상태(입고완료/부분입고)만 보고 가져온 목록이라, 실제로 불출할 품목이 남아있는지는
    // 별도로 확인해야 함 — '불출완료' 필터가 아니면 모든 품목이 이미 다 불출된 발주서는 목록에서 빼고,
    // '불출완료' 필터면 반대로 그것들만 보여줌
    if (rows.length) {
      var orderIds = rows.map(function(r) { return r.id; });
      var { data: poItems } = await supabaseClient
        .from('purchase_order_items').select('order_id, order_qty, dispatched_qty')
        .in('order_id', orderIds);
      var hasRemaining = {};
      (poItems || []).forEach(function(it) {
        if ((it.dispatched_qty || 0) < it.order_qty) hasRemaining[it.order_id] = true;
      });
      rows = rows.filter(function(r) { return isDispatchedFilter ? !hasRemaining[r.id] : hasRemaining[r.id]; });
    }

    if(!_gridDispatchPo) initDispatchPoGrid();
    if(_gridDispatchPo) { _gridDispatchPo.setGridOption('rowData',rows); refitGridColumns(_gridDispatchPo); }
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
      {headerName:'자재명',field:'item_name',flex:1,minWidth:100,headerClass:'ag-left-header',
        suppressCellFocus:true,
        cellStyle:{display:'flex',alignItems:'center',justifyContent:'flex-start',fontWeight:600}
      },
      {headerName:'LOT번호',field:'lot_no',width:130,headerClass:'ag-left-header',
        suppressCellFocus:true,
        cellStyle:{display:'flex',alignItems:'center',justifyContent:'flex-start',color:'#1d4ed8',fontFamily:'Consolas,monospace',fontSize:'11px',paddingLeft:'8px'}
      },
      {headerName:'입고일',field:'receipt_date',width:85,
        suppressCellFocus:true,
        cellRenderer:function(p){return p.value?String(p.value).slice(0,10):'-';}
      },
      {headerName:'단가',field:'unit_price',width:75,
        suppressCellFocus:true,
        cellStyle:{display:'flex',alignItems:'center',justifyContent:'flex-end'},
        cellRenderer:function(p){return Number(p.value||0).toLocaleString('ko-KR')+'원';}
      },
      {headerName:'중앙재고',field:'qty',width:80,
        suppressCellFocus:true,
        cellStyle:{display:'flex',alignItems:'center',justifyContent:'flex-end',color:'#059669',fontWeight:700},
        valueFormatter:function(p){return Number(p.value||0).toLocaleString('ko-KR');}
      },
      {headerName:'불출수량',field:'dispatch_qty',width:80,
        editable:true, singleClickEdit:true,
        cellEditor:'agNumberCellEditor', cellEditorParams:{min:0},
        valueFormatter:function(p){return Number(p.value||0).toLocaleString('ko-KR');},
        cellStyle:function(p){
          var over=(p.value||0)>(p.data.qty||0);
          return {display:'flex',alignItems:'center',justifyContent:'flex-end',color:over?'#dc2626':'#111827',fontWeight:'600'};
        },
        onCellValueChanged:function(p){
          var max=p.data.qty||0;
          if(Number(p.newValue)>max){alert('LOT 재고('+max+')를 초과할 수 없습니다.');p.node.setDataValue('dispatch_qty',max);}
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

  // 발주서 품목 조회 (아직 불출 잔여분이 있는 것만)
  var {data:items,error}=await supabaseClient
    .from('purchase_order_items')
    .select('id,item_id,order_qty,received_qty,dispatched_qty,purchase_unit,purchase_unit_qty,use_unit,items(item_name)')
    .eq('order_id',po.id);
  if(error){alert('품목 조회 실패: '+error.message);return;}
  var openItems=(items||[]).filter(function(r){return (r.dispatched_qty||0)<r.order_qty;});
  if(!openItems.length){
    if(!_gridDispatchItem) initDispatchItemGrid();
    _gridDispatchItem.setGridOption('rowData',[]);
    var btn=document.getElementById('dispatchSaveBtn'); if(btn) btn.disabled=true;
    loadDispatchHistory(po.id);
    return;
  }

  // 해당 품목들의 중앙창고 LOT 목록 조회
  var itemIds=openItems.map(function(r){return r.item_id;});
  var {data:lots,error:le}=await supabaseClient
    .from('stock_lots')
    .select('id,item_id,lot_no,receipt_date,unit_price,purchase_unit,use_unit,qty,items(item_name)')
    .in('item_id',itemIds)
    .is('dept_id',null)   // 중앙창고
    .gt('qty',0)          // 잔여수량 있는 것만
    .order('receipt_date',{ascending:true}); // 입고일 오름차순
  if(le){alert('LOT 조회 실패: '+le.message);return;}

  if(!_gridDispatchItem) initDispatchItemGrid();
  _gridDispatchItem.setGridOption('rowData',(lots||[]).map(function(l){
    var poi=openItems.find(function(r){return r.item_id===l.item_id;})||{};
    return {
      _lotId:         l.id,
      _poiId:         poi.id,
      item_id:        l.item_id,
      item_name:      l.items?.item_name||'-',
      lot_no:         l.lot_no||'-',
      receipt_date:   l.receipt_date,
      unit_price:     l.unit_price||0,
      purchase_unit:  l.purchase_unit||'',
      use_unit:       l.use_unit||'',
      qty:            l.qty,         // 중앙창고 LOT 잔여수량
      dispatch_qty:   0,
      dispatched_qty: poi.dispatched_qty||0,
      order_qty:      poi.order_qty||0,
      purchase_unit_qty: poi.purchase_unit_qty||1,
    };
  }));
  refitGridColumns(_gridDispatchItem);
  var cnt=document.getElementById('dispatchItemCount'); if(cnt) cnt.textContent=(lots||[]).length+'건 (LOT)';
  var btn=document.getElementById('dispatchSaveBtn'); if(btn) btn.disabled=false;
  loadDispatchHistory(po.id);
  updateDispatchSummary();
}

function updateDispatchSummary() {
  var total=0,items=0;
  if(_gridDispatchItem) _gridDispatchItem.forEachNode(function(n){if((n.data.dispatch_qty||0)>0){items++;total+=n.data.dispatch_qty;}});
  var sum=document.getElementById('dispatchSummary');
  if(sum) sum.textContent=items>0?items+'개 품목, 총 '+total+'개 불출 예정':'불출 수량을 입력하세요';
  var btn=document.getElementById('dispatchSaveBtn'); if(btn) btn.disabled=items===0;
}

/* ── 불출 이력 (취소 가능) ── */
var _gridDispatchHistory = null;

function initDispatchHistoryGrid() {
  var el = document.getElementById('dispatchHistoryGrid');
  if (!el || typeof agGrid === 'undefined') return;
  _gridDispatchHistory = agGrid.createGrid(el, {
    suppressCellFocus: true, suppressPropertyNamesCheck: true,
    columnDefs: [
      { headerName: '자재명', field: 'item_name', flex: 1, minWidth: 100, headerClass:'ag-left-header',
        cellStyle: { display:'flex', alignItems:'center', justifyContent:'flex-start' }
      },
      { headerName: 'LOT번호', field: 'lot_no', width: 110, headerClass:'ag-left-header',
        cellStyle: { display:'flex', alignItems:'center', justifyContent:'flex-start', color:'#1d4ed8', fontFamily:'Consolas,monospace', fontSize:'11px', paddingLeft:'8px' }
      },
      { headerName: '부서', field: 'dept_name', width: 80 },
      { headerName: '불출일', field: 'dispatch_date', width: 90,
        cellRenderer: function(p) { return fmtDate(p.value); }
      },
      { headerName: '수량', field: 'dispatch_qty', width: 70,
        cellStyle: { display:'flex', alignItems:'center', justifyContent:'flex-end' },
        cellRenderer: function(p) { return fmtN(p.value) + ' ' + ts(p.data.use_unit||''); }
      },
      { headerName: '', width: 56, sortable: false,
        cellRenderer: function(p) {
          var btn = document.createElement('button');
          btn.className = 'tbl-btn tbl-btn--danger';
          btn.style.cssText = 'padding:2px 8px;font-size:11px;';
          btn.textContent = '취소';
          btn.onclick = function() { cancelDispatch(p.data.id); };
          return btn;
        }
      },
    ],
    rowData: [], rowHeight: 30, headerHeight: 30, suppressHorizontalScroll: true,
    defaultColDef: { sortable:false, resizable:true, suppressMovable:true,
      cellStyle:{ display:'flex', alignItems:'center', justifyContent:'center' } },
    overlayNoRowsTemplate: '<span style="color:#9ca3af;font-size:11px;">불출 이력이 없습니다.</span>',
    onGridReady: function(params) { setTimeout(function(){ params.api.sizeColumnsToFit(); }, 0); },
  });
}

async function loadDispatchHistory(orderId) {
  if (!_gridDispatchHistory) initDispatchHistoryGrid();
  var { data, error } = await supabaseClient
    .from('stock_dispatch')
    .select('id, dispatch_qty, dispatch_date, use_unit, lot_no, items(item_name), departments(dept_name)')
    .eq('order_id', orderId)
    .order('dispatch_date', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) { console.error(error); return; }
  var rows = (data || []).map(function(r) {
    return { id: r.id, item_name: r.items?.item_name || '-', lot_no: r.lot_no || '-',
      dept_name: r.departments?.dept_name || '-',
      dispatch_date: r.dispatch_date, dispatch_qty: r.dispatch_qty, use_unit: r.use_unit };
  });
  if (_gridDispatchHistory) { _gridDispatchHistory.setGridOption('rowData', rows); refitGridColumns(_gridDispatchHistory); }
  var cnt = document.getElementById('dispatchHistoryCount'); if (cnt) cnt.textContent = rows.length ? rows.length + '건 (LOT)' : '';
}

/** 불출 1건 취소 — 재고를 부서에서 다시 중앙창고로 되돌리고, 발주서의 불출수량/상태도 같이 되돌림 */
async function cancelDispatch(dispatchId) {
  if (!confirm('이 불출 건을 취소하시겠습니까? 해당 수량만큼 부서 재고가 줄고 중앙창고로 다시 돌아갑니다.')) return;
  showGlobalLoading('불출 취소 중...');
  try {
    var { data: d, error: de } = await supabaseClient
      .from('stock_dispatch').select('*').eq('id', dispatchId).single();
    if (de) throw new Error(de.message);

    var session = await supabaseClient.auth.getSession();
    var userId  = session.data?.session?.user?.id || null;

    var cancelDate = new Date().toISOString().slice(0,10);

    // lot_id가 있으면 LOT 단위 원복, 없으면 구버전 데이터 — stock_lots 없이 stock_current만 원복
    if (d.lot_id) {
      // 1. 부서 LOT 삭제 (불출로 생성된 LOT)
      // 부서 lot 중 이 dispatch의 lot_id(중앙창고 원본)와 lot_no가 같고 dept_id가 일치하는 것을 찾아 삭제
      var { data: deptLot } = await supabaseClient.from('stock_lots')
        .select('id, qty')
        .eq('dept_id', d.dept_id)
        .eq('lot_no', d.lot_no)
        .eq('item_id', d.item_id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      // 취소하려는 수량만큼 부서 LOT에 실제로 남아있는지 먼저 확인 — 그 사이 사용처리 등으로
      // 이미 일부/전부 소진됐으면 취소 시 재고가 허공에서 생겨날 수 있으므로 막아야 함
      var deptLotQty = deptLot?.qty || 0;
      if (deptLotQty < d.dispatch_qty) {
        alert('취소할 수 없습니다.\n해당 부서 LOT에 남은 재고(' + fmtN(deptLotQty) + ')가 불출 수량(' + fmtN(d.dispatch_qty) + ')보다 적습니다.\n(이미 사용처리 등으로 소진된 것으로 보입니다.)');
        hideGlobalLoading();
        return;
      }

      if (deptLot) {
        var remainAfterCancel = deptLot.qty - d.dispatch_qty;
        if (remainAfterCancel <= 0) {
          await supabaseClient.from('stock_lots').delete().eq('id', deptLot.id);
        } else {
          await supabaseClient.from('stock_lots').update({ qty: remainAfterCancel }).eq('id', deptLot.id);
        }
      }
      // 2. 중앙창고 원본 LOT 수량 복원
      var { data: srcLot } = await supabaseClient.from('stock_lots').select('qty,unit_price').eq('id', d.lot_id).maybeSingle();
      if (srcLot) {
        await supabaseClient.from('stock_lots').update({ qty: (srcLot.qty || 0) + d.dispatch_qty }).eq('id', d.lot_id);
      }
    } else {
      // 구버전(LOT 정보 없는) 불출 — stock_current 기준으로만 검증
      var deptQty = await getStockQty(d.item_id, d.dept_id);
      if (deptQty < d.dispatch_qty) {
        alert('취소할 수 없습니다.\n해당 부서에 남은 재고(' + fmtN(deptQty) + ')가 불출 수량(' + fmtN(d.dispatch_qty) + ')보다 적습니다.\n(이미 사용처리 등으로 소진된 것으로 보입니다.)');
        hideGlobalLoading();
        return;
      }
    }

    // stock_transactions 취소 이력 — 원래 LOT 단가를 그대로 같이 기록 (조정금액 계산용)
    var cancelUnitPrice = srcLot?.unit_price || 0;
    var { error: te } = await supabaseClient.from('stock_transactions').insert([
      { item_id: d.item_id, dept_id: d.dept_id, tx_type:'OUT', tx_date: cancelDate, qty: -d.dispatch_qty, use_unit: d.use_unit, ref_type:'dispatch_cancel', ref_id: d.id, lot_id: d.lot_id||null, unit_price: cancelUnitPrice, created_by: userId },
      { item_id: d.item_id, dept_id: null,       tx_type:'IN',  tx_date: cancelDate, qty:  d.dispatch_qty, use_unit: d.use_unit, ref_type:'dispatch_cancel', ref_id: d.id, lot_id: d.lot_id||null, unit_price: cancelUnitPrice, created_by: userId },
    ]);
    if (te) throw new Error('재고 원복 실패: ' + te.message);
    await upsertStockCurrent(d.item_id, -d.dispatch_qty, d.dept_id);
    await upsertStockCurrent(d.item_id,  d.dispatch_qty, null);

    // 발주서 품목의 불출수량 되돌리고, 발주서 상태도 다시 PARTIAL/COMPLETED(입고완료)로 조정
    if (d.order_item_id) {
      var { data: poi } = await supabaseClient.from('purchase_order_items').select('dispatched_qty,purchase_unit_qty').eq('id', d.order_item_id).single();
      // dispatched_qty는 order_qty와 같은 단위(구매단위)인데, d.dispatch_qty는 LOT 기준(사용단위)이므로 환산해서 빼야 함
      var puQtyForCancel = poi?.purchase_unit_qty || 1;
      var newDispatched = Math.max(0, (poi?.dispatched_qty || 0) - (d.dispatch_qty / puQtyForCancel));
      await supabaseClient.from('purchase_order_items').update({ dispatched_qty: newDispatched }).eq('id', d.order_item_id);
    }
    if (d.order_id) {
      var { data: allItems } = await supabaseClient.from('purchase_order_items').select('order_qty,dispatched_qty').eq('order_id', d.order_id);
      var anyDispatched = (allItems || []).some(function(it) { return (it.dispatched_qty || 0) > 0; });
      await supabaseClient.from('purchase_orders').update({ status: anyDispatched ? 'PARTIAL' : 'COMPLETED' }).eq('id', d.order_id);
    }

    // stock_dispatch 기록 자체는 삭제 — 더 이상 유효한 불출이 아님 (재고 이동 이력은 stock_transactions에 그대로 남음)
    await supabaseClient.from('stock_dispatch').delete().eq('id', dispatchId);

    alert('불출이 취소됐습니다.');
    if (d.order_id) {
      var po = { id: d.order_id, order_no:'', _vendorName:'', _deptName:'-' };
      var node = null;
      if (_gridDispatchPo) _gridDispatchPo.forEachNode(function(n) { if (n.data.id === d.order_id) node = n; });
      if (node) await selectDispatchPo(node.data);
      else await loadDispatchHistory(d.order_id);
    }
    loadDispatchPoList();
  } catch(e) {
    alert('불출 취소 실패: ' + e.message);
  } finally {
    hideGlobalLoading();
  }
}
window.cancelDispatch = cancelDispatch;

/** 불출 발주서 체크박스 선택/해제 */
function toggleDispatchPoSelection(id, checked) {
  if (checked) _selectedDispatchPoIds.add(id);
  else _selectedDispatchPoIds.delete(id);
  updateBulkDispatchBtn();
}

function updateBulkDispatchBtn() {
  var btn = document.getElementById('bulkDispatchBtn');
  if (btn) {
    var n = _selectedDispatchPoIds.size;
    btn.disabled = n === 0;
    btn.textContent = n > 0 ? '선택 일괄불출 (' + n + '건)' : '선택 일괄불출';
  }
  if (_selectedDispatchPoIds.size === 0 && _dispatchSelectAllCheckbox) _dispatchSelectAllCheckbox.checked = false;
}

/** 체크된 발주서들을 한 번에 — 각 발주서의 미불출 품목 전량을, 그 발주서에 연결된
 *  요청부서로 일괄 불출 처리 (발주확정과 동일한 일괄처리 패턴) */
async function bulkDispatchSelectedPo() {
  var ids = Array.from(_selectedDispatchPoIds);
  if (!ids.length) return;
  var dispatchDate = val('dispatchDate');
  if (!dispatchDate) { alert('불출일을 입력하세요.'); return; }
  if (!confirm(ids.length + '건의 발주서를 각 요청부서로 일괄 불출(전량) 하시겠습니까?')) return;

  var btn = document.getElementById('bulkDispatchBtn');
  if (btn) btn.disabled = true;
  showGlobalLoading('일괄 불출 처리 중...');
  var okCount = 0;
  var failed = [];
  try {
    var session = await supabaseClient.auth.getSession();
    var userId = session.data?.session?.user?.id || null;

    for (var i = 0; i < ids.length; i++) {
      var orderId = ids[i];
      try {
        var { data: poData } = await supabaseClient.from('purchase_orders')
          .select('request_id,purchase_requests(dept_id,departments(dept_name))')
          .eq('id', orderId).single();
        var deptId = poData?.purchase_requests?.dept_id || null;
        if (!deptId) { failed.push(orderId); continue; }

        var { data: items } = await supabaseClient
          .from('purchase_order_items')
          .select('id,item_id,order_qty,dispatched_qty,purchase_unit_qty,use_unit')
          .eq('order_id', orderId);
        var openItems = (items || []).filter(function(r) { return (r.dispatched_qty || 0) < r.order_qty; });
        if (!openItems.length) continue;

        var poiDispatchAccum = {}; // 품목별 누적(여러 LOT으로 나뉠 수 있으므로)

        for (var j = 0; j < openItems.length; j++) {
          var r = openItems[j];
          var puQty = r.purchase_unit_qty || 1;
          var needQty = (r.order_qty - (r.dispatched_qty || 0)) * puQty; // 미불출 전량 — 사용단위로 환산(LOT은 사용단위 기준)

          // 중앙창고 LOT을 입고일 오름차순(FIFO)으로 가져와서 필요한 만큼 순서대로 소비
          var { data: lots } = await supabaseClient
            .from('stock_lots')
            .select('id,lot_no,receipt_date,unit_price,purchase_unit,use_unit,qty')
            .eq('item_id', r.item_id).is('dept_id', null).gt('qty', 0)
            .order('receipt_date', { ascending: true });

          var remaining = needQty;
          for (var k = 0; k < (lots || []).length && remaining > 0; k++) {
            var lot = lots[k];
            var takeQty = Math.min(lot.qty, remaining);
            if (takeQty <= 0) continue;

            // 1. 중앙창고 LOT 차감
            var { error: lotOutErr } = await supabaseClient.from('stock_lots')
              .update({ qty: lot.qty - takeQty }).eq('id', lot.id);
            if (lotOutErr) throw new Error(lotOutErr.message);

            // 2. 부서 LOT 생성 (단가 승계)
            var { data: newDeptLot, error: lotInErr } = await supabaseClient.from('stock_lots').insert({
              item_id: r.item_id, receipt_id: null, lot_no: lot.lot_no, receipt_date: lot.receipt_date,
              unit_price: lot.unit_price, purchase_unit: lot.purchase_unit || '', use_unit: lot.use_unit || r.use_unit || '',
              dept_id: deptId, qty: takeQty,
            }).select('id').single();
            if (lotInErr) throw new Error(lotInErr.message);

            // 3. stock_dispatch 기록
            var dispatchNo = await genDocNo('SD');
            var { data: newDispatch, error: de } = await supabaseClient.from('stock_dispatch').insert({
              dispatch_no: dispatchNo, item_id: r.item_id, dept_id: deptId,
              order_id: orderId, order_item_id: r.id,
              dispatch_date: dispatchDate, dispatch_qty: takeQty, use_unit: lot.use_unit || r.use_unit,
              lot_no: lot.lot_no, lot_id: lot.id, created_by: userId,
            }).select('id').single();
            if (de) throw new Error(de.message);

            // 4. stock_transactions (중앙창고 OUT + 부서 IN)
            var { error: te } = await supabaseClient.from('stock_transactions').insert([
              { item_id: r.item_id, dept_id: null,   tx_type:'OUT', tx_date: dispatchDate, qty: -takeQty, use_unit: lot.use_unit || r.use_unit, ref_type:'dispatch', ref_id: newDispatch.id, lot_id: lot.id, unit_price: lot.unit_price, created_by: userId },
              { item_id: r.item_id, dept_id: deptId, tx_type:'IN',  tx_date: dispatchDate, qty:  takeQty, use_unit: lot.use_unit || r.use_unit, ref_type:'dispatch', ref_id: newDispatch.id, lot_id: newDeptLot.id, unit_price: lot.unit_price, created_by: userId },
            ]);
            if (te) throw new Error(te.message);

            // 5. stock_current 갱신
            await upsertStockCurrent(r.item_id, -takeQty, null);
            await upsertStockCurrent(r.item_id,  takeQty, deptId);

            remaining -= takeQty;
          }

          var actuallyDispatchedUseUnit = needQty - remaining;
          if (actuallyDispatchedUseUnit > 0) {
            // dispatched_qty는 order_qty와 같은 단위(구매단위)이므로 다시 환산해서 누적
            if (!poiDispatchAccum[r.id]) poiDispatchAccum[r.id] = { base: r.dispatched_qty || 0, added: 0 };
            poiDispatchAccum[r.id].added += actuallyDispatchedUseUnit / puQty;
          }
          if (remaining > 0) {
            // 중앙창고 LOT 재고가 부족해서 일부만 불출됨 — 실패로 표시하지 않고 알 수 있게 표시만
            failed.push(orderId + ' (' + r.item_id + ' 일부만 처리)');
          }
        }

        for (var poiId in poiDispatchAccum) {
          var acc = poiDispatchAccum[poiId];
          await supabaseClient.from('purchase_order_items').update({ dispatched_qty: acc.base + acc.added }).eq('id', poiId);
        }

        var { data: allItems } = await supabaseClient.from('purchase_order_items').select('order_qty,dispatched_qty').eq('order_id', orderId);
        var allDone = (allItems || []).every(function(it) { return (it.dispatched_qty || 0) >= it.order_qty; });
        var anyDone = (allItems || []).some(function(it) { return (it.dispatched_qty || 0) > 0; });
        await supabaseClient.from('purchase_orders').update({ status: allDone ? 'COMPLETED' : (anyDone ? 'PARTIAL' : 'ORDERED') }).eq('id', orderId);
        okCount++;
      } catch(innerErr) {
        failed.push(orderId);
      }
    }

    _selectedDispatchPoIds.clear();
    _selectedDispatchPoId = null;
    if (_gridDispatchItem) _gridDispatchItem.setGridOption('rowData', []);
    var lbl = document.getElementById('dispatchSelectedPoLabel'); if (lbl) lbl.textContent = '';
    var sum = document.getElementById('dispatchSummary'); if (sum) sum.textContent = '← 왼쪽에서 발주서를 선택하세요';
    await loadDispatchPoList();
    if (failed.length) alert(okCount + '건 처리 완료, ' + failed.length + '건은 문제가 있었습니다. (요청부서 미연결/중앙창고 재고 부족/오류)');
    else alert(okCount + '건이 일괄 불출 처리됐습니다.');
  } catch(e) {
    alert('일괄불출 실패: ' + e.message);
  } finally {
    if (btn) btn.disabled = false;
    hideGlobalLoading();
  }
}
window.toggleDispatchPoSelection = toggleDispatchPoSelection;
window.bulkDispatchSelectedPo = bulkDispatchSelectedPo;

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
    var poiDispatchAccum = {}; // 같은 발주품목(_poiId)이 여러 LOT으로 나뉜 경우를 위한 누적 집계
    // LOT별로 처리 — 1행 = 1LOT
    for(var i=0;i<rows.length;i++){
      var r=rows[i];
      var qty=Number(r.dispatch_qty);

      // 1. 중앙창고 LOT 잔여수량 차감
      var {error:lotOutErr}=await supabaseClient.from('stock_lots')
        .update({qty: r.qty - qty})
        .eq('id',r._lotId);
      if(lotOutErr) throw new Error('LOT 차감 실패: '+lotOutErr.message);

      // 2. 부서 LOT 생성 (단가 승계)
      var {data:newDeptLot,error:lotInErr}=await supabaseClient.from('stock_lots').insert({
        item_id:      r.item_id,
        receipt_id:   null,
        lot_no:       r.lot_no,
        receipt_date: r.receipt_date,
        unit_price:   r.unit_price,
        purchase_unit: r.purchase_unit||'',
        use_unit:     r.use_unit||'',
        dept_id:      deptId,
        qty:          qty,
      }).select('id').single();
      if(lotInErr) throw new Error('부서 LOT 생성 실패: '+lotInErr.message);

      // 3. stock_dispatch 기록
      var dispatchNo=await genDocNo('SD');
      var {data:newDispatch,error:de}=await supabaseClient.from('stock_dispatch').insert({
        dispatch_no:  dispatchNo,
        item_id:      r.item_id,
        dept_id:      deptId,
        order_id:     _selectedDispatchPoId,
        order_item_id: r._poiId||null,
        dispatch_date: dispatchDate,
        dispatch_qty:  qty,
        use_unit:     r.use_unit,
        lot_no:       r.lot_no,
        lot_id:       r._lotId,
        created_by:   userId,
      }).select('id').single();
      if(de) throw new Error('불출 기록 실패: '+de.message);

      // 4. stock_transactions (중앙창고 OUT + 부서 IN), 단가 포함
      var {error:te}=await supabaseClient.from('stock_transactions').insert([
        {item_id:r.item_id,dept_id:null,  tx_type:'OUT',tx_date:dispatchDate,qty:-qty,use_unit:r.use_unit,ref_type:'dispatch',ref_id:newDispatch.id,lot_id:r._lotId,unit_price:r.unit_price,created_by:userId},
        {item_id:r.item_id,dept_id:deptId,tx_type:'IN', tx_date:dispatchDate,qty: qty,use_unit:r.use_unit,ref_type:'dispatch',ref_id:newDispatch.id,lot_id:newDeptLot.id,unit_price:r.unit_price,created_by:userId},
      ]);
      if(te) throw new Error('재고 이동 실패: '+te.message);

      // 5. stock_current 갱신
      await upsertStockCurrent(r.item_id,-qty,null);
      await upsertStockCurrent(r.item_id, qty,deptId);

      // 6. 발주서 품목 불출수량 — 같은 품목이 LOT 여러 개로 나뉘어 이번 루프에서 여러 번
      // 처리될 수 있으므로, 바로 DB에 반영하지 않고 일단 누적만 해둠 (루프 끝에서 한 번에 반영).
      // dispatched_qty는 order_qty와 같은 단위(구매단위)인데, qty는 LOT 차감 단위(사용단위)이므로
      // 구매단위 환산수로 나눠서 단위를 맞춤
      if(r._poiId){
        if(!poiDispatchAccum[r._poiId]) poiDispatchAccum[r._poiId] = { base: r.dispatched_qty||0, added: 0 };
        poiDispatchAccum[r._poiId].added += qty / (r.purchase_unit_qty || 1);
      }
    }
    // 누적된 발주품목별 불출수량을 이제 한 번에 정확히 반영 (LOT별로 쪼개져 있던 걸 합산)
    for(var poiId in poiDispatchAccum){
      var acc=poiDispatchAccum[poiId];
      await supabaseClient.from('purchase_order_items')
        .update({dispatched_qty: acc.base + acc.added}).eq('id', poiId);
    }
    var {data:allItems}=await supabaseClient.from('purchase_order_items').select('order_qty,dispatched_qty').eq('order_id',_selectedDispatchPoId);
    var allDone=(allItems||[]).every(function(i){return (i.dispatched_qty||0)>=i.order_qty;});
    var anyDone=(allItems||[]).some(function(i){return (i.dispatched_qty||0)>0;});
    await supabaseClient.from('purchase_orders').update({status:allDone?'COMPLETED':(anyDone?'PARTIAL':'ORDERED')}).eq('id',_selectedDispatchPoId);
    alert('불출 완료! ('+deptName+'에 '+rows.length+'개 LOT)');
    var doneOrderId=_selectedDispatchPoId;
    _selectedDispatchPoId=null;
    if(_gridDispatchItem) _gridDispatchItem.setGridOption('rowData',[]);
    var lbl=document.getElementById('dispatchSelectedPoLabel'); if(lbl) lbl.textContent='';
    var sum=document.getElementById('dispatchSummary'); if(sum) sum.textContent='← 왼쪽에서 발주서를 선택하세요';
    if(saveBtn) saveBtn.disabled=true;
    loadDispatchHistory(doneOrderId);
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

/* ════════════════════════════════
   부서별재고 탭
════════════════════════════════ */
function initDeptStockGrid() {
  var el = document.getElementById('deptStockGrid');
  if (el) el.style.height = Math.max(200, window.innerHeight - 200) + 'px';
  var colDefs = [
    { headerName: '부서', field: 'departments', width: 90,
      headerClass: 'ag-left-header',
      cellStyle: { display:'flex', alignItems:'center', justifyContent:'flex-start' },
      cellRenderer: function(p) { return ts(p.value?.dept_name || '-'); }
    },
    { headerName: '자재명', field: 'items', flex: 2,
      headerClass: 'ag-left-header',
      cellStyle: { display:'flex', alignItems:'center', justifyContent:'flex-start', fontWeight:600 },
      cellRenderer: function(p) { return ts(p.value?.item_name || '-'); }
    },
    { headerName: 'LOT번호', field: 'lot_no', width: 120,
      headerClass: 'ag-left-header',
      cellStyle: { display:'flex', alignItems:'center', justifyContent:'flex-start', color:'#1d4ed8', fontFamily:'Consolas,monospace', fontSize:'11px', paddingLeft:'8px' },
      cellRenderer: function(p) { return ts(p.value || '-'); }
    },
    { headerName: '입고일', field: 'receipt_date', width: 90,
      cellRenderer: function(p) { return p.value ? String(p.value).slice(0,10) : '-'; }
    },
    { headerName: '단가', field: 'unit_price', width: 75,
      cellStyle: { display:'flex', alignItems:'center', justifyContent:'flex-end' },
      cellRenderer: function(p) { return fmtN(p.value) + '원'; }
    },
    { headerName: '단위', field: 'use_unit', width: 60,
      cellRenderer: function(p) { return ts(p.value || '-'); }
    },
    { headerName: '잔여수량', field: 'qty', width: 85,
      cellStyle: { display:'flex', alignItems:'center', justifyContent:'flex-end' },
      cellRenderer: function(p) {
        var qty = p.value || 0;
        var cls = qty === 0 ? 'stock-qty-zero' : 'stock-qty-ok';
        return '<span class="' + cls + '">' + fmtN(qty) + '</span>';
      }
    },
  ];
  _gridDeptStock = createMgGrid('deptStockGrid', colDefs, [], {
    noRowsText: '부서별 재고 데이터가 없습니다.',
    onRowClick: selectTransferItem,
  });
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

    // stock_lots 기반 — LOT별 행 (dept_id IS NOT NULL, 잔여수량 > 0)
    var q = supabaseClient
      .from('stock_lots')
      .select('*, items(item_name, use_unit, reorder_point), departments(dept_name)', { count: 'exact' })
      .not('dept_id', 'is', null)
      .gt('qty', 0)
      .order('receipt_date', { ascending: true });

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
    if (_gridDeptStock) { _gridDeptStock.setGridOption('rowData', data || []); refitGridColumns(_gridDeptStock); }
    renderPagination('deptStockPagination', st, loadDeptStock);
    var dcnt = document.getElementById('deptStockCount'); if(dcnt) dcnt.textContent = (count||0) + '건 (LOT)';
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
