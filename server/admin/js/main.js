// Admin boot: session check → login view or the shell (sidebar + topbar +
// router outlet). Views are lazy ES modules under ./views/<name>.view.js;
// a route whose module does not exist yet gets the «به‌زودی» placeholder.
// On a 401 mid-session the login overlay opens over the current view, so
// nothing typed into a form is lost.
import { api } from './api.js';
import { store } from './store.js';
import { STR } from './strings.js';
import { NAV, NAV_ITEMS, QUICK_ITEMS, ROUTES, LEGACY_URL, itemById } from './nav.js';
import { router } from './router.js';
import { ui } from './ui.js';

const { h, icon, clear, on, toast, modal, confirm, registerShortcut, modKeyLabel, toFaDigits, localDayKey, focusFirst } = ui;

const app = document.getElementById('a-app');
let shellEl = null;
let outlet = null;
let loginOverlay = null;
let sidebar = null;
let backdrop = null;

// «پرش به محتوا»: href="#a-main" is an in-page anchor, and the hash router must
// never see it (it would read "/a-main", match nothing and unmount the view).
// Move focus ourselves: the outlet (tabindex=-1) once the shell is up, else the
// first control of whatever is on screen (the login form).
document.querySelector('.a-skip')?.addEventListener('click', e => {
  e.preventDefault();
  const main = outlet || document.getElementById('a-main');
  if (main) { main.focus(); main.scrollIntoView?.({ block: 'start' }); } else focusFirst(app);
});

// ---- view loading -------------------------------------------------------
// express serves the SPA shell (text/html, 200) for any unknown /admin path,
// so a plain import() of a missing view would throw AND log a MIME error in
// the console. A memoised HEAD probe keeps the console clean.
const probes = new Map();
async function viewExists(name) {
  if (!probes.has(name)) {
    probes.set(name, (async () => {
      try {
        const r = await fetch(`/admin/js/views/${name}.view.js`, { method: 'HEAD', cache: 'no-cache' });
        return r.ok && /javascript|ecmascript/i.test(r.headers.get('content-type') || '');
      } catch { return false; }
    })());
  }
  return probes.get(name);
}
async function loadView(name, route) {
  if (!name) return placeholderModule(null, route);
  if (!(await viewExists(name))) return placeholderModule(itemById(name) || NAV_ITEMS.find(i => i.view === name), route);
  try { return await import(`./views/${name}.view.js`); } catch (e) { console.error(`[admin] view "${name}" failed to load`, e); return placeholderModule(itemById(name), route, e); }
}
function placeholderModule(item, route, error) {
  return {
    default: {
      // a plain name for document.title / the topbar — never a sentence with a full stop
      title: item ? item.label : STR.placeholder.notFoundTitle,
      mount(root) {
        root.appendChild(h('div.a-soon',
          h('div.a-soon__icon', icon(item?.icon || 'box')),
          h('h2', item ? STR.placeholder.title(item.label) : STR.placeholder.notFoundTitle),
          h('p', error ? STR.errors.viewLoad : (item ? (item.legacy ? STR.placeholder.bodyLegacy : STR.placeholder.body) : STR.placeholder.notFoundBody(route?.path || ''))),
          h('div.a-soon__actions',
            item?.legacy ? h('a.a-btn.a-btn--primary', { href: LEGACY_URL, target: '_blank', rel: 'noopener' }, icon('external-link'), STR.placeholder.openLegacy) : null,
            h('a.a-btn', { href: '#/' }, icon('home'), STR.placeholder.backHome)),
        ));
      },
    },
  };
}

