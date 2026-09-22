// Home-page copy: build.py defaults (templates/content-defaults.json) merged
// with the owner's overrides in the `content` table (migration 004).
//   getContent('fa')  → {KEY: string}   value = override ?? default ('' = blank on purpose)
//   listContent()     → what the admin «متن‌های سایت» view renders (groups in page order)
//   setContent(key, {en?, fa?}, admin) / resetContent(key, admin) / createCustomKey(...)
// Every write records a revision and calls invalidate() so the memoised
// home page is rebuilt on the next request — the whole point of the rebuild
// ("I save text in the admin and the site never changes").
// Text is stored raw; escaping happens at render time (esc / renderInline),
// so a value can never smuggle HTML into the page.
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { db, setSetting } from '../db/index.js';
import { cached, invalidate } from './cache.js';
import { HttpError } from './errors.js';
import { on } from './events.js';
import { LEGACY_MAP, LEGACY_SEED } from '../db/migrations/004_content.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const TEMPLATES_DIR = join(__dirname, '..', '..', 'templates');
export const DEFAULTS_PATH = join(TEMPLATES_DIR, 'content-defaults.json');

export const LANGS = Object.freeze(['en', 'fa']);
export const TYPES = Object.freeze(['plain', 'inline']);
export const KEY_RE = /^[A-Z0-9_]{1,64}$/;          // any key the table accepts
export const CUSTOM_KEY_RE = /^X_[A-Z0-9_]{2,40}$/;  // owner-created keys
export const CUSTOM_MAX = 2000;                      // chars per language for custom keys
export const CUSTOM_GROUP = 'کلیدهای سفارشی';

// Keys build.py lists only because the baked page needed them: at runtime
// the showcase rows come from `projects` and the FAQ items from `faqs`, so
// W1..W9_{T,D,G} and Q1../A1.. are not content — they are hidden from the
// API and refused on write (WORK_H2/WORK_HINT/WORK_ALL/FAQ_H2 stay).
const TABLE_BACKED_RE = /^(?:W\d+_[A-Z]+|Q\d+|A\d+)$/;
const isTableBacked = (key, d) => TABLE_BACKED_RE.test(key) && /^slot:(WORK|FAQ)$/.test(String(d?.source || ''));
const TABLE_HINT = { WORK: 'rendered from the projects table — edit it under «پروژه‌ها»', FAQ: 'rendered from the faqs table — edit it under «سؤالات متداول»' };

// ---- defaults file --------------------------------------------------------
// Re-read only when its mtime changes (build.py rewrites it on every build).
let defaultsCache = { mtimeMs: -1, keys: {}, groups: [], tableBacked: {}, warned: false };
export function contentDefaults() {
  let st;
  try { st = statSync(DEFAULTS_PATH); } catch {
    if (!defaultsCache.warned) {
      defaultsCache.warned = true;
      console.error(`[content] ${DEFAULTS_PATH} is missing — run "python3 build.py" in vesper-project; home copy falls back to empty strings`);
    }
    return defaultsCache;
  }
  if (st.mtimeMs === defaultsCache.mtimeMs) return defaultsCache;
  let keys = {};
  const tableBacked = {};
  try {
    const raw = JSON.parse(readFileSync(DEFAULTS_PATH, 'utf8'));
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      for (const [k, d] of Object.entries(raw)) {
        if (!KEY_RE.test(k) || !d || typeof d !== 'object') continue;
        if (isTableBacked(k, d)) { tableBacked[k] = TABLE_HINT[d.source.slice(5)]; continue; }
        keys[k] = {
          en: typeof d.en === 'string' ? d.en : '',
          fa: typeof d.fa === 'string' ? d.fa : '',
          type: TYPES.includes(d.type) ? d.type : 'plain',
          group: String(d.group || ''),
          label_fa: String(d.label_fa || k),
          label_en: String(d.label_en || k),
          max: Number.isInteger(d.max) && d.max > 0 ? d.max : 1000,
          anchor: String(d.anchor || ''),
          order: Number.isFinite(d.order) ? d.order : 0,
          source: String(d.source || 'token'),
        };
      }
    }
  } catch (e) {
    console.error(`[content] ${DEFAULTS_PATH} unreadable: ${e?.message || e}`);
    keys = {};
  }
  // group names in page order (first appearance by `order`)
  const groups = [];
  for (const d of Object.values(keys).sort((a, b) => a.order - b.order)) if (d.group && !groups.includes(d.group)) groups.push(d.group);
  defaultsCache = { mtimeMs: st.mtimeMs, keys, groups, tableBacked, warned: false };
  invalidate('content:'); // a rebuilt defaults file changes every derived map
  return defaultsCache;
}
export const isRegisteredKey = key => Object.hasOwn(contentDefaults().keys, key);

