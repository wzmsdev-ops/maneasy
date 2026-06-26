/**
 * qc/items.js
 * 정도관리 검사항목 관리 — equipment_id FK 기반 재설계
 */

'use strict';

let currentUser  = null;
let equipmentId  = null;
let allItems     = [];
let editingItemId = null;

/* ── 유틸 ─────────────────────────────────── */
function textSafe(v) {
  return String(v == null ? '' : v)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function qs(sel) { return document.querySelector(sel); }
function val(id) { return (document.getElementById(id)?.value || '').trim(); }
function setVal(id, v) { const el = document.getElementById(id); if (el) el.value = v ?? ''; }

/* ── 장비 정보 로드 ────────────────────────── */
async function loadEquipmentInfo() {
  if (!equipmentId) return null;
  const { data } = await supabaseClient
    .from('equipments')
    .select('id, equipment_name, model_name, clinic_name, team_name')
    .eq('id', equipmentId)
    .single();
  return data;
}

/* ── 항목 목록 로드 ────────────────────────── */
async function loadItems() {
  let q = supabaseClient
    .from('lj_items')
    .select('*, lj_entries(count)')
    .order('created_at', { ascending: true });

  if (equipmentId) q = q.eq('equipment_id', equipmentId);

  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data || [];
}

/* ── 렌더링 ────────────────────────────────── */
let _itemGrid = null;
function renderItems(rows) {
  const empty = document.getElementById('itemListEmpty');
  if (empty) empty.style.display = rows.length ? 'none' : '';

  const cols = [
    { headerName: '항목명', field: 'item_name', flex: 2, minWidth: 120 },
    { headerName: '유형',   field: 'item_type', flex: 1, minWidth: 70,
      valueFormatter: p => p.value === 'quantitative' ? '정량' : '정성' },
    { headerName: '단위',   field: 'unit',      flex: 1, minWidth: 70, valueFormatter: p => p.value || '-' },
    { headerName: 'Mean',   field: 'mean',      flex: 1, minWidth: 70, valueFormatter: p => p.value != null ? p.value : '-' },
    { headerName: 'SD',     field: 'sd',        flex: 1, minWidth: 70, valueFormatter: p => p.value != null ? p.value : '-' },
    { headerName: '소수점', field: 'decimal_places', flex: 1, minWidth: 70,
      valueFormatter: p => (p.value ?? 2) + '자리' },
    { headerName: '데이터', flex: 1, minWidth: 70,
      valueGetter: p => (p.data.lj_entries?.[0]?.count ?? 0) + '건' },
    { headerName: '관리', flex: 1, minWidth: 180, sortable: false,
      cellRenderer: p => {
        const wrap = document.createElement('div');
        wrap.style.cssText = 'display:flex;gap:4px;align-items:center;';
        const btnEdit = document.createElement('button');
        btnEdit.className = 'btn btn-sm btn-secondary';
        btnEdit.textContent = '수정';
        btnEdit.onclick = () => openEditModal(p.data.id);
        const btnDel = document.createElement('button');
        btnDel.className = 'btn btn-sm btn-danger';
        btnDel.textContent = '삭제';
        btnDel.onclick = () => deleteItem(p.data.id);
        const btnData = document.createElement('button');
        btnData.className = 'btn btn-sm';
        btnData.textContent = '데이터 입력';
        btnData.onclick = () => goData(p.data.id);
        wrap.append(btnEdit, btnDel, btnData);
        return wrap;
      }},
  ];

  if (_itemGrid) { updateMgGrid(_itemGrid, rows); return; }
  _itemGrid =
  createMgGrid('itemList', cols, rows, {
    pageSize: 15, fit: true, noRowsText: '등록된 검사항목이 없습니다.',
  });
}

function goData(itemId) {
  const params = new URLSearchParams();
  if (equipmentId) params.set('equipment_id', equipmentId);
  params.set('item_id', itemId);
  parent.shellNavigate?.(`qc/data?${params}`);
}

/* ── 모달 ──────────────────────────────────── */
function openAddModal() {
  editingItemId = null;
  clearForm();
  document.getElementById('modalTitle').textContent = '항목 추가';
  document.getElementById('itemModal').style.display = 'flex';
}

function openEditModal(itemId) {
  const item = allItems.find(i => i.id === itemId);
  if (!item) return;
  editingItemId = itemId;

  setVal('itemName',      item.item_name);
  setVal('itemType',      item.item_type);
  setVal('itemUnit',      item.unit);
  setVal('itemMean',      item.mean ?? '');
  setVal('itemSd',        item.sd ?? '');
  setVal('itemDecimal',   item.decimal_places ?? 2);
  setVal('itemPreset',    item.preset);
  setVal('itemExpected',  item.expected_value);
  setVal('itemMemo',      item.memo);

  document.getElementById('modalTitle').textContent = '항목 수정';
  document.getElementById('itemModal').style.display = 'flex';
  toggleQuantitativeFields();
}

function closeModal() {
  document.getElementById('itemModal').style.display = 'none';
  editingItemId = null;
  clearForm();
}

function clearForm() {
  ['itemName','itemUnit','itemMean','itemSd','itemPreset','itemExpected','itemMemo'].forEach(id => setVal(id, ''));
  setVal('itemType',    'quantitative');
  setVal('itemDecimal', 2);
  toggleQuantitativeFields();
}

function toggleQuantitativeFields() {
  const type = val('itemType');
  const qFields = document.getElementById('quantitativeFields');
  if (qFields) qFields.style.display = type === 'quantitative' ? '' : 'none';
}

/* ── 저장 ──────────────────────────────────── */
async function saveItem() {
  const name = val('itemName');
  if (!name) throw new Error('항목명은 필수입니다.');

  if (!equipmentId) throw new Error('장비를 먼저 선택해주세요.');

  const { data: { session } } = await supabaseClient.auth.getSession();

  const payload = {
    item_name:      name,
    item_type:      val('itemType') || 'quantitative',
    unit:           val('itemUnit'),
    mean:           val('itemMean') !== '' ? Number(val('itemMean')) : null,
    sd:             val('itemSd')   !== '' ? Number(val('itemSd'))   : null,
    decimal_places: Number(val('itemDecimal') || 2),
    preset:         val('itemPreset'),
    expected_value: val('itemExpected'),
    memo:           val('itemMemo'),
    equipment_id:   equipmentId,
  };

  if (editingItemId) {
    const { error } = await supabaseClient
      .from('lj_items').update(payload).eq('id', editingItemId);
    if (error) throw new Error(error.message);
  } else {
    payload.created_by = session?.user?.id || null;
    const { error } = await supabaseClient
      .from('lj_items').insert(payload);
    if (error) throw new Error(error.message);
  }
}

async function deleteItem(itemId) {
  if (!confirm('이 항목과 연결된 모든 데이터가 삭제됩니다. 계속하시겠습니까?')) return;
  const { error } = await supabaseClient.from('lj_items').delete().eq('id', itemId);
  if (error) { alert('삭제 실패: ' + error.message); return; }
  await refresh();
}

/* ── 새로고침 ──────────────────────────────── */
async function refresh() {
  allItems = await loadItems();
  renderItems(allItems);
  const countEl = document.getElementById('itemCount');
  if (countEl) countEl.textContent = `${allItems.length}개`;
}

/* ── 초기화 ────────────────────────────────── */
async function init() {
  currentUser = await auth.requireAuth();
  if (!currentUser) return;

  const params = new URLSearchParams(location.search);
  equipmentId = params.get('equipment_id') || null;

  // 장비 정보 표시
  if (equipmentId) {
    const eq = await loadEquipmentInfo();
    if (eq) {
      const infoEl = document.getElementById('equipmentInfo');
      if (infoEl) {
        infoEl.textContent = `${eq.equipment_name} · ${eq.model_name || ''} · ${eq.clinic_name || eq.team_name || ''}`;
        infoEl.style.display = '';
      }
    }
  }

  // 항목 추가 버튼
  document.getElementById('addItemBtn')?.addEventListener('click', openAddModal);

  // 모달 닫기
  document.getElementById('closeModalBtn')?.addEventListener('click', closeModal);
  document.getElementById('cancelItemBtn')?.addEventListener('click', closeModal);
  document.getElementById('itemModal')?.addEventListener('click', e => {
    if (e.target === document.getElementById('itemModal')) closeModal();
  });

  // 유형 변경 → 정량 필드 토글
  document.getElementById('itemType')?.addEventListener('change', toggleQuantitativeFields);

  // 저장
  document.getElementById('saveItemBtn')?.addEventListener('click', async () => {
    const btn = document.getElementById('saveItemBtn');
    btn.disabled = true;
    try {
      await saveItem();
      closeModal();
      await refresh();
    } catch (e) {
      alert('저장 실패: ' + e.message);
    } finally {
      btn.disabled = false;
    }
  });

  // 장비 상세로 돌아가기
  document.getElementById('backBtn')?.addEventListener('click', () => {
    if (equipmentId) parent.shellNavigate?.(`equipment/detail?id=${equipmentId}`);
    else parent.shellNavigate?.('equipment/list');
  });

  showGlobalLoading('검사항목을 불러오는 중...');
  try {
    await refresh();
  } catch (e) {
    console.error('[qc/items]', e);
    alert('항목 목록을 불러오지 못했습니다: ' + e.message);
  } finally {
    hideGlobalLoading();
  }
}

function initQcItems() { init(); }
document.addEventListener('DOMContentLoaded', init);
