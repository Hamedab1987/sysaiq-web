// W3 admin views (pages, services, sections, trust, seo, sms, media, audit,
// backup): each file is served as JS with its stylesheet, loads in Node
// (DOM-free module scope) and exports the view contract; the pure helpers
// behave; and one API round trip per view is accepted in the shape the view
// sends it.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { startTestApp } from '../helpers.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ADMIN = join(__dirname, '..', '..', 'admin');
const VIEWS = ['pages', 'services', 'sections', 'trust', 'seo', 'sms', 'media', 'audit', 'backup'];
const TITLES = { pages: 'صفحات', services: 'خدمات', sections: 'بخش‌های صفحهٔ اصلی', trust: 'اینماد و نمادها', seo: 'سئو و تگ‌های تأیید', sms: 'پنل پیامک', media: 'رسانه‌ها', audit: 'گزارش تغییرات', backup: 'پشتیبان‌گیری' };

let t;
before(async () => { t = await startTestApp({ env: { SMS_SEND_RATE_MAX: '1000' } }); await t.loginAsAdmin(); });
after(async () => { await t.close(); });

const json = async (path, opts) => { const r = await t.fetchAdmin(path, opts); return { status: r.status, body: await r.json() }; };
const view = name => import(pathToFileURL(join(ADMIN, 'js', 'views', `${name}.view.js`)).href);

