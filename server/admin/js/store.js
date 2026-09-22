// Tiny pub/sub state + event bus shared by the shell, router and views.
//   store.get('session') · store.set('session', {...}) · store.update('counters', c => ({...c, leads: 3}))
//   store.subscribe('dirty', n => …) → off()        (called immediately with the current value)
//   store.on('auth:expired', fn) → off() · store.emit('auth:expired', payload)
//   setDirty('content', 7) · markDirty('form-x', true) · clearDirty() · anyDirty()
// Keys in use: session {username,…}|null · counters {leads,newLeads,…} ·
// dirty (number of unsaved changes, summed over tokens — never set directly) ·
// route (current route).
const state = { session: null, counters: {}, dirty: 0, route: null };
const subs = new Map();   // key → Set<fn>
const events = new Map(); // evt → Set<fn>

function fire(set, ...args) {
  if (!set) return;
  for (const fn of [...set]) {
    try { fn(...args); } catch (e) { console.error('[store] listener failed', e); }
  }
}

export const store = {
  get(key) { return state[key]; },
  set(key, value) {
    if (state[key] === value) return;
    state[key] = value;
    fire(subs.get(key), value, key);
  },
  update(key, fn) { store.set(key, fn(state[key])); },
  subscribe(key, fn, { immediate = true } = {}) {
    if (!subs.has(key)) subs.set(key, new Set());
    subs.get(key).add(fn);
    if (immediate) fn(state[key], key);
    return () => subs.get(key)?.delete(fn);
  },
  on(evt, fn) {
    if (!events.has(evt)) events.set(evt, new Set());
    events.get(evt).add(fn);
    return () => events.get(evt)?.delete(fn);
  },
  once(evt, fn) {
    const off = store.on(evt, (...a) => { off(); fn(...a); });
    return off;
  },
  emit(evt, payload) { fire(events.get(evt), payload); },
  // read-only copy for badge functions: one level deep, because `route`
  // carries the nav item (with badge functions) that structuredClone refuses
  snapshot() {
    const out = {};
    for (const [k, v] of Object.entries(state)) out[k] = v && typeof v === 'object' && !Array.isArray(v) ? { ...v } : v;
    return out;
  },
};

// --- dirty bookkeeping: one counter, many writers, each under its own token --
// A createForm() counts as one change (markDirty); a view that manages its
// own fields reports how many it holds (setDirty('content', 7)). The topbar
// shows the sum, so a dialog form opening over a dirty view never hides the
// view's count, and a form's destroy() only zeroes its own token.
const dirtyByToken = new Map();   // token → count > 0
function publishDirty() {
  let n = 0;
  for (const c of dirtyByToken.values()) n += c;
  store.set('dirty', n);
}
export function setDirty(token, count) {
  const n = Math.max(0, Math.floor(Number(count) || 0));
  if (n) dirtyByToken.set(token, n); else dirtyByToken.delete(token);
  publishDirty();
}
export function markDirty(token, isDirty) { setDirty(token, isDirty ? 1 : 0); }
export function clearDirty() { dirtyByToken.clear(); store.set('dirty', 0); }
export function anyDirty() { return dirtyByToken.size > 0; }

export default store;
