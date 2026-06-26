let currentEquipmentId = '';
let currentEquipmentData = null;
let detailPermission = { canView: false, canEdit: false, canDelete: false, isAdmin: false, isAppAdmin: false };

function getCurrentUser() {
  // Supabase 세션에서 동기적으로 현재 유저 반환
  // auth.getSession()은 async라 직접 호출 불가 — _cachedUser 사용
  return window._detailCurrentUser || null;
}

async function initCurrentUser() {
  const session = await auth.requireAuth();
  if (!session) return null;
  const user = await auth.getSession();
  window._detailCurrentUser = user;
  return user;
}

async function getEquipmentPermissionContext() {
  const user = getCurrentUser();
  if (!user || !user.email) {
    return { canView: false, canEdit: false, canDelete: false, isAdmin: false, isAppAdmin: false };
  }

  const role = String(user.role || '').trim().toLowerCase();
  if (role === 'admin') {
    return { canView: true, canEdit: true, canDelete: true, isAdmin: true, isAppAdmin: false };
  }

  try {
    // 데모: Supabase user_profiles role 기반 권한
    const { data: profile } = await supabaseClient
      .from('user_profiles')
      .select('role')
      .eq('id', user.id)
      .single();
    const role = (profile && profile.role) || 'user';
    const permission = role === 'admin' ? 'admin' : role === 'edit' ? 'edit' : 'view';

    return {
      canView: ['view', 'edit', 'admin'].indexOf(permission) > -1,
      canEdit: ['edit', 'admin'].indexOf(permission) > -1,
      canDelete: false,
      isAdmin: false,
      isAppAdmin: permission === 'admin'
    };
  } catch (error) {
    return { canView: false, canEdit: false, canDelete: false, isAdmin: false, isAppAdmin: false };
  }
}

function safeValue(value) {
  return escapeHtml(value || '-');
}

function formatDisplayDate(value) {
  const raw = String(value || '').trim();
  if (!raw) return '-';
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  const dateOnlyMatch = raw.match(/^(\d{4}-\d{2}-\d{2})[T\s]/);
  if (dateOnlyMatch) return dateOnlyMatch[1];

  const parsed = new Date(raw);
  if (!isNaN(parsed.getTime())) {
    const yyyy = parsed.getFullYear();
    const mm = String(parsed.getMonth() + 1).padStart(2, '0');
    const dd = String(parsed.getDate()).padStart(2, '0');
    return yyyy + '-' + mm + '-' + dd;
  }

  return raw;
}

