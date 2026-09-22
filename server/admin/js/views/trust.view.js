// «اینماد و نمادها» — trust seals (eNamad, Samandehi, custom image) shown in
// the footer / contact block, plus the readiness panel for the eNamad
// application.
//   GET /badges → rows (+preview html) · POST /badges/parse {kind, snippet | img_url, link_url}
//   POST /badges · PUT /badges/:id · DELETE /badges/:id
//   readiness: GET /setup-status · GET /site-info · GET /pages · GET /head-meta
// The pasted snippet is parsed on the server and never stored as-is; what
// the site renders is rebuilt from the parsed id/code.
import { h, icon, clear, pageHeader, card, badge, statusBadge, confirm, toast, modal, createForm, submitButton, field, textareaField, selectField, switchField, numberField, bilingualField, imageField, checklist, progressRing, skeleton, errorState, emptyState, toFaDigits, formatJalali, extLink } from '../ui.js';
import { STR } from '../strings.js';
import { api } from '../api.js';

const CSS_HREF = '/admin/css/views/trust.css';
export const KINDS = ['enamad', 'samandehi', 'custom_image'];
export const PLACEMENTS = ['footer', 'contact', 'both'];
export const REQUIRED_PAGES = ['about', 'terms', 'privacy', 'refund'];

const T = {
  title: 'اینماد و نمادها', subtitle: 'نمادهای اعتماد (اینماد، ساماندهی یا تصویر دلخواه) که در پانویس و بخش تماس نشان داده می‌شوند. کد نماد را از پنل مرجع کپی کنید؛ ما آن را می‌خوانیم و همیشه به‌شکل امن نمایش می‌دهیم.',
  eyebrow: '[ SYSAIQ—ADMIN / TRUST ]',
  add: 'افزودن نماد', addTitle: 'نماد جدید', editTitle: 'ویرایش نماد',
  kind: { enamad: 'اینماد (نماد اعتماد الکترونیکی)', samandehi: 'نشان ساماندهی', custom_image: 'تصویر دلخواه' },
  kindShort: { enamad: 'اینماد', samandehi: 'ساماندهی', custom_image: 'تصویر' },
  placement: { footer: 'پانویس', contact: 'بخش تماس', both: 'پانویس و تماس' },
  kindF: 'نوع نماد', snippetF: 'کد نماد (همان که پنل مرجع می‌دهد)', snippetHint: 'کل کد <a …><img …></a> را جای‌گذاری کنید. اسکریپت‌ها اجرا نمی‌شوند؛ فقط شناسه و کد نماد خوانده می‌شود.',
  imgF: 'تصویر نماد', linkF: 'لینک مقصد (https)', linkHint: 'با کلیک روی نماد باز می‌شود؛ باید https باشد.',
  parse: 'بررسی کد', parsed: 'کد خوانده شد', parseFirst: 'ابتدا کد را بررسی کنید.',
  sealId: 'شناسه', sealCode: 'کد', preview: 'پیش‌نمایش', previewHint: 'همان چیزی که روی سایت نشان داده می‌شود.', previewNone: 'پیش‌نمایشی در دسترس نیست (کد نامعتبر).',
  labelF: 'برچسب (متن جایگزین تصویر)', placementF: 'محل نمایش', langsF: 'زبان‌ها', langFa: 'فارسی', langEn: 'English', enabledF: 'فعال', sortF: 'ترتیب', sizeF: 'اندازه (اختیاری)', widthF: 'عرض', heightF: 'ارتفاع', sizeHint: 'پیکسل؛ صفر یعنی اندازهٔ پیش‌فرض تصویر.',
  langsErr: 'دست‌کم یک زبان را انتخاب کنید.',
  colBadge: 'نماد', colKind: 'نوع', colPlacement: 'محل', colLangs: 'زبان‌ها', colStatus: 'وضعیت', colUpdated: 'به‌روزرسانی',
  empty: 'هنوز نمادی ثبت نشده است', emptyHint: 'کد اینماد یا ساماندهی را با «افزودن نماد» ثبت کنید.',
  saved: 'نماد ذخیره شد', created: 'نماد اضافه شد', enabled: 'نماد فعال شد', disabled: 'نماد غیرفعال شد',
  newSnippet: 'کد جدید (اختیاری — برای جایگزینی)', newSnippetHint: 'خالی بگذارید تا کد فعلی حفظ شود.',
  ready: 'آمادگی برای درخواست اینماد', readyHint: 'اینماد پیش از صدور نماد این موارد را روی سایت بررسی می‌کند.', readyErr: 'وضعیت آمادگی بارگذاری نشد.',
  rSite: 'اطلاعات تماس کامل', rSiteHint: 'نشانی در دو زبان، تلفن و ایمیل — دقیقاً مطابق ثبت اینماد.',
  rPage: s => ({ about: 'صفحهٔ «دربارهٔ ما» منتشر شده', terms: 'صفحهٔ «قوانین و مقررات» منتشر شده', privacy: 'صفحهٔ «حریم خصوصی» منتشر شده', refund: 'صفحهٔ «بازپرداخت» منتشر شده' })[s] || s,
  rPageHint: 'پیش از انتشار، متن باید بازبینی حقوقی شده باشد.',
  rMeta: 'تگ تأیید مالکیت اینماد (meta)', rMetaHint: 'کد تأیید را در «سئو و تگ‌های تأیید» ثبت کنید.',
  rBadge: 'کد نماد اینماد ثبت و فعال شده', rBadgeHint: 'پس از صدور نماد، کد آن را این‌جا اضافه کنید.',
  rPassword: 'رمز پیش‌فرض مدیر تغییر کرده', rPasswordHint: 'برای امنیت پنل.',
};

