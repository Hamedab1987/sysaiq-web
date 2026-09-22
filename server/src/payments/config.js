// gateways_config + pay_config (private settings rows) and the gateway secrets.
//   readGatewaysConfig() → { gateways:{id:{enabled, sandbox}}, default, relay_base }
//   readPayConfig()      → { due_days, tax_percent, offline_fa, offline_en, show_enamad }
// Secrets (merchant ids / tokens) never live here — each is a registered
// secret in lib/secrets.js; the config carries only booleans and the relay base.
import { getSetting, setSetting } from '../db/index.js';
import { registerSetting, registerCspSource } from '../lib/registry.js';
import { registerSecret } from '../lib/secrets.js';
import { HttpError } from '../lib/errors.js';
import { gateways, hasGateway, MOCK_ID } from './registry.js';

export const GATEWAYS_KEY = 'gateways_config';
export const PAY_KEY = 'pay_config';
export const RELAY_SECRET = 'gw.relay.key';
export const MAX_TOMAN = 100_000_000;

const SECRETS = {
  'gw.zarinpal.merchant_id': ['شناسهٔ پذیرندهٔ زرین‌پال', 'Zarinpal merchant id'],
  'gw.payping.token': ['توکن API پی‌پینگ', 'PayPing API token'],
  'gw.zibal.merchant': ['کد مرچنت زیبال', 'Zibal merchant'],
  [RELAY_SECRET]: ['کلید رلهٔ (relay) درگاه', 'Gateway relay key'],
};
for (const [name, [label_fa, label_en]] of Object.entries(SECRETS)) {
  registerSecret({ name, label_fa, label_en, group: 'payments', validate: v => (/\s/.test(v) ? 'must not contain spaces' : null) });
}

registerSetting({ key: GATEWAYS_KEY, public: false, schema: { gateways: '{id:{enabled:bool, sandbox:bool}}', default: 'gateway id | ""', relay_base: 'https url | ""' } });
registerSetting({ key: PAY_KEY, public: false, schema: { due_days: 'int 1..180', tax_percent: 'int 0..25', offline_fa: 'text', offline_en: 'text', show_enamad: 'bool' } });

const RELAY_RE = /^https:\/\/[^\s/]+(\/[^\s]*)?$/;
const text = (x, max) => String(x ?? '').trim().slice(0, max);
const invalid = fields => new HttpError(422, 'validation', 'Validation failed', fields);

export function defaultGatewaysConfig() {
  return { gateways: Object.fromEntries(gateways().map(g => [g.id, { enabled: false, sandbox: false }])), default: '', relay_base: '' };
}
export function normalizeGatewaysConfig(raw) {
  const d = defaultGatewaysConfig();
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const out = { ...d, gateways: { ...d.gateways } };
  if (src.gateways && typeof src.gateways === 'object') {
    for (const [id, c] of Object.entries(src.gateways)) {
      if (!hasGateway(id) || !c || typeof c !== 'object') continue;
      out.gateways[id] = { enabled: c.enabled === true, sandbox: c.sandbox === true };
    }
  }
  out.default = hasGateway(src.default) && out.gateways[src.default]?.enabled ? src.default : '';
  out.relay_base = RELAY_RE.test(String(src.relay_base || '')) ? text(src.relay_base, 300).replace(/\/+$/, '') : '';
  return out;
}
export const readGatewaysConfig = () => normalizeGatewaysConfig(getSetting(GATEWAYS_KEY, null));

export function validateGatewaysPatch(body) {
  const b = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  const fields = {};
  const out = {};
  if ('gateways' in b) {
    if (!b.gateways || typeof b.gateways !== 'object' || Array.isArray(b.gateways)) fields.gateways = 'باید یک شیء باشد';
    else {
      out.gateways = {};
      for (const [id, c] of Object.entries(b.gateways)) {
        if (!hasGateway(id)) { fields[`gateways.${id}`] = id === MOCK_ID ? 'درگاه آزمایشی در این محیط مجاز نیست' : 'درگاه ناشناخته'; continue; }
        if (!c || typeof c !== 'object' || Array.isArray(c)) { fields[`gateways.${id}`] = 'باید یک شیء باشد'; continue; }
        const entry = {};
        for (const k of ['enabled', 'sandbox']) {
          if (!(k in c)) continue;
          if (typeof c[k] !== 'boolean') fields[`gateways.${id}.${k}`] = 'باید true/false باشد';
          else entry[k] = c[k];
        }
        out.gateways[id] = entry;
      }
    }
  }
  if ('default' in b) {
    const dflt = String(b.default ?? '');
    if (dflt && !hasGateway(dflt)) fields.default = 'درگاه پیش‌فرض معتبر نیست';
    else out.default = dflt;
  }
  if ('relay_base' in b) {
    const r = String(b.relay_base ?? '').trim();
    if (r && !RELAY_RE.test(r)) fields.relay_base = 'آدرس رله باید با https:// شروع شود';
    else if (r.length > 300) fields.relay_base = 'آدرس رله بیش از حد بلند است';
    else out.relay_base = r.replace(/\/+$/, '');
  }
  if (Object.keys(fields).length) throw invalid(fields);
  return out;
}
export function writeGatewaysConfig(patch) {
  const cur = readGatewaysConfig();
  const next = { ...cur, gateways: { ...cur.gateways } };
  if (patch.gateways) for (const [id, e] of Object.entries(patch.gateways)) next.gateways[id] = { ...(cur.gateways[id] || { enabled: false, sandbox: false }), ...e };
  if ('default' in patch) next.default = patch.default;
  if ('relay_base' in patch) next.relay_base = patch.relay_base;
  if (next.default && !next.gateways[next.default]?.enabled) throw invalid({ default: 'درگاه پیش‌فرض باید فعال باشد' });
  const clean = normalizeGatewaysConfig(next);
  setSetting(GATEWAYS_KEY, clean);
  ensureGatewayCsp();   // the header is built before a route runs, so widen form-action now, not on first render
  return clean;
}

