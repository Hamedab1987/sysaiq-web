// Encrypted secrets table + move the OpenAI key out of settings.ai_config.
// Before this migration the key sat in plaintext in the settings table (and
// once leaked through /api/content). It is re-encrypted into secrets
// ("openai.api_key", AES-256-GCM, see lib/secrets-crypto.js), ai_config is
// rewritten to {model} only, and afterCommit() scrubs the old bytes from the
// database file: VACUUM cannot run inside the migration transaction, so the
// runner calls it right after the commit.
//
// Imports only config + the pure crypto helpers on purpose: db/index.js is
// still awaiting runMigrations() while this file loads, and importing it
// here would deadlock the module graph.
import { config, decodeSecretsKey } from '../../config.js';
import { encryptSecret, maskSecret } from '../../lib/secrets-crypto.js';

export const version = 2;
export const name = 'secrets';

const OPENAI_SECRET = 'openai.api_key';

export function up(db) {
  db.exec(`
    -- one row per secret; value = AES-256-GCM(ciphertext) with the name as AAD
    CREATE TABLE IF NOT EXISTS secrets (
      name       TEXT PRIMARY KEY,
      iv         BLOB NOT NULL,               -- 12 random bytes, fresh per write
      tag        BLOB NOT NULL,               -- 16-byte GCM auth tag
      ciphertext BLOB NOT NULL,
      key_id     TEXT NOT NULL DEFAULT '',    -- fingerprint of the SECRETS_KEY used
      hint       TEXT NOT NULL DEFAULT '',    -- '••••1a2b' for the admin UI
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_by TEXT NOT NULL DEFAULT ''
    );
  `);

  const row = db.prepare("SELECT value FROM settings WHERE key='ai_config'").get();
  if (!row) return;
  let cfg = null;
  try { cfg = JSON.parse(row.value); } catch { /* not JSON: nothing to move */ }
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) return;

  const key = typeof cfg.openai_key === 'string' ? cfg.openai_key.trim() : '';
  // everything except the key: only `model` is meaningful
  const rest = cfg.model ? { model: String(cfg.model).slice(0, 80) } : {};
  const rewrite = () => db.prepare("UPDATE settings SET value=?, updated_at=datetime('now') WHERE key='ai_config'")
    .run(JSON.stringify(rest));

  if (!key) {
    if ('openai_key' in cfg) rewrite(); // empty leftover field
    return;
  }

  // config.js generates a throw-away key in dev/test when SECRETS_KEY is unset;
  // encrypting with it would make the key unreadable after the next restart
  // AND destroy the only copy. Production never gets here without one
  // (config.js fails fast) — the throw is a second line of defence.
  if (!decodeSecretsKey(process.env.SECRETS_KEY)) {
    if (config.isProd) throw new Error('[migrate 002] settings.ai_config holds a plaintext OpenAI key but SECRETS_KEY is not configured — set it in .env (openssl rand -base64 32) and restart');
    console.warn('[migrate 002] a plaintext OpenAI key is in settings.ai_config but SECRETS_KEY is not set — left untouched; set SECRETS_KEY in .env and re-enter the key in the admin panel');
    return;
  }

  const enc = encryptSecret(OPENAI_SECRET, key);
  db.prepare(`INSERT INTO secrets (name, iv, tag, ciphertext, key_id, hint, updated_by)
    VALUES (@name, @iv, @tag, @ciphertext, @key_id, @hint, 'migration-002')
    ON CONFLICT(name) DO UPDATE SET iv=excluded.iv, tag=excluded.tag, ciphertext=excluded.ciphertext,
      key_id=excluded.key_id, hint=excluded.hint, updated_at=datetime('now'), updated_by=excluded.updated_by`)
    .run({ name: OPENAI_SECRET, ...enc, hint: maskSecret(key) });
  rewrite();
}

// Runs outside the transaction (runner hook). secure_delete makes SQLite
// zero freed pages from now on; VACUUM rebuilds the file without the old
// page images; the TRUNCATE checkpoint moves that rebuilt content into the
// main file and empties the WAL, so neither file keeps the plaintext.
export function afterCommit(db) {
  db.pragma('secure_delete = ON');
  db.exec('VACUUM');
  db.pragma('wal_checkpoint(TRUNCATE)');
}
