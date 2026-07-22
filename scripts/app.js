// =========================================================================
// app.js — 应用入口：4 tab 装载 + 路由 + 主题/身份切换 + 首页聚合
// =========================================================================
import { pendingAction } from './status-machine.js';
import { daysUntil, humanizeDays, prettyDate } from './date-math.js';
import * as daysTogether from './days-together.js';
import * as commBook from './comm-book.js';
import * as timeline from './timeline.js';
import * as photoWall from './photo-wall.js';
import * as messages from './messages.js';
import * as editor from './editor.js';
import * as memoryEditor from './memory-editor.js';
import { escapeHtml } from './util.js';
import * as store from './store.js';
import { sideLabel } from './schema.js';

const THEMES = ['scrapbook', 'minimal', 'starry', 'kawaii'];
const TABS = [
  { id: 'home',     label: '首页',   ico: '🏠' },
  { id: 'comm',     label: '沟通簿', ico: '📒' },
  { id: 'timeline', label: '时光',   ico: '🕰️' },
  { id: 'message',  label: '留言',   ico: '💌' },
];

let data = null;
let activeTab = 'home';
let tlSubtab = 'timeline'; // timeline | album

async function boot() {
  restoreTheme();
  try { data = await store.load(); }
  catch (e) {
    document.getElementById('app').innerHTML = `<div class="empty">无法加载数据：${escapeHtml(e.message)}<br>请用 <code>python3 -m http.server 8000</code> 启动后访问 http://localhost:8000</div>`;
    return;
  }
  renderShell();
  renderTab();
  // 首页状态条随 store 变化刷新
  store.onStoreChanged(() => { if (activeTab === 'home') renderHome(); });
}

function renderShell() {
  const app = document.getElementById('app');
  const meSide = store.getMeSide();
  app.innerHTML = `
    <button type="button" class="avatar" id="avatar" aria-label="打开设置，当前身份：${sideLabel(meSide)}" title="设置 / 身份 / 主题">
      <span class="dot ${meSide}" aria-hidden="true"></span>
    </button>
    <div class="me-banner ${meSide}" aria-live="polite">当前以 · ${sideLabel(meSide)} · 身份操作</div>
    <header class="app-header">
      <h1>我们的</h1>
      <p>一次事件 · 双方视角 · 共同面对</p>
    </header>
    <div class="wrap">
      <div class="view" id="view-home"></div>
      <div class="view" id="view-comm"></div>
      <div class="view" id="view-timeline"></div>
      <div class="view" id="view-message"></div>
    </div>
    <button type="button" class="fab" id="fab" aria-label="新增沟通记录" title="记一笔" style="display:none"><span aria-hidden="true">+</span></button>
    <nav class="tabbar" aria-label="主导航">
      ${TABS.map(t => `<button type="button" data-tab="${t.id}" class="${t.id === activeTab ? 'active' : ''}"${t.id === activeTab ? ' aria-current="page"' : ''}><span class="ico" aria-hidden="true">${t.ico}</span>${t.label}</button>`).join('')}
    </nav>
    <footer class="app-foot">${data.meta && data.meta.partnerNames ? `${escapeHtml(data.meta.partnerNames.male)} & ${escapeHtml(data.meta.partnerNames.female)}` : ''} · 最后更新 ${prettyDate(data.updatedAt)}</footer>
  `;
  app.querySelector('.tabbar').addEventListener('click', e => {
    const b = e.target.closest('button[data-tab]');
    if (!b) return;
    activeTab = b.dataset.tab;
    renderTab();
  });
  app.querySelector('#avatar').addEventListener('click', openSettings);
  app.querySelector('#fab').addEventListener('click', openAddEntry);
}