function ensureStylesheet(href) {
  if (document.head.querySelector(`link[data-view-css="${href}"]`)) return;
  document.head.appendChild(h('link', { rel: 'stylesheet', href, 'data-view-css': href }));
}
// the server's canonical badge markup (built from parsed fields) → nodes
export function previewNodes(html) {
  const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
  for (const el of doc.querySelectorAll('script, iframe, object, embed, style, link, form')) el.remove();
  for (const el of doc.body.querySelectorAll('*')) {
    for (const a of [...el.attributes]) {
      if (/^on/i.test(a.name) || (/^(href|src|action|xlink:href)$/i.test(a.name) && /^\s*(javascript|vbscript):/i.test(a.value))) el.removeAttribute(a.name);
    }
  }
  return [...doc.body.childNodes];
}
const opts = (keys, labels) => keys.map(k => ({ value: k, label: labels[k] || k }));

// checkbox pair → value: ['fa','en'] subset
function langsField(o = {}) {
  const fa = h('input', { type: 'checkbox', value: 'fa' }), en = h('input', { type: 'checkbox', value: 'en' });
  const control = h('div.a-row', h('label.tr-check', fa, T.langFa), h('label.tr-check', en, T.langEn));
  const f = { el: null, name: o.name, type: 'langs', rules: [], listeners: new Set() };
  const get = () => [fa, en].filter(c => c.checked).map(c => c.value);
  const set = v => { const s = new Set(Array.isArray(v) ? v : String(v || '').split(',')); fa.checked = s.has('fa'); en.checked = s.has('en'); };
  const errorEl = h('div.a-error');
  const el = h('div.a-field', { dataset: { field: o.name } }, h('div.a-label', o.label), control, errorEl);
  Object.assign(f, {
    el, control,
    get value() { return get(); }, set value(v) { set(v); },
    read(values) { set(values?.[o.name]); }, write(values) { values[o.name] = get(); return values; },
    validate() { const msg = get().length ? null : T.langsErr; f.setError(msg); return msg; },
    setError(msg) { clear(errorEl); el.classList.toggle('is-invalid', !!msg); if (msg) errorEl.append(icon('alert-circle', { size: 'sm' }), msg); },
    clearError() { f.setError(null); },
    focus() { fa.focus(); }, onChange(fn) { f.listeners.add(fn); return () => f.listeners.delete(fn); }, emit() { for (const fn of f.listeners) fn(get(), f); },
    disable(v) { fa.disabled = en.disabled = !!v; }, dispose() { f.listeners.clear(); },
  });
  for (const c of [fa, en]) c.addEventListener('change', () => { if (el.classList.contains('is-invalid')) f.validate(); f.emit(); });
  return f;
}

