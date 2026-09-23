/* SysaiQ — home newsroom carousel (#news-feed). Progressive enhancement:
   without this file the track is a plain scroll-snap row (swipe / scroll).
   With it: prev/next, position dots (aria-current), a live "x of y" status
   for keyboard/button moves, ← → Home End keys, and a gentle autoplay that
   waits for the section to be on screen, holds while it is hovered, focused
   or touched, stops for good once the visitor takes over (or presses the
   pause button), and never runs under prefers-reduced-motion.
   The autoplay clock IS the CSS progress line (.nf-timer): its animationend
   advances the feed, so pausing the animation pauses the clock too.
   Direction-aware: in RTL "next" moves toward the left. No inline script,
   no globals, no dependencies. */
(() => {
  'use strict';
  const root = document.getElementById('news-feed');
  if (!root || !root.hasAttribute('data-nf')) return;
  const track = root.querySelector('.nf-track');
  const slides = [...root.querySelectorAll('.nf-slide')];
  const ctrl = root.querySelector('.nf-ctrl');
  if (!track || !ctrl || slides.length < 2) return;

  const prevBtn = ctrl.querySelector('.nf-prev');
  const nextBtn = ctrl.querySelector('.nf-next');
  const playBtn = ctrl.querySelector('.nf-play');
  const dotsEl = ctrl.querySelector('.nf-dots');
  const countEl = ctrl.querySelector('.nf-count');
  const timer = root.querySelector('.nf-timer');
  const status = root.querySelector('.nf-sr');
  const lang = document.documentElement.lang === 'fa' ? 'fa' : 'en';
  const rtl = getComputedStyle(root).direction === 'rtl';
  const L = k => root.getAttribute(`data-l-${k}`) || '';
  const nf = new Intl.NumberFormat(lang === 'fa' ? 'fa-IR' : 'en-US', { useGrouping: false });
  const num = (n, pad = 0) => nf.format(n).padStart(pad, nf.format(0));
  const fill = (s, i, n) => s.replace('{i}', num(i)).replace('{n}', num(n));
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');

  let positions = 1;   // how many start positions the track can snap to
  let index = 0;
  let stopped = reduce.matches; // user took over, pressed pause, or reduced motion
  let visible = false;
  const holds = new Set(); // hover | focus | touch | hidden

  root.classList.add('nf-js');
  ctrl.hidden = false;

  // ---- geometry ----------------------------------------------------------------
  const pad = side => parseFloat(getComputedStyle(track)[side === 'start' ? 'paddingInlineStart' : 'paddingInlineEnd']) || 0;
  // signed distance from a slide's start edge to the snap line (0 = aligned)
  function offsetOf(el) {
    const t = track.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    return rtl ? (t.right - pad('start')) - r.right : r.left - (t.left + pad('start'));
  }
  function measure() {
    const gap = parseFloat(getComputedStyle(track).columnGap) || 0;
    const w = slides[0].getBoundingClientRect().width;
    const content = track.clientWidth - pad('start') - pad('end');
    const fit = Math.max(1, Math.floor((content + gap + 2) / (w + gap)));
    return Math.max(1, slides.length - fit + 1);
  }
  const atEnd = () => track.scrollWidth - track.clientWidth - Math.abs(track.scrollLeft) < 4;
  function currentIndex() {
    if (atEnd()) return positions - 1;
    let best = 0, bestD = Infinity;
    slides.forEach((s, i) => { const d = Math.abs(offsetOf(s)); if (d < bestD) { bestD = d; best = i; } });
    return Math.min(best, positions - 1);
  }

  // ---- ui ----------------------------------------------------------------------
  function buildDots() {
    dotsEl.replaceChildren();
    for (let i = 0; i < positions; i++) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'nf-dot';
      b.setAttribute('aria-controls', track.id);
      b.setAttribute('aria-label', fill(L('goto'), i + 1, positions));
      b.addEventListener('click', () => { takeOver(); go(i, true); });
      dotsEl.append(b);
    }
  }
  function paint() {
    [...dotsEl.children].forEach((d, i) => { if (i === index) d.setAttribute('aria-current', 'true'); else d.removeAttribute('aria-current'); });
    countEl.textContent = `${num(index + 1, 2)} / ${num(positions, 2)}`;
    prevBtn.setAttribute('aria-disabled', String(index <= 0));
    nextBtn.setAttribute('aria-disabled', String(index >= positions - 1));
    const one = positions <= 1;
    ctrl.hidden = one;
    root.classList.toggle('nf-single', one);
  }
  function announce() { if (status) status.textContent = fill(L('status'), index + 1, positions); }

  // ---- movement ----------------------------------------------------------------
  const smooth = () => (reduce.matches ? 'auto' : 'smooth');
  function go(i, user = false) {
    i = Math.max(0, Math.min(positions - 1, i));
    const target = slides[i];
    const d = offsetOf(target);
    track.scrollBy({ left: rtl ? -d : d, behavior: smooth() });
    index = i;
    paint();
    if (user) announce();
    restartTimer();
  }
  const next = user => go(index >= positions - 1 ? (user ? index : 0) : index + 1, user);
  const prev = user => go(index - 1, user);

  // ---- autoplay: the CSS progress line is the clock ------------------------------
  const running = () => !stopped && visible && positions > 1 && holds.size === 0;
  function syncAuto() {
    root.classList.toggle('nf-auto', !stopped && positions > 1);
    root.classList.toggle('nf-hold', !running());
    root.classList.toggle('nf-stopped', stopped);
    if (playBtn) playBtn.setAttribute('aria-label', L(stopped ? 'play' : 'pause'));
  }
  function restartTimer() {
    if (!timer) return;
    timer.classList.remove('nf-run');
    if (stopped || positions <= 1) return;
    void timer.offsetWidth; // restart the animation from zero
    timer.classList.add('nf-run');
  }
  timer?.addEventListener('animationend', e => {
    if (e.animationName !== 'nftimer' || !running()) return;
    next(false);
  });
  function hold(key, on) { if (on) holds.add(key); else holds.delete(key); syncAuto(); }
  function takeOver() { if (!stopped) { stopped = true; syncAuto(); restartTimer(); } }

  // ---- events ------------------------------------------------------------------
  prevBtn.addEventListener('click', () => { takeOver(); if (index > 0) prev(true); });
  nextBtn.addEventListener('click', () => { takeOver(); if (index < positions - 1) next(true); });
  playBtn?.addEventListener('click', () => { stopped = !stopped; syncAuto(); restartTimer(); });

  root.addEventListener('keydown', e => {
    if (e.altKey || e.ctrlKey || e.metaKey || !root.contains(e.target)) return;
    const k = e.key;
    let to = null;
    if (k === 'ArrowRight') to = rtl ? index - 1 : index + 1;
    else if (k === 'ArrowLeft') to = rtl ? index + 1 : index - 1;
    else if (k === 'Home') to = 0;
    else if (k === 'End') to = positions - 1;
    if (to === null || !(track.contains(e.target) || ctrl.contains(e.target))) return;
    e.preventDefault();
    takeOver();
    go(to, true);
    // focus follows the move when it was on a card
    if (track.contains(e.target)) slides[index].querySelector('a')?.focus({ preventScroll: true });
  });

  // hover / focus / touch hold the clock; a swipe or wheel on the track means the visitor drives now
  root.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') hold('hover', true); });
  root.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') hold('hover', false); });
  root.addEventListener('focusin', () => hold('focus', true));
  root.addEventListener('focusout', e => { if (!root.contains(e.relatedTarget)) hold('focus', false); });
  track.addEventListener('pointerdown', e => { if (e.pointerType !== 'mouse') { hold('touch', true); takeOver(); } });
  addEventListener('pointerup', () => hold('touch', false), { passive: true });
  addEventListener('pointercancel', () => hold('touch', false), { passive: true });
  track.addEventListener('touchstart', () => takeOver(), { passive: true });
  track.addEventListener('wheel', e => { if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) takeOver(); }, { passive: true });

  // follow the scroll (swipes, snaps, programmatic moves)
  let raf = 0;
  track.addEventListener('scroll', () => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      const i = currentIndex();
      if (i !== index) { index = i; paint(); }
    });
  }, { passive: true });

  // only tick while the section is on screen and the tab is visible
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(es => { for (const e of es) { visible = e.isIntersecting; syncAuto(); } }, { threshold: 0.35 }).observe(root);
  } else visible = true;
  document.addEventListener('visibilitychange', () => hold('hidden', document.hidden));
  reduce.addEventListener?.('change', () => { if (reduce.matches) { stopped = true; syncAuto(); restartTimer(); } });

  function layout() {
    const p = measure();
    if (p !== positions || !dotsEl.children.length) { positions = p; buildDots(); }
    index = currentIndex();
    paint();
    syncAuto();
  }
  if ('ResizeObserver' in window) new ResizeObserver(() => layout()).observe(track);
  else addEventListener('resize', layout);
  layout();
  restartTimer();
})();
