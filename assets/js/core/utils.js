function qs(selector) {
  return document.querySelector(selector);
}

function qsa(selector) {
  return document.querySelectorAll(selector);
}

function getQueryParam(name) {
  const params = new URLSearchParams(location.search);
  return params.get(name);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function safeText(value, fallback = '-') {
  const normalized = value === null || value === undefined || value === '' ? fallback : value;
  return escapeHtml(normalized);
}

function formatNumber(value) {
  if (value === null || value === undefined || value === '') return '';

  const num = Number(value);
  if (Number.isNaN(num)) return value;

  return num.toLocaleString('ko-KR');
}

function nl2br(value) {
  return escapeHtml(value).replace(/\n/g, '<br>');
}

function showMessage(message, type = 'info') {
  const box = qs('#messageBox');

  if (!box) {
    alert(message);
    return;
  }

  box.className = `message-box ${type}`;
  box.textContent = message;
  box.style.display = 'block';
}

function clearMessage() {
  const box = qs('#messageBox');
  if (!box) return;

  box.style.display = 'none';
  box.textContent = '';
  box.className = 'message-box';
}

function setLoading(button, isLoading, loadingText = '처리 중...') {
  if (!button) return;

  if (isLoading) {
    button.dataset.originalText = button.textContent;
    button.disabled = true;
    button.textContent = loadingText;
    return;
  }

  button.disabled = false;
  button.textContent = button.dataset.originalText || '저장';
}

function goToDetail(equipmentId) {
  location.href = `detail.html?id=${encodeURIComponent(equipmentId)}`;
}

// ============================
// 전역 로딩 (상단 토스트 스피너)
// ============================

let GLOBAL_LOADING_COUNT     = 0;
let GLOBAL_LOADING_OPENED_AT = 0;
const GLOBAL_LOADING_MIN_MS  = 300;

function showGlobalLoading(text = '불러오는 중...') {
  const overlay = qs('#globalLoading');
  if (!overlay) return;

  const textEl = qs('#globalLoadingText');
  if (textEl) textEl.textContent = text;

  GLOBAL_LOADING_COUNT += 1;

  if (!overlay.classList.contains('is-open')) {
    GLOBAL_LOADING_OPENED_AT = Date.now();
    overlay.classList.add('is-open');
    overlay.setAttribute('aria-hidden', 'false');
  }
}

async function hideGlobalLoading(force = false) {
  const overlay = qs('#globalLoading');
  if (!overlay) return;

  if (force) {
    GLOBAL_LOADING_COUNT = 0;
  } else {
    GLOBAL_LOADING_COUNT = Math.max(0, GLOBAL_LOADING_COUNT - 1);
  }

  if (GLOBAL_LOADING_COUNT > 0) return;

  const elapsed   = Date.now() - GLOBAL_LOADING_OPENED_AT;
  const remaining = Math.max(0, GLOBAL_LOADING_MIN_MS - elapsed);

  if (remaining > 0) {
    await new Promise(resolve => setTimeout(resolve, remaining));
  }

  overlay.classList.remove('is-open');
  overlay.setAttribute('aria-hidden', 'true');
}

async function withGlobalLoading(task, text = '불러오는 중...') {
  showGlobalLoading(text);

  try {
    return await task();
  } finally {
    await hideGlobalLoading();
  }
}

// ============================
// 상태 / 이력 / 재고 레이블
// ============================

function statusLabel(status) {
  const map = {
    IN_USE: '사용중',
    REPAIRING: '수리중',
    INSPECTING: '점검중',
    STORED: '보관',
    DISPOSED: '폐기'
  };

  return map[String(status || '').trim()] || String(status || '');
}

function statusClass(status) {
  const map = {
    IN_USE: 'is-in-use',
    REPAIRING: 'is-repairing',
    INSPECTING: 'is-inspecting',
    STORED: 'is-stored',
    DISPOSED: 'is-disposed'
  };

  return map[String(status || '').trim()] || '';
}

function historyTypeLabel(type) {
  const map = {
    REPAIR: '수리',
    INSPECTION: '점검',
    MAINTENANCE: '유지보수',
    OTHER: '기타'
  };

  return map[String(type || '').trim()] || String(type || '');
}

function resultStatusLabel(type) {
  const value = String(type || '').trim();

  if (!value) return '미등록';  // 🔥 핵심 fallback

  const map = {
    COMPLETED: '완료',
    IN_PROGRESS: '진행중',
    PENDING: '대기'
  };

  return map[value] || value;
}


function ResultStatusClass(status) {
  const map = {
    COMPLETED: 'badge-green',
    IN_PROGRESS: 'badge-orange',
    PENDING: 'badge-gray'
  };
  return map[status] || 'badge-gray';
}

function conditionStatusLabel(type) {
  const value = String(type || '').trim();

  if (!value) return '미등록';

  const map = {
    NORMAL: '정상',
    NEEDS_CHECK: '확인 필요',
    ABNORMAL: '이상',
    MISSING: '분실',
  };

  return map[value] || value;
}

function formatDateTimeKR(value) {
  if (!value) return '-';

  const date = new Date(value);
  if (isNaN(date)) return value;

  return date.toLocaleString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

// ============================
// 의원별 앱 접근 제한
// ============================

function isEquipmentClinicAllowed(user) {
  var allowed = (typeof CONFIG !== 'undefined' && Array.isArray(CONFIG.EQUIPMENT_ALLOWED_CLINICS))
    ? CONFIG.EQUIPMENT_ALLOWED_CLINICS
    : ['서울숲의원'];
  var clinicName = String((user && user.clinic_name) || '').trim();
  return allowed.some(function(name) { return clinicName.indexOf(name) !== -1; });
}

// ============================
// 모바일 topbar 버튼 수 자동 열 조정
// portal-top-actions 안의 portal-header-btn 수를 세어
// top-actions--cols-1/2/3 클래스를 자동으로 부여
// 새 페이지를 추가해도 별도 작업 불필요
// ============================

// ============================
// 모바일 topbar 버튼 수 자동 열 조정
// portal-top-actions 안의 portal-header-btn 수를 세어
// top-actions--cols-1/2/3 클래스를 자동으로 부여
// 새 페이지를 추가해도 별도 작업 불필요
// ============================

function applyTopActionsColClass() {
  var containers = document.querySelectorAll('.portal-top-actions, .top-brand-actions');
  containers.forEach(function (container) {
    // display:none 버튼은 제외하고 실제 보이는 버튼만 카운트
    var btns = container.querySelectorAll('.portal-header-btn');
    var visibleCount = 0;
    btns.forEach(function (btn) {
      if (btn.style.display !== 'none' && btn.offsetParent !== null) {
        visibleCount++;
      }
    });
    if (visibleCount < 1) return;
    var cols = Math.min(visibleCount, 3);
    container.classList.remove('top-actions--cols-1', 'top-actions--cols-2', 'top-actions--cols-3');
    container.classList.add('top-actions--cols-' + cols);
  });
}

(function () {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyTopActionsColClass);
  } else {
    applyTopActionsColClass();
  }
})();

