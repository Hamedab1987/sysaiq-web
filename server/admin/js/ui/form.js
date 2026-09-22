// Fields + createForm. Every field factory returns a Field object:
//   { el, name, value (get/set), read(values), write(values), validate() → msg|null,
//     setError(msg|null), focus(), onChange(fn) → off, disable(bool), dispose() }
// createForm({ fields, values, onSubmit }) wires them into one <form>:
//   getValues/setValues/reset/isDirty/validate/setErrors/submit/setBusy/destroy
// Persian digits are shown inside numeric inputs; the value written to the
// server is always a Latin number/string.
import { h, icon, uid, clear } from './dom.js';
import { STR } from '../strings.js';
import { validators, runValidators } from './validate.js';
import { toFaDigits, toEnDigits, formatNumber } from './format.js';
import { isoToJalaliInput, jalaliInputToIso, toJalali, toGregorian, jalaliMonthLength, JALALI_MONTHS, JALALI_WEEKDAYS_SHORT, todayJalali, enDigits } from '../lib/jalali.js';
import { registerShortcut } from './shortcuts.js';
import { markDirty } from '../store.js';
import { toast } from './feedback.js';

// ---- base ---------------------------------------------------------------
// makeField wraps a control with label/hint/error and the Field interface.
export function makeField({ name = '', label, hint, required, rules = [], control, get, set, focusEl, lang, dir, type = 'text', inline, labelFor = true, extraLabel, counter, cls }) {
  const id = uid('f');
  const listeners = new Set();
  const errorEl = h('div.a-error', { id: `${id}-err` });
  const hintEl = hint ? h('div.a-hint', { id: `${id}-hint` }, hint) : null;
  const allRules = [...(required ? [validators.required()] : []), ...rules];
  const labelEl = label !== undefined && label !== null
    ? h(labelFor ? 'label.a-label' : 'div.a-label', { for: labelFor ? id : null }, label, required ? h('span.a-label__req', { 'aria-hidden': 'true' }, ' *') : null, extraLabel || null, counter || null)
    : null;
  const el = h('div', { class: ['a-field', inline && 'a-field--inline', cls], dataset: { field: name } }, labelEl, control, hintEl, errorEl);
  const target = focusEl || (control.matches?.('input,textarea,select') ? control : control.querySelector?.('input,textarea,select,button'));
  if (target && labelFor) {
    target.id = id;
    if (hintEl) target.setAttribute('aria-describedby', `${id}-hint`);
    if (required) target.setAttribute('aria-required', 'true');
    if (lang) target.setAttribute('lang', lang);
    if (dir) target.setAttribute('dir', dir);
  }
  const field = {
    el, name, type, id, control,
    get value() { return get(); },
    set value(v) { set(v); },
    read(values) { if (name && values && Object.hasOwn(values, name)) set(values[name]); else if (name) set(undefined); },
    write(values) { if (name) values[name] = get(); return values; },
    validate(values) {
      const msg = runValidators(allRules, get(), values);
      field.setError(msg);
      return msg;
    },
    setError(msg) {
      clear(errorEl);
      el.classList.toggle('is-invalid', !!msg);
      if (msg) { errorEl.append(icon('alert-circle', { size: 'sm' }), String(msg)); target?.setAttribute('aria-invalid', 'true'); target?.setAttribute('aria-errormessage', errorEl.id); }
      else { target?.removeAttribute('aria-invalid'); target?.removeAttribute('aria-errormessage'); }
    },
    clearError() { field.setError(null); },
    focus() { (target || el).focus?.(); (target || el).scrollIntoView?.({ block: 'center', behavior: 'smooth' }); },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    emit() { for (const fn of listeners) fn(get(), field); },
    disable(v = true) { for (const c of el.querySelectorAll('input,textarea,select,button')) c.disabled = !!v; el.classList.toggle('is-disabled', !!v); },
    dispose() { listeners.clear(); },
    rules: allRules,
  };
  return field;
}

function wireInput(input, field, { validateOn = 'blur' } = {}) {
  input.addEventListener('input', () => { if (field.el.classList.contains('is-invalid')) field.validate(); field.emit(); });
  input.addEventListener('change', () => field.emit());
  if (validateOn === 'blur') input.addEventListener('blur', () => { if (String(field.value ?? '').length) field.validate(); });
}

