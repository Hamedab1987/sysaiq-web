// SMS service: the one place that sends. Renders a template (or takes free
// text), applies the anti-abuse guards, writes an sms_log row per attempt,
// dispatches pattern-vs-simple to the active provider and gives the
// fallback provider one turn on a retriable error.
//   sendTemplate({ key, to, vars, lang, dedupeKey, refs })   automated (events)
//   sendManual({ to, text | templateKey, vars, lang, adminUser })
//   sendTest({ to, mode, templateKey, providerId, adminUser })
//   credit({ providerId, force }) · refreshStatus(logId) · retry(logId, adminUser) · listLog(filters)
// The guard check and the 'queued' insert run synchronously (better-sqlite3),
// so two concurrent events can't both pass a cap or a dedupe check.
import { db } from '../db/index.js';
import { getSecret } from '../lib/secrets.js';
import { normalizeMobile } from '../lib/normalize.js';
import { J } from '../lib/html.js';
import { getProvider } from './registry.js';
import { readConfig, RELAY_SECRET } from './config.js';
import { render, renderText, getTemplate, bodyFor, sanitizeVars, sampleVars, countSegments, LIMITS } from './templates.js';
import { makeHttp } from './http.js';
import { SmsError, errorLabel } from './errors.js';

export const WINDOW_SQL = "datetime('now', '-1 day')";   // rolling 24 h, not the calendar day
export const LOG_STATUSES = Object.freeze(['queued', 'sent', 'delivered', 'undelivered', 'failed', 'blocked', 'skipped']);
export const CREDIT_TTL_MS = 60 * 1000;
export const TEST_TEXT = { fa: 'پیام آزمایشی SysaiQ — تنظیمات پیامک درست است.', en: 'SysaiQ test message — SMS settings are working.' };
const MAX_ERR = 300;

// tests may inject a DNS lookup / log sink for the real adapters
export const transport = { lookup: undefined, log: undefined };

let stmts = null;
const q = () => stmts ||= {
  insert: db.prepare(`INSERT INTO sms_log
    (kind, template_key, provider, mode, to_number, lang, text, vars, segments, status, error_code, error_message,
     dedupe_key, lead_id, invoice_id, payment_id, attempt, retry_of, admin_user)
    VALUES (@kind, @template_key, @provider, @mode, @to_number, @lang, @text, @vars, @segments, @status, @error_code, @error_message,
     @dedupe_key, @lead_id, @invoice_id, @payment_id, @attempt, @retry_of, @admin_user)`),
  sent: db.prepare(`UPDATE sms_log SET status='sent', message_id=?, cost=?, error_code='', error_message='',
    sent_at=datetime('now'), updated_at=datetime('now') WHERE id=?`),
  failed: db.prepare(`UPDATE sms_log SET status='failed', error_code=?, error_message=?, updated_at=datetime('now') WHERE id=?`),
  setStatus: db.prepare(`UPDATE sms_log SET status=?, status_checked_at=datetime('now'), updated_at=datetime('now') WHERE id=?`),
  touchStatus: db.prepare(`UPDATE sms_log SET status_checked_at=datetime('now'), updated_at=datetime('now') WHERE id=?`),
  byId: db.prepare('SELECT * FROM sms_log WHERE id=?'),
  // caps count what was (or is about to be) handed to a provider: 'queued'
  // rows count so a concurrent job can't slip past, 'failed' ones do not —
  // a fallback chain writes two rows per job and a provider outage must not
  // eat the daily cap (or a visitor's per-number cap) for nothing.
  dedupe: db.prepare(`SELECT id FROM sms_log WHERE dedupe_key=? AND status NOT IN ('failed','skipped') LIMIT 1`),
  perTemplate: db.prepare(`SELECT COUNT(*) c FROM sms_log WHERE to_number=? AND template_key=? AND kind='auto'
    AND status NOT IN ('failed','skipped') AND created_at >= ${WINDOW_SQL}`),
  perNumber: db.prepare(`SELECT COUNT(*) c FROM sms_log WHERE to_number=? AND kind='auto' AND status NOT IN ('failed','skipped') AND created_at >= ${WINDOW_SQL}`),
  daily: db.prepare(`SELECT COUNT(*) c FROM sms_log WHERE kind IN ('auto','manual') AND status NOT IN ('failed','skipped') AND created_at >= ${WINDOW_SQL}`),
};

const intOrNull = x => (Number.isInteger(Number(x)) && x !== null && x !== undefined && x !== '' ? Number(x) : null);