// ---- reads ---------------------------------------------------------------------
const allRows = () => db.prepare('SELECT key, en, fa, is_custom, label_fa, label_en, type, updated_at, updated_by FROM content ORDER BY rowid').all();
const getRow = key => db.prepare('SELECT key, en, fa, is_custom, label_fa, label_en, type, updated_at, updated_by FROM content WHERE key=?').get(key);

// {KEY: string} for one language — every registered key plus every custom key
export function getContent(lang) {
  const l = lang === 'en' ? 'en' : 'fa';
  return cached(`content:${l}`, () => {
    const { keys } = contentDefaults();
    const out = {};
    for (const [k, d] of Object.entries(keys)) out[k] = d[l];
    for (const r of allRows()) {
      if (r[l] !== null && r[l] !== undefined) out[r.key] = String(r[l]);
      else if (!Object.hasOwn(out, r.key)) out[r.key] = ''; // custom key with no value yet
    }
    return Object.freeze(out);
  });
}

// {KEY: 'plain'|'inline'} — how the renderer must treat each key
export function contentTypes() {
  return cached('content:types', () => {
    const out = {};
    for (const [k, d] of Object.entries(contentDefaults().keys)) out[k] = d.type;
    for (const r of allRows()) if (r.is_custom) out[r.key] = TYPES.includes(r.type) ? r.type : 'plain';
    return Object.freeze(out);
  });
}

// registered meta or the custom row's meta, or null when the key is unknown
// (own properties only: "constructor" or "__proto__" is not a registered key)
export function keyMeta(key) {
  const { keys } = contentDefaults();
  const d = Object.hasOwn(keys, key) ? keys[key] : undefined;
  if (d) return { ...d, is_custom: 0 };
  const r = getRow(key);
  if (!r || !r.is_custom) return null;
  return {
    en: '', fa: '', type: TYPES.includes(r.type) ? r.type : 'plain', group: CUSTOM_GROUP,
    label_fa: r.label_fa || key, label_en: r.label_en || key, max: CUSTOM_MAX, anchor: '', order: 0, source: 'custom', is_custom: 1,
  };
}

function record(key, meta, row) {
  const has = row && (row.en !== null || row.fa !== null);
  return {
    key,
    group: meta.group, label_fa: meta.label_fa, label_en: meta.label_en, type: meta.type, max: meta.max,
    anchor: meta.anchor, order: meta.order, source: meta.source,
    default: { en: meta.en, fa: meta.fa },
    value: has ? { en: row.en, fa: row.fa } : null,
    is_custom: meta.is_custom,
    updated_at: row?.updated_at || null,
    updated_by: row?.updated_by || '',
  };
}

export function getContentRecord(key) {
  return record(key, checkKey(key), getRow(key));
}

export function listContent() {
  const { keys: defs, groups } = contentDefaults();
  const rows = new Map(allRows().map(r => [r.key, r]));
  const keys = Object.entries(defs)
    .sort((a, b) => a[1].order - b[1].order)
    .map(([k, d]) => record(k, { ...d, is_custom: 0 }, rows.get(k)));
  let customOrder = 1e6;
  for (const r of rows.values()) {
    if (!r.is_custom || Object.hasOwn(defs, r.key)) continue;
    keys.push(record(r.key, { ...keyMeta(r.key), order: customOrder++ }, r));
  }
  const byGroup = new Map(groups.map(g => [g, []]));
  for (const k of keys) {
    if (!byGroup.has(k.group)) byGroup.set(k.group, []);
    byGroup.get(k.group).push(k.key);
  }
  return {
    groups: [...byGroup].filter(([, list]) => list.length).map(([name, list]) => ({ name, keys: list })),
    keys,
  };
}

