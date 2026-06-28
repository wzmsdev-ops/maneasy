/**
 * material-stats.js
 * 자재 통계 — 입고 데이터 / 사용 데이터 / 원재료 수불부
 *
 * 레이아웃: procurement 스타일 (큰 탭 + 탭별 독립 검색바)
 * 각 탭 prefix: r_ (입고) / u_ (사용) / l_ (수불부)
 */

/* ── 상태 ─────────────────────────────────────────── */
var msState = {
  activeTab: 'receipt',
  page:       { receipt: 1, use: 1, ledger: 1 },
  pageSize:   20,
  totalPages: { receipt: 1, use: 1, ledger: 1 },
  loading:    false,
  grids:      { receipt: null, use: null, ledger: null },
  clinicRows: [],
  deptRows:   [],
  categoryRows: [],
};

/* ── 유틸 ──────────────────────────────────────────── */
function msVal(id) {
  var el = document.getElementById(id);
  return el ? el.value.trim() : '';
}
function fmtDate(d)  { return d ? String(d).slice(0, 10) : '-'; }
function fmtNum(n)   { return (n == null || n === '') ? '-' : Number(n).toLocaleString('ko-KR'); }

/* ── 날짜 기본값 (일주일 전 ~ 오늘) ─────────────── */
function defaultDateRange() {
  var today   = new Date();
  var weekAgo = new Date(today);
  weekAgo.setDate(today.getDate() - 7);
  return {
    from: weekAgo.toISOString().slice(0, 10),
    to:   today.toISOString().slice(0, 10),
  };
}

function setDates(prefix) {
  var r = defaultDateRange();
  var f = document.getElementById(prefix + 'date_from');
  var t = document.getElementById(prefix + 'date_to');
  if (f) f.value = r.from;
  if (t) t.value = r.to;
}

/* ── 탭별 필터 값 ─────────────────────────────────── */
function getFilters(prefix) {
  return {
    clinic:   msVal(prefix + 'clinic'),
    dept:     msVal(prefix + 'dept'),
    category: msVal(prefix + 'category'),
    dateFrom: msVal(prefix + 'date_from'),
    dateTo:   msVal(prefix + 'date_to'),
    keyword:  msVal(prefix + 'keyword'),
  };
}

/* ── AG Grid 공통 ────────────────────────────────── */
var defaultColDef = {
  sortable: true,
  resizable: true,
  suppressMovable: true,
  headerClass: 'ag-center-header',
  cellStyle: { display:'flex', alignItems:'center', justifyContent:'center' },
};
var ROW_H = 35, HEADER_H = 35;

/* ── 페이지네이션 ─────────────────────────────────── */
function renderPagination(containerId, tab) {
  var container = document.getElementById(containerId);
  if (!container) return;
  var page = msState.page[tab], total = msState.totalPages[tab];
  if (total <= 1) { container.innerHTML = ''; return; }
  var html = '<button class="pagination-btn"' + (page<=1?' disabled':'') + ' onclick="msGoPage(\''+tab+'\','+(page-1)+')">이전</button>';
  var s = Math.max(1, page-4), e = Math.min(total, s+9);
  if (e-s < 9) s = Math.max(1, e-9);
  if (s > 1) { html += '<button class="pagination-btn" onclick="msGoPage(\''+tab+'\',1)">1</button>'; if (s>2) html += '<span class="pagination-ellipsis">…</span>'; }
  for (var i=s; i<=e; i++) html += '<button class="pagination-btn'+(i===page?' is-active':'')+'" onclick="msGoPage(\''+tab+'\','+i+')">'+i+'</button>';
  if (e < total) { if (e<total-1) html += '<span class="pagination-ellipsis">…</span>'; html += '<button class="pagination-btn" onclick="msGoPage(\''+tab+'\','+total+')">'+total+'</button>'; }
  html += '<button class="pagination-btn"'+(page>=total?' disabled':'')+' onclick="msGoPage(\''+tab+'\','+(page+1)+')">다음</button>';
  container.innerHTML = html;
}

