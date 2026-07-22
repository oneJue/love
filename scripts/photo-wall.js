// 本地相册：图片原图存 IndexedDB，元数据与缩略图存主数据。
import * as store from './store.js';
import * as attachments from './attachments.js';
import { activateDialog } from './editor.js';
import { openPhotoSheet } from './memory-editor.js';
import { prettyDate } from './date-math.js';
import { escapeHtml } from './util.js';

export async function mount(el) {
  const data = await store.load();
  const photos = (data.photos || []).slice().sort((a, b) => (a.date || a.addedAt) < (b.date || b.addedAt) ? 1 : -1);
  el.innerHTML = `
    <div class="view-toolbar compact">
      <div><strong>我们的相册</strong><span>${photos.length ? `${photos.length} 张照片` : '把瞬间留在这里'}</span></div>
      <button type="button" class="toolbar-action" data-new-photo>＋ 添加照片</button>
    </div>
    ${photos.length ? `<div class="wall">${photos.map(photo => {
      const thumb = photo.thumb || photo.url || '';
      const media = thumb
        ? `<img src="${escapeHtml(thumb)}" alt="${escapeHtml(photo.caption || '未命名照片')}" loading="lazy">`
        : `<div class="photo-broken" role="img" aria-label="${escapeHtml(photo.caption || '这张照片的缩略图已丢失')}">缩略图已丢失</div>`;
      return `
      <button type="button" class="polaroid" data-photo-id="${escapeHtml(photo.id)}" aria-label="查看照片：${escapeHtml(photo.caption || '未命名照片')}">
        ${media}
        ${photo.caption ? `<span class="cap">${escapeHtml(photo.caption)}</span>` : ''}
        ${photo.date ? `<time datetime="${escapeHtml(photo.date)}">${prettyDate(photo.date)}</time>` : ''}
      </button>`;
    }).join('')}</div>` : `
      <div class="empty-state">
        <div class="empty-symbol" aria-hidden="true">📷</div>
        <strong>相册还是空的</strong>
        <p>从设备选择照片，它只会保存在这个浏览器里。</p>
        <button type="button" class="action-btn primary" data-new-photo>添加第一张</button>
      </div>`}`;

  el.onclick = event => {
    if (event.target.closest('[data-new-photo]')) {
      openPhotoSheet({ onDone: () => mount(el) });
      return;
    }
    const button = event.target.closest('[data-photo-id]');
    if (!button) return;
    const idx = photos.findIndex(item => String(item.id) === button.dataset.photoId);
    if (idx >= 0) openPhotoViewer(photos, idx);
  };
}

// R3 F5: 全屏查看支持左右切换 + 键盘 + 触屏滑动。photos 数组从 mount 传入。
// 切图时 revoke 旧 objectUrl 后再建新的，避免内存泄漏；关闭时 revoke 最后那一张。
// R3-issue4: 损坏元数据（storeKey blob 取不到且 thumb/url 均空，如导出/导入后 blob 丢失）
// src 会是空串，renderFor 不再把 img.src 设为 '' 暴露破图标，而是切占位态 + 提示文案。
const BROKEN_HINT = '这张照片的原图已丢失';
const BROKEN_ALT = '这张照片的原图已丢失，元数据可能已损坏';

