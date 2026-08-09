// Admin authentication: bcrypt password check + JWT in an httpOnly cookie.
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { db } from './db.js';

const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-env';
const COOKIE = 'sysaiq_admin';
const MAX_AGE = 1000 * 60 * 60 * 12; // 12h

export function createAdmin(username, password) {
  const hash = bcrypt.hashSync(password, 12);
  db.prepare('INSERT OR REPLACE INTO admins (username, pass_hash) VALUES (?,?)').run(username, hash);
}

export function verifyLogin(username, password) {
  const row = db.prepare('SELECT * FROM admins WHERE username=?').get(username);
  if (!row) return null;
  if (!bcrypt.compareSync(password, row.pass_hash)) return null;
  return { id: row.id, username: row.username };
}

export function issueCookie(res, admin) {
  const token = jwt.sign({ uid: admin.id, u: admin.username }, JWT_SECRET, { expiresIn: '12h' });
  res.cookie(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: MAX_AGE,
  });
}

export function clearCookie(res) {
  res.clearCookie(COOKIE);
}

// middleware — gate admin routes
export function requireAdmin(req, res, next) {
  const token = req.cookies?.[COOKIE];
  if (!token) return res.status(401).json({ error: 'unauthorized' });
  try {
    req.admin = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'unauthorized' });
  }
}
