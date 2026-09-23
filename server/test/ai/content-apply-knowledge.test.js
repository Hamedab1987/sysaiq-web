// scripts/content-apply.mjs "knowledge": content/knowledge/<slug>.json →
// knowledge rows, matched by slug (group → grp, tags array → "a,b", enabled
// from the file, --publish ignored). Existing rows keep their id; a row the
// seed inserted without a slug is adopted via slugify(title); a second run
// changes nothing. Scratch databases only.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { runMigrations } from '../../src/db/migrate.js';
import { applyKind, KINDS } from '../../scripts/content-apply.mjs';
import { slugify } from '../../src/db/migrations/014_knowledge_slug.js';

const quiet = { log: () => {} };
const ROOT = join(import.meta.dirname, '..', '..');
const LEGACY = JSON.parse(readFileSync(join(ROOT, 'data-knowledge.json'), 'utf8'));
const dirs = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

function writeDir(files) {
  const dir = mkdtempSync(join(tmpdir(), 'kb-apply-'));
  dirs.push(dir);
  for (const f of files) writeFileSync(join(dir, `${f.slug}.json`), JSON.stringify(f));
  return dir;
}

// the 38 seeded rows, slugged by migration 014 (upgrade path)
async function seededDb() {
  const db = new Database(':memory:');
  await runMigrations(db, quiet);
  const ins = db.prepare('INSERT INTO knowledge (title, body_en, body_fa, tags, enabled) VALUES (?,?,?,?,1)');
  for (const k of LEGACY) ins.run(k.title, k.body_en, k.body_fa, k.tags || '');
  db.prepare('DELETE FROM schema_migrations WHERE version=14').run();
  await runMigrations(db, quiet);
  return db;
}

const FILES = [
  { slug: 'pitch-restaurant-cafe', title: 'Pitch: Restaurant & Cafe', group: 'pitch', tags: ['pitch', 'restaurant-cafe'],
    body_en: 'Updated restaurant pitch — see /{lang}/work/restaurant.', body_fa: 'متن تازهٔ Pitch رستوران — /{lang}/work/restaurant', enabled: true, sort: 1 },
  { slug: 'who-is-behind-sysaiq', title: 'Who is behind SysaiQ', group: 'company', tags: 'about,hamed',
    body_en: 'About.', body_fa: 'دربارهٔ ما.', enabled: true, sort: 0 },
  { slug: 'payments-and-invoices', title: 'Payments and invoices', group: 'commercial', tags: ['payments'],
    body_en: 'Invoice + pay link.', body_fa: 'فاکتور و لینک پرداخت.', enabled: false, sort: 3 },
];

test('the knowledge kind is registered with the contract columns', () => {
  assert.deepEqual(KINDS.knowledge.columns, ['title', 'grp', 'tags', 'body_en', 'body_fa', 'enabled', 'sort']);
  assert.equal(KINDS.knowledge.publishable, false);
});

test('existing rows are updated in place by slug, new files create rows; a re-run is a no-op', async () => {
  const db = await seededDb();
  const before = db.prepare('SELECT id, slug FROM knowledge').all();
  const idOf = Object.fromEntries(before.map(r => [r.slug, r.id]));
  const dir = writeDir(FILES);

  const s1 = applyKind(db, 'knowledge', { dir, publish: true });
  assert.deepEqual({ ...s1 }, { created: 1, updated: 2, unchanged: 0, published: 0, total: 3 });
  assert.equal(db.prepare('SELECT COUNT(*) c FROM knowledge').get().c, 39, 'no duplicate of a seeded row');

  const r = db.prepare("SELECT * FROM knowledge WHERE slug='pitch-restaurant-cafe'").get();
  assert.equal(r.id, idOf['pitch-restaurant-cafe'], 'same row, same id');
  assert.equal(r.grp, 'pitch');
  assert.equal(r.tags, 'pitch,restaurant-cafe');
  assert.equal(r.sort, 1);
  assert.equal(r.enabled, 1);
  assert.match(r.body_en, /\{lang\}/, 'the placeholder is stored as-is; ai.js substitutes it');

  const p = db.prepare("SELECT * FROM knowledge WHERE slug='payments-and-invoices'").get();
  assert.equal(p.grp, 'commercial');
  assert.equal(p.enabled, 0, 'enabled comes from the file');
  assert.equal(p.sort, 3);
  assert.ok(!('published' in p));

  // untouched rows stay exactly as they were
  assert.equal(db.prepare("SELECT body_en FROM knowledge WHERE slug='pitch-hotels-guesthouses'").get().body_en,
    LEGACY.find(k => k.title === 'Pitch: Hotels & Guesthouses').body_en);

  const stamp = db.prepare("SELECT updated_at FROM knowledge WHERE slug='pitch-restaurant-cafe'").get().updated_at;
  const s2 = applyKind(db, 'knowledge', { dir });
  assert.deepEqual({ ...s2 }, { created: 0, updated: 0, unchanged: 3, published: 0, total: 3 });
  assert.equal(db.prepare("SELECT updated_at FROM knowledge WHERE slug='pitch-restaurant-cafe'").get().updated_at, stamp);
});

