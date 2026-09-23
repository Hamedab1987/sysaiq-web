// Projects redesign: /:lang/work (featured + category filter + cinematic
// cards) and /:lang/work/:slug (story «مسئله → راه‌حل → نتیجه», gallery +
// lightbox dialog, related, prev/next, facts, JSON-LD, SEO overrides), plus
// the admin API for the migration-013 columns.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp } from '../helpers.js';

let t;
const ids = {};
const post = body => t.fetchAdmin('/projects', { method: 'POST', body });
const get = async path => { const r = await fetch(t.base + path); return { r, html: await r.text() }; };
const ldBlocks = html => [...html.matchAll(/<script type="application\/ld\+json">([^]*?)<\/script>/g)].map(m => JSON.parse(m[1]));

before(async () => {
  t = await startTestApp();
  await t.loginAsAdmin();
  const fixtures = [
    {
      slug: 'accounting', title_en: 'Accounting & Finance System', title_fa: 'سیستم حسابداری و مالی',
      tags: 'ACCOUNTING · LEDGER', image: '/assets/projects/accounting-cover.jpg',
      cover_en: '/assets/projects/accounting-full.jpg', cover_fa: '/assets/projects/accounting-fa-full.jpg',
      tagline_en: 'Ledger and reports on one screen.', tagline_fa: 'دفتر کل و گزارش‌ها روی یک صفحه.',
      overview_en: 'A double-entry accounting system.', overview_fa: 'یک سیستم حسابداری دوطرفه.',
      category: 'finance-trading', service_slug: 'accounting-systems',
      problem_en: 'Books kept in **three** spreadsheets.', problem_fa: 'دفترها در **سه** صفحه‌گسترده نگه داشته می‌شد.',
      solution_en: '- One ledger\n- One report', solution_fa: '- یک دفتر کل\n- یک گزارش',
      outcome_en: 'Month-end close is calmer.', outcome_fa: 'بستن ماه آرام‌تر شده است.',
      tech_en: '- **Node.js / Express** API', tech_fa: '- API روی **Node.js / Express**',
      gallery: [
        { image: '/assets/projects/accounting-full.jpg', caption_en: 'Ledger (English UI)', caption_fa: 'دفتر کل (رابط انگلیسی)' },
        { image: '/assets/projects/accounting-fa-full.jpg', caption_en: 'Persian UI', caption_fa: 'رابط فارسی' },
      ],
      industries: [{ en: 'Retail', fa: 'خرده‌فروشی' }, { en: 'Services', fa: 'خدمات' }],
      features: [{ title_en: 'Auto reconciliation', title_fa: 'مغایرت‌گیری خودکار', desc_en: 'Matches bank lines.', desc_fa: 'ردیف‌های بانک را تطبیق می‌دهد.' }],
      pages: [{ name_en: 'Dashboard', name_fa: 'داشبورد', desc_en: 'Cash position.', desc_fa: 'وضعیت نقدینگی.' }],
      seo_title_en: 'Accounting System — SysaiQ', seo_title_fa: 'سیستم حسابداری — SysaiQ',
      seo_desc_en: 'An accounting system built by SysaiQ.', seo_desc_fa: 'سیستم حسابداری ساختهٔ SysaiQ.',
      published: true, sort: 1,
    },
    {
      slug: 'trading', title_en: 'Trading Workstation', title_fa: 'میز معاملاتی', tags: 'QUANT · PYTHON',
      image: '/assets/projects/trading-cover.jpg', cover_en: '/assets/projects/trading-full.jpg',
      tagline_en: 'Charts and backtests.', tagline_fa: 'نمودار و بک‌تست.',
      category: 'finance-trading', service_slug: 'trading-systems',
      problem_en: 'Research lived in notebooks.', problem_fa: 'پژوهش در دفترچه‌ها پراکنده بود.',
      gallery: [{ image: '/assets/projects/trading-full.jpg', caption_en: 'Chart workspace', caption_fa: 'میز نمودار' }],
      published: true, sort: 2,
    },
    {
      slug: 'law-landing', title_en: 'Law Firm Landing', title_fa: 'لندینگ دفتر حقوقی', tags: 'LANDING · RTL',
      image: '/assets/projects/law-landing-cover.jpg', tagline_en: 'A calm first impression.', tagline_fa: 'اولین برداشت آرام.',
      category: 'profession-landing', published: true, sort: 3,
    },
    { slug: 'shop', title_en: 'Shop', title_fa: 'فروشگاه', tagline_en: 'A shop.', tagline_fa: 'یک فروشگاه.', published: true, sort: 4 },
    { slug: 'hidden', title_en: 'Hidden', title_fa: 'پنهان', category: 'finance-trading', published: false, sort: 0 },
  ];
  for (const f of fixtures) {
    const r = await post(f);
    assert.equal(r.status, 200, `${f.slug}: ${await r.clone().text()}`);
    ids[f.slug] = (await r.json()).id;
  }
  // publish the accounting service so the related-service link can appear
  const svc = (await (await t.fetchAdmin('/services')).json()).find(s => s.slug === 'accounting-systems');
  const pub = await t.fetchAdmin(`/services/${svc.id}`, { method: 'PUT', body: { published: true } });
  assert.equal(pub.status, 200, await pub.clone().text());
});
after(async () => { await t.close(); });

