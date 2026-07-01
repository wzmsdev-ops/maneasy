/**
 * assets/js/signage/history.js
 * 사인물 신청내역 — 일반 사용자: 본인 신청 조회/취소
 *                  signage/history 권한레벨이 manager/admin인 사용자: 전체 조회 + 상태 처리
 */
'use strict';

var shState = { page: 1, pageSize: 20, totalPages: 1, loading: false, statusFilter: '', scope: 'all' };
var _shListGrid = null;
var currentUser = null;
var canManage = false;

var STATUS_LABEL = { REQUESTED:'접수', PROCESSING:'진행중', COMPLETED:'완료', REJECTED:'반려', CANCELLED:'취소' };
var STATUS_BADGE = { REQUESTED:'badge-requested', PROCESSING:'badge-processing', COMPLETED:'badge-completed', REJECTED:'badge-rejected', CANCELLED:'badge-cancelled' };
var NEXT_STATUS = {
  REQUESTED:  [{ to:'PROCESSING', label:'제작 접수', cls:'btn-primary' }, { to:'REJECTED', label:'반려', cls:'btn-danger' }],
  PROCESSING: [{ to:'COMPLETED', label:'제작 완료', cls:'btn-primary' }, { to:'REJECTED', label:'반려', cls:'btn-danger' }],
  COMPLETED:  [],
  REJECTED:   [{ to:'PROCESSING', label:'재접수', cls:'btn-primary' }],
  CANCELLED:  [],
};

function ts(v) { return String(v == null ? '' : v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function val(id) { return (document.getElementById(id)?.value || '').trim(); }
function setVal(id, v) { var el = document.getElementById(id); if (el) el.value = v ?? ''; }
function fmtN(n) { return Number(n || 0).toLocaleString('ko-KR'); }
function fmtDate(v) { return v ? String(v).slice(0, 10) : '-'; }
function typeLabel(t) { return t === 'NAMEPLATE' ? '규격 명판' : '일반 사인물'; }
function badgeStatus(s) { return '<span class="' + (STATUS_BADGE[s] || 'badge-requested') + '">' + (STATUS_LABEL[s] || ts(s)) + '</span>'; }
function openModal(id) { document.getElementById(id)?.classList.add('is-open'); }
function closeModal(id) { document.getElementById(id)?.classList.remove('is-open'); }
window.closeModal = closeModal;

/* 사용자의 signage/history 권한 레벨로 관리 가능 여부 판단.
   page_perms가 직접 설정돼 있으면 그 값을, 비어있으면(역할 기본값 모드) role로 판단. */
function computeCanManage(user) {
  var level;
  if (user.page_perms && Object.keys(user.page_perms).length) {
    level = user.page_perms['signage/history'];
  } else {
    level = user.role === 'admin' ? 'admin' : (user.role === 'manager' ? 'manager' : 'user');
  }
  return level === 'admin' || level === 'manager';
}

function initShListGrid() {
  var cols = [
    { headerName: '신청번호', field: 'request_no', width: 150,
      headerClass: 'ag-left-header', cellStyle: { display:'flex', alignItems:'center', justifyContent:'flex-start' },
      cellRenderer: function(p) { return '<code style="font-size:11px;">' + ts(p.value || '-') + '</code>'; }
    },
    { headerName: '신청일', field: 'created_at', width: 100, cellRenderer: function(p) { return fmtDate(p.value); } },
    { headerName: '종류', field: 'type', width: 90, cellRenderer: function(p) { return '<span class="badge-type">' + typeLabel(p.value) + '</span>'; } },
  ];
  if (canManage) {
    cols.push({ headerName: '부서', field: 'departments', width: 110,
      headerClass: 'ag-left-header', cellStyle: { display:'flex', alignItems:'center', justifyContent:'flex-start' },
      cellRenderer: function(p) { return ts(p.value?.dept_name || '-'); }
    });
  }
  cols.push({ headerName: '제목', field: 'request_title', flex: 1, minWidth: 160,
    headerClass: 'ag-left-header', cellStyle: { display:'flex', alignItems:'center', justifyContent:'flex-start' },
    cellRenderer: function(p) {
      var urgent = p.data.is_urgent === 'Y' ? '<span class="badge-urgent">긴급</span>' : '';
      return ts(p.value || '-') + urgent;
    }
  });
  if (canManage) cols.push({ headerName: '신청자', field: 'requester_name', width: 90 });
  cols.push({ headerName: '상태', field: 'status', width: 90, cellRenderer: function(p) { var s = document.createElement('span'); s.innerHTML = badgeStatus(p.value); return s; } });
  cols.push({ headerName: '', width: 90, sortable: false,
    cellRenderer: function(p) {
      var btn = document.createElement('button');
      btn.className = 'tbl-btn'; btn.textContent = '상세';
      btn.onclick = function() { openShDetail(p.data.id); };
      return btn;
    }
  });

  _shListGrid = createMgGrid('shGrid', cols, [], { noRowsText: '조건에 맞는 신청이 없습니다.' });
}

async function loadShList(page) {
  if (shState.loading) return;
  shState.loading = true;
  page = page || shState.page;
  showGlobalLoading('목록을 불러오는 중...');
  try {
    var from = (page - 1) * shState.pageSize;
    var to   = from + shState.pageSize - 1;
    var dateFrom = val('shDateFrom');
    var dateTo   = val('shDateTo');
    var keyword  = val('shKeyword');

    var selectCols = canManage ? '*, departments(dept_name)' : '*';
    var q = supabaseClient.from('signage_requests').select(selectCols, { count: 'exact' })
      .order('created_at', { ascending: false }).range(from, to);

    if (!canManage || shState.scope === 'mine') q = q.eq('requester_id', currentUser.id);
    if (shState.statusFilter) q = q.eq('status', shState.statusFilter);
    if (dateFrom) q = q.gte('created_at', dateFrom);
    if (dateTo)   q = q.lte('created_at', dateTo + 'T23:59:59');
    if (keyword) {
      q = canManage
        ? q.or('request_title.ilike.%' + keyword + '%,request_no.ilike.%' + keyword + '%,requester_name.ilike.%' + keyword + '%')
        : q.or('request_title.ilike.%' + keyword + '%,request_no.ilike.%' + keyword + '%');
    }

    var { data, error, count } = await q;
    if (error) throw new Error(error.message);

    shState.page = page;
    shState.totalPages = Math.max(1, Math.ceil((count || 0) / shState.pageSize));
    var label = document.getElementById('shCountLabel');
    if (label) label.textContent = '총 ' + (count || 0) + '건';

    updateMgGrid(_shListGrid, data || []);
    renderPagination();
    if (canManage) refreshRequestedCount();
  } catch(e) {
    alert('목록 로드 실패: ' + e.message);
  } finally {
    shState.loading = false;
    hideGlobalLoading();
  }
}

async function refreshRequestedCount() {
  var q = supabaseClient.from('signage_requests').select('id', { count: 'exact', head: true }).eq('status', 'REQUESTED');
  if (shState.scope === 'mine') q = q.eq('requester_id', currentUser.id);
  var { count } = await q;
  var el = document.getElementById('shCnt_REQUESTED');
  if (!el) return;
  if (count > 0) { el.textContent = count; el.style.display = ''; } else { el.style.display = 'none'; }
}

function renderPagination() {
  var container = document.getElementById('shPagination');
  if (!container) return;
  var page = shState.page, totalPages = shState.totalPages;
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
      if (p && p !== shState.page) loadShList(p);
    });
  });
}

