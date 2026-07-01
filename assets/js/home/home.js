'use strict';

var DAYS = ['일','월','화','수','목','금','토'];
var STATUS_BADGE = { REQUESTED:'badge-requested', PROCESSING:'badge-processing', COMPLETED:'badge-completed', REJECTED:'badge-rejected', CANCELLED:'badge-cancelled' };
var STATUS_LABEL = { REQUESTED:'접수', PROCESSING:'진행중', COMPLETED:'완료', REJECTED:'반려', CANCELLED:'취소' };

function ts(v) { return String(v == null ? '' : v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function startClock() {
  function tick() {
    var now = new Date();
    var dateEl = document.getElementById('homeDate');
    var timeEl = document.getElementById('homeTime');
    if (dateEl) dateEl.textContent =
      now.getFullYear() + '년 ' + (now.getMonth()+1) + '월 ' + now.getDate() + '일 (' + DAYS[now.getDay()] + ')';
    if (timeEl) timeEl.textContent =
      String(now.getHours()).padStart(2,'0') + ':' + String(now.getMinutes()).padStart(2,'0');
  }
  tick();
  setInterval(tick, 1000);
}

async function loadNotices() {
  var { data, error } = await supabaseClient
    .from('system_notices')
    .select('*')
    .eq('is_active', true)
    .order('is_pinned', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(10);

  var el = document.getElementById('noticeList');
  if (error || !data || !data.length) {
    el.innerHTML = '<div class="notice-empty">등록된 공지사항이 없습니다</div>';
    return;
  }
  el.innerHTML = data.map(function(n) {
    var pin = n.is_pinned ? '<span class="notice-pin"><i class="ti ti-pin" style="font-size:9px;"></i> 공지</span>' : '';
    var date = n.created_at ? String(n.created_at).slice(0,10) : '';
    return '<div class="notice-item">' +
      '<div class="notice-item-head">' + pin + '<span class="notice-title">' + ts(n.title) + '</span></div>' +
      (n.content ? '<div class="notice-content">' + ts(n.content) + '</div>' : '') +
      '<div class="notice-meta">' + ts(n.author_name) + ' · ' + date + '</div>' +
    '</div>';
  }).join('');
}

async function loadRecent(userId, canManage) {
  var q = supabaseClient
    .from('signage_requests')
    .select('id, request_no, request_title, type, status, created_at, requester_name')
    .order('created_at', { ascending: false })
    .limit(8);
  if (!canManage) q = q.eq('requester_id', userId);

  var { data, error } = await q;
  var el = document.getElementById('recentList');
  if (error || !data || !data.length) {
    el.innerHTML = '<div class="recent-empty">최근 신청 내역이 없습니다</div>';
    return;
  }
  el.innerHTML = data.map(function(r) {
    var badge = '<span class="' + (STATUS_BADGE[r.status] || 'badge-requested') + '">' + (STATUS_LABEL[r.status] || r.status) + '</span>';
    var date = r.created_at ? String(r.created_at).slice(0,10) : '';
    return '<div class="recent-item">' +
      badge +
      '<span class="recent-title">' + ts(r.request_title || '-') + '</span>' +
      (canManage ? '<span style="font-size:10px;color:#6b7280;flex-shrink:0;">' + ts(r.requester_name) + '</span>' : '') +
      '<span class="recent-date">' + date + '</span>' +
    '</div>';
  }).join('');
}

async function init() {
  var session = await auth.requireAuth();
  if (!session) return;
  var user = await auth.getSession();

  // 이름/소속
  document.getElementById('homeName').textContent = (user.user_name || user.email) + '님';
  var sub = [];
  if (user.clinic_name) sub.push(user.clinic_name);
  if (user.team_name) sub.push(user.team_name);
  var roleMap = { admin:'관리자', manager:'매니저', edit:'편집자', user:'일반 사용자' };
  if (roleMap[user.role]) sub.push(roleMap[user.role]);
  document.getElementById('homeSub').textContent = sub.join(' · ');

  startClock();

  var pp = user.page_perms || {};
  var hasPP = Object.keys(pp).length > 0;
  var historyLevel = hasPP ? (pp['signage/history'] || '') : user.role;
  var canManage = historyLevel === 'admin' || historyLevel === 'manager';

  await Promise.all([loadNotices(), loadRecent(user.id, canManage)]);
  hideGlobalLoading();
}

document.addEventListener('DOMContentLoaded', init);
