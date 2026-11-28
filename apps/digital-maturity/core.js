/* ============================================================================
   数字化成熟度自评 · 核心逻辑
   纯函数：不碰 DOM、不碰 localStorage。浏览器里挂到 window.APP_CORE，
   Node 里通过 module.exports 导出（供单元测试使用）。
   ========================================================================== */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.APP_CORE = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var NA = 0;                 /* “不适用”在作答里的取值 */
  var MAX_LEVEL = 4;
  var PRIORITY_COUNT = 3;
  var LEVEL_NAMES = ["", "一级", "二级", "三级", "四级"];
  var ORDINALS = ["", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];

  /* ---------- 基础 ---------- */

  function levelName(level) {
    return level >= 1 && level <= MAX_LEVEL ? LEVEL_NAMES[level] : "";
  }

  /** 1–4 的整数才是有效得分 */
  function isValidScore(value) {
    return typeof value === "number" && isFinite(value) && value % 1 === 0 && value >= 1 && value <= MAX_LEVEL;
  }

  function isNA(value) { return value === NA; }

  function isAnswer(value) { return isValidScore(value) || isNA(value); }

  function pad2(n) { return (n < 10 ? "0" : "") + n; }

  /** 时间戳 → 本地日期 YYYY-MM-DD；没有时间戳（null / undefined）或无效输入返回空串 */
  function formatDate(input) {
    if (input == null || input === "") return "";
    var d = input instanceof Date ? input : new Date(input);
    if (isNaN(d.getTime())) return "";
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }

  /* ---------- 75% 规则 ---------- */

  /** n 道有效题里，达到某等级至少需要几道（占比不低于 75%） */
  function requiredCount(n) {
    return Math.ceil((n * 3) / 4);
  }

  /**
   * 维度等级：得分达到某等级及以上的题目占比不低于 75% 时达到该等级，取满足条件的最高等级。
   * 0（不适用）被忽略；没有有效得分时返回 null。比较用整数运算，避免浮点误差。
   */
  function dimensionLevel(scores) {
    var valid = (scores || []).filter(isValidScore);
    var n = valid.length;
    if (!n) return null;
    for (var level = MAX_LEVEL; level >= 1; level--) {
      var count = 0;
      for (var i = 0; i < n; i++) if (valid[i] >= level) count++;
      if (count * 4 >= n * 3) return level;
    }
    return 1;
  }

  /**
   * 距下一等级：还要把几道题提到 level+1，该维度才能达到 level+1。
   * candidates 是得分不高于当前等级的题目数，也就是可以往上提的候选题。
   * 已是最高等级或没有有效得分时返回 null。
   */
  function toNextLevel(scores, level) {
    if (level == null || level >= MAX_LEVEL) return null;
    var valid = (scores || []).filter(isValidScore);
    var n = valid.length;
    if (!n) return null;
    var target = level + 1;
    var required = requiredCount(n);
    var have = 0;
    var candidates = 0;
    for (var i = 0; i < n; i++) {
      if (valid[i] >= target) have++;
      else if (valid[i] <= level) candidates++;
    }
    return {
      level: target,
      required: required,
      have: have,
      needRaise: Math.max(0, required - have),
      candidates: candidates
    };
  }

  /* ---------- 题库索引 ---------- */

  /** id → { q, dim, dimIndex, qIndex } */
  function indexQuestions(data) {
    var index = {};
    (data.dimensions || []).forEach(function (dim, di) {
      (dim.questions || []).forEach(function (q, qi) {
        index[q.id] = { q: q, dim: dim, dimIndex: di, qIndex: qi };
      });
    });
    return index;
  }

  /** 只保留题库里存在、取值合法的作答 */
  function normalizeAnswers(answers, data) {
    var out = {};
    if (!answers) return out;
    var index = indexQuestions(data);
    Object.keys(answers).forEach(function (id) {
      if (index[id] && isAnswer(answers[id])) out[id] = answers[id];
    });
    return out;
  }

  /* ---------- 优先补的题 ---------- */

  /**
   * 从全部题目里取得分最低的 3 道（不适用不计）。
   * 并列时先取等级更低的维度里的，再按题库顺序。不足 3 道时有多少给多少。
   */
  function priorityQuestions(answers, data) {
    var dims = data.dimensions || [];
    var list = [];
    dims.forEach(function (dim, di) {
      var scores = dim.questions.map(function (q) { return answers[q.id]; }).filter(isValidScore);
      var dimLevel = dimensionLevel(scores);
      dim.questions.forEach(function (q, qi) {
        var score = answers[q.id];
        if (!isValidScore(score)) return;
        list.push({ q: q, score: score, dim: dim, dimIndex: di, qIndex: qi, dimLevel: dimLevel });
      });
    });
    list.sort(function (a, b) {
      return a.score - b.score ||
        a.dimLevel - b.dimLevel ||
        a.dimIndex - b.dimIndex ||
        a.qIndex - b.qIndex;
    });
    return list.slice(0, PRIORITY_COUNT);
  }

  /* ---------- 总评估 ---------- */

  function evaluate(rawAnswers, data) {
    var answers = normalizeAnswers(rawAnswers, data);
    var total = 0;
    var answered = 0;

    var dimensions = data.dimensions.map(function (dim, dimIndex) {
      var items = dim.questions.map(function (q, qIndex) {
        var value = answers[q.id];
        var has = value !== undefined;
        total++;
        if (has) answered++;
        return { q: q, qIndex: qIndex, score: has ? value : null, answered: has };
      });

      var scores = items.filter(function (it) { return isValidScore(it.score); }).map(function (it) { return it.score; });
      var naCount = items.filter(function (it) { return it.score === NA; }).length;
      var unanswered = items.filter(function (it) { return !it.answered; }).length;
      var counts = [0, 0, 0, 0, 0];
      scores.forEach(function (s) { counts[s]++; });

      var level = dimensionLevel(scores);
      var next = toNextLevel(scores, level);
      var gap = [];
      if (next) {
        next = {
          level: next.level,
          levelName: levelName(next.level),
          required: next.required,
          have: next.have,
          needRaise: next.needRaise,
          candidates: next.candidates
        };
        /* 需要补的题：得分不高于当前等级的题，得分最低的排前面，同分按题库顺序 */
        gap = items.filter(function (it) { return isValidScore(it.score) && it.score <= level; })
          .sort(function (a, b) { return a.score - b.score || a.qIndex - b.qIndex; })
          .map(function (it) { return it.q.id; });
      }

      return {
        id: dim.id,
        ordinal: dim.ordinal,
        name: dim.name,
        index: dimIndex,
        items: items,
        level: level,
        levelName: levelName(level),
        validCount: scores.length,
        naCount: naCount,
        unanswered: unanswered,
        counts: counts,
        required: scores.length ? requiredCount(scores.length) : 0,
        next: next,
        gap: gap,
        allNA: scores.length === 0 && unanswered === 0
      };
    });

    var scored = dimensions.filter(function (d) { return d.level != null; });
    var overallLevel = scored.length ? Math.min.apply(null, scored.map(function (d) { return d.level; })) : null;
    var ids = function (list) { return list.map(function (d) { return d.id; }); };

    var priority = priorityQuestions(answers, data);

    return {
      total: total,
      answered: answered,
      complete: answered === total,
      answers: answers,
      dimensions: dimensions,
      overall: {
        level: overallLevel,
        levelName: levelName(overallLevel),
        bottleneckIds: overallLevel == null ? [] : ids(scored.filter(function (d) { return d.level === overallLevel; })),
        aboveIds: overallLevel == null ? [] : ids(scored.filter(function (d) { return d.level > overallLevel; })),
        excludedIds: ids(dimensions.filter(function (d) { return d.level == null; }))
      },
      priority: priority,
      priorityIds: priority.map(function (p) { return p.q.id; })
    };
  }

  /* ---------- 文本生成 ---------- */

  function byId(result, id) {
    for (var i = 0; i < result.dimensions.length; i++) if (result.dimensions[i].id === id) return result.dimensions[i];
    return null;
  }

  function joinNames(names) {
    return names.map(function (n) { return "「" + n + "」"; }).join("");
  }

  function verdictFor(level, data) {
    var hit = (data.levels || []).filter(function (l) { return l.level === level; })[0];
    return hit ? hit.verdict : "";
  }

  /**
   * “为什么是这个等级”：返回 2–4 段话。
   * 依次是：谁卡住了等级 → 各卡点维度还差几道题、要一起升上去 → 不拖后腿的维度 → 未计入的维度。
   */
  function buildWhy(result, data) {
    var overall = result.overall;
    var excluded = overall.excludedIds.map(function (id) { return byId(result, id); });
    var paragraphs = [];
    var tail = excluded.map(function (d) {
      return "「" + d.name + "」全部选了「不适用」，无有效作答，未计入综合等级。";
    });

    if (overall.level == null) {
      return ["二十道题都选了「不适用」，没有可以判定等级的维度，所以给不出综合等级。"].concat(tail);
    }

    var level = overall.levelName;
    var bottleneck = overall.bottleneckIds.map(function (id) { return byId(result, id); });
    var above = overall.aboveIds.map(function (id) { return byId(result, id); });
    var n = bottleneck.length;
    var scoredCount = n + above.length;

    if (overall.level === MAX_LEVEL) {
      paragraphs.push((scoredCount === 4 ? "四个维度" : "已作答的 " + scoredCount + " 个维度") +
        "都已达到四级，这是本工具的最高等级，没有卡点。");
      return paragraphs.concat(tail);
    }

    /* 第一段：谁卡住了等级 */
    if (n === scoredCount && n === 4) {
      paragraphs.push("四个维度都停在" + level + "，综合等级取其中最低的一级，所以是" + level + "。");
    } else if (n === 1) {
      paragraphs.push("综合等级取四个维度中最低的一级。「" + bottleneck[0].name + "」停在" + level + "，把整体定在了" + level + "。");
    } else {
      paragraphs.push("综合等级取四个维度中最低的一级。" + joinNames(bottleneck.map(function (d) { return d.name; })) +
        "这 " + n + " 个维度停在" + level + "，把整体定在了" + level + "。");
    }

    /* 第二段：各卡点维度还差几道题 */
    var nextName = levelName(overall.level + 1);
    var needs = bottleneck.map(function (d) {
      return "「" + d.name + "」再提升 " + d.next.needRaise + " 道题可达到" + nextName;
    });
    var closing;
    if (n === 1) closing = "它升上去，综合等级就会跟着到" + nextName + "。";
    else if (n === 4) closing = "四个维度都达到" + nextName + "，综合等级才会变成" + nextName + "。";
    else closing = "这几个维度都升上去，综合等级才会跟着到" + nextName + "。";
    paragraphs.push(needs.join("；") + "。" + closing);

    /* 第三段：不拖后腿的维度 */
    if (above.length) {
      var sameLevel = above.every(function (d) { return d.level === above[0].level; });
      paragraphs.push(joinNames(above.map(function (d) { return d.name; })) + "已达到" +
        (sameLevel ? above[0].levelName : above[0].levelName + "及以上") + "，暂时不拖后腿。");
    }

    return paragraphs.concat(tail);
  }

  /**
   * 结论摘要（纯文本）：综合等级、四个维度等级、优先补的题。
   * opts: { date, profileLine, version }
   */
  function buildSummary(result, data, opts) {
    opts = opts || {};
    var lines = [];
    var overall = result.overall;
    lines.push("数字化成熟度自评 · 结论摘要");
    if (opts.date) lines.push("评估日期：" + opts.date);
    lines.push("企业信息：" + (opts.profileLine || (data.profile && data.profile.emptyLabel) || "未填写企业信息"));

    if (overall.level == null) {
      lines.push("综合等级：无法判定（所有题目均选「不适用」）");
    } else {
      lines.push("综合等级：" + overall.levelName);
      lines.push("判读：" + verdictFor(overall.level, data));
    }

    lines.push("维度等级：" + result.dimensions.map(function (d) {
      return d.name + " " + (d.level == null ? "未计入（无有效作答）" : d.levelName);
    }).join("；"));

    var n = result.priority.length;
    if (!n) {
      lines.push("优先补的题：无");
    } else {
      var head = overall.level === MAX_LEVEL ? "得分相对最低的 " + n + " 道题（可继续优化）" : "优先补的 " + n + " 道题";
      lines.push(head + "：");
      result.priority.forEach(function (p, i) {
        lines.push((i + 1) + ". " + p.q.no + " " + p.q.title + "（" + p.dim.name + "，当前" + levelName(p.score) + "）—— " + p.q.advice);
      });
    }
    lines.push("说明：非官方自评，结果不构成官方评测结论。");
    return lines.join("\n");
  }

  /** 抬头里的企业信息一行，例如“制造业 · 50–300 人”；没填的那一项写明“未填写” */
  function profileLine(profile, data) {
    var p = data.profile || {};
    var find = function (list, value) {
      var hit = (list || []).filter(function (x) { return x.value === value; })[0];
      return hit ? hit.label : "";
    };
    var industry = find(p.industries, profile && profile.industry);
    var size = find(p.sizes, profile && profile.size);
    if (!industry && !size) return p.emptyLabel || "未填写企业信息";
    return (industry || "行业未填写") + " · " + (size || "规模未填写");
  }

  return {
    NA: NA,
    MAX_LEVEL: MAX_LEVEL,
    PRIORITY_COUNT: PRIORITY_COUNT,
    levelName: levelName,
    ordinal: function (n) { return ORDINALS[n] || String(n); },
    isValidScore: isValidScore,
    isNA: isNA,
    isAnswer: isAnswer,
    formatDate: formatDate,
    requiredCount: requiredCount,
    dimensionLevel: dimensionLevel,
    toNextLevel: toNextLevel,
    indexQuestions: indexQuestions,
    normalizeAnswers: normalizeAnswers,
    priorityQuestions: priorityQuestions,
    evaluate: evaluate,
    verdictFor: verdictFor,
    buildWhy: buildWhy,
    buildSummary: buildSummary,
    profileLine: profileLine
  };
});
