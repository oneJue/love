// =========================================================================
// store.js — 数据层（Phase 1：localStorage 单 blob 持久化 + 抽象边界）
// Phase 2：把 backend 换成 httpBackend（fetch /api），客户端调用方零重写。
// 所有写操作经 commit() 集中：RMW 取最新 → 应用变更 → history 追加 →
// computeStatus 重算（INV-1）→ resolutionDate 兜底（INV-6）→ 落盘 → 广播 store:changed。
// =========================================================================

import { computeStatus, STATES, setAgreementText, setConfirmed, unconfirm } from './status-machine.js';
import { makeEntry, genId, migrateEntry, sideLabel } from './schema.js';
// httpBackend 既暴露 backend 接口，也暴露 SSE 注入口 setReloadCallback/connectSSE。
// httpBackend 不能 import store 的 reload（store 已 import httpBackend → 循环依赖），
// 故由 store 反向注入 reload 回调 + 主动开 EventSource。
import { httpBackend, setReloadCallback, connectSSE, startPolling } from './httpBackend.js';
import { sameId } from './util.js';

const KEY_DATA = 'love:data';
const KEY_MESIDE = 'love:meSide';
const KEY_MODE = 'love:comm-mode';

let cache = null;
let nowProvider = () => new Date().toISOString();

// —— 默认 localStorage backend ——
const localStorageBackend = {
  readAll() {
    const raw = localStorage.getItem(KEY_DATA);
    if (raw == null) return null;
    return JSON.parse(raw);
  },
  writeAll(blob) {
    localStorage.setItem(KEY_DATA, JSON.stringify(blob));
  },
  upsertEntry(entry) {
    const blob = this.readAll() || { entries: [] };
    const i = blob.entries.findIndex(e => sameId(e.id, entry.id));
    if (i >= 0) blob.entries[i] = entry;
    else blob.entries.push(entry);
    blob.updatedAt = nowProvider().slice(0, 10);
    this.writeAll(blob);
  },
};

let backend = localStorageBackend;

// 云端模式探测：URL 带 cloud=1 则切 httpBackend（本机跑通用）。
// 不带则保持 localStorage 单机模式，回退完整。
if (typeof location !== 'undefined' && location.search && location.search.includes('cloud=1')) {
  backend = httpBackend;
  // 反向注入 reload 给 httpBackend，并开 SSE 订阅。
  // 用微任务延迟 connect，确保 reload/reloadCallback 引用的绑定已就绪（function 声明已提升，
  // 但延迟到事件循环空转后建立 EventSource 更稳，避开首屏 boot 的 fetch 还在 in-flight）。
  setReloadCallback(reload);          // 由 reload() 内部广播驱动渲染层刷新
  // SSE 在 Quick Tunnel 下不透传，但轮询兜底保证同步。两者并存。
  Promise.resolve().then(() => {
    try { connectSSE(); } catch (e) { console.warn('[store] SSE 连接失败', e); }
    try { startPolling(); } catch (e) { console.warn('[store] 轮询启动失败', e); }
  });
}

// 同步读 cache：供 app.js renderHome 等绕过 load() 直读的地方用
export function getCachedSync() {
  return cache;
}

