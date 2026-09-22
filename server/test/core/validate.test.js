import test from 'node:test';
import assert from 'node:assert/strict';
import { v, validate } from '../../src/lib/validate.js';
import { HttpError } from '../../src/lib/errors.js';

const fails = (schema, body, ...keys) => {
  try { validate(schema, body); } catch (e) {
    assert.ok(e instanceof HttpError);
    assert.equal(e.status, 422);
    assert.equal(e.code, 'validation');
    for (const k of keys) assert.ok(k in e.fields, `field ${k} in ${JSON.stringify(e.fields)}`);
    return e;
  }
  assert.fail('expected a 422');
};

test('str: trim, min/max, pattern, numbers coerced', () => {
  assert.deepEqual(validate({ a: v.str({ max: 5 }) }, { a: '  hi ' }), { a: 'hi' });
  assert.deepEqual(validate({ a: v.str() }, { a: 12 }), { a: '12' });
  assert.deepEqual(validate({ a: v.str() }, {}), { a: '' });
  fails({ a: v.str({ min: 3 }) }, { a: 'hi' }, 'a');
  fails({ a: v.str({ max: 2 }) }, { a: 'hello' }, 'a');
  fails({ a: v.str() }, { a: { x: 1 } }, 'a');
  fails({ a: v.str({ pattern: /^[a-z]+$/ }) }, { a: 'A1' }, 'a');
});

test('int / bool / oneOf', () => {
  assert.deepEqual(validate({ n: v.int({ min: 0, max: 10 }) }, { n: '7' }), { n: 7 });
  fails({ n: v.int() }, { n: 1.5 }, 'n');
  fails({ n: v.int({ max: 3 }) }, { n: 4 }, 'n');
  assert.deepEqual(validate({ b: v.bool() }, { b: 'true' }), { b: true });
  assert.deepEqual(validate({ b: v.bool() }, { b: 0 }), { b: false });
  assert.deepEqual(validate({ b: v.bool() }, {}), { b: false });
  fails({ b: v.bool() }, { b: 'maybe' }, 'b');
  assert.deepEqual(validate({ s: v.oneOf(['a', 'b']) }, { s: 'b' }), { s: 'b' });
  fails({ s: v.oneOf(['a', 'b']) }, { s: 'c' }, 's');
});

test('slug / url / email', () => {
  assert.deepEqual(validate({ s: v.slug() }, { s: ' My-Page ' }), { s: 'my-page' });
  fails({ s: v.slug() }, { s: 'bad slug' }, 's');
  fails({ s: v.slug() }, { s: '-lead' }, 's');
  assert.deepEqual(validate({ u: v.url() }, { u: 'http://a.b/c' }), { u: 'http://a.b/c' });
  assert.deepEqual(validate({ u: v.url({ https: true }) }, { u: 'https://a.b' }), { u: 'https://a.b/' });
  fails({ u: v.url({ https: true }) }, { u: 'http://a.b' }, 'u');
  fails({ u: v.url() }, { u: 'javascript:alert(1)' }, 'u');
  fails({ u: v.url() }, { u: 'https://user:pw@a.b' }, 'u');
  assert.deepEqual(validate({ e: v.email() }, { e: ' Hamed@Example.com ' }), { e: 'hamed@example.com' });
  fails({ e: v.email() }, { e: 'nope' }, 'e');
});

test('slug / url / email refuse arrays and objects instead of String()-coercing them', () => {
  // ['a@b.co'] used to become 'a@b.co'; an object 'must be a string' like v.str
  for (const bad of [['a@b.co'], { toString: () => 'a@b.co' }, [], {}]) {
    assert.match(fails({ e: v.email() }, { e: bad }, 'e').fields.e, /must be a string|valid email/);
    fails({ u: v.url() }, { u: bad }, 'u');
    fails({ s: v.slug() }, { s: bad }, 's');
  }
  // scalars still coerce the way v.str does; nil is an empty (invalid) value
  assert.deepEqual(validate({ s: v.slug() }, { s: 123 }), { s: '123' });
  fails({ e: v.email() }, {}, 'e');
  fails({ e: v.email() }, { e: null }, 'e');
  assert.deepEqual(validate({ e: v.optional(v.email()) }, { e: '' }), {});
});

test('json / array / optional / default; unknown keys dropped; several errors at once', () => {
  const schema = { meta: v.json({ x: v.int() }), tags: v.array(v.str({ max: 3 }), { max: 2 }), o: v.optional(v.int()), d: v.default(v.int(), 5) };
  assert.deepEqual(validate(schema, { meta: '{"x":"2","junk":1}', tags: ['a', 'b'], extra: 1 }), { meta: { x: 2 }, tags: ['a', 'b'], d: 5 });
  assert.deepEqual(validate(schema, { meta: { x: 1 }, tags: '["z"]', o: 3, d: 9 }), { meta: { x: 1 }, tags: ['z'], o: 3, d: 9 });
  const e = fails(schema, { meta: { x: 'no' }, tags: ['a', 'b', 'c'], o: 'x' }, 'meta.x', 'tags', 'o');
  assert.equal(Object.keys(e.fields).length, 3);
  assert.deepEqual(e.toJSON().error, 'validation');
  fails({ t: v.array(v.str()) }, { t: 'not json' }, 't');
  fails({ m: v.json() }, { m: [1] }, 'm');
});
