/* ============================================================
   VOLTIC — app
   Owns everything that isn't Three.js: smooth scroll, the scroll
   choreography that drives the can, and the page's interactions.
   app.js writes to `scene.target`; scene.js is the only thing
   that touches WebGL.
   ============================================================ */

import { createScene, FLAVORS } from './scene.js';

const gsap = window.gsap;
const ScrollTrigger = window.ScrollTrigger;
const Lenis = window.Lenis;

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

gsap.registerPlugin(ScrollTrigger);

/* Where the can sits and how it behaves per section. x/y are in
   world units (the can is ~2 wide), scale is a multiplier. The canvas
   is viewport-fixed, so these are fixed screen positions that each
   section claims as it passes — not scroll-relative offsets. */
const PRESETS = {
  /* The reference's opening frame: the can on its side, laid across
     the giant wordmark. rotZ of -90° drops the lid to the right,
     which is the way round that leaves the printed wordmark reading
     top-to-bottom down the can, the way the reference has it. */
  hero:    { x:  0.00, y:  0.35, scale: 1.06, rotX:  0.00, rotZ: -Math.PI / 2, spin: 0.05 },
  // Chapters sit on the left, so the can takes the right. Everything
  // from here on stands upright.
  about:   { x:  1.45, y:  0.00, scale: 0.78, rotX:  0.06, rotZ: 0, spin: 0.16 },
  // The flavor list is on the right; the can sits between it and the
  // headline without colliding with either.
  flavors: { x: -0.45, y:  0.00, scale: 0.90, rotX:  0.00, rotZ: 0, spin: 0.22 },
  // The specs grid only spans the left 60%, leaving this column clear.
  specs:   { x:  2.05, y:  0.00, scale: 0.52, rotX:  0.08, rotZ: 0, spin: 0.12 },
  cta:     { x:  0.00, y:  0.25, scale: 0.60, rotX:  0.00, rotZ: 0, spin: 0.07 },
  // Footer is dense edge to edge, so the can exits stage right rather
  // than sitting on top of the signup form.
  footer:  { x:  6.00, y:  0.50, scale: 0.45, rotX:  0.05, rotZ: 0, spin: 0.05 },
};

/* On phones every section runs full-width, so there is nowhere *beside*
   the copy for the can to stand — the desktop values drop it straight
   onto the text. It goes to the lower band of the screen and shrinks
   instead: still the thing you're looking at, never the thing you're
   reading through. (`#webgl` is held back in opacity at this width too,
   for the frames where the two do cross.)

   Note y is world space, where positive is *up* — so the lower band is
   negative. */
const PRESETS_NARROW = {
  /* Laid on its side and dropped below the copy. `.hero` stops
     distributing its children on narrow (see the media query) so the
     eyebrow, sub and buttons stack from the top and leave the lower
     half of the screen free — this is what goes in it. The scale is
     chosen against viewportScale, which shrinks the can in proportion
     to the viewport width, so the same number keeps the can spanning
     the same share of the screen from 320px up. */
  hero:    { x: 0.00, y: -0.90, scale: 0.50, rotX: 0.00, rotZ: -Math.PI / 2, spin: 0.05 },
  about:   { x: 0.00, y: -2.05, scale: 0.40, rotX: 0.06, rotZ: 0, spin: 0.16 },
  flavors: { x: 0.00, y: -2.05, scale: 0.40, rotX: 0.00, rotZ: 0, spin: 0.22 },
  // The grid is opaque and full-width here, so the can is occluded
  // either way — parked low rather than left half-cut at the edge.
  specs:   { x: 0.00, y: -1.95, scale: 0.40, rotX: 0.08, rotZ: 0, spin: 0.12 },
  // The finale keeps the can behind the type, where the headline is
  // heavy enough to read straight over it.
  cta:     { x: 0.00, y:  0.60, scale: 0.58, rotX: 0.00, rotZ: 0, spin: 0.07 },
  footer:  { x: 6.00, y:  0.50, scale: 0.45, rotX: 0.05, rotZ: 0, spin: 0.05 },
};

