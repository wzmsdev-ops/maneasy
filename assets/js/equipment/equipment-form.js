/**
 * equipment/equipment-form.js
 * Supabase SDK 직접 호출 버전 — 등록/수정/사진 업로드
 */

'use strict';

let currentUser = null;
let editingId   = null;
let selectedPhotoFile = null;
let removePhotoRequested = false;

/* ── 유틸 ─────────────────────────────────── */
function qs(sel) { return document.querySelector(sel); }
function val(id) { return (document.getElementById(id)?.value || '').trim(); }
function setVal(id, v) { const el = document.getElementById(id); if (el) el.value = v ?? ''; }

/* ── 사진 UI ───────────────────────────────── */
function initPhotoUi() {
  const input     = qs('#photoInput');
  const removeBtn = qs('#removePhotoBtn');

  input?.addEventListener('change', e => {
    const file = e.target.files?.[0];
    if (!file) return;
    selectedPhotoFile = file;
    removePhotoRequested = false;
    const reader = new FileReader();
    reader.onload = ev => renderPhotoPreview(ev.target.result);
    reader.readAsDataURL(file);
  });

  removeBtn?.addEventListener('click', () => {
    selectedPhotoFile = null;
    removePhotoRequested = true;
    renderPhotoPreview('');
  });
}

function renderPhotoPreview(src) {
  const preview  = qs('#photoPreviewImage');
  const empty    = qs('#photoPreviewEmpty');
  const removeBtn = qs('#removePhotoBtn');
  if (preview) { preview.src = src || ''; preview.style.display = src ? '' : 'none'; }
  if (empty)    empty.style.display    = src ? 'none' : '';
  if (removeBtn) removeBtn.style.display = src ? '' : 'none';
}

/* ── 폼 로드 (수정 모드) ───────────────────── */
async function loadEquipment(id) {
  const { data, error } = await supabaseClient
    .from('equipments')
    .select('*')
    .eq('id', id)
    .single();

  if (error) throw new Error(error.message);
  return data;
}

function fillForm(eq) {
  setVal('equipment_name',       eq.equipment_name);
  setVal('model_name',           eq.model_name);
  setVal('manufacturer',        eq.manufacturer);
  setVal('manufacture_date',     eq.manufacture_date);
  setVal('purchase_date',        eq.purchase_date);
  setVal('serial_no',            eq.serial_no);
  setVal('vendor',              eq.vendor);
  setVal('acquisition_cost',     eq.acquisition_cost ?? '');
  setVal('maintenance_end_date',  eq.maintenance_end_date);
  // clinic_name, team_name은 select option에서 읽으므로 별도 세팅 불필요
  setVal('department_preview',   eq.department);
  setVal('location',            eq.location);
  document.getElementById('qc_enabled').value = eq.qc_enabled ? 'true' : 'false';
  setVal('current_user',     eq.current_user_name);
  setVal('status',              eq.status);
  setVal('memo',                eq.memo);
  setVal('manager_name',         eq.manager_name);
  setVal('manager_phone',        eq.manager_phone);

  // select 값 세팅 (의원/부서)
  const clinicSel = document.getElementById('clinic_code');
  const teamSel   = document.getElementById('team_code');

  if (clinicSel && eq.clinic_code) {
    const clinicOpt = Array.from(clinicSel.options).find(o => o.value === eq.clinic_code);
    if (clinicOpt) {
      clinicSel.value = eq.clinic_code;
      clinicSel.dispatchEvent(new Event('change'));  // fillDeptSelect 실행 (동기)
    }
  }

  if (teamSel && eq.team_code) {
    const trySetTeam = () => {
      const teamOpt = Array.from(teamSel.options).find(o => o.value === eq.team_code);
      if (teamOpt) {
        teamSel.value = eq.team_code;
        teamSel.dispatchEvent(new Event('change'));  // team_name hidden 세팅
        return true;
      }
      return false;
    };
    if (!trySetTeam()) {
      // fillDeptSelect가 아직 안 됐으면 재시도
      setTimeout(trySetTeam, 150);
    }
  }

  if (eq.photo_url) renderPhotoPreview(eq.photo_url);
}

