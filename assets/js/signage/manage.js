/**
 * assets/js/signage/manage.js
 * 사인물 관리 (자재담당자/관리자) — 전체 신청 조회 + 상태 처리
 */
'use strict';

var smState = { page: 1, pageSize: 20, totalPages: 1, loading: false, statusFilter: '' };
var _smListGrid = null;
var currentUser = null;

var STATUS_LABEL = { REQUESTED:'접수', PROCESSING:'진행중', COMPLETED:'완료', REJECTED:'반려', CANCELLED:'취소' };
var STATUS_BADGE = { REQUESTED:'badge-requested', PROCESSING:'badge-processing', COMPLETED:'badge-completed', REJECTED:'badge-rejected', CANCELLED:'badge-cancelled' };
// 처리 담당자가 누를 수 있는 다음 상태 전이
var NEXT_STATUS = {
  REQUESTED:  [{ to:'PROCESSING', label:'진행 시작', cls:'btn-primary' }, { to:'REJECTED', label:'반려', cls:'btn-danger' }],
  PROCESSING: [{ to:'COMPLETED', label:'완료 처리', cls:'btn-primary' }, { to:'REJECTED', label:'반려', cls:'btn-danger' }],
  COMPLETED:  [],
  REJECTED:   [{ to:'PROCESSING', label:'다시 진행', cls:'btn-primary' }],
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

function initSmListGrid() {
  _smListGrid = createMgGrid('smGrid', [
    { headerName: '신청번호', field: 'request_no', width: 150,
      headerClass: 'ag-left-header', cellStyle: { display:'flex', alignItems:'center', justifyContent:'flex-start' },
      cellRenderer: function(p) { return '<code style="font-size:11px;">' + ts(p.value || '-') + '</code>'; }
    },
    { headerName: '신청일', field: 'created_at', width: 100, cellRenderer: function(p) { return fmtDate(p.value); } },
    { headerName: '종류', field: 'type', width: 90, cellRenderer: function(p) { return '<span class="badge-type">' + typeLabel(p.value) + '</span>'; } },
    { headerName: '부서', field: 'departments', width: 110,
      headerClass: 'ag-left-header', cellStyle: { display:'flex', alignItems:'center', justifyContent:'flex-start' },
      cellRenderer: function(p) { return ts(p.value?.dept_name || '-'); }
    },
    { headerName: '제목', field: 'request_title', flex: 1, minWidth: 160,
      headerClass: 'ag-left-header', cellStyle: { display:'flex', alignItems:'center', justifyContent:'flex-start' },
      cellRenderer: function(p) {
        var urgent = p.data.is_urgent === 'Y' ? '<span class="badge-urgent">긴급</span>' : '';
        return ts(p.value || '-') + urgent;
      }
    },
    { headerName: '신청자', field: 'requester_name', width: 90 },
    { headerName: '상태', field: 'status', width: 90, cellRenderer: function(p) { var s = document.createElement('span'); s.innerHTML = badgeStatus(p.value); return s; } },
    { headerName: '', width: 90, sortable: false,
      cellRenderer: function(p) {
        var btn = document.createElement('button');
        btn.className = 'tbl-btn'; btn.textContent = '처리';
        btn.onclick = function() { openSmDetail(p.data.id); };
        return btn;
      }
    },
  ], [], { noRowsText: '조건에 맞는 신청이 없습니다.' });
}

async function loadSmList(page) {
  if (smState.loading) return;
  smState.loading = true;
  page = page || smState.page;
  showGlobalLoading('목록을 불러오는 중...');
  try {
    var from = (page - 1) * smState.pageSize;
    var to   = from + smState.pageSize - 1;
    var dateFrom = val('smDateFrom');
    var dateTo   = val('smDateTo');
    var keyword  = val('smKeyword');

    var q = supabaseClient
      .from('signage_requests')
      .select('*, departments(dept_name)', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, to);
    if (smState.statusFilter) q = q.eq('status', smState.statusFilter);
    if (dateFrom) q = q.gte('created_at', dateFrom);
    if (dateTo)   q = q.lte('created_at', dateTo + 'T23:59:59');
    if (keyword)  q = q.or('request_title.ilike.%' + keyword + '%,request_no.ilike.%' + keyword + '%,requester_name.ilike.%' + keyword + '%');

    var { data, error, count } = await q;
    if (error) throw new Error(error.message);

    smState.page = page;
    smState.totalPages = Math.max(1, Math.ceil((count || 0) / smState.pageSize));
    var label = document.getElementById('smCountLabel');
    if (label) label.textContent = '총 ' + (count || 0) + '건';

    updateMgGrid(_smListGrid, data || []);
    renderPagination();
    refreshRequestedCount();
  } catch(e) {
    alert('목록 로드 실패: ' + e.message);
  } finally {
    smState.loading = false;
    hideGlobalLoading();
  }
}

async function refreshRequestedCount() {
  var { count } = await supabaseClient
    .from('signage_requests').select('id', { count: 'exact', head: true }).eq('status', 'REQUESTED');
  var el = document.getElementById('smCnt_REQUESTED');
  if (!el) return;
  if (count > 0) { el.textContent = count; el.style.display = ''; } else { el.style.display = 'none'; }
}

function renderPagination() {
  var container = document.getElementById('smPagination');
  if (!container) return;
  var page = smState.page, totalPages = smState.totalPages;
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
      if (p && p !== smState.page) loadSmList(p);
    });
  });
}

function initStatusTabs() {
  document.querySelectorAll('.sm-status-tab').forEach(function(btn) {
    btn.addEventListener('click', function() {
      document.querySelectorAll('.sm-status-tab').forEach(function(b) { b.classList.remove('active'); });
      btn.classList.add('active');
      smState.statusFilter = btn.dataset.status || '';
      loadSmList(1);
    });
  });
}

