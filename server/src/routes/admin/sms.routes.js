// SMS panel API (mounted under /api/admin/sms by the auto-mounter, behind
// requireAdmin + csrfGuard + write audit).
//   GET/PUT  /sms/config              settings; secrets come back as {configured, hint} only,
//                                     an empty or masked secret value keeps the stored one
//   POST     /sms/test                {to, mode:'simple'|'pattern', template_key?, provider?}
//   GET      /sms/credit?provider=    cached 60 s
//   GET/POST /sms/templates · PUT/DELETE /sms/templates/:key   (system templates: key fixed, not deletable)
//   GET      /sms/log                 filters + paging
//   POST     /sms/log/:id/refresh-status · POST /sms/log/:id/retry
//   POST     /sms/send                {to | lead_id, text | template_key, params, lang}  (30/h per admin, SMS_SEND_RATE_MAX)
// Errors: a thrown or deliver-time SmsError maps by code — configuration
// (not_configured, unknown provider, missing template) → 409, request values
// (bad number, missing variable, provider validation) → 422, provider trouble → 502.
// Importing sms/notify.js here is what installs the event listeners at boot.
import express from 'express';
import rateLimit from 'express-rate-limit';
import { db } from '../../db/index.js';
import { config } from '../../config.js';
import { HttpError, asyncHandler } from '../../lib/errors.js';
import { listSecrets, setSecret, isRegisteredSecret } from '../../lib/secrets.js';
import { normalizeMobile } from '../../lib/normalize.js';
import { audit } from '../../lib/audit.js';
import { providers, describeProvider, getProvider } from '../../sms/registry.js';
import { readConfig, validateConfigPatch, writeConfig, faNumber, RELAY_SECRET, EVENT_KEYS } from '../../sms/config.js';
import { listTemplates, getTemplate, placeholdersOf, countSegments, KEY_RE, LIMITS, VARIABLE_LABELS } from '../../sms/templates.js';
import * as sms from '../../sms/service.js';
import { SmsError, SmsHttpError, invalid, ERROR_CODES } from '../../sms/errors.js';
import '../../sms/notify.js';

const router = express.Router();

const MASKED = /[•…]/;
const str = (x, max = 200) => String(x ?? '').trim().slice(0, max);
const bad = (status, code, fa, en, fields) => new SmsHttpError(status, code, fa, en, fields);

// SmsError → HTTP: config problems are 409/422, provider trouble is 502
function toHttp(e) {
  if (e instanceof HttpError) return e;
  if (e instanceof SmsError) {
    const cfgCodes = ['not_configured', 'provider_unknown', 'mock_refused', 'template_missing', 'template_disabled', 'unsupported'];
    const status = cfgCodes.includes(e.code) ? 409 : ['bad_mobile', 'missing_var', 'too_long', 'empty_text', 'validation', 'template'].includes(e.code) ? 422 : 502;
    return bad(status, `sms_${e.code}`, e.detail, e.message_en);
  }
  return e;
}
const wrap = fn => asyncHandler(async (req, res) => {
  try { await fn(req, res); } catch (e) { throw toHttp(e); }
});
// a send that reached deliver() and failed: same status-by-code mapping as a
// thrown SmsError (not_configured → 409, bad values → 422, provider → 502)
const deliverFailed = r => toHttp(r.error instanceof SmsError ? r.error : new SmsError('unknown', { message: String(r.error?.message || '') }));
const MAX_MAP_JSON = 2000;

// ---- config --------------------------------------------------------------------
function secretStatus() {
  const out = {};
  for (const s of listSecrets()) if (s.group === 'sms') out[s.name] = { configured: s.configured, hint: s.hint, source: s.source };
  return out;
}
function configView() {
  const cfg = readConfig();
  const secrets = secretStatus();
  return {
    config: cfg,
    providers: providers().map(p => ({ ...describeProvider(p), secret: p.secretName ? (secrets[p.secretName] || { configured: false, hint: '', source: 'none' }) : null })),
    relay_key: secrets[RELAY_SECRET] || { configured: false, hint: '', source: 'none' },
    events: EVENT_KEYS,
    env: config.env,
    usage: sms.usage(),
  };
}

