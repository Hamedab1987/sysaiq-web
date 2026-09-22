// Public pay-link routes (no cookies, no CSRF — nothing here is admin):
//   GET  /p/:code                          302 → /:lang/pay/:token (SMS short link)
//   GET  /:lang/pay/:token                 invoice + gateway choice
//   POST /api/pay/:token/start             {gateway} → {redirectUrl} (JSON) or 303 (plain form)
//   GET|POST /api/pay/callback/:gateway?p= bank return → verify → 303 to the result page, always
//   GET  /:lang/pay/:token/result?p=       outcome of that payment
//   GET  /:lang/pay/:token/receipt         printable receipt (paid invoices only)
//   GET  /api/pay/mock/bank?authority=     dev-only fake bank page
// Every response: Cache-Control no-store + X-Robots-Tag noindex. Rate limits
// per IP on start and callback. The callback router parses urlencoded bodies
// itself (PayPing posts a form) — app.js only parses JSON.
import express from 'express';
import rateLimit from 'express-rate-limit';
import { db } from '../../db/index.js';
import { config } from '../../config.js';
import { HttpError, asyncHandler } from '../../lib/errors.js';
import { buildCsp } from '../../lib/csp.js';
import { getInvoiceByToken, getInvoiceByShortCode, TOKEN_RE } from '../../payments/invoices.js';
import { start, handleCallback, getPayment, resultPath } from '../../payments/service.js';
import { hasGateway } from '../../payments/registry.js';
import { lookup as mockLookup, settle as mockSettle } from '../../payments/gateways/mock.js';
import { renderPayPage, renderResultPage, renderReceipt, renderMockBank } from '../../render/pay.js';
import { ensureGatewayCsp } from '../../payments/config.js';
import { startReconcile } from '../../payments/reconcile.js';

const router = express.Router();
const rateMax = (env, dflt) => (/^[1-9]\d{0,5}$/.test(process.env[env] || '') ? Number(process.env[env]) : dflt);
const startLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: rateMax('PAY_START_RATE_MAX', 30), standardHeaders: true, legacyHeaders: false });
const callbackLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: rateMax('PAY_CALLBACK_RATE_MAX', 120), standardHeaders: true, legacyHeaders: false });
const pageLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: rateMax('PAY_PAGE_RATE_MAX', 300), standardHeaders: true, legacyHeaders: false });

// per route (the router is mounted at '/', so a router.use() would tag the whole site)
function priv(_req, res, next) {
  res.set('Cache-Control', 'no-store');
  res.set('X-Robots-Tag', 'noindex, nofollow');
  next();
}

const lang = req => (req.params.lang === 'en' ? 'en' : 'fa');
const wantsJson = req => /json/i.test(req.get('accept') || '') || req.is('json') || req.get('x-requested-with') === 'fetch';
const badToken = req => !TOKEN_RE.test(String(req.params.token || ''));
const pidOf = src => { const n = Number(src); return Number.isInteger(n) && n > 0 ? n : 0; };

// ---- short link -------------------------------------------------------------
router.get('/p/:code', priv, pageLimiter, (req, res, next) => {
  const inv = getInvoiceByShortCode(req.params.code);
  if (!inv) return next();
  res.redirect(302, `/${inv.language === 'en' ? 'en' : 'fa'}/pay/${inv.token}`);
});

// ---- pages ------------------------------------------------------------------
router.get('/:lang(en|fa)/pay/:token', priv, pageLimiter, (req, res, next) => {
  if (badToken(req)) return next();
  const inv = getInvoiceByToken(req.params.token);
  if (!inv) return next();
  res.type('html').send(renderPayPage(inv, lang(req)));
});

router.get('/:lang(en|fa)/pay/:token/result', priv, pageLimiter, (req, res, next) => {
  if (badToken(req)) return next();
  const inv = getInvoiceByToken(req.params.token);
  if (!inv) return next();
  const pid = pidOf(req.query.p);
  let payment = pid ? getPayment(pid) : null;
  if (payment && payment.invoice_id !== inv.id) payment = null;   // a pid from another invoice shows nothing
  if (!payment) payment = [...inv.payments].reverse().find(p => p.status !== 'initiated') || null;
  const outcome = !payment ? (inv.status === 'paid' ? 'succeeded' : 'unknown')
    : payment.status === 'succeeded' ? 'succeeded'
      : ['pending', 'verifying', 'initiated'].includes(payment.status) ? 'pending' : payment.status;
  res.type('html').send(renderResultPage(inv, payment, outcome, lang(req)));
});

