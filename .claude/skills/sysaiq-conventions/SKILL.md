---
name: sysaiq-conventions
description: Architecture contracts for the SysaiQ site rebuild (server layout, module signatures, migrations, auto-discovered routes/views, security rules, tests, file ownership). Read before writing any server/ or admin code in this repo.
---

# SysaiQ — team conventions (binding contract)

Master plan: `/Users/hamedabooali/.claude/plans/lucky-crafting-duckling.md`.
Repo root: `/Users/hamedabooali/sysaiq web`. Two halves: `vesper-project/` (static
landing built by `build.py`) and `server/` (Express 4 + better-sqlite3, ESM, Node ≥20,
no build step, no TypeScript). The owner is non-technical and reads Persian.

## Golden rules
1. **Only touch files you own** (your brief lists them). Shared files are owned by
   Foundation; if you need a new primitive, say so in your report — never patch
   another owner's file.
2. **No new runtime dependencies** unless your brief names them. Node has global `fetch`.
3. **Never store or render raw HTML from the admin.** Plain text → `esc()`. Inline
   copy → `renderInline()` mini-markup. Long bodies → `renderMarkdown()` subset.
   Trust seals → parsed into id/code and re-rendered (`lib/trust.js`).
4. **Secrets** (API keys, merchant ids, passwords) live ONLY in the `secrets` table via
   `lib/secrets.js`. Never in `settings`, never in logs, never returned by any API
   (admin gets `{configured, hint}` only).
5. **No inline event handlers and no inline `<script>`** in anything new (CSP is on).
   JSON data blocks are fine (`<script type="application/json">`, with `<` → `<`).
6. **Bilingual always**: every user-facing string has `en` + `fa`. Persian is written
   natively. Never fabricate prices, timelines, client names, testimonials, counts,
   certifications. Unknown owner policy values stay `⟦…⟧`.
7. Migrations are **additive only** (no DROP/RENAME) so a code rollback stays safe.
8. Match the existing code style: small modules, terse comments explaining *why*,
   2-space indent, single quotes, semicolons.

## Server layout
```
server/
  package.json  package-lock.json  .env.example
  templates/                 build.py output: home.{en,fa}.html, content-defaults.json, manifest.json
  content/                   authored content (pages/*.md, services/*.json, projects/*.json)
  test/                      node:test files (*.test.js) + helpers.js
  scripts/                   one-off CLIs (content apply, secrets rotate, fa-lint)
  admin/                     admin SPA (index.html, admin.css, icons.svg, js/…)
  src/
    index.js                 boot only: config → createApp() → listen(127.0.0.1)
    app.js                   export async function createApp() → express app (NO listen)
    config.js                env parsing; production fail-fast
    db.js                    compat re-export of db/index.js (old imports keep working)
    db/index.js              db handle + getSetting/setSetting/allSettings
    db/migrate.js            runMigrations(db)
    db/migrations/NNN_name.js
    lib/*.js                 shared libraries (below)
    middleware/{auth,csrf}.js
    routes/public/*.routes.js   routes/admin/*.routes.js     (auto-mounted)
    render/*.js  render/slots/*.js                           (SSR)
    payments/  sms/  news/                                   (workstreams)
    ai.js  mail.js  auth.js(seed-compatible re-exports)  seed.js
```

### Migrations — `server/src/db/migrations/NNN_name.js`
```js
export const version = 4;            // integer, equals NNN
export const name = 'content';
export function up(db, ctx) { db.exec(`CREATE TABLE …`); }   // runs inside a transaction
```
Runner applies every unapplied version in ascending order and records it in
`schema_migrations(version PK, name, applied_at)`. Guard ALTERs with
`ctx.hasColumn(table, col)` / `ctx.hasTable(name)`. **Number ranges:** core 001–099 · SMS 100–199 ·
payments 200–299 · admin-only 300–399 · news 400–499. Never reuse a number.
**Import rule for migration files:** `db/index.js` top-level-awaits the runner, so a
migration must NEVER import `db/index.js` or anything that imports it (`lib/secrets.js`,
`lib/audit.js`, `lib/leads.js`, `middleware/auth.js`, …) — that deadlocks the ESM graph at
boot. Use the `db` argument and import only `config.js` and pure helpers
(`lib/secrets-crypto.js`, `lib/normalize.js`, `lib/html.js`). Read the existing
`002_secrets.js` as the model.

