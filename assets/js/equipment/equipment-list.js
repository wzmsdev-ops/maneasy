/**
 * equipment/equipment-list.js
 * Supabase SDK — 클라이언트 사이드 페이지네이션 (20건/페이지)
 */
'use strict';

const PAGE_SIZE = 20;
let allEquipments = [];
let filteredEquipments = [];
let currentPage = 1;
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

/* ── 데이터 로드 ─────────────────────────── */
async function loadEquipments() {
  const { data, error } = await supabaseClient
    .from('equipments')
    .select('*')
    .eq('deleted_yn', 'N')
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return data || [];
}

/* ── 필터 ────────────────────────────────── */
function applyFilter() {
  const keyword = (document.getElementById('keyword')?.value || '').toLowerCase();
  const status  = document.getElementById('status')?.value || '';

  filteredEquipments = allEquipments.filter(r => {
    const matchStatus  = !status || r.status === status;
    const matchKeyword = !keyword || [
      r.equipment_name, r.model_name, r.serial_no,
      r.clinic_name, r.team_name, r.location, r.manufacturer
    ].some(f => String(f||'').toLowerCase().includes(keyword));
    return matchStatus && matchKeyword;
  });

  currentPage = 1;
  renderPage();
}

/* ── 페이지 렌더 ─────────────────────────── */
function renderPage() {
  const total      = filteredEquipments.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  currentPage      = Math.min(currentPage, totalPages);

  const start = (currentPage - 1) * PAGE_SIZE;
  const rows  = filteredEquipments.slice(start, start + PAGE_SIZE);

  // 요약
  const summary = document.getElementById('listSummary');
  if (summary) {
    summary.style.display = '';
    summary.textContent = `검색 결과 ${total}건 · ${currentPage} / ${totalPages} 페이지`;
  }

  // 그리드
  if (gridApi) {
    gridApi.setGridOption('rowData', rows);
  } else {
    renderSimpleTable(rows);
  }

  // 페이지네이션
  renderPagination(currentPage, totalPages);
}

/* ── AG Grid ─────────────────────────────── */
function initGrid(rows) {
  const SL = CONFIG.EQUIPMENT_STATUS_LABEL || {};
  const container = document.getElementById('equipmentGrid');
  if (!container) return;

  if (typeof agGrid === 'undefined') {
    renderSimpleTable(rows);
    return;
  }

  const colDefs = [
    { headerName:'장비명',    field:'equipment_name', flex:2, minWidth:140,
      cellStyle:{ fontWeight:600, color:'#111827' } },
    { headerName:'모델명',    field:'model_name',     flex:2, minWidth:120,
      valueFormatter: p => p.value || '-' },
    { headerName:'소속',      valueGetter: p => p.data.clinic_name || p.data.team_name || '-',
      flex:2, minWidth:120 },
    { headerName:'시리얼',    field:'serial_no',      flex:1, minWidth:110,
      cellStyle:{ fontSize:'11px', color:'#6b7280', fontFamily:'Consolas,monospace' } },
    { headerName:'위치',      field:'location',       flex:1, minWidth:90,
      valueFormatter: p => p.value || '-' },
    { headerName:'상태',      field:'status',         flex:1, minWidth:80,
      valueFormatter: p => SL[p.value] || p.value || '-' },
    { headerName:'정비만료일', field:'maintenance_end_date', flex:1, minWidth:110,
      valueFormatter: p => fmtDate(p.value) },
  ];

  gridApi = agGrid.createGrid(container, {
    columnDefs,
    rowData: rows,
    defaultColDef: { sortable:true, resizable:true },
    rowSelection: 'single',
    onRowClicked: e => {
      if (e.data?.id) parent.shellNavigate?.(`equipment/detail?id=${e.data.id}`);
    },
    domLayout: 'normal',
    headerHeight: 36,
    rowHeight: 36,
    suppressHorizontalScroll: true,
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
      <thead style="background:#f8fafc;position:sticky;top:0;">
        <tr>${['장비명','모델명','소속','시리얼','위치','상태','정비만료일'].map(h =>
          `<th style="padding:8px 12px;text-align:left;border-bottom:1px solid #e5e7eb;font-weight:600;color:#374151;white-space:nowrap;">${h}</th>`
        ).join('')}</tr>
      </thead>
      <tbody>${rows.map(r => `
        <tr style="cursor:pointer;border-bottom:1px solid #f3f4f6;"
          onmouseover="this.style.background='#f0f5ff'" onmouseout="this.style.background=''"
          onclick="parent.shellNavigate?.('equipment/detail?id=${r.id}')">
          <td style="padding:8px 12px;font-weight:600;">${esc(r.equipment_name)}</td>
          <td style="padding:8px 12px;color:#6b7280;">${esc(r.model_name||'-')}</td>
          <td style="padding:8px 12px;">${esc(r.clinic_name||r.team_name||'-')}</td>
          <td style="padding:8px 12px;font-size:11px;color:#6b7280;font-family:Consolas,monospace;">${esc(r.serial_no||'-')}</td>
          <td style="padding:8px 12px;">${esc(r.location||'-')}</td>
          <td style="padding:8px 12px;">${esc(SL[r.status]||r.status||'-')}</td>
          <td style="padding:8px 12px;">${fmtDate(r.maintenance_end_date)}</td>
        </tr>`).join('')}
      </tbody>
    </table>`;
}

/* ── 페이지네이션 UI ─────────────────────── */
function renderPagination(page, totalPages) {
  const container = document.getElementById('paginationArea');
  if (!container) return;

  if (totalPages <= 1) { container.innerHTML = ''; return; }

  const BLOCK = 10;
  const blockStart = Math.floor((page - 1) / BLOCK) * BLOCK + 1;
  const blockEnd   = Math.min(totalPages, blockStart + BLOCK - 1);

  let html = '';
  if (blockStart > 1) {
    html += `<button class="pagination-btn" data-page="${blockStart - 1}">이전</button>`;
  }
  for (let i = blockStart; i <= blockEnd; i++) {
    html += `<button class="pagination-btn ${i === page ? 'is-active' : ''}" data-page="${i}">${i}</button>`;
  }
  if (blockEnd < totalPages) {
    html += `<button class="pagination-btn" data-page="${blockEnd + 1}">다음</button>`;
  }

  container.innerHTML = html;
  container.querySelectorAll('.pagination-btn[data-page]').forEach(btn => {
    btn.addEventListener('click', () => {
      currentPage = Number(btn.dataset.page);
      renderPage();
    });
  });
}

/* ── 초기화 ──────────────────────────────── */
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

  // 검색 이벤트
  document.getElementById('searchForm')?.addEventListener('submit', e => {
    e.preventDefault(); applyFilter();
  });
  document.getElementById('resetFilterBtn')?.addEventListener('click', () => {
    document.getElementById('keyword').value = '';
    if (statusSel) statusSel.value = '';
    applyFilter();
  });

  document.body.classList.add('page-ready');
  document.getElementById('eqToolbar').style.display = '';

  try {
    allEquipments = await loadEquipments();
    filteredEquipments = allEquipments;
    initGrid(filteredEquipments.slice(0, PAGE_SIZE));
    renderPage();
  } catch(e) {
    console.error('[list]', e);
    const box = document.getElementById('messageBox');
    if (box) { box.textContent = '데이터를 불러오지 못했습니다: ' + e.message; box.style.display = ''; }
  }
}

function initEquipmentList() { init(); }
document.addEventListener('DOMContentLoaded', init);
