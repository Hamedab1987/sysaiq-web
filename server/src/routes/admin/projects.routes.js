// Projects CRUD (portfolio items + their detail pages).
// Bodies are validated and length-capped before they reach SQLite: a field
// of the wrong type answers 422 {fields} instead of a 500 from the binder.
import express from 'express';
import { db } from '../../db/index.js';
import { withSlug } from '../../lib/slug.js';
import { v, validate } from '../../lib/validate.js';
import { HttpError } from '../../lib/errors.js';

const router = express.Router();

const T = max => v.str({ max });
// industries / features / pages: the old panel sends the textarea's JSON
// text, a JSON client sends a real array; both are stored as the JSON text
// projectPage.js parses. Blank means "none".
const LIST_MAX = 64 * 1024;
const arrayRule = v.array(null, { max: 200 });
const list = (x, key) => {
  const s = JSON.stringify(arrayRule(typeof x === 'string' && !x.trim() ? [] : x, key));
  if (s.length > LIST_MAX) throw new HttpError(422, 'validation', 'Validation failed', { [key]: `${key} must be at most ${LIST_MAX} characters` });
  return s;
};
const SCHEMA = {
  slug: T(200), title_en: T(200), title_fa: T(200), desc_en: T(5000), desc_fa: T(5000),
  tags: T(500), image: T(2048), cover_en: T(2048), cover_fa: T(2048),
  tagline_en: T(500), tagline_fa: T(500), overview_en: T(20000), overview_fa: T(20000),
  industries: list, features: list, pages: list,
  sort: v.default(v.int({ min: -1e6, max: 1e6 }), 0), published: v.bool(),
};
function cleanProject(body) {
  const b = validate(SCHEMA, body);
  b.published = b.published ? 1 : 0;
  return b;
}

router.get('/', (_req, res) => res.json(db.prepare('SELECT * FROM projects ORDER BY sort, id').all()));

router.post('/', (req, res) => {
  const info = db.prepare(`INSERT INTO projects
    (slug,title_en,title_fa,desc_en,desc_fa,tags,image,cover_en,cover_fa,
     tagline_en,tagline_fa,overview_en,overview_fa,industries,features,pages,sort,published)
    VALUES (@slug,@title_en,@title_fa,@desc_en,@desc_fa,@tags,@image,@cover_en,@cover_fa,
     @tagline_en,@tagline_fa,@overview_en,@overview_fa,@industries,@features,@pages,@sort,@published)`)
    .run(withSlug(cleanProject(req.body)));
  res.json({ ok: true, id: info.lastInsertRowid });
});

router.put('/:id', (req, res) => {
  const id = Number(req.params.id);
  const b = cleanProject(req.body);
  // the slug is the page's URL — a save that doesn't send one keeps the current one
  if (!b.slug) b.slug = db.prepare('SELECT slug FROM projects WHERE id=?').get(id)?.slug || '';
  withSlug(b, id);
  db.prepare(`UPDATE projects SET slug=@slug,title_en=@title_en,title_fa=@title_fa,desc_en=@desc_en,
    desc_fa=@desc_fa,tags=@tags,image=@image,cover_en=@cover_en,cover_fa=@cover_fa,
    tagline_en=@tagline_en,tagline_fa=@tagline_fa,overview_en=@overview_en,overview_fa=@overview_fa,
    industries=@industries,features=@features,pages=@pages,sort=@sort,published=@published,
    updated_at=datetime('now') WHERE id=@id`).run({ ...b, id });
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM projects WHERE id=?').run(Number(req.params.id));
  res.json({ ok: true });
});

export default { basePath: '/projects', order: 20, router };
