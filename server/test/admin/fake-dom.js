// A tiny DOM stand-in for exercising the admin kit's field/form logic under
// node:test (no jsdom dependency). Only what makeField / field / selectField /
// repeater / createForm touch: element tree, class list, dataset, attributes,
// focus tracking and a selector engine for the few forms the kit uses
// (`input,textarea,select,button`, `.a-rep__idx`, `[data-move]`,
// `button[type="submit"]`). Import it before the kit modules.
class FakeNode {
  constructor() { this.parentNode = null; }
  get parentElement() { return this.parentNode; }
  remove() { this.parentNode?.removeChild(this); }
}
class FakeText extends FakeNode {
  constructor(text) { super(); this.nodeType = 3; this.data = String(text); }
  get textContent() { return this.data; }
  set textContent(v) { this.data = String(v); }
}
const SIMPLE = /^([a-z][a-z0-9-]*)?((?:[.#][\w-]+|\[[\w-]+(?:="[^"]*")?\])*)$/i;
function compileSimple(sel) {
  const m = SIMPLE.exec(sel.trim());
  if (!m) throw new Error(`fake-dom: unsupported selector "${sel}"`);
  const tag = m[1] ? m[1].toUpperCase() : null;
  const tests = [];
  for (const part of (m[2] || '').match(/[.#][\w-]+|\[[\w-]+(?:="[^"]*")?\]/g) || []) {
    if (part[0] === '.') tests.push(el => el.classList.contains(part.slice(1)));
    else if (part[0] === '#') tests.push(el => el.id === part.slice(1));
    else {
      const [, name, value] = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(part);
      tests.push(el => (value === undefined ? el.hasAttribute(name) : el.getAttribute(name) === value));
    }
  }
  return el => (!tag || el.tagName === tag) && tests.every(t => t(el));
}
const compile = sel => { const list = String(sel).split(',').map(compileSimple); return el => list.some(t => t(el)); };

class FakeElement extends FakeNode {
  constructor(tag) {
    super();
    this.nodeType = 1;
    this.tagName = String(tag).toUpperCase();
    this.attrs = {};
    this.listeners = {};
    this.childNodes = [];
    this.dataset = {};
    this.id = '';
    this.disabled = false;
    this.hidden = false;
    this._value = '';
    this.selectedIndex = -1;
    const classes = new Set();
    this.classList = {
      add: (...c) => c.forEach(x => classes.add(x)),
      remove: (...c) => c.forEach(x => classes.delete(x)),
      contains: c => classes.has(c),
      toggle: (c, force) => { const on = force === undefined ? !classes.has(c) : !!force; if (on) classes.add(c); else classes.delete(c); return on; },
      values: () => [...classes],
    };
  }
  // <select>: value snaps to an existing <option>, like the real thing
  get options() { return this.tagName === 'SELECT' ? this.children.filter(c => c.tagName === 'OPTION') : undefined; }
  get value() { return this._value; }
  set value(v) {
    const s = v === null || v === undefined ? '' : String(v);
    if (this.tagName === 'SELECT') { const i = this.options.findIndex(o => o.value === s); this.selectedIndex = i; this._value = i >= 0 ? s : ''; return; }
    this._value = s;
  }
  get children() { return this.childNodes.filter(c => c.nodeType === 1); }
  get firstChild() { return this.childNodes[0] || null; }
  get textContent() { return this.childNodes.map(c => c.textContent).join(''); }
  set textContent(v) { this.childNodes.length = 0; if (v !== '') this.appendChild(new FakeText(v)); }
  setAttribute(k, v) { this.attrs[k] = String(v); if (k.startsWith('data-')) this.dataset[k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = String(v); }
  getAttribute(k) { if (k.startsWith('data-')) { const d = this.dataset[k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())]; return d === undefined ? null : d; } return Object.hasOwn(this.attrs, k) ? this.attrs[k] : null; }
  hasAttribute(k) { return this.getAttribute(k) !== null; }
  removeAttribute(k) { delete this.attrs[k]; }
  toggleAttribute(k, on) { if (on) this.attrs[k] = ''; else delete this.attrs[k]; }
  addEventListener(evt, fn) { (this.listeners[evt] ||= []).push(fn); }
  removeEventListener(evt, fn) { this.listeners[evt] = (this.listeners[evt] || []).filter(f => f !== fn); }
  dispatchEvent() { return true; }
  appendChild(c) { c.remove(); c.parentNode = this; this.childNodes.push(c); return c; }
  append(...nodes) { for (const n of nodes) this.appendChild(n instanceof FakeNode ? n : new FakeText(n)); }
  insertBefore(c, ref) { c.remove(); c.parentNode = this; const i = ref ? this.childNodes.indexOf(ref) : -1; if (i < 0) this.childNodes.push(c); else this.childNodes.splice(i, 0, c); return c; }
  removeChild(c) { const i = this.childNodes.indexOf(c); if (i >= 0) { this.childNodes.splice(i, 1); c.parentNode = null; } return c; }
  replaceChildren(...nodes) { for (const c of [...this.childNodes]) this.removeChild(c); this.append(...nodes); }
  contains(n) { for (let x = n; x; x = x.parentNode) if (x === this) return true; return false; }
  matches(sel) { return compile(sel)(this); }
  closest(sel) { const t = compile(sel); for (let x = this; x && x.nodeType === 1; x = x.parentNode) if (t(x)) return x; return null; }
  querySelectorAll(sel) { const t = compile(sel); const out = []; const walk = n => { for (const c of n.childNodes) { if (c.nodeType !== 1) continue; if (t(c)) out.push(c); walk(c); } }; walk(this); return out; }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  focus() { globalThis.document.activeElement = this; }
  blur() { if (globalThis.document.activeElement === this) globalThis.document.activeElement = null; }
  scrollIntoView() {}
  click() { for (const fn of this.listeners.click || []) fn({ target: this, preventDefault() {} }); }
}

export function installFakeDom() {
  const document = {
    activeElement: null,
    body: new FakeElement('body'),
    head: new FakeElement('head'),
    createElement: tag => new FakeElement(tag),
    createElementNS: (_ns, tag) => new FakeElement(tag),
    createTextNode: t => new FakeText(t),
    createDocumentFragment: () => new FakeElement('#fragment'),
    getElementById: () => null,
    querySelector: () => null,
    addEventListener() {},
    removeEventListener() {},
  };
  globalThis.document = document;
  globalThis.Node = FakeNode;
  globalThis.Element = FakeElement;
  globalThis.HTMLElement = FakeElement;
  globalThis.HTMLInputElement = FakeElement;
  globalThis.window = globalThis.window || { addEventListener() {}, removeEventListener() {}, scrollTo() {} };
  return { document, FakeElement, FakeText };
}

export { FakeElement, FakeText, FakeNode };
