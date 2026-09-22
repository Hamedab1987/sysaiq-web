// «خدمات» — the service catalogue (/fa/services/<slug>). #/services → sortable
// list · #/services/:id → tabbed editor (#/services/new creates).
//   GET /services · POST /services · PUT /services/:id (partial) · DELETE /services/:id
//   POST /services/reorder {ids} · GET /projects (related-project picker)
// The 10 catalogue slugs (FACTS.md) are system rows: slug locked, no delete.
// JSON list columns travel as arrays; the server validates and stringifies.
// Publishing needs fa/en parity — the server's 422 fields are mapped back
// onto the exact control (bilingual half, repeater row).
import { h, icon, clear, pageHeader, card, tabs, badge, statusBadge, dataTable, filterBar, matchesQuery, confirm, toast, createForm, submitButton, stickyActionBar, makeField, field, numberField, switchField, slugField, bilingualField, repeater, skeleton, errorState, toFaDigits, formatJalali, extLink } from '../ui.js';
import { STR } from '../strings.js';
import { api } from '../api.js';

const CSS_HREF = '/admin/css/views/services.css';
// mirrors FACTS.md «Services catalogue (slugs are fixed)» and migration 009
export const CATALOGUE = new Set(['custom-website', 'profession-landing', 'web-app', 'ecommerce', 'mobile-app', 'ai-agent', 'automation', 'accounting-systems', 'trading-systems', 'support-maintenance']);
// a figure with a currency word: the price page explains cost factors only (FACTS.md)
export const PRICE_RE = /[\d۰-۹][\d۰-۹٬,.\s]*\s*(هزار|میلیون|میلیارد|thousand|million|k|m)?\s*(تومان|ریال|دلار|یورو|USD|IRR|EUR|\$|€)|(تومان|ریال|دلار|\$)\s*[\d۰-۹]/i;
const parseList = v => { if (Array.isArray(v)) return v; try { const x = JSON.parse(v || '[]'); return Array.isArray(x) ? x : []; } catch { return []; } };

const T = {
  title: 'خدمات', subtitle: 'کاتالوگ خدمات سایت. هر خدمت یک صفحهٔ فارسی و انگلیسی دارد؛ ترتیب این فهرست، ترتیب نمایش در سایت است.',
  eyebrow: '[ SYSAIQ—ADMIN / SERVICES ]',
  add: 'خدمت جدید', edit: 'ویرایش خدمت', create: 'خدمت جدید',
  search: 'جستجو در عنوان و نامک…', all: 'همهٔ وضعیت‌ها',
  colOrder: 'ترتیب', colTitle: 'عنوان', colSlug: 'نامک', colStatus: 'وضعیت', colUpdated: 'به‌روزرسانی', catalogue: 'کاتالوگ',
  tabIntro: 'معرفی', tabDetail: 'جزئیات', tabPrice: 'قیمت و زمان', tabFaq: 'سؤالات', tabRelated: 'پروژه‌های مرتبط', tabSeo: 'سئو',
  titleF: 'عنوان', taglineF: 'شعار کوتاه', summaryF: 'خلاصه (کارت خدمت)', slugF: 'نامک (نشانی صفحه)', iconF: 'آیکن', sortF: 'ترتیب', publishedF: 'منتشرشده',
  audienceF: 'برای چه کسانی', problemsF: 'چه مشکلی را حل می‌کند', deliverablesF: 'خروجی‌ها', deliverableItem: 'خروجی', addDeliverable: 'افزودن خروجی',
  processF: 'مراحل کار', processItem: 'مرحله', addProcess: 'افزودن مرحله', stepTitle: 'عنوان مرحله', stepDesc: 'توضیح',
  timelineF: 'زمان‌بندی (چه چیزی زمان را تعیین می‌کند)', priceF: 'رویکرد قیمت‌گذاری', priceHint: 'فقط عوامل هزینه؛ عدد ننویسید. قیمت هر پروژه در پیشنهاد کتبی مشخص می‌شود.', priceErr: 'قیمت ننویسید — این متن فقط عوامل هزینه را توضیح می‌دهد.',
  faqsF: 'سؤالات متداول این خدمت', faqItem: 'سؤال', addFaq: 'افزودن سؤال', qF: 'سؤال', aF: 'پاسخ',
  relatedF: 'پروژه‌های مرتبط (نمونه‌کار)', relatedHint: 'حداکثر ۱۲ پروژه؛ روی صفحهٔ خدمت به‌عنوان نمونه‌کار نشان داده می‌شوند.', relatedEmpty: 'هنوز پروژه‌ای ثبت نشده است.', relatedErr: 'فهرست پروژه‌ها بارگذاری نشد.',
  metaF: 'توضیح متا (برای موتورهای جستجو)',
  slugHint: 'فقط حروف لاتین کوچک، ارقام و خط تیره؛ نشانی /fa/services/… می‌شود.', slugLocked: 'نامک خدمات کاتالوگ ثابت است.', iconHint: 'نام آیکن (حروف لاتین کوچک و خط تیره)، مثال: sparkles', sortHint: 'عدد کوچک‌تر جلوتر نمایش داده می‌شود.',
  viewFa: 'مشاهدهٔ صفحهٔ فارسی', viewEn: 'مشاهدهٔ صفحهٔ انگلیسی',
  notFound: 'این خدمت پیدا نشد.', saved: 'خدمت ذخیره شد', createdGo: 'خدمت ساخته شد', reordered: 'ترتیب ذخیره شد',
  moveUp: 'انتقال به بالا', moveDown: 'انتقال به پایین',
};

