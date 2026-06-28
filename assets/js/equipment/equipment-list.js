var _gridInstance = null; // AG Grid 인스턴스

var equipmentListState = {
  user: null,
  page: 1,
  pageSize: 20,
  totalCount: 0,
  totalPages: 1,
  hasNext: false,
  hasPrev: false,
  loading: false,
  canEdit: false,
  isRecentMode: false,
  isAdmin: false,
  isAppAdmin: false,
  userClinicCode: '',
  userTeamCode: '',
  userScope: null,     // ★ equipment 앱 scope: 'all' | 'clinic' | 'team' | null (로드 전)
  _initialLoad: true   // ★ 최초 로딩 여부 — URL params 직접 사용
};

function el(selector) {
  return document.querySelector(selector);
}

function getListQueryParams() {
  var params = new URLSearchParams(location.search);

  return {
    keyword: params.get('keyword') || '',
    clinic_code: params.get('clinic_code') || '',
    team_code: params.get('team_code') || '',
    team_suffix: params.get('team_suffix') || '',
    status: params.get('status') || '',
    manufacturer: params.get('manufacturer') || '',
    page: Number(params.get('page') || 1) || 1,
    page_size: Number(params.get('page_size') || 20) || 20
  };
}

function setListQueryParams(next) {
  var url = new URL(location.href);
  var key;

  for (key in next) {
    if (!Object.prototype.hasOwnProperty.call(next, key)) continue;

    if (next[key] === '' || next[key] === null || next[key] === undefined) {
      url.searchParams.delete(key);
    } else {
      url.searchParams.set(key, String(next[key]));
    }
  }

  history.replaceState({}, '', url.toString());
}

function setValue(id, value) {
  var target = document.getElementById(id);
  if (!target) return;
  target.value = value == null ? '' : value;
}

function getValue(id) {
  var target = document.getElementById(id);
  return target ? String(target.value || '').trim() : '';
}

function formatNumberLocal(value) {
  var num = Number(value || 0);
  return Number.isFinite(num) ? num.toLocaleString('ko-KR') : '0';
}

function formatDisplayDate(value) {
  var raw = String(value || '').trim();
  var dateOnlyMatch;
  var parsed;
  var yyyy;
  var mm;
  var dd;

  if (!raw) return '-';

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return raw;
  }

  dateOnlyMatch = raw.match(/^(\d{4}-\d{2}-\d{2})[T\s]/);
  if (dateOnlyMatch) {
    return dateOnlyMatch[1];
  }

  parsed = new Date(raw);
  if (!isNaN(parsed.getTime())) {
    yyyy = parsed.getFullYear();
    mm = String(parsed.getMonth() + 1).padStart(2, '0');
    dd = String(parsed.getDate()).padStart(2, '0');
    return yyyy + '-' + mm + '-' + dd;
  }

  return raw;
}

function getCurrentFilters() {
  return {
    keyword: getValue('keyword'),
    clinic_code: getValue('clinic_code'),
    team_code: getValue('team_code'),
    team_suffix: getValue('team_suffix') || '',
    status: getValue('status'),
    manufacturer: getValue('manufacturer')
  };
}

var EQUIPMENT_LIST_CACHE_KEY = 'gc_imed_equipment_list_state';

function saveListState() {
  try {
    sessionStorage.setItem(EQUIPMENT_LIST_CACHE_KEY, JSON.stringify({
      filters: getCurrentFilters(),
      page:    equipmentListState.page,
      ts:      Date.now()
    }));
  } catch(e) {}
}

function loadListState() {
  try {
    var raw = sessionStorage.getItem(EQUIPMENT_LIST_CACHE_KEY);
    if (!raw) return null;
    var state = JSON.parse(raw);
    if (Date.now() - state.ts > 30 * 60 * 1000) {
      sessionStorage.removeItem(EQUIPMENT_LIST_CACHE_KEY);
      return null;
    }
    return state;
  } catch(e) { return null; }
}

function clearListState() {
  try { sessionStorage.removeItem(EQUIPMENT_LIST_CACHE_KEY); } catch(e) {}
}

function hasMeaningfulFilter(filters) {
  return Boolean(
    filters.keyword ||
    filters.clinic_code ||
    filters.team_code ||
    filters.team_suffix ||
    filters.status ||
    filters.manufacturer
  );
}

function fillStatusFilterOptions() {
  var target = document.getElementById('status');
  if (!target) return;

  target.innerHTML =
    '<option value="">전체 상태</option>' +
    '<option value="IN_USE">사용중</option>' +
    '<option value="REPAIRING">수리중</option>' +
    '<option value="INSPECTING">점검중</option>' +
    '<option value="STORED">보관</option>' +
    '<option value="DISPOSED">폐기</option>';
}

function fillPageSizeOptions() {
  var target = document.getElementById('page_size');
  if (!target || target.type === 'hidden') return; // hidden이면 무시
  if (!target) return;

  target.innerHTML =
    '<option value="10">10개</option>' +
    '<option value="20">20개</option>' +
    '<option value="50">50개</option>' +
    '<option value="100">100개</option>';

  target.value = String(equipmentListState.pageSize);
}

function renderListSummary() {
  var summaryEl = document.getElementById('listSummary');
  var total;
  var page;
  var totalPages;
  var size;

  if (!summaryEl) return;

  if (equipmentListState.isRecentMode) {
    page = formatNumberLocal(equipmentListState.page || 1);
    size = formatNumberLocal(equipmentListState.pageSize || 20);
    summaryEl.textContent = '최근 등록 장비 보기 · ' + size + '건 단위 · ' + page + '페이지';
    return;
  }

  total = formatNumberLocal(equipmentListState.totalCount || 0);
  page = formatNumberLocal(equipmentListState.page || 1);
  totalPages = formatNumberLocal(equipmentListState.totalPages || 1);

  summaryEl.textContent = '검색 결과 ' + total + '건 · ' + page + ' / ' + totalPages + ' 페이지';
}

/* ── 카드 (모바일용) ── */
function buildEquipmentCard(item) {
  var leftActions = '';
  var rightActions = '';

  leftActions += '<a class="btn" href="detail.html?id=' + encodeURIComponent(item.equipment_id || '') + '">상세</a>';

    leftActions += '<button class="btn btn-primary" onclick="openEditForm(\'' + escapeHtml(item.equipment_id || '') + '\')">수정</button>';

  rightActions = window.innerWidth > 768
    ? '<button class="btn" onclick="openListLabelModal(\'' + escapeHtml(item.equipment_id || '') + '\')">라벨출력</button>'
    : '';

  return (
    '<article class="equipment-card">' +
      '<div class="equipment-card-head">' +
        '<div class="equipment-card-title-wrap">' +
          '<h3 class="equipment-card-title">' + escapeHtml(item.equipment_name || '-') + '</h3>' +
          '<div class="equipment-card-sub">' + escapeHtml(item.equipment_id || '') + '</div>' +
        '</div>' +
        '<span class="status-badge ' + statusClass(item.status || '') + '">' +
          escapeHtml(statusLabel(item.status || '')) +
        '</span>' +
      '</div>' +
      '<div class="equipment-card-grid">' +
        '<div class="equipment-card-row">' +
          '<span class="equipment-card-label">모델명</span>' +
          '<span class="equipment-card-value">' + escapeHtml(item.model_name || '-') + '</span>' +
        '</div>' +
        '<div class="equipment-card-row">' +
          '<span class="equipment-card-label">부서</span>' +
          '<span class="equipment-card-value">' + escapeHtml((item.clinic_name || '') + (item.clinic_name && item.team_name ? ' / ' : '') + (item.team_name || '') || '-') + '</span>' +
        '</div>' +
        '<div class="equipment-card-row">' +
          '<span class="equipment-card-label">제조사</span>' +
          '<span class="equipment-card-value">' + escapeHtml(item.manufacturer || '-') + '</span>' +
        '</div>' +
        '<div class="equipment-card-row">' +
          '<span class="equipment-card-label">시리얼</span>' +
          '<span class="equipment-card-value">' + escapeHtml(item.serial_no || '-') + '</span>' +
        '</div>' +
        '<div class="equipment-card-row">' +
          '<span class="equipment-card-label">위치</span>' +
          '<span class="equipment-card-value">' + escapeHtml(item.location || '-') + '</span>' +
        '</div>' +
        '<div class="equipment-card-row">' +
          '<span class="equipment-card-label">유지보수 종료</span>' +
          '<span class="equipment-card-value">' + escapeHtml(formatDisplayDate(item.maintenance_end_date || '')) + '</span>' +
        '</div>' +
      '</div>' +
      '<div class="equipment-card-actions">' +
        leftActions +
        rightActions +
      '</div>' +
    '</article>'
  );
}

