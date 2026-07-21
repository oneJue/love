// 本地相册：图片原图存 IndexedDB，元数据与缩略图存主数据。
import * as store from './store.js';
import * as attachments from './attachments.js';
import { activateDialog } from './editor.js';
import { openPhotoSheet } from './memory-editor.js';

export async function mount(el) {
  const data = await store.load();
  const photos = (data.photos || []).slice().sort((a, b) => (a.date || a.addedAt) < (b.date || b.addedAt) ? 1 : -1);
  el.innerHTML = `
    <div class="view-toolbar compact">
      <div><strong>我们的相册</strong><span>${photos.length ? `${photos.length} 张照片` : '把瞬间留在这里'}</span></div>
      <button type="button" class="toolbar-action" data-new-photo>＋ 添加照片</button>
    </div>
    ${photos.length ? `<div class="wall">${photos.map(photo => `
      <button type="button" class="polaroid" data-photo-id="${escapeHtml(photo.id)}" aria-label="查看照片：${escapeHtml(photo.caption || '未命名照片')}">
        <img src="${escapeHtml(photo.thumb || photo.url || '')}" alt="${escapeHtml(photo.caption || '')}" loading="lazy">
        ${photo.caption ? `<span class="cap">${escapeHtml(photo.caption)}</span>` : ''}
        ${photo.date ? `<time datetime="${escapeHtml(photo.date)}">${escapeHtml(photo.date)}</time>` : ''}
      </button>`).join('')}</div>` : `
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
    const photo = photos.find(item => String(item.id) === button.dataset.photoId);
    if (photo) openPhotoViewer(photo);
  };
}

async function openPhotoViewer(photo) {
  let source = photo.thumb || photo.url || '';
  let objectUrl = null;
  if (photo.storeKey) {
    try {
      const blob = await attachments.getBlob(photo.storeKey);
      if (blob) { objectUrl = URL.createObjectURL(blob); source = objectUrl; }
    } catch (_) {}
  }
  const mask = document.createElement('div');
  mask.className = 'modal-mask photo-viewer-mask';
  mask.innerHTML = `
    <div class="modal photo-viewer">
      <h3 class="sr-only">查看照片</h3>
      <button type="button" class="photo-viewer-close" aria-label="关闭">×</button>
      <img src="${escapeHtml(source)}" alt="${escapeHtml(photo.caption || '')}" />
      ${photo.caption || photo.date ? `<div class="photo-viewer-caption"><strong>${escapeHtml(photo.caption || '这一天')}</strong>${photo.date ? `<time datetime="${escapeHtml(photo.date)}">${escapeHtml(photo.date)}</time>` : ''}</div>` : ''}
    </div>`;
  activateDialog(mask, () => { if (objectUrl) URL.revokeObjectURL(objectUrl); });
  mask.querySelector('.photo-viewer-close').addEventListener('click', () => mask._close());
}

function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
}