test('index: featured first, data-category on every card, filter chips with counts, assets + ItemList', async () => {
  const { r, html } = await get('/fa/work');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-security-policy'), /script-src 'self'/);
  // work.css + work.js through the layout head hook; no inline executable script
  assert.match(html, /<link rel="stylesheet" href="\/assets\/site\/work\.css\?v=[\w]+">/);
  assert.match(html, /<script src="\/assets\/site\/work\.js\?v=[\w]+" defer><\/script>/);
  for (const m of html.matchAll(/<script(?![^>]*\bsrc=)([^>]*)>/g)) assert.match(m[1], /type="application\/ld\+json"/);

  const items = [...html.matchAll(/<li class="w-item([^"]*)" data-category="([^"]*)"(\s+data-featured)?>\s*<a class="w-card" href="\/fa\/work\/([^"]+)"/g)]
    .map(m => ({ cls: m[1], cat: m[2], featured: !!m[3], slug: m[4] }));
  assert.deepEqual(items.map(i => i.slug), ['accounting', 'trading', 'law-landing', 'shop'], 'published only, by sort');
  assert.deepEqual(items.map(i => i.featured), [true, false, false, false]);
  assert.ok(items[0].cls.includes('is-featured'));
  assert.deepEqual(items.map(i => i.cat), ['finance-trading', 'finance-trading', 'profession-landing', '']);
  assert.ok(!html.includes('/fa/work/hidden'));
  // featured uses the Persian cover and loads eagerly; the rest lazily
  assert.match(html, /<img src="\/assets\/projects\/accounting-fa-full\.jpg" alt="" width="1600" height="900" decoding="async" fetchpriority="high">/);
  assert.match(html, /<img src="\/assets\/projects\/trading-cover\.jpg" alt="" [^>]*loading="lazy">/);
  // Persian digits in the mono index, tags stay an LTR island
  assert.ok(html.includes('<span class="w-idx">[ ۰۱ ]</span>'));
  assert.ok(html.includes('<span class="mono" dir="ltr">ACCOUNTING · LEDGER</span>'));

  // chips: all + the two categories that have members, Persian labels and digits
  assert.ok(html.includes('data-work-filter'));
  assert.ok(html.includes('<button type="button" class="w-chip" data-filter="all" aria-pressed="true">همه <span class="w-count">۴</span></button>'));
  assert.ok(html.includes('data-filter="finance-trading" aria-pressed="false">مالی و معاملاتی <span class="w-count">۲</span>'));
  assert.ok(html.includes('data-filter="profession-landing" aria-pressed="false">لندینگ مشاغل <span class="w-count">۱</span>'));
  assert.ok(!html.includes('data-filter="ai-automation"'), 'a category without projects gets no chip');
  assert.ok(html.includes('data-count-many="{n} پروژه"'));

  const ld = ldBlocks(html);
  const list = ld.find(x => x['@type'] === 'ItemList');
  assert.deepEqual(list.itemListElement.map(x => x.url), ['accounting', 'trading', 'law-landing', 'shop'].map(s => `${t.base}/fa/work/${s}`));
  assert.ok(ld.some(x => x['@type'] === 'BreadcrumbList'));
  assert.ok(html.includes(`<meta property="og:image" content="${t.base}/assets/projects/accounting-fa-full.jpg">`));

  const en = (await get('/en/work')).html;
  assert.ok(en.includes('data-filter="finance-trading" aria-pressed="false">Finance &amp; trading <span class="w-count">2</span>'));
  assert.ok(en.includes('<span class="w-idx mono" dir="ltr">[ 01 ]</span>'));
  assert.ok(en.includes('<img src="/assets/projects/accounting-full.jpg" alt=""'), 'en featured uses the English cover');
});

