/* ============================================================
   VOLTIC — condensation
   The can reads as chilled glass because of what is sitting on it,
   not because of the glass itself. A cold can wears a film of
   beads, and the beads are what catch the light — so they are
   worth more to the illusion than any amount of shader work on
   the wall underneath.

   Both maps come out of a single height field. Droplets are
   stamped into a Float32 grid as overlapping caps, keeping the
   tallest at each pixel, and the normals are read back out of that
   grid by finite difference at the end. Stamping a height rather
   than a normal is what lets beads merge where they overlap
   instead of fighting; the roughness map then falls out of the
   same grid for free, since a bead is glassy and the dry wall
   between beads is not.

   No Math.random anywhere. app.js rebakes the artwork once the
   webfonts land, and a texture that reshuffled itself at that
   moment would make every droplet visibly crawl across the can.
   ============================================================ */

import * as THREE from 'three';

const TAU = Math.PI * 2;

/* Height of a bead as a fraction of its own radius. Real droplets on
   a smooth surface sit at a shallow contact angle — push this toward
   1 and they turn into hemispheres, which reads as hailstones. */
const BEAD_FLAT = 0.38;

/* The exponent in the bead profile. 0.5 is a true spherical cap and
   has an infinite slope at the rim, which the finite difference
   below turns into a hard black ring; a little above that softens
   the contact line to something a camera would actually resolve. */
const BEAD_FALLOFF = 0.62;

/* Dry glass these two, bead surface the first. Water is smoother
   than the thing it condenses on. */
const ROUGH_BEAD = 0.02;
const ROUGH_DRY = 0.09;

/* A thin fog of micro-condensation over part of the surface. Without
   it the beads look vacuum-packed onto perfectly clean glass. */
const ROUGH_FOG = 0.30;

function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/* ── Stamping ────────────────────────────────────────────────
   One cap, added into the height field. Only the cap's own
   bounding box is touched, and an existing taller bead wins, so
   the cost is proportional to the ink rather than to the canvas.

   The field and its dimensions are separate parameters for a
   reason: `field - 1` silently stringifies the whole million-entry
   array (and the bounds check then compares against NaN, which is
   false for every index, so nothing gets stamped at all).
   ─────────────────────────────────────────────────────────── */
function stampBead(field, W, H, cx, cy, r, flat) {
  const x0 = Math.max(0, Math.floor(cx - r));
  const x1 = Math.min(W - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r));
  const y1 = Math.min(H - 1, Math.ceil(cy + r));
  const r2 = r * r;

  for (let y = y0; y <= y1; y++) {
    const dy = y - cy;
    const row = y * W;
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx;
      const d2 = (dx * dx + dy * dy) / r2;
      if (d2 >= 1) continue;
      // Height in *pixels*, so the finite difference downstream is
      // already a slope and needs no scale factor to become a normal.
      const h = flat * r * Math.pow(1 - d2, BEAD_FALLOFF);
      const i = row + x;
      if (h > field[i]) field[i] = h;
    }
  }
}

/* A run: the shape a bead takes once it gets heavy enough to slide.
   Stamped as a chain of caps so it merges into the field the same
   way a round bead does, and so its own surface stays curved. */
function stampRun(field, W, H, cx, cy, r, len, rnd) {
  const steps = Math.max(2, Math.round(len / (r * 0.55)));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    // Narrowing toward the tail is what makes it read as a drip
    // rather than a worm.
    const rr = r * (1.0 - 0.42 * t);
    const wobble = Math.sin(t * Math.PI * 2.2) * r * 0.16;
    stampBead(field, W, H, cx + wobble + (rnd() - 0.5) * r * 0.1, cy + len * t, rr, BEAD_FLAT);
  }
}

/* ── Blotch field ────────────────────────────────────────────
   A cheap low-frequency field in [0,1] built from a couple of sines.
   It does two jobs at once, which is the point: it gates where beads
   are allowed to form, and it drives the fog. Sharing one field means
   the two agree — a dry panel has neither beads nor a bloom of
   micro-condensation on it, instead of the fog quietly filling in
   everywhere the beads were told not to go.

   The frequency is deliberate. High enough to give several distinct
   patches across the wrap, low enough that each patch is large
   compared with a bead, so it reads as a wet region rather than as
   noise. */
