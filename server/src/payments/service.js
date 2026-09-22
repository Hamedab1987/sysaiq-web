// Payment service — the only code that talks to a gateway adapter.
//   start({ token, gatewayId, ip })          → { redirectUrl, paymentId }
//   handleCallback({ gatewayId, pid, query, body }) → { payment, invoice, outcome }  (never throws for a bad callback)
//   verifyPayment(paymentId, { force })      the shared verify → markPaid path (callback, reconcile, admin reverify)
//   markPaid(paymentId, verifyResult)        ONE transaction; ux_pay_one_success violation ⇒ orphaned
// Safety rules 1–13 of .claude/skills/iran-payment-gateways are implemented
// here: the amount verified is payments.amount_toman, the payment is found by
// our pid and cross-checked against the stored authority + gateway, the claim
// is an atomic UPDATE, replays and races render the stored state, echoed
// amount / order id mismatches become 'orphaned', and success is decided by
// the server-to-server verify only.
import { createHash } from 'node:crypto';
import { db } from '../db/index.js';
import { config } from '../config.js';
import { HttpError } from '../lib/errors.js';
import { emit } from '../lib/events.js';
import { getSecret } from '../lib/secrets.js';
import { httpJson } from '../lib/http.js';
import { getGateway } from './registry.js';
import { readGatewaysConfig, RELAY_SECRET } from './config.js';
import { getInvoice, getInvoiceByToken } from './invoices.js';
import { GatewayError, redact } from './gateways/common.js';
import { sendPaymentReceipt } from '../mail.js';

export const CLAIM_STALE_SECONDS = 60;
// tests may inject fetch / dns lookup / log for the real adapters
export const transport = { fetch: null, lookup: undefined, log: undefined };

let stmts = null;
const q = () => stmts ||= {
  byId: db.prepare('SELECT * FROM payments WHERE id=?'),
  insert: db.prepare(`INSERT INTO payments (invoice_id, gateway, status, amount_toman, ip_hash) VALUES (?, ?, 'initiated', ?, ?)`),
  created: db.prepare(`UPDATE payments SET status='pending', authority=?, fee_toman=?, raw_create=?, updated_at=datetime('now') WHERE id=? AND status='initiated'`),
  createFailed: db.prepare(`UPDATE payments SET status='failed', error_code=?, error_message=?, raw_create=?, updated_at=datetime('now') WHERE id=?`),
  claim: db.prepare(`UPDATE payments SET status='verifying', claimed_at=datetime('now'), updated_at=datetime('now')
    WHERE id=? AND (status IN ('initiated','pending') OR (status='verifying' AND claimed_at < datetime('now', ?)))`),
  callback: db.prepare(`UPDATE payments SET raw_callback=?, updated_at=datetime('now') WHERE id=?`),
  setStatus: db.prepare(`UPDATE payments SET status=?, error_code=?, error_message=?, raw_verify=COALESCE(NULLIF(?, ''), raw_verify), updated_at=datetime('now') WHERE id=?`),
  succeed: db.prepare(`UPDATE payments SET status='succeeded', ref_id=?, card_pan=?, card_hash=?, fee_toman=COALESCE(?, fee_toman), already_verified=?, error_code='', error_message='',
    raw_verify=?, verified_at=datetime('now'), updated_at=datetime('now') WHERE id=?`),
  invoicePaid: db.prepare(`UPDATE invoices SET status='paid', paid_at=datetime('now'), paid_method=?, paid_ref=?, updated_at=datetime('now') WHERE id=? AND status <> 'paid'`),
};

const ipHash = ip => (ip ? createHash('sha256').update(String(ip)).digest('hex').slice(0, 16) : '');
const cap = (s, n = 300) => String(s ?? '').slice(0, n);
const rawJson = x => { try { return JSON.stringify(redact(x ?? {})); } catch { return '{}'; } };
export const getPayment = id => q().byId.get(Number(id)) || null;

// adapter call context: config flags + secret getter + pinned http + relay
export function gatewayCtx(gateway) {
  const cfg = readGatewaysConfig();
  const relay = cfg.relay_base ? { base: cfg.relay_base, token: getSecret(RELAY_SECRET) || '' } : null;
  const log = transport.log || console.log;
  const fetchFn = transport.fetch || (opts => httpJson({ provider: gateway.id, lookup: transport.lookup, log, ...opts }));
  return { config: cfg.gateways[gateway.id] || {}, secret: getSecret, fetch: fetchFn, relay, log };
}

