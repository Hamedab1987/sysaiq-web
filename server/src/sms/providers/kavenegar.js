// Kavenegar — https://api.kavenegar.com/v1/{APIKEY}/… (key in the URL path,
// so every request carries redactUrl and nothing here ever logs a URL).
// Verified 2026-09-22 (iran-sms-providers skill); the delivery status table
// is marked VERIFY there — mapped below from the public docs.
import { SmsError } from '../errors.js';
import { toFaDigits } from '../../lib/normalize.js';
import { pick, str, num, httpStatusError, requireField } from './common.js';

const HOST = 'api.kavenegar.com';
const ID = 'kavenegar';

// lookup slots. The three default ones are filled in declaration order and
// (VERIFY) reject spaces; token10/token20 allow spaces, so names and other
// free text must be mapped there explicitly. A template with more variables
// than default slots needs a complete `tokens` map (validateMap enforces it).
export const DEFAULT_SLOTS = Object.freeze(['token', 'token2', 'token3']);
export const ALL_SLOTS = Object.freeze([...DEFAULT_SLOTS, 'token10', 'token20']);
const SLOT_RE = /^token(2|3|10|20)?$/;
export const MAP_HELP = Object.freeze({
  fa: 'نگاشت الگو: {template: «نام الگو در پنل کاوه‌نگار», tokens: {نام‌متغیر: اسلات}}. اسلات‌ها token، token2، token3، token10 و token20 هستند؛ سه اسلات اول فاصله نمی‌پذیرند، پس مقدارهای دارای فاصله (مثل نام مشتری یا نام خدمت) را به token10 یا token20 بدهید. قالبی که بیش از سه متغیر دارد باید برای همهٔ متغیرها اسلات مشخص کند.',
  en: 'Pattern map: {template: "name in the Kavenegar panel", tokens: {variable: slot}}. Slots are token, token2, token3, token10 and token20; the first three reject spaces, so values with spaces (customer name, service) must go to token10 or token20. A template with more than three variables must map every variable.',
});

export const redactUrl = url => String(url).replace(/(\/v1\/)[^/]+(\/)/, '$1***$2');
const base = ctx => `https://${HOST}/v1/${encodeURIComponent(ctx.secret)}`;

// return.status → normalised code (docs: 200 OK … 432 template param)
const STATUS_CODES = {
  400: 'validation', 401: 'auth', 402: 'disabled', 403: 'auth', 404: 'bad_response', 405: 'validation',
  406: 'validation', 407: 'auth', 409: 'server_error', 411: 'bad_mobile', 412: 'line', 413: 'validation',
  414: 'rate_limited', 415: 'validation', 416: 'auth', 417: 'template', 418: 'no_credit', 419: 'rate_limited',
  420: 'validation', 422: 'validation', 424: 'template', 426: 'disabled', 428: 'validation', 431: 'validation', 432: 'template',
};

// delivery `status` → state (VERIFY: 1 queued, 2 scheduled, 4/5 to telecom,
// 6 failed, 10 delivered, 11 undelivered, 13 cancelled, 14 blocked, 100 bad id)
const DELIVERY = { 1: 'queued', 2: 'queued', 4: 'sent', 5: 'sent', 6: 'failed', 10: 'delivered', 11: 'undelivered', 13: 'failed', 14: 'blocked', 100: 'unknown' };

function unwrap(r) {
  const ret = pick(r.data, 'return');
  if (!ret || typeof ret !== 'object') throw httpStatusError(ID, r);
  const status = num(ret.status);
  if (status !== 200) {
    throw new SmsError(STATUS_CODES[status] || (status >= 500 ? 'server_error' : 'unknown'), { provider: ID, message: `${status} ${str(ret.message)}`.trim(), raw: r.data });
  }
  const entries = pick(r.data, 'entries');
  return Array.isArray(entries) ? entries[0] : entries; // lookup answers an object, send an array
}

function requireConfigured(ctx) {
  if (!ctx.secret) throw new SmsError('not_configured', { provider: ID });
}

