<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>관리이지</title>
  <link rel="icon" href="data:,">
  <link rel="stylesheet" href="assets/css/common.css" />
  <link rel="stylesheet" href="assets/css/shell.css" />
  <link rel="stylesheet" href="assets/font/tabler-icons/tabler-icons.min.css" />
</head>
<body>

<div class="app-shell">

  <nav class="sidebar" id="sidebar" role="navigation" aria-label="메인 메뉴">
    <div class="sb-brand">
      <img class="sb-brand-img"
           src="assets/images/logo.png"
           alt="관리이지" />
    </div>
    <div class="sb-user">
      <div class="sb-user-info">
        <div class="sb-user-line" id="sbUserLine">로딩 중...</div>
        <div class="sb-user-role" id="sbUserRole"></div>
      </div>
    </div>
    <div class="sb-nav">

      <!-- 의료장비 관리 -->
      <button class="sb-item sb-item-parent" data-group="equipment">
        <div class="sb-item-inner"><i class="ti ti-device-desktop-analytics"></i><span>의료장비 관리</span></div>
        <i class="ti ti-chevron-right sb-item-arrow"></i>
      </button>
      <div class="sb-submenu" data-group="equipment">
        <button class="sb-sub-item" data-page="equipment/dashboard" onclick="navigate('equipment/dashboard')">
          <i class="ti ti-layout-dashboard"></i><span>대시보드</span>
        </button>
        <button class="sb-sub-item" data-page="equipment/list" onclick="navigate('equipment/list')">
          <i class="ti ti-list"></i><span>장비 목록</span>
        </button>
        <button class="sb-sub-item" data-page="equipment/form" onclick="navigate('equipment/form')" id="sbItemEquipmentForm">
          <i class="ti ti-plus"></i><span>장비 등록</span>
        </button>
      </div>

      <!-- 정도관리 -->
      <button class="sb-item sb-item-parent" data-group="qc">
        <div class="sb-item-inner"><i class="ti ti-chart-line"></i><span>정도관리</span></div>
        <i class="ti ti-chevron-right sb-item-arrow"></i>
      </button>
      <div class="sb-submenu" data-group="qc">
        <button class="sb-sub-item" data-page="qc/items" onclick="navigate('qc/items')">
          <i class="ti ti-clipboard-list"></i><span>검사항목 관리</span>
        </button>
        <button class="sb-sub-item" data-page="qc/data" onclick="navigate('qc/data')">
          <i class="ti ti-edit"></i><span>데이터 입력</span>
        </button>
      </div>

      <!-- 자재관리 -->
      <button class="sb-item sb-item-parent" data-group="material">
        <div class="sb-item-inner"><i class="ti ti-box"></i><span>자재관리</span></div>
        <i class="ti ti-chevron-right sb-item-arrow"></i>
      </button>
      <div class="sb-submenu" data-group="material">
        <button class="sb-sub-item" data-page="materials/purchase-request" onclick="navigate('materials/purchase-request')" id="sbItemPurchaseRequest">
          <i class="ti ti-shopping-cart"></i><span>발주요청</span>
        </button>
        <button class="sb-sub-item" data-page="materials/procurement" onclick="navigate('materials/procurement')" id="sbItemProcurement" style="display:none;">
          <i class="ti ti-file-invoice"></i><span>발주 관리</span>
        </button>
        <button class="sb-sub-item" data-page="materials/stock" onclick="navigate('materials/stock')" id="sbItemStock" style="display:none;">
          <i class="ti ti-building-warehouse"></i><span>재고 관리</span>
        </button>
        <button class="sb-sub-item" data-page="materials/use-stock" onclick="navigate('materials/use-stock')" id="sbItemUseStock">
          <i class="ti ti-clipboard-check"></i><span>사용처리</span>
        </button>
        <div class="sb-divider"></div>
        <button class="sb-sub-item" data-page="materials/material-stats" onclick="navigate('materials/material-stats')" id="sbItemMaterialStats">
          <i class="ti ti-chart-bar"></i><span>자재 통계</span>
        </button>
      </div>

      <!-- 마스터 관리 -->
      <div class="sb-divider sb-admin-only" id="sbDividerMaster" style="display:none;margin:6px 0;"></div>
      <button class="sb-item sb-item-parent sb-admin-only" data-group="master" id="sbGroupMaster" style="display:none;">
        <div class="sb-item-inner"><i class="ti ti-settings"></i><span>마스터 관리</span></div>
        <i class="ti ti-chevron-right sb-item-arrow"></i>
      </button>
      <div class="sb-submenu sb-admin-only" data-group="master">
        <button class="sb-sub-item" data-page="master/org" onclick="navigate('master/org')" id="sbItemMasterOrg">
          <i class="ti ti-building-hospital"></i><span>의원·부서·사용자</span>
        </button>
        <button class="sb-sub-item" data-page="master/supply" onclick="navigate('master/supply')" id="sbItemMasterSupply">
          <i class="ti ti-package"></i><span>자재·거래처</span>
        </button>
      </div>

    </div>
    <div class="sb-footer">
      <button class="sb-logout" onclick="doLogout()">
        <i class="ti ti-logout"></i><span>로그아웃</span>
      </button>
    </div>
  </nav>

  <div class="sb-overlay" id="sbOverlay" onclick="closeSidebar()"></div>

  <div class="shell-main">
    <header class="shell-topbar">
      <button class="shell-topbar-hamburger" onclick="openSidebar()" aria-label="메뉴 열기">
        <i class="ti ti-menu-2"></i>
      </button>
      <div class="shell-breadcrumb">
        <span class="shell-breadcrumb-app" id="breadcrumbApp">—</span>
        <span class="shell-breadcrumb-sep" id="breadcrumbSep" style="display:none">›</span>
        <span class="shell-breadcrumb-page" id="breadcrumbPage"></span>
      </div>
    </header>
    <div class="shell-content">
      <iframe class="shell-iframe" id="shellFrame" src="" title="콘텐츠 영역"></iframe>
    </div>
  </div>

