// settings.site_info: migration seed, lib/siteinfo.js views + tokens, the
// admin GET/PUT validation, the contact slot and the /:lang/contact page.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp } from '../helpers.js';

let t, db, si, slot, registry;
before(async () => {
  t = await startTestApp();
  db = await import('../../src/db/index.js');
  si = await import('../../src/lib/siteinfo.js');
  slot = await import('../../src/render/slots/contact.js');
  registry = await import('../../src/lib/registry.js');
  await t.loginAsAdmin();
});
after(async () => { await t.close(); });

test('migration 005 seeds the FACTS row on a fresh install; an upgraded database only gets one for an edited legacy contact_email', async () => {
  // fresh test database: the settings table was empty when 005 ran → the row exists with the FACTS values
  assert.deepEqual(db.getSetting('site_info', null), si.SITE_INFO_DEFAULTS, 'seeded on a fresh install');
  const { up } = await import('../../src/db/migrations/005_site_info.js');
  up(db.db); // idempotent: an existing row is left alone
  assert.deepEqual(db.getSetting('site_info'), si.SITE_INFO_DEFAULTS);
  db.db.prepare("DELETE FROM settings WHERE key='site_info'").run();
  // upgrade of a live database (other settings rows exist), legacy admin kept the default e-mail → no new row
  db.setSetting('contact_email', { en: 'hello@sysaiq.com', fa: 'hello@sysaiq.com' });
  up(db.db);
  assert.equal(db.getSetting('site_info', null), null, 'Foundation upgrade test: no new settings rows on an existing database');
  // legacy admin changed it → the row is seeded with that e-mail and the FACTS values
  db.setSetting('contact_email', { en: 'Owner@Example.com', fa: 'owner@example.com' });
  up(db.db);
  assert.equal(db.getSetting('site_info').email, 'owner@example.com');
  assert.equal(si.publicSiteInfo().email, 'owner@example.com');
  up(db.db); // idempotent
  db.db.prepare("DELETE FROM settings WHERE key IN ('site_info', 'contact_email')").run();

  // without a row the defaults come from code (an upgraded database before the owner's first save)
  const row = si.publicSiteInfo();
  assert.deepEqual(row, si.SITE_INFO_DEFAULTS);
  assert.equal(row.brand, 'SysaiQ');
  assert.equal(row.email, 'hello@sysaiq.com');
  assert.equal(row.country, 'IR');
  assert.deepEqual(row.phones.map(p => p.e164), ['+982833323002', '+989125130505']);
  assert.equal(row.phones[0].display_fa, '۰۲۸-۳۳۳۲۳۰۰۲');
  assert.equal(row.phones[1].display_fa, '۰۹۱۲ ۵۱۳ ۰۵۰۵');
  assert.equal(row.address.fa, 'قزوین، خیابان توحید، کوچه قویدل (آشنا)، کوچه عادل بابایی، پلاک ۲۵');
  assert.equal(row.address.en, 'No. 25, Adel Babaei Alley, Ghavidel (Ashna) Alley, Tohid St., Qazvin, Iran');
  assert.equal(row.postal_code, '');
  assert.deepEqual(row.hours, { en: '', fa: '' });
  assert.deepEqual(row.socials, []);
  assert.deepEqual(Object.keys(row).sort(), Object.keys(si.SITE_INFO_DEFAULTS).sort());
  assert.equal(registry.isRegisteredSetting('site_info'), true);
  assert.equal(registry.isPublicSetting('site_info'), false, 'the generic bilingual settings API must not touch it');
});

test('the generic settings API cannot overwrite site_info with a {en,fa} blob', async () => {
  db.setSetting('site_info', si.SITE_INFO_DEFAULTS);
  const r = await t.fetchAdmin('/settings/site_info', { method: 'PUT', body: { value: { en: 'x', fa: 'y' } } });
  assert.equal(r.status, 400);
  assert.deepEqual(db.getSetting('site_info'), si.SITE_INFO_DEFAULTS, 'untouched');
  const content = (await t.json('/api/content')).body;
  assert.ok(!('site_info' in content.settings), 'the public view is /api/public/site, not /api/content');
});

