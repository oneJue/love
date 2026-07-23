// =========================================================================
// comm-book.js — 沟通簿模块（T2）· 可点化重构
// 读 store（localStorage 持久化），5 态筛选，状态×身份按钮矩阵，
// 事件委托 data-act → dispatchAction → editor sheet / store 写。
// 按钮文案绝不出现"同意"二字（INV-9）。永不硬删（删只走 deleteEntryIfFresh）。
// =========================================================================

import * as store from './store.js';
import * as editor from './editor.js';
import { computeStatus, pendingAction } from './status-machine.js';
import { prettyDate } from './date-math.js';
import { escapeHtml, sameId } from './util.js';

let activeFilter = '全部';
let showShelved = false;

const COPY = {
  addView: '补充我的视角',
  editView: '改我的视角',
  draftAgree: '起草约定',
  editAgree: '改约定',
  editNote: '改我说的话',
  confirm: '我确认',
  shelve: '先放放',
  restore: '重新激活',
  reopen: '重新打开',
};

export function mount(el) {
  render(el);
  // store 变更后重渲染
  if (!el._wired) {
    el._wired = true;
    store.onStoreChanged(() => { if (document.getElementById('view-comm') === el) render(el); });
  }
  // 事件委托（render 会重建内部 DOM，委托挂在根 el 一次即可）
  bindActions(el);
}

function viewNote(view, label, side) {
  if (!view) view = { text: '' };
  const text = (view.text || '').trim();
  return `
    <div class="view-note ${side}">
      <span class="vlabel">${label}</span>
      <div class="vtext">${text ? escapeHtml(text) : '<span class="vempty">还没写</span>'}</div>
    </div>`;
}

// —— 留痕时间线渲染（history：at/by/summary，永不硬删的追溯承诺）——
function renderHistory(entry, mode) {
  const hist = Array.isArray(entry.history) ? entry.history : [];
  if (!hist.length) return '';
  // 最新在前，便于一眼看到最近一次操作
  const rows = hist.slice().reverse().map(h => {
    const when = h.at ? fmtHistory(h.at) : '';
    const who = h.by ? escapeHtml(h.by) : '';
    return `<li class="hist-row">
      <span class="hist-when">${escapeHtml(when)}</span>
      ${who ? `<span class="hist-by ${whoClass(h.by)}">${who}</span>` : ''}
      <span class="hist-what">${escapeHtml(h.summary || '')}</span>
    </li>`;
  }).join('');
  return `<details class="entry-history${hist.length ? ' open-nudge' : ''}"${mode === 'review' ? ' open' : ''}>
    <summary>留痕 · 共 ${hist.length} 次</summary>
    <ol class="hist-list">${rows}</ol>
  </details>`;
}

function fmtHistory(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  } catch { return ''; }
}

function whoClass(by) {
  if (by === '男方') return 'm';
  if (by === '女方') return 'f';
  return 'sys';
}

// —— 事实层渲染（description + 附件缩略图，排在视角层之前）——
function renderFact(entry, mode) {
  const desc = entry.description && entry.description.text && entry.description.text.trim();
  const atts = entry.attachments || [];
  if (!desc && !atts.length) {
    // 无事实层内容：除非已和解只读，否则给个柔提示引导补
    if (mode === 'review') return '';
    return `<section class="entry-section fact-layer empty-fact"><h3>发生了什么</h3><div class="fact-empty">还没有客观描述 · <button type="button" class="link-btn" data-act="edit-fact">现在补充</button></div></section>`;
  }
  return `
    <section class="entry-section fact-layer">
      <h3>发生了什么</h3>
      ${desc ? `<div class="fact-desc">${escapeHtml(desc)}</div>` : ''}
      ${atts.length ? `<div class="attach-grid">
        ${atts.map(a => `
          <div class="attach-box" data-att="${a.id}">
            ${a.thumb
              ? `<img src="${a.thumb}" alt="${escapeHtml(a.name||'')}" data-lightbox="${a.id}" loading="lazy">`
              : `<div class="no-thumb">${escapeHtml((a.name||'附件').slice(0,6))}</div>`}
          </div>`).join('')}
      </div>` : ''}
    </section>`;
}