function mkMetaItem(label, value, full) {
  return '<div class="sm-detail-meta-item' + (full ? ' full' : '') + '">' +
    '<span class="sm-detail-meta-label">' + label + '</span>' +
    '<span class="sm-detail-meta-value">' + value + '</span></div>';
}

async function openSmDetail(id) {
  showGlobalLoading('상세 정보를 불러오는 중...');
  try {
    var { data: sr, error: e1 } = await supabaseClient
      .from('signage_requests').select('*, clinics(clinic_name), departments(dept_name)').eq('id', id).single();
    if (e1) throw new Error(e1.message);

    var { data: files } = await supabaseClient
      .from('signage_files').select('*').eq('request_id', id).order('sort_order');

    var meta =
      mkMetaItem('신청번호', '<code>' + ts(sr.request_no) + '</code>') +
      mkMetaItem('상태', badgeStatus(sr.status) + (sr.is_urgent === 'Y' ? '<span class="badge-urgent">긴급</span>' : '')) +
      mkMetaItem('종류', typeLabel(sr.type)) +
      mkMetaItem('신청일', fmtDate(sr.created_at)) +
      mkMetaItem('의원', ts(sr.clinics?.clinic_name || '-')) +
      mkMetaItem('부서', ts(sr.departments?.dept_name || '-')) +
      mkMetaItem('신청자', ts(sr.requester_name || '-')) +
      mkMetaItem('연락처', ts(sr.contact || '-')) +
      mkMetaItem('수량', fmtN(sr.quantity) + '개') +
      mkMetaItem('제목', ts(sr.request_title || '-'), true);

    if (sr.is_urgent === 'Y') meta += mkMetaItem('긴급사유', ts(sr.urgent_reason || '-'), true);
    meta += mkMetaItem('시안컨펌요청', sr.draft_confirm === 'Y' ? '예' : '아니오');

    if (sr.type === 'SIGN') {
      meta += mkMetaItem('사이즈', ts(sr.sign_size || '-'));
      meta += mkMetaItem('형태/종류', ts(sr.sign_type || '-'));
      meta += mkMetaItem('설치환경', sr.install_env === 'INDOOR' ? '실내' : sr.install_env === 'OUTDOOR' ? '실외' : '-');
      meta += mkMetaItem('설치위치', ts(sr.install_location || '-'));
      meta += mkMetaItem('상세내역', ts(sr.text_content || '-'), true);
    } else {
      meta += mkMetaItem('명판타입', ts(sr.nameplate_type || '-'));
      meta += mkMetaItem('제작방식', sr.nameplate_method === 'NEW' ? '신규 제작' : '기존 활용');
      meta += mkMetaItem('자석부착', sr.magnet_yn === 'Y' ? '있음' : '없음');
      meta += mkMetaItem('명판문구', ts(sr.nameplate_text || '-'), true);
    }

    document.getElementById('smDetailMeta').innerHTML = meta;
    document.getElementById('smDetailTitle').textContent = '신청 처리 — ' + sr.request_no;
    setVal('sm_admin_memo', sr.admin_memo || '');

    var filesWrap = document.getElementById('smDetailFiles');
    if (files && files.length) {
      var links = await Promise.all(files.map(async function(f) {
        var url = await db.getSignedUrl('signage-files', f.storage_path);
        return '<div class="sr-file-item" style="display:flex;justify-content:space-between;padding:5px 10px;background:#fff;border:1px solid #e5e7eb;border-radius:6px;font-size:11px;margin-bottom:4px;">' +
          '<span>' + ts(f.file_name) + '</span>' +
          (url ? '<a href="' + url + '" target="_blank" class="tbl-btn">다운로드</a>' : '') + '</div>';
      }));
      filesWrap.innerHTML = '<div class="sm-detail-meta-item full"><span class="sm-detail-meta-label">첨부파일</span></div>' + links.join('');
    } else {
      filesWrap.innerHTML = '';
    }

    var actions = NEXT_STATUS[sr.status] || [];
    var actionsEl = document.getElementById('smStatusActions');
    actionsEl.innerHTML = actions.map(function(a) {
      return '<button class="btn btn-sm ' + a.cls + '" data-to="' + a.to + '">' + a.label + '</button>';
    }).join('');
    actionsEl.querySelectorAll('button[data-to]').forEach(function(btn) {
      btn.addEventListener('click', function() { updateSrStatus(id, btn.dataset.to); });
    });

    openModal('smDetailModal');
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
      admin_memo: val('sm_admin_memo'),
      processed_by: currentUser.id,
      processed_at: new Date().toISOString(),
    };
    var { error } = await supabaseClient.from('signage_requests').update(patch).eq('id', id);
    if (error) throw new Error(error.message);
    closeModal('smDetailModal');
    await loadSmList(smState.page);
  } catch(e) {
    alert('상태 변경 실패: ' + e.message);
  } finally {
    hideGlobalLoading();
  }
}

async function init() {
  var session = await auth.requireAuth();
  if (!session) return;
  currentUser = await auth.getSession();

  var today = new Date();
  var weekAgo = new Date(today);
  weekAgo.setDate(today.getDate() - 30);
  setVal('smDateFrom', weekAgo.toISOString().slice(0, 10));
  setVal('smDateTo', today.toISOString().slice(0, 10));

  initStatusTabs();
  initSmListGrid();

  document.getElementById('smSearchBtn')?.addEventListener('click', function() { loadSmList(1); });
  document.getElementById('smKeyword')?.addEventListener('keydown', function(e) { if (e.key === 'Enter') loadSmList(1); });

  await loadSmList(1);
}

document.addEventListener('DOMContentLoaded', init);
