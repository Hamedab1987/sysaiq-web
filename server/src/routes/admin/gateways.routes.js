// Gateway settings API (mounted under /api/admin/gateways).
//   GET  /gateways            → { gateways:[{…describe, enabled, sandbox, secret:{configured,hint,source}, callback_url}], default, relay_base, relay_key, pay, public_base_url }
//   PUT  /gateways            { gateways:{id:{enabled?, sandbox?, secret?}}, default?, relay_base?, relay_key?, pay?:{…} }
//                              a secret value that is empty or still masked keeps the stored one
//   POST /gateways/:id/test   read-only credential/connectivity check, run from the server's IP
// Secrets go through lib/secrets.js and come back as {configured, hint} only.
import express from 'express';
import { config } from '../../config.js';
import { HttpError, asyncHandler } from '../../lib/errors.js';
import { listSecrets, setSecret } from '../../lib/secrets.js';
import { audit } from '../../lib/audit.js';
import { gateways, getGateway, describeGateway, hasGateway } from '../../payments/registry.js';
import { readGatewaysConfig, validateGatewaysPatch, writeGatewaysConfig, readPayConfig, validatePayPatch, writePayConfig, RELAY_SECRET } from '../../payments/config.js';
import { gatewayCtx } from '../../payments/service.js';

const router = express.Router();
const MASKED = /[•…]/;

function secretStatus() {
  const out = {};
  for (const s of listSecrets()) if (s.group === 'payments') out[s.name] = { configured: s.configured, hint: s.hint, source: s.source };
  return out;
}
export function configView() {
  const cfg = readGatewaysConfig();
  const secrets = secretStatus();
  return {
    gateways: gateways().map(g => ({
      ...describeGateway(g),
      enabled: !!cfg.gateways[g.id]?.enabled,
      sandbox: !!cfg.gateways[g.id]?.sandbox,
      secret: g.secretName ? (secrets[g.secretName] || { configured: false, hint: '', source: 'none' }) : null,
      callback_url: `${config.publicBaseUrl}/api/pay/callback/${g.id}`,
    })),
    default: cfg.default,
    relay_base: cfg.relay_base,
    relay_key: secrets[RELAY_SECRET] || { configured: false, hint: '', source: 'none' },
    pay: readPayConfig(),
    public_base_url: config.publicBaseUrl,
    env: config.env,
  };
}

router.get('/', (_req, res) => res.json(configView()));

router.put('/', (req, res) => {
  const b = req.body && typeof req.body === 'object' ? req.body : {};
  // secrets ride along inside gateways.<id>.secret / relay_key; strip them before config validation
  const secrets = [];
  const gws = {};
  if (b.gateways && typeof b.gateways === 'object' && !Array.isArray(b.gateways)) {
    for (const [id, c] of Object.entries(b.gateways)) {
      if (!c || typeof c !== 'object') { gws[id] = c; continue; }
      const { secret, ...rest } = c;
      gws[id] = rest;
      if (typeof secret === 'string' && secret.trim() && !MASKED.test(secret)) {
        if (!hasGateway(id)) throw new HttpError(422, 'validation', 'Validation failed', { [`gateways.${id}`]: 'درگاه ناشناخته' });
        const g = getGateway(id);
        if (!g.secretName) throw new HttpError(422, 'validation', 'Validation failed', { [`gateways.${id}.secret`]: 'این درگاه کلیدی ندارد' });
        secrets.push([g.secretName, secret.trim()]);
      }
    }
  }
  const patch = validateGatewaysPatch({ ...('gateways' in b ? { gateways: gws } : {}), ...('default' in b ? { default: b.default } : {}), ...('relay_base' in b ? { relay_base: b.relay_base } : {}) });
  const payPatch = b.pay ? validatePayPatch(b.pay) : null;
  if (typeof b.relay_key === 'string' && b.relay_key.trim() && !MASKED.test(b.relay_key)) secrets.push([RELAY_SECRET, b.relay_key.trim()]);
  for (const [name, value] of secrets) { setSecret(name, value, req.admin?.u); audit(req, 'secret.set', 'secrets', name); }
  // enabling a gateway whose secret is still missing is allowed to be saved but reported
  const out = writeGatewaysConfig(patch);
  if (payPatch) writePayConfig(payPatch);
  audit(req, 'update', 'gateways', '', `default=${out.default || '-'} enabled=${Object.entries(out.gateways).filter(([, c]) => c.enabled).map(([k]) => k).join(',') || '-'}`);
  res.json(configView());
});

router.post('/:id/test', asyncHandler(async (req, res) => {
  const id = String(req.params.id || '').slice(0, 20);
  if (!hasGateway(id)) throw new HttpError(404, 'not_found', 'درگاه ناشناخته');
  const g = getGateway(id);
  let r;
  try { r = await g.test(gatewayCtx(g)); } catch (e) { r = { ok: false, message_fa: `اتصال برقرار نشد: ${String(e?.code || e?.message || e).slice(0, 120)}` }; }
  audit(req, 'test', 'gateways', id, r.ok ? 'ok' : 'failed');
  res.json({ ok: !!r.ok, message_fa: String(r.message_fa || '').slice(0, 300) });
}));

export default { basePath: '/gateways', order: 61, router };
