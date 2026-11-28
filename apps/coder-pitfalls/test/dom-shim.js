/* ============================================================================
   一个只够用的小型 DOM，给界面逻辑的冒烟测试用（不依赖任何第三方库）。
   它只实现 app.js 和 design/shared.js 实际用到的那部分接口：
   - 解析本应用的 index.html，生成一棵可以查询的元素树
   - querySelector / querySelectorAll / closest / matches（支持标签、#id、.class、[attr]、[attr="v"]、后代与 > 组合）
   - classList、hidden、disabled、textContent、style、事件冒泡、焦点
   - 可控的时钟（setTimeout 可以手动推进），用来验证“停留 5 秒自动标已读”
   ========================================================================== */
'use strict';

const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);

function decodeEntities(text) {
  return text.replace(/&(?:#x([0-9a-f]+)|#(\d+)|(amp|lt|gt|quot|nbsp|#39));/gi, (whole, hex, dec, name) => {
    if (hex) return String.fromCodePoint(parseInt(hex, 16));
    if (dec) return String.fromCodePoint(parseInt(dec, 10));
    return { amp: '&', lt: '<', gt: '>', quot: '"', nbsp: '\u00a0', '#39': "'" }[name.toLowerCase()];
  });
}

class ShimNode {
  constructor() {
    this.parentNode = null;
    this.childNodes = [];
    this.listeners = Object.create(null);
  }
  get firstChild() { return this.childNodes[0] || null; }
  get lastChild() { return this.childNodes[this.childNodes.length - 1] || null; }
  get lastElementChild() { return this.children[this.children.length - 1] || null; }
  get children() { return this.childNodes.filter((n) => n.nodeType === 1); }
  appendChild(node) {
    if (node.nodeType === 11) {
      node.childNodes.slice().forEach((child) => this.appendChild(child));
      node.childNodes = [];
      return node;
    }
    if (node.parentNode) node.parentNode.removeChild(node);
    node.parentNode = this;
    this.childNodes.push(node);
    return node;
  }
  removeChild(node) {
    const i = this.childNodes.indexOf(node);
    if (i >= 0) {
      this.childNodes.splice(i, 1);
      node.parentNode = null;
    }
    return node;
  }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  contains(node) {
    for (let n = node; n; n = n.parentNode) if (n === this) return true;
    return false;
  }
  addEventListener(type, fn) {
    (this.listeners[type] = this.listeners[type] || []).push(fn);
  }
  removeEventListener(type, fn) {
    this.listeners[type] = (this.listeners[type] || []).filter((f) => f !== fn);
  }
}

class ShimText extends ShimNode {
  constructor(data) {
    super();
    this.nodeType = 3;
    this.data = data;
  }
  get textContent() { return this.data; }
  set textContent(value) { this.data = String(value); }
}

class ShimElement extends ShimNode {
  constructor(tagName) {
    super();
    this.nodeType = 1;
    this.tagName = tagName.toUpperCase();
    this.attributes = Object.create(null);
    this.style = Object.create(null);
    this.dataset = Object.create(null);
    this.scrollTop = 0;
    this.scrollHeight = 0;
    this.clientHeight = 0;
    this.isContentEditable = false;
  }
  get className() { return this.attributes.class || ''; }
  set className(value) { this.attributes.class = String(value); }
  get classList() {
    if (this._classList) return this._classList;
    const self = this;
    const read = () => new Set(self.className.split(/\s+/).filter(Boolean));
    const write = (set) => { self.className = Array.from(set).join(' '); };
    return (this._classList = {
      add: (...names) => { const set = read(); names.forEach((n) => set.add(n)); write(set); },
      remove: (...names) => { const set = read(); names.forEach((n) => set.delete(n)); write(set); },
      contains: (name) => read().has(name),
      toggle: (name, force) => {
        const set = read();
        const has = force === undefined ? !set.has(name) : !!force;
        if (has) set.add(name); else set.delete(name);
        write(set);
        return has;
      }
    });
  }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return name in this.attributes ? this.attributes[name] : null; }
  hasAttribute(name) { return name in this.attributes; }
  removeAttribute(name) { delete this.attributes[name]; }
  get id() { return this.attributes.id || ''; }
  get hidden() { return this.hasAttribute('hidden'); }
  set hidden(value) { if (value) this.setAttribute('hidden', ''); else this.removeAttribute('hidden'); }
  get disabled() { return this.hasAttribute('disabled'); }
  set disabled(value) { if (value) this.setAttribute('disabled', ''); else this.removeAttribute('disabled'); }
  get textContent() { return this.childNodes.map((n) => n.textContent).join(''); }
  set textContent(value) {
    this.childNodes.slice().forEach((n) => { n.parentNode = null; });
    this.childNodes = [];
    if (value != null && value !== '') this.appendChild(new ShimText(String(value)));
  }
  set innerHTML(html) {
    this.textContent = '';
    this.appendChild(parseFragment(String(html)));
  }
  matches(selector) { return splitSelectors(selector).some((tokens) => matchChain(this, tokens)); }
  closest(selector) {
    for (let node = this; node && node.nodeType === 1; node = node.parentNode) {
      if (node.matches(selector)) return node;
    }
    return null;
  }
  querySelectorAll(selector) {
    const found = [];
    walkDescendants(this, (node) => {
      if (node !== this && node.nodeType === 1 && node.matches(selector)) found.push(node);
    });
    return found;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  focus() { document.activeElement = this; }
  blur() { if (document.activeElement === this) document.activeElement = null; }
  scrollIntoView() { this.scrolledIntoView = (this.scrolledIntoView || 0) + 1; }
  getBoundingClientRect() { return { top: 0, bottom: 480, left: 0, right: 320, width: 320, height: 480 }; }
  click() { return dispatch(this, 'click'); }
  select() { this.selected = true; }
}

