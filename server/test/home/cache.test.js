// renderHome is memoised per language via lib/cache.js; every admin write
// (content or anything else) invalidates it; ETag revalidation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp } from '../helpers.js';

const t = await startTestApp();
await t.loginAsAdmin();
const { renderHome } = await import('../../src/render/home.js');
const { invalidate, cacheVersion } = await import('../../src/lib/cache.js');
const { getContent } = await import('../../src/lib/content.js');

test.after(() => t.close());

test('second render returns the memoised object; languages are memoised separately', async () => {
  const a = await renderHome('fa');
  const b = await renderHome('fa');
  assert.equal(a, b, 'same frozen {html, etag} object');
  assert.ok(Object.isFrozen(a));
  const en = await renderHome('en');
  assert.notEqual(en, a);
  assert.notEqual(en.etag, a.etag);
  assert.equal(await renderHome('en'), en);
  assert.equal(await renderHome('fa'), a, 'rendering en did not evict fa');
  assert.equal(await renderHome('xx'), a, 'unknown language → fa');
});

test('invalidate() forces a rebuild; identical content gives an identical ETag', async () => {
  const a = await renderHome('fa');
  invalidate();
  const b = await renderHome('fa');
  assert.notEqual(a, b, 'rebuilt');
  assert.equal(a.html, b.html);
  assert.equal(a.etag, b.etag, 'etag is a hash of the html, not of the cache version');
});

test('a PUT through the admin API invalidates: the next render carries the new text and a new ETag', async () => {
  const before = await renderHome('fa');
  const v = cacheVersion();
  const r = await t.fetchAdmin('/content/HERO_H1', { method: 'PUT', body: { fa: 'کش باطل شد' } });
  assert.equal(r.status, 200);
  assert.ok(cacheVersion() > v, 'cache version bumped by the write');
  const after = await renderHome('fa');
  assert.notEqual(after, before);
  assert.ok(after.html.includes('<h1 class="rv on">کش باطل شد</h1>'));
  assert.notEqual(after.etag, before.etag);
  assert.equal(getContent('fa').HERO_H1, 'کش باطل شد', 'getContent is refreshed too');
  await t.fetchAdmin('/content/HERO_H1', { method: 'DELETE' });
  assert.equal((await renderHome('fa')).etag, before.etag, 'reset → the original page again');
});

test('a write to another admin entity (faqs) also refreshes the page', async () => {
  const before = await renderHome('en');
  const r = await t.fetchAdmin('/faqs', { method: 'POST', body: { q_en: 'Cached?', q_fa: 'کش؟', a_en: 'No', a_fa: 'نه', sort: 1, published: true } });
  assert.equal(r.status, 200);
  const after = await renderHome('en');
  assert.notEqual(after, before);
  assert.ok(after.html.includes('<button class="qa-q">Cached? <span class="sign">+</span></button>'));
});

test('HTTP: 304 on a matching ETag, 200 + new ETag after a change', async () => {
  const r1 = await fetch(`${t.base}/fa/`);
  const etag = r1.headers.get('etag');
  assert.equal(etag, (await renderHome('fa')).etag);
  const cond = { 'if-none-match': etag, 'cache-control': 'max-age=0' };
  assert.equal((await fetch(`${t.base}/fa/`, { headers: cond })).status, 304);
  assert.equal((await fetch(`${t.base}/fa/`, { headers: { ...cond, 'if-none-match': '"nope"' } })).status, 200);
  await t.fetchAdmin('/content/FOOT_C', { method: 'PUT', body: { fa: '© تغییر' } });
  const r2 = await fetch(`${t.base}/fa/`, { headers: cond });
  assert.equal(r2.status, 200);
  assert.notEqual(r2.headers.get('etag'), etag);
  await t.fetchAdmin('/content/FOOT_C', { method: 'DELETE' });
});
