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
function fmtQty2(n)  { return (n == null || n === '') ? '-' : Number(n).toLocaleString('ko-KR', {minimumFractionDigits:2, maximumFractionDigits:2}); }

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
      { headerName:'합계금액', field:'total_amount',  width:110, cellStyle:{fontWeight:700}, cellRenderer:function(p){return fmtNum((p.data.receipt_qty||0)*(p.data.unit_price||0)+(p.data.vat_amount||0));} },
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
      { headerName:'의원',     field:'clinic_name',width:110, valueGetter:function(p){return p.data.departments?.clinics?.clinic_name||'-';} },
      { headerName:'부서',     field:'dept_name',  width:110, valueGetter:function(p){return p.data.departments?.dept_name||'-';} },
      { headerName:'사용일',   field:'tx_date',    width:100, cellRenderer:function(p){return fmtDate(p.value);} },
      { headerName:'자재구분', field:'category',   width:90,  valueGetter:function(p){return p.data.items?.category||'-';} },
      { headerName:'자재명',   field:'item_name',  flex:2,    headerClass:'ag-left-header', cellStyle:{display:'flex',alignItems:'center',justifyContent:'flex-start'}, valueGetter:function(p){return p.data.items?.item_name||'-';} },
      { headerName:'사용수량', field:'qty',        width:90,  cellRenderer:function(p){return fmtNum(Math.abs(p.value));} },
      { headerName:'단위',     field:'use_unit',   width:70 },
      { headerName:'공급가',   field:'supply_price',width:100, cellRenderer:function(p){return fmtNum(Math.abs(p.data.qty||0)*(p.data.unit_price||0));} },
      { headerName:'부가세',   field:'vat_amount',  width:90,  cellRenderer:function(p){return fmtNum(Math.round(Math.abs(p.data.qty||0)*(p.data.unit_price||0)*0.1));} },
      { headerName:'합계금액', field:'total_amount',width:110, cellStyle:{fontWeight:700}, cellRenderer:function(p){
          var supply=Math.abs(p.data.qty||0)*(p.data.unit_price||0);
          return fmtNum(supply+Math.round(supply*0.1));
        } },
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
      { headerName:'단위',     field:'purchase_unit',width:70 },
      { headerName:'기초', children:[
        { headerName:'수량', field:'opening_qty', width:100, cellRenderer:function(p){return fmtQty2(p.value);} },
        { headerName:'금액', field:'opening_amt', width:110, cellRenderer:function(p){return fmtNum(p.value);} },
      ]},
      { headerName:'입고', children:[
        { headerName:'수량', field:'in_qty', width:90, cellRenderer:function(p){return fmtQty2(p.value);} },
        { headerName:'금액', field:'in_amt', width:100, cellRenderer:function(p){return fmtNum(p.value);} },
      ]},
      { headerName:'사용', children:[
        { headerName:'수량', field:'out_qty', width:90, cellRenderer:function(p){return fmtQty2(p.value);} },
        { headerName:'금액', field:'out_amt', width:100, cellRenderer:function(p){return fmtNum(p.value);} },
      ]},
      { headerName:'기말', children:[
        { headerName:'수량', field:'closing_qty', width:100, cellStyle:{fontWeight:700},
          cellRenderer:function(p){ var v=p.value||0; return '<span style="font-weight:700;color:'+(v<0?'#991b1b':'#111827')+'">'+fmtQty2(v)+'</span>'; } },
        { headerName:'금액', field:'closing_amt', width:110, cellStyle:{fontWeight:700}, cellRenderer:function(p){return fmtNum(p.value);} },
      ]},
    ],
    defaultColDef: defaultColDef, rowData: [], rowHeight: ROW_H, headerHeight: HEADER_H, groupHeaderHeight: HEADER_H,
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
  var iq = supabaseClient.from('items').select('id,item_name,category,use_unit,purchase_unit,purchase_unit_qty,standard_price').eq('active', 'Y');
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

  // 기초재고 (기간 시작 이전) — 수량과 함께, 그 거래 시점의 실제 단가(LOT 단가)로 금액도 같이 누적
  // (전체조회일 때 입고/사용 중복집계 방지 원리는 아래 본문 집계와 동일)
  var openingMap = {}, openingAmtMap = {};
  itemIds.forEach(function(id){openingMap[id]=0; openingAmtMap[id]=0;});
  if (f.dateFrom) {
    var oQ = supabaseClient.from('stock_transactions').select('item_id,tx_type,ref_type,qty,unit_price').in('item_id',itemIds).lt('tx_date',f.dateFrom);
    if (deptFilter) oQ = oQ.in('dept_id', deptFilter);
    var { data:oRows } = await oQ;
    (oRows||[]).forEach(function(r){
      var amt = (r.qty||0) * (r.unit_price||0);
      if (r.tx_type==='IN' && (deptFilter || r.ref_type==='receipt')) {
        openingMap[r.item_id] += (r.qty||0); openingAmtMap[r.item_id] += Math.abs(amt);
      }
      if (r.tx_type==='OUT' && (deptFilter || r.ref_type==='use')) {
        openingMap[r.item_id] -= Math.abs(r.qty||0); openingAmtMap[r.item_id] -= Math.abs(amt);
      }
      if (r.tx_type==='ADJ') { openingMap[r.item_id] += (r.qty||0); openingAmtMap[r.item_id] += amt; }
    });
  }

  // 기간 내 집계 — 수량과 함께, 거래별 실제 단가(LOT 단가)로 금액도 누적
  // 부서 필터가 없는 '전체' 조회일 때는 불출/이동/취소가 OUT+IN 한 쌍으로 둘 다 잡혀서
  // 입고·사용이 내부이동까지 같이 섞여 부풀려짐(잔고는 상쇄돼서 맞지만 입고/사용 자체는 틀림).
  // 그래서 전체 조회일 때는 입고=진짜 구매입고(receipt)만, 사용=진짜 소비(use)만 잡음.
  // 부서를 특정해서 볼 때는 반대쪽 다리가 필터에서 자동으로 빠지므로 기존 방식 그대로 둠.
  var inMap={}, outMap={}, adjMap={}, inAmtMap={}, outAmtMap={}, adjAmtMap={};
  var txQ = supabaseClient.from('stock_transactions').select('item_id,tx_type,ref_type,qty,unit_price').in('item_id',itemIds);
  if (f.dateFrom) txQ = txQ.gte('tx_date',f.dateFrom);
  if (f.dateTo)   txQ = txQ.lte('tx_date',f.dateTo);
  if (deptFilter) txQ = txQ.in('dept_id',deptFilter);
  var { data:txRows } = await txQ;
  (txRows||[]).forEach(function(r){
    var amt = Math.abs(r.qty||0) * (r.unit_price||0); // 거래 당시 실제 단가(LOT) 기준 금액
    if (r.tx_type==='IN' && (deptFilter || r.ref_type==='receipt')) {
      inMap[r.item_id]  = (inMap[r.item_id]  ||0)+(r.qty||0);
      inAmtMap[r.item_id]  = (inAmtMap[r.item_id] ||0)+amt;
    }
    if (r.tx_type==='OUT' && r.ref_type==='dispatch_cancel') {
      // 불출취소는 부서 관점에서도 '사용'이 아니라 보정(취소)이므로 조정으로 분류
      adjMap[r.item_id] = (adjMap[r.item_id] ||0)-Math.abs(r.qty||0);
      adjAmtMap[r.item_id] = (adjAmtMap[r.item_id]||0)-amt;
    } else if (r.tx_type==='OUT' && (deptFilter || r.ref_type==='use')) {
      outMap[r.item_id] = (outMap[r.item_id] ||0)+Math.abs(r.qty||0);
      outAmtMap[r.item_id] = (outAmtMap[r.item_id]||0)+amt;
    }
    if (r.tx_type==='ADJ') { adjMap[r.item_id] = (adjMap[r.item_id] ||0)+(r.qty||0);           adjAmtMap[r.item_id] = (adjAmtMap[r.item_id]||0)+(r.qty<0?-amt:amt); }
  });

  var rows = itemIds.map(function(id){
    var item = itemMap[id];
    var puQty = item.purchase_unit_qty || 1;
    // 수량은 사용단위 합계를 구매단위로 환산(소수점 발생 가능). 금액은 환산할 필요 없음 —
    // 거래마다 그 시점의 실제 단가(LOT 단가)를 그대로 곱해서 이미 누적해둔 값이라,
    // 평균/기준단가가 아니라 실제 입고가를 그대로 따라감 (예: 6/1 1,000개@1,000원, 6/28 800개@500원이면
    // 각각의 실제 입고금액이 그대로 더해짐)
    var o=(openingMap[id]||0)/puQty, i=(inMap[id]||0)/puQty, u=(outMap[id]||0)/puQty, a=(adjMap[id]||0)/puQty;
    var closing = o+i-u+a;
    var oAmt=openingAmtMap[id]||0, iAmt=inAmtMap[id]||0, uAmt=outAmtMap[id]||0, aAmt=adjAmtMap[id]||0;
    return { item_id:id, item_name:item.item_name, category:item.category||'-',
             purchase_unit:item.purchase_unit||item.use_unit||'',
             opening_qty:o, in_qty:i, out_qty:u, adj_qty:a, closing_qty:closing,
             opening_amt:oAmt, in_amt:iAmt, out_amt:uAmt, adj_amt:aAmt, closing_amt:oAmt+iAmt-uAmt+aAmt };
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
