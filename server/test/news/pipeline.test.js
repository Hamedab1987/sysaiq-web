// The collection run end to end with a fixture feed (fake transport) and a
// fake OpenAI client: no request leaves the process.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp } from '../helpers.js';

let t, db, news, sched, summ, fetchMod, secrets, ai, events, cfgMod;
let transportCalls = [], aiCalls = [], drafted = [];
let feedEtag = '"v1"';
const FEED_URL = 'https://feeds.lab.example/rss';
const hoursAgo = h => new Date(Date.now() - h * 3600_000).toUTCString();
const LONG = 'The lab said the release is available to developers through its API and documentation today, with details on pricing to follow later. '.repeat(2);

let feedItems;
const rss = list => `<?xml version="1.0"?><rss version="2.0"><channel><title>Lab Blog</title>${list.map(i => `<item><title>${i.t}</title><link>${i.l}</link><pubDate>${i.d}</pubDate><description>${i.s}</description></item>`).join('')}</channel></rss>`;

function transport(opts) {
  transportCalls.push({ url: opts.url, op: opts.op, headers: opts.headers });
  if (opts.url === FEED_URL) {
    if (opts.headers['if-none-match'] === feedEtag) return { ok: false, status: 304, headers: new Headers(), text: '' };
    return { ok: true, status: 200, headers: new Headers({ etag: feedEtag }), text: rss(feedItems) };
  }
  if (opts.url === 'https://lab.example/news/stickers') {
    return { ok: true, status: 200, headers: new Headers({ 'content-type': 'text/html' }), text: '<html><head><meta property="og:description" content="The lab added a sticker pack to its chat app for fun, with no other change to the product or its models."></head></html>' };
  }
  return { ok: false, status: 404, headers: new Headers(), text: '' };
}

const brief = (over = {}) => ({
  importance: 4, category: 'models',
  title_fa: 'آزمایشگاه مدل Nova را برای Agentها عرضه کرد', title_en: 'Lab ships Model Nova for agents',
  summary_fa: 'آزمایشگاه مدل تازه‌ای به نام Nova معرفی کرد که از طریق API در دسترس توسعه‌دهندگان است.',
  summary_en: 'The lab introduced Nova, available to developers through its API, and 40 partners.',
  why_fa: 'کسب‌وکارها می‌توانند Agentهای خود را روی این مدل بسازند.', why_en: 'Businesses can build agents on it.',
  tags: ['Nova', 'agents', 'nova'], ...over,
});

function fakeClient() {
  return {
    chat: { completions: { create: async req => {
      aiCalls.push(req);
      const src = req.messages[1].content;
      if (src.includes('Malformed')) return { choices: [{ message: { content: 'not json {' } }] };
      if (src.includes('Outage')) { const e = new Error('Incorrect API key sk-...abcd'); e.status = 500; throw e; }
      if (src.includes('sticker')) return { choices: [{ message: { content: JSON.stringify(brief({ importance: 1, category: 'tools' })) } }] };
      return { choices: [{ message: { content: JSON.stringify(brief()) } }] };
    } } },
  };
}

before(async () => {
  t = await startTestApp();
  ({ db } = await import('../../src/db/index.js'));
  sched = await import('../../src/news/scheduler.js');
  summ = await import('../../src/news/summarize.js');
  fetchMod = await import('../../src/news/fetch.js');
  secrets = await import('../../src/lib/secrets.js');
  ai = await import('../../src/ai.js');
  events = await import('../../src/lib/events.js');
  cfgMod = await import('../../src/news/config.js');
  news = await import('../../src/news/sources.js');
  fetchMod.setTransport(transport);
  summ.setClientFactory(fakeClient);
  events.on('news.drafted', p => drafted.push(p));
  // only the fixture source runs
  db.prepare('UPDATE news_sources SET enabled=0').run();
  news.createSource({ name: 'Lab Blog', url: FEED_URL, category: 'industry', lang: 'en', enabled: 1 });
  feedItems = [
    { t: 'Lab ships Model Nova for agents', l: 'https://lab.example/news/nova?utm_source=rss', d: hoursAgo(2), s: LONG },
    { t: 'Lab ships Model Nova, for agents', l: 'https://mirror.example/nova-copy', d: hoursAgo(3), s: LONG },
    { t: 'Malformed output story about tools', l: 'https://lab.example/news/malformed', d: hoursAgo(4), s: LONG },
    { t: 'Minor sticker update', l: 'https://lab.example/news/stickers', d: hoursAgo(5), s: 'Stickers.' },
    { t: 'Outage of the summariser story', l: 'https://lab.example/news/outage', d: hoursAgo(6), s: LONG },
    { t: 'Very old news item', l: 'https://lab.example/news/old', d: hoursAgo(24 * 20), s: LONG },
  ];
});
after(async () => { fetchMod.setTransport(null); summ.setClientFactory(null); await t.close(); });

