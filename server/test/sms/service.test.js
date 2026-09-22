// sms/service.js with the mock provider and a scripted "fake" provider:
// pattern-vs-simple dispatch, fallback on retriable errors only, dedupe,
// caps, mobile normalisation, credit cache, status refresh, retry, listing.
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp } from '../helpers.js';

let t, db, sms, cfg, reg, mock;
const fake = {
  id: 'fake', label_fa: 'ساختگی', label_en: 'Fake', hosts: [], recipientFormat: 'local', supportsPattern: false, supportsStatus: false,
  secretName: null, configFields: [], calls: [], fail: null,
  async send(_ctx, args) { fake.calls.push({ mode: 'send', ...args }); if (fake.fail) throw fake.fail; return { ok: true, messageId: `fake-${fake.calls.length}`, cost: 12 }; },
  async credit() { return { amount: 5, unit: 'x' }; },
};

before(async () => {
  t = await startTestApp();
  ({ db } = await import('../../src/db/index.js'));
  sms = await import('../../src/sms/service.js');
  cfg = await import('../../src/sms/config.js');
  reg = await import('../../src/sms/registry.js');
  mock = (await import('../../src/sms/providers/mock.js')).default;
  reg.registerProvider(fake);
});
after(async () => { await t.close(); });

const setCfg = patch => cfg.writeConfig(cfg.validateConfigPatch(patch));
const rows = () => db.prepare('SELECT * FROM sms_log ORDER BY id').all();
const clear = () => { db.prepare('DELETE FROM sms_log').run(); fake.calls.length = 0; fake.fail = null; mock._reset(); };
const { SmsError } = await import('../../src/sms/errors.js');

beforeEach(() => {
  clear();
  setCfg({ active: 'mock', fallback: '', daily_cap: 200, per_number_daily_cap: 5, events: Object.fromEntries(cfg.EVENT_KEYS.map(k => [k, true])) });
  db.prepare("UPDATE sms_templates SET provider_map='{}', enabled=1").run();
});

test('SMS off (no active provider) → silent skip, no row; a bad number and an off switch are silent too', async () => {
  setCfg({ active: '' });
  const r = await sms.sendTemplate({ key: 'lead_customer', to: '09121234567', vars: { name: 'x' } });
  assert.deepEqual({ ok: r.ok, skipped: r.skipped, logId: r.logId }, { ok: false, skipped: 'not_configured', logId: null });
  setCfg({ active: 'mock' });
  assert.equal((await sms.sendTemplate({ key: 'lead_customer', to: '02833323002', vars: { name: 'x' } })).skipped, 'bad_number');
  assert.equal((await sms.sendTemplate({ key: 'lead_customer', to: '', vars: { name: 'x' } })).skipped, 'bad_number');
  setCfg({ events: { lead_customer: false } });
  assert.equal((await sms.sendTemplate({ key: 'lead_customer', to: '09121234567', vars: { name: 'x' } })).skipped, 'event_off');
  assert.equal((await sms.sendTemplate({ key: 'nope', to: '09121234567' })).skipped, 'template_missing');
  assert.equal(rows().length, 0);
});

test('mobile normalisation: every accepted input form is stored as 09xxxxxxxxx', async () => {
  const forms = ['09121234567', '9121234567', '+989121234567', '989121234567', '00989121234567', '۰۹۱۲ ۱۲۳ ۴۵۶۷', '+98 (912) 123-4567', '٠٠٩٨٩١٢١٢٣٤٥٦٧'];
  for (const f of forms) {
    const r = await sms.sendTemplate({ key: 'lead_customer', to: f, vars: { name: 'x' }, kind: 'manual' });
    assert.equal(r.ok, true, f);
  }
  assert.ok(rows().every(r => r.to_number === '09121234567'));
});

