// Migration 002 on a legacy database: the plaintext OpenAI key moves into
// the encrypted secrets table and is scrubbed from the database file.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { mkdtemp, rm, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startTestApp } from '../helpers.js';

const SENTINEL = 'sk-LEGACY-plaintext-key-0a1b2c3d4e5f6789abcdef';
let dir, t;
after(async () => { if (t) await t.close(); if (dir) await rm(dir, { recursive: true, force: true }); });

// the settings table exactly as the pre-rebuild db.js created it, in WAL mode
async function legacyDatabase() {
  dir = await mkdtemp(join(tmpdir(), 'sysaiq-legacy-'));
  const db = new Database(join(dir, 'sysaiq.db'));
  db.pragma('journal_mode = WAL');
  db.exec("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT (datetime('now')))");
  db.prepare("INSERT INTO settings (key, value) VALUES ('hero_h1', ?)").run(JSON.stringify({ en: 'Hi', fa: 'سلام' }));
  // the key was saved twice: the first value lingers in freed pages of a real file too
  db.prepare("INSERT INTO settings (key, value) VALUES ('ai_config', ?)").run(JSON.stringify({ openai_key: SENTINEL + '-OLD', model: 'gpt-4o-mini' }));
  db.prepare("UPDATE settings SET value=? WHERE key='ai_config'").run(JSON.stringify({ openai_key: SENTINEL, model: 'gpt-4o-mini' }));
  db.close();
  const raw = await readFile(join(dir, 'sysaiq.db'), 'latin1');
  assert.ok(raw.includes(SENTINEL), 'fixture sanity: the plaintext key is in the file before the migration');
  return dir;
}

async function fileHas(name, needle) {
  try { await stat(join(dir, name)); } catch { return false; }
  return (await readFile(join(dir, name), 'latin1')).includes(needle);
}

test('the key is moved to secrets, settings.ai_config keeps only the model, the file is scrubbed', async () => {
  await legacyDatabase();
  t = await startTestApp({ env: { DATA_DIR: dir } });
  const { db, getSetting, schemaVersion } = await import('../../src/db/index.js');
  const { getSecret } = await import('../../src/lib/secrets.js');

  assert.ok(schemaVersion() >= 11);
  assert.deepEqual(getSetting('ai_config'), { model: 'gpt-4o-mini' });
  assert.deepEqual(getSetting('hero_h1'), { en: 'Hi', fa: 'سلام' });
  assert.equal(getSecret('openai.api_key'), SENTINEL);
  const row = db.prepare('SELECT hint, updated_by FROM secrets WHERE name=?').get('openai.api_key');
  assert.equal(row.hint, '••••cdef');
  assert.equal(row.updated_by, 'migration-002');
  assert.ok(!db.prepare('SELECT value FROM settings').all().some(r => r.value.includes('sk-')));

  // raw bytes: main file, WAL and shm no longer contain the key (or its older copy)
  for (const f of ['sysaiq.db', 'sysaiq.db-wal', 'sysaiq.db-shm']) {
    assert.equal(await fileHas(f, SENTINEL), false, `${f} still holds the plaintext key`);
    assert.equal(await fileHas(f, 'LEGACY-plaintext'), false, `${f} still holds the older copy`);
  }

  // the admin API sees it as configured from the panel, without the value
  await t.loginAsAdmin();
  const ai = await (await t.fetchAdmin('/ai-config')).json();
  assert.deepEqual(ai, { configured: true, key_hint: 'sk-…cdef', model: 'gpt-4o-mini', source: 'panel' });
  const setup = await (await t.fetchAdmin('/setup-status')).json();
  assert.equal(setup.openai_key, true);
});

test('migration 002 is idempotent per file and leaves a key-less ai_config alone', async () => {
  const { runMigrations } = await import('../../src/db/migrate.js');
  const { db } = await import('../../src/db/index.js');
  assert.deepEqual(await runMigrations(db, { log: () => {} }), []);
  const mem = new Database(':memory:');
  mem.exec("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT (datetime('now')))");
  mem.prepare("INSERT INTO settings (key, value) VALUES ('ai_config', ?)").run(JSON.stringify({ model: 'gpt-4o', openai_key: '' }));
  await runMigrations(mem, { log: () => {} });
  assert.equal(mem.prepare("SELECT value FROM settings WHERE key='ai_config'").get().value, JSON.stringify({ model: 'gpt-4o' }));
  assert.equal(mem.prepare('SELECT COUNT(*) c FROM secrets').get().c, 0);
});
