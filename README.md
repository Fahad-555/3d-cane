# VOLTIC ⚡ — 3D Scroll-Driven Energy Drink Site

A single-page marketing site built around a 3D energy-drink can that reacts to
scrolling. No build step — open `index.html` and it runs.

## Run it

```bash
node serve.js      # → http://localhost:8080
```

You need a server rather than opening the file directly, because `js/app.js`
and `js/scene.js` are ES modules.

## Stack

| | |
|---|---|
| **Scroll** | [Lenis](https://github.com/darkroomengineering/lenis) for inertial scrolling |
| **Animation** | [GSAP](https://gsap.com/) + ScrollTrigger |
| **3D** | [Three.js](https://threejs.org/) |
| **Type** | Anton (display), Inter (body), JetBrains Mono (labels) |

All libraries load from CDN; there is no `package.json` and nothing to install.

## How it fits together

```
index.html        Markup for every section
css/style.css     Design tokens + all styling
js/scene.js       Everything WebGL. Owns the canvas, the can, the lights.
js/app.js         Smooth scroll, scroll choreography, page interactions.
serve.js          Local preview server
```

**The one rule:** `app.js` never touches WebGL, and `scene.js` never touches
the DOM. They meet at a single object — `scene.target`:

```js
// app.js decides where the can should be…
scene.target.x = -0.45;
scene.target.scale = 0.9;

// scene.js chases it every frame, frame-rate independently:
current.x = damp(current.x, target.x, 5.2, dt);
```

That split is why the scroll choreography stays legible. Each section claims
the can as it passes through the middle of the viewport (see `PRESETS` and
`initScrollChoreography` in `js/app.js`), and the scene's damping turns each
handoff into a glide instead of a cut.

There are two preset tables. On phones every section runs full-width, so there
is nowhere *beside* the copy for the can to stand — `PRESETS_NARROW` drops it
into the lower band of the screen and shrinks it instead. `applyPreset` takes a
section *key*, not a preset object, so it can re-resolve against the current
breakpoint at apply time and on resize.

## The 3D can

There is no `.glb` and no texture files. The can is generated at runtime:

- **Body** — a `LatheGeometry` built from an explicit profile (`buildProfile`).
- **Label** — drawn to a `<canvas>` per flavor (`makeLabelTexture`).
- **Reflections** — a small emissive room baked through `PMREMGenerator`,
  which is what makes it read as aluminium without shipping an HDR.

Two details in there are load-bearing:

1. **Point counts drive the texture mapping.** `LatheGeometry` assigns `v` by
   point *index*, not arc length, so the straight body gets 60 of the 84
   points to claim most of the texture's vertical range. `BAND_V_BOT` /
   `BAND_V_TOP` are derived from those indices so the canvas artwork and the
   geometry can't drift apart. If you change `BODY_STEPS`, those break.

2. **Text is auto-fitted to the readable arc.** Only ~28% of the
   circumference faces the camera readably; past about ±50° the surface
   foreshortens so hard that letters collapse into the silhouette. Every
   printed string runs through `fit()` and shrinks until it fits.

## Theming

One flavor drives everything — can artwork, scene lights, and every accent on
the page:

```js
// js/scene.js
export const FLAVORS = [
  { key: 'citrus',  name: 'Citrus Storm', accent: '#c8ff00', base: '#5c7a06', deep: '#131a02', ink: '#f7f7f8' },
  …
];
```

`accent` is written to `--accent` / `--accent-rgb` on `:root`, so the whole
page restyles from that one value. Add a fourth flavor and the switcher picks
it up automatically.

## Accessibility & resilience

- `prefers-reduced-motion` disables smooth scroll, idle spin, reveals, and the
  grain animation.
- Reveal animations are set from JS, never CSS, so copy stays visible if the
  script fails.
- No WebGL → the canvas is dropped and the page renders with a CSS gradient.
- The font wait is bounded at 3s; if webfonts are slow the label is baked with
  a fallback face and re-baked once the real font lands (`refreshLabels`).
- A failed boot still removes the preloader rather than leaving a black screen.
