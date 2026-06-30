/**
 * task-manager.js — 업무일정 관리
 * maneasy 구조 전면 재작성 (GAS 제거, Supabase 직접 연결)
 */
(function () {
  'use strict';

  /* ── 상태 ──────────────────────────────────────── */
  let currentUser   = null;
  let isManager     = false;
  let isAdmin       = false;

  // 달력
  let calYear  = new Date().getFullYear();
  let calMonth = new Date().getMonth(); // 0-based
  let selectedDate  = null;  // 'yyyy-mm-dd'
  let calTasks      = [];    // 현재 월 task_items
  let calJournal    = null;  // 현재 사용자 주 단위 journal (선택 날짜 기준)
  let _journalMap   = {};    // { week_start: journal } — 달력 근태 토글용
  let calViewMode   = 'mine'; // 'mine' | 'team' — 달력에 내 업무만 / 팀 전체 업무
  let _teamMemberMap   = {}; // { email: user_name } — 팀 전체보기용 이름 캐시
  let _teamMembersReady = false;

  // 팀 현황
  let teamWeekStart = '';

  // 카테고리 / 의원
  let CATEGORIES    = {};  // { code: name }
  let clinicOptions = [];  // [{ code, name }]

  // 업무검색
  let _searchGridApi   = null;
  let _searchTaskCache = {}; // task_id -> task — 검색 결과는 calTasks에 없으므로 모달 조회용 별도 캐시
  let _taskModalSource = null; // 'search' | null — 저장/삭제 후 어디를 새로고침할지 판단

  // 업무 모달
  let editingTaskId  = null;
  let modalPriority  = 'MEDIUM';
  let modalStatus    = 'TODO';

  const DOW_KR  = ['일','월','화','수','목','금','토'];
  const STATUS_LABEL = { TODO:'예정', IN_PROGRESS:'진행중', DONE:'완료' };

  /* ── 초기화 ────────────────────────────────────── */
  document.addEventListener('DOMContentLoaded', async () => {
    currentUser = await auth.getSession();
    if (!currentUser) {
      parent.shellNavigate?.('login');
      return;
    }

    const role = String(currentUser.role || '').toLowerCase();
    isAdmin   = role === 'admin';
    const perms = currentUser.page_perms || {};
    const LEVELS = ['접근불가','user','edit','manager','admin'];
    const myLevel = LEVELS.indexOf(perms['task/task-manager'] || '접근불가');
    isManager = isAdmin || myLevel >= LEVELS.indexOf('manager');

    // 탭 전환
    document.querySelectorAll('.task-tab').forEach(btn => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    // 달력 이벤트
    document.getElementById('calPrevBtn').addEventListener('click', () => { calMonth--; if(calMonth<0){calMonth=11;calYear--;} withGlobalLoading(renderCalendar); });
    document.getElementById('calNextBtn').addEventListener('click', () => { calMonth++; if(calMonth>11){calMonth=0;calYear++;} withGlobalLoading(renderCalendar); });
    document.getElementById('calTodayBtn').addEventListener('click', () => { const n=new Date(); calYear=n.getFullYear(); calMonth=n.getMonth(); withGlobalLoading(renderCalendar); });
    document.getElementById('addTaskBtn').addEventListener('click', () => openTaskModal(null));

    // 팀 현황 이벤트
    document.getElementById('teamPrevBtn').addEventListener('click', () => { teamWeekStart = offsetWeek(teamWeekStart, -1); loadTeamView(); });
    document.getElementById('teamNextBtn').addEventListener('click', () => { teamWeekStart = offsetWeek(teamWeekStart, 1); loadTeamView(); });
    document.getElementById('teamTodayBtn').addEventListener('click', () => { teamWeekStart = getWeekStart(todayStr()); loadTeamView(); });
    document.getElementById('exportExcelBtn').addEventListener('click', exportExcel);

    // 검색
    document.getElementById('searchBtn').addEventListener('click', runSearch);
    document.getElementById('searchKeyword').addEventListener('keydown', e => { if(e.key==='Enter') runSearch(); });

    // 모달 배경 클릭
    document.getElementById('taskModal').addEventListener('click', e => {  });

    // 엑셀 버튼 manager/admin만
    if (isManager) {
      document.getElementById('exportExcelBtn').style.display = '';
      document.getElementById('teamPdfBtn').style.display = '';
      document.getElementById('teamPdfBtn').addEventListener('click', printTeamReport);
      document.getElementById('bulkCloseBtn').style.display = '';
      document.getElementById('bulkCloseBtn').addEventListener('click', bulkCloseJournals);
      document.getElementById('manageCatBtn').style.display = '';
      document.getElementById('manageCatBtn').addEventListener('click', openCatModal);
    }

    // 팀 전체보기 토글 — 소속 부서가 있으면 누구나 사용 가능
    if (currentUser.team_code) {
      const teamBtn = document.getElementById('teamViewBtn');
      teamBtn.style.display = '';
      teamBtn.addEventListener('click', () => {
        calViewMode = calViewMode === 'team' ? 'mine' : 'team';
        teamBtn.classList.toggle('btn-primary', calViewMode === 'team');
        teamBtn.innerHTML = calViewMode === 'team'
          ? '<i class="ti ti-user"></i> 내 업무만'
          : '<i class="ti ti-users"></i> 팀 전체보기';
        withGlobalLoading(async () => {
          await renderCalendar();
          if (selectedDate) await renderDetailPanel(selectedDate);
        });
      });
    }

    // 검색 기본 날짜
    const fromEl = document.getElementById('searchFrom');
    const toEl   = document.getElementById('searchTo');
    if (fromEl) { const d = new Date(); d.setMonth(d.getMonth()-1); fromEl.value = d.toISOString().slice(0,10); }
    if (toEl)   toEl.value = todayStr();

    // 팀 현황 초기 주차
    teamWeekStart = getWeekStart(todayStr());

    await withGlobalLoading(async () => {
      await Promise.all([loadCategories(), loadClinics()]);
      await renderCalendar();
    }, '데이터를 불러오는 중...');
  });

  /* ── 탭 전환 ───────────────────────────────────── */
  function switchTab(tab) {
    document.querySelectorAll('.task-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    document.querySelectorAll('.task-panel').forEach(p => p.classList.toggle('active', p.id === 'panel' + cap(tab)));
    if (tab === 'team') loadTeamView();
    if (tab === 'search') runSearch();
  }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  /* ── 날짜 유틸 ─────────────────────────────────── */
  function todayStr() { return new Date().toISOString().slice(0,10); }
  function getWeekStart(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    const day = d.getDay(); // 0=일
    d.setDate(d.getDate() - day);
    return d.toISOString().slice(0,10);
  }
  function getWeekEnd(ws) {
    const d = new Date(ws + 'T00:00:00');
    d.setDate(d.getDate() + 6);
    return d.toISOString().slice(0,10);
  }
  function offsetWeek(ws, delta) {
    const d = new Date(ws + 'T00:00:00');
    d.setDate(d.getDate() + delta * 7);
    return d.toISOString().slice(0,10);
  }
  function fmt(dateStr) {
    if (!dateStr) return '';
    return dateStr.slice(5).replace('-','/');
  }
  function generateTaskId() {
    const d = new Date();
    const ds = d.getFullYear() + String(d.getMonth()+1).padStart(2,'0') + String(d.getDate()).padStart(2,'0');
    return 'TASK_' + ds + '_' + Math.random().toString(36).slice(2,6).toUpperCase();
  }

  /* ── 카테고리 / 의원 로드 ──────────────────────── */
  async function loadCategories() {
    if (!currentUser.clinic_code || !currentUser.team_code) return;
    const { data } = await supabaseClient.from('task_categories').select('*')
      .eq('clinic_code', currentUser.clinic_code)
      .eq('team_code', currentUser.team_code)
      .eq('use_yn', true)
      .order('sort_order').order('category_name');
    CATEGORIES = {};
    (data || []).forEach(c => { CATEGORIES[c.category_code] = c.category_name; });
    updateCategorySelect();
  }
  function updateCategorySelect() {
    const sel = document.getElementById('mtCategory');
    if (!sel) return;
    sel.innerHTML = '<option value="">카테고리 없음</option>' +
      Object.entries(CATEGORIES).map(([k,v]) => `<option value="${esc(k)}">${esc(v)}</option>`).join('');
  }

  /* ── 카테고리 관리 모달 ─────────────────────────── */
  let _catClinics = [];   // [{ clinic_code, clinic_name }]
  let _catDepts   = [];   // [{ team_code, team_name, clinic_code }]

  async function openCatModal() {
    // 의원/부서 목록 로드
    const [{ data: cl }, { data: dp }] = await Promise.all([
      supabaseClient.from('clinics').select('clinic_code,clinic_name').order('sort_order'),
      supabaseClient.from('departments').select('dept_code,dept_name,clinic_id,clinics(clinic_code)').order('sort_order'),
    ]);
    _catClinics = cl || [];
    _catDepts   = (dp || []).map(d => ({ team_code: d.dept_code, team_name: d.dept_name, clinic_code: d.clinics?.clinic_code || '' }));

    const cSel = document.getElementById('catClinicSel');
    cSel.innerHTML = _catClinics.map(c => `<option value="${esc(c.clinic_code)}">${esc(c.clinic_name)}</option>`).join('');
    // 본인 의원으로 초기 선택
    if (currentUser.clinic_code) cSel.value = currentUser.clinic_code;
    onCatClinicChange();
    document.getElementById('catModal').classList.add('is-open');
  }

  function onCatClinicChange() {
    const clinicCode = document.getElementById('catClinicSel').value;
    const depts = _catDepts.filter(d => d.clinic_code === clinicCode);
    const tSel = document.getElementById('catTeamSel');
    tSel.innerHTML = depts.map(d => `<option value="${esc(d.team_code)}">${esc(d.team_name)}</option>`).join('');
    if (currentUser.team_code && depts.find(d => d.team_code === currentUser.team_code)) {
      tSel.value = currentUser.team_code;
    }
    loadCatList();
  }

  async function loadCatList() {
    const clinicCode = document.getElementById('catClinicSel').value;
    const teamCode   = document.getElementById('catTeamSel').value;
    if (!clinicCode || !teamCode) return;

    const { data } = await supabaseClient.from('task_categories').select('*')
      .eq('clinic_code', clinicCode).eq('team_code', teamCode)
      .order('sort_order').order('category_name');

    const wrap = document.getElementById('catListWrap');
    if (!data?.length) {
      wrap.innerHTML = '<div style="padding:20px;text-align:center;color:#9ca3af;font-size:12px;">등록된 카테고리가 없습니다</div>';
      return;
    }
    wrap.innerHTML = (data).map((c, i) => `
      <div style="display:flex;align-items:center;gap:8px;padding:7px 12px;border-bottom:1px solid #f3f4f6;font-size:12px;" data-cat-id="${c.id}">
        <span style="flex:1;font-weight:600;color:#374151;">${esc(c.category_name)}</span>
        <input type="text" value="${esc(c.category_name)}" data-id="${c.id}"
          style="display:none;flex:1;height:26px;padding:0 8px;border:1px solid #2563eb;border-radius:4px;font-size:12px;outline:none;"
          class="cat-edit-input" />
        <button class="tbl-btn" onclick="startCatEdit('${c.id}')" data-edit="${c.id}" style="font-size:11px;">수정</button>
        <button class="tbl-btn" onclick="saveCatEdit('${c.id}')" data-save="${c.id}" style="display:none;font-size:11px;background:#2563eb;color:#fff;border-color:#2563eb;">저장</button>
        <button class="tbl-btn tbl-btn--danger" onclick="deleteCatItem('${c.id}')" style="font-size:11px;">삭제</button>
      </div>`).join('');
  }

  function startCatEdit(id) {
    const row = document.querySelector(`[data-cat-id="${id}"]`);
    if (!row) return;
    row.querySelector('span').style.display = 'none';
    row.querySelector('.cat-edit-input').style.display = '';
    row.querySelector(`[data-edit="${id}"]`).style.display = 'none';
    row.querySelector(`[data-save="${id}"]`).style.display = '';
    row.querySelector('.cat-edit-input').focus();
  }

  async function saveCatEdit(id) {
    const row = document.querySelector(`[data-cat-id="${id}"]`);
    const newName = row.querySelector('.cat-edit-input').value.trim();
    if (!newName) { alert('카테고리명을 입력하세요.'); return; }
    const { error } = await supabaseClient.from('task_categories').update({ category_name: newName }).eq('id', id);
    if (error) { alert('저장 실패: ' + error.message); return; }
    await loadCatList();
    await loadCategories();
  }

  async function deleteCatItem(id) {
    if (!confirm('이 카테고리를 삭제하시겠습니까?')) return;
    const { error } = await supabaseClient.from('task_categories').delete().eq('id', id);
    if (error) { alert('삭제 실패: ' + error.message); return; }
    await loadCatList();
    await loadCategories();
  }

  async function addCatItem() {
    const nameEl = document.getElementById('catNewName');
    const name = nameEl.value.trim();
    if (!name) { alert('카테고리명을 입력하세요.'); return; }
    const clinicCode = document.getElementById('catClinicSel').value;
    const teamCode   = document.getElementById('catTeamSel').value;
    if (!clinicCode || !teamCode) { alert('의원과 부서를 선택하세요.'); return; }
    // category_code: 타임스탬프 기반 고유값
    const code = 'CAT_' + Date.now();
    const { error } = await supabaseClient.from('task_categories').insert({
      clinic_code: clinicCode, team_code: teamCode,
      category_code: code, category_name: name, use_yn: true, sort_order: 999,
    });
    if (error) { alert('추가 실패: ' + error.message); return; }
    nameEl.value = '';
    await loadCatList();
    await loadCategories();
  }

  function closeCatModal() {
    document.getElementById('catModal').classList.remove('is-open');
  }
  window.openCatModal    = openCatModal;
  window.closeCatModal   = closeCatModal;
  window.onCatClinicChange = onCatClinicChange;
  window.loadCatList     = loadCatList;
  window.startCatEdit    = startCatEdit;
  window.saveCatEdit     = saveCatEdit;
  window.deleteCatItem   = deleteCatItem;
  window.addCatItem      = addCatItem;


  async function loadClinics() {
    const { data } = await supabaseClient.from('clinics').select('clinic_code, clinic_name').order('clinic_name');
    clinicOptions = (data || []).map(c => ({ code: c.clinic_code, name: c.clinic_name }));
  }
  function updateClinicSelect(selectedCode) {
    const sel = document.getElementById('mtWorkClinic');
    if (!sel) return;
    const opts = clinicOptions.length ? clinicOptions : [{ code: currentUser.clinic_code, name: currentUser.clinic_name || '내 소속 의원' }];
    const def  = selectedCode || currentUser.clinic_code || (opts[0] && opts[0].code) || '';
    sel.innerHTML = opts.map(o => `<option value="${esc(o.code)}"${o.code===def?' selected':''}>${esc(o.name)}</option>`).join('');
  }

  /* ══ 달력 ════════════════════════════════════════ */
  async function loadTeamMembersCache() {
    if (_teamMembersReady || !currentUser.team_code) return;
    let q = supabaseClient.from('user_profiles_with_email').select('email, user_name').eq('active', 'Y');
    q = currentUser.team_group_code
      ? q.eq('team_group_code', currentUser.team_group_code)
      : q.eq('team_code', currentUser.team_code);
    const { data } = await q;
    _teamMemberMap = {};
    (data || []).forEach(m => { _teamMemberMap[m.email] = m.user_name; });
    _teamMembersReady = true;
  }

  const TEAM_TAG_COLORS = ['#2563eb','#7c3aed','#dc2626','#0891b2','#ca8a04','#16a34a','#db2777'];
  function tagColorFor(email) {
    let h = 0;
    for (let i = 0; i < email.length; i++) h = (h * 31 + email.charCodeAt(i)) >>> 0;
    return TEAM_TAG_COLORS[h % TEAM_TAG_COLORS.length];
  }

  async function renderCalendar() {
    // 이번 달 task 로드
    const monthStart = `${calYear}-${String(calMonth+1).padStart(2,'0')}-01`;
    const nextM = calMonth === 11 ? { y: calYear+1, m: 0 } : { y: calYear, m: calMonth+1 };
    const monthEnd = `${nextM.y}-${String(nextM.m+1).padStart(2,'0')}-01`;

    if (calViewMode === 'team') await loadTeamMembersCache();

    let taskQuery = supabaseClient.from('task_items').select('*')
      .lt('start_date', monthEnd)
      .or(`end_date.gte.${monthStart},end_date.is.null`)
      .order('start_date');
    taskQuery = (calViewMode === 'team' && currentUser.team_code)
      ? (currentUser.team_group_code
          ? taskQuery.eq('team_group_code', currentUser.team_group_code)
          : taskQuery.eq('team_code', currentUser.team_code))
      : taskQuery.eq('user_email', currentUser.email);

    const [{ data }, { data: journals }] = await Promise.all([
      taskQuery,
      supabaseClient.from('task_journals').select('*')
        .eq('user_email', currentUser.email)
        .gte('week_start', monthStart)
        .lt('week_start', monthEnd),
    ]);
    // end_date 미입력(단일일) 건도 안전하게 처리하고, 실제로 이번 달과 겹치는 건만 남김
    calTasks = (data || []).filter(t => {
      const e = t.end_date || t.start_date;
      return e >= monthStart && t.start_date < monthEnd;
    });
    _journalMap = {};
    (journals || []).forEach(j => { _journalMap[j.week_start] = j; });

    document.getElementById('calMonthLabel').textContent = `${calYear}년 ${calMonth+1}월`;
    buildCalGrid();
  }

  /* 기간형 업무 포함 — 날짜가 start_date~end_date 범위 안에 있는지 체크 */
  function isTaskOnDate(t, date) {
    const e = t.end_date || t.start_date;
    return t.start_date <= date && date <= e;
  }

  function buildCalGrid() {
    const grid = document.getElementById('calGrid');
    const today = todayStr();
    const firstDay = new Date(calYear, calMonth, 1).getDay(); // 0=일
    const lastDate = new Date(calYear, calMonth+1, 0).getDate();

    // 앞 빈칸 (이전 달) — toISOString 대신 로컬 날짜 포맷 사용 (UTC 변환 오류 방지)
    const prevLastDate = new Date(calYear, calMonth, 0).getDate();
    const cells = [];

    function localDateStr(y, m, d) {
      return `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    }

    for (let i = firstDay-1; i >= 0; i--) {
      const dd = prevLastDate - i;
      let pm = calMonth; // 0-based 이전 달
      let py = calYear;
      if (pm === 0) { pm = 12; py--; } // 1월이면 이전 해 12월
      cells.push({ date: localDateStr(py, pm, dd), otherMonth: true });
    }
    for (let d = 1; d <= lastDate; d++) {
      cells.push({ date: localDateStr(calYear, calMonth+1, d), otherMonth: false });
    }
    // 뒤 빈칸 (다음 달)
    let next = 1;
    let nm = calMonth + 2; // 1-based 다음 달
    let ny = calYear;
    if (nm > 12) { nm = 1; ny++; }
    while (cells.length % 7 !== 0) {
      cells.push({ date: localDateStr(ny, nm, next++), otherMonth: true });
    }

    grid.innerHTML = cells.map(({ date, otherMonth }) => {
      const day  = new Date(date + 'T00:00:00').getDay();
      const tasks = calTasks.filter(t => isTaskOnDate(t, date));
      const isSel = date === selectedDate;
      const isTod = date === today;

      // 요일 클래스
      const cls = ['cal-cell'];
      if (otherMonth) cls.push('other-month');
      if (day === 0)  cls.push('sun');
      if (day === 6)  cls.push('sat');
      if (isSel)      cls.push('selected');
      if (isTod)      cls.push('today');

      const dayNum = parseInt(date.slice(8));

      // 업무 칩 (최대 3개)
      const chips = tasks.slice(0,3).map(t => {
        const chipCls = ['cal-task-chip'];
        if (t.priority === 'HIGH') chipCls.push('high');
        if (t.status === 'DONE')   chipCls.push('done');
        const isRange = t.end_date && t.end_date !== t.start_date;
        const cont = isRange && date !== t.start_date;
        const isMine = t.user_email === currentUser.email;
        const ownerName = _teamMemberMap[t.user_email] || '';
        const crossClinic = currentUser.team_group_code && t.clinic_code !== currentUser.clinic_code;
        const ownerLabel = ownerName + (crossClinic && t.clinic_name ? `·${t.clinic_name}` : '');
        const tag = (calViewMode === 'team' && !isMine && ownerName)
          ? `<span style="color:${tagColorFor(t.user_email)};font-weight:700;">${esc(ownerLabel)}</span> ` : '';
        const titleAttr = `${ownerLabel?esc(ownerLabel)+' · ':''}${esc(t.title)}${isRange?` (${fmt(t.start_date)}~${fmt(t.end_date)})`:''}`;
        return `<div class="${chipCls.join(' ')}" title="${titleAttr}">${cont?'▸ ':''}${tag}${esc(t.title)}</div>`;
      }).join('');
      const more = tasks.length > 3 ? `<div class="cal-task-chip more">+${tasks.length-3}건</div>` : '';

      // 일요일 — 주간 근태 토글 (조기출근/토요근무)
      // 해당 주 journal에서 값 읽기 (calJournalMap에서)
      let attendHtml = '';
      if (day === 0 && !otherMonth) {
        const ws = date; // 일요일 = 주 시작
        const j  = _journalMap[ws];
        const earlyOn = j?.early_work_this === 'Y';
        const satOn   = j?.sat_work_this   === 'Y';
        attendHtml = `<div class="cal-attend-row" onclick="event.stopPropagation()">
          <button class="cal-attend-btn${earlyOn?' on':''}" title="조기출근"
            onclick="toggleAttend('${ws}','early_work_this',this)">조출</button>
          <button class="cal-attend-btn${satOn?' on sat':''}" title="토요근무"
            onclick="toggleAttend('${ws}','sat_work_this',this)">토요근무</button>
        </div>`;
      }

      return `<div class="${cls.join(' ')}" data-date="${date}" onclick="selectDate('${date}')">
        <div class="cal-date-num">${dayNum}</div>
        ${chips}${more}
        ${attendHtml}
      </div>`;
    }).join('');
  }

  window.selectDate = function(dateStr) {
    selectedDate = dateStr;
    buildCalGrid(); // 선택 표시 갱신
    document.getElementById('addTaskBtn').disabled = false;

    const d    = new Date(dateStr + 'T00:00:00');
    const dow  = DOW_KR[d.getDay()];
    const sun  = d.getDay() === 0 ? '#ef4444' : d.getDay() === 6 ? '#3b82f6' : '';
    document.getElementById('calDetailDate').innerHTML =
      `${dateStr.slice(0,7).replace('-','년 ')}월 ${parseInt(dateStr.slice(8))}일 ` +
      `<span style="${sun?'color:'+sun:''}">(${dow})</span>`;
    renderDetailPanel(dateStr);
  };

  async function renderDetailPanel(dateStr) {
    const body   = document.getElementById('calDetailBody');
    const tasks  = calTasks.filter(t => isTaskOnDate(t, dateStr));
    const ws     = getWeekStart(dateStr);
    const we     = getWeekEnd(ws);

    // 이번 주 일지 로드 (근태/이슈용)
    const { data: jData } = await supabaseClient.from('task_journals').select('*')
      .eq('user_email', currentUser.email).eq('week_start', ws).maybeSingle();
    calJournal = jData;

    // 날짜 기준 일~토 요일
    const d   = new Date(dateStr + 'T00:00:00');
    const dow = d.getDay();
    const isSun = dow === 0;

    // 업무 목록
    const taskHtml = tasks.length
      ? tasks.map(t => {
          const isMine = t.user_email === currentUser.email;
          const ownerName = _teamMemberMap[t.user_email] || '';
          const crossClinic = currentUser.team_group_code && t.clinic_code !== currentUser.clinic_code;
          const ownerLabel = ownerName + (crossClinic && t.clinic_name ? `·${t.clinic_name}` : '');
          const ownerTag = (calViewMode === 'team' && !isMine && ownerName)
            ? `<span style="color:${tagColorFor(t.user_email)};font-weight:700;font-size:10px;">[${esc(ownerLabel)}]</span> ` : '';
          const clickAttr = isMine ? `onclick="openTaskModal('${t.task_id}')"` : '';
          return `
        <div class="task-item-card ${t.status==='DONE'?'done':''} ${t.priority==='HIGH'?'high':''}" ${!isMine?'style="cursor:default;opacity:0.85;"':''}
             ${clickAttr}>
          <div class="task-item-title">
            <span class="task-status-badge ${t.status}">${STATUS_LABEL[t.status]||t.status}</span>
            ${t.priority==='HIGH'?'<span style="color:#dc2626;font-size:10px;">⚡</span>':''}
            ${ownerTag}${esc(t.title)}
          </div>
          <div class="task-item-meta">${CATEGORIES[t.category]||t.category||''} ${t.end_date&&t.end_date!==t.start_date?'~ '+fmt(t.end_date):''}</div>
        </div>`;
        }).join('')
      : `<div style="text-align:center;color:#9ca3af;font-size:11px;padding:12px 0;">등록된 업무가 없습니다.</div>`;

    // 이슈/건의 (일요일에만 — 주 시작)
    const issueHtml = isSun ? `
      <div class="issue-section">
        <div class="issue-title">📝 이슈 / 건의사항</div>
        <textarea id="issueText" placeholder="이슈, 건의사항 등을 입력하세요"
          onblur="saveIssue('${ws}', '${we}', this.value)">${esc(calJournal?.issues||'')}</textarea>
      </div>` : '';

    // 근태사항 (일요일에만 — 주 요약)
    const attWeekHtml = isSun ? `
      <div class="attend-section">
        <div class="attend-title">📋 근태사항</div>
        <div class="attend-text-wrap">
          <textarea id="attWeekText" placeholder="연차, 반차, 출장 등 근태 관련 내용"
            onblur="saveAttendWeek('${ws}', '${we}', this.value)">${esc(calJournal?.attendance_this_week||'')}</textarea>
        </div>
      </div>` : '';

    // 마감된 주 안내 — 수정은 가능하지만 출력물엔 반영되지 않음을 알림
    const closedBanner = calJournal?.status === 'CLOSED' ? `
      <div style="background:#fef2f2;border:1px solid #fecaca;color:#991b1b;font-size:11px;
        border-radius:6px;padding:7px 10px;display:flex;align-items:center;gap:6px;">
        <i class="ti ti-lock"></i> 이 주는 마감되었습니다. 계속 수정할 수 있지만, 마감 시점에 저장된 출력물에는 반영되지 않습니다.
      </div>` : '';

    body.innerHTML =
      `<div class="cal-detail-tasks">${closedBanner}${taskHtml}</div>` +
      (isSun ? `<div class="cal-detail-fixed">${attWeekHtml}${issueHtml}</div>` : '');
  }

  /* ── 근태 / 이슈 저장 ──────────────────────────── */
  async function ensureJournal(ws, we) {
    if (calJournal) return calJournal;
    const { data: existing } = await supabaseClient.from('task_journals').select('*')
      .eq('user_email', currentUser.email).eq('week_start', ws).maybeSingle();
    if (existing) { calJournal = existing; return existing; }
    const { data: created } = await supabaseClient.from('task_journals').insert({
      user_email: currentUser.email, week_start: ws, week_end: we, status: 'OPEN'
    }).select().single();
    calJournal = created;
    return created;
  }

  window.toggleAttend = async function(ws, field, btn) {
    const we = getWeekEnd(ws);
    // journal 없으면 생성
    if (!_journalMap[ws]) {
      const { data } = await supabaseClient.from('task_journals').insert({
        user_email: currentUser.email, week_start: ws, week_end: we, status: 'OPEN'
      }).select().single();
      if (data) _journalMap[ws] = data;
    }
    const cur = _journalMap[ws];
    const newVal = cur[field] === 'Y' ? 'N' : 'Y';
    await supabaseClient.from('task_journals').update({ [field]: newVal, updated_at: new Date().toISOString() })
      .eq('user_email', currentUser.email).eq('week_start', ws);
    _journalMap[ws][field] = newVal;
    const isSat = field === 'sat_work_this';
    btn.classList.toggle('on', newVal === 'Y');
    if (isSat) btn.classList.toggle('sat', newVal === 'Y');
    // 상세 패널도 갱신
    if (calJournal && calJournal.week_start === ws) calJournal[field] = newVal;
    if (selectedDate && getWeekStart(selectedDate) === ws) renderDetailPanel(selectedDate);
  };

  window.saveAttend = async function(field, ws, we, checked) {
    await ensureJournal(ws, we);
    const upd = { [field]: checked ? 'Y' : 'N', updated_at: new Date().toISOString() };
    await supabaseClient.from('task_journals').update(upd).eq('user_email', currentUser.email).eq('week_start', ws);
    if (calJournal) calJournal[field] = checked ? 'Y' : 'N';
    // 달력 뱃지 갱신
    buildCalGrid();
  };

  window.saveIssue = async function(ws, we, value) {
    await ensureJournal(ws, we);
    await supabaseClient.from('task_journals').update({ issues: value, updated_at: new Date().toISOString() })
      .eq('user_email', currentUser.email).eq('week_start', ws);
    if (calJournal) calJournal.issues = value;
  };

  window.saveAttendWeek = async function(ws, we, value) {
    await ensureJournal(ws, we);
    await supabaseClient.from('task_journals').update({ attendance_this_week: value, updated_at: new Date().toISOString() })
      .eq('user_email', currentUser.email).eq('week_start', ws);
    if (calJournal) calJournal.attendance_this_week = value;
  };

  /* ══ 업무 모달 ═══════════════════════════════════ */
  window.openTaskModal = async function(taskId, opts) {
    editingTaskId = taskId;
    _taskModalSource = opts?.source || null;
    document.getElementById('taskModalTitle').textContent = taskId ? '업무 수정' : '업무 추가';
    document.getElementById('deleteTaskBtn').style.display = taskId ? '' : 'none';

    updateCategorySelect();
    updateClinicSelect('');

    if (taskId) {
      const task = calTasks.find(t => t.task_id === taskId) || _searchTaskCache[taskId];
      if (task) {
        document.getElementById('mtTitle').value     = task.title || '';
        document.getElementById('mtStartDate').value = task.start_date || '';
        document.getElementById('mtEndDate').value   = task.end_date   || '';
        document.getElementById('mtDesc').value      = task.description || '';
        document.getElementById('mtCategory').value  = task.category || '';
        updateClinicSelect(task.work_clinic_code || task.clinic_code);
        setPriority(task.priority || 'MEDIUM');
        setStatus(task.status || 'TODO');
      }
    } else {
      document.getElementById('mtTitle').value     = '';
      document.getElementById('mtStartDate').value = selectedDate || todayStr();
      document.getElementById('mtEndDate').value   = '';
      document.getElementById('mtDesc').value      = '';
      document.getElementById('mtCategory').value  = '';
      updateClinicSelect('');
      setPriority('MEDIUM');
      setStatus('TODO');
    }
    document.getElementById('taskModal').classList.add('is-open');
    document.getElementById('mtTitle').focus();
  };

  window.closeTaskModal = function() {
    document.getElementById('taskModal').classList.remove('is-open');
    editingTaskId = null;
  };

  function setPriority(p) {
    modalPriority = p;
    document.querySelectorAll('.priority-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.priority === p);
    });
  }
  function setStatus(s) {
    modalStatus = s;
    document.querySelectorAll('.status-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.status === s);
    });
  }

  document.addEventListener('click', e => {
    const pb = e.target.closest('.priority-btn');
    if (pb) setPriority(pb.dataset.priority);
    const sb = e.target.closest('.status-btn');
    if (sb) setStatus(sb.dataset.status);
  });

  window.saveTask = async function() {
    const title = document.getElementById('mtTitle').value.trim();
    if (!title) { showMessage('업무 제목을 입력해 주세요.', 'warning'); return; }
    const startDate = document.getElementById('mtStartDate').value;
    if (!startDate) { showMessage('시작일을 선택해 주세요.', 'warning'); return; }

    const ws = getWeekStart(startDate);
    const sel = document.getElementById('mtWorkClinic');
    const workClinicCode = sel?.value || currentUser.clinic_code || '';
    const workClinicName = sel?.options[sel.selectedIndex]?.text || currentUser.clinic_name || '';

    const payload = {
      task_id:         editingTaskId || generateTaskId(),
      user_email:      currentUser.email,
      title,
      start_date:      startDate,
      end_date:        document.getElementById('mtEndDate').value || startDate,
      week_start:      ws,
      week_end:        getWeekEnd(ws),
      category:        document.getElementById('mtCategory').value || '',
      description:     document.getElementById('mtDesc').value || '',
      priority:        modalPriority,
      status:          modalStatus,
      clinic_code:     currentUser.clinic_code || '',
      clinic_name:     currentUser.clinic_name || '',
      team_code:       currentUser.team_code   || '',
      team_name:       currentUser.team_name   || '',
      team_group_code: currentUser.team_group_code || '',
      work_clinic_code: workClinicCode,
      work_clinic_name: workClinicName,
      updated_at:      new Date().toISOString(),
    };

    let error;
    if (editingTaskId) {
      ({ error } = await supabaseClient.from('task_items').update(payload).eq('task_id', editingTaskId));
    } else {
      ({ error } = await supabaseClient.from('task_items').insert(payload));
    }
    if (error) { showMessage('저장 실패: ' + error.message, 'error'); return; }

    showMessage('저장됐습니다.', 'success');
    closeTaskModal();
    await renderCalendar();
    if (selectedDate) renderDetailPanel(selectedDate);
    if (_taskModalSource === 'search') await runSearch();
  };

  window.deleteTask = async function() {
    if (!editingTaskId || !confirm('이 업무를 삭제하시겠습니까?')) return;
    const { error } = await supabaseClient.from('task_items').delete().eq('task_id', editingTaskId);
    if (error) { showMessage('삭제 실패: ' + error.message, 'error'); return; }
    showMessage('삭제됐습니다.', 'success');
    closeTaskModal();
    await renderCalendar();
    if (selectedDate) renderDetailPanel(selectedDate);
    if (_taskModalSource === 'search') await runSearch();
  };

  /* ══ 팀 현황 ═════════════════════════════════════ */
  let _teamJournalMap = {}; // { email: journal row } — 출력 버튼에서 스냅샷 읽기용
  let _teamMemberInfoMap = {}; // { email: { user_name, clinic_name } }
  let _teamTasksMap = {}; // { email: task[] } — 카드 클릭 시 상세 모달용
  let _teamAllClosed = false; // 현재 표시 중인 주, 팀원 전원 마감 여부

  /** 마감 시점 스냅샷(journal.content) 이후 라이브 데이터가 바뀌었는지 체크 */
  function isJournalDirty(journal, liveTasks) {
    if (!journal || journal.status !== 'CLOSED' || !journal.closed_at) return false;
    const closedAt = new Date(journal.closed_at).getTime();
    if (journal.updated_at && new Date(journal.updated_at).getTime() > closedAt + 500) return true;
    for (const t of liveTasks) {
      if (t.updated_at && new Date(t.updated_at).getTime() > closedAt + 500) return true;
    }
    let snapTaskCount = 0;
    try { snapTaskCount = (JSON.parse(journal.content || '{}').tasks || []).length; } catch (e) {}
    if (snapTaskCount !== liveTasks.length) return true;
    return false;
  }

  async function loadTeamView() {
    const we = getWeekEnd(teamWeekStart);
    document.getElementById('teamWeekLabel').textContent =
      `${teamWeekStart.slice(0,4)}년 ${fmt(teamWeekStart)} ~ ${fmt(we)}`;

    if (!currentUser.team_code) {
      document.getElementById('teamGrid').innerHTML =
        '<div style="color:#9ca3af;font-size:12px;padding:20px;">소속 부서 정보가 없습니다.</div>';
      return;
    }

    showGlobalLoading('팀 현황을 불러오는 중...');
    try {
      // 팀원 조회 — 정렬은 JS에서 처리(권한 기준)
      // team_group_code가 설정된 부서(MSO 등)는 의원이 달라도 같은 그룹으로 묶어서 조회
      let memberQuery = supabaseClient.from('user_profiles_with_email')
        .select('id, user_name, email, clinic_code, clinic_name, team_code, team_group_code, allowed_pages, role')
        .eq('active', 'Y');
      memberQuery = currentUser.team_group_code
        ? memberQuery.eq('team_group_code', currentUser.team_group_code)
        : memberQuery.eq('team_code', currentUser.team_code);
      const { data: members } = await memberQuery;

      if (!members?.length) {
        document.getElementById('teamGrid').innerHTML =
          '<div style="color:#9ca3af;font-size:12px;padding:20px;">팀원이 없습니다.</div>';
        return;
      }

      const LEVELS = ['접근불가','user','edit','manager','admin'];
      // 업무일정 페이지 권한 레벨 산출 — allowed_pages가 null이면 role 기본값으로 판단
      function getTaskLevel(m) {
        const perms = m.allowed_pages || {};
        const roleDefault = { user:'user', edit:'edit', manager:'manager', admin:'admin' };
        const lvStr = Array.isArray(perms)
          ? (perms.includes('task/task-manager') ? (m.role || 'user') : '접근불가')
          : (perms['task/task-manager'] || roleDefault[m.role] || 'user');
        return LEVELS.indexOf(lvStr);
      }

      // 정렬: manager 이상 먼저(내림차순), 같은 레벨끼리는 이름 오름차순
      members.sort(function(a, b) {
        var la = getTaskLevel(a), lb = getTaskLevel(b);
        var managerIdx = LEVELS.indexOf('manager');
        var aIsManager = la >= managerIdx, bIsManager = lb >= managerIdx;
        if (aIsManager !== bIsManager) return aIsManager ? -1 : 1;
        return (a.user_name || '').localeCompare(b.user_name || '', 'ko');
      });

      const emails = members.map(m => m.email);

      // 팀원 업무 + 일지 병렬 조회
      const [{ data: tasks }, { data: journals }] = await Promise.all([
        supabaseClient.from('task_items').select('*').in('user_email', emails)
          .gte('start_date', teamWeekStart).lte('start_date', we).order('start_date'),
        supabaseClient.from('task_journals').select('*').in('user_email', emails)
          .eq('week_start', teamWeekStart)
      ]);

      const grid = document.getElementById('teamGrid');
      _teamJournalMap = {};
      _teamMemberInfoMap = {};

      // 전원 마감 여부 — 전체 마감 전에는 개별 출력도 막음
      const allClosed = members.every(m => (journals||[]).find(j => j.user_email === m.email)?.status === 'CLOSED');
      _teamAllClosed = allClosed;
      const pdfBtnEl = document.getElementById('teamPdfBtn');
      if (pdfBtnEl) {
        pdfBtnEl.disabled = !allClosed;
        pdfBtnEl.title = allClosed ? '' : '팀원 전원이 마감된 이후에 출력할 수 있습니다.';
        pdfBtnEl.style.opacity = allClosed ? '1' : '0.45';
        pdfBtnEl.style.cursor  = allClosed ? 'pointer' : 'not-allowed';
      }

      grid.innerHTML = members.map(m => {
        const mTasks   = (tasks||[]).filter(t => t.user_email === m.email);
        const journal  = (journals||[]).find(j => j.user_email === m.email);
        const isClosed = journal?.status === 'CLOSED';
        const isDirty  = isJournalDirty(journal, mTasks);
        _teamJournalMap[m.email] = journal || null;
        _teamMemberInfoMap[m.email] = { user_name: m.user_name, clinic_name: m.clinic_name };
        _teamTasksMap[m.email] = mTasks;

        // 업무 카테고리 요약 — 건수만 (세부내용은 클릭해서 모달로 확인)
        const grouped = {};
        mTasks.forEach(t => {
          const cat = CATEGORIES[t.category] || t.category || '기타';
          grouped[cat] = (grouped[cat] || 0) + 1;
        });
        const catSummary = Object.entries(grouped)
          .map(([cat, n]) => `<span class="team-cat-chip">${esc(cat)} ${n}</span>`).join('')
          || (mTasks.length ? '' : '<span class="no-data">등록된 업무가 없습니다.</span>');

        // 근태 — 조기출근/토요근무 뱃지 + 근태사항 텍스트
        const earlyOn = journal?.early_work_this === 'Y';
        const satOn   = journal?.sat_work_this   === 'Y';
        const attendText = journal?.attendance_this_week || '';

        const attendRow = `<div class="team-attend-row">
          <span class="team-attend-badge${earlyOn?' on':''}">조기출근</span>
          <span class="team-attend-badge${satOn?' on sat':''}">토요근무</span>
        </div>`;
        const attendTextHtml = attendText
          ? `<div class="team-attend-text">${esc(attendText)}</div>`
          : `<div class="team-attend-text empty">등록된 근태사항이 없습니다.</div>`;

        const dirtyBadge = (isClosed && isDirty)
          ? `<span style="font-size:9px;color:#dc2626;font-weight:700;margin-left:5px;" title="마감 이후 업무/근태/이슈가 추가되거나 수정됐습니다. 출력물에는 마감 시점 데이터만 반영됩니다.">⚠</span>` : '';

        const manageBtn = isManager
          ? (isClosed
              ? `<button class="btn btn-sm" style="font-size:11px;height:24px;padding:0 8px;" onclick="reopenJournal('${m.email}')">마감해제</button>`
              : `<button class="btn btn-sm btn-primary" style="font-size:11px;height:24px;padding:0 8px;" onclick="closeJournal('${m.email}')">마감</button>`)
          : '';
        const footerHtml = manageBtn
          ? `<div class="team-card-footer" onclick="event.stopPropagation()">${manageBtn}</div>` : '';

        return `<div class="team-member-card" onclick="openMemberDetail('${m.email}')">
          <div class="team-card-header">
            <div>
              <div class="team-card-name">${esc(m.user_name)}</div>
              <div class="team-card-meta">${esc(m.clinic_name||'')} · ${mTasks.length}건</div>
            </div>
            <span class="journal-status ${isClosed?'closed':'open'}">${isClosed?'마감':'작성중'}</span>${dirtyBadge}
          </div>
          <div class="team-card-body">
            ${attendRow}
            ${attendTextHtml}
            ${catSummary ? `<div class="team-cat-row">${catSummary}</div>` : ''}
          </div>
          ${footerHtml}
        </div>`;
      }).join('');
    } finally {
      hideGlobalLoading();
    }
  }

  /** 한 명의 업무일지를 마감 — 스냅샷 캡처 후 저장 (confirm/메시지 없이, 재사용용 코어) */
  async function captureAndCloseJournal(email) {
    const we = getWeekEnd(teamWeekStart);
    const nowIso = new Date().toISOString();

    const [{ data: liveTasks }, { data: jRow }] = await Promise.all([
      supabaseClient.from('task_items').select('*').eq('user_email', email)
        .gte('start_date', teamWeekStart).lte('start_date', we).order('start_date'),
      supabaseClient.from('task_journals').select('*')
        .eq('user_email', email).eq('week_start', teamWeekStart).maybeSingle(),
    ]);
    const memberInfo = _teamMemberInfoMap[email] || {};

    const snapshot = {
      captured_at:    nowIso,
      user_email:     email,
      user_name:      memberInfo.user_name || '',
      clinic_name:    memberInfo.clinic_name || '',
      week_start:     teamWeekStart,
      week_end:       we,
      tasks: (liveTasks || []).map(t => ({
        category: CATEGORIES[t.category] || t.category || '기타',
        title: t.title, status: t.status, priority: t.priority,
        start_date: t.start_date, end_date: t.end_date, description: t.description || '',
      })),
      early_work_this:       jRow?.early_work_this || 'N',
      sat_work_this:         jRow?.sat_work_this   || 'N',
      attendance_this_week:  jRow?.attendance_this_week || '',
      issues:                jRow?.issues || '',
    };

    const payload = {
      status: 'CLOSED', closed_at: nowIso, closed_by: currentUser.email,
      updated_at: nowIso, content: JSON.stringify(snapshot),
    };

    if (jRow) {
      await supabaseClient.from('task_journals').update(payload).eq('id', jRow.id);
    } else {
      await supabaseClient.from('task_journals').insert({
        user_email: email, week_start: teamWeekStart, week_end: we, ...payload,
      });
    }
  }

  /** 팀원 카드 클릭 — 그 주 전체 업무/근태/이슈를 보고서 형태로 자세히 보여줌 */
  window.openMemberDetail = function(email) {
    const info    = _teamMemberInfoMap[email] || {};
    const tasks   = _teamTasksMap[email] || [];
    const journal = _teamJournalMap[email];
    const we      = getWeekEnd(teamWeekStart);

    document.getElementById('memberDetailTitle').innerHTML =
      `<i class="ti ti-user"></i> ${esc(info.user_name||'')} <span style="font-weight:400;color:#9ca3af;font-size:13px;">· ${esc(info.clinic_name||'')} · ${fmt(teamWeekStart)} ~ ${fmt(we)}</span>`;

    // 요약 통계
    const doneCnt = tasks.filter(t => t.status==='DONE').length;
    const progCnt = tasks.filter(t => t.status==='IN_PROGRESS').length;
    const todoCnt = tasks.filter(t => t.status==='TODO').length;
    const highCnt = tasks.filter(t => t.priority==='HIGH').length;

    const statHtml = `
      <div class="mdr-stats">
        <div class="mdr-stat"><div class="mdr-stat-num">${tasks.length}</div><div class="mdr-stat-lb">총 업무</div></div>
        <div class="mdr-stat"><div class="mdr-stat-num" style="color:#16a34a;">${doneCnt}</div><div class="mdr-stat-lb">완료</div></div>
        <div class="mdr-stat"><div class="mdr-stat-num" style="color:#ea580c;">${progCnt}</div><div class="mdr-stat-lb">진행중</div></div>
        <div class="mdr-stat"><div class="mdr-stat-num" style="color:#6b7280;">${todoCnt}</div><div class="mdr-stat-lb">예정</div></div>
        <div class="mdr-stat"><div class="mdr-stat-num" style="color:#dc2626;">${highCnt}</div><div class="mdr-stat-lb">긴급</div></div>
      </div>`;

    // 업무 목록 — 보고서 형태의 테이블
    const grouped = {};
    tasks.forEach(t => { (grouped[CATEGORIES[t.category]||t.category||'기타'] = grouped[CATEGORIES[t.category]||t.category||'기타'] || []).push(t); });

    const tableRows = Object.entries(grouped).map(([cat, ts]) => ts.map((t, i) => `
      <tr>
        ${i===0 ? `<td class="mdr-cat" rowspan="${ts.length}">${esc(cat)}</td>` : ''}
        <td class="mdr-title">${t.priority==='HIGH'?'<span style="color:#dc2626;">⚡</span> ':''}${esc(t.title)}${t.description?`<div class="mdr-desc">${esc(t.description)}</div>`:''}</td>
        <td class="mdr-center"><span class="task-status-badge ${t.status}">${STATUS_LABEL[t.status]||t.status}</span></td>
        <td class="mdr-center mdr-date">${t.start_date}${t.end_date&&t.end_date!==t.start_date?'<br>~ '+t.end_date:''}</td>
      </tr>`).join('')).join('');

    const taskTableHtml = tasks.length ? `
      <table class="mdr-table">
        <thead><tr><th style="width:90px;">카테고리</th><th>업무</th><th style="width:80px;">상태</th><th style="width:100px;">기간</th></tr></thead>
        <tbody>${tableRows}</tbody>
      </table>` : '<div style="text-align:center;color:#9ca3af;font-size:13px;padding:40px 0;">등록된 업무가 없습니다.</div>';

    const attendBadges = `
      <span class="team-attend-badge${journal?.early_work_this==='Y'?' on':''}">조기출근</span>
      <span class="team-attend-badge${journal?.sat_work_this==='Y'?' on sat':''}">토요근무</span>`;

    document.getElementById('memberDetailBody').innerHTML = `
      ${statHtml}
      ${taskTableHtml}
      <div class="mdr-footer-grid">
        <div class="mdr-box">
          <div class="mdr-box-title">📋 근태사항</div>
          <div style="margin-bottom:8px;display:flex;gap:6px;">${attendBadges}</div>
          <div class="mdr-box-body">${esc(journal?.attendance_this_week || '등록된 근태사항이 없습니다.')}</div>
        </div>
        <div class="mdr-box">
          <div class="mdr-box-title">📝 이슈 / 건의사항</div>
          <div class="mdr-box-body">${esc(journal?.issues || '등록된 이슈/건의사항이 없습니다.')}</div>
        </div>
      </div>`;

    document.getElementById('memberDetailModal').classList.add('is-open');
  };

  window.closeMemberDetail = function() {
    document.getElementById('memberDetailModal').classList.remove('is-open');
  };

  window.closeJournal = async function(email) {
    if (!confirm(`${email} 님의 업무일지를 마감하시겠습니까?\n현재 시점의 업무/근태/이슈가 출력물로 고정 저장됩니다.\n(마감 후에도 본인은 계속 수정할 수 있지만, 출력물에는 반영되지 않습니다.)`)) return;
    await captureAndCloseJournal(email);
    showMessage('마감됐습니다. 현재 시점 데이터가 출력물로 저장됐습니다.', 'success');
    loadTeamView();
  };

  window.bulkCloseJournals = async function() {
    const emails = Object.keys(_teamMemberInfoMap);
    if (!emails.length) { showMessage('팀원이 없습니다.', 'error'); return; }
    const pending = emails.filter(e => _teamJournalMap[e]?.status !== 'CLOSED');
    if (!pending.length) { showMessage('이미 전원 마감되어 있습니다.', 'success'); return; }
    if (!confirm(`아직 마감되지 않은 ${pending.length}명을 한꺼번에 마감하시겠습니까?\n각자의 현재 시점 데이터가 출력물로 고정 저장됩니다.`)) return;

    showGlobalLoading('일괄 마감 처리 중...');
    try {
      for (const email of pending) {
        await captureAndCloseJournal(email);
      }
      showMessage(`${pending.length}명 일괄 마감됐습니다.`, 'success');
      loadTeamView();
    } finally {
      hideGlobalLoading();
    }
  };

  window.reopenJournal = async function(email) {
    if (!confirm(`마감을 해제하시겠습니까? (이전 마감 시점 출력물은 그대로 보관됩니다)`)) return;
    await supabaseClient.from('task_journals').update({
      status: 'OPEN', closed_at: null, closed_by: null, updated_at: new Date().toISOString()
    }).eq('user_email', email).eq('week_start', teamWeekStart);
    showMessage('마감이 해제됐습니다.', 'success');
    loadTeamView();
  };

  /** 마감 시점 스냅샷 읽기 (없으면 null) */
  function getJournalSnapshot(email) {
    const journal = _teamJournalMap[email];
    if (!journal?.content) return null;
    try { return JSON.parse(journal.content); } catch (e) { return null; }
  }

  window.printJournalOutput = function(email) {
    if (!_teamAllClosed) { showMessage('팀원 전원이 마감된 이후에 출력할 수 있습니다.', 'error'); return; }
    const snap = getJournalSnapshot(email);
    if (!snap) { showMessage('출력할 마감 데이터가 없습니다.', 'error'); return; }

    const grouped = {};
    snap.tasks.forEach(t => { (grouped[t.category] = grouped[t.category] || []).push(t); });
    const taskRows = Object.entries(grouped).map(([cat, ts]) => `
      <tr><td colspan="3" style="background:#f3f4f6;font-weight:700;padding:6px 8px;font-size:12px;">${esc(cat)}</td></tr>
      ${ts.map(t => `
        <tr>
          <td style="padding:5px 8px;font-size:12px;">${esc(t.title)}${t.priority==='HIGH'?' ⚡':''}</td>
          <td style="padding:5px 8px;font-size:11px;color:#6b7280;text-align:center;">${STATUS_LABEL[t.status]||t.status}</td>
          <td style="padding:5px 8px;font-size:11px;color:#6b7280;text-align:center;">${esc(t.start_date)}${t.end_date&&t.end_date!==t.start_date?' ~ '+esc(t.end_date):''}</td>
        </tr>`).join('')}
    `).join('') || '<tr><td colspan="3" style="padding:10px;text-align:center;color:#9ca3af;">등록된 업무가 없습니다.</td></tr>';

    const attendInfo = [
      snap.early_work_this==='Y' ? '조기출근' : '',
      snap.sat_work_this==='Y'   ? '토요근무' : '',
      snap.attendance_this_week  || '',
    ].filter(Boolean).join(' | ') || '-';

    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>업무일지 - ${esc(snap.user_name)}</title>
    <style>
      body{font-family:'맑은 고딕',sans-serif;padding:24px;color:#111827;}
      h1{font-size:18px;margin:0 0 4px;} .meta{font-size:12px;color:#6b7280;margin-bottom:16px;}
      table{width:100%;border-collapse:collapse;margin-bottom:16px;}
      td{border:1px solid #e5e7eb;}
      .section-title{font-size:13px;font-weight:700;margin:16px 0 6px;}
      .box{border:1px solid #e5e7eb;border-radius:6px;padding:10px;font-size:12px;white-space:pre-wrap;}
      @media print { .no-print{display:none;} }
    </style></head><body>
      <h1>업무일지 (마감)</h1>
      <div class="meta">${esc(snap.user_name)} · ${esc(snap.clinic_name||'')} &nbsp;|&nbsp; ${esc(snap.week_start)} ~ ${esc(snap.week_end)} &nbsp;|&nbsp; 마감시각: ${new Date(snap.captured_at).toLocaleString('ko-KR')}</div>
      <table>${taskRows}</table>
      <div class="section-title">근태사항</div>
      <div class="box">${esc(attendInfo)}</div>
      <div class="section-title">이슈 / 건의사항</div>
      <div class="box">${esc(snap.issues || '-')}</div>
      <div class="no-print" style="margin-top:20px;">
        <button onclick="window.print()" style="padding:8px 16px;cursor:pointer;">인쇄</button>
      </div>
    </body></html>`;

    const win = window.open('', '_blank');
    win.document.write(html);
    win.document.close();
  };

  /** 마감 스냅샷이 있으면 그걸, 없으면 현재 라이브 데이터를 같은 모양으로 반환 (엑셀은 상시 출력 가능) */
  function getJournalExportData(email) {
    const snap = getJournalSnapshot(email);
    if (snap) return { data: snap, isSnapshot: true };

    const journal = _teamJournalMap[email];
    const liveTasks = _teamTasksMap[email] || [];
    const info = _teamMemberInfoMap[email] || {};
    return {
      isSnapshot: false,
      data: {
        captured_at: new Date().toISOString(),
        user_name: info.user_name || '',
        clinic_name: info.clinic_name || '',
        week_start: teamWeekStart,
        week_end: getWeekEnd(teamWeekStart),
        tasks: liveTasks.map(t => ({
          category: CATEGORIES[t.category] || t.category || '기타',
          title: t.title, status: t.status, priority: t.priority,
          start_date: t.start_date, end_date: t.end_date, description: t.description || '',
        })),
        early_work_this: journal?.early_work_this || 'N',
        sat_work_this: journal?.sat_work_this || 'N',
        attendance_this_week: journal?.attendance_this_week || '',
        issues: journal?.issues || '',
      },
    };
  }

  window.exportJournalExcel = function(email) {
    if (!window.XLSX) { showMessage('엑셀 라이브러리를 불러오지 못했습니다.', 'error'); return; }
    const { data: snap, isSnapshot } = getJournalExportData(email);

    const attendInfo = [
      snap.early_work_this==='Y' ? '조기출근' : '',
      snap.sat_work_this==='Y'   ? '토요근무' : '',
      snap.attendance_this_week  || '',
    ].filter(Boolean).join(' | ') || '-';

    const rows = [
      [isSnapshot ? '업무일지 (마감)' : '업무일지 (작성중 — 마감 전 임시 출력)'],
      [`${snap.user_name} · ${snap.clinic_name||''}`, `${snap.week_start} ~ ${snap.week_end}`,
        isSnapshot ? `마감: ${new Date(snap.captured_at).toLocaleString('ko-KR')}` : `출력: ${new Date(snap.captured_at).toLocaleString('ko-KR')}`],
      [],
      ['카테고리', '업무', '상태', '기간'],
      ...snap.tasks.map(t => [t.category, t.title + (t.priority==='HIGH'?' (긴급)':''), STATUS_LABEL[t.status]||t.status, t.end_date&&t.end_date!==t.start_date?`${t.start_date}~${t.end_date}`:t.start_date]),
      [],
      ['근태사항', attendInfo],
      ['이슈/건의사항', snap.issues || '-'],
    ];

    const ws = window.XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{wch:14},{wch:32},{wch:10},{wch:18}];
    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, ws, '업무일지');
    window.XLSX.writeFile(wb, `업무일지_${snap.user_name}_${snap.week_start}.xlsx`);
  };

  async function runSearch() {
    const keyword = document.getElementById('searchKeyword').value.trim();
    const from    = document.getElementById('searchFrom').value;
    const to      = document.getElementById('searchTo').value;
    const status  = document.getElementById('searchStatus').value;
    const scope   = document.getElementById('searchScope').value; // 'both' | 'title' | 'desc'

    let q = supabaseClient.from('task_items').select('*').eq('user_email', currentUser.email);
    if (from)    q = q.gte('start_date', from);
    if (to)      q = q.lte('start_date', to);
    if (status)  q = q.eq('status', status);
    if (keyword) {
      if (scope === 'title')      q = q.ilike('title', `%${keyword}%`);
      else if (scope === 'desc')  q = q.ilike('description', `%${keyword}%`);
      else                        q = q.or(`title.ilike.%${keyword}%,description.ilike.%${keyword}%`);
    }
    q = q.order('start_date', { ascending: false }).limit(200);

    showGlobalLoading('검색 중...');
    let data, error;
    try {
      ({ data, error } = await q);
    } finally {
      hideGlobalLoading();
    }
    if (error) { showMessage('검색 실패: ' + error.message, 'error'); return; }

    const rows = data || [];
    _searchTaskCache = {};
    rows.forEach(t => { _searchTaskCache[t.task_id] = t; });

    const colDefs = [
      { headerName: '시작일', field: 'start_date', width: 100, flex: 0 },
      { headerName: '종료일', width: 100, flex: 0,
        valueGetter: p => p.data.end_date && p.data.end_date !== p.data.start_date ? p.data.end_date : '' },
      { headerName: '상태', field: 'status', width: 80, flex: 0,
        valueFormatter: p => STATUS_LABEL[p.value] || p.value },
      { headerName: '카테고리', field: 'category', flex: 1, minWidth: 90,
        valueFormatter: p => CATEGORIES[p.value] || p.value || '' },
      { headerName: '제목', field: 'title', flex: 2, minWidth: 160,
        cellStyle: { justifyContent: 'flex-start', textAlign: 'left' },
        valueFormatter: p => (p.data.priority === 'HIGH' ? '⚡ ' : '') + p.value },
      { headerName: '내용', field: 'description', flex: 3, minWidth: 200,
        cellStyle: { justifyContent: 'flex-start', textAlign: 'left' },
        valueFormatter: p => {
          const v = (p.value || '').replace(/\n/g, ' ');
          return v.length > 60 ? v.slice(0, 60) + '...' : v;
        } },
    ];

    if (!_searchGridApi) {
      _searchGridApi = createMgGrid('searchGrid', colDefs, rows, {
        pageSize: 20, fit: true, noRowsText: '검색 결과가 없습니다.',
        onRowClick: row => openTaskModal(row.task_id, { source: 'search' }),
      });
    } else {
      updateMgGrid(_searchGridApi, rows);
    }
  }

  window.jumpToDate = function(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    calYear  = d.getFullYear();
    calMonth = d.getMonth();
    switchTab('calendar');
    renderCalendar().then(() => selectDate(dateStr));
  };

  /* ══ 엑셀 출력 (기존 로직 이식) ══════════════════ */
  /** 엑셀/PDF 공통 — 팀원·업무·일지를 의원별/카테고리별로 묶어서 반환 */
  async function buildTeamReportData() {
    const we = getWeekEnd(teamWeekStart);
    const nextWS = offsetWeek(teamWeekStart, 1);
    const nextWE = getWeekEnd(nextWS);

    let exMemberQuery = supabaseClient.from('user_profiles_with_email')
      .select('id, user_name, email, clinic_code, clinic_name, team_code, team_group_code')
      .eq('active', 'Y').order('user_name');
    exMemberQuery = currentUser.team_group_code
      ? exMemberQuery.eq('team_group_code', currentUser.team_group_code)
      : exMemberQuery.eq('team_code', currentUser.team_code);
    const { data: members } = await exMemberQuery;
    if (!members?.length) return null;

    const emails = members.map(m => m.email);

    const [{ data: tasks }, { data: nextTasks }, { data: journals }, { data: nextJournals }] = await Promise.all([
      supabaseClient.from('task_items').select('*').in('user_email', emails).gte('start_date', teamWeekStart).lte('start_date', we),
      supabaseClient.from('task_items').select('*').in('user_email', emails).gte('start_date', nextWS).lte('start_date', nextWE),
      supabaseClient.from('task_journals').select('*').in('user_email', emails).eq('week_start', teamWeekStart),
      supabaseClient.from('task_journals').select('*').in('user_email', emails).eq('week_start', nextWS),
    ]);

    if (!Object.keys(CATEGORIES).length) await loadCategories();

    const taskClinicMap   = {};
    const memberClinicMap = {};

    members.forEach(m => {
      const mc = m.clinic_name || '기타';
      if (!memberClinicMap[mc]) memberClinicMap[mc] = [];
      memberClinicMap[mc].push({
        ...m,
        journal:      (journals||[]).find(j => j.user_email === m.email) || null,
        next_journal: (nextJournals||[]).find(j => j.user_email === m.email) || null,
      });
      [...(tasks||[]), ...(nextTasks||[])].filter(t => t.user_email === m.email).forEach(t => {
        const tc = t.work_clinic_name || t.clinic_name || m.clinic_name || '기타';
        if (!taskClinicMap[tc]) taskClinicMap[tc] = [];
        if (!taskClinicMap[tc].find(x => x.task_id === t.task_id)) taskClinicMap[tc].push(t);
      });
    });

    const clinicSet = new Set([...Object.keys(taskClinicMap), ...Object.keys(memberClinicMap)]);
    const clinics   = Array.from(clinicSet).sort();
    const cats      = Object.entries(CATEGORIES);

    const DOW = ['일','월','화','수','목','금','토'];
    const ST  = { TODO:'예정', IN_PROGRESS:'진행중', DONE:'완료' };

    function buildTaskText(taskList, catCode, isHigh, isNext) {
      if (!taskList?.length) return '';
      const ws = isNext ? nextWS : teamWeekStart;
      const we2 = isNext ? nextWE : getWeekEnd(teamWeekStart);
      const filtered = taskList.filter(t => {
        const s = t.start_date||'', e = t.end_date||s;
        if (e < ws || s > we2) return false;
        if (catCode && t.category !== catCode) return false;
        const high = t.priority === 'HIGH';
        if (isHigh === true && !high) return false;
        if (isHigh === false && high) return false;
        return true;
      });
      if (!filtered.length) return '';
      const lines = [];
      filtered.sort((a,b) => (a.start_date||'').localeCompare(b.start_date||''));
      filtered.forEach(t => {
        const d = new Date((t.start_date||'')+'T00:00:00');
        const dow = isNaN(d.getTime())? '' : DOW[d.getDay()];
        const mm = (t.start_date||'').slice(5,7), dd = (t.start_date||'').slice(8,10);
        lines.push(`  ${mm}/${dd} (${dow})`);
        lines.push(`  • ${t.title||''}${t.priority==='HIGH'?' *':''} [${ST[t.status]||''}]`);
        if (t.description?.trim()) t.description.trim().split('\n').forEach(l => { if(l.trim()) lines.push('    '+l.trim()); });
      });
      return lines.join('\n');
    }

    return { we, nextWS, nextWE, members, taskClinicMap, memberClinicMap, clinics, cats, buildTaskText };
  }

  async function exportExcel() {
    if (!window.XLSX) { showMessage('엑셀 라이브러리를 불러오지 못했습니다.', 'error'); return; }
    const btn = document.getElementById('exportExcelBtn');
    try {
      if (btn) { btn.disabled = true; btn.textContent = '처리 중...'; }
      showGlobalLoading('데이터를 불러오는 중...');

      const rd = await buildTeamReportData();
      if (!rd) { showMessage('팀원이 없습니다.', 'error'); return; }
      const { we, taskClinicMap, memberClinicMap, clinics, cats, buildTaskText } = rd;

      // 스타일 정의
      const FB   = { name:'맑은 고딕', sz:10 };
      const FT   = { name:'맑은 고딕', sz:14, bold:true, color:{rgb:'FFFFFF'} };
      const FH   = { name:'맑은 고딕', sz:10, bold:true, color:{rgb:'1F3864'} };
      const FBLD = { name:'맑은 고딕', sz:10, bold:true };
      const FLT  = { patternType:'solid', fgColor:{rgb:'1F3864'} };
      const FLH  = { patternType:'solid', fgColor:{rgb:'B8CCE4'} };
      const FLW  = { patternType:'solid', fgColor:{rgb:'D6E4F7'} };
      const FLB  = { patternType:'solid', fgColor:{rgb:'FFFFFF'} };
      const BD   = { top:{style:'thin',color:{rgb:'BFBFBF'}}, bottom:{style:'thin',color:{rgb:'BFBFBF'}}, left:{style:'thin',color:{rgb:'BFBFBF'}}, right:{style:'thin',color:{rgb:'BFBFBF'}} };
      const BDM  = { top:{style:'medium',color:{rgb:'2E75B6'}}, bottom:{style:'medium',color:{rgb:'2E75B6'}}, left:{style:'medium',color:{rgb:'2E75B6'}}, right:{style:'medium',color:{rgb:'2E75B6'}} };
      const BDS  = { top:{style:'medium',color:{rgb:'8EA9C8'}}, bottom:{style:'thin',color:{rgb:'BFBFBF'}}, left:{style:'thin',color:{rgb:'BFBFBF'}}, right:{style:'thin',color:{rgb:'BFBFBF'}} };
      const BDI  = { top:{style:'hair',color:{rgb:'DEDEDE'}}, bottom:{style:'thin',color:{rgb:'BFBFBF'}}, left:{style:'thin',color:{rgb:'BFBFBF'}}, right:{style:'thin',color:{rgb:'BFBFBF'}} };
      const ALC  = { horizontal:'center', vertical:'center', wrapText:true };
      const ALL  = { horizontal:'left',   vertical:'top',    wrapText:true };

      const ws2 = {}, wb = window.XLSX.utils.book_new();
      const TC   = 2 + clinics.length;
      let r = 0;

      const rowMaxLines = {}; // 행별 최대 줄 수 — 행 높이를 내용에 맞게 늘리기 위함
      const sc = (row, col, val, s) => {
        ws2[window.XLSX.utils.encode_cell({r:row,c:col})] = { v:val??'', t:'s', s };
        if (typeof val === 'string' && val) {
          // 줄바꿈 수 + 컬럼폭(약 60자) 기준 자동줄바꿈 예상치를 더해 줄 수 추정
          const lines = val.split('\n').reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / 60)), 0);
          rowMaxLines[row] = Math.max(rowMaxLines[row] || 1, lines);
        }
      };
      const mg = (rs,re,cs,ce) => {
        if (!ws2['!merges']) ws2['!merges'] = [];
        ws2['!merges'].push({ s:{r:rs,c:cs}, e:{r:re,c:ce} });
      };

      sc(r,0,'주간 업무보고',{font:FT,fill:FLT,alignment:ALC,border:BDM});
      for(let c=1;c<TC;c++) sc(r,c,'',{font:FT,fill:FLT,alignment:ALC,border:BDM});
      mg(r,r,0,TC-1); r++;

      const period = `${teamWeekStart.slice(0,4)}년  ${fmt(teamWeekStart)} ~ ${fmt(we)}`;
      sc(r,0,period,{font:FBLD,fill:FLW,alignment:ALC,border:BD});
      for(let c=1;c<TC;c++) sc(r,c,'',{font:FBLD,fill:FLW,alignment:ALC,border:BD});
      mg(r,r,0,TC-1); r++;

      sc(r,0,'구  분',{font:FH,fill:FLH,alignment:ALC,border:BD});
      sc(r,1,'',     {font:FH,fill:FLH,alignment:ALC,border:BD});
      clinics.forEach((cl,i) => sc(r,2+i,cl,{font:FH,fill:FLH,alignment:ALC,border:BD}));
      mg(r,r,0,1); r++;

      // 주요이슈(HIGH)
      const hs = r;
      [false,true].forEach((isNext,fi) => {
        const lb = fi===0?'금주':'차주';
        const bd = fi===0?BDS:BDI;
        sc(r,0,fi===0?'주요이슈':'',{font:FBLD,fill:FLB,alignment:ALC,border:bd});
        sc(r,1,lb,{font:FBLD,fill:FLB,alignment:ALC,border:bd});
        clinics.forEach((cl,i) => {
          const txt = buildTaskText(taskClinicMap[cl]||[], null, true, isNext);
          sc(r,2+i,txt,{font:FB,fill:FLB,alignment:ALL,border:bd});
        });
        r++;
      });
      mg(hs,hs+1,0,0);

      // 카테고리별
      cats.forEach(([ck,cn]) => {
        const cs2 = r;
        [false,true].forEach((isNext,fi) => {
          const lb = fi===0?'금주':'차주';
          const bd = fi===0?BDS:BDI;
          sc(r,0,fi===0?cn:'',{font:FBLD,fill:FLB,alignment:ALC,border:bd});
          sc(r,1,lb,{font:FBLD,fill:FLB,alignment:ALC,border:bd});
          clinics.forEach((cl,i) => {
            const txt = buildTaskText(taskClinicMap[cl]||[], ck, false, isNext);
            sc(r,2+i,txt,{font:FB,fill:FLB,alignment:ALL,border:bd});
          });
          r++;
        });
        mg(cs2,cs2+1,0,0);
      });

      // 조출/토요근무
      const es = r;
      [{ label:'이번주', isNext:false }, { label:'다음주', isNext:true }].forEach(({ label, isNext }, idx) => {
        const bd = idx===0?BDS:BDI;
        sc(r,0,idx===0?'조출/토요근무':'',{font:FBLD,fill:FLB,alignment:ALC,border:bd});
        sc(r,1,label,{font:FBLD,fill:FLB,alignment:ALC,border:bd});
        clinics.forEach((cl,i) => {
          const mems = memberClinicMap[cl]||[];
          const earlyNames = mems.filter(m => {
            const j = isNext ? m.next_journal : m.journal;
            return j && j.early_work_this === 'Y';
          }).map(m => m.user_name);
          const satNames = mems.filter(m => {
            const j = isNext ? m.next_journal : m.journal;
            return j && j.sat_work_this === 'Y';
          }).map(m => m.user_name);
          const lines = [];
          if (earlyNames.length) lines.push('[조출] : ' + earlyNames.join(', '));
          if (satNames.length)   lines.push('[토요근무] : ' + satNames.join(', '));
          sc(r,2+i,lines.length?lines.join('\n'):'-',{font:FB,fill:FLB,alignment:ALL,border:bd});
        });
        r++;
      });
      mg(es,es+1,0,0);

      // 근태
      const as = r;
      ['금주','차주'].forEach((lb,fi) => {
        const bd = fi===0?BDS:BDI;
        sc(r,0,fi===0?'근태':'',{font:FBLD,fill:FLB,alignment:ALC,border:bd});
        sc(r,1,lb,{font:FBLD,fill:FLB,alignment:ALC,border:bd});
        clinics.forEach((cl,i) => {
          const lines = [];
          (memberClinicMap[cl]||[]).forEach(m => {
            const j = fi===0 ? m.journal : m.next_journal;
            if (!j) return;
            const val = fi===0 ? j.attendance_this_week : (m.next_journal?.attendance_this_week || j.attendance_next_week || '');
            if (val) { lines.push('• '+m.user_name); val.split('\n').forEach(v => lines.push('  '+v)); }
          });
          sc(r,2+i,lines.join('\n'),{font:FB,fill:FLB,alignment:ALL,border:bd});
        });
        r++;
      });
      mg(as,as+1,0,0);

      // 이슈/건의
      sc(r,0,'이슈/건의',{font:FBLD,fill:FLB,alignment:ALC,border:BD});
      sc(r,1,'',{font:FBLD,fill:FLB,alignment:ALC,border:BD});
      mg(r,r,0,1);
      clinics.forEach((cl,i) => {
        const lines = (memberClinicMap[cl]||[]).filter(m => m.journal?.issues).map(m => m.journal.issues);
        sc(r,2+i,lines.join('\n'),{font:FB,fill:FLB,alignment:ALL,border:BD});
      });
      r++;

      ws2['!ref']  = window.XLSX.utils.encode_range({r:0,c:0},{r:r-1,c:TC-1});
      ws2['!cols'] = [{wch:16},{wch:11},...clinics.map(()=>({wch:65}))];
      ws2['!rows'] = Array(r).fill(null).map((_,i) => {
        if (i < 3) return { hpt: 20 };
        const lines = rowMaxLines[i] || 1;
        return { hpt: Math.max(60, lines * 15 + 12) };
      });

      window.XLSX.utils.book_append_sheet(wb, ws2, '주간업무보고');
      const ds = teamWeekStart.replace(/-/g,'');
      window.XLSX.writeFile(wb, `주간업무보고_${ds}.xlsx`);
      showMessage('엑셀 다운로드 완료', 'success');

    } catch(err) {
      showMessage(err.message || '오류가 발생했습니다.', 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '⬇ 엑셀 출력'; }
      hideGlobalLoading();
    }
  }

  /* ── 유틸 ─────────────────────────────────────── */
  /** 전체 팀 주간업무보고 PDF/인쇄 — 엑셀과 동일한 의원x항목 매트릭스를 인쇄용 HTML로 출력. 전원 마감 후에만 허용 */
  async function printTeamReport() {
    if (!_teamAllClosed) { showMessage('팀원 전원이 마감된 이후에 출력할 수 있습니다.', 'error'); return; }
    showGlobalLoading('데이터를 불러오는 중...');
    try {
      const rd = await buildTeamReportData();
      if (!rd) { showMessage('팀원이 없습니다.', 'error'); return; }
      const { we, taskClinicMap, memberClinicMap, clinics, cats, buildTaskText } = rd;

      const nl2br = s => esc(s).replace(/\n/g, '<br>');

      const rowsHtml = [];
      const addRow = (label, items) => {
        rowsHtml.push(`<tr>
          <td class="lb" rowspan="1">${esc(label)}</td>
          ${clinics.map((cl,i) => `<td>${items[i] || '-'}</td>`).join('')}
        </tr>`);
      };
      const addRowPair = (label, getTxt) => {
        rowsHtml.push(`<tr>
          <td class="lb" rowspan="2">${esc(label)}</td>
          <td class="sub">금주</td>
          ${clinics.map(cl => `<td>${nl2br(getTxt(cl,false)) || '-'}</td>`).join('')}
        </tr>
        <tr>
          <td class="sub">차주</td>
          ${clinics.map(cl => `<td>${nl2br(getTxt(cl,true)) || '-'}</td>`).join('')}
        </tr>`);
      };

      addRowPair('주요이슈', (cl,isNext) => buildTaskText(taskClinicMap[cl]||[], null, true, isNext));
      cats.forEach(([ck,cn]) => addRowPair(cn, (cl,isNext) => buildTaskText(taskClinicMap[cl]||[], ck, false, isNext)));

      // 조출/토요근무
      rowsHtml.push(`<tr>
        <td class="lb" rowspan="2">조출/토요근무</td>
        <td class="sub">이번주</td>
        ${clinics.map(cl => {
          const mems = memberClinicMap[cl]||[];
          const early = mems.filter(m => m.journal?.early_work_this==='Y').map(m=>m.user_name);
          const sat   = mems.filter(m => m.journal?.sat_work_this==='Y').map(m=>m.user_name);
          const lines = [early.length?'[조출] '+early.join(', '):'', sat.length?'[토요근무] '+sat.join(', '):''].filter(Boolean);
          return `<td>${lines.length?nl2br(lines.join('\n')):'-'}</td>`;
        }).join('')}
      </tr>
      <tr>
        <td class="sub">다음주</td>
        ${clinics.map(cl => {
          const mems = memberClinicMap[cl]||[];
          const early = mems.filter(m => m.next_journal?.early_work_this==='Y').map(m=>m.user_name);
          const sat   = mems.filter(m => m.next_journal?.sat_work_this==='Y').map(m=>m.user_name);
          const lines = [early.length?'[조출] '+early.join(', '):'', sat.length?'[토요근무] '+sat.join(', '):''].filter(Boolean);
          return `<td>${lines.length?nl2br(lines.join('\n')):'-'}</td>`;
        }).join('')}
      </tr>`);

      // 근태
      rowsHtml.push(`<tr>
        <td class="lb" rowspan="2">근태</td>
        <td class="sub">금주</td>
        ${clinics.map(cl => {
          const lines = [];
          (memberClinicMap[cl]||[]).forEach(m => {
            if (m.journal?.attendance_this_week) { lines.push('• '+m.user_name); m.journal.attendance_this_week.split('\n').forEach(v=>lines.push('  '+v)); }
          });
          return `<td>${lines.length?nl2br(lines.join('\n')):'-'}</td>`;
        }).join('')}
      </tr>
      <tr>
        <td class="sub">차주</td>
        ${clinics.map(cl => {
          const lines = [];
          (memberClinicMap[cl]||[]).forEach(m => {
            const val = m.next_journal?.attendance_this_week || m.journal?.attendance_next_week || '';
            if (val) { lines.push('• '+m.user_name); val.split('\n').forEach(v=>lines.push('  '+v)); }
          });
          return `<td>${lines.length?nl2br(lines.join('\n')):'-'}</td>`;
        }).join('')}
      </tr>`);

      // 이슈/건의
      addRow('이슈/건의', clinics.map(cl => {
        const lines = (memberClinicMap[cl]||[]).filter(m => m.journal?.issues).map(m => `• ${m.user_name}: ${m.journal.issues}`);
        return lines.length ? nl2br(lines.join('\n')) : '-';
      }));

      const period = `${teamWeekStart.slice(0,4)}년 ${fmt(teamWeekStart)} ~ ${fmt(we)}`;
      const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>주간 업무보고 - ${esc(period)}</title>
      <style>
        body{font-family:'맑은 고딕',sans-serif;padding:24px;color:#111827;}
        h1{font-size:18px;margin:0 0 4px;text-align:center;}
        .period{font-size:13px;color:#6b7280;text-align:center;margin-bottom:18px;}
        table{width:100%;border-collapse:collapse;table-layout:fixed;}
        th,td{border:1px solid #d1d5db;padding:6px 8px;font-size:11px;vertical-align:top;word-break:break-word;}
        th{background:#1f3864;color:#fff;text-align:center;font-size:12px;}
        td.lb{background:#dbe6f5;font-weight:700;text-align:center;vertical-align:middle;width:80px;}
        td.sub{background:#f3f6fb;font-weight:600;text-align:center;vertical-align:middle;width:46px;}
        @media print { .no-print{display:none;} @page{size:landscape;margin:12mm;} }
      </style></head><body>
        <h1>주간 업무보고</h1>
        <div class="period">${esc(period)}</div>
        <table>
          <thead><tr><th colspan="2">구분</th>${clinics.map(cl=>`<th>${esc(cl)}</th>`).join('')}</tr></thead>
          <tbody>${rowsHtml.join('')}</tbody>
        </table>
        <div class="no-print" style="margin-top:20px;text-align:center;">
          <button onclick="window.print()" style="padding:8px 16px;cursor:pointer;">인쇄 / PDF로 저장</button>
        </div>
      </body></html>`;

      const win = window.open('', '_blank');
      win.document.write(html);
      win.document.close();
    } finally {
      hideGlobalLoading();
    }
  }


  /* ── 유틸 ─────────────────────────────────────── */
  function esc(v) {
    return String(v||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

})();
