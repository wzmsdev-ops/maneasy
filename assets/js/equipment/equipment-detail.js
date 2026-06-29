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
  if (inspectionCertBtn) inspectionCertBtn.style.display = 'none'; // 미사용

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
  window._currentEquipment = currentEquipmentData; // QC 패널에서 참조

  // 정도관리 탭 활성화/비활성화
  var qcTab = document.getElementById('detTabQc');
  if (qcTab) qcTab.disabled = !currentEquipmentData.qc_enabled;

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

/* ══════════════════════════════════════════════
   탭 전환
══════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', function() {
  document.querySelectorAll('.det-tabs .tab-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      if (btn.disabled) return;
      var tab = btn.dataset.tab;
      document.querySelectorAll('.det-tabs .tab-btn').forEach(function(b) { b.classList.remove('active'); });
      document.querySelectorAll('.det-tab-panel').forEach(function(p) { p.classList.remove('active'); });
      btn.classList.add('active');
      var panel = document.getElementById('detPanel-' + tab);
      if (panel) panel.classList.add('active');
      if (tab === 'qc') initQcPanel();
    });
  });
});

/* ══════════════════════════════════════════════
   정도관리 — 2열 레이아웃
   좌: 검사항목 목록
   우: 항목 정보 바 + (편집 폼) + 측정그리드 + L-J 차트
══════════════════════════════════════════════ */
var _qcEqId      = null;
var _qcItems     = [];
var _selItem     = null;
var _qcMode      = 'view'; // 'view' | 'edit' | 'new'
var _qcGrid      = null;   // 측정 데이터 그리드 (단 1개)
var _qcInited    = false;

function _qcEsc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;'); }

/* ── 초기화 ──────────────────────────────────── */
function initQcPanel() {
  if (_qcInited) return;
  _qcInited = true;
  var eq = window._currentEquipment;
  if (!eq) return;
  _qcEqId = eq.id;

  var disabled  = document.getElementById('detQcDisabled');
  var qcContent = document.getElementById('detQcContent');

  if (!eq.qc_enabled) {
    if (disabled)  disabled.style.display  = '';
    if (qcContent) qcContent.style.display = 'none';
    var enableBtn = document.getElementById('detQcEnableBtn');
    if (enableBtn) enableBtn.addEventListener('click', async function() {
      await supabaseClient.from('equipments').update({ qc_enabled: true }).eq('id', eq.id);
      eq.qc_enabled = true;
      window._currentEquipment.qc_enabled = true;
      disabled.style.display  = 'none';
      qcContent.style.display = 'flex';
      document.getElementById('detTabQc').disabled = false;
      _loadItems();
    });
    return;
  }

  if (disabled)  disabled.style.display  = 'none';
  if (qcContent) qcContent.style.display = 'flex';

  document.getElementById('addQcItemBtn').addEventListener('click', _startNew);
  document.getElementById('addLjEntryBtn').addEventListener('click', _addRow);

  // 측정 데이터 조회 날짜 기본값 — 오늘부터 한 달 전까지
  var today = new Date();
  var monthAgo = new Date(today);
  monthAgo.setMonth(today.getMonth() - 1);
  var qFrom = document.getElementById('qcDateFrom');
  var qTo   = document.getElementById('qcDateTo');
  if (qFrom) qFrom.value = monthAgo.toISOString().slice(0,10);
  if (qTo)   qTo.value   = today.toISOString().slice(0,10);
  document.getElementById('qcDateSearchBtn')?.addEventListener('click', function() { _loadEntries(); });

  // 측정 데이터 그리드 딱 한 번만 생성
  _initEntryGrid();
  _loadItems();
}

/* ── 1열: 검사항목 목록 ─────────────────────── */
async function _loadItems() {
  var { data } = await supabaseClient.from('lj_items').select('*')
    .eq('equipment_id', _qcEqId).order('created_at', { ascending: true });
  _qcItems = data || [];
  var cnt = document.getElementById('qcItemCountText');
  if (cnt) cnt.textContent = _qcItems.length ? _qcItems.length + '건' : '';
  _renderList();
}

