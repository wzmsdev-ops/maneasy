/**
 * assets/js/master/org.js
 * 조직 관리 — 의원 / 부서 / 사용자
 * admin role만 접근 가능
 */
'use strict';

let currentUser = null;

// 편집 중인 row ID
let editingClinicId = null;
let editingDeptId   = null;
let editingUserId   = null;

// 캐시
let clinicCache = [];

/* ── 유틸 ─────────────────────────────────── */
function ts(v) {
  return String(v == null ? '' : v)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function val(id) { return (document.getElementById(id)?.value || '').trim(); }
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

/* ── 탭 ────────────────────────────────────── */
function initTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.tab;
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`tab-${target}`)?.classList.add('active');
    });
  });
}

/* ── 모달 ────────────────────────────────────── */
function openModal(id) { document.getElementById(id)?.classList.add('is-open'); }
function closeModal(id) { document.getElementById(id)?.classList.remove('is-open'); }
window.closeModal = closeModal;

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

  if (!rows.length) { empty.style.display = ''; list.innerHTML = ''; return; }
  empty.style.display = 'none';

  list.innerHTML = `
    <table class="data-table">
      <thead><tr>
        <th>코드</th><th>의원명</th><th>전화</th><th>주소</th><th>순서</th><th>상태</th><th class="action-cell"></th>
      </tr></thead>
      <tbody>${rows.map(r => `
        <tr>
          <td><code>${ts(r.clinic_code)}</code></td>
          <td>${ts(r.clinic_name)}</td>
          <td>${ts(r.phone || '-')}</td>
          <td>${ts(r.address || '-')}</td>
          <td style="text-align:center">${r.sort_order}</td>
          <td>${badgeActive(r.active)}</td>
          <td class="action-cell">
            <button class="btn btn-sm" onclick="openEditClinic('${r.id}')">수정</button>
            <button class="btn btn-sm btn-danger" onclick="deleteClinic('${r.id}')">삭제</button>
          </td>
        </tr>`).join('')}
      </tbody>
    </table>`;
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
  if (!confirm('의원을 삭제하시겠습니까?')) return;
  const { error } = await supabaseClient.from('clinics').delete().eq('id', id);
  if (error) { alert('삭제 실패: ' + error.message); return; }
  await refreshClinics();
}
window.deleteClinic = deleteClinic;

async function refreshClinics() {
  const rows = await loadClinics();
  renderClinics(rows);
  // 부서 모달 select 동기화
  populateClinicSelect(rows);
}

/* ════════════════════════════════════════════
   부서 (departments)
════════════════════════════════════════════ */
let deptCache = [];

function populateClinicSelect(clinics) {
  const sel = document.getElementById('d_clinic_id');
  if (!sel) return;
  sel.innerHTML = '<option value="">선택 안 함</option>' +
    clinics.map(c => `<option value="${c.id}">${ts(c.clinic_name)}</option>`).join('');
}

async function loadDepts() {
  const { data, error } = await supabaseClient
    .from('departments')
    .select('*, clinics(clinic_name)')
    .order('sort_order', { ascending: true });
  if (error) throw new Error(error.message);
  return data || [];
}

function renderDepts(rows) {
  deptCache = rows;
  const list  = document.getElementById('deptList');
  const empty = document.getElementById('deptEmpty');
  if (!list) return;

  if (!rows.length) { empty.style.display = ''; list.innerHTML = ''; return; }
  empty.style.display = 'none';

  list.innerHTML = `
    <table class="data-table">
      <thead><tr>
        <th>코드</th><th>부서명</th><th>소속 의원</th><th>순서</th><th>상태</th><th class="action-cell"></th>
      </tr></thead>
      <tbody>${rows.map(r => `
        <tr>
          <td><code>${ts(r.dept_code)}</code></td>
          <td>${ts(r.dept_name)}</td>
          <td>${ts(r.clinics?.clinic_name || '-')}</td>
          <td style="text-align:center">${r.sort_order}</td>
          <td>${badgeActive(r.active)}</td>
          <td class="action-cell">
            <button class="btn btn-sm" onclick="openEditDept('${r.id}')">수정</button>
            <button class="btn btn-sm btn-danger" onclick="deleteDept('${r.id}')">삭제</button>
          </td>
        </tr>`).join('')}
      </tbody>
    </table>`;
}

