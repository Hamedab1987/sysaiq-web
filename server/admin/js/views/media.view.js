// «رسانه‌ها» — image upload + copy-URL tool. The server has no listing API
// for /uploads (routes/admin/upload.routes.js is POST only), so this view
// uploads through POST /api/admin/upload and keeps a per-browser list of
// what was uploaded here (localStorage — a convenience, not the source of
// truth). Images already used by projects / services keep their URLs.
import { h, icon, clear, pageHeader, card, badge, toast, confirm, uploadImage, copyToClipboard, emptyState, formatBytes, formatJalali, toFaDigits } from '../ui.js';
import { STR } from '../strings.js';

const CSS_HREF = '/admin/css/views/media.css';
const RECENT_KEY = 'sysaiq-admin:media-recent:v1';
const ACCEPT = 'image/jpeg,image/png,image/webp,image/gif';
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_RECENT = 60;

const T = {
  title: 'رسانه‌ها', subtitle: 'تصویرها را این‌جا بارگذاری کنید و نشانی آن‌ها را در پروژه‌ها، خدمات یا بخش‌ها به کار ببرید.',
  eyebrow: '[ SYSAIQ—ADMIN / MEDIA ]',
  drop: 'تصویر را این‌جا رها کنید یا', pick: 'انتخاب فایل', accept: `JPEG، PNG، WebP یا GIF — حداکثر ${formatBytes(MAX_BYTES)} برای هر فایل`,
  uploading: n => `در حال بارگذاری ${toFaDigits(n)} فایل…`, done: n => (n === 1 ? 'یک تصویر بارگذاری شد' : `${toFaDigits(n)} تصویر بارگذاری شد`),
  recent: 'بارگذاری‌های اخیر در این مرورگر', recentHint: 'سرور فهرست فایل‌ها را نمی‌دهد؛ این فهرست فقط بارگذاری‌های همین مرورگر را نشان می‌دهد و پاک‌کردن آن، فایل را از سرور حذف نمی‌کند.',
  empty: 'هنوز چیزی بارگذاری نشده است', emptyHint: 'اولین تصویر را با کشیدن به کادر بالا یا «انتخاب فایل» بارگذاری کنید.',
  copy: 'کپی نشانی', open: 'بازکردن', forget: 'حذف از فهرست', clearAll: 'پاک‌کردن فهرست', clearTitle: 'پاک‌کردن فهرست؟', clearMsg: 'فقط فهرست این مرورگر پاک می‌شود؛ فایل‌ها روی سرور می‌مانند.',
  badType: 'فقط تصاویر JPEG، PNG، WebP و GIF پذیرفته می‌شوند.',
};

function ensureStylesheet(href) {
  if (document.head.querySelector(`link[data-view-css="${href}"]`)) return;
  document.head.appendChild(h('link', { rel: 'stylesheet', href, 'data-view-css': href }));
}
const readRecent = () => { try { const v = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); return Array.isArray(v) ? v.filter(x => x && typeof x.url === 'string' && x.url.startsWith('/uploads/')) : []; } catch { return []; } };
const writeRecent = list => { try { localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, MAX_RECENT))); } catch { /* private mode */ } };

async function mount(root) {
  ensureStylesheet(CSS_HREF);
  root.appendChild(pageHeader({ eyebrow: T.eyebrow, title: T.title, subtitle: T.subtitle }));
  let recent = readRecent();

  // ---- drop zone ----
  const fileInput = h('input', { type: 'file', accept: ACCEPT, multiple: true, tabindex: '-1', 'aria-hidden': 'true' });
  const status = h('div.md-status', { 'aria-live': 'polite' });
  const zone = h('div.md-drop', { role: 'group', 'aria-label': T.pick },
    icon('upload', { size: 'lg' }),
    h('div', T.drop, ' ', h('button.a-btn.a-btn--primary.a-btn--sm', { type: 'button', onclick: () => fileInput.click() }, icon('image', { size: 'sm' }), T.pick)),
    h('div.a-hint', T.accept), status, fileInput);
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('is-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('is-over'));
  zone.addEventListener('drop', e => { e.preventDefault(); zone.classList.remove('is-over'); handle([...(e.dataTransfer?.files || [])]); });
  fileInput.addEventListener('change', () => { handle([...(fileInput.files || [])]); fileInput.value = ''; });
  let busy = false;
  async function handle(files) {
    if (busy || !files.length) return;
    const ok = files.filter(f => ACCEPT.split(',').includes(f.type));
    if (ok.length !== files.length) toast.error(T.badType);
    if (!ok.length) return;
    busy = true; zone.classList.add('is-busy');
    let n = 0;
    for (const f of ok) {
      status.textContent = T.uploading(ok.length - n);
      try {
        const r = await uploadImage(f);
        recent = [{ url: r.url, name: f.name, bytes: f.size, at: new Date().toISOString() }, ...recent.filter(x => x.url !== r.url)];
        writeRecent(recent); renderList(); n++;
      } catch (e) { toast.error(`${f.name}: ${e?.message || STR.errors.uploadFailed}`); }
    }
    status.textContent = '';
    busy = false; zone.classList.remove('is-busy');
    if (n) toast(T.done(n));
  }

  // ---- recent grid ----
  const grid = h('div.md-grid');
  const clearBtn = h('button.a-btn.a-btn--subtle.a-btn--sm', { type: 'button', onclick: async () => { if (!(await confirm({ title: T.clearTitle, message: T.clearMsg, confirmLabel: STR.actions.clear }))) return; recent = []; writeRecent(recent); renderList(); } }, icon('trash', { size: 'sm' }), T.clearAll);
  function renderList() {
    clear(grid);
    clearBtn.hidden = !recent.length;
    if (!recent.length) { grid.appendChild(emptyState({ icon: 'image', title: T.empty, hint: T.emptyHint })); return; }
    for (const it of recent) {
      grid.appendChild(h('figure.md-item',
        h('a.md-item__img', { href: it.url, target: '_blank', rel: 'noopener noreferrer', title: T.open }, h('img', { src: it.url, alt: it.name || '', loading: 'lazy' })),
        h('figcaption.md-item__cap',
          h('div.md-item__name', { dir: 'auto' }, it.name || it.url),
          h('div.a-small.a-muted', `${it.bytes ? `${formatBytes(it.bytes)} · ` : ''}${it.at ? formatJalali(new Date(it.at), { style: 'relative' }) : ''}`),
          h('code.md-item__url', { dir: 'ltr' }, it.url),
          h('div.a-row',
            h('button.a-btn.a-btn--sm', { type: 'button', onclick: () => copyToClipboard(it.url) }, icon('copy', { size: 'sm' }), T.copy),
            h('button.a-btn.a-btn--subtle.a-btn--icon.a-btn--sm', { type: 'button', 'aria-label': T.forget, title: T.forget, onclick: () => { recent = recent.filter(x => x !== it); writeRecent(recent); renderList(); } }, icon('x', { size: 'sm' }))))));
    }
  }
  renderList();
  root.append(card({ body: zone }), card({ title: T.recent, hint: T.recentHint, actions: [badge(STR.states.items(recent.length)), clearBtn], body: grid }));
}

export default { title: T.title, mount };
