// Projects (portfolio). #/projects → list · #/projects/:id → editor
// (#/projects/new creates). Uses the unchanged legacy API:
//   GET /projects · POST /projects · PUT /projects/:id · DELETE /projects/:id
// industries/features/pages are sent as arrays (the server stores JSON text).
import { h, icon, pageHeader, card, tabs, dataTable, filterBar, matchesQuery, statusBadge, confirm, toast, createForm, submitButton, stickyActionBar, field, textareaField, bilingualField, slugField, tagsField, imageField, numberField, switchField, repeater, skeleton, errorState, toFaDigits, formatJalali, truncate, extLink } from '../ui.js';
import { STR } from '../strings.js';
import { api } from '../api.js';

const T = {
  title: 'پروژه‌ها', subtitle: 'نمونه‌کارهایی که در ویترین صفحهٔ اصلی و صفحهٔ «پروژه‌ها» نمایش داده می‌شوند.',
  add: 'پروژهٔ جدید', edit: 'ویرایش پروژه', create: 'پروژهٔ جدید',
  search: 'جستجو در عنوان، نامک و برچسب‌ها…', all: 'همهٔ وضعیت‌ها',
  colTitle: 'عنوان', colSlug: 'نامک', colTags: 'برچسب‌ها', colSort: 'ترتیب', colStatus: 'وضعیت', colUpdated: 'به‌روزرسانی',
  tabCard: 'کارت', tabDetail: 'صفحهٔ جزئیات', tabIndustries: 'صنایع', tabFeatures: 'قابلیت‌ها', tabPages: 'اسکرین‌ها',
  titleF: 'عنوان', descF: 'توضیح کوتاه کارت', slugF: 'نامک (نشانی صفحه)', tagsF: 'برچسب‌ها (لاتین، روی کارت)', imageF: 'تصویر کارت', sortF: 'ترتیب نمایش', publishedF: 'منتشرشده',
  taglineF: 'شعار', overviewF: 'معرفی (متن ساده)', coverEnF: 'کاور صفحهٔ جزئیات — نسخهٔ انگلیسی', coverFaF: 'کاور صفحهٔ جزئیات — نسخهٔ فارسی',
  industriesF: 'صنایع هدف', industryItem: 'صنعت', featuresF: 'قابلیت‌های متمایز', featureItem: 'قابلیت', pagesF: 'صفحات و رابط کاربری', pageItem: 'صفحه',
  featTitle: 'عنوان قابلیت', featDesc: 'توضیح', pageName: 'نام صفحه', pageDesc: 'توضیح',
  addIndustry: 'افزودن صنعت', addFeature: 'افزودن قابلیت', addPage: 'افزودن صفحه',
  viewFa: 'مشاهدهٔ صفحهٔ فارسی', viewEn: 'مشاهدهٔ صفحهٔ انگلیسی',
  slugHint: 'فقط حروف لاتین کوچک، ارقام و خط تیره؛ در نشانی /fa/work/… و /en/work/… استفاده می‌شود.',
  tagsHint: 'مثال: QUANT · PYTHON — با Enter جدا کنید.',
  sortHint: 'عدد کوچک‌تر جلوتر نمایش داده می‌شود.',
  notFound: 'این پروژه پیدا نشد.',
  saved: 'پروژه ذخیره شد', createdGo: 'پروژه ساخته شد',
};

async function loadAll() { const rows = await api.get('/projects'); return Array.isArray(rows) ? rows : []; }
const parseList = v => { if (Array.isArray(v)) return v; try { const x = JSON.parse(v || '[]'); return Array.isArray(x) ? x : []; } catch { return []; } };

