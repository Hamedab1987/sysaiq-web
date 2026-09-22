// /api/admin/content: listing shape, validation (422 with fields), unknown
// keys, bulk (all-or-nothing), custom keys, revisions, the legacy settings
// bridge, and the auth gate.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { startTestApp } from '../helpers.js';

const t = await startTestApp();
const DEFAULTS = JSON.parse(readFileSync(new URL('../../templates/content-defaults.json', import.meta.url), 'utf8'));
const { db } = await import('../../src/db/index.js');
const { getContent, contentTypes } = await import('../../src/lib/content.js');

const api = async (path, opts) => { const r = await t.fetchAdmin(path, opts); return { status: r.status, body: await r.json() }; };
const put = (key, body) => api(`/content/${key}`, { method: 'PUT', body });

test.after(() => t.close());

test('unauthenticated requests are refused', async () => {
  assert.equal((await fetch(`${t.base}/api/admin/content`)).status, 401);
  await t.loginAsAdmin();
});

// W<n>_{T,D,G} and Q<n>/A<n> exist in the defaults file only because the baked
// page needed them; at runtime they come from the projects/faqs tables, so the
// copy view must not offer them (editing one there would change nothing).
const TABLE_BACKED = /^(?:W\d+_[A-Z]+|Q\d+|A\d+)$/;
const EDITABLE = Object.keys(DEFAULTS).filter(k => !(TABLE_BACKED.test(k) && /^slot:(WORK|FAQ)$/.test(DEFAULTS[k].source)));

test('GET /content: groups in page order, every editable key with its default and value:null; table-backed keys hidden', async () => {
  const { status, body } = await api('/content');
  assert.equal(status, 200);
  assert.ok(Array.isArray(body.groups) && body.groups.length >= 5);
  assert.equal(body.groups[0].name, DEFAULTS.TITLE.group);
  assert.ok(body.groups[0].keys.includes('TITLE'));
  assert.deepEqual(body.keys.map(k => k.key), EDITABLE.sort((a, b) => DEFAULTS[a].order - DEFAULTS[b].order));
  assert.ok(EDITABLE.length < Object.keys(DEFAULTS).length, 'the defaults file does list table-backed keys');
  for (const k of ['WORK_H2', 'WORK_HINT', 'WORK_ALL', 'FAQ_H2', 'AI_TITLE', 'CONTACT_BTN']) assert.ok(body.keys.some(x => x.key === k), k);
  for (const k of ['W1_T', 'W1_D', 'W9_G', 'Q1', 'A1']) {
    assert.ok(!body.keys.some(x => x.key === k), `${k} hidden`);
    assert.equal((await put(k, { en: 'x' })).status, 404, `${k} refused on write`);
  }
  const h = body.keys.find(k => k.key === 'HERO_H1');
  assert.deepEqual(h, {
    key: 'HERO_H1', group: DEFAULTS.HERO_H1.group, label_fa: DEFAULTS.HERO_H1.label_fa, label_en: DEFAULTS.HERO_H1.label_en,
    type: 'inline', max: 120, anchor: '#hero', order: DEFAULTS.HERO_H1.order, source: 'token',
    default: { en: DEFAULTS.HERO_H1.en, fa: DEFAULTS.HERO_H1.fa }, value: null, is_custom: 0, updated_at: null, updated_by: '',
  });
  // every group's keys are exactly the keys of that group, in page order
  for (const g of body.groups) {
    assert.deepEqual(g.keys, body.keys.filter(k => k.group === g.name).map(k => k.key));
  }
});

