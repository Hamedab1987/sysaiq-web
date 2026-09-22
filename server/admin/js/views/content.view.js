// «متن‌های سایت» — every home-page copy key grouped in page order, edited
// side by side (fa | en), published in ONE bulk PUT /content {items}. The
// owner's unsaved edits survive a reload through a localStorage draft; the
// server stays the only source of truth for what the site shows.
//   GET  /content                         → {groups:[{name, keys}], keys:[record…]}
//   PUT  /content {items:[{key, fa?, en?}]}  only changed keys; null = back to default
//   DELETE /content/:key?purge=1          remove an owner-created X_* key
//   POST /content/custom {key, label_fa, label_en, type}
import { h, icon, clear, pageHeader, badge, toast, confirm, modal, emptyState, errorState, skeleton, stickyActionBar, filterBar, matchesQuery, bilingualField, field, selectField, createForm, copyToClipboard, registerShortcut, debounce, toFaDigits, toEnDigits, formatJalali, setDirty } from '../ui.js';
import { STR } from '../strings.js';
import { api } from '../api.js';

const CSS_HREF = '/admin/css/views/content.css';
const DRAFT_KEY = 'sysaiq-admin:content-draft:v1';
const CUSTOM_KEY_RE = /^X_[A-Z0-9_]{2,40}$/;
const CUSTOM_GROUP = 'کلیدهای سفارشی';
const DIRTY_TOKEN = 'content';   // our slice of the topbar counter (the custom-key dialog form has its own)
const LANGS = ['fa', 'en'];

