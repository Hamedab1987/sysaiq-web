// Knowledge base content (content/knowledge/<slug>.json): the AI assistant's
// bilingual grounding. Every file is complete in both languages and keyed by
// the shared slug contract (the 38 legacy rows keep slugify(title) so the
// apply script updates them in place), sized for the prompt budget (the
// non-pitch rows are sent on every chat), free of prices and of contact facts
// typed outside the contact entry, and every /{lang}/… link resolves to a
// real service, page, project or section of the site.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..');
const DIR = join(ROOT, 'content', 'knowledge');
const read = f => JSON.parse(readFileSync(f, 'utf8'));
const slugsIn = sub => readdirSync(join(ROOT, 'content', sub)).filter(f => f.endsWith('.json')).map(f => f.replace(/\.json$/, ''));

// the shared contract's slug rule (same as migration 014) — never change it
const slugify = s => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
const GROUPS = ['company', 'services', 'process', 'commercial', 'legal', 'contact', 'projects', 'pitch', 'playbook', 'news'];

const LEGACY = read(join(ROOT, 'data-knowledge.json'));
const LEGACY_BY_SLUG = new Map(LEGACY.map(e => [slugify(e.title), e]));
const SERVICES = slugsIn('services');
const PROJECTS = slugsIn('projects');
const PAGES = [...slugsIn('pages'), 'contact'];
const NEW = ['contact-office', 'services-catalogue', ...SERVICES.map(s => `service-${s}`), 'how-cost-is-calculated',
  'contract-steps', 'payment-methods', 'our-commitments', 'client-obligations', 'ip-and-source-code',
  'cancellation-refund-complaints', 'privacy-summary', 'support-and-warranty', 'enamad-and-trust',
  'legal-answer-rule', 'news-section', 'faq-top'];

const files = readdirSync(DIR).filter(f => f.endsWith('.json'));
const KB = files.map(f => ({ file: f, ...read(join(DIR, f)) }));
const bySlug = new Map(KB.map(e => [e.slug, e]));
const bodies = e => [['en', e.body_en], ['fa', e.body_fa]];
const limitFor = e => (e.group === 'pitch' || e.group === 'projects' || e.slug.startsWith('service-') ? 700 : 900);

