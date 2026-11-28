/* ============================================================================
   程序员避坑指南 · 界面流程冒烟测试
   用 test/dom-shim.js 提供的小型 DOM，把 index.html + shared.js + data.js + core.js + app.js
   按浏览器里的顺序加载进来，再把主要流程走一遍，确认逻辑没有跑偏、没有抛错。
   ========================================================================== */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createWindow } = require('./dom-shim.js');

const APP = path.join(__dirname, '..');
const DESIGN = path.join(APP, '..', '..', 'design');
const ENTRIES = require('../data.js').entries;
const TOTAL = ENTRIES.length;
const BY_ID = Object.fromEntries(ENTRIES.map((entry) => [entry.id, entry]));
const READ_KEY = 'zdx:pitfalls:read';
const LAST_KEY = 'zdx:pitfalls:last';
const lf = (text) => String(text).replace(/\r\n?/g, '\n');

function boot(options) {
  options = options || {};
  const handle = createWindow(fs.readFileSync(path.join(APP, 'index.html'), 'utf8'), options.storage);
  if (options.narrow) handle.mq.narrow = true;
  if (options.read) handle.storage.set(READ_KEY, JSON.stringify(options.read));
  if (options.last) handle.storage.set(LAST_KEY, JSON.stringify(options.last));

  const context = vm.createContext(handle.window);
  const files = [['shared.js', DESIGN], ['data.js', APP], ['core.js', APP], ['app.js', APP]];
  for (const [file, dir] of files) {
    vm.runInContext(fs.readFileSync(path.join(dir, file), 'utf8'), context, { filename: file });
  }
  handle.$ = (id) => handle.document.getElementById(id);
  return handle;
}

const $ = (h, id) => h.document.getElementById(id);
const all = (h, selector) => h.document.querySelectorAll(selector);
const one = (h, selector) => h.document.querySelector(selector);
const items = (h) => all(h, '#entry-list .cp-entry');
const currentId = (h) => {
  const button = one(h, '#entry-list .cp-entry[aria-current="page"]');
  return button ? button.getAttribute('data-id') : null;
};
const visibleView = (h) => all(h, '[data-view-panel]').filter((p) => !p.hidden).map((p) => p.getAttribute('data-view-panel'));
const go = (h, view) => one(h, '.nav__item[data-view="' + view + '"]').click();
const chip = (h, groupId, value) => all(h, '#' + groupId + ' .chip').find((b) => b.getAttribute('data-value') === value);
const readMap = (h) => JSON.parse(h.storage.get(READ_KEY) || '{}');
const toasts = (h) => all(h, '.toast-region .toast').map((t) => t.textContent);
const codeText = (block) => Array.from(block.querySelectorAll('.cp-code__line')).map((line) => line.textContent).join('\n');
const tick = () => new Promise((resolve) => setImmediate(resolve));
/* 断言焦点：只比较引用是否同一个，不相等时只报告，不展开两棵 DOM 树 */
function focused(h, node, message) {
  assert.ok(node, message + '（目标节点不存在）');
  assert.ok(h.document.activeElement === node, message + '，实际焦点在：' + describe(h.document.activeElement));
}
function describe(node) {
  if (!node) return '（没有焦点）';
  return node.tagName + (node.id ? '#' + node.id : '') + (node.getAttribute && node.getAttribute('data-id') ? '[' + node.getAttribute('data-id') + ']' : '');
}

/* ==========================================================================
   启动与外壳
   ========================================================================== */

test('界面：启动后停在「开始」，进度、主题卡片、导航计数都来自真实数据', () => {
  const h = boot();
  assert.deepEqual(visibleView(h), ['start']);
  assert.equal($(h, 'view-title').textContent, '开始');
  assert.deepEqual(all(h, '.nav__item[aria-current="page"]').map((b) => b.getAttribute('data-view')), ['start']);
  assert.equal($(h, 'nav-count').textContent, String(TOTAL));
  assert.equal($(h, 'progress-total').textContent, String(TOTAL));
  assert.equal($(h, 'progress-read').textContent, '0');
  assert.equal($(h, 'progress-bar').getAttribute('aria-valuemax'), String(TOTAL));
  assert.equal($(h, 'progress-bar').getAttribute('aria-valuetext'), '已读 0 条，共 ' + TOTAL + ' 条');
  assert.equal($(h, 'progress-bar-fill').style.width, '0%');
  assert.match($(h, 'progress-hint').textContent, /还剩 69 条没读/);

  const cards = all(h, '#topics .cp-topic');
  assert.equal(cards.length, 8, '七个主题加一张“全部条目”');
  assert.deepEqual(cards.slice(0, 7).map((c) => c.querySelector('.cp-topic__name').textContent),
    ['Java 基础', 'Spring 生态', 'Redis', 'MySQL', 'AI 与编程', '工程实践', '职场成长']);
  assert.equal(cards[0].querySelector('.badge').textContent, '10 条');
  assert.equal(cards[6].querySelector('.badge').textContent, '14 条');
  assert.equal(cards[7].querySelector('.badge').textContent, TOTAL + ' 条');
  cards.forEach((card) => assert.ok(card.getAttribute('aria-label').length > 0, '主题卡片要有可读名称'));
  assert.equal($(h, 'read-meta').hidden, false);
  assert.equal($(h, 'topbar-search').hidden, true);
});

