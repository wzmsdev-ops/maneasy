/**
 * qc/data.js
 * 정도관리 데이터 입력 + LJ 차트
 * 장비 선택 드롭다운 → 항목 선택 → 데이터 입력
 */

'use strict';

let currentUser    = null;
let equipmentId    = null;
let selectedItemId = null;
let allEquipments  = [];
let allItems       = [];
let ljChart        = null;

function qs(sel) { return document.querySelector(sel); }
function val(id)  { return (document.getElementById(id)?.value || '').trim(); }
function setVal(id, v) { const el = document.getElementById(id); if (el) el.value = v ?? ''; }
function textSafe(v) {
  return String(v == null ? '' : v)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

/* ── 장비 목록 로드 ────────────────────────── */
async function loadEquipments() {
  const { data, error } = await supabaseClient
    .from('equipments')
    .select('id, equipment_name, model_name, clinic_name, team_name')
    .eq('deleted_yn', 'N')
    .order('equipment_name');
  if (error) throw new Error(error.message);
  return data || [];
}

/* ── 장비 선택 UI ──────────────────────────── */
function renderEquipmentSelector(equipments) {
  const sel = document.getElementById('equipmentSelect');
  if (!sel) return;

  sel.innerHTML = '<option value="">장비를 선택하세요</option>' +
    equipments.map(e => {
      const label = `${e.equipment_name}${e.model_name ? ' · ' + e.model_name : ''}${e.clinic_name ? ' (' + e.clinic_name + ')' : ''}`;
      return `<option value="${e.id}">${textSafe(label)}</option>`;
    }).join('');

  if (equipmentId) sel.value = equipmentId;
}

/* ── 항목 목록 로드 ────────────────────────── */
async function loadItems(eqId) {
  const { data, error } = await supabaseClient
    .from('lj_items')
    .select('*')
    .eq('equipment_id', eqId)
    .order('item_name');
  if (error) throw new Error(error.message);
  return data || [];
}

/* ── 항목 선택 UI ──────────────────────────── */
function renderItemSelector(items) {
  const sel = document.getElementById('itemSelect');
  if (!sel) return;

  if (!items.length) {
    sel.innerHTML = '<option value="">등록된 항목이 없습니다</option>';
    sel.disabled = true;
    return;
  }

  sel.disabled = false;
  sel.innerHTML = '<option value="">항목을 선택하세요</option>' +
    items.map(i =>
      `<option value="${i.id}">${textSafe(i.item_name)}${i.unit ? ' (' + i.unit + ')' : ''}</option>`
    ).join('');

  if (selectedItemId) sel.value = selectedItemId;
}

/* ── 장비 선택 시 ──────────────────────────── */
async function onEquipmentSelected(eqId) {
  equipmentId    = eqId;
  selectedItemId = null;
  allItems       = [];

  // 항목 섹션 초기화
  const itemSection = document.getElementById('itemSection');
  const dataBody    = document.getElementById('dataBody');
  if (itemSection) itemSection.style.display = eqId ? '' : 'none';
  if (dataBody)    dataBody.style.display    = 'none';

  if (!eqId) return;

  try {
    allItems = await loadItems(eqId);
    renderItemSelector(allItems);
  } catch(e) {
    console.error('[qc/data] loadItems', e);
  }
}

/* ── 항목 선택 시 ──────────────────────────── */
async function onItemSelected(itemId) {
  selectedItemId = itemId;
  const item = allItems.find(i => i.id === itemId);
  if (!item) return;

  // 항목 정보 KPI 표시
  const infoEl = document.getElementById('itemInfo');
  if (infoEl) {
    const parts = [
      item.item_name,
      item.item_type === 'quantitative' ? '정량' : '정성',
      item.unit ? `단위: ${item.unit}` : '',
      item.mean != null ? `Mean: ${item.mean}` : '',
      item.sd   != null ? `SD: ${item.sd}`   : '',
    ].filter(Boolean);
    infoEl.textContent = parts.join(' · ');
    infoEl.style.display = '';
  }

  const dataBody = document.getElementById('dataBody');
  if (dataBody) dataBody.style.display = '';

  try {
    const entries = await loadEntries(itemId);
    renderChart(item, entries);
    renderEntryTable(entries);
  } catch(e) {
    console.error('[qc/data] loadEntries', e);
  }
}

/* ── 엔트리 로드 ───────────────────────────── */
async function loadEntries(itemId) {
  const { data, error } = await supabaseClient
    .from('lj_entries')
    .select('*')
    .eq('item_id', itemId)
    .order('date', { ascending: true });
  if (error) throw new Error(error.message);
  return data || [];
}

/* ── LJ 차트 ───────────────────────────────── */
function renderChart(item, entries) {
  const canvas = document.getElementById('ljChart');
  if (!canvas || typeof Chart === 'undefined') return;

  const mean = item.mean ?? null;
  const sd   = item.sd   ?? null;
  const labels = entries.map(e => e.date);
  const values = entries.map(e => Number(e.value));

  if (ljChart) ljChart.destroy();

  const datasets = [{
    label: '측정값',
    data: values,
    borderColor: '#3b82f6',
    backgroundColor: 'rgba(59,130,246,0.1)',
    tension: 0.3,
    pointRadius: 4,
    fill: false,
  }];

  if (mean !== null) {
    datasets.push({ label: 'Mean', data: labels.map(() => mean), borderColor: '#10b981', borderDash: [], pointRadius: 0, fill: false });
    if (sd !== null) {
      datasets.push({ label: '+1SD', data: labels.map(() => mean + sd),     borderColor: '#f59e0b', borderDash: [4,4], pointRadius: 0, fill: false });
      datasets.push({ label: '-1SD', data: labels.map(() => mean - sd),     borderColor: '#f59e0b', borderDash: [4,4], pointRadius: 0, fill: false });
      datasets.push({ label: '+2SD', data: labels.map(() => mean + 2*sd),   borderColor: '#ef4444', borderDash: [4,4], pointRadius: 0, fill: false });
      datasets.push({ label: '-2SD', data: labels.map(() => mean - 2*sd),   borderColor: '#ef4444', borderDash: [4,4], pointRadius: 0, fill: false });
      datasets.push({ label: '+3SD', data: labels.map(() => mean + 3*sd),   borderColor: '#7c3aed', borderDash: [2,2], pointRadius: 0, fill: false });
      datasets.push({ label: '-3SD', data: labels.map(() => mean - 3*sd),   borderColor: '#7c3aed', borderDash: [2,2], pointRadius: 0, fill: false });
    }
  }

  ljChart = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom' } },
      scales: {
        x: { ticks: { maxTicksLimit: 15 } },
        y: { title: { display: true, text: item.unit || '값' } },
      },
    },
  });
}

