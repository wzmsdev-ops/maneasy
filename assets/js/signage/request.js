/**
 * assets/js/signage/request.js
 * 사인물 신청 — 모든 로그인 사용자가 신청서 작성 + 본인 신청 이력 조회.
 * 처리(상태변경)는 자재담당자/관리자가 manage.html에서 수행한다.
 */
'use strict';

var srState = {
  page: 1, pageSize: 20, totalPages: 1, loading: false,
  statusFilter: '',
};

var _srListGrid = null;
var currentUser = null;
var myClinicId  = null;
var myClinicName = '';
var myDeptId    = null;
var myDeptName  = '';

var STATUS_LABEL = { REQUESTED:'접수', PROCESSING:'진행중', COMPLETED:'완료', REJECTED:'반려', CANCELLED:'취소' };
var STATUS_BADGE = { REQUESTED:'badge-requested', PROCESSING:'badge-processing', COMPLETED:'badge-completed', REJECTED:'badge-rejected', CANCELLED:'badge-cancelled' };

var NP_SIZES = { A:'높이 5cm (20cm/16cm)', B:'높이 4cm (20cm/18cm)', C:'높이 3cm (20cm/18cm)', D:'높이 2.5cm (20cm)' };
var NP_SUBTYPES = { A:['1','2','3','4'], B:['1','2','3','4'], C:['1','2','3','4'], D:['1','2','3','4'] };
var NP_LAYOUTS = [
  { id:'ga', label:'ㄱ 형', shape:'ㄱ', desc:'이름·영문이름', fields:['name_kor','name_eng'] },
  { id:'na', label:'ㄴ 형', shape:'ㄴ', desc:'이름·영문이름·직함', fields:['name_kor','name_eng','title'] },
  { id:'da', label:'ㄷ 형', shape:'ㄷ', desc:'이름·영문이름·직함·진료과', fields:['name_kor','name_eng','title','dept'] },
];
var NP_FIELD_META = {
  name_kor: { label:'이름 (한글)', placeholder:'예: 홍길동', required:true },
  name_eng: { label:'영문 이름',   placeholder:'예: Hong Gil-dong', required:true },
  title:    { label:'직함',        placeholder:'예: MD / G.D', required:true },
  dept:     { label:'진료과',      placeholder:'예: 내과', required:true },
};
var NAMEPLATE_IMG_BASE = '../../assets/images/nameplate/';

var MAX_SINGLE_BYTES = 10 * 1024 * 1024;
var MAX_TOTAL_BYTES  = 20 * 1024 * 1024;

var srType = '';
var srNpType = '';
var srNpSubtype = '';
var srNpLayout = null;
var srPendingFiles = { SIGN: [], NAMEPLATE: [] }; // [{ file }]

