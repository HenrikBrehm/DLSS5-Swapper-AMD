'use strict';
// A browser-shaped sandbox, just real enough to load the renderer.
//
// Task 6.2. The AMD port changed src/renderer/renderer.js in 24 tasks without
// the interface ever being opened, so a runtime error in it - a typo, a call
// to something that is not there - would have reached a user unnoticed. Every
// other test in the suite reads the renderer as text; none of them runs it.
//
// This is not a browser and does not pretend to be one. It answers well
// enough that the file can be evaluated and its functions called, and it
// returns HTML strings that can be asserted on. Anything visual still needs a
// person to look at it.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const noop = () => {};
const RECT = Object.freeze({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 });

const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr', 'path', 'circle', 'rect', 'line', 'polyline', 'polygon']);

// Enough of an HTML parse to answer `children` after an `innerHTML` write.
// The renderer builds a row of buttons that way and then addresses them by
// index, so a stub whose children stay empty crashes on the first paint. Only
// the top level is needed; nothing here inspects grandchildren.
function topLevelChildren(html) {
  const found = [];
  let depth = 0;
  const tags = /<(\/?)([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>])*)>/g;
  let match;
  while ((match = tags.exec(html))) {
    const [, slash, name, rest] = match;
    if (slash) { depth = Math.max(0, depth - 1); continue; }
    if (depth === 0) found.push(element(name));
    if (!VOID_TAGS.has(name.toLowerCase()) && !/\/\s*$/.test(rest)) depth += 1;
  }
  return found;
}

// An element that answers anything asked of it. Unknown properties read as a
// no-op function, which is what nearly every DOM call is used for here; the
// properties that carry values are declared so that assignment sticks.
function element(tag = 'div') {
  const own = {
    tagName: String(tag).toUpperCase(),
    style: {}, dataset: {}, children: [], childNodes: [],
    innerHTML: '', outerHTML: '', textContent: '', innerText: '',
    value: '', checked: false, disabled: false, hidden: false, className: '',
    id: '', href: '', src: '', title: '', selectedIndex: 0, scrollTop: 0,
    parentElement: null, parentNode: null, firstChild: null, nextSibling: null,
    classList: { add: noop, remove: noop, toggle: noop, contains: () => false, replace: noop },
    getBoundingClientRect: () => ({ ...RECT }),
    getAttribute: () => null,
    hasAttribute: () => false,
    closest: () => null,
    querySelector: () => element(),
    querySelectorAll: () => [],
    appendChild: (child) => child,
    insertBefore: (child) => child,
    contains: () => false
  };
  return new Proxy(own, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (typeof prop === 'symbol') return undefined;
      return noop;
    },
    set(target, prop, value) {
      target[prop] = value;
      // A real element reparses on write; the renderer relies on that.
      if (prop === 'innerHTML') target.children = topLevelChildren(String(value));
      if (prop === 'textContent') target.children = [];
      return true;
    },
    has() { return true; }
  });
}

function documentStub() {
  const body = element('body');
  return {
    body,
    documentElement: element('html'),
    head: element('head'),
    createElement: (tag) => element(tag),
    createTextNode: () => element('#text'),
    createDocumentFragment: () => element('#fragment'),
    getElementById: () => element(),
    querySelector: () => element(),
    querySelectorAll: () => [],
    getElementsByClassName: () => [],
    addEventListener: noop,
    removeEventListener: noop,
    execCommand: noop,
    hasFocus: () => true,
    activeElement: null,
    visibilityState: 'visible',
    readyState: 'complete'
  };
}

// What the main process answers on the way up. Only the calls the boot
// sequence actually reads are spelled out; everything else gets an empty
// object, which is enough to be destructured from without throwing.
const BOOT_ANSWERS = Object.freeze({
  boot: () => ({ theme: 'light', lang: 'en', version: '0.0.0-test', groupGamesByStore: true }),
  artStatus: () => ({ available: false }),
  library: () => [],
  recents: () => [],
  history: () => [],
  details: () => ({ newDlss: null }),
  checkUpdate: () => null
});