export function getRevisions(key, limit = 50) {
  checkKey(key);
  return db.prepare('SELECT id, key, en, fa, at, admin_id FROM content_revisions WHERE key=? ORDER BY id DESC LIMIT ?')
    .all(key, Math.min(Math.max(Number(limit) || 50, 1), 500));
}

// ---- writes -------------------------------------------------------------------
// C0 controls except \n and \t, plus DEL; CRLF → LF first
// (built from String escapes on purpose: a raw control byte in a regex literal makes git treat the file as binary)
const CONTROL_RE = new RegExp('[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F]', 'g');
export const cleanText = s => String(s).replace(/\r\n?/g, '\n').replace(CONTROL_RE, '');

const adminName = a => (a && typeof a === 'object' ? String(a.u ?? a.username ?? '') : (a === undefined || a === null ? '' : String(a)));
const adminId = a => {
  if (Number.isInteger(a)) return a;
  const id = a && typeof a === 'object' ? a.uid ?? a.id : null;
  return Number.isInteger(id) ? id : null;
};

// Validates one {en?, fa?} patch. Returns {en?, fa?} with only the languages
// present (string or null); collects problems into `fields` under `prefix`.
function cleanPatch(patch, max, fields, prefix = '') {
  const out = {};
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    fields[`${prefix}value`] = 'body must be an object with en and/or fa';
    return out;
  }
  for (const lang of LANGS) {
    if (!Object.hasOwn(patch, lang) || patch[lang] === undefined) continue;
    const raw = patch[lang];
    if (raw === null) { out[lang] = null; continue; }
    if (typeof raw !== 'string') { fields[`${prefix}${lang}`] = `${lang} must be a string or null`; continue; }
    const s = cleanText(raw);
    if (s.length > max) { fields[`${prefix}${lang}`] = `${lang} must be at most ${max} characters`; continue; }
    out[lang] = s;
  }
  if (!Object.keys(out).length && !Object.keys(fields).some(f => f.startsWith(prefix))) {
    fields[`${prefix}value`] = 'en or fa is required';
  }
  return out;
}

const upsert = db.prepare(`INSERT INTO content (key, en, fa, is_custom, label_fa, label_en, type, updated_at, updated_by)
  VALUES (@key, @en, @fa, @is_custom, @label_fa, @label_en, @type, datetime('now'), @updated_by)
  ON CONFLICT(key) DO UPDATE SET en=excluded.en, fa=excluded.fa, updated_at=datetime('now'), updated_by=excluded.updated_by`);
const addRevision = db.prepare('INSERT INTO content_revisions (key, en, fa, admin_id) VALUES (?, ?, ?, ?)');

// one validated patch → row + revision (inside the caller's transaction).
// syncLegacy: keep the mirrored settings row in step — off only for writes
// that came FROM that row (the settings route owns what it stores).
function apply(key, meta, patch, admin, syncLegacy = true) {
  const cur = getRow(key);
  const en = Object.hasOwn(patch, 'en') ? patch.en : (cur?.en ?? null);
  const fa = Object.hasOwn(patch, 'fa') ? patch.fa : (cur?.fa ?? null);
  upsert.run({
    key, en, fa, is_custom: meta.is_custom,
    label_fa: cur?.label_fa ?? (meta.is_custom ? meta.label_fa : ''),
    label_en: cur?.label_en ?? (meta.is_custom ? meta.label_en : ''),
    type: meta.is_custom ? meta.type : 'plain',
    updated_by: adminName(admin),
  });
  addRevision.run(key, en, fa, adminId(admin));
  if (syncLegacy) syncLegacySetting(key);
}

function checkKey(key) {
  if (!KEY_RE.test(String(key))) throw new HttpError(422, 'validation', 'Validation failed', { key: 'key must be 1–64 characters of A–Z, 0–9 and _' });
  const meta = keyMeta(key);
  if (!meta) throw new HttpError(404, 'not_found', `Unknown content key "${key}"`);
  return meta;
}

// setContent('HERO_H1', {fa: 'سلام'}, req.admin) → the updated record.
// A language left out is untouched; null resets that language to the default.
// The key's own `max` is the only cap — nothing may store what the admin
// view could not re-save.
export function setContent(key, patch, admin, { syncLegacy = true } = {}) {
  const meta = checkKey(key);
  const fields = {};
  const clean = cleanPatch(patch, meta.max, fields);
  if (Object.keys(fields).length) throw new HttpError(422, 'validation', 'Validation failed', fields);
  db.transaction(() => apply(key, meta, clean, admin, syncLegacy))();
  invalidate();
  return record(key, meta, getRow(key));
}

