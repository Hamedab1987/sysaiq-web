// Hash router with lazy views and an unsaved-changes guard.
//   start({ routes: [{pattern, item}], outlet, load: name => Promise<viewModule>, ctx })
//   navigate('/projects/12') · navigate('/leads?status=new', { replace: true })
//   currentRoute() → { path, pattern, params, query, item }  · param('id') · query().status
//   setDirtyGuard(() => boolean)   // ask before leaving when it returns true
//   onChange(fn) → off
// Only "#/…" (and the empty hash) is a route. "#a-main" or any other in-page
// anchor is left to the browser: the mounted view stays, `current` is untouched
// (isRouteHash / parseHash → null). A view may override the leave dialog's copy
// with `leaveTitle` / `leaveMessage` (string or () => string) on its module —
// the content view keeps a draft, so «از بین می‌روند» would be wrong there.
import { store, clearDirty } from './store.js';
import { STR } from './strings.js';
import { confirm } from './ui/overlay.js';
import { h } from './ui/dom.js';
import { errorState, skeleton } from './ui/feedback.js';

let routes = [];
let outlet = null;
let loadView = null;
let makeCtx = null;
let current = null;
let cleanup = null;
let activeView = null;
let dirtyGuard = null;
let navToken = 0;
const changeListeners = new Set();

function compile(pattern) {
  const keys = [];
  const re = new RegExp(`^${pattern.replace(/\/+$/, '').replace(/:([\w-]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; })}/?$`);
  return { re, keys };
}

// '', '#', '#/', '#/leads?x=1' → routes; '#a-main', '#top' → in-page anchors
export function isRouteHash(hash = location.hash) {
  const raw = String(hash || '');
  return raw === '' || raw === '#' || raw.startsWith('#/');
}

