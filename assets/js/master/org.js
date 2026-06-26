/**
 * assets/js/master/org.js
 * 조직 관리 — 의원 / 부서 / 사용자
 * admin role만 접근 가능
 *
 * 연동 구조:
 *   clinicCache → 부서 탭 필터 + 부서 모달 select + 사용자 모달 select
 *   deptCache   → 부서 탭 필터 + 사용자 탭 필터 + 사용자 모달 select (의원 선택 후 필터)
 *   userCache   → 사용자 탭 렌더링 (clinic_code / team_code 기준 필터)
 */
'use strict';

let currentUser    = null;
let editingClinicId = null;
let editingDeptId   = null;
let editingUserId   = null;

let clinicCache = [];   // { id, clinic_code, clinic_name, ... }
let deptCache   = [];   // { id, clinic_id, dept_code, dept_name, ... }
let userCache   = [];   // user_profiles rows

/* ── 유틸 ─────────────────────────────────── */
function ts(v) {
  return String(v == null ? '' : v)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function val(id)       { return (document.getElementById(id)?.value || '').trim(); }
function setVal(id, v) { const el = document.getElementById(id); if (el) el.value = v ?? ''; }

function badgeActive(v) {
  return v === 'Y'
    ? '<span class="badge-active">활성</span>'
    : '<span class="badge-inactive">비활성</span>';
}
function badgeRole(r) {
  const map = {
    admin:   '<span class="badge-role-admin">admin</span>',
    edit:    '<span class="badge-role-edit">edit</span>',
    manager: '<span class="badge-role-manager">manager</span>',
    user:    '<span class="badge-role-user">user</span>',
  };
  return map[r] || ts(r);
}

/* ── 탭 ── */
function initTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.tab;
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`tab-${target}`)?.classList.add('active');

      // 탭 전환 후 그리드 width 재계산 (display:none 상태에서 초기화되면 width=0)
      requestAnimationFrame(() => {
        const gridMap = { clinics: '_clinicGrid', departments: '_deptGrid', users: '_userGrid' };
        const g = window[gridMap[target]];
        if (g) g.sizeColumnsToFit();
      });
    });
  });
}

/* ── 모달 ── */
function openModal(id) { document.getElementById(id)?.classList.add('is-open'); }
function closeModal(id) { document.getElementById(id)?.classList.remove('is-open'); }
window.closeModal = closeModal;

/* ════════════════════════════════════════════
   공통 select 헬퍼
════════════════════════════════════════════ */

/** 의원 select 채우기 (여러 곳에서 공유) */
function fillClinicSelect(selId, placeholder, selectedId) {
  const sel = document.getElementById(selId);
  if (!sel) return;
  sel.innerHTML = `<option value="">${placeholder}</option>` +
    clinicCache.map(c =>
      `<option value="${c.id}" data-code="${ts(c.clinic_code)}" data-name="${ts(c.clinic_name)}">${ts(c.clinic_name)}</option>`
    ).join('');
  if (selectedId) sel.value = selectedId;
}

/** 특정 의원(clinic_id)에 속한 부서만 select에 채우기 */
function fillDeptSelect(selId, placeholder, clinicId, selectedId) {
  const sel = document.getElementById(selId);
  if (!sel) return;
  const filtered = clinicId
    ? deptCache.filter(d => d.clinic_id === clinicId)
    : deptCache;
  sel.innerHTML = `<option value="">${placeholder}</option>` +
    filtered.map(d =>
      `<option value="${d.id}" data-code="${ts(d.dept_code)}" data-name="${ts(d.dept_name)}">${ts(d.dept_name)}</option>`
    ).join('');
  if (selectedId) sel.value = selectedId;
}

/* ════════════════════════════════════════════
   의원 (clinics)
════════════════════════════════════════════ */
async function loadClinics() {
  const { data, error } = await supabaseClient
    .from('clinics')
    .select('*')
    .order('sort_order', { ascending: true });
  if (error) throw new Error(error.message);
  return data || [];
}