test('dispatch: a provider_map entry for the active provider ⇒ pattern, otherwise simple; unsupported ⇒ simple', async () => {
  const a = await sms.sendTemplate({ key: 'lead_customer', to: '09121234567', vars: { name: 'سارا' }, lang: 'fa', refs: { lead_id: 7 } });
  assert.equal(a.mode, 'simple');
  const row = rows()[0];
  assert.deepEqual({ kind: row.kind, template_key: row.template_key, provider: row.provider, status: row.status, lang: row.lang, lead_id: row.lead_id, segments: row.segments, message_id: row.message_id, attempt: row.attempt },
    { kind: 'auto', template_key: 'lead_customer', provider: 'mock', status: 'sent', lang: 'fa', lead_id: 7, segments: 2, message_id: 'mock-1-4567', attempt: 1 });
  assert.equal(row.text, 'سارا عزیز، درخواست شما در SysaiQ ثبت شد. در اولین فرصت با شما تماس می‌گیریم.');
  assert.deepEqual(JSON.parse(row.vars), { name: 'سارا' });
  assert.ok(row.sent_at);

  db.prepare("UPDATE sms_templates SET provider_map=? WHERE key='lead_customer'").run(JSON.stringify({ mock: { template: 'sq-lead' } }));
  const b = await sms.sendTemplate({ key: 'lead_customer', to: '09121234568', vars: { name: 'x' } });
  assert.equal(b.mode, 'pattern');
  assert.equal(rows()[1].mode, 'pattern');
  assert.equal(rows()[1].text.length > 0, true, 'the rendered text is kept for the log even in pattern mode');

  // a fake provider that can't do patterns falls back to simple text
  setCfg({ active: 'fake' });
  db.prepare("UPDATE sms_templates SET provider_map=? WHERE key='lead_customer'").run(JSON.stringify({ fake: { template: 'x' }, mock: { template: 'y' } }));
  const c = await sms.sendTemplate({ key: 'lead_customer', to: '09121234569', vars: { name: 'x' } });
  assert.equal(c.mode, 'simple');
  assert.equal(fake.calls.at(-1).text.startsWith('x عزیز'), true);
  assert.equal(rows()[2].cost, 12);
});

test('fallback: one more attempt on a retriable error, none on a permanent one; each attempt is a row', async () => {
  setCfg({ active: 'fake', fallback: 'mock' });
  fake.fail = new SmsError('no_credit', { provider: 'fake', message: 'balance 0' });
  const r = await sms.sendTemplate({ key: 'lead_customer', to: '09121234567', vars: { name: 'x' }, dedupeKey: 'k1' });
  assert.equal(r.ok, true);
  assert.equal(r.provider, 'mock');
  const [a, b] = rows();
  assert.deepEqual({ p: a.provider, s: a.status, e: a.error_code, att: a.attempt, retry_of: a.retry_of }, { p: 'fake', s: 'failed', e: 'no_credit', att: 1, retry_of: null });
  assert.ok(a.error_message.includes('اعتبار') && a.error_message.includes('balance 0'));
  assert.deepEqual({ p: b.provider, s: b.status, att: b.attempt, retry_of: b.retry_of, dk: b.dedupe_key }, { p: 'mock', s: 'sent', att: 2, retry_of: a.id, dk: 'k1' });

  clear();
  fake.fail = new SmsError('bad_mobile', { provider: 'fake' });
  const p = await sms.sendTemplate({ key: 'lead_customer', to: '09121234567', vars: { name: 'x' } });
  assert.equal(p.ok, false);
  assert.equal(p.error.code, 'bad_mobile');
  assert.equal(rows().length, 1, 'no fallback for a permanent error');

  // an unexpected exception counts as retriable 'unknown'
  clear();
  fake.fail = new TypeError('boom');
  const u = await sms.sendTemplate({ key: 'lead_customer', to: '09121234567', vars: { name: 'x' } });
  assert.equal(u.ok, true);
  assert.equal(rows()[0].error_code, 'unknown');

  // the mock's simulated outage (…0000) also hands over to the fallback
  clear();
  setCfg({ active: 'mock', fallback: 'fake' });
  const m = await sms.sendTemplate({ key: 'lead_customer', to: '09120000000', vars: { name: 'x' } });
  assert.equal(m.provider, 'fake');
  assert.deepEqual(rows().map(x => [x.provider, x.status]), [['mock', 'failed'], ['fake', 'sent']]);

  // both fail → the last error is reported, both rows failed
  clear();
  fake.fail = new SmsError('timeout', { provider: 'fake' });
  const both = await sms.sendTemplate({ key: 'lead_customer', to: '09120000000', vars: { name: 'x' } });
  assert.equal(both.ok, false);
  assert.equal(both.error.code, 'timeout');
  assert.deepEqual(rows().map(x => x.status), ['failed', 'failed']);
});

