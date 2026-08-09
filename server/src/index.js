// SysaiQ backend — Express app.
// Serves: the built static site, a public content/AI/lead API, and a
// token-gated admin API + panel for editing every section and the KB.
import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';
import { mkdirSync } from 'node:fs';

import { db, getSetting, setSetting, allSettings } from './db.js';
import { verifyLogin, issueCookie, clearCookie, requireAdmin, createAdmin } from './auth.js';
import { chat } from './ai.js';
import { sendLeadNotification } from './mail.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SITE_DIR = process.env.SITE_DIR || join(ROOT, 'public');
const UPLOAD_DIR = process.env.UPLOAD_DIR || join(ROOT, 'data', 'uploads');
mkdirSync(UPLOAD_DIR, { recursive: true });

const app = express();
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

// ---- uploads ----
const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${randomUUID().slice(0, 8)}${extname(file.originalname)}`),
  }),
  limits: { fileSize: 8 * 1024 * 1024 },
});
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '7d' }));

// ---- rate limiters ----
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10 });
const aiLimiter = rateLimit({ windowMs: 60 * 1000, max: 20 });
const formLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 15 });

// ========================================================================
//  PUBLIC API
// ========================================================================

// full site content (settings + published projects + faqs) — one call
app.get('/api/content', (_req, res) => {
  res.json({
    settings: allSettings(),
    projects: db.prepare('SELECT * FROM projects WHERE published=1 ORDER BY sort, id').all(),
    faqs: db.prepare('SELECT * FROM faqs WHERE published=1 ORDER BY sort, id').all(),
  });
});

// AI assistant
app.post('/api/ai/chat', aiLimiter, async (req, res) => {
  const { message, sessionId, history } = req.body || {};
  if (!message || typeof message !== 'string') return res.status(400).json({ error: 'message required' });
  const sid = sessionId || randomUUID();
  const out = await chat({ sessionId: sid, message: message.slice(0, 2000), history: history || [] });
  res.json({ ...out, sessionId: sid });
});

// lead capture (contact form or AI-qualified)
app.post('/api/leads', formLimiter, async (req, res) => {
  const b = req.body || {};
  const info = db.prepare(`INSERT INTO leads
    (name,email,phone,company,project_type,message,language,source,summary,lead_score)
    VALUES (@name,@email,@phone,@company,@project_type,@message,@language,@source,@summary,@lead_score)`)
    .run({
      name: b.name || '', email: b.email || '', phone: b.phone || '',
      company: b.company || '', project_type: b.project_type || '',
      message: b.message || '', language: b.language || 'en',
      source: b.source || 'form', summary: b.summary || '', lead_score: b.lead_score || 0,
    });
  sendLeadNotification({ id: info.lastInsertRowid, ...b }).catch(e => console.error('mail:', e.message));
  res.json({ ok: true, id: info.lastInsertRowid });
});

// ========================================================================
//  ADMIN AUTH
// ========================================================================
app.post('/api/admin/login', loginLimiter, (req, res) => {
  const { username, password } = req.body || {};
  const admin = verifyLogin(username || '', password || '');
  if (!admin) return res.status(401).json({ error: 'invalid credentials' });
  issueCookie(res, admin);
  res.json({ ok: true, username: admin.username });
});
app.post('/api/admin/logout', (req, res) => { clearCookie(res); res.json({ ok: true }); });
app.get('/api/admin/me', requireAdmin, (req, res) => res.json({ username: req.admin.u }));

// ========================================================================
//  ADMIN API (all gated)
// ========================================================================
const A = express.Router();
A.use(requireAdmin);

// settings (site copy: hero, about, contact, nav…)
A.get('/settings', (_req, res) => res.json(allSettings()));
A.put('/settings/:key', (req, res) => { setSetting(req.params.key, req.body.value); res.json({ ok: true }); });

// projects CRUD
A.get('/projects', (_req, res) => res.json(db.prepare('SELECT * FROM projects ORDER BY sort, id').all()));
A.post('/projects', (req, res) => {
  const b = req.body || {};
  const info = db.prepare(`INSERT INTO projects (slug,title_en,title_fa,desc_en,desc_fa,tags,image,sort,published)
    VALUES (@slug,@title_en,@title_fa,@desc_en,@desc_fa,@tags,@image,@sort,@published)`).run(defaultsProject(b));
  res.json({ ok: true, id: info.lastInsertRowid });
});
A.put('/projects/:id', (req, res) => {
  const b = defaultsProject(req.body || {});
  db.prepare(`UPDATE projects SET slug=@slug,title_en=@title_en,title_fa=@title_fa,desc_en=@desc_en,
    desc_fa=@desc_fa,tags=@tags,image=@image,sort=@sort,published=@published,updated_at=datetime('now')
    WHERE id=@id`).run({ ...b, id: Number(req.params.id) });
  res.json({ ok: true });
});
A.delete('/projects/:id', (req, res) => {
  db.prepare('DELETE FROM projects WHERE id=?').run(Number(req.params.id));
  res.json({ ok: true });
});

// faqs CRUD
A.get('/faqs', (_req, res) => res.json(db.prepare('SELECT * FROM faqs ORDER BY sort, id').all()));
A.post('/faqs', (req, res) => {
  const b = req.body || {};
  const info = db.prepare(`INSERT INTO faqs (q_en,q_fa,a_en,a_fa,sort,published)
    VALUES (@q_en,@q_fa,@a_en,@a_fa,@sort,@published)`).run(defaultsFaq(b));
  res.json({ ok: true, id: info.lastInsertRowid });
});
A.put('/faqs/:id', (req, res) => {
  db.prepare(`UPDATE faqs SET q_en=@q_en,q_fa=@q_fa,a_en=@a_en,a_fa=@a_fa,sort=@sort,published=@published
    WHERE id=@id`).run({ ...defaultsFaq(req.body || {}), id: Number(req.params.id) });
  res.json({ ok: true });
});
A.delete('/faqs/:id', (req, res) => { db.prepare('DELETE FROM faqs WHERE id=?').run(Number(req.params.id)); res.json({ ok: true }); });

// knowledge base CRUD (feeds the AI assistant)
A.get('/knowledge', (_req, res) => res.json(db.prepare('SELECT * FROM knowledge ORDER BY id DESC').all()));
A.post('/knowledge', (req, res) => {
  const b = req.body || {};
  const info = db.prepare(`INSERT INTO knowledge (title,body_en,body_fa,tags,enabled)
    VALUES (@title,@body_en,@body_fa,@tags,@enabled)`).run(defaultsKnowledge(b));
  res.json({ ok: true, id: info.lastInsertRowid });
});
A.put('/knowledge/:id', (req, res) => {
  db.prepare(`UPDATE knowledge SET title=@title,body_en=@body_en,body_fa=@body_fa,tags=@tags,
    enabled=@enabled,updated_at=datetime('now') WHERE id=@id`)
    .run({ ...defaultsKnowledge(req.body || {}), id: Number(req.params.id) });
  res.json({ ok: true });
});
A.delete('/knowledge/:id', (req, res) => { db.prepare('DELETE FROM knowledge WHERE id=?').run(Number(req.params.id)); res.json({ ok: true }); });

// leads (read + delete)
A.get('/leads', (_req, res) => res.json(db.prepare('SELECT * FROM leads ORDER BY created_at DESC').all()));
A.delete('/leads/:id', (req, res) => { db.prepare('DELETE FROM leads WHERE id=?').run(Number(req.params.id)); res.json({ ok: true }); });

// conversation log (read)
A.get('/conversations', (_req, res) => {
  res.json(db.prepare('SELECT * FROM conversations ORDER BY id DESC LIMIT 500').all());
});

// AI config — read status (never returns the raw key) and save key/model
A.get('/ai-config', (_req, res) => {
  const s = getSetting('ai_config', {}) || {};
  const key = s.openai_key || process.env.OPENAI_API_KEY || '';
  res.json({
    configured: !!key,
    key_hint: key ? `sk-…${key.slice(-4)}` : '',
    model: s.model || process.env.OPENAI_MODEL || 'gpt-4o-mini',
    source: s.openai_key ? 'panel' : (process.env.OPENAI_API_KEY ? 'env' : 'none'),
  });
});
A.put('/ai-config', (req, res) => {
  const cur = getSetting('ai_config', {}) || {};
  const next = { ...cur };
  if (typeof req.body.model === 'string' && req.body.model.trim()) next.model = req.body.model.trim();
  // only overwrite the key if a non-empty, non-masked value is sent
  if (typeof req.body.openai_key === 'string' && req.body.openai_key && !req.body.openai_key.includes('…')) {
    next.openai_key = req.body.openai_key.trim();
  }
  setSetting('ai_config', next);
  res.json({ ok: true });
});

// image upload → returns a public /uploads URL
A.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'no file' });
  res.json({ ok: true, url: `/uploads/${req.file.filename}` });
});

app.use('/api/admin', A);

function defaultsProject(b) {
  return {
    slug: b.slug || '', title_en: b.title_en || '', title_fa: b.title_fa || '',
    desc_en: b.desc_en || '', desc_fa: b.desc_fa || '', tags: b.tags || '',
    image: b.image || '', sort: Number(b.sort) || 0, published: b.published ? 1 : 0,
  };
}
function defaultsFaq(b) {
  return {
    q_en: b.q_en || '', q_fa: b.q_fa || '', a_en: b.a_en || '', a_fa: b.a_fa || '',
    sort: Number(b.sort) || 0, published: b.published ? 1 : 0,
  };
}
function defaultsKnowledge(b) {
  return {
    title: b.title || '', body_en: b.body_en || '', body_fa: b.body_fa || '',
    tags: b.tags || '', enabled: b.enabled ? 1 : 0,
  };
}

// ---- static: admin panel + built site ----
app.use('/admin', express.static(join(ROOT, 'admin')));
app.get('/admin/*', (_req, res) => res.sendFile(join(ROOT, 'admin', 'index.html')));
app.use('/', express.static(SITE_DIR, { extensions: ['html'] }));

// first-run: create admin from env if none exists
if (db.prepare('SELECT COUNT(*) c FROM admins').get().c === 0) {
  const u = process.env.ADMIN_USER || 'admin';
  const p = process.env.ADMIN_PASS || 'sysaiq-admin';
  createAdmin(u, p);
  console.log(`[init] created admin "${u}"`);
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, '127.0.0.1', () => console.log(`SysaiQ server on http://127.0.0.1:${PORT}`));