// enabled gateways in display order (default first); each with its adapter
export function enabledGateways() {
  const cfg = readGatewaysConfig();
  const list = gateways().filter(g => cfg.gateways[g.id]?.enabled);
  list.sort((a, b) => (a.id === cfg.default ? -1 : b.id === cfg.default ? 1 : 0));
  return list;
}

// form-action must allow the bank origins: registered on first pay-page
// render (not at import — the Foundation CSP test asserts the bare policy)
let cspDone = '';
export function ensureGatewayCsp() {
  const ids = enabledGateways().map(g => g.id).join(',');
  if (cspDone === ids) return;
  cspDone = ids;
  for (const g of enabledGateways()) for (const o of g.redirectOrigins || []) registerCspSource('form-action', o);
}

// ---- pay_config ------------------------------------------------------------
export const PAY_LIMITS = Object.freeze({ due_days: { min: 1, max: 180, dflt: 14 }, tax_percent: { min: 0, max: 25, dflt: 0 } });
export function defaultPayConfig() {
  return {
    due_days: PAY_LIMITS.due_days.dflt,
    tax_percent: PAY_LIMITS.tax_percent.dflt,
    offline_fa: 'در صورت تمایل به واریز بانکی، با ما تماس بگیرید تا شماره‌حساب و شبا را دریافت کنید و پس از واریز، تصویر رسید را برایمان بفرستید.',
    offline_en: 'To pay by bank transfer, contact us for the account and IBAN details and send us the transfer receipt afterwards.',
    show_enamad: true,
  };
}
const clampInt = (x, { min, max, dflt }) => { const n = Number(x); return Number.isInteger(n) ? Math.min(max, Math.max(min, n)) : dflt; };
export function normalizePayConfig(raw) {
  const d = defaultPayConfig();
  const s = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  return {
    due_days: clampInt(s.due_days, PAY_LIMITS.due_days),
    tax_percent: clampInt(s.tax_percent, PAY_LIMITS.tax_percent),
    offline_fa: typeof s.offline_fa === 'string' ? text(s.offline_fa, 1000) : d.offline_fa,
    offline_en: typeof s.offline_en === 'string' ? text(s.offline_en, 1000) : d.offline_en,
    show_enamad: typeof s.show_enamad === 'boolean' ? s.show_enamad : d.show_enamad,
  };
}
export const readPayConfig = () => normalizePayConfig(getSetting(PAY_KEY, null));
export function validatePayPatch(body) {
  const b = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  const fields = {}, out = {};
  for (const k of ['due_days', 'tax_percent']) {
    if (!(k in b)) continue;
    const n = typeof b[k] === 'string' && b[k].trim() !== '' ? Number(b[k]) : b[k];
    const lim = PAY_LIMITS[k];
    if (!Number.isInteger(n) || n < lim.min || n > lim.max) fields[k] = `باید عددی بین ${lim.min} و ${lim.max} باشد`;
    else out[k] = n;
  }
  for (const k of ['offline_fa', 'offline_en']) {
    if (!(k in b)) continue;
    if (typeof b[k] !== 'string' || b[k].length > 1000) fields[k] = 'متن باید حداکثر ۱۰۰۰ نویسه باشد';
    else out[k] = b[k].trim();
  }
  if ('show_enamad' in b) {
    if (typeof b.show_enamad !== 'boolean') fields.show_enamad = 'باید true/false باشد';
    else out.show_enamad = b.show_enamad;
  }
  if (Object.keys(fields).length) throw invalid(fields);
  return out;
}
export function writePayConfig(patch) {
  const clean = normalizePayConfig({ ...readPayConfig(), ...patch });
  setSetting(PAY_KEY, clean);
  return clean;
}