const T = {
  title: 'متن‌های سایت',
  subtitle: 'هر متنی که روی صفحهٔ اصلی دیده می‌شود، این‌جا به ترتیب صفحه آمده است. تغییرها با «ذخیره و انتشار» همان لحظه روی سایت می‌نشینند.',
  eyebrow: '[ SYSAIQ—ADMIN / CONTENT ]',
  search: 'جستجو در عنوان، کلید یا متن…',
  filterAll: 'همهٔ متن‌ها', filterEdited: 'ویرایش‌شده', filterEnEmpty: 'انگلیسی خالی', filterFaEmpty: 'فارسی خالی',
  edited: 'ویرایش‌شده', pending: 'در انتظار انتشار', inlineType: 'با قالب‌بندی', customType: 'سفارشی',
  inlineHint: 'Enter = خط بعد؛ برای برجسته‌کردن با گرادیان، عبارت را بین دو ستاره بگذارید: *مثال*',
  preview: 'پیش‌نمایش',
  copyKey: 'کپی کلید',
  viewSite: 'مشاهده در سایت', viewEn: 'نسخهٔ انگلیسی',
  reset: 'بازگردانی به پیش‌فرض', resetTitle: 'بازگردانی به پیش‌فرض', resetConfirm: 'بازگردانی',
  resetIntro: 'متن این کلید در هر دو زبان به مقدار پیش‌فرض قالب برمی‌گردد و با «ذخیره و انتشار» روی سایت اعمال می‌شود.',
  resetDone: 'به پیش‌فرض برگشت — برای اعمال روی سایت، «ذخیره و انتشار» را بزنید.',
  emptyDefault: '(خالی)',
  publish: n => (n ? `${STR.actions.saveAndPublish} (${n === 1 ? 'یک تغییر' : `${toFaDigits(n)} تغییر`})` : STR.actions.saveAndPublish),
  discard: 'لغو تغییرات', discardTitle: 'لغو تغییرات؟', discardMessage: n => `${n === 1 ? 'یک تغییر ذخیره‌نشده' : `${toFaDigits(n)} تغییر ذخیره‌نشده`} دور انداخته می‌شود و متن‌ها به آخرین نسخهٔ منتشرشده برمی‌گردند.`,
  discardConfirm: 'بله، لغو شود',
  nothingToPublish: 'تغییری برای انتشار نیست.',
  published: 'منتشر شد',
  publishedHint: n => (n === 1 ? 'یک متن روی سایت به‌روز شد.' : `${toFaDigits(n)} متن روی سایت به‌روز شد.`),
  status: n => (n ? (n === 1 ? 'یک تغییر منتشرنشده' : `${toFaDigits(n)} تغییر منتشرنشده`) : 'همهٔ متن‌ها منتشر شده‌اند'),
  lastChange: 'آخرین تغییر', by: 'توسط',
  draftTitle: 'پیش‌نویس ذخیره‌نشده دارید',
  draftBody: (n, when) => `${n === 1 ? 'یک متن' : `${toFaDigits(n)} متن`} از ${when} در این مرورگر ویرایش شده ولی منتشر نشده است.`,
  draftRestore: 'بازیابی پیش‌نویس', draftDiscard: 'دور انداختن',
  draftRestored: 'پیش‌نویس بازیابی شد — برای اعمال روی سایت، «ذخیره و انتشار» را بزنید.',
  // the router's leave dialog: edits here are NOT lost — cleanup flushes them to the localStorage draft
  leaveTitle: 'تغییرات هنوز منتشر نشده‌اند',
  leaveMessage: n => `${n === 1 ? 'یک تغییر منتشرنشده' : `${toFaDigits(n)} تغییر منتشرنشده`} به‌صورت پیش‌نویس در همین مرورگر می‌ماند و با بازگشت به این صفحه می‌توانید آن را بازیابی کنید. برای اعمال روی سایت باید «ذخیره و انتشار» را بزنید.`,
  noMatch: 'متنی با این جستجو پیدا نشد', noMatchHint: 'عبارت جستجو را کوتاه‌تر کنید یا فیلتر را روی «همهٔ متن‌ها» بگذارید.',
  clearSearch: 'پاک‌کردن جستجو',
  groups: 'بخش‌های صفحه',
  addCustom: 'افزودن متن سفارشی', addCustomTitle: 'متن سفارشی جدید',
  addCustomHint: 'کلیدهای سفارشی برای بخش‌ها و صفحاتی به کار می‌روند که بعداً به قالب اضافه می‌شوند؛ تا آن زمان جای مشخصی روی صفحهٔ اصلی ندارند.',
  keyF: 'کلید', keyHint: 'با X_ شروع می‌شود؛ فقط حروف بزرگ لاتین، ارقام و زیرخط. مثال: X_PROMO',
  keyInvalid: 'کلید باید با X_ شروع شود و ۲ تا ۴۰ نویسهٔ لاتین بزرگ، رقم یا زیرخط پس از آن داشته باشد.',
  keyTaken: 'این کلید قبلاً ساخته شده است.',
  labelFaF: 'برچسب فارسی', labelEnF: 'برچسب انگلیسی', typeF: 'نوع متن',
  typePlain: 'متن ساده', typeInline: 'متن با قالب‌بندی (خط بعد و برجسته‌سازی)',
  created: 'متن سفارشی ساخته شد — مقدارش را بنویسید و منتشر کنید.',
  removeCustom: 'حذف کلید سفارشی', removeCustomMessage: k => `کلید «${k}» با همهٔ مقادیر و تاریخچه‌اش حذف می‌شود. این کار قابل بازگشت نیست.`,
  removed: 'کلید حذف شد',
  fieldError: 'این مقدار پذیرفته نشد',
  loadError: 'فهرست متن‌ها بارگذاری نشد.',
  chars: 'نویسه',
};

// ---- helpers ------------------------------------------------------------
let pendingCount = 0; // read by isDirty() below (router's leave guard)

function ensureStylesheet(href) {
  if (document.head.querySelector(`link[data-view-css="${href}"]`)) return;
  document.head.appendChild(h('link', { rel: 'stylesheet', href, 'data-view-css': href }));
}
const effective = (rec, lang) => (rec.value && rec.value[lang] !== null && rec.value[lang] !== undefined ? String(rec.value[lang]) : String(rec.default?.[lang] ?? ''));
const isEditedLang = (rec, lang) => !!rec.value && rec.value[lang] !== null && rec.value[lang] !== undefined && String(rec.value[lang]) !== String(rec.default?.[lang] ?? '');
const isEdited = rec => LANGS.some(l => isEditedLang(rec, l));
const rowsFor = max => (max <= 60 ? 1 : max <= 160 ? 2 : max <= 400 ? 3 : 5);