/* ── 유틸 ── */
function ts(v) { return String(v == null ? '' : v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function val(id)       { return (document.getElementById(id)?.value || '').trim(); }
function setVal(id, v) { var el = document.getElementById(id); if (el) el.value = v ?? ''; }
function fmtN(n)       { return Number(n || 0).toLocaleString('ko-KR'); }
function fmtDate(v)    { return v ? String(v).slice(0, 10) : '-'; }
function fmtSize(b)    { if (b < 1024) return b + ' B'; if (b < 1024*1024) return (b/1024).toFixed(1) + ' KB'; return (b/(1024*1024)).toFixed(1) + ' MB'; }
function typeLabel(t)  { return t === 'NAMEPLATE' ? '규격 명판' : '일반 사인물'; }
function badgeStatus(s) { return '<span class="' + (STATUS_BADGE[s] || 'badge-requested') + '">' + (STATUS_LABEL[s] || ts(s)) + '</span>'; }

function openModal(id)  { document.getElementById(id)?.classList.add('is-open'); }
function closeModal(id) { document.getElementById(id)?.classList.remove('is-open'); }
window.closeModal = closeModal;

/* ══════════════════════════════════════
   1. 목록
══════════════════════════════════════ */
function initSrListGrid() {
  _srListGrid = createMgGrid('srGrid', [
    { headerName: '신청번호', field: 'request_no', width: 150,
      headerClass: 'ag-left-header',
      cellStyle: { display:'flex', alignItems:'center', justifyContent:'flex-start' },
      cellRenderer: function(p) { return '<code style="font-size:11px;">' + ts(p.value || '-') + '</code>'; }
    },
    { headerName: '신청일', field: 'created_at', width: 100, cellRenderer: function(p) { return fmtDate(p.value); } },
    { headerName: '종류', field: 'type', width: 90,
      cellRenderer: function(p) { return '<span class="badge-type">' + typeLabel(p.value) + '</span>'; }
    },
    { headerName: '제목', field: 'request_title', flex: 1, minWidth: 160,
      headerClass: 'ag-left-header',
      cellStyle: { display:'flex', alignItems:'center', justifyContent:'flex-start' },
      cellRenderer: function(p) {
        var urgent = p.data.is_urgent === 'Y' ? '<span class="badge-urgent">긴급</span>' : '';
        return ts(p.value || '-') + urgent;
      }
    },
    { headerName: '수량', field: 'quantity', width: 70 },
    { headerName: '상태', field: 'status', width: 90,
      cellRenderer: function(p) { var s = document.createElement('span'); s.innerHTML = badgeStatus(p.value); return s; }
    },
    { headerName: '', width: 90, sortable: false,
      cellRenderer: function(p) {
        var btn = document.createElement('button');
        btn.className = 'tbl-btn'; btn.textContent = '상세';
        btn.onclick = function() { openSrDetail(p.data.id); };
        return btn;
      }
    },
  ], [], { noRowsText: '작성한 사인물 신청이 없습니다.' });
}

async function loadSrList(page) {
  if (srState.loading) return;
  srState.loading = true;
  page = page || srState.page;
  showGlobalLoading('사인물 신청 목록을 불러오는 중...');
  try {
    var from = (page - 1) * srState.pageSize;
    var to   = from + srState.pageSize - 1;
    var dateFrom = val('srDateFrom');
    var dateTo   = val('srDateTo');
    var keyword  = val('srKeyword');

    var q = supabaseClient
      .from('signage_requests')
      .select('*', { count: 'exact' })
      .eq('requester_id', currentUser.id)
      .order('created_at', { ascending: false })
      .range(from, to);
    if (srState.statusFilter) q = q.eq('status', srState.statusFilter);
    if (dateFrom) q = q.gte('created_at', dateFrom);
    if (dateTo)   q = q.lte('created_at', dateTo + 'T23:59:59');
    if (keyword)  q = q.or('request_title.ilike.%' + keyword + '%,request_no.ilike.%' + keyword + '%');

    var { data, error, count } = await q;
    if (error) throw new Error(error.message);

    srState.page = page;
    srState.totalPages = Math.max(1, Math.ceil((count || 0) / srState.pageSize));

    var label = document.getElementById('srCountLabel');
    if (label) label.textContent = '총 ' + (count || 0) + '건';

    updateMgGrid(_srListGrid, data || []);
    renderPagination();
  } catch(e) {
    alert('사인물 신청 목록 로드 실패: ' + e.message);
  } finally {
    srState.loading = false;
    hideGlobalLoading();
  }
}

function renderPagination() {
  var container = document.getElementById('srPagination');
  if (!container) return;
  var page = srState.page, totalPages = srState.totalPages;
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
      if (p && p !== srState.page) loadSrList(p);
    });
  });
}

function initStatusTabs() {
  document.querySelectorAll('.sr-status-tab').forEach(function(btn) {
    btn.addEventListener('click', function() {
      document.querySelectorAll('.sr-status-tab').forEach(function(b) { b.classList.remove('active'); });
      btn.classList.add('active');
      srState.statusFilter = btn.dataset.status || '';
      loadSrList(1);
    });
  });
}

/* ══════════════════════════════════════
   2. 신청 작성 모달
══════════════════════════════════════ */
function resetSrForm() {
  document.getElementById('signageRequestForm')?.reset();
  document.querySelectorAll('.sr-type-card, .sr-np-card, .sr-method-card, .sr-layout-card, .sr-magnet-card')
    .forEach(function(c) { c.classList.remove('is-selected'); });
  ['srSectionCommon','srSectionSign','srSectionNameplate','srNpSubSection','srNpImgWrap',
   'srMethodSection','srLayoutSection','srNpTextSection'].forEach(function(id) {
    var el = document.getElementById(id); if (el) el.style.display = 'none';
  });
  document.getElementById('srUrgentReasonField').style.display = 'none';
  setVal('sr_title', '');
  setVal('sr_requester_name', currentUser.user_name || currentUser.email);
  setVal('sr_contact', '');
  setVal('sr_quantity', '1');
  setVal('sr_is_urgent', 'N');
  setVal('sr_urgent_reason', '');
  document.getElementById('sr_draft_confirm').checked = false;
  setVal('sr_clinic_display', myClinicName || '-');
  setVal('sr_dept_display', myDeptName || '-');
  srType = ''; srNpType = ''; srNpSubtype = ''; srNpLayout = null;
  srPendingFiles = { SIGN: [], NAMEPLATE: [] };
  document.getElementById('srFileListSign').innerHTML = '';
  document.getElementById('srFileListNameplate').innerHTML = '';
}

