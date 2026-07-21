// =========================================================================
// interaction.test.js — 沟通簿交互层端到端测试（node --test）
// 覆盖：状态机 5 态派生、复位、撤回、搁置/恢复/重新打开、
//       store 权限守卫、history 留痕、导入导出幂等、不变量、"同意"零残留。
// =========================================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// —— 构造最小浏览器环境（localStorage + window + fetch）给 store.js ——
function makeEnv() {
  const store = new Map();
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  const listeners = new Set();
  const window = {
    localStorage,
    addEventListener: (t, cb) => listeners.add({ t, cb }),
    dispatchEvent: (ev) => { for (const l of listeners) if (l.t === ev.type) l.cb(ev); },
    CustomEvent: class { constructor(type, opts) { this.type = type; this.detail = (opts||{}).detail; } },
  };
  globalThis.window = window;
  globalThis.localStorage = localStorage;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => JSON.parse(fs.readFileSync(path.join(ROOT, 'data.json'), 'utf8')),
  });
  return { window, localStorage };
}
makeEnv();

// 现在导入被测模块
const { computeStatus, pendingAction, resetConfirmations, setConfirmed, setAgreementText, unconfirm, shelve, restore, reopen } =
  await import(path.join(ROOT, 'scripts/status-machine.js'));
const { makeEntry, genId, migrateEntry, sideLabel } =
  await import(path.join(ROOT, 'scripts/schema.js'));
const store = await import(path.join(ROOT, 'scripts/store.js'));

const NOW = '2026-07-21T10:00:00.000Z';
store.setNowProvider(() => NOW);

const bothViews = (e) => {
  e.maleView = { text: 'm', updatedAt: NOW, writtenBy: '男方' };
  e.femaleView = { text: 'f', updatedAt: NOW, writtenBy: '女方' };
  return e;
};
const E = () => makeEntry({ title: 't', occurrenceDate: '2026-07-21', raisedBy: '男方' });

// —— 状态机纯函数 ——
test('T-1 makeEntry 起步待沟通', () => {
  assert.equal(computeStatus(E()), '待沟通');
});

test('T-2 仅一方写视角→待沟通；双方→沟通中', () => {
  const e = E(); e.maleView = { text: 'm', updatedAt: NOW, writtenBy: '男方' };
  assert.equal(computeStatus(e), '待沟通');
  assert.equal(computeStatus(bothViews(E())), '沟通中');
});

test('T-3 双视角+起草约定→待确认', () => {
  const e = bothViews(E()); e.agreement = { text: '约定', updatedAt: NOW, updatedBy: '男方' };
  assert.equal(computeStatus(e), '待确认');
});

test('T-4 一方确认→仍待确认；双方→已和解', () => {
  let e = bothViews(E()); e.agreement = { text: '约定', updatedAt: NOW, updatedBy: '男方' };
  e.confirmations = setConfirmed(e, 'male', NOW);
  assert.equal(computeStatus(e), '待确认');
  e.confirmations = setConfirmed(e, 'female', NOW);
  assert.equal(computeStatus(e), '已和解');
});

test('T-5 setAgreementText 复位确认 + 清 resolutionDate（INV-3+4）', () => {
  let e = bothViews(E()); e.agreement = { text: '约定' };
  e.confirmations = setConfirmed(e, 'male', NOW);
  e.confirmations = setConfirmed(e, 'female', NOW);
  e.resolutionDate = '2026-07-21';
  Object.assign(e, setAgreementText(e, '改'));
  assert.equal(computeStatus(e), '待确认');
  assert.equal(e.confirmations.male.confirmed, false);
  assert.equal(e.confirmations.female.confirmed, false);
  assert.equal(e.resolutionDate, null);
});

test('T-6 unconfirm 仅复位本侧不动对侧', () => {
  let e = bothViews(E()); e.agreement = { text: '约定' };
  e.confirmations = setConfirmed(e, 'male', NOW);
  e.confirmations = unconfirm(e, 'male');
  assert.equal(e.confirmations.male.confirmed, false);
  assert.equal(e.confirmations.male.at, null);
});

