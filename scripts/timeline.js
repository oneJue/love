// 时光时间线：展示并记录共同经历。
import { prettyDate } from './date-math.js';
import * as store from './store.js';
import { openTimelineSheet } from './memory-editor.js';
import { escapeHtml } from './util.js';

const KIND_LABEL = {
  '关系节点': '💗', '旅行': '✈️', '事件': '📌', '其它': '✨',
};
// R5-s3: 筛选态从模块级闭包改为 el 生命周期变量（与 messages.js el._wired 同模式）。
// renderTab 每次进时光 tab 都重建 #tl-content（app.js:261-273），故 el._activeKind/Year 在
// 每次入口都回到默认——避免「选了 2025 年 → 切首页 → 回时光仍锁 2025，新记的 2026 时光
// 显示『该筛选条件下暂无时光』」的残留。同次挂载内点筛选切换则经 el.onclick 写回 el 上保留。
export async function mount(el) {
  if (!el._tlWired) {
    el._tlWired = true;
    el._activeKind = '全部';
    el._activeYear = '全部';
  }
  const activeKind = el._activeKind;
  const activeYear = el._activeYear;
  const data = await store.load();
  const items = (data.timeline || []).slice().sort((a, b) => a.date < b.date ? 1 : -1);

  // 筛选维度选项：类型固定四类 + 「全部」；年份取数据里出现过的，倒序
  const kinds = ['全部', '关系节点', '旅行', '事件', '其它'];
  const years = ['全部', ...Array.from(new Set(items.map(i => String(i.date || '').slice(0, 4)).filter(Boolean))).sort().reverse()];

  // 双重过滤
  let list = items;
  if (activeKind !== '全部') list = list.filter(i => (i.kind || '其它') === activeKind);
  if (activeYear !== '全部') list = list.filter(i => String(i.date || '').slice(0, 4) === activeYear);

  const filterBar = years.length > 1 || kinds.length > 1
    ? `<div class="filters tl-filters" aria-label="按类型与年份筛选时光">
        ${kinds.map(k => `<button type="button" aria-pressed="${activeKind === k}" class="${activeKind === k ? 'active' : ''}" data-kind="${escapeHtml(k)}">${KIND_LABEL[k] ? `${KIND_LABEL[k]} ` : ''}${escapeHtml(k)}</button>`).join('')}
        ${years.length > 1 ? years.map(y => `<button type="button" aria-pressed="${activeYear === y}" class="${activeYear === y ? 'active' : ''}" data-year="${escapeHtml(y)}">${escapeHtml(y === '全部' ? '全部' : y + ' 年')}</button>`).join('') : ''}
      </div>`
    : '';

  el.innerHTML = `
    <div class="view-toolbar compact">
      <div><strong>共同时间线</strong><span>${items.length ? `${items.length} 段回忆` : '记录值得记住的日子'}</span></div>
      <button type="button" class="toolbar-action" data-new-memory>＋ 记录时光</button>
    </div>
    ${items.length ? `${filterBar}<div class="tl-list">${list.map(item => `
      <article class="tl-item">
        <div class="tl-dot"></div>
        <div class="tl-body">
          <time class="tl-date" datetime="${escapeHtml(item.date)}">${prettyDate(item.date)}</time>
          <div class="tl-title">${item.kind ? `${KIND_LABEL[item.kind] || '✨'} ` : ''}${escapeHtml(item.title)}</div>
          ${item.desc ? `<div class="tl-desc">${escapeHtml(item.desc)}</div>` : ''}
          ${item.createdBy ? `<div class="tl-by">由${escapeHtml(item.createdBy)}记录</div>` : ''}
        </div>
      </article>`).join('')}</div>${list.length ? '' : '<div class="empty">该筛选条件下暂无时光</div>'}` : `
      <div class="empty-state">
        <div class="empty-symbol" aria-hidden="true">🕰️</div>
        <strong>时间线还是空的</strong>
        <p>第一次见面、一次旅行，或普通但难忘的一天。</p>
        <button type="button" class="action-btn primary" data-new-memory>记录第一段</button>
      </div>`}`;
  el.onclick = event => {
    // R4 F2/R5-s3: 筛选切换——写回 el 上再 mount(el) 重建，同次挂载内保留
    const fb = event.target.closest('[data-kind],[data-year]');
    if (fb) {
      if (fb.dataset.kind) el._activeKind = fb.dataset.kind;
      if (fb.dataset.year) el._activeYear = fb.dataset.year;
      mount(el);
      return;
    }
    if (!event.target.closest('[data-new-memory]')) return;
    openTimelineSheet({ onDone: () => mount(el) });
  };
}

