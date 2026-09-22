// Lead creation shared by the public form and (later) the AI assistant.
//   const { id } = createLead(req.body, { source: 'form', ip: req.ip });
// Validates and caps every field, normalises Persian/Arabic digits in the
// phone, drops honeypot hits silently, forces the server-owned fields
// (source, lead_score, summary), stores phone_norm for Iranian mobiles,
// then emits lead.created and sends the notification mail.
import { createHmac } from 'node:crypto';
import { db } from '../db/index.js';
import { config } from '../config.js';
import { v, validate } from './validate.js';
import { HttpError } from './errors.js';
import { toLatinDigits, normalizeMobile } from './normalize.js';
import { emit } from './events.js';
import { sendLeadNotification } from '../mail.js';

const HONEYPOT_FIELD = 'website';
const LANGUAGES = ['fa', 'en'];
const CONTACT_PREFS = ['phone', 'email', 'whatsapp', 'telegram'];
const PHONE_RE = /^\+?\d{7,15}$/;

const fieldError = (key, msg) => new HttpError(422, 'validation', 'Validation failed', { [key]: msg });

// '۰۹۱۲ ۳۴۵-۶۷۸۹' → '09123456789'; '0098…' → '+98…'
function cleanPhone(x) {
  let s = toLatinDigits(x).replace(/[\s\-.()‌]/g, '');
  if (s.startsWith('00')) s = `+${s.slice(2)}`;
  return s;
}
const phoneRule = (x, key) => {
  const s = cleanPhone(x);
  if (!PHONE_RE.test(s)) throw fieldError(key, `${key} must be a valid phone number`);
  return s;
};
const langRule = (x, key) => {
  const s = String(x ?? '').trim().toLowerCase() || 'en';
  if (!LANGUAGES.includes(s)) throw fieldError(key, `${key} must be one of: ${LANGUAGES.join(', ')}`);
  return s;
};

const SCHEMA = {
  name: v.str({ min: 1, max: 120 }),
  email: v.optional(v.email({ max: 254 })),
  phone: v.optional(phoneRule),
  company: v.str({ max: 160 }),
  project_type: v.str({ max: 80 }),
  message: v.str({ max: 5000 }),
  language: langRule,
  page: v.str({ max: 200 }),
  business_type: v.str({ max: 80 }),
  service_slug: v.optional(v.slug()),
  contact_pref: v.optional(v.oneOf(CONTACT_PREFS)),
};

// keyed hash so the stored value can't be reversed into an address
export function hashIp(ip) {
  if (!ip) return '';
  return createHmac('sha256', config.secretsKey).update(String(ip)).digest('hex').slice(0, 24);
}

let insert = null;
const stmt = () => insert ||= db.prepare(`INSERT INTO leads
  (name, email, phone, company, project_type, message, language, source, summary, lead_score,
   status, page, ip_hash, phone_norm, business_type, service_slug, contact_pref, session_id)
  VALUES (@name, @email, @phone, @company, @project_type, @message, @language, @source, @summary, @lead_score,
   'new', @page, @ip_hash, @phone_norm, @business_type, @service_slug, @contact_pref, @session_id)`);

function validateLead(input) {
  const body = input && typeof input === 'object' ? input : {};
  const out = validate(SCHEMA, body);
  if (!out.email && !out.phone) {
    throw new HttpError(422, 'validation', 'Validation failed', {
      email: 'email or phone is required', phone: 'email or phone is required',
    });
  }
  return out;
}

// → {id, lead} or {id: null, dropped: true} for a honeypot hit
export function createLead(input, { source = 'form', ip = '', sessionId = '' } = {}) {
  const body = input && typeof input === 'object' ? input : {};
  // bots fill every field; humans never see this one
  if (String(body[HONEYPOT_FIELD] ?? '').trim()) return { id: null, dropped: true };

  const clean = validateLead(body);
  const lead = {
    name: clean.name,
    email: clean.email || '',
    phone: clean.phone || '',
    company: clean.company || '',
    project_type: clean.project_type || '',
    message: clean.message || '',
    language: clean.language,
    // server-owned: a visitor can't score or summarise themselves
    source: String(source || 'form').slice(0, 20),
    summary: '',
    lead_score: 0,
    page: clean.page || '',
    ip_hash: hashIp(ip),
    phone_norm: normalizeMobile(clean.phone || '') || '',
    business_type: clean.business_type || '',
    service_slug: clean.service_slug || '',
    contact_pref: clean.contact_pref || '',
    session_id: String(sessionId || '').slice(0, 80),
  };
  const id = Number(stmt().run(lead).lastInsertRowid);
  emit('lead.created', { id, source: lead.source, language: lead.language, lead: { id, ...lead } });
  sendLeadNotification({ id, ...lead }).catch(e => console.error('mail:', e.message));
  return { id, lead: { id, ...lead } };
}
