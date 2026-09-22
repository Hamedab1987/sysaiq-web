// PayPing v3 — contract per .claude/skills/iran-payment-gateways (verified 2026-09-22).
// Wire unit: Toman. Bearer token. Callback is a POST form with a JSON `data`
// field. Verify must run within 10 minutes of the payment or PayPing
// auto-refunds — the callback path verifies immediately and reconcile
// retries a pending verify every 2 minutes.
import { toWire, str, redact, maskedPan, callJson, GatewayError } from './common.js';

const ID = 'payping';
const HOST = 'api.payping.ir';
const CODE_RE = /^[A-Za-z0-9_-]{4,64}$/;

const token = ctx => {
  const t = str(ctx.secret('gw.payping.token'), 2048);
  if (!t) throw new GatewayError('not_configured', 'PayPing token missing');
  return t;
};
const headers = ctx => ({ authorization: `Bearer ${token(ctx)}` });
const api = path => `https://${HOST}/v3/pay${path}`;

// VERIFY: no dedicated sandbox host is documented for v3 — tests use the fake fetch
export default {
  id: ID,
  label_fa: 'پی‌پینگ',
  label_en: 'PayPing',
  wireUnit: 'IRT',
  minToman: 1000,
  maxToman: 100_000_000,
  callbackMethod: 'POST',
  redirectOrigins: [`https://${HOST}`],
  hosts: [HOST],
  secretName: 'gw.payping.token',
  configFields: [
    { key: 'token', label_fa: 'توکن API (Bearer)', type: 'secret', required: true, help_fa: 'از بخش توکن‌ها در پنل پی‌پینگ.' },
  ],

  async create(ctx, { amountToman, callbackUrl, description, mobile, orderId, payerName }) {
    const body = {
      amount: toWire(amountToman, 'IRT'),
      returnUrl: callbackUrl,
      clientRefId: str(orderId, 64),
      ...(mobile ? { payerIdentity: mobile } : {}),
      ...(payerName ? { payerName: str(payerName, 100) } : {}),
      description: str(description, 255) || `SysaiQ ${orderId}`,
    };
    const r = await callJson(ctx, { url: api(''), headers: headers(ctx), body, op: 'pay', allowHosts: [HOST] });
    const code = str(r.data?.paymentCode ?? r.data?.code, 64);
    if (!r.ok || !CODE_RE.test(code)) {
      return { ok: false, code: String(r.status || 'bad_response'), message: str(r.data?.metaData?.errors?.[0]?.message || r.data?.message || r.text, 300), raw: redact(r.data) };
    }
    return { ok: true, authority: code, redirectUrl: `https://${HOST}/v3/pay/start/${code}`, raw: redact(r.data) };
  },

  parseCallback({ query = {}, body = {} }) {
    const src = { ...query, ...body };
    let data = src.data;
    if (typeof data === 'string') { try { data = JSON.parse(data); } catch { data = {}; } }
    if (!data || typeof data !== 'object') data = {};
    const status = str(src.status, 4);
    const paymentCode = str(data.paymentCode ?? src.paymentCode, 64);
    return {
      authority: CODE_RE.test(paymentCode) ? paymentCode : '',
      outcome: status === '1' ? 'ok' : 'failed',
      extra: {
        paymentRefId: str(data.paymentRefId, 64), clientRefId: str(data.clientRefId, 64),
        amount: data.amount !== undefined ? Number(data.amount) : null, errorCode: str(src.errorCode, 20),
        cardNumber: maskedPan(data.cardNumber), cardHashPan: str(data.cardHashPan, 128),
      },
    };
  },

  async verify(ctx, { authority, amountToman, extra = {} }) {
    if (!CODE_RE.test(str(authority))) return { ok: false, code: 'bad_authority', message: 'paymentCode malformed' };
    const paymentRefId = str(extra.paymentRefId, 64);
    if (!paymentRefId) return { ok: false, code: 'no_ref', message: 'paymentRefId missing from callback' };
    const body = { paymentRefId, paymentCode: authority, amount: toWire(amountToman, 'IRT') };
    const r = await callJson(ctx, { url: api('/verify'), headers: headers(ctx), body, op: 'verify', allowHosts: [HOST] });
    const metaCode = String(r.data?.metaData?.code ?? '');
    const alreadyVerified = r.status === 409 && metaCode === '110';
    const pending = r.status === 202 || r.status === 502;
    const ok = r.status === 200 || alreadyVerified;   // 202 is also 2xx but means 'still processing'
    const d = r.data && typeof r.data === 'object' ? r.data : {};
    return {
      ok, pending: !ok && pending, alreadyVerified,
      refId: str(d.paymentRefId || paymentRefId, 64), cardPan: maskedPan(d.cardNumber || extra.cardNumber), cardHash: str(d.cardHashPan || extra.cardHashPan, 128),
      amountToman: d.amount !== undefined ? Number(d.amount) : null,
      orderIdEcho: str(d.clientRefId, 64) || null,
      code: String(r.status), message: ok ? '' : str(d.metaData?.errors?.[0]?.message || d.message || r.text, 300), raw: redact(d),
    };
  },

  // VERIFY: no read-only "whoami" endpoint is documented; a verify with a bogus
  // reference proves the token is accepted (401 = rejected, anything else = accepted)
  async test(ctx) {
    try { token(ctx); } catch { return { ok: false, message_fa: 'توکن پی‌پینگ تنظیم نشده است.' }; }
    const r = await callJson(ctx, { url: api('/verify'), headers: headers(ctx), body: { paymentRefId: '0', paymentCode: 'sysaiq-test', amount: 1000 }, op: 'verify-test', allowHosts: [HOST] });
    if (r.status === 401 || r.status === 403) return { ok: false, message_fa: 'پی‌پینگ توکن را نپذیرفت (401/403).' };
    if (r.status >= 500) return { ok: false, message_fa: `پی‌پینگ در دسترس نیست (HTTP ${r.status}).` };
    return { ok: true, message_fa: `اتصال به پی‌پینگ برقرار است و توکن پذیرفته شد (HTTP ${r.status}).` };
  },
};
