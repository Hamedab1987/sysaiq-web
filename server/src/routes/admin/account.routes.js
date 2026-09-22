// The signed-in admin's own account.
//   GET  /account                      → {username, pwd_changed_at, last_login_at, default_password_suspected}
//   POST /account/password {current, next} → {ok}   (re-issues the cookie; every other session dies)
import express from 'express';
import rateLimit from 'express-rate-limit';
import { HttpError } from '../../lib/errors.js';
import { adminAccount, checkPassword, changePassword, passwordProblem, issueCookie } from '../../middleware/auth.js';
import { audit } from '../../lib/audit.js';

const router = express.Router();
const pwdLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10 });

router.get('/', (req, res) => {
  const a = adminAccount(req.admin.uid);
  if (!a) throw new HttpError(404, 'not_found', 'Admin not found');
  res.json(a);
});

router.post('/password', pwdLimiter, (req, res) => {
  const { current, next } = req.body || {};
  const fields = {};
  const problem = passwordProblem(next);
  if (problem) fields.next = problem;
  if (typeof current !== 'string' || !current) fields.current = 'current password is required';
  if (Object.keys(fields).length) throw new HttpError(422, 'validation', 'Validation failed', fields);
  if (!checkPassword(req.admin.uid, current)) {
    audit(req, 'password.change.failed', 'admins', req.admin.uid, 'wrong current password');
    throw new HttpError(403, 'wrong_password', 'Current password is incorrect', { current: 'current password is incorrect' });
  }
  if (current === next) throw new HttpError(422, 'validation', 'Validation failed', { next: 'new password must differ from the current one' });
  const admin = changePassword(req.admin.uid, next);
  if (!admin) throw new HttpError(404, 'not_found', 'Admin not found');
  issueCookie(res, admin);
  audit(req, 'password.change', 'admins', admin.id);
  res.json({ ok: true });
});

export default { basePath: '/account', order: 5, router };