function confirmRow(entry, side, whoLabel, meSide, mode) {
  const c = entry.confirmations && entry.confirmations[side];
  const done = c && c.confirmed;
  const status = computeStatus(entry);
  // 仅"待确认"状态 + 本侧 + 未确认 + 沟通模式，才挂确认按钮
  const canConfirm = mode === 'comm' && status === '待确认' && side === meSide && !done;
  return `
    <div class="confirm-row ${side} ${done ? 'done' : 'pending'}">
      <span class="ck"></span>
      <span class="who">${whoLabel}</span>
      ${canConfirm
        ? `<button type="button" class="action-btn primary" data-act="confirm" data-side="${side}">${COPY.confirm}</button>`
        : (done && c.at ? `<span class="at">${fmtTime(c.at)}</span>` : '<span class="at">待确认</span>')}
    </div>`;
}

function todoBadge(entry, meSide) {
  const act = pendingAction(entry, meSide);
  if (!act) return '';
  const txt = act === 'write-view' ? '等你补充视角' : '等你确认';
  return `<span class="todo-badge">${txt}</span>`;
}

// 状态 × 身份 操作矩阵 → HTML
function entryActions(entry, meSide, mode) {
  if (mode === 'review') return '';
  const status = computeStatus(entry);
  const mySideKey = meSide;
  const myView = entry[`${mySideKey}View`] || {};
  const myViewText = (myView.text || '').trim();
  const otherSideKey = meSide === 'male' ? 'female' : 'male';
  const otherView = entry[`${otherSideKey}View`] || {};
  const otherViewText = (otherView.text || '').trim();
  const agText = (entry.agreement && entry.agreement.text || '').trim();
  const myConf = entry.confirmations && entry.confirmations[meSide];
  const myConfirmed = myConf && myConf.confirmed;
  const btn = (act, label, cls = '', disabled = false, dataSide = '') =>
    `<button type="button" class="action-btn ${cls}" ${disabled ? 'disabled' : ''} data-act="${act}"${dataSide ? ` data-side="${dataSide}"` : ''}>${label}</button>`;

  // 待确认：显示"已确认·等对方"正文态（非按钮）
  let actions = [];
  if (status === '已搁置') {
    actions.push(btn('restore', COPY.restore, 'ghost'));
  } else if (status === '已和解') {
    actions.push(btn('reopen', COPY.reopen, 'ghost'));
  } else {
    // 事实层（任一方可补/改）
    actions.push(btn('edit-fact', '事实层', 'ghost'));
    // 视角侧
    if (!myViewText) actions.push(btn('add-view', COPY.addView, 'primary'));
    else if (!otherViewText || computeStatus(entry) !== '沟通中') {
      // 已写视角且有空间改（非万象锁）
      if (status !== '待确认' || !myConfirmed) actions.push(btn('edit-view', COPY.editView, 'ghost'));
    }
    // 约定
    if (!agText) {
      const bothViews = myViewText && otherViewText;
      actions.push(btn('draft-agreement', COPY.draftAgree, bothViews ? 'primary' : '', !bothViews));
    } else {
      actions.push(btn('edit-agreement', COPY.editAgree, 'ghost'));
    }
    // 附言
    if (agText && (!myConfirmed || status === '待确认')) {
      actions.push(btn('edit-note', COPY.editNote, 'ghost'));
    }
    // 先放放
    actions.push(btn('shelve', COPY.shelve, 'ghost'));
  }
  if (!actions.length) return '';
  return `<div class="entry-actions">${actions.join('')}</div>`;
}

