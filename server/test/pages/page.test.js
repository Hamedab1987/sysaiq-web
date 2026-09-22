// Pages: shared layout (hreflang / canonical / nav / footer), a published
// page renders its markdown safely and with {{site.*}} tokens, unpublished →
// 404 (via next), reserved slugs refused, system pages protected, preview.
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

const get = async p => { const r = await fetch(t.base + p); return { r, html: await r.text() }; };

test('layout: lang/dir, canonical, hreflang en/fa/x-default, nav, language switch, footer, assets, no inline script', async () => {
  const { r, html } = await get('/fa/work');
  assert.equal(r.status, 200);
  assert.match(html, /^<!DOCTYPE html>\n<html lang="fa" dir="rtl">/);
  assert.ok(html.includes(`<link rel="canonical" href="${t.base}/fa/work">`));
  assert.ok(html.includes(`<link rel="alternate" hreflang="fa" href="${t.base}/fa/work">`));
  assert.ok(html.includes(`<link rel="alternate" hreflang="en" href="${t.base}/en/work">`));
  assert.ok(html.includes(`<link rel="alternate" hreflang="x-default" href="${t.base}/fa/work">`));
  assert.ok(html.includes('<link rel="stylesheet" href="/assets/site/pages.css?v='));
  assert.ok(html.includes('<script src="/assets/site/pages.js?v=') && html.includes('" defer></script>'));
  assert.ok(html.includes("@font-face{font-family:'Vazirmatn'"), 'fa loads Vazirmatn');
  assert.ok(html.includes('<header class="site-header">') && html.includes('<footer class="site-footer">'));
  assert.ok(html.includes('href="/fa/">خانه</a>') && html.includes('href="/fa/work">نمونه‌کارها</a>'));
  assert.ok(!html.includes('href="/fa/services">خدمات</a>'), 'no services nav entry while nothing is published');
  assert.ok(html.includes('class="lang-switch" href="/en/work"'), 'language switch keeps the path');
  assert.ok(html.includes('href="/fa/#contact">شروع پروژه</a>'));
  assert.ok(html.includes('mailto:hello@sysaiq.com'), 'fallback site info: email');
  assert.ok(html.includes('© ۱۴') && html.includes('همهٔ حقوق محفوظ است.'), 'Persian copyright line');
  // only the font-face <style>, only the external script (+ JSON-LD data blocks)
  const styles = html.match(/<style/g) || [];
  assert.equal(styles.length, 1);
  const scripts = html.match(/<script[^>]*>/g) || [];
  assert.ok(scripts.every(s => /src="\/assets\/site\/pages\.js/.test(s) || /type="application\/ld\+json"/.test(s)), scripts.join('\n'));
  assert.ok(!/\son[a-z]+=/i.test(html), 'no inline handlers');

  const en = await get('/en/work');
  assert.match(en.html, /^<!DOCTYPE html>\n<html lang="en" dir="ltr">/);
  assert.ok(!en.html.includes('@font-face'), 'en does not load the Persian face');
  assert.ok(en.html.includes('class="lang-switch" href="/fa/work"'));
  assert.ok(en.html.includes('All rights reserved.'));
  assert.equal(en.r.headers.get('content-security-policy').split(';')[1].trim(), "script-src 'self'");
});

test('unpublished system pages are 404 (route passes with next)', async () => {
  for (const p of ['/fa/about', '/en/terms', '/fa/charter']) {
    const { r } = await get(p);
    assert.equal(r.status, 404, p);
  }
});

test('every unclaimed /:lang/… URL gets the bilingual 404 on the site chrome, never Express\'s bare "Cannot GET"', async () => {
  const cases = [
    ['/fa/no-such-page', 'fa'], ['/fa/about', 'fa'], ['/en/terms', 'en'],
    ['/fa/services/custom-website', 'fa'], ['/en/work/nope', 'en'], ['/fa/deep/er/path', 'fa'], ['/fa/x?y=1', 'fa'],
  ];
  for (const [p, lang] of cases) {
    const { r, html } = await get(p);
    assert.equal(r.status, 404, p);
    assert.match(r.headers.get('content-type'), /text\/html/);
    assert.ok(!html.includes('Cannot GET'), p);
    assert.match(html, new RegExp(`^<!DOCTYPE html>\\n<html lang="${lang}" dir="${lang === 'fa' ? 'rtl' : 'ltr'}">`));
    assert.ok(html.includes('<body class="site page-notfound">'), p);
    assert.ok(html.includes('<header class="site-header">') && html.includes('<footer class="site-footer">'), `${p} has the chrome`);
    assert.ok(html.includes('<meta name="robots" content="noindex">'), p);
    assert.ok(html.includes(`<link rel="canonical" href="${t.base}/${lang}/">`), `${p} canonical is the home page`);
    assert.ok(html.includes('[ SYSAIQ—ERROR / 404 ]'));
    if (lang === 'fa') {
      assert.ok(html.includes('<h1>صفحه پیدا نشد</h1>') && html.includes('نشانی‌ای که وارد کرده‌اید وجود ندارد یا جابه‌جا شده است.'), p);
      assert.ok(html.includes('href="/fa/">صفحهٔ اصلی</a>') && html.includes('href="/fa/contact">تماس با ما</a>'), p);
    } else {
      assert.ok(html.includes('<h1>Page not found</h1>') && html.includes('href="/en/contact">Contact us</a>'), p);
    }
    // the page CSP (app.js siteCspMiddleware) applies: external script + no inline script
    assert.equal(r.headers.get('content-security-policy').split(';')[1].trim(), "script-src 'self'");
    const inline = (html.match(/<script\b[^>]*>/gi) || []).filter(s => !/\ssrc=/i.test(s) && !/type="application\/(ld\+)?json"/i.test(s));
    assert.deepEqual(inline, []);
  }
  // HEAD and POST get the same status without a stack trace
  assert.equal((await fetch(t.base + '/fa/nope', { method: 'HEAD' })).status, 404);
  assert.equal((await fetch(t.base + '/en/nope', { method: 'POST' })).status, 404);
  // the home root is not the 404 route's business (home.routes.js / SITE_DIR fallback)
  const home = await get('/fa/');
  assert.ok(!home.html.includes('page-notfound'), `/fa/ → ${home.r.status}`);
  // /api stays JSON and other non-site paths keep their own handling
  assert.equal((await fetch(t.base + '/api/nope')).headers.get('content-type').split(';')[0], 'application/json');
});

test('a published page renders markdown safely, substitutes tokens, builds a TOC, shows the legal notice', async () => {
  const terms = db.prepare("SELECT id FROM pages WHERE slug='terms'").get();
  const body_fa = [
    '## تعریف‌ها',
    'ایمیل ما {{site.email}} است و مالک {{site.owner_name}}. توکن ناشناخته {{site.nope}} می‌ماند.',
    '<script>alert(1)</script> <img src=x onerror="alert(1)"> [کلیک](javascript:alert(1)) [سایت](/fa/services)',
    '## پرداخت',
    '- مرحله‌ای **با فاکتور**',
    '## پرداخت',
    '> نقل‌قول',
  ].join('\n');
  const put = await t.fetchAdmin(`/pages/${terms.id}`, { method: 'PUT', body: { body_fa, body_en: '## Definitions\nEmail: {{site.email}}', published: true, version: '1.0', effective_at: '2026-09-22', show_in_footer: true } });
  assert.equal(put.status, 200);

  const { r, html } = await get('/fa/terms');
  assert.equal(r.status, 200);
  assert.ok(html.includes('<h1>قوانین و مقررات</h1>'));
  assert.ok(html.includes('<title>قوانین و مقررات — SysaiQ</title>'));
  // markdown neutralised
  assert.ok(!html.includes('<script>alert'), 'script tag escaped');
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(!/<img[^>]*onerror/i.test(html) && !html.includes('<img src=x'), 'the img never becomes a tag, so onerror never becomes an attribute');
  assert.ok(html.includes('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;'), 'it is visible as text');
  assert.ok(!/href="javascript:/i.test(html), 'javascript: link dropped');
  assert.ok(html.includes('<a href="/fa/services">سایت</a>'), 'safe relative link kept');
  // tokens
  assert.ok(html.includes('ایمیل ما hello@sysaiq.com است و مالک حامد ابوعلی.'));
  assert.ok(html.includes('{{site.nope}}'), 'unknown token stays visible');
  // TOC from h2s, ids unique
  assert.ok(html.includes('<nav class="toc"'));
  assert.ok(html.includes('<h2 id="تعریفها">') && html.includes('<h2 id="پرداخت">') && html.includes('<h2 id="پرداخت-2">'), html.match(/<h2 id="[^"]*"/g)?.join());
  assert.ok(html.includes('href="#پرداخت-2"'));
  // legal: notice + version + effective date (Jalali)
  assert.ok(html.includes('این متن چارچوب عمومی همکاری با SysaiQ را توضیح می‌دهد.'));
  assert.ok(html.includes('نسخهٔ ۱.۰'));
  assert.ok(html.includes('تاریخ اجرا: ۳۱ شهریور ۱۴۰۵'));
  assert.ok(html.includes('<strong>با فاکتور</strong>') && html.includes('<blockquote>'));
  // WebPage JSON-LD: dateModified is SQLite's UTC timestamp with its Z, datePublished the effective date
  const ld = [...html.matchAll(/<script type="application\/ld\+json">([^]*?)<\/script>/g)].map(m => JSON.parse(m[1]));
  const wp = ld.find(x => x['@type'] === 'WebPage');
  assert.match(wp.dateModified, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/, wp.dateModified);
  assert.equal(wp.datePublished, '2026-09-22');
  // it is now in the footer's legal column of every page
  const work = await get('/fa/work');
  assert.ok(work.html.includes('<a href="/fa/terms">قوانین و مقررات</a>'));
  assert.ok(work.html.includes('>قوانین و اعتماد</h2>'));
  // the SysaiQ column links the contact page exactly once (there is no `contact` pages row to duplicate it)
  assert.equal((work.html.match(/href="\/fa\/contact"/g) || []).length, 1, 'one footer contact link');
  assert.ok(work.html.includes('<a href="/fa/contact">تماس با ما</a>'));
  assert.equal(db.prepare("SELECT COUNT(*) c FROM pages WHERE slug='contact'").get().c, 0);

  const en = await get('/en/terms');
  assert.ok(en.html.includes('The Persian version of this page is authoritative.'));
  assert.ok(en.html.includes('Version 1.0') && en.html.includes('Effective from: 22 September 2026 (۳۱ شهریور ۱۴۰۵)'));
  assert.ok(en.html.includes('Email: hello@sysaiq.com'));
  assert.ok(!en.html.includes('<meta name="robots"'));
  // ETag / conditional GET
  const etag = r.headers.get('etag');
  assert.ok(etag);
  // node's fetch adds "cache-control: no-cache" (which forbids a 304) unless the header is given
  const cond = await fetch(t.base + '/fa/terms', { headers: { 'if-none-match': etag, 'cache-control': 'max-age=0' } });
  assert.equal(cond.status, 304);
  const stale = await fetch(t.base + '/fa/terms', { headers: { 'if-none-match': 'W/"old"', 'cache-control': 'max-age=0' } });
  assert.equal(stale.status, 200);
});

test('noindex pages carry the robots meta; unpublishing hides the page again', async () => {
  const faq = db.prepare("SELECT id FROM pages WHERE slug='faq'").get();
  await t.fetchAdmin(`/pages/${faq.id}`, { method: 'PUT', body: { published: true, noindex: true, body_fa: 'متن', show_in_nav: true } });
  let { r, html } = await get('/fa/faq');
  assert.equal(r.status, 200);
  assert.ok(html.includes('<meta name="robots" content="noindex">'));
  assert.ok(html.includes('href="/fa/faq">سؤالات متداول</a>'), 'show_in_nav puts it in the header');
  await t.fetchAdmin(`/pages/${faq.id}`, { method: 'PUT', body: { published: false } });
  ({ r } = await get('/fa/faq'));
  assert.equal(r.status, 404);
  assert.ok(!(await get('/fa/work')).html.includes('href="/fa/faq"'), 'gone from the nav');
});

test('admin: reserved slug refused on create; unique slug 409; system page delete/rename 409; custom page CRUD + reorder', async () => {
  for (const slug of ['work', 'services', 'contact', 'admin', 'api', 'uploads', 'assets', 'p', 'pay', 'invoice', 'invoices', 'account', 'login', 'index', 'sitemap', 'robots', 'news', 'healthz']) {
    const r = await t.fetchAdmin('/pages', { method: 'POST', body: { slug, title_en: 'x' } });
    assert.equal(r.status, 422, slug);
    const j = await r.json();
    assert.equal(j.error, 'validation');
    assert.ok(j.fields.slug);
  }
  const bad = await t.fetchAdmin('/pages', { method: 'POST', body: { slug: 'Bad Slug!', title_en: 'x' } });
  assert.equal(bad.status, 422);
  const dup = await t.fetchAdmin('/pages', { method: 'POST', body: { slug: 'about', title_en: 'x' } });
  assert.equal(dup.status, 409);

  const about = db.prepare("SELECT id FROM pages WHERE slug='about'").get();
  const del = await t.fetchAdmin(`/pages/${about.id}`, { method: 'DELETE' });
  assert.equal(del.status, 409);
  assert.equal((await del.json()).error, 'system_page');
  const ren = await t.fetchAdmin(`/pages/${about.id}`, { method: 'PUT', body: { slug: 'about-us' } });
  assert.equal(ren.status, 409);
  assert.equal(db.prepare("SELECT slug FROM pages WHERE id=?").get(about.id).slug, 'about');

  const created = await t.fetchAdmin('/pages', { method: 'POST', body: { slug: 'team', title_fa: 'تیم', title_en: 'Team', body_fa: '# سلام', body_en: '# Hello', published: true, kind: 'custom' } });
  assert.equal(created.status, 200);
  const { id } = await created.json();
  assert.ok(Number.isInteger(id));
  const { r, html } = await get('/fa/team');
  assert.equal(r.status, 200);
  assert.ok(html.includes('<h1>تیم</h1>') && html.includes('<h2 id="سلام">سلام</h2>'));
  // partial update keeps the other fields
  await t.fetchAdmin(`/pages/${id}`, { method: 'PUT', body: { title_en: 'Our team' } });
  const row = await (await t.fetchAdmin(`/pages/${id}`)).json();
  assert.equal(row.title_en, 'Our team');
  assert.equal(row.body_fa, '# سلام');
  assert.equal(row.published, 1);
  // validation: enums and lengths
  const v = await t.fetchAdmin(`/pages/${id}`, { method: 'PUT', body: { kind: 'weird', effective_at: 'yesterday', meta_desc_fa: 'x'.repeat(321) } });
  assert.equal(v.status, 422);
  const vj = await v.json();
  assert.ok(vj.fields.kind && vj.fields.effective_at && vj.fields.meta_desc_fa);
  // reorder
  const ids = (await (await t.fetchAdmin('/pages')).json()).map(p => p.id).reverse();
  assert.equal((await t.fetchAdmin('/pages/reorder', { method: 'POST', body: { ids } })).status, 200);
  assert.deepEqual((await (await t.fetchAdmin('/pages')).json()).map(p => p.id), ids);
  assert.equal((await t.fetchAdmin('/pages/reorder', { method: 'POST', body: { ids: 'x' } })).status, 422);
  // delete a custom page
  assert.equal((await t.fetchAdmin(`/pages/${id}`, { method: 'DELETE' })).status, 200);
  assert.equal((await get('/fa/team')).r.status, 404);
  assert.equal((await t.fetchAdmin(`/pages/${id}`)).status, 404);
  assert.equal((await t.fetchAdmin('/pages/abc')).status, 404);
  // publish/unpublish is audited by name
  const rows = db.prepare("SELECT action, entity FROM audit_log WHERE entity='pages'").all();
  assert.ok(rows.some(x => x.action === 'publish') && rows.some(x => x.action === 'unpublish') && rows.some(x => x.action === 'delete'));
});

test('fa/en parity: a page cannot be published (or stay published) with a title or body missing in one language', async () => {
  const fields = async r => { assert.equal(r.status, 422); return (await r.json()).fields; };
  // create: one body only
  let f = await fields(await t.fetchAdmin('/pages', { method: 'POST', body: { slug: 'parity', title_fa: 'برابری', title_en: 'Parity', body_fa: 'متن', published: true } }));
  assert.ok(f.published && f.body_en && !f.body_fa, JSON.stringify(f));
  // the same page unpublished is fine (drafting one language at a time)
  const c = await t.fetchAdmin('/pages', { method: 'POST', body: { slug: 'parity', title_fa: 'برابری', title_en: 'Parity', body_fa: 'متن' } });
  assert.equal(c.status, 200);
  const { id } = await c.json();
  // publish while body_en is still empty → refused; /en/parity never renders an empty .prose
  f = await fields(await t.fetchAdmin(`/pages/${id}`, { method: 'PUT', body: { published: true } }));
  assert.match(f.published, /body_en/);
  assert.equal((await get('/en/parity')).r.status, 404);
  // fill it → publishes
  assert.equal((await t.fetchAdmin(`/pages/${id}`, { method: 'PUT', body: { body_en: 'Text', published: true } })).status, 200);
  assert.equal((await get('/en/parity')).r.status, 200);
  // clearing one language of a live page is refused too (merged row is checked)
  f = await fields(await t.fetchAdmin(`/pages/${id}`, { method: 'PUT', body: { title_en: '' } }));
  assert.ok(f.title_en && f.published);
  assert.equal(db.prepare('SELECT title_en FROM pages WHERE id=?').get(id).title_en, 'Parity', 'nothing was written');
  // unpublish first, then clearing is allowed
  assert.equal((await t.fetchAdmin(`/pages/${id}`, { method: 'PUT', body: { published: false, title_en: '' } })).status, 200);
  assert.equal((await t.fetchAdmin(`/pages/${id}`, { method: 'DELETE' })).status, 200);
});

test('POST /pages/preview renders the article html without chrome', async () => {
  const r = await t.fetchAdmin('/pages/preview', { method: 'POST', body: { body: '## عنوان\nایمیل: {{site.email}} <b>x</b>', lang: 'fa', title: 'پیش‌نمایش', kind: 'legal', version: '2', effective_at: '2026-01-01' } });
  assert.equal(r.status, 200);
  const { html } = await r.json();
  assert.ok(html.includes('<h1>پیش‌نمایش</h1>') && html.includes('&lt;b&gt;x&lt;/b&gt;') && html.includes('hello@sysaiq.com'));
  assert.ok(html.includes('class="notice"') && html.includes('نسخهٔ ۲'));
  assert.ok(!html.includes('<html') && !html.includes('<header class="site-header"'));
  assert.equal((await t.fetchAdmin('/pages/preview', { method: 'POST', body: { body: 5 } })).status, 200); // numbers coerce to text
  assert.equal((await t.fetchAdmin('/pages/preview', { method: 'POST', body: { body: { a: 1 } } })).status, 422);
});

// Both preview routes set res.locals.readOnly = true. Honouring it is one line
// in Foundation's routes/admin/index.js trackWrites (`… || res.locals.readOnly) return;`);
// until that lands every preview keystroke writes an audit row and drops the
// render cache, so this stays a TODO (a failing TODO does not fail the run)
// and turns green by itself — Foundation removes the todo flag with the fix.
test('a preview is read-only: no audit row, render cache kept', { todo: 'needs routes/admin/index.js trackWrites to honour res.locals.readOnly (Foundation)' }, async () => {
  const { cacheVersion } = await import('../../src/lib/cache.js');
  await get('/fa/work'); // warm the cache
  const before = { audit: db.prepare('SELECT COUNT(*) c FROM audit_log').get().c, cache: cacheVersion() };
  assert.equal((await t.fetchAdmin('/pages/preview', { method: 'POST', body: { body: 'x', lang: 'fa' } })).status, 200);
  assert.equal((await t.fetchAdmin('/sections/preview', { method: 'POST', body: { type: 'richtext', body_fa: 'x', lang: 'fa' } })).status, 200);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM audit_log').get().c, before.audit, 'no audit row for a preview');
  assert.equal(cacheVersion(), before.cache, 'render cache untouched by a preview');
});
