// Pages CRUD (/api/admin/pages) + reorder + markdown preview.
// Partial updates: only the keys present in the body change (an admin with
// tabs saves one tab at a time). System pages (system_key set by migration
// 008) can neither be deleted nor renamed: 409. Reserved slugs (routes) are
// refused with 422 so a page can never shadow /work, /services, /contact….
// The auto-mounter already invalidates the render cache and writes the
// generic audit row; publish/unpublish get an explicit, readable one here.
import express from 'express';
import { db } from '../../db/index.js';
import { v, validate } from '../../lib/validate.js';
import { HttpError } from '../../lib/errors.js';
import { isReservedSlug } from '../../lib/registry.js';
import { audit } from '../../lib/audit.js';
import { LIMITS } from '../../lib/markdown.js';
import { getSiteContext } from '../../lib/sitecontext.js';
import { renderPageBody } from '../../render/page.js';

const router = express.Router();

// present-or-absent: undefined leaves the key out (merge semantics); '' and
// null reach the rule so a field can be cleared
const opt = rule => { const f = (x, k) => (x === undefined ? undefined : rule(x, k)); f.optional = true; return f; };
const DATE = v.str({ max: 10, pattern: /^(\d{4}-\d{2}-\d{2})?$/ });
const BOOL = (x, k) => (v.bool()(x, k) ? 1 : 0);

const SCHEMA = {
  slug: opt(v.slug()),
  kind: opt(v.oneOf(['custom', 'legal'])),
  title_en: opt(v.str({ max: 200 })), title_fa: opt(v.str({ max: 200 })),
  body_en: opt(v.str({ max: LIMITS.input })), body_fa: opt(v.str({ max: LIMITS.input })),
  meta_desc_en: opt(v.str({ max: 320 })), meta_desc_fa: opt(v.str({ max: 320 })),
  show_in_footer: opt(BOOL), show_in_nav: opt(BOOL), noindex: opt(BOOL),
  version: opt(v.str({ max: 20 })), effective_at: opt(DATE), legal_reviewed_at: opt(DATE),
  sort: opt(v.int({ min: -1e6, max: 1e6 })), published: opt(BOOL),
};
const COLS = Object.keys(SCHEMA);

const DEFAULTS = {
  slug: '', kind: 'custom', title_en: '', title_fa: '', body_en: '', body_fa: '', meta_desc_en: '', meta_desc_fa: '',
  show_in_footer: 0, show_in_nav: 0, noindex: 0, version: '', effective_at: '', legal_reviewed_at: '', sort: 0, published: 0,
};

const getPage = id => db.prepare('SELECT * FROM pages WHERE id=?').get(id);
const idParam = req => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) throw new HttpError(404, 'not_found', 'Page not found');
  return id;
};
const conflict = e => (e?.code === 'SQLITE_CONSTRAINT_UNIQUE' ? new HttpError(409, 'conflict', 'A page with this slug already exists', { slug: 'already used' }) : e);
function checkSlug(slug) {
  if (isReservedSlug(slug)) throw new HttpError(422, 'validation', 'Validation failed', { slug: `"${slug}" is reserved by a site route` });
}

// fa/en parity: a published page serves both /fa/<slug> and /en/<slug> and
// advertises both through hreflang, so it may not go (or stay) live while a
// title or body is empty in either language. Checked on the merged row, so
// clearing one language of a published page is refused too.
const PARITY = ['title_fa', 'title_en', 'body_fa', 'body_en'];
function checkParity(row) {
  if (!row.published) return;
  const missing = PARITY.filter(k => !String(row[k] || '').trim());
  if (!missing.length) return;
  const fields = Object.fromEntries(missing.map(k => [k, `${k} is required while the page is published`]));
  fields.published = `both languages are required before publishing (missing: ${missing.join(', ')})`;
  throw new HttpError(422, 'validation', 'Validation failed', fields);
}

router.get('/', (_req, res) => res.json(db.prepare('SELECT * FROM pages ORDER BY sort, id').all()));

