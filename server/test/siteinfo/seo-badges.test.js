// sitemap/robots, JSON-LD, the badges + head-meta admin flows and their
// slots, /api/public/site, and the lead round trip in the form's payload shape.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startTestApp } from '../helpers.js';

const SITE_ASSETS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'vesper-project', 'assets', 'site');

let t, db, jsonld, footer, headMeta, jsonldSlot;
before(async () => {
  t = await startTestApp();
  ({ db } = await import('../../src/db/index.js'));
  jsonld = await import('../../src/lib/jsonld.js');
  footer = await import('../../src/render/slots/footer_trust.js');
  headMeta = await import('../../src/render/slots/head_meta.js');
  jsonldSlot = await import('../../src/render/slots/jsonld.js');
  db.prepare("INSERT INTO projects (slug, title_en, title_fa, published, sort) VALUES ('shop', 'Shop', 'فروشگاه', 1, 1), ('hidden', 'H', 'ه', 0, 2)").run();
  await t.loginAsAdmin();
});
after(async () => { await t.close(); });

const ENAMAD = `<a referrerpolicy='origin' target='_blank' href='https://trustseal.enamad.ir/?id=123456&Code=Ab9XyZ12Qw34'><img referrerpolicy='origin' src='https://trustseal.enamad.ir/logo.aspx?id=123456&Code=Ab9XyZ12Qw34' alt='' style='cursor:pointer' code='Ab9XyZ12Qw34'></a>`;
const ldBlocks = html => [...html.matchAll(/<script type="application\/ld\+json">([^]*?)<\/script>/g)].map(m => JSON.parse(m[1]));

test('GET /sitemap.xml: fa/en home + work + contact + published projects, each with hreflang alternates', async () => {
  const r = await fetch(`${t.base}/sitemap.xml`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /application\/xml/);
  const xml = await r.text();
  assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
  assert.ok(xml.includes('xmlns:xhtml="http://www.w3.org/1999/xhtml"'));
  for (const p of ['/fa/', '/en/', '/fa/work', '/en/work', '/fa/contact', '/en/contact', '/fa/work/shop', '/en/work/shop']) {
    assert.ok(xml.includes(`<loc>${t.base}${p}</loc>`), p);
  }
  assert.ok(!xml.includes('/work/hidden'));
  const home = xml.split('<url>').find(u => u.includes(`<loc>${t.base}/fa/</loc>`));
  assert.ok(home.includes(`<xhtml:link rel="alternate" hreflang="fa" href="${t.base}/fa/"/>`));
  assert.ok(home.includes(`<xhtml:link rel="alternate" hreflang="en" href="${t.base}/en/"/>`));
  assert.ok(home.includes(`<xhtml:link rel="alternate" hreflang="x-default" href="${t.base}/fa/"/>`));
  // published pages/services from the other workstreams' tables are picked up, unpublished + noindex are not
  // 'about' is seeded unpublished by migration 008; 'draft' is an owner-made unpublished page
  db.prepare("UPDATE pages SET published=1 WHERE slug='about'").run();
  db.prepare("INSERT INTO pages (slug, title_en, title_fa, published) VALUES ('draft', 'D', 'د', 0)").run();
  db.prepare("UPDATE services SET published=1 WHERE slug='web-app'").run(); // seeded unpublished by migration 009
  await t.fetchAdmin('/site-info', { method: 'PUT', body: (await import('../../src/lib/siteinfo.js')).SITE_INFO_DEFAULTS }); // any write drops the cache
  const xml2 = await (await fetch(`${t.base}/sitemap.xml`)).text();
  assert.ok(xml2.includes(`<loc>${t.base}/fa/about</loc>`) && xml2.includes(`<loc>${t.base}/en/services/web-app</loc>`) && xml2.includes(`<loc>${t.base}/fa/services</loc>`));
  assert.ok(!xml2.includes('/fa/draft'));
  assert.equal((xml2.match(/<loc>[^<]*\/fa\/contact<\/loc>/g) || []).length, 1, 'contact listed once');
});

test('GET /robots.txt: generated when the static site has none, static file wins otherwise', async () => {
  const r = await fetch(`${t.base}/robots.txt`);
  assert.equal(r.status, 200);
  const txt = await r.text();
  assert.ok(txt.includes('Disallow: /admin/') && txt.includes('Disallow: /api/') && txt.includes(`Sitemap: ${t.base}/sitemap.xml`));
  await writeFile(join(t.siteDir, 'robots.txt'), 'User-agent: *\nDisallow: /static-marker\n');
  const r2 = await fetch(`${t.base}/robots.txt`);
  assert.equal(r2.status, 200);
  assert.ok((await r2.text()).includes('/static-marker'));
});

