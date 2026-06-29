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
   정도관리 패널 — 인라인 그리드 방식
══════════════════════════════════════════════ */
var _qcEquipmentId  = null;
var _qcItemGrid     = null;
var _qcEntryGrid    = null;
var _qcInited       = false;
var _selectedQcItem = null;
var _qcItemEditing  = false;

function initQcPanel() {
  if (_qcInited) return;
  _qcInited = true;
  var eq = window._currentEquipment;
  if (!eq) return;
  _qcEquipmentId = eq.id;

  var disabled = document.getElementById('detQcDisabled');
  var qcContent = document.getElementById('detQcContent');

  if (!eq.qc_enabled) {
    if (disabled) disabled.style.display = '';
    if (qcContent) qcContent.style.display = 'none';
    var enableBtn = document.getElementById('detQcEnableBtn');
    if (enableBtn) enableBtn.addEventListener('click', async function() {
      await supabaseClient.from('equipments').update({ qc_enabled: true }).eq('id', eq.id);
      eq.qc_enabled = true;
      window._currentEquipment.qc_enabled = true;
      disabled.style.display = 'none';
      qcContent.style.display = 'flex';
      var qcTab = document.getElementById('detTabQc');
      if (qcTab) qcTab.disabled = false;
      loadQcItems();
    });
    return;
  }
  if (disabled) disabled.style.display = 'none';
  if (qcContent) qcContent.style.display = 'flex';
  loadQcItems();

  // + 추가 버튼
  var addBtn = document.getElementById('addQcItemBtn');
  if (addBtn) addBtn.addEventListener('click', function() { showQcItemForm(null); });
}

/* ── 검사항목 그리드 ─────────────────────────── */
async function loadQcItems() {
  var el = document.getElementById('qcItemGrid');
  if (!el) return;
  var { data } = await supabaseClient.from('lj_items').select('*')
    .eq('equipment_id', _qcEquipmentId).order('created_at', { ascending: true });
  var rows = data || [];
  var cnt = document.getElementById('qcItemCountText');
  if (cnt) cnt.textContent = rows.length + '건';

  if (!_qcItemGrid) {
    _qcItemGrid = agGrid.createGrid(el, {
      columnDefs: [
        { headerName: '항목명', field: 'item_name', flex: 1,
          headerClass: 'ag-left-header',
          cellStyle: { display:'flex', alignItems:'center', justifyContent:'flex-start', fontWeight:600 } },
        { headerName: '유형', field: 'item_type', width: 60,
          cellRenderer: function(p) { return p.value === 'quantitative' ? '정량' : '정성'; } },
        { headerName: '단위', field: 'unit', width: 55,
          cellStyle: { display:'flex', alignItems:'center', justifyContent:'center', color:'#6b7280' } },
      ],
      rowData: rows, rowHeight: 34, headerHeight: 34,
      suppressCellFocus: true, suppressHorizontalScroll: true,
      defaultColDef: { sortable: false, resizable: true, suppressMovable: true,
        cellStyle: { display:'flex', alignItems:'center', justifyContent:'center' } },
      overlayNoRowsTemplate: '<span style="color:#9ca3af;font-size:11px;text-align:center;">+ 추가 버튼으로<br>검사항목을 등록하세요</span>',
      rowSelection: 'single',
      onGridReady: function(p) { p.api.sizeColumnsToFit(); },
      onRowClicked: function(p) { selectQcItem(p.data); },
    });
  } else {
    _qcItemGrid.setGridOption('rowData', rows);
  }
}

function selectQcItem(item) {
  _selectedQcItem = item;
  _qcItemEditing  = false;
  var noSelect = document.getElementById('detQcNoSelect');
  var detail   = document.getElementById('detQcDetail');
  if (noSelect) noSelect.style.display = 'none';
  if (detail)   { detail.style.display = 'flex'; }
  renderQcItemInfo(item);
  _qcEntryGrid = null;
  loadQcEntries(item);
}

