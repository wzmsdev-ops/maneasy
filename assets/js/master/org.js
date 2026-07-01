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

/* ── 앱별 권한 ─────────────────────────────────
   app.html MENU_META / 사이드바 노출 로직과 동일한 페이지 키 사용 */
const PAGE_GROUPS = [
  { app: '의료장비 관리', pages: [
    { key: 'equipment/dashboard', label: '대시보드' },
    { key: 'equipment/list',      label: '장비 목록' },
    { key: 'equipment/form',      label: '장비 등록·수정' },
    { key: 'equipment/detail',    label: '장비 상세' },
  ]},
  { app: '자재관리', pages: [
    { key: 'materials/purchase-request', label: '발주요청' },
    { key: 'materials/use-stock',        label: '사용처리' },
    { key: 'materials/procurement',      label: '발주 관리' },
    { key: 'materials/stock',            label: '재고 관리' },
    { key: 'materials/material-stats',   label: '자재 통계' },
  ]},
  { app: '업무일정 관리', pages: [
    { key: 'task/task-manager', label: '업무일정·일지' },
  ]},
  { app: '사인물 신청', pages: [
    { key: 'signage/apply',   label: '신청' },
    { key: 'signage/history', label: '신청내역 (level: manager/admin = 전체 처리, user = 본인만)' },
  ]},
  { app: '프로그램 요청', pages: [
    { key: 'program-request/apply',   label: '신청' },
    { key: 'program-request/history', label: '신청내역 (level: manager/admin = 전체 처리, user = 본인만)' },
  ]},
  { app: '마스터 관리', pages: [
    { key: 'master/org',    label: '의원·부서·사용자' },
    { key: 'master/supply', label: '자재·거래처' },
  ]},
];

