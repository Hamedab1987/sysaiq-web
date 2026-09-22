# SysaiQ — FACTS (single source of truth for every writer/agent)

Read-only for everyone except the master agent. If something is not here, it is **not a
fact** — do not invent it. Unknown values stay `⟦…⟧` in drafts.

## Identity
- Brand: **SysaiQ** (uppercase contexts: SYSAIQ). Domain: sysaiq.com.
- Legal identity: **natural person** — حامد ابوعلی / Hamed Abooali. Not a registered
  company; no registration/tax/licence numbers exist to publish.
- Base: Qazvin, Iran. Serves clients across Iran and abroad (remote-ready).
- What it does: custom websites, profession landing pages, web apps/SaaS, e-commerce,
  mobile/PWA, AI agents & chatbots (RAG), business automation, accounting systems,
  trading/quant software (as software engineering only), maintenance & support.

## Contact (rendered only via `{{site.*}}` tokens)
| Token | Value |
|---|---|
| `{{site.owner_name}}` | fa: حامد ابوعلی · en: Hamed Abooali |
| `{{site.address}}` | fa: قزوین، خیابان توحید، کوچه قویدل (آشنا)، کوچه عادل بابایی، پلاک ۲۵ · en: No. 25, Adel Babaei Alley, Ghavidel (Ashna) Alley, Tohid St., Qazvin, Iran |
| `{{site.landline}}` | 028-33323002 → `tel:+982833323002` |
| `{{site.mobile}}` | 0912-513-0505 → `tel:+989125130505` |
| `{{site.email}}` | hello@sysaiq.com (forwards to the owner's inbox) |
| `{{site.hours}}` | ⟦owner to provide⟧ |
| postal code, map pin, WhatsApp/Telegram, Instagram/LinkedIn | ⟦owner to provide⟧ |

## Confirmed technology (from this repository)
Node.js/Express, SQLite, vanilla JavaScript, three.js/WebGL, Python, OpenAI API, nginx,
Linux server operations. Anything else (React, Flutter, native iOS/Android, specific
databases/clouds) is **unconfirmed** — describe capabilities, not named frameworks.
Native mobile experience is unconfirmed → position `mobile-app` as PWA-first.

## Portfolio (17 systems built by SysaiQ — not named-client engagements)
Slugs: restaurant, realestate, medical, trading, ecommerce, accounting, pos, salon,
distribution, law-landing, dental-landing, fitness-landing, cafe-landing,
architect-landing, hotel, school, hr. Source copy: `server/data-projects.json`;
titles/tags in `server/src/seed.js` (META). Images: `vesper-project/assets/projects/`
(`<name>-full.jpg`, some with `-fa-full.jpg`; trading is English-only).
Never add client names, user counts, revenue/percent improvements or testimonials.

## Commercial facts
- No fixed price list. Every project is priced in a **written proposal** before any payment.
  Pages explain *how cost is calculated* (scope, modules/pages, integrations, AI parts,
  bilingual, support level) — never figures.
- Third-party costs are separate and in the client's name: domain, hosting/server, SMS
  credit, gateway fees, AI API usage, paid licences.
- Payment: staged, each stage against an invoice with an online pay-link (Iranian gateway)
  or bank transfer with receipt. Card data is never stored by SysaiQ.
- Contract: signed in person in Qazvin or electronically; nothing is owed before signature
  and deposit.

## Owner policy values — UNDECIDED (keep as ⟦…⟧)
deposit % and milestone split · proposal validity (days) · feedback window and
deemed-acceptance window (working days) · revision rounds per milestone · bug-fix warranty
length · SLA response targets per severity/tier · pause/abandonment thresholds · refund
processing time · backup retention · working hours · portfolio-rights default (opt-in/out) ·
whether one fixed-price item (e.g. a support plan) will be published.

## Services catalogue (slugs are fixed)
custom-website · profession-landing · web-app · ecommerce · mobile-app · ai-agent ·
automation · accounting-systems · trading-systems · support-maintenance
(related project slugs per service: see plan §B2 table in the UX planner output, mirrored in
`server/content/services/*.json` once written).

## Pages (slugs are fixed)
about · contact · terms · privacy · refund · complaints · pricing · charter · contract · faq
— legal pages are seeded **unpublished**; only the owner publishes, after lawyer review.

## Third-party processors to name in the privacy policy
OpenAI (chat assistant + news summaries), the configured SMS provider, the configured
payment gateway, the hosting provider. Cookies/localStorage: language choice
(`sysaiq-lang`), chat-seen flag (`sysaiq-chat-seen`), admin session cookie (admins only).