test('dedupe: the same dedupe_key is sent once; a failed first attempt does not block', async () => {
  const a = await sms.sendTemplate({ key: 'payment_owner', to: '09125130505', vars: { amount: '1', number: '2', name: 'n', status: 's' }, dedupeKey: 'payment.succeeded:owner:9' });
  assert.equal(a.ok, true);
  const b = await sms.sendTemplate({ key: 'payment_owner', to: '09125130505', vars: { amount: '1', number: '2', name: 'n', status: 's' }, dedupeKey: 'payment.succeeded:owner:9' });
  assert.deepEqual({ ok: b.ok, skipped: b.skipped, status: b.status }, { ok: false, skipped: 'dedupe', status: 'skipped' });
  assert.equal(rows()[1].status, 'skipped');
  assert.equal(rows()[1].error_code, 'dedupe');
  assert.equal(rows()[1].error_label, undefined); // raw row; the decorated one carries the label
  assert.equal(sms.logRow(rows()[1].id).error_label, 'قبلاً برای همین رویداد ارسال شده است');

  clear();
  setCfg({ active: 'fake' });
  fake.fail = new SmsError('auth');
  await sms.sendTemplate({ key: 'payment_owner', to: '09125130505', vars: { amount: '1', number: '2', name: 'n', status: 's' }, dedupeKey: 'x' });
  fake.fail = null;
  const c = await sms.sendTemplate({ key: 'payment_owner', to: '09125130505', vars: { amount: '1', number: '2', name: 'n', status: 's' }, dedupeKey: 'x' });
  assert.equal(c.ok, true);
});

test('caps: lead_customer once per number per 24 h, per-number 5/day automated, global daily; manual honours the global cap, test sends do not', async () => {
  const to = '09121234567';
  assert.equal((await sms.sendTemplate({ key: 'lead_customer', to, vars: { name: 'a' } })).ok, true);
  const again = await sms.sendTemplate({ key: 'lead_customer', to, vars: { name: 'b' } });
  assert.equal(again.skipped, 'cap_template');
  // a different template to the same number is fine until the per-number cap (5) is reached
  const vars = { amount: '1', number: '2', name: 'n', status: 's' };
  for (let i = 0; i < 4; i++) assert.equal((await sms.sendTemplate({ key: 'payment_owner', to, vars })).ok, true, `send ${i}`);
  assert.equal((await sms.sendTemplate({ key: 'payment_owner', to, vars })).skipped, 'cap_number');
  // manual sends are not bound by the per-number cap
  assert.equal((await sms.sendManual({ to, text: 'دستی' })).ok, true);

  setCfg({ daily_cap: 7 });
  // 5 auto + 1 manual = 6 counted attempts so far (skipped rows don't count)
  assert.equal(sms.usage().sent_24h, 6);
  assert.equal((await sms.sendTemplate({ key: 'payment_owner', to: '09120000001', vars })).ok, true);
  assert.equal((await sms.sendTemplate({ key: 'payment_owner', to: '09120000002', vars })).skipped, 'cap_daily');
  const manual = await sms.sendManual({ to: '09120000003', text: 'x' });
  assert.equal(manual.skipped, 'cap_daily');
  assert.equal(manual.log.status, 'skipped');
  const tst = await sms.sendTest({ to: '09120000004', mode: 'simple' });
  assert.equal(tst.ok, true);
  assert.equal(tst.log.kind, 'test');
  // the owner's number is exempt from the per-number caps but not from the global one
  const ownerAtCap = await sms.sendTemplate({ key: 'payment_owner', to: cfg.readConfig().owner_mobile, vars });
  assert.equal(ownerAtCap.skipped, 'cap_daily');
});

