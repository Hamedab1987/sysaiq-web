// SQLite data layer for SysaiQ.
// One file, one connection. The schema lives in ./migrations and is brought up
// to date right here on import, so anything that imports the db (the app,
// seed.js, tests, one-off scripts) can rely on the tables existing.
// All content is bilingual: every user-facing string is stored as {en, fa}.
import Database from 'better-sqlite3';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { config } from '../config.js';
import { runMigrations, schemaVersion as versionOf } from './migrate.js';

mkdirSync(config.dataDir, { recursive: true });

export const db = new Database(join(config.dataDir, 'sysaiq.db'));
db.pragma('journal_mode = WAL');
// per-connection, so every boot must set it: deleted leads (PII) and
// replaced/deleted secret rows are zeroed in freed pages instead of
// lingering in the file until the page is reused
db.pragma('secure_delete = ON');
db.pragma('foreign_keys = ON');

await runMigrations(db, { log: config.env === 'test' ? () => {} : console.log });

export const schemaVersion = () => versionOf(db);

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
