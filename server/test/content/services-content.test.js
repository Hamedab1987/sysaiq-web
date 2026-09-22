// Services content (content/services/*.json) + scripts/content-apply.mjs:
// every file is complete in both languages and free of fabricated facts
// (prices, Latin digits in Persian prose, forbidden words), related slugs
// are real portfolio systems, the apply script is idempotent, and applied
// services render at /fa|en/services/<slug>.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startTestApp } from '../helpers.js';

const ROOT = join(import.meta.dirname, '..', '..');
const DIR = join(ROOT, 'content', 'services');
const SLUGS = ['custom-website', 'profession-landing', 'web-app', 'ecommerce', 'mobile-app',
  'ai-agent', 'automation', 'accounting-systems', 'trading-systems', 'support-maintenance'];
const PROJECT_KEYS = new Set(JSON.parse(readFileSync(join(ROOT, 'data-projects.json'), 'utf8')).map(p => p.key));

const files = Object.fromEntries(readdirSync(DIR).filter(f => f.endsWith('.json')).map(f => [f.replace(/\.json$/, ''), JSON.parse(readFileSync(join(DIR, f), 'utf8'))]));

const TEXT_KEYS = ['title', 'tagline', 'summary', 'audience', 'problems', 'timeline', 'price_approach', 'meta_desc'];
// every string a reader can see, tagged by language
function strings(s) {
  const out = [];
  for (const k of TEXT_KEYS) for (const l of ['fa', 'en']) out.push({ lang: l, path: `${k}_${l}`, text: s[`${k}_${l}`] });
  s.deliverables.forEach((d, i) => { out.push({ lang: 'fa', path: `deliverables[${i}].fa`, text: d.fa }); out.push({ lang: 'en', path: `deliverables[${i}].en`, text: d.en }); });
  s.process.forEach((p, i) => { for (const k of ['title', 'desc']) for (const l of ['fa', 'en']) out.push({ lang: l, path: `process[${i}].${k}_${l}`, text: p[`${k}_${l}`] }); });
  s.faqs.forEach((f, i) => { for (const k of ['q', 'a']) for (const l of ['fa', 'en']) out.push({ lang: l, path: `faqs[${i}].${k}_${l}`, text: f[`${k}_${l}`] }); });
  return out;
}
// what the Latin-digit rule exempts: inline code, URLs and {{site.*}} tokens
const prose = t => t.replace(/`[^`]*`/g, '').replace(/https?:\/\/\S+/g, '').replace(/\{\{[^}]*\}\}/g, '');

test('all ten service files exist, parse, and carry every field in both languages', () => {
  assert.deepEqual(Object.keys(files).sort(), [...SLUGS].sort());
  for (const slug of SLUGS) {
    const s = files[slug];
    assert.equal(s.slug, slug);
    assert.ok(Number.isInteger(s.sort) && s.sort > 0, `${slug}: sort`);
    assert.ok(typeof s.icon === 'string' && /^[a-z-]{2,20}$/.test(s.icon), `${slug}: icon`);
    for (const { path, text } of strings(s)) assert.ok(typeof text === 'string' && text.trim().length > 0, `${slug}: ${path} is empty`);
    for (const l of ['fa', 'en']) {
      assert.ok(s[`summary_${l}`].length <= 160, `${slug}: summary_${l} > 160 chars`);
      assert.ok(s[`meta_desc_${l}`].length <= 160, `${slug}: meta_desc_${l} > 160 chars`);
    }
    assert.ok(s.deliverables.length >= 4 && s.deliverables.length <= 7, `${slug}: ${s.deliverables.length} deliverables`);
    assert.equal(s.process.length, 6, `${slug}: process must have the 6 shared steps`);
    assert.deepEqual(s.process.map(p => p.title_fa), ['نیازسنجی', 'پیشنهاد کتبی', 'قرارداد', 'ساخت مرحله‌ای', 'تحویل و آموزش', 'پشتیبانی'], `${slug}: process titles`);
    assert.ok(s.faqs.length >= 4 && s.faqs.length <= 6, `${slug}: ${s.faqs.length} faqs`);
    assert.ok((s.problems_fa.match(/^- /gm) || []).length >= 3 && (s.problems_fa.match(/^- /gm) || []).length <= 5, `${slug}: problems_fa bullets`);
    assert.ok(Array.isArray(s.related_projects) && s.related_projects.length > 0, `${slug}: related_projects`);
  }
});

test('related_projects are real portfolio slugs (data-projects.json keys)', () => {
  for (const slug of SLUGS) for (const p of files[slug].related_projects) assert.ok(PROJECT_KEYS.has(p), `${slug}: unknown project "${p}"`);
});

test('Persian prose uses Persian digits; nothing is priced; no forbidden words; facts only via tokens', () => {
  const PRICE = /تومان|ریال|\$|€|\d{2,}[,٬]\d{3}/;
  const FORBIDDEN_FA = /تضمینی|بهترین|۱۰۰٪|100%/;
  const FORBIDDEN_EN = /guaranteed|world-class|cutting-edge|best-in-class/i;
  const LITERAL_FACT = /hello@sysaiq\.com|0912|۰۹۱۲|33323002|۳۳۳۲۳۰۰۲|\+98/;
  for (const slug of SLUGS) {
    for (const { lang, path, text } of strings(files[slug])) {
      const where = `${slug}: ${path}`;
      assert.ok(!PRICE.test(text), `${where} looks like a price`);
      assert.ok(!LITERAL_FACT.test(text), `${where} types a contact fact literally (use {{site.*}})`);
      if (lang === 'fa') {
        assert.ok(!/[0-9]/.test(prose(text)), `${where} has Latin digits in Persian prose`);
        assert.ok(!FORBIDDEN_FA.test(text), `${where} uses a forbidden word`);
        assert.ok(!/[يك]/.test(text), `${where} uses Arabic ي/ك`);
        assert.ok(!/ه‌ی /.test(text), `${where} uses «ه‌ی» instead of «هٔ»`);
        assert.ok(!/(^|\s)ن?می [؀-ۿ]/.test(text) && !/ های /.test(text), `${where} is missing a نیم‌فاصله`);
      } else {
        assert.ok(!FORBIDDEN_EN.test(text), `${where} uses a forbidden word`);
        assert.ok(!/[۰-۹]/.test(text), `${where} has Persian digits in English`);
      }
    }
  }
});

test('trading-systems is framed as software engineering with a risk disclaimer', () => {
  const s = files['trading-systems'];
  assert.ok(/سلب مسئولیت/.test(s.problems_fa) && /Disclaimer/.test(s.problems_en));
  assert.ok(/سیگنال معاملاتی نمی‌دهد/.test(s.problems_fa) && /does not provide trading signals/.test(s.problems_en));
  assert.ok(/سرمایه مدیریت نمی‌کند/.test(s.problems_fa) && /does not manage assets/.test(s.problems_en));
  assert.deepEqual(s.related_projects, ['trading']);
});

// ---- apply script + rendering (one app, temp DATA_DIR) ---------------------
let t, db, applyKind;
before(async () => {
  t = await startTestApp();
  ({ db } = await import('../../src/db/index.js'));
  ({ applyKind } = await import('../../scripts/content-apply.mjs'));
});
after(async () => { await t.close(); });

test('content-apply services: fills the 10 seeded rows (creating a missing one), --publish flips published, second run changes nothing', () => {
  // migration 009 seeds the slugs unpublished; drop one to exercise INSERT
  db.prepare("DELETE FROM services WHERE slug='support-maintenance'").run();
  const keptId = db.prepare("SELECT id FROM services WHERE slug='ai-agent'").get().id;

  const first = applyKind(db, 'services', { publish: true });
  assert.deepEqual(first, { total: 10, created: 1, updated: 9, unchanged: 0, published: 10 });
  assert.equal(db.prepare("SELECT id FROM services WHERE slug='ai-agent'").get().id, keptId, 'id is kept');
  const rows = db.prepare('SELECT * FROM services ORDER BY sort').all();
  assert.equal(rows.length, 10);
  assert.deepEqual(rows.map(r => r.slug), SLUGS);
  for (const r of rows) {
    assert.equal(r.published, 1);
    assert.equal(r.updated_by, 'content-apply');
    for (const k of TEXT_KEYS) for (const l of ['fa', 'en']) assert.ok(r[`${k}_${l}`].trim(), `${r.slug}.${k}_${l} stored`);
    assert.equal(JSON.parse(r.deliverables).length, files[r.slug].deliverables.length);
    assert.equal(JSON.parse(r.process).length, 6);
    assert.deepEqual(JSON.parse(r.related_projects), files[r.slug].related_projects);
  }

  const stamps = db.prepare('SELECT slug, updated_at FROM services ORDER BY slug').all();
  const second = applyKind(db, 'services', { publish: true });
  assert.deepEqual(second, { total: 10, created: 0, updated: 0, unchanged: 10, published: 0 });
  assert.deepEqual(db.prepare('SELECT slug, updated_at FROM services ORDER BY slug').all(), stamps, 'untouched rows keep updated_at');

  // without --publish an owner's unpublish decision survives a re-apply
  db.prepare("UPDATE services SET published=0 WHERE slug='web-app'").run();
  const third = applyKind(db, 'services');
  assert.equal(third.updated, 0);
  assert.equal(db.prepare("SELECT published FROM services WHERE slug='web-app'").get().published, 0);
  applyKind(db, 'services', { publish: true });
});

test('content-apply pages: applies the legal-content shape (booleans → 0/1) from a given directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sysaiq-pages-'));
  writeFileSync(join(dir, 'about.json'), JSON.stringify({
    slug: 'about', title_en: 'About', title_fa: 'دربارهٔ ما', body_en: 'Body {{site.email}}', body_fa: 'متن {{site.email}}',
    meta_desc_en: 'm', meta_desc_fa: 'م', version: '1.0', effective_at: '2026-09-22', show_in_footer: true, show_in_nav: false, sort: 5,
  }));
  const before1 = db.prepare("SELECT id FROM pages WHERE slug='about'").get();
  const r1 = applyKind(db, 'pages', { dir });
  assert.equal(r1.created + r1.updated, 1);
  const row = db.prepare("SELECT * FROM pages WHERE slug='about'").get();
  if (before1) assert.equal(row.id, before1.id);
  assert.equal(row.show_in_footer, 1);
  assert.equal(row.show_in_nav, 0);
  assert.equal(row.version, '1.0');
  assert.equal(row.body_fa, 'متن {{site.email}}');
  assert.equal(row.published, before1 ? 0 : 0, 'never published without --publish');
  assert.deepEqual(applyKind(db, 'pages', { dir }), { total: 1, created: 0, updated: 0, unchanged: 1, published: 0 });
});

test('applied services render in both languages with tokens resolved and no markdown leaking', async () => {
  const { invalidate } = await import('../../src/lib/cache.js');
  invalidate();
  const idx = await (await fetch(t.base + '/fa/services')).text();
  for (const slug of SLUGS) assert.ok(idx.includes(`href="/fa/services/${slug}"`), `index card for ${slug}`);

  for (const slug of SLUGS) {
    for (const lang of ['fa', 'en']) {
      const r = await fetch(`${t.base}/${lang}/services/${slug}`);
      assert.equal(r.status, 200, `${lang}/${slug}`);
      const html = await r.text();
      const s = files[slug];
      assert.ok(html.includes(`<h1>${s[`title_${lang}`]}</h1>`), `${lang}/${slug} h1`);
      assert.ok(html.includes('id="deliverables"') && html.includes('id="process"') && html.includes('id="faqs"') && html.includes('id="timeline"') && html.includes('id="price"'), `${lang}/${slug} sections`);
      assert.ok(!html.includes('{{site.'), `${lang}/${slug} leaves a token unresolved`);
      assert.ok(!html.includes('<p class="proposal">'), `${lang}/${slug} fell back to the proposal line`);
      assert.ok(!/<p>- |<p>\*\*/.test(html), `${lang}/${slug} leaks markdown`);
    }
  }
  const trading = await (await fetch(t.base + '/fa/services/trading-systems')).text();
  assert.ok(trading.includes('سلب مسئولیت'));
  const en = await (await fetch(t.base + '/en/services/custom-website')).text();
  assert.ok(en.includes('hello@sysaiq.com'), 'the {{site.email}} token renders the configured email');
});
