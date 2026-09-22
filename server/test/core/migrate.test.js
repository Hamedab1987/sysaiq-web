import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { runMigrations, loadMigrations, schemaVersion } from '../../src/db/migrate.js';

const cols = (db, t) => db.prepare(`PRAGMA table_info(${t})`).all().map(c => c.name);
const tables = db => db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(r => r.name);
const quiet = { log: () => {} };

// The schema the ORIGINAL db.js created on the very first deploy: the seven
// tables, projects WITHOUT the detail columns that were added later by the
// try/catch ALTER loop. A real production DB is this + those ALTERs.
const OLD_SCHEMA = `
  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT (datetime('now')));
  CREATE TABLE projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT UNIQUE,
    title_en TEXT NOT NULL DEFAULT '', title_fa TEXT NOT NULL DEFAULT '',
    desc_en TEXT NOT NULL DEFAULT '', desc_fa TEXT NOT NULL DEFAULT '',
    tags TEXT NOT NULL DEFAULT '', image TEXT NOT NULL DEFAULT '',
    sort INTEGER NOT NULL DEFAULT 0, published INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')));
  CREATE TABLE faqs (id INTEGER PRIMARY KEY AUTOINCREMENT, q_en TEXT NOT NULL DEFAULT '', q_fa TEXT NOT NULL DEFAULT '',
    a_en TEXT NOT NULL DEFAULT '', a_fa TEXT NOT NULL DEFAULT '', sort INTEGER NOT NULL DEFAULT 0, published INTEGER NOT NULL DEFAULT 1);
  CREATE TABLE knowledge (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL DEFAULT '', body_en TEXT NOT NULL DEFAULT '',
    body_fa TEXT NOT NULL DEFAULT '', tags TEXT NOT NULL DEFAULT '', enabled INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL DEFAULT (datetime('now')));
  CREATE TABLE leads (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT DEFAULT '', email TEXT DEFAULT '', phone TEXT DEFAULT '',
    company TEXT DEFAULT '', project_type TEXT DEFAULT '', message TEXT DEFAULT '', language TEXT DEFAULT 'en', source TEXT DEFAULT 'form',
    summary TEXT DEFAULT '', lead_score INTEGER DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')));
  CREATE TABLE conversations (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL,
    language TEXT DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')));
  CREATE TABLE admins (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL, pass_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')));
`;
const OLD_ALTERS = ['cover_en', 'cover_fa', 'tagline_en', 'tagline_fa', 'overview_en', 'overview_fa']
  .map(c => `ALTER TABLE projects ADD COLUMN ${c} TEXT NOT NULL DEFAULT '';`)
  .concat(['industries', 'features', 'pages'].map(c => `ALTER TABLE projects ADD COLUMN ${c} TEXT NOT NULL DEFAULT '[]';`))
  .join('\n');

test('fresh database: every migration applies, in ascending order', async () => {
  const db = new Database(':memory:');
  const all = await loadMigrations();
  const applied = await runMigrations(db, quiet);
  assert.deepEqual(applied.map(a => a.version), all.map(m => m.version));
  assert.ok(applied.length >= 2, 'baseline + audit_admins at least');
  for (let i = 1; i < applied.length; i++) assert.ok(applied[i].version > applied[i - 1].version);
  for (const t of ['settings', 'projects', 'faqs', 'knowledge', 'leads', 'conversations', 'admins', 'audit_log', 'schema_migrations']) {
    assert.ok(tables(db).includes(t), `table ${t}`);
  }
  assert.equal(schemaVersion(db), all.at(-1).version);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM schema_migrations').get().c, applied.length);
});

test('second run applies nothing', async () => {
  const db = new Database(':memory:');
  await runMigrations(db, quiet);
  const again = await runMigrations(db, quiet);
  assert.deepEqual(again, []);
});

