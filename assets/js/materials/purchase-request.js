/**
 * assets/js/master/purchase-request.js
 * 발주요청 — 모든 로그인 사용자가 자재 검색 → 품목 선택 → 요청 제출
 * 본인이 작성한 요청만 조회/취소 가능. 처리(분리/발주확정/입고)는 자재담당자가
 * 발주관리(procurement.html) 화면에서 수행한다.
 */
'use strict';

var prState = {
  page: 1, pageSize: 20, totalPages: 1, loading: false,
  statusFilter: '',
};

var _prListGrid   = null;
var _prItemGrid   = null;
var _prDetailGrid = null;

var currentUser  = null;
var myClinicId   = null;
var myDeptId     = null;
var myDeptName   = '';

var _rowIdCounter = 0;
var prItemRows    = [];   // 선택된 품목 로컬 상태 (rowId 기준)

/* ── 유틸 ── */
function ts(v) {
  return String(v == null ? '' : v)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function val(id)       { return (document.getElementById(id)?.value || '').trim(); }
function setVal(id, v) { var el = document.getElementById(id); if (el) el.value = v ?? ''; }
function fmtN(n)       { return Number(n || 0).toLocaleString('ko-KR'); }
function fmtDate(v)    { return v ? String(v).slice(0, 10) : '-'; }

var STATUS_LABEL = {
  REQUESTED:'요청', PROCESSING:'처리중', ORDERED:'발주확정',
  PARTIAL:'부분입고', COMPLETED:'입고완료', REJECTED:'반려', CANCELLED:'취소',
};
var STATUS_BADGE = {
  REQUESTED:'badge-requested', PROCESSING:'badge-processing', ORDERED:'badge-ordered',
  PARTIAL:'badge-partial', COMPLETED:'badge-completed', REJECTED:'badge-rejected', CANCELLED:'badge-cancelled',
};
function badgeStatus(s) {
  return '<span class="' + (STATUS_BADGE[s] || 'badge-requested') + '">' + (STATUS_LABEL[s] || ts(s)) + '</span>';
}

/* ── 모달 ── */
function openModal(id)  { document.getElementById(id)?.classList.add('is-open'); }
function closeModal(id) { document.getElementById(id)?.classList.remove('is-open'); }
window.closeModal = closeModal;

/* ══════════════════════════════════════════
   1. 발주요청 목록
══════════════════════════════════════════ */
function initPrListGrid() {
  _prListGrid = createMgGrid('prGrid', [
    { headerName: '요청번호', field: 'request_no', width: 150,
      headerClass: 'ag-left-header',
      cellStyle: { display:'flex', alignItems:'center', justifyContent:'flex-start' },
      cellRenderer: function(p) { return '<code style="font-size:11px;">' + ts(p.value || '-') + '</code>'; }
    },
    { headerName: '요청일', field: 'request_date', width: 100,
      cellRenderer: function(p) { return fmtDate(p.value); }
    },
    { headerName: '부서', field: 'departments', width: 110,
      headerClass: 'ag-left-header',
      cellStyle: { display:'flex', alignItems:'center', justifyContent:'flex-start' },
      cellRenderer: function(p) { return ts(p.value?.dept_name || '-'); }
    },
    { headerName: '대표품목', field: '_repItem', flex: 1, minWidth: 140,
      headerClass: 'ag-left-header',
      cellStyle: { display:'flex', alignItems:'center', justifyContent:'flex-start' },
      cellRenderer: function(p) {
        var name  = p.data._repItemName;
        var count = p.data._itemCount || 0;
        if (!name) return '-';
        if (count > 1) return ts(name) + ' <span style="color:#9ca3af;">외 ' + (count - 1) + '품목</span>';
        return ts(name);
      }
    },
    { headerName: '메모', field: 'memo', flex: 1,
      headerClass: 'ag-left-header',
      cellStyle: { display:'flex', alignItems:'center', justifyContent:'flex-start' },
      cellRenderer: function(p) { return ts(p.value || '-'); }
    },
    { headerName: '상태', field: 'status', width: 90,
      cellRenderer: function(p) {
        var s = document.createElement('span');
        s.innerHTML = badgeStatus(p.value);
        return s;
      }
    },
    { headerName: '', width: 130, sortable: false,
      cellRenderer: function(p) {
        var wrap = document.createElement('div');
        wrap.style.cssText = 'display:flex;gap:4px;align-items:center;height:100%;';
        var vBtn = document.createElement('button');
        vBtn.className = 'tbl-btn'; vBtn.textContent = '상세';
        vBtn.onclick = function() { openPrDetail(p.data.id); };
        wrap.appendChild(vBtn);
        return wrap;
      }
    },
  ], [], { noRowsText: '작성한 발주요청이 없습니다.' });
}

async function loadPrList(page) {
  if (prState.loading) return;
  prState.loading = true;
  page = page || prState.page;
  showGlobalLoading('발주요청 목록을 불러오는 중...');
  try {
    var from = (page - 1) * prState.pageSize;
    var to   = from + prState.pageSize - 1;
    var dateFrom = val('prDateFrom');
    var dateTo   = val('prDateTo');
    var keyword  = val('prKeyword');

    var q = supabaseClient
      .from('purchase_requests')
      .select('*, departments(dept_name)', { count: 'exact' })
      .eq('requester_id', currentUser.id)
      .order('created_at', { ascending: false })
      .range(from, to);
    if (prState.statusFilter) q = q.eq('status', prState.statusFilter);
    if (dateFrom) q = q.gte('request_date', dateFrom);
    if (dateTo)   q = q.lte('request_date', dateTo);

    if (keyword) {
      // 자재명 키워드 — purchase_request_items와 조인해 매칭되는 요청만 필터
      var { data: matched } = await supabaseClient
        .from('purchase_request_items')
        .select('request_id, items!inner(item_name)')
        .ilike('items.item_name', '%' + keyword + '%');
      var matchedIds = [...new Set((matched || []).map(function(r) { return r.request_id; }))];
      if (matchedIds.length) {
        q = q.in('id', matchedIds);
      } else {
        q = q.eq('id', '00000000-0000-0000-0000-000000000000'); // 매칭 없음 → 빈 결과
      }
    }

    var { data, error, count } = await q;
    if (error) throw new Error(error.message);

    prState.page       = page;
    prState.totalPages = Math.max(1, Math.ceil((count || 0) / prState.pageSize));

    var label = document.getElementById('prCountLabel');
    if (label) label.textContent = '총 ' + (count || 0) + '건';

    var rows = data || [];
    // 품목수 + 대표품목명(가장 먼저 추가된 품목) 조회
    if (rows.length) {
      var ids = rows.map(function(r) { return r.id; });
      var { data: items } = await supabaseClient
        .from('purchase_request_items')
        .select('request_id, created_at, items(item_name)')
        .in('request_id', ids)
        .order('created_at', { ascending: true });
      var countMap = {};
      var repMap   = {};
      (items || []).forEach(function(it) {
        countMap[it.request_id] = (countMap[it.request_id] || 0) + 1;
        if (!repMap[it.request_id]) repMap[it.request_id] = it.items?.item_name || '';
      });
      rows.forEach(function(r) {
        r._itemCount    = countMap[r.id] || 0;
        r._repItemName  = repMap[r.id] || '';
      });
    }

    updateMgGrid(_prListGrid, rows);
    renderPagination();
  } catch(e) {
    alert('발주요청 목록 로드 실패: ' + e.message);
  } finally {
    prState.loading = false;
    hideGlobalLoading();
  }
}

function renderPagination() {
  var container = document.getElementById('prPagination');
  if (!container) return;
  var page = prState.page, totalPages = prState.totalPages;
  if (totalPages <= 1) { container.innerHTML = ''; container.style.display = 'none'; return; }
  container.style.display = '';
  var bs = Math.floor((page-1)/10)*10+1, end = Math.min(totalPages, bs+9), pages = [];
  for (var i = bs; i <= end; i++)
    pages.push('<button class="pagination-btn' + (i===page?' is-active':'') + '" data-page="' + i + '">' + i + '</button>');
  container.innerHTML =
    '<button class="pagination-btn" data-page="' + Math.max(1,bs-1) + '"' + (bs<=1?' disabled':'') + '>이전</button>' +
    pages.join('') +
    '<button class="pagination-btn" data-page="' + Math.min(totalPages,end+1) + '"' + (end>=totalPages?' disabled':'') + '>다음</button>';
  Array.prototype.forEach.call(container.querySelectorAll('.pagination-btn[data-page]'), function(btn) {
    btn.addEventListener('click', function() {
      var p = Number(btn.dataset.page);
      if (p && p !== prState.page) loadPrList(p);
    });
  });
}

function initStatusTabs() {
  document.querySelectorAll('.pr-status-tab').forEach(function(btn) {
    btn.addEventListener('click', function() {
      document.querySelectorAll('.pr-status-tab').forEach(function(b) { b.classList.remove('active'); });
      btn.classList.add('active');
      prState.statusFilter = btn.dataset.status || '';
      loadPrList(1);
    });
  });
}

/* ══════════════════════════════════════════
   2. 자재 검색 그리드 (좌 패널 — ag-grid)
══════════════════════════════════════════ */
var _prSearchGrid = null;
var _allItems     = [];   // 전체 품목 캐시

async function loadItemCache() {
  if (_allItems.length) return;
  var { data } = await supabaseClient
    .from('items')
    .select('id, item_code, item_name, category, use_unit, purchase_unit, standard_price')
    .eq('active', 'Y')
    .order('category').order('item_name');
  _allItems = data || [];

  // 카테고리 필터 채우기
  var sel = document.getElementById('pr_category');
  if (sel) {
    var cats = [...new Set(_allItems.map(function(i){ return i.category || ''; }))].filter(Boolean).sort();
    sel.innerHTML = '<option value="">전체 카테고리</option>' +
      cats.map(function(c){ return '<option value="' + c + '">' + c + '</option>'; }).join('');
  }
}

function initPrSearchGrid() {
  var el = document.getElementById('prSearchGrid');
  if (!el || typeof agGrid === 'undefined') return;

  var colDefs = [
    { headerName: '카테고리', field: 'category', width: 90,
      cellStyle: { justifyContent:'center', fontSize:'10px', color:'#6b7280' }
    },
    { headerName: '자재명', field: 'item_name', flex: 2, minWidth: 120,
      headerClass: 'ag-left-header',
      cellStyle: { justifyContent:'flex-start', fontWeight:600 }
    },
    { headerName: '단위', field: 'purchase_unit', width: 60,
      cellStyle: { justifyContent:'center', color:'#6b7280' }
    },
    { headerName: '단가', field: 'standard_price', width: 90,
      cellStyle: { justifyContent:'flex-end' },
      valueFormatter: function(p) {
        return p.value ? Number(p.value).toLocaleString('ko-KR') + '원' : '-';
      }
    },
    { headerName: '', width: 60, sortable: false,
      cellStyle: { justifyContent:'center', padding:'0 4px' },
      cellRenderer: function(p) {
        var btn = document.createElement('button');
        btn.className = 'btn btn-sm btn-primary';
        btn.style.cssText = 'padding:2px 10px;font-size:11px;';
        // 이미 추가됐는지 확인
        var added = isPrItemAdded(p.data.id);
        btn.textContent = added ? '추가됨' : '추가';
        if (added) { btn.style.background = '#059669'; btn.style.borderColor = '#059669'; }
        btn.onclick = function() {
          addPrItemRow(p.data);
          // 버튼 상태 갱신
          btn.textContent = '추가됨';
          btn.style.background = '#059669';
          btn.style.borderColor = '#059669';
          updatePrItemCount();
        };
        return btn;
      }
    },
  ];

  _prSearchGrid = agGrid.createGrid(el, {
    suppressCellFocus: true,
    suppressPropertyNamesCheck: true,
    columnDefs: colDefs,
    rowData: [],
    rowHeight: 34,
    headerHeight: 34,
    defaultColDef: {
      sortable: true, resizable: true, suppressMovable: true,
      cellStyle: { display:'flex', alignItems:'center', justifyContent:'center' },
    },
    suppressHorizontalScroll: true,
    overlayNoRowsTemplate: '<span style="color:#9ca3af;font-size:12px;">조회 조건을 입력해 검색하세요.</span>',
    onGridReady: function(params) {
      setTimeout(function() { if (el.offsetWidth > 0) params.api.sizeColumnsToFit(); }, 0);
    },
  });
}

function searchPrItems() {
  var kw  = (val('pr_search_kw')  || '').toLowerCase();
  var cat = (document.getElementById('pr_category')?.value || '');
  var filtered = _allItems.filter(function(i) {
    var matchCat = !cat || i.category === cat;
    var matchKw  = !kw  || i.item_name.toLowerCase().includes(kw)
                         || (i.item_code || '').toLowerCase().includes(kw);
    return matchCat && matchKw;
  });

  if (_prSearchGrid) { _prSearchGrid.setGridOption('rowData', filtered); refitGridColumns(_prSearchGrid); }

  var cnt = document.getElementById('prSearchCount');
  if (cnt) cnt.textContent = filtered.length ? filtered.length + '건' : '';
}

function isPrItemAdded(itemId) {
  if (!_prItemGrid) return false;
  var found = false;
  _prItemGrid.forEachNode(function(n) { if (n.data.item_id === itemId) found = true; });
  return found;
}

/* ══════════════════════════════════════════
   3. 요청 품목 그리드 (우 패널 — 수량 인라인 편집)
══════════════════════════════════════════ */
/* ══════════════════════════════════════════
   3. 요청 품목  그리드 (선택된 품목, 수량 편집 가능)
══════════════════════════════════════════ */
function initPrItemGrid() {
  var el = document.getElementById('prItemGrid');
  if (!el || typeof agGrid === 'undefined') return;

  var colDefs = [
    { headerName: '자재명', field: 'item_name', flex: 2, minWidth: 120,
      headerClass: 'ag-left-header',
      cellStyle: { display:'flex', alignItems:'center', justifyContent:'flex-start', fontWeight:600 }
    },
    { headerName: '입고단위', field: 'purchase_unit', width: 80,
      cellStyle: { display:'flex', alignItems:'center', justifyContent:'center', color:'#6b7280' }
    },
    { headerName: '요청수량', field: 'request_qty', width: 90,
      cellStyle: { display:'flex', alignItems:'center', justifyContent:'flex-end' },
      editable: true, singleClickEdit: true,
      cellEditor: 'agNumberCellEditor',
      cellEditorParams: { min: 1 },
      valueFormatter: function(p) { return Number(p.value || 1).toLocaleString('ko-KR'); }
    },
    { headerName: '메모', field: 'memo', flex: 1,
      headerClass: 'ag-left-header',
      cellStyle: { display:'flex', alignItems:'center', justifyContent:'flex-start' },
      editable: true, singleClickEdit: true
    },
    { headerName: '', width: 44, sortable: false,
      cellStyle: { display:'flex', alignItems:'center', justifyContent:'center', padding:'0' },
      cellRenderer: function(p) {
        var btn = document.createElement('button');
        btn.className = 'btn btn-sm';
        btn.style.cssText = 'width:28px;height:24px;padding:0;color:#dc2626;border-color:#fecaca;font-size:14px;';
        btn.innerHTML = '✕';
        btn.onclick = function() {
          removePrItemRow(p.data._rowId);
          // 검색 그리드의 추가됨 버튼 상태 갱신
          if (_prSearchGrid) _prSearchGrid.refreshCells({ force: true });
          updatePrItemCount();
        };
        return btn;
      }
    },
  ];

  _prItemGrid = agGrid.createGrid(el, {
    suppressCellFocus: true,
    suppressPropertyNamesCheck: true,
    columnDefs: colDefs,
    defaultColDef: {
      sortable: false, resizable: true, suppressMovable: true,
      cellStyle: { display:'flex', alignItems:'center', justifyContent:'center' },
    },
    rowData: [],
    rowHeight: 34,
    headerHeight: 34,
    suppressHorizontalScroll: true,
    suppressScrollOnNewData: true,
    stopEditingWhenCellsLoseFocus: true,
    overlayNoRowsTemplate: '<span style="color:#9ca3af;font-size:12px;">왼쪽에서 자재를 검색해 추가하세요.</span>',
    onGridReady: function(params) {
      setTimeout(function() { if (el.offsetWidth > 0) params.api.sizeColumnsToFit(); }, 0);
    },
  });
}

function updatePrItemCount() {
  var cnt = 0;
  if (_prItemGrid) _prItemGrid.forEachNode(function() { cnt++; });
  var el = document.getElementById('prItemCount');
  if (el) el.textContent = cnt ? cnt + '건' : '';
}

function addPrItemRow(item) {
  // 이미 추가된 품목이면 수량만 +1
  var existing = null;
  if (_prItemGrid) {
    _prItemGrid.forEachNode(function(node) {
      if (node.data.item_id === item.id) existing = node;
    });
  }
  if (existing) {
    existing.setDataValue('request_qty', Number(existing.data.request_qty || 1) + 1);
    return;
  }

  _rowIdCounter++;
  var row = {
    _rowId:        _rowIdCounter,
    item_id:       item.id,
    item_name:     item.item_name,
    purchase_unit: item.purchase_unit || item.use_unit || '',
    use_unit:      item.use_unit || '',
    request_qty:   1,
    memo:          '',
  };
  if (_prItemGrid) {
    _prItemGrid.applyTransaction({ add: [row] });
    updatePrItemCount();
    refitGridColumns(_prItemGrid);
  }
}

function removePrItemRow(rowId) {
  if (!_prItemGrid) return;
  var toRemove = null;
  _prItemGrid.forEachNode(function(node) {
    if (node.data._rowId === rowId) toRemove = node.data;
  });
  if (toRemove) _prItemGrid.applyTransaction({ remove: [toRemove] });
}

function clearPrItemGrid() {
  if (!_prItemGrid) return;
  var all = [];
  _prItemGrid.forEachNode(function(n) { all.push(n.data); });
  if (all.length) _prItemGrid.applyTransaction({ remove: all });
}

/* ══════════════════════════════════════════
   발주요청 작성 모달
══════════════════════════════════════════ */
function openAddPr() { openAddPrModal(null); }

async function openAddPrModal(alerts) {
  setVal('pr_search_kw', '');
  setVal('pr_memo', '');
  openModal('prModal');
  // 품목 캐시 먼저 로드 (await — 카테고리 select 채워진 뒤 그리드 초기화)
  await loadItemCache();
  setTimeout(function() {
    // 검색 그리드 초기화
    if (!_prSearchGrid) initPrSearchGrid();
    else if (_prSearchGrid) { _prSearchGrid.setGridOption('rowData', []); }

    // 요청 품목 그리드 초기화
    if (!_prItemGrid) initPrItemGrid();
    clearPrItemGrid();
    updatePrItemCount();
    if (_prItemGrid) setTimeout(function(){ _prItemGrid.sizeColumnsToFit(); }, 50);
    if (_prSearchGrid) setTimeout(function(){ _prSearchGrid.sizeColumnsToFit(); }, 50);

    // 안전재고 자동채우기
    if (alerts && alerts.length) {
      var rows = alerts.map(function(a) {
        var needQty = a.reorder_qty > 0 ? a.reorder_qty : Math.abs(a.shortage || 1);
        return {
          _rowId:        ++_rowIdCounter,
          item_id:       a.item_id,
          item_name:     a.item_name,
          purchase_unit: a.use_unit || '',
          use_unit:      a.use_unit || '',
          request_qty:   needQty,
          memo:          '안전재고 기준 자동요청 (현재고:' + a.current_qty + ')',
        };
      });
      if (_prItemGrid) {
        _prItemGrid.setGridOption('rowData', rows);
        updatePrItemCount();
        refitGridColumns(_prItemGrid);
      }
    }
  }, 80);
}

async function savePr() {
  var itemRows = [];
  _prItemGrid?.forEachNode(function(node) {
    var d = node.data;
    if (!d.item_id) return;
    itemRows.push({
      item_id:     d.item_id,
      request_qty: Math.max(1, Number(d.request_qty || 1)),
      use_unit:    d.purchase_unit || d.use_unit || '',  // 입고단위 기준 저장
      memo:        d.memo || '',
    });
  });
  if (!itemRows.length) throw new Error('품목을 1개 이상 추가해주세요.');

  var requestNo = await genDocNo('PR');
  var prPayload = {
    request_no:     requestNo,
    requester_id:   currentUser.id,
    requester_name: currentUser.user_name || currentUser.email,
    clinic_id:      myClinicId,
    dept_id:        myDeptId,
    request_date:   new Date().toISOString().slice(0, 10),
    status:         'REQUESTED',
    memo:           val('pr_memo'),
  };

  var { data: newPr, error: ie } = await supabaseClient
    .from('purchase_requests').insert(prPayload).select().single();
  if (ie) throw new Error(ie.message);

  var prItems = itemRows.map(function(r) { return Object.assign({ request_id: newPr.id }, r); });
  var { error: pie } = await supabaseClient.from('purchase_request_items').insert(prItems);
  if (pie) throw new Error(pie.message);
}

/* ══════════════════════════════════════════
   발주요청 상세 모달
══════════════════════════════════════════ */
function initPrDetailGrid() {
  var el = document.getElementById('prDetailGrid');
  if (!el || typeof agGrid === 'undefined') return;

  _prDetailGrid = agGrid.createGrid(el, {
    suppressCellFocus: true,
    suppressPropertyNamesCheck: true,
    columnDefs: [
      { headerName: '자재명', field: 'item_name', flex: 2,
        headerClass: 'ag-left-header',
        cellStyle: { display:'flex', alignItems:'center', justifyContent:'flex-start' },
        cellRenderer: function(p) { return ts(p.value || '-'); }
      },
      { headerName: '사용단위', field: 'use_unit', width: 90,
        cellRenderer: function(p) { return ts(p.value || '-'); }
      },
      { headerName: '요청수량', field: 'request_qty', width: 90,
        headerClass: 'ag-right-header',
        cellStyle: { display:'flex', alignItems:'center', justifyContent:'flex-end' },
        cellRenderer: function(p) { return fmtN(p.value); }
      },
      { headerName: '진행상태', field: '_itemStatus', width: 110,
        cellRenderer: function(p) { return ts(p.value || '-'); }
      },
      { headerName: '메모', field: 'memo', flex: 1,
        headerClass: 'ag-left-header',
        cellStyle: { display:'flex', alignItems:'center', justifyContent:'flex-start' },
        cellRenderer: function(p) { return ts(p.value || '-'); }
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
    overlayNoRowsTemplate: '<span style="color:#9ca3af;font-size:12px;">품목이 없습니다.</span>',
    onGridReady: function(params) { if (el.offsetWidth > 0) params.api.sizeColumnsToFit(); },
  });
}

async function openPrDetail(id) {
  showGlobalLoading('발주요청 상세를 불러오는 중...');
  try {
    var { data: pr, error: e1 } = await supabaseClient
      .from('purchase_requests').select('*, departments(dept_name), clinics(clinic_name)').eq('id', id).single();
    if (e1) throw new Error(e1.message);

    var { data: prItems, error: e2 } = await supabaseClient
      .from('purchase_request_items')
      .select('*, items(item_name), purchase_order_items(order_qty, received_qty, purchase_orders(order_no, status))')
      .eq('request_id', id).order('created_at');
    if (e2) throw new Error(e2.message);

    var meta = document.getElementById('prDetailMeta');
    meta.innerHTML =
      mkMetaItem('요청번호', '<code>' + ts(pr.request_no) + '</code>') +
      mkMetaItem('상태',     badgeStatus(pr.status)) +
      mkMetaItem('요청일',   fmtDate(pr.request_date)) +
      mkMetaItem('부서',     ts(pr.departments?.dept_name || '-')) +
      mkMetaItem('요청자',   ts(pr.requester_name || '-')) +
      mkMetaItem('메모',     ts(pr.memo || '-'));

    var gridRows = (prItems || []).map(function(r) {
      var po = r.purchase_order_items;
      var st = '대기중';
      if (po) {
        var poStatus = po.purchase_orders?.status;
        if (poStatus === 'ORDERED')   st = '발주확정 (' + (po.purchase_orders?.order_no || '') + ')';
        if (poStatus === 'PARTIAL')   st = '부분입고 ' + (po.received_qty || 0) + '/' + (po.order_qty || 0);
        if (poStatus === 'COMPLETED') st = '입고완료';
        if (poStatus === 'DRAFT')     st = '발주서 분리됨';
        if (poStatus === 'CANCELLED') st = '발주취소';
      }
      return {
        item_name:    r.items?.item_name || '-',
        use_unit:     r.use_unit || '-',
        request_qty:  r.request_qty,
        _itemStatus:  st,
        memo:         r.memo || '',
      };
    });

    document.getElementById('prDetailTitle').textContent = '발주요청 상세 — ' + pr.request_no;
    openModal('prDetailModal');
    setTimeout(function() {
      if (!_prDetailGrid) initPrDetailGrid();
      if (_prDetailGrid) {
        _prDetailGrid.setGridOption('rowData', gridRows);
        refitGridColumns(_prDetailGrid);
      }
    }, 50);

    var foot = document.getElementById('prDetailFoot');
    foot.innerHTML = '<button class="btn btn-sm" onclick="closeModal(\'prDetailModal\')">닫기</button>';
    if (pr.status === 'REQUESTED') {
      var cb = document.createElement('button');
      cb.className = 'btn btn-sm btn-danger'; cb.textContent = '요청 취소';
      cb.onclick = function() { cancelPr(id); };
      foot.insertBefore(cb, foot.firstChild);
    }
  } catch(e) {
    alert('발주요청 상세 로드 실패: ' + e.message);
  } finally {
    hideGlobalLoading();
  }
}
window.openPrDetail = openPrDetail;

function mkMetaItem(label, value) {
  return '<div class="pr-detail-meta-item">' +
    '<span class="pr-detail-meta-label">' + label + '</span>' +
    '<span class="pr-detail-meta-value">' + value + '</span>' +
    '</div>';
}

async function cancelPr(id) {
  if (!confirm('발주요청을 취소하시겠습니까?')) return;
  var { error } = await supabaseClient.from('purchase_requests')
    .update({ status: 'CANCELLED', updated_at: new Date().toISOString() }).eq('id', id);
  if (error) { alert('취소 실패: ' + error.message); return; }
  closeModal('prDetailModal');
  await loadPrList(prState.page);
}

/* ── 채번 ── */
async function genDocNo(prefix) {
  var year = new Date().getFullYear();
  var { data, error } = await supabaseClient.rpc('next_doc_seq', { p_prefix: prefix, p_year: year });
  if (error || data == null) return prefix + '-' + year + '-' + Date.now().toString().slice(-6);
  return prefix + '-' + year + '-' + String(data).padStart(6, '0');
}

/* ── 내 의원/부서 조회 ── */
async function resolveMyClinicAndDept(user) {
  if (user.clinic_code) {
    var { data: clinic } = await supabaseClient
      .from('clinics').select('id').eq('clinic_code', user.clinic_code).maybeSingle();
    myClinicId = clinic?.id || null;
  }
  if (user.team_code) {
    var deptQuery = supabaseClient
      .from('departments').select('id, dept_name').eq('dept_code', user.team_code);
    // dept_code는 의원(clinic)별로 재사용될 수 있으므로 clinic_id로 범위를 좁혀야 함
    // (없으면 동명 부서코드가 여러 의원에 존재할 때 PostgREST가 다중 행 오류를 내고
    //  data가 null이 되어 "소속 부서 정보가 없습니다"로 잘못 표시됨)
    if (myClinicId) deptQuery = deptQuery.eq('clinic_id', myClinicId);
    var { data: dept } = await deptQuery.maybeSingle();
    myDeptId   = dept?.id || null;
    myDeptName = dept?.dept_name || '';
  }
}

/* ── 초기화 ── */
async function init() {
  var session = await auth.requireAuth();
  if (!session) return;
  currentUser = await auth.getSession();

  // 검색 날짜 기본값 — 시작일: 일주일 전, 종료일: 오늘
  var today = new Date();
  var weekAgo = new Date(today);
  weekAgo.setDate(today.getDate() - 7);
  setVal('prDateFrom', weekAgo.toISOString().slice(0, 10));
  setVal('prDateTo',   today.toISOString().slice(0, 10));

  initStatusTabs();
  initPrListGrid();

  document.getElementById('addPrBtn')?.addEventListener('click', openAddPr);
  document.getElementById('prSearchBtn')?.addEventListener('click', function() { loadPrList(1); });
  document.getElementById('prKeyword')?.addEventListener('keydown', function(e) { if (e.key === 'Enter') loadPrList(1); });
  document.getElementById('pr_search_kw')?.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') { e.preventDefault(); searchPrItems(); }
  });
  document.addEventListener('click', function(e) {
    var box = document.getElementById('prSearchResults');
    var wrap = document.querySelector('.pr-search-wrap');
    if (box && wrap && !wrap.contains(e.target)) box.classList.remove('is-open');
  });

  document.getElementById('prSaveBtn')?.addEventListener('click', async function() {
    var btn = this; btn.disabled = true;
    try {
      await savePr();
      closeModal('prModal');
      await loadPrList(1);
    } catch(e) {
      alert('요청 제출 실패: ' + e.message);
    } finally {
      btn.disabled = false;
    }
  });

  showGlobalLoading('데이터를 불러오는 중...');
  try {
    await resolveMyClinicAndDept(currentUser);
    await loadPrList(1);
  } catch(e) {
    alert('초기화 실패: ' + e.message);
  } finally {
    hideGlobalLoading();
  }
}

document.addEventListener('DOMContentLoaded', init);


/* ═══════════════════════════════════════════════════════
   부서별 안전재고 설정 & 자동채우기
   ─ ag-grid quickFilter 사용: 필터해도 편집값 보존
   ─ onCellValueChanged: 즉시 메모리 반영 (저장은 "전체저장" 버튼)
═══════════════════════════════════════════════════════ */

var _ssGrid   = null;
var _ssItems  = [];
var _ssChanged = {};  // item_id → {safety_stock, reorder_qty}

async function getMyDeptId() {
  // resolveMyClinicAndDept()에서 이미 team_code ↔ dept_code 기준으로 정확히 매칭해둔 값을 재사용
  // (init()에서 페이지 로드 시 항상 먼저 호출되므로 이 시점엔 채워져 있음)
  if (myDeptId) {
    var badge = document.getElementById('ssDeptLabel');
    if (badge && myDeptName) badge.textContent = '(' + myDeptName + ')';
    return myDeptId;
  }
  return null;
}

async function openSsSetting() {
  var deptId = await getMyDeptId();
  if (!deptId) { alert('소속 부서 정보가 없습니다.'); return; }

  showGlobalLoading('안전재고 설정을 불러오는 중...');
  try {
    var { data: items } = await supabaseClient
      .from('items')
      .select('id, item_code, item_name, category, use_unit, purchase_unit, purchase_unit_qty')
      .eq('active', 'Y')
      .order('category').order('item_name');

    var { data: stocks } = await supabaseClient
      .from('stock_current').select('item_id, qty').eq('dept_id', deptId);

    var { data: settings } = await supabaseClient
      .from('dept_item_settings')
      .select('id, item_id, safety_stock, reorder_qty')
      .eq('dept_id', deptId).eq('active', 'Y');

    var stockMap   = {};
    (stocks   || []).forEach(function(s) { stockMap[s.item_id]   = s.qty; });
    var settingMap = {};
    (settings || []).forEach(function(s) { settingMap[s.item_id] = s; });

    _ssItems = (items || []).map(function(i) {
      var ss  = settingMap[i.id];
      return {
        id:            i.id,
        item_code:     i.item_code,
        item_name:     i.item_name,
        category:      i.category || '-',
        purchase_unit: i.purchase_unit || i.use_unit || '',
        purchase_unit_qty: i.purchase_unit_qty || 1,
        use_unit:      i.use_unit || '',
        current_qty:   stockMap[i.id] || 0,
        safety_stock:  ss?.safety_stock ?? 0,
        reorder_qty:   ss?.reorder_qty  ?? 0,
        setting_id:    ss?.id || null,
      };
    });

    _ssChanged = {};

    // 카테고리 필터
    var cats = [...new Set(_ssItems.map(function(i){ return i.category; }))].sort();
    var catSel = document.getElementById('ssCategoryFilter');
    if (catSel) {
      catSel.innerHTML = '<option value="">전체 카테고리</option>' +
        cats.map(function(c){ return '<option value="' + c + '">' + c + '</option>'; }).join('');
    }

    document.getElementById('ssKeyword').value = '';
    if (catSel) catSel.value = '';

    // ag-grid 초기화 or 데이터 교체
    if (!_ssGrid) {
      _initSsGrid();
    } else {
      _ssGrid.setGridOption('rowData', _ssItems);
      refitGridColumns(_ssGrid);
    }
    // 모달 렌더 후 그리드 높이 재조정
    setTimeout(function() {
      var el2 = document.getElementById('ssGrid');
      if (el2 && _ssGrid) {
        var wrap = el2.closest('.ss-grid-wrap');
        var wh = wrap ? wrap.clientHeight : 0;
        if (wh > 40) { el2.style.height = wh + 'px'; _ssGrid.sizeColumnsToFit(); }
      }
    }, 100);

    updateSsFootInfo();
    document.getElementById('ssModal').classList.add('is-open');
  } catch(e) {
    alert('설정 로드 실패: ' + e.message);
  } finally {
    hideGlobalLoading();
  }
}

function _initSsGrid() {
  var el = document.getElementById('ssGrid');
  if (!el || typeof agGrid === 'undefined') return;

  var colDefs = [
    { headerName: '카테고리', field: 'category',
      flex: 0, width: 100,
      cellStyle: { justifyContent: 'center' },
      cellRenderer: function(p) {
        return '<span style="background:#f3f4f6;color:#374151;padding:1px 6px;border-radius:4px;font-size:10px;font-weight:600;">' + (p.value || '-') + '</span>';
      }
    },
    { headerName: '자재코드', field: 'item_code',
      flex: 0, width: 120,
      cellStyle: { fontFamily:'Consolas,monospace', fontSize:'11px', color:'#6b7280', justifyContent:'center' }
    },
    { headerName: '자재명', field: 'item_name',
      flex: 2, minWidth: 160,
      headerClass: 'ag-left-header',
      cellStyle: { fontWeight: 600, justifyContent: 'flex-start' }
    },
    { headerName: '입고단위', field: 'purchase_unit',
      flex: 0, width: 80,
      cellStyle: { justifyContent: 'center', color: '#6b7280' }
    },
    { headerName: '사용단위', field: 'use_unit',
      flex: 0, width: 80,
      cellStyle: { justifyContent: 'center', color: '#6b7280' }
    },
    { headerName: '환산비율', flex: 0, width: 80,
      cellStyle: { justifyContent: 'center', fontSize: '11px', color: '#9ca3af' },
      valueGetter: function(p) {
        return p.data.purchase_unit_qty > 1
          ? '1' + (p.data.purchase_unit||'') + '=' + p.data.purchase_unit_qty + (p.data.use_unit||'')
          : '-';
      }
    },
    { headerName: '현재고', field: 'current_qty',
      flex: 0, width: 80,
      cellStyle: function(p) {
        var low = p.data.safety_stock > 0 && p.value <= p.data.safety_stock;
        return { justifyContent: 'flex-end', fontWeight: '700',
                 color: low ? '#dc2626' : '#059669' };
      },
      valueFormatter: function(p) {
        return (p.value || 0).toLocaleString('ko-KR') + ' ' + (p.data.purchase_unit || p.data.use_unit || '');
      }
    },
    { headerName: '안전재고 (입고단위)', field: 'safety_stock',
      flex: 0, width: 140, editable: true,
      cellStyle: { justifyContent: 'center' },
      cellEditor: 'agNumberCellEditor',
      cellEditorParams: { min: 0, precision: 0 },
      valueFormatter: function(p) {
        return (p.value || 0) + ' ' + (p.data.purchase_unit || '');
      }
    },
    { headerName: '발주기본수량 (입고단위)', field: 'reorder_qty',
      flex: 0, width: 160, editable: true,
      cellStyle: { justifyContent: 'center', color: '#2563eb' },
      cellEditor: 'agNumberCellEditor',
      cellEditorParams: { min: 0, precision: 0 },
      valueFormatter: function(p) {
        if (!p.value) return '자동 (부족분)';
        return p.value + ' ' + (p.data.purchase_unit || '');
      }
    },
  ];

  var el2 = document.getElementById('ssGrid');
  if (el2) {
    var wrap = el2.closest('.ss-grid-wrap');
    var wh = wrap ? wrap.clientHeight : 0;
    if (!wh) wh = Math.max(300, window.innerHeight - 250);
    el2.style.height = wh + 'px';
  }

  _ssGrid = agGrid.createGrid(el, {
    suppressCellFocus: true,
    suppressPropertyNamesCheck: true,
    columnDefs: colDefs,
    rowData: _ssItems,
    rowHeight: 34,
    headerHeight: 34,
    defaultColDef: {
      sortable: true, resizable: true, suppressMovable: true,
      cellStyle: { display:'flex', alignItems:'center', justifyContent:'center' },
    },
    suppressHorizontalScroll: true,
    stopEditingWhenCellsLoseFocus: true,
    // 셀 편집 완료 시 메모리에 반영 (저장은 별도 버튼)
    onCellValueChanged: function(e) {
      var id    = e.data.id;
      var field = e.colDef.field;
      var val   = parseInt(e.newValue) || 0;
      // _ssItems 업데이트
      var item = _ssItems.find(function(i){ return i.id === id; });
      if (item) item[field] = val;
      // 변경 추적
      if (!_ssChanged[id]) _ssChanged[id] = {};
      _ssChanged[id][field] = val;
      updateSsFootInfo();
    },
    onGridReady: function(params) {
      setTimeout(function() { if (el.offsetWidth > 0) params.api.sizeColumnsToFit(); }, 0);
      window.addEventListener('resize', function() { if (el.offsetWidth > 0) params.api.sizeColumnsToFit(); });
    },
    overlayNoRowsTemplate: '<span style="color:#9ca3af;font-size:12px;">조회된 자재가 없습니다.</span>',
  });
}

// quickFilter — 행 데이터 교체 없이 필터 → 편집값 보존
function filterSsGrid() {
  if (!_ssGrid) return;
  var kw  = (document.getElementById('ssKeyword')?.value  || '').toLowerCase();
  var cat = document.getElementById('ssCategoryFilter')?.value || '';

  _ssGrid.setGridOption('rowData',
    _ssItems.filter(function(r) {
      var matchCat = !cat || r.category === cat;
      var matchKw  = !kw  || r.item_name.toLowerCase().includes(kw) || r.item_code.toLowerCase().includes(kw);
      return matchCat && matchKw;
    })
  );
  refitGridColumns(_ssGrid);
}

function updateSsFootInfo() {
  var el = document.getElementById('ssFootInfo');
  var cnt = Object.keys(_ssChanged).length;
  if (el) el.textContent = cnt ? '미저장 변경 ' + cnt + '개 항목' : '변경사항 없음';
}

function closeSsSetting() {
  var changed = Object.keys(_ssChanged).length;
  if (changed > 0) {
    if (!confirm('저장하지 않은 변경사항 ' + changed + '개가 있습니다. 닫으시겠습니까?')) return;
  }
  if (document.getElementById('ssModal').contains(document.activeElement)) document.body.focus();
  document.getElementById('ssModal').classList.remove('is-open');
}

async function saveSsAll() {
  var deptId = await getMyDeptId();
  if (!deptId) return;

  // 설정값이 있는 모든 항목 저장 (변경 여부 무관하게 현재 그리드 값 전체 저장)
  var toSave = _ssItems.filter(function(i) {
    return i.safety_stock > 0 || i.reorder_qty > 0 || _ssChanged[i.id];
  });
  if (!toSave.length) { alert('저장할 안전재고 설정이 없습니다.\n안전재고를 먼저 입력해주세요.'); return; }

  showGlobalLoading('안전재고 설정을 저장하는 중...');
  try {
    var upsertData = toSave.map(function(i) {
      return {
        dept_id:      deptId,
        item_id:      i.id,
        safety_stock: i.safety_stock || 0,
        reorder_qty:  i.reorder_qty  || 0,
        active:       'Y',
      };
    });

    var { error } = await supabaseClient
      .from('dept_item_settings')
      .upsert(upsertData, { onConflict: 'dept_id,item_id' });
    if (error) throw new Error(error.message);

    _ssChanged = {};
    updateSsFootInfo();
    alert(toSave.length + '개 항목의 안전재고 설정을 저장했습니다.');
  } catch(e) {
    alert('저장 실패: ' + e.message);
  } finally {
    hideGlobalLoading();
  }
}

/* ── 안전재고 기준 자동 발주요청 ─────────────── */
async function autoFillByStock() {
  var deptId = await getMyDeptId();
  if (!deptId) { alert('소속 부서 정보가 없습니다.'); return; }

  showGlobalLoading('부족 재고를 확인하는 중...');
  try {
    var { data: alerts, error } = await supabaseClient
      .from('dept_stock_alert')
      .select('*')
      .eq('dept_id', deptId)
      .lt('shortage', 0);

    if (error) throw new Error(error.message);
    if (!alerts || !alerts.length) {
      alert('현재 안전재고 이하인 품목이 없습니다.');
      return;
    }

    var msg = '아래 ' + alerts.length + '개 품목이 안전재고 이하입니다.\n발주요청서에 자동으로 추가할까요?\n\n' +
      alerts.slice(0, 10).map(function(a) {
        var needQty = a.reorder_qty > 0 ? a.reorder_qty : Math.abs(a.shortage);
        return '· ' + a.item_name + ' (현재고:' + a.current_qty + ', 안전재고:' + a.safety_stock + ', 요청수량:' + needQty + ')';
      }).join('\n') +
      (alerts.length > 10 ? '\n... 외 ' + (alerts.length - 10) + '개' : '');

    if (!confirm(msg)) return;
    openAddPrModal(alerts);
  } catch(e) {
    alert('조회 실패: ' + e.message);
  } finally {
    hideGlobalLoading();
  }
}

// ssModal 외부 클릭 닫기
document.addEventListener('DOMContentLoaded', function() {
  document.getElementById('ssModal')?.addEventListener('click', function(e) {
    if (e.target === this) closeSsSetting();
  });
  document.getElementById('ssKeyword')?.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') filterSsGrid();
  });
});
