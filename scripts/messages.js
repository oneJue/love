// 留言：发布、按身份已读与展示。
import { prettyDate } from './date-math.js';
import { sideLabel } from './schema.js';
import * as store from './store.js';
import { openMessageSheet } from './memory-editor.js';

const MOOD_EMOJI = {
  '日常': '☕', '甜': '🍯', '想念': '🌙', '抱歉': '🫶', '鼓励': '🌱', '其它': '💌',
};

export async function mount(el) {
  const meSide = store.getMeSide();
  await store.markMessagesRead(meSide);
  const data = await store.load();
  const meLabel = sideLabel(meSide);
  const msgs = (data.messages || []).slice().sort((a, b) => {
    if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1;
    return a.createdAt < b.createdAt ? 1 : -1;
  });

  el.innerHTML = `
    <div class="view-toolbar">
      <div><strong>留给彼此的话</strong><span>${msgs.length ? `${msgs.length} 封` : '从一句真心话开始'}</span></div>
      <button type="button" class="toolbar-action" data-new-message>＋ 写留言</button>
    </div>
    ${msgs.length ? `<div class="msg-list">${msgs.map(message => messageCard(message, meLabel)).join('')}</div>` : `
      <div class="empty-state">
        <div class="empty-symbol" aria-hidden="true">💌</div>
        <strong>还没有留言</strong>
        <p>有些话不必等到特别的日子。</p>
        <button type="button" class="action-btn primary" data-new-message>写第一封</button>
      </div>`}`;

  el.onclick = event => {
    if (!event.target.closest('[data-new-message]')) return;
    openMessageSheet({ onDone: () => mount(el) });
  };
}

function messageCard(message, meLabel) {
  const mine = message.from === meLabel;
  const toLabel = message.to === '双方' ? '给我们' : `给 ${escapeHtml(message.to)}`;
  const mood = message.mood || '其它';
  return `
    <article class="card msg ${message.pinned ? 'pinned' : ''} ${mine ? 'mine' : 'theirs'}">
      <div class="msg-meta">
        <span class="msg-from">${mine ? '我' : escapeHtml(message.from)}</span>
        <span class="msg-arrow" aria-hidden="true">→</span>
        <span class="msg-to">${toLabel}</span>
        <span class="msg-mood">${MOOD_EMOJI[mood] || '💌'} ${escapeHtml(mood)}</span>
        ${message.pinned ? '<span class="msg-pin">置顶</span>' : ''}
        ${message.createdAt ? `<time class="msg-date" datetime="${escapeHtml(message.createdAt)}">${prettyDate(message.createdAt.slice(0, 10))}</time>` : ''}
      </div>
      <div class="msg-text">${escapeHtml(message.text)}</div>
    </article>`;
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
}
