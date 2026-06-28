/**
 * material-stats.js
 * 자재 통계 — 입고 데이터 / 사용 데이터 / 원재료 수불부
 *
 * 탭별 공통 필터: 기간(from~to), 의원, 부서, 자재구분, 자재명(키워드)
 * 입고/사용: 페이지네이션 그리드
 * 수불부: 자재별 기초재고→입고→사용→잔고 요약 그리드
 */

/* ── 상태 ─────────────────────────────────────────── */
var msState = {
  activeTab: 'receipt',
  page: { receipt: 1, use: 1, ledger: 1 },
  pageSize: 20,
  totalPages: { receipt: 1, use: 1, ledger: 1 },
  loading: false,
  // 필터 캐시
  deptRows: [],
  clinicRows: [],
  categoryRows: [],
  // 그리드 인스턴스
  grids: { receipt: null, use: null, ledger: null },
  // 그리드 초기화 여부
  gridInited: { receipt: false, use: false, ledger: false },
};

/* ── 날짜 기본값 세팅 (일주일 전 ~ 오늘) ─────────── */
function setDefaultDates() {
  var today   = new Date();
  var weekAgo = new Date(today);
  weekAgo.setDate(today.getDate() - 7);
  var todayStr   = today.toISOString().slice(0, 10);
  var weekAgoStr = weekAgo.toISOString().slice(0, 10);
  var fromEl = document.getElementById('sf_date_from');
  var toEl   = document.getElementById('sf_date_to');
  if (fromEl) fromEl.value = weekAgoStr;
  if (toEl)   toEl.value   = todayStr;
}

/* ── 유틸 ──────────────────────────────────────────── */
function msVal(id) {
  var el = document.getElementById(id);
  return el ? el.value.trim() : '';
}

function fmtDate(d) {
  if (!d) return '-';
  return String(d).slice(0, 10);
}

function fmtNum(n) {
  if (n == null || n === '') return '-';
  return Number(n).toLocaleString('ko-KR');
}

function getFilters() {
  return {
    keyword:   msVal('sf_keyword'),
    clinic:    msVal('sf_clinic'),
    dept:      msVal('sf_dept'),
    category:  msVal('sf_category'),
    dateFrom:  msVal('sf_date_from'),
    dateTo:    msVal('sf_date_to'),
  };
}

/* ── AG Grid 공통 defaultColDef ─────────────────────── */
var defaultColDef = {
  sortable: true,
  resizable: true,
  suppressMovable: true,
  headerClass: 'ag-center-header',
  cellStyle: { display: 'flex', alignItems: 'center', justifyContent: 'center' },
};

var ROW_H    = 35;
var HEADER_H = 35;

/* ── 페이지네이션 렌더 ────────────────────────────── */
function renderPagination(containerId, tab) {
  var container = document.getElementById(containerId);
  if (!container) return;
  var page       = msState.page[tab];
  var totalPages = msState.totalPages[tab];
  if (totalPages <= 1) { container.innerHTML = ''; return; }

  var html = '';
  html += '<button class="pagination-btn" ' + (page <= 1 ? 'disabled' : '') + ' onclick="msGoPage(\'' + tab + '\',' + (page - 1) + ')">이전</button>';

  var start = Math.max(1, page - 4);
  var end   = Math.min(totalPages, start + 9);
  if (end - start < 9) start = Math.max(1, end - 9);

  if (start > 1) {
    html += '<button class="pagination-btn" onclick="msGoPage(\'' + tab + '\',1)">1</button>';
    if (start > 2) html += '<span class="pagination-ellipsis">…</span>';
  }
  for (var i = start; i <= end; i++) {
    html += '<button class="pagination-btn' + (i === page ? ' is-active' : '') + '" onclick="msGoPage(\'' + tab + '\',' + i + ')">' + i + '</button>';
  }
  if (end < totalPages) {
    if (end < totalPages - 1) html += '<span class="pagination-ellipsis">…</span>';
    html += '<button class="pagination-btn" onclick="msGoPage(\'' + tab + '\',' + totalPages + ')">' + totalPages + '</button>';
  }

  html += '<button class="pagination-btn" ' + (page >= totalPages ? 'disabled' : '') + ' onclick="msGoPage(\'' + tab + '\',' + (page + 1) + ')">다음</button>';
  container.innerHTML = html;
}

