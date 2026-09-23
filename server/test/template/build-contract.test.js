// The build.py ⟷ renderer contract: server/templates/{home.en,home.fa}.html,
// content-defaults.json and manifest.json (all written by vesper-project/build.py).
//
// The checks run on a FRESH build into a scratch directory when python3 is
// available (so a broken build.py fails here, not on the server), and fall
// back to the committed files otherwise. A second test then asserts the
// committed copies are up to date with the source, and a third that
// lib/csp.js really turns the committed manifest into the home page's policy.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, '..', '..', '..');
const VESPER = join(REPO, 'vesper-project');
const TEMPLATES = join(REPO, 'server', 'templates');

const SLOTS = ['HEAD_META', 'JSONLD', 'NAV_EXTRA', 'SECTIONS_AFTER_ABOUT', 'WORK', 'SECTIONS_AFTER_WORK', 'NEWS',
  'FAQ', 'NEWS_FEED', 'SECTIONS_AFTER_FAQ', 'CONTACT', 'FOOTER_LINKS', 'FOOTER_TRUST', 'SITE_DATA'];
const SOURCES = ['token', 'slot:WORK', 'slot:FAQ', 'slot:CONTACT', 'slot:SITE_DATA'];
const GROUPS = ['سئو و متا', 'منو و سربرگ', 'هیرو', 'توانمندی‌ها', 'گستره', 'ذهن', 'چه می‌سازم', 'نمونه‌کارها',
  'سؤالات متداول', 'تماس', 'پانویس', 'دستیار گفت‌وگو'];
const HASH_RE = /^sha256-[A-Za-z0-9+/]{43}=$/;
const TOKEN_RE = /\{\{([A-Z0-9_]+)\}\}/g;
const SCRIPT_RE = /<script\b([^>]*)>([\s\S]*?)<\/script>/g;

const sha256 = s => 'sha256-' + createHash('sha256').update(s, 'utf8').digest('base64');
// same rule as build.py: every executing inline script (no src, not a JSON block)
function inlineScriptHashes(page) {
  const out = [];
  for (const m of page.matchAll(SCRIPT_RE)) {
    const [, attrs, body] = m;
    if (/\bsrc\s*=/.test(attrs)) continue;
    const t = /type\s*=\s*"([^"]*)"/.exec(attrs);
    if (t && t[1].includes('json')) continue;
    out.push(sha256(body));
  }
  return out;
}
const mainScript = page => [...page.matchAll(SCRIPT_RE)]
  .filter(m => !m[1].includes('src=') && !m[1].includes('json') && m[2].includes('VESPER')).map(m => m[2]);

// ---- fresh build into a scratch dir (python3), else the committed files ----
let scratch = null, built = null, buildError = null;
try {
  scratch = mkdtempSync(join(tmpdir(), 'sysaiq-build-'));
  const r = spawnSync('python3', ['build.py', '--site-dir', join(scratch, 'site'), '--templates-dir', join(scratch, 'templates')],
    { cwd: VESPER, encoding: 'utf8' });
  if (r.error?.code === 'ENOENT') buildError = 'python3 not found';
  else if (r.status !== 0) buildError = `build.py exited ${r.status}\n${r.stderr}${r.stdout}`;
  else built = { site: join(scratch, 'site'), templates: join(scratch, 'templates') };
} catch (e) { buildError = String(e); }
test.after(() => { if (scratch) rmSync(scratch, { recursive: true, force: true }); });

const dir = built ? built.templates : TEMPLATES;
const siteDir = built ? built.site : VESPER;
const read = (d, f) => readFileSync(join(d, f), 'utf8');

test('build.py runs clean (or python3 is unavailable and the committed output is used)', t => {
  if (buildError && !buildError.startsWith('python3 not found')) assert.fail(buildError);
  if (!built) t.diagnostic(`${buildError}: asserting the committed server/templates files instead`);
});

const defaults = JSON.parse(read(dir, 'content-defaults.json'));
const manifest = JSON.parse(read(dir, 'manifest.json'));
const tpl = { en: read(dir, 'home.en.html'), fa: read(dir, 'home.fa.html') };
const tokenKeys = Object.keys(defaults).filter(k => defaults[k].source === 'token');

