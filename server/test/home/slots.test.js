// render/slots/work.js + faq.js: DB-driven sections with the exact
// ids/classes the home page CSS and script depend on.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp } from '../helpers.js';
import { readFileSync } from 'node:fs';

const t = await startTestApp();
await t.loginAsAdmin();
const { db } = await import('../../src/db/index.js');
const { invalidate } = await import('../../src/lib/cache.js');
const { renderWorkSlot, homeProjects, imageSrc } = await import('../../src/render/slots/work.js');
const { renderFaqSlot } = await import('../../src/render/slots/faq.js');
const DEFAULTS = JSON.parse(readFileSync(new URL('../../templates/content-defaults.json', import.meta.url), 'utf8'));

const home = async lang => (await fetch(`${t.base}/${lang}/`)).text();
const insProject = db.prepare(`INSERT INTO projects (slug, title_en, title_fa, desc_en, desc_fa, tags, image, cover_en, cover_fa, sort, published, show_on_home)
  VALUES (@slug, @title_en, @title_fa, @desc_en, @desc_fa, @tags, @image, @cover_en, @cover_fa, @sort, @published, @show_on_home)`);
const insFaq = db.prepare('INSERT INTO faqs (q_en, q_fa, a_en, a_fa, sort, published, show_on_home) VALUES (?,?,?,?,?,?,?)');

test.after(() => t.close());

test('work slot without any project: heading + button, no #showcase (the script bails out on a missing #showcase)', async () => {
  const html = renderWorkSlot('fa');
  assert.ok(html.startsWith('<section id="work" class="light" data-phase="3">'));
  assert.ok(html.includes(`<h2 class="rv">${DEFAULTS.WORK_H2.fa}</h2>`));
  assert.ok(html.includes(`<a class="work-all-btn" href="/fa/work">${DEFAULTS.WORK_ALL.fa}</a>`));
  assert.ok(!html.includes('id="showcase"'));
  assert.ok((await home('fa')).includes('<section id="work"'), 'section still on the page');
});

test('faq slot without any FAQ renders nothing', async () => {
  db.prepare('DELETE FROM faqs').run();
  invalidate();
  assert.equal(renderFaqSlot('en'), '');
  assert.ok(!(await home('en')).includes('<section id="faq"'));
});