test('getSiteInfo / tokens: display strings, tel: links, mailto, flat keys for the shared chrome', () => {
  const fa = si.getSiteInfo('fa');
  assert.equal(fa.landline_phone.tel, 'tel:+982833323002');
  assert.equal(fa.landline, '۰۲۸-۳۳۳۲۳۰۰۲');
  assert.equal(fa.landline_tel, '+982833323002');
  assert.equal(fa.mobile, '۰۹۱۲ ۵۱۳ ۰۵۰۵');
  assert.equal(fa.mobile_tel, '+989125130505');
  assert.equal(fa.mailto, 'mailto:hello@sysaiq.com');
  assert.equal(fa.owner_name, 'حامد ابوعلی');
  assert.equal(fa.city, 'قزوین');
  assert.equal(fa.hours, '');
  assert.equal(fa.map_url, '');
  assert.deepEqual(fa.map_links, []);
  const en = si.getSiteInfo('en');
  assert.equal(en.owner_name, 'Hamed Abooali');
  assert.equal(en.mobile, '+98 912 513 0505');
  assert.equal(en.address, 'No. 25, Adel Babaei Alley, Ghavidel (Ashna) Alley, Tohid St., Qazvin, Iran');
  assert.deepEqual(si.tokens('fa'), {
    'site.address': 'قزوین، خیابان توحید، کوچه قویدل (آشنا)، کوچه عادل بابایی، پلاک ۲۵',
    'site.landline': '۰۲۸-۳۳۳۲۳۰۰۲', 'site.mobile': '۰۹۱۲ ۵۱۳ ۰۵۰۵', 'site.email': 'hello@sysaiq.com',
    'site.hours': 'اعلام‌نشده', 'site.owner_name': 'حامد ابوعلی', 'site.brand': 'SysaiQ',
  });
  assert.equal(si.tokens('en')['site.hours'], 'not specified');
  assert.equal(si.isContactComplete(), true);
});

test('a corrupted row never crashes a render: unknown keys dropped, bad phones skipped, defaults restored', () => {
  db.setSetting('site_info', { en: 'x', fa: 'y', phones: [{ type: 'fax', e164: '1' }, { type: 'mobile', e164: '+989120000000' }], evil: 1, email: 'not-an-email' });
  const pub = si.publicSiteInfo();
  assert.deepEqual(Object.keys(pub).sort(), Object.keys(si.SITE_INFO_DEFAULTS).sort());
  assert.deepEqual(pub.phones.map(p => p.e164), ['+989120000000']);
  assert.equal(pub.phones[0].display_fa, '۰۹۱۲۰۰۰۰۰۰۰');
  assert.equal(pub.email, 'hello@sysaiq.com');
  assert.equal(pub.address.fa.length > 0, true);
  assert.equal(si.isContactComplete(), true);
  db.setSetting('site_info', si.SITE_INFO_DEFAULTS);
});

test('GET /api/admin/site-info → the object + completeness + options', async () => {
  const r = await t.fetchAdmin('/site-info');
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.site_info.email, 'hello@sysaiq.com');
  assert.equal(j.complete, true);
  assert.deepEqual(j.options.social_kinds, ['whatsapp', 'telegram', 'instagram', 'linkedin', 'github', 'x']);
  assert.ok(j.options.business_types.some(b => b.value === 'other' && b.fa === 'سایر'));
});

const good = () => ({
  brand: 'SysaiQ',
  legal_name: { en: 'Hamed Abooali', fa: 'حامد ابوعلی' },
  address: { en: 'No. 25 …', fa: 'قزوین …' },
  city: { en: 'Qazvin', fa: 'قزوین' }, region: { en: 'Qazvin', fa: 'قزوین' }, country: 'IR',
  postal_code: '۳۴۱۳۶-۵۴۳۲۱',
  geo: { lat: '۳۶.۲۶۸', lng: '50.004' },
  phones: [
    { type: 'landline', e164: '+98 28 3332 3002', display_fa: '', display_en: '' },
    { type: 'mobile', e164: '+۹۸۹۱۲۵۱۳۰۵۰۵', display_fa: '۰۹۱۲ ۵۱۳ ۰۵۰۵', display_en: '+98 912 513 0505' },
  ],
  email: 'Hello@SysaiQ.com',
  hours: { en: 'Sat–Wed 9–17', fa: 'شنبه تا چهارشنبه ۹ تا ۱۷' },
  hours_spec: [{ days: ['Sa', 'Su', 'Mo', 'Tu', 'We'], opens: '۰۹:۰۰', closes: '17:00' }],
  socials: [{ kind: 'whatsapp', url: 'https://wa.me/989125130505' }, { kind: 'telegram', url: 'https://t.me/sysaiq' }],
  map_url: { neshan: 'https://neshan.org/maps/@36.268,50.004', balad: '', google: 'https://maps.google.com/?q=36.268,50.004' },
  show: { address: true, landline: true, mobile: true, email: true, hours: true, map: true, socials: false },
});

