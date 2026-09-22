// Admin shell: static serving, CSP, the legacy panel, and the view contract
// (every views/*.view.js imports only ui/api/strings and exports {title, mount}).
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { startTestApp } from '../helpers.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ADMIN = join(__dirname, '..', '..', 'admin');
const JS = join(ADMIN, 'js');

let t;
before(async () => { t = await startTestApp(); });
after(async () => { await t.close(); });

const directive = (policy, name) => String(policy || '').split(';').map(s => s.trim()).find(s => s === name || s.startsWith(`${name} `)) || '';

test('/admin/ serves the new Persian RTL shell (module script, noindex, no inline handlers)', async () => {
  const r = await fetch(`${t.base}/admin/`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/html/);
  const html = await r.text();
  assert.match(html, /<html lang="fa" dir="rtl">/);
  assert.match(html, /<script type="module" src="\/admin\/js\/main\.js"><\/script>/);
  assert.match(html, /<meta name="robots" content="noindex/);
  assert.match(html, /<link rel="stylesheet" href="\/admin\/admin\.css">/);
  assert.ok(!/\son[a-z]+=/i.test(html), 'no inline event handlers');
  const inline = (html.match(/<script\b[^>]*>/gi) || []).filter(s => !/\ssrc=/i.test(s));
  assert.deepEqual(inline, [], 'no inline <script> blocks');
  assert.ok(!/style="/.test(html), 'no inline style attributes');
  // deep links fall back to the same shell
  const deep = await fetch(`${t.base}/admin/projects/12`);
  assert.equal(deep.status, 200);
  assert.match(await deep.text(), /admin\/js\/main\.js/);
});

test('/admin/legacy.html still serves the old English panel with its script', async () => {
  const r = await fetch(`${t.base}/admin/legacy.html`);
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.match(html, /<title>SysaiQ — Admin<\/title>/);
  assert.match(html, /<script src="\/admin\/app\.js"><\/script>/);
  const js = await fetch(`${t.base}/admin/app.js`);
  assert.equal(js.status, 200);
  assert.match(js.headers.get('content-type'), /javascript/);
});

test('admin.css, icons.svg and the ES modules are served with the right types', async () => {
  const css = await fetch(`${t.base}/admin/admin.css`);
  assert.equal(css.status, 200);
  assert.match(css.headers.get('content-type'), /text\/css/);
  const cssText = await css.text();
  assert.match(cssText, /@layer reset, tokens, base, layout, components, utilities, views;/);
  assert.match(cssText, /url\('\/assets\/vazirmatn-var\.woff2'\)/);
  assert.ok(!/\b(margin|padding)-(left|right)\s*:/.test(cssText), 'logical properties only (no margin/padding-left/right)');
  assert.ok(!/(^|[^-])\b(left|right)\s*:\s*[^;]+;/m.test(cssText), 'no physical left/right offsets');

  const svg = await fetch(`${t.base}/admin/icons.svg`);
  assert.equal(svg.status, 200);
  assert.match(svg.headers.get('content-type'), /image\/svg\+xml/);

  for (const p of ['/admin/js/main.js', '/admin/js/ui.js', '/admin/js/api.js', '/admin/js/router.js', '/admin/js/nav.js', '/admin/js/store.js', '/admin/js/strings.js', '/admin/js/lib/jalali.js', '/admin/js/views/login.view.js']) {
    const r = await fetch(`${t.base}${p}`);
    assert.equal(r.status, 200, p);
    assert.match(r.headers.get('content-type'), /javascript/, p);
  }
  // a view that does not exist answers the SPA shell (text/html) — main.js probes with HEAD before import()
  const missing = await fetch(`${t.base}/admin/js/views/does-not-exist.view.js`, { method: 'HEAD' });
  assert.equal(missing.status, 200);
  assert.match(missing.headers.get('content-type'), /text\/html/);
});

test('CSP on /admin/: script-src is self only (no unsafe-inline), never framed', async () => {
  const r = await fetch(`${t.base}/admin/`);
  const csp = r.headers.get('content-security-policy');
  assert.ok(csp, 'admin has a CSP header');
  assert.equal(directive(csp, 'script-src'), "script-src 'self'");
  assert.ok(!directive(csp, 'script-src').includes('unsafe-inline'));
  assert.ok(!directive(csp, 'default-src').includes('unsafe-inline'));
  assert.equal(directive(csp, 'frame-ancestors'), "frame-ancestors 'none'");
  assert.match(directive(csp, 'connect-src'), /'self'/);
  assert.match(directive(csp, 'font-src'), /'self'/);
  // same policy on the module files
  assert.equal((await fetch(`${t.base}/admin/js/main.js`)).headers.get('content-security-policy'), csp);
});

// ---- static contract checks on the source tree --------------------------
const viewFiles = readdirSync(join(JS, 'views')).filter(f => f.endsWith('.view.js'));

test('views import only ../ui.js, ../api.js, ../strings.js and never use innerHTML/inline handlers', () => {
  assert.ok(viewFiles.length >= 10, `expected the shipped views, got ${viewFiles.join(', ')}`);
  const ALLOWED = new Set(['../ui.js', '../api.js', '../strings.js']);
  for (const f of viewFiles) {
    const src = readFileSync(join(JS, 'views', f), 'utf8');
    for (const m of src.matchAll(/^\s*import\s[^'"]*['"]([^'"]+)['"]/gm)) assert.ok(ALLOWED.has(m[1]), `${f} imports ${m[1]}`);
    for (const m of src.matchAll(/import\(\s*['"`]([^'"`]+)['"`]/g)) assert.ok(ALLOWED.has(m[1]), `${f} dynamically imports ${m[1]}`);
    assert.ok(!/\.innerHTML\s*=|insertAdjacentHTML|outerHTML\s*=/.test(src), `${f} writes raw HTML`);
    assert.ok(!/\bon[a-z]+="/.test(src), `${f} has an inline handler attribute`);
  }
  // the kit itself never writes raw HTML either
  for (const f of readdirSync(join(JS, 'ui'))) {
    const src = readFileSync(join(JS, 'ui', f), 'utf8');
    assert.ok(!/\.innerHTML\s*=|insertAdjacentHTML|outerHTML\s*=/.test(src), `ui/${f} writes raw HTML`);
  }
});

test('every view module exports {title: string, mount: function} and loads in Node (DOM-free at module scope)', async () => {
  for (const f of viewFiles) {
    const mod = await import(pathToFileURL(join(JS, 'views', f)).href);
    const v = mod.default;
    assert.ok(v && typeof v === 'object', `${f}: default export`);
    assert.equal(typeof v.title, 'string', `${f}: title`);
    assert.ok(v.title.length > 0, `${f}: title text`);
    assert.equal(typeof v.mount, 'function', `${f}: mount`);
  }
});

test('ui.js exposes exactly the contract exports; nav declares every route with a Persian label + icon in the sprite', async () => {
  const ui = await import(pathToFileURL(join(JS, 'ui.js')).href);
  const REQUIRED = ['h', 'frag', 'clear', 'on', 'icon', 'useStyles', 'toFaDigits', 'toEnDigits', 'formatNumber', 'formatToman', 'parseServerDate', 'formatJalali', 'formatMobile', 'formatBytes', 'truncate', 'validators', 'validate', 'field', 'textareaField', 'selectField', 'switchField', 'numberField', 'moneyField', 'dateFieldJalali', 'tagsField', 'slugField', 'secretField', 'codeField', 'imageField', 'markdownField', 'bilingualField', 'repeater', 'createForm', 'dataTable', 'filterBar', 'modal', 'drawer', 'confirm', 'toast', 'pageHeader', 'card', 'tabs', 'stickyActionBar', 'statCard', 'checklist', 'progressRing', 'badge', 'statusBadge', 'emptyState', 'skeleton', 'errorState', 'uploadImage', 'copyToClipboard', 'registerShortcut', 'debounce'];
  for (const name of REQUIRED) assert.equal(typeof ui[name], name === 'validators' ? 'object' : 'function', `ui.${name}`);
  for (const name of REQUIRED) assert.ok(name in ui.ui, `ui.ui.${name}`);

  const nav = await import(pathToFileURL(join(JS, 'nav.js')).href);
  const sprite = readFileSync(join(ADMIN, 'icons.svg'), 'utf8');
  const ids = new Set([...sprite.matchAll(/id="i-([\w-]+)"/g)].map(m => m[1]));
  assert.ok(ids.size >= 30, `sprite has ${ids.size} icons`);
  const seen = new Set();
  for (const item of nav.NAV_ITEMS) {
    assert.match(item.label, /[؀-ۿ]/, `${item.id} label is Persian`);
    assert.ok(ids.has(item.icon), `${item.id}: icon "${item.icon}" missing from icons.svg`);
    assert.ok(item.path.startsWith('/'), item.id);
    assert.ok(!seen.has(item.path), `duplicate path ${item.path}`);
    seen.add(item.path);
    assert.equal(typeof item.view, 'string', `${item.id} view`);
  }
  for (const id of ['dashboard', 'content', 'sections', 'pages', 'services', 'projects', 'faqs', 'media', 'news', 'leads', 'conversations', 'sms', 'invoices', 'payments', 'gateways', 'site-info', 'trust', 'seo', 'ai', 'knowledge', 'account', 'backup', 'audit']) {
    assert.ok(nav.itemById(id), `nav item ${id} declared`);
  }
  assert.equal(nav.LEGACY_URL, '/admin/legacy.html');

  // every icon('name') used anywhere in the admin JS exists in the sprite
  const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(d => (d.isDirectory() ? walk(join(dir, d.name)) : [join(dir, d.name)]));
  for (const file of walk(JS)) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/icon\(\s*'([\w-]+)'/g)) assert.ok(ids.has(m[1]), `${file.replace(JS, 'js')}: icon "${m[1]}" missing from icons.svg`);
  }

  // the router matches nav routes and extracts params
  const router = await import(pathToFileURL(join(JS, 'router.js')).href);
  assert.deepEqual(router.parseHash('#/projects/12?tab=card'), { path: '/projects/12', query: { tab: 'card' } });
  assert.deepEqual(router.parseHash(''), { path: '/', query: {} });
});

test('router: a malformed percent-escape in the hash does not throw (falls back to the raw path)', async () => {
  const router = await import(pathToFileURL(join(JS, 'router.js')).href);
  assert.deepEqual(router.parseHash('#/%E0%A4%A'), { path: '/%E0%A4%A', query: {} });
  assert.deepEqual(router.parseHash('#/leads/%ZZ?x=1'), { path: '/leads/%ZZ', query: { x: '1' } });
  assert.deepEqual(router.parseHash('#/projects/%D9%BE'), { path: '/projects/پ', query: {} });
  // a bad escape inside a route param is kept raw instead of blowing up match(); start() needs the few globals it touches
  globalThis.window = { addEventListener() {}, scrollTo() {} };
  globalThis.location = { hash: '#/projects/%ZZ' };
  globalThis.history = { replaceState() {} };
  try {
    await router.start({ routes: [{ pattern: '/projects/:id', item: { view: 'projects' } }], outlet: null, load: () => null, ctx: null });
    assert.equal(router.currentRoute().path, '/projects/%ZZ');
    assert.equal(router.param('id'), '%ZZ');
  } finally { delete globalThis.window; delete globalThis.location; delete globalThis.history; }
});

// A hash router must not treat the skip link's "#a-main" (or any in-page
// anchor) as a route: it would read "/a-main", match nothing, unmount the view
// and show the not-found placeholder — Tab+Enter would lose the page.
test('router: "#a-main" and other in-page anchors are not routes; the mounted view stays', async () => {
  const router = await import(pathToFileURL(join(JS, 'router.js')).href);
  const { store } = await import(pathToFileURL(join(JS, 'store.js')).href);
  assert.equal(router.parseHash('#a-main'), null);
  assert.equal(router.parseHash('#top?x=1'), null);
  assert.equal(router.isRouteHash('#a-main'), false);
  for (const h of ['', '#', '#/', '#/leads?status=new']) assert.equal(router.isRouteHash(h), true, JSON.stringify(h));
  assert.deepEqual(router.parseHash('#'), { path: '/', query: {} });
  assert.deepEqual(router.parseHash('#/'), { path: '/', query: {} });

  const listeners = {};
  const replaced = [];
  globalThis.window = { addEventListener: (evt, fn) => { listeners[evt] = fn; }, scrollTo() {} };
  globalThis.location = { hash: '#/leads' };
  // like the browser: replaceState changes location.hash without a hashchange event
  globalThis.history = { replaceState: (_s, _t, href) => { replaced.push(href); globalThis.location.hash = href; } };
  try {
    let changes = 0;
    router.onChange(() => { changes++; });
    await router.start({ routes: [{ pattern: '/', item: { view: 'dashboard' } }, { pattern: '/leads', item: { view: 'leads' } }], outlet: null, load: () => null, ctx: null });
    assert.equal(router.currentRoute().path, '/leads');
    assert.equal(changes, 1);
    const before = store.get('route');

    // the skip link's anchor lands in the hash (e.g. a middle-click / a future #section link)
    globalThis.location.hash = '#a-main';
    await listeners.hashchange();
    assert.equal(router.currentRoute().path, '/leads', 'view not unmounted');
    assert.equal(router.currentRoute(), before, 'route object untouched');
    assert.equal(changes, 1, 'no route change fired');
    assert.deepEqual(replaced, [], 'the URL is left to the browser');

    // reload() (login-overlay recovery) re-mounts /leads, not the dashboard, and repairs the URL
    await router.reload();
    assert.equal(router.currentRoute().path, '/leads');
    assert.deepEqual(replaced, ['#/leads']);

    // a real navigation afterwards works as before
    globalThis.location.hash = '#/';
    await listeners.hashchange();
    assert.equal(router.currentRoute().path, '/');
    assert.equal(changes, 3);
  } finally { delete globalThis.window; delete globalThis.location; delete globalThis.history; }
});

test('skip link: main.js swallows the click and focuses #a-main itself; the shell keeps the link', () => {
  const html = readFileSync(join(ADMIN, 'index.html'), 'utf8');
  assert.match(html, /<a class="a-skip" href="#a-main">پرش به محتوا<\/a>/);
  const main = readFileSync(join(JS, 'main.js'), 'utf8');
  const handler = main.slice(main.indexOf("document.querySelector('.a-skip')"), main.indexOf('// ---- view loading'));
  assert.ok(handler.length > 0, 'a .a-skip click handler is installed at boot');
  assert.match(handler, /e\.preventDefault\(\)/);
  assert.match(handler, /main\.focus\(\)/);
  assert.match(main, /h\('main\.a-main', \{ id: 'a-main', tabindex: '-1' \}\)/, 'the outlet is the focus target (tabindex=-1)');
});

test('not-found placeholder: a plain title («صفحه پیدا نشد»), never the sentence with a full stop, in document.title and the topbar', async () => {
  const { STR } = await import(pathToFileURL(join(JS, 'strings.js')).href);
  assert.equal(STR.placeholder.notFoundTitle, 'صفحه پیدا نشد');
  assert.ok(!/[.۔!؟]$/.test(STR.placeholder.notFoundTitle), 'no trailing punctuation');
  assert.match(STR.placeholder.notFoundBody('/a-main'), /#\/a-main/);
  const main = readFileSync(join(JS, 'main.js'), 'utf8');
  const placeholder = main.slice(main.indexOf('function placeholderModule'), main.indexOf('// ---- shell'));
  assert.ok(!/STR\.errors\.notFound/.test(placeholder), 'placeholder no longer uses the error sentence as a title');
  assert.match(placeholder, /title: item \? item\.label : STR\.placeholder\.notFoundTitle/);
  assert.match(main, /title\.textContent = route\.item\?\.label \|\| STR\.placeholder\.notFoundTitle/, 'topbar falls back to the not-found title, not «داشبورد»');
});

test('setup checklist: the required-pages hint no longer lists «تماس» (migration 012 removed the contact page row)', async () => {
  const { STR } = await import(pathToFileURL(join(JS, 'strings.js')).href);
  const hint = STR.dashboard.setup.required_pages.hint;
  assert.ok(!/تماس/.test(hint), hint);
  assert.equal(hint, 'دربارهٔ ما، قوانین، حریم خصوصی و بازپرداخت.');
  // every page it names is a seeded system page
  const { SYSTEM_PAGES } = await import('../../src/db/migrations/008_pages.js');
  const slugs = SYSTEM_PAGES.map(p => p[0]);
  for (const s of ['about', 'terms', 'privacy', 'refund']) assert.ok(slugs.includes(s), s);
  assert.ok(!slugs.includes('contact'), 'contact is not a page row');
});

test('setup checklist: the SMTP item is not a link (SMTP lives in the server .env, no admin screen exists for it)', async () => {
  const { STR } = await import(pathToFileURL(join(JS, 'strings.js')).href);
  const smtp = STR.dashboard.setup.smtp;
  assert.ok(!smtp.href, 'smtp.href must be empty');
  assert.match(smtp.hint, /\.env/);
  for (const [key, meta] of Object.entries(STR.dashboard.setup)) {
    if (key === 'smtp') continue;
    assert.match(meta.href, /^#\//, `${key} links to a view`);
  }
});

test('contrast: --faint (2.6:1) styles no readable text; hints, states, table labels and captions use --dim (≥ 5:1)', () => {
  const css = readFileSync(join(ADMIN, 'admin.css'), 'utf8');
  const rules = css.split('\n').filter(l => /var\(--faint\)/.test(l) && !/^\s*(\/\*|--faint|--panel and)/.test(l));
  // decoration only: placeholders, the mono eyebrow, decorative icons/marks and the explicit .a-faint utility
  const ALLOWED = [/^\s*::placeholder\b/, /\.a-page-head__eyebrow\b/, /\.a-imgf__preview\b/, /\.a-check__mark\b/, /\.a-check__go\b/, /\.a-filters__search \.a-icon\b/, /\.a-empty \.a-icon\b/, /^\s*\.a-faint \{/];
  for (const line of rules) assert.ok(ALLOWED.some(re => re.test(line)), `--faint on readable text: ${line.trim()}`);
  for (const sel of ['.a-hint', '.a-check__hint', '.a-stat__hint', '.a-switch__state', '.a-table__secondary', '.a-table td::before', '.a-crumbs', '.a-filters__count', '.a-rep__empty', '.a-nav__label', '.a-chat__meta', '.a-auth__foot', '.a-counter', '.a-label__lang', '.a-search-btn kbd', '.a-palette__group', '.a-date__dow']) {
    const line = css.split('\n').find(l => l.trim().startsWith(`${sel} {`));
    assert.ok(line, `${sel} rule exists`);
    assert.match(line, /color: var\(--dim\)/, `${sel} uses --dim`);
  }
  for (const f of ['content', 'site-info']) assert.ok(!/var\(--faint\)/.test(readFileSync(join(ADMIN, 'css', 'views', `${f}.css`), 'utf8')), `${f}.css has no --faint text`);
  // views never put readable text in the decorative utility
  for (const f of viewFiles) assert.ok(!/a-faint/.test(readFileSync(join(JS, 'views', f), 'utf8')), `${f} uses .a-faint`);
});

test('hit targets: compact buttons grow to 40px at touch widths and carry a 40px halo on pointer screens', () => {
  const css = readFileSync(join(ADMIN, 'admin.css'), 'utf8');
  assert.match(css, /\.a-btn--sm::after \{ content: ""; position: absolute; inset: -4px; \}/);
  const touch = css.slice(css.indexOf('@media (max-width: 900px) {\n    .a-btn--sm { min-block-size: 40px; }'));
  assert.ok(touch.length > 0, 'touch-width block for .a-btn--sm');
  assert.match(touch, /\.a-btn--icon\.a-btn--sm \{ inline-size: 40px; \}/);
  assert.match(css, /@media \(max-width: 900px\) \{ \.a-rep__tools \.a-btn \{ inline-size: 40px; min-block-size: 40px; \} \}/);
  assert.match(css, /@media \(max-width: 900px\) \{ \.a-input-wrap__btn \{[^}]*inline-size: 40px; block-size: 40px; \} \}/);
  assert.match(css, /\.a-tags__chip button::after \{ content: ""; position: absolute; inset: -9px; \}/);
});

test('overlays lock scrolling on <body>, never on <html> (html overflow would turn body into the scroller and unstick the sidebar)', () => {
  const src = readFileSync(join(JS, 'ui', 'overlay.js'), 'utf8');
  assert.match(src, /document\.body\.style\.overflow = on \? 'hidden' : ''/);
  assert.ok(!/documentElement\.style/.test(src), 'no html-level style lock');
});
