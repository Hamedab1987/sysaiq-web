// DOM helpers. No innerHTML with data anywhere in the kit: text always goes
// through text nodes, so nothing a visitor typed can become markup.
//   h('div.a-card', { class: ['x', cond && 'y'], dataset: { id }, onclick: fn }, 'text', child, [more])
//   frag(a, b) · clear(el) · on(root, 'click', '[data-act]', (e, target) => …) → off()
//   icon('trash', { size: 'sm', label: 'حذف' }) · useStyles('view-x', css)

const SELECTOR = /^([a-z][a-z0-9-]*)?((?:[.#][\w-]+)*)$/i;

function appendChild(el, child) {
  if (child === null || child === undefined || child === false || child === true) return;
  if (Array.isArray(child)) { for (const c of child) appendChild(el, c); return; }
  if (child instanceof Node) { el.appendChild(child); return; }
  el.appendChild(document.createTextNode(String(child)));
}

export function h(tag, attrs, ...children) {
  if (attrs !== null && attrs !== undefined && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) {
    children.unshift(attrs); attrs = null;
  }
  const m = SELECTOR.exec(tag || 'div');
  if (!m) throw new Error(`h(): bad tag "${tag}"`);
  const el = document.createElement(m[1] || 'div');
  const classes = [];
  for (const part of (m[2] || '').match(/[.#][\w-]+/g) || []) {
    if (part[0] === '#') el.id = part.slice(1); else classes.push(part.slice(1));
  }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class' || k === 'className') { classes.push(...(Array.isArray(v) ? v : String(v).split(/\s+/)).filter(Boolean)); continue; }
    if (k === 'dataset') { for (const [dk, dv] of Object.entries(v)) if (dv !== undefined && dv !== null) el.dataset[dk] = String(dv); continue; }
    if (k === 'text') { el.textContent = String(v); continue; }
    if (k === 'html') throw new Error('h(): raw html is not allowed — build nodes instead');
    if (k === 'ref' && typeof v === 'function') { v(el); continue; }
    // on* is always a listener; a string here would become an inline handler attribute
    if (/^on[a-z]/i.test(k)) {
      if (typeof v !== 'function') throw new Error(`h(): "${k}" must be a function — inline handlers are not allowed`);
      el.addEventListener(k.slice(2).toLowerCase(), v);
      continue;
    }
    if (k === 'value' && ('value' in el)) { el.value = v; continue; }
    if (k === 'checked' || k === 'selected' || k === 'indeterminate') { el[k] = !!v; continue; }
    if (typeof v === 'boolean') { el.toggleAttribute(k, v); continue; }
    el.setAttribute(k === 'htmlFor' ? 'for' : k, String(v));
  }
  if (classes.length) el.classList.add(...classes);
  for (const c of children) appendChild(el, c);
  return el;
}

// SVG namespace variant for hand-built graphics (progress ring)
export function svg(tag, attrs, ...children) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.setAttribute('class', Array.isArray(v) ? v.filter(Boolean).join(' ') : String(v));
    else el.setAttribute(k, String(v));
  }
  for (const c of children) appendChild(el, c);
  return el;
}

export function frag(...children) {
  const f = document.createDocumentFragment();
  for (const c of children) appendChild(f, c);
  return f;
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

export function replace(el, ...children) {
  clear(el);
  for (const c of children) appendChild(el, c);
  return el;
}

// delegated listener; selector optional. Returns the remover.
export function on(root, evt, selector, fn, opts) {
  if (typeof selector === 'function') { opts = fn; fn = selector; selector = null; }
  const handler = e => {
    if (!selector) return fn(e, root);
    const t = e.target instanceof Element ? e.target.closest(selector) : null;
    if (t && root.contains(t)) fn(e, t);
  };
  root.addEventListener(evt, handler, opts);
  return () => root.removeEventListener(evt, handler, opts);
}

// same-origin sprite: <svg class="a-icon"><use href="/admin/icons.svg#i-name"/></svg>
export function icon(name, { size, label, cls } = {}) {
  const el = svg('svg', {
    class: ['a-icon', size === 'sm' && 'a-icon--sm', size === 'lg' && 'a-icon--lg', cls],
    'aria-hidden': label ? null : 'true',
    role: label ? 'img' : null,
    'aria-label': label || null,
    focusable: 'false',
  });
  el.appendChild(svg('use', { href: `/admin/icons.svg#i-${name}` }));
  return el;
}

// inject a <style> once per id (CSP allows inline styles; scripts stay external)
const injected = new Set();
export function useStyles(id, css) {
  if (injected.has(id)) return;
  injected.add(id);
  document.head.appendChild(h('style', { 'data-view': id }, css));
}

// smallest safe id generator for label/for pairs
let seq = 0;
export const uid = (prefix = 'a') => `${prefix}-${(++seq).toString(36)}`;

// focus the first focusable descendant
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
export function focusFirst(root) {
  const el = root.querySelector(FOCUSABLE);
  if (el) { el.focus(); return true; }
  return false;
}
export function focusables(root) { return [...root.querySelectorAll(FOCUSABLE)].filter(e => e.offsetParent !== null || e === document.activeElement); }

// external link with the right rel + icon
export function extLink(href, text, attrs = {}) {
  return h('a.a-link.a-ext', { href, target: '_blank', rel: 'noopener noreferrer', ...attrs }, text, ' ', icon('external-link', { size: 'sm' }));
}
