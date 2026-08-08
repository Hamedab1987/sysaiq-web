# Vesper — living-interface landing page

A single-page WebGL landing page where one 91,000-particle field morphs
through four states as the visitor scrolls: breathing orb → ring galaxy →
Earth (real coastlines) → "AI" letterforms. Original recreation of the
"Vesper" premium template on getlayers.ai (visual style only; all code here
is original). Everything is deterministic (seeded mulberry32, SEED=20260808).

## Files

- `src/vesper.src.html` — THE file to edit. Readable source: CSS + HTML
  sections + one inline JS block (particle builders, GLSL shaders, scroll
  engine). References three.js via CDN tag and the land mask via a
  `__LANDMASK_B64__` placeholder.
- `build.py` — inlines `assets/three.min.js` (r128) and
  `assets/landmask.b64` into `index.html`. Run `python3 build.py` after
  every source edit.
- `index.html` — built output, fully self-contained (~660 KB). Never edit
  by hand.
- `assets/landmask.b64` — 288×144 bit-packed Earth land mask (base64),
  generated with the `global-land-mask` Python package.
- `PHILOSOPHY.md` — the design manifesto ("Sentient Luminance").

## Architecture (all inside src/vesper.src.html)

1. **Shape builders (CPU, run once at load)** fill Float32Array morph
   targets, one entry per particle: `orbPos` (unit dirs on quantized
   latitude rings), `galaxyPos` (broken concentric rings + halo + core),
   `earthPos` (vec4: xyz + land flag, rejection-sampled against the land
   mask; oceans kept sparse), `aiPos` (vec4: xyz + letter flag, sampled
   from an offscreen canvas rendering the text "AI").
2. **Vertex shader** mixes targets by phase weights `uW` (x=orb, y=galaxy,
   z=unused) and `uW2` (x=earth, y=ai), adds per-phase motion (orb wave,
   galaxy differential rotation + tilt, ocean shimmer, letter hover),
   cursor repulsion (damped for earth/ai), click ripple, and per-phase
   color/alpha (orb lit mint→violet, galaxy mint rings/violet core, earth
   land vs ocean + atmosphere rim, AI gradient + energy sweep).
3. **Scroll engine** — sections carry `data-phase` (0 orb, 1 galaxy,
   2 earth, 3 ai). `currentPhase()` picks the section under the viewport
   centre; weights ease toward the target each frame. Per-phase camera
   distance `PHASE_CAMZ`, vertical offset `PHASE_YOFF`, HUD label
   `PHASE_LABEL`. Rotation: slow spin, faster during earth, eases
   dead-centre for the AI letters.
4. **Page chrome** — fixed header pill nav, boot loader ("INITIALIZING
   ENVIRONMENT" + %), corner HUD (auto-fades when stats bar / light
   sections / footer pass under it), reveal-on-scroll (`.rv` +
   IntersectionObserver), FAQ accordion, scroll-% readout.

## Conventions

- Keep the four PHASE_* arrays and section `data-phase` values in sync
  when adding/removing a phase; weights are normalized each frame.
- New morph targets: add a BufferAttribute + a weight slot + motion/color
  branches in the shader — reuse the existing vec4 pattern (xyz + flag).
- Section design language: dark sections are transparent over the canvas;
  light sections (`.light`) are opaque. Mono eyebrows `[ V—NAME / SYS.04 ]`,
  thin 300-weight display headings.
- Don't call Date.now()/Math.random() for anything that affects geometry —
  keep it seeded and reproducible.

## Verify

Headless screenshots (Playwright + system Chromium) at several scroll
positions after changes; check phases settle, no console errors:
scroll to a section, wait ~10 s (weights ease in), screenshot.
