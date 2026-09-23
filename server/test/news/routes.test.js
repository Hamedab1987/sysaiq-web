// Admin news API + public pages, feed and sitemap. Items are seeded through
// the same helpers the pipeline uses; no network, no AI.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { XMLParser } from 'fast-xml-parser';
import { startTestApp } from '../helpers.js';

let t, db, items;
const ids = {};
const FULL = {
  ok: true, note: '',
  fields: {
    importance: 4, category: 'models', tags: ['nova', 'agents'],
    title_fa: 'مدل Nova برای Agentها عرضه شد', title_en: 'Lab ships Model Nova for agents',
    summary_fa: 'آزمایشگاه مدل تازه‌ای به نام Nova معرفی کرد که از طریق API در دسترس است.',
    summary_en: 'The lab introduced Nova, available through its API.',
    why_fa: 'کسب‌وکارها می‌توانند روی این مدل Agent بسازند.', why_en: 'Businesses can build agents on it.',
  },
};

before(async () => {
  t = await startTestApp();
  ({ db } = await import('../../src/db/index.js'));
  items = await import('../../src/news/items.js');
  const add = (key, over = {}, res = FULL) => {
    const id = items.insertCollected({ sourceName: 'Lab Blog', title: `Source title ${key}`, link: `https://lab.example/news/${key}`, date: new Date().toISOString(), summary: 'Source excerpt.', category: 'industry', ...over });
    if (res) items.applySummary(id, res);
    ids[key] = id;
  };
  add('ready');
  add('tools', {}, { ...FULL, fields: { ...FULL.fields, category: 'tools', title_en: 'A new tool for agents', title_fa: 'ابزاری تازه برای Agentها' } });
  add('untranslated', {}, { ok: false, error: 'bad_output' });
  add('evil', {}, { ...FULL, fields: { ...FULL.fields, title_en: '<script>alert(1)</script> Evil & co', title_fa: 'عنوان <img src=x onerror=alert(1)>' } });
  await t.loginAsAdmin();
});
after(async () => { await t.close(); });

const admin = (path, opts) => t.fetchAdmin(`/news${path}`, opts);
const get = async p => { const r = await fetch(t.base + p); return { status: r.status, text: await r.text(), headers: r.headers }; };

test('admin API needs a session', async () => {
  const r = await fetch(`${t.base}/api/admin/news/items`, { headers: { origin: t.base, 'x-requested-with': 'sysaiq-admin' } });
  assert.equal(r.status, 401);
});

test('queue listing: filters, counts, search', async () => {
  const r = await (await admin('/items?status=draft')).json();
  assert.equal(r.total, 4);
  assert.equal(r.counts.draft, 4);
  assert.ok(r.items.every(i => i.status === 'draft'));
  const q = await (await admin('/items?q=untranslated')).json();
  assert.equal(q.total, 1);
  assert.equal((await admin('/items?status=bogus')).status, 422);
  assert.equal((await admin('/items?category=gossip')).status, 422);
  const one = await (await admin(`/items/${ids.untranslated}`)).json();
  assert.deepEqual(one.missing.sort(), ['summary_en', 'summary_fa', 'title_en', 'title_fa']);
});

test('edit validation: lengths, enums, ranges, unknown ids', async () => {
  const bad = [
    { title_en: 'x'.repeat(201) }, { summary_fa: 'x'.repeat(1201) }, { category: 'gossip' }, { importance: 9 },
    { tags: ['<b>'] }, { tags: 'x'.repeat(10) }, { slug: 'Not A Slug!' }, {},
  ];
  for (const body of bad) {
    const r = await admin(`/items/${ids.untranslated}`, { method: 'PUT', body });
    assert.equal(r.status, 422, JSON.stringify(body).slice(0, 40));
  }
  assert.equal((await admin('/items/999999', { method: 'PUT', body: { title_en: 'x' } })).status, 404);
  assert.equal((await admin('/items/abc/publish', { method: 'POST' })).status, 404);
});

test('publish requires title + summary in both languages', async () => {
  const r = await admin(`/items/${ids.untranslated}/publish`, { method: 'POST' });
  assert.equal(r.status, 422);
  const body = await r.json();
  assert.deepEqual(Object.keys(body.fields).sort(), ['summary_en', 'summary_fa', 'title_en', 'title_fa']);
  // the owner fills in the translation by hand, then it publishes
  const put = await admin(`/items/${ids.untranslated}`, { method: 'PUT', body: { title_en: 'Hand-written brief', summary_en: 'Written by the owner.', title_fa: 'خبر دست‌نویس', summary_fa: 'نوشتهٔ مالک.' } });
  assert.equal(put.status, 200);
  const ok = await (await admin(`/items/${ids.untranslated}/publish`, { method: 'POST' })).json();
  assert.equal(ok.item.status, 'published');
  assert.equal(ok.item.slug, 'hand-written-brief');
  // a live item cannot lose a language
  assert.equal((await admin(`/items/${ids.untranslated}`, { method: 'PUT', body: { summary_fa: '' } })).status, 422);
});

