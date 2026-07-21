// =========================================================================
// attachments.js — 附件存储层（IndexedDB，图片为主）
// blob 存 IDB；entry.attachments 只存元数据。导出时把 blob 一起打包(base64)。
// 零依赖。缩略图用 canvas resize 到 ≤ 320px。
// =========================================================================

const DB_NAME = 'love-attachments';
const STORE = 'blobs';
const DB_VERSION = 1;

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('当前环境不支持 IndexedDB'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('打开 IndexedDB 失败'));
  });
  return dbPromise;
}

function tx(mode) {
  return openDB().then(db => db.transaction(STORE, mode).objectStore(STORE));
}

/** 把 File/Blob 存入 IDB，返回元数据 {id,name,type,size,storeKey,thumb} */
export async function putAttachment(file) {
  const id = await genAttId();
  const name = file.name || `${id}`;
  const type = file.type || guessType(name);
  const size = file.size;
  // 存原 blob
  const blob = file instanceof Blob ? file : new Blob([file], { type });
  await idbPut({ id, blob });
  // 生成缩略图 dataURL（图片类型）
  let thumb = null;
  if (type.startsWith('image/')) {
    thumb = await makeThumb(blob).catch(() => null);
  }
  return { id, name, type, size, storeKey: id, thumb };
}

/** 从 IDB 取回 blob（用于大图 lightbox 查看或导出） */
export async function getBlob(storeKey) {
  const rec = await idbGet(storeKey);
  return rec ? rec.blob : null;
}

/** 取缩略图 dataURL（entry.attachments 已含 thumb，无需进 IDB；此处兜底） */
export async function getThumb(meta) {
  if (meta && meta.thumb) return meta.thumb;
  if (meta && meta.storeKey && meta.type && meta.type.startsWith('image/')) {
    const blob = await getBlob(meta.storeKey);
    if (blob) return await makeThumb(blob).catch(() => null);
  }
  return null;
}

/** 删除条目的一个附件 blob；元数据由 store.removeAttachment 清理 */
export async function deleteBlob(storeKey) {
  try { await idbDelete(storeKey); } catch (_) {}
}

/** 列出 IDB 中全部 {id}（用于孤儿清理 / 审计） */
export async function listAllIds() {
  const store = await tx('readonly');
  return new Promise((resolve, reject) => {
    const req = store.getAllKeys();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

/** 删除未被任何 entry 引用的孤儿 blob（传入仍在用的 storeKey 集合） */
export async function gcKeep(usedKeys) {
  const all = await listAllIds();
  const keep = new Set(usedKeys.map(String));
  for (const id of all) {
    if (!keep.has(String(id))) await idbDelete(id);
  }
}

// —— 导出/导入：把 blob 编码 base64 一起打包，换设备可迁移 ——
export async function exportAttachmentsBundle(entries, photos = []) {
  const bundle = {};
  const refs = [
    ...entries.flatMap(entry => entry.attachments || []),
    ...photos,
  ];
  for (const item of refs) {
    if (!item.storeKey || bundle[item.storeKey]) continue;
    let blob = null;
    try { blob = await getBlob(item.storeKey); } catch (_) { continue; }
    if (!blob) continue;
    bundle[item.storeKey] = {
      type: item.type,
      data: await blobToBase64(blob),
    };
  }
  return bundle;
}

export async function importAttachmentsBundle(bundle) {
  if (!bundle) return;
  for (const [storeKey, item] of Object.entries(bundle)) {
    const blob = base64ToBlob(item.data, item.type);
    await idbPut({ id: storeKey, blob });
  }
}

// —— 内部 ——
function idbPut(rec) {
  return tx('readwrite').then(store => new Promise((resolve, reject) => {
    const r = store.put(rec);
    r.onsuccess = () => resolve();
    r.onerror = () => reject(r.error);
  }));
}
function idbGet(key) {
  return tx('readonly').then(store => new Promise((resolve, reject) => {
    const r = store.get(key);
    r.onsuccess = () => resolve(r.result || null);
    r.onerror = () => reject(r.error);
  }));
}
function idbDelete(key) {
  return tx('readwrite').then(store => new Promise((resolve, reject) => {
    const r = store.delete(key);
    r.onsuccess = () => resolve();
    r.onerror = () => reject(r.error);
  }));
}

async function genAttId() {
  // 时间戳+随机，避免与 entry id 体系混淆
  const t = Date.now().toString(36);
  const r = Math.random().toString(36).slice(2, 8);
  return `att-${t}-${r}`;
}

function guessType(name) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  const map = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
    webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp',
    heic: 'image/heic', heif: 'image/heif',
  };
  return map[ext] || 'application/octet-stream';
}

function makeThumb(blob, max = 320) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      try {
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
        URL.revokeObjectURL(url);
        resolve(dataUrl);
      } catch (e) { URL.revokeObjectURL(url); reject(e); }
    };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => {
      // result 形如 data:image/png;base64,XXXX — 只取 base64 部分
      const s = String(fr.result);
      const i = s.indexOf(',');
      resolve(i >= 0 ? s.slice(i + 1) : s);
    };
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(blob);
  });
}

function base64ToBlob(b64, type) {
  const bin = atob(b64);
  const len = bin.length;
  const arr = new Uint8Array(len);
  for (let i = 0; i < len; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: type || 'application/octet-stream' });
}
