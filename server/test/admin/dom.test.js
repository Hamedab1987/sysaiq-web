// ui/dom.js h(): on* keys are listeners and nothing else, so a string can
// never become an inline handler attribute (blocked by CSP, but the kit must
// refuse it the way it refuses `html`). Node has no DOM, so a minimal
// document stub stands in — only what h() touches.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

class FakeNode {}
class FakeElement extends FakeNode {
  constructor(tag) {
    super();
    this.tagName = tag.toUpperCase();
    this.attrs = {};
    this.listeners = {};
    this.children = [];
    this.dataset = {};
    this.id = '';
    this.value = '';
    const classes = new Set();
    this.classList = { add: (...c) => c.forEach(x => classes.add(x)), contains: c => classes.has(c), values: () => [...classes] };
  }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  toggleAttribute(k, on) { if (on) this.attrs[k] = ''; else delete this.attrs[k]; }
  addEventListener(evt, fn) { (this.listeners[evt] ||= []).push(fn); }
  appendChild(c) { this.children.push(c); return c; }
}
class FakeText extends FakeNode { constructor(t) { super(); this.text = t; } }
globalThis.Node = FakeNode;
globalThis.document = {
  createElement: tag => new FakeElement(tag),
  createTextNode: t => new FakeText(t),
};

const { h } = await import(pathToFileURL(join(__dirname, '..', '..', 'admin', 'js', 'ui', 'dom.js')).href);

test('h(): a function on* key becomes addEventListener, never an attribute', () => {
  const fn = () => {};
  const el = h('button.a-btn', { type: 'button', onclick: fn, onKeyDown: fn }, 'x');
  assert.deepEqual(el.listeners, { click: [fn], keydown: [fn] });
  assert.equal(el.attrs.onclick, undefined);
  assert.equal(el.attrs.type, 'button');
  assert.deepEqual(el.classList.values(), ['a-btn']);
  assert.equal(el.children[0].text, 'x');
});

test('h(): an on* key with a non-function value throws instead of emitting an inline handler', () => {
  assert.throws(() => h('a', { onclick: 'alert(1)' }), /must be a function/);
  assert.throws(() => h('a', { onclick: 1 }), /must be a function/);
  assert.throws(() => h('a', { onmouseover: {} }), /must be a function/);
  // null/false/undefined are "not set", like every other attribute
  const el = h('a', { onclick: null, onfocus: false, onblur: undefined, href: '#/' });
  assert.deepEqual(el.listeners, {});
  assert.equal(el.attrs.href, '#/');
  // raw html stays refused too
  assert.throws(() => h('div', { html: '<b>x</b>' }), /raw html/);
});

test('h(): attributes that merely start with "on" but are not events are still refused (no on-prefixed attribute exists in HTML)', () => {
  // "one" / "only" are not attributes; refusing them keeps the rule simple and total
  assert.throws(() => h('div', { one: 'x' }), /must be a function/);
});
