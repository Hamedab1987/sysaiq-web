// End-to-end over the real app with the mock gateway + mock SMS provider:
// create → send (sms_log row) → page → start → mock bank → callback →
// verify → paid → receipt, plus every safety rule: replayed callback, two
// concurrent callbacks, amount tampering, expired invoice, edit locks,
// unique-index race → orphaned, reconcile, headers, mobile/amount
// normalisation, QR determinism, admin payments endpoints.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp } from '../helpers.js';

let t, db, events, service, invoices, reconcile, mock;
before(async () => {
  t = await startTestApp();
  ({ db } = await import('../../src/db/index.js'));
  events = await import('../../src/lib/events.js');
  service = await import('../../src/payments/service.js');
  invoices = await import('../../src/payments/invoices.js');
  reconcile = await import('../../src/payments/reconcile.js');
  mock = await import('../../src/payments/gateways/mock.js');
  await t.loginAsAdmin();
  assert.equal((await t.fetchAdmin('/sms/config', { method: 'PUT', body: { active: 'mock', owner_mobile: '09125130505' } })).status, 200);
  assert.equal((await t.fetchAdmin('/gateways', { method: 'PUT', body: { gateways: { mock: { enabled: true } }, default: 'mock' } })).status, 200);
});
after(async () => { await t.close(); });

const settle = (ms = 60) => new Promise(r => setTimeout(r, ms));
// read the body only on a mismatch (a message argument would consume it eagerly)
async function expectStatus(r, status) { if (r.status !== status) assert.fail(`expected ${status}, got ${r.status}: ${await r.text()}`); }
const smsRows = id => db.prepare('SELECT template_key, to_number, status FROM sms_log WHERE invoice_id=? ORDER BY id').all(id);
const collect = evt => { const seen = []; const off = events.on(evt, p => seen.push(p)); return { seen, off }; };
async function makeInvoice(extra = {}) {
  const r = await t.fetchAdmin('/invoices', { method: 'POST', body: { customer_name: 'سارا احمدی', customer_phone: '۰۹۱۲ ۳۴۵ ۶۷۸۹', customer_email: 'sara@example.com', title: 'وب‌سایت شرکتی — مرحلهٔ ۱', items: [{ title: 'طراحی', qty: 1, unit_toman: '۱۲,۵۰۰,۰۰۰ تومان' }, { title: 'پشتیبانی', qty: 2, unit_toman: 500000 }], discount_toman: 500000, ...extra } });
  await expectStatus(r, 201);
  return r.json();
}
async function sendInvoice(id, channel = 'sms') {
  const r = await t.fetchAdmin(`/invoices/${id}/send`, { method: 'POST', body: { channel } });
  await expectStatus(r, 200);
  return r.json();
}
async function startPayment(token, gateway = 'mock') {
  const r = await fetch(`${t.base}/api/pay/${token}/start`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ gateway }) });
  return { status: r.status, body: await r.json() };
}
const bankPress = (authority, status) => fetch(`${t.base}/api/pay/mock/bank`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ authority, status }), redirect: 'manual' });
const callback = (pid, authority, status = 'ok') => fetch(`${t.base}/api/pay/callback/mock?p=${pid}&authority=${authority}&status=${status}`, { redirect: 'manual' });
const payment = id => db.prepare('SELECT * FROM payments WHERE id=?').get(id);
const invoiceRow = id => db.prepare('SELECT * FROM invoices WHERE id=?').get(id);

