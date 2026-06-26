/**
 * assets/js/master/procurement.js
 * 발주 관리 — purchase_orders + purchase_order_items
 * 부가세: DB에는 supply_price(공급가액)만 저장, VAT/합계는 조회 시 계산
 */
'use strict';

var poState = {
  page: 1, pageSize: 20, totalPages: 1, loading: false,
  statusFilter: '',
};

var _poGrid     = null;
var vendorCache = [];   // 거래처 목록 캐시
var itemCache   = [];   // 자재 목록 캐시 (품목 select용)
var editingPoId = null;

/* ── 유틸 ── */
function ts(v) {
  return String(v == null ? '' : v)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function val(id)       { return (document.getElementById(id)?.value || '').trim(); }
function setVal(id, v) { var el = document.getElementById(id); if (el) el.value = v ?? ''; }

/** 부가세 계산 — 전체 공급가 합계에서 한 번만 */
function calcVat(supplyTotal) { return Math.round(supplyTotal * 0.1); }
function calcTotal(supplyTotal) { return supplyTotal + calcVat(supplyTotal); }
function fmtN(n) { return Number(n || 0).toLocaleString('ko-KR') + '원'; }
function fmtDate(v) { return v ? String(v).slice(0, 10) : '-'; }

var STATUS_LABEL = {
  DRAFT:     '초안',
  ORDERED:   '발주완료',
  PARTIAL:   '부분입고',
  COMPLETED: '완료',
  CANCELLED: '취소',
};
var STATUS_BADGE = {
  DRAFT:     'badge-draft',
  ORDERED:   'badge-ordered',
  PARTIAL:   'badge-partial',
  COMPLETED: 'badge-completed',
  CANCELLED: 'badge-cancelled',
};

function badgeStatus(s) {
  return '<span class="' + (STATUS_BADGE[s] || 'badge-draft') + '">' + (STATUS_LABEL[s] || ts(s)) + '</span>';
}

/* ── 모달 ── */
function openModal(id)  { document.getElementById(id)?.classList.add('is-open'); }
function closeModal(id) { document.getElementById(id)?.classList.remove('is-open'); }
window.closeModal = closeModal;

/* ── 탭 필터 ── */
function initStatusTabs() {
  document.querySelectorAll('.po-status-tab').forEach(function(btn) {
    btn.addEventListener('click', function() {
      document.querySelectorAll('.po-status-tab').forEach(function(b) { b.classList.remove('active'); });
      btn.classList.add('active');
      poState.statusFilter = btn.dataset.status || '';
      loadPoList(1);
    });
  });
}

/* ── 페이지네이션 ── */
function renderPagination() {
  var container = document.getElementById('poPagination');
  if (!container) return;
  var page = poState.page, totalPages = poState.totalPages;
  if (totalPages <= 1) { container.innerHTML = ''; return; }

  var blockSize = 10;
  var blockStart = Math.floor((page - 1) / blockSize) * blockSize + 1;
  var end = Math.min(totalPages, blockStart + blockSize - 1);
  var pages = [];
  for (var i = blockStart; i <= end; i++) {
    pages.push('<button class="pagination-btn' + (i === page ? ' is-active' : '') + '" data-page="' + i + '">' + i + '</button>');
  }
  container.innerHTML =
    '<button class="pagination-btn" data-page="' + Math.max(1, blockStart - 1) + '"' + (blockStart <= 1 ? ' disabled' : '') + '>이전</button>' +
    pages.join('') +
    '<button class="pagination-btn" data-page="' + Math.min(totalPages, end + 1) + '"' + (end >= totalPages ? ' disabled' : '') + '>다음</button>';

  Array.prototype.forEach.call(container.querySelectorAll('.pagination-btn[data-page]'), function(btn) {
    btn.addEventListener('click', function() {
      var p = Number(btn.dataset.page);
      if (p && p !== poState.page) loadPoList(p);
    });
  });
}

/* ── 발주 목록 로드 ── */
async function loadPoList(page) {
  if (poState.loading) return;
  poState.loading = true;
  page = page || poState.page;
  showGlobalLoading('발주 목록을 불러오는 중...');
  try {
    var from = (page - 1) * poState.pageSize;
    var to   = from + poState.pageSize - 1;
    var q = supabaseClient
      .from('purchase_orders')
      .select('*, vendors(vendor_name)', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, to);
    if (poState.statusFilter) q = q.eq('status', poState.statusFilter);

    var { data, error, count } = await q;
    if (error) throw new Error(error.message);

    poState.page       = page;
    poState.totalPages = Math.max(1, Math.ceil((count || 0) / poState.pageSize));

    var label = document.getElementById('poCountLabel');
    if (label) label.textContent = '총 ' + (count || 0) + '건';

    _poGrid?.setGridOption('rowData', (data || []).map(function(r) {
      r._vat   = calcVat(r.supply_price || 0);
      r._total = calcTotal(r.supply_price || 0);
      return r;
    }));
    renderPagination();
  } catch(e) {
    alert('발주 목록 로드 실패: ' + e.message);
  } finally {
    poState.loading = false;
    hideGlobalLoading();
  }
}

/* ── 그리드 초기화 ── */
function initPoGrid() {
  var el = document.getElementById('poGrid');
  if (!el || typeof agGrid === 'undefined') return;

  var colDefs = [
    { headerName: '발주번호',   field: 'order_no',   width: 140,
      headerClass: 'ag-left-header',
      cellStyle: { display:'flex', alignItems:'center', justifyContent:'flex-start' },
      cellRenderer: function(p) { return '<code style="font-size:11px;">' + ts(p.value || '-') + '</code>'; }
    },
    { headerName: '발주일',     field: 'order_date', width: 100,
      cellRenderer: function(p) { return fmtDate(p.value); }
    },
    { headerName: '거래처',     field: 'vendors',    flex: 1,
      cellRenderer: function(p) { return ts(p.value?.vendor_name || '-'); }
    },
    { headerName: '납품예정일', field: 'expected_date', width: 100,
      cellRenderer: function(p) { return fmtDate(p.value); }
    },
    { headerName: '공급가액',   field: 'supply_price', width: 110,
      cellStyle: { display:'flex', alignItems:'center', justifyContent:'flex-end' },
      cellRenderer: function(p) { return fmtN(p.value); }
    },
    { headerName: 'VAT',        field: '_vat', width: 90,
      cellStyle: { display:'flex', alignItems:'center', justifyContent:'flex-end' },
      cellRenderer: function(p) { return fmtN(p.value); }
    },
    { headerName: '합계',       field: '_total', width: 110,
      cellStyle: { display:'flex', alignItems:'center', justifyContent:'flex-end' },
      cellRenderer: function(p) { return '<strong>' + fmtN(p.value) + '</strong>'; }
    },
    { headerName: '상태', field: 'status', width: 90,
      cellRenderer: function(p) {
        var s = document.createElement('span');
        s.innerHTML = badgeStatus(p.value);
        return s;
      }
    },
    { headerName: '', width: 120, sortable: false,
      cellRenderer: function(p) {
        var wrap = document.createElement('div');
        wrap.style.cssText = 'display:flex;gap:4px;align-items:center;';
        var v = document.createElement('button');
        v.className = 'tbl-btn'; v.textContent = '상세';
        v.onclick = function() { openPoDetail(p.data.id); };
        wrap.appendChild(v);
        if (p.data.status === 'DRAFT') {
          var e = document.createElement('button');
          e.className = 'tbl-btn tbl-btn--primary'; e.textContent = '수정';
          e.onclick = function() { openEditPo(p.data.id); };
          wrap.appendChild(e);
        }
        return wrap;
      }
    },
  ];

  _poGrid = createMgGrid('poGrid', colDefs, [], {
    noRowsText: '발주 내역이 없습니다.',
    onRowClick: null,
  });
}

/* ════════════════════════════════
   발주 등록/수정 모달
════════════════════════════════ */

/** 품목 행 추가 */
function addPoItemRow(item) {
  var tbody = document.getElementById('poItemsTbody');
  if (!tbody) return;
  var tr = document.createElement('tr');
  tr.innerHTML =
    '<td><select class="poi-item">' +
      '<option value="">자재 선택</option>' +
      itemCache.map(function(it) {
        return '<option value="' + it.id + '" data-pu="' + ts(it.purchase_unit) + '" data-uprice="' + (it.standard_price || 0) + '">' + ts(it.item_name) + '</option>';
      }).join('') +
    '</select></td>' +
    '<td class="col-unit"><input type="text" class="poi-pu" readonly style="background:#f8fafc;color:#6b7280;" /></td>' +
    '<td class="col-qty"><input type="number" class="poi-qty" min="1" value="1" /></td>' +
    '<td class="col-price"><input type="number" class="poi-price" min="0" value="0" /></td>' +
    '<td class="col-supply"><input type="number" class="poi-supply" readonly style="background:#f8fafc;color:#6b7280;" /></td>' +
    '<td class="col-del"><button type="button" onclick="this.closest(\'tr\').remove(); updatePoTotal();" style="background:none;border:none;color:#dc2626;cursor:pointer;font-size:14px;">✕</button></td>';

  // 자재 선택 시 단위/단가 자동 세팅
  var sel = tr.querySelector('.poi-item');
  var puEl = tr.querySelector('.poi-pu');
  var priceEl = tr.querySelector('.poi-price');
  var supplyEl = tr.querySelector('.poi-supply');
  var qtyEl = tr.querySelector('.poi-qty');

  function recalcRow() {
    var q = Number(qtyEl.value || 1);
    var p = Number(priceEl.value || 0);
    supplyEl.value = q * p;
    updatePoTotal();
  }

  sel.addEventListener('change', function() {
    var opt = sel.options[sel.selectedIndex];
    puEl.value    = opt.dataset.pu    || '';
    priceEl.value = opt.dataset.uprice || 0;
    recalcRow();
  });
  qtyEl.addEventListener('input',   recalcRow);
  priceEl.addEventListener('input',  recalcRow);

  // 편집 시 기존값 세팅
  if (item) {
    sel.value     = item.item_id || '';
    sel.dispatchEvent(new Event('change'));
    puEl.value    = item.purchase_unit || '';
    priceEl.value = item.unit_price    || 0;
    qtyEl.value   = item.order_qty     || 1;
    supplyEl.value = item.supply_price || 0;
    tr.dataset.id = item.id || '';
  }

  tbody.appendChild(tr);
  updatePoTotal();
}

function updatePoTotal() {
  var rows = document.querySelectorAll('#poItemsTbody tr');
  var supplyTotal = 0;
  rows.forEach(function(tr) {
    supplyTotal += Number(tr.querySelector('.poi-supply')?.value || 0);
  });
  var vat   = calcVat(supplyTotal);
  var total = calcTotal(supplyTotal);
  var s = document.getElementById('poTotalSupply');
  var v = document.getElementById('poTotalVat');
  var t = document.getElementById('poTotalAmount');
  if (s) s.textContent = fmtN(supplyTotal);
  if (v) v.textContent = fmtN(vat);
  if (t) t.textContent = fmtN(total);
}

function openAddPo() {
  editingPoId = null;
  setVal('po_order_no', '');
  setVal('po_order_date', new Date().toISOString().slice(0, 10));
  setVal('po_vendor_id', '');
  setVal('po_expected_date', '');
  setVal('po_memo', '');
  document.getElementById('poItemsTbody').innerHTML = '';
  updatePoTotal();
  document.getElementById('poModalTitle').textContent = '발주 등록';
  openModal('poModal');
}

async function openEditPo(id) {
  showGlobalLoading('발주 정보를 불러오는 중...');
  try {
    var { data: po, error: e1 } = await supabaseClient
      .from('purchase_orders').select('*').eq('id', id).single();
    if (e1) throw new Error(e1.message);

    var { data: items, error: e2 } = await supabaseClient
      .from('purchase_order_items').select('*').eq('order_id', id);
    if (e2) throw new Error(e2.message);

    editingPoId = id;
    setVal('po_order_no',       po.order_no);
    setVal('po_order_date',     po.order_date);
    setVal('po_vendor_id',      po.vendor_id);
    setVal('po_expected_date',  po.expected_date || '');
    setVal('po_memo',           po.memo);

    document.getElementById('poItemsTbody').innerHTML = '';
    (items || []).forEach(function(item) { addPoItemRow(item); });
    updatePoTotal();
    document.getElementById('poModalTitle').textContent = '발주 수정';
    openModal('poModal');
  } catch(e) {
    alert('발주 로드 실패: ' + e.message);
  } finally {
    hideGlobalLoading();
  }
}
window.openEditPo = openEditPo;

async function savePo() {
  var vendorId = val('po_vendor_id');
  if (!vendorId) throw new Error('거래처를 선택해주세요.');

  var rows = document.querySelectorAll('#poItemsTbody tr');
  var itemRows = [];
  var supplyTotal = 0;
  rows.forEach(function(tr) {
    var itemId = tr.querySelector('.poi-item')?.value;
    if (!itemId) return;
    var qty   = Number(tr.querySelector('.poi-qty')?.value   || 1);
    var price = Number(tr.querySelector('.poi-price')?.value || 0);
    var supply = qty * price;
    supplyTotal += supply;
    itemRows.push({
      item_id:          itemId,
      purchase_unit:    tr.querySelector('.poi-pu')?.value || '',
      purchase_unit_qty: 1,
      use_unit:         '',
      order_qty:        qty,
      unit_price:       price,
      memo:             '',
      _id: tr.dataset.id || null,
    });
  });
  if (!itemRows.length) throw new Error('품목을 1개 이상 추가해주세요.');

  var now = new Date().toISOString();
  var poPayload = {
    vendor_id:     vendorId,
    order_date:    val('po_order_date') || new Date().toISOString().slice(0, 10),
    expected_date: val('po_expected_date') || null,
    supply_price:  supplyTotal,
    memo:          val('po_memo'),
    status:        'DRAFT',
    updated_at:    now,
  };

  var orderId = editingPoId;
  if (orderId) {
    // 수정
    var { error: ue } = await supabaseClient.from('purchase_orders').update(poPayload).eq('id', orderId);
    if (ue) throw new Error(ue.message);
    // 기존 품목 삭제 후 재삽입
    await supabaseClient.from('purchase_order_items').delete().eq('order_id', orderId);
  } else {
    // 신규 — 발주번호 생성
    var orderNo = await genOrderNo();
    poPayload.order_no = orderNo;
    var { data: newPo, error: ie } = await supabaseClient.from('purchase_orders').insert(poPayload).select().single();
    if (ie) throw new Error(ie.message);
    orderId = newPo.id;
  }

  // 품목 삽입
  var poItems = itemRows.map(function(r) {
    return {
      order_id:          orderId,
      item_id:           r.item_id,
      purchase_unit:     r.purchase_unit,
      purchase_unit_qty: r.purchase_unit_qty,
      use_unit:          r.use_unit,
      order_qty:         r.order_qty,
      unit_price:        r.unit_price,
      memo:              r.memo,
    };
  });
  var { error: pie } = await supabaseClient.from('purchase_order_items').insert(poItems);
  if (pie) throw new Error(pie.message);
}

/** 발주번호 채번: PO-YYYY-NNNN */
async function genOrderNo() {
  var year = new Date().getFullYear();
  var { data, error } = await supabaseClient.rpc('next_doc_seq', { p_prefix: 'PO', p_year: year });
  if (error || data == null) {
    // RPC 없으면 타임스탬프 fallback
    return 'PO-' + year + '-' + Date.now().toString().slice(-6);
  }
  return 'PO-' + year + '-' + String(data).padStart(4, '0');
}

/* ════════════════════════════════
   발주 상세 모달
════════════════════════════════ */
async function openPoDetail(id) {
  showGlobalLoading('발주 상세를 불러오는 중...');
  try {
    var { data: po, error: e1 } = await supabaseClient
      .from('purchase_orders')
      .select('*, vendors(vendor_name)')
      .eq('id', id).single();
    if (e1) throw new Error(e1.message);

    var { data: poItems, error: e2 } = await supabaseClient
      .from('purchase_order_items')
      .select('*, items(item_name, purchase_unit)')
      .eq('order_id', id);
    if (e2) throw new Error(e2.message);

    var vat   = calcVat(po.supply_price || 0);
    var total = calcTotal(po.supply_price || 0);

    var itemRows = (poItems || []).map(function(r) {
      return '<tr>' +
        '<td>' + ts(r.items?.item_name || '-') + '</td>' +
        '<td style="text-align:center">' + ts(r.purchase_unit || '-') + '</td>' +
        '<td style="text-align:right">' + (r.order_qty || 0) + '</td>' +
        '<td style="text-align:right">' + fmtN(r.unit_price) + '</td>' +
        '<td style="text-align:right">' + fmtN(r.supply_price) + '</td>' +
        '<td style="text-align:right">' + (r.received_qty || 0) + '</td>' +
        '</tr>';
    }).join('');

    var body = document.getElementById('poDetailBody');
    body.innerHTML =
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px;">' +
        '<div style="font-size:12px;"><span style="color:#9ca3af;font-size:11px;">발주번호</span><br><strong>' + ts(po.order_no) + '</strong></div>' +
        '<div style="font-size:12px;"><span style="color:#9ca3af;font-size:11px;">상태</span><br>' + badgeStatus(po.status) + '</div>' +
        '<div style="font-size:12px;"><span style="color:#9ca3af;font-size:11px;">거래처</span><br>' + ts(po.vendors?.vendor_name || '-') + '</div>' +
        '<div style="font-size:12px;"><span style="color:#9ca3af;font-size:11px;">발주일</span><br>' + fmtDate(po.order_date) + '</div>' +
        '<div style="font-size:12px;"><span style="color:#9ca3af;font-size:11px;">납품예정일</span><br>' + fmtDate(po.expected_date) + '</div>' +
        '<div style="font-size:12px;"><span style="color:#9ca3af;font-size:11px;">메모</span><br>' + ts(po.memo || '-') + '</div>' +
      '</div>' +
      '<table class="po-items-table">' +
        '<thead><tr>' +
          '<th>자재명</th><th>입고단위</th><th style="text-align:right;">발주수량</th>' +
          '<th style="text-align:right;">단가</th><th style="text-align:right;">공급가액</th>' +
          '<th style="text-align:right;">입고수량</th>' +
        '</tr></thead>' +
        '<tbody>' + itemRows + '</tbody>' +
      '</table>' +
      '<div class="po-total-row" style="margin-top:8px;">' +
        '<span>공급가액 <strong>' + fmtN(po.supply_price) + '</strong></span>' +
        '<span>VAT <strong>' + fmtN(vat) + '</strong></span>' +
        '<span>합계 <strong>' + fmtN(total) + '</strong></span>' +
      '</div>';

    // 액션 버튼 (상태에 따라)
    var foot = document.getElementById('poDetailFoot');
    foot.innerHTML = '<button class="btn btn-sm" onclick="closeModal(\'poDetailModal\')">닫기</button>';
    if (po.status === 'DRAFT') {
      var ob = document.createElement('button');
      ob.className = 'btn btn-sm btn-primary'; ob.textContent = '발주 확정';
      ob.onclick = function() { changePoStatus(id, 'ORDERED'); };
      foot.insertBefore(ob, foot.firstChild);
    }
    if (po.status === 'DRAFT' || po.status === 'ORDERED') {
      var cb = document.createElement('button');
      cb.className = 'btn btn-sm btn-danger'; cb.textContent = '발주 취소';
      cb.onclick = function() { changePoStatus(id, 'CANCELLED'); };
      foot.insertBefore(cb, foot.firstChild);
    }

    document.getElementById('poDetailTitle').textContent = '발주 상세 — ' + po.order_no;
    openModal('poDetailModal');
  } catch(e) {
    alert('발주 상세 로드 실패: ' + e.message);
  } finally {
    hideGlobalLoading();
  }
}
window.openPoDetail = openPoDetail;

async function changePoStatus(id, status) {
  var label = STATUS_LABEL[status] || status;
  if (!confirm(label + ' 처리하시겠습니까?')) return;
  var { error } = await supabaseClient
    .from('purchase_orders')
    .update({ status: status, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) { alert('상태 변경 실패: ' + error.message); return; }
  closeModal('poDetailModal');
  await loadPoList(poState.page);
}

/* ── 저장 버튼 ── */
function bindSaveBtn() {
  document.getElementById('poSaveBtn')?.addEventListener('click', async function() {
    var btn = document.getElementById('poSaveBtn');
    btn.disabled = true;
    try {
      await savePo();
      closeModal('poModal');
      await loadPoList(1);
    } catch(e) {
      alert('저장 실패: ' + e.message);
    } finally {
      btn.disabled = false;
    }
  });
}

/* ── 캐시 로드 ── */
async function loadCaches() {
  var [v, i] = await Promise.all([
    supabaseClient.from('vendors').select('id, vendor_code, vendor_name').eq('active', 'Y').order('vendor_name'),
    supabaseClient.from('items').select('id, item_code, item_name, purchase_unit, standard_price').eq('active', 'Y').order('item_name'),
  ]);
  vendorCache = v.data || [];
  itemCache   = i.data || [];

  // 거래처 select 채우기
  var vSel = document.getElementById('po_vendor_id');
  if (vSel) {
    vSel.innerHTML = '<option value="">거래처 선택</option>' +
      vendorCache.map(function(v) { return '<option value="' + v.id + '">' + ts(v.vendor_name) + '</option>'; }).join('');
  }
}

/* ── 초기화 ── */
async function init() {
  var currentUser = await auth.requireAuth();
  if (!currentUser) return;

  initStatusTabs();
  initPoGrid();
  bindSaveBtn();

  document.getElementById('addPoBtn')?.addEventListener('click', openAddPo);
  document.getElementById('addPoItemRowBtn')?.addEventListener('click', function() { addPoItemRow(null); });

  showGlobalLoading('데이터를 불러오는 중...');
  try {
    await loadCaches();
    await loadPoList(1);
  } catch(e) {
    alert('초기화 실패: ' + e.message);
  } finally {
    hideGlobalLoading();
  }
}

document.addEventListener('DOMContentLoaded', init);