function msGoPage(tab, page) { msState.page[tab] = page; loadTab(tab); }

/* ── 그리드 초기화 ────────────────────────────────── */
function initReceiptGrid() {
  var el = document.getElementById('grid-receipt');
  if (!el || msState.grids.receipt) return;
  msState.grids.receipt = agGrid.createGrid(el, {
    columnDefs: [
      { headerName:'입고일',   field:'receipt_date',  width:100, cellRenderer:function(p){return fmtDate(p.value);} },
      { headerName:'입고번호', field:'receipt_no',    width:130, headerClass:'ag-left-header', cellStyle:{display:'flex',alignItems:'center',justifyContent:'flex-start',fontFamily:'Consolas,monospace',fontSize:'11px'} },
      { headerName:'자재구분', field:'category',      width:90,  valueGetter:function(p){return p.data.items?.category||'-';} },
      { headerName:'자재명',   field:'item_name',     flex:2,    headerClass:'ag-left-header', cellStyle:{display:'flex',alignItems:'center',justifyContent:'flex-start'}, valueGetter:function(p){return p.data.items?.item_name||'-';} },
      { headerName:'입고수량', field:'receipt_qty',   width:90,  cellRenderer:function(p){return fmtNum(p.value);} },
      { headerName:'단위',     field:'purchase_unit', width:70 },
      { headerName:'단가',     field:'unit_price',    width:90,  cellRenderer:function(p){return fmtNum(p.value);} },
      { headerName:'공급가액', field:'supply_price',  width:100, cellRenderer:function(p){return fmtNum((p.data.receipt_qty||0)*(p.data.unit_price||0));} },
      { headerName:'부가세',   field:'vat_amount',    width:90,  cellRenderer:function(p){return fmtNum(p.value);} },
      { headerName:'발주번호', field:'order_no',      width:130, headerClass:'ag-left-header', cellStyle:{display:'flex',alignItems:'center',justifyContent:'flex-start',fontFamily:'Consolas,monospace',fontSize:'11px'}, valueGetter:function(p){return p.data.purchase_orders?.order_no||'-';} },
      { headerName:'메모',     field:'memo',          flex:1,    headerClass:'ag-left-header', cellStyle:{display:'flex',alignItems:'center',justifyContent:'flex-start'} },
    ],
    defaultColDef: defaultColDef, rowData: [], rowHeight: ROW_H, headerHeight: HEADER_H,
    suppressPaginationPanel:true, suppressScrollOnNewData:true, suppressHorizontalScroll:true, suppressCellFocus:true,
    overlayNoRowsTemplate:'<span style="color:#9ca3af;font-size:12px;">조회된 입고 데이터가 없습니다.</span>',
    onGridReady:function(p){ p.api.sizeColumnsToFit(); window.addEventListener('resize',function(){ if(msState.grids.receipt) msState.grids.receipt.sizeColumnsToFit(); }); },
  });
}

