// Site copy settings (hero, about, contact…). Only registry-public keys are
// readable or writable here — private rows (ai_config…) are invisible.
import express from 'express';
import { setSetting } from '../../db/index.js';
import { isPublicSetting } from '../../lib/registry.js';
import { publicSettingValues } from '../../lib/site-settings.js';
import { v, validate } from '../../lib/validate.js';

const router = express.Router();

// PUT {value: {en, fa}} — both strings, 5000 chars each; anything else is 422
const SCHEMA = {
  value: v.default(v.json({ en: v.str({ max: 5000, trim: false }), fa: v.str({ max: 5000, trim: false }) }), { en: '', fa: '' }),
};

router.get('/', (_req, res) => res.json(publicSettingValues()));

router.put('/:key', (req, res) => {
  if (!isPublicSetting(req.params.key)) return res.status(400).json({ error: 'unknown setting' });
  const { value } = validate(SCHEMA, req.body);
  setSetting(req.params.key, { en: value.en, fa: value.fa });
  res.json({ ok: true });
});

export default { basePath: '/settings', order: 10, router };
