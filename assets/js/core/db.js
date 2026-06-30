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

  // 이미지 리사이즈/압축 (Canvas API)
  function compressImage(file, maxWidth = 1280, quality = 0.82) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        let w = img.naturalWidth, h = img.naturalHeight;
        if (w > maxWidth) { h = Math.round(h * maxWidth / w); w = maxWidth; }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        canvas.toBlob(blob => {
          if (!blob) { reject(new Error('이미지 압축 실패')); return; }
          resolve(new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' }));
        }, 'image/jpeg', quality);
      };
      img.onerror = () => reject(new Error('이미지 로드 실패'));
      img.src = url;
    });
  }

  async function uploadPhoto(file, equipmentId) {
    // 업로드 전 리사이즈/압축 (최대 1280px, JPEG 품질 82%)
    const compressed = await compressImage(file);
    const path = `${equipmentId}/${Date.now()}.jpg`;

    const { error } = await supabaseClient.storage
      .from(CONFIG.STORAGE.EQUIPMENT_PHOTOS)
      .upload(path, compressed, { upsert: true, contentType: 'image/jpeg' });

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

  // ── 범용 비공개 파일 업로드 (signage-files 등 private 버킷) ──
  async function uploadFile(bucket, file, pathPrefix) {
    const safeName = String(file.name || 'file').replace(/[^\w.\-가-힣]/g, '_');
    const path = `${pathPrefix}/${Date.now()}_${safeName}`;
    const { error } = await supabaseClient.storage
      .from(bucket)
      .upload(path, file, { upsert: false, contentType: file.type || 'application/octet-stream' });
    if (error) handleError(error, `uploadFile:${bucket}`);
    return { path, name: file.name, size: file.size };
  }

  async function deleteFile(bucket, path) {
    if (!path) return;
    const { error } = await supabaseClient.storage.from(bucket).remove([path]);
    if (error) console.warn('[db:deleteFile]', error);
  }

  // private 버킷은 getPublicUrl이 통하지 않으므로 signed URL 발급 (기본 1시간)
  async function getSignedUrl(bucket, path, expiresIn = 3600) {
    const { data, error } = await supabaseClient.storage
      .from(bucket)
      .createSignedUrl(path, expiresIn);
    if (error) { console.warn('[db:getSignedUrl]', error); return ''; }
    return data?.signedUrl || '';
  }

  return {
    select,
    selectOne,
    insert,
    update,
    remove,
    uploadPhoto,
    deletePhoto,
    uploadFile,
    deleteFile,
    getSignedUrl,
  };
})();