const NARROW_MAX = 760;
const isNarrow = () => window.innerWidth <= NARROW_MAX;
const resolvePreset = (key) => (isNarrow() && PRESETS_NARROW[key]) || PRESETS[key];

/* ── Small helpers ──────────────────────────────────────── */
const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function hexToRgbTriplet(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}

/* ══════════════════════════════════════════════════════════
   1. Page interactions — independent of WebGL, so they run
      even if the 3D context fails.
   ══════════════════════════════════════════════════════════ */
function initUI() {
  initCursor();
  initNav();
  initMagnetic();
  initMarquee();
  initTilt();
  initSubscribe();
}

/* ── Custom cursor ──────────────────────────────────────── */
function initCursor() {
  if (!finePointer) return;

  const cursor = $('#cursor');
  const dot = $('.cursor__dot');
  const ring = $('.cursor__ring');
  if (!cursor) return;

  const dotX = gsap.quickTo(dot, 'x', { duration: 0.12, ease: 'power2.out' });
  const dotY = gsap.quickTo(dot, 'y', { duration: 0.12, ease: 'power2.out' });
  const ringX = gsap.quickTo(ring, 'x', { duration: 0.42, ease: 'power3.out' });
  const ringY = gsap.quickTo(ring, 'y', { duration: 0.42, ease: 'power3.out' });

  window.addEventListener('mousemove', (e) => {
    cursor.classList.add('is-on');
    dotX(e.clientX); dotY(e.clientY);
    ringX(e.clientX); ringY(e.clientY);
  }, { passive: true });

  document.addEventListener('mouseleave', () => cursor.classList.remove('is-on'));

  // Delegated so it also covers nodes added later.
  document.addEventListener('mouseover', (e) => {
    if (e.target.closest('a, button, [data-cursor]')) cursor.classList.add('is-hover');
  });
  document.addEventListener('mouseout', (e) => {
    if (e.target.closest('a, button, [data-cursor]')) cursor.classList.remove('is-hover');
  });
}

/* ── Nav: condense on scroll, hide on the way down ──────── */
function initNav() {
  const nav = $('#nav');
  const burger = $('#burger');
  const menu = $('#mobileMenu');

  ScrollTrigger.create({
    start: 'top -60',
    end: 99999,
    onUpdate: (self) => {
      nav.classList.add('is-scrolled');
      // Never hide the bar while the mobile menu is open.
      nav.classList.toggle('is-hidden', self.direction === 1 && !menu.classList.contains('is-open'));
    },
    onLeaveBack: () => {
      nav.classList.remove('is-scrolled', 'is-hidden');
    },
  });

  burger.addEventListener('click', () => {
    const open = menu.classList.toggle('is-open');
    burger.classList.toggle('is-open', open);
    burger.setAttribute('aria-expanded', String(open));
    document.body.classList.toggle('is-locked', open);
  });

  $$('.mobile-menu a').forEach((a) => a.addEventListener('click', () => {
    menu.classList.remove('is-open');
    burger.classList.remove('is-open');
    burger.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('is-locked');
  }));
}

/* ── Magnetic buttons ───────────────────────────────────── */
function initMagnetic() {
  if (!finePointer) return;

  $$('[data-magnetic]').forEach((el) => {
    const strength = 0.3;
    const xTo = gsap.quickTo(el, 'x', { duration: 0.6, ease: 'power3.out' });
    const yTo = gsap.quickTo(el, 'y', { duration: 0.6, ease: 'power3.out' });

    el.addEventListener('mousemove', (e) => {
      const r = el.getBoundingClientRect();
      xTo((e.clientX - (r.left + r.width / 2)) * strength);
      yTo((e.clientY - (r.top + r.height / 2)) * strength);
    });
    el.addEventListener('mouseleave', () => { xTo(0); yTo(0); });
  });
}

/* ── Marquees ───────────────────────────────────────────── */
let marqueeTweens = [];