/* ── 테이블 행 (PC용) ── */
function buildEquipmentRow(item) {
  var actions = '';

  actions += '<a class="tbl-btn" href="detail.html?id=' + encodeURIComponent(item.equipment_id || '') + '">상세</a>';

    actions += '<button class="tbl-btn tbl-btn--primary" onclick="openEditForm(\'' + escapeHtml(item.equipment_id || '') + '\')">수정</button>';

  if (window.innerWidth > 768) {
    actions += '<button class="tbl-btn" onclick="openListLabelModal(\'' + escapeHtml(item.equipment_id || '') + '\')">라벨</button>';
  }

  return (
    '<tr class="equipment-tbl-row">' +
      '<td class="equipment-tbl-cell equipment-tbl-cell--name">' + escapeHtml(item.equipment_name || '-') + '</td>' +
      '<td class="equipment-tbl-cell equipment-tbl-cell--id">' + escapeHtml(item.equipment_id || '-') + '</td>' +
      '<td class="equipment-tbl-cell">' + escapeHtml(item.model_name || '-') + '</td>' +
      '<td class="equipment-tbl-cell">' + escapeHtml(item.clinic_name || '-') + '</td>' +
      '<td class="equipment-tbl-cell">' + escapeHtml(item.team_name   || '-') + '</td>' +
      '<td class="equipment-tbl-cell">' + escapeHtml(item.manufacturer || '-') + '</td>' +
      '<td class="equipment-tbl-cell equipment-tbl-cell--serial">' + escapeHtml(item.serial_no || '-') + '</td>' +
      '<td class="equipment-tbl-cell">' + escapeHtml(item.location || '-') + '</td>' +
      '<td class="equipment-tbl-cell equipment-tbl-cell--status">' +
        '<span class="status-badge ' + statusClass(item.status || '') + '">' +
          escapeHtml(statusLabel(item.status || '')) +
        '</span>' +
      '</td>' +
      '<td class="equipment-tbl-cell equipment-tbl-cell--actions">' +
        '<div class="equipment-tbl-actions">' + actions + '</div>' +
      '</td>' +
    '</tr>'
  );
}



function getStatusBadge(status) {
  var map = {
    'IN_USE':     { cls: 'is-in-use',     label: '사용중' },
    'REPAIRING':  { cls: 'is-repairing',  label: '수리중' },
    'INSPECTING': { cls: 'is-inspecting', label: '점검중' },
    'STORED':     { cls: 'is-stored',     label: '보관' },
    'DISPOSED':   { cls: 'is-disposed',   label: '폐기' },
  };
  var s = map[status] || { cls: 'is-stored', label: status || '—' };
  return '<span class="status-badge ' + s.cls + '">' + s.label + '</span>';
}

function getActionButtons(item) {
  var displayId = escapeHtml(item.equipment_id || '');  // ME-2026-0001
  var uuid      = escapeHtml(item._uuid || item.id || '');  // UUID (상세/수정 이동용)
  var btns = '<button class="tbl-btn" onclick="saveListState();parent.shellNavigate(\'equipment/detail?id=' + uuid + '\')">상세</button>';
  btns += '<button class="tbl-btn tbl-btn--primary" onclick="saveListState();openEditForm(\'' + uuid + '\')">수정</button>';
  btns += '<button class="tbl-btn" onclick="openListLabelModal(\'' + displayId + '\')">라벨</button>';
  return btns;
}

