// Admin «سئو و تگ‌های تأیید» — /api/admin/head-meta CRUD.
// Rows are <meta name content> pairs; name must be in lib/trust.js's
// HEAD_META_NAMES and content matches HEAD_META_CONTENT_RE (422 otherwise).
import express from 'express';
import { db } from '../../db/index.js';
import { HttpError } from '../../lib/errors.js';
import { audit } from '../../lib/audit.js';
import { validateHeadMeta, HEAD_META_NAMES } from '../../lib/trust.js';

const router = express.Router();

const rowById = id => db.prepare('SELECT * FROM head_meta WHERE id=?').get(id);
const idParam = req => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(404, 'not_found', 'Not found');
  return id;
};
const enabledOf = (x, dflt) => (x === undefined ? dflt : (x === true || x === 1 || x === '1' || x === 'true') ? 1 : 0);

router.get('/', (_req, res) => res.json({ names: HEAD_META_NAMES, rows: db.prepare('SELECT * FROM head_meta ORDER BY id').all() }));

router.post('/', (req, res) => {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const { name, content } = validateHeadMeta(body);
  const enabled = enabledOf(body.enabled, 1);
  const info = db.prepare('INSERT INTO head_meta (name, content, enabled) VALUES (?, ?, ?)').run(name, content, enabled);
  const id = Number(info.lastInsertRowid);
  audit(req, 'create', 'head_meta', id, `meta ${name}`);
  res.json({ ok: true, id, row: rowById(id) });
});

router.put('/:id', (req, res) => {
  const id = idParam(req);
  const row = rowById(id);
  if (!row) throw new HttpError(404, 'not_found', 'Not found');
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const { name, content } = validateHeadMeta({ name: body.name ?? row.name, content: body.content ?? row.content });
  const enabled = enabledOf(body.enabled, row.enabled);
  db.prepare("UPDATE head_meta SET name=?, content=?, enabled=?, updated_at=datetime('now') WHERE id=?").run(name, content, enabled, id);
  audit(req, 'update', 'head_meta', id, `meta ${name}`, { enabled: !!enabled });
  res.json({ ok: true, row: rowById(id) });
});

router.delete('/:id', (req, res) => {
  const id = idParam(req);
  const row = rowById(id);
  if (!row) throw new HttpError(404, 'not_found', 'Not found');
  db.prepare('DELETE FROM head_meta WHERE id=?').run(id);
  audit(req, 'delete', 'head_meta', id, `meta ${row.name}`);
  res.json({ ok: true });
});

export default { basePath: '/head-meta', order: 40, router };