function formatDisplayDateTime(value) {
  const raw = String(value || '').trim();
  if (!raw) return '-';

  const isoMatch = raw.match(/^(\d{4}-\d{2}-\d{2})[T\s](\d{2}:\d{2})/);
  if (isoMatch) {
    return isoMatch[1] + ' ' + isoMatch[2];
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  const parsed = new Date(raw);
  if (!isNaN(parsed.getTime())) {
    const yyyy = parsed.getFullYear();
    const mm = String(parsed.getMonth() + 1).padStart(2, '0');
    const dd = String(parsed.getDate()).padStart(2, '0');
    const hh = String(parsed.getHours()).padStart(2, '0');
    const mi = String(parsed.getMinutes()).padStart(2, '0');
    return yyyy + '-' + mm + '-' + dd + ' ' + hh + ':' + mi;
  }

  return raw;
}

function safeNumber(value) {
  if (value === null || value === undefined || value === '') return '-';
  return formatNumber(value);
}

function invalidateDashboardSessionCacheSafe() {
  try {
    if (typeof window.invalidateDashboardSessionCache === 'function') {
      window.invalidateDashboardSessionCache();
    }
  } catch (error) {}
}

function applyActionVisibility() {
  const editBtn = qs('#editEquipmentBtn');
  const deleteBtn = qs('#deleteBtn');
  const addHistoryBtn = qs('#addHistoryBtn');
  const addInventoryBtn = qs('#addInventoryBtn');
  const printLabelBtn = qs('#printLabelBtn');
  const inspectionCertBtn = qs('#inspectionCertBtn');

  const isDeleted =
    String((currentEquipmentData && currentEquipmentData.deleted_yn) || 'N')
      .trim()
      .toUpperCase() === 'Y';

  // ★ user이면 본인 소속 팀 장비만 수정/이력/재고 버튼 표시
  // app:admin이면 타 팀 장비도 수정/이력/재고 버튼 표시
  const currentUser = getCurrentUser();
  const isAdmin = detailPermission.isAdmin;
  const isAppAdmin = detailPermission.isAppAdmin;
  const canEditThisItem = detailPermission.canEdit && (
    isAdmin ||
    isAppAdmin ||
    (
      currentEquipmentData &&
      currentUser &&
      String(currentEquipmentData.team_code || '').trim() === String(currentUser.team_code || '').trim()
    )
  );

  if (editBtn) editBtn.style.display = canEditThisItem && !isDeleted ? '' : 'none';
  if (deleteBtn) deleteBtn.style.display = detailPermission.canDelete ? '' : 'none';
  if (addHistoryBtn) addHistoryBtn.style.display = canEditThisItem && !isDeleted ? '' : 'none';
  if (addInventoryBtn) addInventoryBtn.style.display = canEditThisItem && !isDeleted ? '' : 'none';
  const isMobile = window.innerWidth <= 768;
  if (printLabelBtn) printLabelBtn.style.display = (detailPermission.canView && !isMobile) ? '' : 'none';
  if (inspectionCertBtn) inspectionCertBtn.style.display = (isAdmin || isAppAdmin) ? '' : 'none';

  if (typeof applyTopActionsColClass === 'function') applyTopActionsColClass();
}

function buildEquipmentDetailUrl(equipmentId) {
  return CONFIG.SITE_BASE_URL + '/pages/equipment/public-detail.html?id=' + encodeURIComponent(equipmentId);
}

function renderDetailSkeleton() {
  const detailInfoGrid = qs('#detailInfoGrid');
  const qrBox = qs('#qrBox');
  const qrText = qs('#qrText');
  const photoImg = qs('#detailPhotoImage');
  const photoEmpty = qs('#detailPhotoEmpty');

  if (detailInfoGrid) {
    detailInfoGrid.innerHTML = '';
  }

  if (qrBox) {
    qrBox.innerHTML = '';
  }

  if (qrText) {
    qrText.innerHTML = '';
  }

  if (photoImg) {
    photoImg.src = '';
    photoImg.classList.add('is-hidden');
  }

  if (photoEmpty) {
    photoEmpty.classList.remove('is-hidden');
    photoEmpty.textContent = '불러오는 중...';
  }
}

function renderSectionLoading(areaSelector, countSelector) {
  const area = qs(areaSelector);
  const countEl = qs(countSelector);

  if (countEl) countEl.textContent = '불러오는 중...';
  if (area) {
    area.innerHTML = '<div class="empty-box">불러오는 중...</div>';
  }
}

function renderSectionError(areaSelector, countSelector, message) {
  const area = qs(areaSelector);
  const countEl = qs(countSelector);

  if (countEl) countEl.textContent = '로드 실패';
  if (area) {
    area.innerHTML =
      '<div class="empty-box">' +
      escapeHtml(message || '불러오기에 실패했습니다.') +
      '</div>';
  }
}

function renderHero(item) {
  const heroEquipmentName = qs('#heroEquipmentName');
  const heroEquipmentId = qs('#heroEquipmentId');
  const badge = qs('#heroStatusBadge');

  if (heroEquipmentName) heroEquipmentName.textContent = item.equipment_name || '장비명';
  if (heroEquipmentId) heroEquipmentId.textContent = item.equipment_id || '-';

  if (badge) {
    badge.textContent = statusLabel(item.status);
    badge.className = 'status-badge ' + statusClass(item.status);
  }
}

function renderPhoto(item) {
  const imgEl = qs('#detailPhotoImage');
  const emptyEl = qs('#detailPhotoEmpty');
  const openBtn = qs('#photoOpenBtn');
  const deleteBtn = qs('#photoDeleteBtn');

  if (!imgEl || !emptyEl) return;

  const inlineUrl = String((item && item.photo_inline_url) || '').trim();
  const directUrl = String((item && item.photo_url) || '').trim();
  const finalUrl = inlineUrl || directUrl;
  const hasPhoto = !!finalUrl;

  imgEl.onerror = function() {
    imgEl.src = '';
    imgEl.classList.add('is-hidden');
    emptyEl.classList.remove('is-hidden');
    emptyEl.textContent = '사진을 불러오지 못했습니다. 네트워크 또는 파일 접근 경로를 확인하세요.';
    if (openBtn) openBtn.style.display = 'none';
    if (deleteBtn) deleteBtn.style.display = 'none';
  };

  imgEl.onload = function() {
    emptyEl.classList.add('is-hidden');
  };

  if (hasPhoto) {
    imgEl.src = finalUrl;
    imgEl.classList.remove('is-hidden');
    emptyEl.classList.add('is-hidden');
    emptyEl.textContent = '등록된 사진이 없습니다.';
  } else {
    imgEl.src = '';
    imgEl.classList.add('is-hidden');
    emptyEl.classList.remove('is-hidden');
    emptyEl.textContent = '등록된 사진이 없습니다.';
  }

  if (openBtn) {
    openBtn.style.display = hasPhoto ? '' : 'none';
  }

  if (deleteBtn) {
    deleteBtn.style.display = hasPhoto && detailPermission.canEdit ? '' : 'none';
  }
}

function getCurrentPhotoUrl() {
  if (!currentEquipmentData) return '';
  return String(currentEquipmentData.photo_inline_url || currentEquipmentData.photo_url || '').trim();
}

function openPhotoInNewWindow() {
  const imageUrl = getCurrentPhotoUrl();
  if (!imageUrl) {
    showMessage('열 수 있는 사진이 없습니다.', 'error');
    return;
  }

  const win = window.open('', '_blank');
  if (!win) {
    showMessage('새 창을 열 수 없습니다. 팝업 차단을 확인해주세요.', 'error');
    return;
  }

  const title = escapeHtml((currentEquipmentData && currentEquipmentData.equipment_name) || '장비 사진');

  win.document.open();
  win.document.write(
    '<!DOCTYPE html>' +
    '<html lang="ko">' +
    '<head>' +
      '<meta charset="UTF-8">' +
      '<meta name="viewport" content="width=device-width, initial-scale=1.0">' +
      '<title>' + title + '</title>' +
      '<style>' +
        'html,body{margin:0;padding:0;background:#111;height:100%;}' +
        'body{display:flex;align-items:center;justify-content:center;}' +
        'img{max-width:100vw;max-height:100vh;object-fit:contain;display:block;}' +
      '</style>' +
    '</head>' +
    '<body>' +
      '<img src="' + imageUrl + '" alt="' + title + '">' +
    '</body>' +
    '</html>'
  );
  win.document.close();
}

async function deleteCurrentPhoto() {
  if (!detailPermission.canEdit) {
    showMessage('사진을 삭제할 권한이 없습니다.', 'error');
    return;
  }

  if (!currentEquipmentId) {
    showMessage('장비 정보가 없습니다.', 'error');
    return;
  }

  const confirmed = confirm('현재 등록된 장비 사진을 삭제하시겠습니까?');
  if (!confirmed) return;

  const user = getCurrentUser();
  const userEmail = (user && user.email) || '';

  try {
    showGlobalLoading('장비 사진을 삭제하는 중...');
    // 사진 경로 가져와서 Storage 삭제
    const { data: eq } = await supabaseClient
      .from('equipments').select('photo_path').eq('id', currentEquipmentId).single();
    if (eq && eq.photo_path) {
      await supabaseClient.storage.from('equipment-photos').remove([eq.photo_path]);
    }
    await supabaseClient.from('equipments')
      .update({ photo_url: '', photo_path: '' }).eq('id', currentEquipmentId);

    await loadEquipmentCore(currentEquipmentId, userEmail, { resetSkeleton: false });
    invalidateDashboardSessionCacheSafe();
    showMessage('장비 사진이 삭제되었습니다.', 'success');
  } catch (error) {
    showMessage(error.message || '장비 사진 삭제 중 오류가 발생했습니다.', 'error');
  } finally {
    if (typeof hideGlobalLoading === 'function') {
      hideGlobalLoading();
    }
  }
}

async function deleteCurrentEquipment() {
  if (!detailPermission.canDelete) {
    showMessage('장비를 폐기할 권한이 없습니다.', 'error');
    return;
  }

  if (!currentEquipmentId) {
    showMessage('장비 정보가 없습니다.', 'error');
    return;
  }

  const confirmed = confirm('이 장비를 폐기하시겠습니까? 폐기 후 목록에서 제외됩니다.');
  if (!confirmed) return;

  const user = getCurrentUser();
  const userEmail = (user && user.email) || '';

  try {
    showGlobalLoading('장비를 폐기하는 중...');
    const { error: delErr } = await supabaseClient
      .from('equipments')
      .update({ deleted_yn: 'Y' })
      .eq('id', currentEquipmentId);
    if (delErr) throw new Error(delErr.message);

    invalidateDashboardSessionCacheSafe();
    alert('장비가 폐기되었습니다.');
    parent.shellNavigate?.('equipment/list');
  } catch (error) {
    showMessage(error.message || '장비 폐기 중 오류가 발생했습니다.', 'error');
  } finally {
    if (typeof hideGlobalLoading === 'function') {
      hideGlobalLoading();
    }
  }
}

function bindPhotoActionButtons() {
  const openBtn = qs('#photoOpenBtn');
  const deleteBtn = qs('#photoDeleteBtn');

  if (openBtn) {
    openBtn.onclick = openPhotoInNewWindow;
  }

  if (deleteBtn) {
    deleteBtn.onclick = deleteCurrentPhoto;
  }
}

function renderQrCode(equipmentId) {
  const qrBox = qs('#qrBox');
  const qrText = qs('#qrText');

  if (!qrBox || !qrText) return;

  const qrValue = buildEquipmentDetailUrl(equipmentId);
  qrBox.innerHTML = '';
  qrText.textContent = 'QR 스캔 시 장비 상세 페이지로 이동';
  qrText.title = qrValue;

  if (typeof QRCode === 'function') {
    new QRCode(qrBox, {
      text: qrValue,
      width: 180,
      height: 180
    });
  } else {
    qrBox.innerHTML =
      'QR 라이브러리를 불러오지 못했습니다.<br>아래 링크로 접근하세요.<br>' +
      escapeHtml(qrValue);
  }
}

function renderDetailInfo(item) {
  const detailInfoGrid = qs('#detailInfoGrid');
  if (!detailInfoGrid) return;

  const fields = [
    { label: '장비번호',      value: item.equipment_id },
    { label: '장비명',        value: item.equipment_name },
    { label: '모델명',        value: item.model_name },
    { label: '사용부서',      value: item.department },
    { label: '제조사',        value: item.manufacturer },
    { label: '시리얼번호',    value: item.serial_no },
    { label: '제조일자',      value: formatDisplayDate(item.manufacture_date) },
    { label: '취득일자',      value: formatDisplayDate(item.purchase_date) },
    { label: '구매처',        value: item.vendor },
    { label: '취득가액',      value: safeNumber(item.acquisition_cost) },
    { label: '담당자',        value: item.manager_name },
    { label: '연락처',        value: item.manager_phone },
    { label: '유지보수 종료', value: formatDisplayDate(item.maintenance_end_date) },
    { label: '현재 상태',     value: item.status, isStatus: true },
    { label: '현재 위치',     value: item.location },
    { label: '현재 사용자',   value: item.current_user },
    { label: '등록일시',      value: formatDisplayDateTime(item.created_at) },
    { label: '수정일시',      value: formatDisplayDateTime(item.updated_at) },
    { label: '비고',          value: item.memo || '-', wide: true }
  ];

  function buildInfoCell(field) {
    let valueHtml;
    if (field.isStatus) {
      valueHtml = '<span class="status-badge ' + statusClass(field.value) + '">' +
        escapeHtml(statusLabel(field.value)) + '</span>';
    } else {
      const display = (field.value === null || field.value === undefined || field.value === '')
        ? '-' : field.value;
      valueHtml = nl2br(display);
    }
    return (
      '<div class="info-cell">' +
        '<div class="info-cell-label">' + escapeHtml(field.label) + '</div>' +
        '<div class="info-cell-value">' + valueHtml + '</div>' +
      '</div>'
    );
  }

  // 1단 구성 — 일반 필드는 한 줄씩, 비고는 맨 마지막에 flex:1로 분리
  const normalFields = fields.filter(function(f) { return !f.wide; });
  const wideFields   = fields.filter(function(f) { return f.wide; });

  const rows = [];
  normalFields.forEach(function(f) {
    rows.push('<div class="info-row info-row--single">' + buildInfoCell(f) + '</div>');
  });
  wideFields.forEach(function(f) {
    rows.push('<div class="info-row info-row--wide">' + buildInfoCell(f) + '</div>');
  });

  detailInfoGrid.innerHTML = rows.join('');
}

function buildHistoryActionButtons(item) {
  if (!detailPermission.canEdit) return '';

  // 등록자 본인 또는 admin / isAppAdmin만 수정/완료 처리 가능
  const currentUser = window.auth && typeof window.auth.getSession === 'function'
    ? window.auth.getSession()
    : null;
  const currentEmail = String((currentUser && currentUser.email) || '').trim().toLowerCase();
  const createdBy    = String(item.created_by || '').trim().toLowerCase();
  const isOwner      = currentEmail && createdBy && currentEmail === createdBy;
  const isAdmin      = detailPermission.isAdmin;
  const isAppAdmin   = detailPermission.isAppAdmin;

  if (!isOwner && !isAdmin && !isAppAdmin) return '';

  const buttons = [];
  const historyId  = item.history_id || '';
  const equipmentId = item.equipment_id || currentEquipmentId || '';

  if (String(item.result_status || '') !== 'COMPLETED') {
    buttons.push(
      '<button type="button" class="btn btn-light btn-sm js-edit-history" ' +
        'data-history-id="' + escapeHtml(historyId) + '" ' +
        'data-status="' + escapeHtml(item.result_status) + '">' +
        '수정</button>'
    );
  }

  if (String(item.history_type || '') === 'REPAIR' && String(item.result_status || '') === 'IN_PROGRESS') {
    buttons.push(
      '<button type="button" class="btn btn-primary btn-sm js-complete-history" data-history-id="' +
        escapeHtml(historyId) +
        '" data-equipment-id="' +
        escapeHtml(equipmentId) +
        '">완료 처리</button>'
    );
  }

  return buttons.length
    ? '<div class="timeline-actions">' + buttons.join('') + '</div>'
    : '';
}

function renderHistories(items) {
  const area = qs('#historyArea');
  const countText = qs('#historyCountText');
  const list = Array.isArray(items) ? items : [];

  if (countText) countText.textContent = formatNumber(list.length) + '건';
  if (!area) return;

  if (!list.length) {
    area.innerHTML = '<div class="empty-box">등록된 이력이 없습니다.</div>';
    return;
  }

  const hasAction = detailPermission.canEdit;

  const rows = list.map(function(item) {
    const actionBtns = buildHistoryActionButtons(item);
    const typeLabel   = escapeHtml(historyTypeLabel(item.history_type));
    const dateLabel   = safeValue(formatDisplayDate(item.work_date));
    const statusBadge = '<span class="timeline-badge ' + ResultStatusClass(item.result_status) + '">' +
      escapeHtml(resultStatusLabel(item.result_status)) + '</span>';
    const desc = escapeHtml(item.description || '-');

    return (
      '<tr class="sec-tbl-row">' +
        '<td class="sec-tbl-cell" style="white-space:nowrap;font-size:11px;color:#6b7280;">' + dateLabel + '</td>' +
        '<td class="sec-tbl-cell sec-tbl-cell--left">' +
          '<span class="sec-tbl-main">' + typeLabel + '</span>' +
        '</td>' +
        '<td class="sec-tbl-cell sec-tbl-cell--center">' + statusBadge + '</td>' +
        '<td class="sec-tbl-cell sec-tbl-cell--grow">' + desc + '</td>' +
        (hasAction ? '<td class="sec-tbl-cell sec-tbl-cell--action">' +
          (actionBtns || (String(item.result_status) === 'COMPLETED'
            ? '<span class="timeline-badge badge-green" style="font-size:10px;">완료</span>'
            : '')) +
        '</td>' : '') +
      '</tr>'
    );
  }).join('');

  area.innerHTML =
    '<table class="sec-tbl">' +
      '<thead class="sec-tbl-head"><tr>' +
        '<th class="sec-tbl-th" style="width:76px">날짜</th>' +
        '<th class="sec-tbl-th" style="width:70px">구분</th>' +
        '<th class="sec-tbl-th sec-tbl-th--center" style="width:60px">상태</th>' +
        '<th class="sec-tbl-th">내용</th>' +
        (hasAction ? '<th class="sec-tbl-th sec-tbl-th--center" style="width:72px">처리</th>' : '') +
      '</tr></thead>' +
      '<tbody>' + rows + '</tbody>' +
    '</table>';

  bindHistoryActionButtons();
}

function renderInventoryLogs(items) {
  const area = qs('#inventoryArea');
  const countText = qs('#inventoryCountText');
  const list = Array.isArray(items) ? items : [];

  if (countText) countText.textContent = formatNumber(list.length) + '건';
  if (!area) return;

  if (!list.length) {
    area.innerHTML = '<div class="empty-box">등록된 재고조사 이력이 없습니다.</div>';
    return;
  }

  const rows = list.map(function(item) {
    const statusLabel = escapeHtml(conditionStatusLabel(item.condition_status));
    const dateLabel   = safeValue(formatDisplayDate(item.checked_at));
    const checker     = escapeHtml(item.checked_by_name || item.checked_by || '-');
    const dept        = escapeHtml(item.department_at_check || '-');
    const qrYn        = item.qr_scan_yn === 'Y' ? '✓' : '-';

    return (
      '<tr class="sec-tbl-row">' +
        '<td class="sec-tbl-cell" style="white-space:nowrap;font-size:11px;color:#6b7280;">' + dateLabel + '</td>' +
        '<td class="sec-tbl-cell sec-tbl-cell--center">' +
          '<span class="sec-tbl-main" style="font-size:12px;">' + statusLabel + '</span>' +
        '</td>' +
        '<td class="sec-tbl-cell sec-tbl-cell--center">' + checker + '</td>' +
        '<td class="sec-tbl-cell sec-tbl-cell--grow">' + dept + '</td>' +
        '<td class="sec-tbl-cell sec-tbl-cell--center">' + qrYn + '</td>' +
      '</tr>'
    );
  }).join('');

  area.innerHTML =
    '<table class="sec-tbl">' +
      '<thead class="sec-tbl-head"><tr>' +
        '<th class="sec-tbl-th" style="width:76px">날짜</th>' +
        '<th class="sec-tbl-th sec-tbl-th--center" style="width:60px">상태</th>' +
        '<th class="sec-tbl-th sec-tbl-th--center" style="width:64px">점검자</th>' +
        '<th class="sec-tbl-th">부서</th>' +
        '<th class="sec-tbl-th sec-tbl-th--center" style="width:36px">QR</th>' +
      '</tr></thead>' +
      '<tbody>' + rows + '</tbody>' +
    '</table>';
}

async function loadHistorySection(equipmentId, userEmail) {
  try {
    renderSectionLoading('#historyArea', '#historyCountText');

    const { data: histRows, error: histErr } = await supabaseClient
      .from('histories')
      .select('*')
      .eq('equipment_id', equipmentId)
      .order('work_date', { ascending: false });
    if (histErr) throw new Error(histErr.message);
    renderHistories(histRows || []);
  } catch (error) {
    renderSectionError('#historyArea', '#historyCountText', error.message || '이력 정보를 불러오지 못했습니다.');
  }
}

async function loadInventorySection(equipmentId, userEmail) {
  try {
    renderSectionLoading('#inventoryArea', '#inventoryCountText');

    const { data: invRows, error: invErr } = await supabaseClient
      .from('inventory_logs')
      .select('*')
      .eq('equipment_id', equipmentId)
      .order('checked_at', { ascending: false });
    if (invErr) throw new Error(invErr.message);
    renderInventoryLogs(invRows || []);
  } catch (error) {
    renderSectionError('#inventoryArea', '#inventoryCountText', error.message || '재고조사 이력을 불러오지 못했습니다.');
  }
}

async function loadEquipmentCore(equipmentId, userEmail, options) {
  const opts = options || {};
  const shouldResetSkeleton = opts.resetSkeleton === true;

  if (shouldResetSkeleton) {
    renderDetailSkeleton();
  }

  const { data: eqData, error: eqErr } = await supabaseClient
    .from('equipments')
    .select('*')
    .eq('id', equipmentId)
    .single();
  if (eqErr) throw new Error(eqErr.message);

  // equipment_id 호환 (ME-2026-0001)
  if (eqData) eqData.equipment_id = eqData.equipment_no || eqData.id;
  currentEquipmentData = eqData || {};

  renderHero(currentEquipmentData);
  renderPhoto(currentEquipmentData);
  renderDetailInfo(currentEquipmentData);
  renderQrCode(currentEquipmentData.equipment_id);
  applyActionVisibility();
  bindPhotoActionButtons();

  return currentEquipmentData;
}

async function reloadDetailSectionsOnly() {
  const user = getCurrentUser();
  const userEmail = (user && user.email) || '';
  if (!currentEquipmentId || !userEmail) return;

  await Promise.all([
    loadHistorySection(currentEquipmentId, userEmail),
    loadInventorySection(currentEquipmentId, userEmail)
  ]);
}

async function loadEquipmentDetail(options) {
  const opts = options || {};
  const forceReset = opts.forceReset === true;

  clearMessage();

  if (forceReset) {
    renderDetailSkeleton();
  }

  renderSectionLoading('#historyArea', '#historyCountText');
  renderSectionLoading('#inventoryArea', '#inventoryCountText');

  const id = getQueryParam('id') || currentEquipmentId;
  currentEquipmentId = id;

  if (!id) {
    throw new Error('장비 ID가 없습니다.');
  }

  const user = getCurrentUser();
  const userEmail = (user && user.email) || '';

  await loadEquipmentCore(id, userEmail, {
    resetSkeleton: forceReset
  });

  await Promise.all([
    loadHistorySection(id, userEmail),
    loadInventorySection(id, userEmail)
  ]);
}

function bindHistoryActionButtons() {
  document.querySelectorAll('.js-edit-history').forEach(function(btn) {
    btn.addEventListener('click', function() {
      const historyId = this.getAttribute('data-history-id');
      const status = this.getAttribute('data-status');
  
      if (!historyId) return;
  
      if (status === 'COMPLETED') {
        alert('완료된 이력은 수정할 수 없습니다.');
        return;
      }
  
      openHistoryModal(historyId);
    });
  });

  document.querySelectorAll('.js-complete-history').forEach(function(btn) {
    btn.addEventListener('click', function() {
      const historyId = this.getAttribute('data-history-id');
      const equipmentId = this.getAttribute('data-equipment-id') || currentEquipmentId;
      if (!historyId || !equipmentId) return;
      completeRepairHistory(historyId, equipmentId);
    });
  });
}

async function completeRepairHistory(historyId, equipmentId) {
  if (!detailPermission.canEdit) return;

  const confirmed = confirm('이 수리 이력을 완료 처리하시겠습니까? 장비 상태도 사용중으로 변경됩니다.');
  if (!confirmed) return;

  const user = getCurrentUser();
  const userEmail = (user && user.email) || '';

  try {
    showGlobalLoading('수리 이력을 완료 처리하는 중...');
    const { error: uhErr } = await supabaseClient
      .from('histories')
      .update({ result_status: 'COMPLETED' })
      .eq('id', historyId);
    if (uhErr) throw new Error(uhErr.message);
    // 장비 상태도 IN_USE로 업데이트
    await supabaseClient.from('equipments')
      .update({ status: 'IN_USE' }).eq('id', equipmentId);

    await loadEquipmentCore(currentEquipmentId, userEmail, { resetSkeleton: false });
    await reloadDetailSectionsOnly();
    invalidateDashboardSessionCacheSafe();
    alert('완료 처리되었습니다.');
  } catch (error) {
    showMessage(error.message || '완료 처리 중 오류가 발생했습니다.', 'error');
  } finally {
    if (typeof hideGlobalLoading === 'function') {
      hideGlobalLoading();
    }
  }
}

document.addEventListener('DOMContentLoaded', async function() {
  const user = await initCurrentUser();
  if (!user) return;

  try {
    if (typeof showGlobalLoading === 'function') {
      showGlobalLoading('상세 정보를 불러오는 중...');
    }

    detailPermission = await getEquipmentPermissionContext();

    if (!detailPermission.canView) {
      showMessage('장비 정보를 조회할 권한이 없습니다.', 'error');
      applyActionVisibility();
      return;
    }

    await loadEquipmentDetail({ forceReset: true });

    const backBtn = qs('#backToListBtn');
    if (backBtn) {
      backBtn.addEventListener('click', function() {
        parent.shellNavigate?.('equipment/list');
      });
    }

    const editBtn = qs('#editEquipmentBtn');
    if (editBtn) {
      editBtn.addEventListener('click', function() {
        parent.shellNavigate?.('equipment/form?id=' + currentEquipmentId);
      });
    }

    const addHistoryBtn = qs('#addHistoryBtn');
    if (addHistoryBtn) {
      addHistoryBtn.addEventListener('click', function() {
        openHistoryModal(null);
      });
    }

    const addInventoryBtn = qs('#addInventoryBtn');
    if (addInventoryBtn) {
      addInventoryBtn.addEventListener('click', function() {
        openInventoryModal();
      });
    }

    const deleteBtn = qs('#deleteBtn');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', function() {
        deleteCurrentEquipment();
      });
    }

    const printLabelBtn = qs('#printLabelBtn');
    if (printLabelBtn) {
      printLabelBtn.addEventListener('click', function() {
        openLabelModal(currentEquipmentId);
      });
    }

    const inspectionCertBtn = qs('#inspectionCertBtn');
    if (inspectionCertBtn) {
      inspectionCertBtn.addEventListener('click', function() {
        if (typeof generateInspectionCertPDF === 'function' && currentEquipmentData) {
          generateInspectionCertPDF(currentEquipmentData);
        }
      });
    }
  } catch (error) {
    showMessage(error.message || '상세 정보를 불러오지 못했습니다.', 'error');
  } finally {
    if (typeof hideGlobalLoading === 'function') {
      hideGlobalLoading();
    }
  }
});


