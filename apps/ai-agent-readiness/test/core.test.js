/* ============================================================================
   AI Agent 落地评估自测 · core.js 单元测试
   ----------------------------------------------------------------------------
   运行（在项目根目录或本应用目录）：
     node --test apps/ai-agent-readiness/
     node --test apps/ai-agent-readiness/test/core.test.js

   只用 Node 内置的 node:test 和 node:assert/strict，不依赖第三方包。
   package.json 里写了 "type": "module"，所以本文件是 ESM；
   core.js / data.js 是给浏览器 <script> 用的经典脚本（UMD），这里用
   vm.runInThisContext 按经典脚本执行一遍，取挂到全局的 APP_CORE / APP_DATA。
   先补一个 self——UMD 的浏览器分支靠它识别运行环境；这也顺带验证了
   「无模块环境也能跑」这条浏览器路径。不用 runInNewContext：
   那会创建新的 V8 上下文，里面的数组和宿主环境的原型不同，
   assert/strict 的深比较会全部误报。
   ========================================================================== */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

if (typeof globalThis.self === "undefined") globalThis.self = globalThis;

function loadScript(name) {
  vm.runInThisContext(fs.readFileSync(path.join(here, "..", name), "utf8"), { filename: name });
}

loadScript("core.js");
loadScript("data.js");
const core = globalThis.APP_CORE;
const data = globalThis.APP_DATA;

/* ---------- 造作答的工具 ---------- */

/** 按维度给分：{ strategy: [5,4,3,2,1], ... }，没给出的维度用 fallback */
function answersByDim(map, fallback) {
  const out = {};
  data.dimensions.forEach((dim) => {
    const spec = Object.prototype.hasOwnProperty.call(map, dim.id) ? map[dim.id] : fallback;
    dim.questions.forEach((q, i) => {
      const v = Array.isArray(spec) ? spec[i] : spec;
      if (v != null) out[q.id] = v;
    });
  });
  return out;
}

const all = (v) => answersByDim({}, v);
const dim = (result, id) => result.dimensions.find((d) => d.id === id);

/** 构造总分恰好等于 total 的完整作答：全部 1 分起步，把余量逐题加满（每题最多 +4） */
function answersWithTotal(total) {
  assert.ok(total >= 30 && total <= 150, "total 必须在 30–150 之间");
  const out = {};
  let extra = total - 30;
  data.dimensions.forEach((d) => {
    d.questions.forEach((q) => {
      const add = Math.min(4, extra);
      out[q.id] = 1 + add;
      extra -= add;
    });
  });
  assert.equal(extra, 0, "余量分配完应为 0");
  return out;
}

/* ---------- 题库 ---------- */

