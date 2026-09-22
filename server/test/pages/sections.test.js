// Home-page sections: the three placement slots render published sections
// in sort order with the type patterns, nav_extra / footer_links slots,
// admin validation per type and the reserved-id rules.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp } from '../helpers.js';

let t, db, slots;
before(async () => {
  t = await startTestApp();
  ({ db } = await import('../../src/db/index.js'));
  await t.loginAsAdmin();
  slots = {
    about: (await import('../../src/render/slots/sections_after_about.js')).default,
    work: (await import('../../src/render/slots/sections_after_work.js')).default,
    faq: (await import('../../src/render/slots/sections_after_faq.js')).default,
    nav: (await import('../../src/render/slots/nav_extra.js')).default,
    foot: (await import('../../src/render/slots/footer_links.js')).default,
  };
});
after(async () => { await t.close(); });

const create = body => t.fetchAdmin('/sections', { method: 'POST', body });

test('empty: every slot renders nothing', () => {
  for (const k of ['about', 'work', 'faq']) assert.equal(slots[k]('fa'), '');
  assert.equal(slots.nav('fa'), '');
  assert.equal(slots.foot('fa'), '');
});

test('sections render in their placement, in sort order, only when published, with scoped style and data-phase', async () => {
  const r1 = await create({ slug: 'process', type: 'steps', theme: 'dark', placement: 'after_work', sort: 20, published: true, eyebrow: 'SYSAIQ—PROCESS / SYS.05',
    title_fa: 'فرایند *همکاری*', title_en: 'How we *work*', body_fa: 'شش مرحله.', body_en: 'Six steps.',
    items: [{ title_fa: 'شناخت', title_en: 'Discovery', desc_fa: 'گفت‌وگو', desc_en: 'A call' }, { title_fa: 'پیشنهاد کتبی', title_en: 'Written proposal' }],
    show_in_nav: true, nav_label_fa: 'فرایند', nav_label_en: 'Process' });
  assert.equal(r1.status, 200, await r1.text());
  const r2 = await create({ slug: 'why', type: 'cards', theme: 'light', placement: 'after_work', sort: 10, published: true,
    title_fa: 'چرا SysaiQ', title_en: 'Why SysaiQ', items: [{ title_fa: 'محدودهٔ مکتوب', title_en: 'Written scope', desc_fa: 'x', desc_en: 'y' }] });
  assert.equal(r2.status, 200);
  const r3 = await create({ slug: 'draft-only', type: 'richtext', placement: 'after_work', sort: 5, published: false, body_fa: 'پنهان', body_en: 'hidden' });
  assert.equal(r3.status, 200);
  const r4 = await create({ slug: 'numbers', type: 'stats', placement: 'after_about', published: true, items: [{ value: '17', label_fa: 'سیستم ساخته‌شده', label_en: 'systems built' }] });
  assert.equal(r4.status, 200);
  const r5 = await create({ slug: 'start', type: 'cta', theme: 'dark', placement: 'after_faq', published: true, title_fa: 'شروع کنیم؟', title_en: 'Ready?', cta_label_fa: 'تماس', cta_label_en: 'Contact', cta_href: '/fa/#contact' });
  assert.equal(r5.status, 200);
  const r6 = await create({ slug: 'plans', type: 'pricing', placement: 'after_faq', sort: 50, published: true, title_fa: 'پلن‌ها', title_en: 'Plans',
    items: [{ name_fa: 'پایه', name_en: 'Basic', features: [{ fa: 'پشتیبانی ایمیلی', en: 'Email support' }], featured: true }, { name_fa: 'سفارشی', name_en: 'Custom', price_fa: 'توافقی', price_en: 'Negotiated' }] });
  assert.equal(r6.status, 200);

  const work = slots.work('fa');
  const iWhy = work.indexOf('<section id="why"'), iProc = work.indexOf('<section id="process"');
  assert.ok(iWhy >= 0 && iProc > iWhy, 'sort order: why (10) before process (20)');
  assert.ok(!work.includes('draft-only') && !work.includes('پنهان'), 'unpublished section is not rendered');
  assert.ok(work.includes('<section id="why" class="light sx sx-cards" data-phase="3"'));
  assert.ok(work.includes('<section id="process" class="solid sx sx-steps" data-phase="3"'));
  assert.ok(work.includes('<style>\n#process{') && work.includes('#why{'), 'scoped style blocks');
  assert.ok(!/<script/i.test(work) && !/\son[a-z]+=/i.test(work));
  assert.ok(work.includes('<h2>فرایند <em>همکاری</em></h2>'), 'inline markup in the title');
  assert.ok(work.includes('<span class="eyebrow">SYSAIQ—PROCESS / SYS.05</span>'));
  assert.ok(work.includes('<span class="n"><span dir="ltr">01</span></span>') && work.includes('<h3>شناخت</h3>') && work.includes('<h3>پیشنهاد کتبی</h3>'));
  assert.ok(work.includes('<span class="idx"><span dir="ltr">[ 01 ]</span></span>') && work.includes('<h3>محدودهٔ مکتوب</h3>'));
  assert.ok(work.includes('<p>شش مرحله.</p>'));

  const about = slots.about('fa');
  assert.ok(about.includes('<section id="numbers" class="light sx sx-stats"') && about.includes('<b>۱۷</b>') && about.includes('سیستم ساخته‌شده'));
  assert.equal(slots.about('en').includes('<b>17</b>'), true);

  const faq = slots.faq('fa');
  assert.ok(faq.indexOf('id="start"') < faq.indexOf('id="plans"'));
  assert.ok(faq.includes('<div class="banner">') && faq.includes('<a class="btn" href="/fa/#contact">تماس</a>'));
  assert.ok(faq.includes('<div class="plan featured">') && faq.includes('<li>پشتیبانی ایمیلی</li>'));
  assert.ok(faq.includes('در پیشنهاد کتبی اعلام می‌شود.'), 'plan without a price prints the proposal line');
  assert.ok(faq.includes('<div class="price">توافقی</div>'));
  assert.ok(slots.faq('en').includes('Stated in the written proposal.'));

  // nav extra: only sections with show_in_nav, as same-page anchors on the home page
  assert.equal(slots.nav('fa'), '<a href="#process">فرایند</a>');
  assert.equal(slots.nav('en'), '<a href="#process">Process</a>');
  // and in the SSR header as /lang/#slug
  const html = await (await fetch(t.base + '/fa/work')).text();
  assert.ok(html.includes('href="/fa/#process">فرایند</a>'));
});

