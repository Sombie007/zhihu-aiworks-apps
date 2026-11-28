/* 核心逻辑单元测试：node --test apps/digital-maturity/ */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const core = require("../core.js");
const data = require("../data.js");

/* ---------- 造作答的工具 ---------- */

/** 按维度给分：{ base: [4,4,2,1,2,3], ... }，没给出的维度用 fallback。注意 0（不适用）是合法取值，不能用 || 判断 */
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
const ids = (result, id) => dim(result, id).items.map((it) => it.q.id);

/* ---------- 题库 ---------- */

test("题库：四个维度共 20 题，每题 4 个等级选项、建议、盘点、沉淀", () => {
  assert.equal(data.dimensions.length, 4);
  assert.deepEqual(data.dimensions.map((d) => d.questions.length), [6, 5, 5, 4]);
  assert.equal(data.dimensions.reduce((n, d) => n + d.questions.length, 0), 20);
  const seen = new Set();
  data.dimensions.forEach((d, di) => {
    d.questions.forEach((q, qi) => {
      assert.ok(!seen.has(q.id), "题目 id 重复：" + q.id);
      seen.add(q.id);
      assert.equal(q.no, `${di + 1}.${qi + 1}`);
      assert.equal(q.options.length, 4, q.no + " 选项数");
      q.options.forEach((o) => assert.ok(typeof o === "string" && o.length > 0, q.no + " 选项为空"));
      ["title", "advice", "inventory", "settle"].forEach((k) => assert.ok(q[k], `${q.no} 缺少 ${k}`));
    });
  });
  assert.equal(data.levels.length, 4);
  data.levels.forEach((l, i) => assert.equal(l.level, i + 1));
  assert.ok(data.disclaimer.includes("非官方的自评工具"));
  assert.ok(data.disclaimer.includes("zjtx.miit.gov.cn"));
});

/* ---------- 75% 规则 ---------- */

test("requiredCount：各题数下达到某等级至少需要的题数", () => {
  const expected = { 1: 1, 2: 2, 3: 3, 4: 3, 5: 4, 6: 5, 7: 6, 8: 6, 9: 7, 10: 8, 11: 9, 12: 9, 20: 15 };
  Object.keys(expected).forEach((n) => assert.equal(core.requiredCount(Number(n)), expected[n], "n=" + n));
});

test("dimensionLevel：边界——4 题里 3 题为 4、1 题为 1，恰好 75%，达到四级", () => {
  assert.equal(core.dimensionLevel([4, 4, 4, 1]), 4);
});

test("dimensionLevel：边界——4 题里只有 2 题为 4，50% 不足 75%，不是四级", () => {
  assert.equal(core.dimensionLevel([4, 4, 1, 1]), 1);
  assert.equal(core.dimensionLevel([4, 4, 3, 3]), 3);
});

test("dimensionLevel：取满足条件的最高等级", () => {
  assert.equal(core.dimensionLevel([4, 4, 3, 3, 2]), 3); // ≥3 的占 80%，≥4 的只占 40%
  assert.equal(core.dimensionLevel([4, 3, 3, 2]), 3);     // 4 题里 3 题达到三级
  assert.equal(core.dimensionLevel([3, 3, 3, 2, 2]), 2);  // ≥3 的占 60%
  assert.equal(core.dimensionLevel([2, 2, 2, 2, 2, 2]), 2);
  assert.equal(core.dimensionLevel([4, 4, 4, 4, 4, 1]), 4); // 6 题里 5 题，83%
  assert.equal(core.dimensionLevel([4, 4, 4, 4, 1, 1]), 1); // 6 题里 4 题，67%：低于 2 分的占到 1/3
});

test("dimensionLevel：全部为 1 / 全部为 4 / 空输入", () => {
  assert.equal(core.dimensionLevel([1, 1, 1, 1, 1]), 1);
  assert.equal(core.dimensionLevel([4, 4, 4, 4, 4]), 4);
  assert.equal(core.dimensionLevel([]), null);
  assert.equal(core.dimensionLevel(null), null);
});