class ShimFragment extends ShimElement {
  constructor() {
    super('#fragment');
    this.nodeType = 11;
  }
}

/* ---------- 选择器 ---------- */
function splitSelectors(selector) {
  return selector.split(',').map((part) => part.trim().split(/\s+/)).filter((tokens) => tokens.length && tokens[0] !== '');
}

function matchCompound(element, compound) {
  const re = /^([a-zA-Z][\w-]*|\*)?((?:[#.][\w-]+|\[[^\]]+\])*)$/;
  const m = re.exec(compound);
  if (!m) throw new Error('测试用的选择器写法不支持：' + compound);
  if (m[1] && m[1] !== '*' && element.tagName !== m[1].toUpperCase()) return false;
  const rest = m[2] || '';
  const partRe = /#([\w-]+)|\.([\w-]+)|\[([\w-]+)(?:=["']([^"']*)["'])?\]/g;
  let p;
  while ((p = partRe.exec(rest))) {
    if (p[1]) { if (element.id !== p[1]) return false; }
    else if (p[2]) { if (!element.classList.contains(p[2])) return false; }
    else if (p[3]) {
      const has = element.hasAttribute(p[3]);
      if (!has) return false;
      if (p[4] !== undefined && element.getAttribute(p[3]) !== p[4]) return false;
    }
  }
  return true;
}

function matchChain(element, tokens) {
  let i = tokens.length - 1;
  if (typeof tokens[i] === 'string' && tokens[i] === '>') return false;
  if (!matchCompound(element, tokens[i])) return false;
  let node = element;
  i -= 1;
  while (i >= 0) {
    if (tokens[i] === '>') {
      node = node.parentNode;
      if (!node || node.nodeType !== 1) return false;
      i -= 1;
      continue;
    }
    node = node.parentNode;
    while (node && node.nodeType === 1 && !matchCompound(node, tokens[i])) node = node.parentNode;
    if (!node || node.nodeType !== 1) return false;
    i -= 1;
  }
  return true;
}

function walkDescendants(root, fn) {
  root.childNodes.forEach((child) => {
    fn(child);
    if (child.childNodes) walkDescendants(child, fn);
  });
}

/* ---------- 解析 ---------- */
const TAG_RE = /<!--[\s\S]*?-->|<!DOCTYPE[^>]*>|<\/([a-zA-Z][^\s>]*)\s*>|<([a-zA-Z][^\s/>]*)((?:\s+[^\s"'>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*)\s*(\/?)>|([^<]+)|(<)/g;
const ATTR_RE = /([^\s"'=\/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;

function parseInto(parent, html) {
  let node = parent;
  let match;
  TAG_RE.lastIndex = 0;
  while ((match = TAG_RE.exec(html))) {
    if (match[1]) {
      // 结束标签：回到最近一个同名祖先的父节点
      for (let cur = node; cur && cur !== parent; cur = cur.parentNode) {
        if (cur.nodeType === 1 && cur.tagName === match[1].toUpperCase()) { node = cur.parentNode; break; }
      }
    } else if (match[2]) {
      const element = new ShimElement(match[2]);
      const selfClosing = match[4] === '/';
      ATTR_RE.lastIndex = 0;
      let attr;
      while ((attr = ATTR_RE.exec(match[3] || ''))) {
        element.setAttribute(attr[1], decodeEntities(attr[2] != null ? attr[2] : attr[3] != null ? attr[3] : attr[4] != null ? attr[4] : ''));
      }
      node.appendChild(element);
      if (!selfClosing && !VOID_TAGS.has(match[2].toLowerCase())) node = element;
    } else if (match[5] != null) {
      if (node.nodeType === 1 && /^(SCRIPT|STYLE)$/.test(node.tagName)) node.appendChild(new ShimText(match[5]));
      else if (match[5].trim()) node.appendChild(new ShimText(decodeEntities(match[5])));
    } else if (match[6]) {
      node.appendChild(new ShimText('<'));
    }
  }
  // 没闭合的标签统一收回到起点，避免测试因书写问题误判
  return parent;
}

function parseFragment(html) {
  return parseInto(new ShimFragment(), html);
}

/* ---------- 事件 ---------- */
let document;

function dispatch(target, type, init) {
  const event = Object.assign({
    type,
    target,
    defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; }
  }, init || {});
  // 事件从目标一路冒泡到 document；目标就是 document 时只走 document 这一层
  const chain = [];
  for (let node = target; node && node !== document; node = node.parentNode) chain.push(node);
  chain.push(document);
  chain.forEach((node) => {
    (node.listeners[type] || []).slice().forEach((fn) => fn.call(node, event));
  });
  return !event.defaultPrevented;
}

/* ---------- 组装一个 window ---------- */
function createWindow(html, initialStorage) {
  const clock = { now: 0, seq: 0, timers: new Map() };
  const storage = initialStorage || new Map();
  const mq = { narrow: false, listeners: [] };
  const handle = { toasts: [], copied: null, copyShouldFail: false, scrolledTo: [] };

  const root = new ShimFragment();
  parseInto(root, html);
  const htmlElement = root.children.find((c) => c.tagName === 'HTML') || new ShimElement('html');

  document = {
    nodeType: 9,
    readyState: 'complete',
    hidden: false,
    activeElement: null,
    documentElement: htmlElement,
    body: htmlElement.children.find((c) => c.tagName === 'BODY') || new ShimElement('body'),
    listeners: Object.create(null),
    createElement: (tag) => new ShimElement(tag),
    createElementNS: (ns, tag) => new ShimElement(tag),
    createTextNode: (data) => new ShimText(String(data)),
    createDocumentFragment: () => new ShimFragment(),
    getElementById(id) {
      let found = null;
      walkDescendants(htmlElement, (n) => { if (!found && n.nodeType === 1 && n.id === id) found = n; });
      return found;
    },
    querySelectorAll(selector) { return htmlElement.querySelectorAll(selector); },
    querySelector(selector) { return htmlElement.querySelector(selector); },
    addEventListener(type, fn) { (document.listeners[type] = document.listeners[type] || []).push(fn); },
    execCommand() { return !handle.copyShouldFail; }
  };
  document.body.parentNode = htmlElement;

  function setTimeoutShim(fn, ms) {
    clock.seq += 1;
    clock.timers.set(clock.seq, { at: clock.now + (ms || 0), fn });
    return clock.seq;
  }
  function clearTimeoutShim(id) { clock.timers.delete(id); }
  function advance(ms) {
    const end = clock.now + ms;
    for (;;) {
      const due = Array.from(clock.timers.entries()).filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      clock.now = due[1].at;
      clock.timers.delete(due[0]);
      due[1].fn();
    }
    clock.now = end;
  }

  const window = {
    document,
    console,
    isSecureContext: true,
    innerHeight: 800,
    innerWidth: 1280,
    navigator: {
      clipboard: {
        writeText(text) {
          if (handle.copyShouldFail) return Promise.reject(new Error('NotAllowedError'));
          handle.copied = text;
          return Promise.resolve();
        }
      }
    },
    localStorage: {
      getItem: (k) => (storage.has(k) ? storage.get(k) : null),
      setItem: (k, v) => storage.set(k, String(v)),
      removeItem: (k) => storage.delete(k)
    },
    matchMedia(query) {
      return {
        media: query,
        get matches() { return mq.narrow; },
        addEventListener(type, fn) { mq.listeners.push(fn); },
        removeEventListener() {}
      };
    },
    setTimeout: setTimeoutShim,
    clearTimeout: clearTimeoutShim,
    requestAnimationFrame: (fn) => setTimeoutShim(fn, 0),
    cancelAnimationFrame: (id) => clearTimeoutShim(id),
    scrollTo(x, y) { handle.scrolledTo.push([x, y]); },
    addEventListener(type, fn) { (document.listeners['window:' + type] = document.listeners['window:' + type] || []).push(fn); }
  };

  // 浏览器里 window 和 self 都指向全局对象本身
  window.window = window;
  window.self = window;

  handle.window = window;
  handle.document = document;
  handle.advance = advance;
  handle.storage = storage;
  handle.mq = mq;
  handle.setNarrow = (value) => {
    mq.narrow = value;
    mq.listeners.slice().forEach((fn) => fn({ matches: value }));
  };
  handle.press = (key, target, init) => dispatch(target || document.activeElement || document.body, 'keydown', Object.assign({ key }, init || {}));
  handle.dispatch = dispatch;
  return handle;
}

module.exports = { createWindow, dispatch };
