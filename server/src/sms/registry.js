// Provider registry. Imports only config + the adapters (no db), so it can
// be loaded on its own — the production test spawns a node process with
// NODE_ENV=production and asserts the mock is refused.
//   getProvider('kavenegar') → adapter · providers() → visible adapters
// registerProvider() lets a test add a scripted adapter; ids are fixed
// otherwise. Anything named 'mock' is refused whenever env is production,
// whatever the stored config says.
import { config } from '../config.js';
import { SmsError } from './errors.js';
import kavenegar from './providers/kavenegar.js';
import smsir from './providers/smsir.js';
import ghasedak from './providers/ghasedak.js';
import ippanel from './providers/ippanel.js';
import melipayamak from './providers/melipayamak.js';
import mock from './providers/mock.js';

const registry = new Map();
for (const p of [kavenegar, smsir, ghasedak, ippanel, melipayamak, mock]) registry.set(p.id, p);

export const MOCK_ID = 'mock';
const isProdEnv = env => (env ?? config.env) === 'production';

export function registerProvider(adapter) {
  if (!adapter?.id || typeof adapter.send !== 'function') throw new Error('registerProvider: {id, send} required');
  if (adapter.id === MOCK_ID) throw new Error('registerProvider: "mock" is built in');
  registry.set(adapter.id, adapter);
  return adapter;
}

export function providers({ env } = {}) {
  return [...registry.values()].filter(p => p.id !== MOCK_ID || !isProdEnv(env));
}
export const providerIds = opts => providers(opts).map(p => p.id);
export const hasProvider = (id, opts) => providerIds(opts).includes(String(id));

export function getProvider(id, { env } = {}) {
  const key = String(id || '');
  if (key === MOCK_ID && isProdEnv(env)) throw new SmsError('mock_refused', { provider: key });
  const p = registry.get(key);
  if (!p) throw new SmsError('provider_unknown', { provider: key });
  return p;
}

// admin-facing description (no secrets; the route adds the secret status)
export const describeProvider = p => ({
  id: p.id,
  label_fa: p.label_fa,
  label_en: p.label_en,
  recipientFormat: p.recipientFormat,
  supportsPattern: !!p.supportsPattern,
  supportsStatus: !!p.supportsStatus,
  secretName: p.secretName || null,
  configFields: p.configFields || [],
  // how to fill provider_map for this adapter (shown next to the template editor)
  map_help: p.mapHelp && typeof p.mapHelp === 'object' ? { fa: String(p.mapHelp.fa || ''), en: String(p.mapHelp.en || '') } : null,
});
