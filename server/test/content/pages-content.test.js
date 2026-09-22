// Authored content for the 9 system pages (server/content/pages/*.json):
// shape, fa/en parity, Persian orthography, facts only via {{site.*}}
// tokens, no fabricated figures, no duplicated legal framework notice (the
// renderer injects it), and a clean render through lib/markdown.js. The
// content checks are pure; the last test boots one app to prove the notice
// shows exactly once on every legal page.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startTestApp } from '../helpers.js';
import { renderMarkdown } from '../../src/lib/markdown.js';
import { SYSTEM_PAGES } from '../../src/db/migrations/008_pages.js';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '../../content/pages');
const KEYS = ['slug', 'title_en', 'title_fa', 'body_en', 'body_fa', 'meta_desc_en', 'meta_desc_fa',
  'version', 'effective_at', 'show_in_footer', 'show_in_nav', 'sort'];
const TOKENS = ['site.owner_name', 'site.address', 'site.landline', 'site.mobile', 'site.email', 'site.hours'];
const NOTICE_FA = 'این متن چارچوب عمومی همکاری با SysaiQ را توضیح می‌دهد. در هر پروژه، قرارداد امضاشده میان طرفین حاکم است و در صورت تفاوت، متن قرارداد ملاک خواهد بود.';
const NOTICE_EN = 'This page describes the general framework of working with SysaiQ.';
const AUTHORITATIVE = 'The Persian version of this page is authoritative.';

const kindOf = Object.fromEntries(SYSTEM_PAGES.map(([slug, kind]) => [slug, kind]));
const files = readdirSync(DIR).filter(f => f.endsWith('.json')).sort();
const pages = files.map(f => ({ file: f, ...JSON.parse(readFileSync(join(DIR, f), 'utf8')) }));

