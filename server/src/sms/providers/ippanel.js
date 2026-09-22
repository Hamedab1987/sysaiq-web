// IPPanel Edge (= Faraz SMS) — https://edge.ippanel.com/v1/api, header
// Authorization: <apikey>, JSON, E.164 numbers everywhere. Verified
// 2026-09-22 (iran-sms-providers skill). The delivery-report path is marked
// VERIFY in the skill, so supportsStatus is false until confirmed.
import { toE164 } from '../../lib/normalize.js';
import { SmsError } from '../errors.js';
import { pick, str, num, httpStatusError, requireField } from './common.js';

const HOST = 'edge.ippanel.com';
const ID = 'ippanel';
const BASE = `https://${HOST}/v1/api`;

// meta.message_code → code ("200-1" OK, "400-1" auth, "400-2" validation)
const MESSAGE_CODES = { '400-1': 'auth', '400-2': 'validation', '401-1': 'auth', '402-1': 'no_credit', '429-1': 'rate_limited' };

const headers = ctx => ({ authorization: ctx.secret });

// sender line in E.164: '3000505' → '+983000505', '03000505' → '+983000505', '+98…' kept
export function lineE164(s) {
  let d = str(s).replace(/[\s\-.()]/g, '');
  if (!d) return '';
  if (d.startsWith('+')) return `+${d.slice(1).replace(/\D/g, '')}`;
  d = d.replace(/\D/g, '');
  if (d.startsWith('0098')) return `+${d.slice(2)}`;
  if (d.startsWith('98')) return `+${d}`;
  if (d.startsWith('0')) return `+98${d.slice(1)}`;
  return `+98${d}`;
}

function unwrap(r) {
  const d = r.data;
  const meta = pick(d, 'meta');
  if (!meta || typeof meta !== 'object') throw httpStatusError(ID, r);
  const mc = str(pick(meta, 'message_code'));
  if (meta.status !== true && mc !== '200-1') {
    const code = MESSAGE_CODES[mc] || (r.status === 401 || r.status === 403 ? 'auth' : r.status >= 500 ? 'server_error' : mc.startsWith('400') ? 'validation' : 'unknown');
    throw new SmsError(code, { provider: ID, message: `${mc} ${str(pick(meta, 'message'))}`.trim(), raw: d });
  }
  return pick(d, 'data') || {};
}

function recipient(to) {
  const e = toE164(to);
  if (!e) throw new SmsError('bad_mobile', { provider: ID });
  return e;
}

function requireConfigured(ctx) {
  if (!ctx.secret) throw new SmsError('not_configured', { provider: ID });
  if (!str(ctx.sender)) throw new SmsError('not_configured', { provider: ID, message: 'from_number missing' });
}

export default {
  id: ID,
  label_fa: 'فراز اس‌ام‌اس (IPPanel)',
  label_en: 'Faraz SMS (IPPanel Edge)',
  hosts: [HOST],
  recipientFormat: 'e164',
  supportsPattern: true,
  supportsStatus: false,
  secretName: 'sms.ippanel.api_key',
  configFields: [
    { key: 'api_key', label_fa: 'کلید API', type: 'secret', required: true, help_fa: 'از پنل Edge فراز اس‌ام‌اس.' },
    { key: 'sender', label_fa: 'شمارهٔ خط ارسال', type: 'text', required: true, help_fa: 'به‌صورت بین‌المللی، مثلاً +983000505' },
  ],
  // provider_map entry: { code: 'pattern-code', params?: { var: 'name' } }
  validateMap(entry) {
    return requireField(entry, 'code', 'کد الگو (code)');
  },

  async send(ctx, { to, text, sender }) {
    requireConfigured({ ...ctx, sender: sender || ctx.sender });
    const r = await ctx.http.json({ op: 'send', url: `${BASE}/send`, headers: headers(ctx), body: {
      sending_type: 'webservice', from_number: lineE164(sender || ctx.sender), message: text, params: { recipients: [recipient(to)] },
    } });
    const data = unwrap(r);
    return { ok: true, messageId: str(pick(data, 'message_id', 'bulk_id', 'id')), cost: num(pick(data, 'cost')), raw: r.data };
  },

  // single E.164 recipient; params keep our variable names unless mapped
  async sendPattern(ctx, { to, template, params }) {
    requireConfigured(ctx);
    const mapped = {};
    for (const [k, v] of Object.entries(params || {})) mapped[template.params?.[k] || k] = str(v);
    const r = await ctx.http.json({ op: 'pattern', url: `${BASE}/send`, headers: headers(ctx), body: {
      sending_type: 'pattern', from_number: lineE164(ctx.sender), code: str(template.code), recipients: [recipient(to)], params: mapped,
    } });
    const data = unwrap(r);
    return { ok: true, messageId: str(pick(data, 'message_id', 'bulk_id', 'id')), cost: num(pick(data, 'cost')), raw: r.data };
  },

  async credit(ctx) {
    if (!ctx.secret) throw new SmsError('not_configured', { provider: ID });
    const r = await ctx.http.json({ op: 'credit', url: `${BASE}/payment/credit/mine`, headers: headers(ctx) });
    const data = unwrap(r);
    return { amount: num(pick(data, 'credit')), unit: 'rial', raw: r.data };
  },
};
