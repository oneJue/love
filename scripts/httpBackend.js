// =========================================================================
// httpBackend.js — 云端后端实现（Phase 2 + M3 SSE 订阅）
// 实现 store.js 期望的 backend 接口（readAll/writeAll/upsertEntry），
// 但用 fetch 走 http://localhost:3000（本步）/ 后续 Cloudflare Tunnel 域。
// 因为 fetch 异步，store.js 那几处调用点必须 await（见 store.js 改造）。
// 本步用整 blob 单资源（GET/PUT /api/data），不做动作化 RPC。
// M3：开 EventSource 订阅 /api/events，收到 data-changed → 调注入的 reload。
//   注：httpBackend 不能直接 import store.js 的 reload（store 已 import httpBackend →
//   循环依赖）。故暴露 setReloadCallback(fn)，由 store.js 顶层注入 reload。
// =========================================================================

import { sameId } from './util.js';

// 同源相对路径：前端由 Express 同源托管（或经 Cloudflare Tunnel 暴露整源），
// /api 就在当前页同源下，不写 host:port。这样 localhost、IP、tunnel 域都自动对，
// 且 https 页面 fetch 相对路径无混合内容拦截。
const API = '/api';

// SSE events 端点同源：/api/events
const EVENTS_URL = `${API}/events`;

// 内存 cache：readAll 同步返回（store.js load() 会 await，但 getEntry/listEntries
// 同步读 cache），所以这里维护一份同步可读副本。
let cached = null;

// 由 store.js 注入的 reload 回调（避免循环依赖）
let reloadCallback = null;
export function setReloadCallback(fn) {
  reloadCallback = typeof fn === 'function' ? fn : null;
}

// 防抖：SSE 短时间可能连发多帧（心跳不会触发 data-changed，但写者自己的 PUT 回环 +
// 其他客户端 PUT 可能叠在 in-flight reload 上）。合并到一次 reload，避免抖动。
// 关键：reload 进行中到达的 data-changed 不能丢——若本次 reload 的 GET 已在飞行中、
// 响应不含该次写入，丢帧会让 UI 永久 stale，直到下一帧才补回。用 needsAnother 标志：
// reload 完成后若期间有过新帧则再排一次，确保最终一致。
let pendingReload = null;
let needsAnother = false;
function scheduleReload() {
  if (!reloadCallback) return;
  if (pendingReload) { needsAnother = true; return; } // 复用本次，但记下需补一次
  pendingReload = Promise.resolve()
    .then(() => reloadCallback())
    .catch(e => console.error('[httpBackend] SSE reload 失败', e))
    .finally(() => {
      pendingReload = null;
      const again = needsAnother;
      needsAnother = false;
      if (again) scheduleReload(); // 期间有过新帧 → 再拉一次
    });
}

// —— 同步兜底：轮询 ——
// Quick Tunnel（HTTP/2）不透传 SSE 流式帧（cloudflared 日志 stream canceled），
// 浏览器 EventSource 收不到任何事件。故加轮询兜底：定时 reload 拉最新数据。
// 仍保留 SSE：若将来 Named Tunnel 透传 SSE，两边并存谁通谁生效（轮询幂等，重复 reload 无害）。
const POLL_MS = 3000; // 3s 延迟换可靠性
let pollTimer = null;
export function startPolling() {
  if (typeof window === 'undefined') return; // 浏览器外跳过
  if (pollTimer) return; // 幂等
  pollTimer = setInterval(() => {
    // 只在该页签可见时轮询，省流量；后台 tab 暂停（document.visibilityState 切回可见时首次立即拉）
    if (document.visibilityState === 'visible') scheduleReload();
  }, POLL_MS);
  // tab 从后台切回前台立刻拉一次（错过期间的数据）
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') scheduleReload();
  });
}

// —— SSE 连接生命周期 ——
// 浏览器 EventSource 自带断线重连。这里只负责：开连接 → data-changed → scheduleReload。
// 挂在模块加载时（store.js 切到 httpBackend 时本模块已被 import）。
// 仅在浏览器环境 + 云模式由 store.js 触发 connectSSE() 启动；本模块不自行判断 cloud=1，
// 避免非云页面误开连接。
let eventSource = null;
export function connectSSE() {
  // 浏览器外（SSR/jsdom 测试）跳过
  if (typeof window === 'undefined' || typeof EventSource === 'undefined') return;
  if (eventSource) return; // 幂等
  try {
    eventSource = new EventSource(EVENTS_URL);
  } catch (e) {
    console.warn('[httpBackend] EventSource 创建失败', e);
    return;
  }
  eventSource.addEventListener('open', () => {
    // 开连即静默；hello 帧只确认链路，不触发 reload
  });
  eventSource.addEventListener('data-changed', (ev) => {
    // 收到他端（或自己回环）写入完成 → reload → broadcast → 渲染层刷新
    scheduleReload();
  });
  eventSource.addEventListener('error', () => {
    // 浏览器 EventSource 会自动重连（默认 ~3s 重试，服务端 503 时由 retry 字段节流）。
    // 断线期间不发 data-changed，不会有误 reload；in-flight optimistic cache 不受影响。
    // 此处仅保留钩子，待 M5 需要降级策略（如回退轮询）时接入。
  });
}

export const httpBackend = {
  async readAll() {
    const res = await fetch(`${API}/data`, { credentials: 'include' });
    if (!res.ok) throw new Error(`加载数据失败：HTTP ${res.status}`);
    cached = await res.json();
    return cached;
  },

  async writeAll(blob) {
    const res = await fetch(`${API}/data`, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(blob),
    });
    if (!res.ok) {
      const msg = await res.text().catch(() => '');
      throw new Error(`保存失败：HTTP ${res.status} ${msg}`);
    }
    cached = await res.json();
    return cached;
  },

  // 本步走 writeAll 整 blob 细粒度由 store.commit/updateData 编排，
  // upsertEntry 直接转 writeAll(cache) ——因 store.js 在 commit 里已 mutate cache。
  async upsertEntry(entry) {
    if (!cached) throw new Error('cache 未初始化：先 load()');
    const idx = cached.entries.findIndex(e => sameId(e.id, entry.id));
    if (idx >= 0) cached.entries[idx] = entry;
    else cached.entries.push(entry);
    return this.writeAll(cached);
  },
};