router.get('/config', (_req, res) => res.json(configView()));

router.put('/config', wrap(async (req, res) => {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const patch = validateConfigPatch(body);
  // secrets ride along inside providers.<id>.<field>; strip them before the settings write
  const secretWrites = [];
  const fields = {};
  if (body.providers && typeof body.providers === 'object') {
    for (const p of providers()) {
      const given = body.providers[p.id];
      if (!given || typeof given !== 'object') continue;
      for (const f of p.configFields) {
        if (f.type !== 'secret' || !(f.key in given)) continue;
        const val = given[f.key];
        if (val === null || val === undefined || val === '') continue;      // keep current
        if (typeof val !== 'string') { fields[`providers.${p.id}.${f.key}`] = 'باید متن باشد'; continue; }
        if (MASKED.test(val)) continue;                                       // the hint echoed back: keep current
        secretWrites.push([p.secretName, val.trim()]);
      }
    }
  }
  if ('relay_key' in body && typeof body.relay_key === 'string' && body.relay_key.trim() && !MASKED.test(body.relay_key)) {
    secretWrites.push([RELAY_SECRET, body.relay_key.trim()]);
  }
  if (Object.keys(fields).length) throw invalid(fields);
  // one transaction: a rejected config (fallback === active) or a bad key
  // value leaves neither the settings row nor the secrets table half-written
  const next = db.transaction(() => {
    const cfg = writeConfig(patch);
    for (const [name, value] of secretWrites) {
      if (!isRegisteredSecret(name)) continue;
      try { setSecret(name, value, req.admin?.u); } catch (e) {
        if (e instanceof HttpError && e.fields) throw invalid({ [name]: 'مقدار کلید معتبر نیست (بدون فاصله)' });
        throw e;
      }
    }
    return cfg;
  })();
  audit(req, 'sms.config', 'sms', 'config', `fields: ${Object.keys(patch).join(',') || '-'}${secretWrites.length ? ` · secrets: ${secretWrites.map(s => s[0]).join(',')}` : ''}`);
  res.json({ ok: true, ...configView(), config: next });
}));

// ---- test send + credit ----------------------------------------------------------
// manual/test/retry sends per admin per hour (SMS_SEND_RATE_MAX overrides the 30 for tests)
export const SEND_RATE_MAX = /^[1-9]\d{0,4}$/.test(process.env.SMS_SEND_RATE_MAX || '') ? Number(process.env.SMS_SEND_RATE_MAX) : 30;
const sendLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: SEND_RATE_MAX,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: req => `admin:${req.admin?.uid ?? 'anon'}`,
  handler: (_req, res) => res.status(429).json({
    error: 'rate_limited',
    message: `سقف ارسال دستی (${faNumber(SEND_RATE_MAX)} پیام در ساعت) پر شده است`,
    message_en: `Manual send limit (${SEND_RATE_MAX} per hour) reached`,
  }),
});

router.post('/test', sendLimiter, wrap(async (req, res) => {
  const b = req.body || {};
  const to = normalizeMobile(b.to);
  const mode = b.mode === 'pattern' ? 'pattern' : 'simple';
  const fields = {};
  if (!to) fields.to = 'شمارهٔ همراه معتبر نیست';
  if (mode === 'pattern' && !getTemplate(str(b.template_key, 40))) fields.template_key = 'قالب یافت نشد';
  if (Object.keys(fields).length) throw invalid(fields);
  const r = await sms.sendTest({ to, mode, templateKey: str(b.template_key, 40), providerId: str(b.provider, 40), lang: b.lang === 'en' ? 'en' : 'fa', adminUser: req.admin?.u });
  audit(req, 'sms.test', 'sms_log', r.logId, `${mode} via ${r.provider} → ${r.status}`);
  if (!r.ok) throw deliverFailed(r);
  res.json({ ok: true, log: r.log });
}));