// The bulk body: only keys whose current value differs from what the site
// shows, only the languages that changed, null when the owner typed the
// default back (so the override row disappears instead of freezing the default).
export function diffItems(list) {
  const items = [];
  for (const { rec, value } of list) {
    const item = { key: rec.key };
    let changed = false;
    for (const l of LANGS) {
      const cur = String(value?.[l] ?? '');
      if (cur === effective(rec, l)) continue;
      item[l] = cur === String(rec.default?.[l] ?? '') ? null : cur;
      changed = true;
    }
    if (changed) items.push(item);
  }
  return items;
}
const readDraft = () => { try { const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); return d && typeof d === 'object' && d.items && typeof d.items === 'object' ? d : null; } catch { return null; } };
const writeDraft = items => { try { if (Object.keys(items).length) localStorage.setItem(DRAFT_KEY, JSON.stringify({ at: new Date().toISOString(), items })); else localStorage.removeItem(DRAFT_KEY); } catch { /* private mode */ } };
const clearDraft = () => { try { localStorage.removeItem(DRAFT_KEY); } catch { /* fine */ } };

// inline mini-markup preview built from nodes (never markup): \n → <br>, **x** → strong, *x* → em (gradient)
function inlinePreview(text) {
  const out = h('span');
  const lines = String(text ?? '').split('\n');
  lines.forEach((line, i) => {
    if (i) out.appendChild(h('br'));
    const re = /\*\*([^*]+)\*\*|\*([^*]+)\*/g;
    let last = 0, m;
    while ((m = re.exec(line))) {
      if (m.index > last) out.appendChild(document.createTextNode(line.slice(last, m.index)));
      out.appendChild(m[1] !== undefined ? h('strong', m[1]) : h('em', m[2]));
      last = m.index + m[0].length;
    }
    if (last < line.length) out.appendChild(document.createTextNode(line.slice(last)));
  });
  return out;
}