function entryCard(entry, meSide, mode) {
  const status = computeStatus(entry);
  const agText = entry.agreement && entry.agreement.text && entry.agreement.text.trim();
  const mNote = entry.maleNote && entry.maleNote.text && entry.maleNote.text.trim();
  const fNote = entry.femaleNote && entry.femaleNote.text && entry.femaleNote.text.trim();
  const sealed = status === '已和解';
  const shelved = status === '已搁置';
  const viewCount = [entry.maleView, entry.femaleView].filter(view => view && view.text && view.text.trim()).length;
  const factReady = Boolean(entry.description && entry.description.text && entry.description.text.trim() || (entry.attachments || []).length);

  let actHint = '';
  const pa = pendingAction(entry, meSide);
  if (pa === 'write-view') actHint = '对方已写视角，等你补充你的';
  else if (pa === 'confirm') actHint = '约定已起草，等你确认';

  return `
    <div class="entry ${shelved ? 'shelved' : ''}" data-id="${entry.id}" data-status="${status}">
      <div class="entry-topline">
        <div class="entry-meta">
          <span class="entry-id">NO. ${entry.id}</span>
          <time class="entry-date" datetime="${escapeHtml(entry.occurrenceDate)}">${prettyDate(entry.occurrenceDate)}</time>
          <span class="entry-who ${entry.raisedBy === '男方' ? 'male' : 'female'}">${escapeHtml(entry.raisedBy)}提出</span>
          ${entry.severity ? `<span class="entry-severity">${escapeHtml(entry.severity)}</span>` : ''}
        </div>
        <span class="status ${status}">${status}</span>
      </div>
      <h2 class="entry-title">${escapeHtml(entry.title)}</h2>
      ${shelved && entry.shelvedReason ? `<div class="shelved-banner">先放放了：${escapeHtml(entry.shelvedReason.slice(0, 24))}</div>` : ''}
      ${actHint ? `<div class="entry-next">${todoBadge(entry, meSide)}<span>${actHint}</span></div>` : ''}
      <details class="entry-context"${mode === 'review' ? ' open' : ''}>
        <summary>
          <span>事件与双方视角</span>
          <small>${factReady ? '事实已记录' : '待补事实'} · ${viewCount}/2 份视角</small>
        </summary>
        <div class="entry-context-body">
          ${renderFact(entry, mode)}
          <section class="entry-section perspectives">
            <h3>两个人的视角</h3>
            <div class="views">
              ${viewNote(entry.maleView, '他的视角', 'm')}
              ${viewNote(entry.femaleView, '她的视角', 'f')}
            </div>
          </section>
          ${!agText && (mNote || fNote) ? `<div class="context-notes">
            ${mNote ? `<p><strong>男方：</strong>${escapeHtml(mNote)}</p>` : ''}
            ${fNote ? `<p><strong>女方：</strong>${escapeHtml(fNote)}</p>` : ''}
          </div>` : ''}
          ${renderHistory(entry, mode)}
        </div>
      </details>
      ${agText ? `<section class="entry-section result">
        <div class="result-head"><h3>共同约定</h3><span>${agText ? '等待双方确认' : '下一步'}</span></div>
        <div class="rtext">${escapeHtml(entry.agreement.text)}</div>
        ${(mNote || fNote) ? `<div class="rsub">
          ${mNote ? `<span class="rlabel">男方说</span><div class="rtext">${escapeHtml(mNote)}</div>` : ''}
          ${fNote ? `<span class="rlabel">女方说</span><div class="rtext">${escapeHtml(fNote)}</div>` : ''}
        </div>` : ''}
        <div class="confirms">
          ${confirmRow(entry, 'male', '男方', meSide, mode)}
          ${confirmRow(entry, 'female', '女方', meSide, mode)}
        </div>
        ${sealed ? '<div class="seal">和解</div>' : ''}
        ${sealed ? '<div class="archived-stamp">已归档</div>' : ''}
      </section>` : ''}
      ${entryActions(entry, meSide, mode)}
    </div>`;
}