// ---- shell --------------------------------------------------------------
function navLink(item, { quick = false } = {}) {
  const a = h('a', { class: quick ? null : 'a-nav__item', href: router.hrefFor(item.path), dataset: { nav: item.id } },
    icon(item.icon), quick ? h('span', item.label) : h('span.a-nav__text', item.label), quick ? null : h('span.a-nav__badge', { hidden: true }));
  return a;
}
function buildSidebar(session) {
  const nav = h('nav.a-nav', { 'aria-label': 'ناوبری اصلی' });
  for (const g of NAV) {
    if (g.hidden) continue;
    nav.appendChild(h('div.a-nav__group', g.label ? h('div.a-nav__label', g.label) : null, g.items.filter(i => !i.hidden).map(i => navLink(i))));
  }
  const initials = (session?.username || '?').slice(0, 2);
  const foot = h('div.a-sidebar__foot',
    h('div.a-sidebar__user', h('span.a-avatar', { 'aria-hidden': 'true' }, initials), h('span.a-truncate', { dir: 'auto' }, session?.username || '')),
    h('a.a-nav__item', { href: '/', target: '_blank', rel: 'noopener' }, icon('external-link'), h('span.a-nav__text', STR.app.viewSite)),
    h('a.a-nav__item', { href: LEGACY_URL, target: '_blank', rel: 'noopener', title: 'پنل انگلیسی قدیمی — تا تکمیل همهٔ بخش‌ها در دسترس است' }, icon('history'), h('span.a-nav__text', STR.app.legacyPanel)),
    h('button.a-nav__item', { type: 'button', onclick: logout }, icon('log-out'), h('span.a-nav__text', STR.actions.logout)),
  );
  const brand = h('a.a-brand', { href: '#/' }, h('span.a-brand__mark', { 'aria-hidden': 'true' }, 'SQ'), h('span', h('div.a-brand__name', STR.app.brand), h('div.a-brand__sub', STR.app.brandSub)));
  const aside = h('aside.a-sidebar', { id: 'a-sidebar' }, brand, nav, foot);
  on(aside, 'click', 'a', () => closeDrawer());
  return aside;
}
function buildTopbar() {
  const title = h('div.a-topbar__title', { id: 'a-page-title' }, STR.nav.dashboard);
  const dirty = h('span.a-topbar__dirty', { 'aria-live': 'polite' }, h('i', { 'aria-hidden': 'true' }), h('span'));
  store.subscribe('dirty', n => { dirty.classList.toggle('is-on', n > 0); dirty.lastChild.textContent = n > 0 ? STR.app.dirtyCounter(n) : ''; });
  const menuBtn = h('button.a-btn.a-btn--subtle.a-btn--icon.a-menu-btn', { type: 'button', 'aria-label': STR.app.menu, 'aria-controls': 'a-sidebar', 'aria-expanded': 'false', onclick: () => toggleDrawer() }, icon('menu'));
  const searchBtn = h('button.a-search-btn', { type: 'button', onclick: openPalette, 'aria-label': STR.app.search }, icon('search', { size: 'sm' }), h('span', STR.app.search), h('kbd', `${modKeyLabel}K`));
  const site = h('a.a-btn.a-btn--subtle.a-btn--sm', { href: '/', target: '_blank', rel: 'noopener', title: STR.app.viewSite }, icon('external-link', { size: 'sm' }), h('span.a-nav__text', STR.app.viewSite));
  const bar = h('header.a-topbar', menuBtn, title, dirty, searchBtn, site);
  // every nav route carries its item (the dashboard is '/'); no item = unmatched path
  router.onChange(route => { title.textContent = route.item?.label || STR.placeholder.notFoundTitle; menuBtn.setAttribute('aria-expanded', 'false'); });
  return { bar, title, menuBtn };
}
function buildQuickbar() {
  const items = QUICK_ITEMS.slice(0, 4).map(i => navLink(i, { quick: true }));
  const menu = h('button', { type: 'button', onclick: () => toggleDrawer(), 'aria-label': STR.app.menu }, icon('menu'), h('span', STR.app.menu));
  return h('nav.a-quickbar', { 'aria-label': 'دسترسی سریع' }, items, menu);
}
function toggleDrawer(force) {
  const open = force ?? !sidebar.classList.contains('is-open');
  sidebar.classList.toggle('is-open', open);
  backdrop.classList.toggle('is-open', open);
  shellEl.querySelector('.a-menu-btn')?.setAttribute('aria-expanded', String(open));
  if (open) sidebar.querySelector('a, button')?.focus();
}
const closeDrawer = () => { if (sidebar?.classList.contains('is-open')) toggleDrawer(false); };