describe("题库（data.js）", () => {
  test("六个维度共 30 题，每题有题干、题号、建议（40 字内）", () => {
    assert.equal(data.dimensions.length, 6);
    assert.deepEqual(data.dimensions.map((d) => d.questions.length), [5, 5, 5, 5, 5, 5]);
    assert.equal(data.dimensions.reduce((n, d) => n + d.questions.length, 0), 30);
    const seen = new Set();
    data.dimensions.forEach((d, di) => {
      d.questions.forEach((q, qi) => {
        assert.ok(!seen.has(q.id), "题目 id 重复：" + q.id);
        seen.add(q.id);
        assert.equal(q.no, `${di + 1}.${qi + 1}`, q.id + " 题号");
        assert.ok(q.text && q.text.length >= 12, q.no + " 题干缺失或过短");
        assert.ok(q.advice && q.advice.length > 0, q.no + " 缺少建议");
        assert.ok(q.advice.length <= 40, q.no + " 建议超过 40 字（" + q.advice.length + "）：" + q.advice);
      });
    });
  });

  test("三十道题的题干预料与规格一致（逐维度抽查关键句）", () => {
    const textOf = (id) => {
      for (const d of data.dimensions) {
        const q = d.questions.find((x) => x.id === id);
        if (q) return q.text;
      }
      return "";
    };
    assert.ok(textOf("s1").includes("用 AI Agent 解决什么业务问题"));
    assert.ok(textOf("s1").includes("别人有我们也要有"));
    assert.ok(textOf("s2").includes("投入产出账"));
    assert.ok(textOf("s5").includes("3–6 个月可量化的成功标准"));
    assert.ok(textOf("d2").includes("喂给 RAG 的文档资产"));
    assert.ok(textOf("d5").includes("有专人（而不是没人）对知识库内容负责"));
    assert.ok(textOf("t1").includes("大模型接入方式"));
    assert.ok(textOf("t5").includes("日志与监控"));
    assert.ok(textOf("p1").includes("高频、规则相对清晰、容错可接受"));
    assert.ok(textOf("p5").includes("降级预案"));
    assert.ok(textOf("o1").includes("人人有责=无人负责"));
    assert.ok(textOf("o5").includes("试错文化"));
    assert.ok(textOf("g1").includes("使用红线"));
    assert.ok(textOf("g5").includes("责任与止损流程是清楚的"));
  });

  test("量表：1–5 五档，含义齐全", () => {
    assert.deepEqual(data.scale.map((o) => o.value), [1, 2, 3, 4, 5]);
    data.scale.forEach((o) => assert.ok(o.label.length > 0));
    assert.equal(data.scale[0].label, "完全没有 / 没想过");
    assert.equal(data.scale[4].label, "体系化 / 可复制推广");
  });

  test("五档分级：区间首尾相接、恰好覆盖 30–150，诊断文案来自规格", () => {
    assert.deepEqual(data.levels.map((l) => l.level), [1, 2, 3, 4, 5]);
    const ranges = data.levels.map((l) => [l.min, l.max]);
    assert.deepEqual(ranges, [[30, 54], [55, 79], [80, 104], [105, 129], [130, 150]]);
    assert.deepEqual(data.levels.map((l) => l.name),
      ["观望期", "试点期", "起步期", "推广期", "体系期"]);
    assert.ok(data.levels[0].diagnosis.includes("看热闹"));
    assert.equal(data.levels[1].diagnosis, "有热情但底子薄");
    assert.equal(data.levels[2].diagnosis, "试点有结果，缺体系");
    assert.equal(data.levels[3].diagnosis, "有体系在推广");
    assert.equal(data.levels[4].diagnosis, "能自己造血迭代");
    data.levels.forEach((l) => {
      assert.ok(l.action.length > 10, l.name + " 缺建议动作");
      assert.ok(l.min < l.max, l.name + " 区间颠倒");
    });
    for (let i = 1; i < data.levels.length; i++) {
      assert.equal(data.levels[i].min, data.levels[i - 1].max + 1, "档位区间要首尾相接");
    }
  });

  test("复测提示与免责说明都在", () => {
    assert.ok(data.retestNote.includes("3 个月"));
    assert.ok(data.retestNote.includes("复测"));
    assert.ok(data.disclaimer.includes("非官方"));
    assert.ok(data.disclaimer.includes("不构成"));
  });
});

/* ---------- 取值校验 ---------- */

describe("isValidScore / normalizeAnswers", () => {
  test("只有 1–5 的整数是有效得分", () => {
    for (const v of [1, 2, 3, 4, 5]) assert.equal(core.isValidScore(v), true, String(v));
    for (const v of [0, 6, -1, 2.5, 5.1, "3", null, undefined, NaN, Infinity, true]) {
      assert.equal(core.isValidScore(v), false, String(v));
    }
  });

  test("normalizeAnswers：丢掉未知 id 和非法取值，保留合法作答", () => {
    const normalized = core.normalizeAnswers(
      { s1: 3, d2: 0, t9: 4, p1: 6, o2: "5", g3: 2.5, "x-123": 5, s5: NaN },
      data
    );
    assert.deepEqual(normalized, { s1: 3 });
  });

  test("normalizeAnswers：null / undefined / 空对象都返回空", () => {
    assert.deepEqual(core.normalizeAnswers(null, data), {});
    assert.deepEqual(core.normalizeAnswers(undefined, data), {});
    assert.deepEqual(core.normalizeAnswers({}, data), {});
  });
});

/* ---------- 分档（30–150，五档区间边界） ---------- */

describe("gradeFor：总分分档", () => {
  test("十个边界值：30/54、55/79、80/104、105/129、130/150", () => {
    assert.equal(core.gradeFor(30), 1);
    assert.equal(core.gradeFor(54), 1);
    assert.equal(core.gradeFor(55), 2);
    assert.equal(core.gradeFor(79), 2);
    assert.equal(core.gradeFor(80), 3);
    assert.equal(core.gradeFor(104), 3);
    assert.equal(core.gradeFor(105), 4);
    assert.equal(core.gradeFor(129), 4);
    assert.equal(core.gradeFor(130), 5);
    assert.equal(core.gradeFor(150), 5);
  });

  test("区间内再抽几个值", () => {
    assert.equal(core.gradeFor(31), 1);
    assert.equal(core.gradeFor(53), 1);
    assert.equal(core.gradeFor(66), 2);
    assert.equal(core.gradeFor(92), 3);
    assert.equal(core.gradeFor(117), 4);
    assert.equal(core.gradeFor(149), 5);
  });

  test("越界与非法输入返回 null", () => {
    for (const v of [0, 1, 29, 29.9, 151, 300, -30]) assert.equal(core.gradeFor(v), null, String(v));
    for (const v of [null, undefined, "86", "86", NaN, Infinity, -Infinity, 86.5]) {
      assert.equal(core.gradeFor(v), null, String(v));
    }
  });

  test("levelName / levelByNumber", () => {
    assert.equal(core.levelName(1), "观望期");
    assert.equal(core.levelName(5), "体系期");
    assert.equal(core.levelName(0), "");
    assert.equal(core.levelName(6), "");
    assert.equal(core.levelByNumber(data, 3).name, "起步期");
    assert.equal(core.levelByNumber(data, 9), null);
  });
});

