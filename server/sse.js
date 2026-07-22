// =========================================================================
// sse.js — SSE 推送层（M3）
// 维护一条 /api/events 的活跃连接集合，PUT /api/data 成功后向所有连接
// 广播 data-changed 事件，让其他浏览器 EventSource 收到 → store.reload()。
// 本步内存版：进程重启不重放历史事件（M5+ 再加 events 表持久化）。
// =========================================================================

// 活跃连接集合：每个元素是 Express Response 对象（已 flushHeaders 的 SSE 流）
const clients = new Set();

// 心跳间隔（ms）。15s 足够保活，又能早于 Cloudflare/Express 默认空闲断开。
const HEARTBEAT_MS = 15000;

// —— 将一条 SSE 帧写入一个 response，再 flush ——
function writeFrame(res, { event = null, data = '', comment = null } = {}) {
  if (res.destroyed || res.writableEnded) return;
  let frame = '';
  if (comment) frame += `: ${comment}\n`;
  if (event) frame += `event: ${event}\n`;
  // data 多行需每行加 "data: " 前缀（SSE 规范）；本步 data 都是单行 JSON
  if (data !== null && data !== undefined) {
    const str = typeof data === 'string' ? data : JSON.stringify(data);
    frame += str.split('\n').map(line => `data: ${line}`).join('\n');
  }
  frame += '\n\n';
  res.write(frame);
  // 显式 flush：压缩/缓冲中间件可能拖延写出，导致客户端收不到
  if (typeof res.flushHeaders === 'function') {
    try { res.flushHeaders(); } catch (_) {}
  }
}

// —— 注册一个新连接 ——
// 由 index.js 的 GET /api/events 路由调用。返回一个清理函数（连接断开时调用）。
export function register(res) {
  // SSE 必需头：text/event-stream + 不缓存 + 关闭压缩中间件（nginx x-accel 等也靠这俩）
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    // 告诉下游代理：不要缓冲本响应
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();

  // 顺序很关键：先入集合 + 挂 close/error 清理，再发 hello 帧。
  // 否则若 hello 写出与 close 触发之间落在 add 之前，会漏清理（极端但可能）。
  clients.add(res);

  // 连接清理：客户端关 tab / 网络断 → req close；socket error（半开/reset 等）→ error
  const cleanup = () => {
    clients.delete(res);
    try { if (!res.writableEnded) res.end(); } catch (_) {}
  };
  res.on('close', cleanup);
  res.on('error', cleanup);

  // 立即发一帧 hello，让前端 EventSource onopen 尽快触发（此时清理已就位）
  writeFrame(res, { event: 'hello', data: { ts: Date.now() } });

  return cleanup;
}

// —— 广播 data-changed 给所有活跃客户端 ——
// payload: { actorId?, entryId?, ts } —— 本步 actorId 自写去重仍在前端做（接受回环）
export function broadcastChanged(payload = {}) {
  if (!clients.size) return;
  const frame = {
    event: 'data-changed',
    data: { ts: Date.now(), ...payload },
  };
  // per-client try/catch：单个坏连接（socket reset / half-open / EPIPE）write 同步抛错
  // 不能中断整个广播，否则排在该 client 之后的其它 tab 收不到 data-changed（M3 多 tab
  // 同步验收目标）。出错即清出集合 + 主动 destroy，继续下一个。
  for (const res of clients) {
    try {
      writeFrame(res, frame);
    } catch (e) {
      clients.delete(res);
      try { res.destroy(); } catch (_) {}
    }
  }
}

// —— 心跳：定时向所有连接写 comment 帧（": ping\n\n"），保活防空闲断 ——
// 单一 timer，进程级；只在有活跃连接时才有意义（空集合也写无副作用）。
let heartbeatTimer = null;
export function startHeartbeat() {
  if (heartbeatTimer) return;
  heartbeatTimer = setInterval(() => {
    if (!clients.size) return;
    const frame = { comment: `heartbeat ${new Date().toISOString()}` };
    for (const res of clients) {
      try {
        writeFrame(res, frame);
      } catch (e) {
        clients.delete(res);
        try { res.destroy(); } catch (_) {}
      }
    }
  }, HEARTBEAT_MS);
  // Node 进程退出时不挡
  if (heartbeatTimer.unref) heartbeatTimer.unref();
}

export function getClientCount() { return clients.size; }
