/**
 * supabase.js
 * Supabase JS SDK 초기화 싱글턴.
 * 모든 JS 파일은 이 파일을 통해 supabaseClient를 참조한다.
 * 반드시 config.js 다음에 로드할 것.
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
    },
  }
);
