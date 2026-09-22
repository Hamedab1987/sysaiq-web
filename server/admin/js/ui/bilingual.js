// bilingualField: fa + en side by side (fa first = right under RTL, en with
// dir="ltr" lang="en"). Value is {fa, en}; with {flat: true} it reads/writes
// `${name}_fa` / `${name}_en` (the legacy column layout) instead.
//   bilingualField({ name: 'title', label: 'عنوان', required: true, flat: true, maxLength: 200 })
//   bilingualField({ name: 'overview', label: 'معرفی', type: 'markdown', flat: true })
//   bilingualField({ name: '', keys: { fa: 'name_fa', en: 'name_en' } })   // custom keys
import { h } from './dom.js';
import { STR } from '../strings.js';
import { field, textareaField, markdownField } from './form.js';

export function bilingualField(opts = {}) {
  const { name = '', label, hint, required, requiredEn = required, requiredFa = required, type = 'text', maxLength, rows, flat = false, keys, placeholderFa, placeholderEn, rules = [], rulesFa = [], rulesEn = [] } = opts;
  const make = (lang, extra) => {
    const common = { label: lang === 'fa' ? STR.fields.faLabel : STR.fields.enLabel, maxLength, rows, rules: [...rules, ...(lang === 'fa' ? rulesFa : rulesEn)], required: lang === 'fa' ? requiredFa : requiredEn, dir: lang === 'en' ? 'ltr' : undefined, lang: lang === 'en' ? 'en' : 'fa', placeholder: lang === 'fa' ? placeholderFa : placeholderEn, ...extra };
    if (type === 'textarea') return textareaField(common);
    if (type === 'markdown') return markdownField({ ...common, hint: undefined });
    return field(common);
  };
  const fa = make('fa');
  const en = make('en');
  const k = keys || (flat ? { fa: `${name}_fa`, en: `${name}_en` } : null);
  const listeners = new Set();
  const legend = label ? h('div.a-fieldset__legend', label, required ? h('span.a-label__req', { 'aria-hidden': 'true' }, ' *') : null) : null;
  const el = h('div.a-fieldset', { role: 'group', 'aria-label': label || name, dataset: { field: name } }, legend, h('div.a-bi', fa.el, en.el), hint ? h('div.a-hint', hint) : null);
  const f = {
    el, name, type: `bilingual:${type}`, fields: [fa, en], fa, en,
    get value() { return { fa: fa.value, en: en.value }; },
    set value(v) { fa.value = v?.fa ?? ''; en.value = v?.en ?? ''; },
    read(values) {
      if (!values) return;
      if (k) { fa.value = values[k.fa] ?? ''; en.value = values[k.en] ?? ''; }
      else if (name && Object.hasOwn(values, name)) f.value = values[name];
    },
    write(values) {
      if (k) { values[k.fa] = fa.value; values[k.en] = en.value; }
      else if (name) values[name] = f.value;
      return values;
    },
    validate(values) { const a = fa.validate(values); const b = en.validate(values); return a || b; },
    setError(msg) { if (msg && typeof msg === 'object') { fa.setError(msg.fa || null); en.setError(msg.en || null); } else { fa.setError(msg); en.setError(null); } },
    clearError() { fa.setError(null); en.setError(null); },
    focus() { (fa.value ? en : fa).focus(); },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    disable(v) { fa.disable(v); en.disable(v); },
    dispose() { fa.dispose(); en.dispose(); listeners.clear(); },
  };
  const emit = () => { for (const fn of listeners) fn(f.value, f); };
  fa.onChange(emit); en.onChange(emit);
  return f;
}