const count = (s, re) => (s.match(re) || []).length;
const H2 = /^## /gm, H3 = /^### /gm, LINK = /\]\(/g;
// prose = body minus code spans, urls, list markers, tokens and ⟦…⟧ placeholders
const prose = s => s.replace(/`[^`]*`/g, '').replace(/\]\([^)]*\)/g, ']')
  .replace(/^\s*\d{1,3}[.)]\s/gm, '').replace(/\{\{[^}]*\}\}/g, '').replace(/⟦[^⟧]*⟧/g, '');

test('all 9 system slugs exist, parse, and have exactly the agreed shape', () => {
  assert.deepEqual(pages.map(p => p.slug).sort(), SYSTEM_PAGES.map(p => p[0]).sort());
  for (const p of pages) {
    assert.equal(`${p.slug}.json`, p.file);
    assert.deepEqual(Object.keys(p).filter(k => k !== 'file').sort(), [...KEYS].sort(), p.file);
    for (const k of ['title_en', 'title_fa', 'body_en', 'body_fa', 'meta_desc_en', 'meta_desc_fa']) {
      assert.ok(typeof p[k] === 'string' && p[k].trim(), `${p.slug}.${k}`);
    }
    assert.equal(p.version, '1.0');
    assert.match(p.effective_at, /^\d{4}-\d{2}-\d{2}$/);
    for (const k of ['show_in_footer', 'show_in_nav']) assert.ok(p[k] === 0 || p[k] === 1, `${p.slug}.${k}`);
    assert.ok(Number.isInteger(p.sort) && p.sort > 0);
    assert.ok(p.meta_desc_fa.length <= 200 && p.meta_desc_en.length <= 200, `${p.slug} meta length`);
    assert.equal(p.title_fa, SYSTEM_PAGES.find(s => s[0] === p.slug)[2], `${p.slug} title_fa matches the migration`);
  }
  for (const k of ['title_fa', 'title_en', 'meta_desc_fa', 'meta_desc_en']) {
    assert.equal(new Set(pages.map(p => p[k])).size, pages.length, `${k} unique`);
  }
});

test('fa/en parity: same count of ##, ### and links; agreed clause counts', () => {
  for (const p of pages) {
    assert.equal(count(p.body_fa, H2), count(p.body_en, H2), `${p.slug} h2`);
    assert.equal(count(p.body_fa, H3), count(p.body_en, H3), `${p.slug} h3`);
    assert.equal(count(p.body_fa, LINK), count(p.body_en, LINK), `${p.slug} links`);
  }
  const by = Object.fromEntries(pages.map(p => [p.slug, p]));
  assert.equal(count(by.charter.body_fa, H2), 13, 'charter has 13 clauses');
  assert.equal(count(by.contract.body_fa, H2), 17, 'contract has 17 clauses');
  const faqs = count(by.faq.body_fa, H3);
  assert.ok(faqs >= 10 && faqs <= 14, `faq has ${faqs} questions`);
  assert.ok(by.contract.body_fa.includes('تعهدات طرفین: ارائه‌دهنده و دریافت‌کنندهٔ خدمات'), 'owner headline');
  assert.ok(by.contract.body_fa.includes('**مجری (ارائه‌دهندهٔ خدمات):**') && by.contract.body_fa.includes('**کارفرما (دریافت‌کنندهٔ خدمات):**'), 'terms defined once');
  assert.ok(by.about.body_fa.includes('SysaiQ نام تجاری فعالیت حرفه‌ای {{site.owner_name}} (شخص حقیقی) است'), 'about identity');
});

test('Persian orthography: no Latin digits in fa prose, no Arabic ي/ك, no «ه‌ی» ezafe', () => {
  for (const p of pages) {
    for (const k of ['title_fa', 'body_fa', 'meta_desc_fa']) {
      const t = prose(p[k]);
      const digit = /[0-9]/.exec(t);
      assert.equal(digit, null, `${p.slug}.${k}: Latin digit near «${t.slice(Math.max(0, (digit?.index ?? 0) - 30), (digit?.index ?? 0) + 30)}»`);
      assert.doesNotMatch(p[k], /[يك]/, `${p.slug}.${k}: Arabic yeh/kaf`);
      assert.doesNotMatch(p[k], /ه‌ی\s/, `${p.slug}.${k}: use «هٔ»`);
    }
    // en side: same script rules for any Persian that leaks in
    for (const k of ['title_en', 'body_en', 'meta_desc_en']) assert.doesNotMatch(p[k], /[يك]/, `${p.slug}.${k}`);
  }
});

test('facts only via the six {{site.*}} tokens; no literal phone/email/address', () => {
  const phone = /(?:\+98|0[0-9]{2,3}[- ]?[0-9]{3}[- ]?[0-9]{4})|(?:[۰-۹]{3,4}[- ]?[۰-۹]{3,4}[- ]?[۰-۹]{3,4})/;
  const email = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
  const address = /توحید|قویدل|عادل بابایی|پلاک|Tohid|Ghavidel|Adel Babaei|No\. ?25/;
  const literalName = /حامد ابوعلی|Hamed Abooali/;
  for (const p of pages) {
    for (const k of ['body_fa', 'body_en', 'meta_desc_fa', 'meta_desc_en']) {
      const s = p[k];
      for (const m of s.matchAll(/\{\{\s*([^}\s]+)\s*\}\}/g)) assert.ok(TOKENS.includes(m[1]), `${p.slug}.${k}: unknown token ${m[0]}`);
      assert.doesNotMatch(s, phone, `${p.slug}.${k}: literal phone`);
      assert.doesNotMatch(s, email, `${p.slug}.${k}: literal email`);
      assert.doesNotMatch(s, address, `${p.slug}.${k}: literal address`);
      if (k.startsWith('body')) assert.doesNotMatch(s, literalName, `${p.slug}.${k}: owner name must be {{site.owner_name}}`);
    }
  }
});

test('never fabricate: no prices, percentages, counts, client names or guarantees', () => {
  const price = /[0-9۰-۹][0-9۰-۹٬,.]*\s*(?:تومان|ریال|USD|EUR|\$|€)|(?:\$|€)\s*[0-9]|(?:از|from)\s+[0-9۰-۹]+/i;
  const percent = /[0-9۰-۹]+\s*[%٪]|[%٪]\s*[0-9۰-۹]+/;
  const counts = /\+\s*[0-9۰-۹]+|[0-9۰-۹]+\s*\+|(?:[0-9۰-۹]+\s*(?:پروژه|مشتری|نفره|projects|clients))/;
  const hype = /cutting-edge|world-class|guaranteed results|تضمین بازدهی|تیم \S+ نفره/i;
  for (const p of pages) {
    for (const k of ['body_fa', 'body_en', 'meta_desc_fa', 'meta_desc_en']) {
      assert.doesNotMatch(p[k], price, `${p.slug}.${k}: price figure`);
      assert.doesNotMatch(p[k], percent, `${p.slug}.${k}: percentage figure`);
      assert.doesNotMatch(p[k], counts, `${p.slug}.${k}: count claim`);
      assert.doesNotMatch(p[k], hype, `${p.slug}.${k}: hype`);
    }
    // undecided policy values stay as ⟦…⟧ and are balanced
    for (const k of ['body_fa', 'body_en']) assert.equal(count(p[k], /⟦/g), count(p[k], /⟧/g), `${p.slug}.${k}: unbalanced ⟦…⟧`);
    assert.equal(count(p.body_fa, /⟦/g), count(p.body_en, /⟦/g), `${p.slug}: same number of ⟦…⟧ in fa and en`);
  }
});

// Regression: render/page.js injects the framework notice as <aside class="notice">
// on every kind=legal page, so the bodies must not repeat it (it showed twice).
test('no body carries the framework notice or a leading blockquote — the renderer adds it', () => {
  for (const p of pages) {
    assert.ok(!p.body_fa.includes(NOTICE_FA), `${p.slug} fa: notice duplicated in body`);
    assert.ok(!p.body_en.includes(NOTICE_EN), `${p.slug} en: notice duplicated in body`);
    assert.ok(!p.body_en.includes(AUTHORITATIVE), `${p.slug} en: authoritative line duplicated in body`);
    for (const k of ['body_fa', 'body_en']) assert.ok(!p[k].startsWith('>'), `${p.slug}.${k}: starts with a blockquote`);
  }
  assert.deepEqual(pages.filter(p => kindOf[p.slug] === 'legal').map(p => p.slug).sort(), ['charter', 'contract', 'privacy', 'refund', 'terms']);
});

test('renderMarkdown: no script, every heading and table survives, tokens resolve', () => {
  const tokens = Object.fromEntries(TOKENS.map(t => [t, `[${t}]`]));
  for (const p of pages) {
    for (const k of ['body_fa', 'body_en']) {
      const html = renderMarkdown(p[k], { tokens });
      assert.ok(!/<script/i.test(html), `${p.slug}.${k}: script`);
      assert.ok(!/\son\w+=/i.test(html), `${p.slug}.${k}: inline handler`);
      assert.equal(count(html, /<h2>/g), count(p[k], H2), `${p.slug}.${k}: h2 kept`);
      assert.equal(count(html, /<h3>/g), count(p[k], H3), `${p.slug}.${k}: h3 kept`);
      assert.equal(count(html, /<table>/g), count(p[k], /^\|[-\s|:]+\|\s*$/gm), `${p.slug}.${k}: tables kept`);
      assert.equal(count(html, /<a /g), count(p[k], LINK), `${p.slug}.${k}: links kept`);
      assert.ok(!html.includes('{{'), `${p.slug}.${k}: unresolved token`);
      for (const m of p[k].matchAll(/\]\(([^)]*)\)/g)) assert.match(m[1], /^\/(fa|en)\/[a-z-]+$/, `${p.slug}.${k}: only relative /lang/slug links (${m[1]})`);
      const lang = k.endsWith('fa') ? 'fa' : 'en';
      for (const m of p[k].matchAll(/\]\(\/(fa|en)\//g)) assert.equal(m[1], lang, `${p.slug}.${k}: link language`);
    }
  }
});

// ---- rendered legal pages: the notice appears exactly once ----------------
let t, applyKind, db;
before(async () => {
  t = await startTestApp();
  ({ db } = await import('../../src/db/index.js'));
  ({ applyKind } = await import('../../scripts/content-apply.mjs'));
});
after(async () => { await t.close(); });

test('applied legal pages render the framework notice exactly once (aside only, no blockquote)', async () => {
  applyKind(db, 'pages', { publish: true });
  for (const slug of ['charter', 'contract', 'privacy', 'refund', 'terms']) {
    for (const [lang, notice] of [['fa', NOTICE_FA], ['en', NOTICE_EN]]) {
      const r = await fetch(`${t.base}/${lang}/${slug}`);
      assert.equal(r.status, 200, `${lang}/${slug}`);
      const html = await r.text();
      assert.equal(count(html, new RegExp(notice.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')), 1, `${lang}/${slug}: notice count`);
      assert.equal(count(html, /<aside class="notice"/g), 1, `${lang}/${slug}: one aside`);
      assert.ok(!html.includes('<blockquote>'), `${lang}/${slug}: no blockquote`);
      if (lang === 'en') assert.equal(count(html, new RegExp(AUTHORITATIVE.replace(/\./g, '\\.'), 'g')), 1, `${slug}: authoritative once`);
    }
  }
});
