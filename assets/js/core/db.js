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
    const ext = file.name.split('.').pop();
    const path = `${equipmentId}/${Date.now()}.${ext}`;

    const { error } = await supabaseClient.storage
      .from(CONFIG.STORAGE.EQUIPMENT_PHOTOS)
      .upload(path, file, { upsert: true });

    if (error) handleError(error, 'uploadPhoto');

    const { data } = supabaseClient.storage
      .from(CONFIG.STORAGE.EQUIPMENT_PHOTOS)
      .getPublicUrl(path);

    return { path, url: data.publicUrl };
  }

  async function deletePhoto(path) {
    if (!path) return;
    const { error } = await supabaseClient.storage
      .from(CONFIG.STORAGE.EQUIPMENT_PHOTOS)
      .remove([path]);
    if (error) console.warn('[db:deletePhoto]', error);
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
