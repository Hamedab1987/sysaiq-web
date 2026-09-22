// Services CRUD (/api/admin/services) + reorder. Partial updates (only the
// keys sent change). The 10 catalogue services seeded by migration 009 are
// system rows: their slug cannot change and they cannot be deleted (409) —
// the slugs are fixed in FACTS.md; unpublish instead. JSON list columns are
// validated item by item (max 24 entries, capped lengths).
import express from 'express';
import { db } from '../../db/index.js';
import { v, validate } from '../../lib/validate.js';
import { J } from '../../lib/html.js';
import { HttpError } from '../../lib/errors.js';
import { isReservedSlug } from '../../lib/registry.js';
import { audit } from '../../lib/audit.js';
import { SERVICES } from '../../db/migrations/009_services.js';

const router = express.Router();
const SYSTEM = new Set(SERVICES.map(s => s[0]));

const opt = rule => { const f = (x, k) => (x === undefined ? undefined : rule(x, k)); f.optional = true; return f; };
const BOOL = (x, k) => (v.bool()(x, k) ? 1 : 0);
const MD = () => v.str({ max: 64 * 1024 });
const T = max => v.str({ max });
// a JSON list column: validated array → stored as JSON text
const list = (itemSchema, max = 24) => (x, k) => JSON.stringify(v.array(v.json(itemSchema), { max })(x, k));

const SCHEMA = {
  slug: opt(v.slug()),
  title_en: opt(T(200)), title_fa: opt(T(200)),
  tagline_en: opt(T(300)), tagline_fa: opt(T(300)),
  summary_en: opt(T(600)), summary_fa: opt(T(600)),
  audience_en: opt(MD()), audience_fa: opt(MD()),
  problems_en: opt(MD()), problems_fa: opt(MD()),
  deliverables: opt(list({ en: T(300), fa: T(300) })),
  process: opt(list({ title_en: T(200), title_fa: T(200), desc_en: T(1000), desc_fa: T(1000) })),
  timeline_en: opt(MD()), timeline_fa: opt(MD()),
  price_approach_en: opt(MD()), price_approach_fa: opt(MD()),
  faqs: opt(list({ q_en: T(500), q_fa: T(500), a_en: v.str({ max: 8000 }), a_fa: v.str({ max: 8000 }) })),
  related_projects: opt((x, k) => JSON.stringify(v.array(v.slug(), { max: 12 })(x, k))),
  meta_desc_en: opt(T(320)), meta_desc_fa: opt(T(320)),
  icon: opt(v.str({ max: 40, pattern: /^[a-z0-9-]*$/ })),
  sort: opt(v.int({ min: -1e6, max: 1e6 })), published: opt(BOOL),
};
const COLS = Object.keys(SCHEMA);
const DEFAULTS = Object.fromEntries(COLS.map(c => [c, c === 'sort' || c === 'published' ? 0 : /^(deliverables|process|faqs|related_projects)$/.test(c) ? '[]' : '']));

const getService = id => db.prepare('SELECT * FROM services WHERE id=?').get(id);
const idParam = req => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) throw new HttpError(404, 'not_found', 'Service not found');
  return id;
};
const conflict = e => (e?.code === 'SQLITE_CONSTRAINT_UNIQUE' ? new HttpError(409, 'conflict', 'A service with this slug already exists', { slug: 'already used' }) : e);
function checkSlug(slug) {
  if (isReservedSlug(slug)) throw new HttpError(422, 'validation', 'Validation failed', { slug: `"${slug}" is reserved by a site route` });
}

