// Helpers shared by the gateway adapters. toWire() is the ONLY place a Toman
// amount becomes the provider's unit (Rial ×10); every adapter has a unit
// test on it. Adapters never throw on a provider "no" — they return
// {ok:false, code, message} and the service decides what to store.
export class GatewayError extends Error {
  constructor(code, message, extra = {}) {
    super(message || code);
    this.name = 'GatewayError';
    this.code = code;
    Object.assign(this, extra);
  }
}

export function toWire(amountToman, unit) {
  const n = Number(amountToman);
  if (!Number.isSafeInteger(n) || n <= 0) throw new GatewayError('bad_amount', 'amount must be a positive integer Toman');
  if (unit === 'IRR') return n * 10;
  if (unit === 'IRT') return n;
  throw new GatewayError('bad_unit', `unknown wire unit ${unit}`);
}
export function fromWire(amount, unit) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return null;
  return unit === 'IRR' ? Math.round(n / 10) : Math.round(n);
}

export const str = (x, max = 200) => (x === undefined || x === null ? '' : String(x)).trim().slice(0, max);
export const num = x => (x === undefined || x === null || x === '' ? null : Number(x));

// keep a provider payload for the audit trail without card/personal data
const DROP = /^(card|pan|cardpan|card_pan|cardnumber|cardhashpan|card_hash|mobile|email|payer|payername|payeridentity|description|merchant|merchant_id|token|authorization)$/i;
export function redact(obj, depth = 0) {
  if (depth > 4 || obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.slice(0, 20).map(x => redact(x, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (DROP.test(k)) continue;
    out[k] = typeof v === 'string' ? v.slice(0, 200) : redact(v, depth + 1);
  }
  return out;
}

// gateway-masked PAN as given ("603799******1234"); anything that looks like
// a full card number is dropped rather than stored
export function maskedPan(s) {
  const v = str(s, 32);
  if (!v) return '';
  if (/^\d{13,19}$/.test(v)) return `${v.slice(0, 6)}******${v.slice(-4)}`;
  return v;
}

// provider call with the injected fetch, relay and timeout; JSON in/out
export async function callJson(ctx, { url, method = 'POST', headers = {}, body, op, allowHosts }) {
  const r = await ctx.fetch({ url, method, headers, body, op, allowHosts, relay: ctx.relay || null, timeoutMs: 20000 });
  return r;
}