// ================================================================
// 이력 모달
// ================================================================

var _historyModalMode = 'create'; // 'create' | 'edit'
var _historyModalId   = null;
var _historyModalData = null;

function openHistoryModal(historyId) {
  _historyModalMode = historyId ? 'edit' : 'create';
  _historyModalId   = historyId || null;
  _historyModalData = null;

  var modal = qs('#historyModal');
  var title = qs('#historyModalTitle');
  var submitBtn = qs('#historyModalSubmit');

  if (title) title.textContent = _historyModalMode === 'edit' ? '수리 / 점검 이력 수정' : '수리 / 점검 이력 등록';
  if (submitBtn) submitBtn.textContent = _historyModalMode === 'edit' ? '수정 저장' : '저장';

  // 폼 초기화
  historyModalSetField('m_history_type', '');
  historyModalSetField('m_work_date', todayYmd());
  historyModalSetField('m_requester', '');
  historyModalSetField('m_vendor_name', '');
  historyModalSetField('m_amount', '');
  historyModalSetField('m_result_status', '');
  historyModalSetField('m_update_equipment_status', '');
  historyModalSetField('m_description', '');
  historyModalHideMsg();

  if (modal) {
    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
  }

  if (_historyModalMode === 'edit' && historyId) {
    loadHistoryForModal(historyId);
  }
}

