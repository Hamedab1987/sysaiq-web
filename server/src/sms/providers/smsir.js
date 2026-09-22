// SMS.ir v1 — https://api.sms.ir/v1, header X-API-KEY, JSON.
// Verified 2026-09-22 (iran-sms-providers skill). Pattern values are capped
// at 25 characters by the provider (err 114). Free-text variables (name,
// service, status — FREE_TEXT_VARS) are shortened to 25 characters ending in
// «…» so a long customer name never blocks a pay link; anything else (code,
// invoice number, amount, ref, phone) must not be cut, so we refuse before
// sending and the log names the variable instead of a bare provider code.
import { SmsError } from '../errors.js';
import { pick, str, num, httpStatusError, mapParams, requireField, FREE_TEXT_VARS, truncateText } from './common.js';

const HOST = 'api.sms.ir';
const ID = 'smsir';
const BASE = `https://${HOST}/v1`;
export const MAX_PARAM_CHARS = 25;

// body.status → code (1 = OK)
const STATUS_CODES = {
  10: 'auth', 11: 'auth', 12: 'auth', 13: 'disabled', 14: 'disabled', 20: 'rate_limited',
  101: 'line', 102: 'no_credit', 104: 'bad_mobile', 113: 'template', 114: 'validation', 115: 'blacklisted', 123: 'line',
};
// deliveryState → state
const DELIVERY = { 1: 'delivered', 2: 'undelivered', 3: 'sent', 4: 'undelivered', 5: 'sent', 6: 'failed', 7: 'blocked' };

const headers = ctx => ({ 'x-api-key': ctx.secret });
const line = ctx => (/^\d+$/.test(str(ctx.sender)) ? Number(ctx.sender) : str(ctx.sender));

function unwrap(r) {
  const d = r.data;
  if (!d || typeof d !== 'object' || d.status === undefined) throw httpStatusError(ID, r);
  const status = num(d.status);
  if (status !== 1) {
    throw new SmsError(STATUS_CODES[status] || (r.status >= 500 ? 'server_error' : 'unknown'), { provider: ID, message: `${status} ${str(d.message)}`.trim(), raw: d });
  }
  return d.data;
}

function requireConfigured(ctx, needLine = true) {
  if (!ctx.secret) throw new SmsError('not_configured', { provider: ID });
  if (needLine && !str(ctx.sender)) throw new SmsError('not_configured', { provider: ID, message: 'line number missing' });
}

export default {
  id: ID,
  label_fa: 'SMS.ir',
  label_en: 'SMS.ir',
  hosts: [HOST],
  recipientFormat: 'local',
  supportsPattern: true,
  supportsStatus: true,
  secretName: 'sms.smsir.api_key',
  configFields: [
    { key: 'api_key', label_fa: 'کلید API', type: 'secret', required: true, help_fa: 'از پنل SMS.ir، بخش «برنامه‌نویسان».' },
    { key: 'sender', label_fa: 'شمارهٔ خط ارسال', type: 'text', required: true, help_fa: 'مثلاً 30007732000000' },
  ],
  mapHelp: {
    fa: 'نگاشت الگو: {templateId: شناسهٔ عددی الگو, params: {نام‌متغیر: «نام پارامتر در الگو»}}. SMS.ir هر مقدار را حداکثر ۲۵ نویسه می‌پذیرد؛ نام و خدمت در صورت بلندتر بودن کوتاه می‌شوند، کد و شمارهٔ فاکتور و مبلغ کوتاه نمی‌شوند و ارسال رد می‌شود.',
    en: 'Pattern map: {templateId: numeric template id, params: {variable: "parameter name in the template"}}. SMS.ir caps every value at 25 characters; name and service are shortened, code / invoice number / amount are never cut and the send is refused instead.',
  },
  // provider_map entry: { templateId: 123456, params?: { var: 'NAME' } }
  validateMap(entry) {
    const e = requireField(entry, 'templateId', 'شناسهٔ الگو (templateId)');
    if (e) return e;
    if (!/^\d+$/.test(str(entry.templateId))) return 'templateId باید عدد باشد';
    if (entry.params !== undefined && entry.params !== null && (typeof entry.params !== 'object' || Array.isArray(entry.params))) return 'params باید یک شیء باشد';
    return null;
  },

  async send(ctx, { to, text, sender }) {
    requireConfigured(ctx, !sender);
    const r = await ctx.http.json({ op: 'send', url: `${BASE}/send/bulk`, headers: headers(ctx), body: { lineNumber: sender ? line({ sender }) : line(ctx), messageText: text, mobiles: [to] } });
    const data = unwrap(r) || {};
    const ids = pick(data, 'messageIds');
    return { ok: true, messageId: str(Array.isArray(ids) ? ids[0] : pick(data, 'messageId', 'packId')), cost: num(pick(data, 'cost')), raw: r.data };
  },

  async sendPattern(ctx, { to, template, params }) {
    requireConfigured(ctx, false);
    const parameters = mapParams(params, template.params).map(p => {
      const len = [...p.value].length;
      if (len <= MAX_PARAM_CHARS) return { name: p.name, value: p.value };
      if (FREE_TEXT_VARS.has(p.key)) return { name: p.name, value: truncateText(p.value, MAX_PARAM_CHARS) };
      throw new SmsError('validation', { provider: ID, message: `parameter "${p.key}" is ${len} chars (max ${MAX_PARAM_CHARS})` });
    });
    const r = await ctx.http.json({ op: 'verify', url: `${BASE}/send/verify`, headers: headers(ctx), body: { mobile: to, templateId: Number(template.templateId), parameters } });
    const data = unwrap(r) || {};
    return { ok: true, messageId: str(pick(data, 'messageId')), cost: num(pick(data, 'cost')), raw: r.data };
  },

  async credit(ctx) {
    requireConfigured(ctx, false);
    const r = await ctx.http.json({ op: 'credit', url: `${BASE}/credit`, headers: headers(ctx) });
    const data = unwrap(r);
    return { amount: num(data), unit: 'credit', raw: r.data };
  },

  async status(ctx, { messageId }) {
    requireConfigured(ctx, false);
    const r = await ctx.http.json({ op: 'status', url: `${BASE}/send/${encodeURIComponent(str(messageId))}`, headers: headers(ctx) });
    const data = unwrap(r) || {};
    return { state: DELIVERY[num(pick(data, 'deliveryState'))] || 'unknown', raw: r.data };
  },
};