test('JSON-LD: ProfessionalService has founder, Qazvin address, both phones; "</script>" in a field is neutralised', async () => {
  const ps = jsonld.professionalService('fa');
  assert.equal(ps['@type'], 'ProfessionalService');
  assert.equal(ps.name, 'SysaiQ');
  assert.equal(ps.founder.name, 'حامد ابوعلی');
  assert.equal(ps.address['@type'], 'PostalAddress');
  assert.equal(ps.address.addressLocality, 'قزوین');
  assert.equal(ps.address.addressCountry, 'IR');
  assert.deepEqual(ps.telephone, ['+982833323002', '+989125130505']);
  assert.equal(ps.email, 'hello@sysaiq.com');
  assert.equal(ps.areaServed.name, 'IR');
  assert.ok(!('sameAs' in ps) && !('geo' in ps), 'nothing fabricated');
  assert.equal(jsonld.professionalService('en').address.addressLocality, 'Qazvin');

  const { SITE_INFO_DEFAULTS } = await import('../../src/lib/siteinfo.js');
  const evil = structuredClone(SITE_INFO_DEFAULTS);
  evil.legal_name.fa = 'x</script><script>alert(1)</script>';
  evil.socials = [{ kind: 'github', url: 'https://github.com/sysaiq' }];
  const r = await t.fetchAdmin('/site-info', { method: 'PUT', body: evil });
  assert.equal(r.status, 200);
  const html = jsonld.jsonLdScript(jsonld.professionalService('fa'));
  assert.ok(!html.includes('</script><script>'), 'closing tag neutralised');
  assert.ok(html.includes('\\u003c/script>'));
  const parsed = ldBlocks(html)[0];
  assert.equal(parsed.founder.name, 'x</script><script>alert(1)</script>', 'still round-trips as data');
  assert.deepEqual(parsed.sameAs, ['https://github.com/sysaiq']);
  await t.fetchAdmin('/site-info', { method: 'PUT', body: SITE_INFO_DEFAULTS });

  const bc = jsonld.breadcrumb([{ name: 'خانه', url: '/fa/' }, { name: 'تماس', url: '/fa/contact' }]);
  assert.equal(bc.itemListElement[1].item, `${t.base}/fa/contact`);
  assert.equal(bc.itemListElement[1].position, 2);
  // home slot: ProfessionalService + FAQPage from published faqs
  db.prepare("INSERT INTO faqs (q_en, q_fa, a_en, a_fa, published) VALUES ('Q?', 'س؟', 'A.', 'ج.', 1), ('hidden', 'پ', 'x', 'y', 0)").run();
  const blocks = ldBlocks(jsonldSlot.renderJsonLdSlot('fa'));
  assert.deepEqual(blocks.map(b => b['@type']), ['ProfessionalService', 'FAQPage']);
  assert.deepEqual(blocks[1].mainEntity.map(q => q.name), ['س؟']);
});