test('PUT /content/:key: partial updates, value shape, updated_by; GET /content/:key', async () => {
  let r = await put('HERO_H1', { fa: 'سلام' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.ok, true);
  assert.deepEqual(r.body.value, { en: null, fa: 'سلام' });
  assert.equal(r.body.updated_by, 'tester');
  assert.match(r.body.updated_at, /^\d{4}-\d{2}-\d{2} /);
  r = await put('HERO_H1', { en: 'Hi' });
  assert.deepEqual(r.body.value, { en: 'Hi', fa: 'سلام' }, 'fa untouched');
  r = await api('/content/HERO_H1');
  assert.deepEqual(r.body.value, { en: 'Hi', fa: 'سلام' });
  assert.equal(getContent('fa').HERO_H1, 'سلام');
  assert.equal(getContent('en').HERO_H1, 'Hi');
  r = await put('HERO_H1', { fa: null });
  assert.deepEqual(r.body.value, { en: 'Hi', fa: null });
  assert.equal(getContent('fa').HERO_H1, DEFAULTS.HERO_H1.fa);
  r = await put('HERO_H1', { en: null });
  assert.equal(r.body.value, null, 'both default again');
});

test('validation → 422 with fields; unknown key → 404; malformed key → 422', async () => {
  let r = await put('HERO_H1', { en: 123 });
  assert.equal(r.status, 422);
  assert.equal(r.body.error, 'validation');
  assert.match(r.body.fields.en, /string or null/);
  r = await put('HERO_H1', { fa: ['x'] });
  assert.equal(r.status, 422);
  assert.ok(r.body.fields.fa);
  r = await put('HERO_H1', { en: 'x'.repeat(121) });
  assert.equal(r.status, 422);
  assert.match(r.body.fields.en, /at most 120/);
  r = await put('HERO_H1', { en: 'x'.repeat(120) });
  assert.equal(r.status, 200, 'exactly max is fine');
  r = await put('HERO_H1', {});
  assert.equal(r.status, 422);
  assert.ok(r.body.fields.value);
  r = await put('HERO_H1', { other: 'x' });
  assert.equal(r.status, 422);
  r = await api('/content/HERO_H1', { method: 'PUT', body: 'not json', headers: { 'content-type': 'text/plain' } });
  assert.equal(r.status, 422);
  r = await put('NOPE_KEY', { en: 'x' });
  assert.equal(r.status, 404);
  assert.equal(r.body.error, 'not_found');
  r = await put('bad-key', { en: 'x' });
  assert.equal(r.status, 422);
  assert.ok(r.body.fields.key);
  r = await api('/content/NOPE_KEY', { method: 'DELETE' });
  assert.equal(r.status, 404);
  r = await api('/content/NOPE_KEY/revisions');
  assert.equal(r.status, 404);
  await api('/content/HERO_H1', { method: 'DELETE' });
});

test('control characters are stripped, CRLF normalised, whitespace kept', async () => {
  const r = await put('FEAT1', { en: ' a\u0000b\u0007c\r\nd\te ' });
  assert.equal(r.status, 200);
  assert.equal(r.body.value.en, ' abc\nd\te ');
  await api('/content/FEAT1', { method: 'DELETE' });
});

test('bulk PUT /content is all-or-nothing and names the failing item', async () => {
  let r = await api('/content', { method: 'PUT', body: { items: [{ key: 'NAV_HOME', en: 'A' }, { key: 'NAV_WORK', fa: 'ب' }] } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.updated, ['NAV_HOME', 'NAV_WORK']);
  assert.equal(getContent('en').NAV_HOME, 'A');
  assert.equal(getContent('fa').NAV_WORK, 'ب');

  r = await api('/content', { method: 'PUT', body: { items: [{ key: 'NAV_HOME', en: 'B' }, { key: 'NAV_WORK', fa: 'x'.repeat(41) }, { key: 'ZZZ', en: 'x' }, { key: 'NAV_FAQ' }] } });
  assert.equal(r.status, 422);
  assert.deepEqual(Object.keys(r.body.fields).sort(), ['items[1].fa', 'items[2].key', 'items[3].value']);
  assert.equal(getContent('en').NAV_HOME, 'A', 'nothing applied');

  r = await api('/content', { method: 'PUT', body: { items: 'nope' } });
  assert.equal(r.status, 422);
  r = await api('/content', { method: 'PUT', body: {} });
  assert.equal(r.status, 422);
  await api('/content', { method: 'PUT', body: { items: [{ key: 'NAV_HOME', en: null }, { key: 'NAV_WORK', fa: null }] } });
  assert.equal(getContent('en').NAV_HOME, DEFAULTS.NAV_HOME.en);
});

test('custom keys: create (201), validation, conflict, use, list, reset, purge', async () => {
  let r = await api('/content/custom', { method: 'POST', body: { key: 'X_PROMO', label_fa: 'متن تبلیغ', label_en: 'Promo', type: 'inline', fa: 'تخفیف *ویژه*' } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.key, 'X_PROMO');
  assert.equal(r.body.is_custom, 1);
  assert.equal(r.body.type, 'inline');
  assert.equal(r.body.max, 2000);
  assert.deepEqual(r.body.default, { en: '', fa: '' });
  assert.deepEqual(r.body.value, { en: null, fa: 'تخفیف *ویژه*' });
  assert.equal(getContent('fa').X_PROMO, 'تخفیف *ویژه*');
  assert.equal(getContent('en').X_PROMO, '', 'no value, no default → empty string');
  assert.equal(contentTypes().X_PROMO, 'inline');

  r = await api('/content/custom', { method: 'POST', body: { key: 'X_PROMO', label_fa: 'x' } });
  assert.equal(r.status, 409);
  r = await api('/content/custom', { method: 'POST', body: { key: 'HERO_H1', label_fa: 'x' } });
  assert.equal(r.status, 422, 'registered names are not custom keys');
  for (const bad of ['PROMO', 'X_a', 'X_', 'X_' + 'A'.repeat(41), 'X_A-B']) {
    r = await api('/content/custom', { method: 'POST', body: { key: bad, label_fa: 'x' } });
    assert.equal(r.status, 422, bad);
    assert.ok(r.body.fields.key, bad);
  }
  r = await api('/content/custom', { method: 'POST', body: { key: 'X_NOLABEL' } });
  assert.equal(r.status, 422);
  assert.ok(r.body.fields.label_fa);
  r = await api('/content/custom', { method: 'POST', body: { key: 'X_T', label_fa: 'x', type: 'html' } });
  assert.equal(r.status, 422);
  assert.ok(r.body.fields.type);

  r = await put('X_PROMO', { en: 'Special *offer*' });
  assert.equal(r.status, 200);
  r = await put('X_PROMO', { en: 'x'.repeat(2001) });
  assert.equal(r.status, 422);

  const list = (await api('/content')).body;
  const rec = list.keys.find(k => k.key === 'X_PROMO');
  assert.ok(rec && rec.is_custom === 1 && rec.label_fa === 'متن تبلیغ' && rec.source === 'custom');
  assert.deepEqual(list.groups.at(-1), { name: rec.group, keys: ['X_PROMO'] });

  r = await api('/content/X_PROMO', { method: 'DELETE' });
  assert.equal(r.status, 200);
  assert.equal(r.body.value, null);
  assert.equal(getContent('fa').X_PROMO, '');
  r = await api('/content/HERO_H1?purge=1', { method: 'DELETE' });
  assert.equal(r.status, 422, 'registered keys cannot be purged');
  r = await api('/content/X_PROMO?purge=1', { method: 'DELETE' });
  assert.equal(r.status, 200);
  assert.equal(r.body.removed, true);
  assert.equal((await api('/content/X_PROMO')).status, 404);
  assert.ok(!('X_PROMO' in getContent('fa')));
  assert.equal(db.prepare("SELECT COUNT(*) c FROM content_revisions WHERE key='X_PROMO'").get().c, 0);
});

test('revisions: one per write, newest first, with admin_id', async () => {
  const me = (await api('/me')).body;
  await put('TAG1', { en: '[ One ]' });
  await put('TAG1', { fa: '[ یک ]' });
  await api('/content/TAG1', { method: 'DELETE' });
  const { status, body } = await api('/content/TAG1/revisions');
  assert.equal(status, 200);
  assert.equal(body.length, 3);
  assert.deepEqual(body.map(r => [r.en, r.fa]), [[null, null], ['[ One ]', '[ یک ]'], ['[ One ]', null]]);
  assert.ok(body[0].id > body[1].id && body[1].id > body[2].id);
  assert.ok(body.every(r => r.key === 'TAG1' && /^\d{4}-/.test(r.at)));
  if (Number.isInteger(me?.id ?? me?.uid)) assert.ok(body.every(r => r.admin_id === (me.id ?? me.uid)));
  else assert.ok(body.every(r => Number.isInteger(r.admin_id)));
  assert.equal((await api('/content/TAG1/revisions?limit=2')).body.length, 2);
  // a reset without a stored value writes nothing
  await api('/content/TAG2', { method: 'DELETE' });
  assert.equal((await api('/content/TAG2/revisions')).body.length, 0);
});

// The auto-mounter writes its generic row on the response's 'finish' event, a
// tick or two after the client has the answer: wait for the count to settle.
const auditRows = async (where, params = [], min = 1) => {
  const sql = `SELECT action, entity, entity_id, summary, meta, admin_name FROM audit_log WHERE entity='content' AND ${where} ORDER BY id`;
  let rows = [];
  for (let i = 0; i < 40; i++) {
    rows = db.prepare(sql).all(...params);
    if (rows.length >= min) break;
    await new Promise(r => setTimeout(r, 25));
  }
  await new Promise(r => setTimeout(r, 60)); // and catch any extra row written after it
  return db.prepare(sql).all(...params);
};

// Supervisor (round 2): every write used to produce two rows — the mounter's
// generic one plus this router's own — and a bulk save of N keys N+1. The
// generic row already names method, entity and key; only bulk, custom-key
// creation and purge add a line the generic row cannot carry.
test('audit: one row per single-key write, two for a bulk save, and the custom-key and purge rows name the key', async () => {
  const start = db.prepare('SELECT COALESCE(MAX(id), 0) id FROM audit_log').get().id;
  let r = await put('TAG3', { en: '[ Three ]' });
  assert.equal(r.status, 200);
  let rows = await auditRows("entity_id='TAG3'");
  assert.equal(rows.length, 1, JSON.stringify(rows));
  assert.equal(rows[0].action, 'update');
  assert.equal(rows[0].admin_name, 'tester');
  assert.match(rows[0].summary, /PUT \/content\/TAG3/);
  r = await api('/content/TAG3', { method: 'DELETE' });
  assert.equal(r.status, 200);
  rows = await auditRows("entity_id='TAG3'", [], 2);
  assert.equal(rows.length, 2, 'reset: the generic delete row only');
  assert.equal(rows[1].action, 'delete');

  // bulk: the generic row (no key in its path) + one line naming every key
  r = await api('/content', { method: 'PUT', body: { items: [{ key: 'TAG1', en: 'a' }, { key: 'TAG2', en: 'b' }, { key: 'TAG3', en: 'c' }] } });
  assert.equal(r.status, 200);
  rows = await auditRows("id > ? AND entity_id IN ('', 'TAG1', 'TAG2')", [start], 2);
  const bulk = rows.filter(x => x.entity_id === '');
  assert.equal(bulk.length, 2, JSON.stringify(rows));
  assert.ok(bulk.some(x => x.summary === 'bulk: 3 keys — TAG1, TAG2, TAG3' && JSON.parse(x.meta).keys.length === 3));
  assert.ok(bulk.some(x => x.summary === 'PUT /content'));
  assert.equal(rows.filter(x => x.entity_id === 'TAG1' || x.entity_id === 'TAG2').length, 0, 'no per-key rows for a bulk save');
  await api('/content', { method: 'PUT', body: { items: [{ key: 'TAG1', en: null }, { key: 'TAG2', en: null }, { key: 'TAG3', en: null }] } });

  // custom key: the generic row's entity_id is the path segment "custom"; the explicit row names the key
  r = await api('/content/custom', { method: 'POST', body: { key: 'X_AUDIT', label_fa: 'ممیزی', fa: 'x' } });
  assert.equal(r.status, 201);
  rows = await auditRows("entity_id='X_AUDIT'");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].action, 'create');
  assert.match(rows[0].summary, /custom key X_AUDIT/);
  r = await api('/content/X_AUDIT?purge=1', { method: 'DELETE' });
  assert.equal(r.status, 200);
  rows = await auditRows("entity_id='X_AUDIT'", [], 3);
  assert.equal(rows.length, 3, 'create + generic delete + purge');
  assert.ok(rows.some(x => x.action === 'delete' && /purge/.test(x.summary)));
});

// Supervisor (round 2): keyMeta() looked a key up without an own-property
// check, so inherited names read as registered keys (200 with a bogus record).
test('inherited object names are not content keys: 404 on read, revisions and write; a malformed key is 422 on read too', async () => {
  // lower case never passes the key syntax: 422 like a write, not a bogus record
  for (const k of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
    let r = await api(`/content/${k}`);
    assert.equal(r.status, 422, `${k}: ${JSON.stringify(r.body)}`);
    r = await api(`/content/${k}/revisions`);
    assert.equal(r.status, 422, `${k} revisions`);
    r = await put(k, { en: 'x' });
    assert.notEqual(r.status, 200, `${k} write`);
  }
  // the same names in upper case pass the key syntax and must still be unknown
  for (const k of ['CONSTRUCTOR', 'TOSTRING', '__PROTO__']) {
    assert.equal((await api(`/content/${k}`)).status, 404, k);
    assert.equal((await api(`/content/${k}/revisions`)).status, 404, k);
  }
  assert.equal((await api('/content/bad-key')).status, 422);
  assert.equal((await api('/content/bad-key/revisions')).status, 422);
  const { keyMeta } = await import('../../src/lib/content.js');
  for (const k of ['constructor', '__proto__', 'toString']) assert.equal(keyMeta(k), null, k);
});

test('legacy bridge: PUT /api/admin/settings/hero_h1 also changes the home page', async () => {
  const r = await api('/settings/hero_h1', { method: 'PUT', body: { value: { en: 'Legacy hero', fa: 'هیروی قدیمی' } } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const rec = (await api('/content/HERO_H1')).body;
  assert.deepEqual(rec.value, { en: 'Legacy hero', fa: 'هیروی قدیمی' });
  assert.equal(rec.updated_by, 'tester');
  const html = await (await fetch(`${t.base}/fa/`)).text();
  assert.ok(html.includes('<h1 class="rv on">هیروی قدیمی</h1>'));
  // contact_email is not a content key: nothing mirrored, nothing thrown
  const r2 = await api('/settings/contact_email', { method: 'PUT', body: { value: { en: 'a@b.co', fa: 'a@b.co' } } });
  assert.equal(r2.status, 200);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM content WHERE en='a@b.co' OR fa='a@b.co'").get().c, 0);
  await api('/content/HERO_H1', { method: 'DELETE' });
});

// The bridge is two-way: the legacy `settings` row must always hold what the
// site renders, or GET /api/content and the old Content tab keep showing text
// the page no longer has (supervisor finding, round 1).
const { LEGACY_SEED } = await import('../../src/db/migrations/004_content.js');
const legacy = async key => (await (await fetch(`${t.base}/api/content`)).json()).settings[key];
const heroFa = async () => ((await (await fetch(`${t.base}/fa/`)).text()).match(/<h1 class="rv on">(.*?)<\/h1>/) || [])[1];

test('legacy bridge: resetting a mirrored key puts the seed wording back into the settings row', async () => {
  await api('/settings/hero_h1', { method: 'PUT', body: { value: { en: 'Legacy hero', fa: 'هیروی قدیمی' } } });
  assert.deepEqual(await legacy('hero_h1'), { en: 'Legacy hero', fa: 'هیروی قدیمی' });
  const r = await api('/content/HERO_H1', { method: 'DELETE' });
  assert.equal(r.status, 200);
  assert.equal(r.body.value, null);
  assert.deepEqual(await legacy('hero_h1'), LEGACY_SEED.hero_h1, 'settings row back to seed.js, not the stale custom text');
  assert.equal(await heroFa(), DEFAULTS.HERO_H1.fa.replace('\n', '<br>'));
});

test('legacy bridge: an edit in the new admin is visible through the legacy settings API too', async () => {
  // seed.js creates the five legacy rows on a real install; the sync only ever updates an existing row
  db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('about_1', ?)").run(JSON.stringify(LEGACY_SEED.about_1));
  assert.deepEqual(await legacy('about_1'), LEGACY_SEED.about_1);
  const r = await put('FEAT1', { fa: 'متن جدید دربارهٔ من' });
  assert.equal(r.status, 200);
  assert.deepEqual(await legacy('about_1'), { en: LEGACY_SEED.about_1.en, fa: 'متن جدید دربارهٔ من' });
  await api('/content/FEAT1', { method: 'DELETE' });
  assert.deepEqual(await legacy('about_1'), LEGACY_SEED.about_1);
});

test('legacy bridge: blank fields follow the default and an all-blank patch (the old route\'s default for a missing body) never blanks the hero', async () => {
  await put('HERO_H1', { en: 'Custom EN', fa: 'سفارشی' });
  assert.deepEqual(await legacy('hero_h1'), { en: 'Custom EN', fa: 'سفارشی' });
  // {} → the legacy schema stores {en:'', fa:''} (that route's own contract, core/admin-crud-validate asserts it);
  // the mirror refuses it, so the page keeps its copy
  const r = await api('/settings/hero_h1', { method: 'PUT', body: {} });
  assert.equal(r.status, 200);
  assert.deepEqual(await legacy('hero_h1'), { en: '', fa: '' }, 'the settings route keeps what it stored');
  assert.deepEqual((await api('/content/HERO_H1')).body.value, { en: 'Custom EN', fa: 'سفارشی' });
  assert.equal(await heroFa(), 'سفارشی');
  assert.ok(!/<h1 class="rv on"><\/h1>/.test(await (await fetch(`${t.base}/en/`)).text()), 'no empty <h1>');
  // one blank language → that language follows the default again; the other is kept
  await api('/settings/hero_h1', { method: 'PUT', body: { value: { en: 'Custom EN 2', fa: '   ' } } });
  assert.deepEqual((await api('/content/HERO_H1')).body.value, { en: 'Custom EN 2', fa: null });
  assert.equal(await heroFa(), DEFAULTS.HERO_H1.fa.replace('\n', '<br>'));
  assert.deepEqual(await legacy('hero_h1'), { en: 'Custom EN 2', fa: '   ' }, 'whitespace kept by the settings route');
  // seed-equal text (what the old tab shows by default) is "no override": the en line break survives a fa-only edit
  await api('/settings/hero_h1', { method: 'PUT', body: { value: { en: LEGACY_SEED.hero_h1.en, fa: 'فقط فارسی' } } });
  assert.deepEqual((await api('/content/HERO_H1')).body.value, { en: null, fa: 'فقط فارسی' });
  assert.ok((await (await fetch(`${t.base}/en/`)).text()).includes(`<h1 class="rv on">${DEFAULTS.HERO_H1.en.replace('\n', '<br>')}</h1>`));
  // a reset from the new admin is content-originated: the legacy row follows
  await api('/content/HERO_H1', { method: 'DELETE' });
  assert.deepEqual(await legacy('hero_h1'), LEGACY_SEED.hero_h1);
});

// Supervisor (round 2): the mirror honoured the old route's 5000-char cap, so a
// legacy PUT could store a HERO_H1 the new view (max 120) could never re-save;
// and its revisions carried admin_id NULL because the event only names the admin.
const settle = async (pred, tries = 40) => { for (let i = 0; i < tries && !pred(); i++) await new Promise(r => setTimeout(r, 25)); };
const contentRow = key => db.prepare('SELECT en, fa FROM content WHERE key=?').get(key) || null;

test('legacy bridge: a language over the key\'s own cap is not mirrored (logged once, naming the key); the other language still is; revisions carry the admin id', async () => {
  const errors = [];
  const orig = console.error;
  console.error = (...a) => errors.push(a.join(' '));
  try {
    const long = 'E'.repeat(121); // HERO_H1.max is 120; the settings route itself accepts up to 5000
    const r = await api('/settings/hero_h1', { method: 'PUT', body: { value: { en: long, fa: 'عنوان معتبر' } } });
    assert.equal(r.status, 200, 'the settings route keeps its own contract');
    await settle(() => contentRow('HERO_H1')?.fa === 'عنوان معتبر');
    assert.deepEqual(contentRow('HERO_H1'), { en: null, fa: 'عنوان معتبر' }, 'fa mirrored, the over-cap en left alone');
    assert.equal(getContent('en').HERO_H1, DEFAULTS.HERO_H1.en, 'the site keeps its en copy');
    assert.equal(errors.length, 1, errors.join('\n'));
    assert.match(errors[0], /\[content\] legacy settings\.hero_h1\.en \(121 chars\) exceeds HERO_H1's cap of 120/);
    // the new admin can still re-save what the bridge stored
    assert.equal((await put('HERO_H1', { fa: 'عنوان معتبر' })).status, 200);
    // exactly the cap goes through
    await api('/settings/hero_h1', { method: 'PUT', body: { value: { en: 'E'.repeat(120), fa: 'عنوان معتبر' } } });
    await settle(() => contentRow('HERO_H1')?.en === 'E'.repeat(120));
    assert.equal(contentRow('HERO_H1').en, 'E'.repeat(120));
    assert.equal(errors.length, 1, 'no new log line');
    // only the over-cap language is dropped: the same language over the cap in both → nothing, all-blank rule intact
    await api('/settings/hero_h1', { method: 'PUT', body: { value: { en: long, fa: '' } } });
    await settle(() => errors.length === 2);
    assert.equal(errors.length, 2);
    assert.equal(contentRow('HERO_H1').en, 'E'.repeat(120), 'untouched');
  } finally {
    console.error = orig;
  }
  // every revision the bridge wrote is attributable to the admin who made the legacy PUT
  const me = db.prepare('SELECT id FROM admins WHERE username=?').get('tester').id;
  const revs = (await api('/content/HERO_H1/revisions')).body;
  assert.ok(revs.length >= 3);
  assert.ok(revs.every(x => x.admin_id === me), JSON.stringify(revs.map(x => x.admin_id)));
  await api('/content/HERO_H1', { method: 'DELETE' });
});
