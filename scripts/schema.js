// =========================================================================
// schema.js — schema v2 工厂函数（静态与后端共用，确保平滑迁移）
// 仅为方便初始化默认结构与校验关键字段，不是严格 runtime 校验。
// =========================================================================

import { computeStatus } from './status-machine.js';

/** 新建一条空沟通簿条目（待沟通起步） */
export function makeEntry({ title, occurrenceDate, raisedBy, severity = '一般', tags = [], description = '', attachments = [] }) {
  const now = new Date().toISOString();
  const today = now.slice(0, 10);
  return {
    id: null, // 由 store.createEntry 用 genId(existing) 赋值；直造用占位
    title: title || '',
    occurrenceDate: occurrenceDate || today,
    createdAt: now,
    updatedAt: now,
    raisedBy: raisedBy || '男方',
    severity,
    tags,
    // —— 事实层（客观，任一方可写，两人共用的事实底）——
    description: { text: description || '', updatedAt: null, updatedBy: null },
    attachments: Array.isArray(attachments) ? attachments : [], // 元数据数组，blob 在 IndexedDB
    // —— 视角层（主观，各侧仅本侧）——
    maleView: { text: '', updatedAt: null, writtenBy: null },
    femaleView: { text: '', updatedAt: null, writtenBy: null },
    // —— 解决层 ——
    agreement: { text: '', updatedAt: null, updatedBy: null },
    maleNote: { text: '', updatedAt: null },
    femaleNote: { text: '', updatedAt: null },
    confirmations: {
      male: { confirmed: false, at: null },
      female: { confirmed: false, at: null },
    },
    status: '待沟通', // 派生占位，真实值由 computeStatus 计算
    resolutionDate: null,
    shelvedReason: null,
    shelvedFrom: null,
    history: [{ at: now, by: raisedBy || '男方', summary: '创建条目' }],
  };
}

/**
 * 生成 id：有序数字 1, 2, 3 … 全局递增，不与发生日期绑定。
 * 删/搁置不回收占用，序号只增不减（保证留痕可追溯）。
 * existing: 现有全部 entries。仅纯数字 id 计入计数（历史日期式 id 跳过），
 *           但保证新 id 不与任何现有 id（含日期式字符串）冲突。
 */
export function genId(existing = []) {
  const nums = existing
    .map(e => String(e.id))
    .filter(s => /^\d+$/.test(s)) // 仅纯整数字符串
    .map(s => parseInt(s, 10))
    .filter(n => n > 0);
  const max = nums.length ? Math.max(...nums) : 0;
  const allIds = new Set(existing.map(e => String(e.id)));
  let candidate = max + 1;
  while (allIds.has(String(candidate))) candidate++;
  return candidate;
}

/** 男/女身份桥接：内部键 'male'/'female' ↔ 展示 '男方'/'女方' */
export function sideLabel(side) {
  return side === 'male' ? '男方' : '女方';
}

/**
 * schema v1→v2 迁移（幂等）。补齐 v2 默认字段，兼容旧/缺字段数据。
 * 不改 id/title/raisedBy/rich 字段；result(旧) → agreement(新) 仅在无 agreement 时转。
 */
export function migrateEntry(entry) {
  if (!entry || typeof entry !== 'object') return entry;
  // 旧 v1 把约定塞进 result —— 若已有 agreement 不动，否则迁移
  if (entry.result && !entry.agreement) {
    entry.agreement = {
      text: (entry.result.text != null ? entry.result.text : String(entry.result)) || '',
      updatedAt: entry.result.updatedAt || null,
      updatedBy: null,
    };
    delete entry.result;
  }
  const tpl = makeEntry({ title: entry.title || '', raisedBy: entry.raisedBy || '男方' });
  // 事实层：description 可能是旧字符串，归一为 {text}
  if (typeof entry.description === 'string') {
    entry.description = { text: entry.description, updatedAt: null, updatedBy: null };
  }
  entry.description = entry.description || tpl.description;
  entry.attachments = Array.isArray(entry.attachments) ? entry.attachments :tpl.attachments;
  entry.confirmations = entry.confirmations || tpl.confirmations;
  entry.maleView = entry.maleView || tpl.maleView;
  entry.femaleView = entry.femaleView || tpl.femaleView;
  entry.maleNote = entry.maleNote || tpl.maleNote;
  entry.femaleNote = entry.femaleNote || tpl.femaleNote;
  entry.agreement = entry.agreement || tpl.agreement;
  // R2-6 (L5 防御): 旧版残留 history 为非数组（null/字符串/undefined）时不要套 tpl.history
  // （那会注入一条 at=now 的虚假"创建条目"留痕，违背留痕真实承诺）。
  // 回退为空数组；若残留了非数组数据，记一条 sys 迁移留痕保留可追溯性而非静默吞掉。
  if (Array.isArray(entry.history)) {
    // 已是数组，保留
  } else if (entry.history == null) {
    entry.history = [];
  } else {
    entry.history = [{ at: new Date().toISOString(), by: 'sys', summary: '数据迁移: 历史留痕已规整' }];
  }
  entry.shelvedReason = entry.shelvedReason != null ? entry.shelvedReason : null;
  entry.shelvedFrom = entry.shelvedFrom != null ? entry.shelvedFrom : null;
  // 修复 INV-1 脏 status：存储的 status 必须等于派生值
  entry.status = computeStatus(entry);
  return entry;
}
