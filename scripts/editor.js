// =========================================================================
// editor.js — 交互组件：表单 sheet / 二次确认 / toast
// 独立于 app.js/comm-book.js，纯 UI。回调里调 store 写函数。
// 手账风，复用 base.css 的 .modal/.modal-mask，新增 sheet 专用类（见 styles/editor.css）。
// 界面文案绝不出现"同意"二字（INV-9）。
// =========================================================================

import * as store from './store.js';
import { sideLabel } from './schema.js';
import * as att from './attachments.js';
import { escapeHtml, sameId } from './util.js';

let dialogId = 0;

// 为 app 内所有弹窗提供一致的焦点、键盘和页面滚动行为。
export function activateDialog(mask, onClose) {
  const previousFocus = document.activeElement;
  const dialog = mask.querySelector('.modal, [role="dialog"]');
  const heading = dialog && dialog.querySelector('h1, h2, h3');
  if (dialog) {
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
  }
  if (dialog && heading) {
    if (!heading.id) heading.id = `dialog-title-${++dialogId}`;
    dialog.setAttribute('aria-labelledby', heading.id);
  }

  let closed = false;
  const close = (value) => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKeydown);
    mask.remove();
    if (!document.querySelector('.modal-mask')) document.body.classList.remove('modal-open');
    // 云模式 3s 轮询会重建 origin 按钮的父卡片，previousFocus 可能已脱离 DOM，
    // focus() 静默失败落回 <body>。先校验 isConnected，否则兜底到可见的导航控件，
    // 键盘用户不必每次关弹窗都重新 tab 定位。
    if (previousFocus && previousFocus.isConnected && previousFocus.focus) {
      previousFocus.focus();
    } else {
      document.querySelector('.avatar, .fab, .tabbar button[aria-current]')?.focus();
    }
    if (onClose) onClose(value);
  };
  const onKeydown = (event) => {
    const masks = document.querySelectorAll('.modal-mask');
    if (masks[masks.length - 1] !== mask) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== 'Tab' || !dialog) return;
    const focusable = [...dialog.querySelectorAll('button:not([disabled]), input:not([type="hidden"]):not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])')]
      .filter(el => !el.hidden && el.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };

  mask._close = close;
  mask.addEventListener('click', event => { if (event.target === mask) close(); });
  document.addEventListener('keydown', onKeydown);
  document.body.classList.add('modal-open');
  document.body.appendChild(mask);
  const initialFocus = dialog && dialog.querySelector('[autofocus], input:not([type="hidden"]):not([disabled]), textarea:not([disabled]), button:not([disabled])');
  if (initialFocus && initialFocus.focus) initialFocus.focus();
  return mask;
}

// —— 通用：挂一个全屏遮罩 ——
function openMask(className, innerHTML, onClose) {
  const mask = document.createElement('div');
  mask.className = `modal-mask ${className || ''}`;
  mask.innerHTML = innerHTML;
  return activateDialog(mask, onClose);
}