test('show.* flags reach the JSON-LD and /api/public/site: a hidden landline/e-mail/address/socials/map never leaves the server', async () => {
  const { SITE_INFO_DEFAULTS } = await import('../../src/lib/siteinfo.js');
  const full = structuredClone(SITE_INFO_DEFAULTS);
  full.postal_code = '3413654321';
  full.geo = { lat: 36.268, lng: 50.004 };
  full.hours = { en: 'Sat–Wed 9–17', fa: 'شنبه تا چهارشنبه ۹ تا ۱۷' };
  full.hours_spec = [{ days: ['Sa', 'Su'], opens: '09:00', closes: '17:00' }];
  full.socials = [{ kind: 'github', url: 'https://github.com/sysaiq' }, { kind: 'whatsapp', url: 'https://wa.me/989125130505' }];
  full.map_url = { neshan: 'https://neshan.org/maps/@36.268,50.004', balad: '', google: '' };
  // everything visible: the crawler and the API get the whole picture
  assert.equal((await t.fetchAdmin('/site-info', { method: 'PUT', body: full })).status, 200);
  const shown = jsonld.professionalService('fa');
  assert.deepEqual(shown.telephone, ['+982833323002', '+989125130505']);
  assert.equal(shown.address.streetAddress, full.address.fa);
  assert.equal(shown.address.postalCode, '3413654321');
  assert.equal(shown.email, 'hello@sysaiq.com');
  assert.deepEqual(shown.geo, { '@type': 'GeoCoordinates', latitude: 36.268, longitude: 50.004 });
  assert.deepEqual(shown.sameAs, ['https://github.com/sysaiq', 'https://wa.me/989125130505']);
  assert.equal(shown.openingHoursSpecification.length, 1);

  // the owner hides the landline, the e-mail, the address, the socials and the map
  const hidden = { ...full, show: { ...full.show, landline: false, email: false, address: false, socials: false, map: false, hours: false } };
  assert.equal((await t.fetchAdmin('/site-info', { method: 'PUT', body: hidden })).status, 200);
  const ps = jsonld.professionalService('fa');
  assert.equal(ps.telephone, '+989125130505', 'only the visible number, as a single value');
  assert.ok(!('email' in ps), 'hidden e-mail omitted, not blanked');
  assert.ok(!('streetAddress' in ps.address) && !('postalCode' in ps.address), 'street + postal code omitted');
  assert.equal(ps.address.addressLocality, 'قزوین', 'city stays: it is in the public tagline');
  assert.ok(!('geo' in ps) && !('sameAs' in ps) && !('openingHoursSpecification' in ps));
  assert.ok(!JSON.stringify(ps).includes('982833323002'));
  // the same object is what the rendered pages embed
  for (const html of [await (await fetch(`${t.base}/fa/contact`)).text(), jsonldSlot.renderJsonLdSlot('fa')]) {
    const block = ldBlocks(html).find(b => b['@type'] === 'ProfessionalService');
    assert.equal(block.telephone, '+989125130505');
    assert.ok(!('email' in block) && !('streetAddress' in block.address) && !('sameAs' in block));
  }
  // the public API: hidden phone removed, hidden text blanked, same shape as before
  const pub = (await t.json('/api/public/site')).body.site_info;
  assert.deepEqual(Object.keys(pub).sort(), Object.keys(SITE_INFO_DEFAULTS).sort());
  assert.deepEqual(pub.phones.map(p => p.e164), ['+989125130505']);
  assert.equal(pub.email, '');
  assert.deepEqual(pub.address, { en: '', fa: '' });
  assert.equal(pub.postal_code, '');
  assert.equal(pub.geo, null);
  assert.deepEqual(pub.socials, []);
  assert.deepEqual(pub.map_url, { neshan: '', balad: '', google: '' });
  assert.deepEqual(pub.hours, { en: '', fa: '' });
  assert.deepEqual(pub.hours_spec, []);
  assert.ok(!JSON.stringify(pub).includes('982833323002') && !JSON.stringify(pub).includes('github.com'));
  // the admin still edits the stored values
  const adm = (await (await t.fetchAdmin('/site-info')).json()).site_info;
  assert.deepEqual(adm.phones.map(p => p.e164), ['+982833323002', '+989125130505']);
  assert.equal(adm.email, 'hello@sysaiq.com');
  assert.equal(adm.socials.length, 2);
  // a hidden mobile alone → no telephone key at all
  assert.equal((await t.fetchAdmin('/site-info', { method: 'PUT', body: { ...full, show: { ...full.show, landline: false, mobile: false } } })).status, 200);
  assert.ok(!('telephone' in jsonld.professionalService('en')));
  assert.deepEqual((await t.json('/api/public/site')).body.site_info.phones, []);
  await t.fetchAdmin('/site-info', { method: 'PUT', body: SITE_INFO_DEFAULTS });
});

