---
name: sysaiq-design-system
description: SysaiQ visual language — tokens, typography, section surfaces, component patterns and RTL rules for the home template, server-rendered pages and the Persian admin. Read before designing or styling anything in this repo.
---

# SysaiQ design system ("Sentient Luminance")

Manifesto: `vesper-project/PHILOSOPHY.md`. Home template: `vesper-project/src/vesper.src.html`
(CSS at the top `<style>`, RTL overrides ~lines 287–308, mobile block ~349–366).
The look: near-black space, thin luminous typography, mint→violet light, mono technical
eyebrows, generous negative space, quiet motion. "Wow" comes from restraint + precision.

## Tokens
```css
--mint:#7dffd9;  --violet:#8b6bff;
--grad:linear-gradient(135deg,var(--mint),var(--violet));   /* the signature */
/* dark surfaces */
--ink:#eceaf6; --dim:rgba(236,234,246,.55); --faint:rgba(236,234,246,.32); --line:rgba(236,234,246,.12);
/* light ("paper") sections on the home page */
--paper:#ececea; --paper2:#e4e3e0; --ink-d:#101012; --dim-d:rgba(16,16,18,.6); --line-d:rgba(16,16,18,.14);
/* SSR pages + admin (deeper navy) */
--bg:#070a12; --panel:#0e1422; --surface-3:#182038;
--ok:#7dffd9; --warn:#ffc46b; --danger:#ff6b7d; --info:#7db8ff;
```
Home page body bg `#050507`. Text on dark must be ≥ `rgba(236,234,246,.52)` for body copy
(contrast ≥ 4.5:1); `--faint` is for eyebrows/decoration only. Button text on the gradient: `#06101f`.
Spacing scale 4/8/12/16/20/24/32/40/56. Radii: 8 inputs · 12–16 cards · 100px pills.
`.wrap` = max-width 1200px, padding-inline 40px (24px on SSR pages / mobile).

## Typography
- Latin: `-apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Helvetica, Arial, sans-serif`.
- Persian: **Vazirmatn variable** (100–900) self-hosted at `/assets/vazirmatn-var.woff2`
  (`format('woff2-variations')`, `font-display:swap`); `[dir="rtl"] body{font-family:Vazirmatn,…}`.
- Mono (keys, eyebrows, HUD, code): `"SF Mono", ui-monospace, "Cascadia Mono", Menlo, Consolas`.
  SF Mono has no Arabic glyphs → any `.mono` element that can hold Persian must switch to Vazirmatn under RTL.
- Display headings: weight **300**, tight line-height 1.04–1.1, `letter-spacing:-.02em` (Latin only),
  `clamp()` sizes: h1 `clamp(44px,6.2vw,84px)`, section h2 `clamp(36px,4.8vw,64px)`,
  SSR page h1 `clamp(30px,5vw,52px)`. Body 14–16px / 1.7–1.9 (Persian needs the looser end).
- Eyebrow: mono 10px, `letter-spacing:.22em`, uppercase, `--faint`, format
  `[ SYSAIQ—NAME / SYS.0N ]`, always `dir="ltr"`.
- Emphasis inside headings: `<em>` renders as gradient text (background-clip:text), not italics.

## RTL rules (the ones that break pages when forgotten)
1. **`letter-spacing:0` and `text-transform:none` on every Persian run** — letter-spacing
   breaks Arabic-script joining. All eyebrow/tag/stat-label styles need an `[dir="rtl"]` reset
   unless the element carries `dir="ltr"`.
2. Latin/technical islands inside Persian (eyebrows, slugs, tags like `QUANT · PYTHON`, URLs,
   phone numbers, amounts with Latin digits, code) get `dir="ltr"` + `unicode-bidi:isolate`.
3. **Logical properties only**: `margin-inline`, `padding-inline`, `inset-inline-start`,
   `border-inline-start`, `text-align:start|end`. Never `left/right` in new CSS.
4. Arrows and chevrons flip under RTL (← becomes the "forward" direction in fa).
5. Order in bilingual UIs: fa first (it sits on the right under RTL).