test('create: normalised mobile + Persian amounts, SQ-{jyear}-{seq} numbering, 32-char token, 12-char Crockford code, totals', async () => {
  const a = await makeInvoice();
  assert.match(a.number, /^SQ-14\d\d-\d{4}$/);
  assert.match(a.token, /^[A-Za-z0-9_-]{32}$/);
  assert.match(a.short_code, /^[0-9A-HJKMNP-TV-Z]{12}$/);
  assert.deepEqual([a.customer_phone, a.subtotal_toman, a.discount_toman, a.amount_toman, a.status, a.items.length], ['09123456789', 13500000, 500000, 13000000, 'draft', 2]);
  const b = await makeInvoice();
  assert.equal(Number(b.number.slice(-4)), Number(a.number.slice(-4)) + 1);
  // validation: bad mobile / empty items / fractional amount → 422 with field names
  const bad = await t.fetchAdmin('/invoices', { method: 'POST', body: { customer_name: 'x', customer_phone: '123', title: 't', items: [{ title: '', qty: 0, unit_toman: '12.5' }] } });
  assert.equal(bad.status, 422);
  const j = await bad.json();
  assert.ok(j.fields.customer_phone && j.fields['items[0].title'] && j.fields['items[0].qty'] && j.fields['items[0].unit_toman']);
  // tax: 9% on (subtotal - discount)
  const c = await makeInvoice({ tax_percent: 9 });
  assert.deepEqual([c.tax_toman, c.amount_toman], [1170000, 14170000]);
  // short code lookup is Crockford-tolerant: lowercase, I/L→1, O→0
  const found = invoices.getInvoiceByShortCode(a.short_code.toLowerCase().replace(/1/g, 'l').replace(/0/g, 'o'));
  assert.equal(found?.id, a.id);
});

test('full mock flow: send → SMS row → short link → page → start → bank → callback → verify → paid → receipt → events', async () => {
  const succeeded = collect('payment.succeeded');
  const sentEv = collect('invoice.sent');
  const inv = await makeInvoice();
  const sent = await sendInvoice(inv.id);
  assert.equal(sent.status, 'sent');
  assert.ok(sent.due_at);
  assert.deepEqual(smsRows(inv.id), [{ template_key: 'invoice_link', to_number: '09123456789', status: 'sent' }]);
  assert.equal(sentEv.seen.length, 1);
  assert.equal(sentEv.seen[0].invoice.short_code, inv.short_code);

  let r = await fetch(`${t.base}/p/${inv.short_code}`, { redirect: 'manual' });
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), `/fa/pay/${inv.token}`);
  r = await fetch(`${t.base}/fa/pay/${inv.token}`);
  const page = await r.text();
  assert.equal(r.status, 200);
  assert.ok(page.includes('۱۳٬۰۰۰٬۰۰۰ تومان') && page.includes('name="gateway" value="mock"') && page.includes('/assets/site/pay.js'));
  assert.ok(!page.includes('<script>') && !page.includes('onclick='), 'no inline script');
  assert.ok(page.includes('حامد ابوعلی'), 'seller identity from site info');
  const en = await (await fetch(`${t.base}/en/pay/${inv.token}`)).text();
  assert.ok(en.includes('13,000,000 Toman') && en.includes('lang="en"'));

  const st = await startPayment(inv.token);
  assert.equal(st.status, 200, JSON.stringify(st.body));
  assert.match(st.body.redirectUrl, /^\/api\/pay\/mock\/bank\?authority=M[0-9a-f]{32}$/);
  const p0 = payment(st.body.paymentId);
  assert.deepEqual([p0.status, p0.amount_toman, p0.gateway], ['pending', 13000000, 'mock']);
  r = await fetch(`${t.base}${st.body.redirectUrl}`);
  assert.equal(r.status, 200);
  assert.ok((await r.text()).includes('پرداخت موفق'));
  assert.ok(r.headers.get('content-security-policy').includes("style-src 'self' 'unsafe-inline'"));

  r = await bankPress(p0.authority, 'ok');
  assert.equal(r.status, 303);
  const cbUrl = r.headers.get('location');
  assert.match(cbUrl, /^\/api\/pay\/callback\/mock\?p=\d+&authority=M/);
  r = await fetch(`${t.base}${cbUrl}`, { redirect: 'manual' });
  assert.equal(r.status, 303);
  assert.equal(r.headers.get('location'), `/fa/pay/${inv.token}/result?p=${st.body.paymentId}`);
  const p1 = payment(st.body.paymentId);
  assert.deepEqual([p1.status, p1.ref_id !== '', p1.card_pan, p1.already_verified], ['succeeded', true, '603799******1234', 0]);
  const row = invoiceRow(inv.id);
  assert.deepEqual([row.status, row.paid_method, row.paid_ref], ['paid', 'mock', p1.ref_id]);

  const result = await (await fetch(`${t.base}${r.headers.get('location')}`)).text();
  assert.ok(result.includes('پرداخت با موفقیت انجام شد') && result.includes(p1.ref_id));
  const receipt = await fetch(`${t.base}/fa/pay/${inv.token}/receipt`);
  const rc = await receipt.text();
  assert.ok(rc.includes('رسید پرداخت') && rc.includes('صورتحساب رسمی مالیاتی نیست') && rc.includes(p1.ref_id));
  await settle();
  assert.equal(succeeded.seen.length, 1);
  assert.deepEqual([succeeded.seen[0].payment.id, succeeded.seen[0].invoice.id], [p1.id, inv.id]);
  assert.deepEqual(smsRows(inv.id).map(s => s.template_key).sort(), ['invoice_link', 'payment_customer', 'payment_owner']);
  // paid page shows the paid state, start refuses
  assert.ok((await (await fetch(`${t.base}/fa/pay/${inv.token}`)).text()).includes('این فاکتور پرداخت شده است'));
  assert.equal((await startPayment(inv.token)).status, 409);
  succeeded.off(); sentEv.off();
});

