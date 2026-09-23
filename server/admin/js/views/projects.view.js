// Projects (portfolio). #/projects → list · #/projects/:id → tabbed editor
// (#/projects/new creates). API:
//   GET /projects · POST /projects · PUT /projects/:id · DELETE /projects/:id
//   GET /services (labels for the related-service select; optional)
// industries/features/pages/gallery are sent as arrays (the server stores JSON
// text). Tabs: کارت · صفحهٔ جزئیات · روایت (مسئله/راه‌حل/نتیجه/رویکرد فنی) ·
// قابلیت‌ها · اسکرین‌ها · گالری · سئو.
import { h, icon, pageHeader, card, tabs, badge, dataTable, filterBar, matchesQuery, statusBadge, confirm, toast, createForm, submitButton, stickyActionBar, field, textareaField, selectField, bilingualField, slugField, tagsField, imageField, numberField, switchField, repeater, skeleton, errorState, formatJalali, extLink } from '../ui.js';
import { STR } from '../strings.js';
import { api } from '../api.js';

const CSS_HREF = '/admin/css/views/projects.css';

// mirrors server/src/db/migrations/013_projects_story.js (CATEGORIES,
// CATEGORY_BY_SLUG, SERVICE_SLUGS) — the admin cannot import server code
export const CATEGORIES = [
  ['business-systems', 'سیستم‌های کسب‌وکار'], ['profession-landing', 'لندینگ مشاغل'],
  ['ai-automation', 'هوش مصنوعی و اتوماسیون'], ['finance-trading', 'مالی و معاملاتی'],
];
const CAT_LABEL = Object.fromEntries(CATEGORIES);
const CATEGORY_BY_SLUG = {
  restaurant: 'business-systems', ecommerce: 'business-systems', pos: 'business-systems', salon: 'business-systems',
  hotel: 'business-systems', school: 'business-systems', hr: 'business-systems',
  realestate: 'ai-automation', medical: 'ai-automation', distribution: 'ai-automation',
  accounting: 'finance-trading', trading: 'finance-trading',
  'law-landing': 'profession-landing', 'dental-landing': 'profession-landing', 'fitness-landing': 'profession-landing',
  'cafe-landing': 'profession-landing', 'architect-landing': 'profession-landing',
};
const SERVICE_SLUGS = ['custom-website', 'profession-landing', 'web-app', 'ecommerce', 'mobile-app', 'ai-agent', 'automation', 'accounting-systems', 'trading-systems', 'support-maintenance'];
const effectiveCategory = r => (CAT_LABEL[r.category] ? r.category : CATEGORY_BY_SLUG[r.slug] || '');