function _renderList() {
  var el = document.getElementById('qcItemList');
  if (!el) return;
  if (!_qcItems.length) {
    el.innerHTML = '<div style="padding:20px 12px;text-align:center;color:#9ca3af;font-size:11px;line-height:1.7;">등록된 검사항목이 없습니다.<br>+ 추가 버튼을 눌러<br>항목을 등록하세요.</div>';
    return;
  }
  el.innerHTML = _qcItems.map(function(item) {
    var sel = _selItem && _selItem.id === item.id;
    var isQ = item.item_type === 'quantitative';
    return '<div onclick="window._selectItem(\'' + item.id + '\')" style="' +
      'padding:10px 12px;cursor:pointer;border-bottom:1px solid #e5e7eb;' +
      'border-left:3px solid ' + (sel ? '#2563eb' : 'transparent') + ';' +
      'background:' + (sel ? '#eff6ff' : '#f8fafc') + ';' +
      'transition:background 0.1s;">' +
      '<div style="font-size:12px;font-weight:600;color:#111827;margin-bottom:2px;">' + _qcEsc(item.item_name) + '</div>' +
      '<div style="font-size:10px;color:#9ca3af;">' +
        (isQ ? '정량' : '정성') +
        (item.unit ? ' · ' + _qcEsc(item.unit) : '') +
        (isQ && item.mean != null ? ' · Mean ' + Number(item.mean).toFixed(item.decimal_places||2) : '') +
      '</div>' +
    '</div>';
  }).join('');
}

window._selectItem = function(id) {
  _selItem = _qcItems.find(function(i) { return i.id === id; }) || null;
  _qcMode  = 'view';
  _renderList();
  _renderBar();
  _loadEntries();
};

/* ── 우: 항목 정보 바 & 편집 폼 ──────────────── */
function _renderBar() {
  var noSel = document.getElementById('detQcNoSelect');
  var selEl = document.getElementById('detQcSelected');
  var formWrap = document.getElementById('qcItemFormWrap');

  if (!_selItem && _qcMode !== 'new') {
    if (noSel) noSel.style.display = 'flex';
    if (selEl) selEl.style.display = 'none';
    return;
  }
  if (noSel) noSel.style.display = 'none';
  if (selEl) selEl.style.display = 'flex';

  var isEdit = (_qcMode === 'edit' || _qcMode === 'new');
  if (formWrap) formWrap.style.display = isEdit ? '' : 'none';

  // 항목 정보 바
  var barName = document.getElementById('qcBarName');
  var barMeta = document.getElementById('qcBarMeta');
  var editBtn = document.getElementById('qcItemEditBtn');
  var delBtn  = document.getElementById('qcItemDeleteBtn');

  if (_qcMode === 'new') {
    if (barName) barName.textContent = '새 검사항목';
    if (barMeta) barMeta.textContent = '';
    if (editBtn) editBtn.style.display = 'none';
    if (delBtn)  delBtn.style.display  = 'none';
  } else {
    var item = _selItem;
    var isQ  = item.item_type === 'quantitative';
    var dec  = item.decimal_places || 2;
    var meta = isQ ? '정량' : '정성';
    if (item.unit) meta += ' · ' + item.unit;
    if (isQ && item.mean != null && item.sd != null)
      meta += ' · Mean ' + Number(item.mean).toFixed(dec) + ' ± SD ' + Number(item.sd).toFixed(dec);
    if (barName) barName.textContent = item.item_name;
    if (barMeta) barMeta.textContent = meta;
    if (editBtn) editBtn.style.display = isEdit ? 'none' : '';
    if (delBtn)  delBtn.style.display  = isEdit ? 'none' : '';
  }

  // 편집 폼
  if (isEdit) _renderForm();
}

