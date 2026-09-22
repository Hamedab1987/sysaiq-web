// Gateway registry. Imports only config + the adapters (no db), so a node
// process with NODE_ENV=production can load it alone and prove the mock is
// refused. Ids are fixed; registerGateway() lets a test add a scripted one.
import { config } from '../config.js';
import { GatewayError } from './gateways/common.js';
import zarinpal from './gateways/zarinpal.js';
import payping from './gateways/payping.js';
import zibal from './gateways/zibal.js';
import mock from './gateways/mock.js';

export const MOCK_ID = 'mock';
const registry = new Map();
for (const g of [zarinpal, payping, zibal, mock]) registry.set(g.id, g);

const isProdEnv = env => (env ?? config.env) === 'production';

export function registerGateway(adapter) {
  if (!adapter?.id || typeof adapter.create !== 'function' || typeof adapter.verify !== 'function') throw new Error('registerGateway: {id, create, verify} required');
  if (adapter.id === MOCK_ID) throw new Error('registerGateway: "mock" is built in');
  registry.set(adapter.id, adapter);
  return adapter;
}

export function gateways({ env } = {}) {
  return [...registry.values()].filter(g => g.id !== MOCK_ID || !isProdEnv(env));
}
export const gatewayIds = opts => gateways(opts).map(g => g.id);
export const hasGateway = (id, opts) => gatewayIds(opts).includes(String(id));

export function getGateway(id, { env } = {}) {
  const key = String(id || '');
  if (key === MOCK_ID && isProdEnv(env)) throw new GatewayError('mock_refused', 'the mock gateway is not available in production', { gateway: key });
  const g = registry.get(key);
  if (!g) throw new GatewayError('gateway_unknown', `unknown gateway "${key}"`, { gateway: key });
  return g;
}

// admin-facing description (no secrets; the route adds secret status)
export const describeGateway = g => ({
  id: g.id, label_fa: g.label_fa, label_en: g.label_en, wireUnit: g.wireUnit,
  minToman: g.minToman, maxToman: g.maxToman, callbackMethod: g.callbackMethod,
  secretName: g.secretName || null, configFields: g.configFields || [], hasInquiry: typeof g.inquire === 'function',
});