// ---------------------------------------------------------------- list ----
async function mountList(root, ctx) {
  root.appendChild(pageHeader({ eyebrow: '[ SYSAIQ—ADMIN / WORK ]', title: T.title, subtitle: T.subtitle, actions: [h('a.a-btn.a-btn--primary', { href: '#/projects/new' }, icon('plus'), T.add)] }));
  let all = [];
  const table = dataTable({
    columns: [
      { key: 'image', label: '', render: r => (r.image ? h('img.a-table__thumb', { src: r.image, alt: '', loading: 'lazy' }) : h('span.a-table__thumb')), width: '72' },
      { key: 'title_fa', label: T.colTitle, render: r => h('div', h('div.a-table__primary', r.title_fa || '—'), h('div.a-table__secondary', { dir: 'ltr', lang: 'en' }, r.title_en || '')) },
      { key: 'slug', label: T.colSlug, ltr: true, mono: true },
      { key: 'tags', label: T.colTags, ltr: true, render: r => (r.tags ? h('span.a-small.a-mono', { dir: 'ltr' }, truncate(r.tags, 36)) : '—') },
      { key: 'sort', label: T.colSort, num: true },
      { key: 'published', label: T.colStatus, render: r => statusBadge(r.published ? 'published' : 'draft') },
      { key: 'updated_at', label: T.colUpdated, render: r => formatJalali(r.updated_at, { style: 'relative' }) },
    ],
    sortable: true, sort: { key: 'sort', dir: 'asc' },
    onRowClick: r => ctx.router.navigate(`/projects/${r.id}`),
    actions: r => [
      { icon: 'pencil', label: STR.actions.edit, onClick: () => ctx.router.navigate(`/projects/${r.id}`) },
      { icon: 'trash', label: STR.actions.delete, danger: true, onClick: () => remove(r) },
    ],
    empty: { icon: 'folder', title: STR.states.empty, hint: STR.states.emptyHint, action: { label: T.add, icon: 'plus', onClick: () => ctx.router.navigate('/projects/new') } },
  });
  const filters = filterBar({
    search: { placeholder: T.search },
    filters: [{ name: 'status', label: T.all, options: [{ value: 'published', label: STR.states.published }, { value: 'draft', label: STR.states.draft }] }],
    onChange: apply,
  });
  function apply(v = filters.values) {
    const rows = all.filter(r => matchesQuery(r, v.q, ['title_fa', 'title_en', 'slug', 'tags']) && (!v.status || (v.status === 'published') === !!r.published));
    table.setRows(rows); filters.setCount(rows.length, all.length);
  }
  async function remove(r) {
    if (!(await confirm({ message: STR.confirm.deleteMessage(r.title_fa || r.title_en || r.slug), confirmLabel: STR.confirm.deleteConfirm, danger: true }))) return;
    try { await api.del(`/projects/${r.id}`); toast(STR.states.deleted); all = all.filter(x => x.id !== r.id); apply(); } catch (e) { toast.error(e.message); }
  }
  root.append(filters.el, table.el);
  table.setLoading(true);
  const load = async () => { try { all = await loadAll(); if (root.isConnected) apply(); } catch (e) { table.setError(e, load); } };
  await load();
}

