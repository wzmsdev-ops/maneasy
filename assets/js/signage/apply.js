/**
 * assets/js/signage/apply.js
 * 사인물 신청 — 폼 전용 페이지
 */
'use strict';

var currentUser = null;
var myClinicId   = null;
var myClinicName = '';
var myDeptId     = null;
var myDeptName   = '';

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

var MAX_SINGLE = 10 * 1024 * 1024;
var MAX_TOTAL  = 20 * 1024 * 1024;

var srType     = 'SIGN';
var srNpType   = '';
var srNpSubtype = '';
var srNpLayout  = null;
var pendingSign = [];
var pendingNp   = [];

function val(id)       { return (document.getElementById(id)?.value || '').trim(); }
function setVal(id, v) { var el = document.getElementById(id); if (el) el.value = v ?? ''; }
function fmtSize(b)    { if (b < 1024*1024) return (b/1024).toFixed(0) + 'KB'; return (b/(1024*1024)).toFixed(1) + 'MB'; }
function ts(v)         { return String(v == null ? '' : v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

/* ── 탭 전환 ── */
function bindTypeTabs() {
  document.querySelectorAll('#apTypeTabs .tab-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      srType = btn.dataset.type;
      document.querySelectorAll('#apTypeTabs .tab-btn').forEach(function(b) { b.classList.remove('active'); });
      btn.classList.add('active');
      document.getElementById('srPanelSign').style.display      = srType === 'SIGN' ? '' : 'none';
      document.getElementById('srPanelNameplate').style.display = srType === 'NAMEPLATE' ? '' : 'none';
    });
  });
}

/* ── 일반 사인물: 긴급 토글 ── */
function bindUrgentToggle() {
  document.getElementById('sr_is_urgent')?.addEventListener('change', function() {
    document.getElementById('srUrgentReasonField').style.display = this.value === 'Y' ? '' : 'none';
  });
  document.getElementById('sr_is_urgent_np')?.addEventListener('change', function() {
    document.getElementById('srUrgentReasonNpField').style.display = this.value === 'Y' ? '' : 'none';
  });
}