function insertLog(row) {
  return Number(q().insert.run({
    kind: row.kind || 'auto',
    template_key: row.templateKey || '',
    provider: row.provider || '',
    mode: row.mode || 'simple',
    to_number: row.to,
    lang: row.lang === 'en' ? 'en' : 'fa',
    text: row.text || '',
    vars: JSON.stringify(row.vars || {}),
    segments: row.segments || 0,
    status: row.status || 'queued',
    error_code: row.error_code || '',
    error_message: String(row.error_message || '').slice(0, MAX_ERR),
    dedupe_key: row.dedupeKey || '',
    lead_id: intOrNull(row.refs?.lead_id),
    invoice_id: intOrNull(row.refs?.invoice_id),
    payment_id: intOrNull(row.refs?.payment_id),
    attempt: row.attempt || 1,
    retry_of: intOrNull(row.retryOf),
    admin_user: String(row.adminUser || '').slice(0, 80),
  }).lastInsertRowid);
}

export function logRow(id) {
  const r = q().byId.get(Number(id));
  return r ? decorate(r) : null;
}
function decorate(r) {
  return { ...r, vars: J(r.vars, {}), error_label: r.error_code ? errorLabel(r.error_code) : '' };
}

// provider call context: secret + line + relay + pinned http client
function buildCtx(provider, cfg) {
  const pc = cfg.providers[provider.id] || {};
  const relay = cfg.relay_base ? { base: cfg.relay_base, token: getSecret(RELAY_SECRET) || '' } : null;
  const http = makeHttp({ provider: provider.id, hosts: provider.hosts, relay, redactUrl: provider.redactUrl, lookup: transport.lookup, log: transport.log });
  return {
    secret: (provider.secretName ? getSecret(provider.secretName) : '') || '',
    sender: pc.sender || '',
    username: pc.username || '',
    http,
    log: transport.log || console.log,
  };
}

const asSmsError = (e, provider) => (e instanceof SmsError ? e : new SmsError('unknown', { provider, message: String(e?.message || e), cause: e }));

// one job → one row per provider tried. `chain` = [active, fallback?]
async function deliver(job, cfg, chain) {
  let last = null;
  let prevId = intOrNull(job.retryOf);
  for (let i = 0; i < chain.length; i++) {
    const providerId = chain[i];
    let provider;
    try { provider = getProvider(providerId); } catch (e) {
      const id = insertLog({ ...job, provider: providerId, mode: 'simple', status: 'failed', error_code: e.code, error_message: e.message, attempt: i + 1, retryOf: prevId });
      last = { logId: id, error: e, provider: providerId, mode: 'simple' };
      break;
    }
    const entry = job.template?.provider_map?.[providerId];
    const mode = entry && typeof entry === 'object' && provider.supportsPattern ? 'pattern' : 'simple';
    const id = insertLog({ ...job, provider: providerId, mode, status: 'queued', attempt: i + 1, retryOf: prevId });
    try {
      const ctx = buildCtx(provider, cfg);
      const res = mode === 'pattern'
        ? await provider.sendPattern(ctx, { to: job.to, template: entry, params: job.vars })
        : await provider.send(ctx, { to: job.to, text: job.text, sender: ctx.sender });
      q().sent.run(String(res?.messageId || ''), Number.isFinite(res?.cost) ? res.cost : null, id);
      return { ok: true, logId: id, status: 'sent', provider: providerId, mode, messageId: String(res?.messageId || ''), log: logRow(id) };
    } catch (e) {
      const err = asSmsError(e, providerId);
      q().failed.run(err.code, err.detail.slice(0, MAX_ERR), id);
      last = { logId: id, error: err, provider: providerId, mode };
      prevId = id;
      if (!err.retriable) break;
    }
  }
  return { ok: false, logId: last.logId, status: 'failed', provider: last.provider, mode: last.mode, error: last.error, log: logRow(last.logId) };
}

const chainFor = cfg => [cfg.active, cfg.fallback].filter((p, i, a) => p && a.indexOf(p) === i);

// --- guards -----------------------------------------------------------------
// The per-number caps are anti-abuse limits for visitors' numbers. The owner's
// own mobile is the destination of every lead/payment alert, so it is exempt
// from them (a busy day must not silence the owner); only the global daily
// cap and dedupe bound it.
function autoGuard({ to, templateKey, dedupeKey }, cfg) {
  if (dedupeKey && q().dedupe.get(dedupeKey)) return 'dedupe';
  if (to !== cfg.owner_mobile) {
    if (templateKey === 'lead_customer' && q().perTemplate.get(to, templateKey).c >= 1) return 'cap_template';
    if (q().perNumber.get(to).c >= cfg.per_number_daily_cap) return 'cap_number';
  }
  if (q().daily.get().c >= cfg.daily_cap) return 'cap_daily';
  return null;
}
const manualGuard = (_job, cfg) => (q().daily.get().c >= cfg.daily_cap ? 'cap_daily' : null);