function renderClinics(rows) {
  clinicCache = rows;
  const list  = document.getElementById('clinicList');
  const empty = document.getElementById('clinicEmpty');
  if (!list) return;

  if (empty) empty.style.display = rows.length ? 'none' : '';

  if (!window._clinicGrid) {
    window._clinicGrid =
  createMgGrid('clinicList', [
      { headerName: '코드',   field: 'clinic_code', flex: 1, minWidth: 90 },
      { headerName: '의원명', field: 'clinic_name', flex: 2, minWidth: 120 },
      { headerName: '전화',   field: 'phone',       flex: 1, minWidth: 110, valueFormatter: p => p.value || '-' },
      { headerName: '주소',   field: 'address',     flex: 2, minWidth: 140, valueFormatter: p => p.value || '-' },
      { headerName: '순서',   field: 'sort_order',  flex: 0, width: 60 },
      { headerName: '상태',   field: 'active',      flex: 0, width: 70,
        cellRenderer: p => { const s = document.createElement('span'); s.innerHTML = badgeActive(p.value); return s; } },
      { headerName: '', flex: 0, width: 120, sortable: false,
        cellRenderer: p => {
          const wrap = document.createElement('div'); wrap.style.cssText = 'display:flex;gap:4px;align-items:center;';
          const e = document.createElement('button'); e.className = 'btn btn-sm'; e.textContent = '수정'; e.onclick = () => openEditClinic(p.data.id);
          const d = document.createElement('button'); d.className = 'btn btn-sm btn-danger'; d.textContent = '삭제'; d.onclick = () => deleteClinic(p.data.id);
          wrap.append(e, d); return wrap;
        }},
    ], rows, { pageSize: 15, fit: true, noRowsText: '등록된 의원이 없습니다.' });
  } else {
    updateMgGrid(window._clinicGrid, rows);
  }
  syncClinicSelects();
}

/** 의원 데이터가 바뀔 때마다 연관 select 전부 갱신 */
function syncClinicSelects() {
  // 부서 탭 필터
  const deptFilter = document.getElementById('deptClinicFilter');
  if (deptFilter) {
    const cur = deptFilter.value;
    deptFilter.innerHTML = '<option value="">전체</option>' +
      clinicCache.map(c => `<option value="${c.id}">${ts(c.clinic_name)}</option>`).join('');
    if (cur) deptFilter.value = cur;
  }
  // 사용자 탭 필터
  const userFilter = document.getElementById('userClinicFilter');
  if (userFilter) {
    const cur = userFilter.value;
    userFilter.innerHTML = '<option value="">전체</option>' +
      clinicCache.map(c => `<option value="${c.clinic_code}">${ts(c.clinic_name)}</option>`).join('');
    if (cur) userFilter.value = cur;
  }
  // 부서 모달 — 의원 select
  fillClinicSelect('d_clinic_id', '의원을 선택하세요', null);
  // 사용자 모달 — 의원 select
  fillClinicSelect('u_clinic_select', '선택 안 함', null);
}

function openAddClinic() {
  editingClinicId = null;
  ['c_clinic_code','c_clinic_name','c_address','c_phone'].forEach(id => setVal(id, ''));
  setVal('c_sort_order', '0');
  setVal('c_active', 'Y');
  document.getElementById('clinicModalTitle').textContent = '의원 추가';
  openModal('clinicModal');
}

function openEditClinic(id) {
  const row = clinicCache.find(r => r.id === id);
  if (!row) return;
  editingClinicId = id;
  setVal('c_clinic_code', row.clinic_code);
  setVal('c_clinic_name', row.clinic_name);
  setVal('c_address',     row.address);
  setVal('c_phone',       row.phone);
  setVal('c_sort_order',  row.sort_order ?? 0);
  setVal('c_active',      row.active);
  document.getElementById('clinicModalTitle').textContent = '의원 수정';
  openModal('clinicModal');
}
window.openEditClinic = openEditClinic;