test('the owner mobile is exempt from the per-number and lead_customer caps: 8 leads in a day → 8 owner alerts sent, the visitor numbers still stop at 5', async () => {
  const owner = cfg.readConfig().owner_mobile;
  assert.equal(owner, '09125130505');
  const notify = await import('../../src/sms/notify.js');
  const visitor = '09123456789';
  for (let id = 1; id <= 8; id++) {
    await notify.handlers['lead.created']({ id, lead: { id, name: `Lead ${id}`, phone: visitor, phone_norm: visitor, language: 'fa', project_type: 'web-app' } });
  }
  const owners = rows().filter(r => r.template_key === 'lead_owner');
  assert.equal(owners.length, 8);
  assert.deepEqual(owners.map(r => [r.to_number, r.status]), Array(8).fill([owner, 'sent']));
  // the visitor got one confirmation and is then held by the lead_customer 24 h rule
  const customers = rows().filter(r => r.template_key === 'lead_customer');
  assert.deepEqual(customers.map(r => r.status), ['sent', ...Array(7).fill('skipped')]);
  assert.ok(customers.slice(1).every(r => r.error_code === 'cap_template'));
  // a visitor number still hits the per-number cap (5) with other automated templates
  const vars = { amount: '1', number: '2', name: 'n', ref: 'r' };
  for (let i = 0; i < 4; i++) assert.equal((await sms.sendTemplate({ key: 'payment_customer', to: visitor, vars })).ok, true, `visitor send ${i}`);
  assert.equal((await sms.sendTemplate({ key: 'payment_customer', to: visitor, vars })).skipped, 'cap_number');
  // …whereas the owner keeps receiving payment alerts (far past 5 in the same day)
  const ownerVars = { amount: '1', number: '2', name: 'n', status: 's' };
  for (let i = 0; i < 6; i++) assert.equal((await sms.sendTemplate({ key: 'payment_owner', to: owner, vars: ownerVars, dedupeKey: `p:${i}` })).ok, true, `owner send ${i}`);
  assert.equal(rows().filter(r => r.to_number === owner && r.status === 'sent').length, 14);
  // a change of owner number moves the exemption with it
  cfg.writeConfig(cfg.validateConfigPatch({ owner_mobile: '09120000005' }));
  assert.equal((await sms.sendTemplate({ key: 'payment_owner', to: owner, vars: ownerVars })).skipped, 'cap_number', 'the old number is an ordinary number again');
  for (let i = 0; i < 6; i++) assert.equal((await sms.sendTemplate({ key: 'payment_owner', to: '09120000005', vars: ownerVars })).ok, true);
});

test('caps count one delivered job, not every attempt: failed attempts (fallback chain, provider outage) do not consume the daily or per-number cap', async () => {
  const vars = { amount: '1', number: '2', name: 'n', ref: 'r' };
  // fake fails retriably, mock delivers: two rows, one counted
  setCfg({ active: 'fake', fallback: 'mock', daily_cap: 200, per_number_daily_cap: 5 });
  fake.fail = new SmsError('server_error', { provider: 'fake' });
  for (let i = 0; i < 5; i++) assert.equal((await sms.sendTemplate({ key: 'payment_customer', to: '09121234567', vars })).ok, true);
  assert.equal(rows().length, 10, 'a failed + a sent row per job');
  assert.equal(sms.usage().sent_24h, 5);
  assert.equal((await sms.sendTemplate({ key: 'payment_customer', to: '09121234567', vars })).skipped, 'cap_number', 'five deliveries → capped');

  // a full outage (both providers down) burns nothing
  clear();
  setCfg({ active: 'fake', fallback: '' , daily_cap: 3 });
  fake.fail = new SmsError('timeout', { provider: 'fake' });
  for (let i = 0; i < 6; i++) assert.equal((await sms.sendTemplate({ key: 'payment_customer', to: '09121234567', vars })).ok, false);
  assert.equal(rows().filter(r => r.status === 'failed').length, 6);
  assert.equal(sms.usage().sent_24h, 0);
  fake.fail = null;
  assert.equal((await sms.sendTemplate({ key: 'payment_customer', to: '09121234567', vars })).ok, true, 'the number is not capped by its failed attempts');
  assert.equal((await sms.sendManual({ to: '09120000001', text: 'x' })).ok, true, 'the daily cap (3) was not eaten by the outage');
  assert.equal(sms.usage().sent_24h, 2);
});

