// Admin authentication: bcrypt password check + JWT (HS256, pinned) in an
// httpOnly cookie scoped to /api/admin. Tokens carry the admin's
// token_version so a password change (or a "log out everywhere") invalidates
// every cookie issued before it.
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { db } from '../db/index.js';
import { config } from '../config.js';

export const COOKIE = 'sysaiq_admin';
const MAX_AGE = 1000 * 60 * 60 * 12; // 12h
const COOKIE_OPTS = {
  httpOnly: true,
  secure: config.isProd,
  sameSite: 'strict',
  path: '/api/admin',
};

// create, or reset the password of, an admin. Keeps the row id; bumps
// token_version so old sessions die with the old password.
export function createAdmin(username, password) {
  const hash = bcrypt.hashSync(password, 12);
  db.prepare(`INSERT INTO admins (username, pass_hash) VALUES (?, ?)
    ON CONFLICT(username) DO UPDATE SET pass_hash=excluded.pass_hash,
      pwd_changed_at=datetime('now'), token_version=token_version+1`).run(username, hash);
}

export function verifyLogin(username, password) {
  const row = db.prepare('SELECT * FROM admins WHERE username=?').get(username);
  // compare against a dummy hash when the user is unknown so timing doesn't reveal usernames
  const ok = bcrypt.compareSync(password, row?.pass_hash || DUMMY_HASH);
  if (!row || !ok) return null;
  db.prepare("UPDATE admins SET last_login_at=datetime('now') WHERE id=?").run(row.id);
  return { id: row.id, username: row.username, token_version: row.token_version || 0 };
}
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 4);

function signToken(admin) {
  return jwt.sign({ uid: admin.id, u: admin.username, tv: admin.token_version || 0 }, config.jwtSecret,
    { algorithm: 'HS256', expiresIn: '12h' });
}

export function issueCookie(res, admin) {
  // the pre-rebuild cookie lived at Path=/ — drop it so two same-named cookies never coexist
  res.clearCookie(COOKIE, { path: '/' });
  res.cookie(COOKIE, signToken(admin), { ...COOKIE_OPTS, maxAge: MAX_AGE });
}

export function clearCookie(res) {
  res.clearCookie(COOKIE, { path: '/' });
  res.clearCookie(COOKIE, COOKIE_OPTS);
}

// password check by id with no side effects (last_login_at untouched)
export function checkPassword(adminId, password) {
  const row = db.prepare('SELECT pass_hash FROM admins WHERE id=?').get(adminId);
  return bcrypt.compareSync(String(password || ''), row?.pass_hash || DUMMY_HASH) && !!row;
}

// bcrypt only looks at the first 72 bytes; a longer password would silently
// match on its prefix, so refuse it rather than pretend
export const PASSWORD_RULE = { min: 10, max: 72 };
export function passwordProblem(next) {
  if (typeof next !== 'string') return 'password must be a string';
  if (next.length < PASSWORD_RULE.min) return `password must be at least ${PASSWORD_RULE.min} characters`;
  if (Buffer.byteLength(next, 'utf8') > PASSWORD_RULE.max) return `password must be at most ${PASSWORD_RULE.max} bytes`;
  if (!/\p{L}/u.test(next) || !/\p{Nd}/u.test(next)) return 'password must contain a letter and a digit';
  return null;
}

// new password → old cookies die (token_version bump); returns the admin to
// re-issue a cookie for the current session
export function changePassword(adminId, next) {
  const hash = bcrypt.hashSync(next, 12);
  db.prepare(`UPDATE admins SET pass_hash=?, pwd_changed_at=datetime('now'), token_version=token_version+1 WHERE id=?`)
    .run(hash, adminId);
  const row = db.prepare('SELECT id, username, token_version FROM admins WHERE id=?').get(adminId);
  return row ? { id: row.id, username: row.username, token_version: row.token_version || 0 } : null;
}

export function adminAccount(adminId) {
  const row = db.prepare('SELECT username, pwd_changed_at, last_login_at FROM admins WHERE id=?').get(adminId);
  if (!row) return null;
  return {
    username: row.username,
    pwd_changed_at: row.pwd_changed_at || null,
    last_login_at: row.last_login_at || null,
    // the bootstrap password from .env is still in use until it is changed here
    default_password_suspected: !row.pwd_changed_at,
  };
}

const tokenVersionOf = db.prepare('SELECT token_version FROM admins WHERE id=?');

// middleware — gate admin routes; sets req.admin = {uid, u, tv, iat, exp}
export function requireAdmin(req, res, next) {
  const token = req.cookies?.[COOKIE];
  if (!token) return res.status(401).json({ error: 'unauthorized' });
  try {
    const payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
    const row = tokenVersionOf.get(payload.uid);
    if (!row || (row.token_version || 0) !== (payload.tv || 0)) return res.status(401).json({ error: 'unauthorized' });
    req.admin = payload;
    next();
  } catch {
    res.status(401).json({ error: 'unauthorized' });
  }
}