function renderEquipmentList(items) {
  var el = document.getElementById('equipmentGrid');
  if (!el) return;
  items = Array.isArray(items) ? items : [];

  // 컬럼 정의
  var columnDefs = [
    { headerName: '장비명', field: 'equipment_name', flex: 1, minWidth: 120,
      headerClass: 'ag-left-header',
      cellStyle: { display: 'flex', alignItems: 'center', justifyContent: 'flex-start' },
      cellRenderer: function(p) {
        return '<span class="tab-name">' + escapeHtml(p.value || '—') + '</span>';
      }
    },
    { headerName: '장비번호', field: 'equipment_id', width: 140,
      cellRenderer: function(p) {
        return '<span class="tab-id">' + escapeHtml(p.value || '—') + '</span>';
      }
    },
    { headerName: '모델명', field: 'model_name', width: 130 },
    { headerName: '의원', field: 'clinic_name', width: 100,
      cellRenderer: function(p) { return escapeHtml(p.value || '—'); }
    },
    { headerName: '부서', field: 'team_name', width: 90,
      cellRenderer: function(p) { return escapeHtml(p.value || '—'); }
    },
    { headerName: '제조사', field: 'manufacturer', width: 120,
      cellRenderer: function(p) {
        var v = p.value || '';
        return v ? '<span class="tab-mfr">' + escapeHtml(v) + '</span>' : '<span style="color:#9ca3af">—</span>';
      }
    },
    { headerName: '시리얼', field: 'serial_no', width: 140,
      cellRenderer: function(p) {
        return '<span class="tab-id">' + escapeHtml(p.value || '—') + '</span>';
      }
    },
    { headerName: '납품처', field: 'vendor', width: 110,
      cellRenderer: function(p) {
        return p.value ? escapeHtml(p.value) : '<span style="color:#9ca3af">—</span>';
      }
    },
    { headerName: '구매일', field: 'purchase_date', width: 100,
      cellRenderer: function(p) {
        return p.value ? escapeHtml(p.value) : '<span style="color:#9ca3af">—</span>';
      }
    },
    { headerName: '유지보수만료', field: 'maintenance_end_date', width: 110,
      cellRenderer: function(p) {
        var v = p.value || '';
        if (!v) return '<span style="color:#9ca3af">—</span>';
        var days = Math.ceil((new Date(v) - new Date()) / 86400000);
        var color = days <= 30 ? '#b91c1c' : days <= 60 ? '#c2410c' : '#374151';
        return '<span style="color:' + color + '">' + escapeHtml(v) + '</span>';
      }
    },
    { headerName: '위치', field: 'location', width: 90 },
    { headerName: '상태', field: 'status', width: 80,
      cellRenderer: function(p) { return getStatusBadge(p.value); }
    },
    { headerName: '액션', field: 'equipment_id', width: 140, sortable: false,
      cellRenderer: function(p) {
        return '<div style="display:flex;gap:4px;align-items:center;">' + getActionButtons(p.data) + '</div>';
      }
    }
  ];

  // 기본 컬럼 설정
  var defaultColDef = {
    sortable: true,
    resizable: true,
    suppressMovable: true,
    headerClass: 'ag-center-header',
    cellStyle: { display: 'flex', alignItems: 'center', justifyContent: 'center' },
  };

  // rowHeight 계산 — 먼저 계산 후 기존 인스턴스와 비교
  // Math.floor로 행 높이를 보수적으로 계산하고,
  // 남는 픽셀(remainder)은 headerHeight에 흡수시켜 하단 여백/잘림 방지
  var gridH   = el.clientHeight || 761;
  var baseH   = 34;
  var dataH   = gridH - baseH;
  var rowH    = Math.floor(dataH / equipmentListState.pageSize);
  rowH = Math.max(26, rowH);
  var remainder = dataH - (rowH * equipmentListState.pageSize);
  var headerH = baseH + remainder;  // 남는 픽셀을 헤더에 흡수

  if (_gridInstance) {
    if (_gridInstance._rowH === rowH) {
      _gridInstance.setGridOption('rowData', items);
      return;
    }
    _gridInstance.destroy();
    _gridInstance = null;
  }

  // 1차 추정 rowHeight로 그려진 화면이 2차 보정(onFirstDataRendered)으로 바뀌는 순간이
  // 사용자 눈에 "줄이 줄어드는 애니메이션"처럼 보이는 원인. 보정이 끝나기 전까지는
  // 그리드를 안 보이게 숨겨두고, 보정 직후 한 번에 보여줘서 그 깜빡임을 없앤다.
  el.style.visibility = 'hidden';

  var gridOptions = {
    columnDefs: columnDefs,
    defaultColDef: defaultColDef,
    rowData: items,
    rowHeight: rowH,
    headerHeight: headerH,
    suppressPaginationPanel: true,
    suppressScrollOnNewData: true,
    suppressHorizontalScroll: true,
    suppressCellFocus: true,
    overlayNoRowsTemplate: '<span style="color:#9ca3af;font-size:12px;">조회된 장비가 없습니다.</span>',
    onGridReady: function(params) {
      params.api.sizeColumnsToFit();
      window.addEventListener('resize', function() {
        if (_gridInstance) _gridInstance.sizeColumnsToFit();
      });
    },
    onFirstDataRendered: function(params) {
      var viewport = el.querySelector('.ag-body-viewport');
      if (!viewport) { el.style.visibility = ''; return; }
      var viewH = viewport.clientHeight;
      var correctRowH = Math.floor(viewH / equipmentListState.pageSize);
      correctRowH = Math.max(26, correctRowH);
      var rem = viewH - (correctRowH * equipmentListState.pageSize);
      if (correctRowH !== params.api.getGridOption('rowHeight')) {
        params.api.setGridOption('rowHeight', correctRowH);
        params.api.setGridOption('headerHeight', baseH + rem);
        params.api.resetRowHeights();
        _gridInstance._rowH = correctRowH;
      }
      // 보정이 다음 프레임에 실제로 그려진 뒤 보여줘서, 보정 전 모습이 단 한 프레임도 노출되지 않게 함
      requestAnimationFrame(function() {
        requestAnimationFrame(function() { el.style.visibility = ''; });
      });
    }
  };

  _gridInstance = agGrid.createGrid(el, gridOptions);
  setTimeout(function() { el.style.visibility = ''; }, 600); // 안전장치: 위 보정이 어떤 이유로든 안 불려도 결국 보이게 함
  _gridInstance._rowH = rowH;


}


function renderRecentPagination() {
  var container = document.getElementById('paginationArea');
  var page = equipmentListState.page;
  if (!container) return;

  container.innerHTML =
    '<button type="button" class="pagination-btn" data-page="' + Math.max(1, page - 1) + '" ' + (page <= 1 ? 'disabled' : '') + '>이전</button>' +
    '<button type="button" class="pagination-btn is-active" disabled>' + page + '</button>' +
    '<button type="button" class="pagination-btn" data-page="' + (page + 1) + '" ' + (equipmentListState.hasNext ? '' : 'disabled') + '>다음</button>';

  Array.prototype.forEach.call(container.querySelectorAll('.pagination-btn[data-page]'), function(btn) {
    btn.addEventListener('click', async function() {
      var nextPage = Number(btn.dataset.page || page);
      if (!nextPage || nextPage === equipmentListState.page) return;
      await loadEquipmentList(nextPage);
    });
  });
}

function renderFullPagination() {
  var container = document.getElementById('paginationArea');
  var page = equipmentListState.page;
  var totalPages = equipmentListState.totalPages;
  var pages = [];
  var start;
  var end;
  var i;

  if (!container) return;

  if (totalPages <= 1) {
    container.innerHTML = '';
    return;
  }

  // 10개 블록 방식
  var blockSize = 10;
  var blockStart = Math.floor((page - 1) / blockSize) * blockSize + 1;
  start = blockStart;
  end = Math.min(totalPages, blockStart + blockSize - 1);

  for (i = start; i <= end; i += 1) {
    pages.push(
      '<button type="button" class="pagination-btn ' + (i === page ? 'is-active' : '') + '" data-page="' + i + '">' +
        i +
      '</button>'
    );
  }

  container.innerHTML =
    '<button type="button" class="pagination-btn" data-page="' + Math.max(1, blockStart - 1) + '" ' + (blockStart <= 1 ? 'disabled' : '') + '>이전</button>' +
    pages.join('') +
    '<button type="button" class="pagination-btn" data-page="' + Math.min(totalPages, end + 1) + '" ' + (end >= totalPages ? 'disabled' : '') + '>다음</button>';

  Array.prototype.forEach.call(container.querySelectorAll('.pagination-btn'), function(btn) {
    btn.addEventListener('click', async function() {
      var nextPage = Number(btn.dataset.page || page);
      if (!nextPage || nextPage === equipmentListState.page) return;
      await loadEquipmentList(nextPage);
    });
  });
}

function renderPagination() {
  if (equipmentListState.isRecentMode) {
    renderRecentPagination();
    return;
  }
  renderFullPagination();
}

// ★ 개별 장비에 대해 수정 가능 여부 판단
// admin이면 모든 장비 수정 가능, user이면 본인 소속 팀 장비만 수정 가능
function canEditItem(item) {
  if (equipmentListState.isAdmin) return true;
  var itemTeamCode = String(item.team_code || '').trim();
  var userTeamCode = equipmentListState.userTeamCode;
  return !!userTeamCode && itemTeamCode === userTeamCode;
}

function applyListPermissionUi() {
  // 권한 체크 임시 비활성 — 모든 버튼 표시
  var createBtn = document.getElementById('createEquipmentBtn');
  if (createBtn) createBtn.style.display = '';

  var exportBtn = document.getElementById('exportExcelBtn');
  if (exportBtn) exportBtn.style.display = '';

  if (typeof applyTopActionsColClass === 'function') applyTopActionsColClass();
}

function buildListRequestParams(filters, nextPage) {
  var hasFilter = hasMeaningfulFilter(filters);

  // scope='all'이면 필터 없어도 전체 페이지네이션이 필요하므로 isRecentMode 강제 false
  var isAllScope = equipmentListState.userScope === 'all';
  equipmentListState.isRecentMode = !hasFilter && !isAllScope;

  var base = {
    request_user_email: equipmentListState.user && equipmentListState.user.email ? equipmentListState.user.email : '',
    keyword:      filters.keyword,
    clinic_code:  filters.clinic_code,
    team_code:    filters.team_code,
    team_suffix:  filters.team_suffix,
    status:       filters.status,
    manufacturer: filters.manufacturer,
    page:         nextPage,
    page_size:    equipmentListState.pageSize
  };

  if (!hasFilter && !isAllScope) {
    base.recent_only = 'Y';
    base.include_total = 'N';
    return base;
  }

  base.include_total = 'Y';
  return base;
}

