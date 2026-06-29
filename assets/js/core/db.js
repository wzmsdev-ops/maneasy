/**
 * db.js
 * Supabase DB / Storage 공통 래퍼.
 * 에러 핸들링을 한 곳에서 처리하고 호출부를 단순하게 유지한다.
 */

window.db = (function () {

  /* ── DB 헬퍼 ─────────────────────────────────── */

  function handleError(error, context = '') {
    const msg = error?.message || '알 수 없는 오류가 발생했습니다.';
    console.error(`[db${context ? ':' + context : ''}]`, error);
    throw new Error(msg);
  }

  async function select(table, queryFn) {
    let q = supabaseClient.from(table).select('*');
    if (queryFn) q = queryFn(q);
    const { data, error } = await q;
    if (error) handleError(error, `select:${table}`);
    return data || [];
  }

  async function selectOne(table, queryFn) {
    let q = supabaseClient.from(table).select('*');
    if (queryFn) q = queryFn(q);
    const { data, error } = await q.single();
    if (error) handleError(error, `selectOne:${table}`);
    return data;
  }

  async function insert(table, row) {
    const { data, error } = await supabaseClient
      .from(table)
      .insert(row)
      .select()
      .single();
    if (error) handleError(error, `insert:${table}`);
    return data;
  }

  async function update(table, id, patch) {
    const { data, error } = await supabaseClient
      .from(table)
      .update(patch)
      .eq('id', id)
      .select()
      .single();
    if (error) handleError(error, `update:${table}`);
    return data;
  }

  async function remove(table, id) {
    const { error } = await supabaseClient
      .from(table)
      .delete()
      .eq('id', id);
    if (error) handleError(error, `delete:${table}`);
  }

  /* ── Storage 헬퍼 ────────────────────────────── */

  async function uploadPhoto(file, equipmentId) {
    // GAS Web App으로 업로드 → Google Drive 저장 → lh3 CDN URL 반환
    const GAS_URL = CONFIG.GAS_UPLOAD_URL;
    if (!GAS_URL) throw new Error('GAS_UPLOAD_URL이 설정되지 않았습니다.');

    const ext = file.name.split('.').pop().toLowerCase();
    const fileName = `${equipmentId}_${Date.now()}.${ext}`;

    // File → Base64
    const base64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.onerror = () => reject(new Error('파일 읽기 실패'));
      reader.readAsDataURL(file);
    });

    // GAS Web App은 application/x-www-form-urlencoded로 호출해야 CORS 통과
    const formData = new FormData();
    formData.append('base64', base64);
    formData.append('mimeType', file.type);
    formData.append('fileName', fileName);

    const res = await fetch(GAS_URL, {
      method: 'POST',
      body: formData,
    });

    const data = await res.json();
    if (!data.success) throw new Error(data.error || '업로드 실패');

    // path 자리에 fileId 저장 (삭제 시 사용)
    return { path: data.fileId, url: data.url };
  }

  async function deletePhoto(fileId) {
    if (!fileId) return;
    const GAS_URL = CONFIG.GAS_UPLOAD_URL;
    if (!GAS_URL) return;
    try {
      const fd = new FormData();
      fd.append('action', 'delete');
      fd.append('fileId', fileId);
      await fetch(GAS_URL, { method: 'POST', body: fd });
    } catch (e) {
      console.warn('[db:deletePhoto]', e);
    }
  }

  return {
    select,
    selectOne,
    insert,
    update,
    remove,
    uploadPhoto,
    deletePhoto,
  };
})();