// → { path, query } for a route hash, null for an in-page anchor
export function parseHash(hash = location.hash) {
  if (!isRouteHash(hash)) return null;
  let raw = String(hash || '').replace(/^#/, '');
  if (!raw.startsWith('/')) raw = `/${raw}`;
  const [pathPart, queryPart = ''] = raw.split('?');
  // a malformed escape (#/%E0%A4%A) must not take the router down: keep the raw path,
  // which then simply matches no route
  let decoded = pathPart;
  try { decoded = decodeURI(pathPart); } catch { /* URIError */ }
  const path = decoded.replace(/\/{2,}/g, '/') || '/';
  const query = {};
  for (const [k, v] of new URLSearchParams(queryPart)) query[k] = v;
  return { path, query };
}

export function match(path) {
  for (const r of routes) {
    const m = r.re.exec(path);
    if (!m) continue;
    const params = {};
    r.keys.forEach((k, i) => { try { params[k] = decodeURIComponent(m[i + 1]); } catch { params[k] = m[i + 1]; } });
    return { pattern: r.pattern, item: r.item, params };
  }
  return null;
}

export const currentRoute = () => current;
export const param = name => current?.params?.[name];
export const query = () => ({ ...(current?.query || {}) });
export function setDirtyGuard(fn) { dirtyGuard = typeof fn === 'function' ? fn : null; }
export function onChange(fn) { changeListeners.add(fn); return () => changeListeners.delete(fn); }
export function hrefFor(path) { return `#${path.startsWith('/') ? path : `/${path}`}`; }

export function navigate(path, { replace = false } = {}) {
  const href = hrefFor(path);
  if (replace) history.replaceState(null, '', href);
  else location.hash = href;
  if (replace) handle();
}

async function unmountCurrent() {
  if (typeof cleanup === 'function') { try { await cleanup(); } catch (e) { console.error('[router] cleanup failed', e); } }
  cleanup = null;
  activeView = null;
  clearDirty(); // a view that forgot form.destroy() must not block navigation forever
}

export function isDirty() {
  if (dirtyGuard && dirtyGuard()) return true;
  if (activeView?.isDirty?.()) return true;
  return store.get('dirty') > 0;
}

// a view's own leave-dialog copy (string or function), else the shared one
const viewText = (key, fallback) => {
  const v = activeView?.[key];
  const s = typeof v === 'function' ? v() : v;
  return typeof s === 'string' && s.trim() ? s : fallback;
};

async function handle() {
  let parsed = parseHash();
  if (!parsed) {
    // an in-page anchor (#a-main from the skip link, a future #section): the
    // browser scrolls, the view stays mounted. Only a cold start on such a
    // hash has nothing to keep — it lands on the dashboard.
    if (current) return;
    history.replaceState(null, '', hrefFor('/'));
    parsed = { path: '/', query: {} };
  }
  const { path, query: q } = parsed;
  const target = match(path) || { pattern: null, item: null, params: {} };
  // same route + same params: nothing to do (hash normalisation)
  if (current && current.path === path && JSON.stringify(current.query) === JSON.stringify(q)) return;

  if (current && isDirty()) {
    const ok = await confirm({ title: viewText('leaveTitle', STR.confirm.leaveTitle), message: viewText('leaveMessage', STR.confirm.leaveMessage), confirmLabel: STR.confirm.leaveConfirm, cancelLabel: STR.actions.stay, danger: true, icon: 'alert-triangle' });
    // replaceState does not fire hashchange, so restoring the old hash is silent
    if (!ok) { history.replaceState(null, '', hrefFor(current.path + (current.queryString || ''))); return; }
  }

  const token = ++navToken;
  const route = { path, pattern: target.pattern, params: target.params, query: q, item: target.item, queryString: location.hash.includes('?') ? location.hash.slice(location.hash.indexOf('?')) : '' };
  await unmountCurrent();
  if (token !== navToken) return;
  current = route;
  store.set('route', route);
  for (const fn of changeListeners) { try { fn(route); } catch (e) { console.error(e); } }
  if (!outlet) return;

  outlet.replaceChildren(skeleton({ kind: 'page' }));
  outlet.scrollTop = 0;
  window.scrollTo({ top: 0 });
  let mod = null;
  try { mod = await loadView(target.item?.view || null, route); } catch (e) { console.error('[router] view load failed', e); mod = null; }
  if (token !== navToken) return;
  const view = mod?.default || mod;
  const root = h('div.a-content', { dataset: { view: target.item?.view || 'none' } });
  outlet.replaceChildren(root);
  if (!view || typeof view.mount !== 'function') {
    root.appendChild(errorState({ title: STR.errors.viewLoad, retry: () => handle() }));
    return;
  }
  activeView = view;
  document.title = view.title ? `${view.title} — ${STR.app.name}` : STR.app.name;
  try {
    const ctx = makeCtx ? makeCtx(route, view) : { params: route.params, query: q };
    const result = await view.mount(root, ctx);
    if (token !== navToken) { if (typeof result === 'function') result(); return; }
    cleanup = typeof result === 'function' ? result : null;
  } catch (e) {
    console.error('[router] mount failed', e);
    root.replaceChildren(errorState({ title: STR.errors.viewLoad, error: e, retry: () => { current = null; handle(); } }));
  }
}

export function start({ routes: list = [], outlet: el, load, ctx }) {
  routes = list.map(r => ({ ...r, ...compile(r.pattern) }));
  outlet = el;
  loadView = load;
  makeCtx = ctx;
  window.addEventListener('hashchange', handle);
  window.addEventListener('beforeunload', e => { if (isDirty()) { e.preventDefault(); e.returnValue = ''; } });
  return handle();
}

// force a re-mount of the current view (after login-overlay recovery etc.)
export function reload() {
  const prev = current;
  current = null;
  // an in-page anchor may sit in the URL: re-mount the route it belongs to, not the dashboard
  if (prev && !isRouteHash(location.hash)) history.replaceState(null, '', hrefFor(prev.path + (prev.queryString || '')));
  return handle();
}
export const router = { start, navigate, currentRoute, param, query, setDirtyGuard, onChange, hrefFor, reload, isDirty, parseHash, isRouteHash };
export default router;
