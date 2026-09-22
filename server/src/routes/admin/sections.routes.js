// Home-page sections CRUD (/api/admin/sections) + reorder + preview.
// Partial updates (only the keys sent change). `items` is validated per
// section type (cards / steps / stats / pricing; richtext and cta carry no
// items), max 24 entries. The slug becomes the section's DOM id on the home
// page, so ids the template already uses are refused along with route slugs.
import express from 'express';
import { db } from '../../db/index.js';
import { v, validate } from '../../lib/validate.js';
import { HttpError } from '../../lib/errors.js';
import { isReservedSlug } from '../../lib/registry.js';
import { audit } from '../../lib/audit.js';
import { safeHref } from '../../lib/inline.js';
import { renderSection, PLACEMENTS, TYPES, THEMES } from '../../render/slots/sections_after_about.js';

const router = express.Router();

// ids the home template owns (vesper.src.html: markup ids, getElementById
// targets of its scroll/showcase engine and #id CSS rules, plus the AI
// widget's) — a section may not shadow them. test/pages/sections.test.js
// scans the template source so the set cannot rot.
export const TEMPLATE_IDS = new Set(['hero', 'presence', 'terra', 'mind', 'living', 'work', 'faq', 'contact', 'cortex',
  'stage', 'veil', 'bgtex', 'hud-bl', 'hud-br', 'loader-bar', 'status-label', 'counter',
  'showcase', 'sc-stage', 'sc-bar', 'sc-list', 'lab-svg', 'lg1', 'lgbg',
  'nav-toggle', 'site-nav', 'site-data', 'main', 'ai-fab', 'ai-panel', 'ai-teaser']);

const opt = rule => { const f = (x, k) => (x === undefined ? undefined : rule(x, k)); f.optional = true; return f; };
const BOOL = (x, k) => (v.bool()(x, k) ? 1 : 0);
const T = max => v.str({ max });
const MD = () => v.str({ max: 64 * 1024 });

// the eyebrow is rendered as a mono, letter-spaced, uppercase LTR island
// ([ SYSAIQ—NAME / SYS.0N ]) — letter-spacing breaks Arabic-script joining,
// so it must stay a Latin technical label: printable ASCII plus the
// typographic dashes / dots the format uses
const EYEBROW_RE = /^[\x20-\x7e–—·•]*$/;
const EYEBROW = (x, k) => {
  const s = T(80)(x, k);
  if (!EYEBROW_RE.test(s)) {
    throw new HttpError(422, 'validation', 'Validation failed', { [k]: `${k} is a Latin technical label (like "SYSAIQ—PROCESS / SYS.05"): letters, digits and punctuation only, no Persian` });
  }
  return s;
};

// site-relative, https, mailto:, tel: or #anchor — the same rule the renderer applies
const HREF = (x, k) => {
  const s = T(2048)(x, k);
  if (!s) return '';
  if (!safeHref(s)) throw new HttpError(422, 'validation', 'Validation failed', { [k]: `${k} must be a site-relative path, https URL, mailto:, tel: or #anchor` });
  return s;
};

const ITEM = {
  cards: { title_en: T(200), title_fa: T(200), desc_en: T(1000), desc_fa: T(1000), icon: v.str({ max: 40, pattern: /^[a-z0-9-]*$/ }) },
  steps: { title_en: T(200), title_fa: T(200), desc_en: T(1000), desc_fa: T(1000) },
  stats: { value: T(40), label_en: T(120), label_fa: T(120) },
  pricing: {
    name_en: T(120), name_fa: T(120), price_en: T(120), price_fa: T(120), desc_en: T(600), desc_fa: T(600),
    features: v.array(v.json({ en: T(200), fa: T(200) }), { max: 12 }), featured: v.bool(),
  },
};
// items are validated against the type of the resulting row, so `type` is
// read from the body first and falls back to the stored row on update
function itemsRule(type) {
  return (x, k) => {
    if (!ITEM[type]) {
      const arr = v.array(null, { max: 24 })(x, k);
      if (arr.length) throw new HttpError(422, 'validation', 'Validation failed', { items: `${type} sections carry no items` });
      return '[]';
    }
    return JSON.stringify(v.array(v.json(ITEM[type]), { max: 24 })(x, k));
  };
}

const BASE = {
  slug: opt(v.slug()),
  type: opt(v.oneOf([...TYPES])),
  theme: opt(v.oneOf([...THEMES])),
  placement: opt(v.oneOf([...PLACEMENTS])),
  eyebrow: opt(EYEBROW),
  title_en: opt(T(200)), title_fa: opt(T(200)),
  body_en: opt(MD()), body_fa: opt(MD()),
  cta_label_en: opt(T(120)), cta_label_fa: opt(T(120)), cta_href: opt(HREF),
  show_in_nav: opt(BOOL), nav_label_en: opt(T(60)), nav_label_fa: opt(T(60)),
  sort: opt(v.int({ min: -1e6, max: 1e6 })), published: opt(BOOL),
};
const COLS = [...Object.keys(BASE), 'items'];
const DEFAULTS = {
  slug: '', type: 'richtext', theme: 'light', placement: 'after_about', eyebrow: '', title_en: '', title_fa: '', body_en: '', body_fa: '',
  cta_label_en: '', cta_label_fa: '', cta_href: '', show_in_nav: 0, nav_label_en: '', nav_label_fa: '', sort: 0, published: 0, items: '[]',
};