/* ── 항목 정보 렌더링 (읽기 / 편집) ────────────── */
function renderQcItemInfo(item) {
  var body  = document.getElementById('qcItemFormBody');
  var title = document.getElementById('qcItemFormTitle');
  var editBtn = document.getElementById('qcItemEditToggleBtn');
  var delBtn  = document.getElementById('qcItemDeleteBtn');
  if (!body) return;

  if (title) title.textContent = item.item_name;

  if (!_qcItemEditing) {
    // 읽기 모드
    var isQ = item.item_type === 'quantitative';
    var dec = item.decimal_places || 2;
    body.innerHTML = [
      field('유형', isQ ? '정량' : '정성'),
      field('단위', item.unit || '-'),
      isQ ? field('Mean', item.mean != null ? Number(item.mean).toFixed(dec) : '-') : field('선택지', item.preset || '-'),
      isQ ? field('SD',   item.sd   != null ? Number(item.sd).toFixed(dec)   : '-') : field('예상값', item.expected_value || '-'),
      isQ ? field('소수점', item.decimal_places) : '',
      field('메모', item.memo || '-'),
    ].join('');
    if (editBtn) editBtn.textContent = '수정';
    if (delBtn)  delBtn.style.display = '';
  } else {
    // 편집 모드
    var isQ = item.item_type === 'quantitative';
    body.style.display = 'flex';
    body.style.flexDirection = 'column';
    body.style.gap = '8px';
    body.innerHTML =
      '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;">' +
      fInput('항목명', 'qi_edit_name', item.item_name) +
      fSelect('유형', 'qi_edit_type', [['quantitative','정량'],['qualitative','정성']], item.item_type, 'onQiEditTypeChange()') +
      fInput('단위', 'qi_edit_unit', item.unit) +
      '</div>' +
      '<div id="qi_edit_quant" style="display:' + (isQ?'grid':'none') + ';grid-template-columns:1fr 1fr 1fr;gap:8px;">' +
      fInput('평균(Mean)', 'qi_edit_mean', item.mean, 'number') +
      fInput('SD', 'qi_edit_sd', item.sd, 'number') +
      fInput('소수점', 'qi_edit_decimal', item.decimal_places || 2, 'number') +
      '</div>' +
      '<div id="qi_edit_qual" style="display:' + (isQ?'none':'grid') + ';grid-template-columns:1fr 1fr;gap:8px;">' +
      fInput('선택지(쉼표구분)', 'qi_edit_preset', item.preset) +
      fInput('예상값', 'qi_edit_expected', item.expected_value) +
      '</div>' +
      '<div style="display:grid;grid-template-columns:1fr;gap:8px;">' +
      fInput('메모', 'qi_edit_memo', item.memo) +
      '</div>' +
      '<div style="display:flex;gap:6px;justify-content:flex-end;">' +
      '<button class="btn btn-sm" onclick="cancelQcItemEdit()">취소</button>' +
      '<button class="btn btn-sm btn-primary" onclick="saveQcItemEdit()">저장</button>' +
      '</div>';
    if (editBtn) editBtn.textContent = '';
    if (delBtn)  delBtn.style.display = 'none';
  }

  // 수정 버튼
  if (editBtn && !editBtn._bound) {
    editBtn._bound = true;
    editBtn.addEventListener('click', function() {
      _qcItemEditing = !_qcItemEditing;
      renderQcItemInfo(_selectedQcItem);
    });
  }
  // 삭제 버튼
  if (delBtn && !delBtn._bound) {
    delBtn._bound = true;
    delBtn.addEventListener('click', function() { deleteQcItem(_selectedQcItem.id); });
  }
}

function field(label, value) {
  return '<div style="font-size:11px;"><div style="color:#9ca3af;margin-bottom:2px;">' + label + '</div>' +
    '<div style="color:#111827;font-weight:500;">' + (value ?? '-') + '</div></div>';
}
function fInput(label, id, value, type) {
  return '<div style="font-size:11px;"><div style="color:#6b7280;margin-bottom:3px;">' + label + '</div>' +
    '<input type="' + (type||'text') + '" id="' + id + '" class="input" value="' + (value??'') + '" style="height:28px;font-size:11px;" /></div>';
}
function fSelect(label, id, options, selected, onchange) {
  var opts = options.map(function(o) {
    return '<option value="' + o[0] + '"' + (o[0]===selected?' selected':'') + '>' + o[1] + '</option>';
  }).join('');
  return '<div style="font-size:11px;"><div style="color:#6b7280;margin-bottom:3px;">' + label + '</div>' +
    '<select id="' + id + '" class="input" style="height:28px;font-size:11px;" onchange="' + (onchange||'') + '">' + opts + '</select></div>';
}

function onQiEditTypeChange() {
  var type = document.getElementById('qi_edit_type')?.value;
  var q = document.getElementById('qi_edit_quant');
  var l = document.getElementById('qi_edit_qual');
  if (q) q.style.display = type === 'quantitative' ? 'grid' : 'none';
  if (l) l.style.display = type === 'qualitative'  ? 'grid' : 'none';
}
window.onQiEditTypeChange = onQiEditTypeChange;