const row = url => db.prepare('SELECT * FROM news_items WHERE url=?').get(url);

test('no OpenAI key: the run records no_key and fetches nothing', async () => {
  assert.equal(summ.hasNewsKey(), false);
  const run = await sched.runNews({ trigger: 'manual' });
  assert.equal(run.error, 'no_key');
  assert.ok(run.finished_at);
  assert.equal(transportCalls.length, 0);
  assert.equal(aiCalls.length, 0);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM news_items').get().c, 0);
});

test('with a key: fresh items become drafts (both languages), low ones skipped, nothing published', async () => {
  secrets.setSecret(ai.OPENAI_KEY_SECRET, 'sk-test-0123456789abcdef');
  const run = await sched.runNews({ trigger: 'manual' });
  assert.equal(run.error, '');
  assert.equal(run.sources_ok, 1);
  assert.equal(run.sources_failed, 0);
  assert.equal(run.items_new, 5, 'the 20-day-old item is ignored');
  assert.equal(run.items_drafted, 3);
  assert.equal(run.items_skipped, 2);

  const nova = row('https://lab.example/news/nova');
  assert.ok(nova, 'tracking parameters are stripped from the stored URL');
  assert.equal(nova.status, 'draft');
  assert.equal(nova.title_fa, 'آزمایشگاه مدل Nova را برای Agentها عرضه کرد');
  assert.equal(nova.title_en, 'Lab ships Model Nova for agents');
  assert.equal(nova.importance, 4);
  assert.equal(nova.category, 'models', 'the AI category replaces the source default');
  assert.deepEqual(JSON.parse(nova.tags), ['nova', 'agents']);
  assert.equal(nova.source_name, 'Lab Blog');
  assert.match(nova.ai_note, /^numbers_not_in_source: 40/, 'a number the source never states is flagged for the reviewer');
  assert.ok(nova.ai_at);

  const dup = row('https://mirror.example/nova-copy');
  assert.equal(dup.status, 'skipped');
  assert.equal(dup.ai_note, `duplicate_of:${nova.id}`);

  const bad = row('https://lab.example/news/malformed');
  assert.equal(bad.status, 'draft', 'malformed AI output keeps the item as a draft');
  assert.equal(bad.title_fa, '');
  assert.equal(bad.summary_en, '');
  assert.equal(bad.title_src, 'Malformed output story about tools');
  assert.ok(bad.excerpt_src.length > 100);
  assert.equal(bad.ai_note, 'bad_output');

  const down = row('https://lab.example/news/outage');
  assert.equal(down.status, 'draft');
  assert.equal(down.ai_note, 'api_500');
  assert.equal(down.title_en, '');

  const minor = row('https://lab.example/news/stickers');
  assert.equal(minor.status, 'skipped', 'below min_importance (3)');
  assert.equal(minor.ai_note, 'below_min');
  assert.match(minor.excerpt_src, /sticker pack/, 'a one-line feed excerpt is enriched from the article page');

  assert.equal(db.prepare("SELECT COUNT(*) c FROM news_items WHERE status='published'").get().c, 0, 'never auto-published');
  assert.equal(aiCalls.length, 4, 'the duplicate is never sent to the AI');
  const sys = aiCalls[0];
  assert.equal(sys.response_format.type, 'json_schema');
  assert.equal(sys.response_format.json_schema.strict, true);
  assert.match(sys.messages[0].content, /ONLY facts stated in the source/);
  assert.match(sys.messages[1].content, /<<<SOURCE/);

  await new Promise(r => setTimeout(r, 5));
  assert.deepEqual(drafted.map(d => d.count), [3]);
  const src = db.prepare('SELECT * FROM news_sources WHERE url=?').get(FEED_URL);
  assert.equal(src.last_status, 'ok');
  assert.equal(src.etag, '"v1"');
  assert.equal(src.items_seen, 5);
});

