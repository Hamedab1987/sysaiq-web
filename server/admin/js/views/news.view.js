// «اخبار» — #/news/:tab(/:id), tabs queue | published | sources | settings.
//   GET  /news/items?status=&category=&q=&page=   · GET/PUT /news/items/:id
//   POST /news/items/:id/(publish|reject|restore|summarize) · DELETE /news/items/:id
//   POST /news/items/bulk {ids, action} · POST /news/items/draft-from-url {url}
//   GET/POST /news/sources · PUT/DELETE /news/sources/:id · POST /news/sources/:id/test · POST /news/sources/test
//   GET/PUT /news/config · POST /news/run (200 summary | 202 still running) · GET /news/runs
// Nothing is published without the owner: the pipeline only writes drafts.
// A review card puts the source text next to the editable fa/en draft;
// «انتشار» saves unsaved edits first. Every form feeds the dirty guard
// (createForm dirtyToken → topbar counter + router leave prompt).
import { h, icon, clear, pageHeader, card, tabs, badge, dataTable, filterBar, confirm, toast, modal, drawer, createForm, makeField, field, selectField, switchField, numberField, tagsField, bilingualField, imageField, skeleton, errorState, emptyState, extLink, toFaDigits, formatJalali, parseServerDate, truncate } from '../ui.js';
import { STR } from '../strings.js';
import { api } from '../api.js';

const CSS_HREF = '/admin/css/views/news.css';
const TABS = ['queue', 'published', 'sources', 'settings'];
const CATS = ['models', 'tools', 'devices', 'tech', 'industry'];
const LIMITS = { title: 200, summary: 1200, why: 500, tag: 40, tags: 8, name: 120, url: 2048, model: 60 };
const TAG_RE = /^[a-z0-9.+ -]*$/i;
const MODEL_RE = /^[A-Za-z0-9._:-]*$/;
const RUN_POLL_MS = 4000;
const RUN_POLL_MAX = 60; // ≈ 4 minutes