test('T-7 搁置捕获 shelvedFrom，恢复回到原状态', () => {
  let e = bothViews(E()); e.agreement = { text: '约定' };
  assert.equal(computeStatus(e), '待确认');
  Object.assign(e, shelve(e));
  assert.equal(computeStatus(e), '已搁置');
  assert.equal(e.shelvedFrom, '待确认');
  Object.assign(e, restore(e));
  assert.equal(computeStatus(e), '待确认');
  assert.equal(e.shelvedFrom, null);
});

test('T-8 reopen 仅作用于已和解数据：清约定+确认+resolutionDate', () => {
  let e = bothViews(E()); e.agreement = { text: '约定' };
  e.confirmations = setConfirmed(e, 'male', NOW);
  e.confirmations = setConfirmed(e, 'female', NOW);
  e.resolutionDate = '2026-07-21';
  Object.assign(e, reopen(e));
  assert.equal(computeStatus(e), '沟通中');
  assert.equal(e.agreement.text, '');
  assert.equal(e.resolutionDate, null);
});

test('T-9 pendingAction：对方写视角我没写→write-view', () => {
  const e = E();
  e.femaleView = { text: 'f', updatedAt: NOW, writtenBy: '女方' };
  assert.equal(pendingAction(e, 'male'), 'write-view');
  assert.equal(pendingAction(e, 'female'), null);
});

// —— store 权限与状态机集成 ——
async function freshEntry() {
  store.setMeSide('male');
  return store.createEntry({ title: '测试事件', occurrenceDate: '2026-07-21' });
}

test('T-10 store 写对方视角被拒（INV-2）', async () => {
  const e = await freshEntry();
  store.setMeSide('female');
  await assert.rejects(() => store.writeView(e.id, 'male', 'x'), /身份/);
});

test('T-11 store 点对方确认被拒（INV-2）', async () => {
  const e = await freshEntry();
  store.setMeSide('female');
  await assert.rejects(() => store.setMyConfirm(e.id, 'male'), /身份/);
});

test('T-12 双方任一方可写 agreement', async () => {
  const e = await freshEntry();
  store.setMeSide('male'); await store.writeAgreement(e.id, 'male', '约1');
  store.setMeSide('female'); await store.writeAgreement(e.id, 'female', '约2');
  assert.equal(store.getEntry(e.id).agreement.text, '约2');
});

test('T-13 完整流转：写视角→起草→双方确认→已和解', async () => {
  const e = await freshEntry();
  store.setMeSide('male'); await store.writeView(e.id, 'male', '男方视角');
  store.setMeSide('female'); await store.writeView(e.id, 'female', '女方视角');
  await store.writeAgreement(e.id, 'female', '我们的约定');
  store.setMeSide('male'); await store.setMyConfirm(e.id, 'male');
  store.setMeSide('female'); const final = await store.setMyConfirm(e.id, 'female');
  assert.equal(computeStatus(final), '已和解');
  assert.ok(final.resolutionDate);
});

test('T-14 改约定自动复位确认（INV-3 集成）', async () => {
  const e = await freshEntry();
  store.setMeSide('male'); await store.writeView(e.id, 'male', 'm');
  store.setMeSide('female'); await store.writeView(e.id, 'female', 'f');
  await store.writeAgreement(e.id, 'female', '约');
  store.setMeSide('male'); await store.setMyConfirm(e.id, 'male'); // 男方确认了
  assert.equal(store.getEntry(e.id).confirmations.male.confirmed, true);
  // 任一方改约定 → 复位
  store.setMeSide('female'); await store.writeAgreement(e.id, 'female', '改后的约');
  assert.equal(store.getEntry(e.id).confirmations.male.confirmed, false);
  assert.equal(computeStatus(store.getEntry(e.id)), '待确认');
});