// —— 云模式 3s 轮询会 innerHTML 全量重建列表，用户在 comm 模式下展开的
//   <details>（事件与双方视角 / 留痕）每轮被折叠、阅读被打断。这里在重建前后
//   按 entryId 捕获/还原 open 态（progressive enhancement：DOM 不支持时静默跳过）。——
function captureOpenDetails(root) {
  const map = Object.create(null); // entryId -> Set<details 首类名>
  const cards = root.querySelectorAll('.entry[data-id]');
  for (const card of cards) {
    const id = card.getAttribute('data-id');
    if (id == null) continue;
    const opens = new Set();
    const ds = card.querySelectorAll('details[open]');
    for (const d of ds) {
      const cls = (d.className || '').split(/\s+/)[0];
      if (cls) opens.add(cls);
    }
    if (opens.size) map[id] = opens;
  }
  return map;
}

function restoreOpenDetails(root, map) {
  for (const id of Object.keys(map)) {
    const card = root.querySelector(`.entry[data-id="${id}"]`);
    if (!card) continue;
    for (const cls of map[id]) {
      const d = card.querySelector(`details.${cls}`);
      if (d && !d.hasAttribute('open')) d.setAttribute('open', '');
    }
  }
}

function render(el) {
  store.load().then(data => {
    // 重建前捕获用户已展开的 <details>（云模式轮询重渲染会折叠它们）
    let openMap;
    try { openMap = captureOpenDetails(el); } catch (_) { openMap = Object.create(null); }
    const entries = (data.entries || []).map(marshall);
    const meSide = store.getMeSide();
    const mode = store.getCommMode();
    if (location.hash.startsWith('#entry-')) activeFilter = '全部';

    const filters = ['全部', '待沟通', '沟通中', '待确认', '已和解', '已搁置'];
    const filterBar = `<div class="filters" aria-label="按状态筛选">${filters.map(f =>
      `<button type="button" aria-pressed="${activeFilter === f}" class="${activeFilter === f ? 'active' : ''}" data-f="${f}">${f}</button>`).join('')}</div>`;

    // 排序：有待办动作的置顶，其余按 createdAt 倒序
    const sorted = entries.slice().sort((a, b) => {
      const pa = pendingAction(a, meSide) ? 1 : 0;
      const pb = pendingAction(b, meSide) ? 1 : 0;
      if (pa !== pb) return pb - pa;
      return (a.createdAt < b.createdAt) ? 1 : -1;
    });

    let list = sorted;
    const shelvedCount = sorted.filter(e => computeStatus(e) === '已搁置').length;
    if (activeFilter === '全部') {
      list = sorted.filter(e => computeStatus(e) !== '已搁置' || showShelved);
    } else {
      list = sorted.filter(e => computeStatus(e) === activeFilter);
    }

    const listHtml = list.length
      ? list.map(e => entryCard(e, meSide, mode)).join('')
      : `<div class="empty">${activeFilter === '全部' && !showShelved && shelvedCount
          ? '没有进行中的记录'
          : activeFilter === '全部'
            ? '还没有记录，点右下角 + 记一笔'
            : '该状态下暂无记录'}</div>`;

    const activeCount = sorted.filter(entry => !['已和解', '已搁置'].includes(computeStatus(entry))).length;
    const modeToggle = `<div class="mode-switch" aria-label="沟通簿模式">
      <button type="button" aria-pressed="${mode === 'comm'}" data-mode="comm" class="${mode === 'comm' ? 'active' : ''}">沟通</button>
      <button type="button" aria-pressed="${mode === 'review'}" data-mode="review" class="${mode === 'review' ? 'active' : ''}">回忆</button>
    </div>`;

    const shelvedToggle = shelvedCount && activeFilter === '全部'
      ? `<button type="button" class="toggle-shelved" data-toggle>${showShelved ? '隐藏搁置' : `显示搁置 (${shelvedCount})`}</button>`
      : '';

    el.innerHTML = `
      <div class="comm-toolbar">
        <div><h2>沟通簿</h2><p>${activeCount ? `${activeCount} 件事正在一起面对` : '最近没有悬而未决的事'}</p></div>
        ${modeToggle}
      </div>
      ${filterBar}${shelvedToggle}<div class="entry-list">${listHtml}</div>`;

    // 重建后还原展开态（review 模式模板已带 open；comm 模式用户展开态借此保留）
    try { restoreOpenDetails(el, openMap); } catch (_) {}

    // 事件委托
    el.querySelector('.mode-switch').addEventListener('click', e => {
      const b = e.target.closest('button[data-mode]'); if (!b) return;
      store.setCommMode(b.dataset.mode);
      const fab = document.getElementById('fab');
      if (fab) fab.style.display = b.dataset.mode === 'comm' ? '' : 'none';
      render(el);
    });
    const tBtn = el.querySelector('[data-toggle]');
    if (tBtn) tBtn.addEventListener('click', () => { showShelved = !showShelved; render(el); });
    el.querySelector('.filters').addEventListener('click', e => {
      const b = e.target.closest('button[data-f]'); if (!b) return;
      activeFilter = b.dataset.f; render(el);
    });

    // 锚点闪烁
    if (location.hash.startsWith('#entry-')) {
      const id = location.hash.slice('#entry-'.length);
      const card = el.querySelector(`.entry[data-id="${id}"]`);
      // OS 减弱动效时跳过平滑滚动：CSS scroll-behavior 兜底拦不住 JS 显式 behavior:'smooth'。
      // matchMedia 存在性短路兼容旧环境 / 测试 stub（render-smoke location.hash='' 不进此分支）。
      const reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
      if (card) { card.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
        card.classList.add('flash'); setTimeout(() => card.classList.remove('flash'), 1400); }
    }
  }).catch(err => {
    el.innerHTML = `<div class="empty">无法加载：${escapeHtml(err.message)}<br>请用 <code>python3 -m http.server 8000</code> 启动</div>`;
  });
}

