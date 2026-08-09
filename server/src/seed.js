// Seed the DB from the existing static content model (src/content.py values)
// so the dynamic site starts identical to what's live, then the admin can
// edit from there. Idempotent: only seeds when tables are empty.
import { db, setSetting } from './db.js';

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

const PROJECTS = [
  { slug:'ai-trading', title_en:'AI Trading Assistant', title_fa:'دستیار معاملاتی AI',
    desc_en:'Signal engine and backtesting stack for a futures trader — strategy research, execution alerts and risk guards in one pipeline.',
    desc_fa:'موتور سیگنال و Backtesting برای معامله‌گر فیوچرز — تحقیق استراتژی، هشدار اجرا و کنترل ریسک در یک پایپ‌لاین.',
    tags:'QUANT · PYTHON · BACKTESTING', image:'/assets/projects/p1.jpg', sort:1 },
  { slug:'automation', title_en:'Business Automation Suite', title_fa:'اتوماسیون کسب‌وکار',
    desc_en:'Order-to-books automation for a retail business — orders, invoices and inventory flow into accounting without a single manual entry.',
    desc_fa:'اتوماسیون «از سفارش تا دفاتر» برای خرده‌فروشی — سفارش، فاکتور و موجودی بدون حتی یک ثبت دستی به حسابداری می‌رسند.',
    tags:'AUTOMATION · API · ACCOUNTING', image:'/assets/projects/p2.jpg', sort:2 },
  { slug:'ai-agent', title_en:'AI Customer Agent', title_fa:'ایجنت هوشمند مشتری',
    desc_en:"RAG-powered assistant trained on the business's own documents — answers customers in Persian and English, and hands off to a human exactly when it should.",
    desc_fa:'دستیار مبتنی بر RAG، آموزش‌دیده روی اسناد خود کسب‌وکار — به فارسی و انگلیسی پاسخ می‌دهد و درست به‌موقع به انسان واگذار می‌کند.',
    tags:'AI AGENT · RAG · LLM', image:'/assets/projects/p3.jpg', sort:3 },
  { slug:'accounting', title_en:'Accounting Dashboard', title_fa:'داشبورد حسابداری',
    desc_en:'Live reconciliation and reporting — every account tied out daily, anomalies flagged before they become month-end surprises.',
    desc_fa:'مغایرت‌گیری و گزارش زنده — همه‌ی حساب‌ها هر روز تراز می‌شوند و موارد مشکوک قبل از اینکه سورپرایز پایان ماه شوند پرچم می‌خورند.',
    tags:'DASHBOARD · DATA · FINANCE', image:'/assets/projects/p4.jpg', sort:4 },
  { slug:'web-platform', title_en:'Custom Web Platform', title_fa:'پلتفرم وب اختصاصی',
    desc_en:'A fast, bilingual web platform designed from the actual workflow of the business — not a template bent out of shape.',
    desc_fa:'پلتفرم وب سریع و دوزبانه که از دل فرایند واقعی کسب‌وکار طراحی شده — نه قالب آماده‌ای که به‌زور تغییر شکل داده باشد.',
    tags:'WEB · UX · BILINGUAL', image:'/assets/projects/p5.jpg', sort:5 },
];

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
  const stmt = db.prepare(`INSERT INTO projects (slug,title_en,title_fa,desc_en,desc_fa,tags,image,sort,published)
    VALUES (@slug,@title_en,@title_fa,@desc_en,@desc_fa,@tags,@image,@sort,1)`);
  for (const p of PROJECTS) stmt.run(p);
  console.log(`[seed] ${PROJECTS.length} projects`);
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