/* ── 명판 타입 ── */
function bindNameplateTypeSelector() {
  document.querySelectorAll('input[name="sr_np_type"]').forEach(function(radio) {
    radio.addEventListener('change', function(e) {
      srNpType = e.target.value;
      srNpSubtype = ''; srNpLayout = null;

      // 카드 선택 표시
      document.querySelectorAll('#srNpTypeGrid .ap-pick-card').forEach(function(c) { c.classList.remove('is-selected'); });
      document.getElementById('srNpCard_' + srNpType)?.classList.add('is-selected');

      // 우측 이미지 하이라이트
      ['A','B','C','D'].forEach(function(t) {
        var item = document.getElementById('srPreviewItem_' + t);
        if (item) item.classList.toggle('is-selected', t === srNpType);
      });

      renderSubtypeGrid(srNpType);
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
  grid.innerHTML = (NP_SUBTYPES[type] || []).map(function(sub) {
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
    return '<div class="form-field"><label class="form-label ' + (meta.required ? 'required' : '') + '">' + meta.label + '</label>' +
      '<input type="text" id="srNpField_' + fk + '" class="input" placeholder="' + meta.placeholder + '" /></div>';
  }).join('');
}

function buildNameplateText() {
  if (!srNpLayout) return '';
  return '레이아웃: ' + srNpLayout.label + '\n' +
    srNpLayout.fields.map(function(fk) { return NP_FIELD_META[fk].label + ': ' + val('srNpField_' + fk); }).join('\n');
}

/* ── 일반 사인물 파일 첨부 (eform-photo 스타일) ── */
function bindSignFileInput() {
  var input = document.getElementById('srFileSign');
  if (!input) return;
  input.addEventListener('change', function(e) {
    Array.from(e.target.files || []).forEach(function(file) {
      if (file.size > MAX_SINGLE) { alert('파일당 최대 10MB: ' + file.name); return; }
      var total = pendingSign.reduce(function(a, f) { return a + f.file.size; }, 0);
      if (total + file.size > MAX_TOTAL) { alert('전체 20MB 이하만 가능합니다.'); return; }
      pendingSign.push({ file: file });
    });
    renderSignFileList();
    input.value = '';
  });
}

function renderSignFileList() {
  var listEl = document.getElementById('srFileListSign');
  if (!pendingSign.length) {
    listEl.innerHTML = '<div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;color:#9ca3af;">' +
      '<i class="ti ti-paperclip" style="font-size:28px;"></i><span style="font-size:12px;font-weight:600;">첨부된 파일이 없습니다</span></div>';
    return;
  }
  listEl.innerHTML = pendingSign.map(function(f, idx) {
    return '<div style="display:flex;align-items:center;justify-content:space-between;padding:6px 10px;background:#fff;border:1px solid #e5e7eb;border-radius:6px;font-size:12px;margin-bottom:4px;">' +
      '<span>' + ts(f.file.name) + ' (' + fmtSize(f.file.size) + ')</span>' +
      '<button type="button" style="border:none;background:none;color:#ef4444;cursor:pointer;" data-idx="' + idx + '">✕</button></div>';
  }).join('');
  listEl.querySelectorAll('button[data-idx]').forEach(function(btn) {
    btn.addEventListener('click', function() {
      pendingSign.splice(Number(btn.dataset.idx), 1);
      renderSignFileList();
    });
  });
}

/* ── 명판 파일 첨부 (컴팩트 칩) ── */
function bindNpFileInput() {
  var input = document.getElementById('srFileNameplate');
  if (!input) return;
  input.addEventListener('change', function(e) {
    Array.from(e.target.files || []).forEach(function(file) {
      if (file.size > MAX_SINGLE) { alert('파일당 최대 10MB: ' + file.name); return; }
      pendingNp.push({ file: file });
    });
    renderNpFileList();
    input.value = '';
  });
}

function renderNpFileList() {
  var listEl = document.getElementById('srFileListNameplate');
  if (!pendingNp.length) {
    listEl.innerHTML = '<span class="ap-file-empty-label">첨부된 파일이 없습니다 (선택)</span>';
    return;
  }
  listEl.innerHTML = pendingNp.map(function(f, idx) {
    return '<span style="display:inline-flex;align-items:center;gap:4px;padding:2px 8px;background:#f3f4f6;border:1px solid #e5e7eb;border-radius:999px;font-size:11px;">' +
      ts(f.file.name) + ' (' + fmtSize(f.file.size) + ')' +
      '<button type="button" style="border:none;background:none;color:#ef4444;cursor:pointer;font-size:12px;" data-idx="' + idx + '">✕</button></span>';
  }).join('');
  listEl.querySelectorAll('button[data-idx]').forEach(function(btn) {
    btn.addEventListener('click', function() {
      pendingNp.splice(Number(btn.dataset.idx), 1);
      renderNpFileList();
    });
  });
}

/* ── 제출 ── */
async function saveSr() {
  var isNp = srType === 'NAMEPLATE';

  var title    = isNp ? val('sr_title_np')          : val('sr_title');
  var rName    = isNp ? val('sr_requester_name_np')  : val('sr_requester_name');
  var contact  = isNp ? val('sr_contact_np')         : val('sr_contact');
  var qty      = isNp ? val('sr_quantity_np')        : val('sr_quantity');
  var isUrgent = isNp ? val('sr_is_urgent_np')       : val('sr_is_urgent');
  var urgentReason = isNp ? val('sr_urgent_reason_np') : val('sr_urgent_reason');

  if (!title)   throw new Error('제목을 입력해주세요.');
  if (!rName)   throw new Error('이름을 입력해주세요.');
  if (!contact) throw new Error('연락처를 입력해주세요.');
  if (isUrgent === 'Y' && !urgentReason) throw new Error('긴급 사유를 입력해주세요.');

  var payload = {
    type: srType,
    request_title: title,
    clinic_id: myClinicId, dept_id: myDeptId,
    requester_id: currentUser.id, requester_name: rName, contact: contact,
    quantity: Math.max(1, Number(qty || 1)),
    is_urgent: isUrgent, urgent_reason: urgentReason,
    draft_confirm: (document.getElementById('sr_draft_confirm')?.checked) ? 'Y' : 'N',
    status: 'REQUESTED',
  };

  if (!isNp) {
    if (!val('sr_text_content'))   throw new Error('상세내역을 입력해주세요.');
    if (!val('sr_install_env'))    throw new Error('설치 환경을 선택해주세요.');
    if (!val('sr_install_location')) throw new Error('설치 위치를 입력해주세요.');
    payload.text_content = val('sr_text_content');
    payload.sign_size    = val('sr_sign_size');
    payload.sign_type    = val('sr_sign_type');
    payload.install_env  = val('sr_install_env');
    payload.install_location = val('sr_install_location');
  } else {
    if (!srNpType)   throw new Error('명판 타입을 선택해주세요.');
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
    payload.nameplate_type   = srNpType + '-' + srNpSubtype;
    payload.nameplate_method = method.value;
    payload.nameplate_text   = buildNameplateText();
    payload.magnet_yn        = magnet.value;
    payload.sign_size        = NP_SIZES[srNpType] || '';
  }

  var requestNo = await genDocNo('SR');
  payload.request_no = requestNo;

  var { data: newSr, error: ie } = await supabaseClient
    .from('signage_requests').insert(payload).select().single();
  if (ie) throw new Error(ie.message);

  var files = isNp ? pendingNp : pendingSign;
  var category = isNp ? 'MAIN' : 'LOCATION';
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
    requester_name: rName, contact: contact, quantity: payload.quantity,
    is_urgent: isUrgent, urgent_reason: urgentReason,
    sign_size: payload.sign_size, text_content: payload.text_content,
    nameplate_type: payload.nameplate_type, nameplate_text: payload.nameplate_text,
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
    myClinicName = clinic?.clinic_name || '';
  }
  if (user.team_code) {
    var deptQ = supabaseClient.from('departments').select('id, dept_name').eq('dept_code', user.team_code);
    if (myClinicId) deptQ = deptQ.eq('clinic_id', myClinicId);
    var { data: dept } = await deptQ.maybeSingle();
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
  bindSignFileInput();
  bindNpFileInput();

  var name = currentUser.user_name || currentUser.email;
  setVal('sr_requester_name', name);
  setVal('sr_requester_name_np', name);

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
