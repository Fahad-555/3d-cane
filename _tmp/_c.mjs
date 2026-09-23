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

/* ── The field ───────────────────────────────────────────────
   Condensation is not uniform. It pools downward as it runs, it
   beads larger where the surface is cooler, and it leaves gaps
   where something has already run off. Three passes, each one
   bigger and sparser than the last, over a floor of fine mist.
   ─────────────────────────────────────────────────────────── */
function buildHeightField(size, seed) {
  const H = new Float32Array(size * size);
  const rnd = lcg(seed);

  // Droplets get denser and heavier toward the lower half, so y is
  // drawn from a distribution biased toward the bottom rather than
  // uniformly. Canvas y grows downward, and the texture is flipped
  // on load, so canvas-bottom is the bottom of the can.
  const yAt = () => size * Math.pow(rnd(), 0.56);

  // Fine mist. The floor of the effect: without it the larger beads
  // look pasted on rather than grown.
  for (let i = 0; i < size * 2.2; i++) {
    const r = size * (0.0007 + rnd() * 0.0022);
    stampBead(H, size, size, rnd() * size, yAt(), r, BEAD_FLAT * 0.7);
  }

  // Mid beads — the ones that carry the effect at normal viewing
  // distance.
  for (let i = 0; i < size * 0.34; i++) {
    const r = size * (0.0022 + rnd() * rnd() * 0.0075);
    stampBead(H, size, size, rnd() * size, yAt(), r, BEAD_FLAT);
  }

  // A few genuinely large beads, for the close-up hero shot.
  for (let i = 0; i < size * 0.028; i++) {
    const r = size * (0.009 + rnd() * rnd() * 0.020);
    stampBead(H, size, size, rnd() * size, yAt(), r, BEAD_FLAT);
  }

  // Runs. Confined to the lower two thirds — water that has started
  // moving has had time to get there.
  for (let i = 0; i < size * 0.012; i++) {
    const r = size * (0.003 + rnd() * 0.006);
    const len = size * (0.02 + rnd() * 0.10);
    stampRun(H, size, size, rnd() * size, size * (0.28 + rnd() * 0.60), r, len, rnd);
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

  // A soft blotch field for the fog, evaluated as a couple of
  // low-frequency sines. Cheaper than smoothing the height field and
  // it does not need to line up with anything.
  const fogAt = (x, y) => {
    const u = (x / W) * TAU;
    const v = (y / H) * TAU;
    const a = Math.sin(u * 1.0 + Math.cos(v * 0.7)) * Math.cos(v * 1.3 + 0.8);
    const b = Math.sin(u * 2.7 - 0.4) * Math.cos(v * 2.1 + 1.7);
    return 0.5 + 0.5 * (a * 0.65 + b * 0.35);
  };

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
        : ROUGH_DRY + (ROUGH_FOG - ROUGH_DRY) * Math.pow(fogAt(x, y), 2.2);
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
