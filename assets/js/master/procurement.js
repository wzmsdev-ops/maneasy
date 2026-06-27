/**
 * assets/js/master/procurement.js
 * 발주 관리 (자재담당자) — admin/manager role만 접근
 *
 *   [발주요청확인] 탭 — 사용자가 제출한 purchase_requests 를 확인하고
 *                       품목별 거래처를 지정해 거래처별 purchase_orders(DRAFT)로 분리한다.
 *   [발주목록] 탭     — 기존 발주서 목록/등록/수정/발주확정/취소 (그대로 유지)
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
var rvState = {
  page: 1, pageSize: 20, totalPages: 1, loading: false,
  statusFilter: '',  // 기본값: 전체 (REQUESTED로 고정하면 PROCESSING 상태 요청이 안보임)
};

var _poListGrid   = null;   // 발주 목록 그리드
var _poItemGrid   = null;   // 발주 등록/수정 모달 품목 그리드
var _poDetailGrid = null;   // 발주 상세 모달 품목 그리드
var _rvListGrid   = null;   // 발주요청 목록 그리드
var _rvSplitGrid  = null;   // 발주요청 상세 — 거래처 분리 그리드

var vendorCache = [];   // 거래처 [{id, vendor_name}]
var itemCache   = [];   // 자재   [{id, item_name, purchase_unit, purchase_unit_qty, use_unit, standard_price, vendor_id}]

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

// VAT 입력칸을 사용자가 직접 수정했는지 추적 — 수정했으면 품목이 바뀌어도 자동계산으로 덮어쓰지 않음
var _poVatTouched = false;

var STATUS_LABEL = { DRAFT:'초안', ORDERED:'발주완료', PARTIAL:'부분입고', COMPLETED:'완료', CANCELLED:'취소' };
var STATUS_BADGE = { DRAFT:'badge-draft', ORDERED:'badge-ordered', PARTIAL:'badge-partial', COMPLETED:'badge-completed', CANCELLED:'badge-cancelled' };
function badgeStatus(s) {
  return '<span class="' + (STATUS_BADGE[s] || 'badge-draft') + '">' + (STATUS_LABEL[s] || ts(s)) + '</span>';
}

var RV_STATUS_LABEL = {
  REQUESTED:'요청', PROCESSING:'처리중', ORDERED:'발주확정',
  PARTIAL:'부분입고', COMPLETED:'입고완료', REJECTED:'반려', CANCELLED:'취소',
};
var RV_STATUS_BADGE = {
  REQUESTED:'badge-requested', PROCESSING:'badge-processing', ORDERED:'badge-ordered',
  PARTIAL:'badge-partial', COMPLETED:'badge-completed', REJECTED:'badge-rejected', CANCELLED:'badge-cancelled',
};
function badgeRvStatus(s) {
  return '<span class="' + (RV_STATUS_BADGE[s] || 'badge-requested') + '">' + (RV_STATUS_LABEL[s] || ts(s)) + '</span>';
}

/* ── 모달 ── */
function openModal(id)  { document.getElementById(id)?.classList.add('is-open'); }
function closeModal(id) { document.getElementById(id)?.classList.remove('is-open'); }
window.closeModal = closeModal;

/* ── 메인 탭 (발주요청확인 / 발주목록) ── */
function initMainTabs() {
  document.querySelectorAll('.po-main-tabs .tab-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var target = btn.dataset.maintab;
      document.querySelectorAll('.po-main-tabs .tab-btn').forEach(function(b) { b.classList.remove('active'); });
      document.querySelectorAll('.po-main-panel').forEach(function(p) { p.classList.remove('active'); });
      btn.classList.add('active');
      document.getElementById('panel-' + target)?.classList.add('active');

      setTimeout(function() {
        if (target === 'review') {
          if (!_rvListGrid) initRvListGrid();
          loadRvList(1);
        }
        if (target === 'orders') {
          if (!_poListGrid) initPoListGrid();
          loadPoList(1);
        }
      }, 50);
    });
  });
}

/* ══════════════════════════════════════════
   A. 발주요청확인 — 목록
══════════════════════════════════════════ */
function initRvListGrid() {
  _rvListGrid = createMgGrid('rvGrid', [
    { headerName: '요청번호', field: 'request_no', width: 150,
      headerClass: 'ag-left-header',
      cellStyle: { display:'flex', alignItems:'center', justifyContent:'flex-start' },
      cellRenderer: function(p) { return '<code style="font-size:11px;">' + ts(p.value || '-') + '</code>'; }
    },
    { headerName: '요청일', field: 'request_date', width: 100,
      cellRenderer: function(p) { return fmtDate(p.value); }
    },
    { headerName: '요청자', field: 'requester_name', width: 100,
      cellRenderer: function(p) { return ts(p.value || '-'); }
    },
    { headerName: '부서', field: 'departments', flex: 1,
      headerClass: 'ag-left-header',
      cellStyle: { display:'flex', alignItems:'center', justifyContent:'flex-start' },
      cellRenderer: function(p) { return ts(p.value?.dept_name || '-'); }
    },
    { headerName: '품목수', field: '_itemCount', width: 80,
      cellStyle: { display:'flex', alignItems:'center', justifyContent:'flex-end' },
      cellRenderer: function(p) { return Number(p.value || 0).toLocaleString('ko-KR'); }
    },
    { headerName: '상태', field: 'status', width: 90,
      cellRenderer: function(p) {
        var s = document.createElement('span');
        s.innerHTML = badgeRvStatus(p.value);
        return s;
      }
    },
    { headerName: '', width: 90, sortable: false,
      cellRenderer: function(p) {
        var btn = document.createElement('button');
        btn.className = 'tbl-btn tbl-btn--primary'; btn.textContent = '확인';
        btn.onclick = function() { openRvDetail(p.data.id); };
        return btn;
      }
    },
  ], [], { noRowsText: '발주요청이 없습니다.' });
}

