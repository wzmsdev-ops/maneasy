/**
 * equipment/equipment-list.js
 * Supabase SDK 직접 호출 버전
 */
'use strict';

let allEquipments = [];
let gridApi = null;

function esc(v) {
  return String(v == null ? '' : v)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function fmtDate(v) {
  const s = String(v || '').trim();
  if (!s) return '-';
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : s;
}

/* ── 데이터 로드 ───────────────────────────── */
async function loadEquipments(filters = {}) {
  let q = supabaseClient
    .from('equipments')
    .select('*')
    .eq('deleted_yn', 'N')
    .order('created_at', { ascending: false });

  if (filters.status)  q = q.eq('status', filters.status);

  const { data, error } = await q;
  if (error) throw new Error(error.message);

  let rows = data || [];
  if (filters.keyword) {
    const kw = filters.keyword.toLowerCase();
    rows = rows.filter(r =>
      [r.equipment_name, r.model_name, r.serial_no, r.clinic_name, r.team_name, r.location, r.manufacturer]
        .some(f => String(f||'').toLowerCase().includes(kw))
    );
  }
  return rows;
}

/* ── AG Grid ───────────────────────────────── */
function renderGrid(rows) {
  const SL = CONFIG.EQUIPMENT_STATUS_LABEL || {};
  const container = document.getElementById('equipmentGrid');
  if (!container) return;

  const colDefs = [
    { headerName:'장비명',  field:'equipment_name', flex:2, minWidth:140, cellClass:'tab-name' },
    { headerName:'모델명',  field:'model_name',     flex:2, minWidth:120 },
    { headerName:'소속',    valueGetter: p => p.data.clinic_name || p.data.team_name || '-', flex:2, minWidth:120 },
    { headerName:'시리얼',  field:'serial_no',      flex:1, minWidth:110, cellClass:'tab-id' },
    { headerName:'위치',    field:'location',       flex:1, minWidth:90 },
    { headerName:'상태',    field:'status', flex:1, minWidth:80,
      valueFormatter: p => SL[p.value] || p.value || '-' },
    { headerName:'정비만료일', field:'maintenance_end_date',
      flex:1, minWidth:110, valueFormatter: p => fmtDate(p.value) },
  ];

  if (typeof agGrid === 'undefined') {
    renderSimpleTable(rows); return;
  }

  if (gridApi) {
    gridApi.setGridOption('rowData', rows);
    return;
  }

  gridApi = agGrid.createGrid(container, {
    columnDefs: colDefs,
    rowData: rows,
    defaultColDef: { sortable:true, filter:true, resizable:true },
    rowSelection: 'single',
    onRowClicked: e => {
      if (e.data?.id) parent.shellNavigate?.(`equipment/detail?id=${e.data.id}`);
    },
    domLayout: 'autoHeight',
    headerHeight: 36,
    rowHeight: 36,
  });
}

function renderSimpleTable(rows) {
  const container = document.getElementById('equipmentGrid');
  if (!container) return;
  const SL = CONFIG.EQUIPMENT_STATUS_LABEL || {};
  if (!rows.length) {
    container.innerHTML = '<div style="padding:40px;text-align:center;color:#9ca3af;">등록된 장비가 없습니다.</div>';
    return;
  }
  container.innerHTML = `
    <table style="width:100%;border-collapse:collapse;font-size:13px;">
      <thead style="background:#f8fafc;">
        <tr>${['장비명','모델명','소속','상태','정비만료일'].map(h =>
          `<th style="padding:8px 12px;text-align:left;border-bottom:1px solid #e5e7eb;font-weight:600;color:#374151;">${h}</th>`
        ).join('')}</tr>
      </thead>
      <tbody>${rows.map(r => `
        <tr style="cursor:pointer;border-bottom:1px solid #f3f4f6;"
          onmouseover="this.style.background='#f8faff'" onmouseout="this.style.background=''"
          onclick="parent.shellNavigate?.('equipment/detail?id=${r.id}')">
          <td style="padding:8px 12px;font-weight:600;">${esc(r.equipment_name)}</td>
          <td style="padding:8px 12px;color:#6b7280;">${esc(r.model_name||'-')}</td>
          <td style="padding:8px 12px;">${esc(r.clinic_name||r.team_name||'-')}</td>
          <td style="padding:8px 12px;">${esc(SL[r.status]||r.status||'-')}</td>
          <td style="padding:8px 12px;">${fmtDate(r.maintenance_end_date)}</td>
        </tr>`).join('')}
      </tbody>
    </table>`;
}

/* ── 필터 적용 ─────────────────────────────── */
async function applyFilter() {
  const keyword = document.getElementById('keyword')?.value || '';
  const status  = document.getElementById('status')?.value  || '';
  try {
    const rows = await loadEquipments({ keyword, status });
    if (gridApi) gridApi.setGridOption('rowData', rows);
    else renderSimpleTable(rows);
    const summary = document.getElementById('listSummary');
    if (summary) summary.textContent = `${rows.length}건`;
  } catch(e) {
    console.error('[list] applyFilter', e);
  }
}

/* ── 초기화 ────────────────────────────────── */
async function init() {
  const session = await auth.requireAuth();
  if (!session) return;

  // 장비 등록 버튼
  const createBtn = document.getElementById('createEquipmentBtn');
  if (createBtn) {
    createBtn.removeAttribute('href');
    createBtn.style.cursor = 'pointer';
    createBtn.addEventListener('click', e => {
      e.preventDefault();
      parent.shellNavigate?.('equipment/form');
    });
  }

  // 상태 필터 옵션
  const statusSel = document.getElementById('status');
  if (statusSel) {
    const SL = CONFIG.EQUIPMENT_STATUS_LABEL || {};
    statusSel.innerHTML = '<option value="">전체 상태</option>' +
      Object.entries(SL).map(([k,v]) => `<option value="${k}">${v}</option>`).join('');
  }

  // 검색 폼
  document.getElementById('searchForm')?.addEventListener('submit', e => {
    e.preventDefault(); applyFilter();
  });
  document.getElementById('resetFilterBtn')?.addEventListener('click', () => {
    document.getElementById('keyword').value = '';
    document.getElementById('status').value  = '';
    applyFilter();
  });

  // 초기 로드
  document.body.classList.add('page-ready');
  document.getElementById('eqToolbar').style.display = '';
  try {
    allEquipments = await loadEquipments();
    renderGrid(allEquipments);
  } catch(e) {
    console.error('[list] init', e);
    const box = document.getElementById('messageBox');
    if (box) { box.textContent = '데이터를 불러오지 못했습니다: ' + e.message; box.style.display = ''; }
  }
}

function initEquipmentList() { init(); }
