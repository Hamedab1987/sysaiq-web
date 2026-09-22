// SMS templates: {{var}} rendering with sanitised values, length caps and
// the 70/67 (Persian) · 160/153 (GSM-7) segment counter.
//   render('lead_customer', 'fa', { name: 'سارا' }) → { text, chars, segments, unicode, vars, template }
// Throws SmsError template_missing / template_disabled / missing_var / too_long.
import { db } from '../db/index.js';
import { J } from '../lib/html.js';
import { SmsError } from './errors.js';

export const VAR_RE = /\{\{\s*([a-z][a-z0-9_]*)\s*\}\}/g;
export const KEY_RE = /^[a-z][a-z0-9_]{1,39}$/;
export const LIMITS = Object.freeze({
  varChars: 120,      // one variable value
  textChars: 500,     // rendered / free text (≈ 7 Persian segments)
  bodyChars: 1000,    // stored template body
  maxSegments: 7,
});
export const SEGMENT = Object.freeze({ unicode: { single: 70, multi: 67 }, gsm: { single: 160, multi: 153 } });

// labels for the admin UI (variables are plain keys in the DB)
export const VARIABLE_LABELS = Object.freeze({
  id: { fa: 'شمارهٔ سرنخ', en: 'Lead id' },
  name: { fa: 'نام', en: 'Name' },
  phone: { fa: 'شمارهٔ تماس', en: 'Phone' },
  service: { fa: 'خدمت درخواستی', en: 'Requested service' },
  number: { fa: 'شمارهٔ فاکتور', en: 'Invoice number' },
  amount: { fa: 'مبلغ (تومان)', en: 'Amount (Toman)' },
  code: { fa: 'کد لینک پرداخت', en: 'Pay-link code' },
  ref: { fa: 'کد پیگیری پرداخت', en: 'Payment reference' },
  status: { fa: 'وضعیت پرداخت', en: 'Payment status' },
});

// GSM-7 basic set + extension (a message entirely inside it packs 160/153)
const GSM7 = new Set('@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ\fÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà^{}\\[~]|€'.split(''));
export const isGsm7 = text => [...String(text)].every(c => GSM7.has(c));

export function countSegments(text) {
  const s = String(text ?? '');
  const unicode = !isGsm7(s);
  // GSM-7 extension characters cost two septets
  const chars = unicode ? [...s].length : [...s].reduce((n, c) => n + ('^{}\\[~]|€'.includes(c) ? 2 : 1), 0);
  const lim = unicode ? SEGMENT.unicode : SEGMENT.gsm;
  const segments = chars === 0 ? 0 : chars <= lim.single ? 1 : Math.ceil(chars / lim.multi);
  return { chars, segments, unicode };
}

// values are strings: control and zero-width characters dropped (ZWNJ
// U+200C stays; Persian needs it), whitespace collapsed, braces removed
// (a value can't inject another placeholder), capped
export function sanitizeVar(value, max = LIMITS.varChars) {
  let s = value === undefined || value === null ? '' : String(value);
  s = s.replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f\u{200b}\u{2060}\u{feff}]/gu, '').replace(/[{}]/g, '').replace(/\s+/g, ' ').trim();
  return [...s].slice(0, max).join('');
}

export function sanitizeVars(vars) {
  const out = {};
  for (const [k, v] of Object.entries(vars && typeof vars === 'object' ? vars : {})) {
    if (/^[a-z][a-z0-9_]*$/.test(k)) out[k] = sanitizeVar(v);
  }
  return out;
}

export const placeholdersOf = body => [...new Set([...String(body ?? '').matchAll(VAR_RE)].map(m => m[1]))];

// body + sanitised vars → text; every placeholder must have a value
export function renderText(body, vars) {
  const clean = sanitizeVars(vars);
  const missing = placeholdersOf(body).filter(k => !(k in clean) || clean[k] === '');
  if (missing.length) throw new SmsError('missing_var', { message: `missing: ${missing.join(', ')}` });
  const text = String(body ?? '').replace(VAR_RE, (_m, k) => clean[k]).replace(/[ \t]+/g, ' ').trim();
  if (!text) throw new SmsError('empty_text');
  const count = countSegments(text);
  if (count.chars > LIMITS.textChars || count.segments > LIMITS.maxSegments) throw new SmsError('too_long', { message: `${count.chars} chars / ${count.segments} segments` });
  return { text, vars: clean, ...count };
}

export function parseTemplateRow(row) {
  if (!row) return null;
  return {
    ...row,
    variables: J(row.variables, []).filter(x => typeof x === 'string'),
    provider_map: J(row.provider_map, {}),
    is_system: !!row.is_system,
    enabled: !!row.enabled,
  };
}

let stmts = null;
const q = () => stmts ||= {
  byKey: db.prepare('SELECT * FROM sms_templates WHERE key=?'),
  all: db.prepare('SELECT * FROM sms_templates ORDER BY is_system DESC, id ASC'),
};

export const getTemplate = key => parseTemplateRow(q().byKey.get(String(key || '')));
export const listTemplates = () => q().all.all().map(parseTemplateRow);

export function bodyFor(template, lang) {
  return (lang === 'en' && template.body_en) ? template.body_en : (template.body_fa || template.body_en);
}

export function render(templateKey, lang, vars) {
  const template = getTemplate(templateKey);
  if (!template) throw new SmsError('template_missing', { message: String(templateKey) });
  if (!template.enabled) throw new SmsError('template_disabled', { message: String(templateKey) });
  const out = renderText(bodyFor(template, lang), vars);
  return { ...out, lang: lang === 'en' && template.body_en ? 'en' : 'fa', template };
}

// sample values so the admin can preview / test-send a template
export function sampleVars(template) {
  const samples = { id: '123', name: 'سارا احمدی', phone: '09121234567', service: 'وب‌سایت سفارشی', number: 'SQ-1405-0001', amount: '۱۲٬۵۰۰٬۰۰۰', code: 'a1b2c3d4e5f6', ref: '123456789', status: 'موفق' };
  const out = {};
  for (const k of new Set([...(template?.variables || []), ...placeholdersOf(template?.body_fa), ...placeholdersOf(template?.body_en)])) {
    out[k] = samples[k] || 'نمونه';
  }
  return out;
}
