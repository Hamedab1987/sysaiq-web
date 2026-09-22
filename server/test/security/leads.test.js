// lib/leads.js + POST /api/leads: validation, forced fields, honeypot, digits.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp } from '../helpers.js';

let t, db, events;
before(async () => {
  t = await startTestApp();
  ({ db } = await import('../../src/db/index.js'));
  events = await import('../../src/lib/events.js');
});
after(async () => { await t.close(); });

const post = body => t.json('/api/leads', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const row = id => db.prepare('SELECT * FROM leads WHERE id=?').get(id);
const count = () => db.prepare('SELECT COUNT(*) c FROM leads').get().c;

test('validation: name required, email or phone required, caps, language, formats', async () => {
  const cases = [
    [{ email: 'a@b.co' }, 'name'],
    [{ name: 'x'.repeat(121), email: 'a@b.co' }, 'name'],
    [{ name: 'Ali' }, 'email'],
    [{ name: 'Ali' }, 'phone'],
    [{ name: 'Ali', email: 'not-an-email' }, 'email'],
    [{ name: 'Ali', email: `${'a'.repeat(250)}@b.co` }, 'email'],
    [{ name: 'Ali', phone: '12345' }, 'phone'],
    [{ name: 'Ali', phone: '+1 (555) abc-1234' }, 'phone'],
    [{ name: 'Ali', phone: '1234567890123456' }, 'phone'],
    [{ name: 'Ali', email: 'a@b.co', company: 'c'.repeat(161) }, 'company'],
    [{ name: 'Ali', email: 'a@b.co', project_type: 'p'.repeat(81) }, 'project_type'],
    [{ name: 'Ali', email: 'a@b.co', message: 'm'.repeat(5001) }, 'message'],
    [{ name: 'Ali', email: 'a@b.co', language: 'de' }, 'language'],
    [{ name: 'Ali', email: 'a@b.co', page: 'p'.repeat(201) }, 'page'],
    [{ name: 'Ali', email: 'a@b.co', contact_pref: 'fax' }, 'contact_pref'],
    [{ name: 'Ali', email: 'a@b.co', service_slug: 'Not A Slug!' }, 'service_slug'],
    [{ name: ['Ali'], email: 'a@b.co' }, 'name'],
    // arrays/objects are refused, never String()-coerced ('a@b.co' out of ['a@b.co'])
    [{ name: 'Ali', email: ['a@b.co'] }, 'email'],
    [{ name: 'Ali', email: { toString: 1 } }, 'email'],
    [{ name: 'Ali', email: 'a@b.co', service_slug: ['web'] }, 'service_slug'],
  ];
  const before = count();
  for (const [body, field] of cases) {
    const { status, body: j } = await post(body);
    assert.equal(status, 422, JSON.stringify(body));
    assert.equal(j.error, 'validation');
    assert.ok(j.fields[field], `${field} in ${JSON.stringify(j.fields)}`);
  }
  assert.equal(count(), before, 'nothing stored');
  const notJson = await fetch(`${t.base}/api/leads`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{oops' });
  assert.equal(notJson.status, 400);
});

test('a valid lead is stored with the server-owned fields forced, unknown keys dropped', async () => {
  let seen = null;
  const off = events.on('lead.created', p => { seen = p; });
  const { status, body } = await post({
    name: '  Ali Ahmadi ', email: 'ALI@Example.com', phone: '+1 (555) 123-4567', company: 'Acme', project_type: 'website',
    message: 'hi', language: 'FA', page: '/fa/services/web', contact_pref: 'email', business_type: 'retail', service_slug: 'web-design',
    // a visitor may not set these
    source: 'ai', lead_score: 99, summary: 'VIP', status: 'won', ip_hash: 'x', id: 12345, created_at: '1999-01-01', evil: 'ignored',
  });
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.ok(Number.isInteger(body.id));
  const r = row(body.id);
  assert.equal(r.name, 'Ali Ahmadi');
  assert.equal(r.email, 'ali@example.com');
  assert.equal(r.phone, '+15551234567');
  assert.equal(r.phone_norm, '', 'not an Iranian mobile');
  assert.equal(r.company, 'Acme');
  assert.equal(r.language, 'fa');
  assert.equal(r.page, '/fa/services/web');
  assert.equal(r.contact_pref, 'email');
  assert.equal(r.business_type, 'retail');
  assert.equal(r.service_slug, 'web-design');
  assert.equal(r.source, 'form');
  assert.equal(r.lead_score, 0);
  assert.equal(r.summary, '');
  assert.equal(r.status, 'new');
  assert.notEqual(r.created_at, '1999-01-01');
  assert.match(r.ip_hash, /^[0-9a-f]{24}$/);
  assert.ok(!r.ip_hash.includes('127.0.0.1'));
  await new Promise(r => setTimeout(r, 5)); // listeners run in a microtask
  off();
  assert.deepEqual({ id: seen.id, source: seen.source, language: seen.language }, { id: body.id, source: 'form', language: 'fa' });
  assert.equal(seen.lead.email, 'ali@example.com');
});

test('without SMTP the notify skip is logged by lead id, never by address or phone', async () => {
  const lines = [];
  const origLog = console.log;
  console.log = (...a) => lines.push(a.join(' '));
  let id;
  try {
    ({ body: { id } } = await post({ name: 'Log Test', email: 'private.person@example.com', phone: '09121234567' }));
    await new Promise(r => setTimeout(r, 20)); // the notification is fire-and-forget
  } finally {
    console.log = origLog;
  }
  const skip = lines.filter(l => l.startsWith('[lead]'));
  assert.equal(skip.length, 1);
  assert.equal(skip[0], `[lead] #${id} — SMTP not configured, skipping notify`);
  assert.ok(!lines.join('\n').includes('private.person'));
  assert.ok(!lines.join('\n').includes('09121234567'));
});

test('honeypot: a filled "website" answers {ok:true} and stores nothing', async () => {
  const before = count();
  let fired = 0;
  const off = events.on('lead.created', () => { fired++; });
  const { status, body } = await post({ name: 'Bot', email: 'bot@spam.io', website: 'https://spam.io' });
  assert.equal(status, 200);
  assert.deepEqual(body, { ok: true });
  assert.equal(count(), before);
  await new Promise(r => setTimeout(r, 5));
  off();
  assert.equal(fired, 0);
  // an empty honeypot is fine (a real form always sends the hidden field)
  const ok = await post({ name: 'Human', email: 'h@example.com', website: '' });
  assert.equal(ok.status, 200);
  assert.ok(Number.isInteger(ok.body.id));
});

test('Persian and Arabic-Indic digits: phone is normalised and Iranian mobiles get phone_norm', async () => {
  const a = await post({ name: 'سارا', phone: '۰۹۱۲ ۳۴۵ ۶۷۸۹', language: 'fa' });
  assert.equal(a.status, 200);
  assert.equal(row(a.body.id).phone, '09123456789');
  assert.equal(row(a.body.id).phone_norm, '09123456789');

  const b = await post({ name: 'سارا', phone: '+۹۸ ۹۱۲-۳۴۵-۶۷۸۹' });
  assert.equal(row(b.body.id).phone, '+989123456789');
  assert.equal(row(b.body.id).phone_norm, '09123456789');

  const c = await post({ name: 'Omar', phone: '٠٠٩٨٩١٢٣٤٥٦٧٨٩' });
  assert.equal(row(c.body.id).phone, '+989123456789');
  assert.equal(row(c.body.id).phone_norm, '09123456789');

  // landline: stored, but no phone_norm (not a mobile)
  const d = await post({ name: 'Omar', phone: '028-33334444' });
  assert.equal(row(d.body.id).phone, '02833334444');
  assert.equal(row(d.body.id).phone_norm, '');

  // the default language is en and the message keeps its Persian digits verbatim
  const e = await post({ name: 'x', email: 'x@y.io', message: 'سفارش ۱۲ عدد' });
  assert.equal(row(e.body.id).language, 'en');
  assert.equal(row(e.body.id).message, 'سفارش ۱۲ عدد');
});

test('createLead() can be called from server code with another source and a session', async () => {
  const { createLead } = await import('../../src/lib/leads.js');
  const { id } = createLead({ name: 'Chat lead', phone: '09121112233', language: 'fa' }, { source: 'ai', sessionId: 'sess-1', ip: '10.0.0.9' });
  const r = row(id);
  assert.equal(r.source, 'ai');
  assert.equal(r.session_id, 'sess-1');
  assert.equal(r.lead_score, 0);
  assert.throws(() => createLead({ name: '' }), e => e.status === 422 && !!e.fields.name);
  // lead_notes exists and cascades with the lead
  db.prepare('INSERT INTO lead_notes (lead_id, body, admin_user) VALUES (?, ?, ?)').run(id, 'called', 'tester');
  db.prepare('DELETE FROM leads WHERE id=?').run(id);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM lead_notes WHERE lead_id=?').get(id).c, 0);
});