const T = {
  title: 'پروژه‌ها', subtitle: 'نمونه‌کارهایی که در ویترین صفحهٔ اصلی و صفحهٔ «پروژه‌ها» نمایش داده می‌شوند.',
  add: 'پروژهٔ جدید', edit: 'ویرایش پروژه', create: 'پروژهٔ جدید',
  search: 'جستجو در عنوان، نامک و برچسب‌ها…', all: 'همهٔ وضعیت‌ها', allCats: 'همهٔ دسته‌ها',
  colTitle: 'عنوان', colSlug: 'نامک', colCat: 'دسته', colSort: 'ترتیب', colStatus: 'وضعیت', colUpdated: 'به‌روزرسانی',
  onHome: 'صفحهٔ اصلی', autoCat: 'خودکار',
  tabCard: 'کارت', tabDetail: 'صفحهٔ جزئیات', tabStory: 'روایت', tabFeatures: 'قابلیت‌ها', tabPages: 'اسکرین‌ها', tabGallery: 'گالری', tabSeo: 'سئو',
  titleF: 'عنوان', descF: 'توضیح کوتاه کارت', slugF: 'نامک (نشانی صفحه)', tagsF: 'برچسب‌ها (لاتین، روی کارت)', imageF: 'تصویر کارت', sortF: 'ترتیب نمایش', publishedF: 'منتشرشده',
  categoryF: 'دسته‌بندی', categoryNone: '— بر اساس نامک (پیش‌فرض) —', categoryHint: 'فیلترهای صفحهٔ «پروژه‌ها» و «پروژه‌های مرتبط» از این دسته استفاده می‌کنند.',
  serviceF: 'خدمت مرتبط', serviceNone: '— بدون خدمت مرتبط —', serviceHint: 'پیوند به صفحهٔ خدمت فقط وقتی آن خدمت منتشر شده باشد نمایش داده می‌شود.',
  homeF: 'نمایش در صفحهٔ اصلی', homeOn: 'در ویترین', homeOff: 'فقط در صفحهٔ پروژه‌ها',
  taglineF: 'شعار', overviewF: 'معرفی (متن ساده)', coverEnF: 'کاور صفحهٔ جزئیات — نسخهٔ انگلیسی', coverFaF: 'کاور صفحهٔ جزئیات — نسخهٔ فارسی',
  industriesF: 'صنایع هدف', industryItem: 'صنعت', addIndustry: 'افزودن صنعت',
  storyIntro: 'روایت صفحهٔ پروژه به ترتیب «مسئله ← راه‌حل ← نتیجه» نمایش داده می‌شود؛ هر بخشی که خالی بماند در صفحه دیده نمی‌شود.',
  problemF: 'مسئله', solutionF: 'راه‌حل', outcomeF: 'نتیجه', techF: 'رویکرد فنی',
  outcomeHint: 'نتیجه را کیفی بنویسید — بدون عدد، درصد، نام مشتری یا نقل‌قول ساختگی.',
  techHint: 'فقط فناوری‌هایی که واقعاً به کار رفته‌اند (Node.js، SQLite، JavaScript، Python، OpenAI API و…).',
  featuresF: 'قابلیت‌های متمایز', featureItem: 'قابلیت', addFeature: 'افزودن قابلیت', featTitle: 'عنوان قابلیت', featDesc: 'توضیح',
  pagesF: 'صفحات و اسکرین‌ها', pageItem: 'صفحه', addPage: 'افزودن صفحه', pageName: 'نام صفحه', pageDesc: 'توضیح',
  galleryF: 'گالری تصاویر', galleryItem: 'تصویر', addGallery: 'افزودن تصویر', galleryImage: 'تصویر', galleryCaption: 'زیرنویس',
  galleryHint: 'حداکثر ۱۲ تصویر، نسبت ۱۶:۹ پیشنهاد می‌شود؛ در صفحهٔ پروژه با کلیک بزرگ می‌شوند.',
  seoTitleF: 'عنوان سئو', seoTitleHint: 'خالی بماند، عنوان پروژه استفاده می‌شود؛ «— SysaiQ» خودکار به انتها اضافه می‌شود. تا ۶۰ نویسه.',
  seoDescF: 'توضیح متا', seoDescHint: 'خالی بماند، شعار پروژه استفاده می‌شود. تا ۱۶۰ نویسه.',
  viewFa: 'مشاهدهٔ صفحهٔ فارسی', viewEn: 'مشاهدهٔ صفحهٔ انگلیسی',
  slugHint: 'فقط حروف لاتین کوچک، ارقام و خط تیره؛ در نشانی /fa/work/… و /en/work/… استفاده می‌شود.',
  tagsHint: 'مثال: QUANT · PYTHON — با Enter جدا کنید.',
  sortHint: 'عدد کوچک‌تر جلوتر نمایش داده می‌شود؛ اولین پروژه، «پروژهٔ شاخص» صفحهٔ پروژه‌هاست.',
  notFound: 'این پروژه پیدا نشد.',
  saved: 'پروژه ذخیره شد', createdGo: 'پروژه ساخته شد',
};

function ensureStylesheet(href) {
  if (document.head.querySelector(`link[data-view-css="${href}"]`)) return;
  document.head.appendChild(h('link', { rel: 'stylesheet', href, 'data-view-css': href }));
}

async function loadAll() { const rows = await api.get('/projects'); return Array.isArray(rows) ? rows : []; }
const parseList = v => { if (Array.isArray(v)) return v; try { const x = JSON.parse(v || '[]'); return Array.isArray(x) ? x : []; } catch { return []; } };