function msGoPage(tab, page) {
  msState.page[tab] = page;
  loadTab(tab);
}

/* ── 그리드 초기화 ────────────────────────────────── */
function initReceiptGrid() {
  var el = document.getElementById('grid-receipt');
  if (!el || msState.grids.receipt) return;
  var cols = [
    { headerName: '입고일',    field: 'receipt_date',      width: 100, cellRenderer: function(p) { return fmtDate(p.value); } },
    { headerName: '입고번호',  field: 'receipt_no',        width: 120, headerClass: 'ag-left-header', cellStyle: { display:'flex', alignItems:'center', justifyContent:'flex-start', fontFamily:'Consolas,monospace', fontSize:'11px' } },
    { headerName: '자재구분',  field: 'category',          width: 90,  valueGetter: function(p) { return p.data.items?.category || '-'; } },
    { headerName: '자재명',    field: 'item_name',         flex: 2,    headerClass: 'ag-left-header', cellStyle: { display:'flex', alignItems:'center', justifyContent:'flex-start' }, valueGetter: function(p) { return p.data.items?.item_name || '-'; } },
    { headerName: '입고수량',  field: 'receipt_qty',       width: 90,  cellRenderer: function(p) { return fmtNum(p.value); } },
    { headerName: '단위',      field: 'purchase_unit',     width: 70 },
    { headerName: '단가',      field: 'unit_price',        width: 90,  cellRenderer: function(p) { return fmtNum(p.value); } },
    { headerName: '공급가액',  field: 'supply_price',      width: 100, cellRenderer: function(p) { return fmtNum((p.data.receipt_qty || 0) * (p.data.unit_price || 0)); } },
    { headerName: '부가세',    field: 'vat_amount',        width: 90,  cellRenderer: function(p) { return fmtNum(p.value); } },
    { headerName: '발주번호',  field: 'order_no',          width: 120, headerClass: 'ag-left-header', cellStyle: { display:'flex', alignItems:'center', justifyContent:'flex-start', fontFamily:'Consolas,monospace', fontSize:'11px' }, valueGetter: function(p) { return p.data.purchase_orders?.order_no || '-'; } },
    { headerName: '메모',      field: 'memo',              flex: 1,    headerClass: 'ag-left-header', cellStyle: { display:'flex', alignItems:'center', justifyContent:'flex-start' } },
  ];
  msState.grids.receipt = agGrid.createGrid(el, {
    columnDefs: cols,
    defaultColDef: defaultColDef,
    rowData: [],
    rowHeight: ROW_H,
    headerHeight: HEADER_H,
    suppressPaginationPanel: true,
    suppressScrollOnNewData: true,
    suppressHorizontalScroll: true,
    suppressCellFocus: true,
    overlayNoRowsTemplate: '<span style="color:#9ca3af;font-size:12px;">조회된 입고 데이터가 없습니다.</span>',
    onGridReady: function(p) {
      p.api.sizeColumnsToFit();
      window.addEventListener('resize', function() { if (msState.grids.receipt) msState.grids.receipt.sizeColumnsToFit(); });
    },
  });
  msState.gridInited.receipt = true;
}

function initUseGrid() {
  var el = document.getElementById('grid-use');
  if (!el || msState.grids.use) return;
  var cols = [
    { headerName: '사용일',    field: 'tx_date',     width: 100, cellRenderer: function(p) { return fmtDate(p.value); } },
    { headerName: '자재구분',  field: 'category',    width: 90,  valueGetter: function(p) { return p.data.items?.category || '-'; } },
    { headerName: '자재명',    field: 'item_name',   flex: 2,    headerClass: 'ag-left-header', cellStyle: { display:'flex', alignItems:'center', justifyContent:'flex-start' }, valueGetter: function(p) { return p.data.items?.item_name || '-'; } },
    { headerName: '사용수량',  field: 'qty',         width: 90,  cellRenderer: function(p) { return fmtNum(p.value); } },
    { headerName: '단위',      field: 'use_unit',    width: 70 },
    { headerName: '부서',      field: 'dept_name',   width: 100, valueGetter: function(p) { return p.data.departments?.dept_name || '-'; } },
    { headerName: '의원',      field: 'clinic_name', width: 100, valueGetter: function(p) { return p.data.departments?.clinics?.clinic_name || '-'; } },
    { headerName: '메모',      field: 'memo',        flex: 1,    headerClass: 'ag-left-header', cellStyle: { display:'flex', alignItems:'center', justifyContent:'flex-start' } },
  ];
  msState.grids.use = agGrid.createGrid(el, {
    columnDefs: cols,
    defaultColDef: defaultColDef,
    rowData: [],
    rowHeight: ROW_H,
    headerHeight: HEADER_H,
    suppressPaginationPanel: true,
    suppressScrollOnNewData: true,
    suppressHorizontalScroll: true,
    suppressCellFocus: true,
    overlayNoRowsTemplate: '<span style="color:#9ca3af;font-size:12px;">조회된 사용 데이터가 없습니다.</span>',
    onGridReady: function(p) {
      p.api.sizeColumnsToFit();
      window.addEventListener('resize', function() { if (msState.grids.use) msState.grids.use.sizeColumnsToFit(); });
    },
  });
  msState.gridInited.use = true;
}

