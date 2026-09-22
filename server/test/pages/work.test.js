// /fa/work and /fa/work/:slug moved from projectPage.js onto the shared
// layout: the headline content must be byte-identical to what the old
// renderer produced for the same row (fixture strings below were taken from
// projectPage.js output), and the 404 path still passes to the next handler.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp } from '../helpers.js';

let t;
before(async () => {
  t = await startTestApp();
  await t.loginAsAdmin();
  const r = await t.fetchAdmin('/projects', {
    method: 'POST',
    body: {
      slug: 'accounting', title_en: 'Accounting & Finance System', title_fa: 'سیستم حسابداری و مالی',
      tags: 'ACCOUNTING · LEDGER · PAYROLL', image: '/assets/projects/accounting-cover.jpg',
      cover_en: '/assets/projects/accounting-full.jpg', cover_fa: '/assets/projects/accounting-fa-full.jpg',
      tagline_en: 'Ledger, payroll and reports on one screen.', tagline_fa: 'دفتر کل، حقوق و گزارش‌ها روی یک صفحه.',
      overview_en: 'A double-entry accounting system.', overview_fa: 'یک سیستم حسابداری دوطرفه با مغایرت‌گیری خودکار.',
      industries: [{ en: 'Retail', fa: 'خرده‌فروشی' }, { en: 'Services', fa: 'خدمات' }],
      features: [{ title_en: 'Auto reconciliation', title_fa: 'مغایرت‌گیری خودکار', desc_en: 'Matches bank lines.', desc_fa: 'ردیف‌های بانک را تطبیق می‌دهد.' }],
      pages: [{ name_en: 'Dashboard', name_fa: 'داشبورد', desc_en: 'Cash position.', desc_fa: 'وضعیت نقدینگی.' }],
      published: true, sort: 6,
    },
  });
  assert.equal(r.status, 200);
});
after(async () => { await t.close(); });

// exact fragments the legacy projectPage.js emitted for this row (the index
// h1 now uses the site-wide «هٔ» ezafe — the one deliberate orthography fix)
const OLD_INDEX = [
  '<h1>همهٔ پروژه‌ها</h1>',
  '<p class="sub">نمونه‌کارهای SysaiQ — سیستم‌ها و وب‌سایت‌هایی برای صنف‌ها و شرکت‌های مختلف</p>',
  'href="/fa/work/accounting"',
  '<b>سیستم حسابداری و مالی</b><p>دفتر کل، حقوق و گزارش‌ها روی یک صفحه.</p>',
  'ACCOUNTING · LEDGER · PAYROLL',
];
const OLD_DETAIL = [
  '<title>سیستم حسابداری و مالی — SysaiQ</title>',
  '<meta name="description" content="دفتر کل، حقوق و گزارش‌ها روی یک صفحه.">',
  '<h1>سیستم حسابداری و مالی</h1>',
  '<p class="tagline">دفتر کل، حقوق و گزارش‌ها روی یک صفحه.</p>',
  'src="/assets/projects/accounting-fa-full.jpg" alt="سیستم حسابداری و مالی UI"',
  '<p class="lead">یک سیستم حسابداری دوطرفه با مغایرت‌گیری خودکار.</p>',
  '<span class="chip">خرده‌فروشی</span><span class="chip">خدمات</span>',
  '<h3>مغایرت‌گیری خودکار</h3>',
  '<p>ردیف‌های بانک را تطبیق می‌دهد.</p>',
  '<div class="pn">داشبورد</div>',
  '<div class="pd">وضعیت نقدینگی.</div>',
  '<h2>پروژه‌ای مشابه می‌خواهید؟</h2>',
  'href="/fa/#contact">شروع پروژه</a>',
  '<link rel="alternate" hreflang="en" href="',
  '/en/work/accounting">',
];

test('/fa/work keeps the legacy headline content on the new layout', async () => {
  const r = await fetch(t.base + '/fa/work');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/html/);
  const html = await r.text();
  for (const s of OLD_INDEX) assert.ok(html.includes(s), s);
  assert.ok(html.includes('<header class="site-header">') && html.includes('/assets/site/pages.css'));
  assert.ok(html.includes('"@type":"ItemList"'));
  assert.equal((await fetch(t.base + '/fa/work/')).status, 200);
});

test('/fa/work/accounting keeps the legacy content; en variant; unknown slug → 404 via next() (site 404 page)', async () => {
  const r = await fetch(t.base + '/fa/work/accounting');
  assert.equal(r.status, 200);
  const html = await r.text();
  for (const s of OLD_DETAIL) assert.ok(html.includes(s), s);
  assert.ok(html.includes(`<meta property="og:image" content="${t.base}/assets/projects/accounting-fa-full.jpg">`));
  assert.ok(html.includes('<script type="application/ld+json">') && html.includes('"@type":"CreativeWork"'));
  // creator = the site's ProfessionalService entity by @id (a natural person's brand, not an Organization)
  const ld = [...html.matchAll(/<script type="application\/ld\+json">([^]*?)<\/script>/g)].map(m => JSON.parse(m[1]));
  const org = ld.find(x => x['@type'] === 'ProfessionalService');
  assert.equal(org?.['@id'], `${t.base}/#organization`);
  assert.deepEqual(ld.find(x => x['@type'] === 'CreativeWork').creator, { '@id': org['@id'] });
  assert.ok(!html.includes('"Organization"'));
  const en = await (await fetch(t.base + '/en/work/accounting')).text();
  assert.ok(en.includes('<h1>Accounting &amp; Finance System</h1>') && en.includes('<h3>Auto reconciliation</h3>') && en.includes('src="/assets/projects/accounting-full.jpg"'));
  assert.ok(en.includes('class="lang-switch" href="/fa/work/accounting"'));
  const missing = await fetch(t.base + '/fa/work/does-not-exist');
  assert.equal(missing.status, 404);
  // routes/public/notfound.routes.js answers on the site chrome under the page CSP
  assert.equal(missing.headers.get('content-security-policy').split(';')[1].trim(), "script-src 'self'");
  assert.ok((await missing.text()).includes('<body class="site page-notfound">'));
});

test('unpublished project disappears from the index and 404s', async () => {
  const { db } = await import('../../src/db/index.js');
  const { id } = db.prepare("SELECT id FROM projects WHERE slug='accounting'").get();
  await t.fetchAdmin(`/projects/${id}`, { method: 'PUT', body: { title_en: 'Accounting & Finance System', title_fa: 'سیستم حسابداری و مالی', published: false } });
  assert.equal((await fetch(t.base + '/fa/work/accounting')).status, 404);
  assert.ok(!(await (await fetch(t.base + '/fa/work')).text()).includes('href="/fa/work/accounting"'));
});
