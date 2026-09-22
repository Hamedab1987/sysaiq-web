// Feedback: toasts (aria-live), badges, empty/error states, skeletons,
// progress ring, checklist, stat cards, clipboard.
import { h, svg, icon, clear } from './dom.js';
import { STR } from '../strings.js';
import { toFaDigits } from './format.js';

// ---- toast --------------------------------------------------------------
const TOAST_ICON = { success: 'check-circle', error: 'alert-circle', warn: 'alert-triangle', info: 'info' };
function toastHost() {
  let host = document.getElementById('a-toasts');
  if (!host) { host = h('div#a-toasts.a-toasts', { 'aria-live': 'polite' }); document.body.appendChild(host); }
  return host;
}
export function toast(message, { kind = 'success', timeout, action } = {}) {
  const host = toastHost();
  const el = h('div', { class: ['a-toast', `a-toast--${kind}`], role: kind === 'error' ? 'alert' : 'status' },
    icon(TOAST_ICON[kind] || 'info'),
    h('span.a-toast__text', String(message)),
    action ? h('button.a-toast__action', { type: 'button', onclick: () => { action.onClick?.(); dismiss(); } }, action.label) : null,
    h('button.a-btn.a-btn--subtle.a-btn--icon.a-btn--sm', { type: 'button', 'aria-label': STR.actions.close, onclick: () => dismiss() }, icon('x', { size: 'sm' })),
  );
  let timer = null;
  const dismiss = () => {
    if (!el.isConnected) return;
    clearTimeout(timer);
    el.classList.add('is-leaving');
    setTimeout(() => el.remove(), 200);
  };
  host.appendChild(el);
  while (host.children.length > 4) host.firstChild.remove();
  timer = setTimeout(dismiss, timeout ?? (kind === 'error' ? 6000 : 2800));
  return { el, dismiss };
}
toast.error = (m, o) => toast(m, { ...o, kind: 'error' });
toast.info = (m, o) => toast(m, { ...o, kind: 'info' });
toast.warn = (m, o) => toast(m, { ...o, kind: 'warn' });

// ---- badges -------------------------------------------------------------
export function badge(text, { kind, icon: ic, ltr } = {}) {
  return h('span', { class: ['a-badge', kind && `a-badge--${kind}`, ltr && 'a-badge--ltr'] }, ic ? icon(ic, { size: 'sm' }) : null, String(text));
}
// status is never colour-only: every entry has an icon and a Persian word
export const STATUS_MAP = {
  published: { label: STR.states.published, kind: 'ok', icon: 'check-circle' },
  draft: { label: STR.states.draft, kind: 'warn', icon: 'pencil' },
  enabled: { label: STR.states.enabled, kind: 'ok', icon: 'check-circle' },
  disabled: { label: STR.states.disabled, kind: null, icon: 'circle' },
  configured: { label: STR.states.configured, kind: 'ok', icon: 'check-circle' },
  missing: { label: STR.states.notConfigured, kind: 'danger', icon: 'alert-circle' },
  new: { label: 'جدید', kind: 'violet', icon: 'star' },
  contacted: { label: 'تماس گرفته شد', kind: 'info', icon: 'phone' },
  qualified: { label: 'واجد شرایط', kind: 'info', icon: 'check' },
  proposal: { label: 'پیشنهاد ارسال شد', kind: 'info', icon: 'send' },
  won: { label: 'بسته شد (موفق)', kind: 'ok', icon: 'check-circle' },
  lost: { label: 'بسته شد (ناموفق)', kind: null, icon: 'x' },
  spam: { label: 'هرزنامه', kind: 'danger', icon: 'alert-triangle' },
  form: { label: 'فرم تماس', kind: null, icon: 'mail' },
  ai: { label: 'دستیار هوشمند', kind: 'violet', icon: 'sparkles' },
  fa: { label: 'فارسی', kind: null, icon: null },
  en: { label: 'English', kind: null, icon: null },
  ok: { label: 'سالم', kind: 'ok', icon: 'check-circle' },
  error: { label: 'خطا', kind: 'danger', icon: 'alert-circle' },
  pending: { label: 'در انتظار', kind: 'warn', icon: 'clock' },
};
export function statusBadge(status, { map = STATUS_MAP, label } = {}) {
  const m = map[status] || { label: label || String(status || STR.states.none), kind: null, icon: 'circle' };
  return badge(label || m.label, { kind: m.kind, icon: m.icon });
}

// ---- states -------------------------------------------------------------
export function emptyState({ icon: ic = 'inbox', title = STR.states.empty, hint = '', action } = {}) {
  return h('div.a-empty', { role: 'status' },
    icon(ic), h('div.a-empty__title', title), hint ? h('div.a-empty__hint', hint) : null,
    action ? h('button.a-btn.a-btn--primary', { type: 'button', onclick: action.onClick }, action.icon ? icon(action.icon) : null, action.label) : null,
  );
}
export function errorState({ title = STR.states.error, message = STR.states.errorHint, retry, error } = {}) {
  const msg = error?.message && error.message !== title ? error.message : message;
  return h('div.a-empty.a-empty--error', { role: 'alert' },
    icon('alert-circle'), h('div.a-empty__title', title), msg ? h('div.a-empty__hint', msg) : null,
    retry ? h('button.a-btn', { type: 'button', onclick: retry }, icon('refresh-cw'), STR.actions.retry) : null,
  );
}
// kind: 'lines' | 'form' | 'table' | 'cards' | 'page'
export function skeleton({ kind = 'lines', lines = 4, rows = 5, cards = 4 } = {}) {
  const line = cls => h('div', { class: ['a-skel__line', cls] });
  if (kind === 'table') return h('div.a-skel.a-skel--table', { 'aria-busy': 'true', 'aria-label': STR.states.loading }, Array.from({ length: rows }, () => line()));
  if (kind === 'cards') return h('div.a-skel.a-skel--cards', { 'aria-busy': 'true' }, Array.from({ length: cards }, () => h('div.a-skel__block')));
  if (kind === 'form') return h('div.a-skel', { 'aria-busy': 'true' }, line('a-skel__line--w40'), h('div.a-skel__block'), line('a-skel__line--w40'), h('div.a-skel__block'), line('a-skel__line--w40'), line());
  if (kind === 'page') return h('div.a-skel', { 'aria-busy': 'true' }, line('a-skel__line--h'), line('a-skel__line--w60'), h('div.a-skel.a-skel--cards', h('div.a-skel__block'), h('div.a-skel__block'), h('div.a-skel__block')), line(), line('a-skel__line--w80'), line('a-skel__line--w60'));
  return h('div.a-skel', { 'aria-busy': 'true', 'aria-label': STR.states.loading }, Array.from({ length: lines }, (_, i) => line(i === 0 ? 'a-skel__line--w60' : i === lines - 1 ? 'a-skel__line--w40' : null)));
}

