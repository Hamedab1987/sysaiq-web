// sms_config (private settings row) + the provider secrets.
//   readConfig()  → normalised config, defaults filled, unknown keys dropped
//   writeConfig(partial) → merged + validated, persisted
// Secrets never live here: each provider's key is a registered secret
// (lib/secrets.js) and the config only carries the non-secret fields
// (sender line, username, relay base).
import { getSetting, setSetting } from '../db/index.js';
import { registerSetting } from '../lib/registry.js';
import { registerSecret } from '../lib/secrets.js';
import { normalizeMobile, toFaDigits } from '../lib/normalize.js';
import { providers, hasProvider, MOCK_ID } from './registry.js';
import { invalid } from './errors.js';

// 100000 → '۱۰۰٬۰۰۰' for the Persian field messages
export const faNumber = n => toFaDigits(Number(n).toLocaleString('en-US')).replace(/,/g, '٬');

export const SMS_CONFIG_KEY = 'sms_config';
export const OWNER_MOBILE_DEFAULT = '09125130505';
export const EVENT_KEYS = Object.freeze(['lead_owner', 'lead_customer', 'invoice_link', 'invoice_reminder', 'payment_customer', 'payment_owner']);
export const CAP_LIMITS = Object.freeze({ daily: { min: 1, max: 100000, dflt: 200 }, perNumber: { min: 1, max: 1000, dflt: 5 } });

// relay (optional, see plan §5): the key is a secret, the base is config
export const RELAY_SECRET = 'sms.relay.key';

const SECRET_LABELS = {
  'sms.kavenegar.api_key': ['کلید API کاوه‌نگار', 'Kavenegar API key'],
  'sms.smsir.api_key': ['کلید API اس‌ام‌اس‌دات‌آی‌آر', 'SMS.ir API key'],
  'sms.ghasedak.api_key': ['کلید API قاصدک', 'Ghasedak API key'],
  'sms.ippanel.api_key': ['کلید API فراز اس‌ام‌اس (IPPanel)', 'IPPanel Edge API key'],
  'sms.melipayamak.password': ['رمز وب‌سرویس ملی‌پیامک', 'Melipayamak web-service password'],
  [RELAY_SECRET]: ['کلید رله (relay) پیامک', 'SMS relay key'],
};
for (const [name, [label_fa, label_en]] of Object.entries(SECRET_LABELS)) {
  registerSecret({ name, label_fa, label_en, group: 'sms', validate: v => (/\s/.test(v) ? 'must not contain spaces' : null) });
}

export function defaultConfig() {
  return {
    active: '',              // '' = SMS off
    fallback: '',
    providers: {},           // {id: {sender, username}}
    owner_mobile: OWNER_MOBILE_DEFAULT,
    events: Object.fromEntries(EVENT_KEYS.map(k => [k, true])),
    daily_cap: CAP_LIMITS.daily.dflt,
    per_number_daily_cap: CAP_LIMITS.perNumber.dflt,
    relay_base: '',
  };
}

const schemaDoc = {
  active: 'provider id | ""', fallback: 'provider id | ""', providers: '{id: {sender, username}}',
  owner_mobile: '09xxxxxxxxx', events: `{${EVENT_KEYS.join('|')}: bool}`, daily_cap: 'int', per_number_daily_cap: 'int', relay_base: 'https url | ""',
};
registerSetting({ key: SMS_CONFIG_KEY, public: false, schema: schemaDoc });

const clampInt = (x, { min, max, dflt }) => {
  const n = Number(x);
  if (!Number.isInteger(n)) return dflt;
  return Math.min(max, Math.max(min, n));
};
const text = (x, max) => String(x ?? '').trim().slice(0, max);

// tolerant read: a malformed or legacy row never breaks a send
export function normalizeConfig(raw) {
  const d = defaultConfig();
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const known = new Set(providers().map(p => p.id));
  const out = { ...d };
  out.active = known.has(src.active) ? src.active : '';
  out.fallback = known.has(src.fallback) && src.fallback !== out.active ? src.fallback : '';
  out.providers = {};
  if (src.providers && typeof src.providers === 'object') {
    for (const [id, cfg] of Object.entries(src.providers)) {
      if (!known.has(id) || !cfg || typeof cfg !== 'object') continue;
      out.providers[id] = { sender: text(cfg.sender, 40), username: text(cfg.username, 80) };
    }
  }
  out.owner_mobile = normalizeMobile(src.owner_mobile) || d.owner_mobile;
  out.events = { ...d.events };
  if (src.events && typeof src.events === 'object') {
    for (const k of EVENT_KEYS) if (typeof src.events[k] === 'boolean') out.events[k] = src.events[k];
  }
  out.daily_cap = clampInt(src.daily_cap, CAP_LIMITS.daily);
  out.per_number_daily_cap = clampInt(src.per_number_daily_cap, CAP_LIMITS.perNumber);
  out.relay_base = /^https:\/\/[^\s/]+(\/[^\s]*)?$/.test(String(src.relay_base || '')) ? text(src.relay_base, 300).replace(/\/+$/, '') : '';
  return out;
}