function clean(body, curType) {
  const type = TYPES.includes(body?.type) ? body.type : curType;
  return validate({ ...BASE, items: opt(itemsRule(type)) }, body);
}
// the slug is a CSS id selector (#slug{…}) and a querySelector target in the
// template's scroll engine: a leading digit makes both invalid, so on top of
// v.slug() it must start with a letter
function checkSlug(slug) {
  if (!/^[a-z][a-z0-9-]*$/.test(slug)) {
    throw new HttpError(422, 'validation', 'Validation failed', { slug: 'slug must start with a letter (it becomes the section id)' });
  }
  if (isReservedSlug(slug) || TEMPLATE_IDS.has(slug)) {
    throw new HttpError(422, 'validation', 'Validation failed', { slug: `"${slug}" is reserved (site route or home-page section)` });
  }
}
const getSection = id => db.prepare('SELECT * FROM sections WHERE id=?').get(id);
const idParam = req => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) throw new HttpError(404, 'not_found', 'Section not found');
  return id;
};
const conflict = e => (e?.code === 'SQLITE_CONSTRAINT_UNIQUE' ? new HttpError(409, 'conflict', 'A section with this slug already exists', { slug: 'already used' }) : e);

router.get('/', (_req, res) => res.json(db.prepare('SELECT * FROM sections ORDER BY placement, sort, id').all()));

router.get('/:id', (req, res) => {
  const s = getSection(idParam(req));
  if (!s) throw new HttpError(404, 'not_found', 'Section not found');
  res.json(s);
});

router.post('/', (req, res) => {
  const b = { ...DEFAULTS, ...clean(req.body, 'richtext') };
  if (!b.slug) throw new HttpError(422, 'validation', 'Validation failed', { slug: 'slug is required' });
  checkSlug(b.slug);
  let info;
  try {
    info = db.prepare(`INSERT INTO sections (${COLS.join(',')}) VALUES (${COLS.map(c => `@${c}`).join(',')})`).run(b);
  } catch (e) { throw conflict(e); }
  res.json({ ok: true, id: info.lastInsertRowid });
});

router.put('/:id', (req, res) => {
  const id = idParam(req);
  const cur = getSection(id);
  if (!cur) throw new HttpError(404, 'not_found', 'Section not found');
  const b = clean(req.body, cur.type);
  if (b.slug !== undefined) {
    if (!b.slug) throw new HttpError(422, 'validation', 'Validation failed', { slug: 'slug is required' });
    if (b.slug !== cur.slug) checkSlug(b.slug);
  }
  // a type change must re-validate the stored items against the new type
  if (b.type !== undefined && b.type !== cur.type && b.items === undefined) {
    b.items = itemsRule(b.type)(cur.items, 'items');
  }
  const next = { ...cur, ...b, id };
  try {
    db.prepare(`UPDATE sections SET ${COLS.map(c => `${c}=@${c}`).join(',')}, updated_at=datetime('now') WHERE id=@id`).run(next);
  } catch (e) { throw conflict(e); }
  if (b.published !== undefined && b.published !== cur.published) {
    audit(req, b.published ? 'publish' : 'unpublish', 'sections', id, `${next.slug} ${b.published ? 'published' : 'unpublished'}`);
  }
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  const id = idParam(req);
  const cur = getSection(id);
  if (!cur) throw new HttpError(404, 'not_found', 'Section not found');
  db.prepare('DELETE FROM sections WHERE id=?').run(id);
  audit(req, 'delete', 'sections', id, `${cur.slug} deleted`);
  res.json({ ok: true });
});

router.post('/reorder', (req, res) => {
  const { ids } = validate({ ids: v.array(v.int({ min: 1 }), { max: 500 }) }, req.body);
  const upd = db.prepare('UPDATE sections SET sort=? WHERE id=?');
  db.transaction(() => ids.forEach((id, i) => upd.run((i + 1) * 10, id)))();
  res.json({ ok: true });
});

// a full section body + {lang} → {html} of the section as the home page would show it
// A preview changes nothing: res.locals.readOnly is the flag for the
// auto-mounter's write tracker to skip the audit row + cache drop (Foundation).
router.post('/preview', (req, res) => {
  res.locals.readOnly = true;
  const lang = req.body?.lang === 'en' ? 'en' : 'fa';
  const b = { ...DEFAULTS, ...clean(req.body, 'richtext') };
  if (!b.slug) b.slug = 'preview';
  res.json({ html: renderSection({ ...b, id: 0 }, lang) });
});

export default { basePath: '/sections', order: 40, router };
