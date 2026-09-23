// /api/admin/knowledge with the migration-014 columns: slug (generated from
// the title on create, -2 on collision, 422 on an explicit duplicate), grp
// (`group` accepted as an alias, validated against KNOWLEDGE_GROUPS) and
// sort; a legacy-shaped PUT leaves all three alone.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp } from '../helpers.js';

let t;
before(async () => { t = await startTestApp(); await t.loginAsAdmin(); });
after(async () => { await t.close(); });

const post = body => t.fetchAdmin('/knowledge', { method: 'POST', body });
const put = (id, body) => t.fetchAdmin(`/knowledge/${id}`, { method: 'PUT', body });
const list = async () => (await t.fetchAdmin('/knowledge')).json();

test('POST generates the slug from the title and returns it; GET returns slug/grp/sort', async () => {
  const a = await (await post({ title: 'Pitch: Restaurant & Cafe', body_fa: 'متن', group: 'pitch', sort: '4', enabled: true })).json();
  assert.equal(a.ok, true);
  assert.equal(a.slug, 'pitch-restaurant-cafe');
  const b = await (await post({ title: 'Pitch: Restaurant & Cafe', body_fa: 'دوم' })).json();
  assert.equal(b.slug, 'pitch-restaurant-cafe-2', 'collision → -2');
  const rows = await list();
  const ra = rows.find(r => r.id === a.id);
  assert.equal(ra.slug, 'pitch-restaurant-cafe');
  assert.equal(ra.grp, 'pitch');
  assert.equal(ra.sort, 4);
  const rb = rows.find(r => r.id === b.id);
  assert.equal(rb.grp, '');
  assert.equal(rb.sort, 0);
  const c = await (await post({ title: '؟؟؟', body_fa: 'بدون شناسه' })).json();
  assert.equal(c.slug, '', 'a title without latin letters stays unslugged');
});

test('explicit slug: accepted when free, 422 when taken or malformed; bad group/sort → 422', async () => {
  const ok = await (await post({ title: 'Payments', slug: 'payments-and-invoices', grp: 'commercial' })).json();
  assert.equal(ok.slug, 'payments-and-invoices');
  for (const [body, field] of [
    [{ title: 'X', slug: 'payments-and-invoices' }, 'slug'],
    [{ title: 'X', slug: 'Not a slug!' }, 'slug'],
    [{ title: 'X', grp: 'marketing' }, 'grp'],
    [{ title: 'X', group: 'marketing' }, 'grp'],
    [{ title: 'X', sort: 'first' }, 'sort'],
  ]) {
    const r = await post(body);
    assert.equal(r.status, 422, JSON.stringify(body));
    assert.ok(field in (await r.json()).fields, JSON.stringify(body));
  }
  const other = await (await post({ title: 'Other' })).json();
  const dup = await put(other.id, { title: 'Other', slug: 'payments-and-invoices' });
  assert.equal(dup.status, 422);
});

test('a legacy-shaped PUT keeps slug/grp/sort; a new-shaped PUT updates grp and sort', async () => {
  const { id } = await (await post({ title: 'Clinic hours', group: 'contact', sort: 2 })).json();
  assert.deepEqual(await (await put(id, { title: 'Clinic hours (edited)', body_en: 'b', enabled: false })).json(), { ok: true });
  let r = (await list()).find(x => x.id === id);
  assert.equal(r.title, 'Clinic hours (edited)');
  assert.equal(r.slug, 'clinic-hours', 'the slug never follows a title edit');
  assert.equal(r.grp, 'contact');
  assert.equal(r.sort, 2);
  assert.equal(r.enabled, 0);
  await put(id, { title: 'Clinic hours (edited)', grp: 'company', sort: 7, enabled: true });
  r = (await list()).find(x => x.id === id);
  assert.equal(r.grp, 'company');
  assert.equal(r.sort, 7);
  await put(id, { title: 'Clinic hours (edited)', grp: '' });
  assert.equal((await list()).find(x => x.id === id).grp, '', "'' clears the group");
});