test('detail: story, facts, gallery + dialog, related, prev/next, CTA, SEO overrides and JSON-LD', async () => {
  const { r, html } = await get('/fa/work/accounting');
  assert.equal(r.status, 200);
  assert.ok(html.includes('<title>سیستم حسابداری — SysaiQ</title>'), 'seo title, "— SysaiQ" appended once');
  assert.ok(html.includes('<meta name="description" content="سیستم حسابداری ساختهٔ SysaiQ.">'));
  assert.ok(html.includes('<h1>سیستم حسابداری و مالی</h1>'));
  assert.ok(html.includes('src="/assets/projects/accounting-fa-full.jpg" alt="سیستم حسابداری و مالی UI"'));
  assert.ok(!html.includes('w-cover__badge'), 'a Persian cover needs no "English UI" badge');
  assert.ok(html.includes('<p class="lead">یک سیستم حسابداری دوطرفه.</p>'));

  // the three beats in order, numbered with Persian digits, markdown rendered
  const order = ['id="problem"', 'id="solution"', 'id="outcome"'].map(s => html.indexOf(s));
  assert.ok(order.every(i => i > 0) && order[0] < order[1] && order[1] < order[2], 'problem → solution → outcome');
  assert.ok(html.includes('<h2 id="problem-h">مسئله</h2>') && html.includes('<h2 id="solution-h">راه‌حل</h2>') && html.includes('<h2 id="outcome-h">نتیجه</h2>'));
  assert.ok(html.includes('<span class="w-beat__n" aria-hidden="true">۰۱</span>'));
  assert.ok(html.includes('<strong>سه</strong>'));
  assert.ok(html.includes('<li>یک دفتر کل</li>'));
  assert.ok(html.includes('id="tech-h">رویکرد فنی</h2>') && html.includes('<strong>Node.js / Express</strong>'));

  // facts: category (links to the filtered index), the published service, industries count, languages
  assert.ok(html.includes('<dt>دسته</dt><dd><a href="/fa/work?cat=finance-trading">مالی و معاملاتی</a></dd>'));
  assert.match(html, /<dt>خدمت مرتبط<\/dt><dd><a href="\/fa\/services\/accounting-systems">[^<]+<\/a><\/dd>/);
  assert.ok(html.includes('<dt>صنایع هدف</dt><dd>۲ صنعت</dd>'));
  assert.ok(html.includes('<dt>زبان‌ها</dt>'), 'a Persian screenshot is evidence of a bilingual UI');
  assert.ok(html.includes('<a class="w-svc" href="/fa/services/accounting-systems">'));

  // features / screens / industries keep their content
  assert.ok(html.includes('<h3>مغایرت‌گیری خودکار</h3>') && html.includes('<p>ردیف‌های بانک را تطبیق می‌دهد.</p>'));
  assert.ok(html.includes('<div class="pn">داشبورد</div>') && html.includes('<div class="pd">وضعیت نقدینگی.</div>'));
  assert.ok(html.includes('<span class="chip">خرده‌فروشی</span><span class="chip">خدمات</span>'));

  // gallery: real links (work without JS), indices for the lightbox, an empty <dialog>
  const links = [...html.matchAll(/<a class="w-gal__link" href="([^"]+)" data-gal-index="(\d+)" data-caption="([^"]*)"/g)];
  assert.deepEqual(links.map(m => [m[1], m[2], m[3]]), [
    ['/assets/projects/accounting-full.jpg', '0', 'دفتر کل (رابط انگلیسی)'],
    ['/assets/projects/accounting-fa-full.jpg', '1', 'رابط فارسی'],
  ]);
  assert.ok(html.includes('<dialog class="w-lb" data-lightbox-dialog aria-label="نمایش تصویر">'));
  assert.ok(html.includes('data-lb-prev aria-label="تصویر قبلی"><span aria-hidden="true">→</span>'), 'RTL: "previous" points right');
  assert.ok(html.includes('data-lb-next aria-label="تصویر بعدی"><span aria-hidden="true">←</span>'));
  assert.ok(!/<div class="w-lb__bar" hidden>/.test(html), 'two images → prev/next visible');

  // related = same category only; prev/next by sort (first project: no prev)
  const related = html.slice(html.indexOf('id="related"'), html.indexOf('class="w-pager"'));
  assert.ok(related.includes('href="/fa/work/trading"') && !related.includes('law-landing') && !related.includes('/fa/work/accounting"'));
  assert.ok(!html.includes('rel="prev"'));
  assert.match(html, /<a class="w-pager__link w-pager__next" href="\/fa\/work\/trading" rel="next">/);
  assert.ok(html.includes('<h2>پروژه‌ای مشابه می‌خواهید؟</h2>') && html.includes('href="/fa/#contact">شروع پروژه</a>'));

  const ld = ldBlocks(html);
  const org = ld.find(x => x['@type'] === 'ProfessionalService');
  const cw = ld.find(x => x['@type'] === 'CreativeWork');
  assert.equal(cw.name, 'سیستم حسابداری و مالی');
  assert.equal(cw.description, 'سیستم حسابداری ساختهٔ SysaiQ.');
  assert.equal(cw.url, `${t.base}/fa/work/accounting`);
  assert.deepEqual(cw.image, [`${t.base}/assets/projects/accounting-fa-full.jpg`, `${t.base}/assets/projects/accounting-full.jpg`]);
  assert.equal(cw.genre, 'مالی و معاملاتی');
  assert.deepEqual(cw.creator, { '@id': org['@id'] });
  const crumbs = ld.find(x => x['@type'] === 'BreadcrumbList');
  assert.deepEqual(crumbs.itemListElement.map(x => x.item), [`${t.base}/fa/`, `${t.base}/fa/work`, `${t.base}/fa/work/accounting`]);
});

