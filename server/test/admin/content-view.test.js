// «متن‌های سایت» + «اطلاعات تماس و هویت» admin views: the files are served
// as JS/CSS, load in Node (DOM-free at module scope), their pure helpers
// behave, and the request bodies they send are accepted by the API and show
// up on the rendered site.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { startTestApp } from '../helpers.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ADMIN = join(__dirname, '..', '..', 'admin');
const VIEWS = ['content', 'site-info'];

let t;
before(async () => { t = await startTestApp(); await t.loginAsAdmin(); });
after(async () => { await t.close(); });

const json = async (path, opts) => { const r = await t.fetchAdmin(path, opts); return { status: r.status, body: await r.json() }; };
const page = async path => { const r = await fetch(`${t.base}${path}`); return { status: r.status, html: await r.text() }; };
const decode = s => s.replace(/&#39;/g, '’').replace(/&quot;/g, '"').replace(/&amp;/g, '&');

test('the two views and their stylesheets are served with the right types and follow the shell rules', async () => {
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
    // one writer per token: the topbar counter is fed through ui.setDirty, never by poking the store
    assert.ok(!/store\.set\(\s*'dirty'/.test(src), `${v}: writes store.dirty directly`);
  }
  const content = readFileSync(join(ADMIN, 'js', 'views', 'content.view.js'), 'utf8');
  assert.match(content, /setDirty\(DIRTY_TOKEN, pendingCount\)/);
  assert.match(content, /setDirty\(DIRTY_TOKEN, 0\)/, 'cleanup releases the token');
});

test('site-info preview links only what the validators accept: https map links and a well-formed email; anything else is plain text', async () => {
  const { helpers: H } = await import(pathToFileURL(join(ADMIN, 'js', 'views', 'site-info.view.js')).href);
  assert.equal(H.linkableUrl('https://maps.app.goo.gl/abc'), 'https://maps.app.goo.gl/abc');
  assert.equal(H.linkableUrl(' https://nshn.ir/x '), 'https://nshn.ir/x');
  assert.equal(H.linkableUrl('http://maps.google.com/x'), null, 'http is refused by the field rule and by the server');
  assert.equal(H.linkableUrl('javascript:alert(1)'), null);
  assert.equal(H.linkableUrl('ftp://x.y'), null);
  assert.equal(H.linkableUrl('not a url'), null);
  assert.equal(H.linkableUrl(''), null);
  assert.equal(H.linkableUrl(null), null);
  assert.equal(H.linkableEmail('hello@sysaiq.com'), 'hello@sysaiq.com');
  assert.equal(H.linkableEmail('hello@sysaiq'), null);
  assert.equal(H.linkableEmail('not an email'), null);
  assert.equal(H.linkableEmail(''), null);
  // the preview code path builds <a> only through these helpers
  const src = readFileSync(join(ADMIN, 'js', 'views', 'site-info.view.js'), 'utf8');
  const preview = src.slice(src.indexOf('function renderPreview'), src.indexOf('// ---- view'));
  assert.ok(!/href: u\b/.test(preview), 'map href never takes the raw field value');
  assert.match(preview, /href: linkableUrl\(u\)/);
  assert.match(preview, /href: `mailto:\$\{linkableEmail\(s\.email\)\}`/);
});

test('both view modules load in Node and export the view contract (+ pure helpers)', async () => {
  const content = await import(pathToFileURL(join(ADMIN, 'js', 'views', 'content.view.js')).href);
  assert.equal(typeof content.default.mount, 'function');
  assert.equal(content.default.title, 'متن‌های سایت');
  assert.equal(content.default.isDirty(), false);
  assert.equal(typeof content.diffItems, 'function');
  const site = await import(pathToFileURL(join(ADMIN, 'js', 'views', 'site-info.view.js')).href);
  assert.equal(typeof site.default.mount, 'function');
  assert.equal(site.default.title, 'اطلاعات تماس و هویت');
  assert.equal(typeof site.helpers.toServer, 'function');
});

test('leave guard: the content view supplies its own copy (edits are kept as a draft, not lost) and the router reads it', async () => {
  const content = await import(pathToFileURL(join(ADMIN, 'js', 'views', 'content.view.js')).href);
  const v = content.default;
  assert.equal(typeof v.leaveMessage, 'function');
  assert.equal(v.leaveTitle, 'تغییرات هنوز منتشر نشده‌اند');
  const msg = v.leaveMessage();
  assert.match(msg, /پیش‌نویس/, 'says the edits stay as a draft');
  assert.match(msg, /در همین مرورگر/);
  assert.match(msg, /«ذخیره و انتشار»/);
  assert.ok(!/از بین می‌روند/.test(msg), 'must not claim the changes are lost');
  // the copy is true only because cleanup flushes the draft before the fields are disposed
  const src = readFileSync(join(ADMIN, 'js', 'views', 'content.view.js'), 'utf8');
  const cleanup = src.slice(src.indexOf('return () => {', src.indexOf('// ---- shortcuts + cleanup')));
  assert.ok(cleanup.indexOf('saveDraft.flush()') < cleanup.indexOf('c.field.dispose()'), 'draft flushed before dispose');
  // the router prefers the view's copy over STR.confirm.leaveMessage
  const router = readFileSync(join(ADMIN, 'js', 'router.js'), 'utf8');
  assert.match(router, /viewText\('leaveMessage', STR\.confirm\.leaveMessage\)/);
  assert.match(router, /viewText\('leaveTitle', STR\.confirm\.leaveTitle\)/);
});

test('diffItems: only changed keys, only changed languages, null when typed back to the default', async () => {
  const { diffItems } = await import(pathToFileURL(join(ADMIN, 'js', 'views', 'content.view.js')).href);
  const rec = (key, dfl, value = null) => ({ key, default: dfl, value });
  const items = diffItems([
    { rec: rec('A', { fa: 'الف', en: 'a' }), value: { fa: 'الف', en: 'a' } },                       // untouched → skipped
    { rec: rec('B', { fa: 'ب', en: 'b' }), value: { fa: 'ب۲', en: 'b' } },                          // fa changed only
    { rec: rec('C', { fa: 'پ', en: 'c' }, { fa: 'پ-override', en: null }), value: { fa: 'پ', en: 'c' } }, // typed the default back → null
    { rec: rec('D', { fa: 'ت', en: 'd' }, { fa: null, en: 'D!' }), value: { fa: 'ت', en: 'D!' } },      // override kept → skipped
    { rec: rec('X_NEW', { fa: '', en: '' }), value: { fa: 'سفارشی', en: '' } },                        // custom key, first value
  ]);
  assert.deepEqual(items, [{ key: 'B', fa: 'ب۲' }, { key: 'C', fa: null }, { key: 'X_NEW', fa: 'سفارشی' }]);
});

test('site-info helpers: Persian digits, national ↔ E.164, validation messages, display strings, form ↔ server shape', async () => {
  const { helpers: H } = await import(pathToFileURL(join(ADMIN, 'js', 'views', 'site-info.view.js')).href);
  assert.equal(H.nationalPhone('۰۹۱۲ ۵۱۳ ۰۵۰۵'), '09125130505');
  assert.equal(H.nationalPhone('+98 912-513-0505'), '09125130505');
  assert.equal(H.nationalPhone('00982833323002'), '02833323002');
  assert.equal(H.nationalPhone('9125130505'), '09125130505');
  assert.equal(H.nationalPhone('+14155550123'), '+14155550123');
  assert.equal(H.toE164('09125130505'), '+989125130505');
  assert.equal(H.toE164('02833323002'), '+982833323002');
  assert.equal(H.phoneMessage('mobile', '۰۹۱۲۵۱۳۰۵۰۵'), null);
  assert.equal(H.phoneMessage('mobile', '0912513050'), 'شمارهٔ موبایل باید ۱۱ رقم و با ۰۹ شروع شود (مثال: ۰۹۱۲۵۱۳۰۵۰۵)');
  assert.equal(H.phoneMessage('mobile', '02833323002'), 'شمارهٔ موبایل باید ۱۱ رقم و با ۰۹ شروع شود (مثال: ۰۹۱۲۵۱۳۰۵۰۵)');
  assert.equal(H.phoneMessage('landline', '02833323002'), null);
  assert.match(H.phoneMessage('landline', '2833323002'), /شمارهٔ ثابت باید ۱۱ رقم/);
  assert.match(H.phoneMessage('landline', '+1'), /بین‌المللی/);
  assert.equal(H.phoneMessage('mobile', ''), 'این فیلد الزامی است');
  assert.equal(H.displayFaFor('mobile', '09125130505'), '۰۹۱۲ ۵۱۳ ۰۵۰۵');
  assert.equal(H.displayFaFor('landline', '02833323002'), '۰۲۸-۳۳۳۲۳۰۰۲');
  assert.equal(H.displayEnFor('mobile', '09125130505'), '+98 912 513 0505');
  assert.equal(H.displayEnFor('landline', '02833323002'), '+98 28 3332 3002');
  assert.ok(H.hhmmOk('۰۹:۰۰') && H.hhmmOk('17:30') && !H.hhmmOk('25:00') && !H.hhmmOk('9:00'));

  const { SITE_INFO_DEFAULTS } = await import('../../src/lib/siteinfo.js');
  const form = H.toForm(SITE_INFO_DEFAULTS);
  assert.deepEqual(form.phones.map(p => p.number), ['02833323002', '09125130505']);
  assert.equal(form.show_address, true);
  const back = H.toServer({ ...form, postal_code: '۳۴۱۱۱', geo_lat: 36.2688, geo_lng: 50.0041, phones: [{ type: 'mobile', number: '۰۹۱۲۵۱۳۰۵۰۵', display_fa: '', display_en: '' }], hours_spec: [{ days: ['Sa', 'Mo'], opens: '۰۹:۰۰', closes: '17:00' }] });
  assert.equal(back.postal_code, '34111');
  assert.deepEqual(back.geo, { lat: '36.2688', lng: '50.0041' });
  assert.deepEqual(back.phones, [{ type: 'mobile', e164: '+989125130505', display_fa: '۰۹۱۲ ۵۱۳ ۰۵۰۵', display_en: '+98 912 513 0505' }]);
  assert.deepEqual(back.hours_spec, [{ days: ['Sa', 'Mo'], opens: '09:00', closes: '17:00' }]);
  assert.deepEqual(Object.keys(back.show), ['address', 'landline', 'mobile', 'email', 'hours', 'map', 'socials']);
  // the server accepts exactly this shape
  const r = await json('/site-info', { method: 'PUT', body: back });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.site_info.phones[0].e164, '+989125130505');
  assert.deepEqual(r.body.site_info.geo, { lat: 36.2688, lng: 50.0041 });
  await json('/site-info', { method: 'PUT', body: SITE_INFO_DEFAULTS });
});