test('publish, bulk, slugs are unique and drafts stay private', async () => {
  const r = await (await admin('/items/bulk', { method: 'POST', body: { ids: [ids.ready, ids.evil, 999999], action: 'publish' } })).json();
  assert.equal(r.done, 2);
  assert.deepEqual(r.results.find(x => x.id === 999999), { id: 999999, ok: false, error: 'not_found' });
  assert.equal((await admin('/items/bulk', { method: 'POST', body: { ids: [], action: 'publish' } })).status, 422);
  assert.equal((await admin('/items/bulk', { method: 'POST', body: { ids: [1], action: 'delete' } })).status, 422);
  const ready = items.getItem(ids.ready);
  assert.equal(ready.slug, 'lab-ships-model-nova-for-agents');
  const evil = items.getItem(ids.evil);
  assert.equal(evil.slug, 'script-alert-1-script-evil-co');
  // the same title again gets -2
  assert.equal(items.uniqueSlug('Lab ships Model Nova for agents', 0), 'lab-ships-model-nova-for-agents-2');
  // the tools item is still a draft → 404 publicly (it has no slug yet)
  assert.equal(items.getItem(ids.tools).slug, null);
});

test('public list + article: only published, escaped, nofollow source, JSON-LD, CSP', async () => {
  const list = await get('/fa/news');
  assert.equal(list.status, 200);
  assert.match(list.headers.get('content-security-policy') || '', /script-src 'self'/);
  assert.match(list.text, /اخبار هوش مصنوعی و فناوری/);
  assert.match(list.text, /href="\/fa\/news\/lab-ships-model-nova-for-agents"/);
  assert.doesNotMatch(list.text, /ابزاری تازه برای Agentها/, 'drafts are not listed');
  assert.doesNotMatch(list.text, /<script>alert|<img src=x/);
  assert.match(list.text, /&lt;script&gt;|عنوان &lt;img/);
  assert.match(list.text, /rel="alternate" type="application\/rss\+xml"/);
  assert.match(list.text, /\/assets\/site\/news\.css\?v=/);
  // no executable inline script: only JSON-LD blocks
  for (const m of list.text.matchAll(/<script\b([^>]*)>/g)) assert.match(m[1], /application\/ld\+json|src=/);

  const cat = await get('/en/news?c=models');
  assert.equal(cat.status, 200);
  assert.match(cat.text, /aria-current="page"[^>]*>Models|nw-k-models" href="\/en\/news\?c=models" aria-current="page"/);
  assert.equal((await get('/en/news?c=gossip')).status, 404);
  assert.equal((await get('/en/news?page=0')).status, 404);
  assert.equal((await get('/en/news?page=9')).status, 404);

  const art = await get('/en/news/lab-ships-model-nova-for-agents');
  assert.equal(art.status, 200);
  assert.match(art.text, /<h1>Lab ships Model Nova for agents<\/h1>/);
  assert.match(art.text, /Why it matters/);
  assert.match(art.text, /href="https:\/\/lab\.example\/news\/ready" rel="nofollow noopener noreferrer" target="_blank"/);
  assert.match(art.text, /href="\/en\/services"/);
  assert.match(art.text, /"@type":"NewsArticle"/);
  assert.match(art.text, /"@type":"BreadcrumbList"/);
  assert.doesNotMatch(art.text, /<img[^>]+lab\.example/, 'no source image is ever embedded');
  const fa = await get('/fa/news/lab-ships-model-nova-for-agents');
  assert.match(fa.text, /چرا مهم است؟/);
  assert.match(fa.text, /می‌خواهید این قابلیت را در کسب‌وکارتان داشته باشید؟/);
  assert.match(fa.text, /<time datetime="[^"]+">[۰-۹]+ [^<]+ [۰-۹]{4}<\/time>/, 'Jalali date with Persian digits');
  assert.match(art.text, /<time datetime="[^"]+">\d{1,2} [A-Z][a-z]+ \d{4}<\/time>/, 'Gregorian date in English');

  assert.equal((await get('/fa/news/no-such-item')).status, 404);
  // reject → gone from the site
  await admin(`/items/${ids.evil}/reject`, { method: 'POST' });
  assert.equal((await get(`/fa/news/${items.getItem(ids.evil).slug}`)).status, 404);
});

test('feed.xml: valid RSS per language, published items only', async () => {
  const r = await get('/fa/news/feed.xml');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /application\/rss\+xml/);
  const doc = new XMLParser({ ignoreAttributes: false, isArray: n => n === 'item' }).parse(r.text);
  assert.equal(doc.rss['@_version'], '2.0');
  assert.equal(doc.rss.channel.language, 'fa-IR');
  const titles = doc.rss.channel.item.map(i => i.title);
  assert.ok(titles.includes('مدل Nova برای Agentها عرضه شد'));
  assert.ok(!titles.some(x => /ابزاری تازه/.test(x)), 'draft not in the feed');
  assert.ok(doc.rss.channel.item.every(i => /^http:\/\/.+\/fa\/news\/[a-z0-9-]+$/.test(i.link) || /^https:\/\/.+\/fa\/news\/[a-z0-9-]+$/.test(i.link)));
  const en = new XMLParser().parse((await get('/en/news/feed.xml')).text);
  assert.equal(en.rss.channel.language, 'en');
});