test("dimensionLevel：“不适用”（0）被排除", () => {
  assert.equal(core.dimensionLevel([4, 4, 4, 0, 1]), 4);
  assert.equal(core.dimensionLevel([0, 0, 0]), null);
  assert.equal(core.dimensionLevel([4, 0, 0, 1, 1]), 1); // 有效 3 题：2 题为 1
});

/* ---------- 整份评估 ---------- */

test("全部选 1：四个维度和综合等级都是一级", () => {
  const r = core.evaluate(all(1), data);
  assert.equal(r.complete, true);
  assert.equal(r.answered, 20);
  r.dimensions.forEach((d) => {
    assert.equal(d.level, 1, d.name);
    assert.equal(d.next.level, 2);
    assert.equal(d.next.needRaise, core.requiredCount(d.validCount));
    assert.equal(d.gap.length, d.validCount, d.name + " 所有题都要补");
  });
  assert.equal(r.overall.level, 1);
  assert.deepEqual(r.overall.bottleneckIds, ["base", "operation", "management", "performance"]);
  assert.deepEqual(r.overall.aboveIds, []);
});

test("全部选 4：四个维度和综合等级都是四级，没有要补的题", () => {
  const r = core.evaluate(all(4), data);
  r.dimensions.forEach((d) => {
    assert.equal(d.level, 4, d.name);
    assert.equal(d.next, null);
    assert.deepEqual(d.gap, []);
  });
  assert.equal(r.overall.level, 4);
  assert.deepEqual(r.overall.bottleneckIds, ["base", "operation", "management", "performance"]);
  assert.deepEqual(r.overall.excludedIds, []);
  assert.equal(r.priority.length, 3);
});

test("75% 规则在真实题库上生效：成效维度 4 题，3 题为 4 即四级；2 题为 4 则是一级", () => {
  const a = answersByDim({ performance: [4, 4, 4, 1] }, 3);
  assert.equal(dim(core.evaluate(a, data), "performance").level, 4);
  const b = answersByDim({ performance: [4, 4, 1, 1] }, 3);
  assert.equal(dim(core.evaluate(b, data), "performance").level, 1);
});

test("综合等级取最低的维度，不用平均分", () => {
  const r = core.evaluate(answersByDim({
    base: [3, 3, 3, 3, 3, 2],        // 三级（5/6 达到三级）
    operation: [4, 4, 4, 4, 2],      // 四级（4/5 达到四级）
    management: [2, 2, 2, 3, 4],     // 二级
    performance: [4, 4, 4, 4]
  }), data);
  assert.deepEqual(r.dimensions.map((d) => d.level), [3, 4, 2, 4]);
  assert.equal(r.overall.level, 2);
  assert.deepEqual(r.overall.bottleneckIds, ["management"]);
  assert.deepEqual(r.overall.aboveIds, ["base", "operation", "performance"]);
  assert.deepEqual(r.overall.excludedIds, []);
});

test("多个维度并列最低时，都算卡点", () => {
  const r = core.evaluate(answersByDim({
    base: [2, 2, 2, 2, 2, 2],
    operation: [3, 3, 3, 3, 3],
    management: [2, 2, 2, 2, 4],
    performance: [3, 3, 3, 3]
  }), data);
  assert.equal(r.overall.level, 2);
  assert.deepEqual(r.overall.bottleneckIds, ["base", "management"]);
  assert.deepEqual(r.overall.aboveIds, ["operation", "performance"]);
});

test("未答完：complete 为 false，已答数正确，未答的题不计入", () => {
  const a = all(3);
  delete a.plan; delete a.rd; delete a.cost;
  const r = core.evaluate(a, data);
  assert.equal(r.complete, false);
  assert.equal(r.answered, 17);
  assert.equal(r.total, 20);
  assert.equal(dim(r, "base").unanswered, 1);
  assert.equal(dim(r, "base").validCount, 5);
});

