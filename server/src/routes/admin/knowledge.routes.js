// Knowledge base CRUD (feeds the AI assistant). Bodies are validated and
// length-capped (422 {fields} on bad input); bodies stay generous because
// the assistant's pitches live here.
import express from 'express';
import { db } from '../../db/index.js';
import { v, validate } from '../../lib/validate.js';

const router = express.Router();

const SCHEMA = {
  title: v.str({ max: 300 }), body_en: v.str({ max: 50000 }), body_fa: v.str({ max: 50000 }),
  tags: v.str({ max: 500 }), enabled: v.bool(),
};
function cleanKnowledge(body) {
  const b = validate(SCHEMA, body);
  b.enabled = b.enabled ? 1 : 0;
  return b;
}

router.get('/', (_req, res) => res.json(db.prepare('SELECT * FROM knowledge ORDER BY id DESC').all()));

router.post('/', (req, res) => {
  const info = db.prepare(`INSERT INTO knowledge (title,body_en,body_fa,tags,enabled)
    VALUES (@title,@body_en,@body_fa,@tags,@enabled)`).run(cleanKnowledge(req.body));
  res.json({ ok: true, id: info.lastInsertRowid });
});

router.put('/:id', (req, res) => {
  db.prepare(`UPDATE knowledge SET title=@title,body_en=@body_en,body_fa=@body_fa,tags=@tags,
    enabled=@enabled,updated_at=datetime('now') WHERE id=@id`)
    .run({ ...cleanKnowledge(req.body), id: Number(req.params.id) });
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM knowledge WHERE id=?').run(Number(req.params.id));
  res.json({ ok: true });
});

export default { basePath: '/knowledge', order: 40, router };