test('a missing template variable produces a visible failed row, not a crash', async () => {
  const r = await sms.sendTemplate({ key: 'invoice_link', to: '09121234567', vars: { name: 'x' }, refs: { invoice_id: 3 } });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'missing_var');
  const row = rows()[0];
  assert.deepEqual({ status: row.status, code: row.error_code, invoice_id: row.invoice_id, text: row.text }, { status: 'failed', code: 'missing_var', invoice_id: 3, text: '' });
});

test('sendManual: free text is simple mode, braces stripped, empty refused; sendTest pattern needs a mapping', async () => {
  const r = await sms.sendManual({ to: '09121234567', text: '  سلام {{name}} ', adminUser: 'tester' });
  assert.equal(r.ok, true);
  assert.deepEqual({ kind: r.log.kind, text: r.log.text, admin: r.log.admin_user, mode: r.log.mode }, { kind: 'manual', text: 'سلام name', admin: 'tester', mode: 'simple' });
  await assert.rejects(sms.sendManual({ to: '09121234567', text: '   ' }), e => e.code === 'empty_text');
  await assert.rejects(sms.sendManual({ to: '12', text: 'x' }), e => e.code === 'bad_mobile');
  setCfg({ active: '' });
  await assert.rejects(sms.sendManual({ to: '09121234567', text: 'x' }), e => e.code === 'not_configured');
  await assert.rejects(sms.sendTest({ to: '09121234567' }), e => e.code === 'not_configured');
  setCfg({ active: 'mock' });
  await assert.rejects(sms.sendTest({ to: '09121234567', mode: 'pattern', templateKey: 'lead_customer' }), e => e.code === 'template');
  db.prepare("UPDATE sms_templates SET provider_map=? WHERE key='lead_customer'").run(JSON.stringify({ mock: { template: 'sq' } }));
  const p = await sms.sendTest({ to: '09121234567', mode: 'pattern', templateKey: 'lead_customer' });
  assert.equal(p.log.mode, 'pattern');
  assert.ok(p.log.text.includes('سارا احمدی'), 'rendered with sample values');
  // test send goes to the named provider only (no fallback), even when it is not the active one
  setCfg({ active: 'fake', fallback: 'mock' });
  fake.fail = new SmsError('timeout');
  const f = await sms.sendTest({ to: '09121234567', providerId: 'fake' });
  assert.equal(f.ok, false);
  assert.deepEqual(rows().filter(x => x.kind === 'test').map(x => [x.provider, x.status]), [['mock', 'sent'], ['fake', 'failed']], 'no fallback row for a test send');
  await assert.rejects(sms.sendTest({ to: '09121234567', providerId: 'nope' }), e => e.code === 'provider_unknown');
});

test('credit is cached for 60 s per provider; force bypasses', async () => {
  sms._clearCreditCache();
  const a = await sms.credit();
  assert.deepEqual({ provider: a.provider, amount: a.amount, unit: a.unit, cached: a.cached }, { provider: 'mock', amount: 1000, unit: 'mock', cached: false });
  assert.equal((await sms.credit()).cached, true);
  assert.equal((await sms.credit({ force: true })).cached, false);
  assert.equal((await sms.credit({ providerId: 'fake' })).amount, 5);
  setCfg({ active: '' });
  await assert.rejects(sms.credit(), e => e.code === 'not_configured');
});