function syncListQueryParams(filters) {
  setListQueryParams({
    keyword: filters.keyword,
    clinic_code: filters.clinic_code,
    team_code: filters.team_code,
    status: filters.status,
    manufacturer: filters.manufacturer,
    page: equipmentListState.page,
    page_size: equipmentListState.pageSize
  });
}

async function loadEquipmentList(nextPage) {
  var filters;
  var requestParams;
  var result;

  if (equipmentListState.loading) return;

  equipmentListState.loading = true;

  try {
    if (typeof clearMessage === 'function') clearMessage();
    if (typeof showGlobalLoading === 'function') {
      showGlobalLoading('장비 목록을 불러오는 중...');
    }

    if (equipmentListState._initialLoad) {
      var urlParams = getListQueryParams();
      // URL에 필터 없으면 scope에 따라 기본 필터 세팅
      // scope='all' → 필터 강제 없음 (전체 조회)
      // scope='clinic' → 소속 의원만 고정
      // scope='team' / null(로드 전) → 소속 의원+팀 고정 (보수적 처리)
      if (!urlParams.clinic_code && !urlParams.keyword && !urlParams.status) {
        var scope = equipmentListState.userScope;
        if (scope === 'all') {
          // 필터 강제 없음 — 전체 조회
        } else if (scope === 'clinic') {
          urlParams.clinic_code = equipmentListState.userClinicCode || '';
        } else {
          // 'team' 또는 아직 scope 미확정(null) → 보수적으로 의원+팀 고정
          urlParams.clinic_code = equipmentListState.userClinicCode || '';
          urlParams.team_code   = equipmentListState.userTeamCode   || '';
        }
      }
      filters = urlParams;
    } else {
      filters = getCurrentFilters();
    }
    equipmentListState._initialLoad = false;
    requestParams = buildListRequestParams(filters, nextPage || equipmentListState.page);

    equipmentListState.page = nextPage || equipmentListState.page;

    // Supabase SDK 직접 호출
    var sbQuery = supabaseClient
      .from('equipments')
      .select('*', { count: 'exact' })
      .eq('deleted_yn', 'N');

    if (requestParams.status)     sbQuery = sbQuery.eq('status', requestParams.status);
    if (requestParams.clinic_code) sbQuery = sbQuery.eq('clinic_code', requestParams.clinic_code);
    if (requestParams.team_code)   sbQuery = sbQuery.eq('team_code', requestParams.team_code);
    if (requestParams.team_suffix) sbQuery = sbQuery.eq('team_code', requestParams.team_suffix);
    if (requestParams.keyword) {
      var kw = requestParams.keyword;
      sbQuery = sbQuery.or(
        'equipment_name.ilike.%' + kw + '%,' +
        'model_name.ilike.%' + kw + '%,' +
        'serial_no.ilike.%' + kw + '%,' +
        'clinic_name.ilike.%' + kw + '%,' +
        'team_name.ilike.%' + kw + '%,' +
        'location.ilike.%' + kw + '%'
      );
    }

    var pageSize = requestParams.page_size || 20;
    var page     = equipmentListState.page || 1;
    var from     = (page - 1) * pageSize;
    var to       = from + pageSize - 1;

    sbQuery = sbQuery.order('created_at', { ascending: false }).range(from, to);

    var sbResult = await sbQuery;
    if (sbResult.error) throw new Error(sbResult.error.message);

    var totalCount = sbResult.count || 0;
    var totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

    var rows = (sbResult.data || []).map(function(r) {
      r.equipment_id = r.equipment_no || r.id;  // 표시용: ME-2026-0001
      r._uuid        = r.id;                    // 상세이동용: UUID
      r.qr_value     = r.equipment_no || r.id;
      return r;
    });

    equipmentListState.hasNext    = page < totalPages;
    equipmentListState.hasPrev    = page > 1;
    equipmentListState.totalCount = totalCount;
    equipmentListState.totalPages = totalPages;

    renderEquipmentList(rows);
    renderListSummary();
    renderPagination();
    syncListQueryParams(filters);
  } catch (error) {
    if (typeof showMessage === 'function') {
      showMessage(error.message || '장비 목록을 불러오는 중 오류가 발생했습니다.', 'error');
    } else {
      console.error(error);
    }
  } finally {
    equipmentListState.loading = false;
    if (typeof hideGlobalLoading === 'function') {
      hideGlobalLoading();
    }
  }
}


function bindListEvents() {
  var searchForm = document.getElementById('searchForm');
  var resetBtn = document.getElementById('resetFilterBtn');
  var pageSizeEl = document.getElementById('page_size');

  if (searchForm) {
    searchForm.addEventListener('submit', async function(event) {
      event.preventDefault();
      await loadEquipmentList(1);
    });
  }

  if (resetBtn) {
    resetBtn.addEventListener('click', async function() {
      setValue('keyword', '');
      // ★ admin이 아니면 의원 선택 초기화 안 함 (고정)
      if (equipmentListState.isAdmin) {
        setValue('clinic_code', '');
        setValue('team_code', '');
        if (window.orgSelect) {
          window.orgSelect.fillSelectOptions(
            document.getElementById('team_code'),
            [],
            { emptyText: '의원을 먼저 선택하세요' }
          );
          document.getElementById('team_code').disabled = true;
        }
      } else {
        // ★ user: 초기화 시 팀을 본인 소속 팀으로 복원 (의원은 disabled 유지, 팀은 변경 가능)
        setValue('team_code', equipmentListState.userTeamCode || '');
        if (window.orgSelect) {
          var teamElReset = document.getElementById('team_code');
          window.orgSelect.fillSelectOptions(
            teamElReset,
            window.orgSelect.getFilteredTeams(equipmentListState.userClinicCode),
            { emptyText: '전체 팀' }
          );
          teamElReset.value = equipmentListState.userTeamCode || '';
          teamElReset.disabled = false;
        }
      }
      setValue('status', '');
      setValue('manufacturer', '');

      equipmentListState.pageSize = Number(getValue('page_size') || equipmentListState.pageSize || 20) || 20;
      setValue('page_size', String(equipmentListState.pageSize));

      await loadEquipmentList(1);
    });
  }

  if (pageSizeEl) {
    pageSizeEl.addEventListener('change', async function() {
      equipmentListState.pageSize = Number(pageSizeEl.value || 20) || 20;
      await loadEquipmentList(1);
    });
  }
}

function statusLabelForExport(value) {
  var map = {
    IN_USE: '사용중',
    REPAIRING: '수리중',
    INSPECTING: '점검중',
    STORED: '보관',
    DISPOSED: '폐기'
  };
  return map[String(value || '').trim()] || (value || '');
}

