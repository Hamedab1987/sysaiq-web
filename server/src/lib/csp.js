// Content-Security-Policy per response kind. Helmet's own CSP is off
// (app.js); every route family gets one of these instead:
//   api     JSON endpoints — nothing may load, nothing may frame them
//   upload  user images under /uploads — sandboxed, no scripts, plus nosniff
//   page    server-rendered pages — no inline scripts; inline <style> allowed
//   admin   the admin panel — like page, never framed, blob: images for previews
//   home    the home page — page policy + sha256 hashes of its inline scripts
//           from server/templates/manifest.json (written by build.py)
// Other workstreams add hosts with registerCspSource(directive, src)
// (trust seals → img-src, gateways → form-action…); they are merged into
// page/admin/home, never into api/upload.
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { cspSources } from './registry.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// exported for the test suite, which plants a manifest here
export const MANIFEST_PATH = join(__dirname, '..', '..', 'templates', 'manifest.json');

const KINDS = ['home', 'page', 'admin', 'api', 'upload'];

// directives every HTML page shares. Note: NO 'unsafe-inline' in script-src,
// anywhere — inline copy goes through esc()/renderInline(), data through
// <script type="application/json">.
function pageDirectives() {
  return {
    'default-src': ["'self'"],
    'script-src': ["'self'"],
    'style-src': ["'self'", "'unsafe-inline'"],
    // https: images are allowed: project covers may be external URLs and
    // images cannot execute script; trust-seal hosts are merged in from the registry
    'img-src': ["'self'", 'data:', 'https:'],
    'font-src': ["'self'"],
    'connect-src': ["'self'"],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'frame-ancestors': ["'self'"],
  };
}

// ---- manifest (home page inline-script hashes) --------------------------
// Re-read only when the file's mtime changes, so a rebuild is picked up
// without a restart and a request never costs more than one stat().
// hashes is null while the manifest is missing, unreadable, malformed or
// lists no valid hash: the home page then gets NO header — a policy with a
// bare script-src 'self' would block every inline script on the served
// page, which is worse than the status quo. Logged once per file version.
let manifest = { mtimeMs: -1, hashes: null };
export function resetCspCache() { manifest = { mtimeMs: -1, hashes: null }; }

function normHash(h) {
  const s = String(h || '').trim().replace(/^'|'$/g, '');
  if (!/^sha(256|384|512)-[A-Za-z0-9+/=_-]+$/.test(s)) return null;
  return `'${s}'`;
}

// → ["'sha256-…'", …] or null (no header)
function homeScriptHashes(path = MANIFEST_PATH) {
  let st;
  try { st = statSync(path); } catch { return null; } // no manifest yet
  if (st.mtimeMs === manifest.mtimeMs) return manifest.hashes;
  let hashes = null;
  try {
    const m = JSON.parse(readFileSync(path, 'utf8'));
    // accepted shapes: {scripts:[hash…]}, {csp:{script-src:[…]}}, {hashes:[…]}, [hash…]
    const raw = Array.isArray(m) ? m
      : Array.isArray(m?.scripts) ? m.scripts
        : Array.isArray(m?.hashes) ? m.hashes
          : Array.isArray(m?.csp?.['script-src']) ? m.csp['script-src'] : null;
    if (!raw) throw new Error('unrecognised shape (expected {scripts:[sha256-…]})');
    const list = raw.map(x => normHash(typeof x === 'string' ? x : x?.sha256 ? `sha256-${x.sha256}` : x?.hash)).filter(Boolean);
    if (!list.length) throw new Error('no valid sha256/384/512 hash listed');
    hashes = list;
  } catch (e) {
    console.error(`[csp] templates/manifest.json ignored, home page served without CSP: ${e?.message || e}`);
  }
  manifest = { mtimeMs: st.mtimeMs, hashes };
  return hashes;
}

// ---- builder ------------------------------------------------------------
function merge(directives, extra) {
  for (const [d, list] of Object.entries(extra || {})) {
    if (!directives[d]) continue; // only widen directives a page policy has
    for (const src of list) if (!directives[d].includes(src)) directives[d].push(src);
  }
}

const serialize = d => Object.entries(d).map(([k, v]) => (v.length ? `${k} ${v.join(' ')}` : k)).join('; ');

// → policy string, or null when the kind must not send a header (home
// before the manifest exists: the statically served baked page still has
// inline scripts we have no hashes for, and a wrong CSP would break it).
export function buildCsp(kind) {
  switch (kind) {
    case 'api':
      return "default-src 'none'; frame-ancestors 'none'";
    case 'upload':
      return "default-src 'none'; img-src 'self'; sandbox";
    case 'page': {
      const d = pageDirectives();
      merge(d, cspSources());
      return serialize(d);
    }
    case 'admin': {
      const d = pageDirectives();
      d['frame-ancestors'] = ["'none'"];
      d['img-src'].push('blob:');
      // TODO(admin-shell): remove script-src-attr once the new admin SPA lands —
      // the legacy server/admin/app.js still uses inline onclick="" handlers.
      // It only relaxes event-handler ATTRIBUTES; inline <script> stays blocked.
      d['script-src-attr'] = ["'unsafe-inline'"];
      merge(d, cspSources());
      return serialize(d);
    }
    case 'home': {
      const hashes = homeScriptHashes();
      if (hashes === null) return null; // manifest not built yet — see above
      const d = pageDirectives();
      d['script-src'].push(...hashes);
      merge(d, cspSources());
      return serialize(d);
    }
    default:
      throw new Error(`[csp] unknown kind "${kind}"`);
  }
}

export function cspMiddleware(kind) {
  if (!KINDS.includes(kind)) throw new Error(`[csp] unknown kind "${kind}"`);
  return (_req, res, next) => {
    const policy = buildCsp(kind);
    if (policy) res.setHeader('Content-Security-Policy', policy);
    if (kind === 'upload') res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  };
}

// The public site under /fa and /en: "/fa/" and "/en/" are the home page,
// everything below them is a server-rendered page. Mounted with
// app.use('/:lang(en|fa)', …), so the full path is baseUrl + path.
// The root "/" (static language-redirect stub) deliberately gets no policy.
const HOME_RE = /^\/(?:en|fa)(?:\/(?:index\.html)?)?$/;
export function siteCspMiddleware() {
  const home = cspMiddleware('home');
  const page = cspMiddleware('page');
  return (req, res, next) => (HOME_RE.test(req.baseUrl + req.path) ? home : page)(req, res, next);
}