function closeHistoryModal() {
  var modal = qs('#historyModal');
  if (modal) {
    modal.classList.remove('is-open');
    if (modal.contains(document.activeElement)) document.body.focus();
    modal.setAttribute('aria-hidden', 'true');
  }
}

async function loadHistoryForModal(historyId) {
  var user = getCurrentUser();
  try {
    showGlobalLoading('이력 정보를 불러오는 중...');
    const { data: hItem, error: hErr } = await supabaseClient
      .from('histories').select('*').eq('id', historyId).single();
    if (hErr) throw new Error(hErr.message);
    var item = hItem || {};
    _historyModalData = item;
    historyModalSetField('m_history_type', item.history_type || '');
    historyModalSetField('m_work_date', item.work_date || '');
    historyModalSetField('m_requester', item.requester || '');
    historyModalSetField('m_vendor_name', item.vendor_name || '');
    historyModalSetField('m_amount', item.amount ? String(item.amount).replace(/\B(?=(\d{3})+(?!\d))/g, ',') : '');
    historyModalSetField('m_result_status', item.result_status || '');
    historyModalSetField('m_description', item.description || '');
  } catch(e) {
    historyModalShowMsg(e.message || '이력 정보를 불러오지 못했습니다.', 'error');
  } finally {
    hideGlobalLoading();
  }
}