test('PUT /api/admin/site-info: Persian digits normalised, phones as E.164, email lowercased, exact shape stored', async () => {
  const r = await t.fetchAdmin('/site-info', { method: 'PUT', body: good() });
  assert.equal(r.status, 200, JSON.stringify(await r.clone().json()));
  const j = await r.json();
  assert.equal(j.ok, true);
  const s = db.getSetting('site_info');
  assert.deepEqual(s, j.site_info);
  assert.equal(s.postal_code, '34136-54321');
  assert.deepEqual(s.geo, { lat: 36.268, lng: 50.004 });
  assert.equal(s.phones[0].e164, '+982833323002');
  assert.equal(s.phones[0].display_fa, '۰۲۸۳۳۳۲۳۰۰۲', 'derived when empty');
  assert.equal(s.phones[0].display_en, '+982833323002');
  assert.equal(s.phones[1].e164, '+989125130505');
  assert.equal(s.email, 'hello@sysaiq.com');
  assert.equal(s.hours_spec[0].opens, '09:00');
  assert.equal(s.map_url.balad, '');
  assert.equal(s.show.socials, false);
  assert.ok(!('evil' in s));
  // hidden socials → the view exposes none, but the stored urls stay
  const v = si.getSiteInfo('fa');
  assert.equal(v.whatsapp, '');
  assert.equal(v.map_url, 'https://neshan.org/maps/@36.268,50.004');
  assert.equal(v.hours, 'شنبه تا چهارشنبه ۹ تا ۱۷');
  // audit row names fields only, never values
  const a = db.db.prepare("SELECT * FROM audit_log WHERE entity='site_info' ORDER BY id DESC").get();
  assert.ok(a && a.summary.startsWith('site_info:'));
  assert.ok(!a.summary.includes('wa.me') && !a.meta.includes('wa.me'));
  // the {site_info: {...}} envelope is accepted too
  const r2 = await t.fetchAdmin('/site-info', { method: 'PUT', body: { site_info: si.SITE_INFO_DEFAULTS } });
  assert.equal(r2.status, 200);
  assert.deepEqual(db.getSetting('site_info'), si.SITE_INFO_DEFAULTS);
});

test('PUT /api/admin/site-info: bad phone / http url / unknown social / overlong text → 422 with fields', async () => {
  const cases = [
    [{ phones: [{ type: 'mobile', e164: '0912-513-0505' }] }, 'phones[0].e164'],
    [{ phones: [{ type: 'mobile', e164: '+98 912 513 0505 ext 1' }] }, 'phones[0].e164'],
    [{ phones: [{ type: 'fax', e164: '+989125130505' }] }, 'phones[0].type'],
    [{ socials: [{ kind: 'whatsapp', url: 'http://wa.me/1' }] }, 'socials[0].url'],
    [{ socials: [{ kind: 'tiktok', url: 'https://tiktok.com/@x' }] }, 'socials[0].kind'],
    [{ map_url: { neshan: 'javascript:alert(1)' } }, 'map_url.neshan'],
    [{ email: 'nope' }, 'email'],
    [{ country: 'Iran' }, 'country'],
    [{ postal_code: '34136 x' }, 'postal_code'],
    [{ geo: { lat: '91', lng: '50' } }, 'geo.lat'],
    [{ address: { en: 'x'.repeat(301), fa: 'y' } }, 'address.en'],
    [{ hours_spec: [{ days: ['Xx'], opens: '09:00', closes: '17:00' }] }, 'hours_spec[0].days'],
    [{ hours_spec: [{ days: ['Mo'], opens: '25:00', closes: '17:00' }] }, 'hours_spec[0].opens'],
    [{ legal_name: 'plain string' }, 'legal_name'],
  ];
  for (const [patch, field] of cases) {
    const r = await t.fetchAdmin('/site-info', { method: 'PUT', body: { ...good(), ...patch } });
    const j = await r.json();
    assert.equal(r.status, 422, JSON.stringify(patch));
    assert.equal(j.error, 'validation');
    assert.ok(j.fields[field], `${field} in ${JSON.stringify(j.fields)}`);
  }
  const dup = await t.fetchAdmin('/site-info', { method: 'PUT', body: { ...good(), socials: [{ kind: 'x', url: 'https://x.com/a' }, { kind: 'x', url: 'https://x.com/b' }] } });
  assert.equal(dup.status, 422);
  assert.deepEqual(db.getSetting('site_info'), si.SITE_INFO_DEFAULTS, 'nothing stored on failure');
});

