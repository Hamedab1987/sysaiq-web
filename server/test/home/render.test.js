// GET /fa/ and /en/ are rendered from templates/home.<lang>.html + the
// content table: an override shows up immediately, a reset restores the
// default, values are escaped by type and never re-expanded.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { startTestApp } from '../helpers.js';
import { esc } from '../../src/lib/html.js';
import { renderInline } from '../../src/lib/inline.js';

const t = await startTestApp();
await t.loginAsAdmin();
const DEFAULTS = JSON.parse(readFileSync(new URL('../../templates/content-defaults.json', import.meta.url), 'utf8'));

const home = async lang => {
  const r = await fetch(`${t.base}/${lang}/`);
  return { r, html: await r.text() };
};
const put = (key, body) => t.fetchAdmin(`/content/${key}`, { method: 'PUT', body });
const reset = key => t.fetchAdmin(`/content/${key}`, { method: 'DELETE' });

test.after(() => t.close());

test('/fa/ and /en/ answer 200 text/html with the defaults, no leftover tokens, correct direction', async () => {
  for (const lang of ['fa', 'en']) {
    const { r, html } = await home(lang);
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /^text\/html; charset=utf-8/);
    assert.equal(r.headers.get('cache-control'), 'no-cache');
    assert.match(r.headers.get('etag'), /^"[0-9a-f]{40}"$/);
    assert.ok(!/\{\{[A-Z0-9_]+\}\}/.test(html), 'every token replaced');
    assert.ok(html.includes(`<title>${esc(DEFAULTS.TITLE[lang])}</title>`), 'TITLE default');
    assert.ok(html.includes(`<h1 class="rv on">${renderInline(DEFAULTS.HERO_H1[lang])}</h1>`), 'HERO_H1 inline default');
    assert.ok(html.includes(`content="${esc(DEFAULTS.META_DESC[lang])}"`), 'META_DESC in the attribute');
    assert.ok(html.includes(lang === 'fa' ? 'dir="rtl"' : 'lang="en"'));
    assert.ok(html.includes('<script src="/assets/three.min.js'), 'runtime template, not the baked page');
  }
});

test('an override appears on the page immediately, per language; reset restores the default', async () => {
  let r = await put('HERO_H1', { fa: 'سلام دنیا' });
  assert.equal(r.status, 200, await r.text());
  assert.ok((await home('fa')).html.includes('<h1 class="rv on">سلام دنیا</h1>'));
  assert.ok((await home('en')).html.includes(`<h1 class="rv on">${renderInline(DEFAULTS.HERO_H1.en)}</h1>`), 'en untouched');

  r = await put('HERO_H1', { en: 'Hello *world*' });
  assert.equal(r.status, 200);
  assert.ok((await home('en')).html.includes('<h1 class="rv on">Hello <em>world</em></h1>'), 'inline key renders *x* as <em>');
  assert.ok((await home('fa')).html.includes('<h1 class="rv on">سلام دنیا</h1>'), 'fa kept');

  r = await reset('HERO_H1');
  assert.equal(r.status, 200);
  assert.ok((await home('fa')).html.includes(`<h1 class="rv on">${renderInline(DEFAULTS.HERO_H1.fa)}</h1>`));
  assert.ok((await home('en')).html.includes(`<h1 class="rv on">${renderInline(DEFAULTS.HERO_H1.en)}</h1>`));
});

test('null for one language resets only that language; "" is an intentional blank', async () => {
  await put('NAV_HOME', { en: 'Start', fa: 'شروع' });
  await put('NAV_HOME', { en: null });
  assert.ok((await home('en')).html.includes(`<a href="#hero">${esc(DEFAULTS.NAV_HOME.en)}</a>`));
  assert.ok((await home('fa')).html.includes('<a href="#hero">شروع</a>'));
  await put('NAV_HOME', { fa: '' });
  assert.ok((await home('fa')).html.includes('<a href="#hero"></a>'), 'blank on purpose');
  await reset('NAV_HOME');
});

