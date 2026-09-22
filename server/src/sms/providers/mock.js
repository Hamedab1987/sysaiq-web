// Mock provider — local development and tests only (the registry refuses it
// in production). Nothing leaves the process; the service writes the
// sms_log row like for any provider, so the admin log looks real.
// Deterministic simulation by the recipient's last four digits:
//   …0000 → retriable server_error (exercises the fallback path)
//   …9999 → bad_mobile (non-retriable)
//   …1111 → accepted, later reported undelivered
// Logs one line per call without the number or the text.
import { SmsError } from '../errors.js';
import { str } from './common.js';

const ID = 'mock';
let seq = 0;

function simulateFailure(to) {
  const tail = str(to).slice(-4);
  if (tail === '0000') throw new SmsError('server_error', { provider: ID, message: 'mock outage (…0000)' });
  if (tail === '9999') throw new SmsError('bad_mobile', { provider: ID, message: 'mock rejects …9999' });
  return tail;
}

function accept(mode, to, ctx) {
  const tail = simulateFailure(to);
  const messageId = `mock-${++seq}-${tail}`;
  (ctx?.log || console.log)(JSON.stringify({ provider: ID, op: mode, status: 200, ms: 0 }));
  return { ok: true, messageId, cost: 0, raw: { mock: true, mode } };
}

export default {
  id: ID,
  label_fa: 'آزمایشی (بدون ارسال واقعی)',
  label_en: 'Mock (no real send)',
  hosts: [],
  recipientFormat: 'local',
  supportsPattern: true,
  supportsStatus: true,
  secretName: null,
  configFields: [
    { key: 'sender', label_fa: 'شمارهٔ خط ارسال', type: 'text', required: false, help_fa: 'اختیاری — فقط در لاگ ثبت می‌شود.' },
  ],
  validateMap(entry) {
    return entry && typeof entry === 'object' ? null : 'باید یک شیء باشد';
  },
  async send(ctx, { to, text }) {
    if (!str(text).trim()) throw new SmsError('empty_text', { provider: ID });
    return accept('send', to, ctx);
  },
  async sendPattern(ctx, { to }) {
    return accept('pattern', to, ctx);
  },
  async credit() {
    return { amount: 1000, unit: 'mock', raw: { mock: true } };
  },
  async status(_ctx, { messageId }) {
    const tail = str(messageId).split('-').at(-1);
    return { state: tail === '1111' ? 'undelivered' : 'delivered', raw: { mock: true } };
  },
  // tests reset the counter so message ids are predictable
  _reset() { seq = 0; },
};
