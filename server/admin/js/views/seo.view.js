// «سئو و تگ‌های تأیید» — <meta name content> verification tags (eNamad,
// Samandehi, Google, Bing…), sitemap / robots status and the JSON-LD the
// home page emits.
//   GET /head-meta → {names, rows} · POST /head-meta {name, content, enabled} · PUT /head-meta/:id · DELETE /head-meta/:id
//   GET /sitemap.xml · GET /robots.txt · GET /fa/ (ld+json extracted client-side)
import { h, icon, clear, pageHeader, card, badge, statusBadge, dataTable, confirm, toast, modal, createForm, submitButton, field, selectField, switchField, codeField, skeleton, errorState, toFaDigits, formatJalali, extLink, copyToClipboard } from '../ui.js';
import { STR } from '../strings.js';
import { api } from '../api.js';

const CSS_HREF = '/admin/css/views/seo.css';
// same rule as lib/trust.js HEAD_META_CONTENT_RE
export const CONTENT_RE = /^[A-Za-z0-9_\-=.:+\/ ]{1,200}$/;
const NAME_LABELS = { enamad: 'اینماد', samandehi: 'ساماندهی', 'google-site-verification': 'Google Search Console', 'msvalidate.01': 'Bing Webmaster', 'yandex-verification': 'Yandex', 'facebook-domain-verification': 'Facebook / Meta', 'p:domain_verify': 'Pinterest' };

const T = {
  title: 'سئو و تگ‌های تأیید', subtitle: 'کدهای تأیید مالکیت دامنه (اینماد، ساماندهی، گوگل، بینگ…) که در <head> همهٔ صفحات قرار می‌گیرند، به‌علاوهٔ وضعیت نقشهٔ سایت و دادهٔ ساختاریافته.',
  eyebrow: '[ SYSAIQ—ADMIN / SEO ]',
  metaTitle: 'تگ‌های تأیید', metaHint: 'هر ردیف یک <meta name="…" content="…"> است. نام از فهرست مجاز انتخاب می‌شود و مقدار فقط حروف لاتین، رقم و _ - = . : + / دارد.',
  add: 'افزودن تگ', addTitle: 'تگ تأیید جدید', editTitle: 'ویرایش تگ',
  nameF: 'نام تگ', contentF: 'مقدار (content)', contentHint: 'دقیقاً همان مقداری که سرویس می‌دهد؛ بدون <meta …>.', contentErr: 'فقط حروف لاتین، رقم و نویسه‌های _ - = . : + / (حداکثر ۲۰۰ نویسه).', enabledF: 'فعال',
  colName: 'نام', colContent: 'مقدار', colStatus: 'وضعیت', colUpdated: 'به‌روزرسانی',
  empty: 'هنوز تگی ثبت نشده است', emptyHint: 'کد تأیید اینماد یا Search Console را با «افزودن تگ» ثبت کنید.',
  saved: 'تگ ذخیره شد', created: 'تگ اضافه شد', enabled: 'تگ فعال شد', disabled: 'تگ غیرفعال شد',
  filesTitle: 'نقشهٔ سایت و robots', sitemap: 'نقشهٔ سایت', robots: 'robots.txt', checking: 'در حال بررسی…', ok: 'در دسترس', bad: 'در دسترس نیست', urls: n => `${toFaDigits(n)} نشانی`,
  ldTitle: 'دادهٔ ساختاریافته (JSON-LD) صفحهٔ اصلی', ldHint: 'همان بلوک‌هایی که موتورهای جستجو از /fa/ می‌خوانند (فقط‌خواندنی؛ از «اطلاعات تماس و هویت» ساخته می‌شود).', ldNone: 'بلوک JSON-LD در صفحهٔ اصلی پیدا نشد.', ldErr: 'صفحهٔ اصلی خوانده نشد.',
  copy: 'کپی',
};

