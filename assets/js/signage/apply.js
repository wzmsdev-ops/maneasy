/**
 * assets/js/signage/apply.js
 */
'use strict';

var currentUser  = null;
var myClinicId   = null;
var myClinicName = '';
var myDeptId     = null;
var myDeptName   = '';

var NP_SIZES = { A:'높이 5cm (20cm/16cm)', B:'높이 4cm (20cm/18cm)', C:'높이 3cm (20cm/18cm)', D:'높이 2.5cm (20cm)' };

// 레이아웃별 활성 필드 정의
var NP_LAYOUT_FIELDS = {
  ga: ['name_kor', 'name_eng'],
  na: ['name_kor', 'name_eng', 'title'],
  da: ['name_kor', 'name_eng', 'title', 'dept'],
};
var NP_ALL_FIELDS = ['name_kor', 'name_eng', 'title', 'dept'];

var MAX_SINGLE = 10 * 1024 * 1024;
var MAX_TOTAL  = 20 * 1024 * 1024;

var srType      = 'SIGN';
var srNpType    = '';
var srNpSubtype = '';
var srNpLayout  = '';
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
      document.getElementById('srPanelSign').style.display      = srType === 'SIGN'      ? '' : 'none';
      document.getElementById('srPanelNameplate').style.display = srType === 'NAMEPLATE' ? '' : 'none';
    });
  });
}

/* ── 긴급 토글 ── */
function bindUrgentToggle() {
  document.getElementById('sr_is_urgent')?.addEventListener('change', function() {
    document.getElementById('srUrgentReasonField').style.display = this.value === 'Y' ? '' : 'none';
  });
  document.getElementById('sr_is_urgent_np')?.addEventListener('change', function() {
    document.getElementById('srUrgentReasonNpField').style.display = this.value === 'Y' ? '' : 'none';
  });
}

/* ── 명판 타입 선택 ── */
function bindNpTypeSelector() {
  document.querySelectorAll('input[name="sr_np_type"]').forEach(function(radio) {
    radio.addEventListener('change', function(e) {
      srNpType = e.target.value;
      srNpSubtype = '';

      // 타입 카드 하이라이트
      document.querySelectorAll('#srNpTypeGrid .ap-pick-card').forEach(function(c) { c.classList.remove('is-selected'); });
      document.getElementById('srNpCard_' + srNpType)?.classList.add('is-selected');

      // 이미지 교체
      var NP_TYPE_LABELS = { A:'A 타입 — 5cm (20/16cm)', B:'B 타입 — 4cm (20/18cm)', C:'C 타입 — 3cm (20/18cm)', D:'D 타입 — 2.5cm (20cm)' };
      var NAMEPLATE_IMG_BASE = '../../assets/images/nameplate/';
      document.getElementById('srPreviewEmpty').style.display = 'none';
      var content = document.getElementById('srPreviewContent');
      content.style.display = 'flex';
      document.getElementById('srPreviewTypeImg').src = NAMEPLATE_IMG_BASE + srNpType + '.jpeg';
      document.getElementById('srPreviewTitle').textContent = NP_TYPE_LABELS[srNpType] || '명판 타입 미리보기';

      // 세부 디자인 레이블 업데이트 (카드는 이미 그려져 있음)
      ['1','2','3','4'].forEach(function(n) {
        var lbl = document.getElementById('srSubLabel_' + n);
        if (lbl) lbl.textContent = srNpType + '-' + n;
        var card = document.getElementById('srSubCard_' + n);
        if (card) card.classList.remove('is-selected');
        var radio = card?.querySelector('input[type=radio]');
        if (radio) radio.checked = false;
      });
    });
  });
}

/* ── 세부 디자인 선택 ── */
function bindNpSubtypeSelector() {
  document.querySelectorAll('input[name="sr_np_subtype"]').forEach(function(radio) {
    radio.addEventListener('change', function(e) {
      srNpSubtype = e.target.value;
      document.querySelectorAll('#srNpSubGrid .ap-pick-card').forEach(function(c) { c.classList.remove('is-selected'); });
      document.getElementById('srSubCard_' + srNpSubtype)?.classList.add('is-selected');
    });
  });
}

/* ── 레이아웃 선택 → 문구 필드 활성/비활성 제어 ── */
function bindLayoutSelector() {
  document.querySelectorAll('input[name="sr_np_layout"]').forEach(function(radio) {
    radio.addEventListener('change', function(e) {
      srNpLayout = e.target.value;

      // 레이아웃 카드 하이라이트
      ['ga','na','da'].forEach(function(id) {
        document.getElementById('srLayoutCard_' + id)?.classList.toggle('is-selected', id === srNpLayout);
      });

      // 이미지 교체 — layout.jpeg로 스왑
      document.getElementById('srPreviewEmpty').style.display = 'none';
      document.getElementById('srPreviewContent').style.display = 'flex';
      document.getElementById('srPreviewTypeImg').src = '../../assets/images/nameplate/layout.jpeg';
      document.getElementById('srPreviewTitle').textContent = '문구 레이아웃 안내';

      // 이 레이아웃에서 활성화할 필드 목록
      var activeFields = NP_LAYOUT_FIELDS[srNpLayout] || [];

      NP_ALL_FIELDS.forEach(function(fk) {
        var wrap  = document.getElementById('srNpFieldWrap_' + fk);
        var input = document.getElementById('srNpField_' + fk);
        var active = activeFields.indexOf(fk) !== -1;
        if (wrap)  { wrap.classList.toggle('is-disabled', !active); }
        if (input) {
          input.disabled = !active;
          if (!active) input.value = '';
        }
      });
    });
  });
}

