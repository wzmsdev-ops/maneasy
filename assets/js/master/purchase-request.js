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
  _prListGrid = (function(){ var _g = document.getElementById('prGrid'); if(_g) _g.style.height = Math.max(300, window.innerHeight - 130) + 'px'; })();
  createMgGrid('prGrid', [
    { headerName: '요청번호', field: 'request_no', width: 150,
      headerClass: 'ag-left-header',
      cellStyle: { display:'flex', alignItems:'center', justifyContent:'flex-start' },
      cellRenderer: function(p) { return '<code style="font-size:11px;">' + ts(p.value || '-') + '</code>'; }
    },
    { headerName: '요청일', field: 'request_date', width: 100,
      cellRenderer: function(p) { return fmtDate(p.value); }
    },
    { headerName: '부서', field: 'departments', flex: 1,
      headerClass: 'ag-left-header',
      cellStyle: { display:'flex', alignItems:'center', justifyContent:'flex-start' },
      cellRenderer: function(p) { return ts(p.value?.dept_name || '-'); }
    },
    { headerName: '품목수', field: '_itemCount', width: 80,
      cellStyle: { display:'flex', alignItems:'center', justifyContent:'flex-end' },
      cellRenderer: function(p) { return fmtN(p.value); }
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
    var q = supabaseClient
      .from('purchase_requests')
      .select('*, departments(dept_name)', { count: 'exact' })
      .eq('requester_id', currentUser.id)
      .order('created_at', { ascending: false })
      .range(from, to);
    if (prState.statusFilter) q = q.eq('status', prState.statusFilter);

    var { data, error, count } = await q;
    if (error) throw new Error(error.message);

    prState.page       = page;
    prState.totalPages = Math.max(1, Math.ceil((count || 0) / prState.pageSize));

    var label = document.getElementById('prCountLabel');
    if (label) label.textContent = '총 ' + (count || 0) + '건';

    var rows = data || [];
    // 품목수 카운트 조회
    if (rows.length) {
      var ids = rows.map(function(r) { return r.id; });
      var { data: items } = await supabaseClient
        .from('purchase_request_items').select('request_id').in('request_id', ids);
      var countMap = {};
      (items || []).forEach(function(it) { countMap[it.request_id] = (countMap[it.request_id] || 0) + 1; });
      rows.forEach(function(r) { r._itemCount = countMap[r.id] || 0; });
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
  if (totalPages <= 1) { container.innerHTML = ''; return; }
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
   2. 자재 검색
══════════════════════════════════════════ */
async function searchItems() {
  var kw = val('pr_search_kw');
  var resultsBox = document.getElementById('prSearchResults');
  if (!kw) { resultsBox.classList.remove('is-open'); return; }

  var { data, error } = await supabaseClient
    .from('items')
    .select('id, item_name, category, spec, use_unit, purchase_unit, purchase_unit_qty, standard_price')
    .eq('active', 'Y')
    .ilike('item_name', '%' + kw + '%')
    .order('item_name')
    .limit(20);

  if (error) { alert('자재 검색 실패: ' + error.message); return; }

  if (!data || !data.length) {
    resultsBox.innerHTML = '<div class="pr-search-empty">검색 결과가 없습니다.</div>';
    resultsBox.classList.add('is-open');
    return;
  }

  resultsBox.innerHTML = data.map(function(it) {
    return '<div class="pr-search-item" data-item-id="' + it.id + '">' +
      '<div><div class="pr-search-item-name">' + ts(it.item_name) + '</div>' +
      '<div class="pr-search-item-meta">' + ts(it.category || '-') + (it.spec ? ' · ' + ts(it.spec) : '') + '</div></div>' +
      '<div class="pr-search-item-meta">단위: ' + ts(it.use_unit || '-') + '</div>' +
      '</div>';
  }).join('');
  resultsBox.classList.add('is-open');

  Array.prototype.forEach.call(resultsBox.querySelectorAll('.pr-search-item'), function(el) {
    el.addEventListener('click', function() {
      var item = data.find(function(it) { return it.id === el.dataset.itemId; });
      if (item) addPrItemRow(item);
      resultsBox.classList.remove('is-open');
      setVal('pr_search_kw', '');
    });
  });
}

/* ══════════════════════════════════════════
   3. 요청 품목 그리드 (선택된 품목, 수량 편집 가능)
══════════════════════════════════════════ */
function initPrItemGrid() {
  var el = document.getElementById('prItemGrid');
  if (!el || typeof agGrid === 'undefined') return;

  var colDefs = [
    { headerName: '자재명', field: 'item_name', flex: 2,
      headerClass: 'ag-left-header',
      cellStyle: { display:'flex', alignItems:'center', justifyContent:'flex-start' },
      cellRenderer: function(p) { return ts(p.value || '-'); }
    },
    { headerName: '사용단위', field: 'use_unit', width: 90,
      cellStyle: { display:'flex', alignItems:'center', justifyContent:'center', background:'#f8fafc', color:'#6b7280' },
      cellRenderer: function(p) { return ts(p.value || '-'); }
    },
    { headerName: '요청수량', field: 'request_qty', width: 100,
      headerClass: 'ag-right-header',
      cellStyle: { display:'flex', alignItems:'center', justifyContent:'flex-end' },
      editable: true,
      cellEditor: 'agNumberCellEditor',
      cellEditorParams: { min: 1 },
      cellRenderer: function(p) { return Number(p.value || 1).toLocaleString('ko-KR'); }
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
        btn.onclick = function() { removePrItemRow(p.data._rowId); };
        return btn;
      }
    },
  ];

  _prItemGrid = agGrid.createGrid(el, {
    columnDefs: colDefs,
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
    overlayNoRowsTemplate: '<span style="color:#9ca3af;font-size:12px;">자재를 검색해 추가하세요.</span>',
    onGridReady: function(params) { params.api.sizeColumnsToFit(); },
  });
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
    _rowId:      _rowIdCounter,
    item_id:     item.id,
    item_name:   item.item_name,
    use_unit:    item.use_unit || '',
    request_qty: 1,
    memo:        '',
  };
  if (_prItemGrid) _prItemGrid.applyTransaction({ add: [row] });
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

function openAddPrModal(alerts) {
  setVal('pr_search_kw', '');
  setVal('pr_memo', '');
  document.getElementById('prSearchResults')?.classList.remove('is-open');
  openModal('prModal');
  setTimeout(function() {
    if (!_prItemGrid) initPrItemGrid();
    clearPrItemGrid();
    if (_prItemGrid) _prItemGrid.sizeColumnsToFit();

    // 안전재고 자동채우기
    if (alerts && alerts.length) {
      var rows = alerts.map(function(a) {
        var needQty = a.reorder_qty > 0 ? a.reorder_qty : Math.abs(a.shortage || 1);
        return {
          item_id:     a.item_id,
          item_code:   a.item_code,
          item_name:   a.item_name,
          request_qty: needQty,
          use_unit:    a.use_unit || '',
          memo:        '안전재고 기준 자동요청 (현재고:' + a.current_qty + ')',
        };
      });
      if (_prItemGrid) _prItemGrid.setGridOption('rowData', rows);
    }
  }, 50);
}

async function savePr() {
  var itemRows = [];
  _prItemGrid?.forEachNode(function(node) {
    var d = node.data;
    if (!d.item_id) return;
    itemRows.push({
      item_id:     d.item_id,
      request_qty: Math.max(1, Number(d.request_qty || 1)),
      use_unit:    d.use_unit || '',
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
    onGridReady: function(params) { params.api.sizeColumnsToFit(); },
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
        _prDetailGrid.sizeColumnsToFit();
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
    var { data: dept } = await supabaseClient
      .from('departments').select('id').eq('dept_code', user.team_code).maybeSingle();
    myDeptId = dept?.id || null;
  }
}

/* ── 초기화 ── */
async function init() {
  var session = await auth.requireAuth();
  if (!session) return;
  currentUser = await auth.getSession();

  initStatusTabs();
  initPrListGrid();

  document.getElementById('addPrBtn')?.addEventListener('click', openAddPr);
  document.getElementById('prSearchBtn')?.addEventListener('click', searchItems);
  document.getElementById('pr_search_kw')?.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') { e.preventDefault(); searchItems(); }
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
═══════════════════════════════════════════════════════ */

var _ssItems    = [];   // 전체 품목 + 현재고 + 기존 설정
var _ssFiltered = [];   // 필터링된 목록
var _ssMyDeptId = null;

async function getMyDeptId() {
  if (_ssMyDeptId) return _ssMyDeptId;
  var session = await supabaseClient.auth.getSession();
  var userId  = session.data?.session?.user?.id;
  if (!userId) return null;

  var { data: profile } = await supabaseClient
    .from('user_profiles').select('team_name').eq('id', userId).single();
  if (!profile?.team_name) return null;

  var { data: dept } = await supabaseClient
    .from('departments').select('id').eq('dept_name', profile.team_name).single();
  _ssMyDeptId = dept?.id || null;
  return _ssMyDeptId;
}

async function openSsSetting() {
  var deptId = await getMyDeptId();
  if (!deptId) { alert('소속 부서 정보가 없습니다.'); return; }

  showGlobalLoading('안전재고 설정을 불러오는 중...');
  try {
    // 전체 품목
    var { data: items } = await supabaseClient
      .from('items').select('id, item_code, item_name, category, use_unit').eq('active', 'Y')
      .order('category').order('item_name');

    // 내 부서 현재고
    var { data: stocks } = await supabaseClient
      .from('stock_current').select('item_id, qty').eq('dept_id', deptId);

    // 기존 설정
    var { data: settings } = await supabaseClient
      .from('dept_item_settings')
      .select('id, item_id, safety_stock, reorder_qty')
      .eq('dept_id', deptId).eq('active', 'Y');

    var stockMap   = {};
    (stocks   || []).forEach(function(s) { stockMap[s.item_id]   = s.qty; });
    var settingMap = {};
    (settings || []).forEach(function(s) { settingMap[s.item_id] = s; });

    _ssItems = (items || []).map(function(i) {
      return {
        id:          i.id,
        item_code:   i.item_code,
        item_name:   i.item_name,
        category:    i.category || '-',
        use_unit:    i.use_unit || '',
        current_qty: stockMap[i.id] || 0,
        safety_stock:  settingMap[i.id]?.safety_stock ?? 0,
        reorder_qty:   settingMap[i.id]?.reorder_qty  ?? 0,
        setting_id:    settingMap[i.id]?.id || null,
        changed:       false,
      };
    });

    // 카테고리 필터 옵션
    var cats = [...new Set(_ssItems.map(function(i){ return i.category; }))].sort();
    var catSel = document.getElementById('ssCategoryFilter');
    catSel.innerHTML = '<option value="">전체 카테고리</option>' +
      cats.map(function(c){ return '<option value="' + c + '">' + c + '</option>'; }).join('');

    document.getElementById('ssKeyword').value = '';
    _ssFiltered = _ssItems.slice();
    renderSsTable(_ssFiltered);
    updateSsFootInfo();

    document.getElementById('ssModal').classList.add('is-open');
  } catch(e) {
    alert('설정 로드 실패: ' + e.message);
  } finally {
    hideGlobalLoading();
  }
}

function closeSsSetting() {
  if (document.getElementById('ssModal').contains(document.activeElement)) document.body.focus();
  document.getElementById('ssModal').classList.remove('is-open');
}

function renderSsTable(rows) {
  var tbody = document.getElementById('ssTableBody');
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:32px;color:#9ca3af;">항목이 없습니다.</td></tr>';
    return;
  }
  tbody.innerHTML = rows.map(function(r) {
    var low = r.current_qty <= r.safety_stock;
    var qtyClass = low ? 'ss-stock-low' : 'ss-stock-ok';
    return '<tr data-id="' + r.id + '">' +
      '<td><input type="checkbox" class="ss-row-check" data-id="' + r.id + '" /></td>' +
      '<td style="font-family:Consolas,monospace;font-size:11px;color:#6b7280;">' + r.item_code + '</td>' +
      '<td style="font-weight:600;">' + r.item_name + '</td>' +
      '<td><span style="background:#f3f4f6;color:#374151;padding:1px 6px;border-radius:4px;font-size:10px;">' + r.category + '</span></td>' +
      '<td style="color:#6b7280;">' + r.use_unit + '</td>' +
      '<td style="text-align:right;" class="' + qtyClass + '">' + r.current_qty.toLocaleString('ko-KR') + '</td>' +
      '<td style="text-align:center;"><input type="number" class="ss-input" min="0" value="' + r.safety_stock + '" data-field="safety_stock" data-id="' + r.id + '" /></td>' +
      '<td style="text-align:center;"><input type="number" class="ss-input" min="0" value="' + r.reorder_qty + '" placeholder="자동" data-field="reorder_qty" data-id="' + r.id + '" /></td>' +
      '</tr>';
  }).join('');

  // input 이벤트 — 변경 추적
  tbody.querySelectorAll('.ss-input').forEach(function(inp) {
    inp.addEventListener('change', function() {
      var id    = this.dataset.id;
      var field = this.dataset.field;
      var item  = _ssItems.find(function(i){ return i.id === id; });
      if (item) { item[field] = parseInt(this.value) || 0; item.changed = true; }
    });
  });
}

function filterSsTable(kw) {
  kw = (kw || '').toLowerCase();
  var cat = document.getElementById('ssCategoryFilter')?.value || '';
  _ssFiltered = _ssItems.filter(function(r) {
    var matchKw  = !kw  || r.item_name.toLowerCase().includes(kw) || r.item_code.toLowerCase().includes(kw);
    var matchCat = !cat || r.category === cat;
    return matchKw && matchCat;
  });
  renderSsTable(_ssFiltered);
}

function toggleSsAll(checked) {
  document.querySelectorAll('.ss-row-check').forEach(function(cb){ cb.checked = checked; });
}

function updateSsFootInfo() {
  var changed = _ssItems.filter(function(i){ return i.changed; }).length;
  var el = document.getElementById('ssFootInfo');
  if (el) el.textContent = changed ? '변경된 항목 ' + changed + '개' : '저장되지 않은 변경 없음';
}

async function saveSsAll() {
  var deptId = await getMyDeptId();
  if (!deptId) return;

  var toSave = _ssItems.filter(function(i){ return i.changed || i.safety_stock > 0 || i.reorder_qty > 0; });
  if (!toSave.length) { alert('저장할 항목이 없습니다.'); return; }

  showGlobalLoading('안전재고 설정을 저장하는 중...');
  try {
    var upsertData = toSave.map(function(i) {
      return {
        dept_id:      deptId,
        item_id:      i.id,
        safety_stock: i.safety_stock,
        reorder_qty:  i.reorder_qty,
        active:       'Y',
      };
    });

    var { error } = await supabaseClient
      .from('dept_item_settings')
      .upsert(upsertData, { onConflict: 'dept_id,item_id' });
    if (error) throw new Error(error.message);

    _ssItems.forEach(function(i){ i.changed = false; });
    updateSsFootInfo();
    alert('안전재고 설정이 저장됐습니다.');
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
      .lt('shortage', 0);  // shortage < 0 = 현재고 < 안전재고

    if (error) throw new Error(error.message);
    if (!alerts || !alerts.length) {
      alert('현재 안전재고 이하인 품목이 없습니다.');
      return;
    }

    // 부족 품목 목록 확인 후 발주요청 모달 열기
    var msg = '아래 ' + alerts.length + '개 품목이 안전재고 이하입니다.\n발주요청서에 자동으로 추가할까요?\n\n' +
      alerts.slice(0, 10).map(function(a) {
        var needQty = a.reorder_qty > 0 ? a.reorder_qty : Math.abs(a.shortage);
        return '· ' + a.item_name + ' (현재고:' + a.current_qty + ', 안전재고:' + a.safety_stock + ', 요청수량:' + needQty + a.use_unit + ')';
      }).join('\n') +
      (alerts.length > 10 ? '\n... 외 ' + (alerts.length - 10) + '개' : '');

    if (!confirm(msg)) return;

    // 발주요청 모달 열고 품목 자동 추가
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
});
