// render/slots/news.js: the home page's #news block. '' until something is
// published; then one .solid section with the 3 latest briefs, placed
// right after the work showcase, escaped, bilingual, and gone again
// when the items are unpublished (the admin write drops the cached page).
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp } from '../helpers.js';

let t, items, slot;
const ids = [];
const brief = (n, over = {}) => ({
  ok: true, note: '',
  fields: {
    importance: 3, category: ['models', 'tools', 'devices', 'tech'][n % 4], tags: ['agents'],
    title_fa: `خبر شمارهٔ ${n} دربارهٔ Agentها`, title_en: `Brief number ${n} about agents`,
    summary_fa: `خلاصهٔ کوتاه خبر ${n}.`, summary_en: `Short summary of brief ${n}.`,
    why_fa: 'برای کسب‌وکارها مهم است.', why_en: 'It matters for businesses.',
    ...over,
  },
});

before(async () => {
  t = await startTestApp();
  items = await import('../../src/news/items.js');
  slot = await import('../../src/render/slots/news.js');
  for (let n = 1; n <= 4; n++) {
    const id = items.insertCollected({ sourceName: 'Lab', title: `Source ${n}`, link: `https://lab.example/p/${n}`, date: new Date().toISOString(), summary: 'Excerpt.', category: 'industry' });
    items.applySummary(id, n === 4
      ? brief(n, { title_en: '<script>alert(1)</script> Evil & co', title_fa: 'عنوان <img src=x onerror=alert(1)>' })
      : brief(n));
    ids.push(id);
  }
  await t.loginAsAdmin();
});
after(async () => { await t.close(); });

const home = async lang => (await fetch(`${t.base}/${lang}/`)).text();
const publish = id => t.fetchAdmin(`/news/items/${id}/publish`, { method: 'POST', body: {} });

test('nothing published: the slot renders nothing and the home page has no #news', async () => {
  assert.equal(slot.renderSlot('fa'), '');
  assert.equal(slot.renderSlot('en'), '');
  const html = await home('fa');
  assert.ok(html.includes('id="work"') && html.includes('id="contact"'), 'home page rendered from the template');
  assert.ok(!html.includes('id="news"'));
  assert.ok(!html.includes('{{SLOT_NEWS}}') && !html.includes('SLOT:NEWS'));
});

test('published items: one .solid section with the 3 latest cards, in both languages', async () => {
  for (const id of ids) assert.equal((await publish(id)).status, 200);
  const fa = slot.renderSlot('fa');
  assert.equal((fa.match(/<section id="news" class="solid" data-phase="3"/g) || []).length, 1);
  assert.equal((fa.match(/class="card nw-card"/g) || []).length, 3);
  assert.ok(fa.includes('<span class="eyebrow mono rv d1" dir="ltr">[ SYSAIQ—SIGNAL / SYS.06 ]</span>'));
  assert.ok(fa.includes('تازه‌های <em>AI</em> و فناوری'));
  assert.ok(fa.includes('href="/fa/news">همهٔ اخبار ←</a>'));
  assert.ok(/<link rel="stylesheet" href="\/assets\/site\/news\.css\?v=[0-9a-z]+">/.test(fa));
  assert.match(fa, /href="\/fa\/news\/[a-z0-9-]+"/);
  assert.ok(fa.includes('<time datetime="'), 'dated');
  assert.ok(/nw-cover nw-c-(models|tools|devices|tech|industry)/.test(fa), 'brand cover by category');
  assert.ok(!/<img\b/.test(fa), 'no source images');
  // newest first: the last published (the "evil" one) leads, escaped
  assert.ok(fa.includes('عنوان &lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(!fa.includes('<img src=x'));
  const en = slot.renderSlot('en');
  assert.equal((en.match(/class="card nw-card"/g) || []).length, 3);
  assert.ok(en.includes('AI &amp; tech <em>signal</em>'));
  assert.ok(en.includes('&lt;script&gt;alert(1)&lt;/script&gt; Evil &amp; co'));
  assert.ok(!en.includes('<script>alert'));
  assert.ok(en.includes('href="/en/news">All news →</a>'));
  assert.match(en, /href="\/en\/news\/[a-z0-9-]+"/);
  assert.ok(!en.includes('همهٔ اخبار'));
});

// (the FAQ slot renders nothing on an empty test database, so the contact
// finale is the next landmark)
test('home page: #news sits right after the work showcase, once, no script in the block', async () => {
  for (const lang of ['fa', 'en']) {
    const r = await fetch(`${t.base}/${lang}/`);
    const html = await r.text();
    assert.equal((html.match(/id="news"/g) || []).length, 1, lang);
    const [work, news, next] = ['id="work"', 'id="news"', 'id="contact"'].map(s => html.indexOf(s));
    assert.ok(work > 0 && work < news && news < next, `${lang}: order work → news → contact`);
    // the slot adds no executable inline script (the home CSP hashes the template's own)
    // (up to the end of #news: the NEWS_FEED carousel under the FAQ loads its own external script)
    const section = html.slice(html.indexOf('<link rel="stylesheet" href="/assets/site/news.css'), html.indexOf('</section>', news));
    assert.ok(!/<script\b/.test(section) && !/<[^>]+\son[a-z]+=/i.test(section), `${lang}: no script/handler in the block`);
  }
});

test('unpublishing everything removes the section again', async () => {
  for (const id of ids) assert.equal((await t.fetchAdmin(`/news/items/${id}/restore`, { method: 'POST', body: {} })).status, 200);
  assert.equal(slot.renderSlot('fa'), '');
  assert.ok(!(await home('fa')).includes('id="news"'));
});
