'use strict';

var DAYS = ['일','월','화','수','목','금','토'];
var STATUS_BADGE = { REQUESTED:'badge-requested', PROCESSING:'badge-processing', COMPLETED:'badge-completed', REJECTED:'badge-rejected', CANCELLED:'badge-cancelled' };
var STATUS_LABEL = { REQUESTED:'접수', PROCESSING:'진행중', COMPLETED:'완료', REJECTED:'반려', CANCELLED:'취소' };
var MAX_FAV = 6;

// 즐겨찾기 가능한 전체 페이지 목록 (icon / label / page key)
var ALL_PAGES = [
  { key:'signage/apply',              icon:'ti-rubber-stamp',          label:'사인물 신청' },
  { key:'signage/history',            icon:'ti-list-check',            label:'신청내역' },
  { key:'equipment/dashboard',        icon:'ti-device-desktop-analytics', label:'의료장비 대시보드' },
  { key:'equipment/list',             icon:'ti-list',                  label:'장비 목록' },
  { key:'materials/purchase-request', icon:'ti-shopping-cart',         label:'발주요청' },
  { key:'materials/procurement',      icon:'ti-file-invoice',          label:'발주 관리' },
  { key:'materials/stock',            icon:'ti-building-warehouse',    label:'재고 관리' },
  { key:'materials/use-stock',        icon:'ti-clipboard-check',       label:'사용처리' },
  { key:'materials/material-stats',   icon:'ti-chart-bar',             label:'자재 통계' },
  { key:'task/task-manager',          icon:'ti-calendar-event',        label:'업무일정 관리' },
  { key:'master/org',                 icon:'ti-users',                 label:'조직 관리' },
  { key:'master/supply',              icon:'ti-package',               label:'자재·거래처' },
  { key:'master/notice',              icon:'ti-speakerphone',          label:'공지사항 관리' },
];

var currentUser = null;
var userFavorites = []; // page key 배열
var allowedPageKeys = [];
var tempSelected = [];

