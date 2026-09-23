// The «اخبار» admin view: served, parses as an ES module, imports only the
// kit it is allowed to, every ui.js name it uses exists, no inline handlers
// or raw HTML — and the API round trips it performs, with the exact request
// shapes it sends (edit → publish, bulk, reject → restore, config, sources).
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { startTestApp } from '../helpers.js';

const ADMIN = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'admin');
let t, items;
const ids = {};
const FULL = {
  ok: true, note: '',
  fields: {
    importance: 4, category: 'models', tags: ['nova'],
    title_fa: 'مدل Nova عرضه شد', title_en: 'Lab ships Model Nova',
    summary_fa: 'آزمایشگاه مدل تازه‌ای به نام Nova معرفی کرد.', summary_en: 'The lab introduced Nova.',
    why_fa: 'برای Agentها مفید است.', why_en: 'Useful for agents.',
  },
};

before(async () => {
  t = await startTestApp();
  items = await import('../../src/news/items.js');
  const add = (key, res = FULL) => {
    const id = items.insertCollected({ sourceName: 'Lab', title: `Source ${key}`, link: `https://lab.example/v/${key}`, date: new Date().toISOString(), summary: 'Excerpt.', category: 'industry' });
    if (res) items.applySummary(id, res);
    ids[key] = id;
  };
  add('edit'); add('bulk1'); add('bulk2'); add('untranslated', { ok: false, error: 'bad_output' }); add('reject');
  await t.loginAsAdmin();
});
after(async () => { await t.close(); });

const admin = async (path, opts) => { const r = await t.fetchAdmin(`/news${path}`, opts); return { status: r.status, body: await r.json() }; };