export const callbackUrl = (gatewayId, pid) => `${config.publicBaseUrl}/api/pay/callback/${gatewayId}?p=${pid}`;
export const resultPath = (inv, pid) => `/${inv.language === 'en' ? 'en' : 'fa'}/pay/${inv.token}/result${pid ? `?p=${pid}` : ''}`;

function enabledGateway(gatewayId) {
  const cfg = readGatewaysConfig();
  let gw;
  try { gw = getGateway(gatewayId); } catch { throw new HttpError(404, 'gateway_unknown', 'درگاه ناشناخته'); }
  if (!cfg.gateways[gw.id]?.enabled) throw new HttpError(409, 'gateway_disabled', 'این درگاه فعال نیست');
  return gw;
}

// ---- start -----------------------------------------------------------------
export async function start({ token, gatewayId, ip = '' }) {
  const inv = getInvoiceByToken(token);
  if (!inv) throw new HttpError(404, 'not_found', 'فاکتور یافت نشد');
  if (inv.status === 'paid') throw new HttpError(409, 'invoice_paid', 'این فاکتور قبلاً پرداخت شده است');
  if (inv.status !== 'sent') throw new HttpError(409, `invoice_${inv.status}`, inv.status === 'expired' ? 'مهلت پرداخت این فاکتور گذشته است' : 'این فاکتور در وضعیت قابل پرداخت نیست');
  const gw = enabledGateway(gatewayId);
  if (inv.amount_toman < gw.minToman || inv.amount_toman > gw.maxToman) throw new HttpError(409, 'amount_out_of_range', 'مبلغ فاکتور خارج از محدودهٔ این درگاه است');
  // one live attempt at a time: a second tab must not open a second bank session for the same invoice
  const live = db.prepare(`SELECT id FROM payments WHERE invoice_id=? AND status IN ('verifying','succeeded') LIMIT 1`).get(inv.id);
  if (live) throw new HttpError(409, 'payment_in_progress', 'پرداخت این فاکتور در حال بررسی است');

  const pid = Number(q().insert.run(inv.id, gw.id, inv.amount_toman, ipHash(ip)).lastInsertRowid);
  let r;
  try {
    r = await gw.create(gatewayCtx(gw), {
      amountToman: inv.amount_toman, callbackUrl: callbackUrl(gw.id, pid),
      description: `${inv.number} — ${inv.title}`.slice(0, 200), mobile: inv.customer_phone || '', email: inv.customer_email || '',
      orderId: `${inv.number}-${pid}`, payerName: inv.customer_name,
    });
  } catch (e) {
    q().createFailed.run(cap(e?.code || 'error', 40), cap(e?.message), '{}', pid);
    throw new HttpError(502, 'gateway_error', e instanceof GatewayError && e.code === 'not_configured' ? 'این درگاه هنوز پیکربندی نشده است' : 'اتصال به درگاه برقرار نشد؛ لطفاً دوباره تلاش کنید');
  }
  if (!r?.ok || !r.authority || !r.redirectUrl) {
    q().createFailed.run(cap(r?.code || 'rejected', 40), cap(r?.message), rawJson(r?.raw), pid);
    throw new HttpError(502, 'gateway_rejected', 'درگاه درخواست پرداخت را نپذیرفت؛ لطفاً درگاه دیگری را امتحان کنید یا با ما تماس بگیرید');
  }
  // the redirect must be a bank origin we know (or the local mock page) — never a URL the gateway made up
  const allowed = (gw.redirectOrigins || []).some(o => r.redirectUrl.startsWith(`${o}/`)) || (gw.id === 'mock' && r.redirectUrl.startsWith('/api/pay/mock/bank?'));
  if (!allowed) {
    q().createFailed.run('bad_redirect', 'redirect origin not allowed', rawJson(r.raw), pid);
    throw new HttpError(502, 'gateway_rejected', 'پاسخ درگاه معتبر نبود');
  }
  const ok = q().created.run(String(r.authority), Number.isFinite(r.feeToman) ? r.feeToman : null, rawJson(r.raw), pid).changes === 1;
  if (!ok) throw new HttpError(409, 'payment_state', 'وضعیت پرداخت تغییر کرده است');
  return { redirectUrl: r.redirectUrl, paymentId: pid, gateway: gw.id };
}

