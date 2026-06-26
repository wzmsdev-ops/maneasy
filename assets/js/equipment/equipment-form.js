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
  setVal('equipmentName',       eq.equipment_name);
  setVal('modelName',           eq.model_name);
  setVal('manufacturer',        eq.manufacturer);
  setVal('manufactureDate',     eq.manufacture_date);
  setVal('purchaseDate',        eq.purchase_date);
  setVal('serialNo',            eq.serial_no);
  setVal('vendor',              eq.vendor);
  setVal('acquisitionCost',     eq.acquisition_cost ?? '');
  setVal('maintenanceEndDate',  eq.maintenance_end_date);
  setVal('clinicName',          eq.clinic_name);
  setVal('teamName',            eq.team_name);
  setVal('department',          eq.department);
  setVal('location',            eq.location);
  setVal('currentUserName',     eq.current_user_name);
  setVal('status',              eq.status);
  setVal('memo',                eq.memo);
  setVal('managerName',         eq.manager_name);
  setVal('managerPhone',        eq.manager_phone);

  // select 값 세팅 (의원/부서)
  const clinicSel = document.getElementById('clinic_code');
  const teamSel   = document.getElementById('team_code');
  if (clinicSel && eq.clinic_code) {
    // 1) 의원 select에 해당 옵션이 실제로 있는지 확인 후 세팅
    const clinicOpt = Array.from(clinicSel.options).find(o => o.value === eq.clinic_code);
    if (clinicOpt) {
      clinicSel.value = eq.clinic_code;
      clinicSel.dispatchEvent(new Event('change'));  // → fillDeptSelect 실행
    }
  }
  if (teamSel && eq.team_code) {
    // fillDeptSelect가 동기라서 dispatchEvent 직후 옵션이 채워짐
    // 그래도 nextTick으로 안전하게 처리
    const setTeam = () => {
      const teamOpt = Array.from(teamSel.options).find(o => o.value === eq.team_code);
      if (teamOpt) {
        teamSel.value = eq.team_code;
        // team_name도 수동으로 세팅 (change 이벤트 없이)
        setVal('teamName', teamOpt.textContent.trim());
      }
    };
    // 즉시 시도 후 실패하면 setTimeout으로 재시도
    setTeam();
    if (teamSel.value !== eq.team_code) setTimeout(setTeam, 100);
  }

  if (eq.photo_url) renderPhotoPreview(eq.photo_url);
}

/* ── 저장 ──────────────────────────────────── */
async function saveEquipment() {
  const { data: { session } } = await supabaseClient.auth.getSession();

  const payload = {
    equipment_name:       val('equipmentName'),
    model_name:           val('modelName'),
    manufacturer:         val('manufacturer'),
    manufacture_date:     val('manufactureDate') || null,
    purchase_date:        val('purchaseDate') || null,
    serial_no:            val('serialNo'),
    vendor:               val('vendor'),
    acquisition_cost:     val('acquisitionCost') ? Number(val('acquisitionCost')) : null,
    maintenance_end_date: val('maintenanceEndDate') || null,
    clinic_name:          val('clinicName'),
    team_name:            val('teamName'),
    department:           val('department'),
    location:             val('location'),
    current_user_name:    val('currentUserName'),
    status:               val('status') || CONFIG.EQUIPMENT_STATUS.IN_USE,
    memo:                 val('memo'),
    manager_name:         val('managerName'),
    manager_phone:        val('managerPhone'),
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

    // 의원 변경 시 부서 연동 + clinic_name 자동 세팅
    clinicSel.addEventListener('change', () => {
      const code = clinicSel.value;
      const found = (clinicRows || []).find(r => r.clinic_code === code);
      setVal('clinicName', found ? found.clinic_name : '');
      setVal('teamName', '');
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

  // 부서 변경 시 team_name 자동 세팅
  teamSel?.addEventListener('change', () => {
    const code = teamSel.value;
    const found = (deptRows || []).find(d => d.dept_code === code);
    setVal('teamName', found ? found.dept_name : '');
  });

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
