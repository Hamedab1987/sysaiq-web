// Keyboard shortcuts + debounce.
//   registerShortcut('mod+s', e => form.submit()) → off()     (mod = ⌘ on Mac, Ctrl elsewhere)
//   registerShortcut('escape', fn, { global: true })
// Shortcuts do not fire while an overlay owns Esc; 'mod+s' fires everywhere
// (including inside inputs) since it is the save gesture.
const registry = [];
let bound = false;
const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');

function normalize(combo) {
  const parts = String(combo).toLowerCase().split('+').map(s => s.trim()).filter(Boolean);
  const key = parts.pop();
  return { key, mod: parts.includes('mod'), ctrl: parts.includes('ctrl'), meta: parts.includes('meta'), shift: parts.includes('shift'), alt: parts.includes('alt') };
}
function matches(spec, e) {
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key.toLowerCase();
  if (spec.key !== key && !(spec.key === 'esc' && key === 'escape')) return false;
  const modOk = spec.mod ? (isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey) : true;
  if (!modOk) return false;
  if (!spec.mod && (e.metaKey !== spec.meta || e.ctrlKey !== spec.ctrl)) return false;
  if (e.shiftKey !== spec.shift || e.altKey !== spec.alt) return false;
  return true;
}
function bind() {
  if (bound) return;
  bound = true;
  document.addEventListener('keydown', e => {
    if (e.defaultPrevented) return;
    const inField = e.target instanceof HTMLElement && (e.target.matches('input, textarea, select, [contenteditable="true"]'));
    for (let i = registry.length - 1; i >= 0; i--) {
      const r = registry[i];
      if (!matches(r.spec, e)) continue;
      if (inField && !r.opts.inFields && !r.spec.mod) continue;
      if (r.opts.when && !r.opts.when(e)) continue;
      e.preventDefault();
      r.fn(e);
      if (!r.opts.passthrough) break;
    }
  });
}
export function registerShortcut(combo, fn, opts = {}) {
  bind();
  const entry = { spec: normalize(combo), fn, opts };
  registry.push(entry);
  return () => { const i = registry.indexOf(entry); if (i >= 0) registry.splice(i, 1); };
}
export const modKeyLabel = isMac ? '⌘' : 'Ctrl';

export function debounce(fn, ms = 250) {
  let t = null;
  const d = (...args) => { clearTimeout(t); t = setTimeout(() => { t = null; fn(...args); }, ms); };
  d.cancel = () => { clearTimeout(t); t = null; };
  d.flush = (...args) => { if (t) { clearTimeout(t); t = null; fn(...args); } };
  return d;
}
export function throttle(fn, ms = 200) {
  let last = 0, timer = null, pending = null;
  return (...args) => {
    const now = Date.now();
    pending = args;
    if (now - last >= ms) { last = now; fn(...pending); pending = null; return; }
    if (!timer) timer = setTimeout(() => { timer = null; last = Date.now(); if (pending) { fn(...pending); pending = null; } }, ms - (now - last));
  };
}