async function exportEquipmentExcel() {
  var exportBtn = document.getElementById('exportExcelBtn');

  if (!window.XLSX) {
    showMessage('엑셀 라이브러리를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.', 'error');
    return;
  }

  var filters = getCurrentFilters();
  var userEmail = equipmentListState.user && equipmentListState.user.email
    ? equipmentListState.user.email : '';

  try {
    if (exportBtn) {
      exportBtn.disabled = true;
      exportBtn.textContent = '다운로드 중...';
    }
    showGlobalLoading('장비 데이터를 불러오는 중...');

    var sbExport = supabaseClient.from('equipments').select('*').eq('deleted_yn', 'N');
    if (filters.status)     sbExport = sbExport.eq('status', filters.status);
    if (filters.clinic_code) sbExport = sbExport.eq('clinic_code', filters.clinic_code);
    if (filters.team_code)   sbExport = sbExport.eq('team_code', filters.team_code);
    if (filters.team_suffix) sbExport = sbExport.eq('team_code', filters.team_suffix);
    if (filters.keyword) {
      var kw = filters.keyword;
      sbExport = sbExport.or('equipment_name.ilike.%' + kw + '%,model_name.ilike.%' + kw + '%,serial_no.ilike.%' + kw + '%');
    }
    sbExport = sbExport.order('created_at', { ascending: false });
    var exportResult = await sbExport;
    if (exportResult.error) throw new Error(exportResult.error.message);

    var data = (exportResult.data || []).map(function(r) {
      r.equipment_id = r.equipment_no || r.id;
      r._uuid        = r.id;
      r.qr_value     = r.equipment_no || r.id;
      return r;
    });

    if (!data.length) {
      showMessage('다운로드할 데이터가 없습니다.', 'error');
      return;
    }

    var headers = [
      '장비번호', '장비명', '모델명', '제조사', '시리얼번호',
      '의원', '부서', '현재위치', '현재상태',
      '담당자', '연락처', '구매처', '취득가액',
      '취득일자', '제조일자', '유지보수종료일', '현재사용자', '비고', '등록일시'
    ];

    // 컬럼 유형 (0-based index)
    var COL_NUM  = new Set([13]);         // 취득가액
    var COL_DATE = new Set([14, 15, 16]); // 취득일자, 제조일자, 유지보수종료일

    var toDateOnly = function(v) { return v ? String(v).substring(0, 10) : ''; };

    var rows = data.map(function(item) {
      return [
        item.equipment_id || '',
        item.equipment_name || '',
        item.model_name || '',
        item.manufacturer || '',
        item.serial_no || '',
        item.clinic_name || '',
        item.team_name || '',
        item.location || '',
        statusLabelForExport(item.status),
        item.manager_name || '',
        item.manager_phone || '',
        item.vendor || '',
        item.acquisition_cost !== '' && item.acquisition_cost !== null && item.acquisition_cost !== undefined
          ? Number(item.acquisition_cost) : '',
        toDateOnly(item.purchase_date),
        toDateOnly(item.manufacture_date),
        toDateOnly(item.maintenance_end_date),
        item.current_user || '',
        item.memo || '',
        item.created_at || ''
      ];
    });

    // ── 스타일 정의 ──────────────────────────────────────────────
    var FONT_BASE   = { name: '맑은 고딕', sz: 10 };
    var FONT_HEADER = { name: '맑은 고딕', sz: 10, bold: true, color: { rgb: '1F3864' } };
    var FILL_HEADER = { patternType: 'solid', fgColor: { rgb: 'B8CCE4' } };
    var BORDER = {
      top:    { style: 'thin', color: { rgb: 'BFBFBF' } },
      bottom: { style: 'thin', color: { rgb: 'BFBFBF' } },
      left:   { style: 'thin', color: { rgb: 'BFBFBF' } },
      right:  { style: 'thin', color: { rgb: 'BFBFBF' } }
    };
    var ALIGN_LEFT   = { horizontal: 'left',   vertical: 'center' };
    var ALIGN_CENTER = { horizontal: 'center', vertical: 'center' };
    var ALIGN_RIGHT  = { horizontal: 'right',  vertical: 'center' };
    var FMT_NUM  = '#,##0';
    var FMT_DATE = 'yyyy-mm-dd';

    // ── 워크시트 수동 생성 ───────────────────────────────────────
    var ws = {};
    var totalCols = headers.length;
    var totalRows = rows.length + 1;

    // 헤더 행
    headers.forEach(function(h, c) {
      var addr = window.XLSX.utils.encode_cell({ r: 0, c: c });
      ws[addr] = {
        v: h, t: 's',
        s: { font: FONT_HEADER, fill: FILL_HEADER, border: BORDER, alignment: ALIGN_CENTER }
      };
    });

    // 데이터 행
    rows.forEach(function(row, r) {
      row.forEach(function(val, c) {
        var addr   = window.XLSX.utils.encode_cell({ r: r + 1, c: c });
        var isNum  = COL_NUM.has(c);
        var isDate = COL_DATE.has(c);

        var cell = {
          v: val,
          t: isNum && val !== '' ? 'n' : 's',
          s: {
            font:      FONT_BASE,
            border:    BORDER,
            alignment: isNum ? ALIGN_RIGHT : isDate ? ALIGN_CENTER : ALIGN_LEFT
          }
        };

        if (isNum && val !== '') { cell.z = FMT_NUM;  cell.s.numFmt = FMT_NUM;  }
        if (isDate && val)       { cell.z = FMT_DATE; cell.s.numFmt = FMT_DATE; }

        ws[addr] = cell;
      });
    });

    ws['!ref']  = window.XLSX.utils.encode_range({ r: 0, c: 0 }, { r: totalRows - 1, c: totalCols - 1 });
    ws['!cols'] = [
      { wch: 14 }, { wch: 20 }, { wch: 16 }, { wch: 14 }, { wch: 16 },
      { wch: 20 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 8 },
      { wch: 10 }, { wch: 14 }, { wch: 14 }, { wch: 12 },
      { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 10 }, { wch: 20 }, { wch: 18 }
    ];
    ws['!rows'] = Array(totalRows).fill({ hpt: 18 });

    var wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, ws, '장비대장');

    var now = new Date();
    var dateStr = now.getFullYear() +
      String(now.getMonth() + 1).padStart(2, '0') +
      String(now.getDate()).padStart(2, '0');
    var fileName = '장비대장_' + dateStr + '.xlsx';

    window.XLSX.writeFile(wb, fileName);

  } catch (error) {
    showMessage(error.message || '엑셀 다운로드 중 오류가 발생했습니다.', 'error');
  } finally {
    if (exportBtn) {
      exportBtn.disabled = false;
      exportBtn.textContent = '엑셀 다운로드';
    }
    hideGlobalLoading(true);
  }
}

// 동기 초기화 — 상태/UI 기본 세팅 (API 호출 없음)
function initListFiltersSync() {
  var query = getListQueryParams();
  equipmentListState.page = query.page > 0 ? query.page : 1;
  equipmentListState.pageSize = 20;
  fillStatusFilterOptions();
  setValue('keyword', query.keyword || '');
  setValue('status', query.status || '');
  setValue('manufacturer', query.manufacturer || '');
  setValue('page_size', String(equipmentListState.pageSize));
}


// departments 테이블 기반 부서 필터 채우기
function populateDeptFilter(el, deptRows, clinicCode, query) {
  if (!el) return;
  var filtered = clinicCode
    ? (deptRows || []).filter(function(d) { return d.clinics && d.clinics.clinic_code === clinicCode; })
    : (deptRows || []);
  var opts = '<option value="">전체 부서</option>';
  filtered.forEach(function(d) {
    opts += '<option value="' + escapeHtml(d.dept_code) + '">' + escapeHtml(d.dept_name) + '</option>';
  });
  el.innerHTML = opts;
  el.disabled = false;
  if (query && query.team_suffix) el.value = query.team_suffix;
}

