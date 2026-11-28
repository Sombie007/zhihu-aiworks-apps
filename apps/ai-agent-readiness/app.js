/* ============================================================================
   AI Agent 落地评估自测 · 界面逻辑
   原生 JS，不引入任何外部库。计算全部在 core.js，内容全部在 data.js。
   唯一出现具体色值的地方是「导出报告图片」：画布离线渲染时读不到 CSS 变量，
   只能按浅色主题的 token 取值写死（见 PALETTE，与 tokens.css 浅色主题一致）。
   ========================================================================== */
(function () {
  "use strict";

  var D = window.APP_DATA;
  var C = window.APP_CORE;
  var Z = window.ZDX;
  var SVG_NS = "http://www.w3.org/2000/svg";

  var STORE_KEY = "draft";
  var STORE_VERSION = 1;
  var VIEW_TITLES = { start: "开始评估", survey: "评估问卷", report: "评估报告", method: "方法说明" };
  var ARROW_KEYS = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];

  var store = Z.store("agent-readiness");
  var qIndex = C.indexQuestions(D);
  var TOTAL = D.dimensions.reduce(function (n, d) { return n + d.questions.length; }, 0);

  /* ---------- 状态（全部集中在这里） ---------- */
  var state = {
    view: "start",
    dim: 0,               // 问卷当前显示的维度
    answers: {},          // { 题目 id: 1–5 }
    updatedAt: null,      // 最近一次改动作答的时间
    storageOk: true       // 浏览器是否允许本地保存
  };

  /* ---------- 基础工具 ---------- */
  function $(id) { return document.getElementById(id); }

  function node(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function el(tag, attrs, children) { return Z.el(tag, attrs, children); }

  function svgEl(tag, attrs, children) {
    var n = document.createElementNS(SVG_NS, tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (attrs[k] != null) n.setAttribute(k, attrs[k]);
      });
    }
    (children || []).forEach(function (c) { n.appendChild(c); });
    return n;
  }

  function icon(name, cls) { return Z.icon(name, cls); }

  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }

  function setText(n, text) {
    if (n.textContent !== text) n.textContent = text;
  }

  function show(n, visible) { n.hidden = !visible; }

  function actionButton(cls, label, action) {
    return el("button", { type: "button", class: cls, "data-action": action, text: label });
  }

  function dimById(r, id) {
    for (var i = 0; i < r.dimensions.length; i++) if (r.dimensions[i].id === id) return r.dimensions[i];
    return null;
  }

  function evalNow() { return C.evaluate(state.answers, D); }

  function reportDate() { return C.formatDate(state.updatedAt); }

  function scaleLabel(score) { return C.optionLabel(D, score); }

  function unansweredIn(r, dimIndex) {
    return r.dimensions[dimIndex].items.filter(function (it) { return it.score == null; });
  }

  function firstUnfinishedDim(r) {
    for (var i = 0; i < r.dimensions.length; i++) {
      if (unansweredIn(r, i).length) return i;
    }
    return state.dim;
  }

  function reportReason(r) {
    return "还有 " + (r.questionCount - r.answered) + " 道题没答，答完后才能查看报告";
  }

  /* ---------- 主要操作：按当前视图和作答进度决定 ---------- */
  function primaryAction(r) {
    if (state.view === "report") return { label: "导出报告图片", action: "export-png" };
    if (state.view === "survey") {
      /* 全部答完：不管停在哪个维度，主按钮都是“生成报告” */
      if (r.complete) return { label: "生成报告", action: "report" };
      if (state.dim < D.dimensions.length - 1) return { label: "下一维度", action: "next" };
      var left = r.questionCount - r.answered;
      return { label: "去答剩下的 " + left + " 题", action: "jump" };
    }
    /* 开始评估、方法说明 */
    if (!r.answered) return { label: "开始评估", action: "start" };
    if (!r.complete) return { label: "继续上次评估", action: "continue" };
    return { label: "查看评估报告", action: "report" };
  }

  function runPrimary() {
    var r = evalNow();
    var action = primaryAction(r).action;
    if (action === "export-png") { exportPng(); return; }
    if (action === "report") { setView("report"); return; }
    if (action === "start") {
      state.dim = 0;
      setView("survey");
      return;
    }
    if (action === "continue") {
      state.dim = unansweredIn(r, state.dim).length ? state.dim : firstUnfinishedDim(r);
      setView("survey");
      return;
    }
    if (action === "next") {
      state.dim += 1;
      setView("survey");
      return;
    }
    /* jump：跳到第一道没答的题 */
    var di = firstUnfinishedDim(r);
    var first = unansweredIn(r, di)[0];
    focusQuestion(first.q.id);
  }

  /* ---------- 视图切换 ---------- */
  var panels, navItems, main, viewTitle;

  function setView(name, opts) {
    opts = opts || {};
    if (name === "report" && !evalNow().complete) {
      Z.toast(reportReason(evalNow()), "warning");
      return false;
    }
    state.view = name;
    save();                              /* 顺带记住停在哪个维度，刷新后能接着答 */
    panels.forEach(function (p) {
      p.hidden = p.getAttribute("data-view-panel") !== name;
    });
    navItems.forEach(function (b) {
      if (b.getAttribute("data-view") === name) b.setAttribute("aria-current", "page");
      else b.removeAttribute("aria-current");
    });
    setText(viewTitle, VIEW_TITLES[name]);
    if (name === "survey") renderSurveyPanel();
    render();
    if (!opts.keepFocus) {
      main.focus({ preventScroll: true });
      window.scrollTo(0, 0);
    }
    return true;
  }

  /* 把焦点带到某道题（逐题得分格、“去答剩下的题”都会用到） */
  function focusQuestion(qid) {
    var info = qIndex[qid];
    if (!info) return;
    state.dim = info.dimIndex;
    setView("survey", { keepFocus: true });
    var article = $("q-" + qid);
    var radios = document.querySelectorAll('input[name="q-' + qid + '"]');
    if (article && typeof article.scrollIntoView === "function") article.scrollIntoView({ block: "center" });
    if (radios.length) radios[0].focus({ preventScroll: true });
  }

  /* ---------- 一次渲染：所有随状态变化的部分 ---------- */
  function render() {
    var r = evalNow();
    syncNav(r);
    syncTopbar(r);
    if (state.view === "start") renderStart(r);
    if (state.view === "survey") syncSurvey(r);
    if (state.view === "report") renderReport(r);
  }

  function syncNav(r) {
    var surveyCount = $("nav-survey-count");
    show(surveyCount, r.answered > 0);
    setText(surveyCount, r.answered + " / " + r.questionCount);

    var reportBtn = $("nav-report");
    var count = $("nav-report-count");
    if (r.complete) {
      reportBtn.removeAttribute("aria-disabled");
      reportBtn.removeAttribute("title");
      show(count, false);
      setText($("nav-report-reason"), "");
    } else {
      var msg = reportReason(r);
      reportBtn.setAttribute("aria-disabled", "true");
      reportBtn.setAttribute("title", msg);
      show(count, true);
      setText(count, r.answered ? "剩 " + (r.questionCount - r.answered) + " 题" : "未开始");
      setText($("nav-report-reason"), msg);
    }
  }

  function syncTopbar(r) {
    show($("tb-method"), state.view === "start" || state.view === "survey");
    show($("tb-copy"), state.view === "report");
    show($("tb-png"), state.view === "report");

    var spec = primaryAction(r);
    var primary = $("tb-primary");
    clear(primary);
    primary.appendChild(document.createTextNode(spec.label));
    if (spec.action === "export-png") primary.insertBefore(icon("arrow-down-tray", "icon--sm"), primary.firstChild);

    /* 问卷底部那组按钮与工具栏的主按钮是同一个动作；
       答完以后“下一维度”降为次要按钮，主按钮让给“生成报告” */
    show($("btn-next-dim"), r.complete && state.dim < D.dimensions.length - 1);
    var next = $("btn-next");
    clear(next);
    next.appendChild(document.createTextNode(spec.label));
    if (spec.action === "next") next.appendChild(icon("arrow-right", "icon--sm"));
    var prev = $("btn-prev");
    prev.disabled = state.view === "survey" && state.dim === 0;
    prev.title = prev.disabled ? "已经是第一个维度" : "回到上一个维度";
    var reset = $("survey-reset");
    reset.disabled = r.answered === 0;
    reset.title = reset.disabled ? "还没有作答" : "清空已答的题，从头再评";
  }

  /* ---------- 开始评估 ---------- */
  function resumeMeta(r) {
    if (r.complete) {
      var grade = r.overall ? r.overall.name : "";
      return "评估日期 " + reportDate() + " · 总分 " + r.total + " · " + grade +
        " · 可以直接看报告，也可以改完答案再看";
    }
    var current = r.dimensions[state.dim];
    return "已答 " + r.answered + " / " + r.questionCount + " 题，上次停在「" + current.name + "」";
  }

  function renderStart(r) {
    var label = primaryAction(r).label;
    setText($("start-cta"), label);

    var card = $("resume-card");
    clear(card);
    show(card, r.answered > 0);
    if (!r.answered) return;

    card.className = "card resume";
    var body = el("div", { class: "card__body resume__body" });
    body.appendChild(icon(r.complete ? "check-circle" : "clock", "icon icon--lg resume__icon"));
    var text = el("div", { class: "resume__text" });
    text.appendChild(node("span", "resume__title", r.complete ? "上次的评估已经答完" : "上次答到一半"));
    text.appendChild(node("span", "resume__meta", resumeMeta(r)));
    body.appendChild(text);
    var actions = el("div", { class: "resume__actions" });
    actions.appendChild(actionButton("btn btn--primary", label, "primary"));
    actions.appendChild(actionButton("btn btn--ghost", "重新评估", "reset"));
    body.appendChild(actions);
    card.appendChild(body);
  }

  function renderStartDims() {
    var list = $("start-dims");
    D.dimensions.forEach(function (dim) {
      var item = el("li", { class: "dim-list__item" });
      item.appendChild(node("span", "dim-list__no", dim.ordinal));
      item.appendChild(node("span", "dim-list__name", dim.name));
      item.appendChild(node("span", "dim-list__text", dim.summary));
      item.appendChild(node("span", "dim-list__count", dim.questions.length + " 道题"));
      list.appendChild(item);
    });
  }

  function renderScaleLegend(targetId) {
    var list = $(targetId);
    clear(list);
    D.scale.forEach(function (o) {
      var item = el("li", { class: "scale-legend__item" });
      item.appendChild(node("span", "scale-legend__no", String(o.value)));
      item.appendChild(node("span", "scale-legend__label", o.label));
      list.appendChild(item);
    });
  }

  /* ---------- 评估问卷 ---------- */
  function buildTabs() {
    var tabs = $("dim-tabs");
    clear(tabs);
    D.dimensions.forEach(function (dim, i) {
      var b = el("button", { type: "button", class: "segmented__btn", "data-dim": String(i), "aria-pressed": "false" });
      b.appendChild(node("span", "", dim.name));
      b.appendChild(node("span", "dim-tabs__count", ""));
      b.addEventListener("click", function () {
        state.dim = i;
        setView("survey");
      });
      tabs.appendChild(b);
    });
  }

  function stateBadge(score) {
    if (score == null) return node("span", "q__state small muted", "未答");
    return el("span", { class: "q__state badge badge--accent", text: score + " 分" });
  }

  function renderQuestion(q) {
    var article = el("article", { class: "q", id: "q-" + q.id, "aria-labelledby": "q-" + q.id + "-h" });

    var head = el("div", { class: "q__head" });
    var title = el("h3", { class: "q__title", id: "q-" + q.id + "-h" });
    title.appendChild(node("span", "q__no", q.no));
    title.appendChild(node("span", "", q.text));
    head.appendChild(title);
    head.appendChild(stateBadge(state.answers[q.id] === undefined ? null : state.answers[q.id]));
    article.appendChild(head);

    var list = el("div", { class: "scale", role: "radiogroup", "aria-labelledby": "q-" + q.id + "-h" });
    D.scale.forEach(function (o) {
      var label = el("label", { class: "scale__opt" });
      var input = el("input", { class: "scale__input", type: "radio", name: "q-" + q.id, value: String(o.value) });
      /* 屏幕阅读器读到的选项名：分值 + 含义 */
      input.setAttribute("aria-label", o.value + " 分，" + o.label);
      label.appendChild(input);
      label.appendChild(node("span", "scale__num", String(o.value)));
      label.appendChild(node("span", "scale__label", o.label));
      list.appendChild(label);
    });
    article.appendChild(list);

    var pick = el("p", { class: "q__pick", "aria-hidden": "true" });
    article.appendChild(pick);
    syncPick(pick, state.answers[q.id]);
    return article;
  }

  function syncPick(pick, score) {
    clear(pick);
    if (score == null) {
      pick.appendChild(node("span", "muted", "点一个分值：1 完全没有，5 体系化可复制，选最贴近现状的一档。"));
      return;
    }
    pick.appendChild(document.createTextNode("你选了 "));
    pick.appendChild(node("span", "strong", score + " 分"));
    pick.appendChild(document.createTextNode("：" + scaleLabel(score)));
  }

  function renderSurveyPanel() {
    var panel = $("survey-panel");
    clear(panel);
    var dim = D.dimensions[state.dim];

    var head = el("div", { class: "dim-panel__head" });
    head.appendChild(node("span", "dim-panel__kicker", "维度" + dim.ordinal + " · 共 " + dim.questions.length + " 道题"));
    head.appendChild(el("h2", { class: "dim-panel__title", text: dim.name }));
    head.appendChild(node("p", "dim-panel__summary", dim.summary));
    panel.appendChild(head);
    dim.questions.forEach(function (q) { panel.appendChild(renderQuestion(q)); });

    /* 把已保存的作答填回去 */
    dim.questions.forEach(function (q) {
      var value = state.answers[q.id];
      if (value === undefined) return;
      var input = panel.querySelector('input[name="q-' + q.id + '"][value="' + value + '"]');
      if (input) input.checked = true;
    });
  }

  function syncSurvey(r) {
    setText($("survey-progress-text"), "已答 " + r.answered + " / " + r.questionCount);
    var bar = $("survey-progress-bar");
    bar.style.width = (r.answered / r.questionCount * 100).toFixed(1) + "%";
    var progress = $("survey-progress");
    progress.setAttribute("aria-valuenow", String(r.answered));
    progress.setAttribute("aria-valuemax", String(r.questionCount));
    progress.setAttribute("aria-valuetext", "已答 " + r.answered + " / " + r.questionCount);

    var tabs = $("dim-tabs").querySelectorAll(".segmented__btn");
    Array.prototype.forEach.call(tabs, function (tab, i) {
      var d = r.dimensions[i];
      tab.setAttribute("aria-pressed", String(i === state.dim));
      setText(tab.querySelector(".dim-tabs__count"), (d.items.length - d.unanswered) + " / " + d.items.length);
    });

    /* 只更新当前面板里的题（其他面板未渲染） */
    Array.prototype.forEach.call($("survey-panel").querySelectorAll(".q"), function (article) {
      var id = article.id.slice(2);
      var value = state.answers[id];
      var old = article.querySelector(".q__state");
      if (old) old.parentNode.replaceChild(stateBadge(value === undefined ? null : value), old);
      var pick = article.querySelector(".q__pick");
      if (pick) syncPick(pick, value === undefined ? null : value);
    });

    setText($("survey-save-state"), state.storageOk
      ? "作答会自动保存在本机"
      : "浏览器不允许本地保存，关闭页面前请先完成评估");
    $("survey-save-state").classList.toggle("text-warning", !state.storageOk);
  }

  /* 答题：原生 change 事件和键盘操作都走这里 */
  function applyAnswer(input) {
    var id = input.name.slice(2);
    if (!qIndex[id]) return;
    state.answers[id] = Number(input.value);
    state.updatedAt = Date.now();
    save();
    render();
  }

  function choose(input) {
    if (input.checked) return;
    input.checked = true;
    applyAnswer(input);
  }

  /* 在 .scale 里用方向键在选项间移动：行为与原生单选组一致（移动并选中），
     自己处理是为了各个浏览器表现统一；回车也可以选中当前项 */
  function onPanelKeydown(e) {
    var key = e.key;
    var input = e.target;
    if (!input || input.tagName !== "INPUT" || input.type !== "radio") return;
    if (key === "Enter") {
      if (!input.checked) { e.preventDefault(); choose(input); }
      return;
    }
    if (ARROW_KEYS.indexOf(key) === -1) return;
    var group = input.closest(".scale");
    if (!group) return;
    var radios = group.querySelectorAll('input[type="radio"]');
    var i = Array.prototype.indexOf.call(radios, input);
    if (i < 0) return;
    var forward = key === "ArrowDown" || key === "ArrowRight";
    var next = radios[(i + (forward ? 1 : -1) + radios.length) % radios.length];
    e.preventDefault();
    choose(next);
    next.focus();
  }

  /* ---------- 本地保存 ---------- */
  function load() {
    var saved = store.get(STORE_KEY, null);
    if (!saved || saved.v !== STORE_VERSION) return;
    state.answers = C.normalizeAnswers(saved.answers, D);
    state.updatedAt = typeof saved.updatedAt === "number" && isFinite(saved.updatedAt) && saved.updatedAt > 0 ? saved.updatedAt : null;
    state.dim = typeof saved.dim === "number" && saved.dim >= 0 && saved.dim < D.dimensions.length ? Math.floor(saved.dim) : 0;
    if (!state.answers || !Object.keys(state.answers).length) state.updatedAt = null;
  }

  function save() {
    state.storageOk = store.set(STORE_KEY, {
      v: STORE_VERSION,
      answers: state.answers,
      updatedAt: state.updatedAt,
      dim: state.dim
    });
    return state.storageOk;
  }

  /* ---------- 报告 ---------- */
  var lastReport = null;

  function gradeBar(level) {
    var wrap = el("div", { class: "grade-bar" });
    wrap.setAttribute("role", "img");
    wrap.setAttribute("aria-label", "五档档位条，当前" + (level != null ? C.levelName(level) : "无法判定"));
    D.levels.forEach(function (l) {
      var cls = "grade-bar__cell";
      if (level != null) cls += l.level < level ? " grade-bar__cell--past" : l.level === level ? " grade-bar__cell--current" : "";
      var cell = el("div", { class: cls });
      if (level != null && l.level === level) cell.setAttribute("aria-current", "step");
      cell.appendChild(node("span", "grade-bar__bar"));
      cell.appendChild(node("span", "grade-bar__name", l.name));
      wrap.appendChild(cell);
    });
    return wrap;
  }

  function renderReport(r) {
    lastReport = r;
    var date = reportDate();
    renderReportMeta(date);
    renderVerdict(r);
    renderRadar(r);
    renderTiles(r);
    renderDimCards(r);
    setText($("report-retest"), D.retestNote);
    fillRules($("report-rules"));
    clear($("report-disclaimer"));
    $("report-disclaimer").appendChild(document.createTextNode(D.disclaimer));
    setText($("report-colophon"), "评估日期 " + date + " · 工具版本 " + D.version);
  }

  function renderReportMeta(date) {
    var meta = $("report-meta");
    clear(meta);
    [["评估日期", date], ["作答", "共 30 题 · 全部本机保存"], ["性质", "非官方自测"]].forEach(function (pair) {
      var item = el("div", { class: "meta__item" });
      item.appendChild(node("dt", "", pair[0]));
      item.appendChild(node("dd", "", pair[1]));
      meta.appendChild(item);
    });
  }

  function renderVerdict(r) {
    var body = $("report-verdict");
    clear(body);
    var o = r.overall;

    body.appendChild(el("h2", { class: "sr-only", id: "verdict-heading", text: "综合结论" }));

    var left = el("div", { class: "verdict__level" });
    left.appendChild(node("span", "verdict__label", "总分（30–150）"));
    var figure = el("div", { class: "verdict__figure" });
    figure.appendChild(node("span", "verdict__num", String(r.total)));
    figure.appendChild(node("span", "verdict__unit", "/ 150"));
    figure.appendChild(node("span", "verdict__grade", o.name));
    left.appendChild(figure);
    left.appendChild(gradeBar(o.level));
    body.appendChild(left);

    var right = el("div", { class: "verdict__text" });
    right.appendChild(node("span", "verdict__kicker", "一句话诊断"));
    right.appendChild(node("p", "verdict__sentence", o.diagnosis));

    var action = el("div", { class: "verdict__action" });
    action.appendChild(node("span", "strong", "建议动作："));
    action.appendChild(document.createTextNode(o.action));
    right.appendChild(action);

    if (o.next) {
      right.appendChild(node("p", "verdict__next",
        "距下一档「" + o.next.name + "」（" + o.next.min + " 分起）还差 " + o.gapToNext + " 分。"));
    } else {
      right.appendChild(node("p", "verdict__next", "已是最高档，重点是把这套能力沉淀下来、对外输出。"));
    }
    body.appendChild(right);
  }

  /* 雷达图：内联 SVG，六条轴对应六个维度，刻度 1–5（维度均分） */
  function radarGeometry() {
    var W = 400, H = 356, cx = 200, cy = 186, R = 108;
    var angles = [-90, -30, 30, 90, 150, 210];
    function pt(i, v) {
      var a = angles[i] * Math.PI / 180;
      var rr = R * v / C.MAX_SCORE;
      return [cx + rr * Math.cos(a), cy + rr * Math.sin(a)];
    }
    function pair(p) { return p[0].toFixed(1) + "," + p[1].toFixed(1); }
    return { W: W, H: H, cx: cx, cy: cy, R: R, pt: pt, pair: pair };
  }

  function buildRadar(avgScores, labels) {
    var g = radarGeometry();
    var cx = g.cx, cy = g.cy, R = g.R;
    function pt(i, v) { return g.pt(i, v); }
    function pair(p) { return g.pair(p); }

    var desc = "六个维度的均分：" + labels.map(function (l, i) {
      return l.name + " " + (avgScores[i] == null ? "无" : avgScores[i]);
    }).join("，") + "。刻度 1–5。";
    var svg = svgEl("svg", { class: "radar", viewBox: "0 0 " + g.W + " " + g.H, role: "img", "aria-labelledby": "radar-svg-title radar-svg-desc" });
    svg.appendChild(svgEl("title", { id: "radar-svg-title" }, [document.createTextNode("雷达图：六个维度的均分")]));
    svg.appendChild(svgEl("desc", { id: "radar-svg-desc" }, [document.createTextNode(desc)]));

    /* 刻度网格：1–5 六边形圈 */
    for (var k = 1; k <= C.MAX_SCORE; k++) {
      svg.appendChild(svgEl("polygon", { class: "radar__grid", points: [0, 1, 2, 3, 4, 5].map(function (i) { return pair(pt(i, k)); }).join(" ") }));
    }
    /* 六条轴 */
    for (var i = 0; i < 6; i++) {
      svg.appendChild(svgEl("line", { class: "radar__axis", x1: cx, y1: cy, x2: pt(i, C.MAX_SCORE)[0], y2: pt(i, C.MAX_SCORE)[1] }));
    }
    /* 刻度数字：沿第一条轴（正上）标 1–5 */
    for (k = 1; k <= C.MAX_SCORE; k++) {
      var t = pt(0, k);
      svg.appendChild(svgEl("text", { class: "radar__tick", x: t[0] + 6, y: t[1] + 4 }, [document.createTextNode(String(k))]));
    }

    /* 当前各维度：六点连成面 */
    var points = [0, 1, 2, 3, 4, 5].map(function (n) { return pair(pt(n, avgScores[n])); });
    svg.appendChild(svgEl("polygon", { class: "radar__area", points: points.join(" ") }));
    [0, 1, 2, 3, 4, 5].forEach(function (n) {
      var p = pt(n, avgScores[n]);
      svg.appendChild(svgEl("circle", { class: "radar__dot", cx: p[0].toFixed(1), cy: p[1].toFixed(1), r: 4.5 }));
    });

    /* 轴标签：上、右上、右下、下、左下、左上；位置从轴的外端（顶点）往外推 */
    var anchors = ["middle", "start", "start", "middle", "end", "end"];
    labels.forEach(function (l, n) {
      var name = svgEl("text", { class: "radar__label", "text-anchor": anchors[n] }, [document.createTextNode(l.name)]);
      var value = svgEl("text", { class: "radar__value", "text-anchor": anchors[n] }, [document.createTextNode(l.value)]);
      var p = pt(n, C.MAX_SCORE);
      var nx, ny, vx, vy;
      if (n === 0) { nx = cx; ny = cy - R - 42; vx = cx; vy = cy - R - 26; }
      else if (n === 3) { nx = cx; ny = cy + R + 30; vx = cx; vy = cy + R + 46; }
      else {
        nx = p[0] + (anchors[n] === "start" ? 12 : -12);
        vx = nx;
        if (n === 1 || n === 5) { ny = cy - R / 2 - 6; vy = ny + 16; }
        else { ny = cy + R / 2 + 2; vy = ny + 16; }
      }
      name.setAttribute("x", nx.toFixed(1)); name.setAttribute("y", ny.toFixed(1));
      value.setAttribute("x", vx.toFixed(1)); value.setAttribute("y", vy.toFixed(1));
      svg.appendChild(name);
      svg.appendChild(value);
    });
    return svg;
  }

  function renderRadar(r) {
    var box = $("report-radar");
    clear(box);
    if (!r || !r.complete) {
      box.appendChild(el("p", { class: "radar__note", text: "答完三十道题后，这里会出现六维雷达图。" }));
      return;
    }

    var avgScores = r.dimensions.map(function (d) { return d.avg == null ? null : Math.round(d.avg * 10) / 10; });
    var labels = r.dimensions.map(function (d) {
      return { name: d.name, value: d.avg == null ? "—" : (Math.round(d.avg * 10) / 10).toFixed(1) };
    });
    box.appendChild(buildRadar(avgScores, labels));

    var legend = el("div", { class: "radar-legend" });
    var key = el("span", { class: "radar-legend__key" }, [
      node("span", "radar-legend__line"),
      node("span", "", "当前各维度均分（1–5）")
    ]);
    legend.appendChild(key);
    box.appendChild(legend);
  }

  /* 逐题得分：每行一个维度，5 格按分着色，点击回到那道题 */
  function renderTiles(r) {
    var box = $("report-tiles");
    clear(box);
    var wrap = el("div", { class: "stack--3" });

    r.dimensions.forEach(function (d) {
      var row = el("div", { class: "tiles__row" });
      var name = node("span", "tiles__name", d.ordinal + " " + d.name);
      row.appendChild(name);
      d.items.forEach(function (it) {
        var s = it.score;
        var btn = el("button", { type: "button", class: "tiles__cell shade-" + s, "data-q": it.q.id });
        btn.setAttribute("aria-label", d.name + " 第 " + (it.qIndex + 1) + " 题（" + it.q.no + "）：得分 " + s + "，" + scaleLabel(s) + "。点击回到这道题修改。");
        btn.title = it.q.no + " " + s + " 分 · " + scaleLabel(s) + "（点击回到这道题）";
        btn.appendChild(node("span", "num", String(s)));
        row.appendChild(btn);
      });
      wrap.appendChild(row);
    });

    var legend = el("div", { class: "tiles__legend" });
    D.scale.forEach(function (o) {
      var key = el("span", { class: "tiles__legend-key" });
      key.appendChild(node("span", "tiles__legend-swatch shade-" + o.value));
      key.appendChild(node("span", "", o.value + " " + o.label));
      legend.appendChild(key);
    });
    wrap.appendChild(legend);
    wrap.appendChild(node("p", "tiles__hint small", "把鼠标移到格子上看分档含义，点击格子回到那道题修改。"));
    box.appendChild(wrap);
  }

  function renderDimCards(r) {
    var wrap = $("report-dims");
    clear(wrap);
    r.dimensions.forEach(function (d) {
      var card = el("article", { class: "card dim-card", "aria-labelledby": "dim-card-" + d.id });

      var header = el("div", { class: "card__header" });
      var title = el("h3", { class: "card__title", id: "dim-card-" + d.id });
      title.appendChild(node("span", "dim-card__no", d.ordinal));
      title.appendChild(node("span", "", d.name));
      header.appendChild(title);
      header.appendChild(el("span", { class: "card__meta", text: d.items.length + " 道题" }));
      card.appendChild(header);

      var body = el("div", { class: "card__body" });
      body.appendChild(node("p", "dim-card__summary", d.summary));

      var scoreRow = el("div", { class: "dim-card__score" });
      var total = node("span", "dim-card__total", d.score + " ");
      total.appendChild(node("span", "muted", "/ " + d.maxScore));
      scoreRow.appendChild(total);
      scoreRow.appendChild(el("span", { class: "dim-card__avg", text: "均分 " + C.avgText(d.scores) + " · 5 道题" }));
      body.appendChild(scoreRow);

      var barWrap = el("div", { class: "dim-card__bar" });
      var progress = el("div", { class: "progress", role: "progressbar", "aria-label": d.name + "得分" });
      progress.setAttribute("aria-valuemin", "0");
      progress.setAttribute("aria-valuemax", String(d.maxScore));
      progress.setAttribute("aria-valuenow", String(d.score));
      var fill = el("div", { class: "progress__bar" });
      fill.style.width = (d.score / d.maxScore * 100).toFixed(1) + "%";
      progress.appendChild(fill);
      barWrap.appendChild(progress);
      body.appendChild(barWrap);

      if (!d.weakest.length) {
        body.appendChild(node("p", "dim-card__quiet", "这一维度五道题全部满分，没有短板题。"));
      } else {
        var weak = el("div", { class: "weak" });
        d.weakest.forEach(function (it) {
          var item = el("div", { class: "weak__item" });
          var head = el("div", { class: "weak__head" });
          head.appendChild(node("span", "weak__no", it.q.no));
          head.appendChild(node("span", "weak__text", "短板题"));
          head.appendChild(el("span", { class: "badge badge--outline", text: "当前 " + it.score + " 分" }));
          item.appendChild(head);
          var lineQ = el("div", { class: "weak__line" });
          lineQ.appendChild(node("span", "weak__label", "所选："));
          lineQ.appendChild(node("span", "weak__body weak__body--quote", it.score + " 分 · " + scaleLabel(it.score)));
          item.appendChild(lineQ);
          var lineA = el("div", { class: "weak__line" });
          lineA.appendChild(node("span", "weak__label weak__label--accent", "建议："));
          lineA.appendChild(node("span", "weak__body", it.q.advice));
          item.appendChild(lineA);
          weak.appendChild(item);
        });
        body.appendChild(weak);
      }
      card.appendChild(body);
      wrap.appendChild(card);
    });
  }

  function fillRules(list) {
    clear(list);
    D.rules.forEach(function (rule) {
      var li = el("li");
      li.appendChild(node("span", "rules__term", rule.term + "："));
      var at = rule.em ? rule.text.indexOf(rule.em) : -1;
      if (at < 0) {
        li.appendChild(document.createTextNode(rule.text));
      } else {
        li.appendChild(document.createTextNode(rule.text.slice(0, at)));
        li.appendChild(node("em", "", rule.em));
        li.appendChild(document.createTextNode(rule.text.slice(at + rule.em.length)));
      }
      list.appendChild(li);
    });
  }

  /* ---------- 方法说明（内容不变，初始化时渲染一次） ---------- */
  function renderMethod() {
    setText($("method-positioning"), D.positioning);
    clear($("method-disclaimer"));
    $("method-disclaimer").appendChild(document.createTextNode(D.disclaimer));
    renderScaleLegend("method-scale");

    var dims = $("method-dims");
    D.dimensions.forEach(function (dim) {
      var tr = el("tr");
      var name = el("td");
      name.appendChild(node("span", "strong nowrap", dim.name));
      name.appendChild(node("span", "method-dim-ordinal", "维度" + dim.ordinal));
      tr.appendChild(name);
      tr.appendChild(el("td", { text: dim.summary }));
      tr.appendChild(el("td", { text: dim.questions.map(function (q) { return q.no; }).join("、") }));
      tr.appendChild(el("td", { class: "num", text: String(dim.questions.length) }));
      dims.appendChild(tr);
    });

    var levels = $("method-levels");
    D.levels.forEach(function (l) {
      levels.appendChild(el("tr", null, [
        el("td", null, [node("span", "strong nowrap", l.name)]),
        el("td", { class: "num nowrap", text: l.min + "–" + l.max }),
        el("td", { text: l.diagnosis }),
        el("td", { text: l.action })
      ]));
    });

    fillRules($("method-rules"));

    var faq = $("method-faq");
    D.faq.forEach(function (item) {
      faq.appendChild(node("dt", "", item.q));
      faq.appendChild(node("dd", "", item.a));
    });
  }

  /* ---------- 复制摘要 ---------- */
  function copySummary() {
    var r = evalNow();
    var text = C.buildSummary(r, D, { date: reportDate() });
    Z.copy(text).then(function () {
      Z.toast("已复制结论摘要", "success");
    }, function () {
      Z.toast("复制失败：浏览器没有允许访问剪贴板。可以在浏览器设置里允许本站使用剪贴板后再试，或改用「导出报告图片」。", "danger", 8000);
    });
  }

  /* ---------- 导出报告图片（SVG → canvas → PNG） ---------- */
  /* 画布离线渲染时读不到 CSS 变量，这里按 tokens.css 浅色主题取值（仅此一处写死色值） */
  var PALETTE = {
    bg: "#fbfbfc", panel: "#ffffff", accent: "#9d3b5c", accentSoft: "#f4e7eb", onAccent: "#ffffff",
    text: "#1b1f27", text2: "#555d6b", text3: "#6b7484", border: "#dce0e7"
  };
  var EXPORT_W = 1000;

  function escText(s) { return Z.esc(String(s)); }

  /** 单行文本，起点 (x, y)，fontWeight 400/600 */
  function line(x, y, text, size, color, weight, anchor) {
    return '<text x="' + x + '" y="' + y + '" font-size="' + size + '" fill="' + color + '" font-weight="' + (weight || 400) + '"' +
      (anchor ? ' text-anchor="' + anchor + '"' : "") + ">" + escText(text) + "</text>";
  }

  /** 长句按字数折行。画布上量不了文字宽度：全角字符按 1 个字宽估（字号 12 时 70 字约 840px，小于内容宽 888px） */
  function wrapLine(prefix, text, maxChars) {
    var out = [];
    var rest = prefix + text;
    while (rest.length > maxChars) {
      out.push(rest.slice(0, maxChars));
      rest = rest.slice(maxChars);
    }
    out.push(rest);
    return out;
  }

  /** 维度得分条 */
  function exportBar(x, y, w, ratio, labelLeft, labelRight) {
    var h = 10;
    var s = '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="5" fill="' + PALETTE.bg + '" stroke="' + PALETTE.border + '"/>';
    s += '<rect x="' + x + '" y="' + y + '" width="' + Math.max(2, w * ratio) + '" height="' + h + '" rx="5" fill="' + PALETTE.accent + '"/>';
    s += line(x, y - 8, labelLeft, 13, PALETTE.text, 600);
    s += line(x + w, y - 8, labelRight, 12, PALETTE.text2, 400, "end");
    return s;
  }

  /** 雷达图（导出用）：圆心 (cx, cy)，半径 r，六轴 1–5 刻度，面积取各维均分 */
  function exportRadar(cx, cy, r, dims) {
    var angles = [-90, -30, 30, 90, 150, 210];
    function pt(i, v) {
      var a = angles[i] * Math.PI / 180;
      var rr = r * v / C.MAX_SCORE;
      return [cx + rr * Math.cos(a), cy + rr * Math.sin(a)];
    }
    function pair(p) { return p[0].toFixed(1) + "," + p[1].toFixed(1); }
    var s = "";
    for (var k = 1; k <= C.MAX_SCORE; k++) {
      s += '<polygon points="' + [0, 1, 2, 3, 4, 5].map(function (i) { return pair(pt(i, k)); }).join(" ") + '" fill="none" stroke="' + PALETTE.border + '" stroke-width="1"/>';
    }
    for (var i = 0; i < 6; i++) {
      s += '<line x1="' + cx + '" y1="' + cy + '" x2="' + pt(i, C.MAX_SCORE)[0].toFixed(1) + '" y2="' + pt(i, C.MAX_SCORE)[1].toFixed(1) + '" stroke="' + PALETTE.border + '" stroke-width="1"/>';
    }
    var area = [0, 1, 2, 3, 4, 5].map(function (n) { return pair(pt(n, dims[n].avg)); }).join(" ");
    s += '<polygon points="' + area + '" fill="' + PALETTE.accentSoft + '" stroke="' + PALETTE.accent + '" stroke-width="2" stroke-linejoin="round"/>';
    [0, 1, 2, 3, 4, 5].forEach(function (n) {
      var p = pt(n, dims[n].avg);
      s += '<circle cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="4.5" fill="' + PALETTE.accent + '" stroke="' + PALETTE.panel + '" stroke-width="2"/>';
    });
    /* 轴标签：上、右上、右下、下、左下、左上 */
    var anchors = ["middle", "start", "start", "middle", "end", "end"];
    [0, 1, 2, 3, 4, 5].forEach(function (n) {
      var p = pt(n, C.MAX_SCORE);
      var lx, ly;
      if (n === 0) { lx = cx; ly = cy - r - 22; }
      else if (n === 3) { lx = cx; ly = cy + r + 26; }
      else {
        lx = p[0] + (anchors[n] === "start" ? 12 : -12);
        ly = (n === 1 || n === 5) ? p[1] - 2 : p[1] + 14;
      }
      s += line(lx, ly, dims[n].name + " 均分 " + C.avgText(dims[n].scores), 13, PALETTE.text, 600, anchors[n]);
    });
    return s;
  }

  /** 标志砖（导出用）：图形与 design/brand/logos.html 里的 #logo-ai-agent-readiness 一致，改标志时两处一起改 */
  function exportLogo(x, y, size) {
    return '<g transform="translate(' + x + " " + y + ") scale(" + (size / 32).toFixed(4) + ')">' +
      '<rect x="1" y="1" width="30" height="30" rx="8.5" fill="' + PALETTE.accent + '"/>' +
      '<path d="M16 5.2 25.4 10.6v10.8L16 26.8 6.6 21.4V10.6Z" fill="none" stroke="' + PALETTE.onAccent + '" stroke-width="2.4" stroke-linejoin="round"/>' +
      '<path d="M16 9.8 21.4 12.9v6.2L16 22.2l-5.4-3.1v-6.2Z" fill="none" stroke="' + PALETTE.onAccent + '" stroke-width="1.7" stroke-linejoin="round" opacity="0.72"/>' +
      '<path d="M16 16l6.4-3.6" fill="none" stroke="' + PALETTE.onAccent + '" stroke-width="2.2" stroke-linecap="round"/>' +
      '<circle cx="16" cy="16" r="1.8" fill="' + PALETTE.onAccent + '"/>' +
      "</g>";
  }

  function buildExportSvg(r, date) {
    var pad = 56;
    var contentW = EXPORT_W - pad * 2;
    var parts = [];
    var y = 0;
    var o = r.overall;

    /* 头部 */
    y = pad + 30;
    parts.push(line(pad, y, "AI Agent 落地评估自测 · 评估报告", 24, PALETTE.text, 600));
    y += 26;
    parts.push(line(pad, y, "评估日期 " + date + " · 折向东 · 工具箱 · 非官方自测，仅供内部讨论", 13, PALETTE.text3));

    /* 结论条：总分 + 档位 + 诊断 + 建议动作（超长折成两行） */
    y += 44;
    var rectTop = y - 30;
    parts.push('<rect x="' + pad + '" y="' + rectTop + '" width="' + contentW + '" height="126" rx="12" fill="' + PALETTE.panel + '" stroke="' + PALETTE.border + '"/>');
    parts.push(line(pad + 24, y + 20, String(r.total), 52, PALETTE.accent, 600));
    parts.push(line(pad + 132, y - 2, "/ 150", 15, PALETTE.text2));
    parts.push(line(pad + 132, y + 30, "总分（30 题之和）", 12, PALETTE.text3));
    parts.push('<line x1="' + (pad + 232) + '" y1="' + (y - 14) + '" x2="' + (pad + 232) + '" y2="' + (y + 72) + '" stroke="' + PALETTE.border + '"/>');
    var rx = pad + 256;
    parts.push(line(rx, y - 2, o.name + "（" + levelRange(o.level) + " 分）· " + o.diagnosis, 17, PALETTE.text, 600));
    var actionFull = "建议动作：" + o.action;
    var maxChars = 40;
    parts.push(line(rx, y + 26, actionFull.slice(0, maxChars), 14, PALETTE.text2));
    if (actionFull.length > maxChars) {
      parts.push(line(rx, y + 48, actionFull.slice(maxChars), 14, PALETTE.text2));
    }
    var nextText = o.next
      ? "距下一档「" + o.next.name + "」（" + o.next.min + " 分起）还差 " + o.gapToNext + " 分。"
      : "已是最高档，重点是把这套能力沉淀下来、对外输出。";
    parts.push(line(rx, y + 78, nextText, 13, PALETTE.text3));

    /* 雷达图 */
    y += 158;
    var radarR = 128;
    parts.push('<rect x="' + pad + '" y="' + (y - 26) + '" width="' + contentW + '" height="' + (radarR * 2 + 140) + '" rx="12" fill="' + PALETTE.panel + '" stroke="' + PALETTE.border + '"/>');
    parts.push(line(pad + 24, y, "六维雷达图", 16, PALETTE.text, 600));
    parts.push(line(EXPORT_W - pad - 24, y, "面积取各维度均分 · 刻度 1–5", 12, PALETTE.text3, 400, "end"));
    var radarCy = y + radarR + 64;
    parts.push(exportRadar(pad + contentW / 2, radarCy, radarR, r.dimensions));

    /* 六维得分条 */
    y += radarR * 2 + 172;
    parts.push(line(pad, y, "六个维度得分（每维 5–25 分）", 16, PALETTE.text, 600));
    y += 24;
    r.dimensions.forEach(function (d) {
      parts.push(exportBar(pad, y, contentW, d.score / d.maxScore,
        d.name, d.score + " / " + d.maxScore + " · 均分 " + C.avgText(d.scores)));
      y += 40;
    });

    /* 短板题与建议 */
    y += 22;
    parts.push(line(pad, y, "各维度短板与建议", 16, PALETTE.text, 600));
    y += 26;
    var weakCount = 0;
    r.dimensions.forEach(function (d) {
      d.weakest.forEach(function (it) {
        weakCount++;
        parts.push('<rect x="' + pad + '" y="' + (y - 15) + '" width="' + contentW + '" height="64" rx="10" fill="' + PALETTE.accentSoft + '"/>');
        parts.push(line(pad + 18, y + 6, d.name + " " + it.q.no + " · 当前 " + it.score + " 分（" + scaleLabel(it.score) + "）", 14, PALETTE.text, 600));
        var advice = "建议：" + it.q.advice;
        parts.push(line(pad + 18, y + 32, advice, 13, PALETTE.text2));
        y += 76;
      });
    });
    if (!weakCount) {
      parts.push(line(pad, y, "六个维度全部满分，没有短板题。", 14, PALETTE.text2));
      y += 30;
    }

    /* 复测与说明 */
    y += 12;
    parts.push(line(pad, y, "复测提示：" + D.retestNote, 12, PALETTE.text3));
    y += 22;
    var noteLines = wrapLine("说明：", D.disclaimer, 70);
    noteLines.forEach(function (t, i) {
      parts.push(line(pad, y + i * 20, t, 12, PALETTE.text3));
    });
    y += (noteLines.length - 1) * 20;

    /* 品牌条：这张图会被转发出去，底部写清是谁做的、去哪儿找 */
    var brand = D.brandFooter;
    if (brand) {
      y += 50;
      parts.push('<line x1="' + pad + '" y1="' + y + '" x2="' + (pad + contentW) + '" y2="' + y + '" stroke="' + PALETTE.border + '"/>');
      var logoSize = 40;
      var top = y + 20;
      parts.push(exportLogo(pad, top, logoSize));
      var tx = pad + logoSize + 16;
      parts.push(line(tx, top + 15, brand.name, 15, PALETTE.text, 600));
      parts.push(line(tx, top + 37, brand.intro, 13, PALETTE.text2));
      parts.push(line(tx, top + 58, brand.link, 12, PALETTE.text3));
      y = top + 78;
    }

    var H = y + (brand ? pad - 16 : pad);
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + EXPORT_W + '" height="' + H + '" viewBox="0 0 ' + EXPORT_W + " " + H + '" font-family="MiSans, PingFang SC, Microsoft YaHei, Noto Sans CJK SC, sans-serif">' +
      '<rect width="' + EXPORT_W + '" height="' + H + '" fill="' + PALETTE.bg + '"/>' +
      parts.join("") +
      "</svg>";
  }

  function levelRange(level) {
    var l = C.levelByNumber(D, level);
    return l ? l.min + "–" + l.max : "";
  }

  function exportPng() {
    var r = evalNow();
    if (!r.complete) { Z.toast(reportReason(r), "warning"); return; }
    var svg = buildExportSvg(r, reportDate() || todayText());
    var img = new Image();
    /* 用 data URI 而不是 blob URL：部分环境的 canvas 会把 blob 视为跨源，导出会失败 */
    img.onload = function () {
      try {
        var scale = 2;
        var canvas = document.createElement("canvas");
        canvas.width = EXPORT_W * scale;
        canvas.height = img.height * scale;
        var ctx = canvas.getContext("2d");
        ctx.fillStyle = PALETTE.bg;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        var pngName = "agent-readiness-report-" + (reportDate() || todayText()).replace(/-/g, "") + ".png";
        if (canvas.toBlob) {
          canvas.toBlob(function (blob) {
            if (!blob) {
              Z.toast("导出图片失败：浏览器不支持这种导出方式，可以改用「复制文本摘要」。", "danger", 8000);
              return;
            }
            saveBlob(pngName, blob);
            Z.toast("已导出报告图片（PNG）", "success");
          }, "image/png");
        } else {
          Z.toast("导出图片失败：浏览器不支持这种导出方式，可以改用「复制文本摘要」。", "danger", 8000);
        }
      } catch (e) {
        Z.toast("导出图片失败：当前浏览器不允许这样做。可以改用「复制文本摘要」保存结论。", "danger", 8000);
      }
    };
    img.onerror = function () {
      Z.toast("导出图片失败：当前浏览器无法离线渲染图片。可以改用「复制文本摘要」保存结论。", "danger", 8000);
    };
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  }

  function saveBlob(name, blob) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
  }

  function todayText() {
    var d = new Date();
    var pad2 = function (n) { return (n < 10 ? "0" : "") + n; };
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }

  /* ---------- 重新评估 ---------- */
  function openReset() {
    var n = evalNow().answered;
    if (!n) {
      Z.toast("还没有作答，不需要清空", "info");
      return;
    }
    setText($("reset-title"), "清空 " + n + " 道题的作答？");
    setText($("reset-body"), (n === TOTAL
      ? TOTAL + " 道题的作答会被全部清空，评估报告也随之失效。"
      : "已答的 " + n + " 道题会被清空。") + "此操作无法撤销。");
    setText($("reset-confirm"), "清空 " + n + " 道题的作答");
    Z.openDialog($("reset-dialog"));
  }

  function confirmReset() {
    var n = evalNow().answered;
    var dialog = $("reset-dialog");
    Z.closeDialog(dialog);
    state.answers = {};
    state.updatedAt = null;
    state.dim = 0;
    save();
    Z.toast("已清空 " + n + " 道题的作答", "info");
    if (state.view === "report") {
      setView("survey");            /* 作答已清空，不能再停在报告页；setView 会移动焦点 */
      return;
    }
    if (state.view === "survey") renderSurveyPanel();
    render();
    main.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }

  /* ---------- 事件 ---------- */
  function bindEvents() {
    navItems.forEach(function (b) {
      b.addEventListener("click", function () {
        if (b.getAttribute("aria-disabled") === "true") {
          Z.toast(reportReason(evalNow()), "warning");
          return;
        }
        setView(b.getAttribute("data-view"));
      });
    });

    document.addEventListener("click", function (e) {
      var target = e.target;
      var btn = target && typeof target.closest === "function" ? target.closest("[data-action]") : null;
      if (!btn || btn.disabled) return;
      var action = btn.getAttribute("data-action");
      if (action === "primary") runPrimary();
      else if (action === "go-method") setView("method");
      else if (action === "reset") openReset();
      else if (action === "prev-dim") { if (state.dim > 0) { state.dim -= 1; setView("survey"); } }
      else if (action === "next-dim") { if (state.dim < D.dimensions.length - 1) { state.dim += 1; setView("survey"); } }
      else if (action === "copy-summary") copySummary();
      else if (action === "export-png") exportPng();
    });

    var panel = $("survey-panel");
    panel.addEventListener("change", function (e) {
      var input = e.target;
      if (!input || input.type !== "radio" || !input.checked) return;
      applyAnswer(input);
    });
    panel.addEventListener("keydown", onPanelKeydown);

    var tiles = $("report-tiles");
    tiles.addEventListener("click", function (e) {
      var btn = e.target.closest(".tiles__cell");
      if (btn) focusQuestion(btn.getAttribute("data-q"));
    });

    var dialog = $("reset-dialog");
    Array.prototype.forEach.call(dialog.querySelectorAll("[data-close]"), function (b) {
      b.addEventListener("click", function () { Z.closeDialog(dialog); });
    });
    $("reset-confirm").addEventListener("click", confirmReset);
  }

  /* ---------- 启动 ---------- */
  function init() {
    main = $("main");
    viewTitle = $("view-title");
    panels = Array.prototype.slice.call(document.querySelectorAll("[data-view-panel]"));
    navItems = Array.prototype.slice.call(document.querySelectorAll(".nav__item[data-view]"));

    load();
    /* 先探一下本地存储能不能写（隐私模式下会静默失败），问卷里的保存提示要靠它 */
    state.storageOk = store.set("probe", Date.now());
    if (state.storageOk) store.remove("probe");
    renderStartDims();
    renderScaleLegend("start-scale");
    buildTabs();
    renderMethod();
    bindEvents();
    renderSurveyPanel();
    render();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