function openAddDept() {
  editingDeptId = null;
  ['d_dept_code','d_dept_name'].forEach(id => setVal(id, ''));
  setVal('d_sort_order', '0');
  setVal('d_active', 'Y');
  setVal('d_clinic_id', '');
  document.getElementById('deptModalTitle').textContent = '부서 추가';
  openModal('deptModal');
}

function openEditDept(id) {
  const row = deptCache.find(r => r.id === id);
  if (!row) return;
  editingDeptId = id;
  setVal('d_dept_code',  row.dept_code);
  setVal('d_dept_name',  row.dept_name);
  setVal('d_clinic_id',  row.clinic_id || '');
  setVal('d_sort_order', row.sort_order ?? 0);
  setVal('d_active',     row.active);
  document.getElementById('deptModalTitle').textContent = '부서 수정';
  openModal('deptModal');
}
window.openEditDept = openEditDept;

async function saveDept() {
  const payload = {
    dept_code:  val('d_dept_code'),
    dept_name:  val('d_dept_name'),
    clinic_id:  val('d_clinic_id') || null,
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
  renderDepts(rows);
}

/* ════════════════════════════════════════════
   사용자 (user_profiles)
════════════════════════════════════════════ */
let userCache = [];

async function loadUsers() {
  const { data, error } = await supabaseClient
    .from('user_profiles')
    .select('*')
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  return data || [];
}

function renderUsers(rows) {
  userCache = rows;
  const list  = document.getElementById('userList');
  const empty = document.getElementById('userEmpty');
  if (!list) return;

  if (!rows.length) { empty.style.display = ''; list.innerHTML = ''; return; }
  empty.style.display = 'none';

  list.innerHTML = `
    <table class="data-table">
      <thead><tr>
        <th>이름</th><th>역할</th><th>의원</th><th>팀</th><th>부서</th><th>전화</th><th>상태</th><th class="action-cell"></th>
      </tr></thead>
      <tbody>${rows.map(r => `
        <tr>
          <td>${ts(r.user_name || '-')}</td>
          <td>${badgeRole(r.role)}</td>
          <td>${ts(r.clinic_name || '-')}</td>
          <td>${ts(r.team_name || '-')}</td>
          <td>${ts(r.department || '-')}</td>
          <td>${ts(r.phone || '-')}</td>
          <td>${badgeActive(r.active)}</td>
          <td class="action-cell">
            <button class="btn btn-sm" onclick="openEditUser('${r.id}')">수정</button>
          </td>
        </tr>`).join('')}
      </tbody>
    </table>`;
}

function openEditUser(id) {
  const row = userCache.find(r => r.id === id);
  if (!row) return;
  editingUserId = id;
  setVal('u_user_name',   row.user_name);
  setVal('u_phone',       row.phone);
  setVal('u_role',        row.role);
  setVal('u_clinic_code', row.clinic_code);
  setVal('u_clinic_name', row.clinic_name);
  setVal('u_team_code',   row.team_code);
  setVal('u_team_name',   row.team_name);
  setVal('u_department',  row.department);
  setVal('u_active',      row.active);
  document.getElementById('userModalTitle').textContent = '사용자 수정';
  openModal('userModal');
}
window.openEditUser = openEditUser;

async function saveUser() {
  const payload = {
    user_name:   val('u_user_name'),
    phone:       val('u_phone'),
    role:        val('u_role'),
    clinic_code: val('u_clinic_code'),
    clinic_name: val('u_clinic_name'),
    team_code:   val('u_team_code'),
    team_name:   val('u_team_name'),
    department:  val('u_department'),
    active:      val('u_active'),
    updated_at:  new Date().toISOString(),
  };
  const { error } = await supabaseClient.from('user_profiles').update(payload).eq('id', editingUserId);
  if (error) throw new Error(error.message);
}

async function refreshUsers() {
  const rows = await loadUsers();
  renderUsers(rows);
}

/* ════════════════════════════════════════════
   저장 버튼 공통 핸들러
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
   초기화
════════════════════════════════════════════ */
async function init() {
  currentUser = await auth.requireAdmin();
  if (!currentUser) return;

  initTabs();

  // 버튼 바인딩
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
    renderClinics(clinics);
    populateClinicSelect(clinics);
    renderDepts(depts);
    renderUsers(users);
  } catch (e) {
    alert('초기화 실패: ' + e.message);
    console.error('[master/org]', e);
  } finally {
    hideGlobalLoading();
  }
}

document.addEventListener('DOMContentLoaded', init);