function blotch(x, y, W, H) {
  const u = (x / W) * TAU;
  const v = (y / H) * TAU;
  const a = Math.sin(u * 1.7 + Math.cos(v * 1.1)) * Math.cos(v * 2.3 + 0.8);
  const b = Math.sin(u * 3.1 - 0.4) * Math.cos(v * 4.7 + 1.7);
  return 0.5 + 0.5 * (a * 0.7 + b * 0.3);
}

/* ── The field ───────────────────────────────────────────────
   Condensation is not uniform. It beads around nucleation points,
   pools and runs downward as it gets heavy, and leaves whole panels
   close to dry. Every pass below is therefore gated on `wetAt`: the
   counts say what the *wet* regions look like, and the blotch field
   decides how much of the can is one.

   That gate is what separates water from golf ball. Covering the can
   evenly at any density gives a texture that reads as machined metal,
   however good the individual bead is — the eye needs clean glass
   between the droplets to recognise them as droplets at all.
   ─────────────────────────────────────────────────────────── */
function buildHeightField(size, seed) {
  const H = new Float32Array(size * size);
  const rnd = lcg(seed);

  /* Counts are per *pixel*, not per row. A bead's radius is a
     fraction of the canvas, so its area grows with size squared —
     scale the counts by `size` alone and the 2048 map comes out
     four times as inked as the 1024 one, for no reason but the
     resolution. These keep the coverage identical at any size. */
  const area = size * size;

  // Droplets get denser and heavier toward the lower half, so y is
  // drawn from a distribution biased toward the bottom rather than
  // uniformly. Canvas y grows downward, and the texture is flipped
  // on load, so canvas-bottom is the bottom of the can.
  const yAt = () => size * Math.pow(rnd(), 0.56);

  const wetAt = (x, y) => blotch(x, y, size, size);

  // Fine mist. Kept deliberately sparse: this is the pass that turns
  // into visual noise at any real viewing distance, and its only job
  // is to stop the glass looking wiped clean. The bloom of
  // micro-condensation that fills the gaps belongs to the roughness
  // map, where it costs nothing and cannot shimmer.
  for (let i = 0; i < area * 0.0034; i++) {
    const x = rnd() * size;
    const y = yAt();
    if (rnd() > 0.14 + 0.86 * wetAt(x, y)) continue;
    const r = size * (0.0006 + rnd() * 0.0019);
    stampBead(H, size, size, x, y, r, BEAD_FLAT * 0.60);
  }

  // Mid beads — the ones that carry the effect at normal viewing
  // distance. Grouped in loose clumps of three to seven, because
  // condensation forms around nucleation points rather than falling
  // evenly, and a scatter of same-sized circles reads as a pattern.
  for (let c = 0; c < area * 0.00022; c++) {
    const cx = rnd() * size;
    const cy = yAt();
    if (rnd() > 0.10 + 0.90 * wetAt(cx, cy)) continue;
    const spread = size * (0.010 + rnd() * 0.034);
    const n = 3 + Math.floor(rnd() * 5);
    for (let i = 0; i < n; i++) {
      const a = rnd() * TAU;
      const d = rnd() * spread;
      const r = size * (0.0026 + rnd() * rnd() * 0.0080);
      stampBead(H, size, size, cx + Math.cos(a) * d, cy + Math.sin(a) * d, r, BEAD_FLAT);
    }
  }

  // A few genuinely large beads, for the close-up hero shot. They sit
  // where the surface is coolest, so they favour the lower half
  // harder than everything else.
  for (let i = 0; i < area * 0.000030; i++) {
    const x = rnd() * size;
    const y = size * Math.pow(rnd(), 0.40);
    if (rnd() > 0.20 + 0.80 * wetAt(x, y)) continue;
    const r = size * (0.010 + rnd() * rnd() * 0.022);
    stampBead(H, size, size, x, y, r, BEAD_FLAT);
  }

  // Runs. Confined to the lower two thirds — water that has started
  // moving has had time to get there.
  for (let i = 0; i < area * 0.000012; i++) {
    const x = rnd() * size;
    const y = size * (0.28 + rnd() * 0.60);
    if (rnd() > 0.25 + 0.75 * wetAt(x, y)) continue;
    const r = size * (0.0028 + rnd() * 0.0055);
    const len = size * (0.02 + rnd() * 0.10);
    stampRun(H, size, size, x, y, r, len, rnd);
  }

  return H;
}

