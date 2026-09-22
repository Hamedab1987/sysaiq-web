// Home-page copy API (/api/admin/content) — the admin «متن‌های سایت» view.
//   GET    /content                → {groups:[{name, keys}], keys:[record…]}
//   GET    /content/:key           → one record
//   PUT    /content/:key           {en?, fa?}  string | null (= back to default); 422 {fields}
//   PUT    /content                {items:[{key, en?, fa?}]}  all-or-nothing
//   DELETE /content/:key           reset both languages (custom key + ?purge=1: remove it)
//   GET    /content/:key/revisions newest first
//   POST   /content/custom         {key:'X_…', label_fa, label_en?, type?, en?, fa?}
// lib/content.js validates, writes the revision and drops the render cache;
// the auto-mounter also invalidates + writes one generic audit row per write
// (`update content HERO_H1`, `delete content X_PROMO`…). Only the writes whose
// generic row says too little add a second one: the bulk save (the row has
// no key — one line naming them all), a custom key's creation (the path
// segment is "custom", not the key) and a purge (same path as a reset).
import express from 'express';
import { audit } from '../../lib/audit.js';
import {
  listContent, getContentRecord, getRevisions, setContent, setContentBulk,
  resetContent, purgeCustomKey, createCustomKey, mirrorLegacySetting,
} from '../../lib/content.js';

const router = express.Router();

const langsOf = body => ['en', 'fa'].filter(l => body && typeof body === 'object' && Object.hasOwn(body, l) && body[l] !== undefined);

router.get('/', (_req, res) => res.json(listContent()));

// bulk «ذخیره و انتشار» — the items array is applied in one transaction
router.put('/', (req, res) => {
  const items = req.body && typeof req.body === 'object' ? req.body.items : undefined;
  const records = setContentBulk(items, req.admin);
  const keys = records.map(r => r.key);
  audit(req, 'update', 'content', '', `bulk: ${keys.length} keys — ${keys.join(', ')}`, { bulk: true, keys });
  res.json({ ok: true, updated: keys, keys: records });
});

router.post('/custom', (req, res) => {
  const r = createCustomKey(req.body, req.admin);
  audit(req, 'create', 'content', r.key, `custom key ${r.key} (${r.type})`, { langs: langsOf(req.body) });
  res.status(201).json({ ok: true, ...r });
});

router.get('/:key/revisions', (req, res) => {
  res.json(getRevisions(req.params.key, req.query.limit));
});

router.get('/:key', (req, res) => res.json(getContentRecord(req.params.key)));

router.put('/:key', (req, res) => {
  res.json({ ok: true, ...setContent(req.params.key, req.body, req.admin) });
});

router.delete('/:key', (req, res) => {
  const purge = ['1', 'true', 'yes'].includes(String(req.query.purge || '').toLowerCase());
  if (purge) {
    const out = purgeCustomKey(req.params.key);
    audit(req, 'delete', 'content', out.key, `custom key ${out.key} removed (purge)`, { purge: true });
    return res.json({ ok: true, ...out });
  }
  res.json({ ok: true, ...resetContent(req.params.key, req.admin) });
});

// For routes/admin/settings.routes.js (another owner): after a legacy
// PUT /settings/:key succeeds, mirrorLegacySetting(key, value, req.admin)
// copies the five mapped keys into `content`. lib/content.js already does
// this from the content.changed event, so wiring it is optional.
export { mirrorLegacySetting };

export default { basePath: '/content', order: 20, router };