function initStatusTabs() {
  document.querySelectorAll('.sh-status-tab').forEach(function(btn) {
    btn.addEventListener('click', function() {
      document.querySelectorAll('.sh-status-tab').forEach(function(b) { b.classList.remove('active'); });
      btn.classList.add('active');
      shState.statusFilter = btn.dataset.status || '';
      loadShList(1);
    });
  });
}

function initScopeToggle() {
  if (!canManage) return;
  document.getElementById('shScopeToggle').style.display = '';
  document.querySelectorAll('#shScopeToggle button').forEach(function(btn) {
    btn.addEventListener('click', function() {
      document.querySelectorAll('#shScopeToggle button').forEach(function(b) { b.classList.remove('active'); });
      btn.classList.add('active');
      shState.scope = btn.dataset.scope;
      document.getElementById('shCardTitle').textContent = shState.scope === 'mine' ? '내 사인물 신청 목록' : '전체 사인물 신청 목록';
      loadShList(1);
    });
  });
}

function mkSection(icon, title, rows) {
  return '<div class="sh-detail-section">' +
    '<div class="sh-detail-section-head"><i class="ti ' + icon + '"></i>' + title + '</div>' +
    '<div class="sh-detail-meta">' + rows + '</div></div>';
}
function mkRow(label, value, full) {
  return '<div class="sh-detail-meta-item' + (full ? ' full' : '') + '">' +
    '<span class="sh-detail-meta-label">' + label + '</span>' +
    '<span class="sh-detail-meta-value">' + value + '</span></div>';
}

