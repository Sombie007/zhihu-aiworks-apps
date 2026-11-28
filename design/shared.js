/* ============================================================================
   公共脚本：主题切换、轻提示、工具箱互链、下载与复制
   全部挂在 window.ZDX 上，各应用按需调用。纯原生 JS，无外部依赖。
   ========================================================================== */
(function () {
  "use strict";

  var THEME_KEY = "zdx-theme";

  /* 工具箱成员：互相导流。改动线上地址时只改这里。 */
  var TOOLBOX = [
    { id: "table-cleaner", name: "表格清洗", url: "https://shimmering-boba-ee233b.netlify.app/", desc: "粘贴或上传表格，去重、补空、规范化，导出干净 CSV" },
    { id: "digital-maturity", name: "数字化成熟度自评", url: "https://euphonious-capybara-1038b2.netlify.app/", desc: "对照四个维度，定位企业数字化所处等级" },
    { id: "pmp-assistant", name: "PMP 助手", url: "https://jovial-stardust-dc4e72.netlify.app/", desc: "考试大纲速查、挣值计算、风险登记册、考点速记" },
    { id: "coder-pitfalls", name: "程序员避坑指南", url: "https://comforting-gelato-8e73f3.netlify.app/", desc: "企业级项目里真实踩过的坑，按主题检索" }
  ];

  var MAKER = { name: "折向东", url: "https://www.zhihu.com/people/xdong-she" };

  /* ---------- 主题 ---------- */
  function currentTheme() {
    return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
  }

  function setTheme(theme, persist) {
    document.documentElement.dataset.theme = theme === "dark" ? "dark" : "light";
    if (persist) {
      try { localStorage.setItem(THEME_KEY, theme); } catch (e) { /* 隐私模式下忽略 */ }
    }
    document.querySelectorAll("[data-theme-toggle]").forEach(function (btn) {
      var dark = theme === "dark";
      btn.setAttribute("aria-pressed", String(dark));
      btn.setAttribute("aria-label", dark ? "切换到浅色外观" : "切换到深色外观");
      btn.setAttribute("title", dark ? "切换到浅色外观" : "切换到深色外观");
      // 深色时显示太阳（点了变亮），浅色时显示月亮（点了变暗）
      var use = btn.querySelector("use");
      if (use) use.setAttribute("href", dark ? "#i-sun" : "#i-moon");
    });
  }

  function toggleTheme() {
    setTheme(currentTheme() === "dark" ? "light" : "dark", true);
  }

  /* ---------- 轻提示 ---------- */
  var ICONS = {
    info: "information-circle",
    success: "check-circle",
    warning: "exclamation-triangle",
    danger: "exclamation-circle"
  };

  function ensureToastRegion() {
    var region = document.querySelector(".toast-region");
    if (!region) {
      region = document.createElement("div");
      region.className = "toast-region";
      region.setAttribute("role", "status");
      region.setAttribute("aria-live", "polite");
      document.body.appendChild(region);
    }
    return region;
  }

  /** 弹出一条轻提示。kind: info | success | warning | danger；duration 毫秒，0 表示不自动消失 */
  function toast(message, kind, duration) {
    kind = ICONS[kind] ? kind : "info";
    duration = duration == null ? 3200 : duration;
    var region = ensureToastRegion();
    var el = document.createElement("div");
    el.className = "toast toast--" + kind;
    el.setAttribute("role", kind === "info" ? "status" : "alert");
    el.innerHTML =
      '<svg class="icon" aria-hidden="true"><use href="#i-' + ICONS[kind] + '"/></svg><span></span>';
    el.lastElementChild.textContent = message;
    region.appendChild(el);
    if (duration > 0) {
      setTimeout(function () {
        el.classList.add("is-leaving");
        setTimeout(function () { el.remove(); }, 260);
      }, duration);
    }
    return el;
  }

  /* ---------- 下载 / 复制 ---------- */
  function download(filename, content, mime) {
    var blob = new Blob([content], { type: mime || "text/plain;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy") ? resolve() : reject(new Error("copy failed"));
      } catch (e) {
        reject(e);
      } finally {
        ta.remove();
      }
    });
  }

  /* ---------- 本地存储（带命名空间，隐私模式下静默降级） ---------- */
  function store(ns) {
    var prefix = "zdx:" + ns + ":";
    return {
      get: function (key, fallback) {
        try {
          var raw = localStorage.getItem(prefix + key);
          return raw == null ? fallback : JSON.parse(raw);
        } catch (e) { return fallback; }
      },
      set: function (key, value) {
        try { localStorage.setItem(prefix + key, JSON.stringify(value)); return true; } catch (e) { return false; }
      },
      remove: function (key) {
        try { localStorage.removeItem(prefix + key); } catch (e) { /* 忽略 */ }
      }
    };
  }

  /* ---------- 小工具 ---------- */
  function fmt(n) {
    return Number(n).toLocaleString("zh-CN");
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === "class") node.className = attrs[k];
        else if (k === "text") node.textContent = attrs[k];
        else if (k === "html") node.innerHTML = attrs[k];
        else node.setAttribute(k, attrs[k]);
      });
    }
    (children || []).forEach(function (c) { if (c) node.appendChild(c); });
    return node;
  }

  function icon(name, cls) {
    var ns = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(ns, "svg");
    svg.setAttribute("class", "icon" + (cls ? " " + cls : ""));
    svg.setAttribute("aria-hidden", "true");
    var use = document.createElementNS(ns, "use");
    use.setAttribute("href", "#i-" + name);
    svg.appendChild(use);
    return svg;
  }

  /* ---------- 对话框：打开带焦点的原生 dialog，关闭后把焦点还回去 ---------- */
  function openDialog(dialog) {
    if (!dialog) return;
    dialog._opener = document.activeElement;
    dialog.showModal();
  }

  function closeDialog(dialog) {
    if (!dialog || !dialog.open) return;
    dialog.close();
    if (dialog._opener && typeof dialog._opener.focus === "function") dialog._opener.focus();
  }

  /* ---------- 工具箱菜单：填充所有 [data-toolbox] 容器 ---------- */
  var SVG_NS = "http://www.w3.org/2000/svg";

  function brandMark(id, size) {
    var svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "brand-mark");
    svg.setAttribute("style", "width:" + size + "px;height:" + size + "px");
    svg.setAttribute("aria-hidden", "true");
    var use = document.createElementNS(SVG_NS, "use");
    use.setAttribute("href", "#logo-" + id);
    svg.appendChild(use);
    return svg;
  }

  function renderToolbox(currentId) {
    document.querySelectorAll("[data-toolbox]").forEach(function (box) {
      box.textContent = "";
      TOOLBOX.forEach(function (tool) {
        if (tool.id === currentId) return;
        var a = document.createElement("a");
        a.className = "nav__item";
        a.href = tool.url;
        a.title = tool.desc;
        a.appendChild(brandMark(tool.id, 20));
        var span = document.createElement("span");
        span.className = "nav__item-text";
        span.textContent = tool.name;
        a.appendChild(span);
        a.appendChild(icon("arrow-top-right-on-square", "icon--sm"));
        box.appendChild(a);
      });
    });
  }

  /* ---------- 启动 ---------- */
  function init() {
    setTheme(currentTheme(), false);
    document.querySelectorAll("[data-theme-toggle]").forEach(function (btn) {
      if (!btn.hasAttribute("aria-pressed")) btn.setAttribute("aria-pressed", "false");
      btn.addEventListener("click", toggleTheme);
    });
    document.querySelectorAll("[data-maker]").forEach(function (node) {
      node.textContent = MAKER.name;
      if (node.tagName === "A") node.href = MAKER.url;
    });
    renderToolbox(document.documentElement.dataset.app);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

  window.ZDX = {
    toolbox: TOOLBOX,
    theme: { get: currentTheme, set: setTheme, toggle: toggleTheme },
    toast: toast,
    download: download,
    copy: copyText,
    store: store,
    fmt: fmt,
    esc: esc,
    el: el,
    icon: icon,
    openDialog: openDialog,
    closeDialog: closeDialog
  };
})();