async function saveClinic() {
  const payload = {
    clinic_code: val('c_clinic_code'),
    clinic_name: val('c_clinic_name'),
    address:     val('c_address'),
    phone:       val('c_phone'),
    sort_order:  Number(val('c_sort_order') || 0),
    active:      val('c_active'),
    updated_at:  new Date().toISOString(),
  };
  if (!payload.clinic_code) throw new Error('의원 코드는 필수입니다.');
  if (!payload.clinic_name) throw new Error('의원명은 필수입니다.');
  if (editingClinicId) {
    const { error } = await supabaseClient.from('clinics').update(payload).eq('id', editingClinicId);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await supabaseClient.from('clinics').insert(payload);
    if (error) throw new Error(error.message);
  }
}

async function deleteClinic(id) {
  if (!confirm('의원을 삭제하시겠습니까?\n소속 부서가 있으면 삭제되지 않습니다.')) return;
  const { error } = await supabaseClient.from('clinics').delete().eq('id', id);
  if (error) { alert('삭제 실패: ' + error.message); return; }
  await refreshClinics();
}
window.deleteClinic = deleteClinic;

async function refreshClinics() {
  const rows = await loadClinics();
  renderClinics(rows);
}

/* ════════════════════════════════════════════
   부서 (departments)
════════════════════════════════════════════ */
async function loadDepts() {
  const { data, error } = await supabaseClient
    .from('departments')
    .select('*, clinics(clinic_name, clinic_code)')
    .order('sort_order', { ascending: true });
  if (error) throw new Error(error.message);
  return data || [];
}

function renderDepts(rows, filterClinicId) {
  deptCache = rows;
  const list  = document.getElementById('deptList');
  const empty = document.getElementById('deptEmpty');
  if (!list) return;

  const filtered = filterClinicId
    ? rows.filter(r => r.clinic_id === filterClinicId)
    : rows;

  if (empty) empty.style.display = filtered.length ? 'none' : '';

  if (!window._deptGrid) {
    window._deptGrid =
  createMgGrid('deptList', [
      { headerName: '코드',     field: 'dept_code',  flex: 1, minWidth: 90 },
      { headerName: '부서명',   field: 'dept_name',  flex: 2, minWidth: 100 },
      { headerName: '소속 의원', flex: 1, minWidth: 100,
        valueGetter: p => p.data.clinics?.clinic_name || '-' },
      { headerName: '순서',     field: 'sort_order', flex: 0, width: 60 },
      { headerName: '상태',     field: 'active',     flex: 0, width: 70,
        cellRenderer: p => { const s = document.createElement('span'); s.innerHTML = badgeActive(p.value); return s; } },
      { headerName: '', flex: 0, width: 120, sortable: false,
        cellRenderer: p => {
          const wrap = document.createElement('div'); wrap.style.cssText = 'display:flex;gap:4px;align-items:center;';
          const e = document.createElement('button'); e.className = 'btn btn-sm'; e.textContent = '수정'; e.onclick = () => openEditDept(p.data.id);
          const d = document.createElement('button'); d.className = 'btn btn-sm btn-danger'; d.textContent = '삭제'; d.onclick = () => deleteDept(p.data.id);
          wrap.append(e, d); return wrap;
        }},
    ], filtered, { pageSize: 15, fit: true, noRowsText: '등록된 부서가 없습니다.' });
  } else {
    updateMgGrid(window._deptGrid, filtered);
  }
  syncDeptFilter();
}