function _renderForm() {
  var body = document.getElementById('qcItemFormBody');
  if (!body) return;
  var item = _selItem || {};
  var isQ  = (item.item_type || 'quantitative') === 'quantitative';

  function inp(label, id, val, type, extra) {
    return '<div><div style="font-size:10px;color:#9ca3af;margin-bottom:3px;font-weight:600;">' + label + '</div>' +
      '<input id="' + id + '" type="' + (type||'text') + '" class="input" style="height:28px;font-size:11px;" value="' + _qcEsc(val??'') + '" ' + (extra||'') + '/></div>';
  }
  function sel(label, id, opts, selected, onchange) {
    return '<div><div style="font-size:10px;color:#9ca3af;margin-bottom:3px;font-weight:600;">' + label + '</div>' +
      '<select id="' + id + '" class="input" style="height:28px;font-size:11px;" onchange="' + (onchange||'') + '">' +
      opts.map(function(o){ return '<option value="'+o[0]+'"'+(o[0]===selected?' selected':'')+'>'+o[1]+'</option>'; }).join('') +
      '</select></div>';
  }

  body.innerHTML =
    inp('항목명 *', 'qf_name', item.item_name, 'text', 'placeholder="예: Glucose"') +
    sel('유형', 'qf_type', [['quantitative','정량'],['qualitative','정성']], item.item_type||'quantitative', 'window._onQfType()') +
    inp('단위', 'qf_unit', item.unit, 'text', 'placeholder="mg/dL"') +
    '<div id="qf_q" style="display:' + (isQ?'contents':'none') + '">' +
      inp('Mean', 'qf_mean', item.mean, 'number', 'step="any" placeholder="0.00"') +
      inp('SD',   'qf_sd',   item.sd,   'number', 'step="any" placeholder="0.00"') +
      inp('소수점', 'qf_dec', item.decimal_places??2, 'number', 'min="0" max="6" style="height:28px;font-size:11px;width:80px;"') +
    '</div>' +
    '<div id="qf_l" style="display:' + (!isQ?'contents':'none') + '">' +
      inp('선택지(쉼표)', 'qf_preset', item.preset, 'text', 'placeholder="양성,음성"') +
      inp('예상값', 'qf_expected', item.expected_value, 'text', 'placeholder="음성"') +
    '</div>' +
    inp('메모', 'qf_memo', item.memo);
}

window._onQfType = function() {
  var t = document.getElementById('qf_type')?.value;
  var q = document.getElementById('qf_q');
  var l = document.getElementById('qf_l');
  if (q) q.style.display = t === 'quantitative' ? 'contents' : 'none';
  if (l) l.style.display = t === 'qualitative'  ? 'contents' : 'none';
};

function _startNew() {
  _selItem = null;
  _qcMode  = 'new';
  _renderList();
  _renderBar();
  if (_qcGrid) _qcGrid.setGridOption('rowData', []);
  var wrap = document.getElementById('ljChartWrap');
  if (wrap) wrap.innerHTML = '';
}

function editQcItem() { _qcMode = 'edit'; _renderBar(); }
window.editQcItem = editQcItem;

function cancelQcItem() {
  _qcMode = _selItem ? 'view' : null;
  if (!_selItem) {
    document.getElementById('detQcNoSelect').style.display = 'flex';
    document.getElementById('detQcSelected').style.display = 'none';
  } else { _renderBar(); }
}
window.cancelQcItem = cancelQcItem;

async function saveQcItem() {
  var name = document.getElementById('qf_name')?.value.trim();
  if (!name) { showMessage('항목명을 입력해 주세요.', 'warning'); return; }
  var type = document.getElementById('qf_type')?.value || 'quantitative';
  var isQ  = type === 'quantitative';
  var payload = {
    equipment_id:   _qcEqId,
    item_name:      name,
    item_type:      type,
    unit:           document.getElementById('qf_unit')?.value.trim() || '',
    memo:           document.getElementById('qf_memo')?.value.trim() || '',
    decimal_places: parseInt(document.getElementById('qf_dec')?.value) || 2,
    mean:    isQ ? (parseFloat(document.getElementById('qf_mean')?.value)||null)    : null,
    sd:      isQ ? (parseFloat(document.getElementById('qf_sd')?.value)||null)      : null,
    preset:  !isQ ? (document.getElementById('qf_preset')?.value.trim()||'')       : '',
    expected_value: !isQ ? (document.getElementById('qf_expected')?.value.trim()||'') : '',
    updated_at: new Date().toISOString(),
  };
  var res = _qcMode === 'new'
    ? await supabaseClient.from('lj_items').insert(payload).select().single()
    : await supabaseClient.from('lj_items').update(payload).eq('id', _selItem.id).select().single();
  if (res.error) { showMessage('저장 실패: ' + res.error.message, 'error'); return; }
  showMessage('저장됐습니다.', 'success');
  _selItem = res.data;
  _qcMode  = 'view';
  await _loadItems();
  _renderBar();
  _loadEntries();
}
window.saveQcItem = saveQcItem;