test('a database created by the OLD db.js upgrades cleanly and keeps its rows', async () => {
  const db = new Database(':memory:');
  db.exec(OLD_SCHEMA);
  db.exec(OLD_ALTERS);
  db.prepare("INSERT INTO settings (key, value) VALUES ('hero_h1', ?)").run(JSON.stringify({ en: 'Hi', fa: 'سلام' }));
  db.prepare("INSERT INTO settings (key, value) VALUES ('ai_config', ?)").run(JSON.stringify({ model: 'gpt-4o-mini' }));
  db.prepare("INSERT INTO projects (slug, title_en, features) VALUES ('shop', 'Shop', '[{\"title_en\":\"a\"}]')").run();
  db.prepare("INSERT INTO faqs (q_en) VALUES ('Q?')").run();
  db.prepare("INSERT INTO knowledge (title) VALUES ('K')").run();
  db.prepare("INSERT INTO leads (name, email) VALUES ('Ali', 'a@b.c')").run();
  db.prepare("INSERT INTO conversations (session_id, role, content) VALUES ('s', 'user', 'hi')").run();
  db.prepare("INSERT INTO admins (username, pass_hash) VALUES ('hamed', 'x')").run();
  const before = Object.fromEntries(['settings', 'projects', 'faqs', 'knowledge', 'leads', 'conversations', 'admins']
    .map(t => [t, db.prepare(`SELECT * FROM ${t}`).all()]));
  const projectColsBefore = cols(db, 'projects');

  const applied = await runMigrations(db, quiet);
  assert.ok(applied.length >= 2);

  // baseline changed nothing on a fully-ALTERed production schema
  assert.deepEqual(cols(db, 'projects'), projectColsBefore);
  // rows survived untouched
  for (const [t, rows] of Object.entries(before)) {
    const now = db.prepare(`SELECT * FROM ${t}`).all();
    assert.equal(now.length, rows.length, `${t} row count`);
    for (const [i, r] of rows.entries()) for (const k of Object.keys(r)) assert.equal(now[i][k], r[k], `${t}.${k}`);
  }
  // new columns / tables exist
  for (const c of ['token_version', 'pwd_changed_at', 'last_login_at']) assert.ok(cols(db, 'admins').includes(c), `admins.${c}`);
  assert.equal(db.prepare('SELECT token_version FROM admins').get().token_version, 0);
  assert.ok(tables(db).includes('audit_log'));
});

test('a database that predates the project detail columns gets them from the baseline guards', async () => {
  const db = new Database(':memory:');
  db.exec(OLD_SCHEMA);
  db.prepare("INSERT INTO projects (slug, title_en) VALUES ('shop', 'Shop')").run();
  await runMigrations(db, quiet);
  for (const c of ['cover_en', 'tagline_fa', 'overview_en', 'industries', 'features', 'pages']) assert.ok(cols(db, 'projects').includes(c), c);
  const p = db.prepare('SELECT * FROM projects').get();
  assert.equal(p.title_en, 'Shop');
  assert.equal(p.features, '[]');
  assert.equal(p.cover_en, '');
});

test('a failing migration rolls back and is not recorded', async () => {
  const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = await mkdtemp(join(tmpdir(), 'mig-'));
  try {
    await writeFile(join(dir, '001_ok.js'), "export const version = 1; export const name = 'ok'; export function up(db) { db.exec('CREATE TABLE a (x)'); }");
    await writeFile(join(dir, '002_bad.js'), "export const version = 2; export const name = 'bad'; export function up(db) { db.exec('CREATE TABLE b (x)'); throw new Error('boom'); }");
    const db = new Database(':memory:');
    await assert.rejects(runMigrations(db, { dir, ...quiet }), /boom/);
    assert.ok(tables(db).includes('a'));
    assert.ok(!tables(db).includes('b'), 'partial work of 002 was rolled back');
    assert.deepEqual(db.prepare('SELECT version FROM schema_migrations').all().map(r => r.version), [1]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
