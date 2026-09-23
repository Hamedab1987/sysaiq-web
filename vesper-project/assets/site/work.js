/* SysaiQ — portfolio behaviours (/:lang/work, /:lang/work/:slug). Loaded with
   `defer` next to pages.js; no inline handlers (CSP script-src 'self').
   1. category filter: [data-work-filter] chips → hide/show [data-work-list] items
      by data-category, count in [data-work-status], ?cat= kept in the URL
   2. gallery lightbox: [data-gallery] links open [data-lightbox-dialog]
      (<dialog>, Esc / arrow keys / swipe, focus returns to the link);
      without <dialog> support the link simply opens the image
   Both honour prefers-reduced-motion. */
(function () {
  'use strict';

  var doc = document;
  var rtl = doc.documentElement.dir === 'rtl';
  var fa = doc.documentElement.lang === 'fa';
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var numFmt = function (n) { return fa ? Number(n).toLocaleString('fa-IR') : String(n); };

  // ---- 1. category filter -----------------------------------------------------
  var filter = doc.querySelector('[data-work-filter]');
  var list = doc.querySelector('[data-work-list]');
  var status = doc.querySelector('[data-work-status]');

  function applyFilter(cat, opts) {
    if (!filter || !list) return;
    var chips = filter.querySelectorAll('[data-filter]');
    var known = false;
    for (var i = 0; i < chips.length; i++) if (chips[i].getAttribute('data-filter') === cat) known = true;
    if (!known) cat = 'all';
    for (var j = 0; j < chips.length; j++) {
      chips[j].setAttribute('aria-pressed', chips[j].getAttribute('data-filter') === cat ? 'true' : 'false');
    }
    var items = list.children;
    var shown = 0;
    for (var k = 0; k < items.length; k++) {
      var it = items[k];
      var show = cat === 'all' || it.getAttribute('data-category') === cat;
      var was = !it.hidden;
      it.hidden = !show;
      if (show) {
        shown++;
        if (!was && !reduceMotion) {
          it.classList.remove('is-entering');
          void it.offsetWidth; // restart the animation
          it.classList.add('is-entering');
        }
      }
    }
    if (status && opts && opts.announce) {
      var tpl = filter.getAttribute(shown === 1 ? 'data-count-one' : 'data-count-many') || '{n}';
      status.textContent = tpl.replace('{n}', numFmt(shown));
    }
    if (opts && opts.push && window.history && history.replaceState) {
      var url = new URL(location.href);
      if (cat === 'all') url.searchParams.delete('cat'); else url.searchParams.set('cat', cat);
      history.replaceState(null, '', url.pathname + url.search + url.hash);
    }
  }

  if (filter && list) {
    filter.addEventListener('click', function (e) {
      var btn = e.target instanceof Element && e.target.closest('[data-filter]');
      if (!btn) return;
      applyFilter(btn.getAttribute('data-filter'), { announce: true, push: true });
    });
    var initial = null;
    try { initial = new URLSearchParams(location.search).get('cat'); } catch (err) { initial = null; }
    if (initial) applyFilter(initial, { announce: false, push: false });
  }

  // ---- 2. gallery lightbox ---------------------------------------------------
  var dialog = doc.querySelector('[data-lightbox-dialog]');
  var gallery = doc.querySelector('[data-gallery]');
  var canDialog = !!(dialog && typeof dialog.showModal === 'function');

  if (dialog && gallery && canDialog) {
    var links = gallery.querySelectorAll('[data-gal-index]');
    var img = dialog.querySelector('.w-lb__img');
    var cap = dialog.querySelector('.w-lb__cap');
    var count = dialog.querySelector('[data-lb-count]');
    var closeBtn = dialog.querySelector('[data-lb-close]');
    var current = 0;
    var opener = null;

    var show = function (i) {
      var n = links.length;
      current = ((i % n) + n) % n;
      var a = links[current];
      var thumb = a.querySelector('img');
      img.src = a.getAttribute('href');
      img.alt = (thumb && thumb.getAttribute('alt')) || '';
      cap.textContent = a.getAttribute('data-caption') || '';
      if (count) count.textContent = numFmt(current + 1) + ' / ' + numFmt(n);
      // warm the neighbours so arrow navigation feels instant
      if (n > 1) {
        var pre = new Image();
        pre.src = links[(current + 1) % n].getAttribute('href');
      }
    };
    var open = function (i, from) {
      opener = from || null;
      show(i);
      doc.documentElement.classList.add('w-lb-open');
      dialog.showModal();
      if (closeBtn) closeBtn.focus();
    };
    var close = function () { if (dialog.open) dialog.close(); };

    dialog.addEventListener('close', function () {
      doc.documentElement.classList.remove('w-lb-open');
      img.removeAttribute('src');
      if (opener && opener.isConnected) opener.focus();
      opener = null;
    });

    gallery.addEventListener('click', function (e) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      var a = e.target instanceof Element && e.target.closest('[data-gal-index]');
      if (!a) return;
      e.preventDefault();
      open(Number(a.getAttribute('data-gal-index')) || 0, a);
    });

    var swipedAt = 0;
    dialog.addEventListener('click', function (e) {
      var t = e.target;
      if (!(t instanceof Element) || Date.now() - swipedAt < 400) return; // the click that ends a swipe
      if (t.closest('[data-lb-close]')) { close(); return; }
      if (t.closest('[data-lb-next]')) { show(current + 1); return; }
      if (t.closest('[data-lb-prev]')) { show(current - 1); return; }
      // a click on the dark stage (not the image or its caption) closes
      if (t === dialog || t.hasAttribute('data-lb-stage')) close();
    });

    // Esc is native to <dialog>; arrows follow the reading direction
    dialog.addEventListener('keydown', function (e) {
      if (links.length < 2) return;
      var fwdKey = rtl ? 'ArrowLeft' : 'ArrowRight';
      var backKey = rtl ? 'ArrowRight' : 'ArrowLeft';
      if (e.key === fwdKey) { e.preventDefault(); show(current + 1); }
      else if (e.key === backKey) { e.preventDefault(); show(current - 1); }
      else if (e.key === 'Home') { e.preventDefault(); show(0); }
      else if (e.key === 'End') { e.preventDefault(); show(links.length - 1); }
    });

    // horizontal swipe on touch screens
    var sx = null;
    var sy = null;
    dialog.addEventListener('pointerdown', function (e) { if (e.pointerType !== 'mouse') { sx = e.clientX; sy = e.clientY; } });
    dialog.addEventListener('pointerup', function (e) {
      if (sx === null || links.length < 2) { sx = null; return; }
      var dx = e.clientX - sx;
      var dy = e.clientY - sy;
      sx = null;
      if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy)) return;
      // swiping toward the reading start reveals the next image
      var forward = rtl ? dx > 0 : dx < 0;
      swipedAt = Date.now();
      show(current + (forward ? 1 : -1));
    });
  }

  // ---- 3. reveal below-the-fold cards once ------------------------------------
  // only elements that start off screen are dimmed (is-pending), so nothing
  // the visitor can already see ever flickers
  if (!reduceMotion && 'IntersectionObserver' in window) {
    var targets = doc.querySelectorAll('.w-list > .w-item, .w-feat, .w-gal__item');
    var vh = window.innerHeight || 800;
    var io = new IntersectionObserver(function (entries) {
      for (var i = 0; i < entries.length; i++) {
        if (!entries[i].isIntersecting) continue;
        var el = entries[i].target;
        io.unobserve(el);
        el.classList.remove('is-pending');
        el.classList.add('is-entering');
      }
    }, { rootMargin: '0px 0px -6% 0px' });
    for (var t = 0; t < targets.length; t++) {
      if (targets[t].getBoundingClientRect().top > vh) {
        targets[t].classList.add('is-pending');
        io.observe(targets[t]);
      }
    }
    window.addEventListener('beforeprint', function () {
      var p = doc.querySelectorAll('.is-pending');
      for (var i = 0; i < p.length; i++) p[i].classList.remove('is-pending');
    });
  }
})();
