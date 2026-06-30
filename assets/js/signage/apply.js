/**
 * assets/js/signage/apply.js
 * 사인물 신청 — 폼 전용 페이지. 제출 성공 시 신청내역(history) 페이지로 이동.
 */
'use strict';

var currentUser = null;
var myClinicId  = null;
var myClinicName = '';
var myDeptId    = null;
var myDeptName  = '';

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

var srType = 'SIGN';
var srNpType = '';
var srNpSubtype = '';
var srNpLayout = null;
var srPendingFiles = { SIGN: [], NAMEPLATE: [] };

function val(id)       { return (document.getElementById(id)?.value || '').trim(); }
function setVal(id, v) { var el = document.getElementById(id); if (el) el.value = v ?? ''; }
function fmtSize(b)    { if (b < 1024) return b + ' B'; if (b < 1024*1024) return (b/1024).toFixed(1) + ' KB'; return (b/(1024*1024)).toFixed(1) + ' MB'; }
function ts(v)         { return String(v == null ? '' : v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

/* ── 제작 종류 탭 ── */
function bindTypeTabs() {
  document.querySelectorAll('#apTypeTabs .tab-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      srType = btn.dataset.type;
      document.querySelectorAll('#apTypeTabs .tab-btn').forEach(function(b) { b.classList.remove('active'); });
      btn.classList.add('active');

      var titleEl = document.getElementById('sr_title');
      titleEl.placeholder = srType === 'SIGN'
        ? '예: [A3 포맥스], [바닥 스티커] 등 제작 품목명을 입력하세요.'
        : '예: [명패] MD / 홍길동 / 부인과';

      document.getElementById('srPanelSign').style.display = srType === 'SIGN' ? '' : 'none';
      document.getElementById('srPanelNameplate').style.display = srType === 'NAMEPLATE' ? '' : 'none';

      document.getElementById('srFileSign').style.display = srType === 'SIGN' ? '' : 'none';
      document.getElementById('srFileNameplate').style.display = srType === 'NAMEPLATE' ? '' : 'none';
      document.getElementById('srFileListSign').style.display = srType === 'SIGN' ? '' : 'none';
      document.getElementById('srFileListNameplate').style.display = srType === 'NAMEPLATE' ? '' : 'none';
      document.getElementById('apFileTitle').textContent = srType === 'SIGN' ? '첨부파일' : '명판 예시 첨부';
      document.getElementById('apFileDesc').textContent = srType === 'SIGN' ? '설치위치 사진 등' : '참고할 명판 예시 이미지 (선택)';
    });
  });
}

function bindUrgentToggle() {
  document.getElementById('sr_is_urgent')?.addEventListener('change', function() {
    document.getElementById('srUrgentReasonField').style.display = this.value === 'Y' ? '' : 'none';
  });
}

/* ── 명판 타입/서브타입/방식/레이아웃/자석 ── */
function bindNameplateTypeSelector() {
  document.querySelectorAll('input[name="sr_np_type"]').forEach(function(radio) {
    radio.addEventListener('change', function(e) {
      srNpType = e.target.value;
      srNpSubtype = ''; srNpLayout = null;
      document.querySelectorAll('#srNpTypeGrid .ap-pick-card').forEach(function(c) { c.classList.remove('is-selected'); });
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
      document.querySelectorAll('#srMethodSection .ap-pick-card').forEach(function(c) { c.classList.remove('is-selected'); });
      document.getElementById('srMethodCard_' + e.target.value)?.classList.add('is-selected');
      renderLayoutGrid();
    });
  });

  document.querySelectorAll('input[name="sr_magnet"]').forEach(function(radio) {
    radio.addEventListener('change', function(e) {
      document.querySelectorAll('#srNpTextSection .ap-pick-card[id^="srMagnetCard_"]').forEach(function(c) { c.classList.remove('is-selected'); });
      document.getElementById('srMagnetCard_' + e.target.value)?.classList.add('is-selected');
    });
  });
}

function renderSubtypeGrid(type) {
  var grid = document.getElementById('srNpSubGrid');
  var subtypes = NP_SUBTYPES[type] || [];
  grid.innerHTML = subtypes.map(function(sub) {
    return '<label class="ap-pick-card" id="srSubCard_' + type + '_' + sub + '">' +
      '<input type="radio" name="sr_np_subtype" value="' + sub + '" class="ap-sr-only" />' +
      '<div class="ap-pick-badge">' + type + '-' + sub + '</div></label>';
  }).join('');
  document.getElementById('srNpSubSection').style.display = '';

  grid.querySelectorAll('input[name="sr_np_subtype"]').forEach(function(radio) {
    radio.addEventListener('change', function(e) {
      srNpSubtype = e.target.value;
      grid.querySelectorAll('.ap-pick-card').forEach(function(c) { c.classList.remove('is-selected'); });
      document.getElementById('srSubCard_' + type + '_' + srNpSubtype)?.classList.add('is-selected');
    });
  });
}

