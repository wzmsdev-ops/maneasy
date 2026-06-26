/**
 * assets/js/master/supply.js
 * 자재·거래처 관리 — vendors / items
 * admin role만 접근 가능
 */
'use strict';

let currentUser = null;
let editingVendorId = null;
let editingItemId   = null;
let vendorCache = [];
let itemCache   = [];

/* ── 유틸 ─────────────────────────────────── */
function ts(v) {
  return String(v == null ? '' : v)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function val(id) { return (document.getElementById(id)?.value || '').trim(); }
function setVal(id, v) { const el = document.getElementById(id); if (el) el.value = v ?? ''; }
function badgeActive(v) {
  return v === 'Y'
    ? '<span class="badge-active">활성</span>'
    : '<span class="badge-inactive">비활성</span>';
}
function fmtPrice(v) {
  if (v == null || v === '') return '-';
  return Number(v).toLocaleString('ko-KR') + '원';
}

/* ── 탭 ── */
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

/* ── 모달 ── */
function openModal(id) { document.getElementById(id)?.classList.add('is-open'); }
function closeModal(id) { document.getElementById(id)?.classList.remove('is-open'); }
window.closeModal = closeModal;

/* ════════════════════════════════════════════
   거래처 (vendors)
════════════════════════════════════════════ */
async function loadVendors() {
  const { data, error } = await supabaseClient
    .from('vendors')
    .select('*')
    .order('vendor_name', { ascending: true });
  if (error) throw new Error(error.message);
  return data || [];
}

function renderVendors(rows) {
  vendorCache = rows;
  const list  = document.getElementById('vendorList');
  const empty = document.getElementById('vendorEmpty');
  if (!list) return;

  if (empty) empty.style.display = 'none';

  if (!window._vendorGrid) {
    window._vendorGrid = (function(){
    var _el = document.getElementById('vendorList');
    if (_el) { _el.classList.add('ag-theme-alpine'); if (!_el.style.height) _el.style.height = '520px'; }
  })();
  createMgGrid('vendorList', [
      { headerName: '코드',     field: 'vendor_code', flex: 1, minWidth: 90 },
      { headerName: '거래처명', field: 'vendor_name', flex: 2, minWidth: 120 },
      { headerName: '사업자번호', field: 'biz_no',   flex: 1, minWidth: 110, valueFormatter: p => p.value || '-' },
      { headerName: '대표자',   field: 'ceo_name',   flex: 1, minWidth: 80,  valueFormatter: p => p.value || '-' },
      { headerName: '전화',     field: 'phone',      flex: 1, minWidth: 110, valueFormatter: p => p.value || '-' },
      { headerName: '카테고리', field: 'category',   flex: 1, minWidth: 90,  valueFormatter: p => p.value || '-' },
      { headerName: '상태',     field: 'active',     flex: 0, width: 70,
        cellRenderer: p => { const s = document.createElement('span'); s.innerHTML = badgeActive(p.value); return s; } },
      { headerName: '', flex: 0, width: 120, sortable: false,
        cellRenderer: p => {
          const wrap = document.createElement('div'); wrap.style.cssText = 'display:flex;gap:4px;align-items:center;';
          const e = document.createElement('button'); e.className = 'btn btn-sm'; e.textContent = '수정'; e.onclick = () => openEditVendor(p.data.id);
          const d = document.createElement('button'); d.className = 'btn btn-sm btn-danger'; d.textContent = '삭제'; d.onclick = () => deleteVendor(p.data.id);
          wrap.append(e, d); return wrap;
        }},
    ], rows, { pageSize: 15, fit: true, noRowsText: '등록된 거래처가 없습니다.' });
  } else {
    updateMgGrid(window._vendorGrid, rows);
  }
  populateVendorSelect(rows);
}

function populateVendorSelect(vendors) {
  const sel = document.getElementById('i_vendor_id');
  if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = '<option value="">선택 안 함</option>' +
    vendors.map(v => `<option value="${v.id}">${ts(v.vendor_name)}</option>`).join('');
  if (cur) sel.value = cur;
}

function openAddVendor() {
  editingVendorId = null;
  ['v_vendor_code','v_vendor_name','v_biz_no','v_ceo_name',
   'v_phone','v_email','v_address','v_category','v_memo'].forEach(id => setVal(id, ''));
  setVal('v_active', 'Y');
  document.getElementById('vendorModalTitle').textContent = '거래처 추가';
  openModal('vendorModal');
}

function openEditVendor(id) {
  const row = vendorCache.find(r => r.id === id);
  if (!row) return;
  editingVendorId = id;
  setVal('v_vendor_code', row.vendor_code);
  setVal('v_vendor_name', row.vendor_name);
  setVal('v_biz_no',      row.biz_no);
  setVal('v_ceo_name',    row.ceo_name);
  setVal('v_phone',       row.phone);
  setVal('v_email',       row.email);
  setVal('v_address',     row.address);
  setVal('v_category',    row.category);
  setVal('v_memo',        row.memo);
  setVal('v_active',      row.active);
  document.getElementById('vendorModalTitle').textContent = '거래처 수정';
  openModal('vendorModal');
}
window.openEditVendor = openEditVendor;

async function saveVendor() {
  const payload = {
    vendor_code: val('v_vendor_code'),
    vendor_name: val('v_vendor_name'),
    biz_no:      val('v_biz_no'),
    ceo_name:    val('v_ceo_name'),
    phone:       val('v_phone'),
    email:       val('v_email'),
    address:     val('v_address'),
    category:    val('v_category'),
    memo:        val('v_memo'),
    active:      val('v_active'),
    updated_at:  new Date().toISOString(),
  };
  if (!payload.vendor_code) throw new Error('거래처 코드는 필수입니다.');
  if (!payload.vendor_name) throw new Error('거래처명은 필수입니다.');

  if (editingVendorId) {
    const { error } = await supabaseClient.from('vendors').update(payload).eq('id', editingVendorId);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await supabaseClient.from('vendors').insert(payload);
    if (error) throw new Error(error.message);
  }
}

async function deleteVendor(id) {
  if (!confirm('거래처를 삭제하시겠습니까?\n연결된 자재가 있으면 삭제되지 않습니다.')) return;
  const { error } = await supabaseClient.from('vendors').delete().eq('id', id);
  if (error) { alert('삭제 실패: ' + error.message); return; }
  await refreshVendors();
}
window.deleteVendor = deleteVendor;

async function refreshVendors() {
  const rows = await loadVendors();
  renderVendors(rows);
}

/* ════════════════════════════════════════════
   자재 (items)
════════════════════════════════════════════ */
async function loadItems() {
  const { data, error } = await supabaseClient
    .from('items')
    .select('*, vendors(vendor_name)')
    .order('item_name', { ascending: true });
  if (error) throw new Error(error.message);
  return data || [];
}

function renderItems(rows) {
  itemCache = rows;
  const list  = document.getElementById('itemList');
  const empty = document.getElementById('itemEmpty');
  if (!list) return;

  if (empty) empty.style.display = 'none';

  if (!window._itemGrid) {
    window._itemGrid = (function(){
    var _el = document.getElementById('itemList');
    if (_el) { _el.classList.add('ag-theme-alpine'); if (!_el.style.height) _el.style.height = '520px'; }
  })();
  createMgGrid('itemList', [
      { headerName: '코드',   field: 'item_code',  flex: 1, minWidth: 90 },
      { headerName: '자재명', field: 'item_name',  flex: 2, minWidth: 120 },
      { headerName: '카테고리', field: 'category', flex: 1, minWidth: 90,  valueFormatter: p => p.value || '-' },
      { headerName: '단위',   field: 'unit',       flex: 0, width: 70,     valueFormatter: p => p.value || '-' },
      { headerName: '규격',   field: 'spec',       flex: 1, minWidth: 90,  valueFormatter: p => p.value || '-' },
      { headerName: '기준단가', field: 'standard_price', flex: 1, minWidth: 90,
        valueFormatter: p => fmtPrice(p.value) },
      { headerName: '거래처', flex: 1, minWidth: 100,
        valueGetter: p => p.data.vendors?.vendor_name || '-' },
      { headerName: '상태',   field: 'active',     flex: 0, width: 70,
        cellRenderer: p => { const s = document.createElement('span'); s.innerHTML = badgeActive(p.value); return s; } },
      { headerName: '', flex: 0, width: 120, sortable: false,
        cellRenderer: p => {
          const wrap = document.createElement('div'); wrap.style.cssText = 'display:flex;gap:4px;align-items:center;';
          const e = document.createElement('button'); e.className = 'btn btn-sm'; e.textContent = '수정'; e.onclick = () => openEditItem(p.data.id);
          const d = document.createElement('button'); d.className = 'btn btn-sm btn-danger'; d.textContent = '삭제'; d.onclick = () => deleteItem(p.data.id);
          wrap.append(e, d); return wrap;
        }},
    ], rows, { pageSize: 15, fit: true, noRowsText: '등록된 자재가 없습니다.' });
  } else {
    updateMgGrid(window._itemGrid, rows);
  }
}

function openAddItem() {
  editingItemId = null;
  ['i_item_code','i_item_name','i_category','i_unit','i_spec','i_memo'].forEach(id => setVal(id, ''));
  setVal('i_standard_price', '');
  setVal('i_vendor_id', '');
  setVal('i_active', 'Y');
  document.getElementById('itemModalTitle').textContent = '자재 추가';
  openModal('itemModal');
}

function openEditItem(id) {
  const row = itemCache.find(r => r.id === id);
  if (!row) return;
  editingItemId = id;
  setVal('i_item_code',       row.item_code);
  setVal('i_item_name',       row.item_name);
  setVal('i_category',        row.category);
  setVal('i_unit',            row.unit);
  setVal('i_spec',            row.spec);
  setVal('i_standard_price',  row.standard_price ?? '');
  setVal('i_vendor_id',       row.vendor_id || '');
  setVal('i_memo',            row.memo);
  setVal('i_active',          row.active);
  document.getElementById('itemModalTitle').textContent = '자재 수정';
  openModal('itemModal');
}
window.openEditItem = openEditItem;

async function saveItem() {
  const priceStr = val('i_standard_price');
  const payload = {
    item_code:      val('i_item_code'),
    item_name:      val('i_item_name'),
    category:       val('i_category'),
    unit:           val('i_unit'),
    spec:           val('i_spec'),
    standard_price: priceStr !== '' ? Number(priceStr) : null,
    vendor_id:      val('i_vendor_id') || null,
    memo:           val('i_memo'),
    active:         val('i_active'),
    updated_at:     new Date().toISOString(),
  };
  if (!payload.item_code) throw new Error('자재 코드는 필수입니다.');
  if (!payload.item_name) throw new Error('자재명은 필수입니다.');

  if (editingItemId) {
    const { error } = await supabaseClient.from('items').update(payload).eq('id', editingItemId);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await supabaseClient.from('items').insert(payload);
    if (error) throw new Error(error.message);
  }
}

async function deleteItem(id) {
  if (!confirm('자재를 삭제하시겠습니까?')) return;
  const { error } = await supabaseClient.from('items').delete().eq('id', id);
  if (error) { alert('삭제 실패: ' + error.message); return; }
  await refreshItems();
}
window.deleteItem = deleteItem;

async function refreshItems() {
  const rows = await loadItems();
  renderItems(rows);
}

/* ════════════════════════════════════════════
   저장 버튼 공통
════════════════════════════════════════════ */
function bindSaveBtn(btnId, saveFn, modalId, refreshFn) {
  document.getElementById(btnId)?.addEventListener('click', async () => {
    const btn = document.getElementById(btnId);
    btn.disabled = true;
    try {
      await saveFn();
      closeModal(modalId);
      await refreshFn();
    } catch (e) {
      alert('저장 실패: ' + e.message);
    } finally {
      btn.disabled = false;
    }
  });
}

/* ════════════════════════════════════════════
   초기화
════════════════════════════════════════════ */
async function init() {
  currentUser = await auth.requireAdmin();
  if (!currentUser) return;

  initTabs();

  document.getElementById('addVendorBtn')?.addEventListener('click', openAddVendor);
  document.getElementById('addItemBtn')?.addEventListener('click', openAddItem);

  bindSaveBtn('vendorSaveBtn', saveVendor, 'vendorModal', refreshVendors);
  bindSaveBtn('itemSaveBtn',   saveItem,   'itemModal',   refreshItems);

  showGlobalLoading('데이터를 불러오는 중...');
  try {
    const [vendors, items] = await Promise.all([loadVendors(), loadItems()]);
    renderVendors(vendors);
    renderItems(items);
  } catch (e) {
    alert('초기화 실패: ' + e.message);
    console.error('[master/supply]', e);
  } finally {
    hideGlobalLoading();
  }
}

document.addEventListener('DOMContentLoaded', init);
