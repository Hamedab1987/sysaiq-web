// Encrypted secrets store (API keys, merchant ids, SMS tokens…).
// Rows live in the `secrets` table (migration 002) as AES-256-GCM ciphertext
// keyed by config.secretsKey with the secret NAME as AAD; see secrets-crypto.js.
// Owners register their secret at import time:
//   registerSecret({ name: 'openai.api_key', label_fa, label_en, group: 'ai', envFallback: 'OPENAI_API_KEY' })
// getSecret() returns the stored value, else the registered env var, else null.
// No function here ever returns a value to an HTTP response: listSecrets()
// only says {configured, hint, source}.
import { db } from '../db/index.js';
import { HttpError } from './errors.js';
import { encryptSecret, decryptSecret, maskSecret } from './secrets-crypto.js';

export { maskSecret } from './secrets-crypto.js';

const registry = new Map(); // name → {name, label_fa, label_en, group, envFallback, validate}
const NAME_RE = /^[a-z0-9_]+(?:\.[a-z0-9_]+)*$/;
const MAX_VALUE = 4096;

let stmts = null;
function q() {
  return stmts ||= {
    get: db.prepare('SELECT name, iv, tag, ciphertext, key_id, hint, updated_at, updated_by FROM secrets WHERE name=?'),
    put: db.prepare(`INSERT INTO secrets (name, iv, tag, ciphertext, key_id, hint, updated_at, updated_by)
      VALUES (@name, @iv, @tag, @ciphertext, @key_id, @hint, datetime('now'), @updated_by)
      ON CONFLICT(name) DO UPDATE SET iv=excluded.iv, tag=excluded.tag, ciphertext=excluded.ciphertext,
        key_id=excluded.key_id, hint=excluded.hint, updated_at=datetime('now'), updated_by=excluded.updated_by`),
    del: db.prepare('DELETE FROM secrets WHERE name=?'),
  };
}

export function registerSecret({ name, label_fa = '', label_en = '', group = 'general', envFallback = null, validate = null } = {}) {
  if (!name || !NAME_RE.test(name)) throw new Error(`registerSecret: bad name "${name}" (a-z, 0-9, _, dot-separated)`);
  const def = { name, label_fa, label_en, group, envFallback, validate };
  registry.set(name, def); // idempotent: last registration wins
  return def;
}
export const isRegisteredSecret = name => registry.has(name);

function envValue(name) {
  const v = registry.get(name)?.envFallback;
  const raw = v ? process.env[v] : '';
  return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
}

// stored value → env fallback → null. A row that no longer decrypts (key
// rotated, file tampered) counts as "not configured"; it is logged once per
// name without any value.
const warned = new Set();
export function getSecret(name) {
  const row = q().get.get(String(name));
  if (row) {
    try {
      return decryptSecret(name, row);
    } catch {
      if (!warned.has(name)) {
        warned.add(name);
        console.error(`[secrets] cannot decrypt "${name}" (SECRETS_KEY changed or row tampered) — re-enter it in the admin panel`);
      }
      return null;
    }
  }
  return envValue(name);
}

// same answer as getSecret(), so setup-status and ai-config can never disagree
export function hasSecret(name) {
  return getSecret(name) !== null;
}

export function setSecret(name, value, adminId = null) {
  const def = registry.get(name);
  if (typeof value !== 'string') throw new HttpError(422, 'validation', 'Validation failed', { value: 'value must be a string' });
  const v = value.trim();
  if (!v) throw new HttpError(422, 'validation', 'Validation failed', { value: 'value must not be empty' });
  if (v.length > MAX_VALUE) throw new HttpError(422, 'validation', 'Validation failed', { value: `value must be at most ${MAX_VALUE} characters` });
  if (def?.validate) {
    const r = def.validate(v);
    if (r === false || typeof r === 'string') {
      throw new HttpError(422, 'validation', 'Validation failed', { value: typeof r === 'string' ? r : 'value has an invalid format' });
    }
  }
  const enc = encryptSecret(name, v);
  q().put.run({ name, ...enc, hint: maskSecret(v), updated_by: adminId === null || adminId === undefined ? '' : String(adminId).slice(0, 80) });
  warned.delete(name);
  return true;
}

export function deleteSecret(name) {
  warned.delete(name);
  return q().del.run(String(name)).changes > 0;
}

const readable = (name, row) => { try { decryptSecret(name, row); return true; } catch { return false; } };

// admin-facing status of every registered secret — never the values.
// source: 'db' | 'env' | 'unreadable' (row exists but SECRETS_KEY changed or
// the row was tampered with — the owner must re-enter it) | 'none'.
export function listSecrets() {
  return [...registry.values()].map(def => {
    const row = q().get.get(def.name);
    const env = envValue(def.name);
    let source = 'none', hint = '';
    if (row) {
      if (readable(def.name, row)) { source = 'db'; hint = row.hint; } else { source = 'unreadable'; }
    } else if (env !== null) { source = 'env'; hint = maskSecret(env); }
    return {
      name: def.name,
      labels: { fa: def.label_fa, en: def.label_en },
      group: def.group,
      configured: source === 'db' || source === 'env',
      hint,
      source,
      updated_at: row?.updated_at || null,
    };
  });
}
