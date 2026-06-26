/**
 * supabase.js — SDK 초기화 싱글턴
 * app.html(셸)과 iframe 내부 페이지가 동일한 storage key를 사용해
 * 같은 세션을 공유한다.
 */

const { createClient } = supabase;

const supabaseClient = createClient(
  CONFIG.SUPABASE_URL,
  CONFIG.SUPABASE_ANON_KEY,
  {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
      storageKey: 'maneasy-auth',   // 고정 키 — 셸/iframe 공유
      storage: window.localStorage,
    },
  }
);
