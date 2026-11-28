/*
 * 表格清洗 · 核心逻辑
 * ----------------------------------------------------------------------------
 * 这里只放纯函数：解析、识别、清洗、统计、导出格式化。不碰 DOM、文件读写、localStorage，
 * 浏览器和 Node 里都能直接跑（test/core.test.js 用 Node 的 node:test 给它写单测）。
 *
 * 加载方式：
 *   浏览器：用 script 标签引入本文件（构建时会原样内联进页面），之后通过 window.APP_CORE 调用
 *   Node：  var core = require('./core.js')
 *
 * 注意：本文件会被内联进 HTML 的 script 元素里，所以任何地方（包括注释和字符串）都不能
 * 出现 script 元素的结束标签（小于号、斜杠再加 script 这几个字母连在一起），否则浏览器会
 * 认为脚本在那里就结束了。写注释说明这件事时也要绕开，别把它原样写出来。
 *
 * 约定：
 *   - 表格 = { header: string[], rows: string[][] }，行、列下标都从 0 计。
 *   - 所有函数都不修改传入的数组；applyRules 会先复制一份数据再处理。
 *   - 需要给用户看的文字（原因、建议）也在这里生成，统一是简体中文、全角标点。
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.APP_CORE = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var VERSION = '2.0.0';

  /* 对比表格每页最多显示的行数 */
  var PREVIEW_ROWS = 200;

  /* 一列里非空值至少有多大比例是日期，8 位纯数字才按日期处理（说明见 parseDateValue） */
  var DATE_COLUMN_RATIO = 0.9;

  /* 列类型判定：非空值中至少多大比例能解析成该类型 */
  var TYPE_RATIO = 0.9;

  /* ==========================================================================
     1. 分隔符
     ========================================================================== */

  var DELIMITERS = [
    { id: 'comma', char: ',', label: '逗号' },
    { id: 'tab', char: '\t', label: '制表符' },
    { id: 'semicolon', char: ';', label: '分号' },
    { id: 'pipe', char: '|', label: '竖线' }
  ];

  var SAMPLE_LINES = 5;

  function delimiterChar(id) {
    for (var i = 0; i < DELIMITERS.length; i++) if (DELIMITERS[i].id === id) return DELIMITERS[i].char;
    return null;
  }

  function delimiterId(ch) {
    for (var i = 0; i < DELIMITERS.length; i++) if (DELIMITERS[i].char === ch) return DELIMITERS[i].id;
    return null;
  }

  function delimiterLabel(ch) {
    for (var i = 0; i < DELIMITERS.length; i++) if (DELIMITERS[i].char === ch) return DELIMITERS[i].label;
    return '';
  }

  /* 一行里引号之外某个字符出现的次数 */
  function countOutsideQuotes(line, ch) {
    var n = 0;
    var inQuotes = false;
    for (var i = 0; i < line.length; i++) {
      var c = line.charAt(i);
      if (c === '"') {
        if (inQuotes && line.charAt(i + 1) === '"') i++;
        else inQuotes = !inQuotes;
      } else if (c === ch && !inQuotes) {
        n++;
      }
    }
    return n;
  }

  /**
   * 识别分隔符：取前 5 个非空行，统计引号外的 , \t ; | 出现次数。
   *
   * 返回 {
   *   delimiter: ',' | '\t' | ';' | '|' | null，识别不出时为 null
   *   delimiterId,
   *   confidence: 'high' 各行次数一致 | 'low' 次数不一致，按总次数取的 | 'none' 都是 0 次
   *   lines: 实际取样了几行,
   *   counts: 每个候选分隔符在各行的次数,
   *   tiedWith: 和选中项打成平手的分隔符字符，需要用户核对
   * }
   *
   * 平手时按 逗号 > 制表符 > 分号 > 竖线 的顺序取先出现的那个。
   */
  function detectDelimiter(text) {
    var lines = String(text == null ? '' : text).split(/\r\n|\n|\r/);
    var sample = [];
    for (var i = 0; i < lines.length && sample.length < SAMPLE_LINES; i++) {
      if (lines[i].trim() !== '') sample.push(lines[i]);
    }

    var result = {
      delimiter: null,
      delimiterId: null,
      confidence: 'none',
      lines: sample.length,
      counts: {},
      tiedWith: []
    };

    var cands = [];
    DELIMITERS.forEach(function (d) {
      var counts = sample.map(function (line) { return countOutsideQuotes(line, d.char); });
      var total = 0;
      var consistent = true;
      for (var k = 0; k < counts.length; k++) {
        total += counts[k];
        if (counts[k] !== counts[0]) consistent = false;
      }
      result.counts[d.char] = counts;
      cands.push({ char: d.char, total: total, count: counts[0], consistent: consistent && counts[0] > 0 });
    });

    var best = null;
    cands.forEach(function (c) {
      if (c.total === 0) return;
      if (!best) { best = c; return; }
      if (c.consistent !== best.consistent) { if (c.consistent) best = c; return; }
      if (c.consistent ? c.count > best.count : c.total > best.total) best = c;
    });
    if (!best) return result;

    result.delimiter = best.char;
    result.delimiterId = delimiterId(best.char);
    result.confidence = best.consistent ? 'high' : 'low';
    cands.forEach(function (c) {
      if (c === best || c.total === 0) return;
      var same = c.consistent === best.consistent && (c.consistent ? c.count === best.count : c.total === best.total);
      if (same) result.tiedWith.push(c.char);
    });
    return result;
  }

  /* ==========================================================================
     2. CSV 解析（RFC 4180）
     ========================================================================== */

  var QUOTE = 34;
  var LF = 10;
  var CR = 13;

  /**
   * 把文本解析成二维数组。
   * - 双引号包住的字段里，分隔符和换行都是内容；"" 表示一个双引号。
   * - 换行可以是 CRLF、LF 或单独的 CR。文本末尾的换行不会多出一个空行；中间的空行会变成 ['']。
   * - 宽松处理：字段结束引号后面、分隔符前面如果还有字符，并入该字段；没闭合的引号一直读到文本末尾。
   * - 去掉开头的 UTF-8 BOM。
   *
   * 返回 { records: string[][], unclosedQuotes, quoteGlitches }
   *   unclosedQuotes 没有闭合引号的字段数。这种字段会把后面的行吞进来，通常说明数据有问题
   *   quoteGlitches   引号用法不规范的字段数（结束引号后面还有字符，或没加引号的字段里出现了引号）
   */
  function parseCsv(text, delimiter) {
    var s = String(text == null ? '' : text);
    if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1);
    var d = delimiter == null || delimiter === '' ? ',' : String(delimiter).charAt(0);
    var dCode = d.charCodeAt(0);
    var n = s.length;
    var i = 0;
    var records = [];
    var record = [];
    var unclosed = 0;
    var glitches = 0;

    while (i < n) {
      if (s.charCodeAt(i) === QUOTE) {
        /* 引号开头的字段 */
        var content = '';
        var closed = false;
        i++;
        while (i < n) {
          var j = s.indexOf('"', i);
          if (j < 0) { content += s.slice(i); i = n; break; }
          if (s.charCodeAt(j + 1) === QUOTE) { content += s.slice(i, j) + '"'; i = j + 2; continue; }
          content += s.slice(i, j);
          i = j + 1;
          closed = true;
          break;
        }
        if (!closed) unclosed++;
        var k = i;
        while (k < n) {
          var kc = s.charCodeAt(k);
          if (kc === dCode || kc === LF || kc === CR) break;
          k++;
        }
        if (k > i) { content += s.slice(i, k); glitches++; }
        record.push(content);
        i = k;
      } else {
        /* 没加引号的字段：写到分隔符或换行为止，中间出现的引号按普通字符处理 */
        var e = i;
        while (e < n) {
          var ec = s.charCodeAt(e);
          if (ec === dCode || ec === LF || ec === CR) break;
          e++;
        }
        var field = s.slice(i, e);
        if (field.indexOf('"') >= 0) glitches++;
        record.push(field);
        i = e;
      }

      if (i >= n) { records.push(record); break; }
      var c = s.charCodeAt(i);
      if (c === dCode) {
        i++;
        /* 这一行以分隔符结尾，后面正好是文件末尾（没有换行）：补上最后一个空字段，把这行存下来 */
        if (i >= n) { record.push(''); records.push(record); }
        continue;
      }
      records.push(record);
      record = [];
      if (c === CR && s.charCodeAt(i + 1) === LF) i++;
      i++;
    }
    return { records: records, unclosedQuotes: unclosed, quoteGlitches: glitches };
  }

  function isBlankRow(row) {
    for (var c = 0; c < row.length; c++) if (row[c].trim() !== '') return false;
    return true;
  }

  /**
   * 把解析出来的记录整理成一张表：定表头、对齐列数。
   *
   * options.hasHeader  首行是否为表头（默认 true）
   *
   * 返回 {
   *   header, rows, hasHeader, width,
   *   report: {
   *     leadingBlank  表头之前被跳过的空行数
   *     shortRows     列数比表头少的非空行数（已补空）
   *     longRows      列数比表头多的行数（多出的内容放进「附加列」）
   *     extraCols     多出的列数
   *     blankRows     全空的数据行数
   *   }
   * }；没有任何内容时返回 null。
   *
   * 行数不足的补空；比表头多的列依次命名为「附加列 1、2 …」。
   */
  function buildTable(records, options) {
    options = options || {};
    var hasHeader = options.hasHeader !== false;
    var recs = [];
    for (var i = 0; i < records.length; i++) recs.push(records[i].slice());

    var start = 0;
    while (start < recs.length && isBlankRow(recs[start])) start++;
    if (start >= recs.length) return null;

    var headerRecord = hasHeader ? recs[start] : null;
    var data = recs.slice(hasHeader ? start + 1 : start);
    var baseCols = headerRecord ? headerRecord.length : 0;

    var width = baseCols;
    var r;
    var c;
    for (r = 0; r < data.length; r++) if (data[r].length > width) width = data[r].length;
    if (width < 1) width = 1;

    var header = new Array(width);
    for (c = 0; c < width; c++) {
      if (headerRecord) header[c] = c < baseCols ? headerRecord[c] : '附加列 ' + (c - baseCols + 1);
      else header[c] = '列 ' + (c + 1);
    }

    var ref = headerRecord ? baseCols : width;
    var shortRows = 0;
    var longRows = 0;
    var blankRows = 0;
    for (r = 0; r < data.length; r++) {
      var row = data[r];
      if (isBlankRow(row)) blankRows++;
      else if (row.length < ref) shortRows++;
      else if (row.length > ref) longRows++;
      for (c = row.length; c < width; c++) row.push('');
    }

    return {
      header: header,
      rows: data,
      hasHeader: hasHeader,
      width: width,
      report: {
        leadingBlank: start,
        shortRows: shortRows,
        longRows: longRows,
        extraCols: headerRecord ? Math.max(0, width - baseCols) : 0,
        blankRows: blankRows
      }
    };
  }

  /* ==========================================================================
     3. 数字
     ========================================================================== */

  var RE_FW_DIGITS = /[\uFF10-\uFF19]/g;
  var RE_HAS_FW_DIGITS = /[\uFF10-\uFF19]/;
  var RE_CURRENCY_G = /美元|元|[¥￥$€£]/g;
  var RE_CURRENCY = /美元|元|[¥￥$€£]/;
  var RE_GROUPED = /^[+\-]?\d{1,3}(?:,\d{3})+(?:\.\d*)?$/;
  var RE_NUMERIC = /^([+\-]?)(\d*)(?:\.(\d*))?$/;
  var RE_PERCENT = /^([+\-]?)(\d*)(?:\.(\d*))?[%％]$/;
  var RE_PERCENT_END = /[%％]$/;
  var RE_LEADING_ZERO = /^0\d/;

  function fwToAscii(ch) { return String.fromCharCode(ch.charCodeAt(0) - 0xFEE0); }

  /* 全角数字、数字之间的全角小数点和千分位逗号、开头的全角正负号 → 半角 */
  function halfWidthNumber(s) {
    if (!RE_HAS_FW_DIGITS.test(s)) return s;
    return s
      .replace(RE_FW_DIGITS, fwToAscii)
      .replace(/^＋/, '+').replace(/^－/, '-')
      .replace(/(\d)．(?=\d)/g, '$1.')
      .replace(/(\d)，(?=\d)/g, '$1,');
  }

  /* 单元格以这些字符开头才可能是数字：+ - . 0-9 ¥ ￥ $ € £ 元 美 以及对应的全角字符 */
  function isNumberStart(code) {
    return code === 0x2B || code === 0x2D || code === 0x2E ||
      (code >= 0x30 && code <= 0x39) ||
      code === 0xFF0B || code === 0xFF0D || code === 0xFF0E || (code >= 0xFF10 && code <= 0xFF19) ||
      code === 0xA5 || code === 0xFFE5 || code === 0x24 || code === 0x20AC || code === 0xA3 ||
      code === 0x5143 || code === 0x7F8E;
  }

  /* 去掉整数部分多余的前导零，至少留一位。能走到这里的都不是要保留的编号 */
  function stripIntZeros(int) {
    if (int === '') return '0';
    return int.replace(/^0+(?=\d)/, '');
  }

  /* 按字符串拼出数字，保留原来的小数位数（"12800.50" 不会变成 "12800.5"）。frac 为 null 表示没有小数点。
   * 负号保留，正号去掉 */
  function renderNumber(sign, int, frac) {
    var i = stripIntZeros(int);
    var f = frac === null ? '' : '.' + frac;
    if (sign === '-' && /^0+$/.test(i) && /^0*$/.test(frac || '')) sign = '';
    return sign + i + f;
  }

  /* 小数点左移 places 位（用于百分号转小数）。纯字符串处理，不经过浮点数 */
  function shiftDecimal(sign, int, frac, places) {
    var digits = stripIntZeros(int + frac);
    var scale = frac.length + places;
    while (digits.length <= scale) digits = '0' + digits;
    var cut = digits.length - scale;
    var out = digits.slice(0, cut) + '.' + digits.slice(cut);
    if (sign === '-' && /^0+\.0+$/.test(out)) sign = '';
    return sign + out;
  }

  /**
   * 数字规范化（单个单元格）。options = { thousands, currency, percent, fullwidth }
   * 返回处理后的字符串；不是数字、或不满足条件时原样返回。
   *
   * 几条原则：
   * - 只有最终能得到「纯数字」时才改写数值。比如开了「去除千分位逗号」但没开「去除货币符号」，
   *   "¥12,800" 不会变成 "¥12800"，而是保持原样。
   * - 千分位逗号只在分组合法时才去掉："1,234" → "1234"，"12,34" 原样保留，它可能是别的意思。
   * - 保留前导零：整数部分以 0 开头且不止一位的（010123、0012）视为编号，不改写。
   * - 全角数字转半角不改变数值，所以不受上面几条限制：只要开了这个选项，值里的全角数字
   *   都会转成半角（"０１０１２３" → "010123"，"２０２３-０３-１２" → "2023-03-12"）。
   * - 小数位数保持原样；带指数的写法（1.2e3）不做处理。
   * - 百分号转小数：12.5% → 0.125，95% → 0.95，小数位数 = 原来的位数 + 2。
   *
   * 调用方应先确认这个值以数字相关的字符开头（isNumberStart），其余的值不必调用。
   */
  function normalizeNumber(value, options) {
    options = options || {};
    var s = value;
    if (s === '' || !isNumberStart(s.charCodeAt(0))) return s;
    if (options.fullwidth) s = halfWidthNumber(s);

    var t = s;
    if (options.currency) t = t.replace(RE_CURRENCY_G, '').trim();
    if (options.thousands && RE_GROUPED.test(t)) t = t.replace(/,/g, '');

    var m = RE_NUMERIC.exec(t);
    if (m) {
      if (m[2] === '' && (m[3] === undefined || m[3] === '')) return s;   // 一个数字都没有
      if (RE_LEADING_ZERO.test(m[2])) return s;                            // 带前导零的编号
      var out = renderNumber(m[1] === '-' ? '-' : '', m[2], m[3] === undefined ? null : m[3]);
      return out === s ? s : out;
    }

    if (!options.percent || !RE_PERCENT_END.test(t)) return s;
    var p = t;
    if (options.thousands && RE_GROUPED.test(t.slice(0, -1))) p = t.slice(0, -1).replace(/,/g, '') + t.slice(-1);
    p = RE_PERCENT.exec(p);
    if (!p || (p[2] === '' && (p[3] === undefined || p[3] === ''))) return s;
    if (RE_LEADING_ZERO.test(p[2])) return s;
    return shiftDecimal(p[1] === '-' ? '-' : '', p[2] === '' ? '0' : p[2], p[3] || '', 2);
  }

  /* 把一段文字里的全角数字全部转成半角（数字之间的全角小数点和千分位逗号也一起转） */
  function halfWidthDigits(s) {
    return RE_HAS_FW_DIGITS.test(s) ? halfWidthNumber(s) : s;
  }

  /* ==========================================================================
     4. 日期
     ========================================================================== */

  var RE_WS = /\s/;
  var RE_HAS_FW_DATE = /[\uFF10-\uFF19\uFF1A]/;
  /* 末尾的时间：HH:MM 或 HH:MM:SS（可以再带一位数的小时） */
  var RE_TIME_ONLY = /^\d{1,2}:\d{2}(?::\d{2})?$/;
  /* 没有空白把日期和时间分开时，从末尾切出时间。小时两位或一位各试一次 */
  var RE_TIME_TAIL2 = /^(.+?)(\d{2}:\d{2}(?::\d{2})?)$/;
  var RE_TIME_TAIL1 = /^(.+)(\d:\d{2}(?::\d{2})?)$/;
  /* 最后一处空白：捕获组 1 是它前面的日期部分，捕获组 2 是它后面的内容 */
  var RE_LAST_SPACE = /^([\s\S]*?\S)\s+(\S+)$/;

  /* 所有「看起来像日期」的写法，和下面的细分正则一一对应。先用它快速排除，再细分 */
  var RE_DATE_SHAPE = /^(?:\d{4}(?:-\d{1,2}-\d{1,2}|\/\d{1,2}\/\d{1,2}|\.\d{1,2}\.\d{1,2}|年\d{1,2}月\d{1,2}[日号]?|\d{4}|[-\/.]\d{1,2}|年\d{1,2}月?)|\d{1,2}[-\/.]\d{1,2}[-\/.]\d{2,4}|\d{2}[-\/.]\d{1,2}[-\/.]\d{1,2})$/;

  var RE_D_DASH = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
  var RE_D_SLASH = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/;
  var RE_D_DOT = /^(\d{4})\.(\d{1,2})\.(\d{1,2})$/;
  var RE_D_CN = /^(\d{4})年(\d{1,2})月(\d{1,2})[日号]?$/;
  var RE_D_COMPACT = /^(\d{4})(\d{2})(\d{2})$/;
  var RE_D_TRAILING = /^(\d{1,2})([-\/.])(\d{1,2})\2(\d{4})$/;
  var RE_D_MONTH_SEP = /^(\d{4})[-\/.](\d{1,2})$/;
  var RE_D_MONTH_CN = /^(\d{4})年(\d{1,2})月?$/;
  var RE_D_2DIGIT_FIRST = /^\d{2}[-\/.]\d{1,2}[-\/.]\d{1,2}$/;
  var RE_D_2DIGIT_LAST = /^\d{1,2}[-\/]\d{1,2}[-\/]\d{2}$/;

  function pad2(n) { return n < 10 ? '0' + n : String(n); }

  function isLeapYear(y) { return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0; }

  function daysInMonth(y, m) {
    if (m === 2) return isLeapYear(y) ? 29 : 28;
    return m === 4 || m === 6 || m === 9 || m === 11 ? 30 : 31;
  }

  function normalizeTime(time) {
    var parts = time.split(':');
    if (parts[0].length === 1) parts[0] = '0' + parts[0];
    return parts.join(':');
  }

  /* 时、分、秒是否都在合法范围里 */
  function isPlausibleTime(time) {
    var p = time.split(':');
    return +p[0] <= 23 && +p[1] <= 59 && (p.length < 3 || +p[2] <= 59);
  }

  /**
   * 把「日期 + 时间」切成两段。优先按最后一处空白切；没有空白时（2023年3月12日14:30）
   * 从末尾切出时间，小时先按两位、再按一位试，要求切出来的时间是合法的。
   * 没有时间部分时 time 为空。切不出合法结果返回 null。
   */
  function splitDateTime(s) {
    if (s.indexOf(':') < 0) return { body: s, time: '' };
    var sp = RE_LAST_SPACE.exec(s);
    if (sp) {
      if (RE_TIME_ONLY.test(sp[2]) && isPlausibleTime(sp[2])) return { body: sp[1], time: sp[2] };
      return { body: s, time: '' };
    }
    var two = RE_TIME_TAIL2.exec(s);
    if (two && isPlausibleTime(two[2])) return { body: two[1], time: two[2] };
    var one = RE_TIME_TAIL1.exec(s);
    if (one && isPlausibleTime(one[2])) return { body: one[1], time: one[2] };
    return null;
  }

  function invalidDate(message) {
    return { ok: false, reason: 'invalid', message: message };
  }

  /* 正好 8 位数字（半角或全角） */
  function isCompactDateShape(s) {
    var n = s.length;
    if (n !== 8) return false;
    for (var i = 0; i < n; i++) {
      var c = s.charCodeAt(i);
      if (!((c >= 0x30 && c <= 0x39) || (c >= 0xFF10 && c <= 0xFF19))) return false;
    }
    return true;
  }

  /**
   * 判断一列是不是「日期列」时用的：这个值算不算日期的写法。
   * 非 8 位的日期写法即使写错了（2023-02-30）也算，这样一列里有一两个笔误不会连累整列；
   * 8 位纯数字只有确实是合法日期才算，否则一列 8 位编号会被整体当成日期列。
   */
  function isDateLike(value) {
    var d = parseDateValue(value, 'keep');
    if (!d) return false;
    return d.ok || !isCompactDateShape(value.trim());
  }

  /**
   * 识别一个单元格里的日期。返回三种结果：
   *   null                                        不像日期（大多数单元格都是这样，不报告）
   *   { ok: true, iso, time, ambiguousResolved }  可以规范化，输出 iso + (time ? ' ' + time : '')
   *   { ok: false, reason, message }              像日期但没能规范化。reason 是原因的代号：
   *       ambiguous       日月顺序不明确（03/04/2023）
   *       invalid         不是有效的日期（2023-02-30）
   *       two-digit-year  年份只有两位
   *       month-only      只有年月，没有日
   *
   * 能识别的写法（日、月前的零可有可无，数字可以是全角）：
   *   2023-03-12、2023/3/12、2023年3月12日、20230312、2023.3.12
   * 以及后面带时间的写法（2023/3/12 9:30）。时间部分只补零，不改写。
   * 年份在末尾的写法（25/04/2023）在日或月有一个大于 12 时可以直接判断；
   * 两个都不大于 12 时按 policy 处理：'keep' 保留原值并报告（默认），'dmy' 按「日/月/年」，'mdy' 按「月/日/年」。
   *
   * 关于 8 位纯数字（20230312）：它和 8 位编号没法逐格区分，所以 applyRules 里加了一道门槛：
   * 只有所在列至少 DATE_COLUMN_RATIO 的非空值都是日期时才会转换。
   */
  function parseDateValue(value, policy) {
    var s = value;
    var c0 = s.charCodeAt(0);
    if (!((c0 >= 0x30 && c0 <= 0x39) || (c0 >= 0xFF10 && c0 <= 0xFF19))) return null;
    if (RE_HAS_FW_DATE.test(s)) s = s.replace(RE_FW_DIGITS, fwToAscii).replace(/\uFF1A/g, ':');
    if (RE_WS.test(s)) s = s.trim();

    var split = splitDateTime(s);
    if (!split) return null;
    var body = split.body;
    if (RE_WS.test(body)) body = body.replace(/\s+/g, '');
    if (!RE_DATE_SHAPE.test(body)) return null;
    var time = split.time ? normalizeTime(split.time) : '';

    var m;
    var y = 0;
    var mo = 0;
    var d = 0;
    var ambiguous = false;

    if ((m = RE_D_DASH.exec(body)) || (m = RE_D_SLASH.exec(body)) || (m = RE_D_DOT.exec(body)) ||
        (m = RE_D_CN.exec(body)) || (m = RE_D_COMPACT.exec(body))) {
      y = +m[1];
      mo = +m[2];
      d = +m[3];
    } else if ((m = RE_D_TRAILING.exec(body))) {
      y = +m[4];
      var a = +m[1];
      var b = +m[3];
      if (a > 12 && b <= 12) { d = a; mo = b; }
      else if (b > 12 && a <= 12) { mo = a; d = b; }
      else if (a <= 12 && b <= 12) {
        ambiguous = true;
        if (policy === 'dmy') { d = a; mo = b; }
        else if (policy === 'mdy') { mo = a; d = b; }
        else {
          return {
            ok: false,
            reason: 'ambiguous',
            message: '日月顺序不明确：可能是 ' + a + ' 月 ' + b + ' 日，也可能是 ' + b + ' 月 ' + a + ' 日'
          };
        }
      } else {
        return invalidDate('日和月都超过了 12（' + a + '/' + b + '），不是有效的日期');
      }
    } else if ((m = RE_D_MONTH_SEP.exec(body)) || (m = RE_D_MONTH_CN.exec(body))) {
      return +m[2] >= 1 && +m[2] <= 12
        ? { ok: false, reason: 'month-only', message: '只有年月，没有具体的日，无法补全' }
        : null;
    } else if (RE_D_2DIGIT_FIRST.test(body) || RE_D_2DIGIT_LAST.test(body)) {
      return { ok: false, reason: 'two-digit-year', message: '年份只有两位，无法确定是哪个世纪' };
    } else {
      return null;
    }

    if (y < 1000) return invalidDate('年份必须是 4 位');
    if (mo < 1 || mo > 12) return invalidDate('月份 ' + mo + ' 超出了 1 到 12 的范围');
    var dim = daysInMonth(y, mo);
    if (d < 1 || d > dim) {
      if (d > 31) return invalidDate('日 ' + d + ' 超出了 1 到 31 的范围');
      if (mo === 2 && d === 29) return invalidDate(y + ' 年 2 月没有 29 日，这年不是闰年');
      return invalidDate(mo + ' 月只有 ' + dim + ' 天，没有 ' + d + ' 日');
    }

    return { ok: true, iso: y + '-' + pad2(mo) + '-' + pad2(d), time: time, ambiguousResolved: ambiguous };
  }

  /* ==========================================================================
     5. 规则定义
     ========================================================================== */

  /* 规则的执行顺序固定，从上到下 */
  var RULE_IDS = ['trim', 'invisible', 'emptyRows', 'emptyCols', 'dedupe', 'header', 'number', 'date', 'fill', 'replace', 'englishCase'];

  /* 每条规则改动的是什么：单元格、整行、整列，还是表头 */
  var RULE_KIND = {
    trim: 'cell', invisible: 'cell', emptyRows: 'row', emptyCols: 'col', dedupe: 'row',
    header: 'header', number: 'cell', date: 'cell', fill: 'cell', replace: 'cell', englishCase: 'cell'
  };

  function defaultRules() {
    return {
      trim: { on: true },
      invisible: { on: true },
      emptyRows: { on: true },
      emptyCols: { on: false },
      dedupe: { on: true },
      header: { on: true },
      number: { on: true, thousands: true, currency: true, percent: false, fullwidth: true },
      date: { on: true, ambiguous: 'keep' },
      fill: { on: false, text: '（空）' },
      replace: { on: false, scope: 'all', cols: [], find: '', replacement: '', regex: false },
      englishCase: { on: false, mode: 'none' }
    };
  }

  /* 把规则对象补全、清洗成可以直接使用的形态；缺的字段用默认值 */
  function normalizeRules(input) {
    var out = defaultRules();
    if (!input) return out;
    RULE_IDS.forEach(function (id) {
      var src = input[id];
      if (!src) return;
      Object.keys(src).forEach(function (key) { out[id][key] = src[key]; });
    });
    RULE_IDS.forEach(function (id) { out[id].on = !!out[id].on; });
    ['thousands', 'currency', 'percent', 'fullwidth'].forEach(function (key) { out.number[key] = !!out.number[key]; });
    out.date.ambiguous = ['keep', 'dmy', 'mdy'].indexOf(out.date.ambiguous) >= 0 ? out.date.ambiguous : 'keep';
    out.fill.text = out.fill.text == null ? '' : String(out.fill.text);
    out.replace.scope = out.replace.scope === 'cols' ? 'cols' : 'all';
    out.replace.cols = Array.isArray(out.replace.cols)
      ? out.replace.cols.filter(function (col) { return typeof col === 'number' && col >= 0 && Math.floor(col) === col; })
      : [];
    out.replace.find = out.replace.find == null ? '' : String(out.replace.find);
    out.replace.replacement = out.replace.replacement == null ? '' : String(out.replace.replacement);
    out.replace.regex = !!out.replace.regex;
    out.englishCase.mode = ['none', 'lower', 'upper', 'title'].indexOf(out.englishCase.mode) >= 0 ? out.englishCase.mode : 'none';
    return out;
  }

  /* 某条规则没法执行时的说明：发生了什么 / 为什么 / 怎么改 */
  function ruleError(rule, code, title, reason, fix) {
    return { rule: rule, code: code, title: title, reason: reason, fix: fix };
  }

  function errorFromRegex(find, err) {
    var ex = explainRegexError(err);
    return ruleError(
      'replace', 'regex',
      '查找替换没有执行',
      '「查找内容」按正则表达式解析时出错：' + ex.reason + '原始报错：' + ex.raw,
      ex.fix
    );
  }

  /**
   * 编译查找替换的表达式。返回 { re }（按普通文本替换时 re 为 null）或 { error }。
   * 正则默认替换每一处（自动加上 g 标志）；表达式里用了 \p{…} 或 \u{…} 时再加上 u 标志。
   */
  function compileFind(find, isRegex) {
    if (!isRegex) return { re: null };
    var flags = /\\p\{|\\u\{/.test(find) ? 'gu' : 'g';
    try {
      return { re: new RegExp(find, flags) };
    } catch (err) {
      return { error: errorFromRegex(find, err) };
    }
  }

  var RE_LINE_BREAKS = /[\r\n]+/g;

  /**
   * 表头规范化：去首尾空白、删除换行；空表头填「列 N」；重名表头追加序号（「金额」「金额 (2)」）。
   * cleanInvisible 为 true 时同时清理不可见字符（和「清理不可见字符」规则联动）。
   * 返回 { names, changed }
   */
  function normalizeHeaderNames(names, cleanInvisible) {
    var out = new Array(names.length);
    var used = new Set();
    var changed = 0;
    for (var i = 0; i < names.length; i++) {
      var t = names[i] == null ? '' : String(names[i]).trim().replace(RE_LINE_BREAKS, '');
      if (cleanInvisible) t = t.replace(RE_TAB_G, ' ').replace(RE_INVISIBLE_G, '').trim();
      var base = t === '' ? '列 ' + (i + 1) : t;
      var unique = base;
      for (var k = 2; used.has(unique); k++) unique = base + ' (' + k + ')';
      used.add(unique);
      out[i] = unique;
      if (unique !== names[i]) changed++;
    }
    return { names: out, changed: changed };
  }

  /* 去除首尾空白：先看首尾字符的编码，不是空白就不必调用 trim */
  function isEdgeSpace(code) {
    return code <= 0x20 || (code >= 0x80 && code <= 0xA0) || (code >= 0x1680 && code <= 0x3000) ||
      code === 0x202F || code === 0x205F || code === 0xFEFF;
  }

  /* 不可见字符：零宽字符 U+200B–U+200D、BOM U+FEFF、除换行外的控制字符 */
  var INVISIBLE_CLASS = '\u200B-\u200D\uFEFF\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F';
  var RE_INVISIBLE_G = new RegExp('[' + INVISIBLE_CLASS + ']', 'g');
  var RE_INVISIBLE = new RegExp('[' + INVISIBLE_CLASS + ']');
  var RE_TAB_G = /\t/g;

  /* 英文大小写只影响纯英文字母的单元格（单词之间可以有单个空格） */
  var RE_ENGLISH = /^[A-Za-z]+(?: [A-Za-z]+)*$/;
  var RE_WORD = /[A-Za-z]+/g;

  function titleCaseWord(w) { return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase(); }

  function changeEnglishCase(s, mode) {
    if (!RE_ENGLISH.test(s)) return s;
    if (mode === 'lower') return s.toLowerCase();
    if (mode === 'upper') return s.toUpperCase();
    return s.replace(RE_WORD, titleCaseWord);
  }

  /* ==========================================================================
     6. 清洗主流程
     ========================================================================== */

  /**
   * 按固定顺序执行规则。不会修改传入的 table。
   *
   * options.maxChanges 每条规则最多记录几处改动样例（默认 20）
   * options.maxIssues   日期问题最多记录几条（默认 500）
   *
   * 返回 {
   *   header, rows          清洗后的列名和数据
   *   colMap, rowMap        清洗后的第几列 / 第几行 对应原始的第几列 / 第几行
   *   cellChanged           与 rows 等长。某行有改动时是 Uint8Array（按下标对应清洗后的列），否则为 null
   *   headerChanged         与 header 等长的 Uint8Array
   *   removed               [{ row, reason: 'empty' | 'duplicate', first }]，按原始行号排序
   *   removedCols           被删除的原始列下标
   *   stats                 汇总数字
   *   rules                 每条规则一份报表，顺序与 RULE_IDS 一致
   *   ruleErrors            让某条规则没法执行的错误（{ rule, code, title, reason, fix }）
   *   dateIssues            { total, byReason, items: [{ row, col, value, reason, message }] }
   * }
   *
   * 每份规则报表：{ id, on, kind, rows, cells, total, changes, removedRows, removedCols, headers }
   *   rows / cells   影响到的行数、单元格数
   *   changes        最多 maxChanges 处改动样例 [{ row, col, before, after }]，row、col 是原始下标；表头的改动 row 为 -1
   */
  function applyRules(table, rules, options) {
    options = options || {};
    rules = normalizeRules(rules);
    var maxChanges = options.maxChanges == null ? 20 : options.maxChanges;
    var maxIssues = options.maxIssues == null ? 500 : options.maxIssues;

    var srcHeader = (table && table.header) || [];
    var srcRows = (table && table.rows) || [];
    var nRows = srcRows.length;
    var nCols = srcHeader.length;
    var r;
    var c;
    var k;
    var row;
    var v;
    var t;
    for (r = 0; r < nRows; r++) if (srcRows[r].length > nCols) nCols = srcRows[r].length;

    /* 复制一份数据再处理 */
    var header = srcHeader.slice();
    for (c = header.length; c < nCols; c++) header.push('');
    var rows = new Array(nRows);
    for (r = 0; r < nRows; r++) {
      var copy = srcRows[r].slice();
      for (c = copy.length; c < nCols; c++) copy.push('');
      rows[r] = copy;
    }

    var rowAlive = new Uint8Array(nRows);
    rowAlive.fill(1);
    var colAlive = new Uint8Array(nCols);
    colAlive.fill(1);
    var changed = new Array(nRows);       /* 每行按需创建一个 Uint8Array(nCols)，标记被改动过的原始列 */
    var rowTouch = new Uint8Array(nRows);
    var reports = {};
    var removed = [];
    var removedCols = [];
    var ruleErrors = [];
    var issues = [];
    var issueTotal = 0;
    var issueByReason = { ambiguous: 0, invalid: 0, 'two-digit-year': 0, 'month-only': 0 };
    var removedEmpty = 0;
    var removedDup = 0;
    var current = null;

    function begin(id) {
      current = reports[id] = {
        id: id, on: !!rules[id].on, kind: RULE_KIND[id],
        rows: 0, cells: 0, total: 0, changes: [],
        removedRows: 0, removedCols: 0, headers: 0
      };
      rowTouch.fill(0);
    }
    function setCell(ri, ci, value) {
      var before = rows[ri][ci];
      if (before === value) return false;
      rows[ri][ci] = value;
      (changed[ri] || (changed[ri] = new Uint8Array(nCols)))[ci] = 1;
      current.total++;
      current.cells++;
      if (!rowTouch[ri]) { rowTouch[ri] = 1; current.rows++; }
      if (current.changes.length < maxChanges) {
        current.changes.push({ row: ri, col: ci, before: before, after: value });
      }
      return true;
    }
    function addIssue(ri, ci, value, reason, message) {
      issueTotal++;
      issueByReason[reason] = (issueByReason[reason] || 0) + 1;
      if (issues.length < maxIssues) issues.push({ row: ri, col: ci, value: value, reason: reason, message: message });
    }

    /* ---- 1 去除首尾空白（含全角空格、制表符、不间断空格） ---- */
    begin('trim');
    if (rules.trim.on) {
      for (r = 0; r < nRows; r++) {
        row = rows[r];
        for (c = 0; c < nCols; c++) {
          v = row[c];
          if (v === '') continue;
          if (!isEdgeSpace(v.charCodeAt(0)) && !isEdgeSpace(v.charCodeAt(v.length - 1))) continue;
          t = v.trim();
          if (t !== v) setCell(r, c, t);
        }
      }
    }

    /* ---- 2 清理不可见字符；制表符换成空格，其余直接删除 ---- */
    begin('invisible');
    if (rules.invisible.on) {
      for (r = 0; r < nRows; r++) {
        row = rows[r];
        for (c = 0; c < nCols; c++) {
          v = row[c];
          if (v === '' || !(RE_INVISIBLE.test(v) || v.indexOf('\t') >= 0)) continue;
          t = v.replace(RE_TAB_G, ' ').replace(RE_INVISIBLE_G, '');
          if (t !== v) setCell(r, c, t);
        }
      }
    }

    /* ---- 3 删除全空行 ---- */
    begin('emptyRows');
    if (rules.emptyRows.on) {
      for (r = 0; r < nRows; r++) {
        if (!rowAlive[r] || !isBlankRow(rows[r])) continue;
        rowAlive[r] = 0;
        removedEmpty++;
        removed.push({ row: r, reason: 'empty' });
      }
    }

    /* ---- 4 删除全空列 ---- */
    begin('emptyCols');
    if (rules.emptyCols.on) {
      for (c = 0; c < nCols; c++) {
        var empty = true;
        for (r = 0; r < nRows; r++) {
          if (rowAlive[r] && rows[r][c].trim() !== '') { empty = false; break; }
        }
        if (empty) { colAlive[c] = 0; removedCols.push(c); }
      }
    }

    /* ---- 5 整行去重，保留首次出现 ---- */
    begin('dedupe');
    if (rules.dedupe.on) {
      var seen = new Map();
      for (r = 0; r < nRows; r++) {
        if (!rowAlive[r]) continue;
        row = rows[r];
        var key = row.join('\u0000');
        var probe = key;
        var attempt = 0;
        var dup = -1;
        /* 用拼接串当键，命中后再逐格比对，避免单元格里正好有 \u0000 时误判 */
        while (seen.has(probe)) {
          var first = seen.get(probe);
          var other = rows[first];
          var same = true;
          for (c = 0; c < nCols; c++) {
            if (other[c] !== row[c]) { same = false; break; }
          }
          if (same) { dup = first; break; }
          probe = key + '\u0000' + (++attempt);
        }
        if (dup >= 0) {
          rowAlive[r] = 0;
          removedDup++;
          removed.push({ row: r, reason: 'duplicate', first: dup });
        } else {
          seen.set(probe, r);
        }
      }
    }

    /* ---- 6 表头规范化 ---- */
    begin('header');
    if (rules.header.on) {
      var aliveCols = [];
      for (c = 0; c < nCols; c++) if (colAlive[c]) aliveCols.push(c);
      var norm = normalizeHeaderNames(aliveCols.map(function (col) { return header[col]; }), rules.invisible.on);
      for (k = 0; k < aliveCols.length; k++) {
        var col = aliveCols[k];
        if (norm.names[k] === header[col]) continue;
        var beforeName = header[col];
        header[col] = norm.names[k];
        current.headers++;
        current.total++;
        if (current.changes.length < maxChanges) {
          current.changes.push({ row: -1, col: col, before: beforeName, after: norm.names[k] });
        }
      }
    }

    /* ---- 7 数字规范化 ---- */
    begin('number');
    if (rules.number.on) {
      var no = rules.number;
      for (r = 0; r < nRows; r++) {
        if (!rowAlive[r]) continue;
        row = rows[r];
        for (c = 0; c < nCols; c++) {
          if (!colAlive[c]) continue;
          v = row[c];
          if (v === '') continue;
          if (isNumberStart(v.charCodeAt(0))) t = normalizeNumber(v, no);
          else t = no.fullwidth ? halfWidthDigits(v) : v;    /* 不以数字开头的值：只做全角数字转半角 */
          if (t !== v) setCell(r, c, t);
        }
      }
    }

    /* ---- 8 日期规范化 ---- */
    begin('date');
    var dateInfo = { converted: 0, ambiguousResolved: 0 };
    if (rules.date.on) {
      var policy = rules.date.ambiguous;
      var hasCompact = new Uint8Array(nCols);
      for (r = 0; r < nRows; r++) {
        if (!rowAlive[r]) continue;
        row = rows[r];
        for (c = 0; c < nCols; c++) {
          if (colAlive[c] && !hasCompact[c] && isCompactDateShape(row[c])) hasCompact[c] = 1;
        }
      }
      /* 8 位纯数字只在这「一列基本都是日期的写法」时才按日期处理，否则当作编号 */
      var dateCol = new Uint8Array(nCols);
      for (c = 0; c < nCols; c++) {
        if (!hasCompact[c]) continue;
        var nonEmpty = 0;
        var dateLike = 0;
        for (r = 0; r < nRows; r++) {
          if (!rowAlive[r]) continue;
          var cell = rows[r][c];
          if (cell.trim() === '') continue;
          nonEmpty++;
          if (isDateLike(cell)) dateLike++;
        }
        dateCol[c] = nonEmpty > 0 && dateLike / nonEmpty >= DATE_COLUMN_RATIO ? 1 : 0;
      }
      for (r = 0; r < nRows; r++) {
        if (!rowAlive[r]) continue;
        row = rows[r];
        for (c = 0; c < nCols; c++) {
          if (!colAlive[c]) continue;
          v = row[c];
          if (v === '') continue;
          if (hasCompact[c] && isCompactDateShape(v) && !dateCol[c]) continue;   /* 当作编号：不动，也不报告 */
          var parsed = parseDateValue(v, policy);
          if (parsed == null) continue;
          if (parsed.ok) {
            t = parsed.iso + (parsed.time ? ' ' + parsed.time : '');
            if (t !== v && setCell(r, c, t)) {
              dateInfo.converted++;
              if (parsed.ambiguousResolved) dateInfo.ambiguousResolved++;
            }
          } else {
            addIssue(r, c, v, parsed.reason, parsed.message);
          }
        }
      }
      current.converted = dateInfo.converted;
      current.ambiguousResolved = dateInfo.ambiguousResolved;
    }

    /* ---- 9 空值填充 ---- */
    begin('fill');
    if (rules.fill.on) {
      var fillText = rules.fill.text;
      if (fillText.trim() === '') {
        ruleErrors.push(ruleError('fill', 'empty-fill',
          '空值填充没有执行',
          '「占位文本」是空的，没有内容可以填进空单元格。',
          '填写一个占位文本（默认是「（空）」），或者关闭「空值填充」。'));
      } else {
        for (r = 0; r < nRows; r++) {
          if (!rowAlive[r]) continue;
          row = rows[r];
          for (c = 0; c < nCols; c++) {
            if (colAlive[c] && row[c].trim() === '') setCell(r, c, fillText);
          }
        }
      }
    }

    /* ---- 10 查找替换 ---- */
    begin('replace');
    if (rules.replace.on) {
      var rp = rules.replace;
      var blocked = false;
      if (rp.find === '') {
        ruleErrors.push(ruleError('replace', 'empty-find',
          '查找替换没有执行',
          '「查找内容」是空的，没有可匹配的文本。',
          '填写要查找的内容，或者关闭「查找替换」。'));
        blocked = true;
      } else if (rp.scope === 'cols' && rp.cols.length === 0) {
        ruleErrors.push(ruleError('replace', 'no-columns',
          '查找替换没有执行',
          '作用范围选了「指定列」，但一列都没有勾选。',
          '至少勾选一列，或者把作用范围改回「全表」。'));
        blocked = true;
      }
      var re = null;
      if (!blocked && rp.regex) {
        var compiled = compileFind(rp.find, true);
        if (compiled.error) { ruleErrors.push(compiled.error); blocked = true; }
        else re = compiled.re;
      }
      if (!blocked) {
        var scope = null;
        if (rp.scope === 'cols') {
          scope = new Uint8Array(nCols);
          rp.cols.forEach(function (col) { if (col >= 0 && col < nCols) scope[col] = 1; });
        }
        for (r = 0; r < nRows; r++) {
          if (!rowAlive[r]) continue;
          row = rows[r];
          for (c = 0; c < nCols; c++) {
            if (!colAlive[c] || (scope && !scope[c])) continue;
            v = row[c];
            if (v === '') continue;
            t = re ? v.replace(re, rp.replacement) : (v.indexOf(rp.find) >= 0 ? v.split(rp.find).join(rp.replacement) : v);
            if (t !== v) setCell(r, c, t);
          }
        }
      }
    }

    /* ---- 11 英文大小写 ---- */
    begin('englishCase');
    if (rules.englishCase.on && rules.englishCase.mode !== 'none') {
      var mode = rules.englishCase.mode;
      for (r = 0; r < nRows; r++) {
        if (!rowAlive[r]) continue;
        row = rows[r];
        for (c = 0; c < nCols; c++) {
          if (!colAlive[c]) continue;
          v = row[c];
          if (v === '') continue;
          t = changeEnglishCase(v, mode);
          if (t !== v) setCell(r, c, t);
        }
      }
    }

    /* ---- 汇总：只看保留下来的行和列 ---- */
    var colMap = [];
    for (c = 0; c < nCols; c++) if (colAlive[c]) colMap.push(c);

    var outHeader = new Array(colMap.length);
    var headerChanged = new Uint8Array(colMap.length);
    var headerChangedCount = 0;
    for (k = 0; k < colMap.length; k++) {
      var oc = colMap[k];
      outHeader[k] = header[oc];
      if (outHeader[k] !== (srcHeader[oc] === undefined ? '' : srcHeader[oc])) {
        headerChanged[k] = 1;
        headerChangedCount++;
      }
    }

    var outRows = [];
    var rowMap = [];
    var cellChanged = [];
    var changedCells = 0;
    var changedRows = 0;
    for (r = 0; r < nRows; r++) {
      if (!rowAlive[r]) continue;
      row = rows[r];
      var srcRow = srcRows[r];
      var out = new Array(colMap.length);
      var marks = null;
      var flags = changed[r];
      for (k = 0; k < colMap.length; k++) {
        oc = colMap[k];
        out[k] = row[oc];
        /* 只有最终值确实和原始值不同的单元格才算「修改过」 */
        if (flags && flags[oc] && row[oc] !== (srcRow[oc] === undefined ? '' : srcRow[oc])) {
          if (!marks) marks = new Uint8Array(colMap.length);
          marks[k] = 1;
          changedCells++;
        }
      }
      cellChanged.push(marks);
      if (marks) changedRows++;
      rowMap.push(r);
      outRows.push(out);
    }

    removed.sort(function (a, b) { return a.row - b.row; });
    reports.emptyRows.removedRows = removedEmpty;
    reports.emptyRows.rows = removedEmpty;
    reports.emptyRows.total = removedEmpty;
    reports.emptyCols.removedCols = removedCols.length;
    reports.emptyCols.total = removedCols.length;
    reports.dedupe.removedRows = removedDup;
    reports.dedupe.rows = removedDup;
    reports.dedupe.total = removedDup;
    reports.header.cells = reports.header.headers;

    return {
      header: outHeader,
      rows: outRows,
      colMap: colMap,
      rowMap: rowMap,
      cellChanged: cellChanged,
      headerChanged: headerChanged,
      removed: removed,
      removedCols: removedCols,
      stats: {
        originalRows: nRows,
        finalRows: rowMap.length,
        removedRows: nRows - rowMap.length,
        removedDuplicates: removedDup,
        removedEmpty: removedEmpty,
        changedCells: changedCells,
        changedRows: changedRows,
        originalCols: srcHeader.length,
        finalCols: colMap.length,
        removedCols: removedCols.length,
        headerChanged: headerChangedCount
      },
      rules: RULE_IDS.map(function (id) { return reports[id]; }),
      ruleErrors: ruleErrors,
      dateIssues: { total: issueTotal, byReason: issueByReason, items: issues }
    };
  }

  /* ==========================================================================
     7. 列概况与类型推断
     ========================================================================== */

  var RE_INT = /^[+\-]?\d+$/;
  var RE_GROUPED_NUM = /^[+\-]?\d{1,3}(?:,\d{3})+(?:\.\d*)?$/;
  var RE_DEC = /^[+\-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+\-]?\d+)?$/;
  var RE_PCT = /^([+\-]?\d+(?:\.\d+)?)\s*[%％]$/;
  var RE_SIGN = /^[+\-]/;

  /* 是/否、true/false、1/0 这几种取值归一成记号；其余返回 null */
  function booleanToken(s) {
    if (s === '1') return '1';
    if (s === '0') return '0';
    if (s === '是') return 'Y';
    if (s === '否') return 'N';
    if (s.length <= 5) {
      var low = s.toLowerCase();
      if (low === 'true') return 'T';
      if (low === 'false') return 'F';
    }
    return null;
  }

  /* 一列的取值是否全部落在某一对里；1/0 这一对要求两种都出现，否则它就是普通的整数列。
   * 取值里只要有不属于这几对的（记号是 X），就不是布尔列 */
  function isBooleanSet(set) {
    if (set.size === 0 || set.has('X')) return false;
    var tokens = Array.from(set);
    function only(x, y) {
      return tokens.every(function (tok) { return tok === x || tok === y; });
    }
    if (only('T', 'F') || only('Y', 'N')) return true;
    return only('1', '0') && set.size === 2;
  }

  function numericValue(s) {
    var t = RE_GROUPED_NUM.test(s) ? s.replace(/,/g, '') : s;
    return RE_DEC.test(t) ? +t : null;
  }

  /**
   * 单个值的类型（不含「布尔」和「空」，这两个要在整列上判断）。
   * 以 0 开头且不止一位的整数（0012345）当作文本，它是编号而不是数值。
   */
  function valueType(s) {
    if (RE_INT.test(s)) return RE_LEADING_ZERO.test(s.replace(RE_SIGN, '')) ? 'text' : 'integer';
    var d = parseDateValue(s, 'keep');
    if (d && (d.ok || d.reason === 'ambiguous')) return 'date';
    if (RE_PCT.test(s)) return 'percent';
    if (RE_CURRENCY.test(s)) {
      /* 去掉货币符号后，剩下的要是数字（可以带千分位） */
      var stripped = s.replace(RE_CURRENCY_G, '').trim();
      if (RE_DEC.test(stripped) || RE_GROUPED_NUM.test(stripped)) return 'currency';
    }
    if (RE_GROUPED_NUM.test(s)) return RE_INT.test(s.replace(/,/g, '')) ? 'integer' : 'decimal';
    if (RE_DEC.test(s)) return 'decimal';
    return 'text';
  }

  /* 比较最小值、最大值用的键：数值列返回数字，日期列返回可直接比较的字符串，其余返回 null */
  function sortKey(s, type) {
    if (type === 'integer' || type === 'decimal') return numericValue(s);
    if (type === 'currency') return numericValue(s.replace(RE_CURRENCY_G, '').trim());
    if (type === 'percent') return +RE_PCT.exec(s)[1];
    if (type === 'date') {
      var d = parseDateValue(s, 'keep');
      return d && d.ok ? d.iso + ' ' + d.time : null;
    }
    return null;
  }

  /* 非空值中至少 TYPE_RATIO 能解析成某类型，就认定为该类型 */
  function decideType(counts, nonEmpty, bools) {
    if (nonEmpty === 0) return 'empty';
    if (isBooleanSet(bools)) return 'boolean';
    function most(n) { return n / nonEmpty >= TYPE_RATIO; }
    if (most(counts.date)) return 'date';
    if (most(counts.percent)) return 'percent';
    if (most(counts.currency)) return 'currency';
    var numeric = counts.integer + counts.decimal;
    if (most(numeric)) return counts.decimal === 0 ? 'integer' : 'decimal';
    return 'text';
  }

  /* 最小值、最大值按这个键分开累计，最后只取和整列类型一致的那一组，
   * 免得文本列里恰好有几个像数字的值，就拿这几个算出一个误导人的范围 */
  function rangeKey(type) {
    return type === 'integer' || type === 'decimal' ? 'numeric' : type;
  }

  function newAcc() {
    return {
      total: 0, missing: 0, nonEmpty: 0,
      counts: { date: 0, percent: 0, currency: 0, integer: 0, decimal: 0, text: 0 },
      distinct: new Set(), samples: [], bools: new Set(),
      ranges: {}
    };
  }

  function accPush(acc, value) {
    acc.total++;
    var s = value == null ? '' : value.trim();
    if (s === '') { acc.missing++; return; }
    acc.nonEmpty++;
    if (!acc.distinct.has(s)) {
      acc.distinct.add(s);
      if (acc.samples.length < 3) acc.samples.push(s);
    }
    acc.bools.add(booleanToken(s) || 'X');
    var type = valueType(s);
    acc.counts[type]++;
    var key = sortKey(s, type);
    if (key === null) return;
    var range = acc.ranges[rangeKey(type)];
    if (!range) range = acc.ranges[rangeKey(type)] = { minKey: null, maxKey: null, minRaw: '', maxRaw: '' };
    if (range.minKey === null || key < range.minKey) { range.minKey = key; range.minRaw = s; }
    if (range.maxKey === null || key > range.maxKey) { range.maxKey = key; range.maxRaw = s; }
  }

  function finishAcc(acc) {
    var type = decideType(acc.counts, acc.nonEmpty, acc.bools);
    var range = acc.ranges[rangeKey(type)] || null;
    return {
      type: type,
      total: acc.total,
      nonEmpty: acc.nonEmpty,
      missing: acc.missing,
      missingRate: acc.total ? acc.missing / acc.total : 0,
      unique: acc.distinct.size,
      samples: acc.samples,
      min: range ? range.minRaw : null,
      max: range ? range.maxRaw : null
    };
  }

  /** 一列值的完整概况，字段和 profileColumns 返回的每一项相同（不含 name、index） */
  function profileColumn(values) {
    var acc = newAcc();
    for (var i = 0; i < values.length; i++) accPush(acc, values[i]);
    return finishAcc(acc);
  }

  /** 一列值的类型：integer / decimal / date / percent / currency / boolean / text / empty */
  function inferType(values) {
    return profileColumn(values).type;
  }

  /**
   * 每一列的概况：类型、缺失数与缺失率、唯一值数、最小值与最大值（数值、日期列才有）、3 个示例值。
   * min、max、samples 里放的是原来的写法，不做改写。
   */
  function profileColumns(header, rows) {
    var n = header.length;
    var accs = [];
    var c;
    for (c = 0; c < n; c++) accs.push(newAcc());
    for (var r = 0; r < rows.length; r++) {
      var row = rows[r];
      for (c = 0; c < n; c++) accPush(accs[c], row[c]);
    }
    return accs.map(function (acc, i) {
      var p = finishAcc(acc);
      p.index = i;
      p.name = header[i];
      return p;
    });
  }

  /* ==========================================================================
     8. 导出格式化
     ========================================================================== */

  /**
   * 单元格转成 CSV / TSV 字段。CSV 按 RFC 4180：含分隔符、双引号、换行时用双引号包住，
   * 里面的双引号写成两个。TSV 没有转义约定（引号就是引号本身），所以不加引号，
   * 只把单元格里的制表符和换行替换成空格，否则会把行列结构撑乱。
   */
  function csvField(value, delimiter, flatten) {
    var s = value == null ? '' : String(value);
    if (flatten) return s.replace(/[\t\r\n]+/g, ' ');
    if (s.indexOf(delimiter) < 0 && s.indexOf('"') < 0 && s.indexOf('\n') < 0 && s.indexOf('\r') < 0) return s;
    return '"' + s.replace(/"/g, '""') + '"';
  }

  /* rows 里每一行（包括表头行）都要由调用方给好。行尾统一用 CRLF，文件以换行结尾 */
  function formatDelimited(rows, delimiter, options) {
    options = options || {};
    var eol = options.eol || '\r\n';
    var flatten = delimiter === '\t';
    var lines = new Array(rows.length);
    for (var r = 0; r < rows.length; r++) {
      var row = rows[r];
      var cells = new Array(row.length);
      for (var c = 0; c < row.length; c++) cells[c] = csvField(row[c], delimiter, flatten);
      lines[r] = cells.join(delimiter);
    }
    return lines.length ? lines.join(eol) + eol : '';
  }

  function formatCsv(rows, options) { return formatDelimited(rows, ',', options); }
  function formatTsv(rows, options) { return formatDelimited(rows, '\t', options); }

  /**
   * JSON：对象数组，每个对象一行。所有值按文本导出，不做类型转换。
   * 重名的列会把键名加序号（和表头规范化同一套规则），避免对象键互相覆盖。
   */
  function formatJson(header, rows) {
    var keys = normalizeHeaderNames(header, false).names;
    var lines = new Array(rows.length);
    for (var r = 0; r < rows.length; r++) {
      var row = rows[r];
      var obj = {};
      for (var c = 0; c < keys.length; c++) obj[keys[c]] = row[c] == null ? '' : String(row[c]);
      lines[r] = JSON.stringify(obj);
    }
    return lines.length ? '[\n' + lines.join(',\n') + '\n]\n' : '[]\n';
  }

  /* ==========================================================================
     9. 编码与解码
     ========================================================================== */

  var EXPORT_ENCODINGS = [
    { id: 'utf-8', label: 'UTF-8', note: '通用' },
    { id: 'utf-8-bom', label: 'UTF-8 带 BOM', note: 'Excel 直接打开不乱码' },
    { id: 'gb18030', label: 'GB18030', note: '旧版 Excel' }
  ];

  function encodingLabel(id) {
    for (var i = 0; i < EXPORT_ENCODINGS.length; i++) if (EXPORT_ENCODINGS[i].id === id) return EXPORT_ENCODINGS[i].label;
    return id;
  }

  function ioError(code, title, reason, fix) {
    var err = new Error(title);
    err.code = code;
    err.title = title;
    err.reason = reason;
    err.fix = fix;
    return err;
  }

  function countChar(text, ch) {
    var n = 0;
    var i = text.indexOf(ch);
    while (i >= 0) { n++; i = text.indexOf(ch, i + 1); }
    return n;
  }

  /**
   * 把文件字节解码成文本。顺序：
   *   1. 开头是 FF FE 或 FE FF：按 UTF-16 解码（BOM 已经说明了字节序）
   *   2. 按 UTF-8 严格解码
   *   3. 失败则按 GB18030 解码（国内 Excel 导出的 CSV 常是 GBK，GB18030 向下兼容）
   *
   * 返回 { text, encoding, bom, replaced, bytes }
   *   encoding: 'utf-8' | 'gb18030' | 'utf-16le' | 'utf-16be'
   *   replaced: 按 GB18030 解码时无法识别、被替换成 U+FFFD 的字符数。大于 0 说明文件可能根本不是 GBK
   * 环境不支持 TextDecoder 或 gb18030 时抛出带 code 的错误。
   */
  function decodeBytes(input) {
    if (typeof TextDecoder !== 'function') {
      throw ioError('no-textdecoder', '当前浏览器不支持文件解码',
        '这个浏览器没有 TextDecoder，读不了上传的文件。',
        '换用新版 Chrome、Edge、Firefox 或 Safari，或者把文件内容粘贴进来。');
    }
    var bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    var result = { text: '', encoding: 'utf-8', bom: false, replaced: 0, bytes: bytes.length };
    var text;

    if (bytes.length >= 2 && ((bytes[0] === 0xFF && bytes[1] === 0xFE) || (bytes[0] === 0xFE && bytes[1] === 0xFF))) {
      var little = bytes[0] === 0xFF;
      result.encoding = little ? 'utf-16le' : 'utf-16be';
      result.bom = true;
      text = new TextDecoder(result.encoding).decode(bytes.subarray(2));
      result.replaced = countChar(text, '\uFFFD');
      if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
      result.text = text;
      return result;
    }

    if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) result.bom = true;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      result.encoding = 'utf-8';
    } catch (err) {
      var gb;
      try {
        gb = new TextDecoder('gb18030');
      } catch (err2) {
        throw ioError('gb18030-unsupported', '无法按 GB18030 解码这个文件',
          '这个文件不是 UTF-8 编码，而当前浏览器不支持 GB18030 解码。',
          '换用新版 Chrome、Edge、Firefox 或 Safari，或者先把文件另存为 UTF-8 编码的 CSV。');
      }
      text = gb.decode(bytes);
      result.encoding = 'gb18030';
      result.bom = false;
      result.replaced = countChar(text, '\uFFFD');
    }
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    result.text = text;
    return result;
  }

  /**
   * 把文本编码成字节。encoding：'utf-8' | 'utf-8-bom' | 'gb18030'。
   * GB18030 靠下面自带的编码表（浏览器的 TextEncoder 只会输出 UTF-8）。
   */
  function encodeText(text, encoding) {
    var s = text == null ? '' : String(text);
    if (encoding === 'gb18030') return gb18030Encode(s);
    var body = new TextEncoder().encode(s);
    if (encoding !== 'utf-8-bom') {
      if (encoding !== 'utf-8') throw new Error('不支持的编码：' + encoding);
      return body;
    }
    var out = new Uint8Array(body.length + 3);
    out[0] = 0xEF;
    out[1] = 0xBB;
    out[2] = 0xBF;
    out.set(body, 3);
    return out;
  }

  /* --------------------------------------------------------------------------
     GB18030 编码器
     按 WHATWG 编码标准 10.2.2 的步骤实现，这样导出的字节在各大软件里都能被正确读回：
       1. ASCII 原样输出
       2. U+E5E5 无法编码，写成 ?
       3. 附表里的 18 个私用区码点输出两字节（兼容 GB18030-2005 的旧内容）
       4. 两字节表里有的，取第一个指针，输出两字节（欧元符号在这里是 A2 E3，所有解码器都认）
       5. 其余按线性区间反查指针，输出四字节
     剩下无法编码的只有孤立的代理项，同样写成 ?。
     -------------------------------------------------------------------------- */
  /* @@GB18030-TABLE:BEGIN */
  /* 以下三段数据由 tools/gen-gb18030-table.js 生成，请勿手改；要更新请重新运行那个脚本。
   * GB18030_DECODE_B64：两字节区的 23,940 个码点，按 UTF-16BE 编码后再 base64。
   *   第 p 个码点对应字节 [0x81 + floor(p / 190), (p % 190) + (p % 190 < 0x3F ? 0x40 : 0x41)]。
   *   SHA-256（UTF-16BE 字节）：cff50468440b4654167396762719ddd62c927582eeed3623f3d6f11793096410
   * GB18030_RANGES：四字节区的线性区间，每两个数是一组 [起点码点, 起点指针]，共 209 组。
   * GB18030_SIDE：编码器附表，私用区码点 → 两字节（WHATWG 10.2.2 原文的 18 行）。 */
  var GB18030_DECODE_B64 =
    "TgJOBE4FTgZOD04SThdOH04gTiFOI04mTilOLk4vTjFOM041TjdOPE5ATkFOQk5ETkZOSk5RTlVOV05aTltOYk5jTmROZU5nTmhOak5rTmxObU5uTm9Ock50" +
    "TnVOdk53TnhOeU56TntOfE59Tn9OgE6BToJOg06EToVOh06KTpBOlk6XTplOnE6dTp5Oo06qTq9OsE6xTrROtk63TrhOuU68Tr1Ovk7ITsxOz07QTtJO2k7b" +
    "TtxO4E7iTuZO507pTu1O7k7vTvFO9E74TvlO+k78Tv5PAE8CTwNPBE8FTwZPB08ITwtPDE8STxNPFE8VTxZPHE8dTyFPI08oTylPLE8tTy5PMU8zTzVPN085" +
    "TztPPk8/T0BPQU9CT0RPRU9HT0hPSU9KT0tPTE9ST1RPVk9hT2JPZk9oT2pPa09tT25PcU9yT3VPd094T3lPek99T4BPgU+CT4VPhk+HT4pPjE+OT5BPkk+T" +
    "T5VPlk+YT5lPmk+cT55Pn0+hT6JPpE+rT61PsE+xT7JPs0+0T7ZPt0+4T7lPuk+7T7xPvU++T8BPwU/CT8ZPx0/IT8lPy0/MT81P0k/TT9RP1U/WT9lP20/g" +
    "T+JP5E/lT+dP60/sT/BP8k/0T/VP9k/3T/lP+0/8T/1P/1AAUAFQAlADUARQBVAGUAdQCFAJUApQC1AOUBBQEVATUBVQFlAXUBtQHVAeUCBQIlAjUCRQJ1Ar" +
    "UC9QMFAxUDJQM1A0UDVQNlA3UDhQOVA7UD1QP1BAUEFQQlBEUEVQRlBJUEpQS1BNUFBQUVBSUFNQVFBWUFdQWFBZUFtQXVBeUF9QYFBhUGJQY1BkUGZQZ1Bo" +
    "UGlQalBrUG1QblBvUHBQcVByUHNQdFB1UHhQeVB6UHxQfVCBUIJQg1CEUIZQh1CJUIpQi1CMUI5Qj1CQUJFQklCTUJRQlVCWUJdQmFCZUJpQm1CcUJ1QnlCf" +
    "UKBQoVCiUKRQplCqUKtQrVCuUK9QsFCxULNQtFC1ULZQt1C4ULlQvFC9UL5Qv1DAUMFQwlDDUMRQxVDGUMdQyFDJUMpQy1DMUM1QzlDQUNFQ0lDTUNRQ1VDX" +
    "UNhQ2VDbUNxQ3VDeUN9Q4FDhUOJQ41DkUOVQ6FDpUOpQ61DvUPBQ8VDyUPRQ9lD3UPhQ+VD6UPxQ/VD+UP9RAFEBUQJRA1EEUQVRCFEJUQpRDFENUQ5RD1EQ" +
    "URFRE1EUURVRFlEXURhRGVEaURtRHFEdUR5RH1EgUSJRI1EkUSVRJlEnUShRKVEqUStRLFEtUS5RL1EwUTFRMlEzUTRRNVE2UTdROFE5UTpRO1E8UT1RPlFC" +
    "UUdRSlFMUU5RT1FQUVJRU1FXUVhRWVFbUV1RXlFfUWBRYVFjUWRRZlFnUWlRalFvUXJRelF+UX9Rg1GEUYZRh1GKUYtRjlGPUZBRkVGTUZRRmFGaUZ1RnlGf" +
    "UaFRo1GmUadRqFGpUapRrVGuUbRRuFG5UbpRvlG/UcFRwlHDUcVRyFHKUc1RzlHQUdJR01HUUdVR1lHXUdhR2VHaUdxR3lHfUeJR41HlUeZR51HoUelR6lHs" +
    "Ue5R8VHyUfRR91H+UgRSBVIJUgtSDFIPUhBSE1IUUhVSHFIeUh9SIVIiUiNSJVImUidSKlIsUi9SMVIyUjRSNVI8Uj5SRFJFUkZSR1JIUklSS1JOUk9SUlJT" +
    "UlVSV1JYUllSWlJbUl1SX1JgUmJSY1JkUmZSaFJrUmxSbVJuUnBScVJzUnRSdVJ2UndSeFJ5UnpSe1J8Un5SgFKDUoRShVKGUodSiVKKUotSjFKNUo5Sj1KR" +
    "UpJSlFKVUpZSl1KYUplSmlKcUqRSpVKmUqdSrlKvUrBStFK1UrZSt1K4UrlSulK7UrxSvVLAUsFSwlLEUsVSxlLIUspSzFLNUs5Sz1LRUtNS1FLVUtdS2VLa" +
    "UttS3FLdUt5S4FLhUuJS41LlUuZS51LoUulS6lLrUuxS7VLuUu9S8VLyUvNS9FL1UvZS91L4UvtS/FL9UwFTAlMDUwRTB1MJUwpTC1MMUw5TEVMSUxNTFFMY" +
    "UxtTHFMeUx9TIlMkUyVTJ1MoUylTK1MsUy1TL1MwUzFTMlMzUzRTNVM2UzdTOFM8Uz1TQFNCU0RTRlNLU0xTTVNQU1RTWFNZU1tTXVNlU2hTalNsU21TclN2" +
    "U3lTe1N8U31TflOAU4FTg1OHU4hTilOOU49TkFORU5JTk1OUU5ZTl1OZU5tTnFOeU6BToVOkU6dTqlOrU6xTrVOvU7BTsVOyU7NTtFO1U7dTuFO5U7pTvFO9" +
    "U75TwFPDU8RTxVPGU8dTzlPPU9BT0lPTU9VT2lPcU91T3lPhU+JT51P0U/pT/lP/VABUAlQFVAdUC1QUVBhUGVQaVBxUIlQkVCVUKlQwVDNUNlQ3VDpUPVQ/" +
    "VEFUQlREVEVUR1RJVExUTVROVE9UUVRaVF1UXlRfVGBUYVRjVGVUZ1RpVGpUa1RsVG1UblRvVHBUdFR5VHpUflR/VIFUg1SFVIdUiFSJVIpUjVSRVJNUl1SY" +
    "VJxUnlSfVKBUoVSiVKVUrlSwVLJUtVS2VLdUuVS6VLxUvlTDVMVUylTLVNZU2FTbVOBU4VTiVONU5FTrVOxU71TwVPFU9FT1VPZU91T4VPlU+1T+VQBVAlUD" +
    "VQRVBVUIVQpVC1UMVQ1VDlUSVRNVFVUWVRdVGFUZVRpVHFUdVR5VH1UhVSVVJlUoVSlVK1UtVTJVNFU1VTZVOFU5VTpVO1U9VUBVQlVFVUdVSFVLVUxVTVVO" +
    "VU9VUVVSVVNVVFVXVVhVWVVaVVtVXVVeVV9VYFViVWNVaFVpVWtVb1VwVXFVclVzVXRVeVV6VX1Vf1WFVYZVjFWNVY5VkFWSVZNVlVWWVZdVmlWbVZ5VoFWh" +
    "VaJVo1WkVaVVplWoValVqlWrVaxVrVWuVa9VsFWyVbRVtlW4VbpVvFW/VcBVwVXCVcNVxlXHVchVylXLVc5Vz1XQVdVV11XYVdlV2lXbVd5V4FXiVedV6VXt" +
    "Ve5V8FXxVfRV9lX4VflV+lX7VfxV/1YCVgNWBFYFVgZWB1YKVgtWDVYQVhFWElYTVhRWFVYWVhdWGVYaVhxWHVYgViFWIlYlViZWKFYpVipWK1YuVi9WMFYz" +
    "VjVWN1Y4VjpWPFY9Vj5WQFZBVkJWQ1ZEVkVWRlZHVkhWSVZKVktWT1ZQVlFWUlZTVlVWVlZaVltWXVZeVl9WYFZhVmNWZVZmVmdWbVZuVm9WcFZyVnNWdFZ1" +
    "VndWeFZ5VnpWfVZ+Vn9WgFaBVoJWg1aEVodWiFaJVopWi1aMVo1WkFaRVpJWlFaVVpZWl1aYVplWmlabVpxWnVaeVp9WoFahVqJWpFalVqZWp1aoVqlWqlar" +
    "VqxWrVauVrBWsVayVrNWtFa1VrZWuFa5VrpWu1a9Vr5Wv1bAVsFWwlbDVsRWxVbGVsdWyFbJVstWzFbNVs5Wz1bQVtFW0lbTVtVW1lbYVtlW3FbjVuVW5lbn" +
    "VuhW6VbqVuxW7lbvVvJW81b2VvdW+Fb7VvxXAFcBVwJXBVcHVwtXDFcNVw5XD1cQVxFXElcTVxRXFVcWVxdXGFcZVxpXG1cdVx5XIFchVyJXJFclVyZXJ1cr" +
    "VzFXMlc0VzVXNlc3VzhXPFc9Vz9XQVdDV0RXRVdGV0hXSVdLV1JXU1dUV1VXVldYV1lXYldjV2VXZ1dsV25XcFdxV3JXdFd1V3hXeVd6V31Xfld/V4BXgVeH" +
    "V4hXiVeKV41XjlePV5BXkVeUV5VXlleXV5hXmVeaV5xXnVeeV59XpVeoV6pXrFevV7BXsVezV7VXtle3V7lXule7V7xXvVe+V79XwFfBV8RXxVfGV8dXyFfJ" +
    "V8pXzFfNV9BX0VfTV9ZX11fbV9xX3lfhV+JX41flV+ZX51foV+lX6lfrV+xX7lfwV/FX8lfzV/VX9lf3V/tX/Ff+V/9YAVgDWARYBVgIWAlYClgMWA5YD1gQ" +
    "WBJYE1gUWBZYF1gYWBpYG1gcWB1YH1giWCNYJVgmWCdYKFgpWCtYLFgtWC5YL1gxWDJYM1g0WDZYN1g4WDlYOlg7WDxYPVg+WD9YQFhBWEJYQ1hFWEZYR1hI" +
    "WElYSlhLWE5YT1hQWFJYU1hVWFZYV1hZWFpYW1hcWF1YX1hgWGFYYlhjWGRYZlhnWGhYaVhqWG1YblhvWHBYcVhyWHNYdFh1WHZYd1h4WHlYelh7WHxYfVh/" +
    "WIJYhFiGWIdYiFiKWItYjFiNWI5Yj1iQWJFYlFiVWJZYl1iYWJtYnFidWKBYoViiWKNYpFilWKZYp1iqWKtYrFitWK5Yr1iwWLFYslizWLRYtVi2WLdYuFi5" +
    "WLpYu1i9WL5Yv1jAWMJYw1jEWMZYx1jIWMlYyljLWMxYzVjOWM9Y0FjSWNNY1FjWWNdY2FjZWNpY21jcWN1Y3ljfWOBY4VjiWONY5VjmWOdY6FjpWOpY7Vjv" +
    "WPFY8lj0WPVY91j4WPpY+1j8WP1Y/lj/WQBZAVkDWQVZBlkIWQlZClkLWQxZDlkQWRFZElkTWRdZGFkbWR1ZHlkgWSFZIlkjWSZZKFksWTBZMlkzWTVZNlk7" +
    "WT1ZPlk/WUBZQ1lFWUZZSllMWU1ZUFlSWVNZWVlbWVxZXVleWV9ZYVljWWRZZllnWWhZaVlqWWtZbFltWW5Zb1lwWXFZcll1WXdZell7WXxZfll/WYBZhVmJ" +
    "WYtZjFmOWY9ZkFmRWZRZlVmYWZpZm1mcWZ1Zn1mgWaFZolmmWadZrFmtWbBZsVmzWbRZtVm2WbdZuFm6WbxZvVm/WcBZwVnCWcNZxFnFWcdZyFnJWcxZzVnO" +
    "Wc9Z1VnWWdlZ21neWd9Z4FnhWeJZ5FnmWedZ6VnqWetZ7VnuWe9Z8FnxWfJZ81n0WfVZ9ln3WfhZ+ln8Wf1Z/loAWgJaCloLWg1aDloPWhBaEloUWhVaFloX" +
    "WhlaGlobWh1aHlohWiJaJFomWidaKFoqWitaLFotWi5aL1owWjNaNVo3WjhaOVo6WjtaPVo+Wj9aQVpCWkNaRFpFWkdaSFpLWkxaTVpOWk9aUFpRWlJaU1pU" +
    "WlZaV1pYWllaW1pcWl1aXlpfWmBaYVpjWmRaZVpmWmhaaVprWmxabVpuWm9acFpxWnJac1p4Wnlae1p8Wn1aflqAWoFaglqDWoRahVqGWodaiFqJWopai1qM" +
    "Wo1ajlqPWpBakVqTWpRalVqWWpdamFqZWpxanVqeWp9aoFqhWqJao1qkWqVaplqnWqhaqVqrWqxarVquWq9asFqxWrRatlq3Wrlaulq7WrxavVq/WsBaw1rE" +
    "WsVaxlrHWshaylrLWs1azlrPWtBa0VrTWtVa11rZWtpa21rdWt5a31riWuRa5VrnWuha6lrsWu1a7lrvWvBa8lrzWvRa9Vr2Wvda+Fr5Wvpa+1r8Wv1a/lr/" +
    "WwBbAVsCWwNbBFsFWwZbB1sIWwpbC1sMWw1bDlsPWxBbEVsSWxNbFFsVWxhbGVsaWxtbHFsdWx5bH1sgWyFbIlsjWyRbJVsmWydbKFspWypbK1ssWy1bLlsv" +
    "WzBbMVszWzVbNls4WzlbOls7WzxbPVs+Wz9bQVtCW0NbRFtFW0ZbR1tIW0lbSltLW0xbTVtOW09bUltWW15bYFthW2dbaFtrW21bbltvW3JbdFt2W3dbeFt5" +
    "W3tbfFt+W39bgluGW4pbjVuOW5BbkVuSW5RbllufW6dbqFupW6xbrVuuW69bsVuyW7dbulu7W7xbwFvBW8NbyFvJW8pby1vNW85bz1vRW9Rb1VvWW9db2FvZ" +
    "W9pb21vcW+Bb4lvjW+Zb51vpW+pb61vsW+1b71vxW/Jb81v0W/Vb9lv3W/1b/lwAXAJcA1wFXAdcCFwLXAxcDVwOXBBcElwTXBdcGVwbXB5cH1wgXCFcI1wm" +
    "XChcKVwqXCtcLVwuXC9cMFwyXDNcNVw2XDdcQ1xEXEZcR1xMXE1cUlxTXFRcVlxXXFhcWlxbXFxcXVxfXGJcZFxnXGhcaVxqXGtcbFxtXHBcclxzXHRcdVx2" +
    "XHdceFx7XHxcfVx+XIBcg1yEXIVchlyHXIlcilyLXI5cj1ySXJNclVydXJ5cn1ygXKFcpFylXKZcp1yoXKpcrlyvXLBcsly0XLZcuVy6XLtcvFy+XMBcwlzD" +
    "XMVcxlzHXMhcyVzKXMxczVzOXM9c0FzRXNNc1FzVXNZc11zYXNpc21zcXN1c3lzfXOBc4lzjXOdc6VzrXOxc7lzvXPFc8lzzXPRc9Vz2XPdc+Fz5XPpc/Fz9" +
    "XP5c/10AXQFdBF0FXQhdCV0KXQtdDF0NXQ9dEF0RXRJdE10VXRddGF0ZXRpdHF0dXR9dIF0hXSJdI10lXShdKl0rXSxdL10wXTFdMl0zXTVdNl03XThdOV06" +
    "XTtdPF0/XUBdQV1CXUNdRF1FXUZdSF1JXU1dTl1PXVBdUV1SXVNdVF1VXVZdV11ZXVpdXF1eXV9dYF1hXWJdY11kXWVdZl1nXWhdal1tXW5dcF1xXXJdc111" +
    "XXZdd114XXldel17XXxdfV1+XX9dgF2BXYNdhF2FXYZdh12IXYldil2LXYxdjV2OXY9dkF2RXZJdk12UXZVdll2XXZhdml2bXZxdnl2fXaBdoV2iXaNdpF2l" +
    "XaZdp12oXaldql2rXaxdrV2uXa9dsF2xXbJds120XbVdtl24Xbldul27XbxdvV2+Xb9dwF3BXcJdw13EXcZdx13IXcldyl3LXcxdzl3PXdBd0V3SXdNd1F3V" +
    "XdZd113YXdld2l3cXd9d4F3jXeRd6l3sXe1d8F31XfZd+F35Xfpd+138Xf9eAF4EXgdeCV4KXgteDV4OXhJeE14XXh5eH14gXiFeIl4jXiReJV4oXileKl4r" +
    "XixeL14wXjJeM140XjVeNl45XjpePl4/XkBeQV5DXkZeR15IXkleSl5LXk1eTl5PXlBeUV5SXlNeVl5XXlheWV5aXlxeXV5fXmBeY15kXmVeZl5nXmheaV5q" +
    "XmtebF5tXm5eb15wXnFedV53Xnlefl6BXoJeg16FXoheiV6MXo1ejl6SXphem16dXqFeol6jXqReqF6pXqpeq16sXq5er16wXrFesl60Xrpeu168Xr1ev17A" +
    "XsFewl7DXsRexV7GXsdeyF7LXsxezV7OXs9e0F7UXtVe117YXtle2l7cXt1e3l7fXuBe4V7iXuNe5F7lXuZe517pXute7F7tXu5e717wXvFe8l7zXvVe+F75" +
    "Xvte/F79XwVfBl8HXwlfDF8NXw5fEF8SXxRfFl8ZXxpfHF8dXx5fIV8iXyNfJF8oXytfLF8uXzBfMl8zXzRfNV82XzdfOF87Xz1fPl8/X0FfQl9DX0RfRV9G" +
    "X0dfSF9JX0pfS19MX01fTl9PX1FfVF9ZX1pfW19cX15fX19gX2NfZV9nX2hfa19uX29fcl90X3Vfdl94X3pffV9+X39fg1+GX41fjl+PX5Ffk1+UX5Zfml+b" +
    "X51fnl+fX6Bfol+jX6RfpV+mX6dfqV+rX6xfr1+wX7Ffsl+zX7Rftl+4X7lful+7X75fv1/AX8Ffwl/HX8hfyl/LX85f01/UX9Vf2l/bX9xf3l/fX+Jf41/l" +
    "X+Zf6F/pX+xf71/wX/Jf81/0X/Zf91/5X/pf/GAHYAhgCWALYAxgEGARYBNgF2AYYBpgHmAfYCJgI2AkYCxgLWAuYDBgMWAyYDNgNGA2YDdgOGA5YDpgPWA+" +
    "YEBgRGBFYEZgR2BIYElgSmBMYE5gT2BRYFNgVGBWYFdgWGBbYFxgXmBfYGBgYWBlYGZgbmBxYHJgdGB1YHdgfmCAYIFggmCFYIZgh2CIYIpgi2COYI9gkGCR" +
    "YJNglWCXYJhgmWCcYJ5goWCiYKRgpWCnYKlgqmCuYLBgs2C1YLZgt2C5YLpgvWC+YL9gwGDBYMJgw2DEYMdgyGDJYMxgzWDOYM9g0GDSYNNg1GDWYNdg2WDb" +
    "YN5g4WDiYONg5GDlYOpg8WDyYPVg92D4YPtg/GD9YP5g/2ECYQNhBGEFYQdhCmELYQxhEGERYRJhE2EUYRZhF2EYYRlhG2EcYR1hHmEhYSJhJWEoYSlhKmEs" +
    "YS1hLmEvYTBhMWEyYTNhNGE1YTZhN2E4YTlhOmE7YTxhPWE+YUBhQWFCYUNhRGFFYUZhR2FJYUthTWFPYVBhUmFTYVRhVmFXYVhhWWFaYVthXGFeYV9hYGFh" +
    "YWNhZGFlYWZhaWFqYWthbGFtYW5hb2FxYXJhc2F0YXZheGF5YXphe2F8YX1hfmF/YYBhgWGCYYNhhGGFYYZhh2GIYYlhimGMYY1hj2GQYZFhkmGTYZVhlmGX" +
    "YZhhmWGaYZthnGGeYZ9hoGGhYaJho2GkYaVhpmGqYathrWGuYa9hsGGxYbJhs2G0YbVhtmG4YblhumG7YbxhvWG/YcBhwWHDYcRhxWHGYcdhyWHMYc1hzmHP" +
    "YdBh02HVYdZh12HYYdlh2mHbYdxh3WHeYd9h4GHhYeJh42HkYeVh52HoYelh6mHrYexh7WHuYe9h8GHxYfJh82H0YfZh92H4Yflh+mH7Yfxh/WH+YgBiAWIC" +
    "YgNiBGIFYgdiCWITYhRiGWIcYh1iHmIgYiNiJmInYihiKWIrYi1iL2IwYjFiMmI1YjZiOGI5YjpiO2I8YkJiRGJFYkZiSmJPYlBiVWJWYldiWWJaYlxiXWJe" +
    "Yl9iYGJhYmJiZGJlYmhicWJyYnRidWJ3YnhiemJ7Yn1igWKCYoNihWKGYodiiGKLYoxijWKOYo9ikGKUYplinGKdYp5io2KmYqdiqWKqYq1irmKvYrBismKz" +
    "YrRitmK3YrhiumK+YsBiwWLDYstiz2LRYtVi3WLeYuBi4WLkYupi62LwYvJi9WL4Yvli+mL7YwBjA2MEYwVjBmMKYwtjDGMNYw9jEGMSYxNjFGMVYxdjGGMZ" +
    "YxxjJmMnYyljLGMtYy5jMGMxYzNjNGM1YzZjN2M4YztjPGM+Yz9jQGNBY0RjR2NIY0pjUWNSY1NjVGNWY1djWGNZY1pjW2NcY11jYGNkY2VjZmNoY2pja2Ns" +
    "Y29jcGNyY3NjdGN1Y3hjeWN8Y31jfmN/Y4Fjg2OEY4VjhmOLY41jkWOTY5RjlWOXY5ljmmObY5xjnWOeY59joWOkY6Zjq2OvY7FjsmO1Y7ZjuWO7Y71jv2PA" +
    "Y8FjwmPDY8Vjx2PIY8pjy2PMY9Fj02PUY9Vj12PYY9lj2mPbY9xj3WPfY+Jj5GPlY+Zj52PoY+tj7GPuY+9j8GPxY/Nj9WP3Y/lj+mP7Y/xj/mQDZARkBmQH" +
    "ZAhkCWQKZA1kDmQRZBJkFWQWZBdkGGQZZBpkHWQfZCJkI2QkZCVkJ2QoZClkK2QuZC9kMGQxZDJkM2Q1ZDZkN2Q4ZDlkO2Q8ZD5kQGRCZENkSWRLZExkTWRO" +
    "ZE9kUGRRZFNkVWRWZFdkWWRaZFtkXGRdZF9kYGRhZGJkY2RkZGVkZmRoZGpka2RsZG5kb2RwZHFkcmRzZHRkdWR2ZHdke2R8ZH1kfmR/ZIBkgWSDZIZkiGSJ" +
    "ZIpki2SMZI1kjmSPZJBkk2SUZJdkmGSaZJtknGSdZJ9koGShZKJko2SlZKZkp2SoZKpkq2SvZLFksmSzZLRktmS5ZLtkvWS+ZL9kwWTDZMRkxmTHZMhkyWTK" +
    "ZMtkzGTPZNFk02TUZNVk1mTZZNpk22TcZN1k32TgZOFk42TlZOdk6GTpZOpk62TsZO1k7mTvZPBk8WTyZPNk9GT1ZPZk92T4ZPlk+mT7ZPxk/WT+ZP9lAWUC" +
    "ZQNlBGUFZQZlB2UIZQplC2UMZQ1lDmUPZRBlEWUTZRRlFWUWZRdlGWUaZRtlHGUdZR5lH2UgZSFlImUjZSRlJmUnZShlKWUqZSxlLWUwZTFlMmUzZTdlOmU8" +
    "ZT1lQGVBZUJlQ2VEZUZlR2VKZUtlTWVOZVBlUmVTZVRlV2VYZVplXGVfZWBlYWVkZWVlZ2VoZWllamVtZW5lb2VxZXNldWV2ZXhleWV6ZXtlfGV9ZX5lf2WA" +
    "ZYFlgmWDZYRlhWWGZYhliWWKZY1ljmWPZZJllGWVZZZlmGWaZZ1lnmWgZaJlo2WmZahlqmWsZa5lsWWyZbNltGW1ZbZlt2W4Zbplu2W+Zb9lwGXCZcdlyGXJ" +
    "ZcplzWXQZdFl02XUZdVl2GXZZdpl22XcZd1l3mXfZeFl42XkZepl62XyZfNl9GX1Zfhl+WX7Zfxl/WX+Zf9mAWYEZgVmB2YIZglmC2YNZhBmEWYSZhZmF2YY" +
    "ZhpmG2YcZh5mIWYiZiNmJGYmZilmKmYrZixmLmYwZjJmM2Y3ZjhmOWY6ZjtmPWY/ZkBmQmZEZkVmRmZHZkhmSWZKZk1mTmZQZlFmWGZZZltmXGZdZl5mYGZi" +
    "ZmNmZWZnZmlmamZrZmxmbWZxZnJmc2Z1ZnhmeWZ7ZnxmfWZ/ZoBmgWaDZoVmhmaIZolmimaLZo1mjmaPZpBmkmaTZpRmlWaYZplmmmabZpxmnmafZqBmoWai" +
    "ZqNmpGalZqZmqWaqZqtmrGatZq9msGaxZrJms2a1ZrZmt2a4Zrpmu2a8Zr1mv2bAZsFmwmbDZsRmxWbGZsdmyGbJZspmy2bMZs1mzmbPZtBm0WbSZtNm1GbV" +
    "ZtZm12bYZtpm3mbfZuBm4WbiZuNm5GblZudm6GbqZutm7GbtZu5m72bxZvVm9mb4Zvpm+2b9ZwFnAmcDZwRnBWcGZwdnDGcOZw9nEWcSZxNnFmcYZxlnGmcc" +
    "Zx5nIGchZyJnI2ckZyVnJ2cpZy5nMGcyZzNnNmc3ZzhnOWc7ZzxnPmc/Z0FnRGdFZ0dnSmdLZ01nUmdUZ1VnV2dYZ1lnWmdbZ11nYmdjZ2RnZmdnZ2tnbGdu" +
    "Z3FndGd2Z3hneWd6Z3tnfWeAZ4Jng2eFZ4ZniGeKZ4xnjWeOZ49nkWeSZ5NnlGeWZ5lnm2efZ6BnoWekZ6ZnqWesZ65nsWeyZ7RnuWe6Z7tnvGe9Z75nv2fA" +
    "Z8JnxWfGZ8dnyGfJZ8pny2fMZ81nzmfVZ9Zn12fbZ99n4WfjZ+Rn5mfnZ+hn6mfrZ+1n7mfyZ/Vn9mf3Z/hn+Wf6Z/tn/Gf+aAFoAmgDaARoBmgNaBBoEmgU" +
    "aBVoGGgZaBpoG2gcaB5oH2ggaCJoI2gkaCVoJmgnaChoK2gsaC1oLmgvaDBoMWg0aDVoNmg6aDtoP2hHaEtoTWhPaFJoVmhXaFhoWWhaaFtoXGhdaF5oX2hq" +
    "aGxobWhuaG9ocGhxaHJoc2h1aHhoeWh6aHtofGh9aH5of2iAaIJohGiHaIhoiWiKaItojGiNaI5okGiRaJJolGiVaJZomGiZaJpom2icaJ1onmifaKBooWij" +
    "aKRopWipaKpoq2isaK5osWiyaLRotmi3aLhouWi6aLtovGi9aL5ov2jBaMNoxGjFaMZox2jIaMpozGjOaM9o0GjRaNNo1GjWaNdo2WjbaNxo3WjeaN9o4Wji" +
    "aORo5WjmaOdo6GjpaOpo62jsaO1o72jyaPNo9Gj2aPdo+Gj7aP1o/mj/aQBpAmkDaQRpBmkHaQhpCWkKaQxpD2kRaRNpFGkVaRZpF2kYaRlpGmkbaRxpHWke" +
    "aSFpImkjaSVpJmknaShpKWkqaStpLGkuaS9pMWkyaTNpNWk2aTdpOGk6aTtpPGk+aUBpQWlDaURpRWlGaUdpSGlJaUppS2lMaU1pTmlPaVBpUWlSaVNpVWlW" +
    "aVhpWWlbaVxpX2lhaWJpZGllaWdpaGlpaWppbGltaW9pcGlyaXNpdGl1aXZpeml7aX1pfml/aYFpg2mFaYppi2mMaY5pj2mQaZFpkmmTaZZpl2mZaZppnWme" +
    "aZ9poGmhaaJpo2mkaaVppmmpaapprGmuaa9psGmyabNptWm2abhpuWm6abxpvWm+ab9pwGnCacNpxGnFacZpx2nIaclpy2nNac9p0WnSadNp1WnWaddp2GnZ" +
    "adpp3Gndad5p4WniaeNp5GnlaeZp52noaelp6mnraexp7mnvafBp8WnzafRp9Wn2afdp+Gn5afpp+2n8af5qAGoBagJqA2oEagVqBmoHaghqCWoLagxqDWoO" +
    "ag9qEGoRahJqE2oUahVqFmoZahpqG2ocah1qHmogaiJqI2okaiVqJmonailqK2osai1qLmowajJqM2o0ajZqN2o4ajlqOmo7ajxqP2pAakFqQmpDakVqRmpI" +
    "aklqSmpLakxqTWpOak9qUWpSalNqVGpValZqV2paalxqXWpeal9qYGpiamNqZGpmamdqaGppampqa2psam1qbmpvanBqcmpzanRqdWp2andqeGp6antqfWp+" +
    "an9qgWqCaoNqhWqGaodqiGqJaopqi2qMao1qj2qSapNqlGqVapZqmGqZappqm2qcap1qnmqfaqFqomqjaqRqpWqmaqdqqGqqaq1qrmqvarBqsWqyarNqtGq1" +
    "arZqt2q4arlqumq7arxqvWq+ar9qwGrBasJqw2rEasVqxmrHashqyWrKastqzGrNas5qz2rQatFq0mrTatRq1WrWatdq2GrZatpq22rcat1q3mrfauBq4Wri" +
    "auNq5GrlauZq52roaulq6mrrauxq7Wruau9q8GrxavJq82r0avVq9mr3avhq+Wr6avtq/Gr9av5q/2sAawFrAmsDawRrBWsGawdrCGsJawprC2sMaw1rDmsP" +
    "axBrEWsSaxNrFGsVaxZrF2sYaxlrGmsbaxxrHWseax9rJWsmayhrKWsqaytrLGstay5rL2swazFrM2s0azVrNms4aztrPGs9az9rQGtBa0JrRGtFa0hrSmtL" +
    "a01rTmtPa1BrUWtSa1NrVGtVa1ZrV2tYa1prW2tca11rXmtfa2BrYWtoa2lra2tsa21rbmtva3BrcWtya3NrdGt1a3Zrd2t4a3prfWt+a39rgGuFa4hrjGuO" +
    "a49rkGuRa5RrlWuXa5hrmWuca51rnmufa6Bromuja6RrpWuma6drqGupa6trrGuta65rr2uwa7Frsmu2a7hruWu6a7trvGu9a75rwGvDa8RrxmvHa8hryWvK" +
    "a8xrzmvQa9Fr2Gvaa9xr3Wvea99r4Gvia+Nr5Gvla+Zr52voa+lr7Gvta+5r8Gvxa/Jr9Gv2a/dr+Gv6a/tr/Gv+a/9sAGwBbAJsA2wEbAhsCWwKbAtsDGwO" +
    "bBJsF2wcbB1sHmwgbCNsJWwrbCxsLWwxbDNsNmw3bDlsOmw7bDxsPmw/bENsRGxFbEhsS2xMbE1sTmxPbFFsUmxTbFZsWGxZbFpsYmxjbGVsZmxnbGtsbGxt" +
    "bG5sb2xxbHNsdWx3bHhsemx7bHxsf2yAbIRsh2yKbItsjWyObJFskmyVbJZsl2yYbJpsnGydbJ5soGyibKhsrGyvbLBstGy1bLZst2y6bMBswWzCbMNsxmzH" +
    "bMhsy2zNbM5sz2zRbNJs2GzZbNps3GzdbN9s5GzmbOds6WzsbO1s8mz0bPls/20AbQJtA20FbQZtCG0JbQptDW0PbRBtEW0TbRRtFW0WbRhtHG0dbR9tIG0h" +
    "bSJtI20kbSZtKG0pbSxtLW0vbTBtNG02bTdtOG06bT9tQG1CbURtSW1MbVBtVW1WbVdtWG1bbV1tX21hbWJtZG1lbWdtaG1rbWxtbW1wbXFtcm1zbXVtdm15" +
    "bXpte219bX5tf22AbYFtg22EbYZth22KbYttjW2PbZBtkm2WbZdtmG2ZbZptnG2ibaVtrG2tbbBtsW2zbbRttm23bbltum27bbxtvW2+bcFtwm3DbchtyW3K" +
    "bc1tzm3PbdBt0m3TbdRt1W3Xbdpt223cbd9t4m3jbeVt523obelt6m3tbe9t8G3ybfRt9W32bfht+m39bf5t/24AbgFuAm4DbgRuBm4HbghuCW4Lbg9uEm4T" +
    "bhVuGG4ZbhtuHG4ebh9uIm4mbiduKG4qbixuLm4wbjFuM241bjZuN245bjtuPG49bj5uP25AbkFuQm5FbkZuR25IbkluSm5LbkxuT25QblFuUm5VblduWW5a" +
    "blxuXW5ebmBuYW5ibmNuZG5lbmZuZ25obmluam5sbm1ub25wbnFucm5zbnRudW52bndueG55bnpue258bn1ugG6BboJuhG6Hbohuim6LboxujW6ObpFukm6T" +
    "bpRulW6WbpdumW6abptunW6ebqBuoW6jbqRupm6obqluq26sbq1urm6wbrNutW64brluvG6+br9uwG7DbsRuxW7GbshuyW7KbsxuzW7ObtBu0m7Wbthu2W7b" +
    "btxu3W7jbudu6m7rbuxu7W7ubu9u8G7xbvJu8271bvZu9274bvpu+278bv1u/m7/bwBvAW8DbwRvBW8HbwhvCm8LbwxvDW8ObxBvEW8SbxZvF28YbxlvGm8b" +
    "bxxvHW8ebx9vIW8ibyNvJW8mbydvKG8sby5vMG8ybzRvNW83bzhvOW86bztvPG89bz9vQG9Bb0JvQ29Eb0VvSG9Jb0pvTG9Ob09vUG9Rb1JvU29Ub1VvVm9X" +
    "b1lvWm9bb11vX29gb2FvY29kb2VvZ29ob2lvam9rb2xvb29wb3Fvc291b3Zvd295b3tvfW9+b39vgG+Bb4Jvg2+Fb4Zvh2+Kb4tvj2+Qb5Fvkm+Tb5RvlW+W" +
    "b5dvmG+Zb5pvm2+db55vn2+gb6Jvo2+kb6Vvpm+ob6lvqm+rb6xvrW+ub69vsG+xb7JvtG+1b7dvuG+6b7tvvG+9b75vv2/Bb8NvxG/Fb8Zvx2/Ib8pvy2/M" +
    "b81vzm/Pb9Bv02/Ub9Vv1m/Xb9hv2W/ab9tv3G/db99v4m/jb+Rv5W/mb+dv6G/pb+pv62/sb+1v8G/xb/Jv82/0b/Vv9m/3b/hv+W/6b/tv/G/9b/5v/3AA" +
    "cAFwAnADcARwBXAGcAdwCHAJcApwC3AMcA1wDnAPcBBwEnATcBRwFXAWcBdwGHAZcBxwHXAecB9wIHAhcCJwJHAlcCZwJ3AocClwKnArcCxwLXAucC9wMHAx" +
    "cDJwM3A0cDZwN3A4cDpwO3A8cD1wPnA/cEBwQXBCcENwRHBFcEZwR3BIcElwSnBLcE1wTnBQcFFwUnBTcFRwVXBWcFdwWHBZcFpwW3BccF1wX3BgcGFwYnBj" +
    "cGRwZXBmcGdwaHBpcGpwbnBxcHJwc3B0cHdweXB6cHtwfXCBcIJwg3CEcIZwh3CIcItwjHCNcI9wkHCRcJNwl3CYcJpwm3CecJ9woHChcKJwo3CkcKVwpnCn" +
    "cKhwqXCqcLBwsnC0cLVwtnC6cL5wv3DEcMVwxnDHcMlwy3DMcM1wznDPcNBw0XDScNNw1HDVcNZw13DacNxw3XDecOBw4XDicONw5XDqcO5w8HDxcPJw83D0" +
    "cPVw9nD4cPpw+3D8cP5w/3EAcQFxAnEDcQRxBXEGcQdxCHELcQxxDXEOcQ9xEXEScRRxF3EbcRxxHXEecR9xIHEhcSJxI3EkcSVxJ3EocSlxKnErcSxxLXEu" +
    "cTJxM3E0cTVxN3E4cTlxOnE7cTxxPXE+cT9xQHFBcUJxQ3FEcUZxR3FIcUlxS3FNcU9xUHFRcVJxU3FUcVVxVnFXcVhxWXFacVtxXXFfcWBxYXFicWNxZXFp" +
    "cWpxa3FscW1xb3FwcXFxdHF1cXZxd3F5cXtxfHF+cX9xgHGBcYJxg3GFcYZxh3GIcYlxi3GMcY1xjnGQcZFxknGTcZVxlnGXcZpxm3GccZ1xnnGhcaJxo3Gk" +
    "caVxpnGncalxqnGrca1xrnGvcbBxsXGycbRxtnG3cbhxunG7cbxxvXG+cb9xwHHBccJxxHHFccZxx3HIcclxynHLccxxzXHPcdBx0XHScdNx1nHXcdhx2XHa" +
    "cdtx3HHdcd5x33HhceJx43HkceZx6HHpcepx63Hsce1x73HwcfFx8nHzcfRx9XH2cfdx+HH6cftx/HH9cf5x/3IAcgFyAnIDcgRyBXIHcghyCXIKcgtyDHIN" +
    "cg5yD3IQchFyEnITchRyFXIWchdyGHIZchpyG3Icch5yH3IgciFyInIjciRyJXImcidyKXIrci1yLnIvcjJyM3I0cjpyPHI+ckByQXJCckNyRHJFckZySXJK" +
    "cktyTnJPclByUXJTclRyVXJXclhyWnJccl5yYHJjcmRyZXJocmpya3Jscm1ycHJxcnNydHJ2cndyeHJ7cnxyfXKCcoNyhXKGcodyiHKJcoxyjnKQcpFyk3KU" +
    "cpVylnKXcphymXKacptynHKdcp5yoHKhcqJyo3KkcqVypnKncqhyqXKqcqtyrnKxcrJys3K1crpyu3K8cr1yvnK/csByxXLGcsdyyXLKcstyzHLPctFy03LU" +
    "ctVy1nLYctpy2+TG5MfkyOTJ5Mrky+TM5M3kzuTP5NDk0eTS5NPk1OTV5Nbk1+TY5Nnk2uTb5Nzk3eTe5N/k4OTh5OLk4+Tk5OXk5uTn5Ojk6eTq5Ovk7OTt" +
    "5O7k7+Tw5PHk8uTz5PTk9eT25Pfk+OT55Prk++T85P3k/uT/5QDlAeUC5QPlBOUF5QblB+UI5QnlCuUL5QzlDeUO5Q/lEOUR5RLlE+UU5RXlFuUX5RjlGeUa" +
    "5RvlHOUd5R7lH+Ug5SHlIuUj5STlJTAAMAEwAgC3AskCxwCoMAMwBSAU/14gFiAmIBggGSAcIB0wFDAVMAgwCTAKMAswDDANMA4wDzAWMBcwEDARALEA1wD3" +
    "IjYiJyIoIhEiDyIqIikiCCI3IhoipSIlIiAjEiKZIisiLiJhIkwiSCI9Ih0iYCJuIm8iZCJlIh4iNSI0JkImQACwIDIgMyED/wQApP/g/+EgMACnIRYmBiYF" +
    "JcslzyXOJcclxiWhJaAlsyWyIDshkiGQIZEhkzAT5SblJ+Uo5SnlKuUr5SzlLeUu5S/lMOUx5TLlM+U05TXlNuU35TjlOeU65TvlPOU95T7lP+VA5UHlQuVD" +
    "5UTlReVG5UflSOVJ5UrlS+VM5U3lTuVP5VDlUeVS5VPlVOVV5VblV+VY5VnlWuVb5VzlXeVe5V/lYOVh5WLlY+Vk5WXlZuVn5WjlaeVq5WvlbOVt5W7lb+Vw" +
    "5XHlcuVz5XTldeV25XfleOV55Xrle+V85X3lfuV/5YDlgeWC5YPlhOWFIXAhcSFyIXMhdCF1IXYhdyF4IXnnZudn52jnaedq52skiCSJJIokiySMJI0kjiSP" +
    "JJAkkSSSJJMklCSVJJYklySYJJkkmiSbJHQkdSR2JHckeCR5JHokeyR8JH0kfiR/JIAkgSSCJIMkhCSFJIYkhyRgJGEkYiRjJGQkZSRmJGckaCRpIKznbTIg" +
    "MiEyIjIjMiQyJTImMicyKDIp527nbyFgIWEhYiFjIWQhZSFmIWchaCFpIWoha+dw53HlhuWH5YjlieWK5YvljOWN5Y7lj+WQ5ZHlkuWT5ZTlleWW5ZflmOWZ" +
    "5Zrlm+Wc5Z3lnuWf5aDloeWi5aPlpOWl5ablp+Wo5anlquWr5azlreWu5a/lsOWx5bLls+W05bXltuW35bjlueW65bvlvOW95b7lv+XA5cHlwuXD5cTlxeXG" +
    "5cflyOXJ5crly+XM5c3lzuXP5dDl0eXS5dPl1OXV5dbl1+XY5dnl2uXb5dzl3eXe5d/l4OXh5eLl4+XkMAD/Af8C/wP/5f8F/wb/B/8I/wn/Cv8L/wz/Df8O" +
    "/w//EP8R/xL/E/8U/xX/Fv8X/xj/Gf8a/xv/HP8d/x7/H/8g/yH/Iv8j/yT/Jf8m/yf/KP8p/yr/K/8s/y3/Lv8v/zD/Mf8y/zP/NP81/zb/N/84/zn/Ov87" +
    "/zz/Pf8+/z//QP9B/0L/Q/9E/0X/Rv9H/0j/Sf9K/0v/TP9N/07/T/9Q/1H/Uv9T/1T/Vf9W/1f/WP9Z/1r/W/9c/13/4+Xm5efl6OXp5erl6+Xs5e3l7uXv" +
    "5fDl8eXy5fPl9OX15fbl9+X45fnl+uX75fzl/eX+5f/mAOYB5gLmA+YE5gXmBuYH5gjmCeYK5gvmDOYN5g7mD+YQ5hHmEuYT5hTmFeYW5hfmGOYZ5hrmG+Yc" +
    "5h3mHuYf5iDmIeYi5iPmJOYl5ibmJ+Yo5inmKuYr5izmLeYu5i/mMOYx5jLmM+Y05jXmNuY35jjmOeY65jvmPOY95j7mP+ZA5kHmQuZD5kTmRTBBMEIwQzBE" +
    "MEUwRjBHMEgwSTBKMEswTDBNME4wTzBQMFEwUjBTMFQwVTBWMFcwWDBZMFowWzBcMF0wXjBfMGAwYTBiMGMwZDBlMGYwZzBoMGkwajBrMGwwbTBuMG8wcDBx" +
    "MHIwczB0MHUwdjB3MHgweTB6MHswfDB9MH4wfzCAMIEwgjCDMIQwhTCGMIcwiDCJMIowizCMMI0wjjCPMJAwkTCSMJPncudz53Tnded253fneOd553rne+d8" +
    "5kbmR+ZI5knmSuZL5kzmTeZO5k/mUOZR5lLmU+ZU5lXmVuZX5ljmWeZa5lvmXOZd5l7mX+Zg5mHmYuZj5mTmZeZm5mfmaOZp5mrma+Zs5m3mbuZv5nDmceZy" +
    "5nPmdOZ15nbmd+Z45nnmeuZ75nzmfeZ+5n/mgOaB5oLmg+aE5oXmhuaH5ojmieaK5ovmjOaN5o7mj+aQ5pHmkuaT5pTmleaW5pfmmOaZ5prmm+ac5p3mnuaf" +
    "5qDmoeai5qPmpOalMKEwojCjMKQwpTCmMKcwqDCpMKowqzCsMK0wrjCvMLAwsTCyMLMwtDC1MLYwtzC4MLkwujC7MLwwvTC+ML8wwDDBMMIwwzDEMMUwxjDH" +
    "MMgwyTDKMMswzDDNMM4wzzDQMNEw0jDTMNQw1TDWMNcw2DDZMNow2zDcMN0w3jDfMOAw4TDiMOMw5DDlMOYw5zDoMOkw6jDrMOww7TDuMO8w8DDxMPIw8zD0" +
    "MPUw9ud9537nf+eA54HngueD54Tmpuan5qjmqeaq5qvmrOat5q7mr+aw5rHmsuaz5rTmtea25rfmuOa55rrmu+a85r3mvua/5sDmwebC5sPmxObF5sbmx+bI" +
    "5snmyubL5szmzebO5s/m0ObR5tLm0+bU5tXm1ubX5tjm2eba5tvm3Obd5t7m3+bg5uHm4ubj5uTm5ebm5ufm6Obp5urm6+bs5u3m7ubv5vDm8eby5vPm9Ob1" +
    "5vbm9+b45vnm+ub75vzm/eb+5v/nAOcB5wLnA+cE5wUDkQOSA5MDlAOVA5YDlwOYA5kDmgObA5wDnQOeA58DoAOhA6MDpAOlA6YDpwOoA6nnheeG54fniOeJ" +
    "54rni+eMA7EDsgOzA7QDtQO2A7cDuAO5A7oDuwO8A70DvgO/A8ADwQPDA8QDxQPGA8cDyAPJ/hD+Ev4R/hP+FP4V/hb+Nf42/jn+Ov4//kD+Pf4+/kH+Qv5D" +
    "/kT+F/4Y/jv+PP43/jj+Mf4Z/jP+NOeX55jnmeea55vnnOed557nn+cG5wfnCOcJ5wrnC+cM5w3nDucP5xDnEecS5xPnFOcV5xbnF+cY5xnnGucb5xznHece" +
    "5x/nIOch5yLnI+ck5yXnJucn5yjnKecq5yvnLOct5y7nL+cw5zHnMucz5zTnNec25zfnOOc55zrnO+c85z3nPuc/50DnQedC50PnROdF50bnR+dI50nnSudL" +
    "50znTedO50/nUOdR51LnU+dU51XnVudX51jnWeda51vnXOdd517nX+dg52HnYudj52TnZQQQBBEEEgQTBBQEFQQBBBYEFwQYBBkEGgQbBBwEHQQeBB8EIAQh" +
    "BCIEIwQkBCUEJgQnBCgEKQQqBCsELAQtBC4EL+eg56Hnouej56Tnpeem56fnqOep56rnq+es563nrgQwBDEEMgQzBDQENQRRBDYENwQ4BDkEOgQ7BDwEPQQ+" +
    "BD8EQARBBEIEQwREBEUERgRHBEgESQRKBEsETARNBE4ET+ev57Dnseey57PntOe157bnt+e457nnuue7AsoCywLZIBMgFSAlIDUhBSEJIZYhlyGYIZkiFSIf" +
    "IiMiUiJmImcivyVQJVElUiVTJVQlVSVWJVclWCVZJVolWyVcJV0lXiVfJWAlYSViJWMlZCVlJWYlZyVoJWklaiVrJWwlbSVuJW8lcCVxJXIlcyWBJYIlgyWE" +
    "JYUlhiWHJYgliSWKJYsljCWNJY4ljyWTJZQllSW8Jb0l4iXjJeQl5SYJIpUwEjAdMB7nvOe9577nv+fA58HnwufD58TnxefGAQEA4QHOAOABEwDpARsA6AEr" +
    "AO0B0ADsAU0A8wHSAPIBawD6AdQA+QHWAdgB2gHcAPwA6gJRHj8BRAFIAfkCYefJ58rny+fMMQUxBjEHMQgxCTEKMQsxDDENMQ4xDzEQMRExEjETMRQxFTEW" +
    "MRcxGDEZMRoxGzEcMR0xHjEfMSAxITEiMSMxJDElMSYxJzEoMSnnzefO58/n0OfR59Ln0+fU59Xn1ufX59jn2efa59vn3Ofd597n3+fg5+EwITAiMCMwJDAl" +
    "MCYwJzAoMCkyozOOM48znDOdM54zoTPEM84z0TPSM9X+MP/i/+Tn4iEhMjHn4yAQ5+Tn5efmMPwwmzCcMP0w/jAGMJ0wnv5J/kr+S/5M/k3+Tv5P/lD+Uf5S" +
    "/lT+Vf5W/lf+Wf5a/lv+XP5d/l7+X/5g/mH+Yv5j/mT+Zf5m/mj+af5q/mswPi/wL/Ev8i/zL/Qv9S/2L/cv+C/5L/ov+zAH5/Tn9ef25/fn+Of55/rn++f8" +
    "5/3n/uf/6AAlACUBJQIlAyUEJQUlBiUHJQglCSUKJQslDCUNJQ4lDyUQJRElEiUTJRQlFSUWJRclGCUZJRolGyUcJR0lHiUfJSAlISUiJSMlJCUlJSYlJyUo" +
    "JSklKiUrJSwlLSUuJS8lMCUxJTIlMyU0JTUlNiU3JTglOSU6JTslPCU9JT4lPyVAJUElQiVDJUQlRSVGJUclSCVJJUolS+gB6ALoA+gE6AXoBugH6AjoCegK" +
    "6AvoDOgN6A7oD3Lcct1y33LicuNy5HLlcuZy53Lqcuty9XL2cvly/XL+cv9zAHMCcwRzBXMGcwdzCHMJcwtzDHMNcw9zEHMRcxJzFHMYcxlzGnMfcyBzI3Mk" +
    "cyZzJ3Mocy1zL3MwczJzM3M1czZzOnM7czxzPXNAc0FzQnNDc0RzRXNGc0dzSHNJc0pzS3NMc05zT3NRc1NzVHNVc1ZzWHNZc1pzW3Ncc11zXnNfc2FzYnNj" +
    "c2RzZXNmc2dzaHNpc2pza3Nuc3BzceAA4AHgAuAD4ATgBeAG4AfgCOAJ4ArgC+AM4A3gDuAP4BDgEeAS4BPgFOAV4BbgF+AY4BngGuAb4BzgHeAe4B/gIOAh" +
    "4CLgI+Ak4CXgJuAn4CjgKeAq4CvgLOAt4C7gL+Aw4DHgMuAz4DTgNeA24DfgOOA54DrgO+A84D3gPuA/4EDgQeBC4EPgROBF4EbgR+BI4EngSuBL4EzgTeBO" +
    "4E/gUOBR4FLgU+BU4FXgVuBX4FjgWeBa4FvgXOBdc3Jzc3N0c3VzdnN3c3hzeXN6c3tzfHN9c39zgHOBc4Jzg3OFc4ZziHOKc4xzjXOPc5BzknOTc5RzlXOX" +
    "c5hzmXOac5xznXOec6BzoXOjc6RzpXOmc6dzqHOqc6xzrXOxc7RztXO2c7hzuXO8c71zvnO/c8Fzw3PEc8VzxnPHc8tzzHPOc9Jz03PUc9Vz1nPXc9hz2nPb" +
    "c9xz3XPfc+Fz4nPjc+Rz5nPoc+pz63Psc+5z73Pwc/Fz83P0c/Vz9nP34F7gX+Bg4GHgYuBj4GTgZeBm4GfgaOBp4Grga+Bs4G3gbuBv4HDgceBy4HPgdOB1" +
    "4Hbgd+B44HngeuB74HzgfeB+4H/ggOCB4ILgg+CE4IXghuCH4IjgieCK4IvgjOCN4I7gj+CQ4JHgkuCT4JTgleCW4JfgmOCZ4Jrgm+Cc4J3gnuCf4KDgoeCi" +
    "4KPgpOCl4Kbgp+Co4KngquCr4KzgreCu4K/gsOCx4LLgs+C04LXgtuC34LjgueC64Ltz+HP5c/pz+3P8c/1z/nP/dAB0AXQCdAR0B3QIdAt0DHQNdA50EXQS" +
    "dBN0FHQVdBZ0F3QYdBl0HHQddB50H3QgdCF0I3QkdCd0KXQrdC10L3QxdDJ0N3Q4dDl0OnQ7dD10PnQ/dEB0QnRDdER0RXRGdEd0SHRJdEp0S3RMdE10TnRP" +
    "dFB0UXRSdFN0VHRWdFh0XXRgdGF0YnRjdGR0ZXRmdGd0aHRpdGp0a3RsdG50b3RxdHJ0c3R0dHV0eHR5dHrgvOC94L7gv+DA4MHgwuDD4MTgxeDG4MfgyODJ" +
    "4Mrgy+DM4M3gzuDP4NDg0eDS4NPg1ODV4Nbg1+DY4Nng2uDb4Nzg3eDe4N/g4ODh4OLg4+Dk4OXg5uDn4Ojg6eDq4Ovg7ODt4O7g7+Dw4PHg8uDz4PTg9eD2" +
    "4Pfg+OD54Prg++D84P3g/uD/4QDhAeEC4QPhBOEF4QbhB+EI4QnhCuEL4QzhDeEO4Q/hEOER4RLhE+EU4RXhFuEX4RjhGXR7dHx0fXR/dIJ0hHSFdIZ0iHSJ" +
    "dIp0jHSNdI90kXSSdJN0lHSVdJZ0l3SYdJl0mnSbdJ10n3SgdKF0onSjdKR0pXSmdKp0q3SsdK10rnSvdLB0sXSydLN0tHS1dLZ0t3S4dLl0u3S8dL10vnS/" +
    "dMB0wXTCdMN0xHTFdMZ0x3TIdMl0ynTLdMx0zXTOdM900HTRdNN01HTVdNZ013TYdNl02nTbdN1033ThdOV053TodOl06nTrdOx07XTwdPF08uEa4RvhHOEd" +
    "4R7hH+Eg4SHhIuEj4SThJeEm4SfhKOEp4SrhK+Es4S3hLuEv4TDhMeEy4TPhNOE14TbhN+E44TnhOuE74TzhPeE+4T/hQOFB4ULhQ+FE4UXhRuFH4UjhSeFK" +
    "4UvhTOFN4U7hT+FQ4VHhUuFT4VThVeFW4VfhWOFZ4VrhW+Fc4V3hXuFf4WDhYeFi4WPhZOFl4WbhZ+Fo4WnhauFr4WzhbeFu4W/hcOFx4XLhc+F04XXhduF3" +
    "dPN09XT4dPl0+nT7dPx0/XT+dQB1AXUCdQN1BXUGdQd1CHUJdQp1C3UMdQ51EHUSdRR1FXUWdRd1G3UddR51IHUhdSJ1I3UkdSZ1J3UqdS51NHU2dTl1PHU9" +
    "dT91QXVCdUN1RHVGdUd1SXVKdU11UHVRdVJ1U3VVdVZ1V3VYdV11XnVfdWB1YXVidWN1ZHVndWh1aXVrdWx1bXVudW91cHVxdXN1dXV2dXd1enV7dXx1fXV+" +
    "dYB1gXWCdYR1hXWH4XjheeF64XvhfOF94X7hf+GA4YHhguGD4YThheGG4YfhiOGJ4Yrhi+GM4Y3hjuGP4ZDhkeGS4ZPhlOGV4Zbhl+GY4ZnhmuGb4ZzhneGe" +
    "4Z/hoOGh4aLho+Gk4aXhpuGn4ajhqeGq4avhrOGt4a7hr+Gw4bHhsuGz4bThteG24bfhuOG54brhu+G84b3hvuG/4cDhweHC4cPhxOHF4cbhx+HI4cnhyuHL" +
    "4czhzeHO4c/h0OHR4dLh0+HU4dV1iHWJdYp1jHWNdY51kHWTdZV1mHWbdZx1nnWidaZ1p3Wodal1qnWtdbZ1t3W6dbt1v3XAdcF1xnXLdcx1znXPddB10XXT" +
    "ddd12XXaddx13XXfdeB14XXldel17HXtde5173XydfN19XX2dfd1+HX6dft1/XX+dgJ2BHYGdgd2CHYJdgt2DXYOdg92EXYSdhN2FHYWdhp2HHYddh52IXYj" +
    "did2KHYsdi52L3YxdjJ2NnY3djl2OnY7dj12QXZCdkTh1uHX4djh2eHa4dvh3OHd4d7h3+Hg4eHh4uHj4eTh5eHm4efh6OHp4erh6+Hs4e3h7uHv4fDh8eHy" +
    "4fPh9OH14fbh9+H44fnh+uH74fzh/eH+4f/iAOIB4gLiA+IE4gXiBuIH4gjiCeIK4gviDOIN4g7iD+IQ4hHiEuIT4hTiFeIW4hfiGOIZ4hriG+Ic4h3iHuIf" +
    "4iDiIeIi4iPiJOIl4ibiJ+Io4iniKuIr4iziLeIu4i/iMOIx4jLiM3ZFdkZ2R3ZIdkl2SnZLdk52T3ZQdlF2UnZTdlV2V3ZYdll2WnZbdl12X3ZgdmF2YnZk" +
    "dmV2ZnZndmh2aXZqdmx2bXZudnB2cXZydnN2dHZ1dnZ2d3Z5dnp2fHZ/doB2gXaDdoV2iXaKdox2jXaPdpB2knaUdpV2l3aYdpp2m3acdp12nnafdqB2oXai" +
    "dqN2pXamdqd2qHapdqp2q3asdq12r3awdrN2tXa2drd2uHa5drp2u3a8dr12vnbAdsF2w1VKlj9Xw2MoVM5VCVTAdpF2TIU8d+6CfniNcjGWmJeNbChbiU/6" +
    "Ywlml1y4gPpoSICuZgJ2zlH5ZVZxrH/xiIRQslllYcpvs4KtY0xiUlPtVCd7BlFrdaRd9GLUjcuXdmKKgBlXXZc4f2JyOHZ9Z892fmRGT3CNJWLcehdlkXPt" +
    "ZCxic4IsmIFnf3JIYm5izE80dONTSlKefsqQpl4uaIZpnIGAftFo0njFhoyVUVCNjCSC3oDeUwWJElJldsR2x3bJdst2zHbTdtV22Xbadtx23XbeduB24Xbi" +
    "duN25Hbmdud26Hbpdup263bsdu128HbzdvV29nb3dvp2+3b9dv93AHcCdwN3BXcGdwp3DHcOdw93EHcRdxJ3E3cUdxV3FncXdxh3G3ccdx13HnchdyN3JHcl" +
    "dyd3Kncrdyx3LncwdzF3MnczdzR3OXc7dz13Pnc/d0J3RHdFd0Z3SHdJd0p3S3dMd013TndPd1J3U3dUd1V3VndXd1h3WXdchYSW+U/dWCGZcVudYrFipWa0" +
    "jHmcjXIGZ294kWCyU1FTF4+IgMyNHZShUA1yyFkHYOtxGYirWVSC72cseyhdKX73dS1s9Y5mj/iQPJ87a9SRGXsUX3x4p4TWhT1r1WvZa9ZeAV6HdfmV7WVd" +
    "XwpfxY+fWMGBwpB/lluXrY+5fxaNLGJBT79T2FNej6iPqY+rkE1oB19qgZiIaJzWYYtSK3YqX2xljG/SbuhbvmRIUXVRsGfEThl5yZl8cLN3XXded193YHdk" +
    "d2d3aXdqd213bndvd3B3cXdyd3N3dHd1d3Z3d3d4d3p3e3d8d4F3gneDd4Z3h3eId4l3ineLd493kHeTd5R3lXeWd5d3mHeZd5p3m3ecd513nnehd6N3pHem" +
    "d6h3q3etd653r3exd7J3tHe2d7d3uHe5d7p3vHe+d8B3wXfCd8N3xHfFd8Z3x3fId8l3ynfLd8x3znfPd9B30XfSd9N31HfVd9Z32HfZd9p33Xfed9934Hfh" +
    "d+R1xV52c7uD4GStYuiUtWziU1pSw2QPlMJ7lE8vXhuCNoEWgYpuJGzKmnNjVVNcVPqIZVfgTg1eA2tlfD+Q6GAWZOZzHIjBZ1BiTY0id2yOKZHHX2mD3IUh" +
    "mRBTwoaVa4tg7WDocH+CzYIxTtNsp4XPZM182Wn9ZvmDSVOVe1ZPp1GMbUtcQo5tY9JTyYMsgzZn5Xi0ZD1b31yUXe6L52LGZ/SMemQAY7qHSZmLjBd/IJTy" +
    "TqeWEJikZgxzFnfmd+h36nfvd/B38Xfyd/R39Xf3d/l3+nf7d/x4A3gEeAV4BngHeAh4CngLeA54D3gQeBN4FXgZeBt4HnggeCF4IngkeCh4KngreC54L3gx" +
    "eDJ4M3g1eDZ4PXg/eEF4QnhDeER4RnhIeEl4SnhLeE14T3hReFN4VHhYeFl4WnhbeFx4XnhfeGB4YXhieGN4ZHhleGZ4Z3hoeGl4b3hweHF4cnhzeHR4dXh2" +
    "eHh4eXh6eHt4fXh+eH94gHiBeIJ4g1c6XB1eOJV/UH+AoFOCZV51RVUxUCGNhWKElJ5nHVYyb25d4lQ1cJKPZmJvZKRjo197b4iQ9IHjj7BcGGZoX/FsiZZI" +
    "jYGIbGSRefBXzmpZYhBUSE5Yegtg6W+Ei9pif5Aemot55FQDdfRjAVMZbGCP318bmnCAO59/T4hcOo1kf8VlpXC9UUVRsoZrXQdboGK9kWx1dI4MeiBhAXt5" +
    "Tsd++HeFThGB7VIdUfpqcVOojoeVBJbPbsGWZGlaeIR4hXiGeIh4iniLeI94kHiSeJR4lXiWeJl4nXieeKB4onikeKZ4qHipeKp4q3iseK14rniveLV4tni3" +
    "eLh4uni7eLx4vXi/eMB4wnjDeMR4xnjHeMh4zHjNeM54z3jReNJ403jWeNd42HjaeNt43HjdeN5433jgeOF44njjeOR45XjmeOd46XjqeOt47XjueO948Hjx" +
    "ePN49Xj2ePh4+Xj7ePx4/Xj+eP95AHkCeQN5BHkGeQd5CHkJeQp5C3kMeEBQqHfXZBCJ5lkEY+Nd3Xp/aT1PIII5VZhOMnWuepdeYl6Kle9SG1Q5cIpjdpUk" +
    "V4JmJWk/kYdVB23zfq+IImIzfvB1tYMoeMGWzI+eYUh094vNa2RSOo1QayGAaoRxVvFTBk7OThtR0XyXkYt8B0/Djn974XqcZGddFFCsgQZ2AXy5bex/4GdR" +
    "W1hb+HjLZK5kE2OqYyuVGWQtj757VHYpYlNZJ1RGa3lQo2I0XiZrhk7jjTeIi1+FkC55DXkOeQ95EHkReRJ5FHkVeRZ5F3kYeRl5GnkbeRx5HXkfeSB5IXki" +
    "eSN5JXkmeSd5KHkpeSp5K3kseS15LnkveTB5MXkyeTN5NXk2eTd5OHk5eT15P3lCeUN5RHlFeUd5SnlLeUx5TXlOeU95UHlReVJ5VHlVeVh5WXlheWN5ZHlm" +
    "eWl5anlreWx5bnlweXF5cnlzeXR5dXl2eXl5e3l8eX15fnl/eYJ5g3mGeYd5iHmJeYt5jHmNeY55kHmReZJgIIA9YsVOOVNVkPhjuIDGZeZsLk9GYO5t4Yve" +
    "XzmGy19TYyFRWoNhaGNSAGNjjkhQElybeXdb/FIwejtgvJBTdtdft1+XdoSObHBvdnt7SXeqUfOQk1gkT05u9I/qZUx7G3LEbaR/31rhYrVelVcwhIJ7LF4d" +
    "Xx+QEn8UmKBjgm7HeJhwuVF4l1tXq3U1T0N1OF6XYOZZYG3Aa794iVP8ltVRy1IBY4lUCpSTjAONzHI5eJ+Hdo/tjA1T4HmTeZR5lXmWeZd5mHmZeZt5nHmd" +
    "eZ55n3mgeaF5onmjeaR5pXmmeah5qXmqeat5rHmtea55r3mwebF5snm0ebV5tnm3ebh5vHm/ecJ5xHnFecd5yHnKecx5znnPedB503nUedZ513nZedp523nc" +
    "ed153nngeeF54nnleeh56nnsee558XnyefN59Hn1efZ593n5efp5/Hn+ef96AXoEegV6B3oIegl6CnoMeg96EHoRehJ6E3oVehZ6GHoZeht6HE4Bdu9T7pSJ" +
    "mHafDpUtW5qLok4iThxRrIRjYcJSqGgLT5dga1G7bR5RXGKWZZeWYYxGkBd12JD9d2Nr0nKKcuyL+1g1d3mNTGdclUCAml6mbiFZknrvd+2VO2u1Za1/DlgG" +
    "UVGWH1v5WKlUKI5yZWaYf1bklJ12/pBBY4dUxlkaWTpXm46yZzWN+oI1UkFg8FgVhv5c6J5FT8SYnYu5WiVgdlOEYnyQT5ECmX9gaYAMUT+AM1wUmXVtMU6M" +
    "eh16H3oheiJ6JHoleiZ6J3ooeil6Knoreix6LXouei96MHoxejJ6NHo1ejZ6OHo6ej56QHpBekJ6Q3pEekV6R3pIekl6SnpLekx6TXpOek96UHpSelN6VHpV" +
    "elZ6WHpZelp6W3pcel16XnpfemB6YXpiemN6ZHplemZ6Z3poeml6anpremx6bXpuem96cXpyenN6dXp7enx6fXp+eoJ6hXqHeol6inqLeox6jnqPepB6k3qU" +
    "epl6mnqbep56oXqijTBT0X9ae09PEE5PlgBs1XPQheleBnVqf/tqCnf+lJJ+QVHhcOZTzY/UgwONKXKvmW1s21dKgrNluYCqYj+WMlmoTv+Lv366ZT6D8pde" +
    "VWGY3oClUyqL/VQggLpen2y4jTmCrJFaVClsG1IGfrdXX3EabH58iVlLTv1f/2EkfKpOMFwBZ6uHAlzwlQuYznWvcP2QIlGvfx2LvVlJUeRPW1QmWStld4Ck" +
    "W3VidmLCj5BeRWwfeyZPD0/YZw16o3qkeqd6qXqqeqt6rnqverB6sXqyerR6tXq2erd6uHq5erp6u3q8er16vnrAesF6wnrDesR6xXrGesd6yHrJesp6zHrN" +
    "es56z3rQetF60nrTetR61XrXeth62nrbetx63XrheuJ65Hrneuh66Xrqeut67HruevB68XryevN69Hr1evZ693r4evt6/Hr+ewB7AXsCewV7B3sJewx7DXsO" +
    "exB7EnsTexZ7F3sYexp7HHsdex97IXsieyN7J3spey1tbm2qeY+IsV8XdStimo+FT++R3GWngS+BUV6cgVCNdFJviYaNS1kNUIVO2JYccjaBeY0fW8yLo5ZE" +
    "WYd/GlSQVnZWDovlZTlpgpSZdtZuiV5ydRhnRmfRev+AnY12YR95xmVijWNRiFIalKJ/OICbfrJcl24vZ2B72XaLmtiBj3+UfNVkHpVQej9USlTla0xkAWII" +
    "nj2A83WZUnKXaYRbaDyG5JYBlpSU7E4qVAR+2Wg5jd+AFWb0Xpp/uXsvezB7Mns0ezV7Nns3ezl7O3s9ez97QHtBe0J7Q3tEe0Z7SHtKe017TntTe1V7V3tZ" +
    "e1x7Xntfe2F7Y3tke2V7Zntne2h7aXtqe2t7bHtte297cHtze3R7dnt4e3p7fHt9e397gXuCe4N7hHuGe4d7iHuJe4p7i3uMe457j3uRe5J7k3uWe5h7mXua" +
    "e5t7nnufe6B7o3uke6V7rnuve7B7snuze7V7tnu3e7l7unu7e7x7vXu+e797wHvCe8N7xFfCgD9ol13lZTtSn2Btn5pPm46sUWxbq18TXelsXmLxjSFRcZSp" +
    "Uv5sn4LfctdXomeEjS1ZH4+cg8dUlXuNTzBsvVtkWdGfE1PkhsqaqIw3gKFlRZh+VvqWx1IudNxSUFvhYwKJAk5WYtBgKmj6UXNbmFGgicJ7oZmGf1Bg73BM" +
    "jS9RSV5/kBt0cInEVy14RV9Sn5+V+o9omzyL4XZ4aEJn3I3qjTVSPY+KbtpozZUFkO1W/WeciPmPx1TIe8V7yHvJe8p7y3vNe857z3vQe9J71HvVe9Z713vY" +
    "e9t73Hvee9974Hvie+N75Hvne+h76Xvre+x77Xvve/B78nvze/R79Xv2e/h7+Xv6e/t7/Xv/fAB8AXwCfAN8BHwFfAZ8CHwJfAp8DXwOfBB8EXwSfBN8FHwV" +
    "fBd8GHwZfBp8G3wcfB18HnwgfCF8InwjfCR8JXwofCl8K3wsfC18LnwvfDB8MXwyfDN8NHw1fDZ8N3w5fDp8O3w8fD18PnxCmrhbaW13bCZOpVuzmoeRY2Go" +
    "kK+X6VQrbbVb0lH9VYp/VX/wZLxjTWXxYb5gjXEKbFdsSVkvZ22CKljVVo6MamvrkN1ZfYAXU/dtaVR1VZ2Dd4PPaDh5vlSMT1VUCHbSjImWAmyzbbiNa4kQ" +
    "nmSNOlY/ntF11V+IcuBgaFT8TqhqKohhYFKPcFTEcNiGeZ4/bSpbj18YfqJViU+vczRUPFOaUBlUDlR8Tk5f/XRaWPaEa4Dhh3Ry0HzKblZ8Q3xEfEV8RnxH" +
    "fEh8SXxKfEt8THxOfE98UHxRfFJ8U3xUfFV8VnxXfFh8WXxafFt8XHxdfF58X3xgfGF8YnxjfGR8ZXxmfGd8aHxpfGp8a3xsfG18bnxvfHB8cXxyfHV8dnx3" +
    "fHh8eXx6fH58f3yAfIF8gnyDfIR8hXyGfId8iHyKfIt8jHyNfI58j3yQfJN8lHyWfJl8mnybfKB8oXyjfKZ8p3yofKl8q3ysfK18r3ywfLR8tXy2fLd8uHy6" +
    "fLtfJ4ZOVSxipE6SbKpiN4KxVNdTTnM+btF1O1ISUxaL3WnQX4pgAG3uV09rInOvaFOP2H8TY2Jgo1UkdeqMYnEVbaNbpl57g1JhTJ7EePqHV3wndodR8GD2" +
    "cUxmQ15MYE2MDnBwYyWPiV+9YGKG1Fbea8FglGFnU0lg4GZmjT95/U8acOlsR4uzi/J+2INkZg9aWptCbVFt94xBbTtPGXBrg7diFmDRlw2NJ3l4UftXPlf6" +
    "Zzp1eHo9ee97lXy/fMB8wnzDfMR8xnzJfMt8znzPfNB80XzSfNN81HzYfNp823zdfN584XzifON85HzlfOZ853zpfOp863zsfO187nzwfPF88nzzfPR89Xz2" +
    "fPd8+Xz6fPx8/Xz+fP99AH0BfQJ9A30EfQV9Bn0HfQh9CX0LfQx9DX0OfQ99EH0RfRJ9E30UfRV9Fn0XfRh9GX0afRt9HH0dfR59H30hfSN9JH0lfSZ9KH0p" +
    "fSp9LH0tfS59MH0xfTJ9M300fTV9NoCMmWWP+W/Ai6WeIVnsful/CVQJZ4Fo2I+RfE2WxlPKYCV1vmxyU3NayX6nYyRR4IEKXfGE32KAUYBbY08OeW1SQmC4" +
    "bU5bxFvCi6GLsGXiX8yWRVmTfud+qlYJZ7dZOU9zW7ZSoINamIqNPnUylL5QR3o8Tvdntpp+WsFrfHbRV1pcFns6lfRxTlF8gKmCcFl4fwSDJ2jAZ+x4sXh3" +
    "YuNjYXuAT+1SalHPg1Bp25J0jfWNMYnBlS57rU72fTd9OH05fTp9O308fT19Pn0/fUB9QX1CfUN9RH1FfUZ9R31IfUl9Sn1LfUx9TX1OfU99UH1RfVJ9U31U" +
    "fVV9Vn1XfVh9WX1afVt9XH1dfV59X31gfWF9Yn1jfWR9ZX1mfWd9aH1pfWp9a31sfW19b31wfXF9cn1zfXR9dX12fXh9eX16fXt9fH19fX59f32AfYF9gn2D" +
    "fYR9hX2GfYd9iH2JfYp9i32MfY19jn2PfZB9kX2SfZN9lH2VfZZ9l32YUGWCMFJRmW9uEG6Fbade+lD1WdxcBm1GbF91hoSLaGhZVouyUyCRcZZNhUlpEnkB" +
    "cSaA9k6kkMptR5qEWgdWvGQFlPB360+lgRpy4YnSmXp/NH7eUn9lWZF1j3+Pg1PrepZj7WOldoZ5+IhXljZiKlKrgoJoVGdwY3d3a3rtbQF+04njWdBiEoXJ" +
    "gqV1TFAfTst1pYvrXEpd/ntLZaSR0U7KbSWJX30nlSZOxYwoj9uXc2ZLeYGP0XDsbXh9mX2afZt9nH2dfZ59n32gfaF9on2jfaR9pX2nfah9qX2qfat9rH2t" +
    "fa99sH2xfbJ9s320fbV9tn23fbh9uX26fbt9vH29fb59v33AfcF9wn3DfcR9xX3Gfcd9yH3Jfcp9y33Mfc19zn3PfdB90X3SfdN91H3VfdZ9133Yfdl92n3b" +
    "fdx93X3efd994H3hfeJ9433kfeV95n3nfeh96X3qfet97H3tfe59733wffF98n3zffR99X32ffd9+H35ffpcPVKyg0ZRYoMOd1tmdpy4Tqxgyny+fLN+z06V" +
    "i2Zmb5iIl1lYg2VslVxfhHXJl1Z633reUcBwr3qYY+p6dn6gc5aX7U5FcHhOXZFSU6llUWXngfyCBVSOXDF1mpegYthy2XW9XEWaeYPKXEBUgHfpTj5sroBa" +
    "YtJjbl3oUXeN3Y4elS9P8VPlYOdwrFJnY1CeQ1ofUCZ3N1N3fuJkhWUrYoljmFAUcjWJyVGzi8B+3VdHg8yUp1GbVBtc+337ffx9/X3+ff9+AH4BfgJ+A34E" +
    "fgV+Bn4Hfgh+CX4Kfgt+DH4Nfg5+D34QfhF+En4TfhR+FX4Wfhd+GH4Zfhp+G34cfh1+Hn4ffiB+IX4ifiN+JH4lfiZ+J34ofil+Kn4rfix+LX4ufi9+MH4x" +
    "fjJ+M340fjV+Nn43fjh+OX46fjx+PX4+fj9+QH5CfkN+RH5FfkZ+SH5Jfkp+S35Mfk1+Tn5PflB+UX5SflN+VH5VflZ+V35Yfll+Wn5bflx+XU/KeuNtWpDh" +
    "mo9VgFSWU2FUr18AY+lpd1HvYWhSClgqUthXTngNdwtet2F3fOBiW2KXTqJwlYADYvdw5JdgV3eC22fvaPV41ZiXedFY81SzU+9uNFFLUjtboov+gK9VQ1em" +
    "YHNXUVQtenpgUFtUY6dioFPjYmNbx2evVO16n4LmkXdek4jkWThXrmMOjeiA71dXe3dPqV/rW71rPlMhe1BywmhGd/93NmX3UbVOj3bUXL96pYR1WU6bQVCA" +
    "fl5+X35gfmF+Yn5jfmR+ZX5mfmd+aH5pfmp+a35sfm1+bn5vfnB+cX5yfnN+dH51fnZ+d354fnl+en57fnx+fX5+fn9+gH6BfoN+hH6FfoZ+h36Ifol+in6L" +
    "fox+jX6Ofo9+kH6RfpJ+k36UfpV+ln6Xfph+mX6afpx+nX6efq5+tH67frx+1n7kfux++X8KfxB/Hn83fzl/O388fz1/Pn8/f0B/QX9Df0Z/R39If0l/Sn9L" +
    "f0x/TX9Of09/Un9TmYhhJ26DV2RmBmNGVvBi7GJpXtOWFFeDYslVh4chgUqPo1Vmg7FnZY1WhN1aamgPYuZ77pYRUXBvnIwwY/2JyGHSfwZwwm7ldAVplHL8" +
    "XsqQzmcXbWpjXlKzcmKAAU9sWeWRanDZbZ1S0k5QlveVbYV+eMp9L1EhV5JkwoCLfHts6mjxaV5Rt1OYaKhygZ7Oe/Fy+Hm7bxN0BmdOkcycpHk8g4mDVFQP" +
    "aBdOPVOJUrF4PlOGUilQiE+LT9B/Vn9Zf1t/XH9df15/YH9jf2R/ZX9mf2d/a39sf21/b39wf3N/dX92f3d/eH96f3t/fH99f39/gH+Cf4N/hH+Ff4Z/h3+I" +
    "f4l/i3+Nf49/kH+Rf5J/k3+Vf5Z/l3+Yf5l/m3+cf6B/on+jf6V/pn+of6l/qn+rf6x/rX+uf7F/s3+0f7V/tn+3f7p/u3++f8B/wn/Df8R/xn/Hf8h/yX/L" +
    "f81/z3/Qf9F/0n/Tf9Z/13/Zf9p/23/cf91/3n/if+N14nrLfJJspZa2Upt0g1TpT+mAVIOyj96VcF7JYBxtn14YZVuBOJT+YEtwvH7DfK5RyWiBfLGCb04k" +
    "j4aRz2Z+Tq6MBWSpgEpQ2nWXcc5b5Y+9b2ZOhmSClWNe1mWZUheIwnDIUqNzDnQzZ5d495cWTjSQu5zebctR241BVB1iznOyg/GW9p+ElMNPNn+aUcxwdZZ1" +
    "XK2YhlPmTuRunHQJabR4a5mPdVlSGHYkbUFn81Ftn5mAS1SZezx6v3/kf+d/6H/qf+t/7H/tf+9/8n/0f/V/9n/3f/h/+X/6f/1//n//gAKAB4AIgAmACoAO" +
    "gA+AEYATgBqAG4AdgB6AH4AhgCOAJIArgCyALYAugC+AMIAygDSAOYA6gDyAPoBAgEGARIBFgEeASIBJgE6AT4BQgFGAU4BVgFaAV4BZgFuAXIBdgF6AX4Bg" +
    "gGGAYoBjgGSAZYBmgGeAaIBrgGyAbYBugG+AcIBygHOAdIB1gHaAd4B4gHmAeoB7gHyAfZaGV4Ri4pZHaXxaBGQCe9NvD5ZLgqZTYpiFXpBwiWOzU2SGT5yB" +
    "npN4jJcyje+NQp5/b155hF9VlkZiLpp0VBWU3U+jZcVcZVxhfxWGUWwvX4tzh27kfv9c5mMbW2pu5lN1TnFjoHVlYqGPbk8mTtFspn62i7qEHYe6f1eQO5Uj" +
    "e6maoYj4hD1tG5qGftxZiJ67c5t4AYaCmmyaglYbVBdXy05wnqZTVo/IgQl3kpmShu5u4YUTZvxhYm8rgH6AgYCCgIWAiICKgI2AjoCPgJCAkYCSgJSAlYCX" +
    "gJmAnoCjgKaAp4CogKyAsICzgLWAtoC4gLmAu4DFgMeAyIDJgMqAy4DPgNCA0YDSgNOA1IDVgNiA34DggOKA44DmgO6A9YD3gPmA+4D+gP+BAIEBgQOBBIEF" +
    "gQeBCIELgQyBFYEXgRmBG4EcgR2BH4EggSGBIoEjgSSBJYEmgSeBKIEpgSqBK4EtgS6BMIEzgTSBNYE3gTmBOoE7gTyBPYE/jCmCkoMrdvJsE1/Zg71zK4MF" +
    "lRpr23fblMZTb4MCUZJePYyMjThOSHOrZ5pohZF2lwlxZGyhdwlakpVBa89/jmYnW9BZuVqaleiV907shAyEmWqsdt+VMHMbaKZbX3cvkZqXYXzcj/eMHF8l" +
    "fHN52InFbMyHHFvGXkJoyXcgfvVRlVFNUslaKX8Fl2KC12PPd4SF0HnSbjpemVmZhRFwbWwRYr92v2VPYK+V/WYOh5+eI5TtVA1UfYwsZHiBQIFBgUKBQ4FE" +
    "gUWBR4FJgU2BToFPgVKBVoFXgViBW4FcgV2BXoFfgWGBYoFjgWSBZoFogWqBa4FsgW+BcoFzgXWBdoF3gXiBgYGDgYSBhYGGgYeBiYGLgYyBjYGOgZCBkoGT" +
    "gZSBlYGWgZeBmYGagZ6Bn4GggaGBooGkgaWBp4GpgauBrIGtga6Br4GwgbGBsoG0gbWBtoG3gbiBuYG8gb2BvoG/gcSBxYHHgciByYHLgc2BzoHPgdCB0YHS" +
    "gdNkeYYRaiGBnHjoZGmbVGK5ZyuDq1ionthsq28gW96WTIwLcl9n0GLHcmFOqVnGa81Yk2auXlVS32FVZyh27ndmcmd6RmL/VOpUUJSgkKNaHH6zbBZOQ1l2" +
    "gBBZSFNXdTeWvlbKYyCBEWB8lflt1lRimYFRhVrpgP1ZrpcTUCps5Vw8Yt9PYFM/gXuQBm66hStiyF50eL5ktWN7X/VaGJF/nh9cP2NPgEJbfVVulUqVTW2F" +
    "YKhn4HLeUd1bgYHUgdWB1oHXgdiB2YHagduB3IHdgd6B34HggeGB4oHkgeWB5oHogemB64Huge+B8IHxgfKB9YH2gfeB+IH5gfqB/YH/ggOCB4IIggmCCoIL" +
    "gg6CD4IRghOCFYIWgheCGIIZghqCHYIggiSCJYImgieCKYIugjKCOoI8gj2CP4JAgkGCQoJDgkWCRoJIgkqCTIJNgk6CUIJRglKCU4JUglWCVoJXglmCW4Jc" +
    "gl2CXoJggmGCYoJjgmSCZYJmgmeCaWLnbN5yW2JtlK5+vYETbVNRnF8EWXRSqmASWXNmloZQdZ9jKmHmfO+L+lTmayeeJWu0hdVUVVB2bKRVao20cixeFWAV" +
    "dDZizWOSckxfmG5DbT5lAG9Ydth40Hb8dVRSJFPbTlNenmXBgCqA1mKbVIZSKHCuiI2N0WzhVHiA2lf5iPSNVJZqkU1PaWybVbd2xngwYqhw+W+OX22E7Gja" +
    "eHx794GoZwueT2NneLBXb3gSlzlieWKrUoh0NWvXgmqCa4Jsgm2CcYJ1gnaCd4J4gnuCfIKAgoGCg4KFgoaCh4KJgoyCkIKTgpSClYKWgpqCm4KegqCCooKj" +
    "gqeCsoK1graCuoK7gryCv4LAgsKCw4LFgsaCyYLQgtaC2YLagt2C4oLnguiC6YLqguyC7YLugvCC8oLzgvWC9oL4gvqC/IL9gv6C/4MAgwqDC4MNgxCDEoMT" +
    "gxaDGIMZgx2DHoMfgyCDIYMigyODJIMlgyaDKYMqgy6DMIMygzeDO4M9VWSBPnWydq5TOXXeUPtcQYtse8dQT3JHmpeY2G8CdOJ5aGSHd6Vi/JiRjStUwYBY" +
    "TlJXaoL5hA1ec1HtdPaLxFxPV2Fs/JiHWkZ4NJtEj+t8lVJWYlGU+k7Gg4aEYYPphLJX1Gc0VwNmbm1mjDFm3XARZx9rOmgWYhpZu04DUcRvBmfSbI9RdmjL" +
    "WUdrZ3VmXQ6BEJ9QZdd5SHlBmpGNd1yCTl5PAVQvWVF4DFZobBSPxF8DbH1s44urY5CDPoM/g0GDQoNEg0WDSINKg0uDTINNg06DU4NVg1aDV4NYg1mDXYNi" +
    "g3CDcYNyg3ODdIN1g3aDeYN6g36Df4OAg4GDgoODg4SDh4OIg4qDi4OMg42Dj4OQg5GDlIOVg5aDl4OZg5qDnYOfg6GDooOjg6SDpYOmg6eDrIOtg66Dr4O1" +
    "g7uDvoO/g8KDw4PEg8aDyIPJg8uDzYPOg9CD0YPSg9OD1YPXg9mD2oPbg96D4oPjg+SD5oPng+iD64Psg+1gcG09cnViZpSOlMVTQ4/Be35O34wmTn6e1JSx" +
    "lLNSTW9ckGNtRYw0WBFdTGsga0lnqlRbgVR/jFiZhTdfOmKiakeVOWVyYIRoZXenTlRPqF3nl5hkrH/YXO1Pz3qNUgeDBE4UYC96g5SmT7VOsnnmdDRS5IK5" +
    "ZNJ5vVvdbIGXUo97bCJQPlN/bgVkzmZ0bDBgxZh3i/dehnQ8end5y04YkLF0A2xCVtqRS2zFjYtTOobGZvKOr1xImnFuIIPug++D84P0g/WD9oP3g/qD+4P8" +
    "g/6D/4QAhAKEBYQHhAiECYQKhBCEEoQThBSEFYQWhBeEGYQahBuEHoQfhCCEIYQihCOEKYQqhCuELIQthC6EL4QwhDKEM4Q0hDWENoQ3hDmEOoQ7hD6EP4RA" +
    "hEGEQoRDhESERYRHhEiESYRKhEuETIRNhE6ET4RQhFKEU4RUhFWEVoRYhF2EXoRfhGCEYoRkhGWEZoRnhGiEaoRuhG+EcIRyhHSEd4R5hHuEfFPWWjafi42j" +
    "U7tXCJinZ0ORm2zJUWh1ymLzcqxSOFKdfzpwlHY4U3SeSmm3eG6WwIjZf6RxNnHDUYln03TkWORlGFa3i6mZdmJwftVg+XDtWOxOwU66X82X5077i6RSA1mK" +
    "fqtiVE7NZeViDoM4hMmDY4eNcZRutlu5ftJRl2PJZ9SAiYM5iBVRElt6WYKPsU5zbF1RZYklj2+WLoVKdF6VEJXwbaaC5V8xZJJtEoQogW6cw1hejVtOCVPB" +
    "hH2EfoR/hICEgYSDhISEhYSGhIqEjYSPhJCEkYSShJOElISVhJaEmISahJuEnYSehJ+EoISihKOEpISlhKaEp4SohKmEqoSrhKyErYSuhLCEsYSzhLWEtoS3" +
    "hLuEvIS+hMCEwoTDhMWExoTHhMiEy4TMhM6Ez4TShNSE1YTXhNiE2YTahNuE3ITehOGE4oTkhOeE6ITphOqE64TthO6E74TxhPKE84T0hPWE9oT3hPiE+YT6" +
    "hPuE/YT+hQCFAYUCTx5lY2hRVdNOJ2QUmppia1rCdF+Ccm2paO5Q54OOeAJnQFI5bJl+sVC7VWVxXntbZlJzyoLrZ0lccVIgcX2Ia5XqllVkxY1hgbNVhGxV" +
    "Ykd/LliSTyRVRo1PZkxOClwaiPNoomNOeg1w54KNUvqX9lwRVOiQtX7NWWKNSobHggyCDY1mZERcBGFRbYl5Pou+eDd1M1R7TziOq23xWiB+xXlebIhboVp2" +
    "dRqAvmFObhdY8HUfdSVyclNHfvOFA4UEhQWFBoUHhQiFCYUKhQuFDYUOhQ+FEIUShRSFFYUWhRiFGYUbhRyFHYUehSCFIoUjhSSFJYUmhSeFKIUphSqFLYUu" +
    "hS+FMIUxhTKFM4U0hTWFNoU+hT+FQIVBhUKFRIVFhUaFR4VLhUyFTYVOhU+FUIVRhVKFU4VUhVWFV4VYhVqFW4VchV2FX4VghWGFYoVjhWWFZoVnhWmFaoVr" +
    "hWyFbYVuhW+FcIVxhXOFdYV2hXeFeIV8hX2Ff4WAhYF3AXbbUmmA3FcjXghZMXLuZb1uf4vXXDiGcVNBd/Ni/mX2TsCY34aAW56LxlPyd+JPf1xOmnZZy18P" +
    "eTpY604WZ/9Oi2LtipOQHVK/Zi9V3FZskAJO1U+NkcqZcGwPXgJgQ1ukicaL1WU2YkuZlluIW/9jiFUuU9d2JlF9hSxnomiza4piko+TU9SCEm3RdY9OZo1O" +
    "W3Bxn4WvZpFm2X9yhwCezZ8gXF5nL4/waBFnX2INetZYhV62ZXBvMYWChYOFhoWIhYmFioWLhYyFjYWOhZCFkYWShZOFlIWVhZaFl4WYhZmFmoWdhZ6Fn4Wg" +
    "haGFooWjhaWFpoWnhamFq4Wsha2FsYWyhbOFtIW1hbaFuIW6hbuFvIW9hb6Fv4XAhcKFw4XEhcWFxoXHhciFyoXLhcyFzYXOhdGF0oXUhdaF14XYhdmF2oXb" +
    "hd2F3oXfheCF4YXiheOF5YXmheeF6IXqheuF7IXthe6F74XwhfGF8oXzhfSF9YX2hfeF+GBVUjeADWRUiHB1KV4FaBNi9JccU8xyPYwBbDR3YXoOVC53rJh6" +
    "ghyL9HhVZxRwwWWvZJVWNmAdecFT+E4da3uAhlv6VeNW2086TzyZcl3zZ36AOGACmIKQAVuLi7yL9WQcglhk3lX9gs+RZU/XfSCQH3yfUPNYUW6vW7+LyYCD" +
    "kXiEnHuXhn2Wi5aPfuWa03iOXIF6V5BClqd5X1tZY197C4TRaK1VBn8pdBB9IpUBYkBYTE7WW4NZeVhUhfmF+oX8hf2F/oYAhgGGAoYDhgSGBoYHhgiGCYYK" +
    "hguGDIYNhg6GD4YQhhKGE4YUhhWGF4YYhhmGGoYbhhyGHYYehh+GIIYhhiKGI4YkhiWGJoYohiqGK4Yshi2GLoYvhjCGMYYyhjOGNIY1hjaGN4Y5hjqGO4Y9" +
    "hj6GP4ZAhkGGQoZDhkSGRYZGhkeGSIZJhkqGS4ZMhlKGU4ZVhlaGV4ZYhlmGW4Zchl2GX4ZghmGGY4ZkhmWGZoZnhmiGaYZqc21jHo5Ljg+AzoLUYqxT8Gzw" +
    "kV5ZKmABbHBXTWRKjSp2K27pV1tqgHXwb22MLYwIV2Zr74iSeLNjolP5cK1sZFhYZCpYAmjggZtVEHzWUBiOum3MjZ9w62OPbZtu1H7mhARoQ5ADbdiWdouo" +
    "WVdyeYXkgX51vIqKaK9SVI4ilRFj0JiYjkRVfE9TZv9Wj2DVbZVSQ1xJWSlt+1hrdTB1HGBsghSBRmMRZ2GP4nc6jfONNJTBXhZThVQscMOGbYZvhnCGcoZz" +
    "hnSGdYZ2hneGeIaDhoSGhYaGhoeGiIaJho6Gj4aQhpGGkoaUhpaGl4aYhpmGmoabhp6Gn4aghqGGooalhqaGq4athq6GsoazhreGuIa5hruGvIa9hr6Gv4bB" +
    "hsKGw4bFhsiGzIbNhtKG04bVhtaG14bahtyG3YbghuGG4objhuWG5obnhuiG6obrhuyG74b1hvaG94b6hvuG/Ib9hv+HAYcEhwWHBocLhwyHDocPhxCHEYcU" +
    "hxZsQF73UFxOrV6tYzqCR5AaaFCRbnezVAyU3F9keuVodmNFe1J+33XbUHdilVk0kA9R+HnDeoFW/l+SkBRtglxgVx9UEFFUbk1W4mOomJOBf4cViSqQAFQe" +
    "XG+BwGLWYliBMZ41lkCabpp8aS1ZpWLTVT5jFlTHhtltPFoDdOaInGtqWRaMTF8vbn5zqZh9Tjhw91uMeJdjPWZadpZgy1ubWklOB4FVbGpzi06hZ4l/UV+A" +
    "ZfpnG1/YWYRaAYcZhxuHHYcfhyCHJIcmhyeHKIcqhyuHLIcthy+HMIcyhzOHNYc2hziHOYc6hzyHPYdAh0GHQodDh0SHRYdGh0qHS4dNh0+HUIdRh1KHVIdV" +
    "h1aHWIdah1uHXIddh16HX4dhh2KHZodnh2iHaYdqh2uHbIdth2+HcYdyh3OHdYd3h3iHeYd6h3+HgIeBh4SHhoeHh4mHioeMh46Hj4eQh5GHkoeUh5WHloeY" +
    "h5mHmoebh5yHnYeeh6CHoYeih6OHpF3NX65TcZfmj91oRVb0VS9g3046b01+9ILHhA5Z1E8fTypcPn6sZyqFGlRzdU+Aw1WCm09PTW4tjBNcCWFwU2t2H24p" +
    "hoplh5X7frlUO3ozfQqV7lXhf8F07mMdhxdtoXqdYhFloVNnY+Fsg13rVFyUqE5MbGGL7FxLZeCCnGinVD5UNGvLa2ZOlGNCU0iCHk8NT65XXmIKlv5mZHJp" +
    "Uv9SoWCfi+9mFHGZZ5CJf3hSd/1mcFY7VDiVIXJ6h6WHpoenh6mHqoeuh7CHsYeyh7SHtoe3h7iHuYe7h7yHvoe/h8GHwofDh8SHxYfHh8iHyYfMh82HzofP" +
    "h9CH1IfVh9aH14fYh9mH2ofch92H3offh+GH4ofjh+SH5ofnh+iH6Yfrh+yH7Yfvh/CH8Yfyh/OH9If1h/aH94f4h/qH+4f8h/2H/4gAiAGIAogEiAWIBogH" +
    "iAiICYgLiAyIDYgOiA+IEIgRiBKIFIgXiBiIGYgaiByIHYgeiB+IIIgjegBgb14MYImBnVkVYNxxhHDvbqpsUHKAaoSIrV4tTmBas1WclONtF3z7lpliD37G" +
    "d46GflMjlx6PlmaHXOFPoHLtTgtTplkPVBNjgJUoUUhO2ZycfqRUuI0kiFSCN5XybY5fJlrMZj6WaXOwcy5Tv4F6mYV/oVuqlneWUH6/dvhTopV2mZl7sYlE" +
    "blhOYX/UeWWL5mDzVM1Oq5h5XfdqYVDPVBGMYYQneF2XBFJKVO5Wo5UAbYhbtW3GZlOIJIgliCaIJ4goiCmIKogriCyILYguiC+IMIgxiDOINIg1iDaIN4g4" +
    "iDqIO4g9iD6IP4hBiEKIQ4hGiEeISIhJiEqIS4hOiE+IUIhRiFKIU4hViFaIWIhaiFuIXIhdiF6IX4hgiGaIZ4hqiG2Ib4hxiHOIdIh1iHaIeIh5iHqIe4h8" +
    "iICIg4iGiIeIiYiKiIyIjoiPiJCIkYiTiJSIlYiXiJiImYiaiJuInYieiJ+IoIihiKOIpYimiKeIqIipiKpcD1tdaCGAllV4exFlSGlUTptrR4dOl4tTT2Mf" +
    "ZDqQqmWcgMGMEFGZaLBTeIf5YchsxGz7jCJcUYWqgq+VDGsjj5tlsF/7X8NP4YhFZh+BZXMpYPpRdFIRV4tfYpCiiEyRkl54Z09gJ1nTUURR9oD4UwhseZbE" +
    "cYpPEU/uf55nPVXFlQh5wIiWfuNYn2IMlwCGWlYYmHtfkIu4hMSRV1PZZe1ej3VcYGR9blp/fup+7Y9pVadbo2CsZctzhIisiK6Ir4iwiLKIs4i0iLWItoi4" +
    "iLmIuoi7iL2Ivoi/iMCIw4jEiMeIyIjKiMuIzIjNiM+I0IjRiNOI1ojXiNqI24jciN2I3ojgiOGI5ojniOmI6ojriOyI7YjuiO+I8oj1iPaI94j6iPuI/Yj/" +
    "iQCJAYkDiQSJBYkGiQeJCIkJiQuJDIkNiQ6JD4kRiRSJFYkWiReJGIkciR2JHokfiSCJIokjiSSJJokniSiJKYksiS2JLokviTGJMokziTWJN5AJdmN3KX7a" +
    "l3SFm1tmenSW6ohAUstxj1+qZeyL4lv7mm9d4WuJbFuLrYuvkAqPxVOLYryeJp4tVEBOK4K9clmGnF0WiFltr5bFVNFOmou2cQlUvZYJcN9t+XbQTiV4FIcS" +
    "XKle9ooAmJyWDnCObL9ZRGOpdzyITW8UgnNYMHHVU4x4GpbBVQFfZnEwW7SMGpqMa4NZLp4veednaGJsT291oX+KbQuWM2wnTvB10lF7aDdvPpCAgXBZlnR2" +
    "iTiJOYk6iTuJPIk9iT6JP4lAiUKJQ4lFiUaJR4lIiUmJSolLiUyJTYlOiU+JUIlRiVKJU4lUiVWJVolXiViJWYlaiVuJXIldiWCJYYliiWOJZIlliWeJaIlp" +
    "iWqJa4lsiW2JbolviXCJcYlyiXOJdIl1iXaJd4l4iXmJeol8iX2JfomAiYKJhImFiYeJiImJiYqJi4mMiY2JjomPiZCJkYmSiZOJlImViZaJl4mYiZmJmomb" +
    "iZyJnYmeiZ+JoImhZEdcJ5BlepGMI1naVKyCAINviYGAAGkwVk6ANnI3kc5Rtk5fmHVjlk4aU/Zm84FLWRxtsk4AWPlTO2PWlPFPnU8KiGOYkFk3kFd5+07q" +
    "gPB1kWyCW5xZ6F9daQWGgVAaXfJOWXfjTuWCemKRZhOQkVx5Tr9feYHGkDiAhHWrTqaI1GEPa8Vfxk5Jdspuoovji66MCovRXwJ//H/Mfs6DNYNrVuBrt5fz" +
    "ljRZ+1QflPZt61vFmW5cOV8VlpCJoomjiaSJpYmmiaeJqImpiaqJq4msia2JromvibCJsYmyibOJtIm1ibaJt4m4ibmJuom7ibyJvYm+ib+JwInDic2J04nU" +
    "idWJ14nYidmJ24ndid+J4InhieKJ5InnieiJ6YnqieyJ7YnuifCJ8YnyifSJ9Yn2ifeJ+In5ifqJ+4n8if2J/on/igGKAooDigSKBYoGigiKCYoKiguKDIoN" +
    "ig6KD4oQihGKEooTihSKFYoWiheKGIoZihqKG4ocih1TcILxajFadJ5wXpR/KIO5hCSEJYNnh0ePzo1idshfcZiWeGxmIFTfYuVPY4HDdcheuJbNjgqG+VSP" +
    "bPNtjGw4YH9Sx3UoXn1PGGCgX+dcJHUxkK6UwHK5bLluOJFJZwlTy1PzT1GRyYvxU8hefI/CbeROjnbCaYaGXmEaggZPWU/ekD6cfGEJbh1uFJaFTohaMZbo" +
    "Tg5cf3m5W4eL7X+9c4lX34KLkMFUAZBHVbtc6l+hYQhrMnLxgLKKiYoeih+KIIohiiKKI4okiiWKJooniiiKKYoqiiuKLIotii6KL4owijGKMoozijSKNYo2" +
    "ijeKOIo5ijqKO4o8ij2KP4pAikGKQopDikSKRYpGikeKSYpKikuKTIpNik6KT4pQilGKUopTilSKVYpWileKWIpZilqKW4pcil2KXopfimCKYYpiimOKZIpl" +
    "imaKZ4poimmKaoprimyKbYpuim+KcIpxinKKc4p0inWKdop3iniKeop7inyKfYp+in+KgG10W9OI1ZiEjGuabZ4zbgpRpFFDV6OIgVOfY/SPlVbtVFhXBnM/" +
    "bpB/GI/cgtFhP2AolmJm8H6mjYqNw5SlXLN8pGcIYKaWBYAYTpGQ51MAlmhRQY/QhXSRXWZVl/VbVVMdeDhnQmg9VMlwfluwj31RjVcoVLFlEmaCjV6NQ4EP" +
    "hGyQbXzfUf+F+2ejZelvoYakjoFWapAgdoJwdnHljSNi6VIZbP2NPGAOWJ5hjmb+jWBiTlWzbiNnLY9nioGKgoqDioSKhYqGioeKiIqLioyKjYqOio+KkIqR" +
    "ipKKlIqVipaKl4qYipmKmoqbipyKnYqeip+KoIqhiqKKo4qkiqWKpoqniqiKqYqqiquKrIqtiq6Kr4qwirGKsoqzirSKtYq2ireKuIq5irqKu4q8ir2Kvoq/" +
    "isCKwYrCisOKxIrFisaKx4rIismKyorLisyKzYrOis+K0IrRitKK04rUitWK1orXitiK2YraituK3Irdit6K34rgiuGK4orjlOGV+HcoaAVpqFSLTk1wuIvI" +
    "ZFhli1uFeoRQOlvod7tr4Yp5fJhsvnbPZamPl10tXFWGOGgIU2BiGHrZblt+/WofeuBfcG8zXyBjjG2oZ1ZOCF4QjSZO14DAdjSWnGLbZi1ifmy8jXVxZ39p" +
    "UUaAh1PskG5imFTyhvCPmYAFlReFF4/ZbVlzzWWfdx91BHgngfuNHpSIT6ZnlXW5i8qXB2MvlUeWNYS4YyN3QV+BcvBOiWAUZXRi72tjZT+K5IrliuaK54ro" +
    "iumK6orriuyK7Yruiu+K8IrxivKK84r0ivWK9or3iviK+Yr6ivuK/Ir9iv6K/4sAiwGLAosDiwSLBYsGiwiLCYsKiwuLDIsNiw6LD4sQixGLEosTixSLFYsW" +
    "ixeLGIsZixqLG4scix2LHosfiyCLIYsiiyOLJIsliyeLKIspiyqLK4ssiy2LLosvizCLMYsyizOLNIs1izaLN4s4izmLOos7izyLPYs+iz+LQItBi0KLQ4tE" +
    "i0VeJ3XHkNGLwYKdZ51lL1Qxhxh35YCigQJsQU5LfseATHb0aQ1rlmJnUDxPhFdAYwdrYo2+U+pl6H64X9djGmO3gfOB9H9uXhxc2VI2Znp56XoajShwmXXU" +
    "bt5su3qSTi12xV/glJ+Id37Iec2Av5HNTvJPF4IfVGhd3m0yi8x8pY90gJheGlSSdrFbmWY8mqRz4GgqhttnMXMqi/iL25AQevlw23FuYsR3qVYxTjuEV2fx" +
    "UqmGwI0ulPh7UYtGi0eLSItJi0qLS4tMi02LTotPi1CLUYtSi1OLVItVi1aLV4tYi1mLWotbi1yLXYtei1+LYIthi2KLY4tki2WLZ4toi2mLaotri22Lbotv" +
    "i3CLcYtyi3OLdIt1i3aLd4t4i3mLeot7i3yLfYt+i3+LgIuBi4KLg4uEi4WLhouHi4iLiYuKi4uLjIuNi46Lj4uQi5GLkouTi5SLlYuWi5eLmIuZi5qLm4uc" +
    "i52Lnoufi6yLsYu7i8eL0IvqjAmMHk9PbOh5XZp7YpNyKmL9ThN4Fo9sZLCNWnvGaGlehIjFWYZknljucrZpDpUlj/2NWFdgfwCMBlHGY0li2VNTaEx0IoMB" +
    "kUxVRHdAcHxtSlF5VKiNRFn/bsttxFtcfStO1Hx9btNbUIHqbg1bV5sDaNWOKluXfvxgO361kLmNcFlPY815342zU1Jlz3lWi8WWO37ElLt+glY0kYlnAH9q" +
    "XAqQdWYoXeZPUGfeUFpPXFdQXqfoEOgR6BLoE+gUjDiMOYw6jDuMPIw9jD6MP4xAjEKMQ4xEjEWMSIxKjEuMTYxOjE+MUIxRjFKMU4xUjFaMV4xYjFmMW4xc" +
    "jF2MXoxfjGCMY4xkjGWMZoxnjGiMaYxsjG2MboxvjHCMcYxyjHSMdYx2jHeMe4x8jH2Mfox/jICMgYyDjISMhoyHjIiMi4yNjI6Mj4yQjJGMkoyTjJWMloyX" +
    "jJmMmoybjJyMnYyejJ+MoIyhjKKMo4ykjKWMpoynjKiMqYyqjKuMrIytTo1ODFFAThBe/1NFThVOmE4emzJbbFZpTih5uk4/UxVOR1ktcjtTbmwQVt+A5JmX" +
    "a9N3fp8XTjZOn58QTlxOaU6TgohbW1VsVg9OxFONU51To1OlU66XZY1dUxpT9VMmUy5TPo1cU2ZTY1ICUghSDlItUjNSP1JAUkxSXlJhUlyEr1J9UoJSgVKQ" +
    "UpNRgn9UTrtOw07JTsJO6E7hTutO3k8bTvNPIk9kTvVPJU8nTwlPK09eT2dlOE9aT12MroyvjLCMsYyyjLOMtIy1jLaMt4y4jLmMuoy7jLyMvYy+jL+MwIzB" +
    "jMKMw4zEjMWMxozHjMiMyYzKjMuMzIzNjM6Mz4zQjNGM0ozTjNSM1YzWjNeM2IzZjNqM24zcjN2M3ozfjOCM4YzijOOM5IzljOaM54zojOmM6ozrjOyM7Yzu" +
    "jO+M8IzxjPKM84z0jPWM9oz3jPiM+Yz6jPuM/Iz9jP6M/40AjQGNAo0DjQSNBY0GjQeNCI0JjQqNC40MjQ1PX09XTzJPPU92T3RPkU+JT4NPj09+T3tPqk98" +
    "T6xPlE/mT+hP6k/FT9pP40/cT9FP30/4UClQTE/zUCxQD1AuUC1P/lAcUAxQJVAoUH5QQ1BVUEhQTlBsUHtQpVCnUKlQulDWUQZQ7VDsUOZQ7lEHUQtO3Ww9" +
    "T1hPZU/On6BsRnx0UW5d/Z7JmZhRgVkUUvlTDYoHUxBR61kZUVVOoFFWTrOIboikTrWBFIjSeYBbNIgDf7hRq1GxUb1RvI0OjQ+NEI0RjRKNE40UjRWNFo0X" +
    "jRiNGY0ajRuNHI0gjVGNUo1XjV+NZY1ojWmNao1sjW6Nb41xjXKNeI15jXqNe418jX2Nfo1/jYCNgo2DjYaNh42IjYmNjI2NjY6Nj42QjZKNk42VjZaNl42Y" +
    "jZmNmo2bjZyNnY2ejaCNoY2ijaSNpY2mjaeNqI2pjaqNq42sja2Nro2vjbCNso22jbeNuY27jb2NwI3BjcKNxY3HjciNyY3Kjc2N0I3SjdON1FHHUZZRolGl" +
    "i6CLpouni6qLtIu1i7eLwovDi8uLz4vOi9KL04vUi9aL2IvZi9yL34vgi+SL6Ivpi+6L8Ivzi/aL+Yv8i/+MAIwCjASMB4wMjA+MEYwSjBSMFYwWjBmMG4wY" +
    "jB2MH4wgjCGMJYwnjCqMK4wujC+MMowzjDWMNlNpU3qWHZYiliGWMZYqlj2WPJZClkmWVJZflmeWbJZylnSWiJaNlpeWsJCXkJuQnZCZkKyQoZC0kLOQtpC6" +
    "jdWN2I3ZjdyN4I3hjeKN5Y3mjeeN6Y3tje6N8I3xjfKN9I32jfyN/o3/jgCOAY4CjgOOBI4GjgeOCI4Ljg2ODo4QjhGOEo4TjhWOFo4XjhiOGY4ajhuOHI4g" +
    "jiGOJI4ljiaOJ44ojiuOLY4wjjKOM440jjaON444jjuOPI4+jj+OQ45FjkaOTI5Njk6OT45QjlOOVI5VjlaOV45YjlqOW45cjl2OXo5fjmCOYY5ijmOOZI5l" +
    "jmeOaI5qjmuObo5xkLiQsJDPkMWQvpDQkMSQx5DTkOaQ4pDckNeQ25DrkO+Q/pEEkSKRHpEjkTGRL5E5kUORRlINWUJSolKsUq1SvlT/UtBS1lLwU99x7nfN" +
    "XvRR9VH8my9Ttl8BdVpd71dMV6lXoVh+WLxYxVjRVylXLFcqVzNXOVcuVy9XXFc7V0JXaVeFV2tXhld8V3tXaFdtV3ZXc1etV6RXjFeyV89Xp1e0V5NXoFfV" +
    "V9hX2lfZV9JXuFf0V+9X+FfkV92Oc451jneOeI55jnqOe459jn6OgI6CjoOOhI6GjoiOiY6KjouOjI6Njo6OkY6SjpOOlY6WjpeOmI6ZjpqOm46djp+OoI6h" +
    "jqKOo46kjqWOpo6njqiOqY6qjq2Oro6wjrGOs460jrWOto63jriOuY67jryOvY6+jr+OwI7BjsKOw47EjsWOxo7HjsiOyY7KjsuOzI7Njs+O0I7RjtKO047U" +
    "jtWO1o7XjtiO2Y7ajtuO3I7djt6O347gjuGO4o7jjuRYC1gNV/1X7VgAWB5YGVhEWCBYZVhsWIFYiViaWICZqJ8ZYf+CeYJ9gn+Cj4KKgqiChIKOgpGCl4KZ" +
    "gquCuIK+grCCyILKguOCmIK3gq6Cy4LMgsGCqYK0gqGCqoKfgsSCzoKkguGDCYL3guSDD4MHgtyC9ILSgtiDDIL7gtODEYMagwaDFIMVguCC1YMcg1GDW4Nc" +
    "gwiDkoM8gzSDMYObg16DL4NPg0eDQ4Nfg0CDF4Nggy2DOoMzg2aDZY7ljuaO547ojumO6o7rjuyO7Y7uju+O8I7xjvKO8470jvWO9o73jviO+Y76jvuO/I79" +
    "jv6O/48AjwGPAo8DjwSPBY8GjwePCI8JjwqPC48Mjw2PDo8PjxCPEY8SjxOPFI8VjxaPF48YjxmPGo8bjxyPHY8ejx+PII8hjyKPI48kjyWPJo8njyiPKY8q" +
    "jyuPLI8tjy6PL48wjzGPMo8zjzSPNY82jzePOI85jzqPO488jz2PPo8/j0CPQY9Cj0OPRINogxuDaYNsg2qDbYNug7CDeIOzg7SDoIOqg5ODnIOFg3yDtoOp" +
    "g32DuIN7g5iDnoOog7qDvIPBhAGD5YPYWAeEGIQLg92D/YPWhByEOIQRhAaD1IPfhA+EA4P4g/mD6oPFg8CEJoPwg+GEXIRRhFqEWYRzhIeEiIR6hImEeIQ8" +
    "hEaEaYR2hIyEjoQxhG2EwYTNhNCE5oS9hNOEyoS/hLqE4IShhLmEtISXhOWE44UMdQ2FOITwhTmFH4U6j0WPRo9Hj0iPSY9Kj0uPTI9Nj06PT49Qj1GPUo9T" +
    "j1SPVY9Wj1ePWI9Zj1qPW49cj12PXo9fj2CPYY9ij2OPZI9lj2qPgI+Mj5KPnY+gj6GPoo+kj6WPpo+nj6qPrI+tj66Pr4+yj7OPtI+1j7ePuI+6j7uPvI+/" +
    "j8CPw4/Gj8mPyo/Lj8yPzY/Pj9KP1o/Xj9qP4I/hj+OP54/sj++P8Y/yj/SP9Y/2j/qP+4/8j/6P/5AHkAiQDJAOkBOQFZAYhVaFO4T/hPyFWYVIhWiFZIVe" +
    "hXp3ooVDhXKFe4WkhaiFh4WPhXmFroWchYWFuYW3hbCF04XBhdyF/4YnhgWGKYYWhjxe/l8IWTxZQYA3WVVZWllYUw9cIlwlXCxcNGJMYmpin2K7Yspi2mLX" +
    "Yu5jImL2YzljS2NDY61j9mNxY3pjjmO0Y21jrGOKY2ljrmO8Y/Jj+GPgY/9jxGPeY85kUmPGY75kRWRBZAtkG2QgZAxkJmQhZF5khGRtZJaQGZAckCOQJJAl" +
    "kCeQKJApkCqQK5AskDCQMZAykDOQNJA3kDmQOpA9kD+QQJBDkEWQRpBIkEmQSpBLkEyQTpBUkFWQVpBZkFqQXJBdkF6QX5BgkGGQZJBmkGeQaZBqkGuQbJBv" +
    "kHCQcZBykHOQdpB3kHiQeZB6kHuQfJB+kIGQhJCFkIaQh5CJkIqQjJCNkI6Qj5CQkJKQlJCWkJiQmpCckJ6Qn5CgkKSQpZCnkKiQqZCrkK2QspC3kLyQvZC/" +
    "kMBkemS3ZLhkmWS6ZMBk0GTXZORk4mUJZSVlLl8LX9J1GV8RU19T8VP9U+lT6FP7VBJUFlQGVEtUUlRTVFRUVlRDVCFUV1RZVCNUMlSCVJRUd1RxVGRUmlSb" +
    "VIRUdlRmVJ1U0FStVMJUtFTSVKdUplTTVNRUclSjVNVUu1S/VMxU2VTaVNxUqVSqVKRU3VTPVN5VG1TnVSBU/VUUVPNVIlUjVQ9VEVUnVSpVZ1WPVbVVSVVt" +
    "VUFVVVU/VVBVPJDCkMOQxpDIkMmQy5DMkM2Q0pDUkNWQ1pDYkNmQ2pDekN+Q4JDjkOSQ5ZDpkOqQ7JDukPCQ8ZDykPOQ9ZD2kPeQ+ZD6kPuQ/JD/kQCRAZED" +
    "kQWRBpEHkQiRCZEKkQuRDJENkQ6RD5EQkRGREpETkRSRFZEWkReRGJEakRuRHJEdkR+RIJEhkSSRJZEmkSeRKJEpkSqRK5EskS2RLpEwkTKRM5E0kTWRNpE3" +
    "kTiROpE7kTyRPZE+kT+RQJFBkUKRRFU3VVZVdVV2VXdVM1UwVVxVi1XSVYNVsVW5VYhVgVWfVX5V1lWRVXtV31W9Vb5VlFWZVepV91XJVh9V0VXrVexV1FXm" +
    "Vd1VxFXvVeVV8lXzVcxVzVXoVfVV5I+UVh5WCFYMVgFWJFYjVf5WAFYnVi1WWFY5VldWLFZNVmJWWVZcVkxWVFaGVmRWcVZrVntWfFaFVpNWr1bUVtdW3Vbh" +
    "VvVW61b5Vv9XBFcKVwlXHF4PXhleFF4RXjFeO148kUWRR5FIkVGRU5FUkVWRVpFYkVmRW5FckV+RYJFmkWeRaJFrkW2Rc5F6kXuRfJGAkYGRgpGDkYSRhpGI" +
    "kYqRjpGPkZORlJGVkZaRl5GYkZmRnJGdkZ6Rn5GgkaGRpJGlkaaRp5GokamRq5GskbCRsZGykbORtpG3kbiRuZG7kbyRvZG+kb+RwJHBkcKRw5HEkcWRxpHI" +
    "kcuR0JHSkdOR1JHVkdaR15HYkdmR2pHbkd2R3pHfkeCR4ZHikeOR5JHlXjdeRF5UXlteXl5hXIxcelyNXJBcllyIXJhcmVyRXJpcnFy1XKJcvVysXKtcsVyj" +
    "XMFct1zEXNJc5FzLXOVdAl0DXSddJl0uXSRdHl0GXRtdWF0+XTRdPV1sXVtdb11dXWtdS11KXWlddF2CXZldnYxzXbddxV9zX3dfgl+HX4lfjF+VX5lfnF+o" +
    "X61ftV+8iGJfYXKtcrBytHK3crhyw3LBcs5yzXLScuhy73LpcvJy9HL3cwFy83MDcvqR5pHnkeiR6ZHqkeuR7JHtke6R75HwkfGR8pHzkfSR9ZH2kfeR+JH5" +
    "kfqR+5H8kf2R/pH/kgCSAZICkgOSBJIFkgaSB5IIkgmSCpILkgySDZIOkg+SEJIRkhKSE5IUkhWSFpIXkhiSGZIakhuSHJIdkh6SH5IgkiGSIpIjkiSSJZIm" +
    "kieSKJIpkiqSK5Iski2SLpIvkjCSMZIykjOSNJI1kjaSN5I4kjmSOpI7kjySPZI+kj+SQJJBkkKSQ5JEkkVy+3MXcxNzIXMKcx5zHXMVcyJzOXMlcyxzOHMx" +
    "c1BzTXNXc2BzbHNvc36CG1klmOdZJFkCmWOZZ5lomWmZaplrmWyZdJl3mX2ZgJmEmYeZipmNmZCZkZmTmZSZlV6AXpFei16WXqVeoF65XrVevl6zjVNe0l7R" +
    "Xtte6F7qgbpfxF/JX9Zfz2ADX+5gBF/hX+Rf/mAFYAZf6l/tX/hgGWA1YCZgG2APYA1gKWArYApgP2AhYHhgeWB7YHpgQpJGkkeSSJJJkkqSS5JMkk2STpJP" +
    "klCSUZJSklOSVJJVklaSV5JYklmSWpJbklySXZJekl+SYJJhkmKSY5JkkmWSZpJnkmiSaZJqkmuSbJJtkm6Sb5JwknGScpJzknWSdpJ3kniSeZJ6knuSfJJ9" +
    "kn6Sf5KAkoGSgpKDkoSShZKGkoeSiJKJkoqSi5KMko2Sj5KQkpGSkpKTkpSSlZKWkpeSmJKZkpqSm5Kckp2SnpKfkqCSoZKikqOSpJKlkqaSp2BqYH1glmCa" +
    "YK1gnWCDYJJgjGCbYOxgu2CxYN1g2GDGYNpgtGEgYSZhFWEjYPRhAGEOYSthSmF1YaxhlGGnYbdh1GH1X92Ws5XpleuV8ZXzlfWV9pX8lf6WA5YElgaWCJYK" +
    "lguWDJYNlg+WEpYVlhaWF5YZlhpOLHI/YhVsNWxUbFxsSmyjbIVskGyUbIxsaGxpbHRsdmyGbKls0GzUbK1s92z4bPFs12yybOBs1mz6bOts7myxbNNs72z+" +
    "kqiSqZKqkquSrJKtkq+SsJKxkrKSs5K0krWStpK3kriSuZK6kruSvJK9kr6Sv5LAksGSwpLDksSSxZLGkseSyZLKksuSzJLNks6Sz5LQktGS0pLTktSS1ZLW" +
    "kteS2JLZktqS25Lckt2S3pLfkuCS4ZLikuOS5JLlkuaS55LokumS6pLrkuyS7ZLuku+S8JLxkvKS85L0kvWS9pL3kviS+ZL6kvuS/JL9kv6S/5MAkwGTApMD" +
    "kwSTBZMGkweTCJMJbTltJ20MbUNtSG0HbQRtGW0ObSttTW0ubTVtGm1PbVJtVG0zbZFtb22ebaBtXm2TbZRtXG1gbXxtY24abcdtxW3ebg5tv23gbhFt5m3d" +
    "bdluFm2rbgxtrm4rbm5uTm5rbrJuX26GblNuVG4ybiVuRG7fbrFumG7gby1u4m6lbqduvW67brdu1260bs9uj27Cbp9vYm9Gb0dvJG8VbvlvL282b0tvdG8q" +
    "bwlvKW+Jb41vjG94b3JvfG96b9GTCpMLkwyTDZMOkw+TEJMRkxKTE5MUkxWTFpMXkxiTGZMakxuTHJMdkx6TH5MgkyGTIpMjkySTJZMmkyeTKJMpkyqTK5Ms" +
    "ky2TLpMvkzCTMZMykzOTNJM1kzaTN5M4kzmTOpM7kzyTPZM/k0CTQZNCk0OTRJNFk0aTR5NIk0mTSpNLk0yTTZNOk0+TUJNRk1KTU5NUk1WTVpNXk1iTWZNa" +
    "k1uTXJNdk16TX5Ngk2GTYpNjk2STZZNmk2eTaJNpk2tvyW+nb7lvtm/Cb+Fv7m/eb+Bv73AacCNwG3A5cDVwT3BeW4BbhFuVW5NbpVu4dS+anmQ0W+Rb7okw" +
    "W/COR4sHj7aP04/Vj+WP7o/kj+mP5o/zj+iQBZAEkAuQJpARkA2QFpAhkDWQNpAtkC+QRJBRkFKQUJBokFiQYpBbZrmQdJB9kIKQiJCDkItfUF9XX1ZfWFw7" +
    "VKtcUFxZW3FcY1xmf7xfKl8pXy2CdF88mztcblmBWYNZjVmpWapZo5Nsk22TbpNvk3CTcZNyk3OTdJN1k3aTd5N4k3mTepN7k3yTfZN+k3+TgJOBk4KTg5OE" +
    "k4WThpOHk4iTiZOKk4uTjJONk46TkJORk5KTk5OUk5WTlpOXk5iTmZOak5uTnJOdk56Tn5Ogk6GTopOjk6STpZOmk6eTqJOpk6qTq5Osk62TrpOvk7CTsZOy" +
    "k7OTtJO1k7aTt5O4k7mTupO7k7yTvZO+k7+TwJPBk8KTw5PEk8WTxpPHk8iTyZPLk8yTzVmXWcpZq1meWaRZ0lmyWa9Z11m+WgVaBlndWghZ41nYWflaDFoJ" +
    "WjJaNFoRWiNaE1pAWmdaSlpVWjxaYlp1gOxaqlqbWndaelq+WutaslrSWtRauFrgWuNa8VrWWuZa2FrcWwlbF1sWWzJbN1tAXBVcHFtaW2Vbc1tRW1NbYpp1" +
    "mneaeJp6mn+afZqAmoGahZqImoqakJqSmpOalpqYmpuanJqdmp+aoJqimqOapZqnfp9+oX6jfqV+qH6pk86Tz5PQk9GT0pPTk9ST1ZPXk9iT2ZPak9uT3JPd" +
    "k96T35Pgk+GT4pPjk+ST5ZPmk+eT6JPpk+qT65Psk+2T7pPvk/CT8ZPyk/OT9JP1k/aT95P4k/mT+pP7k/yT/ZP+k/+UAJQBlAKUA5QElAWUBpQHlAiUCZQK" +
    "lAuUDJQNlA6UD5QQlBGUEpQTlBSUFZQWlBeUGJQZlBqUG5QclB2UHpQflCCUIZQilCOUJJQllCaUJ5QolCmUKpQrlCyULZQufq1+sH6+fsB+wX7Cfsl+y37M" +
    "ftB+1H7Xftt+4H7hfuh+637ufu9+8X7yfw1+9n76fvt+/n8BfwJ/A38Hfwh/C38Mfw9/EX8Sfxd/GX8cfxt/H38hfyJ/I38kfyV/Jn8nfyp/K38sfy1/L38w" +
    "fzF/Mn8zfzVeenV/Xdt1PpCVc45zkXOuc6Jzn3PPc8Jz0XO3c7NzwHPJc8hz5XPZmHx0CnPpc+dz3nO6c/J0D3QqdFt0JnQldCh0MHQudCyUL5QwlDGUMpQz" +
    "lDSUNZQ2lDeUOJQ5lDqUO5Q8lD2UP5RAlEGUQpRDlESURZRGlEeUSJRJlEqUS5RMlE2UTpRPlFCUUZRSlFOUVJRVlFaUV5RYlFmUWpRblFyUXZRelF+UYJRh" +
    "lGKUY5RklGWUZpRnlGiUaZRqlGyUbZRulG+UcJRxlHKUc5R0lHWUdpR3lHiUeZR6lHuUfJR9lH6Uf5SAlIGUgpSDlISUkZSWlJiUx5TPlNOU1JTalOaU+5Uc" +
    "lSB0G3QadEF0XHRXdFV0WXR3dG10fnScdI50gHSBdId0i3SedKh0qXSQdKd00nS6l+qX65fsZ0xnU2deZ0hnaWelZ4dnamdzZ5hnp2d1Z6hnnmetZ4tnd2d8" +
    "Z/BoCWfYaApn6WewaAxn2We1Z9pns2fdaABnw2e4Z+JoDmfBZ/1oMmgzaGBoYWhOaGJoRGhkaINoHWhVaGZoQWhnaEBoPmhKaEloKWi1aI9odGh3aJNoa2jC" +
    "aW5o/GkfaSBo+ZUnlTOVPZVDlUiVS5VVlVqVYJVulXSVdZV3lXiVeZV6lXuVfJV9lX6VgJWBlYKVg5WElYWVhpWHlYiViZWKlYuVjJWNlY6Vj5WQlZGVkpWT" +
    "lZSVlZWWlZeVmJWZlZqVm5WclZ2VnpWflaCVoZWilaOVpJWllaaVp5WolamVqpWrlayVrZWula+VsJWxlbKVs5W0lbWVtpW3lbiVuZW6lbuVvJW9lb6Vv5XA" +
    "lcGVwpXDlcSVxZXGlceVyJXJlcqVy2kkaPBpC2kBaVdo42kQaXFpOWlgaUJpXWmEaWtpgGmYaXhpNGnMaYdpiGnOaYlpZmljaXlpm2mnabtpq2mtadRpsWnB" +
    "acpp32mVaeBpjWn/ai9p7WoXahhqZWnyakRqPmqgalBqW2o1ao5qeWo9aihqWGp8apFqkGqpapdqq3M3c1JrgWuCa4drhGuSa5NrjWuaa5troWuqj2uPbY9x" +
    "j3KPc491j3aPeI93j3mPeo98j36PgY+Cj4SPh4+LlcyVzZXOlc+V0JXRldKV05XUldWV1pXXldiV2ZXalduV3JXdld6V35XgleGV4pXjleSV5ZXmleeV7JX/" +
    "lgeWE5YYlhuWHpYgliOWJJYlliaWJ5YolimWK5Ysli2WL5YwljeWOJY5ljqWPpZBlkOWSpZOlk+WUZZSllOWVpZXlliWWZZallyWXZZelmCWY5ZllmaWa5Zt" +
    "lm6Wb5ZwlnGWc5Z4lnmWepZ7lnyWfZZ+ln+WgJaBloKWg5aEloeWiZaKj42Pjo+Pj5iPmo7OYgtiF2IbYh9iImIhYiViJGIsged073T0dP91D3URdRNlNGXu" +
    "Ze9l8GYKZhlncmYDZhVmAHCFZvdmHWY0ZjFmNmY1gAZmX2ZUZkFmT2ZWZmFmV2Z3ZoRmjGanZp1mvmbbZtxm5mbpjTKNM402jTuNPY1AjUWNRo1IjUmNR41N" +
    "jVWNWYnHicqJy4nMic6Jz4nQidFybnKfcl1yZnJvcn5yf3KEcotyjXKPcpJjCGMyY7CWjJaOlpGWkpaTlpWWlpaalpuWnZaelp+WoJahlqKWo5aklqWWppao" +
    "lqmWqparlqyWrZaulq+WsZaylrSWtZa3lriWupa7lr+WwpbDlsiWypbLltCW0ZbTltSW1pbXltiW2ZbaltuW3Jbdlt6W35bhluKW45bkluWW5pbnluuW7Jbt" +
    "lu6W8JbxlvKW9Jb1lviW+pb7lvyW/Zb/lwKXA5cFlwqXC5cMlxCXEZcSlxSXFZcXlxiXGZcalxuXHZcflyBkP2TYgARr6mvza/1r9Wv5bAVsB2wGbA1sFWwY" +
    "bBlsGmwhbClsJGwqbDJlNWVVZWtyTXJSclZyMIZiUhaAn4CcgJOAvGcKgL2AsYCrgK2AtIC3gOeA6IDpgOqA24DCgMSA2YDNgNdnEIDdgOuA8YD0gO2BDYEO" +
    "gPKA/GcVgRKMWoE2gR6BLIEYgTKBSIFMgVOBdIFZgVqBcYFggWmBfIF9gW2BZ1hNWrWBiIGCgZFu1YGjgaqBzGcmgcqBu5chlyKXI5cklyWXJpcnlyiXKZcr" +
    "lyyXLpcvlzGXM5c0lzWXNpc3lzqXO5c8lz2XP5dAl0GXQpdDl0SXRZdGl0eXSJdJl0qXS5dMl02XTpdPl1CXUZdUl1WXV5dYl1qXXJddl1+XY5dkl2aXZ5do" +
    "l2qXa5dsl22Xbpdvl3CXcZdyl3WXd5d4l3mXepd7l32Xfpd/l4CXgZeCl4OXhJeGl4eXiJeJl4qXjJeOl4+XkJeTl5WXlpeXl5mXmpebl5yXnYHBgaZrJGs3" +
    "azlrQ2tGa1mY0ZjSmNOY1ZjZmNprs19Aa8KJ82WQn1Flk2W8ZcZlxGXDZcxlzmXSZdZwgHCccJZwnXC7cMBwt3CrcLFw6HDKcRBxE3EWcS9xMXFzcVxxaHFF" +
    "cXJxSnF4cXpxmHGzcbVxqHGgceBx1HHncflyHXIocGxxGHFmcbliPmI9YkNiSGJJeTt5QHlGeUl5W3lceVN5WnlieVd5YHlveWd5enmFeYp5mnmnebNf0V/Q" +
    "l56Xn5ehl6KXpJell6aXp5eol6mXqpesl66XsJexl7OXtZe2l7eXuJe5l7qXu5e8l72Xvpe/l8CXwZfCl8OXxJfFl8aXx5fIl8mXypfLl8yXzZfOl8+X0JfR" +
    "l9KX05fUl9WX1pfXl9iX2Zfal9uX3Jfdl96X35fgl+GX4pfjl+SX5Zfol+6X75fwl/GX8pf0l/eX+Jf5l/qX+5f8l/2X/pf/mACYAZgCmAOYBJgFmAaYB5gI" +
    "mAmYCpgLmAyYDZgOYDxgXWBaYGdgQWBZYGNgq2EGYQ1hXWGpYZ1hy2HRYgaAgIB/bJNs9m38d/Z3+HgAeAl4F3gYeBFlq3gteBx4HXg5eDp4O3gfeDx4JXgs" +
    "eCN4KXhOeG14VnhXeCZ4UHhHeEx4anibeJN4mniHeJx4oXijeLJ4uXileNR42XjJeOx48nkFePR5E3kkeR55NJ+bnvme+578dvF3BHcNdvl3B3cIdxp3IncZ" +
    "dy13Jnc1dzh3UHdRd0d3Q3dad2iYD5gQmBGYEpgTmBSYFZgWmBeYGJgZmBqYG5gcmB2YHpgfmCCYIZgimCOYJJglmCaYJ5gomCmYKpgrmCyYLZgumC+YMJgx" +
    "mDKYM5g0mDWYNpg3mDiYOZg6mDuYPJg9mD6YP5hAmEGYQphDmESYRZhGmEeYSJhJmEqYS5hMmE2YTphPmFCYUZhSmFOYVJhVmFaYV5hYmFmYWphbmFyYXZhe" +
    "mF+YYJhhmGKYY5hkmGWYZphnmGiYaZhqmGuYbJhtmG53Yndld393jXd9d4B3jHeRd593oHewd7V3vXU6dUB1TnVLdUh1W3VydXl1g39Yf2F/X4pIf2h/dH9x" +
    "f3l/gX9+ds125YgylIWUhpSHlIuUipSMlI2Uj5SQlJSUl5SVlJqUm5SclKOUpJSrlKqUrZSslK+UsJSylLSUtpS3lLiUuZS6lLyUvZS/lMSUyJTJlMqUy5TM" +
    "lM2UzpTQlNGU0pTVlNaU15TZlNiU25TelN+U4JTilOSU5ZTnlOiU6phvmHCYcZhymHOYdJiLmI6YkpiVmJmYo5iomKmYqpirmKyYrZiumK+YsJixmLKYs5i0" +
    "mLWYtpi3mLiYuZi6mLuYvJi9mL6Yv5jAmMGYwpjDmMSYxZjGmMeYyJjJmMqYy5jMmM2Yz5jQmNSY1pjXmNuY3JjdmOCY4ZjimOOY5JjlmOaY6ZjqmOuY7Jjt" +
    "mO6Y75jwmPGY8pjzmPSY9Zj2mPeY+Jj5mPqY+5j8mP2Y/pj/mQCZAZkCmQOZBJkFmQaZB5TplOuU7pTvlPOU9JT1lPeU+ZT8lP2U/5UDlQKVBpUHlQmVCpUN" +
    "lQ6VD5USlROVFJUVlRaVGJUblR2VHpUflSKVKpUrlSmVLJUxlTKVNJU2lTeVOJU8lT6VP5VClTWVRJVFlUaVSZVMlU6VT5VSlVOVVJVWlVeVWJVZlVuVXpVf" +
    "lV2VYZVilWSVZZVmlWeVaJVplWqVa5VslW+VcZVylXOVOnfnd+yWyXnVee1543nregZdR3oDegJ6HnoUmQiZCZkKmQuZDJkOmQ+ZEZkSmROZFJkVmRaZF5kY" +
    "mRmZGpkbmRyZHZkemR+ZIJkhmSKZI5kkmSWZJpknmSiZKZkqmSuZLJktmS+ZMJkxmTKZM5k0mTWZNpk3mTiZOZk6mTuZPJk9mT6ZP5lAmUGZQplDmUSZRZlG" +
    "mUeZSJlJmUqZS5lMmU2ZTplPmVCZUZlSmVOZVplXmViZWZlamVuZXJldmV6ZX5lgmWGZYplkmWaZc5l4mXmZe5l+mYKZg5mJejl6N3pRns+ZpXpwdoh2jnaT" +
    "dpl2pHTedOB1LJ4gniKeKJ4pniqeK54snjKeMZ42njieN545njqePp5BnkKeRJ5GnkeeSJ5JnkueTJ5OnlGeVZ5XnlqeW55cnl6eY55mnmeeaJ5pnmqea55s" +
    "nnGebZ5zdZJ1lHWWdaB1nXWsdaN1s3W0dbh1xHWxdbB1w3XCddZ1zXXjdeh15nXkdet153YDdfF1/HX/dhB2AHYFdgx2F3YKdiV2GHYVdhmZjJmOmZqZm5mc" +
    "mZ2ZnpmfmaCZoZmimaOZpJmmmaeZqZmqmauZrJmtma6Zr5mwmbGZspmzmbSZtZm2mbeZuJm5mbqZu5m8mb2Zvpm/mcCZwZnCmcOZxJnFmcaZx5nImcmZypnL" +
    "mcyZzZnOmc+Z0JnRmdKZ05nUmdWZ1pnXmdiZ2ZnamduZ3Jndmd6Z35ngmeGZ4pnjmeSZ5ZnmmeeZ6JnpmeqZ65nsme2Z7pnvmfCZ8ZnymfOZ9Jn1mfaZ95n4" +
    "mfl2G3Y8diJ2IHZAdi12MHY/djV2Q3Y+djN2TXZedlR2XHZWdmt2b3/KeuZ6eHp5eoB6hnqIepV6pnqgeqx6qHqterOIZIhpiHKIfYh/iIKIoojGiLeIvIjJ" +
    "iOKIzojjiOWI8YkaiPyI6Ij+iPCJIYkZiROJG4kKiTSJK4k2iUGJZol7dYuA5XaydrR33IASgBSAFoAcgCCAIoAlgCaAJ4ApgCiAMYALgDWAQ4BGgE2AUoBp" +
    "gHGJg5h4mICYg5n6mfuZ/Jn9mf6Z/5oAmgGaApoDmgSaBZoGmgeaCJoJmgqaC5oMmg2aDpoPmhCaEZoSmhOaFJoVmhaaF5oYmhmaGpobmhyaHZoemh+aIJoh" +
    "miKaI5okmiWaJponmiiaKZoqmiuaLJotmi6aL5owmjGaMpozmjSaNZo2mjeaOJo5mjqaO5o8mj2aPpo/mkCaQZpCmkOaRJpFmkaaR5pImkmaSppLmkyaTZpO" +
    "mk+aUJpRmlKaU5pUmlWaVppXmliaWZiJmIyYjZiPmJSYmpibmJ6Yn5ihmKKYpZimhk2GVIZshm6Gf4Z6hnyGe4aoho2Gi4ashp2Gp4ajhqqGk4aphraGxIa1" +
    "hs6GsIa6hrGGr4bJhs+GtIbphvGG8obthvOG0IcTht6G9IbfhtiG0YcDhweG+IcIhwqHDYcJhyOHO4cehyWHLocahz6HSIc0hzGHKYc3hz+Hgocih32Hfod7" +
    "h2CHcIdMh26Hi4dTh2OHfIdkh1mHZYeTh6+HqIfSmlqaW5pcml2aXppfmmCaYZpimmOaZJplmmaaZ5pommmaapprmnKag5qJmo2ajpqUmpWamZqmmqmaqpqr" +
    "mqyarZqumq+aspqzmrSatZq5mruavZq+mr+aw5rEmsaax5rImsmayprNms6az5rQmtKa1JrVmtaa15rZmtqa25rcmt2a3prgmuKa45rkmuWa55romuma6prs" +
    "mu6a8JrxmvKa85r0mvWa9pr3mvia+pr8mv2a/pr/mwCbAZsCmwSbBZsGh8aHiIeFh62Hl4eDh6uH5Yesh7WHs4fLh9OHvYfRh8CHyofbh+qH4IfuiBaIE4f+" +
    "iAqIG4ghiDmIPH82f0J/RH9FghB6+nr9ewh7A3sEexV7Cnsrew97R3s4eyp7GXsuezF7IHsleyR7M3s+ex57WHtae0V7dXtMe117YHtue3t7Yntye3F7kHum" +
    "e6d7uHuse517qHuFe6p7nHuie6t7tHvRe8F7zHvde9p75Xvme+p8DHv+e/x8D3wWfAubB5sJmwqbC5sMmw2bDpsQmxGbEpsUmxWbFpsXmxibGZsamxubHJsd" +
    "mx6bIJshmyKbJJslmyabJ5somymbKpsrmyybLZsumzCbMZszmzSbNZs2mzebOJs5mzqbPZs+mz+bQJtGm0qbS5tMm06bUJtSm1ObVZtWm1ebWJtZm1qbW5tc" +
    "m12bXptfm2CbYZtim2ObZJtlm2abZ5tom2mbaptrm2ybbZtum2+bcJtxm3Kbc5t0m3Wbdpt3m3ibeZt6m3t8H3wqfCZ8OHxBfECB/oIBggKCBIHsiESCIYIi" +
    "giOCLYIvgiiCK4I4gjuCM4I0gj6CRIJJgkuCT4Jagl+CaIh+iIWIiIjYiN+JXn+df59/p3+vf7B/snx8ZUl8kXydfJx8nnyifLJ8vHy9fMF8x3zMfM18yHzF" +
    "fNd86IJuZqh/v3/Of9V/5X/hf+Z/6X/uf/N8+H13faZ9rn5HfpueuJ60jXONhI2UjZGNsY1njW2MR4xJkUqRUJFOkU+RZJt8m32bfpt/m4CbgZuCm4ObhJuF" +
    "m4abh5uIm4mbipuLm4ybjZuOm4+bkJuRm5Kbk5uUm5WblpuXm5ibmZuam5ubnJudm56bn5ugm6Gbopujm6SbpZumm6ebqJupm6qbq5usm62brpuvm7CbsZuy" +
    "m7ObtJu1m7abt5u4m7mbupu7m7ybvZu+m7+bwJvBm8Kbw5vEm8WbxpvHm8ibyZvKm8ubzJvNm86bz5vQm9Gb0pvTm9Sb1ZvWm9eb2JvZm9qb25FikWGRcJFp" +
    "kW+RfZF+kXKRdJF5kYyRhZGQkY2RkZGikaORqpGtka6Rr5G1kbSRuoxVnn6NuI3rjgWOWY5pjbWNv428jbqNxI3WjdeN2o3ejc6Nz43bjcaN7I33jfiN4435" +
    "jfuN5I4Jjf2OFI4djh+OLI4ujiOOL446jkCOOY41jj2OMY5JjkGOQo5RjlKOSo5wjnaOfI5vjnSOhY6PjpSOkI6cjp6MeIyCjIqMhYyYjJRlm4nWid6J2onc" +
    "m9yb3Zvem9+b4Jvhm+Kb45vkm+Wb5pvnm+ib6Zvqm+ub7Jvtm+6b75vwm/Gb8pvzm/Sb9Zv2m/eb+Jv5m/qb+5v8m/2b/pv/nACcAZwCnAOcBJwFnAacB5wI" +
    "nAmcCpwLnAycDZwOnA+cEJwRnBKcE5wUnBWcFpwXnBicGZwanBucHJwdnB6cH5wgnCGcIpwjnCScJZwmnCecKJwpnCqcK5wsnC2cLpwvnDCcMZwynDOcNJw1" +
    "nDacN5w4nDmcOpw7ieWJ64nvij6LJpdTlumW85bvlwaXAZcIlw+XDpcqly2XMJc+n4Cfg5+Fn4afh5+In4mfip+Mnv6fC58NlrmWvJa9ls6W0ne/luCSjpKu" +
    "ksiTPpNqk8qTj5Q+lGucf5yCnIWchpyHnIh6I5yLnI6ckJyRnJKclJyVnJqcm5yenJ+coJyhnKKco5ylnKacp5yonKmcq5ytnK6csJyxnLKcs5y0nLWctpy3" +
    "nLqcu5y8nL2cxJzFnMacx5zKnMucPJw9nD6cP5xAnEGcQpxDnEScRZxGnEecSJxJnEqcS5xMnE2cTpxPnFCcUZxSnFOcVJxVnFacV5xYnFmcWpxbnFycXZxe" +
    "nF+cYJxhnGKcY5xknGWcZpxnnGicaZxqnGucbJxtnG6cb5xwnHGccpxznHScdZx2nHeceJx5nHqce5x9nH6cgJyDnISciZyKnIycj5yTnJacl5yYnJmcnZyq" +
    "nKycr5y5nL6cv5zAnMGcwpzInMmc0ZzSnNqc25zgnOGczJzNnM6cz5zQnNOc1JzVnNec2JzZnNyc3ZzfnOKXfJeFl5GXkpeUl6+Xq5ejl7KXtJqxmrCat55Y" +
    "mraaupq8msGawJrFmsKay5rMmtGbRZtDm0ebSZtIm02bUZjomQ2ZLplVmVSa35rhmuaa75rrmvua7Zr5mwibD5sTmx+bI569nr5+O56CnoeeiJ6LnpKT1p6d" +
    "np+e257cnt2e4J7fnuKe6Z7nnuWe6p7vnyKfLJ8vnzmfN589nz6fRJzjnOSc5ZzmnOec6JzpnOqc65zsnO2c7pzvnPCc8ZzynPOc9Jz1nPac95z4nPmc+pz7" +
    "nPyc/Zz+nP+dAJ0BnQKdA50EnQWdBp0HnQidCZ0KnQudDJ0NnQ6dD50QnRGdEp0TnRSdFZ0WnRedGJ0ZnRqdG50cnR2dHp0fnSCdIZ0inSOdJJ0lnSadJ50o" +
    "nSmdKp0rnSydLZ0unS+dMJ0xnTKdM500nTWdNp03nTidOZ06nTudPJ09nT6dP51AnUGdQuI04jXiNuI34jjiOeI64jviPOI94j7iP+JA4kHiQuJD4kTiReJG" +
    "4kfiSOJJ4kriS+JM4k3iTuJP4lDiUeJS4lPiVOJV4lbiV+JY4lniWuJb4lziXeJe4l/iYOJh4mLiY+Jk4mXiZuJn4mjiaeJq4mvibOJt4m7ib+Jw4nHicuJz" +
    "4nTideJ24nfieOJ54nrie+J84n3ifuJ/4oDigeKC4oPihOKF4obih+KI4oniiuKL4ozijeKO4o/ikOKRnUOdRJ1FnUadR51InUmdSp1LnUydTZ1OnU+dUJ1R" +
    "nVKdU51UnVWdVp1XnVidWZ1anVudXJ1dnV6dX51gnWGdYp1jnWSdZZ1mnWedaJ1pnWqda51snW2dbp1vnXCdcZ1ynXOddJ11nXadd514nXmdep17nXydfZ1+" +
    "nX+dgJ2BnYKdg52EnYWdhp2HnYidiZ2KnYudjJ2NnY6dj52QnZGdkp2TnZSdlZ2WnZedmJ2ZnZqdm52cnZ2dnp2fnaCdoZ2i4pLik+KU4pXiluKX4pjimeKa" +
    "4pvinOKd4p7in+Kg4qHiouKj4qTipeKm4qfiqOKp4qriq+Ks4q3iruKv4rDiseKy4rPitOK14rbit+K44rniuuK74rziveK+4r/iwOLB4sLiw+LE4sXixuLH" +
    "4sjiyeLK4svizOLN4s7iz+LQ4tHi0uLT4tTi1eLW4tfi2OLZ4tri2+Lc4t3i3uLf4uDi4eLi4uPi5OLl4ubi5+Lo4uni6uLr4uzi7eLu4u+do52knaWdpp2n" +
    "naidqZ2qnaudrJ2tna6dr52wnbGdsp2znbSdtZ22nbeduJ25nbqdu528nb2dvp2/ncCdwZ3CncOdxJ3Fncadx53Incmdyp3LncydzZ3Onc+d0J3RndKd053U" +
    "ndWd1p3Xndid2Z3andud3J3dnd6d353gneGd4p3jneSd5Z3mneed6J3pneqd653sne2d7p3vnfCd8Z3ynfOd9J31nfad9534nfmd+p37nfyd/Z3+nf+eAJ4B" +
    "ngLi8OLx4vLi8+L04vXi9uL34vji+eL64vvi/OL94v7i/+MA4wHjAuMD4wTjBeMG4wfjCOMJ4wrjC+MM4w3jDuMP4xDjEeMS4xPjFOMV4xbjF+MY4xnjGuMb" +
    "4xzjHeMe4x/jIOMh4yLjI+Mk4yXjJuMn4yjjKeMq4yvjLOMt4y7jL+Mw4zHjMuMz4zTjNeM24zfjOOM54zrjO+M84z3jPuM/40DjQeNC40PjRONF40bjR+NI" +
    "40njSuNL40zjTZ4DngSeBZ4GngeeCJ4JngqeC54Mng2eDp4PnhCeEZ4SnhOeFJ4VnhaeF54YnhmeGp4bnhyeHZ4eniSeJ54unjCeNJ47njyeQJ5NnlCeUp5T" +
    "nlSeVp5Znl2eX55gnmGeYp5lnm6eb55ynnSedZ52nneeeJ55nnqee558nn2egJ6BnoOehJ6FnoaeiZ6KnoyejZ6Ono+ekJ6RnpSelZ6WnpeemJ6Znpqem56c" +
    "np6eoJ6hnqKeo56knqWep56onqmequNO40/jUONR41LjU+NU41XjVuNX41jjWeNa41vjXONd417jX+Ng42HjYuNj42TjZeNm42fjaONp42rja+Ns423jbuNv" +
    "43DjceNy43PjdON143bjd+N443njeuN743zjfeN+43/jgOOB44Ljg+OE44XjhuOH44jjieOK44vjjOON447jj+OQ45HjkuOT45TjleOW45fjmOOZ45rjm+Oc" +
    "453jnuOf46DjoeOi46PjpOOl46bjp+Oo46njquOrnquerJ6tnq6er56wnrGesp6znrWetp63nrmeup68nr+ewJ7BnsKew57Fnsaex57Insqey57MntCe0p7T" +
    "ntWe1p7Xntme2p7enuGe457knuae6J7rnuye7Z7unvCe8Z7ynvOe9J71nvae9574nvqe/Z7/nwCfAZ8CnwOfBJ8FnwafB58InwmfCp8Mnw+fEZ8SnxSfFZ8W" +
    "nxifGp8bnxyfHZ8enx+fIZ8jnySfJZ8mnyefKJ8pnyqfK58tny6fMJ8x46zjreOu46/jsOOx47Ljs+O047XjtuO347jjueO647vjvOO9477jv+PA48HjwuPD" +
    "48TjxePG48fjyOPJ48rjy+PM483jzuPP49Dj0ePS49Pj1OPV49bj1+PY49nj2uPb49zj3ePe49/j4OPh4+Lj4+Pk4+Xj5uPn4+jj6ePq4+vj7OPt4+7j7+Pw" +
    "4/Hj8uPz4/Tj9eP24/fj+OP54/rj++P84/3j/uP/5ADkAeQC5APkBOQF5AbkB+QI5AmfMp8znzSfNZ82nzifOp88nz+fQJ9Bn0KfQ59Fn0afR59In0mfSp9L" +
    "n0yfTZ9On0+fUp9Tn1SfVZ9Wn1efWJ9Zn1qfW59cn12fXp9fn2CfYZ9in2OfZJ9ln2afZ59on2mfap9rn2yfbZ9un2+fcJ9xn3Kfc590n3Wfdp93n3ifeZ96" +
    "n3uffJ99n36fgZ+Cn42fjp+Pn5CfkZ+Sn5OflJ+Vn5afl5+Yn5yfnZ+en6Gfop+jn6Sfpfks+Xn5lfnn+fHkCuQL5AzkDeQO5A/kEOQR5BLkE+QU5BXkFuQX" +
    "5BjkGeQa5BvkHOQd5B7kH+Qg5CHkIuQj5CTkJeQm5CfkKOQp5CrkK+Qs5C3kLuQv5DDkMeQy5DPkNOQ15DbkN+Q45DnkOuQ75DzkPeQ+5D/kQORB5ELkQ+RE" +
    "5EXkRuRH5EjkSeRK5EvkTORN5E7kT+RQ5FHkUuRT5FTkVeRW5FfkWORZ5FrkW+Rc5F3kXuRf5GDkYeRi5GPkZORl5GbkZ/oM+g36DvoP+hH6E/oU+hj6H/og" +
    "+iH6I/ok+if6KPopLoHoFugX6BguhDRzNEcuiC6Ln7Q1njYaNg4ujC6XOW45GJ+1Oc853zpzOdCftp+3O048bjzgLqfoMZ+4LqpAVkFfLq5DNy6zLrYut+g7" +
    "Q7FDrC67Q91E1kZhRkyfuUcjRylHfEeNLspJR0l6SX1JgkmDSYVJhkmfSZtJt0m2n7roVUyjTJ9MoEyhTHdMok0TTRRNFU0WTRdNGE0ZTa6fu+Ro5GnkauRr" +
    "5GzkbeRu5G/kcORx5HLkc+R05HXkduR35HjkeeR65HvkfOR95H7kf+SA5IHkguSD5ITkheSG5IfkiOSJ5Irki+SM5I3kjuSP5JDkkeSS5JPklOSV5Jbkl+SY" +
    "5JnkmuSb5JzkneSe5J/koOSh5KLko+Sk5KXkpuSn5KjkqeSq5KvkrOSt5K7kr+Sw5LHksuSz5LTkteS25LfkuOS55Lrku+S85L3kvuS/5MDkweTC5MPkxOTF";
  var GB18030_RANGES = [
    0x80, 0x0, 0xA5, 0x24, 0xA9, 0x26, 0xB2, 0x2D, 0xB8, 0x32, 0xD8, 0x51, 0xE2, 0x59, 0xEB, 0x5F,
    0xEE, 0x60, 0xF4, 0x64, 0xF8, 0x67, 0xFB, 0x68, 0xFD, 0x69, 0x102, 0x6D, 0x114, 0x7E, 0x11C, 0x85,
    0x12C, 0x94, 0x145, 0xAC, 0x149, 0xAF, 0x14E, 0xB3, 0x16C, 0xD0, 0x1CF, 0x132, 0x1D1, 0x133, 0x1D3, 0x134,
    0x1D5, 0x135, 0x1D7, 0x136, 0x1D9, 0x137, 0x1DB, 0x138, 0x1DD, 0x139, 0x1FA, 0x155, 0x252, 0x1AC, 0x262, 0x1BB,
    0x2C8, 0x220, 0x2CC, 0x221, 0x2DA, 0x22E, 0x3A2, 0x2E5, 0x3AA, 0x2E6, 0x3C2, 0x2ED, 0x3CA, 0x2EE, 0x402, 0x325,
    0x450, 0x333, 0x452, 0x334, 0x1E40, 0x1D22, 0x2011, 0x1EF2, 0x2017, 0x1EF4, 0x201A, 0x1EF5, 0x201E, 0x1EF7, 0x2027, 0x1EFE,
    0x2031, 0x1F07, 0x2034, 0x1F08, 0x2036, 0x1F09, 0x203C, 0x1F0E, 0x20AD, 0x1F7E, 0x2104, 0x1FD4, 0x2106, 0x1FD5, 0x210A, 0x1FD8,
    0x2117, 0x1FE4, 0x2122, 0x1FEE, 0x216C, 0x202C, 0x217A, 0x2030, 0x2194, 0x2046, 0x219A, 0x2048, 0x2209, 0x20B6, 0x2210, 0x20BC,
    0x2212, 0x20BD, 0x2216, 0x20C0, 0x221B, 0x20C4, 0x2221, 0x20C6, 0x2224, 0x20C8, 0x2226, 0x20C9, 0x222C, 0x20CA, 0x222F, 0x20CC,
    0x2238, 0x20D1, 0x223E, 0x20D6, 0x2249, 0x20E0, 0x224D, 0x20E3, 0x2253, 0x20E8, 0x2262, 0x20F5, 0x2268, 0x20F7, 0x2270, 0x20FD,
    0x2296, 0x2122, 0x229A, 0x2125, 0x22A6, 0x2130, 0x22C0, 0x2149, 0x2313, 0x219B, 0x246A, 0x22E8, 0x249C, 0x22F2, 0x254C, 0x2356,
    0x2574, 0x235A, 0x2590, 0x2367, 0x2596, 0x236A, 0x25A2, 0x2374, 0x25B4, 0x2384, 0x25BE, 0x238C, 0x25C8, 0x2394, 0x25CC, 0x2397,
    0x25D0, 0x2399, 0x25E6, 0x23AB, 0x2607, 0x23CA, 0x260A, 0x23CC, 0x2641, 0x2402, 0x2643, 0x2403, 0x2E82, 0x2C41, 0x2E85, 0x2C43,
    0x2E89, 0x2C46, 0x2E8D, 0x2C48, 0x2E98, 0x2C52, 0x2EA8, 0x2C61, 0x2EAB, 0x2C63, 0x2EAF, 0x2C66, 0x2EB4, 0x2C6A, 0x2EB8, 0x2C6C,
    0x2EBC, 0x2C6F, 0x2ECB, 0x2C7D, 0x2FFC, 0x2DA2, 0x3004, 0x2DA6, 0x3018, 0x2DA7, 0x301F, 0x2DAC, 0x302A, 0x2DAE, 0x303F, 0x2DC2,
    0x3094, 0x2DC4, 0x309F, 0x2DCB, 0x30F7, 0x2DCD, 0x30FF, 0x2DD2, 0x312A, 0x2DD8, 0x322A, 0x2ECE, 0x3232, 0x2ED5, 0x32A4, 0x2F46,
    0x3390, 0x3030, 0x339F, 0x303C, 0x33A2, 0x303E, 0x33C5, 0x3060, 0x33CF, 0x3069, 0x33D3, 0x306B, 0x33D6, 0x306D, 0x3448, 0x30DE,
    0x3474, 0x3109, 0x359F, 0x3233, 0x360F, 0x32A2, 0x361B, 0x32AD, 0x3919, 0x35AA, 0x396F, 0x35FF, 0x39D1, 0x365F, 0x39E0, 0x366D,
    0x3A74, 0x3700, 0x3B4F, 0x37DA, 0x3C6F, 0x38F9, 0x3CE1, 0x396A, 0x4057, 0x3CDF, 0x4160, 0x3DE7, 0x4338, 0x3FBE, 0x43AD, 0x4032,
    0x43B2, 0x4036, 0x43DE, 0x4061, 0x44D7, 0x4159, 0x464D, 0x42CE, 0x4662, 0x42E2, 0x4724, 0x43A3, 0x472A, 0x43A8, 0x477D, 0x43FA,
    0x478E, 0x440A, 0x4948, 0x45C3, 0x497B, 0x45F5, 0x497E, 0x45F7, 0x4984, 0x45FB, 0x4987, 0x45FC, 0x499C, 0x4610, 0x49A0, 0x4613,
    0x49B8, 0x4629, 0x4C78, 0x48E8, 0x4CA4, 0x490F, 0x4D1A, 0x497E, 0x4DAF, 0x4A12, 0x9FA6, 0x4A63, 0xE76C, 0x82BD, 0xE7C7, 0x1D21,
    0xE7C8, 0x82BE, 0xE7E7, 0x82BF, 0xE815, 0x82CC, 0xE819, 0x82CD, 0xE81F, 0x82D2, 0xE827, 0x82D9, 0xE82D, 0x82DD, 0xE833, 0x82E1,
    0xE83C, 0x82E9, 0xE844, 0x82F0, 0xE856, 0x8300, 0xE865, 0x830E, 0xF92D, 0x93D5, 0xF97A, 0x9421, 0xF996, 0x943C, 0xF9E8, 0x948D,
    0xF9F2, 0x9496, 0xFA10, 0x94B0, 0xFA12, 0x94B1, 0xFA15, 0x94B2, 0xFA19, 0x94B5, 0xFA22, 0x94BB, 0xFA25, 0x94BC, 0xFA2A, 0x94BE,
    0xFE32, 0x98C4, 0xFE45, 0x98C5, 0xFE53, 0x98C9, 0xFE58, 0x98CA, 0xFE67, 0x98CB, 0xFE6C, 0x98CC, 0xFF5F, 0x9961, 0xFFE6, 0x99E2,
    0x10000, 0x2E248
  ];
  var GB18030_SIDE = [
    [0xE78D, 0xA6D9], [0xE78E, 0xA6DA], [0xE78F, 0xA6DB], [0xE790, 0xA6DC],
    [0xE791, 0xA6DD], [0xE792, 0xA6DE], [0xE793, 0xA6DF], [0xE794, 0xA6EC],
    [0xE795, 0xA6ED], [0xE796, 0xA6F3], [0xE81E, 0xFE59], [0xE826, 0xFE61],
    [0xE82B, 0xFE66], [0xE82C, 0xFE67], [0xE832, 0xFE6D], [0xE843, 0xFE7E],
    [0xE854, 0xFE90], [0xE864, 0xFEA0]
  ];
