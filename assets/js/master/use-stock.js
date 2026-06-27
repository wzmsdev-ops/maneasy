/**
 * use-stock.js
 * 부서 직원용 사용처리 — 본인 부서 재고만 조회/처리
 */
'use strict';

var currentUser = null;
var myDeptId    = null;
var myDeptName  = '';
var stockCache  = [];   // 내 부서 현재고

var _gridStock = null;
var _gridUse   = null;

var usePage      = 1;
var usePageSize  = 15;
var useTotalPages = 1;

/* ── 유틸 ─────────────────────────────────── */
function ts(v)  { return String(v == null ? '' : v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function val(id){ return (document.getElementById(id)?.value || '').trim(); }
function setVal(id, v) { var el = document.getElementById(id); if (el) el.value = v ?? ''; }
function fmtDate(v) { return v ? String(v).slice(0, 10) : '-'; }
function fmtN(v)    { return Number(v || 0).toLocaleString('ko-KR'); }

/* ── 현재고 그리드 ─────────────────────────── */
function initStockGrid() {
  var colDefs = [
    { headerName: '자재명', field: 'items', flex: 2, minWidth: 140,
      headerClass: 'ag-left-header',
      cellStyle: { display:'flex', alignItems:'center', justifyContent:'flex-start', fontWeight:600 },
      cellRenderer: function(p) { return ts(p.value?.item_name || '-'); }
    },
    { headerName: '카테고리', flex: 1, minWidth: 80,
      valueGetter: function(p) { return p.data.items?.category || '-'; }
    },
    { headerName: '현재고', field: 'qty', flex: 0, width: 90,
      cellStyle: { display:'flex', alignItems:'center', justifyContent:'flex-end' },
      cellRenderer: function(p) {
        var color = p.value <= 0 ? '#dc2626' : '#111827';
        return '<span style="color:' + color + ';font-weight:700;">' + fmtN(p.value) + '</span>';
      }
    },
    { headerName: '단위', flex: 0, width: 70,
      valueGetter: function(p) { return p.data.items?.use_unit || p.data.items?.unit || '-'; }
    },
    { headerName: '재주문점', flex: 0, width: 80,
      valueGetter: function(p) { return p.data.items?.reorder_point != null ? fmtN(p.data.items.reorder_point) : '-'; },
      cellRenderer: function(p) {
        var rp = p.data.items?.reorder_point;
        if (rp == null) return '-';
        var isLow = p.data.qty <= rp;
        return '<span style="color:' + (isLow ? '#dc2626' : '#6b7280') + ';">' + fmtN(rp) + (isLow ? ' ⚠' : '') + '</span>';
      }
    },
  ];
  _gridStock = createMgGrid('stockGrid', colDefs, [], { noRowsText: '보유 재고가 없습니다.' });
}

async function loadMyStock() {
  if (!_gridStock) initStockGrid();
  if (!myDeptId) { if (_gridStock) _gridStock.setGridOption('rowData', []); return; }
  var { data, error } = await supabaseClient
    .from('stock_current')
    .select('item_id, qty, items(item_name, category, use_unit, unit, reorder_point)')
    .eq('dept_id', myDeptId)
    .order('qty', { ascending: false });
  if (error) { console.error(error); return; }
  stockCache = data || [];
  if (_gridStock) _gridStock.setGridOption('rowData', stockCache);

  // 사용처리 모달 자재 select 업데이트
  var sel = document.getElementById('m_item_id');
  if (sel) {
    sel.innerHTML = '<option value="">자재를 선택하세요</option>' +
      stockCache
        .filter(function(r) { return r.qty > 0; })
        .map(function(r) {
          return '<option value="' + r.item_id + '" data-qty="' + r.qty + '" data-unit="' + ts(r.items?.use_unit || r.items?.unit || '') + '">' +
            ts(r.items?.item_name || '-') + ' (재고 ' + fmtN(r.qty) + ')</option>';
        }).join('');
  }
}

/* ── 사용처리 이력 그리드 ─────────────────── */
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

/* ── 사용처리 모달 ─────────────────────────── */
function openUseModal() {
  setVal('m_item_id', '');
  setVal('m_use_date', new Date().toISOString().slice(0, 10));
  setVal('m_qty', '1');
  setVal('m_memo', '');
  document.getElementById('itemInfoRow').style.display = 'none';
  document.getElementById('useModal').classList.add('is-open');
}

function closeUseModal() {
  if (document.getElementById('useModal').contains(document.activeElement)) {
    document.body.focus();
  }
  document.getElementById('useModal').classList.remove('is-open');
}

function onItemChange() {
  var sel = document.getElementById('m_item_id');
  var opt = sel?.selectedOptions?.[0];
  var row = document.getElementById('itemInfoRow');
  if (opt && opt.value) {
    document.getElementById('infoUnit').textContent = opt.dataset.unit || '-';
    document.getElementById('infoQty').textContent  = fmtN(opt.dataset.qty || 0) + ' ' + (opt.dataset.unit || '');
    row.style.display = '';
  } else {
    row.style.display = 'none';
  }
}

async function saveUse() {
  var itemId = val('m_item_id');
  if (!itemId)   { alert('자재를 선택해주세요.'); return; }
  if (!myDeptId) { alert('소속 부서 정보가 없습니다.'); return; }

  var sel     = document.getElementById('m_item_id');
  var opt     = sel?.selectedOptions?.[0];
  var useUnit = opt?.dataset?.unit || '';
  var current = Number(opt?.dataset?.qty || 0);
  var qty     = Number(val('m_qty') || 0);

  if (qty < 1)       { alert('사용 수량은 1 이상이어야 합니다.'); return; }
  if (qty > current) { alert('사용 수량(' + qty + ')이 현재고(' + fmtN(current) + ')를 초과합니다.'); return; }

  var btn = document.getElementById('useSaveBtn');
  btn.disabled = true;
  showGlobalLoading('사용처리 중...');
  try {
    var { data: session } = await supabaseClient.auth.getSession();
    var userId = session?.session?.user?.id || null;

    var { error } = await supabaseClient.from('stock_transactions').insert({
      item_id:    itemId,
      dept_id:    myDeptId,
      tx_type:    'OUT',
      tx_date:    val('m_use_date'),
      qty:        -qty,
      use_unit:   useUnit,
      ref_type:   'use',
      memo:       val('m_memo'),
      created_by: userId,
    });
    if (error) throw new Error(error.message);

    // 부서 현재고 차감 (item_id, dept_id 스코프)
    var { data: row } = await supabaseClient
      .from('stock_current').select('id, qty')
      .eq('item_id', itemId).eq('dept_id', myDeptId).maybeSingle();
    if (!row) throw new Error('부서 재고 정보를 찾을 수 없습니다.');
    var { error: updErr } = await supabaseClient
      .from('stock_current')
      .update({ qty: row.qty - qty, last_updated_at: new Date().toISOString() })
      .eq('id', row.id);
    if (updErr) throw new Error(updErr.message);

    closeUseModal();
    await loadMyStock();
    await loadUseLog(1);
  } catch(e) {
    alert('사용처리 실패: ' + e.message);
  } finally {
    btn.disabled = false;
    hideGlobalLoading();
  }
}

/* ── 페이지네이션 ─────────────────────────── */
function renderPagination(containerId, state, loadFn) {
  var el = document.getElementById(containerId);
  if (!el) return;
  var total = state.totalPages;
  var cur   = state.page;
  if (total <= 1) { el.innerHTML = ''; return; }

  var BLOCK = 10;
  var bs = Math.floor((cur - 1) / BLOCK) * BLOCK + 1;
  var be = Math.min(total, bs + BLOCK - 1);
  var html = '';
  if (bs > 1)    html += '<button class="btn btn-sm" onclick="' + loadFn.name + '(' + (bs-1) + ')">이전</button> ';
  for (var i = bs; i <= be; i++) {
    html += '<button class="btn btn-sm' + (i === cur ? ' btn-primary' : '') + '" onclick="' + loadFn.name + '(' + i + ')">' + i + '</button> ';
  }
  if (be < total) html += '<button class="btn btn-sm" onclick="' + loadFn.name + '(' + (be+1) + ')">다음</button>';
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
    // 소속 부서 정보가 없으면 안내 배지로 표시하고 사용처리 버튼은 비활성화
    var badge2 = document.getElementById('deptBadge');
    if (badge2) {
      badge2.style.display = '';
      badge2.style.background = '#fef2f2';
      badge2.style.color = '#b91c1c';
      badge2.style.borderColor = '#fecaca';
      document.getElementById('deptBadgeText').textContent = '소속 부서 정보 없음';
    }
    var openBtn = document.getElementById('openUseBtn');
    if (openBtn) openBtn.disabled = true;
  }

  // 기본 날짜 — 시작일: 일주일 전, 종료일: 오늘 (다른 화면과 동일)
  var today = new Date();
  var weekAgo = new Date(today);
  weekAgo.setDate(today.getDate() - 7);
  setVal('dateFrom', weekAgo.toISOString().slice(0, 10));
  setVal('dateTo',   today.toISOString().slice(0, 10));

  // 모달 외부 클릭 닫기
  document.getElementById('useModal').addEventListener('click', function(e) {
    if (e.target === this) closeUseModal();
  });

  showGlobalLoading('데이터를 불러오는 중...');
  try {
    await loadMyStock();
    await loadUseLog(1);
  } catch(e) {
    console.error(e);
  } finally {
    hideGlobalLoading();
  }
});