function skipped(job, reason, cfg) {
  const id = insertLog({ ...job, provider: cfg.active, status: 'skipped', error_code: reason, error_message: errorLabel(reason, 'en') });
  return { ok: false, skipped: reason, logId: id, status: 'skipped', log: logRow(id) };
}
const silent = reason => ({ ok: false, skipped: reason, logId: null, status: 'skipped', log: null });

// --- public API ---------------------------------------------------------------
export async function sendTemplate({ key, to, vars = {}, lang = 'fa', dedupeKey = '', refs = {}, kind = 'auto', adminUser = '' } = {}) {
  const cfg = readConfig();
  if (!cfg.active) return silent('not_configured');
  if (kind === 'auto' && cfg.events[key] === false) return silent('event_off');
  const num = normalizeMobile(to);
  if (!num) return silent('bad_number');
  const base = { kind, templateKey: String(key || ''), to: num, lang, dedupeKey, refs, adminUser, vars: sanitizeVars(vars), text: '', segments: 0, template: null };
  let r;
  try {
    r = render(key, lang, vars);
  } catch (e) {
    const err = asSmsError(e, cfg.active);
    if (err.code === 'template_missing' || err.code === 'template_disabled') return silent(err.code);
    // a broken call site (missing variable) is worth a visible failed row
    const id = insertLog({ ...base, provider: cfg.active, status: 'failed', error_code: err.code, error_message: err.detail });
    return { ok: false, logId: id, status: 'failed', error: err, log: logRow(id) };
  }
  const job = { ...base, lang: r.lang, text: r.text, vars: r.vars, segments: r.segments, template: r.template };
  const guard = kind === 'auto' ? autoGuard(job, cfg) : kind === 'manual' ? manualGuard(job, cfg) : null;
  if (guard) return skipped(job, guard, cfg);
  return deliver(job, cfg, chainFor(cfg));
}

// free text (simple mode, with the blacklist caveat) or a template
export async function sendManual({ to, text, templateKey, vars = {}, lang = 'fa', adminUser = '', refs = {} } = {}) {
  if (templateKey) return sendTemplate({ key: templateKey, to, vars, lang, refs, kind: 'manual', adminUser });
  const cfg = readConfig();
  if (!cfg.active) throw new SmsError('not_configured');
  const num = normalizeMobile(to);
  if (!num) throw new SmsError('bad_mobile');
  const r = renderText(String(text ?? '').replace(/\{\{|\}\}/g, ''), {});
  const job = { kind: 'manual', templateKey: '', to: num, lang, text: r.text, vars: {}, segments: r.segments, template: null, dedupeKey: '', refs, adminUser };
  const guard = manualGuard(job, cfg);
  if (guard) return skipped(job, guard, cfg);
  return deliver(job, cfg, chainFor(cfg));
}

// one provider, no fallback, exempt from caps and dedupe
export async function sendTest({ to, mode = 'simple', templateKey = '', providerId = '', lang = 'fa', adminUser = '' } = {}) {
  const cfg = readConfig();
  const pid = providerId || cfg.active;
  if (!pid) throw new SmsError('not_configured');
  getProvider(pid); // throws provider_unknown / mock_refused
  const num = normalizeMobile(to);
  if (!num) throw new SmsError('bad_mobile');
  let job;
  if (mode === 'pattern') {
    const template = getTemplate(templateKey);
    if (!template) throw new SmsError('template_missing', { message: String(templateKey) });
    if (!template.provider_map?.[pid]) throw new SmsError('template', { provider: pid, message: `no pattern mapping for ${pid}` });
    const r = render(templateKey, lang, sampleVars(template));
    job = { kind: 'test', templateKey, to: num, lang: r.lang, text: r.text, vars: r.vars, segments: r.segments, template: r.template, dedupeKey: '', refs: {}, adminUser };
  } else {
    const text = TEST_TEXT[lang === 'en' ? 'en' : 'fa'];
    job = { kind: 'test', templateKey: '', to: num, lang, text, vars: {}, segments: countSegments(text).segments, template: null, dedupeKey: '', refs: {}, adminUser };
  }
  return deliver(job, cfg, [pid]);
}

// --- credit (cached 60 s per provider) ---------------------------------------
const creditCache = new Map();
export async function credit({ providerId = '', force = false } = {}) {
  const cfg = readConfig();
  const pid = providerId || cfg.active;
  if (!pid) throw new SmsError('not_configured');
  const hit = creditCache.get(pid);
  if (!force && hit && Date.now() - hit.at < CREDIT_TTL_MS) return { ...hit.value, cached: true };
  const provider = getProvider(pid);
  const res = await provider.credit(buildCtx(provider, cfg));
  const value = { provider: pid, amount: Number.isFinite(res?.amount) ? res.amount : null, unit: String(res?.unit || ''), checked_at: new Date().toISOString() };
  creditCache.set(pid, { at: Date.now(), value });
  return { ...value, cached: false };
}
export const _clearCreditCache = () => creditCache.clear();