function initLedgerGrid() {
  var el = document.getElementById('grid-ledger');
  if (!el || msState.grids.ledger) return;
  var cols = [
    { headerName: '자재구분',  field: 'category',      width: 100 },
    { headerName: '자재명',    field: 'item_name',     flex: 2, headerClass: 'ag-left-header', cellStyle: { display:'flex', alignItems:'center', justifyContent:'flex-start' } },
    { headerName: '단위',      field: 'use_unit',      width: 70 },
    { headerName: '기초재고',  field: 'opening_qty',   width: 100, cellRenderer: function(p) { return fmtNum(p.value); } },
    { headerName: '입고',      field: 'in_qty',        width: 90,  cellRenderer: function(p) { return fmtNum(p.value); } },
    { headerName: '사용',      field: 'out_qty',       width: 90,  cellRenderer: function(p) { return fmtNum(p.value); } },
    { headerName: '조정',      field: 'adj_qty',       width: 80,  cellRenderer: function(p) {
      var v = p.value || 0;
      return '<span style="color:' + (v > 0 ? '#166534' : v < 0 ? '#991b1b' : '#6b7280') + '">' + fmtNum(v) + '</span>';
    }},
    { headerName: '잔고',      field: 'closing_qty',   width: 100, cellRenderer: function(p) {
      var v = p.value || 0;
      return '<span style="font-weight:700;color:' + (v < 0 ? '#991b1b' : '#111827') + '">' + fmtNum(v) + '</span>';
    }},
  ];
  msState.grids.ledger = agGrid.createGrid(el, {
    columnDefs: cols,
    defaultColDef: defaultColDef,
    rowData: [],
    rowHeight: ROW_H,
    headerHeight: HEADER_H,
    suppressPaginationPanel: true,
    suppressScrollOnNewData: true,
    suppressHorizontalScroll: true,
    suppressCellFocus: true,
    overlayNoRowsTemplate: '<span style="color:#9ca3af;font-size:12px;">조회된 수불 데이터가 없습니다.</span>',
    onGridReady: function(p) {
      p.api.sizeColumnsToFit();
      window.addEventListener('resize', function() { if (msState.grids.ledger) msState.grids.ledger.sizeColumnsToFit(); });
    },
  });
  msState.gridInited.ledger = true;
}

/* ── 데이터 로드 ──────────────────────────────────── */
async function loadReceiptData(page) {
  var f    = getFilters();
  var from = (page - 1) * msState.pageSize;
  var to   = from + msState.pageSize - 1;

  var q = supabaseClient
    .from('stock_receipts')
    .select('*, items(item_name, category, use_unit), purchase_orders(order_no)', { count: 'exact' })
    .order('receipt_date', { ascending: false })
    .order('created_at',   { ascending: false })
    .range(from, to);

  if (f.dateFrom)  q = q.gte('receipt_date', f.dateFrom);
  if (f.dateTo)    q = q.lte('receipt_date', f.dateTo);

  // 키워드: items.item_name은 역FK라 별도 처리
  if (f.keyword || f.category) {
    var itemQ = supabaseClient.from('items').select('id');
    if (f.keyword)  itemQ = itemQ.ilike('item_name', '%' + f.keyword + '%');
    if (f.category) itemQ = itemQ.eq('category', f.category);
    var { data: matchItems } = await itemQ;
    var ids = (matchItems || []).map(function(r) { return r.id; });
    if (ids.length === 0) return { data: [], count: 0 };
    q = q.in('item_id', ids);
  }

  var { data, error, count } = await q;
  if (error) throw new Error(error.message);
  return { data: data || [], count: count || 0 };
}