router.get('/credit', wrap(async (req, res) => {
  const r = await sms.credit({ providerId: str(req.query.provider, 40), force: req.query.force === '1' });
  res.json(r);
}));

// ---- templates -----------------------------------------------------------------------
const templateOut = t => ({ ...t, placeholders: [...new Set([...placeholdersOf(t.body_fa), ...placeholdersOf(t.body_en)])], counter: { fa: countSegments(t.body_fa), en: countSegments(t.body_en) } });

router.get('/templates', (_req, res) => res.json({
  items: listTemplates().map(templateOut),
  variable_labels: VARIABLE_LABELS,
  limits: LIMITS,
  providers: providers().map(p => ({ id: p.id, label_fa: p.label_fa, supportsPattern: !!p.supportsPattern, map_help: describeProvider(p).map_help })),
}));

// shared field validation for create/update; `system` keeps the key immutable,
// `existing` (the stored row on update) supplies the variables a provider map
// is checked against
function templatePatch(body, { system = false, create = false, existing = null } = {}) {
  const b = body && typeof body === 'object' ? body : {};
  const fields = {};
  const out = {};
  if (create) {
    const key = str(b.key, 40).toLowerCase();
    if (!KEY_RE.test(key)) fields.key = 'کلید باید با حرف لاتین شروع شود و فقط حروف کوچک، رقم و _ داشته باشد (۲ تا ۴۰ نویسه)';
    else if (getTemplate(key)) fields.key = 'قالبی با این کلید وجود دارد';
    else out.key = key;
  } else if ('key' in b && system) {
    fields.key = 'کلید قالب‌های سیستمی قابل تغییر نیست';
  }
  for (const f of ['label_fa', 'label_en']) if (f in b) out[f] = str(b[f], 120);
  for (const f of ['body_fa', 'body_en']) {
    if (!(f in b)) continue;
    const v = String(b[f] ?? '').replace(/\r\n?/g, '\n').trim();
    if ([...v].length > LIMITS.bodyChars) fields[f] = `متن قالب حداکثر ${faNumber(LIMITS.bodyChars)} نویسه`;
    else out[f] = v;
  }
  if ('variables' in b) {
    if (!Array.isArray(b.variables) || b.variables.length > 20) fields.variables = 'فهرست متغیرها باید آرایه‌ای حداکثر ۲۰تایی باشد';
    else {
      const vars = b.variables.map(x => str(x, 40).toLowerCase());
      if (vars.some(x => !/^[a-z][a-z0-9_]*$/.test(x))) fields.variables = 'نام متغیر فقط حروف کوچک لاتین، رقم و _';
      else out.variables = JSON.stringify([...new Set(vars)]);
    }
  }
  if ('provider_map' in b) {
    const m = b.provider_map;
    if (!m || typeof m !== 'object' || Array.isArray(m)) fields.provider_map = 'باید یک شیء باشد';
    else {
      // the variables the template will hand to the provider: the declared list
      // plus every placeholder in the (new or stored) bodies
      const variables = [...new Set([
        ...(out.variables ? JSON.parse(out.variables) : existing?.variables || []),
        ...placeholdersOf(out.body_fa ?? existing?.body_fa),
        ...placeholdersOf(out.body_en ?? existing?.body_en),
      ])];
      const clean = {};
      for (const [pid, entry] of Object.entries(m)) {
        let p;
        try { p = getProvider(pid); } catch { fields[`provider_map.${pid}`] = 'سرویس‌دهندهٔ ناشناخته'; continue; }
        if (entry === null || entry === undefined || entry === '') continue;   // remove mapping
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) { fields[`provider_map.${pid}`] = 'باید یک شیء باشد'; continue; }
        const json = JSON.stringify(entry);
        if (json.length > MAX_MAP_JSON) { fields[`provider_map.${pid}`] = `نگاشت الگو بیش از حد بلند است (حداکثر ${faNumber(MAX_MAP_JSON)} نویسه)`; continue; }
        const err = typeof p.validateMap === 'function' ? p.validateMap(entry, { variables }) : null;
        if (err) { fields[`provider_map.${pid}`] = err; continue; }
        clean[pid] = JSON.parse(json);
      }
      out.provider_map = JSON.stringify(clean);
    }
  }
  if ('enabled' in b) {
    if (typeof b.enabled !== 'boolean') fields.enabled = 'باید true/false باشد';
    else out.enabled = b.enabled ? 1 : 0;
  }
  if (Object.keys(fields).length) throw invalid(fields);
  return out;
}