export const readConfig = () => normalizeConfig(getSetting(SMS_CONFIG_KEY, null));

// strict validation for the admin PUT: every present field must be right
export function validateConfigPatch(body) {
  const b = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  const fields = {};
  const ids = providers().map(p => p.id);
  const out = {};
  if ('active' in b) {
    const a = String(b.active ?? '');
    if (a && !hasProvider(a)) fields.active = a === MOCK_ID ? 'سرویس‌دهندهٔ آزمایشی در این محیط مجاز نیست' : 'سرویس‌دهندهٔ فعال معتبر نیست';
    else out.active = a;
  }
  if ('fallback' in b) {
    const f = String(b.fallback ?? '');
    if (f && !hasProvider(f)) fields.fallback = 'سرویس‌دهندهٔ پشتیبان معتبر نیست';
    else out.fallback = f;
  }
  if ('providers' in b) {
    if (!b.providers || typeof b.providers !== 'object' || Array.isArray(b.providers)) fields.providers = 'باید یک شیء باشد';
    else {
      out.providers = {};
      for (const [id, cfg] of Object.entries(b.providers)) {
        if (!ids.includes(id)) { fields[`providers.${id}`] = 'سرویس‌دهندهٔ ناشناخته'; continue; }
        if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) { fields[`providers.${id}`] = 'باید یک شیء باشد'; continue; }
        // only the fields present change (the secret fields ride along and are handled by the route)
        const entry = {};
        if ('sender' in cfg) {
          const sender = String(cfg.sender ?? '').trim();
          if (sender.length > 40 || !/^[+\d\s\-()]*$/.test(sender)) fields[`providers.${id}.sender`] = 'شمارهٔ خط ارسال معتبر نیست';
          else entry.sender = sender;
        }
        if ('username' in cfg) {
          const username = String(cfg.username ?? '').trim();
          if (username.length > 80 || /\s/.test(username)) fields[`providers.${id}.username`] = 'نام کاربری معتبر نیست';
          else entry.username = username;
        }
        out.providers[id] = entry;
      }
    }
  }
  if ('owner_mobile' in b) {
    const m = normalizeMobile(b.owner_mobile);
    if (!m) fields.owner_mobile = 'شمارهٔ همراه مالک معتبر نیست (۰۹xxxxxxxxx)';
    else out.owner_mobile = m;
  }
  if ('events' in b) {
    if (!b.events || typeof b.events !== 'object' || Array.isArray(b.events)) fields.events = 'باید یک شیء باشد';
    else {
      out.events = {};
      for (const [k, val] of Object.entries(b.events)) {
        if (!EVENT_KEYS.includes(k)) { fields[`events.${k}`] = 'رویداد ناشناخته'; continue; }
        if (typeof val !== 'boolean') { fields[`events.${k}`] = 'باید true/false باشد'; continue; }
        out.events[k] = val;
      }
    }
  }
  for (const [key, lim] of [['daily_cap', CAP_LIMITS.daily], ['per_number_daily_cap', CAP_LIMITS.perNumber]]) {
    if (!(key in b)) continue;
    const n = typeof b[key] === 'string' && b[key].trim() !== '' ? Number(b[key]) : b[key];
    if (!Number.isInteger(n) || n < lim.min || n > lim.max) fields[key] = `باید عددی بین ${faNumber(lim.min)} و ${faNumber(lim.max)} باشد`;
    else out[key] = n;
  }
  if ('relay_base' in b) {
    const r = String(b.relay_base ?? '').trim();
    if (r && !/^https:\/\/[^\s/]+(\/[^\s]*)?$/.test(r)) fields.relay_base = 'آدرس رله باید با https:// شروع شود';
    else if (r.length > 300) fields.relay_base = 'آدرس رله بیش از حد بلند است';
    else out.relay_base = r.replace(/\/+$/, '');
  }
  if (Object.keys(fields).length) throw invalid(fields);
  return out;
}

// merge a validated patch onto the stored config and persist it
export function writeConfig(patch) {
  const cur = readConfig();
  const next = { ...cur, ...patch };
  if (patch.providers) {
    next.providers = { ...cur.providers };
    for (const [id, entry] of Object.entries(patch.providers)) next.providers[id] = { ...(cur.providers[id] || {}), ...entry };
  }
  if (patch.events) next.events = { ...cur.events, ...patch.events };
  if (next.fallback && next.fallback === next.active) throw invalid({ fallback: 'سرویس‌دهندهٔ پشتیبان نمی‌تواند همان سرویس‌دهندهٔ فعال باشد' });
  const clean = normalizeConfig(next);
  setSetting(SMS_CONFIG_KEY, clean);
  return clean;
}
