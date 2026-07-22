// 留言：发布、按身份已读与展示。
import { prettyDate } from './date-math.js';
import { sideLabel } from './schema.js';
import * as store from './store.js';
import { openMessageSheet } from './memory-editor.js';
import { escapeHtml } from './util.js';

const MOOD_EMOJI = {
  '日常': '☕', '甜': '🍯', '想念': '🌙', '抱歉': '🫶', '鼓励': '🌱', '其它': '💌',
};

export async function mount(el) {
  // R3: 订阅 store 变更——否则 markMessagesRead 广播后当前视图不重渲染，
  // .msg.unread 高亮 / msg-unread-dot 会长期滞留（数据已读但 DOM 仍标未读）。
  // markMessagesRead 在无未读时 early-return 不写盘不广播，重挂不会回环。
  if (!el._wired) {
    el._wired = true;
    store.onStoreChanged(() => { if (document.getElementById('view-message') === el) mount(el); });
  }
  const meSide = store.getMeSide();
  const meLabel = sideLabel(meSide);
  const data = await store.load();
  const msgs = (data.messages || []).slice().sort((a, b) => {
    if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1;
    return a.createdAt < b.createdAt ? 1 : -1;
  });

  el.innerHTML = `
    <div class="view-toolbar">
      <div><strong>留给彼此的话</strong><span>${msgs.length ? `${msgs.length} 封` : '从一句真心话开始'}</span></div>
      <button type="button" class="toolbar-action" data-new-message>＋ 写留言</button>
    </div>
    ${msgs.length ? `<div class="msg-list">${msgs.map(message => messageCard(message, meLabel, meSide)).join('')}</div>` : `
      <div class="empty-state">
        <div class="empty-symbol" aria-hidden="true">💌</div>
        <strong>还没有留言</strong>
        <p>有些话不必等到特别的日子。</p>
        <button type="button" class="action-btn primary" data-new-message>写第一封</button>
      </div>`}`;

  // R2-4: 先渲染让用户看到未读高亮，再异步标记已读（延迟到下一帧，避免感知断层）。
  // markMessagesRead 在无未读时 early return 0 不写盘，无假广播风险。
  // R3-issue2: 异步落盘前先乐观地把当前 DOM 上的 .unread 高亮去掉（先去高亮再落盘），
  // 避免"A 轮高亮 → broadcast → B 轮重渲染去高亮"那一拍肉眼可见的先亮后灭闪现。
  // 落盘失败则降级到本地 DOM 去高亮（不依赖重渲染）并留痕，而非静默吞错让高亮长期滞留。
  const unreadCount = msgs.filter(m => store.isMessageUnread(m, meSide)).length;
  if (unreadCount) {
    clearTimeoutUnread(el);
    queueMicrotask(() => {
      store.markMessagesRead(meSide).catch(err => {
        console.warn('[messages] markMessagesRead 失败，已降级本地移除未读高亮：', err && err.message ? err.message : err);
        clearTimeoutUnread(el);
      });
    });
  }

  el.onclick = event => {
    // R4 F4: 置顶/取消置顶——切换 pinned，落盘后 onStoreChanged 订阅自动重渲染
    const pinBtn = event.target.closest('[data-pin],[data-unpin]');
    if (pinBtn) {
      const id = pinBtn.dataset.pin || pinBtn.dataset.unpin;
      store.toggleMessagePin(id).catch(err => toastErr(err));
      return;
    }
    if (!event.target.closest('[data-new-message]')) return;
    openMessageSheet({ onDone: () => mount(el) });
  };
}

// R3-issue2: 本地移除未读标记——broadcast 之前/失败后均不依赖重渲染，
// 直接清当前 DOM 卡片的 .unread 类与 .msg-unread-dot 角标。幂等可重复调用。
function clearTimeoutUnread(el) {
  el.querySelectorAll('.msg.unread').forEach(card => {
    card.classList.remove('unread');
    const dot = card.querySelector('.msg-unread-dot');
    if (dot) dot.remove();
  });
}

function toastErr(err) {
  // 复用 editor.toast 错误提示；导入循环防御：仅失败路径触发，惰性 import
  import('./editor.js').then(editor => {
    editor.toast(err && err.message ? err.message : String(err));
  }).catch(() => {});
}

function messageCard(message, meLabel, meSide) {
  const mine = message.from === meLabel;
  const unread = meSide && store.isMessageUnread(message, meSide);
  const toLabel = message.to === '双方' ? '给我们' : `给 ${escapeHtml(message.to)}`;
  const mood = message.mood || '其它';
  const messageId = escapeHtml(String(message.id));
  const pinBtn = message.pinned
    ? `<button type="button" class="msg-pin-btn" data-unpin="${messageId}" aria-label="取消置顶">取消置顶</button>`
    : `<button type="button" class="msg-pin-btn" data-pin="${messageId}" aria-label="置顶">置顶</button>`;
  return `
    <article class="card msg ${message.pinned ? 'pinned' : ''} ${mine ? 'mine' : 'theirs'}${unread ? ' unread' : ''}" data-msg-id="${messageId}">
      <div class="msg-meta">
        <span class="msg-from">${mine ? '我' : escapeHtml(message.from)}</span>
        ${unread ? '<span class="msg-unread-dot" aria-label="未读"></span>' : ''}
        <span class="msg-arrow" aria-hidden="true">→</span>
        <span class="msg-to">${toLabel}</span>
        <span class="msg-mood">${MOOD_EMOJI[mood] || '💌'} ${escapeHtml(mood)}</span>
        ${message.pinned ? '<span class="msg-pin">置顶</span>' : ''}
        ${message.createdAt ? `<time class="msg-date" datetime="${escapeHtml(message.createdAt)}">${prettyDate(message.createdAt.slice(0, 10))}</time>` : ''}
        ${pinBtn}
      </div>
      <div class="msg-text">${escapeHtml(message.text)}</div>
    </article>`;
}