test('replayed callback renders success without re-verifying; a forged Status=ok never pays', async () => {
  const inv = await makeInvoice();
  await sendInvoice(inv.id, 'none');
  const st = await startPayment(inv.token);
  const p = payment(st.body.paymentId);
  // forged: nobody pressed the bank button → verify says pending → not paid
  let r = await callback(p.id, p.authority, 'ok');
  assert.equal(r.status, 303);
  assert.equal(payment(p.id).status, 'pending');
  assert.equal(invoiceRow(inv.id).status, 'sent');
  // real decision, then two replays
  mock.settle(p.authority, 'ok');
  await callback(p.id, p.authority, 'ok');
  assert.equal(payment(p.id).status, 'succeeded');
  const before = payment(p.id).raw_verify;
  const rep = collect('payment.succeeded');
  await callback(p.id, p.authority, 'ok');
  await callback(p.id, p.authority, 'failed');   // even a contradicting replay changes nothing
  await settle();
  assert.deepEqual([payment(p.id).status, payment(p.id).raw_verify, rep.seen.length], ['succeeded', before, 0]);
  assert.ok((await (await fetch(`${t.base}/fa/pay/${inv.token}/result?p=${p.id}`)).text()).includes('پرداخت با موفقیت انجام شد'));
  rep.off();
  // wrong authority / wrong gateway segment / unknown pid → no state change
  await callback(p.id, 'M' + 'f'.repeat(32), 'ok');
  r = await fetch(`${t.base}/api/pay/callback/zarinpal?p=${p.id}&Authority=A${'0'.repeat(35)}&Status=OK`, { redirect: 'manual' });
  assert.equal(r.status, 303);
  assert.equal((await fetch(`${t.base}/api/pay/callback/mock?p=999999&authority=${p.authority}&status=ok`, { redirect: 'manual' })).status, 404);
  assert.equal(payment(p.id).status, 'succeeded');
});

test('two concurrent callbacks: exactly one verify, one success event', async () => {
  const inv = await makeInvoice();
  await sendInvoice(inv.id, 'none');
  const st = await startPayment(inv.token);
  const p = payment(st.body.paymentId);
  mock.settle(p.authority, 'ok');
  const ev = collect('payment.succeeded');
  const rs = await Promise.all(Array.from({ length: 5 }, () => service.handleCallback({ gatewayId: 'mock', pid: p.id, query: { authority: p.authority, status: 'ok' } })));
  await settle();
  const outcomes = rs.map(r => r.outcome).sort();
  assert.equal(outcomes.filter(o => o === 'succeeded').length, 1, outcomes.join(','));
  assert.ok(outcomes.every(o => ['succeeded', 'pending', 'replayed'].includes(o)));
  assert.equal(ev.seen.length, 1);
  assert.equal(payment(p.id).already_verified, 0);
  ev.off();
});