// ---- callback --------------------------------------------------------------
// Always resolves (the route always 303s to the result page). `outcome` is
// what the result page shows: succeeded | failed | cancelled | pending |
// mismatch | orphaned | replayed | unknown
export async function handleCallback({ gatewayId, pid, query = {}, body = {} }) {
  const id = Number(pid);
  const payment = Number.isInteger(id) && id > 0 ? getPayment(id) : null;
  if (!payment) return { payment: null, invoice: null, outcome: 'unknown' };
  const invoice = getInvoice(payment.invoice_id);
  if (payment.gateway !== String(gatewayId)) return { payment, invoice, outcome: 'mismatch' };
  let gw;
  try { gw = getGateway(gatewayId); } catch { return { payment, invoice, outcome: 'mismatch' }; }
  const cb = gw.parseCallback({ query, body });
  q().callback.run(rawJson({ outcome: cb.outcome, extra: cb.extra, authority_ok: cb.authority === payment.authority }), id);
  if (!cb.authority || cb.authority !== payment.authority) return { payment, invoice, outcome: 'mismatch' };
  if (payment.status === 'succeeded') return { payment, invoice, outcome: 'replayed' };
  if (['failed', 'cancelled', 'expired', 'orphaned'].includes(payment.status)) return { payment, invoice, outcome: payment.status };
  // atomic claim: exactly one caller proceeds; a stale 'verifying' (crash) may be re-claimed after 60 s
  if (q().claim.run(id, `-${CLAIM_STALE_SECONDS} seconds`).changes !== 1) return { payment: getPayment(id), invoice, outcome: 'pending' };
  if (cb.outcome !== 'ok') {
    const status = cb.outcome === 'cancelled' ? 'cancelled' : 'failed';
    q().setStatus.run(status, cap(cb.extra?.errorCode || cb.outcome, 40), cap(cb.outcome === 'cancelled' ? 'انصراف کاربر در صفحهٔ بانک' : 'پرداخت در بانک ناموفق بود'), '', id);
    const p = getPayment(id);
    emit('payment.failed', { payment: p, invoice });
    return { payment: p, invoice, outcome: status };
  }
  return verifyClaimed(id, cb.extra);
}

// ---- verify + markPaid -----------------------------------------------------
// runs after a successful claim; decides succeeded | orphaned | pending | failed
async function verifyClaimed(id, extra = {}) {
  const payment = getPayment(id);
  const invoice = getInvoice(payment.invoice_id);
  const gw = getGateway(payment.gateway);
  let v;
  try {
    v = await gw.verify(gatewayCtx(gw), { authority: payment.authority, amountToman: payment.amount_toman, orderId: `${invoice.number}-${payment.id}`, extra });
  } catch (e) {
    // network trouble: leave it pending for reconcile (PayPing refunds after 10 min, so retry soon)
    q().setStatus.run('pending', cap(e?.code || 'verify_error', 40), cap(e?.message), '', id);
    return { payment: getPayment(id), invoice, outcome: 'pending' };
  }
  const raw = rawJson(v.raw);
  if (v.pending) {
    q().setStatus.run('pending', cap(v.code || 'pending', 40), cap(v.message), raw, id);
    return { payment: getPayment(id), invoice, outcome: 'pending' };
  }
  if (!v.ok) {
    q().setStatus.run('failed', cap(v.code || 'verify_failed', 40), cap(v.message || 'تأیید پرداخت ناموفق بود'), raw, id);
    const p = getPayment(id);
    emit('payment.failed', { payment: p, invoice });
    return { payment: p, invoice, outcome: 'failed' };
  }
  // the gateway echoed what it charged: it must equal our snapshot (rule 6)
  const amountMismatch = v.amountToman !== null && v.amountToman !== undefined && Number(v.amountToman) !== payment.amount_toman;
  const orderMismatch = v.orderIdEcho && v.orderIdEcho !== `${invoice.number}-${payment.id}`;
  if (amountMismatch || orderMismatch) return orphan(id, invoice, amountMismatch ? 'amount_mismatch' : 'order_mismatch', `درگاه ${amountMismatch ? `مبلغ ${v.amountToman}` : `شناسهٔ ${v.orderIdEcho}`} را برگرداند؛ با فاکتور نمی‌خواند — نیاز به استرداد دستی`, raw);
  return markPaid(id, v, raw);
}