// —— 新建条目 sheet ——
export function openAddSheet({ onDone } = {}) {
  const meSide = store.getMeSide();
  const label = sideLabel(meSide);
  const today = new Date().toISOString().slice(0, 10);
  const mask = openMask('', `
    <div class="modal add-sheet">
      <h3>记一笔</h3>
      <div class="me-stamp ${meSide}">当前以 · ${label} · 身份操作</div>
      <div class="field">
        <label>标题</label>
        <input data-k="title" type="text" maxlength="40" placeholder="一句话概括这件事" />
      </div>
      <div class="field row">
        <div style="flex:1">
          <label>发生日期</label>
          <input data-k="occurrenceDate" type="date" value="${today}" />
        </div>
        <div>
          <label>严重度</label>
          <div class="seg" data-seg="severity">
            <button data-v="小事" type="button">小事</button>
            <button data-v="一般" class="active" type="button">一般</button>
            <button data-v="重要" type="button">重要</button>
          </div>
        </div>
      </div>
      <div class="fact-divider">事实层 · 发生了什么</div>
      <div class="field">
        <label>事件描述</label>
        <textarea data-k="description" rows="3" placeholder="客观写下发生了什么，不带情绪。这是你们共同的事实底。"></textarea>
      </div>
      <div class="field">
        <label>背景附件（可选）</label>
        <input type="file" id="add-files" accept="image/*" multiple hidden />
        <button type="button" class="action-btn ghost" id="add-pick">＋ 加一张背景（聊天截图/照片）</button>
        <p class="single-hint">帮你们都看清楚当时发生了什么，背景参考用，不是对质证据。</p>
        <div class="attach-preview" id="add-attach-preview"></div>
      </div>
      <div class="fact-divider">视角层 · 各自怎么想</div>
      <div class="field">
        <label>我的视角（${label}）</label>
        <textarea data-k="view" rows="4" placeholder="写写你眼里发生了什么、你的感受。对方稍后会写 TA 的。"></textarea>
      </div>
      <label class="switch">
        <input type="checkbox" data-k="coLocated" />
        <span>我们正坐在一起（同时填对方视角）</span>
      </label>
      <div class="field co-located hidden">
        <label>TA 的视角（${meSide === 'male' ? '女方' : '男方'}）</label>
        <textarea data-k="viewOther" rows="3" placeholder="代 TA 把 TA 的视角也写上"></textarea>
      </div>
      <p class="single-hint">单机模拟：提交后以"${label}"身份记下。要让对方补充视角，去右上角头像切换身份。</p>
      <div class="inline-error" id="add-err" role="alert"></div>
      <div class="btns">
        <button type="button" id="add-cancel">取消</button>
        <button type="button" class="primary" id="add-save">记一笔</button>
      </div>
    </div>`);

  const seg = mask.querySelector('[data-seg="severity"]');
  seg.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    seg.querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b));
  });
  mask.querySelector('[data-k="coLocated"]').addEventListener('change', e => {
    mask.querySelector('.field.co-located').classList.toggle('hidden', !e.target.checked);
  });
  // —— 附件选择（暂存内存，提交时落 IDB）——
  const pendingFiles = [];
  const previewEl = mask.querySelector('#add-attach-preview');
  mask.querySelector('#add-pick').addEventListener('click', () => mask.querySelector('#add-files').click());
  mask.querySelector('#add-files').addEventListener('change', async e => {
    for (const f of e.target.files) {
      if (!f.type.startsWith('image/')) { toast('只支持图片附件'); continue; }
      pendingFiles.push(f);
      const url = URL.createObjectURL(f);
      const chip = document.createElement('div');
      chip.className = 'attach-chip';
      chip.innerHTML = `<img src="${url}" alt=""><span>${escapeHtml(f.name)}</span><button type="button">×</button>`;
      chip.querySelector('button').addEventListener('click', () => {
        const i = pendingFiles.indexOf(f); if (i >= 0) pendingFiles.splice(i, 1);
        URL.revokeObjectURL(url); chip.remove();
      });
      previewEl.appendChild(chip);
    }
    e.target.value = '';
  });
  mask.querySelector('#add-cancel').addEventListener('click', () => mask._close());

  mask.querySelector('#add-save').addEventListener('click', async () => {
    const errEl = mask.querySelector('#add-err');
    errEl.textContent = '';
    const title = mask.querySelector('[data-k="title"]').value.trim();
    const occurrenceDate = mask.querySelector('[data-k="occurrenceDate"]').value || today;
    const description = mask.querySelector('[data-k="description"]').value.trim();
    const view = mask.querySelector('[data-k="view"]').value.trim();
    const coLocated = mask.querySelector('[data-k="coLocated"]').checked;
    const viewOther = mask.querySelector('[data-k="viewOther"]').value.trim();
    const severity = seg.querySelector('button.active').dataset.v;
    if (!title) { errEl.textContent = '写个标题吧'; return; }
    if (!view && !(coLocated && viewOther) && !description) { errEl.textContent = '至少写事件描述或一方视角'; return; }
    if (coLocated && !viewOther) { errEl.textContent = '勾选了一起记，请把对方视角也填上'; return; }
    const btn = mask.querySelector('#add-save');
    btn.disabled = true; btn.textContent = '记一笔中…';
    try {
      const entry = await store.createEntry({ title, occurrenceDate, severity, description, view, coLocated, viewOther });
      // 提交后落附件到 IDB 并写入元数据；收集实际落盘的 meta，撤回时按它清理 blob
      const savedMetas = [];
      for (const f of pendingFiles) {
        try {
          const meta = await att.putAttachment(f);
          await store.addAttachment(entry.id, meSide, meta);
          savedMetas.push(meta);
        } catch (err) { console.error('附件保存失败', f.name, err); }
      }
      mask._close();
      toast('已记一笔', { duration: 5000, onUndo: () => store.deleteEntryIfFresh(entry.id).then(() => {
        // 撤回时清理刚落的附件 blob（createEntry 返回的 entry.attachments 是初始空数组，故用 savedMetas）
        savedMetas.forEach(m => att.deleteBlob(m.storeKey));
      }).catch(err => toast('撤回失败：' + err.message, { duration: 6000 })) });
      onDone && onDone(entry);
    } catch (err) {
      errEl.textContent = err.message; btn.disabled = false; btn.textContent = '记一笔';
    }
  });
}