// 역할별 기본 page_perms
// role: admin = 전체 의원 조회 / user = 소속 의원만
// 접근권한: 접근불가 / user / edit / manager / admin
const ROLE_DEFAULT_PAGES = {
  user: {
    'equipment/dashboard':      'user',
    'equipment/list':           'user',
    'equipment/detail':         'user',
    'equipment/form':           '접근불가',
    'materials/purchase-request':  'user',
    'materials/use-stock':         'user',
    'materials/procurement':       '접근불가',
    'materials/stock':             '접근불가',
    'materials/material-stats':    'user',
    'task/task-manager':        'user',
    'signage/apply':            'user',
    'signage/history':          'user',
    'program-request/apply':    'user',
    'program-request/history':  'user',
    'master/org':               '접근불가',
    'master/supply':            '접근불가',
  },
  admin: {
    'equipment/dashboard':      'user',
    'equipment/list':           'user',
    'equipment/detail':         'user',
    'equipment/form':           'edit',
    'materials/purchase-request':  'user',
    'materials/use-stock':         'user',
    'materials/procurement':       'manager',
    'materials/stock':             'manager',
    'materials/material-stats':    'user',
    'task/task-manager':        'admin',
    'signage/apply':            'user',
    'signage/history':          'admin',
    'program-request/apply':    'user',
    'program-request/history':  'admin',
    'master/org':               'admin',
    'master/supply':            'admin',
  },
};

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
      `<option value="${d.id}" data-code="${ts(d.dept_code)}" data-name="${ts(d.dept_name)}" data-team-group="${ts(d.team_group_code||'')}">${ts(d.dept_name)}</option>`
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

  if (empty) empty.style.display = 'none';

  if (!window._clinicGrid) {
    window._clinicGrid =
  createMgGrid('clinicList', [
      { headerName: '코드',       field: 'clinic_code',  flex: 1, minWidth: 90 },
      { headerName: '의원명',     field: 'clinic_name',  flex: 2, minWidth: 120 },
      { headerName: '사업자번호', field: 'business_no',  width: 130, valueFormatter: p => p.value || '-' },
      { headerName: '요양기관번호', field: 'care_inst_no', width: 120, valueFormatter: p => p.value || '-' },
      { headerName: '전화',       field: 'phone',        flex: 1, minWidth: 110, valueFormatter: p => p.value || '-' },
      { headerName: '주소',       field: 'address',      flex: 2, minWidth: 140, valueFormatter: p => p.value || '-' },
      { headerName: '순서',   field: 'sort_order',  flex: 0, width: 60 },
      { headerName: '상태',   field: 'active',      flex: 0, width: 70,
        cellRenderer: p => { const s = document.createElement('span'); s.innerHTML = badgeActive(p.value); return s; } },
      { headerName: '', flex: 0, width: 120, sortable: false,
        cellRenderer: p => {
          const wrap = document.createElement('div'); wrap.style.cssText = 'display:flex;gap:4px;align-items:center;';
          const e = document.createElement('button'); e.className = 'btn btn-sm'; e.textContent = '수정'; e.onclick = () => window.openEditClinic(p.data.id);
          const d = document.createElement('button'); d.className = 'btn btn-sm btn-danger'; d.textContent = '삭제'; d.onclick = () => window.deleteClinic(p.data.id);
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
  ['c_clinic_code','c_clinic_name','c_address','c_phone','c_business_no','c_care_inst_no'].forEach(id => setVal(id, ''));
  setVal('c_sort_order', '0');
  setVal('c_active', 'Y');
  document.getElementById('clinicModalTitle').textContent = '의원 추가';
  openModal('clinicModal');
}

function openEditClinic(id) {
  const row = clinicCache.find(r => r.id === id);
  if (!row) return;
  editingClinicId = id;
  setVal('c_clinic_code',   row.clinic_code);
  setVal('c_clinic_name',   row.clinic_name);
  setVal('c_business_no',   row.business_no   || '');
  setVal('c_care_inst_no',  row.care_inst_no  || '');
  setVal('c_address',       row.address);
  setVal('c_phone',         row.phone);
  setVal('c_sort_order',  row.sort_order ?? 0);
  setVal('c_active',      row.active);
  document.getElementById('clinicModalTitle').textContent = '의원 수정';
  openModal('clinicModal');
}
window.openEditClinic = openEditClinic;

async function saveClinic() {
  const payload = {
    clinic_code: editingClinicId ? val('c_clinic_code') : await (async () => {
      const { data } = await supabaseClient.rpc('generate_clinic_code');
      return data || 'CLINIC-' + Date.now().toString().slice(-6);
    })(),
    clinic_name:  val('c_clinic_name'),
    business_no:  val('c_business_no')  || '',
    care_inst_no: val('c_care_inst_no') || '',
    address:      val('c_address'),
    phone:        val('c_phone'),
    sort_order:  Number(val('c_sort_order') || 0),
    active:      val('c_active'),
    updated_at:  new Date().toISOString(),
  };
  // clinic_code는 자동생성
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

  if (empty) empty.style.display = 'none';

  if (!window._deptGrid) {
    window._deptGrid =
  createMgGrid('deptList', [
      { headerName: '코드',     field: 'dept_code',  flex: 1, minWidth: 90 },
      { headerName: '부서명',   field: 'dept_name',  flex: 2, minWidth: 100 },
      { headerName: '소속 의원', flex: 1, minWidth: 100,
        valueGetter: p => p.data.clinics?.clinic_name || '-' },
      { headerName: '공유그룹', field: 'team_group_code', flex: 1, minWidth: 90,
        valueGetter: p => p.data.team_group_code || '-' },
      { headerName: '순서',     field: 'sort_order', flex: 0, width: 60 },
      { headerName: '상태',     field: 'active',     flex: 0, width: 70,
        cellRenderer: p => { const s = document.createElement('span'); s.innerHTML = badgeActive(p.value); return s; } },
      { headerName: '', flex: 0, width: 120, sortable: false,
        cellRenderer: p => {
          const wrap = document.createElement('div'); wrap.style.cssText = 'display:flex;gap:4px;align-items:center;';
          const e = document.createElement('button'); e.className = 'btn btn-sm'; e.textContent = '수정'; e.onclick = () => window.openEditDept(p.data.id);
          const d = document.createElement('button'); d.className = 'btn btn-sm btn-danger'; d.textContent = '삭제'; d.onclick = () => window.deleteDept(p.data.id);
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
  ['d_dept_code','d_dept_name','d_team_group_code'].forEach(id => setVal(id, ''));
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
  setVal('d_team_group_code', row.team_group_code || '');
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
    dept_code: editingDeptId ? val('d_dept_code') : await (async () => {
      const { data } = await supabaseClient.rpc('generate_dept_code');
      return data || 'DEPT-' + Date.now().toString().slice(-6);
    })(),
    dept_name:  val('d_dept_name'),
    clinic_id:  clinicId,
    team_group_code: val('d_team_group_code').trim(),
    sort_order: Number(val('d_sort_order') || 0),
    active:     val('d_active'),
    updated_at: new Date().toISOString(),
  };
  // dept_code는 자동생성
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
    .from('user_profiles_with_email')
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

  const pendingCount = rows.filter(r => r.active !== 'Y').length;
  const pendingEl = document.getElementById('userPendingCount');
  if (pendingEl) pendingEl.textContent = pendingCount ? `(${pendingCount})` : '';

  let filtered = rows;
  if (filterClinicCode) filtered = filtered.filter(r => r.clinic_code === filterClinicCode);
  if (filterDeptCode)   filtered = filtered.filter(r => r.team_code   === filterDeptCode);
  if (document.getElementById('userPendingOnly')?.checked) filtered = filtered.filter(r => r.active !== 'Y');

  if (empty) empty.style.display = 'none';

  if (!window._userGrid) {
    window._userGrid =
  createMgGrid('userList', [
      { headerName: '이름',   field: 'user_name',  flex: 1, minWidth: 80, valueFormatter: p => p.value || '-' },
      { headerName: '이메일', field: 'email',      flex: 2, minWidth: 160, valueFormatter: p => p.value || '-' },
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
          btnEdit.onclick = () => window.openEditUser(p.data.id);
          wrap.append(btnEdit);
          if (p.data.active !== 'Y') {
            const btnApprove = document.createElement('button'); btnApprove.className = 'btn btn-sm btn-primary'; btnApprove.textContent = '승인';
            btnApprove.onclick = () => window.approveUser(p.data.id);
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

  // 승인 전 사용자 이름/이메일 조회
  const { data: userData } = await supabaseClient
    .from('user_profiles_with_email')
    .select('user_name, email')
    .eq('id', id)
    .single();

  const { error } = await supabaseClient
    .from('user_profiles')
    .update({ active: 'Y', role: 'user' })
    .eq('id', id);
  if (error) { alert('승인 실패: ' + error.message); return; }

  // 승인 완료 알림 메일 발송
  if (userData && typeof gasNotify === 'function') {
    gasNotify('approvalNotice', { name: userData.user_name, email: userData.email });
  }

  await refreshUsers();
}
window.approveUser = approveUser;

/** 권한 레벨 옵션 */
const PERM_LEVELS = ['접근불가', 'user', 'edit', 'manager', 'admin'];
const PERM_COLORS = {
  '접근불가': '#dc2626',
  'user':     '#6b7280',
  'edit':     '#7c3aed',
  'manager':  '#d97706',
  'admin':    '#2563eb',
};

let _gridUserPerm = null;

/** 앱 접근 권한 AG Grid 렌더링 */
function renderUserPermBody(pagePerms, disabled) {
  // pagePerms: { "page/key": "user"|"edit"|"manager"|"admin" } 또는 레거시 배열
  // 레거시 배열 호환
  let permMap = {};
  if (Array.isArray(pagePerms)) {
    pagePerms.forEach(k => { permMap[k] = 'user'; });
  } else if (pagePerms && typeof pagePerms === 'object') {
    permMap = { ...pagePerms };
  }

  // 행 데이터 생성
  const rows = [];
  PAGE_GROUPS.forEach(group => {
    group.pages.forEach(p => {
      rows.push({
        _key:   p.key,
        app:    group.app,
        label:  p.label,
        level:  permMap[p.key] || '접근불가',
      });
    });
  });

  const el = document.getElementById('userPermGrid');
  if (!el) return;

  const colDefs = [
    { headerName: '앱', field: 'app', width: 110, rowGroup: false,
      headerClass: 'ag-left-header',
      cellStyle: { display:'flex', alignItems:'center', justifyContent:'flex-start',
                   fontSize:'11px', color:'#6b7280', fontWeight:600 },
    },
    { headerName: '페이지', field: 'label', flex: 1,
      headerClass: 'ag-left-header',
      cellStyle: { display:'flex', alignItems:'center', justifyContent:'flex-start', fontSize:'12px' },
    },
    { headerName: '접근 권한', field: 'level', width: 160,
      editable: false,
      cellRenderer: function(p) {
        if (disabled) {
          const v = p.value || '접근불가';
          const color = PERM_COLORS[v] || '#6b7280';
          return `<span style="display:inline-flex;align-items:center;gap:5px;">
            <span style="width:8px;height:8px;border-radius:50%;background:${color};flex-shrink:0;"></span>
            <span style="color:${color};font-weight:600;font-size:11px;">${v}</span>
          </span>`;
        }
        // 드롭다운 select 렌더링 (인라인, 셀 클릭 없이 바로 변경)
        const sel = document.createElement('select');
        sel.style.cssText = 'width:100%;height:100%;padding:0 8px;border:none;border-radius:0;font-size:11px;font-weight:600;outline:none;cursor:pointer;background:transparent;box-sizing:border-box;';
        PERM_LEVELS.forEach(lv => {
          const opt = document.createElement('option');
          opt.value = lv;
          opt.textContent = lv;
          if (lv === (p.value || '접근불가')) opt.selected = true;
          sel.appendChild(opt);
        });
        sel.style.color = PERM_COLORS[p.value || '접근불가'] || '#6b7280';
        sel.addEventListener('change', function() {
          p.node.data.level = sel.value;  // 직접 data 수정 (editable:false 환경)
          sel.style.color = PERM_COLORS[sel.value] || '#6b7280';
        });
        return sel;
      },
    },
  ];

  if (_gridUserPerm) {
    _gridUserPerm.destroy();
    _gridUserPerm = null;
    el.innerHTML = '';
  }

  _gridUserPerm = agGrid.createGrid(el, {
    columnDefs: colDefs,
    rowData: rows,
    rowHeight: 34,
    headerHeight: 34,
    suppressCellFocus: true,
    suppressHorizontalScroll: false,
    stopEditingWhenCellsLoseFocus: true,
    singleClickEdit: false,
    defaultColDef: {
      sortable: false, resizable: true, suppressMovable: true,
      cellStyle: { display:'flex', alignItems:'center', justifyContent:'center' },
    },
    onGridReady: function(p) {
      setTimeout(() => { if (el.offsetWidth > 0) p.api.sizeColumnsToFit(); }, 50);
    },
  });
}

/** 현재 그리드에서 page_perms 객체 추출 */
function getPagePermsFromGrid() {
  if (!_gridUserPerm) return {};
  const result = {};
  _gridUserPerm.forEachNode(function(node) {
    if (node.data.level && node.data.level !== '접근불가') {
      result[node.data._key] = node.data.level;
    }
  });
  return result;
}

/** 역할 select가 바뀌면 */
function onUserRoleChange() {
  const role = val('u_role') || 'user';
  document.getElementById('u_perm_roleLabel').textContent = role;
  if (document.getElementById('u_perm_useDefault')?.checked) {
    if (_gridUserPerm) { try { _gridUserPerm.destroy(); } catch(e) {} _gridUserPerm = null; }
    const _permEl = document.getElementById('userPermGrid');
    if (_permEl) _permEl.innerHTML = '';
    renderUserPermBody(ROLE_DEFAULT_PAGES[role] || {}, true);
  }
}
window.onUserRoleChange = onUserRoleChange;

/** "역할 기본값 사용" 토글 */
function onUserPermUseDefaultChange() {
  const useDefault = document.getElementById('u_perm_useDefault')?.checked;
  const role = val('u_role') || 'user';
  if (useDefault) {
    renderUserPermBody(ROLE_DEFAULT_PAGES[role] || {}, true);
  } else {
    // 직접 설정 모드 — 현재 그리드 상태 유지하되 편집 가능하게
    const cur = getPagePermsFromGrid();
    renderUserPermBody(cur, false);
  }
}
window.onUserPermUseDefaultChange = onUserPermUseDefaultChange;

function openEditUser(id) {
  const row = userCache.find(r => r.id === id);
  if (!row) return;
  editingUserId = id;

  setVal('u_email',      row.email || '');
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

  // 앱 접근 권한 — page_perms가 비어있으면 역할 기본값 사용 모드
  const pagePerms = row.page_perms || null;
  // page_perms가 null/undefined일 때만 역할 기본값 사용, 빈 객체도 직접설정으로 처리
  const useDefault = pagePerms === null || pagePerms === undefined;
  document.getElementById('u_perm_useDefault').checked = useDefault;
  document.getElementById('u_perm_roleLabel').textContent = row.role || '-';
  // 모달 열 때마다 그리드 완전 재생성
  if (_gridUserPerm) { try { _gridUserPerm.destroy(); } catch(e) {} _gridUserPerm = null; }
  const permEl = document.getElementById('userPermGrid');
  if (permEl) permEl.innerHTML = '';
  renderUserPermBody(useDefault ? (ROLE_DEFAULT_PAGES[row.role] || {}) : pagePerms, useDefault);

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
  const team_group_code = deptOpt?.dataset.teamGroup || '';

  const useDefault = document.getElementById('u_perm_useDefault')?.checked;
  const page_perms = useDefault ? null : (getPagePermsFromGrid() || {});

  const payload = {
    user_name:   val('u_user_name'),
    phone:       val('u_phone'),
    role:        val('u_role'),
    clinic_code,
    clinic_name,
    team_code,
    team_name,
    team_group_code,
    department:  val('u_department'),
    active:      val('u_active'),
    page_perms:  page_perms || {},
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
