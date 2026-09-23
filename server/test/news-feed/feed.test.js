// render/slots/news_feed.js: the newsroom carousel under the FAQ. '' until
// something is published; then one .light carousel section with the 10
// newest briefs (published_at DESC), each card one link to its news page,
// escaped, with the owner's image when set and a per-item brand cover
// otherwise — plus the external script/stylesheet it loads, the optional
// news image (migration 401 + admin PUT) and the news pages using it.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import Database from 'better-sqlite3';
import { startTestApp } from '../helpers.js';

const VESPER = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'vesper-project');
let t, items, slot, db, cache;
const ids = []; // insertion order: ids[0] oldest … ids[11] newest

const brief = (n, over = {}) => ({
  ok: true, note: '',
  fields: {
    importance: 3, category: ['models', 'tools', 'devices', 'tech', 'industry'][n % 5], tags: ['agents'],
    title_fa: `خبر شمارهٔ ${n} دربارهٔ Agentها`, title_en: `Feed story number ${n} about agents`,
    summary_fa: `خلاصهٔ کوتاه خبر ${n} برای کارت.`, summary_en: `Short summary of story ${n} for the card.`,
    why_fa: 'برای کسب‌وکارها مهم است.', why_en: 'It matters for businesses.',
    ...over,
  },
});

before(async () => {
  // the real site dir, so /assets/site/news-feed.{js,css} are served and hashed
  t = await startTestApp({ env: { SITE_DIR: VESPER } });
  items = await import('../../src/news/items.js');
  slot = await import('../../src/render/slots/news_feed.js');
  ({ db } = await import('../../src/db/index.js'));
  cache = await import('../../src/lib/cache.js');
  for (let n = 1; n <= 12; n++) {
    const id = items.insertCollected({ sourceName: 'Lab', title: `Source ${n}`, link: `https://lab.example/feed/${n}`, date: new Date().toISOString(), summary: 'Excerpt.', category: 'industry' });
    items.applySummary(id, n === 11
      ? brief(n, { title_en: '<script>alert(1)</script> Evil & co', title_fa: 'عنوان <img src=x onerror=alert(1)>', summary_en: 'Sum "quoted" <b>bold</b>' })
      : brief(n));
    ids.push(id);
  }
  await t.loginAsAdmin();
});
after(async () => { await t.close(); });

const admin = async (path, opts) => { const r = await t.fetchAdmin(path, opts); return { status: r.status, body: await r.json() }; };
const page = async path => { const r = await fetch(t.base + path); return { status: r.status, text: await r.text(), headers: r.headers }; };
const slugOf = id => db.prepare('SELECT slug FROM news_items WHERE id=?').get(id).slug;
const hrefs = html => [...html.matchAll(/<a class="nf-card" href="([^"]+)"/g)].map(m => m[1]);

test('migration 401: news_items.image exists, defaults to \'\', and re-running is a no-op', async () => {
  const cols = db.prepare('PRAGMA table_info(news_items)').all();
  const col = cols.find(c => c.name === 'image');
  assert.ok(col, 'image column');
  assert.equal(col.notnull, 1);
  assert.equal(db.prepare('SELECT image FROM news_items WHERE id=?').get(ids[0]).image, '');
  assert.equal(db.prepare('SELECT COUNT(*) c FROM schema_migrations WHERE version=401').get().c, 1);
  // the runner again: nothing left to apply
  const { runMigrations } = await import('../../src/db/migrate.js');
  await runMigrations(db, { log: () => {} });
  assert.equal(db.prepare('PRAGMA table_info(news_items)').all().filter(c => c.name === 'image').length, 1);
  // up() itself is guarded: a second call on a scratch db does not throw
  const m = await import('../../src/db/migrations/401_news_image.js');
  assert.equal(m.version, 401);
  const mem = new Database(':memory:');
  mem.exec("CREATE TABLE news_items (id INTEGER PRIMARY KEY, title_en TEXT NOT NULL DEFAULT '')");
  const ctx = { hasColumn: (tb, c) => mem.prepare(`PRAGMA table_info(${tb})`).all().some(x => x.name === c) };
  m.up(mem, ctx);
  m.up(mem, ctx);
  mem.prepare('INSERT INTO news_items (title_en) VALUES (?)').run('x');
  assert.equal(mem.prepare('SELECT image FROM news_items').get().image, '');
  mem.close();
});

