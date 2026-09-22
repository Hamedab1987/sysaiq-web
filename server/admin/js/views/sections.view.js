// «بخش‌های صفحهٔ اصلی» — owner-made sections injected into the home page.
// #/sections → list grouped by placement, reorder by drag / ↑↓ ·
// #/sections/:id → editor (#/sections/new creates).
//   GET /sections · POST /sections · PUT /sections/:id (partial) · DELETE /sections/:id
//   POST /sections/reorder {ids} · POST /sections/preview {…section, lang} → {html}
// `items` depends on the type: one repeater per item-bearing type lives in
// the form; the one matching the selected type is shown and sent.
import { h, icon, clear, pageHeader, card, badge, statusBadge, confirm, toast, drawer, createForm, submitButton, stickyActionBar, field, selectField, switchField, numberField, slugField, bilingualField, repeater, skeleton, errorState, emptyState, toFaDigits, formatJalali, extLink } from '../ui.js';
import { STR } from '../strings.js';
import { api } from '../api.js';

const CSS_HREF = '/admin/css/views/sections.css';
export const TYPES = ['richtext', 'cards', 'steps', 'stats', 'cta', 'pricing'];
export const ITEM_TYPES = ['cards', 'steps', 'stats', 'pricing'];
export const PLACEMENTS = ['after_about', 'after_work', 'after_faq'];
export const THEMES = ['light', 'dark'];
// the same shapes routes/admin/sections.routes.js validates (cta_href / eyebrow)
export const HREF_RE = /^(https:\/\/[^\s]+|\/[^\s]*|#[A-Za-z][\w-]*|mailto:[^\s]+|tel:[^\s]+)$/;
export const EYEBROW_RE = /^[\x20-\x7e–—·•]*$/;

const T = {
  title: 'بخش‌های صفحهٔ اصلی', subtitle: 'بخش‌هایی که به صفحهٔ اصلی اضافه می‌کنید (متن، کارت، مراحل، آمار، دعوت به اقدام، پلن). جای هر بخش را با «محل قرارگیری» و ترتیب را با کشیدن یا فلش‌ها تعیین کنید.',
  eyebrow: '[ SYSAIQ—ADMIN / SECTIONS ]',
  add: 'بخش جدید', edit: 'ویرایش بخش', create: 'بخش جدید',
  placement: { after_about: 'پس از «دربارهٔ ما»', after_work: 'پس از «نمونه‌کارها»', after_faq: 'پس از «سؤالات متداول»' },
  type: { richtext: 'متن', cards: 'کارت‌ها', steps: 'مراحل', stats: 'آمار', cta: 'دعوت به اقدام', pricing: 'پلن‌ها' },
  theme: { light: 'روشن', dark: 'تیره' },
  emptyGroup: 'در این محل بخشی نیست.',
  secBase: 'مشخصات', secText: 'متن', secItems: 'آیتم‌ها', secCta: 'دکمهٔ اقدام', secNav: 'منو و انتشار',
  typeF: 'نوع بخش', themeF: 'زمینه', placementF: 'محل قرارگیری', slugF: 'نامک (لنگر #)', eyebrowF: 'برچسب بالای عنوان (لاتین)', titleF: 'عنوان', bodyF: 'متن (Markdown)',
  ctaLabelF: 'متن دکمه', ctaHrefF: 'نشانی دکمه', navF: 'نمایش در منوی بالا', navLabelF: 'برچسب منو', publishedF: 'منتشرشده', sortF: 'ترتیب',
  slugHint: 'با حرف لاتین شروع شود؛ نشانی بخش /fa/#نامک می‌شود.', eyebrowHint: 'مثال: SYSAIQ—PROCESS / SYS.05 — فقط حروف لاتین، رقم و علامت (بدون فارسی).', eyebrowErr: 'فقط حروف لاتین، رقم و علامت؛ فارسی مجاز نیست.',
  hrefHint: 'مسیر سایت (/fa/contact)، https://…، #لنگر، mailto: یا tel:', hrefErr: 'نشانی باید مسیر سایت، https، #لنگر، mailto: یا tel: باشد.',
  itemCard: 'کارت', itemStep: 'مرحله', itemStat: 'آمار', itemPlan: 'پلن', addCard: 'افزودن کارت', addStep: 'افزودن مرحله', addStat: 'افزودن آمار', addPlan: 'افزودن پلن',
  itTitle: 'عنوان', itDesc: 'توضیح', itIcon: 'آیکن', itValue: 'مقدار (مثلاً ۲۴/۷)', itLabel: 'برچسب', plName: 'نام پلن', plPrice: 'قیمت (متن)', plDesc: 'توضیح', plFeatures: 'ویژگی‌ها', plFeature: 'ویژگی', addFeature: 'افزودن ویژگی', plFeatured: 'پلن پیشنهادی',
  noItems: 'این نوع بخش آیتم ندارد.',
  preview: 'پیش‌نمایش', previewLink: 'مشاهده در سایت', previewErr: 'پیش‌نمایش ساخته نشد.',
  notFound: 'این بخش پیدا نشد.', saved: 'بخش ذخیره شد', createdGo: 'بخش ساخته شد', reordered: 'ترتیب ذخیره شد',
  moveUp: 'انتقال به بالا', moveDown: 'انتقال به پایین', drag: 'برای جابه‌جایی بکشید',
  statsHint: 'فقط اعداد و ادعاهایی که واقعاً دارید؛ عدد ساختگی ننویسید.',
};

function ensureStylesheet(href) {
  if (document.head.querySelector(`link[data-view-css="${href}"]`)) return;
  document.head.appendChild(h('link', { rel: 'stylesheet', href, 'data-view-css': href }));
}
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
const parseList = v => { if (Array.isArray(v)) return v; try { const x = JSON.parse(v || '[]'); return Array.isArray(x) ? x : []; } catch { return []; } };
const opts = (keys, labels) => keys.map(k => ({ value: k, label: labels[k] || k }));

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

// ---------------------------------------------------------------- list ----
async function mountList(root, ctx) {
  ensureStylesheet(CSS_HREF);
  root.appendChild(pageHeader({ eyebrow: T.eyebrow, title: T.title, subtitle: T.subtitle, actions: [h('a.a-btn.a-btn--primary', { href: '#/sections/new' }, icon('plus'), T.add)] }));
  const holder = h('div.sc-groups', skeleton({ kind: 'table' }));
  root.appendChild(holder);
  let all = [];
  let busy = false;

  const render = () => {
    clear(holder);
    for (const pl of PLACEMENTS) {
      const rows = all.filter(s => s.placement === pl);
      const list = h('ul.sc-list', { 'aria-label': T.placement[pl] });
      rows.forEach((s, i) => {
        const li = h('li.sc-item', { draggable: 'true', dataset: { id: s.id } },
          h('span.sc-item__grip', { title: T.drag, 'aria-hidden': 'true' }, icon('grip-vertical', { size: 'sm' })),
          h('span.sc-item__idx.a-mono', toFaDigits(i + 1)),
          h('a.sc-item__main', { href: `#/sections/${s.id}` }, h('span.sc-item__title', s.title_fa || s.title_en || s.slug), h('span.sc-item__sub', h('span.a-mono', { dir: 'ltr' }, `#${s.slug}`), h('span.a-muted', s.title_en || ''))),
          h('span.sc-item__meta', badge(T.type[s.type] || s.type, { kind: 'info', icon: 'layers' }), badge(T.theme[s.theme] || s.theme, { icon: s.theme === 'dark' ? 'eye-off' : 'eye' }), statusBadge(s.published ? 'published' : 'draft'), s.show_in_nav ? badge(T.navF, { icon: 'menu' }) : null, h('span.a-small.a-muted', formatJalali(s.updated_at, { style: 'relative' }))),
          h('span.sc-item__tools',
            h('button.a-btn.a-btn--subtle.a-btn--icon.a-btn--sm', { type: 'button', 'aria-label': T.moveUp, disabled: i === 0, onclick: () => move(pl, s, -1) }, icon('arrow-up', { size: 'sm' })),
            h('button.a-btn.a-btn--subtle.a-btn--icon.a-btn--sm', { type: 'button', 'aria-label': T.moveDown, disabled: i === rows.length - 1, onclick: () => move(pl, s, 1) }, icon('arrow-down', { size: 'sm' })),
            h('a.a-btn.a-btn--subtle.a-btn--icon.a-btn--sm', { href: `#/sections/${s.id}`, 'aria-label': STR.actions.edit, title: STR.actions.edit }, icon('pencil', { size: 'sm' })),
            h('button.a-btn.a-btn--subtle.a-btn--icon.a-btn--sm.a-btn--danger', { type: 'button', 'aria-label': STR.actions.delete, title: STR.actions.delete, onclick: () => remove(s) }, icon('trash', { size: 'sm' }))));
        li.addEventListener('dragstart', e => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(s.id)); li.classList.add('is-dragging'); });
        li.addEventListener('dragend', () => li.classList.remove('is-dragging'));
        li.addEventListener('dragover', e => { e.preventDefault(); li.classList.add('is-over'); });
        li.addEventListener('dragleave', () => li.classList.remove('is-over'));
        li.addEventListener('drop', e => { e.preventDefault(); li.classList.remove('is-over'); const src = rows.find(x => String(x.id) === e.dataTransfer.getData('text/plain')); if (!src || src === s) return; reorder(pl, rows.filter(x => x !== src).flatMap(x => (x === s ? [src, s] : [x]))); });
        list.appendChild(li);
      });
      holder.appendChild(card({ title: T.placement[pl], hint: STR.states.items(rows.length), body: rows.length ? list : h('div.a-rep__empty', T.emptyGroup) }));
    }
    if (!all.length) holder.replaceChildren(emptyState({ icon: 'layout', title: STR.states.empty, hint: STR.states.emptyHint, action: { label: T.add, icon: 'plus', onClick: () => ctx.router.navigate('/sections/new') } }));
  };
  const move = (pl, s, dir) => {
    const rows = all.filter(x => x.placement === pl);
    const i = rows.indexOf(s), j = i + dir;
    if (j < 0 || j >= rows.length) return;
    rows.splice(i, 1); rows.splice(j, 0, s);
    reorder(pl, rows);
  };
  async function reorder(pl, ordered) {
    if (busy) return;
    busy = true;
    const prev = all;
    all = [...all.filter(x => x.placement !== pl), ...ordered.map((x, i) => ({ ...x, sort: (i + 1) * 10 }))];
    render();
    try { await api.post('/sections/reorder', { ids: ordered.map(x => x.id) }); toast(T.reordered, { timeout: 1200 }); }
    catch (e) { all = prev; render(); toast.error(e.message); }
    finally { busy = false; }
  }
  async function remove(s) {
    if (!(await confirm({ message: STR.confirm.deleteMessage(s.title_fa || s.slug), confirmLabel: STR.confirm.deleteConfirm, danger: true }))) return;
    try { await api.del(`/sections/${s.id}`); toast(STR.states.deleted); all = all.filter(x => x.id !== s.id); render(); } catch (e) { toast.error(e.message); }
  }
  const load = async () => { try { all = await api.get('/sections'); if (root.isConnected) render(); } catch (e) { holder.replaceChildren(errorState({ error: e, retry: load })); } };
  await load();
}