test('refreshStatus normalises the provider state onto the row; rows without a message id are refused', async () => {
  const ok = await sms.sendTemplate({ key: 'lead_customer', to: '09121231111', vars: { name: 'x' } });
  const r = await sms.refreshStatus(ok.logId);
  assert.equal(r.state, 'undelivered');
  assert.equal(r.log.status, 'undelivered');
  assert.ok(r.log.status_checked_at);
  const ok2 = await sms.sendTemplate({ key: 'lead_customer', to: '09121232222', vars: { name: 'x' } });
  assert.equal((await sms.refreshStatus(ok2.logId)).state, 'delivered');
  assert.equal(await sms.refreshStatus(999999), null);
  setCfg({ active: 'fake' });
  const f = await sms.sendTemplate({ key: 'lead_customer', to: '09121233333', vars: { name: 'x' } });
  await assert.rejects(sms.refreshStatus(f.logId), e => e.code === 'unsupported');
  const skipped = await sms.sendTemplate({ key: 'lead_customer', to: '09121233333', vars: { name: 'x' } });
  await assert.rejects(sms.refreshStatus(skipped.logId), e => e.code === 'unsupported');
});

test('retry: a new manual row pointing back, same number, re-rendered from the template in the stored language', async () => {
  setCfg({ active: 'fake' });
  fake.fail = new SmsError('server_error');
  const failed = await sms.sendTemplate({ key: 'lead_customer', to: '09121234567', vars: { name: 'Sara' }, lang: 'en', refs: { lead_id: 4 } });
  assert.equal(failed.ok, false);
  fake.fail = null;
  const r = await sms.retry(failed.logId, 'tester');
  assert.equal(r.ok, true);
  assert.deepEqual({ kind: r.log.kind, retry_of: r.log.retry_of, to: r.log.to_number, lang: r.log.lang, lead_id: r.log.lead_id, admin: r.log.admin_user },
    { kind: 'manual', retry_of: failed.logId, to: '09121234567', lang: 'en', lead_id: 4, admin: 'tester' });
  assert.equal(r.log.text, 'Dear Sara, SysaiQ has received your request. We will be in touch soon.');
  // free-text retry keeps the text; unknown id → null; disabled template refused
  const m = await sms.sendManual({ to: '09121234567', text: 'free' });
  assert.equal((await sms.retry(m.logId)).log.text, 'free');
  assert.equal(await sms.retry(424242), null);
  db.prepare("UPDATE sms_templates SET enabled=0 WHERE key='lead_customer'").run();
  await assert.rejects(sms.retry(failed.logId), e => e.code === 'template_disabled');
});

test('listLog: filters and paging', async () => {
  for (let i = 0; i < 12; i++) await sms.sendManual({ to: `0912123456${i % 10}`, text: `msg ${i}` });
  await sms.sendTemplate({ key: 'lead_customer', to: '09129999999', vars: { name: 'x' } }); // mock rejects …9999 → failed
  const all = sms.listLog({ per_page: 5 });
  assert.deepEqual({ total: all.total, n: all.items.length, page: all.page }, { total: 13, n: 5, page: 1 });
  assert.equal(all.items[0].id > all.items[1].id, true, 'newest first');
  assert.equal(sms.listLog({ per_page: 5, page: 3 }).items.length, 3);
  assert.equal(sms.listLog({ status: 'failed' }).total, 1);
  assert.equal(sms.listLog({ status: 'failed' }).items[0].error_label, 'شمارهٔ گیرنده نامعتبر است');
  assert.equal(sms.listLog({ kind: 'manual' }).total, 12);
  assert.equal(sms.listLog({ template_key: 'lead_customer' }).total, 1);
  assert.equal(sms.listLog({ to: '۰۹۱۲۱۲۳۴۵۶۰' }).total, 2);
  assert.equal(sms.listLog({ to: '99999' }).total, 1);
  assert.equal(sms.listLog({ q: 'msg 1' }).total, 3); // msg 1, 10, 11
  assert.equal(sms.listLog({ from: '2000-01-01', until: '2099-12-31' }).total, 13);
  assert.equal(sms.listLog({ from: '2099-01-01' }).total, 0);
  assert.equal(sms.listLog({ status: 'nope', kind: 'weird' }).total, 13, 'unknown filter values are ignored');
});