function initUseGrid() {
  var el = document.getElementById('grid-use');
  if (!el || msState.grids.use) return;
  msState.grids.use = agGrid.createGrid(el, {
    columnDefs: [
      { headerName:'사용일',   field:'tx_date',    width:100, cellRenderer:function(p){return fmtDate(p.value);} },
      { headerName:'자재구분', field:'category',   width:90,  valueGetter:function(p){return p.data.items?.category||'-';} },
      { headerName:'자재명',   field:'item_name',  flex:2,    headerClass:'ag-left-header', cellStyle:{display:'flex',alignItems:'center',justifyContent:'flex-start'}, valueGetter:function(p){return p.data.items?.item_name||'-';} },
      { headerName:'사용수량', field:'qty',        width:90,  cellRenderer:function(p){return fmtNum(p.value);} },
      { headerName:'단위',     field:'use_unit',   width:70 },
      { headerName:'부서',     field:'dept_name',  width:110, valueGetter:function(p){return p.data.departments?.dept_name||'-';} },
      { headerName:'의원',     field:'clinic_name',width:110, valueGetter:function(p){return p.data.departments?.clinics?.clinic_name||'-';} },
      { headerName:'메모',     field:'memo',       flex:1,    headerClass:'ag-left-header', cellStyle:{display:'flex',alignItems:'center',justifyContent:'flex-start'} },
    ],
    defaultColDef: defaultColDef, rowData: [], rowHeight: ROW_H, headerHeight: HEADER_H,
    suppressPaginationPanel:true, suppressScrollOnNewData:true, suppressHorizontalScroll:true, suppressCellFocus:true,
    overlayNoRowsTemplate:'<span style="color:#9ca3af;font-size:12px;">조회된 사용 데이터가 없습니다.</span>',
    onGridReady:function(p){ p.api.sizeColumnsToFit(); window.addEventListener('resize',function(){ if(msState.grids.use) msState.grids.use.sizeColumnsToFit(); }); },
  });
}

function initLedgerGrid() {
  var el = document.getElementById('grid-ledger');
  if (!el || msState.grids.ledger) return;
  msState.grids.ledger = agGrid.createGrid(el, {
    columnDefs: [
      { headerName:'자재구분', field:'category',    width:100 },
      { headerName:'자재명',   field:'item_name',   flex:2,   headerClass:'ag-left-header', cellStyle:{display:'flex',alignItems:'center',justifyContent:'flex-start'} },
      { headerName:'단위',     field:'use_unit',    width:70 },
      { headerName:'기초재고', field:'opening_qty', width:100, cellRenderer:function(p){return fmtNum(p.value);} },
      { headerName:'입고',     field:'in_qty',      width:90,  cellRenderer:function(p){return fmtNum(p.value);} },
      { headerName:'사용',     field:'out_qty',     width:90,  cellRenderer:function(p){return fmtNum(p.value);} },
      { headerName:'조정',     field:'adj_qty',     width:80,  cellRenderer:function(p){ var v=p.value||0; return '<span style="color:'+(v>0?'#166534':v<0?'#991b1b':'#6b7280')+'">'+fmtNum(v)+'</span>'; } },
      { headerName:'잔고',     field:'closing_qty', width:100, cellRenderer:function(p){ var v=p.value||0; return '<span style="font-weight:700;color:'+(v<0?'#991b1b':'#111827')+'">'+fmtNum(v)+'</span>'; } },
    ],
    defaultColDef: defaultColDef, rowData: [], rowHeight: ROW_H, headerHeight: HEADER_H,
    suppressPaginationPanel:true, suppressScrollOnNewData:true, suppressHorizontalScroll:true, suppressCellFocus:true,
    overlayNoRowsTemplate:'<span style="color:#9ca3af;font-size:12px;">조회된 수불 데이터가 없습니다.</span>',
    onGridReady:function(p){ p.api.sizeColumnsToFit(); window.addEventListener('resize',function(){ if(msState.grids.ledger) msState.grids.ledger.sizeColumnsToFit(); }); },
  });
}

/* ── 데이터 로드 ──────────────────────────────────── */
async function loadReceiptData(page, f) {
  var from = (page-1)*msState.pageSize, to = from+msState.pageSize-1;
  var q = supabaseClient.from('stock_receipts')
    .select('*, items(item_name,category,use_unit), purchase_orders(order_no)', { count:'exact' })
    .order('receipt_date',{ascending:false}).order('created_at',{ascending:false}).range(from,to);
  if (f.dateFrom) q = q.gte('receipt_date', f.dateFrom);
  if (f.dateTo)   q = q.lte('receipt_date', f.dateTo);
  if (f.keyword || f.category) {
    var iq = supabaseClient.from('items').select('id');
    if (f.keyword)  iq = iq.ilike('item_name', '%'+f.keyword+'%');
    if (f.category) iq = iq.eq('category', f.category);
    var { data:mi } = await iq;
    var ids = (mi||[]).map(function(r){return r.id;});
    if (!ids.length) return { data:[], count:0 };
    q = q.in('item_id', ids);
  }
  var { data, error, count } = await q;
  if (error) throw new Error(error.message);
  return { data: data||[], count: count||0 };
}

