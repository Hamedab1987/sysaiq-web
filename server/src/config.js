// Environment → one frozen config object, parsed once at boot.
// Production fails fast on missing/weak secrets so a half-configured server
// never starts; dev/test get throw-away random secrets so `npm run dev` and
// `npm test` work with no .env at all.
import dotenv from 'dotenv';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

// tests build their own environment — a developer's local .env must not leak in
if (process.env.NODE_ENV !== 'test') dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const E = process.env;

const env = E.NODE_ENV || 'development';
const isProd = env === 'production';
const port = Number(E.PORT) || 3000;

// placeholders that shipped in the repo (.env.example / old auth.js) are not secrets
const WEAK_JWT = ['change-me-in-env', 'change-this-to-a-long-random-string'];
const WEAK_ADMIN_PASS = ['change-this-now', 'sysaiq-admin'];

// SECRETS_KEY is 32 random bytes written as hex (64 chars) or base64/base64url.
// Hex is tested first: a 64-char hex string is also syntactically valid base64.
export function decodeSecretsKey(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  let buf = null;
  if (/^[0-9a-fA-F]{64}$/.test(s)) buf = Buffer.from(s, 'hex');
  else if (/^[A-Za-z0-9+/_-]+={0,2}$/.test(s)) buf = Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  if (!buf || buf.length !== 32) return null;
  if (buf.every(b => b === buf[0])) return null; // 000…0 / aaa…a is not a key
  return buf;
}

const generated = [];
let jwtSecret = E.JWT_SECRET || '';
if (!jwtSecret || WEAK_JWT.includes(jwtSecret) || jwtSecret.length < 24) {
  if (isProd) throw new Error('[config] JWT_SECRET is missing or weak — set a random string of at least 24 characters in .env');
  jwtSecret = randomBytes(32).toString('hex');
  generated.push('JWT_SECRET');
}
let secretsKey = decodeSecretsKey(E.SECRETS_KEY);
if (!secretsKey) {
  if (isProd) throw new Error('[config] SECRETS_KEY is missing or invalid — it must be exactly 32 random bytes as base64 or hex (openssl rand -base64 32)');
  secretsKey = randomBytes(32);
  generated.push('SECRETS_KEY');
}
// one line per boot naming the environment, so `journalctl -u sysaiq` proves
// NODE_ENV=production reached the process (the fail-fast above, migration
// 002's throw and durable secret encryption all hinge on it)
if (generated.length) {
  console.log(`[config] ${env}: ${generated.join(' + ')} not set — using random in-memory values (sessions and stored secrets do not survive a restart)`);
} else if (env !== 'test') {
  console.log(`[config] ${env}: JWT_SECRET + SECRETS_KEY loaded from the environment`);
}

const stripSlash = s => String(s).trim().replace(/\/+$/, '');
const publicBaseUrl = stripSlash(E.PUBLIC_BASE_URL || (isProd ? 'https://sysaiq.com' : `http://127.0.0.1:${port}`));

// Origins the admin may call the API from (CSRF check). ALLOWED_ORIGINS adds
// extras, comma-separated (e.g. https://www.sysaiq.com).
const allowedOrigins = [...new Set([
  publicBaseUrl,
  ...(E.ALLOWED_ORIGINS || '').split(',').map(stripSlash).filter(Boolean),
  ...(isProd ? [] : [`http://127.0.0.1:${port}`, `http://localhost:${port}`]),
])];

const dataDir = resolve(E.DATA_DIR || join(ROOT, 'data'));

// POST /api/leads submissions per ip per hour. Overridable so the test
// harness (which posts hundreds) never has to be special-cased in a route.
const leadsRateMax = /^[1-9]\d{0,5}$/.test(E.LEADS_RATE_MAX || '') ? Number(E.LEADS_RATE_MAX) : 15;

export const config = Object.freeze({
  env,
  isProd,
  port,
  dataDir,
  uploadDir: resolve(E.UPLOAD_DIR || join(dataDir, 'uploads')),
  siteDir: resolve(E.SITE_DIR || join(ROOT, 'public')),
  publicBaseUrl,
  jwtSecret,
  secretsKey, // Buffer(32) — AES-256 key for lib/secrets.js
  allowedOrigins: Object.freeze(allowedOrigins),
  leadsRateMax,
});

// First-run admin credentials. Called by createApp() only while the admins
// table is empty — so a production box that already has its admin never needs
// ADMIN_PASS in .env, but a fresh one refuses to boot with a missing/placeholder one.
export function adminBootstrap() {
  const username = (E.ADMIN_USER || 'admin').trim() || 'admin';
  const password = E.ADMIN_PASS || '';
  if (isProd) {
    if (!password || WEAK_ADMIN_PASS.includes(password) || password.length < 10) {
      throw new Error('[config] no admin exists yet and ADMIN_PASS is missing or weak — set ADMIN_USER and ADMIN_PASS (10+ characters) in .env for the first boot');
    }
    return { username, password, isDefault: false };
  }
  // dev convenience only: the old well-known default, never accepted in production
  return { username, password: password || 'sysaiq-admin', isDefault: !password };
}
