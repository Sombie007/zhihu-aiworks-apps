/* 静态检查：规格文案一致性、质量线（零 emoji、无写死色值、图标有效、视图与 id 对应、如实表述）。
   运行：node --test "apps/digital-maturity/test/*.test.js" */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const APP = path.resolve(__dirname, "..");
const DESIGN = path.resolve(APP, "..", "..", "design");
const read = (file) => fs.readFileSync(file, "utf-8").replace(/\r\n/g, "\n");
const exists = (file) => fs.existsSync(file);

const data = require("../data.js");

const html = read(path.join(APP, "index.html"));
const css = read(path.join(APP, "styles.css"));
const app = read(path.join(APP, "app.js"));
const core = read(path.join(APP, "core.js"));
const dataSrc = read(path.join(APP, "data.js"));
const everything = { "index.html": html, "styles.css": css, "app.js": app, "core.js": core, "data.js": dataSrc };
const stripCssComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "");

const EMOJI = /\p{Extended_Pictographic}|\u{FE0F}|\u{1F1E6}-\u{1F1FF}/u;

/* ---------- 题库与规格逐字一致 ---------- */
const SPEC = path.join(DESIGN, "specs", "digital-maturity.md");
const hasSpec = exists(SPEC);
const spec = hasSpec ? read(SPEC) : "";

