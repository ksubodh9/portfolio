/* portfolio-ai.js — interactions for Subodh Kumar AI/ML portfolio */
(function () {
  'use strict';

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ── Dynamic years-of-experience ── */
  function initYearsExperience() {
    function yearsSince(sinceStr) {
      var since = new Date(sinceStr);
      var months = (Date.now() - since.getTime()) / (1000 * 60 * 60 * 24 * 30.4368);
      var years = months / 12;
      return Math.floor(years * 2) / 2; // floor to nearest 0.5
    }
    document.querySelectorAll('.js-years-exp-badge[data-since]').forEach(function (el) {
      var years = yearsSince(el.getAttribute('data-since'));
      el.textContent = (years % 1 === 0 ? years.toFixed(0) : years.toFixed(1)) + '+';
    });
    document.querySelectorAll('.js-years-exp[data-since]').forEach(function (el) {
      var years = yearsSince(el.getAttribute('data-since'));
      var label = (years % 1 === 0 ? years.toFixed(0) : years.toFixed(1)) + '-year';
      el.textContent = label;
    });
  }
  initYearsExperience();

  /* ── Footer copyright year ── */
  var footerYear = document.getElementById('footer-year');
  if (footerYear) footerYear.textContent = new Date().getFullYear();

  /* ── Typed tagline ── */
  function initTyped() {
    var el = document.getElementById('typed-tagline');
    if (!el || typeof Typed === 'undefined') {
      if (el) el.textContent = 'AI Engineer · ML · Generative AI · RAG Systems';
      return;
    }
    new Typed('#typed-tagline', {
      strings: [
        'AI / ML Engineer',
        'Generative AI &amp; RAG Systems',
        'Predictive ML &amp; Data Science',
        'FastAPI Model Serving',
        'Vector Search &amp; Embeddings'
      ],
      typeSpeed: 46, backSpeed: 26, backDelay: 2000, loop: true, smartBackspace: true
    });
  }
  // Typed loaded with defer; wait for it
  if (document.readyState !== 'loading') setTimeout(initTyped, 0);
  window.addEventListener('load', initTyped, { once: true });

  /* ── Scroll progress ── */
  var progress = document.getElementById('scrollProgress');
  /* ── Navbar state ── */
  var navbar = document.getElementById('navbar');
  /* ── Back to top ── */
  var btt = document.getElementById('backToTop');

  function onScroll() {
    var y = window.scrollY;
    if (progress) {
      var total = document.documentElement.scrollHeight - window.innerHeight;
      progress.style.width = total > 0 ? ((y / total) * 100) + '%' : '0%';
    }
    if (navbar) navbar.classList.toggle('scrolled', y > 50);
    if (btt) btt.classList.toggle('visible', y > 500);
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  if (btt) btt.addEventListener('click', function () {
    window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
  });

  /* ── Mobile menu ── */
  var hamburger = document.getElementById('hamburger');
  var mobileMenu = document.getElementById('mobileMenu');
  var overlay = document.getElementById('mobileOverlay');
  var closeBtn = document.getElementById('mobileMenuClose');

  function openMenu() {
    mobileMenu.classList.add('open'); overlay.classList.add('open'); hamburger.classList.add('open');
    hamburger.setAttribute('aria-expanded', 'true'); mobileMenu.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  }
  function closeMenu() {
    mobileMenu.classList.remove('open'); overlay.classList.remove('open'); hamburger.classList.remove('open');
    hamburger.setAttribute('aria-expanded', 'false'); mobileMenu.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }
  if (hamburger) hamburger.addEventListener('click', function () {
    mobileMenu.classList.contains('open') ? closeMenu() : openMenu();
  });
  if (closeBtn) closeBtn.addEventListener('click', closeMenu);
  if (overlay) overlay.addEventListener('click', closeMenu);
  document.querySelectorAll('.mob-link').forEach(function (l) { l.addEventListener('click', closeMenu); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && mobileMenu && mobileMenu.classList.contains('open')) closeMenu();
  });

  /* ── Reveal on scroll (replaces AOS) ── */
  var revealEls = document.querySelectorAll('[data-reveal]');
  if (reduceMotion || !('IntersectionObserver' in window)) {
    revealEls.forEach(function (el) { el.classList.add('in'); });
  } else {
    var revealObs = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) { entry.target.classList.add('in'); revealObs.unobserve(entry.target); }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    revealEls.forEach(function (el) { revealObs.observe(el); });
  }

  /* ── Active nav section ── */
  var sections = document.querySelectorAll('section[id], header[id]');
  var navAnchors = document.querySelectorAll('.nav-links a[href^="#"]');
  if ('IntersectionObserver' in window) {
    var secObs = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          navAnchors.forEach(function (a) {
            a.classList.toggle('active', a.getAttribute('href') === '#' + entry.target.id);
          });
        }
      });
    }, { rootMargin: '-45% 0px -45% 0px' });
    sections.forEach(function (s) { secObs.observe(s); });
  }

  /* ── GitHub tech bars ── */
  var bars = document.querySelectorAll('.gh-bar i');
  if ('IntersectionObserver' in window && bars.length) {
    var barObs = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.style.width = (entry.target.dataset.w || 60) + '%';
          barObs.unobserve(entry.target);
        }
      });
    }, { threshold: 0.5 });
    bars.forEach(function (b) { barObs.observe(b); });
  } else {
    bars.forEach(function (b) { b.style.width = (b.dataset.w || 60) + '%'; });
  }

  /* ── Contact form → Web3Forms (delivers to email) ── */
  var form = document.getElementById('contactForm');
  if (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (!form.checkValidity()) { form.reportValidity(); return; }
      var btn = form.querySelector('button[type="submit"]');
      var original = btn.innerHTML;
      var reset = function (html, keepDisabled) {
        btn.innerHTML = html;
        if (!keepDisabled) {
          setTimeout(function () { btn.disabled = false; btn.innerHTML = original; }, 4500);
        }
      };
      btn.disabled = true;
      btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending...';
      fetch('https://api.web3forms.com/submit', {
        method: 'POST',
        headers: { 'Accept': 'application/json' },
        body: new FormData(form)
      })
        .then(function (r) { return r.json(); })
        .then(function (res) {
          if (res.success) { form.reset(); reset('<i class="fas fa-check"></i> Message sent!'); }
          else { reset('<i class="fas fa-exclamation-triangle"></i> Failed — email me instead'); }
        })
        .catch(function () {
          reset('<i class="fas fa-exclamation-triangle"></i> Failed — email me instead');
        });
    });
  }

  /* ── Projects category filter ── */
  var filterBtns = document.querySelectorAll('.project-filter');
  var projectCards = document.querySelectorAll('.project-grid .project-card');
  if (filterBtns.length && projectCards.length) {
    filterBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var filter = btn.getAttribute('data-filter');
        filterBtns.forEach(function (b) {
          var active = b === btn;
          b.classList.toggle('is-active', active);
          b.setAttribute('aria-selected', active ? 'true' : 'false');
        });
        projectCards.forEach(function (card) {
          var show = filter === 'all' || card.getAttribute('data-category') === filter;
          card.classList.toggle('is-hidden', !show);
        });
      });
    });
  }
}());