test("非法作答被忽略：未知题目 id、越界或非整数的值", () => {
  const a = all(2);
  a.unknown = 3; a.plan = 9; a.rd = 2.5; a.cost = "4"; a.quality = -1;
  const r = core.evaluate(a, data);
  assert.equal(r.answered, 16, "plan、rd、cost、quality 四道因取值非法视为未答");
  assert.equal(r.answers.unknown, undefined);
  assert.equal(r.answers.plan, undefined);
  assert.equal(r.answers.cost, undefined);
  assert.equal(dim(r, "base").unanswered, 1);
  assert.equal(dim(r, "performance").unanswered, 2);
});

/* ---------- 不适用 ---------- */

test("某维度全部选“不适用”：该维度无等级，不拖低综合等级", () => {
  const r = core.evaluate(answersByDim({
    base: 3, operation: 0, management: 2, performance: 4
  }), data);
  const op = dim(r, "operation");
  assert.equal(op.level, null);
  assert.equal(op.allNA, true);
  assert.equal(op.validCount, 0);
  assert.equal(op.naCount, 5);
  assert.equal(op.next, null);
  assert.deepEqual(op.gap, []);
  assert.ok(r.overall.excludedIds.includes("operation"));
  assert.equal(r.overall.level, 2, "取其余三个维度里最低的");
  assert.deepEqual(r.overall.bottleneckIds, ["management"]);
  assert.equal(r.complete, true);
});

test("维度里的“不适用”只缩小分母：5 题里 1 题不适用，剩下 4 题里 3 题为 4 即四级", () => {
  const r = core.evaluate(answersByDim({ operation: [4, 4, 4, 0, 1] }, 3), data);
  const op = dim(r, "operation");
  assert.equal(op.validCount, 4);
  assert.equal(op.naCount, 1);
  assert.equal(op.required, 3);
  assert.equal(op.level, 4);
});

test("二十道题全部选“不适用”：没有综合等级", () => {
  const r = core.evaluate(all(0), data);
  assert.equal(r.complete, true);
  assert.equal(r.overall.level, null);
  assert.equal(r.overall.levelName, "");
  assert.deepEqual(r.overall.excludedIds, ["base", "operation", "management", "performance"]);
  assert.deepEqual(r.priority, []);
  assert.ok(r.dimensions.every((d) => d.allNA));
  const why = core.buildWhy(r, data).join("");
  assert.ok(why.includes("没有可以判定等级的维度"));
  const summary = core.buildSummary(r, data, {});
  assert.ok(summary.includes("综合等级：无法判定"));
});

/* ---------- 距下一等级 ---------- */

test("距下一等级：列出得分不高于当前等级的题，并算出至少要提升几道", () => {
  // 基础维度 6 题：4、4、2、1、2、3 → 达到三级及以上 3 题，需要 5 题 → 二级
  const r = core.evaluate(answersByDim({ base: [4, 4, 2, 1, 2, 3] }, 4), data);
  const base = dim(r, "base");
  assert.equal(base.level, 2);
  assert.equal(base.next.level, 3);
  assert.equal(base.next.required, 5);
  assert.equal(base.next.have, 3);
  assert.equal(base.next.needRaise, 2);
  assert.equal(base.next.candidates, 3);
  assert.deepEqual(base.gap, ["systems", "capture", "people"], "得分最低的在前，同分按题号");
  // 只把 systems、capture 提到三级，就正好 5/6 达到三级
  assert.equal(core.dimensionLevel([4, 4, 3, 3, 2, 3]), 3);
  // 只提一道不够
  assert.equal(core.dimensionLevel([4, 4, 2, 3, 2, 3]), 2);
});

test("距下一等级：候选题数可以多于必须提升的题数", () => {
  // 2、2、2、4、4 → 二级；三级需要 4 题，现有 2 题；得分不高于二级的候选有 3 题
  const r = core.evaluate(answersByDim({ operation: [2, 2, 2, 4, 4] }, 4), data);
  const op = dim(r, "operation");
  assert.equal(op.level, 2);
  assert.equal(op.next.needRaise, 2);
  assert.equal(op.next.candidates, 3);
  assert.deepEqual(op.gap, ["rd", "delivery", "sales"]);
});