async function openShDetail(id) {
  showGlobalLoading('상세 정보를 불러오는 중...');
  try {
    var { data: sr, error: e1 } = await supabaseClient
      .from('signage_requests').select('*, clinics(clinic_name), departments(dept_name)').eq('id', id).single();
    if (e1) throw new Error(e1.message);

    var { data: files } = await supabaseClient
      .from('signage_files').select('*').eq('request_id', id).order('sort_order');

    // ── 섹션1: 신청 기본정보
    var basicRows =
      mkRow('신청번호', '<code style="font-size:12px;">' + ts(sr.request_no) + '</code>') +
      mkRow('상태', badgeStatus(sr.status) + (sr.is_urgent === 'Y' ? '<span class="badge-urgent" style="margin-left:6px;">긴급</span>' : '')) +
      mkRow('종류', '<span class="badge-type">' + typeLabel(sr.type) + '</span>') +
      mkRow('신청일', fmtDate(sr.created_at)) +
      mkRow('의원', ts(sr.clinics?.clinic_name || '-')) +
      mkRow('부서', ts(sr.departments?.dept_name || '-')) +
      mkRow('신청자', ts(sr.requester_name || '-')) +
      mkRow('연락처', ts(sr.contact || '-')) +
      mkRow('수량', fmtN(sr.quantity) + '개') +
      (sr.draft_confirm === 'Y' ? mkRow('시안 확인', '요청함') : '') +
      mkRow('제목', ts(sr.request_title || '-'), true);
    if (sr.is_urgent === 'Y') basicRows += mkRow('긴급 사유', ts(sr.urgent_reason || '-'), true);

    // ── 섹션2: 상세
    var detailRows = '';
    if (sr.type === 'SIGN') {
      detailRows =
        mkRow('사이즈', ts(sr.sign_size || '-')) +
        mkRow('형태/종류', ts(sr.sign_type || '-')) +
        mkRow('설치 환경', sr.install_env === 'INDOOR' ? '실내' : sr.install_env === 'OUTDOOR' ? '실외' : '-') +
        mkRow('설치 위치', ts(sr.install_location || '-')) +
        mkRow('상세내역', ts(sr.text_content || '-'), true);
    } else {
      detailRows =
        mkRow('명판 타입', ts(sr.nameplate_type || '-')) +
        mkRow('규격', ts(sr.sign_size || '-')) +
        mkRow('명판 문구', ts(sr.nameplate_text || '-'), true);
    }

    // ── 섹션3: 처리 정보 (메모 있을 때만)
    var processSection = '';
    if (sr.admin_memo) {
      processSection = mkSection('ti-message', '처리 메모',
        mkRow('메모', ts(sr.admin_memo), true));
    }

    var html =
      mkSection('ti-info-circle', '신청 정보', basicRows) +
      mkSection(sr.type === 'SIGN' ? 'ti-sign-right' : 'ti-id-badge',
        sr.type === 'SIGN' ? '일반 사인물 상세' : '규격 명판 상세', detailRows) +
      processSection;

    document.getElementById('shDetailMeta').innerHTML = html;
    document.getElementById('shDetailTitle').textContent = sr.request_no;

    // 첨부파일
    if (files && files.length) {
      var now = new Date();
      var links = await Promise.all(files.map(async function(f) {
        var createdAt = new Date(f.created_at);
        var expiresAt = new Date(createdAt.getTime() + 7 * 24 * 60 * 60 * 1000);
        var daysLeft = Math.ceil((expiresAt - now) / (24 * 60 * 60 * 1000));
        var expired = daysLeft <= 0;

        var badge = '';
        if (expired) {
          badge = '<span style="padding:1px 7px;border-radius:999px;font-size:10px;font-weight:700;background:#f3f4f6;color:#9ca3af;">만료됨</span>';
        } else if (daysLeft <= 2) {
          badge = '<span style="padding:1px 7px;border-radius:999px;font-size:10px;font-weight:700;background:#fee2e2;color:#dc2626;">D-' + daysLeft + '</span>';
        } else if (daysLeft <= 5) {
          badge = '<span style="padding:1px 7px;border-radius:999px;font-size:10px;font-weight:700;background:#fef3c7;color:#92400e;">D-' + daysLeft + '</span>';
        } else {
          badge = '<span style="padding:1px 7px;border-radius:999px;font-size:10px;font-weight:700;background:#f0f2f5;color:#6b7280;">D-' + daysLeft + '</span>';
        }

        var downloadBtn = '';
        if (!expired) {
          var url = await db.getSignedUrl('signage-files', f.storage_path);
          if (url) downloadBtn = '<a href="' + url + '" target="_blank" class="btn btn-sm"><i class="ti ti-download"></i> 다운로드</a>';
        }

        return '<div class="sh-file-item">' +
          '<span style="display:flex;align-items:center;gap:8px;">' +
          '<i class="ti ti-paperclip" style="color:#9ca3af;font-size:14px;"></i>' +
          ts(f.file_name) + '</span>' +
          '<span style="display:flex;align-items:center;gap:8px;">' + badge + downloadBtn + '</span>' +
          '</div>';
      }));

      filesWrap.innerHTML =
        '<div class="sh-detail-section" style="margin-bottom:10px;">' +
        '<div class="sh-detail-section-head"><i class="ti ti-paperclip"></i>첨부파일 ' +
        '<span style="margin-left:4px;background:#e5e7eb;border-radius:999px;padding:0 6px;font-size:10px;">' + files.length + '</span>' +
        '<span style="margin-left:auto;font-size:10px;color:#9ca3af;font-weight:400;">접수일로부터 7일간 보관</span></div>' +
        links.join('') + '</div>';
    } else {
      filesWrap.innerHTML = '';
    }

    // 처리 액션
    var actionsEl = document.getElementById('shStatusActions');
    var memoSection = document.getElementById('shMemoSection');
    var isOwner = sr.requester_id === currentUser.id;

    if (canManage) {
      memoSection.style.display = '';
      setVal('sh_admin_memo', sr.admin_memo || '');
      var actions = NEXT_STATUS[sr.status] || [];
      actionsEl.innerHTML = actions.map(function(a) {
        return '<button class="btn btn-sm ' + a.cls + '" data-to="' + a.to + '">' + a.label + '</button>';
      }).join('');
      actionsEl.querySelectorAll('button[data-to]').forEach(function(btn) {
        btn.addEventListener('click', function() { updateSrStatus(id, btn.dataset.to); });
      });
    } else {
      memoSection.style.display = 'none';
      var canCancel = isOwner && sr.status === 'REQUESTED';
      actionsEl.innerHTML = canCancel ? '<button class="btn btn-sm btn-danger" id="shCancelBtn">신청 취소</button>' : '';
      if (canCancel) document.getElementById('shCancelBtn').addEventListener('click', function() { cancelSr(id); });
    }

    openModal('shDetailModal');
  } catch(e) {
    alert('상세 조회 실패: ' + e.message);
  } finally {
    hideGlobalLoading();
  }
}