router.post('/templates', (req, res) => {
  const p = templatePatch(req.body, { create: true });
  const body_fa = p.body_fa ?? '', body_en = p.body_en ?? '';
  if (!body_fa && !body_en) throw invalid({ body_fa: 'متن فارسی یا انگلیسی قالب لازم است' });
  const variables = p.variables ?? JSON.stringify([...new Set([...placeholdersOf(body_fa), ...placeholdersOf(body_en)])]);
  db.prepare(`INSERT INTO sms_templates (key, label_fa, label_en, body_fa, body_en, variables, provider_map, is_system, enabled)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`).run(p.key, p.label_fa ?? '', p.label_en ?? '', body_fa, body_en, variables, p.provider_map ?? '{}', p.enabled ?? 1);
  audit(req, 'sms.template.create', 'sms_templates', p.key);
  res.status(201).json({ ok: true, item: templateOut(getTemplate(p.key)) });
});

router.put('/templates/:key', (req, res) => {
  const t = getTemplate(str(req.params.key, 40));
  if (!t) throw bad(404, 'not_found', 'قالب یافت نشد', 'Template not found');
  const p = templatePatch(req.body, { system: t.is_system, existing: t });
  const next = { ...t, ...p, variables: p.variables ?? JSON.stringify(t.variables), provider_map: p.provider_map ?? JSON.stringify(t.provider_map), enabled: p.enabled ?? (t.enabled ? 1 : 0) };
  if (!next.body_fa && !next.body_en) throw invalid({ body_fa: 'متن فارسی یا انگلیسی قالب لازم است' });
  db.prepare(`UPDATE sms_templates SET label_fa=@label_fa, label_en=@label_en, body_fa=@body_fa, body_en=@body_en,
    variables=@variables, provider_map=@provider_map, enabled=@enabled, updated_at=datetime('now') WHERE key=@key`).run(next);
  audit(req, 'sms.template.update', 'sms_templates', t.key, `fields: ${Object.keys(p).join(',') || '-'}`);
  res.json({ ok: true, item: templateOut(getTemplate(t.key)) });
});

router.delete('/templates/:key', (req, res) => {
  const t = getTemplate(str(req.params.key, 40));
  if (!t) throw bad(404, 'not_found', 'قالب یافت نشد', 'Template not found');
  if (t.is_system) throw bad(409, 'system_template', 'قالب‌های سیستمی حذف نمی‌شوند؛ می‌توانید آن را غیرفعال کنید', 'System templates cannot be deleted; disable it instead');
  db.prepare('DELETE FROM sms_templates WHERE key=? AND is_system=0').run(t.key);
  audit(req, 'sms.template.delete', 'sms_templates', t.key);
  res.json({ ok: true });
});

// ---- log ---------------------------------------------------------------------------
router.get('/log', (req, res) => {
  const qy = req.query || {};
  res.json({
    ...sms.listLog({
      status: str(qy.status, 20), provider: str(qy.provider, 40), template_key: str(qy.template_key, 40), kind: str(qy.kind, 10),
      to: str(qy.to, 30), lead_id: qy.lead_id, invoice_id: qy.invoice_id, payment_id: qy.payment_id,
      from: str(qy.from, 19), until: str(qy.until, 19), q: str(qy.q, 80), page: qy.page, per_page: qy.per_page,
    }),
    statuses: sms.LOG_STATUSES,
    error_labels: Object.fromEntries(Object.entries(ERROR_CODES).map(([k, v]) => [k, { fa: v.fa, en: v.en }])),
  });
});