/* ---------- 维度汇总 ---------- */

describe("维度汇总与均分", () => {
  test("维度得分 = 5 题之和，均分保留一位小数", () => {
    const r = core.evaluate(all(4), data);
    const d = dim(r, "strategy");
    assert.equal(d.score, 20);
    assert.equal(d.maxScore, 25);
    assert.equal(d.avg, 4);
    assert.equal(core.avgText(d.scores), "4.0");
  });

  test("avgText：[5,4,3,2,1] → 3.0；[4,4,4,4,5] → 4.2；空 → 空串", () => {
    assert.equal(core.avgText([5, 4, 3, 2, 1]), "3.0");
    assert.equal(core.avgText([4, 4, 4, 4, 5]), "4.2");
    assert.equal(core.avgText([1, 1, 1, 1, 1]), "1.0");
    assert.equal(core.avgText([]), "");
    assert.equal(core.avgText(null), "");
  });

  test("未答满的维度：得分只算已答部分，unanswered 记对", () => {
    const answers = answersByDim({ data: [5, 4] }, null);
    const r = core.evaluate(answers, data);
    const d = dim(r, "data");
    assert.equal(d.score, 9);
    assert.equal(d.answered, 2);
    assert.equal(d.unanswered, 3);
    assert.equal(d.avg, 4.5);
    assert.equal(r.complete, false);
  });

  test("counts：各分值的题数分布", () => {
    const r = core.evaluate(answersByDim({ tech: [5, 4, 4, 2, 1] }, 3), data);
    assert.deepEqual(dim(r, "tech").counts, [0, 1, 1, 0, 2, 1]);
  });
});

/* ---------- 短板题（每维度最低分的 1–2 题） ---------- */

describe("weakestQuestions：建议提取", () => {
  const items = (scores) => scores.map((s, i) => ({ q: { id: "q" + i, no: "" + i, advice: "a" + i }, score: s }));

  test("只取最低分的题；并列最低分最多给 2 道，按题库顺序", () => {
    assert.deepEqual(core.weakestQuestions(items([3, 2, 2, 4, 5])).map((it) => it.q.id), ["q1", "q2"]);
    assert.deepEqual(core.weakestQuestions(items([1, 3, 3, 3, 3])).map((it) => it.q.id), ["q0"]);
    assert.deepEqual(core.weakestQuestions(items([2, 3, 2, 3, 2])).map((it) => it.q.id), ["q0", "q2"]);
  });

  test("三道并列最低分也只给 2 道", () => {
    assert.equal(core.weakestQuestions(items([1, 1, 1, 5, 5])).length, 2);
  });

  test("全部满分（5 分）返回空：没有短板", () => {
    assert.deepEqual(core.weakestQuestions(items([5, 5, 5, 5, 5])), []);
  });

  test("空输入 / 全无效作答返回空", () => {
    assert.deepEqual(core.weakestQuestions([]), []);
    assert.deepEqual(core.weakestQuestions([{ q: {}, score: null }, { q: {}, score: 0 }]), []);
    assert.deepEqual(core.weakestQuestions(null), []);
  });

  test("evaluate 里的 weakest 与独立函数一致", () => {
    const r = core.evaluate(answersByDim({ org: [4, 2, 2, 3, 5] }, 4), data);
    assert.deepEqual(dim(r, "org").weakest.map((it) => it.q.id), ["o2", "o3"]);
  });
});

/* ---------- 总评估 ---------- */