function cancelQcItemEdit() {
  _qcItemEditing = false;
  renderQcItemInfo(_selectedQcItem);
}
window.cancelQcItemEdit = cancelQcItemEdit;

async function saveQcItemEdit() {
  var name = document.getElementById('qi_edit_name')?.value.trim();
  if (!name) { showMessage('항목명을 입력해 주세요.', 'warning'); return; }
  var type = document.getElementById('qi_edit_type')?.value;
  var payload = {
    item_name:      name,
    item_type:      type,
    unit:           document.getElementById('qi_edit_unit')?.value.trim() || '',
    memo:           document.getElementById('qi_edit_memo')?.value.trim() || '',
    decimal_places: parseInt(document.getElementById('qi_edit_decimal')?.value) || 2,
    mean:           type==='quantitative' ? (parseFloat(document.getElementById('qi_edit_mean')?.value)||null) : null,
    sd:             type==='quantitative' ? (parseFloat(document.getElementById('qi_edit_sd')?.value)||null)   : null,
    preset:         type==='qualitative'  ? (document.getElementById('qi_edit_preset')?.value.trim()||'')   : '',
    expected_value: type==='qualitative'  ? (document.getElementById('qi_edit_expected')?.value.trim()||'') : '',
    updated_at:     new Date().toISOString(),
  };
  var { error } = await supabaseClient.from('lj_items').update(payload).eq('id', _selectedQcItem.id);
  if (error) { showMessage('저장 실패: ' + error.message, 'error'); return; }
  Object.assign(_selectedQcItem, payload);
  _qcItemEditing = false;
  showMessage('저장됐습니다.', 'success');
  renderQcItemInfo(_selectedQcItem);
  _qcItemGrid = null;
  await loadQcItems();
}
window.saveQcItemEdit = saveQcItemEdit;

async function showQcItemForm(itemId) {
  // 새 항목 추가 — 빈 항목 insert 후 선택
  var { data, error } = await supabaseClient.from('lj_items').insert({
    equipment_id: _qcEquipmentId,
    item_name: '새 항목', item_type: 'quantitative',
    unit: '', memo: '', decimal_places: 2,
  }).select().single();
  if (error) { showMessage('항목 생성 실패: ' + error.message, 'error'); return; }
  _qcItemGrid = null;
  await loadQcItems();
  _selectedQcItem = data;
  _qcItemEditing  = true;
  var noSelect = document.getElementById('detQcNoSelect');
  var detail   = document.getElementById('detQcDetail');
  if (noSelect) noSelect.style.display = 'none';
  if (detail)   detail.style.display = 'flex';
  renderQcItemInfo(data);
  _qcEntryGrid = null;
  await loadQcEntries(data);
}

async function deleteQcItem(itemId) {
  if (!confirm('검사항목과 모든 측정 데이터가 삭제됩니다. 계속하시겠습니까?')) return;
  await supabaseClient.from('lj_entries').delete().eq('item_id', itemId);
  var { error } = await supabaseClient.from('lj_items').delete().eq('id', itemId);
  if (error) { showMessage('삭제 실패: ' + error.message, 'error'); return; }
  showMessage('삭제됐습니다.', 'success');
  _selectedQcItem = null;
  _qcItemEditing  = false;
  document.getElementById('detQcNoSelect').style.display = '';
  document.getElementById('detQcDetail').style.display = 'none';
  _qcItemGrid = null;
  await loadQcItems();
}
window.deleteQcItem = deleteQcItem;

