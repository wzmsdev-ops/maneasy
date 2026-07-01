/**
 * assets/js/program-request/apply.js
 */
'use strict';

var currentUser  = null;
var myClinicId   = null;
var myClinicName = '';
var myDeptId     = null;
var myDeptName   = '';

var MAX_SINGLE = 10 * 1024 * 1024;
var MAX_TOTAL  = 20 * 1024 * 1024;

var prType      = 'BUGFIX';
var pendingFiles = [];

var TYPE_META = {
  BUGFIX:  { icon:'ti-bug',      title:'오류수정 상세', desc:'오류 내용을 최대한 구체적으로 작성해 주세요', descLabel:'오류 내용' },
  FEATURE: { icon:'ti-bulb',     title:'신규개발 상세', desc:'요청하는 기능/개선 내용을 작성해 주세요',        descLabel:'요청 내용' },
};

function val(id)       { return (document.getElementById(id)?.value || '').trim(); }
function setVal(id, v) { var el = document.getElementById(id); if (el) el.value = v ?? ''; }
function fmtSize(b)    { if (b < 1024*1024) return (b/1024).toFixed(0) + 'KB'; return (b/(1024*1024)).toFixed(1) + 'MB'; }
function ts(v)         { return String(v == null ? '' : v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

/* ── 탭 전환 (요청유형) ── */
function bindTypeTabs() {
  document.querySelectorAll('#prTypeTabs .tab-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      prType = btn.dataset.type;
      document.querySelectorAll('#prTypeTabs .tab-btn').forEach(function(b) { b.classList.remove('active'); });
      btn.classList.add('active');
      applyTypeMeta();
    });
  });
}

function applyTypeMeta() {
  var meta = TYPE_META[prType] || TYPE_META.BUGFIX;
  var iconEl = document.getElementById('prDetailIcon');
  if (iconEl) iconEl.className = 'ti ' + meta.icon;
  setText('prDetailTitle', meta.title);
  setText('prDetailDesc', meta.desc);
  setText('prDescLabel', meta.descLabel);
  document.getElementById('pr_description').placeholder = prType === 'BUGFIX'
    ? '언제, 어떤 화면에서, 무엇을 하다가 어떤 문제가 발생했는지 적어주세요.'
    : '어떤 기능이 필요한지, 왜 필요한지 구체적으로 적어주세요.';
  document.getElementById('prBugfixField').style.display  = prType === 'BUGFIX'  ? '' : 'none';
  document.getElementById('prFeatureField').style.display = prType === 'FEATURE' ? '' : 'none';
}
function setText(id, v) { var el = document.getElementById(id); if (el) el.textContent = v; }

/* ── 긴급 토글 ── */
function bindUrgentToggle() {
  document.getElementById('pr_is_urgent')?.addEventListener('change', function() {
    document.getElementById('prUrgentReasonField').style.display = this.value === 'Y' ? '' : 'none';
  });
}

/* ── 파일 첨부 ── */
function bindFileInput() {
  var input = document.getElementById('prFile');
  if (!input) return;
  input.addEventListener('change', function(e) {
    Array.from(e.target.files || []).forEach(function(file) {
      if (file.size > MAX_SINGLE) { alert('파일당 최대 10MB: ' + file.name); return; }
      var total = pendingFiles.reduce(function(a,f) { return a + f.file.size; }, 0);
      if (total + file.size > MAX_TOTAL) { alert('전체 20MB 이하만 가능합니다.'); return; }
      pendingFiles.push({ file: file });
    });
    renderFileList();
    input.value = '';
  });
}

function renderFileList() {
  var listEl = document.getElementById('prFileList');
  if (!pendingFiles.length) {
    listEl.innerHTML =
      '<div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;color:#9ca3af;">' +
      '<i class="ti ti-paperclip" style="font-size:28px;"></i>' +
      '<span style="font-size:12px;font-weight:600;">첨부된 파일이 없습니다</span></div>';
    return;
  }
  var html = pendingFiles.map(function(f, idx) {
    var isImg = f.file.type.startsWith('image/');
    var thumb = isImg
      ? '<img src="' + URL.createObjectURL(f.file) + '" style="width:56px;height:56px;object-fit:cover;border-radius:6px;border:1px solid #e5e7eb;flex-shrink:0;" />'
      : '<div style="width:56px;height:56px;border-radius:6px;border:1px solid #e5e7eb;background:#f3f4f6;display:flex;align-items:center;justify-content:center;flex-shrink:0;"><i class="ti ti-file" style="font-size:22px;color:#9ca3af;"></i></div>';
    return '<div style="display:flex;align-items:center;gap:10px;padding:8px;background:#fff;border:1px solid #e5e7eb;border-radius:8px;margin-bottom:6px;">' +
      thumb +
      '<div style="flex:1;min-width:0;">' +
        '<div style="font-size:12px;font-weight:600;color:#111827;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + ts(f.file.name) + '</div>' +
        '<div style="font-size:11px;color:#9ca3af;margin-top:2px;">' + fmtSize(f.file.size) + '</div>' +
      '</div>' +
      '<button type="button" style="border:none;background:none;color:#ef4444;cursor:pointer;font-size:16px;flex-shrink:0;" data-idx="' + idx + '">✕</button>' +
    '</div>';
  }).join('');
  listEl.innerHTML = html;
  listEl.querySelectorAll('button[data-idx]').forEach(function(btn) {
    btn.addEventListener('click', function() {
      pendingFiles.splice(Number(btn.dataset.idx), 1);
      renderFileList();
    });
  });
}

