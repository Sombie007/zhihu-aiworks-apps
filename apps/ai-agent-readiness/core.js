/* ============================================================================
   AI Agent 落地评估自测 · 核心逻辑
   纯函数：不碰 DOM、不碰 localStorage。浏览器里挂到 window.APP_CORE，
   Node 里通过 module.exports 导出（供单元测试使用）。
   计分口径（见 design/specs/ai-agent-readiness.md）：
     每题 1–5 分；维度得分 = 5 题之和（5–25），平均分 = 和 / 5（雷达图 1–5 刻度）；
     总分 = 30 题之和（30–150），按区间落入五档：
       30–54 观望期 · 55–79 试点期 · 80–104 起步期 · 105–129 推广期 · 130–150 体系期
   ========================================================================== */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.APP_CORE = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var MAX_SCORE = 5;          /* 单题最高分 */
  var MIN_SCORE = 1;          /* 单题最低分 */
  var MIN_TOTAL = 30;         /* 总分下限：30 题 × 1 分 */
  var MAX_TOTAL = 150;        /* 总分上限：30 题 × 5 分 */
  var WEAK_CAP = 2;           /* 每个维度最多给出几道最低分题的建议 */

  /* ---------- 基础 ---------- */

  /** 1–5 的整数才是有效得分；空值、小数、越界、非数字一律无效 */
  function isValidScore(value) {
    return typeof value === "number" && isFinite(value) && value % 1 === 0 && value >= MIN_SCORE && value <= MAX_SCORE;
  }

  function isAnswer(value) { return isValidScore(value); }

  function pad2(n) { return (n < 10 ? "0" : "") + n; }

  /** 时间戳 → 本地日期 YYYY-MM-DD；没有时间戳（null / undefined）或无效输入返回空串 */
  function formatDate(input) {
    if (input == null || input === "") return "";
    var d = input instanceof Date ? input : new Date(input);
    if (isNaN(d.getTime())) return "";
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
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

  /* ---------- 分级 ---------- */

  /** 总分 → 等级序号 1–5；空值、非数字、非有限数、非整数、越界（< 30 或 > 150）返回 null */
  function gradeFor(total) {
    if (typeof total !== "number" || !isFinite(total) || total % 1 !== 0 || total < MIN_TOTAL || total > MAX_TOTAL) return null;
    if (total <= 54) return 1;
    if (total <= 79) return 2;
    if (total <= 104) return 3;
    if (total <= 129) return 4;
    return 5;
  }

  function levelByNumber(data, level) {
    var hit = (data.levels || []).filter(function (l) { return l.level === level; })[0];
    return hit || null;
  }

  function levelName(level) {
    var names = [null, "观望期", "试点期", "起步期", "推广期", "体系期"];
    return names[level] || "";
  }

  /** 平均分（1 位小数的字符串，用于展示）；没有有效作答返回空串 */
  function avgText(scores) {
    var valid = (scores || []).filter(isValidScore);
    if (!valid.length) return "";
    return (valid.reduce(function (a, b) { return a + b; }, 0) / valid.length).toFixed(1);
  }

  /* ---------- 短板题（每维度最低分的 1–2 题） ---------- */

  /**
   * 取得分最低的题；并列最低分的最多给 2 道（按题库顺序）。
   * 全部满分（5 分）的维度没有短板，返回空数组。
   * items: [{ q, score }]，score 已过滤为 null 的无效作答。
   */
  function weakestQuestions(items) {
    var valid = (items || []).filter(function (it) { return isValidScore(it.score); });
    if (!valid.length) return [];
    var min = Math.min.apply(null, valid.map(function (it) { return it.score; }));
    if (min >= MAX_SCORE) return [];
    return valid.filter(function (it) { return it.score === min; }).slice(0, WEAK_CAP);
  }

  /* ---------- 总评估 ---------- */

  function evaluate(rawAnswers, data) {
    var answers = normalizeAnswers(rawAnswers, data);
    var total = 0;        /* 30 题得分之和 */
    var answered = 0;     /* 已答题数 */
    var questionCount = 0;

    var dimensions = data.dimensions.map(function (dim, dimIndex) {
      var items = dim.questions.map(function (q, qIndex) {
        questionCount++;
        var has = answers[q.id] !== undefined;
        if (has) { answered++; total += answers[q.id]; }
        return { q: q, qIndex: qIndex, score: has ? answers[q.id] : null };
      });

      var scores = items.filter(function (it) { return it.score != null; }).map(function (it) { return it.score; });
      var score = scores.reduce(function (a, b) { return a + b; }, 0);
      var counts = [0, 0, 0, 0, 0, 0];
      scores.forEach(function (s) { counts[s]++; });

      return {
        id: dim.id,
        ordinal: dim.ordinal,
        name: dim.name,
        summary: dim.summary,
        index: dimIndex,
        items: items,
        scores: scores,
        score: score,                          /* 5–25（未答满时是已答部分之和） */
        maxScore: dim.questions.length * MAX_SCORE,
        avg: scores.length ? score / scores.length : null,
        answered: scores.length,
        unanswered: items.length - scores.length,
        counts: counts,
        weakest: weakestQuestions(items)       /* 最低分的 1–2 题（全满分时为空） */
      };
    });

    var complete = answered === questionCount && questionCount > 0;

    var overall = null;
    if (answered && complete) {
      var level = gradeFor(total);
      if (level != null) {
        var current = levelByNumber(data, level);
        var nextLevel = level < 5 ? levelByNumber(data, level + 1) : null;
        overall = {
          level: level,
          name: current ? current.name : levelName(level),
          diagnosis: current ? current.diagnosis : "",
          action: current ? current.action : "",
          next: nextLevel,
          gapToNext: nextLevel ? nextLevel.min - total : 0
        };
      }
    }

    return {
      total: total,
      maxTotal: MAX_TOTAL,
      questionCount: questionCount,
      answered: answered,
      complete: complete,
      answers: answers,
      dimensions: dimensions,
      overall: overall
    };
  }

  /* ---------- 文本生成 ---------- */

  function byId(result, id) {
    for (var i = 0; i < result.dimensions.length; i++) if (result.dimensions[i].id === id) return result.dimensions[i];
    return null;
  }

  function optionLabel(data, score) {
    var hit = (data.scale || []).filter(function (o) { return o.value === score; })[0];
    return hit ? hit.label : "";
  }

  /**
   * 结论摘要（纯文本，供复制）：总分与档位、六维得分、每维最低分题与建议、复测提示。
   * opts: { date }
   */
  function buildSummary(result, data, opts) {
    opts = opts || {};
    var lines = [];
    lines.push("AI Agent 落地评估自测 · 结论摘要");
    if (opts.date) lines.push("评估日期：" + opts.date);

    if (!result.complete) {
      lines.push("还有 " + (result.questionCount - result.answered) + " 道题没答，答完后才能生成结论。");
      lines.push("当前进度：已答 " + result.answered + " / " + result.questionCount + " 题。");
      return lines.join("\n");
    }

    lines.push("总分：" + result.total + " / " + result.maxTotal + "　档位：" + result.overall.name);
    lines.push("诊断：" + result.overall.diagnosis);
    lines.push("建议动作：" + result.overall.action);
    if (result.overall.next) {
      lines.push("距下一档「" + result.overall.next.name + "」还差 " + result.overall.gapToNext + " 分。");
    }

    lines.push("六个维度得分（每维 5–25 分）：");
    result.dimensions.forEach(function (d) {
      lines.push("- " + d.name + "：" + d.score + " / " + d.maxScore + "（均分 " + avgText(d.scores) + "）");
    });

    var weak = [];
    result.dimensions.forEach(function (d) {
      d.weakest.forEach(function (it) {
        weak.push(d.name + " " + it.q.no + "（" + optionLabel(data, it.score) + "）：" + it.q.advice);
      });
    });
    if (weak.length) {
      lines.push("各维度短板与建议：");
      weak.forEach(function (w, i) { lines.push((i + 1) + ". " + w); });
    } else {
      lines.push("各维度短板与建议：六个维度全部满分，没有短板题。");
    }

    lines.push(data.retestNote);
    lines.push("说明：" + data.disclaimer);
    return lines.join("\n");
  }

  return {
    MAX_SCORE: MAX_SCORE,
    MIN_SCORE: MIN_SCORE,
    MIN_TOTAL: MIN_TOTAL,
    MAX_TOTAL: MAX_TOTAL,
    WEAK_CAP: WEAK_CAP,
    isValidScore: isValidScore,
    isAnswer: isAnswer,
    formatDate: formatDate,
    indexQuestions: indexQuestions,
    normalizeAnswers: normalizeAnswers,
    gradeFor: gradeFor,
    levelByNumber: levelByNumber,
    levelName: levelName,
    avgText: avgText,
    weakestQuestions: weakestQuestions,
    evaluate: evaluate,
    optionLabel: optionLabel,
    buildSummary: buildSummary,
    byId: byId
  };
});
