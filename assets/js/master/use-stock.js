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
  if (!myDeptId) return;
  var { data, error } = await supabaseClient
    .from('stock_current')
    .select('item_id, qty, items(item_name, category, use_unit, unit, reorder_point)')
    .eq('dept_id', myDeptId)
    .order('qty', { ascending: false });
  if (error) { console.error(error); return; }
  stockCache = data || [];
  if (!_gridStock) initStockGrid();
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
  if (!myDeptId) return;
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

    // 현재고 업데이트 (트리거가 처리하지만 UI 즉시 반영)
    await supabaseClient.rpc ? null : null; // 트리거에 의존

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

  // 본인 부서 정보 확인
  myDeptId   = currentUser?.team_code || null;   // team_code가 dept_id로 매핑되는지 확인 필요
  myDeptName = currentUser?.team_name || '';

  // user_profiles에서 dept_id 직접 조회
  var { data: profile } = await supabaseClient
    .from('user_profiles')
    .select('team_name, department')
    .eq('id', session.user.id)
    .single();

  // departments 테이블에서 dept_name으로 id 조회
  if (profile?.team_name) {
    myDeptName = profile.team_name;
    var { data: dept } = await supabaseClient
      .from('departments')
      .select('id, dept_name')
      .eq('dept_name', profile.team_name)
      .single();
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
  }

  // 기본 날짜 (이번 달)
  var now = new Date();
  var y   = now.getFullYear();
  var m   = String(now.getMonth() + 1).padStart(2, '0');
  setVal('dateFrom', y + '-' + m + '-01');
  setVal('dateTo',   now.toISOString().slice(0, 10));

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
