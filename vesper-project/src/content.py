# SysAIQ bilingual content model.
# Every key maps to {'en': ..., 'fa': ...}. build.py substitutes {{KEY}}
# tokens in src/vesper.src.html once per language. A missing token or a
# missing key fails the build loudly — the two languages can never drift
# structurally.
#
# Persian copy is written natively (not translated); technical terms
# (AI, Agent, RAG, LLM, Automation…) stay in English per brand rules.
#
# STRINGS holds the copy. META (bottom of this file) describes every key for
# the admin panel and the Node renderer: group, labels, plain|inline, max
# length, anchor, page order and where the key is consumed at runtime
# (a {{TOKEN}} in server/templates/home.<lang>.html, or a slot that the
# renderer fills from the database). build.py asserts STRINGS ⟷ META both ways.

STRINGS = {
    # ---------- <head> ----------
    "TITLE": {
        "en": "SysaiQ — Intelligent Digital Systems",
        "fa": "SysaiQ — سیستم‌های دیجیتال هوشمند",
    },
    "META_DESC": {
        "en": "AI & software lab building intelligent digital systems — "
              "custom websites, apps, AI agents, automation, and accounting "
              "& trading systems, designed around your actual business problem.",
        "fa": "لابراتوار نرم‌افزار و AI — طراحی و ساخت وب‌سایت اختصاصی، اپلیکیشن، "
              "AI Agent، اتوماسیون و سیستم‌های حسابداری و معاملاتی؛ "
              "بر پایهٔ مسئلهٔ واقعی کسب‌وکار شما.",
    },

    # ---------- header nav ----------
    "NAV_HOME":    {"en": "Home",         "fa": "خانه"},
    "NAV_WORK":    {"en": "Work",         "fa": "پروژه‌ها"},
    "NAV_CAP":     {"en": "Capabilities", "fa": "توانمندی‌ها"},
    "NAV_ABOUT":   {"en": "About",        "fa": "درباره"},
    "NAV_FAQ":     {"en": "FAQ",          "fa": "سؤالات"},
    "NAV_CTA":     {"en": "Start a Project", "fa": "شروع پروژه"},
    "NAV_CONTACT": {"en": "Contact",      "fa": "تماس"},
    # accessible name of the hamburger button (mobile only, ≤ 900px)
    "NAV_MENU":    {"en": "Menu",         "fa": "منو"},

    # ---------- hero (orb) ----------
    "HERO_H1": {
        "en": "I don&rsquo;t just<br>build websites",
        "fa": "من فقط وب‌سایت<br>نمی‌سازم",
    },
    "HERO_NOTE_L": {
        "en": "AI &amp; software developer — websites · custom apps · "
              "automation · accounting &amp; trading systems.",
        "fa": "AI &amp; Software Developer — وب‌سایت · اپ اختصاصی · "
              "اتوماسیون · سیستم‌های حسابداری و معاملاتی.",
    },
    "HERO_NOTE_R": {
        "en": "I design and build intelligent digital systems — software, AI, "
              "automation, data and modern interfaces, combined into one "
              "living whole and shaped around your actual problem.",
        "fa": "برای کسب‌وکارها سیستم‌های دیجیتال هوشمند می‌سازم؛ ترکیبی از "
              "نرم‌افزار، AI، اتوماسیون، داده و طراحی — از وب‌سایت اختصاصی تا "
              "AI Agent و سیستم‌های پیچیده‌تر، بر اساس مسئلهٔ واقعی شما.",
    },
    "TAG1": {"en": "[ AI Agents ]",  "fa": "[ AI Agent ]"},
    "TAG2": {"en": "[ Automation ]", "fa": "[ اتوماسیون ]"},
    "TAG3": {"en": "[ Custom Apps ]","fa": "[ اپ اختصاصی ]"},
    "CTA_PRIMARY": {"en": "Start a Project", "fa": "شروع پروژه"},

    # ---------- capabilities (galaxy) ----------
    "PRESENCE_H2": {
        "en": "Software. AI. Automation.<br>One connected system",
        "fa": "نرم‌افزار. AI. اتوماسیون.<br>یک سیستمِ به‌هم‌پیوسته",
    },
    "PRESENCE_CAP": {
        "en": "Each capability feeds the next — the website talks to the "
              "AI agent, the agent drives the automation, the automation "
              "keeps the books current.",
        "fa": "هر توانمندی به بعدی وصل است — وب‌سایت با AI Agent حرف می‌زند، "
              "Agent اتوماسیون را جلو می‌برد و اتوماسیون حساب‌ها را "
              "به‌روز نگه می‌دارد.",
    },
    "STAT1_S": {"en": "Agents · LLM apps · RAG",       "fa": "Agent · LLM · RAG"},
    "STAT2_S": {"en": "Websites &amp; custom apps",    "fa": "وب‌سایت و اپ اختصاصی"},
    "STAT3_S": {"en": "Workflow automation",           "fa": "اتوماسیون فرایندها"},
    "STAT4_S": {"en": "Trading &amp; accounting systems", "fa": "سیستم معاملاتی و حسابداری"},

    # ---------- reach (earth) ----------
    "TERRA_H2": {
        "en": "Built once,<br>running everywhere",
        "fa": "یک‌بار ساخته می‌شود،<br>همه‌جا کار می‌کند",
    },
    "TERRA_TEXT": {
        "en": "Remote-first and production-minded: systems shipped for "
              "founders, businesses and traders across time zones — "
              "monitored, automated, awake while you sleep.",
        "fa": "دورکار و آمادهٔ production: سیستم‌هایی که برای کسب‌وکارها و "
              "تریدرها در نقاط مختلف دنیا ساخته شده‌اند — مانیتورشده و "
              "خودکار؛ حتی وقتی شما خواب هستید.",
    },

    # ---------- mind (SysAIQ letters) ----------
    "MIND_H2": {
        "en": "From software,<br>a mind",
        "fa": "از نرم‌افزار،<br>یک ذهن",
    },
    "MIND_CAP": {
        "en": "Ninety-one thousand particles align into one name — software, "
              "AI and automation admitting they were one system all along.",
        "fa": "نودویک‌هزار ذره در یک نام هم‌راستا می‌شوند — نرم‌افزار، AI و "
              "اتوماسیون؛ از اول هم یک سیستم بودند.",
    },

    # ---------- about (light) ----------
    "LIVING_H2": {"en": "What I build", "fa": "چه می‌سازم"},
    "FEAT1": {
        "en": "SysaiQ is a one-person systems lab. I design and build "
              "intelligent digital systems that combine software, AI, "
              "automation, data and modern interfaces — from custom websites "
              "and apps to AI agents and automated workflows.",
        "fa": "SysaiQ یک لابراتوار سیستم‌سازیِ تک‌نفره است. سیستم‌های دیجیتال "
              "هوشمند طراحی و پیاده‌سازی می‌کنم؛ ترکیبی از نرم‌افزار، AI، "
              "اتوماسیون، داده و رابط‌های مدرن — از وب‌سایت و اپ اختصاصی تا "
              "AI Agent و فرایندهای خودکار.",
    },
    "FEAT2": {
        "en": "Every build starts from the actual business problem, not a "
              "template: accounting and trading systems, process automation, "
              "integrations between the tools you already use — engineered "
              "end to end.",
        "fa": "هر پروژه از مسئلهٔ واقعی کسب‌وکار شروع می‌شود، نه از قالب آماده: "
              "سیستم حسابداری و معاملاتی، اتوماسیون فرایندها، و اتصال "
              "ابزارهایی که همین حالا استفاده می‌کنید — مهندسی‌شده از ابتدا "
              "تا انتها.",
    },

    # ---------- work / selected projects (light, slider) ----------
    "WORK_H2":   {"en": "Selected work", "fa": "نمونه‌کارها"},
    "WORK_HINT": {"en": "Hover to preview · click to open",
                  "fa": "اشاره برای پیش‌نمایش · کلیک برای باز کردن"},
    "WORK_ALL":  {"en": "View all projects", "fa": "مشاهدهٔ همهٔ پروژه‌ها"},

    "W1_T": {"en": "Restaurant Operations Platform", "fa": "پلتفرم مدیریت رستوران"},
    "W1_D": {
        "en": "Live orders on a map, kitchen queue, and sales-by-branch "
              "analytics — one control room for a multi-branch chain.",
        "fa": "سفارش زنده روی نقشه، صف آشپزخانه و آنالیز فروش هر شعبه — یک "
              "اتاق کنترل برای زنجیرهٔ چندشعبه‌ای.",
    },
    "W1_G": {"en": "OPERATIONS · REAL-TIME · MULTI-BRANCH",
             "fa": "OPERATIONS · REAL-TIME · MULTI-BRANCH"},

    "W2_T": {"en": "Real-Estate Agency CRM", "fa": "CRM آژانس املاک"},
    "W2_D": {
        "en": "AI matches buyers to listings, a map-first pipeline, and live "
              "deal-value forecasting for real-estate teams.",
        "fa": "matching هوشمند خریدار به ملک، pipeline مبتنی بر نقشه و "
              "پیش‌بینی زندهٔ ارزش معامله برای تیم‌های املاک.",
    },
    "W2_G": {"en": "CRM · AI MATCHING · MAP",
             "fa": "CRM · AI MATCHING · MAP"},

    "W3_T": {"en": "Clinic Patient Management", "fa": "مدیریت بیماران کلینیک"},
    "W3_D": {
        "en": "Appointments, records, telemedicine and prescriptions in one "
              "flow — with AI notes and prescription safety checks.",
        "fa": "نوبت، پرونده، telemedicine و نسخه در یک جریان — با یادداشت AI "
              "و کنترل ایمنی نسخه.",
    },
    "W3_G": {"en": "HEALTHCARE · TELEMEDICINE · AI",
             "fa": "HEALTHCARE · TELEMEDICINE · AI"},

    "W4_T": {"en": "AI Trading Terminal", "fa": "ترمینال معاملاتی AI"},
    "W4_D": {
        "en": "Live charts, order book and an AI signal engine that shows "
              "its reasoning — with backtesting before real capital.",
        "fa": "chart زنده، order book و AI signal engine که استدلالش را نشان "
              "می‌دهد — با backtesting پیش از سرمایهٔ واقعی.",
    },
    "W4_G": {"en": "QUANT · AI SIGNALS · BACKTESTING",
             "fa": "QUANT · AI SIGNALS · BACKTESTING"},

    "W5_T": {"en": "E-commerce Store Admin", "fa": "پنل فروشگاه اینترنتی"},
    "W5_D": {
        "en": "Catalog, orders, inventory and campaigns in one admin — with "
              "size-curve stock and margin-true analytics.",
        "fa": "کاتالوگ، سفارش، موجودی و کمپین در یک پنل — با موجودی مبتنی بر "
              "سایز و آنالیتیکس سود واقعی.",
    },
    "W5_G": {"en": "E-COMMERCE · ANALYTICS · AI",
             "fa": "E-COMMERCE · ANALYTICS · AI"},

    "W6_T": {"en": "Business Accounting Suite", "fa": "سیستم حسابداری کسب‌وکار"},
    "W6_D": {
        "en": "Upload an invoice photo — a master agent routes every entry "
              "to a specialist AI agent. No typing, months of audit work "
              "in minutes, reports always print-ready.",
        "fa": "عکس فاکتور را آپلود کنید — Master Agent هر ثبت را به یک "
              "ایجنت متخصص می‌سپارد. بدون تایپ، کار ماه‌ها حسابرسی در چند "
              "دقیقه، گزارش‌ها همیشه آمادهٔ چاپ.",
    },
    "W6_G": {"en": "ACCOUNTING · LEDGER · PAYROLL",
             "fa": "ACCOUNTING · LEDGER · PAYROLL"},

    "W7_T": {"en": "Retail POS & Inventory", "fa": "پوز فروشگاهی و انبار"},
    "W7_D": {
        "en": "Touch POS with barcode, multi-branch inventory and a customer "
              "club — built for real shops and trade businesses.",
        "fa": "صندوق لمسی با بارکد، انبار چندشعبه و باشگاه مشتری — "
              "ساخته‌شده برای مغازه‌ها و اصناف واقعی.",
    },
    "W7_G": {"en": "POS · INVENTORY · RETAIL",
             "fa": "POS · INVENTORY · RETAIL"},

    "W8_T": {"en": "Salon & Booking Platform", "fa": "رزرو و مدیریت سالن"},
    "W8_D": {
        "en": "Online booking, staff commissions and SMS reminders for "
              "appointment-based businesses.",
        "fa": "رزرو آنلاین، کمیسیون پرسنل و یادآور پیامکی برای "
              "کسب‌وکارهای نوبتی.",
    },
    "W8_G": {"en": "BOOKING · SERVICES · SMS",
             "fa": "BOOKING · SERVICES · SMS"},

    "W9_T": {"en": "Distribution & Field Sales", "fa": "پخش مویرگی و فروش میدانی"},
    "W9_D": {
        "en": "Mobile order-taking, smart delivery routes and credit control "
              "for distribution teams.",
        "fa": "سفارش‌گیری موبایل، مسیر توزیع هوشمند و کنترل اعتبار برای "
              "تیم‌های پخش.",
    },
    "W9_G": {"en": "DISTRIBUTION · ROUTES · B2B",
             "fa": "DISTRIBUTION · ROUTES · B2B"},

    # ---------- FAQ (light) ----------
    "FAQ_H2": {"en": "Frequently asked", "fa": "سؤالات پرتکرار"},
    "Q1": {"en": "WHAT EXACTLY IS SYSAIQ?", "fa": "SysaiQ دقیقاً چیست؟"},
    "A1": {
        "en": "A systems lab run by one engineer. I build intelligent digital "
              "systems — websites, custom apps, AI agents, automation and "
              "trading &amp; accounting systems — designed around your actual "
              "problem, not a template.",
        "fa": "یک لابراتوار سیستم‌سازی که یک مهندس آن را اداره می‌کند. "
              "سیستم‌های دیجیتال هوشمند می‌سازم — وب‌سایت، اپ اختصاصی، "
              "AI Agent، اتوماسیون و سیستم‌های معاملاتی و حسابداری — بر اساس "
              "مسئلهٔ واقعی شما، نه قالب آماده.",
    },
    "Q2": {"en": "CAN AI WORK WITH MY EXISTING TOOLS?",
           "fa": "آیا AI با ابزارهای فعلی من کار می‌کند؟"},
    "A2": {
        "en": "Yes. AI agents and automations connect to the systems you "
              "already run — spreadsheets, CRMs, accounting software, APIs "
              "and databases — through clean integrations, so nothing has to "
              "be replaced to get smarter.",
        "fa": "بله. AI Agent و اتوماسیون‌ها به سیستم‌هایی که همین حالا دارید "
              "وصل می‌شوند — اکسل و Google Sheets، CRM، نرم‌افزار حسابداری، "
              "API و دیتابیس — با اتصال‌های تمیز؛ لازم نیست چیزی را کنار "
              "بگذارید تا سیستم‌تان هوشمندتر شود.",
    },
    "Q3": {"en": "DO YOU BUILD TRADING AND ACCOUNTING SYSTEMS?",
           "fa": "سیستم معاملاتی و حسابداری هم می‌سازید؟"},
    "A3": {
        "en": "Yes — a core specialty. Backtesting and execution tools for "
              "traders, and accounting systems that reconcile, report and "
              "automate the numbers your business runs on.",
        "fa": "بله — تخصص اصلی من است. ابزارهای Backtesting و اجرای معاملات "
              "برای تریدرها، و سیستم‌های حسابداری که مغایرت‌گیری، گزارش‌گیری "
              "و به‌روز نگه‌داشتن اعداد کسب‌وکارتان را خودکار می‌کنند.",
    },
    "Q4": {"en": "HOW DO WE START?", "fa": "از کجا شروع کنیم؟"},
    "A4": {
        "en": "Send a short note about your business and the problem you want "
              "solved. You get a plain-language proposal — scope, timeline "
              "and budget — before any commitment.",
        "fa": "چند خط دربارهٔ کسب‌وکارتان و مشکلی که می‌خواهید حل شود "
              "بفرستید. قبل از هر تعهدی، یک پیشنهاد شفاف می‌گیرید — محدودهٔ "
              "کار، زمان‌بندی و بودجه.",
    },

    # ---------- contact ----------
    "CONTACT_H2": {
        "en": "Let&rsquo;s build your<br><em>system</em>",
        "fa": "بیایید سیستمِ شما را<br><em>بسازیم</em>",
    },
    "CONTACT_BTN": {"en": "Contact Me", "fa": "تماس با من"},

    # ---------- footer ----------
    "FOOT_C":   {"en": "© 2026 SysaiQ · Hamed Systems Lab",
                 "fa": "© ۲۰۲۶ SysaiQ · Hamed Systems Lab"},
    "FOOT_MID": {"en": "Software · AI · Automation · Quant",
                 "fa": "نرم‌افزار · AI · اتوماسیون · Quant"},

    # ---------- AI assistant widget ----------
    # Read by the page script from the <script type="application/json"
    # id="site-data"> block (SITE_DATA slot), never substituted into JS —
    # the main script stays byte-identical across languages for CSP hashing.
    "AI_TITLE":  {"en": "SysaiQ Assistant", "fa": "دستیار SysaiQ"},
    "AI_READY":  {"en": "online",           "fa": "آنلاین"},
    "AI_PH":     {"en": "Ask me anything…", "fa": "سؤالتان را بنویسید…"},
    "AI_HI": {
        "en": "Hi! I'm the SysaiQ AI assistant. Tell me what business you run "
              "and I'll show you exactly how we can grow it 👋",
        "fa": "سلام! من دستیار هوشمند SysaiQ هستم. بگویید چه کسب‌وکاری دارید تا "
              "بگویم دقیقاً چه کاری برای رشدش از دستمان برمی‌آید 👋",
    },
    "AI_TEASER": {
        "en": "Tell me your business — I'll show you the system that transforms it 👋",
        "fa": "شغل یا صنف‌تان را بگویید تا بگویم چه سیستمی کسب‌وکارتان را متحول می‌کند 👋",
    },
    "AI_ERR": {
        "en": "Could not connect. Please try again later or email hello@sysaiq.com.",
        "fa": "اتصال برقرار نشد. لطفاً بعداً دوباره امتحان کنید یا به hello@sysaiq.com ایمیل بزنید.",
    },
}