/** 사용자 탭 부서 필터 select 갱신 (현재 선택된 의원 기준) */
function syncDeptFilter() {
  const userClinicFilter = document.getElementById('userClinicFilter');
  const clinicCode = userClinicFilter?.value || '';
  const userDeptFilter = document.getElementById('userDeptFilter');
  if (!userDeptFilter) return;

  const cur = userDeptFilter.value;
  const clinic = clinicCache.find(c => c.clinic_code === clinicCode);
  const filtered = clinic
    ? deptCache.filter(d => d.clinic_id === clinic.id)
    : deptCache;

  userDeptFilter.innerHTML = '<option value="">전체</option>' +
    filtered.map(d => `<option value="${d.dept_code}">${ts(d.dept_name)}</option>`).join('');
  if (cur) userDeptFilter.value = cur;
}

function openAddDept() {
  editingDeptId = null;
  setVal('d_clinic_id', '');
  ['d_dept_code','d_dept_name'].forEach(id => setVal(id, ''));
  setVal('d_sort_order', '0');
  setVal('d_active', 'Y');
  // 현재 부서 탭 필터에 의원이 선택돼 있으면 모달에 미리 세팅
  const filterVal = document.getElementById('deptClinicFilter')?.value || '';
  if (filterVal) setVal('d_clinic_id', filterVal);
  document.getElementById('deptModalTitle').textContent = '부서 추가';
  openModal('deptModal');
}

function openEditDept(id) {
  const row = deptCache.find(r => r.id === id);
  if (!row) return;
  editingDeptId = id;
  setVal('d_clinic_id',  row.clinic_id || '');
  setVal('d_dept_code',  row.dept_code);
  setVal('d_dept_name',  row.dept_name);
  setVal('d_sort_order', row.sort_order ?? 0);
  setVal('d_active',     row.active);
  document.getElementById('deptModalTitle').textContent = '부서 수정';
  openModal('deptModal');
}
window.openEditDept = openEditDept;

async function saveDept() {
  const clinicId = val('d_clinic_id');
  if (!clinicId) throw new Error('소속 의원을 선택해주세요.');
  const payload = {
    dept_code:  val('d_dept_code'),
    dept_name:  val('d_dept_name'),
    clinic_id:  clinicId,
    sort_order: Number(val('d_sort_order') || 0),
    active:     val('d_active'),
    updated_at: new Date().toISOString(),
  };
  if (!payload.dept_code) throw new Error('부서 코드는 필수입니다.');
  if (!payload.dept_name) throw new Error('부서명은 필수입니다.');
  if (editingDeptId) {
    const { error } = await supabaseClient.from('departments').update(payload).eq('id', editingDeptId);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await supabaseClient.from('departments').insert(payload);
    if (error) throw new Error(error.message);
  }
}

async function deleteDept(id) {
  if (!confirm('부서를 삭제하시겠습니까?')) return;
  const { error } = await supabaseClient.from('departments').delete().eq('id', id);
  if (error) { alert('삭제 실패: ' + error.message); return; }
  await refreshDepts();
}
window.deleteDept = deleteDept;

async function refreshDepts() {
  const rows = await loadDepts();
  const filterVal = document.getElementById('deptClinicFilter')?.value || '';
  renderDepts(rows, filterVal || null);
}

/* ════════════════════════════════════════════
   사용자 (user_profiles)
════════════════════════════════════════════ */
async function loadUsers() {
  const { data, error } = await supabaseClient
    .from('user_profiles')
    .select('*')
    .order('clinic_code', { ascending: true });
  if (error) throw new Error(error.message);
  return data || [];
}