// ── Shell SPA 감지 ─────────────────────────────────────────
// ?shell=1 파라미터가 있으면 body에 in-shell 클래스 추가
// → common.css의 body.in-shell 규칙으로 topbar 자동 숨김
(function () {
  if (new URLSearchParams(location.search).get('shell') === '1') {
    document.documentElement.classList.add('in-shell');
    if (document.body) {
      document.body.classList.add('in-shell');
    } else {
      document.addEventListener('DOMContentLoaded', function () {
        document.body.classList.add('in-shell');
      });
    }
  }
})();


// ── AG Grid 공통 헬퍼 ──────────────────────────────────────
/**
 * createMgGrid(containerId, colDefs, rows, options)
 *
 * options:
 *   pageSize   {number}  페이지당 행 수 (기본 20). 높이 계산에 사용.
 *   fit        {boolean} true면 컨테이너 높이에 맞게 rowHeight 자동 계산 (기본 true)
 *   noRowsText {string}  데이터 없을 때 문구
 *   onRowClick {fn}      행 클릭 핸들러 (params.data 전달)
 *
 * 반환값: gridApi 인스턴스 (destroy/setGridOption 가능)
 */
function createMgGrid(containerId, colDefs, rows, options) {
  options = options || {};
  var el = document.getElementById(containerId);
  if (!el) return null;
  if (typeof agGrid === 'undefined') return null;

  var pageSize   = options.pageSize   || 20;
  var noRowsText = options.noRowsText || '조회된 데이터가 없습니다.';
  var fit        = options.fit !== false;

  // 높이 계산
  var baseH = 34;
  var gridH = el.clientHeight || (pageSize * 34 + baseH);
  var dataH = gridH - baseH;
  var rowH  = fit ? Math.max(26, Math.floor(dataH / pageSize)) : 34;
  var rem   = fit ? Math.max(0, dataH - rowH * pageSize) : 0;

  var defaultColDef = {
    sortable: true,
    resizable: true,
    suppressMovable: true,
    cellStyle: { display: 'flex', alignItems: 'center' },
  };

  var gridOptions = {
    columnDefs: colDefs,
    defaultColDef: defaultColDef,
    rowData: rows,
    rowHeight: rowH,
    headerHeight: baseH + rem,
    suppressHorizontalScroll: true,
    suppressScrollOnNewData: true,
    overlayNoRowsTemplate: '<span style="color:#9ca3af;font-size:13px;">' + noRowsText + '</span>',
    onGridReady: function(params) {
      params.api.sizeColumnsToFit();
      window.addEventListener('resize', function() { params.api.sizeColumnsToFit(); });
    },
    onFirstDataRendered: function(params) {
      if (!fit) return;
      var viewport = el.querySelector('.ag-body-viewport');
      if (!viewport) return;
      var viewH = viewport.clientHeight;
      var rH    = Math.max(26, Math.floor(viewH / pageSize));
      var r     = Math.max(0, viewH - rH * pageSize);
      if (rH !== params.api.getGridOption('rowHeight')) {
        params.api.setGridOption('rowHeight', rH);
        params.api.setGridOption('headerHeight', baseH + r);
        params.api.resetRowHeights();
      }
    },
  };

  if (options.onRowClick) {
    gridOptions.onRowClicked = function(params) {
      if (params.data) options.onRowClick(params.data);
    };
    gridOptions.rowStyle = { cursor: 'pointer' };
  }

  var api = agGrid.createGrid(el, gridOptions);
  return api;
}

/**
 * updateMgGrid(api, rows)
 * 기존 그리드 인스턴스에 데이터만 교체
 */
function updateMgGrid(api, rows) {
  if (api && rows) api.setGridOption('rowData', rows);
}