async function loadUseData(page, f) {
  var from = (page-1)*msState.pageSize, to = from+msState.pageSize-1;
  var q = supabaseClient.from('stock_transactions')
    .select('*, items(item_name,category), departments(dept_name,clinics(clinic_name))', { count:'exact' })
    .eq('tx_type','OUT').eq('ref_type','use')
    .order('tx_date',{ascending:false}).order('created_at',{ascending:false}).range(from,to);
  if (f.dateFrom) q = q.gte('tx_date', f.dateFrom);
  if (f.dateTo)   q = q.lte('tx_date', f.dateTo);
  if (f.dept) {
    var dr = msState.deptRows.find(function(d){return d.dept_code===f.dept;});
    if (dr) q = q.eq('dept_id', dr.id);
  } else if (f.clinic) {
    var cr = msState.clinicRows.find(function(c){return c.clinic_code===f.clinic;});
    if (cr) {
      var dids = msState.deptRows.filter(function(d){return d.clinic_id===cr.id;}).map(function(d){return d.id;});
      if (dids.length) q = q.in('dept_id', dids);
    }
  }
  if (f.keyword || f.category) {
    var iq = supabaseClient.from('items').select('id');
    if (f.keyword)  iq = iq.ilike('item_name', '%'+f.keyword+'%');
    if (f.category) iq = iq.eq('category', f.category);
    var { data:mi } = await iq;
    var ids = (mi||[]).map(function(r){return r.id;});
    if (!ids.length) return { data:[], count:0 };
    q = q.in('item_id', ids);
  }
  var { data, error, count } = await q;
  if (error) throw new Error(error.message);
  return { data: data||[], count: count||0 };
}

async function loadLedgerData(page, f) {
  var iq = supabaseClient.from('items').select('id,item_name,category,use_unit').eq('active', true);
  if (f.keyword)  iq = iq.ilike('item_name', '%'+f.keyword+'%');
  if (f.category) iq = iq.eq('category', f.category);
  var { data:itemRows } = await iq;
  if (!itemRows||!itemRows.length) return { data:[], count:0 };

  var itemIds = itemRows.map(function(r){return r.id;});
  var itemMap = {};
  itemRows.forEach(function(r){itemMap[r.id]=r;});

  // 부서/의원 필터
  var deptFilter = null;
  if (f.dept) {
    var dr = msState.deptRows.find(function(d){return d.dept_code===f.dept;});
    if (dr) deptFilter = [dr.id];
  } else if (f.clinic) {
    var cr = msState.clinicRows.find(function(c){return c.clinic_code===f.clinic;});
    if (cr) deptFilter = msState.deptRows.filter(function(d){return d.clinic_id===cr.id;}).map(function(d){return d.id;});
  }

  // 기초재고 (기간 시작 이전)
  var openingMap = {};
  itemIds.forEach(function(id){openingMap[id]=0;});
  if (f.dateFrom) {
    var oQ = supabaseClient.from('stock_transactions').select('item_id,tx_type,qty').in('item_id',itemIds).lt('tx_date',f.dateFrom);
    if (deptFilter) oQ = oQ.in('dept_id', deptFilter);
    var { data:oRows } = await oQ;
    (oRows||[]).forEach(function(r){
      if (r.tx_type==='IN')  openingMap[r.item_id] += (r.qty||0);
      if (r.tx_type==='OUT') openingMap[r.item_id] -= (r.qty||0);
      if (r.tx_type==='ADJ') openingMap[r.item_id] += (r.qty||0);
    });
  }

  // 기간 내 집계
  var inMap={}, outMap={}, adjMap={};
  var txQ = supabaseClient.from('stock_transactions').select('item_id,tx_type,qty').in('item_id',itemIds);
  if (f.dateFrom) txQ = txQ.gte('tx_date',f.dateFrom);
  if (f.dateTo)   txQ = txQ.lte('tx_date',f.dateTo);
  if (deptFilter) txQ = txQ.in('dept_id',deptFilter);
  var { data:txRows } = await txQ;
  (txRows||[]).forEach(function(r){
    if (r.tx_type==='IN')  inMap[r.item_id]  = (inMap[r.item_id]  ||0)+(r.qty||0);
    if (r.tx_type==='OUT') outMap[r.item_id] = (outMap[r.item_id] ||0)+(r.qty||0);
    if (r.tx_type==='ADJ') adjMap[r.item_id] = (adjMap[r.item_id] ||0)+(r.qty||0);
  });

  var rows = itemIds.map(function(id){
    var o=openingMap[id]||0, i=inMap[id]||0, u=outMap[id]||0, a=adjMap[id]||0;
    return { item_id:id, item_name:itemMap[id].item_name, category:itemMap[id].category||'-',
             use_unit:itemMap[id].use_unit||'', opening_qty:o, in_qty:i, out_qty:u, adj_qty:a, closing_qty:o+i-u+a };
  }).filter(function(r){ return r.in_qty||r.out_qty||r.adj_qty||r.closing_qty||r.opening_qty; });

  var total = rows.length;
  return { data: rows.slice((page-1)*msState.pageSize, page*msState.pageSize), count: total };
}

