// FAQ CRUD. Bodies are validated and length-capped (422 {fields} on bad input).
import express from 'express';
import { db } from '../../db/index.js';
import { v, validate } from '../../lib/validate.js';

const router = express.Router();

const SCHEMA = {
  q_en: v.str({ max: 1000 }), q_fa: v.str({ max: 1000 }),
  a_en: v.str({ max: 10000 }), a_fa: v.str({ max: 10000 }),
  sort: v.default(v.int({ min: -1e6, max: 1e6 }), 0), published: v.bool(),
};
function cleanFaq(body) {
  const b = validate(SCHEMA, body);
  b.published = b.published ? 1 : 0;
  return b;
}

router.get('/', (_req, res) => res.json(db.prepare('SELECT * FROM faqs ORDER BY sort, id').all()));

router.post('/', (req, res) => {
  const info = db.prepare(`INSERT INTO faqs (q_en,q_fa,a_en,a_fa,sort,published)
    VALUES (@q_en,@q_fa,@a_en,@a_fa,@sort,@published)`).run(cleanFaq(req.body));
  res.json({ ok: true, id: info.lastInsertRowid });
});

router.put('/:id', (req, res) => {
  db.prepare(`UPDATE faqs SET q_en=@q_en,q_fa=@q_fa,a_en=@a_en,a_fa=@a_fa,sort=@sort,published=@published
    WHERE id=@id`).run({ ...cleanFaq(req.body), id: Number(req.params.id) });
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM faqs WHERE id=?').run(Number(req.params.id));
  res.json({ ok: true });
});

export default { basePath: '/faqs', order: 30, router };