async function loadUseData(page) {
  var f    = getFilters();
  var from = (page - 1) * msState.pageSize;
  var to   = from + msState.pageSize - 1;

  var q = supabaseClient
    .from('stock_transactions')
    .select('*, items(item_name, category), departments(dept_name, clinics(clinic_name))', { count: 'exact' })
    .eq('tx_type', 'OUT')
    .eq('ref_type', 'use')
    .order('tx_date',    { ascending: false })
    .order('created_at', { ascending: false })
    .range(from, to);

  if (f.dateFrom) q = q.gte('tx_date', f.dateFrom);
  if (f.dateTo)   q = q.lte('tx_date', f.dateTo);

  // 부서/의원 필터 — dept_id로
  if (f.dept) {
    var deptRow = msState.deptRows.find(function(d) { return d.dept_code === f.dept; });
    if (deptRow) q = q.eq('dept_id', deptRow.id);
  } else if (f.clinic) {
    var clinicRow = msState.clinicRows.find(function(c) { return c.clinic_code === f.clinic; });
    if (clinicRow) {
      var deptIds = msState.deptRows.filter(function(d) { return d.clinic_id === clinicRow.id; }).map(function(d) { return d.id; });
      if (deptIds.length) q = q.in('dept_id', deptIds);
    }
  }

  if (f.keyword || f.category) {
    var itemQ = supabaseClient.from('items').select('id');
    if (f.keyword)  itemQ = itemQ.ilike('item_name', '%' + f.keyword + '%');
    if (f.category) itemQ = itemQ.eq('category', f.category);
    var { data: matchItems } = await itemQ;
    var ids = (matchItems || []).map(function(r) { return r.id; });
    if (ids.length === 0) return { data: [], count: 0 };
    q = q.in('item_id', ids);
  }

  var { data, error, count } = await q;
  if (error) throw new Error(error.message);
  return { data: data || [], count: count || 0 };
}

