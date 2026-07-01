/**
 * auth.js
 * Supabase Auth 기반 인증 모듈.
 * - 로그인 / 회원가입 / 승인 대기 처리
 */

window.auth = (function () {

  function getLoginUrl() { return `${CONFIG.SITE_BASE_URL}/index.html`; }
  function getAppUrl()   { return `${CONFIG.SITE_BASE_URL}/app.html`; }

  function setMessage(message, type = '') {
    const el = document.getElementById('authMessage');
    if (!el) return;
    el.textContent = message || '';
    el.className = 'auth-message' + (type ? ` is-${type}` : '');
  }

  /* ── 세션 ─────────────────────────────────────── */

  async function getSession() {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) return null;

    const { data: profile } = await supabaseClient
      .from('user_profiles')
      .select('*')
      .eq('id', session.user.id)
      .single();

    return {
      id:          session.user.id,
      email:       session.user.email,
      user_name:   profile?.user_name || session.user.email,
      role:        profile?.role       || 'user',
      clinic_code: profile?.clinic_code || '',
      clinic_name: profile?.clinic_name || '',
      team_code:   profile?.team_code   || '',
      team_name:   profile?.team_name   || '',
      department:  profile?.department  || '',
      active:      profile?.active      || 'N',
      allowed_pages: profile?.allowed_pages || null,
      page_perms:    profile?.page_perms    || null,
    };
  }

  async function clearSession() {
    try {
      await supabaseClient.auth.signOut({ scope: 'local' });
    } catch(e) {
      console.warn('[auth] signOut error:', e);
    }
    // localStorage 세션 키 직접 제거 (iframe 공유 키 포함)
    try {
      localStorage.removeItem('maneasy-auth');
      // Supabase가 내부적으로 쓰는 키들도 제거
      Object.keys(localStorage).forEach(function(k) {
        if (k.startsWith('sb-') || k.startsWith('supabase')) {
          localStorage.removeItem(k);
        }
      });
    } catch(e) {}
  }

  /* ── 인증 가드 ─────────────────────────────────── */

  async function requireAuth() {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) { location.replace(getLoginUrl()); return null; }

    // 승인 여부 확인
    const user = await getSession();
    if (user && user.active !== 'Y') {
      await clearSession();
      location.replace(getLoginUrl() + '?pending=1');
      return null;
    }
    return session;
  }

  async function requireAdmin() {
    const session = await getSession();
    if (!session) { location.replace(getLoginUrl()); return null; }
    if (session.active !== 'Y') {
      await clearSession();
      location.replace(getLoginUrl() + '?pending=1');
      return null;
    }
    if (session.role !== 'admin') {
      alert('관리자 권한이 필요합니다.');
      location.replace(getAppUrl());
      return null;
    }
    return session;
  }

  /* ── 로그인 페이지 ─────────────────────────────── */

  async function initLoginPage() {
    // ?logout=1 이면 세션 체크 없이 바로 로그인 화면 표시 (루프 방지)
    const urlParams = new URLSearchParams(location.search);
    if (urlParams.get('logout') === '1') {
      // URL 파라미터 제거 후 로그인 화면 유지
      history.replaceState(null, '', location.pathname);
    } else {
      const { data: { session } } = await supabaseClient.auth.getSession();
      if (session) {
        const user = await getSession();
        if (user && user.active !== 'Y') {
          await clearSession();
        } else {
          location.replace(getAppUrl());
          return;
        }
      }
    }

    // ?pending=1 → 승인 대기 메시지
    const params = new URLSearchParams(location.search);
    if (params.get('pending') === '1') {
      setMessage('계정 승인 대기 중입니다. 관리자 승인 후 로그인할 수 있습니다.', 'warn');
    }

    // 탭 전환 (로그인 / 회원가입 / 비밀번호 재설정)
    const tabLogin    = document.getElementById('tabLogin');
    const tabSignup   = document.getElementById('tabSignup');
    const tabReset    = document.getElementById('tabReset');
    const panelLogin  = document.getElementById('panelLogin');
    const panelSignup = document.getElementById('panelSignup');
    const panelReset  = document.getElementById('panelReset');

    function showTab(tab) {
      [tabLogin, tabSignup, tabReset].forEach(t => t?.classList.remove('is-active'));
      [panelLogin, panelSignup, panelReset].forEach(p => { if (p) p.style.display = 'none'; });
      if (tab === 'login')  { tabLogin?.classList.add('is-active');  if (panelLogin)  panelLogin.style.display  = ''; }
      if (tab === 'signup') { tabSignup?.classList.add('is-active'); if (panelSignup) panelSignup.style.display = ''; }
      if (tab === 'reset')  { tabReset?.classList.add('is-active');  if (panelReset)  panelReset.style.display  = ''; }
      setMessage('', '');
    }

    tabLogin?.addEventListener('click',  () => showTab('login'));
    tabSignup?.addEventListener('click', () => showTab('signup'));
    tabReset?.addEventListener('click',  () => showTab('reset'));

    // ?type=recovery — 비밀번호 재설정 링크 클릭 후 진입
    const hashParams = new URLSearchParams(location.hash.slice(1));
    if (hashParams.get('type') === 'recovery') {
      showTab('reset');
      document.getElementById('resetStep1').style.display = 'none';
      document.getElementById('resetStep2').style.display = '';
    } else {
      showTab('login');
    }

    /* ── 비밀번호 재설정 ── */
    document.getElementById('resetSendBtn')?.addEventListener('click', async function() {
      const email = document.getElementById('resetEmail')?.value?.trim();
      if (!email) return setMessage('이메일을 입력해 주세요.', 'error');
      this.disabled = true;
      setMessage('', '');
      const redirectTo = location.origin + location.pathname;
      const { error } = await supabaseClient.auth.resetPasswordForEmail(email, { redirectTo });
      this.disabled = false;
      if (error) return setMessage('발송 실패: ' + error.message, 'error');
      setMessage('재설정 링크를 이메일로 발송했습니다. 메일함을 확인해 주세요.', 'success');
    });

    document.getElementById('resetConfirmBtn')?.addEventListener('click', async function() {
      const pw  = document.getElementById('newPassword')?.value?.trim();
      const pw2 = document.getElementById('newPassword2')?.value?.trim();
      if (!pw || pw.length < 6) return setMessage('비밀번호를 6자 이상 입력해 주세요.', 'error');
      if (pw !== pw2) return setMessage('비밀번호가 일치하지 않습니다.', 'error');
      this.disabled = true;
      const { error } = await supabaseClient.auth.updateUser({ password: pw });
      this.disabled = false;
      if (error) return setMessage('변경 실패: ' + error.message, 'error');
      setMessage('비밀번호가 변경됐습니다. 로그인해 주세요.', 'success');
      setTimeout(() => { showTab('login'); history.replaceState(null, '', location.pathname); }, 2000);
    });

    /* ── 로그인 ── */
    const loginBtn      = document.getElementById('loginBtn');
    const emailInput    = document.getElementById('userEmail');
    const passwordInput = document.getElementById('userPassword');

    async function doLogin() {
      const email    = emailInput?.value?.trim();
      const password = passwordInput?.value?.trim();
      if (!email)    return setMessage('이메일을 입력해 주세요.', 'error');
      if (!password) return setMessage('비밀번호를 입력해 주세요.', 'error');

      loginBtn.disabled = true;
      setMessage('', '');
      if (typeof showGlobalLoading === 'function') showGlobalLoading('로그인 중...');

      const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
      if (error) {
        if (typeof hideGlobalLoading === 'function') hideGlobalLoading();
        setMessage('이메일 또는 비밀번호가 올바르지 않습니다.', 'error');
        loginBtn.disabled = false;
        return;
      }

      // 승인 여부 확인
      const user = await getSession();
      if (!user || user.active !== 'Y') {
        await clearSession();
        if (typeof hideGlobalLoading === 'function') hideGlobalLoading();
        setMessage('계정 승인 대기 중입니다. 관리자 승인 후 로그인할 수 있습니다.', 'warn');
        loginBtn.disabled = false;
        return;
      }

      // 로그인 로그
      if (typeof systemLog === 'function') {
        systemLog('LOGIN', (user.user_name || user.email) + ' 로그인').catch(() => {});
      }

      location.replace(getAppUrl());
    }
    loginBtn?.addEventListener('click', doLogin);
    passwordInput?.addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });

    /* ── 회원가입 ── */
    const signupBtn       = document.getElementById('signupBtn');
    const signupEmail     = document.getElementById('signupEmail');
    const signupPassword  = document.getElementById('signupPassword');
    const signupPassword2 = document.getElementById('signupPassword2');
    const signupName      = document.getElementById('signupName');

    async function doSignup() {
      const email  = signupEmail?.value?.trim();
      const pw1    = signupPassword?.value?.trim();
      const pw2    = signupPassword2?.value?.trim();
      const name   = signupName?.value?.trim();

      if (!name)          return setMessage('이름을 입력해 주세요.', 'error');
      if (!email)         return setMessage('이메일을 입력해 주세요.', 'error');
      if (!pw1)           return setMessage('비밀번호를 입력해 주세요.', 'error');
      if (pw1.length < 6) return setMessage('비밀번호는 6자 이상이어야 합니다.', 'error');
      if (pw1 !== pw2)    return setMessage('비밀번호가 일치하지 않습니다.', 'error');

      signupBtn.disabled = true;
      setMessage('', '');
      if (typeof showGlobalLoading === 'function') showGlobalLoading('가입 처리 중...');

      const { data, error } = await supabaseClient.auth.signUp({
        email, password: pw1,
        options: { data: { user_name: name } },
      });

      if (error) {
        if (typeof hideGlobalLoading === 'function') hideGlobalLoading();
        setMessage(error.message || '회원가입에 실패했습니다.', 'error');
        signupBtn.disabled = false;
        return;
      }

      // user_profiles 이름 업데이트 (트리거가 생성하지만 user_name은 비어있을 수 있음)
      if (data.user) {
        const { error: profileErr } = await supabaseClient
          .from('user_profiles')
          .update({ user_name: name, active: 'N', role: 'user' })
          .eq('id', data.user.id);
        if (profileErr) console.warn('[signup] 프로필 업데이트 실패 (DB 기본값으로 안전하게 비활성 처리됨):', profileErr.message);
      }

      // 자동 로그인 방지
      await clearSession();

      // 관리자에게 가입 신청 알림 메일 발송
      if (typeof gasNotify === 'function') {
        gasNotify('signupNotice', { name, email });
      }

      if (typeof hideGlobalLoading === 'function') hideGlobalLoading();
      setMessage('가입이 완료됐습니다. 관리자 승인 후 로그인할 수 있습니다.', 'success');
      signupBtn.disabled = false;
      showTab('login');
    }

    signupBtn?.addEventListener('click', doSignup);
    signupPassword2?.addEventListener('keydown', e => { if (e.key === 'Enter') doSignup(); });

    /* ── 캐시 초기화 ── */
    document.getElementById('clearCacheBtn')?.addEventListener('click', () => {
      localStorage.clear();
      sessionStorage.clear();
      location.reload();
    });
  }

  /* ── 로그아웃 ─────────────────────────────────── */

  async function logout() {
    await clearSession();
    setTimeout(function() {
      location.replace(getLoginUrl() + '?logout=1');
    }, 150);
  }

  return { getSession, clearSession, requireAuth, requireAdmin, initLoginPage, logout };
})();