function openAddSr() {
  resetSrForm();
  openModal('srModal');
}

function bindTypeSelector() {
  document.querySelectorAll('input[name="sr_type"]').forEach(function(radio) {
    radio.addEventListener('change', function(e) {
      srType = e.target.value;
      document.querySelectorAll('.sr-type-card').forEach(function(c) { c.classList.remove('is-selected'); });
      document.getElementById('srTypeCard_' + srType)?.classList.add('is-selected');
      document.getElementById('srSectionCommon').style.display = '';

      var titleEl = document.getElementById('sr_title');
      titleEl.placeholder = srType === 'SIGN'
        ? '예: [A3 포맥스], [바닥 스티커] 등 제작 품목명을 입력하세요.'
        : '예: [명패] MD / 홍길동 / 부인과';

      // 명판 선택 초기화
      srNpType = ''; srNpSubtype = ''; srNpLayout = null;
      document.querySelectorAll('.sr-np-card, .sr-method-card, .sr-layout-card, .sr-magnet-card')
        .forEach(function(c) { c.classList.remove('is-selected'); });
      document.getElementById('srNpSubSection').style.display = 'none';
      document.getElementById('srNpImgWrap').style.display = 'none';
      document.getElementById('srMethodSection').style.display = 'none';
      document.getElementById('srLayoutSection').style.display = 'none';
      document.getElementById('srNpTextSection').style.display = 'none';

      if (srType === 'SIGN') {
        document.getElementById('srSectionSign').style.display = '';
        document.getElementById('srSectionNameplate').style.display = 'none';
      } else {
        document.getElementById('srSectionSign').style.display = 'none';
        document.getElementById('srSectionNameplate').style.display = '';
      }
    });
  });
}

function bindUrgentToggle() {
  document.getElementById('sr_is_urgent')?.addEventListener('change', function() {
    document.getElementById('srUrgentReasonField').style.display = this.value === 'Y' ? '' : 'none';
  });
}

function bindNameplateTypeSelector() {
  document.querySelectorAll('input[name="sr_np_type"]').forEach(function(radio) {
    radio.addEventListener('change', function(e) {
      srNpType = e.target.value;
      srNpSubtype = ''; srNpLayout = null;
      document.querySelectorAll('.sr-np-card').forEach(function(c) { c.classList.remove('is-selected'); });
      document.getElementById('srNpCard_' + srNpType)?.classList.add('is-selected');

      renderSubtypeGrid(srNpType);

      document.getElementById('srNpDesignImg').src = NAMEPLATE_IMG_BASE + srNpType + '.jpeg';
      document.getElementById('srNpLayoutImg').src = NAMEPLATE_IMG_BASE + 'layout.jpeg';
      document.getElementById('srNpImgWrap').style.display = '';
      document.getElementById('srMethodSection').style.display = '';
      document.getElementById('srLayoutSection').style.display = 'none';
      document.getElementById('srNpTextSection').style.display = 'none';
    });
  });

  document.querySelectorAll('input[name="sr_np_method"]').forEach(function(radio) {
    radio.addEventListener('change', function(e) {
      document.querySelectorAll('.sr-method-card').forEach(function(c) { c.classList.remove('is-selected'); });
      document.getElementById('srMethodCard_' + e.target.value)?.classList.add('is-selected');
      renderLayoutGrid();
    });
  });

  document.querySelectorAll('input[name="sr_magnet"]').forEach(function(radio) {
    radio.addEventListener('change', function(e) {
      document.querySelectorAll('.sr-magnet-card').forEach(function(c) { c.classList.remove('is-selected'); });
      document.getElementById('srMagnetCard_' + e.target.value)?.classList.add('is-selected');
    });
  });
}

