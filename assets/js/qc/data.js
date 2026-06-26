/**
 * qc/data.js
 * 정도관리 데이터 입력 + LJ 차트 — Supabase SDK 직접 호출
 */

'use strict';

let currentUser  = null;
let equipmentId  = null;
let selectedItemId = null;
let allItems     = [];
let ljChart      = null;

/* ── 유틸 ─────────────────────────────────── */
function textSafe(v) {
  return String(v == null ? '' : v)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function qs(sel) { return document.querySelector(sel); }
function val(id) { return (document.getElementById(id)?.value || '').trim(); }
function setVal(id, v) { const el = document.getElementById(id); if (el) el.value = v ?? ''; }

/* ── 항목 목록 로드 ────────────────────────── */
async function loadItems() {
  let q = supabaseClient
    .from('lj_items')
    .select('*')
    .order('item_name');

  if (equipmentId) q = q.eq('equipment_id', equipmentId);

  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data || [];
}

/* ── 항목 선택 UI ──────────────────────────── */
function renderItemSelector(items) {
  const sel = document.getElementById('itemSelect');
  if (!sel) return;

  sel.innerHTML = '<option value="">항목을 선택하세요</option>' +
    items.map(i => `<option value="${i.id}">${textSafe(i.item_name)}${i.unit ? ' (' + i.unit + ')' : ''}</option>`).join('');

  if (selectedItemId) sel.value = selectedItemId;
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

/* ── LJ 차트 렌더링 ────────────────────────── */
function renderChart(item, entries) {
  const canvas = document.getElementById('ljChart');
  if (!canvas || typeof Chart === 'undefined') return;

  const mean = item.mean ?? null;
  const sd   = item.sd   ?? null;

  const labels = entries.map(e => e.date);
  const values = entries.map(e => Number(e.value));

  if (ljChart) ljChart.destroy();

  const datasets = [
    {
      label: '측정값',
      data: values,
      borderColor: '#3b82f6',
      backgroundColor: 'rgba(59,130,246,0.1)',
      tension: 0.3,
      pointRadius: 4,
      fill: false,
    },
  ];

  if (mean !== null) {
    datasets.push({ label: 'Mean',    data: labels.map(() => mean),      borderColor: '#10b981', borderDash: [],      pointRadius: 0, fill: false });
    if (sd !== null) {
      datasets.push({ label: '+1SD',  data: labels.map(() => mean + sd),     borderColor: '#f59e0b', borderDash: [4,4],   pointRadius: 0, fill: false });
      datasets.push({ label: '-1SD',  data: labels.map(() => mean - sd),     borderColor: '#f59e0b', borderDash: [4,4],   pointRadius: 0, fill: false });
      datasets.push({ label: '+2SD',  data: labels.map(() => mean + 2 * sd), borderColor: '#ef4444', borderDash: [4,4],   pointRadius: 0, fill: false });
      datasets.push({ label: '-2SD',  data: labels.map(() => mean - 2 * sd), borderColor: '#ef4444', borderDash: [4,4],   pointRadius: 0, fill: false });
      datasets.push({ label: '+3SD',  data: labels.map(() => mean + 3 * sd), borderColor: '#7c3aed', borderDash: [2,2],   pointRadius: 0, fill: false });
      datasets.push({ label: '-3SD',  data: labels.map(() => mean - 3 * sd), borderColor: '#7c3aed', borderDash: [2,2],   pointRadius: 0, fill: false });
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

/* ── 엔트리 테이블 렌더링 ─────────────────── */
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

/* ── 항목 선택 시 데이터 로드 ─────────────── */
async function onItemSelected(itemId) {
  selectedItemId = itemId;
  const item = allItems.find(i => i.id === itemId);
  if (!item) return;

  // 항목 정보 표시
  const infoEl = document.getElementById('itemInfo');
  if (infoEl) {
    const infoParts = [
      item.item_name,
      item.item_type === 'quantitative' ? '정량' : '정성',
      item.unit ? `단위: ${item.unit}` : '',
      item.mean != null ? `Mean: ${item.mean}` : '',
      item.sd   != null ? `SD: ${item.sd}`   : '',
    ].filter(Boolean);
    infoEl.textContent = infoParts.join(' · ');
    infoEl.style.display = '';
  }

  // 입력 폼 표시
  const formSection = document.getElementById('entryFormSection');
  if (formSection) formSection.style.display = '';

  try {
    const entries = await loadEntries(itemId);
    renderChart(item, entries);
    renderEntryTable(entries);
  } catch (e) {
    console.error('[qc/data] loadEntries', e);
  }
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

  // 폼 초기화 (날짜는 유지)
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

  // 오늘 날짜 기본값
  const today = new Date().toISOString().slice(0, 10);
  setVal('entryDate', today);

  // 항목 선택 변경
  document.getElementById('itemSelect')?.addEventListener('change', e => {
    if (e.target.value) onItemSelected(e.target.value);
  });

  // 저장
  document.getElementById('saveEntryBtn')?.addEventListener('click', async () => {
    const btn = document.getElementById('saveEntryBtn');
    btn.disabled = true;
    try {
      await saveEntry();
      if (selectedItemId) await onItemSelected(selectedItemId);
    } catch (e) {
      alert('저장 실패: ' + e.message);
    } finally {
      btn.disabled = false;
    }
  });

  // 뒤로
  document.getElementById('backBtn')?.addEventListener('click', () => {
    if (equipmentId) parent.shellNavigate?.(`equipment/detail?id=${equipmentId}`);
    else parent.shellNavigate?.('qc/items');
  });

  try {
    allItems = await loadItems();
    renderItemSelector(allItems);

    if (selectedItemId) await onItemSelected(selectedItemId);
    else if (allItems.length) {
      document.getElementById('entryFormSection').style.display = 'none';
    }
  } catch (e) {
    console.error('[qc/data]', e);
    alert('데이터를 불러오지 못했습니다: ' + e.message);
  }
}

document.addEventListener('DOMContentLoaded', init);