test('detail: empty beats omitted, one-image gallery, unpublished service not linked, English page', async () => {
  const { r, html } = await get('/en/work/trading');
  assert.equal(r.status, 200);
  assert.ok(html.includes('id="problem"') && html.includes('<h2 id="problem-h">The problem</h2>'));
  assert.ok(!html.includes('id="solution"') && !html.includes('id="outcome"') && !html.includes('id="tech"'), 'empty beats are omitted');
  assert.ok(html.includes('<span class="w-beat__n" aria-hidden="true">01</span>'));
  assert.ok(html.includes('<ul class="w-gal is-single" data-gallery>') && html.includes('<div class="w-lb__bar" hidden>'));
  assert.ok(!html.includes('/en/services/trading-systems'), 'the trading service is not published');
  assert.ok(!html.includes('<dt>Languages</dt>'), 'no evidence of a Persian UI → the fact is omitted, never guessed');
  assert.ok(!html.includes('id="features"') && !html.includes('id="screens"') && !html.includes('id="overview"'));
  assert.ok(html.includes('<title>Trading Workstation — SysaiQ</title>'), 'falls back to the title');
  assert.ok(html.includes('<meta name="description" content="Charts and backtests.">'), 'falls back to the tagline');
  assert.match(html, /<a class="w-pager__link w-pager__prev" href="\/en\/work\/accounting" rel="prev">/);
  assert.match(html, /<a class="w-pager__link w-pager__next" href="\/en\/work\/law-landing" rel="next">/);
  assert.ok(html.includes('data-lb-next aria-label="Next image"><span aria-hidden="true">→</span>'));
  const cw = ldBlocks(html).find(x => x['@type'] === 'CreativeWork');
  assert.equal(cw.image, `${t.base}/assets/projects/trading-full.jpg`, 'one image → a plain URL');
  assert.equal(cw.keywords, 'QUANT, PYTHON');

  // Persian page with an English-only screenshot says so on the cover
  const fa = (await get('/fa/work/trading')).html;
  assert.ok(fa.includes('<figcaption class="w-cover__badge">تصویر: رابط انگلیسی</figcaption>'));
  // a landing whose tags name RTL is shown as bilingual
  assert.ok((await get('/fa/work/law-landing')).html.includes('<dt>زبان‌ها</dt>'));
  // no category → no related section, no category fact
  const shop = (await get('/fa/work/shop')).html;
  assert.ok(!shop.includes('id="related"') && !shop.includes('<dt>دسته</dt>'));
  assert.equal((await get('/fa/work/hidden')).r.status, 404);
});