function renderSubtypeGrid(type) {
  var grid = document.getElementById('srNpSubGrid');
  var subtypes = NP_SUBTYPES[type] || [];
  grid.innerHTML = subtypes.map(function(sub) {
    return '<label class="sr-np-card" id="srSubCard_' + type + '_' + sub + '">' +
      '<input type="radio" name="sr_np_subtype" value="' + sub + '" class="sr-sr-only" />' +
      '<div class="sr-np-badge">' + type + '-' + sub + '</div></label>';
  }).join('');
  document.getElementById('srNpSubSection').style.display = '';

  grid.querySelectorAll('input[name="sr_np_subtype"]').forEach(function(radio) {
    radio.addEventListener('change', function(e) {
      srNpSubtype = e.target.value;
      grid.querySelectorAll('.sr-np-card').forEach(function(c) { c.classList.remove('is-selected'); });
      document.getElementById('srSubCard_' + type + '_' + srNpSubtype)?.classList.add('is-selected');
    });
  });
}

function renderLayoutGrid() {
  var grid = document.getElementById('srLayoutGrid');
  grid.innerHTML = NP_LAYOUTS.map(function(l) {
    return '<label class="sr-layout-card" id="srLayoutCard_' + l.id + '">' +
      '<input type="radio" name="sr_np_layout" value="' + l.id + '" class="sr-sr-only" />' +
      '<div class="sr-layout-shape">' + l.shape + '</div>' +
      '<div class="sr-layout-label">' + l.label + '</div>' +
      '<div class="sr-layout-desc">' + l.desc + '</div></label>';
  }).join('');
  document.getElementById('srLayoutSection').style.display = '';

  grid.querySelectorAll('input[name="sr_np_layout"]').forEach(function(radio) {
    radio.addEventListener('change', function(e) {
      var layoutId = e.target.value;
      srNpLayout = NP_LAYOUTS.find(function(l) { return l.id === layoutId; }) || null;
      grid.querySelectorAll('.sr-layout-card').forEach(function(c) { c.classList.remove('is-selected'); });
      document.getElementById('srLayoutCard_' + layoutId)?.classList.add('is-selected');
      renderTextFields(srNpLayout);
      document.getElementById('srNpTextSection').style.display = '';
    });
  });
}

function renderTextFields(layout) {
  var container = document.getElementById('srNpTextFields');
  if (!layout) { container.innerHTML = ''; return; }
  container.innerHTML = layout.fields.map(function(fk) {
    var meta = NP_FIELD_META[fk];
    return '<label class="form-field">' +
      '<span class="form-label ' + (meta.required ? 'required' : '') + '">' + meta.label + '</span>' +
      '<input type="text" id="srNpField_' + fk + '" class="input" placeholder="' + meta.placeholder + '" data-field="' + fk + '" /></label>';
  }).join('');
}

function buildNameplateText() {
  if (!srNpLayout) return '';
  var parts = srNpLayout.fields.map(function(fk) {
    return NP_FIELD_META[fk].label + ': ' + val('srNpField_' + fk);
  });
  return '레이아웃: ' + srNpLayout.label + '\n' + parts.join('\n');
}

/* ── 파일 첨부 ── */
function bindFileInputs() {
  bindFileInput('srFileSign', 'SIGN', 'srFileListSign');
  bindFileInput('srFileNameplate', 'NAMEPLATE', 'srFileListNameplate');
}
function bindFileInput(inputId, key, listId) {
  var input = document.getElementById(inputId);
  if (!input) return;
  input.addEventListener('change', function(e) {
    var files = Array.from(e.target.files || []);
    files.forEach(function(file) {
      if (file.size > MAX_SINGLE_BYTES) { alert('파일당 최대 10MB까지 가능합니다: ' + file.name); return; }
      var total = srPendingFiles[key].reduce(function(a,f){ return a + f.file.size; }, 0);
      if (total + file.size > MAX_TOTAL_BYTES) { alert('전체 첨부 용량은 20MB 이하만 가능합니다.'); return; }
      srPendingFiles[key].push({ file: file });
    });
    renderFileList(key, listId);
    input.value = '';
  });
}
function renderFileList(key, listId) {
  var listEl = document.getElementById(listId);
  listEl.innerHTML = srPendingFiles[key].map(function(f, idx) {
    return '<div class="sr-file-item"><span>' + ts(f.file.name) + ' (' + fmtSize(f.file.size) + ')</span>' +
      '<button type="button" class="sr-file-item-remove" data-key="' + key + '" data-idx="' + idx + '">✕</button></div>';
  }).join('');
  listEl.querySelectorAll('.sr-file-item-remove').forEach(function(btn) {
    btn.addEventListener('click', function() {
      srPendingFiles[btn.dataset.key].splice(Number(btn.dataset.idx), 1);
      renderFileList(btn.dataset.key, listId);
    });
  });
}