// —— 订阅 ——
const listeners = new Set();
export function onStoreChanged(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
function broadcast(entryId) {
  for (const cb of listeners) {
    try { cb(entryId); } catch (e) { console.error(e); }
  }
  // 跨 tab：native storage 事件由 app 层各自处理；同 tab 用 CustomEvent
  try { window.dispatchEvent(new CustomEvent('store:changed', { detail: { entryId } })); } catch (_) { /* ssr/jsdom 无 window */ }
}

// —— 身份 / 模式 ——
export function getMeSide() {
  return localStorage.getItem(KEY_MESIDE) || 'male';
}
export function setMeSide(side) {
  localStorage.setItem(KEY_MESIDE, side);
}
export function getCommMode() {
  return localStorage.getItem(KEY_MODE) || 'comm';
}
export function setCommMode(m) {
  localStorage.setItem(KEY_MODE, m);
}

// —— 抽象边界 / 测试注入口子 ——
export function setBackend(impl) { backend = impl; }
export function setNowProvider(fn) { nowProvider = fn; }

// —— 读 ——
export async function load() {
  if (cache) return cache;
  let blob = null;
  try { blob = await backend.readAll(); }
  catch (e) { blob = null; } // JSON 损坏 / 后端不可达：备份后回退种子
  if (!blob) {
    // 首次 / 损坏 → fetch data.json 种子
    const res = await fetch('data.json', { cache: 'no-store' });
    if (!res.ok) throw new Error(`加载数据失败：HTTP ${res.status}`);
    blob = await res.json();
    if (!blob.entries) blob.entries = [];
    blob.entries = blob.entries.map(migrateEntry);
    normalizeCollections(blob);
    try { await backend.writeAll(blob); } catch (_) {}
  } else {
    if (!blob.entries) blob.entries = [];
    blob.entries = blob.entries.map(migrateEntry);
    normalizeCollections(blob);
  }
  cache = blob;
  return cache;
}

export async function reload() {
  cache = null;
  const blob = await load();
  // 关键：reload 后必须广播，否则渲染层（onStoreChanged 回调，app.js:39 /
  // comm-book.js:33）不会重渲染 → 云模式实时刷新断环。传 null 表示全量刷新。
  // 自写触发的回环 reload 也会走到这里 → 多刷一次，UI 无害（M3 接受）。
  broadcast(null);
  return blob;
}

export function getEntry(id) {
  if (!cache) return null;
  return cache.entries.find(e => sameId(e.id, id)) || null;
}

export function listEntries() {
  return cache ? cache.entries.slice() : [];
}

// —— 写：集中编排 ——
function assertMeSide(side) {
  if (getMeSide() !== side) {
    throw new Error(`当前以${sideLabel(getMeSide())}身份，无法操作对方侧`);
  }
}

/**
 * 唯一变更入口（除 createEntry 直写）。
 * mutator 改 next 对象；summary 进入 history（禁止含"同意"二字）。
 */
async function commit(entry, summary, mutator) {
  const next = structuredCloneSafe(entry);
  mutator(next);
  if (summary) {
    if (summary.includes('同意')) throw new Error('history.summary 禁止包含"同意"二字');
    if (!Array.isArray(next.history)) next.history = [];  // R2-6: 防御未来直写路径漏 migrate 的非数组 history
    next.history.push({ at: nowProvider(), by: sideLabel(getMeSide()), summary });
  }
  // 派生永远赢（INV-1）
  next.status = computeStatus(next);
  next.updatedAt = nowProvider();                         // INV-10
  if (next.status !== '已和解') next.resolutionDate = null; // INV-6
  if (next.shelvedFrom !== null && !STATES.slice(0, 4).includes(next.shelvedFrom)) next.shelvedFrom = null; // INV-5
  await backend.upsertEntry(next);
  // 同步内存 cache
  if (cache) {
    const i = cache.entries.findIndex(e => sameId(e.id, next.id));
    if (i >= 0) cache.entries[i] = next;
  }
  broadcast(next.id);
  return next;
}

function structuredCloneSafe(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function normalizeCollections(blob) {
  for (const key of ['timeline', 'messages', 'photos', 'anniversaries']) {
    if (!Array.isArray(blob[key])) blob[key] = [];
  }
  return blob;
}

function nextRecordId(items) {
  return items.reduce((max, item) => typeof item.id === 'number' ? Math.max(max, item.id) : max, 0) + 1;
}

async function updateData(topic, mutator) {
  await load();
  const next = structuredCloneSafe(cache);
  mutator(next);
  normalizeCollections(next);
  next.updatedAt = nowProvider().slice(0, 10);
  await backend.writeAll(next);
  cache = next;
  broadcast(topic);
  return next;
}

// —— 写函数 ——
export async function createEntry(input = {}) {
  await load();
  const all = listEntries();
  const meSide = getMeSide();
  const label = sideLabel(meSide);
  const today = nowProvider().slice(0, 10);
  const raisedBy = input.raisedBy || label;
  const entry = makeEntry({
    title: input.title,
    occurrenceDate: input.occurrenceDate || today,
    raisedBy,
    severity: input.severity || '一般',
    tags: input.tags || [],
    description: input.description || '',
  });
  entry.id = genId(all);  // 有序数字 1,2,3…；必传 existing 防冲突（INV-11）
  const now = nowProvider();
  if (input.description) {
    entry.description = { text: input.description, updatedAt: now, updatedBy: label };
  }
  if (input.view) {
    entry[`${meSide}View`] = { text: input.view, updatedAt: now, writtenBy: label };
  }
  if (input.coLocated && input.viewOther) {
    const other = meSide === 'male' ? 'female' : 'male';
    entry[`${other}View`] = { text: input.viewOther, updatedAt: now, writtenBy: sideLabel(other) };
  }
  // createEntry 已在 makeEntry 内 push 了"创建条目" history[0]
  if (cache) cache.entries.push(entry);
  await backend.upsertEntry(entry);
  broadcast(entry.id);
  return entry;
}

export async function writeView(entryId, side, text) {
  assertMeSide(side);
  const entry = getEntry(entryId);
  if (!entry) throw new Error('条目不存在');
  return commit(entry, side === 'male' ? '男方补充视角' : '女方补充视角', e => {
    e[`${side}View`] = { text, updatedAt: nowProvider(), writtenBy: sideLabel(side) };
  });
}

// —— 事实层：description 与 attachments 任一方可写（共同事实底，非各侧隔离）——
export async function writeDescription(entryId, side, text) {
  const entry = getEntry(entryId);
  if (!entry) throw new Error('条目不存在');
  return commit(entry, side === 'male' ? '男方更新事件描述' : '女方更新事件描述', e => {
    e.description = { text, updatedAt: nowProvider(), updatedBy: sideLabel(side) };
  });
}

// meta: { id, name, type, size, storeKey } 由 attachments.js 落完 blob 后传入
export async function addAttachment(entryId, side, meta) {
  const entry = getEntry(entryId);
  if (!entry) throw new Error('条目不存在');
  return commit(entry, `添加附件：${meta.name || ''}`, e => {
    e.attachments = e.attachments || [];
    e.attachments.push({ ...meta, addedBy: sideLabel(side), addedAt: nowProvider() });
  });
}

export async function removeAttachment(entryId, side, attId) {
  const entry = getEntry(entryId);
  if (!entry) throw new Error('条目不存在');
  const found = (entry.attachments || []).find(a => sameId(a.id, attId));
  if (!found) throw new Error('附件不存在');
  // 删 IDB blob（attachments.js 处理，store 只清元数据并留痕）
  return commit(entry, `移除附件：${found.name || ''}`, e => {
    e.attachments = (e.attachments || []).filter(a => !sameId(a.id, attId));
  });
}

export async function writeNote(entryId, side, text) {
  assertMeSide(side);
  const entry = getEntry(entryId);
  if (!entry) throw new Error('条目不存在');
  return commit(entry, side === 'male' ? '男方更新附言' : '女方更新附言', e => {
    e[`${side}Note`] = { text, updatedAt: nowProvider() };
  });
}

export async function writeAgreement(entryId, side, text) {
  // 任一方可写；side 仅用于留痕
  const entry = getEntry(entryId);
  if (!entry) throw new Error('条目不存在');
  const changed = (entry.agreement && entry.agreement.text) !== text;
  return commit(
    entry,
    changed ? '修改共同约定（确认已重置）' : '保存共同约定',
    e => {
      Object.assign(e, setAgreementText(e, text)); // 复位 confirmations + 清 resolutionDate
      e.agreement.updatedAt = nowProvider();
      e.agreement.updatedBy = sideLabel(side);
    }
  );
}

export async function setMyConfirm(entryId, side) {
  assertMeSide(side);
  const entry = getEntry(entryId);
  if (!entry) throw new Error('条目不存在');
  const cur = entry.confirmations && entry.confirmations[side];
  if (cur && cur.confirmed) return entry; // 幂等
  const now = nowProvider();
  const updated = await commit(entry, side === 'male' ? '男方确认' : '女方确认', e => {
    e.confirmations = setConfirmed(e, side, now);
  });
  if (computeStatus(updated) === '已和解') {
    // 第二枚确认 → 写 resolutionDate（INV-6）
    const resoled = await commit(updated, '达成和解，归档', e => {
      e.resolutionDate = now.slice(0, 10);
    });
    return resoled;
  }
  return updated;
}

export async function unconfirmMine(entryId, side) {
  assertMeSide(side);
  const entry = getEntry(entryId);
  if (!entry) throw new Error('条目不存在');
  if (computeStatus(entry) === '已和解') {
    throw new Error('已和解不可单方撤回确认，请走重新打开');
  }
  return commit(entry, side === 'male' ? '男方撤回确认' : '女方撤回确认', e => {
    e.confirmations = unconfirm(e, side);
  });
}

export async function shelveEntry(entryId, side, reason) {
  const entry = getEntry(entryId);
  if (!entry) throw new Error('条目不存在');
  if (computeStatus(entry) === '已搁置') throw new Error('已搁置，不可二次搁置');
  return commit(entry, `搁置：${reason || '未说明'}`, e => {
    e.shelvedFrom = computeStatus(e); // 捕获搁置前状态
    e.shelvedReason = reason || '先放放';
  });
}

export async function restoreEntry(entryId, side) {
  const entry = getEntry(entryId);
  if (!entry) throw new Error('条目不存在');
  if (computeStatus(entry) !== '已搁置') throw new Error('仅已搁置可重新激活');
  return commit(entry, '重新激活搁置条目', e => {
    e.shelvedFrom = null;
    e.shelvedReason = null;
  });
}

export async function reopenEntry(entryId, side) {
  const entry = getEntry(entryId);
  if (!entry) throw new Error('条目不存在');
  if (computeStatus(entry) !== '已和解') throw new Error('仅已和解可重新打开');
  return commit(entry, '重新打开已和解条目', e => {
    e.agreement = { ...(e.agreement || {}), text: '', updatedAt: nowProvider(), updatedBy: sideLabel(side) };
    e.confirmations = { male: { confirmed: false, at: null }, female: { confirmed: false, at: null } };
    e.resolutionDate = null;
  });
}

export async function deleteEntryIfFresh(entryId) {
  const entry = getEntry(entryId);
  if (!entry) throw new Error('条目不存在');
  const ageMs = Date.now() - new Date(entry.createdAt).getTime();
  if (ageMs > 10000) throw new Error('创建超过 10 秒，不可删除（保护：永不硬删）');
  if (entry.history && entry.history.length > 1) throw new Error('已有操作历史，不可删除');
  if (cache) cache.entries = cache.entries.filter(e => !sameId(e.id, entryId));
  const blob = await backend.readAll();
  if (blob) {
    blob.entries = (blob.entries || []).filter(e => !sameId(e.id, entryId));
    await backend.writeAll(blob);
  }
  broadcast(entryId);
}

// —— 时光 / 留言 / 相册 ——
export async function createTimelineItem(input = {}) {
  const title = String(input.title || '').trim();
  const date = String(input.date || '').trim();
  if (!title) throw new Error('请填写时光标题');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('请选择有效日期');
  let created = null;
  await updateData('timeline', blob => {
    created = {
      id: nextRecordId(blob.timeline),
      title,
      date,
      kind: input.kind || '其它',
      desc: String(input.desc || '').trim(),
      createdAt: nowProvider(),
      createdBy: sideLabel(getMeSide()),
    };
    blob.timeline.push(created);
  });
  return created;
}

// —— 纪念日 ——
// schema 顶层 anniversaries:[] 有首页倒计时渲染(app.js) 但 R3 之前零编辑入口零写函数=死字段。
// 此处补 upsert/remove，经 updateData('anniversaries',...)（normalizeCollections 已含该 key；nextRecordId 复用）。
export async function upsertAnniversary(input = {}) {
  const title = String(input.title || '').trim();
  const date = String(input.date || '').trim();
  if (!title) throw new Error('请填写纪念日名称');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('请选择有效日期');
  const recurring = Boolean(input.recurring);
  const hasId = input.id != null;
  const id = hasId ? input.id : null;
  let result = null;
  await updateData('anniversaries', blob => {
    if (hasId) {
      const i = blob.anniversaries.findIndex(a => sameId(a.id, id));
      if (i >= 0) {
        blob.anniversaries[i] = { ...blob.anniversaries[i], title, date, recurring };
        result = blob.anniversaries[i];
        return;
      }
      // R5-s1(姊妹): 编辑路径指定 id 不存在（SSE 重载/另一 tab 删了该 id）→ throw，
      // 防止用残留 id 重新 push 一条复活已删 id（违反「id 只增不减」invariant）。
      // memory-editor.js 的 try/catch 已统一接住走 inline-error。新建走不带 id 路径不受影响。
      throw new Error('纪念日不存在，请刷新');
    }
    const created = {
      id: hasId ? id : nextRecordId(blob.anniversaries),
      title,
      date,
      recurring,
      createdAt: nowProvider(),
      createdBy: sideLabel(getMeSide()),
    };
    blob.anniversaries.push(created);
    result = created;
  });
  return result;
}

export async function removeAnniversary(id) {
  await updateData('anniversaries', blob => {
    blob.anniversaries = blob.anniversaries.filter(a => !sameId(a.id, id));
  });
}

export async function updateRelationshipProfile(input = {}) {
  const startDate = String(input.startDate || '').trim();
  const male = String(input.maleName || '').trim() || '他';
  const female = String(input.femaleName || '').trim() || '她';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) throw new Error('请选择开始日期');
  const [year, month, day] = startDate.split('-').map(Number);
  const parsed = new Date(year, month - 1, day);
  if (parsed.getFullYear() !== year || parsed.getMonth() !== month - 1 || parsed.getDate() !== day) {
    throw new Error('开始日期无效');
  }
  if (startDate > nowProvider().slice(0, 10)) throw new Error('开始日期不能晚于今天');
  await updateData('profile', blob => {
    blob.meta = blob.meta || {};
    blob.meta.startDate = startDate;
    blob.meta.anniversaryName = String(input.anniversaryName || '').trim() || '在一起';
    blob.meta.partnerNames = { male, female };
  });
  return cache.meta;
}

export function isMessageUnread(message, side = getMeSide()) {
  const label = sideLabel(side);
  if (!message || message.from === label) return false;
  if (message.to !== '双方' && message.to !== label) return false;
  if (message.readBy && message.readBy[side]) return false;
  return !message.readAt;
}

export async function createMessage(input = {}) {
  const text = String(input.text || '').trim();
  if (!text) throw new Error('写一句想说的话吧');
  const meSide = getMeSide();
  const to = input.to === '双方' ? '双方' : sideLabel(meSide === 'male' ? 'female' : 'male');
  let created = null;
  await updateData('messages', blob => {
    created = {
      id: nextRecordId(blob.messages),
      from: sideLabel(meSide),
      to,
      text,
      mood: input.mood || '日常',
      pinned: Boolean(input.pinned),
      createdAt: nowProvider(),
      readBy: { male: meSide === 'male' ? nowProvider() : null, female: meSide === 'female' ? nowProvider() : null },
      readAt: null,
    };
    blob.messages.push(created);
  });
  return created;
}

export async function markMessagesRead(side = getMeSide()) {
  await load();
  const unread = cache.messages.filter(message => isMessageUnread(message, side));
  if (!unread.length) return 0;
  const ids = new Set(unread.map(message => String(message.id)));
  const now = nowProvider();
  await updateData('messages', blob => {
    blob.messages.forEach(message => {
      if (!ids.has(String(message.id))) return;
      message.readBy = { male: null, female: null, ...(message.readBy || {}), [side]: now };
    });
  });
  return unread.length;
}

// R4 F4: 置顶切换——翻转某条留言的 pinned 字段并落盘广播。
// 与 createMessage 一致走 updateData('messages')，onStoreChanged 订阅（messages.js:17）
// 落盘后自动重渲染，无需调用方手挂。任一方可翻，与 createMessage 的 from=meLabel 一致语义。
export async function toggleMessagePin(id) {
  await load();
  await updateData('messages', blob => {
    const message = blob.messages.find(m => sameId(m.id, id));
    // R5-s1: 找不到 id（残留旧 id / 删重置后点置顶按钮）直接 throw，让 messages.js:61 的 .catch(toastErr) 兜底提示；
    // 原来静默 no-op 会让用户以为按钮失灵。
    if (!message) throw new Error('留言不存在');
    message.pinned = !message.pinned;
  });
}

export async function createPhoto(meta = {}, input = {}) {
  if (!meta.storeKey || !meta.type || !meta.type.startsWith('image/')) throw new Error('请选择有效图片');
  let created = null;
  await updateData('photos', blob => {
    created = {
      id: nextRecordId(blob.photos),
      ...meta,
      caption: String(input.caption || '').trim(),
      date: String(input.date || nowProvider().slice(0, 10)),
      addedAt: nowProvider(),
      addedBy: sideLabel(getMeSide()),
    };
    blob.photos.push(created);
  });
  return created;
}

// —— 备份 / 重置 ——
export async function exportJSON() {
  const blob = await load();
  const exported = structuredCloneSafe(blob);
  const { exportAttachmentsBundle } = await import('./attachments.js');
  const bundle = await exportAttachmentsBundle(exported.entries, exported.photos);
  if (Object.keys(bundle).length) exported.attachmentBundle = bundle;
  return JSON.stringify(exported, null, 2);
}

export async function importFromJSON(jsonStr) {
  const blob = JSON.parse(jsonStr);
  if (!blob || !Array.isArray(blob.entries)) throw new Error('导入文件格式不正确');
  const attachmentBundle = blob.attachmentBundle;
  delete blob.attachmentBundle;
  blob.entries = blob.entries.map(migrateEntry);
  normalizeCollections(blob);
  if (attachmentBundle) {
    const { importAttachmentsBundle } = await import('./attachments.js');
    await importAttachmentsBundle(attachmentBundle);
  }
  await backend.writeAll(blob);
  cache = blob;
  broadcast(null);
  return blob;
}

export async function resetToSeed() {
  cache = null;
  try { localStorage.removeItem(KEY_DATA); } catch (_) {}
  return load();
}