async function submitHistoryModal() {
  historyModalHideMsg();

  var historyType = historyModalGetField('m_history_type');
  var workDate    = historyModalGetField('m_work_date');
  var description = historyModalGetField('m_description');

  if (!historyType)  { historyModalShowMsg('이력 유형을 선택하세요.', 'error'); return; }
  if (!workDate)     { historyModalShowMsg('처리일자를 입력하세요.', 'error'); return; }
  if (!description)  { historyModalShowMsg('처리내용을 입력하세요.', 'error'); return; }

  var user = getCurrentUser();
  var actor = user && (user.email || user.user_email) || '';

  var equipment = currentEquipmentData || {};
  var updateEquipmentStatus = historyModalGetField('m_update_equipment_status');

  var payload = {
    equipment_id:   currentEquipmentId,
    history_type:   historyType,
    work_date:      workDate,
    requester:      historyModalGetField('m_requester'),
    vendor_name:    historyModalGetField('m_vendor_name'),
    amount:         historyModalGetField('m_amount').replace(/[^\d.-]/g, '') || null,
    result_status:  historyModalGetField('m_result_status'),
    description:    description,
    created_by:     actor,
    request_clinic_code: equipment.clinic_code || '',
    request_clinic_name: equipment.clinic_name || '',
    request_team_code:   equipment.team_code   || '',
    request_team_name:   equipment.team_name   || '',
    request_department:  equipment.department_display || equipment.department || ''
  };

  // edit 모드: id는 .eq() 조건으로 처리, payload에 불필요한 컬럼 없음

  var submitBtn = qs('#historyModalSubmit');
  try {
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = '저장 중...'; }
    showGlobalLoading(_historyModalMode === 'edit' ? '이력을 수정하는 중...' : '이력을 저장하는 중...');

    if (_historyModalMode === 'edit' && _historyModalId) {
      const { error: e } = await supabaseClient
        .from('histories').update(payload).eq('id', _historyModalId);
      if (e) throw new Error(e.message);
    } else {
      const { data: { session } } = await supabaseClient.auth.getSession();
      payload.created_by = session?.user?.id || null;
      const { error: e } = await supabaseClient
        .from('histories').insert(payload);
      if (e) throw new Error(e.message);
    }

    closeHistoryModal();
    var user2 = getCurrentUser();
    var email2 = user2 && (user2.email || user2.user_email) || '';
    await loadHistorySection(currentEquipmentId, email2);
    if (updateEquipmentStatus) {
      await supabaseClient
        .from('equipments')
        .update({ status: updateEquipmentStatus })
        .eq('id', currentEquipmentId);
      await loadEquipmentCore(currentEquipmentId, email2, { resetSkeleton: false });
    }
  } catch(e) {
    historyModalShowMsg(e.message || '저장 중 오류가 발생했습니다.', 'error');
  } finally {
    hideGlobalLoading();
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = _historyModalMode === 'edit' ? '수정 저장' : '저장';
    }
  }
}