async function loadLedgerData(page) {
  var f = getFilters();

  // 수불부: 기간 내 IN/OUT/ADJ 트랜잭션을 item_id로 집계
  // 기초재고 = 기간 시작일 이전 (IN - OUT - ADJ) 누적
  // 입고/사용/조정 = 기간 내 집계
  // 잔고 = 기초 + 입고 - 사용 + 조정

  // 1. 대상 item_id 목록 필터링
  var itemQ = supabaseClient.from('items').select('id, item_name, category, use_unit').eq('active', true);
  if (f.keyword)  itemQ = itemQ.ilike('item_name', '%' + f.keyword + '%');
  if (f.category) itemQ = itemQ.eq('category', f.category);
  var { data: itemRows } = await itemQ;
  if (!itemRows || itemRows.length === 0) return { data: [], count: 0 };

  var itemIds = itemRows.map(function(r) { return r.id; });
  var itemMap = {};
  itemRows.forEach(function(r) { itemMap[r.id] = r; });

  // 2. 부서/의원 필터로 dept_id 목록 확보
  var deptFilter = null;
  if (f.dept) {
    var dr = msState.deptRows.find(function(d) { return d.dept_code === f.dept; });
    if (dr) deptFilter = [dr.id];
  } else if (f.clinic) {
    var cr = msState.clinicRows.find(function(c) { return c.clinic_code === f.clinic; });
    if (cr) deptFilter = msState.deptRows.filter(function(d) { return d.clinic_id === cr.id; }).map(function(d) { return d.id; });
  }

  // 3. 기초재고 (기간 시작 이전 전체 트랜잭션)
  var openingMap = {};
  if (f.dateFrom) {
    var oQ = supabaseClient
      .from('stock_transactions')
      .select('item_id, tx_type, qty')
      .in('item_id', itemIds)
      .lt('tx_date', f.dateFrom);
    if (deptFilter) oQ = oQ.in('dept_id', deptFilter);
    var { data: openRows } = await oQ;
    (openRows || []).forEach(function(r) {
      if (!openingMap[r.item_id]) openingMap[r.item_id] = 0;
      if (r.tx_type === 'IN')  openingMap[r.item_id] += (r.qty || 0);
      if (r.tx_type === 'OUT') openingMap[r.item_id] -= (r.qty || 0);
      if (r.tx_type === 'ADJ') openingMap[r.item_id] += (r.qty || 0);
    });
  } else {
    // 기간 미지정 시 현재고 사용
    var { data: curRows } = await supabaseClient.from('stock_current').select('item_id, qty').in('item_id', itemIds);
    // 현재고는 기초로 쓰지 않고 0으로 처리 (전체 기간 조회 시 기초=0)
    itemIds.forEach(function(id) { openingMap[id] = 0; });
  }

  // 4. 기간 내 트랜잭션 집계
  var inMap = {}, outMap = {}, adjMap = {};
  var txQ = supabaseClient
    .from('stock_transactions')
    .select('item_id, tx_type, qty')
    .in('item_id', itemIds);
  if (f.dateFrom) txQ = txQ.gte('tx_date', f.dateFrom);
  if (f.dateTo)   txQ = txQ.lte('tx_date', f.dateTo);
  if (deptFilter) txQ = txQ.in('dept_id', deptFilter);
  var { data: txRows } = await txQ;
  (txRows || []).forEach(function(r) {
    if (r.tx_type === 'IN')  { inMap[r.item_id]  = (inMap[r.item_id]  || 0) + (r.qty || 0); }
    if (r.tx_type === 'OUT') { outMap[r.item_id] = (outMap[r.item_id] || 0) + (r.qty || 0); }
    if (r.tx_type === 'ADJ') { adjMap[r.item_id] = (adjMap[r.item_id] || 0) + (r.qty || 0); }
  });

  // 5. 집계 결과 조합 (활동 있는 자재만)
  var rows = itemIds
    .map(function(id) {
      var opening = openingMap[id] || 0;
      var inQty   = inMap[id]  || 0;
      var outQty  = outMap[id] || 0;
      var adjQty  = adjMap[id] || 0;
      var closing = opening + inQty - outQty + adjQty;
      return {
        item_id:     id,
        item_name:   itemMap[id].item_name,
        category:    itemMap[id].category || '-',
        use_unit:    itemMap[id].use_unit || '',
        opening_qty: opening,
        in_qty:      inQty,
        out_qty:     outQty,
        adj_qty:     adjQty,
        closing_qty: closing,
      };
    })
    .filter(function(r) {
      // 기간 내 변동이 있거나 잔고가 있는 자재만 표시
      return r.in_qty || r.out_qty || r.adj_qty || r.closing_qty || r.opening_qty;
    });

  // 페이지네이션 (클라이언트 사이드)
  var total    = rows.length;
  var pageRows = rows.slice((page - 1) * msState.pageSize, page * msState.pageSize);
  return { data: pageRows, count: total };
}

/* ── 탭별 로드 진입점 ─────────────────────────────── */
async function loadTab(tab, resetPage) {
  if (msState.loading) return;
  msState.loading = true;
  if (resetPage) msState.page[tab] = 1;

  try {
    showGlobalLoading('데이터를 불러오는 중...');
    var page = msState.page[tab];
    var result;

    if (tab === 'receipt') {
      if (!msState.gridInited.receipt) initReceiptGrid();
      result = await loadReceiptData(page);
      msState.grids.receipt.setGridOption('rowData', result.data);
    } else if (tab === 'use') {
      if (!msState.gridInited.use) initUseGrid();
      result = await loadUseData(page);
      msState.grids.use.setGridOption('rowData', result.data);
    } else if (tab === 'ledger') {
      if (!msState.gridInited.ledger) initLedgerGrid();
      result = await loadLedgerData(page);
      msState.grids.ledger.setGridOption('rowData', result.data);
    }

    msState.totalPages[tab] = Math.max(1, Math.ceil((result.count || 0) / msState.pageSize));
    renderPagination('page-' + tab, tab);

  } catch(e) {
    console.error('loadTab error:', e);
    alert('데이터 로드 실패: ' + e.message);
  } finally {
    msState.loading = false;
    hideGlobalLoading();
  }
}