async function updateSrStatus(id, toStatus) {
  var label = STATUS_LABEL[toStatus] || toStatus;
  if (!confirm('상태를 [' + label + ']로 변경하시겠습니까?')) return;
  showGlobalLoading('상태를 변경하는 중...');
  try {
    var patch = {
      status: toStatus,
      admin_memo: val('sh_admin_memo'),
      processed_by: currentUser.id,
      processed_at: new Date().toISOString(),
    };
    var { error } = await supabaseClient.from('signage_requests').update(patch).eq('id', id);
    if (error) throw new Error(error.message);
    closeModal('shDetailModal');
    await loadShList(shState.page);
  } catch(e) {
    alert('상태 변경 실패: ' + e.message);
  } finally {
    hideGlobalLoading();
  }
}

async function cancelSr(id) {
  if (!confirm('신청을 취소하시겠습니까?')) return;
  var { error } = await supabaseClient.from('signage_requests').update({ status: 'CANCELLED' }).eq('id', id);
  if (error) { alert('취소 실패: ' + error.message); return; }
  closeModal('shDetailModal');
  await loadShList(shState.page);
}

async function init() {
  var session = await auth.requireAuth();
  if (!session) return;
  currentUser = await auth.getSession();
  canManage = computeCanManage(currentUser);

  document.getElementById('shCardTitle').textContent = canManage ? '전체 사인물 신청 목록' : '내 사인물 신청 목록';
  shState.scope = canManage ? 'all' : 'mine';

  var today = new Date();
  var rangeStart = new Date(today);
  rangeStart.setDate(today.getDate() - (canManage ? 30 : 7));
  setVal('shDateFrom', rangeStart.toISOString().slice(0, 10));
  setVal('shDateTo', today.toISOString().slice(0, 10));

  initStatusTabs();
  initScopeToggle();
  initShListGrid();

  document.getElementById('shSearchBtn')?.addEventListener('click', function() { loadShList(1); });
  document.getElementById('shKeyword')?.addEventListener('keydown', function(e) { if (e.key === 'Enter') loadShList(1); });

  await loadShList(1);
}

document.addEventListener('DOMContentLoaded', init);