// ---- view ---------------------------------------------------------------
async function mount(root, ctx) {
  ensureStylesheet(CSS_HREF);
  pendingCount = 0;
  const records = new Map();   // key → server record (kept fresh after every publish)
  const cards = new Map();     // key → { el, field, rec, pendingBadge, editedBadge, preview, foot, resetBtn }
  const groupEls = new Map();  // group name → { section, list, railBtn, railCount }
  const disposers = [];
  let filterValues = { q: '', f: '' };

  const addBtn = h('button.a-btn.a-btn--primary', { type: 'button', onclick: () => openCustomDialog() }, icon('plus'), T.addCustom);
  root.appendChild(pageHeader({ eyebrow: T.eyebrow, title: T.title, subtitle: T.subtitle, actions: [addBtn] }));
  const holder = h('div.cv-holder', skeleton({ kind: 'page' }));
  root.appendChild(holder);

  let data;
  try { data = await api.get('/content'); } catch (e) {
    holder.replaceChildren(errorState({ title: T.loadError, error: e, retry: () => ctx.router.reload() }));
    return;
  }
  if (!root.isConnected) return;
  for (const rec of data.keys || []) records.set(rec.key, rec);

  // ---- toolbar ----
  const draftBanner = h('div.cv-draft', { role: 'status', hidden: true });
  const filters = filterBar({
    search: { placeholder: T.search },
    filters: [{ name: 'f', label: T.filterAll, options: [{ value: 'edited', label: T.filterEdited }, { value: 'en', label: T.filterEnEmpty }, { value: 'fa', label: T.filterFaEmpty }] }],
    onChange: v => { filterValues = v; applyFilter(); },
  });

  // ---- rail + groups ----
  const rail = h('nav.cv-rail', { 'aria-label': T.groups });
  const railList = h('ul.cv-rail__list');
  rail.append(h('div.cv-rail__title', T.groups), railList);
  const main = h('div.cv-main');
  const empty = emptyState({ icon: 'search', title: T.noMatch, hint: T.noMatchHint, action: { label: T.clearSearch, icon: 'x', onClick: () => filters.reset() } });
  empty.hidden = true;
  const layout = h('div.cv-layout', rail, h('div.cv-mainwrap', main, empty));

  function ensureGroup(name) {
    if (groupEls.has(name)) return groupEls.get(name);
    const id = `cv-g-${groupEls.size}`;
    const railCount = h('span.cv-rail__count', { hidden: true });
    const railBtn = h('button.cv-rail__item', { type: 'button', onclick: () => { section.scrollIntoView({ block: 'start', behavior: 'smooth' }); section.querySelector('textarea')?.focus({ preventScroll: true }); } }, h('span.cv-rail__label', name), railCount);
    railList.appendChild(h('li', railBtn));
    const list = h('div.cv-cards');
    const section = h('section.cv-group', { id, dataset: { group: name } }, h('h2.cv-group__title', name), list);
    main.appendChild(section);
    const g = { name, section, list, railBtn, railCount };
    groupEls.set(name, g);
    return g;
  }

  // ---- cards ----
  function buildCard(rec) {
    const isInline = rec.type === 'inline';
    const fld = bilingualField({ name: rec.key, type: 'textarea', rows: rowsFor(rec.max), maxLength: rec.max });
    fld.value = { fa: effective(rec, 'fa'), en: effective(rec, 'en') };
    for (const l of LANGS) fld[l].control.setAttribute('aria-label', `${rec.label_fa} — ${l === 'fa' ? STR.fields.faLabel : STR.fields.enLabel}`);

    const editedBadge = badge(T.edited, { kind: 'violet', icon: 'pencil' });
    const pendingBadge = badge(T.pending, { kind: 'warn', icon: 'clock' });
    const keyChip = h('button.cv-key', { type: 'button', title: T.copyKey, 'aria-label': `${T.copyKey} ${rec.key}`, dir: 'ltr', onclick: () => copyToClipboard(rec.key) }, h('span', rec.key), icon('copy', { size: 'sm' }));
    const anchor = rec.anchor || '';
    const viewFa = h('a.a-btn.a-btn--subtle.a-btn--sm', { href: `/fa/${anchor}`, target: '_blank', rel: 'noopener noreferrer' }, icon('external-link', { size: 'sm' }), T.viewSite);
    const viewEn = h('a.a-btn.a-btn--subtle.a-btn--sm', { href: `/en/${anchor}`, target: '_blank', rel: 'noopener noreferrer', title: T.viewEn, 'aria-label': T.viewEn }, h('span.a-ltr', 'EN'));
    const resetBtn = h('button.a-btn.a-btn--subtle.a-btn--sm', { type: 'button', onclick: () => resetKey(rec.key) }, icon('rotate-ccw', { size: 'sm' }), T.reset);
    const removeBtn = rec.is_custom ? h('button.a-btn.a-btn--subtle.a-btn--sm.cv-remove', { type: 'button', onclick: () => removeCustom(rec.key) }, icon('trash', { size: 'sm' }), T.removeCustom) : null;
    const preview = isInline ? h('div.cv-preview', h('span.cv-preview__lbl', T.preview), h('div.cv-preview__fa', { lang: 'fa' }), h('div.cv-preview__en', { lang: 'en', dir: 'ltr' })) : null;
    const foot = h('div.cv-card__foot');

    const el = h('article.cv-card', { dataset: { key: rec.key }, 'aria-labelledby': `cv-l-${rec.key}` },
      h('header.cv-card__head',
        h('div.cv-card__titles',
          h('div.cv-card__row', h('h3.cv-card__label', { id: `cv-l-${rec.key}` }, rec.label_fa), editedBadge, pendingBadge, isInline ? badge(T.inlineType, { kind: 'info', icon: 'italic' }) : null, rec.is_custom ? badge(T.customType, { icon: 'tag' }) : null),
          h('div.cv-card__sub', h('span.a-ltr.a-small.a-muted', { lang: 'en' }, rec.label_en !== rec.key ? rec.label_en : ''), keyChip)),
        h('div.cv-card__actions', viewFa, viewEn, resetBtn, removeBtn)),
      fld.el,
      isInline ? h('div.a-hint.cv-inline-hint', T.inlineHint) : null,
      preview, foot);

    const refreshPreview = () => { if (!preview) return; const v = fld.value; preview.children[1].replaceChildren(inlinePreview(v.fa)); preview.children[2].replaceChildren(inlinePreview(v.en)); };
    const c = { el, field: fld, rec, editedBadge, pendingBadge, preview, foot, resetBtn, refreshPreview };
    cards.set(rec.key, c);
    fld.onChange(() => { refreshPreview(); autosize(fld); paintCard(c); onFieldChange(); });
    refreshPreview();
    autosize(fld);
    paintCard(c);
    return c;
  }
  // set both languages from code (restore / discard / reset) and repaint everything that depends on them
  function setValue(c, fa, en) {
    c.field.value = { fa, en };
    c.field.clearError();
    c.refreshPreview();
    autosize(c.field);
    paintCard(c);
  }
  // grow with explicit newlines only (the textarea stays resizable for soft wraps)
  function autosize(fld) {
    for (const l of LANGS) {
      const ta = fld[l].control;
      if (!ta.dataset.baseRows) ta.dataset.baseRows = String(ta.rows || 1);
      const lines = String(ta.value || '').split('\n').length;
      ta.rows = Math.min(12, Math.max(Number(ta.dataset.baseRows), lines));
    }
  }
  // edited / pending markers + reset availability + footer
  function paintCard(c) {
    const { rec, field: fld } = c;
    const edited = isEdited(rec);
    const pending = isPending(c);
    c.editedBadge.hidden = !edited;
    c.pendingBadge.hidden = !pending;
    c.el.classList.toggle('is-edited', edited);
    c.el.classList.toggle('is-pending', pending);
    const v = fld.value;
    const atDefault = LANGS.every(l => v[l] === String(rec.default?.[l] ?? ''));
    c.resetBtn.hidden = atDefault;
    clear(c.foot);
    if (rec.updated_at && rec.value) c.foot.append(icon('clock', { size: 'sm' }), `${T.lastChange}: ${formatJalali(rec.updated_at, { style: 'relative' })}${rec.updated_by ? ` ${T.by} ${rec.updated_by}` : ''}`);
  }
  const isPending = c => LANGS.some(l => c.field.value[l] !== effective(c.rec, l));
  const pendingKeys = () => [...cards.values()].filter(isPending).map(c => c.rec.key);

  for (const g of data.groups || []) { const grp = ensureGroup(g.name); for (const k of g.keys) { const rec = records.get(k); if (rec) grp.list.appendChild(buildCard(rec).el); } }

  // ---- action bar ----
  const publishBtn = h('button.a-btn.a-btn--primary', { type: 'button', onclick: () => publish() }, icon('save'), h('span', T.publish(0)));
  const discardBtn = h('button.a-btn.a-btn--ghost', { type: 'button', onclick: () => discard() }, T.discard);
  const bar = stickyActionBar({ actions: [discardBtn, publishBtn], status: T.status(0) });

  holder.replaceChildren(draftBanner, filters.el, layout, bar);
  filters.setCount(cards.size);

  // ---- dirty bookkeeping (setDirty feeds the topbar counter; isDirty() feeds the leave guard) ----
  const saveDraft = debounce(() => {
    const items = {};
    for (const k of pendingKeys()) items[k] = { ...cards.get(k).field.value };
    writeDraft(items);
  }, 400);
  function updateDirty() {
    pendingCount = pendingKeys().length;
    publishBtn.lastChild.textContent = T.publish(pendingCount);
    bar.setDirty(pendingCount > 0, T.status(pendingCount));
    discardBtn.hidden = pendingCount === 0;
    setDirty(DIRTY_TOKEN, pendingCount);
    for (const g of groupEls.values()) {
      const n = [...g.list.querySelectorAll('.cv-card')].map(el => cards.get(el.dataset.key)).filter(c => c && (isEdited(c.rec) || isPending(c))).length;
      g.railCount.hidden = !n; g.railCount.textContent = toFaDigits(n);
    }
  }
  function onFieldChange() {
    updateDirty();
    saveDraft();
    if (filterValues.f) applyFilter();
  }
  updateDirty();

  // ---- filter ----
  function applyFilter() {
    let shown = 0;
    for (const c of cards.values()) {
      const v = c.field.value;
      const q = filterValues.q;
      let ok = matchesQuery(c.rec, q, ['label_fa', 'label_en', 'key', () => v.fa, () => v.en, r => r.default?.fa, r => r.default?.en]);
      if (ok && filterValues.f === 'edited') ok = isEdited(c.rec) || isPending(c);
      if (ok && filterValues.f === 'en') ok = !v.en.trim();
      if (ok && filterValues.f === 'fa') ok = !v.fa.trim();
      c.el.hidden = !ok;
      if (ok) shown++;
    }
    for (const g of groupEls.values()) { const any = [...g.list.children].some(el => !el.hidden); g.section.hidden = !any; g.railBtn.parentElement.hidden = !any; }
    empty.hidden = shown > 0;
    rail.hidden = shown === 0;
    filters.setCount(shown, cards.size);
  }

  // ---- rail: highlight the group in view ----
  let io = null;
  if ('IntersectionObserver' in window) {
    io = new IntersectionObserver(entries => {
      const vis = entries.filter(e => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (!vis) return;
      for (const g of groupEls.values()) { if (g.section === vis.target) g.railBtn.setAttribute('aria-current', 'true'); else g.railBtn.removeAttribute('aria-current'); }
    }, { rootMargin: '-72px 0px -60% 0px', threshold: 0 });
    for (const g of groupEls.values()) io.observe(g.section);
    disposers.push(() => io.disconnect());
  }

  // ---- draft banner ----
  (function offerDraft() {
    const d = readDraft();
    if (!d) return;
    const restorable = Object.entries(d.items).filter(([k, v]) => cards.has(k) && v && typeof v === 'object' && LANGS.some(l => typeof v[l] === 'string' && v[l] !== effective(records.get(k), l)));
    if (!restorable.length) { clearDraft(); return; }
    const when = d.at ? formatJalali(new Date(d.at), { style: 'relative' }) : '';
    draftBanner.replaceChildren(
      icon('alert-triangle'),
      h('div.cv-draft__text', h('strong', T.draftTitle), h('div', T.draftBody(restorable.length, when))),
      h('div.cv-draft__actions',
        h('button.a-btn.a-btn--sm.a-btn--primary', { type: 'button', onclick: () => {
          for (const [k, v] of restorable) {
            const c = cards.get(k);
            if (!c) continue;
            setValue(c, typeof v.fa === 'string' ? v.fa : c.field.value.fa, typeof v.en === 'string' ? v.en : c.field.value.en);
          }
          onFieldChange(); draftBanner.hidden = true; toast(T.draftRestored, { kind: 'info' });
        } }, icon('rotate-ccw', { size: 'sm' }), T.draftRestore),
        h('button.a-btn.a-btn--sm.a-btn--ghost', { type: 'button', onclick: () => { clearDraft(); draftBanner.hidden = true; } }, T.draftDiscard)));
    draftBanner.hidden = false;
  })();

  // ---- publish / discard / reset ----
  const buildItems = () => diffItems([...cards.values()].map(c => ({ rec: c.rec, value: c.field.value })));
  function clearErrors() { for (const c of cards.values()) c.field.clearError(); }
  function mapErrors(fields, items) {
    let first = null;
    for (const [path, msg] of Object.entries(fields)) {
      const m = /^items\[(\d+)\]\.(fa|en|key|value)$/.exec(path);
      const c = m && cards.get(items[Number(m[1])]?.key);
      if (!c) continue;
      if (m[2] === 'fa' || m[2] === 'en') c.field[m[2]].setError(msg || T.fieldError); else c.field.setError(msg || T.fieldError);
      if (!first) first = c;
    }
    if (first) { first.el.hidden = false; first.field.focus(); }
    toast.error(STR.errors.validation);
  }
  let busy = false;
  async function publish() {
    if (busy) return;
    const items = buildItems();
    if (!items.length) { toast.info(T.nothingToPublish); return; }
    busy = true;
    bar.setBusy(true);
    clearErrors();
    try {
      const r = await api.put('/content', { items });
      for (const rec of r.keys || []) { records.set(rec.key, rec); const c = cards.get(rec.key); if (c) { c.rec = rec; paintCard(c); } }
      for (const c of cards.values()) paintCard(c);
      clearDraft();
      saveDraft.cancel();
      updateDirty();
      if (filterValues.f) applyFilter();
      toast(T.published, { action: { label: `${T.viewSite} ↗`, onClick: () => window.open('/fa/', '_blank', 'noopener') } });
    } catch (e) {
      if (e?.status === 422 && e.fields) mapErrors(e.fields, items);
      else toast.error(e?.message || STR.states.error);
    } finally { busy = false; bar.setBusy(false); discardBtn.hidden = pendingCount === 0; }
  }
  async function discard() {
    const n = pendingKeys().length;
    if (!n) return;
    if (!(await confirm({ title: T.discardTitle, message: T.discardMessage(n), confirmLabel: T.discardConfirm, danger: true, icon: 'alert-triangle' }))) return;
    for (const c of cards.values()) if (isPending(c)) setValue(c, effective(c.rec, 'fa'), effective(c.rec, 'en'));
    clearDraft();
    saveDraft.cancel();
    updateDirty();
    if (filterValues.f) applyFilter();
  }
  // the confirm shows the default text of both languages before anything changes
  async function resetKey(key) {
    const c = cards.get(key);
    if (!c) return;
    const d = c.rec.default || {};
    const body = h('div.a-stack.a-stack--sm',
      h('p', T.resetIntro),
      h('div.cv-default', h('div.cv-default__lbl', STR.fields.faLabel), h('div.cv-default__val', { lang: 'fa' }, d.fa || h('span.a-muted', T.emptyDefault))),
      h('div.cv-default', h('div.cv-default__lbl', STR.fields.enLabel), h('div.cv-default__val', { lang: 'en', dir: 'ltr' }, d.en || h('span.a-muted', T.emptyDefault))));
    const ok = await new Promise(resolve => modal({
      title: `${T.resetTitle} — ${c.rec.label_fa}`, size: 'sm', body,
      actions: [{ label: STR.actions.cancel, kind: 'ghost', value: false }, { label: T.resetConfirm, kind: 'primary', icon: 'rotate-ccw', value: true, autofocus: true }],
      onClose: r => resolve(r === true),
    }).open());
    if (!ok) return;
    setValue(c, String(d.fa ?? ''), String(d.en ?? ''));
    onFieldChange();
    toast(T.resetDone, { kind: 'info' });
  }
  async function removeCustom(key) {
    const c = cards.get(key);
    if (!c) return;
    if (!(await confirm({ title: T.removeCustom, message: T.removeCustomMessage(key), confirmLabel: STR.confirm.deleteConfirm, danger: true }))) return;
    try {
      await api.del(`/content/${encodeURIComponent(key)}?purge=1`);
      c.field.dispose(); c.el.remove(); cards.delete(key); records.delete(key);
      const g = groupEls.get(CUSTOM_GROUP);
      if (g && !g.list.children.length) { g.section.remove(); g.railBtn.parentElement.remove(); groupEls.delete(CUSTOM_GROUP); }
      toast(T.removed);
      onFieldChange();
      applyFilter();
    } catch (e) { toast.error(e?.message || STR.states.error); }
  }

  // ---- custom key dialog ----
  function openCustomDialog() {
    const keyF = field({ name: 'key', label: T.keyF, required: true, mono: true, dir: 'ltr', lang: 'en', placeholder: 'X_PROMO', hint: T.keyHint, maxLength: 42, autocomplete: 'off', spellcheck: false, rules: [v => (CUSTOM_KEY_RE.test(String(v || '')) ? null : T.keyInvalid)] });
    keyF.control.addEventListener('input', () => { const pos = keyF.control.selectionStart; keyF.control.value = toEnDigits(keyF.control.value).toUpperCase().replace(/[^A-Z0-9_]/g, '_'); try { keyF.control.setSelectionRange(pos, pos); } catch { /* n/a */ } });
    // the X_ prefix is added on blur, so re-validate after it (the kit validated the bare value first)
    keyF.control.addEventListener('blur', () => { const v = keyF.control.value; if (v && !v.startsWith('X_')) { keyF.control.value = `X_${v.replace(/^X?_*/, '')}`; keyF.emit(); } if (keyF.control.value) keyF.validate(); });
    const labelFa = field({ name: 'label_fa', label: T.labelFaF, required: true, maxLength: 120 });
    const labelEn = field({ name: 'label_en', label: T.labelEnF, maxLength: 120, dir: 'ltr', lang: 'en' });
    const typeF = selectField({ name: 'type', label: T.typeF, options: [{ value: 'plain', label: T.typePlain }, { value: 'inline', label: T.typeInline }] });
    const form = createForm({
      fields: [keyF, labelFa, labelEn, typeF], values: { key: '', label_fa: '', label_en: '', type: 'plain' }, dirtyToken: 'content-custom', submitOnEnter: true,
      async onSubmit(v) {
        try {
          const rec = await api.post('/content/custom', { key: v.key, label_fa: v.label_fa, label_en: v.label_en, type: v.type });
          records.set(rec.key, rec);
          const grp = ensureGroup(CUSTOM_GROUP);
          const c = buildCard(rec);
          grp.list.appendChild(c.el);
          io?.observe(grp.section);
          form.markClean();
          dlg.close(true);
          toast(T.created);
          updateDirty(); applyFilter();
          requestAnimationFrame(() => { c.el.scrollIntoView({ block: 'center', behavior: 'smooth' }); c.field.fa.focus(); });
          return true;
        } catch (e) {
          if (e?.status === 409) { form.setErrors({ key: T.keyTaken }); return false; }
          throw e;
        }
      },
    });
    const dlg = modal({
      title: T.addCustomTitle, size: 'sm',
      body: h('div.a-stack', h('p.a-hint', T.addCustomHint), form.el),
      actions: [{ label: STR.actions.cancel, kind: 'ghost', value: false }, { label: STR.actions.create, kind: 'primary', icon: 'plus', close: false, onClick: async () => { await form.submit(); return false; } }],
      onClose: () => form.destroy(),
    });
    dlg.open();
    requestAnimationFrame(() => keyF.focus());
  }

  // ---- shortcuts + cleanup ----
  disposers.push(registerShortcut('mod+s', () => publish(), { inFields: true }));
  return () => {
    for (const d of disposers) d();
    saveDraft.flush();
    for (const c of cards.values()) c.field.dispose();
    pendingCount = 0;
    setDirty(DIRTY_TOKEN, 0);
  };
}

export default {
  title: T.title,
  mount,
  isDirty() { return pendingCount > 0; },
  // read by the router when isDirty(): the shared copy says the edits are lost, here they are kept
  leaveTitle: T.leaveTitle,
  leaveMessage: () => T.leaveMessage(pendingCount),
};
