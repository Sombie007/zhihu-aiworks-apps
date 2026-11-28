/*
 * 表格清洗 · 界面逻辑
 * ----------------------------------------------------------------------------
 * 纯原生 JS，不依赖任何外部库。解析、清洗、导出都调用 core.js（window.APP_CORE），
 * 这里只负责：状态、事件、把算出来的结果画到页面上。
 *
 * 约定：
 * - 状态都放在下面一个 state 对象里；改了规则就重新算一遍（输入框里的改动做了防抖）。
 * - 渲染一律用 textContent / ZDX.el()，不拼 HTML。
 * - 对比表每页最多 200 行；列概况只在看的时候才算。
 * - 给用户看的提示按「发生了什么 / 为什么 / 怎么改」写。
 */
(function () {
  'use strict';

  var ZDX = window.ZDX;
  var CORE = window.APP_CORE;
  var APP_DATA = window.APP_DATA;

  var PREVIEW_ROWS = CORE.PREVIEW_ROWS;          /* 对比表每页的行数：200 */
  var HISTORY_LIMIT = 20;                        /* 规则改动最多撤销几步 */
  var OVERVIEW_PREVIEW_ROWS = 10;                /* 开始视图里原始数据预览的行数 */
  var SCALE_HINT_ROWS = 20000;                   /* 超过这么多行提示「数据较大」 */
  var MAX_FILE_BYTES = 50 * 1024 * 1024;         /* 单个文件上限 50 MB */
  var BUSY_THRESHOLD_CELLS = 200000;             /* 超过这么多单元格时，先画出忙碌状态再计算 */
  var UNDO_MERGE_MS = 1000;                      /* 同一个输入框在这个时间内连续输入只算一步 */
  var RECOMPUTE_DELAY = 150;                     /* 规则改动后多久重算 */
  var DETECT_DELAY = 150;                        /* 粘贴后多久识别分隔符 */
  var ISSUE_LIST_LIMIT = 100;                    /* 日期问题最多列几条 */
  var REMOVED_LIST_LIMIT = 50;                   /* 被删除的行最多列几条 */

  var VIEW_TITLES = { start: '开始', rules: '清洗规则', columns: '列概况', result: '结果与导出', guide: '使用说明' };

  var TYPE_LABELS = { integer: '整数', decimal: '小数', date: '日期', percent: '百分比', currency: '货币', boolean: '布尔', text: '文本', empty: '空' };
  var TYPE_BADGE = { integer: 'badge--success', decimal: 'badge--success', date: 'badge--success', percent: 'badge--info', currency: 'badge--info', boolean: 'badge--warning', text: 'badge--outline', empty: '' };
  var FORMAT_LABELS = { csv: 'CSV', tsv: 'TSV', json: 'JSON' };

  /* ---------- 状态 ---------- */

  var state = {
    view: 'start',
    startMode: 'import',                 /* 开始视图：import 显示导入入口，overview 显示数据概况 */
    importOpts: { delimiter: 'auto', hasHeader: true },
    pendingFile: null,                   /* 刚读进来的文件的信息（文本已经放进粘贴框） */
    source: null,                        /* 当前数据来自哪里、怎么识别的 */
    table: null,                         /* 原始表格 { header, rows, hasHeader, width, report } */
    rawDuplicates: 0,                    /* 原始数据里完全重复的行数（和规则无关） */
    rules: CORE.defaultRules(),
    result: null,                        /* core.applyRules 的结果 */
    history: [],                         /* 规则改动的历史 [{ rules, label, field, time }] */
    profileMode: 'cleaned',
    profile: null,                       /* 列概况的缓存，每次重算后清掉 */
    compareMode: 'cleaned',
    showRemoved: false,
    page: 1,
    exportName: '',
    confirmAction: null
  };

  var els = {};                          /* 按 id 缓存的元素 */
  var timers = {};                       /* 防抖用的定时器 */

  /* ---------- 小工具 ---------- */

  function el(id) {
    return els[id] || (els[id] = document.getElementById(id));
  }

  function setText(node, text) {
    node.textContent = text == null ? '' : String(text);
  }

  function show(node, visible) {
    node.hidden = !visible;
  }

  function node(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = String(text);
    return n;
  }

  /* 带等宽数字的片段：parts 是字符串（原样）或数字（包一层 .num） */
  function numbered(parts) {
    var frag = document.createDocumentFragment();
    parts.forEach(function (part) {
      frag.appendChild(typeof part === 'number' ? node('span', 'num', CORE.fmtInt(part)) : document.createTextNode(part));
    });
    return frag;
  }

  function fmt(n) { return CORE.fmtInt(n); }

  function formatBytes(n) {
    if (n < 1024) return fmt(n) + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function debounce(key, fn, wait) {
    if (timers[key]) clearTimeout(timers[key]);
    timers[key] = setTimeout(function () { delete timers[key]; fn(); }, wait);
  }

  function cancelDebounce(key) {
    if (timers[key]) { clearTimeout(timers[key]); delete timers[key]; }
  }

  function cloneRules(rules) { return JSON.parse(JSON.stringify(rules)); }

  function fileLine(row) { return row + (state.table && state.table.hasHeader ? 2 : 1); }

  /* 一组按钮里只选中一个（分隔符、对比方式等分段控件） */
  function pressOne(container, attr, value) {
    container.querySelectorAll('[' + attr + ']').forEach(function (btn) {
      btn.setAttribute('aria-pressed', btn.getAttribute(attr) === value ? 'true' : 'false');
    });
  }

  function stat(label, value) {
    var box = node('div', 'stat');
    box.appendChild(node('span', 'stat__value num', fmt(value)));
    box.appendChild(node('span', 'stat__label', label));
    return box;
  }

  /* ---------- 导航与工具栏 ---------- */

  function setView(view, moveFocus) {
    state.view = view;
    document.querySelectorAll('[data-view-panel]').forEach(function (panel) {
      panel.hidden = panel.getAttribute('data-view-panel') !== view;
    });
    document.querySelectorAll('.nav__item[data-view]').forEach(function (btn) {
      if (btn.getAttribute('data-view') === view) btn.setAttribute('aria-current', 'page');
      else btn.removeAttribute('aria-current');
    });
    setText(el('view-title'), VIEW_TITLES[view]);
    updateToolbar();
    renderVisible();
    if (moveFocus) el('main').focus();
  }

  function canExport() {
    var r = state.result;
    return !!(r && r.stats.finalRows > 0 && r.stats.finalCols > 0);
  }

  function updateToolbar() {
    var hasData = !!state.table;
    var meta = el('topbar-meta');
    show(meta, hasData);
    if (hasData) {
      setText(meta, state.source.shortName + ' · ' + fmt(state.table.rows.length) + ' 行 × ' + fmt(state.table.width) + ' 列');
    }
    document.querySelectorAll('.topbar__actions [data-for]').forEach(function (btn) {
      var views = btn.getAttribute('data-for').split(/\s+/);
      var visible = views.indexOf(state.view) >= 0 && (btn.getAttribute('data-needs') !== 'data' || hasData);
      btn.hidden = !visible;
    });
    el('btn-undo').disabled = state.history.length === 0;
    el('btn-export').disabled = !canExport();
  }

  /* 只重画当前看得见的视图 */
  function renderVisible() {
    if (state.view === 'start') renderStart();
    if (state.view === 'rules') renderRules();
    if (state.view === 'columns') renderColumns();
    if (state.view === 'result') renderResult();
  }

  /* 数据或规则变了之后，把各处的数字同步一遍 */
  function renderAll() {
    updateToolbar();
    renderVisible();
    if (state.view === 'start' && state.startMode === 'import') show(el('reimport-note'), !!state.table);
  }

  /* ---------- 重算 ---------- */

  function compute() {
    state.result = CORE.applyRules(state.table, state.rules);
    state.profile = null;
    var rows = state.result.rowMap.length;
    state.page = Math.min(Math.max(1, state.page), Math.max(1, Math.ceil(rows / PREVIEW_ROWS)));
    renderAll();
  }

  /* 数据大时计算要花上一会儿：让人看得见「正在清洗」，内容和按钮暂时不响应 */
  function setBusy(busy) {
    var main = el('main');
    if (busy) main.setAttribute('aria-busy', 'true');
    else main.removeAttribute('aria-busy');
    main.classList.toggle('is-busy', busy);
    show(el('busy-indicator'), busy);
    el('btn-export').disabled = busy || !canExport();
  }

  /* 重新清洗。数据大时先画出忙碌状态再算，算完后调用 done */
  function recompute(done) {
    cancelDebounce('recompute');
    if (!state.table) {
      state.result = null;
      state.profile = null;
      renderAll();
      if (done) done();
      return;
    }
    var cells = state.table.rows.length * state.table.width;
    if (cells > BUSY_THRESHOLD_CELLS) {
      setBusy(true);
      setTimeout(function () {
        compute();
        setBusy(false);
        if (done) done();
      }, 30);
    } else {
      compute();
      if (done) done();
    }
  }

  function scheduleRecompute() {
    debounce('recompute', function () { recompute(); }, RECOMPUTE_DELAY);
  }

  /* ==========================================================================
     导入
     ========================================================================== */

  function showImportError(title, body) {
    setText(el('import-error-title'), title);
    setText(el('import-error-body'), body);
    show(el('import-error'), true);
    el('import-error').focus();
  }

  function hideImportError() {
    show(el('import-error'), false);
  }

  function setImportStatus(text) {
    setText(el('import-status'), text);
  }

  function delimiterName(id) {
    return CORE.delimiterLabel(CORE.delimiterChar(id));
  }

  function syncDelimiterSeg() {
    pressOne(el('delimiter-seg'), 'data-dl', state.importOpts.delimiter);
  }

  function updateStartButton() {
    el('btn-start').disabled = el('paste-area').value.trim() === '';
  }

  /* 根据选的是「自动」还是手动，以及识别结果，更新分隔符下面的提示 */
  function updateDelimiterHint() {
    var status = el('dl-status');
    var text = el('paste-area').value;
    var choice = state.importOpts.delimiter;
    status.classList.remove('is-warning');
    state.detection = null;
    if (choice !== 'auto') {
      setText(status, '已手动选择：' + delimiterName(choice));
    } else if (text.trim() === '') {
      setText(status, '自动识别：粘贴内容后显示识别结果');
    } else {
      var d = CORE.detectDelimiter(text);
      state.detection = d;
      if (d.delimiter == null) {
        setText(status, '没有检测到分隔符，请手动选择');
        status.classList.add('is-warning');
      } else if (d.confidence === 'low') {
        setText(status, '自动识别：' + delimiterName(d.delimiterId) + '。各行的分隔符数量不一致，请核对预览');
      } else if (d.tiedWith.length) {
        var tied = d.tiedWith.map(function (ch) { return '「' + CORE.delimiterLabel(ch) + '」'; }).join('、');
        setText(status, '自动识别：' + delimiterName(d.delimiterId) + '。它和 ' + tied + ' 出现的次数相同，请核对');
      } else {
        var count = fmt(d.counts[d.delimiter][0]);
        setText(status, '自动识别：' + delimiterName(d.delimiterId) +
          (d.lines === 1 ? '（这一行有 ' + count + ' 个）' : '（前 ' + d.lines + ' 行每行都有 ' + count + ' 个）'));
      }
    }
    updateStartButton();
  }

  /* 手动选择的优先；选「自动」时按识别结果 */
  function resolveDelimiter(text) {
    var choice = state.importOpts.delimiter;
    if (choice !== 'auto') return { ok: true, id: choice, auto: false, detection: null };
    var d = CORE.detectDelimiter(text);
    if (d.delimiter == null) return { ok: false, detection: d };
    return { ok: true, id: d.delimiterId, auto: true, detection: d };
  }

  /* 原始数据里完全重复的行数（不看规则）。命中后逐格比对，单元格里正好有 \u0000 也不会误判。
     全空行单独统计，不算重复——规则也是先删空行再去重，两处口径要一致 */
  function countRawDuplicates(table) {
    var seen = new Map();
    var dup = 0;
    for (var r = 0; r < table.rows.length; r++) {
      var row = table.rows[r];
      if (CORE.isBlankRow(row)) continue;
      var key = row.join('\u0000');
      var probe = key;
      var attempt = 0;
      var first = -1;
      while (seen.has(probe)) {
        var other = table.rows[seen.get(probe)];
        var same = true;
        for (var c = 0; c < row.length; c++) {
          if (other[c] !== row[c]) { same = false; break; }
        }
        if (same) { first = seen.get(probe); break; }
        probe = key + '\u0000' + (++attempt);
      }
      if (first >= 0) dup++;
      else seen.set(probe, r);
    }
    return dup;
  }

  /* 解析文本并把它当成当前数据。分隔符识别不出、或没有任何内容时给出说明 */
  function importText(text) {
    var delim = resolveDelimiter(text);
    if (!delim.ok) {
      showImportError('没有检测到分隔符',
        '前几行里逗号、制表符、分号、竖线出现的次数都是 0。请在「分隔符」里手动选一个。如果粘贴进来的是一段普通文字而不是表格，先回到 Excel 里整理好再复制。');
      return;
    }
    var parsed = CORE.parseCsv(text, CORE.delimiterChar(delim.id));
    var table = CORE.buildTable(parsed.records, { hasHeader: el('has-header').checked });
    if (!table) {
      showImportError('没有解析出内容',
        '这段内容里除了空白什么都没有，或者只有一行表头。请确认粘贴进来的是完整的表格数据。');
      return;
    }
    var src = state.pendingSource || { kind: 'paste', name: '粘贴的内容', shortName: '粘贴的内容', encoding: 'utf-8', bom: false, replaced: 0, bytes: 0, edited: false };
    var source = {
      kind: src.kind, name: src.name, shortName: src.shortName, encoding: src.encoding, bom: src.bom,
      replaced: src.replaced, bytes: src.bytes, edited: src.edited,
      delimiterId: delim.id, delimiterAuto: delim.auto, detection: delim.detection, quote: parsed
    };
    adoptTable(table, source);
  }

  function adoptTable(table, source) {
    state.table = table;
    state.source = source;
    state.rawDuplicates = countRawDuplicates(table);
    state.page = 1;
    state.startMode = 'overview';
    hideImportError();
    recompute(function () {
      setImportStatus('');
      /* 无论从哪里触发导入，导入完成后都回到开始页看数据概况 */
      if (state.view !== 'start') setView('start', false);
      ZDX.toast('已载入 ' + fmt(table.rows.length) + ' 行 × ' + fmt(table.width) + ' 列，按当前规则清洗后剩 ' +
        fmt(state.result.stats.finalRows) + ' 行', 'success');
    });
  }

  function startCleaning() {
    var text = el('paste-area').value;
    if (text.trim() === '') return;
    importText(text);
  }

  function loadSample() {
    var sample = APP_DATA.sample;
    el('paste-area').value = sample.csv;
    state.pendingSource = {
      kind: 'sample', name: '示例数据 · ' + sample.name, shortName: '示例数据',
      encoding: sample.encoding, bom: false, replaced: 0, bytes: 0, edited: false
    };
    state.importOpts.delimiter = 'auto';
    syncDelimiterSeg();
    updateDelimiterHint();
    importText(sample.csv);
  }

  /* 读文件：先按编码解码，再把文本放进粘贴框，之后的流程和粘贴完全一样 */
  function readAndImportFile(file) {
    hideImportError();
    if (file.size > MAX_FILE_BYTES) {
      showImportError('文件超过 50 MB',
        '「' + file.name + '」有 ' + formatBytes(file.size) + '，超出了这个页面能顺畅处理的范围。请先在 Excel 里把它拆成几个小文件，每次导入一个。');
      return;
    }
    setImportStatus('正在读取 ' + file.name + ' …');
    var reader = new FileReader();
    reader.onerror = function () {
      setImportStatus('');
      showImportError('文件没有读出来',
        '浏览器在读取「' + file.name + '」时出了错。请重新选择一次，或者打开文件，把内容复制粘贴进来。');
    };
    reader.onload = function () {
      var decoded;
      try {
        decoded = CORE.decodeBytes(new Uint8Array(reader.result));
      } catch (err) {
        setImportStatus('');
        showImportError(err.title || '文件解码失败', (err.reason || '') + (err.fix ? ' ' + err.fix : ''));
        return;
      }
      el('paste-area').value = decoded.text;
      state.pendingSource = {
        kind: 'file', name: file.name, shortName: file.name, encoding: decoded.encoding,
        bom: decoded.bom, replaced: decoded.replaced, bytes: decoded.bytes, edited: false
      };
      updateDelimiterHint();
      if (!resolveDelimiter(decoded.text).ok) {
        setImportStatus('');
        showImportError('没有检测到分隔符',
          '「' + file.name + '」的前几行里，逗号、制表符、分号、竖线出现的次数都是 0。文件内容已经放进了粘贴框，请在「分隔符」里手动选一个，再点「开始清洗」。');
        return;
      }
      importText(decoded.text);
    };
    reader.readAsArrayBuffer(file);
  }

  /* ---------- 开始视图 ---------- */

  function renderStart() {
    var has = !!state.table;
    var overview = has && state.startMode === 'overview';
    show(el('import-card'), !overview);
    show(el('data-overview'), overview);
    show(el('reimport-note'), has && !overview);
    if (has && !overview) {
      setText(el('reimport-note-body'), '重新开始清洗会替换页面里的 ' + fmt(state.table.rows.length) + ' 行数据。');
    }
    if (overview) renderOverview();
  }

  function encodingText(s) {
    if (s.kind === 'paste') return '粘贴的文本，不涉及编码';
    if (s.encoding === 'utf-8') return 'UTF-8' + (s.bom ? '，带 BOM' : '');
    if (s.encoding === 'gb18030') return 'GB18030';
    return s.encoding === 'utf-16le' ? 'UTF-16 LE（按文件头识别）' : 'UTF-16 BE（按文件头识别）';
  }

  /* 解析时发现、需要用户留意的地方。parts 里的数字会被包成等宽 */
  function parseReportNotes() {
    var rep = state.table.report;
    var s = state.source;
    var notes = [];
    if (s.kind === 'file' && s.replaced > 0) {
      notes.push({ danger: true, parts: ['有 ', s.replaced, ' 处字节无法按 GB18030 识别，已替换成占位字符。这个文件可能不是 GBK 编码，请核对预览。'] });
    }
    if (s.quote.unclosedQuotes > 0) {
      notes.push({ parts: ['有 ', s.quote.unclosedQuotes, ' 处引号没有闭合。这种字段会把后面的行吞进来，行数可能因此变少，请检查原文。'] });
    }
    if (rep.longRows > 0) {
      notes.push({ parts: ['有 ', rep.longRows, ' 行的列数与表头不一致（多出 ', rep.extraCols, ' 列），已按附加列处理。'] });
    }
    if (rep.shortRows > 0) {
      notes.push({ parts: ['有 ', rep.shortRows, ' 行的列数比表头少，缺少的单元格已补空。'] });
    }
    if (rep.leadingBlank > 0) {
      notes.push({ parts: ['忽略了开头的 ', rep.leadingBlank, ' 个空行。'] });
    }
    if (s.quote.quoteGlitches > 0) {
      notes.push({ parts: ['有 ', s.quote.quoteGlitches, ' 处引号用法不规范（引号出现在字段中间，或结束引号后面还有内容），已按原文保留。'] });
    }
    if (s.delimiterAuto && s.detection) {
      if (s.detection.confidence === 'low') {
        notes.push({ parts: ['各行的分隔符数量不一致，已按出现最多的「' + delimiterName(s.delimiterId) + '」解析，请核对预览。'] });
      } else if (s.detection.tiedWith.length) {
        var tied = s.detection.tiedWith.map(function (ch) { return '「' + CORE.delimiterLabel(ch) + '」'; }).join('、');
        notes.push({ parts: ['「' + delimiterName(s.delimiterId) + '」和 ' + tied + '出现的次数相同，已按「' + delimiterName(s.delimiterId) + '」解析，请核对预览。'] });
      }
    }
    return notes;
  }

  /* 「按当前规则会怎样」的一句话，数字用等宽 */
  function appendEffect(target) {
    var st = state.result.stats;
    var on = CORE.RULE_IDS.filter(function (id) { return state.rules[id].on; }).length;
    if (!on) {
      target.appendChild(document.createTextNode('当前没有启用任何规则，数据会原样导出。'));
      return;
    }
    target.appendChild(numbered(['按当前启用的 ', on, ' 条规则']));
    if (st.removedRows) {
      target.appendChild(numbered(['：删除 ', st.removedRows, ' 行（重复 ', st.removedDuplicates, '、空行 ', st.removedEmpty, '）']));
    } else {
      target.appendChild(document.createTextNode('：没有删除行'));
    }
    if (st.removedCols) target.appendChild(numbered(['，去掉 ', st.removedCols, ' 个全空列']));
    if (st.changedCells) target.appendChild(numbered(['，修改 ', st.changedCells, ' 个单元格']));
    if (state.result.dateIssues.total) target.appendChild(numbered(['，另有 ', state.result.dateIssues.total, ' 个日期没有规范化']));
    if (state.result.ruleErrors.length) {
      target.appendChild(numbered(['；有 ', state.result.ruleErrors.length, ' 条规则没有执行，请到「清洗规则」里查看']));
    }
    target.appendChild(document.createTextNode('。'));
  }

  function addFact(list, term, text) {
    list.appendChild(node('dt', null, term));
    list.appendChild(node('dd', null, text));
  }

  /* 表格里的一个单元格：空值画一条短横线，长内容鼠标悬停时显示全文 */
  function cellNode(value, extraClass) {
    var td = node('td', extraClass || null);
    if (value === '') {
      td.appendChild(node('span', 'cell-empty'));
    } else {
      td.textContent = value;
      if (value.length > 24 || value.indexOf('\n') >= 0) td.setAttribute('title', value);
    }
    return td;
  }

  function headerRow(names) {
    var tr = node('tr');
    var num = node('th', 'datagrid__rownum', '行');
    num.setAttribute('scope', 'col');
    tr.appendChild(num);
    names.forEach(function (name) {
      var th = node('th', null, name);
      th.setAttribute('scope', 'col');
      tr.appendChild(th);
    });
    return tr;
  }

  function renderOverview() {
    var t = state.table;
    var s = state.source;
    var notes = parseReportNotes();
    show(el('parse-report'), notes.length > 0);
    if (notes.length) {
      var list = el('parse-report-list');
      list.textContent = '';
      var title = el('parse-report-title');
      title.textContent = '';
      title.appendChild(numbered(['解析时有 ', notes.length, ' 处需要留意']));
      notes.forEach(function (n) {
        var li = node('li', n.danger ? 'is-danger' : null);
        li.appendChild(numbered(n.parts));
        list.appendChild(li);
      });
    }
    show(el('scale-hint'), t.rows.length > SCALE_HINT_ROWS);
    setText(el('overview-source'), s.name + (s.edited ? '（在页面上改过）' : ''));

    var stats = el('overview-stats');
    stats.textContent = '';
    stats.appendChild(stat('原始行数', t.rows.length));
    stats.appendChild(stat('列数', t.width));
    stats.appendChild(stat('完全重复的行', state.rawDuplicates));
    stats.appendChild(stat('全空的行', t.report.blankRows));

    var kv = el('overview-facts');
    kv.textContent = '';
    addFact(kv, '识别编码', encodingText(s));
    addFact(kv, '分隔符', delimiterName(s.delimiterId) + (s.delimiterAuto ? '（自动识别）' : '（手动选择）'));
    addFact(kv, '表头', t.hasHeader ? '首行为表头' : '没有表头，列名依次是「列 1、列 2 …」');
    if (s.kind === 'file') addFact(kv, '文件大小', formatBytes(s.bytes));

    var effect = el('overview-effect');
    effect.textContent = '';
    appendEffect(effect);

    var preview = el('preview-table');
    var rows = t.rows.slice(0, OVERVIEW_PREVIEW_ROWS);
    setText(el('preview-meta'), '前 ' + rows.length + ' 行 · 用来确认分隔符和编码都识别对了');
    preview.textContent = '';
    var thead = node('thead');
    thead.appendChild(headerRow(t.header));
    preview.appendChild(thead);
    var tbody = node('tbody');
    rows.forEach(function (row, i) {
      var tr = node('tr');
      tr.appendChild(node('td', 'datagrid__rownum num', String(fileLine(i))));
      row.forEach(function (v) { tr.appendChild(cellNode(v)); });
      tbody.appendChild(tr);
    });
    preview.appendChild(tbody);
  }

  /* ==========================================================================
     清洗规则
     ========================================================================== */

  function ruleNode(id) {
    return el('rule-list').querySelector('[data-rule="' + id + '"]');
  }

  function ruleName(id) {
    return ruleNode(id).querySelector('.rule__name').textContent;
  }

  function ruleErrorFor(id) {
    var found = null;
    (state.result ? state.result.ruleErrors : []).forEach(function (err) {
      if (err.rule === id) found = err;
    });
    return found;
  }

  function enabledCount() {
    return CORE.RULE_IDS.filter(function (id) { return state.rules[id].on; }).length;
  }

  function updateRulesMeta() {
    setText(el('rules-meta'), '已启用 ' + enabledCount() + ' / ' + CORE.RULE_IDS.length + ' 条');
    setText(el('nav-rules-count'), String(enabledCount()));
  }

  /* 规则开或关：卡片的样子和参数区的显隐跟着变 */
  function updateRuleRow(id) {
    var li = ruleNode(id);
    var on = !!state.rules[id].on;
    li.classList.toggle('is-on', on);
    li.classList.toggle('is-off', !on);
    var params = li.querySelector('[data-params]');
    if (params) params.hidden = !on;
  }

  function badge(parts, modifier) {
    var b = node('span', 'badge' + (modifier ? ' ' + modifier : ''));
    b.appendChild(numbered(parts));
    return b;
  }

  function mutedImpact(text) {
    return node('span', 'rule__impact--muted', text);
  }

  /* 每条规则旁边的「影响 N 行 · N 个单元格」 */
  function renderRuleImpacts() {
    CORE.RULE_IDS.forEach(function (id) {
      var box = ruleNode(id).querySelector('[data-impact]');
      box.textContent = '';
      if (!state.table) return;
      var rep = null;
      state.result.rules.forEach(function (r) { if (r.id === id) rep = r; });
      if (!rep.on) { box.appendChild(mutedImpact('未启用')); return; }
      if (ruleErrorFor(id)) { box.appendChild(badge(['未执行'], 'badge--danger')); return; }
      if (rep.kind === 'row') {
        if (rep.removedRows) box.appendChild(badge(['删除 ', rep.removedRows, ' 行']));
        else box.appendChild(mutedImpact('没有改动'));
      } else if (rep.kind === 'col') {
        if (rep.removedCols) box.appendChild(badge(['删除 ', rep.removedCols, ' 列']));
        else box.appendChild(mutedImpact('没有改动'));
      } else if (rep.kind === 'header') {
        if (rep.headers) box.appendChild(badge(['修改 ', rep.headers, ' 个列名']));
        else box.appendChild(mutedImpact('没有改动'));
      } else if (rep.total) {
        box.appendChild(badge(['影响 ', rep.rows, ' 行 · ', rep.cells, ' 个单元格']));
      } else {
        box.appendChild(mutedImpact('没有改动'));
      }
    });
  }

  /* 规则没法执行时，在对应的输入框下面说明原因和改法 */
  function renderRuleErrors() {
    var findInput = el('rule-replace-find');
    var findError = el('rule-replace-error');
    var colsError = el('rule-replace-cols-error');
    findError.textContent = '';
    colsError.textContent = '';
    findInput.removeAttribute('aria-invalid');
    show(findError, false);
    show(colsError, false);
    var err = ruleErrorFor('replace');
    if (!err) return;
    var target = err.code === 'no-columns' ? colsError : findError;
    if (err.code !== 'no-columns') findInput.setAttribute('aria-invalid', 'true');
    target.appendChild(ZDX.icon('exclamation-circle', 'icon--sm'));
    target.appendChild(document.createTextNode(err.reason + ' ' + err.fix));
    show(target, true);
  }

  /* 查找替换选了「指定列」时，列出所有列让人勾选 */
  function updateReplaceColumns() {
    var on = state.rules.replace.on && state.rules.replace.scope === 'cols';
    show(el('rule-replace-cols'), on);
    if (!on) return;
    var chips = el('replace-col-chips');
    var t = state.table;
    show(el('replace-col-hint'), !t);
    if (!t) {
      chips.textContent = '';
      return;
    }
    /* 列没变时只更新选中状态，不重建按钮：否则键盘勾选一列后焦点就丢了 */
    var existing = chips.children;
    if (existing.length !== t.header.length) {
      chips.textContent = '';
      t.header.forEach(function (name, i) {
        var chip = node('button', 'chip', name === '' ? '（第 ' + (i + 1) + ' 列，列名为空）' : name);
        chip.setAttribute('type', 'button');
        chip.setAttribute('data-col', String(i));
        chips.appendChild(chip);
      });
      existing = chips.children;
    }
    for (var i = 0; i < existing.length; i++) {
      existing[i].setAttribute('aria-pressed', state.rules.replace.cols.indexOf(i) >= 0 ? 'true' : 'false');
    }
  }

  function renderRules() {
    show(el('rules-nodata'), !state.table);
    updateRulesMeta();
    renderRuleImpacts();
    updateReplaceColumns();
    renderRuleErrors();
  }

  /* 把 state.rules 写回表单控件（撤销、恢复默认之后） */
  function syncRulesForm() {
    CORE.RULE_IDS.forEach(function (id) {
      var r = state.rules[id];
      ruleNode(id).querySelectorAll('[data-prop]').forEach(function (ctl) {
        var prop = ctl.getAttribute('data-prop');
        if (ctl.type === 'checkbox') ctl.checked = !!r[prop];
        else ctl.value = r[prop] == null ? '' : String(r[prop]);
      });
      updateRuleRow(id);
    });
  }

  /* 记一步历史。同一个输入框在 UNDO_MERGE_MS 内连续输入只算一步 */
  function pushHistory(before, label, field) {
    var last = state.history[state.history.length - 1];
    var now = Date.now();
    if (last && last.field === field && now - last.time < UNDO_MERGE_MS) return;
    if (JSON.stringify(before) === JSON.stringify(state.rules)) return;
    state.history.push({ rules: before, label: label, field: field, time: now });
    if (state.history.length > HISTORY_LIMIT) state.history.shift();
    updateToolbar();
  }

  function setRuleState(id, prop, value) {
    var before = cloneRules(state.rules);
    if (prop === 'on') state.rules[id].on = !!value;
    else state.rules[id][prop] = value;
    pushHistory(before, ruleName(id), id + '.' + prop);
    updateRuleRow(id);
    updateRulesMeta();
    updateReplaceColumns();
    scheduleRecompute();
  }

  /* 勾选框和下拉响应 change，文本框响应 input（这样输入时就能重算） */
  function handleRuleControl(target, isInputEvent) {
    var prop = target.getAttribute('data-prop');
    var li = target.closest('[data-rule]');
    if (!prop || !li) return;
    var isText = target.type === 'text';
    if (isInputEvent !== isText) return;
    var value = target.type === 'checkbox' ? target.checked : target.value;
    setRuleState(li.getAttribute('data-rule'), prop, value);
  }

  function undo() {
    var entry = state.history.pop();
    if (!entry) return;
    state.rules = entry.rules;
    syncRulesForm();
    updateRulesMeta();
    updateToolbar();
    recompute();
    ZDX.toast('已撤销：' + entry.label, 'info');
  }

  function resetRules() {
    var changed = CORE.RULE_IDS.filter(function (id) { return JSON.stringify(state.rules[id]) !== JSON.stringify(CORE.defaultRules()[id]); }).length;
    openConfirm({
      title: '恢复默认规则？',
      body: changed
        ? '你改动过的 ' + changed + ' 条规则会回到默认值。恢复之后还能撤销。'
        : '现在的规则就是默认值，恢复后不会有变化。',
      cancel: '保留我的设置',
      ok: '恢复默认规则',
      onOk: function () {
        pushHistory(cloneRules(state.rules), '恢复默认规则', 'reset.' + Date.now());
        state.rules = CORE.defaultRules();
        syncRulesForm();
        updateRulesMeta();
        updateToolbar();
        recompute();
        ZDX.toast('已恢复默认规则', 'success');
      }
    });
  }

  /* ==========================================================================
     列概况
     ========================================================================== */

  function renderColumns() {
    var has = !!state.table;
    show(el('columns-nodata'), !has);
    show(el('columns-body'), has);
    if (!has) return;
    pressOne(el('profile-mode'), 'data-profile', state.profileMode);
    var cleaned = state.profileMode === 'cleaned';
    var header = cleaned ? state.result.header : state.table.header;
    var rows = cleaned ? state.result.rows : state.table.rows;

    var meta = el('columns-meta');
    meta.textContent = '';
    meta.appendChild(numbered([(cleaned ? '清洗后：' : '清洗前：'), rows.length, ' 行 × ', header.length, ' 列']));

    /* 列概况算一次要花点时间，按口径缓存；换了口径就重新算 */
    if (!state.profile || state.profile.mode !== state.profileMode) {
      state.profile = { mode: state.profileMode, columns: CORE.profileColumns(header, rows) };
    }
    var tbody = el('profile-table').querySelector('tbody');
    tbody.textContent = '';
    state.profile.columns.forEach(function (c) {
      var tr = node('tr');

      var nameTd = node('td', 'col-name', c.name);
      if (c.name.length > 16) nameTd.setAttribute('title', c.name);
      tr.appendChild(nameTd);

      var typeTd = node('td');
      typeTd.appendChild(badge([TYPE_LABELS[c.type]], TYPE_BADGE[c.type]));
      tr.appendChild(typeTd);

      /* 缺失：几行、百分比，加一条细进度条 */
      var missTd = node('td');
      var missing = node('div', 'missing');
      missing.appendChild(numbered([c.missing, ' 行 · ' + CORE.fmtRate(c.missingRate)]));
      var bar = node('div', 'progress');
      bar.setAttribute('role', 'progressbar');
      bar.setAttribute('aria-valuemin', '0');
      bar.setAttribute('aria-valuemax', '100');
      bar.setAttribute('aria-valuenow', String(Math.round(c.missingRate * 100)));
      bar.setAttribute('aria-label', '「' + c.name + '」的缺失率');
      var inner = node('div', 'progress__bar');
      inner.setAttribute('style', 'width:' + (c.missingRate * 100).toFixed(1) + '%');
      bar.appendChild(inner);
      missing.appendChild(bar);
      missTd.appendChild(missing);
      tr.appendChild(missTd);

      tr.appendChild(node('td', 'num', fmt(c.unique)));

      ['min', 'max'].forEach(function (key) {
        var td = node('td', 'range');
        if (c[key] === null) td.appendChild(node('span', 'cell-empty'));
        else {
          td.textContent = c[key];
          if (c[key].length > 20) td.setAttribute('title', c[key]);
        }
        tr.appendChild(td);
      });

      var samples = node('td', 'samples');
      if (!c.samples.length) samples.appendChild(node('span', 'cell-empty'));
      /* 示例值之间用真实的「、」分隔（样式画出来的分隔符没法选中复制） */
      c.samples.forEach(function (s, i) {
        if (i) samples.appendChild(document.createTextNode('、'));
        var span = node('span', null, s);
        if (s.length > 24) span.setAttribute('title', s);
        samples.appendChild(span);
      });
      tr.appendChild(samples);
      tbody.appendChild(tr);
    });
  }

  /* ==========================================================================
     结果与导出
     ========================================================================== */

  /* 每条规则「影响 N 行 · N 个单元格」的文字；没有改动时返回 null */
  function impactParts(rep) {
    if (rep.kind === 'row') return rep.removedRows ? ['删除 ', rep.removedRows, ' 行'] : null;
    if (rep.kind === 'col') return rep.removedCols ? ['删除 ', rep.removedCols, ' 列'] : null;
    if (rep.kind === 'header') return rep.headers ? ['修改 ', rep.headers, ' 个列名'] : null;
    return rep.total ? ['影响 ', rep.rows, ' 行 · ', rep.cells, ' 个单元格'] : null;
  }

  /* 原始列名；列名为空时用「第 N 列」 */
  function colName(col) {
    var name = state.table.header[col];
    return name === '' ? '第 ' + (col + 1) + ' 列' : name;
  }

  function removedByRow() {
    var map = new Map();
    state.result.removed.forEach(function (item) { map.set(item.row, item); });
    return map;
  }

  function removedText(item) {
    if (item.reason === 'empty') return '全空行，已删除';
    return '与第 ' + fileLine(item.first) + ' 行重复，已删除';
  }

  /* 规则没法执行时，在结果页顶部按「发生了什么 / 为什么 / 怎么改」列出来 */
  function renderRuleErrorCallout() {
    var errors = state.result.ruleErrors;
    show(el('rule-errors'), errors.length > 0);
    if (!errors.length) return;
    var box = el('rule-errors-body');
    box.textContent = '';
    errors.forEach(function (err) {
      var item = node('div', 'rule-error');
      item.appendChild(node('span', 'rule-error__title', '「' + ruleName(err.rule) + '」' + err.title + '。'));
      item.appendChild(node('span', null, '为什么：' + err.reason));
      item.appendChild(node('span', null, '怎么改：' + err.fix));
      box.appendChild(item);
    });
  }

  /* 指标卡片，说明文字里可以带等宽数字 */
  function statBox(value, labelParts) {
    var box = node('div', 'stat');
    box.appendChild(node('span', 'stat__value num', fmt(value)));
    var label = node('span', 'stat__label');
    label.appendChild(numbered(labelParts));
    box.appendChild(label);
    return box;
  }

  function renderResultStats() {
    var st = state.result.stats;
    var row = el('result-stats');
    row.textContent = '';
    row.appendChild(statBox(st.originalRows, ['原始行数']));
    row.appendChild(statBox(st.finalRows, ['清洗后行数']));
    row.appendChild(statBox(st.removedRows, ['删除行数（重复 ', st.removedDuplicates, ' / 空行 ', st.removedEmpty, '）']));
    row.appendChild(statBox(st.changedCells, ['修改的单元格数']));
  }

  /* 一处改动的文字：第 N 行「列名」：旧值 → 新值 */
  function changeItem(whereParts, before, after) {
    var li = node('li', 'change');
    var where = node('span', 'change__where');
    where.appendChild(numbered(whereParts));
    li.appendChild(where);
    li.appendChild(node('code', 'change__val', CORE.prettyValue(before)));
    li.appendChild(node('span', 'change__arrow', '→'));
    li.appendChild(node('code', 'change__val change__val--after', CORE.prettyValue(after)));
    return li;
  }

  function detailList(report) {
    if (report.kind === 'row') {
      /* 删行的规则：列出被删的行和原因 */
      var reason = report.id === 'emptyRows' ? 'empty' : 'duplicate';
      var items = [];
      state.result.removed.forEach(function (item) {
        if (item.reason === reason) items.push(item);
      });
      return { total: items.length, items: items.slice(0, 20).map(function (item) {
        return { where: ['第 ', fileLine(item.row), ' 行：'], text: removedText(item) };
      }) };
    }
    if (report.kind === 'col') {
      var cols = state.result.removedCols;
      return { total: cols.length, items: cols.slice(0, 20).map(function (col) {
        return { where: ['删除列「' + colName(col) + '」'], text: '' };
      }) };
    }
    return {
      total: report.total,
      items: report.changes.map(function (ch) {
        return { where: ch.row < 0 ? ['列名「' + colName(ch.col) + '」：'] : ['第 ', fileLine(ch.row), ' 行「' + colName(ch.col) + '」：'], before: ch.before, after: ch.after };
      })
    };
  }

  function renderRuleDetails() {
    var box = el('rule-details');
    box.textContent = '';
    state.result.rules.forEach(function (rep) {
      var parts = impactParts(rep);
      if (!parts) {
        /* 没有改动的规则：一行说明状态，不能展开 */
        var line = node('div', 'rule-detail__line');
        line.appendChild(node('span', 'rule-detail__name', ruleName(rep.id)));
        var status = !rep.on ? '未启用' : (ruleErrorFor(rep.id) ? '未执行' : '没有改动');
        line.appendChild(node('span', 'rule-detail__count', status));
        var row = node('div', 'rule-detail is-static');
        row.appendChild(line);
        box.appendChild(row);
        return;
      }
      var details = document.createElement('details');
      details.className = 'rule-detail';
      var summary = document.createElement('summary');
      summary.appendChild(node('span', 'rule-detail__name', ruleName(rep.id)));
      var count = node('span', 'rule-detail__count');
      count.appendChild(numbered(parts));
      summary.appendChild(count);
      summary.appendChild(ZDX.icon('chevron-down', 'icon--sm icon--chevron'));
      details.appendChild(summary);

      var detail = detailList(rep);
      var body = node('div', 'rule-detail__body');
      if (detail.items.length) {
        var list = node('ul', 'change-list');
        detail.items.forEach(function (item) {
          if (item.before === undefined && item.after === undefined) {
            var li = node('li', 'change');
            var where = node('span', 'change__where');
            where.appendChild(numbered(item.where));
            li.appendChild(where);
            li.appendChild(node('span', null, item.text));
            list.appendChild(li);
          } else {
            list.appendChild(changeItem(item.where, item.before, item.after));
          }
        });
        body.appendChild(list);
      }
      if (detail.total > detail.items.length) {
        var more = node('p', 'note-more');
        more.appendChild(numbered(['共 ', detail.total, ' 处，这里只列出前 ', detail.items.length, ' 处。']));
        body.appendChild(more);
      }
      details.appendChild(body);
      box.appendChild(details);
    });
  }

  function renderDateIssues() {
    var issues = state.result.dateIssues;
    var rep = null;
    state.result.rules.forEach(function (r) { if (r.id === 'date') rep = r; });
    var resolved = rep.ambiguousResolved || 0;
    show(el('date-issues-card'), issues.total > 0 || resolved > 0);
    if (!issues.total && !resolved) return;

    var meta = el('date-issues-meta');
    meta.textContent = '';
    if (issues.total) meta.appendChild(numbered(['共 ', issues.total, ' 处']));

    var body = el('date-issues');
    body.textContent = '';
    if (resolved) {
      var note = node('div', 'callout callout--warning');
      note.appendChild(ZDX.icon('exclamation-triangle'));
      var noteBody = node('div', 'callout__body');
      noteBody.appendChild(numbered(['有 ', resolved, ' 处日期的日月顺序不明确，已按你选的方式解读，请抽查。']));
      note.appendChild(noteBody);
      body.appendChild(note);
    }
    var list = node('ul', 'issue-list');
    issues.items.slice(0, ISSUE_LIST_LIMIT).forEach(function (item) {
      var li = node('li', 'issue');
      var where = node('span', 'issue__where');
      where.appendChild(numbered(['第 ', fileLine(item.row), ' 行']));
      li.appendChild(where);
      var text = node('span', null);
      text.appendChild(node('code', 'change__val', CORE.prettyValue(item.value)));
      text.appendChild(document.createTextNode(' ' + item.message + '。'));
      li.appendChild(text);
      list.appendChild(li);
    });
    body.appendChild(list);
    if (issues.total > ISSUE_LIST_LIMIT) {
      var more = node('p', 'note-more');
      more.appendChild(numbered(['另有 ', issues.total - ISSUE_LIST_LIMIT, ' 处没有列出。']));
      body.appendChild(more);
    }
  }

  function renderRemoved() {
    var removed = state.result.removed;
    show(el('removed-card'), removed.length > 0);
    if (!removed.length) return;
    var meta = el('removed-meta');
    meta.textContent = '';
    meta.appendChild(numbered(['共 ', removed.length, ' 行']));
    var body = el('removed-list');
    body.textContent = '';
    var list = node('ul', 'issue-list');
    removed.slice(0, REMOVED_LIST_LIMIT).forEach(function (item) {
      var li = node('li', 'issue');
      var where = node('span', 'issue__where');
      where.appendChild(numbered(['第 ', fileLine(item.row), ' 行']));
      li.appendChild(where);
      li.appendChild(node('span', null, item.reason === 'empty' ? '全空行' : '与第 ' + fileLine(item.first) + ' 行重复'));
      list.appendChild(li);
    });
    body.appendChild(list);
    if (removed.length > REMOVED_LIST_LIMIT) {
      var more = node('p', 'note-more');
      more.appendChild(numbered(['另有 ', removed.length - REMOVED_LIST_LIMIT, ' 行没有列出。打开「显示被删除的行」可以在对比表里看到它们。']));
      body.appendChild(more);
    }
  }

  /* ---------- 对比表 ---------- */

  function headerCells(names, changedMarks) {
    var frag = document.createDocumentFragment();
    names.forEach(function (name, i) {
      var th = node('th', changedMarks && changedMarks[i] ? 'is-changed' : null, name);
      th.setAttribute('scope', 'col');
      frag.appendChild(th);
    });
    return frag;
  }

  function groupHeader(text, count) {
    var th = node('th', 'datagrid__group', text);
    th.setAttribute('scope', 'colgroup');
    th.setAttribute('colspan', String(count));
    return th;
  }

  function sideCell(tag) {
    var cell = node(tag, 'datagrid__side');
    cell.setAttribute('aria-hidden', 'true');
    return cell;
  }

  /* 原始数据的一个单元格；这一列被改过的话加上底色 */
  function originalCell(kept, k, col, value) {
    var idx = state.result.colMap.indexOf(col);
    var changed = kept && idx >= 0 && state.result.cellChanged[k] && state.result.cellChanged[k][idx];
    return cellNode(value, changed ? 'is-changed' : null);
  }

  function renderCompareTable() {
    var t = state.table;
    var r = state.result;
    var mode = state.compareMode;
    var universe = state.showRemoved ? null : r.rowMap;      /* null 表示全部原始行 */
    var count = universe ? universe.length : t.rows.length;
    var pages = Math.max(1, Math.ceil(count / PREVIEW_ROWS));
    state.page = Math.min(Math.max(1, state.page), pages);
    var start = (state.page - 1) * PREVIEW_ROWS;
    var end = Math.min(count, start + PREVIEW_ROWS);
    var pos = new Map();
    r.rowMap.forEach(function (o, k) { pos.set(o, k); });
    var removedMap = removedByRow();
    var leftCols = mode === 'original' ? t.header.map(function (_, i) { return i; }) : r.colMap;

    var table = el('compare-table');
    table.textContent = '';
    var thead = node('thead');
    if (mode === 'compare') {
      var tr1 = node('tr');
      var num = node('th', 'datagrid__rownum', '行');
      num.setAttribute('scope', 'col');
      num.setAttribute('rowspan', '2');
      tr1.appendChild(num);
      tr1.appendChild(groupHeader('原始数据', leftCols.length));
      tr1.appendChild(sideCell('th'));
      tr1.appendChild(groupHeader('清洗后', r.header.length));
      thead.appendChild(tr1);
      var tr2 = node('tr');
      tr2.appendChild(headerCells(leftCols.map(function (c) { return t.header[c]; })));
      tr2.appendChild(sideCell('th'));
      tr2.appendChild(headerCells(r.header, r.headerChanged));
      thead.appendChild(tr2);
    } else {
      var tr = node('tr');
      var numTh = node('th', 'datagrid__rownum', '行');
      numTh.setAttribute('scope', 'col');
      tr.appendChild(numTh);
      tr.appendChild(headerCells(mode === 'original' ? t.header : r.header, mode === 'original' ? null : r.headerChanged));
      thead.appendChild(tr);
    }
    /* 表格的标题每次随表头一起重建（上面清空表格时，原来的标题也一起被删掉了） */
    var caption = node('caption', 'sr-only', (mode === 'cleaned' ? '清洗后的数据' : mode === 'original' ? '原始数据' : '原始数据和清洗后数据的并排对比') +
      (state.showRemoved ? '，包含被删除的行' : ''));
    table.appendChild(caption);
    table.appendChild(thead);

    var tbody = node('tbody');
    for (var i = start; i < end; i++) {
      var o = universe ? universe[i] : i;
      var k = pos.has(o) ? pos.get(o) : -1;
      var removed = k < 0;
      var row = node('tr', removed ? 'is-removed' : null);
      var numTd = node('td', 'datagrid__rownum num', String(fileLine(o)));
      if (removed) {
        /* 置灰和删除线只是视觉效果，读屏软件需要文字才知道这一行被删了、为什么 */
        numTd.setAttribute('title', removedText(removedMap.get(o)));
        numTd.appendChild(node('span', 'sr-only', '（' + removedText(removedMap.get(o)) + '）'));
      }
      row.appendChild(numTd);
      var orig = t.rows[o];
      if (mode === 'compare') {
        /* 并排：左边原始数据（只看保留下来的列，和右边一一对应） */
        r.colMap.forEach(function (c) { row.appendChild(originalCell(!removed, k, c, orig[c])); });
        row.appendChild(sideCell('td'));
      } else if (mode === 'original' || removed) {
        /* 原始视图；或清洗后视图里被删除的行——显示原始内容，整行置灰 */
        leftCols.forEach(function (c) { row.appendChild(originalCell(mode === 'original' && !removed, k, c, orig[c])); });
      }
      if (!removed && mode !== 'original') {
        /* 清洗后的单元格；被删除的行在清洗后视图里已经用原始内容占位，不再重复 */
        r.rows[k].forEach(function (v, j) {
          row.appendChild(cellNode(v, r.cellChanged[k] && r.cellChanged[k][j] ? 'is-changed' : null));
        });
      } else if (removed && mode === 'compare') {
        var gone = node('td', 'is-gone', removedText(removedMap.get(o)));
        gone.setAttribute('colspan', String(r.header.length));
        row.appendChild(gone);
      }
      tbody.appendChild(row);
    }
    table.appendChild(tbody);

    var meta = el('compare-meta');
    meta.textContent = '';
    meta.appendChild(numbered([state.showRemoved ? '含被删除的行，共 ' : '共 ', count, ' 行']));
    if (mode !== 'original' && r.stats.removedCols) meta.appendChild(numbered(['，已去掉 ', r.stats.removedCols, ' 个全空列']));

    var info = el('pager-info');
    info.textContent = '';
    if (pages > 1) info.appendChild(numbered(['第 ', state.page, ' / ', pages, ' 页 · 第 ', start + 1, '–', end, ' 行，每页 ', PREVIEW_ROWS, ' 行']));
    else info.appendChild(numbered(['共 ', count, ' 行']));

    el('pager-prev').disabled = state.page <= 1;
    el('pager-next').disabled = state.page >= pages;
  }

  function renderResult() {
    var has = !!state.table;
    show(el('result-nodata'), !has);
    show(el('result-body'), has);
    if (!has) return;
    pressOne(el('compare-mode'), 'data-mode', state.compareMode);
    el('show-removed').checked = state.showRemoved;
    renderRuleErrorCallout();
    renderResultStats();
    renderRuleDetails();
    renderDateIssues();
    renderRemoved();
    renderCompareTable();
  }

  /* ==========================================================================
     导出、复制、配方
     ========================================================================== */

  function radioValue(name) {
    var found = null;
    document.querySelectorAll('input[name="' + name + '"]').forEach(function (r) {
      if (r.checked) found = r.value;
    });
    return found;
  }

  function formatHint(format, encoding) {
    if (format === 'json') return 'JSON 只用 UTF-8 编码、不带 BOM（RFC 8259 第 8.1 节）。所有值按文本导出，不会转成数字；重名的列名会加序号。';
    if (encoding === 'gb18030') return 'GB18030 能表示所有汉字和 emoji。emoji 这类字符会写成四个字节，只认识 GBK 的老软件可能显示不出来。';
    if (format === 'tsv') return '单元格里的制表符和换行会替换成空格，其余和 CSV 相同：行尾是 CRLF。';
    return '含逗号、双引号或换行的字段会用双引号包住（RFC 4180），行尾是 CRLF。';
  }

  /* 按对话框里的选项生成导出内容 */
  function buildExport() {
    var format = radioValue('export-format');
    var encoding = format === 'json' ? 'utf-8' : radioValue('export-encoding');
    var r = state.result;
    var text;
    if (format === 'json') text = CORE.formatJson(r.header, r.rows);
    else {
      var rows = el('export-header').checked ? [r.header].concat(r.rows) : r.rows;
      text = format === 'tsv' ? CORE.formatTsv(rows) : CORE.formatCsv(rows);
    }
    return { format: format, encoding: encoding, text: text, bytes: CORE.encodeText(text, encoding) };
  }

  function updateExportOptions() {
    var format = radioValue('export-format');
    var isJson = format === 'json';
    document.querySelectorAll('input[name="export-encoding"]').forEach(function (r) {
      r.disabled = isJson && r.value !== 'utf-8';
      if (r.disabled) r.checked = false;
    });
    if (isJson) document.querySelectorAll('input[name="export-encoding"]').forEach(function (r) { if (r.value === 'utf-8') r.checked = true; });
    show(el('export-header-row'), !isJson);
    setText(el('btn-export-confirm'), '导出 ' + FORMAT_LABELS[format]);
    /* 文件名跟着格式换扩展名，前面的名字保留 */
    el('export-name').value = CORE.safeFileName(el('export-name').value, format);
    setText(el('export-hint'), formatHint(format, isJson ? 'utf-8' : radioValue('export-encoding')));

    var built = buildExport();
    var summary = el('export-summary');
    summary.textContent = '';
    summary.appendChild(numbered(['导出清洗后的 ', state.result.stats.finalRows, ' 行 × ', state.result.stats.finalCols, ' 列，约 ']));
    summary.appendChild(document.createTextNode(formatBytes(built.bytes.length) + '。'));
  }

  function openExport() {
    if (!state.table) return;
    if (!canExport()) {
      ZDX.toast('清洗后没有剩下数据，暂时不能导出。可以到「清洗规则」里关掉删行的规则再试。', 'warning');
      return;
    }
    el('export-header').checked = state.table.hasHeader;
    if (!state.exportName) state.exportName = CORE.defaultFileName(new Date(), 'csv');
    el('export-name').value = state.exportName;
    updateExportOptions();
    ZDX.openDialog(el('export-dialog'));
  }

  function confirmExport() {
    var built = buildExport();
    var name = CORE.safeFileName(el('export-name').value.trim(), built.format);
    state.exportName = name;
    var charset = built.encoding === 'gb18030' ? 'gb18030' : 'utf-8';
    var type = built.format === 'json' ? 'application/json' : built.format === 'tsv' ? 'text/tab-separated-values' : 'text/csv';
    ZDX.download(name, built.bytes, type + ';charset=' + charset);
    ZDX.closeDialog(el('export-dialog'));
    ZDX.toast('已导出 ' + name + '（' + fmt(state.result.stats.finalRows) + ' 行，' + CORE.encodingLabel(built.encoding) + '）', 'success');
  }

  function copyText(text, message) {
    ZDX.copy(text).then(function () {
      ZDX.toast(message, 'success');
    }, function () {
      ZDX.toast('没有复制成功：浏览器拒绝了剪贴板访问。请允许这个页面使用剪贴板，或者改用「导出结果」。', 'danger');
    });
  }

  function copyTable() {
    var r = state.result;
    if (!r) return;
    copyText(CORE.formatTsv([r.header].concat(r.rows)), '已复制 ' + fmt(r.rows.length) + ' 行到剪贴板，可以直接贴进 Excel');
  }

  /* 某个勾选项在页面上显示的名字（写配方用）。只取标签的第一段文字，不带后面的补充说明 */
  function checkboxLabel(id, prop) {
    var label = ruleNode(id).querySelector('[data-prop="' + prop + '"]').closest('.check').querySelector('.check__label');
    var first = label.firstChild;
    return first && first.nodeType === 3 ? first.textContent : '';
  }

  function optionText(select, value) {
    var option = select.querySelector('option[value="' + value + '"]');
    return option ? option.textContent : value;
  }

  function ruleDetailText(id) {
    var r = state.rules[id];
    if (id === 'dedupe') return '保留首次出现';
    if (id === 'number') {
      var on = ['thousands', 'currency', 'percent', 'fullwidth'].filter(function (key) { return r[key]; }).map(function (key) { return checkboxLabel(id, key); });
      return on.length ? on.join('、') : '四项都没勾选，这条规则不会改动任何单元格';
    }
    if (id === 'date') return '输出 YYYY-MM-DD；日月顺序不明确的日期' + optionText(el('rule-date-ambiguous'), r.ambiguous);
    if (id === 'fill') return '占位文本「' + r.text + '」';
    if (id === 'replace') {
      var scope = r.scope === 'all' ? '全表' : '指定列（' + r.cols.map(function (c) { return colName(c); }).join('、') + '）';
      return scope + '；查找「' + r.find + '」，替换为「' + r.replacement + '」' + (r.regex ? '，按正则表达式' : '，按普通文本');
    }
    if (id === 'englishCase') return optionText(el('rule-case-mode'), r.mode);
    return '';
  }

  function pad(n) { return n < 10 ? '0' + n : String(n); }

  function copyRecipe() {
    var t = state.table;
    var s = state.source;
    var st = state.result.stats;
    var now = new Date();
    var text = CORE.formatRecipe({
      generatedAt: now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate()) + ' ' + pad(now.getHours()) + ':' + pad(now.getMinutes()),
      tool: '折向东 · 工具箱 · 表格清洗 v2.0',
      source: {
        name: s.name + (s.kind === 'file' ? '（' + formatBytes(s.bytes) + '）' : ''),
        encodingLabel: encodingText(s),
        delimiterLabel: delimiterName(s.delimiterId) + (s.delimiterAuto ? '，自动识别' : '，手动选择'),
        hasHeader: t.hasHeader
      },
      original: { rows: t.rows.length, cols: t.width },
      result: {
        rows: st.finalRows, cols: st.finalCols, removedRows: st.removedRows,
        removedDuplicates: st.removedDuplicates, removedEmpty: st.removedEmpty, changedCells: st.changedCells
      },
      rules: CORE.RULE_IDS.map(function (id) {
        return { name: ruleName(id), state: state.rules[id].on ? 'on' : 'off', detail: state.rules[id].on ? ruleDetailText(id) : '' };
      })
    });
    copyText(text, '已复制清洗配方');
  }

  /* ==========================================================================
     对话框与清空
     ========================================================================== */

  function setupDialog(dialog) {
    dialog.querySelectorAll('[data-close]').forEach(function (btn) {
      btn.addEventListener('click', function () { ZDX.closeDialog(dialog); });
    });
    /* Esc 关闭时也把焦点还回去 */
    dialog.addEventListener('close', function () {
      if (dialog._opener && typeof dialog._opener.focus === 'function') dialog._opener.focus();
    });
    dialog.addEventListener('click', function (e) {
      if (e.target === dialog) ZDX.closeDialog(dialog);
    });
  }

  function openConfirm(options) {
    setText(el('confirm-title'), options.title);
    setText(el('confirm-body'), options.body);
    setText(el('confirm-cancel'), options.cancel);
    var ok = el('confirm-ok');
    setText(ok, options.ok);
    ok.className = 'btn ' + (options.danger ? 'btn--danger' : 'btn--primary');
    state.confirmAction = options.onOk;
    ZDX.openDialog(el('confirm-dialog'));
  }

  function clearData() {
    state.table = null;
    state.source = null;
    state.result = null;
    state.profile = null;
    state.rawDuplicates = 0;
    state.page = 1;
    state.startMode = 'import';
    state.pendingSource = null;
    el('paste-area').value = '';
    updateDelimiterHint();
    hideImportError();
    setImportStatus('');
    recompute();
    if (state.view !== 'start') setView('start', false);
    el('paste-area').focus();
    ZDX.toast('已清空数据', 'info');
  }

  function confirmClear() {
    if (!state.table) return;
    var rows = state.table.rows.length;
    openConfirm({
      title: '清空当前数据？',
      body: '页面里的 ' + fmt(rows) + ' 行数据会从这里移除。清洗规则保持不变，下次导入时直接沿用。',
      cancel: '保留数据',
      ok: '清空 ' + fmt(rows) + ' 行',
      danger: true,
      onOk: clearData
    });
  }

  /* ==========================================================================
     事件
     ========================================================================== */

  function toggleReplaceCol(chip) {
    var col = Number(chip.getAttribute('data-col'));
    var cols = state.rules.replace.cols.slice();
    var idx = cols.indexOf(col);
    if (idx >= 0) cols.splice(idx, 1);
    else cols.push(col);
    cols.sort(function (a, b) { return a - b; });
    setRuleState('replace', 'cols', cols);
  }

  function isTypingTarget(target) {
    var tag = target && target.tagName;
    if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
    return tag === 'INPUT' && ['text', 'search', ''].indexOf(target.type) >= 0;
  }

  function bind() {
    /* 导航 */
    document.querySelectorAll('.nav__item[data-view]').forEach(function (btn) {
      btn.addEventListener('click', function () { setView(btn.getAttribute('data-view'), true); });
    });
    document.querySelectorAll('[data-goto]').forEach(function (btn) {
      btn.addEventListener('click', function () { setView(btn.getAttribute('data-goto'), true); });
    });

    /* 导入 */
    el('btn-load-sample').addEventListener('click', loadSample);
    document.querySelectorAll('[data-action="load-sample"]').forEach(function (btn) {
      btn.addEventListener('click', loadSample);
    });
    el('btn-pick-file').addEventListener('click', function () { el('file-input').click(); });
    el('file-input').addEventListener('change', function () {
      var file = el('file-input').files && el('file-input').files[0];
      el('file-input').value = '';
      if (file) readAndImportFile(file);
    });
    el('import-form').addEventListener('submit', function (e) {
      e.preventDefault();
      startCleaning();
    });
    el('paste-area').addEventListener('input', function () {
      if (state.pendingSource) state.pendingSource.edited = true;
      updateStartButton();
      debounce('detect', updateDelimiterHint, DETECT_DELAY);
    });
    el('paste-area').addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        startCleaning();
      }
    });
    el('btn-clear-paste').addEventListener('click', function () {
      el('paste-area').value = '';
      state.pendingSource = null;
      hideImportError();
      setImportStatus('');
      updateDelimiterHint();
      el('paste-area').focus();
    });
    el('delimiter-seg').addEventListener('click', function (e) {
      var btn = e.target.closest('[data-dl]');
      if (!btn) return;
      state.importOpts.delimiter = btn.getAttribute('data-dl');
      syncDelimiterSeg();
      updateDelimiterHint();
    });
    el('has-header').addEventListener('change', function (e) {
      state.importOpts.hasHeader = e.target.checked;
    });
    var zone = el('dropzone');
    ['dragenter', 'dragover'].forEach(function (type) {
      zone.addEventListener(type, function (e) {
        e.preventDefault();
        zone.classList.add('is-dragover');
      });
    });
    zone.addEventListener('dragleave', function () { zone.classList.remove('is-dragover'); });
    zone.addEventListener('drop', function (e) {
      e.preventDefault();
      zone.classList.remove('is-dragover');
      var file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (file) readAndImportFile(file);
    });
    /* 文件拖到放置区以外时，别让浏览器直接把它打开 */
    window.addEventListener('dragover', function (e) { e.preventDefault(); });
    window.addEventListener('drop', function (e) { e.preventDefault(); });
    el('btn-reimport').addEventListener('click', function () {
      state.startMode = 'import';
      renderStart();
      el('paste-area').focus();
    });
    el('btn-back-overview').addEventListener('click', function () {
      state.startMode = 'overview';
      renderStart();
    });
    el('btn-goto-rules').addEventListener('click', function () { setView('rules', true); });
    el('btn-goto-result').addEventListener('click', function () { setView('result', true); });

    /* 规则 */
    el('rule-list').addEventListener('change', function (e) { handleRuleControl(e.target, false); });
    el('rule-list').addEventListener('input', function (e) { handleRuleControl(e.target, true); });
    el('replace-col-chips').addEventListener('click', function (e) {
      var chip = e.target.closest('[data-col]');
      if (chip) toggleReplaceCol(chip);
    });
    el('btn-undo').addEventListener('click', undo);
    el('btn-reset-rules').addEventListener('click', resetRules);

    /* 列概况 */
    el('profile-mode').addEventListener('click', function (e) {
      var btn = e.target.closest('[data-profile]');
      if (!btn) return;
      state.profileMode = btn.getAttribute('data-profile');
      renderColumns();
    });

    /* 结果 */
    el('compare-mode').addEventListener('click', function (e) {
      var btn = e.target.closest('[data-mode]');
      if (!btn) return;
      state.compareMode = btn.getAttribute('data-mode');
      state.page = 1;
      renderCompareTable();
      pressOne(el('compare-mode'), 'data-mode', state.compareMode);
    });
    el('show-removed').addEventListener('change', function (e) {
      state.showRemoved = e.target.checked;
      state.page = 1;
      renderCompareTable();
    });
    el('pager-prev').addEventListener('click', function () {
      state.page -= 1;
      renderCompareTable();
    });
    el('pager-next').addEventListener('click', function () {
      state.page += 1;
      renderCompareTable();
    });
    el('btn-clear').addEventListener('click', confirmClear);
    el('btn-copy').addEventListener('click', copyTable);
    el('btn-recipe').addEventListener('click', copyRecipe);
    el('btn-export').addEventListener('click', openExport);

    /* 导出对话框 */
    el('btn-export-confirm').addEventListener('click', confirmExport);
    el('export-form').addEventListener('submit', function (e) {
      e.preventDefault();
      confirmExport();
    });
    el('export-form').addEventListener('change', function (e) {
      if (e.target.type === 'radio' || e.target.id === 'export-header') updateExportOptions();
    });
    setupDialog(el('export-dialog'));
    setupDialog(el('confirm-dialog'));
    el('confirm-ok').addEventListener('click', function () {
      var action = state.confirmAction;
      state.confirmAction = null;
      ZDX.closeDialog(el('confirm-dialog'));
      if (action) action();
    });

    /* 快捷键：Ctrl / Cmd + Z 撤销规则改动，Ctrl / Cmd + S 打开导出 */
    document.addEventListener('keydown', function (e) {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      if (el('export-dialog').open || el('confirm-dialog').open) return;
      var key = e.key.toLowerCase();
      if (key === 'z') {
        if (isTypingTarget(e.target) || !state.history.length) return;
        e.preventDefault();
        undo();
      } else if (key === 's') {
        if (!state.table) return;
        e.preventDefault();
        openExport();
      }
    });
  }

  /* ==========================================================================
     启动
     ========================================================================== */

  function init() {
    bind();
    syncRulesForm();
    updateRulesMeta();
    syncDelimiterSeg();
    updateDelimiterHint();
    setView('start', false);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