</div>

<script src="assets/libs/supabase.js"></script>
<script src="assets/js/core/config.js"></script>
<script src="assets/js/core/utils.js"></script>
<script src="assets/js/core/supabase.js"></script>
<script src="assets/js/core/auth.js"></script>
<script>
'use strict';

const MENU_META = {
  'equipment/dashboard': { app: '의료장비 관리', page: '대시보드' },
  'equipment/list':      { app: '의료장비 관리', page: '장비 목록' },
  'equipment/form':      { app: '의료장비 관리', page: '장비 등록·수정' },
  'equipment/detail':    { app: '의료장비 관리', page: '장비 상세' },
  'qc/items':            { app: '정도관리', page: '검사항목 관리' },
  'qc/data':             { app: '정도관리', page: '데이터 입력' },
  'master/org':             { app: '마스터 관리', page: '의원·부서·사용자' },
  'master/supply':          { app: '마스터 관리', page: '자재·거래처' },
  'materials/purchase-request':{ app: '자재관리', page: '발주요청' },
  'materials/use-stock':       { app: '자재관리', page: '사용처리' },
  'materials/procurement':     { app: '자재관리', page: '발주 관리' },
  'materials/stock':           { app: '자재관리', page: '재고 관리' },
  'materials/material-stats':  { app: '자재관리', page: '자재 통계' },
};

/* ── Flyout 서브메뉴 ── */
let _flyout = null;
let _flyoutTimer = null;

function initFlyout() {
  document.querySelectorAll('.sb-item-parent').forEach(btn => {
    btn.addEventListener('mouseenter', () => showFlyout(btn));
    btn.addEventListener('mouseleave', () => scheduleFlyoutClose());
  });
  document.addEventListener('click', e => {
    if (!e.target.closest('.sb-flyout') && !e.target.closest('.sb-item-parent')) hideFlyout();
  });
}

