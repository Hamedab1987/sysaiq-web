// Seed the DB from the existing static content model (src/content.py values)
// so the dynamic site starts identical to what's live, then the admin can
// edit from there. Idempotent: only seeds when tables are empty.
import { db, setSetting } from './db.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const SETTINGS = {
  hero_h1:      { en: "I don't just build websites", fa: 'من فقط وب‌سایت نمی‌سازم' },
  hero_note_l:  { en: 'AI & software developer — websites · custom apps · automation · accounting & trading systems.',
                  fa: 'AI & Software Developer — وب‌سایت · اپ اختصاصی · اتوماسیون · سیستم‌های حسابداری و معاملاتی.' },
  hero_note_r:  { en: 'I design and build intelligent digital systems — software, AI, automation, data and modern interfaces, combined into one living whole and shaped around your actual problem.',
                  fa: 'برای کسب‌وکارها سیستم‌های دیجیتال هوشمند می‌سازم؛ ترکیبی از نرم‌افزار، AI، اتوماسیون، داده و طراحی — از وب‌سایت اختصاصی تا AI Agent و سیستم‌های پیچیده‌تر، بر اساس مسئله‌ی واقعی شما.' },
  contact_email:{ en: 'hello@sysaiq.com', fa: 'hello@sysaiq.com' },
  about_1:      { en: 'SysaiQ is a one-person systems lab. I design and build intelligent digital systems that combine software, AI, automation, data and modern interfaces — from custom websites and apps to AI agents and automated workflows.',
                  fa: 'SysaiQ یک لابراتوار سیستم‌سازیِ تک‌نفره است. سیستم‌های دیجیتال هوشمند طراحی و پیاده‌سازی می‌کنم؛ ترکیبی از نرم‌افزار، AI، اتوماسیون، داده و رابط‌های مدرن — از وب‌سایت و اپ اختصاصی تا AI Agent و فرایندهای خودکار.' },
  about_2:      { en: 'Every build starts from the actual business problem, not a template: accounting and trading systems, process automation, integrations between the tools you already use — engineered end to end.',
                  fa: 'هر پروژه از مسئله‌ی واقعی کسب‌وکار شروع می‌شود، نه از قالب آماده: سیستم حسابداری و معاملاتی، اتوماسیون فرایندها، و اتصال ابزارهایی که همین حالا استفاده می‌کنید — مهندسی‌شده از ابتدا تا انتها.' },
};

// Rich demo projects loaded from data-projects.json (bilingual detail copy),
// mapped to their generated UI cover images (EN + FA, trading is EN-only).
const RICH = JSON.parse(readFileSync(join(__dirname, '..', 'data-projects.json'), 'utf8'));
const META = {
  restaurant: { title_en:'Restaurant Operations Platform', title_fa:'پلتفرم مدیریت رستوران',
    tags:'OPERATIONS · REAL-TIME · MULTI-BRANCH', img:'restaurant', sort:1 },
  realestate: { title_en:'Real-Estate Agency CRM', title_fa:'CRM آژانس املاک',
    tags:'CRM · AI MATCHING · MAP', img:'realestate', sort:2 },
  medical:    { title_en:'Clinic Patient Management', title_fa:'مدیریت بیماران کلینیک',
    tags:'HEALTHCARE · TELEMEDICINE · AI', img:'medical', sort:3 },
  trading:    { title_en:'AI Trading Terminal', title_fa:'ترمینال معاملاتی AI',
    tags:'QUANT · AI SIGNALS · BACKTESTING', img:'trading', sort:4 },
  ecommerce:  { title_en:'E-commerce Store Admin', title_fa:'پنل فروشگاه اینترنتی',
    tags:'E-COMMERCE · ANALYTICS · AI', img:'ecommerce', sort:5 },
  accounting: { title_en:'Business Accounting Suite', title_fa:'سیستم حسابداری کسب‌وکار',
    tags:'ACCOUNTING · LEDGER · PAYROLL', img:'accounting', sort:6 },
  pos:        { title_en:'Retail POS & Inventory', title_fa:'پوز فروشگاهی و انبار',
    tags:'POS · INVENTORY · RETAIL', img:'pos', sort:7 },
  salon:      { title_en:'Salon & Booking Platform', title_fa:'رزرو و مدیریت سالن',
    tags:'BOOKING · SERVICES · SMS', img:'salon', sort:8 },
  distribution:{ title_en:'Distribution & Field Sales', title_fa:'پخش مویرگی و فروش میدانی',
    tags:'DISTRIBUTION · ROUTES · B2B', img:'distribution', sort:9 },
  'law-landing': { title_en:'Law Firm Website', title_fa:'وب‌سایت دفتر وکالت',
    tags:'LANDING · LEGAL · BOOKING', img:'law-landing', sort:10 },
  'dental-landing': { title_en:'Dental Clinic Website', title_fa:'وب‌سایت کلینیک دندان‌پزشکی',
    tags:'LANDING · MEDICAL · BOOKING', img:'dental-landing', sort:11 },
  'fitness-landing': { title_en:'Gym & Fitness Website', title_fa:'وب‌سایت باشگاه ورزشی',
    tags:'LANDING · FITNESS · MEMBERSHIP', img:'fitness-landing', sort:12 },
  'cafe-landing': { title_en:'Café & Restaurant Website', title_fa:'وب‌سایت کافه و رستوران',
    tags:'LANDING · MENU · RESERVATION', img:'cafe-landing', sort:13 },
  'architect-landing': { title_en:'Architecture Studio Website', title_fa:'وب‌سایت استودیو معماری',
    tags:'LANDING · PORTFOLIO · LUXE', img:'architect-landing', sort:14 },
  hotel:  { title_en:'Hotel Management System', title_fa:'سیستم مدیریت هتل',
    tags:'HOTEL · RESERVATION · PMS', img:'hotel', sort:15 },
  school: { title_en:'Institute Management System', title_fa:'سیستم مدیریت آموزشگاه',
    tags:'EDUCATION · PORTAL · TUITION', img:'school', sort:16 },
  hr:     { title_en:'HR & Payroll System', title_fa:'سیستم منابع انسانی و حقوق',
    tags:'HR · PAYROLL · ATTENDANCE', img:'hr', sort:17 },
};
// projects that have a Persian UI image; all others fall back to the EN
// image on the fa detail page until the user supplies a localized one
const HAS_FA_IMG = new Set([
  'restaurant', 'realestate', 'medical', 'ecommerce',
  'accounting', 'pos', 'salon', 'distribution',
]);