test('badges: parse → create → footer slot + /api/public/site; tampering and unknown ids are refused', async () => {
  const parse = await t.fetchAdmin('/badges/parse', { method: 'POST', body: { kind: 'enamad', snippet: ENAMAD } });
  assert.equal(parse.status, 200);
  const p = await parse.json();
  assert.equal(p.seal_id, '123456');
  assert.equal(p.seal_code, 'Ab9XyZ12Qw34');
  assert.ok(p.preview.includes('referrerpolicy="origin"') && p.preview.includes('code="Ab9XyZ12Qw34"'));
  assert.equal(db.prepare('SELECT COUNT(*) c FROM badges').get().c, 0, 'parse stores nothing');

  const bad = await t.fetchAdmin('/badges/parse', { method: 'POST', body: { kind: 'enamad', snippet: '<a href="https://trustseal.enamad.ir.evil.com/?id=1&Code=abcd">' } });
  assert.equal(bad.status, 422);
  assert.match((await bad.json()).fields.snippet, /[\u0600-\u06FF]/);

  assert.equal(footer.renderFooterTrustSlot('fa'), '', 'no badges yet');
  const create = await t.fetchAdmin('/badges', { method: 'POST', body: { kind: 'enamad', snippet: ENAMAD, label_fa: 'اینماد', label_en: 'eNamad', placement: 'both', langs: ['fa'], width: 125 } });
  assert.equal(create.status, 200, JSON.stringify(await create.clone().json()));
  const c = await create.json();
  assert.ok(Number.isInteger(c.id));
  const row = db.prepare('SELECT * FROM badges WHERE id=?').get(c.id);
  assert.equal(row.seal_code, 'Ab9XyZ12Qw34');
  assert.equal(row.link_url, 'https://trustseal.enamad.ir/?id=123456&Code=Ab9XyZ12Qw34');
  assert.ok(!row.link_url.includes('onclick'));
  assert.equal(row.langs, 'fa');

  const fa = footer.renderFooterTrustSlot('fa');
  assert.ok(fa.includes('<div class="trust-strip" data-placement="footer">'));
  assert.ok(fa.includes('<div class="trust-tile"><a class="badge badge-enamad" referrerpolicy="origin"'));
  assert.ok(fa.includes('src="https://trustseal.enamad.ir/logo.aspx?id=123456&amp;Code=Ab9XyZ12Qw34"') && fa.includes('width="125"'));
  assert.equal(footer.renderFooterTrustSlot('en'), '', 'langs=fa only');
  assert.ok(footer.renderTrustStrip('fa', 'contact').includes('badge-enamad'), 'placement both → contact too');
  assert.equal(typeof footer.renderFooterTrust, 'function', 'name lib/sitecontext.js looks up');
  // the /fa/contact page footer (shared layout) now shows it
  const page = await (await fetch(`${t.base}/fa/contact`)).text();
  assert.ok(page.includes('badge-enamad'));
  // and the page CSP lists the trust hosts once a badge rendered
  const csp = (await fetch(`${t.base}/fa/contact`)).headers.get('content-security-policy');
  assert.ok(csp.includes('https://trustseal.enamad.ir'));

  const pub = (await t.json('/api/public/site')).body;
  assert.deepEqual(Object.keys(pub).sort(), ['badges', 'footer_pages', 'site_info']);
  assert.equal(pub.badges.length, 1);
  assert.equal(pub.badges[0].seal_id, '123456');
  assert.ok(!('seal_code' in pub.badges[0]), 'the code is not needed by the client');
  assert.equal(pub.site_info.email, 'hello@sysaiq.com');
  assert.ok(Array.isArray(pub.footer_pages));

  // update: disable + relabel without a snippet keeps the seal fields; then delete
  const upd = await t.fetchAdmin(`/badges/${c.id}`, { method: 'PUT', body: { enabled: false, label_fa: 'نماد', placement: 'footer' } });
  assert.equal(upd.status, 200);
  assert.equal(db.prepare('SELECT enabled, seal_code, placement FROM badges WHERE id=?').get(c.id).seal_code, 'Ab9XyZ12Qw34');
  assert.equal(footer.renderFooterTrustSlot('fa'), '');
  assert.equal((await t.fetchAdmin('/badges/999', { method: 'PUT', body: { enabled: true } })).status, 404);
  assert.equal((await t.fetchAdmin(`/badges/${c.id}`, { method: 'PUT', body: { placement: 'sidebar' } })).status, 422);
  const custom = await t.fetchAdmin('/badges', { method: 'POST', body: { kind: 'custom_image', img_url: 'https://cdn.evil/x.png', link_url: 'https://ok.example/' } });
  assert.equal(custom.status, 422);
  const del = await t.fetchAdmin(`/badges/${c.id}`, { method: 'DELETE' });
  assert.equal(del.status, 200);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM badges').get().c, 0);
  assert.ok(db.prepare("SELECT COUNT(*) c FROM audit_log WHERE entity='badges'").get().c >= 3);
});