test('T-15 store 二次搁置被拒（INV-5）', async () => {
  const e = await freshEntry();
  await store.shelveEntry(e.id, 'male', '冷静');
  assert.equal(computeStatus(store.getEntry(e.id)), '已搁置');
  await assert.rejects(() => store.shelveEntry(e.id, 'male', '二次'), /已搁置/);
  assert.equal(store.getEntry(e.id).shelvedFrom, '待沟通'); // 仍是原状态，未被覆盖
});

test('T-16 store reopen 对非已和解拒绝', async () => {
  const e = await freshEntry();
  await assert.rejects(() => store.reopenEntry(e.id, 'male'), /仅已和解/);
});

test('T-17 store unconfirmMine 已和解后被拒', async () => {
  const e = await freshEntry();
  store.setMeSide('male'); await store.writeView(e.id, 'male', 'm');
  store.setMeSide('female'); await store.writeView(e.id, 'female', 'f');
  await store.writeAgreement(e.id, 'female', '约');
  store.setMeSide('male'); await store.setMyConfirm(e.id, 'male');
  store.setMeSide('female'); await store.setMyConfirm(e.id, 'female'); // 已和解
  // 已和解后，本侧撤回也被拒
  await assert.rejects(() => store.unconfirmMine(e.id, 'female'), /已和解/);
});

test('T-18 history 永不丢失，append-only（INV-7）', async () => {
  const e = await freshEntry();
  await store.shelveEntry(e.id, 'male', '冷静一下');
  await store.restoreEntry(e.id, 'male');
  const fresh = store.getEntry(e.id);
  const sums = fresh.history.map(h => h.summary);
  assert.ok(sums.some(s => /创建/.test(s)));
  assert.ok(sums.some(s => /搁置/.test(s)));
  assert.ok(sums.some(s => /重新激活/.test(s)));
  assert.ok(fresh.history.length >= 3);
});

test('T-19 entry.status 永远等于 computeStatus（INV-1）', async () => {
  const e = await freshEntry();
  for (const op of [
    async () => (store.setMeSide('male'), store.writeView(e.id, 'male', 'm')),
    async () => (store.setMeSide('female'), store.writeView(e.id, 'female', 'f')),
    async () => store.writeAgreement(e.id, 'female', '约'),
    async () => (store.setMeSide('male'), store.setMyConfirm(e.id, 'male')),
  ]) {
    await op();
    const cur = store.getEntry(e.id);
    assert.equal(cur.status, computeStatus(cur));
  }
});

test('T-20 resolutionDate 非空 ⟺ 已和解（INV-6）', async () => {
  const e = await freshEntry();
  store.setMeSide('male'); await store.writeView(e.id, 'male', 'm');
  store.setMeSide('female'); await store.writeView(e.id, 'female', 'f');
  await store.writeAgreement(e.id, 'female', '约');
  store.setMeSide('male'); await store.setMyConfirm(e.id, 'male');
  assert.equal(computeStatus(store.getEntry(e.id)), '待确认');
  assert.equal(store.getEntry(e.id).resolutionDate, null);
  store.setMeSide('female'); await store.setMyConfirm(e.id, 'female');
  assert.equal(computeStatus(store.getEntry(e.id)), '已和解');
  assert.ok(store.getEntry(e.id).resolutionDate);
});

test('T-21 genId 有序数字递增不冲突（INV-11）', () => {
  // 数字 id 最大者 +1；历史日期式 id 跳过不参与计数，但保证不冲突
  assert.equal(genId([{ id: '2026-0721-01' }, { id: 1 }, { id: 3 }]), 4);
  assert.equal(genId([]), 1);
  assert.equal(genId([{ id: 5 }, { id: 2 }]), 6);
});

test('T-22 导出→导入幂等', async () => {
  const a = await store.exportJSON();
  await store.importFromJSON(a);
  const b = await store.exportJSON();
  assert.deepEqual(JSON.parse(a), JSON.parse(b));
});

