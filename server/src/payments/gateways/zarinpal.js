// Zarinpal v4 — contract per .claude/skills/iran-payment-gateways (verified 2026-09-22).
// Wire unit: Rial (currency "IRR" sent explicitly). Sandbox host when the
// gateway is configured with sandbox:true (any UUID merchant; authorities start with S).
import { toWire, fromWire, str, redact, maskedPan, callJson, GatewayError } from './common.js';

const ID = 'zarinpal';
const HOST = 'payment.zarinpal.com';
const SANDBOX_HOST = 'sandbox.zarinpal.com';
const AUTHORITY_RE = /^[AS][0-9A-Za-z]{35}$/;
const MERCHANT_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

const host = ctx => (ctx.config?.sandbox ? SANDBOX_HOST : HOST);
const api = (ctx, path) => `https://${host(ctx)}/pg/v4/payment/${path}.json`;

// {data:{code, …}, errors:{code, message}|[]} → normalised
function outcome(r) {
  const d = r.data?.data && !Array.isArray(r.data.data) ? r.data.data : null;
  const e = r.data?.errors && !Array.isArray(r.data.errors) ? r.data.errors : null;
  const code = d?.code ?? e?.code ?? (r.ok ? null : r.status);
  return { d, code: code === null || code === undefined ? '' : String(code), message: str(e?.message || d?.message || '', 300) };
}

function merchant(ctx) {
  const m = str(ctx.secret('gw.zarinpal.merchant_id'), 64);
  if (!MERCHANT_RE.test(m)) throw new GatewayError('not_configured', 'Zarinpal merchant id missing or not a UUID');
  return m;
}

export default {
  id: ID,
  label_fa: 'زرین‌پال',
  label_en: 'Zarinpal',
  wireUnit: 'IRR',
  minToman: 1000,
  maxToman: 100_000_000,
  callbackMethod: 'GET',
  redirectOrigins: [`https://${HOST}`, `https://${SANDBOX_HOST}`],
  hosts: [HOST, SANDBOX_HOST],
  secretName: 'gw.zarinpal.merchant_id',
  configFields: [
    { key: 'merchant_id', label_fa: 'شناسهٔ پذیرنده (Merchant ID)', type: 'secret', required: true, pattern: MERCHANT_RE.source, help_fa: 'شناسهٔ ۳۶ نویسه‌ای از پنل زرین‌پال.' },
    { key: 'sandbox', label_fa: 'محیط آزمایشی (sandbox)', type: 'boolean', required: false, help_fa: 'با روشن‌بودن، پرداخت‌ها به sandbox.zarinpal.com می‌روند و پول واقعی جابه‌جا نمی‌شود.' },
  ],

  async create(ctx, { amountToman, callbackUrl, description, mobile, email, orderId }) {
    const body = {
      merchant_id: merchant(ctx),
      amount: toWire(amountToman, 'IRR'),
      currency: 'IRR',
      description: str(description, 500) || `SysaiQ ${orderId}`,
      callback_url: callbackUrl,
      metadata: { ...(mobile ? { mobile } : {}), ...(email ? { email } : {}), order_id: str(orderId, 64) },
    };
    const r = await callJson(ctx, { url: api(ctx, 'request'), body, op: 'request', allowHosts: [host(ctx)] });
    const { d, code, message } = outcome(r);
    if (code !== '100' || !AUTHORITY_RE.test(str(d?.authority))) {
      return { ok: false, code: code || 'bad_response', message, raw: redact(r.data) };
    }
    const authority = d.authority;
    return {
      ok: true, authority,
      redirectUrl: `https://${host(ctx)}/pg/StartPay/${authority}`,   // constant + validated authority, never d.link
      feeToman: d.fee !== undefined ? fromWire(d.fee, 'IRR') : null,
      raw: redact(r.data),
    };
  },

  parseCallback({ query = {}, body = {} }) {
    const src = { ...body, ...query };
    const authority = str(src.Authority ?? src.authority, 40);
    const status = str(src.Status ?? src.status, 10).toUpperCase();
    return {
      authority: AUTHORITY_RE.test(authority) ? authority : '',
      outcome: status === 'OK' ? 'ok' : status === 'NOK' ? 'cancelled' : 'failed',
      extra: {},
    };
  },

  async verify(ctx, { authority, amountToman }) {
    if (!AUTHORITY_RE.test(str(authority))) return { ok: false, code: 'bad_authority', message: 'authority malformed' };
    const body = { merchant_id: merchant(ctx), amount: toWire(amountToman, 'IRR'), authority };
    const r = await callJson(ctx, { url: api(ctx, 'verify'), body, op: 'verify', allowHosts: [host(ctx)] });
    const { d, code, message } = outcome(r);
    const ok = code === '100' || code === '101';
    return {
      ok, pending: false, alreadyVerified: code === '101',
      refId: str(d?.ref_id, 64), cardPan: maskedPan(d?.card_pan), cardHash: str(d?.card_hash, 128),
      amountToman: d?.amount !== undefined ? fromWire(d.amount, 'IRR') : null,
      feeToman: d?.fee !== undefined ? fromWire(d.fee, 'IRR') : null,
      code, message: message || (ok ? '' : `zarinpal ${code}`), raw: redact(r.data),
    };
  },

  async inquire(ctx, { authority }) {
    const r = await callJson(ctx, { url: api(ctx, 'inquiry'), body: { merchant_id: merchant(ctx), authority }, op: 'inquiry', allowHosts: [host(ctx)] });
    const { d, code } = outcome(r);
    const s = str(d?.status).toUpperCase();
    const state = code !== '100' ? 'unknown' : s === 'VERIFIED' ? 'verified' : s === 'PAID' ? 'paid_unverified' : s === 'IN_BANK' ? 'pending' : s === 'FAILED' ? 'failed' : s === 'REVERSED' ? 'reversed' : 'unknown';
    return { state, raw: redact(r.data) };
  },

  // read-only: the unverified-list endpoint answers 100 for a valid merchant
  async test(ctx) {
    let m;
    try { m = merchant(ctx); } catch (e) { return { ok: false, message_fa: 'شناسهٔ پذیرنده تنظیم نشده یا معتبر نیست.' }; }
    const r = await callJson(ctx, { url: api(ctx, 'unVerified'), body: { merchant_id: m }, op: 'unVerified', allowHosts: [host(ctx)] });
    const { code, message } = outcome(r);
    if (code === '100') return { ok: true, message_fa: `اتصال به زرین‌پال برقرار است (${ctx.config?.sandbox ? 'sandbox' : 'production'}).` };
    return { ok: false, message_fa: `زرین‌پال پاسخ داد: کد ${code}${message ? ` — ${message}` : ''}` };
  },
};
