// Image upload + imageField (URL input, upload button, preview, remove).
//   const { url } = await uploadImage(file, { onProgress });       // POST /api/admin/upload
//   imageField({ name: 'image', label: 'تصویر کارت', hint, aspect: '16/10' })  → value: url string
import { h, icon, clear } from './dom.js';
import { STR } from '../strings.js';
import { upload } from '../api.js';
import { makeField } from './form.js';
import { validators } from './validate.js';
import { toast } from './feedback.js';
import { formatBytes } from './format.js';

const MAX_BYTES = 8 * 1024 * 1024;
const ACCEPT = 'image/jpeg,image/png,image/webp,image/gif';

export async function uploadImage(file, { onProgress } = {}) {
  if (!file) throw new Error(STR.errors.uploadFailed);
  if (file.size > MAX_BYTES) { const e = new Error(STR.errors.fileTooLarge); e.code = 'file_too_large'; throw e; }
  const res = await upload('/upload', file, { onProgress });
  if (!res?.url) throw new Error(STR.errors.uploadFailed);
  return res;
}

export function imageField(opts = {}) {
  const { placeholder = 'https://… یا /uploads/…', disabled, allowUrl = true } = opts;
  const input = h('input.a-input.a-ltr', { type: 'text', dir: 'ltr', placeholder, disabled, autocomplete: 'off', spellcheck: 'false', 'aria-label': STR.fields.imageUrl });
  const fileInput = h('input', { type: 'file', accept: ACCEPT, tabindex: '-1', 'aria-hidden': 'true' });
  const img = h('img', { alt: '' });
  const preview = h('div.a-imgf__preview.is-empty', icon('image'));
  const progress = h('div.a-imgf__progress', { hidden: true }, h('span'));
  const bar = progress.firstChild;
  const uploadBtn = h('button.a-btn.a-btn--sm', { type: 'button', disabled, onclick: () => fileInput.click() }, icon('upload', { size: 'sm' }), STR.actions.upload);
  const removeBtn = h('button.a-btn.a-btn--sm.a-btn--subtle', { type: 'button', hidden: true, onclick: () => { f.value = ''; f.emit(); } }, icon('x', { size: 'sm' }), STR.actions.remove);
  const control = h('div.a-imgf', preview, h('div.a-imgf__body', allowUrl ? input : null, h('div.a-imgf__row', uploadBtn, removeBtn, fileInput), progress));
  const setPreview = url => {
    clear(preview);
    if (url) { img.src = url; preview.classList.remove('is-empty'); preview.appendChild(img); removeBtn.hidden = false; }
    else { preview.classList.add('is-empty'); preview.appendChild(icon('image')); removeBtn.hidden = true; }
  };
  img.addEventListener('error', () => { if (img.isConnected) { clear(preview); preview.classList.add('is-empty'); preview.appendChild(icon('alert-triangle')); } });
  const f = makeField({ ...opts, rules: [validators.urlOrPath(), ...(opts.rules || [])], control, focusEl: allowUrl ? input : uploadBtn, type: 'image',
    get: () => input.value.trim(), set: v => { input.value = v ? String(v) : ''; setPreview(input.value.trim()); } });
  input.addEventListener('input', () => { setPreview(input.value.trim()); if (f.el.classList.contains('is-invalid')) f.validate(); f.emit(); });
  input.addEventListener('blur', () => { if (input.value.trim()) f.validate(); });
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file) return;
    progress.hidden = false; bar.style.inlineSize = '0%'; uploadBtn.disabled = true; uploadBtn.classList.add('is-busy');
    try {
      const { url } = await uploadImage(file, { onProgress: p => { bar.style.inlineSize = `${Math.round(p * 100)}%`; } });
      f.value = url; f.setError(null); f.emit();
      toast(STR.states.uploaded, { kind: 'info' });
    } catch (e) {
      f.setError(e?.message || STR.errors.uploadFailed);
      toast.error(e?.message || STR.errors.uploadFailed);
    } finally { progress.hidden = true; uploadBtn.disabled = !!disabled; uploadBtn.classList.remove('is-busy'); }
  });
  f.acceptedTypes = ACCEPT;
  f.maxBytes = MAX_BYTES;
  f.hintDefault = `JPEG، PNG، WebP یا GIF — حداکثر ${formatBytes(MAX_BYTES)}`;
  return f;
}