test('contact slot: form posting to /api/leads (honeypot, consent → privacy, hidden lang/page) + click-to-call info', () => {
  const html = slot.renderContactSlot('fa');
  // both assets carry the mtime version (nginx caches /assets/ for 7 days)
  assert.match(slot.CONTACT_ASSET_V, /^[0-9a-z]+$/);
  assert.equal(slot.CONTACT_CSS, `/assets/site/contact.css?v=${slot.CONTACT_ASSET_V}`);
  assert.equal(slot.CONTACT_JS, `/assets/site/contact.js?v=${slot.CONTACT_ASSET_V}`);
  assert.ok(html.includes(`<link rel="stylesheet" href="${slot.CONTACT_CSS}">`));
  assert.ok(html.includes(`<script src="${slot.CONTACT_JS}" defer></script>`));
  assert.ok(html.includes('action="/api/leads"') && html.includes('data-lead-form') && html.includes('data-lang="fa"'));
  assert.ok(html.includes('name="website"') && html.includes('tabindex="-1"'));
  assert.ok(html.includes('<input type="hidden" name="language" value="fa">'));
  assert.ok(html.includes('<input type="hidden" name="page" value="/fa/">'));
  for (const n of ['name', 'phone', 'email', 'business_type', 'message', 'contact_pref', 'consent']) assert.ok(html.includes(`name="${n}"`), n);
  assert.ok(html.includes('href="/fa/privacy"') && html.includes('href="/fa/charter"'));
  assert.ok(html.includes('<option value="other">سایر</option>') && html.includes('<option value="restaurant-cafe">رستوران و کافه</option>'));
  assert.ok(html.includes('href="tel:+982833323002"') && html.includes('href="tel:+989125130505"'));
  assert.ok(html.includes('۰۲۸-۳۳۳۲۳۰۰۲') && html.includes('۰۹۱۲ ۵۱۳ ۰۵۰۵'));
  assert.ok(html.includes('href="mailto:hello@sysaiq.com"'));
  assert.ok(html.includes('قزوین، خیابان توحید، کوچه قویدل (آشنا)، کوچه عادل بابایی، پلاک ۲۵'));
  assert.ok(!/\son[a-z]+=/i.test(html), 'no inline handlers');
  assert.ok(!/<script(?![^>]*\bsrc=)/i.test(html), 'no inline script');
  assert.ok(!html.includes('<iframe'));
  // no services table rows published → no service select; whatsapp/telegram absent until configured
  assert.ok(!html.includes('ct-chat'));
  const en = slot.renderContactSlot('en');
  assert.ok(en.includes('data-lang="en"') && en.includes('href="/en/privacy"') && en.includes('+98 28 3332 3002'));
  assert.ok(en.includes('No. 25, Adel Babaei Alley'));
});

