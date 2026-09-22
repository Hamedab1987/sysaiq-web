// Migrations 004 (content + legacy import) and 006 (show_on_home + showcase
// desc sync) on a fresh database and on a legacy fixture.
import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMigrations } from '../../src/db/migrate.js';
import { up as up006, SHOWCASE_SLUGS, DEFAULTS_PATH } from '../../src/db/migrations/006_show_on_home.js';
import { readFileSync } from 'node:fs';

process.env.NODE_ENV = 'test';
const quiet = { log: () => {} };
const cols = (db, t) => db.prepare(`PRAGMA table_info(${t})`).all().map(c => c.name);
const DEFAULTS = JSON.parse(readFileSync(DEFAULTS_PATH, 'utf8'));

// the schema the live database has before 004/006 (baseline tables only)
async function legacyDb() {
  const db = new Database(':memory:');
  const { up } = await import('../../src/db/migrations/001_baseline.js');
  up(db, { addColumn: () => false, hasColumn: () => true, hasTable: () => true });
  return db;
}
const seedRow = (db, key, en, fa) => db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(key, JSON.stringify({ en, fa }));

test('fresh database: content tables, indexes and the show_on_home columns exist', async () => {
  const db = new Database(':memory:');
  await runMigrations(db, quiet);
  assert.deepEqual(cols(db, 'content'), ['key', 'en', 'fa', 'is_custom', 'label_fa', 'label_en', 'type', 'updated_at', 'updated_by']);
  assert.deepEqual(cols(db, 'content_revisions'), ['id', 'key', 'en', 'fa', 'at', 'admin_id']);
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_content_rev_key'").get());
  assert.ok(cols(db, 'projects').includes('show_on_home'));
  assert.ok(cols(db, 'faqs').includes('show_on_home'));
  assert.equal(db.prepare('SELECT COUNT(*) c FROM content').get().c, 0, 'nothing imported without legacy rows');
  // defaults of the new columns
  db.prepare("INSERT INTO projects (slug) VALUES ('x')").run();
  db.prepare("INSERT INTO faqs (q_en) VALUES ('q')").run();
  assert.equal(db.prepare('SELECT show_on_home FROM projects').get().show_on_home, 0);
  assert.equal(db.prepare('SELECT show_on_home FROM faqs').get().show_on_home, 1);
});

test('content.key accepts only A-Z 0-9 _ and type only plain|inline', async () => {
  const db = new Database(':memory:');
  await runMigrations(db, quiet);
  db.prepare("INSERT INTO content (key) VALUES ('X_OK_1')").run();
  for (const bad of ['x_lower', 'A-B', '', 'A B', 'É']) {
    assert.throws(() => db.prepare('INSERT INTO content (key) VALUES (?)').run(bad), /CHECK/, `key ${JSON.stringify(bad)}`);
  }
  assert.throws(() => db.prepare("INSERT INTO content (key, type) VALUES ('T1', 'html')").run(), /CHECK/);
});