router.get('/log/:id', (req, res) => {
  const row = sms.logRow(Number(req.params.id));
  if (!row) throw bad(404, 'not_found', 'رکورد یافت نشد', 'Log row not found');
  res.json(row);
});

router.post('/log/:id/refresh-status', wrap(async (req, res) => {
  const r = await sms.refreshStatus(Number(req.params.id));
  if (!r) throw bad(404, 'not_found', 'رکورد یافت نشد', 'Log row not found');
  res.json({ ok: true, state: r.state, log: r.log });
}));

router.post('/log/:id/retry', sendLimiter, wrap(async (req, res) => {
  const r = await sms.retry(Number(req.params.id), req.admin?.u);
  if (!r) throw bad(404, 'not_found', 'رکورد یافت نشد', 'Log row not found');
  audit(req, 'sms.retry', 'sms_log', r.logId, `retry of #${req.params.id} → ${r.status}`);
  if (r.skipped) throw bad(429, `sms_${r.skipped}`, r.log?.error_label || 'ارسال متوقف شد', ERROR_CODES[r.skipped]?.en || 'Send skipped');
  if (!r.ok) throw deliverFailed(r);
  res.json({ ok: true, id: r.logId, log: r.log });
}));

// ---- manual send --------------------------------------------------------------------
router.post('/send', sendLimiter, wrap(async (req, res) => {
  const b = req.body || {};
  const fields = {};
  let to = '';
  let lead_id = null;
  if (b.lead_id !== undefined && b.lead_id !== null && b.lead_id !== '') {
    lead_id = Number(b.lead_id);
    const lead = Number.isInteger(lead_id) ? db.prepare('SELECT id, phone, phone_norm, language FROM leads WHERE id=?').get(lead_id) : null;
    if (!lead) fields.lead_id = 'سرنخ یافت نشد';
    else {
      to = lead.phone_norm || normalizeMobile(lead.phone) || '';
      if (!to) fields.lead_id = 'این سرنخ شمارهٔ همراه ایرانی ندارد';
      if (!b.lang && lead.language) b.lang = lead.language;
    }
  } else {
    to = normalizeMobile(b.to) || '';
    if (!to) fields.to = 'شمارهٔ همراه معتبر نیست (۰۹xxxxxxxxx)';
  }
  const templateKey = str(b.template_key, 40);
  const text = typeof b.text === 'string' ? b.text : '';
  if (!templateKey && !text.trim()) fields.text = 'متن پیام یا قالب لازم است';
  if (templateKey && !getTemplate(templateKey)) fields.template_key = 'قالب یافت نشد';
  if (text && [...text].length > LIMITS.textChars) fields.text = `متن پیام حداکثر ${faNumber(LIMITS.textChars)} نویسه`;
  const params = b.params && typeof b.params === 'object' && !Array.isArray(b.params) ? b.params : {};
  if (Object.keys(fields).length) throw invalid(fields);
  const r = await sms.sendManual({ to, text, templateKey, vars: params, lang: b.lang === 'en' ? 'en' : 'fa', adminUser: req.admin?.u, refs: { lead_id } });
  audit(req, 'sms.send', 'sms_log', r.logId, `${templateKey || 'free text'} → ${r.status}`);
  if (r.skipped) throw bad(429, `sms_${r.skipped}`, r.log?.error_label || 'ارسال متوقف شد', ERROR_CODES[r.skipped]?.en || 'Send skipped');
  if (!r.ok) throw deliverFailed(r);
  res.json({ ok: true, id: r.logId, log: r.log });
}));

export default { basePath: '/sms', order: 60, router };
