/**
 * equipment/dashboard.js
 * Supabase SDK 직접 호출 — 원본 HTML ID 기준
 */
'use strict';

function dq(sel) { return document.querySelector(sel); }
function esc(v) {
  return String(v == null ? '' : v)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function fmt(v) {
  const n = Number(v || 0);
  return Number.isFinite(n) ? n.toLocaleString('ko-KR') : '0';
}
function fmtDate(v) {
  const s = String(v || '').trim();
  if (!s) return '-';
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : s;
}

/* ── 데이터 로드 ─────────────────────────── */
async function fetchDashboardData() {
  const { data: rows, error } = await supabaseClient
    .from('equipments')
    .select('id, status, department, clinic_name, team_name, maintenance_end_date, created_at, equipment_name, model_name, location, serial_no')
    .eq('deleted_yn', 'N');

  if (error) throw new Error(error.message);

  const STATUS = CONFIG.EQUIPMENT_STATUS || {};
  const total  = rows.length;

  const byStatus = {};
  Object.values(STATUS).forEach(s => { byStatus[s] = 0; });
  rows.forEach(r => { byStatus[r.status] = (byStatus[r.status] || 0) + 1; });

  const today = new Date();
  const soon  = new Date(); soon.setDate(today.getDate() + 60);
  const maint = rows
    .filter(r => {
      if (!r.maintenance_end_date) return false;
      const d = new Date(r.maintenance_end_date);
      return d >= today && d <= soon;
    })
    .sort((a,b) => new Date(a.maintenance_end_date) - new Date(b.maintenance_end_date))
    .slice(0, 10);

  const deptMap = {};
  rows.forEach(r => {
    const k = r.department || r.team_name || '미지정';
    if (!deptMap[k]) deptMap[k] = { department: k, count: 0, items: [] };
    deptMap[k].count++;
    deptMap[k].items.push(r);
  });
  const deptList = Object.values(deptMap).sort((a,b) => b.count - a.count);

  return { total, byStatus, maint, deptList, rows };
}

/* ── KPI ─────────────────────────────────── */
function renderKpis(data) {
  const S = CONFIG.EQUIPMENT_STATUS || {};
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = fmt(v); };
  set('kpiTotal',    data.total);
  set('kpiInUse',    data.byStatus[S.IN_USE] || 0);
  set('kpiRepair',   (data.byStatus[S.REPAIRING] || 0) + (data.byStatus[S.INSPECTING] || 0));
  set('kpiExpiring', data.maint.length);
}

/* ── 부서별 바 차트 → deptBody ───────────── */
function renderDept(deptList) {
  const wrap = document.getElementById('deptBody');
  if (!wrap) return;
  if (!deptList.length) {
    wrap.innerHTML = '<div class="db-empty"><i class="ti ti-inbox"></i>데이터 없음</div>';
    return;
  }
  const max = deptList[0].count;
  wrap.innerHTML = deptList.slice(0, 8).map(d => `
    <div class="db-dept-row" onclick="showDeptDetail('${esc(d.department)}', ${d.count})">
      <div class="db-dept-label" title="${esc(d.department)}">${esc(d.department)}</div>
      <div class="db-dept-bar-wrap">
        <div class="db-dept-bar" style="width:${Math.max(Math.round(d.count/max*100),4)}%"></div>
      </div>
      <div class="db-dept-count">${d.count}</div>
    </div>`).join('');
}

/* ── 상태 도넛 → statusBody ─────────────── */
function renderDonut(data) {
  const wrap = document.getElementById('statusBody');
  if (!wrap) return;

  const STATUS_LABEL = CONFIG.EQUIPMENT_STATUS_LABEL || {};
  const COLORS = { IN_USE:'#22c55e', REPAIRING:'#f59e0b', INSPECTING:'#3b82f6', STORED:'#9ca3af', DISPOSED:'#ef4444' };
  const total = data.total || 0;

  if (!total) {
    wrap.innerHTML = '<div class="db-empty"><i class="ti ti-inbox"></i>데이터 없음</div>';
    return;
  }

  const entries = Object.entries(data.byStatus).filter(([,v]) => v > 0);
  let offset = 0;
  const R = 40, CX = 55, CY = 55, stroke = 20;
  const circ = 2 * Math.PI * R;

  const arcs = entries.map(([k, v]) => {
    const pct  = v / total;
    const dash = pct * circ;
    const arc  = `<circle cx="${CX}" cy="${CY}" r="${R}" fill="none"
      stroke="${COLORS[k]||'#d1d5db'}" stroke-width="${stroke}"
      stroke-dasharray="${dash} ${circ - dash}"
      stroke-dashoffset="${-offset * circ}" transform="rotate(-90 ${CX} ${CY})"/>`;
    offset += pct;
    return arc;
  }).join('');

  const legend = entries.map(([k, v]) => `
    <div class="db-legend-row">
      <div class="db-legend-dot" style="background:${COLORS[k]||'#d1d5db'}"></div>
      <div class="db-legend-name">${STATUS_LABEL[k]||k}</div>
      <div class="db-legend-val">${v}</div>
      <div class="db-legend-pct">${Math.round(v/total*100)}%</div>
    </div>`).join('');

  wrap.innerHTML = `
    <div class="db-donut-wrap">
      <svg class="db-donut-svg" viewBox="0 0 110 110">${arcs}</svg>
      <div class="db-donut-center">
        <div class="db-donut-total">${total}</div>
        <div class="db-donut-label">전체</div>
      </div>
    </div>
    <div class="db-status-legend">${legend}</div>`;
}

