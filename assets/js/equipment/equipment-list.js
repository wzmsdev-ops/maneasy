/**
 * equipment/equipment-list.js
 * Supabase SDK 직접 호출 버전
 */

'use strict';

let currentUser = null;
let allEquipments = [];
let gridApi = null;

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

/* ── 데이터 로드 ───────────────────────────── */
async function loadEquipments() {
  const { data, error } = await supabaseClient
    .from('equipments')
    .select('*')
    .eq('deleted_yn', 'N')
    .order('created_at', { ascending: false });

  if (error) throw new Error(error.message);
  return data || [];
}

/* ── AG Grid 렌더링 ────────────────────────── */
function renderGrid(rows) {
  const STATUS_LABEL = CONFIG.EQUIPMENT_STATUS_LABEL || {};

  const columnDefs = [
    { headerName: '장비명',   field: 'equipment_name', flex: 2, minWidth: 140 },
    { headerName: '모델명',   field: 'model_name',     flex: 2, minWidth: 120 },
    { headerName: '소속',     valueGetter: p => p.data.clinic_name || p.data.team_name || '-', flex: 2, minWidth: 120 },
    { headerName: '위치',     field: 'location',       flex: 1, minWidth: 100 },
    { headerName: '상태',     field: 'status',
      valueFormatter: p => STATUS_LABEL[p.value] || p.value || '-',
      flex: 1, minWidth: 90 },
    { headerName: '정비만료일', field: 'maintenance_end_date',
      valueFormatter: p => formatDate(p.value), flex: 1, minWidth: 110 },
    { headerName: '등록일',   field: 'created_at',
      valueFormatter: p => formatDate(p.value), flex: 1, minWidth: 100 },
  ];

  const container = document.getElementById('equipmentGrid');
  if (!container) return;

  if (typeof agGrid === 'undefined') {
    // AG Grid 없으면 간단한 테이블로 폴백
    renderSimpleTable(rows);
    return;
  }

  const gridOptions = {
    columnDefs,
    rowData: rows,
    defaultColDef: { sortable: true, filter: true, resizable: true },
    rowSelection: 'single',
    onRowClicked: e => {
      if (e.data?.id) {
        parent.shellNavigate?.(`equipment/detail?id=${e.data.id}`);
      }
    },
    domLayout: 'autoHeight',
  };

  if (gridApi) {
    gridApi.setGridOption('rowData', rows);
    return;
  }

  gridApi = agGrid.createGrid(container, gridOptions);
}

function renderSimpleTable(rows) {
  const container = document.getElementById('equipmentGrid');
  if (!container) return;

  const STATUS_LABEL = CONFIG.EQUIPMENT_STATUS_LABEL || {};
  container.innerHTML = `
    <table class="data-table">
      <thead><tr>
        <th>장비명</th><th>모델명</th><th>소속</th><th>위치</th><th>상태</th><th>정비만료일</th>
      </tr></thead>
      <tbody>${rows.map(r => `
        <tr onclick="parent.shellNavigate?.('equipment/detail?id=${r.id}')" style="cursor:pointer">
          <td>${textSafe(r.equipment_name)}</td>
          <td>${textSafe(r.model_name || '-')}</td>
          <td>${textSafe(r.clinic_name || r.team_name || '-')}</td>
          <td>${textSafe(r.location || '-')}</td>
          <td>${textSafe(STATUS_LABEL[r.status] || r.status || '-')}</td>
          <td>${formatDate(r.maintenance_end_date)}</td>
        </tr>`).join('')}
      </tbody>
    </table>`;
}

/* ── 검색/필터 ─────────────────────────────── */
function applyFilter() {
  const keyword = (document.getElementById('searchInput')?.value || '').toLowerCase();
  const status  = document.getElementById('statusFilter')?.value || '';

  const filtered = allEquipments.filter(r => {
    const matchStatus  = !status || r.status === status;
    const matchKeyword = !keyword || [
      r.equipment_name, r.model_name, r.serial_no,
      r.clinic_name, r.team_name, r.location,
    ].some(f => String(f || '').toLowerCase().includes(keyword));
    return matchStatus && matchKeyword;
  });

  if (gridApi) {
    gridApi.setGridOption('rowData', filtered);
  } else {
    renderSimpleTable(filtered);
  }

  const countEl = document.getElementById('equipmentCount');
  if (countEl) countEl.textContent = `${filtered.length}대`;
}

/* ── 초기화 ────────────────────────────────── */
async function init() {
  currentUser = await auth.requireAuth();
  if (!currentUser) return;

  // 신규 등록 버튼
  document.getElementById('addEquipmentBtn')?.addEventListener('click', () => {
    parent.shellNavigate?.('equipment/form');
  });

  // 검색/필터 이벤트
  document.getElementById('searchInput')?.addEventListener('input', applyFilter);
  document.getElementById('statusFilter')?.addEventListener('change', applyFilter);

  // 상태 필터 옵션 생성
  const statusFilter = document.getElementById('statusFilter');
  if (statusFilter) {
    const STATUS_LABEL = CONFIG.EQUIPMENT_STATUS_LABEL || {};
    statusFilter.innerHTML = '<option value="">전체 상태</option>' +
      Object.entries(STATUS_LABEL).map(([k, v]) =>
        `<option value="${k}">${v}</option>`).join('');
  }

  try {
    allEquipments = await loadEquipments();
    renderGrid(allEquipments);

    const countEl = document.getElementById('equipmentCount');
    if (countEl) countEl.textContent = `${allEquipments.length}대`;
  } catch (e) {
    console.error('[equipment-list]', e);
    alert('장비 목록을 불러오지 못했습니다: ' + e.message);
  }
}

document.addEventListener('DOMContentLoaded', init);
