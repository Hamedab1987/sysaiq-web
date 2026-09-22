// Helpers shared by the provider adapters.
import { SmsError } from '../errors.js';

// first present key of an object, case-tolerant (Ghasedak answers camelCase
// in one version and PascalCase in another)
export function pick(obj, ...keys) {
  if (!obj || typeof obj !== 'object') return undefined;
  for (const k of keys) if (obj[k] !== undefined && obj[k] !== null) return obj[k];
  return undefined;
}

export const str = x => (x === undefined || x === null ? '' : String(x));
export const num = x => { const n = Number(x); return Number.isFinite(n) ? n : null; };

// transport-level answer with no usable body → error by HTTP status
export function httpStatusError(provider, r, message) {
  const s = Number(r?.status) || 0;
  const code = s === 401 || s === 403 ? 'auth'
    : s === 429 ? 'rate_limited'
      : s >= 500 ? 'server_error'
        : s === 400 || s === 422 ? 'validation'
          : s === 404 ? 'bad_response'
            : 'unknown';
  return new SmsError(code, { provider, message: message || `HTTP ${s}`, raw: r?.data ?? r?.text ?? null });
}

// value map for pattern params: entry[mapKey] = {ourVar: providerName} or
// missing → same names. Returns [{key, name, value}] in declaration order
// (`key` is our variable name, `name` the provider's).
export function mapParams(params, mapping) {
  const out = [];
  for (const [key, value] of Object.entries(params || {})) {
    const name = mapping && typeof mapping === 'object' && mapping[key] ? String(mapping[key]) : key;
    out.push({ key, name, value: str(value) });
  }
  return out;
}

// variables that are free text (a person's name, a service label): a provider
// length cap may shorten them. Everything else (codes, invoice numbers,
// amounts, phone numbers, references) must never be cut.
export const FREE_TEXT_VARS = Object.freeze(new Set(['name', 'service', 'status']));

// keep the first `max` characters and end with «…» when something was dropped
export function truncateText(value, max) {
  const chars = [...str(value)];
  return chars.length <= max ? chars.join('') : `${chars.slice(0, Math.max(0, max - 1)).join('').trimEnd()}…`;
}

// required pattern-map field check shared by validateMap()
export function requireField(entry, field, label) {
  const v = entry?.[field];
  if (v === undefined || v === null || String(v).trim() === '') return `${label} الزامی است`;
  return null;
}