function showFlyout(btn) {
  clearTimeout(_flyoutTimer);
  hideFlyout(true);

  const group   = btn.dataset.group;
  const submenu = document.querySelector(`.sb-submenu[data-group="${group}"]`);
  if (!submenu) return;
  const children = Array.from(submenu.children).filter(el => {
    if (el.classList.contains('sb-sub-item')) return el.style.display !== 'none';
    if (el.classList.contains('sb-divider')) return true;
    return false;
  });
  if (!children.some(el => el.classList.contains('sb-sub-item'))) return;

  const fly = document.createElement('div');
  fly.className = 'sb-flyout';
  _flyout = fly;

  // 라벨
  const lbl = document.createElement('div');
  lbl.style.cssText = 'padding:6px 16px 4px;font-size:10px;font-weight:700;opacity:0.5;text-transform:uppercase;letter-spacing:0.07em;color:#e2e8f0;pointer-events:none;';
  lbl.textContent = btn.querySelector('span')?.textContent || '';
  fly.appendChild(lbl);

  children.forEach(item => {
    if (item.classList.contains('sb-divider')) {
      const div = document.createElement('div');
      div.className = 'sb-divider';
      fly.appendChild(div);
      return;
    }
    const fi = document.createElement('button');
    fi.className = 'sb-sub-item' + (item.classList.contains('active') ? ' active' : '');
    fi.innerHTML = item.innerHTML;
    fi.onclick = () => { item.click(); hideFlyout(); };
    fly.appendChild(fi);
  });

  fly.addEventListener('mouseenter', () => clearTimeout(_flyoutTimer));
  fly.addEventListener('mouseleave', () => scheduleFlyoutClose());

  document.body.appendChild(fly);

  const rect    = btn.getBoundingClientRect();
  const sidebar = document.querySelector('.sidebar').getBoundingClientRect();
  fly.style.left = (sidebar.right + 4) + 'px';

  const flyH = fly.offsetHeight;
  const top  = Math.min(rect.top, window.innerHeight - flyH - 8);
  fly.style.top = Math.max(8, top) + 'px';
}

function scheduleFlyoutClose() {
  _flyoutTimer = setTimeout(hideFlyout, 180);
}

function hideFlyout(immediate) {
  if (immediate) clearTimeout(_flyoutTimer);
  if (_flyout) { _flyout.remove(); _flyout = null; }
}

document.addEventListener('DOMContentLoaded', async () => {
  const session = await auth.requireAuth();
  if (!session) return;

  const user = await auth.getSession();
  if (user) {
    const name   = user.user_name || user.email;
    const clinic = user.clinic_name ? ` · ${user.clinic_name}` : '';
    document.getElementById('sbUserLine').textContent = name + clinic;

    // 역할 표시
    const roleEl = document.getElementById('sbUserRole');
    if (roleEl) {
      const roleLabel = { admin: '관리자', edit: '편집자', manager: '담당자', user: '일반' };
      roleEl.textContent = roleLabel[user.role] || user.role || '';
    }

    // 역할별 기본 권한 (allowed_pages가 null인 사용자에게 적용 — org.js의 ROLE_DEFAULT_PAGES와 동일하게 유지)
    const ROLE_BASE_PAGES = [
      'equipment/dashboard', 'equipment/list', 'equipment/detail',
      'qc/items', 'qc/data',
      'materials/purchase-request', 'materials/use-stock', 'materials/material-stats',
    ];
    const ROLE_DEFAULT_PAGES = {
      user:    [...ROLE_BASE_PAGES],
      edit:    [...ROLE_BASE_PAGES, 'equipment/form'],
      manager: [...ROLE_BASE_PAGES, 'equipment/form', 'materials/procurement', 'materials/stock'],
      admin:   [...ROLE_BASE_PAGES, 'equipment/form', 'materials/procurement', 'materials/stock', 'master/org', 'master/supply'],
    };
    const allowedPages = user.allowed_pages && user.allowed_pages.length
      ? user.allowed_pages
      : (ROLE_DEFAULT_PAGES[user.role] || ROLE_DEFAULT_PAGES.user);
    window.__allowedPages = allowedPages; // navigate()에서 직접 URL 진입 막을 때도 재사용

    // data-page를 가진 모든 사이드바 항목에 범용으로 적용 (개별 사용자마다 다를 수 있으므로 하드코딩 대신 권한 목록으로 판단)
    document.querySelectorAll('.sb-sub-item[data-page]').forEach(el => {
      el.style.display = allowedPages.includes(el.dataset.page) ? '' : 'none';
    });
    // 마스터 관리 그룹(상위 메뉴/구분선)은 그 안에 보이는 페이지가 하나라도 있을 때만 노출
    const masterGroupVisible = allowedPages.includes('master/org') || allowedPages.includes('master/supply');
    if (masterGroupVisible) {
      document.getElementById('sbGroupMaster').style.display = '';
      document.getElementById('sbDividerMaster').style.display = '';
    }
  }

  const params = new URLSearchParams(location.search);
  initFlyout();
  navigate(params.get('page') || 'equipment/dashboard', true);
});

