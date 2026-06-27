/**
 * use-stock.js
 * 부서 직원용 사용처리 — 본인 부서 재고만 조회/처리
 *
 * 화면 구조 (2단 + 탭):
 *   [사용처리 작성] 탭 — 좌: 보유재고 검색(카테고리/자재명) → 추가
 *                       우: 사용처리 품목(추가된 것들의 사용수량 편집) → 확정
 *   [사용처리 이력] 탭 — 기존 처리 이력 조회
 */
'use strict';

var currentUser = null;
var myDeptId    = null;
var myDeptName  = '';
var stockCache  = [];   // 내 부서 현재고 [{item_id, qty, items:{...}}]

var _gridStockSearch = null;  // 좌측 보유재고 검색 그리드
var _gridUseItem     = null;  // 우측 사용처리 품목(편집) 그리드
var _gridUse          = null; // 이력 그리드

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

/* ── 메인 탭 (사용처리 작성 / 이력) ─────────── */
function initMainTabs() {
  document.querySelectorAll('.us-main-tabs .tab-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var target = btn.dataset.maintab;
      document.querySelectorAll('.us-main-tabs .tab-btn').forEach(function(b) { b.classList.remove('active'); });
      document.querySelectorAll('.us-main-panel').forEach(function(p) { p.classList.remove('active'); });
      btn.classList.add('active');
      document.getElementById('panel-' + target)?.classList.add('active');

      setTimeout(function() {
        if (target === 'history') {
          if (!_gridUse) initUseGrid();
          loadUseLog(1);
        }
      }, 50);
    });
  });
}

