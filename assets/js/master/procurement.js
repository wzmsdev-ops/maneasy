/**
 * assets/js/master/procurement.js
 * 발주 관리 — 목록/등록/상세 전부 AG Grid
 *
 * 부가세 원칙:
 *   DB: supply_price(공급가액)만 저장
 *   VAT = round(합계 공급가액 * 0.1)  — 행별 계산 금지
 *   합계 = supply_price + VAT
 */
'use strict';

/* ── 상태 ── */
var poState = {
  page: 1, pageSize: 20, totalPages: 1, loading: false,
  statusFilter: '',
};

var _poListGrid   = null;   // 발주 목록 그리드
var _poItemGrid   = null;   // 발주 등록/수정 모달 품목 그리드
var _poDetailGrid = null;   // 발주 상세 모달 품목 그리드

var vendorCache = [];   // 거래처 [{id, vendor_name}]
var itemCache   = [];   // 자재   [{id, item_name, purchase_unit, standard_price}]

var editingPoId   = null;
var poItemRowData = [];   // 품목 그리드 rowData (로컬 상태)

/* ── 유틸 ── */
function ts(v) {
  return String(v == null ? '' : v)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function val(id)       { return (document.getElementById(id)?.value || '').trim(); }
function setVal(id, v) { var el = document.getElementById(id); if (el) el.value = v ?? ''; }
function fmtN(n)       { return Number(n || 0).toLocaleString('ko-KR') + '원'; }
function fmtDate(v)    { return v ? String(v).slice(0, 10) : '-'; }
function calcVat(s)    { return Math.round((s || 0) * 0.1); }

var STATUS_LABEL = { DRAFT:'초안', ORDERED:'발주완료', PARTIAL:'부분입고', COMPLETED:'완료', CANCELLED:'취소' };
var STATUS_BADGE = { DRAFT:'badge-draft', ORDERED:'badge-ordered', PARTIAL:'badge-partial', COMPLETED:'badge-completed', CANCELLED:'badge-cancelled' };

function badgeStatus(s) {
  return '<span class="' + (STATUS_BADGE[s] || 'badge-draft') + '">' + (STATUS_LABEL[s] || ts(s)) + '</span>';
}

/* ── 모달 ── */
function openModal(id)  { document.getElementById(id)?.classList.add('is-open'); }
function closeModal(id) { document.getElementById(id)?.classList.remove('is-open'); }
window.closeModal = closeModal;

/* ══════════════════════════════════════════
   1. 발주 목록 그리드 (createMgGrid 활용)
══════════════════════════════════════════ */
function initPoListGrid() {
  _poListGrid = createMgGrid('poGrid', [
    { headerName: '발주번호', field: 'order_no', width: 140,
      headerClass: 'ag-left-header',
      cellStyle: { display:'flex', alignItems:'center', justifyContent:'flex-start' },
      cellRenderer: function(p) { return '<code style="font-size:11px;">' + ts(p.value || '-') + '</code>'; }
    },
    { headerName: '발주일', field: 'order_date', width: 100,
      cellRenderer: function(p) { return fmtDate(p.value); }
    },
    { headerName: '거래처', field: 'vendors', flex: 1,
      headerClass: 'ag-left-header',
      cellStyle: { display:'flex', alignItems:'center', justifyContent:'flex-start' },
      cellRenderer: function(p) { return ts(p.value?.vendor_name || '-'); }
    },
    { headerName: '납품예정일', field: 'expected_date', width: 100,
      cellRenderer: function(p) { return fmtDate(p.value); }
    },
    { headerName: '공급가액', field: 'supply_price', width: 110,
      headerClass: 'ag-right-header',
      cellStyle: { display:'flex', alignItems:'center', justifyContent:'flex-end' },
      cellRenderer: function(p) { return fmtN(p.value); }
    },
    { headerName: 'VAT', field: '_vat', width: 90,
      headerClass: 'ag-right-header',
      cellStyle: { display:'flex', alignItems:'center', justifyContent:'flex-end' },
      cellRenderer: function(p) { return fmtN(p.value); }
    },
    { headerName: '합계', field: '_total', width: 120,
      headerClass: 'ag-right-header',
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
    { headerName: '', width: 130, sortable: false,
      cellRenderer: function(p) {
        var wrap = document.createElement('div');
        wrap.style.cssText = 'display:flex;gap:4px;align-items:center;height:100%;';
        var vBtn = document.createElement('button');
        vBtn.className = 'tbl-btn'; vBtn.textContent = '상세';
        vBtn.onclick = function() { openPoDetail(p.data.id); };
        wrap.appendChild(vBtn);
        if (p.data.status === 'DRAFT') {
          var eBtn = document.createElement('button');
          eBtn.className = 'tbl-btn tbl-btn--primary'; eBtn.textContent = '수정';
          eBtn.onclick = function() { openEditPo(p.data.id); };
          wrap.appendChild(eBtn);
        }
        return wrap;
      }
    },
  ], [], { noRowsText: '발주 내역이 없습니다.' });
}

/* 목록 로드 */
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

    updateMgGrid(_poListGrid, (data || []).map(function(r) {
      r._vat   = calcVat(r.supply_price);
      r._total = (r.supply_price || 0) + r._vat;
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

function renderPagination() {
  var container = document.getElementById('poPagination');
  if (!container) return;
  var page = poState.page, totalPages = poState.totalPages;
  if (totalPages <= 1) { container.innerHTML = ''; return; }
  var bs = Math.floor((page-1)/10)*10+1, end = Math.min(totalPages, bs+9), pages = [];
  for (var i = bs; i <= end; i++)
    pages.push('<button class="pagination-btn' + (i===page?' is-active':'') + '" data-page="' + i + '">' + i + '</button>');
  container.innerHTML =
    '<button class="pagination-btn" data-page="' + Math.max(1,bs-1) + '"' + (bs<=1?' disabled':'') + '>이전</button>' +
    pages.join('') +
    '<button class="pagination-btn" data-page="' + Math.min(totalPages,end+1) + '"' + (end>=totalPages?' disabled':'') + '>다음</button>';
  Array.prototype.forEach.call(container.querySelectorAll('.pagination-btn[data-page]'), function(btn) {
    btn.addEventListener('click', function() {
      var p = Number(btn.dataset.page);
      if (p && p !== poState.page) loadPoList(p);
    });
  });
}

/* 상태 탭 */
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

/* ══════════════════════════════════════════
   2. 발주 품목 입력 그리드 (inline editable)
══════════════════════════════════════════ */

/** 품목 select cellEditor */
function ItemSelectEditor() {}
ItemSelectEditor.prototype.init = function(params) {
  this.value = params.value;
  this.eInput = document.createElement('select');
  this.eInput.style.cssText = 'width:100%;height:100%;border:none;outline:2px solid #3b82f6;padding:0 6px;font-size:11px;background:#fff;box-sizing:border-box;';
  this.eInput.innerHTML = '<option value="">자재 선택</option>' +
    itemCache.map(function(it) {
      return '<option value="' + it.id + '">' + ts(it.item_name) + '</option>';
    }).join('');
  this.eInput.value = params.value || '';
  var self = this;
  this.eInput.addEventListener('change', function() {
    self.value = self.eInput.value;
    params.stopEditing();
  });
};
ItemSelectEditor.prototype.getGui = function() { return this.eInput; };
ItemSelectEditor.prototype.afterGuiAttached = function() { this.eInput.focus(); };
ItemSelectEditor.prototype.getValue = function() { return this.value; };
ItemSelectEditor.prototype.isPopup = function() { return false; };

function initPoItemGrid() {
  var el = document.getElementById('poItemGrid');
  if (!el || typeof agGrid === 'undefined') return;

  var colDefs = [
    { headerName: '자재명', field: 'item_id', flex: 2,
      headerClass: 'ag-left-header',
      cellStyle: { display:'flex', alignItems:'center', justifyContent:'flex-start' },
      editable: true,
      cellEditorFramework: ItemSelectEditor,
      cellEditorParams: {},
      cellRenderer: function(p) {
        if (!p.value) return '<span style="color:#9ca3af;">자재를 선택하세요</span>';
        var item = itemCache.find(function(it) { return it.id === p.value; });
        return ts(item ? item.item_name : p.value);
      },
      onCellValueChanged: function(p) {
        var item = itemCache.find(function(it) { return it.id === p.newValue; });
        if (item) {
          p.node.setDataValue('purchase_unit', item.purchase_unit || '');
          p.node.setDataValue('use_unit',      item.use_unit      || '');
          p.node.setDataValue('unit_price',     item.standard_price || 0);
          recalcRow(p.node);
        }
      }
    },
    { headerName: '입고단위', field: 'purchase_unit', width: 80,
      cellStyle: { display:'flex', alignItems:'center', justifyContent:'center', background:'#f8fafc', color:'#6b7280' },
      cellRenderer: function(p) { return ts(p.value || '-'); }
    },
    { headerName: '사용단위', field: 'use_unit', width: 80,
      cellStyle: { display:'flex', alignItems:'center', justifyContent:'center', background:'#f8fafc', color:'#6b7280' },
      cellRenderer: function(p) { return ts(p.value || '-'); }
    },
    { headerName: '수량', field: 'order_qty', width: 80,
      headerClass: 'ag-right-header',
      cellStyle: { display:'flex', alignItems:'center', justifyContent:'flex-end' },
      editable: true,
      cellEditor: 'agNumberCellEditor',
      cellEditorParams: { min: 1 },
      cellRenderer: function(p) { return Number(p.value || 1).toLocaleString('ko-KR'); },
      onCellValueChanged: function(p) { recalcRow(p.node); }
    },
    { headerName: '단가 (공급가)', field: 'unit_price', width: 120,
      headerClass: 'ag-right-header',
      cellStyle: { display:'flex', alignItems:'center', justifyContent:'flex-end' },
      editable: true,
      cellEditor: 'agNumberCellEditor',
      cellEditorParams: { min: 0 },
      cellRenderer: function(p) { return Number(p.value || 0).toLocaleString('ko-KR') + '원'; },
      onCellValueChanged: function(p) { recalcRow(p.node); }
    },
    { headerName: '공급가액', field: 'supply_price', width: 120,
      headerClass: 'ag-right-header',
      cellStyle: { display:'flex', alignItems:'center', justifyContent:'flex-end', background:'#f8fafc' },
      cellRenderer: function(p) { return '<strong>' + Number(p.value || 0).toLocaleString('ko-KR') + '원</strong>'; }
    },
    { headerName: '메모', field: 'memo', flex: 1,
      headerClass: 'ag-left-header',
      cellStyle: { display:'flex', alignItems:'center', justifyContent:'flex-start' },
      editable: true,
      cellRenderer: function(p) { return ts(p.value || ''); }
    },
    { headerName: '', width: 44, sortable: false,
      cellStyle: { display:'flex', alignItems:'center', justifyContent:'center', padding:'0' },
      cellRenderer: function(p) {
        var btn = document.createElement('button');
        btn.className = 'tbl-btn tbl-btn--danger';
        btn.style.cssText = 'width:28px;height:22px;padding:0;display:flex;align-items:center;justify-content:center;';
        btn.innerHTML = '✕';
        btn.onclick = function() { removePoItemRow(p.node.data._rowId); };
        return btn;
      }
    },
  ];

  var gridH    = el.parentElement.clientHeight || 260;
  var baseH    = 34;
  var pageSize = Math.max(5, Math.floor((gridH - baseH) / 34));
  var rowH     = Math.floor((gridH - baseH) / pageSize);
  rowH = Math.max(28, rowH);

  _poItemGrid = agGrid.createGrid(el, {
    columnDefs: colDefs,
    defaultColDef: {
      sortable: false, resizable: true, suppressMovable: true,
      headerClass: 'ag-center-header',
      cellStyle: { display:'flex', alignItems:'center', justifyContent:'center' },
    },
    rowData: [],
    rowHeight: rowH,
    headerHeight: baseH,
    suppressHorizontalScroll: true,
    suppressScrollOnNewData: true,
    stopEditingWhenCellsLoseFocus: true,
    singleClickEdit: true,
    overlayNoRowsTemplate: '<span style="color:#9ca3af;font-size:12px;">품목을 추가하세요. 자재명·수량·단가를 클릭해 직접 편집하세요.</span>',
    onGridReady: function(params) { params.api.sizeColumnsToFit(); },
    onCellValueChanged: function() { refreshPoTotal(); },
  });
}

function recalcRow(node) {
  var qty   = Number(node.data.order_qty  || 1);
  var price = Number(node.data.unit_price || 0);
  node.setDataValue('supply_price', qty * price);
  refreshPoTotal();
}

function refreshPoTotal() {
  var supplyTotal = 0;
  if (_poItemGrid) {
    _poItemGrid.forEachNode(function(node) {
      supplyTotal += Number(node.data.supply_price || 0);
    });
  }
  var vat   = calcVat(supplyTotal);
  var total = supplyTotal + vat;
  var s = document.getElementById('poTotalSupply');
  var v = document.getElementById('poTotalVat');
  var t = document.getElementById('poTotalAmount');
  if (s) s.textContent = fmtN(supplyTotal);
  if (v) v.textContent = fmtN(vat);
  if (t) t.textContent = fmtN(total);
}

var _rowIdCounter = 0;
function addPoItemRow(preset) {
  _rowIdCounter++;
  var row = Object.assign({
    _rowId:       _rowIdCounter,
    item_id:      '',
    purchase_unit:'',
    use_unit:     '',
    order_qty:    1,
    unit_price:   0,
    supply_price: 0,
    memo:         '',
    _existingId:  null,
  }, preset || {});
  if (_poItemGrid) {
    _poItemGrid.applyTransaction({ add: [row] });
    refreshPoTotal();
  }
}

function removePoItemRow(rowId) {
  if (!_poItemGrid) return;
  var toRemove = null;
  _poItemGrid.forEachNode(function(node) {
    if (node.data._rowId === rowId) toRemove = node.data;
  });
  if (toRemove) {
    _poItemGrid.applyTransaction({ remove: [toRemove] });
    refreshPoTotal();
  }
}

function clearPoItemGrid() {
  if (!_poItemGrid) return;
  var all = [];
  _poItemGrid.forEachNode(function(n) { all.push(n.data); });
  if (all.length) _poItemGrid.applyTransaction({ remove: all });
  refreshPoTotal();
}

/* ══════════════════════════════════════════
   3. 발주 상세 그리드 (읽기 전용)
══════════════════════════════════════════ */
function initPoDetailGrid() {
  var el = document.getElementById('poDetailGrid');
  if (!el || typeof agGrid === 'undefined') return;

  _poDetailGrid = agGrid.createGrid(el, {
    columnDefs: [
      { headerName: '자재명', field: 'item_name', flex: 2,
        headerClass: 'ag-left-header',
        cellStyle: { display:'flex', alignItems:'center', justifyContent:'flex-start' },
        cellRenderer: function(p) { return ts(p.value || '-'); }
      },
      { headerName: '입고단위', field: 'purchase_unit', width: 90,
        cellRenderer: function(p) { return ts(p.value || '-'); }
      },
      { headerName: '발주수량', field: 'order_qty', width: 90,
        headerClass: 'ag-right-header',
        cellStyle: { display:'flex', alignItems:'center', justifyContent:'flex-end' },
        cellRenderer: function(p) { return Number(p.value || 0).toLocaleString('ko-KR'); }
      },
      { headerName: '입고수량', field: 'received_qty', width: 90,
        headerClass: 'ag-right-header',
        cellStyle: { display:'flex', alignItems:'center', justifyContent:'flex-end' },
        cellRenderer: function(p) { return Number(p.value || 0).toLocaleString('ko-KR'); }
      },
      { headerName: '단가', field: 'unit_price', width: 110,
        headerClass: 'ag-right-header',
        cellStyle: { display:'flex', alignItems:'center', justifyContent:'flex-end' },
        cellRenderer: function(p) { return fmtN(p.value); }
      },
      { headerName: '공급가액', field: 'supply_price', width: 120,
        headerClass: 'ag-right-header',
        cellStyle: { display:'flex', alignItems:'center', justifyContent:'flex-end' },
        cellRenderer: function(p) { return '<strong>' + fmtN(p.value) + '</strong>'; }
      },
      { headerName: '메모', field: 'memo', flex: 1,
        headerClass: 'ag-left-header',
        cellStyle: { display:'flex', alignItems:'center', justifyContent:'flex-start' },
        cellRenderer: function(p) { return ts(p.value || '-'); }
      },
    ],
    defaultColDef: {
      sortable: false, resizable: true, suppressMovable: true,
      headerClass: 'ag-center-header',
      cellStyle: { display:'flex', alignItems:'center', justifyContent:'center' },
    },
    rowData: [],
    rowHeight: 34,
    headerHeight: 34,
    suppressHorizontalScroll: true,
    suppressScrollOnNewData: true,
    overlayNoRowsTemplate: '<span style="color:#9ca3af;font-size:12px;">품목이 없습니다.</span>',
    onGridReady: function(params) { params.api.sizeColumnsToFit(); },
  });
}

/* ══════════════════════════════════════════
   발주 등록/수정 모달 열기
══════════════════════════════════════════ */
function openAddPo() {
  editingPoId = null;
  setVal('po_order_no',      '');
  setVal('po_order_date',    new Date().toISOString().slice(0, 10));
  setVal('po_expected_date', '');
  setVal('po_vendor_id',     '');
  setVal('po_memo',          '');
  document.getElementById('poModalTitle').textContent = '발주 등록';
  openModal('poModal');
  // 모달 표시 후 그리드 초기화 (display:block 상태에서 height 확보)
  setTimeout(function() {
    if (!_poItemGrid) initPoItemGrid();
    clearPoItemGrid();
    if (_poItemGrid) _poItemGrid.sizeColumnsToFit();
  }, 50);
}

async function openEditPo(id) {
  showGlobalLoading('발주 정보를 불러오는 중...');
  try {
    var { data: po, error: e1 } = await supabaseClient.from('purchase_orders').select('*').eq('id', id).single();
    if (e1) throw new Error(e1.message);
    var { data: items, error: e2 } = await supabaseClient.from('purchase_order_items').select('*, items(item_name, purchase_unit, use_unit)').eq('order_id', id);
    if (e2) throw new Error(e2.message);

    editingPoId = id;
    setVal('po_order_no',      po.order_no);
    setVal('po_order_date',    po.order_date);
    setVal('po_expected_date', po.expected_date || '');
    setVal('po_vendor_id',     po.vendor_id);
    setVal('po_memo',          po.memo);

    document.getElementById('poModalTitle').textContent = '발주 수정';
    openModal('poModal');
    setTimeout(function() {
      if (!_poItemGrid) initPoItemGrid();
      clearPoItemGrid();
      (items || []).forEach(function(r) {
        addPoItemRow({
          _existingId:   r.id,
          item_id:       r.item_id,
          purchase_unit: r.purchase_unit || r.items?.purchase_unit || '',
          use_unit:      r.use_unit      || r.items?.use_unit      || '',
          order_qty:     r.order_qty,
          unit_price:    r.unit_price,
          supply_price:  r.supply_price || (r.order_qty * r.unit_price),
          memo:          r.memo,
        });
      });
      if (_poItemGrid) _poItemGrid.sizeColumnsToFit();
    }, 50);
  } catch(e) {
    alert('발주 로드 실패: ' + e.message);
  } finally {
    hideGlobalLoading();
  }
}
window.openEditPo = openEditPo;

/* 발주 저장 */
async function savePo() {
  var vendorId = val('po_vendor_id');
  if (!vendorId) throw new Error('거래처를 선택해주세요.');

  // 품목 그리드에서 데이터 수집
  var itemRows = [];
  var supplyTotal = 0;
  _poItemGrid?.forEachNode(function(node) {
    var d = node.data;
    if (!d.item_id) return;
    var supply = Number(d.order_qty || 1) * Number(d.unit_price || 0);
    supplyTotal += supply;
    itemRows.push({
      item_id:          d.item_id,
      purchase_unit:    d.purchase_unit || '',
      purchase_unit_qty:1,
      use_unit:         d.use_unit      || '',
      order_qty:        Number(d.order_qty  || 1),
      unit_price:       Number(d.unit_price || 0),
      memo:             d.memo || '',
    });
  });
  if (!itemRows.length) throw new Error('품목을 1개 이상 추가해주세요.');

  var poPayload = {
    vendor_id:     vendorId,
    order_date:    val('po_order_date') || new Date().toISOString().slice(0, 10),
    expected_date: val('po_expected_date') || null,
    supply_price:  supplyTotal,
    memo:          val('po_memo'),
    status:        'DRAFT',
    updated_at:    new Date().toISOString(),
  };

  var orderId = editingPoId;
  if (orderId) {
    var { error: ue } = await supabaseClient.from('purchase_orders').update(poPayload).eq('id', orderId);
    if (ue) throw new Error(ue.message);
    await supabaseClient.from('purchase_order_items').delete().eq('order_id', orderId);
  } else {
    var orderNo = await genDocNo('PO');
    poPayload.order_no = orderNo;
    var { data: newPo, error: ie } = await supabaseClient.from('purchase_orders').insert(poPayload).select().single();
    if (ie) throw new Error(ie.message);
    orderId = newPo.id;
  }

  var poItems = itemRows.map(function(r) { return Object.assign({ order_id: orderId }, r); });
  var { error: pie } = await supabaseClient.from('purchase_order_items').insert(poItems);
  if (pie) throw new Error(pie.message);
}

/* ══════════════════════════════════════════
   발주 상세 모달
══════════════════════════════════════════ */
async function openPoDetail(id) {
  showGlobalLoading('발주 상세를 불러오는 중...');
  try {
    var { data: po, error: e1 } = await supabaseClient
      .from('purchase_orders').select('*, vendors(vendor_name)').eq('id', id).single();
    if (e1) throw new Error(e1.message);

    var { data: poItems, error: e2 } = await supabaseClient
      .from('purchase_order_items').select('*, items(item_name, purchase_unit)')
      .eq('order_id', id).order('created_at');
    if (e2) throw new Error(e2.message);

    // 메타 정보
    var meta = document.getElementById('poDetailMeta');
    meta.innerHTML =
      mkMetaItem('발주번호',   '<code>' + ts(po.order_no) + '</code>') +
      mkMetaItem('상태',       badgeStatus(po.status)) +
      mkMetaItem('거래처',     ts(po.vendors?.vendor_name || '-')) +
      mkMetaItem('발주일',     fmtDate(po.order_date)) +
      mkMetaItem('납품예정일', fmtDate(po.expected_date)) +
      mkMetaItem('메모',       ts(po.memo || '-'));

    // 품목 그리드에 데이터
    var gridRows = (poItems || []).map(function(r) {
      return {
        item_name:    r.items?.item_name || '-',
        purchase_unit:r.purchase_unit || r.items?.purchase_unit || '-',
        order_qty:    r.order_qty,
        received_qty: r.received_qty || 0,
        unit_price:   r.unit_price,
        supply_price: r.supply_price || (r.order_qty * r.unit_price),
        memo:         r.memo || '',
      };
    });
    document.getElementById('poDetailTitle').textContent = '발주 상세 — ' + po.order_no;
    openModal('poDetailModal');
    setTimeout(function() {
      if (!_poDetailGrid) initPoDetailGrid();
      if (_poDetailGrid) {
        _poDetailGrid.setGridOption('rowData', gridRows);
        _poDetailGrid.sizeColumnsToFit();
      }
    }, 50);

    // 합계
    var supplyTotal = po.supply_price || 0;
    var vat   = calcVat(supplyTotal);
    var total = supplyTotal + vat;
    var totalEl = document.getElementById('poDetailTotal');
    if (totalEl) totalEl.innerHTML =
      '<span>공급가액 <strong>' + fmtN(supplyTotal) + '</strong></span>' +
      '<span>VAT <strong>' + fmtN(vat) + '</strong></span>' +
      '<span>합계 <strong>' + fmtN(total) + '</strong></span>';

    // 액션 버튼
    var foot = document.getElementById('poDetailFoot');
    foot.innerHTML = '<button class="btn btn-sm" onclick="closeModal(\'poDetailModal\')">닫기</button>';
    if (po.status === 'DRAFT') {
      var ob = document.createElement('button');
      ob.className = 'btn btn-sm btn-primary'; ob.textContent = '발주 확정 (ORDERED)';
      ob.onclick = function() { changePoStatus(id, 'ORDERED'); };
      foot.insertBefore(ob, foot.firstChild);
    }
    if (po.status === 'DRAFT' || po.status === 'ORDERED') {
      var cb = document.createElement('button');
      cb.className = 'btn btn-sm btn-danger'; cb.textContent = '발주 취소';
      cb.onclick = function() { changePoStatus(id, 'CANCELLED'); };
      foot.insertBefore(cb, foot.firstChild);
    }

    // (모달 열기 및 그리드 초기화는 위 setTimeout에서 처리)
  } catch(e) {
    alert('발주 상세 로드 실패: ' + e.message);
  } finally {
    hideGlobalLoading();
  }
}
window.openPoDetail = openPoDetail;

function mkMetaItem(label, value) {
  return '<div class="po-detail-meta-item">' +
    '<span class="po-detail-meta-label">' + label + '</span>' +
    '<span class="po-detail-meta-value">' + value + '</span>' +
    '</div>';
}

async function changePoStatus(id, status) {
  if (!confirm(STATUS_LABEL[status] + ' 처리하시겠습니까?')) return;
  var { error } = await supabaseClient.from('purchase_orders')
    .update({ status: status, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) { alert('상태 변경 실패: ' + error.message); return; }
  closeModal('poDetailModal');
  await loadPoList(poState.page);
}

/* ── 채번 ── */
async function genDocNo(prefix) {
  var year = new Date().getFullYear();
  var { data, error } = await supabaseClient.rpc('next_doc_seq', { p_prefix: prefix, p_year: year });
  if (error || data == null) return prefix + '-' + year + '-' + Date.now().toString().slice(-6);
  return prefix + '-' + year + '-' + String(data).padStart(4, '0');
}

/* ── 캐시 로드 ── */
async function loadCaches() {
  var results = await Promise.all([
    supabaseClient.from('vendors').select('id, vendor_name').eq('active', 'Y').order('vendor_name'),
    supabaseClient.from('items').select('id, item_name, purchase_unit, use_unit, purchase_unit_qty, standard_price').eq('active', 'Y').order('item_name'),
  ]);
  vendorCache = results[0].data || [];
  itemCache   = results[1].data || [];

  var vSel = document.getElementById('po_vendor_id');
  if (vSel) {
    vSel.innerHTML = '<option value="">거래처 선택</option>' +
      vendorCache.map(function(v) { return '<option value="' + v.id + '">' + ts(v.vendor_name) + '</option>'; }).join('');
  }
}

/* ── 초기화 ── */
async function init() {
  await auth.requireAuth();

  initStatusTabs();
  initPoListGrid();
  // poItemGrid, poDetailGrid는 모달 열 때 lazy 초기화 (display:none 상태에서 height=0 방지)

  document.getElementById('addPoBtn')?.addEventListener('click', openAddPo);
  document.getElementById('addItemRowBtn')?.addEventListener('click', function() { addPoItemRow(null); });

  document.getElementById('poSaveBtn')?.addEventListener('click', async function() {
    var btn = this; btn.disabled = true;
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
