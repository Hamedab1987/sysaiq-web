// Admin «اینماد و نمادها» — /api/admin/badges
//   POST /parse {kind, snippet}        → the parsed fields + a preview (nothing stored)
//   GET  /                              → all rows (+ rendered preview each)
//   POST /  {kind, snippet|fields, …}   → create (snippet is parsed, never stored)
//   PUT  /:id                           → update labels/placement/langs/enabled/sort/size
//                                         (+ re-parse when a new snippet is given)
//   DELETE /:id
import express from 'express';
import { db } from '../../db/index.js';
import { v, validate } from '../../lib/validate.js';
import { HttpError } from '../../lib/errors.js';
import { audit } from '../../lib/audit.js';
import { parseSnippet, renderBadge, BADGE_KINDS, PLACEMENTS, ensureTrustCsp } from '../../lib/trust.js';

const router = express.Router();
const LANGS = ['fa', 'en'];

const META = {
  label_en: v.str({ max: 80 }),
  label_fa: v.str({ max: 80 }),
  width: v.default(v.int({ min: 0, max: 2000 }), 0),
  height: v.default(v.int({ min: 0, max: 2000 }), 0),
  placement: v.default(v.oneOf(PLACEMENTS), 'footer'),
  langs: v.default(v.array(v.oneOf(LANGS), { max: 2 }), LANGS),
  enabled: v.default(v.bool(), true),
  sort: v.default(v.int({ min: -1e6, max: 1e6 }), 0),
};
const KIND = { kind: v.oneOf(BADGE_KINDS) };

const rowById = id => db.prepare('SELECT * FROM badges WHERE id=?').get(id);
const idParam = req => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(404, 'not_found', 'Not found');
  return id;
};
const withPreview = row => ({ ...row, langs: String(row.langs).split(',').filter(Boolean), preview: renderBadge(row, 'fa') });

// custom_image: the fields come as {img_url, link_url}; the seal kinds: {snippet}
const parseFrom = (kind, body) => parseSnippet(kind, kind === 'custom_image' ? { img_url: body.img_url, link_url: body.link_url } : body.snippet);

router.post('/parse', (req, res) => {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const { kind } = validate(KIND, body);
  const parsed = parseFrom(kind, body);
  res.json({ ok: true, ...parsed, preview: renderBadge({ ...parsed, width: 0, height: 0 }, 'fa') });
});

router.get('/', (_req, res) => res.json(db.prepare('SELECT * FROM badges ORDER BY sort, id').all().map(withPreview)));

router.post('/', (req, res) => {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const { kind } = validate(KIND, body);
  const meta = validate(META, body);
  const parsed = parseFrom(kind, body);
  const info = db.prepare(`INSERT INTO badges (kind, seal_id, seal_code, link_url, img_url, label_en, label_fa, width, height, placement, langs, enabled, sort)
    VALUES (@kind, @seal_id, @seal_code, @link_url, @img_url, @label_en, @label_fa, @width, @height, @placement, @langs, @enabled, @sort)`)
    .run({ ...parsed, ...meta, langs: meta.langs.join(','), enabled: meta.enabled ? 1 : 0 });
  const id = Number(info.lastInsertRowid);
  if (meta.enabled) ensureTrustCsp();
  audit(req, 'create', 'badges', id, `badge ${kind}${parsed.seal_id ? ` #${parsed.seal_id}` : ''}`, { kind, placement: meta.placement });
  res.json({ ok: true, id, badge: withPreview(rowById(id)) });
});

router.put('/:id', (req, res) => {
  const id = idParam(req);
  const row = rowById(id);
  if (!row) throw new HttpError(404, 'not_found', 'Not found');
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const meta = validate(META, { ...row, langs: String(row.langs).split(',').filter(Boolean), enabled: !!row.enabled, ...body });
  // a new snippet (or new custom fields) re-parses; otherwise the seal fields stay as they are
  const reparse = row.kind === 'custom_image' ? ('img_url' in body || 'link_url' in body) : typeof body.snippet === 'string' && body.snippet.trim();
  const parsed = reparse ? parseFrom(row.kind, { ...row, ...body }) : { seal_id: row.seal_id, seal_code: row.seal_code, link_url: row.link_url, img_url: row.img_url };
  db.prepare(`UPDATE badges SET seal_id=@seal_id, seal_code=@seal_code, link_url=@link_url, img_url=@img_url,
    label_en=@label_en, label_fa=@label_fa, width=@width, height=@height, placement=@placement, langs=@langs,
    enabled=@enabled, sort=@sort, updated_at=datetime('now') WHERE id=@id`)
    .run({ ...parsed, ...meta, langs: meta.langs.join(','), enabled: meta.enabled ? 1 : 0, id });
  if (meta.enabled) ensureTrustCsp();
  audit(req, 'update', 'badges', id, `badge ${row.kind}${reparse ? ' (re-parsed)' : ''}`, { enabled: meta.enabled, placement: meta.placement });
  res.json({ ok: true, badge: withPreview(rowById(id)) });
});

router.delete('/:id', (req, res) => {
  const id = idParam(req);
  const row = rowById(id);
  if (!row) throw new HttpError(404, 'not_found', 'Not found');
  db.prepare('DELETE FROM badges WHERE id=?').run(id);
  audit(req, 'delete', 'badges', id, `badge ${row.kind}${row.seal_id ? ` #${row.seal_id}` : ''}`);
  res.json({ ok: true });
});

// for the setup checklist / «آمادگی برای درخواست اینماد» panel
export const hasEnabledBadge = kind => !!db.prepare('SELECT 1 FROM badges WHERE enabled=1 AND kind=?').get(kind);

export default { basePath: '/badges', order: 40, router };