// —— 补事实层 sheet（已建条目补描述/附件，任一方可写）——
export function openFactSheet({ entry, meSide, onDone }) {
  const label = sideLabel(meSide);
  const desc = entry.description || { text: '' };
  const mask = openMask('', `
    <div class="modal">
      <h3>补事实层（任一方可写）</h3>
      <p class="sub-hint">「${escapeHtml(entry.title)}」· 客观发生了什么，不带情绪。</p>
      <div class="field">
        <label>事件描述</label>
        <textarea id="fs-desc" rows="4" placeholder="客观写下发生了什么">${escapeHtml(desc.text || '')}</textarea>
      </div>
      <div class="field">
        <label>背景附件</label>
        <input type="file" id="fs-files" accept="image/*" multiple hidden />
        <button type="button" class="action-btn ghost" id="fs-pick">＋ 加背景图片</button>
        <div class="attach-preview" id="fs-preview"></div>
        ${renderExistingAttach(entry)}
      </div>
      <p class="single-hint">当前以 ${label} 身份操作（事实层任一方可写）。</p>
      <div class="btns">
        <button type="button" id="fs-cancel">取消</button>
        <button type="button" class="primary" id="fs-save">保存</button>
      </div>
    </div>`);
  const pendingFiles = [];
  const previewEl = mask.querySelector('#fs-preview');
  mask.querySelector('#fs-pick').addEventListener('click', () => mask.querySelector('#fs-files').click());
  mask.querySelector('#fs-files').addEventListener('change', e => {
    for (const f of e.target.files) {
      if (!f.type.startsWith('image/')) continue;
      pendingFiles.push(f);
      const url = URL.createObjectURL(f);
      const chip = document.createElement('div');
      chip.className = 'attach-chip';
      chip.innerHTML = `<img src="${url}" alt=""><span>${escapeHtml(f.name)}</span><button type="button">×</button>`;
      chip.querySelector('button').addEventListener('click', () => {
        const i = pendingFiles.indexOf(f); if (i >= 0) pendingFiles.splice(i, 1);
        URL.revokeObjectURL(url); chip.remove();
      });
      previewEl.appendChild(chip);
    }
    e.target.value = '';
  });
  mask.querySelectorAll('[data-del]').forEach(button => {
    button.addEventListener('click', async () => {
      const attId = button.dataset.del;
      const current = store.getEntry(entry.id);
      const meta = current && (current.attachments || []).find(item => sameId(item.id, attId));
      button.disabled = true;
      try {
        if (meta) await att.deleteBlob(meta.storeKey);
        await store.removeAttachment(entry.id, meSide, attId);
        const box = button.closest('.attach-box');
        if (box) box.remove();
      } catch (err) {
        button.disabled = false;
        toast(err.message || '附件移除失败');
      }
    });
  });
  mask.querySelector('#fs-cancel').addEventListener('click', () => mask._close());
  mask.querySelector('#fs-save').addEventListener('click', async () => {
    const btn = mask.querySelector('#fs-save');
    const text = mask.querySelector('#fs-desc').value.trim();
    // 云模式往返期间置 busy，防重复点击触发多次 writeDescription/IDB blob 落盘 + 广播风暴
    btn.disabled = true; btn.textContent = '保存中…';
    try {
      if (text !== (desc.text || '')) await store.writeDescription(entry.id, meSide, text);
      for (const f of pendingFiles) {
        try { const meta = await att.putAttachment(f); await store.addAttachment(entry.id, meSide, meta); }
        catch (err) { console.error(err); }
      }
      mask._close();
      onDone && onDone();
    } catch (err) {
      btn.disabled = false; btn.textContent = '保存';
      toast(err.message);
    }
  });
}