test("题库与规格逐字一致：20 道题的题目 id、题号、题名、4 个选项、建议", { skip: !hasSpec }, () => {
  const re = /^\*\*(\d+)\.(\d+) (.+?)\*\*（(?:id )?`([a-z]+)`）\n((?:\d\. .+\n){4})建议：(.+)$/gm;
  const found = [...spec.matchAll(re)];
  assert.equal(found.length, 20, "规格里应当能解析出 20 道题");
  const flat = data.dimensions.flatMap((d) => d.questions);
  assert.equal(flat.length, 20);
  found.forEach((m, i) => {
    const q = flat[i];
    assert.equal(q.id, m[4], "第 " + (i + 1) + " 道题的 id");
    assert.equal(q.no, m[1] + "." + m[2], q.id + " 题号");
    assert.equal(q.title, m[3], q.no + " 题名");
    const options = m[5].trimEnd().split("\n").map((line) => line.slice(3));
    assert.deepEqual(q.options, options, q.no + " 选项");
    assert.equal(q.advice, m[6], q.no + " 建议");
  });
  const dims = [...spec.matchAll(/^### 维度([一二三四])\u3000(数字化基础|数字化经营|数字化管理|数字化成效)/gm)];
  assert.equal(dims.length, 4);
  assert.deepEqual(dims.map((m) => m[2]), data.dimensions.map((d) => d.name), "维度名称与顺序");
  assert.deepEqual(dims.map((m) => m[1]), data.dimensions.map((d) => d.ordinal));
});

test("必须原文出现的说明、等级判读、评分规则、90 天开头说明、企业信息选项都与规格一致", { skip: !hasSpec }, () => {
  const disclaimer = spec.match(/^> (本工具为非官方的自评工具.+)$/m);
  assert.ok(disclaimer, "规格里应当有那段说明");
  assert.equal(data.disclaimer, disclaimer[1]);
  const verdicts = [...spec.matchAll(/^   - (一级|二级|三级|四级)：(.+)$/gm)];
  assert.equal(verdicts.length, 4);
  assert.deepEqual(data.levels.map((l) => l.name + "：" + l.verdict), verdicts.map((m) => m[1] + "：" + m[2]));
  const plain = spec.replace(/\*\*/g, "");
  data.rules.forEach((r) => assert.ok(plain.includes(r.text), "规则文案与规格不一致：" + r.text));
  assert.ok(spec.includes(data.plan.intro), "90 天行动建议的开头说明");
  assert.ok(spec.includes(data.profile.emptyLabel), "“未填写企业信息”");
  assert.deepEqual(data.profile.industries.map((x) => x.label), ["制造业", "批发零售", "建筑与工程", "信息服务", "生活服务", "其他"]);
  assert.deepEqual(data.profile.sizes.map((x) => x.label), ["50 人以下", "50–300 人", "300 人以上"]);
});

test("页面的标题、描述、侧栏页脚、应用 id、导航项与规格一致", { skip: !hasSpec }, () => {
  assert.ok(html.includes('<html lang="zh-CN" data-app="digital-maturity">'));
  assert.ok(html.includes("<title>数字化成熟度自评 — 定位企业数字化等级与短板 | 折向东 · 工具箱</title>"));
  assert.ok(html.includes('<meta name="description" content="对照数字化基础、经营、管理、成效四个维度二十道题，判断企业数字化所处等级，列出短板和下一步行动。本地计算，不保存数据。">'));
  assert.ok(html.includes("<span>v2.0 · 评估结果只在本机生成</span>"));
  assert.ok(html.includes('<use href="#logo-digital-maturity"/>'));
  const specNav = [...spec.matchAll(/^\| (开始评估|评估问卷|评估报告|方法说明) \| `i-[a-z-]+` \|/gm)].map((m) => m[1]);
  const pageNav = [...html.matchAll(/<button class="nav__item"[^>]*data-view="([a-z]+)"[\s\S]*?<span class="nav__item-text">([^<]+)<\/span>/g)];
  assert.deepEqual(pageNav.map((m) => m[1]), ["start", "survey", "report", "method"]);
  assert.deepEqual(pageNav.map((m) => m[2]), specNav, "导航项的文字和顺序");
});

/* ---------- 质量线 ---------- */

test("零 emoji：五个源文件里都没有", () => {
  Object.keys(everything).forEach((name) => {
    const m = everything[name].match(EMOJI);
    assert.equal(m, null, name + " 里出现了 emoji，附近文字：" + (m && everything[name].slice(Math.max(0, m.index - 20), m.index + 20)));
  });
});

test("styles.css 不写死颜色：没有十六进制、颜色函数、颜色名（含系统色）", () => {
  const code = stripCssComments(css);
  assert.equal(code.match(/#[0-9a-fA-F]{3,8}\b/g), null, "写死的十六进制颜色");
  // 任何颜色函数都是颜色字面量；color-mix( 例外，它的颜色参数只能是 var()
  const funcs = code.match(/(?<![\w-])(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/g);
  assert.equal(funcs, null, "写死的颜色函数：" + funcs);
  const NAMED = ("aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate coral " +
    "cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred " +
    "darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite " +
    "forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen " +
    "lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray " +
    "lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue " +
    "mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid " +
    "palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon " +
    "sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white " +
    "whitesmoke yellow yellowgreen " +
    "Canvas CanvasText LinkText VisitedText ActiveText ButtonFace ButtonBorder ButtonHighlight ButtonShadow AccentColor AccentColorText SelectedItem SelectedItemText " +
    "Field FieldText Highlight HighlightText Mark MarkText GrayText").trim().split(/\s+/);
  const named = code.match(new RegExp("(?<![\\w-$\"'])(" + NAMED.join("|") + ")(?![\\w-])", "g"));
  assert.equal(named, null, "写死的颜色名：" + named);
  // 至此文件里不存在任何颜色字面量：所有颜色只能来自 var(--…)、transparent、currentColor
  assert.ok((code.match(/var\(--[a-z0-9-]+\)/g) || []).length > 100, "应当大量引用 tokens 变量");
  // 派生色只用 color-mix(in oklch, var(--…) x%, var(--…)) 这种写法
  // 派生色只用 color-mix(in oklch, var(--…) x%, var(--…)) 这一种写法（三档热力图色阶）
  const calls = code.match(/color-mix\(/g) || [];
  const wellFormed = code.match(/color-mix\(in oklch, var\(--[a-z0-9-]+\) \d+%, var\(--[a-z0-9-]+\)\)/g) || [];
  assert.equal(calls.length, 3);
  assert.equal(wellFormed.length, calls.length, "每一处 color-mix 都必须是 in oklch + 两个 tokens 变量 + 百分比：" + calls.length + " 处调用，合规 " + wellFormed.length + " 处");
});

test("index.html 里没有内联样式，app.js 不往页面里写颜色", () => {
  assert.equal(/<[a-z-]+[^>]*\sstyle="/.test(html), false, "发现 style 属性");
  assert.equal(/style\.(color|background|backgroundColor|border|fill|stroke)\s*=/.test(app), false, "app.js 里不应直接设置颜色");
});

test("用到的图标都在 icons.html 里（只用一个图标库）", { skip: !exists(path.join(DESIGN, "icons.html")) }, () => {
  const icons = read(path.join(DESIGN, "icons.html"));
  const available = new Set([...icons.matchAll(/<symbol id="(i-[a-z0-9-]+)"/g)].map((m) => m[1]));
  const used = new Set([
    ...[...html.matchAll(/#(i-[a-z0-9-]+)/g)].map((m) => m[1]),
    ...[...app.matchAll(/icon\("([a-z0-9-]+)"/g)].map((m) => "i-" + m[1]),
  ]);
  assert.ok(used.size >= 10, "应当用到不少图标，实际：" + used.size);
  used.forEach((name) => assert.ok(available.has(name), "icons.html 里没有 #" + name));
  // 规格点名给「评估报告」的 i-presentation-chart-line 后来已补进图标库
  assert.equal(available.has("i-presentation-chart-line"), true);
  assert.ok(used.has("i-presentation-chart-line"));
  assert.ok(used.has("i-flag") && used.has("i-clipboard-document-list") && used.has("i-book-open"));
});

test("视图与导航一一对应，id 不重复，JS 引用的 id 都存在", () => {
  const views = [...html.matchAll(/data-view-panel="([a-z]+)"/g)].map((m) => m[1]);
  const navs = [...html.matchAll(/class="nav__item"[^>]*data-view="([a-z]+)"/g)].map((m) => m[1]);
  assert.deepEqual(views, ["start", "survey", "report", "method"]);
  assert.deepEqual(navs, views);
  assert.equal(new Set(views).size, views.length, "视图重复");
  assert.equal((html.match(/aria-current="page"/g) || []).length, 1, "静态页面里只有一个当前导航项");
  assert.ok(/data-view="start"[^>]*aria-current="page"/.test(html), "默认停在「开始评估」");
  const sections = [...html.matchAll(/<section class="view"[^>]*>/g)].map((m) => m[0]);
  assert.equal(sections.length, 4);
  assert.equal(sections.filter((s) => !/\bhidden\b/.test(s)).length, 1, "只有第一个视图不带 hidden");
  assert.ok(sections[0].includes('data-view-panel="start"'));

  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  const dup = ids.filter((v, i) => ids.indexOf(v) !== i);
  assert.deepEqual(dup, [], "id 重复");
  // JS 动态创建的 id
  const jsIds = new Set([
    ...[...app.matchAll(/\bid: "([a-zA-Z0-9_-]+)"/g)].map((m) => m[1]),
    ...[...app.matchAll(/"([a-z]+-[a-z]+)" \+ d\.id/g)].map((m) => m[1] + "-x"),
    "q-x", "q-x-h", "heat-readout",
  ]);
  const isDynamic = (id) => /^(q-[a-z]+|q-[a-z]+-h|dim-card-[a-z]+|gap-[a-z]+)$/.test(id);
  const known = (id) => ids.includes(id) || jsIds.has(id) || isDynamic(id);

  const referenced = [...new Set([...app.matchAll(/\$\("([a-zA-Z0-9_-]+)"\)/g)].map((m) => m[1]))];
  assert.deepEqual(referenced.filter((id) => !known(id)), [], "app.js 用 $(…) 引用了页面里不存在的 id");

  const labelled = [...html.matchAll(/aria-(?:labelledby|describedby)="([^"]+)"/g)].flatMap((m) => m[1].split(/\s+/));
  assert.deepEqual(labelled.filter((id) => !known(id)), [], "HTML 里 aria 指向了不存在的 id");
  const jsLabelled = [...app.matchAll(/aria-(?:labelledby|describedby)": "([^"]+)"/g)].flatMap((m) => m[1].split(/\s+/));
  const jsLabelledDynamic = [...app.matchAll(/"aria-labelledby": ("[^"]*" \+ [^,]+|"[^"]*")/g)].map((m) => m[1]);
  assert.ok(jsLabelledDynamic.length >= 3, "JS 里应当有 aria-labelledby");
  jsLabelled.filter((v) => !v.includes("+")).forEach((v) => assert.ok(known(v), "app.js 里 aria 指向了不存在的 id：" + v));

  const titles = app.match(/VIEW_TITLES = \{([^}]+)\}/)[1];
  views.forEach((v) => assert.ok(titles.includes(v + ":"), "缺少「" + v + "」的视图标题"));
  assert.deepEqual([...titles.matchAll(/"([^"]+)"/g)].map((m) => m[1]), ["开始评估", "评估问卷", "评估报告", "方法说明"]);
});

test("用到的类名都在 styles.css 或设计系统里有定义", { skip: !exists(path.join(DESIGN, "components.css")) }, () => {
  const design = read(path.join(DESIGN, "base.css")) + read(path.join(DESIGN, "components.css"));
  const defined = new Set([...stripCssComments(css + design).matchAll(/\.([A-Za-z_][A-Za-z0-9_-]*)/g)].map((m) => m[1]));
  const used = new Set();
  const add = (text) => text.split(/\s+/).forEach((c) => { if (c) used.add(c); });
  [...html.matchAll(/class="([^"]+)"/g)].forEach((m) => add(m[1]));
  [...app.matchAll(/class:\s*"([^"]*)"/g)].forEach((m) => add(m[1]));
  [...app.matchAll(/node\("[a-z0-9]+",\s*"([^"]*)"/g)].forEach((m) => add(m[1]));
  [...app.matchAll(/className = "([^"]*)"/g)].forEach((m) => add(m[1]));
  [...app.matchAll(/icon\("[a-z-]+",\s*"([^"]*)"/g)].forEach((m) => add(m[1]));
  [...app.matchAll(/classList\.(?:toggle|add)\("([^"]+)"/g)].forEach((m) => add(m[1]));
  // 字符串里拼接出来的类名片段（前缀 + "__key" 这类）
  [...app.matchAll(/"((?:[a-z]+(?:__[a-z0-9-]+|--[a-z0-9-]+))(?: [a-z0-9_-]+)*)"/g)].forEach((m) => add(m[1]));
  ["dist__key", "dist__swatch", "legend__key", "legend__swatch", "shade-1", "shade-2", "shade-3", "shade-4", "shade-na",
    "gap-item__text--quote", "heat__tile--na"].forEach((c) => used.add(c));
  // 被拼接的前缀和拼接后的后缀不是完整类名
  ["shade-", "__key", "__swatch", "ladder__step--", "gap-item__text--", "icon--"].forEach((c) => used.delete(c));
  const missing = [...used].filter((c) => !defined.has(c) && !/^(heat__col-label|ladder__(past|current))$/.test(c));
  assert.deepEqual(missing, [], "用到了没有定义的类");
});

test("按钮不写“确定 / 取消 / OK”这类含糊文字；破坏性操作的确认写明后果", () => {
  // 按钮文字 = 去掉按钮内部的图标等标签后的文本
  const labels = [...html.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)].map((m) => m[1].replace(/<[^>]+>/g, "").trim()).filter(Boolean);
  labels.forEach((l) => assert.ok(!/^(确定|取消|ok|yes|no|提交|确认)$/i.test(l), "含糊的按钮文字：" + l));
  assert.ok(labels.includes("保留作答") && labels.includes("重新评估") && labels.includes("复制结论摘要"));
  assert.ok(app.includes('"打印或另存 PDF"'), "工具栏里的「打印或另存 PDF」由 JS 设置");
  assert.ok(labels.includes("上一维度") && labels.includes("下一维度") && labels.includes("查看方法说明") && labels.includes("开始评估"));
  // JS 动态生成的主按钮文字同样不能含糊，而且应当就是下面这几个
  const dynamic = [...app.matchAll(/label: "([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(dynamic)], ["打印或另存 PDF", "生成报告", "下一维度", "去答剩下的 ", "开始评估", "继续上次评估", "查看评估报告"]);
  assert.ok(app.includes('label: "去答剩下的 " + left + " 题"'), "没答完时的主按钮要写明还剩几道题");
  // 任何字符串字面量都不能恰好是含糊词
  const vague = [...app.matchAll(/"((?:确定|取消|提交|确认|OK|ok|Yes|No))"/g)].map((m) => m[1]);
  assert.deepEqual(vague, [], "app.js 里有含糊的按钮文字");
  assert.equal(labels.includes("关闭对话框"), false, "纯图标按钮没有可见文字，名称来自 aria-label");
  // 页面上只有图标、没有文字的按钮（主题切换、关闭对话框）必须带 aria-label
  const iconOnly = [...html.matchAll(/<button[^>]*>[\s\S]*?<\/button>/g)]
    .filter((m) => m[0].includes("<svg") && !m[0].replace(/<[^>]+>/g, "").trim());
  assert.ok(iconOnly.length >= 2, "应当有纯图标按钮");
  iconOnly.forEach((m) => assert.match(m[0], /^<button[^>]*aria-label="[^"]+"/, "纯图标按钮必须带 aria-label：" + m[0].slice(0, 80)));
  iconOnly.forEach((m) => assert.match(m[0], /<svg[^>]*aria-hidden="true"/, "按钮里的图标要对读屏隐藏"));
  // 每个图标都对读屏隐藏
  [...html.matchAll(/<svg class="icon"[^>]*>/g)].forEach((m) => assert.ok(m[0].includes('aria-hidden="true"'), m[0]));
  assert.ok(app.includes('"清空 " + n + " 道题的作答？"'), "确认框标题要写明清空几道题");
  assert.ok(app.includes('"清空 " + n + " 道题的作答"'), "确认按钮要写明后果");
  assert.ok(app.includes("此操作无法撤销"), "确认框要说明无法撤销");
  // 每个动态生成的按钮文字都是“动词 + 对象”或规格给定的名字
  ["开始评估", "继续上次评估", "查看评估报告", "生成报告", "去答剩下的 ", "回到问卷修改", "填写企业信息", "打印或另存 PDF"].forEach((t) => assert.ok(app.includes(t), t));
});

test("中文文案不用半角标点", () => {
  const visible = { "index.html": html.replace(/<!--[\s\S]*?-->/g, ""), "data.js": dataSrc, "app.js": app, "core.js": core };
  Object.keys(visible).forEach((name) => {
    const src = visible[name];
    const bad = [...src.matchAll(/[\u4e00-\u9fff][,.:;?!]|[\u4e00-\u9fff]\(|\)[\u4e00-\u9fff]/g)];
    assert.deepEqual(bad.map((m) => src.slice(Math.max(0, m.index - 10), m.index + 6)), [], name + " 里有半角标点");
  });
});

test("如实表述：不出现权威背书、编造数字、自称身份", () => {
  const banned = ["依据国家标准", "基于国家标准", "国家标准 GB", "官方认证", "权威", "家企业", "咨询实战", "资深顾问", "作为顾问", "作为咨询顾问", "作为资深",
    "业内通用", "国内领先", "行业领先", "精准评估", "科学评估", "大量企业", "数万家", "上万家", "万家企业", "官方评测结果", "获得认证"];
  Object.keys(everything).forEach((name) => {
    banned.forEach((phrase) => {
      const at = everything[name].indexOf(phrase);
      assert.equal(at, -1, name + " 里出现了不该出现的说法：“" + phrase + "”");
    });
    const m = everything[name].match(/\d+\s*(万|多)?\s*(家|位|名)\s*(企业|客户|学员|用户|公司)/);
    assert.equal(m, null, name + " 里疑似编造的数字背书：" + (m && m[0]));
  });
  assert.ok(data.disclaimer.startsWith("本工具为非官方的自评工具"));
  // 两处都要渲染这段说明，且文字不能被改动
  assert.ok(app.includes('appendDisclaimer($("method-disclaimer"))'), "方法说明里要有这段话");
  assert.ok(app.includes('appendDisclaimer($("report-disclaimer"))'), "报告末尾要有这段话");
  const body = app.slice(app.indexOf("function appendDisclaimer(parent) {"), app.indexOf("function fillRules(list) {"));
  assert.ok(!/textContent\s*=/.test(body) && body.includes("D.disclaimer"), "渲染这段话时必须用原文");
  // “非官方”在开始页也点明
  assert.ok(html.includes("这是非官方的自评"));
});

test("公共资源引用的写法原样保留（构建脚本靠它们定位）", () => {
  [
    '<script src="../../design/theme-init.js"></script>',
    '<link rel="stylesheet" href="https://font.emtech.cc/css/MiSans/400">',
    '<link rel="stylesheet" href="https://font.emtech.cc/css/MiSans/600">',
    '<link rel="stylesheet" href="../../design/fonts.css">',
    '<link rel="stylesheet" href="../../design/tokens.css">',
    '<link rel="stylesheet" href="../../design/base.css">',
    '<link rel="stylesheet" href="../../design/components.css">',
    '<link rel="stylesheet" href="styles.css">',
    "<!--@favicon-->",
    "<!--@include ../../design/icons.html-->",
    "<!--@include ../../design/brand/logos.html-->",
    '<script src="../../design/shared.js"></script>',
    '<script src="data.js"></script>',
    '<script src="core.js"></script>',
    '<script src="app.js"></script>',
  ].forEach((line) => assert.equal(html.split(line).length - 1, 1, "应当恰好出现一次：" + line));
  const order = ["<!--@include ../../design/icons.html-->", "<!--@include ../../design/brand/logos.html-->", '<a class="skip-link"',
    '<script src="../../design/shared.js"></script>', '<script src="data.js"></script>', '<script src="core.js"></script>', '<script src="app.js"></script>'];
  order.slice(1).forEach((item, i) => assert.ok(html.indexOf(order[i]) < html.indexOf(item), item + " 的顺序不对"));
  assert.ok(/<main class="content" id="main" tabindex="-1">/.test(html), "#main 要能接收焦点");
  assert.ok(/data-theme-toggle/.test(html) && /data-maker/.test(html) && /data-toolbox/.test(html));
});

test("打印样式：隐藏侧栏和工具栏、A4、占满宽度、卡片避免分页截断、数据色要打印", () => {
  const at = css.indexOf("@media print");
  assert.ok(at > -1, "缺少打印样式");
  const print = css.slice(at);
  assert.ok(/\.app__sidebar[\s\S]*?\.topbar[\s\S]*?display:\s*none\s*!important/.test(print), "打印时要隐藏侧栏和工具栏");
  assert.ok(/@page\s*{[^}]*size:\s*A4/.test(css), "纸张 A4");
  assert.ok(/\.content\s*{[^}]*max-width:\s*none/.test(print), "报告占满 A4 宽度");
  assert.ok((print.match(/break-inside:\s*avoid/g) || []).length >= 2, "卡片避开分页截断");
  assert.ok(/print-color-adjust:\s*exact/.test(print) && /-webkit-print-color-adjust:\s*exact/.test(print), "数据色要打印出来");
  assert.ok(/\.view\[hidden\]\s*{[^}]*display:\s*none\s*!important/.test(print), "打印时别的视图不能冒出来");
});

test("热力图色阶按 15% / 40% / 65% / 100% 把强调色混进面板色，“不适用”是斜线", () => {
  [[1, 15], [2, 40], [3, 65]].forEach(([n, p]) => {
    assert.ok(css.includes(".shade-" + n + " { background: color-mix(in oklch, var(--accent) " + p + "%, var(--surface-raised)); }"), p + "%");
  });
  assert.ok(css.includes(".shade-4 { background: var(--accent); }"));
  assert.ok(/\.shade-na\s*{[^}]*repeating-linear-gradient\(135deg/.test(css));
  assert.ok(/\.heat__tile\.shade-4\s*{[^}]*color:\s*var\(--on-accent\)/.test(css));
  // 格子里的分数是大号文本（深色主题 65% 档是中间调，小字对比度不够）
  assert.ok(/\.heat__tile\s*{[^}]*font-size:\s*var\(--fs-xl\)[^}]*font-weight:\s*700/.test(css));
});

test("core.js 是纯逻辑：去掉注释后不出现 DOM、window、存储", () => {
  const pure = core.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'])\/\/.*$/gm, "$1");
  ["document", "window", "localStorage", "navigator", "innerHTML", "addEventListener", "querySelector", "setTimeout"].forEach((word) => {
    assert.equal(new RegExp("(^|[^\\w.])" + word + "(^|\\W)").test(pure), false, "core.js 里出现了 " + word);
  });
});

test("data.js 只放数据：去掉注释和 UMD 外壳后没有函数体和逻辑", () => {
  const pure = dataSrc.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*$/gm, "");
  assert.equal(/\bfunction\b|=>|\bif\b\s*\(|\bfor\b\s*\(|&&|\|\|/.test(pure.slice(pure.indexOf('"use strict"'))), false, "data.js 里不应有逻辑");
  assert.ok(dataSrc.includes("root.APP_DATA = data"), "浏览器里挂到 window.APP_DATA");
});


/* ---------- 标签配对：运行时测试发现不了（浏览器解析器会自作主张纠正），只能静态查 ---------- */
test("index.html 的标签全部正确配对，标题层级正确闭合", () => {
  const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
  const source = html.replace(/<!--[\s\S]*?-->/g, "");
  const stack = [];
  const errors = [];
  for (const m of source.matchAll(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^<>]*?)(\/?)>/g)) {
    const closing = m[1] === "/";
    const tag = m[2].toLowerCase();
    const selfClosing = m[4] === "/";
    const line = source.slice(0, m.index).split("\n").length;
    if (VOID.has(tag) || selfClosing) continue;
    if (closing) {
      if (stack.length && stack[stack.length - 1].tag === tag) {
        stack.pop();
      } else {
        errors.push("第 " + line + " 行：多出或错位的 </" + tag + ">，此时未闭合的是 " + stack.slice(-3).map((s) => "<" + s.tag + ">（第 " + s.line + " 行）").join("、"));
        const names = stack.map((s) => s.tag);
        if (names.includes(tag)) {
          while (stack.length && stack[stack.length - 1].tag !== tag) stack.pop();
          stack.pop();
        }
      }
    } else {
      stack.push({ tag, line });
    }
  }
  if (stack.length) errors.push("文件末尾仍未闭合：" + stack.map((s) => "<" + s.tag + ">（第 " + s.line + " 行）").join("、"));
  assert.deepEqual(errors, []);
  // 标题的 id 都有对应的 aria-labelledby 使用者，且报告页标题层级是 h1 → h2 → h3
  const report = html.slice(html.indexOf('data-view-panel="report"'), html.indexOf('data-view-panel="method"'));
  assert.ok(!/<h4/.test(report), "报告里不应出现 h4");
  assert.equal((report.match(/<h1 /g) || []).length, 1);
});
