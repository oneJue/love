// 首页关系概览与天数计时。
import { daysSince, prettyDate } from './date-math.js';

export function mount(el, data, { onEdit } = {}) {
  const meta = data.meta || {};
  const days = meta.startDate ? daysSince(meta.startDate) : null;
  const relationshipName = meta.anniversaryName || '在一起';
  const names = meta.partnerNames || { male: '他', female: '她' };
  const pair = `${escapeHtml(names.male || '他')} <span aria-hidden="true">&</span> ${escapeHtml(names.female || '她')}`;

  el.innerHTML = `
    <section class="home-hero ${days === null ? 'needs-setup' : ''}" aria-labelledby="relationship-title">
      <div class="home-hero-top">
        <div>
          <span class="home-eyebrow">OUR DAYS</span>
          <h2 id="relationship-title">${pair}</h2>
        </div>
        <button type="button" class="icon-action" data-edit-relationship aria-label="编辑关系资料" title="编辑关系资料">✎</button>
      </div>
      ${days === null ? `
        <div class="home-setup">
          <strong>从哪一天开始？</strong>
          <p>填入日期后，这里会记录你们一起走过的每一天。</p>
          <button type="button" class="action-btn primary" data-edit-relationship>填写开始日期</button>
        </div>` : `
        <div class="days-display"><strong>${days}</strong><span>天</span></div>
        <p class="days-caption">我们已经${escapeHtml(relationshipName)} ${days} 天</p>
        <time class="relationship-since" datetime="${escapeHtml(meta.startDate)}">从 ${prettyDate(meta.startDate)} 开始</time>`}
    </section>`;
  el.querySelectorAll('[data-edit-relationship]').forEach(button => {
    button.addEventListener('click', () => { if (onEdit) onEdit(); });
  });
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
}