// 비동기 초기화 — clinics/departments 테이블에서 필터 UI 세팅
async function initListFiltersAsync() {
  var query     = getListQueryParams();
  var clinicEl  = document.getElementById('clinic_code');
  var teamSufEl = document.getElementById('team_suffix');
  var teamEl    = document.getElementById('team_code');

  // clinics 테이블에서 로드
  var { data: clinicRows } = await supabaseClient
    .from('clinics')
    .select('clinic_code, clinic_name')
    .eq('active', 'Y')
    .order('sort_order', { ascending: true });

  // departments 테이블에서 로드
  var { data: deptRows } = await supabaseClient
    .from('departments')
    .select('dept_code, dept_name, clinic_id, clinics(clinic_code)')
    .eq('active', 'Y')
    .order('sort_order', { ascending: true });

  var clinics = (clinicRows || []).map(function(r) {
    return { code_value: r.clinic_code, code_name: r.clinic_name };
  });

  equipmentListState.userScope = 'all';
  if (teamEl) teamEl.value = '';

  // ── 의원 select ──────────────────────────────────────────────
  if (clinicEl) {
    var clinicOpts = '<option value="">전체 의원</option>';
    clinics.forEach(function(c) {
      clinicOpts += '<option value="' + escapeHtml(c.code_value) + '">' + escapeHtml(c.code_name) + '</option>';
    });
    clinicEl.innerHTML = clinicOpts;
    clinicEl.disabled = false;
    clinicEl.value = query.clinic_code || '';
  }

  // 의원 변경 시 부서 필터 연동
  if (clinicEl && teamSufEl) {
    clinicEl.addEventListener('change', function() {
      populateDeptFilter(teamSufEl, deptRows, this.value, query);
    });
  }

  // ── 부서 select: departments 테이블 기준 ─────────────────────
  if (teamSufEl) {
    populateDeptFilter(teamSufEl, deptRows, query.clinic_code || '', query);
  }
}


document.addEventListener('DOMContentLoaded', async function() {
  try {
    if (typeof showGlobalLoading === 'function') {
      showGlobalLoading('장비 목록 화면을 준비하는 중...');
    }

    if (window.auth && typeof window.auth.requireAuth === 'function') {
      equipmentListState.user = window.auth.requireAuth();
    }

    if (!equipmentListState.user) {
      if (typeof hideGlobalLoading === 'function') hideGlobalLoading();
      return;
    }

    // ★ admin 여부 및 소속 의원/팀 코드 세팅
    var userRole = String(equipmentListState.user.role || '').trim().toLowerCase();
    equipmentListState.isAdmin = (userRole === 'admin');
    equipmentListState.userClinicCode = String(equipmentListState.user.clinic_code || '').trim();
    equipmentListState.userTeamCode   = String(equipmentListState.user.team_code   || '').trim();

    if (window.appPermission && typeof window.appPermission.requirePermission === 'function') {
      var canView = await window.appPermission.requirePermission('equipment', ['view', 'edit', 'admin']);
      if (!canView) {
        if (typeof hideGlobalLoading === 'function') hideGlobalLoading();
        return;
      }
    }

    if (window.appPermission && typeof window.appPermission.hasPermission === 'function') {
      equipmentListState.canEdit = await window.appPermission.hasPermission('equipment', ['edit', 'admin']);
    } else {
      // appPermission 없는 경우(데모) — admin이면 편집 허용
      equipmentListState.canEdit = equipmentListState.isAdmin;
    }

    if (window.appPermission && typeof window.appPermission.getPermission === 'function') {
      var appPerm = await window.appPermission.getPermission('equipment');
      equipmentListState.isAppAdmin = (String(appPerm || '').trim().toLowerCase() === 'admin');
    }

    applyListPermissionUi();
    initListFiltersSync();
    bindListEvents();

    var isReload = window.performance &&
      window.performance.getEntriesByType &&
      window.performance.getEntriesByType('navigation')[0] &&
      window.performance.getEntriesByType('navigation')[0].type === 'reload';
    if (isReload) clearListState();

    var cached = loadListState();
    // cached 복원은 initListFiltersAsync(scope 확정) 이후에 적용
    // scope 확정이 _initialLoad 필터링보다 먼저 일어나야 하므로
    // initListFiltersAsync 완료 후 loadEquipmentList 실행
    await initListFiltersAsync();

    if (cached && cached.filters) {
      var f = cached.filters;
      if (f.keyword)     setValue('keyword',    f.keyword);
      if (f.status)      setValue('status',     f.status);
      if (f.clinic_code) {
        var clinicEl2 = document.getElementById('clinic_code');
        if (clinicEl2 && !clinicEl2.disabled) setValue('clinic_code', f.clinic_code);
      }
      if (f.team_code) {
        var teamEl2 = document.getElementById('team_code');
        if (teamEl2 && !teamEl2.disabled) setValue('team_code', f.team_code);
      }
      equipmentListState.page = cached.page || 1;
      equipmentListState._initialLoad = false;
    }

    await loadEquipmentList(equipmentListState.page);

    var exportBtn = document.getElementById('exportExcelBtn');
    if (exportBtn) {
      exportBtn.addEventListener('click', exportEquipmentExcel);
    }
  } catch (error) {
    if (typeof showMessage === 'function') {
      showMessage(error.message || '화면 초기화 중 오류가 발생했습니다.', 'error');
    } else {
      console.error(error);
    }
  } finally {
    if (typeof hideGlobalLoading === 'function') hideGlobalLoading(true);
    document.body.classList.add('page-ready');
  }
});

// ================================================================
// 라벨 일괄 출력
// ================================================================

var bulkSelectedIds = new Set();

function initBulkLabelFeature() {
  var bulkBtn    = document.getElementById('bulkLabelBtn');
  var checkAllEl = document.getElementById('bulkCheckAll');

  if (!bulkBtn) return;

  // 라벨 일괄 출력 버튼 클릭 → 오버레이 인쇄
  bulkBtn.addEventListener('click', function() {
    if (!bulkSelectedIds.size) return;
    var ids        = Array.from(bulkSelectedIds);
    var sizeClass  = getSelectedLabelSizeForBulk();
    var layoutSelect = document.getElementById('bulkLayoutSelect');
    var layout     = layoutSelect ? layoutSelect.value : '';
    printLabelsOverlay(ids, sizeClass, layout);
  });

  // 검수확인서 일괄 출력 버튼
  var certBtn = document.getElementById('bulkInspectionCertBtn');
  if (certBtn) {
    certBtn.addEventListener('click', async function() {
      if (!bulkSelectedIds.size) return;
      var ids = Array.from(bulkSelectedIds);

      try {
        showGlobalLoading('장비 정보를 불러오는 중...');

        var user = equipmentListState.user;
        var userEmail = (user && user.email) ? user.email : '';

        var items = await Promise.all(
          ids.map(function(id) {
            return supabaseClient
              .from('equipments')
              .select('*')
              .eq('id', id)
              .single()
              .then(function(r) { return r.data || {}; });
          })
        );

        if (typeof generateInspectionCertPDF === 'function') {
          // 구매처 동일 여부 체크
          var vendors = [...new Set(items.map(function(e) { return String(e.vendor || '').trim(); }).filter(Boolean))];

          if (vendors.length > 1) {
            alert('⚠️ 선택한 장비의 구매처가 다릅니다.\n\n' +
              vendors.join(', ') +
              '\n\n검수확인서는 구매처가 동일한 장비만 함께 출력할 수 있습니다.');
            return;
          }

          generateInspectionCertPDF(items);
        }
      } catch (error) {
        showMessage(error.message || '장비 정보를 불러오는 중 오류가 발생했습니다.', 'error');
      } finally {
        hideGlobalLoading();
      }
    });
  }

  // 사이즈 변경 시 격자 옵션 갱신
  var sizeSelectEl = document.getElementById('bulkLabelSizeSelect');
  if (sizeSelectEl) sizeSelectEl.addEventListener('change', updateLayoutOptions);

  // 전체 선택 체크박스 (헤더)
  document.addEventListener('change', function(e) {
    if (e.target.id !== 'bulkCheckAll') return;
    var checks = document.querySelectorAll('.bulk-item-check');
    checks.forEach(function(cb) {
      cb.checked = e.target.checked;
      var id = cb.dataset.id;
      if (e.target.checked) bulkSelectedIds.add(id);
      else bulkSelectedIds.delete(id);
    });
    updateBulkUI();
  });

  // 개별 체크박스 이벤트 위임
  var listEl = document.getElementById('equipmentList');
  if (listEl) {
    listEl.addEventListener('change', function(e) {
      if (!e.target.classList.contains('bulk-item-check')) return;
      var id = e.target.dataset.id;
      if (e.target.checked) bulkSelectedIds.add(id);
      else bulkSelectedIds.delete(id);

      // 헤더 전체선택 체크박스 상태 동기화
      var checkAll = document.getElementById('bulkCheckAll');
      if (checkAll) {
        var allChecks = document.querySelectorAll('.bulk-item-check');
        var checkedCount = document.querySelectorAll('.bulk-item-check:checked').length;
        checkAll.checked = allChecks.length > 0 && checkedCount === allChecks.length;
        checkAll.indeterminate = checkedCount > 0 && checkedCount < allChecks.length;
      }

      updateBulkUI();
    });
  }
}

