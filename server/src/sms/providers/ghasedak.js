// Ghasedak (new REST API) — https://gateway.ghasedak.me/rest/api/v1/WebService,
// header ApiKey, JSON. Verified 2026-09-22 (iran-sms-providers skill).
// The API answers {isSuccess, statusCode, message, data} — PascalCase in
// some versions — so every field is read case-tolerantly. Status codes other
// than 200/401/403/429/5xx are VERIFY.
import { SmsError } from '../errors.js';
import { pick, str, num, httpStatusError, mapParams, requireField } from './common.js';

const HOST = 'gateway.ghasedak.me';
const ID = 'ghasedak';
const BASE = `https://${HOST}/rest/api/v1/WebService`;

// CheckSmsStatus: 0 none, 1 cancelled, 2 blacklist, 3 to operator, 4 undelivered, 5 delivered, 6 error
const DELIVERY = { 0: 'queued', 1: 'failed', 2: 'blocked', 3: 'sent', 4: 'undelivered', 5: 'delivered', 6: 'failed' };
const STATUS_CODES = { 400: 'validation', 401: 'auth', 402: 'no_credit', 403: 'auth', 404: 'bad_response', 405: 'no_credit', 429: 'rate_limited' };

const headers = ctx => ({ apikey: ctx.secret });

function unwrap(r) {
  const d = r.data;
  const ok = pick(d, 'isSuccess', 'IsSuccess');
  if (ok === undefined) throw httpStatusError(ID, r);
  if (ok !== true) {
    const code = num(pick(d, 'statusCode', 'StatusCode')) ?? r.status;
    throw new SmsError(STATUS_CODES[code] || (code >= 500 ? 'server_error' : 'unknown'), { provider: ID, message: `${code} ${str(pick(d, 'message', 'Message'))}`.trim(), raw: d });
  }
  return pick(d, 'data', 'Data') || {};
}

// send answers either a flat {messageId, cost} or {items:[{messageId, cost}]}
function firstItem(data) {
  const items = pick(data, 'items', 'Items');
  const first = Array.isArray(items) ? items[0] : null;
  return { messageId: str(pick(first, 'messageId', 'MessageId') ?? pick(data, 'messageId', 'MessageId')), cost: num(pick(first, 'cost', 'Cost') ?? pick(data, 'cost', 'Cost')) };
}

function requireConfigured(ctx) {
  if (!ctx.secret) throw new SmsError('not_configured', { provider: ID });
}

export default {
  id: ID,
  label_fa: 'قاصدک',
  label_en: 'Ghasedak',
  hosts: [HOST],
  recipientFormat: 'local',
  supportsPattern: true,
  supportsStatus: true,
  secretName: 'sms.ghasedak.api_key',
  configFields: [
    { key: 'api_key', label_fa: 'کلید API', type: 'secret', required: true, help_fa: 'از پنل قاصدک (API جدید).' },
    { key: 'sender', label_fa: 'شمارهٔ خط ارسال', type: 'text', required: true, help_fa: 'برای ارسال با الگو لازم نیست.' },
  ],
  // provider_map entry: { templateName: 'lead', inputs?: { var: 'param' } }
  validateMap(entry) {
    return requireField(entry, 'templateName', 'نام الگو (templateName)');
  },

  async send(ctx, { to, text, sender }) {
    requireConfigured(ctx);
    const from = sender || ctx.sender;
    if (!from) throw new SmsError('not_configured', { provider: ID, message: 'line number missing' });
    const clientReferenceId = `sq-${Date.now()}`;
    const r = await ctx.http.json({ op: 'send', url: `${BASE}/SendSingleSMS`, headers: headers(ctx), body: { lineNumber: str(from), receptor: to, message: text, clientReferenceId } });
    return { ok: true, ...firstItem(unwrap(r)), raw: r.data };
  },

  async sendPattern(ctx, { to, template, params }) {
    requireConfigured(ctx);
    const clientReferenceId = `sq-${Date.now()}`;
    const inputs = mapParams(params, template.inputs).map(p => ({ param: p.name, value: p.value }));
    const r = await ctx.http.json({ op: 'otp', url: `${BASE}/SendOtpSMS`, headers: headers(ctx), body: { receptors: [{ mobile: to, clientReferenceId }], templateName: str(template.templateName), inputs, udh: false } });
    return { ok: true, ...firstItem(unwrap(r)), raw: r.data };
  },

  async credit(ctx) {
    requireConfigured(ctx);
    const r = await ctx.http.json({ op: 'credit', url: `${BASE}/GetAccountInformation`, headers: headers(ctx) });
    const data = unwrap(r);
    return { amount: num(pick(data, 'credit', 'Credit')), unit: 'rial', raw: r.data };
  },

  async status(ctx, { messageId }) {
    requireConfigured(ctx);
    const r = await ctx.http.json({ op: 'status', url: `${BASE}/CheckSmsStatus?Ids=${encodeURIComponent(str(messageId))}&Type=1`, headers: headers(ctx) });
    const data = unwrap(r);
    const items = pick(data, 'items', 'Items', 'messages', 'Messages');
    const first = Array.isArray(items) ? items[0] : data;
    return { state: DELIVERY[num(pick(first, 'status', 'Status'))] || 'unknown', raw: r.data };
  },
};
