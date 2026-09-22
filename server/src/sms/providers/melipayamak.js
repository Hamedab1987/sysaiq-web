// Melipayamak (REST) — https://rest.payamak-panel.com/api/SendSMS, form
// fields username + password on every call. Verified 2026-09-22
// (iran-sms-providers skill); the {Value, RetStatus, StrRetStatus} error
// values and the GetDeliveries2 codes are VERIFY there — mapped below from
// the public docs and kept conservative (unknown → retriable 'unknown').
import { SmsError } from '../errors.js';
import { pick, str, num, httpStatusError, requireField } from './common.js';

const HOST = 'rest.payamak-panel.com';
const ID = 'melipayamak';
const BASE = `https://${HOST}/api/SendSMS`;

// Value when RetStatus != 1 (VERIFY): 0 auth, 2 no credit, 3 daily limit,
// 4 volume limit, 5 bad sender, 6 system updating, 7 filtered text,
// 10 user inactive, 11 not sent, 12 documents incomplete
const VALUE_CODES = { 0: 'auth', '-1': 'auth', 2: 'no_credit', 3: 'rate_limited', 4: 'rate_limited', 5: 'line', 6: 'server_error', 7: 'validation', 10: 'disabled', 11: 'unknown', 12: 'disabled' };
// GetDeliveries2 (VERIFY): 0 sent to operator, 1 delivered, 2 undelivered, 8 reached operator, 16 not reached
const DELIVERY = { 0: 'sent', 1: 'delivered', 2: 'undelivered', 8: 'sent', 16: 'undelivered' };

const auth = ctx => ({ username: str(ctx.username), password: ctx.secret });

function unwrap(r) {
  const d = r.data;
  const ret = pick(d, 'RetStatus', 'retStatus');
  if (ret === undefined) throw httpStatusError(ID, r);
  const value = pick(d, 'Value', 'value');
  if (num(ret) !== 1) {
    const v = str(value);
    throw new SmsError(VALUE_CODES[v] || 'unknown', { provider: ID, message: `${str(pick(d, 'StrRetStatus', 'strRetStatus'))} (${v})`.trim(), raw: d });
  }
  return value;
}

function requireConfigured(ctx, needLine = true) {
  if (!ctx.secret || !str(ctx.username)) throw new SmsError('not_configured', { provider: ID });
  if (needLine && !str(ctx.sender)) throw new SmsError('not_configured', { provider: ID, message: 'sender line missing' });
}

export default {
  id: ID,
  label_fa: 'ملی‌پیامک',
  label_en: 'Melipayamak',
  hosts: [HOST],
  recipientFormat: 'local',
  supportsPattern: true,
  supportsStatus: true,
  secretName: 'sms.melipayamak.password',
  configFields: [
    { key: 'username', label_fa: 'نام کاربری', type: 'text', required: true, help_fa: 'نام کاربری وب‌سرویس ملی‌پیامک.' },
    { key: 'password', label_fa: 'رمز وب‌سرویس', type: 'secret', required: true, help_fa: 'رمز وب‌سرویس (نه رمز ورود پنل).' },
    { key: 'sender', label_fa: 'شمارهٔ خط ارسال', type: 'text', required: true, help_fa: 'برای ارسال با الگو (خدماتی) لازم نیست.' },
  ],
  // provider_map entry: { bodyId: 12345, order?: ['name','code'] } — values joined with ';'
  validateMap(entry) {
    const e = requireField(entry, 'bodyId', 'شناسهٔ متن (bodyId)');
    if (e) return e;
    if (!/^\d+$/.test(str(entry.bodyId))) return 'bodyId باید عدد باشد';
    if (entry.order !== undefined && !Array.isArray(entry.order)) return 'order باید آرایه باشد';
    return null;
  },

  async send(ctx, { to, text, sender }) {
    requireConfigured({ ...ctx, sender: sender || ctx.sender });
    const r = await ctx.http.form({ op: 'send', url: `${BASE}/SendSMS`, body: { ...auth(ctx), to, from: str(sender || ctx.sender), text, isFlash: 'false' } });
    const value = unwrap(r);
    return { ok: true, messageId: str(value), cost: null, raw: r.data };
  },

  // BaseServiceNumber: values in `order` (default: declaration order) joined with ';'
  async sendPattern(ctx, { to, template, params }) {
    requireConfigured(ctx, false);
    const order = Array.isArray(template.order) && template.order.length ? template.order : Object.keys(params || {});
    const text = order.map(k => str(params?.[k]).replace(/;/g, '،')).join(';');
    const r = await ctx.http.form({ op: 'pattern', url: `${BASE}/BaseServiceNumber`, body: { ...auth(ctx), to, bodyId: str(template.bodyId), text } });
    const value = unwrap(r);
    return { ok: true, messageId: str(value), cost: null, raw: r.data };
  },

  async credit(ctx) {
    requireConfigured(ctx, false);
    const r = await ctx.http.form({ op: 'credit', url: `${BASE}/GetCredit`, body: auth(ctx) });
    const value = unwrap(r);
    return { amount: num(value), unit: 'sms', raw: r.data };
  },

  async status(ctx, { messageId }) {
    requireConfigured(ctx, false);
    const r = await ctx.http.form({ op: 'status', url: `${BASE}/GetDeliveries2`, body: { ...auth(ctx), recId: str(messageId) } });
    const value = unwrap(r);
    const code = num(Array.isArray(value) ? value[0] : value);
    return { state: DELIVERY[code] || 'unknown', raw: r.data };
  },
};
