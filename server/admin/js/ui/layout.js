// Page-level building blocks: pageHeader, card, tabs, stickyActionBar.
import { h, icon, clear } from './dom.js';
import { STR } from '../strings.js';
import { toFaDigits } from './format.js';

// pageHeader({ eyebrow: 'SYS.01', title, subtitle, actions: [Node], crumbs: [{label, href}] })
export function pageHeader({ eyebrow, title, subtitle, actions = [], crumbs } = {}) {
  return h('header.a-page-head',
    h('div.a-page-head__text',
      crumbs?.length ? h('ol.a-crumbs', crumbs.map(c => h('li', c.href ? h('a', { href: c.href }, c.label) : c.label))) : null,
      eyebrow ? h('div.a-page-head__eyebrow', { dir: 'ltr' }, eyebrow) : null,
      h('h1', title),
      subtitle ? h('p.a-page-head__sub', subtitle) : null),
    actions.length ? h('div.a-page-head__actions', actions) : null,
  );
}

// card({ title, hint, body: Node|Node[], footer: Node|Node[], actions: [Node], glow, flush })
export function card({ title, hint, body, footer, actions, glow, flush, cls } = {}) {
  const el = h('section', { class: ['a-card', glow && 'a-card--glow', flush && 'a-card--flush', cls] });
  if (title || actions?.length) {
    el.appendChild(h('div.a-card__head', h('div', title ? h('h2.a-card__title', title) : null, hint ? h('div.a-card__hint', hint) : null), actions?.length ? h('div.a-card__actions', actions) : null));
  }
  const bodyEl = h('div.a-card__body', body);
  el.appendChild(bodyEl);
  if (footer) el.appendChild(h('div.a-card__foot', footer));
  el.body = bodyEl;
  return el;
}

// tabs({ items: [{id, label, icon, badge, panel: Node|() => Node}], active, onChange, remember })
// → element with .select(id), .active
export function tabs({ items = [], active, onChange, remember } = {}) {
  const key = remember ? `sysaiq-admin-tab:${remember}` : null;
  let current = active || (key && safeGet(key)) || items[0]?.id;
  if (!items.some(i => i.id === current)) current = items[0]?.id;
  const panels = new Map();
  const list = h('div.a-tabs__list', { role: 'tablist' });
  const root = h('div.a-tabs', list);
  const rendered = new Map();

  const panelFor = it => {
    if (!rendered.has(it.id)) {
      const content = typeof it.panel === 'function' ? it.panel() : it.panel;
      const p = h('div.a-tabs__panel', { role: 'tabpanel', id: `a-tabp-${it.id}`, 'aria-labelledby': `a-tab-${it.id}`, tabindex: '0' }, content);
      rendered.set(it.id, p);
      root.appendChild(p);
    }
    return rendered.get(it.id);
  };
  const select = (id, { silent } = {}) => {
    if (!items.some(i => i.id === id)) return;
    current = id;
    for (const it of items) {
      const tab = panels.get(it.id);
      const on = it.id === id;
      tab.setAttribute('aria-selected', on ? 'true' : 'false');
      tab.tabIndex = on ? 0 : -1;
      if (on) panelFor(it).hidden = false; else if (rendered.has(it.id)) rendered.get(it.id).hidden = true;
    }
    if (key) safeSet(key, id);
    if (!silent) onChange?.(id);
  };
  items.forEach((it, i) => {
    const tab = h('button.a-tabs__tab', { type: 'button', role: 'tab', id: `a-tab-${it.id}`, 'aria-controls': `a-tabp-${it.id}`, 'aria-selected': 'false', tabindex: '-1' },
      it.icon ? icon(it.icon, { size: 'sm' }) : null, it.label, it.badge ? h('span.a-badge', toFaDigits(it.badge)) : null);
    tab.addEventListener('click', () => select(it.id));
    tab.addEventListener('keydown', e => {
      const dir = e.key === 'ArrowRight' ? -1 : e.key === 'ArrowLeft' ? 1 : 0; // RTL: right = previous
      if (!dir) return;
      e.preventDefault();
      const idx = (i + dir + items.length) % items.length;
      select(items[idx].id); panels.get(items[idx].id).focus();
    });
    panels.set(it.id, tab);
    list.appendChild(tab);
  });
  select(current, { silent: true });
  root.select = select;
  Object.defineProperty(root, 'active', { get: () => current });
  root.setBadge = (id, n) => { const t = panels.get(id); if (!t) return; let b = t.querySelector('.a-badge'); if (!n) { b?.remove(); return; } if (!b) { b = h('span.a-badge'); t.appendChild(b); } b.textContent = toFaDigits(n); };
  return root;
}
function safeGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function safeSet(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } }

// stickyActionBar({ actions: [Node], status, dirty }) → element with .setDirty(bool), .setStatus(text), .setBusy(bool)
export function stickyActionBar({ actions = [], status, dirty = false } = {}) {
  const statusEl = h('div', { class: ['a-sticky__status', dirty && 'is-dirty'], 'aria-live': 'polite' });
  const el = h('div.a-sticky', statusEl, actions);
  const render = (isDirty, text) => {
    clear(statusEl);
    statusEl.classList.toggle('is-dirty', !!isDirty);
    statusEl.append(icon(isDirty ? 'alert-circle' : 'check-circle', { size: 'sm' }), text ?? (isDirty ? STR.states.unsaved : STR.states.allSaved));
  };
  render(dirty, status);
  el.setDirty = (d, text) => render(d, text);
  el.setStatus = text => render(statusEl.classList.contains('is-dirty'), text);
  el.setBusy = busy => { for (const b of el.querySelectorAll('button')) { b.disabled = !!busy; b.classList.toggle('is-busy', !!busy); } };
  return el;
}