test("距下一等级：“不适用”的题不会出现在待补列表里", () => {
  const r = core.evaluate(answersByDim({ management: [2, 2, 0, 4, 2] }, 4), data);
  const mg = dim(r, "management");
  assert.equal(mg.validCount, 4);
  assert.equal(mg.required, 3);
  assert.equal(mg.level, 2);
  assert.equal(mg.next.have, 1);
  assert.equal(mg.next.needRaise, 2);
  assert.deepEqual(mg.gap, ["finance", "approval", "decision"], "选了不适用的 collab 不在列表里");
});

test("距下一等级：四级和“不适用”维度没有下一等级", () => {
  const r = core.evaluate(answersByDim({ base: 4, operation: 0 }, 3), data);
  assert.equal(dim(r, "base").next, null);
  assert.equal(dim(r, "operation").next, null);
});

test("toNextLevel：直接调用", () => {
  assert.deepEqual(core.toNextLevel([2, 2, 2, 4, 4], 2), { level: 3, required: 4, have: 2, needRaise: 2, candidates: 3 });
  assert.equal(core.toNextLevel([4, 4, 4, 4], 4), null);
  assert.equal(core.toNextLevel([], null), null);
});

/* ---------- 优先补的 3 道题 ---------- */

test("优先补的题：取全部题目里得分最低的 3 道，同分同维度等级时按题库顺序", () => {
  const r = core.evaluate(answersByDim({
    base: [3, 3, 3, 3, 3, 1],      // 三级，security 得 1
    operation: [3, 3, 3, 3, 2],    // 三级，service 得 2
    management: [4, 4, 4, 4, 4],
    performance: [3, 3, 3, 3]
  }), data);
  // 最低是 security（1），其次 service（2）；再往后全是 3 分、维度等级也都是三级，按题库顺序取 base 的第一道
  assert.deepEqual(r.priorityIds, ["security", "service", "plan"]);
  assert.deepEqual(r.priority.map((p) => p.score), [1, 2, 3]);
  assert.equal(r.priority[0].dim.id, "base");
  assert.equal(r.priority[0].q.no, "1.6");
});

test("优先补的题：并列时优先取最低等级维度里的", () => {
  // base 二级、operation 三级，各有一道 1 分题 → 先取 base 的
  const r = core.evaluate(answersByDim({
    base: [1, 2, 4, 4, 4, 4],
    operation: [3, 3, 3, 3, 1],
    management: [3, 3, 3, 3, 3],
    performance: [3, 3, 3, 3]
  }), data);
  assert.deepEqual(r.dimensions.map((d) => d.level), [2, 3, 3, 3]);
  assert.deepEqual(r.priorityIds, ["plan", "service", "network"]);

  // 把 1 分题换到等级更低的维度里，顺序跟着变
  const s = core.evaluate(answersByDim({
    base: [3, 3, 3, 3, 3, 1],
    operation: [1, 1, 3, 3, 3],    // 3/5 达到三级不够 75%，2/5 达到二级也不够 → 一级
    management: [3, 3, 3, 3, 3],
    performance: [3, 3, 3, 3]
  }), data);
  assert.deepEqual(s.dimensions.map((d) => d.level), [3, 1, 3, 3]);
  assert.deepEqual(s.priorityIds, ["rd", "delivery", "security"]);
});

test("优先补的题：全部同分时按维度、题号的顺序取前三道", () => {
  assert.deepEqual(core.evaluate(all(2), data).priorityIds, ["plan", "network", "capture"]);
  assert.deepEqual(core.evaluate(all(4), data).priorityIds, ["plan", "network", "capture"]);
  assert.deepEqual(core.priorityQuestions(all(1), data).map((p) => p.q.no), ["1.1", "1.2", "1.3"]);
});

test("优先补的题：有效作答不足 3 道时有多少给多少，“不适用”不参与", () => {
  const r = core.evaluate(answersByDim({ base: [3, 2, 0, 0, 0, 0] }, 0), data);
  assert.equal(r.complete, true);
  assert.deepEqual(r.priorityIds, ["network", "plan"]);
  assert.deepEqual(r.priority.map((p) => p.score), [2, 3]);
});

/* ---------- 文本生成 ---------- */

