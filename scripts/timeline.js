// 时光时间线：展示并记录共同经历。
import { prettyDate } from './date-math.js';
import * as store from './store.js';
import { openTimelineSheet } from './memory-editor.js';

const KIND_LABEL = {
  '关系节点': '💗', '旅行': '✈️', '事件': '📌', '其它': '✨',
};

export async function mount(el) {
  const data = await store.load();
  const items = (data.timeline || []).slice().sort((a, b) => a.date < b.date ? 1 : -1);
  el.innerHTML = `
    <div class="view-toolbar compact">
      <div><strong>共同时间线</strong><span>${items.length ? `${items.length} 段回忆` : '记录值得记住的日子'}</span></div>
      <button type="button" class="toolbar-action" data-new-memory>＋ 记录时光</button>
    </div>
    ${items.length ? `<div class="tl-list">${items.map(item => `
      <article class="tl-item">
        <div class="tl-dot"></div>
        <div class="tl-body">
          <time class="tl-date" datetime="${escapeHtml(item.date)}">${prettyDate(item.date)}</time>
          <div class="tl-title">${item.kind ? `${KIND_LABEL[item.kind] || '✨'} ` : ''}${escapeHtml(item.title)}</div>
          ${item.desc ? `<div class="tl-desc">${escapeHtml(item.desc)}</div>` : ''}
          ${item.createdBy ? `<div class="tl-by">由${escapeHtml(item.createdBy)}记录</div>` : ''}
        </div>
      </article>`).join('')}</div>` : `
      <div class="empty-state">
        <div class="empty-symbol" aria-hidden="true">🕰️</div>
        <strong>时间线还是空的</strong>
        <p>第一次见面、一次旅行，或普通但难忘的一天。</p>
        <button type="button" class="action-btn primary" data-new-memory>记录第一段</button>
      </div>`}`;
  el.onclick = event => {
    if (!event.target.closest('[data-new-memory]')) return;
    openTimelineSheet({ onDone: () => mount(el) });
  };
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
}