/* ── 탭별 로드 ────────────────────────────────────── */
var TAB_PREFIX = { receipt:'r_', use:'u_', ledger:'l_' };

async function loadTab(tab, resetPage) {
  if (msState.loading) return;
  msState.loading = true;
  if (resetPage) msState.page[tab] = 1;
  var page = msState.page[tab];
  var f = getFilters(TAB_PREFIX[tab]);

  try {
    showGlobalLoading('데이터를 불러오는 중...');
    var result;
    if (tab==='receipt') {
      if (!msState.grids.receipt) initReceiptGrid();
      result = await loadReceiptData(page, f);
      msState.grids.receipt.setGridOption('rowData', result.data);
    } else if (tab==='use') {
      if (!msState.grids.use) initUseGrid();
      result = await loadUseData(page, f);
      msState.grids.use.setGridOption('rowData', result.data);
    } else {
      if (!msState.grids.ledger) initLedgerGrid();
      result = await loadLedgerData(page, f);
      msState.grids.ledger.setGridOption('rowData', result.data);
    }
    msState.totalPages[tab] = Math.max(1, Math.ceil((result.count||0)/msState.pageSize));
    renderPagination('page-'+tab, tab);
  } catch(e) {
    console.error('loadTab error:', e);
    alert('데이터 로드 실패: '+e.message);
  } finally {
    msState.loading = false;
    hideGlobalLoading();
  }
}

/* ── 탭 전환 ──────────────────────────────────────── */
function switchTab(tab) {
  msState.activeTab = tab;
  document.querySelectorAll('.po-main-tabs .tab-btn').forEach(function(btn){
    btn.classList.toggle('active', btn.dataset.tab===tab);
  });
  document.querySelectorAll('.po-main-panel').forEach(function(p){
    p.classList.toggle('active', p.id==='panel-'+tab);
  });
  if (!msState.grids[tab]) loadTab(tab);
}