# Per-language head attributes / SEO plumbing (not copy).
LANGS = {
    "en": {
        "html_attrs": 'lang="en"',
        "canonical":  "https://sysaiq.com/en/",
        "alt_fa":     "https://sysaiq.com/fa/",
        "alt_en":     "https://sysaiq.com/en/",
        "og_locale":  "en_US",
    },
    "fa": {
        "html_attrs": 'lang="fa" dir="rtl"',
        "canonical":  "https://sysaiq.com/fa/",
        "alt_fa":     "https://sysaiq.com/fa/",
        "alt_en":     "https://sysaiq.com/en/",
        "og_locale":  "fa_IR",
    },
}

# ===========================================================================
# META — one entry per STRINGS key, in page order (the admin lists them in
# this order, grouped). Fields:
#   group     Persian group name from GROUPS (page order)
#   label_fa / label_en   what the owner sees next to the field
#   type      "plain"  → renderer escapes the whole value (esc)
#             "inline" → mini-markup via lib/inline.js: "\n"→<br>, *x*→<em>,
#                        **x**→<strong>. Only for keys whose default carries
#                        <br>/<em>/entities AND that render as element text.
#                        Keys used inside attributes (TITLE, META_DESC, W*_T,
#                        NAV_MENU) must stay "plain".
#   max       hard length cap enforced by the admin API (≥ both defaults)
#   anchor    "#section-id" for the admin's «مشاهده در سایت ↗» link
#   order     page order (filled below from the dict position, multiples of 10)
#   source    filled below by source_of(): "token" = a {{KEY}} that survives
#             into the runtime template; "slot:WORK" / "slot:FAQ" = the key
#             lives inside that slot region (W*/Q*/A* rows come from the
#             projects / faqs tables, the section heading/hint/button from
#             content); "slot:CONTACT" = the contact button row;
#             "slot:SITE_DATA" = emitted inside the #site-data JSON block.
# ===========================================================================
GROUPS = [
    "سئو و متا", "منو و سربرگ", "هیرو", "توانمندی‌ها", "گستره", "ذهن",
    "چه می‌سازم", "نمونه‌کارها", "سؤالات متداول", "تماس", "پانویس",
    "دستیار گفت‌وگو",
]

