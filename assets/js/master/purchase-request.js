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
function openAddPr() {
  setVal('pr_search_kw', '');
  setVal('pr_memo', '');
  document.getElementById('prSearchResults')?.classList.remove('is-open');
  openModal('prModal');
  setTimeout(function() {
    if (!_prItemGrid) initPrItemGrid();
    clearPrItemGrid();
    if (_prItemGrid) _prItemGrid.sizeColumnsToFit();
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