test('004: an edited legacy value is imported per language; untouched seed rows and contact_email are not', async () => {
  const db = await legacyDb();
  // hero_h1: fa edited, en still the seed (with extra whitespace — normalised away)
  seedRow(db, 'hero_h1', "I don't just  build websites ", 'سلام دنیا');
  // about_1: both untouched
  seedRow(db, 'about_1',
    'SysaiQ is a one-person systems lab. I design and build intelligent digital systems that combine software, AI, automation, data and modern interfaces — from custom websites and apps to AI agents and automated workflows.',
    'SysaiQ یک لابراتوار سیستم‌سازیِ تک‌نفره است. سیستم‌های دیجیتال هوشمند طراحی و پیاده‌سازی می‌کنم؛ ترکیبی از نرم‌افزار، AI، اتوماسیون، داده و رابط‌های مدرن — از وب‌سایت و اپ اختصاصی تا AI Agent و فرایندهای خودکار.');
  // about_2: en edited, fa untouched
  seedRow(db, 'about_2', 'Custom English copy', 'هر پروژه از مسئله‌ی واقعی کسب‌وکار شروع می‌شود، نه از قالب آماده: سیستم حسابداری و معاملاتی، اتوماسیون فرایندها، و اتصال ابزارهایی که همین حالا استفاده می‌کنید — مهندسی‌شده از ابتدا تا انتها.');
  // contact_email edited — owned by 005, never imported into content
  seedRow(db, 'contact_email', 'owner@example.com', 'owner@example.com');
  // not JSON — ignored, must not throw
  db.prepare("INSERT INTO settings (key, value) VALUES ('hero_note_l', 'not json')").run();
  const before = db.prepare('SELECT * FROM settings ORDER BY key').all();

  await runMigrations(db, quiet);

  const rows = Object.fromEntries(db.prepare('SELECT * FROM content ORDER BY key').all().map(r => [r.key, r]));
  assert.deepEqual(Object.keys(rows), ['FEAT2', 'HERO_H1']);
  assert.equal(rows.HERO_H1.fa, 'سلام دنیا');
  assert.equal(rows.HERO_H1.en, null, 'unedited en keeps the default');
  assert.equal(rows.HERO_H1.is_custom, 0);
  assert.equal(rows.HERO_H1.updated_by, 'migration-004');
  assert.equal(rows.FEAT2.en, 'Custom English copy');
  assert.equal(rows.FEAT2.fa, null);
  assert.ok(!rows.FEAT1, 'untouched about_1 is not imported');
  assert.ok(!Object.values(rows).some(r => r.en === 'owner@example.com' || r.fa === 'owner@example.com'), 'contact_email not imported');
  // legacy rows are left exactly as they were (additive migration; 005 may add its own site_info row)
  const keys = new Set(before.map(r => r.key));
  assert.deepEqual(db.prepare('SELECT * FROM settings ORDER BY key').all().filter(r => keys.has(r.key)), before);
  // a second run imports nothing more
  await runMigrations(db, quiet);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM content').get().c, 2);
});

test('006: the nine showcase slugs get show_on_home=1; unedited desc_* is synced to W<n>_D, edited desc is kept', async () => {
  const db = await legacyDb();
  const ins = db.prepare('INSERT INTO projects (slug, tagline_en, tagline_fa, desc_en, desc_fa, sort) VALUES (?,?,?,?,?,?)');
  ins.run('restaurant', 'tag en', 'تگ', 'tag en', 'تگ', 1);          // both unedited → both synced
  ins.run('medical', 'tag en', 'تگ', 'My own desc', 'تگ', 3);        // en edited → only fa synced
  ins.run('hotel', 'tag en', 'تگ', 'tag en', 'تگ', 15);              // not a showcase slug → untouched
  ins.run('trading', 'x', 'y', '', '', 4);                            // desc empty, tagline not → left alone
  await runMigrations(db, quiet);

  const get = slug => db.prepare('SELECT * FROM projects WHERE slug=?').get(slug);
  for (const slug of SHOWCASE_SLUGS) if (get(slug)) assert.equal(get(slug).show_on_home, 1, slug);
  assert.equal(get('hotel').show_on_home, 0);
  assert.equal(get('restaurant').desc_en, DEFAULTS.W1_D.en);
  assert.equal(get('restaurant').desc_fa, DEFAULTS.W1_D.fa);
  assert.equal(get('medical').desc_en, 'My own desc');
  assert.equal(get('medical').desc_fa, DEFAULTS.W3_D.fa);
  assert.equal(get('hotel').desc_en, 'tag en');
  assert.equal(get('trading').desc_en, '');
});

test('006 without content-defaults.json: flags only, no throw', async () => {
  const db = await legacyDb();
  db.prepare("INSERT INTO projects (slug, tagline_en, desc_en) VALUES ('salon', 't', 't')").run();
  const dir = await mkdtemp(join(tmpdir(), 'no-defaults-'));
  try {
    const ctx = {
      hasColumn: (t, c) => cols(db, t).includes(c),
      addColumn(t, c, ddl) { if (cols(db, t).includes(c)) return false; db.exec(`ALTER TABLE ${t} ADD COLUMN ${c} ${ddl}`); return true; },
    };
    up006(db, ctx, { defaultsPath: join(dir, 'missing.json') });
    const p = db.prepare("SELECT * FROM projects WHERE slug='salon'").get();
    assert.equal(p.show_on_home, 1);
    assert.equal(p.desc_en, 't');
    // a malformed file is treated the same way
    await writeFile(join(dir, 'bad.json'), '[1,2]');
    up006(db, ctx, { defaultsPath: join(dir, 'bad.json') });
    assert.equal(db.prepare("SELECT desc_en FROM projects WHERE slug='salon'").get().desc_en, 't');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
