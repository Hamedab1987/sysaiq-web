// POST /api/ai/chat — the site's AI assistant (see src/ai.js).
import express from 'express';
import rateLimit from 'express-rate-limit';
import { randomUUID } from 'node:crypto';
import { chat } from '../../ai.js';
import { asyncHandler } from '../../lib/errors.js';

const router = express.Router();
const aiLimiter = rateLimit({ windowMs: 60 * 1000, max: 20 });

router.post('/chat', aiLimiter, asyncHandler(async (req, res) => {
  const { message, sessionId, history } = req.body || {};
  if (!message || typeof message !== 'string') return res.status(400).json({ error: 'message required' });
  // the widget echoes back the UUID we minted; anything else (object, huge
  // string) gets a fresh session instead of reaching the database
  const sid = typeof sessionId === 'string' && /^[\w-]{1,80}$/.test(sessionId) ? sessionId : randomUUID();
  const out = await chat({ sessionId: sid, message: message.slice(0, 2000), history: history || [] });
  res.json({ ...out, sessionId: sid });
}));

export default { basePath: '/api/ai', order: 20, router };
