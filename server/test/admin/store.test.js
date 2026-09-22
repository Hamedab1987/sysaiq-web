// admin/js/store.js is DOM-free: pub/sub, events and the dirty bookkeeping.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const mod = await import(pathToFileURL(join(__dirname, '..', '..', 'admin', 'js', 'store.js')).href);
const { store, markDirty, setDirty, clearDirty, anyDirty } = mod;

test('set/subscribe: immediate call, change notification, no-op on same value', () => {
  const seen = [];
  const off = store.subscribe('session', v => seen.push(v));
  assert.deepEqual(seen, [null]);
  const s = { username: 'admin' };
  store.set('session', s);
  store.set('session', s); // same reference → no second notification
  assert.deepEqual(seen, [null, s]);
  off();
  store.set('session', null);
  assert.equal(seen.length, 2);
});

test('snapshot() copies state that holds functions (route items carry badge functions)', () => {
  // structuredClone would throw DataCloneError here; renderBadges calls snapshot on every counter change
  store.set('route', { path: '/leads', item: { id: 'leads', badge: s => s.counters?.newLeads || null } });
  store.set('counters', { leads: 3, newLeads: 2 });
  const snap = store.snapshot();
  assert.equal(snap.counters.newLeads, 2);
  assert.equal(snap.route.item.badge(snap), 2);
  snap.counters.newLeads = 99; // a copy, not the live object
  assert.equal(store.get('counters').newLeads, 2);
});

test('events: on/once/emit, a throwing listener does not stop the others', () => {
  const calls = [];
  const off = store.on('auth:expired', p => calls.push(['on', p.path]));
  store.once('auth:expired', () => { throw new Error('boom'); });
  store.once('auth:expired', p => calls.push(['once', p.path]));
  const origError = console.error; console.error = () => {};
  try {
    store.emit('auth:expired', { path: '/a' });
    store.emit('auth:expired', { path: '/b' });
  } finally { console.error = origError; }
  assert.deepEqual(calls, [['on', '/a'], ['once', '/a'], ['on', '/b']]);
  off();
});

test('dirty bookkeeping counts forms, not events', () => {
  const seen = [];
  const off = store.subscribe('dirty', n => seen.push(n), { immediate: false });
  markDirty('form-a', true);
  markDirty('form-a', true); // same token twice is still one form
  markDirty('form-b', true);
  assert.equal(store.get('dirty'), 2);
  assert.equal(anyDirty(), true);
  markDirty('form-a', false);
  assert.equal(store.get('dirty'), 1);
  clearDirty();
  assert.equal(store.get('dirty'), 0);
  assert.equal(anyDirty(), false);
  assert.deepEqual(seen, [1, 2, 1, 0]);
  off();
});

test('setDirty(token, n): a view reports its own count, forms add one each, one writer never clobbers another', () => {
  clearDirty();
  const seen = [];
  const off = store.subscribe('dirty', n => seen.push(n), { immediate: false });
  setDirty('content', 7);                 // «متن‌های سایت» has seven pending keys
  assert.equal(store.get('dirty'), 7);
  markDirty('content-custom', true);      // the custom-key dialog form becomes dirty on top of it
  assert.equal(store.get('dirty'), 8, 'the dialog adds to the view count instead of replacing it');
  markDirty('content-custom', false);     // form.destroy() zeroes only its own token
  assert.equal(store.get('dirty'), 7, 'closing the dialog leaves the view count untouched (no flicker to 0)');
  setDirty('content', 3);
  assert.equal(store.get('dirty'), 3);
  setDirty('content', '2');               // strings and floats are coerced, never NaN
  assert.equal(store.get('dirty'), 2);
  setDirty('content', -1);
  assert.equal(store.get('dirty'), 0);
  assert.equal(anyDirty(), false);
  assert.deepEqual(seen, [7, 8, 7, 3, 2, 0]);
  setDirty('content', 1);
  clearDirty();
  assert.equal(store.get('dirty'), 0);
  off();
});

test('the shell exposes setDirty through ui.js (named export and ctx.ui)', async () => {
  const ui = await import(pathToFileURL(join(__dirname, '..', '..', 'admin', 'js', 'ui.js')).href).catch(() => null);
  // ui.js pulls in DOM-free modules only at module scope; when that ever changes this test says so
  assert.ok(ui, 'ui.js loads in Node');
  assert.equal(ui.setDirty, setDirty);
  assert.equal(ui.ui.setDirty, setDirty);
});