const fa = toFaDigits;
const T = {
  title: 'اخبار', eyebrow: '[ SYSAIQ—ADMIN / NEWS ]',
  subtitle: 'خبرهای AI و فناوری خودکار جمع‌آوری و با AI خلاصه می‌شوند؛ هیچ خبری بدون تأیید شما منتشر نمی‌شود.',
  tabs: { queue: 'صف تأیید', published: 'منتشرشده', sources: 'منابع', settings: 'تنظیمات' },
  cats: { models: 'مدل‌ها', tools: 'ابزارها', devices: 'دستگاه‌ها', tech: 'فناوری', industry: 'صنعت' },
  fromUrl: 'خبر دستی از لینک', viewSite: 'صفحهٔ اخبار سایت',
  // review card
  f: {
    title: 'عنوان', summary: 'خلاصه', why: 'چرا مهم است؟', category: 'دسته', importance: 'اهمیت',
    tags: 'برچسب‌ها (لاتین)', tagsHint: 'کلیدواژه‌های کوتاه انگلیسی، مثل gpt یا robotics — حداکثر ۸ مورد.',
    tagsBad: 'فقط حروف لاتین، رقم، فاصله و . + -', stars: n => `اهمیت ${fa(n)} از ۵`, noStars: 'تعیین نشده',
    image: 'تصویر نمایشی (اختیاری)',
    imageHint: 'روی کارت خبر در صفحهٔ اصلی و بالای صفحهٔ خبر نمایش داده می‌شود؛ نسبت ۱۶:۹ پیشنهاد می‌شود. بدون تصویر، طرح اختصاصی SysaiQ نمایش داده می‌شود. فقط تصویری بگذارید که حق انتشارش را دارید.',
  },
  srcLabel: 'متن منبع', draftLabel: 'پیش‌نویس برای انتشار', readSource: 'خبر در منبع اصلی', more: 'نمایش کامل', less: 'نمایش کوتاه',
  noExcerpt: 'منبع متنی جز عنوان نداده است.', select: t => `انتخاب «${t}»`,
  status: { draft: 'در صف', published: 'منتشرشده', rejected: 'ردشده', skipped: 'کنارگذاشته' },
  aiPending: 'در انتظار خلاصه‌سازی AI', warnNumbers: 'هشدار عدد',
  numbers: 'در متن AI عددی آمده که در متن منبع نیست؛ پیش از انتشار با منبع مقایسه کنید:',
  note: {
    no_key: 'کلید OpenAI تنظیم نیست؛ متن را خودتان بنویسید', below_min: 'کم‌اهمیت‌تر از حد تنظیم‌شده', stale: 'قدیمی‌تر از ۱۰ روز',
    manual: 'افزوده‌شده از لینک', bad_output: 'خروجی AI قابل استفاده نبود', refused: 'AI از خلاصه‌سازی خودداری کرد',
    dup: id => `تکراری — مشابه خبر #${fa(id)}`, api: c => `خطای OpenAI (${fa(c)})`, other: c => `خطای AI (${c})`,
  },
  act: {
    publish: 'انتشار', save: 'ذخیره', reject: 'رد', restore: 'بازگرداندن به صف', unpublish: 'لغو انتشار', del: 'حذف',
    ai: 'نوشتن دوباره با AI', view: 'مشاهده', undo: 'بازگرداندن',
  },
  published: 'خبر منتشر شد', rejected: 'خبر رد شد', restored: 'خبر به صف تأیید برگشت', unpublished: 'انتشار لغو شد؛ خبر به صف تأیید برگشت', deleted: 'خبر حذف شد', saved: 'تغییرات ذخیره شد',
  needBoth: 'برای انتشار، عنوان و خلاصه در هر دو زبان لازم است.', needField: 'برای انتشار لازم است',
  aiDone: 'پیش‌نویس تازه با AI نوشته شد', aiDirty: 'متن فعلی این خبر با خروجی تازهٔ AI جایگزین می‌شود. ادامه می‌دهید؟',
  rejectDirty: 'تغییرات ذخیره‌نشدهٔ این خبر از بین می‌رود. رد شود؟',
  unpubMsg: t => `«${t}» از سایت برداشته می‌شود و به صف تأیید برمی‌گردد.`,
  delMsg: t => `«${t}» برای همیشه حذف می‌شود و اگر دوباره در خوراک بیاید، به صف برمی‌گردد.`,
  editTitle: id => `بازبینی خبر #${fa(id)}`, notFound: 'این خبر پیدا نشد (شاید حذف شده باشد).',
  // queue
  q: {
    seg: { draft: 'در انتظار تأیید', skipped: 'کنارگذاشته', rejected: 'ردشده' },
    search: 'جستجو در عنوان یا منبع…', allCats: 'همهٔ دسته‌ها', refresh: 'تازه‌سازی',
    order: 'به ترتیب اهمیت، سپس تازگی', selectAll: 'انتخاب همه', selected: n => `${fa(n)} مورد انتخاب شده`,
    bulkPublish: 'انتشار گروهی', bulkReject: 'رد گروهی',
    bulkPublishQ: n => `${fa(n)} خبر منتشر شود؟`, bulkRejectQ: n => `${fa(n)} خبر رد شود؟`,
    bulkPublishMsg: 'خبرهایی که عنوان و خلاصهٔ هر دو زبان را ندارند منتشر نمی‌شوند و در صف می‌مانند.',
    bulkDone: (n, act) => `${fa(n)} خبر ${act === 'publish' ? 'منتشر' : 'رد'} شد`,
    bulkFail: n => `${fa(n)} خبر منتشر نشد: عنوان یا خلاصهٔ یکی از زبان‌ها خالی است.`,
    bulkSaveFirst: 'ابتدا تغییرات ذخیره‌نشدهٔ خبرهای انتخاب‌شده را ذخیره کنید.',
    discard: 'تغییرات ذخیره‌نشدهٔ خبرهای این صفحه از بین می‌رود.',
    emptyDraft: 'صف تأیید خالی است', emptyOther: 'موردی در این فهرست نیست', emptyFilter: 'موردی با این فیلتر پیدا نشد',
    prev: 'قبلی', next: 'بعدی',
  },
  info: {
    noKey: 'کلید OpenAI تنظیم نشده است؛ جمع‌آوری و خلاصه‌سازی خودکار اخبار انجام نمی‌شود.', setKey: 'تنظیم کلید در «دستیار هوشمند»',
    disabled: 'جمع‌آوری خودکار اخبار خاموش است.', toSettings: 'تنظیمات اخبار',
    running: 'یک بررسی در حال اجراست…',
    last: t => `آخرین بررسی: ${t}`, never: 'هنوز بررسی‌ای انجام نشده',
    next: (rel, at) => `بررسی خودکار بعدی: ${rel} (${at})`, nextSoon: 'بررسی خودکار بعدی: تا چند دقیقهٔ دیگر',
    emptyHint: next => `${next}. خبرهای تازه پس از خلاصه‌سازی اینجا منتظر تأیید شما می‌مانند؛ می‌توانید همین حالا هم بررسی کنید یا خبری را از لینک اضافه کنید.`,
    emptyNoKey: 'تا کلید OpenAI تنظیم نشود، خبری جمع‌آوری نمی‌شود. می‌توانید خبری را دستی از لینک اضافه کنید و متنش را خودتان بنویسید.',
    emptyOff: 'جمع‌آوری خودکار خاموش است؛ آن را در تنظیمات روشن کنید یا خبری را از لینک اضافه کنید.',
  },
  runNow: 'الان بررسی کن',
  run: {
    working: 'در حال بررسی منابع و خلاصه‌سازی… ممکن است یکی دو دقیقه طول بکشد.',
    stillRunning: 'بررسی هنوز ادامه دارد؛ نتیجه را بعداً در فهرست بررسی‌ها ببینید.',
    locked: 'یک بررسی دیگر در حال اجراست؛ کمی بعد دوباره امتحان کنید.',
    done: 'بررسی تمام شد', ok: 'منابع سالم', failed: 'منابع ناموفق', fresh: 'مطلب تازه', drafted: 'پیش‌نویس آماده', skipped: 'کنارگذاشته',
    err: { no_key: 'کلید OpenAI تنظیم نیست؛ چیزی جمع‌آوری نشد.', daily_cap: 'سقف روزانهٔ خلاصه‌سازی پر شده؛ بقیهٔ خبرها فردا خلاصه می‌شوند.', stale_lock: 'بررسی قبلی نیمه‌کاره ماند و بسته شد.', disabled: 'جمع‌آوری خاموش بود.' },
    runs: 'بررسی‌های اخیر', colWhen: 'زمان', colTrigger: 'نوع', colSources: 'منابع (سالم/ناموفق)', colNew: 'تازه', colDrafted: 'پیش‌نویس', colSkipped: 'کنارگذاشته', colState: 'وضعیت',
    trigger: { schedule: 'خودکار', manual: 'دستی' }, running: 'در حال اجرا', fine: 'سالم', none: 'هنوز بررسی‌ای ثبت نشده',
  },
  // sources
  src: {
    add: 'افزودن منبع', edit: 'ویرایش منبع', test: 'آزمایش خوراک', empty: 'هنوز منبعی ثبت نشده', emptyHint: 'نشانی خوراک RSS یا Atom یک سایت خبری را اضافه کنید.',
    colName: 'منبع', colCat: 'دستهٔ پیش‌فرض', colEnabled: 'فعال', colStatus: 'آخرین بررسی', colItems: 'منتشرشده / کل',
    on: 'منبع فعال شد', off: 'منبع غیرفعال شد', enabledFor: 'فعال بودن',
    name: 'نام منبع', url: 'نشانی خوراک (RSS/Atom)', urlHint: 'فقط https. پیش از ذخیره با «آزمایش خوراک» مطمئن شوید نشانی کار می‌کند.',
    cat: 'دستهٔ پیش‌فرض خبرها', catHint: 'AI هنگام خلاصه‌سازی ممکن است دستهٔ دقیق‌تری انتخاب کند.', lang: 'زبان منبع', enabled: 'فعال باشد',
    created: 'منبع افزوده شد', saved: 'منبع ذخیره شد', removed: 'منبع حذف شد',
    delMsg: n => `منبع «${n}» حذف می‌شود. خبرهایی که پیش‌تر از آن جمع شده‌اند باقی می‌مانند.`,
    dup: 'این خوراک قبلاً افزوده شده است',
    never: 'هنوز بررسی نشده', ok: 'سالم', notModified: 'بدون تغییر', error: 'خطا',
    probeOk: 'خوراک سالم است', probeFail: 'خوراک خوانده نشد', feedTitle: 'عنوان خوراک', kind: 'نوع', count: 'تعداد مطالب', first: 'نخستین عنوان‌ها',
    redirected: u => `این نشانی به نشانی دیگری تغییر مسیر می‌دهد؛ بهتر است نشانی نهایی را ثبت کنید: ${u}`,
    testTitle: n => `آزمایش خوراک — ${n}`, testing: 'در حال خواندن خوراک…',
  },
  // settings
  set: {
    secRun: 'جمع‌آوری خودکار', enabled: 'جمع‌آوری خودکار اخبار روشن باشد', interval: 'فاصلهٔ بررسی', hours: 'ساعت',
    intervalHint: 'هر چند ساعت یک بار منابع بررسی شوند (۱ تا ۱۶۸).',
    secAi: 'خلاصه‌سازی با AI', minImp: 'حداقل اهمیت برای صف تأیید', minImpHint: 'خبرهای کم‌اهمیت‌تر در فهرست «کنارگذاشته» می‌مانند و منتشر نمی‌شوند.',
    minOpt: n => `${'★'.repeat(n)} — ${fa(n)} و بالاتر`,
    cap: 'سقف روزانهٔ خلاصه‌سازی', capHint: 'بیشترین تعداد خبری که هر روز به AI فرستاده می‌شود (هزینه را محدود می‌کند). ۰ یعنی خلاصه‌سازی خودکار انجام نشود.',
    model: 'مدل AI', modelHint: m => `خالی بگذارید تا همان مدل دستیار هوشمند (${m}) استفاده شود.`, modelBad: 'فقط حروف لاتین، رقم و . _ : -',
    usage: (n, cap) => `امروز ${fa(n)} خلاصه‌سازی AI از سقف ${fa(cap)} انجام شده است.`,
    saved: 'تنظیمات اخبار ذخیره شد',
    noKeyTitle: 'کلید OpenAI تنظیم نشده است', noKeyText: 'بدون کلید، منابع بررسی نمی‌شوند و هیچ پیش‌نویسی ساخته نمی‌شود. کلید را در بخش «دستیار هوشمند» وارد کنید.', goAi: 'رفتن به دستیار هوشمند',
    review: 'هر خبر پس از خلاصه‌سازی در «صف تأیید» می‌ماند؛ انتشار خودکار عمداً وجود ندارد.',
  },
  // manual draft
  url: {
    title: 'خبر دستی از لینک', label: 'نشانی خبر یا مقاله', submit: 'ساخت پیش‌نویس',
    hint: 'نشانی https صفحهٔ خبر را بدهید. متن صفحه خوانده و با AI به فارسی و انگلیسی خلاصه می‌شود؛ نتیجه به صف تأیید می‌رود و بدون تأیید شما منتشر نمی‌شود.',
    working: 'در حال خواندن صفحه و خلاصه‌سازی… (تا حدود نیم دقیقه)',
    done: 'پیش‌نویس ساخته شد و در صف تأیید است', doneNoAi: 'پیش‌نویس ساخته شد؛ خلاصه‌سازی AI انجام نشد و متن را باید خودتان بنویسید.',
    dup: 'این لینک قبلاً در فهرست اخبار هست.', show: 'نمایش آن خبر', fetchFail: why => `صفحه خوانده نشد: ${why}`,
  },
  err: {
    timeout: 'پاسخ نداد (مهلت تمام شد)', network: 'اتصال برقرار نشد', private_host: 'نشانی داخلی یا خصوصی مجاز نیست', https_required: 'فقط نشانی https پذیرفته می‌شود',
    bad_url: 'نشانی نامعتبر است', too_large: 'حجم پاسخ بیش از حد مجاز است', too_many_redirects: 'تغییر مسیر بیش از حد', bad_redirect: 'تغییر مسیر نامعتبر',
    empty_feed: 'خوراک خالی است', unsafe_xml: 'ساختار XML ناامن است', bad_xml: 'XML نامعتبر است', not_a_feed: 'این نشانی خوراک RSS/Atom نیست',
    no_content: 'عنوانی در صفحه پیدا نشد', no_key: 'کلید OpenAI تنظیم نشده است', not_draft: 'فقط خبرهای در صف را می‌توان دوباره با AI نوشت',
    conflict: 'نامک این خبر تکراری است', http: c => `پاسخ خطای ${fa(c)} از سرور مقصد`, other: c => `خطا (${c})`,
    http404: 'پیدا نشد (۴۰۴)', http403: 'دسترسی رد شد (۴۰۳)', http410: 'دیگر وجود ندارد (۴۱۰)', http429: 'درخواست‌ها محدود شده (۴۲۹)',
  },
};
const CAT_KIND = { models: 'violet', tools: 'ok', devices: 'info', tech: 'violet', industry: 'warn' };

