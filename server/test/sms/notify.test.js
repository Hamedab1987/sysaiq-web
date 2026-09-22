// sms/notify.js: lead.created (through the real POST /api/leads) and the
// invoice / payment events against the payload fixtures the payments
// workstream will emit. Everything goes through the mock provider.
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp } from '../helpers.js';

let t, db, events, notify, cfg;
before(async () => {
  t = await startTestApp();
  ({ db } = await import('../../src/db/index.js'));
  events = await import('../../src/lib/events.js');
  notify = await import('../../src/sms/notify.js');
  cfg = await import('../../src/sms/config.js');
  await t.loginAsAdmin();
});
after(async () => { await t.close(); });

const rows = () => db.prepare('SELECT * FROM sms_log ORDER BY id').all();
const settle = () => new Promise(r => setTimeout(r, 40));
const postLead = body => t.json('/api/leads', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

beforeEach(async () => {
  db.prepare('DELETE FROM sms_log').run();
  const r = await t.fetchAdmin('/sms/config', { method: 'PUT', body: { active: 'mock', fallback: '', owner_mobile: '09125130505', events: Object.fromEntries(cfg.EVENT_KEYS.map(k => [k, true])), daily_cap: 200, per_number_daily_cap: 5 } });
  assert.equal(r.status, 200);
});

test('listeners are installed once, for every event, by importing the module', () => {
  for (const evt of ['lead.created', 'invoice.sent', 'payment.succeeded', 'payment.failed', 'payment.orphaned']) {
    assert.equal(events.listenerCount(evt), 1, evt);
  }
  assert.equal(notify.installSmsNotifications(), false, 'second install is a no-op');
  assert.equal(events.listenerCount('lead.created'), 1);
});

test('POST /api/leads with an Iranian mobile → owner alert + customer confirmation rows', async () => {
  const { status, body } = await postLead({ name: 'سارا احمدی', phone: '۰۹۱۲ ۳۴۵ ۶۷۸۹', language: 'fa', service_slug: 'web-app', message: 'سلام' });
  assert.equal(status, 200);
  await settle();
  const r = rows();
  assert.equal(r.length, 2);
  const owner = r.find(x => x.template_key === 'lead_owner');
  const cust = r.find(x => x.template_key === 'lead_customer');
  assert.deepEqual({ to: owner.to_number, status: owner.status, kind: owner.kind, lead_id: owner.lead_id, dk: owner.dedupe_key, lang: owner.lang },
    { to: '09125130505', status: 'sent', kind: 'auto', lead_id: body.id, dk: `lead.created:owner:${body.id}`, lang: 'fa' });
  assert.equal(owner.text, `SysaiQ: سرنخ جدید #${body.id} — سارا احمدی — 09123456789 — web-app`);
  assert.deepEqual({ to: cust.to_number, status: cust.status, lead_id: cust.lead_id, dk: cust.dedupe_key }, { to: '09123456789', status: 'sent', lead_id: body.id, dk: `lead.created:customer:${body.id}` });
  assert.equal(cust.text, 'سارا احمدی عزیز، درخواست شما در SysaiQ ثبت شد. در اولین فرصت با شما تماس می‌گیریم.');
  // the log row never carries the visitor's email or message
  assert.ok(!JSON.stringify(r).includes('سلام'));
});

test('an English lead gets the English confirmation; the owner alert stays Persian; email-only leads alert the owner only', async () => {
  const a = await postLead({ name: 'John', phone: '+98 912 111 2233', language: 'en', project_type: 'AI agent' });
  await settle();
  let r = rows();
  assert.equal(r.find(x => x.template_key === 'lead_customer').text, 'Dear John, SysaiQ has received your request. We will be in touch soon.');
  assert.equal(r.find(x => x.template_key === 'lead_customer').lang, 'en');
  assert.equal(r.find(x => x.template_key === 'lead_owner').text, `SysaiQ: سرنخ جدید #${a.body.id} — John — +989121112233 — AI agent`);

  db.prepare('DELETE FROM sms_log').run();
  const b = await postLead({ name: 'Mail Only', email: 'someone@example.com' });
  await settle();
  r = rows();
  assert.equal(r.length, 1);
  assert.equal(r[0].template_key, 'lead_owner');
  assert.ok(r[0].text.includes('someone@example.com'), 'owner sees the email when there is no phone');
  assert.equal(r[0].lead_id, b.body.id);

  // a foreign number: owner only (no Iranian mobile to confirm to)
  db.prepare('DELETE FROM sms_log').run();
  await postLead({ name: 'Abroad', phone: '+15551234567' });
  await settle();
  assert.deepEqual(rows().map(x => x.template_key), ['lead_owner']);
});

test('the customer switch off keeps the owner alert; SMS off writes nothing; re-emitting the same lead is deduped', async () => {
  await t.fetchAdmin('/sms/config', { method: 'PUT', body: { events: { lead_customer: false } } });
  const { body } = await postLead({ name: 'x', phone: '09121234567' });
  await settle();
  assert.deepEqual(rows().map(x => x.template_key), ['lead_owner']);

  await t.fetchAdmin('/sms/config', { method: 'PUT', body: { events: { lead_customer: true } } });
  events.emit('lead.created', { id: body.id, lead: { id: body.id, name: 'x', phone: '09121234567', phone_norm: '09121234567', language: 'fa' } });
  await settle();
  const r = rows();
  assert.deepEqual(r.map(x => [x.template_key, x.status, x.error_code]), [['lead_owner', 'sent', ''], ['lead_owner', 'skipped', 'dedupe'], ['lead_customer', 'sent', '']]);

  db.prepare('DELETE FROM sms_log').run();
  await t.fetchAdmin('/sms/config', { method: 'PUT', body: { active: '' } });
  await postLead({ name: 'quiet', phone: '09121234567' });
  await settle();
  assert.equal(rows().length, 0);
});

const invoice = { id: 31, number: 'SQ-1405-0007', short_code: 'a1b2c3d4e5f6', amount_toman: 12500000, customer_name: 'شرکت نمونه', customer_phone: '0912 555 6677', language: 'fa' };

test('invoice.sent → pay link (Persian digits, fixed sysaiq.com/p/ prefix); reminder variant; dedupe per invoice / per reminder day', async () => {
  events.emit('invoice.sent', { invoice });
  await settle();
  let r = rows();
  assert.equal(r.length, 1);
  assert.deepEqual({ key: r[0].template_key, to: r[0].to_number, invoice_id: r[0].invoice_id, dk: r[0].dedupe_key, status: r[0].status }, { key: 'invoice_link', to: '09125556677', invoice_id: 31, dk: 'invoice.sent:customer:31', status: 'sent' });
  assert.equal(r[0].text, 'شرکت نمونه عزیز، فاکتور SQ-1405-0007 SysaiQ به مبلغ ۱۲٬۵۰۰٬۰۰۰ تومان صادر شد. پرداخت: sysaiq.com/p/a1b2c3d4e5f6');
  assert.equal(JSON.parse(r[0].vars).code.length, 12);

  events.emit('invoice.sent', { invoice });
  events.emit('invoice.sent', { invoice, reminder: true });
  events.emit('invoice.sent', { invoice, reminder: true });
  await settle();
  r = rows();
  assert.deepEqual(r.slice(1).map(x => [x.template_key, x.status, x.error_code]), [['invoice_link', 'skipped', 'dedupe'], ['invoice_reminder', 'sent', ''], ['invoice_reminder', 'skipped', 'dedupe']]);
  assert.ok(r[2].text.startsWith('شرکت نمونه عزیز، یادآوری: فاکتور SQ-1405-0007'));
  assert.match(r[2].dedupe_key, /^invoice\.reminder:31:\d{4}-\d{2}-\d{2}$/);

  // English invoice: Latin digits
  db.prepare('DELETE FROM sms_log').run();
  events.emit('invoice.sent', { invoice: { ...invoice, id: 32, language: 'en', customer_name: 'Acme' } });
  await settle();
  assert.equal(rows()[0].text, 'Dear Acme, SysaiQ invoice SQ-1405-0007 for 12,500,000 Toman is ready. Pay: sysaiq.com/p/a1b2c3d4e5f6');
  // no phone → nothing
  events.emit('invoice.sent', { invoice: { ...invoice, id: 33, customer_phone: '' } });
  await settle();
  assert.equal(rows().length, 1);
});

test('payment.succeeded → receipt to the customer + alert to the owner; failed/orphaned → owner only', async () => {
  const payment = { id: 501, invoice_id: 31, amount_toman: 12500000, ref_id: '987654321' };
  events.emit('payment.succeeded', { payment, invoice });
  await settle();
  let r = rows();
  assert.deepEqual(r.map(x => [x.template_key, x.to_number, x.payment_id, x.invoice_id, x.dedupe_key]), [
    ['payment_customer', '09125556677', 501, 31, 'payment.succeeded:customer:501'],
    ['payment_owner', '09125130505', 501, 31, 'payment.succeeded:owner:501'],
  ]);
  assert.equal(r[0].text, 'شرکت نمونه عزیز، پرداخت ۱۲٬۵۰۰٬۰۰۰ تومان بابت فاکتور SQ-1405-0007 SysaiQ ثبت شد. کد پیگیری: 987654321. سپاسگزاریم.');
  assert.equal(r[1].text, 'SysaiQ: پرداخت ۱۲٬۵۰۰٬۰۰۰ تومان بابت فاکتور SQ-1405-0007 (شرکت نمونه) — وضعیت: موفق');

  db.prepare('DELETE FROM sms_log').run();
  events.emit('payment.failed', { payment: { ...payment, id: 502 }, invoice });
  events.emit('payment.orphaned', { payment: { ...payment, id: 503 }, invoice });
  await settle();
  r = rows();
  assert.deepEqual(r.map(x => [x.template_key, x.to_number, x.payment_id]), [['payment_owner', '09125130505', 502], ['payment_owner', '09125130505', 503]]);
  assert.ok(r[0].text.endsWith('وضعیت: ناموفق'));
  assert.ok(r[1].text.endsWith('وضعیت: نیازمند بررسی (پرداخت تکراری)'));
  // a malformed payload is ignored, never thrown
  events.emit('payment.succeeded', null);
  events.emit('payment.succeeded', { payment: {} });
  await settle();
  assert.equal(rows().length, 2);
  assert.equal(notify.formatAmount('abc'), '');
  assert.equal(notify.formatAmount(1234.6, 'en'), '1,235');
});
