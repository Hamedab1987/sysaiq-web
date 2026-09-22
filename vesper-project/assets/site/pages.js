/* SysaiQ — behaviours for server-rendered pages. Loaded with `defer`, no
   inline handlers (CSP script-src 'self'). Everything is delegated from
   document so markup rendered later (admin previews) works too. */
(function () {
  'use strict';

  var doc = document;
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---- mobile nav toggle --------------------------------------------------
  function toggleNav(btn, force) {
    var nav = doc.getElementById(btn.getAttribute('aria-controls') || 'site-nav');
    if (!nav) return;
    var open = typeof force === 'boolean' ? force : btn.getAttribute('aria-expanded') !== 'true';
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    nav.classList.toggle('open', open);
  }

  // ---- FAQ accordion (.qa > .qa-q[data-qa-toggle] + .qa-a) ----------------
  function setQa(qa, open) {
    var btn = qa.querySelector('.qa-q');
    var ans = qa.querySelector('.qa-a');
    if (!btn || !ans) return;
    qa.classList.toggle('open', open);
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    ans.style.maxHeight = open ? ans.scrollHeight + 'px' : '0px';
  }
  function toggleQa(btn) {
    var qa = btn.closest('.qa');
    if (!qa) return;
    var open = !qa.classList.contains('open');
    var list = qa.parentElement;
    if (list) {
      var others = list.querySelectorAll('.qa.open');
      for (var i = 0; i < others.length; i++) if (others[i] !== qa) setQa(others[i], false);
    }
    setQa(qa, open);
  }
  // an answer opened via a #hash link (from the TOC or a search result)
  function openFromHash() {
    var id = location.hash && location.hash.slice(1);
    if (!id) return;
    var el = doc.getElementById(id);
    var qa = el && el.closest('.qa');
    if (qa) setQa(qa, true);
  }

  // ---- lightbox placeholder ([data-lightbox] images; projects redesign) ----
  var box = null;
  function lightbox() {
    if (box) return box;
    box = doc.createElement('div');
    box.className = 'lightbox';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    var img = doc.createElement('img');
    img.alt = '';
    var close = doc.createElement('button');
    close.type = 'button';
    close.className = 'lightbox-close';
    close.setAttribute('data-lightbox-close', '');
    close.setAttribute('aria-label', doc.documentElement.lang === 'fa' ? 'بستن' : 'Close');
    close.textContent = '×';
    box.appendChild(img);
    box.appendChild(close);
    doc.body.appendChild(box);
    return box;
  }
  function openLightbox(src, alt) {
    var b = lightbox();
    var img = b.querySelector('img');
    img.src = src;
    img.alt = alt || '';
    b.classList.add('open');
    b.querySelector('button').focus();
  }
  function closeLightbox() {
    if (box) box.classList.remove('open');
  }

  // ---- copy to clipboard ([data-copy="text"]) ------------------------------
  function copy(el) {
    var text = el.getAttribute('data-copy') || el.textContent || '';
    if (!text) return;
    var done = function () {
      el.classList.add('copied');
      setTimeout(function () { el.classList.remove('copied'); }, 1400);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () {});
    }
  }

  // ---- delegated events ------------------------------------------------------
  doc.addEventListener('click', function (e) {
    var t = e.target;
    if (!(t instanceof Element)) return;
    var el;
    if ((el = t.closest('[data-nav-toggle]'))) { toggleNav(el); return; }
    if ((el = t.closest('[data-qa-toggle]'))) { toggleQa(el); return; }
    if ((el = t.closest('[data-lightbox]'))) {
      var src = el.getAttribute('data-lightbox') || el.getAttribute('href') || (el.tagName === 'IMG' ? el.src : '');
      if (src) { e.preventDefault(); openLightbox(src, el.getAttribute('data-alt') || el.getAttribute('alt') || ''); }
      return;
    }
    if (t.closest('[data-lightbox-close]') || (box && t === box)) { closeLightbox(); return; }
    if ((el = t.closest('[data-copy]'))) { e.preventDefault(); copy(el); return; }
    // a nav link closes the mobile menu
    if (t.closest('.site-nav a')) {
      var btn = doc.querySelector('[data-nav-toggle]');
      if (btn && btn.getAttribute('aria-expanded') === 'true') toggleNav(btn, false);
    }
  });

  doc.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    closeLightbox();
    var btn = doc.querySelector('[data-nav-toggle][aria-expanded="true"]');
    if (btn) { toggleNav(btn, false); btn.focus(); }
  });

  // keep open answers sized on resize (their max-height is a pixel value)
  var resizeTimer;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      var open = doc.querySelectorAll('.qa.open .qa-a');
      for (var i = 0; i < open.length; i++) open[i].style.maxHeight = open[i].scrollHeight + 'px';
    }, 120);
  });

  window.addEventListener('hashchange', openFromHash);
  openFromHash();

  if (reduceMotion) doc.documentElement.classList.add('reduce-motion');
})();
