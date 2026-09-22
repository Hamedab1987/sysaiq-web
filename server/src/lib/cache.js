// In-memory render cache. Any successful admin write invalidates everything
// (see routes/admin/index.js) — content is small and rebuilds are cheap, so
// a coarse "version" beats tracking dependencies.
//   const html = cached('home:fa', () => renderHome('fa'));
// The version doubles as an ETag ingredient for SSR responses.

const store = new Map();
let version = 1;

export function cached(key, fn) {
  const hit = store.get(key);
  if (hit && hit.version === version) return hit.value;
  const value = fn();
  store.set(key, { value, version });
  return value;
}

export function invalidate(prefix) {
  if (prefix === undefined) { store.clear(); version++; return; }
  for (const k of store.keys()) if (k.startsWith(prefix)) store.delete(k);
}

export const cacheVersion = () => version;