/* ── 유지보수 만료 → maintGrid ───────────── */
function renderMaint(maint) {
  const grid  = document.getElementById('maintGrid');
  const count = document.getElementById('maintCount');
  if (!grid) return;
  if (count) count.textContent = maint.length ? `${maint.length}건` : '';

  if (!maint.length) {
    grid.innerHTML = '<div class="db-empty"><i class="ti ti-circle-check"></i>만료 임박 장비 없음</div>';
    return;
  }

  const today = new Date();
  grid.innerHTML = `
    <table class="db-grid-table">
      <thead class="db-grid-thead">
        <tr>
          <th class="db-grid-th" style="text-align:left;width:35%">장비명</th>
          <th class="db-grid-th" style="width:25%">소속</th>
          <th class="db-grid-th" style="width:20%">만료일</th>
          <th class="db-grid-th" style="width:20%">D-Day</th>
        </tr>
      </thead>
      <tbody>${maint.map(r => {
        const dday = Math.ceil((new Date(r.maintenance_end_date) - today) / 86400000);
        const cls  = dday <= 7 ? 'db-dday--urgent' : dday <= 30 ? 'db-dday--warn' : '';
        return `<tr class="db-grid-tr" style="cursor:pointer"
          onclick="parent.shellNavigate?.('equipment/detail?id=${r.id}')">
          <td class="db-grid-td db-grid-td--name">${esc(r.equipment_name)}</td>
          <td class="db-grid-td">${esc(r.clinic_name||r.team_name||'-')}</td>
          <td class="db-grid-td">${fmtDate(r.maintenance_end_date)}</td>
          <td class="db-grid-td"><span class="db-dday ${cls}">D-${dday}</span></td>
        </tr>`;
      }).join('')}</tbody>
    </table>`;
}

/* ── 부서 상세 → deptDetailGrid ─────────── */
let _deptData = [];
function showDeptDetail(dept, count) {
  const grid  = document.getElementById('deptDetailGrid');
  const title = document.getElementById('deptDetailTitle');
  const badge = document.getElementById('deptDetailCount');
  if (!grid) return;

  if (title) title.innerHTML = `<i class="ti ti-list-details"></i> ${esc(dept)} 장비`;
  if (badge) badge.textContent = `${count}건`;

  const items = _deptData.filter(r => (r.department || r.team_name || '미지정') === dept);
  const SL = CONFIG.EQUIPMENT_STATUS_LABEL || {};

  grid.innerHTML = `
    <table class="db-grid-table">
      <thead class="db-grid-thead">
        <tr>
          <th class="db-grid-th" style="text-align:left;width:35%">장비명</th>
          <th class="db-grid-th" style="width:30%">모델명</th>
          <th class="db-grid-th" style="width:20%">상태</th>
          <th class="db-grid-th" style="width:15%">위치</th>
        </tr>
      </thead>
      <tbody>${items.map(r => `
        <tr class="db-grid-tr" style="cursor:pointer"
          onclick="parent.shellNavigate?.('equipment/detail?id=${r.id}')">
          <td class="db-grid-td db-grid-td--name">${esc(r.equipment_name)}</td>
          <td class="db-grid-td db-grid-td--id">${esc(r.model_name||'-')}</td>
          <td class="db-grid-td">${esc(SL[r.status]||r.status||'-')}</td>
          <td class="db-grid-td">${esc(r.location||'-')}</td>
        </tr>`).join('')}
      </tbody>
    </table>`;
}

/* ── 메인 ────────────────────────────────── */
async function loadDashboard() {
  const session = await auth.requireAuth();
  if (!session) return;

  try {
    const data = await fetchDashboardData();
    _deptData = data.rows;
    renderKpis(data);
    renderDept(data.deptList);
    renderDonut(data);
    renderMaint(data.maint);
  } catch(e) {
    console.error('[dashboard]', e);
    ['deptBody','statusBody','maintGrid'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = `<div class="db-empty"><i class="ti ti-alert-circle"></i>${e.message}</div>`;
    });
  }
}

document.addEventListener('DOMContentLoaded', loadDashboard);
