import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp } from '../helpers.js';

let t, slug;
before(async () => {
  t = await startTestApp();
  slug = await import('../../src/lib/slug.js');
  await t.loginAsAdmin();
});
after(async () => { await t.close(); });

const create = body => t.fetchAdmin('/projects', { method: 'POST', body }).then(r => r.json());
const get = async id => (await (await t.fetchAdmin('/projects')).json()).find(p => p.id === id);

test('slugify', () => {
  assert.equal(slug.slugify('  Hello, World!  '), 'hello-world');
  assert.equal(slug.slugify('Ünïcode & Stuff'), 'n-code-stuff');
  assert.equal(slug.slugify('فروشگاه'), '');
  assert.equal(slug.slugify(''), '');
  assert.equal(slug.slugify('a'.repeat(100)).length, 64);
});

test('create without a slug generates one from the English title, unique', async () => {
  const a = await create({ title_en: 'Retail POS', published: 1 });
  const b = await create({ title_en: 'Retail POS', published: 1 });
  const c = await create({ title_en: 'Retail POS', slug: '', published: 1 });
  assert.equal((await get(a.id)).slug, 'retail-pos');
  assert.equal((await get(b.id)).slug, 'retail-pos-2');
  assert.equal((await get(c.id)).slug, 'retail-pos-3');
});

test('create with neither slug nor English title falls back to "project"', async () => {
  const a = await create({ title_fa: 'فقط فارسی' });
  const b = await create({ title_fa: 'فقط فارسی' });
  assert.equal((await get(a.id)).slug, 'project');
  assert.equal((await get(b.id)).slug, 'project-2');
});

test('explicit slugs are normalised and de-duplicated', async () => {
  const a = await create({ slug: ' Clinic CRM ' });
  const b = await create({ slug: 'clinic-crm', title_en: 'ignored' });
  assert.equal((await get(a.id)).slug, 'clinic-crm');
  assert.equal((await get(b.id)).slug, 'clinic-crm-2');
});

test('update without a slug keeps the existing one; update with a slug changes it', async () => {
  const { id } = await create({ title_en: 'Salon Booking', slug: 'salon' });
  assert.equal((await get(id)).slug, 'salon');
  await t.fetchAdmin(`/projects/${id}`, { method: 'PUT', body: { title_en: 'Salon Booking v2' } });
  assert.equal((await get(id)).slug, 'salon', 'slug survives a save that omits it');
  await t.fetchAdmin(`/projects/${id}`, { method: 'PUT', body: { title_en: 'Salon Booking v2', slug: '' } });
  assert.equal((await get(id)).slug, 'salon', 'empty slug also keeps it');
  await t.fetchAdmin(`/projects/${id}`, { method: 'PUT', body: { title_en: 'Salon', slug: 'Beauty Salon' } });
  assert.equal((await get(id)).slug, 'beauty-salon');
  // updating to a slug another project owns gets a suffix; saving your own slug does not
  await t.fetchAdmin(`/projects/${id}`, { method: 'PUT', body: { slug: 'clinic-crm' } });
  assert.equal((await get(id)).slug, 'clinic-crm-3');
  await t.fetchAdmin(`/projects/${id}`, { method: 'PUT', body: { slug: 'clinic-crm-3' } });
  assert.equal((await get(id)).slug, 'clinic-crm-3');
});
