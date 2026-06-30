/**
 * use-stock.js — LOT 기반 사용처리
 *
 * 좌측: 부서 보유 LOT 목록 (자재구분/자재명 검색)
 *   → 행 = 1 LOT (lot_no / 입고일 / 단가 / 잔여수량)
 *   → 추가 버튼으로 우측 사용처리 품목에 추가 (같은 LOT 중복 추가 불가)
 *
 * 우측: 사용처리 품목
 *   → LOT별 행, 사용수량 편집
 *   → 확정 시 lot_id + unit_price 포함 저장, lot.qty 차감
 */
'use strict';

var currentUser = null;
var myDeptId    = null;
var myDeptName  = '';
var lotCache    = [];   // 내 부서 LOT 목록

var _gridStockSearch = null;
var _gridUseItem     = null;
var _gridUse         = null;

var usePage       = 1;
var usePageSize   = 15;
var useTotalPages = 1;

var _useRowIdCounter = 0;

/* ── 유틸 ─────────────────────────────────── */
function ts(v)  { return String(v == null ? '' : v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function val(id){ return (document.getElementById(id)?.value || '').trim(); }
function setVal(id, v) { var el = document.getElementById(id); if (el) el.value = v ?? ''; }
function fmtDate(v) { return v ? String(v).slice(0, 10) : '-'; }
function fmtN(v)    { return Number(v || 0).toLocaleString('ko-KR'); }

/* ── 메인 탭 ─────────────────────────────── */
function initMainTabs() {
  document.querySelectorAll('.us-main-tabs .tab-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var target = btn.dataset.maintab;
      document.querySelectorAll('.us-main-tabs .tab-btn').forEach(function(b) { b.classList.remove('active'); });
      document.querySelectorAll('.us-main-panel').forEach(function(p) { p.classList.remove('active'); });
      btn.classList.add('active');
      document.getElementById('panel-' + target)?.classList.add('active');
      // 액션바 — 작성 탭에서만 표시
      var ab = document.getElementById('us-actionbar');
      if (ab) ab.style.display = target === 'entry' ? 'flex' : 'none';
      setTimeout(function() {
        if (target === 'history') { if (!_gridUse) initUseGrid(); loadUseLog(1); }
      }, 50);
    });
  });
}

