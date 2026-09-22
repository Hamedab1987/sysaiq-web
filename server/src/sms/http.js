// Outbound HTTP for the provider adapters — a thin layer over lib/http.js
// that pins the provider host, applies the relay and turns transport
// failures into SmsError. Adapters receive it as ctx.http and never call
// fetch themselves, so every request gets the SSRF guard, the timeout, the
// size cap and the {provider, op, status, ms}-only logging for free.
//   ctx.http.json({ op, url, body, headers })  ctx.http.form({ op, url, body, headers })
// Tests stub globalThis.fetch and pass `lookup` (lib/http.js has no fetch
// injection point; see the SMS report).
import { httpJson, httpForm, HttpRequestError } from '../lib/http.js';
import { SmsError } from './errors.js';

const TIMEOUT_MS = 15000;

function toSmsError(e, provider) {
  if (e instanceof SmsError) return e;
  if (e instanceof HttpRequestError) {
    const code = e.code === 'timeout' ? 'timeout'
      : e.code === 'too_large' || e.code === 'bad_url' || e.code === 'bad_relay' ? 'bad_response'
        : 'network';
    // e.message never carries a raw URL: lib/http.js builds it through redactUrl
    return new SmsError(code, { provider, message: e.message, cause: e });
  }
  return new SmsError('network', { provider, message: String(e?.message || e), cause: e });
}

export function makeHttp({ provider, hosts = null, relay = null, lookup, log, redactUrl, insecure = false, allowPrivate = false } = {}) {
  const base = {
    provider,
    relay: relay?.base ? { base: relay.base, token: relay.token || '' } : null,
    allowHosts: Array.isArray(hosts) && hosts.length ? hosts : null,
    timeoutMs: TIMEOUT_MS,
    redactUrl,
    insecure,
    allowPrivate,
  };
  if (lookup) base.lookup = lookup;
  if (log) base.log = log;
  const run = async (fn, opts) => {
    try {
      return await fn({ ...base, ...opts });
    } catch (e) {
      throw toSmsError(e, provider);
    }
  };
  return {
    json: opts => run(httpJson, opts),
    form: opts => run(httpForm, opts),
  };
}
