// Services: index + detail on the layout, the proposal line for empty
// timeline / cost sections, JSON-LD (Service + FAQPage + BreadcrumbList),
// related projects, nav/footer entries, admin validation and protection.
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
const jsonld = html => [...html.matchAll(/<script type="application\/ld\+json">([^]*?)<\/script>/g)].map(m => JSON.parse(m[1]));

test('index with nothing published: 200, empty state, no nav entry; detail 404', async () => {
  const { r, html } = await get('/fa/services');
  assert.equal(r.status, 200);
  assert.ok(html.includes('<h1>خدمات SysaiQ</h1>') && html.includes('هنوز خدمتی منتشر نشده است.'));
  assert.ok(!html.includes('href="/fa/services">خدمات</a>'));
  assert.equal((await get('/fa/services/ai-agent')).r.status, 404);
  assert.equal((await get('/en/services/nope')).r.status, 404);
});

test('publish one service via the API → index card, detail sections, proposal fallbacks, JSON-LD, related projects', async () => {
  // a related, published project
  const proj = await (await t.fetchAdmin('/projects', { method: 'POST', body: { slug: 'realestate', title_en: 'Real-Estate Agency CRM', title_fa: 'CRM آژانس املاک', tags: 'CRM · AI MATCHING · MAP', image: '/assets/projects/realestate-cover.jpg', published: true } })).json();
  assert.ok(proj.id);
  const s = db.prepare("SELECT id FROM services WHERE slug='ai-agent'").get();
  const put = await t.fetchAdmin(`/services/${s.id}`, {
    method: 'PUT',
    body: {
      published: true,
      tagline_fa: 'دستیار هوشمند روی *داده‌های خودتان*', tagline_en: 'An assistant over *your own data*',
      summary_fa: 'چت‌بات و Agent با RAG', summary_en: 'Chatbots and agents with RAG',
      audience_fa: '- کسب‌وکارهایی با حجم زیاد پرسش تکراری\n- تیم‌های پشتیبانی', audience_en: '- Businesses with many repeated questions',
      problems_fa: 'پاسخ‌گویی ۲۴ساعته بدون افزایش نیرو.', problems_en: 'Answering around the clock without more staff.',
      deliverables: [{ en: 'RAG pipeline over your documents', fa: 'خط لولهٔ RAG روی اسناد شما' }, { en: 'Admin panel', fa: 'پنل مدیریت' }],
      process: [{ title_en: 'Discovery', title_fa: 'شناخت', desc_en: 'We map the questions.', desc_fa: 'پرسش‌ها را نقشه‌برداری می‌کنیم.' }, { title_en: 'Build', title_fa: 'ساخت' }],
      faqs: [{ q_en: 'Which model?', q_fa: 'کدام مدل؟', a_en: 'The one your budget allows — stated in the proposal.', a_fa: 'در پیشنهاد کتبی مشخص می‌شود.' }],
      related_projects: ['realestate', 'medical'],
      // timeline + price_approach left empty on purpose
    },
  });
  assert.equal(put.status, 200);

  const idx = await get('/fa/services');
  assert.ok(idx.html.includes('href="/fa/services/ai-agent"') && idx.html.includes('<b>AI Agent و چت‌بات</b>'));
  assert.ok(idx.html.includes('href="/fa/services">خدمات</a>'), 'nav shows خدمات once a service is published');
  assert.ok(idx.html.includes('<h2 class="foot-h">خدمات</h2>') && idx.html.includes('<a href="/fa/services/ai-agent">AI Agent و چت‌بات</a>'), 'footer services column');

  const { r, html } = await get('/fa/services/ai-agent');
  assert.equal(r.status, 200);
  assert.ok(html.includes('<h1>AI Agent و چت‌بات</h1>'));
  assert.ok(html.includes('دستیار هوشمند روی <em>داده‌های خودتان</em>'), 'tagline uses inline markup');
  assert.ok(html.includes('<li>خط لولهٔ RAG روی اسناد شما</li>') && html.includes('<li>پنل مدیریت</li>'));
  assert.ok(html.includes('<li>کسب‌وکارهایی با حجم زیاد پرسش تکراری</li>'), 'audience markdown');
  assert.ok(html.includes('<h3>شناخت</h3>') && html.includes('<h3>ساخت</h3>'));
  assert.equal((html.match(/در پیشنهاد کتبی اعلام می‌شود\./g) || []).length, 2, 'timeline + cost print the proposal line');
  assert.ok(html.includes('data-qa-toggle') && html.includes('کدام مدل؟'));
  assert.ok(html.includes('href="/fa/work/realestate"') && html.includes('<b>CRM آژانس املاک</b>'), 'related published project');
  assert.ok(!html.includes('/fa/work/medical'), 'unpublished/unknown related slug skipped');
  assert.ok(html.includes('class="lang-switch" href="/en/services/ai-agent"'));

  const ld = jsonld(html);
  const types = ld.map(x => x['@type']);
  assert.ok(types.includes('BreadcrumbList') && types.includes('Service') && types.includes('FAQPage') && types.includes('ProfessionalService'), types.join());
  const svc = ld.find(x => x['@type'] === 'Service');
  assert.equal(svc.name, 'AI Agent و چت‌بات');
  assert.equal(svc.url, `${t.base}/fa/services/ai-agent`);
  // the provider is the site's ProfessionalService entity (a natural person's brand, never an Organization), referenced by @id
  const org = ld.find(x => x['@type'] === 'ProfessionalService');
  assert.equal(org['@id'], `${t.base}/#organization`);
  assert.equal(org.founder?.['@type'], 'Person');
  assert.deepEqual(svc.provider, { '@id': org['@id'] });
  assert.ok(!('areaServed' in svc), 'the Service does not narrow the area to Iran (tagline: Iran and abroad)');
  assert.ok(!html.includes('"Organization"'));
  const faq = ld.find(x => x['@type'] === 'FAQPage');
  assert.equal(faq.mainEntity[0].name, 'کدام مدل؟');
  const crumbs = ld.find(x => x['@type'] === 'BreadcrumbList');
  assert.equal(crumbs.itemListElement.length, 3);

  const en = await get('/en/services/ai-agent');
  assert.ok(en.html.includes('<h1>AI agents and chatbots</h1>') && en.html.includes('Stated in the written proposal.'));
  assert.ok(en.html.includes('<li>RAG pipeline over your documents</li>'));
});