test('every view is served as JS with its stylesheet and follows the shell rules', async () => {
  for (const v of VIEWS) {
    const js = await fetch(`${t.base}/admin/js/views/${v}.view.js`);
    assert.equal(js.status, 200, v);
    assert.match(js.headers.get('content-type'), /javascript/, v);
    const css = await fetch(`${t.base}/admin/css/views/${v}.css`);
    assert.equal(css.status, 200, `${v}.css`);
    assert.match(css.headers.get('content-type'), /text\/css/, `${v}.css`);
    const cssText = await css.text();
    assert.match(cssText, /^\s*(\/\*[^]*?\*\/\s*)?@layer views \{/, `${v}.css sits in the views layer`);
    assert.ok(!/\b(margin|padding)-(left|right)\s*:/.test(cssText), `${v}.css: logical properties only`);
    assert.ok(!/(^|[^-])\b(left|right)\s*:\s*[^;]+;/m.test(cssText), `${v}.css: no physical offsets`);
    const src = readFileSync(join(ADMIN, 'js', 'views', `${v}.view.js`), 'utf8');
    assert.ok(!/\.innerHTML\s*=|insertAdjacentHTML|outerHTML\s*=/.test(src), `${v}: no raw HTML`);
    assert.ok(!/\.style\.[a-zA-Z]+\s*=|setAttribute\(\s*'style'/.test(src), `${v}: no inline styles`);
    assert.match(src, /\/admin\/css\/views\/[\w-]+\.css/, `${v}: links its stylesheet`);
    for (const m of src.matchAll(/^\s*import\s[^'"]*['"]([^'"]+)['"]/gm)) assert.ok(['../ui.js', '../api.js', '../strings.js'].includes(m[1]), `${v} imports ${m[1]}`);
    assert.ok(!/store\.set\(\s*'dirty'/.test(src), `${v}: writes store.dirty directly`);
    assert.ok(!/\bfetch\(\s*['"`]\/api\/admin/.test(src), `${v}: admin calls go through api.js`);
  }
});

test('every view module loads in Node and exports the view contract', async () => {
  for (const v of VIEWS) {
    const m = await view(v);
    assert.equal(typeof m.default.mount, 'function', v);
    assert.equal(m.default.title, TITLES[v], v);
  }
});

test('pure helpers: heading parity, price detector, segment counter, JSON-LD extraction', async () => {
  const pages = await view('pages');
  assert.equal(pages.headingCount('## a\n\ntext\n### b\n#### c\n# not counted\n##nospace'), 3);
  assert.deepEqual(pages.TOKENS.slice(0, 2), ['site.brand', 'site.owner_name']);
  const services = await view('services');
  assert.ok(services.PRICE_RE.test('از ۱۲ میلیون تومان شروع می‌شود'));
  assert.ok(services.PRICE_RE.test('starts at 500 USD'));
  assert.ok(!services.PRICE_RE.test('هزینه به تعداد صفحات، ماژول‌ها و یکپارچه‌سازی‌ها بستگی دارد'));
  assert.equal(services.CATALOGUE.size, 10);
  const sms = await view('sms');
  assert.deepEqual(sms.countSegments(''), { chars: 0, segments: 0, encoding: 'gsm', perSegment: 160 });
  assert.equal(sms.countSegments('سلام').encoding, 'unicode');
  assert.equal(sms.countSegments('ا'.repeat(70)).segments, 1);
  assert.equal(sms.countSegments('ا'.repeat(71)).segments, 2);
  assert.equal(sms.countSegments('ا'.repeat(71)).perSegment, 67);
  assert.equal(sms.countSegments('a'.repeat(160)).segments, 1);
  assert.equal(sms.countSegments('a'.repeat(161)).segments, 2);
  assert.deepEqual(sms.placeholdersOf('سلام {{name}}، کد {{ code }} — {{name}}'), ['name', 'code']);
  const sections = await view('sections');
  assert.ok(sections.HREF_RE.test('/fa/contact') && sections.HREF_RE.test('#work') && sections.HREF_RE.test('https://x.y/z') && sections.HREF_RE.test('tel:+982833323002'));
  assert.ok(!sections.HREF_RE.test('javascript:alert(1)') && !sections.HREF_RE.test('http://x.y'));
  assert.ok(sections.EYEBROW_RE.test('SYSAIQ—PROCESS / SYS.05') && !sections.EYEBROW_RE.test('فرایند'));
  const seo = await view('seo');
  assert.ok(seo.CONTENT_RE.test('abc-123_=.:+/ x') && !seo.CONTENT_RE.test('<meta>'));
});

// ---- one API round trip per view, in the exact shape the view sends ----
test('pages: create draft → preview → publish is refused without English → publish with both languages', async () => {
  const create = await json('/pages', { method: 'POST', body: { slug: 'w3-page', kind: 'legal', title_fa: 'آزمون', title_en: '', body_fa: '## تیتر\n\nنشانی: {{site.address}}', body_en: '', meta_desc_fa: '', meta_desc_en: '', show_in_footer: 1, show_in_nav: 0, noindex: 0, version: '1.0', effective_at: '', legal_reviewed_at: '', sort: 0, published: 0 } });
  assert.equal(create.status, 200, JSON.stringify(create.body));
  const id = create.body.id;
  const preview = await json('/pages/preview', { method: 'POST', body: { body: '## تیتر\n\nمتن **پررنگ**', lang: 'fa', title: 'آزمون', kind: 'legal', version: '1.0', effective_at: '' } });
  assert.equal(preview.status, 200);
  assert.match(preview.body.html, /<h2[^>]*>تیتر<\/h2>/);
  assert.match(preview.body.html, /<strong>پررنگ<\/strong>/);
  const refused = await json(`/pages/${id}`, { method: 'PUT', body: { published: 1 } });
  assert.equal(refused.status, 422);
  assert.ok(refused.body.fields.title_en && refused.body.fields.published, 'the view maps title_en onto the English half');
  const ok = await json(`/pages/${id}`, { method: 'PUT', body: { title_en: 'Test', body_en: '## Heading', published: 1, legal_reviewed_at: '2026-09-22' } });
  assert.equal(ok.status, 200);
  const list = await json('/pages');
  const row = list.body.find(p => p.id === id);
  assert.equal(row.published, 1);
  assert.equal(row.legal_reviewed_at, '2026-09-22');
  const sys = list.body.find(p => p.system_key);
  const locked = await json(`/pages/${sys.id}`, { method: 'DELETE' });
  assert.equal(locked.status, 409, 'system pages cannot be deleted (the view hides the button)');
});

test('services: update with array list columns + related projects, parity 422 names the row field, reorder', async () => {
  const list = await json('/services');
  assert.equal(list.status, 200);
  const svc = list.body.find(s => s.slug === 'custom-website') || list.body[0];
  assert.ok(svc, 'catalogue is seeded');
  const bad = await json(`/services/${svc.id}`, { method: 'PUT', body: { published: 1, deliverables: [{ fa: 'سایت', en: '' }], process: [], faqs: [] } });
  assert.equal(bad.status, 422);
  assert.ok(Object.keys(bad.body.fields).some(k => /^deliverables\[0\]\.en$/.test(k)), JSON.stringify(bad.body.fields));
  const good = await json(`/services/${svc.id}`, { method: 'PUT', body: { published: 0, deliverables: [{ fa: 'سایت', en: 'Site' }], process: [{ title_fa: 'تحلیل', title_en: 'Discovery', desc_fa: '', desc_en: '' }], faqs: [{ q_fa: 'س', q_en: 'Q', a_fa: 'ج', a_en: 'A' }], related_projects: ['restaurant', 'realestate'], price_approach_fa: 'فقط عوامل هزینه', price_approach_en: 'Cost factors only' } });
  assert.equal(good.status, 200, JSON.stringify(good.body));
  const after = (await json(`/services/${svc.id}`)).body;
  assert.deepEqual(JSON.parse(after.related_projects), ['restaurant', 'realestate']);
  assert.equal(JSON.parse(after.deliverables)[0].en, 'Site');
  const ids = list.body.map(s => s.id).reverse();
  const re = await json('/services/reorder', { method: 'POST', body: { ids } });
  assert.equal(re.status, 200);
  const reordered = (await json('/services')).body.map(s => s.id);
  assert.deepEqual(reordered, ids);
  const locked = await json(`/services/${svc.id}`, { method: 'DELETE' });
  assert.equal(locked.status, 409, 'catalogue services cannot be deleted');
});

test('sections: create cards section with items, preview renders it, reorder within a placement', async () => {
  const mk = async (slug, sort) => json('/sections', { method: 'POST', body: { slug, type: 'cards', theme: 'light', placement: 'after_about', eyebrow: 'SYSAIQ—TEST / SYS.09', title_fa: 'کارت‌ها', title_en: 'Cards', body_fa: '', body_en: '', items: [{ title_fa: 'الف', title_en: 'A', desc_fa: '', desc_en: '', icon: 'zap' }], cta_label_fa: 'تماس', cta_label_en: 'Contact', cta_href: '/fa/contact', show_in_nav: 0, nav_label_fa: '', nav_label_en: '', sort, published: 1 } });
  const a = await mk('w3-cards-a', 10), b = await mk('w3-cards-b', 20);
  assert.equal(a.status, 200, JSON.stringify(a.body));
  assert.equal(b.status, 200);
  const bad = await json('/sections', { method: 'POST', body: { slug: 'w3-bad', type: 'richtext', eyebrow: 'فارسی' } });
  assert.equal(bad.status, 422);
  assert.ok(bad.body.fields.eyebrow);
  const pv = await json('/sections/preview', { method: 'POST', body: { slug: 'w3-cards-a', type: 'cards', placement: 'after_about', title_fa: 'کارت‌ها', title_en: 'Cards', items: [{ title_fa: 'الف', title_en: 'A', desc_fa: '', desc_en: '', icon: '' }], lang: 'fa' } });
  assert.equal(pv.status, 200);
  assert.match(pv.body.html, /الف/);
  const re = await json('/sections/reorder', { method: 'POST', body: { ids: [b.body.id, a.body.id] } });
  assert.equal(re.status, 200);
  const rows = (await json('/sections')).body.filter(s => s.placement === 'after_about' && /^w3-cards/.test(s.slug));
  assert.deepEqual(rows.map(s => s.id), [b.body.id, a.body.id]);
});

test('trust: parse an eNamad-shaped snippet, create the badge, toggle it, readiness inputs answer', async () => {
  const snippet = '<a referrerpolicy="origin" target="_blank" href="https://trustseal.enamad.ir/?id=123456&Code=AbCdEf123456"><img referrerpolicy="origin" src="https://trustseal.enamad.ir/logo.aspx?id=123456&Code=AbCdEf123456" alt="" style="cursor:pointer" code="AbCdEf123456"></a>';
  const parsed = await json('/badges/parse', { method: 'POST', body: { kind: 'enamad', snippet } });
  assert.equal(parsed.status, 200, JSON.stringify(parsed.body));
  assert.equal(parsed.body.seal_id, '123456');
  assert.equal(parsed.body.seal_code, 'AbCdEf123456');
  assert.match(parsed.body.preview, /badge-enamad/);
  assert.ok(!/onclick|<script/i.test(parsed.body.preview));
  const created = await json('/badges', { method: 'POST', body: { kind: 'enamad', snippet, label_fa: 'اینماد', label_en: 'eNamad', placement: 'both', langs: ['fa', 'en'], enabled: true, sort: 0, width: 0, height: 0 } });
  assert.equal(created.status, 200, JSON.stringify(created.body));
  assert.deepEqual(created.body.badge.langs, ['fa', 'en']);
  const off = await json(`/badges/${created.body.id}`, { method: 'PUT', body: { enabled: false } });
  assert.equal(off.status, 200);
  assert.equal(off.body.badge.enabled, 0);
  const bad = await json('/badges/parse', { method: 'POST', body: { kind: 'enamad', snippet: '<script>alert(1)</script>' } });
  assert.equal(bad.status, 422);
  for (const p of ['/setup-status', '/site-info', '/pages', '/head-meta']) assert.equal((await t.fetchAdmin(p)).status, 200, p);
});

test('seo: head-meta create/toggle/delete; sitemap, robots and the home JSON-LD are readable', async () => {
  const names = (await json('/head-meta')).body.names;
  assert.ok(names.includes('enamad') && names.includes('google-site-verification'));
  const created = await json('/head-meta', { method: 'POST', body: { name: 'google-site-verification', content: 'abc-DEF_123=', enabled: true } });
  assert.equal(created.status, 200, JSON.stringify(created.body));
  const bad = await json('/head-meta', { method: 'POST', body: { name: 'google-site-verification', content: '<meta>' } });
  assert.equal(bad.status, 422);
  const off = await json(`/head-meta/${created.body.id}`, { method: 'PUT', body: { enabled: false } });
  assert.equal(off.body.row.enabled, 0);
  assert.equal((await json(`/head-meta/${created.body.id}`, { method: 'DELETE' })).status, 200);
  assert.equal((await fetch(`${t.base}/sitemap.xml`)).status, 200);
  assert.equal((await fetch(`${t.base}/robots.txt`)).status, 200);
  const home = await fetch(`${t.base}/fa/`);
  assert.equal(home.status, 200);
  const { extractJsonLd } = await view('seo');
  const blocks = extractJsonLd(await home.text());
  assert.ok(blocks.length >= 1, 'the home page emits JSON-LD the view can show');
  assert.doesNotThrow(() => JSON.parse(blocks[0]));
});

test('sms: config PUT with the mock provider in the shape the settings tab sends; templates, manual send and log answer', async () => {
  const cfg = await json('/sms/config');
  assert.equal(cfg.status, 200);
  const mock = cfg.body.providers.find(p => p.id === 'mock');
  assert.ok(mock, 'mock provider is listed outside production');
  const put = await json('/sms/config', { method: 'PUT', body: { active: 'mock', fallback: '', owner_mobile: '09125130505', daily_cap: 200, per_number_daily_cap: 5, relay_base: '', events: Object.fromEntries(cfg.body.events.map(k => [k, true])), providers: { mock: { sender: '1000' } } } });
  assert.equal(put.status, 200, JSON.stringify(put.body));
  assert.equal(put.body.config.active, 'mock');
  assert.equal(put.body.config.providers.mock.sender, '1000');
  for (const p of put.body.providers) if (p.secret) assert.deepEqual(Object.keys(p.secret).sort(), ['configured', 'hint', 'source'], 'secrets come back as status only');
  const tpls = await json('/sms/templates');
  assert.equal(tpls.status, 200);
  assert.ok(tpls.body.items.some(x => x.key === 'lead_owner' && x.is_system));
  const created = await json('/sms/templates', { method: 'POST', body: { key: 'w3_hello', label_fa: 'سلام', label_en: 'Hello', body_fa: 'سلام {{name}}', body_en: 'Hi {{name}}', variables: ['name'], provider_map: {}, enabled: true } });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.deepEqual(created.body.item.placeholders, ['name']);
  const sent = await json('/sms/send', { method: 'POST', body: { to: '09121234567', template_key: 'w3_hello', text: '', params: { name: 'حامد' }, lang: 'fa' } });
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  const log = await json('/sms/log?page=1&per_page=50');
  assert.equal(log.status, 200);
  assert.ok(log.body.items.length >= 1 && log.body.statuses.includes('sent'));
  const refreshed = await json(`/sms/log/${log.body.items[0].id}/refresh-status`, { method: 'POST', body: {} });
  assert.equal(refreshed.status, 200);
  const credit = await json('/sms/credit?provider=mock');
  assert.equal(credit.status, 200);
});

test('media: upload answers a /uploads URL for a real image (the only server API the view needs)', async () => {
  // 1×1 PNG
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  const fd = new FormData();
  fd.append('file', new Blob([png], { type: 'image/png' }), 'dot.png');
  const r = await t.fetchAdmin('/upload', { method: 'POST', body: fd });
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.match(body.url, /^\/uploads\/[\w.-]+\.png$/);
  assert.equal((await t.fetchAdmin('/media')).status, 404, 'no listing API — the view says so and keeps a per-browser list');
});

test('audit + backup: the audit trail filters by entity, the system endpoints answer', async () => {
  const all = await json('/audit?page=1');
  assert.equal(all.status, 200);
  assert.ok(all.body.total >= 1 && all.body.per_page === 50);
  const only = await json('/audit?entity=badges&page=1');
  assert.ok(only.body.rows.length >= 1 && only.body.rows.every(r => r.entity === 'badges'));
  const sys = await json('/system');
  assert.equal(sys.status, 200);
  assert.ok(sys.body.node && Number.isInteger(sys.body.schema_version) && Number.isInteger(sys.body.uptime_s));
  const setup = await json('/setup-status');
  assert.equal(typeof setup.body.backup_recent, 'boolean');
  assert.equal((await json('/system/cache/purge', { method: 'POST', body: {} })).status, 200);
  assert.equal((await t.fetchAdmin('/backup')).status, 404, 'no backup endpoint — the view shows the CLI instead');
});