describe("evaluate：总分、完整性与分档", () => {
  test("空作答：answered 0、不完整、总分 0、无档位", () => {
    const r = core.evaluate({}, data);
    assert.equal(r.answered, 0);
    assert.equal(r.complete, false);
    assert.equal(r.total, 0);
    assert.equal(r.questionCount, 30);
    assert.equal(r.overall, null);
    r.dimensions.forEach((d) => assert.equal(d.score, 0));
  });

  test("部分作答：不完整就不给档位，总分只算已答题", () => {
    const answers = answersByDim({ strategy: [4, 4, 4, 4, 4], governance: [5, 5, 5, 5, 5] }, null);
    const r = core.evaluate(answers, data);
    assert.equal(r.answered, 10);
    assert.equal(r.total, 45);
    assert.equal(r.complete, false);
    assert.equal(r.overall, null);
  });

  test("全部 1 分：总分 30，观望期，距下一档 25 分", () => {
    const r = core.evaluate(all(1), data);
    assert.equal(r.total, 30);
    assert.equal(r.complete, true);
    assert.equal(r.overall.level, 1);
    assert.equal(r.overall.name, "观望期");
    assert.equal(r.overall.next.min, 55);
    assert.equal(r.overall.gapToNext, 25);
  });

  test("全部 5 分：总分 150，体系期，没有下一档", () => {
    const r = core.evaluate(all(5), data);
    assert.equal(r.total, 150);
    assert.equal(r.overall.level, 5);
    assert.equal(r.overall.name, "体系期");
    assert.equal(r.overall.next, null);
    assert.equal(r.overall.gapToNext, 0);
    r.dimensions.forEach((d) => assert.deepEqual(d.weakest, []));
  });

  test("八个边界总分：evaluate 的档位与 gradeFor 一致（54/55/79/80/104/105/129/130）", () => {
    for (const t of [54, 55, 79, 80, 104, 105, 129, 130]) {
      const r = core.evaluate(answersWithTotal(t), data);
      assert.equal(r.complete, true, "total=" + t);
      assert.equal(r.total, t, "total=" + t);
      assert.equal(r.overall.level, core.gradeFor(t), "total=" + t);
      assert.equal(r.overall.name, core.levelName(core.gradeFor(t)), "total=" + t);
    }
  });

  test("非法取值（0、6、字符串）不计入总分，视为未答", () => {
    const answers = Object.assign(all(4), { s1: 0, s2: 6, s3: "4" });
    const r = core.evaluate(answers, data);
    assert.equal(r.answered, 27);
    assert.equal(r.complete, false);
    assert.equal(dim(r, "strategy").score, 8);
  });

  test("六维分数互不串位：只动一维，别的维度不受影响", () => {
    const answers = answersByDim({ process: [5, 5, 5, 5, 5], org: [1, 1, 1, 1, 1] }, 3);
    const r = core.evaluate(answers, data);
    assert.equal(dim(r, "process").score, 25);
    assert.equal(dim(r, "org").score, 5);
    assert.equal(dim(r, "strategy").score, 15);
    assert.equal(dim(r, "governance").score, 15);
    assert.equal(r.total, 90);
  });
});

/* ---------- 文本生成 ---------- */

describe("buildSummary：结论摘要", () => {
  test("完整作答：总分、档位、诊断、建议动作、六维得分、短板、复测提示、免责都在", () => {
    const r = core.evaluate(answersWithTotal(92), data);
    const text = core.buildSummary(r, data, { date: "2026-11-28" });
    const lines = text.split("\n");
    assert.ok(lines[0].includes("AI Agent 落地评估自测"));
    assert.ok(text.includes("评估日期：2026-11-28"));
    assert.ok(text.includes("总分：92 / 150"));
    assert.ok(text.includes("档位：" + r.overall.name));
    assert.ok(text.includes("诊断：" + r.overall.diagnosis));
    assert.ok(text.includes("建议动作：" + r.overall.action));
    assert.ok(text.includes("距下一档"));
    assert.ok(text.includes("六个维度得分"));
    assert.ok(text.includes("- 战略与价值："));
    assert.ok(text.includes("各维度短板与建议"));
    assert.ok(text.includes("复测"));
    assert.ok(text.includes("非官方"));
  });

  test("完整作答且全部满分：短板区写明没有短板", () => {
    const r = core.evaluate(all(5), data);
    const text = core.buildSummary(r, data, {});
    assert.ok(text.includes("没有短板题"));
    assert.ok(!text.includes("评估日期："));
  });

  test("未答完：给进度而不是结论", () => {
    const r = core.evaluate(all(4), data);
    const text = core.buildSummary(r, data, {});
    assert.ok(text.includes("总分：120 / 150")); // 答完的走结论分支
    const partial = core.evaluate(Object.assign({}, all(4), { s1: undefined }), data);
    const partialText = core.buildSummary(partial, data, {});
    assert.ok(partialText.includes("还有 1 道题没答"));
    assert.ok(partialText.includes("已答 29 / 30 题"));
    assert.ok(!partialText.includes("档位："));
  });
});

