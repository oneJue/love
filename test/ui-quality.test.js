import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

test('Q-1 首页未读留言提示可跳转到留言页', () => {
  const source = read('scripts/app.js');
  assert.match(source, /\[data-go="message"\][\s\S]*activeTab = 'message'/);
});

test('Q-2 主导航和设置入口具备可访问语义', () => {
  const source = read('scripts/app.js');
  assert.match(source, /<nav class="tabbar" aria-label="主导航">/);
  assert.match(source, /<button type="button" class="avatar"[^>]+aria-label=/);
  assert.match(source, /aria-current="page"/);
});

test('Q-3 编辑弹窗支持 Escape、焦点恢复和滚动锁定', () => {
  const source = read('scripts/editor.js');
  assert.match(source, /event\.key === 'Escape'/);
  assert.match(source, /previousFocus\.focus\(\)/);
  assert.match(source, /classList\.add\('modal-open'\)/);
});

test('Q-4 表单字号不会触发 iOS 自动缩放', () => {
  const source = read('styles/editor.css');
  assert.match(source, /\.field textarea \{[\s\S]*font-size: 16px;/);
});

test('Q-5 时光、留言和相册均提供页面内新增入口', () => {
  assert.match(read('scripts/timeline.js'), /data-new-memory/);
  assert.match(read('scripts/messages.js'), /data-new-message/);
  assert.match(read('scripts/photo-wall.js'), /data-new-photo/);
});

test('Q-6 首页提供日期编辑，沟通簿上下文可折叠', () => {
  assert.match(read('scripts/days-together.js'), /data-edit-relationship/);
  assert.match(read('scripts/comm-book.js'), /entry-context/);
});

test('Q-7 回忆模式切换会同步更新新增按钮', () => {
  const source = read('scripts/comm-book.js');
  assert.match(source, /fab\.style\.display = b\.dataset\.mode === 'comm'/);
});

test('Q-8 全局搜索覆盖全部记录类型并支持快捷键', () => {
  const source = read('scripts/app.js');
  assert.match(source, /liveData\.entries[\s\S]*liveData\.timeline[\s\S]*liveData\.photos[\s\S]*liveData\.messages[\s\S]*liveData\.anniversaries/);
  assert.match(source, /event\.metaKey \|\| event\.ctrlKey/);
  assert.match(source, /id="global-search"[^>]+aria-label="搜索所有记录"/);
});

test('Q-9 首页采用品牌首屏与内容浏览双栏结构', () => {
  const source = read('scripts/app.js');
  assert.match(source, /class="home-intro"/);
  assert.match(source, /className = 'home-dashboard'/);
  assert.match(source, /className = 'home-secondary'/);
  assert.match(source, /className = 'home-primary'/);
});
