// =========================================================================
// index.js — Love Book Phase 2 本机后端入口
// 单资源 API：GET/PUT /api/data（整个 blob 作为一个资源）。
// 本步不做鉴权、不做 SSE、不做动作化 RPC——那是后续 milestone。
// 状态机单源：import 前端 scripts/status-machine.js + schema.js 做派生兜底。
// 部署：Express 同时托管前端静态文件（server/ 上一级 love/ 根目录），
// 整个 app 单一 HTTP 源 http://host:3000 —— 无混合内容、无需证书。
// =========================================================================
import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { readAll, writeAll, reseed } from './db.js';
import { register as sseRegister, broadcastChanged, startHeartbeat } from './sse.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..'); // love/ 根目录（前端在这）

const app = express();
const PORT = process.env.PORT || 3000;

// 前端同源托管时不需要跨域；保留 localhost 跨域仅用于本机开发（python http.server 8000）
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
// 注意：Express/Node 默认 requestTimeout/headerTimeout 会杀掉长连接 + cloudflared 走 IPv6
// localhost 时连接被 forcibly closed。这里显式豁免超时，让 SSE 长连接存活。
app.get('/api/events', (req, res) => {
  req.setTimeout(0);                 // 不因空闲超时关闭 SSE
  res.writeHead = res.writeHead;      // noop, keep
  sseRegister(res);
});

// —— 健康检查 ——
app.get('/api/health', (req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

// SSE 心跳保活（15s comment 帧，防空闲断）
startHeartbeat();

// —— 前端静态托管（同源：单一 HTTP 源，避 GitHub Pages HTTPS 混合内容拦截）——
// /api/* 路由已在上面注册优先；这里托管 server/ 上一级 love/ 根目录所有静态文件。
// no-cache：每次校验 ETag，确保前端改动立即可见（避免浏览器强缓存旧 httpBackend.js 导致
// cloud 模式算错 API 地址、写入静默失败、用户以为"不同步"）。
app.use(express.static(ROOT, {
  etag: true,
  lastModified: true,
  maxAge: 0,
  setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache, must-revalidate'),
}));
// SPA fallback：根路径与未匹配的 GET 一律回 index.html；但仅当文件存在时（否则 404）
app.get(/^\/(?!api\/|attachments\/|favicon).*/, (req, res) => {
  const idx = join(ROOT, 'index.html');
  if (existsSync(idx)) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(readFileSync(idx));
  } else {
    res.status(404).send('index.html not found at ' + idx);
  }
});

const server = app.listen(PORT, () => {
  console.log(`\n  ❤  Love Book 已启动（后端 + 前端同源托管）`);
  console.log(`     访问：http://localhost:${PORT}/?cloud=1`);
  console.log(`     SSE 订阅：http://localhost:${PORT}/api/events\n`);
});

// SSE 长连接豁免：Node 默认 requestTimeout/headerTimeout/keepAliveTimeout 会杀长连接，
// 经 cloudflared 时表现为 "connection forcibly closed by remote" / stream canceled。置 0 关闭。
server.requestTimeout = 0;
server.headersTimeout = 0;
server.keepAliveTimeout = 0;
server.timeout = 0;
