/* ============================================================================
   程序员避坑指南 · 界面逻辑
   依赖：design/shared.js（window.ZDX）、data.js（window.APP_DATA）、core.js（window.APP_CORE）
   渲染一律用 textContent / ZDX.el，不用 innerHTML 拼内容。
   ========================================================================== */
(function () {
  'use strict';

  var ZDX = window.ZDX;
  var DATA = window.APP_DATA || {};
  var CORE = window.APP_CORE;
  if (!ZDX || !CORE || !CORE.entries || !CORE.entries.length) return;

  var META = DATA.meta || {};
  var ENTRIES = CORE.entries;
  var PAGE_SIZE = META.pageSize || 60;
  var READ_DELAY = META.readDelayMs || 5000;
  var STORE = ZDX.store('pitfalls');
  var NARROW = window.matchMedia('(max-width: 960px)');
  var el = ZDX.el;
  var icon = ZDX.icon;
  var forAll = function (nodes, fn) { Array.prototype.forEach.call(nodes, fn); };

  var VIEW_TITLES = { start: '开始', entries: '全部条目', about: '关于本指南' };
  var STATUS_LABELS = { all: '全部', unread: '未读', read: '已读' };

  /* ---------- 取节点 ---------- */
  function $(id) { return document.getElementById(id); }

  var main = $('main');
  var panels = document.querySelectorAll('[data-view-panel]');
  var navItems = document.querySelectorAll('.nav__item[data-view]');
  var viewTitle = $('view-title');
  var readMeta = $('read-meta');
  var topbarSearch = $('topbar-search');
  var topics = $('topics');

  var searchInput = $('entry-search');
  var categoryChips = $('category-chips');
  var difficultyChips = $('difficulty-chips');
  var statusChips = $('status-chips');
  var resultCount = $('result-count');
  var clearFiltersBtn = $('clear-filters');
  var listScroll = $('list-scroll');
  var entryList = $('entry-list');
  var listEmpty = $('list-empty');
  var listEmptyTitle = $('list-empty-title');
  var listEmptyText = $('list-empty-text');
  var listEnd = $('list-end');

  var panelEntries = document.querySelector('[data-view-panel="entries"]');
  var readerBlank = $('reader-blank');
  var readerBlankTitle = $('reader-blank-title');
  var readerBlankText = $('reader-blank-text');
  var readerBlankAction = readerBlank.querySelector('[data-clear-filters]');
  var reader = $('reader');
  var readerScroll = $('reader-scroll');
  var readerTitle = $('reader-title');
  var readerStatus = $('reader-status');
  var toggleReadBtn = $('toggle-read');
  var toggleReadText = $('toggle-read-text');
  var prevBtn = $('prev-entry');
  var nextBtn = $('next-entry');

  /* ---------- 状态 ---------- */
  function emptyFilters() {
    return { category: 'all', difficulty: 'all', status: 'all', query: '' };
  }

  function loadRead() {
    var saved = STORE.get('read', null);
    return saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
  }

  var state = {
    view: null,
    filters: emptyFilters(),
    list: ENTRIES.slice(),   // 筛选 + 搜索之后的结果，顺序即展示顺序
    currentId: null,
    opened: false,            // 当前条目算不算“进入过”：主动打开、或进视图时正显示着才算；
                              // 搜索筛选后被动落到第一条的不算，点了才开始计时
    visible: PAGE_SIZE,      // 列表里已经渲染的条数
    read: loadRead(),        // { 条目 id: 标记为已读的时间戳 }
    pinnedUnreadId: null     // 手动改回未读的条目：停在它上面时不再自动标已读
  };

  function current() {
    return state.currentId ? CORE.get(state.currentId) : null;
  }

  function isRead(entry) {
    return CORE.isRead(state.read, entry.id);
  }

  function readCount() {
    return ENTRIES.filter(isRead).length;
  }

  /* 窄屏下只有进入详情才算“打开了一条条目” */
  function detailIsOpen() {
    return !NARROW.matches || panelEntries.classList.contains('is-detail-open');
  }

  /* ======================================================================
     视图切换
     ====================================================================== */
  function showView(name, opts) {
    opts = opts || {};
    var changed = state.view !== name;
    state.view = name;

    forAll(panels, function (panel) {
      panel.hidden = panel.getAttribute('data-view-panel') !== name;
    });
    forAll(navItems, function (btn) {
      if (btn.getAttribute('data-view') === name) btn.setAttribute('aria-current', 'page');
      else btn.removeAttribute('aria-current');
    });

    viewTitle.textContent = VIEW_TITLES[name] || '';
    main.classList.toggle('content--wide', name === 'entries');
    readMeta.hidden = !(name === 'start' || name === 'entries');
    topbarSearch.hidden = name !== 'entries';

    if (name !== 'entries') {
      stopReadTimer();
      panelEntries.classList.remove('is-detail-open');
    } else {
      // 进入这个视图时阅读区显示着哪一条，就算进入了哪一条（窄屏要先点开详情才显示）
      if (changed && state.currentId) state.opened = true;
      startReadTimer();
    }

    if (changed && opts.focus !== false) main.focus({ preventScroll: true });
  }

  /* ======================================================================
     开始视图：阅读进度 + 主题入口
     ====================================================================== */
  function updateProgress() {
    var read = readCount();
    var total = ENTRIES.length;
    var percent = total ? Math.round((read / total) * 100) : 0;

    $('progress-read').textContent = read;
    $('progress-total').textContent = total;
    $('read-meta-read').textContent = read;
    $('read-meta-total').textContent = total;
    $('progress-bar-fill').style.width = percent + '%';

    var bar = $('progress-bar');
    bar.setAttribute('aria-valuenow', String(read));
    bar.setAttribute('aria-valuemax', String(total));
    bar.setAttribute('aria-valuetext', '已读 ' + read + ' 条，共 ' + total + ' 条');

    $('progress-hint').textContent = read === total
      ? total + ' 条都读过了。想回顾的话，用“随机来一条”，或者按主题重新翻一遍。进度只保存在这台设备的浏览器里。'
      : '还剩 ' + (total - read) + ' 条没读。打开一条未读条目并停留约 ' + Math.round(READ_DELAY / 1000) + ' 秒，会自动标为已读。进度只保存在这台设备的浏览器里。';

    renderTopics();
  }

  function topicCard(categoryId) {
    var isAll = categoryId === 'all';
    var list = isAll ? ENTRIES : ENTRIES.filter(function (entry) { return entry.category === categoryId; });
    var name = isAll ? '全部条目' : CORE.categoryLabel(categoryId);
    var desc = isAll ? '不挑主题，从头到尾翻一遍，或者直接用关键词搜。' : CORE.categoryOf(categoryId).desc;
    var read = list.filter(isRead).length;
    var finished = list.length > 0 && read === list.length;

    var button = el('button', {
      type: 'button',
      class: 'card card--interactive cp-topic' + (isAll ? ' cp-topic--all' : ''),
      'data-category': categoryId,
      'aria-label': '打开' + name + '（共 ' + list.length + ' 条' + (finished ? '，已读完' : '，已读 ' + read + ' 条') + '）'
    });

    button.appendChild(el('span', { class: 'cp-topic__head' }, [
      el('span', { class: 'cp-topic__name', text: name }),
      el('span', { class: 'badge badge--outline num', text: list.length + ' 条' })
    ]));
    button.appendChild(el('span', { class: 'cp-topic__desc', text: desc }));

    var foot = el('span', { class: 'cp-topic__foot' });
    if (finished) {
      foot.appendChild(icon('check', 'icon--sm'));
      foot.appendChild(el('span', { text: '已读完' }));
    } else {
      foot.appendChild(el('span', null, [
        document.createTextNode('已读 '),
        el('span', { class: 'num', text: read }),
        document.createTextNode(' / '),
        el('span', { class: 'num', text: list.length })
      ]));
    }
    button.appendChild(foot);
    return button;
  }

  function renderTopics() {
    topics.textContent = '';
    CORE.CATEGORIES.forEach(function (category) { topics.appendChild(topicCard(category.id)); });
    topics.appendChild(topicCard('all'));
  }

  /* ======================================================================
     左栏：筛选
     ====================================================================== */
  function chip(label, value, count, pressed) {
    var children = [el('span', { text: label })];
    if (count != null) children.push(el('span', { class: 'cp-chip__count num', text: String(count) }));
    return el('button', {
      type: 'button',
      class: 'chip',
      'data-value': value,
      'aria-pressed': pressed ? 'true' : 'false'
    }, children);
  }

  function renderFilterChips() {
    var byCategory = CORE.countBy(ENTRIES, 'category');

    categoryChips.textContent = '';
    categoryChips.appendChild(chip('全部', 'all', ENTRIES.length, true));
    CORE.CATEGORIES.forEach(function (category) {
      categoryChips.appendChild(chip(category.label, category.id, byCategory[category.id] || 0, false));
    });

    difficultyChips.textContent = '';
    difficultyChips.appendChild(chip('全部', 'all', null, true));
    CORE.DIFFICULTIES.forEach(function (level) {
      difficultyChips.appendChild(chip(level, level, null, false));
    });

    statusChips.textContent = '';
    CORE.STATUSES.forEach(function (status) {
      statusChips.appendChild(chip(STATUS_LABELS[status] || status, status, null, status === 'all'));
    });
  }

  function syncFilterChips() {
    forAll(categoryChips.children, function (btn) {
      btn.setAttribute('aria-pressed', String(btn.getAttribute('data-value') === state.filters.category));
    });
    forAll(difficultyChips.children, function (btn) {
      btn.setAttribute('aria-pressed', String(btn.getAttribute('data-value') === state.filters.difficulty));
    });
    forAll(statusChips.children, function (btn) {
      btn.setAttribute('aria-pressed', String(btn.getAttribute('data-value') === state.filters.status));
    });
    clearFiltersBtn.hidden = !CORE.hasActiveFilters(state.filters);
  }

  function setFilter(field, value) {
    if (state.filters[field] === value) return;
    state.filters[field] = value;
    syncFilterChips();
    refreshList({ keepScroll: true });
  }

  /* 撤掉全部筛选。清完通常是要重新找，所以默认把焦点交给搜索框 */
  function clearFilters(opts) {
    opts = opts || {};
    state.filters = emptyFilters();
    searchInput.value = '';
    syncFilterChips();
    refreshList({ keepScroll: true });
    if (opts.focus !== false) searchInput.focus();
  }

  /* ======================================================================
     左栏：列表
     ====================================================================== */
  function paintItem(button, entry) {
    var read = isRead(entry);
    button.classList.toggle('cp-entry--read', read);
    if (entry.id === state.currentId) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');

    var mark = button.querySelector('.cp-entry__mark');
    mark.textContent = '';
    mark.appendChild(read ? icon('check') : el('span', { class: 'cp-entry__dot' }));
    button.querySelector('.cp-entry__state').textContent = read ? '已读' : '未读';
  }

  function makeItem(entry) {
    var button = el('button', { type: 'button', class: 'cp-entry', 'data-id': entry.id }, [
      el('span', { class: 'cp-entry__title', text: entry.title }),
      el('span', { class: 'cp-entry__meta' }, [
        el('span', { text: CORE.categoryLabel(entry.category) }),
        el('span', { class: 'badge badge--outline', text: entry.difficulty }),
        el('span', { class: 'sr-only cp-entry__state' })
      ]),
      el('span', { class: 'cp-entry__mark', 'aria-hidden': 'true' })
    ]);
    paintItem(button, entry);
    return el('li', { class: 'cp-entry-item' }, [button]);
  }

  function updateListMeta() {
    var total = state.list.length;
    var active = CORE.hasActiveFilters(state.filters);
    var hasQuery = !!CORE.compact(state.filters.query);

    resultCount.textContent = !active ? '共 ' + total + ' 条' : (hasQuery ? '找到 ' + total + ' 条' : '筛出 ' + total + ' 条');
    listEmpty.hidden = total > 0;
    entryList.hidden = total === 0;
    if (!total) {
      listEmptyTitle.textContent = hasQuery ? '没有找到「' + state.filters.query.trim() + '」' : '这个筛选条件下没有条目';
      listEmptyText.textContent = hasQuery ? '换个关键词试试，或清除筛选。' : '换个主题、难度或状态试试，或清除筛选。';
    }

    var rest = total - state.visible;
    listEnd.textContent = rest > 0
      ? '继续向下滚动，加载后面的 ' + rest + ' 条'
      : (total > PAGE_SIZE ? '已全部加载，共 ' + total + ' 条' : '');
  }

  function renderList() {
    var fragment = document.createDocumentFragment();
    state.list.slice(0, state.visible).forEach(function (entry) { fragment.appendChild(makeItem(entry)); });
    entryList.textContent = '';
    entryList.appendChild(fragment);
    updateListMeta();
  }

  /* 只渲染可见的那一批；滚动到底再追加下一批 */
  function appendMore() {
    if (state.visible >= state.list.length) return;
    var from = state.visible;
    state.visible = Math.min(state.list.length, state.visible + PAGE_SIZE);
    var fragment = document.createDocumentFragment();
    state.list.slice(from, state.visible).forEach(function (entry) { fragment.appendChild(makeItem(entry)); });
    entryList.appendChild(fragment);
    updateListMeta();
  }

  function nearBottom() {
    if (NARROW.matches) {
      return listScroll.getBoundingClientRect().bottom < window.innerHeight + 400;
    }
    return listScroll.scrollHeight - listScroll.scrollTop - listScroll.clientHeight < 240;
  }

  var scrollFrame = 0;
  function onScroll() {
    if (scrollFrame || state.view !== 'entries') return;
    scrollFrame = window.requestAnimationFrame(function () {
      scrollFrame = 0;
      if (nearBottom()) appendMore();
    });
  }

  /* 当前条目如果还没渲染出来（被 60 条的上限挡在后面），先把渲染范围扩到它 */
  function ensureRendered(id) {
    var index = CORE.position(state.list, id);
    if (index < state.visible) return;
    state.visible = Math.min(state.list.length, Math.ceil((index + 1) / PAGE_SIZE) * PAGE_SIZE);
    renderList();
  }

  function syncCurrentInList(scrollToCurrent) {
    forAll(entryList.children, function (item) {
      paintItem(item.firstChild, CORE.get(item.firstChild.getAttribute('data-id')));
    });
    if (!scrollToCurrent || !state.currentId) return;
    var button = entryList.querySelector('.cp-entry[data-id="' + state.currentId + '"]');
    if (button) button.scrollIntoView({ block: 'nearest' });
  }

  /**
   * 重新执行筛选和搜索。当前条目还在结果里就保持不动，不在了退到结果的第一条。
   * keepScroll：列表的滚动位置不动。
   */
  function refreshList(opts) {
    opts = opts || {};
    state.list = CORE.query(ENTRIES, state.filters, state.read);
    state.visible = PAGE_SIZE;

    if (CORE.position(state.list, state.currentId) < 0) {
      // 当前条目被筛掉了：退到结果的第一条。这是被动选中的，点开之前不自动标已读
      state.currentId = state.list.length ? state.list[0].id : null;
      state.opened = false;
    }
    renderList();
    renderReader();

    if (opts.keepScroll) {
      syncCurrentInList(true);
    } else {
      listScroll.scrollTop = 0;
    }
  }

  /* ======================================================================
     打开条目
     ====================================================================== */
  function openEntry(id, opts) {
    opts = opts || {};
    var entry = CORE.get(id);
    if (!entry) return;

    // 它不在当前结果里（从相关条目跳过来，或者被筛选挡在外面）：先撤掉筛选
    if (CORE.position(state.list, id) < 0) {
      if (CORE.hasActiveFilters(state.filters)) clearFilters({ focus: false });
      if (CORE.position(state.list, id) < 0) return;
    }

    var changed = state.currentId !== id;
    state.currentId = id;
    state.opened = true;
    if (changed) {
      state.pinnedUnreadId = null;
      stopReadTimer();
    }

    ensureRendered(id);
    syncCurrentInList(!opts.keepScroll);
    renderReader();
    readerScroll.scrollTop = 0;
    STORE.set('last', id);

    if (NARROW.matches) {
      // 窄屏：进入详情，回到页面顶部让工具条和标题露出来，焦点交给标题
      panelEntries.classList.add('is-detail-open');
      window.scrollTo(0, 0);
      if (opts.focus !== false) readerTitle.focus({ preventScroll: true });
    } else if (opts.focusList) {
      var button = entryList.querySelector('.cp-entry[data-id="' + id + '"]');
      if (button) button.focus({ preventScroll: true });
    }
    startReadTimer();
  }

  function step(dir, opts) {
    var next = CORE.neighbor(state.list, state.currentId, dir);
    if (next) openEntry(next.id, opts);
  }

  /* 进入某个主题：撤掉其他筛选，选中该主题的第一条 */
  function openCategory(categoryId) {
    state.filters = emptyFilters();
    state.filters.category = categoryId || 'all';
    searchInput.value = '';
    state.currentId = null;
    syncFilterChips();
    refreshList({ keepScroll: false });
    showView('entries');
  }

  /* 随机来一条：优先在未读里挑；都读过了就在全部里挑 */
  function openRandom() {
    var unread = CORE.unread(ENTRIES, state.read);
    var picked = CORE.pickRandom(unread.length ? unread : ENTRIES);
    if (!picked) return;
    state.filters = emptyFilters();
    searchInput.value = '';
    syncFilterChips();
    refreshList({ keepScroll: false });
    showView('entries');
    openEntry(picked.id, { keepScroll: false });
    if (!unread.length) {
      ZDX.toast(ENTRIES.length + ' 条都读过了，这次随机打开的是一条已读的。', 'info');
    }
  }

  function backToList() {
    panelEntries.classList.remove('is-detail-open');
    stopReadTimer();
    var button = state.currentId ? entryList.querySelector('.cp-entry[data-id="' + state.currentId + '"]') : null;
    if (button) {
      button.scrollIntoView({ block: 'nearest' });
      button.focus({ preventScroll: true });
    } else {
      listScroll.focus({ preventScroll: true });
    }
  }

  /* ======================================================================
     右栏：阅读区
     ====================================================================== */
  function badge(text, outline) {
    return el('span', { class: 'badge' + (outline ? ' badge--outline' : ''), text: text });
  }

  function setText(id, value) {
    $(id).textContent = value == null ? '' : String(value);
  }

  function codeBlock(kind, lang, code) {
    var language = (META.languages && META.languages[lang]) || '';
    var text = String(code).replace(/\r\n?/g, '\n'); // 复制出去的代码统一用 LF 换行
    var copyButton = el('button', {
      type: 'button',
      class: 'btn btn--ghost btn--sm',
      'aria-label': '复制' + kind + '代码'
    }, [el('span', { text: '复制代码' })]);
    copyButton.addEventListener('click', function () {
      copyText(text, kind + '代码已复制到剪贴板');
    });

    var codeEl = el('code');
    CORE.splitCode(text, lang).forEach(function (line) {
      var lineEl = el('span', { class: 'cp-code__line' + (line.key ? ' is-key' : '') });
      line.parts.forEach(function (part) {
        lineEl.appendChild(part.type === 'code'
          ? document.createTextNode(part.text)
          : el('span', { class: 'is-' + part.type, text: part.text }));
      });
      codeEl.appendChild(lineEl);
    });

    return el('div', { class: 'code-block cp-code-block' }, [
      el('div', { class: 'code-block__header' }, [
        el('span', { text: kind + (language ? ' · ' + language : '') }),
        copyButton
      ]),
      el('pre', { class: 'cp-code' }, [codeEl])
    ]);
  }

  function renderExamples(entry) {
    var box = $('reader-examples');
    var section = $('example-sec');
    var example = entry.example;
    box.textContent = '';
    if (!example || !example.bad || !example.good) {
      section.hidden = true;
      return;
    }
    section.hidden = false;
    box.appendChild(codeBlock('反例', example.lang, example.bad));
    box.appendChild(codeBlock('正例', example.lang, example.good));
  }

  function relatedItem(entry, similar) {
    var button = el('button', { type: 'button', class: 'cp-related__link', 'data-id': entry.id }, [
      el('span', { class: 'cp-related__body' }, [
        el('span', { class: 'cp-related__title', text: entry.title }),
        el('span', { class: 'cp-related__meta' }, [
          el('span', { text: CORE.categoryLabel(entry.category) }),
          badge(entry.difficulty, true),
          similar ? badge('相似') : null,
          el('span', { class: 'sr-only', text: isRead(entry) ? '已读' : '未读' })
        ])
      ]),
      icon('chevron-right', 'icon--sm')
    ]);
    return el('li', { class: 'cp-related__item' }, [button]);
  }

  /* 先列条目自己标注的相关条目，不够 4 条时用相似推荐补齐（标“相似”加以区分） */
  function renderRelated(entry) {
    var box = $('reader-related');
    box.textContent = '';
    var curated = entry.related.filter(function (id) { return !!CORE.get(id); });
    var extra = curated.length >= 4 ? [] : CORE.recommend(entry.id, 4 - curated.length);
    var section = box.parentNode;
    section.hidden = !curated.length && !extra.length;
    $('related-hint').hidden = !extra.length;
    curated.forEach(function (id) { box.appendChild(relatedItem(CORE.get(id), false)); });
    extra.forEach(function (item) { box.appendChild(relatedItem(item, true)); });
  }

  function syncToolbar() {
    var entry = current();
    var index = CORE.position(state.list, state.currentId);
    $('reader-pos').textContent = entry && index >= 0
      ? '第 ' + (index + 1) + ' / ' + state.list.length + ' 条'
      : '';

    toggleReadBtn.disabled = !entry;
    if (entry) {
      var label = isRead(entry) ? '标记为未读' : '标记为已读';
      toggleReadText.textContent = label;
      toggleReadBtn.setAttribute('aria-label', label);
      toggleReadBtn.querySelector('use').setAttribute('href', isRead(entry) ? '#i-arrow-uturn-left' : '#i-check');
    }

    var prev = entry ? CORE.neighbor(state.list, entry.id, -1) : null;
    var next = entry ? CORE.neighbor(state.list, entry.id, 1) : null;
    prevBtn.disabled = !prev;
    nextBtn.disabled = !next;
    prevBtn.title = prev ? '上一条：' + prev.title : '已经是第一条';
    nextBtn.title = next ? '下一条：' + next.title : '已经是最后一条';
  }

  var renderedId = null;

  function renderReader() {
    var entry = current();
    reader.hidden = !entry;
    readerBlank.hidden = !!entry;

    if (!entry) {
      readerBlankTitle.textContent = state.list.length ? '选一条开始阅读' : '没有可显示的条目';
      readerBlankText.textContent = state.list.length
        ? '在列表里选一条，内容会显示在这里。'
        : (CORE.compact(state.filters.query) ? '换个关键词试试，或清除筛选。' : '换个主题、难度或状态试试，或清除筛选。');
      readerBlankAction.hidden = state.list.length > 0 || !CORE.hasActiveFilters(state.filters);
      renderedId = null;
      syncToolbar();
      return;
    }

    if (renderedId !== entry.id) {
      renderedId = entry.id;
      var meta = $('reader-meta');
      meta.textContent = '';
      meta.appendChild(badge(CORE.categoryLabel(entry.category)));
      meta.appendChild(badge(entry.difficulty, true));
      meta.appendChild(el('span', { class: 'cp-reader__tags', text: entry.tags.join(' · ') }));

      setText('reader-title', entry.title);
      setText('reader-scenario', entry.scenario);
      setText('reader-symptom', entry.symptom);
      setText('reader-cause', entry.cause);

      var fix = $('reader-fix');
      fix.textContent = '';
      entry.fix.forEach(function (item) { fix.appendChild(el('li', { text: item })); });

      renderExamples(entry);
      setText('reader-principle', entry.principle);
      renderRelated(entry);
      readerStatus.textContent = '当前条目：' + entry.title;
    }
    syncToolbar();
  }

  /* ======================================================================
     已读状态
     ====================================================================== */
  function setRead(entry, read, source) {
    if (!entry) return;
    if (read) {
      state.read[entry.id] = Date.now();
      state.pinnedUnreadId = null;
    } else {
      delete state.read[entry.id];
      if (source === 'manual') state.pinnedUnreadId = entry.id;
    }
    STORE.set('read', state.read);

    var button = entryList.querySelector('.cp-entry[data-id="' + entry.id + '"]');
    if (button) paintItem(button, entry);
    syncToolbar();
    updateProgress();
    // 手动改过之后，之前挂着的计时器不能再生效：先清掉，再按新状态决定要不要重新计时
    startReadTimer();
  }

  var readTimer = null;

  function stopReadTimer() {
    if (readTimer) {
      window.clearTimeout(readTimer);
      readTimer = null;
    }
  }

  /* 停留约 5 秒自动标为已读。页面切到后台时计时作废 */
  function startReadTimer() {
    stopReadTimer();
    var entry = current();
    if (!entry || document.hidden || state.view !== 'entries' || !detailIsOpen()) return;
    if (!state.opened || isRead(entry) || state.pinnedUnreadId === entry.id) return;
    readTimer = window.setTimeout(function () {
      readTimer = null;
      var now = current();
      if (now && now.id === entry.id) setRead(now, true, 'auto');
    }, READ_DELAY);
  }

  /* ======================================================================
     复制
     ====================================================================== */
  function legacyCopy(text) {
    var area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    area.remove();
    return ok;
  }

  function copyText(text, successMessage) {
    var done = function () { ZDX.toast(successMessage, 'success'); };
    var fail = function () {
      ZDX.toast('复制没有成功：浏览器没有允许这个页面访问剪贴板。可以用鼠标选中文字手动复制，或者通过 https 打开本页后再试。', 'danger', 6000);
    };
    try {
      var result = ZDX.copy(text);
      if (result && typeof result.then === 'function') {
        result.then(done, function () { if (legacyCopy(text)) done(); else fail(); });
      } else if (result === false) {
        fail();
      } else {
        done();
      }
    } catch (e) {
      fail();
    }
  }

  /* ======================================================================
     键盘：/ 聚焦搜索，↑ ↓ 切换条目，Esc 退出搜索
     ====================================================================== */
  function isTypingTarget(target) {
    if (!target) return false;
    var tag = target.tagName;
    return (tag === 'INPUT' && target !== searchInput) || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
  }

  function goSearch() {
    if (NARROW.matches) panelEntries.classList.remove('is-detail-open'); // 窄屏要先回到列表，才看得到搜索框
    stopReadTimer();
    if (state.view !== 'entries') showView('entries', { focus: false });
    searchInput.focus();
    searchInput.select();
  }

  function exitSearch() {
    searchInput.value = '';
    state.filters.query = '';
    syncFilterChips();
    refreshList({ keepScroll: true });
    var button = state.currentId ? entryList.querySelector('.cp-entry[data-id="' + state.currentId + '"]') : null;
    (button || listScroll).focus({ preventScroll: true });
  }

  document.addEventListener('keydown', function (event) {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
    var target = event.target;
    var inSearch = target === searchInput;

    if (event.key === '/' && !inSearch && !isTypingTarget(target)) {
      event.preventDefault();
      goSearch();
      return;
    }

    if (inSearch && (event.key === 'Escape' || event.key === 'Esc')) {
      event.preventDefault();
      exitSearch();
      return;
    }

    if (state.view !== 'entries' || isTypingTarget(target)) return;
    if (readerScroll.contains(target)) return; // 正文里的方向键留给滚动
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;

    event.preventDefault();
    step(event.key === 'ArrowDown' ? 1 : -1, { focusList: !inSearch, keepScroll: true });
  });

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) stopReadTimer();
    else startReadTimer();
  });

  /* ======================================================================
     事件绑定与启动
     ====================================================================== */
  var searchTimer = null;

  function bind() {
    forAll(navItems, function (btn) {
      btn.addEventListener('click', function () { showView(btn.getAttribute('data-view')); });
    });
    topbarSearch.addEventListener('click', goSearch);

    /* 开始视图 */
    topics.addEventListener('click', function (event) {
      var card = event.target.closest('.cp-topic');
      if (card) openCategory(card.getAttribute('data-category'));
    });
    document.querySelector('[data-open-entries]').addEventListener('click', function () { showView('entries'); });
    $('btn-random').addEventListener('click', openRandom);

    /* 搜索：输入后 150ms 再筛，避免每敲一个字就重绘 */
    searchInput.addEventListener('input', function () {
      window.clearTimeout(searchTimer);
      searchTimer = window.setTimeout(function () {
        state.filters.query = searchInput.value.trim();
        syncFilterChips();
        refreshList({ keepScroll: true });
      }, 150);
    });

    /* 筛选胶囊 */
    forAll([[categoryChips, 'category'], [difficultyChips, 'difficulty'], [statusChips, 'status']], function (pair) {
      pair[0].addEventListener('click', function (event) {
        var pressed = event.target.closest('.chip');
        if (pressed) setFilter(pair[1], pressed.getAttribute('data-value'));
      });
    });
    forAll(document.querySelectorAll('#clear-filters, [data-clear-filters]'), function (btn) {
      btn.addEventListener('click', function () { clearFilters(); });
    });

    /* 列表 */
    entryList.addEventListener('click', function (event) {
      var button = event.target.closest('.cp-entry');
      if (button) openEntry(button.getAttribute('data-id'), { keepScroll: true });
    });
    listScroll.addEventListener('scroll', onScroll);
    window.addEventListener('scroll', onScroll, { passive: true });

    /* 阅读区 */
    $('back-to-list').addEventListener('click', backToList);
    toggleReadBtn.addEventListener('click', function () {
      var entry = current();
      if (!entry) return;
      var read = !isRead(entry);
      setRead(entry, read, 'manual');
      ZDX.toast((read ? '已标记为已读：' : '已改回未读：') + entry.title, read ? 'success' : 'info');
    });
    $('copy-points').addEventListener('click', function () {
      var entry = current();
      if (entry) copyText(CORE.toPlainText(entry), '要点已复制到剪贴板');
    });
    prevBtn.addEventListener('click', function () { step(-1, { focus: false }); });
    nextBtn.addEventListener('click', function () { step(1, { focus: false }); });
    $('reader-related').addEventListener('click', function (event) {
      var link = event.target.closest('.cp-related__link');
      if (link) openEntry(link.getAttribute('data-id'));
    });

    /* 窗口跨过断点：窄屏时先回到列表，宽屏时去掉详情态 */
    var onBreakpoint = function () {
      panelEntries.classList.remove('is-detail-open');
      stopReadTimer();
      startReadTimer();
    };
    if (typeof NARROW.addEventListener === 'function') NARROW.addEventListener('change', onBreakpoint);
    else if (typeof NARROW.addListener === 'function') NARROW.addListener(onBreakpoint);
  }

  function init() {
    var last = STORE.get('last', null);
    if (last && CORE.get(last)) {
      state.currentId = last; // 上次看到的那一条，进来时还显示在阅读区
    }

    $('nav-count').textContent = ENTRIES.length;
    renderFilterChips();
    syncFilterChips();
    refreshList({ keepScroll: true });
    updateProgress();
    showView('start', { focus: false });
    bind();
  }

  init();
})();
