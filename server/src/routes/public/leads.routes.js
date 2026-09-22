// POST /api/leads — contact-form lead capture → {ok, id}.
// Validation, honeypot and the forced fields live in lib/leads.js; a
// honeypot hit answers {ok:true} without storing so the bot learns nothing.
import express from 'express';
import rateLimit from 'express-rate-limit';
import { config } from '../../config.js';
import { createLead } from '../../lib/leads.js';

const router = express.Router();
// 15 submissions per hour per ip by default (LEADS_RATE_MAX, see config.js)
const formLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: config.leadsRateMax });

router.post('/', formLimiter, (req, res) => {
  const { id, dropped } = createLead(req.body, { source: 'form', ip: req.ip });
  if (dropped) return res.json({ ok: true });
  res.json({ ok: true, id });
});

export default { basePath: '/api/leads', order: 30, router };
