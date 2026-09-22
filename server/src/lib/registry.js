// Process-wide registries that workstreams add to at import time:
//  - settings keys (allowlist for the generic settings API; `public` ones may be
//    served by /api/content),
//  - extra CSP sources (trust seals, gateways…),
//  - slugs reserved by routes so an admin can't create a page that shadows one.
// Registration is idempotent so a module imported twice does not double up.

const settings = new Map();   // key → {key, schema, public}
const csp = new Map();        // directive → Set(src)
const reserved = new Set();

export function registerSetting({ key, schema = null, public: isPublic = false } = {}) {
  if (!key || typeof key !== 'string') throw new Error('registerSetting: key required');
  settings.set(key, { key, schema, public: !!isPublic });
  return settings.get(key);
}
export const isRegisteredSetting = key => settings.has(key);
export const isPublicSetting = key => !!settings.get(key)?.public;
// keys that may be served to anonymous visitors
export const publicSettings = () => [...settings.values()].filter(s => s.public).map(s => s.key);

// Only directives that can't widen script execution, and only an https host
// (optionally *.wildcard, optionally :port) or the inert data:/blob: schemes.
// Anything else throws at import time: a src derived from an admin-entered
// host must not be able to inject "; script-src *" or 'unsafe-inline'.
const CSP_DIRECTIVES = Object.freeze(['img-src', 'font-src', 'style-src', 'connect-src', 'frame-src', 'form-action']);
const CSP_SRC = /^(?:data:|blob:|https:\/\/(?:\*\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+(?::\d{1,5})?)$/;

export function registerCspSource(directive, src) {
  if (!CSP_DIRECTIVES.includes(directive)) throw new Error(`registerCspSource: directive "${directive}" not allowed (${CSP_DIRECTIVES.join(', ')})`);
  const s = String(src ?? '').trim();
  if (!CSP_SRC.test(s)) throw new Error(`registerCspSource: "${s}" is not an https host, data: or blob:`);
  if (!csp.has(directive)) csp.set(directive, new Set());
  csp.get(directive).add(s);
}
export function cspSources(directive) {
  if (directive) return [...(csp.get(directive) || [])];
  const out = {};
  for (const [d, set] of csp) out[d] = [...set];
  return out;
}

export function reserveSlug(...slugs) {
  for (const s of slugs.flat()) reserved.add(String(s).toLowerCase());
}
export const isReservedSlug = s => reserved.has(String(s || '').toLowerCase());
