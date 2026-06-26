/**
 * equipment/equipment-detail.js
 * Supabase SDK 직접 호출 버전
 * 장비 상세 + 이력 + 재고조사 + 정도관리 탭 통합
 */

'use strict';

let currentUser = null;
let equipmentId = null;
let currentEquipment = null;

/* ── 유틸 ─────────────────────────────────── */
function textSafe(v) {
  return String(v == null ? '' : v)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function formatDate(v) {
  const s = String(v || '').trim();
  if (!s) return '-';
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : s;
}
function formatTs(v) {
  if (!v) return '-';
  return new Date(v).toLocaleString('ko-KR', { hour12: false }).slice(0,16);
}
function qs(sel) { return document.querySelector(sel); }
function setText(id, v) { const el = document.getElementById(id); if (el) el.textContent = v ?? '-'; }

/* ── 장비 상세 로드 ────────────────────────── */
async function loadEquipment() {
  const { data, error } = await supabaseClient
    .from('equipments')
    .select('*')
    .eq('id', equipmentId)
    .single();
  if (error) throw new Error(error.message);
  return data;
}

function renderEquipment(eq) {
  const STATUS_LABEL = CONFIG.EQUIPMENT_STATUS_LABEL || {};
  setText('detailEquipmentName',    eq.equipment_name);
  setText('detailModelName',        eq.model_name || '-');
  setText('detailManufacturer',     eq.manufacturer || '-');
  setText('detailManufactureDate',  formatDate(eq.manufacture_date));
  setText('detailPurchaseDate',     formatDate(eq.purchase_date));
  setText('detailSerialNo',         eq.serial_no || '-');
  setText('detailVendor',           eq.vendor || '-');
  setText('detailAcquisitionCost',  eq.acquisition_cost != null ? Number(eq.acquisition_cost).toLocaleString('ko-KR') + '원' : '-');
  setText('detailMaintenanceEndDate', formatDate(eq.maintenance_end_date));
  setText('detailClinicName',       eq.clinic_name || eq.team_name || '-');
  setText('detailDepartment',       eq.department || '-');
  setText('detailLocation',         eq.location || '-');
  setText('detailCurrentUser',      eq.current_user_name || '-');
  setText('detailStatus',           STATUS_LABEL[eq.status] || eq.status || '-');
  setText('detailMemo',             eq.memo || '-');
  setText('detailManagerName',      eq.manager_name || '-');
  setText('detailManagerPhone',     eq.manager_phone || '-');
  setText('detailCreatedAt',        formatTs(eq.created_at));
  setText('detailUpdatedAt',        formatTs(eq.updated_at));

  if (eq.photo_url) {
    const img = document.getElementById('detailPhoto');
    if (img) {
      img.src = eq.photo_url;
      img.style.display = '';
      const emptyText = img.nextElementSibling;
      if (emptyText) emptyText.style.display = 'none';
    }
  }

  // 액션바 동기화
  const abName   = document.getElementById('actionbarEquipmentName');
  const abModel  = document.getElementById('actionbarModelName');
  const abStatus = document.getElementById('actionbarStatus');
  if (abName)   abName.textContent   = eq.equipment_name || '—';
  if (abModel)  abModel.textContent  = eq.model_name || '';
  if (abStatus) abStatus.textContent = STATUS_LABEL[eq.status] || eq.status || '—';
}

/* ── 이력 ──────────────────────────────────── */
async function loadHistories() {
  const { data, error } = await supabaseClient
    .from('histories')
    .select('*')
    .eq('equipment_id', equipmentId)
    .order('work_date', { ascending: false });
  if (error) throw new Error(error.message);
  return data || [];
}

let _historyGrid = null;
function renderHistories(rows) {
  const empty = document.getElementById('historyEmpty');
  if (empty) empty.style.display = rows.length ? 'none' : '';

  const cols = [
    { headerName: '유형',   field: 'history_type',  flex: 1, minWidth: 80,  valueFormatter: p => p.value || '-' },
    { headerName: '작업일', field: 'work_date',     flex: 1, minWidth: 90,  valueFormatter: p => formatDate(p.value) },
    { headerName: '담당자', field: 'requester',     flex: 1, minWidth: 80,  valueFormatter: p => p.value || '-' },
    { headerName: '금액',   field: 'amount',        flex: 1, minWidth: 90,
      valueFormatter: p => p.value != null ? Number(p.value).toLocaleString('ko-KR') + '원' : '-' },
    { headerName: '결과',   field: 'result_status', flex: 1, minWidth: 80,  valueFormatter: p => p.value || '-' },
    { headerName: '내용',   field: 'description',   flex: 2, minWidth: 120, valueFormatter: p => p.value || '-' },
  ];

  if (_historyGrid) { updateMgGrid(_historyGrid, rows); return; }
  _historyGrid = createMgGrid('historyList', cols, rows, {
    pageSize: 10, fit: false, noRowsText: '이력이 없습니다.',
  });
}

/* ── 재고조사 ──────────────────────────────── */
async function loadInventoryLogs() {
  const { data, error } = await supabaseClient
    .from('inventory_logs')
    .select('*')
    .eq('equipment_id', equipmentId)
    .order('checked_at', { ascending: false });
  if (error) throw new Error(error.message);
  return data || [];
}

let _inventoryGrid = null;
function renderInventoryLogs(rows) {
  const empty = document.getElementById('inventoryEmpty');
  if (empty) empty.style.display = rows.length ? 'none' : '';

  const cols = [
    { headerName: '조사일시', field: 'checked_at',      flex: 1, minWidth: 120, valueFormatter: p => formatTs(p.value) },
    { headerName: '조사자',   field: 'checked_by_name', flex: 1, minWidth: 80,  valueFormatter: p => p.value || '-' },
    { headerName: '상태',     field: 'status_at_check', flex: 1, minWidth: 80,  valueFormatter: p => p.value || '-' },
    { headerName: '위치',     field: 'location_at_check', flex: 1, minWidth: 80, valueFormatter: p => p.value || '-' },
    { headerName: '메모',     field: 'memo',            flex: 2, minWidth: 100, valueFormatter: p => p.value || '-' },
  ];

  if (_inventoryGrid) { updateMgGrid(_inventoryGrid, rows); return; }
  _inventoryGrid = createMgGrid('inventoryList', cols, rows, {
    pageSize: 10, fit: false, noRowsText: '재고조사 이력이 없습니다.',
  });
}

/* ── 정도관리 항목 ─────────────────────────── */
async function loadQcItems() {
  const { data, error } = await supabaseClient
    .from('lj_items')
    .select('*, lj_entries(count)')
    .eq('equipment_id', equipmentId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  return data || [];
}

let _qcGrid = null;
function renderQcItems(rows) {
  const empty = document.getElementById('qcItemEmpty');
  if (empty) empty.style.display = rows.length ? 'none' : '';

  const cols = [
    { headerName: '항목명', field: 'item_name', flex: 2, minWidth: 120 },
    { headerName: '유형',   field: 'item_type', flex: 1, minWidth: 70,
      valueFormatter: p => p.value === 'quantitative' ? '정량' : '정성' },
    { headerName: '단위',   field: 'unit',      flex: 1, minWidth: 60,  valueFormatter: p => p.value || '-' },
    { headerName: 'Mean',   field: 'mean',      flex: 1, minWidth: 70,  valueFormatter: p => p.value != null ? p.value : '-' },
    { headerName: 'SD',     field: 'sd',        flex: 1, minWidth: 70,  valueFormatter: p => p.value != null ? p.value : '-' },
    { headerName: '데이터', flex: 1, minWidth: 70,
      valueGetter: p => (p.data.lj_entries?.[0]?.count ?? 0) + '건' },
    { headerName: '',       flex: 1, minWidth: 100, sortable: false,
      cellRenderer: p => {
        const btn = document.createElement('button');
        btn.className = 'btn btn-sm';
        btn.textContent = '데이터 입력';
        btn.onclick = () => goQcData(p.data.id);
        return btn;
      }},
  ];

  if (_qcGrid) { updateMgGrid(_qcGrid, rows); return; }
  _qcGrid = createMgGrid('qcItemList', cols, rows, {
    pageSize: 10, fit: false, noRowsText: '등록된 정도관리 항목이 없습니다.',
  });
}

function goQcData(itemId) {
  parent.shellNavigate?.(`qc/data?equipment_id=${equipmentId}&item_id=${itemId}`);
}

/* ── 탭 전환 ───────────────────────────────── */
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

/* ── 초기화 ────────────────────────────────── */
async function init() {
  currentUser = await auth.requireAuth();
  if (!currentUser) return;

  const params = new URLSearchParams(location.search);
  equipmentId = params.get('id');
  if (!equipmentId) { alert('장비 ID가 없습니다.'); return; }

  initTabs();

  document.getElementById('editBtn')?.addEventListener('click', () => {
    parent.shellNavigate?.(`equipment/form?id=${equipmentId}`);
  });

  document.getElementById('addQcItemBtn')?.addEventListener('click', () => {
    parent.shellNavigate?.(`qc/items?equipment_id=${equipmentId}`);
  });

  showGlobalLoading('장비 정보를 불러오는 중...');
  try {
    const [eq, histories, inventoryLogs, qcItems] = await Promise.all([
      loadEquipment(),
      loadHistories(),
      loadInventoryLogs(),
      loadQcItems(),
    ]);
    currentEquipment = eq;
    renderEquipment(eq);
    renderHistories(histories);
    renderInventoryLogs(inventoryLogs);
    renderQcItems(qcItems);
  } catch (e) {
    console.error('[equipment-detail]', e);
    alert('데이터를 불러오지 못했습니다: ' + e.message);
  } finally {
    hideGlobalLoading();
  }
}

function initEquipmentDetail() { init(); }
document.addEventListener('DOMContentLoaded', init);
