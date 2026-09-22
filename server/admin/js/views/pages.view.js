// «صفحات» — server-rendered pages (/fa/<slug>, /en/<slug>). #/pages → list ·
// #/pages/:id → editor (#/pages/new creates). Draft / preview / publish model
// with version + effective date for legal pages.
//   GET  /pages · GET /pages/:id · POST /pages · PUT /pages/:id (partial) · DELETE /pages/:id
//   POST /pages/preview {body, lang, title, kind, version, effective_at} → {html}
// System pages (system_key set): slug locked, delete disabled. Publishing
// needs both languages (the server answers 422 on the missing fields).
import { h, icon, clear, pageHeader, card, badge, statusBadge, dataTable, filterBar, matchesQuery, confirm, toast, createForm, submitButton, stickyActionBar, field, selectField, switchField, numberField, dateFieldJalali, slugField, bilingualField, skeleton, errorState, debounce, toFaDigits, formatJalali, extLink } from '../ui.js';
import { STR } from '../strings.js';
import { api } from '../api.js';

const CSS_HREF = '/admin/css/views/pages.css';
// {{site.*}} tokens lib/siteinfo.js substitutes when the page renders
export const TOKENS = ['site.brand', 'site.owner_name', 'site.address', 'site.landline', 'site.mobile', 'site.email', 'site.hours'];
export const REQUIRED_SLUGS = ['about', 'terms', 'privacy', 'refund'];

const T = {
  title: 'صفحات', subtitle: 'صفحات متنی سایت (دربارهٔ ما، قوانین، حریم خصوصی…) در دو زبان. پیش‌نویس فقط در پنل می‌ماند؛ «انتشار» صفحه را روی /fa و /en می‌گذارد.',
  eyebrow: '[ SYSAIQ—ADMIN / PAGES ]',
  add: 'صفحهٔ جدید', edit: 'ویرایش صفحه', create: 'صفحهٔ جدید',
  search: 'جستجو در عنوان و نامک…', allStatus: 'همهٔ وضعیت‌ها', allKinds: 'همهٔ انواع',
  colTitle: 'عنوان', colSlug: 'نامک', colKind: 'نوع', colStatus: 'وضعیت', colVersion: 'نسخه', colLegal: 'بازبینی حقوقی', colUpdated: 'به‌روزرسانی',
  kindCustom: 'معمولی', kindLegal: 'حقوقی', system: 'سیستمی',
  reviewed: 'بازبینی شده', pendingReview: 'در انتظار',
  secMain: 'متن صفحه', secMeta: 'سئو و نمایش', secLegal: 'نسخه و بازبینی حقوقی', secLegalHint: 'برای صفحات حقوقی (قوانین، حریم خصوصی، بازپرداخت…) نسخه و تاریخ اجرا زیر عنوان صفحه نمایش داده می‌شود.',
  titleF: 'عنوان', bodyF: 'متن صفحه (Markdown)', metaF: 'توضیح متا (برای موتورهای جستجو)', slugF: 'نامک (نشانی صفحه)', kindF: 'نوع صفحه', sortF: 'ترتیب در پانویس', versionF: 'نسخه', effectiveF: 'تاریخ اجرا', reviewedF: 'تاریخ بازبینی حقوقی',
  reviewedSwitch: 'متن توسط وکیل بازبینی شده', reviewedHint: 'با روشن‌کردن، تاریخ امروز به‌عنوان تاریخ بازبینی ثبت می‌شود (قابل ویرایش).',
  footerF: 'نمایش در پانویس', navF: 'نمایش در منوی بالا', noindexF: 'عدم نمایه‌سازی (noindex)',
  slugHint: 'فقط حروف لاتین کوچک، ارقام و خط تیره؛ نشانی /fa/… و /en/… می‌شود.', slugLocked: 'نامک صفحات سیستمی قابل تغییر نیست.',
  versionHint: 'مثال: 1.0', sortHint: 'عدد کوچک‌تر جلوتر می‌آید.',
  tokens: 'درج مقدار از «اطلاعات تماس»:', tokensHint: 'روی هر گزینه بزنید تا در متن (زبان فعال) درج شود؛ هنگام نمایش با مقدار واقعی جایگزین می‌شود.',
  parity: 'تیترها', parityOk: 'ساختار دو زبان یکسان است', parityWarn: (a, b) => `تعداد تیترها یکسان نیست: فارسی ${toFaDigits(a)} · English ${toFaDigits(b)}`,
  preview: 'پیش‌نمایش', previewHint: 'همان چیزی که بازدیدکننده می‌بیند (بدون سربرگ و پانویس).', previewEmpty: 'برای دیدن پیش‌نمایش، متنی بنویسید.', previewErr: 'پیش‌نمایش ساخته نشد.',
  saveDraft: 'ذخیرهٔ پیش‌نویس', save: 'ذخیره', publish: 'انتشار', unpublish: 'لغو انتشار', viewFa: 'مشاهدهٔ فارسی', viewEn: 'مشاهدهٔ انگلیسی',
  publishTitle: 'انتشار بدون بازبینی حقوقی؟', publishMsg: 'تاریخ بازبینی حقوقی خالی است. این صفحه بدون تأیید وکیل روی سایت منتشر می‌شود.', publishConfirm: 'بله، منتشر شود',
  published: 'صفحه منتشر شد', unpublished: 'صفحه از سایت برداشته شد', saved: 'ذخیره شد', createdGo: 'صفحه ساخته شد',
  notFound: 'این صفحه پیدا نشد.', systemDelete: 'صفحات سیستمی حذف نمی‌شوند؛ می‌توانید انتشار را لغو کنید.',
  bodyFaAria: 'متن فارسی', bodyEnAria: 'English text',
};