test('FAQPage JSON-LD carries plain-text answers: markdown rendered then stripped, tokens substituted, rejected links gone', async () => {
  const s = db.prepare("SELECT id FROM services WHERE slug='ai-agent'").get();
  const put = await t.fetchAdmin(`/services/${s.id}`, { method: 'PUT', body: { faqs: [{
    q_en: 'How do I *order*?', q_fa: 'چطور *سفارش* بدهم؟',
    a_en: 'Write to {{site.email}}.\n\n- **Scope** first\n- [proposal](/en/pricing) & [x](javascript:1)\n\n> Nothing is owed before signature.',
    a_fa: 'به {{site.email}} بنویسید.\n\n- اول **محدودهٔ کار**\n- [پیشنهاد](/fa/pricing) & [x](javascript:1)\n\n> پیش از امضا چیزی بدهکار نیستید.',
  }] } });
  assert.equal(put.status, 200);
  for (const [lang, q, a] of [
    ['fa', 'چطور سفارش بدهم؟', 'به hello@sysaiq.com بنویسید. اول محدودهٔ کار پیشنهاد & x پیش از امضا چیزی بدهکار نیستید.'],
    ['en', 'How do I order?', 'Write to hello@sysaiq.com. Scope first proposal & x Nothing is owed before signature.'],
  ]) {
    const { html } = await get(`/${lang}/services/ai-agent`);
    const faq = jsonld(html).find(x => x['@type'] === 'FAQPage');
    assert.equal(faq.mainEntity[0].name, q, lang);
    assert.equal(faq.mainEntity[0].acceptedAnswer.text, a, lang);
    const raw = html.match(/<script type="application\/ld\+json">([^]*?)<\/script>/g).join('');
    assert.ok(!/javascript:|\*\*|\{\{site\./.test(raw), 'no markdown syntax, token or rejected target in the JSON-LD');
    // the visible accordion still renders the markdown (link kept, script-scheme dropped)
    assert.ok(html.includes(`<a href="/${lang}/pricing">`) && !/href="javascript:/i.test(html));
  }
});

test('a filled timeline replaces the proposal line; markdown in it is safe', async () => {
  const s = db.prepare("SELECT id FROM services WHERE slug='ai-agent'").get();
  await t.fetchAdmin(`/services/${s.id}`, { method: 'PUT', body: { timeline_fa: 'بسته به محدوده <script>x</script>', timeline_en: 'Depends on scope' } });
  const { html } = await get('/fa/services/ai-agent');
  assert.equal((html.match(/در پیشنهاد کتبی اعلام می‌شود\./g) || []).length, 1);
  assert.ok(html.includes('بسته به محدوده &lt;script&gt;x&lt;/script&gt;'));
});

test('fa/en parity: publishing needs both titles; other texts and list items must be filled in both languages or neither', async () => {
  const fields = async r => { assert.equal(r.status, 422); return (await r.json()).fields; };
  const s = db.prepare("SELECT id FROM services WHERE slug='custom-website'").get();
  // seeded catalogue row (both titles, nothing else) publishes as is
  assert.equal((await t.fetchAdmin(`/services/${s.id}`, { method: 'PUT', body: { published: true } })).status, 200);
  // one-language tagline on a live service → refused, nothing written
  let f = await fields(await t.fetchAdmin(`/services/${s.id}`, { method: 'PUT', body: { tagline_fa: 'فقط فارسی' } }));
  assert.ok(f.published && f.tagline_en && !f.tagline_fa, JSON.stringify(f));
  assert.equal(db.prepare('SELECT tagline_fa FROM services WHERE id=?').get(s.id).tagline_fa, '');
  // list items are checked one by one
  f = await fields(await t.fetchAdmin(`/services/${s.id}`, { method: 'PUT', body: { deliverables: [{ en: 'Both', fa: 'هر دو' }, { en: 'English only' }], faqs: [{ q_en: 'Q', q_fa: 'س', a_en: 'A' }] } }));
  assert.ok(f['deliverables[1].fa'] && f['faqs[0].a_fa'] && !f['deliverables[0].fa'], JSON.stringify(f));
  // both languages → accepted
  assert.equal((await t.fetchAdmin(`/services/${s.id}`, { method: 'PUT', body: { tagline_fa: 'فارسی', tagline_en: 'English', deliverables: [{ en: 'Both', fa: 'هر دو' }] } })).status, 200);
  // a title missing in one language cannot be published; unpublished drafts are free
  f = await fields(await t.fetchAdmin('/services', { method: 'POST', body: { slug: 'consulting', title_en: 'Consulting', published: true } }));
  assert.ok(f.title_fa && f.published);
  const draft = await t.fetchAdmin('/services', { method: 'POST', body: { slug: 'consulting', title_en: 'Consulting', tagline_en: 'draft' } });
  assert.equal(draft.status, 200);
  const { id } = await draft.json();
  assert.equal((await t.fetchAdmin(`/services/${id}`, { method: 'DELETE' })).status, 200);
  await t.fetchAdmin(`/services/${s.id}`, { method: 'PUT', body: { published: false, tagline_fa: '', tagline_en: '', deliverables: [] } });
});

test('admin: validation (json item schemas, max 24, slug rules), catalogue rows protected, custom service CRUD, reorder', async () => {
  const s = db.prepare("SELECT id FROM services WHERE slug='ai-agent'").get();
  const bad = await t.fetchAdmin(`/services/${s.id}`, { method: 'PUT', body: { deliverables: 'nope', faqs: [{ q_en: 5, a_en: ['x'] }], related_projects: ['Bad Slug'], process: new Array(25).fill({ title_en: 'x' }) } });
  assert.equal(bad.status, 422);
  const j = await bad.json();
  assert.ok(j.fields.deliverables && j.fields['faqs[0].a_en'] && j.fields.related_projects && j.fields.process, JSON.stringify(j.fields));
  assert.match(j.fields.related_projects, /related_projects\[0\] must be a slug/);
  const tooLong = await t.fetchAdmin(`/services/${s.id}`, { method: 'PUT', body: { deliverables: [{ en: 'x'.repeat(301) }] } });
  assert.equal(tooLong.status, 422);

  assert.equal((await t.fetchAdmin(`/services/${s.id}`, { method: 'DELETE' })).status, 409);
  assert.equal((await t.fetchAdmin(`/services/${s.id}`, { method: 'PUT', body: { slug: 'ai-agents' } })).status, 409);
  assert.equal((await t.fetchAdmin('/services', { method: 'POST', body: { slug: 'work', title_en: 'x' } })).status, 422);
  assert.equal((await t.fetchAdmin('/services', { method: 'POST', body: { slug: 'ai-agent', title_en: 'x' } })).status, 409);

  const created = await t.fetchAdmin('/services', { method: 'POST', body: { slug: 'seo', title_fa: 'سئو', title_en: 'SEO', published: true } });
  assert.equal(created.status, 200);
  const { id } = await created.json();
  assert.equal((await get('/en/services/seo')).r.status, 200);
  const list = await (await t.fetchAdmin('/services')).json();
  assert.equal(list.length, 11);
  const ids = list.map(x => x.id).reverse();
  assert.equal((await t.fetchAdmin('/services/reorder', { method: 'POST', body: { ids } })).status, 200);
  assert.deepEqual((await (await t.fetchAdmin('/services')).json()).map(x => x.id), ids);
  assert.equal((await t.fetchAdmin(`/services/${id}`, { method: 'DELETE' })).status, 200);
  assert.equal((await get('/en/services/seo')).r.status, 404);
  const rows = db.prepare("SELECT action FROM audit_log WHERE entity='services'").all().map(r => r.action);
  assert.ok(rows.includes('publish') && rows.includes('delete'));
});