test('content-defaults.json: every key has en+fa mini-markup defaults and complete META', () => {
  assert.ok(Object.keys(defaults).length >= 70);
  let lastOrder = 0, lastGroup = -1;
  for (const [key, m] of Object.entries(defaults)) {
    assert.match(key, /^[A-Z][A-Z0-9_]*$/);
    for (const lang of ['en', 'fa']) {
      assert.equal(typeof m[lang], 'string', `${key}.${lang}`);
      assert.ok(m[lang].trim(), `${key}.${lang} empty`);
      assert.ok(!m[lang].includes('<'), `${key}.${lang} still carries HTML`);
      assert.ok(!/&[a-z]+;|&#\d+;/i.test(m[lang]), `${key}.${lang} still carries an entity`);
      assert.ok(m[lang].length <= m.max, `${key}.${lang} longer than max`);
    }
    assert.ok(['plain', 'inline'].includes(m.type), key);
    assert.ok(GROUPS.includes(m.group), `${key}: group ${m.group}`);
    assert.ok(m.label_fa.trim() && m.label_en.trim(), key);
    assert.ok(Number.isInteger(m.max) && m.max > 0, key);
    assert.match(m.anchor, /^#[a-z][a-z0-9-]*$/, key);
    assert.ok(Number.isInteger(m.order) && m.order > lastOrder, `${key}: order must increase`);
    lastOrder = m.order;
    assert.ok(GROUPS.indexOf(m.group) >= lastGroup, `${key}: groups out of page order`);
    lastGroup = GROUPS.indexOf(m.group);
    assert.ok(SOURCES.includes(m.source), `${key}: source ${m.source}`);
  }
  // attribute keys are plain
  for (const k of ['TITLE', 'META_DESC', 'NAV_MENU', 'W1_T']) assert.equal(defaults[k].type, 'plain', k);
  // the slot-fed families
  for (let i = 1; i <= 9; i++) for (const s of ['T', 'D', 'G']) assert.equal(defaults[`W${i}_${s}`].source, 'slot:WORK');
  for (let i = 1; i <= 4; i++) { assert.equal(defaults[`Q${i}`].source, 'slot:FAQ'); assert.equal(defaults[`A${i}`].source, 'slot:FAQ'); }
  for (const k of ['AI_TITLE', 'AI_READY', 'AI_PH', 'AI_HI', 'AI_TEASER', 'AI_ERR']) {
    assert.equal(defaults[k].source, 'slot:SITE_DATA', k);
    assert.equal(defaults[k].group, 'دستیار گفت‌وگو', k);
  }
  assert.ok(tokenKeys.length >= 30);
});

test('runtime templates: exactly the token keys + every slot, nothing else', () => {
  for (const lang of ['en', 'fa']) {
    const html = tpl[lang];
    assert.ok(html.startsWith('<!-- sysaiq runtime template; do not edit -->\n<!DOCTYPE html>'), lang);
    const found = new Set([...html.matchAll(TOKEN_RE)].map(m => m[1]));
    const expected = new Set([...tokenKeys, ...SLOTS.map(s => `SLOT_${s}`)]);
    assert.deepEqual([...found].sort(), [...expected].sort(), `${lang}: token set`);
    for (const s of SLOTS) assert.equal(html.split(`{{SLOT_${s}}}`).length - 1, 1, `${lang}: slot ${s} once`);
    assert.ok(!html.includes('SLOT:'), `${lang}: marker left`);
    assert.ok(!html.includes('../'), `${lang}: relative path left`);
    assert.ok(!html.includes('__LANDMASK_B64__'), lang);
    assert.ok(!html.includes('cdnjs.cloudflare.com'), lang);
    assert.ok(html.includes(`<script src="${manifest.assets.three}"></script>`), `${lang}: three tag`);
    assert.ok(html.includes('href="/assets/favicon-64.png"') && html.includes('src="/assets/logo-mark-160.png"'), lang);
    assert.ok(html.includes('href="/fa/" data-lang="fa"') && html.includes('href="/en/" data-lang="en"'), lang);
    assert.ok(!html.includes('data:image/') && !html.includes('data:font/'), `${lang}: inlined asset left`);
    // every template token sits outside the hashed script
    const [main] = mainScript(html);
    assert.ok(main && !main.includes('{{'), `${lang}: main script must carry no tokens`);
  }
  assert.ok(tpl.fa.includes('<html lang="fa" dir="rtl">') && tpl.en.includes('<html lang="en">'));
  assert.ok(tpl.fa.includes("src:url(/assets/vazirmatn-var.woff2) format('woff2-variations')"));
  assert.ok(tpl.fa.includes('<link rel="preload" href="/assets/vazirmatn-var.woff2" as="font" type="font/woff2" crossorigin>'));
  assert.ok(!tpl.en.includes('vazirmatn'), 'en carries no Persian font');
  assert.ok(tpl.fa.includes('class="on">FA') && tpl.en.includes('class="on">EN'));
  // the site-data JSON block is a slot: the renderer emits it, the script only reads it
  assert.ok(!tpl.en.includes('id="site-data"'));
  assert.ok(mainScript(tpl.en)[0].includes("getElementById('site-data')"));
  assert.equal(mainScript(tpl.en)[0], mainScript(tpl.fa)[0], 'main script must be byte-identical across languages');
});

test('manifest.json: deterministic contract + valid sha256 CSP hashes that match the pages', () => {
  assert.equal(manifest.generated_from, 'build.py');
  assert.match(manifest.template_sha, /^[0-9a-f]{64}$/);
  assert.deepEqual(manifest.tokens, tokenKeys);
  assert.deepEqual(manifest.slots, SLOTS);
  assert.match(manifest.assets.three, /^\/assets\/three\.min\.js\?v=[0-9a-f]{8}$/);
  assert.ok(!JSON.stringify(manifest).match(/20\d\d-\d\d-\d\dT/), 'no timestamps');
  const lists = [manifest.scripts, manifest.csp.home.en, manifest.csp.home.fa, manifest.csp.baked.en, manifest.csp.baked.fa, manifest.csp.baked.root];
  for (const l of lists) {
    assert.ok(Array.isArray(l) && l.length >= 1);
    for (const h of l) { assert.match(h, HASH_RE); assert.equal(h.slice(7).length, 44); }
  }
  // the runtime home pages carry one inline script and its hash is listed
  for (const lang of ['en', 'fa']) assert.deepEqual(inlineScriptHashes(tpl[lang]), manifest.csp.home[lang], `home ${lang}`);
  assert.deepEqual(manifest.csp.home.en, manifest.csp.home.fa);
  // the top-level `scripts` list is what lib/csp.js reads today: one hash, the same for both languages
  assert.deepEqual(manifest.scripts, manifest.csp.home.en, 'manifest.scripts must repeat csp.home.en');
  assert.equal(manifest.scripts.length, 1);
  // the baked pages: inlined three.js + the same main script; root: the redirector
  for (const lang of ['en', 'fa']) {
    const page = read(join(siteDir, lang), 'index.html');
    assert.deepEqual(inlineScriptHashes(page), manifest.csp.baked[lang], `baked ${lang}`);
    assert.ok(manifest.csp.baked[lang].includes(manifest.csp.home[lang][0]), `${lang}: baked page shares the main script`);
    assert.ok(page.includes('<script type="application/json" id="site-data">{"ai":{"title":"'), `${lang}: site-data inlined`);
    assert.ok(!page.includes('{{') && !page.includes('SLOT:'), `${lang}: baked page clean`);
  }
  assert.deepEqual(inlineScriptHashes(read(siteDir, 'index.html')), manifest.csp.baked.root);
  assert.ok(read(siteDir, 'index.html').includes("lang='fa'"), 'root redirector defaults to Persian');
});

// The committed manifest, as build.py wrote it. test/security/csp.test.js
// moves the real file aside for a second or two while it plants its own
// copies (and puts it back byte for byte); under `npm test` the two files run
// in parallel, so wait that window out instead of skipping — a missing or
// foreign manifest after the wait is a real failure (run python3 build.py).
const readCommittedManifest = () => { try { return readFileSync(join(TEMPLATES, 'manifest.json'), 'utf8'); } catch { return null; } };
const parse = s => { try { return JSON.parse(s); } catch { return null; } };
async function waitForCommittedManifest(ms = 20000) {
  const until = Date.now() + ms;
  for (;;) {
    const raw = readCommittedManifest();
    if (parse(raw)?.generated_from === 'build.py') return raw;
    if (Date.now() > until) assert.fail('server/templates/manifest.json absent or not build.py output after 20 s — run vesper-project/build.py');
    await new Promise(r => setTimeout(r, 250));
  }
}

// The consumer side of the CSP contract: lib/csp.js must turn the manifest
// build.py writes into a hash-based script-src for /fa/ and /en/ (the M1
// smoke test «هدر CSP»). Round 1 shipped a manifest the reader ignored, so
// the home page went out without any policy; round 2's csp.test.js used to
// delete the file, so this check silently skipped under `npm test`.
test('lib/csp.js consumes the manifest: home pages get script-src with the main-script hash', async () => {
  const csp = await import('../../src/lib/csp.js');
  assert.equal(csp.MANIFEST_PATH, join(TEMPLATES, 'manifest.json'), 'csp.js reads the file build.py writes');
  let before, policy;
  for (let i = 0; ; i++) {
    before = await waitForCommittedManifest();
    csp.resetCspCache();
    policy = csp.buildCsp('home');
    if (readCommittedManifest() === before) break; // stable across the read
    assert.ok(i < 40, 'manifest.json kept changing under the check');
    await new Promise(r => setTimeout(r, 250));
  }
  const want = parse(before).scripts;
  assert.deepEqual(want, manifest.scripts, 'committed manifest.scripts differs from a fresh build — run python3 build.py');
  assert.ok(typeof policy === 'string', 'buildCsp("home") must not be null while a build.py manifest is present');
  const scriptSrc = policy.split(';').map(s => s.trim()).find(s => s.startsWith('script-src '));
  assert.equal(scriptSrc, `script-src 'self' ${want.map(h => `'${h}'`).join(' ')}`);
  assert.ok(!policy.includes("script-src 'self' 'unsafe-inline'"));
});

test('committed server/templates + baked pages are up to date with src/ (run python3 build.py)', { skip: !built && 'no fresh build' }, async () => {
  for (const f of ['home.en.html', 'home.fa.html', 'content-defaults.json']) {
    assert.ok(existsSync(join(TEMPLATES, f)), `server/templates/${f} missing — run vesper-project/build.py`);
    assert.equal(read(TEMPLATES, f), read(dir, f), `server/templates/${f} is stale — run vesper-project/build.py`);
  }
  for (const f of ['en/index.html', 'fa/index.html', 'index.html']) {
    assert.equal(read(VESPER, f), read(siteDir, f), `vesper-project/${f} is stale — run vesper-project/build.py`);
  }
  assert.deepEqual(parse(await waitForCommittedManifest()), manifest, 'server/templates/manifest.json is stale — run vesper-project/build.py');
});