test('amount tampering: the gateway echo must equal the stored snapshot → orphaned + owner alert, never paid', async () => {
  const inv = await makeInvoice();
  await sendInvoice(inv.id, 'none');
  const st = await startPayment(inv.token);
  const p = payment(st.body.paymentId);
  mock.settle(p.authority, 'ok');
  db.prepare('UPDATE payments SET amount_toman = amount_toman + 1000 WHERE id=?').run(p.id);   // what the bank charged ≠ what we now claim
  const ev = collect('payment.orphaned');
  await callback(p.id, p.authority, 'ok');
  await settle();
  assert.deepEqual([payment(p.id).status, payment(p.id).error_code, invoiceRow(inv.id).status, ev.seen.length], ['orphaned', 'amount_mismatch', 'sent', 1]);
  assert.deepEqual(smsRows(inv.id), [{ template_key: 'payment_owner', to_number: '09125130505', status: 'sent' }]);
  const page = await (await fetch(`${t.base}/fa/pay/${inv.token}/result?p=${p.id}`)).text();
  assert.ok(page.includes('نیاز به بررسی دارد'));
  ev.off();
});

test('bank says failed / cancelled → payment.failed event, invoice stays sent and can be retried', async () => {
  const inv = await makeInvoice();
  await sendInvoice(inv.id, 'none');
  const st = await startPayment(inv.token);
  const p = payment(st.body.paymentId);
  const ev = collect('payment.failed');
  const r = await bankPress(p.authority, 'cancelled');
  await fetch(`${t.base}${r.headers.get('location')}`, { redirect: 'manual' });
  await settle();
  assert.deepEqual([payment(p.id).status, ev.seen.length, invoiceRow(inv.id).status], ['cancelled', 1, 'sent']);
  assert.ok((await (await fetch(`${t.base}/fa/pay/${inv.token}/result?p=${p.id}`)).text()).includes('پرداخت لغو شد'));
  const again = await startPayment(inv.token);
  assert.equal(again.status, 200);
  ev.off();
});

test('expired invoice: lazy expiry at read time, page shows the expired state, start refuses; resend revives it', async () => {
  const inv = await makeInvoice();
  await sendInvoice(inv.id, 'none');
  db.prepare("UPDATE invoices SET due_at = datetime('now', '-1 day') WHERE id=?").run(inv.id);
  const page = await (await fetch(`${t.base}/fa/pay/${inv.token}`)).text();
  assert.ok(page.includes('مهلت پرداخت این فاکتور گذشته است'));
  assert.equal(invoiceRow(inv.id).status, 'expired');
  const st = await startPayment(inv.token);
  assert.deepEqual([st.status, st.body.error], [409, 'invoice_expired']);
  const re = await sendInvoice(inv.id, 'none');
  assert.equal(re.status, 'sent');
  assert.ok(re.due_at > new Date().toISOString().slice(0, 10));
});