test('界面：切换视图时同步面板、aria-current、标题、顶栏按钮和焦点', () => {
  const h = boot();
  go(h, 'entries');
  assert.deepEqual(visibleView(h), ['entries']);
  assert.equal($(h, 'view-title').textContent, '全部条目');
  assert.deepEqual(all(h, '.nav__item[aria-current="page"]').map((b) => b.getAttribute('data-view')), ['entries']);
  assert.equal($(h, 'main').classList.contains('content--wide'), true);
  assert.equal($(h, 'topbar-search').hidden, false);
  focused(h, $(h, 'main'), '切换视图后焦点移到主要内容区');

  go(h, 'about');
  assert.deepEqual(visibleView(h), ['about']);
  assert.equal($(h, 'view-title').textContent, '关于本指南');
  assert.equal($(h, 'main').classList.contains('content--wide'), false);
  assert.equal($(h, 'read-meta').hidden, true, '关于页不显示阅读计数');
  assert.equal($(h, 'topbar-search').hidden, true);
  // 再点一次当前所在的导航项，不抢焦点
  const button = one(h, '.nav__item[data-view="about"]');
  button.focus();
  button.click();
  focused(h, button, '重复点击当前导航项时不抢焦点');
});

test('界面：三个视图都只出现一次，id 不重复', () => {
  const html = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
  const ids = Array.from(html.matchAll(/\sid="([^"]+)"/g)).map((m) => m[1]);
  assert.equal(new Set(ids).size, ids.length, 'index.html 里有重复的 id');
  const views = Array.from(html.matchAll(/data-view-panel="([^"]+)"/g)).map((m) => m[1]);
  assert.deepEqual(views, ['start', 'entries', 'about']);
  const nav = Array.from(html.matchAll(/data-view="([^"]+)"/g)).map((m) => m[1]);
  assert.deepEqual(nav, views, '侧栏导航项和视图一一对应');
});

