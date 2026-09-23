// Project content (content/projects/*.json) + scripts/content-apply.mjs "projects":
// all 17 systems are complete in both languages, lengths are respected, the
// Persian is native (digits, ي/ك, «هٔ», نیم‌فاصله), nothing is a client name or
// a results figure (outcome_* is qualitative), gallery files exist on disk,
// category/service_slug are valid, and the apply script is idempotent while
// never touching image/cover_*/sort/published/show_on_home — even on a table
// that lacks the migration-013 columns (skipped with a warning).
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { startTestApp } from '../helpers.js';

const ROOT = join(import.meta.dirname, '..', '..');
const DIR = join(ROOT, 'content', 'projects');
const IMG_DIR = join(ROOT, '..', 'vesper-project', 'assets', 'projects');
const SLUGS = ['restaurant', 'realestate', 'medical', 'trading', 'ecommerce', 'accounting', 'pos', 'salon',
  'distribution', 'law-landing', 'dental-landing', 'fitness-landing', 'cafe-landing', 'architect-landing',
  'hotel', 'school', 'hr'];
const FA_IMG = new Set(['accounting', 'distribution', 'ecommerce', 'medical', 'pos', 'realestate', 'restaurant', 'salon']);
const CATEGORIES = ['business-systems', 'profession-landing', 'ai-automation', 'finance-trading'];
const SERVICES = ['custom-website', 'profession-landing', 'web-app', 'ecommerce', 'mobile-app',
  'ai-agent', 'automation', 'accounting-systems', 'trading-systems', 'support-maintenance'];
const TEXT_KEYS = ['title', 'tagline', 'desc', 'overview', 'problem', 'solution', 'outcome', 'tech', 'seo_title', 'seo_desc'];
const NEW_COLUMNS = ['category', 'problem_en', 'problem_fa', 'solution_en', 'solution_fa', 'outcome_en', 'outcome_fa',
  'tech_en', 'tech_fa', 'gallery', 'service_slug', 'seo_title_en', 'seo_title_fa', 'seo_desc_en', 'seo_desc_fa'];
const OWNER_COLUMNS = ['image', 'cover_en', 'cover_fa', 'sort', 'published', 'show_on_home'];

const files = Object.fromEntries(readdirSync(DIR).filter(f => f.endsWith('.json')).map(f => [f.replace(/\.json$/, ''), JSON.parse(readFileSync(join(DIR, f), 'utf8'))]));