test('a row seeded without a slug (fresh install: seed after migration 014) is adopted, not duplicated', async () => {
  const db = new Database(':memory:');
  await runMigrations(db, quiet);
  const id = db.prepare("INSERT INTO knowledge (title, body_en, tags) VALUES ('Pitch: Restaurant & Cafe', 'old', 'pitch,restaurant-cafe')").run().lastInsertRowid;
  const dir = writeDir([FILES[0]]);
  const s = applyKind(db, 'knowledge', { dir });
  assert.equal(s.updated, 1);
  assert.equal(s.created, 0);
  const row = db.prepare('SELECT * FROM knowledge').all();
  assert.equal(row.length, 1);
  assert.equal(row[0].id, id);
  assert.equal(row[0].slug, 'pitch-restaurant-cafe');
  assert.equal(applyKind(db, 'knowledge', { dir }).unchanged, 1);
});

test('dry run writes nothing; a bad group or a missing title fails the whole run', async () => {
  const db = await seededDb();
  const n = db.prepare('SELECT COUNT(*) c FROM knowledge').get().c;
  applyKind(db, 'knowledge', { dir: writeDir(FILES), dryRun: true });
  assert.equal(db.prepare('SELECT COUNT(*) c FROM knowledge').get().c, n);
  assert.equal(db.prepare("SELECT grp FROM knowledge WHERE slug='who-is-behind-sysaiq'").get().grp, 'company');
  assert.throws(() => applyKind(db, 'knowledge', { dir: writeDir([{ ...FILES[1], group: 'marketing' }]) }), /who-is-behind-sysaiq\.json: group "marketing"/);
  assert.throws(() => applyKind(db, 'knowledge', { dir: writeDir([{ ...FILES[1], title: ' ' }]) }), /title is required/);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM knowledge').get().c, n);
});

// the real content files (written by the knowledge-content specialist) land
// on the seeded rows: every legacy slug they name keeps its id
const REAL = join(ROOT, 'content', 'knowledge');
const hasReal = existsSync(REAL) && readdirSync(REAL).some(f => f.endsWith('.json'));
test('content/knowledge/*.json applies onto the 38 seeded rows without duplicates', { skip: !hasReal && 'content/knowledge not written yet' }, async () => {
  const db = await seededDb();
  const legacyIds = Object.fromEntries(db.prepare('SELECT id, slug FROM knowledge').all().map(r => [r.slug, r.id]));
  const s = applyKind(db, 'knowledge', { dir: REAL });
  assert.equal(s.created + s.updated + s.unchanged, s.total);
  const rows = db.prepare('SELECT id, slug FROM knowledge').all();
  assert.equal(new Set(rows.map(r => r.slug)).size, rows.length, 'slugs stay unique');
  for (const f of readdirSync(REAL).filter(x => x.endsWith('.json'))) {
    const slug = f.replace(/\.json$/, '');
    const row = rows.find(r => r.slug === slug);
    assert.ok(row, slug);
    if (legacyIds[slug]) assert.equal(row.id, legacyIds[slug], `${slug} updated in place`);
  }
  assert.equal(applyKind(db, 'knowledge', { dir: REAL }).unchanged, s.total, 'idempotent');
  assert.ok(Object.keys(legacyIds).every(sl => sl === slugify(sl)));
});