test('界面：用到的图标都在 icons.html 里，标志在 logos.html 里', () => {
  const icons = new Set(Array.from(fs.readFileSync(path.join(DESIGN, 'icons.html'), 'utf8').matchAll(/<symbol id="i-([^"]+)"/g)).map((m) => m[1]));
  const logos = new Set(Array.from(fs.readFileSync(path.join(DESIGN, 'brand', 'logos.html'), 'utf8').matchAll(/<symbol id="(logo-[^"]+)"/g)).map((m) => m[1]));
  const html = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(APP, 'app.js'), 'utf8');

  for (const [, name] of html.matchAll(/<use href="#i-([^"]+)"/g)) {
    assert.ok(icons.has(name), 'index.html 用到了不存在的图标：i-' + name);
  }
  for (const [, name] of app.matchAll(/icon\('([a-z0-9-]+)'/g)) {
    assert.ok(icons.has(name), 'app.js 用到了不存在的图标：i-' + name);
  }
  for (const [, name] of app.matchAll(/#i-([a-z0-9-]+)/g)) {
    assert.ok(icons.has(name), 'app.js 用到了不存在的图标：i-' + name);
  }
  for (const [, name] of html.matchAll(/<use href="#(logo-[^"]+)"/g)) {
    assert.ok(logos.has(name), 'index.html 用到了不存在的标志：' + name);
  }
});

test('界面：脚本按 data.js → core.js → app.js 的顺序引用，渲染不用 innerHTML', () => {
  const html = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
  const order = Array.from(html.matchAll(/<script src="([^"]+)"/g)).map((m) => m[1]);
  assert.deepEqual(order.slice(-4), ['../../design/shared.js', 'data.js', 'core.js', 'app.js']);
  assert.ok(/data-app="coder-pitfalls"/.test(html));
  const app = fs.readFileSync(path.join(APP, 'app.js'), 'utf8');
  assert.ok(!/\.innerHTML\b|insertAdjacentHTML|document\.write\b|outerHTML\b/.test(app), 'app.js 不应用 innerHTML 一类接口拼接内容');
  assert.ok(/\(function \(\) \{\s*'use strict';/.test(app), 'app.js 用 IIFE 包住并开启严格模式');
});

/* ==========================================================================
   全部条目：列表与阅读区
   ========================================================================== */

test('列表：只渲染前 60 条，滚动到底再追加，当前条目带 aria-current', () => {
  const h = boot();
  go(h, 'entries');

  assert.equal(items(h).length, 60);
  assert.equal($(h, 'result-count').textContent, '共 ' + TOTAL + ' 条');
  assert.equal($(h, 'list-end').textContent, '继续向下滚动，加载后面的 ' + (TOTAL - 60) + ' 条');
  assert.equal($(h, 'list-empty').hidden, true);
  assert.equal(currentId(h), ENTRIES[0].id, '没有打开过任何条目时，选中第一条');
  assert.equal(all(h, '#entry-list .cp-entry[aria-current="page"]').length, 1, '当前条目只有一个');
  assert.equal(items(h)[0].querySelector('.cp-entry__state').textContent, '未读');

  const scroller = $(h, 'list-scroll');
  scroller.scrollTop = 5000;
  h.dispatch(scroller, 'scroll');
  h.advance(0);
  assert.equal(items(h).length, TOTAL);
  assert.equal($(h, 'list-end').textContent, '已全部加载，共 ' + TOTAL + ' 条');
  assert.equal(currentId(h), ENTRIES[0].id, '追加之后当前条目不变');
});

test('阅读区：按顺序显示标题、标签与难度、三段说明、正确做法、反例正例、原则、相关条目', () => {
  const h = boot();
  go(h, 'entries');
  const entry = ENTRIES[0];

  assert.equal($(h, 'reader').hidden, false);
  assert.equal($(h, 'reader-blank').hidden, true);
  assert.equal($(h, 'reader-title').textContent, entry.title);
  assert.deepEqual(all(h, '#reader-meta .badge').map((b) => b.textContent), ['Java 基础', entry.difficulty]);
  assert.equal(one(h, '#reader-meta .cp-reader__tags').textContent, entry.tags.join(' · '));
  assert.equal($(h, 'reader-scenario').textContent, entry.scenario);
  assert.equal($(h, 'reader-symptom').textContent, entry.symptom);
  assert.equal($(h, 'reader-cause').textContent, entry.cause);
  assert.deepEqual(all(h, '#reader-fix li').map((li) => li.textContent), entry.fix);
  assert.equal($(h, 'reader-principle').textContent, entry.principle);
  assert.equal($(h, 'reader-pos').textContent, '第 1 / ' + TOTAL + ' 条');
  assert.equal(one(h, '#example-sec').hidden, false);

  const blocks = all(h, '#reader-examples .code-block');
  assert.equal(blocks.length, 2);
  assert.deepEqual(blocks.map((b) => b.querySelector('.code-block__header span').textContent),
    ['反例 · Java', '正例 · Java']);
  assert.equal(codeText(blocks[0]), lf(entry.example.bad));
  assert.equal(codeText(blocks[1]), lf(entry.example.good));
  blocks.forEach((block) => {
    assert.equal(block.querySelectorAll('.is-key').length, 1, '每段代码恰好标出一行关键行');
    const button = block.querySelector('.code-block__header button');
    assert.equal(button.textContent, '复制代码');
    assert.equal(button.getAttribute('aria-label').slice(0, 2), '复制');
  });

  assert.ok(all(h, '#reader-related .cp-related__link').length >= 1);
  const titles = all(h, '#reader-related .cp-related__title').map((t) => t.textContent);
  entry.related.forEach((id) => assert.ok(titles.includes(BY_ID[id].title), '人工标注的相关条目要排在前面：' + id));
  assert.ok(!titles.includes(entry.title), '相关条目里不该有自己');
});

test('阅读区：没有代码示例的条目隐藏“反例 / 正例”，上一条下一条到头时禁用', () => {
  const h = boot();
  go(h, 'entries');
  const plain = ENTRIES.find((entry) => !entry.example);
  const index = ENTRIES.indexOf(plain);
  items(h)[index].click();
  assert.equal($(h, 'reader-title').textContent, plain.title);
  assert.equal(one(h, '#example-sec').hidden, true);

  assert.equal($(h, 'prev-entry').disabled, index === 0);
  assert.equal($(h, 'next-entry').disabled, index === TOTAL - 1);
  assert.equal($(h, 'next-entry').title, '下一条：' + ENTRIES[index + 1].title);

  $(h, 'prev-entry').click();
  assert.equal(currentId(h), ENTRIES[index - 1].id, '“上一条”按当前列表的顺序走');
  assert.equal($(h, 'reader-title').textContent, ENTRIES[index - 1].title);
  $(h, 'next-entry').click();
  $(h, 'next-entry').click();
  assert.equal(currentId(h), ENTRIES[index + 1].id);
  assert.equal($(h, 'reader-pos').textContent, '第 ' + (index + 2) + ' / ' + TOTAL + ' 条');
  assert.ok(items(h)[index + 1].scrolledIntoView >= 1, '列表跟着滚到当前条目');

  // 一路走到最后一条：它排在 60 条之后，列表要把渲染范围扩到它
  for (let i = 0; i < TOTAL && currentId(h) !== ENTRIES[TOTAL - 1].id; i += 1) $(h, 'next-entry').click();
  assert.equal(currentId(h), ENTRIES[TOTAL - 1].id);
  assert.equal(items(h).length, TOTAL);
  assert.equal($(h, 'next-entry').disabled, true);
  assert.equal($(h, 'next-entry').title, '已经是最后一条');
  assert.equal($(h, 'prev-entry').disabled, false);
});

/* ==========================================================================
   筛选与搜索
   ========================================================================== */

test('筛选：主题、难度、状态可以叠加，结果计数和“清除筛选”跟着变', () => {
  const h = boot();
  go(h, 'entries');
  assert.equal(all(h, '#category-chips .chip').length, 8);
  assert.equal(all(h, '#difficulty-chips .chip').length, 4);
  assert.equal(all(h, '#status-chips .chip').length, 3);
  assert.equal(chip(h, 'category-chips', 'redis').textContent, 'Redis8');

  chip(h, 'category-chips', 'redis').click();
  assert.equal(items(h).length, 8);
  assert.ok(items(h).every((b) => BY_ID[b.getAttribute('data-id')].category === 'redis'));
  assert.equal(chip(h, 'category-chips', 'redis').getAttribute('aria-pressed'), 'true');
  assert.equal(chip(h, 'category-chips', 'all').getAttribute('aria-pressed'), 'false');
  assert.equal($(h, 'result-count').textContent, '筛出 8 条');
  assert.equal($(h, 'clear-filters').hidden, false);
  assert.equal(currentId(h), 'redis-avalanche', '原来的当前条目被筛掉后，退到结果的第一条');

  chip(h, 'category-chips', 'all').click();
  chip(h, 'difficulty-chips', '资深').click();
  assert.equal(items(h).length, ENTRIES.filter((e) => e.difficulty === '资深').length);
  assert.ok(items(h).every((b) => BY_ID[b.getAttribute('data-id')].difficulty === '资深'));

  chip(h, 'status-chips', 'read').click();
  assert.equal(items(h).length, 0, '一条都没读过时，“已读”筛不出东西');
  assert.equal($(h, 'list-empty').hidden, false);
  assert.equal($(h, 'list-empty-title').textContent, '这个筛选条件下没有条目');
  assert.equal($(h, 'list-empty-text').textContent, '换个主题、难度或状态试试，或清除筛选。');
  assert.equal($(h, 'reader').hidden, true);
  assert.equal($(h, 'reader-blank').hidden, false);
  assert.equal($(h, 'reader-blank-title').textContent, '没有可显示的条目');
  assert.equal(one(h, '#reader-blank [data-clear-filters]').hidden, false);

  $(h, 'clear-filters').click();
  assert.equal(items(h).length, 60);
  assert.equal(chip(h, 'difficulty-chips', 'all').getAttribute('aria-pressed'), 'true');
  assert.equal(chip(h, 'status-chips', 'all').getAttribute('aria-pressed'), 'true');
  assert.equal($(h, 'clear-filters').hidden, true);
  assert.equal($(h, 'result-count').textContent, '共 ' + TOTAL + ' 条');
});

test('筛选：阅读状态筛选按已读记录工作', () => {
  const first = ENTRIES[0].id;
  const second = ENTRIES[1].id;
  const h = boot({ read: Object.fromEntries([[first, 1], [second, 1]]) });
  go(h, 'entries');
  chip(h, 'status-chips', 'read').click();
  assert.deepEqual(items(h).map((b) => b.getAttribute('data-id')), [first, second]);
  chip(h, 'status-chips', 'unread').click();
  assert.equal(items(h).length, 60);
  assert.ok(!items(h).some((b) => b.getAttribute('data-id') === first));
  assert.equal(items(h).find((b) => b.getAttribute('data-id') === 'java-interface-vs-abstract').querySelector('.cp-entry__state').textContent, '未读');
});

test('搜索：输入后实时筛选，标题命中的排最前，清空后恢复全部', () => {
  const h = boot();
  go(h, 'entries');
  const input = $(h, 'entry-search');
  input.value = '雪崩';
  h.dispatch(input, 'input');
  h.advance(150);
  assert.equal(items(h)[0].getAttribute('data-id'), 'redis-avalanche');
  assert.match($(h, 'result-count').textContent, /^找到 \d+ 条$/);
  assert.equal($(h, 'clear-filters').hidden, false);

  input.value = 'spring事务';
  h.dispatch(input, 'input');
  h.advance(150);
  assert.equal(items(h)[0].getAttribute('data-id'), 'spring-tx-too-long');

  input.value = '';
  h.dispatch(input, 'input');
  h.advance(150);
  assert.equal(items(h).length, 60);
  assert.equal($(h, 'result-count').textContent, '共 ' + TOTAL + ' 条');
});

test('搜索：没有结果时给出有用的空状态，“清除筛选”能恢复', () => {
  const h = boot();
  go(h, 'entries');
  const input = $(h, 'entry-search');
  input.value = '这个问题任何条目都没有提到zzz';
  h.dispatch(input, 'input');
  h.advance(150);
  assert.equal(items(h).length, 0);
  assert.equal($(h, 'list-empty').hidden, false);
  assert.equal($(h, 'list-empty-title').textContent, '没有找到「这个问题任何条目都没有提到zzz」');
  assert.equal($(h, 'list-empty-text').textContent, '换个关键词试试，或清除筛选。');
  const button = one(h, '#list-empty [data-clear-filters]');
  assert.equal(button.textContent, '清除筛选');
  button.click();
  assert.equal(items(h).length, 60);
  assert.equal(input.value, '');
  assert.equal($(h, 'list-empty').hidden, true);
  focused(h, $(h, 'entry-search'), '点空状态里的“清除筛选”后，焦点回到搜索框');
});

/* ==========================================================================
   键盘
   ========================================================================== */

test('键盘：/ 聚焦搜索，Esc 清空并退出，↑ ↓ 切换条目并把焦点带过去', () => {
  const h = boot();
  go(h, 'start');
  h.press('/');
  assert.deepEqual(visibleView(h), ['entries'], '在别的视图按 / 也会进到全部条目');
  focused(h, $(h, 'entry-search'), '按 / 之后焦点在搜索框');
  assert.equal($(h, 'entry-search').selected, true, '已有的关键词被选中，方便直接替换');

  $(h, 'entry-search').value = '';
  h.press('ArrowDown');
  assert.equal(currentId(h), ENTRIES[1].id);
  assert.equal(h.document.activeElement, $(h, 'entry-search'), '在搜索框里按方向键，焦点留在搜索框');
  assert.equal($(h, 'reader-title').textContent, ENTRIES[1].title);

  $(h, 'entry-search').value = '缓存';
  h.dispatch($(h, 'entry-search'), 'input');
  h.advance(150);
  const afterSearch = currentId(h);
  assert.notEqual(afterSearch, ENTRIES[1].id, '当前条目不在搜索结果里时，退到结果的第一条');
  h.press('Escape');
  assert.equal($(h, 'entry-search').value, '', 'Esc 清空关键词');
  assert.equal(items(h).length, 60);
  assert.equal(h.document.activeElement.getAttribute('data-id'), afterSearch, 'Esc 之后焦点回到当前条目');

  h.press('ArrowUp');
  assert.equal(currentId(h), ENTRIES[ENTRIES.indexOf(BY_ID[afterSearch]) - 1].id);
  assert.equal(h.document.activeElement.getAttribute('data-id'), currentId(h), '在列表上按方向键，焦点跟着走');

  items(h)[0].click();
  h.press('ArrowUp');
  assert.equal(currentId(h), ENTRIES[0].id, '已经是第一条时不再移动');
  assert.equal($(h, 'entry-search').value, '', '没有误触输入');
});

test('键盘：正文里的方向键留给滚动，在别的输入框里打字不受影响', () => {
  const h = boot();
  go(h, 'entries');
  const region = $(h, 'reader-scroll');
  region.focus();
  const notPrevented = h.press('ArrowDown');
  assert.equal(notPrevented, true, '焦点在正文里时不拦截方向键');
  assert.equal(currentId(h), ENTRIES[0].id);

  const other = h.document.createElement('input');
  $(h, 'main').appendChild(other);
  other.focus();
  h.press('x');
  h.press('/');
  assert.deepEqual(visibleView(h), ['entries']);
  focused(h, other, '在输入框里按 / 只是输入字符，不抢焦点');

  go(h, 'about');
  const before = currentId(h);
  $(h, 'main').focus();
  h.press('ArrowDown');
  assert.equal(currentId(h), before, '不在“全部条目”视图时，方向键不切换条目');
});

/* ==========================================================================
   已读状态
   ========================================================================== */

test('已读：主动打开一条未读条目，停留约 5 秒后自动标为已读并写入本机', () => {
  const h = boot();
  go(h, 'entries');
  const target = ENTRIES[3];
  items(h)[3].click();
  assert.equal($(h, 'toggle-read-text').textContent, '标记为已读');
  assert.equal($(h, 'toggle-read').getAttribute('aria-label'), '标记为已读');

  h.advance(4999);
  assert.equal(readMap(h)[target.id], undefined, '不到 5 秒不标');
  h.advance(1);
  assert.equal(typeof readMap(h)[target.id], 'number');
  assert.ok(items(h)[3].classList.contains('cp-entry--read'));
  assert.equal(items(h)[3].querySelector('.cp-entry__state').textContent, '已读');
  assert.equal($(h, 'toggle-read-text').textContent, '标记为未读');
  assert.equal($(h, 'read-meta-read').textContent, '1');

  go(h, 'start');
  assert.equal($(h, 'progress-read').textContent, '1');
  assert.equal($(h, 'progress-bar-fill').style.width, '1%');
  assert.match($(h, 'progress-hint').textContent, /还剩 68 条没读/);
  const card = all(h, '#topics .cp-topic').find((c) => c.getAttribute('data-category') === target.category);
  assert.equal(card.querySelector('.cp-topic__foot').textContent, '已读 1 / 10');
});

test('已读：进入视图时阅读区正显示着的那一条，停留 5 秒也会被标为已读', () => {
  const h = boot();
  go(h, 'entries');
  h.advance(4999);
  assert.deepEqual(readMap(h), {});
  h.advance(1);
  assert.equal(typeof readMap(h)[ENTRIES[0].id], 'number', '阅读区显示着它，读满 5 秒就算读过');
  assert.equal($(h, 'read-meta-read').textContent, '1');
});

test('已读：搜索后被动落到第一条的结果，不点开就不会被标为已读', () => {
  const h = boot();
  go(h, 'entries');
  const input = $(h, 'entry-search');
  input.value = '雪崩';
  h.dispatch(input, 'input');
  h.advance(150);
  assert.equal(currentId(h), 'redis-avalanche');
  h.advance(60000);
  assert.deepEqual(readMap(h), {}, '只是在扫结果列表，不该记成已读');

  items(h)[0].click();
  h.advance(5000);
  assert.equal(typeof readMap(h)['redis-avalanche'], 'number', '点开之后才开始计时');
});

test('已读：筛选后被动选中的第一条同样不自动标，进视图时显示的那条才算', () => {
  const h = boot();
  go(h, 'entries');
  chip(h, 'category-chips', 'mysql').click();
  assert.equal(currentId(h), 'mysql-index-btree');
  h.advance(60000);
  assert.deepEqual(readMap(h), {}, '筛选只是在挑，不算读');

  go(h, 'about');
  go(h, 'entries');
  h.advance(5000);
  assert.equal(typeof readMap(h)['mysql-index-btree'], 'number', '重新进入视图时它显示在阅读区，算进入');
});

test('已读：手动标记与改回未读；改回未读后停在这条上不会被再次自动标记', () => {
  const h = boot();
  go(h, 'entries');
  const target = ENTRIES[4];
  items(h)[4].click();
  $(h, 'toggle-read').click();
  assert.equal(typeof readMap(h)[target.id], 'number');
  assert.equal(toasts(h).pop(), '已标记为已读：' + target.title);

  $(h, 'toggle-read').click();
  assert.equal(readMap(h)[target.id], undefined);
  assert.equal(toasts(h).pop(), '已改回未读：' + target.title);
  h.advance(30000);
  assert.equal(readMap(h)[target.id], undefined, '手动改回未读的条目，停多久都不自动标回去');

  // 离开再回来，恢复自动标记
  items(h)[5].click();
  items(h)[4].click();
  h.advance(5000);
  assert.equal(typeof readMap(h)[target.id], 'number');
});

test('已读：页面切到后台时计时作废，回来后重新计时', () => {
  const h = boot();
  go(h, 'entries');
  const target = ENTRIES[5];
  items(h)[5].click();
  h.advance(3000);
  h.document.hidden = true;
  h.dispatch(h.document, 'visibilitychange');
  h.advance(30000);
  assert.equal(readMap(h)[target.id], undefined);

  h.document.hidden = false;
  h.dispatch(h.document, 'visibilitychange');
  h.advance(4999);
  assert.equal(readMap(h)[target.id], undefined);
  h.advance(1);
  assert.equal(typeof readMap(h)[target.id], 'number');
});

test('已读：切到别的视图后不再计时，重新进入后接着计', () => {
  const h = boot();
  go(h, 'entries');
  const target = ENTRIES[6];
  items(h)[6].click();
  go(h, 'about');
  h.advance(30000);
  assert.equal(readMap(h)[target.id], undefined);
  go(h, 'entries');
  h.advance(5000);
  assert.equal(typeof readMap(h)[target.id], 'number');
});

test('已读：全部读完之后开始视图给出提示', () => {
  const read = Object.fromEntries(ENTRIES.map((entry) => [entry.id, 1]));
  const h = boot({ read });
  assert.equal($(h, 'progress-read').textContent, String(TOTAL));
  assert.equal($(h, 'progress-bar-fill').style.width, '100%');
  assert.match($(h, 'progress-hint').textContent, /都读过了/);
  all(h, '#topics .cp-topic').forEach((card) => assert.equal(card.querySelector('.cp-topic__foot').textContent, '已读完'));
});

/* ==========================================================================
   复制
   ========================================================================== */

test('复制：复制要点得到完整纯文本，复制代码得到该段原文', async () => {
  const h = boot();
  go(h, 'entries');
  const entry = ENTRIES[0];
  $(h, 'copy-points').click();
  await tick();
  const text = h.copied;
  assert.equal(text.split('\n')[0], '【' + entry.title + '】');
  ['什么时候遇到：', '现象：', '根因：', '正确做法：', '一句话原则：'].forEach((label) => assert.ok(text.includes(label)));
  assert.ok(text.includes('\n1. ' + entry.fix[0]));
  assert.equal(toasts(h).pop(), '要点已复制到剪贴板');

  const buttons = all(h, '#reader-examples .code-block__header button');
  buttons[0].click();
  await tick();
  assert.equal(h.copied, lf(entry.example.bad));
  buttons[1].click();
  await tick();
  assert.equal(h.copied, lf(entry.example.good));
  assert.ok(!h.copied.includes('\r'), '复制出去的代码用 LF 换行');
});

test('复制：剪贴板不可用时给出说得清的提示', async () => {
  const h = boot();
  go(h, 'entries');
  h.copyShouldFail = true;
  $(h, 'copy-points').click();
  await tick();
  await tick();
  const toast = toasts(h).pop();
  assert.match(toast, /复制没有成功/);
  assert.match(toast, /手动复制/);
  assert.match(toast, /https/);
});

/* ==========================================================================
   开始视图的入口、相关条目、随机
   ========================================================================== */

test('开始视图：点主题卡片进入该主题并选中第一条；点“浏览全部条目”保持当前条目', () => {
  const h = boot();
  all(h, '#topics .cp-topic')[2].click();
  assert.deepEqual(visibleView(h), ['entries']);
  assert.equal(chip(h, 'category-chips', 'redis').getAttribute('aria-pressed'), 'true');
  assert.equal(items(h).length, 8);
  assert.equal(currentId(h), 'redis-avalanche');
  assert.equal(h.document.activeElement, $(h, 'main'));

  go(h, 'start');
  one(h, '[data-open-entries]').click();
  assert.deepEqual(visibleView(h), ['entries']);
  assert.equal(chip(h, 'category-chips', 'redis').getAttribute('aria-pressed'), 'true', '只是切回列表，筛选条件保留');
});

test('相关条目：点击跳转；目标不在当前筛选结果里时先撤掉筛选', () => {
  const h = boot();
  go(h, 'entries');
  chip(h, 'category-chips', 'java').click();
  assert.equal(items(h).length, 10);

  // 当前是 java 的第一条，它的相关条目里有别的话题的条目
  const current = BY_ID[currentId(h)];
  const outside = current.related.map((id) => BY_ID[id]).find((entry) => entry.category !== 'java');
  const link = all(h, '#reader-related .cp-related__link').find((b) => b.getAttribute('data-id') === outside.id);
  link.click();
  assert.equal(currentId(h), outside.id);
  assert.equal($(h, 'reader-title').textContent, outside.title);
  assert.equal(chip(h, 'category-chips', 'all').getAttribute('aria-pressed'), 'true');
  assert.equal($(h, 'clear-filters').hidden, true);
  assert.equal(h.storage.get(LAST_KEY), JSON.stringify(outside.id), '记住最后打开的条目');
});

test('相关条目：人工标注不够 4 条时用相似条目补齐，并加以区分', () => {
  const h = boot();
  go(h, 'entries');
  const withFew = ENTRIES.find((entry) => entry.related.length <= 2);
  const index = ENTRIES.indexOf(withFew);
  items(h)[index].click();
  const links = all(h, '#reader-related .cp-related__link');
  assert.ok(links.length > 1);
  assert.ok(links.length <= 4);
  assert.equal(links[0].querySelector('.badge').textContent, withFew.difficulty, '人工标注的排第一，不带“相似”');
  const marked = links.slice(1).filter((b) => b.querySelector('.cp-related__meta').textContent.includes('相似'));
  assert.equal(marked.length, links.length - withFew.related.length);
  assert.equal(links.length, 4);
  assert.equal($(h, 'related-hint').hidden, false);
  assert.match($(h, 'related-hint').textContent, /自动找到/);
});

test('随机来一条：进入全部条目并打开一条未读的；都读过之后给出提示', () => {
  const h = boot({ read: Object.fromEntries(ENTRIES.slice(0, TOTAL - 3).map((entry) => [entry.id, 1])) });
  $(h, 'btn-random').click();
  assert.deepEqual(visibleView(h), ['entries']);
  const id = currentId(h);
  assert.ok(id);
  assert.equal(readMap(h)[id], undefined, '打开的是一条未读的');
  assert.equal(h.storage.get(LAST_KEY), JSON.stringify(id));
  assert.deepEqual(toasts(h), []);

  const read = Object.fromEntries(ENTRIES.map((entry) => [entry.id, 1]));
  const allRead = boot({ read });
  allRead.$('btn-random').click();
  assert.deepEqual(visibleView(allRead), ['entries']);
  assert.ok(currentId(allRead));
  assert.equal(toasts(allRead).pop(), TOTAL + ' 条都读过了，这次随机打开的是一条已读的。');
});

test('重新打开页面后回到上次看的那一条', () => {
  const storage = new Map();
  const first = boot({ storage });
  go(first, 'entries');
  const target = ENTRIES[9];
  items(first)[9].click();
  first.advance(5000);

  const again = boot({ storage });
  go(again, 'entries');
  assert.equal(currentId(again), target.id);
  assert.equal($(again, 'reader-title').textContent, target.title);
  assert.equal($(again, 'progress-read').textContent, '1');
  assert.equal(readMap(again)[target.id] !== undefined, true, '阅读进度在同一份本机存储里');
});

/* ==========================================================================
   窄屏
   ========================================================================== */

test('窄屏：先显示列表，点开后进入详情并可返回，焦点跟着走', () => {
  const h = boot({ narrow: true });
  go(h, 'entries');
  const split = one(h, '[data-view-panel="entries"]');
  assert.equal(split.classList.contains('is-detail-open'), false);

  h.advance(30000);
  assert.deepEqual(readMap(h), {}, '停在列表上不算打开条目');

  const target = ENTRIES[1];
  items(h)[1].click();
  assert.equal(split.classList.contains('is-detail-open'), true);
  assert.deepEqual(h.scrolledTo.pop(), [0, 0], '进入详情时回到页面顶部');
  focused(h, $(h, 'reader-title'), '窄屏进入详情后焦点在标题上');
  assert.equal($(h, 'reader-title').textContent, target.title);

  h.advance(5000);
  assert.equal(typeof readMap(h)[target.id], 'number', '进入详情后停留 5 秒自动标已读');

  $(h, 'back-to-list').click();
  assert.equal(split.classList.contains('is-detail-open'), false);
  focused(h, items(h)[1], '返回后焦点回到刚才那一条');
  assert.equal(items(h)[1].getAttribute('aria-current'), 'page');
});

test('窄屏：在详情里按 / 回到列表并聚焦搜索；跨过断点时回到列表', () => {
  const h = boot({ narrow: true });
  go(h, 'entries');
  items(h)[0].click();
  const split = one(h, '[data-view-panel="entries"]');
  assert.equal(split.classList.contains('is-detail-open'), true);

  h.press('/');
  assert.equal(split.classList.contains('is-detail-open'), false);
  assert.equal(h.document.activeElement, $(h, 'entry-search'));

  items(h)[0].click();
  h.setNarrow(false);
  assert.equal(split.classList.contains('is-detail-open'), false, '拉宽窗口后不再是详情态');
  h.setNarrow(true);
  assert.equal(split.classList.contains('is-detail-open'), false, '缩窄后先回到列表');
});
