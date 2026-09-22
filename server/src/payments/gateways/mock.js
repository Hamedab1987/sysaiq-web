// Mock gateway — local development and tests only (payments/registry.js
// refuses it in production). Nothing leaves the process: create() records
// the transaction in memory, the fake bank page (routes/public/pay.routes.js,
// dev only) calls settle() with the button the tester pressed, and verify()
// answers from that record — so "Status=OK" on the callback alone never
// marks anything paid, exactly like a real gateway.
import { randomBytes } from 'node:crypto';
import { toWire, str } from './common.js';

const ID = 'mock';
const AUTHORITY_RE = /^M[0-9a-f]{32}$/;
const txs = new Map();   // authority → { amountToman, orderId, outcome:'created'|'ok'|'failed'|'cancelled', verified, refId }
let seq = 0;

export const lookup = authority => txs.get(String(authority)) || null;
export function settle(authority, outcome) {
  const tx = txs.get(String(authority));
  if (!tx) return null;
  tx.outcome = ['ok', 'failed', 'cancelled'].includes(outcome) ? outcome : 'failed';
  return tx;
}
export const reset = () => txs.clear();

export default {
  id: ID,
  label_fa: 'آزمایشی (بانک ساختگی)',
  label_en: 'Mock (fake bank)',
  wireUnit: 'IRT',
  minToman: 1000,
  maxToman: 100_000_000,
  callbackMethod: 'GET',
  redirectOrigins: [],
  hosts: [],
  secretName: null,
  configFields: [],

  async create(ctx, { amountToman, orderId, callbackUrl }) {
    const wire = toWire(amountToman, 'IRT');
    const authority = `M${randomBytes(16).toString('hex')}`;
    txs.set(authority, { amountToman: wire, orderId: str(orderId, 64), callbackUrl, outcome: 'created', verified: false, refId: '' });
    return { ok: true, authority, redirectUrl: `/api/pay/mock/bank?authority=${authority}`, raw: { mock: true } };
  },

  parseCallback({ query = {}, body = {} }) {
    const src = { ...query, ...body };
    const authority = str(src.authority, 40);
    const status = str(src.status, 12);
    return { authority: AUTHORITY_RE.test(authority) ? authority : '', outcome: status === 'ok' ? 'ok' : status === 'cancelled' ? 'cancelled' : 'failed', extra: {} };
  },

  async verify(ctx, { authority, amountToman }) {
    const tx = txs.get(String(authority));
    if (!tx) return { ok: false, pending: false, alreadyVerified: false, code: 'unknown_authority', message: 'mock: unknown authority', raw: {} };
    if (tx.outcome !== 'ok') return { ok: false, pending: tx.outcome === 'created', alreadyVerified: false, code: tx.outcome === 'created' ? 'pending' : tx.outcome, message: `mock: ${tx.outcome}`, raw: {} };
    const alreadyVerified = tx.verified;
    if (!tx.verified) { tx.verified = true; tx.refId = String(100000 + (++seq)); }
    return {
      ok: true, pending: false, alreadyVerified,
      refId: tx.refId, cardPan: '603799******1234', cardHash: '',
      amountToman: tx.amountToman, orderIdEcho: tx.orderId, feeToman: 0,
      code: alreadyVerified ? '101' : '100', message: '', raw: { mock: true, requested: Number(amountToman) },
    };
  },

  async inquire(ctx, { authority }) {
    const tx = txs.get(String(authority));
    const state = !tx ? 'unknown' : tx.outcome === 'created' ? 'pending' : tx.outcome !== 'ok' ? 'failed' : tx.verified ? 'verified' : 'paid_unverified';
    return { state, raw: { mock: true } };
  },

  async test() { return { ok: true, message_fa: 'درگاه آزمایشی همیشه در دسترس است (فقط خارج از production).' }; },
};