function navigate(page, tab, skipHistory, extraQuery) {
  if (!page) return;

  const pagePathOnly = page.split('?')[0];
  if (window.__allowedPages && !window.__allowedPages.includes(pagePathOnly) && pagePathOnly !== 'equipment/detail') {
    alert('이 페이지에 접근할 권한이 없습니다.');
    return;
  }

  // extraQuery 객체가 있으면 쿼리스트링으로 변환해서 page에 합침
  if (extraQuery && typeof extraQuery === 'object') {
    var qs = Object.entries(extraQuery).map(function([k, v]) {
      return encodeURIComponent(k) + '=' + encodeURIComponent(v);
    }).join('&');
    if (qs) page = page + '?' + qs;
  }

  const pagePath  = page.split('?')[0];
  const pageQuery = page.split('?')[1] || '';

  const meta = MENU_META[pagePath] || { app: pagePath, page: '' };
  document.getElementById('breadcrumbApp').textContent  = meta.app;
  document.getElementById('breadcrumbPage').textContent = meta.page;
  document.getElementById('breadcrumbSep').style.display = meta.page ? '' : 'none';

  document.getElementById('shellFrame').src =
    `${CONFIG.SITE_BASE_URL}/pages/${pagePath}.html${pageQuery ? '?' + pageQuery : ''}`;

  document.querySelectorAll('.sb-item.active, .sb-sub-item.active').forEach(el => el.classList.remove('active'));
  const _activeItem = document.querySelector(`.sb-sub-item[data-page="${pagePath}"]`);
  if (_activeItem) {
    _activeItem.classList.add('active');
    // 부모 그룹 버튼도 active
    const _group = _activeItem.closest('.sb-submenu')?.dataset.group;
    if (_group) document.querySelector(`.sb-item-parent[data-group="${_group}"]`)?.classList.add('active');
  } else {
    document.querySelector(`.sb-item[data-page="${pagePath}"]`)?.classList.add('active');
  }

  if (!skipHistory) history.pushState({ page }, '', `?page=${page}`);
  closeSidebar();
}

function openSidebar() {
  document.getElementById('sidebar').classList.add('is-open');
  document.getElementById('sbOverlay').classList.add('is-visible');
}
function closeSidebar() {
  document.getElementById('sidebar').classList.remove('is-open');
  document.getElementById('sbOverlay').classList.remove('is-visible');
}
async function doLogout() { await auth.logout(); }

window.shellNavigate = navigate;
window.addEventListener('popstate', e => {
  if (e.state?.page) navigate(e.state.page, true);
});
</script>

<style>
  /* 사용자 역할 표시 */
  .sb-user-role {
    font-size: 10px;
    color: rgba(255,255,255,0.4);
    margin-top: 2px;
  }
</style>
</body>
</html>
