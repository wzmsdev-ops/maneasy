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

function showMessage(message, type = 'info', duration = 4000) {
  // 토스트 컨테이너 (없으면 생성)
  let container = document.getElementById('_toastContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = '_toastContainer';
    container.style.cssText = [
      'position:fixed', 'bottom:20px', 'right:20px', 'z-index:99999',
      'display:flex', 'flex-direction:column', 'gap:8px',
      'pointer-events:none', 'max-width:360px',
    ].join(';');
    document.body.appendChild(container);
  }

  const COLORS = {
    success: { bg:'#f0fdf4', border:'#86efac', icon:'#16a34a', text:'#166534', ico:'✓' },
    error:   { bg:'#fef2f2', border:'#fca5a5', icon:'#dc2626', text:'#991b1b', ico:'✕' },
    warning: { bg:'#fffbeb', border:'#fcd34d', icon:'#d97706', text:'#92400e', ico:'⚠' },
    info:    { bg:'#eff6ff', border:'#93c5fd', icon:'#2563eb', text:'#1e40af', ico:'ℹ' },
  };
  const c = COLORS[type] || COLORS.info;

  const toast = document.createElement('div');
  toast.style.cssText = [
    'display:flex', 'align-items:flex-start', 'gap:10px',
    'padding:12px 14px', 'border-radius:8px',
    'background:' + c.bg, 'border:1px solid ' + c.border,
    'box-shadow:0 4px 12px rgba(0,0,0,0.12)',
    'font-size:12px', 'line-height:1.5', 'color:' + c.text,
    'pointer-events:auto', 'cursor:pointer',
    'opacity:0', 'transform:translateX(20px)',
    'transition:opacity 0.25s, transform 0.25s',
    'word-break:keep-all',
  ].join(';');

  toast.innerHTML =
    '<span style="font-size:14px;color:' + c.icon + ';flex-shrink:0;margin-top:1px;">' + c.ico + '</span>' +
    '<span style="flex:1;">' + String(message).replace(/&/g,'&amp;').replace(/</g,'&lt;') + '</span>' +
    '<span style="color:#9ca3af;font-size:11px;flex-shrink:0;margin-top:1px;">✕</span>';

  container.appendChild(toast);

  // 애니메이션 in
  requestAnimationFrame(function() {
    toast.style.opacity = '1';
    toast.style.transform = 'translateX(0)';
  });

  function dismiss() {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(20px)';
    setTimeout(function() { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 250);
  }

  toast.addEventListener('click', dismiss);
  if (duration > 0) setTimeout(dismiss, duration);
}

function clearMessage() {
  // 기존 messageBox 숨김 (레거시 호환)
  const box = qs('#messageBox');
  if (box) { box.style.display = 'none'; box.textContent = ''; box.className = 'message-box'; }
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

  var noRowsText = options.noRowsText || '조회된 데이터가 없습니다.';

  // ag-theme-alpine 자동 추가
  if (!el.classList.contains('ag-theme-alpine')) {
    el.classList.add('ag-theme-alpine');
  }

  // 페이지 작성자가 마크업에 미리 인라인 height(px)를 박아둔 경우엔 그 값을 그대로 존중
  var authorHeight = null;
  if (el.style.height && el.style.height.endsWith('px')) {
    var ah = parseInt(el.style.height);
    if (ah > 40) authorHeight = ah;
  }

  // el 자신이 flex-grow로 부모를 채우도록 설계된 대상인지(.m-table-wrap류) 여부.
  // 이 값은 레이아웃이 한 번 안정된 뒤(최초 측정 시점)에 판단하면 되고, el.style.height를
  // 우리가 직접 건드려도 flex-grow 자체(CSS 속성)는 바뀌지 않으므로 이 판단은 항상 안정적이다.
  var growsWithParent = parseFloat(getComputedStyle(el).flexGrow || '0') > 0;

  // 높이 결정.
  //  - flex로 늘어나는 대상: el 자신이 아니라 "el이 채워야 하는" 부모(flex 컨테이너) 체인의
  //    실제 레이아웃 높이를 매번 다시 측정한다. (el.offsetHeight를 읽으면, 한 번 잘못된 값으로
  //    굳어진 뒤엔 그 값만 계속 반복해서 읽게 돼서 resize/탭전환 후에도 영원히 보정되지 않는
  //    문제가 있었음 — 그리드가 컨테이너를 다 못 채우고 높이가 작게 고정되는 버그의 원인)
  //  - 고정 크기 박스(예: 180px 높이로 의도된 영역): el 자신의 레이아웃 높이를 그대로 쓴다.
  function resolveHeight() {
    if (authorHeight) return authorHeight;
    if (growsWithParent) {
      var p = el.parentElement;
      while (p) {
        if (p.clientHeight > 40) return p.clientHeight;
        p = p.parentElement;
      }
      return Math.max(300, window.innerHeight - 160);
    }
    if (el.offsetHeight > 40) return el.offsetHeight;
    return Math.max(180, window.innerHeight - 160);
  }

  var gridH = resolveHeight();
  el.style.height = gridH + 'px';

  var ROW_H    = 34;
  var HEADER_H = 34;

  // equipment-list.js defaultColDef와 동일
  var defaultColDef = {
    sortable: true,
    resizable: true,
    suppressMovable: true,
    headerClass: 'ag-center-header',
    cellStyle: { display: 'flex', alignItems: 'center', justifyContent: 'center' },
  };

  var gridOptions = {
    columnDefs: colDefs,
    defaultColDef: defaultColDef,
    rowData: rows,
    rowHeight: ROW_H,
    headerHeight: HEADER_H,
    suppressPaginationPanel: true,
    suppressScrollOnNewData: true,
    suppressHorizontalScroll: true,
    suppressCellFocus: true,
    suppressPropertyNamesCheck: true,
    overlayNoRowsTemplate: '<span style="color:#9ca3af;font-size:12px;">' + noRowsText + '</span>',
    onGridReady: function(params) {
      var _api = params.api;
      setTimeout(function() {
        if (_api && el.offsetWidth > 0) {
          var h = resolveHeight();
          if (h !== gridH) { gridH = h; el.style.height = h + 'px'; }
          _api.sizeColumnsToFit();
        }
      }, 0);
      window.addEventListener('resize', function() {
        if (_api && el.offsetWidth > 0) {
          gridH = resolveHeight();
          el.style.height = gridH + 'px';
          _api.sizeColumnsToFit();
        }
      });
      // 가로폭이 처음 측정될 때 아직 자리를 잡기 전이거나(폰트 로딩, 형제 요소 변화 등)
      // 이후에 컨테이너 폭이 바뀌는 경우에도 항상 다시 맞춰지도록 — window resize 이벤트
      // 하나에만 의존하면 그런 변화를 못 잡아서 컬럼이 좁게 고정된 채로 남는 문제가 있었음
      if (typeof ResizeObserver !== 'undefined') {
        var ro = new ResizeObserver(function() {
          if (_api) _api.sizeColumnsToFit();
        });
        ro.observe(el);
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
  api._resolveHeight = resolveHeight;
  return api;
}


function updateMgGrid(api, rows) {
  if (api && rows) {
    api.setGridOption('rowData', rows);
    refitGridColumns(api);
  }
}

/** rowData가 바뀌어서 스크롤바가 새로 생기거나 없어지는 경우, 컬럼폭을 다시 맞춰서
 *  마지막 컬럼(보통 버튼)이 스크롤바에 가려 잘리는 걸 막는다.
 *  agGrid.createGrid()로 직접 만든 그리드에서 setGridOption('rowData', ...) 직후 호출. */
function refitGridColumns(api) {
  if (!api) return;
  setTimeout(function() {
    try { api.sizeColumnsToFit(); } catch(e) { /* 그리드가 이미 제거된 경우 무시 */ }
  }, 0);
}

// GAS Web App 알림 발송 헬퍼
async function gasNotify(action, params) {
  const url = CONFIG.GAS_NOTIFY_URL;
  if (!url) return;
  try {
    const fd = new FormData();
    fd.append('action', action);
    Object.entries(params).forEach(([k, v]) => fd.append(k, v));
    await fetch(url, { method: 'POST', body: fd });
  } catch (e) {
    console.warn('[gasNotify]', e);
  }
}