export default {
  id: ID,
  label_fa: 'کاوه‌نگار',
  label_en: 'Kavenegar',
  hosts: [HOST],
  redactUrl,
  recipientFormat: 'local',
  supportsPattern: true,
  supportsStatus: true,
  secretName: 'sms.kavenegar.api_key',
  configFields: [
    { key: 'api_key', label_fa: 'کلید API', type: 'secret', required: true, help_fa: 'از پنل کاوه‌نگار، بخش «تنظیمات ← حساب کاربری».' },
    { key: 'sender', label_fa: 'شمارهٔ خط ارسال', type: 'text', required: true, help_fa: 'مثلاً 10004346 — برای ارسال با الگو لازم نیست.' },
  ],
  mapHelp: MAP_HELP,
  // provider_map entry: { template: 'name', tokens?: { var: 'token'|'token2'|'token3'|'token10'|'token20' } }
  // `variables` (the template's variable names) lets us refuse a map that
  // would throw "no token slot" at send time.
  validateMap(entry, { variables = [] } = {}) {
    const e = requireField(entry, 'template', 'نام الگو');
    if (e) return e;
    const tokens = entry.tokens;
    if (tokens !== undefined && tokens !== null && (typeof tokens !== 'object' || Array.isArray(tokens))) return 'tokens باید یک شیء باشد';
    const used = new Set();
    for (const [key, slot] of Object.entries(tokens || {})) {
      if (!SLOT_RE.test(String(slot))) return `اسلات «${slot}» معتبر نیست (token, token2, token3, token10, token20)`;
      if (used.has(slot)) return `اسلات «${slot}» به بیش از یک متغیر داده شده است (${key})`;
      used.add(slot);
    }
    const vars = Array.isArray(variables) ? variables.map(String) : [];
    if (vars.length > ALL_SLOTS.length) return `کاوه‌نگار حداکثر ${toFaDigits(ALL_SLOTS.length)} متغیر می‌پذیرد؛ این قالب ${toFaDigits(vars.length)} متغیر دارد`;
    const unmapped = vars.filter(v => !tokens?.[v]);
    if (vars.length > DEFAULT_SLOTS.length && unmapped.length) {
      return `این قالب ${toFaDigits(vars.length)} متغیر دارد و کاوه‌نگار فقط سه اسلات پیش‌فرض (token, token2, token3) دارد؛ در tokens برای هر متغیر اسلات مشخص کنید و مقدارهای دارای فاصله (مثل نام) را به token10 یا token20 بدهید. بدون اسلات: ${unmapped.join(', ')}`;
    }
    return null;
  },

  async send(ctx, { to, text, sender }) {
    requireConfigured(ctx);
    const from = sender || ctx.sender;
    if (!from) throw new SmsError('not_configured', { provider: ID, message: 'sender line missing' });
    const r = await ctx.http.form({ op: 'send', url: `${base(ctx)}/sms/send.json`, body: { receptor: to, sender: from, message: text } });
    const entry = unwrap(r) || {};
    return { ok: true, messageId: str(pick(entry, 'messageid')), cost: num(pick(entry, 'cost')), raw: r.data };
  },

  // one recipient per call. Unmapped variables take the default slots in
  // declaration order, skipping any slot the `tokens` map already claimed.
  // VERIFY: `token` rejects spaces; token10/token20 allow them — whitespace is only collapsed here.
  async sendPattern(ctx, { to, template, params }) {
    requireConfigured(ctx);
    const body = { receptor: to, template: str(template.template) };
    const claimed = new Set(Object.values(template.tokens || {}).map(String));
    const free = DEFAULT_SLOTS.filter(s => !claimed.has(s));
    let i = 0;
    for (const [key, value] of Object.entries(params || {})) {
      const slot = template.tokens?.[key] || free[i++];
      if (!slot) throw new SmsError('validation', { provider: ID, message: `no token slot for "${key}" — map it to token10/token20 in the template's provider_map` });
      body[slot] = str(value).replace(/\s+/g, ' ').trim();
    }
    const r = await ctx.http.form({ op: 'lookup', url: `${base(ctx)}/verify/lookup.json`, body });
    const entry = unwrap(r) || {};
    return { ok: true, messageId: str(pick(entry, 'messageid')), cost: num(pick(entry, 'cost')), raw: r.data };
  },

  async credit(ctx) {
    requireConfigured(ctx);
    const r = await ctx.http.json({ op: 'credit', url: `${base(ctx)}/account/info.json` });
    const entry = unwrap(r) || {};
    return { amount: num(pick(entry, 'remaincredit')), unit: 'rial', raw: r.data };
  },

  async status(ctx, { messageId }) {
    requireConfigured(ctx);
    const r = await ctx.http.form({ op: 'status', url: `${base(ctx)}/sms/status.json`, body: { messageid: str(messageId) } });
    const entry = unwrap(r) || {};
    const code = num(pick(entry, 'status'));
    return { state: DELIVERY[code] || 'unknown', raw: r.data };
  },
};
