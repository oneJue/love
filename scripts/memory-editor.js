// 页面级创作表单：时光、留言和相册。
import * as store from './store.js';
import * as attachments from './attachments.js';
import { activateDialog, toast } from './editor.js';
import { sideLabel } from './schema.js';

function openDialog(innerHTML, onClose) {
  const mask = document.createElement('div');
  mask.className = 'modal-mask';
  mask.innerHTML = innerHTML;
  return activateDialog(mask, onClose);
}

function today() {
  const date = new Date();
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function setBusy(button, busy, busyText, idleText) {
  button.disabled = busy;
  button.textContent = busy ? busyText : idleText;
}

export function openTimelineSheet({ onDone } = {}) {
  const mask = openDialog(`
    <div class="modal composer-sheet">
      <h3>记录一段时光</h3>
      <p class="sub-hint">把值得记住的日子放进共同时间线。</p>
      <div class="field row">
        <div style="flex:1">
          <label for="memory-date">日期</label>
          <input id="memory-date" type="date" value="${today()}" />
        </div>
        <div style="flex:1">
          <label for="memory-kind">类型</label>
          <select id="memory-kind">
            <option>关系节点</option><option>旅行</option><option>事件</option><option selected>其它</option>
          </select>
        </div>
      </div>
      <div class="field">
        <label for="memory-title">标题</label>
        <input id="memory-title" type="text" maxlength="50" placeholder="比如：第一次一起旅行" />
      </div>
      <div class="field">
        <label for="memory-desc">想记住的细节（可选）</label>
        <textarea id="memory-desc" rows="4" maxlength="500" placeholder="当时发生了什么、最难忘的是什么…"></textarea>
      </div>
      <div class="inline-error" role="alert"></div>
      <div class="btns">
        <button type="button" data-close>取消</button>
        <button type="button" class="primary" data-save>保存时光</button>
      </div>
    </div>`);
  mask.querySelector('[data-close]').addEventListener('click', () => mask._close());
  mask.querySelector('[data-save]').addEventListener('click', async event => {
    const error = mask.querySelector('.inline-error');
    error.textContent = '';
    const button = event.currentTarget;
    setBusy(button, true, '保存中…', '保存时光');
    try {
      const item = await store.createTimelineItem({
        date: mask.querySelector('#memory-date').value,
        kind: mask.querySelector('#memory-kind').value,
        title: mask.querySelector('#memory-title').value,
        desc: mask.querySelector('#memory-desc').value,
      });
      mask._close();
      toast('已放进时间线', { soft: true });
      if (onDone) onDone(item);
    } catch (err) {
      error.textContent = err.message;
      setBusy(button, false, '保存中…', '保存时光');
    }
  });
}

export function openRelationshipSheet({ data, onDone } = {}) {
  const meta = data && data.meta || {};
  const names = meta.partnerNames || {};
  const mask = openDialog(`
    <div class="modal composer-sheet relationship-sheet">
      <h3>我们的关系资料</h3>
      <p class="sub-hint">用于首页天数计算，只保存在当前浏览器。</p>
      <div class="field">
        <label for="relationship-date">开始日期</label>
        <input id="relationship-date" type="date" max="${today()}" value="${escapeHtml(meta.startDate || '')}" />
      </div>
      <div class="field row">
        <div style="flex:1">
          <label for="relationship-male">他的称呼</label>
          <input id="relationship-male" type="text" maxlength="12" value="${escapeHtml(names.male || '')}" placeholder="他" />
        </div>
        <div style="flex:1">
          <label for="relationship-female">她的称呼</label>
          <input id="relationship-female" type="text" maxlength="12" value="${escapeHtml(names.female || '')}" placeholder="她" />
        </div>
      </div>
      <div class="field">
        <label for="relationship-name">这段关系的称呼</label>
        <input id="relationship-name" type="text" maxlength="12" value="${escapeHtml(meta.anniversaryName || '在一起')}" placeholder="在一起" />
      </div>
      <div class="inline-error" role="alert"></div>
      <div class="btns">
        <button type="button" data-close>取消</button>
        <button type="button" class="primary" data-save>保存资料</button>
      </div>
    </div>`);
  mask.querySelector('[data-close]').addEventListener('click', () => mask._close());
  mask.querySelector('[data-save]').addEventListener('click', async event => {
    const error = mask.querySelector('.inline-error');
    const button = event.currentTarget;
    error.textContent = '';
    setBusy(button, true, '保存中…', '保存资料');
    try {
      const profile = await store.updateRelationshipProfile({
        startDate: mask.querySelector('#relationship-date').value,
        maleName: mask.querySelector('#relationship-male').value,
        femaleName: mask.querySelector('#relationship-female').value,
        anniversaryName: mask.querySelector('#relationship-name').value,
      });
      mask._close();
      toast('关系资料已更新', { soft: true });
      if (onDone) onDone(profile);
    } catch (err) {
      error.textContent = err.message;
      setBusy(button, false, '保存中…', '保存资料');
    }
  });
}

export function openMessageSheet({ onDone } = {}) {
  const meSide = store.getMeSide();
  const otherLabel = sideLabel(meSide === 'male' ? 'female' : 'male');
  const mask = openDialog(`
    <div class="modal composer-sheet">
      <h3>写一封留言</h3>
      <div class="me-stamp ${meSide}">由${sideLabel(meSide)}写下</div>
      <div class="field">
        <label>写给谁</label>
        <div class="seg composer-seg" data-recipient>
          <button type="button" class="active" data-value="other" aria-pressed="true">给${otherLabel}</button>
          <button type="button" data-value="双方" aria-pressed="false">给我们</button>
        </div>
      </div>
      <div class="field">
        <label for="message-mood">此刻心情</label>
        <select id="message-mood">
          <option>日常</option><option>甜</option><option>想念</option><option>抱歉</option><option>鼓励</option><option>其它</option>
        </select>
      </div>
      <div class="field">
        <label for="message-text">想说的话</label>
        <textarea id="message-text" rows="6" maxlength="1000" placeholder="不用组织得很完美，真诚就好。"></textarea>
      </div>
      <label class="switch">
        <input type="checkbox" id="message-pinned" />
        <span>置顶这封留言</span>
      </label>
      <div class="inline-error" role="alert"></div>
      <div class="btns">
        <button type="button" data-close>取消</button>
        <button type="button" class="primary" data-save>送出去</button>
      </div>
    </div>`);
  const recipient = mask.querySelector('[data-recipient]');
  recipient.addEventListener('click', event => {
    const button = event.target.closest('button[data-value]');
    if (!button) return;
    recipient.querySelectorAll('button').forEach(item => {
      item.classList.toggle('active', item === button);
      item.setAttribute('aria-pressed', String(item === button));
    });
  });
  mask.querySelector('[data-close]').addEventListener('click', () => mask._close());
  mask.querySelector('[data-save]').addEventListener('click', async event => {
    const error = mask.querySelector('.inline-error');
    error.textContent = '';
    const button = event.currentTarget;
    setBusy(button, true, '送出中…', '送出去');
    try {
      const message = await store.createMessage({
        to: recipient.querySelector('button.active').dataset.value,
        mood: mask.querySelector('#message-mood').value,
        text: mask.querySelector('#message-text').value,
        pinned: mask.querySelector('#message-pinned').checked,
      });
      mask._close();
      toast('留言已送出', { soft: true });
      if (onDone) onDone(message);
    } catch (err) {
      error.textContent = err.message;
      setBusy(button, false, '送出中…', '送出去');
    }
  });
}

export function openPhotoSheet({ onDone } = {}) {
  let selectedFile = null;
  let previewUrl = null;
  const clearPreview = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = null;
  };
  const mask = openDialog(`
    <div class="modal composer-sheet">
      <h3>收藏一张照片</h3>
      <p class="sub-hint">照片只保存在当前浏览器，导出备份时会一起打包。</p>
      <div class="field">
        <label>选择照片</label>
        <input id="photo-file" type="file" accept="image/*" hidden />
        <button type="button" class="media-picker" data-pick>
          <span class="media-picker-icon" aria-hidden="true">＋</span>
          <span data-pick-label>从设备选择</span>
        </button>
        <div class="photo-preview" hidden><img alt="待添加照片预览" /></div>
      </div>
      <div class="field row">
        <div style="flex:1">
          <label for="photo-date">日期</label>
          <input id="photo-date" type="date" value="${today()}" />
        </div>
        <div style="flex:2">
          <label for="photo-caption">说明（可选）</label>
          <input id="photo-caption" type="text" maxlength="80" placeholder="这张照片的故事" />
        </div>
      </div>
      <div class="inline-error" role="alert"></div>
      <div class="btns">
        <button type="button" data-close>取消</button>
        <button type="button" class="primary" data-save>加入相册</button>
      </div>
    </div>`, clearPreview);
  const fileInput = mask.querySelector('#photo-file');
  mask.querySelector('[data-pick]').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    const error = mask.querySelector('.inline-error');
    if (!file.type.startsWith('image/')) { error.textContent = '请选择图片文件'; return; }
    if (file.size > 15 * 1024 * 1024) { error.textContent = '单张照片请控制在 15MB 以内'; return; }
    error.textContent = '';
    selectedFile = file;
    clearPreview();
    previewUrl = URL.createObjectURL(file);
    const preview = mask.querySelector('.photo-preview');
    preview.hidden = false;
    preview.querySelector('img').src = previewUrl;
    mask.querySelector('[data-pick-label]').textContent = file.name;
  });
  mask.querySelector('[data-close]').addEventListener('click', () => mask._close());
  mask.querySelector('[data-save]').addEventListener('click', async event => {
    const error = mask.querySelector('.inline-error');
    error.textContent = '';
    if (!selectedFile) { error.textContent = '先选择一张照片'; return; }
    const button = event.currentTarget;
    setBusy(button, true, '处理中…', '加入相册');
    let meta = null;
    try {
      meta = await attachments.putAttachment(selectedFile);
      const photo = await store.createPhoto(meta, {
        date: mask.querySelector('#photo-date').value,
        caption: mask.querySelector('#photo-caption').value,
      });
      mask._close();
      toast('照片已收藏', { soft: true });
      if (onDone) onDone(photo);
    } catch (err) {
      if (meta) await attachments.deleteBlob(meta.storeKey);
      error.textContent = err.message || '照片保存失败';
      setBusy(button, false, '处理中…', '加入相册');
    }
  });
}

function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
}
