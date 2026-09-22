// Leads (read + delete).
import express from 'express';
import { db } from '../../db/index.js';

const router = express.Router();

router.get('/', (_req, res) => res.json(db.prepare('SELECT * FROM leads ORDER BY created_at DESC').all()));

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM leads WHERE id=?').run(Number(req.params.id));
  res.json({ ok: true });
});

export default { basePath: '/leads', order: 50, router };