/* ── 탭 전환 ──────────────────────────────────────── */
function switchTab(tab) {
  msState.activeTab = tab;

  document.querySelectorAll('.ms-tab').forEach(function(btn) {
    btn.classList.toggle('is-active', btn.dataset.tab === tab);
  });
  document.querySelectorAll('.ms-tab-panel').forEach(function(panel) {
    panel.classList.toggle('is-active', panel.id === 'panel-' + tab);
  });

  // 첫 진입 시만 로드
  if (!msState.gridInited[tab]) {
    loadTab(tab);
  }
}

/* ── 필터 UI 초기화 ───────────────────────────────── */
async function initFilters() {
  // clinics
  var { data: clinicRows } = await supabaseClient
    .from('clinics').select('id, clinic_code, clinic_name').eq('active', 'Y').order('sort_order');
  msState.clinicRows = clinicRows || [];

  var clinicEl = document.getElementById('sf_clinic');
  if (clinicEl) {
    clinicEl.innerHTML = '<option value="">전체 의원</option>' +
      msState.clinicRows.map(function(r) {
        return '<option value="' + r.clinic_code + '">' + r.clinic_name + '</option>';
      }).join('');
  }

  // departments
  var { data: deptRows } = await supabaseClient
    .from('departments').select('id, dept_code, dept_name, clinic_id, clinics(id, clinic_code)').eq('active', 'Y').order('sort_order');
  msState.deptRows = deptRows || [];

  function populateDept(clinicCode) {
    var deptEl = document.getElementById('sf_dept');
    if (!deptEl) return;
    var filtered = clinicCode
      ? msState.deptRows.filter(function(d) { return d.clinics && d.clinics.clinic_code === clinicCode; })
      : msState.deptRows;
    deptEl.innerHTML = '<option value="">전체 부서</option>' +
      filtered.map(function(d) {
        return '<option value="' + d.dept_code + '">' + d.dept_name + '</option>';
      }).join('');
  }

  populateDept('');
  if (clinicEl) {
    clinicEl.addEventListener('change', function() { populateDept(this.value); });
  }

  // item_categories
  var { data: catRows } = await supabaseClient
    .from('item_categories').select('id, category_name').order('sort_order');
  msState.categoryRows = catRows || [];

  var catEl = document.getElementById('sf_category');
  if (catEl) {
    catEl.innerHTML = '<option value="">전체 자재구분</option>' +
      msState.categoryRows.map(function(r) {
        return '<option value="' + r.category_name + '">' + r.category_name + '</option>';
      }).join('');
  }

  // 기본 기간: 일주일 전 ~ 오늘
  setDefaultDates();
}

/* ── 이벤트 바인딩 ────────────────────────────────── */
function bindEvents() {
  // 탭 클릭
  document.querySelectorAll('.ms-tab').forEach(function(btn) {
    btn.addEventListener('click', function() { switchTab(btn.dataset.tab); });
  });

  // 조회 폼
  var form = document.getElementById('statsFilterForm');
  if (form) {
    form.addEventListener('submit', function(e) {
      e.preventDefault();
      loadTab(msState.activeTab, true);
    });
  }

  // 초기화
  var resetBtn = document.getElementById('sf_reset');
  if (resetBtn) {
    resetBtn.addEventListener('click', function() {
      document.getElementById('sf_keyword').value   = '';
      document.getElementById('sf_clinic').value    = '';
      document.getElementById('sf_dept').value      = '';
      document.getElementById('sf_category').value  = '';
      setDefaultDates();
      loadTab(msState.activeTab, true);
    });
  }
}

/* ── 페이지 초기화 ────────────────────────────────── */
async function initPage() {
  try {
    showGlobalLoading('화면을 준비하는 중...');
    var session = await auth.requireAuth();
    if (!session) return;
    await initFilters();
    bindEvents();
    // 첫 탭(입고) 로드
    initReceiptGrid();
    var result = await loadReceiptData(1);
    msState.grids.receipt.setGridOption('rowData', result.data);
    msState.totalPages.receipt = Math.max(1, Math.ceil((result.count || 0) / msState.pageSize));
    msState.gridInited.receipt = true;
    renderPagination('page-receipt', 'receipt');
    document.body.classList.add('page-ready');
  } catch(e) {
    console.error('initPage error:', e);
  } finally {
    hideGlobalLoading();
  }
}

document.addEventListener('DOMContentLoaded', initPage);