// -------------------------------------------------------------- editor ----
async function mountEditor(root, ctx, id) {
  const isNew = id === 'new';
  const holder = h('div', skeleton({ kind: 'form' }));
  root.appendChild(pageHeader({ crumbs: [{ label: T.title, href: '#/projects' }, { label: isNew ? T.create : T.edit }], title: isNew ? T.create : T.edit }));
  root.appendChild(holder);
  let all = [];
  let project = { slug: '', title_en: '', title_fa: '', desc_en: '', desc_fa: '', tags: '', image: '', cover_en: '', cover_fa: '', tagline_en: '', tagline_fa: '', overview_en: '', overview_fa: '', industries: [], features: [], pages: [], sort: 99, published: 1 };
  try { all = await loadAll(); } catch (e) { holder.replaceChildren(errorState({ error: e, retry: () => ctx.router.reload() })); return; }
  if (!isNew) {
    const found = all.find(p => String(p.id) === String(id));
    if (!found) { holder.replaceChildren(errorState({ title: T.notFound, retry: () => ctx.router.navigate('/projects') })); return; }
    project = { ...found, industries: parseList(found.industries), features: parseList(found.features), pages: parseList(found.pages) };
  }
  if (!root.isConnected) return;
  root.querySelector('h1').textContent = isNew ? T.create : (project.title_fa || project.title_en || T.edit);

  // --- fields ---
  const title = bilingualField({ name: 'title', label: T.titleF, flat: true, required: true, maxLength: 200 });
  const desc = bilingualField({ name: 'desc', label: T.descF, flat: true, type: 'textarea', rows: 3, maxLength: 5000 });
  const slug = slugField({ name: 'slug', label: T.slugF, prefix: '/fa/work/', required: true, hint: T.slugHint, unique: s => !all.some(p => p.slug === s && String(p.id) !== String(id)) });
  slug.followField(title.en);
  const tagsF = tagsField({ name: 'tags', label: T.tagsF, ltr: true, join: ' · ', hint: T.tagsHint, maxLength: 40 });
  const image = imageField({ name: 'image', label: T.imageF, hint: 'نسبت ۱۶:۱۰ پیشنهاد می‌شود — ' + 'JPEG، PNG، WebP یا GIF' });
  const sort = numberField({ name: 'sort', label: T.sortF, hint: T.sortHint, min: -1000000, max: 1000000, nullable: false });
  const published = switchField({ name: 'published', label: T.publishedF, onText: STR.states.published, offText: STR.states.draft });
  const tagline = bilingualField({ name: 'tagline', label: T.taglineF, flat: true, maxLength: 500 });
  const overview = bilingualField({ name: 'overview', label: T.overviewF, flat: true, type: 'textarea', rows: 6, maxLength: 20000 });
  const coverEn = imageField({ name: 'cover_en', label: T.coverEnF });
  const coverFa = imageField({ name: 'cover_fa', label: T.coverFaF });
  const industries = repeater({ name: 'industries', label: T.industriesF, addLabel: T.addIndustry, itemLabel: T.industryItem, empty: { en: '', fa: '' }, max: 30,
    item: () => [bilingualField({ name: '', keys: { fa: 'fa', en: 'en' }, label: T.industryItem, requiredFa: true, maxLength: 200 })] });
  const features = repeater({ name: 'features', label: T.featuresF, addLabel: T.addFeature, itemLabel: T.featureItem, empty: { title_en: '', title_fa: '', desc_en: '', desc_fa: '' }, max: 30,
    item: () => [bilingualField({ name: 'title', flat: true, label: T.featTitle, requiredFa: true, maxLength: 300 }), bilingualField({ name: 'desc', flat: true, label: T.featDesc, type: 'textarea', rows: 3, maxLength: 3000 })] });
  const pages = repeater({ name: 'pages', label: T.pagesF, addLabel: T.addPage, itemLabel: T.pageItem, empty: { name_en: '', name_fa: '', desc_en: '', desc_fa: '' }, max: 40,
    item: () => [bilingualField({ name: 'name', flat: true, label: T.pageName, requiredFa: true, maxLength: 300 }), bilingualField({ name: 'desc', flat: true, label: T.pageDesc, type: 'textarea', rows: 2, maxLength: 3000 })] });

  const form = createForm({
    fields: [title, desc, slug, tagsF, image, sort, published, tagline, overview, coverEn, coverFa, industries, features, pages],
    dirtyToken: `project-${id}`,
    render: () => tabs({
      remember: 'projects-editor',
      items: [
        { id: 'card', label: T.tabCard, icon: 'image', panel: h('div.a-form__section', title.el, desc.el, h('div.a-form__grid.a-form__grid--2', slug.el, tagsF.el), image.el, h('div.a-form__grid.a-form__grid--2', sort.el, published.el)) },
        { id: 'detail', label: T.tabDetail, icon: 'file-text', panel: h('div.a-form__section', tagline.el, overview.el, h('div.a-form__grid.a-form__grid--2', coverEn.el, coverFa.el)) },
        { id: 'industries', label: T.tabIndustries, icon: 'briefcase', badge: project.industries.length || null, panel: h('div.a-form__section', industries.el) },
        { id: 'features', label: T.tabFeatures, icon: 'zap', badge: project.features.length || null, panel: h('div.a-form__section', features.el) },
        { id: 'pages', label: T.tabPages, icon: 'layout', badge: project.pages.length || null, panel: h('div.a-form__section', pages.el) },
      ],
    }),
    values: project,
    async onSubmit(values) {
      const body = { ...values, published: values.published ? 1 : 0, sort: Number(values.sort) || 0 };
      if (isNew) {
        const r = await api.post('/projects', body);
        toast(T.createdGo);
        form.markClean();
        ctx.router.navigate(`/projects/${r.id}`, { replace: true });
        return true;
      }
      await api.put(`/projects/${id}`, body);
      toast(T.saved);
      // the server may have de-duplicated the slug: reflect what it kept
      try { all = await loadAll(); const fresh = all.find(p => String(p.id) === String(id)); if (fresh && fresh.slug !== values.slug) { slug.value = fresh.slug; form.markClean(); } } catch { /* fine */ }
      return true;
    },
    onDirty: d => bar?.setDirty(d),
  });

  const viewLinks = () => (project.slug && !isNew ? [extLink(`/fa/work/${project.slug}`, T.viewFa, { class: 'a-btn a-btn--subtle a-btn--sm' }), extLink(`/en/work/${project.slug}`, T.viewEn, { class: 'a-btn a-btn--subtle a-btn--sm' })] : []);
  const deleteBtn = isNew ? null : h('button.a-btn.a-btn--danger', { type: 'button', onclick: async () => {
    if (!(await confirm({ message: STR.confirm.deleteMessage(project.title_fa || project.title_en), confirmLabel: STR.confirm.deleteConfirm, danger: true }))) return;
    try { await api.del(`/projects/${id}`); form.markClean(); toast(STR.states.deleted); ctx.router.navigate('/projects'); } catch (e) { toast.error(e.message); }
  } }, icon('trash'), STR.actions.delete);
  const bar = stickyActionBar({ actions: [...viewLinks(), deleteBtn, h('a.a-btn.a-btn--ghost', { href: '#/projects' }, STR.actions.back), submitButton(form)] });

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
