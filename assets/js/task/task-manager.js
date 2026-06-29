/**
 * task-manager.js
 * 업무일정 관리 앱 — 주간 업무 / 주간일지 / 팀원 현황
 */

(function () {
  'use strict';

/* ── maneasy Supabase 헬퍼 (GAS API 대체) ─────────────────── */

// task_id 생성 (접두사_yyyymmdd_랜덤4자리)
function generateTaskId() {
  const d = new Date();
  const ds = d.getFullYear() + String(d.getMonth()+1).padStart(2,'0') + String(d.getDate()).padStart(2,'0');
  const rand = Math.random().toString(36).slice(2,6).toUpperCase();
  return 'TASK_' + ds + '_' + rand;
}

// 사용자 설정 — localStorage
function getUserSettingLocal(key) {
  try { return JSON.parse(localStorage.getItem('task_setting_' + key)); } catch { return null; }
}
function setUserSettingLocal(key, value) {
  try { localStorage.setItem('task_setting_' + key, JSON.stringify(value)); } catch {}
}

// task_items — 주간 조회
async function sbGetTaskItems(userEmail, weekStart, weekEnd) {
  const { data, error } = await supabaseClient.from('task_items').select('*')
    .eq('user_email', userEmail)
    .gte('start_date', weekStart)
    .lte('start_date', weekEnd)
    .order('start_date', { ascending: true });
  if (error) throw error;
  return data || [];
}

// task_items — 팀 조회 (manager/admin)
async function sbGetTeamTaskItems(teamCode, weekStart, weekEnd) {
  const { data, error } = await supabaseClient.from('task_items').select('*')
    .eq('team_code', teamCode)
    .gte('start_date', weekStart)
    .lte('start_date', weekEnd)
    .order('start_date', { ascending: true });
  if (error) throw error;
  return data || [];
}

// task_items — 검색
async function sbSearchTaskItems(params) {
  let q = supabaseClient.from('task_items').select('*');
  if (params.user_email)  q = q.eq('user_email', params.user_email);
  if (params.team_code)   q = q.eq('team_code',  params.team_code);
  if (params.start_from)  q = q.gte('start_date', params.start_from);
  if (params.start_to)    q = q.lte('start_date', params.start_to);
  if (params.status)      q = q.eq('status', params.status);
  if (params.keyword)     q = q.or(`title.ilike.%${params.keyword}%,description.ilike.%${params.keyword}%`);
  q = q.order('start_date', { ascending: false }).limit(200);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

// task_journals — 단건 조회 또는 생성
async function sbGetOrCreateJournal(userEmail, weekStart) {
  const weekEnd = getWeekEnd(weekStart);
  const { data: existing } = await supabaseClient.from('task_journals').select('*')
    .eq('user_email', userEmail).eq('week_start', weekStart).single();
  if (existing) return existing;
  const { data: created, error } = await supabaseClient.from('task_journals').insert({
    user_email: userEmail, week_start: weekStart, week_end: weekEnd, status: 'DRAFT'
  }).select().single();
  if (error) throw error;
  return created;
}

// task_journals — 팀 조회
async function sbGetTeamJournals(teamCode, weekStart) {
  const { data: members } = await supabaseClient.from('user_profiles_with_email')
    .select('id, user_name, email, team_code').eq('team_code', teamCode).eq('active', 'Y');
  if (!members?.length) return [];
  const emails = members.map(m => m.email);
  const { data: journals } = await supabaseClient.from('task_journals').select('*')
    .in('user_email', emails).eq('week_start', weekStart);
  return (members || []).map(m => ({
    ...m,
    journal: (journals || []).find(j => j.user_email === m.email) || null
  }));
}

/* ───────────────────────────────────────────────────────────── */

  // ── 상수 ────────────────────────────────────────────────────
  // 카테고리 — 앱 로드 시 서버에서 동적으로 채워짐 (하드코딩 없음)
  let CATEGORY_LABELS   = {};
  let categoryCodeGroup = 'TASK_CATEGORY';
  let categoryIsCustom  = false;

  const STATUS_LABELS = {
    TODO:        '예정',
    IN_PROGRESS: '진행중',
    DONE:        '완료'
  };

  const DOW_KR = ['일', '월', '화', '수', '목', '금', '토'];

  // ── 상태 ────────────────────────────────────────────────────
  let currentUser = null;
  let isManager   = false;
  let isEdit      = false;
  let isAdmin     = false;

  // 주간 업무 탭
  let weeklyWeekStart  = '';
  let weeklyTasks      = [];
  let teamViewEnabled  = false;   // 부서원 업무 보기 토글 (manager/admin 전용)
  let teamWeeklyTasks  = [];      // 부서원 업무 목록 (팀뷰 활성 시)

  // 주간일지 탭
  let journalWeekStart    = '';
  let currentJournal      = null;
  let currentJournalTasks = null;
  let currentNextJournal  = null;   // 다음 주 일지 (차주계획 표시용)
  let journalAutoSync     = true;   // 업무 자동 동기화 설정
  let autosaveTimer       = null;
  let journalDirty        = false;

  // 팀 탭
  let teamWeekStart  = '';
  let _lastTeamData  = [];

  // 사용자 설정
  let _userSettingsLoaded = false;

  // 전역 공개 API
  window.TASK_APP = window.TASK_APP || {};

  // 캘린더 팝업
  let calendarPopupMonth = '';   // 'yyyy-MM' 형태

  // 모달
  let editingTaskId   = null;
  let clinicOptions   = [];   // ORG_CLINIC 코드 목록 [{ code_value, code_name }]

  // ── 초기화 ──────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', async () => {
    // maneasy auth — getSession은 async
    currentUser = await auth.getSession();
    if (!currentUser) {
      alert('로그인 세션이 만료되었습니다.');
      parent.shellNavigate?.('login');
      return;
    }

    document.getElementById('logoutBtn')?.addEventListener('click', () => {
      auth.logout();
    });

    try {
      showGlobalLoading('권한 확인 중...');

      // maneasy 권한: page_perms.task/list 또는 role=admin
      const role = String(currentUser.role || '').toLowerCase();
      isAdmin = role === 'admin';

      const pagePerms = currentUser.page_perms || {};
      const LEVEL = ['접근불가', 'user', 'edit', 'manager', 'admin'];
      const taskPerm = pagePerms['task/list'] || '접근불가';
      const permLevel = LEVEL.indexOf(taskPerm);

      if (!isAdmin && permLevel < LEVEL.indexOf('user')) {
        document.getElementById('permissionDenied').style.display = '';
        return;
      }

      isManager = isAdmin || permLevel >= LEVEL.indexOf('manager');
      isEdit    = permLevel === LEVEL.indexOf('edit');

      document.getElementById('appBody').style.display = '';

      // tabTeam은 모든 사용자에게 표시
      // 카테고리 관리, 엑셀 다운로드는 manager/admin 전용 (edit 제외)
      if (isManager && !isEdit) {
        document.getElementById('categoryManageBtn').style.display  = '';
        document.getElementById('exportJournalBtn').style.display   = '';
      }

      // 부서원 업무 보기 토글 — 전체 사용자 노출
      const tvWrap = document.getElementById('teamViewToggleWrap');
      if (tvWrap) tvWrap.style.display = 'flex';

      const todayStr      = formatDateStr(new Date());
      weeklyWeekStart     = getWeekStart(todayStr);
      journalWeekStart    = weeklyWeekStart;
      teamWeekStart       = weeklyWeekStart;
      calendarPopupMonth  = weeklyWeekStart.substring(0, 7);

      bindEvents();
      updateSharedWeekNav();

      // 권한 확인 완료 → 스피너 텍스트만 변경 (카운트 중복 방지)
      const loadingTextEl = document.getElementById('globalLoadingText');
      if (loadingTextEl) loadingTextEl.textContent = '업무 목록을 불러오는 중...';

      // 카테고리 + 의원 목록 먼저 로드 후 업무 로드
      await Promise.all([loadCategories(), loadClinics()]);
      await loadWeeklyTasks();

      // 자동 동기화 토글 초기화 + 설정 로드
      initAutoSyncToggle();
      initTeamViewToggle();
      loadUserSettings();

    } catch (err) {
      showMessage(err.message || '초기화에 실패했습니다.', 'error');
    } finally {
      hideGlobalLoading();
    }
  });

  // ── 이벤트 바인딩 ────────────────────────────────────────────
  function bindEvents() {
    // 탭
    document.querySelectorAll('.task-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    // 주간 업무 — 주 이동
    // ── 공통 주차 네비게이터 ───────────────────────────────────
    document.getElementById('prevWeekBtn')?.addEventListener('click', () => {
      navigateWeek(-1);
    });
    document.getElementById('nextWeekBtn')?.addEventListener('click', () => {
      navigateWeek(1);
    });
    document.getElementById('todayBtn')?.addEventListener('click', () => {
      navigateWeekTo(getWeekStart(formatDateStr(new Date())));
    });

    // 날짜 범위 버튼 → 캘린더 팝업 토글
    document.getElementById('weekNavRangeBtn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleCalendarPopup();
    });

    // 캘린더 팝업 월 이동
    document.getElementById('wcpPrevMonth')?.addEventListener('click', () => {
      calendarPopupMonth = offsetMonth(calendarPopupMonth, -1);
      renderCalendarPopup();
    });
    document.getElementById('wcpNextMonth')?.addEventListener('click', () => {
      calendarPopupMonth = offsetMonth(calendarPopupMonth, 1);
      renderCalendarPopup();
    });

    // 팝업 외부 클릭 시 닫기
    document.addEventListener('click', (e) => {
      const nav = document.getElementById('sharedWeekNav');
      if (nav && !nav.contains(e.target)) {
        document.getElementById('weekCalendarPopup')?.classList.remove('open');
      }
    });

    // 검색
    document.getElementById('searchRunBtn')?.addEventListener('click', runSearch);
    document.getElementById('searchResetBtn')?.addEventListener('click', resetSearch);
    document.getElementById('searchKeyword')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') runSearch();
    });

    // 팀원 업무 상세 보기 모달
    document.getElementById('teamTaskModalClose')?.addEventListener('click', () => _closeModal('teamTaskModal'));
    document.getElementById('teamTaskModalDismiss')?.addEventListener('click', () => _closeModal('teamTaskModal'));
    document.getElementById('teamTaskModal')?.addEventListener('click', e => {
      if (e.target === document.getElementById('teamTaskModal')) _closeModal('teamTaskModal');
    });

    // 카테고리 관리
    document.getElementById('categoryManageBtn')?.addEventListener('click', openCategoryModal);
    document.getElementById('categoryModalClose')?.addEventListener('click', closeCategoryModal);
    document.getElementById('categoryModalDone')?.addEventListener('click', closeCategoryModal);
    document.getElementById('catAddBtn')?.addEventListener('click', saveCategoryItem);

    // 단기업무 체크박스
    document.getElementById('modalSingleDay')?.addEventListener('change', (e) => {
      setSingleDay(e.target.checked);
    });
    // 시작일 변경 시 종료일 동기화
    document.getElementById('modalStartDate')?.addEventListener('change', (e) => {
      const endEl      = document.getElementById('modalEndDate');
      const singleDay  = document.getElementById('modalSingleDay');
      if (!endEl) return;
      if (singleDay?.checked) {
        // 단기업무 상태면 종료일도 시작일로 고정
        endEl.value = e.target.value;
      } else {
        // 종료일이 시작일보다 앞이면 맞춤
        if (endEl.value && endEl.value < e.target.value) {
          endEl.value = e.target.value;
        }
        endEl.min = e.target.value;
      }
    });

    // 모달
    document.getElementById('taskModalClose')?.addEventListener('click', closeTaskModal);
    document.getElementById('taskModalCancelBtn')?.addEventListener('click', closeTaskModal);
    document.getElementById('taskModalSaveBtn')?.addEventListener('click', saveTask);

    // overlay 클릭 시 닫기 — 단, 모달 내부에서 드래그해서 나온 경우는 닫지 않음
    let _taskModalMousedownOnOverlay = false;
    document.getElementById('taskModal')?.addEventListener('mousedown', e => {
      _taskModalMousedownOnOverlay = (e.target === document.getElementById('taskModal'));
    });
    document.getElementById('taskModal')?.addEventListener('click', e => {
      if (e.target === document.getElementById('taskModal') && _taskModalMousedownOnOverlay) closeTaskModal();
      _taskModalMousedownOnOverlay = false;
    });

    // 우선순위 & 상태 선택 UI
    document.querySelectorAll('.priority-option').forEach(label => {
      label.addEventListener('click', () => updatePriorityUI(label.querySelector('input').value));
    });
    document.querySelectorAll('.status-option').forEach(label => {
      label.addEventListener('click', () => updateStatusUI(label.querySelector('input').value));
    });

    // 일지 버튼
    document.getElementById('journalSaveBtn')?.addEventListener('click', () => saveJournal(false));
    document.getElementById('journalSubmitBtn')?.addEventListener('click', submitJournal);
    document.getElementById('journalCloseBtn')?.addEventListener('click', closeJournal);

    // 일지 자동 저장 (입력 후 디바운스)
    ['journalSummary','journalNextPlan','journalIssues',
     'attendanceThisWeek','attendanceNextWeek'].forEach(id => {
      document.getElementById(id)?.addEventListener('input', onJournalInput);
    });

    // 불러오기 버튼 (이번 주 / 차주)
    document.getElementById('journalImportTasksBtn')?.addEventListener('click', () => openImportTasksModal('this'));
    document.getElementById('journalImportNextTasksBtn')?.addEventListener('click', () => openImportTasksModal('next'));
    document.getElementById('importTasksModalClose')?.addEventListener('click', () => {
      _closeModal('importTasksModal');
    });
    document.getElementById('importTasksCancelBtn')?.addEventListener('click', () => {
      _closeModal('importTasksModal');
    });
    document.getElementById('importTasksApplyBtn')?.addEventListener('click', applyImportTasks);
    document.getElementById('importTasksSelectAll')?.addEventListener('change', function() {
      document.querySelectorAll('.import-task-checkbox').forEach(cb => cb.checked = this.checked);
    });
    // 체크박스는 change 이벤트
    ['earlyWorkThis','earlyWorkNext','satWorkThis','satWorkNext'].forEach(id => {
      document.getElementById(id)?.addEventListener('change', onJournalInput);
    });

    // 팀원 일지 모달
    document.getElementById('memberJournalClose')?.addEventListener('click', closeMemberModal);
    document.getElementById('memberJournalDismissBtn')?.addEventListener('click', closeMemberModal);

    // 통합 보기 모달
    document.getElementById('mergeViewBtn')?.addEventListener('click', openMergeView);
    document.getElementById('exportJournalBtn')?.addEventListener('click', exportJournalExcel);
    document.getElementById('exportPdfBtn')?.addEventListener('click', exportJournalPdf);

    document.getElementById('mergeViewClose')?.addEventListener('click', closeMergeView);
    document.getElementById('mergeViewDismissBtn')?.addEventListener('click', closeMergeView);
    document.getElementById('mergeViewModal')?.addEventListener('click', e => {
      if (e.target === document.getElementById('mergeViewModal')) closeMergeView();
    });
  }

  // ── 탭 전환 ─────────────────────────────────────────────────
  function switchTab(tab) {
    document.querySelectorAll('.task-tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    document.getElementById('panelWeekly').style.display  = tab === 'weekly'  ? '' : 'none';
    document.getElementById('panelJournal').style.display = tab === 'journal' ? '' : 'none';
    document.getElementById('panelTeam').style.display    = tab === 'team'    ? '' : 'none';
    document.getElementById('panelSearch').style.display  = tab === 'search'  ? '' : 'none';

    // 검색 탭 진입 시 카테고리 셀렉트 갱신 + 기본 날짜 설정
    if (tab === 'search') {
      updateSearchCategorySelect();
      setSearchDefaultDates();
    }

    // 검색 탭에서는 공통 네비게이터 숨김
    document.getElementById('sharedWeekNav').style.display = tab === 'search' ? 'none' : '';

    // 탭 전환 즉시 공통 네비게이터 레이블 갱신
    updateSharedWeekNav();

    if (tab === 'journal') {
      if (currentJournal && currentJournal._fromGenerate) {
        delete currentJournal._fromGenerate;
      } else {
        // 일지 탭에 한 번도 진입하지 않은 경우(초기)에만 주간업무 주차로 동기화
        // 이미 일지 탭에서 직접 다른 주로 이동한 경우 그 주차 유지
        if (!journalWeekStart || journalWeekStart === weeklyWeekStart) {
          journalWeekStart = weeklyWeekStart;
        }
        loadJournal();
      }
    }
    if (tab === 'team') {
      showGlobalLoading('팀원 현황을 불러오는 중...');
      loadTeamJournals().finally(() => hideGlobalLoading());
    }
  }

  // ── 날짜 유틸 ────────────────────────────────────────────────
  function formatDateStr(d) {
    const y  = d.getFullYear();
    const m  = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
  }

  function getWeekStart(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    d.setDate(d.getDate() - d.getDay());
    return formatDateStr(d);
  }

  function getWeekEnd(weekStart) {
    const d = new Date(weekStart + 'T00:00:00');
    d.setDate(d.getDate() + 6);
    return formatDateStr(d);
  }

  function offsetWeek(weekStart, delta) {
    const d = new Date(weekStart + 'T00:00:00');
    d.setDate(d.getDate() + delta * 7);
    return formatDateStr(d);
  }

  function offsetMonth(yyyyMM, delta) {
    const [y, m] = yyyyMM.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }

  function formatWeekRange(weekStart) {
    const weekEnd = getWeekEnd(weekStart);
    const s = weekStart.substring(5).replace('-', '/');
    const e = weekEnd.substring(5).replace('-', '/');
    return `${weekStart.substring(0, 4)}년 ${s} ~ ${e}`;
  }

  function isThisWeek(weekStart) {
    return weekStart === getWeekStart(formatDateStr(new Date()));
  }

  // ── 공통 네비게이터: 주 이동 ─────────────────────────────────
  function getCurrentTabWeekStart() {
    const activeTab = document.querySelector('.task-tab-btn.active')?.dataset?.tab;
    if (activeTab === 'journal') return journalWeekStart;
    if (activeTab === 'team')    return teamWeekStart;
    return weeklyWeekStart;
  }

  function navigateWeek(delta) {
    const activeTab = document.querySelector('.task-tab-btn.active')?.dataset?.tab;
    if (activeTab === 'journal') {
      journalWeekStart = offsetWeek(journalWeekStart, delta);
      loadJournal();  // 내부에서 자체 스피너 관리
    } else if (activeTab === 'team') {
      teamWeekStart = offsetWeek(teamWeekStart, delta);
      showGlobalLoading('불러오는 중...');
      loadTeamJournals().finally(() => hideGlobalLoading());
    } else {
      weeklyWeekStart = offsetWeek(weeklyWeekStart, delta);
      showGlobalLoading('불러오는 중...');
      loadWeeklyTasks().finally(() => hideGlobalLoading());
    }
    updateSharedWeekNav();
  }

  function navigateWeekTo(weekStart) {
    const activeTab = document.querySelector('.task-tab-btn.active')?.dataset?.tab;
    if (activeTab === 'journal') {
      journalWeekStart = weekStart;
      loadJournal();  // 내부에서 자체 스피너 관리
    } else if (activeTab === 'team') {
      teamWeekStart = weekStart;
      showGlobalLoading('불러오는 중...');
      loadTeamJournals().finally(() => hideGlobalLoading());
    } else {
      weeklyWeekStart = weekStart;
      showGlobalLoading('불러오는 중...');
      loadWeeklyTasks().finally(() => hideGlobalLoading());
    }
    updateSharedWeekNav();
  }

  // 공통 네비게이터 레이블 갱신
  function updateSharedWeekNav() {
    const ws = getCurrentTabWeekStart();
    const rangeEl = document.getElementById('weekRangeLabel');
    const subEl   = document.getElementById('weekSubLabel');
    if (rangeEl) rangeEl.textContent = formatWeekRange(ws);
    if (subEl)   subEl.textContent   = isThisWeek(ws) ? '이번 주' : '';
  }

  // ── 월 캘린더 팝업 ───────────────────────────────────────────
  function toggleCalendarPopup() {
    const popup = document.getElementById('weekCalendarPopup');
    if (!popup) return;
    if (popup.classList.contains('open')) {
      popup.classList.remove('open');
    } else {
      // 현재 탭의 주차 기준으로 팝업 달력 초기화
      const ws = getCurrentTabWeekStart();
      calendarPopupMonth = ws.substring(0, 7); // 'yyyy-MM'
      renderCalendarPopup();
      popup.classList.add('open');
    }
  }

  function renderCalendarPopup() {
    const [year, month] = calendarPopupMonth.split('-').map(Number);
    const titleEl = document.getElementById('wcpMonthTitle');
    const gridEl  = document.getElementById('wcpGrid');
    if (!titleEl || !gridEl) return;

    titleEl.textContent = `${year}년 ${month}월`;

    const todayStr       = formatDateStr(new Date());
    const currentWS      = getCurrentTabWeekStart();

    // 해당 월 1일의 요일 (0=일)
    const firstDay = new Date(year, month - 1, 1).getDay();
    // 해당 월 마지막 날
    const lastDate = new Date(year, month, 0).getDate();

    // 캘린더 시작일: 1일 기준 이전 일요일
    const startDate = new Date(year, month - 1, 1 - firstDay);

    // 6주 * 7일 = 42칸
    const totalCells = 42;
    let html = '';
    let weekStartDate = null;

    for (let i = 0; i < totalCells; i++) {
      const d = new Date(startDate);
      d.setDate(startDate.getDate() + i);
      const ds  = formatDateStr(d);
      const dow = d.getDay();

      // 일요일마다 주 행 시작
      if (dow === 0) {
        weekStartDate = ds;
        const isSelected = weekStartDate === currentWS;
        html += `<div class="wcp-week-row${isSelected ? ' is-selected' : ''}" data-week="${weekStartDate}">`;
      }

      const isCurrentMonth = (d.getMonth() + 1) === month;
      const isToday        = ds === todayStr;
      const isSun          = dow === 0;
      const isSat          = dow === 6;

      const cls = [
        'wcp-day',
        !isCurrentMonth ? 'is-other-month' : '',
        isToday         ? 'is-today'        : '',
        isSun           ? 'is-sunday'       : '',
        isSat           ? 'is-saturday'     : ''
      ].filter(Boolean).join(' ');

      html += `<span class="${cls}">${d.getDate()}</span>`;

      // 토요일마다 주 행 닫기
      if (dow === 6) html += `</div>`;
    }

    gridEl.innerHTML = html;

    // 주 행 클릭 이벤트
    gridEl.querySelectorAll('.wcp-week-row').forEach(row => {
      row.addEventListener('click', () => {
        const ws = row.dataset.week;
        document.getElementById('weekCalendarPopup').classList.remove('open');
        navigateWeekTo(ws);
        calendarPopupMonth = ws.substring(0, 7);
      });
    });
  }

  function getDaysOfWeek(weekStart) {
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(weekStart + 'T00:00:00');
      d.setDate(d.getDate() + i);
      return formatDateStr(d);
    });
  }

  // ── 업무에서 불러오기 ──────────────────────────────────────

  async function openImportTasksModal(mode = 'this') {
    // mode: 'this' = 이번 주(주간업무요약), 'next' = 다음 주(차주계획)
    const targetWeek = mode === 'next' ? offsetWeek(journalWeekStart, 1) : journalWeekStart;

    let items = [];
    if (mode === 'this' && journalWeekStart === weeklyWeekStart && weeklyTasks && weeklyTasks.length > 0) {
      items = weeklyTasks;
    } else if (mode === 'this' && currentJournalTasks && currentJournalTasks.items && currentJournalTasks.items.length > 0) {
      items = currentJournalTasks.items;
    } else {
      // 다음 주 또는 주차 불일치 시 직접 조회 — 스피너 표시 후 조회
      showGlobalLoading(mode === 'next' ? '차주 업무를 불러오는 중...' : '업무 목록을 불러오는 중...');
      try {
        const _taskItems = await sbGetTaskItems(currentUser.email, targetWeek, getWeekEnd(targetWeek));
        items = _taskItems;
      } catch(e) {
        showMessage('업무 목록을 불러오지 못했습니다.', 'error');
        return;
      } finally {
        hideGlobalLoading();
      }
    }

    // 모달 제목 및 안내문, 적용 대상 저장
    document.querySelector('#importTasksModal .task-modal-title').textContent =
      mode === 'next' ? '📥 차주 업무 계획 불러오기' : '📥 이번 주 업무 불러오기';
    const importDescEl = document.querySelector('#importTasksModal .task-modal-body > p');
    if (importDescEl) {
      importDescEl.textContent = mode === 'next'
        ? '다음 주 등록된 업무 중 차주 계획에 추가할 항목을 선택하세요.'
        : '이번 주 등록된 업무 중 주간 요약에 추가할 항목을 선택하세요.';
    }
    document.getElementById('importTasksModal').dataset.mode = mode;
    const listEl = document.getElementById('importTasksList');
    const selectAll = document.getElementById('importTasksSelectAll');
    if (selectAll) selectAll.checked = false;

    if (!items.length) {
      listEl.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:13px;">이번 주 등록된 업무가 없습니다.</div>';
    } else {
      const grouped = {};
      items.forEach(t => {
        const cat = CATEGORY_LABELS[t.category] || t.category || '기타';
        if (!grouped[cat]) grouped[cat] = [];
        grouped[cat].push(t);
      });

      const STATUS_KR = { TODO: '예정', IN_PROGRESS: '진행중', DONE: '완료' };
      const PRIORITY_COLOR = { HIGH: '#dc2626', MEDIUM: '#d97706', LOW: '#16a34a' };

      listEl.innerHTML = Object.keys(grouped).map(cat => `
        <div style="padding:6px 12px 2px;">
          <div style="font-size:11px;font-weight:700;color:var(--text-secondary);text-transform:uppercase;
            letter-spacing:0.05em;margin-bottom:4px;">${esc(cat)}</div>
          ${grouped[cat].map(t => `
            <label style="display:flex;align-items:flex-start;gap:10px;padding:7px 6px;border-radius:8px;
              cursor:pointer;transition:background 0.1s;" onmouseover="this.style.background='#f1f5f9'"
              onmouseout="this.style.background=''">
              <input type="checkbox" class="import-task-checkbox" data-task-id="${t.task_id}"
                style="width:15px;height:15px;margin-top:2px;cursor:pointer;flex-shrink:0;">
              <div style="flex:1;min-width:0;">
                <div style="display:flex;align-items:center;gap:6px;">
                  <span style="font-size:13px;font-weight:500;color:var(--text-primary);">${esc(t.title)}</span>
                  ${t.priority === 'HIGH' ? '<span style="font-size:10px;font-weight:700;color:#dc2626;">★</span>' : ''}
                </div>
                <div style="font-size:11px;color:var(--text-muted);margin-top:2px;">
                  ${esc(t.start_date)}${t.end_date && t.end_date !== t.start_date ? ' ~ ' + esc(t.end_date) : ''}
                  <span style="margin-left:6px;padding:1px 6px;border-radius:4px;background:#f1f5f9;
                    color:var(--text-secondary);">${STATUS_KR[t.status] || t.status}</span>
                </div>
              </div>
            </label>
          `).join('')}
        </div>
      `).join('');
    }

    // 적용 방식 초기화
    const appendRadio = document.querySelector('input[name="importMode"][value="append"]');
    if (appendRadio) appendRadio.checked = true;

    _openModal('importTasksModal');
  }

  async function applyImportTasks() {
    const checked = [...document.querySelectorAll('.import-task-checkbox:checked')];
    if (!checked.length) {
      showMessage('불러올 업무를 선택해주세요.', 'error');
      return;
    }

    const mode = document.querySelector('input[name="importMode"]:checked')?.value || 'append';
    const selectedIds = new Set(checked.map(cb => cb.dataset.taskId));
    const allItems = (weeklyTasks && weeklyTasks.length > 0)
      ? weeklyTasks
      : (currentJournalTasks?.items || []);
    const selectedItems = allItems.filter(t => selectedIds.has(t.task_id));

    // 적용 대상: 이번주 요약 or 차주 계획
    const importMode = document.getElementById('importTasksModal').dataset.mode || 'this';
    const targetWeekForText = importMode === 'next' ? offsetWeek(journalWeekStart, 1) : journalWeekStart;
    const newText    = buildDailyGroupedText(selectedItems, targetWeekForText, importMode === 'this');

    const targetEl = importMode === 'next'
      ? document.getElementById('journalNextPlan')
      : document.getElementById('journalSummary');
    if (!targetEl) return;

    if (mode === 'replace') {
      targetEl.value = newText;
    } else {
      const existing = targetEl.value.trim();
      targetEl.value = existing ? existing + '\n\n' + newText : newText;
    }

    // 일지가 없으면 자동 생성
    if (!currentJournal) {
      try {
        const createRes = ({ data: await sbGetOrCreateJournal(currentUser.email, journalWeekStart) });
        currentJournal      = createRes.data?.journal || null;
        currentJournalTasks = createRes.data?.tasks   || null;
      } catch(e) { /* 저장 시 생성됨 */ }
    }

    journalDirty = true;
    updateAutosaveStatus('saving');
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => saveJournal(true), 1500);  // 1.5초 후 자동저장

    _closeModal('importTasksModal');
    showMessage(`${selectedItems.length}개 업무를 불러왔습니다. 잠시 후 자동 저장됩니다.`, 'success');
  }

  // ── 자동 동기화 토글 초기화 ─────────────────────────────────
  function initAutoSyncToggle() {
    const autoSyncToggle = document.getElementById('journalAutoSyncToggle');
    if (!autoSyncToggle || autoSyncToggle._bound) return;
    autoSyncToggle._bound = true;
    autoSyncToggle.addEventListener('change', async function() {
      journalAutoSync = this.checked;
      updateAutoSyncToggleUI(journalAutoSync, true);
      try {
        setUserSettingLocal('journalAutoSync', journalAutoSync ? 'Y' : 'N');
        showMessage(journalAutoSync
          ? '업무일지 자동 동기화가 켜졌습니다.'
          : '업무일지 자동 동기화가 꺼졌습니다. 업무 요약을 직접 작성하세요.', 'success');
      } catch(e) {
        showMessage('설정 저장에 실패했습니다.', 'error');
        journalAutoSync = !journalAutoSync;
        autoSyncToggle.checked = journalAutoSync;
        updateAutoSyncToggleUI(journalAutoSync);
      }
    });
  }

  // ── 주간 업무 로드 ───────────────────────────────────────────
  // ── 팀뷰 토글 초기화 ─────────────────────────────────────────
  function initTeamViewToggle() {
    const toggle = document.getElementById('teamViewToggle');
    if (!toggle || toggle._bound) return;
    toggle._bound = true;

    toggle.addEventListener('change', async function () {
      teamViewEnabled = this.checked;
      updateTeamViewToggleUI(teamViewEnabled);
      showGlobalLoading(teamViewEnabled ? '부서원 업무를 불러오는 중...' : '업무 목록을 불러오는 중...');
      await loadWeeklyTasks().finally(() => hideGlobalLoading());
    });
  }

  function updateTeamViewToggleUI(isOn) {
    const slider = document.getElementById('teamViewSlider');
    const knob   = document.getElementById('teamViewKnob');
    const toggle = document.getElementById('teamViewToggle');
    if (!slider) return;
    slider.style.background = isOn ? '#0369a1' : '#cbd5e1';
    if (knob)   knob.style.left   = isOn ? '18px' : '2px';
    if (toggle) toggle.checked    = isOn;
  }


  /**
   * 업무 등록/수정/삭제/상태변경 후 자동 호출.
   * 이번 주 일지가 존재하고 CLOSED가 아닌 경우에만
   * summary / next_plan 을 백그라운드로 조용히 업데이트한다.
   * - 로딩 스피너 없음
   * - 실패해도 콘솔 경고만 (업무 작업 자체는 이미 성공)
   * - 일지 탭이 열려 있으면 화면도 즉시 갱신
   */
  // syncJournalIfExists → 백엔드 journalAutoSync_ 로 이전

  /**
   * 서버가 taskCreate/Update/Delete 응답에 포함한 journal로
   * 일지 탭 UI를 즉시 갱신하는 헬퍼.
   * 일지 탭이 열려있는 경우에만 summary textarea를 업데이트.
   */
  function onJournalAutoSynced(journal) {
    if (!journal) return;
    // 자동 동기화가 꺼져 있으면 UI 갱신 스킵
    if (!journalAutoSync) return;
    // 일지 탭이 같은 주차로 열려있으면 summary 즉시 반영
    const activeTab = document.querySelector('.task-tab-btn.active')?.dataset?.tab;
    if (activeTab === 'journal' && journalWeekStart === weeklyWeekStart && currentJournal) {
      currentJournal.summary = journal.summary;
      const el = document.getElementById('journalSummary');
      if (el && !document.activeElement !== el) {
        el.value = journal.summary;
      }
      updateAutosaveStatus('saved');
    }
  }


  /**
   * 업무 목록을 일별로 그룹화한 텍스트 생성
   * @param {Array}   items      - 업무 항목 배열
   * @param {string}  weekStart  - 해당 주 시작일 (yyyy-MM-dd)
   * 날짜 헤더 + 들여쓰기 구조로 통일 (이번주/다음주 동일 포맷)
   * 출력 예시:
   *   [05/19 월]
   *     🔴 [구매] 제목 (완료)
   *     🟡 [운영] 제목 (진행중)
   *
   *   [05/20 화]
   *     🟢 [시설] 제목 (예정)
   */
  // description 여러 줄 처리: 모든 줄을 동일한 들여쓰기(4공백)로 추가
  function pushDescription(lines, description) {
    const indent = '    ';  // 4공백
    const descLines = description.trim().split('\n');
    descLines.forEach(function(line) {
      lines.push(indent + line);
    });
  }

  // 엑셀 출력용 — 서브라인(들여쓰기 줄) 정규화
  // 맑은 고딕은 가변폭 폰트라 공백 수로 정렬이 어긋남.
  // • 줄: "  • ..."  서브줄: "        ..."
  /**
   * 엑셀 셀 자동 줄바꿈 시 들여쓰기 유지 함수
   *
   * 문제: wrapText:true 상태에서 긴 줄이 자동 줄바꿈되면
   *       두 번째 줄부터 들여쓰기 공백이 사라짐.
   *
   * 해결: 셀에 쓰기 전에 미리 강제 줄바꿈(\n)을 삽입하고,
   *       이어지는 줄(continuation)에 원래 줄의 들여쓰기를 그대로 붙임.
   *
   * @param {string} line      - 처리할 한 줄
   * @param {number} maxChars  - 셀 너비 기준 최대 글자 수 (기본 60)
   *                             Courier New 9pt, wch:65 기준으로 60자 설정
   *                             (한글 1자 ≈ 영문 2자 너비이므로 실제 적용 시 보정)
   */
  function wrapExcelLine(line, maxChars) {
    maxChars = maxChars || 60;

    // 선행 공백(들여쓰기) 추출
    const match   = line.match(/^(\s*)/);
    const indent  = match ? match[1] : '';
    const content = line.slice(indent.length);

    if (!content) return line;

    // 글자별 너비 추산: 한글/전각문자 = 2, 나머지 = 1
    function charWidth(ch) {
      const code = ch.charCodeAt(0);
      return (code >= 0x1100 && code <= 0xFFEE) ? 2 : 1;
    }
    function strWidth(s) {
      let w = 0;
      for (let i = 0; i < s.length; i++) w += charWidth(s[i]);
      return w;
    }

    const indentWidth    = strWidth(indent);
    const firstLineMax   = maxChars - indentWidth;
    // continuation 줄 들여쓰기: indent + 추가 2칸
    const contIndent     = indent + '  ';
    const contWidth      = strWidth(contIndent);
    const contMax        = maxChars - contWidth;

    const result = [];
    let remaining = content;
    let isFirst   = true;

    while (remaining.length > 0) {
      const limit = isFirst ? firstLineMax : contMax;
      let   taken = 0;
      let   w     = 0;

      while (taken < remaining.length) {
        const cw = charWidth(remaining[taken]);
        if (w + cw > limit) break;
        w    += cw;
        taken++;
      }

      // 단어 경계에서 자르기 (공백 기준)
      if (taken < remaining.length && taken > 0) {
        const spaceIdx = remaining.lastIndexOf(' ', taken);
        if (spaceIdx > 0) taken = spaceIdx + 1;
      }

      const chunk = remaining.slice(0, taken).trimEnd();
      result.push((isFirst ? indent : contIndent) + chunk);
      remaining = remaining.slice(taken).trimStart();
      isFirst   = false;
    }

    return result.join('\n');
  }

  /**
   * 줄 배열 전체에 wrapExcelLine 적용
   */
  function wrapExcelLines(lines, maxChars) {
    return lines.map(function(l) { return wrapExcelLine(l, maxChars); }).join('\n');
  }

  function normalizeSubLinesForExcel(line) {
    const trimmed = line.trim();
    // 들여쓰기 4자 이상으로 시작하며 bullet/섹션헤더가 아닌 줄
    if (/^ {4,}/.test(line) && !trimmed.startsWith('•') && !trimmed.startsWith('[') && trimmed !== '') {
      return '    ' + trimmed;
    }
    return line;
  }

  // 서브라인(description 들여쓰기 줄) 판별 (extractCategorySection의 while 조건용)
  function isSubLine(line) {
    if (!line) return false;
    const trimmed = line.trim();
    if (/^ {4,}/.test(line) && !trimmed.startsWith('•') && !trimmed.startsWith('[') && trimmed !== '') return true;
    return false;
  }

  function buildDailyGroupedText(items, weekStart, showStatus) {
    if (!items || items.length === 0) return '';

    const DOW_LABEL = ['일', '월', '화', '수', '목', '금', '토'];
    const weekEnd   = getWeekEnd(weekStart);
    const lines     = [];

    // 이번 주 시작 업무 vs 이월 분리
    const thisWeekItems  = [];
    const carryOverItems = [];
    items.forEach(function(t) {
      const s = t.start_date || '';
      if (s >= weekStart && s <= weekEnd) thisWeekItems.push(t);
      else carryOverItems.push(t);
    });

    // 중요도 정렬
    const PRI_ORDER = { HIGH: 0, MEDIUM: 1, LOW: 2 };
    function sortByPri(a, b) {
      const pa = PRI_ORDER[(a.priority || 'MEDIUM').toUpperCase()] ?? 1;
      const pb = PRI_ORDER[(b.priority || 'MEDIUM').toUpperCase()] ?? 1;
      if (pa !== pb) return pa - pb;
      return (a.start_date || '').localeCompare(b.start_date || '');
    }

    // 카테고리 순서
    const CAT_ORDER = Object.keys(CATEGORY_LABELS);
    function catIndex(t) {
      const i = CAT_ORDER.indexOf(t.category || 'ETC');
      return i === -1 ? 99 : i;
    }

    // ── 1) 카테고리로 먼저 묶고, 그 안에 날짜 표기
    const catMap = {};
    const catOrder = [];
    thisWeekItems.forEach(function(t) {
      const cat = t.category || 'ETC';
      if (!catMap[cat]) { catMap[cat] = []; catOrder.push(cat); }
      catMap[cat].push(t);
    });

    // 카테고리 정의 순서로 정렬
    catOrder.sort(function(a, b) {
      return catIndex({ category: a }) - catIndex({ category: b });
    });

    catOrder.forEach(function(cat, catIdx) {
      const catLabel = CATEGORY_LABELS[cat] || cat || '기타';
      const group    = catMap[cat].slice().sort(sortByPri);

      if (catIdx > 0) lines.push('');
      lines.push('[' + catLabel + ']');

      // 날짜별 소그룹
      const dayMap = {};
      const dayOrder = [];
      group.forEach(function(t) {
        const d = t.start_date || '';
        if (!dayMap[d]) { dayMap[d] = []; dayOrder.push(d); }
        dayMap[d].push(t);
      });
      dayOrder.sort();

      dayOrder.forEach(function(dateStr) {
        const dayItems = dayMap[dateStr];
        const d        = new Date(dateStr + 'T00:00:00');
        const dow      = d.getDay();
        const mmdd     = dateStr.substring(5).replace('-', '/');

        lines.push('  ' + mmdd + ' (' + DOW_LABEL[dow] + ')');

        let num = 1;
        dayItems.forEach(function(t) {
          const priTag       = t.priority === 'HIGH' ? ' *' : '';
          const statusLabel  = t.status === 'DONE' ? '완료' : t.status === 'IN_PROGRESS' ? '진행중' : '예정';
          const statusSuffix = showStatus ? '  [' + statusLabel + ']' : '';
          const dateRange    = (t.start_date !== t.end_date)
            ? '  ' + t.start_date.substring(5).replace('-','/') + ' ~ ' + t.end_date.substring(5).replace('-','/')
            : '';

          lines.push('  • ' + t.title + priTag + statusSuffix + dateRange);
          if (t.description && t.description.trim()) {
            pushDescription(lines, t.description);
          }
          num++;
        });
      });
    });

    // ── 2) 이월 업무
    if (carryOverItems.length > 0) {
      lines.push('');
      lines.push('── 이월 업무 ──');

      const completedCarry = carryOverItems.filter(function(t) {
        return t.end_date <= weekEnd && t.status === 'DONE';
      }).sort(function(a,b){ return catIndex(a)-catIndex(b) || sortByPri(a,b); });

      const ongoingCarry = carryOverItems.filter(function(t) {
        return !(t.end_date <= weekEnd && t.status === 'DONE');
      }).sort(function(a,b){ return catIndex(a)-catIndex(b) || sortByPri(a,b); });

      if (ongoingCarry.length > 0) {
        lines.push('');
        ongoingCarry.forEach(function(t, idx) {
          const catLabel  = CATEGORY_LABELS[t.category] || t.category || '기타';
          const endLabel  = t.end_date > weekEnd ? '계속' : '진행중';
          const dateRange = t.start_date.substring(5).replace('-','/') + ' ~ ' + t.end_date.substring(5).replace('-','/');
          lines.push('  • [' + catLabel + ']  ' + t.title + '  [' + endLabel + ']  ' + dateRange);
          if (t.description && t.description.trim()) pushDescription(lines, t.description);
        });
      }

      if (completedCarry.length > 0) {
        if (ongoingCarry.length > 0) lines.push('');
        completedCarry.forEach(function(t, idx) {
          const catLabel  = CATEGORY_LABELS[t.category] || t.category || '기타';
          const dateRange = t.start_date.substring(5).replace('-','/') + ' ~ ' + t.end_date.substring(5).replace('-','/');
          lines.push('  • [' + catLabel + ']  ' + t.title + '  [완료]  ' + dateRange);
          if (t.description && t.description.trim()) pushDescription(lines, t.description);
        });
      }
    }

    return lines.join('\n');
  }


  // ── 주간업무 로드 ────────────────────────────────────────────
  async function loadWeeklyTasks() {
    updateSharedWeekNav();

    weeklyTasks = [];
    updateWeeklySummary();
    document.getElementById('weekTimeline').innerHTML = '';

    try {
      if (teamViewEnabled) {
        // 내 업무 + 팀원 업무 병렬 조회
        const [tasksRes, teamRes] = await Promise.all([
          (async()=>{const _d=await sbGetTaskItems(currentUser.email,weeklyWeekStart,getWeekEnd(weeklyWeekStart));return{data:_d};})(),
          (async()=>{const _d=await sbGetTeamTaskItems(currentUser.team_code,weeklyWeekStart,getWeekEnd(weeklyWeekStart));return{data:_d};})().catch(() => ({ data: [] }))
        ]);
        weeklyTasks     = tasksRes.data || [];
        teamWeeklyTasks = (teamRes.data || []).filter(t => t.user_email !== currentUser.email);
      } else {
        const tasksRes = { data: await sbGetTaskItems(currentUser.email, weeklyWeekStart, getWeekEnd(weeklyWeekStart)) };
        weeklyTasks     = tasksRes.data || [];
        teamWeeklyTasks = [];
      }
      renderWeekTimeline();
      updateWeeklySummary();

    } catch (err) {
      showMessage(err.message || '업무 목록을 불러오지 못했습니다.', 'error');
      document.getElementById('weekTimeline').innerHTML = `
        <div class="task-empty task-empty--error">
          <div class="task-empty-icon">⚠️</div>
          <div class="task-empty-text">불러오기 실패. 다시 시도해 주세요.</div>
        </div>`;
    }
  }



  function updateWeeklySummary() {
    const total  = weeklyTasks.length;
    const done   = weeklyTasks.filter(t => t.status === 'DONE').length;
    const inProg = weeklyTasks.filter(t => t.status === 'IN_PROGRESS').length;
    const high   = weeklyTasks.filter(t => t.priority === 'HIGH').length;
    const pct    = total ? Math.round(done / total * 100) : 0;

    document.getElementById('summTotal').textContent      = total;
    document.getElementById('summDone').textContent       = done;
    document.getElementById('summInProgress').textContent = inProg;
    document.getElementById('summHigh').textContent       = high;
    document.getElementById('progressBar').style.width    = `${pct}%`;
  }

  function renderWeekTimeline() {
    const days      = getDaysOfWeek(weeklyWeekStart);
    const todayStr  = formatDateStr(new Date());
    const container = document.getElementById('weekTimeline');

    // 팀뷰 안내 배너
    const teamBanner = (teamViewEnabled && teamWeeklyTasks.length > 0)
      ? `<div class="team-view-banner">
           <span class="team-view-banner-icon">👥</span>
           <span class="team-view-banner-text">부서원 업무는 <strong>읽기 전용</strong>입니다.</span>
         </div>`
      : '';

    container.innerHTML = teamBanner + days.map(dateStr => {
      const d      = new Date(dateStr + 'T00:00:00');
      const dayNum = d.getDate();
      const dow    = d.getDay();
      const isToday = dateStr === todayStr;
      const isSun   = dow === 0;
      const isSat   = dow === 6;

      // 내 업무 — 기간 업무는 시작일에만 표시
      const dayTasks = weeklyTasks.filter(t => {
        return (t.start_date || '') === dateStr;
      });

      // 팀원 업무 (팀뷰 활성 시) — 중요도 > 이름순 정렬
      const _PRI_ORDER = { HIGH: 0, MEDIUM: 1, LOW: 2 };
      const dayTeamTasks = (teamViewEnabled)
        ? teamWeeklyTasks.filter(t => {
            return (t.start_date || '') === dateStr;
          }).sort((a, b) => {
            const pa = _PRI_ORDER[(a.priority || 'MEDIUM').toUpperCase()] ?? 1;
            const pb = _PRI_ORDER[(b.priority || 'MEDIUM').toUpperCase()] ?? 1;
            if (pa !== pb) return pa - pb;
            const ca = (CATEGORY_LABELS[a.category] || a.category || '');
            const cb = (CATEGORY_LABELS[b.category] || b.category || '');
            if (ca !== cb) return ca.localeCompare(cb, 'ko');
            return (a.user_name || a.user_email || '').localeCompare(b.user_name || b.user_email || '', 'ko');
          })
        : [];

      const total  = dayTasks.length;
      const done   = dayTasks.filter(t => t.status === 'DONE').length;
      const high   = dayTasks.filter(t => t.priority === 'HIGH').length;
      const medium = dayTasks.filter(t => t.priority === 'MEDIUM').length;
      const low    = dayTasks.filter(t => t.priority === 'LOW').length;

      const memberCount = dayTeamTasks.length;

      const dayProgress = total === 0
        ? `<span class="day-empty-label">업무 없음</span>`
        : `<div class="day-progress-wrap">
            <span class="day-progress-count">${done}/${total} 완료</span>
            ${high   > 0 ? `<span class="day-priority-badge high">높음 ${high}</span>`   : ''}
            ${medium > 0 ? `<span class="day-priority-badge medium">보통 ${medium}</span>` : ''}
            ${low    > 0 ? `<span class="day-priority-badge low">낮음 ${low}</span>`    : ''}
          </div>`;

      const memberBadge = memberCount > 0
        ? `<span class="day-member-badge">👥 부서원 ${memberCount}</span>`
        : '';

      const taskItems = dayTasks.map(t => renderTaskItem(t, dateStr)).join('');

      // 팀원 업무 — 중요도별 그룹 헤더
      const PRI_GROUPS = [
        { key: 'HIGH',   label: '높음', cls: 'high'   },
        { key: 'MEDIUM', label: '보통', cls: 'medium' },
        { key: 'LOW',    label: '낮음', cls: 'low'    }
      ];
      let teamSectionHtml = '';
      if (dayTeamTasks.length > 0) {
        const groupHtml = PRI_GROUPS.map(g => {
          const items = dayTeamTasks.filter(t => (t.priority || 'MEDIUM').toUpperCase() === g.key);
          if (!items.length) return '';
          return `
            <div class="team-pri-group">
              <div class="team-pri-group-header team-pri-group-header--${g.cls}">
                <span class="team-pri-group-dot"></span>${g.label}
              </div>
              ${items.map(t => renderTeamTaskItem(t, dateStr)).join('')}
            </div>`;
        }).join('');
        teamSectionHtml = `<div class="team-task-section">
          <div class="team-task-section-label team-task-section-label--team">👥 부서원 업무</div>
          ${groupHtml}
        </div>`;
      }

      const hasContent  = dayTasks.length > 0 || dayTeamTasks.length > 0;
      const showExpand  = isToday || hasContent;

      const headClasses = ['day-row-head',
        isToday ? 'is-today'    : '',
        isSun   ? 'is-sunday'   : '',
        isSat   ? 'is-saturday' : ''
      ].filter(Boolean).join(' ');

      const teamSection = teamSectionHtml;

      return `
        <div class="day-row">
          <div class="${headClasses}" onclick="TASK_APP.toggleDay('day-tasks-${dateStr}')">
            <div class="day-label">
              <div class="day-date">
                <span class="day-date-num">${dayNum}</span>
                <span class="day-date-dow">${DOW_KR[dow]}</span>
              </div>
              <div class="day-task-chips">
                ${dayProgress}
                ${memberBadge}
              </div>
            </div>
            <div class="day-row-add">
              <button class="day-add-btn" onclick="event.stopPropagation();TASK_APP.openAddModal('${dateStr}')">
                + 추가
              </button>
            </div>
          </div>
          <div class="day-tasks" id="day-tasks-${dateStr}" style="${showExpand ? '' : 'display:none;'}">
            ${teamSectionHtml
              ? `<div class="team-task-section" style="border-top:none;padding-top:0;">
                   <div class="team-task-section-label team-task-section-label--mine">👤 내 업무</div>
                   ${taskItems || `<div style="padding:8px 16px;"><span style="font-size:12px;color:var(--text-muted);">등록된 업무가 없습니다.</span></div>`}
                 </div>`
              : taskItems || `<div class="task-empty" style="padding:16px;"><span style="font-size:12px;color:var(--text-muted);">등록된 업무가 없습니다.</span></div>`
            }
            ${teamSection}
          </div>
        </div>
      `;
    }).join('');
  }

  function renderTaskItem(t, dateStr) {
    const priorityCls = t.priority === 'HIGH' ? 'priority-high' : t.priority === 'LOW' ? 'priority-low' : 'priority-medium';
    const isSingleDay = !t.end_date || t.start_date === t.end_date;

    const displayStatus = STATUS_LABELS[t.status] || t.status;
    const statusCls     = t.status === 'DONE' ? 'badge-status-done'
                        : t.status === 'IN_PROGRESS' ? 'badge-status-inprogress'
                        : 'badge-status-todo';
    const isDone = t.status === 'DONE';

    // 기간 업무 종료일 표기
    const endTag = !isSingleDay
      ? `<span class="task-period-end">~ ${esc(t.end_date ? t.end_date.substring(5).replace('-', '/') : '')}</span>`
      : '';

    return `
      <div class="task-item${isDone ? ' is-done' : ''}" onclick="TASK_APP.openEditModal('${esc(t.task_id)}')">
        <span class="task-priority-dot ${priorityCls}"></span>
        <div class="task-item-body">
          <div class="task-item-title">${esc(t.title)}</div>
          <div class="task-item-meta">
            <span class="task-badge badge-category">${esc(CATEGORY_LABELS[t.category] || t.category)}</span>
            <span class="task-badge ${statusCls}">${esc(displayStatus)}</span>
            ${endTag}
            ${t.description ? `<span class="task-item-desc">${esc(t.description)}</span>` : ''}
          </div>
        </div>
        <div class="task-item-actions" onclick="event.stopPropagation();">
          <button class="task-icon-btn ${t.status === 'DONE' ? 'done' : ''}" onclick="TASK_APP.toggleTaskStatus('${esc(t.task_id)}')">
            ${t.status === 'DONE' ? '↩ 되돌리기' : '✓ 완료'}
          </button>
          <button class="task-icon-btn danger" onclick="TASK_APP.deleteTask('${esc(t.task_id)}')">
            🗑 삭제
          </button>
        </div>
      </div>
    `;
  }

  // ── 팀원 업무 아이템 (읽기 전용) ────────────────────────────
  function renderTeamTaskItem(t, dateStr) {
    const priorityCls  = t.priority === 'HIGH' ? 'priority-high' : t.priority === 'LOW' ? 'priority-low' : 'priority-medium';
    const isSingleDay  = !t.end_date || t.start_date === t.end_date;

    const displayStatus = STATUS_LABELS[t.status] || t.status;
    const statusCls     = t.status === 'DONE' ? 'badge-status-done'
                        : t.status === 'IN_PROGRESS' ? 'badge-status-inprogress'
                        : 'badge-status-todo';

    const isDone     = t.status === 'DONE';
    const ownerName  = esc(t.user_name || t.user_email || '팀원');
    const clinicName = esc(t.work_clinic_name || t.clinic_name || '');
    const ownerBadge = clinicName
      ? `<span class="task-owner-tag">${clinicName} · ${ownerName}</span>`
      : `<span class="task-owner-tag">${ownerName}</span>`;

    return `
      <div class="task-item task-item--readonly${isDone ? ' is-done' : ''}"
           title="${ownerName}의 업무"
           onclick="TASK_APP.openTeamTaskModal('${esc(t.task_id)}')">
        <span class="task-priority-dot ${priorityCls}"></span>
        <div class="task-item-body">
          <div class="task-item-title">
            ${esc(t.title)}
          </div>
          <div class="task-item-meta">
            <span class="task-badge badge-category">${esc(CATEGORY_LABELS[t.category] || t.category)}</span>
            <span class="task-badge ${statusCls}">${esc(displayStatus)}</span>
            ${ownerBadge}
            ${!isSingleDay
              ? `<span style="font-size:11px;color:var(--text-muted);">${esc(t.start_date ? t.start_date.substring(5) : '')} ~ ${esc(t.end_date ? t.end_date.substring(5) : '')}</span>`
              : ''}
            ${t.description ? `<span class="task-item-desc">${esc(t.description)}</span>` : ''}
          </div>
        </div>
        <button class="team-task-detail-btn" onclick="event.stopPropagation();TASK_APP.openTeamTaskModal('${esc(t.task_id)}')">
          🔍 상세
        </button>
      </div>
    `;
  }

  // ── 팀원 업무 상세 보기 모달 (읽기 전용) ─────────────────────
  window.TASK_APP.openTeamTaskModal = function(taskId) {
    const task = teamWeeklyTasks.find(t => t.task_id === taskId);
    if (!task) return;

    const ownerName  = task.user_name || task.user_email || '팀원';
    const isSingle   = !task.end_date || task.end_date === task.start_date;
    const dateRange  = isSingle ? task.start_date : `${task.start_date} ~ ${task.end_date}`;
    const workClinic = task.work_clinic_name || task.clinic_name || '';

    const priCls   = { HIGH: 'priority-high', MEDIUM: 'priority-medium', LOW: 'priority-low' };
    const priLabel = { HIGH: '높음', MEDIUM: '보통', LOW: '낮음' };
    const stCls    = { TODO: 'badge-status-todo', IN_PROGRESS: 'badge-status-inprogress', DONE: 'badge-status-done' };
    const stLabel  = { TODO: '예정', IN_PROGRESS: '진행중', DONE: '완료' };

    const pri = (task.priority || 'MEDIUM').toUpperCase();
    const st  = (task.status  || 'TODO').toUpperCase();
    const cat = CATEGORY_LABELS[task.category] || task.category || '';

    // 제목 + 소유자
    document.getElementById('teamTaskModalTitle').textContent = task.title || '';
    document.getElementById('teamTaskModalOwner').textContent = ownerName;

    // 날짜 / 의원
    document.getElementById('teamTaskModalDate').textContent   = dateRange;
    document.getElementById('teamTaskModalClinic').textContent = workClinic;

    // 메타 칩 행 (업무구분 · 중요도 · 상태)
    const metaRow = document.getElementById('teamTaskModalMetaRow');
    if (metaRow) {
      metaRow.innerHTML = `
        <span class="task-badge badge-category">${esc(cat)}</span>
        <span class="task-badge team-modal-pri-badge ${priCls[pri]}">
          <span class="task-priority-dot ${priCls[pri]}" style="width:7px;height:7px;flex-shrink:0;"></span>
          ${esc(priLabel[pri] || pri)}
        </span>
        <span class="task-badge ${stCls[st]}">${esc(stLabel[st] || st)}</span>
      `;
    }

    // 상세 내용 — innerHTML + 공백 보존
    const descWrap = document.getElementById('teamTaskModalDescWrap');
    const descEl   = document.getElementById('teamTaskModalDesc');
    if (task.description && task.description.trim()) {
      // 줄바꿈·들여쓰기 보존: 공백→&nbsp; 변환 없이 pre-wrap CSS로 처리
      descEl.textContent = task.description;
      if (descWrap) descWrap.style.display = '';
    } else {
      if (descWrap) descWrap.style.display = 'none';
    }

    _openModal('teamTaskModal');
  };


  // 자동 동기화 토글 UI 업데이트
  // instant=true: 애니메이션 없이 즉시 전환 (초기 로드 시)
  function updateAutoSyncToggleUI(isOn, instant = false) {
    const slider = document.getElementById('journalAutoSyncSlider');
    const knob   = document.getElementById('journalAutoSyncKnob');
    const toggle = document.getElementById('journalAutoSyncToggle');
    if (!slider) return;
    if (instant) {
      slider.style.transition = 'none';
      if (knob) knob.style.transition = 'none';
      // 다음 프레임에 transition 복원
      requestAnimationFrame(() => {
        slider.style.transition = '';
        if (knob) knob.style.transition = '';
      });
    }
    slider.style.background = isOn ? '#0369a1' : '#cbd5e1';
    if (knob) knob.style.left = isOn ? '18px' : '2px';
    if (toggle) toggle.checked = isOn;
  }

  // 앱 초기화 시 사용자 설정 로드
  async function loadUserSettings() {
    if (_userSettingsLoaded) return;  // 이미 로드됐으면 스킵
    try {
      const _sv = getUserSettingLocal('journalAutoSync');
      journalAutoSync = (_sv === null) ? true : _sv !== 'N';
      updateAutoSyncToggleUI(journalAutoSync);
      _userSettingsLoaded = true;
    } catch(e) {
      // API 미등록 또는 오류 — 기본값(켜짐) 유지
      journalAutoSync = true;
      updateAutoSyncToggleUI(true, true);
      _userSettingsLoaded = true;
      console.warn('[loadUserSettings] 설정 로드 실패:', e.message || e);
    }
  }

  async function loadJournal() {
    updateSharedWeekNav();
    clearAutosave();

    showGlobalLoading('업무일지를 불러오는 중...');

    // 버튼·배지·텍스트 초기화
    document.getElementById('autosaveText').textContent = '불러오는 중...';
    document.getElementById('journalSaveBtn').style.display   = 'none';
    document.getElementById('journalSubmitBtn').style.display = 'none';
    document.getElementById('journalCloseBtn').style.display  = 'none';
    const badgeEl = document.getElementById('journalStatusBadge');
    badgeEl.className   = 'journal-status-badge journal-status-draft';
    badgeEl.textContent = '-';
    document.getElementById('journalStatusText').textContent =
      `${journalWeekStart} ~ ${getWeekEnd(journalWeekStart)}`;

    try {
      const nextWeekStart = offsetWeek(journalWeekStart, 1);

      // 이번 주 일지 + 다음 주 일지 병렬 조회
      const [res, nextRes] = await Promise.all([
        (async()=>{const{data}=await supabaseClient.from('task_journals').select('*').eq('user_email',currentUser.email).eq('week_start',journalWeekStart).maybeSingle();return{data};})(),
        (async()=>{const{data}=await supabaseClient.from('task_journals').select('*').eq('user_email',currentUser.email).eq('week_start',nextWeekStart).maybeSingle();return{data};})().catch(()=>null)
      ]);

      currentJournal      = res.data.journal;
      currentJournalTasks = res.data.tasks;
      currentNextJournal  = nextRes?.data?.journal || null;

      renderJournal();
      renderJournalTaskSummary();

    } catch (err) {
      showMessage(err.message || '일지를 불러오지 못했습니다.', 'error');
      document.getElementById('autosaveText').textContent = '불러오기 실패';
    } finally {
      hideGlobalLoading();
    }
  }

  function renderJournal() {
    const todayWeekStart = getWeekStart(formatDateStr(new Date()));
    const isPastWeek     = journalWeekStart < todayWeekStart;

    if (!currentJournal) {
      const weekEnd = getWeekEnd(journalWeekStart);
      document.getElementById('journalStatusBadge').className = 'journal-status-badge journal-status-draft';
      document.getElementById('journalStatusBadge').textContent = '-';
      document.getElementById('journalStatusText').textContent = `${journalWeekStart} ~ ${weekEnd}`;

      if (isPastWeek) {
        // 과거 주 — 일지 없음, 입력 불가
        document.getElementById('journalSaveBtn').style.display   = 'none';
        document.getElementById('journalSubmitBtn').style.display = 'none';
        document.getElementById('journalCloseBtn').style.display  = 'none';

        ['attendanceThisWeek','attendanceNextWeek','journalSummary',
         'journalNextPlan','journalIssues'].forEach(id => {
          const el = document.getElementById(id);
          if (el) { el.value = ''; el.disabled = true; el.placeholder = '해당 주에 작성된 일지가 없습니다.'; }
        });
        ['earlyWorkThis','earlyWorkNext','satWorkThis','satWorkNext'].forEach(id => {
          const el = document.getElementById(id);
          if (el) { el.checked = false; el.disabled = true; }
        });
        document.getElementById('autosaveText').textContent = '해당 주에 작성된 일지가 없습니다.';
        return;
      }

      // 현재/미래 주 — 일지 없어도 입력 가능 (저장 시 자동 생성)
      document.getElementById('journalSaveBtn').style.display   = '';
      document.getElementById('journalSubmitBtn').style.display = 'none'; // 저장 후 제출 가능
      document.getElementById('journalCloseBtn').style.display  = 'none';

      const PLACEHOLDER = {
        attendanceThisWeek: '이번 주 근태 특이사항을 입력하세요.',
        attendanceNextWeek: '다음 주 근태 예정을 입력하세요.',
        journalSummary:     '주간 업무 요약을 입력하세요.',
        journalNextPlan:    '다음 주 업무 계획을 작성해 주세요.',
        journalIssues:      '이슈 및 건의사항을 입력하세요.'
      };
      Object.entries(PLACEHOLDER).forEach(([id, ph]) => {
        const el = document.getElementById(id);
        if (el) {
          el.value       = '';
          el.disabled    = false;
          el.placeholder = ph;
        }
      });
      ['earlyWorkThis','earlyWorkNext','satWorkThis','satWorkNext'].forEach(id => {
        const el = document.getElementById(id);
        if (el) { el.checked = false; el.disabled = false; }
      });
      document.getElementById('autosaveText').textContent = '업무를 등록하거나 직접 작성 후 저장하세요.';
      // 저장 버튼 클릭 시 일지 자동 생성 후 저장되도록 saveJournal이 처리
      return;
    }

    const j      = currentJournal;
    const status   = j.status || 'DRAFT';
    const isClosed = status === 'CLOSED';

    // 상태 배지
    const badgeEl = document.getElementById('journalStatusBadge');
    badgeEl.className = 'journal-status-badge';
    if (status === 'SUBMITTED') {
      badgeEl.classList.add('journal-status-submitted');
      badgeEl.textContent = '제출됨';
    } else if (status === 'CLOSED') {
      badgeEl.classList.add('journal-status-closed');
      badgeEl.textContent = '마감됨';
    } else {
      badgeEl.classList.add('journal-status-draft');
      badgeEl.textContent = '작성중';
    }

    // 부제목
    const weekEnd = getWeekEnd(journalWeekStart);
    document.getElementById('journalStatusText').textContent =
      `${journalWeekStart} ~ ${weekEnd}` +
      (j.submitted_at ? ` · 제출: ${j.submitted_at.substring(0, 10)}` : '');

    // 버튼 표시
    const saveBtn   = document.getElementById('journalSaveBtn');
    const submitBtn = document.getElementById('journalSubmitBtn');
    const closeBtn  = document.getElementById('journalCloseBtn');

    saveBtn.style.display   = isClosed ? 'none' : '';
    submitBtn.style.display = isClosed || status === 'SUBMITTED' ? 'none' : '';
    closeBtn.style.display  = (isManager && !isEdit && !isClosed) ? '' : 'none';

    // 필드 채우기
    // next 관련 필드는 currentNextJournal(다음 주 일지)에서 읽음
    // 다음 주 일지가 없거나 마감됐으면 이번 주 일지의 old 필드로 폴백
    const nj          = currentNextJournal;
    const nextClosed  = nj && nj.status === 'CLOSED';
    const nextDisabled = isClosed || nextClosed;

    setField('earlyWorkThis',      j.early_work_this, isClosed);
    setField('satWorkThis',        j.sat_work_this,   isClosed);
    setField('attendanceThisWeek', j.attendance_this_week, isClosed);

    // 다음 주 필드: currentNextJournal.early_work_this/sat_work_this/attendance_this_week 우선
    setField('earlyWorkNext',      nj ? nj.early_work_this      : j.early_work_next,      nextDisabled);
    setField('satWorkNext',        nj ? nj.sat_work_this        : j.sat_work_next,        nextDisabled);
    setField('attendanceNextWeek', nj ? nj.attendance_this_week : j.attendance_next_week, nextDisabled);
    setField('journalSummary',      j.summary,      isClosed);
    // 차주계획: 다음 주 일지의 summary 우선, 없으면 next_plan (하위 호환)
    const nextPlanValue = (currentNextJournal && currentNextJournal.summary)
      ? currentNextJournal.summary
      : (j.next_plan || '');
    // 차주 업무 계획 — 수정 가능, CLOSED 시 disabled
    setField('journalNextPlan', nextPlanValue, isClosed);
    setField('journalIssues',       j.issues,       isClosed);

    updateAutosaveStatus('');
    journalDirty = false;
  }

  function setField(id, value, disabled) {
    const el = document.getElementById(id);
    if (!el) return;
    if (el.type === 'checkbox') {
      el.checked  = value === 'Y' || value === true;
      el.disabled = !!disabled;
    } else {
      el.value    = value || '';
      el.disabled = !!disabled;
    }
  }

  function renderJournalTaskSummary() {
    if (!currentJournalTasks) return;

    const s   = currentJournalTasks.summary || { total: 0, done: 0, in_progress: 0, todo: 0, high: 0 };
    const pct = s.total ? Math.round(s.done / s.total * 100) : 0;

    document.getElementById('journalTaskSummary').innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
        <span style="font-size:13px;font-weight:600;color:var(--navy);">전체 ${s.total}건</span>
        <span style="font-size:12px;color:#16a34a;">✓ 완료 ${s.done}</span>
        <span style="font-size:12px;color:#d97706;">⏳ 진행중 ${s.in_progress}</span>
        <span style="font-size:12px;color:#dc2626;">🔴 높은중요도 ${s.high}</span>
        <div style="flex:1;min-width:80px;height:6px;background:#dbeafe;border-radius:999px;overflow:hidden;">
          <div style="height:100%;width:${pct}%;background:linear-gradient(90deg,#0369a1,#38bdf8);border-radius:999px;"></div>
        </div>
        <span style="font-size:12px;color:var(--text-muted);">${pct}%</span>
      </div>
    `;

    const items = currentJournalTasks.items || [];
    if (!items.length) {
      document.getElementById('journalTaskList').textContent = '이번 주 등록된 업무가 없습니다.';
      return;
    }

    // 카테고리별 그룹
    const grouped = {};
    items.forEach(t => {
      const cat = CATEGORY_LABELS[t.category] || t.category || '기타';
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push(t);
    });

    const html = Object.keys(grouped).map(cat => {
      const taskHtml = grouped[cat].map(t => {
        const priorityColor = t.priority === 'HIGH' ? '#dc2626' : t.priority === 'LOW' ? '#16a34a' : '#d97706';
        const statusBadge = t.status === 'DONE'
          ? '<span style="font-size:10px;color:#15803d;background:#dcfce7;padding:1px 6px;border-radius:4px;">완료</span>'
          : t.status === 'IN_PROGRESS'
          ? '<span style="font-size:10px;color:#854d0e;background:#fef9c3;padding:1px 6px;border-radius:4px;">진행중</span>'
          : '<span style="font-size:10px;color:#475569;background:#f1f5f9;padding:1px 6px;border-radius:4px;">예정</span>';
        return `
          <div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid #f0f3f8;">
            <span style="width:7px;height:7px;border-radius:50%;background:${priorityColor};flex-shrink:0;"></span>
            <span style="flex:1;font-size:12px;color:var(--text-primary);">${esc(t.title)}</span>
            <span style="font-size:11px;color:var(--text-muted);">${t.start_date && t.start_date !== t.end_date ? t.start_date.substring(5) + ' ~ ' + (t.end_date ? t.end_date.substring(5) : '') : (t.start_date ? t.start_date.substring(5) : '')}</span>
            ${statusBadge}
          </div>
        `;
      }).join('');
      return `
        <div style="margin-bottom:12px;">
          <div style="font-size:11px;font-weight:700;color:#0369a1;margin-bottom:4px;">${esc(cat)}</div>
          ${taskHtml}
        </div>
      `;
    }).join('');

    document.getElementById('journalTaskList').innerHTML = html;
  }

  // ── 일지 입력/저장 ───────────────────────────────────────────
  const AUTOSAVE_DELAY    = 60000; // 1분
  const AUTOSAVE_RETRY_MS = 5000;  // 오류 시 5초 후 재시도
  let   autosaveRetryCount = 0;
  const AUTOSAVE_MAX_RETRY = 3;

  function onJournalInput() {
    journalDirty = true;
    updateAutosaveStatus('saving');
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => saveJournal(true), AUTOSAVE_DELAY);
  }

  function clearAutosave() {
    clearTimeout(autosaveTimer);
    autosaveTimer      = null;
    journalDirty       = false;
    autosaveRetryCount = 0;
  }

  // 토스트 알림 표시 — 마우스 이동 또는 키보드 입력 시 사라짐
  function showAutosaveToast(status) {
    let toast = document.getElementById('autosaveToast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'autosaveToast';
      document.body.appendChild(toast);
    }
    toast.className = 'autosave-toast autosave-toast--' + status;
    toast.textContent = status === 'saved'
      ? '✓  일지가 자동 저장되었습니다.'
      : '✕  자동 저장에 실패했습니다. 재시도 중...';

    clearTimeout(toast._hideTimer);
    // 기존 이벤트 제거 후 재등록
    if (toast._dismissMouseMove) document.removeEventListener('mousemove', toast._dismissMouseMove);
    if (toast._dismissKeydown)   document.removeEventListener('keydown',   toast._dismissKeydown);

    toast.classList.add('is-visible');

    const dismiss = () => {
      toast.classList.remove('is-visible');
      document.removeEventListener('mousemove', toast._dismissMouseMove);
      document.removeEventListener('keydown',   toast._dismissKeydown);
    };
    toast._dismissMouseMove = dismiss;
    toast._dismissKeydown   = dismiss;

    // 마우스 이동 / 키보드 입력 시 사라짐 (500ms 후 감지 시작 — 저장 직후 이벤트 무시)
    setTimeout(() => {
      document.addEventListener('mousemove', toast._dismissMouseMove, { once: true });
      document.addEventListener('keydown',   toast._dismissKeydown,   { once: true });
    }, 500);
  }

  function updateAutosaveStatus(status) {
    const dot  = document.getElementById('autosaveDot');
    const text = document.getElementById('autosaveText');
    if (!dot || !text) return;

    dot.className = 'autosave-dot' + (status ? ' ' + status : '');

    if      (status === 'saving') text.textContent = '저장 중...';
    else if (status === 'saved')  text.textContent = '저장됨';
    else if (status === 'error')  text.textContent = '저장 실패';
    else                          text.textContent = currentJournal?.updated_at
      ? '마지막 저장: ' + currentJournal.updated_at.substring(11, 16) : '-';

    // 자동저장 완료/실패 시 토스트 표시
    if (status === 'saved' || status === 'error') {
      showAutosaveToast(status);
    }
  }

  async function saveJournal(isAuto = false) {
    // 일지가 없으면 먼저 자동 생성 후 저장
    if (!currentJournal) {
      try {
        const createRes = ({ data: await sbGetOrCreateJournal(currentUser.email, journalWeekStart) });
        currentJournal      = createRes.data?.journal || null;
        currentJournalTasks = createRes.data?.tasks   || null;
        if (!currentJournal) return;
        renderJournal();
      } catch(e) {
        showMessage('일지 생성에 실패했습니다: ' + (e.message || e), 'error');
        return;
      }
    }

    // ── 이번 주 일지 payload (next 관련 필드 제외)
    const thisPayload = {
      request_user_email:   currentUser.email,
      journal_id:           currentJournal.journal_id,
      early_work_this:      document.getElementById('earlyWorkThis')?.checked ? 'Y' : 'N',
      sat_work_this:        document.getElementById('satWorkThis')?.checked   ? 'Y' : 'N',
      attendance_this_week: document.getElementById('attendanceThisWeek').value,
      summary:              document.getElementById('journalSummary').value,
      issues:               document.getElementById('journalIssues').value
    };

    // ── 다음 주 일지 payload (next 관련 필드만)
    const earlyNext    = document.getElementById('earlyWorkNext')?.checked ? 'Y' : 'N';
    const satNext      = document.getElementById('satWorkNext')?.checked   ? 'Y' : 'N';
    const attNext      = document.getElementById('attendanceNextWeek').value;
    const hasNextData  = earlyNext === 'Y' || satNext === 'Y' || attNext.trim();

    try {
      updateAutosaveStatus('saving');
      if (!isAuto) showGlobalLoading('저장 중...');

      // 이번 주 일지 저장
      const res = await (async()=>{const p=thisPayload;const{error}=await supabaseClient.from('task_journals').update({content:p.content,updated_at:new Date().toISOString()}).eq('user_email',p.request_user_email).eq('week_start',p.week_start);if(error)throw error;return{success:true};})();
      currentJournal.updated_at = res.data?.updated_at || '';

      // 다음 주 일지 — 데이터가 있으면 반드시 저장 (없으면 자동생성)
      // 차주 업무 계획 (journalNextPlan) 값 가져오기
      const nextPlanText = document.getElementById('journalNextPlan')?.value || '';

      if (hasNextData || currentNextJournal || nextPlanText.trim()) {
        const nextWeekStart = offsetWeek(journalWeekStart, 1);

        // 다음 주 일지 없으면 자동 생성
        if (!currentNextJournal) {
          const createRes = ({ data: await sbGetOrCreateJournal(currentUser.email, nextWeekStart) });
          currentNextJournal = createRes.data?.journal || null;
        }

        if (currentNextJournal && currentNextJournal.status !== 'CLOSED') {
          // 차주 일지 업데이트 (content만)
          if (currentNextJournal?.week_start) {
            await supabaseClient.from('task_journals').update({
              content: nextPlanText, updated_at: new Date().toISOString()
            }).eq('user_email', currentUser.email).eq('week_start', currentNextJournal.week_start);
          }
          currentNextJournal.early_work_this      = earlyNext;
          currentNextJournal.sat_work_this        = satNext;
          currentNextJournal.attendance_this_week = attNext;
          currentNextJournal.summary              = nextPlanText;
        }
      }

      journalDirty       = false;
      autosaveRetryCount = 0;
      updateAutosaveStatus('saved');
      if (!isAuto) showMessage('일지가 저장되었습니다.', 'success');
    } catch (err) {
      updateAutosaveStatus('error');
      if (!isAuto) {
        showMessage(err.message || '저장에 실패했습니다.', 'error');
      } else if (autosaveRetryCount < AUTOSAVE_MAX_RETRY) {
        autosaveRetryCount++;
        autosaveTimer = setTimeout(() => saveJournal(true), AUTOSAVE_RETRY_MS);
      }
    } finally {
      if (!isAuto) hideGlobalLoading();
    }
  }

  async function submitJournal() {
    if (!currentJournal) return;
    if (!confirm('일지를 제출하시겠습니까?\n제출 후에도 팀장이 마감하기 전까지 수정할 수 있습니다.')) return;

    try {
      showGlobalLoading('저장 및 제출 중...');
      await saveJournal(true);  // isAuto=true 로 호출 (스피너 중복 방지)
      await (async()=>{const{error}=await supabaseClient.from('task_journals').update({status:'SUBMITTED',submitted_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq('user_email',currentUser.email).eq('week_start',journalWeekStart);if(error)throw error;return{success:true};})();
      showMessage('일지가 제출되었습니다.', 'success');
      await loadJournal();
    } catch (err) {
      showMessage(err.message || '제출에 실패했습니다.', 'error');
    } finally {
      hideGlobalLoading();
    }
  }

  async function closeJournal() {
    if (!currentJournal) return;
    if (!confirm('일지를 마감하시겠습니까?\n마감 후에는 수정할 수 없습니다.')) return;

    try {
      showGlobalLoading('마감 중...');
      await (async()=>{const{error}=await supabaseClient.from('task_journals').update({status:'CLOSED',closed_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq('user_email',currentUser.email).eq('week_start',journalWeekStart);if(error)throw error;return{success:true};})();
      showMessage('일지가 마감되었습니다.', 'success');
      await loadJournal();
    } catch (err) {
      showMessage(err.message || '마감에 실패했습니다.', 'error');
    } finally {
      hideGlobalLoading();
    }
  }

  // ── 팀원 현황 로드 ────────────────────────────────────────────
  async function loadTeamJournals() {
    updateSharedWeekNav();
    document.getElementById('teamWeekLabel').textContent =
      `${teamWeekStart} ~ ${getWeekEnd(teamWeekStart)}`;

    try {
      const res = await (async()=>{const members=await sbGetTeamJournals(currentUser.team_code,teamWeekStart);return{data:members};})();
      renderTeamGrid(res.data || []);
    } catch (err) {
      document.getElementById('teamJournalGrid').innerHTML =
        `<div class="task-empty" style="grid-column:1/-1;"><div class="task-empty-icon">⚠️</div><div class="task-empty-text">${esc(err.message)}</div></div>`;
    }
  }

  function renderTeamGrid(members) {
    // 팀별 그룹 → 팀 내 팀장 우선 → 이름 가나다순
    const sorted = (members || []).slice().sort((a, b) => {
      const teamA = a.team_name || a.department || '';
      const teamB = b.team_name || b.department || '';
      if (teamA !== teamB) return teamA.localeCompare(teamB, 'ko');
      if (a.is_manager && !b.is_manager) return -1;
      if (!a.is_manager && b.is_manager) return 1;
      return (a.user_name || '').localeCompare(b.user_name || '', 'ko');
    });
    _lastTeamData = sorted;
    const grid = document.getElementById('teamJournalGrid');

    if (!sorted.length) {
      grid.innerHTML = `<div class="task-empty" style="grid-column:1/-1;"><div class="task-empty-icon">👥</div><div class="task-empty-text">팀원이 없습니다.</div></div>`;
      return;
    }

    let prevTeam = null;
    grid.innerHTML = sorted.map((m, idx) => {
      const s       = (m.task_summary && m.task_summary.summary) ? m.task_summary.summary : (m.task_summary || {});
      const pct     = s.total ? Math.round((s.done || 0) / s.total * 100) : 0;
      const jStatus = m.journal ? m.journal.status : null;
      const teamName = m.team_name || m.department || '기타';

      const statusBadge = !m.journal
        ? `<span style="font-size:10px;background:#fef2f2;color:#b91c1c;padding:2px 6px;border-radius:4px;">미작성</span>`
        : jStatus === 'CLOSED'
        ? `<span style="font-size:10px;background:#dcfce7;color:#166534;padding:2px 6px;border-radius:4px;">마감</span>`
        : jStatus === 'SUBMITTED'
        ? `<span style="font-size:10px;background:#dbeafe;color:#1e40af;padding:2px 6px;border-radius:4px;">제출</span>`
        : `<span style="font-size:10px;background:#f1f5f9;color:#64748b;padding:2px 6px;border-radius:4px;">작성중</span>`;

      const initial = (m.user_name || '?').charAt(0);

      let header = '';
      if (teamName !== prevTeam) {
        header = `<div class="team-dept-header">${esc(teamName)}</div>`;
        prevTeam = teamName;
      }

      return header + `
        <div class="team-member-card" onclick="TASK_APP.openMemberJournal(${idx})">
          <div class="team-member-card-head">
            <div class="member-avatar">${esc(initial)}</div>
            <div>
              <div class="member-info-name">${esc(m.user_name)}</div>
              <div class="member-info-dept">${esc(m.team_name || m.department || '')}</div>
            </div>
            ${m.is_manager ? '<span class="manager-crown" title="팀장">👑</span>' : ''}
            <div style="margin-left:auto;">${statusBadge}</div>
          </div>
          <div class="team-member-card-body">
            <div class="member-task-mini">
              <div class="mini-bar">
                <div class="mini-bar-fill" style="width:${pct}%;"></div>
              </div>
              <span class="member-task-count">
                ${s.done || 0}/${s.total || 0} 완료
                ${s.high ? `<span style="color:#dc2626;">·🔴${s.high}</span>` : ''}
              </span>
            </div>
            ${m.journal?.attendance_this_week ? `<div style="font-size:11px;color:var(--text-muted);margin-top:4px;">근태: ${esc(m.journal.attendance_this_week)}</div>` : ''}
            ${(m.journal?.early_work_this === 'Y' || m.journal?.sat_work_this === 'Y') ? `
              <div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:5px;">
                ${m.journal?.early_work_this === 'Y' ? `<span style="display:inline-flex;align-items:center;height:18px;padding:0 7px;border-radius:5px;font-size:10px;font-weight:600;background:#dbeafe;color:#1e40af;border:1px solid #bfdbfe;white-space:nowrap;">조출</span>` : ''}
                ${m.journal?.sat_work_this   === 'Y' ? `<span style="display:inline-flex;align-items:center;height:18px;padding:0 7px;border-radius:5px;font-size:10px;font-weight:600;background:#dbeafe;color:#1e40af;border:1px solid #bfdbfe;white-space:nowrap;">토요근무</span>` : ''}
              </div>` : ''}
          </div>
        </div>
      `;
    }).join('');
  }

  // ── 팀원 일지 모달 ────────────────────────────────────────────

  window.TASK_APP.openMemberJournal = async function(idx) {
    const m = _lastTeamData[idx];
    if (!m) return;

    const j     = m.journal;
    const tasks = (m.task_summary && m.task_summary.summary) ? m.task_summary.summary : (m.task_summary || {});

    // ── 모달 즉시 열기: 제목 + 스피너 먼저 표시
    const statusMap   = { DRAFT: '작성중', SUBMITTED: '제출됨', CLOSED: '마감됨' };
    const statusColor = { DRAFT: '#64748b', SUBMITTED: '#0369a1', CLOSED: '#16a34a' };
    const status      = j ? (j.status || 'DRAFT') : null;
    document.getElementById('memberJournalTitle').innerHTML =
      `${esc(m.user_name)}<span style="font-size:11px;font-weight:500;color:var(--text-muted);margin-left:6px;">${esc(m.team_name || m.department || '')}</span>` +
      (status ? `<span style="font-size:11px;font-weight:600;padding:2px 8px;border-radius:6px;margin-left:8px;background:${statusColor[status]}22;color:${statusColor[status]};">${esc(statusMap[status] || status)}</span>` : '');

    const closeActionBtn  = document.getElementById('memberJournalCloseActionBtn');
    const reopenActionBtn = document.getElementById('memberJournalReopenBtn');
    closeActionBtn.style.display  = (isManager && !isEdit && j && j.status !== 'CLOSED') ? '' : 'none';
    reopenActionBtn.style.display = (isManager && !isEdit && j && j.status === 'CLOSED') ? '' : 'none';

    const bodyEl = document.getElementById('memberJournalBody');
    bodyEl.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:60px 20px;">
      <div class="task-loading-spinner" style="width:36px;height:36px;border-width:4px;"></div>
      <div style="font-size:13px;color:var(--text-muted);">일지를 불러오는 중...</div>
    </div>`;
    _openModal('memberJournalModal');

    // next_journal이 없으면 직접 조회
    // (백엔드 next_journal 미배포 / 캐시 없는 경우 대비)
    // has_next_journal:true인데 next_journal이 없으면 직접 조회
    if (!m.next_journal && j && m.has_next_journal !== false) {
      try {
        const nextWeekStart = offsetWeek(j.week_start, 1);
        const nParams = { request_user_email: currentUser.email, week_start: nextWeekStart };
        if (j.user_email && j.user_email.toLowerCase() !== currentUser.email.toLowerCase()) {
          nParams.target_user_email = j.user_email;
        }
        const nRes = await (async()=>{const{data}=await supabaseClient.from('task_journals').select('*').eq('user_email',nParams.request_user_email||currentUser.email).eq('week_start',nParams.week_start).maybeSingle();return{data};})().catch(()=>null);
        if (nRes && nRes.data && nRes.data.journal) {
          m.next_journal = nRes.data.journal;
        }
      } catch(e) { /* 실패해도 계속 진행 */ }
    }

    let html = '';

    if (!j) {
      html = `<div class="task-empty"><div class="task-empty-icon">📝</div><div class="task-empty-text">아직 일지를 작성하지 않았습니다.</div></div>`;
    } else {
      // 업무 현황 요약바
      const total = tasks.total || 0;
      const done  = tasks.done  || 0;
      const pct   = total > 0 ? Math.round(done / total * 100) : 0;
      html += `<div style="display:flex;align-items:center;gap:12px;padding:12px 16px;background:#f0f7ff;border-radius:12px;margin-bottom:16px;flex-wrap:wrap;">
        <span style="font-size:12px;font-weight:700;color:#0369a1;">📊 업무 현황</span>
        <span style="font-size:12px;color:var(--text-secondary);">전체 <b>${total}</b>건</span>
        <span style="font-size:12px;color:#16a34a;">✓ 완료 <b>${done}</b>건</span>
        ${tasks.in_progress ? `<span style="font-size:12px;color:#d97706;">⏳ 진행중 <b>${tasks.in_progress}</b>건</span>` : ''}
        ${tasks.high ? `<span style="font-size:12px;color:#dc2626;">● 높음 <b>${tasks.high}</b>건</span>` : ''}
        <div style="flex:1;min-width:80px;background:#e2e8f0;border-radius:4px;height:6px;overflow:hidden;">
          <div style="width:${pct}%;background:#0369a1;height:100%;border-radius:4px;"></div>
        </div>
        <span style="font-size:11px;color:var(--text-muted);">${pct}%</span>
      </div>`;

      // 이번 주 / 다음 주 통합 그룹 카드 (2컬럼)
      html += `<div class="mj-2col-grid" style="margin-bottom:14px;">
        ${renderWeekGroupCard('이번 주',
            j.early_work_this==='Y', j.sat_work_this==='Y',
            j.attendance_this_week||'', j.summary||'', formatJournalText)}
        ${renderWeekGroupCard('다음 주',
            (m.next_journal ? m.next_journal.early_work_this==='Y' : j.early_work_next==='Y'),
            (m.next_journal ? m.next_journal.sat_work_this==='Y'   : j.sat_work_next==='Y'),
            (m.next_journal ? m.next_journal.attendance_this_week  : j.attendance_next_week) || '',
            (m.next_journal && m.next_journal.summary) || j.next_plan || '',
            formatJournalText)}
      </div>`;

      // 이슈 / 건의사항
      if (j.issues && j.issues.trim()) {
        html += `<div style="margin-bottom:12px;">
          <div style="font-size:11px;font-weight:700;color:#b45309;margin-bottom:5px;">⚠️ 이슈 / 건의사항</div>
          <div style="font-size:13px;white-space:pre-wrap;line-height:1.65;background:#fff8f0;padding:10px 14px;border-radius:10px;border:1.5px solid #fed7aa;">${esc(j.issues)}</div>
        </div>`;
      }

      const timestamps = [];
      if (j.updated_at)   timestamps.push(`최종 수정: ${j.updated_at.substring(0,16)}`);
      if (j.submitted_at) timestamps.push(`제출: ${j.submitted_at.substring(0,16)}`);
      if (j.closed_at)    timestamps.push(`마감: ${j.closed_at.substring(0,16)}${j.closed_by ? ' (' + j.closed_by + ')' : ''}`);
      if (timestamps.length) {
        html += `<div style="font-size:11px;color:var(--text-muted);text-align:right;margin-top:4px;">${timestamps.join('  |  ')}</div>`;
      }
    }

    bodyEl.innerHTML = html;

    closeActionBtn.onclick = async () => {
      if (!j) return;
      if (!confirm(`${m.user_name}님의 일지를 마감하시겠습니까?`)) return;
      try {
        showGlobalLoading('마감 중...');
        await (async()=>{const{error}=await supabaseClient.from('task_journals').update({status:'CLOSED',closed_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq('user_email',currentUser.email).eq('week_start',journalWeekStart);if(error)throw error;return{success:true};})();
        showMessage('마감되었습니다.', 'success');
        closeMemberModal();
        showGlobalLoading('팀원 현황을 불러오는 중...');
        loadTeamJournals().finally(() => hideGlobalLoading());
      } catch (err) {
        showMessage(err.message, 'error');
      } finally {
        hideGlobalLoading();
      }
    };

    reopenActionBtn.onclick = async () => {
      if (!j) return;
      if (!confirm(`${m.user_name}님의 일지 마감을 해제하시겠습니까?\n제출됨 상태로 돌아갑니다.`)) return;
      try {
        showGlobalLoading('마감 해제 중...');
        await (async()=>{const{error}=await supabaseClient.from('task_journals').update({status:'SUBMITTED',closed_at:null,updated_at:new Date().toISOString()}).eq('user_email',currentUser.email).eq('week_start',journalWeekStart);if(error)throw error;return{success:true};})();
        showMessage('마감이 해제되었습니다.', 'success');
        closeMemberModal();
        showGlobalLoading('팀원 현황을 불러오는 중...');
        loadTeamJournals().finally(() => hideGlobalLoading());
      } catch (err) {
        showMessage(err.message, 'error');
      } finally {
        hideGlobalLoading();
      }
    };

    // ResizeObserver로 모달 body 실제 너비를 실시간 감지 → 1컬럼/2컬럼 전환
    // 창 크기를 늘였다 줄여도 즉시 반응
    // bodyEl은 위에서 이미 선언됨 (스피너 세팅 시)
    if (bodyEl) {
      // 기존 observer 정리
      if (bodyEl._mjResizeObserver) {
        bodyEl._mjResizeObserver.disconnect();
        bodyEl._mjResizeObserver = null;
      }
      const applyGrid = function(width) {
        const isNarrow = width < 700;
        bodyEl.querySelectorAll('.mj-2col-grid').forEach(function(el) {
          el.style.gridTemplateColumns = isNarrow ? '1fr' : '1fr 1fr';
          el.style.display    = 'grid';
          el.style.gap        = isNarrow ? '10px' : '12px';
          el.style.alignItems = 'stretch';   // 두 카드 높이 동일하게
        });
      };
      // 초기 적용
      requestAnimationFrame(function() { applyGrid(bodyEl.offsetWidth); });
      // 이후 크기 변화 감지
      const ro = new ResizeObserver(function(entries) {
        applyGrid(entries[0].contentRect.width);
      });
      ro.observe(bodyEl);
      bodyEl._mjResizeObserver = ro;
    }
  };

  function closeMemberModal() {
    const bodyEl = document.getElementById('memberJournalBody');
    if (bodyEl?._mjResizeObserver) {
      bodyEl._mjResizeObserver.disconnect();
      bodyEl._mjResizeObserver = null;
    }
    _closeModal('memberJournalModal');
  }

  // ── 주간업무 엑셀 다운로드 ──────────────────────────────────────
  // [수정] 엑셀 행 높이 동적 계산 — 셀 내용 줄 수 기반
  function calcRowHeights(ws, totalRows, totalCols, clinics) {
    const colWidths   = [16, 11, ...clinics.map(function() { return 65; })];
    const PT_PER_LINE = 14;
    const PT_PADDING  = 6;
    const MIN_PT      = 40;
    const rowHeights  = [];

    for (let ri = 0; ri < totalRows; ri++) {
      if (ri === 0)  { rowHeights.push({ hpt: 42 }); continue; }
      if (ri < 3)    { rowHeights.push({ hpt: 29 }); continue; }

      let maxLines = 1;
      for (let ci = 0; ci < totalCols; ci++) {
        const addr = window.XLSX.utils.encode_cell({ r: ri, c: ci });
        const cell = ws[addr];
        if (!cell || !cell.v) continue;
        const text     = String(cell.v);
        const colWidth = colWidths[ci] || 20;
        const segments = text.split('\n');
        let totalLines = 0;
        segments.forEach(function(seg) {
          // 한글 2자 = 영문 약 2자 너비, 평균 1.8로 추산 (보수적)
          const estimated = seg.length * 1.8;
          totalLines += Math.max(1, Math.ceil(estimated / colWidth));
        });
        if (totalLines > maxLines) maxLines = totalLines;
      }
      rowHeights.push({ hpt: Math.max(MIN_PT, maxLines * PT_PER_LINE + PT_PADDING) });
    }
    return rowHeights;
  }


  async function exportJournalExcel() {
    if (!window.XLSX) {
      showMessage('엑셀 라이브러리를 불러오지 못했습니다.', 'error');
      return;
    }
    const btn = document.getElementById('exportJournalBtn');
    try {
      if (btn) { btn.disabled = true; btn.textContent = '다운로드 중...'; }
      showGlobalLoading('업무일지 데이터를 불러오는 중...');

      const res = await (async()=>{const members=await sbGetTeamJournals(currentUser.team_code,teamWeekStart);return{data:members};})();
      const members = res.data || [];
      if (!members.length) { showMessage('다운로드할 데이터가 없습니다.', 'error'); return; }

      // next_journal 없으면 다음 주 일지 병렬 조회
      const nextWeekStartExcel = offsetWeek(teamWeekStart, 1);
      // has_next_journal:true인데 next_journal 키가 없으면 직접 조회 (GAS null 직렬화 이슈)
      const needFetchExcel = members.some(m => !m.next_journal && m.journal && m.has_next_journal !== false);
      if (needFetchExcel) {
        await Promise.all(members.map(async m => {
          if (m.next_journal || !m.journal) return;
          try {
            const nr = await (async()=>{const {data}=await supabaseClient.from('task_journals').select('*').eq('user_email',currentUser.email).eq('week_start',nextWeekStartExcel).single();return{data};})().catch(() => null);
            if (nr && nr.data && nr.data.journal) m.next_journal = nr.data.journal;
          } catch(e) {}
        }));
      }

      const FONT_BASE   = { name: '맑은 고딕', sz: 10 };
      const FONT_TITLE  = { name: '맑은 고딕', sz: 14, bold: true, color: { rgb: 'FFFFFF' } };
      const FONT_HEADER = { name: '맑은 고딕', sz: 10, bold: true, color: { rgb: '1F3864' } };
      const FONT_BOLD   = { name: '맑은 고딕', sz: 10, bold: true };
      const FILL_TITLE  = { patternType: 'solid', fgColor: { rgb: '1F3864' } };
      const FILL_HEADER = { patternType: 'solid', fgColor: { rgb: 'B8CCE4' } };
      const FILL_WEEK   = { patternType: 'solid', fgColor: { rgb: 'D6E4F7' } };
      const FILL_WHITE  = { patternType: 'solid', fgColor: { rgb: 'FFFFFF' } };
      const FILL_ALT    = { patternType: 'solid', fgColor: { rgb: 'F2F7FD' } };
      const BD       = { top:{style:'thin',color:{rgb:'BFBFBF'}}, bottom:{style:'thin',color:{rgb:'BFBFBF'}}, left:{style:'thin',color:{rgb:'BFBFBF'}}, right:{style:'thin',color:{rgb:'BFBFBF'}} };
      const BD_MED   = { top:{style:'medium',color:{rgb:'2E75B6'}}, bottom:{style:'medium',color:{rgb:'2E75B6'}}, left:{style:'medium',color:{rgb:'2E75B6'}}, right:{style:'medium',color:{rgb:'2E75B6'}} };
      // 카테고리 섹션 상단 — 굵은 구분선
      const BD_SEC   = { top:{style:'medium',color:{rgb:'8EA9C8'}}, bottom:{style:'thin',color:{rgb:'BFBFBF'}}, left:{style:'thin',color:{rgb:'BFBFBF'}}, right:{style:'thin',color:{rgb:'BFBFBF'}} };
      // 금주↔차주 내부선 — 점선(hair)으로 얇게
      const BD_INNER = { top:{style:'hair',color:{rgb:'DEDEDE'}}, bottom:{style:'thin',color:{rgb:'BFBFBF'}}, left:{style:'thin',color:{rgb:'BFBFBF'}}, right:{style:'thin',color:{rgb:'BFBFBF'}} };
      const AL_C = { horizontal:'center', vertical:'center', wrapText:true };
      const AL_L = { horizontal:'left',   vertical:'top',    wrapText:true };

      const ws  = {};
      const wb2 = window.XLSX.utils.book_new();

      // ── [재설계] task 단위로 의원별 분류 ──────────────────────
      // taskClinicMap: { 의원명: [task, ...] }  — 업무 내용 분류용 (work_clinic_name 기준)
      // memberClinicMap: { 의원명: [member, ...] } — 조출/근태/이슈 분류용 (소속 의원 기준)
      const taskClinicMap   = {};
      const memberClinicMap = {};

      members.forEach(m => {
        // member 단위: 소속 의원 기준 (조출·근태·이슈용)
        const mc = m.clinic_name || '기타';
        if (!memberClinicMap[mc]) memberClinicMap[mc] = [];
        memberClinicMap[mc].push(m);

        // task 단위: work_clinic_name 기준 (업무 내용용) — 금주+차주 모두 수집
        const tasks     = (m.task_summary      && m.task_summary.items)      ? m.task_summary.items      : [];
        const nextTasks = (m.next_task_summary && m.next_task_summary.items) ? m.next_task_summary.items : [];
        [...tasks, ...nextTasks].forEach(t => {
          const tc = t.work_clinic_name || t.clinic_name || m.clinic_name || '기타';
          if (!taskClinicMap[tc]) taskClinicMap[tc] = [];
          // 중복 방지
          if (!taskClinicMap[tc].find(x => x.task_id === t.task_id)) {
            taskClinicMap[tc].push(t);
          }
        });
      });

      // 의원 목록: task + member 양쪽 합집합으로 컬럼 결정
      const clinicSet = new Set([...Object.keys(taskClinicMap), ...Object.keys(memberClinicMap)]);
      const clinics = Array.from(clinicSet).sort();

      // 카테고리 목록 — 비어있으면 서버에서 재조회
      if (Object.keys(CATEGORY_LABELS).length === 0) {
        await loadCategories();
      }
      if (Object.keys(CATEGORY_LABELS).length === 0) {
        showMessage('카테고리가 등록되어 있지 않습니다. 카테고리 관리에서 먼저 등록해주세요.', 'error');
        return;
      }
      const cats = Object.entries(CATEGORY_LABELS);

      // task 배열 → 엑셀 셀 텍스트 빌더
      const buildTaskText = (tasks, catCode, isHigh, isNext) => {
        if (!tasks || !tasks.length) return '';
        const DOW = ['일','월','화','수','목','금','토'];
        const ST  = { TODO:'예정', IN_PROGRESS:'진행중', DONE:'완료' };
        const weekS = isNext ? offsetWeek(teamWeekStart, 1) : teamWeekStart;
        const weekE = getWeekEnd(weekS);

        const filtered = tasks.filter(t => {
          const s = t.start_date || '';
          const e = t.end_date   || s;
          if (e < weekS || s > weekE) return false;
          if (catCode && t.category !== catCode) return false;
          const high = t.priority === 'HIGH';
          if (isHigh === true  && !high) return false;
          if (isHigh === false &&  high) return false;
          return true;
        });
        if (!filtered.length) return '';

        const lines = [];
        filtered.sort((a,b) => (a.start_date||'').localeCompare(b.start_date||''));
        filtered.forEach(t => {
          const d   = new Date((t.start_date||'') + 'T00:00:00');
          const dow = isNaN(d.getTime()) ? '' : DOW[d.getDay()];
          const mm  = (t.start_date||'').substring(5,7);
          const dd  = (t.start_date||'').substring(8,10);
          const pri = t.priority === 'HIGH' ? ' *' : '';
          const st  = ST[t.status] || t.status || '';
          const end = (t.end_date && t.end_date !== t.start_date)
            ? '  ' + (t.end_date||'').substring(5,7)+'/'+( t.end_date||'').substring(8,10) : '';
          lines.push('  ' + mm + '/' + dd + ' (' + dow + ')');
          lines.push('  • ' + (t.title||'') + pri + '  [' + st + ']' + (end ? '  '+mm+'/'+dd+' ~ '+end.trim() : ''));
          if (t.description && t.description.trim()) {
            t.description.trim().split('\n').forEach(dl => {
              if (dl.trim()) lines.push('    ' + dl.trim());
            });
          }
        });
        return lines.join('\n');
      };

      // A:구분  B~:의원별
      let r = 0;

      const TOTAL_COLS = 2 + clinics.length;  // A:카테고리 B:금주/차주 C~:의원별

      const sc = (row, col, val, s) => {
        const a = window.XLSX.utils.encode_cell({ r: row, c: col });
        ws[a] = { v: val ?? '', t: 's', s };
      };
      const mg = (rs, re, cs, ce) => {
        if (!ws['!merges']) ws['!merges'] = [];
        ws['!merges'].push({ s:{r:rs,c:cs}, e:{r:re,c:ce} });
      };

      // 1행: 제목
      sc(r, 0, 'MSO관리팀 주간 업무보고', { font:FONT_TITLE, fill:FILL_TITLE, alignment:AL_C, border:BD_MED });
      for (let c=1;c<TOTAL_COLS;c++) sc(r, c, '', { font:FONT_TITLE, fill:FILL_TITLE, alignment:AL_C, border:BD_MED });
      mg(r,r,0,TOTAL_COLS-1); r++;

      // 2행: 기간
      const weekEnd = getWeekEnd(teamWeekStart);
      const fd = d => d ? d.substring(5).replace('-','/') : '';
      const period = `${teamWeekStart.substring(0,4)}년  ${fd(teamWeekStart)} ~ ${fd(weekEnd)}`;
      sc(r, 0, period, { font:FONT_BOLD, fill:FILL_WEEK, alignment:AL_C, border:BD });
      for (let c=1;c<TOTAL_COLS;c++) sc(r, c, '', { font:FONT_BOLD, fill:FILL_WEEK, alignment:AL_C, border:BD });
      mg(r,r,0,TOTAL_COLS-1); r++;

      // 3행: 헤더 — A:카테고리 B:금주/차주 C~:의원별
      sc(r, 0, '구  분', { font:FONT_HEADER, fill:FILL_HEADER, alignment:AL_C, border:BD });
      sc(r, 1, '',       { font:FONT_HEADER, fill:FILL_HEADER, alignment:AL_C, border:BD });
      clinics.forEach((cl,i) => sc(r, 2+i, cl, { font:FONT_HEADER, fill:FILL_HEADER, alignment:AL_C, border:BD }));
      mg(r, r, 0, 1);  // A~B 병합: "구  분"
      r++;

      // ── 주요이슈 (중요도 HIGH) — 금주/차주 ──────────────────────



      const highStart = r;

      // 주요이슈 (HIGH) — task 단위
      [false, true].forEach((isNext, fi) => {
        const weekLabel = fi === 0 ? '금주' : '차주';
        const rowBD = fi === 0 ? BD_SEC : BD_INNER;
        sc(r, 0, fi === 0 ? '주요이슈' : '', { font:FONT_BOLD, fill:FILL_WHITE, alignment:AL_C, border:rowBD });
        sc(r, 1, weekLabel, { font:FONT_BOLD, fill:FILL_WHITE, alignment:AL_C, border:rowBD });
        clinics.forEach((cl, i) => {
          const text = buildTaskText(taskClinicMap[cl] || [], null, true, isNext);
          const lines = text ? text.split('\n') : [];
          sc(r, 2+i, wrapExcelLines(stripNameAndDate(lines)), { font:FONT_BASE, fill:FILL_WHITE, alignment:AL_L, border:rowBD });
        });
        r++;
      });
      mg(highStart, highStart + 1, 0, 0);

      // 카테고리별 — task 단위
      cats.forEach(([catKey, catName], ci) => {
        const catStart = r;
        [false, true].forEach((isNext, fi) => {
          const weekLabel = fi === 0 ? '금주' : '차주';
          const rowBD     = fi === 0 ? BD_SEC : BD_INNER;
          sc(r, 0, fi === 0 ? catName : '', { font:FONT_BOLD, fill:FILL_WHITE, alignment:AL_C, border:rowBD });
          sc(r, 1, weekLabel, { font:FONT_BOLD, fill:FILL_WHITE, alignment:AL_C, border:rowBD });
          clinics.forEach((cl, i) => {
            const text = buildTaskText(taskClinicMap[cl] || [], catKey, false, isNext);
            const lines = text ? text.split('\n') : [];
            sc(r, 2+i, wrapExcelLines(stripNameAndDate(lines)), { font:FONT_BASE, fill:FILL_WHITE, alignment:AL_L, border:rowBD });
          });
          r++;
        });
        mg(catStart, catStart + 1, 0, 0);
      });

      // 조출 / 토요근무 — 소속 의원(memberClinicMap) 기준
      const earlyWorkStart = r;
      [
        { thisKey: 'early_work_this', satKey: 'sat_work_this', label: '이번주', useNext: false },
        { thisKey: 'early_work_this', satKey: 'sat_work_this', label: '다음주', useNext: true }
      ].forEach((row, idx) => {
        const rowBD = idx === 0 ? BD_SEC : BD_INNER;
        sc(r, 0, idx === 0 ? '조출/토요근무' : '', { font:FONT_BOLD, fill:FILL_WHITE, alignment:AL_C, border:rowBD });
        sc(r, 1, row.label, { font:FONT_BOLD, fill:FILL_WHITE, alignment:AL_C, border:rowBD });
        clinics.forEach((cl, i) => {
          const getVal = (m, key, oldKey) => row.useNext
            ? (m.next_journal ? m.next_journal[key]==='Y' : (m.journal ? m.journal[oldKey]==='Y' : false))
            : (m.journal ? m.journal[key]==='Y' : false);
          const earlyNames = (memberClinicMap[cl]||[]).filter(m => getVal(m, row.thisKey, 'early_work_next')).map(m => m.user_name);
          const satNames   = (memberClinicMap[cl]||[]).filter(m => getVal(m, row.satKey,  'sat_work_next')).map(m => m.user_name);
          const lines = [];
          if (earlyNames.length) lines.push('[조출] : ' + earlyNames.join(', '));
          if (satNames.length)   lines.push('[토요근무] : ' + satNames.join(', '));
          sc(r, 2+i, lines.length ? lines.join('\n') : '-', { font:FONT_BASE, fill:FILL_WHITE, alignment:AL_L, border:rowBD });
        });
        r++;
      });
      mg(earlyWorkStart, earlyWorkStart + 1, 0, 0);

      // 근태 (금주/차주) — 소속 의원 기준
      const attStart = r;
      ['금주', '차주'].forEach((label, fi) => {
        const rowBD = fi === 0 ? BD_SEC : BD_INNER;
        sc(r, 0, fi === 0 ? '근태' : '', { font:FONT_BOLD, fill:FILL_WHITE, alignment:AL_C, border:rowBD });
        sc(r, 1, label, { font:FONT_BOLD, fill:FILL_WHITE, alignment:AL_C, border:rowBD });
        clinics.forEach((cl, i) => {
          const lines = [];
          (memberClinicMap[cl]||[]).forEach(m => {
            if (!m.journal) return;
            const val = fi === 0
              ? (m.journal.attendance_this_week || '')
              : ((m.next_journal && m.next_journal.attendance_this_week) || m.journal.attendance_next_week || '');
            if (val) {
              lines.push('• ' + m.user_name);
              val.split('\n').forEach(function(v) { lines.push('  ' + v); });
            }
          });
          sc(r, 2+i, wrapExcelLines(lines), { font:FONT_BASE, fill:FILL_WHITE, alignment:AL_L, border:rowBD });
        });
        r++;
      });
      mg(attStart, attStart + 1, 0, 0);

      // 이슈 / 건의사항 — 소속 의원 기준
      const issueRow = r;
      const fillIssue = FILL_WHITE;
      sc(r, 0, '이슈/건의', { font:FONT_BOLD, fill:fillIssue, alignment:AL_C, border:BD });
      sc(r, 1, '',          { font:FONT_BOLD, fill:fillIssue, alignment:AL_C, border:BD });
      mg(r, r, 0, 1);
      clinics.forEach((cl, i) => {
        const lines = [];
        (memberClinicMap[cl]||[]).forEach(m => {
          if (!m.journal || !m.journal.issues) return;
          lines.push(m.journal.issues);
        });
        sc(r, 2+i, wrapExcelLines(lines), { font:FONT_BASE, fill:fillIssue, alignment:AL_L, border:BD });
      });
      r++;

      ws['!ref']  = window.XLSX.utils.encode_range({r:0,c:0},{r:r-1,c:TOTAL_COLS-1});
      ws['!cols'] = [{ wch:16 }, { wch:11 }, ...clinics.map(()=>({ wch:65 }))];
      // [수정] 데이터 행 높이 — 내용 줄 수 기반 동적 계산
      ws['!rows'] = calcRowHeights(ws, r, TOTAL_COLS, clinics);

      window.XLSX.utils.book_append_sheet(wb2, ws, '주간업무보고');
      const today = new Date();
      const ds = today.getFullYear() + String(today.getMonth()+1).padStart(2,'0') + String(today.getDate()).padStart(2,'0');
      const weekStartDs = (teamWeekStart || '').replace(/-/g, '');
      window.XLSX.writeFile(wb2, `주간업무보고_${weekStartDs}_${ds}.xlsx`);
      showMessage('엑셀 다운로드가 완료되었습니다.', 'success');


    } catch (err) {
      showMessage(err.message || '엑셀 다운로드 중 오류가 발생했습니다.', 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '⬇ 엑셀 다운로드'; }
      hideGlobalLoading();
    }
  }

  /**
   * 엑셀 출력용 — 이름행, 날짜행, 날짜범위 제거 + 번호를 •로 교체
   */
  // [수정] 이름행/날짜행 제거 + 들여쓰기 정규화 (isSubLine 헬퍼 사용)
  // ── PDF 다운로드 ────────────────────────────────────────────
  async function exportJournalPdf() {
    const btn = document.getElementById('exportPdfBtn');
    try {
      if (btn) { btn.disabled = true; btn.textContent = 'PDF 생성 중...'; }
      showGlobalLoading('PDF 데이터를 불러오는 중...');

      const res = await (async()=>{const members=await sbGetTeamJournals(currentUser.team_code,teamWeekStart);return{data:members};})();
      const members = res.data || [];
      if (!members.length) { showMessage('다운로드할 데이터가 없습니다.', 'error'); return; }

      if (Object.keys(CATEGORY_LABELS).length === 0) await loadCategories();

      // next_journal이 없으면 다음 주 일지를 병렬로 직접 조회
      // (26_JournalService.gs 미배포 환경 대비)
      const nextWeekStart = offsetWeek(teamWeekStart, 1);
      // has_next_journal:true인데 next_journal 키가 없으면 직접 조회 (GAS null 직렬화 이슈)
      const needFetch = members.some(m => !m.next_journal && m.journal && m.has_next_journal !== false);
      if (needFetch) {
        await Promise.all(members.map(async m => {
          if (m.next_journal || !m.journal) return;
          try {
            const nr = await (async()=>{const {data}=await supabaseClient.from('task_journals').select('*').eq('user_email',currentUser.email).eq('week_start',nextWeekStart).single();return{data};})().catch(() => null);
            if (nr && nr.data && nr.data.journal) {
              m.next_journal = nr.data.journal;
            }
          } catch(e) { /* 실패해도 계속 */ }
        }));
      }

      const weekEnd = getWeekEnd(teamWeekStart);
      const fd = d => d ? d.substring(5).replace('-', '/') : '';
      const period = teamWeekStart.substring(0, 4) + '년  ' + fd(teamWeekStart) + ' ~ ' + fd(weekEnd);

      // ── [재설계] task 단위로 의원별 분류 ──────────────────────
      const taskClinicMapPdf   = {};  // 업무 내용용 (work_clinic_name 기준)
      const memberClinicMapPdf = {};  // 조출·근태·이슈용 (소속 의원 기준)

      members.forEach(m => {
        const mc = m.clinic_name || '기타';
        if (!memberClinicMapPdf[mc]) memberClinicMapPdf[mc] = [];
        memberClinicMapPdf[mc].push(m);

        const tasks     = (m.task_summary      && m.task_summary.items)      ? m.task_summary.items      : [];
        const nextTasks = (m.next_task_summary && m.next_task_summary.items) ? m.next_task_summary.items : [];
        [...tasks, ...nextTasks].forEach(t => {
          const tc = t.work_clinic_name || t.clinic_name || m.clinic_name || '기타';
          if (!taskClinicMapPdf[tc]) taskClinicMapPdf[tc] = [];
          if (!taskClinicMapPdf[tc].find(x => x.task_id === t.task_id)) {
            taskClinicMapPdf[tc].push(t);
          }
        });
      });

      const clinicSetPdf = new Set([...Object.keys(taskClinicMapPdf), ...Object.keys(memberClinicMapPdf)]);
      const clinics = Array.from(clinicSetPdf).sort();
      const cats    = Object.entries(CATEGORY_LABELS);

      // 셀 텍스트를 <pre> 스타일 div로 변환 (들여쓰기 보존)
      const textToHtml = (raw) => {
        if (!raw || !raw.trim()) return '<span style="color:#94a3b8;">-</span>';
        return raw.split('\n').map(line => {
          const trimmed = line.trimStart();
          const indent  = line.length - trimmed.length;
          const px      = indent * 5.5;
          return `<div style="padding-left:${px}px;line-height:1.45;">${trimmed.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') || '&nbsp;'}</div>`;
        }).join('');
      };

      // 섹션 데이터 수집 — task 단위 재설계
      const getSectionLines = (isHigh, catCode, isNext) => {
        const result = {};
        clinics.forEach(cl => {
          const DOW = ['일','월','화','수','목','금','토'];
          const ST  = { TODO:'예정', IN_PROGRESS:'진행중', DONE:'완료' };
          const weekS = isNext ? nextWeekStart : teamWeekStart;
          const weekE = getWeekEnd(weekS);
          const tasks = taskClinicMapPdf[cl] || [];

          const filtered = tasks.filter(t => {
            const s = t.start_date || '';
            const e = t.end_date   || s;
            if (e < weekS || s > weekE) return false;
            if (catCode && t.category !== catCode) return false;
            const high = t.priority === 'HIGH';
            if (isHigh === true  && !high) return false;
            if (isHigh === false &&  high) return false;
            return true;
          });

          if (!filtered.length) { result[cl] = ''; return; }

          const lines = [];
          filtered.sort((a,b) => (a.start_date||'').localeCompare(b.start_date||''));
          filtered.forEach(t => {
            const d   = new Date((t.start_date||'') + 'T00:00:00');
            const dow = isNaN(d.getTime()) ? '' : DOW[d.getDay()];
            const mm  = (t.start_date||'').substring(5,7);
            const dd  = (t.start_date||'').substring(8,10);
            const pri = t.priority === 'HIGH' ? ' *' : '';
            const st  = ST[t.status] || t.status || '';
            lines.push('  ' + mm + '/' + dd + ' (' + dow + ')');
            lines.push('  • ' + (t.title||'') + pri + '  [' + st + ']');
            if (t.description && t.description.trim()) {
              t.description.trim().split('\n').forEach(dl => {
                if (dl.trim()) lines.push('    ' + dl.trim());
              });
            }
          });
          result[cl] = stripNameAndDate(lines).join('\n');
        });
        return result;
      };

      // 테이블 헤더 행
      const colW = Math.floor(72 / clinics.length);
      const thStyle        = 'background:#1F3864;color:#fff;font-weight:700;text-align:center;padding:5px 4px;font-size:9pt;border:0.5px solid #999;';
      const tdLabelStyle   = 'background:#fff;font-weight:700;text-align:center;padding:4px 3px;font-size:8pt;border-left:0.5px solid #bbb;border-right:0.5px solid #bbb;border-bottom:0.5px solid #bbb;border-top:2px solid #8EA9C8;vertical-align:middle;';
      // 금주: 카테고리 상단 굵은선
      const tdWeekStyleThis = 'background:#fff;font-weight:600;text-align:center;padding:3px 2px;font-size:7.5pt;border-left:0.5px solid #bbb;border-right:0.5px solid #bbb;border-bottom:0.5px solid #bbb;border-top:2px solid #8EA9C8;vertical-align:middle;color:#374151;';
      const tdDataStyleThis = 'background:#fff;padding:4px 5px;font-size:7.5pt;border-left:0.5px solid #bbb;border-right:0.5px solid #bbb;border-bottom:0.5px solid #bbb;border-top:2px solid #8EA9C8;vertical-align:top;';
      // 차주: 얇은 내부선
      const tdWeekStyleNext = 'background:#fff;font-weight:600;text-align:center;padding:3px 2px;font-size:7.5pt;border-left:0.5px solid #bbb;border-right:0.5px solid #bbb;border-bottom:0.5px solid #bbb;border-top:0.5px solid #dedede;vertical-align:middle;color:#374151;';
      const tdDataStyleNext = 'background:#fff;padding:4px 5px;font-size:7.5pt;border-left:0.5px solid #bbb;border-right:0.5px solid #bbb;border-bottom:0.5px solid #bbb;border-top:0.5px solid #dedede;vertical-align:top;';
      // 하위호환 별칭
      const tdWeekStyle  = tdWeekStyleThis;
      const tdDataStyle  = tdDataStyleThis;

      let tableHtml = `
        <colgroup>
          <col style="width:7%">
          <col style="width:4%">
          ${clinics.map(() => `<col style="width:${colW}%">`).join('')}
        </colgroup>
        <thead>
          <tr>
            <th colspan="${2 + clinics.length}" style="background:#1F3864;color:#fff;font-size:13pt;font-weight:700;text-align:center;padding:8px;border:1px solid #999;">MSO관리팀 주간 업무보고</th>
          </tr>
          <tr>
            <th colspan="${2 + clinics.length}" style="background:#D6E4F7;color:#1F3864;font-size:10pt;font-weight:700;text-align:center;padding:5px;border:0.5px solid #bbb;">${period}</th>
          </tr>
          <tr>
            <th colspan="2" style="${thStyle}">구  분</th>
            ${clinics.map(cl => `<th style="${thStyle}">${cl.replace(/&/g,'&amp;').replace(/</g,'&lt;')}</th>`).join('')}
          </tr>
        </thead>
        <tbody>`;

      // 주요이슈 행 — HIGH 업무만
      const highThis = getSectionLines(true, null, false);
      const highNext = getSectionLines(true, null, true);
      tableHtml += `
        <tr>
          <td rowspan="2" style="${tdLabelStyle}">주요이슈</td>
          <td style="${tdWeekStyle}">금주</td>
          ${clinics.map(cl => `<td style="${tdDataStyle}">${textToHtml(highThis[cl])}</td>`).join('')}
        </tr>
        <tr>
          <td style="${tdWeekStyleNext}">차주</td>
          ${clinics.map(cl => `<td style="${tdDataStyleNext}">${textToHtml(highNext[cl])}</td>`).join('')}
        </tr>`;

      // 카테고리별 — 전체 업무 (HIGH 포함)
      cats.forEach(([catKey, catName]) => {
        const thisData = getSectionLines(false, catKey, false);
        const nextData = getSectionLines(false, catKey, true);
        const label = catName.replace(/&/g,'&amp;').replace(/</g,'&lt;');
        tableHtml += `
        <tr>
          <td rowspan="2" style="${tdLabelStyle}">${label}</td>
          <td style="${tdWeekStyle}">금주</td>
          ${clinics.map(cl => `<td style="${tdDataStyle}">${textToHtml(thisData[cl])}</td>`).join('')}
        </tr>
        <tr>
          <td style="${tdWeekStyleNext}">차주</td>
          ${clinics.map(cl => `<td style="${tdDataStyleNext}">${textToHtml(nextData[cl])}</td>`).join('')}
        </tr>`;
      });

      // 조출/토요근무 — 소속 의원 기준
      [
        { thisKey:'early_work_this', satKey:'sat_work_this', label:'이번주', useNext: false },
        { thisKey:'early_work_this', satKey:'sat_work_this', label:'다음주', useNext: true }
      ].forEach((row, idx) => {
        const _wkStyle = idx === 0 ? tdWeekStyleThis : tdWeekStyleNext;
        const _dtStyle = idx === 0 ? tdDataStyleThis : tdDataStyleNext;
        const labelCell = idx === 0 ? `<td rowspan="2" style="${tdLabelStyle}">조출/<br>토요근무</td>` : '';
        tableHtml += `<tr>${labelCell}<td style="${_wkStyle}">${row.label}</td>${clinics.map(cl => {
          const getV = (m, key, oldKey) => row.useNext
            ? (m.next_journal ? m.next_journal[key]==='Y' : (m.journal ? m.journal[oldKey]==='Y' : false))
            : (m.journal ? m.journal[key]==='Y' : false);
          const early = (memberClinicMapPdf[cl]||[]).filter(m=>getV(m,row.thisKey,'early_work_next')).map(m=>m.user_name);
          const sat   = (memberClinicMapPdf[cl]||[]).filter(m=>getV(m,row.satKey,'sat_work_next')).map(m=>m.user_name);
          const lines = [];
          if (early.length) lines.push('[조출] : '+early.join(', '));
          if (sat.length)   lines.push('[토요근무] : '+sat.join(', '));
          return `<td style="${_dtStyle}">${lines.length ? lines.join('<br>') : '<span style="color:#94a3b8;">-</span>'}</td>`;
        }).join('')}</tr>`;
      });

      // 근태 — 소속 의원 기준
      ['금주','차주'].forEach((label, fi) => {
        const _wkStyle2 = fi === 0 ? tdWeekStyleThis : tdWeekStyleNext;
        const _dtStyle2 = fi === 0 ? tdDataStyleThis : tdDataStyleNext;
        const labelCell = fi === 0 ? `<td rowspan="2" style="${tdLabelStyle}">근태</td>` : '';
        tableHtml += `<tr>${labelCell}<td style="${_wkStyle2}">${label}</td>${clinics.map(cl => {
          const lines = [];
          (memberClinicMapPdf[cl]||[]).forEach(m => {
            if (!m.journal) return;
            const val = fi === 0
              ? (m.journal.attendance_this_week||'')
              : ((m.next_journal && m.next_journal.attendance_this_week) || m.journal.attendance_next_week || '');
            if (val) { lines.push('• '+m.user_name); val.split('\n').forEach(v => lines.push('  '+v)); }
          });
          return `<td style="${_dtStyle2}">${lines.length ? textToHtml(lines.join('\n')) : '<span style="color:#94a3b8;">-</span>'}</td>`;
        }).join('')}</tr>`;
      });

      // 이슈/건의 — 소속 의원 기준
      tableHtml += `<tr><td colspan="2" style="${tdLabelStyle}">이슈/건의</td>${clinics.map(cl => {
        const lines = [];
        (memberClinicMapPdf[cl]||[]).forEach(m => { if (m.journal&&m.journal.issues) lines.push(m.journal.issues); });
        return `<td style="${tdDataStyle}">${lines.length ? textToHtml(lines.join('\n')) : '<span style="color:#94a3b8;">-</span>'}</td>`;
      }).join('')}</tr>`;

      tableHtml += '</tbody>';

      // 인쇄용 창 생성
      const printWin = window.open('', '_blank', 'width=1200,height=800');
      const today = new Date();
      const ds = today.getFullYear() + String(today.getMonth()+1).padStart(2,'0') + String(today.getDate()).padStart(2,'0');

      const fileName = '주간업무보고_' + (teamWeekStart||'').replace(/-/g,'') + '_' + ds;

      printWin.document.write(`<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <title>${fileName}</title>
  <style>
    @page { size: A4 landscape; margin: 10mm 8mm; }
    * { box-sizing: border-box; }
    body {
      font-family: '맑은 고딕', 'Apple SD Gothic Neo', sans-serif;
      font-size: 8pt;
      margin: 0;
      background: #f0f4f8;
    }

    /* ── 상단 툴바 (인쇄 시 숨김) ── */
    .preview-toolbar {
      position: sticky;
      top: 0;
      z-index: 100;
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 20px;
      background: #1F3864;
      color: #fff;
      box-shadow: 0 2px 8px rgba(0,0,0,0.3);
    }
    .preview-toolbar-title {
      flex: 1;
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 0.02em;
    }
    .preview-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      height: 36px;
      padding: 0 18px;
      border: none;
      border-radius: 8px;
      font-family: '맑은 고딕', sans-serif;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      transition: opacity 0.15s;
    }
    .preview-btn:hover { opacity: 0.85; }
    .preview-btn--print  { background: #fff;    color: #1F3864; }
    .preview-btn--close  { background: rgba(255,255,255,0.15); color: #fff; border: 1.5px solid rgba(255,255,255,0.4); }

    /* ── 미리보기 페이지 ── */
    .preview-page-wrap {
      padding: 24px 20px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 16px;
    }
    .preview-page {
      background: #fff;
      width: 277mm;
      min-height: 190mm;
      padding: 10mm 14mm;
      box-shadow: 0 4px 20px rgba(0,0,0,0.18);
      border-radius: 2px;
    }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    td, th { word-break: break-word; overflow-wrap: break-word; }

    @media print {
      .preview-toolbar { display: none !important; }
      body { background: #fff; }
      .preview-page-wrap { padding: 0; }
      .preview-page { box-shadow: none; width: 100%; padding: 0; border-radius: 0; }
      @page { size: A4 landscape; margin: 10mm 14mm; }
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
  </style>
</head>
<body>

  <!-- 상단 툴바 -->
  <div class="preview-toolbar">
    <span class="preview-toolbar-title">📄 미리보기 — ${fileName}</span>
    <button class="preview-btn preview-btn--print" onclick="window.print()">🖨 인쇄 / PDF 저장</button>
    <button class="preview-btn preview-btn--close" onclick="window.close()">✕ 닫기</button>
  </div>

  <!-- 미리보기 본문 -->
  <div class="preview-page-wrap">
    <div class="preview-page">
      <table>${tableHtml}</table>
    </div>
  </div>

</body>
</html>`);
      printWin.document.close();
      showMessage('미리보기 창이 열렸습니다.', 'success');

    } catch (err) {
      showMessage(err.message || 'PDF 생성 중 오류가 발생했습니다.', 'error');
      console.error(err);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '⬇ PDF 다운로드'; }
      hideGlobalLoading();
    }
  }

  function stripNameAndDate(lines) {
    return lines
      .filter(function(l) {
        const t = l.trim();
        if (!t) return false;
        if (t.startsWith('• ') && /^•\s+\S+\s*$/.test(t)) return false;
        if (/^\d{2}\/\d{2}\s*\(/.test(t)) return false;
        return true;
      })
      .map(function(l) {
        const sub    = isSubLine(l);
        let result   = sub ? normalizeSubLinesForExcel(l) : l.replace(/^(\s*)\d+\.\s+/, '$1• ');
        result = result.replace(/\s+\d{2}\/\d{2}\s*~\s*\d{2}\/\d{2}/g, '');
        result = result.replace(/\s+\d{2}\/\d{2}(?!\s*[~(])/g, '');
        return result;
      });
  }


  /**
   * 일지 텍스트에서 카테고리 섹션 추출
   * @param {string} text       - 일지 전체 텍스트
   * @param {string} catName    - 카테고리명 (null 이면 전체)
   * @param {string} [priority] - 'HIGH': HIGH만, 'NORMAL': HIGH 제외, 미전달: 전체
   */
  function extractCategorySection(text, catName, priority) {
    if (!text) return '';

    let catCode  = null;
    let catLabel = null;
    if (catName && Object.keys(CATEGORY_LABELS).length > 0) {
      catCode  = Object.keys(CATEGORY_LABELS).find(k => CATEGORY_LABELS[k] === catName) || null;
      catLabel = CATEGORY_LABELS[catName] || null;
    }

    const lines = text.split('\n');
    let inSection = !catName;
    const result = [];
    let i = 0;

    while (i < lines.length) {
      const trimmed = lines[i].trim();

      if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
        const sectionName = trimmed.slice(1, -1).trim();
        if (!catName) { inSection = true; i++; continue; }
        const isMatch = sectionName === catName ||
                        (catCode  && sectionName === catCode)  ||
                        (catLabel && sectionName === catLabel);
        if (isMatch) { inSection = true; i++; continue; }
        else if (inSection) break;
        i++; continue;
      }

      if (inSection && trimmed.startsWith('──')) break;

      if (inSection && trimmed) {
        const isItem = /^•\s/.test(trimmed) || /^\d+\.\s/.test(trimmed);
        if (isItem) {
          const isHigh = trimmed.includes(' * ') || trimmed.endsWith(' *') ||
                         trimmed.includes(' *  ') || / \*\s+\[/.test(trimmed);
          if (!priority ||
              (priority === 'HIGH'   &&  isHigh) ||
              (priority === 'NORMAL' && !isHigh)) {
            result.push(lines[i]);
            let j = i + 1;
            while (j < lines.length && isSubLine(lines[j])) {
              result.push(normalizeSubLinesForExcel(lines[j])); j++;
            }
            i = j; continue;
          } else {
            let j = i + 1;
            while (j < lines.length && isSubLine(lines[j])) j++;
            i = j; continue;
          }
        } else {
          result.push('\x00' + lines[i]);
        }
      }
      i++;
    }

    const cleaned = [];
    for (let k = 0; k < result.length; k++) {
      if (result[k].startsWith('\x00')) {
        const nextIsItem = k + 1 < result.length && !result[k + 1].startsWith('\x00');
        if (nextIsItem) cleaned.push(result[k].substring(1));
      } else {
        cleaned.push(result[k]);
      }
    }
    return cleaned.join('\n').trim();
  }

  // ── 통합 보기 ────────────────────────────────────────────────

  // 조출/토요근무 칩 렌더 헬퍼
  // 들여쓰기를 padding-left px 변환 (모달 공통)
  function formatJournalText(text) {
    if (!text) return '';
    return text.split('\n').map(function(line) {
      const trimmed = line.trimStart();
      const px      = (line.length - trimmed.length) * 7;
      return '<div style="padding-left:' + px + 'px;">' + (esc(trimmed) || '&nbsp;') + '</div>';
    }).join('');
  }

  function renderWorkChip(on, label) {
    return on
      ? `<span style="display:inline-flex;align-items:center;height:20px;padding:0 8px;border-radius:6px;font-size:11px;font-weight:600;background:#dbeafe;color:#1e40af;border:1px solid #bfdbfe;">✓ ${label}</span>`
      : `<span style="display:inline-flex;align-items:center;height:20px;padding:0 8px;border-radius:6px;font-size:11px;font-weight:500;background:#f1f5f9;color:#94a3b8;border:1px solid #e2e8f0;">${label}</span>`;
  }

  // 이번주/다음주 그룹 카드 렌더 헬퍼 (근태+조출+요약 통합)
  function renderWeekGroupCard(label, earlyOn, satOn, attendance, summaryText, formatFn) {
    const chipRow = `<div style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:0;">
      ${renderWorkChip(earlyOn,'조출')} ${renderWorkChip(satOn,'토요근무')}
    </div>`;
    const attRow = `<div style="margin-top:12px;">
      <div style="font-size:11px;font-weight:600;color:var(--text-secondary);margin-bottom:4px;">근태 특이사항</div>
      <div style="font-size:13px;white-space:pre-wrap;line-height:1.6;background:#fff;padding:7px 10px;border-radius:7px;border:1px solid var(--border-soft);margin-bottom:${summaryText?'12px':'0'};min-height:32px;color:${attendance?'var(--text-primary)':'var(--text-muted)'};">${attendance ? esc(attendance) : '-'}</div>
    </div>`;
    const sumRow = summaryText
      ? `<div style="font-size:11px;font-weight:600;color:var(--text-secondary);margin-bottom:3px;">${label==='이번 주'?'주간 업무 요약':'차주 업무 계획'}</div>
         <div style="font-size:13px;line-height:1.65;background:#fff;padding:8px 12px;border-radius:8px;border:1px solid var(--border-soft);">${formatFn(summaryText)}</div>`
      : '';
    return `<div style="background:#f8fafc;border:1.5px solid var(--border-soft);border-radius:12px;padding:12px 14px;box-sizing:border-box;">
      <div style="font-size:11px;font-weight:700;color:#0369a1;margin-bottom:8px;letter-spacing:0.03em;">${label}</div>
      ${chipRow}${attRow}${sumRow}
    </div>`;
  }

  function openMergeView() {
    const weekEnd = getWeekEnd(teamWeekStart);
    document.getElementById('mergeViewTitle').textContent =
      `팀원 주간일지 통합 보기 · ${teamWeekStart} ~ ${weekEnd}`;

    const members = _lastTeamData;
    const body    = document.getElementById('mergeViewBody');

    if (!members.length) {
      body.innerHTML = `<div class="task-empty" style="padding:40px 0;"><div class="task-empty-icon">👥</div><div class="task-empty-text">팀원 데이터가 없습니다.</div></div>`;
      _openModal('mergeViewModal');
      return;
    }

    const statusColor = { CLOSED: '#166534', SUBMITTED: '#1e40af', DRAFT: '#64748b' };
    const statusBg    = { CLOSED: '#dcfce7', SUBMITTED: '#dbeafe', DRAFT: '#f1f5f9' };
    const statusLabel = { CLOSED: '마감', SUBMITTED: '제출', DRAFT: '작성중' };

    let html = '';

    members.forEach((m, idx) => {
      const j       = m.journal;
      const s       = (m.task_summary && m.task_summary.summary) ? m.task_summary.summary : (m.task_summary || {});
      const pct     = s.total ? Math.round((s.done || 0) / s.total * 100) : 0;
      const status  = j ? (j.status || 'DRAFT') : null;
      const initial = (m.user_name || '?').charAt(0);

      const badgeStyle = status
        ? `background:${statusBg[status]};color:${statusColor[status]};`
        : 'background:#fef2f2;color:#b91c1c;';
      const badgeText = status ? statusLabel[status] : '미작성';

      html += `<div style="padding:22px 24px;${idx > 0 ? 'border-top:2px solid #e0e7f2;' : ''}">

        <!-- 멤버 헤더 -->
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:14px;">
          <div style="width:40px;height:40px;border-radius:50%;background:#e0f2fe;color:#0369a1;font-size:16px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;">${esc(initial)}</div>
          <div style="flex:1;min-width:0;">
            <div style="font-size:15px;font-weight:700;color:var(--text-primary);">${esc(m.user_name)}${m.is_manager ? ' 👑' : ''}</div>
            <div style="font-size:12px;color:var(--text-muted);">${esc(m.team_name || m.department || '')}</div>
          </div>
          <span style="font-size:11px;font-weight:700;padding:3px 10px;border-radius:999px;${badgeStyle}">${badgeText}</span>
        </div>

        <!-- 업무 현황 바 -->
        <div style="background:#f0f7ff;border-radius:10px;padding:10px 14px;margin-bottom:14px;display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
          <span style="font-size:12px;font-weight:600;color:var(--text-secondary);">업무 현황</span>
          <span style="font-size:12px;color:#1e293b;">전체 ${s.total||0}건</span>
          <span style="font-size:12px;color:#16a34a;">✓ 완료 ${s.done||0}</span>
          <span style="font-size:12px;color:#d97706;">⏳ 진행중 ${s.in_progress||0}</span>
          ${s.high ? `<span style="font-size:12px;color:#dc2626;">🔴 높은중요도 ${s.high}</span>` : ''}
          <div style="flex:1;min-width:60px;height:5px;background:#dbeafe;border-radius:999px;overflow:hidden;">
            <div style="height:100%;width:${pct}%;background:linear-gradient(90deg,#0369a1,#38bdf8);border-radius:999px;"></div>
          </div>
          <span style="font-size:11px;color:var(--text-muted);">${pct}%</span>
        </div>

        ${!j
          ? `<div style="font-size:13px;color:#94a3b8;text-align:center;padding:16px 0;">아직 일지를 작성하지 않았습니다.</div>`
          : `<!-- 이번 주 / 다음 주 2컬럼 그룹 카드 -->
             <div class="mj-2col-grid" style="margin-bottom:12px;">
               ${renderWeekGroupCard('이번 주',
                   j.early_work_this==='Y', j.sat_work_this==='Y',
                   j.attendance_this_week||'', j.summary||'', formatJournalText)}
               ${renderWeekGroupCard('다음 주',
                   (m.next_journal ? m.next_journal.early_work_this==='Y' : j.early_work_next==='Y'),
                   (m.next_journal ? m.next_journal.sat_work_this==='Y'   : j.sat_work_next==='Y'),
                   (m.next_journal ? m.next_journal.attendance_this_week  : j.attendance_next_week) || '',
                   (m.next_journal && m.next_journal.summary) || j.next_plan || '',
                   formatJournalText)}
             </div>
             ${j.issues ? `<div style="margin-bottom:10px;">
               <div style="font-size:11px;font-weight:700;color:#b45309;margin-bottom:5px;">⚠️ 이슈 / 건의사항</div>
               <div style="font-size:13px;white-space:pre-wrap;line-height:1.65;background:#fff8f0;padding:10px 14px;border-radius:10px;border:1.5px solid #fed7aa;">${esc(j.issues)}</div>
             </div>` : ''}
             <div style="font-size:11px;color:var(--text-muted);text-align:right;margin-top:2px;">
               ${j.updated_at   ? `최종 수정: ${j.updated_at.substring(0,16)}` : ''}
               ${j.submitted_at ? `&nbsp;|&nbsp; 제출: ${j.submitted_at.substring(0,16)}` : ''}
             </div>`
        }
      </div>`;
    });

    body.innerHTML = html;
    _openModal('mergeViewModal');

    // ResizeObserver로 실제 body 너비 감지 → 1/2컬럼 전환
    const mergeBody = body;
    if (mergeBody._mjResizeObserver) {
      mergeBody._mjResizeObserver.disconnect();
      mergeBody._mjResizeObserver = null;
    }
    const applyMergeGrid = function(width) {
      const isNarrow = width < 700;
      mergeBody.querySelectorAll('.mj-2col-grid').forEach(function(el) {
        el.style.gridTemplateColumns = isNarrow ? '1fr' : '1fr 1fr';
        el.style.display    = 'grid';
        el.style.gap        = isNarrow ? '10px' : '14px';
        el.style.alignItems = 'stretch';
      });
    };
    requestAnimationFrame(function() { applyMergeGrid(mergeBody.offsetWidth); });
    const ro = new ResizeObserver(function(entries) { applyMergeGrid(entries[0].contentRect.width); });
    ro.observe(mergeBody);
    mergeBody._mjResizeObserver = ro;
  }

  function closeMergeView() {
    const mergeBody = document.getElementById('mergeViewBody');
    if (mergeBody?._mjResizeObserver) {
      mergeBody._mjResizeObserver.disconnect();
      mergeBody._mjResizeObserver = null;
    }
    _closeModal('mergeViewModal');
  }

  // ── 업무 모달 ────────────────────────────────────────────────
  window.TASK_APP.openAddModal = async function(dateStr) {
    editingTaskId = null;
    document.getElementById('taskModalTitle').textContent = '업무 등록';
    document.getElementById('modalStartDate').value       = dateStr;
    document.getElementById('modalEndDate').value         = dateStr;
    document.getElementById('modalCategory').value        = '';
    document.getElementById('modalTitle').value           = '';
    document.getElementById('modalDescription').value     = '';
    setSingleDay(true);
    updatePriorityUI('MEDIUM');
    updateStatusUI('TODO');
    // [NEW] 수행 의원 드롭다운: 기본값 = 로그인 사용자 소속 의원
    populateWorkClinicSelect(currentUser.clinic_code || '', currentUser.clinic_name || '');
    openTaskModal();
  };

  window.TASK_APP.openEditModal = async function(taskId) {
    const task = weeklyTasks.find(t => t.task_id === taskId);
    if (!task) return;

    editingTaskId = taskId;
    document.getElementById('taskModalTitle').textContent = '업무 수정';
    document.getElementById('modalStartDate').value       = task.start_date || '';
    document.getElementById('modalEndDate').value         = task.end_date   || task.start_date || '';
    document.getElementById('modalCategory').value        = task.category   || '';
    document.getElementById('modalTitle').value           = task.title      || '';
    document.getElementById('modalDescription').value     = task.description || '';
    const isSingle = !task.end_date || task.end_date === task.start_date;
    setSingleDay(isSingle);
    updatePriorityUI(task.priority || 'MEDIUM');
    updateStatusUI(task.status    || 'TODO');
    // [NEW] 수행 의원 드롭다운: 기존 저장값 (없으면 소속 의원 fallback)
    populateWorkClinicSelect(
      task.work_clinic_code || task.clinic_code || currentUser.clinic_code || '',
      task.work_clinic_name || task.clinic_name || currentUser.clinic_name || ''
    );
    openTaskModal();
  };

  window.TASK_APP.toggleDay = function(dayTasksId) {
    const el = document.getElementById(dayTasksId);
    if (!el) return;
    el.style.display = el.style.display === 'none' ? '' : 'none';
  };

  window.TASK_APP.toggleTaskStatus = async function(taskId) {
    const task = weeklyTasks.find(t => t.task_id === taskId);
    if (!task) return;
    const newStatus = task.status === 'DONE' ? 'TODO' : 'DONE';
    try {
      showGlobalLoading(newStatus === 'DONE' ? '완료 처리 중...' : '되돌리는 중...');
      const _togglePayload = {
        request_user_email: currentUser.email,
        task_id:            taskId,
        status:             newStatus
      };
      const toggleRes = await (async()=>{const{error}=await supabaseClient.from('task_items').update({..._togglePayload,updated_at:new Date().toISOString()}).eq('task_id',_togglePayload.task_id);if(error)throw error;return{success:true,data:_togglePayload};})()
      task.status = newStatus;
      renderWeekTimeline();
      updateWeeklySummary();
      if (toggleRes && toggleRes.journal) onJournalAutoSynced(toggleRes.journal);
    } catch (err) {
      showMessage(err.message || '상태 변경에 실패했습니다.', 'error');
    } finally {
      hideGlobalLoading();
    }
  };

  window.TASK_APP.deleteTask = async function(taskId) {
    const task = weeklyTasks.find(t => t.task_id === taskId);
    if (!task) return;
    if (!confirm(`"${task.title}" 업무를 삭제하시겠습니까?`)) return;
    try {
      showGlobalLoading('삭제 중...');
      const deleteRes = await (async()=>{const{error}=await supabaseClient.from('task_items').delete().eq('task_id',taskId);if(error)throw error;return{success:true};})();
      weeklyTasks = weeklyTasks.filter(t => t.task_id !== taskId);
      renderWeekTimeline();
      updateWeeklySummary();
      showMessage('삭제되었습니다.', 'success');
      if (deleteRes && deleteRes.journal) onJournalAutoSynced(deleteRes.journal);
    } catch (err) {
      showMessage(err.message || '삭제에 실패했습니다.', 'error');
    } finally {
      hideGlobalLoading();
    }
  };

  function setSingleDay(single) {
    const checkbox = document.getElementById('modalSingleDay');
    const endInput = document.getElementById('modalEndDate');
    if (!checkbox || !endInput) return;
    checkbox.checked = single;
    const startVal = document.getElementById('modalStartDate')?.value || '';
    if (single) {
      // 단기업무: 종료일을 시작일과 동일하게 고정 후 비활성화
      endInput.value    = startVal;
      endInput.disabled = true;
      endInput.style.opacity = '0.5';
      endInput.style.cursor  = 'not-allowed';
    } else {
      endInput.disabled = false;
      endInput.style.opacity = '';
      endInput.style.cursor  = '';
      endInput.min = startVal;
    }
  }

  // ── 모달 공통 헬퍼 — body overflow 관리 ──────────────────────
  function _openModal(id) {
    document.getElementById(id)?.classList.add('open');
    document.body.style.overflow = 'hidden';
  }
  function _closeModal(id) {
    document.getElementById(id)?.classList.remove('open');
    // 열려있는 다른 모달이 없을 때만 overflow 복원
    const anyOpen = document.querySelector('.task-modal-overlay.open');
    if (!anyOpen) document.body.style.overflow = '';
  }

  function openTaskModal() {
    _openModal('taskModal');
  }

  function closeTaskModal() {
    _closeModal('taskModal');
    editingTaskId = null;
  }

  async function saveTask() {
    const startDate   = document.getElementById('modalStartDate').value.trim();
    const isSingle    = document.getElementById('modalSingleDay').checked;
    const endDate     = isSingle ? startDate : (document.getElementById('modalEndDate').value.trim() || startDate);
    const category    = document.getElementById('modalCategory').value.trim();
    const title       = document.getElementById('modalTitle').value.trim();
    const description = document.getElementById('modalDescription').value.trim();
    const priority    = document.querySelector('input[name="priority"]:checked')?.value || 'MEDIUM';
    const status      = document.querySelector('input[name="status"]:checked')?.value   || 'TODO';

    // [NEW] 수행 의원
    const workClinicSel  = document.getElementById('modalWorkClinic');
    const workClinicCode = workClinicSel ? workClinicSel.value : '';
    const workClinicName = workClinicSel
      ? (workClinicSel.options[workClinicSel.selectedIndex]?.text || '')
      : '';

    if (!startDate) { alert('시작일을 입력하세요.');    return; }
    if (!category)  { alert('업무 구분을 선택하세요.'); return; }
    if (!title)     { alert('업무 제목을 입력하세요.'); return; }
    if (endDate < startDate) { alert('종료일은 시작일보다 빠를 수 없습니다.'); return; }

    const payload = {
      request_user_email: currentUser.email,
      start_date:         startDate,
      end_date:           endDate,
      category:           category,
      title:              title,
      description:        description,
      priority:           priority,
      status:             status,
      work_clinic_code:   workClinicCode,   // [NEW]
      work_clinic_name:   workClinicName    // [NEW]
    };

    const saveBtn = document.getElementById('taskModalSaveBtn');

    try {
      setTaskModalLoading(true, editingTaskId ? '수정 중...' : '저장 중...');

      let saveRes;
      if (editingTaskId) {
        payload.task_id = editingTaskId;
        saveRes = await (async()=>{const p=payload;const{error}=await supabaseClient.from('task_items').update({...p,updated_at:new Date().toISOString()}).eq('task_id',p.task_id);if(error)throw error;return{success:true,data:p};})();
        const idx = weeklyTasks.findIndex(t => t.task_id === editingTaskId);
        if (idx !== -1) {
          const newWeekStart = getWeekStart(startDate);
          const newWeekEnd   = getWeekEnd(newWeekStart);
          const overlapsCurrentWeek = startDate <= getWeekEnd(weeklyWeekStart) &&
                                      endDate   >= weeklyWeekStart;
          if (overlapsCurrentWeek) {
            weeklyTasks[idx] = Object.assign({}, weeklyTasks[idx], payload, {
              week_start: newWeekStart,
              week_end:   newWeekEnd
            });
          } else {
            weeklyTasks.splice(idx, 1);
          }
        }
        showMessage('업무가 수정되었습니다.', 'success');
      } else {
        saveRes = await (async()=>{const p=payload;p.task_id=p.task_id||generateTaskId();const{data,error}=await supabaseClient.from('task_items').insert(p).select().single();if(error)throw error;return{success:true,data};})();
        weeklyTasks.push(saveRes.data);
        showMessage('업무가 등록되었습니다.', 'success');
      }

      closeTaskModal();
      renderWeekTimeline();
      updateWeeklySummary();
      // 서버가 반환한 journal로 일지탭 UI 즉시 갱신
      if (saveRes && saveRes.journal) {
        onJournalAutoSynced(saveRes.journal);
      }

    } catch (err) {
      showMessage(err.message || '저장에 실패했습니다.', 'error');
    } finally {
      setTaskModalLoading(false);
    }
  }

  // ── 덮어쓰기 확인 모달 ──────────────────────────────────────
  function showOverwriteConfirm(weekStart, statusLabel) {
    return new Promise(function(resolve) {
      document.getElementById('overwriteWeekLabel').textContent  = weekStart;
      document.getElementById('overwriteStatusLabel').textContent = statusLabel;
      document.getElementById('overwriteModal').classList.add('open');

      function onConfirm() { cleanup(); resolve(true); }
      function onCancel()  { cleanup(); resolve(false); }

      function cleanup() {
        document.getElementById('overwriteModal').classList.remove('open');
        document.getElementById('overwriteConfirmBtn').removeEventListener('click', onConfirm);
        document.getElementById('overwriteCancelBtn').removeEventListener('click', onCancel);
      }

      document.getElementById('overwriteConfirmBtn').addEventListener('click', onConfirm);
      document.getElementById('overwriteCancelBtn').addEventListener('click', onCancel);
    });
  }

  // ── 검색 ─────────────────────────────────────────────────────

  function setSearchDefaultDates() {
    const fromEl = document.getElementById('searchDateFrom');
    const toEl   = document.getElementById('searchDateTo');
    if (!fromEl || !toEl) return;
    // 이미 값이 있으면 덮어쓰지 않음
    if (fromEl.value && toEl.value) return;
    const today  = new Date();
    const from   = new Date(today);
    from.setDate(today.getDate() - 7);
    toEl.value   = formatDateStr(today);
    fromEl.value = formatDateStr(from);
  }

  function updateSearchCategorySelect() {
    const sel = document.getElementById('searchCategory');
    if (!sel) return;
    const current = sel.value;
    sel.innerHTML = '<option value="">전체</option>' +
      Object.entries(CATEGORY_LABELS).map(([v, n]) =>
        `<option value="${esc(v)}"${v === current ? ' selected' : ''}>${esc(n)}</option>`
      ).join('');
  }

  // applyCategories 후 검색 셀렉트도 동기화됨 (applyCategories 내부에서 처리)

  async function runSearch() {
    const dateFrom  = document.getElementById('searchDateFrom').value.trim();
    const dateTo    = document.getElementById('searchDateTo').value.trim();
    const keyword   = document.getElementById('searchKeyword').value.trim();
    const category  = document.getElementById('searchCategory').value.trim();
    const status    = document.getElementById('searchStatus').value.trim();
    const priority  = document.getElementById('searchPriority').value.trim();

    if (!dateFrom && !dateTo && !keyword && !category && !status && !priority) {
      showMessage('검색 조건을 하나 이상 입력하세요.', 'error');
      return;
    }

    const resultList = document.getElementById('searchResultList');
    const resultHead = document.getElementById('searchResultHead');
    resultHead.style.display = 'none';
    resultList.innerHTML = `
      <div class="search-loading">
        <div class="task-loading-spinner" style="width:20px;height:20px;border-width:2px;"></div>
        검색 중...
      </div>`;

    try {
      const params = { request_user_email: currentUser.email };
      if (dateFrom)  params.date_from = dateFrom;
      if (dateTo)    params.date_to   = dateTo;
      if (keyword)   params.keyword   = keyword;
      if (category)  params.category  = category;
      if (status)    params.status    = status;
      if (priority)  params.priority  = priority;

      const res     = await (async()=>{const _d=await sbSearchTaskItems(params);return{success:true,data:_d,count:_d.length};})();
      const results = res.data || [];

      renderSearchResults(results, keyword);

    } catch (err) {
      resultList.innerHTML = `
        <div class="task-empty task-empty--error">
          <div class="task-empty-icon">⚠️</div>
          <div class="task-empty-text">${esc(err.message || '검색에 실패했습니다.')}</div>
        </div>`;
    }
  }

  function renderSearchResults(results, keyword) {
    const resultList = document.getElementById('searchResultList');
    const resultHead = document.getElementById('searchResultHead');
    const countEl   = document.getElementById('searchResultCount');

    resultHead.style.display = '';
    countEl.innerHTML = `총 <strong>${results.length}</strong>건`;

    if (!results.length) {
      resultList.innerHTML = `
        <div class="task-empty">
          <div class="task-empty-icon">🔍</div>
          <div class="task-empty-text">검색 결과가 없습니다.</div>
        </div>`;
      return;
    }

    resultList.innerHTML = `<div style="padding:8px 22px 16px;">` +
      results.map(t => {
        const priorityCls = t.priority === 'HIGH' ? 'priority-high' : t.priority === 'LOW' ? 'priority-low' : 'priority-medium';
        const statusCls   = t.status === 'DONE' ? 'badge-status-done' : t.status === 'IN_PROGRESS' ? 'badge-status-inprogress' : 'badge-status-todo';
        const statusLabel = STATUS_LABELS[t.status] || t.status;
        const catLabel    = CATEGORY_LABELS[t.category] || t.category || '';
        const isSingle    = !t.end_date || t.start_date === t.end_date;
        const dateStr     = isSingle
          ? t.start_date.substring(5).replace('-', '/')
          : t.start_date.substring(5).replace('-','/') + ' ~ ' + t.end_date.substring(5).replace('-','/');

        const titleHtml = keyword ? highlight(t.title, keyword)      : esc(t.title);
        const descHtml  = keyword ? highlight(t.description, keyword) : esc(t.description);

        return `
          <div class="task-item" onclick="TASK_APP.openSearchItem('${esc(t.task_id)}','${esc(getWeekStart(t.start_date))}')">
            <span class="task-priority-dot ${priorityCls}"></span>
            <div class="task-item-body">
              <div class="task-item-title">${titleHtml}</div>
              <div class="task-item-meta">
                <span class="task-badge badge-category">${esc(catLabel)}</span>
                <span class="task-badge ${statusCls}">${esc(statusLabel)}</span>
                ${t.description ? `<span style="font-size:11px;color:var(--text-muted);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${descHtml}</span>` : ''}
              </div>
            </div>
            <span class="search-item-date">${esc(dateStr)}</span>
          </div>`;
      }).join('') + `</div>`;
  }

  function highlight(text, keyword) {
    if (!text || !keyword) return esc(text);
    const escaped   = esc(text);
    const escapedKw = esc(keyword).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return escaped.replace(new RegExp('(' + escapedKw + ')', 'gi'),
      '<mark style="background:#fef08a;border-radius:2px;padding:0 1px;">$1</mark>');
  }

  function resetSearch() {
    document.getElementById('searchDateFrom').value = '';
    document.getElementById('searchDateTo').value   = '';
    document.getElementById('searchKeyword').value  = '';
    document.getElementById('searchCategory').value = '';
    document.getElementById('searchStatus').value   = '';
    document.getElementById('searchPriority').value = '';
    setSearchDefaultDates();
    document.getElementById('searchResultHead').style.display = 'none';
    document.getElementById('searchResultList').innerHTML = `
      <div class="task-empty">
        <div class="task-empty-icon">🔍</div>
        <div class="task-empty-text">검색 조건을 입력하고 검색 버튼을 눌러주세요.</div>
      </div>`;
  }

  window.TASK_APP.openSearchItem = function(taskId, weekStart) {
    // 검색 결과에서 week_start를 직접 받아 API 재호출 없이 즉시 이동
    showGlobalLoading('업무를 불러오는 중...');
    weeklyWeekStart = weekStart || getWeekStart(formatDateStr(new Date()));
    loadWeeklyTasks().then(() => {
      switchTab('weekly');
      TASK_APP.openEditModal(taskId);
    }).catch(err => {
      showMessage(err.message, 'error');
    }).finally(() => {
      hideGlobalLoading();
    });
  };

  // ── 의원 목록 로드 ───────────────────────────────────────────
  // codes 시트의 ORG_CLINIC 그룹에서 의원 목록을 로드해 clinicOptions 에 저장.
  // 업무 등록/수정 모달의 "수행 의원" 드롭다운에 사용.
  async function loadClinics() {
    try {
      // maneasy: clinics 테이블에서 직접 조회
      const { data, error } = await supabaseClient
        .from('clinics')
        .select('clinic_code, clinic_name')
        .order('clinic_name', { ascending: true });
      if (error) throw error;
      clinicOptions = (data || []).map(c => ({ code_value: c.clinic_code, code_name: c.clinic_name }));
    } catch (err) {
      clinicOptions = [];
      console.warn('[loadClinics] 의원 목록 로드 실패:', err.message || err);
    }
  }

  // 업무 모달의 수행 의원 드롭다운을 채우고 selectedCode 로 초기값 설정.
  // selectedCode 미전달(undefined/빈 값) 시 → 로그인 사용자 소속 의원을 기본 선택.
  // clinicOptions 가 비어있으면 currentUser 소속 의원만 옵션으로 추가.
  function populateWorkClinicSelect(selectedCode, selectedName) {
    const sel = document.getElementById('modalWorkClinic');
    if (!sel) return;

    let options = clinicOptions.length > 0
      ? clinicOptions
      : [{ code_value: currentUser.clinic_code || '', code_name: currentUser.clinic_name || '내 소속 의원' }];

    // 선택값이 목록에 없을 경우(구 데이터 호환)를 대비해 추가
    if (selectedCode && !options.find(o => o.code_value === selectedCode)) {
      options = [{ code_value: selectedCode, code_name: selectedName || selectedCode }, ...options];
    }

    // 기본값 결정:
    // 1) selectedCode 가 명시된 경우 → 그 값 사용
    // 2) 없으면 → currentUser.clinic_code (소속 의원)
    // 3) 그것도 없으면 → 목록 첫 번째 옵션
    const defaultCode = selectedCode
      || currentUser.clinic_code
      || (options[0] && options[0].code_value)
      || '';

    sel.innerHTML = options.map(o =>
      `<option value="${esc(o.code_value)}"${o.code_value === defaultCode ? ' selected' : ''}>${esc(o.code_name)}</option>`
    ).join('');
  }

  // ── 카테고리 관리 ────────────────────────────────────────────

  async function loadCategories(force = false) {
    if (!force && Object.keys(CATEGORY_LABELS).length > 0) return;
    try {
      const teamCode = currentUser.team_code || '';
      let q = supabaseClient.from('task_categories').select('*').eq('use_yn', true);
      if (teamCode) q = q.or(`team_group_code.eq.${teamCode},team_group_code.is.null`);
      else q = q.is('team_group_code', null);
      const { data, error } = await q.order('category_name', { ascending: true });
      if (error) throw error;
      // applyCategories 형식에 맞게 변환
      const mapped = (data || []).map(c => ({ code_value: c.category_code, code_name: c.category_name }));
      applyCategories({ data: mapped, code_group: 'TASK_CATEGORY', is_team_custom: !!teamCode });
    } catch (err) {
      console.error('[loadCategories] 실패:', err.message, err.stack);
    }
  }

  function applyCategories(res) {
    if (!res || !res.data) return;
    const newLabels = {};
    res.data.forEach(function(c) {
      newLabels[c.code_value] = c.code_name;
    });
    CATEGORY_LABELS   = newLabels;
    categoryCodeGroup = res.code_group    || 'TASK_CATEGORY';
    categoryIsCustom  = res.is_team_custom || false;
    // 모달 + 검색 카테고리 셀렉트 동시 갱신
    updateCategorySelect();
    updateSearchCategorySelect();
  }

  function updateCategorySelect() {
    const sel = document.getElementById('modalCategory');
    if (!sel) return;
    const currentVal = sel.value;
    sel.innerHTML = '<option value="">선택하세요</option>' +
      Object.entries(CATEGORY_LABELS).map(function([v, n]) {
        return `<option value="${esc(v)}">${esc(n)}</option>`;
      }).join('');
    sel.value = currentVal;
  }

  async function openCategoryModal() {
    _openModal('categoryModal');
    await renderCategoryList();
  }

  function closeCategoryModal() {
    _closeModal('categoryModal');
    resetCategoryForm();
  }

  async function renderCategoryList() {
    const listEl  = document.getElementById('categoryList');
    const badgeEl = document.getElementById('categorySourceBadge');
    const tipEl   = document.getElementById('categoryTip');

    listEl.innerHTML = `<div style="display:flex;align-items:center;gap:10px;padding:16px;">
      <div class="task-loading-spinner" style="width:20px;height:20px;border-width:3px;flex-shrink:0;"></div>
      <span style="font-size:12px;color:var(--text-muted);">불러오는 중...</span>
    </div>`;

    try {
      const res = await (async()=>{const{data}=await supabaseClient.from('task_categories').select('*').eq('use_yn',true).order('category_name');const mapped=(data||[]).map(c=>({code_value:c.category_code,code_name:c.category_name,id:c.id}));return{data:mapped};})();
      applyCategories(res);

      badgeEl.textContent = '팀 전용';
      badgeEl.className   = 'category-source-badge is-custom';
      tipEl.textContent   = categoryIsCustom
        ? '팀 전용 카테고리가 적용 중입니다.'
        : '카테고리를 추가하면 팀 전용으로 사용됩니다.';

      if (!res.data || res.data.length === 0) {
        listEl.innerHTML = '<div style="font-size:12px;color:var(--text-muted);padding:8px 0;">등록된 카테고리가 없습니다.</div>';
        return;
      }

      listEl.innerHTML = res.data.map(function(c) {
        const canDelete = categoryIsCustom; // 팀 전용만 삭제 가능
        return `
          <div class="category-item">
            <span class="category-item-order">${c.sort_order}</span>
            <span class="category-item-name">${esc(c.code_name)}</span>
            <div class="category-item-actions">
              <button class="task-icon-btn" title="수정" onclick="TASK_APP.editCategory('${esc(c.code_value)}','${esc(c.code_name)}',${c.sort_order},'${esc(c.code_group)}')">✎</button>
              ${canDelete ? `<button class="task-icon-btn danger" title="삭제" onclick="TASK_APP.deleteCategory('${esc(c.code_value)}','${esc(c.code_name)}','${esc(c.code_group)}')">🗑</button>` : ''}
            </div>
          </div>
        `;
      }).join('');

    } catch (err) {
      listEl.innerHTML = `<div style="font-size:12px;color:#dc2626;">${esc(err.message)}</div>`;
    }
  }

  function resetCategoryForm() {
    document.getElementById('catInputName').value  = '';
    document.getElementById('catInputOrder').value = '';
    document.getElementById('catEditValue').value  = '';
    document.getElementById('catEditGroup').value  = '';
    document.getElementById('catAddBtn').textContent = '추가';
  }

  window.TASK_APP.editCategory = function(codeValue, codeName, sortOrder, codeGroup) {
    document.getElementById('catInputName').value  = codeName;
    document.getElementById('catInputOrder').value = sortOrder;
    document.getElementById('catEditValue').value  = codeValue;
    document.getElementById('catEditGroup').value  = codeGroup;
    document.getElementById('catAddBtn').textContent = '수정';
    document.getElementById('catInputName').focus();
  };

  window.TASK_APP.deleteCategory = async function(codeValue, codeName, codeGroup) {
    if (!confirm(`"${codeName}" 카테고리를 삭제하시겠습니까?`)) return;
    try {
      await (async()=>{const{error}=await supabaseClient.from('task_categories').update({use_yn:false}).eq('category_code',codeToDelete);if(error)throw error;return{success:true};})();
      showMessage('카테고리가 삭제되었습니다.', 'success');
      await renderCategoryList();
    } catch (err) {
      showMessage(err.message || '삭제에 실패했습니다.', 'error');
    }
  };

  async function saveCategoryItem() {
    const name       = document.getElementById('catInputName').value.trim();
    const order      = Number(document.getElementById('catInputOrder').value) || 1;
    const editValue  = document.getElementById('catEditValue').value.trim();
    const editGroup  = document.getElementById('catEditGroup').value.trim();

    if (!name) { alert('카테고리 이름을 입력하세요.'); return; }

    // 신규 추가 시 code_value 자동 생성 (한글 → 영문 불가, 타임스탬프 기반)
    const codeValue = editValue || ('CAT_' + Date.now().toString(36).toUpperCase());

    try {
      document.getElementById('catAddBtn').disabled = true;
      await (async()=>{const nm=catNameInput.value.trim();const cd=catCodeInput.value.trim();const{error}=await supabaseClient.from('task_categories').upsert({category_code:cd,category_name:nm,team_group_code:currentUser.team_code||null,use_yn:true,updated_at:new Date().toISOString()},{onConflict:'category_code'});if(error)throw error;return{success:true};})();
      showMessage(editValue ? '카테고리가 수정되었습니다.' : '카테고리가 추가되었습니다.', 'success');
      resetCategoryForm();
      await renderCategoryList();
      // 모달 카테고리 셀렉트 갱신
      updateCategorySelect();
    } catch (err) {
      showMessage(err.message || '저장에 실패했습니다.', 'error');
    } finally {
      document.getElementById('catAddBtn').disabled = false;
    }
  }

  function setTaskModalLoading(active, text) {
    const overlay  = document.getElementById('taskModalLoading');
    const textEl   = document.getElementById('taskModalLoadingText');
    const saveBtn  = document.getElementById('taskModalSaveBtn');
    const cancelBtn = document.getElementById('taskModalCancelBtn');
    const closeBtn  = document.getElementById('taskModalClose');
    if (!overlay) return;
    if (active) {
      if (textEl) textEl.textContent = text || '저장 중...';
      overlay.classList.add('active');
      if (saveBtn)   saveBtn.disabled  = true;
      if (cancelBtn) cancelBtn.disabled = true;
      if (closeBtn)  closeBtn.disabled  = true;
    } else {
      overlay.classList.remove('active');
      if (saveBtn)   saveBtn.disabled  = false;
      if (cancelBtn) cancelBtn.disabled = false;
      if (closeBtn)  closeBtn.disabled  = false;
    }
  }

  // ── 우선순위 / 상태 UI ────────────────────────────────────────
  function updatePriorityUI(value) {
    const map = { HIGH: 'priHigh', MEDIUM: 'priMedium', LOW: 'priLow' };
    Object.entries(map).forEach(([v, id]) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.className = 'priority-option' + (v === value ? ` selected-${v.toLowerCase()}` : '');
    });
    const radio = document.querySelector(`input[name="priority"][value="${value}"]`);
    if (radio) radio.checked = true;
  }

  function updateStatusUI(value) {
    const map    = { TODO: 'stTodo', IN_PROGRESS: 'stInProgress', DONE: 'stDone' };
    const clsMap = { TODO: 'todo', IN_PROGRESS: 'inprogress', DONE: 'done' };
    Object.entries(map).forEach(([v, id]) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.className = 'status-option' + (v === value ? ` selected-${clsMap[v]}` : '');
    });
    const radio = document.querySelector(`input[name="status"][value="${value}"]`);
    if (radio) radio.checked = true;
  }

  // ── 메시지 ────────────────────────────────────────────────────
  function showMessage(msg, type = 'info') {
    const el = document.getElementById('messageBox');
    if (!el) return;
    el.textContent = msg;
    el.className   = `message-box is-${type}`;
    el.style.display = '';
    clearTimeout(el.__timer);
    el.__timer = setTimeout(() => { el.style.display = 'none'; }, 4000);
  }

  // ── XSS 방어 ──────────────────────────────────────────────────
  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

})();
