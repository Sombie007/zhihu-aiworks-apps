/* ============================================================================
   程序员避坑指南 · 纯逻辑：搜索、筛选、相似条目推荐、要点导出、代码分词
   不碰 DOM。浏览器和 Node 都能加载：
     浏览器  window.APP_CORE（数据取自 window.APP_DATA）
     Node    const CORE = require('./core.js');
             const core = CORE.create(require('./data.js'));
   ========================================================================== */
(function (root, factory) {
  var api = factory(root.APP_DATA || {});
  api.create = function (data) { return factory(data || {}); };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.APP_CORE = api;
})(typeof self !== 'undefined' ? self : this, function (DATA) {
  'use strict';

  var CATEGORIES = DATA.categories || [];
  var ENTRIES = Array.isArray(DATA.entries) ? DATA.entries.slice() : [];
  var DIFFICULTIES = ['入门', '进阶', '资深'];
  var STATUSES = ['all', 'unread', 'read'];

  /* ---------- 小工具 ---------- */

  var CJK_RE = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;

  /** 统一成小写 + 半角，搜索时“＠Transactional”和“@transactional”视为同一个词 */
  function normalize(text) {
    return String(text == null ? '' : text).normalize('NFKC').toLowerCase();
  }

  /** 去掉全部空白，用来做子串匹配 */
  function compact(text) {
    return normalize(text).replace(/\s+/g, '');
  }

  function uniques(list) {
    var seen = {};
    var out = [];
    (list || []).forEach(function (item) {
      var key = normalize(item);
      if (!key || seen[key]) return;
      seen[key] = true;
      out.push(item);
    });
    return out;
  }

  /**
   * 阅读记录可以是普通对象（id → 时间戳，页面用的就是这种），
   * 也可以是带 has 方法的 Set，统一用这个判断。
   */
  function isRead(readMap, id) {
    if (!readMap) return false;
    if (typeof readMap.isRead === 'function') return !!readMap.isRead(id);
    if (typeof readMap.has === 'function') return readMap.has(id);
    return !!readMap[id];
  }

  /* ---------- 分类 ---------- */

  function categoryOf(id) {
    for (var i = 0; i < CATEGORIES.length; i++) {
      if (CATEGORIES[i].id === id) return CATEGORIES[i];
    }
    return null;
  }

  function categoryLabel(id) {
    var c = categoryOf(id);
    return c ? c.label : String(id || '');
  }

  function categoryShort(id) {
    var c = categoryOf(id);
    return (c && c.short) || categoryLabel(id);
  }

  /* ---------- 索引 ---------- */

  function get(id) {
    for (var i = 0; i < ENTRIES.length; i++) {
      if (ENTRIES[i].id === id) return ENTRIES[i];
    }
    return null;
  }

  function position(list, id) {
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) return i;
    }
    return -1;
  }

  /* ---------- 搜索 ---------- */

  /*
    一个词落在哪个字段，就加那个字段的权重；多个字段命中会累加。
    标题最重，正文最轻。顺序就是数组的顺序，改权重只改这里。
  */
  var FIELDS = [
    { name: 'title', weight: 12 },
    { name: 'tags', weight: 8 },
    { name: 'category', weight: 5 },
    { name: 'scenario', weight: 3 },
    { name: 'symptom', weight: 3 },
    { name: 'cause', weight: 2 },
    { name: 'fix', weight: 1 },
    { name: 'principle', weight: 1 }
  ];

  function fieldText(entry, name) {
    switch (name) {
      case 'tags': return (entry.tags || []).join('\n');
      case 'category': return categoryLabel(entry.category) + '\n' + categoryShort(entry.category) + '\n' + (entry.category || '');
      case 'fix': return (entry.fix || []).join('\n');
      default: return entry[name] == null ? '' : entry[name];
    }
  }

  /* 每条的可检索文本按 id 缓存，算一次反复用 */
  var docCache = {};

  function docOf(entry) {
    if (!entry) return [];
    var cached = docCache[entry.id];
    if (cached && cached.ref === entry) return cached.fields;
    var fields = FIELDS.map(function (f) { return compact(fieldText(entry, f.name)); });
    docCache[entry.id] = { ref: entry, fields: fields };
    return fields;
  }

  /*
    切词：先按空白切，再在“中文 ↔ 英文 / 数字”的交界处切开。
    所以 “spring事务” 会变成 spring + 事务 两个词。
  */
  function tokenize(query) {
    var s = normalize(query).trim();
    var out = [];
    var buf = '';
    var prevIsCjk = null;

    function flush() {
      if (buf) out.push(buf);
      buf = '';
      prevIsCjk = null;
    }

    for (var i = 0; i < s.length; i++) {
      var ch = s.charAt(i);
      if (/\s/.test(ch)) { flush(); continue; }
      var isCjk = CJK_RE.test(ch);
      if (prevIsCjk !== null && isCjk !== prevIsCjk) flush();
      buf += ch;
      prevIsCjk = isCjk;
    }
    flush();
    return out;
  }

  /**
   * 在给定列表里搜索。多个词之间是“且”的关系；结果按相关度排序。
   * 空查询原样返回（保持原顺序）。
   */
  function search(list, query) {
    var terms = tokenize(query);
    if (!terms.length) return list.slice();

    var phrase = compact(query);
    var scored = [];

    for (var i = 0; i < list.length; i++) {
      var entry = list[i];
      var doc = docOf(entry);
      var total = 0;
      var matched = true;

      for (var t = 0; t < terms.length; t++) {
        var term = terms[t];
        var gained = 0;
        var found = false;
        for (var f = 0; f < FIELDS.length; f++) {
          if (doc[f].indexOf(term) >= 0) { gained += FIELDS[f].weight; found = true; }
        }
        if (!found) { matched = false; break; }
        total += gained;
      }
      if (!matched) continue;

      if (compact(entry.title).indexOf(phrase) >= 0) total += 20; // 整个查询就是标题（或标题的一部分）
      scored.push({ entry: entry, score: total, order: i });
    }

    scored.sort(function (a, b) { return b.score - a.score || a.order - b.order; });
    return scored.map(function (item) { return item.entry; });
  }

  /* ---------- 筛选 ---------- */

  function isAll(value) {
    return !value || value === 'all';
  }

  function hasActiveFilters(criteria) {
    if (!criteria) return false;
    return !isAll(criteria.category) || !isAll(criteria.difficulty) || !isAll(criteria.status) ||
      !!compact(criteria.query || '');
  }

  /** 筛选 + 搜索一起做。criteria: { category, difficulty, status, query } */
  function query(list, criteria, read) {
    var c = criteria || {};
    var cat = isAll(c.category) ? null : c.category;
    var diff = isAll(c.difficulty) ? null : c.difficulty;
    var status = isAll(c.status) ? null : c.status;

    var kept = (list || []).filter(function (entry) {
      if (cat && entry.category !== cat) return false;
      if (diff && entry.difficulty !== diff) return false;
      if (status === 'read' && !isRead(read, entry.id)) return false;
      if (status === 'unread' && isRead(read, entry.id)) return false;
      return true;
    });

    return search(kept, c.query || '');
  }

  function countBy(list, field) {
    var counts = {};
    (list || []).forEach(function (entry) {
      var key = entry[field];
      if (key == null) return;
      counts[key] = (counts[key] || 0) + 1;
    });
    return counts;
  }

  /* ---------- 相似条目推荐 ---------- */

  function tagSet(entry) {
    var set = {};
    uniques(entry.tags || []).forEach(function (tag) { set[normalize(tag)] = true; });
    return set;
  }

  /**
   * 给某条找相似条目。自己、它已列为相关的条目、exclude 里的都不会出现。
   * 打分：共同标签每个 3 分；对方把我列为相关 4 分；同主题 2 分。
   * 没有任何交集的条目不推荐（宁缺毋滥）。
   */
  function recommend(entryId, limit, exclude) {
    var current = get(entryId);
    if (!current) return [];
    limit = limit == null ? 3 : limit;

    var skip = {};
    skip[entryId] = true;
    (current.related || []).forEach(function (id) { skip[id] = true; });
    (exclude || []).forEach(function (id) { skip[id] = true; });

    var tags = tagSet(current);
    var scored = [];

    ENTRIES.forEach(function (entry, i) {
      if (skip[entry.id]) return;
      var score = 0;
      (entry.tags || []).forEach(function (tag) {
        if (tags[normalize(tag)]) score += 3;
      });
      if ((entry.related || []).indexOf(entryId) >= 0) score += 4;
      if (entry.category === current.category) score += 2;
      if (score > 0) scored.push({ entry: entry, score: score, order: i });
    });

    scored.sort(function (a, b) { return b.score - a.score || a.order - b.order; });
    return scored.slice(0, limit).map(function (item) { return item.entry; });
  }

  /* ---------- 上一条 / 下一条 / 随机 ---------- */

  /** step 为 -1 取上一条，1 取下一条；到头返回 null */
  function neighbor(list, id, step) {
    var i = position(list, id);
    if (i < 0) return null;
    var j = i + (step < 0 ? -1 : 1);
    return j >= 0 && j < list.length ? list[j] : null;
  }

  function unread(list, read) {
    return (list || []).filter(function (entry) { return !isRead(read, entry.id); });
  }

  function pickRandom(list, rand) {
    if (!list || !list.length) return null;
    var r = typeof rand === 'function' ? rand() : Math.random();
    r = Math.max(0, Math.min(0.999999999, Number(r) || 0));
    return list[Math.floor(r * list.length)];
  }

  /* ---------- 复制要点：导出纯文本 ---------- */

  function toPlainText(entry) {
    if (!entry) return '';
    var lines = [];
    lines.push('【' + entry.title + '】');
    lines.push('主题：' + categoryLabel(entry.category) + '　难度：' + entry.difficulty);
    if (entry.tags && entry.tags.length) lines.push('标签：' + entry.tags.join('、'));
    lines.push('');
    lines.push('什么时候遇到：' + entry.scenario);
    lines.push('现象：' + entry.symptom);
    lines.push('根因：' + entry.cause);
    lines.push('正确做法：');
    (entry.fix || []).forEach(function (item, i) { lines.push((i + 1) + '. ' + item); });
    lines.push('一句话原则：' + entry.principle);
    return lines.join('\n');
  }

  /* ---------- 代码分词：把注释和字符串从代码里分出来 ---------- */

  var SYNTAX = {
    java: { line: '//', block: ['/*', '*/'], quotes: ['"', "'"] },
    js: { line: '//', block: ['/*', '*/'], quotes: ['"', "'"] },
    sql: { line: '--', block: ['/*', '*/'], quotes: ["'", '"'] },
    shell: { line: '#', block: null, quotes: ['"', "'"] },
    yaml: { line: '#', block: null, quotes: ['"', "'"] },
    conf: { line: '#', block: null, quotes: [] },
    properties: { line: '#', block: null, quotes: [] },
    text: { line: null, block: null, quotes: [] }
  };

  /**
   * 返回按行切好的结果：[{ key, parts: [{ type: 'code' | 'comment' | 'string', text }] }]。
   * key 为 true 表示这一行的注释以“关键”开头，界面上把它标出来。
   */
  function splitCode(code, lang) {
    var src = String(code == null ? '' : code).replace(/\r\n?/g, '\n');
    var syntax = SYNTAX[lang] || SYNTAX.text;
    var tokens = tokenizeCode(src, syntax);
    var keyMark = syntax.line ? '关键' : null;

    var lines = [];
    var current = { key: false, parts: [] };
    var lineIsKey = false;

    tokens.forEach(function (token) {
      var pieces = token.text.split('\n');
      pieces.forEach(function (text, i) {
        if (i > 0) {
          lines.push(current);
          current = { key: false, parts: [] };
          lineIsKey = false;
        }
        if (!text) return;
        if (token.type === 'comment' && !lineIsKey && keyMark &&
            text.trim().indexOf(syntax.line) === 0) {
          var body = text.trim().slice(syntax.line.length).trim();
          if (body.indexOf(keyMark) === 0) {
            lineIsKey = true;
            current.key = true;
          }
        }
        current.parts.push({ type: token.type, text: text });
      });
    });
    lines.push(current);
    return lines;
  }

  function tokenizeCode(src, syntax) {
    var tokens = [];
    var buf = '';
    var i = 0;
    var n = src.length;

    function push(type, text) {
      if (text) tokens.push({ type: type, text: text });
    }

    while (i < n) {
      var ch = src.charAt(i);
      var two = src.substr(i, 2);

      if (syntax.block && two === syntax.block[0]) {
        push('code', buf); buf = '';
        var end = src.indexOf(syntax.block[1], i + 2);
        var stop = end < 0 ? n : end + 2;
        push('comment', src.slice(i, stop));
        i = stop;
        continue;
      }
      if (syntax.line && src.startsWith(syntax.line, i)) {
        push('code', buf); buf = '';
        var eol = src.indexOf('\n', i);
        var lineEnd = eol < 0 ? n : eol;
        push('comment', src.slice(i, lineEnd));
        i = lineEnd;
        continue;
      }
      if (syntax.quotes.indexOf(ch) >= 0) {
        var j = i + 1;
        while (j < n && src.charAt(j) !== ch && src.charAt(j) !== '\n') {
          if (src.charAt(j) === '\\') j++; // 转义字符跳过
          j++;
        }
        var close = (j < n && src.charAt(j) === ch) ? j + 1 : j;
        push('code', buf);
        buf = '';
        push('string', src.slice(i, close));
        i = close;
        continue;
      }
      buf += ch;
      i++;
    }
    push('code', buf);

    // 合并相邻的同类片段、去掉空片段
    var merged = [];
    tokens.forEach(function (token) {
      if (!token.text) return;
      var last = merged[merged.length - 1];
      if (last && last.type === token.type) last.text += token.text;
      else merged.push({ type: token.type, text: token.text });
    });
    return merged;
  }

  /* ---------- 导出 ---------- */

  return {
    CATEGORIES: CATEGORIES,
    DIFFICULTIES: DIFFICULTIES,
    STATUSES: STATUSES,
    entries: ENTRIES,

    normalize: normalize,
    compact: compact,
    tokenize: tokenize,

    categoryOf: categoryOf,
    categoryLabel: categoryLabel,
    categoryShort: categoryShort,

    get: get,
    position: position,
    countBy: countBy,

    search: search,
    query: query,
    hasActiveFilters: hasActiveFilters,
    isRead: isRead,

    recommend: recommend,
    neighbor: neighbor,
    unread: unread,
    pickRandom: pickRandom,

    toPlainText: toPlainText,
    splitCode: splitCode
  };
});