// PUT /content {items:[{key, en?, fa?}]} — all or nothing
export function setContentBulk(items, admin) {
  if (!Array.isArray(items)) throw new HttpError(422, 'validation', 'Validation failed', { items: 'items must be an array' });
  if (items.length > 500) throw new HttpError(422, 'validation', 'Validation failed', { items: 'at most 500 items per request' });
  const fields = {};
  const plan = [];
  items.forEach((item, i) => {
    const p = `items[${i}].`;
    const key = item && typeof item === 'object' ? String(item.key ?? '') : '';
    if (!KEY_RE.test(key)) { fields[`${p}key`] = 'key must be 1–64 characters of A–Z, 0–9 and _'; return; }
    const meta = keyMeta(key);
    if (!meta) { fields[`${p}key`] = `unknown content key "${key}"`; return; }
    const clean = cleanPatch(item, meta.max, fields, p);
    plan.push({ key, meta, clean });
  });
  if (Object.keys(fields).length) throw new HttpError(422, 'validation', 'Validation failed', fields);
  db.transaction(() => { for (const { key, meta, clean } of plan) apply(key, meta, clean, admin); })();
  invalidate();
  return plan.map(({ key, meta }) => record(key, meta, getRow(key)));
}

// back to the build.py default in both languages ('' for a custom key)
export function resetContent(key, admin) {
  const meta = checkKey(key);
  const cur = getRow(key);
  if (cur) db.transaction(() => apply(key, meta, { en: null, fa: null }, admin))();
  else syncLegacySetting(key); // no override, but a stale legacy row may still say otherwise
  invalidate();
  return record(key, meta, getRow(key));
}

// remove an owner-created key entirely (registered keys can only be reset)
export function purgeCustomKey(key) {
  const meta = checkKey(key);
  if (!meta.is_custom) throw new HttpError(422, 'validation', 'Validation failed', { purge: 'only custom (X_*) keys can be removed; registered keys are reset' });
  db.transaction(() => {
    db.prepare('DELETE FROM content_revisions WHERE key=?').run(key);
    db.prepare('DELETE FROM content WHERE key=?').run(key);
  })();
  invalidate();
  return { key, removed: true };
}

// createCustomKey({key:'X_PROMO', label_fa:'…', label_en:'…', type:'plain', en?, fa?}, admin)
export function createCustomKey(input, admin) {
  const b = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const fields = {};
  const key = String(b.key ?? '').trim();
  if (!CUSTOM_KEY_RE.test(key)) fields.key = 'key must match X_[A-Z0-9_]{2,40}';
  const label_fa = String(b.label_fa ?? '').trim();
  const label_en = String(b.label_en ?? '').trim();
  if (!label_fa) fields.label_fa = 'label_fa is required';
  if (label_fa.length > 120) fields.label_fa = 'label_fa must be at most 120 characters';
  if (label_en.length > 120) fields.label_en = 'label_en must be at most 120 characters';
  const type = b.type === undefined || b.type === '' ? 'plain' : b.type;
  if (!TYPES.includes(type)) fields.type = `type must be one of: ${TYPES.join(', ')}`;
  const hasValue = Object.hasOwn(b, 'en') || Object.hasOwn(b, 'fa');
  const clean = hasValue ? cleanPatch(b, CUSTOM_MAX, fields) : {};
  if (Object.keys(fields).length) throw new HttpError(422, 'validation', 'Validation failed', fields);
  if (keyMeta(key)) throw new HttpError(409, 'conflict', `Content key "${key}" already exists`, { key: 'already used' });

  const meta = { en: '', fa: '', type, group: CUSTOM_GROUP, label_fa, label_en: label_en || key, max: CUSTOM_MAX, anchor: '', order: 0, source: 'custom', is_custom: 1 };
  db.transaction(() => {
    db.prepare(`INSERT INTO content (key, en, fa, is_custom, label_fa, label_en, type, updated_by)
      VALUES (?, NULL, NULL, 1, ?, ?, ?, ?)`).run(key, label_fa, meta.label_en, type, adminName(admin));
    if (hasValue) apply(key, meta, clean, admin);
  })();
  invalidate();
  return record(key, meta, getRow(key));
}

