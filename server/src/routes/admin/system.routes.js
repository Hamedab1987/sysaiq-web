// System status for the admin dashboard.
//   GET  /system              → {node, schema_version, uptime_s, env}
//   POST /system/cache/purge  → {ok}   (render cache + CSP manifest cache)
//   GET  /setup-status        → booleans for the "finish setting up" checklist
import express from 'express';
import { config } from '../../config.js';
import { schemaVersion } from '../../db/index.js';
import { invalidate } from '../../lib/cache.js';
import { resetCspCache } from '../../lib/csp.js';
import { hasSecret } from '../../lib/secrets.js';
import { adminAccount } from '../../middleware/auth.js';
import { OPENAI_KEY_SECRET } from '../../ai.js';

const router = express.Router();

router.get('/system', (_req, res) => res.json({
  node: process.version,
  schema_version: schemaVersion(),
  uptime_s: Math.round(process.uptime()),
  env: config.env,
}));

router.post('/system/cache/purge', (_req, res) => {
  invalidate();
  resetCspCache();
  res.json({ ok: true });
});

router.get('/setup-status', (req, res) => {
  const account = adminAccount(req.admin.uid);
  res.json({
    openai_key: hasSecret(OPENAI_KEY_SECRET),
    default_password_suspected: account ? account.default_password_suspected : true,
    smtp: !!process.env.SMTP_HOST,
    backup_recent: false,      // nightly backup timer lands in M5
    // filled in by their own workstreams (site info, legal pages, enamad, gateways, SMS)
    site_info: false,
    required_pages: false,
    enamad: false,
    gateway: false,
    sms: false,
  });
});

export default { basePath: '', order: 95, router };
