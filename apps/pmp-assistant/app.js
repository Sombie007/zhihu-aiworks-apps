/* ===========================================================================
   PMP 助手 · 界面逻辑
   依赖：design/shared.js（window.ZDX）、data.js（window.APP_DATA）、core.js（window.APP_CORE）
   所有计算都在 core.js 里，这里只负责渲染和事件。
   =========================================================================== */
(function () {
  'use strict';

  var DATA = window.APP_DATA || {};
  var CORE = window.APP_CORE;
  var ZDX = window.ZDX;

  var doc = document;
  var main = doc.getElementById('main');

  /* 资源没加载完整时给出明确提示，而不是留一张空白页 */
  if (!CORE || !ZDX || !DATA.ECO || !DATA.CARDS || !DATA.RISK_LIBRARY) {
    if (main) main.textContent = '页面资源没有加载完整，请刷新后重试。';
    return;
  }

  /* ------------------------------------------------------------------ 小工具 */

  function byId(id) { return doc.getElementById(id); }
  function $$(sel, root) { return Array.prototype.slice.call((root || doc).querySelectorAll(sel)); }
  function icon(name, cls) { return ZDX.icon(name, cls); }
  function el(tag, attrs, children) { return ZDX.el(tag, attrs, children); }

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function fill(node, children) {
    clear(node);
    (children || []).forEach(function (c) { if (c) node.appendChild(c); });
  }
  function setText(node, text) {
    if (!node) return;
    var value = text == null ? '' : String(text);
    if (node.textContent !== value) node.textContent = value;
  }
  function debounce(fn, wait) {
    var timer = null;
    return function () {
      var args = arguments;
      var ctx = this;
      clearTimeout(timer);
      timer = setTimeout(function () { fn.apply(ctx, args); }, wait);
    };
  }

  var TONES = ['good', 'bad', 'warn', 'neutral', 'na'];
  function applyTone(node, tone) {
    TONES.forEach(function (t) { node.classList.remove('tone-' + t); });
    if (tone) node.classList.add('tone-' + tone);
  }

  function badge(text, cls) { return el('span', { class: 'badge ' + (cls || ''), text: text }); }
  function stat(value, label) {
    return el('div', { class: 'stat' }, [
      el('span', { class: 'stat__value', text: value }),
      el('span', { class: 'stat__label', text: label })
    ]);
  }
  function kv(term, value) {
    return el('div', null, [el('dt', { text: term }), el('dd', { class: 'num', text: value })]);
  }
  function firstSentence(text) {
    var s = String(text || '');
    var idx = s.indexOf('。');
    return idx >= 0 ? s.slice(0, idx + 1) : s;
  }

  var SVG_NS = 'http://www.w3.org/2000/svg';
  function svg(tag, attrs, text) {
    var node = doc.createElementNS(SVG_NS, tag);
    Object.keys(attrs || {}).forEach(function (k) { node.setAttribute(k, attrs[k]); });
    if (text != null) node.textContent = text;
    return node;
  }

  /* ------------------------------------------------------------------ 状态 */

  var VIEWS = {
    overview: { title: '概览' },
    eco: { title: '考试大纲速查' },
    evm: { title: '挣值计算器' },
    risk: { title: '风险登记册' },
    cards: { title: '考点速记卡' },
    about: { title: '关于本工具' }
  };

  var CARD_BY_ID = {};
  DATA.CARDS.forEach(function (c) { CARD_BY_ID[c.id] = c; });

  var state = {
    view: 'overview',
    eco: { tab: 'tasks', query: '' },
    evm: { eac: 'typical', touched: {} },
    risk: { type: 'software', focus: 'init', register: {}, limit: 200 },
    cards: {
      filters: { domain: '全部', level: '全部', status: 'all', q: '' },
      shuffled: false,
      session: null,
      flipped: false,
      progress: {}
    }
  };

  var riskStore = ZDX.store('pmp-risks');
  var cardStore = ZDX.store('pmp-cards');

  /* ------------------------------------------------------------------ 视图切换 */

  /* 进入某个视图时顺带刷新的内容 */
  function navHook(name) {
    if (name === 'overview') return renderOverview;
    if (name === 'evm') return evmView.refresh;
    if (name === 'risk') return riskView.refresh;
    if (name === 'cards') return cardsView.refresh;
    return null;
  }

  function showView(name, after) {
    if (!VIEWS[name]) name = 'overview';
    state.view = name;
    $$('.view').forEach(function (v) { v.hidden = v.getAttribute('data-view-panel') !== name; });
    $$('.nav__item[data-view]').forEach(function (b) {
      if (b.getAttribute('data-view') === name) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });
    setText(byId('view-title'), VIEWS[name].title);
    $$('#topbar-actions [data-for-view]').forEach(function (b) {
      b.hidden = b.getAttribute('data-for-view') !== name;
    });
    if (typeof after === 'function') after();
    byId('main').focus();
  }

  function bindNav() {
    $$('.nav__item[data-view]').forEach(function (b) {
      b.addEventListener('click', function () {
        var name = b.getAttribute('data-view');
        showView(name, navHook(name));
      });
    });
  }

  /* ------------------------------------------------------------------ 确认对话框 */

  var confirmDialog = byId('confirm-dialog');
  var confirmAction = null;

  /* 破坏性操作一律二次确认：说清会发生什么、无法撤销，按钮写明后果 */
  function askConfirm(options) {
    setText(byId('confirm-title'), options.title);
    setText(byId('confirm-body'), options.body);
    setText(byId('confirm-ok'), options.okLabel);
    setText(byId('confirm-cancel'), options.cancelLabel || '保留');
    confirmAction = options.onOk || null;
    ZDX.openDialog(confirmDialog);
  }

  $$('[data-close]', confirmDialog).forEach(function (b) {
    b.addEventListener('click', function () { ZDX.closeDialog(confirmDialog); });
  });
  byId('confirm-ok').addEventListener('click', function () {
    var fn = confirmAction;
    confirmAction = null;
    ZDX.closeDialog(confirmDialog);
    if (fn) fn();
  });
  confirmDialog.addEventListener('close', function () { confirmAction = null; });

  /* ------------------------------------------------------------------ 概览 */

  function totalTasks() {
    return DATA.ECO.domains.reduce(function (s, d) { return s + d.tasks.length; }, 0);
  }

  function renderSources(boxId) {
    fill(byId(boxId), DATA.TEXTS.sources.map(function (s) {
      return el('li', null, [
        badge(s.tag, 'badge--accent'),
        el('span', { class: 'source-list__name', text: s.name }),
        el('span', { class: 'source-list__desc', text: s.desc })
      ]);
    }));
  }

  function renderOverview() {
    var E = DATA.ECO;
    var T = DATA.TEXTS;
    renderSources('overview-sources');
    setText(byId('overview-trademark'), T.trademark);
    setText(byId('overview-disclaimer'), T.disclaimer);

    /* 四张速览卡：数字全部取自考试大纲数据 */
    var toEco = function (tab) {
      return function () { showView('eco', function () { eco.setTab(tab); }); };
    };
    var quick = [
      {
        icon: 'hashtag',
        value: E.exam.scored + ' / ' + E.exam.questions,
        label: '计分题 / 总题量',
        desc: E.exam.questions + ' 道题中 ' + E.exam.scored + ' 道计分，' + E.exam.pretest + ' 道预备题不计分。',
        action: '查看考试形式',
        go: toEco('tasks')
      },
      {
        icon: 'chart-pie',
        value: E.domains.map(function (d) { return d.percent; }).join(' · '),
        label: E.domains.map(function (d) { return d.name; }).join(' · ') + ' 的占比',
        desc: '三个领域共 ' + totalTasks() + ' 项任务，过程领域占比最高。',
        action: '速查领域与任务',
        go: toEco('tasks')
      },
      {
        icon: 'arrows-right-left',
        value: E.exam.predictiveShare + ' / ' + E.exam.agileHybridShare.replace('约 ', ''),
        label: '预测型 / 适应型、混合型',
        desc: E.exam.predictiveShare + ' 的题目采用预测型项目管理方法，其余 ' + E.exam.agileHybridShare + ' 分布于适应型（敏捷）及混合型方法。',
        action: '去刷敏捷与混合的考点卡',
        go: function () { showView('cards', function () { cardsView.setDomain('敏捷与混合'); }); }
      },
      {
        icon: 'clock',
        value: E.exam.minutes + ' 分钟',
        label: '考试时长',
        desc: '考试时长，含两次 ' + E.exam.breakMinutes + ' 分钟休息。',
        action: '查看报考资格',
        go: toEco('eligibility')
      }
    ];
    fill(byId('quick-cards'), quick.map(function (q) {
      var btn = el('button', { class: 'btn btn--secondary btn--sm', type: 'button' }, [doc.createTextNode(q.action), icon('chevron-right', 'icon--sm')]);
      btn.addEventListener('click', q.go);
      return el('div', { class: 'card quick' }, [
        el('div', { class: 'quick__icon' }, [icon(q.icon, 'icon--sm')]),
        el('span', { class: 'quick__value', text: q.value }),
        el('span', { class: 'quick__label', text: q.label }),
        el('span', { class: 'quick__desc', text: q.desc }),
        btn
      ]);
    }));

    /* 模块入口 */
    var stats = CORE.cards.stats(DATA.CARDS, state.cards.progress);
    var savedCombos = Object.keys(state.risk.register).length;
    var modules = [
      {
        view: 'eco', icon: 'document-text', name: '考试大纲速查',
        desc: '三大领域 ' + totalTasks() + ' 项任务，以及考试形式、报考资格、续证与补考。',
        meta: E.domains.length + ' 个领域 · ' + totalTasks() + ' 项任务 · 可搜索'
      },
      {
        view: 'evm', icon: 'calculator', name: '挣值计算器',
        desc: '输入 PV、EV、AC、BAC 四个数，算出偏差、指数和完工预测。',
        meta: CORE.evm.METHODS.length + ' 种完工估算算法 · 输入有误会说明原因'
      },
      {
        view: 'risk', icon: 'shield-exclamation', name: '风险登记册',
        desc: '按项目类型和关注领域生成风险清单，可调概率影响、切换威胁与机会、选应对策略。',
        meta: savedCombos
          ? '本机已保存 ' + savedCombos + ' 个组合的修改'
          : DATA.PROJECT_TYPES.length + ' 种项目类型 × ' + DATA.FOCUS_AREAS.length + ' 个关注领域'
      },
      {
        view: 'cards', icon: 'book-open', name: '考点速记卡',
        desc: '一屏一张卡，翻面核对；标“还不会”的卡会在本轮里再次出现。',
        meta: '已掌握 ' + stats.known + ' / ' + stats.total + ' 张'
      }
    ];
    fill(byId('module-list'), modules.map(function (m) {
      var btn = el('button', { class: 'card module', type: 'button' }, [
        el('span', { class: 'module__icon' }, [icon(m.icon)]),
        el('span', { class: 'module__text' }, [
          el('span', { class: 'module__name', text: m.name }),
          el('span', { class: 'module__desc', text: m.desc }),
          el('span', { class: 'module__meta', text: m.meta })
        ]),
        icon('chevron-right', 'module__go')
      ]);
      btn.addEventListener('click', function () { showView(m.view, navHook(m.view)); });
      return btn;
    }));
  }

  /* 侧栏里的掌握数量；如果正停在概览，顺带刷新入口上的进度文字 */
  function updateProgressBadges() {
    var stats = CORE.cards.stats(DATA.CARDS, state.cards.progress);
    var nav = byId('nav-cards-count');
    setText(nav, String(stats.known));
    nav.hidden = stats.known === 0;
    if (state.view === 'overview') renderOverview();
  }

  /* ------------------------------------------------------------------ 考试大纲速查 */

  var eco = (function () {
    var E = DATA.ECO;
    var TABS = ['tasks', 'eligibility', 'renewal'];
    var openState = {};
    E.domains.forEach(function (d) { openState[d.id] = true; });

    function terms() { return CORE.cards.terms(state.eco.query); }
    function match(text) { return CORE.cards.match(text, terms()); }

    /* 给命中的词加高亮，返回文档片段 */
    function marked(text) {
      var frag = doc.createDocumentFragment();
      var list = terms();
      var lower = text.toLowerCase();
      if (!list.length || lower.length !== text.length) {
        frag.appendChild(doc.createTextNode(text));
        return frag;
      }
      var ranges = [];
      list.forEach(function (term) {
        var idx = 0;
        while ((idx = lower.indexOf(term, idx)) >= 0) {
          ranges.push([idx, idx + term.length]);
          idx += term.length;
        }
      });
      ranges.sort(function (a, b) { return a[0] - b[0] || b[1] - a[1]; });
      var pos = 0;
      ranges.forEach(function (r) {
        if (r[1] <= pos) return;
        var start = Math.max(r[0], pos);
        if (start > pos) frag.appendChild(doc.createTextNode(text.slice(pos, start)));
        frag.appendChild(el('mark', { class: 'hl', text: text.slice(start, r[1]) }));
        pos = r[1];
      });
      if (pos < text.length) frag.appendChild(doc.createTextNode(text.slice(pos)));
      return frag;
    }

    /* 标记一条可搜索的内容：不命中就隐藏 */
    function searchable(node, text) {
      node.setAttribute('data-s', '');
      node.hidden = !match(text);
      return node;
    }

    function renderFacts() {
      var x = E.exam;
      var rows = [
        ['题量', x.questions + ' 道：' + x.scored + ' 道计分，' + x.pretest + ' 道为预备（预测试）题、不计分'],
        ['时长', x.minutes + ' 分钟；有两次可选休息，每次 ' + x.breakMinutes + ' 分钟'],
        ['领域占比', E.domains.map(function (d) { return d.name + ' ' + d.percent + '%'; }).join('　')],
        ['开发方法', x.predictiveShare + ' 的题目采用预测型项目管理方法，其余 ' + x.agileHybridShare + ' 分布于适应型（敏捷）及混合型方法'],
        ['题型', x.questionTypes.join('、')],
        ['仅机考（CBT）的题型', x.cbtOnlyTypes.join('、')],
        ['大纲与教材的区别', x.difference]
      ];
      fill(byId('eco-facts'), rows.map(function (r) {
        var dd = el('dd');
        dd.appendChild(marked(r[1]));
        var item = el('div', { class: r[0] === '大纲与教材的区别' ? 'facts--wide' : '' }, [el('dt', { text: r[0] }), dd]);
        return searchable(item, r[0] + ' ' + r[1]);
      }));
    }

    function renderPaths() {
      fill(byId('eco-paths'), E.eligibility.paths.map(function (p) {
        var text = '至少 ' + p.months + ' 个月 / ' + p.years + ' 年';
        var name = el('td');
        name.appendChild(marked(p.education));
        var value = el('td', { class: 'num' });
        value.appendChild(marked(text));
        return searchable(el('tr', null, [name, value]), p.education + ' ' + text);
      }));
    }

    function renderRules() {
      fill(byId('eco-rules'), E.eligibility.rules.map(function (r) {
        var text = el('span', { class: 'fact-list__text' });
        text.appendChild(marked(r.text));
        return searchable(
          el('li', null, [el('span', { class: 'fact-list__title', text: r.title }), text]),
          r.title + ' ' + r.text
        );
      }));
    }

    function renderRenewal() {
      var r = E.renewal;
      var t = E.retake;
      fill(byId('eco-renewal-stats'), [
        stat('每 ' + r.cycleYears + ' 年', '一个续证周期'),
        stat(String(r.pdu), '个 PDU（' + r.pduName + '）')
      ]);
      fill(byId('eco-retake-stats'), [
        stat(t.attempts + ' 次', '资格有效期一年内最多参加的考试次数'),
        stat('等待一年', '三次均未通过后，才能重新申请')
      ]);
      var renewal = '续证：' + r.text;
      var retake = '补考：' + t.text;
      var reapply = t.reapplyText || '';
      setText(byId('eco-renewal-text'), renewal);
      setText(byId('eco-retake-text'), retake);
      setText(byId('eco-retake-reapply'), reapply);
      byId('eco-renewal-text').hidden = !match(renewal);
      byId('eco-retake-text').hidden = !match(retake);
      byId('eco-retake-reapply').hidden = !match(reapply);
    }

    function renderDomains() {
      var searching = terms().length > 0;
      fill(byId('eco-domains'), E.domains.map(function (d) {
        var tasks = d.tasks.filter(function (t) { return match(d.name + ' ' + t.title + ' ' + t.points.join(' ')); });
        var details = doc.createElement('details');
        details.className = 'domain';
        details.open = searching ? tasks.length > 0 : !!openState[d.id];
        details.hidden = searching && tasks.length === 0;

        var summary = doc.createElement('summary');
        summary.className = 'domain__head';
        summary.appendChild(el('span', { class: 'domain__name' }, [icon(d.icon), doc.createTextNode(d.name)]));
        /* 横条的宽度就是真实占比：三条横条共用同一把 100% 的尺子 */
        var bar = el('span', { class: 'domain__bar', 'aria-hidden': 'true' }, [el('span', { class: 'domain__fill' })]);
        bar.firstChild.style.width = d.percent + '%';
        summary.appendChild(bar);
        summary.appendChild(el('span', { class: 'domain__pct num', text: d.percent + '%' }));
        summary.appendChild(el('span', {
          class: 'domain__count',
          text: searching ? '匹配 ' + tasks.length + ' 项' : d.tasks.length + ' 项任务'
        }));
        summary.appendChild(icon('chevron-down', 'domain__chevron'));
        details.appendChild(summary);

        var list = el('ol', { class: 'tasks' });
        tasks.forEach(function (t) {
          var title = el('span', { class: 'task__title' });
          title.appendChild(marked(t.title));
          var points = el('ul', { class: 'task__points' });
          t.points.forEach(function (p) {
            var li = doc.createElement('li');
            li.appendChild(marked(p));
            points.appendChild(li);
          });
          list.appendChild(el('li', { class: 'task' }, [
            el('span', { class: 'task__no', text: '任务 ' + (d.tasks.indexOf(t) + 1) }),
            el('div', null, [title, points])
          ]));
        });
        details.appendChild(el('div', { class: 'domain__body' }, [list]));
        details.addEventListener('toggle', function () {
          if (!terms().length) openState[d.id] = details.open;
        });
        return details;
      }));
    }

    function renderSearchStatus() {
      var box = byId('eco-search-status');
      clear(box);
      var query = state.eco.query.trim();
      if (!terms().length) return;
      var shown = $$('#eco-panel-' + state.eco.tab + ' [data-s]').filter(function (n) { return !n.hidden; }).length;
      /* 任务列表是按命中结果重建的，渲染出来的条数就是命中数 */
      if (state.eco.tab === 'tasks') shown += $$('#eco-domains .task').length;
      box.appendChild(el('span', {
        text: '“' + query + '”：当前标签页' + (shown ? '匹配 ' + shown + ' 项' : '没有匹配的内容') + '，其他标签页不受影响。'
      }));
      var btn = el('button', { class: 'btn btn--ghost btn--sm', type: 'button', text: '清除搜索' });
      btn.addEventListener('click', clearSearch);
      box.appendChild(btn);
    }

    function applySearch() {
      renderFacts();
      renderPaths();
      renderRules();
      renderRenewal();
      renderDomains();
      renderSearchStatus();
    }

    function clearSearch() {
      state.eco.query = '';
      byId('eco-search').value = '';
      applySearch();
    }

    function setTab(tab) {
      if (TABS.indexOf(tab) < 0) tab = 'tasks';
      state.eco.tab = tab;
      $$('#eco-tabs [role="tab"]').forEach(function (b) {
        var on = b.getAttribute('data-tab') === tab;
        b.setAttribute('aria-selected', on ? 'true' : 'false');
        b.tabIndex = on ? 0 : -1;
      });
      $$('[role="tabpanel"][data-panel]').forEach(function (p) {
        p.hidden = p.getAttribute('data-panel') !== tab;
      });
      applySearch();
    }

    function init() {
      var T = DATA.TEXTS;
      setText(byId('eco-source'), '出处：' + E.source + '。' + T.ecoNote + ' ' + T.terminology);
      setText(byId('eco-meta'), E.domains.length + ' 个领域 · ' + totalTasks() + ' 项任务');

      $$('#eco-tabs [role="tab"]').forEach(function (b) {
        b.addEventListener('click', function () { setTab(b.getAttribute('data-tab')); });
      });
      /* 标签页支持左右方向键、Home、End */
      byId('eco-tabs').addEventListener('keydown', function (e) {
        var tabs = $$('#eco-tabs [role="tab"]');
        var idx = tabs.indexOf(doc.activeElement);
        var next = -1;
        if (idx < 0) return;
        if (e.key === 'ArrowRight') next = (idx + 1) % tabs.length;
        else if (e.key === 'ArrowLeft') next = (idx - 1 + tabs.length) % tabs.length;
        else if (e.key === 'Home') next = 0;
        else if (e.key === 'End') next = tabs.length - 1;
        if (next < 0) return;
        e.preventDefault();
        tabs[next].focus();
        setTab(tabs[next].getAttribute('data-tab'));
      });

      byId('eco-search').addEventListener('input', debounce(function (e) {
        state.eco.query = e.target.value;
        applySearch();
      }, 150));

      byId('eco-expand').addEventListener('click', function () {
        E.domains.forEach(function (d) { openState[d.id] = true; });
        renderDomains();
      });
      byId('eco-collapse').addEventListener('click', function () {
        E.domains.forEach(function (d) { openState[d.id] = false; });
        renderDomains();
      });

      applySearch();
      setTab('tasks');
    }

    return { init: init, setTab: setTab, refresh: applySearch };
  })();

  /* ------------------------------------------------------------------ 挣值计算器 */

  var evmView = (function () {
    var EVM = CORE.evm;
    var F = EVM.FIELDS;
    var M = EVM.METHODS;
    var KPI_KEYS = ['cv', 'sv', 'cpi', 'spi'];
    var FORECAST_KEYS = ['eac', 'etc', 'vac', 'tcpi'];
    var kpiNodes = {};
    var forecastNodes = {};
    var chart = byId('evm-chart');
    var chartWidth = 0;

    function buildForm() {
      fill(byId('evm-form'), F.map(function (f) {
        var id = 'evm-' + f.key;
        var input = el('input', {
          class: 'input num', type: 'text', inputmode: 'decimal', autocomplete: 'off',
          id: id, placeholder: '例如 ' + EVM.fmtMoney(f.example),
          'aria-describedby': id + '-hint ' + id + '-err'
        });
        input.addEventListener('input', schedule);
        input.addEventListener('blur', function () {
          state.evm.touched[f.key] = true;
          recalc();
        });
        return el('div', { class: 'field' }, [
          el('label', { class: 'label', for: id }, [doc.createTextNode(f.name + ' '), el('span', { class: 'mono', text: f.abbr })]),
          input,
          el('span', { class: 'hint', id: id + '-hint', text: f.hint }),
          el('span', { class: 'error-text', id: id + '-err', hidden: '' }, [icon('exclamation-circle', 'icon--sm'), el('span')])
        ]);
      }));
    }

    function buildPresets() {
      fill(byId('evm-presets'), EVM.presets(DATA).map(function (p) {
        var btn = el('button', { class: 'btn btn--secondary btn--sm', type: 'button', text: '载入：' + p.name });
        btn.addEventListener('click', function () {
          F.forEach(function (f) { byId('evm-' + f.key).value = String(p[f.key]); });
          state.evm.touched = {};
          recalc();
          ZDX.toast('已载入示例：' + p.name, 'info');
        });
        return btn;
      }));
    }

    function currentMethod() {
      for (var i = 0; i < M.length; i++) if (M[i].id === state.evm.eac) return M[i];
      return M[0];
    }

    function syncMethods() {
      $$('#evm-methods [data-eac]').forEach(function (b) {
        b.setAttribute('aria-pressed', b.getAttribute('data-eac') === state.evm.eac ? 'true' : 'false');
      });
      var m = currentMethod();
      setText(byId('evm-assume'), m.name + '：' + m.assume + '公式是 ' + m.formula + '。');
    }

    function buildMethods() {
      fill(byId('evm-methods'), M.map(function (m) {
        var btn = el('button', { class: 'segmented__btn', type: 'button', 'data-eac': m.id }, [doc.createTextNode(m.name)]);
        btn.addEventListener('click', function () {
          state.evm.eac = m.id;
          syncMethods();
          recalc();
        });
        return btn;
      }));
      syncMethods();
    }

    function buildResults() {
      var names = EVM.compute({}, {}).byKey;
      fill(byId('evm-kpis'), KPI_KEYS.map(function (key) {
        var value = el('span', { class: 'kpi__value num', text: '—' });
        var verdict = el('span', { class: 'kpi__verdict' });
        kpiNodes[key] = { value: value, verdict: verdict };
        return el('div', { class: 'kpi' }, [
          el('span', { class: 'kpi__name' }, [
            el('span', { class: 'kpi__abbr', text: key.toUpperCase() }),
            doc.createTextNode(' ' + names[key].name)
          ]),
          value,
          verdict
        ]);
      }));
      fill(byId('evm-forecast'), FORECAST_KEYS.map(function (key) {
        var nodes = {
          name: el('span', { class: 'metric__name', text: names[key].name }),
          formula: el('span', { class: 'metric__formula', text: names[key].formula }),
          value: el('span', { class: 'metric__value num', text: '—' }),
          text: el('p', { class: 'metric__text' })
        };
        forecastNodes[key] = nodes;
        return el('div', { class: 'metric' }, [
          el('div', { class: 'metric__head' }, [el('span', { class: 'metric__abbr', text: key.toUpperCase() }), nodes.name]),
          nodes.value,
          nodes.formula,
          nodes.text
        ]);
      }));
    }

    function formatValue(m) {
      if (m.value === null) return '—';
      return m.unit === 'money' ? EVM.fmtMoney(m.value) : EVM.fmtIndex(m.value);
    }

    function renderSummary(result) {
      var box = byId('evm-summary');
      var tone = result.summary.tone;
      box.className = 'callout callout--' + tone;
      var glyph = tone === 'success' ? 'check-circle'
        : tone === 'warning' ? 'exclamation-triangle'
        : tone === 'danger' ? 'exclamation-circle' : 'information-circle';
      box.querySelector('use').setAttribute('href', '#i-' + glyph);
      setText(byId('evm-summary-title'), result.summary.title);
      setText(byId('evm-summary-text'), result.summary.text);
    }

    function renderResults(result) {
      KPI_KEYS.forEach(function (key) {
        var m = result.byKey[key];
        var nodes = kpiNodes[key];
        var na = m.value === null;
        setText(nodes.value, formatValue(m));
        nodes.value.classList.toggle('is-na', na);
        nodes.value.title = na ? (m.reason || '') : '';
        /* 不可计算时，格子里的“—”配一句简短原因，完整原因见下方解读 */
        setText(nodes.verdict, na ? firstSentence(m.reason) : m.text);
        applyTone(nodes.verdict, m.tone);
      });
      FORECAST_KEYS.forEach(function (key) {
        var m = result.byKey[key];
        var nodes = forecastNodes[key];
        var na = m.value === null;
        setText(nodes.name, m.name);
        setText(nodes.formula, m.formula);
        setText(nodes.value, formatValue(m));
        nodes.value.classList.toggle('is-na', na);
        setText(nodes.text, m.text);
        applyTone(nodes.text, m.tone);
      });
    }

    function renderLegend(result) {
      var scale = EVM.chartScale(result.chart);
      var items = result.chart.bars.map(function (b) {
        return el('span', null, [
          el('span', { class: 'swatch swatch--' + b.key, 'aria-hidden': 'true' }),
          doc.createTextNode(b.name + ' ' + b.abbr + '：' + (b.value === null ? '未填写' : EVM.fmtMoney(b.value)))
        ]);
      });
      var bac = result.inputs.bac;
      var bacText = bac === null
        ? '完工预算 BAC：未填写'
        : '完工预算 BAC：' + EVM.fmtMoney(bac) + (scale.bacVisible ? '（图中虚线）' : scale.max ? '（超出坐标范围，未画出）' : '');
      items.push(el('span', null, [el('span', { class: 'swatch swatch--bac', 'aria-hidden': 'true' }), doc.createTextNode(bacText)]));
      fill(byId('evm-legend'), items);
      setText(byId('evm-bac-meta'), bac === null ? '' : 'BAC ' + EVM.fmtMoney(bac));
    }

    /* 柱状图：1 个用户单位 = 1 像素，按容器实际宽度排版，窄屏下文字不会被缩小 */
    function renderChart(result) {
      var width = chart.clientWidth > 0 ? Math.round(chart.clientWidth) : (chartWidth || 560);
      chartWidth = width;
      var height = Math.round(Math.min(320, Math.max(210, width * 0.36)));
      chart.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
      Array.prototype.slice.call(chart.childNodes).forEach(function (n) {
        if (n.nodeName !== 'defs' && n.nodeName !== 'title' && n.nodeName !== 'desc') chart.removeChild(n);
      });

      var scale = EVM.chartScale(result.chart);
      var x0 = width < 420 ? 52 : 64;
      var x1 = width - 12;
      var y0 = height - 44;
      var y1 = 30;
      var plotH = y0 - y1;

      if (!scale.max) {
        chart.appendChild(svg('text', { class: 'chart__empty', x: width / 2, y: (y0 + y1) / 2, 'text-anchor': 'middle' }, '输入数值后显示 PV、EV、AC 的对比'));
        setText(byId('evm-chart-desc'), '还没有可用的数值。');
        renderLegend(result);
        return;
      }

      [0, scale.top / 2, scale.top].forEach(function (tick) {
        var y = y0 - tick / scale.top * plotH;
        if (tick > 0) chart.appendChild(svg('line', { class: 'chart__grid', x1: x0, x2: x1, y1: y, y2: y }));
        chart.appendChild(svg('text', { class: 'chart__axis', x: x0 - 8, y: y + 4, 'text-anchor': 'end' }, EVM.fmtMoney(tick)));
      });
      chart.appendChild(svg('line', { class: 'chart__grid', x1: x0, x2: x1, y1: y0, y2: y0 }));

      if (scale.bacVisible) {
        var by = y0 - result.inputs.bac / scale.top * plotH;
        chart.appendChild(svg('line', { class: 'chart__bac', x1: x0, x2: x1, y1: by, y2: by }));
      }

      var slot = (x1 - x0) / 3;
      var barW = Math.min(88, slot * 0.5);
      var desc = [];
      result.chart.bars.forEach(function (b, i) {
        var cx = x0 + slot * (i + 0.5);
        if (b.value === null || b.value === 0) {
          chart.appendChild(svg('rect', { class: 'chart__stub', x: cx - barW / 2, y: y0 - 2, width: barW, height: 2 }));
          chart.appendChild(svg('text', { class: 'chart__axis', x: cx, y: y0 - 10, 'text-anchor': 'middle' }, b.value === null ? '未填写' : '0'));
          desc.push(b.name + ' ' + (b.value === null ? '未填写' : '0'));
        } else {
          var h = Math.max(2, b.value / scale.top * plotH);
          var rect = svg('rect', { class: 'chart__bar chart__bar--' + b.key, x: cx - barW / 2, y: y0 - h, width: barW, height: h, rx: 3 });
          if (b.key === 'ac') rect.setAttribute('fill', 'url(#evm-hatch)');
          chart.appendChild(rect);
          chart.appendChild(svg('text', { class: 'chart__value', x: cx, y: y0 - h - 8, 'text-anchor': 'middle' }, EVM.fmtMoney(b.value)));
          desc.push(b.name + ' ' + EVM.fmtMoney(b.value));
        }
        chart.appendChild(svg('text', { class: 'chart__label', x: cx, y: y0 + 22, 'text-anchor': 'middle' }, b.name + ' ' + b.abbr));
      });
      setText(byId('evm-chart-desc'), desc.join('，') + '。');
      renderLegend(result);
    }

    function recalc() {
      var raw = {};
      F.forEach(function (f) { raw[f.key] = byId('evm-' + f.key).value; });
      var checked = EVM.validate(raw, state.evm.touched);
      checked.fields.forEach(function (f) {
        var err = byId('evm-' + f.key + '-err');
        byId('evm-' + f.key).setAttribute('aria-invalid', f.showError ? 'true' : 'false');
        err.hidden = !f.showError;
        setText(err.lastElementChild, f.showError ? f.message : '');
      });
      var result = EVM.compute(checked.values, { eac: state.evm.eac });
      renderSummary(result);
      renderResults(result);
      renderChart(result);
    }
    var schedule = debounce(recalc, 150);

    function init() {
      buildForm();
      buildPresets();
      buildMethods();
      buildResults();
      setText(byId('evm-note'), DATA.TEXTS.evmNote);
      byId('evm-clear').addEventListener('click', function () {
        F.forEach(function (f) { byId('evm-' + f.key).value = ''; });
        state.evm.touched = {};
        recalc();
        byId('evm-pv').focus();
      });
      window.addEventListener('resize', debounce(function () {
        if (state.view === 'evm') recalc();
      }, 150));
      recalc();
    }

    return { init: init, refresh: recalc };
  })();

  /* ------------------------------------------------------------------ 风险登记册 */

  var riskView = (function () {
    var R = CORE.risk;
    var LIMIT = 200;
    var SCALE_LABELS = ['很低', '低', '中等', '高', '很高'];
    var typeById = {};
    var focusById = {};
    var customSeq = 0;
    var dialog = byId('risk-dialog');
    var form = byId('risk-form');
    var editingId = null;

    DATA.PROJECT_TYPES.forEach(function (t) { typeById[t.id] = t; });
    DATA.FOCUS_AREAS.forEach(function (f) { focusById[f.id] = f; });

    function type() { return typeById[state.risk.type] || DATA.PROJECT_TYPES[0]; }
    function focus() { return focusById[state.risk.focus] || DATA.FOCUS_AREAS[0]; }
    function currentKey() { return state.risk.type + '|' + state.risk.focus; }
    function savedList() { return state.risk.register[currentKey()] || null; }

    /* 当前清单：本机存过就用存的，否则用风险库里的默认清单 */
    function list() {
      var saved = savedList();
      return saved ? saved : R.defaults(DATA.RISK_LIBRARY, state.risk.type, state.risk.focus);
    }

    function save(next) {
      state.risk.register[currentKey()] = next;
      riskStore.set('register', state.risk.register);
      updateProgressBadges();
    }

    function findRisk(id) {
      var found = null;
      list().forEach(function (r) { if (r.id === id) found = r; });
      return found;
    }

    function load() {
      var selection = riskStore.get('selection', null);
      if (selection && typeById[selection.type] && focusById[selection.focus]) {
        state.risk.type = selection.type;
        state.risk.focus = selection.focus;
      }
      var stored = riskStore.get('register', null);
      if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return;
      Object.keys(stored).forEach(function (k) {
        var parts = k.split('|');
        if (parts.length !== 2 || !typeById[parts[0]] || !focusById[parts[1]]) return;
        var cleaned = R.normalizeList(stored[k]);
        if (cleaned.length) state.risk.register[k] = cleaned;
      });
    }

    /* 单选胶囊：真实的 radio 留在 DOM 里，键盘可以用方向键切换 */
    function buildPicks() {
      [
        ['risk-types', DATA.PROJECT_TYPES, state.risk.type],
        ['risk-focuses', DATA.FOCUS_AREAS, state.risk.focus]
      ].forEach(function (cfg) {
        var name = cfg[0];
        fill(byId(name), cfg[1].map(function (it) {
          var input = el('input', { class: 'pick__input', type: 'radio', name: name, value: it.id });
          if (it.id === cfg[2]) input.setAttribute('checked', '');
          return el('label', { class: 'pick' }, [input, el('span', { class: 'pick__text', text: it.name })]);
        }));
        byId(name).addEventListener('change', function (e) {
          if (!e.target || e.target.name !== name) return;
          if (name === 'risk-types') state.risk.type = e.target.value;
          else state.risk.focus = e.target.value;
          state.risk.limit = LIMIT;
          riskStore.set('selection', { type: state.risk.type, focus: state.risk.focus });
          render();
        });
      });
    }

    function renderMatrix(sorted) {
      var m = R.matrix(sorted);
      var table = el('table', { class: 'matrix', 'aria-label': '5 × 5 风险矩阵：行是概率，列是影响' });
      var head = doc.createElement('tr');
      head.appendChild(el('th', { scope: 'col', text: '概率 ＼ 影响' }));
      for (var i = 1; i <= 5; i++) head.appendChild(el('th', { scope: 'col', text: String(i) }));
      table.appendChild(el('thead', null, [head]));
      var body = doc.createElement('tbody');
      for (var p = 5; p >= 1; p--) {
        var row = doc.createElement('tr');
        row.appendChild(el('th', { scope: 'row', text: String(p) }));
        for (var j = 1; j <= 5; j++) {
          var cell = m.cells[(p - 1) * 5 + (j - 1)];
          var tier = R.tier(cell.score);
          var td = el('td', {
            'data-tier': cell.tier,
            'aria-label': '概率 ' + p + '，影响 ' + j + '，风险值 ' + cell.score + '，' + tier.label + '色，' + cell.count + ' 条'
          });
          if (cell.count) td.appendChild(el('span', { class: 'matrix__count', text: String(cell.count) }));
          row.appendChild(td);
        }
        body.appendChild(row);
      }
      table.appendChild(body);
      fill(byId('risk-matrix'), [table]);
      return m;
    }

    function renderLegend(m) {
      fill(byId('risk-legend'), R.TIERS.map(function (t) {
        return el('li', { class: 'tier-' + t.id }, [
          el('span', { class: 'legend__chip', 'aria-hidden': 'true' }),
          el('span', { class: 'legend__range num', text: t.range }),
          el('span', { class: 'legend__rule', text: t.rule + '（' + m.tiers[t.id] + ' 条）' })
        ]);
      }));
    }

    function buildRow(r) {
      var score = R.score(r);
      var tier = R.tier(score);
      var isThreat = r.kind === 'threat';

      /* 威胁 / 机会切换：切换后策略的选项随之变化 */
      var kindToggle = el('div', { class: 'segmented risk__kind', role: 'group', 'aria-label': '风险类型：' + r.title });
      [['threat', '威胁'], ['opportunity', '机会']].forEach(function (k) {
        kindToggle.appendChild(el('button', {
          class: 'segmented__btn', type: 'button', 'data-act': 'kind', 'data-kind': k[0],
          'aria-pressed': k[0] === r.kind ? 'true' : 'false', text: k[1]
        }));
      });

      function select(act, labelText, options, current) {
        var sel = el('select', { class: 'select', 'data-act': act, 'aria-label': labelText + '：' + r.title });
        options.forEach(function (value) {
          var option = el('option', { value: String(value), text: String(value) });
          if (String(value) === String(current)) option.setAttribute('selected', '');
          sel.appendChild(option);
        });
        return el('label', { class: 'risk__field' }, [el('span', { class: 'label', text: labelText }), sel]);
      }

      var edit = el('button', {
        class: 'btn btn--secondary btn--icon', type: 'button', 'data-act': 'edit',
        'aria-label': '编辑风险：' + r.title, title: '编辑风险'
      }, [icon('pencil-square', 'icon--sm')]);
      var del = el('button', {
        class: 'btn btn--secondary btn--icon', type: 'button', 'data-act': 'delete',
        'aria-label': '删除风险：' + r.title, title: '删除风险'
      }, [icon('trash', 'icon--sm')]);

      return el('article', { class: 'risk', 'data-id': r.id }, [
        el('div', { class: 'risk__score tier-' + tier.id, role: 'img', 'aria-label': '风险值 ' + score + '，' + tier.label + '档' }, [
          el('span', { class: 'num', text: String(score) }),
          el('span', { class: 'risk__tier', text: tier.label })
        ]),
        el('div', { class: 'risk__main' }, [
          el('div', { class: 'risk__title-row' }, [
            badge(isThreat ? '威胁' : '机会', isThreat ? 'badge--warning' : 'badge--success'),
            el('h3', { class: 'risk__title', text: r.title }),
            r.custom ? badge('自定义', 'badge--outline') : null
          ]),
          el('dl', { class: 'risk__facts' }, [
            el('div', null, [el('dt', { text: '预警信号' }), el('dd', { text: r.signal })]),
            el('div', null, [el('dt', { text: '应对措施' }), el('dd', { text: r.response })])
          ])
        ]),
        el('div', { class: 'risk__controls' }, [
          kindToggle,
          select('p', '概率 P', [1, 2, 3, 4, 5], r.p),
          select('i', '影响 I', [1, 2, 3, 4, 5], r.i),
          select('strategy', '应对策略', R.STRATEGIES[r.kind], r.strategy),
          el('div', { class: 'risk__actions' }, [edit, del])
        ])
      ]);
    }

    /* 改动后整张清单会重排，把焦点还给同一个控件，键盘操作不会中断 */
    function restoreFocus(info) {
      if (!info) return;
      var rows = $$('#risk-list .risk');
      for (var i = 0; i < rows.length; i++) {
        if (rows[i].getAttribute('data-id') !== info.id) continue;
        var candidates = $$('[data-act="' + info.act + '"]', rows[i]);
        for (var j = 0; j < candidates.length; j++) {
          if (!info.kind || candidates[j].getAttribute('data-kind') === info.kind) {
            candidates[j].focus();
            return;
          }
        }
      }
    }

    function renderList(sorted, focusInfo) {
      var box = byId('risk-list');
      if (!sorted.length) {
        fill(box, [el('p', { class: 'risk__empty', text: '这个组合下的清单是空的。点右上角的“添加自定义风险”，或者用“恢复默认清单”找回默认风险。' })]);
      } else {
        fill(box, sorted.slice(0, state.risk.limit).map(buildRow));
      }
      /* 一次最多渲染 200 行，其余的按需再显示 */
      var rest = sorted.length - Math.min(sorted.length, state.risk.limit);
      byId('risk-list-foot').hidden = rest <= 0;
      setText(byId('risk-more'), rest > 0 ? '再显示 ' + Math.min(LIMIT, rest) + ' 条（还有 ' + rest + ' 条）' : '');
      restoreFocus(focusInfo);
    }

    function render(focusInfo) {
      var sorted = R.sort(list());
      var saved = !!savedList();
      setText(byId('risk-meta'), type().name + ' · ' + focus().name + ' · ' + sorted.length + ' 条' + (saved ? ' · 本机已保存修改' : ' · 默认清单'));
      var m = renderMatrix(sorted);
      renderLegend(m);
      fill(byId('risk-stats'), [
        stat(String(sorted.length), '风险条数'),
        stat(String(m.kinds.threat), '威胁'),
        stat(String(m.kinds.opportunity), '机会'),
        stat(String(m.tiers.red), '红档：优先处理')
      ]);
      byId('risk-reset').disabled = !saved;
      renderList(sorted, focusInfo);
    }

    function apply(id, patch, focusInfo) {
      save(R.update(list(), id, patch));
      render(focusInfo);
    }

    /* 本机清单相对默认清单改了多少处 */
    function countChanges(defaults, saved) {
      var before = {};
      var after = {};
      var out = { added: 0, removed: 0, changed: 0, total: 0 };
      var same = function (a, b) {
        return a.p === b.p && a.i === b.i && a.kind === b.kind && a.strategy === b.strategy &&
          a.title === b.title && a.signal === b.signal && a.response === b.response;
      };
      defaults.forEach(function (r) { before[r.id] = r; });
      saved.forEach(function (r) { after[r.id] = r; });
      saved.forEach(function (r) {
        if (!before[r.id]) out.added += 1;
        else if (!same(before[r.id], r)) out.changed += 1;
      });
      defaults.forEach(function (r) { if (!after[r.id]) out.removed += 1; });
      out.total = out.added + out.removed + out.changed;
      return out;
    }

    function confirmDelete(id) {
      var r = findRisk(id);
      if (!r) return;
      askConfirm({
        title: '删除这条风险？',
        body: '“' + r.title + '”会从“' + type().name + ' · ' + focus().name + '”的清单里移除，此操作无法撤销。如果它是默认风险，之后可以用“恢复默认清单”找回来。',
        okLabel: '删除这条风险',
        cancelLabel: '保留这条风险',
        onOk: function () {
          save(R.remove(list(), id));
          render();
          ZDX.toast('已删除风险', 'info');
        }
      });
    }

    function confirmReset() {
      if (!savedList()) return;
      var defaults = R.defaults(DATA.RISK_LIBRARY, state.risk.type, state.risk.focus);
      var diff = countChanges(defaults, savedList());
      askConfirm({
        title: '恢复默认清单？',
        body: '将丢弃“' + type().name + ' · ' + focus().name + '”在本机的 ' + diff.total + ' 处改动（新增 ' + diff.added +
          ' 条、删除 ' + diff.removed + ' 条、修改 ' + diff.changed + ' 条），恢复为风险库里的 ' + defaults.length +
          ' 条默认风险。此操作无法撤销。',
        okLabel: '恢复 ' + defaults.length + ' 条默认风险',
        cancelLabel: '保留当前清单',
        onOk: function () {
          delete state.risk.register[currentKey()];
          riskStore.set('register', state.risk.register);
          state.risk.limit = LIMIT;
          render();
          updateProgressBadges();
          ZDX.toast('已恢复默认清单', 'success');
        }
      });
    }

    /* ---------- 添加 / 编辑风险 ---------- */

    function fillSelect(sel, values, current) {
      fill(sel, values.map(function (v) {
        var option = el('option', { value: String(v.value), text: v.label });
        if (String(v.value) === String(current)) option.setAttribute('selected', '');
        return option;
      }));
    }

    function kindValue() {
      var checked = form.querySelector('input[name="risk-kind"]:checked');
      return checked ? checked.value : 'threat';
    }

    function syncStrategyHint() {
      var hints = DATA.TEXTS.strategyHints[kindValue()] || {};
      setText(byId('risk-strategy-hint'), hints[byId('risk-strategy').value] || '');
    }

    /* 策略下拉的选项随风险类型变化；含义对应的策略保留，其余换成对应的那个 */
    function syncStrategyOptions() {
      var sel = byId('risk-strategy');
      var previous = sel.value;
      var kind = kindValue();
      var options = R.STRATEGIES[kind];
      var next = options.indexOf(previous) >= 0 ? previous : (R.COUNTERPART[previous] || (kind === 'threat' ? '减轻' : '提高'));
      if (options.indexOf(next) < 0) next = options[options.length - 2] || options[0];
      fillSelect(sel, options.map(function (s) { return { value: s, label: s }; }), next);
      syncStrategyHint();
    }

    function showError(key, message) {
      var err = byId('risk-' + key + '-err');
      err.hidden = !message;
      setText(err.lastElementChild, message || '');
      byId('risk-' + key).setAttribute('aria-invalid', message ? 'true' : 'false');
    }

    function clearErrors() {
      ['title', 'signal', 'response'].forEach(function (k) { showError(k, ''); });
    }

    function openDialog(mode, id) {
      var r = mode === 'edit' ? findRisk(id) : null;
      editingId = r ? r.id : null;
      setText(byId('risk-dialog-title'), r ? '编辑风险' : '添加自定义风险');
      setText(byId('risk-submit'), r ? '保存修改' : '添加风险');
      byId('risk-title').value = r ? r.title : '';
      byId('risk-signal').value = r ? r.signal : '';
      byId('risk-response').value = r ? r.response : '';
      var scale = [1, 2, 3, 4, 5].map(function (n) { return { value: n, label: n + ' · ' + SCALE_LABELS[n - 1] }; });
      fillSelect(byId('risk-p'), scale, r ? r.p : 3);
      fillSelect(byId('risk-i'), scale, r ? r.i : 3);
      $$('input[name="risk-kind"]', form).forEach(function (input) {
        input.checked = input.value === (r ? r.kind : 'threat');
      });
      syncStrategyOptions();
      if (r && R.STRATEGIES[r.kind].indexOf(r.strategy) >= 0) {
        byId('risk-strategy').value = r.strategy;
        syncStrategyHint();
      }
      clearErrors();
      ZDX.openDialog(dialog);
      byId('risk-title').focus();
    }

    function newId() {
      customSeq += 1;
      return 'c-' + Date.now().toString(36) + '-' + customSeq;
    }

    /* ---------- 导出 ---------- */

    function dateStamp() {
      var d = new Date();
      var pad = function (n) { return (n < 10 ? '0' : '') + n; };
      return '' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate());
    }

    function exportAs(format) {
      var sorted = R.sort(list());
      if (!sorted.length) {
        ZDX.toast('清单是空的，先添加风险再导出', 'warning');
        return;
      }
      var meta = { type: type().name, focus: focus().name };
      var name = '风险登记册_' + type().file + '_' + focus().name + '_' + dateStamp();
      if (format === 'csv') {
        ZDX.download(name + '.csv', R.csv(sorted, meta), 'text/csv;charset=utf-8');
        ZDX.toast('已导出 ' + sorted.length + ' 条风险（CSV，UTF-8 带 BOM）', 'success');
      } else if (format === 'md') {
        ZDX.download(name + '.md', R.markdown(sorted, meta), 'text/markdown;charset=utf-8');
        ZDX.toast('已导出 ' + sorted.length + ' 条风险（Markdown 表格）', 'success');
      } else {
        ZDX.copy(R.markdown(sorted, meta)).then(function () {
          ZDX.toast('已复制 ' + sorted.length + ' 条风险的 Markdown 表格', 'success');
        }, function () {
          ZDX.toast('复制失败：浏览器没有授权访问剪贴板。请改用“导出 Markdown”。', 'danger');
        });
      }
    }

    function resetAll() {
      state.risk.register = {};
      state.risk.type = 'software';
      state.risk.focus = 'init';
      state.risk.limit = LIMIT;
      buildPicks();
      render();
    }

    function init() {
      load();
      buildPicks();
      setText(byId('risk-basis'), DATA.TEXTS.riskBasis);

      byId('btn-add-risk').addEventListener('click', function () { openDialog('add'); });
      byId('risk-export-csv').addEventListener('click', function () { exportAs('csv'); });
      byId('risk-export-md').addEventListener('click', function () { exportAs('md'); });
      byId('risk-copy').addEventListener('click', function () { exportAs('copy'); });
      byId('risk-reset').addEventListener('click', confirmReset);
      byId('risk-more').addEventListener('click', function () {
        state.risk.limit += LIMIT;
        render();
      });

      var listBox = byId('risk-list');
      listBox.addEventListener('change', function (e) {
        var control = e.target;
        var row = control.closest ? control.closest('.risk') : null;
        if (!row || !control.hasAttribute('data-act')) return;
        var act = control.getAttribute('data-act');
        var id = row.getAttribute('data-id');
        var patch = {};
        if (act === 'p' || act === 'i') patch[act] = Number(control.value);
        else if (act === 'strategy') patch.strategy = control.value;
        else return;
        apply(id, patch, { id: id, act: act });
      });
      listBox.addEventListener('click', function (e) {
        var btn = e.target.closest ? e.target.closest('button[data-act]') : null;
        var row = btn ? btn.closest('.risk') : null;
        if (!row) return;
        var id = row.getAttribute('data-id');
        var act = btn.getAttribute('data-act');
        if (act === 'kind') {
          var current = findRisk(id);
          var kind = btn.getAttribute('data-kind');
          if (!current || kind === current.kind) return;
          var switched = R.switchKind(current, kind);
          apply(id, { kind: switched.kind, strategy: switched.strategy }, { id: id, act: 'kind', kind: kind });
        } else if (act === 'edit') {
          openDialog('edit', id);
        } else if (act === 'delete') {
          confirmDelete(id);
        }
      });

      /* 表单：切换威胁 / 机会时更新策略选项 */
      form.addEventListener('change', function (e) {
        if (e.target && e.target.name === 'risk-kind') syncStrategyOptions();
      });
      byId('risk-strategy').addEventListener('change', syncStrategyHint);
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var draft = {
          title: byId('risk-title').value,
          signal: byId('risk-signal').value,
          response: byId('risk-response').value,
          p: Number(byId('risk-p').value),
          i: Number(byId('risk-i').value),
          kind: kindValue(),
          strategy: byId('risk-strategy').value
        };
        var errors = R.validateForm(draft);
        ['title', 'signal', 'response'].forEach(function (k) { showError(k, errors[k]); });
        var first = ['title', 'signal', 'response'].filter(function (k) { return errors[k]; })[0];
        if (first) {
          byId('risk-' + first).focus();
          return;
        }
        var wasEditing = !!editingId;
        draft.id = editingId || newId();
        draft.custom = true;
        save(R.upsert(list(), draft));
        editingId = null;
        ZDX.closeDialog(dialog);
        render();
        updateProgressBadges();
        ZDX.toast(wasEditing ? '已保存修改' : '已添加风险', 'success');
      });
      $$('[data-close]', dialog).forEach(function (b) {
        b.addEventListener('click', function () { ZDX.closeDialog(dialog); });
      });
      dialog.addEventListener('close', function () { editingId = null; });

      render();
    }

    return { init: init, refresh: function () { render(); }, resetAll: resetAll };
  })();

  /* ------------------------------------------------------------------ 考点速记卡 */

  var cardsView = (function () {
    var C = CORE.cards;
    var fc = byId('fc');
    var hit = byId('fc-hit');
    var STATUS_LABELS = {};
    C.STATUS.forEach(function (s) { STATUS_LABELS[s.id] = s.label; });

    function filtered() { return C.filter(DATA.CARDS, state.cards.filters, state.cards.progress); }
    function currentCard() {
      var id = C.current(state.cards.session);
      return id ? CARD_BY_ID[id] : null;
    }

    /* ---------- 筛选胶囊 ---------- */

    function chipLabel(name, value) {
      if (name === 'status') return STATUS_LABELS[value];
      return value;
    }

    function buildChipRow(id, name, values) {
      fill(byId(id), values.map(function (v) {
        var btn = el('button', { class: 'chip', type: 'button', 'data-value': v, 'aria-pressed': 'false' }, [
          el('span', { 'data-label': '', text: chipLabel(name, v) }),
          el('span', { class: 'chip__count num', 'data-count': '' })
        ]);
        btn.addEventListener('click', function () {
          state.cards.filters[name] = v;
          rebuild();
        });
        return btn;
      }));
    }

    function countCards(filters) {
      return C.filter(DATA.CARDS, filters, state.cards.progress).length;
    }

    function syncChips() {
      var f = state.cards.filters;
      var total = DATA.CARDS.length;
      /* 状态一行的数字随领域、难度和搜索词变化，忽略状态本身 */
      var scope = { domain: f.domain, level: f.level, q: f.q };
      [['cards-f-domain', 'domain'], ['cards-f-level', 'level'], ['cards-f-status', 'status']].forEach(function (row) {
        var name = row[1];
        $$('#' + row[0] + ' .chip').forEach(function (btn) {
          var value = btn.getAttribute('data-value');
          btn.setAttribute('aria-pressed', String(f[name] === value));
          var count;
          if (name === 'status') {
            count = value === 'all' ? countCards(scope) : countCards({ domain: f.domain, level: f.level, q: f.q, status: value });
          } else {
            count = value === '全部' ? total : countCards({ domain: name === 'domain' ? value : '全部', level: name === 'level' ? value : '全部' });
          }
          setText(btn.querySelector('[data-count]'), String(count));
        });
      });
    }

    /* ---------- 卡片舞台 ---------- */

    function setFlipped(on) {
      state.cards.flipped = on;
      fc.setAttribute('data-flipped', on ? 'true' : 'false');
      byId('fc-back').setAttribute('aria-hidden', on ? 'false' : 'true');
      byId('fc-front-face').setAttribute('aria-hidden', on ? 'true' : 'false');
      hit.setAttribute('aria-expanded', on ? 'true' : 'false');
      hit.setAttribute('aria-label', on ? '翻面，显示问题' : '翻面，显示答案');
    }

    function statusBadge(card) {
      var s = C.status(state.cards.progress, card.id);
      if (s === 'known') return badge('已掌握', 'badge--success');
      if (s === 'again') return badge('还不会', 'badge--warning');
      return badge('未学', 'badge--outline');
    }

    function emptyState(options) {
      return el('div', { class: 'empty' }, [
        icon(options.icon),
        el('div', { class: 'empty__title', text: options.title }),
        el('p', { class: 'empty__text', text: options.text }),
        el('div', { class: 'empty__actions' }, options.actions)
      ]);
    }

    function renderStage(focusAfter) {
      var card = currentCard();
      var box = byId('cards-empty');
      if (card) {
        fc.hidden = false;
        byId('fc-controls').hidden = false;
        box.hidden = true;
        fill(byId('fc-tags'), [badge(card.domain, 'badge--accent'), badge(card.level, 'badge--outline'), statusBadge(card)]);
        setText(byId('fc-front'), card.front);
        fill(byId('fc-back-tags'), [badge(card.basis, 'badge--info'), badge(card.domain, 'badge--outline')]);
        fill(byId('fc-answer'), card.back.map(function (line) { return el('li', { text: line }); }));
        var note = byId('fc-note');
        note.hidden = !card.note;
        setText(note, card.note);
        setFlipped(state.cards.flipped);
        return;
      }

      /* 没有可显示的卡：要么筛选结果为空，要么本轮已经过完 */
      fc.hidden = true;
      byId('fc-controls').hidden = true;
      var session = state.cards.session;
      var actions;
      var options;
      if (!filtered().length) {
        options = {
          icon: 'magnifying-glass',
          title: '没有符合条件的卡片',
          text: '换一个领域或难度，或者清除搜索词，再试一次。'
        };
        var clearBtn = el('button', { class: 'btn btn--primary', type: 'button', text: '清除筛选条件' });
        clearBtn.addEventListener('click', function () {
          state.cards.filters = { domain: '全部', level: '全部', status: 'all', q: '' };
          byId('cards-search').value = '';
          rebuild();
        });
        actions = [clearBtn];
      } else {
        var again = Object.keys(session.misses).length;
        var known = Object.keys(session.completed).length;
        options = {
          icon: 'check-badge',
          title: '本轮卡片已过完',
          text: '本轮共评了 ' + session.rated + ' 次，掌握了 ' + known + ' 张，还有 ' + again + ' 张标着“还不会”。'
        };
        var againBtn = el('button', {
          class: 'btn btn--primary', type: 'button',
          text: again ? '再刷一遍还不会的（' + again + ' 张）' : '没有还不会的卡片'
        });
        againBtn.disabled = again === 0;
        againBtn.addEventListener('click', function () {
          state.cards.filters.status = 'again';
          rebuild();
        });
        var restartBtn = el('button', { class: 'btn btn--secondary', type: 'button', text: '用当前条件重新开始' });
        restartBtn.addEventListener('click', rebuild);
        actions = [againBtn, restartBtn];
      }
      box.hidden = false;
      fill(box, [emptyState({ icon: options.icon, title: options.title, text: options.text, actions: actions })]);
      if (focusAfter) {
        var first = box.querySelector('.empty__actions .btn:not(:disabled)') || box.querySelector('.btn');
        if (first) first.focus();
      }
    }

    function renderControls() {
      var session = state.cards.session;
      var card = currentCard();
      byId('cards-prev').disabled = !card || session.pos === 0;
      byId('cards-next').disabled = !card || session.pos >= session.ids.length - 1;
      [byId('cards-flip'), byId('cards-again'), byId('cards-known')].forEach(function (b) { b.disabled = !card; });
      var text = '';
      if (card) {
        var remaining = session.ids.length - session.pos;
        text = '第 ' + (session.pos + 1) + ' / ' + session.ids.length + ' 张 · 本轮还剩 ' + remaining + ' 张' +
          (session.rated ? ' · 已评 ' + session.rated + ' 次' : '');
      }
      setText(byId('fc-progress'), text);
    }

    function bar(label, percent, valueText) {
      return el('span', {
        class: 'progress', role: 'progressbar', 'aria-label': label + '的掌握进度',
        'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(percent)
      }, [el('span', { class: 'progress__bar' })]);
    }

    function renderAside() {
      var all = C.stats(DATA.CARDS, state.cards.progress);
      setText(byId('cards-known-count'), '已掌握 ' + all.known + ' / ' + all.total);
      var progress = byId('cards-progress');
      progress.setAttribute('aria-valuenow', String(all.percent));
      progress.setAttribute('aria-valuetext', '已掌握 ' + all.known + ' 张，共 ' + all.total + ' 张');
      byId('cards-progress-bar').style.width = all.percent + '%';

      /* 当前筛选范围内的状态分布（不受“状态”筛选本身影响） */
      var f = state.cards.filters;
      var scopeCards = C.filter(DATA.CARDS, { domain: f.domain, level: f.level, q: f.q }, state.cards.progress);
      var scope = C.stats(scopeCards, state.cards.progress);
      fill(byId('cards-status'), [
        kv('当前范围', scope.total + ' 张'),
        kv('未学', String(scope.unseen)),
        kv('还不会', String(scope.again)),
        kv('已掌握', String(scope.known))
      ]);

      fill(byId('cards-domain-bars'), all.byDomain.map(function (g) {
        var track = bar(g.key, g.percent);
        track.firstChild.style.width = g.percent + '%';
        return el('li', null, [
          el('span', { class: 'bars__name', text: g.key, title: g.key }),
          track,
          el('span', { class: 'bars__value num', text: g.known + '/' + g.total })
        ]);
      }));
      byId('cards-clear').disabled = all.learned === 0;
    }

    function renderAll(focusAfter) {
      syncChips();
      renderStage(focusAfter);
      renderControls();
      renderAside();
    }

    /* 筛选条件变了，队列重新生成；已经记下的掌握情况不受影响 */
    function rebuild() {
      state.cards.session = C.createSession(filtered(), { shuffle: state.cards.shuffled });
      state.cards.flipped = false;
      renderAll(false);
    }

    /* ---------- 翻面、切换、评分 ---------- */

    function flip() {
      if (!currentCard()) return;
      setFlipped(!state.cards.flipped);
    }

    function go(delta) {
      if (!state.cards.session.ids.length) return;
      C.move(state.cards.session, delta);
      state.cards.flipped = false;
      renderAll(false);
    }

    function rate(rating) {
      var session = state.cards.session;
      var id = C.current(session);
      if (!id) return;
      C.rate(session, id, rating);
      state.cards.progress = C.recordRating(state.cards.progress, id, rating, Date.now(), DATA.CARDS);
      cardStore.set('progress', state.cards.progress);
      state.cards.flipped = false;
      updateProgressBadges();
      renderAll(session.finished);
    }

    /* ---------- 初始化 ---------- */

    function init() {
      state.cards.progress = C.normalizeProgress(cardStore.get('progress', {}), DATA.CARDS);

      buildChipRow('cards-f-domain', 'domain', ['全部'].concat(C.DOMAINS));
      buildChipRow('cards-f-level', 'level', ['全部'].concat(C.LEVELS));
      buildChipRow('cards-f-status', 'status', C.STATUS.map(function (s) { return s.id; }));

      byId('cards-search').addEventListener('input', debounce(function (e) {
        state.cards.filters.q = e.target.value;
        rebuild();
      }, 150));

      var shuffleBtn = byId('cards-shuffle');
      shuffleBtn.addEventListener('click', function () {
        state.cards.shuffled = !state.cards.shuffled;
        shuffleBtn.setAttribute('aria-pressed', state.cards.shuffled ? 'true' : 'false');
        rebuild();
        ZDX.toast(state.cards.shuffled ? '已打乱顺序' : '已恢复原始顺序', 'info');
      });

      hit.addEventListener('click', flip);
      byId('cards-flip').addEventListener('click', flip);
      byId('cards-prev').addEventListener('click', function () { go(-1); });
      byId('cards-next').addEventListener('click', function () { go(1); });
      byId('cards-again').addEventListener('click', function () { rate('again'); });
      byId('cards-known').addEventListener('click', function () { rate('known'); });

      byId('cards-clear').addEventListener('click', function () {
        var stats = C.stats(DATA.CARDS, state.cards.progress);
        if (!stats.learned) return;
        askConfirm({
          title: '清除学习记录？',
          body: '将清空全部 ' + stats.total + ' 张考点卡的掌握情况（已掌握 ' + stats.known + ' 张、还不会 ' + stats.again +
            ' 张），本机的这份记录会被删除，此操作无法撤销。',
          okLabel: '清除 ' + stats.learned + ' 张的记录',
          cancelLabel: '保留学习记录',
          onOk: function () {
            cardStore.remove('progress');
            state.cards.progress = {};
            rebuild();
            updateProgressBadges();
            ZDX.toast('已清除学习记录', 'success');
          }
        });
      });

      /* 快捷键只在速记卡视图里生效，输入框和对话框里的按键不拦截 */
      doc.addEventListener('keydown', function (e) {
        if (state.view !== 'cards' || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
        if (doc.querySelector('dialog[open]')) return;
        var t = e.target;
        var tag = t && t.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (t && t.isContentEditable)) return;
        if (e.key === ' ' || e.key === 'Spacebar') {
          /* 焦点在按钮或链接上时，空格交给控件自己处理，避免翻两次 */
          if (t.closest && t.closest('button, a, summary, [role="button"]')) return;
          e.preventDefault();
          flip();
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault();
          go(-1);
        } else if (e.key === 'ArrowRight') {
          e.preventDefault();
          go(1);
        } else if (e.key === '1') {
          rate('again');
        } else if (e.key === '2') {
          rate('known');
        }
      });

      rebuild();
    }

    return {
      init: init,
      refresh: function () { renderAll(false); },
      setDomain: function (domain) {
        state.cards.filters.domain = C.DOMAINS.indexOf(domain) >= 0 ? domain : '全部';
        rebuild();
      },
      resetAll: function () {
        state.cards.progress = {};
        state.cards.filters = { domain: '全部', level: '全部', status: 'all', q: '' };
        state.cards.shuffled = false;
        byId('cards-shuffle').setAttribute('aria-pressed', 'false');
        byId('cards-search').value = '';
        rebuild();
      }
    };
  })();

  /* ------------------------------------------------------------------ 关于本工具 */

  function renderAbout() {
    var T = DATA.TEXTS;
    setText(byId('about-version'), 'v' + T.version);
    renderSources('about-sources');
    fill(byId('about-notes'), T.aboutNotes.map(function (n) {
      return el('li', null, [el('span', { class: 'fact-list__title', text: n.title }), el('span', { class: 'fact-list__text', text: n.text })]);
    }));
    setText(byId('about-disclaimer'), T.disclaimer);
    setText(byId('about-trademark'), T.trademark);
    setText(byId('about-local'), T.localData);

    var counts = {};
    DATA.CARDS.forEach(function (c) { counts[c.basis] = (counts[c.basis] || 0) + 1; });
    fill(byId('about-basis'), CORE.cards.BASES.map(function (basis) {
      return el('tr', null, [
        el('td', { text: basis }),
        el('td', { class: 'num', text: String(counts[basis] || 0) }),
        el('td', { text: T.basisNotes[basis] || '' })
      ]);
    }));
    setText(byId('about-cards-meta'), '共 ' + DATA.CARDS.length + ' 张');
  }

  byId('btn-clear-all').addEventListener('click', function () {
    var stats = CORE.cards.stats(DATA.CARDS, state.cards.progress);
    var combos = Object.keys(state.risk.register).length;
    if (!stats.learned && !combos) {
      ZDX.toast('本机没有保存过记录，不需要清除', 'info');
      return;
    }
    var parts = [];
    if (stats.learned) parts.push(stats.learned + ' 张考点卡的掌握情况');
    if (combos) parts.push(combos + ' 个风险组合的修改');
    askConfirm({
      title: '清除本机记录？',
      body: '将从这台设备的浏览器里删除' + parts.join('和') + '。此操作无法撤销，之后需要重新开始记录。',
      okLabel: '清除本机记录',
      cancelLabel: '保留记录',
      onOk: function () {
        riskStore.remove('register');
        riskStore.remove('selection');
        cardStore.remove('progress');
        riskView.resetAll();
        cardsView.resetAll();
        updateProgressBadges();
        ZDX.toast('已清除本机记录', 'success');
      }
    });
  });

  /* ------------------------------------------------------------------ 启动 */

  function init() {
    riskView.init();
    cardsView.init();
    eco.init();
    evmView.init();
    renderAbout();
    bindNav();
    updateProgressBadges();
    showView('overview');
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init);
  else init();
})();