// The preload bridges. Every call answers, nothing does anything. Handlers the
// renderer registers are kept so a test can fire one if it wants to.
function bridge(handlers, answers = BOOT_ANSWERS) {
  return new Proxy({}, {
    get(_target, prop) {
      if (typeof prop === 'symbol') return undefined;
      return (...args) => {
        if (/^on[A-Z]/.test(prop) && typeof args[0] === 'function') {
          (handlers[prop] ||= []).push(args[0]);
          return noop;
        }
        const answer = Object.hasOwn(answers, prop) ? answers[prop](...args) : {};
        return Promise.resolve(answer);
      };
    },
    has() { return true; }
  });
}

const SRC = path.join(__dirname, '..', '..', 'src');
// The load order of src/renderer/index.html. renderer.js comes last because
// everything before it is what it reads on the way up.
const SCRIPTS = Object.freeze([
  'renderer/i18n.js', 'renderer/i18n-extra.js', 'shared/feature-i18n.js',
  'renderer/game-filters.js', 'renderer/mentions.js', 'renderer/ask.js', 'renderer/cheer.js',
  'shared/install-routes.js', 'shared/rendering-api.js'
]);

// Loads the renderer stack and hands back the context, so a test can call the
// functions inside it by name. `extra` is merged into the sandbox before any
// script runs, which is how a test substitutes a bridge or a stub.
function loadRenderer(extra = {}) {
  const handlers = {};
  const sandbox = {
    console, setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask,
    Promise, Intl, URL, URLSearchParams, TextEncoder, TextDecoder, structuredClone,
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    cancelAnimationFrame: clearTimeout,
    fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({}), text: () => Promise.resolve('') }),
    document: documentStub(),
    navigator: { language: 'en-GB', languages: ['en-GB'], clipboard: { writeText: () => Promise.resolve() }, onLine: true },
    location: { href: 'app://renderer/index.html', hash: '', search: '' },
    localStorage: (() => {
      const store = new Map();
      return {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => store.set(k, String(v)),
        removeItem: (k) => store.delete(k),
        clear: () => store.clear()
      };
    })(),
    matchMedia: () => ({ matches: false, addEventListener: noop, removeEventListener: noop, addListener: noop }),
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    addEventListener: noop, removeEventListener: noop,
    alert: noop, confirm: () => true, prompt: () => null,
    ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
    IntersectionObserver: class { observe() {} unobserve() {} disconnect() {} },
    MutationObserver: class { observe() {} disconnect() {} },
    Image: class { set src(_v) {} },
    handlers
  };
  // In a browser `window` is the global itself. Keeping that true means the
  // renderer's own `window.refreshSheet = ...` lands where it expects.
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  for (const name of ['lab', 'api', 'communityUi', 'overlayLab', 'chatUi', 'overlaySurface']) {
    sandbox[name] = bridge(handlers);
  }
  Object.assign(sandbox, extra);

  vm.createContext(sandbox);
  for (const file of SCRIPTS) {
    vm.runInContext(fs.readFileSync(path.join(SRC, file), 'utf8'), sandbox, { filename: file });
  }
  vm.runInContext(fs.readFileSync(path.join(SRC, 'renderer/renderer.js'), 'utf8'), sandbox, { filename: 'renderer/renderer.js' });
  return sandbox;
}

// Call a function declared at the top level of renderer.js. Lexical `const`
// declarations do not land on the global object, so the call is evaluated
// inside the context rather than reached for from outside.
function call(context, expression, args = []) {
  context.__args = args;
  return vm.runInContext(`(${expression})(...__args)`, context, { filename: 'call' });
}

// The renderer boots asynchronously. Waiting a few macrotasks lets that
// finish, so a rejection in it surfaces as a failure here rather than as an
// unhandled rejection that takes the whole run down.
async function settle(ticks = 8) {
  for (let i = 0; i < ticks; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

module.exports = { loadRenderer, call, settle, element, documentStub, bridge, topLevelChildren, SCRIPTS };
