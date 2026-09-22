// Minimal in-process event bus — decouples workstreams (a lead is created →
// mail + SMS + audit listen, none of them imported by the leads route).
// Listeners run in a microtask, each inside try/catch: a broken listener
// can neither delay the response nor break another listener.
// Known events: lead.created, content.changed, invoice.sent,
// payment.succeeded, payment.failed, payment.orphaned, news.drafted

const listeners = new Map(); // evt → Set(fn)

export function on(evt, fn) {
  if (!listeners.has(evt)) listeners.set(evt, new Set());
  listeners.get(evt).add(fn);
  return () => listeners.get(evt)?.delete(fn); // unsubscribe
}

export function emit(evt, payload) {
  const set = listeners.get(evt);
  if (!set || !set.size) return 0;
  for (const fn of [...set]) {
    queueMicrotask(() => {
      try {
        const r = fn(payload, evt);
        if (r && typeof r.catch === 'function') r.catch(e => console.error(`[events] ${evt}:`, e?.message || e));
      } catch (e) {
        console.error(`[events] ${evt}:`, e?.message || e);
      }
    });
  }
  return set.size;
}

export const listenerCount = evt => listeners.get(evt)?.size || 0;