router.get('/:lang(en|fa)/pay/:token/receipt', priv, pageLimiter, (req, res, next) => {
  if (badToken(req)) return next();
  const inv = getInvoiceByToken(req.params.token);
  if (!inv) return next();
  const payment = inv.payments.find(p => p.status === 'succeeded');
  if (inv.status !== 'paid' || !payment) return res.redirect(302, `/${lang(req)}/pay/${inv.token}`);
  res.type('html').send(renderReceipt(inv, payment, lang(req)));
});

// ---- start ------------------------------------------------------------------
router.post('/api/pay/:token/start', priv, startLimiter, express.urlencoded({ extended: false, limit: '4kb' }), asyncHandler(async (req, res) => {
  if (badToken(req)) throw new HttpError(404, 'not_found', 'فاکتور یافت نشد');
  const gateway = String(req.body?.gateway || '').slice(0, 20);
  if (!hasGateway(gateway)) throw new HttpError(422, 'validation', 'Validation failed', { gateway: 'درگاه معتبر نیست' });
  const r = await start({ token: req.params.token, gatewayId: gateway, ip: req.ip });
  if (wantsJson(req)) return res.json({ ok: true, redirectUrl: r.redirectUrl, paymentId: r.paymentId });
  res.redirect(303, r.redirectUrl);
}));

// ---- callback ---------------------------------------------------------------
// Whatever comes back, the visitor lands on the result page; the JSON error
// shape is never shown to a customer mid-payment.
const callback = asyncHandler(async (req, res) => {
  const pid = pidOf(req.query.p);
  const gatewayId = String(req.params.gateway || '').slice(0, 20);
  if (!pid || !hasGateway(gatewayId)) return res.status(404).type('html').send('<!doctype html><title>404</title><p>Not found</p>');
  const r = await handleCallback({ gatewayId, pid, query: req.query || {}, body: req.body || {} });
  if (!r.invoice) return res.status(404).type('html').send('<!doctype html><title>404</title><p>Not found</p>');
  res.redirect(303, resultPath(r.invoice, pid));
});
router.get('/api/pay/callback/:gateway', priv, callbackLimiter, callback);
router.post('/api/pay/callback/:gateway', priv, callbackLimiter, express.urlencoded({ extended: false, limit: '16kb' }), callback);

// ---- mock bank (dev only) ---------------------------------------------------
if (!config.isProd) {
  router.get('/api/pay/mock/bank', priv, (req, res, next) => {
    const authority = String(req.query.authority || '').slice(0, 40);
    if (!/^M[0-9a-f]{32}$/.test(authority) || !mockLookup(authority)) return next();
    const payment = db.prepare("SELECT * FROM payments WHERE gateway='mock' AND authority=?").get(authority);
    const invoice = payment && db.prepare('SELECT id, number FROM invoices WHERE id=?').get(payment.invoice_id);
    if (!invoice) return next();
    res.set('Content-Security-Policy', buildCsp('page'));   // the /api policy would block the page's own styles
    res.type('html').send(renderMockBank(payment, invoice));
  });
  // the tester's button = the bank's decision: recorded in the mock, then the
  // customer is sent to our callback exactly like a real bank would
  router.post('/api/pay/mock/bank', priv, express.urlencoded({ extended: false, limit: '4kb' }), (req, res, next) => {
    const authority = String(req.body?.authority || '').slice(0, 40);
    const status = String(req.body?.status || '').slice(0, 12);
    if (!/^M[0-9a-f]{32}$/.test(authority) || !mockSettle(authority, status)) return next();
    const payment = db.prepare("SELECT id FROM payments WHERE gateway='mock' AND authority=?").get(authority);
    if (!payment) return next();
    res.redirect(303, `/api/pay/callback/mock?p=${payment.id}&authority=${authority}&status=${encodeURIComponent(status)}`);
  });
}

ensureGatewayCsp();   // bank origins already enabled in the stored config → form-action, from the first request
if (config.env !== 'test') startReconcile();

export default { basePath: '/', order: 45, router };