test('work slot: 9 published show_on_home projects in sort order, first "on", hidden/unpublished/extra excluded, escaped', async () => {
  db.prepare('DELETE FROM projects').run();
  const mk = (slug, sort, extra = {}) => insProject.run({
    slug, title_en: `T ${slug}`, title_fa: `ع ${slug}`, desc_en: `D ${slug}`, desc_fa: `توضیح ${slug}`, tags: 'A · B',
    image: `../assets/projects/${slug}-cover.jpg`, cover_en: `../assets/projects/${slug}-full.jpg`, cover_fa: '', sort, published: 1, show_on_home: 1, ...extra,
  });
  mk('p10', 10); mk('p09', 9); mk('p08', 8); mk('p07', 7); mk('p06', 6); mk('p05', 5); mk('p04', 4); mk('p03', 3);
  mk('p02', 2, { cover_fa: '../assets/projects/p02-fa-full.jpg' });   // localized Persian screenshot, like the seed
  mk('hidden', 1, { show_on_home: 0 });          // published but not on home
  mk('draft', 0, { published: 0 });               // on home but unpublished
  mk('p01', 1, { title_en: 'A <b>&</b> "q"', desc_en: 'x<y', tags: '<i>', cover_en: '', image: '../assets/projects/p01-cover.jpg' });
  mk('tenth', 11);                                // 10th published → cut by LIMIT 9
  invalidate();

  const rows = homeProjects();
  assert.deepEqual(rows.map(r => r.slug), ['p01', 'p02', 'p03', 'p04', 'p05', 'p06', 'p07', 'p08', 'p09']);

  const html = await home('en');
  const section = html.slice(html.indexOf('<section id="work"'), html.indexOf('</section>', html.indexOf('<section id="work"')));
  for (const id of ['id="showcase"', 'id="sc-stage"', 'id="sc-bar"', 'id="sc-list"']) assert.ok(section.includes(id), id);
  const slides = [...section.matchAll(/<a class="sc-slide( on)?" href="([^"]+)"><img src="([^"]*)" alt="([^"]*)"( loading="lazy")?><\/a>/g)];
  assert.equal(slides.length, 9);
  assert.equal(slides[0][1], ' on', 'first slide on');
  assert.ok(slides.slice(1).every(s => !s[1]), 'only the first is on');
  assert.equal(slides[0][5], undefined, 'first image eager');
  assert.ok(slides.slice(1).every(s => s[5]), 'the rest lazy');
  assert.deepEqual(slides.map(s => s[2]), rows.map(r => `/en/work/${r.slug}`));
  assert.equal(slides[0][3], '/assets/projects/p01-cover.jpg', 'falls back to image when cover_en is empty, ../assets → /assets');
  assert.equal(slides[1][3], '/assets/projects/p02-full.jpg', 'en: cover_en even when a cover_fa exists');
  assert.equal(slides[0][4], 'A &lt;b&gt;&amp;&lt;/b&gt; &quot;q&quot;', 'alt escaped');

  const rowsHtml = [...section.matchAll(/<a class="sc-row( on)?" href="([^"]+)">\s*<span class="sc-num">(\d\d)<\/span>\s*<span class="sc-titles"><b>(.*?)<\/b><em class="sc-desc">(.*?)<\/em><i>(.*?)<\/i><\/span>\s*<span class="sc-arrow">→<\/span>\s*<\/a>/g)];
  assert.equal(rowsHtml.length, 9);
  assert.equal(rowsHtml[0][1], ' on');
  assert.deepEqual(rowsHtml.map(r => r[3]), ['01', '02', '03', '04', '05', '06', '07', '08', '09']);
  assert.equal(rowsHtml[0][4], 'A &lt;b&gt;&amp;&lt;/b&gt; &quot;q&quot;');
  assert.equal(rowsHtml[0][5], 'x&lt;y');
  assert.equal(rowsHtml[0][6], '&lt;i&gt;');
  assert.equal(rowsHtml[1][4], 'T p02');
  assert.ok(!section.includes('hidden') && !section.includes('draft') && !section.includes('tenth'));
  assert.ok(section.includes(`<span class="work-hint mono rv d1">${DEFAULTS.WORK_HINT.en}</span>`));

  // Persian side uses the fa columns, /fa/ links and the localized cover when there is one
  const fa = renderWorkSlot('fa');
  assert.ok(fa.includes('<b>ع p02</b><em class="sc-desc">توضیح p02</em>'));
  assert.ok(fa.includes('href="/fa/work/p02"'));
  const faSlides = [...fa.matchAll(/<a class="sc-slide(?: on)?" href="\/fa\/work\/(p\d\d)"><img src="([^"]*)"/g)].map(m => [m[1], m[2]]);
  assert.deepEqual(faSlides.slice(0, 3), [
    ['p01', '/assets/projects/p01-cover.jpg'],      // no covers at all → image
    ['p02', '/assets/projects/p02-fa-full.jpg'],    // cover_fa wins on /fa/
    ['p03', '/assets/projects/p03-full.jpg'],       // no cover_fa → cover_en
  ]);
});

test('work slot: WORK_H2 / WORK_HINT / WORK_ALL come from content (override wins)', async () => {
  const r = await t.fetchAdmin('/content/WORK_ALL', { method: 'PUT', body: { fa: 'همهٔ کارها', en: 'All <work>' } });
  assert.equal(r.status, 200);
  assert.ok((await home('fa')).includes('<a class="work-all-btn" href="/fa/work">همهٔ کارها</a>'));
  assert.ok((await home('en')).includes('<a class="work-all-btn" href="/en/work">All &lt;work&gt;</a>'));
  await t.fetchAdmin('/content/WORK_ALL', { method: 'DELETE' });
});

