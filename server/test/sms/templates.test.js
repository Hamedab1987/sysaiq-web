// sms/templates.js: seeded templates, rendering, variable sanitisation,
// length caps and the 70/67 · 160/153 segment counter.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp } from '../helpers.js';

let t, tpl, db;
before(async () => {
  t = await startTestApp();
  ({ db } = await import('../../src/db/index.js'));
  tpl = await import('../../src/sms/templates.js');
});
after(async () => { await t.close(); });

const KEYS = ['lead_owner', 'lead_customer', 'invoice_link', 'invoice_reminder', 'payment_customer', 'payment_owner'];

test('migration 100 seeded the six system templates, bilingual, with their variables', () => {
  const rows = tpl.listTemplates();
  assert.deepEqual(rows.map(r => r.key), KEYS);
  for (const r of rows) {
    assert.equal(r.is_system, true, r.key);
    assert.equal(r.enabled, true);
    assert.ok(r.body_fa && r.body_en && r.label_fa && r.label_en, `${r.key} bilingual`);
    // every declared variable appears in both bodies and vice versa
    assert.deepEqual([...tpl.placeholdersOf(r.body_fa)].sort(), [...r.variables].sort(), `${r.key} fa vars`);
    assert.deepEqual([...tpl.placeholdersOf(r.body_en)].sort(), [...r.variables].sort(), `${r.key} en vars`);
    assert.deepEqual(r.provider_map, {});
    // no Arabic ي/ك, ZWNJ used for می‌
    assert.ok(!/[يك]/.test(r.body_fa), `${r.key} Persian letters`);
  }
  assert.ok(tpl.getTemplate('lead_customer').body_fa.includes('می‌گیریم'));
  // the pay link is fixed text + a short code (SMS.ir 25-char rule)
  assert.ok(tpl.getTemplate('invoice_link').body_fa.includes('sysaiq.com/p/{{code}}'));
  assert.equal(db.prepare('SELECT COUNT(*) c FROM sms_templates').get().c, 6);
});

test('segments: Persian 70/67, GSM-7 160/153, extension chars count double', () => {
  const fa = 'س'.repeat(70);
  assert.deepEqual(tpl.countSegments(fa), { chars: 70, segments: 1, unicode: true });
  assert.deepEqual(tpl.countSegments(fa + 'س'), { chars: 71, segments: 2, unicode: true });
  assert.equal(tpl.countSegments('س'.repeat(134)).segments, 2);
  assert.equal(tpl.countSegments('س'.repeat(135)).segments, 3);
  assert.deepEqual(tpl.countSegments('a'.repeat(160)), { chars: 160, segments: 1, unicode: false });
  assert.equal(tpl.countSegments('a'.repeat(161)).segments, 2);
  assert.equal(tpl.countSegments('a'.repeat(306)).segments, 2);
  assert.equal(tpl.countSegments('a'.repeat(307)).segments, 3);
  assert.deepEqual(tpl.countSegments('a€'), { chars: 3, segments: 1, unicode: false });
  assert.deepEqual(tpl.countSegments(''), { chars: 0, segments: 0, unicode: false });
  assert.equal(tpl.isGsm7('hello 123 @'), true);
  assert.equal(tpl.isGsm7('سلام'), false);
});

test('render: fa/en bodies, missing variable, sanitised values, caps', () => {
  const fa = tpl.render('lead_customer', 'fa', { name: 'سارا' });
  assert.equal(fa.text, 'سارا عزیز، درخواست شما در SysaiQ ثبت شد. در اولین فرصت با شما تماس می‌گیریم.');
  assert.equal(fa.lang, 'fa');
  assert.equal(fa.segments, 2);
  const en = tpl.render('lead_customer', 'en', { name: 'Sara' });
  assert.equal(en.text, 'Dear Sara, SysaiQ has received your request. We will be in touch soon.');
  assert.equal(en.lang, 'en');
  assert.equal(en.segments, 1);
  // unknown lang → fa; extra vars ignored
  assert.equal(tpl.render('lead_customer', 'de', { name: 'x', junk: 'y' }).lang, 'fa');

  // missing variable names the variable
  assert.throws(() => tpl.render('invoice_link', 'fa', { name: 'x', number: '1', amount: '2' }), e => e.code === 'missing_var' && /code/.test(e.message));
  assert.throws(() => tpl.render('lead_customer', 'fa', { name: '   ' }), e => e.code === 'missing_var');
  assert.throws(() => tpl.render('nope', 'fa', {}), e => e.code === 'template_missing');

  // sanitisation: control chars, braces (no placeholder injection), whitespace collapse, 120-char cap
  assert.equal(tpl.sanitizeVar(' a\x00b\u{200b} {{name}}  c\n\nd '), 'ab name c d');
  assert.equal(tpl.sanitizeVar('می\u{200c}گیریم'), 'می\u{200c}گیریم', 'ZWNJ kept');
  assert.equal([...tpl.sanitizeVar('x'.repeat(500))].length, 120);
  assert.equal(tpl.sanitizeVar(12500), '12500');
  assert.equal(tpl.sanitizeVar(null), '');
  const inj = tpl.render('lead_customer', 'fa', { name: '{{phone}}' });
  assert.ok(!inj.text.includes('{{'));
  assert.ok(inj.text.startsWith('phone عزیز'));
  assert.deepEqual(Object.keys(tpl.sanitizeVars({ ok: 1, 'Bad-Key': 2, __proto__: 3 })), ['ok']);

  // rendered length cap: 500 chars / 7 segments
  const long = 'س'.repeat(120);
  assert.throws(() => tpl.renderText('{{a}}{{b}}{{c}}{{d}}{{e}}', { a: long, b: long, c: long, d: long, e: long }), e => e.code === 'too_long');
  assert.throws(() => tpl.renderText('   ', {}), e => e.code === 'empty_text');
  assert.equal(tpl.renderText('{{a}}', { a: 'x'.repeat(120) }).segments, 1);
});

test('disabled template refuses to render; bodyFor falls back to fa when en is empty', () => {
  db.prepare("UPDATE sms_templates SET enabled=0 WHERE key='payment_owner'").run();
  assert.throws(() => tpl.render('payment_owner', 'fa', {}), e => e.code === 'template_disabled');
  db.prepare("UPDATE sms_templates SET enabled=1, body_en='' WHERE key='payment_owner'").run();
  const r = tpl.render('payment_owner', 'en', { amount: '1', number: '2', name: 'n', status: 's' });
  assert.equal(r.lang, 'fa');
  assert.ok(r.text.startsWith('SysaiQ: پرداخت'));
  assert.deepEqual(Object.keys(tpl.sampleVars(tpl.getTemplate('invoice_link'))).sort(), ['amount', 'code', 'name', 'number']);
});
