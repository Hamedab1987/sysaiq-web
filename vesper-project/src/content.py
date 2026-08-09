# SysAIQ bilingual content model.
# Every key maps to {'en': ..., 'fa': ...}. build.py substitutes {{KEY}}
# tokens in src/vesper.src.html once per language. A missing token or a
# missing key fails the build loudly — the two languages can never drift
# structurally.
#
# Persian copy is written natively (not translated); technical terms
# (AI, Agent, RAG, LLM, Automation…) stay in English per brand rules.

STRINGS = {
    # ---------- <head> ----------
    "TITLE": {
        "en": "SysAIQ — Intelligent Digital Systems",
        "fa": "SysAIQ — سیستم‌های دیجیتال هوشمند",
    },
    "META_DESC": {
        "en": "AI & software lab building intelligent digital systems — "
              "custom websites, apps, AI agents, automation, and accounting "
              "& trading systems, designed around your actual business problem.",
        "fa": "لابراتوار نرم‌افزار و AI — طراحی و ساخت وب‌سایت اختصاصی، اپلیکیشن، "
              "AI Agent، اتوماسیون و سیستم‌های حسابداری و معاملاتی؛ "
              "بر پایه‌ی مسئله‌ی واقعی کسب‌وکار شما.",
    },

    # ---------- header nav ----------
    "NAV_HOME":    {"en": "Home",         "fa": "خانه"},
    "NAV_CAP":     {"en": "Capabilities", "fa": "توانمندی‌ها"},
    "NAV_ABOUT":   {"en": "About",        "fa": "درباره"},
    "NAV_FAQ":     {"en": "FAQ",          "fa": "سؤالات"},
    "NAV_CTA":     {"en": "Start a Project", "fa": "شروع یک پروژه"},
    "NAV_CONTACT": {"en": "Contact",      "fa": "تماس"},

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
              "AI Agent و سیستم‌های پیچیده‌تر، بر اساس مسئله‌ی واقعی شما.",
    },
    "TAG1": {"en": "[ AI Agents ]",  "fa": "[ AI Agent ]"},
    "TAG2": {"en": "[ Automation ]", "fa": "[ اتوماسیون ]"},
    "TAG3": {"en": "[ Custom Apps ]","fa": "[ اپ اختصاصی ]"},
    "CTA_PRIMARY": {"en": "Start a Project", "fa": "شروع یک پروژه"},

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
        "fa": "دورکار و آماده‌ی production: سیستم‌هایی که برای کسب‌وکارها و "
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
        "en": "SysAIQ is a one-person systems lab. I design and build "
              "intelligent digital systems that combine software, AI, "
              "automation, data and modern interfaces — from custom websites "
              "and apps to AI agents and automated workflows.",
        "fa": "SysAIQ یک لابراتوار سیستم‌سازیِ تک‌نفره است. سیستم‌های دیجیتال "
              "هوشمند طراحی و پیاده‌سازی می‌کنم؛ ترکیبی از نرم‌افزار، AI، "
              "اتوماسیون، داده و رابط‌های مدرن — از وب‌سایت و اپ اختصاصی تا "
              "AI Agent و فرایندهای خودکار.",
    },
    "FEAT2": {
        "en": "Every build starts from the actual business problem, not a "
              "template: accounting and trading systems, process automation, "
              "integrations between the tools you already use — engineered "
              "end to end.",
        "fa": "هر پروژه از مسئله‌ی واقعی کسب‌وکار شروع می‌شود، نه از قالب آماده: "
              "سیستم حسابداری و معاملاتی، اتوماسیون فرایندها، و اتصال "
              "ابزارهایی که همین حالا استفاده می‌کنید — مهندسی‌شده از ابتدا "
              "تا انتها.",
    },

    # ---------- FAQ (light) ----------
    "FAQ_H2": {"en": "Frequently asked", "fa": "سؤالات پرتکرار"},
    "Q1": {"en": "WHAT EXACTLY IS SYSAIQ?", "fa": "SysAIQ دقیقاً چیست؟"},
    "A1": {
        "en": "A systems lab run by one engineer. I build intelligent digital "
              "systems — websites, custom apps, AI agents, automation and "
              "trading &amp; accounting systems — designed around your actual "
              "problem, not a template.",
        "fa": "یک لابراتوار سیستم‌سازی که یک مهندس آن را اداره می‌کند. "
              "سیستم‌های دیجیتال هوشمند می‌سازم — وب‌سایت، اپ اختصاصی، "
              "AI Agent، اتوماسیون و سیستم‌های معاملاتی و حسابداری — بر اساس "
              "مسئله‌ی واقعی شما، نه قالب آماده.",
    },
    "Q2": {"en": "CAN AI WORK WITH MY EXISTING TOOLS?",
           "fa": "آیا AI با ابزارهای فعلی من کار می‌کند؟"},
    "A2": {
        "en": "Yes. AI agents and automations connect to the systems you "
              "already run — spreadsheets, CRMs, accounting software, APIs "
              "and databases — through clean integrations, so nothing has to "
              "be replaced to get smarter.",
        "fa": "بله. AI Agent و اتوماسیون‌ها به سیستم‌هایی که همین حالا دارید "
              "وصل می‌شوند — اکسل و شیت‌ها، CRM، نرم‌افزار حسابداری، API و "
              "دیتابیس — با اتصال‌های تمیز؛ لازم نیست چیزی را دور بیندازید تا "
              "هوشمند شوید.",
    },
    "Q3": {"en": "DO YOU BUILD TRADING AND ACCOUNTING SYSTEMS?",
           "fa": "سیستم معاملاتی و حسابداری هم می‌سازید؟"},
    "A3": {
        "en": "Yes — a core specialty. Backtesting and execution tools for "
              "traders, and accounting systems that reconcile, report and "
              "automate the numbers your business runs on.",
        "fa": "بله — تخصص اصلی من است. ابزارهای Backtesting و اجرای معاملات "
              "برای تریدرها، و سیستم‌های حسابداری که اعداد کسب‌وکار شما را "
              "مغایرت‌گیری، گزارش‌گیری و خودکار می‌کنند.",
    },
    "Q4": {"en": "HOW DO WE START?", "fa": "از کجا شروع کنیم؟"},
    "A4": {
        "en": "Send a short note about your business and the problem you want "
              "solved. You get a plain-language proposal — scope, timeline "
              "and budget — before any commitment.",
        "fa": "چند خط درباره‌ی کسب‌وکارتان و مشکلی که می‌خواهید حل شود "
              "بفرستید. قبل از هر تعهدی، یک پیشنهاد شفاف می‌گیرید — محدوده‌ی "
              "کار، زمان‌بندی و بودجه.",
    },

    # ---------- contact ----------
    "CONTACT_H2": {
        "en": "Let&rsquo;s build your<br><em>system</em>",
        "fa": "بیایید سیستمِ شما را<br><em>بسازیم</em>",
    },
    "CONTACT_BTN": {"en": "Contact Me", "fa": "تماس با من"},

    # ---------- footer ----------
    "FOOT_C":   {"en": "© 2026 SysAIQ · Hamed Systems Lab",
                 "fa": "© ۲۰۲۶ SysAIQ · Hamed Systems Lab"},
    "FOOT_MID": {"en": "Software · AI · Automation · Quant",
                 "fa": "نرم‌افزار · AI · اتوماسیون · Quant"},
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