async function deleteQcItem() {
  if (!_selItem) return;
  if (!confirm('"' + _selItem.item_name + '" 항목을 삭제하시겠습니까?\n측정 데이터도 모두 삭제됩니다.')) return;
  await supabaseClient.from('lj_entries').delete().eq('item_id', _selItem.id);
  await supabaseClient.from('lj_items').delete().eq('id', _selItem.id);
  showMessage('삭제됐습니다.', 'success');
  _selItem = null;
  _qcMode  = 'view';
  if (_qcGrid) _qcGrid.setGridOption('rowData', []);
  document.getElementById('ljChartWrap').innerHTML = '';
  document.getElementById('detQcNoSelect').style.display = 'flex';
  document.getElementById('detQcSelected').style.display = 'none';
  await _loadItems();
}
window.deleteQcItem = deleteQcItem;

/* ── Westgard 다중규칙 판정 ─────────────────────
   data: [{date, v}] 측정일 오름차순
   각 포인트마다 위반한 규칙 목록과 reject 여부를 반환 */
function _evalWestgard(data, mean, sd) {
  if (!sd) return data.map(function() { return { z: 0, violations: [], reject: false, warning: false }; });
  return data.map(function(d, i) {
    var z = (d.v - mean) / sd;
    var violations = [];

    if (Math.abs(z) > 3) violations.push('1_3s');
    else if (Math.abs(z) > 2) violations.push('1_2s');

    if (i > 0) {
      var z0 = (data[i-1].v - mean) / sd;
      if ((z > 2 && z0 > 2) || (z < -2 && z0 < -2)) violations.push('2_2s');
      if (Math.abs(z - z0) > 4) violations.push('R_4s');
    }
    if (i >= 3) {
      var last4 = [data[i-3], data[i-2], data[i-1], d].map(function(x) { return (x.v - mean) / sd; });
      if (last4.every(function(zz) { return zz > 1; }) || last4.every(function(zz) { return zz < -1; })) violations.push('4_1s');
    }
    if (i >= 9) {
      var last10 = data.slice(i-9, i+1).map(function(x) { return x.v - mean; });
      if (last10.every(function(dd) { return dd > 0; }) || last10.every(function(dd) { return dd < 0; })) violations.push('10x');
    }

    var rejectRules = violations.filter(function(v) { return v !== '1_2s'; });
    return { z: z, violations: violations, reject: rejectRules.length > 0, warning: violations.indexOf('1_2s') >= 0 && rejectRules.length === 0 };
  });
}


function _initEntryGrid() {
  var el = document.getElementById('qcEntryGrid');
  if (!el || _qcGrid) return;
  _qcGrid = agGrid.createGrid(el, {
    columnDefs: _entryColDefs(null),
    rowData: [],
    rowHeight: 34, headerHeight: 34,
    suppressCellFocus: false, suppressHorizontalScroll: true,
    stopEditingWhenCellsLoseFocus: true,
    defaultColDef: { sortable: false, resizable: true, suppressMovable: true,
      cellStyle: { display:'flex', alignItems:'center', justifyContent:'center' } },
    overlayNoRowsTemplate: '<span style="color:#9ca3af;font-size:12px;">+ 입력 버튼으로 측정값을 추가하세요</span>',
    onGridReady: function(p) { p.api.sizeColumnsToFit(); },
  });
}