test("为什么是这个等级：点名卡点维度和各自还差几道题", () => {
  const r = core.evaluate(answersByDim({
    base: [4, 4, 2, 1, 2, 3],        // 二级，再提升 2 道可到三级
    operation: [3, 3, 3, 3, 3],      // 三级
    management: [2, 2, 2, 2, 4],     // 二级，再提升 3 道可到三级
    performance: [3, 3, 3, 3]        // 三级
  }), data);
  assert.equal(r.overall.level, 2);
  const why = core.buildWhy(r, data);
  assert.equal(why.length, 3);
  assert.ok(why[0].includes("「数字化基础」「数字化管理」这 2 个维度停在二级"));
  assert.ok(why[0].includes("把整体定在了二级"));
  assert.ok(why[1].includes("「数字化基础」再提升 2 道题可达到三级；「数字化管理」再提升 3 道题可达到三级"));
  assert.ok(why[1].includes("这几个维度都升上去，综合等级才会跟着到三级"));
  assert.equal(why[2], "「数字化经营」「数字化成效」已达到三级，暂时不拖后腿。");
});

test("为什么是这个等级：只有一个卡点时说明它升上去整体就升", () => {
  const r = core.evaluate(answersByDim({ base: 3, operation: 4, management: 2, performance: 3 }, 3), data);
  assert.equal(r.overall.level, 2);
  const why = core.buildWhy(r, data);
  assert.equal(why.length, 3);
  assert.equal(why[0], "综合等级取四个维度中最低的一级。「数字化管理」停在二级，把整体定在了二级。");
  assert.equal(why[1], "「数字化管理」再提升 4 道题可达到三级。它升上去，综合等级就会跟着到三级。");
  assert.equal(why[2], "「数字化基础」「数字化经营」「数字化成效」已达到三级及以上，暂时不拖后腿。");
});

test("为什么是这个等级：四个维度同级、四级、含未计入维度", () => {
  const same = core.buildWhy(core.evaluate(all(2), data), data);
  assert.ok(same[0].startsWith("四个维度都停在二级"));
  assert.ok(same[1].includes("再提升 " + core.requiredCount(6) + " 道题可达到三级；"));
  assert.ok(same[1].endsWith("四个维度都达到三级，综合等级才会变成三级。"));

  const top = core.buildWhy(core.evaluate(all(4), data), data);
  assert.deepEqual(top, ["四个维度都已达到四级，这是本工具的最高等级，没有卡点。"]);

  const mixed = core.buildWhy(core.evaluate(answersByDim({ operation: 0, management: 2 }, 4), data), data);
  assert.equal(mixed.length, 4);
  assert.equal(mixed[0], "综合等级取四个维度中最低的一级。「数字化管理」停在二级，把整体定在了二级。");
  assert.equal(mixed[2], "「数字化基础」「数字化成效」已达到四级，暂时不拖后腿。");
  assert.equal(mixed[3], "「数字化经营」全部选了「不适用」，无有效作答，未计入综合等级。");

  const topWithNA = core.buildWhy(core.evaluate(answersByDim({ operation: 0 }, 4), data), data);
  assert.equal(topWithNA[0], "已作答的 3 个维度都已达到四级，这是本工具的最高等级，没有卡点。");
});