test('a value containing {{X}} or $& stays literal (single pass, function replacer)', async () => {
  const r = await put('NAV_HOME', { en: '{{TITLE}} $& $1 {{SLOT_WORK}} $<x>' });
  assert.equal(r.status, 200, await r.text());
  const { html } = await home('en');
  assert.ok(html.includes('<a href="#hero">{{TITLE}} $&amp; $1 {{SLOT_WORK}} $&lt;x&gt;</a>'), html.slice(html.indexOf('<a href="#hero">'), html.indexOf('<a href="#hero">') + 80));
  assert.equal((html.match(/\{\{TITLE\}\}/g) || []).length, 2, 'only the two literal copies from the value (nav + footer), no expansion');
  assert.ok(!html.includes('id="showcase"></a>'), 'SLOT_WORK inside a value is not expanded');
  await reset('NAV_HOME');
});

test('plain keys are escaped, inline keys get mini-markup but never raw HTML', async () => {
  await put('NAV_HOME', { en: '<b>x</b> & "q"' });
  await put('HERO_H1', { en: '<img src=x onerror=1> **bold**\nline' });
  const { html } = await home('en');
  assert.ok(html.includes('<a href="#hero">&lt;b&gt;x&lt;/b&gt; &amp; &quot;q&quot;</a>'));
  assert.ok(!html.includes('<b>x</b>'));
  assert.ok(html.includes('<h1 class="rv on">&lt;img src=x onerror=1&gt; <strong>bold</strong><br>line</h1>'));
  assert.ok(!html.includes('<img src=x'));
  await reset('NAV_HOME');
  await reset('HERO_H1');
});

test('the #site-data JSON block carries the AI strings, with "<" escaped', async () => {
  await put('AI_TITLE', { en: 'Bot </script><x>' });
  const { html } = await home('en');
  const m = /<script type="application\/json" id="site-data">(.*?)<\/script>/s.exec(html);
  assert.ok(m, 'block present');
  assert.ok(!m[1].includes('</script>'), 'closing tag cannot occur inside');
  const data = JSON.parse(m[1]);
  assert.equal(data.ai.title, 'Bot </script><x>');
  assert.deepEqual(Object.keys(data.ai), ['title', 'ready', 'ph', 'hi', 'teaser', 'err']);
  assert.equal(data.ai.hi, DEFAULTS.AI_HI.en);
  await reset('AI_TITLE');
  const fa = JSON.parse(/id="site-data">(.*?)<\/script>/s.exec((await home('fa')).html)[1]);
  assert.equal(fa.ai.ph, DEFAULTS.AI_PH.fa);
});

test('/fa and /en redirect 301 to the slash form (query kept); /fa/index.html too', async () => {
  for (const [path, loc] of [['/fa', '/fa/'], ['/en?utm=x', '/en/?utm=x'], ['/fa/index.html', '/fa/'], ['/en/index.html?a=1', '/en/?a=1']]) {
    const r = await fetch(t.base + path, { redirect: 'manual' });
    assert.equal(r.status, 301, path);
    assert.equal(r.headers.get('location'), loc, path);
  }
});

test('the route wins over the static SITE_DIR fallback', async () => {
  // helpers.js writes a static "test site" index.html into SITE_DIR; the SSR page must be served instead
  const { writeFile, mkdir } = await import('node:fs/promises');
  const { join } = await import('node:path');
  await mkdir(join(t.siteDir, 'fa'), { recursive: true });
  await writeFile(join(t.siteDir, 'fa', 'index.html'), '<!doctype html><title>BAKED</title>');
  const { html } = await home('fa');
  assert.ok(!html.includes('BAKED'));
  assert.ok(html.includes('id="site-data"'));
});

test('ETag: If-None-Match → 304 until the content changes', async () => {
  const { r } = await home('en');
  const etag = r.headers.get('etag');
  // node's fetch adds "cache-control: no-cache" to conditional requests (which forbids a 304) unless the header is given
  const cond = { 'if-none-match': etag, 'cache-control': 'max-age=0' };
  let again = await fetch(`${t.base}/en/`, { headers: cond });
  assert.equal(again.status, 304);
  assert.equal(again.headers.get('etag'), etag);
  await put('FOOT_MID', { en: 'changed' });
  again = await fetch(`${t.base}/en/`, { headers: cond });
  assert.equal(again.status, 200);
  assert.notEqual(again.headers.get('etag'), etag);
  assert.ok((await again.text()).includes('<span class="mono">changed</span>'));
  await reset('FOOT_MID');
});
