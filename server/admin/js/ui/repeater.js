// repeater: an ordered list of objects, each row a mini-form built by
// `item(rowValues, index)` → Field[] (or {fields, render}). Rows can be
// added, removed and reordered (buttons + drag handle). Value = array.
//   repeater({
//     name: 'features', label: 'قابلیت‌ها', addLabel: 'افزودن قابلیت', max: 12,
//     empty: { title_en: '', title_fa: '', desc_en: '', desc_fa: '' },
//     item: () => [bilingualField({ name: 'title', flat: true, required: true }), bilingualField({ name: 'desc', flat: true, type: 'textarea' })],
//     summary: row => row.title_fa || row.title_en,      // optional collapsed title
//   })
import { h, icon, clear } from './dom.js';
import { STR } from '../strings.js';
import { toFaDigits } from './format.js';
import { makeField } from './form.js';

export function repeater(opts = {}) {
  const { name = '', label, hint, item, empty = {}, addLabel = STR.actions.add, min = 0, max = 200, sortable = true, required, itemLabel } = opts;
  const rows = [];           // [{ el, fields, key }]
  const listEl = h('div.a-rep');
  const emptyEl = h('div.a-rep__empty', opts.emptyText || STR.states.empty);
  const countEl = h('span.a-rep__count');
  const addBtn = h('button.a-btn.a-btn--sm', { type: 'button' }, icon('plus', { size: 'sm' }), addLabel);
  const footer = h('div.a-rep__foot', addBtn, countEl);
  const wrap = h('div.a-stack.a-stack--sm', listEl, footer);
  let f; // Field, assigned below

  const rowValues = r => { const v = {}; for (const x of r.fields) x.write(v); return v; };
  const renumber = () => {
    rows.forEach((r, i) => { r.el.querySelector('.a-rep__idx').textContent = `[ ${String(i + 1).padStart(2, '0')} ]`; r.el.dataset.index = String(i); });
    emptyEl.remove();
    if (!rows.length) listEl.appendChild(emptyEl);
    countEl.textContent = rows.length ? STR.states.items(rows.length) : '';
    addBtn.disabled = rows.length >= max;
    for (const r of rows) { const [up, down] = r.el.querySelectorAll('[data-move]'); if (up) up.disabled = rows.indexOf(r) === 0; if (down) down.disabled = rows.indexOf(r) === rows.length - 1; }
  };
  const move = (r, dir) => {
    const i = rows.indexOf(r); const j = i + dir;
    if (j < 0 || j >= rows.length) return;
    rows.splice(i, 1); rows.splice(j, 0, r);
    for (const x of rows) listEl.appendChild(x.el); // re-append in the new order
    renumber(); f.emit();
    r.el.querySelector('[data-move]')?.focus();
  };
  const remove = r => {
    if (rows.length <= min) return;
    rows.splice(rows.indexOf(r), 1); r.el.remove(); for (const x of r.fields) x.dispose?.();
    renumber(); f.emit();
  };
  const addRow = (values = {}, { focus = false, at } = {}) => {
    if (rows.length >= max) return null;
    const built = item(values, rows.length);
    const fields = Array.isArray(built) ? built : built.fields;
    for (const x of fields) x.read({ ...empty, ...values });
    const body = h('div.a-rep__body', Array.isArray(built) ? fields.map(x => x.el) : (built.render ? built.render(fields) : fields.map(x => x.el)));
    const r = { fields, key: Math.random().toString(36).slice(2) };
    const tools = h('div.a-rep__tools',
      sortable ? h('button.a-btn.a-btn--subtle.a-btn--icon.a-btn--sm', { type: 'button', dataset: { move: 'up' }, 'aria-label': STR.actions.moveUp, onclick: () => move(r, -1) }, icon('arrow-up', { size: 'sm' })) : null,
      sortable ? h('button.a-btn.a-btn--subtle.a-btn--icon.a-btn--sm', { type: 'button', dataset: { move: 'down' }, 'aria-label': STR.actions.moveDown, onclick: () => move(r, 1) }, icon('arrow-down', { size: 'sm' })) : null,
      h('button.a-btn.a-btn--subtle.a-btn--icon.a-btn--sm.a-btn--danger', { type: 'button', 'aria-label': STR.actions.remove, onclick: () => remove(r) }, icon('trash', { size: 'sm' })),
    );
    const idx = h('div.a-rep__idx', { 'aria-hidden': 'true' });
    r.el = h('div.a-rep__item', { draggable: sortable ? 'true' : null, role: 'group', 'aria-label': `${itemLabel || label || ''} ${toFaDigits(rows.length + 1)}`.trim() }, idx, body, tools);
    if (sortable) {
      r.el.addEventListener('dragstart', e => { if (e.target.closest('input,textarea,select')) { e.preventDefault(); return; } e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', r.key); r.el.classList.add('is-dragging'); });
      r.el.addEventListener('dragend', () => r.el.classList.remove('is-dragging'));
      r.el.addEventListener('dragover', e => { e.preventDefault(); r.el.classList.add('is-over'); });
      r.el.addEventListener('dragleave', () => r.el.classList.remove('is-over'));
      r.el.addEventListener('drop', e => { e.preventDefault(); r.el.classList.remove('is-over'); const src = rows.find(x => x.key === e.dataTransfer.getData('text/plain')); if (!src || src === r) return; rows.splice(rows.indexOf(src), 1); rows.splice(rows.indexOf(r), 0, src); for (const x of rows) listEl.appendChild(x.el); renumber(); f.emit(); });
    }
    for (const x of fields) x.onChange(() => f.emit());
    if (at !== undefined && at < rows.length) { rows.splice(at, 0, r); listEl.insertBefore(r.el, rows[at + 1].el); }
    else { rows.push(r); listEl.appendChild(r.el); }
    renumber();
    if (focus) fields[0]?.focus();
    return r;
  };
  addBtn.addEventListener('click', () => { addRow({}, { focus: true }); f.emit(); });

  f = makeField({ name, label, hint, required, labelFor: false, type: 'repeater', control: wrap, focusEl: null,
    rules: [...(required ? [v => (!v.length ? STR.fields.required : null)] : []), ...(min ? [v => (v.length < min ? STR.fields.min(min) : null)] : []), ...(opts.rules || [])],
    get: () => rows.map(rowValues),
    set: v => { for (const r of rows) { r.el.remove(); for (const x of r.fields) x.dispose?.(); } rows.length = 0; for (const row of Array.isArray(v) ? v : []) addRow(row); renumber(); } });
  // the first row field that failed the last validate(): focus() lands on it,
  // not on rows[0].fields[0], so a submit with «0912513» in row 2 puts the
  // keyboard user on that number input. Cleared with the error (setError(null)).
  let invalidField = null;
  const baseValidate = f.validate;
  const baseSetError = f.setError;
  f.setError = msg => { if (!msg) invalidField = null; baseSetError(msg); };
  f.validate = values => {
    let first = null;
    let firstField = null;
    for (const r of rows) { const rv = rowValues(r); for (const x of r.fields) { const m = x.validate(rv); if (m && !first) { first = m; firstField = x; } } }
    const own = baseValidate(values); // may call setError(null) → reset, so assign after it
    invalidField = firstField;
    return own || first;
  };
  f.focus = () => { const target = invalidField || rows[0]?.fields[0]; if (target) target.focus(); else addBtn.focus(); };
  f.focusInvalid = () => { if (!invalidField) return false; invalidField.focus(); return true; };
  f.addRow = (values, o) => { const r = addRow(values, o); f.emit(); return r; };
  f.rows = rows;
  renumber();
  return f;
}
