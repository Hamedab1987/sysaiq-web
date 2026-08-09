# SysAIQ — bilingual living-interface landing page

The SysAIQ.com landing: a single-page WebGL experience where one
91,000-particle field morphs through four states as the visitor scrolls:
breathing orb → ring galaxy → Earth (real coastlines) → "SysAIQ"
letterforms. Fully bilingual (Persian RTL / English LTR) from one shared
template. Everything is deterministic (seeded mulberry32, SEED=20260808).

## Files

- `src/vesper.src.html` — THE file to edit. Readable template: CSS + HTML
  sections + one inline JS block (particle builders, GLSL shaders, scroll
  engine). Copy lives in `{{TOKEN}}` placeholders; references three.js via
  CDN tag and the land mask via `__LANDMASK_B64__`.
- `src/content.py` — the bilingual content model. Every copy string is
  `{"en": …, "fa": …}`; `LANGS` holds per-language head attrs and SEO URLs.
  Persian copy is written natively (never literal translation); technical
  terms (AI, Agent, RAG, LLM, Automation…) stay in English.
- `build.py` — substitutes tokens once per language, inlines
  `assets/three.min.js` (r128), `assets/landmask.b64` and (fa only)
  `assets/vazirmatn-var.woff2`, and writes:
  `en/index.html`, `fa/index.html`, plus a root `index.html` language
  redirector (localStorage choice → browser language → en). Run
  `python3 build.py` after every source/content edit. A missing or
  leftover `{{TOKEN}}` fails the build loudly.
- `en/index.html`, `fa/index.html`, `index.html` — built output, fully
  self-contained. Never edit by hand.
- `assets/vazirmatn-var.woff2` — Vazirmatn variable font (100–900),
  inlined into the fa build only (~+148 KB).
- `PHILOSOPHY.md` — the design manifesto ("Sentient Luminance").

## Bilingual rules

- URL scheme: `/en/` and `/fa/`; root `/` redirects and is `noindex`.
  Each page carries canonical + `hreflang` fa/en/x-default alternates.
- The header language switcher (`.lang-sw`, FA | EN) preserves
  `location.hash` and persists the choice to `localStorage['sysaiq-lang']`.
- RTL: the fa build sets `<html lang="fa" dir="rtl">`. `[dir="rtl"]` CSS
  overrides fix physical text-aligns, swap the two HUD corners, and zero
  `letter-spacing` (it breaks Persian letter joining). Technical LTR runs
  (eyebrows, HUD, stat keys, footer tags) carry `dir="ltr"` inline.
- Adding copy: add a `{{TOKEN}}` in the template AND a key in
  `STRINGS` — the build asserts both directions, so the two languages
  cannot drift structurally.

## Architecture (all inside src/vesper.src.html)

1. **Shape builders (CPU, run once at load)** fill Float32Array morph
   targets, one entry per particle: `orbPos` (unit dirs on quantized
   latitude rings), `galaxyPos` (broken concentric rings + halo + core),
   `earthPos` (vec4: xyz + land flag, rejection-sampled against the land
   mask; oceans kept sparse), `aiPos` (vec4: xyz + letter flag, sampled
   from an offscreen 1280×320 canvas rendering "SysAIQ", auto-fit to
   canvas width).
2. **Vertex shader** mixes targets by phase weights `uW` (x=orb, y=galaxy,
   z=unused) and `uW2` (x=earth, y=letters), adds per-phase motion (orb
   wave, galaxy differential rotation + tilt, ocean shimmer, letter
   hover), cursor repulsion (damped for earth/letters), click ripple, and
   per-phase color/alpha.
3. **Scroll engine** — sections carry `data-phase` (0 orb, 1 galaxy,
   2 earth, 3 letters). `currentPhase()` picks the section under the
   viewport centre; weights ease toward the target each frame. Per-phase
   camera distance `PHASE_CAMZ` (letters use 7.0 to fit the wide word),
   vertical offset `PHASE_YOFF`, HUD label `PHASE_LABEL`.
4. **Page chrome** — fixed header pill nav + language switcher, boot
   loader, corner HUD (auto-fades over opaque UI; corners swap under
   RTL), reveal-on-scroll (`.rv` + IntersectionObserver), FAQ accordion,
   scroll-% readout.

## Conventions

- Keep the four PHASE_* arrays and section `data-phase` values in sync
  when adding/removing a phase; weights are normalized each frame.
- Section design language: dark sections are transparent over the canvas;
  light sections (`.light`) are opaque. Mono eyebrows
  `[ SYSAIQ—NAME / SYS.0N ]`, thin 300-weight display headings.
- Don't call Date.now()/Math.random() for anything that affects geometry —
  keep it seeded and reproducible.
- Contact email is `hello@sysaiq.com` (in the template, not content.py).

## Verify

Serve the repo root (`python3 -m http.server`) and check
`/vesper-project/en/` and `/vesper-project/fa/` at several scroll
positions after changes; phases settle in ~8–10 s (weights ease in).
Check: no console errors, letterforms spell "SysAIQ", fa page is RTL
with joined (not spaced-out) Persian glyphs, switcher keeps position.