function charCounter(input, max) {
  const el = h('span.a-counter', { 'aria-live': 'off' });
  const update = () => { const n = [...(input.value || '')].length; el.textContent = STR.fields.charCount(n, max); el.classList.toggle('is-over', n > max); };
  input.addEventListener('input', update);
  queueMicrotask(update);
  return { el, update };
}

// ---- text ---------------------------------------------------------------
// field({ name, label, type: 'text'|'email'|'tel'|'url'|'password'|'search', placeholder, hint,
//         required, maxLength, dir: 'ltr', lang: 'en', mono, rules, autocomplete, inputmode, disabled })
export function field(opts = {}) {
  const { name, label, type = 'text', placeholder, hint, required, maxLength, minLength, dir, lang, mono, rules = [], autocomplete, inputmode, disabled, autofocus, spellcheck, suffix, prefix } = opts;
  const input = h('input', { class: ['a-input', mono && 'a-mono', dir === 'ltr' && 'a-ltr', suffix && 'a-input--affixed'], type, placeholder, autocomplete, inputmode, disabled, autofocus, spellcheck: spellcheck === false ? 'false' : null, maxlength: maxLength ? maxLength : null });
  const r = [...rules];
  if (maxLength) r.push(validators.max(maxLength));
  if (minLength) r.push(validators.min(minLength));
  if (type === 'email') r.push(validators.email());
  if (type === 'url') r.push(validators.url());
  if (type === 'tel') r.push(validators.mobile());
  const counter = maxLength && opts.counter ? charCounter(input, maxLength) : null;
  const control = suffix || prefix
    ? h('div.a-input-wrap', input, h('span.a-input-wrap__affix', suffix || prefix))
    : input;
  const f = makeField({ ...opts, rules: r, control, focusEl: input, counter: counter?.el, type,
    get: () => (type === 'tel' ? toEnDigits(input.value) : input.value),
    set: v => { input.value = v === undefined || v === null ? '' : String(v); counter?.update(); } });
  wireInput(input, f);
  return f;
}

export function textareaField(opts = {}) {
  const { name, label, placeholder, hint, required, maxLength, rows = 4, dir, lang, mono, rules = [], disabled } = opts;
  const ta = h('textarea', { class: ['a-textarea', mono && 'a-mono', dir === 'ltr' && 'a-ltr'], placeholder, rows, disabled, maxlength: maxLength || null });
  const r = [...rules];
  if (maxLength) r.push(validators.max(maxLength));
  const counter = maxLength ? charCounter(ta, maxLength) : null;
  const f = makeField({ ...opts, rules: r, control: ta, type: 'textarea', counter: counter?.el,
    get: () => ta.value, set: v => { ta.value = v === undefined || v === null ? '' : String(v); counter?.update(); } });
  wireInput(ta, f);
  return f;
}

// ---- select -------------------------------------------------------------
// options: [{value, label, disabled}] or ['a','b'] ; placeholder adds an empty option
export function selectField(opts = {}) {
  const { options = [], placeholder, required, disabled, ltr } = opts;
  const sel = h('select', { class: ['a-select', ltr && 'a-ltr'], disabled });
  if (placeholder) sel.appendChild(h('option', { value: '' }, placeholder));
  for (const o of options) {
    const opt = typeof o === 'object' ? o : { value: o, label: String(o) };
    sel.appendChild(h('option', { value: String(opt.value), disabled: opt.disabled }, opt.label));
  }
  const f = makeField({ ...opts, control: sel, type: 'select', get: () => sel.value, set: v => { sel.value = v === undefined || v === null ? '' : String(v); if (sel.value !== String(v ?? '') && !placeholder && sel.options.length) sel.selectedIndex = 0; } });
  wireInput(sel, f, { validateOn: 'change' });
  f.setOptions = list => { clear(sel); if (placeholder) sel.appendChild(h('option', { value: '' }, placeholder)); for (const o of list) { const opt = typeof o === 'object' ? o : { value: o, label: String(o) }; sel.appendChild(h('option', { value: String(opt.value) }, opt.label)); } };
  return f;
}