// 派生 status 注入（store 已保证一致；此为兜底）
function marshall(e) { e.status = computeStatus(e); return e; }

// 事件委托入口（由 mount 渲染后 app 绑定，或本模块绑定）
export function bindActions(rootEl) {
  if (rootEl._bound) return;
  rootEl._bound = true;
  rootEl.addEventListener('click', e => {
    // 附件删除（openFactSheet 内的已有附件 ×）
    const delB = e.target.closest('[data-del]');
    if (delB) {
      const card = delB.closest('.entry');
      const id = card && card.dataset.id;
      const attId = delB.dataset.del;
      if (id && attId) removeAttachment(id, attId);
      e.stopPropagation(); return;
    }
    // lightbox 大图查看
    const lb = e.target.closest('[data-lightbox]');
    if (lb) {
      const card = lb.closest('.entry');
      const entry = card && store.getEntry(card.dataset.id);
      const attId = lb.dataset.lightbox;
      const meta = entry && (entry.attachments || []).find(a => sameId(a.id, attId));
      if (meta) openLightbox(meta);
      e.stopPropagation(); return;
    }
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const card = b.closest('.entry');
    const id = card && card.dataset.id;
    if (!id) return;
    dispatchAction(b.dataset.act, id, b.dataset.side, b);
  });
}

// —— 附件：删除（元数据 + IDB blob）——
async function removeAttachment(entryId, attId) {
  const entry = store.getEntry(entryId);
  const meta = entry && (entry.attachments || []).find(a => sameId(a.id, attId));
  // 先删 blob，再删元数据并留痕
  try { if (meta) await (await import('./attachments.js')).deleteBlob(meta.storeKey); } catch (_) {}
  store.removeAttachment(entryId, store.getMeSide(), attId).catch(err => editor.toast(err.message));
}

