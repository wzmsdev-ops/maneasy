/**
 * equipment/dashboard.js
 * Supabase SDK 직접 호출 버전 — GAS 의존성 제거
 */

'use strict';

/* ── 유틸 ─────────────────────────────────────────── */

function textSafe(v) {
  return String(v == null ? '' : v)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function formatNum(v) {
  const n = Number(v || 0);
  return Number.isFinite(n) ? n.toLocaleString('ko-KR') : '0';
}
function formatDate(v) {
  const s = String(v || '').trim();
  if (!s) return '-';
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : s;
}
function dq(sel) { return document.querySelector(sel); }

/* ── 데이터 로드 ───────────────────────────────────── */

async function fetchDashboardData() {
  const { data: rows, error } = await supabaseClient
    .from('equipments')
    .select('id, status, department, clinic_name, team_name, maintenance_end_date, created_at, equipment_name, model_name, location')
    .eq('deleted_yn', 'N');

  if (error) throw new Error(error.message);

  const STATUS = window.CONFIG?.EQUIPMENT_STATUS || {};
  const total = rows.length;
  const byStatus = {};
  Object.values(STATUS).forEach(s => { byStatus[s] = 0; });
  rows.forEach(r => {
    if (byStatus[r.status] !== undefined) byStatus[r.status]++;
    else byStatus[r.status] = (byStatus[r.status] || 0) + 1;
  });

  // 정비만료 30일 이내
  const today = new Date();
  const soon = new Date(today); soon.setDate(today.getDate() + 30);
  const maintenance_alerts = rows
    .filter(r => {
      if (!r.maintenance_end_date) return false;
      const d = new Date(r.maintenance_end_date);
      return d >= today && d <= soon;
    })
    .sort((a, b) => new Date(a.maintenance_end_date) - new Date(b.maintenance_end_date))
    .slice(0, 10)
    .map(r => ({
      equipment_id: r.id,
      equipment_name: r.equipment_name,
      model_name: r.model_name,
      maintenance_end_date: r.maintenance_end_date,
      clinic_name: r.clinic_name,
      team_name: r.team_name,
    }));

  // 최근 등록 장비
  const recent_registrations = [...rows]
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 5)
    .map(r => ({
      equipment_id: r.id,
      equipment_name: r.equipment_name,
      model_name: r.model_name,
      location: r.location,
      clinic_name: r.clinic_name,
      created_at: r.created_at,
    }));

  // 부서별 집계
  const deptMap = {};
  rows.forEach(r => {
    const key = r.department || r.team_name || '미지정';
    deptMap[key] = (deptMap[key] || 0) + 1;
  });
  const department_summary = Object.entries(deptMap)
    .map(([department, count]) => ({ department, count }))
    .sort((a, b) => b.count - a.count);

  return {
    total,
    byStatus,
    maintenance_alerts,
    recent_registrations,
    department_summary,
  };
}

/* ── 렌더링 ────────────────────────────────────────── */

function renderKpis(data) {
  const STATUS_LABEL = CONFIG.EQUIPMENT_STATUS_LABEL || {};
  const STATUS = CONFIG.EQUIPMENT_STATUS || {};

  const setKpi = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = formatNum(val);
  };

  setKpi('kpiTotal',     data.total || 0);
  setKpi('kpiInUse',     data.byStatus?.[STATUS.IN_USE] || 0);
  setKpi('kpiRepairing', data.byStatus?.[STATUS.REPAIRING] || 0);
  setKpi('kpiStored',    data.byStatus?.[STATUS.STORED] || 0);
}

function renderMaintenanceAlerts(alerts) {
  const wrap  = dq('#maintenanceAlertList');
  const empty = dq('#maintenanceAlertEmpty');
  if (!wrap) return;

  if (!alerts?.length) {
    if (empty) empty.style.display = '';
    wrap.innerHTML = '';
    return;
  }
  if (empty) empty.style.display = 'none';

  wrap.innerHTML = alerts.map(a => `
    <tr onclick="parent.shellNavigate?.('equipment/detail?id=${a.equipment_id}')" style="cursor:pointer">
      <td>${textSafe(a.equipment_name)}</td>
      <td>${textSafe(a.clinic_name || a.team_name || '-')}</td>
      <td>${formatDate(a.maintenance_end_date)}</td>
    </tr>`).join('');
}

function renderRecentRegisteredList(items) {
  const wrap  = dq('#recentRegisteredList');
  const empty = dq('#recentRegisteredEmpty');
  if (!wrap) return;

  if (!items?.length) {
    if (empty) empty.style.display = '';
    wrap.innerHTML = '';
    return;
  }
  if (empty) empty.style.display = 'none';

  wrap.innerHTML = items.map(r => `
    <tr onclick="parent.shellNavigate?.('equipment/detail?id=${r.equipment_id}')" style="cursor:pointer">
      <td>${textSafe(r.equipment_name)}</td>
      <td>${textSafe(r.model_name || '-')}</td>
      <td>${textSafe(r.clinic_name || r.team_name || '-')}</td>
      <td>${formatDate(r.created_at)}</td>
    </tr>`).join('');
}

function renderDeptChart(data) {
  const wrap  = dq('#deptChartWrap');
  const empty = dq('#deptChartEmpty');
  if (!wrap) return;

  if (!data?.length) { if (empty) empty.style.display = ''; return; }
  if (empty) empty.style.display = 'none';

  const COLORS = ['#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6','#06b6d4'];
  const total = data.reduce((s, d) => s + Number(d.count || 0), 0);
  if (!total) { if (empty) empty.style.display = ''; return; }

  wrap.innerHTML = `<div class="dept-cbar-list">${
    data.slice(0, 8).map((d, i) => {
      const count = Number(d.count || 0);
      const pct   = Math.round((count / total) * 100);
      const color = COLORS[i % COLORS.length];
      const name  = textSafe(d.department || '-');
      return `
        <div class="dept-cbar-row">
          <div class="dept-cbar-label" title="${name}">${name}</div>
          <div class="dept-cbar-track">
            <div class="dept-cbar-fill" style="width:${Math.max(pct,6)}%;background:${color};">
              <span class="dept-cbar-inline">${count}대&nbsp;${pct}%</span>
            </div>
          </div>
        </div>`;
    }).join('')
  }</div>`;
}

/* ── 초기화 ────────────────────────────────────────── */

async function loadDashboard() {
  const session = await auth.requireAuth();
  if (!session) return;

  try {
    const data = await fetchDashboardData();
    renderKpis(data);
    renderMaintenanceAlerts(data.maintenance_alerts);
    renderRecentRegisteredList(data.recent_registrations);
    renderDeptChart(data.department_summary);
  } catch (e) {
    console.error('[dashboard]', e);
    const errEl = dq('#dashboardError');
    if (errEl) { errEl.textContent = e.message; errEl.style.display = ''; }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  loadDashboard();
});
