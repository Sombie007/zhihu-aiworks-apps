/* ===========================================================================
   PMP 助手 · 纯逻辑
   挣值计算（含边界情况）、风险值与 5×5 矩阵统计、速记卡的队列与掌握度统计、
   大纲检索、数据完整性校验。

   不碰 DOM。浏览器里挂到 window.APP_CORE；Node 里 const CORE = require('./core.js')，
   需要内容的函数把数据作为第一个参数传入（加载时注入的 APP_DATA 只作缺省）。
   =========================================================================== */
(function (root, factory) {
  var api = factory(root.APP_DATA || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.APP_CORE = api;
})(typeof self !== 'undefined' ? self : this, function (DATA) {
  'use strict';

  /* ------------------------------------------------------------------ 通用 */

  var EPS = 1e-12; // 相对容差：吸收浮点误差，又不至于把真实的偏差当成 0

  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  function isAmount(v) { return isNum(v) && v >= 0; } // 金额：非负的有限数
  function nearly(a, b, scale) {
    return Math.abs(a - b) <= EPS * Math.max(1, Math.abs(scale || 0), Math.abs(a), Math.abs(b));
  }
  function sign(v, scale) { return nearly(v, 0, scale) ? 0 : (v > 0 ? 1 : -1); }
  function clampInt(v, lo, hi, fallback) {
    return isNum(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : fallback;
  }
  function str(v) { return typeof v === 'string' ? v.trim() : ''; }

  /* 千分位整数（不依赖 locale，Node 与浏览器结果一致） */
  function groupInt(n) {
    var s = String(Math.round(Math.abs(n)));
    var out = '';
    var count = 0;
    for (var i = s.length - 1; i >= 0; i--) {
      out = s.charAt(i) + out;
      count += 1;
      if (count % 3 === 0 && i > 0) out = ',' + out;
    }
    return out;
  }

  /* 金额：千分位整数；指数：两位小数。不可计算一律返回“—”，不会出现 NaN / Infinity */
  function fmtMoney(v) {
    if (!isNum(v)) return '—';
    var a = Math.abs(v);
    return (v < 0 ? '-' : '') + (a >= 1e15 ? a.toExponential(2) : groupInt(a));
  }
  function fmtIndex(v) { return isNum(v) ? v.toFixed(2) : '—'; }

  function use(data) { return data && typeof data === 'object' ? data : (DATA || {}); }

  /* ================================================================== 挣值 */

  var EVM_MAX = 1e13; // 单位是元，超过 10 万亿基本可以断定单位填错了

  var EVM_FIELDS = [
    { key: 'pv', abbr: 'PV', name: '计划价值', label: '计划价值（PV）', example: 420000,
      hint: '到当前时点为止，计划完成的工作按预算价格折算的金额。' },
    { key: 'ev', abbr: 'EV', name: '挣值', label: '挣值（EV）', example: 357000,
      hint: '到当前时点为止，实际完成的工作按预算价格折算的金额。' },
    { key: 'ac', abbr: 'AC', name: '实际成本', label: '实际成本（AC）', example: 401500,
      hint: '到当前时点为止实际花费的金额。' },
    { key: 'bac', abbr: 'BAC', name: '完工预算', label: '完工预算（BAC）', example: 1200000,
      hint: '全部工作的预算总额，必须大于 0。' }
  ];

  var EVM_EAC_METHODS = [
    { id: 'typical', name: '偏差典型', formula: 'BAC ÷ CPI',
      assume: '假设剩余工作按当前成本效率继续。' },
    { id: 'atypical', name: '偏差非典型', formula: 'AC + (BAC − EV)',
      assume: '假设剩余工作按原预算进行。' },
    { id: 'both', name: '进度与成本同时影响', formula: 'AC + (BAC − EV) ÷ (CPI × SPI)',
      assume: '假设剩余工作受成本与进度双重制约。' }
  ];

  function evmField(key) {
    for (var i = 0; i < EVM_FIELDS.length; i++) if (EVM_FIELDS[i].key === key) return EVM_FIELDS[i];
    return EVM_FIELDS[0];
  }

  function evmMethod(id) {
    for (var i = 0; i < EVM_EAC_METHODS.length; i++) if (EVM_EAC_METHODS[i].id === id) return EVM_EAC_METHODS[i];
    return EVM_EAC_METHODS[0];
  }

  /* 全角数字和全角标点转半角；千分位逗号留到后面按位置判断 */
  function normalizeNumberText(s) {
    var out = '';
    for (var i = 0; i < s.length; i++) {
      var code = s.charCodeAt(i);
      var c = s.charAt(i);
      if (code >= 0xFF10 && code <= 0xFF19) c = String.fromCharCode(code - 0xFEE0); // ０-９
      else if (code === 0xFF0E) c = '.'; // ．
      else if (code === 0xFF0D) c = '-'; // －
      else if (code === 0xFF0C) c = ','; // ，
      out += c;
    }
    return out;
  }

  /* 解析一个输入框。raw 可以是字符串或数字。
     返回 { ok, empty, value, reason, message }；reason 取值：
     empty | nan | negative | too_large | bac_zero | null */
  function parseEvmInput(key, raw) {
    var def = evmField(key);
    var example = groupInt(def.example);
    var res = { key: key, abbr: def.abbr, name: def.name, raw: raw == null ? '' : String(raw),
      ok: false, empty: false, value: null, reason: null, message: '' };

    var trimmed = res.raw.trim();
    if (trimmed === '') {
      res.empty = true;
      res.reason = 'empty';
      res.message = '请填写' + def.label + '，例如 ' + example + '。';
      return res;
    }

    function fail(message) {
      res.reason = 'nan';
      res.message = message;
      return res;
    }

    var text = normalizeNumberText(trimmed);
    var negative = text.charAt(0) === '-';
    if (negative || text.charAt(0) === '+') text = text.slice(1);

    /* 千分位逗号只在“每三位一组”的位置上才认，否则说明输入本身有问题，不当成数字 */
    if (text.indexOf(',') >= 0) {
      if (/^\d{1,3}(,\d{3})+(\.\d*)?$/.test(text)) text = text.replace(/,/g, '');
      else return fail('“' + trimmed + '”里的逗号不在千分位上。' + def.label + '只填数字和小数点，例如 ' + example + '。');
    }

    if (negative && !/^0*\.?0*$/.test(text)) {
      res.reason = 'negative';
      res.message = def.label + '不能是负数，请填写 0 或正数，例如 ' + example + '。';
      return res;
    }
    if (!/^(?:\d+\.?\d*|\.\d+)$/.test(text)) {
      return fail('“' + trimmed + '”不是有效的数字。' + def.label + '只填数字和小数点，例如 ' + example + '。');
    }

    var value = Number(text);
    if (!isFinite(value)) {
      return fail('“' + trimmed + '”的位数太多，无法作为数字处理。请检查是否多输了位数。');
    }
    if (value > EVM_MAX) {
      res.reason = 'too_large';
      res.message = def.label + '超出了可处理的范围（最大 ' + groupInt(EVM_MAX) + '）。请确认单位是“元”。';
      return res;
    }
    if (key === 'bac' && value === 0) {
      res.reason = 'bac_zero';
      res.message = '完工预算需要大于 0，例如 200000。';
      return res;
    }

    res.ok = true;
    res.value = value;
    return res;
  }

  /* 校验四个输入框。touched 记录用户是否离开过该输入框：空着且没碰过的输入框不报错，
     其余情况照常计算，缺的指标显示“—”。 */
  function validateEvm(raw, touched) {
    raw = raw || {};
    touched = touched || {};
    var values = {};
    var fields = [];
    var errors = 0;
    var filled = 0;
    EVM_FIELDS.forEach(function (def) {
      var f = parseEvmInput(def.key, raw[def.key]);
      f.showError = !f.ok && (!f.empty || !!touched[def.key]);
      if (f.ok) { values[def.key] = f.value; filled += 1; } else values[def.key] = null;
      if (f.showError) errors += 1;
      fields.push(f);
    });
    return { fields: fields, values: values, errors: errors, filled: filled, complete: filled === EVM_FIELDS.length };
  }

  /* 挣值全套计算。values = { pv, ev, ac, bac }，缺的填 null。
     每个指标：{ key, abbr, name, formula, unit, value, reason, tone, text }
     value 为 null 表示不可计算，reason 说明原因。 */
  function computeEvm(values, opts) {
    values = values || {};
    var v = {
      pv: isAmount(values.pv) ? values.pv : null,
      ev: isAmount(values.ev) ? values.ev : null,
      ac: isAmount(values.ac) ? values.ac : null,
      bac: isAmount(values.bac) ? values.bac : null
    };
    var method = evmMethod(opts && opts.eac);
    var metrics = [];
    var byKey = {};

    function lack(keys) {
      var names = [];
      keys.forEach(function (k) { if (v[k] == null) names.push(evmField(k).label); });
      return names.length ? '尚未填写' + names.join('和') + '，无法计算。' : null;
    }

    function describe(m) {
      if (m.value == null) return { tone: 'na', text: m.reason };
      var x = m.value;
      var s;
      switch (m.key) {
        case 'cv':
          s = sign(x, Math.max(v.ev, v.ac));
          return s > 0 ? { tone: 'good', text: '节支 ' + fmtMoney(x) + ' 元' }
            : s < 0 ? { tone: 'bad', text: '超支 ' + fmtMoney(-x) + ' 元' }
            : { tone: 'neutral', text: '成本与预算一致' };
        case 'sv':
          s = sign(x, Math.max(v.ev, v.pv));
          return s > 0 ? { tone: 'good', text: '进度超前 ' + fmtMoney(x) + ' 元的工作量' }
            : s < 0 ? { tone: 'bad', text: '进度落后 ' + fmtMoney(-x) + ' 元的工作量' }
            : { tone: 'neutral', text: '进度与计划一致' };
        case 'cpi':
          if (x === 0) return { tone: 'bad', text: '已经花了钱，但还没有产出任何价值（EV 为 0）' };
          s = sign(x - 1, 1);
          return s > 0 ? { tone: 'good', text: '节支：每花 1 元，产出 ' + fmtIndex(x) + ' 元的价值' }
            : s < 0 ? { tone: 'bad', text: '超支：每花 1 元，只产出 ' + fmtIndex(x) + ' 元的价值' }
            : { tone: 'neutral', text: '成本绩效与计划一致' };
        case 'spi':
          if (x === 0) return { tone: 'bad', text: '计划内的工作还没有任何产出（EV 为 0）' };
          s = sign(x - 1, 1);
          return s > 0 ? { tone: 'good', text: '超前：计划每完成 1 元的工作，实际完成 ' + fmtIndex(x) + ' 元' }
            : s < 0 ? { tone: 'bad', text: '落后：计划每完成 1 元的工作，实际只完成 ' + fmtIndex(x) + ' 元' }
            : { tone: 'neutral', text: '进度与计划一致' };
        case 'eac': {
          var base = '完成全部工作的预计总成本为 ' + fmtMoney(x) + ' 元';
          s = sign(x - v.bac, v.bac);
          return s > 0 ? { tone: 'bad', text: base + '，比完工预算多 ' + fmtMoney(x - v.bac) + ' 元' }
            : s < 0 ? { tone: 'good', text: base + '，比完工预算少 ' + fmtMoney(v.bac - x) + ' 元' }
            : { tone: 'neutral', text: base + '，与完工预算一致' };
        }
        case 'etc':
          if (x < 0) return { tone: 'warn', text: '为负值：挣值已经超过完工预算，请核对范围基准是否更新' };
          return { tone: 'neutral', text: '从现在到项目结束，预计还要投入 ' + fmtMoney(x) + ' 元' };
        case 'vac':
          s = sign(x, v.bac);
          return s > 0 ? { tone: 'good', text: '预计低于预算 ' + fmtMoney(x) + ' 元' }
            : s < 0 ? { tone: 'bad', text: '将超预算 ' + fmtMoney(-x) + ' 元' }
            : { tone: 'neutral', text: '预计正好按预算完成' };
        case 'tcpi':
          s = sign(x - 1, 1);
          return s > 0 ? { tone: 'bad', text: '剩余工作每花 1 元必须产出 ' + fmtIndex(x) + ' 元价值，效率要高于原计划才能按预算完成' }
            : s < 0 ? { tone: 'good', text: '剩余工作每花 1 元只需产出 ' + fmtIndex(x) + ' 元价值，效率低于原计划也能按预算完成' }
            : { tone: 'neutral', text: '保持原计划的效率，正好可以按预算完成' };
        default:
          return { tone: 'neutral', text: '' };
      }
    }

    function push(m) {
      if (m.value != null && !isFinite(m.value)) {
        m.value = null;
        m.reason = '结果超出了可计算的范围，请检查输入的数值。';
      }
      if (m.value == null && !m.reason) m.reason = '无法计算。';
      var d = describe(m);
      m.tone = d.tone;
      m.text = d.text;
      metrics.push(m);
      byKey[m.key] = m;
    }

    var need;

    /* CV = EV − AC */
    need = lack(['ev', 'ac']);
    push({ key: 'cv', abbr: 'CV', name: '成本偏差', formula: 'EV − AC', unit: 'money',
      value: need ? null : v.ev - v.ac, reason: need });

    /* SV = EV − PV */
    need = lack(['ev', 'pv']);
    push({ key: 'sv', abbr: 'SV', name: '进度偏差', formula: 'EV − PV', unit: 'money',
      value: need ? null : v.ev - v.pv, reason: need });

    /* CPI = EV ÷ AC（AC = 0 时不可计算） */
    var cpi = null;
    var cpiReason = lack(['ev', 'ac']);
    if (!cpiReason && v.ac === 0) cpiReason = '实际成本（AC）为 0，成本绩效指数无法计算。项目可能还没有发生支出。';
    if (!cpiReason) cpi = v.ev / v.ac;
    push({ key: 'cpi', abbr: 'CPI', name: '成本绩效指数', formula: 'EV ÷ AC', unit: 'index', value: cpi, reason: cpiReason });

    /* SPI = EV ÷ PV（PV = 0 时不可计算） */
    var spi = null;
    var spiReason = lack(['ev', 'pv']);
    if (!spiReason && v.pv === 0) spiReason = '计划价值（PV）为 0，进度绩效指数无法计算。请确认是否填写了计划价值。';
    if (!spiReason) spi = v.ev / v.pv;
    push({ key: 'spi', abbr: 'SPI', name: '进度绩效指数', formula: 'EV ÷ PV', unit: 'index', value: spi, reason: spiReason });

    /* EAC：三种算法各自的前提不同 */
    var eac = null;
    var eacReason = null;
    if (method.id === 'typical') {
      eacReason = lack(['ev', 'ac', 'bac']);
      if (!eacReason && v.ac === 0) eacReason = '实际成本（AC）为 0，成本绩效指数无法计算，也就不能按当前成本效率推算完工估算。可以改用“偏差非典型”。';
      else if (!eacReason && v.ev === 0) eacReason = '挣值（EV）为 0，成本绩效指数为 0，不能据此推算完工估算。可以改用“偏差非典型”。';
      else if (!eacReason) eac = v.bac * v.ac / v.ev;
    } else if (method.id === 'atypical') {
      eacReason = lack(['ev', 'ac', 'bac']);
      if (!eacReason) eac = v.ac + (v.bac - v.ev);
    } else {
      eacReason = lack(['ev', 'pv', 'ac', 'bac']);
      if (!eacReason && v.ac === 0) eacReason = '实际成本（AC）为 0，成本绩效指数无法计算，不能按这个算法推算完工估算。';
      else if (!eacReason && v.pv === 0) eacReason = '计划价值（PV）为 0，进度绩效指数无法计算，不能按这个算法推算完工估算。';
      else if (!eacReason && v.ev === 0) eacReason = '挣值（EV）为 0，成本与进度绩效指数都为 0，不能按这个算法推算完工估算。';
      else if (!eacReason) eac = v.ac + (v.bac - v.ev) * v.ac * v.pv / (v.ev * v.ev);
    }
    push({ key: 'eac', abbr: 'EAC', name: '完工估算（' + method.name + '）', formula: method.formula, unit: 'money',
      value: eac, reason: eacReason });

    /* ETC = EAC − AC */
    var etcReason = eac == null ? (v.bac == null ? lack(['bac']) : '完工估算（EAC）还无法计算：' + eacReason) : null;
    push({ key: 'etc', abbr: 'ETC', name: '完工尚需估算', formula: 'EAC − AC', unit: 'money',
      value: eac == null ? null : eac - v.ac, reason: etcReason });

    /* VAC = BAC − EAC */
    push({ key: 'vac', abbr: 'VAC', name: '完工偏差', formula: 'BAC − EAC', unit: 'money',
      value: eac == null ? null : v.bac - eac, reason: eac == null ? (v.bac == null ? lack(['bac']) : '完工估算（EAC）还无法计算：' + eacReason) : null });

    /* TCPI = (BAC − EV) ÷ (BAC − AC)：没有剩余资金时不可计算；EV ≥ BAC 时没有意义 */
    var tcpi = null;
    var tcpiReason = lack(['ev', 'ac', 'bac']);
    if (!tcpiReason && nearly(v.bac - v.ac, 0, v.bac)) tcpiReason = '完工预算减去实际成本等于 0，已经没有剩余资金可供衡量，完工尚需绩效指数无法计算。';
    else if (!tcpiReason && v.ac > v.bac) tcpiReason = '实际成本（AC）已经超过完工预算（BAC），剩余资金为负，完工尚需绩效指数无法计算。';
    else if (!tcpiReason && v.ev === v.bac) tcpiReason = '挣值（EV）已经等于完工预算（BAC），预算内的工作全部完成，完工尚需绩效指数没有意义。';
    else if (!tcpiReason && v.ev > v.bac) tcpiReason = '挣值（EV）已经超过完工预算（BAC），完工尚需绩效指数没有意义。请核对范围基准是否已经更新。';
    else if (!tcpiReason) tcpi = (v.bac - v.ev) / (v.bac - v.ac);
    push({ key: 'tcpi', abbr: 'TCPI', name: '完工尚需绩效指数', formula: '(BAC − EV) ÷ (BAC − AC)', unit: 'index',
      value: tcpi, reason: tcpiReason });

    /* 结论先行：成本、进度各一句，再补完工预测 */
    var cv = byKey.cv;
    var sv = byKey.sv;
    var vac = byKey.vac;
    var parts = [];
    var bad = 0;
    var good = 0;
    [cv, sv].forEach(function (m) {
      if (m.value == null) return;
      if (m.tone === 'bad') bad += 1; else if (m.tone === 'good') good += 1;
      parts.push(m.text);
    });
    var summary;
    if (!parts.length) {
      var empty = v.pv == null && v.ev == null && v.ac == null && v.bac == null;
      summary = {
        tone: 'info',
        title: empty ? '输入四个数值后开始计算' : '还不能给出结论',
        text: empty
          ? '填写计划价值、挣值、实际成本和完工预算，这里会给出成本与进度的结论。'
          : '数据还不完整：' + (cv.reason || eacReason || '')
      };
    } else {
      summary = {
        tone: bad >= 2 ? 'danger' : bad === 1 ? 'warning' : good >= 1 ? 'success' : 'info',
        title: parts.join('，') + '。',
        text: eac == null
          ? '完工估算暂时无法计算：' + eacReason
          : '按“' + method.name + '”的假设，' + byKey.eac.text + '。'
      };
    }

    return {
      inputs: v,
      method: method,
      metrics: metrics,
      byKey: byKey,
      summary: summary,
      chart: {
        bars: EVM_FIELDS.slice(0, 3).map(function (def) {
          return { key: def.key, abbr: def.abbr, name: def.name, value: v[def.key] };
        }),
        bac: v.bac
      }
    };
  }

  /* 柱状图的纵轴范围：以三根柱子的最大值为准，顶部留出标签空间 */
  function evmChartScale(chart) {
    var max = 0;
    (chart.bars || []).forEach(function (b) { if (isAmount(b.value) && b.value > max) max = b.value; });
    var top = max > 0 ? max * 1.2 : 0;
    return { max: max, top: top, bacVisible: isAmount(chart.bac) && top > 0 && chart.bac <= top };
  }

  function evmPresets(data) {
    var evm = use(data).EVM;
    return (evm && Array.isArray(evm.presets)) ? evm.presets : [];
  }

  var evm = {
    MAX: EVM_MAX,
    FIELDS: EVM_FIELDS,
    METHODS: EVM_EAC_METHODS,
    parse: parseEvmInput,
    validate: validateEvm,
    compute: computeEvm,
    chartScale: evmChartScale,
    presets: evmPresets,
    fmtMoney: fmtMoney,
    fmtIndex: fmtIndex
  };

  /* ================================================================== 风险 */

  var RISK_KINDS = { threat: '威胁', opportunity: '机会' };
  var RISK_STRATEGIES = {
    threat: ['上报', '规避', '转移', '减轻', '接受'],
    opportunity: ['上报', '开拓', '分享', '提高', '接受']
  };
  /* 威胁与机会之间含义对应的策略：切换类型时沿用含义最接近的那个 */
  var STRATEGY_COUNTERPART = {
    '上报': '上报', '规避': '开拓', '转移': '分享', '减轻': '提高', '接受': '接受',
    '开拓': '规避', '分享': '转移', '提高': '减轻'
  };
  /* 四档的分界取自规格：≥15 红、10–12 橙、5–8 黄、1–4 绿。
     规格没有覆盖 3 × 3 = 9 这个可以取到的值；按“达到 10 才进橙档”的阈值读法，9 归入黄档。
     scores 是这一档实际能取到的风险值（概率、影响都是 1–5 的整数，像 7、11、13 是取不到的）。 */
  var RISK_TIERS = [
    { id: 'red', label: '红', range: '≥ 15', scores: [15, 16, 20, 25], rule: '优先处理，制定应对计划并指定责任人' },
    { id: 'orange', label: '橙', range: '10–12', scores: [10, 12], rule: '制定应对措施' },
    { id: 'yellow', label: '黄', range: '5–9', scores: [5, 6, 8, 9], rule: '纳入观察清单' },
    { id: 'green', label: '绿', range: '1–4', scores: [1, 2, 3, 4], rule: '接受并定期复查' }
  ];

  function riskP(r) { return clampInt(r && r.p, 1, 5, 3); }
  function riskI(r) { return clampInt(r && r.i, 1, 5, 3); }
  function riskScore(r) { return riskP(r) * riskI(r); }

  /* 风险值不属于任何一档（不是整数，或 5×5 取不到）时返回 null */
  function riskTier(score) {
    if (!isNum(score) || score !== Math.round(score)) return null;
    for (var i = 0; i < RISK_TIERS.length; i++) {
      if (RISK_TIERS[i].scores.indexOf(score) >= 0) return RISK_TIERS[i];
    }
    return null;
  }

  /* 把任意来源（风险库、本地存储、表单）的一条风险整理成合法对象；标题为空则返回 null */
  function normalizeRisk(raw, fallbackId) {
    if (!raw || typeof raw !== 'object') return null;
    var title = str(raw.title).slice(0, 80);
    if (!title) return null;
    var kind = raw.kind === 'opportunity' ? 'opportunity' : 'threat';
    var strategy = RISK_STRATEGIES[kind].indexOf(raw.strategy) >= 0 ? raw.strategy : (kind === 'threat' ? '减轻' : '提高');
    return {
      id: String(raw.id || fallbackId || ''),
      title: title,
      signal: str(raw.signal).slice(0, 300),
      p: riskP(raw),
      i: riskI(raw),
      kind: kind,
      strategy: strategy,
      response: str(raw.response).slice(0, 500),
      custom: !!raw.custom
    };
  }

  function normalizeRiskList(list) {
    var out = [];
    if (!Array.isArray(list)) return out;
    list.forEach(function (r, n) {
      var item = normalizeRisk(r, 'item-' + (n + 1));
      if (item) out.push(item);
    });
    return out;
  }

  /* 切换威胁 / 机会：策略选项随之变化，含义对应的策略保留，其余换成对应的那个 */
  function switchRiskKind(risk, kind) {
    var next = normalizeRisk(risk);
    if (!next) return next;
    kind = kind === 'opportunity' ? 'opportunity' : 'threat';
    if (next.kind === kind) return next;
    next.kind = kind;
    if (RISK_STRATEGIES[kind].indexOf(next.strategy) < 0) {
      next.strategy = STRATEGY_COUNTERPART[next.strategy] || '接受';
    }
    return next;
  }

  /* 按风险值降序；风险值相同时概率高的在前，再按原有顺序 */
  function sortRisks(list) {
    return (list || []).map(function (r, n) { return { r: r, n: n }; }).sort(function (a, b) {
      var d = riskScore(b.r) - riskScore(a.r);
      if (d) return d;
      d = riskP(b.r) - riskP(a.r);
      return d ? d : a.n - b.n;
    }).map(function (x) { return x.r; });
  }

  /* 风险库某个组合的默认清单（深拷贝，改动了也不会污染库本身） */
  function defaultRisks(library, type, focus) {
    var lib = library && library[type];
    var rows = lib && lib[focus];
    return normalizeRiskList(Array.isArray(rows) ? rows : []);
  }

  function updateRisk(list, id, patch) {
    return (list || []).map(function (r) {
      if (!r || r.id !== id) return r;
      var merged = {};
      Object.keys(r).forEach(function (k) { merged[k] = r[k]; });
      Object.keys(patch || {}).forEach(function (k) { merged[k] = patch[k]; });
      return normalizeRisk(merged, id) || r;
    });
  }

  function removeRisk(list, id) {
    return (list || []).filter(function (r) { return !r || r.id !== id; });
  }

  function upsertRisk(list, risk) {
    var item = normalizeRisk(risk);
    if (!item) return list || [];
    var found = false;
    var out = (list || []).map(function (r) {
      if (!found && r && r.id === item.id) { found = true; return item; }
      return r;
    });
    if (!found) out.push(item);
    return out;
  }

  /* 5×5 矩阵统计：行是概率，列是影响 */
  function riskMatrix(list) {
    var cells = [];
    for (var p = 1; p <= 5; p++) {
      for (var i = 1; i <= 5; i++) {
        var tier = riskTier(p * i);
        cells.push({ p: p, i: i, score: p * i, tier: tier ? tier.id : null, count: 0, ids: [] });
      }
    }
    var tiers = { red: 0, orange: 0, yellow: 0, green: 0 };
    var kinds = { threat: 0, opportunity: 0 };
    (list || []).forEach(function (r) {
      if (!r) return;
      var cell = cells[(riskP(r) - 1) * 5 + (riskI(r) - 1)];
      var tier = riskTier(riskScore(r));
      cell.count += 1;
      cell.ids.push(r.id);
      if (tier) tiers[tier.id] += 1;
      if (kinds[r.kind] != null) kinds[r.kind] += 1;
    });
    return { cells: cells, tiers: tiers, kinds: kinds, total: (list || []).length };
  }

  function csvCell(value) {
    var s = String(value == null ? '' : value);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function mdCell(value) {
    return String(value == null ? '' : value).replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
  }

  function riskRows(list, meta) {
    meta = meta || {};
    return sortRisks(list).map(function (r, n) {
      var tier = riskTier(riskScore(r));
      return [n + 1, meta.type || '', meta.focus || '', RISK_KINDS[r.kind], r.title, r.signal,
        riskP(r), riskI(r), riskScore(r), tier ? tier.label : '', r.strategy, r.response];
    });
  }

  /* CSV：UTF-8 带 BOM，Excel 可以直接打开 */
  function riskCsv(list, meta) {
    var head = ['序号', '项目类型', '关注领域', '风险类型', '风险标题', '预警信号', '概率P', '影响I', '风险值', '等级', '应对策略', '应对措施'];
    var lines = [head].concat(riskRows(list, meta)).map(function (row) {
      return row.map(csvCell).join(',');
    });
    return '\uFEFF' + lines.join('\r\n') + '\r\n';
  }

  function riskMarkdown(list, meta) {
    meta = meta || {};
    var title = '风险登记册';
    var scope = [meta.type, meta.focus].filter(Boolean).join(' · ');
    if (scope) title += '：' + scope;
    var lines = ['# ' + title, '',
      '共 ' + (list || []).length + ' 条，按风险值（概率 P × 影响 I）从高到低排列。', '',
      '| 序号 | 类型 | 风险 | 预警信号 | P | I | 风险值 | 等级 | 应对策略 | 应对措施 |',
      '|---|---|---|---|---|---|---|---|---|---|'];
    riskRows(list, meta).forEach(function (row) {
      var cells = [row[0], row[3], row[4], row[5], row[6], row[7], row[8], row[9], row[10], row[11]];
      lines.push('| ' + cells.map(mdCell).join(' | ') + ' |');
    });
    return lines.join('\n');
  }

  /* 表单校验：返回错误信息对象（键为字段名），没有错误时为空对象 */
  function validateRiskForm(form) {
    form = form || {};
    var errors = {};
    if (!str(form.title)) errors.title = '请填写风险标题，说明可能发生什么，例如“第三方接口延期交付”。';
    else if (str(form.title).length > 80) errors.title = '风险标题最多 80 个字，目前 ' + str(form.title).length + ' 个字。';
    if (!str(form.signal)) errors.signal = '请填写预警信号：出现什么迹象说明它正在发生。';
    if (!str(form.response)) errors.response = '请填写应对措施：具体做什么来降低概率、减小影响，或者抓住机会。';
    return errors;
  }

  var risk = {
    KINDS: RISK_KINDS,
    STRATEGIES: RISK_STRATEGIES,
    COUNTERPART: STRATEGY_COUNTERPART,
    TIERS: RISK_TIERS,
    score: riskScore,
    tier: riskTier,
    normalize: normalizeRisk,
    normalizeList: normalizeRiskList,
    switchKind: switchRiskKind,
    sort: sortRisks,
    defaults: defaultRisks,
    update: updateRisk,
    remove: removeRisk,
    upsert: upsertRisk,
    matrix: riskMatrix,
    csv: riskCsv,
    markdown: riskMarkdown,
    validateForm: validateRiskForm
  };

  /* ================================================================ 速记卡 */

  var CARD_DOMAINS = ['人员', '过程', '业务环境', '基础计算与合同', '敏捷与混合', '第八版框架', '考试政策'];
  var CARD_LEVELS = ['了解', '理解', '应用'];
  var CARD_BASES = ['考试大纲（2026 年 7 月更新）', 'PMBOK 第 8 版', 'PMBOK 第 6 版基础概念', '敏捷通用实践'];
  var CARD_STATUS = [
    { id: 'all', label: '全部' },
    { id: 'unseen', label: '未学' },
    { id: 'again', label: '还不会' },
    { id: 'known', label: '已掌握' }
  ];
  var BASIS_P8 = CARD_BASES[1];
  var BASIS_P6 = CARD_BASES[2];
  var P8_CAVEAT = '细节以教材为准';

  function normText(s) { return String(s == null ? '' : s).toLowerCase(); }
  function termsOf(query) {
    return normText(query).trim().split(/\s+/).filter(function (t) { return t.length > 0; });
  }
  /* 空格分开的多个词都要出现才算匹配 */
  function matchTerms(text, terms) {
    var hay = normText(text);
    for (var i = 0; i < terms.length; i++) if (hay.indexOf(terms[i]) < 0) return false;
    return true;
  }
  function cardHaystack(card) {
    return [card.front, (card.back || []).join(' '), card.domain, card.basis, card.level, card.note].join(' ');
  }

  function cardStatus(progress, id) {
    var rec = progress && progress[id];
    if (rec && rec.s === 'known') return 'known';
    if (rec && rec.s === 'again') return 'again';
    return 'unseen';
  }

  /* 筛选：domain / level 为“全部”或具体值，status 为 all | unseen | again | known，q 为搜索词 */
  function filterCards(cards, filters, progress) {
    cards = cards || [];
    filters = filters || {};
    var terms = termsOf(filters.q);
    return cards.filter(function (card) {
      if (filters.domain && filters.domain !== '全部' && card.domain !== filters.domain) return false;
      if (filters.level && filters.level !== '全部' && card.level !== filters.level) return false;
      if (filters.status && filters.status !== 'all' && cardStatus(progress, card.id) !== filters.status) return false;
      if (terms.length && !matchTerms(cardHaystack(card), terms)) return false;
      return true;
    });
  }

  /* Fisher–Yates 洗牌，返回新数组；rng 可注入，便于测试 */
  function shuffle(list, rng) {
    var a = (list || []).slice();
    var rand = typeof rng === 'function' ? rng : Math.random;
    for (var i = a.length - 1; i > 0; i--) {
      var r = Number(rand());
      if (!(r >= 0 && r < 1)) r = 0;
      var j = Math.min(i, Math.floor(r * (i + 1)));
      var t = a[i];
      a[i] = a[j];
      a[j] = t;
    }
    return a;
  }

  /* 本次队列：ids 是接下来要出现的卡片顺序，pos 是当前位置。
     标“还不会”的当前卡会被插回队列前方，隔几张再次出现；标“掌握了”则不再出现。 */
  function createSession(cards, opts) {
    opts = opts || {};
    var ids = (cards || []).map(function (c) { return c.id; });
    if (opts.shuffle) ids = shuffle(ids, opts.rng);
    return { ids: ids, pos: 0, total: ids.length, rated: 0, misses: {}, completed: {}, finished: ids.length === 0 };
  }

  function currentCardId(session) {
    return !session || session.finished ? null : session.ids[session.pos];
  }

  function moveCard(session, delta) {
    if (!session || !session.ids.length) return session;
    session.pos = Math.max(0, Math.min(session.ids.length - 1, session.pos + delta));
    session.finished = false;
    return session;
  }

  /* 给当前卡评分。rating：'again'（还不会）或 'known'（掌握了）。
     gap：还不会的卡隔多少张别的卡再出现；连续标不会时间隔翻倍。 */
  function rateCard(session, id, rating, opts) {
    if (!session || currentCardId(session) !== id) return session;
    if (rating !== 'again' && rating !== 'known') return session;
    opts = opts || {};
    if (rating === 'again') {
      var miss = (session.misses[id] || 0) + 1;
      session.misses[id] = miss;
      delete session.completed[id];
      var gap = Math.min((isNum(opts.gap) ? opts.gap : 3) * miss, 12);
      var next = session.ids.indexOf(id, session.pos + 1);
      var want = Math.min(session.pos + 1 + gap, session.ids.length);
      if (next < 0) session.ids.splice(want, 0, id);
      else if (next > want) { session.ids.splice(next, 1); session.ids.splice(want, 0, id); }
    } else {
      delete session.misses[id];
      session.completed[id] = true;
      for (var j = session.ids.length - 1; j > session.pos; j--) {
        if (session.ids[j] === id) session.ids.splice(j, 1);
      }
    }
    session.rated += 1;
    session.pos += 1;
    if (session.pos >= session.ids.length) session.finished = true;
    return session;
  }

  /* 本地存储里的进度只保留仍然存在的卡片，字段一律整理成合法值 */
  function normalizeProgress(progress, cards) {
    var out = {};
    var allowed = {};
    (cards || []).forEach(function (c) { if (c && c.id) allowed[c.id] = true; });
    if (progress && typeof progress === 'object') {
      Object.keys(progress).forEach(function (id) {
        var rec = progress[id];
        if (!allowed[id] || !rec || typeof rec !== 'object') return;
        var s = rec.s === 'known' ? 'known' : rec.s === 'again' ? 'again' : null;
        if (!s) return;
        out[id] = { s: s, t: isNum(rec.t) ? rec.t : 0, k: clampInt(rec.k, 0, 1e9, 0), a: clampInt(rec.a, 0, 1e9, 0) };
      });
    }
    return out;
  }

  /* 记一次评分，返回新的进度对象（不改动传入的对象）。
     传入 cards 时顺带清掉已经不存在的卡片；不传则保留其余条目。 */
  function recordRating(progress, id, rating, now, cards) {
    var keep = [];
    if (cards) keep = cards.map(function (c) { return c && c.id; }).filter(Boolean);
    else if (progress && typeof progress === 'object') keep = Object.keys(progress);
    if (rating !== 'known' && rating !== 'again') {
      return keep.length ? normalizeProgress(progress, keep.map(function (x) { return { id: x }; })) : {};
    }
    if (keep.indexOf(id) < 0) keep.push(id);
    var next = normalizeProgress(progress, keep.map(function (x) { return { id: x }; }));
    var rec = next[id] || { s: 'unseen', t: 0, k: 0, a: 0 };
    if (rating === 'known') { rec.s = 'known'; rec.k += 1; } else { rec.s = 'again'; rec.a += 1; }
    rec.t = isNum(now) ? now : 0;
    next[id] = rec;
    return next;
  }

  function groupStats(cards, progress, keyOf, order) {
    var map = {};
    (cards || []).forEach(function (card) {
      var key = keyOf(card);
      var g = map[key] || (map[key] = { key: key, total: 0, known: 0, again: 0, unseen: 0 });
      g.total += 1;
      g[cardStatus(progress, card.id)] += 1;
    });
    var keys = Object.keys(map);
    if (order) {
      keys.sort(function (a, b) {
        var ia = order.indexOf(a), ib = order.indexOf(b);
        return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
      });
    }
    return keys.map(function (k) {
      var g = map[k];
      g.percent = g.total ? Math.round(g.known / g.total * 100) : 0;
      return g;
    });
  }

  function cardStats(cards, progress) {
    cards = cards || [];
    progress = normalizeProgress(progress, cards);
    var s = { total: cards.length, known: 0, again: 0, unseen: 0, learned: 0, percent: 0 };
    cards.forEach(function (card) { s[cardStatus(progress, card.id)] += 1; });
    s.learned = s.known + s.again;
    s.percent = s.total ? Math.round(s.known / s.total * 100) : 0;
    s.byDomain = groupStats(cards, progress, function (c) { return c.domain; }, CARD_DOMAINS);
    s.byLevel = groupStats(cards, progress, function (c) { return c.level; }, CARD_LEVELS);
    s.byBasis = groupStats(cards, progress, function (c) { return c.basis; }, CARD_BASES);
    return s;
  }

  var cards = {
    DOMAINS: CARD_DOMAINS,
    LEVELS: CARD_LEVELS,
    BASES: CARD_BASES,
    STATUS: CARD_STATUS,
    P8_CAVEAT: P8_CAVEAT,
    terms: termsOf,
    match: matchTerms,
    haystack: cardHaystack,
    status: cardStatus,
    filter: filterCards,
    shuffle: shuffle,
    createSession: createSession,
    current: currentCardId,
    move: moveCard,
    rate: rateCard,
    normalizeProgress: normalizeProgress,
    recordRating: recordRating,
    stats: cardStats
  };

  /* ============================================================ 大纲检索 */

  function searchEco(eco, query) {
    eco = use(eco).ECO || {};
    var terms = termsOf(query);
    var domains = [];
    var matched = 0;
    var total = 0;
    (eco.domains || []).forEach(function (d) {
      var tasks = [];
      (d.tasks || []).forEach(function (t) {
        total += 1;
        var text = [d.name, t.title].concat(t.points || []).join(' ');
        if (!terms.length || matchTerms(text, terms)) tasks.push(t);
      });
      matched += tasks.length;
      if (tasks.length) domains.push({ id: d.id, name: d.name, percent: d.percent, tasks: tasks });
    });
    return { terms: terms, domains: domains, matched: matched, total: total };
  }

  var eco = { search: searchEco };

  /* ============================================================ 数据校验 */

  var BANNED_WORDS = ['加强管理', '提高意识', '高度重视', '充分重视', '加大力度', '狠抓',
    '示例文本', '张三', '某公司', 'Lorem', 'TODO', 'TBD', '占位'];
  /* ®、©、™、ℹ 这类字符也在 Extended_Pictographic 里，检查前先去掉，避免把商标符号当成 emoji */
  var EMOJI_RE = /\p{Extended_Pictographic}/u;

  function hasEmoji(text) {
    return EMOJI_RE.test(String(text).replace(/[\u00A9\u00AE\u2122\u2139]/g, ''));
  }

  function eachString(value, fn) {
    if (typeof value === 'string') fn(value);
    else if (Array.isArray(value)) value.forEach(function (v) { eachString(v, fn); });
    else if (value && typeof value === 'object') Object.keys(value).forEach(function (k) { eachString(value[k], fn); });
  }

  /* 内容完整性检查，返回问题列表；空数组表示全部通过 */
  function validate(data) {
    data = use(data);
    var errors = [];
    var ecoData = data.ECO || {};
    var domains = ecoData.domains || [];

    /* 大纲 */
    if (domains.length !== 3) errors.push('ECO：领域数应为 3，实际 ' + domains.length);
    var percentSum = domains.reduce(function (sum, d) { return sum + (d.percent || 0); }, 0);
    if (percentSum !== 100) errors.push('ECO：领域占比之和应为 100，实际 ' + percentSum);
    var counts = domains.map(function (d) { return (d.tasks || []).length; }).join('/');
    if (counts !== '8/10/8') errors.push('ECO：三个领域的任务数应为 8/10/8，实际 ' + counts);
    domains.forEach(function (d) {
      (d.tasks || []).forEach(function (t, n) {
        if (!str(t.title)) errors.push('ECO：' + d.name + ' 第 ' + (n + 1) + ' 项任务缺少标题');
        if (!Array.isArray(t.points) || t.points.length < 1 || t.points.length > 2) {
          errors.push('ECO：' + d.name + '“' + t.title + '”的要点应为 1–2 条');
        } else if (t.points.some(function (p) { return !str(p); })) {
          errors.push('ECO：' + d.name + '“' + t.title + '”的要点有空条目');
        }
      });
    });
    var exam = ecoData.exam || {};
    if (exam.questions !== exam.scored + exam.pretest) errors.push('ECO：考试题数不等于计分题数加预备题数');
    if (!(exam.minutes > 0)) errors.push('ECO：缺少考试时长');
    var paths = (ecoData.eligibility && ecoData.eligibility.paths) || [];
    if (paths.length !== 4) errors.push('ECO：报考路径应为 4 条，实际 ' + paths.length);
    paths.forEach(function (p) {
      if (!(p.months > 0)) errors.push('ECO：报考路径“' + p.education + '”的月数不合法');
    });

    /* 风险库 */
    var library = data.RISK_LIBRARY || {};
    var seenRisk = {};
    (data.PROJECT_TYPES || []).forEach(function (type) {
      (data.FOCUS_AREAS || []).forEach(function (focus) {
        var rows = library[type.id] && library[type.id][focus.id];
        if (!Array.isArray(rows)) {
          errors.push('风险库：缺少“' + type.name + ' · ' + focus.name + '”');
          return;
        }
        if (rows.length < 4 || rows.length > 6) {
          errors.push('风险库：“' + type.name + ' · ' + focus.name + '”应有 4–6 条，实际 ' + rows.length);
        }
        rows.forEach(function (r, n) {
          var tag = '风险库“' + type.name + ' · ' + focus.name + '”第 ' + (n + 1) + ' 条';
          var item = normalizeRisk(r);
          if (!item) { errors.push(tag + '：缺少标题'); return; }
          if (!item.signal) errors.push(tag + '：缺少预警信号');
          if (!item.response) errors.push(tag + '：缺少应对措施');
          if (!(r.p >= 1 && r.p <= 5) || Math.round(r.p) !== r.p) errors.push(tag + '：概率 P 应为 1–5 的整数');
          if (!(r.i >= 1 && r.i <= 5) || Math.round(r.i) !== r.i) errors.push(tag + '：影响 I 应为 1–5 的整数');
          if (!r.kind || !RISK_KINDS[r.kind]) errors.push(tag + '：风险类型不合法');
          if (RISK_STRATEGIES[item.kind].indexOf(r.strategy) < 0) errors.push(tag + '：应对策略“' + r.strategy + '”与风险类型不匹配');
          if (seenRisk[r.id]) errors.push(tag + '：id 重复');
          seenRisk[r.id] = true;
        });
      });
    });

    /* 考点卡 */
    var list = data.CARDS || [];
    if (list.length < 60 || list.length > 80) errors.push('考点卡：数量应为 60–80 张，实际 ' + list.length);
    var seenCard = {};
    list.forEach(function (c, n) {
      var tag = '考点卡第 ' + (n + 1) + ' 张（' + (c.id || '无 id') + '）';
      if (!c.id) { errors.push(tag + '：缺少 id'); return; }
      if (seenCard[c.id]) errors.push(tag + '：id 重复');
      seenCard[c.id] = true;
      if (CARD_DOMAINS.indexOf(c.domain) < 0) errors.push(tag + '：领域“' + c.domain + '”不合法');
      if (CARD_BASES.indexOf(c.basis) < 0) errors.push(tag + '：依据“' + c.basis + '”不合法');
      if (CARD_LEVELS.indexOf(c.level) < 0) errors.push(tag + '：难度“' + c.level + '”不合法');
      if (!str(c.front)) errors.push(tag + '：正面为空');
      if (!Array.isArray(c.back) || c.back.length < 3 || c.back.length > 6) errors.push(tag + '：背面应为 3–6 行');
      else if (c.back.some(function (line) { return !str(line); })) errors.push(tag + '：背面有空行');
      if (c.basis === BASIS_P6 && !str(c.note)) errors.push(tag + '：第六版概念需要说明它在第八版里的位置');
      if (c.basis === BASIS_P8 && str(c.note).indexOf(P8_CAVEAT) < 0) errors.push(tag + '：第八版卡片需要注明“细节以教材为准”');
    });

    /* 文案 */
    var texts = data.TEXTS || {};
    if (str(texts.disclaimer).indexOf('非官方') < 0) errors.push('文案：免责声明需要写明“非官方”');
    if (str(texts.trademark).indexOf('Project Management Institute') < 0) errors.push('文案：缺少商标归属说明');

    /* emoji 与空话（只查内容数据，不查对象的键名） */
    eachString(data, function (s) {
      if (hasEmoji(s)) errors.push('内容里出现了 emoji：' + s.slice(0, 24));
      for (var i = 0; i < BANNED_WORDS.length; i++) {
        if (s.indexOf(BANNED_WORDS[i]) >= 0) errors.push('内容里出现了空话或占位词“' + BANNED_WORDS[i] + '”：' + s.slice(0, 24));
      }
    });

    return { ok: errors.length === 0, errors: errors };
  }

  return {
    evm: evm,
    risk: risk,
    cards: cards,
    eco: eco,
    validate: validate,
    hasEmoji: hasEmoji
  };
});