### Auto-mounted routes
A file `routes/public/x.routes.js` or `routes/admin/x.routes.js` default-exports:
```js
export default { basePath: '/pages', order: 50, router };   // express.Router()
```
- admin routers mount under `/api/admin` + basePath, already behind
  `requireAdmin` + `csrfGuard` + audit + cache-invalidate-on-2xx-write.
- public routers mount at `basePath` as given (e.g. `/api/leads`, `/:lang(en|fa)/services`).
- `order` (default 100) — lower mounts first. The catch-all page route uses 900.
- Use `asyncHandler(fn)`; throw `new HttpError(status, code, message, fields?)`.
  Error JSON shape: `{error, message, fields?}`; validation → 422.

### Shared libraries (signatures are fixed)
| Module | Exports |
|---|---|
| `lib/errors.js` | `HttpError`, `asyncHandler(fn)`, `errorMiddleware` |
| `lib/validate.js` | `v.str({min,max,trim})`, `v.int({min,max})`, `v.bool()`, `v.oneOf([...])`, `v.slug()`, `v.url({https})`, `v.email()`, `v.json(schema)`, `v.optional(x)`, `validate(schema, body)` → value or throws HttpError 422 with `fields` |
| `lib/secrets.js` | `registerSecret({name,label_fa,label_en,group,envFallback?,validate?})`, `getSecret(name)` → string\|null, `setSecret(name,value,adminId?)`, `deleteSecret(name)`, `hasSecret(name)` (same answer as `getSecret`), `listSecrets()` → `[{name,labels,group,configured,hint,source,updated_at}]` with `source` ∈ `db\|env\|unreadable\|none` (`unreadable` = row no longer decrypts, owner must re-enter), `maskSecret(v)` → `'••••1a2b'` |
| `lib/registry.js` | `registerSetting({key,schema,public})`, `isRegisteredSetting(key)`, `publicSettings()`, `registerCspSource(directive, src)`, `cspSources()`, `reserveSlug(...slugs)`, `isReservedSlug(s)` |
| `lib/cache.js` | `cached(key, fn)`, `invalidate(prefix?)`, `cacheVersion()` |
| `lib/events.js` | `on(evt, fn)`, `emit(evt, payload)` — listeners run in `queueMicrotask` inside try/catch; events: `lead.created`, `content.changed`, `invoice.sent`, `payment.succeeded`, `payment.failed`, `payment.orphaned`, `news.drafted` |
| `lib/audit.js` | `audit(req, action, entity, entityId, summary?, meta?)` |
| `lib/csp.js` | `buildCsp(kind)` kinds: `home`,`page`,`admin`,`api`,`upload`; `cspMiddleware(kind)` |
| `lib/html.js` | `esc(s)`, `attr(s)`, `jsonForScript(obj)`, `J(str, dflt)` |
| `lib/inline.js` | `renderInline(text)` (escape → `\n`→`<br>`, `*x*`→`<em>`, `**x**`→`<strong>`) |
| `lib/markdown.js` | `renderMarkdown(md, {tokens})` escape-first subset (h2–h4, p, ul/ol, strong/em/code, blockquote, hr, tables, links https/http/mailto/tel/relative), `LIMITS` `{input, line, depth}` |
| `lib/normalize.js` | `toLatinDigits(s)`, `toFaDigits(s)`, `normalizeMobile(s)` → `'09xxxxxxxxx'`\|null, `toE164(m)`, `parseTomanInput(s)` |
| `lib/http.js` | `httpJson({url,method,headers,body,timeoutMs,redactUrl,allowHosts?})`, `httpForm(...)`, `isPrivateAddress(ip)` — relay-aware, DNS-checked SSRF guard, logs `{provider,op,status,ms}` only |
| `middleware/auth.js` | `requireAdmin`, `issueCookie`, `clearCookie`, `verifyLogin`, `createAdmin` |
| `middleware/csrf.js` | `csrfGuard` (non-GET: Origin/Referer allowlist + `X-Requested-With: sysaiq-admin`) |

