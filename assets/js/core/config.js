const CONFIG = {
  APP_NAME: '관리이지',

  SUPABASE_URL: 'https://iaxeizhoelhwitsllrmw.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlheGVpemhvZWxod2l0c2xscm13Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI0MTU1MDMsImV4cCI6MjA5Nzk5MTUwM30.PO-cclqvkO1meBmd3oTVBe6m2v7SZS2KctIP__xbfOc',

  SITE_BASE_URL: (function () {
    if (location.protocol === 'file:') return '';
    const parts = location.pathname.split('/').filter(Boolean);
    return location.origin + (parts.length ? '/' + parts[0] : '');
  })(),

  STORAGE: {
    EQUIPMENT_PHOTOS: 'equipment-photos',
  },

  // GAS Web App URL — drive-upload.gs 배포 후 입력
  GAS_UPLOAD_URL: 'https://script.google.com/macros/s/AKfycby4LMuwlpA_1-ehuBZpyNEOoesmo8ULGO5bnOt1vRcUoS0VTV88WE6oMrbVewicDRwOfg/exec',

  EQUIPMENT_STATUS: {
    IN_USE:     'IN_USE',
    REPAIRING:  'REPAIRING',
    INSPECTING: 'INSPECTING',
    STORED:     'STORED',
    DISPOSED:   'DISPOSED',
  },

  EQUIPMENT_STATUS_LABEL: {
    IN_USE:     '사용중',
    REPAIRING:  '수리중',
    INSPECTING: '점검중',
    STORED:     '보관중',
    DISPOSED:   '폐기',
  },

  CACHE_VERSION: '20260626_01',
};
