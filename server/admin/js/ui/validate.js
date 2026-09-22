// Client-side validation. Each validator is (value, values) → message|null,
// messages in Persian. Servers re-validate; this is for fast feedback.
//   validate({ title_fa: [validators.required(), validators.max(200)] }, values) → { ok, errors }
import { STR } from '../strings.js';
import { enDigits } from '../lib/jalali.js';

const empty = v => v === null || v === undefined || (typeof v === 'string' && !v.trim()) || (Array.isArray(v) && !v.length);
const len = v => (typeof v === 'string' ? [...v].length : Array.isArray(v) ? v.length : 0);

export const validators = {
  required: (msg = STR.fields.required) => v => (empty(v) ? msg : null),
  min: (n, msg) => v => (empty(v) || len(v) >= n ? null : msg || STR.fields.minLength(n)),
  max: (n, msg) => v => (empty(v) || len(v) <= n ? null : msg || STR.fields.maxLength(n)),
  pattern: (re, msg = STR.fields.invalid) => v => (empty(v) || re.test(String(v)) ? null : msg),
  email: (msg = STR.fields.email) => v => (empty(v) || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v).trim()) ? null : msg),
  mobile: (msg = STR.fields.mobile) => v => {
    if (empty(v)) return null;
    let d = enDigits(String(v)).replace(/[\s\-.()‌]/g, '');
    if (!/^\+?\d+$/.test(d)) return msg;
    d = d.replace(/^\+/, '');
    if (d.startsWith('0098')) d = d.slice(4); else if (d.startsWith('98') && d.length === 12) d = d.slice(2); else if (d.startsWith('0') && d.length === 11) d = d.slice(1);
    return /^9\d{9}$/.test(d) ? null : msg;
  },
  slug: (msg = STR.fields.slug) => v => (empty(v) || /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(v)) ? null : msg),
  url: ({ https = false } = {}, msg) => v => {
    if (empty(v)) return null;
    let u;
    try { u = new URL(String(v).trim()); } catch { return msg || STR.fields.url; }
    if (https && u.protocol !== 'https:') return msg || STR.fields.https;
    if (!['http:', 'https:'].includes(u.protocol)) return msg || STR.fields.url;
    return null;
  },
  // allows a relative path like /uploads/x.jpg or an absolute http(s) url
  urlOrPath: (msg = STR.fields.url) => v => (empty(v) || /^\//.test(String(v).trim()) ? null : validators.url({}, msg)(v)),
  int: ({ min, max } = {}, msg) => v => {
    if (empty(v)) return null;
    const n = typeof v === 'number' ? v : Number(enDigits(String(v)).replace(/[,٬\s]/g, ''));
    if (!Number.isInteger(n)) return msg || STR.fields.integer;
    if (min !== undefined && n < min) return msg || STR.fields.min(min);
    if (max !== undefined && n > max) return msg || STR.fields.max(max);
    return null;
  },
  number: (msg = STR.fields.number) => v => (empty(v) || Number.isFinite(Number(enDigits(String(v)).replace(/[,٬\s]/g, ''))) ? null : msg),
  json: (msg = STR.fields.json) => v => { if (empty(v)) return null; try { JSON.parse(String(v)); return null; } catch { return msg; } },
  same: (other, msg = STR.fields.mismatch) => (v, values) => (v === (values?.[other] ?? '') ? null : msg),
  custom: fn => fn,
};

export function runValidators(rules, value, values) {
  for (const rule of rules || []) {
    const msg = rule(value, values);
    if (msg) return msg;
  }
  return null;
}

// rules: {field: [validator…]} → {ok, errors:{field: message}}
export function validate(rules, values) {
  const errors = {};
  for (const [key, list] of Object.entries(rules || {})) {
    const msg = runValidators(list, values?.[key], values);
    if (msg) errors[key] = msg;
  }
  return { ok: Object.keys(errors).length === 0, errors };
}

export const isEmptyValue = empty;