function ts(v) { return String(v == null ? '' : v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

/* ── 시계 ── */
function startClock() {
  function tick() {
    var now = new Date();
    var d = document.getElementById('homeDate');
    var t = document.getElementById('homeTime');
    if (d) d.textContent = now.getFullYear() + '년 ' + (now.getMonth()+1) + '월 ' + now.getDate() + '일 (' + DAYS[now.getDay()] + ')';
    if (t) t.textContent = String(now.getHours()).padStart(2,'0') + ':' + String(now.getMinutes()).padStart(2,'0');
  }
  tick();
  setInterval(tick, 1000);
}

/* ── 즐겨찾기 렌더 ── */
function renderFavList() {
  var el = document.getElementById('homeFavList');
  if (!userFavorites.length) {
    el.innerHTML = '<span class="home-fav-empty">즐겨찾기가 없습니다. 편집 버튼으로 추가해보세요.</span>';
    return;
  }
  el.innerHTML = userFavorites.map(function(key) {
    var page = ALL_PAGES.find(function(p) { return p.key === key; });
    if (!page) return '';
    return '<div class="home-fav-card" onclick="parent.shellNavigate && parent.shellNavigate(\'' + key + '\')">' +
      '<i class="ti ' + page.icon + '"></i>' + ts(page.label) + '</div>';
  }).join('');
}

/* ── 즐겨찾기 편집 모달 ── */
function openFavModal() {
  tempSelected = userFavorites.slice();
  renderFavPicker();
  document.getElementById('favModal').classList.add('is-open');
}
function closeFavModal() {
  document.getElementById('favModal').classList.remove('is-open');
}
window.closeFavModal = closeFavModal;

function renderFavPicker() {
  var grid = document.getElementById('favPickGrid');
  var available = ALL_PAGES.filter(function(p) { return allowedPageKeys.includes(p.key); });
  grid.innerHTML = available.map(function(p) {
    var selIdx = tempSelected.indexOf(p.key);
    var sel = selIdx !== -1;
    var badgeContent = sel ? (selIdx + 1) : '';
    return '<div class="fav-pick-card' + (sel ? ' is-selected' : '') + '" data-key="' + p.key + '">' +
      '<i class="ti ' + p.icon + ' fav-pick-icon" style="color:' + (sel ? 'var(--navy)' : '#9ca3af') + ';"></i>' +
      '<span class="fav-pick-label">' + ts(p.label) + '</span>' +
      '<span class="fav-pick-badge">' + badgeContent + '</span>' +
    '</div>';
  }).join('');

  grid.querySelectorAll('.fav-pick-card').forEach(function(card) {
    card.addEventListener('click', function() {
      var key = card.dataset.key;
      var idx = tempSelected.indexOf(key);
      if (idx !== -1) {
        tempSelected.splice(idx, 1);
      } else {
        if (tempSelected.length >= MAX_FAV) {
          alert('즐겨찾기는 최대 ' + MAX_FAV + '개까지 추가할 수 있습니다.');
          return;
        }
        tempSelected.push(key);
      }
      renderFavPicker(); // 번호 갱신
    });
  });
}

async function saveFavorites() {
  var { error } = await supabaseClient
    .from('user_profiles')
    .update({ favorites: tempSelected })
    .eq('id', currentUser.id);
  if (error) { alert('저장 실패: ' + error.message); return; }
  userFavorites = tempSelected.slice();
  renderFavList();
  closeFavModal();
}

/* ── 공지사항 ── */
async function loadNotices() {
  var { data } = await supabaseClient
    .from('system_notices').select('*')
    .eq('is_active', true)
    .order('is_pinned', { ascending:false })
    .order('created_at', { ascending:false })
    .limit(10);

  var el = document.getElementById('noticeList');
  if (!data || !data.length) { el.innerHTML = '<div class="home-empty">등록된 공지사항이 없습니다</div>'; return; }
  el.innerHTML = data.map(function(n) {
    var pin = n.is_pinned ? '<span class="notice-pin"><i class="ti ti-pin" style="font-size:9px;"></i> 공지</span>' : '';
    return '<div class="notice-item" onclick="this.classList.toggle(\'is-open\')">' +
      '<div class="notice-item-head">' + pin + '<span class="notice-title">' + ts(n.title) + '</span><i class="ti ti-chevron-down notice-expand-icon"></i></div>' +
      (n.content ? '<div class="notice-content">' + ts(n.content) + '</div>' : '') +
      '<div class="notice-meta">' + ts(n.author_name) + ' · ' + String(n.created_at).slice(0,10) + '</div>' +
    '</div>';
  }).join('');
}

/* ── 이번 주 업무일정 ── */
var PRIORITY_BADGE = {
  HIGH:   '<span style="padding:1px 6px;border-radius:999px;font-size:10px;font-weight:700;background:#fee2e2;color:#dc2626;flex-shrink:0;">높음</span>',
  MEDIUM: '<span style="padding:1px 6px;border-radius:999px;font-size:10px;font-weight:700;background:#fef3c7;color:#92400e;flex-shrink:0;">중간</span>',
  LOW:    '<span style="padding:1px 6px;border-radius:999px;font-size:10px;font-weight:700;background:#f3f4f6;color:#6b7280;flex-shrink:0;">낮음</span>',
};

async function loadTasks(userEmail) {
  var now = new Date();
  var day = now.getDay();
  var mon = new Date(now); mon.setDate(now.getDate() - (day === 0 ? 6 : day - 1));
  var sun = new Date(mon); sun.setDate(mon.getDate() + 6);
  var monStr = mon.toISOString().slice(0,10);
  var sunStr = sun.toISOString().slice(0,10);

  var { data } = await supabaseClient
    .from('task_items')
    .select('id,title,start_date,end_date,status,priority,is_done,category')
    .eq('user_email', userEmail)
    .lte('start_date', sunStr)
    .gte('end_date', monStr)
    .order('start_date', { ascending:true })
    .limit(10);

  var el = document.getElementById('taskList');
  if (!data || !data.length) {
    el.innerHTML = '<div class="home-empty">이번 주 업무일정이 없습니다</div>';
    return;
  }
  el.innerHTML = data.map(function(t) {
    var done = t.is_done;
    var badge = PRIORITY_BADGE[t.priority] || '';
    var dateStr = t.start_date === t.end_date
      ? t.start_date
      : t.start_date + ' ~ ' + (t.end_date || '');
    return '<div class="recent-item">' +
      (badge) +
      '<span class="recent-title" style="' + (done ? 'text-decoration:line-through;color:#9ca3af;' : '') + '">' +
        ts(t.title || '-') + '</span>' +
      '<span class="recent-date">' + (t.start_date ? t.start_date.slice(5) : '') + '</span>' +
    '</div>';
  }).join('');
}

/* ── 권한 계산 ── */
function computeAllowedKeys(user) {
  var ROLE_DEFAULTS = {
    user:    ['home/home','equipment/dashboard','equipment/list','equipment/detail','materials/purchase-request','materials/use-stock','materials/material-stats','task/task-manager','signage/apply','signage/history'],
    edit:    ['home/home','equipment/dashboard','equipment/list','equipment/detail','equipment/form','materials/purchase-request','materials/use-stock','materials/material-stats','task/task-manager','signage/apply','signage/history'],
    manager: ['home/home','equipment/dashboard','equipment/list','equipment/detail','equipment/form','materials/purchase-request','materials/procurement','materials/stock','materials/use-stock','materials/material-stats','task/task-manager','signage/apply','signage/history'],
    admin:   ['home/home','equipment/dashboard','equipment/list','equipment/detail','equipment/form','materials/purchase-request','materials/procurement','materials/stock','materials/use-stock','materials/material-stats','task/task-manager','signage/apply','signage/history','master/org','master/supply','master/notice'],
  };
  var pp = user.page_perms || {};
  var hasPP = Object.keys(pp).length > 0;
  if (!hasPP) return ROLE_DEFAULTS[user.role] || ROLE_DEFAULTS.user;
  var defaults = ROLE_DEFAULTS[user.role] || ROLE_DEFAULTS.user;
  return ALL_PAGES.map(function(p) { return p.key; }).filter(function(k) {
    if (hasPP && Object.prototype.hasOwnProperty.call(pp, k)) return pp[k] && pp[k] !== '접근불가';
    return defaults.includes(k);
  });
}

/* ── init ── */
async function init() {
  var session = await auth.requireAuth();
  if (!session) return;
  currentUser = await auth.getSession();

  // 사용자 프로필(favorites 포함) 로드
  var { data: profile } = await supabaseClient
    .from('user_profiles').select('favorites').eq('id', currentUser.id).single();
  userFavorites = (profile?.favorites) || [];

  // 이름/소속
  document.getElementById('homeName').textContent = (currentUser.user_name || currentUser.email) + '님';
  var sub = [];
  if (currentUser.clinic_name) sub.push(currentUser.clinic_name);
  if (currentUser.team_name) sub.push(currentUser.team_name);
  var roleMap = { admin:'관리자', manager:'매니저', edit:'편집자', user:'일반 사용자' };
  if (roleMap[currentUser.role]) sub.push(roleMap[currentUser.role]);
  document.getElementById('homeSub').textContent = sub.join(' · ');

  allowedPageKeys = computeAllowedKeys(currentUser);

  // 즐겨찾기에서 권한 없는 항목 제거
  userFavorites = userFavorites.filter(function(k) { return allowedPageKeys.includes(k); });

  startClock();
  renderFavList();

  document.getElementById('favEditBtn')?.addEventListener('click', openFavModal);
  document.getElementById('favSaveBtn')?.addEventListener('click', saveFavorites);

  var pp = currentUser.page_perms || {};
  var hasPP = Object.keys(pp).length > 0;
  var histLevel = hasPP ? (pp['signage/history'] || '') : currentUser.role;
  var canManage = histLevel === 'admin' || histLevel === 'manager';

  await Promise.all([loadNotices(), loadTasks(currentUser.email)]);
  hideGlobalLoading();
}

document.addEventListener('DOMContentLoaded', init);
