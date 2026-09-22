// lib/qr.js (pure): structure, determinism, capacity, version selection, SVG;
// plus the pure invoice helpers (short code, Jalali year, totals).
import test, { before, after } from 'node:test';
import { startTestApp } from '../helpers.js';
import assert from 'node:assert/strict';
import { encode, qrSvg, capacityBytes } from '../../src/lib/qr.js';

test('encode: versions 1–10 at EC level M, standard byte capacities, deterministic', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(capacityBytes), [14, 26, 42, 62, 84, 106, 122, 152, 180, 213]);
  const a = encode('https://sysaiq.com/p/ABCDEFGHJKMN');
  assert.deepEqual([a.version, a.size], [3, 29]);
  assert.deepEqual([...a.modules], [...encode('https://sysaiq.com/p/ABCDEFGHJKMN').modules]);
  assert.equal(encode('A').version, 1);
  assert.equal(encode('x'.repeat(213)).version, 10);
  assert.throws(() => encode('x'.repeat(214)), /too long/);
  // finder pattern top-left: 7×7 ring, dark corners, light ring, dark centre
  const g = (x, y) => a.modules[y * a.size + x];
  assert.deepEqual([g(0, 0), g(6, 6), g(1, 1), g(3, 3), g(7, 7)], [1, 1, 0, 1, 0]);
  // timing pattern on row 6 alternates
  assert.deepEqual([g(8, 6), g(9, 6), g(10, 6)], [1, 0, 1]);
  // the dark module at (8, size-8)
  assert.equal(g(8, a.size - 8), 1);
  // unicode text is byte-mode UTF-8
  assert.equal(encode('سلام').version, 1);
});

test('qrSvg: crisp path SVG, escaped title, same text → same string', () => {
  const s = qrSvg('https://sysaiq.com/p/ABC', { size: 200, title: 'a<b' });
  assert.ok(s.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 '));
  assert.ok(s.includes('width="200"') && s.includes('shape-rendering="crispEdges"') && s.includes('<title>a&lt;b</title>'));
  assert.ok(!s.includes('<script'));
  assert.equal(s, qrSvg('https://sysaiq.com/p/ABC', { size: 200, title: 'a<b' }));
  assert.notEqual(s, qrSvg('https://sysaiq.com/p/ABD', { size: 200, title: 'a<b' }));
});

// the invoice helpers touch the db module on import, so they run against a temp app
let t, inv;
before(async () => { t = await startTestApp(); inv = await import('../../src/payments/invoices.js'); });
after(async () => { await t.close(); });

test('invoice helpers: short codes, Jalali year via Intl, totals rounding', () => {
  const codes = new Set(Array.from({ length: 200 }, () => inv.newShortCode()));
  assert.equal(codes.size, 200);
  for (const c of codes) assert.match(c, /^[0-9A-HJKMNP-TV-Z]{12}$/);
  assert.equal(inv.normalizeShortCode(' abcd-efgh-jkmn '), 'ABCDEFGHJKMN');
  assert.equal(inv.normalizeShortCode('OIL1OIL1OIL1'), '011101110111');
  assert.equal(inv.normalizeShortCode('U'.repeat(12)), null);   // U is not in Crockford
  assert.equal(inv.normalizeShortCode('ABC'), null);
  assert.equal(inv.jalaliYear(new Date('2026-09-22T10:00:00Z')), 1405);
  assert.equal(inv.jalaliYear(new Date('2026-03-21T10:00:00Z')), 1405);
  assert.equal(inv.jalaliYear(new Date('2026-03-19T10:00:00Z')), 1404);
  assert.match(inv.newToken(), /^[A-Za-z0-9_-]{32}$/);
  assert.deepEqual(inv.computeTotals([{ qty: 3, unit_toman: 333333 }], 100, 9), { subtotal_toman: 999999, discount_toman: 100, tax_toman: 89991, amount_toman: 1089890 });
  assert.deepEqual(inv.computeTotals([{ qty: 1, unit_toman: 1000 }], 5000, 0).discount_toman, 1000);   // discount capped at subtotal
});