test('news.view.js and news.css are served; the view parses as an ES module', async () => {
  const r = await fetch(`${t.base}/admin/js/views/news.view.js`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type') || '', /javascript/);
  const src = await r.text();
  const dir = mkdtempSync(join(tmpdir(), 'nv-'));
  try {
    const file = join(dir, 'news.view.mjs');
    writeFileSync(file, src);
    const chk = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    assert.equal(chk.status, 0, chk.stderr);
  } finally { rmSync(dir, { recursive: true, force: true }); }
  const css = await fetch(`${t.base}/admin/css/views/news.css`);
  assert.equal(css.status, 200);
  assert.match(css.headers.get('content-type') || '', /text\/css/);
  assert.ok((await css.text()).includes('@layer views'));
});

test('the view follows the admin contract', () => {
  const src = readFileSync(join(ADMIN, 'js', 'views', 'news.view.js'), 'utf8');
  const froms = [...src.matchAll(/^import\s[\s\S]*?from\s+'([^']+)';/gm)].map(m => m[1]);
  assert.deepEqual([...new Set(froms)].sort(), ['../api.js', '../strings.js', '../ui.js']);
  // every name taken from ui.js is really exported by it
  const uiSrc = readFileSync(join(ADMIN, 'js', 'ui.js'), 'utf8');
  const exported = new Set([...uiSrc.matchAll(/^export \{([^}]+)\}/gm)].flatMap(m => m[1].split(',').map(s => s.trim().split(/\s+as\s+/).pop())).filter(Boolean));
  const used = /import \{([^}]+)\} from '\.\.\/ui\.js'/.exec(src)[1].split(',').map(s => s.trim()).filter(Boolean);
  for (const name of used) assert.ok(exported.has(name), `ui.js exports ${name}`);
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|\bhtml:\s/.test(src), 'no raw HTML');
  assert.ok(!/\son[a-z]+=["']/i.test(src), 'no inline handler attributes');
  assert.match(src, /export default \{\s*title: T\.title,\s*mount,\s*isDirty\(\)/);
  // the nav entry the view hangs off
  const nav = readFileSync(join(ADMIN, 'js', 'nav.js'), 'utf8');
  assert.match(nav, /id: 'news', label: 'اخبار',[^\n]*view: 'news', routes: \['\/news\/:tab', '\/news\/:tab\/:id'\]/);
});

test('review round trip: edit (the view\'s PUT shape) → publish → live page; counts follow', async () => {
  const id = ids.edit;
  const body = {
    title_fa: 'مدل Nova برای Agentها عرضه شد', title_en: 'Lab ships Model Nova for agents',
    summary_fa: FULL.fields.summary_fa, summary_en: FULL.fields.summary_en, why_fa: FULL.fields.why_fa, why_en: FULL.fields.why_en,
    category: 'tools', tags: ['nova', 'agents'], importance: 5,
  };
  const put = await admin(`/items/${id}`, { method: 'PUT', body });
  assert.equal(put.status, 200, JSON.stringify(put.body));
  assert.equal(put.body.item.title_fa, body.title_fa);
  assert.deepEqual(put.body.item.tags, ['nova', 'agents']);
  assert.equal(put.body.item.importance, 5);
  const pub = await admin(`/items/${id}/publish`, { method: 'POST', body: {} });
  assert.equal(pub.status, 200);
  assert.equal(pub.body.item.status, 'published');
  assert.match(pub.body.item.public_path, /^\/fa\/news\/lab-ships-model-nova-for-agents$/);
  assert.equal((await fetch(t.base + pub.body.item.public_path)).status, 200);
  const list = await admin('/items?status=published');
  assert.equal(list.body.total, 1);
  assert.equal(list.body.counts.published, 1);
  assert.equal(list.body.counts.draft, 4);
});

test('publishing an untranslated draft is refused with the per-language fields the view maps', async () => {
  const r = await admin(`/items/${ids.untranslated}/publish`, { method: 'POST', body: {} });
  assert.equal(r.status, 422);
  assert.deepEqual(Object.keys(r.body.fields).sort(), ['summary_en', 'summary_fa', 'title_en', 'title_fa']);
  assert.ok(Object.values(r.body.fields).every(m => /required/.test(m)));
});

test('bulk publish reports per-item results; reject → restore brings an item back', async () => {
  const b = await admin('/items/bulk', { method: 'POST', body: { ids: [ids.bulk1, ids.bulk2, ids.untranslated], action: 'publish' } });
  assert.equal(b.status, 200);
  assert.equal(b.body.done, 2);
  assert.deepEqual(b.body.results.filter(x => !x.ok).map(x => x.id), [ids.untranslated]);
  const rej = await admin(`/items/${ids.reject}/reject`, { method: 'POST', body: {} });
  assert.equal(rej.body.item.status, 'rejected');
  const back = await admin(`/items/${ids.reject}/restore`, { method: 'POST', body: {} });
  assert.equal(back.body.item.status, 'draft');
});

test('settings, runs and sources answer in the shapes the tabs read', async () => {
  const cfg = await admin('/config');
  assert.equal(cfg.status, 200);
  for (const k of ['enabled', 'interval_hours', 'min_importance', 'daily_cap', 'model']) assert.ok(k in cfg.body.config, k);
  assert.equal(cfg.body.openai_configured, false);
  assert.equal(typeof cfg.body.ai_calls_today, 'number');
  const put = await admin('/config', { method: 'PUT', body: { enabled: true, interval_hours: 8, min_importance: 2, daily_cap: 20, model: '' } });
  assert.equal(put.status, 200);
  assert.equal(put.body.config.interval_hours, 8);
  // «الان بررسی کن» without a key: a finished no_key run, nothing fetched
  const run = await admin('/run', { method: 'POST', body: {} });
  assert.equal(run.status, 200);
  assert.equal(run.body.run.error, 'no_key');
  assert.ok(run.body.run.finished_at);
  const runs = await admin('/runs');
  assert.ok(runs.body.runs.length >= 1);
  const src = await admin('/sources');
  assert.ok(src.body.sources.length >= 1);
  for (const k of ['id', 'name', 'url', 'category', 'enabled', 'last_status', 'last_error', 'items_total', 'items_published']) assert.ok(k in src.body.sources[0], k);
  const s = src.body.sources[0];
  const off = await admin(`/sources/${s.id}`, { method: 'PUT', body: { enabled: false } });
  assert.equal(off.body.source.enabled, 0);
  const dup = await admin('/sources', { method: 'POST', body: { name: 'Dup', url: s.url, category: 'tools', lang: 'en', enabled: true } });
  assert.equal(dup.status, 409);
});