function historyModalSetField(id, val) {
  var el = qs('#' + id);
  if (el) el.value = val;
}
function historyModalGetField(id) {
  var el = qs('#' + id);
  return el ? el.value.trim() : '';
}
function historyModalShowMsg(msg, type) {
  var el = qs('#historyModalMsg');
  if (!el) return;
  el.textContent = msg;
  el.className = 'det-modal-msg det-modal-msg--' + (type || 'error');
  el.style.display = '';
}
function historyModalHideMsg() {
  var el = qs('#historyModalMsg');
  if (el) { el.style.display = 'none'; el.textContent = ''; }
}

// 로컬 날짜 헬퍼
function todayYmd() {
  var d = new Date();
  return d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
}

// ================================================================
// 재고조사 모달
// ================================================================

function openInventoryModal() {
  var modal = qs('#inventoryModal');
  var user = getCurrentUser();

  // 폼 초기화
  inventoryModalSetField('m_checked_at', getNowDateTime());
  inventoryModalSetField('m_checked_by', (user && (user.name || user.user_name)) || '');
  inventoryModalSetField('m_condition_status', '');
  inventoryModalSetField('m_qr_scan_yn', 'Y');
  inventoryModalSetField('m_memo', '');
  inventoryModalHideMsg();

  if (modal) {
    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
  }
}