test('imageSrc accepts site-relative and http(s) sources only, per language', () => {
  assert.equal(imageSrc({ cover_en: '../assets/projects/a-full.jpg' }), '/assets/projects/a-full.jpg');
  assert.equal(imageSrc({ cover_en: '../assets/a-full.jpg', cover_fa: '../assets/a-fa-full.jpg' }, 'fa'), '/assets/a-fa-full.jpg');
  assert.equal(imageSrc({ cover_en: '../assets/a-full.jpg', cover_fa: '../assets/a-fa-full.jpg' }, 'en'), '/assets/a-full.jpg');
  assert.equal(imageSrc({ cover_en: '../assets/a-full.jpg', cover_fa: null }, 'fa'), '/assets/a-full.jpg');
  assert.equal(imageSrc({ cover_fa: 'javascript:alert(1)', cover_en: '/assets/a.jpg' }, 'fa'), '', 'a bad cover_fa is refused, not silently replaced');
  assert.equal(imageSrc({ cover_en: '../../assets/x.jpg' }), '/assets/x.jpg');
  assert.equal(imageSrc({ cover_en: '', image: '/uploads/x.png' }), '/uploads/x.png');
  assert.equal(imageSrc({ cover_en: 'https://cdn.example.com/a.jpg' }), 'https://cdn.example.com/a.jpg');
  assert.equal(imageSrc({ cover_en: 'javascript:alert(1)' }), '');
  assert.equal(imageSrc({ cover_en: '//evil.example/x.jpg' }), '');
  assert.equal(imageSrc({ cover_en: 'assets/x.jpg' }), '');
  assert.equal(imageSrc({}), '');
});

test('faq slot: published show_on_home rows in sort order, first open, answers via renderInline, FAQ_H2 from content', async () => {
  db.prepare('DELETE FROM faqs').run();
  insFaq.run('Second?', 'دوم؟', 'Two', 'دو', 2, 1, 1);
  insFaq.run('First <q>?', 'اول؟', 'One *em*\nnext', 'یک', 1, 1, 1);
  insFaq.run('Hidden?', 'پنهان؟', 'no', 'نه', 0, 1, 0);      // show_on_home = 0
  insFaq.run('Draft?', 'پیش‌نویس؟', 'no', 'نه', 0, 0, 1);    // unpublished
  invalidate();
  const html = await home('en');
  const section = html.slice(html.indexOf('<section id="faq"'), html.indexOf('</section>', html.indexOf('<section id="faq"')));
  assert.ok(section.startsWith('<section id="faq" class="light" data-phase="3">'));
  assert.ok(section.includes('<span class="faq-star rv">✳</span>'));
  assert.ok(section.includes(`<h2 class="rv d1">${DEFAULTS.FAQ_H2.en}</h2>`));
  const items = [...section.matchAll(/<div class="qa( open)?">\s*<button class="qa-q">(.*?) <span class="sign">\+<\/span><\/button>\s*<div class="qa-a"><p>(.*?)<\/p><\/div>\s*<\/div>/gs)];
  assert.equal(items.length, 2);
  assert.equal(items[0][1], ' open');
  assert.equal(items[1][1], undefined);
  assert.equal(items[0][2], 'First &lt;q&gt;?');
  assert.equal(items[0][3], 'One <em>em</em><br>next');
  assert.equal(items[1][2], 'Second?');
  assert.ok(!section.includes('Hidden') && !section.includes('Draft'));

  await t.fetchAdmin('/content/FAQ_H2', { method: 'PUT', body: { fa: 'پرسش‌ها' } });
  assert.ok(renderFaqSlot('fa').includes('<h2 class="rv d1">پرسش‌ها</h2>'));
  assert.ok(renderFaqSlot('fa').includes('<button class="qa-q">اول؟ <span class="sign">+</span></button>'));
  await t.fetchAdmin('/content/FAQ_H2', { method: 'DELETE' });
});

test('the slot modules expose renderSlot(lang), render({lang}) and a default export that agree', async () => {
  const w = await import('../../src/render/slots/work.js');
  const f = await import('../../src/render/slots/faq.js');
  assert.equal(w.renderSlot('en'), w.render({ lang: 'en' }));
  assert.equal(w.renderSlot('en'), w.default('en'));
  assert.equal(f.renderSlot('fa'), f.render({ lang: 'fa' }));
  assert.equal(f.renderSlot('fa'), f.default('fa'));
});
