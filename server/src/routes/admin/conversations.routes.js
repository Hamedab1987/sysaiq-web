// AI conversation log (read).
import express from 'express';
import { db } from '../../db/index.js';

const router = express.Router();

router.get('/', (_req, res) => {
  res.json(db.prepare('SELECT * FROM conversations ORDER BY id DESC LIMIT 500').all());
});

export default { basePath: '/conversations', order: 60, router };
