// The legacy admin CRUD routes (projects, faqs, knowledge, settings) validate
// and length-cap their bodies: a field of the wrong type or size answers
// 422 {error:'validation', fields}, never a 500 from the SQLite binder —
// while every shape the old admin SPA (server/admin/app.js) sends still works.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp } from '../helpers.js';

let t, db;
before(async () => {
  t = await startTestApp();
  ({ db } = await import('../../src/db/index.js'));
  await t.loginAsAdmin();
});
after(async () => { await t.close(); });

const errors = [];
const origError = console.error;
before(() => { console.error = (...a) => errors.push(a.join(' ')); });
after(() => { console.error = origError; });

async function expect422(path, method, body, ...fields) {
  const r = await t.fetchAdmin(path, { method, body });
  const j = await r.json();
  assert.equal(r.status, 422, `${method} ${path} ${JSON.stringify(body)} → ${JSON.stringify(j)}`);
  assert.equal(j.error, 'validation');
  for (const f of fields) assert.ok(j.fields[f], `${f} in ${JSON.stringify(j.fields)}`);
  return j;
}

test('projects: wrong types and oversized fields are 422 with the field named', async () => {
  const bad = [
    [{ title_en: { a: 1 } }, 'title_en'],
    [{ title_fa: ['x'] }, 'title_fa'],
    [{ slug: { toString: 1 } }, 'slug'],
    [{ desc_en: 'd'.repeat(5001) }, 'desc_en'],
    [{ overview_fa: 'o'.repeat(20001) }, 'overview_fa'],
    [{ image: 'i'.repeat(2049) }, 'image'],
    [{ sort: 'abc' }, 'sort'],
    [{ sort: 1.5 }, 'sort'],
    [{ sort: { n: 1 } }, 'sort'],
    [{ published: 'maybe' }, 'published'],
    [{ published: { a: 1 } }, 'published'],
    [{ features: '{"not":"an array"}' }, 'features'],
    [{ features: 'not json' }, 'features'],
    [{ industries: { a: 1 } }, 'industries'],
    [{ pages: 12 }, 'pages'],
    [{ pages: new Array(201).fill('p') }, 'pages'],
    [{ features: [{ t: 'x'.repeat(70000) }] }, 'features'],
  ];
  const before = db.prepare('SELECT COUNT(*) c FROM projects').get().c;
  for (const [body, field] of bad) await expect422('/projects', 'POST', body, field);
  // several problems are reported together
  const j = await expect422('/projects', 'POST', { title_en: { a: 1 }, sort: 'x', pages: 5 }, 'title_en', 'sort', 'pages');
  assert.equal(Object.keys(j.fields).length, 3);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM projects').get().c, before, 'nothing stored');

  // PUT validates the same way and leaves the row untouched
  const { id } = await (await t.fetchAdmin('/projects', { method: 'POST', body: { title_en: 'Keep', published: true } })).json();
  await expect422(`/projects/${id}`, 'PUT', { title_en: { a: 1 } }, 'title_en');
  assert.equal(db.prepare('SELECT title_en FROM projects WHERE id=?').get(id).title_en, 'Keep');
  assert.equal(errors.length, 0, `no stack trace logged: ${errors.join('\n')}`);
});

test('projects: every shape the old admin SPA sends is accepted and normalised', async () => {
  // the legacy panel posts textarea JSON text, a numeric string for sort and a real boolean
  const legacy = {
    slug: '', title_en: 'Old Panel', title_fa: '  پنل قدیمی  ', tags: 'A · B', image: '/uploads/x.png',
    industries: '[{"en":"Retail","fa":"خرده‌فروشی"}]', features: '  ', pages: '[]', sort: '7', published: true,
  };
  const created = await t.fetchAdmin('/projects', { method: 'POST', body: legacy });
  assert.equal(created.status, 200);
  const { ok, id } = await created.json();
  assert.equal(ok, true);
  const p = db.prepare('SELECT * FROM projects WHERE id=?').get(id);
  assert.equal(p.slug, 'old-panel');
  assert.equal(p.title_fa, 'پنل قدیمی');
  assert.equal(p.industries, '[{"en":"Retail","fa":"خرده‌فروشی"}]');
  assert.equal(p.features, '[]', 'a blank textarea means no items');
  assert.equal(p.sort, 7);
  assert.equal(p.published, 1);

  // a JSON client sends real arrays and 0/1 flags; missing fields are blanks, not errors
  const upd = await t.fetchAdmin(`/projects/${id}`, { method: 'PUT', body: { title_en: 'Old Panel v2', published: 0, features: [{ title_en: 'f' }], sort: '' } });
  assert.deepEqual(await upd.json(), { ok: true });
  const p2 = db.prepare('SELECT * FROM projects WHERE id=?').get(id);
  assert.equal(p2.title_en, 'Old Panel v2');
  assert.equal(p2.slug, 'old-panel', 'a save without a slug keeps the current one');
  assert.equal(p2.published, 0);
  assert.equal(p2.sort, 0);
  assert.equal(p2.features, '[{"title_en":"f"}]');
  assert.equal(p2.industries, '[]');
  const empty = await t.fetchAdmin('/projects', { method: 'POST', body: {} });
  assert.equal(empty.status, 200, 'an empty body still creates a blank project (legacy "New project")');
  assert.equal((await fetch(`${t.base}/en/work/old-panel`)).status, 404, 'unpublished page is hidden');
});