/* ── 엔트리 테이블 ─────────────────────────── */
function renderEntryTable(entries) {
  const wrap  = document.getElementById('entryList');
  const empty = document.getElementById('entryEmpty');
  if (!wrap) return;

  if (!entries.length) {
    if (empty) empty.style.display = '';
    wrap.innerHTML = '';
    return;
  }
  if (empty) empty.style.display = 'none';

  wrap.innerHTML = `
    <table class="data-table">
      <thead><tr><th>날짜</th><th>값</th><th>메모</th><th></th></tr></thead>
      <tbody>${[...entries].reverse().map(e => `
        <tr>
          <td>${textSafe(e.date)}</td>
          <td>${textSafe(e.value)}</td>
          <td>${textSafe(e.memo || '-')}</td>
          <td><button class="btn btn-sm btn-danger" onclick="deleteEntry('${e.id}')">삭제</button></td>
        </tr>`).join('')}
      </tbody>
    </table>`;
}

/* ── 저장 ──────────────────────────────────── */
async function saveEntry() {
  if (!selectedItemId) throw new Error('항목을 선택하세요.');
  const dateVal  = val('entryDate');
  const valueVal = val('entryValue');
  if (!dateVal)  throw new Error('날짜를 입력하세요.');
  if (!valueVal) throw new Error('값을 입력하세요.');

  const { data: { session } } = await supabaseClient.auth.getSession();

  const { error } = await supabaseClient.from('lj_entries').insert({
    item_id:    selectedItemId,
    date:       dateVal,
    value:      valueVal,
    memo:       val('entryMemo'),
    created_by: session?.user?.id || null,
  });
  if (error) throw new Error(error.message);

  setVal('entryValue', '');
  setVal('entryMemo', '');
}

async function deleteEntry(entryId) {
  if (!confirm('이 데이터를 삭제하시겠습니까?')) return;
  const { error } = await supabaseClient.from('lj_entries').delete().eq('id', entryId);
  if (error) { alert('삭제 실패: ' + error.message); return; }
  if (selectedItemId) await onItemSelected(selectedItemId);
}

/* ── 초기화 ────────────────────────────────── */
async function init() {
  currentUser = await auth.requireAuth();
  if (!currentUser) return;

  const params = new URLSearchParams(location.search);
  equipmentId    = params.get('equipment_id') || null;
  selectedItemId = params.get('item_id') || null;

  setVal('entryDate', new Date().toISOString().slice(0, 10));

  // 장비 선택 이벤트
  document.getElementById('equipmentSelect')?.addEventListener('change', e => {
    onEquipmentSelected(e.target.value || null);
  });

  // 항목 선택 이벤트
  document.getElementById('itemSelect')?.addEventListener('change', e => {
    if (e.target.value) onItemSelected(e.target.value);
    else {
      document.getElementById('dataBody').style.display = 'none';
    }
  });

  // 저장
  document.getElementById('saveEntryBtn')?.addEventListener('click', async () => {
    const btn = document.getElementById('saveEntryBtn');
    btn.disabled = true;
    try {
      await saveEntry();
      await onItemSelected(selectedItemId);
    } catch(e) {
      alert('저장 실패: ' + e.message);
    } finally {
      btn.disabled = false;
    }
  });

  try {
    allEquipments = await loadEquipments();
    renderEquipmentSelector(allEquipments);

    // URL 파라미터로 진입한 경우 자동 선택
    if (equipmentId) {
      document.getElementById('equipmentSelect').value = equipmentId;
      await onEquipmentSelected(equipmentId);
      if (selectedItemId) {
        document.getElementById('itemSelect').value = selectedItemId;
        await onItemSelected(selectedItemId);
      }
    } else {
      document.getElementById('itemSection').style.display = 'none';
      document.getElementById('dataBody').style.display    = 'none';
    }
  } catch(e) {
    console.error('[qc/data]', e);
    alert('초기화 실패: ' + e.message);
  }
}

function initQcData() { init(); }
document.addEventListener('DOMContentLoaded', init);
