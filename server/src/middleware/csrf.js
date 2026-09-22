// CSRF guard for the whole /api/admin tree (login included).
// Every state-changing request must (a) come from one of our own origins —
// the Origin header, or the Referer's origin when a browser omits Origin —
// and (b) carry `X-Requested-With: sysaiq-admin`, which a cross-site form
// post or a plain <img>/<script> fetch can never add. Together with the
// SameSite=Strict cookie this is belt and braces; the answer is always
// 403 {error:"csrf"} so the admin UI can tell it from a 401.
import { config } from '../config.js';

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);
const CSRF_HEADER = 'x-requested-with';
const CSRF_TOKEN = 'sysaiq-admin';

function originOf(url) {
  try { return new URL(url).origin; } catch { return ''; }
}

function requestOrigin(req) {
  const origin = req.get('origin');
  if (origin) return origin === 'null' ? '' : originOf(origin);
  const referer = req.get('referer');
  return referer ? originOf(referer) : '';
}

export function csrfGuard(req, res, next) {
  if (SAFE.has(req.method)) return next();
  const origin = requestOrigin(req);
  if (!origin || !config.allowedOrigins.includes(origin)) return res.status(403).json({ error: 'csrf' });
  if (String(req.get(CSRF_HEADER) || '').toLowerCase() !== CSRF_TOKEN) return res.status(403).json({ error: 'csrf' });
  next();
}