async function loadRvList(page) {
  if (rvState.loading) return;
  rvState.loading = true;
  page = page || rvState.page;
  showGlobalLoading('발주요청 목록을 불러오는 중...');
  try {
    var from = (page - 1) * rvState.pageSize;
    var to   = from + rvState.pageSize - 1;
    var dateFrom = val('rvDateFrom');
    var dateTo   = val('rvDateTo');
    var keyword  = val('rvKeyword');

    var q = supabaseClient
      .from('purchase_requests')
      .select('*, departments(dept_name)', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, to);
    if (rvState.statusFilter) q = q.eq('status', rvState.statusFilter);
    if (dateFrom) q = q.gte('request_date', dateFrom);
    if (dateTo)   q = q.lte('request_date', dateTo);

    if (keyword) {
      var orParts = ['requester_name.ilike.%' + keyword + '%'];
      var { data: deptMatches } = await supabaseClient
        .from('departments').select('id').ilike('dept_name', '%' + keyword + '%');
      (deptMatches || []).forEach(function(d) { orParts.push('dept_id.eq.' + d.id); });
      q = q.or(orParts.join(','));
    }

    var { data, error, count } = await q;
    if (error) throw new Error(error.message);

    rvState.page       = page;
    rvState.totalPages = Math.max(1, Math.ceil((count || 0) / rvState.pageSize));

    var label = document.getElementById('rvCountLabel');
    if (label) label.textContent = '총 ' + (count || 0) + '건';

    var rows = data || [];
    if (rows.length) {
      var ids = rows.map(function(r) { return r.id; });
      var { data: items } = await supabaseClient
        .from('purchase_request_items').select('request_id').in('request_id', ids);
      var countMap = {};
      (items || []).forEach(function(it) { countMap[it.request_id] = (countMap[it.request_id] || 0) + 1; });
      rows.forEach(function(r) { r._itemCount = countMap[r.id] || 0; });
    }

    updateMgGrid(_rvListGrid, rows);
    renderRvPagination();
    await refreshReviewBadge();
  } catch(e) {
    alert('발주요청 목록 로드 실패: ' + e.message);
  } finally {
    rvState.loading = false;
    hideGlobalLoading();
  }
}

function renderRvPagination() {
  var container = document.getElementById('rvPagination');
  if (!container) return;
  var page = rvState.page, totalPages = rvState.totalPages;
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
      if (p && p !== rvState.page) loadRvList(p);
    });
  });
}

function initRvStatusTabs() {
  document.querySelectorAll('.rv-status-tab').forEach(function(btn) {
    btn.addEventListener('click', function() {
      document.querySelectorAll('.rv-status-tab').forEach(function(b) { b.classList.remove('active'); });
      btn.classList.add('active');
      rvState.statusFilter = btn.dataset.status || '';
      loadRvList(1);
    });
  });
}

async function refreshReviewBadge() {
  var { count } = await supabaseClient
    .from('purchase_requests').select('id', { count: 'exact', head: true }).eq('status', 'REQUESTED');
  var badge = document.getElementById('reviewCountBadge');
  if (!badge) return;
  if (count > 0) { badge.textContent = count; badge.style.display = ''; }
  else { badge.style.display = 'none'; }
}

/* ══════════════════════════════════════════
   B. 발주요청 상세 — 업체별 분리 / 분리 결과 조회
══════════════════════════════════════════ */
function VendorSelectEditor() {}
VendorSelectEditor.prototype.init = function(params) {
  this.value = params.value;
  this.eInput = document.createElement('select');
  this.eInput.style.cssText = 'width:100%;height:100%;border:none;outline:2px solid #3b82f6;padding:0 6px;font-size:11px;background:#fff;box-sizing:border-box;';
  this.eInput.innerHTML = '<option value="">거래처 선택</option>' +
    vendorCache.map(function(v) { return '<option value="' + v.id + '">' + ts(v.vendor_name) + '</option>'; }).join('');
  this.eInput.value = params.value || '';
  var self = this;
  this.eInput.addEventListener('change', function() {
    self.value = self.eInput.value;
    params.stopEditing();
  });
};
VendorSelectEditor.prototype.getGui = function() { return this.eInput; };
VendorSelectEditor.prototype.afterGuiAttached = function() { this.eInput.focus(); };
VendorSelectEditor.prototype.getValue = function() { return this.value; };
VendorSelectEditor.prototype.isPopup = function() { return false; };