async function openPhotoViewer(photos, index) {
  if (!photos || !photos.length || index < 0 || index >= photos.length) return;
  let currentObjectUrl = null;

  const loadSource = async (photo) => {
    let src = photo.thumb || photo.url || '';
    if (currentObjectUrl) { URL.revokeObjectURL(currentObjectUrl); currentObjectUrl = null; }
    if (photo.storeKey) {
      try {
        const blob = await attachments.getBlob(photo.storeKey);
        if (blob) { currentObjectUrl = URL.createObjectURL(blob); src = currentObjectUrl; }
      } catch (_) {}
    }
    return src;
  };

  const photo = photos[index];
  const source = await loadSource(photo);
  const broken = !source;
  const mask = document.createElement('div');
  mask.className = 'modal-mask photo-viewer-mask';
  mask.innerHTML = `
    <div class="modal photo-viewer">
      <h3 class="sr-only">查看照片</h3>
      <button type="button" class="photo-viewer-close" aria-label="关闭">×</button>
      ${photos.length > 1 ? `
        <button type="button" class="photo-viewer-nav prev" aria-label="上一张">‹</button>
        <button type="button" class="photo-viewer-nav next" aria-label="下一张">›</button>` : ''}
      <img${broken ? '' : ` src="${escapeHtml(source)}"`} alt="${escapeHtml(broken ? BROKEN_ALT : (photo.caption || ''))}"${broken ? ' class="photo-broken"' : ''} />
      ${photo.caption || photo.date || broken ? `<div class="photo-viewer-caption"><strong>${escapeHtml(broken ? BROKEN_HINT : (photo.caption || '这一天'))}</strong>${photo.date ? `<time datetime="${escapeHtml(photo.date)}">${prettyDate(photo.date)}</time>` : ''}</div>` : ''}
    </div>`;
  activateDialog(mask, () => { if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl); });
  mask.querySelector('.photo-viewer-close').addEventListener('click', () => mask._close());

  const imgEl = mask.querySelector('img');
  const capStrong = mask.querySelector('.photo-viewer-caption strong');
  const capTime = mask.querySelector('.photo-viewer-caption time');
  const navButtons = mask.querySelectorAll('.photo-viewer-nav');

  // R3-issue4: src 加载失败（网络/格式/404）时也切占位态，避免破图标
  imgEl.addEventListener('error', () => applyBroken(imgEl, capStrong));

  const renderFor = (p, src) => {
    const isBroken = !src;
    if (isBroken) {
      imgEl.removeAttribute('src');
      imgEl.alt = BROKEN_ALT;
      imgEl.classList.add('photo-broken');
      if (capStrong) capStrong.textContent = BROKEN_HINT;
    } else {
      imgEl.classList.remove('photo-broken');
      imgEl.src = src;
      imgEl.alt = p.caption || '';
      if (capStrong) capStrong.textContent = p.caption || '这一天';
    }
    if (capTime && p.date) { capTime.setAttribute('datetime', p.date); capTime.textContent = prettyDate(p.date); }
  };

  const go = async (delta) => {
    // 首尾循环：末尾 → 首张，首张 → 末尾
    const ni = (index + delta + photos.length) % photos.length;
    if (ni === index) return;
    index = ni;
    imgEl.style.opacity = '.3';
    try {
      const src = await loadSource(photos[index]);
      renderFor(photos[index], src);
    } finally {
      imgEl.style.opacity = '';
    }
  };

  function applyBroken(el, strong) {
    el.classList.add('photo-broken');
    el.alt = BROKEN_ALT;
    if (strong) strong.textContent = BROKEN_HINT;
  }

  navButtons.forEach(btn => {
    btn.addEventListener('click', () => go(btn.classList.contains('prev') ? -1 : 1));
  });

  // 键盘左右切换：activateDialog 的全局 onKeydown 只劫 Escape/Tab，不碰 Arrows，
  // 且其只在 masks 顶===mask 时处理。监听 mask 的 keydown，焦点在 close/nav 按钮上时冒泡至此。
  mask.addEventListener('keydown', (event) => {
    // viewer 内无输入控件，可直接响应；input/textarea/select 防御性跳过
    const tag = event.target && event.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (event.key === 'ArrowLeft') { event.preventDefault(); go(-1); }
    else if (event.key === 'ArrowRight') { event.preventDefault(); go(1); }
  });

  // 触屏滑动：记录 touchstart X，touchend deltaX>50 触发 go(±1)
  let touchStartX = null;
  mask.addEventListener('touchstart', (event) => {
    if (event.touches.length === 1) touchStartX = event.touches[0].clientX;
  }, { passive: true });
  mask.addEventListener('touchend', (event) => {
    if (touchStartX == null) return;
    const endX = event.changedTouches[0] && event.changedTouches[0].clientX;
    if (endX == null) { touchStartX = null; return; }
    const dx = endX - touchStartX;
    touchStartX = null;
    if (Math.abs(dx) > 50) go(dx > 0 ? -1 : 1);
  }, { passive: true });
}