/* ── 저장 ──────────────────────────────────── */
async function saveEquipment() {
  const { data: { session } } = await supabaseClient.auth.getSession();

  const payload = {
    equipment_name:       val('equipment_name'),
    model_name:           val('model_name'),
    manufacturer:         val('manufacturer'),
    manufacture_date:     val('manufacture_date') || null,
    purchase_date:        val('purchase_date') || null,
    serial_no:            val('serial_no'),
    vendor:               val('vendor'),
    acquisition_cost:     val('acquisition_cost') ? Number(val('acquisition_cost')) : null,
    maintenance_end_date: val('maintenance_end_date') || null,
    clinic_code:          (function() { const s = document.getElementById('clinic_code'); return s ? s.value : ''; })(),
    clinic_name:          (function() { const s = document.getElementById('clinic_code'); return s && s.selectedIndex > 0 ? s.options[s.selectedIndex].textContent.trim() : ''; })(),
    team_code:            (function() { const s = document.getElementById('team_code'); return s ? s.value : ''; })(),
    team_name:            (function() { const s = document.getElementById('team_code'); return s && s.selectedIndex > 0 ? s.options[s.selectedIndex].textContent.trim() : ''; })(),
    department:           val('department_preview'),
    location:             val('location'),
    qc_enabled:           document.getElementById('qc_enabled')?.value === 'true',
    current_user_name:    val('current_user'),
    status:               val('status') || CONFIG.EQUIPMENT_STATUS.IN_USE,
    memo:                 val('memo'),
    manager_name:         val('manager_name'),
    manager_phone:        val('manager_phone'),
  };

  if (!payload.equipment_name) throw new Error('장비명은 필수입니다.');

  let equipmentId = editingId;

  if (editingId) {
    // 수정
    const { error } = await supabaseClient
      .from('equipments')
      .update({ ...payload, updated_at: new Date().toISOString() })
      .eq('id', editingId);
    if (error) throw new Error(error.message);
  } else {
    // 등록 — equipment_no 자동 생성
    payload.created_by = session?.user?.id || null;
    payload.deleted_yn = 'N';

    const { data: seqData } = await supabaseClient.rpc('generate_equipment_id');
    if (seqData) payload.equipment_no = seqData;

    const { data, error } = await supabaseClient
      .from('equipments')
      .insert(payload)
      .select()
      .single();
    if (error) throw new Error(error.message);
    equipmentId = data.id;
  }

  // 사진 처리
  if (removePhotoRequested && editingId) {
    const { data: eq } = await supabaseClient
      .from('equipments').select('photo_path').eq('id', editingId).single();
    if (eq?.photo_path) await db.deletePhoto(eq.photo_path);
    await supabaseClient.from('equipments')
      .update({ photo_url: '', photo_path: '' }).eq('id', editingId);
  }

  if (selectedPhotoFile && equipmentId) {
    const { path, url } = await db.uploadPhoto(selectedPhotoFile, equipmentId);
    await supabaseClient.from('equipments')
      .update({ photo_url: url, photo_path: path }).eq('id', equipmentId);
  }

  return equipmentId;
}

/* ── 초기화 ────────────────────────────────── */
async function init() {
  currentUser = await auth.requireAuth();
  if (!currentUser) return;

  initPhotoUi();

  // 상태 옵션
  const statusSel = document.getElementById('status');
  if (statusSel) {
    const STATUS_LABEL = CONFIG.EQUIPMENT_STATUS_LABEL || {};
    statusSel.innerHTML = Object.entries(STATUS_LABEL)
      .map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
  }

  // 의원 select — clinics 테이블에서 로드
  const clinicSel = document.getElementById('clinic_code');
  const teamSel   = document.getElementById('team_code');

  const { data: clinicRows } = await supabaseClient
    .from('clinics').select('clinic_code, clinic_name').eq('active', 'Y').order('sort_order');
  const { data: deptRows } = await supabaseClient
    .from('departments').select('dept_code, dept_name, clinic_id, clinics(clinic_code)').eq('active', 'Y').order('sort_order');

  if (clinicSel) {
    clinicSel.innerHTML = '<option value="">의원 선택</option>' +
      (clinicRows || []).map(r =>
        `<option value="${r.clinic_code}">${r.clinic_name}</option>`
      ).join('');

    // 의원 변경 시 부서 select 연동 (clinic_name/team_name은 저장 시 select에서 직접 읽음)
    clinicSel.addEventListener('change', () => {
      const code = clinicSel.value;
      fillDeptSelect(teamSel, deptRows, code);
    });
  }

  function fillDeptSelect(el, rows, clinicCode) {
    if (!el) return;
    const filtered = clinicCode
      ? (rows || []).filter(d => d.clinics && d.clinics.clinic_code === clinicCode)
      : (rows || []);
    el.innerHTML = '<option value="">부서 선택</option>' +
      filtered.map(d => `<option value="${d.dept_code}">${d.dept_name}</option>`).join('');
  }
  fillDeptSelect(teamSel, deptRows, clinicSel?.value || '');

  // 부서 변경 시 team_name은 저장 시 select option에서 직접 읽음 (별도 hidden 불필요)

  // 수정 모드 확인
  const params = new URLSearchParams(location.search);
  editingId = params.get('id') || null;

  if (editingId) {
    document.querySelector('h2, .page-title')?.textContent !== undefined &&
      (document.querySelector('h2, .page-title').textContent = '장비 수정');
    showGlobalLoading('장비 정보를 불러오는 중...');
    try {
      const eq = await loadEquipment(editingId);
      fillForm(eq);
    } catch (e) {
      alert('장비 정보를 불러오지 못했습니다: ' + e.message);
      return;
    } finally {
      hideGlobalLoading();
    }
  }

  // 저장 버튼
  qs('#saveBtn')?.addEventListener('click', async () => {
    const btn = qs('#saveBtn');
    btn.disabled = true;
    btn.textContent = '저장 중...';
    try {
      const id = await saveEquipment();
      alert(editingId ? '장비 정보가 수정됐습니다.' : '장비가 등록됐습니다.');
      parent.shellNavigate?.(`equipment/detail?id=${id}`);
    } catch (e) {
      alert('저장 실패: ' + e.message);
      btn.disabled = false;
      btn.textContent = '저장';
    }
  });

  // 취소 버튼
  qs('#cancelBtn')?.addEventListener('click', () => {
    if (editingId) parent.shellNavigate?.(`equipment/detail?id=${editingId}`);
    else parent.shellNavigate?.('equipment/list');
  });
}

function initEquipmentForm() { init(); }
document.addEventListener('DOMContentLoaded', init);