test('edit locks: money fields frozen once a payment is in flight or succeeded; note stays editable; cancel/delete rules', async () => {
  const inv = await makeInvoice();
  let r = await t.fetchAdmin(`/invoices/${inv.id}`, { method: 'PUT', body: { title: 'ویرایش‌شده', items: [{ title: 'x', qty: 1, unit_toman: 1000000 }] } });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).amount_toman, 500000);   // 1,000,000 − 500,000 discount
  await sendInvoice(inv.id, 'none');
  await startPayment(inv.token);
  r = await t.fetchAdmin(`/invoices/${inv.id}`, { method: 'PUT', body: { items: [{ title: 'x', qty: 1, unit_toman: 1 }] } });
  assert.equal(r.status, 409);
  assert.equal((await r.json()).error, 'invoice_locked');
  r = await t.fetchAdmin(`/invoices/${inv.id}`, { method: 'PUT', body: { note_internal: 'یادداشت' } });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).note_internal, 'یادداشت');
  assert.equal((await t.fetchAdmin(`/invoices/${inv.id}`, { method: 'DELETE' })).status, 409);
  // a draft with no payments can be deleted; a paid one cannot be cancelled
  const d = await makeInvoice();
  assert.equal((await t.fetchAdmin(`/invoices/${d.id}`, { method: 'DELETE' })).status, 200);
  const paid = await makeInvoice();
  await sendInvoice(paid.id, 'none');
  r = await t.fetchAdmin(`/invoices/${paid.id}/mark-paid`, { method: 'POST', body: { ref: 'BANK-123', note: 'واریز' } });
  assert.equal(r.status, 200);
  const pj = await r.json();
  assert.deepEqual([pj.status, pj.paid_method, pj.paid_ref, pj.payments[0].gateway, pj.payments[0].status], ['paid', 'manual', 'BANK-123', 'manual', 'succeeded']);
  assert.equal((await t.fetchAdmin(`/invoices/${paid.id}/cancel`, { method: 'POST', body: {} })).status, 409);
  assert.equal((await t.fetchAdmin(`/invoices/${paid.id}/mark-paid`, { method: 'POST', body: {} })).status, 409);
  // cancel a sent invoice: page shows cancelled, start refuses
  const c = await makeInvoice();
  await sendInvoice(c.id, 'none');
  assert.equal((await t.fetchAdmin(`/invoices/${c.id}/cancel`, { method: 'POST', body: { reason: 'x' } })).status, 200);
  assert.ok((await (await fetch(`${t.base}/fa/pay/${c.token}`)).text()).includes('این فاکتور لغو شده است'));
  assert.equal((await startPayment(c.token)).status, 409);
});

test('unique-index race: a second success for a paid invoice becomes orphaned (ux_pay_one_success)', async () => {
  const inv = await makeInvoice();
  await sendInvoice(inv.id, 'none');
  const a = await startPayment(inv.token);
  const b = await startPayment(inv.token);   // second tab
  const pa = payment(a.body.paymentId), pb = payment(b.body.paymentId);
  mock.settle(pa.authority, 'ok');
  mock.settle(pb.authority, 'ok');
  const ev = collect('payment.orphaned');
  const ra = await service.handleCallback({ gatewayId: 'mock', pid: pa.id, query: { authority: pa.authority, status: 'ok' } });
  assert.equal(ra.outcome, 'succeeded');
  // bypass the "in progress" guard to force the index to be the last line of defence
  const rb = await service.handleCallback({ gatewayId: 'mock', pid: pb.id, query: { authority: pb.authority, status: 'ok' } });
  await settle();
  assert.deepEqual([rb.outcome, payment(pb.id).status, payment(pb.id).error_code, ev.seen.length], ['orphaned', 'orphaned', 'duplicate_success', 1]);
  assert.equal(payment(pa.id).status, 'succeeded');
  assert.equal(invoiceRow(inv.id).paid_ref, payment(pa.id).ref_id);
  // the index itself
  assert.throws(() => db.prepare("INSERT INTO payments (invoice_id, gateway, status, amount_toman) VALUES (?, 'manual', 'succeeded', 1)").run(inv.id), /UNIQUE/);
  ev.off();
});