function markActive(route) {
  const id = route?.item?.id;
  for (const a of shellEl.querySelectorAll('[data-nav]')) {
    if (a.dataset.nav === id) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
}
function renderBadges() {
  const state = store.snapshot();
  for (const item of NAV_ITEMS) {
    if (!item.badge) continue;
    let v = null;
    try { v = item.badge(state); } catch { v = null; }
    const el = shellEl?.querySelector(`.a-nav__item[data-nav="${item.id}"] .a-nav__badge`);
    if (!el) continue;
    if (v === null || v === undefined || v === 0 || v === '') { el.hidden = true; el.textContent = ''; }
    else { el.hidden = false; el.textContent = typeof v === 'number' ? toFaDigits(v) : String(v); }
  }
}

// lightweight counters for badges/dashboard; failures are silent (an API may not exist yet)
async function refreshCounters() {
  const counters = { ...store.get('counters') };
  try {
    const leads = await api.get('/leads');
    if (Array.isArray(leads)) { counters.leads = leads.length; counters.newLeads = leads.filter(l => (l.status || 'new') === 'new' && !l.archived_at).length; }
  } catch { /* badge stays empty */ }
  store.set('counters', counters);
}

function mountShell(session) {
  clear(app);
  app.removeAttribute('aria-busy');
  sidebar = buildSidebar(session);
  backdrop = h('div.a-backdrop', { onclick: () => toggleDrawer(false) });
  const { bar } = buildTopbar();
  outlet = h('main.a-main', { id: 'a-main', tabindex: '-1' });
  shellEl = h('div.a-shell', sidebar, h('div.a-mainwrap', bar, outlet), backdrop, buildQuickbar());
  app.appendChild(shellEl);
  router.onChange(markActive);
  store.subscribe('counters', renderBadges);
  refreshCounters();
  setInterval(refreshCounters, 5 * 60 * 1000);
  router.start({
    routes: ROUTES, outlet, load: loadView,
    ctx: route => ({ api, ui, router, store, STR, params: route.params, query: route.query, session: store.get('session'), refreshCounters }),
  });
  registerShortcut('mod+k', openPalette, { inFields: true });
  registerShortcut('escape', () => closeDrawer(), { when: () => sidebar.classList.contains('is-open') });
}

// ---- command palette: jump to any page --------------------------------
let palette = null;
function openPalette() {
  if (palette) return;
  const items = NAV_ITEMS.filter(i => !i.hidden).map(i => ({ ...i, group: NAV.find(g => g.items.includes(i))?.label || '' }));
  const input = h('input.a-input', { type: 'search', placeholder: STR.app.searchHint, 'aria-label': STR.app.search, autocomplete: 'off' });
  const list = h('div.a-palette__list', { role: 'listbox' });
  let sel = 0;
  const render = () => {
    const q = input.value.trim().toLowerCase();
    const hits = items.filter(i => !q || i.label.toLowerCase().includes(q) || i.id.includes(q) || i.group.toLowerCase().includes(q));
    clear(list);
    if (!hits.length) { list.appendChild(h('div.a-empty__hint', { style: null }, STR.app.noResults)); return; }
    sel = Math.min(sel, hits.length - 1);
    hits.forEach((i, idx) => list.appendChild(h('button.a-palette__item', { type: 'button', role: 'option', 'aria-selected': String(idx === sel), onclick: () => go(i) }, icon(i.icon, { size: 'sm' }), h('span', i.label), i.group ? h('span.a-palette__group', i.group) : null)));
    list.hits = hits;
  };
  const go = i => { palette.close(); router.navigate(i.path); };
  input.addEventListener('input', () => { sel = 0; render(); });
  input.addEventListener('keydown', e => {
    const hits = list.hits || [];
    if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(sel + 1, hits.length - 1); render(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(sel - 1, 0); render(); }
    else if (e.key === 'Enter' && hits[sel]) { e.preventDefault(); go(hits[sel]); }
  });
  palette = modal({ closable: false, body: h('div', input, list), onClose: () => { palette = null; } });
  palette.box.classList.add('a-palette');
  palette.box.querySelector('.a-modal__body').classList.add('a-card--flush');
  render();
  palette.open();
  requestAnimationFrame(() => input.focus());
}

// ---- auth ---------------------------------------------------------------
async function logout() {
  if (!(await confirm({ title: STR.confirm.logoutTitle, message: STR.confirm.logoutMessage, confirmLabel: STR.actions.logout }))) return;
  try { await api.post('/logout'); } catch { /* cookie may already be gone */ }
  store.set('session', null);
  location.hash = '#/';
  location.reload();
}

async function fetchSession() {
  try { return await api.get('/account'); } catch (e) {
    if (e.status === 404) { try { return await api.get('/me'); } catch (e2) { throw e2; } }
    throw e;
  }
}

async function showLoginPage(message) {
  clear(app);
  app.removeAttribute('aria-busy');
  const mod = await import('./views/login.view.js');
  const root = h('div');
  app.appendChild(root);
  await mod.default.mount(root, { api, ui, STR, store, message, onSuccess: async () => { const s = await fetchSession(); store.set('session', s); mountShell(s); } });
}

// 401 mid-session: overlay login, keep the page (and its form state) intact
function onAuthExpired() {
  if (loginOverlay || !shellEl) return;
  import('./views/login.view.js').then(mod => {
    const body = h('div');
    loginOverlay = modal({ title: STR.auth.title, size: 'sm', closable: false, closeOnBackdrop: false, closeOnEsc: false, body });
    mod.default.mount(body, { api, ui, STR, store, embedded: true, message: STR.auth.expired, onSuccess: async () => {
      const s = await fetchSession();
      store.set('session', s);
      loginOverlay.close();
      loginOverlay = null;
      toast(STR.auth.welcome(s.username));
      // a list that failed to load gets fresh data; a half-edited form is left exactly as it was
      if (!router.isDirty()) router.reload();
      refreshCounters();
    } });
    loginOverlay.open();
  });
}
store.on('auth:expired', onAuthExpired);

// ---- boot ---------------------------------------------------------------
(async function boot() {
  try {
    const session = await fetchSession();
    store.set('session', session);
    mountShell(session);
  } catch (e) {
    if (e?.status === 401) { showLoginPage(); return; }
    clear(app);
    app.removeAttribute('aria-busy');
    app.appendChild(h('div.a-auth', h('div.a-auth__card', ui.errorState({ error: e, retry: () => location.reload() }))));
  }
})();