function closeInventoryModal() {
  var modal = qs('#inventoryModal');
  if (modal) {
    modal.classList.remove('is-open');
    if (modal.contains(document.activeElement)) document.body.focus();
    modal.setAttribute('aria-hidden', 'true');
  }
}

async function submitInventoryModal() {
  inventoryModalHideMsg();

  var conditionStatus = inventoryModalGetField('m_condition_status');
  var checkedBy       = inventoryModalGetField('m_checked_by');

  if (!conditionStatus) { inventoryModalShowMsg('상태를 선택하세요.', 'error'); return; }
  if (!checkedBy)       { inventoryModalShowMsg('점검자를 입력하세요.', 'error'); return; }

  var user = getCurrentUser();
  var equipment = currentEquipmentData || {};

  var payload = {
    equipment_id:          currentEquipmentId,
    checked_at:            inventoryModalGetField('m_checked_at') || new Date().toISOString(),
    checked_by_name:       checkedBy,
    clinic_code_at_check:  equipment.clinic_code || '',
    clinic_name_at_check:  equipment.clinic_name || '',
    team_code_at_check:    equipment.team_code   || '',
    team_name_at_check:    equipment.team_name   || '',
    department_at_check:   equipment.department_display || equipment.department || '',
    location_at_check:     equipment.location || '',
    status_at_check:       conditionStatus,
    memo:                  inventoryModalGetField('m_memo')
  };

  var submitBtn = qs('#inventoryModalSubmit');
  try {
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = '저장 중...'; }
    showGlobalLoading('재고조사 이력을 저장하는 중...');

    const { data: { session: invSession } } = await supabaseClient.auth.getSession();
    payload.created_by = invSession?.user?.id || null;
    const { error: ilErr } = await supabaseClient
      .from('inventory_logs').insert(payload);
    if (ilErr) throw new Error(ilErr.message);

    closeInventoryModal();
    var user2 = getCurrentUser();
    var email2 = user2 && (user2.email || user2.user_email) || '';
    await loadInventorySection(currentEquipmentId, email2);
  } catch(e) {
    inventoryModalShowMsg(e.message || '저장 중 오류가 발생했습니다.', 'error');
  } finally {
    hideGlobalLoading();
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = '저장'; }
  }
}