// -------------------------------------------------------------- editor ----
async function mountEditor(root, ctx, id) {
  ensureStylesheet(CSS_HREF);
  const isNew = id === 'new';
  const holder = h('div', skeleton({ kind: 'form' }));
  root.appendChild(pageHeader({ crumbs: [{ label: T.title, href: '#/sections' }, { label: isNew ? T.create : T.edit }], title: isNew ? T.create : T.edit }));
  root.appendChild(holder);
  let all = [];
  let sec = { slug: '', type: 'richtext', theme: 'light', placement: 'after_about', eyebrow: '', title_en: '', title_fa: '', body_en: '', body_fa: '', cta_label_en: '', cta_label_fa: '', cta_href: '', show_in_nav: 0, nav_label_en: '', nav_label_fa: '', sort: 0, published: 0, items: [] };
  try { all = await api.get('/sections'); } catch (e) { holder.replaceChildren(errorState({ error: e, retry: () => ctx.router.reload() })); return; }
  if (!isNew) {
    const found = all.find(x => String(x.id) === String(id));
    if (!found) { holder.replaceChildren(errorState({ title: T.notFound, retry: () => ctx.router.navigate('/sections') })); return; }
    sec = { ...found, items: parseList(found.items) };
  }
  if (!root.isConnected) return;
  root.querySelector('h1').textContent = isNew ? T.create : (sec.title_fa || sec.slug || T.edit);

  const type = selectField({ name: 'type', label: T.typeF, options: opts(TYPES, T.type) });
  const theme = selectField({ name: 'theme', label: T.themeF, options: opts(THEMES, T.theme) });
  const placement = selectField({ name: 'placement', label: T.placementF, options: opts(PLACEMENTS, T.placement) });
  const slug = slugField({ name: 'slug', label: T.slugF, prefix: '/fa/#', required: true, hint: T.slugHint, rules: [v => (!v || /^[a-z]/.test(v) ? null : T.slugHint)], unique: s => !all.some(x => x.slug === s && String(x.id) !== String(id)) });
  const title = bilingualField({ name: 'title', label: T.titleF, flat: true, maxLength: 200 });
  slug.followField(title.en);
  const eyebrow = field({ name: 'eyebrow', label: T.eyebrowF, maxLength: 80, dir: 'ltr', lang: 'en', mono: true, placeholder: 'SYSAIQ—NAME / SYS.05', hint: T.eyebrowHint, rules: [v => (EYEBROW_RE.test(String(v || '')) ? null : T.eyebrowErr)] });
  const body = bilingualField({ name: 'body', label: T.bodyF, flat: true, type: 'markdown', rows: 10 });
  const ctaLabel = bilingualField({ name: 'cta_label', label: T.ctaLabelF, flat: true, maxLength: 120 });
  const ctaHref = field({ name: 'cta_href', label: T.ctaHrefF, maxLength: 2048, dir: 'ltr', lang: 'en', mono: true, placeholder: '/fa/contact', hint: T.hrefHint, rules: [v => (!v || HREF_RE.test(String(v)) ? null : T.hrefErr)] });
  const showNav = switchField({ name: 'show_in_nav', label: T.navF });
  const navLabel = bilingualField({ name: 'nav_label', label: T.navLabelF, flat: true, maxLength: 60 });
  const sort = numberField({ name: 'sort', label: T.sortF, min: -1000000, max: 1000000, nullable: false });
  const published = switchField({ name: 'published', label: T.publishedF, onText: STR.states.published, offText: STR.states.draft });

  const iconRule = v => (/^[a-z0-9-]*$/.test(String(v || '')) ? null : STR.fields.slug);
  const reps = {
    cards: repeater({ name: 'items_cards', label: T.type.cards, addLabel: T.addCard, itemLabel: T.itemCard, empty: { title_en: '', title_fa: '', desc_en: '', desc_fa: '', icon: '' }, max: 24,
      item: () => [bilingualField({ name: 'title', flat: true, label: T.itTitle, maxLength: 200 }), bilingualField({ name: 'desc', flat: true, label: T.itDesc, type: 'textarea', rows: 2, maxLength: 1000 }), field({ name: 'icon', label: T.itIcon, maxLength: 40, dir: 'ltr', mono: true, rules: [iconRule] })] }),
    steps: repeater({ name: 'items_steps', label: T.type.steps, addLabel: T.addStep, itemLabel: T.itemStep, empty: { title_en: '', title_fa: '', desc_en: '', desc_fa: '' }, max: 24,
      item: () => [bilingualField({ name: 'title', flat: true, label: T.itTitle, maxLength: 200 }), bilingualField({ name: 'desc', flat: true, label: T.itDesc, type: 'textarea', rows: 2, maxLength: 1000 })] }),
    stats: repeater({ name: 'items_stats', label: T.type.stats, hint: T.statsHint, addLabel: T.addStat, itemLabel: T.itemStat, empty: { value: '', label_en: '', label_fa: '' }, max: 24,
      item: () => [field({ name: 'value', label: T.itValue, maxLength: 40 }), bilingualField({ name: 'label', flat: true, label: T.itLabel, maxLength: 120 })] }),
    pricing: repeater({ name: 'items_pricing', label: T.type.pricing, addLabel: T.addPlan, itemLabel: T.itemPlan, empty: { name_en: '', name_fa: '', price_en: '', price_fa: '', desc_en: '', desc_fa: '', features: [], featured: false }, max: 24,
      item: () => [bilingualField({ name: 'name', flat: true, label: T.plName, maxLength: 120 }), bilingualField({ name: 'price', flat: true, label: T.plPrice, maxLength: 120 }), bilingualField({ name: 'desc', flat: true, label: T.plDesc, type: 'textarea', rows: 2, maxLength: 600 }),
        repeater({ name: 'features', label: T.plFeatures, addLabel: T.addFeature, itemLabel: T.plFeature, empty: { en: '', fa: '' }, max: 12, item: () => [bilingualField({ name: '', keys: { fa: 'fa', en: 'en' }, label: T.plFeature, maxLength: 200 })] }),
        switchField({ name: 'featured', label: T.plFeatured })] }),
  };
  const noItems = h('div.a-hint', T.noItems);
  const itemsBox = h('div.a-stack', ...Object.values(reps).map(r => r.el), noItems);
  const showItems = () => { const t = type.value; for (const [k, r] of Object.entries(reps)) r.el.hidden = k !== t; noItems.hidden = ITEM_TYPES.includes(t); };
  type.onChange(showItems);
  const navBox = navLabel.el;
  showNav.onChange(v => { navBox.hidden = !v; });

  const values = { ...sec, items_cards: [], items_steps: [], items_stats: [], items_pricing: [] };
  if (ITEM_TYPES.includes(sec.type)) values[`items_${sec.type}`] = sec.items;
  const form = createForm({
    fields: [type, theme, placement, slug, title, eyebrow, body, ctaLabel, ctaHref, showNav, navLabel, sort, published, ...Object.values(reps)],
    dirtyToken: `section-${id}`,
    render: () => h('div.a-stack',
      h('section.a-form__section', h('h3', T.secBase), h('div.a-form__grid.a-form__grid--3', type.el, theme.el, placement.el), h('div.a-form__grid.a-form__grid--2', slug.el, eyebrow.el)),
      h('section.a-form__section', h('h3', T.secText), title.el, body.el),
      h('section.a-form__section', h('h3', T.secItems), itemsBox),
      h('section.a-form__section', h('h3', T.secCta), ctaLabel.el, ctaHref.el),
      h('section.a-form__section', h('h3', T.secNav), h('div.a-form__grid.a-form__grid--3', showNav.el, published.el, sort.el), navBox)),
    values,
    async onSubmit(v) {
      try {
        const b = bodyFor(v);
        if (isNew) {
          const r = await api.post('/sections', b);
          toast(T.createdGo);
          form.markClean();
          ctx.router.navigate(`/sections/${r.id}`, { replace: true });
          return true;
        }
        await api.put(`/sections/${id}`, b);
        sec = { ...sec, ...b };
        paintLinks();
        toast(T.saved, b.published ? { action: { label: `${T.previewLink} ↗`, onClick: () => window.open(`/fa/#${sec.slug}`, '_blank', 'noopener') } } : undefined);
        return true;
      } catch (e) {
        if ((e?.status === 422 || e?.status === 409) && e.fields) { applyServerErrors(form, mapItemKeys(e.fields, v.type), e.message); return false; }
        throw e;
      }
    },
    onDirty: d => bar?.setDirty(d),
  });
  showItems();
  navBox.hidden = !showNav.value;
  const bodyFor = v => {
    const { items_cards, items_steps, items_stats, items_pricing, ...rest } = v;
    const items = ITEM_TYPES.includes(v.type) ? (v[`items_${v.type}`] || []).map(it => (v.type === 'pricing' ? { ...it, featured: !!it.featured } : it)) : [];
    return { ...rest, items, sort: Number(rest.sort) || 0, published: rest.published ? 1 : 0, show_in_nav: rest.show_in_nav ? 1 : 0 };
  };
  // the server names the column `items`; the form knows it as items_<type>
  const mapItemKeys = (fields, t) => Object.fromEntries(Object.entries(fields).map(([k, m]) => [k.replace(/^items(?=\[|$)/, `items_${t}`), m]));

  // --- preview drawer (server-rendered section) ---
  async function openPreview(lang) {
    const box = h('div.sc-preview', { lang, dir: lang === 'en' ? 'ltr' : 'rtl' }, skeleton({ kind: 'lines' }));
    const d = drawer({ title: `${T.preview} — ${lang === 'fa' ? STR.fields.faLabel : STR.fields.enLabel}`, wide: true, body: box, actions: [{ label: STR.actions.close, kind: 'ghost' }] });
    d.open();
    try {
      const r = await api.post('/sections/preview', { ...bodyFor(form.getValues()), lang });
      box.replaceChildren(...previewNodes(r.html));
    } catch (e) {
      if ((e?.status === 422) && e.fields) { d.close(); applyServerErrors(form, mapItemKeys(e.fields, type.value), e.message); toast.error(STR.errors.validation); }
      else box.replaceChildren(errorState({ title: T.previewErr, error: e }));
    }
  }

  const links = h('span.a-row');
  const paintLinks = () => { clear(links); if (!isNew && sec.published && sec.slug) links.append(extLink(`/fa/#${sec.slug}`, T.previewLink, { class: 'a-btn a-btn--subtle a-btn--sm' })); };
  const deleteBtn = isNew ? null : h('button.a-btn.a-btn--danger', { type: 'button', onclick: async () => {
    if (!(await confirm({ message: STR.confirm.deleteMessage(sec.title_fa || sec.slug), confirmLabel: STR.confirm.deleteConfirm, danger: true }))) return;
    try { await api.del(`/sections/${id}`); form.markClean(); toast(STR.states.deleted); ctx.router.navigate('/sections'); } catch (e) { toast.error(e.message); }
  } }, icon('trash'), STR.actions.delete);
  const bar = stickyActionBar({ actions: [links,
    h('button.a-btn.a-btn--subtle.a-btn--sm', { type: 'button', onclick: () => openPreview('fa') }, icon('eye', { size: 'sm' }), `${T.preview} فارسی`),
    h('button.a-btn.a-btn--subtle.a-btn--sm', { type: 'button', onclick: () => openPreview('en') }, icon('eye', { size: 'sm' }), `${T.preview} EN`),
    deleteBtn, h('a.a-btn.a-btn--ghost', { href: '#/sections' }, STR.actions.back), submitButton(form)] });
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