function renderExistingAttach(entry) {
  const list = entry.attachments || [];
  if (!list.length) return '';
  return `<div class="existing-attach"><p class="single-hint" style="margin:8px 0">已添加</p>
    <div class="attach-grid">${list.map(a => `
      <div class="attach-box" data-att="${a.id}">
        ${a.thumb ? `<img src="${a.thumb}" alt="">` : '<div class="no-thumb">文件</div>'}
        <button class="att-del" data-del="${a.id}" type="button">×</button>
      </div>`).join('')}</div></div>`;
}

// —— 补充/修改视角 sheet ——
export function openViewSheet({ entry, meSide, onDone }) {
  const side = meSide;
  const label = sideLabel(side);
  const view = entry[`${side}View`] || { text: '' };
  const existing = (view.text || '').trim();
  const mask = openMask('', `
    <div class="modal">
      <h3>${existing ? '修改我的视角' : '补充我的视角'}（${label}）</h3>
      <p class="sub-hint">「${escapeHtml(entry.title)}」</p>
      <div class="field">
        <textarea id="vs-text" rows="6" placeholder="写下你眼里发生了什么、你的感受">${escapeHtml(view.text || '')}</textarea>
      </div>
      <p class="single-hint">单机模拟：仅以${label}身份写入这一侧。</p>
      <div class="btns">
        <button type="button" id="vs-cancel">取消</button>
        <button type="button" class="primary" id="vs-save">保存</button>
      </div>
    </div>`);
  mask.querySelector('#vs-cancel').addEventListener('click', () => mask._close());
  mask.querySelector('#vs-save').addEventListener('click', async () => {
    const text = mask.querySelector('#vs-text').value.trim();
    if (!text) return;
    const btn = mask.querySelector('#vs-save');
    btn.disabled = true; btn.textContent = '保存中…';
    try {
      await store.writeView(entry.id, side, text);
      mask._close();
      onDone && onDone();
    } catch (err) {
      btn.disabled = false; btn.textContent = '保存';
      toast(err.message);
    }
  });
}

// —— 起草/修改约定 sheet ——
export function openAgreementSheet({ entry, meSide, edit, onDone }) {
  const label = sideLabel(meSide);
  const agreement = entry.agreement || { text: '' };
  const myNote = entry[`${meSide}Note`] || { text: '' };
  const otherSide = meSide === 'male' ? 'female' : 'male';
  const otherLabel = sideLabel(otherSide);
  const otherNote = entry[`${otherSide}Note`] || { text: '' };
  const mask = openMask('', `
    <div class="modal">
      <h3>${edit ? '修改' : '起草'}我们的约定</h3>
      <p class="sub-hint">约定是两人中立达成的内容，任一方可写。修改会让双方确认自动重置。</p>
      <div class="field">
        <label>我们的约定</label>
        <textarea id="ag-text" rows="4" placeholder="我们要一起达成的事，比如：…">${escapeHtml(agreement.text || '')}</textarea>
      </div>
      <div class="field">
        <label>我（${label}）想说的话（可选）</label>
        <textarea id="ag-note" rows="2" placeholder="道歉、接纳、补充都行">${escapeHtml(myNote.text || '')}</textarea>
      </div>
      <div class="field">
        <label>${otherLabel}想说的话</label>
        <textarea rows="2" disabled placeholder="${otherNote.text ? escapeHtml(otherNote.text) : '对方会在这里补充'}"></textarea>
      </div>
      <div class="btns">
        <button type="button" id="ag-cancel">取消</button>
        <button type="button" class="primary" id="ag-save">保存约定</button>
      </div>
    </div>`);
  mask.querySelector('#ag-cancel').addEventListener('click', () => mask._close());
  mask.querySelector('#ag-save').addEventListener('click', async () => {
    const btn = mask.querySelector('#ag-save');
    const text = mask.querySelector('#ag-text').value.trim();
    const note = mask.querySelector('#ag-note').value.trim();
    const changed = (agreement.text || '') !== text;
    btn.disabled = true; btn.textContent = '保存中…';
    try {
      await store.writeAgreement(entry.id, meSide, text);
      if (note !== (myNote.text || '')) await store.writeNote(entry.id, meSide, note);
      mask._close();
      if (changed && text) toast('改了约定，双方需重新确认');
      onDone && onDone();
    } catch (err) {
      btn.disabled = false; btn.textContent = '保存约定';
      toast(err.message);
    }
  });
}