// —— lightbox 大图（走 activateDialog，统一 Esc/焦点/滚动锁，与相册 viewer 对齐）——
async function openLightbox(meta) {
  const attMod = await import('./attachments.js');
  let src = meta.thumb || null;
  try {
    const blob = await attMod.getBlob(meta.storeKey);
    if (blob) src = URL.createObjectURL(blob);
  } catch (_) {}
  if (!src) { editor.toast('无法查看原图'); return; }
  const mask = document.createElement('div');
  mask.className = 'lightbox-mask';
  const altText = meta.name || meta.caption || '附件图片';
  mask.innerHTML = `
    <div class="modal photo-viewer" role="document">
      <h3 class="sr-only">查看原图</h3>
      <button class="photo-viewer-close" type="button" aria-label="关闭">×</button>
      <img src="${src}" alt="${escapeHtml(altText)}">
    </div>`;
  editor.activateDialog(mask, () => { if (src && src.startsWith('blob:')) URL.revokeObjectURL(src); });
  mask.querySelector('.photo-viewer-close').addEventListener('click', () => mask._close());
}

function dispatchAction(act, id, side, btn) {
  const meSide = store.getMeSide();
  const entry = store.getEntry(id);
  if (!entry) return;
  if (act === 'add-view' || act === 'edit-view') {
    editor.openViewSheet({ entry, meSide, onDone: () => {} });
  } else if (act === 'edit-fact') {
    editor.openFactSheet({ entry, meSide, onDone: () => {} });
  } else if (act === 'draft-agreement' || act === 'edit-agreement') {
    editor.openAgreementSheet({ entry, meSide, edit: act === 'edit-agreement', onDone: () => {} });
  } else if (act === 'edit-note') {
    editor.openNoteSheet({ entry, meSide, onDone: () => {} });
  } else if (act === 'confirm') {
    // 云模式往返 200-1000ms：立即置 busy 防重复点击，并给"点了有反应"的即时反馈
    const origText = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.setAttribute('aria-busy', 'true'); btn.textContent = '确认中…'; }
    store.setMyConfirm(id, meSide).then(updated => {
      if (computeStatus(updated) === '已和解') {
        editor.toast('对齐了 · 和解', { soft: true, duration: 4000 });
      } else {
        editor.toast('已确认', { duration: 5000, onUndo: () => store.unconfirmMine(id, meSide).catch(() => {}) });
      }
    }).catch(err => editor.toast(err.message)).finally(() => {
      // store 写入会触发 broadcast → render 重建列表，原按钮通常已脱离 DOM；
      // 仅在仍连接时还原（失败路径或未重渲染时避免留下死锁的 disabled 按钮）
      if (btn && btn.isConnected) { btn.disabled = false; btn.removeAttribute('aria-busy'); btn.textContent = origText; }
    });
  } else if (act === 'shelve') {
    editor.openGuardSheet({
      title: '先放放这一笔？',
      hint: '随时可以重新激活。给自己留一句话，说明为什么先放放。',
      requireReason: true,
      reasonPlaceholder: '为什么先放放…',
      confirmText: '先放放',
      danger: true,
      onConfirm: reason => store.shelveEntry(id, meSide, reason)
        .then(() => editor.toast('已搁置', { duration: 8000, onUndo: () => store.restoreEntry(id, meSide).catch(() => {}) }))
        .catch(err => editor.toast(err.message)),
    });
  } else if (act === 'restore') {
    editor.openGuardSheet({
      title: '重新激活搁置的条目？',
      hint: '会回到搁置前的状态继续。',
      confirmText: '重新激活',
      onConfirm: () => store.restoreEntry(id, meSide).catch(err => editor.toast(err.message)),
    });
  } else if (act === 'reopen') {
    editor.openGuardSheet({
      title: '重新打开已和解的条目？',
      hint: '约定和确认会清空，回到沟通中重新来过。',
      confirmText: '重新打开',
      danger: true,
      onConfirm: () => store.reopenEntry(id, meSide).catch(err => editor.toast(err.message)),
    });
  }
}

function fmtTime(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  } catch { return ''; }
}