test('head-meta: allowlisted CRUD → the HEAD_META slot; anything else is 422', async () => {
  const ok = await t.fetchAdmin('/head-meta', { method: 'POST', body: { name: 'enamad', content: '12345678' } });
  assert.equal(ok.status, 200);
  const { id } = await ok.json();
  const g = await t.fetchAdmin('/head-meta', { method: 'POST', body: { name: 'google-site-verification', content: 'AbC-xyz_123' } });
  assert.equal(g.status, 200);
  for (const body of [{ name: 'refresh', content: '0;url=https://evil' }, { name: 'enamad', content: 'x"><script>' }, { name: 'enamad', content: '' }]) {
    const r = await t.fetchAdmin('/head-meta', { method: 'POST', body });
    assert.equal(r.status, 422, JSON.stringify(body));
  }
  assert.equal(headMeta.renderHeadMetaSlot(), '<meta name="enamad" content="12345678">\n<meta name="google-site-verification" content="AbC-xyz_123">');
  const off = await t.fetchAdmin(`/head-meta/${id}`, { method: 'PUT', body: { enabled: false } });
  assert.equal(off.status, 200);
  assert.equal(headMeta.renderHeadMetaSlot(), '<meta name="google-site-verification" content="AbC-xyz_123">');
  assert.equal((await t.fetchAdmin(`/head-meta/${id}`, { method: 'PUT', body: { name: 'viewport' } })).status, 422);
  const list = await (await t.fetchAdmin('/head-meta')).json();
  assert.equal(list.rows.length, 2);
  assert.ok(list.names.includes('p:domain_verify'));
  assert.equal((await t.fetchAdmin(`/head-meta/${id}`, { method: 'DELETE' })).status, 200);
  assert.equal((await t.fetchAdmin('/head-meta/424242', { method: 'DELETE' })).status, 404);
});

test('POST /api/leads with exactly the payload shape /assets/site/contact.js sends → stored, visible in the admin', async () => {
  // the privacy consent travels with the request (Foundation's lib/leads.js is to
  // stamp consent_at from it; until then the key is dropped, never refused)
  const payload = {
    name: 'علی احمدی', phone: '09125130505', email: 'ali@example.com', business_type: 'restaurant-cafe',
    message: 'سلام، برای رستوران سایت می‌خواهم.', contact_pref: 'whatsapp', language: 'fa', page: '/fa/', website: '',
    consent: true,
  };
  const src = await readFile(join(SITE_ASSETS, 'contact.js'), 'utf8');
  assert.ok(src.includes('consent: !!(f.consent && f.consent.checked)') && !src.includes('delete body.consent'), 'the widget sends consent');
  const r = await t.json('/api/leads', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(payload) });
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  const list = await (await t.fetchAdmin('/leads')).json();
  const lead = list.find(l => l.id === r.body.id);
  assert.ok(lead, 'lead listed in GET /api/admin/leads');
  assert.equal(lead.name, 'علی احمدی');
  assert.equal(lead.phone, '09125130505');
  assert.equal(lead.phone_norm, '09125130505');
  assert.equal(lead.business_type, 'restaurant-cafe');
  assert.equal(lead.contact_pref, 'whatsapp');
  assert.equal(lead.language, 'fa');
  assert.equal(lead.page, '/fa/');
  assert.equal(lead.source, 'form');
  // the honeypot filled → accepted but not stored (the bot learns nothing)
  const bot = await t.json('/api/leads', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...payload, website: 'http://spam' }) });
  assert.equal(bot.status, 200);
  assert.equal(bot.body.id, undefined);
  // the field errors the widget maps back onto its inputs
  const bad = await t.json('/api/leads', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...payload, email: 'nope', phone: '' }) });
  assert.equal(bad.status, 422);
  assert.ok(bad.body.fields.email);
});

test('contact.css: labels that carry meaning use --dim (readable), --faint is left to decoration', async () => {
  const css = await readFile(join(SITE_ASSETS, 'contact.css'), 'utf8');
  const rule = sel => (css.match(new RegExp(`${sel.replace(/[.\s]/g, m => (m === '.' ? '\\.' : '\\s+'))}\\{([^}]*)\\}`)) || [])[1] || '';
  for (const sel of ['.ct-field label small', '.ct-label']) {
    const body = rule(sel);
    assert.ok(body, `${sel} rule present`);
    assert.ok(body.includes('var(--dim'), `${sel} uses --dim: ${body}`);
    assert.ok(!body.includes('--faint'), `${sel} not --faint`);
  }
  assert.ok(/\.ct-field label small\{[^}]*font-size:12px/.test(css), 'hint at 12px');
});