test('bulk PUT in the shape the view sends changes /fa/ at once; null puts the default back', async () => {
  const list = await json('/content');
  assert.equal(list.status, 200);
  const hero = list.body.keys.find(k => k.key === 'HERO_H1');
  assert.ok(hero && hero.type === 'inline' && hero.default.fa, 'HERO_H1 is an inline key with a default');
  const before = await page('/fa/');
  assert.equal(before.status, 200);
  assert.ok(decode(before.html).includes(hero.default.fa.split('\n')[0]), 'default hero on the site');

  const items = [{ key: 'HERO_H1', fa: 'سیستم‌های *هوشمند*\nبرای کسب‌وکار شما' }, { key: 'NAV_HOME', en: 'Start' }];
  const r = await json('/content', { method: 'PUT', body: { items } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.updated, ['HERO_H1', 'NAV_HOME']);
  const rec = r.body.keys.find(k => k.key === 'HERO_H1');
  assert.equal(rec.value.fa, items[0].fa);
  assert.equal(rec.value.en, null, 'untouched language stays null (= default)');
  const fa = await page('/fa/');
  assert.ok(fa.html.includes('سیستم‌های <em>هوشمند</em><br>برای کسب‌وکار شما'), 'inline markup rendered on /fa/');
  assert.ok(!fa.html.includes('*هوشمند*'), 'stars never reach the page');
  const en = await page('/en/');
  assert.ok(en.html.includes('>Start<') || en.html.includes('Start'), 'NAV_HOME en changed on /en/');

  // a 422 names the failing item exactly the way the view maps it back to a card
  const bad = await json('/content', { method: 'PUT', body: { items: [{ key: 'NAV_HOME', en: 'x'.repeat(41) }] } });
  assert.equal(bad.status, 422);
  assert.ok(bad.body.fields['items[0].en']);

  const reset = await json('/content', { method: 'PUT', body: { items: [{ key: 'HERO_H1', fa: null }, { key: 'NAV_HOME', en: null }] } });
  assert.equal(reset.status, 200);
  assert.equal(reset.body.keys.find(k => k.key === 'HERO_H1').value, null, 'no override left');
  const after = await page('/fa/');
  assert.ok(decode(after.html).includes(hero.default.fa.split('\n')[0]), 'default hero is back');
});

test('the site-info PUT the view sends is reflected in the home contact block and on /fa/contact', async () => {
  const { helpers: H } = await import(pathToFileURL(join(ADMIN, 'js', 'views', 'site-info.view.js')).href);
  const { SITE_INFO_DEFAULTS } = await import('../../src/lib/siteinfo.js');
  const form = H.toForm(SITE_INFO_DEFAULTS);
  form.phones = form.phones.map(p => (p.type === 'mobile' ? { ...p, number: '۰۹۱۲ ۰۰۰ ۱۱۲۲', display_fa: '', display_en: '' } : p));
  form.hours = { fa: 'شنبه تا چهارشنبه، ۹ تا ۱۷', en: 'Sat–Wed, 9–17' };
  const r = await json('/site-info', { method: 'PUT', body: H.toServer(form) });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const mobile = r.body.site_info.phones.find(p => p.type === 'mobile');
  assert.equal(mobile.e164, '+989120001122');
  assert.equal(mobile.display_fa, '۰۹۱۲ ۰۰۰ ۱۱۲۲');
  for (const p of ['/fa/', '/fa/contact']) {
    const { status, html } = await page(p);
    assert.equal(status, 200, p);
    assert.ok(html.includes('۰۹۱۲ ۰۰۰ ۱۱۲۲'), `${p}: new mobile display`);
    assert.ok(html.includes('tel:+989120001122'), `${p}: tel link`);
    assert.ok(!html.includes('۰۹۱۲ ۵۱۳ ۰۵۰۵'), `${p}: old mobile gone`);
  }
  assert.ok((await page('/fa/contact')).html.includes('شنبه تا چهارشنبه، ۹ تا ۱۷'), 'hours text on /fa/contact');
  // hide the mobile → it disappears from the page but stays stored
  form.show_mobile = false;
  const r2 = await json('/site-info', { method: 'PUT', body: H.toServer(form) });
  assert.equal(r2.status, 200);
  assert.equal(r2.body.site_info.show.mobile, false);
  assert.ok(!(await page('/fa/contact')).html.includes('۰۹۱۲ ۰۰۰ ۱۱۲۲'), 'hidden mobile not rendered');
  await json('/site-info', { method: 'PUT', body: SITE_INFO_DEFAULTS });
});
