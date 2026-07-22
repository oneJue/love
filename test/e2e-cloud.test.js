// =========================================================================
// e2e-cloud.test.js — 云端路径端到端验证（需先启动后端）
// 驱动前端 store.js（httpBackend 模式）对真实后端跑完整沟通流程。
// 验证：A 记一笔 → B 读到 → B 补视角 → 起草约定 → A 确认 → B 确认 → 已和解 + resolutionDate
//
// ⚠ 依赖：先 `node server/index.js` 启动后端，再跑本测试。
// ⚠ 本测试不在 CI 默认套（会写真实后端 SQLite），手动运行：
//    node server/index.js &  →  node --test test/e2e-cloud.test.js
// =========================================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// —— 最小浏览器 mock —— { // （像 render-smoke 那样）
const ls = new Map();
globalThis.localStorage = {
  getItem: k => ls.has(k) ? ls.get(k) : null,
  setItem: (k, v) => ls.set(k, String(v)),
  removeItem: k => ls.delete(k),
};
globalThis.window = {
  localStorage,
  addEventListener: () => {},
  dispatchEvent: () => true,
};
globalThis.location = { hostname: 'localhost', search: '?cloud=1' }; // 触发 setBackend(httpBackend)
globalThis.fetch = globalThis.fetch || (async (url, opts = {}) => {
  // mock fetch 指向真实后端
  const http = await import('node:http');
  return new Promise((resolve, reject) => {
    const u = new URL(url, 'http://localhost:3000');
    const body = opts.body ? (typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body)) : null;
    const req = http.request({
      hostname: u.hostname, port: u.port || 3000, path: u.pathname + u.search,
      method: opts.method || 'GET',
      headers: opts.headers || (body ? { 'Content-Type': 'application/json' } : {}),
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({
        ok: res.statusCode >= 200 && res.statusCode < 300,
        status: res.statusCode,
        json: async () => JSON.parse(data),
        text: async () => data,
      }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
});

const { setBackend } = await import(path.join(ROOT, 'scripts/store.js'));
const { httpBackend } = await import(path.join(ROOT, 'scripts/httpBackend.js'));
setBackend(httpBackend); // 显式切云

const store = await import(path.join(ROOT, 'scripts/store.js'));
const { computeStatus } = await import(path.join(ROOT, 'scripts/status-machine.js'));

const NOW = '2026-07-21T12:00:00.000Z';
store.setNowProvider(() => NOW);

test('E2E 云端完整流程：A 记→B 读→补视角→约定→双确认→已和解', async () => {
  // 1. A（男方）记一笔
  store.setMeSide('male');
  const entry = await store.createEntry({
    title: '端到端测试事件',
    occurrenceDate: '2026-07-21',
    description: '客观事实描述',
    view: '男方视角',
    severity: '一般',
  });
  assert.equal(computeStatus(entry), '待沟通');

  // 2. reload 后 B（女方）应读到该笔（模拟 B 刷新拉取后端最新）
  await store.reload();
  store.setMeSide('female');
  const readBack = store.getEntry(entry.id);
  assert.ok(readBack, 'B 刷新后读到 A 记的条目');
  assert.equal(readBack.title, '端到端测试事件');

  // 3. B 补女方视角
  await store.writeView(entry.id, 'female', '女方视角');
  // 双方视角齐 + 无约定 → 沟通中
  assert.equal(computeStatus(store.getEntry(entry.id)), '沟通中');

  // 4. A 起草约定
  store.setMeSide('male');
  await store.writeAgreement(entry.id, 'male', '我们的约定内容');
  assert.equal(computeStatus(store.getEntry(entry.id)), '待确认');

  // 5. A 确认
  await store.setMyConfirm(entry.id, 'male');

  // 模拟 B 刷新拿到最新（A 的确认已落库）
  await store.reload();
  store.setMeSide('female');

  // 6. B 确认 → 应达已和解 + resolutionDate
  const final = await store.setMyConfirm(entry.id, 'female');
  assert.equal(computeStatus(final), '已和解');
  assert.ok(final.resolutionDate, '和解后 resolutionDate 已写入（第二段 commit 执行）');
  console.log('  ✅ 已和解，resolutionDate =', final.resolutionDate);

  // 7. B 自己再 GET 确认落库
  await store.reload();
  const persisted = store.getEntry(entry.id);
  assert.equal(computeStatus(persisted), '已和解');
  assert.ok(persisted.resolutionDate);
  console.log('  ✅ 落库确认：status=已和解，history 末条=', persisted.history.at(-1).summary);
});
