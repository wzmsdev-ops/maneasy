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

  // 팀 현황
  let teamWeekStart = '';

  // 카테고리 / 의원
  let CATEGORIES    = {};  // { code: name }
  let clinicOptions = [];  // [{ code, name }]

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
    document.getElementById('calPrevBtn').addEventListener('click', () => { calMonth--; if(calMonth<0){calMonth=11;calYear--;} renderCalendar(); });
    document.getElementById('calNextBtn').addEventListener('click', () => { calMonth++; if(calMonth>11){calMonth=0;calYear++;} renderCalendar(); });
    document.getElementById('calTodayBtn').addEventListener('click', () => { const n=new Date(); calYear=n.getFullYear(); calMonth=n.getMonth(); renderCalendar(); });
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
    if (isManager) document.getElementById('exportExcelBtn').style.display = '';

    // 검색 기본 날짜
    const fromEl = document.getElementById('searchFrom');
    const toEl   = document.getElementById('searchTo');
    if (fromEl) { const d = new Date(); d.setMonth(d.getMonth()-1); fromEl.value = d.toISOString().slice(0,10); }
    if (toEl)   toEl.value = todayStr();

    // 팀 현황 초기 주차
    teamWeekStart = getWeekStart(todayStr());

    await Promise.all([loadCategories(), loadClinics()]);
    renderCalendar();
  });

  /* ── 탭 전환 ───────────────────────────────────── */
  function switchTab(tab) {
    document.querySelectorAll('.task-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    document.querySelectorAll('.task-panel').forEach(p => p.classList.toggle('active', p.id === 'panel' + cap(tab)));
    if (tab === 'team') loadTeamView();
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
    const { data } = await supabaseClient.from('task_categories').select('*').eq('use_yn', true).order('category_name');
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
  async function renderCalendar() {
    // 이번 달 task 로드
    const monthStart = `${calYear}-${String(calMonth+1).padStart(2,'0')}-01`;
    const nextM = calMonth === 11 ? { y: calYear+1, m: 0 } : { y: calYear, m: calMonth+1 };
    const monthEnd = `${nextM.y}-${String(nextM.m+1).padStart(2,'0')}-01`;

    const [{ data }, { data: journals }] = await Promise.all([
      supabaseClient.from('task_items').select('*')
        .eq('user_email', currentUser.email)
        .gte('start_date', monthStart)
        .lt('start_date', monthEnd)
        .order('start_date'),
      supabaseClient.from('task_journals').select('*')
        .eq('user_email', currentUser.email)
        .gte('week_start', monthStart)
        .lt('week_start', monthEnd),
    ]);
    calTasks = data || [];
    _journalMap = {};
    (journals || []).forEach(j => { _journalMap[j.week_start] = j; });

    document.getElementById('calMonthLabel').textContent = `${calYear}년 ${calMonth+1}월`;
    buildCalGrid();
  }

  function buildCalGrid() {
    const grid = document.getElementById('calGrid');
    const today = todayStr();
    const firstDay = new Date(calYear, calMonth, 1).getDay(); // 0=일
    const lastDate = new Date(calYear, calMonth+1, 0).getDate();

    // 앞 빈칸 (이전 달)
    const prevLastDate = new Date(calYear, calMonth, 0).getDate();
    const cells = [];

    for (let i = firstDay-1; i >= 0; i--) {
      const d = new Date(calYear, calMonth-1, prevLastDate-i);
      cells.push({ date: d.toISOString().slice(0,10), otherMonth: true });
    }
    for (let d = 1; d <= lastDate; d++) {
      cells.push({ date: `${calYear}-${String(calMonth+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`, otherMonth: false });
    }
    // 뒤 빈칸 (다음 달)
    let next = 1;
    while (cells.length % 7 !== 0) {
      const d = new Date(calYear, calMonth+1, next++);
      cells.push({ date: d.toISOString().slice(0,10), otherMonth: true });
    }

    grid.innerHTML = cells.map(({ date, otherMonth }) => {
      const day  = new Date(date + 'T00:00:00').getDay();
      const tasks = calTasks.filter(t => t.start_date === date);
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
        return `<div class="${chipCls.join(' ')}" title="${esc(t.title)}">${esc(t.title)}</div>`;
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
    const tasks  = calTasks.filter(t => t.start_date === dateStr);
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
    const isSat = dow === 6;
    const isThisWeekSun = isSun;
    const isNextWeekSun = false;

    const jKey      = isSat ? 'sat_work_this' : 'early_work_this';
    const jKeyNext  = isSat ? 'sat_work_next'  : 'early_work_next';
    const isChecked = calJournal ? calJournal[jKey] === 'Y' : false;

    // 업무 목록
    const taskHtml = tasks.length
      ? tasks.map(t => `
        <div class="task-item-card ${t.status==='DONE'?'done':''} ${t.priority==='HIGH'?'high':''}"
             onclick="openTaskModal('${t.task_id}')">
          <div class="task-item-title">
            <span class="task-status-badge ${t.status}">${STATUS_LABEL[t.status]||t.status}</span>
            ${t.priority==='HIGH'?'<span style="color:#dc2626;font-size:10px;">⚡</span>':''}
            ${esc(t.title)}
          </div>
          <div class="task-item-meta">${CATEGORIES[t.category]||t.category||''} ${t.end_date&&t.end_date!==t.start_date?'~ '+fmt(t.end_date):''}</div>
        </div>`).join('')
      : `<div style="text-align:center;color:#9ca3af;font-size:11px;padding:12px 0;">등록된 업무가 없습니다.</div>`;

    // 근태 섹션 (일, 토만)
    const attendHtml = (isSun || isSat) ? `
      <div class="attend-section">
        <div class="attend-title">${isSat ? '🗓 토요근무' : '☀ 조기출근'} (이번 주)</div>
        <div class="attend-checks">
          <label class="attend-check">
            <input type="checkbox" id="cbAttend" ${calJournal?.[jKey]==='Y'?'checked':''} onchange="saveAttend('${jKey}', '${ws}', '${we}', this.checked)">
            <span>${isSat ? '토요근무 있음' : '조기출근 있음'}</span>
          </label>
        </div>
      </div>` : '';

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

    body.innerHTML = taskHtml + attendHtml + attWeekHtml + issueHtml;
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
  window.openTaskModal = async function(taskId) {
    editingTaskId = taskId;
    document.getElementById('taskModalTitle').textContent = taskId ? '업무 수정' : '업무 추가';
    document.getElementById('deleteTaskBtn').style.display = taskId ? '' : 'none';

    updateCategorySelect();
    updateClinicSelect('');

    if (taskId) {
      const task = calTasks.find(t => t.task_id === taskId);
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
  };

  window.deleteTask = async function() {
    if (!editingTaskId || !confirm('이 업무를 삭제하시겠습니까?')) return;
    const { error } = await supabaseClient.from('task_items').delete().eq('task_id', editingTaskId);
    if (error) { showMessage('삭제 실패: ' + error.message, 'error'); return; }
    showMessage('삭제됐습니다.', 'success');
    closeTaskModal();
    await renderCalendar();
    if (selectedDate) renderDetailPanel(selectedDate);
  };

  /* ══ 팀 현황 ═════════════════════════════════════ */
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
      // 팀원 조회
      const { data: members } = await supabaseClient.from('user_profiles_with_email')
        .select('id, user_name, email, clinic_code, clinic_name, team_code')
        .eq('team_code', currentUser.team_code).eq('active', 'Y').order('user_name');

      if (!members?.length) {
        document.getElementById('teamGrid').innerHTML =
          '<div style="color:#9ca3af;font-size:12px;padding:20px;">팀원이 없습니다.</div>';
        return;
      }

      const emails = members.map(m => m.email);

      // 팀원 업무 + 일지 병렬 조회
      const [{ data: tasks }, { data: journals }] = await Promise.all([
        supabaseClient.from('task_items').select('*').in('user_email', emails)
          .gte('start_date', teamWeekStart).lte('start_date', we),
        supabaseClient.from('task_journals').select('*').in('user_email', emails)
          .eq('week_start', teamWeekStart)
      ]);

      const grid = document.getElementById('teamGrid');
      grid.innerHTML = members.map(m => {
        const mTasks   = (tasks||[]).filter(t => t.user_email === m.email);
        const journal  = (journals||[]).find(j => j.user_email === m.email);
        const isClosed = journal?.status === 'CLOSED';

        // 업무 요약 — 카테고리별 그룹
        const grouped = {};
        mTasks.forEach(t => {
          const cat = CATEGORIES[t.category] || t.category || '기타';
          if (!grouped[cat]) grouped[cat] = [];
          grouped[cat].push(t);
        });

        const taskHtml = Object.entries(grouped).map(([cat, ts]) =>
          `<div style="margin-bottom:6px;">
            <div style="font-size:10px;font-weight:700;color:#6b7280;margin-bottom:3px;">${esc(cat)}</div>
            ${ts.map(t => `<div style="font-size:11px;color:#374151;padding:1px 0;">
              <span class="task-status-badge ${t.status}" style="font-size:9px;">${STATUS_LABEL[t.status]||''}</span>
              ${t.priority==='HIGH'?'⚡ ':''}${esc(t.title)}
            </div>`).join('')}
          </div>`
        ).join('') || '<div class="no-data">등록된 업무가 없습니다.</div>';

        const attendInfo = journal ? [
          journal.early_work_this==='Y' ? '조기출근' : '',
          journal.sat_work_this==='Y'   ? '토요근무' : '',
          journal.attendance_this_week  ? journal.attendance_this_week : '',
        ].filter(Boolean).join(' | ') : '';

        const issueInfo = journal?.issues ? `<div style="margin-top:8px;padding:6px;background:#fffbeb;border-radius:4px;font-size:10px;color:#92400e;">${esc(journal.issues)}</div>` : '';

        return `<div class="team-member-card">
          <div class="team-card-header">
            <div>
              <div class="team-card-name">${esc(m.user_name)}</div>
              <div class="team-card-meta">${esc(m.clinic_name||'')} · ${mTasks.length}건</div>
            </div>
            <span class="journal-status ${isClosed?'closed':'open'}">${isClosed?'마감':'작성중'}</span>
          </div>
          <div class="team-card-body">
            ${taskHtml}
            ${attendInfo ? `<div style="font-size:10px;color:#6b7280;margin-top:6px;padding-top:6px;border-top:1px solid #f0f0f0;">${esc(attendInfo)}</div>` : ''}
            ${issueInfo}
          </div>
          ${isManager ? `<div class="team-card-footer">
            ${isClosed
              ? `<button class="btn btn-sm" style="font-size:11px;height:26px;" onclick="reopenJournal('${m.email}')">마감해제</button>`
              : `<button class="btn btn-sm btn-primary" style="font-size:11px;height:26px;" onclick="closeJournal('${m.email}')">마감</button>`
            }
          </div>` : ''}
        </div>`;
      }).join('');
    } finally {
      hideGlobalLoading();
    }
  }

  window.closeJournal = async function(email) {
    if (!confirm(`${email} 님의 업무일지를 마감하시겠습니까?`)) return;
    // journal이 없으면 생성
    const { data: j } = await supabaseClient.from('task_journals').select('id')
      .eq('user_email', email).eq('week_start', teamWeekStart).maybeSingle();
    if (j) {
      await supabaseClient.from('task_journals').update({
        status: 'CLOSED', closed_at: new Date().toISOString(),
        closed_by: currentUser.email, updated_at: new Date().toISOString()
      }).eq('id', j.id);
    } else {
      await supabaseClient.from('task_journals').insert({
        user_email: email, week_start: teamWeekStart, week_end: getWeekEnd(teamWeekStart),
        status: 'CLOSED', closed_at: new Date().toISOString(), closed_by: currentUser.email
      });
    }
    showMessage('마감됐습니다.', 'success');
    loadTeamView();
  };

  window.reopenJournal = async function(email) {
    if (!confirm(`마감을 해제하시겠습니까?`)) return;
    await supabaseClient.from('task_journals').update({
      status: 'OPEN', closed_at: null, closed_by: null, updated_at: new Date().toISOString()
    }).eq('user_email', email).eq('week_start', teamWeekStart);
    showMessage('마감이 해제됐습니다.', 'success');
    loadTeamView();
  };

  /* ══ 업무 검색 ══════════════════════════════════ */
  async function runSearch() {
    const keyword = document.getElementById('searchKeyword').value.trim();
    const from    = document.getElementById('searchFrom').value;
    const to      = document.getElementById('searchTo').value;
    const status  = document.getElementById('searchStatus').value;

    let q = supabaseClient.from('task_items').select('*').eq('user_email', currentUser.email);
    if (from)    q = q.gte('start_date', from);
    if (to)      q = q.lte('start_date', to);
    if (status)  q = q.eq('status', status);
    if (keyword) q = q.or(`title.ilike.%${keyword}%,description.ilike.%${keyword}%`);
    q = q.order('start_date', { ascending: false }).limit(200);

    const { data, error } = await q;
    if (error) { showMessage('검색 실패: ' + error.message, 'error'); return; }

    const results = document.getElementById('searchResults');
    if (!data?.length) {
      results.innerHTML = '<div style="text-align:center;color:#9ca3af;font-size:12px;padding:40px;">검색 결과가 없습니다.</div>';
      return;
    }
    results.innerHTML = `<div style="font-size:11px;color:#6b7280;padding:8px 0;">${data.length}건</div>` +
      data.map(t => `
        <div class="task-item-card ${t.status==='DONE'?'done':''} ${t.priority==='HIGH'?'high':''}"
             style="margin-bottom:6px;" onclick="jumpToDate('${t.start_date}')">
          <div class="task-item-title">
            <span class="task-status-badge ${t.status}">${STATUS_LABEL[t.status]||t.status}</span>
            ${t.priority==='HIGH'?'<span style="color:#dc2626;">⚡</span>':''}
            ${esc(t.title)}
          </div>
          <div class="task-item-meta">${t.start_date} ${CATEGORIES[t.category]||t.category||''}</div>
          ${t.description?`<div style="font-size:11px;color:#6b7280;margin-top:3px;">${esc(t.description.slice(0,60))}${t.description.length>60?'...':''}</div>`:''}
        </div>`).join('');
  }

  window.jumpToDate = function(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    calYear  = d.getFullYear();
    calMonth = d.getMonth();
    switchTab('calendar');
    renderCalendar().then(() => selectDate(dateStr));
  };

  /* ══ 엑셀 출력 (기존 로직 이식) ══════════════════ */
  async function exportExcel() {
    if (!window.XLSX) { showMessage('엑셀 라이브러리를 불러오지 못했습니다.', 'error'); return; }
    const btn = document.getElementById('exportExcelBtn');
    try {
      if (btn) { btn.disabled = true; btn.textContent = '처리 중...'; }
      showGlobalLoading('데이터를 불러오는 중...');

      const we = getWeekEnd(teamWeekStart);
      const nextWS = offsetWeek(teamWeekStart, 1);
      const nextWE = getWeekEnd(nextWS);

      // 팀원 조회
      const { data: members } = await supabaseClient.from('user_profiles_with_email')
        .select('id, user_name, email, clinic_code, clinic_name, team_code')
        .eq('team_code', currentUser.team_code).eq('active', 'Y').order('user_name');
      if (!members?.length) { showMessage('팀원이 없습니다.', 'error'); return; }

      const emails = members.map(m => m.email);

      const [{ data: tasks }, { data: nextTasks }, { data: journals }, { data: nextJournals }] = await Promise.all([
        supabaseClient.from('task_items').select('*').in('user_email', emails).gte('start_date', teamWeekStart).lte('start_date', we),
        supabaseClient.from('task_items').select('*').in('user_email', emails).gte('start_date', nextWS).lte('start_date', nextWE),
        supabaseClient.from('task_journals').select('*').in('user_email', emails).eq('week_start', teamWeekStart),
        supabaseClient.from('task_journals').select('*').in('user_email', emails).eq('week_start', nextWS),
      ]);

      // 카테고리 확인
      if (!Object.keys(CATEGORIES).length) await loadCategories();

      // 의원별 분류
      const taskClinicMap   = {};  // work_clinic_name 기준
      const memberClinicMap = {};  // 소속 clinic_name 기준

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
        const we = isNext ? nextWE : getWeekEnd(teamWeekStart);
        const filtered = taskList.filter(t => {
          const s = t.start_date||'', e = t.end_date||s;
          if (e < ws || s > we) return false;
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

      const sc = (row, col, val, s) => {
        ws2[window.XLSX.utils.encode_cell({r:row,c:col})] = { v:val??'', t:'s', s };
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
      ws2['!rows'] = Array(r).fill(null).map((_,i) => i<3 ? {hpt:20} : {hpt:60});

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
  function esc(v) {
    return String(v||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

})();