function initRvSplitGrid() {
  var el = document.getElementById('rvSplitGrid');
  if (!el || typeof agGrid === 'undefined') return;

  _rvSplitGrid = agGrid.createGrid(el, {
    columnDefs: [
      { headerName: '자재명', field: 'item_name', flex: 2,
        headerClass: 'ag-left-header',
        cellStyle: { display:'flex', alignItems:'center', justifyContent:'flex-start' },
        cellRenderer: function(p) { return ts(p.value || '-'); }
      },
      { headerName: '요청수량(사용단위)', field: 'request_qty', width: 130,
        headerClass: 'ag-right-header',
        cellStyle: { display:'flex', alignItems:'center', justifyContent:'flex-end' },
        cellRenderer: function(p) { return Number(p.value || 0).toLocaleString('ko-KR') + ' ' + (p.data.use_unit || ''); }
      },
      { headerName: '입고수량(환산)', field: '_orderQty', width: 110,
        headerClass: 'ag-right-header',
        cellStyle: { display:'flex', alignItems:'center', justifyContent:'flex-end', background:'#f8fafc' },
        cellRenderer: function(p) { return Number(p.value || 0).toLocaleString('ko-KR') + ' ' + (p.data.purchase_unit || ''); }
      },
      { headerName: '단가', field: 'unit_price', width: 100,
        headerClass: 'ag-right-header',
        cellStyle: { display:'flex', alignItems:'center', justifyContent:'flex-end' },
        editable: true,
        cellEditor: 'agNumberCellEditor',
        cellEditorParams: { min: 0 },
        cellRenderer: function(p) { return Number(p.value || 0).toLocaleString('ko-KR') + '원'; }
      },
      { headerName: '거래처', field: 'vendor_id', flex: 1.4,
        editable: true,
        cellEditorFramework: VendorSelectEditor,
        cellEditorParams: {},
        cellRenderer: function(p) {
          if (!p.value) return '<span style="color:#ef4444;">거래처를 선택하세요</span>';
          var v = vendorCache.find(function(x) { return x.id === p.value; });
          return ts(v ? v.vendor_name : '-');
        }
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
    stopEditingWhenCellsLoseFocus: true,
    singleClickEdit: true,
    overlayNoRowsTemplate: '<span style="color:#9ca3af;font-size:12px;">품목이 없습니다.</span>',
    onGridReady: function(params) { params.api.sizeColumnsToFit(); },
  });
}

var rvCurrentRequest = null;   // 현재 상세 모달에서 보고 있는 요청

async function openRvDetail(id) {
  showGlobalLoading('발주요청 상세를 불러오는 중...');
  try {
    var { data: pr, error: e1 } = await supabaseClient
      .from('purchase_requests').select('*, departments(dept_name), clinics(clinic_name)').eq('id', id).single();
    if (e1) throw new Error(e1.message);
    rvCurrentRequest = pr;

    var { data: prItems, error: e2 } = await supabaseClient
      .from('purchase_request_items')
      .select('*, items(item_name, purchase_unit, purchase_unit_qty, use_unit, standard_price, vendor_id), purchase_order_items(id, order_qty, received_qty, unit_price, purchase_orders(order_no, status, vendor_id, vendors(vendor_name)))')
      .eq('request_id', id).order('created_at');
    if (e2) throw new Error(e2.message);

    var meta = document.getElementById('rvDetailMeta');
    meta.innerHTML =
      mkMetaItem('요청번호', '<code>' + ts(pr.request_no) + '</code>') +
      mkMetaItem('상태',     badgeRvStatus(pr.status)) +
      mkMetaItem('요청일',   fmtDate(pr.request_date)) +
      mkMetaItem('요청자',   ts(pr.requester_name || '-')) +
      mkMetaItem('부서',     ts(pr.departments?.dept_name || '-')) +
      mkMetaItem('메모',     ts(pr.memo || '-'));

    document.getElementById('rvDetailTitle').textContent = '발주요청 상세 — ' + pr.request_no;

    var splitSection  = document.getElementById('rvSplitSection');
    var linkedSection = document.getElementById('rvLinkedSection');
    var foot = document.getElementById('rvDetailFoot');
    foot.innerHTML = '<button class="btn btn-sm" onclick="closeModal(\'rvDetailModal\')">닫기</button>';

    if (pr.status === 'REQUESTED') {
      // ── 거래처 분리 편집 화면: 그리드가 있으므로 고정 높이 ──
      var rvDialog = document.querySelector('#rvDetailModal .m-modal-dialog');
      if (rvDialog) {
        rvDialog.classList.remove('m-modal-dialog--detail');
        rvDialog.classList.add('m-modal-dialog--wide');
      }
      splitSection.style.display  = 'flex';
      linkedSection.style.display = 'none';

      var gridRows = (prItems || []).map(function(r) {
        var item = r.items || {};
        var puQty = item.purchase_unit_qty || 1;
        return {
          _reqItemId:    r.id,
          item_id:       r.item_id,
          item_name:     item.item_name || '-',
          request_qty:   r.request_qty,
          use_unit:      r.use_unit || item.use_unit || '',
          purchase_unit: item.purchase_unit || '',
          _orderQty:     r.request_qty || 1,  // purchase_unit 기준 저장이므로 환산 불필요
          unit_price:    item.standard_price || 0,
          vendor_id:     item.vendor_id || '',
        };
      });

      openModal('rvDetailModal');
      setTimeout(function() {
        if (!_rvSplitGrid) initRvSplitGrid();
        if (_rvSplitGrid) {
          _rvSplitGrid.setGridOption('rowData', gridRows);
          _rvSplitGrid.sizeColumnsToFit();
        }
      }, 50);

      var rejectBtn = document.createElement('button');
      rejectBtn.className = 'btn btn-sm btn-danger'; rejectBtn.textContent = '반려';
      rejectBtn.onclick = function() { rejectPr(id); };
      foot.insertBefore(rejectBtn, foot.firstChild);

      var splitBtn = document.createElement('button');
      splitBtn.className = 'btn btn-sm btn-primary'; splitBtn.textContent = '업체별 발주서 분리';
      splitBtn.onclick = function(ev) { splitPrIntoOrders(pr, ev); };
      foot.insertBefore(splitBtn, foot.firstChild);

    } else {
      // ── 분리/처리 결과 조회 화면 ──
      splitSection.style.display  = 'none';
      linkedSection.style.display = 'block';

      var byOrder = {};
      (prItems || []).forEach(function(r) {
        var poi = r.purchase_order_items;
        if (!poi || !poi.purchase_orders) return;
        var orderNo = poi.purchase_orders.order_no;
        if (!byOrder[orderNo]) {
          byOrder[orderNo] = {
            order_no: orderNo,
            status:   poi.purchase_orders.status,
            vendor:   poi.purchase_orders.vendors?.vendor_name || '-',
            items:    [],
          };
        }
        byOrder[orderNo].items.push({
          item_name:    r.items?.item_name || '-',
          order_qty:    poi.order_qty,
          received_qty: poi.received_qty || 0,
          purchase_unit:r.items?.purchase_unit || '',
        });
      });

      var list = document.getElementById('rvLinkedList');
      var orderKeys = Object.keys(byOrder);
      if (!orderKeys.length) {
        list.innerHTML = '<div style="color:#9ca3af;font-size:12px;padding:20px;text-align:center;">아직 분리된 발주서가 없습니다.</div>';
      } else {
        list.innerHTML = orderKeys.map(function(k) {
          var g = byOrder[k];
          var itemsHtml = g.items.map(function(it) {
            return ts(it.item_name) + ' (' + it.received_qty + '/' + it.order_qty + ' ' + ts(it.purchase_unit) + ')';
          }).join(', ');
          return '<div class="linked-po-card">' +
            '<span class="linked-po-vendor">' + ts(g.vendor) + '</span>' +
            '<code style="font-size:11px;">' + ts(g.order_no) + '</code>' +
            badgeStatus(g.status) +
            '<span style="flex:1;color:#6b7280;font-size:11px;">' + itemsHtml + '</span>' +
            '</div>';
        }).join('');
      }

      openModal('rvDetailModal');
    }
  } catch(e) {
    alert('발주요청 상세 로드 실패: ' + e.message);
  } finally {
    hideGlobalLoading();
  }
}
window.openRvDetail = openRvDetail;

function mkMetaItem(label, value) {
  return '<div class="po-detail-meta-item">' +
    '<span class="po-detail-meta-label">' + label + '</span>' +
    '<span class="po-detail-meta-value">' + value + '</span>' +
    '</div>';
}

async function rejectPr(id) {
  if (!confirm('이 발주요청을 반려하시겠습니까?')) return;
  var { error } = await supabaseClient.from('purchase_requests')
    .update({ status: 'REJECTED', updated_at: new Date().toISOString() }).eq('id', id);
  if (error) { alert('반려 실패: ' + error.message); return; }
  closeModal('rvDetailModal');
  await loadRvList(rvState.page);
}

/** 거래처별로 묶어 DRAFT 발주서 자동 생성 + purchase_request_items 연결 + 요청 상태 PROCESSING 전환 */
async function splitPrIntoOrders(pr, ev) {
  if (!_rvSplitGrid) return;

  var rows = [];
  _rvSplitGrid.forEachNode(function(node) { rows.push(node.data); });

  var missingVendor = rows.some(function(r) { return !r.vendor_id; });
  if (missingVendor) { alert('모든 품목에 거래처를 선택해주세요.'); return; }
  if (!rows.length) { alert('분리할 품목이 없습니다.'); return; }

  if (!confirm('거래처별로 발주서(초안)를 생성하시겠습니까?')) return;

  var btn = ev && ev.target;
  if (btn) btn.disabled = true;
  showGlobalLoading('발주서를 분리하는 중...');
  try {
    // 거래처별 그룹화
    var groups = {};
    rows.forEach(function(r) {
      if (!groups[r.vendor_id]) groups[r.vendor_id] = [];
      groups[r.vendor_id].push(r);
    });

    for (var vendorId in groups) {
      var groupRows = groups[vendorId];
      var orderNo = await genDocNo('PO');
      var supplyTotal = groupRows.reduce(function(sum, r) {
        return sum + (Number(r._orderQty || 1) * Number(r.unit_price || 0));
      }, 0);

      var { data: newPo, error: poErr } = await supabaseClient.from('purchase_orders').insert({
        order_no:      orderNo,
        vendor_id:     vendorId,
        clinic_id:     pr.clinic_id,
        order_date:    new Date().toISOString().slice(0, 10),
        supply_price:  supplyTotal,
        status:        'DRAFT',
        memo:          '발주요청 ' + pr.request_no + ' 에서 분리',
      }).select().single();
      if (poErr) throw new Error(poErr.message);

      for (var i = 0; i < groupRows.length; i++) {
        var r = groupRows[i];
        var { data: newPoItem, error: poiErr } = await supabaseClient.from('purchase_order_items').insert({
          order_id:          newPo.id,
          item_id:           r.item_id,
          purchase_unit:     r.purchase_unit || '',
          purchase_unit_qty: 1,
          use_unit:          r.use_unit || '',
          order_qty:         r._orderQty || 1,
          unit_price:        Number(r.unit_price || 0),
          memo:              r.memo || '',
        }).select().single();
        if (poiErr) throw new Error(poiErr.message);

        var { error: linkErr } = await supabaseClient.from('purchase_request_items')
          .update({ order_item_id: newPoItem.id }).eq('id', r._reqItemId);
        if (linkErr) throw new Error(linkErr.message);
      }

      // 품목 insert 후 실제 합산으로 supply_price 재계산 업데이트
      var actualTotal = groupRows.reduce(function(sum, r) {
        return sum + (Number(r._orderQty || 1) * Number(r.unit_price || 0));
      }, 0);
      await supabaseClient.from('purchase_orders')
        .update({ supply_price: actualTotal })
        .eq('id', newPo.id);
    }

    await supabaseClient.from('purchase_requests')
      .update({ status: 'PROCESSING', updated_at: new Date().toISOString() }).eq('id', pr.id);

    closeModal('rvDetailModal');
    await loadRvList(rvState.page);
    alert('업체별 발주서 분리가 완료됐습니다. [발주목록] 탭에서 발주를 확정해주세요.');
  } catch(e) {
    alert('발주서 분리 실패: ' + e.message);
  } finally {
    if (btn) btn.disabled = false;
    hideGlobalLoading();
  }
}

/** 연결된 발주요청들의 상태를 발주서/입고 진행상황에 맞춰 재계산 */
async function syncLinkedRequestStatuses(orderId) {
  try {
    var { data: poItems } = await supabaseClient
      .from('purchase_order_items').select('id, order_qty, received_qty').eq('order_id', orderId);

    var poItemIds = (poItems || []).map(function(i) { return i.id; });
    if (!poItemIds.length) return;

    var { data: reqItems } = await supabaseClient
      .from('purchase_request_items').select('request_id, order_item_id').in('order_item_id', poItemIds);
    var requestIds = Array.from(new Set((reqItems || []).map(function(r) { return r.request_id; })));

    for (var i = 0; i < requestIds.length; i++) {
      await syncRequestStatus(requestIds[i]);
    }
  } catch(e) {
    console.warn('[syncLinkedRequestStatuses]', e);
  }
}

async function syncRequestStatus(requestId) {
  var { data: items } = await supabaseClient
    .from('purchase_request_items')
    .select('order_item_id, purchase_order_items(order_qty, received_qty, purchase_orders(status))')
    .eq('request_id', requestId);

  if (!items || !items.length) return;
  var linked = items.filter(function(i) { return i.order_item_id; });
  if (!linked.length) return; // 아직 분리 전

  var statuses = linked.map(function(i) { return i.purchase_order_items?.purchase_orders?.status; });
  var activeStatuses = statuses.filter(function(s) { return s && s !== 'CANCELLED'; });
  var newStatus;
  if (!activeStatuses.length) {
    // 연결된 발주서가 전부 취소 → 발주요청을 REQUESTED로 되돌림
    newStatus = 'REQUESTED';
  } else if (activeStatuses.every(function(s) { return s === 'COMPLETED'; })) {
    newStatus = 'COMPLETED';
  } else if (activeStatuses.some(function(s) { return s === 'PARTIAL' || s === 'COMPLETED'; })) {
    newStatus = 'PARTIAL';
  } else if (activeStatuses.some(function(s) { return s === 'ORDERED'; })) {
    newStatus = 'ORDERED';
  } else {
    newStatus = 'PROCESSING';
  }

  await supabaseClient.from('purchase_requests')
    .update({ status: newStatus, updated_at: new Date().toISOString() }).eq('id', requestId);
}

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
    var dateFrom = val('poDateFrom');
    var dateTo   = val('poDateTo');
    var keyword  = val('poKeyword');

    var q = supabaseClient
      .from('purchase_orders')
      .select('*, vendors(vendor_name)', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, to);
    if (poState.statusFilter) q = q.eq('status', poState.statusFilter);
    if (dateFrom) q = q.gte('order_date', dateFrom);
    if (dateTo)   q = q.lte('order_date', dateTo);

    if (keyword) {
      var orParts = ['order_no.ilike.%' + keyword + '%'];
      var { data: vendorMatches } = await supabaseClient
        .from('vendors').select('id').ilike('vendor_name', '%' + keyword + '%');
      (vendorMatches || []).forEach(function(v) { orParts.push('vendor_id.eq.' + v.id); });
      q = q.or(orParts.join(','));
    }

    var { data, error, count } = await q;
    if (error) throw new Error(error.message);

    poState.page       = page;
    poState.totalPages = Math.max(1, Math.ceil((count || 0) / poState.pageSize));

    var label = document.getElementById('poCountLabel');
    if (label) label.textContent = '총 ' + (count || 0) + '건';

    updateMgGrid(_poListGrid, (data || []).map(function(r) {
      // 저장된(보정 포함) vat_amount를 우선 사용 — 없으면 계산값으로 대체
      r._vat   = (r.vat_amount != null && r.vat_amount !== 0) ? r.vat_amount : calcVat(r.supply_price);
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
// ItemSelectEditor 제거 — 2패널 검색으로 대체

/* ══════════════════════════════════════════
   발주 등록 모달 — 자재 검색 그리드
══════════════════════════════════════════ */
var _poSearchGrid = null;

function initPoSearchGrid() {
  var el = document.getElementById('poSearchGrid');
  if (!el || typeof agGrid === 'undefined') return;

  var colDefs = [
    { headerName: '카테고리', field: 'category', width: 90,
      cellStyle: { justifyContent:'center', fontSize:'10px', color:'#6b7280' }
    },
    { headerName: '자재명', field: 'item_name', flex: 2, minWidth: 120,
      headerClass: 'ag-left-header',
      cellStyle: { justifyContent:'flex-start', fontWeight:600 }
    },
    { headerName: '입고단위', field: 'purchase_unit', width: 75,
      cellStyle: { justifyContent:'center', color:'#6b7280' }
    },
    { headerName: '단가', field: 'standard_price', width: 90,
      cellStyle: { justifyContent:'flex-end' },
      valueFormatter: function(p) {
        return p.value ? Number(p.value).toLocaleString('ko-KR') + '원' : '-';
      }
    },
    { headerName: '', width: 56, sortable: false,
      cellStyle: { justifyContent:'center', padding:'0 4px' },
      cellRenderer: function(p) {
        var btn = document.createElement('button');
        btn.className = 'btn btn-sm btn-primary';
        btn.style.cssText = 'padding:2px 8px;font-size:11px;';
        var isAdded = isPoItemAdded(p.data.id);
        btn.textContent = isAdded ? '추가됨' : '추가';
        if (isAdded) { btn.style.background = '#059669'; btn.style.borderColor = '#059669'; }
        btn.onclick = function() {
          addPoItemFromSearch(p.data);
          btn.textContent = '추가됨';
          btn.style.background = '#059669';
          btn.style.borderColor = '#059669';
        };
        return btn;
      }
    },
  ];

  _poSearchGrid = agGrid.createGrid(el, {
    columnDefs: colDefs,
    rowData: [],
    rowHeight: 34,
    headerHeight: 34,
    suppressCellFocus: true,
    defaultColDef: {
      sortable: true, resizable: true, suppressMovable: true,
      cellStyle: { display:'flex', alignItems:'center', justifyContent:'center' },
    },
    suppressHorizontalScroll: true,
    overlayNoRowsTemplate: '<span style="color:#9ca3af;font-size:12px;">카테고리/자재명을 입력해 검색하세요.</span>',
    onGridReady: function(params) {
      setTimeout(function() { params.api.sizeColumnsToFit(); }, 0);
    },
  });
}

function searchPoItems() {
  var kw  = (document.getElementById('po_item_keyword')?.value || '').toLowerCase();
  var cat = document.getElementById('po_item_category')?.value || '';
  var filtered = itemCache.filter(function(i) {
    var matchCat = !cat || i.category === cat;
    var matchKw  = !kw  || i.item_name.toLowerCase().includes(kw) || (i.item_code || '').toLowerCase().includes(kw);
    return matchCat && matchKw;
  });
  if (_poSearchGrid) _poSearchGrid.setGridOption('rowData', filtered);
  var cnt = document.getElementById('poSearchCount');
  if (cnt) cnt.textContent = filtered.length ? filtered.length + '건' : '';
}

function isPoItemAdded(itemId) {
  if (!_poItemGrid) return false;
  var found = false;
  _poItemGrid.forEachNode(function(n) { if (n.data.item_id === itemId) found = true; });
  return found;
}

function addPoItemFromSearch(item) {
  if (isPoItemAdded(item.id)) return; // 중복 방지
  _rowIdCounter++;
  var row = {
    _rowId:        _rowIdCounter,
    item_id:       item.id,
    item_name:     item.item_name,
    purchase_unit: item.purchase_unit || '',
    use_unit:      item.use_unit || '',
    order_qty:     1,
    unit_price:    item.standard_price || 0,
    supply_price:  item.standard_price || 0,
    memo:          '',
    _existingId:   null,
  };
  if (_poItemGrid) {
    _poItemGrid.applyTransaction({ add: [row] });
    refreshPoTotal();
    updatePoItemCount();
  }
}

function updatePoItemCount() {
  var cnt = 0;
  if (_poItemGrid) _poItemGrid.forEachNode(function() { cnt++; });
  var el = document.getElementById('poItemCount');
  if (el) el.textContent = cnt ? cnt + '건' : '';
}

function initPoItemGrid() {
  var el = document.getElementById('poItemGrid');
  if (!el || typeof agGrid === 'undefined') return;

  var colDefs = [
    { headerName: '자재명', field: 'item_name', flex: 2,
      headerClass: 'ag-left-header',
      cellStyle: { display:'flex', alignItems:'center', justifyContent:'flex-start', fontWeight:600 },
      cellRenderer: function(p) {
        return ts(p.value || '-');
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
  var vatInput = document.getElementById('poTotalVat');
  // 사용자가 VAT를 직접 보정하지 않았으면 공급가액 합계 기준 자동계산값으로 채움
  if (vatInput && !_poVatTouched) vatInput.value = calcVat(supplyTotal);
  var vat   = Number(vatInput?.value || 0);
  var total = supplyTotal + vat;
  var s = document.getElementById('poTotalSupply');
  var t = document.getElementById('poTotalAmount');
  if (s) s.textContent = fmtN(supplyTotal);
  if (t) t.textContent = fmtN(total);
}

/** VAT 입력칸을 사용자가 직접 수정했을 때 — 이후 품목 변경으로 자동계산되어 덮어써지지 않도록 표시 */
function onPoVatInput() {
  _poVatTouched = true;
  refreshPoTotal();
}

var _rowIdCounter = 0;
function addPoItemRow(preset) {
  _rowIdCounter++;
  var row = Object.assign({
    _rowId:       _rowIdCounter,
    item_id:      '',
    item_name:    '',
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
    updatePoItemCount();
    if (_poSearchGrid) _poSearchGrid.refreshCells({ force: true });
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
  _poVatTouched = false;
  setVal('poTotalVat', '0');
  document.getElementById('poModalTitle').textContent = '발주 등록';
  openModal('poModal');
  // 모달 표시 후 그리드 초기화 (display:block 상태에서 height 확보)
  setTimeout(function() {
    if (!_poItemGrid) initPoItemGrid();
    if (!_poSearchGrid) initPoSearchGrid();
    clearPoItemGrid();
    updatePoItemCount();
    if (_poItemGrid) _poItemGrid.sizeColumnsToFit();
    if (_poSearchGrid) { _poSearchGrid.setGridOption('rowData', []); _poSearchGrid.sizeColumnsToFit(); }
    // 카테고리 옵션 채우기
    var catSel = document.getElementById('po_item_category');
    if (catSel && catSel.options.length <= 1) {
      var cats = [...new Set(itemCache.map(function(i){ return i.category || ''; }))].filter(Boolean).sort();
      catSel.innerHTML = '<option value="">전체 카테고리</option>' +
        cats.map(function(c){ return '<option value="' + c + '">' + c + '</option>'; }).join('');
    }
    document.getElementById('po_item_keyword') && (document.getElementById('po_item_keyword').value = '');
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
    // 기존에 저장된(혹은 보정된) VAT 값을 그대로 불러옴 — 품목을 다시 채울 때 자동계산으로 덮어쓰지 않게 표시
    setVal('poTotalVat', po.vat_amount ?? 0);
    _poVatTouched = true;

    document.getElementById('poModalTitle').textContent = '발주 수정';
    openModal('poModal');
    setTimeout(function() {
      if (!_poItemGrid) initPoItemGrid();
      if (!_poSearchGrid) initPoSearchGrid();
      clearPoItemGrid();
      updatePoItemCount();
      if (_poSearchGrid) { _poSearchGrid.setGridOption('rowData', []); _poSearchGrid.sizeColumnsToFit(); }
      // 카테고리 옵션 채우기
      var catSel = document.getElementById('po_item_category');
      if (catSel && catSel.options.length <= 1) {
        var cats = [...new Set(itemCache.map(function(i){ return i.category || ''; }))].filter(Boolean).sort();
        catSel.innerHTML = '<option value="">전체 카테고리</option>' +
          cats.map(function(c){ return '<option value="' + c + '">' + c + '</option>'; }).join('');
      }
      document.getElementById('po_item_keyword') && (document.getElementById('po_item_keyword').value = '');
      (items || []).forEach(function(r) {
        addPoItemRow({
          _existingId:   r.id,
          item_id:       r.item_id,
          item_name:     r.items?.item_name || '',
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

  var vatAmount = Number(val('poTotalVat') || 0);

  var poPayload = {
    vendor_id:     vendorId,
    order_date:    val('po_order_date') || new Date().toISOString().slice(0, 10),
    expected_date: val('po_expected_date') || null,
    supply_price:  supplyTotal,
    vat_amount:    vatAmount,
    memo:          val('po_memo'),
    status:        'DRAFT',
    updated_at:    new Date().toISOString(),
  };

  var orderId = editingPoId;
  if (orderId) {
    var { error: ue } = await supabaseClient.from('purchase_orders').update(poPayload).eq('id', orderId);
    if (ue) throw new Error(ue.message);
    // FK 참조 해제 후 삭제
    await supabaseClient.from('purchase_request_items').update({ order_item_id: null })
      .in('order_item_id', (await supabaseClient.from('purchase_order_items').select('id').eq('order_id', orderId)).data?.map(function(r){ return r.id; }) || []);
    var { error: de } = await supabaseClient.from('purchase_order_items').delete().eq('order_id', orderId);
    if (de) throw new Error('품목 삭제 실패: ' + de.message);
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

    // 합계 — items 합산으로 계산 (po.supply_price는 저장 시점 스냅샷이라 수정 후 맞지 않을 수 있음)
    var supplyTotal = gridRows.reduce(function(sum, r) {
      return sum + (r.order_qty * r.unit_price);
    }, 0);
    var vat   = (po.vat_amount != null && po.vat_amount !== 0) ? po.vat_amount : calcVat(supplyTotal);
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

async function changePoStatus(id, status) {
  if (!confirm(STATUS_LABEL[status] + ' 처리하시겠습니까?')) return;
  var { error } = await supabaseClient.from('purchase_orders')
    .update({ status: status, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) { alert('상태 변경 실패: ' + error.message); return; }
  await syncLinkedRequestStatuses(id);
  closeModal('poDetailModal');
  await loadPoList(poState.page);
  await refreshReviewBadge();
}

/* ── 채번 ── */
async function genDocNo(prefix) {
  var year = new Date().getFullYear();
  var { data, error } = await supabaseClient.rpc('next_doc_seq', { p_prefix: prefix, p_year: year });
  if (error || data == null) return prefix + '-' + year + '-' + Date.now().toString().slice(-6);
  return prefix + '-' + year + '-' + String(data).padStart(6, '0');
}

/* ── 캐시 로드 ── */
async function loadCaches() {
  var results = await Promise.all([
    supabaseClient.from('vendors').select('id, vendor_name').eq('active', 'Y').order('vendor_name'),
    supabaseClient.from('items').select('id, item_name, purchase_unit, use_unit, purchase_unit_qty, standard_price, vendor_id').eq('active', 'Y').order('item_name'),
  ]);
  vendorCache = results[0].data || [];
  itemCache   = results[1].data || [];

  var vSel = document.getElementById('po_vendor_id');
  if (vSel) {
    vSel.innerHTML = '<option value="">거래처 선택</option>' +
      vendorCache.map(function(v) { return '<option value="' + v.id + '">' + ts(v.vendor_name) + '</option>'; }).join('');
  }
}

/* ── 접근 권한 (자재담당자 = manager 또는 admin) ── */
async function guardAccess() {
  var session = await auth.requireAuth();
  if (!session) return null;
  var user = await auth.getSession();
  if (user.role !== 'admin' && user.role !== 'manager') {
    alert('자재담당자(또는 관리자)만 접근할 수 있습니다.');
    location.replace(CONFIG.SITE_BASE_URL + '/app.html');
    return null;
  }
  return user;
}

/* ── 초기화 ── */
async function init() {
  var user = await guardAccess();
  if (!user) return;

  // 검색 날짜 기본값 — 시작일: 일주일 전, 종료일: 오늘
  var _today = new Date();
  var _weekAgo = new Date(_today);
  _weekAgo.setDate(_today.getDate() - 7);
  var _todayStr   = _today.toISOString().slice(0, 10);
  var _weekAgoStr = _weekAgo.toISOString().slice(0, 10);
  setVal('rvDateFrom', _weekAgoStr);
  setVal('rvDateTo', _todayStr);
  setVal('poDateFrom', _weekAgoStr);
  setVal('poDateTo', _todayStr);

  initMainTabs();
  
  // 발주요청확인 검색
  document.getElementById('rvSearchBtn')?.addEventListener('click', function() { loadRvList(1); });
  document.getElementById('rvKeyword')?.addEventListener('keydown', function(e) { if (e.key === 'Enter') loadRvList(1); });
  // 발주목록 검색
  document.getElementById('poSearchBtn')?.addEventListener('click', function() { loadPoList(1); });
  document.getElementById('po_item_keyword')?.addEventListener('keydown', function(e) { if (e.key === 'Enter') searchPoItems(); });
  document.getElementById('poKeyword')?.addEventListener('keydown', function(e) { if (e.key === 'Enter') loadPoList(1); });
initRvStatusTabs();
  initRvListGrid();   // review 탭이 기본 활성 → 즉시 초기화
  initStatusTabs();
  // poListGrid, poItemGrid, poDetailGrid, rvSplitGrid는 탭/모달 전환 시 lazy 초기화

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
    await loadRvList(1);
  } catch(e) {
    alert('초기화 실패: ' + e.message);
  } finally {
    hideGlobalLoading();
  }
}

document.addEventListener('DOMContentLoaded', init);