function _entryColDefs(item) {
  var isQual = item && item.item_type === 'qualitative' && item.preset;
  return [
    { headerName: '측정일', field: 'date', width: 110,
      editable: true, singleClickEdit: true,
      cellEditor: 'agDateStringCellEditor',
      cellRenderer: function(p) {
        return p.value ? String(p.value).slice(0,10)
          : '<span style="color:#d1d5db;font-size:11px;">날짜 클릭</span>';
      }
    },
    { headerName: '측정값', field: 'value', flex: 1,
      editable: true, singleClickEdit: true,
      cellEditor: isQual ? 'agSelectCellEditor' : 'agTextCellEditor',
      cellEditorParams: isQual ? { values: item.preset.split(',').map(function(s){return s.trim();}) } : {},
      cellStyle: function(p) {
        var base = { display:'flex', alignItems:'center', justifyContent:'flex-end', fontWeight:600 };
        if (p.data._reject) base.color = '#dc2626';
        else if (p.data._warning) base.color = '#d97706';
        return base;
      },
      cellRenderer: function(p) {
        return (p.value != null && p.value !== '') ? String(p.value)
          : '<span style="color:#d1d5db;font-size:11px;">값 클릭</span>';
      }
    },
    { headerName: '판정', width: 80, sortable: false,
      cellStyle: { display:'flex', alignItems:'center', justifyContent:'center', fontSize:'10px', fontWeight:700 },
      cellRenderer: function(p) {
        if (!p.data._violations || !p.data._violations.length) return '<span style="color:#9ca3af;">-</span>';
        var color = p.data._reject ? '#dc2626' : '#d97706';
        return '<span style="color:' + color + ';" title="' + p.data._violations.join(', ') + '">' + p.data._violations[0] + (p.data._violations.length > 1 ? ' 외' : '') + '</span>';
      }
    },
    { headerName: '메모', field: 'memo', flex: 1,
      editable: true, singleClickEdit: true,
      headerClass: 'ag-left-header',
      cellStyle: { display:'flex', alignItems:'center', justifyContent:'flex-start', color:'#6b7280' },
    },
    { headerName: '', width: 90, sortable: false,
      cellStyle: { display:'flex', alignItems:'center', justifyContent:'center', gap:'4px' },
      cellRenderer: function(p) {
        var wrap = document.createElement('div');
        wrap.style.cssText = 'display:flex;gap:4px;';
        var s = document.createElement('button');
        s.className = 'tbl-btn'; s.textContent = '저장';
        // click 대신 mousedown — 편집 중인 셀이 있으면 click 이벤트의 첫 번째는
        // 포커스아웃(편집 종료) 처리에 먹혀서 버튼이 한 번에 안 눌리는 문제가 있음.
        // mousedown은 그 포커스아웃 처리보다 먼저 발생해서 항상 정상적으로 잡힘.
        s.addEventListener('mousedown', function(e) {
          e.preventDefault();
          window._saveEntry(p.node.data);
        });
        var d = document.createElement('button');
        d.className = 'tbl-btn tbl-btn--danger'; d.textContent = '삭제';
        d.addEventListener('mousedown', function(e) {
          e.preventDefault();
          window._delEntry(p.node.data);
        });
        wrap.appendChild(s); wrap.appendChild(d);
        return wrap;
      }
    },
  ];
}

async function _loadEntries() {
  if (!_selItem || !_qcGrid) return;
  var dateFrom = document.getElementById('qcDateFrom')?.value || '';
  var dateTo   = document.getElementById('qcDateTo')?.value || '';

  // Westgard 판정(연속 포인트 규칙: 2_2s/R_4s/4_1s/10x)은 조회 날짜 범위와 무관하게
  // 항상 전체 이력 기준으로 계산해야 정확함 — 화면에는 필터된 구간만 보여주되,
  // 판정 자체는 전체 데이터를 기준으로 미리 계산해둔 뒤 그 결과만 잘라서 씀
  var { data: allData } = await supabaseClient.from('lj_entries').select('*')
    .eq('item_id', _selItem.id).order('date', { ascending: true });
  var allRows = allData || [];

  var item = _selItem;
  if (item.item_type === 'quantitative' && item.mean != null && item.sd) {
    var mean = parseFloat(item.mean), sd = parseFloat(item.sd);
    var numeric = allRows.map(function(r) { return { v: parseFloat(r.value) }; });
    var evals = _evalWestgard(numeric, mean, sd);
    allRows.forEach(function(r, i) {
      var ok = !isNaN(numeric[i].v);
      r._violations = ok ? evals[i].violations : [];
      r._reject     = ok ? evals[i].reject     : false;
      r._warning    = ok ? evals[i].warning    : false;
    });
  } else {
    allRows.forEach(function(r) { r._violations = []; r._reject = false; r._warning = false; });
  }

  // 화면 표시용 — 날짜 필터 적용 (판정 결과는 위에서 전체 기준으로 이미 계산된 걸 그대로 들고 있음)
  var rows = allRows.filter(function(r) {
    if (dateFrom && r.date < dateFrom) return false;
    if (dateTo   && r.date > dateTo)   return false;
    return true;
  });

  // 최근 측정의 판정을 헤더 배지로 표시 — 이것도 전체 이력 기준 마지막 건으로 표시
  var badge = document.getElementById('qcWestgardBadge');
  if (badge) {
    var last = allRows.length ? allRows[allRows.length - 1] : null;
    if (item.item_type !== 'quantitative' || item.mean == null || !item.sd) {
      badge.textContent = '';
    } else if (!last) {
      badge.innerHTML = '';
    } else if (last._reject) {
      badge.innerHTML = '<span style="color:#dc2626;">⚠ ' + last._violations.join(', ') + ' 위반 (Reject)</span>';
    } else if (last._warning) {
      badge.innerHTML = '<span style="color:#d97706;">△ 1_2s (경고)</span>';
    } else {
      badge.innerHTML = '<span style="color:#059669;">✓ 정상</span>';
    }
  }

  // 컬럼 업데이트 (항목 유형에 따라)
  _qcGrid.setGridOption('columnDefs', _entryColDefs(_selItem));
  _qcGrid.setGridOption('rowData', rows);
  _qcGrid.sizeColumnsToFit();
  _renderChart(_selItem, rows);
}