/* ── 일반 사인물 파일 첨부 ── */
function bindSignFileInput() {
  var input = document.getElementById('srFileSign');
  if (!input) return;
  input.addEventListener('change', function(e) {
    Array.from(e.target.files || []).forEach(function(file) {
      if (file.size > MAX_SINGLE) { alert('파일당 최대 10MB: ' + file.name); return; }
      var total = pendingSign.reduce(function(a,f) { return a + f.file.size; }, 0);
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
    listEl.innerHTML =
      '<div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;color:#9ca3af;">' +
      '<i class="ti ti-paperclip" style="font-size:28px;"></i>' +
      '<span style="font-size:12px;font-weight:600;">첨부된 파일이 없습니다</span></div>';
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

/* ── 명판 문구 합성 ── */
function buildNameplateText() {
  var activeFields = NP_LAYOUT_FIELDS[srNpLayout] || [];
  var NP_FIELD_LABELS = { name_kor:'이름 (한글)', name_eng:'영문 이름', title:'직함', dept:'진료과' };
  return '레이아웃: ' + srNpLayout + '\n' +
    activeFields.map(function(fk) { return NP_FIELD_LABELS[fk] + ': ' + val('srNpField_' + fk); }).join('\n');
}

/* ── 제출 ── */
async function saveSr() {
  var isNp = srType === 'NAMEPLATE';

  var title        = isNp ? val('sr_title_np')           : val('sr_title');
  var rName        = isNp ? val('sr_requester_name_np')   : val('sr_requester_name');
  var contact      = isNp ? val('sr_contact_np')          : val('sr_contact');
  var qty          = isNp ? val('sr_quantity_np')         : val('sr_quantity');
  var isUrgent     = isNp ? val('sr_is_urgent_np')        : val('sr_is_urgent');
  var urgentReason = isNp ? val('sr_urgent_reason_np')    : val('sr_urgent_reason');

  if (!title)   throw new Error('제목을 입력해주세요.');
  if (!rName)   throw new Error('이름을 입력해주세요.');
  if (!contact) throw new Error('연락처를 입력해주세요.');
  if (isUrgent === 'Y' && !urgentReason) throw new Error('긴급 사유를 입력해주세요.');

  var agreeId = isNp ? 'sr_agree_confirm_np' : 'sr_agree_confirm';
  if (!document.getElementById(agreeId)?.checked) throw new Error('신청 내용을 확인하고 제작에 동의해주세요.');

  var payload = {
    type: srType, request_title: title,
    clinic_id: myClinicId, dept_id: myDeptId,
    requester_id: currentUser.id, requester_name: rName, contact: contact,
    quantity: Math.max(1, Number(qty || 1)),
    is_urgent: isUrgent, urgent_reason: urgentReason,
    draft_confirm: document.getElementById('sr_draft_confirm')?.checked ? 'Y' : 'N',
    status: 'REQUESTED',
  };

  if (!isNp) {
    if (!val('sr_text_content'))     throw new Error('상세내역을 입력해주세요.');
    if (!val('sr_install_env'))      throw new Error('설치 환경을 선택해주세요.');
    if (!val('sr_install_location')) throw new Error('설치 위치를 입력해주세요.');
    payload.text_content     = val('sr_text_content');
    payload.sign_size        = val('sr_sign_size');
    payload.sign_type        = val('sr_sign_type');
    payload.install_env      = val('sr_install_env');
    payload.install_location = val('sr_install_location');
  } else {
    if (!srNpType)   throw new Error('명판 타입을 선택해주세요.');
    if (!srNpSubtype) throw new Error('세부 디자인을 선택해주세요.');
    if (!srNpLayout) throw new Error('문구 레이아웃을 선택해주세요.');

    var activeFields = NP_LAYOUT_FIELDS[srNpLayout] || [];
    for (var i = 0; i < activeFields.length; i++) {
      if (!val('srNpField_' + activeFields[i])) {
        var labels = { name_kor:'이름 (한글)', name_eng:'영문 이름', title:'직함', dept:'진료과' };
        throw new Error(labels[activeFields[i]] + '을(를) 입력해주세요.');
      }
    }

    payload.nameplate_type   = srNpType + '-' + srNpSubtype;
    payload.nameplate_text   = buildNameplateText();
    payload.sign_size        = NP_SIZES[srNpType] || '';
  }

  var requestNo = await genDocNo('SR');
  payload.request_no = requestNo;

  var { data: newSr, error: ie } = await supabaseClient
    .from('signage_requests').insert(payload).select().single();
  if (ie) throw new Error(ie.message);

  var files    = isNp ? pendingNp   : pendingSign;
  var category = isNp ? 'MAIN'      : 'LOCATION';
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
  bindNpTypeSelector();
  bindNpSubtypeSelector();
  bindLayoutSelector();
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