test('sitemap lists /news and each published item in both languages', async () => {
  const r = await get('/sitemap.xml');
  assert.match(r.text, /\/fa\/news<\/loc>/);
  assert.match(r.text, /\/en\/news\/lab-ships-model-nova-for-agents<\/loc>/);
  assert.match(r.text, /\/fa\/news\/hand-written-brief<\/loc>/);
  assert.doesNotMatch(r.text, /script-alert/, 'rejected items leave the sitemap');
});

test('sources: https only, private hosts refused, CRUD', async () => {
  assert.equal((await admin('/sources', { method: 'POST', body: { name: 'x', url: 'http://example.com/feed' } })).status, 422);
  assert.equal((await admin('/sources', { method: 'POST', body: { name: '', url: 'https://example.com/feed' } })).status, 422);
  assert.equal((await admin('/sources', { method: 'POST', body: { name: 'x', url: 'https://example.com/feed', category: 'gossip' } })).status, 422);
  const probe = await (await admin('/sources/test', { method: 'POST', body: { url: 'https://127.0.0.1/feed' } })).json();
  assert.deepEqual(probe, { ok: false, error: 'private_host' });
  const created = await admin('/sources', { method: 'POST', body: { name: 'Local mistake', url: 'https://169.254.169.254/feed', category: 'tech' } });
  assert.equal(created.status, 201);
  const { id } = await created.json();
  const tested = await (await admin(`/sources/${id}/test`, { method: 'POST' })).json();
  assert.equal(tested.error, 'private_host');
  assert.equal((await admin('/sources', { method: 'POST', body: { name: 'dup', url: 'https://169.254.169.254/feed' } })).status, 409);
  assert.equal((await admin(`/sources/${id}`, { method: 'PUT', body: { enabled: false } })).status, 200);
  assert.equal((await admin(`/sources/${id}`, { method: 'DELETE' })).status, 200);
  assert.equal((await admin(`/sources/${id}`, { method: 'DELETE' })).status, 404);
  const list = await (await admin('/sources')).json();
  assert.ok(list.sources.length >= 14, 'the verified default sources are seeded');
  assert.ok(list.sources.every(s => s.url.startsWith('https://')));
});

test('draft from URL: https only, SSRF-guarded; config and runs', async () => {
  assert.equal((await admin('/items/draft-from-url', { method: 'POST', body: { url: 'http://example.com/a' } })).status, 422);
  const priv = await admin('/items/draft-from-url', { method: 'POST', body: { url: 'https://localhost/a' } });
  assert.equal(priv.status, 422);
  assert.deepEqual((await priv.json()).fields, { url: 'private_host' });
  const dup = await admin('/items/draft-from-url', { method: 'POST', body: { url: 'https://lab.example/news/ready?utm_source=x' } });
  assert.equal(dup.status, 409);

  const cfg = await (await admin('/config')).json();
  assert.equal(cfg.config.auto_publish, false);
  assert.equal(cfg.openai_configured, false);
  assert.equal((await admin('/config', { method: 'PUT', body: { auto_publish: true } })).status, 422);
  assert.equal((await admin('/config', { method: 'PUT', body: { interval_hours: 0 } })).status, 422);
  const put = await (await admin('/config', { method: 'PUT', body: { interval_hours: 12, min_importance: 4 } })).json();
  assert.equal(put.config.interval_hours, 12);
  assert.equal(put.config.min_importance, 4);

  const run = await (await admin('/run', { method: 'POST' })).json();
  assert.equal(run.run.error, 'no_key');
  const runs = await (await admin('/runs')).json();
  assert.equal(runs.runs[0].error, 'no_key');
  // an admin write is audited by the auto-mounter
  const decisions = db.prepare("SELECT action FROM audit_log WHERE entity='news_items'").all().map(r => r.action);
  for (const a of ['publish', 'reject']) assert.ok(decisions.includes(a), a);
  assert.ok(db.prepare("SELECT COUNT(*) c FROM audit_log WHERE entity='news'").get().c > 0, 'the auto-mounter row too');
});

test('delete removes an item', async () => {
  assert.equal((await admin(`/items/${ids.tools}`, { method: 'DELETE' })).status, 200);
  assert.equal(items.getItem(ids.tools), undefined);
  assert.equal((await admin(`/items/${ids.tools}`, { method: 'DELETE' })).status, 404);
});