function orphan(id, invoice, code, message, raw) {
  q().setStatus.run('orphaned', cap(code, 40), cap(message), raw || '', id);
  const p = getPayment(id);
  emit('payment.orphaned', { payment: p, invoice });
  return { payment: p, invoice, outcome: 'orphaned' };
}

// ONE transaction: payment succeeded + invoice paid. The partial unique index
// ux_pay_one_success throws on a second success for the same invoice — the
// row then becomes 'orphaned' and the owner is alerted to refund manually.
export function markPaid(id, v, raw = null) {
  const payment = getPayment(id);
  const invoice = getInvoice(payment.invoice_id);
  const rawV = raw ?? rawJson(v.raw);
  try {
    db.transaction(() => {
      q().succeed.run(cap(v.refId, 64), cap(v.cardPan, 32), cap(v.cardHash, 128), Number.isFinite(v.feeToman) ? v.feeToman : null, v.alreadyVerified ? 1 : 0, rawV, id);
      q().invoicePaid.run(payment.gateway, cap(v.refId, 64), payment.invoice_id);
    })();
  } catch (e) {
    if (/UNIQUE|ux_pay_one_success/i.test(String(e?.message))) return orphan(id, invoice, 'duplicate_success', 'این فاکتور قبلاً با پرداخت دیگری تسویه شده بود — نیاز به استرداد دستی', rawV);
    throw e;
  }
  const p = getPayment(id);
  const inv = getInvoice(payment.invoice_id);
  emit('payment.succeeded', { payment: p, invoice: inv });
  sendPaymentReceipt(inv, p).catch(e => console.error(`[mail] payment #${p.id}: ${e?.message || e}`));   // no-op without SMTP / email
  return { payment: p, invoice: inv, outcome: 'succeeded' };
}

// admin «بررسی مجدد» / reconcile: claim, then verify with the stored amount.
// A payment without an authority never reached the bank and cannot be verified.
export async function verifyPayment(id, { force = false } = {}) {
  const payment = getPayment(id);
  if (!payment) throw new HttpError(404, 'not_found', 'Payment not found');
  if (payment.status === 'succeeded') return { payment, invoice: getInvoice(payment.invoice_id), outcome: 'replayed' };
  if (payment.gateway === 'manual' || !payment.authority) return { payment, invoice: getInvoice(payment.invoice_id), outcome: payment.status };
  if (!['initiated', 'pending', 'verifying', 'failed', 'cancelled', 'expired'].includes(payment.status)) return { payment, invoice: getInvoice(payment.invoice_id), outcome: payment.status };
  const claim = force
    ? db.prepare(`UPDATE payments SET status='verifying', claimed_at=datetime('now'), updated_at=datetime('now') WHERE id=? AND status <> 'succeeded'`).run(id)
    : q().claim.run(id, `-${CLAIM_STALE_SECONDS} seconds`);
  if (claim.changes !== 1) return { payment: getPayment(id), invoice: getInvoice(payment.invoice_id), outcome: 'pending' };
  let extra = {};
  try { extra = JSON.parse(payment.raw_callback || '{}').extra || {}; } catch { /* ignore */ }
  return verifyClaimed(id, extra);
}

// admin list of payments across invoices
export function listPayments({ status = '', limit = 200 } = {}) {
  const where = status ? 'WHERE p.status=?' : '';
  const args = status ? [status] : [];
  return db.prepare(`SELECT p.id, p.invoice_id, p.gateway, p.status, p.amount_toman, p.authority, p.ref_id, p.card_pan, p.fee_toman, p.already_verified,
      p.error_code, p.error_message, p.claimed_at, p.verified_at, p.created_at, p.updated_at,
      i.number AS invoice_number, i.customer_name, i.status AS invoice_status
    FROM payments p JOIN invoices i ON i.id = p.invoice_id ${where} ORDER BY p.id DESC LIMIT ?`).all(...args, Math.min(1000, Math.max(1, Number(limit) || 200)));
}