test('reconcile: stale pending → inquire → verify; abandoned attempts expire after 45 min; admin endpoints', async () => {
  const inv = await makeInvoice();
  await sendInvoice(inv.id, 'none');
  const st = await startPayment(inv.token);
  const p = payment(st.body.paymentId);
  mock.settle(p.authority, 'ok');   // paid at the bank, callback never arrived
  db.prepare("UPDATE payments SET updated_at = datetime('now', '-5 minutes') WHERE id=?").run(p.id);
  const abandoned = await makeInvoice();
  await sendInvoice(abandoned.id, 'none');
  const st2 = await startPayment(abandoned.token);
  db.prepare("UPDATE payments SET created_at = datetime('now', '-50 minutes'), updated_at = datetime('now', '-50 minutes') WHERE id=?").run(st2.body.paymentId);
  const out = await reconcile.reconcileOnce({ log: () => {} });
  assert.deepEqual([out.expired, out.verified], [1, 1]);
  assert.deepEqual([payment(p.id).status, invoiceRow(inv.id).status, payment(st2.body.paymentId).status], ['succeeded', 'paid', 'expired']);
  // admin: list, reverify (already succeeded → replayed), reconcile endpoint
  let r = await t.fetchAdmin('/invoices/payments');
  assert.equal(r.status, 200);
  const list = await r.json();
  assert.ok(list.length >= 2 && list[0].invoice_number && !('raw_verify' in list[0]));
  r = await t.fetchAdmin(`/invoices/payments/${p.id}/reverify`, { method: 'POST', body: {} });
  assert.deepEqual([r.status, (await r.json()).outcome], [200, 'replayed']);
  r = await t.fetchAdmin('/invoices/payments/reconcile', { method: 'POST', body: {} });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).ok, true);
  // reverify a failed attempt whose bank decision flipped to ok (force claim)
  const inv3 = await makeInvoice();
  await sendInvoice(inv3.id, 'none');
  const st3 = await startPayment(inv3.token);
  const p3 = payment(st3.body.paymentId);
  await bankPress(p3.authority, 'failed').then(x => fetch(`${t.base}${x.headers.get('location')}`, { redirect: 'manual' }));
  assert.equal(payment(p3.id).status, 'failed');
  mock.settle(p3.authority, 'ok');
  r = await t.fetchAdmin(`/invoices/payments/${p3.id}/reverify`, { method: 'POST', body: {} });
  assert.deepEqual([r.status, (await r.json()).outcome, invoiceRow(inv3.id).status], [200, 'succeeded', 'paid']);
});

test('headers: every pay route is no-store + noindex; the rest of the site is not; unknown tokens fall through to 404', async () => {
  const inv = await makeInvoice();
  await sendInvoice(inv.id, 'none');
  for (const path of [`/p/${inv.short_code}`, `/fa/pay/${inv.token}`, `/en/pay/${inv.token}/result`, `/fa/pay/${inv.token}/receipt`]) {
    const r = await fetch(`${t.base}${path}`, { redirect: 'manual' });
    assert.equal(r.headers.get('cache-control'), 'no-store', path);
    assert.equal(r.headers.get('x-robots-tag'), 'noindex, nofollow', path);
  }
  const page = await (await fetch(`${t.base}/fa/pay/${inv.token}`)).text();
  assert.ok(page.includes('<meta name="robots" content="noindex">'));
  const home = await fetch(`${t.base}/api/content`);
  assert.notEqual(home.headers.get('x-robots-tag'), 'noindex, nofollow');
  assert.equal((await fetch(`${t.base}/fa/pay/${'a'.repeat(32)}`)).status, 404);
  assert.equal((await fetch(`${t.base}/fa/pay/short`)).status, 404);
  assert.equal((await fetch(`${t.base}/p/NOPE`)).status, 404);
  assert.equal((await startPayment(inv.token, 'zarinpal')).status, 409);   // known but not enabled
  assert.equal((await startPayment(inv.token, 'nope')).status, 422);
  // draft invoices are not payable and their page says so
  const d = await makeInvoice();
  assert.ok((await (await fetch(`${t.base}/fa/pay/${d.token}`)).text()).includes('هنوز صادر نشده'));
  assert.equal((await startPayment(d.token)).status, 409);
});

test('QR: deterministic SVG of the short link; admin routes are gated', async () => {
  const inv = await makeInvoice();
  const a = await t.fetchAdmin(`/invoices/${inv.id}/qr.svg`);
  const b = await t.fetchAdmin(`/invoices/${inv.id}/qr.svg`);
  assert.equal(a.status, 200);
  assert.match(a.headers.get('content-type'), /image\/svg\+xml/);
  const sa = await a.text();
  assert.equal(sa, await b.text());
  assert.ok(sa.startsWith('<svg') && sa.includes(inv.short_url));
  const anon = await fetch(`${t.base}/api/admin/invoices/${inv.id}/qr.svg`);
  assert.equal(anon.status, 401);
  // duplicate → new draft with the same items and a fresh number/token
  const dup = await t.fetchAdmin(`/invoices/${inv.id}/duplicate`, { method: 'POST', body: {} });
  assert.equal(dup.status, 201);
  const dj = await dup.json();
  assert.ok(dj.id !== inv.id && dj.token !== inv.token && dj.number !== inv.number && dj.amount_toman === inv.amount_toman && dj.status === 'draft');
  // reminder only for sent invoices, dedupe-keyed per day
  assert.equal((await t.fetchAdmin(`/invoices/${inv.id}/remind`, { method: 'POST', body: {} })).status, 409);
  await sendInvoice(inv.id);
  const rem = await t.fetchAdmin(`/invoices/${inv.id}/remind`, { method: 'POST', body: { channel: 'sms' } });
  assert.equal(rem.status, 200);
  assert.equal((await rem.json()).reminder_count, 1);
  assert.deepEqual(smsRows(inv.id).map(s => s.template_key), ['invoice_link', 'invoice_reminder']);
});