// --- delivery status ------------------------------------------------------------
export async function refreshStatus(logId) {
  const row = q().byId.get(Number(logId));
  if (!row) return null;
  if (!row.message_id || !row.provider || row.status === 'skipped') throw new SmsError('unsupported', { message: 'no provider message id' });
  const provider = getProvider(row.provider);
  if (typeof provider.status !== 'function' || !provider.supportsStatus) throw new SmsError('unsupported', { provider: row.provider });
  const res = await provider.status(buildCtx(provider, readConfig()), { messageId: row.message_id });
  const state = String(res?.state || 'unknown');
  if (LOG_STATUSES.includes(state) && state !== 'skipped') q().setStatus.run(state, row.id);
  else q().touchStatus.run(row.id);
  return { state, log: logRow(row.id) };
}

// --- admin retry: same number, same text/pattern, a new row pointing back ----------
export async function retry(logId, adminUser = '') {
  const row = q().byId.get(Number(logId));
  if (!row) return null;
  if (row.status === 'queued') throw new SmsError('validation', { message: 'still queued' });
  const cfg = readConfig();
  if (!cfg.active) throw new SmsError('not_configured');
  const vars = J(row.vars, {});
  const template = row.template_key ? getTemplate(row.template_key) : null;
  let text = row.text, segments = row.segments;
  if (template) {
    if (!template.enabled) throw new SmsError('template_disabled');
    const r = renderText(bodyFor(template, row.lang), vars);
    text = r.text; segments = r.segments;
  } else if (!text) {
    throw new SmsError('empty_text');
  }
  const job = {
    kind: row.kind === 'test' ? 'test' : 'manual', templateKey: row.template_key, to: row.to_number, lang: row.lang, text, vars, segments, template,
    dedupeKey: '', refs: { lead_id: row.lead_id, invoice_id: row.invoice_id, payment_id: row.payment_id }, adminUser, retryOf: row.id,
  };
  const guard = job.kind === 'manual' ? manualGuard(job, cfg) : null;
  if (guard) return skipped(job, guard, cfg);
  return deliver(job, cfg, chainFor(cfg));
}

// --- log listing --------------------------------------------------------------------
export function listLog(f = {}) {
  const where = [];
  const params = {};
  const eq = (col, val, key = col) => { if (val !== undefined && val !== null && val !== '') { where.push(`${col} = @${key}`); params[key] = val; } };
  if (f.status && LOG_STATUSES.includes(f.status)) eq('status', f.status);
  eq('provider', f.provider ? String(f.provider).slice(0, 40) : '');
  eq('template_key', f.template_key ? String(f.template_key).slice(0, 40) : '');
  if (f.kind && ['auto', 'manual', 'test'].includes(f.kind)) eq('kind', f.kind);
  for (const k of ['lead_id', 'invoice_id', 'payment_id']) if (intOrNull(f[k]) !== null) eq(k, Number(f[k]));
  if (f.to) {
    const n = normalizeMobile(f.to);
    if (n) eq('to_number', n);
    else { const d = String(f.to).replace(/\D/g, '').slice(0, 15); if (d) { where.push('to_number LIKE @to'); params.to = `%${d}%`; } }
  }
  if (f.from && /^\d{4}-\d{2}-\d{2}/.test(f.from)) { where.push('created_at >= @from'); params.from = String(f.from).slice(0, 19); }
  if (f.until && /^\d{4}-\d{2}-\d{2}/.test(f.until)) { where.push('created_at <= @until'); params.until = String(f.until).slice(0, 10) + ' 23:59:59'; }
  if (f.q) { where.push('(text LIKE @q OR error_message LIKE @q OR message_id LIKE @q)'); params.q = `%${String(f.q).slice(0, 80)}%`; }
  const per_page = Math.min(200, Math.max(1, Number(f.per_page) || 50));
  const page = Math.max(1, Number(f.page) || 1);
  const sql = where.length ? ` WHERE ${where.join(' AND ')}` : '';
  const total = db.prepare(`SELECT COUNT(*) c FROM sms_log${sql}`).get(params).c;
  const items = db.prepare(`SELECT * FROM sms_log${sql} ORDER BY id DESC LIMIT @lim OFFSET @off`).all({ ...params, lim: per_page, off: (page - 1) * per_page }).map(decorate);
  return { items, total, page, per_page };
}

// counters for the admin header / dashboard (last 24 h)
export function usage() {
  const cfg = readConfig();
  return { sent_24h: q().daily.get().c, daily_cap: cfg.daily_cap, per_number_daily_cap: cfg.per_number_daily_cap, limits: LIMITS };
}