/* ── 필터 UI 초기화 ───────────────────────────────── */
async function initFilterSelects(prefix) {
  // 의원
  var clinicEl = document.getElementById(prefix+'clinic');
  if (clinicEl) {
    clinicEl.innerHTML = '<option value="">전체 의원</option>' +
      msState.clinicRows.map(function(r){ return '<option value="'+r.clinic_code+'">'+r.clinic_name+'</option>'; }).join('');
  }
  // 부서 (의원 연동)
  function populateDept(clinicCode) {
    var deptEl = document.getElementById(prefix+'dept');
    if (!deptEl) return;
    var filtered = clinicCode
      ? msState.deptRows.filter(function(d){return d.clinics&&d.clinics.clinic_code===clinicCode;})
      : msState.deptRows;
    deptEl.innerHTML = '<option value="">전체 부서</option>' +
      filtered.map(function(d){ return '<option value="'+d.dept_code+'">'+d.dept_name+'</option>'; }).join('');
  }
  populateDept('');
  if (clinicEl) clinicEl.addEventListener('change', function(){ populateDept(this.value); });

  // 자재구분
  var catEl = document.getElementById(prefix+'category');
  if (catEl) {
    catEl.innerHTML = '<option value="">전체 자재구분</option>' +
      msState.categoryRows.map(function(r){ return '<option value="'+r.category_name+'">'+r.category_name+'</option>'; }).join('');
  }

  // 날짜 기본값
  setDates(prefix);
}

/* ── 이벤트 바인딩 ────────────────────────────────── */
function bindTabEvents(tab, prefix) {
  var searchBtn = document.getElementById(prefix+'search_btn');
  var resetBtn  = document.getElementById(prefix+'reset_btn');
  var keyword   = document.getElementById(prefix+'keyword');

  if (searchBtn) searchBtn.addEventListener('click', function(){ loadTab(tab, true); });
  if (keyword)   keyword.addEventListener('keydown', function(e){ if(e.key==='Enter') loadTab(tab, true); });
  if (resetBtn) {
    resetBtn.addEventListener('click', function(){
      ['clinic','dept','category','keyword'].forEach(function(k){
        var el = document.getElementById(prefix+k);
        if (el) el.value = '';
      });
      setDates(prefix);
      loadTab(tab, true);
    });
  }
}

/* ── 페이지 초기화 ────────────────────────────────── */
async function initPage() {
  try {
    showGlobalLoading('화면을 준비하는 중...');
    var session = await auth.requireAuth();
    if (!session) return;

    // 공통 마스터 데이터 로드
    var [clinicRes, deptRes, catRes] = await Promise.all([
      supabaseClient.from('clinics').select('id,clinic_code,clinic_name').eq('active','Y').order('sort_order'),
      supabaseClient.from('departments').select('id,dept_code,dept_name,clinic_id,clinics(id,clinic_code)').eq('active','Y').order('sort_order'),
      supabaseClient.from('item_categories').select('id,category_name').order('sort_order'),
    ]);
    msState.clinicRows   = clinicRes.data  || [];
    msState.deptRows     = deptRes.data    || [];
    msState.categoryRows = catRes.data     || [];

    // 탭별 필터 UI 초기화
    await initFilterSelects('r_');
    await initFilterSelects('u_');
    await initFilterSelects('l_');

    // 탭 전환 이벤트
    document.querySelectorAll('.po-main-tabs .tab-btn').forEach(function(btn){
      btn.addEventListener('click', function(){ switchTab(btn.dataset.tab); });
    });

    // 탭별 검색/초기화 이벤트
    bindTabEvents('receipt', 'r_');
    bindTabEvents('use',     'u_');
    bindTabEvents('ledger',  'l_');

    // 첫 탭(입고) 초기 로드
    initReceiptGrid();
    var result = await loadReceiptData(1, getFilters('r_'));
    msState.grids.receipt.setGridOption('rowData', result.data);
    msState.totalPages.receipt = Math.max(1, Math.ceil((result.count||0)/msState.pageSize));
    renderPagination('page-receipt', 'receipt');

  } catch(e) {
    console.error('initPage error:', e);
  } finally {
    hideGlobalLoading();
  }
}

document.addEventListener('DOMContentLoaded', initPage);
