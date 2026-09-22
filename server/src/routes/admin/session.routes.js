// Admin session: login / logout / me. Mounted OUTSIDE the admin gate
// (gate: false) — /me applies requireAdmin itself, exactly as before.
import express from 'express';
import rateLimit from 'express-rate-limit';
import { verifyLogin, issueCookie, clearCookie, requireAdmin } from '../../middleware/auth.js';
import { audit } from '../../lib/audit.js';

const router = express.Router();
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10 });

router.post('/login', loginLimiter, (req, res) => {
  const { username, password } = req.body || {};
  const u = typeof username === 'string' ? username.slice(0, 80) : '';
  const admin = verifyLogin(u, typeof password === 'string' ? password : '');
  if (!admin) {
    audit({ ip: req.ip, admin: { u } }, 'login.failed', 'admins', '', 'bad credentials');
    return res.status(401).json({ error: 'invalid credentials' });
  }
  issueCookie(res, admin);
  audit({ ip: req.ip, admin: { uid: admin.id, u: admin.username } }, 'login', 'admins', admin.id);
  res.json({ ok: true, username: admin.username });
});

router.post('/logout', (_req, res) => { clearCookie(res); res.json({ ok: true }); });

router.get('/me', requireAdmin, (req, res) => res.json({ username: req.admin.u }));

export default { basePath: '', order: 0, gate: false, router };