function buildMarquees() {
  marqueeTweens.forEach((t) => t.kill());
  marqueeTweens = [];

  $$('[data-marquee]').forEach((track) => {
    // clamp() font sizes mean one copy's width changes with the
    // viewport, so this is rebuilt on resize rather than measured once.
    if (!track.dataset.original) track.dataset.original = track.innerHTML;

    // Three copies guarantees the strip is wider than any viewport, so
    // a one-copy shift loops seamlessly.
    track.innerHTML = track.dataset.original.repeat(3);

    const dir = parseFloat(track.dataset.speed) || 1;
    const oneCopy = track.scrollWidth / 3;
    if (!oneCopy) return;

    gsap.set(track, { x: dir > 0 ? -oneCopy : 0 });

    marqueeTweens.push(gsap.to(track, {
      x: dir > 0 ? 0 : -oneCopy,
      duration: oneCopy / 72,   // constant px/sec regardless of width
      ease: 'none',
      repeat: -1,
    }));
  });
}

function initMarquee() {
  buildMarquees();

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(buildMarquees, 220);
  });
}

/* ── Spec cards: 3D tilt + cursor-tracked glow ──────────── */
function initTilt() {
  if (!finePointer) return;

  $$('[data-tilt]').forEach((card) => {
    const setProp = (x, y) => {
      card.style.setProperty('--mx', `${x}%`);
      card.style.setProperty('--my', `${y}%`);
    };
    setProp(50, 50);

    card.addEventListener('mousemove', (e) => {
      const r = card.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width;
      const py = (e.clientY - r.top) / r.height;
      setProp(px * 100, py * 100);
      gsap.to(card, {
        rotateY: (px - 0.5) * 9,
        rotateX: (0.5 - py) * 9,
        transformPerspective: 900,
        duration: 0.5,
        ease: 'power2.out',
      });
    });

    card.addEventListener('mouseleave', () => {
      gsap.to(card, { rotateX: 0, rotateY: 0, duration: 0.8, ease: 'power3.out' });
    });
  });
}

/* ── Footer signup ──────────────────────────────────────── */
function initSubscribe() {
  const form = $('#subscribe');
  const msg = $('#subscribeMsg');
  if (!form) return;

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('input', form);
    const value = input.value.trim();
    const valid = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);

    msg.classList.toggle('is-ok', valid);
    msg.classList.toggle('is-err', !valid);
    msg.textContent = valid ? '✓ You’re on the list.' : 'Enter a valid email address.';
    if (valid) input.value = '';
  });
}

/* ══════════════════════════════════════════════════════════
   2. Smooth scroll + boot
   ══════════════════════════════════════════════════════════ */
async function boot() {
  // The label artwork is drawn in Anton and the marquee strips are
  // measured in it too, so the font has to resolve before either
  // happens — otherwise we'd rasterise a fallback face into the can
  // texture and mis-measure the marquee loop. initUI() runs after.
  //
  // The wait is bounded: a slow or blocked font CDN must never leave the
  // preloader on screen forever. On timeout we bake with the fallback
  // face and re-bake once the real font arrives.
  let fontsResolved = false;
  if (document.fonts && document.fonts.ready) {
    fontsResolved = await Promise.race([
      document.fonts.ready.then(() => true),
      new Promise((resolve) => setTimeout(() => resolve(false), 3000)),
    ]);
  }

  initUI();

  const canvas = $('#webgl');
  let scene = null;

  try {
    scene = createScene(canvas);
  } catch (err) {
    // No WebGL (old browser, disabled, blacklisted driver) — the page
    // is fully readable without the can, so degrade rather than break.
    console.warn('[voltic] WebGL unavailable, continuing without 3D:', err);
    canvas.style.display = 'none';
    $('#webglFallback').classList.add('is-on');
  }

  if (scene && !fontsResolved && document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => scene.refreshLabels());
  }

  initScroll(scene);

  // Settle every trigger against the real layout before the entrance
  // runs, so a refresh can't yank the can mid-animation.
  ScrollTrigger.refresh();

  await runLoader();

  // Pose first, then park: the preset decides where the can lies and
  // `park` collapses its scale and spin on top of that, which is what
  // the entrance unwinds from.
  applyPreset('hero');
  if (scene) scene.park();

  // Debug handle — lets _probe.mjs park the can and inspect state
  // without having to drive the whole scroll narrative.
  window.__voltic = {
    scene,
    target: scene ? scene.target : null,
    applyPreset,
    PRESETS,
    PRESETS_NARROW,
    resolvePreset,
  };

  playIntro();

  // Late layout shifts (images, webfont fallback swap) move section
  // boundaries, so re-settle once everything has loaded.
  window.addEventListener('load', () => ScrollTrigger.refresh());
}