// ---- small helpers ----------------------------------------------------------
function ensureStylesheet(href) {
  if (document.head.querySelector(`link[data-view-css="${href}"]`)) return;
  document.head.appendChild(h('link', { rel: 'stylesheet', href, 'data-view-css': href }));
}
export function errText(code) {
  const c = String(code || '');
  if (T.err[c] && typeof T.err[c] === 'string') return T.err[c];
  const m = /^http_(\d{3})$/.exec(c);
  if (m) return T.err[`http${m[1]}`] || T.err.http(m[1]);
  return c ? T.err.other(c) : T.err.other('?');
}
const titleOf = it => it.title_fa || it.title_en || it.title_src || `#${it.id}`;
const catBadge = c => badge(T.cats[c] || c, { kind: CAT_KIND[c] || null, icon: 'tag' });
const starsText = n => (n ? h('span.nv-stars-text', { 'aria-label': T.f.stars(n), title: T.f.stars(n) }, '★'.repeat(n), h('span.nv-stars-text__off', '★'.repeat(5 - n))) : h('span.a-muted', T.f.noStars));
const safeUrl = u => (/^https?:\/\/[^\s"'<>]+$/i.test(String(u || '')) ? String(u) : '');
const publicPath = (it, lang = 'fa') => (it.slug ? `/${lang}/news/${encodeURIComponent(it.slug)}` : '');
const openPublic = it => { const p = publicPath(it); if (p) window.open(p, '_blank', 'noopener'); };
const relTime = d => (d ? formatJalali(d, { style: 'relative' }) : '');
// Element.append() would print null as text: drop the empty slots first
const put = (el, ...kids) => { el.append(...kids.filter(k => k !== null && k !== undefined && k !== false)); return el; };

// ai_note → {kind, icon, text} (null = nothing to say)
export function aiNote(note) {
  const n = String(note || '');
  if (!n) return null;
  if (n.startsWith('numbers_not_in_source')) return { kind: 'warn', icon: 'alert-triangle', text: T.warnNumbers, numbers: n.split(':').slice(1).join(':').trim() };
  if (n.startsWith('duplicate_of:')) return { kind: null, icon: 'copy', text: T.note.dup(n.slice(13)) };
  if (n === 'no_key') return { kind: 'warn', icon: 'key', text: T.note.no_key };
  if (n === 'below_min' || n === 'stale' || n === 'manual') return { kind: n === 'manual' ? 'info' : null, icon: n === 'manual' ? 'link' : 'minus', text: T.note[n] };
  if (n === 'bad_output' || n === 'refused') return { kind: 'danger', icon: 'alert-circle', text: T.note[n] };
  if (/^api_/.test(n)) return { kind: 'danger', icon: 'alert-circle', text: T.note.api(n.slice(4)) };
  return { kind: 'danger', icon: 'alert-circle', text: T.note.other(n) };
}

// ---- importance stars (radio group, value 1..5 | null) --------------------------
function starsField({ name, label, hint }) {
  let val = null;
  const btns = [1, 2, 3, 4, 5].map(n => h('button.nv-star', { type: 'button', role: 'radio', 'aria-checked': 'false', 'aria-label': T.f.stars(n), title: T.f.stars(n), dataset: { n } }, '★'));
  const out = h('span.nv-stars__val');
  const group = h('div.nv-stars', { role: 'radiogroup', 'aria-label': label }, btns, out);
  const render = () => {
    btns.forEach((b, i) => {
      b.classList.toggle('is-on', !!val && i < val);
      b.setAttribute('aria-checked', String(val === i + 1));
      b.tabIndex = (val ? val === i + 1 : i === 0) ? 0 : -1;
    });
    out.textContent = val ? `${fa(val)} از ۵` : T.f.noStars;
  };
  const f = makeField({ name, label, hint, control: group, labelFor: false, type: 'stars',
    get: () => val, set: v => { const n = Number(v); val = Number.isInteger(n) && n >= 1 && n <= 5 ? n : null; render(); } });
  const pickN = n => { val = Math.min(5, Math.max(1, n)); render(); f.emit(); btns[val - 1].focus(); };
  group.addEventListener('click', e => { const b = e.target.closest('.nv-star'); if (b) pickN(Number(b.dataset.n)); });
  group.addEventListener('keydown', e => {
    // RTL: the first star sits on the right, so ← raises and → lowers
    const d = { ArrowLeft: 1, ArrowUp: 1, ArrowRight: -1, ArrowDown: -1 }[e.key];
    if (!d) return;
    e.preventDefault();
    pickN((val || 0) + d);
  });
  render();
  return f;
}

// ---- review card: source ↔ editable draft ----------------------------------------
let formSeq = 0;
const liveForms = new Set();
const valuesOf = it => ({
  title_fa: it.title_fa, title_en: it.title_en, summary_fa: it.summary_fa, summary_en: it.summary_en, why_fa: it.why_fa, why_en: it.why_en,
  category: it.category, importance: it.importance, tags: Array.isArray(it.tags) ? it.tags : [], image: it.image || '',
});

// opts: { selectable, selected, onSelect(id, bool), onGone(item, kind), onUpdated(item), aiEnabled: () => bool }
function reviewCard(item, opts = {}) {
  let cur = item;
  let busy = false;
  const title = bilingualField({ name: 'title', label: T.f.title, flat: true, maxLength: LIMITS.title });
  const summary = bilingualField({ name: 'summary', label: T.f.summary, flat: true, type: 'textarea', rows: 5, maxLength: LIMITS.summary });
  const why = bilingualField({ name: 'why', label: T.f.why, flat: true, type: 'textarea', rows: 3, maxLength: LIMITS.why });
  const category = selectField({ name: 'category', label: T.f.category, options: CATS.map(c => ({ value: c, label: T.cats[c] })) });
  const importance = starsField({ name: 'importance', label: T.f.importance });
  const tags = tagsField({ name: 'tags', label: T.f.tags, ltr: true, max: LIMITS.tags, maxLength: LIMITS.tag, hint: T.f.tagsHint,
    rules: [v => (Array.isArray(v) && v.some(t => !TAG_RE.test(t)) ? T.f.tagsBad : null)] });
  const image = imageField({ name: 'image', label: T.f.image, hint: T.f.imageHint });

  const check = h('input.nv-check__box', { type: 'checkbox', checked: !!opts.selected });
  check.addEventListener('change', () => { el.classList.toggle('is-selected', check.checked); opts.onSelect?.(cur.id, check.checked); });
  const head = h('div.nv-item__head');
  const srcCol = h('div.nv-src');
  const foot = h('div.nv-item__foot');
  const el = h('article.nv-item', { dataset: { id: item.id }, tabindex: '-1', 'aria-label': titleOf(item) });

  const form = createForm({
    fields: [title, summary, why, category, importance, tags, image],
    dirtyToken: `news-item-${item.id}-${++formSeq}`,
    render: () => h('div.nv-form', title.el, summary.el, why.el, h('div.nv-form__row', category.el, importance.el), tags.el, image.el),
    values: valuesOf(item),
    onDirty: d => { el.classList.toggle('is-dirty', d); renderFoot(); },
    onSubmit: async () => {
      try { await save(); toast(T.saved); return true; } catch (e) { showErrors(e); return false; }
    },
  });
  liveForms.add(form);

  function renderHead() {
    clear(head);
    const src = [cur.source_name, cur.published_src ? formatJalali(cur.published_src) : ''].filter(Boolean).join(' · ');
    const note = aiNote(cur.ai_note);
    put(head,
      opts.selectable && ['draft', 'skipped'].includes(cur.status)
        ? h('label.nv-check', { title: T.select(truncate(titleOf(cur), 40)) }, check, h('span.a-sr', T.select(truncate(titleOf(cur), 60))))
        : null,
      h('span.nv-item__id', { dir: 'ltr' }, `#${fa(cur.id)}`),
      catBadge(cur.category),
      cur.status !== 'draft' ? badge(T.status[cur.status] || cur.status, { kind: cur.status === 'published' ? 'ok' : null, icon: cur.status === 'published' ? 'check-circle' : 'minus' }) : null,
      cur.ai_pending ? badge(T.aiPending, { kind: 'info', icon: 'clock' }) : null,
      note ? badge(note.text, { kind: note.kind, icon: note.icon }) : null,
      h('span.a-grow'),
      src ? h('span.nv-item__src', src) : null,
    );
  }

  function renderSource() {
    clear(srcCol);
    const url = safeUrl(cur.url);
    const excerpt = String(cur.excerpt_src || '').trim();
    const long = excerpt.length > 420;
    const ex = h('p.nv-src__excerpt', { dir: 'auto', class: long ? 'is-clamped' : null }, excerpt || T.noExcerpt);
    const toggle = long ? h('button.a-btn.a-btn--subtle.a-btn--sm', { type: 'button', 'aria-expanded': 'false', onclick: () => {
      const open = ex.classList.toggle('is-clamped') === false;
      toggle.setAttribute('aria-expanded', String(open));
      toggle.lastChild.textContent = open ? T.less : T.more;
    } }, icon('chevron-down', { size: 'sm' }), h('span', T.more)) : null;
    const note = aiNote(cur.ai_note);
    put(srcCol,
      h('div.nv-label', T.srcLabel),
      h('h3.nv-src__title', { dir: 'auto' }, cur.title_src || '—'),
      ex, toggle,
      url ? h('div', extLink(url, cur.source_name ? `${T.readSource} — ${cur.source_name}` : T.readSource, { class: 'nv-src__link' })) : null,
      note?.numbers ? h('div.nv-warn.nv-warn--sm', icon('alert-triangle'), h('div', T.numbers, ' ', h('bdi', { dir: 'ltr' }, note.numbers))) : null,
    );
  }

  const btn = (label, ic, kind, onClick, extra = {}) => h('button', { type: 'button', class: ['a-btn', kind && `a-btn--${kind}`], onclick: onClick, ...extra }, ic ? icon(ic) : null, label);
  function renderFoot() {
    clear(foot);
    const s = cur.status;
    const dirty = form.isDirty();
    const list = [];
    if (s === 'published') {
      list.push(btn(T.act.save, 'save', 'primary', () => form.submit(), { disabled: !dirty }));
      const p = publicPath(cur);
      if (p) list.push(extLink(p, T.act.view, { class: 'a-btn a-btn--ghost' }));
      list.push(h('span.a-grow'), btn(T.act.unpublish, 'eye-off', 'danger', unpublish));
    } else {
      if (s !== 'rejected') list.push(btn(T.act.publish, 'send', 'primary', publish));
      list.push(btn(T.act.save, 'save', s === 'rejected' ? 'primary' : null, () => form.submit(), { disabled: !dirty }));
      if (['draft', 'skipped'].includes(s) && opts.aiEnabled?.()) list.push(btn(T.act.ai, 'sparkles', 'subtle', rewrite));
      list.push(h('span.a-grow'));
      if (s !== 'draft') list.push(btn(T.act.restore, 'rotate-ccw', 'ghost', restore));
      if (s !== 'rejected') list.push(btn(T.act.reject, 'x', 'danger', reject));
      else list.push(btn(T.act.del, 'trash', 'danger', remove));
    }
    foot.append(...list);
    if (busy) for (const b of foot.querySelectorAll('button')) b.disabled = true;
  }
  function setBusy(b) { busy = b; el.classList.toggle('is-busy', b); form.setBusy(b); renderFoot(); }

  async function save() {
    const v = form.getValues();
    const body = { title_fa: v.title_fa, title_en: v.title_en, summary_fa: v.summary_fa, summary_en: v.summary_en, why_fa: v.why_fa, why_en: v.why_en, category: v.category, tags: v.tags, image: v.image || '' };
    if (v.importance) body.importance = v.importance;
    const r = await api.put(`/news/items/${cur.id}`, body);
    update(r.item);
    return cur;
  }
  function update(it) {
    cur = it;
    form.setValues(valuesOf(cur));
    el.setAttribute('aria-label', titleOf(cur));
    renderHead(); renderSource(); renderFoot();
    opts.onUpdated?.(cur);
  }
  const byLang = { title, summary, why };
  function showErrors(e) {
    const fields = e?.raw?.fields && typeof e.raw.fields === 'object' ? e.raw.fields : null;
    let langMissing = false;
    if (fields) {
      for (const k of Object.keys(fields)) {
        const m = /^(title|summary|why)_(fa|en)$/.exec(k);
        const f = m ? byLang[m[1]][m[2]] : form.byName[k];
        if (!f) continue;
        const required = /required/.test(String(fields[k]));
        if (m && required) langMissing = true;
        f.setError(required ? T.needField : (e.fields?.[k] || STR.fields.invalid));
      }
    }
    const specific = typeof T.err[e?.code] === 'string' ? T.err[e.code] : '';
    toast.error(langMissing ? T.needBoth : specific || e?.message || STR.states.error);
  }
  function completeForPublish() {
    const v = form.getValues();
    let ok = true;
    for (const [k, f] of [['title_fa', title.fa], ['title_en', title.en], ['summary_fa', summary.fa], ['summary_en', summary.en]]) {
      if (!String(v[k] || '').trim()) { f.setError(T.needField); if (ok) f.focus(); ok = false; }
    }
    if (!ok) toast.warn(T.needBoth);
    return ok;
  }

  async function act(fn) {
    if (busy) return;
    setBusy(true);
    try { await fn(); } catch (e) { showErrors(e); } finally { setBusy(false); }
  }
  async function publish() {
    if (!completeForPublish()) return;
    if (form.isDirty() && !(await form.submit())) return;
    await act(async () => {
      const r = await api.post(`/news/items/${cur.id}/publish`, {});
      cur = r.item;
      opts.onGone?.(cur, 'published');
    });
  }
  async function reject() {
    if (form.isDirty() && !(await confirm({ title: T.act.reject, message: T.rejectDirty, confirmLabel: T.act.reject, danger: true }))) return;
    await act(async () => { const r = await api.post(`/news/items/${cur.id}/reject`, {}); form.markClean(); cur = r.item; opts.onGone?.(cur, 'rejected'); });
  }
  async function restore() {
    await act(async () => { const r = await api.post(`/news/items/${cur.id}/restore`, {}); cur = r.item; opts.onGone?.(cur, 'restored'); });
  }
  async function unpublish() {
    if (!(await confirm({ title: T.act.unpublish, message: T.unpubMsg(truncate(titleOf(cur), 80)), confirmLabel: T.act.unpublish, danger: true, icon: 'eye-off' }))) return;
    await act(async () => { const r = await api.post(`/news/items/${cur.id}/restore`, {}); form.markClean(); cur = r.item; opts.onGone?.(cur, 'unpublished'); });
  }
  async function remove() {
    if (!(await confirm({ title: STR.confirm.deleteTitle, message: T.delMsg(truncate(titleOf(cur), 80)), confirmLabel: STR.confirm.deleteConfirm, danger: true }))) return;
    await act(async () => { await api.del(`/news/items/${cur.id}`); form.markClean(); opts.onGone?.(cur, 'deleted'); });
  }
  async function rewrite() {
    if (form.isDirty() && !(await confirm({ title: T.act.ai, message: T.aiDirty, confirmLabel: T.act.ai }))) return;
    await act(async () => {
      const r = await api.post(`/news/items/${cur.id}/summarize`, {});
      update(r.item);
      if (r.ok) toast(T.aiDone); else toast.warn(aiNote(r.error)?.text || errText(r.error));
    });
  }

  renderHead(); renderSource(); renderFoot();
  el.append(head, h('div.nv-item__grid', srcCol, h('div.nv-draft', h('div.nv-label', T.draftLabel), form.el)), foot);
  if (opts.selected) el.classList.add('is-selected');
  return {
    el, form,
    get item() { return cur; },
    get id() { return cur.id; },
    setSelected(on) { check.checked = !!on; el.classList.toggle('is-selected', !!on); },
    refreshActions: renderFoot,
    destroy() { form.destroy(); liveForms.delete(form); },
  };
}

// ---- collection status (key / schedule) ------------------------------------------------
function collectInfo(meta) {
  if (!meta?.cfg) return null;
  const { config: cfg, openai_configured: hasKey } = meta.cfg;
  const runs = meta.runs || [];
  if (!hasKey) return { kind: 'warn', text: T.info.noKey, link: { href: '#/ai', label: T.info.setKey }, empty: T.info.emptyNoKey };
  if (!cfg.enabled) return { kind: 'warn', text: T.info.disabled, tab: 'settings', empty: T.info.emptyOff };
  if (runs.some(r => !r.finished_at)) return { kind: 'info', text: T.info.running, empty: T.info.emptyHint(T.info.running) };
  const last = runs.find(r => r.error !== 'no_key');
  const lastAt = last ? parseServerDate(last.started_at) : null;
  const next = lastAt ? new Date(lastAt.getTime() + cfg.interval_hours * 3600e3) : null;
  const nextTxt = !next || next.getTime() <= Date.now() + 60e3 ? T.info.nextSoon : T.info.next(relTime(next), formatJalali(next, { style: 'datetime' }));
  return { kind: 'ok', text: `${last ? T.info.last(relTime(lastAt)) : T.info.never} · ${nextTxt}`, empty: T.info.emptyHint(nextTxt) };
}

// ---- run now (shared by the queue strip and the settings tab) -----------------------------
function runSummary(run) {
  if (!run) return h('p.a-hint', T.run.stillRunning);
  if (run.locked) return h('div.nv-warn', icon('clock'), h('div', T.run.locked));
  const errMsg = run.error ? (T.run.err[run.error] || errText(run.error)) : '';
  const stat = (label, n, kind) => h('div', { class: ['nv-stat', kind && `nv-stat--${kind}`] }, h('b', fa(n ?? 0)), h('span', label));
  return h('div.a-stack.a-stack--sm',
    run.error === 'no_key' ? null : h('div.nv-stats', stat(T.run.ok, run.sources_ok), stat(T.run.failed, run.sources_failed, run.sources_failed ? 'warn' : null), stat(T.run.fresh, run.items_new), stat(T.run.drafted, run.items_drafted, 'ok'), stat(T.run.skipped, run.items_skipped)),
    errMsg ? h('div.nv-warn.nv-warn--sm', icon('alert-triangle'), h('div', errMsg)) : null);
}
async function runNow(shell, btn, out) {
  if (btn.disabled) return null;
  btn.disabled = true; btn.classList.add('is-busy');
  if (out) out.replaceChildren(h('p.a-hint.nv-working', icon('loader', { size: 'sm' }), T.run.working));
  try {
    const r = await api.post('/news/run', {});
    let run = r.run;
    if (r.running && run?.id) run = await pollRun(shell, run.id);
    if (!shell.alive) return null;
    out?.replaceChildren(runSummary(run));
    if (!out) {
      if (run?.locked) toast.warn(T.run.locked);
      else if (run?.error && run.error !== 'daily_cap') toast.warn(T.run.err[run.error] || errText(run.error));
      else toast(`${T.run.done} — ${T.run.drafted}: ${fa(run?.items_drafted ?? 0)}`);
    }
    await shell.loadMeta();
    shell.onRunDone();
    return run;
  } catch (e) {
    out?.replaceChildren(h('div.nv-warn', icon('alert-circle'), h('div', e.message)));
    if (!out) toast.error(e.message);
    return null;
  } finally { btn.disabled = false; btn.classList.remove('is-busy'); }
}
async function pollRun(shell, id) {
  for (let i = 0; i < RUN_POLL_MAX && shell.alive; i++) {
    await new Promise(res => setTimeout(res, RUN_POLL_MS));
    try {
      const { runs } = await api.get('/news/runs');
      const run = runs.find(x => x.id === id);
      if (run?.finished_at) return run;
    } catch { /* keep polling */ }
  }
  return null;
}

// ---- tab: queue ---------------------------------------------------------------------------
async function mountQueue(panel, ctx, shell) {
  const state = { status: 'draft', category: '', q: '', page: 1, pages: 1, total: 0, cards: new Map(), selected: new Set(), token: 0 };
  const anyDirty = () => [...state.cards.values()].some(c => c.form.isDirty());
  const okToDiscard = async () => !anyDirty() || confirm({ title: STR.confirm.leaveTitle, message: T.q.discard, confirmLabel: STR.actions.discard, cancelLabel: STR.actions.stay, danger: true, icon: 'alert-triangle' });

  const strip = h('div.nv-strip', { 'aria-live': 'polite' });
  const segBtns = Object.keys(T.q.seg).map(s => h('button.nv-seg__btn', { type: 'button', 'aria-pressed': String(s === state.status), dataset: { s }, onclick: () => setStatus(s) }, h('span', T.q.seg[s]), h('span.nv-seg__n')));
  const seg = h('div.nv-seg', { role: 'group', 'aria-label': T.tabs.queue }, segBtns);
  const refreshBtn = h('button.a-btn.a-btn--subtle', { type: 'button', 'aria-label': T.q.refresh, title: T.q.refresh, onclick: async () => { if (await okToDiscard()) { load(); shell.loadMeta(); } } }, icon('refresh-cw'));
  const fb = filterBar({
    search: { placeholder: T.q.search },
    filters: [{ name: 'category', label: T.q.allCats, options: CATS.map(c => ({ value: c, label: T.cats[c] })) }],
    actions: [refreshBtn],
    onChange: async v => { if (silent || !(await okToDiscard())) return; state.q = (v.q || '').trim(); state.category = v.category || ''; state.page = 1; load(); },
  });
  let silent = false;
  const allBox = h('input.nv-check__box', { type: 'checkbox', onchange: () => selectAll(allBox.checked) });
  const selInfo = h('span.nv-bulk__info');
  const bulkPub = h('button.a-btn.a-btn--primary.a-btn--sm', { type: 'button', disabled: true, onclick: () => bulk('publish') }, icon('send', { size: 'sm' }), T.q.bulkPublish);
  const bulkRej = h('button.a-btn.a-btn--danger.a-btn--sm', { type: 'button', disabled: true, onclick: () => bulk('reject') }, icon('x', { size: 'sm' }), T.q.bulkReject);
  const bulkBar = h('div.nv-bulk', h('label.nv-check', allBox, h('span', T.q.selectAll)), selInfo, h('span.a-grow'), h('span.nv-order.a-hint', T.q.order), bulkPub, bulkRej);
  const list = h('div.nv-list');
  const pager = h('div.nv-pager', { hidden: true });
  panel.replaceChildren(strip, h('div.nv-toolbar', seg, fb.el), bulkBar, list, pager);

  function renderStrip() {
    const info = collectInfo(shell.meta);
    clear(strip);
    if (!info) return;
    const runBtn = h('button.a-btn.a-btn--sm', { type: 'button', onclick: () => runNow(shell, runBtn, null) }, icon('refresh-cw', { size: 'sm' }), T.runNow);
    strip.className = `nv-strip nv-strip--${info.kind}`;
    put(strip, icon(info.kind === 'ok' ? 'clock' : info.kind === 'info' ? 'loader' : 'alert-triangle'), h('span.nv-strip__text', info.text),
      h('span.a-grow'),
      info.link ? h('a.a-btn.a-btn--sm', { href: info.link.href }, icon('key', { size: 'sm' }), info.link.label) : null,
      info.tab ? h('button.a-btn.a-btn--sm', { type: 'button', onclick: () => shell.select(info.tab) }, icon('settings', { size: 'sm' }), T.info.toSettings) : null,
      shell.meta.cfg.openai_configured ? runBtn : null);
  }

  function renderCounts(counts = {}) {
    shell.counts = counts;
    for (const b of segBtns) {
      const n = counts[b.dataset.s] || 0;
      b.lastChild.textContent = n ? fa(n) : '';
      b.setAttribute('aria-pressed', String(b.dataset.s === state.status));
    }
    shell.setPending(counts.draft || 0);
  }
  function renderBulk() {
    const canBulk = ['draft', 'skipped'].includes(state.status) && state.cards.size > 0;
    bulkBar.hidden = !canBulk;
    const n = state.selected.size;
    selInfo.textContent = n ? T.q.selected(n) : '';
    bulkPub.disabled = !n; bulkRej.disabled = !n;
    allBox.checked = n > 0 && n === state.cards.size;
    allBox.indeterminate = n > 0 && n < state.cards.size;
  }
  function selectAll(on) {
    state.selected = on ? new Set(state.cards.keys()) : new Set();
    for (const [id, c] of state.cards) c.setSelected(state.selected.has(id));
    renderBulk();
  }
  function renderPager() {
    clear(pager);
    pager.hidden = state.pages <= 1;
    if (pager.hidden) return;
    const go = async d => { if (!(await okToDiscard())) return; state.page += d; load(); list.scrollIntoView({ block: 'start' }); };
    pager.append(
      h('button.a-btn.a-btn--sm', { type: 'button', disabled: state.page <= 1, onclick: () => go(-1) }, icon('chevron-right', { size: 'sm' }), T.q.prev),
      h('span', STR.states.of(state.page, state.pages)),
      h('button.a-btn.a-btn--sm', { type: 'button', disabled: state.page >= state.pages, onclick: () => go(1) }, T.q.next, icon('chevron-left', { size: 'sm' })),
      h('span.a-grow'), h('span.a-hint', STR.states.items(state.total)));
  }
  function destroyCards() { for (const c of state.cards.values()) c.destroy(); state.cards.clear(); state.selected.clear(); }

  function emptyView() {
    const filtered = state.q || state.category;
    if (filtered) return emptyState({ icon: 'search', title: T.q.emptyFilter, hint: STR.states.noMatchHint });
    if (state.status !== 'draft') return emptyState({ icon: 'inbox', title: T.q.emptyOther });
    const info = collectInfo(shell.meta);
    return emptyState({ icon: 'newspaper', title: T.q.emptyDraft, hint: info?.empty || '', action: { label: T.fromUrl, icon: 'link', onClick: () => shell.openFromUrl() } });
  }

  function removeCard(id) {
    const c = state.cards.get(id);
    if (!c) return false;
    c.destroy();
    c.el.remove();
    state.cards.delete(id);
    state.selected.delete(id);
    if (!state.cards.size) { if (state.page > 1) { state.page--; load(); } else list.replaceChildren(emptyView()); }
    renderBulk();
    return true;
  }

  async function load() {
    const my = ++state.token;
    destroyCards();
    list.replaceChildren(skeleton({ kind: 'cards', cards: 2 }));
    renderBulk();
    const qs = new URLSearchParams({ status: state.status, page: String(state.page) });
    if (state.category) qs.set('category', state.category);
    if (state.q) qs.set('q', state.q);
    try {
      const r = await api.get(`/news/items?${qs}`);
      if (my !== state.token || !shell.alive) return;
      state.pages = r.pages; state.total = r.total;
      if (state.page > r.pages) { state.page = r.pages; load(); return; }
      renderCounts(r.counts);
      clear(list);
      if (!r.items.length) list.appendChild(emptyView());
      for (const it of r.items) {
        const c = reviewCard(it, {
          selectable: true,
          onSelect: (id, on) => { if (on) state.selected.add(id); else state.selected.delete(id); renderBulk(); },
          onGone: (item, kind) => { removeCard(item.id); shell.gone(item, kind); },
          aiEnabled: () => !!shell.meta?.cfg?.openai_configured,
        });
        state.cards.set(it.id, c);
        list.appendChild(c.el);
      }
      renderBulk(); renderPager();
    } catch (e) {
      if (my !== state.token) return;
      list.replaceChildren(errorState({ error: e, retry: () => load() }));
    }
  }

  async function setStatus(s) {
    if (s === state.status || !(await okToDiscard())) return;
    state.status = s; state.page = 1;
    renderCounts(shell.counts);
    load();
  }

  async function bulk(action) {
    const ids = [...state.selected];
    if (!ids.length) return;
    if (ids.some(id => state.cards.get(id)?.form.isDirty())) { toast.warn(T.q.bulkSaveFirst); return; }
    const ok = await confirm(action === 'publish'
      ? { title: T.q.bulkPublishQ(ids.length), message: T.q.bulkPublishMsg, confirmLabel: T.q.bulkPublish, icon: 'send' }
      : { title: T.q.bulkRejectQ(ids.length), message: '', confirmLabel: T.q.bulkReject, danger: true });
    if (!ok) return;
    bulkPub.disabled = bulkRej.disabled = true;
    try {
      const r = await api.post('/news/items/bulk', { ids, action });
      const failed = r.results.filter(x => !x.ok);
      for (const x of r.results) if (x.ok) removeCard(x.id);
      if (r.done) toast(T.q.bulkDone(r.done, action));
      if (failed.length) {
        toast.warn(T.q.bulkFail(failed.length), { timeout: 8000 });
        for (const x of failed) state.cards.get(x.id)?.el.classList.add('is-flagged');
      }
      shell.bulkDone(action, r.done);
    } catch (e) { toast.error(e.message); }
    finally { renderBulk(); }
  }

  fb.el.classList.add('nv-filters');
  renderStrip();
  await load();
  return {
    refresh: async ({ force = false } = {}) => { renderStrip(); if (force || !anyDirty()) await load(); },
    renderStrip,
    setCounts: renderCounts,
    // scroll to a card on this page; false when it is not here
    focus(id) {
      const c = state.cards.get(Number(id));
      if (!c) return false;
      c.el.scrollIntoView({ block: 'start' });
      c.el.focus({ preventScroll: true });
      c.el.classList.add('is-flagged');
      setTimeout(() => c.el.classList.remove('is-flagged'), 2400);
      return true;
    },
    remove: removeCard,
    // back to page 1 of the drafts, filters cleared (caller checked `dirty`)
    async showDrafts() {
      state.status = 'draft'; state.page = 1; state.q = ''; state.category = '';
      silent = true; fb.reset(); silent = false;
      await load();
    },
    get dirty() { return anyDirty(); },
    cleanup() { state.token++; destroyCards(); },
  };
}

// ---- tab: published ---------------------------------------------------------------------------
async function mountPublished(panel, ctx, shell) {
  const state = { category: '', q: '', page: 1, pages: 1, total: 0, token: 0 };
  const fb = filterBar({
    search: { placeholder: T.q.search },
    filters: [{ name: 'category', label: T.q.allCats, options: CATS.map(c => ({ value: c, label: T.cats[c] })) }],
    onChange: v => { state.q = (v.q || '').trim(); state.category = v.category || ''; state.page = 1; load(); },
  });
  const table = dataTable({
    columns: [
      { key: 'title_fa', label: T.f.title, render: r => h('div.nv-cell-title', h('span.a-table__primary', r.title_fa || r.title_en), r.title_en ? h('span.a-table__secondary', { dir: 'ltr', lang: 'en' }, truncate(r.title_en, 90)) : null) },
      { key: 'category', label: T.f.category, render: r => catBadge(r.category) },
      { key: 'importance', label: T.f.importance, render: r => starsText(r.importance) },
      { key: 'published_at', label: T.status.published, render: r => h('span', { title: formatJalali(r.published_at, { style: 'datetime' }) }, formatJalali(r.published_at)) },
      { key: 'slug', label: T.act.view, render: r => h('div.nv-links', extLink(publicPath(r, 'fa'), 'فارسی'), extLink(publicPath(r, 'en'), 'English', { lang: 'en' })) },
    ],
    rows: [],
    onRowClick: r => shell.openItem(r.id),
    actions: r => [
      { icon: 'pencil', label: STR.actions.edit, onClick: () => shell.openItem(r.id) },
      { icon: 'eye-off', label: T.act.unpublish, danger: true, onClick: () => unpublish(r) },
    ],
    empty: { icon: 'newspaper', title: T.q.emptyOther, hint: T.subtitle },
  });
  const pager = h('div.nv-pager', { hidden: true });
  panel.replaceChildren(fb.el, table.el, pager);

  async function unpublish(r) {
    if (!(await confirm({ title: T.act.unpublish, message: T.unpubMsg(truncate(titleOf(r), 80)), confirmLabel: T.act.unpublish, danger: true, icon: 'eye-off' }))) return;
    try { const res = await api.post(`/news/items/${r.id}/restore`, {}); shell.gone(res.item, 'unpublished'); } catch (e) { toast.error(e.message); }
  }
  function renderPager() {
    clear(pager);
    pager.hidden = state.pages <= 1;
    if (pager.hidden) return;
    pager.append(
      h('button.a-btn.a-btn--sm', { type: 'button', disabled: state.page <= 1, onclick: () => { state.page--; load(); } }, icon('chevron-right', { size: 'sm' }), T.q.prev),
      h('span', STR.states.of(state.page, state.pages)),
      h('button.a-btn.a-btn--sm', { type: 'button', disabled: state.page >= state.pages, onclick: () => { state.page++; load(); } }, T.q.next, icon('chevron-left', { size: 'sm' })),
      h('span.a-grow'), h('span.a-hint', STR.states.items(state.total)));
  }
  async function load() {
    const my = ++state.token;
    table.setLoading(true);
    const qs = new URLSearchParams({ status: 'published', page: String(state.page) });
    if (state.category) qs.set('category', state.category);
    if (state.q) qs.set('q', state.q);
    try {
      const r = await api.get(`/news/items?${qs}`);
      if (my !== state.token) return;
      state.pages = r.pages; state.total = r.total;
      table.setRows(r.items);
      fb.setCount(r.total);
      shell.setCounts(r.counts);
      renderPager();
    } catch (e) { if (my === state.token) table.setError(e, load); }
  }
  await load();
  return { refresh: load, cleanup() { state.token++; } };
}

// ---- tab: sources -------------------------------------------------------------------------------
function probeView(res) {
  if (!res?.ok) return h('div.a-stack.a-stack--sm', badge(T.src.probeFail, { kind: 'danger', icon: 'alert-circle' }), h('p', errText(res?.error)));
  return h('div.a-stack.a-stack--sm',
    badge(T.src.probeOk, { kind: 'ok', icon: 'check-circle' }),
    h('dl.a-dl', h('dt', T.src.feedTitle), h('dd', { dir: 'auto' }, res.title || '—'), h('dt', T.src.kind), h('dd', { dir: 'ltr' }, String(res.kind || '—').toUpperCase()), h('dt', T.src.count), h('dd', fa(res.count ?? 0))),
    res.titles?.length ? h('div', h('div.nv-label', T.src.first), h('ol.nv-probe', res.titles.map(t => h('li', { dir: 'auto' }, t)))) : null,
    res.redirected ? h('div.nv-warn.nv-warn--sm', icon('info'), h('div', T.src.redirected(''), h('bdi.a-mono', { dir: 'ltr' }, res.redirected))) : null);
}
function sourceStatus(r) {
  if (!r.last_fetched_at) return badge(T.src.never, { icon: 'clock' });
  const when = h('span.a-small.a-muted', relTime(r.last_fetched_at));
  if (r.last_status === 'error') return h('div.nv-cell-stack', badge(T.src.error, { kind: 'danger', icon: 'alert-circle' }), h('span.a-small', errText(r.last_error)), when);
  if (r.last_status === 'not_modified') return h('div.nv-cell-stack', badge(T.src.notModified, { kind: 'info', icon: 'check' }), when);
  return h('div.nv-cell-stack', badge(T.src.ok, { kind: 'ok', icon: 'check-circle' }), when);
}
async function mountSources(panel, ctx, shell) {
  let rows = [];
  const addBtn = h('button.a-btn.a-btn--primary', { type: 'button', onclick: () => editSource(null) }, icon('plus'), T.src.add);
  const fb = filterBar({ search: { placeholder: T.q.search }, actions: [addBtn], onChange: () => apply() });
  const enabledSwitch = r => {
    const state = h('span.a-switch__state', r.enabled ? STR.states.enabled : STR.states.disabled);
    const input = h('input', { type: 'checkbox', role: 'switch', checked: !!r.enabled, 'aria-label': `${T.src.enabledFor} — ${r.name}` });
    input.addEventListener('change', async () => {
      input.disabled = true;
      try {
        const res = await api.put(`/news/sources/${r.id}`, { enabled: input.checked });
        Object.assign(r, res.source);
        toast(input.checked ? T.src.on : T.src.off);
      } catch (e) { input.checked = !input.checked; toast.error(e.message); }
      finally { input.disabled = false; state.textContent = input.checked ? STR.states.enabled : STR.states.disabled; }
    });
    return h('label.a-switch', input, h('span.a-switch__track', { 'aria-hidden': 'true' }), state);
  };
  const table = dataTable({
    columns: [
      { key: 'name', label: T.src.colName, render: r => h('div.nv-cell-title', h('span.a-table__primary', r.name), h('span.a-table__secondary.nv-url', { dir: 'ltr' }, truncate(String(r.url).replace(/^https:\/\//, ''), 64))) },
      { key: 'category', label: T.src.colCat, render: r => catBadge(r.category) },
      { key: 'enabled', label: T.src.colEnabled, render: enabledSwitch },
      { key: 'last_status', label: T.src.colStatus, render: sourceStatus },
      { key: 'items_total', label: T.src.colItems, render: r => `${fa(r.items_published ?? 0)} / ${fa(r.items_total ?? 0)}` },
    ],
    rows: [],
    actions: r => [
      { icon: 'zap', label: T.src.test, showLabel: true, onClick: () => testSource(r) },
      { icon: 'pencil', label: STR.actions.edit, onClick: () => editSource(r) },
      { icon: 'trash', label: STR.actions.delete, danger: true, onClick: () => removeSource(r) },
    ],
    empty: { icon: 'globe', title: T.src.empty, hint: T.src.emptyHint, action: { label: T.src.add, icon: 'plus', onClick: () => editSource(null) } },
  });
  panel.replaceChildren(fb.el, table.el);

  const matches = r => { const q = (fb.values.q || '').trim().toLowerCase(); return !q || `${r.name} ${r.url}`.toLowerCase().includes(q); };
  function apply() { const list = rows.filter(matches); table.setRows(list); fb.setCount(list.length, rows.length); }
  async function load() {
    table.setLoading(true);
    try { rows = (await api.get('/news/sources')).sources; apply(); } catch (e) { table.setError(e, load); }
  }
  async function testSource(r) {
    const body = h('div', h('p.a-hint.nv-working', icon('loader', { size: 'sm' }), T.src.testing));
    modal({ title: T.src.testTitle(r.name), body, actions: [{ label: STR.actions.close, kind: 'ghost' }] }).open();
    try { body.replaceChildren(probeView(await api.post(`/news/sources/${r.id}/test`, {}))); load(); }
    catch (e) { body.replaceChildren(errorState({ error: e })); }
  }
  async function removeSource(r) {
    if (!(await confirm({ title: STR.confirm.deleteTitle, message: T.src.delMsg(r.name), confirmLabel: STR.confirm.deleteConfirm, danger: true }))) return;
    try { await api.del(`/news/sources/${r.id}`); toast(T.src.removed); load(); } catch (e) { toast.error(e.message); }
  }
  function editSource(r) {
    const name = field({ name: 'name', label: T.src.name, required: true, maxLength: LIMITS.name });
    const url = field({ name: 'url', label: T.src.url, type: 'url', dir: 'ltr', required: true, maxLength: LIMITS.url, placeholder: 'https://example.com/feed.xml', hint: T.src.urlHint,
      rules: [v => (!v || /^https:\/\//i.test(v) ? null : STR.fields.https)] });
    const category = selectField({ name: 'category', label: T.src.cat, hint: T.src.catHint, options: CATS.map(c => ({ value: c, label: T.cats[c] })) });
    const lang = selectField({ name: 'lang', label: T.src.lang, options: [{ value: 'en', label: 'English' }, { value: 'fa', label: 'فارسی' }] });
    const enabled = switchField({ name: 'enabled', label: T.src.enabled });
    const probeOut = h('div.nv-probe-out', { 'aria-live': 'polite' });
    const testBtn = h('button.a-btn', { type: 'button', onclick: async () => {
      if (url.validate()) return;
      testBtn.disabled = true;
      probeOut.replaceChildren(h('p.a-hint.nv-working', icon('loader', { size: 'sm' }), T.src.testing));
      try { probeOut.replaceChildren(probeView(await api.post('/news/sources/test', { url: url.value }))); }
      catch (e) { probeOut.replaceChildren(h('div.nv-warn.nv-warn--sm', icon('alert-circle'), h('div', e.fields?.url || e.message))); }
      finally { testBtn.disabled = false; }
    } }, icon('zap'), T.src.test);
    const form = createForm({
      fields: [{ columns: 2, fields: [name, category] }, url, { columns: 2, fields: [lang, enabled] }],
      dirtyToken: `news-source-${r?.id || 'new'}`,
      values: r ? { name: r.name, url: r.url, category: r.category, lang: r.lang, enabled: !!r.enabled } : { name: '', url: '', category: 'industry', lang: 'en', enabled: true },
      onSubmit: async v => {
        try {
          if (r) await api.put(`/news/sources/${r.id}`, v); else await api.post('/news/sources', v);
        } catch (e) {
          if (e.status === 409) { url.setError(T.src.dup); return false; }
          throw e;
        }
        toast(r ? T.src.saved : T.src.created);
        load();
        return true;
      },
    });
    let allowClose = false;
    const m = modal({
      title: r ? T.src.edit : T.src.add, size: 'lg',
      body: h('div.a-stack', form.el, h('div.a-row', testBtn), probeOut),
      actions: [
        { label: STR.actions.cancel, kind: 'ghost' },
        { label: STR.actions.save, kind: 'primary', icon: 'save', close: false, onClick: async () => { if (await form.submit()) { allowClose = true; m.close(true); } return false; } },
      ],
      beforeClose: res => guardClose(form, res, () => allowClose, () => { allowClose = true; m.close('discard'); }),
      onClose: () => form.destroy(),
    });
    m.open();
  }
  await load();
  return { refresh: load, cleanup() {} };
}

// a dialog holding a form: closing with unsaved edits asks first
function guardClose(form, result, allowed, discard) {
  if (allowed() || result === 'force' || !form.isDirty()) return true;
  confirm({ title: STR.confirm.leaveTitle, message: STR.confirm.leaveMessage, confirmLabel: STR.actions.discard, cancelLabel: STR.actions.stay, danger: true, icon: 'alert-triangle' })
    .then(ok => { if (ok) discard(); });
  return false;
}

// ---- tab: settings ------------------------------------------------------------------------------
async function mountSettings(panel, ctx, shell) {
  panel.replaceChildren(skeleton({ kind: 'form' }));
  let view;
  try { view = await api.get('/news/config'); } catch (e) { panel.replaceChildren(errorState({ error: e, retry: () => shell.remount('settings') })); return { cleanup() {} }; }
  if (!shell.alive) return { cleanup() {} };
  const cfg = view.config;
  const enabled = switchField({ name: 'enabled', label: T.set.enabled });
  const interval = numberField({ name: 'interval_hours', label: T.set.interval, min: 1, max: 168, suffix: T.set.hours, hint: T.set.intervalHint, required: true, nullable: false });
  const minImp = selectField({ name: 'min_importance', label: T.set.minImp, hint: T.set.minImpHint, options: [1, 2, 3, 4, 5].map(n => ({ value: n, label: T.set.minOpt(n) })) });
  const cap = numberField({ name: 'daily_cap', label: T.set.cap, min: 0, max: 500, hint: T.set.capHint, required: true, nullable: false });
  const model = field({ name: 'model', label: T.set.model, dir: 'ltr', mono: true, maxLength: LIMITS.model, placeholder: view.model_effective || '', hint: T.set.modelHint(view.model_effective || '—'),
    rules: [v => (MODEL_RE.test(v || '') ? null : T.set.modelBad)] });
  const usage = h('p.a-hint', T.set.usage(view.ai_calls_today, cfg.daily_cap));
  const form = createForm({
    fields: [{ title: T.set.secRun, fields: [enabled, interval] }, { title: T.set.secAi, columns: 2, fields: [minImp, cap] }, model],
    dirtyToken: 'news-config',
    values: { enabled: cfg.enabled, interval_hours: cfg.interval_hours, min_importance: String(cfg.min_importance), daily_cap: cfg.daily_cap, model: cfg.model },
    onSubmit: async v => {
      const r = await api.put('/news/config', { enabled: !!v.enabled, interval_hours: Number(v.interval_hours), min_importance: Number(v.min_importance), daily_cap: Number(v.daily_cap), model: String(v.model || '').trim() });
      usage.textContent = T.set.usage(r.ai_calls_today, r.config.daily_cap);
      toast(T.set.saved);
      await shell.loadMeta();
      return true;
    },
  });
  const saveBtn = h('button.a-btn.a-btn--primary', { type: 'submit', form: form.id }, icon('save'), STR.actions.save);
  form.el.addEventListener('form:busy', e => { saveBtn.disabled = e.detail; });

  const runOut = h('div.nv-run-out', { 'aria-live': 'polite' });
  const runBtn = h('button.a-btn', { type: 'button', disabled: !view.openai_configured, onclick: () => runNow(shell, runBtn, runOut) }, icon('refresh-cw'), T.runNow);
  const runsTable = dataTable({
    dense: true,
    columns: [
      { key: 'started_at', label: T.run.colWhen, render: r => h('span', { title: formatJalali(r.started_at, { style: 'datetime' }) }, relTime(r.started_at)) },
      { key: 'trigger', label: T.run.colTrigger, render: r => T.run.trigger[r.trigger] || r.trigger },
      { key: 'sources_ok', label: T.run.colSources, render: r => `${fa(r.sources_ok)} / ${fa(r.sources_failed)}` },
      { key: 'items_new', label: T.run.colNew, num: true },
      { key: 'items_drafted', label: T.run.colDrafted, num: true },
      { key: 'items_skipped', label: T.run.colSkipped, num: true },
      { key: 'error', label: T.run.colState, render: r => (!r.finished_at ? badge(T.run.running, { kind: 'info', icon: 'loader' }) : r.error ? badge(T.run.err[r.error] ? T.run.err[r.error].split('؛')[0] : errText(r.error), { kind: r.error === 'daily_cap' ? 'warn' : 'danger', icon: 'alert-triangle' }) : badge(T.run.fine, { kind: 'ok', icon: 'check-circle' })) },
    ],
    rows: [], empty: { icon: 'history', title: T.run.none },
  });
  async function loadRuns() {
    runsTable.setLoading(true);
    try { runsTable.setRows((await api.get('/news/runs')).runs.slice(0, 10)); } catch (e) { runsTable.setError(e, loadRuns); }
  }
  clear(panel);
  put(panel,
    view.openai_configured ? null : h('div.nv-warn', icon('alert-triangle'), h('div.a-stack.a-stack--sm', h('b', T.set.noKeyTitle), h('p', T.set.noKeyText), h('div', h('a.a-btn.a-btn--sm', { href: '#/ai' }, icon('key', { size: 'sm' }), T.set.goAi)))),
    card({ body: h('div.a-stack', form.el, usage, h('p.a-hint', icon('info', { size: 'sm' }), ' ', T.set.review)), footer: [saveBtn] }),
    card({ title: T.runNow, hint: collectInfo(shell.meta)?.text || '', actions: [runBtn], body: h('div.a-stack', runOut, h('div.nv-label', T.run.runs), runsTable.el) }),
  );
  await loadRuns();
  return { refresh: loadRuns, cleanup() { form.destroy(); } };
}

// ---- manual draft from a link --------------------------------------------------------------------
function openFromUrl(shell) {
  const url = field({ name: 'url', label: T.url.label, type: 'url', dir: 'ltr', required: true, maxLength: LIMITS.url, placeholder: 'https://…',
    rules: [v => (!v || /^https:\/\//i.test(v) ? null : STR.fields.https)] });
  const status = h('div', { 'aria-live': 'polite' });
  let allowClose = false;
  const form = createForm({
    fields: [url], dirtyToken: 'news-from-url', submitOnEnter: true,
    onSubmit: async v => {
      status.replaceChildren(h('p.a-hint.nv-working', icon('loader', { size: 'sm' }), T.url.working));
      try {
        const r = await api.post('/news/items/draft-from-url', { url: v.url.trim() });
        status.replaceChildren();
        if (r.item?.ai_note && r.item.ai_note !== 'manual') toast.warn(T.url.doneNoAi, { timeout: 8000 }); else toast(T.url.done);
        allowClose = true;
        m.close(true);
        shell.afterManual(r.item);
        return true;
      } catch (e) {
        status.replaceChildren();
        const f = e.raw?.fields || {};
        if (e.code === 'duplicate') {
          url.setError(T.url.dup);
          const id = Number(f.id);
          if (id) status.replaceChildren(h('button.a-btn.a-btn--sm', { type: 'button', onclick: () => { allowClose = true; form.markClean(); m.close('dup'); shell.openItem(id); } }, icon('eye', { size: 'sm' }), T.url.show));
          return false;
        }
        if (e.code === 'fetch_failed') { url.setError(T.url.fetchFail(errText(f.url))); return false; }
        throw e;
      }
    },
  });
  const m = modal({
    title: T.url.title,
    body: h('div.a-stack', h('p.a-hint', T.url.hint), form.el, status),
    actions: [
      { label: STR.actions.cancel, kind: 'ghost' },
      { label: T.url.submit, kind: 'primary', icon: 'sparkles', close: false, onClick: async () => { await form.submit(); return false; } },
    ],
    beforeClose: res => guardClose(form, res, () => allowClose, () => { allowClose = true; m.close('discard'); }),
    onClose: () => form.destroy(),
  });
  m.open();
}

// ---- view ------------------------------------------------------------------------------------------
const MOUNTS = { queue: mountQueue, published: mountPublished, sources: mountSources, settings: mountSettings };

async function mount(root, ctx) {
  ensureStylesheet(CSS_HREF);
  const start = TABS.includes(ctx.params?.tab) ? ctx.params.tab : 'queue';
  const deepId = Number(ctx.params?.id) || 0;
  const panels = Object.fromEntries(TABS.map(t => [t, h('div.a-stack')]));
  const apis = {};
  const mounted = new Set();
  const stale = new Set();
  let active = start;
  const drawers = new Set();

  const shell = {
    alive: true, meta: null, counts: {},
    async loadMeta() {
      try {
        const [cfg, runs] = await Promise.all([api.get('/news/config'), api.get('/news/runs')]);
        shell.meta = { cfg, runs: runs.runs };
      } catch { shell.meta = shell.meta || null; }
      apis.queue?.renderStrip();
    },
    select: id => tabEl.select(id),
    setPending(n) {
      tabEl?.setBadge('queue', n || 0);
      ctx.store?.update?.('counters', c => ({ ...(c || {}), newsPending: n || 0 }));
    },
    setCounts(counts = {}) { shell.counts = counts; shell.setPending(counts.draft || 0); apis.queue?.setCounts(counts); },
    markStale(...tabs) { for (const t of tabs) if (t !== active) stale.add(t); },
    gone(item, kind) {
      apis.queue?.remove(item.id);
      const title = truncate(titleOf(item), 50);
      if (kind === 'published') {
        toast(`${T.published}: «${title}»`, { action: publicPath(item) ? { label: `${T.act.view} ↗`, onClick: () => openPublic(item) } : undefined });
        shell.markStale('published');
      } else if (kind === 'rejected') {
        toast(`${T.rejected}: «${title}»`, { kind: 'info', action: { label: T.act.undo, onClick: async () => { try { await api.post(`/news/items/${item.id}/restore`, {}); apis.queue?.refresh(); } catch (e) { toast.error(e.message); } } } });
      } else if (kind === 'unpublished') {
        toast(T.unpublished, { kind: 'info' });
        if (active === 'published') apis.published?.refresh();
        shell.markStale('published', 'queue');
      } else if (kind === 'restored') {
        toast(T.restored, { kind: 'info' });
        shell.markStale('queue');
      } else if (kind === 'deleted') toast(T.deleted, { kind: 'info' });
      refreshCounts();
    },
    bulkDone(action) { if (action === 'publish') shell.markStale('published'); refreshCounts(); },
    onRunDone() { shell.markStale('queue'); if (active === 'queue' && !apis.queue?.dirty) apis.queue?.refresh(); if (active === 'settings') apis.settings?.refresh?.(); },
    openFromUrl: () => openFromUrl(shell),
    async afterManual(item) {
      if (active !== 'queue') { tabEl.select('queue', { silent: true }); history.replaceState(null, '', '#/news/queue'); await activate('queue'); }
      const q = apis.queue;
      if (q && !q.dirty) await q.showDrafts();
      if (!q?.focus(item.id)) shell.openItem(item.id);
    },
    async openItem(id) {
      if (active === 'queue' && apis.queue?.focus(id)) return;
      let r;
      try { r = await api.get(`/news/items/${id}`); } catch (e) { toast.error(e.status === 404 ? T.notFound : e.message); return; }
      if (!shell.alive) return;
      let allowClose = false;
      let d;
      const c = reviewCard(r.item, {
        inDrawer: true,
        aiEnabled: () => !!shell.meta?.cfg?.openai_configured,
        onGone: (item, kind) => { allowClose = true; d.close('done'); shell.gone(item, kind); },
        onUpdated: () => { if (r.item.status === 'published') { if (active === 'published') apis.published?.refresh(); } else shell.markStale('queue'); },
      });
      d = drawer({
        title: T.editTitle(id), wide: true, body: c.el,
        beforeClose: res => guardClose(c.form, res, () => allowClose, () => { allowClose = true; d.close('discard'); }),
        onClose: () => { c.destroy(); drawers.delete(d); if (shell.alive) history.replaceState(null, '', `#/news/${active}`); },
      });
      drawers.add(d);
      d.open();
      history.replaceState(null, '', `#/news/${active}/${id}`);
    },
    remount: async id => { mounted.delete(id); apis[id]?.cleanup?.(); panels[id].replaceChildren(); await activate(id); },
  };
  async function refreshCounts() {
    try { const r = await api.get('/news/items?status=draft&page=1'); shell.setCounts(r.counts); } catch { /* badge only */ }
  }

  async function activate(id) {
    active = id;
    if (!mounted.has(id)) {
      mounted.add(id);
      panels[id].replaceChildren(skeleton({ kind: 'lines' }));
      apis[id] = await MOUNTS[id](panels[id], ctx, shell);
      stale.delete(id);
    } else if (stale.has(id)) {
      stale.delete(id);
      await apis[id]?.refresh?.();
    }
  }

  const header = pageHeader({
    eyebrow: T.eyebrow, title: T.title, subtitle: T.subtitle,
    actions: [
      extLink('/fa/news', T.viewSite, { class: 'a-btn a-btn--ghost' }),
      h('button.a-btn.a-btn--primary', { type: 'button', onclick: () => openFromUrl(shell) }, icon('link'), T.fromUrl),
    ],
  });
  const tabEl = tabs({
    active: start,
    items: TABS.map(t => ({ id: t, label: T.tabs[t], icon: { queue: 'inbox', published: 'check-circle', sources: 'globe', settings: 'settings' }[t], panel: panels[t] })),
    onChange: id => { history.replaceState(null, '', `#/news/${id}`); activate(id); },
  });
  root.append(header, tabEl);

  await shell.loadMeta();
  await activate(start);
  if (deepId) shell.openItem(deepId);

  return () => {
    shell.alive = false;
    for (const d of [...drawers]) d.close('force');
    for (const a of Object.values(apis)) a?.cleanup?.();
    for (const f of [...liveForms]) { f.destroy(); liveForms.delete(f); }
  };
}

export default {
  title: T.title,
  mount,
  isDirty() { return [...liveForms].some(f => f.isDirty()); },
};