/* ── Field → maps ────────────────────────────────────────────
   Tangents come from the UV parameterisation, and the canvas is
   drawn with y down while the texture is sampled with v up, so the
   green channel carries the *negated* gradient. Get that sign
   wrong and every bead is lit from underneath.
   ─────────────────────────────────────────────────────────── */
export function makeCondensationMaps(size = 2048, seed = 0x5f3a21) {
  const W = size;
  const H = size;
  const field = buildHeightField(size, seed);

  const normal = document.createElement('canvas');
  normal.width = W;
  normal.height = H;
  const nctx = normal.getContext('2d');
  const nimg = nctx.createImageData(W, H);
  const nd = nimg.data;

  const rough = document.createElement('canvas');
  rough.width = W;
  rough.height = H;
  const rctx = rough.getContext('2d');
  const rimg = rctx.createImageData(W, H);
  const rd = rimg.data;

  // A soft blotch field for the fog. This is the same field the beads
  // were gated on, so the film of micro-condensation sits exactly
  // where the beads are and the dry panels stay dry — which is what
  // makes a wet patch read as a patch rather than as a tint.

  // Finite difference is central in x and one-sided at the top and
  // bottom rows; x wraps, because u wraps all the way around the can
  // and a hard edge there shows up as a seam.
  for (let y = 0; y < H; y++) {
    const yUp = y > 0 ? y - 1 : 0;
    const yDn = y < H - 1 ? y + 1 : H - 1;
    const spanY = yDn - yUp || 1;

    for (let x = 0; x < W; x++) {
      const xL = (x - 1 + W) % W;
      const xR = (x + 1) % W;

      const i = y * W + x;
      const h = field[i];
      const wet = h > 0.0001;

      // Slopes, in pixels of height per pixel of canvas.
      let gx = (field[y * W + xR] - field[y * W + xL]) * 0.5;
      let gy = (field[yDn * W + x] - field[yUp * W + x]) / spanY;

      // The bead rim is a genuine near-vertical wall in the profile,
      // so the raw difference spikes there. Clamping keeps the rim
      // crisp without letting it turn into a black outline.
      const LIM = 1.35;
      gx = gx > LIM ? LIM : gx < -LIM ? -LIM : gx;
      gy = gy > LIM ? LIM : gy < -LIM ? -LIM : gy;

      // n = normalize(-dh/du, -dh/dv, 1), with dv opposing canvas y.
      const nx = -gx;
      const ny = gy;
      const inv = 1 / Math.sqrt(nx * nx + ny * ny + 1);

      const o = i * 4;
      nd[o]     = (nx * inv * 0.5 + 0.5) * 255;
      nd[o + 1] = (ny * inv * 0.5 + 0.5) * 255;
      nd[o + 2] = (inv * 0.5 + 0.5) * 255;
      nd[o + 3] = 255;

      const g = wet
        ? ROUGH_BEAD
        : ROUGH_DRY + (ROUGH_FOG - ROUGH_DRY) * Math.pow(blotch(x, y, W, H), 2.2);
      const rg = g * 255;
      rd[o] = rd[o + 1] = rd[o + 2] = rg;
      rd[o + 3] = 255;
    }
  }

  nctx.putImageData(nimg, 0, 0);
  rctx.putImageData(rimg, 0, 0);

  const mk = (canvas, srgb) => {
    const t = new THREE.CanvasTexture(canvas);
    // A normal map holds a direction, not a colour: leaving it in
    // sRGB makes the renderer gamma-decode it and bend every normal
    // toward the surface.
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.ClampToEdgeWrapping;
    t.anisotropy = 8;
    t.needsUpdate = true;
    return t;
  };

  return {
    normalMap: mk(normal, false),
    roughnessMap: mk(rough, false),
    dispose() {
      this.normalMap.dispose();
      this.roughnessMap.dispose();
    },
  };
}
