/* ============================================================================
   数字化成熟度自评 · 界面逻辑
   原生 JS，不引入任何外部库。计算全部在 core.js，内容全部在 data.js。
   ========================================================================== */
(function () {
  "use strict";

  var D = window.APP_DATA;
  var C = window.APP_CORE;
  var Z = window.ZDX;
  var SVG_NS = "http://www.w3.org/2000/svg";

  var STORE_KEY = "draft";
  var STORE_VERSION = 2;
  var VIEW_TITLES = { start: "开始评估", survey: "评估问卷", report: "评估报告", method: "方法说明" };
  var ARROW_KEYS = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];

  var store = Z.store("maturity");
  var qIndex = C.indexQuestions(D);
  var TOTAL = D.dimensions.reduce(function (n, d) { return n + d.questions.length; }, 0);
  var MAX_Q = Math.max.apply(null, D.dimensions.map(function (d) { return d.questions.length; }));

  /* ---------- 状态（全部集中在这里） ---------- */
  var state = {
    view: "start",
    dim: 0,                              // 问卷当前显示的维度
    answers: {},                         // { 题目 id: 1–4 | 0（不适用） }
    profile: { industry: "", size: "" }, // 企业信息，不参与计分
    updatedAt: null,                     // 最近一次改动作答的时间
    storageOk: true                      // 浏览器是否允许本地保存
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

  function levelWord(level) { return C.levelName(level); }

  function dimById(r, id) {
    for (var i = 0; i < r.dimensions.length; i++) if (r.dimensions[i].id === id) return r.dimensions[i];
    return null;
  }

  function evalNow() { return C.evaluate(state.answers, D); }

  function reportDate() { return C.formatDate(state.updatedAt); }

  function profileText() { return C.profileLine(state.profile, D); }

  function labelOf(list, value) {
    var hit = list.filter(function (x) { return x.value === value; })[0];
    return hit ? hit.label : "";
  }

  function sizeAdvice() {
    var hit = D.profile.sizes.filter(function (s) { return s.value === state.profile.size; })[0];
    return hit ? hit.advice : "";
  }

  /* ---------- 本地保存 ---------- */
  function isKnown(list, value) {
    return list.some(function (x) { return x.value === value; });
  }

  function load() {
    var saved = store.get(STORE_KEY, null);
    if (!saved || saved.v !== STORE_VERSION) return;
    state.answers = C.normalizeAnswers(saved.answers, D);
    var p = saved.profile || {};
    state.profile.industry = isKnown(D.profile.industries, p.industry) ? p.industry : "";
    state.profile.size = isKnown(D.profile.sizes, p.size) ? p.size : "";
    state.updatedAt = typeof saved.updatedAt === "number" && isFinite(saved.updatedAt) && saved.updatedAt > 0 ? saved.updatedAt : null;
    state.dim = typeof saved.dim === "number" && saved.dim >= 0 && saved.dim < D.dimensions.length ? Math.floor(saved.dim) : 0;
    if (!state.answers || !Object.keys(state.answers).length) state.updatedAt = null;
  }

  function save() {
    state.storageOk = store.set(STORE_KEY, {
      v: STORE_VERSION,
      answers: state.answers,
      profile: state.profile,
      updatedAt: state.updatedAt,
      dim: state.dim
    });
    return state.storageOk;
  }

  /* ---------- 题库里哪些题还没答 ---------- */
  function unansweredIn(r, dimIndex) {
    return r.dimensions[dimIndex].items.filter(function (it) { return !it.answered; });
  }

  function firstUnfinishedDim(r) {
    for (var i = 0; i < r.dimensions.length; i++) {
      if (unansweredIn(r, i).length) return i;
    }
    return state.dim;
  }

  function reportReason(r) {
    return "还有 " + (r.total - r.answered) + " 道题没答，答完后才能查看报告";
  }

  /* ---------- 主要操作：按当前视图和作答进度决定 ---------- */
  function primaryAction(r) {
    if (state.view === "report") return { label: "打印或另存 PDF", action: "print" };
    if (state.view === "survey") {
      /* 全部答完：不管停在哪个维度，主按钮都是“生成报告” */
      if (r.complete) return { label: "生成报告", action: "report" };
      if (state.dim < D.dimensions.length - 1) return { label: "下一维度", action: "next" };
      if (r.complete) return { label: "生成报告", action: "report" };
      var left = r.total - r.answered;
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
    if (action === "print") { printReport(); return; }
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

  /* 把焦点带到某道题（热力图格子、“去答剩下的题”都会用到） */
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
    setText(surveyCount, r.answered + " / " + r.total);

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
      setText(count, r.answered ? "剩 " + (r.total - r.answered) + " 题" : "未开始");
      setText($("nav-report-reason"), msg);
    }
  }

  function syncTopbar(r) {
    show($("tb-method"), state.view === "start" || state.view === "survey");
    show($("tb-copy"), state.view === "report");

    var spec = primaryAction(r);
    var primary = $("tb-primary");
    clear(primary);
    primary.appendChild(document.createTextNode(spec.label));
    if (spec.action === "print") primary.insertBefore(icon("printer", "icon--sm"), primary.firstChild);

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
      return "评估日期 " + reportDate() + " · 综合等级 " +
        (r.overall.level == null ? "无法判定" : r.overall.levelName) + " · 可以直接看报告，也可以改完答案再看";
    }
    var current = r.dimensions[state.dim];
    return "已答 " + r.answered + " / " + r.total + " 题，上次停在「" + current.name + "」";
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
    if (score === C.NA) return el("span", { class: "q__state badge", text: D.notApplicable.title });
    return el("span", { class: "q__state badge", text: levelWord(score) });
  }

  function renderQuestion(q) {
    var article = el("article", { class: "q", id: "q-" + q.id, "aria-labelledby": "q-" + q.id + "-h" });

    var head = el("div", { class: "q__head" });
    var title = el("h3", { class: "q__title", id: "q-" + q.id + "-h" });
    title.appendChild(node("span", "q__no", q.no));
    title.appendChild(node("span", "", q.title));
    head.appendChild(title);
    head.appendChild(stateBadge(state.answers[q.id] === undefined ? null : state.answers[q.id]));
    article.appendChild(head);

    var list = el("div", { class: "choice-list", role: "radiogroup", "aria-labelledby": "q-" + q.id + "-h" });
    q.options.forEach(function (text, i) {
      var level = i + 1;
      var label = el("label", { class: "choice" });
      label.appendChild(el("input", { class: "check__input", type: "radio", name: "q-" + q.id, value: String(level) }));
      label.appendChild(node("span", "choice__marker", String(level)));
      label.appendChild(node("span", "choice__text", text));
      list.appendChild(label);
    });
    var na = el("label", { class: "choice choice--na" });
    na.appendChild(el("input", { class: "check__input", type: "radio", name: "q-" + q.id, value: String(C.NA) }));
    na.appendChild(node("span", "choice__marker", "—"));
    var naText = el("span");
    naText.appendChild(node("span", "choice__title", D.notApplicable.title));
    naText.appendChild(node("span", "choice__desc", D.notApplicable.desc));
    na.appendChild(naText);
    list.appendChild(na);
    article.appendChild(list);
    return article;
  }

  function renderSurveyPanel() {
    var panel = $("survey-panel");
    clear(panel);
    var dim = D.dimensions[state.dim];

    var head = el("div", { class: "dim-panel__head" });
    head.appendChild(node("span", "dim-panel__kicker", "维度" + dim.ordinal + " · 共 " + dim.questions.length + " 道题"));
    head.appendChild(el("h2", { class: "dim-panel__title", text: dim.name }));
    head.appendChild(node("p", "dim-panel__summary", dim.summary));
    if (dim.id === "operation") {
      var callout = el("div", { class: "callout callout--info callout--text" });
      callout.appendChild(icon("information-circle"));
      callout.appendChild(el("div", { class: "callout__body", text: "按业务场景逐个判断。企业没有这个场景的题，选「不适用」，不计入评分。" }));
      head.appendChild(callout);
    }
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
    setText($("survey-progress-text"), "已答 " + r.answered + " / " + r.total);
    var bar = $("survey-progress-bar");
    bar.style.width = (r.answered / r.total * 100).toFixed(1) + "%";
    var progress = $("survey-progress");
    progress.setAttribute("aria-valuenow", String(r.answered));
    progress.setAttribute("aria-valuemax", String(r.total));
    progress.setAttribute("aria-valuetext", "已答 " + r.answered + " / " + r.total);

    var tabs = $("dim-tabs").querySelectorAll(".segmented__btn");
    Array.prototype.forEach.call(tabs, function (tab, i) {
      var d = r.dimensions[i];
      tab.setAttribute("aria-pressed", String(i === state.dim));
      setText(tab.querySelector(".dim-tabs__count"), (d.items.length - d.unanswered) + " / " + d.items.length);
    });

    Array.prototype.forEach.call($("survey-panel").querySelectorAll(".q"), function (article) {
      var id = article.id.slice(2);
      var value = state.answers[id];
      var old = article.querySelector(".q__state");
      if (old) old.parentNode.replaceChild(stateBadge(value === undefined ? null : value), old);
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

  /* 在 .choice-list 里用方向键在选项间移动：行为与原生单选组一致（移动并选中），
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
    var group = input.closest(".choice-list");
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

  /* ---------- 报告：通用部件 ---------- */
  var lastReport = null;

  function locate(r, qid) {
    for (var i = 0; i < r.dimensions.length; i++) {
      var items = r.dimensions[i].items;
      for (var j = 0; j < items.length; j++) {
        if (items[j].q.id === qid) return { item: items[j], dim: r.dimensions[i] };
      }
    }
    return null;
  }

  function scoreWord(score) {
    return score === C.NA ? D.notApplicable.title : levelWord(score);
  }

  /* 四级阶梯：当前级实底高亮，已达到的淡底，没到的空描边 */
  function ladder(level, small) {
    var wrap = el("div", { class: "ladder" + (small ? " ladder--sm" : "") + (level == null ? " ladder--empty" : "") });
    wrap.setAttribute("role", "img");
    wrap.setAttribute("aria-label", level == null ? "等级阶梯：无有效作答" : "四级阶梯，当前" + levelWord(level));
    for (var i = 1; i <= C.MAX_LEVEL; i++) {
      var cls = "ladder__step";
      if (level != null) cls += i < level ? " ladder__step--past" : i === level ? " ladder__step--current" : "";
      var step = el("div", { class: cls });
      if (i === level) step.setAttribute("aria-current", "step");
      step.appendChild(node("span", "ladder__bar"));
      step.appendChild(node("span", "ladder__label", levelWord(i)));
      wrap.appendChild(step);
    }
    return wrap;
  }

  function legendKey(prefix, shade, text) {
    var key = el("span", { class: prefix + "__key" });
    key.appendChild(node("span", prefix + "__swatch shade-" + shade));
    key.appendChild(node("span", "", text));
    return key;
  }

  /* 必须原文出现的说明：域名做成链接，但文字一字不差 */
  function appendDisclaimer(parent) {
    var text = D.disclaimer;
    var domain = "zjtx.miit.gov.cn";
    var at = text.lastIndexOf(domain);
    parent.appendChild(document.createTextNode(at < 0 ? text : text.slice(0, at)));
    if (at >= 0) {
      parent.appendChild(el("a", { href: D.platformUrl, target: "_blank", rel: "noopener noreferrer", text: domain }));
      parent.appendChild(document.createTextNode(text.slice(at + domain.length)));
    }
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

  function emptyCard(iconName, title, text, label, action) {
    var card = el("div", { class: "card" });
    var body = el("div", { class: "card__body empty" });
    body.appendChild(icon(iconName));
    body.appendChild(node("div", "empty__title", title));
    body.appendChild(node("p", "empty__text", text));
    if (label) {
      var actions = el("div", { class: "empty__actions" });
      actions.appendChild(actionButton("btn btn--secondary", label, action));
      body.appendChild(actions);
    }
    card.appendChild(body);
    return card;
  }

  /* ---------- 报告：各区块 ---------- */
  function renderReport(r) {
    lastReport = r;
    var date = reportDate();
    renderReportMeta(r, date);
    renderVerdict(r);
    renderWhy(r);
    renderDimCards(r);
    renderHeat(r);
    renderRadar(r);
    renderGap(r);
    renderPlan(r);
    fillRules($("report-rules"));
    clear($("report-disclaimer"));
    appendDisclaimer($("report-disclaimer"));
    setText($("report-colophon"), "评估日期 " + date + " · 工具版本 " + D.version);
  }

  function renderReportMeta(r, date) {
    var meta = $("report-meta");
    clear(meta);
    var industry = labelOf(D.profile.industries, state.profile.industry);
    var size = labelOf(D.profile.sizes, state.profile.size);
    var items = [["评估日期", date], ["性质", "非官方自评"]];
    if (!industry && !size) {
      items.splice(1, 0, ["企业信息", D.profile.emptyLabel]);
    } else {
      items.splice(1, 0, ["行业", industry || "未填写"], ["规模", size || "未填写"]);
    }
    items.forEach(function (pair) {
      var item = el("div", { class: "meta__item" });
      item.appendChild(node("dt", "", pair[0]));
      item.appendChild(node("dd", "", pair[1]));
      meta.appendChild(item);
    });
  }

  function renderVerdict(r) {
    var body = $("report-verdict");
    clear(body);
    var level = r.overall.level;
    $("report-verdict-card").classList.toggle("verdict--none", level == null);

    body.appendChild(el("h2", { class: "sr-only", id: "verdict-title", text: "综合结论" }));

    var left = el("div", { class: "verdict__level" });
    left.appendChild(node("span", "verdict__label", "综合等级"));
    var figure = el("div", { class: "verdict__figure" });
    figure.appendChild(node("span", "verdict__num", level == null ? "—" : String(level)));
    figure.appendChild(node("span", "verdict__unit", level == null ? "无法判定" : "级"));
    left.appendChild(figure);
    left.appendChild(ladder(level, false));
    body.appendChild(left);

    var right = el("div", { class: "verdict__text" });
    right.appendChild(node("span", "verdict__kicker", level == null ? "给不出判读" : "一句话判读"));
    right.appendChild(node("p", "verdict__sentence", level == null
      ? "所有题目都选了「不适用」，没有可以判定等级的维度。"
      : C.verdictFor(level, D)));
    if (level == null) {
      var aside = el("div", { class: "verdict__aside" });
      aside.appendChild(node("p", "", "至少在几道题上选出实际等级，报告才能给出综合等级和行动建议。"));
      aside.appendChild(actionButton("btn btn--secondary", "回到问卷修改", "back-survey"));
      right.appendChild(aside);
    }
    body.appendChild(right);
  }

  function renderWhy(r) {
    var box = $("report-why");
    clear(box);
    /* 第一、二段是结论；从第三段起是“不拖后腿”“未计入”这类补充，用次要文字色 */
    var level = r.overall.level;
    var mutedFrom = (level == null || level === C.MAX_LEVEL) ? 1 : 2;
    C.buildWhy(r, D).forEach(function (text, i) {
      box.appendChild(node("p", i >= mutedFrom ? "why__muted" : "", text));
    });
  }

  function factsLine(d) {
    var text;
    if (d.level == null) {
      text = d.items.length + " 道题全部选了「不适用」";
    } else if (!d.next) {
      text = "有效作答 " + d.validCount + " 题，达到四级的 " + d.counts[4] + " 题（需要 " + d.required + " 题）";
    } else {
      text = "有效作答 " + d.validCount + " 题：达到" + d.next.levelName + "及以上 " + d.next.have + " 题，需要 " + d.next.required + " 题";
    }
    if (d.level != null && d.naCount) text += "，另有 " + d.naCount + " 题不适用";
    return text;
  }

  /* 分布条：这个维度里各等级各有几道题 */
  function distBlock(d) {
    var wrap = el("div", { class: "stack--2" });
    var bar = el("div", { class: "dist" });
    var legend = el("div", { class: "dist__legend" });
    var parts = [];
    [1, 2, 3, 4].forEach(function (lv) {
      var n = d.counts[lv];
      if (!n) return;
      parts.push(levelWord(lv) + " " + n + " 题");
      var seg = node("span", "dist__seg shade-" + lv);
      seg.style.flexGrow = String(n);
      bar.appendChild(seg);
      legend.appendChild(legendKey("dist", lv, levelWord(lv) + " " + n));
    });
    if (d.naCount) {
      parts.push("不适用 " + d.naCount + " 题");
      var seg = node("span", "dist__seg shade-na");
      seg.style.flexGrow = String(d.naCount);
      bar.appendChild(seg);
      legend.appendChild(legendKey("dist", "na", "不适用 " + d.naCount));
    }
    bar.setAttribute("role", "img");
    bar.setAttribute("aria-label", "各等级的题数：" + parts.join("，"));
    wrap.appendChild(bar);
    wrap.appendChild(legend);
    wrap.appendChild(node("p", "dim-card__facts", factsLine(d)));
    return wrap;
  }

  function renderDimCards(r) {
    var wrap = $("report-dims");
    clear(wrap);
    r.dimensions.forEach(function (d) {
      var isBottleneck = r.overall.level != null && r.overall.level !== C.MAX_LEVEL && r.overall.bottleneckIds.indexOf(d.id) !== -1;
      var card = el("article", { class: "card dim-card", "aria-labelledby": "dim-card-" + d.id });

      var header = el("div", { class: "card__header" });
      var title = el("h3", { class: "card__title", id: "dim-card-" + d.id });
      title.appendChild(node("span", "dim-card__no", d.ordinal));
      title.appendChild(node("span", "", d.name));
      header.appendChild(title);
      var meta = el("span", { class: "card__meta" });
      meta.appendChild(el("span", { class: "badge badge--outline", text: d.level == null ? "无有效作答" : levelWord(d.level) }));
      if (isBottleneck) meta.appendChild(el("span", { class: "badge badge--solid", text: "卡点" }));
      header.appendChild(meta);
      card.appendChild(header);

      var body = el("div", { class: "card__body" });
      body.appendChild(ladder(d.level, true));
      if (d.level == null) {
        body.appendChild(node("p", "dim-card__next dim-card__next--quiet", "该维度无有效作答，未计入综合等级"));
      } else if (!d.next) {
        body.appendChild(node("p", "dim-card__next dim-card__next--quiet", "已是最高等级，没有需要补的题"));
      } else {
        body.appendChild(node("p", "dim-card__next", "再提升 " + d.next.needRaise + " 道题可达到" + d.next.levelName));
      }
      body.appendChild(distBlock(d));
      card.appendChild(body);
      wrap.appendChild(card);
    });
  }

  function heatReadoutText(qid) {
    var found = lastReport && locate(lastReport, qid);
    if (!found) return "";
    return found.item.q.no + " " + found.item.q.title + "：" + scoreWord(found.item.score);
  }

  function resetReadout() {
    var box = $("heat-readout");
    if (!box) return;
    clear(box);
    box.appendChild(node("span", "heat__hint", "把鼠标移到格子上，或者用 Tab 键选中格子，这里会显示题目和所选等级。点击格子可以回到那道题修改。"));
  }

  function showReadout(qid) {
    var found = lastReport && locate(lastReport, qid);
    var box = $("heat-readout");
    if (!box || !found) return;
    var it = found.item;
    clear(box);
    box.appendChild(node("span", "heat__readout-title", it.q.no + " " + it.q.title));
    box.appendChild(el("span", { class: "badge " + (it.score === C.NA ? "" : "badge--accent"), text: scoreWord(it.score) }));
    box.appendChild(node("span", "heat__readout-text", it.score === C.NA ? D.notApplicable.desc : it.q.options[it.score - 1]));
  }

  function renderHeat(r) {
    var box = $("report-heat");
    clear(box);
    var wrap = el("div", { class: "heat" });
    var scroll = el("div", { class: "heat__scroll" });
    var table = el("table");
    table.appendChild(el("caption", { class: "sr-only", text: "题目热力图：每一行是一个维度，每一格是一道题，颜色越深等级越高，斜线表示不适用" }));

    var cols = el("colgroup");
    cols.appendChild(el("col", { class: "heat__col-label" }));
    for (var c = 0; c < MAX_Q; c++) cols.appendChild(el("col"));
    table.appendChild(cols);

    var headRow = el("tr");
    headRow.appendChild(el("th", { scope: "col" }, [el("span", { class: "sr-only", text: "维度" })]));
    for (var i = 0; i < MAX_Q; i++) headRow.appendChild(el("th", { scope: "col", text: "第 " + (i + 1) + " 题" }));
    table.appendChild(el("thead", null, [headRow]));

    var body = el("tbody");
    r.dimensions.forEach(function (d) {
      var tr = el("tr");
      var th = el("th", { scope: "row" });
      th.appendChild(node("span", "heat__row-name", d.name));
      th.appendChild(node("span", "heat__row-meta", d.level == null ? "无有效作答" : levelWord(d.level)));
      tr.appendChild(th);
      d.items.forEach(function (it) {
        var na = it.score === C.NA;
        var label = it.q.no + " " + it.q.title + "，" + scoreWord(it.score);
        var btn = el("button", { type: "button", class: "heat__btn", "data-q": it.q.id, title: heatReadoutText(it.q.id) + "（点击回到这道题）" });
        btn.setAttribute("aria-label", label);
        var tile = node("span", "heat__tile " + (na ? "shade-na heat__tile--na" : "shade-" + it.score), na ? "—" : String(it.score));
        tile.setAttribute("aria-hidden", "true");
        var no = node("span", "heat__no", it.q.no);
        no.setAttribute("aria-hidden", "true");
        btn.appendChild(tile);
        btn.appendChild(no);
        tr.appendChild(el("td", null, [btn]));
      });
      for (var k = d.items.length; k < MAX_Q; k++) tr.appendChild(el("td", { class: "heat__blank", "aria-hidden": "true" }));
      body.appendChild(tr);
    });
    table.appendChild(body);
    scroll.appendChild(table);
    wrap.appendChild(scroll);

    var legend = el("div", { class: "legend" });
    [1, 2, 3, 4].forEach(function (lv) { legend.appendChild(legendKey("legend", lv, levelWord(lv))); });
    legend.appendChild(legendKey("legend", "na", D.notApplicable.title));
    wrap.appendChild(legend);

    var readout = el("p", { class: "heat__readout", id: "heat-readout", "aria-live": "polite" });
    wrap.appendChild(readout);
    box.appendChild(wrap);
    resetReadout();
  }

  /* 雷达图：内联 SVG，四条轴对应四个维度，刻度 1–4 */
  function renderRadar(r) {
    var box = $("report-radar");
    clear(box);
    if (r.overall.level == null) {
      box.appendChild(el("p", { class: "radar__note", text: "所有题目都选了「不适用」，雷达图上没有可以标出的位置。" }));
      return;
    }

    var W = 340, H = 290, cx = 170, cy = 150, R = 84;
    var angles = [-90, 0, 90, 180];
    function pt(i, v) {
      var a = angles[i] * Math.PI / 180;
      var rr = R * v / C.MAX_LEVEL;
      return [cx + rr * Math.cos(a), cy + rr * Math.sin(a)];
    }
    function pair(p) { return p[0].toFixed(1) + "," + p[1].toFixed(1); }

    var desc = "四个维度的等级：" + r.dimensions.map(function (d) {
      return d.name + (d.level == null ? "未计入" : levelWord(d.level));
    }).join("，") + "。综合等级轮廓：" + r.overall.levelName + "。";
    var svg = svgEl("svg", { class: "radar", viewBox: W + " " + H, role: "img", "aria-labelledby": "radar-svg-title radar-svg-desc" });
    svg.appendChild(svgEl("title", { id: "radar-svg-title" }, [document.createTextNode("雷达图：四个维度的等级与综合等级轮廓")]));
    svg.appendChild(svgEl("desc", { id: "radar-svg-desc" }, [document.createTextNode(desc)]));

    for (var k = 1; k <= C.MAX_LEVEL; k++) {
      svg.appendChild(svgEl("polygon", { class: "radar__grid", points: [0, 1, 2, 3].map(function (i) { return pair(pt(i, k)); }).join(" ") }));
    }
    for (var i = 0; i < 4; i++) {
      svg.appendChild(svgEl("line", { class: "radar__axis", x1: cx, y1: cy, x2: pt(i, C.MAX_LEVEL)[0], y2: pt(i, C.MAX_LEVEL)[1] }));
    }
    for (k = 1; k <= C.MAX_LEVEL; k++) {
      var t = pt(0, k);
      svg.appendChild(svgEl("text", { class: "radar__tick", x: t[0] + 6, y: t[1] + 4 }, [document.createTextNode(String(k))]));
    }

    var overall = r.overall.level;
    svg.appendChild(svgEl("polygon", { class: "radar__overall", points: [0, 1, 2, 3].map(function (n) { return pair(pt(n, overall)); }).join(" ") }));

    /* 当前各维度：只连有等级的轴，全部选了“不适用”的维度不参与连线 */
    var valid = r.dimensions.map(function (d, n) { return { axis: n, level: d.level }; }).filter(function (x) { return x.level != null; });
    if (valid.length >= 2) {
      var points = valid.map(function (x) { return pair(pt(x.axis, x.level)); });
      if (valid.length >= 3) {
        svg.appendChild(svgEl("polygon", { class: "radar__area", points: points.join(" ") }));
      } else {
        var a = pt(valid[0].axis, valid[0].level), b = pt(valid[1].axis, valid[1].level);
        svg.appendChild(svgEl("line", { class: "radar__area", x1: a[0], y1: a[1], x2: b[0], y2: b[1] }));
      }
    }
    valid.forEach(function (x) {
      var p = pt(x.axis, x.level);
      svg.appendChild(svgEl("circle", { class: "radar__dot", cx: p[0].toFixed(1), cy: p[1].toFixed(1), r: 4.5 }));
    });

    /* 轴标签：上、右、下、左 */
    var anchor = ["middle", "start", "middle", "end"];
    r.dimensions.forEach(function (d, n) {
      var name = svgEl("text", { class: "radar__label", "text-anchor": anchor[n] }, [document.createTextNode(d.name)]);
      var value = svgEl("text", { class: "radar__value", "text-anchor": anchor[n] }, [document.createTextNode(d.level == null ? "未计入" : levelWord(d.level))]);
      if (n === 0) { name.setAttribute("x", cx); name.setAttribute("y", cy - R - 26); value.setAttribute("x", cx); value.setAttribute("y", cy - R - 10); }
      else if (n === 2) { name.setAttribute("x", cx); name.setAttribute("y", cy + R + 24); value.setAttribute("x", cx); value.setAttribute("y", cy + R + 40); }
      else { var x = n === 1 ? cx + R + 10 : cx - R - 10; name.setAttribute("x", x); name.setAttribute("y", cy - 2); value.setAttribute("x", x); value.setAttribute("y", cy + 14); }
      svg.appendChild(name);
      svg.appendChild(value);
    });
    box.appendChild(svg);

    var legend = el("div", { class: "radar-legend" });
    var keyArea = el("span", { class: "radar-legend__key" }, [node("span", "radar-legend__line"), node("span", "", "当前各维度")]);
    var keyOverall = el("span", { class: "radar-legend__key" }, [node("span", "radar-legend__line radar-legend__line--overall"), node("span", "", "综合等级轮廓（" + r.overall.levelName + "）")]);
    legend.appendChild(keyArea);
    legend.appendChild(keyOverall);
    box.appendChild(legend);
  }

  function gapLine(labelClass, label, text, quote) {
    var line = el("div", { class: "gap-item__line" });
    line.appendChild(node("span", "gap-item__label " + labelClass, label));
    line.appendChild(node("span", "gap-item__text" + (quote ? " gap-item__text--quote" : ""), text));
    return line;
  }

  function renderGap(r) {
    var box = $("report-gap");
    clear(box);
    var level = r.overall.level;
    if (level == null) {
      box.appendChild(emptyCard("circle-stack", "没有可以补的题",
        "所有题目都选了「不适用」。回到问卷，在题目上选出实际等级，这里会列出需要优先补的题。", "回到问卷修改", "back-survey"));
      return;
    }
    if (level === C.MAX_LEVEL) {
      box.appendChild(emptyCard("check-circle", "没有需要补的题", "四个维度都已经是四级。下面的 90 天行动建议可以当作持续优化的方向。", "", ""));
      return;
    }
    r.overall.bottleneckIds.forEach(function (id) {
      var d = dimById(r, id);
      var card = el("section", { class: "card", "aria-labelledby": "gap-" + d.id });
      var header = el("div", { class: "card__header" });
      var title = el("h3", { class: "card__title", id: "gap-" + d.id });
      title.appendChild(node("span", "dim-card__no", d.ordinal));
      title.appendChild(node("span", "", d.name));
      header.appendChild(title);
      var meta = el("span", { class: "card__meta gap__meta" });
      meta.appendChild(el("span", { class: "badge badge--outline", text: levelWord(d.level) }));
      meta.appendChild(icon("arrow-right", "icon--sm"));
      meta.appendChild(el("span", { class: "badge badge--accent", text: levelWord(d.next.level) }));
      header.appendChild(meta);
      card.appendChild(header);
      card.appendChild(el("p", { class: "gap-hint", text: "下面 " + d.next.candidates + " 道题的得分不高于" + levelWord(d.level) +
        "。把其中至少 " + d.next.needRaise + " 道提到" + d.next.levelName + "，这个维度就能达到" + d.next.levelName + "。" }));

      var list = el("ol", { class: "gap-list" });
      d.gap.forEach(function (qid) {
        var it = locate(r, qid).item;
        var li = el("li", { class: "gap-item" });
        var head = el("div", { class: "gap-item__head" });
        head.appendChild(node("span", "gap-item__no", it.q.no));
        head.appendChild(node("span", "gap-item__title", it.q.title));
        if (r.priorityIds.indexOf(qid) !== -1) head.appendChild(el("span", { class: "badge badge--accent", text: "优先" }));
        head.appendChild(el("span", { class: "badge badge--outline", text: "当前" + levelWord(it.score) }));
        li.appendChild(head);
        li.appendChild(gapLine("", "所选：", it.q.options[it.score - 1], true));
        li.appendChild(gapLine("gap-item__label--accent", "建议：", it.q.advice, false));
        list.appendChild(li);
      });
      card.appendChild(list);
      box.appendChild(card);
    });
  }

  function renderPlan(r) {
    var intro = $("plan-intro");
    clear(intro);
    intro.appendChild(document.createTextNode(D.plan.intro));
    if (r.overall.level === C.MAX_LEVEL) {
      intro.appendChild(document.createTextNode(" 四个维度都已是四级，下面三道是得分相对最低的题，可以作为持续优化的方向。"));
    }

    var box = $("report-plan");
    clear(box);
    if (!r.priority.length) {
      box.appendChild(el("p", { class: "plan__note", text: "没有得分有效的题目，暂时给不出行动建议。" }));
      return;
    }

    /* 企业规模只影响这里的措辞，不参与计分 */
    var advice = sizeAdvice();
    var note = el("p", { class: "plan__note" });
    if (advice) {
      note.appendChild(node("span", "strong", "结合企业规模："));
      note.appendChild(document.createTextNode(advice));
    } else {
      note.appendChild(document.createTextNode("填写企业规模后，这里会多一句更贴合企业大小的提示。"));
      note.appendChild(actionButton("btn btn--ghost btn--sm", "填写企业信息", "edit-profile"));
    }
    box.appendChild(note);

    var list = el("ol", { class: "plan" });
    r.priority.forEach(function (p, i) {
      var item = el("li", { class: "card plan__item" });
      var header = el("div", { class: "card__header" });
      var title = el("h3", { class: "card__title" });
      title.appendChild(el("span", { class: "badge badge--accent", text: String(i + 1) }));
      title.appendChild(node("span", "", p.q.no + " " + p.q.title));
      header.appendChild(title);
      header.appendChild(el("span", { class: "card__meta", text: p.dim.name + " · 当前" + levelWord(p.score) }));
      item.appendChild(header);

      var body = el("div", { class: "card__body" });
      D.plan.phases.forEach(function (phase) {
        var step = el("div", { class: "plan__step" });
        var when = el("div", { class: "plan__when" });
        when.appendChild(node("span", "plan__weeks", phase.weeks));
        when.appendChild(node("span", "plan__name", phase.name));
        step.appendChild(when);
        step.appendChild(el("p", { class: "plan__text", text: p.q[phase.key] }));
        body.appendChild(step);
      });
      item.appendChild(body);
      list.appendChild(item);
    });
    box.appendChild(list);
  }

  /* ---------- 方法说明（内容不变，初始化时渲染一次） ---------- */
  function renderMethod() {
    setText($("method-positioning"), D.positioning);
    appendDisclaimer($("method-disclaimer"));

    var dims = $("method-dims");
    D.dimensions.forEach(function (dim) {
      var tr = el("tr");
      var name = el("td");
      name.appendChild(node("span", "strong nowrap", dim.name));
      name.appendChild(node("span", "method-dim-ordinal", "维度" + dim.ordinal));
      tr.appendChild(name);
      tr.appendChild(el("td", null, [node("span", "measure", dim.summary)]));
      tr.appendChild(el("td", { text: dim.questions.map(function (q) { return q.title; }).join("、") }));
      tr.appendChild(el("td", { class: "num", text: String(dim.questions.length) }));
      dims.appendChild(tr);
    });

    var levels = $("method-levels");
    D.levels.forEach(function (l) {
      levels.appendChild(el("tr", null, [
        el("td", null, [node("span", "strong nowrap", l.name)]),
        el("td", { text: l.verdict })
      ]));
    });

    fillRules($("method-rules"));

    var required = $("method-required");
    D.dimensions.forEach(function (dim) {
      var n = dim.questions.length;
      var need = C.requiredCount(n);
      required.appendChild(el("tr", null, [
        el("td", { text: dim.name }),
        el("td", { class: "num", text: n + " 道" }),
        el("td", { class: "num nowrap", text: "至少 " + need + " 道（约 " + Math.round(need / n * 100) + "%）" })
      ]));
    });

    var faq = $("method-faq");
    D.faq.forEach(function (item) {
      faq.appendChild(node("dt", "", item.q));
      faq.appendChild(node("dd", "", item.a));
    });
  }

  /* ---------- 打印、复制、重新评估 ---------- */
  var themeBeforePrint = null;

  function restoreTheme() {
    if (!themeBeforePrint) return;
    document.documentElement.dataset.theme = themeBeforePrint;
    themeBeforePrint = null;
  }

  function printReport() {
    if (!evalNow().complete) return;
    if (state.view !== "report") setView("report");
    window.print();
  }

  function copySummary() {
    var r = evalNow();
    var text = C.buildSummary(r, D, { date: reportDate(), profileLine: profileText(), version: D.version });
    Z.copy(text).then(function () {
      Z.toast("已复制结论摘要", "success");
    }, function () {
      Z.toast("复制失败：浏览器没有允许访问剪贴板。可以改用「打印或另存 PDF」，或在浏览器设置里允许本站使用剪贴板后再试。", "danger", 8000);
    });
  }

  function openReset() {
    var n = evalNow().answered;
    if (!n) {
      Z.toast("还没有作答，不需要清空", "info");
      return;
    }
    setText($("reset-title"), "清空 " + n + " 道题的作答？");
    setText($("reset-body"), (n === TOTAL
      ? TOTAL + " 道题的作答会被全部清空，评估报告也随之失效。"
      : "已答的 " + n + " 道题会被清空。") + "此操作无法撤销，企业信息会保留。");
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

  function editProfile() {
    setView("start", { keepFocus: true });
    var first = $("profile-industry");
    if (first && typeof first.scrollIntoView === "function") first.scrollIntoView({ block: "center" });
    if (first) first.focus({ preventScroll: true });
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
      else if (action === "back-survey") setView("survey");
      else if (action === "edit-profile") editProfile();
    });

    var panel = $("survey-panel");
    panel.addEventListener("change", function (e) {
      var input = e.target;
      if (!input || input.type !== "radio" || !input.checked) return;
      applyAnswer(input);
    });
    panel.addEventListener("keydown", onPanelKeydown);

    $("profile-industry").addEventListener("change", function (e) {
      state.profile.industry = e.target.value;
      save();
      render();
    });
    $("profile-size").addEventListener("change", function (e) {
      state.profile.size = e.target.value;
      save();
      render();
    });

    var heat = $("report-heat");
    heat.addEventListener("pointerover", function (e) {
      if (e.pointerType !== "mouse") return;
      var btn = e.target.closest(".heat__btn");
      if (btn) showReadout(btn.getAttribute("data-q"));
    });
    heat.addEventListener("pointerleave", resetReadout);
    heat.addEventListener("focusin", function (e) {
      var btn = e.target.closest(".heat__btn");
      if (btn) showReadout(btn.getAttribute("data-q"));
    });
    heat.addEventListener("focusout", resetReadout);
    heat.addEventListener("click", function (e) {
      var btn = e.target.closest(".heat__btn");
      if (btn) focusQuestion(btn.getAttribute("data-q"));
    });

    var dialog = $("reset-dialog");
    Array.prototype.forEach.call(dialog.querySelectorAll("[data-close]"), function (b) {
      b.addEventListener("click", function () { Z.closeDialog(dialog); });
    });
    $("reset-confirm").addEventListener("click", confirmReset);

    /* 打印时临时切到浅色：深色底纹打印出来既费墨又难看，打完再切回去 */
    window.addEventListener("beforeprint", function () {
      if (document.documentElement.dataset.theme === "dark") {
        themeBeforePrint = "dark";
        document.documentElement.dataset.theme = "light";
      }
    });
    window.addEventListener("afterprint", restoreTheme);
    window.addEventListener("focus", restoreTheme);
  }

  /* ---------- 启动 ---------- */
  function buildProfileSelects() {
    [["profile-industry", D.profile.industries, "industry"], ["profile-size", D.profile.sizes, "size"]].forEach(function (cfg) {
      var select = $(cfg[0]);
      select.appendChild(el("option", { value: "", text: "暂不填写" }));
      cfg[1].forEach(function (o) { select.appendChild(el("option", { value: o.value, text: o.label })); });
      select.value = state.profile[cfg[2]];
    });
  }

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
    buildTabs();
    buildProfileSelects();
    renderMethod();
    bindEvents();
    renderSurveyPanel();
    render();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
EOF