test('T-23 migrateEntry 幂等（v1→v2 二次迁移不变）', () => {
  const v1 = { id: '2026-0721-99', title: 'x', raisedBy: '男方',
    result: { text: '老约定', updatedAt: 't' },
    confirmations: { male: { confirmed: false, at: null }, female: { confirmed: false, at: null } },
    history: [] };
  const v2a = migrateEntry(JSON.parse(JSON.stringify(v1)));
  assert.equal(v2a.agreement.text, '老约定');
  // agreement 非空 → 派生 待确认（无论视角是否填）
  assert.equal(v2a.status, '待确认');
  const v2b = migrateEntry(JSON.parse(JSON.stringify(v2a)));
  assert.deepEqual(v2a, v2b);
});

test('T-24 migrateEntry 修复脏 status（INV-1）', () => {
  // 两视角齐全 + 无约定 → 应派生沟通中，即便原 status 写待沟通
  const dirty = { id: 'x', title: 't', raisedBy: '男方',
    maleView: { text: 'm' }, femaleView: { text: 'f' },
    agreement: { text: '' },
    confirmations: { male: { confirmed: false, at: null }, female: { confirmed: false, at: null } },
    status: '待沟通', history: [] };
  const fixed = migrateEntry(JSON.parse(JSON.stringify(dirty)));
  assert.equal(fixed.status, '沟通中');
});

test('T-25 "同意"二字不进 history.summary（INV-9）', async () => {
  const e = await freshEntry();
  store.setMeSide('male'); await store.writeView(e.id, 'male', 'm');
  store.setMeSide('female'); await store.writeView(e.id, 'female', 'f');
  await store.writeAgreement(e.id, 'female', '约');
  store.setMeSide('male'); await store.setMyConfirm(e.id, 'male');
  store.setMeSide('female'); await store.setMyConfirm(e.id, 'female');
  for (const h of store.getEntry(e.id).history) {
    assert.ok(!h.summary.includes('同意'), `history 含"同意": ${h.summary}`);
  }
});

test('T-26 "同意"二字绝不进 UI 源码字面量（INV-9）', () => {
  // 不变量：UI 可见文案、按钮、状态、history.summary 都不出现"同意"。
  // store.js 中出现"同意"仅用于 enforcement（抛错文案 + 注释），非 UI 文案，豁免。
  const files = ['scripts/comm-book.js', 'scripts/editor.js', 'scripts/app.js'];
  for (const f of files) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    // 去掉注释行后再检查字符串字面量，避免误报注释里的说明
    const noComments = src.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    assert.ok(!/['"`][^'"`]{0,20}同意[^'"`]{0,20}['"`]/.test(noComments),
      `${f} 含"同意"字面量`);
  }
});

test('T-27 sideLabel 映射正确', () => {
  assert.equal(sideLabel('male'), '男方');
  assert.equal(sideLabel('female'), '女方');
});

test('T-28 种子样例 1 派生为沟通中，含事实层', () => {
  const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'data.json'), 'utf8')).entries[0];
  assert.equal(raw.id, 1, '样例 id 已改为有序数字 1');
  const fixed = migrateEntry(JSON.parse(JSON.stringify(raw)));
  assert.equal(computeStatus(fixed), '沟通中');
  assert.ok(fixed.description.text, '含事实层描述');
  assert.ok(Array.isArray(fixed.attachments), '含 attachments 数组');
});

// —— 事实层（描述 + 附件，任一方可写）——
test('T-29 事实层字段默认结构', () => {
  const e = makeEntry({ title: 't', raisedBy: '男方' });
  assert.equal(typeof e.description.text, 'string');
  assert.equal(Array.isArray(e.attachments), true);
});

test('T-30 store.writeDescription 任一方都可写', async () => {
  const e = await freshEntry();
  // 男方身份写
  store.setMeSide('male'); await store.writeDescription(e.id, 'male', '客观描述A');
  assert.equal(store.getEntry(e.id).description.text, '客观描述A');
  // 切女方身份也能改（事实层非各侧隔离）
  store.setMeSide('female'); await store.writeDescription(e.id, 'female', '客观描述B');
  assert.equal(store.getEntry(e.id).description.text, '客观描述B');
});