/* ── 제출 ── */
async function saveSr() {
  if (!srType) throw new Error('제작 종류를 선택해주세요.');
  if (!val('sr_title')) throw new Error('제목을 입력해주세요.');
  if (!val('sr_requester_name')) throw new Error('이름을 입력해주세요.');
  if (!val('sr_contact')) throw new Error('연락처를 입력해주세요.');

  var isUrgent = val('sr_is_urgent');
  if (isUrgent === 'Y' && !val('sr_urgent_reason')) throw new Error('긴급 사유를 입력해주세요.');

  var payload = {
    type: srType,
    request_title: val('sr_title'),
    clinic_id: myClinicId,
    dept_id: myDeptId,
    requester_id: currentUser.id,
    requester_name: val('sr_requester_name'),
    contact: val('sr_contact'),
    quantity: Math.max(1, Number(val('sr_quantity') || 1)),
    is_urgent: isUrgent,
    urgent_reason: val('sr_urgent_reason'),
    draft_confirm: document.getElementById('sr_draft_confirm').checked ? 'Y' : 'N',
    status: 'REQUESTED',
  };

  var pendingKey;
  if (srType === 'SIGN') {
    if (!val('sr_text_content')) throw new Error('상세내역을 입력해주세요.');
    if (!val('sr_install_env')) throw new Error('설치 환경을 선택해주세요.');
    if (!val('sr_install_location')) throw new Error('설치 위치를 입력해주세요.');
    payload.text_content = val('sr_text_content');
    payload.sign_size = val('sr_sign_size');
    payload.sign_type = val('sr_sign_type');
    payload.install_env = val('sr_install_env');
    payload.install_location = val('sr_install_location');
    pendingKey = 'SIGN';
  } else {
    if (!srNpType) throw new Error('명판 타입을 선택해주세요.');
    if (!srNpSubtype) throw new Error('세부 디자인을 선택해주세요.');
    var method = document.querySelector('input[name="sr_np_method"]:checked');
    if (!method) throw new Error('제작 방식을 선택해주세요.');
    if (!srNpLayout) throw new Error('문구 레이아웃을 선택해주세요.');
    var magnet = document.querySelector('input[name="sr_magnet"]:checked');
    if (!magnet) throw new Error('자석 부착 여부를 선택해주세요.');
    for (var i = 0; i < srNpLayout.fields.length; i++) {
      var fk = srNpLayout.fields[i];
      if (!val('srNpField_' + fk)) throw new Error(NP_FIELD_META[fk].label + '을(를) 입력해주세요.');
    }
    payload.nameplate_type = srNpType + '-' + srNpSubtype;
    payload.nameplate_method = method.value;
    payload.nameplate_text = buildNameplateText();
    payload.magnet_yn = magnet.value;
    payload.sign_size = NP_SIZES[srNpType] || '';
    pendingKey = 'NAMEPLATE';
  }

  var requestNo = await genDocNo('SR');
  payload.request_no = requestNo;

  var { data: newSr, error: ie } = await supabaseClient
    .from('signage_requests').insert(payload).select().single();
  if (ie) throw new Error(ie.message);

  // 첨부파일 업로드 (Supabase Storage signage-files)
  var files = srPendingFiles[pendingKey] || [];
  var category = srType === 'SIGN' ? 'LOCATION' : 'MAIN';
  for (var fi = 0; fi < files.length; fi++) {
    var f = files[fi].file;
    var up = await db.uploadFile('signage-files', f, newSr.id);
    await supabaseClient.from('signage_files').insert({
      request_id: newSr.id, file_category: category,
      file_name: up.name, storage_path: up.path, file_size: up.size, sort_order: fi,
    });
  }

  // GAS 알림 (fire-and-forget)
  gasNotify('signageRequestNotice', {
    request_no: newSr.request_no, type: newSr.type, request_title: newSr.request_title,
    clinic_name: myClinicName, department: myDeptName,
    requester_name: newSr.requester_name, contact: newSr.contact, quantity: newSr.quantity,
    is_urgent: newSr.is_urgent, urgent_reason: newSr.urgent_reason,
    sign_size: newSr.sign_size, text_content: newSr.text_content,
    nameplate_type: newSr.nameplate_type, nameplate_text: newSr.nameplate_text,
  });
}

/* ══════════════════════════════════════
   3. 상세 모달
══════════════════════════════════════ */
function mkMetaItem(label, value, full) {
  return '<div class="sr-detail-meta-item' + (full ? ' full' : '') + '">' +
    '<span class="sr-detail-meta-label">' + label + '</span>' +
    '<span class="sr-detail-meta-value">' + value + '</span></div>';
}

