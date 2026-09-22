// AI config — legacy shapes kept for the old admin panel:
//   GET  → {configured, key_hint, model, source}   (never the raw key)
//          source: panel | env | unreadable (stored key no longer decrypts —
//          re-enter it) | none; the same answer /setup-status gives.
//   PUT  {model?, openai_key?} → {ok}
// The key is stored in the encrypted secrets table (lib/secrets.js);
// settings.ai_config only ever holds {model} from here on.
import express from 'express';
import { getSetting, setSetting } from '../../db/index.js';
import { getSecret, setSecret, listSecrets } from '../../lib/secrets.js';
import { OPENAI_KEY_SECRET, aiModel } from '../../ai.js';

const router = express.Router();

router.get('/', (_req, res) => {
  const key = getSecret(OPENAI_KEY_SECRET) || '';
  const status = listSecrets().find(s => s.name === OPENAI_KEY_SECRET);
  res.json({
    configured: !!key,
    key_hint: key ? `sk-…${key.slice(-4)}` : '',
    model: aiModel(),
    // 'panel' = saved from the admin UI, 'env' = OPENAI_API_KEY fallback
    source: key ? (status?.source === 'db' ? 'panel' : 'env') : (status?.source === 'unreadable' ? 'unreadable' : 'none'),
  });
});

router.put('/', (req, res) => {
  const cur = getSetting('ai_config', {}) || {};
  const b = req.body || {};
  // never write the key (or a stale plaintext copy) back into settings
  const next = cur.model ? { model: cur.model } : {};
  if (typeof b.model === 'string' && b.model.trim()) next.model = b.model.trim().slice(0, 80);
  // only replace the key when a non-empty, non-masked value is sent
  if (typeof b.openai_key === 'string' && b.openai_key.trim() && !b.openai_key.includes('…') && !b.openai_key.includes('••••')) {
    setSecret(OPENAI_KEY_SECRET, b.openai_key.trim(), req.admin?.u);
  }
  setSetting('ai_config', next);
  res.json({ ok: true });
});

export default { basePath: '/ai-config', order: 70, router };
