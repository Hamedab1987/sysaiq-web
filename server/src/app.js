// SysaiQ backend — builds the Express app (no listen; see index.js).
// Serves: the built static site, a public content/AI/lead API, and a
// cookie-gated admin API + panel. Routes are auto-discovered from
// routes/public and routes/admin.
import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync } from 'node:fs';

import { config, adminBootstrap } from './config.js';
import { db, schemaVersion } from './db/index.js';
import { createAdmin } from './middleware/auth.js';
import { errorMiddleware } from './lib/errors.js';
import { cspMiddleware, siteCspMiddleware } from './lib/csp.js';
import { mountPublicRoutes } from './routes/public/index.js';
import { mountAdminRoutes } from './routes/admin/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const ADMIN_DIR = join(ROOT, 'admin');

export async function createApp() {
  mkdirSync(config.uploadDir, { recursive: true });

  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  // CSP is set per response kind by lib/csp.js (below), so helmet's own is
  // off; enamad validates the referrer, so helmet's default no-referrer is
  // relaxed; HSTS only in production (TLS terminates at nginx).
  app.use(helmet({
    contentSecurityPolicy: false,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    strictTransportSecurity: config.isProd ? { maxAge: 180 * 24 * 3600, includeSubDomains: false } : false,
  }));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  app.get('/healthz', (_req, res) => res.json({ ok: true, version: schemaVersion() }));

  // ---- CSP per kind: api / upload / admin / home+page (lib/csp.js) ----
  app.use('/api', cspMiddleware('api'));
  app.use('/uploads', cspMiddleware('upload'), express.static(config.uploadDir, { maxAge: '7d' }));
  app.use('/admin', cspMiddleware('admin'));
  // /fa/ and /en/ → home (no header until templates/manifest.json exists),
  // /fa/… and /en/… → page (the SSR work pages and every later SSR route)
  app.use('/:lang(en|fa)', siteCspMiddleware());

  await mountPublicRoutes(app);
  await mountAdminRoutes(app);
  // any other /api path answers JSON, never a static 404 page
  app.use('/api', (_req, res) => res.status(404).json({ error: 'not_found', message: 'Not found' }));

  // ---- static: admin panel + built site (always last) ----
  app.use('/admin', express.static(ADMIN_DIR));
  app.get('/admin/*', (_req, res) => res.sendFile(join(ADMIN_DIR, 'index.html')));
  app.use('/', express.static(config.siteDir, { extensions: ['html'] }));

  app.use(errorMiddleware);

  // first-run: create the admin from env if none exists
  if (db.prepare('SELECT COUNT(*) c FROM admins').get().c === 0) {
    const a = adminBootstrap();
    createAdmin(a.username, a.password);
    console.log(`[init] created admin "${a.username}"${a.isDefault ? ' with the development default password — set ADMIN_PASS' : ''}`);
  }

  return app;
}