test('nothing published: the slot renders nothing and the home page has no #news-feed', async () => {
  assert.equal(slot.renderSlot('fa'), '');
  assert.equal(slot.renderSlot('en'), '');
  const { text } = await page('/fa/');
  assert.ok(text.includes('id="contact"'), 'home rendered from the runtime template');
  assert.ok(!text.includes('id="news-feed"') && !text.includes('{{SLOT_NEWS_FEED}}') && !text.includes('news-feed.js'));
});

test('admin PUT image: round trip, clearing, and bad values → 422', async () => {
  const id = ids[4];
  let r = await admin(`/news/items/${id}`, { method: 'PUT', body: { image: '/uploads/2026/09/cover-one.jpg' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.item.image, '/uploads/2026/09/cover-one.jpg');
  r = await admin(`/news/items/${id}`);
  assert.equal(r.body.item.image, '/uploads/2026/09/cover-one.jpg');
  r = await admin(`/news/items/${id}`, { method: 'PUT', body: { image: 'https://cdn.example.com/a/b.webp' } });
  assert.equal(r.status, 200);
  assert.equal(r.body.item.image, 'https://cdn.example.com/a/b.webp');
  r = await admin(`/news/items/${id}`, { method: 'PUT', body: { image: '' } });
  assert.equal(r.status, 200);
  assert.equal(r.body.item.image, '');
  for (const bad of ['javascript:alert(1)', 'http://cdn.example.com/a.jpg', '//evil.example/a.jpg', '/\\evil.example/a.jpg',
    'uploads/a.jpg', '/uploads/a b.jpg', '/uploads/a".jpg', 'data:image/png;base64,AAAA', `/uploads/${'a'.repeat(2050)}.jpg`, ['/uploads/a.jpg']]) {
    r = await admin(`/news/items/${id}`, { method: 'PUT', body: { image: bad } });
    assert.equal(r.status, 422, `rejects ${String(bad).slice(0, 40)}`);
    assert.ok(r.body.fields?.image, `field error for ${String(bad).slice(0, 40)}`);
  }
  assert.equal(db.prepare('SELECT image FROM news_items WHERE id=?').get(id).image, '', 'nothing stored by the refused writes');
  // the view sends image with its full edit shape
  r = await admin(`/news/items/${id}`, { method: 'PUT', body: { ...brief(5).fields, importance: undefined, tags: ['agents'], image: '/uploads/2026/09/owner.jpg' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.item.image, '/uploads/2026/09/owner.jpg');
});

test('12 published: the slot shows the 10 newest in order, one link each, escaped, image or seeded cover', async () => {
  for (const id of ids) assert.equal((await t.fetchAdmin(`/news/items/${id}/publish`, { method: 'POST', body: {} })).status, 200);
  // distinct publish times: ids[11] newest … ids[0] oldest; ids[3] is made the newest of all
  ids.forEach((id, i) => db.prepare("UPDATE news_items SET published_at=datetime('now', ?) WHERE id=?").run(`-${(12 - i) * 10} minutes`, id));
  db.prepare("UPDATE news_items SET published_at=datetime('now', '-1 minutes') WHERE id=?").run(ids[3]);
  const expected = db.prepare("SELECT id, slug FROM news_items WHERE status='published' ORDER BY published_at DESC, id DESC LIMIT 10").all();
  assert.equal(expected[0].id, ids[3]);
  assert.ok(!expected.some(r => r.id === ids[0] || r.id === ids[1]), 'the two oldest are left out');

  for (const lang of ['fa', 'en']) {
    const html = slot.renderSlot(lang);
    assert.equal((html.match(/<section id="news-feed" class="light" data-phase="3" aria-roledescription="carousel" aria-labelledby="nf-h"/g) || []).length, 1, lang);
    assert.equal((html.match(/class="nf-slide" role="group" aria-roledescription="slide"/g) || []).length, 10, lang);
    assert.deepEqual(hrefs(html), expected.map(r => `/${lang}/news/${r.slug}`), `${lang}: newest first, one link per card`);
    assert.equal((html.match(/<a\b/g) || []).length, 11, `${lang}: 10 cards + «all news»`);
    assert.ok(html.includes(`href="/${lang}/news"`), `${lang}: all-news link`);
    assert.ok(html.includes('<span class="eyebrow mono rv d1" dir="ltr">[ SYSAIQ—NEWSROOM / SYS.07 ]</span>'));
    // escaped titles / summaries
    assert.ok(!/<script>alert|<img src=x|<b>bold/.test(html), `${lang}: nothing unescaped`);
    // owner image for ids[4], seeded brand covers for the rest; never a source image
    assert.ok(html.includes('<img src="/uploads/2026/09/owner.jpg" alt="" loading="lazy" decoding="async">'), `${lang}: uploaded image`);
    assert.equal((html.match(/<img\b/g) || []).length, 1, `${lang}: only the owner's image`);
    assert.ok(!html.includes('lab.example'), `${lang}: no source link or image`);
    assert.equal((html.match(/class="nw-cover nw-c-[a-z]+ nw-cover-v"/g) || []).length, 9, `${lang}: 9 generated covers`);
    // the progressive-enhancement assets, cache-busted by content
    const v = f => createHash('sha256').update(readFileSync(join(VESPER, 'assets', 'site', f))).digest('hex').slice(0, 10);
    assert.ok(html.startsWith(`<link rel="stylesheet" href="/assets/site/news-feed.css?v=${v('news-feed.css')}">`), lang);
    assert.ok(html.endsWith(`<script src="/assets/site/news-feed.js?v=${v('news-feed.js')}" defer></script>`), lang);
    assert.equal((html.match(/<script\b/g) || []).length, 1, `${lang}: the one external script, no inline one`);
    assert.ok(!/<[^>]+\son[a-z]+=/i.test(html), `${lang}: no inline handlers`);
    assert.ok(/<div class="nf-ctrl" hidden>/.test(html), `${lang}: controls wait for the script`);
  }
  const fa = slot.renderSlot('fa');
  assert.ok(fa.includes('آخرین خبرهای <em>هوش مصنوعی</em> و فناوری'));
  assert.ok(fa.includes('عنوان &lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(fa.includes('ادامهٔ خبر <span class="nf-arrow" aria-hidden="true">←</span>'));
  assert.ok(fa.includes('aria-label="۱ از ۱۰"') && fa.includes('aria-label="۱۰ از ۱۰"'), 'slide labels in Persian digits');
  assert.match(fa, /<time datetime="[^"]+">[۰-۹]+ [^<]+ [۰-۹]{4}<\/time>/, 'Jalali date, Persian digits');
  const en = slot.renderSlot('en');
  assert.ok(en.includes('Latest in <em>AI</em> &amp; technology'));
  assert.ok(en.includes('&lt;script&gt;alert(1)&lt;/script&gt; Evil &amp; co'));
  assert.ok(en.includes('Sum &quot;quoted&quot; &lt;b&gt;bold&lt;/b&gt;'));
  assert.ok(en.includes('Read more <span class="nf-arrow" aria-hidden="true">→</span>'));
  assert.ok(en.includes('aria-label="1 of 10"'));
  assert.match(en, /<time datetime="[^"]+">\d{1,2} [A-Z][a-z]+ \d{4}<\/time>/, 'Gregorian date');
  assert.ok(!en.includes('ادامهٔ خبر'));
});

test('covers: deterministic per item, different between items, unique SVG ids', () => {
  const html = slot.renderSlot('en');
  assert.equal(html, slot.renderSlot('en'), 'same input → same bytes (cacheable)');
  const covers = [...html.matchAll(/<svg viewBox="0 0 400 225"[^>]*>([\s\S]*?)<\/svg>/g)].map(m => m[1]);
  assert.equal(covers.length, 9);
  assert.equal(new Set(covers).size, 9, 'every item gets its own composition');
  const svgIds = [...html.matchAll(/ id="(nwv[^"]+)"/g)].map(m => m[1]);
  assert.equal(new Set(svgIds).size, svgIds.length, 'gradient ids unique on the page');
  for (const c of covers) for (const [, ref] of c.matchAll(/url\(#([^)]+)\)/g)) assert.ok(c.includes(`id="${ref}"`), `local ref ${ref}`);
});

test('home page: #news-feed right after the FAQ, next to the untouched #news block; assets served', async () => {
  db.prepare('INSERT INTO faqs (q_en, q_fa, a_en, a_fa, sort, published, show_on_home) VALUES (?,?,?,?,?,?,?)').run('Q?', 'پرسش؟', 'A.', 'پاسخ.', 1, 1, 1);
  cache.invalidate('home:');
  for (const lang of ['fa', 'en']) {
    const { status, text, headers } = await page(`/${lang}/`);
    assert.equal(status, 200);
    assert.equal((text.match(/id="news-feed"/g) || []).length, 1, lang);
    assert.equal((text.match(/<section id="news" class="solid"/g) || []).length, 1, `${lang}: the #news block still renders`);
    const [work, news, faq, feed, contact] = ['id="work"', 'id="news"', 'id="faq"', 'id="news-feed"', 'id="contact"'].map(s => text.indexOf(s));
    assert.ok(work < news && news < faq && faq < feed && feed < contact, `${lang}: work → news → faq → news-feed → contact`);
    const faqEnd = text.indexOf('</section>', faq) + '</section>'.length;
    assert.equal(text.slice(faqEnd, text.indexOf('<link rel="stylesheet" href="/assets/site/news-feed.css', faqEnd)).trim(), '', `${lang}: nothing between the FAQ and the feed`);
    assert.ok(!text.includes('{{SLOT_'), lang);
    const csp = headers.get('content-security-policy') || '';
    if (csp) assert.match(csp, /script-src 'self'/, `${lang}: the external script is allowed by the home CSP`);
  }
  const js = await fetch(`${t.base}/assets/site/news-feed.js`);
  assert.equal(js.status, 200);
  assert.match(js.headers.get('content-type') || '', /javascript/);
  const src = await js.text();
  assert.ok(src.includes("getElementById('news-feed')") && !/innerHTML|eval\(|new Function/.test(src));
  const css = await fetch(`${t.base}/assets/site/news-feed.css`);
  assert.equal(css.status, 200);
  assert.match(css.headers.get('content-type') || '', /text\/css/);
  assert.ok((await css.text()).includes('#news-feed .nf-track'));
});

test('news pages use the uploaded image when set, the brand cover otherwise', async () => {
  const withImg = slugOf(ids[4]);
  const plain = slugOf(ids[5]);
  const art = await page(`/en/news/${withImg}`);
  assert.equal(art.status, 200);
  assert.ok(art.text.includes('<div class="nw-cover nw-c-') && art.text.includes('nw-cover-img nw-cover-lg"'), 'hero uses the image cover');
  assert.ok(art.text.includes('<img src="/uploads/2026/09/owner.jpg" alt="" fetchpriority="high" decoding="async">'));
  assert.ok(art.text.includes(`"image":["${'http'}`) && art.text.includes('/uploads/2026/09/owner.jpg"]'), 'NewsArticle JSON-LD image');
  assert.ok(art.text.includes('.nw-cover-img img{'), 'image-cover rules shipped with the page');
  const other = await page(`/en/news/${plain}`);
  assert.ok(!/<img\b[^>]*uploads/.test(other.text) && other.text.includes('nw-cover-lg" aria-hidden="true">\n    <svg'), 'default brand cover');
  const list = await page('/fa/news');
  assert.ok(list.text.includes('<img src="/uploads/2026/09/owner.jpg" alt="" loading="lazy" decoding="async">'), 'list card');
  assert.equal((list.text.match(/<img\b[^>]*(uploads|lab\.example)/g) || []).length, 1, 'only the owner image on the list');
  // a hand-edited bad value never reaches the page
  db.prepare('UPDATE news_items SET image=? WHERE id=?').run('javascript:alert(1)', ids[5]);
  cache.invalidate();
  assert.ok(!(await page(`/en/news/${plain}`)).text.includes('javascript:alert'));
  assert.ok(!slot.renderSlot('en').includes('javascript:alert'));
});

test('unpublishing everything removes the feed again', async () => {
  for (const id of ids) assert.equal((await t.fetchAdmin(`/news/items/${id}/restore`, { method: 'POST', body: {} })).status, 200);
  assert.equal(slot.renderSlot('fa'), '');
  assert.ok(!(await page('/fa/')).text.includes('id="news-feed"'));
});