test('faqs and knowledge: 422 on bad input, legacy shapes accepted', async () => {
  await expect422('/faqs', 'POST', { q_en: { a: 1 } }, 'q_en');
  await expect422('/faqs', 'POST', { a_fa: 'x'.repeat(10001) }, 'a_fa');
  await expect422('/faqs', 'POST', { sort: 'seven', published: 'yes' }, 'sort', 'published');
  await expect422('/knowledge', 'POST', { title: ['K'] }, 'title');
  await expect422('/knowledge', 'POST', { body_en: 'b'.repeat(50001) }, 'body_en');
  await expect422('/knowledge', 'POST', { enabled: { on: true } }, 'enabled');

  const faq = await (await t.fetchAdmin('/faqs', { method: 'POST', body: { q_en: 'Q', q_fa: 'س', a_en: 'A', a_fa: 'ج', sort: '3', published: 1 } })).json();
  assert.ok(Number.isInteger(faq.id));
  const f = db.prepare('SELECT * FROM faqs WHERE id=?').get(faq.id);
  assert.equal(f.sort, 3);
  assert.equal(f.published, 1);
  await expect422(`/faqs/${faq.id}`, 'PUT', { q_en: 5, a_en: [] }, 'a_en');
  assert.equal(db.prepare('SELECT q_en FROM faqs WHERE id=?').get(faq.id).q_en, 'Q');

  const kb = await (await t.fetchAdmin('/knowledge', { method: 'POST', body: { title: 'K', body_en: 'b'.repeat(20000), enabled: 'true' } })).json();
  const k = db.prepare('SELECT * FROM knowledge WHERE id=?').get(kb.id);
  assert.equal(k.enabled, 1);
  assert.equal(k.body_en.length, 20000);
  assert.deepEqual(await (await t.fetchAdmin(`/knowledge/${kb.id}`, { method: 'PUT', body: { title: 'K2', enabled: false } })).json(), { ok: true });
  assert.equal(db.prepare('SELECT enabled FROM knowledge WHERE id=?').get(kb.id).enabled, 0);
  assert.equal(errors.length, 0, `no stack trace logged: ${errors.join('\n')}`);
});

test('settings: {value:{en,fa}} strings only, 5000 chars each; unknown keys stay 400', async () => {
  const { getSetting } = await import('../../src/db/index.js');
  await t.fetchAdmin('/settings/hero_h1', { method: 'PUT', body: { value: { en: 'Keep', fa: 'نگه‌دار' } } });
  await expect422('/settings/hero_h1', 'PUT', { value: { en: { toString: 1 } } }, 'value.en');
  await expect422('/settings/hero_h1', 'PUT', { value: { en: 'ok', fa: ['x'] } }, 'value.fa');
  await expect422('/settings/hero_h1', 'PUT', { value: 'not an object' }, 'value');
  await expect422('/settings/hero_h1', 'PUT', { value: [1] }, 'value');
  await expect422('/settings/hero_h1', 'PUT', { value: { en: 'x'.repeat(5001) } }, 'value.en');
  assert.deepEqual(getSetting('hero_h1'), { en: 'Keep', fa: 'نگه‌دار' }, 'rejected writes never touch the row');

  // legacy shapes: a missing half is '', a missing value is {en:'',fa:''}, whitespace is kept
  assert.deepEqual(await (await t.fetchAdmin('/settings/hero_h1', { method: 'PUT', body: { value: { en: ' Hi ' } } })).json(), { ok: true });
  assert.deepEqual(getSetting('hero_h1'), { en: ' Hi ', fa: '' });
  assert.deepEqual(await (await t.fetchAdmin('/settings/hero_h1', { method: 'PUT', body: {} })).json(), { ok: true });
  assert.deepEqual(getSetting('hero_h1'), { en: '', fa: '' });
  const bad = await t.fetchAdmin('/settings/ai_config', { method: 'PUT', body: { value: { en: 'x', fa: 'y' } } });
  assert.equal(bad.status, 400);
  assert.deepEqual(await bad.json(), { error: 'unknown setting' });
  assert.equal(errors.length, 0, `no stack trace logged: ${errors.join('\n')}`);
});