test('T-31 store.addAttachment / removeAttachment 添删留痕', async () => {
  const e = await freshEntry();
  const meta = { id: 'att-test', name: 'x.png', type: 'image/png', size: 100, storeKey: 'att-test', thumb: 'data:image/png;base64,' };
  store.setMeSide('male'); await store.addAttachment(e.id, 'male', meta);
  assert.equal(store.getEntry(e.id).attachments.length, 1);
  await store.removeAttachment(e.id, 'male', 'att-test');
  assert.equal(store.getEntry(e.id).attachments.length, 0);
  // 留痕
  const sums = store.getEntry(e.id).history.map(h => h.summary);
  assert.ok(sums.some(s => /添加附件/.test(s)));
  assert.ok(sums.some(s => /移除附件/.test(s)));
});

test('T-32 页面可创建时光记录并生成有序 id', async () => {
  store.setMeSide('male');
  const first = await store.createTimelineItem({ title: '第一次看海', date: '2026-07-20', kind: '旅行', desc: '风很大' });
  const second = await store.createTimelineItem({ title: '一起做饭', date: '2026-07-21', kind: '事件' });
  assert.equal(second.id, first.id + 1);
  assert.equal(second.createdBy, '男方');
  assert.equal((await store.load()).timeline.some(item => item.title === '第一次看海'), true);
});

test('T-33 新留言只对收件方显示未读', async () => {
  store.setMeSide('male');
  const message = await store.createMessage({ text: '记得早点休息', mood: '日常' });
  assert.equal(message.to, '女方');
  assert.equal(store.isMessageUnread(message, 'male'), false);
  assert.equal(store.isMessageUnread(message, 'female'), true);
});

test('T-34 留言已读状态按身份独立记录', async () => {
  store.setMeSide('female');
  const before = (await store.load()).messages.filter(message => store.isMessageUnread(message, 'female')).length;
  const count = await store.markMessagesRead('female');
  assert.equal(count, before);
  assert.equal((await store.load()).messages.some(message => store.isMessageUnread(message, 'female')), false);
});

test('T-35 相册记录复用附件元数据', async () => {
  store.setMeSide('female');
  const photo = await store.createPhoto(
    { id: 'photo-test', storeKey: 'photo-test', name: 'memory.jpg', type: 'image/jpeg', size: 120, thumb: 'data:image/jpeg;base64,' },
    { caption: '这一天', date: '2026-07-21' },
  );
  assert.equal(photo.caption, '这一天');
  assert.equal(photo.addedBy, '女方');
  assert.equal((await store.load()).photos.some(item => item.storeKey === 'photo-test'), true);
});

test('T-36 时光、留言和照片拒绝无效输入', async () => {
  await assert.rejects(() => store.createTimelineItem({ title: '', date: '2026-07-21' }), /标题/);
  await assert.rejects(() => store.createMessage({ text: '  ' }), /一句/);
  await assert.rejects(() => store.createPhoto({ type: 'text/plain', storeKey: 'x' }), /图片/);
});

test('T-37 关系资料可保存日期与双方称呼', async () => {
  const meta = await store.updateRelationshipProfile({
    startDate: '2024-05-20', maleName: '小北', femaleName: '小南', anniversaryName: '相爱',
  });
  assert.equal(meta.startDate, '2024-05-20');
  assert.deepEqual(meta.partnerNames, { male: '小北', female: '小南' });
  await assert.rejects(() => store.updateRelationshipProfile({ startDate: '2026-07-22' }), /晚于今天/);
});

test('T-38 DOM 字符串 id 可以操作数字 id 条目', async () => {
  const entry = await freshEntry();
  await store.writeDescription(String(entry.id), 'male', '来自按钮的字符串 id');
  assert.equal(store.getEntry(String(entry.id)).description.text, '来自按钮的字符串 id');
});