function ensureStylesheet(href) {
  if (document.head.querySelector(`link[data-view-css="${href}"]`)) return;
  document.head.appendChild(h('link', { rel: 'stylesheet', href, 'data-view-css': href }));
}

// 422 {fields} → the exact control: `tagline_en` → the English half,
// `process[1].desc_fa` → row 2 of the repeater, `deliverables[0].fa` → the
// bilingual item; `published` and anything unknown go to the banner.
export function applyServerErrors(form, fields, message) {
  const rest = {};
  const later = [];
  const half = (f, lang, msg) => (f && lang && f[lang] ? () => f[lang].setError(msg) : f ? () => f.setError(msg) : null);
  for (const [key, msg] of Object.entries(fields || {})) {
    let fn = null;
    const row = /^(\w+)\[(\d+)\]\.(\w+?)(?:_(fa|en))?$/.exec(key);
    if (row) {
      const rep = form.byName[row[1]];
      const r = rep?.rows?.[Number(row[2])];
      if (r) {
        const lang = row[4] || ((row[3] === 'fa' || row[3] === 'en') ? row[3] : null);
        const base = row[4] ? row[3] : (lang ? '' : row[3]);
        const f = r.fields.find(x => x.name === base) || r.fields.find(x => x.fa && x.en) || r.fields[0];
        fn = half(f, lang, msg);
      } else if (rep) fn = () => rep.setError(msg);
    } else if (form.byName[key]) fn = () => form.byName[key].setError(msg);
    else {
      const m = /^(\w+?)_(fa|en)$/.exec(key);
      const f = m && form.byName[m[1]];
      if (f) fn = half(f, m[2], msg);
    }
    if (fn) later.push(fn); else rest[key] = msg;
  }
  form.setErrors(rest, { message });
  for (const fn of later) fn();
  form.el.querySelector('.is-invalid')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

// checkbox list of projects → value: string[] of slugs (max 12)
function projectPicker({ name, label, hint, projects, max = 12 }) {
  const boxes = new Map();
  const list = h('div.sv-pick');
  const count = h('span.a-small.a-muted');
  for (const p of projects) {
    const cb = h('input', { type: 'checkbox', value: p.slug });
    const row = h('label.sv-pick__item', cb, p.image ? h('img.sv-pick__thumb', { src: p.image, alt: '', loading: 'lazy' }) : h('span.sv-pick__thumb'), h('span.sv-pick__text', h('span', p.title_fa || p.title_en || p.slug), h('span.a-small.a-muted.a-mono', { dir: 'ltr' }, p.slug), p.published ? null : statusBadge('draft')));
    cb.addEventListener('change', () => { if (cb.checked && selected().length > max) { cb.checked = false; toast.warn(STR.fields.max(max)); return; } paint(); f.emit(); });
    boxes.set(p.slug, cb);
    list.appendChild(row);
  }
  const selected = () => [...boxes.entries()].filter(([, cb]) => cb.checked).map(([s]) => s);
  const paint = () => { count.textContent = STR.states.items(selected().length); for (const [, cb] of boxes) cb.closest('label').classList.toggle('is-on', cb.checked); };
  const control = h('div.a-stack.a-stack--sm', projects.length ? list : h('div.a-rep__empty', T.relatedEmpty), count);
  const f = makeField({ name, label, hint, labelFor: false, type: 'picker', control, focusEl: list.querySelector('input'),
    get: selected, set: v => { const want = new Set(parseList(v)); for (const [s, cb] of boxes) cb.checked = want.has(s); paint(); } });
  paint();
  return f;
}

// ---------------------------------------------------------------- list ----
async function mountList(root, ctx) {
  ensureStylesheet(CSS_HREF);
  root.appendChild(pageHeader({ eyebrow: T.eyebrow, title: T.title, subtitle: T.subtitle, actions: [h('a.a-btn.a-btn--primary', { href: '#/services/new' }, icon('plus'), T.add)] }));
  let all = [];
  let filtered = false;
  const table = dataTable({
    columns: [
      { key: 'sort', label: T.colOrder, render: r => h('div.sv-order',
        h('button.a-btn.a-btn--subtle.a-btn--icon.a-btn--sm', { type: 'button', 'aria-label': T.moveUp, disabled: filtered || all.indexOf(r) === 0, onclick: () => move(r, -1) }, icon('arrow-up', { size: 'sm' })),
        h('span.a-mono.a-small', toFaDigits(all.indexOf(r) + 1)),
        h('button.a-btn.a-btn--subtle.a-btn--icon.a-btn--sm', { type: 'button', 'aria-label': T.moveDown, disabled: filtered || all.indexOf(r) === all.length - 1, onclick: () => move(r, 1) }, icon('arrow-down', { size: 'sm' }))), sortable: false },
      { key: 'title_fa', label: T.colTitle, render: r => h('div', h('div.a-table__primary', r.title_fa || '—'), h('div.a-table__secondary', { dir: 'ltr', lang: 'en' }, r.title_en || '')), sortable: false },
      { key: 'slug', label: T.colSlug, render: r => h('span.a-row', h('span.a-mono', { dir: 'ltr' }, r.slug), CATALOGUE.has(r.slug) ? badge(T.catalogue, { icon: 'lock' }) : null), sortable: false },
      { key: 'published', label: T.colStatus, render: r => statusBadge(r.published ? 'published' : 'draft'), sortable: false },
      { key: 'updated_at', label: T.colUpdated, render: r => formatJalali(r.updated_at, { style: 'relative' }), sortable: false },
    ],
    onRowClick: r => ctx.router.navigate(`/services/${r.id}`),
    actions: r => [
      { icon: 'pencil', label: STR.actions.edit, onClick: () => ctx.router.navigate(`/services/${r.id}`) },
      ...(CATALOGUE.has(r.slug) ? [] : [{ icon: 'trash', label: STR.actions.delete, danger: true, onClick: () => remove(r) }]),
    ],
    empty: { icon: 'briefcase', title: STR.states.empty, hint: STR.states.emptyHint, action: { label: T.add, icon: 'plus', onClick: () => ctx.router.navigate('/services/new') } },
  });
  const filters = filterBar({
    search: { placeholder: T.search },
    filters: [{ name: 'status', label: T.all, options: [{ value: 'published', label: STR.states.published }, { value: 'draft', label: STR.states.draft }] }],
    onChange: apply,
  });
  function apply(v = filters.values) {
    const rows = all.filter(r => matchesQuery(r, v.q, ['title_fa', 'title_en', 'slug']) && (!v.status || (v.status === 'published') === !!r.published));
    filtered = rows.length !== all.length;
    table.setRows(rows); filters.setCount(rows.length, all.length);
  }
  let reordering = false;
  async function move(r, dir) {
    const i = all.indexOf(r), j = i + dir;
    if (reordering || j < 0 || j >= all.length) return;
    reordering = true;
    const prev = all;
    all = [...all]; all.splice(i, 1); all.splice(j, 0, r);
    apply();
    try { await api.post('/services/reorder', { ids: all.map(x => x.id) }); toast(T.reordered, { timeout: 1200 }); }
    catch (e) { all = prev; apply(); toast.error(e.message); }
    finally { reordering = false; }
  }
  async function remove(r) {
    if (!(await confirm({ message: STR.confirm.deleteMessage(r.title_fa || r.slug), confirmLabel: STR.confirm.deleteConfirm, danger: true }))) return;
    try { await api.del(`/services/${r.id}`); toast(STR.states.deleted); all = all.filter(x => x.id !== r.id); apply(); } catch (e) { toast.error(e.message); }
  }
  root.append(filters.el, table.el);
  table.setLoading(true);
  const load = async () => { try { all = await api.get('/services'); if (root.isConnected) apply(); } catch (e) { table.setError(e, load); } };
  await load();
}

// -------------------------------------------------------------- editor ----
async function mountEditor(root, ctx, id) {
  ensureStylesheet(CSS_HREF);
  const isNew = id === 'new';
  const holder = h('div', skeleton({ kind: 'form' }));
  root.appendChild(pageHeader({ crumbs: [{ label: T.title, href: '#/services' }, { label: isNew ? T.create : T.edit }], title: isNew ? T.create : T.edit }));
  root.appendChild(holder);
  let all = [];
  let projects = [];
  let projectsErr = null;
  let svc = { slug: '', title_en: '', title_fa: '', tagline_en: '', tagline_fa: '', summary_en: '', summary_fa: '', audience_en: '', audience_fa: '', problems_en: '', problems_fa: '', deliverables: [], process: [], timeline_en: '', timeline_fa: '', price_approach_en: '', price_approach_fa: '', faqs: [], related_projects: [], meta_desc_en: '', meta_desc_fa: '', icon: '', sort: 0, published: 0 };
  try {
    const [s, p] = await Promise.allSettled([api.get('/services'), api.get('/projects')]);
    if (s.status === 'rejected') throw s.reason;
    all = s.value;
    if (p.status === 'fulfilled') projects = Array.isArray(p.value) ? p.value : []; else projectsErr = p.reason;
  } catch (e) { holder.replaceChildren(errorState({ error: e, retry: () => ctx.router.reload() })); return; }
  if (!isNew) {
    const found = all.find(x => String(x.id) === String(id));
    if (!found) { holder.replaceChildren(errorState({ title: T.notFound, retry: () => ctx.router.navigate('/services') })); return; }
    svc = { ...found, deliverables: parseList(found.deliverables), process: parseList(found.process), faqs: parseList(found.faqs), related_projects: parseList(found.related_projects) };
  }
  if (!root.isConnected) return;
  const isSystem = !isNew && CATALOGUE.has(svc.slug);
  root.querySelector('h1').textContent = isNew ? T.create : (svc.title_fa || svc.title_en || T.edit);

  const noPrice = v => (PRICE_RE.test(String(v || '')) ? T.priceErr : null);
  const title = bilingualField({ name: 'title', label: T.titleF, flat: true, requiredFa: true, maxLength: 200 });
  const tagline = bilingualField({ name: 'tagline', label: T.taglineF, flat: true, maxLength: 300 });
  const summary = bilingualField({ name: 'summary', label: T.summaryF, flat: true, type: 'textarea', rows: 3, maxLength: 600 });
  const slug = slugField({ name: 'slug', label: T.slugF, prefix: '/fa/services/', required: true, hint: isSystem ? T.slugLocked : T.slugHint, disabled: isSystem, unique: s => !all.some(x => x.slug === s && String(x.id) !== String(id)) });
  if (!isSystem) slug.followField(title.en);
  const iconF = field({ name: 'icon', label: T.iconF, maxLength: 40, dir: 'ltr', mono: true, hint: T.iconHint, rules: [v => (/^[a-z0-9-]*$/.test(String(v || '')) ? null : STR.fields.slug)] });
  const sort = numberField({ name: 'sort', label: T.sortF, hint: T.sortHint, min: -1000000, max: 1000000, nullable: false });
  const published = switchField({ name: 'published', label: T.publishedF, onText: STR.states.published, offText: STR.states.draft });
  const audience = bilingualField({ name: 'audience', label: T.audienceF, flat: true, type: 'markdown', rows: 6 });
  const problems = bilingualField({ name: 'problems', label: T.problemsF, flat: true, type: 'markdown', rows: 6 });
  const deliverables = repeater({ name: 'deliverables', label: T.deliverablesF, addLabel: T.addDeliverable, itemLabel: T.deliverableItem, empty: { en: '', fa: '' }, max: 24,
    item: () => [bilingualField({ name: '', keys: { fa: 'fa', en: 'en' }, label: T.deliverableItem, maxLength: 300 })] });
  const process = repeater({ name: 'process', label: T.processF, addLabel: T.addProcess, itemLabel: T.processItem, empty: { title_en: '', title_fa: '', desc_en: '', desc_fa: '' }, max: 24,
    item: () => [bilingualField({ name: 'title', flat: true, label: T.stepTitle, maxLength: 200 }), bilingualField({ name: 'desc', flat: true, label: T.stepDesc, type: 'textarea', rows: 2, maxLength: 1000 })] });
  const timeline = bilingualField({ name: 'timeline', label: T.timelineF, flat: true, type: 'markdown', rows: 6 });
  const price = bilingualField({ name: 'price_approach', label: T.priceF, flat: true, type: 'markdown', rows: 8, hint: T.priceHint, rules: [noPrice] });
  const faqs = repeater({ name: 'faqs', label: T.faqsF, addLabel: T.addFaq, itemLabel: T.faqItem, empty: { q_en: '', q_fa: '', a_en: '', a_fa: '' }, max: 24,
    item: () => [bilingualField({ name: 'q', flat: true, label: T.qF, maxLength: 500 }), bilingualField({ name: 'a', flat: true, label: T.aF, type: 'textarea', rows: 3, maxLength: 8000 })] });
  const related = projectPicker({ name: 'related_projects', label: T.relatedF, hint: T.relatedHint, projects });
  const meta = bilingualField({ name: 'meta_desc', label: T.metaF, flat: true, type: 'textarea', rows: 2, maxLength: 320 });

  const form = createForm({
    fields: [title, tagline, summary, slug, iconF, sort, published, audience, problems, deliverables, process, timeline, price, faqs, related, meta],
    dirtyToken: `service-${id}`,
    render: () => tabs({
      remember: 'services-editor',
      items: [
        { id: 'intro', label: T.tabIntro, icon: 'briefcase', panel: h('div.a-form__section', title.el, tagline.el, summary.el, h('div.a-form__grid.a-form__grid--2', slug.el, iconF.el), h('div.a-form__grid.a-form__grid--2', sort.el, published.el)) },
        { id: 'detail', label: T.tabDetail, icon: 'list', badge: (svc.deliverables.length + svc.process.length) || null, panel: h('div.a-form__section', audience.el, problems.el, deliverables.el, process.el) },
        { id: 'price', label: T.tabPrice, icon: 'clock', panel: h('div.a-form__section', timeline.el, price.el) },
        { id: 'faq', label: T.tabFaq, icon: 'help-circle', badge: svc.faqs.length || null, panel: h('div.a-form__section', faqs.el) },
        { id: 'related', label: T.tabRelated, icon: 'folder', badge: svc.related_projects.length || null, panel: h('div.a-form__section', projectsErr ? errorState({ title: T.relatedErr, error: projectsErr, retry: () => ctx.router.reload() }) : null, related.el) },
        { id: 'seo', label: T.tabSeo, icon: 'search', panel: h('div.a-form__section', meta.el) },
      ],
    }),
    values: svc,
    async onSubmit(values) {
      const body = { ...values, published: values.published ? 1 : 0, sort: Number(values.sort) || 0 };
      if (isSystem) delete body.slug;
      try {
        if (isNew) {
          const r = await api.post('/services', body);
          toast(T.createdGo);
          form.markClean();
          ctx.router.navigate(`/services/${r.id}`, { replace: true });
          return true;
        }
        await api.put(`/services/${id}`, body);
        svc = { ...svc, ...body };
        paintLinks();
        toast(T.saved, body.published ? { action: { label: `${T.viewFa} ↗`, onClick: () => window.open(`/fa/services/${svc.slug}`, '_blank', 'noopener') } } : undefined);
        return true;
      } catch (e) {
        if ((e?.status === 422 || e?.status === 409) && e.fields) { applyServerErrors(form, e.fields, e.message); return false; }
        throw e;
      }
    },
    onDirty: d => bar?.setDirty(d),
  });

  const links = h('span.a-row');
  const paintLinks = () => { clear(links); if (!isNew && svc.published && svc.slug) links.append(extLink(`/fa/services/${svc.slug}`, T.viewFa, { class: 'a-btn a-btn--subtle a-btn--sm' }), extLink(`/en/services/${svc.slug}`, T.viewEn, { class: 'a-btn a-btn--subtle a-btn--sm' })); };
  const deleteBtn = isNew || isSystem ? null : h('button.a-btn.a-btn--danger', { type: 'button', onclick: async () => {
    if (!(await confirm({ message: STR.confirm.deleteMessage(svc.title_fa || svc.slug), confirmLabel: STR.confirm.deleteConfirm, danger: true }))) return;
    try { await api.del(`/services/${id}`); form.markClean(); toast(STR.states.deleted); ctx.router.navigate('/services'); } catch (e) { toast.error(e.message); }
  } }, icon('trash'), STR.actions.delete);
  const bar = stickyActionBar({ actions: [links, isSystem ? badge(T.catalogue, { icon: 'lock' }) : null, deleteBtn, h('a.a-btn.a-btn--ghost', { href: '#/services' }, STR.actions.back), submitButton(form)] });
  paintLinks();
  holder.replaceChildren(card({ body: form.el }), bar);
  if (isNew) title.focus();
  return () => form.destroy();
}

export default {
  title: T.title,
  async mount(root, ctx) {
    const id = ctx.params?.id;
    if (id) return mountEditor(root, ctx, id);
    return mountList(root, ctx);
  },
};