// "/{lang}/seg[/seg2]" — seg2 may be the literal "..." placeholder in playbook rows
const LINK = /\/\{lang\}\/([a-z0-9-]+)(?:\/([a-z0-9-]+|\.\.\.))?/g;
const links = text => [...text.matchAll(LINK)].map(m => ({ path: m[0], seg: m[1], sub: m[2] }));
// Persian prose minus what may legitimately carry Latin digits: links, URLs, emails, `code`
const prose = t => t.replace(LINK, '').replace(/https?:\/\/\S+/g, '').replace(/\S+@\S+/g, '').replace(/`[^`]*`/g, '');
const toLatin = s => s.replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));

test('every file parses, is named after its slug and carries every field in both languages', () => {
  assert.ok(KB.length >= LEGACY.length + NEW.length, `only ${KB.length} entries`);
  for (const e of KB) {
    const where = e.file;
    assert.equal(`${e.slug}.json`, e.file, `${where}: slug must match the file name`);
    assert.match(e.slug, /^[a-z0-9]+(-[a-z0-9]+)*$/, `${where}: slug`);
    assert.ok(e.slug.length <= 64, `${where}: slug > 64 chars`);
    assert.ok(typeof e.title === 'string' && e.title.trim(), `${where}: title`);
    assert.ok(GROUPS.includes(e.group), `${where}: group "${e.group}"`);
    assert.ok(typeof e.tags === 'string' && e.tags.trim(), `${where}: tags`);
    assert.ok(e.enabled === true || e.enabled === 1, `${where}: enabled`);
    assert.ok(Number.isInteger(e.sort) && e.sort >= 0, `${where}: sort`);
    for (const [l, t] of bodies(e)) assert.ok(typeof t === 'string' && t.trim().length > 40, `${where}: body_${l} is empty`);
  }
});

test('the 38 legacy entries keep slug = slugify(title), their tags and (pitches) their titles', () => {
  assert.equal(LEGACY_BY_SLUG.size, 38);
  for (const [slug, leg] of LEGACY_BY_SLUG) {
    const e = bySlug.get(slug);
    assert.ok(e, `legacy entry "${leg.title}" has no file ${slug}.json`);
    // tags + pitch titles feed ai.js industry detection — keep them stable
    assert.equal(e.tags, leg.tags, `${slug}: tags changed`);
    if (e.group === 'pitch') assert.equal(e.title, leg.title, `${slug}: pitch title changed`);
  }
  for (const slug of NEW) assert.ok(bySlug.has(slug), `missing new entry ${slug}`);
});

test('bodies fit the prompt budget', () => {
  let nonPitchFa = 0;
  for (const e of KB) {
    for (const [l, t] of bodies(e)) assert.ok(t.length <= limitFor(e), `${e.slug}: body_${l} is ${t.length} chars (limit ${limitFor(e)})`);
    if (e.group !== 'pitch') nonPitchFa += e.body_fa.length;
  }
  assert.ok(nonPitchFa <= 16000, `non-pitch Persian bodies total ${nonPitchFa} chars (limit 16000)`);
});

test('every /{lang}/ link resolves, both languages link the same pages, nothing is hard-coded to /fa/ or /en/', () => {
  for (const e of KB) {
    for (const [l, t] of bodies(e)) {
      const where = `${e.slug}: body_${l}`;
      assert.ok(!/(^|[\s(«:])\/(fa|en)(\/|\b)/.test(t), `${where} hard-codes a language path; use /{lang}/`);
      assert.ok(!/\{\{|\}\}|⟦|⟧/.test(t), `${where} has a template token the assistant would show verbatim`);
      for (const { path, seg, sub } of links(t)) {
        if (sub === '...') { assert.ok(e.group === 'playbook' && ['work', 'services'].includes(seg), `${where}: placeholder ${path}`); continue; }
        if (seg === 'services') assert.ok(!sub || SERVICES.includes(sub), `${where}: unknown service ${path}`);
        else if (seg === 'work') assert.ok(!sub || PROJECTS.includes(sub), `${where}: unknown project ${path}`);
        else if (seg === 'news') assert.ok(!sub, `${where}: ${path}`);
        else assert.ok(PAGES.includes(seg) && !sub, `${where}: unknown page ${path}`);
      }
    }
    const en = new Set(links(e.body_en).map(x => x.path));
    const fa = new Set(links(e.body_fa).map(x => x.path));
    assert.deepEqual([...fa].sort(), [...en].sort(), `${e.slug}: en and fa link different pages`);
  }
});

test('projects, services and pitches carry the links the assistant hands out', () => {
  const covered = new Set();
  for (const e of KB.filter(x => x.group === 'projects')) {
    const work = links(e.body_en).filter(x => x.seg === 'work' && x.sub);
    assert.equal(work.length, 1, `${e.slug}: needs exactly one /{lang}/work/<slug> link`);
    assert.ok(e.tags.split(',').includes(work[0].sub), `${e.slug}: tags must name ${work[0].sub}`);
    covered.add(work[0].sub);
  }
  assert.deepEqual([...covered].sort(), [...PROJECTS].sort(), 'every portfolio system has one project entry');
  for (const s of SERVICES) {
    const e = bySlug.get(`service-${s}`);
    assert.equal(e.group, 'services', `service-${s}: group`);
    assert.ok(links(e.body_en).some(x => x.seg === 'services' && x.sub === s), `service-${s}: links its own page`);
    assert.ok(/written proposal/.test(e.body_en) && /پیشنهاد کتبی/.test(e.body_fa), `service-${s}: says the cost is set in the written proposal`);
  }
  for (const e of KB.filter(x => x.group === 'pitch')) {
    for (const [l, t] of bodies(e)) {
      assert.ok(links(t).some(x => x.seg === 'work' && x.sub), `${e.slug}: body_${l} needs a /{lang}/work/ link`);
      assert.ok(links(t).some(x => x.seg === 'services'), `${e.slug}: body_${l} needs a /{lang}/services/ link`);
    }
    assert.match(e.body_en, /name and phone number for a free consultation\.$/, `${e.slug}: en must end with the consult invitation`);
    assert.match(e.body_fa, /شماره‌تان را بگذارید تا مشاورهٔ رایگان هماهنگ شود\.$/, `${e.slug}: fa must end with the consult invitation`);
  }
});

test('Persian is native and clean; English carries no Persian', () => {
  for (const e of KB) {
    const fa = e.body_fa, where = `${e.slug}: body_fa`;
    assert.ok(!/[يك]/.test(fa), `${where} uses Arabic ي/ك`);
    assert.ok(!/[0-9]/.test(prose(fa)), `${where} has Latin digits in Persian prose`);
    assert.ok(!/ه‌ی |ه ی /.test(fa), `${where} uses «ه‌ی» instead of «هٔ»`);
    assert.ok(!/(^|[\s«(])ن?می [؀-ۿ]/.test(fa), `${where} is missing a نیم‌فاصله after می`);
    assert.ok(!/ (ها|های|هایی|تر|ترین)[\s،.؛)]/.test(fa), `${where} is missing a نیم‌فاصله before a suffix`);
    assert.ok(!/[؀-ۿ]/.test(e.body_en), `${e.slug}: body_en contains Persian script`);
  }
});

test('nothing is priced, promised or invented', () => {
  const PRICE = /تومان|ریال|\$|€|£|\d{2,}[,٬]\d{3}|[۰-۹]{2,}[,٬][۰-۹]{3}|\b(tomans?|rials?)\b/i;
  const FORBIDDEN_EN = /guaranteed|world-class|cutting-edge|best-in-class|award-winning|\d+\+ (clients|projects|customers)/i;
  const FORBIDDEN_FA = /تضمینی|بهترین|۱۰۰٪|100%/;
  for (const e of KB) {
    for (const [l, t] of bodies(e)) assert.ok(!PRICE.test(t), `${e.slug}: body_${l} looks like a price`);
    assert.ok(!FORBIDDEN_EN.test(e.body_en), `${e.slug}: body_en makes an unverifiable claim`);
    assert.ok(!FORBIDDEN_FA.test(e.body_fa), `${e.slug}: body_fa makes an unverifiable claim`);
  }
});

test('no KB entry types contact facts: they come from the live CONTACT block (admin site info)', () => {
  const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
  const PHONE = /[0-9۰-۹][0-9۰-۹ -]{6,}[0-9۰-۹]|\+98/;
  const ADDRESS = /Adel Babaei|عادل بابایی/;
  for (const e of KB) {
    for (const [l, t] of bodies(e)) {
      assert.ok(!EMAIL.test(t), `${e.slug}: body_${l} types an email address`);
      assert.ok(!PHONE.test(t), `${e.slug}: body_${l} types a phone number`);
      assert.ok(!ADDRESS.test(t), `${e.slug}: body_${l} types the street address`);
    }
  }
  const c = bySlug.get('contact-office');
  assert.equal(c.group, 'contact');
  for (const [, t] of bodies(c)) assert.ok(t.includes('CONTACT'), 'contact entry points the model at the CONTACT block');
});