/* ── 측정값 그리드 ───────────────────────────── */
async function loadQcEntries(item) {
  var el = document.getElementById('qcEntryGrid');
  if (!el) return;
  var { data } = await supabaseClient.from('lj_entries').select('*')
    .eq('item_id', item.id).order('date', { ascending: true });
  var rows = data || [];

  // + 입력 버튼 이벤트 (최초 1회)
  var addBtn = document.getElementById('addLjEntryBtn');
  if (addBtn && !addBtn._bound) {
    addBtn._bound = true;
    addBtn.addEventListener('click', function() { addQcEntryRow(); });
  }

  if (!_qcEntryGrid) {
    _qcEntryGrid = agGrid.createGrid(el, {
      columnDefs: [
        { headerName: '측정일', field: 'date', width: 110,
          editable: true, singleClickEdit: true,
          cellEditor: 'agDateStringCellEditor',
          cellRenderer: function(p) { return p.value ? String(p.value).slice(0,10) : '<span style="color:#d1d5db;">날짜 입력</span>'; }
        },
        { headerName: '측정값', field: 'value', flex: 1,
          editable: true, singleClickEdit: true,
          cellStyle: function(p) {
            var base = { display:'flex', alignItems:'center', justifyContent:'flex-end', fontWeight:600 };
            if (item.item_type === 'quantitative' && item.mean != null && item.sd != null) {
              var v=parseFloat(p.value), m=parseFloat(item.mean), s=parseFloat(item.sd);
              var z=Math.abs((v-m)/s);
              base.color = z>3?'#dc2626':z>2?'#f59e0b':'#111827';
            }
            return base;
          },
          cellRenderer: function(p) { return p.value || '<span style="color:#d1d5db;">값 입력</span>'; }
        },
        { headerName: '메모', field: 'memo', flex: 1,
          editable: true, singleClickEdit: true,
          headerClass: 'ag-left-header',
          cellStyle: { display:'flex', alignItems:'center', justifyContent:'flex-start', color:'#6b7280' },
        },
        { headerName: '', width: 60, sortable: false,
          cellStyle: { display:'flex', alignItems:'center', justifyContent:'center', gap:'4px' },
          cellRenderer: function(p) {
            var wrap = document.createElement('div');
            wrap.style.cssText = 'display:flex;gap:4px;';
            var saveBtn = document.createElement('button');
            saveBtn.className = 'tbl-btn';
            saveBtn.textContent = '저장';
            saveBtn.onclick = function() { window.saveQcEntryRow(p.node.data, item); };
            var delBtn = document.createElement('button');
            delBtn.className = 'tbl-btn tbl-btn--danger';
            delBtn.textContent = '삭제';
            delBtn.onclick = function() { window.deleteQcEntry(p.node.data, item); };
            wrap.appendChild(saveBtn);
            wrap.appendChild(delBtn);
            return wrap;
          }
        },
      ],
      rowData: rows, rowHeight: 34, headerHeight: 34,
      suppressCellFocus: false, suppressHorizontalScroll: true,
      stopEditingWhenCellsLoseFocus: true,
      defaultColDef: { sortable: false, resizable: true, suppressMovable: true,
        cellStyle: { display:'flex', alignItems:'center', justifyContent:'center' } },
      overlayNoRowsTemplate: '<span style="color:#9ca3af;font-size:12px;">+ 입력 버튼으로 측정값을 추가하세요</span>',
      onGridReady: function(p) { p.api.sizeColumnsToFit(); },
    });
  } else {
    _qcEntryGrid.setGridOption('rowData', rows);
  }

  if (item.item_type === 'quantitative') renderLjChart(item, rows);
  else {
    var wrap = document.getElementById('ljChartWrap');
    if (wrap) wrap.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#9ca3af;font-size:12px;">정성 항목은 L-J 차트를 지원하지 않습니다.</div>';
  }
}

function addQcEntryRow() {
  if (!_qcEntryGrid || !_selectedQcItem) return;
  var today = new Date().toISOString().slice(0,10);
  _qcEntryGrid.applyTransaction({ add: [{ id: null, item_id: _selectedQcItem.id, date: today, value: '', memo: '' }] });
}

async function saveQcEntryRow(row, item) {
  if (!row.date || !row.value) { showMessage('날짜와 측정값을 입력해 주세요.', 'warning'); return; }
  var payload = { item_id: item.id, date: row.date, value: String(row.value), memo: row.memo || '' };
  var res = row.id
    ? await supabaseClient.from('lj_entries').update(payload).eq('id', row.id)
    : await supabaseClient.from('lj_entries').insert(payload);
  if (res.error) { showMessage('저장 실패: ' + res.error.message, 'error'); return; }
  showMessage('저장됐습니다.', 'success');
  _qcEntryGrid = null;
  await loadQcEntries(item);
}
window.saveQcEntryRow = saveQcEntryRow;

async function deleteQcEntry(row, item) {
  if (!row.id) { // 아직 저장 안 된 행
    _qcEntryGrid.applyTransaction({ remove: [row] });
    return;
  }
  if (!confirm('측정 데이터를 삭제하시겠습니까?')) return;
  var { error } = await supabaseClient.from('lj_entries').delete().eq('id', row.id);
  if (error) { showMessage('삭제 실패: ' + error.message, 'error'); return; }
  showMessage('삭제됐습니다.', 'success');
  _qcEntryGrid = null;
  await loadQcEntries(item);
}
window.deleteQcEntry = deleteQcEntry;