const PROJECTS = RICH.map(p => {
  const m = META[p.key];
  const faCover = HAS_FA_IMG.has(p.key)
    ? `/assets/projects/${m.img}-fa-full.jpg`
    : `/assets/projects/${m.img}-full.jpg`;
  return {
    slug: p.key, title_en: m.title_en, title_fa: m.title_fa, tags: m.tags, sort: m.sort,
    image: `/assets/projects/${m.img}-cover.jpg`,
    cover_en: `/assets/projects/${m.img}-full.jpg`,
    cover_fa: faCover,
    desc_en: p.tagline_en, desc_fa: p.tagline_fa,
    tagline_en: p.tagline_en, tagline_fa: p.tagline_fa,
    overview_en: p.overview_en, overview_fa: p.overview_fa,
    industries: JSON.stringify((p.industries_en || []).map((en, i) => ({ en, fa: (p.industries_fa || [])[i] || en }))),
    features: JSON.stringify(p.features || []),
    pages: JSON.stringify(p.pages || []),
  };
});

const FAQS = [
  { q_en:'WHAT EXACTLY IS SYSAIQ?', q_fa:'SysaiQ دقیقاً چیست؟',
    a_en:'A systems lab run by one engineer. I build intelligent digital systems — websites, custom apps, AI agents, automation and trading & accounting systems — designed around your actual problem, not a template.',
    a_fa:'یک لابراتوار سیستم‌سازی که یک مهندس آن را اداره می‌کند. سیستم‌های دیجیتال هوشمند می‌سازم — وب‌سایت، اپ اختصاصی، AI Agent، اتوماسیون و سیستم‌های معاملاتی و حسابداری — بر اساس مسئله‌ی واقعی شما، نه قالب آماده.', sort:1 },
  { q_en:'CAN AI WORK WITH MY EXISTING TOOLS?', q_fa:'آیا AI با ابزارهای فعلی من کار می‌کند؟',
    a_en:'Yes. AI agents and automations connect to the systems you already run — spreadsheets, CRMs, accounting software, APIs and databases — through clean integrations, so nothing has to be replaced to get smarter.',
    a_fa:'بله. AI Agent و اتوماسیون‌ها به سیستم‌هایی که همین حالا دارید وصل می‌شوند — اکسل و Google Sheets، CRM، نرم‌افزار حسابداری، API و دیتابیس — با اتصال‌های تمیز؛ لازم نیست چیزی را کنار بگذارید تا سیستم‌تان هوشمندتر شود.', sort:2 },
  { q_en:'DO YOU BUILD TRADING AND ACCOUNTING SYSTEMS?', q_fa:'سیستم معاملاتی و حسابداری هم می‌سازید؟',
    a_en:'Yes — a core specialty. Backtesting and execution tools for traders, and accounting systems that reconcile, report and automate the numbers your business runs on.',
    a_fa:'بله — تخصص اصلی من است. ابزارهای Backtesting و اجرای معاملات برای تریدرها، و سیستم‌های حسابداری که مغایرت‌گیری، گزارش‌گیری و به‌روز نگه‌داشتن اعداد کسب‌وکارتان را خودکار می‌کنند.', sort:3 },
  { q_en:'HOW DO WE START?', q_fa:'از کجا شروع کنیم؟',
    a_en:'Send a short note about your business and the problem you want solved. You get a plain-language proposal — scope, timeline and budget — before any commitment.',
    a_fa:'چند خط درباره‌ی کسب‌وکارتان و مشکلی که می‌خواهید حل شود بفرستید. قبل از هر تعهدی، یک پیشنهاد شفاف می‌گیرید — محدوده‌ی کار، زمان‌بندی و بودجه.', sort:4 },
];

