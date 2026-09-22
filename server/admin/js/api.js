// HTTP client for /api/admin. Every request carries the session cookie and
// the CSRF header (middleware/csrf.js checks X-Requested-With on writes;
// sending it on reads too costs nothing). Errors are ApiError {status, code,
// message (Persian), fields}. A 401 emits `auth:expired` on the store so the
// shell can show the login overlay without unmounting the current view.
//
//   const rows = await api.get('/projects');
//   await api.put(`/projects/${id}`, body);        // body → JSON
//   await api.upload('/upload', file, { onProgress: p => … });
//   api.get('/api/ai/chat')                          // absolute /api paths pass through
import { store } from './store.js';
import { STR } from './strings.js';

const BASE = '/api/admin';
const CSRF = { 'X-Requested-With': 'sysaiq-admin' };

export class ApiError extends Error {
  constructor(status, code, message, fields, raw) {
    super(message || code);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.fields = fields || null;
    this.raw = raw;
  }
  get isValidation() { return this.status === 422 && !!this.fields; }
  get isNetwork() { return this.status === 0; }
}

// The server's field messages are terse English ("slug must be at most 200
// characters"). Map the recurring shapes to Persian; anything unknown
// falls back to a generic "invalid" so the owner never sees raw English.
export function translateFieldError(msg) {
  const s = String(msg || '');
  let m;
  if ((m = /at most (\d+) characters/.exec(s))) return STR.fields.maxLength(m[1]);
  if ((m = /at least (\d+) characters/.exec(s))) return STR.fields.minLength(m[1]);
  if ((m = /at most (\d+) items/.exec(s))) return STR.fields.max(m[1]);
  if ((m = /must be at most (-?\d+)/.exec(s))) return STR.fields.max(m[1]);
  if ((m = /must be at least (-?\d+)/.exec(s))) return STR.fields.min(m[1]);
  if (/is required|required/.test(s)) return STR.fields.required;
  if (/must be an integer/.test(s)) return STR.fields.integer;
  if (/valid email/.test(s)) return STR.fields.email;
  if (/must be a slug/.test(s)) return STR.fields.slug;
  if (/must use https/.test(s)) return STR.fields.https;
  if (/valid URL/.test(s)) return STR.fields.url;
  if (/valid JSON/.test(s)) return STR.fields.json;
  if (/differ from the current/.test(s)) return STR.account.sameAsCurrent;
  if (/current password is incorrect/.test(s)) return STR.account.wrongCurrent;
  if (/letter and a digit/.test(s)) return STR.account.rule;
  return STR.fields.invalid;
}

function messageFor(status, body) {
  const code = body?.error;
  if (status === 401) return STR.errors.unauthorized;
  if (status === 403) return code === 'csrf' ? STR.errors.csrf : STR.errors.forbidden;
  if (status === 404) return STR.errors.notFound;
  if (status === 413) return STR.errors.tooLarge;
  if (status === 422) return code === 'unsupported_image' ? STR.errors.unsupportedImage : STR.errors.validation;
  if (status === 429) return STR.errors.rateLimited;
  if (status >= 500) return STR.errors.server;
  if (code === 'file_too_large') return STR.errors.fileTooLarge;
  return STR.errors.unknown;
}

function urlFor(path) {
  if (/^https?:\/\//.test(path) || path.startsWith('/api/')) return path;
  return BASE + (path.startsWith('/') ? path : `/${path}`);
}

async function parseBody(res) {
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) { try { return await res.json(); } catch { return null; } }
  try { return await res.text(); } catch { return null; }
}

function toError(status, body) {
  const obj = body && typeof body === 'object' ? body : null;
  const code = obj?.error || (status === 429 ? 'rate_limited' : `http_${status}`);
  let fields = null;
  if (obj?.fields && typeof obj.fields === 'object') {
    fields = {};
    for (const [k, v] of Object.entries(obj.fields)) fields[k] = translateFieldError(v);
  }
  return new ApiError(status, code, messageFor(status, obj), fields, obj || body);
}

export async function request(method, path, { body, headers = {}, signal, raw = false } = {}) {
  const init = { method, headers: { ...CSRF, ...headers }, credentials: 'same-origin', signal };
  if (body !== undefined && body !== null) {
    if (body instanceof FormData || body instanceof Blob) init.body = body;
    else { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
  }
  let res;
  try { res = await fetch(urlFor(path), init); } catch (e) {
    if (e?.name === 'AbortError') throw e;
    throw new ApiError(0, 'network', STR.errors.network, null, e);
  }
  if (raw) return res;
  const data = await parseBody(res);
  if (res.ok) return data;
  const err = toError(res.status, data);
  if (res.status === 401 && !path.endsWith('/login')) store.emit('auth:expired', { path });
  throw err;
}

export const get = (path, opts) => request('GET', path, opts);
export const post = (path, body, opts) => request('POST', path, { ...opts, body });
export const put = (path, body, opts) => request('PUT', path, { ...opts, body });
export const patch = (path, body, opts) => request('PATCH', path, { ...opts, body });
export const del = (path, opts) => request('DELETE', path, opts);

// multipart upload with progress (XHR: fetch has no upload progress yet)
export function upload(path, file, { field = 'file', onProgress, extra } = {}) {
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    fd.append(field, file, file.name || 'upload');
    for (const [k, v] of Object.entries(extra || {})) fd.append(k, v);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', urlFor(path));
    xhr.withCredentials = true;
    for (const [k, v] of Object.entries(CSRF)) xhr.setRequestHeader(k, v);
    xhr.responseType = 'json';
    if (onProgress) xhr.upload.addEventListener('progress', e => { if (e.lengthComputable) onProgress(e.loaded / e.total); });
    xhr.addEventListener('load', () => {
      const body = xhr.response;
      if (xhr.status >= 200 && xhr.status < 300) return resolve(body);
      if (xhr.status === 401) store.emit('auth:expired', { path });
      reject(toError(xhr.status, body));
    });
    xhr.addEventListener('error', () => reject(new ApiError(0, 'network', STR.errors.network)));
    xhr.addEventListener('abort', () => reject(new ApiError(0, 'aborted', STR.errors.uploadFailed)));
    xhr.send(fd);
  });
}

export const api = { get, post, put, patch, del, upload, request, ApiError, translateFieldError };
export default api;