test('markdown and plain fields are escape-first; unsafe image URLs never render', async () => {
  const evil = '<script>alert(1)</script> <img src=x onerror=alert(1)> [x](javascript:alert(1)) **ok**';
  const put = await t.fetchAdmin(`/projects/${ids.shop}`, {
    method: 'PUT',
    body: { slug: 'shop', title_en: 'Shop <b>x</b>', title_fa: 'فروشگاه <i>x</i>', tagline_fa: '"quoted" <em>', published: true, sort: 4, problem_fa: evil, outcome_fa: evil, tech_fa: evil },
  });
  assert.equal(put.status, 200, await put.clone().text());
  const { html } = await get('/fa/work/shop');
  assert.ok(!html.includes('<script>alert') && !html.includes('<img src=x') && !/href="javascript:/i.test(html));
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(html.includes('<strong>ok</strong>'));
  assert.ok(html.includes('<h1>فروشگاه &lt;i&gt;x&lt;/i&gt;</h1>'));
  assert.ok(html.includes('<p class="tagline">&quot;quoted&quot; &lt;em&gt;</p>'));

  // a row written behind the API's back (old data, direct SQL) still cannot inject an image URL
  const { db } = await import('../../src/db/index.js');
  const { invalidate } = await import('../../src/lib/cache.js');
  db.prepare('UPDATE projects SET gallery=?, cover_fa=?, cover_en=?, image=? WHERE id=?').run(JSON.stringify([
    { image: 'javascript:alert(1)' }, { image: '//evil.example/x.jpg' }, { image: '/\\evil.example/x.jpg' }, { image: '/assets/ok.jpg" onerror="x' },
    { image: '../assets/projects/shop-full.jpg', caption_fa: 'قدیمی' },
  ]), 'javascript:alert(1)', 'http://plain.example/x.jpg', '//evil.example/y.jpg', ids.shop);
  invalidate();
  const again = (await get('/fa/work/shop')).html;
  assert.ok(!again.includes('evil.example') && !again.includes('plain.example') && !again.includes('/assets/ok.jpg'));
  assert.ok(!/(?:src|href)="javascript:/i.test(again));
  assert.ok(again.includes('href="/assets/projects/shop-full.jpg" data-gal-index="0"'), 'the seed\'s ../assets/ path is made site-absolute');
  assert.ok(!again.includes('class="w-cover"'), 'no safe cover → no hero image');
});

test('admin: PUT round-trips the story columns; a legacy PUT keeps them; validation → 422', async () => {
  const id = ids.trading;
  const body = {
    slug: 'trading', title_en: 'Trading Workstation', title_fa: 'میز معاملاتی', published: true, sort: 2,
    category: 'ai-automation', service_slug: 'automation',
    problem_en: 'P', problem_fa: 'م', solution_en: 'S', solution_fa: 'ر', outcome_en: 'O', outcome_fa: 'ن', tech_en: 'T', tech_fa: 'ف',
    gallery: [{ image: 'https://cdn.example.com/a.jpg', caption_en: 'A', caption_fa: 'الف', extra: 'dropped' }, { image: '/uploads/b.png' }],
    seo_title_en: 'ST', seo_title_fa: 'عس', seo_desc_en: 'SD', seo_desc_fa: 'تم', show_on_home: true,
  };
  const r = await t.fetchAdmin(`/projects/${id}`, { method: 'PUT', body });
  assert.equal(r.status, 200, await r.clone().text());
  const row = (await (await t.fetchAdmin('/projects')).json()).find(p => p.id === id);
  for (const k of ['category', 'service_slug', 'problem_en', 'problem_fa', 'solution_en', 'solution_fa', 'outcome_en', 'outcome_fa', 'tech_en', 'tech_fa', 'seo_title_en', 'seo_title_fa', 'seo_desc_en', 'seo_desc_fa']) {
    assert.equal(row[k], body[k], k);
  }
  assert.equal(row.show_on_home, 1);
  assert.deepEqual(JSON.parse(row.gallery), [
    { image: 'https://cdn.example.com/a.jpg', caption_en: 'A', caption_fa: 'الف' },
    { image: '/uploads/b.png', caption_en: '', caption_fa: '' },
  ]);
  // the public page follows (cache invalidated by the admin write)
  const page = (await get('/fa/work/trading')).html;
  assert.ok(page.includes('href="https://cdn.example.com/a.jpg" data-gal-index="0"'));
  assert.ok(page.includes('<title>عس — SysaiQ</title>'));

  // an old client that knows nothing of the story columns cannot wipe them
  const legacy = await t.fetchAdmin(`/projects/${id}`, { method: 'PUT', body: { slug: 'trading', title_en: 'Trading Workstation', title_fa: 'میز معاملاتی', published: true, sort: 2 } });
  assert.equal(legacy.status, 200);
  const kept = (await (await t.fetchAdmin('/projects')).json()).find(p => p.id === id);
  assert.equal(kept.problem_fa, 'م');
  assert.equal(kept.category, 'ai-automation');
  assert.equal(kept.show_on_home, 1);
  assert.equal(JSON.parse(kept.gallery).length, 2);
  // clearing is explicit
  await t.fetchAdmin(`/projects/${id}`, { method: 'PUT', body: { slug: 'trading', title_en: 'Trading Workstation', published: true, category: '', gallery: [], show_on_home: false } });
  const cleared = (await (await t.fetchAdmin('/projects')).json()).find(p => p.id === id);
  assert.equal(cleared.category, '');
  assert.equal(cleared.gallery, '[]');
  assert.equal(cleared.show_on_home, 0);

  const expect422 = async (b, ...fields) => {
    const res = await t.fetchAdmin(`/projects/${id}`, { method: 'PUT', body: { title_en: 'x', ...b } });
    assert.equal(res.status, 422, JSON.stringify(b));
    const j = await res.json();
    for (const f of fields) assert.ok(j.fields?.[f], `${f} in ${JSON.stringify(j.fields)}`);
    return j;
  };
  await expect422({ category: 'crypto' }, 'category');
  await expect422({ service_slug: 'seo' }, 'service_slug');
  await expect422({ gallery: Array.from({ length: 13 }, () => ({ image: '/a.jpg' })) }, 'gallery');
  await expect422({ gallery: [{ image: 'javascript:alert(1)' }] }, 'gallery[0].image');
  await expect422({ gallery: [{ caption_en: 'no image' }] }, 'gallery[0].image');
  await expect422({ gallery: [{ image: '//evil.example/x.jpg' }] }, 'gallery[0].image');
  await expect422({ gallery: [{ image: '/\\evil.example/x.jpg' }] }, 'gallery[0].image');
  await expect422({ gallery: [{ image: 'http://plain.example/x.jpg' }] }, 'gallery[0].image');
  await expect422({ gallery: [{ image: '/a.jpg', caption_fa: 'x'.repeat(301) }] }, 'gallery[0].caption_fa');
  await expect422({ gallery: 'not json' }, 'gallery');
  await expect422({ problem_fa: 'x'.repeat(20001) }, 'problem_fa');
  await expect422({ seo_desc_en: 'x'.repeat(321) }, 'seo_desc_en');
  // base + story problems are reported together; nothing is stored
  const j = await expect422({ sort: 'x', category: 'nope' }, 'sort', 'category');
  assert.equal(Object.keys(j.fields).length, 2);
  assert.equal((await (await t.fetchAdmin('/projects')).json()).find(p => p.id === id).title_en, 'Trading Workstation');
  // POST validates the same way; a missing row is a 404
  assert.equal((await post({ title_en: 'Bad', category: 'nope' })).status, 422);
  assert.equal((await t.fetchAdmin('/projects/999999', { method: 'PUT', body: { title_en: 'x' } })).status, 404);
  // a POST with the new fields stores them (defaults for the rest)
  const created = await post({ title_en: 'New One', category: 'ai-automation', problem_en: 'Hello' });
  assert.equal(created.status, 200);
  const newId = (await created.json()).id;
  const nr = (await (await t.fetchAdmin('/projects')).json()).find(p => p.id === newId);
  assert.equal(nr.category, 'ai-automation');
  assert.equal(nr.problem_en, 'Hello');
  assert.equal(nr.gallery, '[]');
  assert.equal(nr.show_on_home, 0);
});