// ---- progress ring (gradient stroke) ------------------------------------
let gradDefined = false;
function ensureGradient() {
  if (gradDefined || document.getElementById('a-ring-grad')) { gradDefined = true; return; }
  const defs = svg('svg', { width: 0, height: 0, 'aria-hidden': 'true', style: null });
  defs.setAttribute('class', 'a-sr');
  const grad = svg('linearGradient', { id: 'a-ring-grad', x1: '0', y1: '0', x2: '1', y2: '1' },
    svg('stop', { offset: '0', 'stop-color': '#7dffd9' }), svg('stop', { offset: '1', 'stop-color': '#8b6bff' }));
  defs.appendChild(svg('defs', null, grad));
  document.body.appendChild(defs);
  gradDefined = true;
}
export function progressRing({ value = 0, max = 100, size = 96, stroke = 8, label, text } = {}) {
  ensureGradient();
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  const bar = svg('circle', { class: 'a-ring__bar', cx: size / 2, cy: size / 2, r, fill: 'none', 'stroke-width': stroke, 'stroke-dasharray': c.toFixed(2), 'stroke-dashoffset': (c * (1 - pct)).toFixed(2) });
  const valueEl = h('div.a-ring__value', text ?? `${toFaDigits(Math.round(pct * 100))}٪`);
  const el = h('div.a-ring', { role: 'img', 'aria-label': `${label ? `${label}: ` : ''}${toFaDigits(Math.round(pct * 100))}٪` },
    svg('svg', { width: size, height: size, viewBox: `0 0 ${size} ${size}` },
      svg('circle', { class: 'a-ring__track', cx: size / 2, cy: size / 2, r, fill: 'none', 'stroke-width': stroke }), bar),
    h('div.a-ring__text', valueEl, label ? h('div.a-ring__label', label) : null),
  );
  return Object.assign(el, {
    setValue(v, m = max) {
      const p = m > 0 ? Math.min(1, Math.max(0, v / m)) : 0;
      bar.setAttribute('stroke-dashoffset', (c * (1 - p)).toFixed(2));
      valueEl.textContent = `${toFaDigits(Math.round(p * 100))}٪`;
      el.setAttribute('aria-label', `${label ? `${label}: ` : ''}${toFaDigits(Math.round(p * 100))}٪`);
    },
  });
}

// ---- checklist: [{label, hint, done, href, onClick}] --------------------
export function checklist({ items = [] } = {}) {
  const list = h('ul.a-check');
  for (const it of items) {
    const inner = [
      h('span.a-check__mark', icon(it.done ? 'check' : 'circle', { size: 'sm' })),
      h('span.a-check__text', h('div.a-check__label', it.label), it.hint ? h('div.a-check__hint', it.hint) : null),
      (it.href || it.onClick) && !it.done ? h('span.a-check__go', icon('chevron-left', { size: 'sm' })) : null,
    ];
    const row = it.href
      ? h('a.a-check__item', { class: it.done && 'is-done', href: it.href }, inner)
      : it.onClick
        ? h('button.a-check__item.is-link', { type: 'button', class: it.done && 'is-done', onclick: it.onClick }, inner)
        : h('div.a-check__item', { class: it.done && 'is-done' }, inner);
    row.setAttribute('aria-label', `${it.label}: ${it.done ? 'انجام شده' : 'انجام نشده'}`);
    list.appendChild(h('li', row));
  }
  return list;
}

// ---- stat card ----------------------------------------------------------
export function statCard({ label, value, icon: ic, hint, href, delta, deltaDown, onClick, loading } = {}) {
  const body = [
    h('div.a-stat__label', ic ? icon(ic) : null, label),
    h('div.a-stat__value', loading ? h('div.a-skel__line.a-skel__line--h') : (value === null || value === undefined ? STR.states.none : String(value))),
    hint ? h('div.a-stat__hint', hint) : null,
    delta ? h('div', { class: ['a-stat__delta', deltaDown && 'is-down'] }, delta) : null,
  ];
  if (href) return h('a.a-stat', { href }, body);
  if (onClick) return h('button.a-stat', { type: 'button', onclick: onClick }, body);
  return h('div.a-stat', body);
}
statCard.set = (el, value) => { const v = el.querySelector('.a-stat__value'); if (v) { clear(v); v.textContent = String(value); } };

// ---- clipboard ----------------------------------------------------------
export async function copyToClipboard(text, { silent = false } = {}) {
  try {
    await navigator.clipboard.writeText(String(text));
    if (!silent) toast(STR.actions.copied, { timeout: 1500 });
    return true;
  } catch {
    if (!silent) toast.error(STR.errors.clipboard);
    return false;
  }
}