## Home-page surfaces & the WebGL phase system
- `.dark-sec` = transparent over the particle canvas — reserved for the four WebGL acts
  (hero/presence/terra/mind) and the contact finale. **Never put dense text directly over particles.**
- `.light` = opaque paper (`--paper` / `--paper2`), dark ink — About, Work, FAQ, Services, Why.
- `.solid` (new) = opaque deep navy `#070a12` — Process, Commitments, News. Hides the canvas
  like `.light`; **must be in the `occluders` selector** (~line 1216) so the HUD fades.
- Every section carries `data-phase` (0 orb · 1 galaxy · 2 earth · 3 letters); all new sections
  use `3`. `phaseSecs`/`occluders` are captured once at load — sections must exist in the
  server-rendered HTML, never injected client-side.
- Reveal: `.rv` → `.rv.on` via IntersectionObserver, stagger `.d1/.d2/.d3`. Respect
  `prefers-reduced-motion`.

## Component patterns
- **Section head:** eyebrow + thin h2; on light sections a baseline-aligned flex row
  (heading start, eyebrow end) — see `.living-head` / `.work-head`.
- **Feature / card:** top hairline (`border-top:1px solid var(--line-d)`), mono index `[ 01 ]`
  in mint (dark) or `--dim-d` (light), 500-weight title, 13–14px body. No drop shadows on
  light; on dark cards: `--panel` bg + 1px `--line` + hover `translateY(-6px)` and violet
  glow `0 30px 60px -28px rgba(139,107,255,.55)`.
- **Buttons:** primary = gradient fill, `#06101f` text, radius 10px (SSR/admin) — home hero
  uses `.btn-solid` (white → mint on hover, radius 3px); ghost = 1px `--line` border;
  `.cta-pill` = rounded pill with a pulsing mint dot.
- **Chips:** 1px `--line`, `--panel`, radius 100px, 13.5px `--dim`.
- **Accordion (FAQ):** `.qa/.qa-q/.qa-a`, `max-height` transition, `+` rotates 45° when open.
- **Glass:** `background:rgba(10,10,14,.55–.72); backdrop-filter:blur(16–18px); border:1px solid rgba(236,234,246,.1)`
  — header pill, sticky SSR header, contact panel over the letterforms.
- **Showcase (work):** cross-fading Ken Burns image stage + index rows with gradient-text
  active title and a progress bar; 3D tilt on hover. Project pages should feel like the
  same family (cinematic covers, 16:9 / 16:10, soft radial glows at the page top:
  `radial-gradient(120% 80% at 50% -10%, rgba(139,107,255,.10), transparent 55%)`).
- **Trust seals:** on a small white rounded tile (they are designed for light backgrounds).
- **Forms (public):** inputs `--panel` bg, 1px `--line`, radius 10px, 44px min height,
  visible focus ring `outline:2px solid var(--mint); outline-offset:2px`, inline Persian errors.

## Admin (Persian, RTL, dark only)
`server/admin/admin.css` uses `@layer reset, tokens, base, layout, components, utilities, views`,
class prefix `a-`, logical properties only, no inline styles/handlers. Sidebar 264px (right
side under RTL), topbar 60px, content max-width 1120px. Body 14.5px / 1.9. Weight 300 only for
headings ≥ 26px. Status is never colour-only (icon or text too). Hit targets ≥ 40px.
Tables collapse to cards ≤ 720px via `data-label`. Persian digits on display, Latin in storage.
Icons: same-origin sprite `/admin/icons.svg` (`<use href="/admin/icons.svg#i-name">`).
Brand touches: soft radial glow at page top, gradient hairline on the active nav item,
gradient progress ring, skeletons instead of "Loading…".

## Quality bar
Check every screen at 375 / 768 / 1440 px, in fa and en, for: joined Persian glyphs,
isolated LTR islands, no horizontal scroll, focus visibility, contrast, reduced motion,
and zero console/CSP errors.