function ensureStylesheet(href) {
  if (document.head.querySelector(`link[data-view-css="${href}"]`)) return;
  document.head.appendChild(h('link', { rel: 'stylesheet', href, 'data-view-css': href }));
}
// <script type="application/ld+json"> blocks out of a page's HTML (regex, so
// the same helper runs in Node tests; the blocks hold JSON, never markup)
export function extractJsonLd(html) {
  const out = [];
  const re = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const m of String(html || '').matchAll(re)) {
    const txt = m[1].trim();
    try { out.push(JSON.stringify(JSON.parse(txt), null, 2)); } catch { out.push(txt); }
  }
  return out;
}

async function mount(root) {
  ensureStylesheet(CSS_HREF);
  const addBtn = h('button.a-btn.a-btn--primary', { type: 'button', onclick: () => openDialog(null) }, icon('plus'), T.add);
  root.appendChild(pageHeader({ eyebrow: T.eyebrow, title: T.title, subtitle: T.subtitle, actions: [addBtn] }));
  let names = [];
  let rows = [];

  // ---- meta table ----
  const table = dataTable({
    columns: [
      { key: 'name', label: T.colName, render: r => h('div', h('div.a-table__primary', NAME_LABELS[r.name] || r.name), h('div.a-table__secondary.a-mono', { dir: 'ltr' }, r.name)) },
      { key: 'content', label: T.colContent, render: r => h('span.a-row', h('code.se-code', { dir: 'ltr' }, r.content), h('button.a-btn.a-btn--subtle.a-btn--icon.a-btn--sm', { type: 'button', 'aria-label': T.copy, title: T.copy, onclick: () => copyToClipboard(r.content) }, icon('copy', { size: 'sm' }))) },
      { key: 'enabled', label: T.colStatus, render: r => statusBadge(r.enabled ? 'enabled' : 'disabled') },
      { key: 'updated_at', label: T.colUpdated, render: r => formatJalali(r.updated_at || r.created_at, { style: 'relative' }) },
    ],
    actions: r => [
      { icon: r.enabled ? 'eye-off' : 'eye', label: r.enabled ? STR.states.disabled : STR.states.enabled, onClick: () => toggle(r) },
      { icon: 'pencil', label: STR.actions.edit, onClick: () => openDialog(r) },
      { icon: 'trash', label: STR.actions.delete, danger: true, onClick: () => remove(r) },
    ],
    empty: { icon: 'search', title: T.empty, hint: T.emptyHint, action: { label: T.add, icon: 'plus', onClick: () => openDialog(null) } },
  });
  async function toggle(r) {
    try { const res = await api.put(`/head-meta/${r.id}`, { enabled: !r.enabled }); Object.assign(r, res.row); toast(r.enabled ? T.enabled : T.disabled, { timeout: 1500 }); table.setRows(rows); } catch (e) { toast.error(e.message); }
  }
  async function remove(r) {
    if (!(await confirm({ message: STR.confirm.deleteMessage(NAME_LABELS[r.name] || r.name), confirmLabel: STR.confirm.deleteConfirm, danger: true }))) return;
    try { await api.del(`/head-meta/${r.id}`); rows = rows.filter(x => x.id !== r.id); toast(STR.states.deleted); table.setRows(rows); } catch (e) { toast.error(e.message); }
  }
  const load = async () => {
    table.setLoading(true);
    try { const r = await api.get('/head-meta'); names = r.names || []; rows = r.rows || []; if (root.isConnected) table.setRows(rows); } catch (e) { table.setError(e, load); }
  };

  function openDialog(existing) {
    const isEdit = !!existing;
    const name = selectField({ name: 'name', label: T.nameF, required: true, options: names.map(n => ({ value: n, label: `${NAME_LABELS[n] || n} — ${n}` })), placeholder: STR.actions.select });
    const content = field({ name: 'content', label: T.contentF, required: true, dir: 'ltr', lang: 'en', mono: true, maxLength: 200, hint: T.contentHint, rules: [v => (CONTENT_RE.test(String(v || '')) ? null : T.contentErr)] });
    const enabled = switchField({ name: 'enabled', label: T.enabledF });
    const form = createForm({
      fields: [name, content, enabled], dirtyToken: `meta-${existing?.id || 'new'}`, submitOnEnter: true,
      values: existing ? { ...existing, enabled: !!existing.enabled } : { name: names[0] || '', content: '', enabled: true },
      async onSubmit(v) {
        const body = { name: v.name, content: v.content.trim(), enabled: !!v.enabled };
        if (isEdit) { const r = await api.put(`/head-meta/${existing.id}`, body); Object.assign(existing, r.row); toast(T.saved); }
        else { const r = await api.post('/head-meta', body); rows.push(r.row); toast(T.created); }
        table.setRows(rows);
        dlg.close(true);
        return true;
      },
    });
    const dlg = modal({
      title: isEdit ? T.editTitle : T.addTitle, size: 'sm', body: form.el,
      actions: [{ label: STR.actions.cancel, kind: 'ghost', value: false }, { label: isEdit ? STR.actions.save : STR.actions.create, kind: 'primary', icon: 'save', close: false, onClick: async () => { await form.submit(); return false; } }],
      onClose: () => form.destroy(),
    });
    dlg.open();
  }

  // ---- sitemap / robots ----
  const filesBox = h('dl.a-dl');
  const fileRow = (label, href) => { const dd = h('dd', { dir: 'ltr' }, h('span.a-muted', T.checking)); filesBox.append(h('dt', extLink(href, label)), dd); return dd; };
  const smDd = fileRow(T.sitemap, '/sitemap.xml');
  const rbDd = fileRow(T.robots, '/robots.txt');
  const probe = async (path, dd, describe) => {
    try {
      const r = await fetch(path, { cache: 'no-cache' });
      const txt = await r.text();
      clear(dd);
      dd.append(r.ok ? badge(T.ok, { kind: 'ok', icon: 'check-circle' }) : badge(`${T.bad} (${toFaDigits(r.status)})`, { kind: 'danger', icon: 'alert-circle' }), ' ', r.ok ? describe(txt) : null);
    } catch (e) { clear(dd); dd.append(badge(T.bad, { kind: 'danger', icon: 'alert-circle' })); }
  };
  const robotsPre = h('pre.se-pre', { dir: 'ltr' });
  probe('/sitemap.xml', smDd, txt => h('span.a-small.a-muted', T.urls((txt.match(/<loc>/g) || []).length)));
  probe('/robots.txt', rbDd, txt => { robotsPre.textContent = txt.trim(); return null; });

  // ---- JSON-LD from /fa/ ----
  const ldBox = h('div.a-stack.a-stack--sm', skeleton({ kind: 'lines' }));
  (async () => {
    try {
      const r = await fetch('/fa/', { cache: 'no-cache', headers: { accept: 'text/html' } });
      const blocks = extractJsonLd(await r.text());
      if (!root.isConnected) return;
      clear(ldBox);
      if (!blocks.length) { ldBox.appendChild(h('p.a-muted', T.ldNone)); return; }
      blocks.forEach((b, i) => { const f = codeField({ name: `ld${i}`, label: `#${toFaDigits(i + 1)}`, rows: Math.min(18, b.split('\n').length + 1), disabled: true }); f.value = b; ldBox.appendChild(f.el); });
    } catch (e) { ldBox.replaceChildren(errorState({ title: T.ldErr, error: e })); }
  })();

  root.append(
    card({ title: T.metaTitle, hint: T.metaHint, body: table.el }),
    h('div.se-grid',
      card({ title: T.filesTitle, body: [filesBox, robotsPre] }),
      card({ title: T.ldTitle, hint: T.ldHint, body: ldBox })));
  await load();
}

export default { title: T.title, mount };
