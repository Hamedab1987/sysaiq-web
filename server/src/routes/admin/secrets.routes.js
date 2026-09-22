// Secrets (API keys, merchant ids…) — status only, never values.
//   GET    /secrets            → [{name, labels, group, configured, hint, source, updated_at}]
//   PUT    /secrets/:name {value} → {ok, hint}
//   DELETE /secrets/:name      → {ok}
// Only names registered via registerSecret() are accepted, so a typo can
// never create an orphan row.
import express from 'express';
import { HttpError, asyncHandler } from '../../lib/errors.js';
import { listSecrets, setSecret, deleteSecret, isRegisteredSecret, maskSecret } from '../../lib/secrets.js';
import { audit } from '../../lib/audit.js';

const router = express.Router();

function known(req) {
  const name = String(req.params.name || '');
  if (!isRegisteredSecret(name)) throw new HttpError(404, 'not_found', 'Unknown secret');
  return name;
}

router.get('/', (_req, res) => res.json(listSecrets()));

router.put('/:name', asyncHandler(async (req, res) => {
  const name = known(req);
  const value = req.body?.value;
  if (typeof value !== 'string') throw new HttpError(422, 'validation', 'Validation failed', { value: 'value must be a string' });
  setSecret(name, value, req.admin?.u);
  audit(req, 'secret.set', 'secrets', name); // no value, ever
  res.json({ ok: true, hint: maskSecret(value.trim()) });
}));

router.delete('/:name', (req, res) => {
  const name = known(req);
  deleteSecret(name);
  audit(req, 'secret.delete', 'secrets', name);
  res.json({ ok: true });
});

export default { basePath: '/secrets', order: 71, router };
