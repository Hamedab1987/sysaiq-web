// Audit trail (read-only). GET /audit?entity=&action=&page= → {rows, page, per_page, total}
import express from 'express';
import { db } from '../../db/index.js';
import { v, validate } from '../../lib/validate.js';

const router = express.Router();
const PER_PAGE = 50;

router.get('/', (req, res) => {
  const q = validate({
    entity: v.optional(v.str({ max: 40 })),
    action: v.optional(v.str({ max: 40 })),
    page: v.default(v.int({ min: 1, max: 100000 }), 1),
  }, req.query);
  const where = [];
  const args = [];
  if (q.entity) { where.push('entity=?'); args.push(q.entity); }
  if (q.action) { where.push('action=?'); args.push(q.action); }
  const sql = where.length ? ` WHERE ${where.join(' AND ')}` : '';
  const total = db.prepare(`SELECT COUNT(*) c FROM audit_log${sql}`).get(...args).c;
  const rows = db.prepare(`SELECT id, admin_id, admin_name, action, entity, entity_id, summary, meta, ip, created_at
    FROM audit_log${sql} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...args, PER_PAGE, (q.page - 1) * PER_PAGE);
  res.json({ rows, page: q.page, per_page: PER_PAGE, total });
});

export default { basePath: '/audit', order: 90, router };
