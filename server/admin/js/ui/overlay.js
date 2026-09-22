// Overlays: modal, drawer, confirm. Esc closes the top-most one, focus is
// trapped inside, the opener gets focus back, body scroll is locked.
//   const m = modal({ title, body, actions: [{label, kind, onClick}] }); m.open(); m.close();
//   const d = drawer({ title, body, wide: true });
//   if (await confirm({ title, message, danger: true })) …
import { h, icon, focusFirst, focusables } from './dom.js';
import { STR } from '../strings.js';

const stack = [];
let escBound = false;
function bindEsc() {
  if (escBound) return;
  escBound = true;
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || !stack.length) return;
    const top = stack[stack.length - 1];
    if (top.opts.closeOnEsc === false) return;
    e.preventDefault();
    top.close('esc');
  });
}
function host() {
  let el = document.getElementById('a-overlays');
  if (!el) { el = h('div#a-overlays'); document.body.appendChild(el); }
  return el;
}
// Lock on <body>, not <html>: body's overflow propagates to the viewport while
// html stays `visible`, so body never becomes its own scroll container and the
// sticky sidebar/topbar keep sticking under an open modal or drawer. (Locking
// html instead turned body — which has overflow-x:hidden — into the scroller.)
function lockScroll(on) {
  document.body.style.overflow = on ? 'hidden' : '';
}
function trap(root, e) {
  if (e.key !== 'Tab') return;
  const list = focusables(root);
  if (!list.length) { e.preventDefault(); return; }
  const first = list[0], last = list[list.length - 1];
  if (e.shiftKey && (document.activeElement === first || !root.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

function actionButton(a, ctx) {
  const btn = h('button', { type: 'button', class: ['a-btn', a.kind && `a-btn--${a.kind}`, a.solid && 'a-btn--solid'], disabled: a.disabled, autofocus: a.autofocus },
    a.icon ? icon(a.icon) : null, a.label);
  btn.addEventListener('click', async () => {
    if (!a.onClick) return ctx.close(a.value ?? a.label);
    btn.classList.add('is-busy'); btn.disabled = true;
    try {
      const r = await a.onClick(ctx);
      if (r !== false && a.close !== false) ctx.close(a.value ?? true);
    } finally { btn.classList.remove('is-busy'); btn.disabled = false; }
  });
  return btn;
}

function build(kind, opts) {
  bindEsc();
  const ctx = { opts };
  let resolveClosed;
  ctx.closed = new Promise(r => { resolveClosed = r; });
  const box = h('div', { class: [kind === 'drawer' ? 'a-drawer' : 'a-modal', opts.size === 'sm' && 'a-modal--sm', opts.size === 'lg' && 'a-modal--lg', opts.wide && 'a-drawer--wide', opts.danger && 'a-modal--danger'], role: 'dialog', 'aria-modal': 'true', tabindex: '-1' });
  const titleId = `a-dlg-${Math.random().toString(36).slice(2, 8)}`;
  if (opts.title) box.setAttribute('aria-labelledby', titleId);
  const closeBtn = h('button.a-btn.a-btn--subtle.a-btn--icon', { type: 'button', 'aria-label': STR.actions.close, onclick: () => ctx.close('x') }, icon('x'));
  const head = (opts.title || opts.closable !== false) ? h('div.a-modal__head', h('h2', { id: titleId }, opts.title || ''), opts.headActions || null, opts.closable === false ? null : closeBtn) : null;
  const bodyEl = h('div.a-modal__body');
  const body = typeof opts.body === 'function' ? opts.body(ctx) : opts.body;
  if (typeof body === 'string') bodyEl.appendChild(h('p', body)); else if (body) bodyEl.appendChild(body);
  const foot = opts.actions?.length ? h('div.a-modal__foot', opts.actions.map(a => actionButton(a, ctx))) : null;
  box.append(head || '', bodyEl, foot || '');
  const overlay = h('div', { class: ['a-overlay', kind === 'drawer' && 'a-overlay--drawer'] }, box);
  overlay.addEventListener('mousedown', e => { if (e.target === overlay && opts.closeOnBackdrop !== false) ctx.close('backdrop'); });
  box.addEventListener('keydown', e => trap(box, e));

  let opener = null;
  ctx.el = overlay; ctx.box = box; ctx.body = bodyEl;
  ctx.open = () => {
    if (overlay.isConnected) return ctx;
    opener = document.activeElement;
    host().appendChild(overlay);
    stack.push(ctx);
    lockScroll(true);
    requestAnimationFrame(() => { if (!focusFirst(bodyEl) && !(foot && focusFirst(foot))) box.focus(); });
    return ctx;
  };
  ctx.close = (result) => {
    if (!overlay.isConnected) return;
    if (opts.beforeClose && opts.beforeClose(result) === false) return;
    overlay.remove();
    const i = stack.indexOf(ctx); if (i >= 0) stack.splice(i, 1);
    if (!stack.length) lockScroll(false);
    opts.onClose?.(result);
    resolveClosed(result);
    if (opener && typeof opener.focus === 'function' && document.contains(opener)) opener.focus();
  };
  ctx.setTitle = t => { const el = box.querySelector(`#${titleId}`); if (el) el.textContent = t; };
  return ctx;
}

export const modal = opts => build('modal', opts);
export const drawer = opts => build('drawer', opts);

// resolves true when confirmed
export function confirm({ title = STR.confirm.deleteTitle, message = '', confirmLabel = STR.actions.confirm, cancelLabel = STR.actions.cancel, danger = false, icon: ic } = {}) {
  return new Promise(resolve => {
    const m = modal({
      title, size: 'sm', danger,
      body: h('div.a-row', { style: null }, ic ? icon(ic, { size: 'lg' }) : null, h('p', message)),
      actions: [
        { label: cancelLabel, kind: 'ghost', value: false },
        { label: confirmLabel, kind: danger ? 'danger' : 'primary', solid: danger, value: true, autofocus: !danger },
      ],
      onClose: r => resolve(r === true),
    });
    m.open();
  });
}

export const closeAllOverlays = () => { for (const c of [...stack]) c.close('force'); };
export const overlayCount = () => stack.length;