// ---- switch (boolean) ---------------------------------------------------
export function switchField(opts = {}) {
  const { label, hint, onText = STR.states.on, offText = STR.states.off, disabled, showState = true } = opts;
  const input = h('input', { type: 'checkbox', role: 'switch', disabled });
  const state = h('span.a-switch__state', offText);
  const control = h('label.a-switch', input, h('span.a-switch__track', { 'aria-hidden': 'true' }), h('span.a-switch__text', label), showState ? state : null);
  const f = makeField({ ...opts, label: undefined, hint, control, focusEl: input, type: 'switch', labelFor: false,
    get: () => !!input.checked, set: v => { input.checked = v === true || v === 1 || v === '1' || v === 'true'; state.textContent = input.checked ? onText : offText; } });
  input.addEventListener('change', () => { state.textContent = input.checked ? onText : offText; f.emit(); });
  input.setAttribute('aria-describedby', hint ? `${f.id}-hint` : '');
  return f;
}

// ---- numbers ------------------------------------------------------------
const parseNum = s => {
  const t = toEnDigits(String(s ?? '')).replace(/[,٬\s‌]/g, '').replace(/[٫]/g, '.').trim();
  if (t === '' || t === '-') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
};
export function numberField(opts = {}) {
  const { min, max, integer = true, suffix, placeholder, disabled, nullable = true } = opts;
  const input = h('input', { class: ['a-input', 'a-num', suffix && 'a-input--affixed'], type: 'text', inputmode: integer ? 'numeric' : 'decimal', placeholder, disabled, dir: 'ltr' });
  const rules = [integer ? validators.int({ min, max }) : validators.number(), ...(opts.rules || [])];
  if (!integer && (min !== undefined || max !== undefined)) rules.push(v => { const n = parseNum(v); if (n === null || Number.isNaN(n)) return null; if (min !== undefined && n < min) return STR.fields.min(min); if (max !== undefined && n > max) return STR.fields.max(max); return null; });
  const control = suffix ? h('div.a-input-wrap', input, h('span.a-input-wrap__affix', suffix)) : input;
  const f = makeField({ ...opts, rules, control, focusEl: input, type: 'number',
    get: () => { const n = parseNum(input.value); return n === null ? (nullable ? null : 0) : (Number.isNaN(n) ? input.value : n); },
    set: v => { input.value = v === null || v === undefined || v === '' ? '' : toFaDigits(String(v)); } });
  input.addEventListener('input', () => { const pos = input.selectionStart; const before = input.value; input.value = toFaDigits(before); if (pos !== null) try { input.setSelectionRange(pos, pos); } catch { /* not supported */ } });
  wireInput(input, f);
  return f;
}
// integer toman with live «٬» grouping; value = integer | null
export function moneyField(opts = {}) {
  const { min = 0, max, placeholder, disabled, unit = 'تومان' } = opts;
  const input = h('input.a-input.a-num.a-input--affixed', { type: 'text', inputmode: 'numeric', placeholder, disabled, dir: 'ltr' });
  const control = h('div.a-input-wrap', input, h('span.a-input-wrap__affix', unit));
  const rules = [validators.int({ min, max }), ...(opts.rules || [])];
  const render = n => (n === null || n === undefined || n === '' ? '' : formatNumber(n));
  const f = makeField({ ...opts, rules, control, focusEl: input, type: 'money',
    get: () => { const n = parseNum(input.value); return n === null ? null : (Number.isNaN(n) ? input.value : Math.trunc(n)); },
    set: v => { input.value = render(v); } });
  input.addEventListener('input', () => { const n = parseNum(input.value); if (n !== null && !Number.isNaN(n)) input.value = render(n); });
  wireInput(input, f);
  return f;
}