/* ── Lenis + GSAP on one clock ──────────────────────────── */
let lenis = null;
let scrollVelocity = 0;

function initScroll(scene) {
  if (Lenis) {
    lenis = new Lenis({
      duration: reduceMotion ? 0 : 1.15,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      smoothWheel: !reduceMotion,
      syncTouch: false,       // native momentum on touch reads better
      touchMultiplier: 1.6,
      wheelMultiplier: 1,
    });

    // Single clock: Lenis, the renderer, and ScrollTrigger all advance
    // from gsap.ticker, so they can never disagree about time.
    gsap.ticker.add((time, deltaTime) => {
      lenis.raf(time * 1000);

      scrollVelocity = lenis.velocity || 0;

      if (scene) {
        // Scrolling spins the can — the faster you move, the more it
        // turns. This is what sells it as scroll-driven rather than
        // a looping animation.
        scene.target.rotY += scrollVelocity * 0.0032;
        scene.update(Math.min(deltaTime / 1000, 1 / 30));
      }
    });

    gsap.ticker.lagSmoothing(0);
    lenis.on('scroll', ScrollTrigger.update);
  } else if (scene) {
    // No Lenis — fall back to a plain rAF loop.
    let last = performance.now();
    const loop = (now) => {
      const dt = Math.min((now - last) / 1000, 1 / 30);
      last = now;
      scene.update(dt);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  initPointer(scene);
  initScrollChoreography(scene);
  initChapterScroll();
  initFlavorControl(scene);
  initSectionReveals();

  window.addEventListener('resize', () => {
    if (scene) scene.resize();
    // The presets are breakpoint-dependent, so a resize that crosses the
    // narrow boundary has to re-land the can on the current section.
    applyPreset(activePresetKey);
    ScrollTrigger.refresh();
  });

  if (reduceMotion) {
    $$('.marquee__track span, .hero__scrollbar i').forEach((el) => { el.style.animation = 'none'; });
  }
}

/* ── Pointer parallax ───────────────────────────────────── */
function initPointer(scene) {
  if (!scene || !finePointer || reduceMotion) return;
  window.addEventListener('mousemove', (e) => {
    scene.setPointer(
      (e.clientX / window.innerWidth) * 2 - 1,
      -((e.clientY / window.innerHeight) * 2 - 1)
    );
  }, { passive: true });
}

/* ── Anchors go through Lenis so easing stays consistent ── */
function initAnchors() {
  if (!lenis) return;
  $$('a[href^="#"]').forEach((a) => {
    a.addEventListener('click', (e) => {
      const id = a.getAttribute('href');
      if (id === '#' || id.length < 2) return;
      const targetEl = document.querySelector(id);
      if (!targetEl) return;
      e.preventDefault();
      lenis.scrollTo(targetEl, { offset: -60, duration: 1.4 });
    });
  });
}

/* ── Section → can preset ───────────────────────────────── */
let activePresetKey = 'hero';

function applyPreset(key) {
  activePresetKey = key;
  if (!currentScene) return;

  // Resolved at apply time rather than captured, so crossing the narrow
  // breakpoint re-lands the can instead of stranding it where the other
  // layout wanted it.
  const preset = resolvePreset(key);
  const t = currentScene.target;
  t.x = preset.x;
  t.y = preset.y;
  t.scale = preset.scale;
  t.rotX = preset.rotX;
  t.rotZ = preset.rotZ || 0;
  t.spin = reduceMotion ? 0 : preset.spin;
}

let currentScene = null;

function initScrollChoreography(scene) {
  currentScene = scene;

  // Each section claims the can while it occupies the middle of the
  // viewport. The scene's own damping turns the handoff into a glide.
  const bind = (selector, key, start, end) => {
    const el = $(selector);
    if (!el) return;
    ScrollTrigger.create({
      trigger: el,
      start: start || 'top 65%',
      end: end || 'bottom 35%',
      onToggle: (self) => { if (self.isActive) applyPreset(key); },
    });
  };

  bind('.hero',    'hero',    'top top',  'bottom 55%');
  bind('.about',   'about',   'top 55%',  'bottom 55%');
  bind('.flavors', 'flavors', 'top 55%',  'bottom 55%');
  bind('.specs',   'specs',   'top 65%',  'bottom 45%');
  bind('.cta',     'cta',     'top 70%',  'bottom 60%');

  // The footer runs right to the end of the document, so a normal
  // start/end range sits at progress === 1 — inactive — exactly when the
  // footer fills the screen, and the can would never be handed off.
  // Bind it one-way instead: entering hands the can off, leaving restores.
  const footer = $('.footer');
  if (footer) {
    ScrollTrigger.create({
      trigger: footer,
      start: 'top 75%',
      onEnter: () => applyPreset('footer'),
      onLeaveBack: () => applyPreset('cta'),
    });
  }

  initAnchors();
}

/* ── Pinned chapters ────────────────────────────────────── */
function initChapterScroll() {
  const chapters = $$('.chapter');
  const bar = $('#chapterBar');
  if (!chapters.length) return;

  let active = 0;
  const setChapter = (i) => {
    if (i === active) return;
    active = i;
    chapters.forEach((c, n) => c.classList.toggle('is-active', n === i));
  };

  ScrollTrigger.create({
    trigger: '.about',
    start: 'top top',
    end: 'bottom bottom',
    onUpdate: (self) => {
      const p = self.progress;
      if (bar) bar.style.width = `${p * 100}%`;
      setChapter(Math.min(chapters.length - 1, Math.floor(p * chapters.length)));
    },
    onLeaveBack: () => setChapter(0),
  });

  // Deep-linking straight to #about should still show chapter 01.
  if (location.hash === '#about') setChapter(0);
}

/* ── Flavor switcher ────────────────────────────────────── */
function initFlavorControl(scene) {
  const buttons = $$('.flavor');
  const readout = $('#flavorReadout');
  if (!buttons.length) return;

  let activeIndex = 0;
  let userChose = false;
  let autoTimer = null;

  const select = (index) => {
    activeIndex = index;
    buttons.forEach((b, i) => b.classList.toggle('is-active', i === index));

    const flavor = FLAVORS[index];
    if (flavor) {
      // One source of truth: the same color drives the can, the lights,
      // and every accent on the page.
      document.documentElement.style.setProperty('--accent', flavor.accent);
      document.documentElement.style.setProperty('--accent-rgb', hexToRgbTriplet(flavor.accent));
      if (scene) scene.setFlavor(index);
      if (readout) readout.textContent = `${flavor.name.toUpperCase()} · 500 ML · 200 MG CAFFEINE · 0 G SUGAR`;
    }
  };

  buttons.forEach((btn) => {
    btn.addEventListener('click', () => {
      userChose = true;
      stopAuto();
      select(Number(btn.dataset.flavor));
    });
  });

  const stopAuto = () => { if (autoTimer) { clearInterval(autoTimer); autoTimer = null; } };
  const startAuto = () => {
    if (userChose || reduceMotion || autoTimer) return;
    autoTimer = setInterval(() => select((activeIndex + 1) % FLAVORS.length), 6000);
  };

  // Only cycle while the section is actually on screen, and hand
  // control to the user permanently the moment they click.
  const section = $('.flavors');
  if (section) {
    ScrollTrigger.create({
      trigger: section,
      start: 'top 60%',
      end: 'bottom 40%',
      onToggle: (self) => (self.isActive ? startAuto() : stopAuto()),
    });
  }

  select(0);
}

/* ── Section reveals ────────────────────────────────────── */
function initSectionReveals() {
  // Set initial state from JS, never CSS — the copy stays visible if
  // the script never runs.
  const splitLines = $$('.line__inner');
  gsap.set(splitLines, { yPercent: 115 });
  gsap.set($$('main [data-reveal], .footer [data-reveal]'), { opacity: 0, y: 26 });

  if (reduceMotion) {
    gsap.set(splitLines, { yPercent: 0 });
    gsap.set($$('[data-reveal]'), { opacity: 1, y: 0 });
    return;
  }

  $$('section').forEach((section) => {
    // The hero is choreographed by playIntro() against the preloader,
    // not by scroll position — a scroll trigger here would fire
    // immediately and fight it.
    if (section.classList.contains('hero')) return;

    const lines = $$('.line__inner', section);
    const reveals = $$('[data-reveal]', section);
    if (!lines.length && !reveals.length) return;

    // Pinned sections are at the top of the viewport the moment they
    // pin, so a percentage start would fire while their copy is still
    // below the fold.
    const pinned = section.classList.contains('about') || section.classList.contains('flavors');

    const tl = gsap.timeline({
      scrollTrigger: { trigger: section, start: pinned ? 'top top' : 'top 72%' },
      defaults: { ease: 'expo.out' },
    });
    if (lines.length) tl.to(lines, { yPercent: 0, duration: 1.15, stagger: 0.08 });
    if (reveals.length) tl.to(reveals, { opacity: 1, y: 0, duration: 0.9, ease: 'power3.out', stagger: 0.08 }, 0.12);
  });

  // Marquee strips accelerate with scroll velocity.
  ScrollTrigger.create({
    start: 0,
    end: 'max',
    onUpdate: () => {
      const boost = gsap.utils.clamp(1, 4, 1 + Math.abs(scrollVelocity) * 0.02);
      marqueeTweens.forEach((t) => t.timeScale(boost));
    },
  });
}

/* ── Preloader ──────────────────────────────────────────── */
function runLoader() {
  return new Promise((resolve) => {
    const num = $('#loaderNum');
    const bar = $('#loaderBar');
    const counter = { v: 0 };

    gsap.timeline({ onComplete: resolve })
      .to(counter, {
        v: 100,
        duration: reduceMotion ? 0.2 : 1.5,
        ease: 'power2.inOut',
        onUpdate: () => {
          const val = Math.round(counter.v);
          if (num) num.textContent = val;
          if (bar) bar.style.width = `${val}%`;
        },
      })
      .to('.loader__inner', { opacity: 0, y: -24, duration: 0.45, ease: 'power2.in' }, '+=0.15')
      // Curtain collapses downward, wiping the site into view.
      .to('.loader__curtain', { scaleY: 0, duration: 1, ease: 'expo.inOut' }, '-=0.1')
      .set('#loader', { display: 'none' });
  });
}

/* ── Hero entrance ──────────────────────────────────────── */
function playIntro() {
  const heroReveals = $$('.hero [data-reveal]');
  const word = $('.stage-word span');

  if (reduceMotion) {
    gsap.set(heroReveals, { opacity: 1, y: 0 });
    return;
  }

  const tl = gsap.timeline({ defaults: { ease: 'expo.out' } })
    .from('.nav', { yPercent: -110, opacity: 0, duration: 0.9 })
    .to(heroReveals, { opacity: 1, y: 0, duration: 0.9, ease: 'power3.out', stagger: 0.1 }, 0.35)
    .from('.hero__rail', { opacity: 0, x: 16, duration: 0.8 }, 0.6);

  // The wordmark is already wider than the viewport and cropped by its
  // own container, so it cannot slide in from anywhere without the
  // frame appearing to drift. It grows out of the crop instead, which
  // is also what makes the can passing in front of it read as depth.
  if (word) tl.from(word, { scale: 1.4, opacity: 0, duration: 1.5 }, 0);
}

/* ── Go ─────────────────────────────────────────────────── */
boot().catch((err) => {
  // If anything in boot fails, the page must still be usable: pull the
  // loader and show the copy rather than leaving a black screen.
  console.error('[voltic] boot failed:', err);
  const loader = document.getElementById('loader');
  if (loader) loader.style.display = 'none';
  gsap.set('.line__inner', { yPercent: 0 });
  gsap.set('[data-reveal]', { opacity: 1, y: 0 });
});