/* ---------- 工具函数 ---------- */

describe("formatDate / optionLabel", () => {
  test("时间戳转本地日期 YYYY-MM-DD", () => {
    assert.equal(core.formatDate(new Date(2026, 10, 28, 9, 5)), "2026-11-28");
    assert.equal(core.formatDate(new Date(2026, 0, 3)), "2026-01-03");
    assert.match(core.formatDate(1764288000000), /^\d{4}-\d{2}-\d{2}$/); // 具体值依赖时区，只验证格式
    assert.equal(core.formatDate(null), "");
    assert.equal(core.formatDate(undefined), "");
    assert.equal(core.formatDate(""), "");
    assert.equal(core.formatDate("not-a-date"), "");
  });

  test("optionLabel：分值 → 量表含义；非法分值 → 空串", () => {
    assert.equal(core.optionLabel(data, 3), "试点中 / 部分具备");
    assert.equal(core.optionLabel(data, 5), "体系化 / 可复制推广");
    assert.equal(core.optionLabel(data, 0), "");
    assert.equal(core.optionLabel(data, null), "");
  });
});

/* ---------- 内联安全 ---------- */

describe("内联进页面时的安全", () => {
  /* 构建会把 core.js、data.js、app.js 原样放进 HTML 的 script 元素里。
     HTML 解析器不管 JavaScript 的字符串和注释：只要看到脚本结束标签的开头就认为脚本结束了，
     后面的代码会变成页面上的文字，整个应用失效。 */
  test("三个脚本里都没有会让浏览器提前结束脚本的序列", () => {
    for (const name of ["core.js", "data.js", "app.js"]) {
      const source = fs.readFileSync(path.join(here, "..", name), "utf8");
      assert.equal(/<\/script/i.test(source), false, name + " 里出现了脚本结束标签");
      assert.equal(/<!--/.test(source), false, name + " 里出现了 HTML 注释开头");
    }
  });

  test("样式表里没有结束 style 元素的序列", () => {
    const source = fs.readFileSync(path.join(here, "..", "styles.css"), "utf8");
    assert.equal(/<\/style/i.test(source), false);
  });
});

/* ---------- index.html 的骨架约定 ---------- */

describe("index.html", () => {
  const html = fs.readFileSync(path.join(here, "..", "index.html"), "utf8");

  test("data-app 与占位引用写法与其他应用一致", () => {
    assert.ok(html.includes('data-app="ai-agent-readiness"'));
    assert.ok(html.includes('<!--@favicon-->'));
    assert.ok(html.includes('<!--@include ../../design/icons.html-->'));
    assert.ok(html.includes('<!--@include ../../design/brand/logos.html-->'));
    assert.ok(html.includes('<link rel="stylesheet" href="../../design/tokens.css">'));
    assert.ok(html.includes('<link rel="stylesheet" href="../../design/base.css">'));
    assert.ok(html.includes('<link rel="stylesheet" href="../../design/components.css">'));
    assert.ok(html.includes('<link rel="stylesheet" href="styles.css">'));
    assert.ok(html.includes('<script src="../../design/shared.js"></script>'));
    assert.ok(html.includes('<script src="data.js"></script>'));
    assert.ok(html.includes('<script src="core.js"></script>'));
    assert.ok(html.includes('<script src="app.js"></script>'));
    assert.ok(html.includes('use href="#logo-ai-agent-readiness"'));
  });

  test("四个视图齐全，报告默认隐藏", () => {
    for (const view of ["start", "survey", "report", "method"]) {
      assert.ok(html.includes(`data-view-panel="${view}"`), view);
    }
    assert.ok(/data-view-panel="report"[^>]*hidden/.test(html), "报告视图应默认 hidden");
    assert.ok(html.includes('data-theme-toggle'), "要有主题切换按钮");
    assert.ok(html.includes('data-toolbox'), "要有工具箱互链容器");
    assert.ok(html.includes('data-maker'), "要有作者署名");
  });

  test("页面上没有 emoji", () => {
    const emoji = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u;
    assert.equal(emoji.test(html), false, "index.html 里出现了 emoji");
    for (const name of ["core.js", "data.js", "app.js"]) {
      const source = fs.readFileSync(path.join(here, "..", name), "utf8");
      assert.equal(emoji.test(source), false, name + " 里出现了 emoji");
    }
  });
});