function ensureStylesheet(href) {
  if (document.head.querySelector(`link[data-view-css="${href}"]`)) return;
  document.head.appendChild(h('link', { rel: 'stylesheet', href, 'data-view-css': href }));
}
// server-rendered (escape-first) preview HTML → nodes. The renderer never
// emits script or handlers; stripping them again here costs nothing.
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
export const headingCount = md => (String(md || '').match(/^#{2,4}\s+\S/gm) || []).length;
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

// 422 {fields} → the right control. `title_en` lands on the English half of
// the bilingual field, `published` on the banner; the rest go by name.
export function applyServerErrors(form, fields, message) {
  const rest = {};
  const later = [];
  for (const [key, msg] of Object.entries(fields || {})) {
    const m = /^(\w+?)_(fa|en)$/.exec(key);
    const f = form.byName[key] || (m && form.byName[m[1]]);
    if (f && m && f[m[2]] && !form.byName[key]) later.push(() => f[m[2]].setError(msg));
    else if (f) later.push(() => f.setError(msg));
    else rest[key] = msg;
  }
  form.setErrors(rest, { message });   // clears everything first, so the specific ones go after
  for (const fn of later) fn();
  const first = form.el.querySelector('.is-invalid');
  if (first) first.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

const kindBadge = p => badge(p.kind === 'legal' ? T.kindLegal : T.kindCustom, { kind: p.kind === 'legal' ? 'violet' : null, icon: p.kind === 'legal' ? 'shield' : 'file-text' });

// ---------------------------------------------------------------- list ----
async function mountList(root, ctx) {
  root.appendChild(pageHeader({ eyebrow: T.eyebrow, title: T.title, subtitle: T.subtitle, actions: [h('a.a-btn.a-btn--primary', { href: '#/pages/new' }, icon('plus'), T.add)] }));
  let all = [];
  const table = dataTable({
    columns: [
      { key: 'title_fa', label: T.colTitle, render: r => h('div', h('div.a-table__primary', r.title_fa || '—'), h('div.a-table__secondary', { dir: 'ltr', lang: 'en' }, r.title_en || '')) },
      { key: 'slug', label: T.colSlug, ltr: true, mono: true },
      { key: 'kind', label: T.colKind, render: r => h('div.a-row', kindBadge(r), r.system_key ? badge(T.system, { icon: 'lock' }) : null) },
      { key: 'published', label: T.colStatus, render: r => statusBadge(r.published ? 'published' : 'draft') },
      { key: 'version', label: T.colVersion, render: r => (r.version ? h('span.a-mono', { dir: 'ltr' }, toFaDigits(r.version)) : '—') },
      { key: 'legal_reviewed_at', label: T.colLegal, render: r => (r.kind !== 'legal' ? h('span.a-muted', '—') : r.legal_reviewed_at ? badge(T.reviewed, { kind: 'ok', icon: 'check' }) : badge(T.pendingReview, { kind: 'warn', icon: 'clock' })) },
      { key: 'updated_at', label: T.colUpdated, render: r => formatJalali(r.updated_at, { style: 'relative' }) },
    ],
    sortable: true, sort: { key: 'sort', dir: 'asc' },
    onRowClick: r => ctx.router.navigate(`/pages/${r.id}`),
    actions: r => [
      { icon: 'pencil', label: STR.actions.edit, onClick: () => ctx.router.navigate(`/pages/${r.id}`) },
      ...(r.system_key ? [] : [{ icon: 'trash', label: STR.actions.delete, danger: true, onClick: () => remove(r) }]),
    ],
    empty: { icon: 'file-text', title: STR.states.empty, hint: STR.states.emptyHint, action: { label: T.add, icon: 'plus', onClick: () => ctx.router.navigate('/pages/new') } },
  });
  const filters = filterBar({
    search: { placeholder: T.search },
    filters: [
      { name: 'status', label: T.allStatus, options: [{ value: 'published', label: STR.states.published }, { value: 'draft', label: STR.states.draft }] },
      { name: 'kind', label: T.allKinds, options: [{ value: 'legal', label: T.kindLegal }, { value: 'custom', label: T.kindCustom }] },
    ],
    onChange: apply,
  });
  function apply(v = filters.values) {
    const rows = all.filter(r => matchesQuery(r, v.q, ['title_fa', 'title_en', 'slug']) && (!v.status || (v.status === 'published') === !!r.published) && (!v.kind || r.kind === v.kind));
    table.setRows(rows); filters.setCount(rows.length, all.length);
  }
  async function remove(r) {
    if (!(await confirm({ message: STR.confirm.deleteMessage(r.title_fa || r.slug), confirmLabel: STR.confirm.deleteConfirm, danger: true }))) return;
    try { await api.del(`/pages/${r.id}`); toast(STR.states.deleted); all = all.filter(x => x.id !== r.id); apply(); } catch (e) { toast.error(e.message); }
  }
  root.append(filters.el, table.el);
  table.setLoading(true);
  const load = async () => { try { all = await api.get('/pages'); if (root.isConnected) apply(); } catch (e) { table.setError(e, load); } };
  await load();
}

// -------------------------------------------------------------- editor ----
async function mountEditor(root, ctx, id) {
  ensureStylesheet(CSS_HREF);
  const isNew = id === 'new';
  const holder = h('div', skeleton({ kind: 'form' }));
  root.appendChild(pageHeader({ crumbs: [{ label: T.title, href: '#/pages' }, { label: isNew ? T.create : T.edit }], title: isNew ? T.create : T.edit }));
  root.appendChild(holder);
  let all = [];
  let page = { slug: '', kind: 'custom', title_en: '', title_fa: '', body_en: '', body_fa: '', meta_desc_en: '', meta_desc_fa: '', show_in_footer: 1, show_in_nav: 0, noindex: 0, version: '', effective_at: '', legal_reviewed_at: '', sort: 0, published: 0, system_key: null };
  try { all = await api.get('/pages'); } catch (e) { holder.replaceChildren(errorState({ error: e, retry: () => ctx.router.reload() })); return; }
  if (!isNew) {
    const found = all.find(p => String(p.id) === String(id));
    if (!found) { holder.replaceChildren(errorState({ title: T.notFound, retry: () => ctx.router.navigate('/pages') })); return; }
    page = { ...found };
  }
  if (!root.isConnected) return;
  const isSystem = !!page.system_key;
  root.querySelector('h1').textContent = isNew ? T.create : (page.title_fa || page.slug || T.edit);

  // --- fields ---
  const title = bilingualField({ name: 'title', label: T.titleF, flat: true, maxLength: 200 });
  const body = bilingualField({ name: 'body', label: T.bodyF, flat: true, type: 'markdown', rows: 18 });
  const meta = bilingualField({ name: 'meta_desc', label: T.metaF, flat: true, type: 'textarea', rows: 2, maxLength: 320 });
  const slug = slugField({ name: 'slug', label: T.slugF, prefix: '/fa/', required: true, hint: isSystem ? T.slugLocked : T.slugHint, disabled: isSystem, unique: s => !all.some(p => p.slug === s && String(p.id) !== String(id)) });
  if (!isSystem) slug.followField(title.en);
  const kind = selectField({ name: 'kind', label: T.kindF, options: [{ value: 'custom', label: T.kindCustom }, { value: 'legal', label: T.kindLegal }] });
  const sort = numberField({ name: 'sort', label: T.sortF, hint: T.sortHint, min: -1000000, max: 1000000, nullable: false });
  const version = field({ name: 'version', label: T.versionF, maxLength: 20, dir: 'ltr', mono: true, placeholder: '1.0', hint: T.versionHint });
  const effective = dateFieldJalali({ name: 'effective_at', label: T.effectiveF });
  const reviewedAt = dateFieldJalali({ name: 'legal_reviewed_at', label: T.reviewedF });
  const reviewedSw = switchField({ name: '_reviewed', label: T.reviewedSwitch, hint: T.reviewedHint });
  const footer = switchField({ name: 'show_in_footer', label: T.footerF });
  const nav = switchField({ name: 'show_in_nav', label: T.navF });
  const noindex = switchField({ name: 'noindex', label: T.noindexF });
  reviewedSw.onChange(on => { if (on && !reviewedAt.value) { reviewedAt.value = today(); reviewedAt.emit(); } if (!on && reviewedAt.value) { reviewedAt.value = ''; reviewedAt.emit(); } });
  reviewedAt.onChange(v => { const on = !!v; if (reviewedSw.value !== on) reviewedSw.value = on; });

  // --- token chips: insert into the body textarea that was focused last ---
  let activeLang = 'fa';
  for (const l of ['fa', 'en']) body[l].control.addEventListener('focus', () => { activeLang = l; });
  const insertToken = tok => {
    const ta = body[activeLang].control;
    const s = ta.selectionStart ?? ta.value.length, e = ta.selectionEnd ?? s;
    ta.setRangeText(`{{${tok}}}`, s, e, 'end');
    ta.focus();
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const chips = h('div.pg-tokens', h('span.pg-tokens__lbl', T.tokens), ...TOKENS.map(t => h('button.pg-chip', { type: 'button', dir: 'ltr', onclick: () => insertToken(t) }, `{{${t}}}`)));
  const parity = h('div.pg-parity', { role: 'status' });
  const refreshParity = () => {
    const a = headingCount(body.fa.value), b = headingCount(body.en.value);
    clear(parity);
    parity.classList.toggle('is-warn', a !== b);
    parity.append(icon(a === b ? 'check-circle' : 'alert-triangle', { size: 'sm' }), `${T.parity}: `, h('span.a-mono', { dir: 'ltr' }, `fa ${toFaDigits(a)} · en ${toFaDigits(b)}`), ' — ', a === b ? T.parityOk : T.parityWarn(a, b));
  };

  // --- live preview (server-rendered article) ---
  let previewLang = 'fa';
  const previewBox = h('article.pg-preview', { lang: 'fa' }, h('p.a-muted', T.previewEmpty));
  const langBtn = l => h('button.a-btn.a-btn--sm', { type: 'button', class: l === previewLang && 'a-btn--primary', dataset: { lang: l }, onclick: () => { previewLang = l; for (const b of previewBar.querySelectorAll('[data-lang]')) b.classList.toggle('a-btn--primary', b.dataset.lang === l); refreshPreview(); } }, l === 'fa' ? STR.fields.faLabel : STR.fields.enLabel);
  const previewBar = h('div.a-row', langBtn('fa'), langBtn('en'));
  let seq = 0;
  const refreshPreview = debounce(async () => {
    const md = body[previewLang].value;
    const my = ++seq;
    if (!md.trim()) { previewBox.replaceChildren(h('p.a-muted', T.previewEmpty)); return; }
    try {
      const r = await api.post('/pages/preview', { body: md, lang: previewLang, title: title[previewLang].value, kind: kind.value, version: version.value, effective_at: effective.value || '' });
      if (my !== seq || !previewBox.isConnected) return;
      previewBox.setAttribute('lang', previewLang);
      previewBox.setAttribute('dir', previewLang === 'en' ? 'ltr' : 'rtl');
      previewBox.replaceChildren(...previewNodes(r.html));
    } catch (e) { if (my === seq) previewBox.replaceChildren(h('p.a-error', T.previewErr)); }
  }, 600);
  body.onChange(() => { refreshParity(); refreshPreview(); });
  for (const f of [title, kind, version, effective]) f.onChange(() => refreshPreview());

  const form = createForm({
    fields: [title, body, meta, slug, kind, sort, version, effective, reviewedAt, reviewedSw, footer, nav, noindex],
    dirtyToken: `page-${id}`,
    render: () => h('div.pg-layout',
      h('div.pg-main',
        h('section.a-form__section', h('h3', T.secMain), title.el, body.el, chips, h('div.a-hint', T.tokensHint), parity),
        h('section.a-form__section', h('h3', T.secLegal), h('div.a-hint', T.secLegalHint), h('div.a-form__grid.a-form__grid--3', kind.el, version.el, effective.el), h('div.a-form__grid.a-form__grid--2', reviewedAt.el, reviewedSw.el)),
        h('section.a-form__section', h('h3', T.secMeta), meta.el, h('div.a-form__grid.a-form__grid--2', slug.el, sort.el), h('div.a-form__grid.a-form__grid--3', footer.el, nav.el, noindex.el))),
      h('aside.pg-side', card({ title: T.preview, hint: T.previewHint, actions: [previewBar], body: previewBox }))),
    values: { ...page, _reviewed: !!page.legal_reviewed_at },
    onSubmit: () => save(page.published ? 1 : 0),
    onDirty: d => bar?.setDirty(d),
  });
  refreshParity();
  refreshPreview();

  const bodyFor = (values, published) => {
    const { _reviewed, ...rest } = values;
    const out = { ...rest, published, sort: Number(rest.sort) || 0, show_in_footer: rest.show_in_footer ? 1 : 0, show_in_nav: rest.show_in_nav ? 1 : 0, noindex: rest.noindex ? 1 : 0, effective_at: rest.effective_at || '', legal_reviewed_at: rest.legal_reviewed_at || '' };
    if (isSystem) delete out.slug;
    return out;
  };
  let busy = false;
  // returns true on success; false keeps the form dirty (createForm reads the boolean)
  async function save(published) {
    if (busy) return false;
    if (!form.validate()) return false;
    const values = form.getValues();
    if (published && !page.published && kind.value === 'legal' && !values.legal_reviewed_at) {
      if (!(await confirm({ title: T.publishTitle, message: T.publishMsg, confirmLabel: T.publishConfirm, danger: true, icon: 'alert-triangle' }))) return false;
    }
    busy = true; bar.setBusy(true);
    try {
      const b = bodyFor(values, published);
      if (isNew) {
        const r = await api.post('/pages', b);
        toast(T.createdGo);
        form.markClean();
        ctx.router.navigate(`/pages/${r.id}`, { replace: true });
        return true;
      }
      await api.put(`/pages/${id}`, b);
      const was = page.published;
      page = { ...page, ...b };
      form.markClean();
      paintActions();
      toast(published && !was ? T.published : !published && was ? T.unpublished : T.saved, published ? { action: { label: `${T.viewFa} ↗`, onClick: () => window.open(`/fa/${page.slug}`, '_blank', 'noopener') } } : undefined);
      return true;
    } catch (e) {
      if ((e?.status === 422 || e?.status === 409) && e.fields) applyServerErrors(form, e.fields, e.message);
      else toast.error(e?.message || STR.states.error);
      return false;
    } finally { busy = false; bar.setBusy(false); }
  }

  const deleteBtn = isNew || isSystem ? null : h('button.a-btn.a-btn--danger', { type: 'button', onclick: async () => {
    if (!(await confirm({ message: STR.confirm.deleteMessage(page.title_fa || page.slug), confirmLabel: STR.confirm.deleteConfirm, danger: true }))) return;
    try { await api.del(`/pages/${id}`); form.markClean(); toast(STR.states.deleted); ctx.router.navigate('/pages'); } catch (e) { toast.error(e.message); }
  } }, icon('trash'), STR.actions.delete);
  const links = h('span.a-row');
  const publishBtn = h('button.a-btn', { type: 'button', onclick: () => save(page.published ? 0 : 1) });
  const saveBtn = submitButton(form, { label: T.saveDraft });
  function paintActions() {
    clear(links);
    if (!isNew && page.published && page.slug) links.append(extLink(`/fa/${page.slug}`, T.viewFa, { class: 'a-btn a-btn--subtle a-btn--sm' }), extLink(`/en/${page.slug}`, T.viewEn, { class: 'a-btn a-btn--subtle a-btn--sm' }));
    clear(publishBtn);
    publishBtn.className = page.published ? 'a-btn a-btn--ghost' : 'a-btn a-btn--primary';
    publishBtn.append(icon(page.published ? 'eye-off' : 'globe'), page.published ? T.unpublish : T.publish);
    saveBtn.querySelector('span').textContent = page.published ? T.save : T.saveDraft;
    saveBtn.classList.toggle('a-btn--primary', !!page.published);
  }
  const bar = stickyActionBar({ actions: [links, isSystem ? badge(T.system, { icon: 'lock' }) : null, deleteBtn, h('a.a-btn.a-btn--ghost', { href: '#/pages' }, STR.actions.back), publishBtn, saveBtn] });
  // submitButton resets its label after a submit; ours depends on the publish state
  form.el.addEventListener('form:busy', e => { if (!e.detail) paintActions(); });
  paintActions();
  holder.replaceChildren(card({ body: form.el }), bar);
  if (isNew) title.focus();
  return () => { refreshPreview.cancel?.(); form.destroy(); };
}

export default {
  title: T.title,
  async mount(root, ctx) {
    const id = ctx.params?.id;
    if (id) return mountEditor(root, ctx, id);
    return mountList(root, ctx);
  },
};
