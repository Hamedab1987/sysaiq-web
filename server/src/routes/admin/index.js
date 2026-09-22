// Mounts routes/admin/*.routes.js under /api/admin.
// csrfGuard fronts the WHOLE tree (login included). Modules with `gate: false`
// (session: login/logout/me) mount next, outside the auth gate. Everything
// else sits behind requireAdmin → write-tracking, which on any 2xx answer to
// a non-GET request drops the render cache, emits content.changed and writes
// an audit row.
import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { discoverRoutes } from '../discover.js';
import { requireAdmin } from '../../middleware/auth.js';
import { csrfGuard } from '../../middleware/csrf.js';
import { invalidate } from '../../lib/cache.js';
import { emit } from '../../lib/events.js';
import { audit } from '../../lib/audit.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ACTION = { POST: 'create', PUT: 'update', PATCH: 'update', DELETE: 'delete' };
const READ = new Set(['GET', 'HEAD', 'OPTIONS']);

function trackWrites(req, res, next) {
  if (READ.has(req.method)) return next();
  // path relative to /api/admin, captured now: nested routers rewrite req.url
  const path = req.path;
  // remember the JSON body we send so the audit row can pick up a new id
  const json = res.json.bind(res);
  res.json = body => { res.locals.sent = body; return json(body); };
  res.on('finish', () => {
    if (res.statusCode < 200 || res.statusCode >= 300) return;
    invalidate();
    const [entity = '', idFromPath = ''] = path.split('/').filter(Boolean);
    const entityId = idFromPath || res.locals.sent?.id || '';
    emit('content.changed', { method: req.method, path, entity, entityId, admin: req.admin?.u });
    audit(req, ACTION[req.method] || req.method.toLowerCase(), entity, entityId, `${req.method} ${path}`);
  });
  next();
}

export async function mountAdminRoutes(app) {
  const mods = await discoverRoutes(__dirname);
  const open = express.Router();
  const gated = express.Router();
  gated.use(requireAdmin);
  gated.use(trackWrites);
  for (const m of mods) (m.gate ? gated : open).use(m.basePath, m.router);
  // unknown admin API paths answer JSON, never the SPA shell
  gated.use((_req, res) => res.status(404).json({ error: 'not_found', message: 'Not found' }));
  app.use('/api/admin', csrfGuard, open, gated);
  return mods.map(m => ({ file: m.file, basePath: m.basePath, order: m.order, gate: m.gate }));
}
