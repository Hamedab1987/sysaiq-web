// Reconcile job (rule 8): every 120 s and on demand from the admin.
//   pending | verifying older than 2 min → inquire() where the gateway has it,
//     paid-but-unverified → the normal verify path, otherwise left alone;
//   initiated | pending | verifying older than 45 min → expired.
// The timer is unref()'d so it never keeps a test process alive; each run
// touches at most BATCH rows and every failure is logged by payment id only.
import { db } from '../db/index.js';
import { getGateway } from './registry.js';
import { gatewayCtx, verifyPayment, getPayment } from './service.js';

export const INTERVAL_MS = 120_000;
export const STALE_MINUTES = 2;
export const EXPIRE_MINUTES = 45;
const BATCH = 50;

export async function reconcileOnce({ log = console.log, now = null } = {}) {
  const out = { checked: 0, verified: 0, expired: 0, failed: 0, pending: 0 };
  const expire = db.prepare(`UPDATE payments SET status='expired', error_code='timeout', error_message='بدون پاسخ از درگاه', updated_at=datetime('now')
    WHERE status IN ('initiated','pending','verifying') AND created_at < datetime(COALESCE(?, 'now'), ?)`);
  out.expired = expire.run(now, `-${EXPIRE_MINUTES} minutes`).changes;
  const stale = db.prepare(`SELECT id, gateway, authority, status FROM payments
    WHERE status IN ('pending','verifying') AND authority <> '' AND gateway <> 'manual' AND updated_at < datetime(COALESCE(?, 'now'), ?) ORDER BY id LIMIT ?`).all(now, `-${STALE_MINUTES} minutes`, BATCH);
  for (const p of stale) {
    out.checked++;
    try {
      const gw = getGateway(p.gateway);
      let state = 'paid_unverified';   // no inquiry endpoint (PayPing) → try to verify
      if (typeof gw.inquire === 'function') {
        try { ({ state } = await gw.inquire(gatewayCtx(gw), { authority: p.authority })); } catch { state = 'unknown'; }
      }
      if (state === 'paid_unverified' || state === 'verified') {
        const r = await verifyPayment(p.id, { force: true });
        if (r.outcome === 'succeeded' || r.outcome === 'replayed') out.verified++;
        else if (r.outcome === 'pending') out.pending++;
        else out.failed++;
      } else if (state === 'failed' || state === 'reversed') {
        db.prepare(`UPDATE payments SET status='failed', error_code=?, error_message='درگاه: تراکنش ناموفق یا برگشت‌خورده', updated_at=datetime('now') WHERE id=? AND status <> 'succeeded'`).run(state, p.id);
        out.failed++;
      } else {
        // pending / unknown: touch so the next pass waits another interval
        db.prepare(`UPDATE payments SET updated_at=datetime('now') WHERE id=?`).run(p.id);
        out.pending++;
      }
    } catch (e) {
      log(`[reconcile] payment #${p.id}: ${e?.message || e}`);
    }
  }
  return out;
}

let timer = null;
export function startReconcile({ intervalMs = INTERVAL_MS } = {}) {
  if (timer) return timer;
  timer = setInterval(() => { reconcileOnce().catch(e => console.error('[reconcile]', e?.message || e)); }, intervalMs);
  timer.unref();
  return timer;
}
export function stopReconcile() { if (timer) clearInterval(timer); timer = null; }
export { getPayment };