async function mount(root, ctx) {
  ensureStylesheet(CSS_HREF);
  const addBtn = h('button.a-btn.a-btn--primary', { type: 'button', onclick: () => openDialog(null) }, icon('plus'), T.add);
  root.appendChild(pageHeader({ eyebrow: T.eyebrow, title: T.title, subtitle: T.subtitle, actions: [addBtn] }));
  const listBox = h('div', skeleton({ kind: 'cards' }));
  const readyBox = h('div', skeleton({ kind: 'lines' }));
  root.appendChild(h('div.tr-layout', card({ title: T.colBadge, body: listBox, cls: 'tr-list-card' }), card({ title: T.ready, hint: T.readyHint, body: readyBox, cls: 'tr-ready-card' })));
  let rows = [];

  // ---- list ----
  function renderList() {
    clear(listBox);
    if (!rows.length) { listBox.appendChild(emptyState({ icon: 'shield-check', title: T.empty, hint: T.emptyHint, action: { label: T.add, icon: 'plus', onClick: () => openDialog(null) } })); return; }
    const grid = h('div.tr-grid');
    for (const b of rows) {
      const langs = Array.isArray(b.langs) ? b.langs : String(b.langs || '').split(',').filter(Boolean);
      const sw = h('input', { type: 'checkbox', role: 'switch', checked: !!b.enabled, 'aria-label': `${T.enabledF} — ${T.kindShort[b.kind] || b.kind}` });
      sw.addEventListener('change', async () => { sw.disabled = true; try { const r = await api.put(`/badges/${b.id}`, { enabled: sw.checked }); Object.assign(b, r.badge); toast(sw.checked ? T.enabled : T.disabled, { timeout: 1500 }); renderList(); refreshReady(); } catch (e) { sw.checked = !sw.checked; toast.error(e.message); } finally { sw.disabled = false; } });
      const preview = h('div.tr-card__preview', { dir: 'ltr' }, b.preview ? previewNodes(b.preview) : h('span.a-small.a-muted', T.previewNone));
      grid.appendChild(h('article.tr-card', { class: b.enabled ? null : 'is-off' },
        preview,
        h('div.tr-card__body',
          h('div.a-row', badge(T.kindShort[b.kind] || b.kind, { kind: 'violet', icon: 'shield-check' }), statusBadge(b.enabled ? 'enabled' : 'disabled'), badge(T.placement[b.placement] || b.placement, { icon: 'layout' }), ...langs.map(l => statusBadge(l))),
          h('div.tr-card__title', b.label_fa || b.label_en || T.kind[b.kind]),
          b.seal_id ? h('div.a-small.a-muted.a-mono', { dir: 'ltr' }, `${T.sealId}: ${b.seal_id} · ${T.sealCode}: ${b.seal_code}`) : null,
          b.kind === 'custom_image' && b.link_url ? extLink(b.link_url, b.link_url.replace(/^https:\/\//, ''), { class: 'a-small' }) : null,
          h('div.a-small.a-muted', `${T.colUpdated}: ${formatJalali(b.updated_at || b.created_at, { style: 'relative' })}`)),
        h('div.tr-card__tools',
          h('label.a-switch', sw, h('span.a-switch__track', { 'aria-hidden': 'true' }), h('span.a-switch__text', T.enabledF)),
          h('span.a-grow'),
          h('button.a-btn.a-btn--subtle.a-btn--sm', { type: 'button', onclick: () => openDialog(b) }, icon('pencil', { size: 'sm' }), STR.actions.edit),
          h('button.a-btn.a-btn--subtle.a-btn--sm.a-btn--danger', { type: 'button', onclick: () => remove(b) }, icon('trash', { size: 'sm' }), STR.actions.delete))));
    }
    listBox.appendChild(grid);
  }
  async function remove(b) {
    if (!(await confirm({ message: STR.confirm.deleteMessage(b.label_fa || T.kind[b.kind]), confirmLabel: STR.confirm.deleteConfirm, danger: true }))) return;
    try { await api.del(`/badges/${b.id}`); rows = rows.filter(x => x.id !== b.id); toast(STR.states.deleted); renderList(); refreshReady(); } catch (e) { toast.error(e.message); }
  }
  const load = async () => { try { rows = await api.get('/badges'); if (root.isConnected) renderList(); } catch (e) { listBox.replaceChildren(errorState({ error: e, retry: load })); } };

  // ---- readiness ----
  async function refreshReady() {
    const [setup, site, pages, meta] = await Promise.allSettled([api.get('/setup-status'), api.get('/site-info'), api.get('/pages'), api.get('/head-meta')]);
    if (!root.isConnected) return;
    if (pages.status === 'rejected' && site.status === 'rejected') { readyBox.replaceChildren(errorState({ title: T.readyErr, error: pages.reason, retry: refreshReady })); return; }
    const pageRows = pages.status === 'fulfilled' ? pages.value : [];
    const items = [
      { label: T.rSite, hint: T.rSiteHint, done: site.status === 'fulfilled' ? !!site.value.complete : !!setup.value?.site_info, href: '#/site-info' },
      ...REQUIRED_PAGES.map(s => { const p = pageRows.find(x => x.slug === s); return { label: T.rPage(s), hint: T.rPageHint, done: !!p?.published, href: p ? `#/pages/${p.id}` : '#/pages' }; }),
      { label: T.rMeta, hint: T.rMetaHint, done: meta.status === 'fulfilled' && (meta.value.rows || []).some(r => r.name === 'enamad' && r.enabled), href: '#/seo' },
      { label: T.rPassword, hint: T.rPasswordHint, done: setup.status === 'fulfilled' && !setup.value.default_password_suspected, href: '#/account' },
      { label: T.rBadge, hint: T.rBadgeHint, done: rows.some(b => b.kind === 'enamad' && b.enabled), onClick: () => openDialog(null) },
    ];
    const done = items.filter(i => i.done).length;
    readyBox.replaceChildren(h('div.tr-ready', progressRing({ value: done, max: items.length, label: T.ready }), checklist({ items })));
  }

  // ---- add / edit dialog ----
  function openDialog(existing) {
    const isEdit = !!existing;
    let parsed = null;   // {kind, seal_id, seal_code, link_url, img_url, preview}
    const kind = selectField({ name: 'kind', label: T.kindF, options: opts(KINDS, T.kind), disabled: isEdit });
    const snippet = textareaField({ name: 'snippet', label: isEdit ? T.newSnippet : T.snippetF, rows: 5, dir: 'ltr', mono: true, hint: isEdit ? T.newSnippetHint : T.snippetHint });
    const img = imageField({ name: 'img_url', label: T.imgF });
    const link = field({ name: 'link_url', label: T.linkF, type: 'url', dir: 'ltr', lang: 'en', hint: T.linkHint, rules: [v => (!v || /^https:\/\//.test(v) ? null : STR.fields.https)] });
    const label = bilingualField({ name: 'label', label: T.labelF, flat: true, maxLength: 80 });
    const placement = selectField({ name: 'placement', label: T.placementF, options: opts(PLACEMENTS, T.placement) });
    const langs = langsField({ name: 'langs', label: T.langsF });
    const enabled = switchField({ name: 'enabled', label: T.enabledF });
    const sort = numberField({ name: 'sort', label: T.sortF, min: -1000000, max: 1000000, nullable: false });
    const width = numberField({ name: 'width', label: T.widthF, min: 0, max: 2000, nullable: false, suffix: 'px' });
    const height = numberField({ name: 'height', label: T.heightF, min: 0, max: 2000, nullable: false, suffix: 'px' });
    const parseBtn = h('button.a-btn', { type: 'button', onclick: () => parse() }, icon('search'), T.parse);
    const result = h('div.tr-parsed', { hidden: true });
    const sealBox = h('div.a-stack.a-stack--sm', snippet.el, h('div.a-row', parseBtn), result);
    const customBox = h('div.a-stack.a-stack--sm', img.el, link.el);
    const showKind = () => { const c = kind.value === 'custom_image'; sealBox.hidden = c; customBox.hidden = !c; };
    kind.onChange(() => { parsed = null; result.hidden = true; showKind(); });
    showKind();

    const showParsed = p => {
      parsed = p;
      clear(result);
      result.hidden = false;
      result.append(
        h('div.a-row', badge(T.parsed, { kind: 'ok', icon: 'check-circle' }), p.seal_id ? h('code', { dir: 'ltr' }, `${T.sealId}: ${p.seal_id}`) : null, p.seal_code ? h('code', { dir: 'ltr' }, `${T.sealCode}: ${p.seal_code}`) : null),
        h('div.tr-parsed__preview', { dir: 'ltr' }, p.preview ? previewNodes(p.preview) : h('span.a-small.a-muted', T.previewNone)));
    };
    async function parse() {
      const k = kind.value;
      const body = k === 'custom_image' ? { kind: k, img_url: img.value, link_url: link.value } : { kind: k, snippet: snippet.value };
      form.clearErrors();
      try { showParsed(await api.post('/badges/parse', body)); return true; }
      catch (e) { if (e?.fields) form.setErrors(e.fields, { message: e.message }); else toast.error(e.message); return false; }
    }

    const form = createForm({
      fields: [kind, snippet, img, link, label, placement, langs, enabled, sort, width, height],
      dirtyToken: `badge-${existing?.id || 'new'}`,
      render: () => h('div.a-stack', kind.el, sealBox, customBox, h('section.a-form__section', label.el, h('div.a-form__grid.a-form__grid--2', placement.el, langs.el), h('div.a-form__grid.a-form__grid--3', enabled.el, sort.el, h('div.a-form__grid.a-form__grid--2', width.el, height.el)), h('div.a-hint', T.sizeHint))),
      values: existing ? { ...existing, snippet: '', langs: existing.langs, enabled: !!existing.enabled } : { kind: 'enamad', snippet: '', img_url: '', link_url: '', label_fa: '', label_en: '', placement: 'footer', langs: ['fa', 'en'], enabled: true, sort: 0, width: 0, height: 0 },
      async onSubmit(v) {
        const meta = { label_fa: v.label_fa, label_en: v.label_en, placement: v.placement, langs: v.langs, enabled: !!v.enabled, sort: Number(v.sort) || 0, width: Number(v.width) || 0, height: Number(v.height) || 0 };
        if (isEdit) {
          const body = { ...meta };
          if (existing.kind === 'custom_image') { body.img_url = v.img_url; body.link_url = v.link_url; }
          else if (v.snippet.trim()) body.snippet = v.snippet;
          const r = await api.put(`/badges/${existing.id}`, body);
          Object.assign(existing, r.badge);
          toast(T.saved);
        } else {
          if (!parsed && !(await parse())) { toast.error(T.parseFirst); return false; }
          const body = v.kind === 'custom_image' ? { kind: v.kind, img_url: v.img_url, link_url: v.link_url, ...meta } : { kind: v.kind, snippet: v.snippet, ...meta };
          const r = await api.post('/badges', body);
          rows.push(r.badge);
          toast(T.created);
        }
        dlg.close(true);
        renderList(); refreshReady();
        return true;
      },
    });
    const dlg = modal({
      title: isEdit ? `${T.editTitle} — ${T.kindShort[existing.kind] || existing.kind}` : T.addTitle, size: 'lg',
      body: form.el,
      actions: [{ label: STR.actions.cancel, kind: 'ghost', value: false }, { label: isEdit ? STR.actions.save : STR.actions.create, kind: 'primary', icon: 'save', close: false, onClick: async () => { await form.submit(); return false; } }],
      onClose: () => form.destroy(),
    });
    dlg.open();
  }

  await Promise.all([load(), refreshReady()]);
}

export default { title: T.title, mount };