test("结论摘要：包含综合等级、四个维度等级、三道优先补的题", () => {
  const r = core.evaluate(answersByDim({
    base: [1, 2, 4, 4, 4, 4],
    operation: [3, 3, 3, 3, 1],
    management: [2, 2, 3, 4, 4],
    performance: [3, 3, 3, 3]
  }), data);
  const text = core.buildSummary(r, data, { date: "2026-11-28", profileLine: "制造业 · 50–300 人" });
  const lines = text.split("\n");
  assert.equal(lines[0], "数字化成熟度自评 · 结论摘要");
  assert.equal(lines[1], "评估日期：2026-11-28");
  assert.equal(lines[2], "企业信息：制造业 · 50–300 人");
  assert.equal(lines[3], "综合等级：二级");
  assert.equal(lines[4], "判读：" + data.levels[1].verdict);
  assert.equal(lines[5], "维度等级：数字化基础 二级；数字化经营 三级；数字化管理 二级；数字化成效 三级");
  assert.equal(lines[6], "优先补的 3 道题：");
  assert.equal(lines[7], "1. 1.1 规划与负责人（数字化基础，当前一级）—— " + data.dimensions[0].questions[0].advice);
  assert.equal(lines[8], "2. 2.5 客户服务（数字化经营，当前一级）—— " + data.dimensions[1].questions[4].advice);
  assert.equal(lines[9], "3. 1.2 网络与设备（数字化基础，当前二级）—— " + data.dimensions[0].questions[1].advice);
  assert.equal(lines[10], "说明：非官方自评，结果不构成官方评测结论。");
  assert.equal(lines.length, 11);
  assert.ok(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u.test(text), "不含 emoji");
  assert.ok(!/[\u4e00-\u9fff][,.:;?!]/.test(text), "中文后面不用半角标点");
});

test("结论摘要：没填企业信息、四级、不足 3 道、无法判定", () => {
  const plain = core.buildSummary(core.evaluate(all(3), data), data, {});
  assert.equal(plain.split("\n")[1], "企业信息：未填写企业信息");

  const top = core.buildSummary(core.evaluate(all(4), data), data, { date: "2026-11-28" });
  assert.ok(top.includes("综合等级：四级"));
  assert.ok(top.includes("得分相对最低的 3 道题（可继续优化）："));

  const few = core.buildSummary(core.evaluate(answersByDim({ base: [3, 2, 0, 0, 0, 0] }, 0), data), data, {});
  assert.ok(few.includes("优先补的 2 道题："));
  assert.ok(few.includes("数字化经营 未计入（无有效作答）"));

  const none = core.buildSummary(core.evaluate(all(0), data), data, {});
  assert.ok(none.includes("优先补的题：无"));
});

test("企业信息一行：两个都填、只填一个、都没填、填了未知值", () => {
  assert.equal(core.profileLine({ industry: "manufacturing", size: "50-300" }, data), "制造业 · 50–300 人");
  assert.equal(core.profileLine({ industry: "trade" }, data), "批发零售 · 规模未填写");
  assert.equal(core.profileLine({ size: "over-300" }, data), "行业未填写 · 300 人以上");
  assert.equal(core.profileLine({}, data), "未填写企业信息");
  assert.equal(core.profileLine(null, data), "未填写企业信息");
  assert.equal(core.profileLine({ industry: "nope", size: "nope" }, data), "未填写企业信息");
});

test("formatDate：按本地时间输出 YYYY-MM-DD", () => {
  assert.equal(core.formatDate(new Date(2026, 10, 28, 23, 59).getTime()), "2026-11-28");
  assert.equal(core.formatDate(new Date(2026, 0, 5).getTime()), "2026-01-05");
  assert.equal(core.formatDate(new Date(2026, 10, 28)), "2026-11-28");
  assert.equal(core.formatDate("not a date"), "");
  assert.equal(core.formatDate(undefined), "");
  assert.equal(core.formatDate(null), "", "null 不能变成 1970-01-01");
  assert.equal(core.formatDate(0), "1970-01-01", "0 是合法时间戳");
  assert.equal(core.formatDate(""), "");
  assert.equal(core.formatDate(NaN), "");
});

test("levelName / ordinal / isAnswer", () => {
  assert.deepEqual([1, 2, 3, 4].map(core.levelName), ["一级", "二级", "三级", "四级"]);
  assert.equal(core.levelName(null), "");
  assert.equal(core.levelName(0), "");
  assert.equal(core.levelName(5), "");
  assert.equal(core.ordinal(3), "三");
  assert.ok(core.isAnswer(0) && core.isAnswer(4));
  assert.ok(!core.isAnswer(5) && !core.isAnswer("3") && !core.isAnswer(null) && !core.isAnswer(1.5));
});