/* ══════════════════════════════════════════
   좌측: 부서 LOT 목록 그리드
══════════════════════════════════════════ */
function initStockSearchGrid() {
  var el = document.getElementById('stockSearchGrid');
  if (!el || typeof agGrid === 'undefined') return;

  _gridStockSearch = agGrid.createGrid(el, {
    suppressCellFocus: true,
    suppressPropertyNamesCheck: true,
    columnDefs: [
      { headerName: '구분', width: 70,
        cellStyle: { justifyContent:'center', fontSize:'10px', color:'#6b7280' },
        valueGetter: function(p) { return p.data.items?.category || '-'; }
      },
      { headerName: '자재명', flex: 2, minWidth: 100,
        headerClass: 'ag-left-header',
        cellStyle: { justifyContent:'flex-start', fontWeight:600 },
        valueGetter: function(p) { return p.data.items?.item_name || '-'; }
      },
      { headerName: 'LOT번호', field: 'lot_no', width: 110,
        headerClass: 'ag-left-header',
        cellStyle: { justifyContent:'flex-start', color:'#1d4ed8', fontFamily:'Consolas,monospace', fontSize:'11px' },
      },
      { headerName: '입고일', field: 'receipt_date', width: 90,
        cellRenderer: function(p) { return fmtDate(p.value); }
      },
      { headerName: '단가', field: 'unit_price', width: 80,
        cellStyle: { justifyContent:'flex-end' },
        cellRenderer: function(p) { return fmtN(p.value) + '원'; }
      },
      { headerName: '잔여', field: 'qty', width: 70,
        cellStyle: function(p) {
          return { justifyContent:'flex-end', color: p.value <= 0 ? '#dc2626' : '#059669', fontWeight: 700 };
        },
        valueFormatter: function(p) { return fmtN(p.value); }
      },
      { headerName: '단위', width: 50,
        cellStyle: { justifyContent:'center', color:'#6b7280' },
        valueGetter: function(p) { return p.data.use_unit || '-'; }
      },
      { headerName: '', width: 56, sortable: false,
        cellStyle: { justifyContent:'center', padding:'0 4px' },
        cellRenderer: function(p) {
          var btn = document.createElement('button');
          btn.className = 'btn btn-sm btn-primary';
          btn.style.cssText = 'padding:2px 8px;font-size:11px;';
          var added   = isLotAdded(p.data.id);
          var noStock = !(p.data.qty > 0);
          btn.textContent = added ? '추가됨' : (noStock ? '재고없음' : '추가');
          btn.disabled = added || noStock;
          if (added) { btn.style.background = '#059669'; btn.style.borderColor = '#059669'; }
          btn.onclick = function() {
            addUseItem(p.data);
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

function searchStockItems() {
  var kw  = (document.getElementById('stock_keyword')?.value || '').toLowerCase();
  var cat = document.getElementById('stock_category')?.value || '';
  var filtered = lotCache.filter(function(r) {
    var matchCat = !cat || (r.items?.category || '') === cat;
    var matchKw  = !kw  || (r.items?.item_name || '').toLowerCase().includes(kw);
    return matchCat && matchKw;
  });
  if (_gridStockSearch) { _gridStockSearch.setGridOption('rowData', filtered); refitGridColumns(_gridStockSearch); }
}

async function loadMyStock() {
  if (!myDeptId) { lotCache = []; if (_gridStockSearch) _gridStockSearch.setGridOption('rowData', []); return; }

  // 부서 LOT 목록 (잔여수량 > 0)
  var { data, error } = await supabaseClient
    .from('stock_lots')
    .select('id, item_id, lot_no, receipt_date, unit_price, purchase_unit, use_unit, qty, items(item_name, category)')
    .eq('dept_id', myDeptId)
    .gt('qty', 0)
    .order('receipt_date', { ascending: true });
  if (error) { console.error(error); return; }
  lotCache = data || [];

  // 카테고리 옵션
  var catSel = document.getElementById('stock_category');
  if (catSel) {
    var cur  = catSel.value;
    var cats = [...new Set(lotCache.map(function(r) { return r.items?.category || ''; }))].filter(Boolean).sort();
    catSel.innerHTML = '<option value="">전체 카테고리</option>' +
      cats.map(function(c) { return '<option value="' + ts(c) + '">' + ts(c) + '</option>'; }).join('');
    if (cur) catSel.value = cur;
  }

  searchStockItems();
}

/* ══════════════════════════════════════════
   우측: 사용처리 품목 (LOT별 행)
══════════════════════════════════════════ */
function initUseItemGrid() {
  var el = document.getElementById('useItemGrid');
  if (!el || typeof agGrid === 'undefined') return;

  _gridUseItem = agGrid.createGrid(el, {
    suppressCellFocus: true,
    suppressPropertyNamesCheck: true,
    columnDefs: [
      { headerName: '자재명', field: 'item_name', flex: 2,
        headerClass: 'ag-left-header',
        cellStyle: { display:'flex', alignItems:'center', justifyContent:'flex-start', fontWeight:600 },
        cellRenderer: function(p) { return ts(p.value || '-'); }
      },
      { headerName: 'LOT번호', field: 'lot_no', width: 110,
        headerClass: 'ag-left-header',
        cellStyle: { display:'flex', alignItems:'center', justifyContent:'flex-start', color:'#1d4ed8', fontFamily:'Consolas,monospace', fontSize:'11px' },
        cellRenderer: function(p) { return ts(p.value || '-'); }
      },
      { headerName: '입고일', field: 'receipt_date', width: 90,
        cellRenderer: function(p) { return fmtDate(p.value); }
      },
      { headerName: '단가', field: 'unit_price', width: 80,
        cellStyle: { display:'flex', alignItems:'center', justifyContent:'flex-end', color:'#374151' },
        cellRenderer: function(p) { return fmtN(p.value) + '원'; }
      },
      { headerName: '잔여', field: 'current_qty', width: 70,
        cellStyle: { display:'flex', alignItems:'center', justifyContent:'flex-end', background:'#f8fafc', color:'#6b7280' },
        cellRenderer: function(p) { return fmtN(p.value); }
      },
      { headerName: '사용수량', field: 'qty', width: 90,
        headerClass: 'ag-right-header',
        cellStyle: { display:'flex', alignItems:'center', justifyContent:'flex-end' },
        editable: true,
        cellEditor: 'agNumberCellEditor',
        cellEditorParams: { min: 1 },
        cellRenderer: function(p) {
          var over = Number(p.value || 0) > Number(p.data.current_qty || 0);
          return '<span style="' + (over ? 'color:#dc2626;font-weight:700;' : 'font-weight:700;') + '">' +
            fmtN(p.value || 1) + '</span>' + (over ? ' ⚠' : '');
        },
        onCellValueChanged: function(p) {
          if (Number(p.data.qty) > Number(p.data.current_qty)) {
            alert('사용수량(' + fmtN(p.data.qty) + ')이 LOT 잔여수량(' + fmtN(p.data.current_qty) + ')을 초과합니다.');
          }
        }
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
          btn.onclick = function() { removeUseItem(p.node.data._rowId); };
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
    overlayNoRowsTemplate: '<span style="color:#9ca3af;font-size:12px;">왼쪽에서 LOT를 추가하세요.</span>',
    onGridReady: function(params) { if (el.offsetWidth > 0) params.api.sizeColumnsToFit(); },
  });
}

function isLotAdded(lotId) {
  if (!_gridUseItem) return false;
  var found = false;
  _gridUseItem.forEachNode(function(n) { if (n.data._lotId === lotId) found = true; });
  return found;
}

function addUseItem(lotRow) {
  if (!_gridUseItem) initUseItemGrid();
  if (isLotAdded(lotRow.id)) return;
  _useRowIdCounter++;
  var row = {
    _rowId:       _useRowIdCounter,
    _lotId:       lotRow.id,
    item_id:      lotRow.item_id,
    item_name:    lotRow.items?.item_name || '-',
    lot_no:       lotRow.lot_no || '',
    receipt_date: lotRow.receipt_date || '',
    unit_price:   lotRow.unit_price || 0,
    use_unit:     lotRow.use_unit || '',
    current_qty:  lotRow.qty,
    qty:          1,
    memo:         '',
  };
  _gridUseItem.applyTransaction({ add: [row] });
  updateUseItemCount();
  refitGridColumns(_gridUseItem);
}

function removeUseItem(rowId) {
  if (!_gridUseItem) return;
  var toRemove = null;
  _gridUseItem.forEachNode(function(node) { if (node.data._rowId === rowId) toRemove = node.data; });
  if (toRemove) {
    _gridUseItem.applyTransaction({ remove: [toRemove] });
    updateUseItemCount();
    if (_gridStockSearch) _gridStockSearch.refreshCells({ force: true });
  }
}

function clearUseItemGrid() {
  if (!_gridUseItem) return;
  var all = [];
  _gridUseItem.forEachNode(function(n) { all.push(n.data); });
  if (all.length) _gridUseItem.applyTransaction({ remove: all });
  updateUseItemCount();
  if (_gridStockSearch) _gridStockSearch.refreshCells({ force: true });
}

function updateUseItemCount() {
  var cnt = 0;
  if (_gridUseItem) _gridUseItem.forEachNode(function() { cnt++; });
  var el = document.getElementById('useItemCount');
  if (el) el.textContent = cnt ? cnt + '건' : '';
}

/* ══════════════════════════════════════════
   사용처리 확정 — LOT별 처리
══════════════════════════════════════════ */
async function submitUseItems() {
  if (!myDeptId) { alert('소속 부서 정보가 없습니다.'); return; }
  if (!_gridUseItem) { alert('처리할 품목이 없습니다.'); return; }

  var rows = [];
  _gridUseItem.forEachNode(function(node) { rows.push(node.data); });
  if (!rows.length) { alert('처리할 LOT를 먼저 추가해주세요.'); return; }

  var txDate = val('useTxDate') || new Date().toISOString().slice(0, 10);

  var invalid = rows.find(function(r) { return !r.qty || r.qty < 1; });
  if (invalid) { alert(invalid.item_name + ' [' + invalid.lot_no + '] 의 사용수량은 1 이상이어야 합니다.'); return; }

  var over = rows.find(function(r) { return Number(r.qty) > Number(r.current_qty); });
  if (over) { alert(over.item_name + ' [' + over.lot_no + '] 사용수량(' + fmtN(over.qty) + ')이 LOT 잔여수량(' + fmtN(over.current_qty) + ')을 초과합니다.'); return; }

  if (!confirm(rows.length + '건(LOT)을 사용처리 하시겠습니까?')) return;

  var btn = document.getElementById('useSubmitBtn');
  if (btn) btn.disabled = true;
  showGlobalLoading('사용처리 중...');
  try {
    var { data: session } = await supabaseClient.auth.getSession();
    var userId = session?.session?.user?.id || null;

    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];

      // 1. stock_transactions (OUT) — lot_id + unit_price 포함
      var { error: txErr } = await supabaseClient.from('stock_transactions').insert({
        item_id:    r.item_id,
        dept_id:    myDeptId,
        tx_type:    'OUT',
        tx_date:    txDate,
        qty:        -r.qty,
        use_unit:   r.use_unit,
        ref_type:   'use',
        lot_id:     r._lotId,
        unit_price: r.unit_price,
        memo:       r.memo || '',
        created_by: userId,
      });
      if (txErr) throw new Error('[' + r.item_name + '] ' + txErr.message);

      // 2. stock_lots 잔여수량 차감
      var { error: lotErr } = await supabaseClient.from('stock_lots')
        .update({ qty: r.current_qty - r.qty })
        .eq('id', r._lotId);
      if (lotErr) throw new Error('[' + r.item_name + '] LOT 차감 실패: ' + lotErr.message);

      // 3. stock_current 부서 재고 차감
      var { data: stockRow } = await supabaseClient
        .from('stock_current').select('id, qty')
        .eq('item_id', r.item_id).eq('dept_id', myDeptId).maybeSingle();
      if (stockRow) {
        await supabaseClient.from('stock_current')
          .update({ qty: stockRow.qty - r.qty, last_updated_at: new Date().toISOString() })
          .eq('id', stockRow.id);
      }
    }

    clearUseItemGrid();
    await loadMyStock();
    alert('사용처리가 완료됐습니다.');
  } catch(e) {
    alert('사용처리 실패: ' + e.message + '\n(처리되지 않은 품목은 다시 시도해주세요)');
    await loadMyStock();
  } finally {
    if (btn) btn.disabled = false;
    hideGlobalLoading();
  }
}

/* ══════════════════════════════════════════
   사용처리 이력 그리드 (LOT번호/단가/금액 포함)
══════════════════════════════════════════ */
function initUseGrid() {
  var colDefs = [
    { headerName: '사용일', field: 'tx_date', width: 100,
      cellRenderer: function(p) { return fmtDate(p.value); }
    },
    { headerName: '자재명', flex: 2, minWidth: 120,
      headerClass: 'ag-left-header',
      cellStyle: { display:'flex', alignItems:'center', justifyContent:'flex-start' },
      valueGetter: function(p) { return p.data.items?.item_name || '-'; }
    },
    { headerName: 'LOT번호', field: 'lot_no', width: 110,
      headerClass: 'ag-left-header',
      cellStyle: { display:'flex', alignItems:'center', justifyContent:'flex-start', color:'#1d4ed8', fontFamily:'Consolas,monospace', fontSize:'11px' },
      valueGetter: function(p) { return p.data.stock_lots?.lot_no || '-'; }
    },
    { headerName: '사용수량', field: 'qty', width: 90,
      cellStyle: { display:'flex', alignItems:'center', justifyContent:'flex-end' },
      cellRenderer: function(p) {
        return '<span style="color:#dc2626;font-weight:700;">' + fmtN(Math.abs(p.value || 0)) + '</span> ' + ts(p.data.use_unit || '');
      }
    },
    { headerName: '단가', field: 'unit_price', width: 80,
      cellStyle: { display:'flex', alignItems:'center', justifyContent:'flex-end' },
      cellRenderer: function(p) { return fmtN(p.value) + '원'; }
    },
    { headerName: '공급가', width: 90,
      cellStyle: { display:'flex', alignItems:'center', justifyContent:'flex-end', fontWeight:700 },
      cellRenderer: function(p) { return fmtN(Math.abs(p.data.qty || 0) * (p.data.unit_price || 0)) + '원'; }
    },
    { headerName: '부가세', width: 80,
      cellStyle: { display:'flex', alignItems:'center', justifyContent:'flex-end', color:'#6b7280' },
      cellRenderer: function(p) { return fmtN(Math.round(Math.abs(p.data.qty || 0) * (p.data.unit_price || 0) * 0.1)) + '원'; }
    },
    { headerName: '합계', width: 90,
      cellStyle: { display:'flex', alignItems:'center', justifyContent:'flex-end', fontWeight:700, color:'#111827' },
      cellRenderer: function(p) {
        var supply = Math.abs(p.data.qty || 0) * (p.data.unit_price || 0);
        return fmtN(Math.round(supply * 1.1)) + '원';
      }
    },
    { headerName: '메모', field: 'memo', flex: 1,
      headerClass: 'ag-left-header',
      cellStyle: { display:'flex', alignItems:'center', justifyContent:'flex-start' },
      cellRenderer: function(p) { return ts(p.value || '-'); }
    },
  ];
  _gridUse = createMgGrid('useGrid', colDefs, [], { noRowsText: '사용처리 이력이 없습니다.' });
}

async function loadUseLog(page) {
  if (!myDeptId) { if (!_gridUse) initUseGrid(); if (_gridUse) _gridUse.setGridOption('rowData', []); return; }
  page = page || usePage;
  showGlobalLoading('사용처리 이력을 불러오는 중...');
  try {
    var from = (page - 1) * usePageSize;
    var to   = from + usePageSize - 1;
    var dateFrom = val('dateFrom');
    var dateTo   = val('dateTo');

    var q = supabaseClient
      .from('stock_transactions')
      .select('*, items(item_name), stock_lots(lot_no)', { count: 'exact' })
      .eq('tx_type', 'OUT')
      .eq('ref_type', 'use')
      .eq('dept_id', myDeptId)
      .order('tx_date', { ascending: false })
      .order('created_at', { ascending: false })
      .range(from, to);

    if (dateFrom) q = q.gte('tx_date', dateFrom);
    if (dateTo)   q = q.lte('tx_date', dateTo);

    var { data, error, count } = await q;
    if (error) throw new Error(error.message);

    usePage       = page;
    useTotalPages = Math.max(1, Math.ceil((count || 0) / usePageSize));

    if (!_gridUse) initUseGrid();
    if (_gridUse) { _gridUse.setGridOption('rowData', data || []); refitGridColumns(_gridUse); }
    renderPagination('usePagination', { page: usePage, totalPages: useTotalPages }, loadUseLog);
  } catch(e) {
    alert('이력 로드 실패: ' + e.message);
  } finally {
    hideGlobalLoading();
  }
}

/* ── 페이지네이션 ─────────────────────────── */
function renderPagination(containerId, state, loadFn) {
  var el = document.getElementById(containerId);
  if (!el) return;
  var total = state.totalPages, cur = state.page;
  if (total <= 1) { el.innerHTML = ''; el.style.display = 'none'; return; }
  el.style.display = '';
  var BLOCK = 10;
  var bs = Math.floor((cur - 1) / BLOCK) * BLOCK + 1;
  var be = Math.min(total, bs + BLOCK - 1);
  var html = '';
  if (bs > 1) html += '<button class="pagination-btn" onclick="' + loadFn.name + '(' + (bs-1) + ')">이전</button> ';
  for (var i = bs; i <= be; i++) {
    html += '<button class="pagination-btn' + (i === cur ? ' is-active' : '') + '" onclick="' + loadFn.name + '(' + i + ')">' + i + '</button> ';
  }
  if (be < total) html += '<button class="pagination-btn" onclick="' + loadFn.name + '(' + (be+1) + ')">다음</button>';
  el.innerHTML = html;
}

/* ── 초기화 ──────────────────────────────── */
document.addEventListener('DOMContentLoaded', async function() {
  var session = await auth.requireAuth();
  if (!session) return;

  currentUser = await auth.getSession();
  myDeptId    = null;
  myDeptName  = '';

  if (currentUser?.team_code) {
    var myClinicId = null;
    if (currentUser.clinic_code) {
      var { data: clinic } = await supabaseClient
        .from('clinics').select('id').eq('clinic_code', currentUser.clinic_code).maybeSingle();
      myClinicId = clinic?.id || null;
    }
    var deptQuery = supabaseClient.from('departments').select('id, dept_name').eq('dept_code', currentUser.team_code);
    if (myClinicId) deptQuery = deptQuery.eq('clinic_id', myClinicId);
    var { data: dept } = await deptQuery.maybeSingle();
    if (dept) { myDeptId = dept.id; myDeptName = dept.dept_name; }
  }

  var badge  = document.getElementById('deptBadge');
  var badgeH = document.getElementById('deptBadgeHistory');
  function setBadge(el, textEl, name, isError) {
    if (!el) return;
    el.style.display = '';
    if (isError) { el.style.background='#fef2f2'; el.style.color='#b91c1c'; el.style.borderColor='#fecaca'; }
    if (textEl) textEl.textContent = name;
  }
  if (myDeptName) {
    setBadge(badge,  document.getElementById('deptBadgeText'),        myDeptName, false);
    setBadge(badgeH, document.getElementById('deptBadgeTextHistory'), myDeptName, false);
  } else {
    setBadge(badge,  document.getElementById('deptBadgeText'),        '소속 부서 정보 없음', true);
    setBadge(badgeH, document.getElementById('deptBadgeTextHistory'), '소속 부서 정보 없음', true);
    var submitBtn = document.getElementById('useSubmitBtn');
    if (submitBtn) submitBtn.disabled = true;
  }

  var today = new Date();
  var weekAgo = new Date(today);
  weekAgo.setDate(today.getDate() - 7);
  setVal('dateFrom',  weekAgo.toISOString().slice(0, 10));
  setVal('dateTo',    today.toISOString().slice(0, 10));
  setVal('useTxDate', today.toISOString().slice(0, 10));

  initMainTabs();
  initStockSearchGrid();
  initUseItemGrid();
  document.getElementById('stock_keyword')?.addEventListener('keydown', function(e) { if (e.key === 'Enter') searchStockItems(); });

  showGlobalLoading('데이터를 불러오는 중...');
  try {
    await loadMyStock();
  } catch(e) {
    console.error(e);
  } finally {
    hideGlobalLoading();
  }
});
