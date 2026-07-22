// =========================================================================
// index.js — Love Book Phase 2 本机后端入口
// 单资源 API：GET/PUT /api/data（整个 blob 作为一个资源）。
// 本步不做鉴权、不做 SSE、不做动作化 RPC——那是后续 milestone。
// 状态机单源：import 前端 scripts/status-machine.js + schema.js 做派生兜底。
// =========================================================================
import express from 'express';
import cors from 'cors';
import { readAll, writeAll, reseed } from './db.js';
import { register as sseRegister, broadcastChanged, startHeartbeat } from './sse.js';

const app = express();
const PORT = process.env.PORT || 3000;

// 前端跑在 localhost:8000（python -m http.server），允许跨域带凭证
app.use(cors({
  origin: [/^http:\/\/localhost(:\d+)?$/, /^http:\/\/127\.0\.0\.1(:\d+)?$/],
  credentials: true,
}));
app.use(express.json({ limit: '50mb' })); // 附件 base64 打包后可能较大

// GET /api/data → 返整个 blob
app.get('/api/data', (req, res) => {
  try {
    const blob = readAll();
    if (!blob) return res.status(404).json({ error: '无数据' });
    res.json(blob);
  } catch (e) {
    console.error('[GET /api/data]', e);
    res.status(500).json({ error: e.message });
  }
});

// —— PUT /api/data 整 blob 覆盖 ——
// 服务端做一次不变量重算兜底：每条 entry migrateEntry + computeStatus（INV-1）。
// 本步身份硬编码，权限校验留给后续 M2。
app.put('/api/data', (req, res) => {
  try {
    const blob = req.body;
    if (!blob || !Array.isArray(blob.entries)) {
      return res.status(400).json({ error: '请求体需含 entries 数组' });
    }
    const reseeded = reseed(blob); // 强制 status 派生 + 补齐 collections
    writeAll(reseeded);
    // 先回写者本人响应：让 httpBackend.writeAll 的 cached 在收到自己的 SSE echo 前就绪，
    // 消除「echo 到达时 cached 还是旧值 → reload 把 cache 设成 stale / null 窗口」。
    res.json(reseeded);
    // 广播 data-changed 给所有 SSE 连接（含写者本机，前端接受回环多刷一次）
    try {
      broadcastChanged({ source: 'put:/api/data' });
    } catch (e) { console.error('[SSE broadcast]', e); }
  } catch (e) {
    console.error('[PUT /api/data]', e);
    res.status(500).json({ error: e.message });
  }
});

// —— SSE 推送端点（M3）——
// 客户端 EventSource 订阅此处；写成功后上面 broadcastChanged 向所有连接推 data-changed。
// 不缓存、不压缩、keep-alive；心跳由 startHeartbeat() 在进程启动时开启（sse.js 内 15s comment 帧）。
app.get('/api/events', (req, res) => {
  sseRegister(res);
});

// —— 健康检查 ——
app.get('/api/health', (req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

// SSE 心跳保活（15s comment 帧，防空闲断）
startHeartbeat();

app.listen(PORT, () => {
  console.log(`\n  ❤  Love Book 后端已启动`);
  console.log(`     本机：http://localhost:${PORT}`);
  console.log(`     SSE 订阅：http://localhost:${PORT}/api/events`);
  console.log(`     前端开 http://localhost:8000/?cloud=1 连接此后端\n`);
});
