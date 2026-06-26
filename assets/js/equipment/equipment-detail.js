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
    if (img) { img.src = eq.photo_url; img.style.display = ''; }
  }
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

function renderHistories(rows) {
  const wrap  = document.getElementById('historyList');
  const empty = document.getElementById('historyEmpty');
  if (!wrap) return;

  if (!rows.length) {
    if (empty) empty.style.display = '';
    wrap.innerHTML = '';
    return;
  }
  if (empty) empty.style.display = 'none';

  wrap.innerHTML = `
    <table class="data-table">
      <thead><tr><th>유형</th><th>작업일</th><th>담당자</th><th>금액</th><th>결과</th><th>설명</th></tr></thead>
      <tbody>${rows.map(r => `
        <tr>
          <td>${textSafe(r.history_type || '-')}</td>
          <td>${formatDate(r.work_date)}</td>
          <td>${textSafe(r.requester || '-')}</td>
          <td>${r.amount != null ? Number(r.amount).toLocaleString('ko-KR') + '원' : '-'}</td>
          <td>${textSafe(r.result_status || '-')}</td>
          <td>${textSafe(r.description || '-')}</td>
        </tr>`).join('')}
      </tbody>
    </table>`;
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

function renderInventoryLogs(rows) {
  const wrap  = document.getElementById('inventoryList');
  const empty = document.getElementById('inventoryEmpty');
  if (!wrap) return;

  if (!rows.length) {
    if (empty) empty.style.display = '';
    wrap.innerHTML = '';
    return;
  }
  if (empty) empty.style.display = 'none';

  wrap.innerHTML = `
    <table class="data-table">
      <thead><tr><th>조사일시</th><th>조사자</th><th>상태</th><th>위치</th><th>메모</th></tr></thead>
      <tbody>${rows.map(r => `
        <tr>
          <td>${formatTs(r.checked_at)}</td>
          <td>${textSafe(r.checked_by_name || '-')}</td>
          <td>${textSafe(r.status_at_check || '-')}</td>
          <td>${textSafe(r.location_at_check || '-')}</td>
          <td>${textSafe(r.memo || '-')}</td>
        </tr>`).join('')}
      </tbody>
    </table>`;
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

function renderQcItems(rows) {
  const wrap  = document.getElementById('qcItemList');
  const empty = document.getElementById('qcItemEmpty');
  if (!wrap) return;

  if (!rows.length) {
    if (empty) empty.style.display = '';
    wrap.innerHTML = '';
    return;
  }
  if (empty) empty.style.display = 'none';

  wrap.innerHTML = `
    <table class="data-table">
      <thead><tr><th>항목명</th><th>유형</th><th>단위</th><th>평균(Mean)</th><th>SD</th><th>데이터 수</th><th></th></tr></thead>
      <tbody>${rows.map(r => `
        <tr>
          <td>${textSafe(r.item_name)}</td>
          <td>${textSafe(r.item_type === 'quantitative' ? '정량' : '정성')}</td>
          <td>${textSafe(r.unit || '-')}</td>
          <td>${r.mean != null ? r.mean : '-'}</td>
          <td>${r.sd != null ? r.sd : '-'}</td>
          <td>${r.lj_entries?.[0]?.count ?? 0}건</td>
          <td>
            <button class="btn btn-sm" onclick="goQcData('${r.id}')">데이터 입력</button>
          </td>
        </tr>`).join('')}
      </tbody>
    </table>`;
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

  // 수정 버튼
  document.getElementById('editBtn')?.addEventListener('click', () => {
    parent.shellNavigate?.(`equipment/form?id=${equipmentId}`);
  });

  // 정도관리 항목 추가 버튼
  document.getElementById('addQcItemBtn')?.addEventListener('click', () => {
    parent.shellNavigate?.(`qc/items?equipment_id=${equipmentId}`);
  });

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
  }
}

function initEquipmentDetail() { init(); }
document.addEventListener('DOMContentLoaded', init);