test('gateways admin: masked secrets, default must be enabled, test connection runs server-side, relay + pay config', async () => {
  let r = await t.fetchAdmin('/gateways');
  assert.equal(r.status, 200);
  let g = await r.json();
  assert.deepEqual(g.gateways.map(x => x.id), ['zarinpal', 'payping', 'zibal', 'sep', 'mock']);
  assert.ok(g.gateways[0].callback_url.endsWith('/api/pay/callback/zarinpal'));
  assert.equal(g.gateways[0].secret.configured, false);
  r = await t.fetchAdmin('/gateways', { method: 'PUT', body: { gateways: { zarinpal: { enabled: true, sandbox: true, secret: '12345678-1234-1234-1234-123456789abc' } }, pay: { due_days: 7, tax_percent: 9, offline_fa: 'شبا …', show_enamad: false }, relay_base: 'https://relay.example.ir/', relay_key: 'k'.repeat(20) } });
  await expectStatus(r, 200);
  g = await r.json();
  const z = g.gateways.find(x => x.id === 'zarinpal');
  assert.deepEqual([z.enabled, z.sandbox, z.secret.configured, z.secret.source, g.relay_base, g.relay_key.configured, g.pay.due_days, g.pay.tax_percent, g.pay.show_enamad], [true, true, true, 'db', 'https://relay.example.ir', true, 7, 9, false]);
  assert.ok(!JSON.stringify(g).includes('123456789abc'), 'secret value never returned');
  // masked value keeps the stored secret; default must be enabled; unknown gateway 422
  r = await t.fetchAdmin('/gateways', { method: 'PUT', body: { gateways: { zarinpal: { secret: '••••9abc' } }, default: 'zibal' } });
  assert.equal(r.status, 422);
  r = await t.fetchAdmin('/gateways', { method: 'PUT', body: { gateways: { nope: { enabled: true } } } });
  assert.equal(r.status, 422);
  // the pay page now offers both gateways, default first, and the CSP form-action lists the bank origins
  const inv = await makeInvoice();
  await sendInvoice(inv.id, 'none');
  const pr = await fetch(`${t.base}/fa/pay/${inv.token}`);
  const page = await pr.text();
  assert.ok(page.indexOf('value="mock"') < page.indexOf('value="zarinpal"'));
  assert.ok(pr.headers.get('content-security-policy').includes('https://sandbox.zarinpal.com'));
  // test connection: zarinpal through a fake fetch (service.transport), mock always ok
  service.transport.fetch = async () => ({ ok: true, status: 200, data: { data: { code: 100, authorities: [] }, errors: [] }, text: '' });
  r = await t.fetchAdmin('/gateways/zarinpal/test', { method: 'POST', body: {} });
  assert.deepEqual([r.status, (await r.json()).ok], [200, true]);
  service.transport.fetch = null;
  r = await t.fetchAdmin('/gateways/mock/test', { method: 'POST', body: {} });
  assert.equal((await r.json()).ok, true);
  // new invoices inherit the default tax percent
  const inv2 = await makeInvoice();
  assert.equal(inv2.tax_percent, 9);
  await t.fetchAdmin('/gateways', { method: 'PUT', body: { gateways: { zarinpal: { enabled: false } }, pay: { tax_percent: 0 } } });
});