// every string a reader can see, tagged by language
function strings(p) {
  const out = [];
  for (const k of TEXT_KEYS) for (const l of ['fa', 'en']) out.push({ lang: l, path: `${k}_${l}`, text: p[`${k}_${l}`] });
  (p.industries || []).forEach((d, i) => { out.push({ lang: 'fa', path: `industries[${i}].fa`, text: d.fa }); out.push({ lang: 'en', path: `industries[${i}].en`, text: d.en }); });
  (p.features || []).forEach((f, i) => { for (const k of ['title', 'desc']) for (const l of ['fa', 'en']) out.push({ lang: l, path: `features[${i}].${k}_${l}`, text: f[`${k}_${l}`] }); });
  (p.pages || []).forEach((g, i) => { for (const k of ['name', 'desc']) for (const l of ['fa', 'en']) out.push({ lang: l, path: `pages[${i}].${k}_${l}`, text: g[`${k}_${l}`] }); });
  (p.gallery || []).forEach((g, i) => { for (const l of ['fa', 'en']) out.push({ lang: l, path: `gallery[${i}].caption_${l}`, text: g[`caption_${l}`] }); });
  return out;
}
// what the Latin-digit rule exempts: inline code and URLs
const prose = t => t.replace(/`[^`]*`/g, '').replace(/https?:\/\/\S+/g, '').replace(/\/assets\/\S+/g, '');

test('all 17 project files exist, parse, and carry every field in both languages with lengths respected', () => {
  assert.deepEqual(Object.keys(files).sort(), [...SLUGS].sort());
  for (const slug of SLUGS) {
    const p = files[slug];
    assert.equal(p.slug, slug);
    for (const { path, text } of strings(p)) assert.ok(typeof text === 'string' && text.trim().length > 0, `${slug}: ${path} is empty`);
    for (const l of ['fa', 'en']) {
      assert.ok(p[`tagline_${l}`].length <= 90, `${slug}: tagline_${l} > 90 chars (${p[`tagline_${l}`].length})`);
      assert.ok(p[`desc_${l}`].length <= 140, `${slug}: desc_${l} > 140 chars (${p[`desc_${l}`].length})`);
      assert.ok(p[`seo_title_${l}`].length <= 60, `${slug}: seo_title_${l} > 60 chars (${p[`seo_title_${l}`].length})`);
      assert.ok(p[`seo_desc_${l}`].length <= 160, `${slug}: seo_desc_${l} > 160 chars (${p[`seo_desc_${l}`].length})`);
      assert.ok(p[`overview_${l}`].length >= 120, `${slug}: overview_${l} too short`);
      for (const k of ['problem', 'solution', 'outcome', 'tech']) assert.ok(p[`${k}_${l}`].length >= 80, `${slug}: ${k}_${l} too short`);
    }
    assert.ok(p.industries.length >= 3 && p.industries.length <= 5, `${slug}: ${p.industries.length} industries`);
    assert.ok(p.features.length >= 4 && p.features.length <= 6, `${slug}: ${p.features.length} features`);
    assert.ok(p.pages.length >= 4 && p.pages.length <= 6, `${slug}: ${p.pages.length} pages`);
    assert.ok(/^[A-Z0-9][A-Z0-9 &\-]*( · [A-Z0-9][A-Z0-9 &\-]*)+$/.test(p.tags), `${slug}: tags "${p.tags}" are not LTR mono style`);
  }
});

test('category and service_slug are valid; landings are profession-landing; trading/accounting are finance-trading', () => {
  for (const slug of SLUGS) {
    const p = files[slug];
    assert.ok(CATEGORIES.includes(p.category), `${slug}: category "${p.category}"`);
    assert.ok(SERVICES.includes(p.service_slug), `${slug}: service_slug "${p.service_slug}"`);
    if (slug.endsWith('-landing')) {
      assert.equal(p.category, 'profession-landing', `${slug}: category`);
      assert.equal(p.service_slug, 'profession-landing', `${slug}: service_slug`);
    }
  }
  assert.equal(files.trading.category, 'finance-trading');
  assert.equal(files.trading.service_slug, 'trading-systems');
  assert.equal(files.accounting.category, 'finance-trading');
  assert.equal(files.accounting.service_slug, 'accounting-systems');
  for (const c of CATEGORIES) assert.ok(SLUGS.some(s => files[s].category === c), `no project in category ${c}`);
});

test('gallery lists only files that exist on disk: <slug>-full.jpg always, <slug>-fa-full.jpg where it exists', () => {
  for (const slug of SLUGS) {
    const g = files[slug].gallery;
    assert.ok(Array.isArray(g) && g.length >= 1, `${slug}: gallery`);
    const expected = [`/assets/projects/${slug}-full.jpg`];
    if (FA_IMG.has(slug)) expected.push(`/assets/projects/${slug}-fa-full.jpg`);
    assert.deepEqual(g.map(x => x.image), expected, `${slug}: gallery images`);
    for (const x of g) {
      assert.ok(existsSync(join(IMG_DIR, x.image.replace('/assets/projects/', ''))), `${slug}: ${x.image} missing on disk`);
      assert.ok(x.caption_en.trim() && x.caption_fa.trim(), `${slug}: gallery captions`);
    }
  }
});

test('Persian is native (digits, ي/ك, «هٔ», نیم‌فاصله); no forbidden words; no contact facts typed literally', () => {
  const FORBIDDEN_FA = /تضمینی|بهترین|۱۰۰٪|100%|تیم \d|کارشناسان ما/;
  const FORBIDDEN_EN = /guaranteed|world-class|cutting-edge|best-in-class|award-winning/i;
  const LITERAL_FACT = /hello@sysaiq\.com|0912|۰۹۱۲|33323002|۳۳۳۲۳۰۰۲|\+98/;
  const PRICE = /تومان|ریال|\$|€|\d{2,}[,٬]\d{3}/;
  for (const slug of SLUGS) {
    for (const { lang, path, text } of strings(files[slug])) {
      const where = `${slug}: ${path}`;
      assert.ok(!LITERAL_FACT.test(text), `${where} types a contact fact literally`);
      assert.ok(!PRICE.test(text), `${where} looks like a price`);
      if (lang === 'fa') {
        assert.ok(!/[0-9]/.test(prose(text)), `${where} has Latin digits in Persian prose`);
        assert.ok(!/[يك]/.test(text), `${where} uses Arabic ي/ك`);
        assert.ok(!/ه‌ی(?=[\s،؛:.!؟»)\]]|$)/.test(text), `${where} uses «ه‌ی» instead of «هٔ»`);
        assert.ok(!/(^|\s)ن?می [؀-ۿ]/.test(text) && !/ های? /.test(text) && !/ ترین? /.test(text), `${where} is missing a نیم‌فاصله`);
        assert.ok(!FORBIDDEN_FA.test(text), `${where} uses a forbidden word`);
      } else {
        assert.ok(!/[۰-۹]/.test(text), `${where} has Persian digits in English`);
        assert.ok(!FORBIDDEN_EN.test(text), `${where} uses a forbidden word`);
      }
    }
  }
});

test('outcome_* is qualitative: no percentages, no numbers, no results figures, no client names', () => {
  const FIGURE = /%|٪|[0-9]|[۰-۹]|\bx[0-9]|[0-9]x\b/;
  const CLAIM_EN = /\b(clients?|customers?) (such as|like|including)\b|\btestimonial|\bcase study for\b/i;
  const CLAIM_FA = /مشتریانی مثل|مشتریانی مانند|رضایت‌نامه|به سفارش شرکت/;
  for (const slug of SLUGS) {
    for (const l of ['fa', 'en']) {
      const text = files[slug][`outcome_${l}`];
      assert.ok(!FIGURE.test(text), `${slug}: outcome_${l} contains a figure`);
      assert.ok(!(l === 'en' ? CLAIM_EN : CLAIM_FA).test(text), `${slug}: outcome_${l} names a client`);
    }
    // the whole file stays free of fabricated counts and headcounts
    for (const { path, text } of strings(files[slug])) {
      assert.ok(!/\+\s?\d{2,}|\d{2,}\s?\+/.test(text) && !/\d+\s?(projects|clients|customers|users)\b/i.test(text), `${slug}: ${path} claims a count`);
    }
  }
});

test('trading is framed as software engineering: no signals, no returns, no performance figures', () => {
  const p = files.trading;
  for (const { path, text } of strings(p)) {
    assert.ok(!/\bsignals?\b|hit rate|win rate|R multiple|returns?\b|profit(able)?\b|guaranteed/i.test(text), `trading: ${path} makes a trading claim (${text.slice(0, 60)}…)`);
    assert.ok(!/سیگنال|نرخ برد|سود تضمین|بازدهی/.test(text), `trading: ${path} makes a trading claim (fa)`);
  }
  assert.ok(/backtest/i.test(p.overview_en) && /Backtesting|بک‌تست/.test(p.overview_fa));
  assert.ok(/software|engineering/i.test(p.outcome_en));
});

test('tech_* mentions only the confirmed stack', () => {
  const UNCONFIRMED = /\b(React|Vue|Angular|Next\.js|Flutter|Swift|Kotlin|PostgreSQL|Postgres|MongoDB|Redis|Docker|Kubernetes|AWS|Firebase|Supabase|Django|Laravel|WordPress|TypeScript)\b/i;
  const CONFIRMED = /Node\.js|Express|SQLite|SQL|JavaScript|Python|OpenAI API|WebGL/;
  for (const slug of SLUGS) for (const l of ['fa', 'en']) {
    const text = files[slug][`tech_${l}`];
    assert.ok(!UNCONFIRMED.test(text), `${slug}: tech_${l} names an unconfirmed technology`);
    assert.ok(CONFIRMED.test(text), `${slug}: tech_${l} names none of the confirmed stack`);
  }
});

// ---- apply script on a scratch table WITHOUT the migration-013 columns ------
test('content-apply projects skips columns the table lacks (with a warning), never fails, and stays idempotent', () => {
  const scratch = new Database(':memory:');
  scratch.exec(`CREATE TABLE projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT UNIQUE,
    title_en TEXT NOT NULL DEFAULT '', title_fa TEXT NOT NULL DEFAULT '',
    desc_en TEXT NOT NULL DEFAULT '', desc_fa TEXT NOT NULL DEFAULT '', tags TEXT NOT NULL DEFAULT '',
    image TEXT NOT NULL DEFAULT '', cover_en TEXT NOT NULL DEFAULT '', cover_fa TEXT NOT NULL DEFAULT '',
    tagline_en TEXT NOT NULL DEFAULT '', tagline_fa TEXT NOT NULL DEFAULT '',
    overview_en TEXT NOT NULL DEFAULT '', overview_fa TEXT NOT NULL DEFAULT '',
    industries TEXT NOT NULL DEFAULT '[]', features TEXT NOT NULL DEFAULT '[]', pages TEXT NOT NULL DEFAULT '[]',
    sort INTEGER NOT NULL DEFAULT 0, published INTEGER NOT NULL DEFAULT 1, show_on_home INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  scratch.prepare("INSERT INTO projects (slug, title_en, image, cover_en, cover_fa, sort, published, show_on_home) VALUES ('hotel','old','/i.jpg','/e.jpg','/f.jpg',15,1,1)").run();
  return import('../../scripts/content-apply.mjs').then(({ applyKind }) => {
    const warnings = [];
    const first = applyKind(scratch, 'projects', { warn: m => warnings.push(m) });
    assert.deepEqual(first.skipped.sort(), [...NEW_COLUMNS].sort(), 'every migration-013 column is reported as skipped');
    assert.equal(warnings.length, NEW_COLUMNS.length);
    assert.deepEqual({ total: first.total, created: first.created, updated: first.updated, unchanged: first.unchanged, published: first.published },
      { total: 17, created: 16, updated: 1, unchanged: 0, published: 0 });
    const hotel = scratch.prepare("SELECT * FROM projects WHERE slug='hotel'").get();
    assert.equal(hotel.title_en, files.hotel.title_en);
    assert.deepEqual([hotel.image, hotel.cover_en, hotel.cover_fa, hotel.sort, hotel.published, hotel.show_on_home], ['/i.jpg', '/e.jpg', '/f.jpg', 15, 1, 1], 'owner columns untouched');
    assert.equal(JSON.parse(hotel.features).length, files.hotel.features.length);
    const second = applyKind(scratch, 'projects', { warn: () => {} });
    assert.equal(second.unchanged, 17);
    assert.equal(second.created + second.updated, 0);
    scratch.close();
  });
});

