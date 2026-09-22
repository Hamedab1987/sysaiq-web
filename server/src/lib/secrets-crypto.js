// Pure AES-256-GCM helpers for the secrets table — no database import.
// Kept separate from lib/secrets.js so migration 002 can use them while
// db/index.js is still mid-`await runMigrations()` (importing db/index.js
// from inside a migration would deadlock the ESM cycle).
//   encryptSecret(name, value) → {iv, tag, ciphertext, key_id}
//   decryptSecret(name, row)   → value   (throws on tamper / wrong key / wrong name)
// The secret NAME is the GCM additional authenticated data: a row copied from
// "a" to "b" fails to decrypt as "b", so rows cannot be swapped in the file.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { config } from '../config.js';

const ALG = 'aes-256-gcm';
const IV_BYTES = 12;

// short fingerprint of the key in use, stored with every row so a rotation
// tool can tell which key a row was written with — never reveals the key
function keyId(key = config.secretsKey) {
  return createHash('sha256').update(key).digest('hex').slice(0, 8);
}

export function encryptSecret(name, value, key = config.secretsKey) {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw new Error('[secrets] SECRETS_KEY is not a 32-byte key');
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALG, key, iv);
  cipher.setAAD(Buffer.from(String(name), 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  return { iv, tag: cipher.getAuthTag(), ciphertext, key_id: keyId(key) };
}

export function decryptSecret(name, row, key = config.secretsKey) {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw new Error('[secrets] SECRETS_KEY is not a 32-byte key');
  const decipher = createDecipheriv(ALG, key, Buffer.from(row.iv));
  decipher.setAAD(Buffer.from(String(name), 'utf8'));
  decipher.setAuthTag(Buffer.from(row.tag));
  return Buffer.concat([decipher.update(Buffer.from(row.ciphertext)), decipher.final()]).toString('utf8');
}

// '••••1a2b' — enough for the owner to recognise a key, useless to anyone else
export function maskSecret(value) {
  const s = String(value ?? '');
  if (!s) return '';
  return `••••${s.length > 4 ? s.slice(-4) : ''}`;
}