// ---- legacy settings bridge ---------------------------------------------------
// The old admin's «Content» tab still PUTs /api/admin/settings/hero_h1 …
// (routes/admin/settings.routes.js, another owner's file) and GET /api/content
// still serves those rows. The bridge keeps both worlds saying the same thing:
//   settings → content   mirrorLegacySetting('hero_h1', {en, fa}, admin), driven by
//                        the content.changed event the admin mounter emits after
//                        every 2xx write (or callable by the settings route directly);
//   content → settings   syncLegacySetting(KEY) after every write that came from the
//                        new admin, so a reset puts the seed.js wording back into the
//                        legacy row and the old tab never shows text the site no
//                        longer renders. Writes that came THROUGH the settings route
//                        leave its row exactly as it stored it (that route's contract:
//                        whitespace kept, a missing body stored as {en:'', fa:''}).
// A legacy field that is blank or equal to the seed means "follow the default"
// (the same rule migration 004 used for the import); an all-blank patch is
// the old route's default for a missing body and must not blank the hero.
// The old route accepts 5000 chars, the key's own cap is what the new admin
// can re-save: a language over that cap is not mirrored (logged, the site
// keeps its copy) rather than stored where the owner could never edit it.
const LEGACY_KEY_OF = Object.freeze(Object.fromEntries(Object.entries(LEGACY_MAP).map(([l, k]) => [k, l])));
const norm = s => String(s ?? '').replace(/\s+/g, ' ').trim();

// write the effective copy of a mirrored key into its settings row (only when
// that row exists and differs — the seed creates it, nothing else should)
export function syncLegacySetting(key) {
  const legacyKey = LEGACY_KEY_OF[key];
  if (!legacyKey) return false;
  const stored = db.prepare('SELECT value FROM settings WHERE key=?').get(legacyKey);
  if (!stored) return false;
  const row = getRow(key);
  const seed = LEGACY_SEED[legacyKey];
  const next = {};
  for (const lang of LANGS) next[lang] = typeof row?.[lang] === 'string' ? row[lang] : seed[lang];
  let cur = null;
  try { cur = JSON.parse(stored.value); } catch { /* unreadable → rewrite */ }
  if (cur && typeof cur === 'object' && LANGS.every(l => cur[l] === next[l])) return false;
  setSetting(legacyKey, next);
  return true;
}

export function mirrorLegacySetting(legacyKey, value, admin) {
  const key = LEGACY_MAP[legacyKey];
  if (!key || !value || typeof value !== 'object' || Array.isArray(value) || !isRegisteredKey(key)) return null;
  const seed = LEGACY_SEED[legacyKey];
  const { max } = keyMeta(key);
  const patch = {};
  let provided = 0, blank = 0;
  for (const lang of LANGS) {
    if (typeof value[lang] !== 'string') continue;
    provided++;
    const s = cleanText(value[lang]);
    if (!s.trim()) { blank++; patch[lang] = null; continue; }
    if (norm(s) === norm(seed[lang])) { patch[lang] = null; continue; }
    if (s.length > max) {
      console.error(`[content] legacy settings.${legacyKey}.${lang} (${s.length} chars) exceeds ${key}'s cap of ${max} — not mirrored, the site keeps its ${lang} copy`);
      provided--; // treated as not sent: the other language still goes through
      continue;
    }
    patch[lang] = s;
  }
  if (!provided || blank === provided) return null; // nothing, or all blank: the site keeps its copy
  return setContent(key, patch, admin, { syncLegacy: false });
}

// the mounter's payload only carries the username; resolve the id so the
// revision row is attributable (a renamed/removed admin → null, as before)
const adminByName = db.prepare('SELECT id FROM admins WHERE username=?');
on('content.changed', p => {
  if (p?.entity !== 'settings' || !LEGACY_MAP[p.entityId]) return;
  const row = db.prepare('SELECT value FROM settings WHERE key=?').get(p.entityId);
  if (!row) return;
  let value = null;
  try { value = JSON.parse(row.value); } catch { return; }
  const u = String(p.admin || '');
  const id = u ? adminByName.get(u)?.id : undefined;
  mirrorLegacySetting(p.entityId, value, { u, uid: Number.isInteger(id) ? id : null });
});