function updateBulkUI() {
  var btn                 = document.getElementById('bulkLabelBtn');
  var countEl             = document.getElementById('bulkLabelCount');
  var sizeSelect          = document.getElementById('bulkLabelSizeSelect');
  var layoutSelect        = document.getElementById('bulkLayoutSelect');
  var certBtn             = document.getElementById('bulkInspectionCertBtn');
  var certCountEl         = document.getElementById('bulkInspectionCertCount');
  var count               = bulkSelectedIds.size;

  if (btn)          btn.style.display          = count > 0 ? '' : 'none';
  if (sizeSelect)   sizeSelect.style.display   = count > 0 ? '' : 'none';
  if (layoutSelect) layoutSelect.style.display = count > 0 ? '' : 'none';
  if (countEl)      countEl.textContent        = count;
  if (certBtn)      certBtn.style.display      = (count > 0 && (equipmentListState.isAdmin || equipmentListState.isAppAdmin)) ? '' : 'none';
  if (certCountEl)  certCountEl.textContent    = count;
}

function updateLayoutOptions() {
  var sizeSelect   = document.getElementById('bulkLabelSizeSelect');
  var layoutSelect = document.getElementById('bulkLayoutSelect');
  if (!layoutSelect || !sizeSelect) return;

  var size = sizeSelect.value;
  if (size === 'size-70x40') {
    layoutSelect.innerHTML =
      '<option value="2x6">격자 — 2×6 (12칸)</option>';
  } else {
    layoutSelect.innerHTML =
      '<option value="2x5">격자 — 2×5 (10칸)</option>';
  }
}

function getSelectedLabelSizeForBulk() {
  var sizeSelect = document.getElementById('bulkLabelSizeSelect');
  return sizeSelect ? sizeSelect.value : 'size-90x48';
}

// 목록 렌더링 후 체크 상태 초기화
var _origRenderEquipmentList = renderEquipmentList;
renderEquipmentList = function(items) {
  // 현재 페이지 데이터 저장 (일괄 출력용)
  equipmentListState.currentItems = Array.isArray(items) ? items : [];

  _origRenderEquipmentList(items);
  bulkSelectedIds.clear();
  updateBulkUI();
  var checkAll = document.getElementById('bulkCheckAll');
  if (checkAll) { checkAll.checked = false; checkAll.indeterminate = false; }
};

document.addEventListener('DOMContentLoaded', function() {
  // 기존 DOMContentLoaded 이후 초기화
  setTimeout(initBulkLabelFeature, 100);
});

// ================================================================
// 라벨 인쇄 오버레이 (페이지 이동 없이 직접 출력)
// ================================================================

var GRID_SPECS_LIST = {
  '2x5': { cols: 2, rows: 5, colGap: '3mm', rowGap: '2mm', padT: '10mm', padS: '8mm' },
  '2x6': { cols: 2, rows: 6, colGap: '3mm', rowGap: '1mm', padT: '7mm',  padS: '8mm' }
};

function buildLabelHtmlForList(item, sizeClass, qrId) {
  var showLocation = sizeClass !== 'size-70x40' && sizeClass !== 'size-50x30';
  var showModel    = sizeClass !== 'size-50x30';
  var showDept     = sizeClass !== 'size-50x30';
  var sc           = sizeClass.replace('size-', ''); // '90x48', '70x40', '50x30'

  return (
    '<div class="prlabel prlabel--' + sc + '">' +
      '<div class="prlabel-body">' +
        '<div class="prlabel-hospital">녹십자아이메드 업무지원 시스템</div>' +
        '<div class="prlabel-title">' + escapeHtml(item.equipment_name || '-') + '</div>' +
        '<div class="prlabel-rows">' +
          '<div class="prlabel-row">' +
            '<span class="prlabel-key">관리번호</span>' +
            '<span class="prlabel-id">' + escapeHtml(item.equipment_id || '-') + '</span>' +
          '</div>' +
          (showModel ? '<div class="prlabel-row"><span class="prlabel-key">모델명</span><span class="prlabel-val">' + escapeHtml(item.model_name || '-') + '</span></div>' : '') +
          (showDept  ? '<div class="prlabel-row"><span class="prlabel-key">사용부서</span><span class="prlabel-val">' + escapeHtml(item.department || '-') + '</span></div>' : '') +
          (showLocation ? '<div class="prlabel-row"><span class="prlabel-key">위치</span><span class="prlabel-val">' + escapeHtml(item.location || '-') + '</span></div>' : '') +
        '</div>' +
      '</div>' +
      '<div class="prlabel-qr" id="' + escapeHtml(qrId) + '"></div>' +
    '</div>'
  );
}


function printLabelsOverlay(ids, sizeClass, layout) {
  var allItems = equipmentListState.currentItems || [];
  var items = ids.map(function(id) {
    return allItems.find(function(i) { return i.equipment_id === id; }) ||
      { equipment_id: id, equipment_name: id, model_name: '', department: '', location: '', qr_value: id };
  });

  var prev = document.getElementById('printLabelOverlay');
  if (prev) prev.remove();

  var overlay = document.createElement('div');
  overlay.id = 'printLabelOverlay';

  var isGrid  = !!(layout && GRID_SPECS_LIST[layout]);
  var spec    = isGrid ? GRID_SPECS_LIST[layout] : null;
  var perPage = spec ? spec.cols * spec.rows : 1;
  var pagesHtml = '';

  if (isGrid) {
    for (var p = 0; p < items.length; p += perPage) {
      var pageItems = items.slice(p, p + perPage);
      while (pageItems.length < perPage) pageItems.push(null);

      var cells = pageItems.map(function(item, cellIdx) {
        if (!item) return '<div class="plabel-empty"></div>';
        var qrId = 'pqr-g-' + p + '-' + cellIdx;
        return buildLabelHtmlForList(item, sizeClass, qrId);
      }).join('');

      pagesHtml += (
        '<div class="plabel-page plabel-page--grid" style="' +
          'grid-template-columns:repeat(' + spec.cols + ',auto);' +
          'gap:' + spec.rowGap + ' ' + spec.colGap + ';' +
          'padding:' + spec.padT + ' ' + spec.padS + ';' +
        '">' + cells + '</div>'
      );
    }
  } else {
    pagesHtml = items.map(function(item, idx) {
      var qrId = 'pqr-s-' + idx;
      return '<div class="plabel-page plabel-page--single">' +
        buildLabelHtmlForList(item, sizeClass, qrId) +
      '</div>';
    }).join('');
  }

  overlay.innerHTML = pagesHtml;
  document.body.appendChild(overlay);

  var baseUrl = (typeof CONFIG !== 'undefined' ? CONFIG.SITE_BASE_URL : '') +
                '/pages/equipment/public-detail.html?id=';
  var qrSize = sizeClass === 'size-70x40' ? 64 : sizeClass === 'size-50x30' ? 48 : 84;

  items.forEach(function(item, idx) {
    if (!item) return;
    var qrId = isGrid
      ? ('pqr-g-' + (Math.floor(idx / perPage) * perPage) + '-' + (idx % perPage))
      : ('pqr-s-' + idx);
    var qrEl = document.getElementById(qrId);
    if (!qrEl) return;
    var qrValue = item.equipment_id || '';
    if (qrValue && typeof QRCode !== 'undefined') {
      new QRCode(qrEl, { text: baseUrl + encodeURIComponent(qrValue), width: qrSize, height: qrSize });
    }
  });

  setTimeout(function() {
    window.print();
    setTimeout(function() {
      var el = document.getElementById('printLabelOverlay');
      if (el) el.remove();
    }, 500);
  }, 400);
}


