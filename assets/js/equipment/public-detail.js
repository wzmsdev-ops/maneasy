var currentEquipmentId = '';

function formatDisplayDate(value) {
  var raw = String(value || '').trim();
  if (!raw) return '-';
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  var m = raw.match(/^(\d{4}-\d{2}-\d{2})[T\s]/);
  if (m) return m[1];
  var p = new Date(raw);
  if (!isNaN(p.getTime())) {
    return p.getFullYear() + '-' +
      String(p.getMonth() + 1).padStart(2, '0') + '-' +
      String(p.getDate()).padStart(2, '0');
  }
  return raw;
}

function statusLabelPublic(v) {
  return { IN_USE:'사용중', REPAIRING:'수리중', INSPECTING:'점검중', STORED:'보관', DISPOSED:'폐기' }[String(v||'').trim()] || (v||'-');
}

function statusClassPublic(v) {
  return { IN_USE:'is-in-use', REPAIRING:'is-repairing', INSPECTING:'is-inspecting', STORED:'is-stored', DISPOSED:'is-disposed' }[String(v||'').trim()] || '';
}

function esc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function row(label, value) {
  return '<div class="pub-info-row">' +
    '<div class="pub-info-label">' + esc(label) + '</div>' +
    '<div class="pub-info-value">' + esc(value || '-') + '</div>' +
  '</div>';
}

function renderPage(item, isLoggedIn) {
  var body = document.getElementById('pubBody');
  if (!body) return;

  var statusBadge = '<span class="status-badge ' + statusClassPublic(item.status) + '">' +
    esc(statusLabelPublic(item.status)) + '</span>';

  var dept = item.department || '-';

  var heroHtml =
    '<div class="pub-hero">' +
      '<div>' +
        '<div class="pub-hero-name">' + esc(item.equipment_name || '-') + '</div>' +
        '<div class="pub-hero-id">' + esc(item.equipment_id || '-') + '</div>' +
        '<div class="pub-hero-dept"><i class="ti ti-building-hospital"></i>' + esc(dept) + '</div>' +
      '</div>' +
      '<div class="pub-hero-badge">' + statusBadge + '</div>' +
    '</div>';

  var noticeHtml =
    '<div class="pub-notice">' +
      '<i class="ti ti-info-circle"></i>' +
      'QR코드로 접근한 공개 장비 정보 페이지입니다. 일부 정보만 표시됩니다.' +
    '</div>';

  var loginNoticeHtml = !isLoggedIn ?
    '<div class="pub-notice pub-login-notice">' +
      '<i class="ti ti-lock"></i>' +
      '전체 정보 및 이력을 확인하려면 <a href="../../index.html">로그인</a>이 필요합니다.' +
    '</div>' : '';

  var infoHtml =
    '<div class="pub-card">' +
      '<div class="pub-card-head"><i class="ti ti-info-circle"></i> 장비 기본 정보</div>' +
      '<div class="pub-info-list">' +
        row('장비번호',      item.equipment_id) +
        row('모델명',        item.model_name) +
        row('제조사',        item.manufacturer) +
        row('사용부서',      item.department) +
        row('현재 위치',     item.location) +
        row('유지보수 종료', formatDisplayDate(item.maintenance_end_date)) +
      '</div>' +
    '</div>';

  var contactHtml = (item.manager_name || item.manager_phone) ?
    '<div class="pub-card">' +
      '<div class="pub-card-head"><i class="ti ti-user"></i> 업체 담당자 정보</div>' +
      '<div class="pub-info-list">' +
        row('업체 담당자',  item.manager_name) +
        row('업체 연락처',  item.manager_phone) +
      '</div>' +
    '</div>' : '';

  var detailBtnHtml = isLoggedIn ?
    '<a href="detail.html?id=' + encodeURIComponent(item.equipment_id || '') + '" class="pub-detail-btn">' +
      '<i class="ti ti-file-description"></i> 전체 상세 정보 보기' +
    '</a>' : '';

  body.innerHTML = heroHtml + noticeHtml + loginNoticeHtml + infoHtml + contactHtml + detailBtnHtml;
}

async function loadPublicEquipment() {
  var equipmentId = new URLSearchParams(location.search).get('id');
  currentEquipmentId = equipmentId || '';

  var body = document.getElementById('pubBody');

  if (!equipmentId) {
    if (body) body.innerHTML = '<div class="pub-error"><i class="ti ti-alert-circle"></i> 장비 정보를 찾을 수 없습니다.</div>';
    return;
  }

  if (typeof showGlobalLoading === 'function') showGlobalLoading('장비 정보를 불러오는 중...');

  try {
    var sbResult = await supabaseClient
      .from('equipments')
      .select('*')
      .eq('id', equipmentId)
      .eq('deleted_yn', 'N')
      .single();
    if (sbResult.error) throw new Error(sbResult.error.message);
    var result = { data: sbResult.data };
    if (result.data) result.data.equipment_id = result.data.equipment_no || result.data.id;
    var item = (result && result.data) ? result.data : {};

    var session = window.auth && typeof window.auth.getSession === 'function'
      ? window.auth.getSession() : null;
    var isLoggedIn = !!(session && (session.user_email || session.email));

    renderPage(item, isLoggedIn);
  } catch (e) {
    if (body) body.innerHTML = '<div class="pub-error"><i class="ti ti-alert-circle"></i> ' +
      escapeHtml(e.message || '장비 정보를 불러오지 못했습니다.') + '</div>';
  } finally {
    if (typeof hideGlobalLoading === 'function') hideGlobalLoading(true);
  }
}

document.addEventListener('DOMContentLoaded', loadPublicEquipment);