/* @@GB18030-TABLE:END */

  var gbTable = null;

  function gbInit() {
    var bin = atob(GB18030_DECODE_B64);
    var firstPtr = new Int32Array(0x10000);
    firstPtr.fill(-1);
    for (var p = 0, n = bin.length >> 1; p < n; p++) {
      var cp = (bin.charCodeAt(p * 2) << 8) | bin.charCodeAt(p * 2 + 1);
      if (firstPtr[cp] < 0) firstPtr[cp] = p;
    }
    var side = new Int32Array(0x10000);
    side.fill(-1);
    for (var i = 0; i < GB18030_SIDE.length; i++) side[GB18030_SIDE[i][0]] = GB18030_SIDE[i][1];
    gbTable = { firstPtr: firstPtr, side: side };
  }

  /* 码点 → 四字节区的指针；找不到返回 -1 */
  function gbRangesPointer(cp) {
    var ranges = GB18030_RANGES;
    var lo = 0;
    var hi = ranges.length / 2 - 1;
    var best = -1;
    while (lo <= hi) {
      var mid = (lo + hi) >> 1;
      if (ranges[mid * 2] <= cp) { best = mid; lo = mid + 1; }
      else hi = mid - 1;
    }
    if (best < 0) return -1;
    return ranges[best * 2 + 1] + (cp - ranges[best * 2]);
  }

  function gb18030Encode(text) {
    if (!gbTable) gbInit();
    var firstPtr = gbTable.firstPtr;
    var side = gbTable.side;
    var n = text.length;
    var out = new Uint8Array(n * 4);
    var len = 0;
    for (var i = 0; i < n; i++) {
      var cp = text.charCodeAt(i);
      /* 代理对：拼出辅助平面的码点（emoji 等超出基本平面的字符） */
      if (cp >= 0xD800 && cp <= 0xDBFF && i + 1 < n) {
        var low = text.charCodeAt(i + 1);
        if (low >= 0xDC00 && low <= 0xDFFF) {
          cp = 0x10000 + ((cp - 0xD800) << 10) + (low - 0xDC00);
          i++;
        }
      }
      if (cp < 0x80) { out[len++] = cp; continue; }
      if (cp === 0xE5E5 || (cp >= 0xD800 && cp <= 0xDFFF)) { out[len++] = 0x3F; continue; }
      var two = cp <= 0xFFFF ? side[cp] : -1;
      if (two >= 0) { out[len++] = two >> 8; out[len++] = two & 0xFF; continue; }
      var p = cp <= 0xFFFF ? firstPtr[cp] : -1;
      if (p >= 0) {
        var trail = p % 190;
        out[len++] = 0x81 + ((p / 190) | 0);
        out[len++] = trail + (trail < 0x3F ? 0x40 : 0x41);
        continue;
      }
      p = gbRangesPointer(cp);
      if (p < 0 || p > 1237575) { out[len++] = 0x3F; continue; }
      var rest = p % 12600;
      out[len++] = 0x81 + ((p / 12600) | 0);
      out[len++] = 0x30 + ((rest / 1260) | 0);
      rest %= 1260;
      out[len++] = 0x81 + ((rest / 10) | 0);
      out[len++] = 0x30 + (rest % 10);
    }
    /* 返回大小恰好相等的拷贝（和 TextEncoder 一致）。out 是按最坏情况分配的，
       如果直接返回它的视图，调用方一旦拿底层缓冲区去用，就会带上一串多余的零字节 */
    return out.slice(0, len);
  }

  /**
   * 编码表本身（只读副本），给测试做独立校验用。
   * decode：两字节区 23,940 个码点，按下标对应指针
   * ranges：四字节区的线性区间 [起点码点, 起点指针, …]
   * side：编码器附表 [码点, 两个字节拼成的整数, …]
   */
  function gb18030Table() {
    if (!gbTable) gbInit();
    var bin = atob(GB18030_DECODE_B64);
    var decode = new Uint16Array(bin.length >> 1);
    for (var i = 0; i < decode.length; i++) decode[i] = (bin.charCodeAt(i * 2) << 8) | bin.charCodeAt(i * 2 + 1);
    var side = new Array(GB18030_SIDE.length);
    for (i = 0; i < side.length; i++) side[i] = [GB18030_SIDE[i][0], GB18030_SIDE[i][1]];
    return { decode: decode, ranges: GB18030_RANGES.slice(), side: side };
  }

  /* ==========================================================================
     10. 正则表达式报错翻译
     ========================================================================== */

  /* 各浏览器引擎的报错措辞不同，每一类列出几种常见写法，匹配不上时保留原始报错 */
  var REGEX_REASONS = [
    [/unterminated group|unterminated parenthetical|missing \)|unclosed group|unmatched \(/i,
      '左括号 ( 没有配对的右括号 )。'],
    [/unterminated character class|unclosed character class|missing \]/i,
      '方括号 [ 没有闭合。'],
    [/unmatched\s*['"]?\)/i,
      '多了一个没有对应左括号的右括号 )。'],
    [/numbers out of order|out of order in \{\}/i,
      '量词 {} 里的数字写反了，应该写成 {最少,最多}，例如 {2,4}。'],
    [/incomplete quantifier/i,
      '量词 {} 不完整，应该写成 {n} 或 {n,m}。'],
    [/nothing to repeat|lone quantifier/i,
      '*、+ 或 ? 前面没有可以重复的内容，例如表达式以 * 开头。'],
    [/range out of order in character class|invalid range in character class/i,
      '字符范围写反了，应该从小到大，例如 [a-z] 而不是 [z-a]。'],
    [/duplicate (capture )?group name/i,
      '两个命名分组用了同一个名字。'],
    [/invalid backreference|not a valid group|invalid reference/i,
      '\\1 这样的反向引用指向了一个不存在的分组，分组从 1 开始数。'],
    [/invalid property name|invalid property escape|property name/i,
      '\\p{…} 这种 Unicode 写法有误，属性名要写在花括号里，例如 \\p{L}。'],
    [/invalid escape|identity escape/i,
      '反斜杠 \\ 后面的字符不能这样转义，普通字符前面不需要反斜杠。'],
    [/invalid group|group specifier|capture group name/i,
      '分组的写法有误，命名分组应该写成 (?<名称>…)。'],
    [/too complex|too large|stack|excessive|memory/i,
      '表达式太复杂，浏览器没法编译。']
  ];

  /**
   * 把 new RegExp 抛出的报错翻译成人话。返回 { title, reason, fix, raw }
   *   title  发生了什么 / reason 为什么 / fix 怎么改 / raw 浏览器的原始报错
   */
  function explainRegexError(err) {
    var raw = err && err.message ? String(err.message) : String(err);
    var reason = null;
    for (var i = 0; i < REGEX_REASONS.length && !reason; i++) {
      if (REGEX_REASONS[i][0].test(raw)) reason = REGEX_REASONS[i][1];
    }
    return {
      title: '正则表达式无法识别',
      reason: reason || ('浏览器没有给出具体原因。'),
      fix: '修改「查找内容」里的表达式，或者关掉「按正则表达式」，改成按普通文本替换。',
      raw: raw
    };
  }

  /* ==========================================================================
     11. 配方、文件名、显示辅助
     ========================================================================== */

  /* 千分位。自己实现，不依赖运行环境的地区设置 */
  function fmtInt(n) {
    var s = String(Math.round(Number(n) || 0));
    return s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  /* 百分比，保留一位小数 */
  function fmtRate(ratio) {
    return (Math.round(ratio * 1000) / 10).toFixed(1) + '%';
  }

  var RE_PRETTY_ESC = /[\u0000-\u001F\u007F-\u009F\u00A0\u200B-\u200D\u2028\u2029\u202F\u205F\u3000\uFEFF]/g;

  /**
   * 改动样例里显示一个值：控制字符和看不见的空白写成转义形式（\n、\u00a0 …）；
   * 值是空的、或者首尾有空白、或者含看不见的字符时，外面加单引号，让人看得出边界。
   */
  function prettyValue(value) {
    var s = value == null ? '' : String(value);
    if (s === '') return "''";
    var shown = s.replace(RE_PRETTY_ESC, function (ch) {
      var code = ch.charCodeAt(0);
      if (code === 9) return '\\t';
      if (code === 10) return '\\n';
      if (code === 13) return '\\r';
      return '\\u' + ('000' + code.toString(16)).slice(-4);
    });
    if (shown !== s || /^\s|\s$/.test(s)) return "'" + shown + "'";
    return shown;
  }

  /**
   * 生成「清洗配方」：一段便于复现和交接的文字。
   * input = {
   *   generatedAt, tool,
   *   source: { name, encodingLabel, delimiterLabel, hasHeader },
   *   original: { rows, cols },
   *   result: { rows, cols, removedRows, removedDuplicates, removedEmpty, changedCells },
   *   rules: [{ name, state: 'on' | 'off', detail }]
   * }
   */
  function formatRecipe(input) {
    var src = input.source;
    var res = input.result;
    var on = [];
    var off = [];
    input.rules.forEach(function (rule) {
      (rule.state === 'on' ? on : off).push(rule);
    });
    var lines = [
      '表格清洗配方',
      '生成时间：' + input.generatedAt,
      '工具：' + input.tool,
      '',
      '数据来源：' + src.name,
      '  编码：' + src.encodingLabel + '，分隔符：' + src.delimiterLabel + '，' + (src.hasHeader ? '首行为表头' : '没有表头'),
      '  原始规模：' + fmtInt(input.original.rows) + ' 行 × ' + fmtInt(input.original.cols) + ' 列',
      '',
      '启用的规则（按执行顺序）：'
    ];
    if (on.length === 0) lines.push('  （没有启用任何规则）');
    on.forEach(function (rule, i) {
      lines.push('  ' + (i + 1) + '. ' + rule.name + (rule.detail ? '：' + rule.detail : ''));
    });
    lines.push('');
    lines.push(off.length ? '未启用：' + off.map(function (rule) { return rule.name; }).join('、') : '未启用：无');
    lines.push('');
    lines.push('清洗结果：' + fmtInt(res.rows) + ' 行 × ' + fmtInt(res.cols) + ' 列');
    lines.push('  删除 ' + fmtInt(res.removedRows) + ' 行（重复 ' + fmtInt(res.removedDuplicates) + '，空行 ' + fmtInt(res.removedEmpty) + '）');
    lines.push('  修改 ' + fmtInt(res.changedCells) + ' 个单元格');
    lines.push('');
    lines.push('配方是给人看的说明，目前不能导入工具自动执行；按上面的设置操作一遍即可复现。');
    return lines.join('\n');
  }

  /* cleaned_YYYYMMDD_HHmm.ext */
  function defaultFileName(date, ext) {
    var d = date || new Date();
    return 'cleaned_' + d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) +
      '_' + pad2(d.getHours()) + pad2(d.getMinutes()) + '.' + ext;
  }

  /* 去掉文件名里系统不允许的字符，保证以指定的扩展名结尾 */
  function safeFileName(name, ext) {
    var base = String(name == null ? '' : name)
      .replace(/[\\/:*?"<>|\u0000-\u001F]/g, '')
      .replace(/\.(csv|tsv|json|txt)$/i, '')
      .trim();
    if (base === '' || base === '.') base = 'cleaned';
    return base.slice(0, 120) + '.' + ext;
  }

  return {
    VERSION: VERSION,
    PREVIEW_ROWS: PREVIEW_ROWS,
    RULE_IDS: RULE_IDS,
    RULE_KIND: RULE_KIND,
    DELIMITERS: DELIMITERS,
    EXPORT_ENCODINGS: EXPORT_ENCODINGS,

    /* 分隔符与解析 */
    delimiterChar: delimiterChar,
    delimiterId: delimiterId,
    delimiterLabel: delimiterLabel,
    detectDelimiter: detectDelimiter,
    parseCsv: parseCsv,
    isBlankRow: isBlankRow,
    buildTable: buildTable,

    /* 数字与日期 */
    normalizeNumber: normalizeNumber,
    halfWidthDigits: halfWidthDigits,
    parseDateValue: parseDateValue,
    isCompactDateShape: isCompactDateShape,
    isDateLike: isDateLike,

    /* 规则 */
    defaultRules: defaultRules,
    normalizeRules: normalizeRules,
    applyRules: applyRules,
    compileFind: compileFind,
    explainRegexError: explainRegexError,
    normalizeHeaderNames: normalizeHeaderNames,

    /* 列概况 */
    inferType: inferType,
    valueType: valueType,
    profileColumn: profileColumn,
    profileColumns: profileColumns,

    /* 导出 */
    formatCsv: formatCsv,
    formatTsv: formatTsv,
    formatJson: formatJson,
    csvField: csvField,
    encodeText: encodeText,
    decodeBytes: decodeBytes,
    encodingLabel: encodingLabel,
    gb18030Table: gb18030Table,

    /* 辅助 */
    fmtInt: fmtInt,
    fmtRate: fmtRate,
    prettyValue: prettyValue,
    formatRecipe: formatRecipe,
    defaultFileName: defaultFileName,
    safeFileName: safeFileName
  };
});
