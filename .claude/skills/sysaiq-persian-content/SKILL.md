---
name: sysaiq-persian-content
description: Voice, terminology, Persian orthography and the never-fabricate rules for all SysaiQ site and admin copy (fa + en). Read before writing or reviewing any user-facing text in this repo.
---

# SysaiQ content guide (fa + en)

**Who:** SysaiQ is the professional brand of a natural person — **حامد ابوعلی / Hamed
Abooali** — based in **Qazvin, Iran**, building custom websites, web apps, AI agents,
automation, accounting and trading software. Not a registered company. Facts that may
appear in copy only as tokens (single source = admin «اطلاعات تماس»):
`{{site.owner_name}}` `{{site.address}}` `{{site.landline}}` `{{site.mobile}}`
`{{site.email}}` `{{site.hours}}`. Never type a phone number or address literally in page bodies.

Owner-provided facts: address «قزوین، خیابان توحید، کوچه قویدل (آشنا)، کوچه عادل بابایی،
پلاک ۲۵» · landline 028-33323002 · mobile 0912-513-0505 · hello@sysaiq.com.
English address: No. 25, Adel Babaei Alley, Ghavidel (Ashna) Alley, Tohid St., Qazvin, Iran.

## Voice
Precise, calm, specific. Name the deliverable and the next step; cut adjectives.
- **fa:** «ما» on services/legal pages (conventional business plural); first-person «من»
  only in hero/about where the personal-brand tone already exists. The "top-tier, precise
  team" feeling comes from **process rigour** (written scope, acceptance criteria, SLAs,
  versioned documents) — never from claiming headcount. No «تیم ۱۰ نفره»، «کارشناسان ما».
- **en:** plain international English, active voice. No "cutting-edge", "world-class",
  "guaranteed". "SysaiQ"/"we" on services/legal; "I" in hero/about.
- Location framing: «مستقر در قزوین، خدمت‌رسانی به سراسر ایران و خارج از کشور» — not "remote worldwide".

## NEVER fabricate
Prices, discounts or "from X" figures · delivery times and SLA numbers the owner hasn't
confirmed · client names or logos · testimonials · counts ("+50 projects") · certifications,
memberships, seals · company-registration / tax / licence numbers · team size · a tech
stack the owner hasn't confirmed · trading performance · legal guarantees.
Unresolved owner policy values are written as `⟦…⟧` in drafts; the renderer shows
«در پیشنهاد کتبی اعلام می‌شود» / "stated in the written proposal".
The 17 portfolio items are **systems built by SysaiQ** — describe the built work; do not
present them as named-client engagements, and write "outcome" qualitatively.
Confirmed stack (from this repo): Node/Express, SQLite, vanilla JS, three.js/WebGL, Python,
OpenAI API. Anything else needs the owner's confirmation.

## Native Persian (not translation)
Write the Persian from the brief/outline, not from the English sentence. Technical terms
stay English: AI, Agent, RAG, API, SaaS, PWA, SLA, Backtesting, CRM. Use the established
Persian term where one exists: پشتیبانی، درگاه پرداخت، پیش‌پرداخت، پیشنهاد کتبی.

### Orthography (lint: `node server/scripts/fa-lint.js <files>`)
- نیم‌فاصله (ZWNJ U+200C) is mandatory: می‌/نمی‌ + verb، ‌ها/‌های، ‌تر/‌ترین، compounds
  (پیش‌پرداخت، به‌روزرسانی، سرویس‌دهی، هم‌زمان).
- Persian ی (U+06CC) and ک (U+06A9) — never Arabic ي / ك.
- Quotes «…»؛ punctuation «،» «؛» «؟». No space before punctuation.
- Ezafe after silent ه: **«هٔ»** site-wide (صفحهٔ، پروژهٔ، شیوه‌نامهٔ) — not «ه‌ی».
- Persian digits in fa prose (۰–۹), thousands separator «٬», unit word always written:
  «۱۲٬۵۰۰٬۰۰۰ تومان». Jalali dates «۳۱ شهریور ۱۴۰۵». Phone display «۰۲۸-۳۳۳۲۳۰۰۲»،
  «۰۹۱۲ ۵۱۳ ۰۵۰۵»; `tel:` links are Latin E.164 (`+982833323002`, `+989125130505`).
- No letter-spacing, no uppercase styling on Persian text. Latin/technical runs inside
  Persian get `dir="ltr"` (or `<bdi>`).
- en: Latin digits, +98 phone format, Gregorian dates (legal effective dates may add the
  Jalali date in parentheses).

## Terminology
| Concept | fa (use) | fa (avoid) | en |
|---|---|---|---|
| Provider (contract text) | «مجری» — defined once as «مجری (ارائه‌دهندهٔ خدمات): SysaiQ» | سرویس‌دهنده (also means "server") | Provider / SysaiQ |
| Client (contract text) | «کارفرما»؛ in marketing/charter «مشتری» | سرویس‌گیرنده | Client |
| Headline honouring the owner's phrasing | «تعهدات طرفین: ارائه‌دهنده و دریافت‌کنندهٔ خدمات» | | Mutual obligations |
| Scope / change request | محدودهٔ کار / درخواست تغییر | اسکوپ | Scope / Change request |
| Milestone / acceptance | مرحله / تأیید تحویل | مایلستون | Milestone / Acceptance |
| Deposit / final payment | پیش‌پرداخت / تسویه | بیعانه | Deposit / Final payment |
| Proposal | پیشنهاد کتبی | پروپوزال | Written proposal |
| Warranty / support | گارانتی رفع اشکال / پشتیبانی | | Bug-fix warranty / Support |
| Lead (admin) | سرنخ | لید | Lead |
| Invoice / pay link | فاکتور / لینک پرداخت | | Invoice / Pay link |

## Legal pages
Top-of-page notice — fa: «این متن چارچوب عمومی همکاری با SysaiQ را توضیح می‌دهد. در هر
پروژه، قرارداد امضاشده میان طرفین حاکم است و در صورت تفاوت، متن قرارداد ملاک خواهد بود.»
en adds: "The Persian version of this page is authoritative."
Pages carry version + effective date; `legal_reviewed_at` stays empty until a human lawyer
signs off. Items that need a lawyer/accountant are collected in
`server/content/LEGAL-REVIEW.md` (deemed acceptance, e-signature weight, withdrawal right,
liability cap, jurisdiction clause — courts of Qazvin, VAT/invoice status of a natural person,
trading-page framing). `trading-systems` is framed strictly as software engineering
(analysis, backtesting, dashboards): no signals, no asset management, no brokerage + risk disclaimer.

## fa/en parity checklist
Same keys, same heading/clause counts, same links in both languages · every service has
audience, deliverables, cost-calculation note (no figures), how-to-order CTA, valid related
project slugs · one H1 per page · unique title + meta description per page per language ·
KB entries (server/content/knowledge/*.json) ≤ 700 chars per language for pitch/project/service entries and ≤ 900 for company/legal/playbook, `{lang}` links, and NO literal phone/email/address — the assistant gets those from the live CONTACT block.
