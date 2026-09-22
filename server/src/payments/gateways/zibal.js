// Zibal v1 — contract per .claude/skills/iran-payment-gateways (verified 2026-09-22).
// Wire unit: Rial. `merchant:"zibal"` is the documented sandbox merchant
// (the owner can also toggle sandbox, which sends that merchant instead of the secret).
import { toWire, fromWire, str, redact, maskedPan, callJson, GatewayError } from './common.js';

const ID = 'zibal';
const HOST = 'gateway.zibal.ir';
const TRACK_RE = /^\d{1,20}$/;
const api = path => `https://${HOST}/v1/${path}`;

function merchant(ctx) {
  if (ctx.config?.sandbox) return 'zibal';
  const m = str(ctx.secret('gw.zibal.merchant'), 128);
  if (!m) throw new GatewayError('not_configured', 'Zibal merchant missing');
  return m;
}
const code = r => String(r.data?.result ?? (r.ok ? '' : r.status));

export default {
  id: ID,
  label_fa: 'زیبال',
  label_en: 'Zibal',
  wireUnit: 'IRR',
  minToman: 100,          // 1,000 Rial (code 105)
  maxToman: 100_000_000,
  callbackMethod: 'GET',
  redirectOrigins: [`https://${HOST}`],
  hosts: [HOST],
  secretName: 'gw.zibal.merchant',
  configFields: [
    { key: 'merchant', label_fa: 'کد مرچنت (merchant)', type: 'secret', required: true, help_fa: 'از پنل زیبال. برای تست، «محیط آزمایشی» را روشن کنید.' },
    { key: 'sandbox', label_fa: 'محیط آزمایشی (merchant = zibal)', type: 'boolean', required: false, help_fa: 'با روشن‌بودن، مرچنت آزمایشی زیبال استفاده می‌شود و پول واقعی جابه‌جا نمی‌شود.' },
  ],

  async create(ctx, { amountToman, callbackUrl, description, mobile, orderId }) {
    const body = {
      merchant: merchant(ctx),
      amount: toWire(amountToman, 'IRR'),
      callbackUrl,
      orderId: str(orderId, 64),
      description: str(description, 255) || `SysaiQ ${orderId}`,
      ...(mobile ? { mobile } : {}),
    };
    const r = await callJson(ctx, { url: api('request'), body, op: 'request', allowHosts: [HOST] });
    const c = code(r);
    const trackId = str(r.data?.trackId, 20);
    if (c !== '100' || !TRACK_RE.test(trackId)) return { ok: false, code: c || 'bad_response', message: str(r.data?.message, 300), raw: redact(r.data) };
    return { ok: true, authority: trackId, redirectUrl: `https://${HOST}/start/${trackId}`, raw: redact(r.data) };
  },

  parseCallback({ query = {}, body = {} }) {
    const src = { ...body, ...query };
    const trackId = str(src.trackId, 20);
    return {
      authority: TRACK_RE.test(trackId) ? trackId : '',
      outcome: str(src.success, 2) === '1' ? 'ok' : 'cancelled',
      extra: { status: str(src.status, 10), orderId: str(src.orderId, 64) },
    };
  },

  async verify(ctx, { authority }) {
    if (!TRACK_RE.test(str(authority))) return { ok: false, code: 'bad_authority', message: 'trackId malformed' };
    const r = await callJson(ctx, { url: api('verify'), body: { merchant: merchant(ctx), trackId: Number(authority) }, op: 'verify', allowHosts: [HOST] });
    const c = code(r);
    const d = r.data && typeof r.data === 'object' ? r.data : {};
    const ok = c === '100' || c === '201';
    return {
      ok, pending: false, alreadyVerified: c === '201',
      refId: str(d.refNumber, 64), cardPan: maskedPan(d.cardNumber), cardHash: '',
      amountToman: d.amount !== undefined ? fromWire(d.amount, 'IRR') : null,
      orderIdEcho: str(d.orderId, 64) || null,
      code: c, message: ok ? '' : str(d.message, 300) || `zibal ${c}`, raw: redact(d),
    };
  },

  async inquire(ctx, { authority }) {
    const r = await callJson(ctx, { url: api('inquiry'), body: { merchant: merchant(ctx), trackId: Number(authority) }, op: 'inquiry', allowHosts: [HOST] });
    const s = String(r.data?.status ?? '');
    const state = code(r) !== '100' ? 'unknown' : s === '1' ? 'verified' : s === '2' ? 'paid_unverified' : s === '-1' ? 'pending' : s === '3' ? 'failed' : s === '4' || s === '5' ? 'reversed' : 'unknown';
    return { state, raw: redact(r.data) };
  },

  // read-only: inquiry on trackId 0 answers 203 (bad trackId) for a valid merchant, 102/103 for a bad one
  async test(ctx) {
    let m;
    try { m = merchant(ctx); } catch { return { ok: false, message_fa: 'کد مرچنت زیبال تنظیم نشده است.' }; }
    const r = await callJson(ctx, { url: api('inquiry'), body: { merchant: m, trackId: 0 }, op: 'inquiry-test', allowHosts: [HOST] });
    const c = code(r);
    if (c === '203' || c === '100') return { ok: true, message_fa: `اتصال به زیبال برقرار است (${ctx.config?.sandbox ? 'sandbox' : 'production'}).` };
    if (c === '102' || c === '103') return { ok: false, message_fa: `زیبال مرچنت را نپذیرفت (کد ${c}).` };
    return { ok: false, message_fa: `زیبال پاسخ داد: کد ${c}${r.data?.message ? ` — ${str(r.data.message, 200)}` : ''}` };
  },
};