/* ── L-J 차트 (SVG) ─────────────────────────── */
function renderLjChart(item, entries) {
  var wrap = document.getElementById('ljChartWrap');
  if (!wrap) return;
  wrap.innerHTML = '';
  if (!item.mean || !item.sd || !entries.length) {
    wrap.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#9ca3af;font-size:12px;text-align:center;">Mean/SD 값 또는<br>측정 데이터가 없습니다.</div>';
    return;
  }
  var mean=parseFloat(item.mean), sd=parseFloat(item.sd), dec=item.decimal_places||2;
  var data=entries.map(function(e){return{date:e.date,value:parseFloat(e.value)};}).filter(function(e){return!isNaN(e.value);});
  if (!data.length) { wrap.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#9ca3af;font-size:12px;">유효한 측정값이 없습니다.</div>'; return; }

  var W=wrap.clientWidth||400, H=wrap.clientHeight||260;
  var pad={top:24,right:16,bottom:40,left:56};
  var cw=W-pad.left-pad.right, ch=H-pad.top-pad.bottom;
  var yMin=mean-3.5*sd, yMax=mean+3.5*sd;
  function yPx(v){return pad.top+ch-(v-yMin)/(yMax-yMin)*ch;}
  function xPx(i){return pad.left+(data.length===1?cw/2:i/(data.length-1)*cw);}

  var lines=[
    {label:'+3SD',v:mean+3*sd,color:'#dc2626',dash:'4,2'},
    {label:'+2SD',v:mean+2*sd,color:'#f59e0b',dash:'4,2'},
    {label:'+1SD',v:mean+  sd,color:'#9ca3af',dash:'2,2'},
    {label:'Mean',v:mean,     color:'#2563eb',dash:''},
    {label:'-1SD',v:mean-  sd,color:'#9ca3af',dash:'2,2'},
    {label:'-2SD',v:mean-2*sd,color:'#f59e0b',dash:'4,2'},
    {label:'-3SD',v:mean-3*sd,color:'#dc2626',dash:'4,2'},
  ];
  var s=['<svg xmlns="http://www.w3.org/2000/svg" width="'+W+'" height="'+H+'" style="font-family:inherit;font-size:10px;">',
    '<rect width="'+W+'" height="'+H+'" fill="#fff"/>',
    '<rect x="'+pad.left+'" y="'+yPx(mean+2*sd)+'" width="'+cw+'" height="'+(yPx(mean-2*sd)-yPx(mean+2*sd))+'" fill="#fffbeb" opacity="0.8"/>'];

  lines.forEach(function(l){
    var y=yPx(l.v), da=l.dash?'stroke-dasharray="'+l.dash+'"':'';
    s.push('<line x1="'+pad.left+'" y1="'+y+'" x2="'+(pad.left+cw)+'" y2="'+y+'" stroke="'+l.color+'" stroke-width="'+(l.label==='Mean'?1.5:1)+'" '+da+'/>');
    s.push('<text x="'+(pad.left-4)+'" y="'+(y+3.5)+'" text-anchor="end" fill="'+l.color+'" font-size="9" font-weight="'+(l.label==='Mean'?700:400)+'">'+Number(l.v).toFixed(dec)+'</text>');
  });

  if (data.length>1){
    var pts=data.map(function(d,i){return xPx(i)+','+yPx(d.value);}).join(' ');
    s.push('<polyline points="'+pts+'" fill="none" stroke="#2563eb" stroke-width="1.5" stroke-linejoin="round"/>');
  }
  data.forEach(function(d,i){
    var x=xPx(i),y=yPx(d.value),z=Math.abs((d.value-mean)/sd);
    var color=z>3?'#dc2626':z>2?'#f59e0b':'#2563eb';
    s.push('<circle cx="'+x+'" cy="'+y+'" r="4" fill="'+color+'" stroke="#fff" stroke-width="1.5"/>');
  });

  var step=Math.max(1,Math.ceil(data.length/8));
  data.forEach(function(d,i){
    if(i%step!==0&&i!==data.length-1)return;
    var x=xPx(i);
    s.push('<text x="'+x+'" y="'+(pad.top+ch+14)+'" text-anchor="middle" fill="#6b7280" font-size="9">'+String(d.date).slice(5)+'</text>');
    s.push('<line x1="'+x+'" y1="'+(pad.top+ch)+'" x2="'+x+'" y2="'+(pad.top+ch+4)+'" stroke="#e5e7eb"/>');
  });

  s.push('<rect x="'+pad.left+'" y="'+pad.top+'" width="'+cw+'" height="'+ch+'" fill="none" stroke="#e5e7eb"/>');
  s.push('<text x="'+(W/2)+'" y="13" text-anchor="middle" fill="#374151" font-size="11" font-weight="700">'+item.item_name+' L-J Chart</text>');
  s.push('</svg>');
  wrap.innerHTML=s.join('');
}