// ================================================================
// 장비목록 단건 라벨 출력 모달
// ================================================================

function openListLabelModal(equipmentId) {
  // 현재 로드된 데이터에서 장비 찾기
  var items = equipmentListState.currentItems || [];
  var item  = items.find(function(i) { return i.equipment_id === equipmentId; });

  // 기존 오버레이 제거
  var prev = document.getElementById('listLabelModalOverlay');
  if (prev) prev.remove();

  // 오버레이 생성
  var overlay = document.createElement('div');
  overlay.id  = 'listLabelModalOverlay';
  overlay.className = 'list-label-modal-overlay';
  overlay.innerHTML = (
    '<div class="list-label-modal-backdrop"></div>' +
    '<div class="list-label-modal-dialog">' +
      '<div class="list-label-modal-head">' +
        '<div class="list-label-modal-head-left">' +
          '<div class="list-label-modal-icon"><i class="ti ti-tag"></i></div>' +
          '<div>' +
            '<div class="list-label-modal-title">라벨 출력</div>' +
            '<div class="list-label-modal-subtitle">QR 포함 장비 식별 라벨을 인쇄합니다</div>' +
          '</div>' +
        '</div>' +
        '<button type="button" class="list-label-modal-close" id="listLabelClose"><i class="ti ti-x"></i></button>' +
      '</div>' +
      '<div class="list-label-modal-body">' +
        '<div class="label-modal-toolbar">' +
          '<label class="form-label" style="margin:0;white-space:nowrap;">라벨 크기</label>' +
          '<select id="listLabelSizeSelect" class="input" style="width:140px;height:30px;font-size:12px;">' +
            '<option value="size-90x48" selected>90 × 48 mm</option>' +
            '<option value="size-70x40">70 × 40 mm</option>' +
            '<option value="size-50x30">50 × 30 mm</option>' +
          '</select>' +
          '<button type="button" class="btn btn-sm btn-primary" id="listLabelPrintBtn">' +
            '<i class="ti ti-printer"></i> 인쇄' +
          '</button>' +
        '</div>' +
        '<div class="label-modal-preview">' +
          '<div class="label-sheet-wrap">' +
            '<div class="device-label size-90x48" id="listLabelDevice">' +
              '<div class="device-label-main">' +
                '<div class="label-hospital">녹십자아이메드 업무지원 시스템</div>' +
                '<div class="label-title" id="llm_name">-</div>' +
                '<div class="label-info-block">' +
                  '<div class="label-row label-row-emphasis">' +
                    '<div class="label-key">관리번호</div>' +
                    '<div class="label-value label-value-id" id="llm_id">-</div>' +
                  '</div>' +
                  '<div class="label-row" id="llm_row_model">' +
                    '<div class="label-key">모델명</div>' +
                    '<div class="label-value" id="llm_model">-</div>' +
                  '</div>' +
                  '<div class="label-row" id="llm_row_dept">' +
                    '<div class="label-key">사용부서</div>' +
                    '<div class="label-value" id="llm_dept">-</div>' +
                  '</div>' +
                  '<div class="label-row" id="llm_row_loc">' +
                    '<div class="label-key">위치</div>' +
                    '<div class="label-value" id="llm_loc">-</div>' +
                  '</div>' +
                '</div>' +
              '</div>' +
              '<div class="qr-panel"><div id="llm_qr" class="label-qr-box"></div></div>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>'
  );

  document.body.appendChild(overlay);

  // 데이터 채우기
  function setT(id, val) { var el = document.getElementById(id); if (el) el.textContent = val || '-'; }
  setT('llm_name',  item && item.equipment_name);
  setT('llm_id',    item && item.equipment_id || equipmentId);
  setT('llm_model', item && item.model_name);
  setT('llm_dept',  item && item.department);
  setT('llm_loc',   item && item.location);

  listLabelApplySize('size-90x48', equipmentId);

  // 이벤트
  document.getElementById('listLabelClose').addEventListener('click', closeListLabelModal);
  overlay.querySelector('.list-label-modal-backdrop').addEventListener('click', closeListLabelModal);

  document.getElementById('listLabelSizeSelect').addEventListener('change', function() {
    listLabelApplySize(this.value, equipmentId);
  });

  document.getElementById('listLabelPrintBtn').addEventListener('click', function() {
    window.print();
  });

  setTimeout(function() { overlay.classList.add('is-open'); }, 10);
}

function closeListLabelModal() {
  var overlay = document.getElementById('listLabelModalOverlay');
  if (overlay) overlay.remove();
}

function listLabelApplySize(sizeClass, equipmentId) {
  var label = document.getElementById('listLabelDevice');
  if (label) {
    label.classList.remove('size-90x48', 'size-70x40', 'size-50x30');
    label.classList.add(sizeClass);
  }
  var rowModel = document.getElementById('llm_row_model');
  var rowDept  = document.getElementById('llm_row_dept');
  var rowLoc   = document.getElementById('llm_row_loc');
  if (rowModel) rowModel.style.display = sizeClass === 'size-50x30' ? 'none' : '';
  if (rowDept)  rowDept.style.display  = sizeClass === 'size-50x30' ? 'none' : '';
  if (rowLoc)   rowLoc.style.display   = (sizeClass === 'size-70x40' || sizeClass === 'size-50x30') ? 'none' : '';

  var qrEl = document.getElementById('llm_qr');
  if (!qrEl) return;
  qrEl.innerHTML = '';

  var url = (typeof CONFIG !== 'undefined' ? CONFIG.SITE_BASE_URL : '') +
            '/pages/equipment/public-detail.html?id=' + encodeURIComponent(equipmentId);
  var qrSize = sizeClass === 'size-70x40' ? 64 : sizeClass === 'size-50x30' ? 48 : 84;

  if (typeof QRCode !== 'undefined' && equipmentId) {
    new QRCode(qrEl, { text: url, width: qrSize, height: qrSize });
  }
}


// 장비 수정 진입 — 목록에서만 호출, 저장/취소 후 목록으로 복귀
function openEditForm(equipmentId) {
  try {
    if (window.parent && window.parent.shellNavigate) {
      window.parent.shellNavigate('equipment/form', '', false, { id: equipmentId, from: 'list' });
    } else {
      location.href = 'form.html?id=' + encodeURIComponent(equipmentId);
    }
  } catch(e) {
    location.href = 'form.html?id=' + encodeURIComponent(equipmentId);
  }
}