test('contact slot follows the admin: WhatsApp/Telegram buttons, map links, hidden landline', async () => {
  const r = await t.fetchAdmin('/site-info', { method: 'PUT', body: { ...good(), show: { ...good().show, socials: true, landline: false } } });
  assert.equal(r.status, 200);
  const html = slot.renderContactSlot('fa');
  assert.ok(html.includes('class="ct-chat ct-wa" href="https://wa.me/989125130505" target="_blank" rel="noopener noreferrer"'));
  assert.ok(html.includes('href="https://t.me/sysaiq"'));
  assert.ok(html.includes('href="https://neshan.org/maps/@36.268,50.004"') && html.includes('href="https://maps.google.com/?q=36.268,50.004"'));
  assert.ok(!html.includes('tel:+982833323002'), 'landline hidden');
  assert.ok(html.includes('tel:+989125130505'));
  assert.ok(html.includes('شنبه تا چهارشنبه ۹ تا ۱۷'));
  // the view keeps no hidden number in any flat key the shared chrome might print
  const v = si.getSiteInfo('fa');
  assert.equal(v.landline, '');
  assert.equal(v.landline_tel, '');
  assert.equal(v.landline_phone.visible, false, 'landline_phone stays for tokens(), flagged');
  assert.equal(si.tokens('fa')['site.landline'], '۰۲۸۳۳۳۲۳۰۰۲', 'an explicit {{site.landline}} token is the owner\'s choice');
  await t.fetchAdmin('/site-info', { method: 'PUT', body: si.SITE_INFO_DEFAULTS });
});

test('GET /fa/contact and /en/contact: full page, indexable, JSON-LD with both numbers, form + info', async () => {
  // synchronous renderer on the shared layout (no standalone shell left), so the route can use cached()
  const { renderContactPage } = await import('../../src/render/contact.js');
  const direct = renderContactPage('fa');
  assert.equal(typeof direct, 'string');
  assert.ok(direct.includes('class="site-header"') && direct.includes('class="site-footer"'), 'shared chrome');
  assert.ok(!direct.includes('نشانی دفتر') && !direct.includes('office address'), '"office" is not a confirmed fact');
  assert.ok(direct.includes('content="راه‌های تماس با SysaiQ: فرم درخواست مشاوره، تلفن ثابت و موبایل، ایمیل و نشانی در قزوین."'));
  for (const lang of ['fa', 'en']) {
    const r = await fetch(`${t.base}/${lang}/contact`);
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /text\/html/);
    const csp = r.headers.get('content-security-policy') || '';
    assert.ok(csp.includes("script-src 'self'"), 'page CSP applied');
    const html = await r.text();
    assert.ok(html.includes(`<html lang="${lang}"${lang === 'fa' ? ' dir="rtl"' : ''}`));
    assert.ok(!html.includes('name="robots" content="noindex"'));
    // canonical + alternates carry the language prefix; the header switch goes to the other language's contact page
    const other = lang === 'fa' ? 'en' : 'fa';
    assert.ok(html.includes(`<link rel="canonical" href="${t.base}/${lang}/contact">`), 'canonical');
    assert.ok(html.includes(`hreflang="fa" href="${t.base}/fa/contact"`) && html.includes(`hreflang="en" href="${t.base}/en/contact"`), 'alternates');
    assert.ok(html.includes(`hreflang="x-default" href="${t.base}/fa/contact"`), 'x-default → fa');
    assert.ok(html.includes(`href="/${other}/contact" hreflang="${other}"`), 'language switch');
    assert.ok(html.includes('action="/api/leads"') && html.includes('tel:+982833323002') && html.includes('tel:+989125130505'));
    assert.ok(html.includes('/assets/site/contact.css') && html.includes('/assets/site/contact.js'));
    const blocks = [...html.matchAll(/<script type="application\/ld\+json">([^]*?)<\/script>/g)].map(m => JSON.parse(m[1]));
    const ps = blocks.find(b => b['@type'] === 'ProfessionalService');
    assert.ok(ps, 'ProfessionalService present');
    assert.deepEqual(ps.telephone, ['+982833323002', '+989125130505']);
    assert.equal(ps.address.addressCountry, 'IR');
    assert.ok(blocks.some(b => b['@type'] === 'BreadcrumbList'));
  }
  // ETag changes after an admin write (cache dropped)
  const before = (await fetch(`${t.base}/fa/contact`)).headers.get('etag');
  await t.fetchAdmin('/site-info', { method: 'PUT', body: si.SITE_INFO_DEFAULTS });
  const afterW = (await fetch(`${t.base}/fa/contact`)).headers.get('etag');
  assert.notEqual(before, afterW);
});