const KNOWLEDGE = [
  { title:'About SysaiQ', tags:'about',
    body_en:'SysaiQ (sysaiq.com) is a one-person AI & software lab founded by Hamed. It builds custom websites, applications, AI agents, workflow automation, and accounting & trading systems. Remote-first, working with founders, businesses and traders worldwide.',
    body_fa:'SysaiQ یک لابراتوار نرم‌افزار و هوش مصنوعی تک‌نفره است که حامد آن را اداره می‌کند. وب‌سایت اختصاصی، اپلیکیشن، AI Agent، اتوماسیون فرایندها و سیستم‌های حسابداری و معاملاتی می‌سازد. دورکار، برای کسب‌وکارها و تریدرها در سراسر دنیا.' },
  { title:'Services', tags:'services',
    body_en:'Core services: (1) Custom websites & web platforms, bilingual. (2) AI agents & LLM apps with RAG over your documents. (3) Workflow automation connecting your existing tools via APIs. (4) Quant/trading systems: backtesting, signals, execution. (5) Accounting systems: reconciliation, reporting, automation.',
    body_fa:'خدمات اصلی: (۱) وب‌سایت و پلتفرم اختصاصی دوزبانه. (۲) AI Agent و اپ‌های LLM با RAG روی اسناد شما. (۳) اتوماسیون فرایند با اتصال ابزارهای فعلی از طریق API. (۴) سیستم‌های Quant/معاملاتی: Backtesting، سیگنال، اجرا. (۵) سیستم حسابداری: مغایرت‌گیری، گزارش، اتوماسیون.' },
  { title:'How to start a project', tags:'contact,process',
    body_en:'Email hello@sysaiq.com or use the contact form with your name, email and a short description of the problem. You receive a plain-language proposal (scope, timeline, budget) before any commitment.',
    body_fa:'به hello@sysaiq.com ایمیل بزنید یا فرم تماس را با نام، ایمیل و توضیح کوتاه پروژه پر کنید. قبل از هر تعهدی یک پیشنهاد شفاف (محدوده، زمان‌بندی، بودجه) دریافت می‌کنید.' },
];

if (db.prepare('SELECT COUNT(*) c FROM settings').get().c === 0) {
  for (const [k, v] of Object.entries(SETTINGS)) setSetting(k, v);
  console.log(`[seed] ${Object.keys(SETTINGS).length} settings`);
}
if (db.prepare('SELECT COUNT(*) c FROM projects').get().c === 0) {
  const stmt = db.prepare(`INSERT INTO projects
    (slug,title_en,title_fa,desc_en,desc_fa,tags,image,cover_en,cover_fa,
     tagline_en,tagline_fa,overview_en,overview_fa,industries,features,pages,sort,published)
    VALUES (@slug,@title_en,@title_fa,@desc_en,@desc_fa,@tags,@image,@cover_en,@cover_fa,
     @tagline_en,@tagline_fa,@overview_en,@overview_fa,@industries,@features,@pages,@sort,1)`);
  for (const p of PROJECTS) stmt.run(p);
  console.log(`[seed] ${PROJECTS.length} rich projects`);
}
if (db.prepare('SELECT COUNT(*) c FROM faqs').get().c === 0) {
  const stmt = db.prepare(`INSERT INTO faqs (q_en,q_fa,a_en,a_fa,sort,published) VALUES (@q_en,@q_fa,@a_en,@a_fa,@sort,1)`);
  for (const f of FAQS) stmt.run(f);
  console.log(`[seed] ${FAQS.length} faqs`);
}
if (db.prepare('SELECT COUNT(*) c FROM knowledge').get().c === 0) {
  const stmt = db.prepare(`INSERT INTO knowledge (title,body_en,body_fa,tags,enabled) VALUES (@title,@body_en,@body_fa,@tags,1)`);
  for (const k of KNOWLEDGE) stmt.run(k);
  console.log(`[seed] ${KNOWLEDGE.length} knowledge entries`);
}
console.log('[seed] done');
process.exit(0);
