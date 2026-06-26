/**
 * auth.js
 * Supabase Auth 기반 인증 모듈.
 * window.auth 네임스페이스로 노출 — 기존 호출부 호환.
 */

window.auth = (function () {
  const STORAGE_KEY = 'demo_portal_user';

  /* ── 내부 헬퍼 ───────────────────────────────── */

  function getLoginUrl() {
    return `${CONFIG.SITE_BASE_URL}/index.html`;
  }

  function getAppUrl() {
    return `${CONFIG.SITE_BASE_URL}/app.html`;
  }

  function setMessage(message, type = '') {
    const el = document.getElementById('authMessage');
    if (!el) return;
    el.textContent = message || '';
    el.className = 'auth-message' + (type ? ` is-${type}` : '');
  }

  /* ── 세션 ────────────────────────────────────── */

  async function getSession() {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) return null;

    const { data: profile } = await supabaseClient
      .from('user_profiles')
      .select('*')
      .eq('id', session.user.id)
      .single();

    return {
      id: session.user.id,
      email: session.user.email,
      user_name: profile?.user_name || session.user.email,
      role: profile?.role || 'user',
      clinic_code: profile?.clinic_code || '',
      clinic_name: profile?.clinic_name || '',
      team_code: profile?.team_code || '',
      team_name: profile?.team_name || '',
      department: profile?.department || '',
      active: profile?.active || 'Y',
    };
  }

  async function clearSession() {
    await supabaseClient.auth.signOut();
  }

  /* ── 인증 가드 ───────────────────────────────── */

  async function requireAuth() {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) {
      location.replace(getLoginUrl());
      return null;
    }
    return session;
  }

  async function requireAdmin() {
    const session = await getSession();
    if (!session) {
      location.replace(getLoginUrl());
      return null;
    }
    if (session.role !== 'admin') {
      alert('관리자 권한이 필요합니다.');
      location.replace(getAppUrl());
      return null;
    }
    return session;
  }

  /* ── 로그인 페이지 전용 ──────────────────────── */

  async function initLoginPage() {
    // 이미 로그인돼 있으면 앱으로 이동
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (session) {
      location.replace(getAppUrl());
      return;
    }

    const loginBtn = document.getElementById('loginBtn');
    const emailInput = document.getElementById('userEmail');
    const passwordInput = document.getElementById('userPassword');

    async function doLogin() {
      const email = emailInput?.value?.trim();
      const password = passwordInput?.value?.trim();
      if (!email) return setMessage('이메일을 입력해 주세요.', 'error');
      if (!password) return setMessage('비밀번호를 입력해 주세요.', 'error');

      loginBtn.disabled = true;
      setMessage('로그인 중...', '');

      const { error } = await supabaseClient.auth.signInWithPassword({ email, password });

      if (error) {
        setMessage('이메일 또는 비밀번호가 올바르지 않습니다.', 'error');
        loginBtn.disabled = false;
        return;
      }

      location.replace(getAppUrl());
    }

    loginBtn?.addEventListener('click', doLogin);
    passwordInput?.addEventListener('keydown', e => {
      if (e.key === 'Enter') doLogin();
    });

    document.getElementById('clearCacheBtn')?.addEventListener('click', () => {
      localStorage.clear();
      sessionStorage.clear();
      location.reload();
    });
  }

  /* ── 로그아웃 ────────────────────────────────── */

  async function logout() {
    await clearSession();
    location.replace(getLoginUrl());
  }

  return {
    getSession,
    clearSession,
    requireAuth,
    requireAdmin,
    initLoginPage,
    logout,
  };
})();
