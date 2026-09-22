// Invoices + payments admin API (mounted under /api/admin/invoices by the
// auto-mounter, behind requireAdmin + csrfGuard + write audit).
//   GET    /invoices?status&q&limit&offset      list (no items)   · GET /invoices/stats
//   POST   /invoices                            create draft      · GET/PUT/DELETE /invoices/:id (DELETE: drafts only)
//   POST   /invoices/:id/send {channel}         draft|expired|sent → sent + invoice.sent event (SMS/email listeners)
//   POST   /invoices/:id/remind {channel}       reminder (sent only)
//   POST   /invoices/:id/mark-paid {ref, note, amount?}   manual settlement
//   POST   /invoices/:id/cancel {reason} · POST /invoices/:id/duplicate · GET /invoices/:id/qr.svg
//   GET    /invoices/payments?status            all payments      · POST /invoices/payments/:id/reverify
//   POST   /invoices/payments/reconcile         run the reconcile pass now
// Money in, money out: integer Toman. Secrets never appear here.
import express from 'express';
import { db } from '../../db/index.js';
import { HttpError, asyncHandler } from '../../lib/errors.js';
import { audit } from '../../lib/audit.js';
import { qrSvg } from '../../lib/qr.js';
import * as inv from '../../payments/invoices.js';
import { listPayments, verifyPayment, getPayment } from '../../payments/service.js';
import { reconcileOnce } from '../../payments/reconcile.js';
import { readPayConfig } from '../../payments/config.js';

const router = express.Router();
const idOf = req => { const n = Number(req.params.id); if (!Number.isInteger(n) || n <= 0) throw new HttpError(404, 'not_found', 'Not found'); return n; };
const channelOf = body => (['sms', 'email', 'both', 'none'].includes(body?.channel) ? body.channel : 'sms');
const settle = ms => new Promise(r => setTimeout(r, ms));
const smsFor = id => db.prepare('SELECT id, template_key, provider, to_number, status, error_code, error_message, created_at FROM sms_log WHERE invoice_id=? ORDER BY id DESC LIMIT 10').all(id);
const view = row => (row ? { ...row, sms: smsFor(row.id) } : null);
const found = row => { if (!row) throw new HttpError(404, 'not_found', 'Invoice not found'); return row; };

// ---- payments (before /:id so "payments" is never read as an id) ----------
router.get('/payments', (req, res) => res.json(listPayments({ status: String(req.query.status || '').slice(0, 20), limit: req.query.limit })));
router.post('/payments/reconcile', asyncHandler(async (req, res) => {
  const r = await reconcileOnce();
  audit(req, 'reconcile', 'payments', '', `checked ${r.checked}, verified ${r.verified}, expired ${r.expired}`);
  res.json({ ok: true, ...r });
}));
router.post('/payments/:id/reverify', asyncHandler(async (req, res) => {
  const id = idOf(req);
  if (!getPayment(id)) throw new HttpError(404, 'not_found', 'Payment not found');
  const r = await verifyPayment(id, { force: true });
  audit(req, 'reverify', 'payments', id, `outcome ${r.outcome}`);
  res.json({ ok: true, outcome: r.outcome, payment: r.payment, invoice: r.invoice ? view(r.invoice) : null });
}));

// ---- invoices --------------------------------------------------------------
router.get('/stats', (_req, res) => {
  const by = Object.fromEntries(db.prepare('SELECT status, COUNT(*) c, COALESCE(SUM(amount_toman),0) s FROM invoices GROUP BY status').all().map(r => [r.status, { count: r.c, sum: r.s }]));
  const attention = db.prepare("SELECT COUNT(*) c FROM payments WHERE status IN ('orphaned','pending','verifying')").get().c;
  res.json({ by_status: by, attention, config: readPayConfig() });
});
router.get('/', (req, res) => {
  const rows = inv.listInvoices({ status: String(req.query.status || ''), q: String(req.query.q || ''), limit: req.query.limit, offset: req.query.offset });
  res.json(rows);
});
router.post('/', (req, res) => {
  const row = inv.createInvoice(req.body, { adminUser: req.admin?.u });
  res.status(201).json(view(row));
});
router.get('/:id', (req, res) => res.json(view(found(inv.getInvoice(idOf(req))))));
router.put('/:id', (req, res) => res.json(view(inv.updateInvoice(idOf(req), req.body))));
router.delete('/:id', (req, res) => {
  const row = found(inv.getInvoice(idOf(req)));
  if (row.status !== 'draft' || row.payments.length) throw new HttpError(409, 'invoice_state', 'فقط پیش‌نویس بدون پرداخت قابل حذف است');
  db.prepare('DELETE FROM invoices WHERE id=?').run(row.id);
  res.json({ ok: true });
});

router.get('/:id/qr.svg', (req, res) => {
  const row = found(inv.getInvoice(idOf(req)));
  res.set('Cache-Control', 'no-store');
  res.type('image/svg+xml').send(qrSvg(row.short_url, { size: 240, title: row.short_url }));
});

router.post('/:id/send', asyncHandler(async (req, res) => {
  const id = idOf(req);
  const channel = channelOf(req.body);
  const row = inv.sendInvoice(id, { channel });
  audit(req, 'send', 'invoices', id, `${row.number} via ${channel}`);
  await settle(channel === 'none' ? 0 : 250);   // let the SMS listener write its log row so the UI can show it
  res.json(view(inv.getInvoice(id)));
}));
router.post('/:id/remind', asyncHandler(async (req, res) => {
  const id = idOf(req);
  const cur = found(inv.getInvoice(id));
  if (cur.status !== 'sent') throw new HttpError(409, 'invoice_state', 'یادآوری فقط برای فاکتور ارسال‌شده ممکن است');
  const channel = channelOf(req.body);
  const row = inv.sendInvoice(id, { reminder: true, channel });
  audit(req, 'remind', 'invoices', id, `${row.number} via ${channel}`);
  await settle(250);
  res.json(view(inv.getInvoice(id)));
}));
router.post('/:id/mark-paid', (req, res) => {
  const id = idOf(req);
  const row = inv.markPaidManual(id, { ref: req.body?.ref, note: req.body?.note, amount: req.body?.amount, adminUser: req.admin?.u });
  audit(req, 'mark-paid', 'invoices', id, `${row.number} manual`);
  res.json(view(row));
});
router.post('/:id/cancel', (req, res) => {
  const id = idOf(req);
  const row = inv.cancelInvoice(id, { reason: req.body?.reason });
  audit(req, 'cancel', 'invoices', id, row.number);
  res.json(view(row));
});
router.post('/:id/duplicate', (req, res) => {
  const row = inv.duplicateInvoice(idOf(req), { adminUser: req.admin?.u });
  res.status(201).json(view(row));
});

export default { basePath: '/invoices', order: 60, router };