test('second run: conditional GET → 304, nothing new, no AI calls', async () => {
  const before = aiCalls.length;
  const run = await sched.runNews({ trigger: 'manual' });
  assert.equal(run.items_new, 0);
  const feedCalls = transportCalls.filter(c => c.url === FEED_URL);
  assert.equal(feedCalls.at(-1).headers['if-none-match'], '"v1"');
  assert.equal(db.prepare('SELECT last_status FROM news_sources WHERE url=?').get(FEED_URL).last_status, 'not_modified');
  assert.equal(aiCalls.length, before);
});

test('the lock prevents overlapping runs; a stale lock is cleared', async () => {
  const lock = sched.acquireLock.immediate('manual');
  assert.equal(lock.ok, true);
  const blocked = await sched.runNews({ trigger: 'schedule' });
  assert.equal(blocked.locked, true);
  assert.equal(blocked.id, lock.runId);
  // two concurrent runs: only one takes the lock
  db.prepare("UPDATE news_runs SET finished_at=datetime('now') WHERE id=?").run(lock.runId);
  const [a, b] = await Promise.all([sched.runNews({ trigger: 'manual' }), sched.runNews({ trigger: 'manual' })]);
  assert.equal([a, b].filter(r => r.locked).length, 1);
  // a crashed run left its row open an hour ago → closed as stale_lock, the new run proceeds
  const stale = db.prepare("INSERT INTO news_runs (trigger, started_at) VALUES ('schedule', datetime('now','-2 hours'))").run().lastInsertRowid;
  const run = await sched.runNews({ trigger: 'manual' });
  assert.ok(!run.locked);
  assert.equal(db.prepare('SELECT error FROM news_runs WHERE id=?').get(stale).error, 'stale_lock');
});

test('daily cap: new items wait (ai_at empty) once the budget is spent', async () => {
  cfgMod.setNewsConfig({ daily_cap: sched.aiCallsToday() });
  feedEtag = '"v2"';
  feedItems.push({ t: 'Brand new chip for AI laptops', l: 'https://lab.example/news/chip', d: hoursAgo(1), s: LONG });
  const before = aiCalls.length;
  const run = await sched.runNews({ trigger: 'manual' });
  assert.equal(run.items_new, 1);
  assert.equal(run.error, 'daily_cap');
  assert.equal(aiCalls.length, before);
  const chip = row('https://lab.example/news/chip');
  assert.equal(chip.status, 'draft');
  assert.equal(chip.ai_at, null);
  // budget back → the backlog is summarised on the next run
  cfgMod.setNewsConfig({ daily_cap: 30 });
  await sched.runNews({ trigger: 'manual' });
  assert.ok(row('https://lab.example/news/chip').ai_at);
});

test('scheduler tick: disabled → no run; enabled + due → one run', async () => {
  cfgMod.setNewsConfig({ enabled: false });
  const n = db.prepare('SELECT COUNT(*) c FROM news_runs').get().c;
  assert.equal(await sched.tick(), null);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM news_runs').get().c, n);
  cfgMod.setNewsConfig({ enabled: true, interval_hours: 6 });
  assert.equal(sched.dueForRun(), false, 'the last run just happened');
  db.prepare("UPDATE news_runs SET started_at=datetime('now','-7 hours')").run();
  assert.equal(sched.dueForRun(), true);
  const run = await sched.tick();
  assert.ok(run && run.id);
});

test('summarize: validateOutput refuses a brief without Persian or with a bad category', () => {
  assert.equal(summ.validateOutput(brief({ title_fa: 'No persian here', summary_fa: 'none' })), null);
  assert.equal(summ.validateOutput(brief({ category: 'gossip' })), null);
  assert.equal(summ.validateOutput(brief({ importance: 9 })), null);
  assert.ok(summ.validateOutput(brief()));
  assert.equal(summ.validateOutput('x'), null);
});

test('config: auto_publish can never be switched on; ranges are enforced', () => {
  assert.throws(() => cfgMod.setNewsConfig({ auto_publish: true }), e => e.status === 422);
  assert.throws(() => cfgMod.setNewsConfig({ interval_hours: 0 }), e => e.status === 422);
  assert.throws(() => cfgMod.setNewsConfig({ model: 'gpt; rm -rf' }), e => e.status === 422);
  assert.equal(cfgMod.getNewsConfig().auto_publish, false);
});