/* ── 제출 ── */
async function savePr() {
  var title        = val('pr_title');
  var rName        = val('pr_requester_name');
  var contact      = val('pr_contact');
  var targetProgram = val('pr_target_program');
  var isUrgent     = val('pr_is_urgent');
  var urgentReason = val('pr_urgent_reason');
  var description  = val('pr_description');

  if (!title)          throw new Error('제목을 입력해주세요.');
  if (!rName)           throw new Error('이름을 입력해주세요.');
  if (!contact)         throw new Error('연락처를 입력해주세요.');
  if (!targetProgram)   throw new Error('관련 프로그램을 선택해주세요.');
  if (!description)     throw new Error(prType === 'BUGFIX' ? '오류 내용을 입력해주세요.' : '요청 내용을 입력해주세요.');
  if (isUrgent === 'Y' && !urgentReason) throw new Error('긴급 사유를 입력해주세요.');
  if (!document.getElementById('pr_agree_confirm')?.checked) throw new Error('신청 내용을 확인하고 제출에 동의해주세요.');

  var payload = {
    request_type: prType, request_title: title,
    clinic_id: myClinicId, dept_id: myDeptId,
    requester_id: currentUser.id, requester_name: rName, contact: contact,
    target_program: targetProgram, program_detail: val('pr_program_detail'),
    description: description,
    steps_to_reproduce: prType === 'BUGFIX'  ? val('pr_steps_to_reproduce') : '',
    expected_benefit:   prType === 'FEATURE' ? val('pr_expected_benefit')   : '',
    is_urgent: isUrgent, urgent_reason: urgentReason,
    status: 'REQUESTED',
  };

  var requestNo = await genDocNo('DR');
  payload.request_no = requestNo;

  var { data: newPr, error: ie } = await supabaseClient
    .from('program_requests').insert(payload).select().single();
  if (ie) throw new Error(ie.message);

  for (var fi = 0; fi < pendingFiles.length; fi++) {
    var f = pendingFiles[fi].file;
    var up = await db.uploadFile('program-request-files', f, newPr.id);
    await supabaseClient.from('program_request_files').insert({
      request_id: newPr.id, file_category: 'ATTACH',
      file_name: up.name, storage_path: up.path, file_size: up.size, sort_order: fi,
    });
  }

  gasNotify('programRequestNotice', {
    request_no: newPr.request_no, request_type: newPr.request_type, request_title: newPr.request_title,
    clinic_name: myClinicName, department: myDeptName,
    requester_name: rName, contact: contact,
    target_program: payload.target_program, program_detail: payload.program_detail,
    is_urgent: isUrgent, urgent_reason: urgentReason,
    description: payload.description,
    steps_to_reproduce: payload.steps_to_reproduce, expected_benefit: payload.expected_benefit,
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
  bindFileInput();
  applyTypeMeta();

  var name = currentUser.user_name || currentUser.email;
  setVal('pr_requester_name', name);

  // 동의 체크박스 → 신청 버튼 활성화 연동
  function syncSaveBtn() {
    var checked = document.getElementById('pr_agree_confirm')?.checked;
    var btn = document.getElementById('prSaveBtn');
    if (!btn) return;
    btn.disabled = !checked;
    btn.style.opacity = checked ? '' : '0.45';
    btn.style.cursor  = checked ? '' : 'not-allowed';
  }
  document.getElementById('pr_agree_confirm')?.addEventListener('change', syncSaveBtn);

  document.getElementById('prSaveBtn')?.addEventListener('click', async function() {
    var btn = this; btn.disabled = true;
    showGlobalLoading('신청서를 제출하는 중...');
    try {
      await savePr();
      systemLog('PROGRAM_REQUEST_CREATE', '프로그램 요청 제출', { target_type:'program_request' }).catch(() => {});
      hideGlobalLoading();
      alert('신청이 접수되었습니다.');
      if (parent.shellNavigate) parent.shellNavigate('program-request/history');
      else location.href = 'history.html';
    } catch(e) {
      hideGlobalLoading();
      alert('신청 제출 실패: ' + e.message);
      syncSaveBtn(); // 실패 시 체크 상태 기준으로 버튼 복원
    }
  });

  showGlobalLoading('정보를 불러오는 중...');
  try {
    await resolveMyClinicAndDept(currentUser);
    setVal('pr_clinic_display', myClinicName || '-');
    setVal('pr_dept_display', myDeptName || '-');
  } catch(e) {
    alert('초기화 실패: ' + e.message);
  } finally {
    hideGlobalLoading();
  }
}

document.addEventListener('DOMContentLoaded', init);