// —— 改附言注 sheet ——
export function openNoteSheet({ entry, meSide, onDone }) {
  const label = sideLabel(meSide);
  const note = entry[`${meSide}Note`] || { text: '' };
  const mask = openMask('', `
    <div class="modal">
      <h3>修改我说的话（${label}）</h3>
      <div class="field">
        <textarea id="nt-text" rows="4" placeholder="道歉、接纳、补充…">${escapeHtml(note.text || '')}</textarea>
      </div>
      <div class="btns">
        <button type="button" id="nt-cancel">取消</button>
        <button type="button" class="primary" id="nt-save">保存</button>
      </div>
    </div>`);
  mask.querySelector('#nt-cancel').addEventListener('click', () => mask._close());
  mask.querySelector('#nt-save').addEventListener('click', async () => {
    const btn = mask.querySelector('#nt-save');
    const text = mask.querySelector('#nt-text').value.trim();
    btn.disabled = true; btn.textContent = '保存中…';
    try {
      await store.writeNote(entry.id, meSide, text);
      mask._close();
      onDone && onDone();
    } catch (err) {
      btn.disabled = false; btn.textContent = '保存';
      toast(err.message);
    }
  });
}

// —— 二次确认（搁置填理由 / 恢复 / 重新打开 / 重置）——
export function openGuardSheet({ title, hint, requireReason = false, reasonPlaceholder = '', confirmText = '确认', danger = false, onConfirm }) {
  const mask = openMask('', `
    <div class="modal">
      <h3>${escapeHtml(title)}</h3>
      ${hint ? `<p class="sub-hint">${escapeHtml(hint)}</p>` : ''}
      ${requireReason ? `<div class="field"><textarea id="gd-reason" rows="2" placeholder="${escapeHtml(reasonPlaceholder)}"></textarea></div>` : ''}
      <div class="btns">
        <button type="button" id="gd-cancel">取消</button>
        <button type="button" class="${danger ? 'danger' : 'primary'}" id="gd-go" disabled>${escapeHtml(confirmText)}</button>
      </div>
    </div>`);
  const goBtn = mask.querySelector('#gd-go');
  const reasonEl = mask.querySelector('#gd-reason');
  if (reasonEl) {
    reasonEl.addEventListener('input', () => { goBtn.disabled = !reasonEl.value.trim(); });
  } else {
    goBtn.disabled = false;
  }
  mask.querySelector('#gd-cancel').addEventListener('click', () => mask._close());
  goBtn.addEventListener('click', () => {
    mask._close();
    onConfirm && onConfirm(reasonEl ? reasonEl.value.trim() : undefined);
  });
}

// —— toast（温和提示，soft=极轻收尾，onUndo=带撤回）——
let toastTimer = null;
export function toast(text, { soft = false, duration = 4000, onUndo = null } = {}) {
  const old = document.querySelector('.toast');
  if (old) {
    // 保护撤回入口：带 onUndo 的 toast 期间若只来一条轻量状态提示，直接让位会丢失
    // 破坏性/不可逆操作的唯一撤回路径——保留旧 toast，不替换。
    if (old._hasUndo && !onUndo) return;
    // 旧 toast 优雅淡出（复用其 dismiss），而不是硬切 remove，与 .show 渐入对称
    if (old._dismiss) old._dismiss();
    else old.remove();
  }
  if (toastTimer) { clearTimeout(toastTimer); toastTimer = null; }
  const el = document.createElement('div');
  el.className = `toast ${soft ? 'soft' : ''}`;
  el.setAttribute('role', soft ? 'status' : 'alert');
  el.setAttribute('aria-live', soft ? 'polite' : 'assertive');
  el.innerHTML = `<span class="t-text">${escapeHtml(text)}</span>${onUndo ? '<button type="button" class="undo-btn">撤回</button>' : ''}<button type="button" class="t-close" aria-label="关闭">×</button>`;
  el._hasUndo = !!onUndo;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  const dismiss = () => { el.classList.remove('show'); setTimeout(() => el.remove(), 200); };
  el._dismiss = dismiss;
  el.querySelector('.t-close').addEventListener('click', dismiss);
  if (onUndo) {
    el.querySelector('.undo-btn').addEventListener('click', () => { dismiss(); onUndo(); });
  }
  toastTimer = setTimeout(dismiss, duration);
}