function renderUsers(rows, filterClinicCode, filterDeptCode) {
  userCache = rows;
  const list  = document.getElementById('userList');
  const empty = document.getElementById('userEmpty');
  if (!list) return;

  let filtered = rows;
  if (filterClinicCode) filtered = filtered.filter(r => r.clinic_code === filterClinicCode);
  if (filterDeptCode)   filtered = filtered.filter(r => r.team_code   === filterDeptCode);

  if (empty) empty.style.display = filtered.length ? 'none' : '';

  if (!window._userGrid) {
    window._userGrid =
  createMgGrid('userList', [
      { headerName: '이름',   field: 'user_name',  flex: 1, minWidth: 80, valueFormatter: p => p.value || '-' },
      { headerName: '역할',   field: 'role',       flex: 0, width: 90,
        cellRenderer: p => { const s = document.createElement('span'); s.innerHTML = badgeRole(p.value); return s; } },
      { headerName: '의원',   field: 'clinic_name', flex: 1, minWidth: 90, valueFormatter: p => p.value || '-' },
      { headerName: '팀/부서', flex: 1, minWidth: 90,
        valueGetter: p => p.data.team_name || p.data.department || '-' },
      { headerName: '전화',   field: 'phone',      flex: 1, minWidth: 110, valueFormatter: p => p.value || '-' },
      { headerName: '상태',   field: 'active',     flex: 0, width: 70,
        cellRenderer: p => { const s = document.createElement('span'); s.innerHTML = badgeActive(p.value); return s; } },
      { headerName: '', flex: 0, width: 140, sortable: false,
        cellRenderer: p => {
          const wrap = document.createElement('div'); wrap.style.cssText = 'display:flex;gap:4px;align-items:center;';
          const btnEdit = document.createElement('button'); btnEdit.className = 'btn btn-sm'; btnEdit.textContent = '수정';
          btnEdit.onclick = () => openEditUser(p.data.id);
          wrap.append(btnEdit);
          if (p.data.active !== 'Y') {
            const btnApprove = document.createElement('button'); btnApprove.className = 'btn btn-sm btn-primary'; btnApprove.textContent = '승인';
            btnApprove.onclick = () => approveUser(p.data.id);
            wrap.append(btnApprove);
          }
          return wrap;
        }},
    ], filtered, { pageSize: 15, fit: true, noRowsText: '등록된 사용자가 없습니다.' });
  } else {
    updateMgGrid(window._userGrid, filtered);
  }
}

/** 사용자 모달: 의원 선택 → 해당 의원 부서만 부서 select에 뿌리기 */
function onUserClinicSelectChange() {
  const clinicId = document.getElementById('u_clinic_select')?.value || '';
  fillDeptSelect('u_dept_select', '선택 안 함', clinicId || null, null);
}

async function approveUser(id) {
  if (!confirm('이 사용자를 승인하시겠습니까?')) return;
  const { error } = await supabaseClient
    .from('user_profiles')
    .update({ active: 'Y', role: 'user' })
    .eq('id', id);
  if (error) { alert('승인 실패: ' + error.message); return; }
  await refreshUsers();
}
window.approveUser = approveUser;

function openEditUser(id) {
  const row = userCache.find(r => r.id === id);
  if (!row) return;
  editingUserId = id;

  setVal('u_user_name',  row.user_name);
  setVal('u_phone',      row.phone);
  setVal('u_role',       row.role);
  setVal('u_active',     row.active);
  setVal('u_department', row.department);

  // 의원 select: clinic_code 기준으로 id 찾아 세팅
  const clinic = clinicCache.find(c => c.clinic_code === row.clinic_code);
  fillClinicSelect('u_clinic_select', '선택 안 함', clinic?.id || null);

  // 부서 select: 해당 의원 부서로 채운 뒤 team_code 기준으로 선택
  const dept = deptCache.find(d => d.dept_code === row.team_code);
  fillDeptSelect('u_dept_select', '선택 안 함', clinic?.id || null, dept?.id || null);

  document.getElementById('userModalTitle').textContent = '사용자 수정';
  openModal('userModal');
}
window.openEditUser = openEditUser;