function _addRow() {
  if (!_selItem || !_qcGrid) return;
  _qcGrid.applyTransaction({ add: [{ id: null, item_id: _selItem.id, date: new Date().toISOString().slice(0,10), value: '', memo: '' }] });
}

window._saveEntry = async function(row) {
  if (!row.date || row.value === '' || row.value == null) {
    showMessage('날짜와 측정값을 입력해 주세요.', 'warning'); return;
  }
  var payload = { item_id: _selItem.id, date: row.date, value: String(row.value), memo: row.memo || '' };
  var res = row.id
    ? await supabaseClient.from('lj_entries').update(payload).eq('id', row.id)
    : await supabaseClient.from('lj_entries').insert(payload);
  if (res.error) { showMessage('저장 실패: ' + res.error.message, 'error'); return; }
  showMessage('저장됐습니다.', 'success');
  _loadEntries();
};

window._delEntry = async function(row) {
  if (!row.id) { _qcGrid.applyTransaction({ remove: [row] }); return; }
  if (!confirm('이 측정 데이터를 삭제하시겠습니까?')) return;
  await supabaseClient.from('lj_entries').delete().eq('id', row.id);
  showMessage('삭제됐습니다.', 'success');
  _loadEntries();
};

/* ── L-J 차트 ────────────────────────────────── */
var _qcChartRO = null;       // ljChartWrap 크기 변화를 감지해서 다시 그리기 위한 ResizeObserver
var _qcLastChartArgs = null; // 마지막으로 그린 item/entries 캐시 (재측정 시 재사용)

function _renderChart(item, entries) {
  var wrap = document.getElementById('ljChartWrap');
  if (!wrap) return;
  _qcLastChartArgs = { item: item, entries: entries };

  // wrap의 실제 크기가 변할 때마다(탭 전환으로 처음 보이게 되는 순간 포함) 다시 그림.
  // 한 번만 wrap.clientWidth를 읽고 끝내면, 탭이 아직 숨겨져있거나 레이아웃이 다 안 잡힌
  // 시점에 측정된 작은 값이 그대로 굳어버려서 차트가 실제 패널보다 좁게 그려지는 문제가 있었음.
  if (!_qcChartRO && typeof ResizeObserver !== 'undefined') {
    _qcChartRO = new ResizeObserver(function() {
      if (_qcLastChartArgs) _drawChart(_qcLastChartArgs.item, _qcLastChartArgs.entries);
    });
    _qcChartRO.observe(wrap);
  }
  _drawChart(item, entries);
}