router.get('/:id', (req, res) => {
  const p = getPage(idParam(req));
  if (!p) throw new HttpError(404, 'not_found', 'Page not found');
  res.json(p);
});

router.post('/', (req, res) => {
  const b = { ...DEFAULTS, ...validate(SCHEMA, req.body) };
  if (!b.slug) throw new HttpError(422, 'validation', 'Validation failed', { slug: 'slug is required' });
  checkSlug(b.slug);
  checkParity(b);
  let info;
  try {
    info = db.prepare(`INSERT INTO pages (${COLS.join(',')}, updated_by) VALUES (${COLS.map(c => `@${c}`).join(',')}, @updated_by)`)
      .run({ ...b, updated_by: String(req.admin?.u || '') });
  } catch (e) { throw conflict(e); }
  res.json({ ok: true, id: info.lastInsertRowid });
});

router.put('/:id', (req, res) => {
  const id = idParam(req);
  const cur = getPage(id);
  if (!cur) throw new HttpError(404, 'not_found', 'Page not found');
  const b = validate(SCHEMA, req.body);
  if (b.slug !== undefined) {
    if (cur.system_key && b.slug !== cur.slug) throw new HttpError(409, 'system_page', 'The slug of a system page cannot be changed');
    if (!b.slug) throw new HttpError(422, 'validation', 'Validation failed', { slug: 'slug is required' });
    checkSlug(b.slug);
  }
  const next = { ...cur, ...b, id, updated_by: String(req.admin?.u || '') };
  checkParity(next);
  try {
    db.prepare(`UPDATE pages SET ${COLS.map(c => `${c}=@${c}`).join(',')}, updated_at=datetime('now'), updated_by=@updated_by WHERE id=@id`).run(next);
  } catch (e) { throw conflict(e); }
  if (b.published !== undefined && b.published !== cur.published) {
    audit(req, b.published ? 'publish' : 'unpublish', 'pages', id, `${next.slug} ${b.published ? 'published' : 'unpublished'}`);
  }
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  const id = idParam(req);
  const cur = getPage(id);
  if (!cur) throw new HttpError(404, 'not_found', 'Page not found');
  if (cur.system_key) throw new HttpError(409, 'system_page', 'System pages cannot be deleted — unpublish them instead');
  db.prepare('DELETE FROM pages WHERE id=?').run(id);
  audit(req, 'delete', 'pages', id, `${cur.slug} deleted`);
  res.json({ ok: true });
});

// {ids:[…]} in the wanted order → sort = position * 10
router.post('/reorder', (req, res) => {
  const { ids } = validate({ ids: v.array(v.int({ min: 1 }), { max: 500 }) }, req.body);
  const upd = db.prepare('UPDATE pages SET sort=? WHERE id=?');
  db.transaction(() => ids.forEach((id, i) => upd.run((i + 1) * 10, id)))();
  res.json({ ok: true });
});

// {body, lang, title?, kind?, version?, effective_at?} → {html} (article only, no chrome)
// A preview changes nothing: res.locals.readOnly is the flag for the
// auto-mounter's write tracker to skip the audit row + cache drop (Foundation).
router.post('/preview', (req, res) => {
  res.locals.readOnly = true;
  const b = validate({
    body: v.str({ max: LIMITS.input, trim: false }),
    lang: v.default(v.oneOf(['en', 'fa']), 'fa'),
    title: v.str({ max: 200 }),
    kind: v.default(v.oneOf(['custom', 'legal']), 'custom'),
    version: v.str({ max: 20 }),
    effective_at: DATE,
  }, req.body);
  const page = {
    kind: b.kind, version: b.version, effective_at: b.effective_at, legal_reviewed_at: '',
    title_en: b.title, title_fa: b.title, body_en: b.body, body_fa: b.body,
  };
  res.json({ html: renderPageBody(page, b.lang, { tokens: getSiteContext(b.lang).tokens }) });
});

export default { basePath: '/pages', order: 40, router };
