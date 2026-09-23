// Projects CRUD (portfolio items + their case-study pages).
// Bodies are validated and length-capped before they reach SQLite: a field
// of the wrong type answers 422 {fields} instead of a 500 from the binder.
// The legacy columns keep their full-replace PUT (a missing field is a
// blank, as the old panel expects). The story columns of migration 013 and
// show_on_home are optional: a PUT that does not send one keeps the stored
// value, so an older client can never wipe a written case study.
import express from 'express';
import { db } from '../../db/index.js';
import { withSlug } from '../../lib/slug.js';
import { v, validate } from '../../lib/validate.js';
import { HttpError } from '../../lib/errors.js';
import { CATEGORIES, SERVICE_SLUGS } from '../../db/migrations/013_projects_story.js';

const router = express.Router();

const T = max => v.str({ max });
// industries / features / pages: the old panel sends the textarea's JSON
// text, a JSON client sends a real array; both are stored as the JSON text
// the renderer parses. Blank means "none".
const LIST_MAX = 64 * 1024;
const arrayRule = v.array(null, { max: 200 });
const list = (x, key) => {
  const s = JSON.stringify(arrayRule(typeof x === 'string' && !x.trim() ? [] : x, key));
  if (s.length > LIST_MAX) throw new HttpError(422, 'validation', 'Validation failed', { [key]: `${key} must be at most ${LIST_MAX} characters` });
  return s;
};

// present → validated; absent (undefined) → left out, so PUT keeps the column
const opt = rule => { const f = (x, k) => (x === undefined ? undefined : rule(x, k)); f.optional = true; return f; };
const MD = v.str({ max: 20000 });

// an image the public page may render: site-relative (not protocol-relative,
// no backslash — "/\host" is "//host" to a browser) or https without credentials
export const IMAGE_RE = /^\/(?![/\\])[^\s"'<>\\]*$/;
function image(x, key) {
  const s = v.str({ min: 1, max: 2048 })(x, key);
  if (IMAGE_RE.test(s)) return s;
  const u = v.url({ https: true })(s, key);
  if (/["'<>\\\s]/.test(u)) throw new HttpError(422, 'validation', 'Validation failed', { [key]: `${key} must be a site path or an https URL` });
  return u;
}
// gallery: ≤ 12 × {image, caption_en, caption_fa} → JSON text; unknown keys dropped
const GALLERY_ITEM = { image, caption_en: T(300), caption_fa: T(300) };
function gallery(x, key) {
  const items = v.array(v.json(GALLERY_ITEM), { max: 12 })(typeof x === 'string' && !x.trim() ? [] : x, key);
  return JSON.stringify(items.map(g => ({ image: g.image, caption_en: g.caption_en || '', caption_fa: g.caption_fa || '' })));
}

const SCHEMA = {
  slug: T(200), title_en: T(200), title_fa: T(200), desc_en: T(5000), desc_fa: T(5000),
  tags: T(500), image: T(2048), cover_en: T(2048), cover_fa: T(2048),
  tagline_en: T(500), tagline_fa: T(500), overview_en: T(20000), overview_fa: T(20000),
  industries: list, features: list, pages: list,
  sort: v.default(v.int({ min: -1e6, max: 1e6 }), 0), published: v.bool(),
};
const STORY = {
  category: opt(v.oneOf(['', ...CATEGORIES])),
  service_slug: opt(v.oneOf(['', ...SERVICE_SLUGS])),
  problem_en: opt(MD), problem_fa: opt(MD), solution_en: opt(MD), solution_fa: opt(MD),
  outcome_en: opt(MD), outcome_fa: opt(MD), tech_en: opt(MD), tech_fa: opt(MD),
  gallery: opt(gallery),
  seo_title_en: opt(T(120)), seo_title_fa: opt(T(120)),
  seo_desc_en: opt(T(320)), seo_desc_fa: opt(T(320)),
  show_on_home: opt((x, k) => (v.bool()(x, k) ? 1 : 0)),
};
const STORY_COLS = Object.keys(STORY);
const STORY_DEFAULTS = Object.fromEntries(STORY_COLS.map(c => [c, c === 'gallery' ? '[]' : c === 'show_on_home' ? 0 : '']));

// both halves in one pass so every bad field is reported together
function cleanProject(body) {
  let b = {};
  let s = {};
  const fields = {};
  try { b = validate(SCHEMA, body); } catch (e) { if (e instanceof HttpError && e.fields) Object.assign(fields, e.fields); else throw e; }
  try { s = validate(STORY, body); } catch (e) { if (e instanceof HttpError && e.fields) Object.assign(fields, e.fields); else throw e; }
  if (Object.keys(fields).length) throw new HttpError(422, 'validation', 'Validation failed', fields);
  b.published = b.published ? 1 : 0;
  return { base: b, story: s };
}

router.get('/', (_req, res) => res.json(db.prepare('SELECT * FROM projects ORDER BY sort, id').all()));

router.post('/', (req, res) => {
  const { base, story } = cleanProject(req.body);
  const row = withSlug({ ...base, ...STORY_DEFAULTS, ...story });
  const cols = [...Object.keys(SCHEMA), ...STORY_COLS];
  const info = db.prepare(`INSERT INTO projects (${cols.join(',')}) VALUES (${cols.map(c => `@${c}`).join(',')})`).run(row);
  res.json({ ok: true, id: info.lastInsertRowid });
});

router.put('/:id', (req, res) => {
  const id = Number(req.params.id);
  const { base: b, story } = cleanProject(req.body);
  const cur = Number.isInteger(id) ? db.prepare('SELECT * FROM projects WHERE id=?').get(id) : null;
  if (!cur) throw new HttpError(404, 'not_found', 'Project not found');
  // the slug is the page's URL — a save that doesn't send one keeps the current one
  if (!b.slug) b.slug = cur.slug || '';
  withSlug(b, id);
  const merged = { ...b, id };
  for (const c of STORY_COLS) merged[c] = story[c] !== undefined ? story[c] : cur[c] ?? STORY_DEFAULTS[c];
  db.prepare(`UPDATE projects SET slug=@slug,title_en=@title_en,title_fa=@title_fa,desc_en=@desc_en,
    desc_fa=@desc_fa,tags=@tags,image=@image,cover_en=@cover_en,cover_fa=@cover_fa,
    tagline_en=@tagline_en,tagline_fa=@tagline_fa,overview_en=@overview_en,overview_fa=@overview_fa,
    industries=@industries,features=@features,pages=@pages,sort=@sort,published=@published,
    ${STORY_COLS.map(c => `${c}=@${c}`).join(',')},
    updated_at=datetime('now') WHERE id=@id`).run(merged);
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM projects WHERE id=?').run(Number(req.params.id));
  res.json({ ok: true });
});

export default { basePath: '/projects', order: 20, router };
