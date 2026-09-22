// Migrations 007–009 create sections / pages / services and seed the 9
// system pages and the 10 catalogue services as UNPUBLISHED drafts; 012
// removes the `contact` page row 008 used to seed (the contact page is
// rendered from site info, never from a pages row).
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp } from '../helpers.js';

let t, db;
before(async () => {
  t = await startTestApp();
  ({ db } = await import('../../src/db/index.js'));
});
after(async () => { await t.close(); });

const cols = table => db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);

test('schema_migrations records 7, 8, 9 and 12', () => {
  const v = db.prepare('SELECT version FROM schema_migrations').all().map(r => r.version);
  for (const n of [7, 8, 9, 12]) assert.ok(v.includes(n), `version ${n}`);
  assert.ok((db.prepare('SELECT COALESCE(MAX(version),0) v FROM schema_migrations').get().v) >= 12);
});

test('sections: columns and enums per the plan', () => {
  const c = cols('sections');
  for (const k of ['slug', 'type', 'theme', 'placement', 'eyebrow', 'title_en', 'title_fa', 'body_en', 'body_fa', 'items',
    'cta_label_en', 'cta_label_fa', 'cta_href', 'show_in_nav', 'nav_label_en', 'nav_label_fa', 'sort', 'published', 'created_at', 'updated_at']) {
    assert.ok(c.includes(k), `sections.${k}`);
  }
  assert.equal(db.prepare('SELECT COUNT(*) c FROM sections').get().c, 0);
});

test('pages: 9 system slugs seeded as unpublished bilingual drafts — no `contact` row', () => {
  const c = cols('pages');
  for (const k of ['slug', 'kind', 'system_key', 'title_en', 'title_fa', 'body_en', 'body_fa', 'meta_desc_en', 'meta_desc_fa',
    'show_in_footer', 'show_in_nav', 'noindex', 'sort', 'published', 'created_at', 'updated_at', 'updated_by', 'version', 'effective_at']) {
    assert.ok(c.includes(k), `pages.${k}`);
  }
  const rows = db.prepare('SELECT * FROM pages ORDER BY sort').all();
  assert.deepEqual(rows.map(r => r.slug), ['about', 'terms', 'privacy', 'refund', 'complaints', 'pricing', 'charter', 'contract', 'faq']);
  for (const r of rows) {
    assert.equal(r.published, 0, `${r.slug} unpublished`);
    assert.equal(r.system_key, r.slug);
    assert.ok(r.title_fa && r.title_en, `${r.slug} bilingual title`);
    assert.equal(r.body_fa, '⟦پیش‌نویس⟧');
    assert.equal(r.body_en, '⟦draft⟧');
  }
  const byslug = Object.fromEntries(rows.map(r => [r.slug, r]));
  assert.equal(byslug.about.title_fa, 'دربارهٔ ما');
  assert.equal(byslug.charter.title_fa, 'شیوه‌نامهٔ ارائهٔ خدمات');
  assert.equal(byslug.contract.title_fa, 'چارچوب قرارداد و تعهدات طرفین');
  assert.equal(byslug.terms.kind, 'legal');
  assert.equal(byslug.privacy.kind, 'legal');
  assert.equal(byslug.refund.kind, 'legal');
  assert.equal(byslug.faq.kind, 'custom');
});

test('services: the 10 fixed slugs, unpublished, with related project slugs', () => {
  const rows = db.prepare('SELECT * FROM services ORDER BY sort').all();
  assert.deepEqual(rows.map(r => r.slug), ['custom-website', 'profession-landing', 'web-app', 'ecommerce', 'mobile-app',
    'ai-agent', 'automation', 'accounting-systems', 'trading-systems', 'support-maintenance']);
  const PORTFOLIO = new Set(['restaurant', 'realestate', 'medical', 'trading', 'ecommerce', 'accounting', 'pos', 'salon', 'distribution',
    'law-landing', 'dental-landing', 'fitness-landing', 'cafe-landing', 'architect-landing', 'hotel', 'school', 'hr']);
  for (const r of rows) {
    assert.equal(r.published, 0, `${r.slug} unpublished`);
    assert.ok(r.title_fa && r.title_en, `${r.slug} bilingual title`);
    const rel = JSON.parse(r.related_projects);
    assert.ok(Array.isArray(rel));
    for (const s of rel) assert.ok(PORTFOLIO.has(s), `${r.slug} → ${s} is a portfolio slug`);
  }
  assert.deepEqual(JSON.parse(rows.find(r => r.slug === 'trading-systems').related_projects), ['trading']);
});

test('migrations are idempotent (re-running the runner applies nothing)', async () => {
  const { runMigrations } = await import('../../src/db/migrate.js');
  const applied = await runMigrations(db, { log: () => {} });
  assert.deepEqual(applied, []);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM pages').get().c, 9);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM services').get().c, 10);
});

test('012 removes a `contact` page row left by the old 008 seed (and only that row)', async () => {
  const { up } = await import('../../src/db/migrations/012_drop_contact_page.js');
  const { SYSTEM_PAGES } = await import('../../src/db/migrations/008_pages.js');
  assert.ok(!SYSTEM_PAGES.some(([slug]) => slug === 'contact'), '008 no longer seeds contact');
  db.prepare(`INSERT INTO pages (slug, kind, system_key, title_en, title_fa, body_en, body_fa, updated_by)
    VALUES ('contact', 'custom', 'contact', 'Contact us', 'تماس با ما', '⟦draft⟧', '⟦پیش‌نویس⟧', 'migration-008')`).run();
  assert.equal(db.prepare("SELECT COUNT(*) c FROM pages WHERE slug='contact'").get().c, 1);
  const ctx = { hasTable: name => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name) };
  up(db, ctx);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM pages WHERE slug='contact' OR system_key='contact'").get().c, 0);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM pages').get().c, 9, 'the other system pages are untouched');
});