// ---- apply script + rendering on the real schema (one app, temp DATA_DIR) ---
let t, db, applyKind;
before(async () => {
  t = await startTestApp();
  ({ db } = await import('../../src/db/index.js'));
  ({ applyKind } = await import('../../scripts/content-apply.mjs'));
});
after(async () => { await t.close(); });

test('content-apply projects on the live schema: upserts by slug, writes every column the table has, keeps owner columns, second run changes nothing', async () => {
  const cols = new Set(db.pragma('table_info(projects)').map(c => c.name));
  const has013 = NEW_COLUMNS.every(c => cols.has(c));
  // a pre-existing seeded-style row proves UPDATE keeps id and owner columns
  db.prepare("INSERT OR IGNORE INTO projects (slug, title_en, title_fa, image, cover_en, cover_fa, sort, published, show_on_home) VALUES ('pos','seed','seed','/assets/projects/pos-cover.jpg','/assets/projects/pos-full.jpg','/assets/projects/pos-fa-full.jpg',7,1,1)").run();
  const posBefore = db.prepare("SELECT id, image, cover_en, cover_fa, sort, published, show_on_home FROM projects WHERE slug='pos'").get();

  const first = applyKind(db, 'projects', { publish: true, warn: () => {} });
  assert.equal(first.total, 17);
  assert.equal(first.created + first.updated, 17);
  if (has013) assert.equal(first.skipped, undefined, 'nothing skipped once migration 013 is present');
  else assert.ok(first.skipped.length > 0, 'columns skipped on a pre-013 schema');

  const rows = db.prepare('SELECT * FROM projects ORDER BY slug').all();
  assert.deepEqual(rows.map(r => r.slug), [...SLUGS].sort());
  for (const r of rows) {
    const p = files[r.slug];
    assert.equal(r.published, 1);
    for (const k of ['title', 'tagline', 'desc', 'overview']) for (const l of ['fa', 'en']) assert.equal(r[`${k}_${l}`], p[`${k}_${l}`], `${r.slug}.${k}_${l}`);
    assert.equal(r.tags, p.tags);
    assert.equal(JSON.parse(r.features).length, p.features.length);
    assert.equal(JSON.parse(r.pages).length, p.pages.length);
    assert.deepEqual(JSON.parse(r.industries), p.industries);
    if (has013) {
      for (const k of ['problem', 'solution', 'outcome', 'tech', 'seo_title', 'seo_desc']) for (const l of ['fa', 'en']) assert.equal(r[`${k}_${l}`], p[`${k}_${l}`], `${r.slug}.${k}_${l}`);
      assert.equal(r.category, p.category);
      assert.equal(r.service_slug, p.service_slug);
      assert.deepEqual(JSON.parse(r.gallery), p.gallery);
    }
  }
  const posAfter = db.prepare("SELECT id, image, cover_en, cover_fa, sort, published, show_on_home FROM projects WHERE slug='pos'").get();
  assert.deepEqual(posAfter, posBefore, 'id and owner columns survive the upsert');

  const stamps = db.prepare('SELECT slug, updated_at FROM projects ORDER BY slug').all();
  const second = applyKind(db, 'projects', { publish: true, warn: () => {} });
  assert.equal(second.unchanged, 17);
  assert.equal(second.created + second.updated + second.published, 0);
  assert.deepEqual(db.prepare('SELECT slug, updated_at FROM projects ORDER BY slug').all(), stamps, 'untouched rows keep updated_at');

  // the owner's unpublish decision survives a re-apply without --publish
  db.prepare("UPDATE projects SET published=0 WHERE slug='school'").run();
  applyKind(db, 'projects', { warn: () => {} });
  assert.equal(db.prepare("SELECT published FROM projects WHERE slug='school'").get().published, 0);
  applyKind(db, 'projects', { publish: true, warn: () => {} });
});

test('applied projects render at /fa|en/work/<slug> with the applied title', async () => {
  const { invalidate } = await import('../../src/lib/cache.js');
  invalidate();
  for (const slug of ['restaurant', 'trading', 'law-landing', 'hr']) {
    for (const lang of ['fa', 'en']) {
      const r = await fetch(`${t.base}/${lang}/work/${slug}`);
      assert.equal(r.status, 200, `${lang}/work/${slug}`);
      const html = await r.text();
      assert.ok(html.includes(files[slug][`title_${lang}`]), `${lang}/work/${slug} shows the applied title`);
      assert.ok(!/<p>- |<p>\*\*/.test(html), `${lang}/work/${slug} leaks markdown`);
    }
  }
});