# keys whose value lands inside an HTML attribute (must be "plain", no markup)
ATTR_KEYS = frozenset(["TITLE", "META_DESC", "NAV_MENU"] + [f"W{i}_T" for i in range(1, 10)])

_FA_DIGITS = str.maketrans("0123456789", "۰۱۲۳۴۵۶۷۸۹")


def _m(group, label_fa, label_en, type="plain", max=200, anchor="#hero"):
    return {"group": group, "label_fa": label_fa, "label_en": label_en,
            "type": type, "max": max, "anchor": anchor}


def _work(i):
    n, fa = str(i), str(i).translate(_FA_DIGITS)
    return {
        f"W{n}_T": _m("نمونه‌کارها", f"پروژهٔ {fa} — عنوان", f"Project {n} — title", max=80, anchor="#work"),
        f"W{n}_D": _m("نمونه‌کارها", f"پروژهٔ {fa} — توضیح", f"Project {n} — description", max=300, anchor="#work"),
        f"W{n}_G": _m("نمونه‌کارها", f"پروژهٔ {fa} — برچسب‌ها", f"Project {n} — tags", max=80, anchor="#work"),
    }


def _faq(i, a_type="plain"):
    n, fa = str(i), str(i).translate(_FA_DIGITS)
    return {
        f"Q{n}": _m("سؤالات متداول", f"سؤال {fa}", f"Question {n}", max=200, anchor="#faq"),
        f"A{n}": _m("سؤالات متداول", f"پاسخ {fa}", f"Answer {n}", type=a_type, max=1000, anchor="#faq"),
    }