async function saveUser() {
  // 선택된 의원 option에서 code/name 추출
  const clinicSel  = document.getElementById('u_clinic_select');
  const clinicOpt  = clinicSel?.options[clinicSel.selectedIndex];
  const clinic_code = clinicOpt?.dataset.code || '';
  const clinic_name = clinicOpt?.dataset.name || '';

  // 선택된 부서 option에서 code/name 추출
  const deptSel  = document.getElementById('u_dept_select');
  const deptOpt  = deptSel?.options[deptSel.selectedIndex];
  const team_code = deptOpt?.dataset.code || '';
  const team_name = deptOpt?.dataset.name || '';

  const payload = {
    user_name:   val('u_user_name'),
    phone:       val('u_phone'),
    role:        val('u_role'),
    clinic_code,
    clinic_name,
    team_code,
    team_name,
    department:  val('u_department'),
    active:      val('u_active'),
    updated_at:  new Date().toISOString(),
  };
  const { error } = await supabaseClient.from('user_profiles').update(payload).eq('id', editingUserId);
  if (error) throw new Error(error.message);
}

async function refreshUsers() {
  const rows = await loadUsers();
  const cc = document.getElementById('userClinicFilter')?.value || '';
  const dc = document.getElementById('userDeptFilter')?.value || '';
  renderUsers(rows, cc, dc);
}

/* ════════════════════════════════════════════
   저장 버튼 공통
════════════════════════════════════════════ */
function bindSaveBtn(btnId, saveFn, modalId, refreshFn) {
  document.getElementById(btnId)?.addEventListener('click', async () => {
    const btn = document.getElementById(btnId);
    btn.disabled = true;
    try {
      await saveFn();
      closeModal(modalId);
      await refreshFn();
    } catch (e) {
      alert('저장 실패: ' + e.message);
    } finally {
      btn.disabled = false;
    }
  });
}

/* ════════════════════════════════════════════
   필터 이벤트 바인딩
════════════════════════════════════════════ */
function initFilters() {
  // 부서 탭 — 의원 필터
  document.getElementById('deptClinicFilter')?.addEventListener('change', e => {
    renderDepts(deptCache, e.target.value || null);
  });

  // 사용자 탭 — 의원 필터
  document.getElementById('userClinicFilter')?.addEventListener('change', e => {
    syncDeptFilter();                        // 부서 필터 갱신
    setVal('userDeptFilter', '');           // 부서 필터 초기화
    const cc = e.target.value;
    renderUsers(userCache, cc, '');
  });

  // 사용자 탭 — 부서 필터
  document.getElementById('userDeptFilter')?.addEventListener('change', e => {
    const cc = document.getElementById('userClinicFilter')?.value || '';
    renderUsers(userCache, cc, e.target.value);
  });

  // 사용자 모달 — 의원 select → 부서 select 연동
  document.getElementById('u_clinic_select')?.addEventListener('change', onUserClinicSelectChange);
}

/* ════════════════════════════════════════════
   초기화
════════════════════════════════════════════ */
async function init() {
  currentUser = await auth.requireAdmin();
  if (!currentUser) return;

  initTabs();
  initFilters();

  document.getElementById('addClinicBtn')?.addEventListener('click', openAddClinic);
  document.getElementById('addDeptBtn')?.addEventListener('click', openAddDept);

  bindSaveBtn('clinicSaveBtn', saveClinic, 'clinicModal', refreshClinics);
  bindSaveBtn('deptSaveBtn',   saveDept,   'deptModal',   refreshDepts);
  bindSaveBtn('userSaveBtn',   saveUser,   'userModal',   refreshUsers);

  showGlobalLoading('데이터를 불러오는 중...');
  try {
    const [clinics, depts, users] = await Promise.all([
      loadClinics(),
      loadDepts(),
      loadUsers(),
    ]);
    // 순서 중요: clinic 먼저 → select 동기화 → dept/user 렌더
    renderClinics(clinics);   // clinicCache 세팅 + select 동기화
    renderDepts(depts, null); // deptCache 세팅 + 사용자 탭 부서 필터 동기화
    renderUsers(users, '', '');
  } catch (e) {
    alert('초기화 실패: ' + e.message);
    console.error('[master/org]', e);
  } finally {
    hideGlobalLoading();
  }
}

document.addEventListener('DOMContentLoaded', init);