// ---- Jalali date --------------------------------------------------------
// value: 'YYYY-MM-DD' (Gregorian, Latin) or '' ; typed input accepts ۱۴۰۵/۰۶/۳۱ or 1405/6/31
export function dateFieldJalali(opts = {}) {
  const { placeholder = '۱۴۰۵/۰۶/۳۱', disabled, min, max } = opts;
  const input = h('input.a-input.a-num', { type: 'text', inputmode: 'numeric', placeholder, disabled, autocomplete: 'off', dir: 'ltr' });
  const openBtn = h('button.a-input-wrap__btn', { type: 'button', 'aria-label': 'انتخاب از تقویم', 'aria-haspopup': 'dialog' }, icon('calendar', { size: 'sm' }));
  const wrap = h('div.a-date', h('div.a-input-wrap', input, openBtn));
  let iso = '';
  const rules = [v => (v === null ? STR.fields.date : null), v => (v && min && v < min ? STR.fields.min(isoToJalaliInput(min)) : null), v => (v && max && v > max ? STR.fields.max(isoToJalaliInput(max)) : null), ...(opts.rules || [])];
  const f = makeField({ ...opts, rules, control: wrap, focusEl: input, type: 'date',
    get: () => { const t = input.value.trim(); if (!t) return ''; const v = jalaliInputToIso(t); return v === null ? null : v; },
    set: v => { iso = v ? String(v).slice(0, 10) : ''; input.value = iso ? isoToJalaliInput(iso) : ''; } });
  input.addEventListener('input', () => { input.value = toFaDigits(input.value); if (f.el.classList.contains('is-invalid')) f.validate(); f.emit(); });
  input.addEventListener('blur', () => { const v = f.value; if (v) { iso = v; input.value = isoToJalaliInput(v); f.setError(null); } else if (v === null) f.validate(); });

  let pop = null;
  const closePop = () => { if (pop) { pop.remove(); pop = null; document.removeEventListener('mousedown', outside); document.removeEventListener('keydown', esc); } };
  const outside = e => { if (pop && !wrap.contains(e.target)) closePop(); };
  const esc = e => { if (e.key === 'Escape') { e.stopPropagation(); closePop(); openBtn.focus(); } };
  const openPop = () => {
    if (pop) return closePop();
    const cur = f.value && f.value !== null ? f.value : '';
    let [jy, jm] = cur ? toJalali(...cur.split('-').map(Number)) : todayJalali();
    const selected = cur;
    const [ty, tm, td] = todayJalali();
    pop = h('div.a-date__pop', { role: 'dialog', 'aria-label': 'تقویم' });
    const render = () => {
      clear(pop);
      const title = h('div.a-date__title', `${JALALI_MONTHS[jm - 1]} ${toFaDigits(jy)}`);
      const nav = (d, lbl, ic) => h('button.a-btn.a-btn--subtle.a-btn--icon.a-btn--sm', { type: 'button', 'aria-label': lbl, onclick: () => { jm += d; if (jm < 1) { jm = 12; jy--; } if (jm > 12) { jm = 1; jy++; } render(); } }, icon(ic, { size: 'sm' }));
      pop.appendChild(h('div.a-date__head', nav(-1, STR.fields.prevMonth, 'chevron-right'), title, nav(1, STR.fields.nextMonth, 'chevron-left')));
      const grid = h('div.a-date__grid', { role: 'grid' });
      for (const d of JALALI_WEEKDAYS_SHORT) grid.appendChild(h('div.a-date__dow', d));
      const [gy, gm, gd] = toGregorian(jy, jm, 1);
      const firstDow = (new Date(Date.UTC(gy, gm - 1, gd)).getUTCDay() + 1) % 7; // Saturday = 0
      for (let i = 0; i < firstDow; i++) grid.appendChild(h('div'));
      const n = jalaliMonthLength(jy, jm);
      for (let d = 1; d <= n; d++) {
        const [y, m, dd] = toGregorian(jy, jm, d);
        const isoDay = `${y}-${String(m).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
        const dow = (firstDow + d - 1) % 7;
        grid.appendChild(h('button.a-date__day', { type: 'button', class: [isoDay === selected && 'is-selected', jy === ty && jm === tm && d === td && 'is-today', dow === 6 && 'is-holiday'], 'aria-label': `${toFaDigits(d)} ${JALALI_MONTHS[jm - 1]} ${toFaDigits(jy)}`, onclick: () => { f.value = isoDay; f.setError(null); f.emit(); closePop(); input.focus(); } }, toFaDigits(d)));
      }
      pop.appendChild(grid);
      pop.appendChild(h('div.a-date__foot',
        h('button.a-btn.a-btn--subtle.a-btn--sm', { type: 'button', onclick: () => { f.value = ''; f.emit(); closePop(); } }, STR.fields.clearDate),
        h('button.a-btn.a-btn--subtle.a-btn--sm', { type: 'button', onclick: () => { const [a, b, c] = toGregorian(ty, tm, td); f.value = `${a}-${String(b).padStart(2, '0')}-${String(c).padStart(2, '0')}`; f.setError(null); f.emit(); closePop(); } }, STR.fields.today)));
    };
    render();
    wrap.appendChild(pop);
    document.addEventListener('mousedown', outside);
    document.addEventListener('keydown', esc);
    pop.querySelector('.is-selected, .is-today, .a-date__day')?.focus();
  };
  openBtn.addEventListener('click', openPop);
  f.dispose = () => closePop();
  return f;
}

// ---- tags ---------------------------------------------------------------
// value: string[] ; {join: ' · '} makes read/write use a joined string instead
export function tagsField(opts = {}) {
  const { placeholder = STR.fields.addTag, ltr = false, join, max = 50, maxLength = 60, disabled, suggestions = [] } = opts;
  let tags = [];
  const input = h('input.a-tags__input', { type: 'text', placeholder, disabled, autocomplete: 'off', list: suggestions.length ? uid('dl') : null });
  const box = h('div', { class: ['a-tags', ltr && 'a-tags--ltr'], onclick: e => { if (e.target === box) input.focus(); } });
  if (suggestions.length) box.appendChild(h('datalist', { id: input.getAttribute('list') }, suggestions.map(s => h('option', { value: s }))));
  const render = () => {
    for (const c of [...box.querySelectorAll('.a-tags__chip')]) c.remove();
    tags.forEach((t, i) => box.insertBefore(h('span.a-tags__chip', h('span', t), h('button', { type: 'button', 'aria-label': `${STR.actions.remove} ${t}`, onclick: () => { tags.splice(i, 1); render(); f.emit(); } }, icon('x', { size: 'sm' }))), input));
  };
  const add = raw => {
    const parts = String(raw).split(/[,،؛;\n]/).map(s => s.trim()).filter(Boolean);
    let changed = false;
    for (const p of parts) { const t = p.slice(0, maxLength); if (!tags.includes(t) && tags.length < max) { tags.push(t); changed = true; } }
    if (changed) { render(); f.emit(); }
    input.value = '';
  };
  input.addEventListener('keydown', e => {
    if ((e.key === 'Enter' || e.key === ',' || e.key === '،') && input.value.trim()) { e.preventDefault(); add(input.value); }
    else if (e.key === 'Backspace' && !input.value && tags.length) { tags.pop(); render(); f.emit(); }
  });
  input.addEventListener('blur', () => { if (input.value.trim()) add(input.value); });
  input.addEventListener('paste', e => { const t = e.clipboardData?.getData('text') || ''; if (/[,،;\n]/.test(t)) { e.preventDefault(); add(t); } });
  box.appendChild(input);
  const f = makeField({ ...opts, control: box, focusEl: input, type: 'tags',
    get: () => (join !== undefined ? tags.join(join) : [...tags]),
    set: v => { tags = Array.isArray(v) ? v.map(String) : (v ? String(v).split(join ?? /[,،]/).map(s => s.trim()).filter(Boolean) : []); render(); } });
  return f;
}

// ---- slug ---------------------------------------------------------------
export const slugify = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
// slugField({ name, label, from: 'title_en' (auto until edited), prefix: '/en/work/', unique: slug => bool|Promise<bool>, required })
export function slugField(opts = {}) {
  const { prefix = '/', unique, disabled, from } = opts;
  const input = h('input.a-input.a-ltr.a-mono', { type: 'text', dir: 'ltr', lang: 'en', spellcheck: 'false', autocomplete: 'off', disabled, placeholder: 'my-page' });
  const preview = h('div.a-slug__preview', { dir: 'ltr' });
  const warn = h('div.a-hint.a-slug__warn');
  let touched = false;
  const rules = [validators.slug(), ...(opts.rules || [])];
  const f = makeField({ ...opts, rules, control: h('div.a-stack.a-stack--sm', input, preview, warn), focusEl: input, type: 'slug', hint: opts.hint ?? (from ? STR.fields.autoSlug : undefined),
    get: () => input.value.trim(), set: v => { input.value = v ? String(v) : ''; touched = !!v; renderPreview(); } });
  const renderPreview = () => { clear(preview); preview.append(`${STR.fields.slugPreview}: ${prefix}`, h('b', input.value.trim() || '…')); };
  let checkTimer = null;
  const checkUnique = async () => {
    warn.textContent = '';
    if (!unique || !input.value.trim()) return;
    const ok = await unique(input.value.trim());
    if (ok === false) { warn.textContent = STR.fields.slugTaken; f.setError(STR.fields.slugTaken); } else if (f.el.classList.contains('is-invalid') && !runValidators(rules, input.value.trim())) f.setError(null);
  };
  input.addEventListener('input', () => { touched = true; const pos = input.selectionStart; input.value = input.value.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-{2,}/g, '-'); try { input.setSelectionRange(pos, pos); } catch { /* n/a */ } renderPreview(); if (f.el.classList.contains('is-invalid')) f.validate(); clearTimeout(checkTimer); checkTimer = setTimeout(checkUnique, 350); f.emit(); });
  input.addEventListener('blur', () => { input.value = slugify(input.value) || input.value; renderPreview(); if (input.value) f.validate(); f.emit(); });
  // auto-fill from another field until the owner edits the slug by hand
  f.followField = source => source.onChange(v => { if (!touched || !input.value) { input.value = slugify(v); renderPreview(); clearTimeout(checkTimer); checkTimer = setTimeout(checkUnique, 350); f.emit(); } });
  f.from = from;
  f.recheck = checkUnique;
  renderPreview();
  return f;
}

// ---- secret -------------------------------------------------------------
// value '' means "keep the stored one". Shows configured state + masked hint; never pre-fills.
export function secretField(opts = {}) {
  const { configured = false, maskHint = '', placeholder = 'sk-…', disabled } = opts;
  const input = h('input.a-input.a-ltr.a-mono', { type: 'password', dir: 'ltr', autocomplete: 'off', spellcheck: 'false', placeholder, disabled });
  let shown = false;
  const eye = h('button.a-input-wrap__btn', { type: 'button', 'aria-label': STR.auth.showPassword, 'aria-pressed': 'false', onclick: () => { shown = !shown; input.type = shown ? 'text' : 'password'; eye.setAttribute('aria-pressed', String(shown)); eye.setAttribute('aria-label', shown ? STR.auth.hidePassword : STR.auth.showPassword); clear(eye); eye.appendChild(icon(shown ? 'eye-off' : 'eye', { size: 'sm' })); } }, icon('eye', { size: 'sm' }));
  const status = h('div.a-secret__status',
    icon(configured ? 'check-circle' : 'alert-circle', { size: 'sm', cls: configured ? 'a-ok' : 'a-warn' }),
    configured ? STR.states.configured : STR.states.notConfigured,
    configured && maskHint ? h('code', { dir: 'ltr' }, maskHint) : null);
  const f = makeField({ ...opts, hint: opts.hint ?? (configured ? STR.fields.keepCurrent : undefined), control: h('div.a-stack.a-stack--sm', status, h('div.a-input-wrap', input, eye)), focusEl: input, type: 'secret',
    get: () => input.value.trim(), set: () => { input.value = ''; } });
  wireInput(input, f);
  f.setStatus = (isConfigured, hint) => { clear(status); status.append(icon(isConfigured ? 'check-circle' : 'alert-circle', { size: 'sm', cls: isConfigured ? 'a-ok' : 'a-warn' }), isConfigured ? STR.states.configured : STR.states.notConfigured, isConfigured && hint ? h('code', { dir: 'ltr' }, hint) : ''); };
  return f;
}

// ---- code (LTR mono) ----------------------------------------------------
export function codeField(opts = {}) {
  const { rows = 8, json = false, placeholder, disabled } = opts;
  const ta = h('textarea.a-textarea.a-textarea--code', { rows, placeholder, disabled, dir: 'ltr', spellcheck: 'false', autocapitalize: 'off', autocorrect: 'off' });
  ta.addEventListener('keydown', e => { if (e.key === 'Tab' && !e.shiftKey) { e.preventDefault(); const s = ta.selectionStart, en = ta.selectionEnd; ta.setRangeText('  ', s, en, 'end'); ta.dispatchEvent(new Event('input')); } });
  const rules = [...(json ? [validators.json()] : []), ...(opts.rules || [])];
  const f = makeField({ ...opts, rules, control: ta, type: 'code',
    get: () => (json ? (() => { const t = ta.value.trim(); if (!t) return null; try { return JSON.parse(t); } catch { return ta.value; } })() : ta.value),
    set: v => { ta.value = v === null || v === undefined ? '' : (json && typeof v !== 'string' ? JSON.stringify(v, null, 2) : String(v)); } });
  wireInput(ta, f);
  return f;
}

// ---- markdown (subset: h2–h4, p, lists, strong/em, links, blockquote) ---
export function markdownField(opts = {}) {
  const { rows = 12, placeholder, disabled, maxLength, dir, lang } = opts;
  const ta = h('textarea.a-textarea', { rows, placeholder, disabled, class: dir === 'ltr' && 'a-ltr', maxlength: maxLength || null });
  const wrapSel = (before, after = before, block = false) => {
    const s = ta.selectionStart, e = ta.selectionEnd;
    const sel = ta.value.slice(s, e) || (block ? 'عنوان' : 'متن');
    let ins = `${before}${sel}${after}`;
    if (block) { const atLine = s === 0 || ta.value[s - 1] === '\n'; ins = `${atLine ? '' : '\n'}${before}${sel}`; }
    ta.setRangeText(ins, s, e, 'select');
    ta.focus();
    ta.dispatchEvent(new Event('input'));
  };
  const btn = (ic, lbl, fn) => h('button.a-btn.a-btn--icon.a-btn--sm', { type: 'button', title: lbl, 'aria-label': lbl, onclick: fn }, icon(ic, { size: 'sm' }));
  const bar = h('div.a-mdbar', { role: 'toolbar', 'aria-label': 'قالب‌بندی' },
    btn('heading', 'تیتر', () => wrapSel('## ', '', true)),
    btn('bold', 'پررنگ', () => wrapSel('**')),
    btn('italic', 'تأکید', () => wrapSel('*')),
    btn('list', 'فهرست', () => wrapSel('- ', '', true)),
    btn('link', 'پیوند', () => { const s = ta.selectionStart, e = ta.selectionEnd; const sel = ta.value.slice(s, e) || 'متن پیوند'; ta.setRangeText(`[${sel}](https://)`, s, e, 'end'); ta.focus(); ta.dispatchEvent(new Event('input')); }),
    btn('minus', 'خط جداکننده', () => wrapSel('\n---\n', '', true)),
  );
  const counter = maxLength ? charCounter(ta, maxLength) : null;
  const rules = [...(maxLength ? [validators.max(maxLength)] : []), ...(opts.rules || [])];
  const f = makeField({ ...opts, rules, control: h('div', bar, ta), focusEl: ta, type: 'markdown', counter: counter?.el, hint: opts.hint ?? 'Markdown ساده: ## تیتر، **پررنگ**، *تأکید*، - فهرست، [پیوند](https://…)',
    get: () => ta.value, set: v => { ta.value = v === null || v === undefined ? '' : String(v); counter?.update(); } });
  if (lang) ta.setAttribute('lang', lang);
  if (dir) ta.setAttribute('dir', dir);
  wireInput(ta, f);
  return f;
}

// ---- createForm ---------------------------------------------------------
let lastActiveForm = null;
export function activeForm() { return lastActiveForm; }

// createForm({ fields: [Field|Node|{title, hint, fields, columns}], values, onSubmit(values, form),
//              onChange(values, form), onDirty(bool), render(byName) → Node, dirtyToken, submitOnEnter })
export function createForm(opts = {}) {
  const { fields = [], values, onSubmit, onChange, onDirty, render, submitOnEnter = false, id = uid('form') } = opts;
  const list = [];   // Field objects
  const byName = {};
  // a Field (has read/write) is a leaf even when it owns inner fields (repeater rows);
  // a plain {title, fields} object is a section to recurse into
  const collect = items => { for (const it of items) { if (!it) continue; if (Array.isArray(it)) collect(it); else if (it.read && it.write) { list.push(it); if (it.name) byName[it.name] = it; } else if (it.fields) collect(it.fields); } };
  collect(fields);
  const banner = h('div.a-form__banner', { role: 'alert', hidden: true });
  const el = h('form.a-form', { id, novalidate: true, autocomplete: 'off' }, banner);

  const layout = items => {
    const out = [];
    for (const it of items) {
      if (!it) continue;
      if (it instanceof Node) out.push(it);
      else if (it.el) out.push(it.el);
      else if (it.fields) {
        const grid = h('div', { class: ['a-form__grid', it.columns === 2 && 'a-form__grid--2', it.columns === 3 && 'a-form__grid--3'] }, layout(it.fields));
        out.push(h('section.a-form__section', it.title ? h('h3', it.title) : null, it.hint ? h('div.a-hint', it.hint) : null, grid));
      }
    }
    return out;
  };
  el.append(...(render ? [render(byName, list)] : layout(fields)));

  let snapshot = '';
  let busy = false;
  let dirty = false;
  const token = opts.dirtyToken || id;
  const form = {
    el, fields: list, byName, id,
    getValues() { const v = {}; for (const f of list) f.write(v); return v; },
    setValues(vals = {}, { keepDirty = false } = {}) { for (const f of list) f.read(vals); if (!keepDirty) form.markClean(); else form.checkDirty(); },
    reset() { form.setValues(JSON.parse(snapshot || '{}')); form.clearErrors(); },
    markClean() { snapshot = JSON.stringify(form.getValues()); form.setDirtyState(false); },
    checkDirty() { form.setDirtyState(JSON.stringify(form.getValues()) !== snapshot); },
    isDirty() { return dirty; },
    setDirtyState(d) { if (d === dirty) return; dirty = d; markDirty(token, d); onDirty?.(d, form); },
    validate() {
      const vals = form.getValues();
      let first = null;
      for (const f of list) { const msg = f.validate(vals); if (msg && !first) first = f; }
      if (first) first.focus();
      return !first;
    },
    clearErrors() { for (const f of list) f.setError(null); banner.hidden = true; clear(banner); },
    setErrors(errors = {}, { message } = {}) {
      form.clearErrors();
      const unknown = [];
      let first = null;
      for (const [key, msg] of Object.entries(errors)) {
        const base = key.split(/[.[]/)[0];
        const f = byName[key] || byName[base];
        if (f) { f.setError(msg); if (!first) first = f; } else unknown.push(`${key}: ${msg}`);
      }
      if (message || unknown.length) { clear(banner); banner.append(icon('alert-circle'), h('div', message ? h('div', message) : null, unknown.map(u => h('div.a-small', u)))); banner.hidden = false; }
      if (first) first.focus();
    },
    setBusy(b) { busy = !!b; el.classList.toggle('is-busy', busy); for (const btn of el.querySelectorAll('button[type="submit"]')) { btn.disabled = busy; btn.classList.toggle('is-busy', busy); } el.dispatchEvent(new CustomEvent('form:busy', { detail: busy })); },
    get busy() { return busy; },
    async submit() {
      if (busy) return false;
      lastActiveForm = form;
      banner.hidden = true;
      if (!form.validate()) return false;
      if (!onSubmit) return true;
      form.setBusy(true);
      try {
        const r = await onSubmit(form.getValues(), form);
        if (r !== false) form.markClean();
        return r !== false;
      } catch (e) {
        if (e?.status === 422 && e.fields) form.setErrors(e.fields, { message: e.message });
        else if (e?.status === 403 && e.fields) form.setErrors(e.fields, { message: e.message });
        else if (e?.message) toast.error(e.message);
        else toast.error(STR.states.error);
        return false;
      } finally { form.setBusy(false); }
    },
    destroy() { offShortcut(); for (const f of list) f.dispose?.(); markDirty(token, false); if (lastActiveForm === form) lastActiveForm = null; },
  };
  for (const f of list) f.onChange(() => { form.checkDirty(); onChange?.(form.getValues(), form); });
  el.addEventListener('submit', e => { e.preventDefault(); form.submit(); });
  el.addEventListener('focusin', () => { lastActiveForm = form; });
  el.addEventListener('input', () => { lastActiveForm = form; });
  // Enter inside a text input: submit only when asked (login), otherwise
  // swallow it so a stray Enter never saves a half-edited record
  el.addEventListener('keydown', e => {
    if (e.key !== 'Enter' || !(e.target instanceof HTMLInputElement) || e.target.matches('.a-tags__input') || e.target.type === 'submit') return;
    e.preventDefault();
    if (submitOnEnter) form.submit();
  });
  const offShortcut = registerShortcut('mod+s', () => form.submit(), { inFields: true, when: () => lastActiveForm === form || el.contains(document.activeElement) });
  if (values) form.setValues(values); else form.markClean();
  return form;
}

// convenience: a submit button wired to a form
export function submitButton(form, { label = STR.actions.save, icon: ic = 'save', kind = 'primary', busyLabel = STR.actions.saving } = {}) {
  const text = h('span', label);
  const btn = h('button', { type: 'submit', form: form.id, class: ['a-btn', `a-btn--${kind}`] }, ic ? icon(ic) : null, text);
  form.el.addEventListener('form:busy', e => { text.textContent = e.detail ? busyLabel : label; });
  return btn;
}

export { validators, toFaDigits, toEnDigits, enDigits };