async function openSrDetail(id) {
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
    if (sr.admin_memo) meta += mkMetaItem('처리메모', ts(sr.admin_memo), true);

    document.getElementById('srDetailMeta').innerHTML = meta;
    document.getElementById('srDetailTitle').textContent = '신청 상세 — ' + sr.request_no;

    // 첨부파일 — signed URL
    var filesWrap = document.getElementById('srDetailFiles');
    if (files && files.length) {
      var links = await Promise.all(files.map(async function(f) {
        var url = await db.getSignedUrl('signage-files', f.storage_path);
        return '<div class="sr-file-item"><span>' + ts(f.file_name) + '</span>' +
          (url ? '<a href="' + url + '" target="_blank" class="tbl-btn">다운로드</a>' : '') + '</div>';
      }));
      filesWrap.innerHTML = '<div class="sr-detail-meta-item full"><span class="sr-detail-meta-label">첨부파일</span></div>' +
        '<div class="sr-file-list">' + links.join('') + '</div>';
    } else {
      filesWrap.innerHTML = '';
    }

    var foot = document.getElementById('srDetailFoot');
    var canCancel = sr.requester_id === currentUser.id && sr.status === 'REQUESTED';
    foot.innerHTML = '<button class="btn btn-sm" onclick="closeModal(\'srDetailModal\')">닫기</button>' +
      (canCancel ? '<button class="btn btn-sm btn-danger" id="srCancelBtn">신청 취소</button>' : '');
    if (canCancel) {
      document.getElementById('srCancelBtn').addEventListener('click', function() { cancelSr(id); });
    }

    openModal('srDetailModal');
  } catch(e) {
    alert('상세 조회 실패: ' + e.message);
  } finally {
    hideGlobalLoading();
  }
}

async function cancelSr(id) {
  if (!confirm('신청을 취소하시겠습니까?')) return;
  var { error } = await supabaseClient.from('signage_requests')
    .update({ status: 'CANCELLED' }).eq('id', id);
  if (error) { alert('취소 실패: ' + error.message); return; }
  closeModal('srDetailModal');
  await loadSrList(srState.page);
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
      .from('clinics').select('id, clinic_name').eq('clinic_code', user.clinic_code).maybeSingle();
    myClinicId = clinic?.id || null;
    myClinicName = clinic?.clinic_name || user.clinic_name || '';
  }
  if (user.team_code) {
    var deptQuery = supabaseClient.from('departments').select('id, dept_name').eq('dept_code', user.team_code);
    if (myClinicId) deptQuery = deptQuery.eq('clinic_id', myClinicId);
    var { data: dept } = await deptQuery.maybeSingle();
    myDeptId = dept?.id || null;
    myDeptName = dept?.dept_name || '';
  }
}

/* ── 초기화 ── */
async function init() {
  var session = await auth.requireAuth();
  if (!session) return;
  currentUser = await auth.getSession();

  var today = new Date();
  var weekAgo = new Date(today);
  weekAgo.setDate(today.getDate() - 7);
  setVal('srDateFrom', weekAgo.toISOString().slice(0, 10));
  setVal('srDateTo', today.toISOString().slice(0, 10));

  initStatusTabs();
  initSrListGrid();
  bindTypeSelector();
  bindUrgentToggle();
  bindNameplateTypeSelector();
  bindFileInputs();

  document.getElementById('addSrBtn')?.addEventListener('click', openAddSr);
  document.getElementById('srSearchBtn')?.addEventListener('click', function() { loadSrList(1); });
  document.getElementById('srKeyword')?.addEventListener('keydown', function(e) { if (e.key === 'Enter') loadSrList(1); });

  document.getElementById('srSaveBtn')?.addEventListener('click', async function() {
    var btn = this; btn.disabled = true;
    showGlobalLoading('신청서를 제출하는 중...');
    try {
      await saveSr();
      closeModal('srModal');
      await loadSrList(1);
    } catch(e) {
      alert('신청 제출 실패: ' + e.message);
    } finally {
      btn.disabled = false;
      hideGlobalLoading();
    }
  });

  showGlobalLoading('데이터를 불러오는 중...');
  try {
    await resolveMyClinicAndDept(currentUser);
    await loadSrList(1);
  } catch(e) {
    alert('초기화 실패: ' + e.message);
  } finally {
    hideGlobalLoading();
  }
}

document.addEventListener('DOMContentLoaded', init);
