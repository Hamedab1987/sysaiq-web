// SQLite data layer for SysaiQ.
// One file, one connection. Schema is created idempotently on boot so a
// fresh deploy just works. All content is bilingual: every user-facing
// string is stored as {en, fa} — mirroring the static site's content model.
import Database from 'better-sqlite3';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || join(__dirname, '..', 'data');
mkdirSync(DATA_DIR, { recursive: true });

export const db = new Database(join(DATA_DIR, 'sysaiq.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  -- key/value site content: hero, about, contact… each value is JSON {en,fa}
  CREATE TABLE IF NOT EXISTS settings (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,              -- JSON
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- portfolio / work slider items
  CREATE TABLE IF NOT EXISTS projects (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    slug        TEXT UNIQUE,
    title_en    TEXT NOT NULL DEFAULT '',
    title_fa    TEXT NOT NULL DEFAULT '',
    desc_en     TEXT NOT NULL DEFAULT '',
    desc_fa     TEXT NOT NULL DEFAULT '',
    tags        TEXT NOT NULL DEFAULT '',  -- "QUANT · PYTHON"
    image       TEXT NOT NULL DEFAULT '',  -- card cover
    cover_en    TEXT NOT NULL DEFAULT '',  -- detail hero image (English UI)
    cover_fa    TEXT NOT NULL DEFAULT '',  -- detail hero image (Persian UI)
    tagline_en  TEXT NOT NULL DEFAULT '',
    tagline_fa  TEXT NOT NULL DEFAULT '',
    overview_en TEXT NOT NULL DEFAULT '',
    overview_fa TEXT NOT NULL DEFAULT '',
    industries  TEXT NOT NULL DEFAULT '[]',  -- JSON [{en,fa}]
    features    TEXT NOT NULL DEFAULT '[]',  -- JSON [{title_en,title_fa,desc_en,desc_fa}]
    pages       TEXT NOT NULL DEFAULT '[]',  -- JSON [{name_en,name_fa,desc_en,desc_fa}]
    sort        INTEGER NOT NULL DEFAULT 0,
    published   INTEGER NOT NULL DEFAULT 1,
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
  -- (detail columns are part of CREATE above; ALTER migration runs in JS below)
`);
// migration for pre-existing DBs: add any missing columns
for (const [col, def] of [
  ['cover_en', "''"], ['cover_fa', "''"], ['tagline_en', "''"], ['tagline_fa', "''"],
  ['overview_en', "''"], ['overview_fa', "''"],
  ['industries', "'[]'"], ['features', "'[]'"], ['pages', "'[]'"],
]) {
  try { db.exec(`ALTER TABLE projects ADD COLUMN ${col} TEXT NOT NULL DEFAULT ${def}`); } catch {}
}
db.exec(`

  -- FAQ items
  CREATE TABLE IF NOT EXISTS faqs (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    q_en       TEXT NOT NULL DEFAULT '',
    q_fa       TEXT NOT NULL DEFAULT '',
    a_en       TEXT NOT NULL DEFAULT '',
    a_fa       TEXT NOT NULL DEFAULT '',
    sort       INTEGER NOT NULL DEFAULT 0,
    published  INTEGER NOT NULL DEFAULT 1
  );

  -- AI assistant knowledge base — each row is a fact/passage the
  -- assistant may ground its answers in. Bilingual content in one row.
  CREATE TABLE IF NOT EXISTS knowledge (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    title      TEXT NOT NULL DEFAULT '',
    body_en    TEXT NOT NULL DEFAULT '',
    body_fa    TEXT NOT NULL DEFAULT '',
    tags       TEXT NOT NULL DEFAULT '',
    enabled    INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- leads captured by the site form or qualified by the AI assistant
  CREATE TABLE IF NOT EXISTS leads (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT DEFAULT '',
    email         TEXT DEFAULT '',
    phone         TEXT DEFAULT '',
    company       TEXT DEFAULT '',
    project_type  TEXT DEFAULT '',
    message       TEXT DEFAULT '',
    language      TEXT DEFAULT 'en',       -- fa | en
    source        TEXT DEFAULT 'form',     -- form | ai
    summary       TEXT DEFAULT '',         -- AI conversation summary
    lead_score    INTEGER DEFAULT 0,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- AI conversation log (for the admin to review assistant activity)
  CREATE TABLE IF NOT EXISTS conversations (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    role       TEXT NOT NULL,              -- user | assistant
    content    TEXT NOT NULL,
    language   TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- admin users
  CREATE TABLE IF NOT EXISTS admins (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    username   TEXT UNIQUE NOT NULL,
    pass_hash  TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// ---- helpers -----------------------------------------------------------
export function getSetting(key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key=?').get(key);
  return row ? JSON.parse(row.value) : fallback;
}
export function setSetting(key, value) {
  db.prepare(`INSERT INTO settings (key,value,updated_at) VALUES (?,?,datetime('now'))
              ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')`)
    .run(key, JSON.stringify(value));
}
export function allSettings() {
  const out = {};
  for (const r of db.prepare('SELECT key,value FROM settings').all()) out[r.key] = JSON.parse(r.value);
  return out;
}
