// Migration 014: knowledge.slug / grp / sort, slug backfilled with the shared
// contract's slugify(title) so content/knowledge/<slug>.json updates the 38
// seeded rows in place. A legacy database is simulated by re-running 014 on
// rows that have no slug yet (the column guards make the re-run additive).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { runMigrations } from '../../src/db/migrate.js';
import { slugify, uniqueSlug, guessGroup, KNOWLEDGE_GROUPS } from '../../src/db/migrations/014_knowledge_slug.js';

const quiet = { log: () => {} };
const LEGACY = JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', 'data-knowledge.json'), 'utf8'));
const cols = db => db.prepare('PRAGMA table_info(knowledge)').all().map(c => c.name);

// fresh schema, then legacy rows inserted the way the old seed did (no slug),
// then 014 applied again as if for the first time
async function legacyDb(rows) {
  const db = new Database(':memory:');
  await runMigrations(db, quiet);
  const ins = db.prepare("INSERT INTO knowledge (title, body_en, body_fa, tags, enabled, updated_at) VALUES (?,?,?,?,1,'2025-01-01 00:00:00')");
  for (const r of rows) ins.run(r.title, r.body_en || '', r.body_fa || '', r.tags || '');
  db.prepare('DELETE FROM schema_migrations WHERE version=14').run();
  await runMigrations(db, quiet);
  return db;
}

test('the slug rule is exactly the shared contract', () => {
  assert.equal(slugify('Pitch: Restaurant & Cafe'), 'pitch-restaurant-cafe');
  assert.equal(slugify('Café & Restaurant Website'), 'caf-restaurant-website');
  assert.equal(slugify("The Assistant's Sales Playbook"), 'the-assistant-s-sales-playbook');
  assert.equal(slugify('  --  '), '');
  assert.equal(slugify('x'.repeat(80)).length, 64);
  assert.equal(uniqueSlug('a', new Set(['a', 'a-2'])), 'a-3');
  assert.ok(uniqueSlug('y'.repeat(64), new Set(['y'.repeat(64)])).length <= 64);
  assert.deepEqual(KNOWLEDGE_GROUPS, ['company', 'services', 'process', 'commercial', 'legal', 'contact', 'projects', 'pitch', 'playbook', 'news']);
  assert.equal(guessGroup('pitch,restaurant-cafe'), 'pitch');
  assert.equal(guessGroup('project,restaurant'), 'projects');
  assert.equal(guessGroup('process,pricing'), 'process');
  assert.equal(guessGroup(''), '');
});

test('fresh database: the columns and the partial unique index exist', async () => {
  const db = new Database(':memory:');
  await runMigrations(db, quiet);
  for (const c of ['slug', 'grp', 'sort']) assert.ok(cols(db).includes(c), c);
  const idx = db.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND name='knowledge_slug_uq'").get();
  assert.match(idx.sql, /UNIQUE INDEX/i);
  assert.match(idx.sql, /WHERE slug <> ''/);
  db.prepare("INSERT INTO knowledge (title, slug) VALUES ('A', ''), ('B', '')").run(); // many unslugged rows are fine
  db.prepare("INSERT INTO knowledge (title, slug) VALUES ('C', 'c')").run();
  assert.throws(() => db.prepare("INSERT INTO knowledge (title, slug) VALUES ('C2', 'c')").run(), /UNIQUE/);
});

test('the 38 legacy entries get slugify(title), a guessed group, sort 0 — updated_at untouched', async () => {
  const db = await legacyDb(LEGACY);
  const rows = db.prepare('SELECT * FROM knowledge ORDER BY id').all();
  assert.equal(rows.length, LEGACY.length);
  assert.equal(rows.length, 38);
  rows.forEach((r, i) => {
    assert.equal(r.slug, slugify(LEGACY[i].title), LEGACY[i].title);
    assert.equal(r.sort, 0);
    assert.equal(r.updated_at, '2025-01-01 00:00:00');
  });
  const bySlug = Object.fromEntries(rows.map(r => [r.slug, r]));
  assert.equal(bySlug['pitch-restaurant-cafe'].grp, 'pitch');
  assert.equal(bySlug['caf-restaurant-website'].grp, 'projects');
  assert.equal(bySlug['the-assistant-s-sales-playbook'].grp, 'playbook');
  assert.equal(bySlug['who-is-behind-sysaiq'].grp, 'company');
  assert.equal(rows.filter(r => r.grp === 'pitch').length, 16);
  assert.equal(new Set(rows.map(r => r.slug)).size, 38, 'no duplicates');
});

test('empty-slug titles are skipped, collisions get -2/-3, an existing slug is kept', async () => {
  const db = new Database(':memory:');
  await runMigrations(db, quiet);
  const ins = db.prepare('INSERT INTO knowledge (title, slug, grp, tags) VALUES (?,?,?,?)');
  ins.run('Owner entry', 'pitch-restaurant-cafe', 'legal', 'pitch'); // slug + group already set: never touched
  ins.run('Pitch: Restaurant & Cafe', '', '', 'pitch');
  ins.run('Pitch: Restaurant & Cafe', '', '', 'pitch');
  ins.run('—', '', '', '');
  ins.run('', '', '', '');
  db.prepare('DELETE FROM schema_migrations WHERE version=14').run();
  await runMigrations(db, quiet);
  const got = db.prepare('SELECT title, slug, grp FROM knowledge ORDER BY id').all();
  assert.deepEqual(got.map(r => r.slug), ['pitch-restaurant-cafe', 'pitch-restaurant-cafe-2', 'pitch-restaurant-cafe-3', '', '']);
  assert.equal(got[0].grp, 'legal', "an owner's group is never overwritten");
  assert.equal(got[1].grp, 'pitch');
});