/* ---------- 随机对照：换一种写法逐项对拍 ---------- */

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 朴素实现：直接按“占比不低于 75%”的定义算，不碰 core 的整数比较 */
function naiveLevel(scores) {
  const valid = scores.filter((s) => s >= 1 && s <= 4);
  if (!valid.length) return null;
  let best = 1;
  for (let L = 1; L <= 4; L++) {
    const share = valid.filter((s) => s >= L).length / valid.length;
    if (share >= 0.75 - 1e-9) best = L;
  }
  return best;
}

test("随机对照：1500 组作答，等级、下一等级、优先补的题都与朴素实现一致", () => {
  const rand = mulberry32(20261128);
  const allQ = data.dimensions.flatMap((d) => d.questions.map((q) => q.id));
  let withNA = 0;
  let incomplete = 0;
  for (let round = 0; round < 1500; round++) {
    const answers = {};
    const mode = rand();
    allQ.forEach((id) => {
      const r = rand();
      if (mode < 0.15 && r < 0.25) return;                       // 留空不答
      answers[id] = r < 0.12 ? 0 : 1 + Math.floor(rand() * 4);   // 12% 选不适用
    });
    const r = core.evaluate(answers, data);
    const naiveOverall = [];

    r.dimensions.forEach((d) => {
      const scores = d.items.map((it) => it.score);
      const validScores = scores.filter((s) => s >= 1);
      const naive = naiveLevel(validScores);
      assert.equal(d.level, naive, d.name + " 等级 " + JSON.stringify(scores));
      assert.equal(d.validCount, validScores.length);
      assert.equal(d.naCount, scores.filter((s) => s === 0).length);
      if (naive == null) {
        assert.equal(d.next, null);
        assert.deepEqual(d.gap, []);
        return;
      }
      naiveOverall.push(naive);
      if (naive === 4) {
        assert.equal(d.next, null);
        assert.deepEqual(d.gap, []);
        return;
      }
      // 待补列表 = 得分不高于当前等级的题，按分数、题号排序
      const expectedGap = d.items
        .filter((it) => it.score >= 1 && it.score <= naive)
        .sort((a, b) => a.score - b.score || a.qIndex - b.qIndex)
        .map((it) => it.q.id);
      assert.deepEqual(d.gap, expectedGap, d.name + " 待补列表");
      // 真的把题改掉再重算：提升 needRaise 道应当刚好够，少一道应当不够（每次用一份新的分数拷贝）
      const baseScores = d.items.map((it) => it.score);
      const posOf = Object.fromEntries(d.items.map((it, i) => [it.q.id, i]));
      const raise = (k) => {
        const scores = baseScores.slice();
        expectedGap.slice(0, k).forEach((id) => { scores[posOf[id]] = naive + 1; });
        return naiveLevel(scores);
      };
      assert.equal(d.next.needRaise, d.next.required - d.next.have);
      assert.equal(raise(d.next.needRaise), naive + 1, d.name + " 提升 needRaise 道应达到下一等级");
      assert.ok(d.next.needRaise > 0);
      assert.equal(raise(d.next.needRaise - 1), naive, d.name + " 少提升一道应仍停在原等级");
      assert.ok(d.next.needRaise <= expectedGap.length);
    });

    // 综合等级 = 有等级的维度里最低的
    assert.equal(r.overall.level, naiveOverall.length ? Math.min(...naiveOverall) : null);
    assert.deepEqual(r.overall.bottleneckIds, r.dimensions.filter((d) => d.level === r.overall.level).map((d) => d.id));

    // 优先补的题：分数 → 所在维度等级 → 题库顺序
    const expect = [];
    data.dimensions.forEach((d, di) => d.questions.forEach((q, qi) => {
      const s = answers[q.id];
      if (s >= 1) expect.push({ id: q.id, s, lv: r.dimensions[di].level, di, qi });
    }));
    expect.sort((a, b) => a.s - b.s || a.lv - b.lv || a.di - b.di || a.qi - b.qi);
    assert.deepEqual(r.priorityIds, expect.slice(0, 3).map((e) => e.id));

    if (r.answered < 20) incomplete++;
    if (r.dimensions.some((d) => d.naCount > 0)) withNA++;
  }
  assert.ok(incomplete > 100 && withNA > 100, "随机样本确实覆盖了未答完和含“不适用”的情况");
});
