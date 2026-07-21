// =========================================================================
// status-machine.js — 沟通簿 5 态状态机（唯一真相源）
// 静态版与 Phase 2 后端共用同一派生规则；后端会在每次写后再校验一次。
// status 是派生值，禁止从外部直接写入；只发领域动作。
// =========================================================================

export const STATES = ['待沟通', '沟通中', '待确认', '已和解', '已搁置'];

/**
 * 根据 entry 的派生字段计算当前 status。
 * 输入是 schema v2 的 entry 对象。
 */
export function computeStatus(entry) {
  // 已搁置优先：有 shelvedFrom 即视为已搁置
  if (entry.shelvedFrom) return '已搁置';

  const agreementText = (entry.agreement && entry.agreement.text && entry.agreement.text.trim()) || '';
  const maleText = entry.maleView && entry.maleView.text && entry.maleView.text.trim();
  const femaleText = entry.femaleView && entry.femaleView.text && entry.femaleView.text.trim();

  if (!agreementText) {
    // 约定未起草
    return (maleText && femaleText) ? '沟通中' : '待沟通';
  }
  // 约定已起草
  const mConfirmed = entry.confirmations && entry.confirmations.male && entry.confirmations.male.confirmed;
  const fConfirmed = entry.confirmations && entry.confirmations.female && entry.confirmations.female.confirmed;
  return (mConfirmed && fConfirmed) ? '已和解' : '待确认';
}

/**
 * 是否还有待办（对方在等我回应 / 我该写视角 / 我该确认）。
 * 供首页"情绪平衡"判断：是否允许沟通簿主动冒头。
 * meSide: 'male' | 'female'
 */
export function pendingAction(entry, meSide) {
  if (!entry) return null;
  const status = computeStatus(entry);
  if (status === '已搁置' || status === '已和解') return null;

  const myView = meSide === 'male' ? entry.maleView : entry.femaleView;
  const myText = myView && myView.text && myView.text.trim();
  const otherView = meSide === 'male' ? entry.femaleView : entry.maleView;
  const otherText = otherView && otherView.text && otherView.text.trim();

  // 对方写了视角、我还没写
  if (otherText && !myText) return 'write-view';
  // 约定已起草、我还没确认
  if (status === '待确认') {
    const myConf = entry.confirmations && entry.confirmations[meSide];
    if (!myConf || !myConf.confirmed) return 'confirm';
  }
  return null;
}

/**
 * 领域动作：编辑 agreement 后复位两侧确认（保险栓）。
 * 返回新的 confirmations 对象（不可变更新）。
 */
export function resetConfirmations(entry) {
  return {
    male: { confirmed: false, at: null },
    female: { confirmed: false, at: null },
  };
}

/**
 * 领域动作：某一方点确认。
 * 返回新的 confirmations 对象。
 * now: ISO 时间字符串（静态版调用方传 new Date().toISOString()）
 */
export function setConfirmed(entry, meSide, now) {
  const base = (entry.confirmations && { ...entry.confirmations }) || {};
  base[meSide] = { confirmed: true, at: now };
  return base;
}

/**
 * 领域动作：搁置。shelvedFrom = 搁置前状态。
 */
export function shelve(entry) {
  return {
    shelvedFrom: computeStatus(entry),
    shelvedReason: entry.shelvedReason || null,
  };
}

/**
 * 领域动作：重新激活（从已搁置回到 shelvedFrom）。
 */
export function restore(entry) {
  return { shelvedFrom: null, shelvedReason: null };
}

/**
 * 已和解 → 重新打开 → 沟通中。
 * 静态版仅做数据变更，留痕由调用方追加 history。
 */
export function reopen(entry) {
  const c = resetConfirmations(entry);
  return {
    agreement: { ...(entry.agreement || {}), text: '' },
    confirmations: c,
    resolutionDate: null,
  };
}

/**
 * 领域动作：修改约定文本（任一方可起草/改）。
 * 同步复位两侧确认（INV-3）+ 清 resolutionDate（INV-4）——改了约定，旧确认不再有效。
 * 返回 patch 对象，由 store.commit 合并进 entry。
 */
export function setAgreementText(entry, text) {
  return {
    agreement: { ...(entry.agreement || {}), text: text || '' },
    confirmations: resetConfirmations(entry),
    resolutionDate: null,
  };
}

/**
 * 领域动作：撤回本侧确认（仅未和解前允许，store 层守卫）。
 * 返回新的 confirmations 对象。
 */
export function unconfirm(entry, side) {
  const base = (entry.confirmations && { ...entry.confirmations }) || {};
  base[side] = { confirmed: false, at: null };
  return base;
}