`config.js` exports `config = { env, isProd, port, dataDir, uploadDir, siteDir,
publicBaseUrl, jwtSecret, secretsKey, allowedOrigins }`. In production a missing
`JWT_SECRET`, `SECRETS_KEY` (32 bytes, base64/hex) or weak default throws at boot.
In dev/test, random values are generated (and logged once).

### SSR pages
`render/layout.js` exports `renderLayout({lang, title, description, canonicalPath,
head?, body, noindex?, jsonld?, bodyClass?})` — shared header (brand, nav, language
switch, CTA), footer (5 columns + trust strip + legal links), Vazirmatn for fa,
`dir="rtl"`, hreflang en/fa/x-default, links `/assets/site/pages.css` and
`/assets/site/pages.js` (no inline script). Design tokens: `--mint #7dffd9`,
`--violet #8b6bff`, `--ink #eceaf6`, `--bg #070a12`, `--panel #0e1422`,
gradient `linear-gradient(135deg,var(--mint),var(--violet))`. Mono LTR eyebrows
`[ SYSAIQ—NAME / SYS.0N ]` carry `dir="ltr"`. **No letter-spacing / uppercase on
Persian text.** Use CSS logical properties.

### Admin SPA (Persian, RTL, vanilla ES modules, no build)
`server/admin/js/views/<name>.view.js`:
```js
export default { title: 'سرنخ‌ها', async mount(root, ctx) { … return cleanupFn; }, isDirty() { … } };
```
`ctx = {api, ui, router, store, STR, params}`. Views import only from
`../ui.js`, `../api.js`, `../strings.js`. Never edit `ui.js`, `admin.css`,
`nav.js`, `icons.svg` (Foundation/admin-shell owner). Events via
`ui.on(root, evt, selector, fn)`. Display Persian digits, store Latin digits.
Dates: `ui.formatJalali()`. Money: `ui.formatToman()`.

## Security checklist (every PR)
- Public routes: validate + length-cap every field; rate-limit writes.
- Admin routes: behind the auto-mounter (never mount your own `/api/admin/*`).
- Any URL you fetch server-side: https only, fixed host allowlist or SSRF guard
  (block private/loopback/link-local IPs), timeout, size cap.
- Any URL you render: validated scheme; external links get `rel="noopener noreferrer"`.
- Redirects never use user input or the `Host` header — use `config.publicBaseUrl`.
- Log redaction: never log request bodies, secrets, URLs containing API keys, or a
  visitor's personal data (email, phone, name) — log the lead/record id instead.
- Markdown/inline renderers (`lib/markdown.js`, `lib/inline.js`) are the only way
  external text reaches HTML; `renderMarkdown` caps input at `LIMITS.input`
  (256 KB), lines at `LIMITS.line` (8 KB) and nesting at `LIMITS.depth` (8) —
  validate upstream if you need to refuse rather than truncate.
- `registerCspSource(directive, src)` accepts only img/font/style/connect/frame-src
  and form-action, and only `https://host[:port]`, `https://*.host`, `data:` or
  `blob:` — it throws on anything else, so never feed it raw admin input.
- `lib/http.js` refuses any host (or relay base) that resolves to a private,
  loopback, link-local or CGNAT address; pass `allowHosts: [...]` to pin a provider.

## Tests
`cd server && npm test` → `node --test test/**/*.test.js`. Test files MUST live exactly
one level down, `server/test/<area>/*.test.js` (the shell expands the glob one level;
a file directly in `test/` or two levels deep is silently skipped). Each test file is
its own process:
```js
import { startTestApp } from './helpers.js';
const t = await startTestApp();           // temp DATA_DIR, NODE_ENV=test, listens on :0
const r = await fetch(t.base + '/api/content');
await t.loginAsAdmin();                   // t.fetchAdmin(path, opts) adds cookie + CSRF headers
await t.close();
```
Every workstream ships tests for its own files under `server/test/<area>/`.
A change is "done" only when `npm test` passes and the owner-visible behaviour
was exercised (browser preview for UI work).

## Reporting back (what the supervisor expects)
Files created/changed · decisions that deviate from this contract (and why) ·
commands run + results (`npm test` output tail) · open issues / needs from other
owners · anything that needs the human owner's input.