function inventoryModalSetField(id, val) {
  var el = qs('#' + id);
  if (el) el.value = val;
}
function inventoryModalGetField(id) {
  var el = qs('#' + id);
  return el ? el.value.trim() : '';
}
function inventoryModalShowMsg(msg, type) {
  var el = qs('#inventoryModalMsg');
  if (!el) return;
  el.textContent = msg;
  el.className = 'det-modal-msg det-modal-msg--' + (type || 'error');
  el.style.display = '';
}
function inventoryModalHideMsg() {
  var el = qs('#inventoryModalMsg');
  if (el) { el.style.display = 'none'; el.textContent = ''; }
}

function getNowDateTime() {
  var now = new Date();
  return now.getFullYear() + '-' +
    String(now.getMonth() + 1).padStart(2, '0') + '-' +
    String(now.getDate()).padStart(2, '0') + ' ' +
    String(now.getHours()).padStart(2, '0') + ':' +
    String(now.getMinutes()).padStart(2, '0') + ':' +
    String(now.getSeconds()).padStart(2, '0');
}

// ================================================================
// 모달 이벤트 바인딩
// ================================================================

document.addEventListener('DOMContentLoaded', function() {
  // 이력 모달
  var hClose   = qs('#historyModalClose');
  var hCancel  = qs('#historyModalCancel');
  var hSubmit  = qs('#historyModalSubmit');
  var hBackdrop = qs('#historyModal .det-modal-backdrop');

  if (hClose)   hClose.addEventListener('click', closeHistoryModal);
  if (hCancel)  hCancel.addEventListener('click', closeHistoryModal);
  if (hSubmit)  hSubmit.addEventListener('click', submitHistoryModal);
  if (hBackdrop) hBackdrop.addEventListener('click', closeHistoryModal);

  // 금액 콤마 포맷
  var amountEl = qs('#m_amount');
  if (amountEl) {
    amountEl.addEventListener('input', function() {
      var raw = this.value.replace(/[^\d]/g, '');
      this.value = raw ? raw.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : '';
    });
  }

  // 재고조사 모달
  var iClose    = qs('#inventoryModalClose');
  var iCancel   = qs('#inventoryModalCancel');
  var iSubmit   = qs('#inventoryModalSubmit');
  var iBackdrop = qs('#inventoryModal .det-modal-backdrop');

  if (iClose)    iClose.addEventListener('click', closeInventoryModal);
  if (iCancel)   iCancel.addEventListener('click', closeInventoryModal);
  if (iSubmit)   iSubmit.addEventListener('click', submitInventoryModal);
  if (iBackdrop) iBackdrop.addEventListener('click', closeInventoryModal);
});


// ================================================================
// 라벨 출력 모달
// ================================================================

var _labelModalQrRendered = false;

function openLabelModal(equipmentId) {
  var modal   = qs('#labelModal');
  var data    = currentEquipmentData || {};

  // 필드 채우기
  setText('lm_equipment_name', data.equipment_name || '-');
  setText('lm_equipment_id',   data.equipment_id   || equipmentId || '-');
  setText('lm_model_name',     data.model_name     || '-');
  setText('lm_department',     data.department     || '-');
  setText('lm_location',       data.location       || '-');

  // 크기 초기화
  var sizeSelect = qs('#labelModalSizeSelect');
  if (sizeSelect) sizeSelect.value = 'size-90x48';
  _labelModalQrRendered = false;
  labelModalApplySize('size-90x48', equipmentId);

  if (modal) {
    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
  }
}

function closeLabelModal() {
  var modal = qs('#labelModal');
  if (modal) {
    modal.classList.remove('is-open');
    if (modal.contains(document.activeElement)) document.body.focus();
    modal.setAttribute('aria-hidden', 'true');
  }
}

function labelModalApplySize(sizeClass, equipmentId) {
  var label = qs('#labelModalDevice');
  if (label) {
    label.classList.remove('size-90x48', 'size-70x40', 'size-50x30');
    label.classList.add(sizeClass);
  }

  // 행 표시 제어
  var rowModel = qs('#lm_row_model');
  var rowDept  = qs('#lm_row_dept');
  var rowLoc   = qs('#lm_row_loc');
  if (rowModel) rowModel.style.display = sizeClass === 'size-50x30' ? 'none' : '';
  if (rowDept)  rowDept.style.display  = sizeClass === 'size-50x30' ? 'none' : '';
  if (rowLoc)   rowLoc.style.display   = (sizeClass === 'size-70x40' || sizeClass === 'size-50x30') ? 'none' : '';

  // QR 렌더링
  var qrEl = qs('#lm_qr');
  if (!qrEl) return;
  qrEl.innerHTML = '';

  var id  = equipmentId || currentEquipmentId;
  var url = (typeof CONFIG !== 'undefined' ? CONFIG.SITE_BASE_URL : '') +
            '/pages/equipment/public-detail.html?id=' + encodeURIComponent(id);
  var qrSize = sizeClass === 'size-70x40' ? 64 : sizeClass === 'size-50x30' ? 48 : 84;

  if (typeof QRCode !== 'undefined' && id) {
    new QRCode(qrEl, { text: url, width: qrSize, height: qrSize });
  }
}

function setText(id, val) {
  var el = qs('#' + id);
  if (el) el.textContent = val;
}

// 모달 이벤트 바인딩 (DOMContentLoaded에 추가)
document.addEventListener('DOMContentLoaded', function() {
  var lClose   = qs('#labelModalClose');
  var lBackdrop = qs('#labelModal .det-modal-backdrop');
  var lPrint   = qs('#labelModalPrintBtn');
  var lSize    = qs('#labelModalSizeSelect');

  if (lClose)    lClose.addEventListener('click', closeLabelModal);
  if (lBackdrop) lBackdrop.addEventListener('click', closeLabelModal);

  if (lSize) {
    lSize.addEventListener('change', function() {
      labelModalApplySize(this.value, currentEquipmentId);
    });
  }

  if (lPrint) {
    lPrint.addEventListener('click', function() {
      window.print();
    });
  }
});