function renderTab() {
  ['home', 'comm', 'timeline', 'message'].forEach(id => {
    const el = document.getElementById(`view-${id}`);
    el.classList.toggle('active', activeTab === id);
  });
  document.querySelectorAll('.tabbar button').forEach(b => {
    const current = b.dataset.tab === activeTab;
    b.classList.toggle('active', current);
    if (current) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
  const fab = document.getElementById('fab');
  // FAB 仅在沟通簿 tab 且沟通模式
  if (fab) fab.style.display = (activeTab === 'comm' && store.getCommMode() === 'comm') ? '' : 'none';

  if (activeTab === 'home') renderHome();
  else if (activeTab === 'comm') commBook.mount(document.getElementById('view-comm'));
  else if (activeTab === 'timeline') renderTimeline();
  else if (activeTab === 'message') messages.mount(document.getElementById('view-message'));
}

function renderHomeStats(liveData) {
  const counts = {
    comm: (liveData.entries || []).length,
    tl: (liveData.timeline || []).length,
    photo: (liveData.photos || []).length,
    msg: (liveData.messages || []).length,
  };
  const tiles = [
    { n: counts.comm, label: '件沟通', goto: 'comm' },
    { n: counts.tl, label: '段时光', goto: 'timeline' },
    { n: counts.photo, label: '张照片', goto: 'album' },
    { n: counts.msg, label: '封留言', goto: 'message' },
  ];
  return `<section class="home-stats" aria-label="一起记录的总量">
    ${tiles.map(t => `<button type="button" class="home-stat" data-stat-go="${t.goto}">
      <strong>${t.n}</strong><small>${t.label}</small>
    </button>`).join('')}
  </section>`;
}

function renderHome() {
  const el = document.getElementById('view-home');
  const liveData = store.getCachedSync() || data;
  daysTogether.mount(el, liveData, {
    onEdit: () => memoryEditor.openRelationshipSheet({
      data: liveData,
      onDone: async () => {
        data = await store.load();
        renderShell();
        renderTab();
        document.querySelector('[data-edit-relationship]')?.focus();
      },
    }),
  });

  el.insertAdjacentHTML('beforeend', `
    <div class="home-quick-actions" aria-label="快捷记录">
      <button type="button" data-home-action="comm"><span aria-hidden="true">＋</span><strong>记一笔</strong><small>沟通事件</small></button>
      <button type="button" data-home-action="timeline"><span aria-hidden="true">◇</span><strong>记时光</strong><small>共同回忆</small></button>
      <button type="button" data-home-action="message"><span aria-hidden="true">✉</span><strong>写留言</strong><small>留给彼此</small></button>
    </div>`);

  // R3 F3: 一起记录的总量统计——纯展示聚合，不写 store 不碰 schema
  el.insertAdjacentHTML('beforeend', renderHomeStats(liveData));

  // 纪念日倒计时——R3-issue5: 「管理」入口独立于 anns 渲染，anniversaries 为空或全部过期时也常驻。
  const anns = (liveData.anniversaries || [])
    .map(a => ({ ...a, days: daysUntil(a.date, a.recurring === '每年') }))
    .filter(a => a.days !== null && a.days >= 0)
    .sort((a, b) => a.days - b.days);
  const manageAnniversaries = () => memoryEditor.openRelationshipSheet({
    data: liveData,
    onDone: async () => {
      data = await store.load();
      renderShell();
      renderTab();
      document.querySelector('[data-edit-anniversaries]')?.focus();
    },
  });
  if (anns.length) {
    const a = anns[0];
    el.insertAdjacentHTML('beforeend', `
      <section class="home-milestone">
        <span>下一个纪念日</span>
        <strong>${escapeHtml(a.title)}</strong>
        <em>${humanizeDays(a.days)}</em>
        <button type="button" class="home-milestone-manage" data-edit-anniversaries aria-label="管理纪念日" title="管理纪念日">管理</button>
      </section>`);
  } else {
    el.insertAdjacentHTML('beforeend', `
      <section class="home-milestone home-milestone-empty">
        <span>还没有纪念日</span>
        <strong>添加一个值得记的日子</strong>
        <em>第一次见面 · 在一起那天 · 生日…</em>
        <button type="button" class="home-milestone-manage" data-edit-anniversaries aria-label="添加或管理纪念日" title="添加或管理纪念日">管理</button>
      </section>`);
  }
  el.querySelector('[data-edit-anniversaries]')?.addEventListener('click', manageAnniversaries);

  const meSide = store.getMeSide();
  const entries = liveData.entries || [];
  const open = entries
    .map(e => ({ e, act: pendingAction(e, meSide) }))
    .filter(x => x.act);
  const unread = (liveData.messages || []).filter(message => store.isMessageUnread(message, meSide));

  el.insertAdjacentHTML('beforeend', `
    <section class="home-section" aria-labelledby="home-attention-title">
      <div class="home-section-head">
        <h2 id="home-attention-title">今天要一起处理</h2>
        <span>${open.length + unread.length ? `${open.length + unread.length} 项` : '已清空'}</span>
      </div>
      <div class="home-attention" data-attention></div>
    </section>`);
  const attention = el.querySelector('[data-attention]');
  if (open.length) {
    const x = open[0];
    attention.insertAdjacentHTML('beforeend', `
      <button type="button" class="home-task urgent" data-entry="${escapeHtml(x.e.id)}">
        <span class="home-task-icon" aria-hidden="true">${x.act === 'confirm' ? '✓' : '↔'}</span>
        <span><strong>${x.act === 'confirm' ? '有约定等你确认' : '对方在等你的回应'}</strong><small>${escapeHtml(x.e.title)}</small></span>
        <span class="home-task-arrow" aria-hidden="true">→</span>
      </button>`);
    attention.querySelector('[data-entry]').addEventListener('click', () => {
      activeTab = 'comm';
      location.hash = `#entry-${x.e.id}`;
      renderTab();
      setTimeout(() => { location.hash = ''; }, 1500);
    });
  }

  if (unread.length) {
    attention.insertAdjacentHTML('beforeend', `
      <button type="button" class="home-task" data-go="message">
        <span class="home-task-icon" aria-hidden="true">✉</span>
        <span><strong>有 ${unread.length} 条给你的留言</strong><small>去读读对方写下的话</small></span>
        <span class="home-task-arrow" aria-hidden="true">→</span>
      </button>`);
    attention.querySelector('[data-go="message"]').addEventListener('click', () => {
      activeTab = 'message';
      renderTab();
    });
  }
  if (!open.length && !unread.length) {
    attention.innerHTML = `<div class="home-all-clear"><span aria-hidden="true">✓</span><div><strong>今天没有待处理的事</strong><small>好好享受普通的一天</small></div></div>`;
  }

  const tl = (liveData.timeline || []).slice().sort((a, b) => (a.date < b.date ? 1 : -1));
  if (tl.length) {
    const t = tl[0];
    el.insertAdjacentHTML('beforeend', `
      <section class="home-section">
        <div class="home-section-head"><h2>最近时光</h2><span>${prettyDate(t.date)}</span></div>
        <button type="button" class="home-memory" data-go="timeline">
          <span class="home-memory-date">${prettyDate(t.date)}</span>
          <span><strong>${escapeHtml(t.title)}</strong>${t.desc ? `<small>${escapeHtml(t.desc)}</small>` : ''}</span>
          <span aria-hidden="true">→</span>
        </button>
      </section>`);
    el.querySelector('[data-go="timeline"]').addEventListener('click', () => { activeTab = 'timeline'; tlSubtab = 'timeline'; renderTab(); });
  }

  el.querySelector('[data-home-action="comm"]').addEventListener('click', openAddEntry);
  el.querySelector('[data-home-action="timeline"]').addEventListener('click', () => {
    memoryEditor.openTimelineSheet({ onDone: () => { activeTab = 'timeline'; tlSubtab = 'timeline'; renderTab(); } });
  });
  el.querySelector('[data-home-action="message"]').addEventListener('click', () => {
    memoryEditor.openMessageSheet({ onDone: () => { activeTab = 'message'; renderTab(); } });
  });

  // R3 F3: 统计 tile 跳转——comm→沟通簿、timeline/album→时光（相册/时间线）、message→留言
  el.querySelectorAll('[data-stat-go]').forEach(btn => {
    btn.addEventListener('click', () => {
      const go = btn.dataset.statGo;
      if (go === 'comm') { activeTab = 'comm'; renderTab(); }
      else if (go === 'message') { activeTab = 'message'; renderTab(); }
      else if (go === 'timeline') { activeTab = 'timeline'; tlSubtab = 'timeline'; renderTab(); }
      else if (go === 'album') { activeTab = 'timeline'; tlSubtab = 'album'; renderTab(); }
    });
  });
}

function renderTimeline() {
  const el = document.getElementById('view-timeline');
  el.innerHTML = `
    <div class="subtabs" role="tablist" aria-label="时光视图">
      <button type="button" role="tab" aria-selected="${tlSubtab==='timeline'}" data-sub="timeline" class="${tlSubtab==='timeline'?'active':''}">时间线</button>
      <button type="button" role="tab" aria-selected="${tlSubtab==='album'}" data-sub="album" class="${tlSubtab==='album'?'active':''}">相册</button>
    </div>
    <div id="tl-content"></div>`;
  el.querySelector('.subtabs').addEventListener('click', e => {
    const b = e.target.closest('button[data-sub]');
    if (!b) return;
    tlSubtab = b.dataset.sub;
    renderTimeline();
  });
  const content = el.querySelector('#tl-content');
  if (tlSubtab === 'timeline') timeline.mount(content);
  else photoWall.mount(content);
}

// —— 设置 modal：身份 / 主题 / 备份 ——
function openSettings() {
  const meSide = store.getMeSide();
  const curTheme = localStorage.getItem('love:theme') || 'scrapbook';
  const mask = document.createElement('div');
  mask.className = 'modal-mask';
  mask.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <h3 id="settings-title">设置</h3>
      <p class="single-hint" style="margin-bottom:12px">⚠ 单机模拟：身份切换仅本地标记。同一浏览器切换身份=模拟对方视角，不等同对方真的在场。</p>
      <p style="color:var(--muted);font-size:13px;margin-bottom:8px">当前身份</p>
      <div class="subtabs" style="margin-bottom:16px">
        <button type="button" data-side="male" aria-pressed="${meSide==='male'}" class="${meSide==='male'?'active':''}">我是男方</button>
        <button type="button" data-side="female" aria-pressed="${meSide==='female'}" class="${meSide==='female'?'active':''}">我是女方</button>
      </div>
      <p style="color:var(--muted);font-size:13px;margin-bottom:8px">主题</p>
      <div class="subtabs" style="margin-bottom:16px">${THEMES.map(t =>
        `<button type="button" data-theme="${t}" aria-pressed="${curTheme===t}" class="${curTheme===t?'active':''}">${themeName(t)}</button>`).join('')}</div>
      <p style="color:var(--muted);font-size:13px;margin-bottom:8px">数据备份（本地存储）</p>
      <div class="btns" style="justify-content:flex-start;margin-top:0;margin-bottom:8px">
        <button type="button" id="bk-export">导出备份</button>
        <button type="button" id="bk-import">导入备份</button>
        <button type="button" id="bk-reset" class="danger">重置为种子</button>
      </div>
      <input type="file" id="bk-file" accept=".json,application/json" style="display:none" />
      <div class="btns"><button type="button" class="primary" id="set-done">完成</button></div>
    </div>`;
  editor.activateDialog(mask, () => {
    renderShell();
    renderTab();
    document.getElementById('avatar').focus();
  });
  mask.addEventListener('click', e => {
    const sb = e.target.closest('button[data-side]');
    if (sb) { store.setMeSide(sb.dataset.side); mask.querySelectorAll('button[data-side]').forEach(x => {
      x.classList.toggle('active', x === sb);
      x.setAttribute('aria-pressed', String(x === sb));
    }); }
    const tb = e.target.closest('button[data-theme]');
    if (tb) { applyTheme(tb.dataset.theme); mask.querySelectorAll('button[data-theme]').forEach(x => {
      x.classList.toggle('active', x === tb);
      x.setAttribute('aria-pressed', String(x === tb));
    }); }
    if (e.target.id === 'set-done') mask._close();
    if (e.target.id === 'bk-export') doExport();
    if (e.target.id === 'bk-import') mask.querySelector('#bk-file').click();
    if (e.target.id === 'bk-reset') doReset();
  });
  mask.querySelector('#bk-file').addEventListener('change', e => {
    const f = e.target.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = async () => {
      try { await store.importFromJSON(r.result); editor.toast('导入成功'); setTimeout(location.reload, 800); }
      catch (err) { editor.toast('导入失败：' + err.message); }
    };
    r.readAsText(f);
  });
}

function doExport() {
  store.exportJSON().then(json => {
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `love-backup-${new Date().toISOString().slice(0,10)}.json`;
    a.click(); URL.revokeObjectURL(url);
    editor.toast('已导出备份');
  });
}

function doReset() {
  editor.openGuardSheet({
    title: '重置为种子？',
    hint: '将清空本地所有沟通簿写入，恢复到 data.json 初始状态。已归档记录会丢失。',
    confirmText: '重置',
    danger: true,
    onConfirm: async () => {
      await store.resetToSeed();
      editor.toast('已重置');
      setTimeout(() => location.reload(), 800);
    },
  });
}

function openAddEntry() {
  editor.openAddSheet({
    onDone: () => {
      activeTab = 'comm';
      renderTab();
    },
  });
}

// —— 主题 ——
function themeName(t) {
  return { scrapbook: '手账风', minimal: '极简', starry: '星空', kawaii: '可爱' }[t];
}
function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  localStorage.setItem('love:theme', t);
  const darkScrapbook = t === 'scrapbook' && window.matchMedia?.('(prefers-color-scheme: dark)').matches;
  const themeColors = {
    scrapbook: darkScrapbook ? '#161B19' : '#F4F6F5',
    minimal: '#FAFAF8',
    starry: '#14132B',
    kawaii: '#FFF7F2',
  };
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = themeColors[t] || themeColors.scrapbook;
}
function restoreTheme() {
  applyTheme(localStorage.getItem('love:theme') || 'scrapbook');
}

boot();