// ---------------------------------------------------------------- list ----
async function mountList(root, ctx) {
  ensureStylesheet(CSS_HREF);
  root.appendChild(pageHeader({ eyebrow: '[ SYSAIQ—ADMIN / WORK ]', title: T.title, subtitle: T.subtitle, actions: [h('a.a-btn.a-btn--primary', { href: '#/projects/new' }, icon('plus'), T.add)] }));
  let all = [];
  const table = dataTable({
    columns: [
      { key: 'image', label: '', render: r => (r.image ? h('img.a-table__thumb', { src: r.image, alt: '', loading: 'lazy' }) : h('span.a-table__thumb')), width: '72' },
      { key: 'title_fa', label: T.colTitle, render: r => h('div', h('div.a-table__primary', r.title_fa || '—'), h('div.a-table__secondary', { dir: 'ltr', lang: 'en' }, r.title_en || '')) },
      { key: 'slug', label: T.colSlug, ltr: true, mono: true },
      { key: 'category', label: T.colCat, render: r => {
        const c = effectiveCategory(r);
        if (!c) return '—';
        return h('span.pj-cat', CAT_LABEL[c], CAT_LABEL[r.category] ? null : h('span.a-small.a-muted', ` (${T.autoCat})`));
      } },
      { key: 'sort', label: T.colSort, num: true },
      { key: 'published', label: T.colStatus, render: r => h('span.a-row', statusBadge(r.published ? 'published' : 'draft'), r.show_on_home ? badge(T.onHome, { icon: 'home' }) : null) },
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
    filters: [
      { name: 'status', label: T.all, options: [{ value: 'published', label: STR.states.published }, { value: 'draft', label: STR.states.draft }] },
      { name: 'category', label: T.allCats, options: CATEGORIES.map(([value, label]) => ({ value, label })) },
    ],
    onChange: apply,
  });
  function apply(v = filters.values) {
    const rows = all.filter(r => matchesQuery(r, v.q, ['title_fa', 'title_en', 'slug', 'tags'])
      && (!v.status || (v.status === 'published') === !!r.published)
      && (!v.category || effectiveCategory(r) === v.category));
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

// a fa/en pair of single-line fields with live counters (SEO title)
function pairGroup(label, hint, a, b) {
  return h('div.a-fieldset', { role: 'group', 'aria-label': label }, h('div.a-fieldset__legend', label), h('div.a-bi', a.el, b.el), hint ? h('div.a-hint', hint) : null);
}

// -------------------------------------------------------------- editor ----
async function mountEditor(root, ctx, id) {
  ensureStylesheet(CSS_HREF);
  const isNew = id === 'new';
  const holder = h('div', skeleton({ kind: 'form' }));
  root.appendChild(pageHeader({ crumbs: [{ label: T.title, href: '#/projects' }, { label: isNew ? T.create : T.edit }], title: isNew ? T.create : T.edit }));
  root.appendChild(holder);
  let all = [];
  let services = [];
  let project = {
    slug: '', title_en: '', title_fa: '', desc_en: '', desc_fa: '', tags: '', image: '', cover_en: '', cover_fa: '',
    tagline_en: '', tagline_fa: '', overview_en: '', overview_fa: '', industries: [], features: [], pages: [], gallery: [],
    category: '', service_slug: '', problem_en: '', problem_fa: '', solution_en: '', solution_fa: '', outcome_en: '', outcome_fa: '', tech_en: '', tech_fa: '',
    seo_title_en: '', seo_title_fa: '', seo_desc_en: '', seo_desc_fa: '', sort: 99, published: 1, show_on_home: 0,
  };
  try {
    const [p, s] = await Promise.allSettled([loadAll(), api.get('/services')]);
    if (p.status === 'rejected') throw p.reason;
    all = p.value;
    if (s.status === 'fulfilled' && Array.isArray(s.value)) services = s.value;
  } catch (e) { holder.replaceChildren(errorState({ error: e, retry: () => ctx.router.reload() })); return; }
  if (!isNew) {
    const found = all.find(p => String(p.id) === String(id));
    if (!found) { holder.replaceChildren(errorState({ title: T.notFound, retry: () => ctx.router.navigate('/projects') })); return; }
    project = { ...project, ...found, industries: parseList(found.industries), features: parseList(found.features), pages: parseList(found.pages), gallery: parseList(found.gallery) };
    for (const k of Object.keys(project)) if (project[k] === null) project[k] = '';
  }
  if (!root.isConnected) return;
  root.querySelector('h1').textContent = isNew ? T.create : (project.title_fa || project.title_en || T.edit);

  // --- card ---
  const title = bilingualField({ name: 'title', label: T.titleF, flat: true, required: true, maxLength: 200 });
  const desc = bilingualField({ name: 'desc', label: T.descF, flat: true, type: 'textarea', rows: 3, maxLength: 5000 });
  const slug = slugField({ name: 'slug', label: T.slugF, prefix: '/fa/work/', required: true, hint: T.slugHint, unique: s => !all.some(p => p.slug === s && String(p.id) !== String(id)) });
  slug.followField(title.en);
  const tagsF = tagsField({ name: 'tags', label: T.tagsF, ltr: true, join: ' · ', hint: T.tagsHint, maxLength: 40 });
  const image = imageField({ name: 'image', label: T.imageF, hint: 'نسبت ۱۶:۹ پیشنهاد می‌شود — ' + 'JPEG، PNG، WebP یا GIF' });
  const category = selectField({ name: 'category', label: T.categoryF, placeholder: T.categoryNone, hint: T.categoryHint, options: CATEGORIES.map(([value, label]) => ({ value, label })) });
  const svcTitle = s => { const row = services.find(x => x.slug === s); return row ? `${row.title_fa || row.title_en || s}${row.published ? '' : ` (${STR.states.draft})`}` : s; };
  const service = selectField({ name: 'service_slug', label: T.serviceF, placeholder: T.serviceNone, hint: T.serviceHint, options: SERVICE_SLUGS.map(s => ({ value: s, label: svcTitle(s) })) });
  const sort = numberField({ name: 'sort', label: T.sortF, hint: T.sortHint, min: -1000000, max: 1000000, nullable: false });
  const published = switchField({ name: 'published', label: T.publishedF, onText: STR.states.published, offText: STR.states.draft });
  const onHome = switchField({ name: 'show_on_home', label: T.homeF, onText: T.homeOn, offText: T.homeOff });

  // --- detail ---
  const tagline = bilingualField({ name: 'tagline', label: T.taglineF, flat: true, maxLength: 500 });
  const overview = bilingualField({ name: 'overview', label: T.overviewF, flat: true, type: 'textarea', rows: 6, maxLength: 20000 });
  const coverEn = imageField({ name: 'cover_en', label: T.coverEnF });
  const coverFa = imageField({ name: 'cover_fa', label: T.coverFaF });
  const industries = repeater({ name: 'industries', label: T.industriesF, addLabel: T.addIndustry, itemLabel: T.industryItem, empty: { en: '', fa: '' }, max: 30,
    item: () => [bilingualField({ name: '', keys: { fa: 'fa', en: 'en' }, label: T.industryItem, requiredFa: true, maxLength: 200 })] });

  // --- story ---
  const md = (name, label, hint) => bilingualField({ name, label, flat: true, type: 'markdown', rows: 8, maxLength: 20000, hint });
  const problem = md('problem', T.problemF);
  const solution = md('solution', T.solutionF);
  const outcome = md('outcome', T.outcomeF, T.outcomeHint);
  const tech = md('tech', T.techF, T.techHint);

  // --- lists ---
  const features = repeater({ name: 'features', label: T.featuresF, addLabel: T.addFeature, itemLabel: T.featureItem, empty: { title_en: '', title_fa: '', desc_en: '', desc_fa: '' }, max: 30,
    summary: row => row.title_fa || row.title_en,
    item: () => [bilingualField({ name: 'title', flat: true, label: T.featTitle, requiredFa: true, maxLength: 300 }), bilingualField({ name: 'desc', flat: true, label: T.featDesc, type: 'textarea', rows: 3, maxLength: 3000 })] });
  const pages = repeater({ name: 'pages', label: T.pagesF, addLabel: T.addPage, itemLabel: T.pageItem, empty: { name_en: '', name_fa: '', desc_en: '', desc_fa: '' }, max: 40,
    summary: row => row.name_fa || row.name_en,
    item: () => [bilingualField({ name: 'name', flat: true, label: T.pageName, requiredFa: true, maxLength: 300 }), bilingualField({ name: 'desc', flat: true, label: T.pageDesc, type: 'textarea', rows: 2, maxLength: 3000 })] });
  const gallery = repeater({ name: 'gallery', label: T.galleryF, hint: T.galleryHint, addLabel: T.addGallery, itemLabel: T.galleryItem, empty: { image: '', caption_en: '', caption_fa: '' }, max: 12,
    summary: row => row.caption_fa || row.caption_en || row.image,
    item: () => [imageField({ name: 'image', label: T.galleryImage, required: true }), bilingualField({ name: 'caption', flat: true, label: T.galleryCaption, maxLength: 300 })] });

  // --- seo ---
  const seoTitleFa = field({ name: 'seo_title_fa', label: STR.fields.faLabel, maxLength: 60, counter: true, lang: 'fa' });
  const seoTitleEn = field({ name: 'seo_title_en', label: STR.fields.enLabel, maxLength: 60, counter: true, dir: 'ltr', lang: 'en' });
  const seoDescFa = textareaField({ name: 'seo_desc_fa', label: STR.fields.faLabel, maxLength: 160, rows: 3, lang: 'fa' });
  const seoDescEn = textareaField({ name: 'seo_desc_en', label: STR.fields.enLabel, maxLength: 160, rows: 3, dir: 'ltr', lang: 'en' });

  const form = createForm({
    fields: [title, desc, slug, tagsF, image, category, service, sort, published, onHome, tagline, overview, coverEn, coverFa, industries,
      problem, solution, outcome, tech, features, pages, gallery, seoTitleFa, seoTitleEn, seoDescFa, seoDescEn],
    dirtyToken: `project-${id}`,
    render: () => tabs({
      remember: 'projects-editor',
      items: [
        { id: 'card', label: T.tabCard, icon: 'image', panel: h('div.a-form__section', title.el, desc.el, h('div.a-form__grid.a-form__grid--2', slug.el, tagsF.el), image.el,
          h('div.a-form__grid.a-form__grid--2', category.el, service.el), h('div.a-form__grid.a-form__grid--2', sort.el, h('div.a-stack.a-stack--sm', published.el, onHome.el))) },
        { id: 'detail', label: T.tabDetail, icon: 'file-text', badge: project.industries.length || null, panel: h('div.a-form__section', tagline.el, overview.el, h('div.a-form__grid.a-form__grid--2', coverEn.el, coverFa.el), industries.el) },
        { id: 'story', label: T.tabStory, icon: 'book-open', panel: h('div.a-form__section', h('p.pj-intro', T.storyIntro), problem.el, solution.el, outcome.el, tech.el) },
        { id: 'features', label: T.tabFeatures, icon: 'zap', badge: project.features.length || null, panel: h('div.a-form__section', features.el) },
        { id: 'pages', label: T.tabPages, icon: 'layout', badge: project.pages.length || null, panel: h('div.a-form__section', pages.el) },
        { id: 'gallery', label: T.tabGallery, icon: 'layers', badge: project.gallery.length || null, panel: h('div.a-form__section', gallery.el) },
        { id: 'seo', label: T.tabSeo, icon: 'search', panel: h('div.a-form__section', pairGroup(T.seoTitleF, T.seoTitleHint, seoTitleFa, seoTitleEn), pairGroup(T.seoDescF, T.seoDescHint, seoDescFa, seoDescEn)) },
      ],
    }),
    values: project,
    async onSubmit(values) {
      const body = { ...values, published: values.published ? 1 : 0, show_on_home: values.show_on_home ? 1 : 0, sort: Number(values.sort) || 0 };
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