test('markdown body and items are escape-first', async () => {
  const r = await create({ slug: 'xss', type: 'cards', placement: 'after_about', published: true, body_fa: '<img src=x onerror=alert(1)>', body_en: 'x',
    items: [{ title_fa: '<script>1</script>', title_en: 'x', desc_fa: '[a](javascript:alert) [b](/fa/work "x")', desc_en: 'y' }] });
  assert.equal(r.status, 200);
  const html = slots.about('fa');
  assert.ok(!/<img/i.test(html) && !/<script/i.test(html) && !/href="javascript/i.test(html));
  assert.ok(html.includes('&lt;script&gt;1&lt;/script&gt;'));
  assert.ok(html.includes('<p>a [b](/fa/work &quot;x&quot;)</p>'), 'rejected link keeps its text only; unmatched markup stays literal');
});

test('admin validation: type enums, items per type (max 24, schema), cta_href, reserved ids, slug conflicts, reorder, preview', async () => {
  const bad = async (body, ...fields) => {
    const r = await create(body);
    assert.equal(r.status, 422, JSON.stringify(body));
    const j = await r.json();
    for (const f of fields) assert.ok(j.fields[f], `${f} in ${JSON.stringify(j.fields)}`);
  };
  await bad({ slug: 'a1', type: 'hero' }, 'type');
  await bad({ slug: 'a1', theme: 'blue', placement: 'top' }, 'theme', 'placement');
  await bad({ slug: 'a1', type: 'stats', items: [{ value: { x: 1 } }] }, 'items[0].value');
  await bad({ slug: 'a1', type: 'cards', items: new Array(25).fill({ title_en: 'x' }) }, 'items');
  await bad({ slug: 'a1', type: 'richtext', items: [{ title_en: 'x' }] }, 'items');
  await bad({ slug: 'a1', type: 'pricing', items: [{ name_en: 'x', features: 'nope' }] }, 'items[0].features');
  await bad({ slug: 'a1', cta_href: 'javascript:alert(1)' }, 'cta_href');
  await bad({ slug: 'a1', cta_href: '//evil.example' }, 'cta_href');
  for (const slug of ['hero', 'work', 'faq', 'contact', 'services', 'admin']) await bad({ slug }, 'slug');
  await bad({}, 'slug');
  assert.equal((await create({ slug: 'process' })).status, 409);

  const ok = await create({ slug: 'a1', type: 'cards', items: [{ title_en: 'x' }], cta_href: 'https://example.com/x' });
  assert.equal(ok.status, 200);
  const { id } = await ok.json();
  // a type change re-validates the stored items against the new type
  const flip = await t.fetchAdmin(`/sections/${id}`, { method: 'PUT', body: { type: 'richtext' } });
  assert.equal(flip.status, 422);
  assert.equal((await t.fetchAdmin(`/sections/${id}`, { method: 'PUT', body: { type: 'richtext', items: [] } })).status, 200);
  assert.equal((await t.fetchAdmin(`/sections/${id}`, { method: 'PUT', body: { slug: 'hero' } })).status, 422);
  assert.equal((await t.fetchAdmin(`/sections/${id}`, { method: 'PUT', body: { slug: 'a1-renamed', published: true } })).status, 200);
  const row = await (await t.fetchAdmin(`/sections/${id}`)).json();
  assert.equal(row.slug, 'a1-renamed');
  assert.equal(row.items, '[]');
  assert.equal(row.published, 1);

  const ids = (await (await t.fetchAdmin('/sections')).json()).map(s => s.id);
  assert.equal((await t.fetchAdmin('/sections/reorder', { method: 'POST', body: { ids: [...ids].reverse() } })).status, 200);
  const sorted = db.prepare('SELECT id, sort FROM sections ORDER BY sort').all().map(r => r.id);
  assert.deepEqual(sorted, [...ids].reverse());

  const pv = await t.fetchAdmin('/sections/preview', { method: 'POST', body: { type: 'cta', lang: 'en', title_en: 'Hi', cta_label_en: 'Go', cta_href: '/en/#contact' } });
  assert.equal(pv.status, 200);
  const { html } = await pv.json();
  assert.ok(html.startsWith('<section id="preview" class="light sx sx-cta"') && html.includes('<h2>Hi</h2>') && html.includes('href="/en/#contact">Go</a>'));

  assert.equal((await t.fetchAdmin(`/sections/${id}`, { method: 'DELETE' })).status, 200);
  assert.equal((await t.fetchAdmin(`/sections/${id}`)).status, 404);
});

test('a section slug must start with a letter (it is a CSS id); a stored digit-leading id is CSS-escaped', async () => {
  for (const slug of ['1st', '2024-plans', '0']) {
    const r = await create({ slug, type: 'richtext', body_en: 'x', body_fa: 'x' });
    assert.equal(r.status, 422, slug);
    assert.match((await r.json()).fields.slug, /start with a letter/);
  }
  assert.equal((await create({ slug: 'plans-2024', type: 'richtext', body_en: 'x', body_fa: 'x' })).status, 200);
  // the engine never emits an invalid "#1st{" selector, even for a row that predates the rule
  const { renderSection } = await import('../../src/render/slots/sections_after_about.js');
  const html = renderSection({ id: 9, slug: '1st', type: 'richtext', theme: 'light', body_en: 'x', body_fa: 'x', items: '[]' }, 'fa');
  assert.ok(html.includes('<section id="1st"') && html.includes('#\\31 st{') && !html.includes('#1st{'), html.slice(0, 200));
});

test('eyebrow is a Latin technical label: Persian (or any non-ASCII letters) refused, the format\'s dashes and dots allowed', async () => {
  for (const eyebrow of ['آمار فارسی', 'SYSAIQ—آمار', 'Ünïcode', 'x‌y', 'a\nb']) {
    const r = await create({ slug: 'eb', type: 'richtext', body_en: 'x', body_fa: 'x', eyebrow });
    assert.equal(r.status, 422, eyebrow);
    assert.match((await r.json()).fields.eyebrow, /Latin technical label/);
  }
  const ok = await create({ slug: 'eb', type: 'stats', eyebrow: '[ SYSAIQ—STATS / SYS.07 · 2026 – v2 ]', items: [{ value: '1', label_fa: 'ی', label_en: 'y' }] });
  const okBody = await ok.json();
  assert.equal(ok.status, 200, JSON.stringify(okBody));
  const { id } = okBody;
  assert.equal(db.prepare('SELECT eyebrow FROM sections WHERE id=?').get(id).eyebrow, '[ SYSAIQ—STATS / SYS.07 · 2026 – v2 ]');
  assert.equal((await t.fetchAdmin(`/sections/${id}`, { method: 'PUT', body: { eyebrow: 'نه' } })).status, 422);
  assert.equal((await t.fetchAdmin(`/sections/${id}`, { method: 'PUT', body: { eyebrow: '' } })).status, 200, 'empty clears it');
  assert.equal((await t.fetchAdmin(`/sections/${id}`, { method: 'DELETE' })).status, 200);
});

test('reserved ids cover every id the home template owns (markup, getElementById, #id rules) — the set cannot rot', async () => {
  const { readFileSync } = await import('node:fs');
  const { TEMPLATE_IDS } = await import('../../src/routes/admin/sections.routes.js');
  const src = readFileSync(new URL('../../../vesper-project/src/vesper.src.html', import.meta.url), 'utf8');
  const hex = s => /^[0-9a-f]{3}$|^[0-9a-f]{6}$|^[0-9a-f]{8}$/.test(s);
  const found = new Set();
  for (const m of src.matchAll(/\bid="([a-z][a-z0-9-]*)"/g)) found.add(m[1]);
  for (const m of src.matchAll(/getElementById\(['"]([a-z][a-z0-9-]*)['"]\)/g)) found.add(m[1]);
  for (const m of src.matchAll(/#([a-z][a-z0-9-]*)(?=[\s{,.:>[)'"]|$)/gm)) if (!hex(m[1])) found.add(m[1]);
  assert.ok(found.size >= 20, [...found].join());
  const missing = [...found].filter(id => !TEMPLATE_IDS.has(id));
  assert.deepEqual(missing, [], `add to TEMPLATE_IDS in routes/admin/sections.routes.js: ${missing.join(', ')}`);
  // and the API refuses them (the scroll engine's getElementById targets in particular)
  for (const slug of ['sc-stage', 'sc-bar', 'showcase', 'counter', 'nav-toggle', 'lab-svg', 'lg1', 'lgbg', 'status-label', 'cortex', 'ai-teaser']) {
    const r = await create({ slug, type: 'richtext', body_en: 'x', body_fa: 'x' });
    assert.equal(r.status, 422, slug);
    assert.match((await r.json()).fields.slug, /reserved/);
  }
});

test('footer_links slot is a self-contained labelled row (own <style> + div[role=navigation]) with services (when published) and footer pages', async () => {
  assert.equal(slots.foot('fa'), '', 'nothing to link → empty slot');
  const terms = db.prepare("SELECT id FROM pages WHERE slug='terms'").get();
  await t.fetchAdmin(`/pages/${terms.id}`, { method: 'PUT', body: { published: true } });
  const fa = slots.foot('fa');
  // the template drops the marker between .foot-main and .foot-base, not inside .foot-nav:
  // bare <a> elements would render with browser defaults, so the slot must bring its wrapper + style.
  // A div, not <nav>: the template's bare `nav{…}` rules turn any nav into the header's mobile dropdown
  assert.ok(fa.startsWith('<style>\n.foot-legal{'), fa.slice(0, 80));
  assert.ok(fa.includes('<div class="foot-legal" role="navigation" aria-label="قوانین و اعتماد"><span class="foot-legal-h">قوانین و اعتماد</span><a href="/fa/terms">قوانین و مقررات</a></div>'), fa);
  assert.ok(!/<nav\b/.test(fa));
  assert.ok(!/<script/i.test(fa) && !/\son[a-z]+=/i.test(fa));
  assert.ok(/\.foot-legal a\{[^}]*text-decoration:none/.test(fa) && /\.foot-legal\{[^}]*display:flex/.test(fa), 'links are styled by the slot itself');
  const svc = db.prepare("SELECT id FROM services WHERE slug='automation'").get();
  await t.fetchAdmin(`/services/${svc.id}`, { method: 'PUT', body: { published: true } });
  const en = slots.foot('en');
  assert.ok(en.includes('<div class="foot-legal" role="navigation" aria-label="Legal and trust"><span class="foot-legal-h">Legal and trust</span><a href="/en/services">Services</a><a href="/en/terms">Terms and conditions</a></div>'), en);
  assert.ok(slots.nav('en').startsWith('<a href="/en/services">Services</a>'));
});