/* ══════════════════════════════════════════
   좌측: 보유재고 검색 그리드
══════════════════════════════════════════ */
function initStockSearchGrid() {
  var el = document.getElementById('stockSearchGrid');
  if (!el || typeof agGrid === 'undefined') return;

  _gridStockSearch = agGrid.createGrid(el, {
    columnDefs: [
      { headerName: '카테고리', flex: 1, minWidth: 80,
        cellStyle: { justifyContent:'center', fontSize:'10px', color:'#6b7280' },
        valueGetter: function(p) { return p.data.items?.category || '-'; }
      },
      { headerName: '자재명', flex: 2, minWidth: 120,
        headerClass: 'ag-left-header',
        cellStyle: { justifyContent:'flex-start', fontWeight:600 },
        valueGetter: function(p) { return p.data.items?.item_name || '-'; }
      },
      { headerName: '현재고', field: 'qty', width: 80,
        cellStyle: function(p) { return { justifyContent:'flex-end', color: p.value <= 0 ? '#dc2626' : '#111827', fontWeight:700 }; },
        valueFormatter: function(p) { return fmtN(p.value); }
      },
      { headerName: '단위', width: 60,
        cellStyle: { justifyContent:'center', color:'#6b7280' },
        valueGetter: function(p) { return p.data.items?.use_unit || p.data.items?.unit || '-'; }
      },
      { headerName: '', width: 56, sortable: false,
        cellStyle: { justifyContent:'center', padding:'0 4px' },
        cellRenderer: function(p) {
          var btn = document.createElement('button');
          btn.className = 'btn btn-sm btn-primary';
          btn.style.cssText = 'padding:2px 8px;font-size:11px;';
          var added = isUseItemAdded(p.data.item_id);
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
  var filtered = stockCache.filter(function(r) {
    var item = r.items || {};
    var matchCat = !cat || item.category === cat;
    var matchKw  = !kw  || (item.item_name || '').toLowerCase().includes(kw);
    return matchCat && matchKw;
  });
  if (_gridStockSearch) _gridStockSearch.setGridOption('rowData', filtered);
}

async function loadMyStock() {
  if (!myDeptId) { stockCache = []; if (_gridStockSearch) _gridStockSearch.setGridOption('rowData', []); return; }
  var { data, error } = await supabaseClient
    .from('stock_current')
    .select('item_id, qty, items(item_name, category, use_unit, unit, reorder_point)')
    .eq('dept_id', myDeptId)
    .order('qty', { ascending: false });
  if (error) { console.error(error); return; }
  stockCache = data || [];

  // 카테고리 옵션 채우기
  var catSel = document.getElementById('stock_category');
  if (catSel) {
    var cur = catSel.value;
    var cats = [...new Set(stockCache.map(function(r) { return r.items?.category || ''; }))].filter(Boolean).sort();
    catSel.innerHTML = '<option value="">전체 카테고리</option>' +
      cats.map(function(c) { return '<option value="' + ts(c) + '">' + ts(c) + '</option>'; }).join('');
    if (cur) catSel.value = cur;
  }

  searchStockItems();
}

/* ══════════════════════════════════════════
   우측: 사용처리 품목 (편집 가능)
══════════════════════════════════════════ */
function initUseItemGrid() {
  var el = document.getElementById('useItemGrid');
  if (!el || typeof agGrid === 'undefined') return;

  _gridUseItem = agGrid.createGrid(el, {
    columnDefs: [
      { headerName: '자재명', field: 'item_name', flex: 2,
        headerClass: 'ag-left-header',
        cellStyle: { display:'flex', alignItems:'center', justifyContent:'flex-start', fontWeight:600 },
        cellRenderer: function(p) { return ts(p.value || '-'); }
      },
      { headerName: '현재고', field: 'current_qty', width: 90,
        cellStyle: { display:'flex', alignItems:'center', justifyContent:'flex-end', background:'#f8fafc', color:'#6b7280' },
        cellRenderer: function(p) { return fmtN(p.value) + ' ' + ts(p.data.use_unit || ''); }
      },
      { headerName: '사용수량', field: 'qty', width: 100,
        headerClass: 'ag-right-header',
        cellStyle: { display:'flex', alignItems:'center', justifyContent:'flex-end' },
        editable: true,
        cellEditor: 'agNumberCellEditor',
        cellEditorParams: { min: 1 },
        cellRenderer: function(p) {
          var over = Number(p.value || 0) > Number(p.data.current_qty || 0);
          return '<span style="' + (over ? 'color:#dc2626;font-weight:700;' : 'font-weight:700;') + '">' +
            Number(p.value || 1).toLocaleString('ko-KR') + '</span>' + (over ? ' ⚠' : '');
        },
        onCellValueChanged: function(p) {
          if (Number(p.data.qty) > Number(p.data.current_qty)) {
            alert('사용수량(' + fmtN(p.data.qty) + ')이 현재고(' + fmtN(p.data.current_qty) + ')를 초과합니다.');
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
    overlayNoRowsTemplate: '<span style="color:#9ca3af;font-size:12px;">왼쪽에서 자재를 추가하세요.</span>',
    onGridReady: function(params) { if (el.offsetWidth > 0) params.api.sizeColumnsToFit(); },
  });
}

function isUseItemAdded(itemId) {
  if (!_gridUseItem) return false;
  var found = false;
  _gridUseItem.forEachNode(function(n) { if (n.data.item_id === itemId) found = true; });
  return found;
}

function addUseItem(stockRow) {
  if (!_gridUseItem) initUseItemGrid();
  if (isUseItemAdded(stockRow.item_id)) return;
  _useRowIdCounter++;
  var item = stockRow.items || {};
  var row = {
    _rowId:      _useRowIdCounter,
    item_id:     stockRow.item_id,
    item_name:   item.item_name || '-',
    use_unit:    item.use_unit || item.unit || '',
    current_qty: stockRow.qty,
    qty:         1,
    memo:        '',
  };
  if (_gridUseItem) {
    _gridUseItem.applyTransaction({ add: [row] });
    updateUseItemCount();
  }
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

/** 사용처리 품목 그리드에 쌓인 항목들을 한 번에 확정 처리 */
async function submitUseItems() {
  if (!myDeptId) { alert('소속 부서 정보가 없습니다.'); return; }
  if (!_gridUseItem) { alert('처리할 품목이 없습니다.'); return; }

  var rows = [];
  _gridUseItem.forEachNode(function(node) { rows.push(node.data); });
  if (!rows.length) { alert('처리할 품목을 먼저 추가해주세요.'); return; }

  var txDate = val('useTxDate') || new Date().toISOString().slice(0, 10);

  var invalid = rows.find(function(r) { return !r.qty || r.qty < 1; });
  if (invalid) { alert(invalid.item_name + '의 사용수량은 1 이상이어야 합니다.'); return; }
  var over = rows.find(function(r) { return Number(r.qty) > Number(r.current_qty); });
  if (over) { alert(over.item_name + '의 사용수량(' + fmtN(over.qty) + ')이 현재고(' + fmtN(over.current_qty) + ')를 초과합니다.'); return; }

  if (!confirm(rows.length + '건을 사용처리 하시겠습니까?')) return;

  var btn = document.getElementById('useSubmitBtn');
  if (btn) btn.disabled = true;
  showGlobalLoading('사용처리 중...');
  try {
    var { data: session } = await supabaseClient.auth.getSession();
    var userId = session?.session?.user?.id || null;

    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];

      var { error } = await supabaseClient.from('stock_transactions').insert({
        item_id:    r.item_id,
        dept_id:    myDeptId,
        tx_type:    'OUT',
        tx_date:    txDate,
        qty:        -r.qty,
        use_unit:   r.use_unit,
        ref_type:   'use',
        memo:       r.memo || '',
        created_by: userId,
      });
      if (error) throw new Error('[' + r.item_name + '] ' + error.message);

      // 부서 현재고 차감 (item_id, dept_id 스코프)
      var { data: stockRow } = await supabaseClient
        .from('stock_current').select('id, qty')
        .eq('item_id', r.item_id).eq('dept_id', myDeptId).maybeSingle();
      if (!stockRow) throw new Error('[' + r.item_name + '] 부서 재고 정보를 찾을 수 없습니다.');
      var { error: updErr } = await supabaseClient
        .from('stock_current')
        .update({ qty: stockRow.qty - r.qty, last_updated_at: new Date().toISOString() })
        .eq('id', stockRow.id);
      if (updErr) throw new Error('[' + r.item_name + '] ' + updErr.message);
    }

    clearUseItemGrid();
    await loadMyStock();
    await loadUseLog(1);
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
   사용처리 이력 그리드
══════════════════════════════════════════ */
function initUseGrid() {
  var colDefs = [
    { headerName: '사용일', field: 'tx_date', width: 100,
      cellRenderer: function(p) { return fmtDate(p.value); }
    },
    { headerName: '자재명', field: 'items', flex: 2, minWidth: 140,
      headerClass: 'ag-left-header',
      cellStyle: { display:'flex', alignItems:'center', justifyContent:'flex-start' },
      cellRenderer: function(p) { return ts(p.value?.item_name || '-'); }
    },
    { headerName: '사용수량', field: 'qty', width: 100,
      cellStyle: { display:'flex', alignItems:'center', justifyContent:'flex-end' },
      cellRenderer: function(p) {
        var v = Math.abs(p.value || 0);
        return '<span style="color:#dc2626;font-weight:700;">-' + fmtN(v) + '</span> ' + ts(p.data.use_unit || '');
      }
    },
    { headerName: '메모', field: 'memo', flex: 1, minWidth: 100,
      headerClass: 'ag-left-header',
      cellStyle: { display:'flex', alignItems:'center', justifyContent:'flex-start' },
      cellRenderer: function(p) { return ts(p.value || '-'); }
    },
    { headerName: '처리일시', field: 'created_at', width: 130,
      cellRenderer: function(p) {
        return p.value ? new Date(p.value).toLocaleString('ko-KR', {hour12:false}).slice(0,16) : '-';
      }
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
      .select('*, items(item_name)', { count: 'exact' })
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
    if (_gridUse) _gridUse.setGridOption('rowData', data || []);
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
  var total = state.totalPages;
  var cur   = state.page;
  if (total <= 1) { el.innerHTML = ''; el.style.display = 'none'; return; }
  el.style.display = '';

  var BLOCK = 10;
  var bs = Math.floor((cur - 1) / BLOCK) * BLOCK + 1;
  var be = Math.min(total, bs + BLOCK - 1);
  var html = '';
  if (bs > 1)    html += '<button class="pagination-btn" onclick="' + loadFn.name + '(' + (bs-1) + ')">이전</button> ';
  for (var i = bs; i <= be; i++) {
    html += '<button class="pagination-btn' + (i === cur ? ' is-active' : '') + '" onclick="' + loadFn.name + '(' + i + ')">' + i + '</button> ';
  }
  if (be < total) html += '<button class="pagination-btn" onclick="' + loadFn.name + '(' + (be+1) + ')">다음</button>';
  el.innerHTML = html;
}

/* ── 초기화 ────────────────────────────────── */
document.addEventListener('DOMContentLoaded', async function() {
  var session = await auth.requireAuth();
  if (!session) return;

  currentUser = await auth.getSession();

  // 본인 부서 정보 확인 — team_code(user_profiles) ↔ dept_code(departments) 매칭 (org.js와 동일한 컨벤션)
  myDeptId   = null;
  myDeptName = '';

  if (currentUser?.team_code) {
    // dept_code는 의원(clinic)별로 재사용될 수 있으므로 clinic_id로 범위를 좁혀야 함
    // (없으면 동명 부서코드가 여러 의원에 존재할 때 PostgREST가 다중 행 오류를 내고
    //  data가 null이 되어 "소속 부서 정보가 없습니다"로 잘못 표시됨)
    var myClinicId = null;
    if (currentUser.clinic_code) {
      var { data: clinic } = await supabaseClient
        .from('clinics').select('id').eq('clinic_code', currentUser.clinic_code).maybeSingle();
      myClinicId = clinic?.id || null;
    }

    var deptQuery = supabaseClient
      .from('departments')
      .select('id, dept_name')
      .eq('dept_code', currentUser.team_code);
    if (myClinicId) deptQuery = deptQuery.eq('clinic_id', myClinicId);
    var { data: dept } = await deptQuery.maybeSingle();
    if (dept) {
      myDeptId   = dept.id;
      myDeptName = dept.dept_name;
    }
  }

  // 부서 배지 표시
  if (myDeptName) {
    var badge = document.getElementById('deptBadge');
    if (badge) {
      badge.style.display = '';
      document.getElementById('deptBadgeText').textContent = myDeptName;
    }
  } else {
    // 소속 부서 정보가 없으면 안내 배지로 표시하고 사용처리 확정 버튼은 비활성화
    var badge2 = document.getElementById('deptBadge');
    if (badge2) {
      badge2.style.display = '';
      badge2.style.background = '#fef2f2';
      badge2.style.color = '#b91c1c';
      badge2.style.borderColor = '#fecaca';
      document.getElementById('deptBadgeText').textContent = '소속 부서 정보 없음';
    }
    var submitBtn = document.getElementById('useSubmitBtn');
    if (submitBtn) submitBtn.disabled = true;
  }

  // 기본 날짜 — 시작일: 일주일 전, 종료일: 오늘 (다른 화면과 동일) / 사용일은 오늘
  var today = new Date();
  var weekAgo = new Date(today);
  weekAgo.setDate(today.getDate() - 7);
  setVal('dateFrom', weekAgo.toISOString().slice(0, 10));
  setVal('dateTo',   today.toISOString().slice(0, 10));
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