// fa/en parity while published (both /fa and /en pages are served and
// cross-linked by hreflang): the title in both languages; every other
// bilingual text either in both or in neither; each list item bilingual.
// Checked on the merged row, so clearing one language of a live service is
// refused too.
const PAIRS = ['tagline', 'summary', 'audience', 'problems', 'timeline', 'price_approach', 'meta_desc'];
const ITEM_PAIRS = { deliverables: [['en', 'fa']], process: [['title_en', 'title_fa'], ['desc_en', 'desc_fa']], faqs: [['q_en', 'q_fa'], ['a_en', 'a_fa']] };
const has = x => !!String(x ?? '').trim();
function checkParity(row) {
  if (!row.published) return;
  const fields = {};
  for (const k of ['title_fa', 'title_en']) if (!has(row[k])) fields[k] = `${k} is required while the service is published`;
  for (const p of PAIRS) {
    if (has(row[`${p}_fa`]) !== has(row[`${p}_en`])) {
      const k = has(row[`${p}_fa`]) ? `${p}_en` : `${p}_fa`;
      fields[k] = `${k} is empty while ${p} is written in the other language`;
    }
  }
  for (const [col, pairs] of Object.entries(ITEM_PAIRS)) {
    J(row[col]).forEach((it, i) => {
      for (const [en, fa] of pairs) {
        if (has(it?.[en]) !== has(it?.[fa])) fields[`${col}[${i}].${has(it?.[en]) ? fa : en}`] = 'both languages are required';
      }
    });
  }
  const missing = Object.keys(fields);
  if (!missing.length) return;
  fields.published = `both languages are required before publishing (see: ${missing.join(', ')})`;
  throw new HttpError(422, 'validation', 'Validation failed', fields);
}

router.get('/', (_req, res) => res.json(db.prepare('SELECT * FROM services ORDER BY sort, id').all()));

router.get('/:id', (req, res) => {
  const s = getService(idParam(req));
  if (!s) throw new HttpError(404, 'not_found', 'Service not found');
  res.json(s);
});

router.post('/', (req, res) => {
  const b = { ...DEFAULTS, ...validate(SCHEMA, req.body) };
  if (!b.slug) throw new HttpError(422, 'validation', 'Validation failed', { slug: 'slug is required' });
  checkSlug(b.slug);
  checkParity(b);
  let info;
  try {
    info = db.prepare(`INSERT INTO services (${COLS.join(',')}, updated_by) VALUES (${COLS.map(c => `@${c}`).join(',')}, @updated_by)`)
      .run({ ...b, updated_by: String(req.admin?.u || '') });
  } catch (e) { throw conflict(e); }
  res.json({ ok: true, id: info.lastInsertRowid });
});

router.put('/:id', (req, res) => {
  const id = idParam(req);
  const cur = getService(id);
  if (!cur) throw new HttpError(404, 'not_found', 'Service not found');
  const b = validate(SCHEMA, req.body);
  if (b.slug !== undefined) {
    if (SYSTEM.has(cur.slug) && b.slug !== cur.slug) throw new HttpError(409, 'system_service', 'The slug of a catalogue service cannot be changed');
    if (!b.slug) throw new HttpError(422, 'validation', 'Validation failed', { slug: 'slug is required' });
    checkSlug(b.slug);
  }
  const next = { ...cur, ...b, id, updated_by: String(req.admin?.u || '') };
  checkParity(next);
  try {
    db.prepare(`UPDATE services SET ${COLS.map(c => `${c}=@${c}`).join(',')}, updated_at=datetime('now'), updated_by=@updated_by WHERE id=@id`).run(next);
  } catch (e) { throw conflict(e); }
  if (b.published !== undefined && b.published !== cur.published) {
    audit(req, b.published ? 'publish' : 'unpublish', 'services', id, `${next.slug} ${b.published ? 'published' : 'unpublished'}`);
  }
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  const id = idParam(req);
  const cur = getService(id);
  if (!cur) throw new HttpError(404, 'not_found', 'Service not found');
  if (SYSTEM.has(cur.slug)) throw new HttpError(409, 'system_service', 'Catalogue services cannot be deleted — unpublish them instead');
  db.prepare('DELETE FROM services WHERE id=?').run(id);
  audit(req, 'delete', 'services', id, `${cur.slug} deleted`);
  res.json({ ok: true });
});

router.post('/reorder', (req, res) => {
  const { ids } = validate({ ids: v.array(v.int({ min: 1 }), { max: 500 }) }, req.body);
  const upd = db.prepare('UPDATE services SET sort=? WHERE id=?');
  db.transaction(() => ids.forEach((id, i) => upd.run((i + 1) * 10, id)))();
  res.json({ ok: true });
});

export default { basePath: '/services', order: 40, router };
