// Tiny schema validator — no dependency, throws HttpError 422 with `fields`.
//   const body = validate({ name: v.str({min:1,max:80}), sort: v.optional(v.int()) }, req.body);
// Each rule is (value, key) → cleaned value, or throws a string message.
import { HttpError } from './errors.js';

const isNil = x => x === undefined || x === null;
const fail = msg => { throw new Fail(msg); };
class Fail extends Error {}

// scalar → trimmed string; arrays/objects are refused instead of being
// coerced ("[object Object]", "a@b.co" out of ["a@b.co"]) — every text rule
// below starts here so they all answer the same way
function text(x, key, trim = true) {
  if (isNil(x)) x = '';
  if (typeof x === 'number' || typeof x === 'boolean') x = String(x);
  if (typeof x !== 'string') fail(`${key} must be a string`);
  return trim ? x.trim() : x;
}

export const v = {
  str({ min = 0, max = 10000, trim = true, pattern, allowEmpty = true } = {}) {
    return (x, key) => {
      x = text(x, key, trim);
      if (!x.length && min === 0 && allowEmpty) return x;
      if (x.length < min) fail(`${key} must be at least ${min} characters`);
      if (x.length > max) fail(`${key} must be at most ${max} characters`);
      if (pattern && !pattern.test(x)) fail(`${key} has an invalid format`);
      return x;
    };
  },
  int({ min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {}) {
    return (x, key) => {
      if (typeof x === 'string' && x.trim() !== '') x = Number(x);
      if (!Number.isInteger(x)) fail(`${key} must be an integer`);
      if (x < min) fail(`${key} must be at least ${min}`);
      if (x > max) fail(`${key} must be at most ${max}`);
      return x;
    };
  },
  bool() {
    return (x, key) => {
      if (typeof x === 'boolean') return x;
      if (x === 1 || x === '1' || x === 'true' || x === 'on') return true;
      if (x === 0 || x === '0' || x === 'false' || x === 'off' || x === '' || isNil(x)) return false;
      fail(`${key} must be a boolean`);
    };
  },
  oneOf(values) {
    return (x, key) => {
      if (!values.includes(x)) fail(`${key} must be one of: ${values.join(', ')}`);
      return x;
    };
  },
  // URL-safe id: lowercase letters, digits, single dashes, 1–64 chars
  slug({ max = 64 } = {}) {
    return (x, key) => {
      x = text(x, key).toLowerCase();
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(x) || x.length > max) fail(`${key} must be a slug (a-z, 0-9, dashes)`);
      return x;
    };
  },
  url({ https = false, max = 2048 } = {}) {
    return (x, key) => {
      x = text(x, key);
      if (x.length > max) fail(`${key} is too long`);
      let u;
      try { u = new URL(x); } catch { fail(`${key} must be a valid URL`); }
      if (https ? u.protocol !== 'https:' : !['http:', 'https:'].includes(u.protocol)) {
        fail(`${key} must use ${https ? 'https' : 'http or https'}`);
      }
      if (u.username || u.password) fail(`${key} must not contain credentials`);
      return u.href;
    };
  },
  email({ max = 254 } = {}) {
    return (x, key) => {
      x = text(x, key);
      // deliberately loose: one @, no spaces, a dot in the domain
      if (x.length > max || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x)) fail(`${key} must be a valid email`);
      return x.toLowerCase();
    };
  },
  // nested object (schema) or JSON string of one; arrays via v.array
  json(schema) {
    return (x, key) => {
      if (typeof x === 'string') { try { x = JSON.parse(x); } catch { fail(`${key} must be valid JSON`); } }
      if (!x || typeof x !== 'object' || Array.isArray(x)) fail(`${key} must be an object`);
      return schema ? validateObject(schema, x, `${key}.`) : x;
    };
  },
  array(rule, { max = 1000 } = {}) {
    return (x, key) => {
      if (typeof x === 'string') { try { x = JSON.parse(x); } catch { fail(`${key} must be a JSON array`); } }
      if (isNil(x)) x = [];
      if (!Array.isArray(x)) fail(`${key} must be an array`);
      if (x.length > max) fail(`${key} may have at most ${max} items`);
      return rule ? x.map((item, i) => rule(item, `${key}[${i}]`)) : x;
    };
  },
  // undefined / null / '' → undefined (key left out of the result)
  optional(rule) {
    const f = (x, key) => (isNil(x) || x === '' ? undefined : rule(x, key));
    f.optional = true;
    return f;
  },
  // any rule with a fallback used when the value is missing
  default(rule, dflt) {
    return (x, key) => (isNil(x) || x === '' ? dflt : rule(x, key));
  },
};

function validateObject(schema, body, prefix) {
  const out = {};
  const fields = {};
  const src = body && typeof body === 'object' ? body : {};
  for (const [key, rule] of Object.entries(schema)) {
    try {
      // own properties only: inherited members (Array.prototype.sort, constructor…) never reach a rule
      const val = rule(Object.hasOwn(src, key) ? src[key] : undefined, key);
      if (val !== undefined) out[key] = val;
    } catch (e) {
      if (e instanceof Fail) fields[prefix + key] = e.message;
      else if (e instanceof HttpError && e.fields) Object.assign(fields, e.fields); // nested v.json()
      else throw e;
    }
  }
  if (Object.keys(fields).length) throw new HttpError(422, 'validation', 'Validation failed', fields);
  return out;
}

// returns the cleaned value; unknown keys in body are dropped
export function validate(schema, body) {
  return validateObject(schema, body, '');
}