function _drawChart(item, entries) {
  var wrap = document.getElementById('ljChartWrap');
  if (!wrap) return;
  if (item.item_type !== 'quantitative' || !item.mean || !item.sd) {
    wrap.innerHTML = '<div style="height:100%;display:flex;align-items:center;justify-content:center;color:#9ca3af;font-size:11px;text-align:center;">' +
      (item.item_type !== 'quantitative' ? '정성 항목은 차트를 지원하지 않습니다.' : 'Mean과 SD를 입력하면 차트가 표시됩니다.') + '</div>';
    return;
  }
  var data = entries.map(function(e){return{date:e.date,v:parseFloat(e.value),reject:e._reject,warning:e._warning};}).filter(function(e){return!isNaN(e.v);});
  if (!data.length) {
    wrap.innerHTML = '<div style="height:100%;display:flex;align-items:center;justify-content:center;color:#9ca3af;font-size:11px;">측정 데이터를 입력하면 차트가 표시됩니다.</div>';
    return;
  }
  var mean=parseFloat(item.mean), sd=parseFloat(item.sd), dec=item.decimal_places||2;
  var W=wrap.clientWidth||400, H=wrap.clientHeight||180;
  // 좌측 여백(축 라벨 자리)은 라벨 글자수에 맞춰 동적으로 계산 — 고정값(48px)을 쓰면
  // 라벨이 짧을 때 왼쪽이 필요 이상으로 넓어져서 그래프가 오른쪽으로 쏠려 보임
  var maxLabelLen = Math.max(
    Number(mean+3*sd).toFixed(dec).length,
    Number(mean-3*sd).toFixed(dec).length
  );
  var p={t:18, r:8, b:32, l: Math.max(24, 10 + maxLabelLen*5.2)};
  var cw=W-p.l-p.r, ch=H-p.t-p.b;
  var yMin=mean-3.5*sd, yMax=mean+3.5*sd;
  function Y(v){return p.t+ch-(v-yMin)/(yMax-yMin)*ch;}
  function X(i){return p.l+(data.length===1?cw/2:i/(data.length-1)*cw);}

  var bands=[[mean+2*sd,mean-2*sd,'#fffbeb'],[mean+3*sd,mean+2*sd,'#fff5f5'],[mean-2*sd,mean-3*sd,'#fff5f5']];
  var lines=[
    [mean+3*sd,'#ef4444','3,2'],[mean+2*sd,'#f59e0b','3,2'],[mean+sd,'#e2e8f0','2,2'],
    [mean,'#3b82f6',''],
    [mean-sd,'#e2e8f0','2,2'],[mean-2*sd,'#f59e0b','3,2'],[mean-3*sd,'#ef4444','3,2'],
  ];
  var lLabels=['+3SD','+2SD','+1SD','Mean','-1SD','-2SD','-3SD'];

  var svg=['<svg xmlns="http://www.w3.org/2000/svg" width="'+W+'" height="'+H+'" style="font-size:10px;overflow:visible;">',
    '<rect width="'+W+'" height="'+H+'" fill="#fff"/>'];
  bands.forEach(function(b){
    svg.push('<rect x="'+p.l+'" y="'+Y(b[0])+'" width="'+cw+'" height="'+(Y(b[1])-Y(b[0]))+'" fill="'+b[2]+'"/>');
  });
  lines.forEach(function(l,i){
    var y=Y(l[0]), da=l[2]?'stroke-dasharray="'+l[2]+'"':'';
    svg.push('<line x1="'+p.l+'" y1="'+y+'" x2="'+(p.l+cw)+'" y2="'+y+'" stroke="'+l[1]+'" stroke-width="'+(lLabels[i]==='Mean'?2:1)+'" '+da+'/>');
    svg.push('<text x="'+(p.l-3)+'" y="'+(y+3.5)+'" text-anchor="end" fill="'+l[1]+'" font-size="9" font-weight="'+(lLabels[i]==='Mean'?700:400)+'">'+Number(l[0]).toFixed(dec)+'</text>');
  });
  if(data.length>1) svg.push('<polyline points="'+data.map(function(d,i){return X(i)+','+Y(d.v);}).join(' ')+'" fill="none" stroke="#3b82f6" stroke-width="1.5" stroke-linejoin="round"/>');
  data.forEach(function(d,i){
    var c = d.reject ? '#dc2626' : d.warning ? '#f59e0b' : '#3b82f6';
    var r = d.reject ? 4.5 : 3.5;
    svg.push('<circle cx="'+X(i)+'" cy="'+Y(d.v)+'" r="'+r+'" fill="'+c+'" stroke="#fff" stroke-width="1.5"/>');
  });
  var step=Math.max(1,Math.ceil(data.length/8));
  data.forEach(function(d,i){
    if(i%step!==0&&i!==data.length-1)return;
    // 맨 처음/맨 끝 라벨은 가운데정렬하면 차트 밖으로 튀어나가 잘리므로, 안쪽 방향으로 붙여서 정렬
    var anchor = i===0 ? 'start' : (i===data.length-1 ? 'end' : 'middle');
    svg.push('<text x="'+X(i)+'" y="'+(p.t+ch+13)+'" text-anchor="'+anchor+'" fill="#9ca3af" font-size="9">'+String(d.date).slice(5)+'</text>');
  });
  svg.push('<rect x="'+p.l+'" y="'+p.t+'" width="'+cw+'" height="'+ch+'" fill="none" stroke="#e5e7eb"/>');
  svg.push('</svg>');
  wrap.innerHTML=svg.join('');
}