function renderLayoutGrid() {
  var grid = document.getElementById('srLayoutGrid');
  grid.innerHTML = NP_LAYOUTS.map(function(l) {
    return '<label class="ap-pick-card" id="srLayoutCard_' + l.id + '">' +
      '<input type="radio" name="sr_np_layout" value="' + l.id + '" class="ap-sr-only" />' +
      '<div class="ap-pick-shape">' + l.shape + '</div>' +
      '<div class="ap-pick-title">' + l.label + '</div>' +
      '<div class="ap-pick-desc">' + l.desc + '</div></label>';
  }).join('');
  document.getElementById('srLayoutSection').style.display = '';

  grid.querySelectorAll('input[name="sr_np_layout"]').forEach(function(radio) {
    radio.addEventListener('change', function(e) {
      var layoutId = e.target.value;
      srNpLayout = NP_LAYOUTS.find(function(l) { return l.id === layoutId; }) || null;
      grid.querySelectorAll('.ap-pick-card').forEach(function(c) { c.classList.remove('is-selected'); });
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
    return '<div class="form-field">' +
      '<label class="form-label ' + (meta.required ? 'required' : '') + '">' + meta.label + '</label>' +
      '<input type="text" id="srNpField_' + fk + '" class="input" placeholder="' + meta.placeholder + '" data-field="' + fk + '" /></div>';
  }).join('');
}

function buildNameplateText() {
  if (!srNpLayout) return '';
  var parts = srNpLayout.fields.map(function(fk) {
    return NP_FIELD_META[fk].label + ': ' + val('srNpField_' + fk);
  });
  return '레이아웃: ' + srNpLayout.label + '\n' + parts.join('\n');
}

/* ── 첨부파일 ── */
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
  if (!srPendingFiles[key].length) {
    listEl.innerHTML = '<div class="ap-file-empty">첨부된 파일이 없습니다.</div>';
    return;
  }
  listEl.innerHTML = srPendingFiles[key].map(function(f, idx) {
    return '<div class="ap-file-item"><span>' + ts(f.file.name) + ' (' + fmtSize(f.file.size) + ')</span>' +
      '<button type="button" class="ap-file-item-remove" data-key="' + key + '" data-idx="' + idx + '">✕</button></div>';
  }).join('');
  listEl.querySelectorAll('.ap-file-item-remove').forEach(function(btn) {
    btn.addEventListener('click', function() {
      srPendingFiles[btn.dataset.key].splice(Number(btn.dataset.idx), 1);
      renderFileList(btn.dataset.key, listId);
    });
  });
}

/* ── 제출 ── */
async function saveSr() {
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

  gasNotify('signageRequestNotice', {
    request_no: newSr.request_no, type: newSr.type, request_title: newSr.request_title,
    clinic_name: myClinicName, department: myDeptName,
    requester_name: newSr.requester_name, contact: newSr.contact, quantity: newSr.quantity,
    is_urgent: newSr.is_urgent, urgent_reason: newSr.urgent_reason,
    sign_size: newSr.sign_size, text_content: newSr.text_content,
    nameplate_type: newSr.nameplate_type, nameplate_text: newSr.nameplate_text,
  });
}

async function genDocNo(prefix) {
  var year = new Date().getFullYear();
  var { data, error } = await supabaseClient.rpc('next_doc_seq', { p_prefix: prefix, p_year: year });
  if (error || data == null) return prefix + '-' + year + '-' + Date.now().toString().slice(-6);
  return prefix + '-' + year + '-' + String(data).padStart(6, '0');
}

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

async function init() {
  var session = await auth.requireAuth();
  if (!session) return;
  currentUser = await auth.getSession();

  bindTypeTabs();
  bindUrgentToggle();
  bindNameplateTypeSelector();
  bindFileInputs();

  setVal('sr_requester_name', currentUser.user_name || currentUser.email);
  document.getElementById('sr_title').placeholder = '예: [A3 포맥스], [바닥 스티커] 등 제작 품목명을 입력하세요.';

  document.getElementById('srSaveBtn')?.addEventListener('click', async function() {
    var btn = this; btn.disabled = true;
    showGlobalLoading('신청서를 제출하는 중...');
    try {
      await saveSr();
      hideGlobalLoading();
      alert('신청이 접수되었습니다.');
      if (parent.shellNavigate) parent.shellNavigate('signage/history');
      else location.href = 'history.html';
    } catch(e) {
      hideGlobalLoading();
      alert('신청 제출 실패: ' + e.message);
      btn.disabled = false;
    }
  });

  showGlobalLoading('정보를 불러오는 중...');
  try {
    await resolveMyClinicAndDept(currentUser);
    setVal('sr_clinic_display', myClinicName || '-');
    setVal('sr_dept_display', myDeptName || '-');
  } catch(e) {
    alert('초기화 실패: ' + e.message);
  } finally {
    hideGlobalLoading();
  }
}

document.addEventListener('DOMContentLoaded', init);
