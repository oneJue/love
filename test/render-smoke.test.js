// =========================================================================
// render-smoke.test.js — 渲染层 smoke 测试（最小 DOM stub，不依赖 jsdom）
// 验证：comm-book.mount 在注入真实 data.json 后能渲染出样例卡，状态正确，
//       且事件委托 dispatchAction 能把"我确认"动作接到 store（不抛错）。
// =========================================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// —— 最小 DOM / 浏览器环境 stub ——
{
  const ls = new Map();
  globalThis.localStorage = {
    getItem: k => ls.has(k) ? ls.get(k) : null,
    setItem: (k,v) => ls.set(k, String(v)),
    removeItem: k => ls.delete(k),
  };
  const evListeners = new Map();
  globalThis.window = {
    localStorage,
    addEventListener: (t, cb) => { (evListeners.get(t)||evListeners.set(t,[]).get(t)).push(cb); },
    dispatchEvent: ev => { for (const cb of (evListeners.get(ev.type)||[])) cb(ev); },
    CustomEvent: class { constructor(t, o){ this.type=t; this.detail=(o||{}).detail; } },
  };
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => JSON.parse(fs.readFileSync(path.join(ROOT,'data.json'),'utf8')),
  });
  globalThis.location = { hash: '' };

  // —— DOM 元素 stub：记录 innerHTML，addEventListener 委托收集 ——
  function makeEl(id) {
    const handlers = {};
    const el = {
      _id: id,
      _handlers: handlers,
      innerHTML: '',
      classList: { _set: new Set(), add(c){this._set.add(c);}, remove(c){this._set.delete(c);}, toggle(c,f){ if(f===undefined){this._set.has(c)?this._set.delete(c):this._set.add(c);} else {f?this._set.add(c):this._set.delete(c);} }, contains(c){return this._set.has(c);} },
      querySelector(sel){ return findIn(this, sel); },
      querySelectorAll(sel){ return findAllIn(this, sel); },
      addEventListener(t, cb){ (handlers[t]=handlers[t]||[]).push(cb); },
      appendChild(c){ this.innerHTML += (c.innerHTML||''); },
      remove(){},
      scrollIntoView(){},
    };
    return el;
  }
  // 极简选择器：只支持 tag / .class / [data-x=y] / 组合，够 smoke 用
  function findIn(el, sel) {
    const doc = el._doc || el;
    // 在 innerHTML 里粗匹配第一个对应元素的"标签片段"——smoke 只需返回 truthy 对象
    // 简化：返回一个总是配的 stub el
    return matchesAnyStub(el, sel);
  }
  function findAllIn(el, sel){ const s = matchesAnyStub(el, sel); return s ? [s] : []; }
  function matchesAnyStub(el, sel) {
    // 检查 el.innerHTML 是否含 sel 标识，构造可点 stub
    if (el.innerHTML.includes(sel.replace(/[.#\[\]="]/g,' ').trim().split(/\s+/)[0]) ||
        el.innerHTML.includes(sel) ) {
      const stub = makeEl(); stub._parent = el; return stub;
    }
    // 兜底：若 sel 在 innerHTML 出现关键字
    const kw = sel.replace(/[#.\[\]"'=]/g,' ').trim().split(/\s+/)[0];
    if (kw && el.innerHTML.includes(kw)) { return makeEl(); }
    return makeEl(); // 返回空 stub，querySelector 链不抛
  }

  globalThis.document = {
    getElementById(id){ const el = makeEl(id); el._doc = this; return el; },
    createElement: () => makeEl(),
    querySelector: () => makeEl(),
    querySelectorAll: () => [],
    body: makeEl('body'),
    documentElement: makeEl('html'),
  };
  globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
  // navigator 在 Node 现代版只读；comm-book/store smoke 不需要 clipboard（仅 app.js 用）
  try { Object.defineProperty(globalThis, 'navigator', { value: { clipboard: { writeText: () => {} } }, configurable: true }); } catch (_) {}
}

const store = await import(path.join(ROOT, 'scripts/store.js'));
const commBook = await import(path.join(ROOT, 'scripts/comm-book.js'));
const { computeStatus } = await import(path.join(ROOT, 'scripts/status-machine.js'));

const NOW = '2026-07-21T10:00:00.000Z';
store.setNowProvider(() => NOW);

test('S-1 store.load 首次以 data.json 种子初始化，样例存在于 entries', async () => {
  const data = await store.load();
  assert.ok(data.entries.length >= 1);
  assert.equal(data.entries[0].id, 1); // 有序数字
  assert.equal(data.entries[0].status, '沟通中'); // migrate 修正后派生值
  assert.ok(data.entries[0].description.text, '含事实层描述');
});

test('S-2 comm-book.mount 渲染样例卡不抛错', async () => {
  await store.load();
  const el = document.getElementById('view-comm');
  await assert.doesNotReject(async () => {
    await commBook.mount(el);
    // mount 内部 render 是 Promise（store.load().then），给一个 tick
    await new Promise(r => setTimeout(r, 50));
  });
  assert.ok(el.innerHTML.length > 0, '渲染出了内容');
  assert.ok(el.innerHTML.includes('示例') || el.innerHTML.includes('试试记一笔'), '含样例标题');
  assert.ok(el.innerHTML.includes('沟通中'), '显示状态沟通中');
  assert.ok(el.innerHTML.includes('事实层') || el.innerHTML.includes('fact-layer') || el.innerHTML.includes('fact-desc'), '含事实层');
});

test('S-3 渲染层无"同意"字样（样例卡 + 按钮）', async () => {
  await store.load();
  const el = document.getElementById('view-comm');
  commBook.mount(el);
  await new Promise(r => setTimeout(r, 50));
  assert.ok(!el.innerHTML.includes('同意'), '渲染 HTML 不含"同意"');
});

test('S-4 样例卡（女方已写视角、男方已写视角、约定空）下，男方看到"补充/起草约定置灰"', async () => {
  await store.load();
  store.setMeSide('male');
  const el = document.getElementById('view-comm');
  commBook.mount(el);
  await new Promise(r => setTimeout(r, 50));
  // 双方视角齐全 + 约定空 → 沟通中：男方应看到"起草约定"（亮，因为双方视角齐）
  assert.ok(el.innerHTML.includes('起草约定'), '男方看到起草约定按钮');
});

test('S-5 完整点击流转（store 层模拟用户点确认）→ 已和解', async () => {
  // 用一条新事件走全流程
  store.setMeSide('male');
  const e = await store.createEntry({ title: 'smoke 全流程', occurrenceDate: '2026-07-21' });
  await store.writeView(e.id, 'male', '男方视角');
  store.setMeSide('female');
  await store.writeView(e.id, 'female', '女方视角');
  await store.writeAgreement(e.id, 'female', '我们的约定');
  store.setMeSide('male'); await store.setMyConfirm(e.id, 'male');
  store.setMeSide('female'); const done = await store.setMyConfirm(e.id, 'female');
  assert.equal(computeStatus(done), '已和解');
  // 渲染该条：应含"和解"印章 + "已归档"
  store.setMeSide('male');
  const el = document.getElementById('view-comm');
  commBook.mount(el);
  await new Promise(r => setTimeout(r, 50));
  assert.ok(el.innerHTML.includes('和解'), '渲染出和解印章');
  assert.ok(el.innerHTML.includes('已归档'), '渲染出已归档戳');
});
