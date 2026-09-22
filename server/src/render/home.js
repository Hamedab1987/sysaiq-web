// Server-rendered home page: templates/home.<lang>.html (build.py "runtime"
// flavour) filled from the database.
//   renderHome('fa') → Promise<{html, etag}>   memoised per language until the
//                                              next admin write (lib/cache.js)
// One pass over the template with a function replacer, so a value that
// contains "{{X}}" or "$&" is inserted literally and never expanded again:
//   {{KEY}}      → content key: plain → esc(), inline → renderInline()
//   {{SLOT_X}}   → render/slots/x.js (any subset may exist while the team
//                  works in parallel; a missing module renders '')
//   {{SLOT_SITE_DATA}} → the #site-data JSON block (AI widget strings), here.
// Slot HTML is computed first (renderers may be async), then spliced in.
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { esc, jsonForScript } from '../lib/html.js';
import { renderInline } from '../lib/inline.js';
import { cached, invalidate } from '../lib/cache.js';
import { getContent, contentTypes, TEMPLATES_DIR } from '../lib/content.js';

export const TOKEN_RE = /\{\{([A-Z0-9_]+)\}\}/g;
const SLOT_PREFIX = 'SLOT_';
const LANGS = ['en', 'fa'];

export const templatePath = lang => join(TEMPLATES_DIR, `home.${lang}.html`);

// ---- template files ---------------------------------------------------------
// Re-read when the file's mtime changes (a rebuild while the server runs),
// one stat() per request. Throws ENOENT when build.py has not run — the
// route then falls through to the baked static page.
const templates = new Map(); // lang → {mtimeMs, text, slots}
function loadTemplate(lang) {
  const path = templatePath(lang);
  const st = statSync(path);
  const hit = templates.get(lang);
  if (hit && hit.mtimeMs === st.mtimeMs) return hit;
  const text = readFileSync(path, 'utf8');
  const slots = [...new Set([...text.matchAll(TOKEN_RE)].map(m => m[1]).filter(k => k.startsWith(SLOT_PREFIX)).map(k => k.slice(SLOT_PREFIX.length)))];
  const t = { mtimeMs: st.mtimeMs, text, slots };
  templates.set(lang, t);
  if (hit) invalidate('home:'); // rebuilt template: drop the memoised pages
  return t;
}

// ---- slot modules -------------------------------------------------------------
// A slot module exports renderSlot(lang) — or, for the modules written
// before that name settled, render({lang}) / default(lang). Callables that
// declare a parameter get the language string; a zero-arity signature
// (`({ lang = 'fa' } = {})`) gets an options object.
const slotFns = new Map(); // SLOT name → fn (successes only; a miss is retried next build)
function pickRenderer(mod) {
  for (const name of ['renderSlot', 'render', 'default']) if (typeof mod?.[name] === 'function') return mod[name];
  return null;
}
async function resolveSlot(name) {
  if (slotFns.has(name)) return slotFns.get(name);
  const file = `${name.toLowerCase()}.js`;
  let mod;
  try {
    mod = await import(`./slots/${file}`);
  } catch (e) {
    const missing = e?.code === 'ERR_MODULE_NOT_FOUND' && String(e?.message || '').includes(`/slots/${file}`);
    if (!missing) console.error(`[home] slot ${name} (render/slots/${file}) failed to load: ${e?.message || e}`);
    return null;
  }
  const fn = pickRenderer(mod);
  if (!fn) { console.error(`[home] slot ${name}: render/slots/${file} exports no renderSlot/render/default function`); return null; }
  slotFns.set(name, fn);
  return fn;
}
export function resetSlotCache() { slotFns.clear(); }

async function renderSlotHtml(name, lang, content) {
  if (name === 'SITE_DATA') return renderSiteData(content);
  const fn = await resolveSlot(name);
  if (!fn) return '';
  try {
    const out = await (fn.length >= 1 ? fn(lang, { content }) : fn({ lang, content }));
    return typeof out === 'string' ? out : '';
  } catch (e) {
    // one broken section must not take the whole home page (and the nginx
    // fallback would hide the owner's edits again); it is logged instead
    console.error(`[home] slot ${name} failed to render (${lang}): ${e?.stack || e}`);
    return '';
  }
}

// <script type="application/json" id="site-data"> read by the AI widget;
// jsonForScript() escapes "<" so "</script>" inside a value stays inert.
const AI_KEYS = { title: 'AI_TITLE', ready: 'AI_READY', ph: 'AI_PH', hi: 'AI_HI', teaser: 'AI_TEASER', err: 'AI_ERR' };
export function siteData(content) {
  const ai = {};
  for (const [k, key] of Object.entries(AI_KEYS)) ai[k] = String(content[key] ?? '');
  return { ai };
}
export function renderSiteData(content) {
  return `<script type="application/json" id="site-data">${jsonForScript(siteData(content))}</script>`;
}

// ---- page ------------------------------------------------------------------------
const sha1 = s => createHash('sha1').update(s).digest('hex');
const warnedTokens = new Set();

async function build(lang, tpl) {
  const content = getContent(lang);
  const types = contentTypes();
  const slotHtml = {};
  for (const name of tpl.slots) slotHtml[name] = await renderSlotHtml(name, lang, content);
  const html = tpl.text.replace(TOKEN_RE, (_m, key) => {
    if (key.startsWith(SLOT_PREFIX)) return slotHtml[key.slice(SLOT_PREFIX.length)] ?? '';
    if (!Object.hasOwn(content, key)) {
      if (!warnedTokens.has(key)) { warnedTokens.add(key); console.error(`[home] template token {{${key}}} has no content key (rebuild content-defaults.json?)`); }
      return '';
    }
    const v = content[key];
    return types[key] === 'inline' ? renderInline(v) : esc(v);
  });
  return Object.freeze({ html, etag: `"${sha1(html)}"` });
}

export function renderHome(lang) {
  const l = LANGS.includes(lang) ? lang : 'fa';
  const tpl = loadTemplate(l); // ENOENT propagates: no template, no SSR
  return cached(`home:${l}`, () => build(l, tpl).catch(e => { invalidate('home:'); throw e; }));
}
export default renderHome;