META = {
    # ---------- سئو و متا ----------
    "TITLE":     _m("سئو و متا", "عنوان صفحه (تگ title)", "Page title", max=120),
    "META_DESC": _m("سئو و متا", "توضیح متا (description)", "Meta description", max=320),
    # ---------- منو و سربرگ ----------
    "NAV_HOME":    _m("منو و سربرگ", "منو: خانه", "Nav: Home", max=40),
    "NAV_CAP":     _m("منو و سربرگ", "منو: توانمندی‌ها", "Nav: Capabilities", max=40, anchor="#presence"),
    "NAV_WORK":    _m("منو و سربرگ", "منو: پروژه‌ها", "Nav: Work", max=40, anchor="#work"),
    "NAV_ABOUT":   _m("منو و سربرگ", "منو: درباره", "Nav: About", max=40, anchor="#living"),
    "NAV_FAQ":     _m("منو و سربرگ", "منو: سؤالات", "Nav: FAQ", max=40, anchor="#faq"),
    "NAV_CTA":     _m("منو و سربرگ", "دکمهٔ سربرگ (شروع پروژه)", "Header CTA button", max=40, anchor="#contact"),
    "NAV_CONTACT": _m("منو و سربرگ", "منو: تماس (پانویس)", "Nav: Contact (footer)", max=40, anchor="#contact"),
    "NAV_MENU":    _m("منو و سربرگ", "برچسب دکمهٔ منوی موبایل", "Mobile menu button label", max=40),
    # ---------- هیرو ----------
    "HERO_H1":     _m("هیرو", "تیتر اصلی", "Hero headline", type="inline", max=120),
    "HERO_NOTE_L": _m("هیرو", "یادداشت هیرو — خط فنی", "Hero note — technical line", type="inline", max=300),
    "HERO_NOTE_R": _m("هیرو", "یادداشت هیرو — معرفی", "Hero note — intro", max=400),
    "TAG1":        _m("هیرو", "برچسب ۱ هیرو", "Hero tag 1", max=40),
    "TAG2":        _m("هیرو", "برچسب ۲ هیرو", "Hero tag 2", max=40),
    "TAG3":        _m("هیرو", "برچسب ۳ هیرو", "Hero tag 3", max=40),
    "CTA_PRIMARY": _m("هیرو", "دکمهٔ اصلی هیرو", "Hero primary button", max=40),
    # ---------- توانمندی‌ها ----------
    "PRESENCE_H2":  _m("توانمندی‌ها", "تیتر توانمندی‌ها", "Capabilities headline", type="inline", max=120, anchor="#presence"),
    "PRESENCE_CAP": _m("توانمندی‌ها", "زیرنویس توانمندی‌ها", "Capabilities caption", max=300, anchor="#presence"),
    "STAT1_S":      _m("توانمندی‌ها", "کارت AI", "Stat card AI", max=60, anchor="#presence"),
    "STAT2_S":      _m("توانمندی‌ها", "کارت WEB", "Stat card WEB", type="inline", max=60, anchor="#presence"),
    "STAT3_S":      _m("توانمندی‌ها", "کارت AUTO", "Stat card AUTO", max=60, anchor="#presence"),
    "STAT4_S":      _m("توانمندی‌ها", "کارت QUANT", "Stat card QUANT", type="inline", max=60, anchor="#presence"),
    # ---------- گستره ----------
    "TERRA_H2":   _m("گستره", "تیتر گستره", "Reach headline", type="inline", max=120, anchor="#terra"),
    "TERRA_TEXT": _m("گستره", "متن گستره", "Reach text", max=400, anchor="#terra"),
    # ---------- ذهن ----------
    "MIND_H2":  _m("ذهن", "تیتر ذهن", "Mind headline", type="inline", max=120, anchor="#mind"),
    "MIND_CAP": _m("ذهن", "زیرنویس ذهن", "Mind caption", max=300, anchor="#mind"),
    # ---------- چه می‌سازم ----------
    "LIVING_H2": _m("چه می‌سازم", "تیتر «چه می‌سازم»", "About headline", max=80, anchor="#living"),
    "FEAT1":     _m("چه می‌سازم", "بند ۰۱", "Paragraph 01", max=600, anchor="#living"),
    "FEAT2":     _m("چه می‌سازم", "بند ۰۲", "Paragraph 02", max=600, anchor="#living"),
    # ---------- نمونه‌کارها ----------
    "WORK_H2":   _m("نمونه‌کارها", "تیتر نمونه‌کارها", "Work headline", max=80, anchor="#work"),
    "WORK_HINT": _m("نمونه‌کارها", "راهنمای کوتاه ویترین", "Showcase hint", max=80, anchor="#work"),
    "WORK_ALL":  _m("نمونه‌کارها", "دکمهٔ «همهٔ پروژه‌ها»", "View-all button", max=60, anchor="#work"),
    **_work(1), **_work(2), **_work(3), **_work(4), **_work(5),
    **_work(6), **_work(7), **_work(8), **_work(9),
    # ---------- سؤالات متداول ----------
    "FAQ_H2": _m("سؤالات متداول", "تیتر سؤالات متداول", "FAQ headline", max=80, anchor="#faq"),
    # only A1's default carries an entity (&amp;) → inline; the rest are plain
    **_faq(1, "inline"), **_faq(2), **_faq(3), **_faq(4),
    # ---------- تماس ----------
    "CONTACT_H2":  _m("تماس", "تیتر تماس", "Contact headline", type="inline", max=120, anchor="#contact"),
    "CONTACT_BTN": _m("تماس", "دکمهٔ تماس", "Contact button", max=40, anchor="#contact"),
    # ---------- پانویس (the footer has no id; it sits right under #contact) ----------
    "FOOT_C":   _m("پانویس", "حق نشر", "Copyright line", max=120, anchor="#contact"),
    "FOOT_MID": _m("پانویس", "خط میانی پانویس", "Footer middle line", max=120, anchor="#contact"),
    # ---------- دستیار گفت‌وگو (fixed widget, visible everywhere) ----------
    "AI_TITLE":  _m("دستیار گفت‌وگو", "نام دستیار", "Assistant name", max=60),
    "AI_READY":  _m("دستیار گفت‌وگو", "وضعیت (آنلاین)", "Status label", max=30),
    "AI_PH":     _m("دستیار گفت‌وگو", "متن راهنمای ورودی", "Input placeholder", max=80),
    "AI_HI":     _m("دستیار گفت‌وگو", "پیام خوش‌آمد", "Greeting", max=400),
    "AI_TEASER": _m("دستیار گفت‌وگو", "حباب دعوت", "Teaser bubble", max=300),
    "AI_ERR":    _m("دستیار گفت‌وگو", "پیام خطای اتصال", "Connection error", max=300),
}


def source_of(key):
    """Where the renderer takes this key from at runtime (see header).

    Keys inside a slot region never survive into the runtime template, so
    the slot renderer reads them from content (override ?? default) itself:
    WORK wraps the whole #work section (its heading, hint and button too),
    FAQ the whole #faq section, CONTACT the button row under the contact h2.
    """
    if len(key) == 4 and key[0] == "W" and key[1] in "123456789" and key[2] == "_" and key[3] in "TDG":
        return "slot:WORK"
    if key in ("WORK_H2", "WORK_HINT", "WORK_ALL"):
        return "slot:WORK"
    if len(key) == 2 and key[0] in "QA" and key[1] in "1234":
        return "slot:FAQ"
    if key == "FAQ_H2":
        return "slot:FAQ"
    if key == "CONTACT_BTN":
        return "slot:CONTACT"
    if key.startswith("AI_"):
        return "slot:SITE_DATA"
    return "token"


for _i, _k in enumerate(META):
    META[_k]["order"] = (_i + 1) * 10
    META[_k]["source"] = source_of(_k)

# the two tables must agree exactly (build.py re-checks with a clear message)
assert set(META) == set(STRINGS), (set(META) ^ set(STRINGS))
assert all(m["group"] in GROUPS for m in META.values())
