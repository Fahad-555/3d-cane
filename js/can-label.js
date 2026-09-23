/* ============================================================
   VOLTIC — can printed artwork
   Everything printed on the can is drawn here, procedurally, into
   one canvas that the lathe in scene.js wraps around the body.
   There are no decal files: the shard mark, the wordmark, the
   barcode, the nutrition grid and the grain are all vector work or
   generated noise, so a flavor swap costs one rasterisation and
   nothing else.

   Geometry of the mapping: u wraps the full 2*pi of the can, and
   u = 0.5 is the point facing the camera at rest (the lathe is
   built with phiStart = PI). Only the front ~28% of the canvas is
   legible once wrapped — past roughly ±50 degrees the surface
   foreshortens hard enough that letterforms collapse into the
   silhouette — so every string is centred on a seam and auto-fitted
   inside that arc.
   ============================================================ */

import * as THREE from 'three';

export const LABEL_SERVICE = 2048;

/* The printed band, as fractions of canvas height. The mapping back
   to the lathe is y = 1 - index/83, so these two values are profile
   indices 56 and 22 — a sleeve over the middle of the straight wall,
   not the whole of it.

   It is deliberately not the full wall. The can is clear glass, and
   a band covering indices 9..69 would hide every drop of the drink
   behind opaque ink, leaving the transparency to show nothing but
   the two bare ends. Stopping short leaves a clear window above the
   sleeve where the liquid surface is visible, which is the whole
   point of putting a drink in a glass can. */
export const BAND = { y0: 0.325, y1: 0.735 };

const MONO = '"JetBrains Mono", monospace';
const DISPLAY = 'Anton, "Arial Narrow", sans-serif';

/* The body is matte near-black whatever the flavour. The flavour's
   base/deep tints survive only as a whisper of colour cast — never
   as a gradient band. The accent does all the work. */
const BLACK = '#0a0a0b';

/* ── Deterministic randomness ────────────────────────────────
   The grain and the barcode offsets need randomness, but the texture
   has to rasterise identically every time. app.js rebakes the labels
   once the webfont resolves, and Math.random would make the can
   visibly "boil" at that moment. */
function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/* FNV-1a over the flavour key, so each can has its own stable grain
   and its own stable barcode without any of it being stored. */
function seedOf(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/* ── EAN-13 tables ───────────────────────────────────────────
   The barcode is decorative, but a real module pattern is what makes
   it read as a barcode from across the room instead of a grey smudge.
   The 13th digit is carried by the parity pattern of the left six. */
const EAN_L = ['0001101', '0011001', '0010011', '0111101', '0100011',
               '0110001', '0101111', '0111011', '0110111', '0001011'];
const EAN_G = ['0100111', '0110011', '0011011', '0100001', '0011101',
               '0111001', '0000101', '0010001', '0001001', '0010111'];
const EAN_R = ['1110010', '1100110', '1101100', '1000010', '1011100',
               '1001110', '1010000', '1000100', '1001000', '1110100'];
const EAN_PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG',
                    'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];

/* ── The shard mark ──────────────────────────────────────────
   A lightning bolt with a cut through it. The bolt is a single
   polygon; two parallel half-plane cuts slice it into an upper mass,
   a thin sliver and a lower mass. Slicing rather than overpainting
   matters because the base underneath is a gradient — a flat black
   stripe across it would show as a seam. Two loose chips, drawn
   behind, sell the idea that the mark broke rather than was drawn
   that way.

   Coordinates are normalised: x in [-0.7, 0.7], y in [-1, 1], and y
   is *down*, because that is canvas space. */
const BOLT = [
  [ 0.44, -1.00], [-0.44, 0.06], [-0.04, 0.06],
  [-0.40,  1.00], [ 0.46, -0.02], [ 0.04, -0.02],
];

/* The cuts run across the bolt's waist, at right angles to the line
   that joins the two nibs. CUT_A/B are distances along that normal
   and CUT_GAP is how much metal the blade removes. */
const CUT_N = [0.164, 0.986];
const CUT_A = -0.02;
const CUT_B = 0.13;
const CUT_GAP = 0.05;

/* Fragments knocked out of the break, as [ax, ay, bx, by, w1, w2].
   They sit just off the cut so they read as debris from it rather
   than as two loose shapes that happen to be nearby. */
const CHIPS = [
  [ 0.46, -0.34,  0.16, -0.26, 0.018, 0.058],
  [-0.46,  0.32, -0.16,  0.24, 0.018, 0.058],
];

/* The whole mark leans, which is the difference between a designed
   shard and the clip-art bolt every energy drink already has. */
const TILT = 0.15;

/* Sutherland–Hodgman against the half-plane dot(p - P, N) >= 0. */
function clipHalf(poly, px, py, nx, ny) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const da = (a[0] - px) * nx + (a[1] - py) * ny;
    const db = (b[0] - px) * nx + (b[1] - py) * ny;
    if (da >= 0) out.push(a);
    if ((da >= 0) !== (db >= 0)) {
      const t = da / (da - db);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out;
}

/* A blade: a sliver that comes to a point at both ends, with its two
   widths sampled at 32% and 74% along the axis. Letting them differ
   is what gives a blade its weighted, off-centre look — a symmetric
   lozenge reads as a leaf, not as broken metal. */
function bladePoly(ax, ay, bx, by, w1, w2) {
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const p = (t, w) => [ax + dx * t + nx * w, ay + dy * t + ny * w];
  const q = (t, w) => [ax + dx * t - nx * w, ay + dy * t - ny * w];
  return [[ax, ay], p(0.32, w1), p(0.74, w2), [bx, by], q(0.74, w2), q(0.32, w1)];
}

function tracePoly(ctx, pts, T) {
  ctx.beginPath();
  for (let i = 0; i < pts.length; i++) {
    const [x, y] = T(pts[i][0], pts[i][1]);
    if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
  }
  ctx.closePath();
}

/* Draws the cluster inside a box of half-width `hw` and half-height
   `hh` centred on (cx, cy). One gradient sweeps the whole mark, so
   the light reads as bouncing off polished metal rather than as each
   fragment glowing on its own; the white hairline is what separates
   two fragments where they nearly touch. */
function drawShard(ctx, cx, cy, hw, hh, accent) {
  const [nx, ny] = CUT_N;
  const at = (d) => [-0.20 + nx * d, 0.02 + ny * d];
  const [ax, ay] = at(CUT_A);
  const [bx, by] = at(CUT_B);
  const [gx, gy] = at(CUT_A + CUT_GAP);
  const [hx, hy] = at(CUT_B + CUT_GAP);

  const pieces = [
    clipHalf(BOLT, ax, ay, -nx, -ny),
    clipHalf(clipHalf(BOLT, bx, by, -nx, -ny), gx, gy, nx, ny),
    clipHalf(BOLT, hx, hy, nx, ny),
  ];

  const cos = Math.cos(TILT);
  const sin = Math.sin(TILT);
  const k = 0.92;   // headroom so the tilted mark stays in its box
  const T = (x, y) => [
    cx + (x * cos - y * sin) * k * hw,
    cy + (x * sin + y * cos) * k * hh,
  ];

  const [sx, sy] = T(0.8, -1.2);
  const [ex, ey] = T(-0.8, 1.2);
  const g = ctx.createLinearGradient(sx, sy, ex, ey);
  g.addColorStop(0.00, accent);
  g.addColorStop(0.32, accent);
  g.addColorStop(0.46, '#ffffff');
  g.addColorStop(0.60, accent);
  g.addColorStop(1.00, accent);

  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(2, hh * 0.010);
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';

  const paint = (pts, alpha) => {
    tracePoly(ctx, pts, T);
    ctx.fillStyle = g;
    ctx.globalAlpha = alpha;
    ctx.fill();
    ctx.stroke();
    ctx.globalAlpha = 1;
  };

  for (const [cax, cay, cbx, cby, w1, w2] of CHIPS) {
    paint(bladePoly(cax, cay, cbx, cby, w1, w2), 0.85);
  }
  for (const pts of pieces) {
    if (pts.length > 2) paint(pts, 1);
  }
}

/* ── Micro-detail blocks ─────────────────────────────────────
   All of these live at the quarter points of the canvas — 90 degrees
   away from every seam — so they sit on the flank of the can rather
   than under the wordmark, and swing into view as the can turns. */

/* A genuine EAN-13: 95 modules, correct start/centre/end guards, and
   the digit set encoded with L/G/R so the bar rhythm varies the way a
   real code's does. Guard bars hang below the data bars, which is the
   detail that sells it at a glance. */
function drawBarcode(ctx, x0, y0, w, h, code, ink) {
  const modules = ['101'];
  const parity = EAN_PARITY[code[0]];
  for (let i = 0; i < 6; i++) {
    modules.push(parity[i] === 'L' ? EAN_L[code[i + 1]] : EAN_G[code[i + 1]]);
  }
  modules.push('01010');
  for (let i = 7; i < 13; i++) modules.push(EAN_R[code[i]]);
  modules.push('101');

  const bits = modules.join('');
  const m = w / bits.length;
  const guard = (i) => (i < 3) || (i >= 45 && i < 50) || (i >= 92);

  ctx.fillStyle = ink;
  for (let i = 0; i < bits.length; i++) {
    if (bits[i] !== '1') continue;
    ctx.fillRect(x0 + i * m, y0, m * 0.94 + 0.4, guard(i) ? h : h * 0.90);
  }

  // Digits sit under the bars in the standard grouping: the leading
  // digit in the quiet zone, then the two six-digit halves.
  const dg = h * 0.24;
  ctx.font = `500 ${Math.round(dg)}px ${MONO}`;
  ctx.fillStyle = ink;
  ctx.textBaseline = 'top';
  ctx.textAlign = 'center';
  const digits = String(code).split('');
  ctx.fillText(digits[0], x0 - dg * 0.75, y0 + h + dg * 0.25);
  ctx.fillText(digits.slice(1, 7).join(''), x0 + m * 24, y0 + h + dg * 0.25);
  ctx.fillText(digits.slice(7).join(''), x0 + m * 71, y0 + h + dg * 0.25);
  ctx.textAlign = 'left';
}

/* The resin triangle. Three stroked legs with gaps at the corners
   rather than a closed path — at print scale that gap is the only
   thing that separates it from a blob. */
function drawRecycle(ctx, cx, cy, r, ink, accent) {
  const v = (a) => [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
  ctx.lineWidth = Math.max(2, r * 0.10);
  ctx.lineCap = 'butt';
  ctx.strokeStyle = ink;
  const gap = 0.30;
  for (let k = 0; k < 3; k++) {
    const a0 = -Math.PI / 2 + k * (Math.PI * 2 / 3);
    const a1 = a0 + Math.PI * 2 / 3;
    const [sx, sy] = v(a0 + gap);
    const [ex, ey] = v(a1 - gap);
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(ex, ey);
    ctx.stroke();
  }
  // Material code: 41 is aluminium, and the can is 100% of it.
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `500 ${Math.round(r * 0.62)}px ${MONO}`;
  ctx.fillStyle = accent;
  ctx.fillText('41', cx, cy + r * 0.14);
  ctx.textAlign = 'left';
}

/* A boxed nutrition grid. Every row is a hairline rule plus two
   strings — the alignment of the values down the right edge is what
   makes it believable; ragged values read as decoration. */
function drawNutrition(ctx, x, y, w, h, ink, accent) {
  const rows = [
    ['ENERGY', '10 kcal'],
    ['FAT', '0 g'],
    ['  OF WHICH SATURATES', '0 g'],
    ['CARBOHYDRATE', '1.2 g'],
    ['  OF WHICH SUGARS', '0 g'],
    ['PROTEIN', '0 g'],
    ['SALT', '0.02 g'],
    ['NIACIN (B3)', '8.0 mg'],
    ['VITAMIN B6', '1.4 mg'],
    ['VITAMIN B12', '2.5 ug'],
  ];

  ctx.fillStyle = rgba('#ffffff', 0.03);
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = rgba('#ffffff', 0.55);
  ctx.lineWidth = Math.max(2, h * 0.006);
  ctx.strokeRect(x, y, w, h);

  const head = h * 0.13;
  ctx.fillStyle = accent;
  ctx.fillRect(x, y, w, head * 0.14);
  ctx.font = `500 ${Math.round(head * 0.46)}px ${MONO}`;
  ctx.fillStyle = ink;
  ctx.textBaseline = 'middle';
  ctx.fillText('NUTRITION', x + w * 0.035, y + head * 0.60);
  ctx.textAlign = 'right';
  ctx.fillStyle = rgba(ink, 0.60);
  ctx.fillText('PER CAN', x + w * 0.965, y + head * 0.60);
  ctx.textAlign = 'left';

  const top = y + head;
  const step = (h - head) / rows.length;
  ctx.font = `400 ${Math.round(step * 0.42)}px ${MONO}`;
  for (let i = 0; i < rows.length; i++) {
    const ry = top + i * step;
    if (i) {
      ctx.fillStyle = rgba('#ffffff', 0.16);
      ctx.fillRect(x + w * 0.03, ry, w * 0.94, Math.max(1, h * 0.0022));
    }
    ctx.fillStyle = rgba(ink, 0.80);
    ctx.fillText(rows[i][0], x + w * 0.035, ry + step * 0.5);
    ctx.textAlign = 'right';
    ctx.fillStyle = rgba(ink, 0.95);
    ctx.fillText(rows[i][1], x + w * 0.965, ry + step * 0.5);
    ctx.textAlign = 'left';
  }
}

/* Printer's registration target: a ring with a cross through it, plus
   the L-shaped trim corners. Barely visible at arm's length, but it is
   the difference between "printed can" and "sticker on a can". */
function drawRegMark(ctx, x, y, r, ink) {
  ctx.strokeStyle = rgba(ink, 0.30);
  ctx.lineWidth = Math.max(1, r * 0.16);
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x - r * 1.6, y); ctx.lineTo(x + r * 1.6, y);
  ctx.moveTo(x, y - r * 1.6); ctx.lineTo(x, y + r * 1.6);
  ctx.stroke();
}

function drawTrimCorner(ctx, x, y, r, sx, sy, ink) {
  ctx.strokeStyle = rgba(ink, 0.22);
  ctx.lineWidth = Math.max(1, r * 0.10);
  ctx.beginPath();
  ctx.moveTo(x, y + sy * r);
  ctx.lineTo(x, y);
  ctx.lineTo(x + sx * r, y);
  ctx.stroke();
}

/* ── Grain ───────────────────────────────────────────────────
   A 1024 field of white noise, tiled 1:1 so the grain stays at one
   canvas pixel instead of being smeared by scaling. Composited in
   `overlay` the effect is proportional to the base luminance, which
   is exactly what a matte black surface wants: present, never foggy. */
function makeNoiseCanvas(seed, size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  const rnd = lcg(seed);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const v = 60 + rnd() * 150;
    d[i] = d[i + 1] = d[i + 2] = v;
    d[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}

/* ── Type helpers ────────────────────────────────────────── */
const font = (weight, size, family) => `${weight} ${Math.max(1, Math.round(size))}px ${family}`;

/* Shrink a string until it fits `maxW`, measured rather than guessed.
   Long flavor names would otherwise silently overflow the readable
   arc and wrap their tails into the silhouette. */
function fit(ctx, text, maxW, startSize, weight, family) {
  let size = startSize;
  ctx.font = font(weight, size, family);
  while (ctx.measureText(text).width > maxW && size > 6) {
    size -= 1;
    ctx.font = font(weight, size, family);
  }
  return size;
}

/* Cap height, measured against the face actually loaded. The label is
   sometimes baked before Anton arrives, and Anton and the Arial Narrow
   fallback disagree by enough to push the wordmark into the shard. */
function capHeight(ctx, size, weight, family) {
  ctx.font = font(weight, size, family);
  const m = ctx.measureText('H');
  return m.actualBoundingBoxAscent || size * 0.72;
}

/* A string running bottom-to-top with its letter tops facing left —
   the book-spine rotation the reference can uses. `x` is the column
   centre, `cy` the vertical centre of the string, and the fill is a
   gradient along the string rather than across the can so each
   letterform carries its own white-to-accent fall. */
function verticalText(ctx, text, x, cy, size, family, weight, style, spacing) {
  ctx.save();
  ctx.translate(x, cy);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${Math.round(spacing)}px`;
  ctx.font = font(weight, size, family);
  const len = ctx.measureText(text).width;
  if (style) {
    const g = ctx.createLinearGradient(len / 2, 0, -len / 2, 0);
    for (const [at, col] of style) g.addColorStop(at, col);
    ctx.fillStyle = g;
  }
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

/* ── The front composition ───────────────────────────────────
   Everything here is measured against FRONT, the legible arc, and is
   drawn once per seam. Stacked top to bottom it is: the flavour
   name, the shard, then the wordmark — the order the reference
   uses, and the order that survives being squashed into a narrow
   arc, since the two longest strings sit where the band is widest.

   The wordmark reads *horizontally*, which matters more than it
   looks: the hero lays the can on its side, and a horizontal
   wordmark is what ends up running down the can there. Draw it
   rotated here and it comes out upright in the one shot that has
   to look like the reference. */
function drawFrontPanel(ctx, cx, S, y0, bh, FRONT, flavor) {
  const accent = flavor.accent;
  const ink = flavor.ink || '#f7f7f8';
  const F = FRONT;

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';

  // Flavour name and the company line, set small along the top.
  const cap = fit(ctx, flavor.name.toUpperCase(), F * 0.66, bh * 0.052, 500, MONO);
  ctx.font = font(500, cap, MONO);
  ctx.fillStyle = accent;
  ctx.fillText(flavor.name.toUpperCase(), cx, y0 + bh * 0.088);

  ctx.font = font(400, fit(ctx, 'VOLTIC BEVERAGE CO. · ROTTERDAM', F * 0.78, bh * 0.038, 400, MONO), MONO);
  ctx.fillStyle = rgba(ink, 0.42);
  ctx.fillText('VOLTIC BEVERAGE CO. · ROTTERDAM', cx, y0 + bh * 0.144);

  /* Short mono columns flanking the mark. Reading down the side of
     a can is normal, and at the arc's edges they are the only thing
     that can be vertical without being sliced. */
  ctx.fillStyle = rgba(ink, 0.50);
  verticalText(ctx, 'ENERGY DRINK', cx - F * 0.435, y0 + bh * 0.470,
    fit(ctx, 'ENERGY DRINK', bh * 0.26, F * 0.044, 500, MONO), MONO, 500, null, 0);
  verticalText(ctx, 'ZERO SUGAR', cx + F * 0.435, y0 + bh * 0.470,
    fit(ctx, 'ZERO SUGAR', bh * 0.22, F * 0.044, 400, MONO), MONO, 400, null, 0);

  /* The shard, centred on the seam — the one element that has to
     sit dead centre, because it is what you see when the can is
     only half turned toward you.

     Its box is wider than a bolt's natural aspect: at 2048 the arc
     is ~570px against a band ~840 tall, so the mark is drawn fat
     and then squashed into the arc, which is also what stops its
     strokes reading as two thin spikes. */
  drawShard(ctx, cx, y0 + bh * 0.455, F * 0.255, bh * 0.150, accent);

  // The wordmark: the thing you read across the room. Sized from its
  // cap height rather than its length, because the cap height is what
  // has to fit across the arc.
  const wm = fit(ctx, 'VOLTIC', F * 0.90, bh * 0.200, 400, DISPLAY);
  const wg = ctx.createLinearGradient(cx, y0 + bh * 0.670, cx, y0 + bh * 0.812);
  wg.addColorStop(0.00, '#ffffff');
  wg.addColorStop(0.55, ink);
  wg.addColorStop(1.00, accent);
  ctx.font = font(400, wm, DISPLAY);
  ctx.fillStyle = wg;
  ctx.fillText('VOLTIC', cx, y0 + bh * 0.742);

  // Spec lines under it all, fitted to the arc like every other string.
  const spec = fit(ctx, '500 ML · 200 MG CAFFEINE', F * 0.86, bh * 0.042, 500, MONO);
  ctx.font = font(500, spec, MONO);
  ctx.fillStyle = rgba(ink, 0.90);
  ctx.fillText('500 ML · 200 MG CAFFEINE', cx, y0 + bh * 0.882);

  ctx.font = font(400, spec * 0.78, MONO);
  ctx.fillStyle = rgba(ink, 0.42);
  ctx.fillText('SUGAR FREE · VEGAN · 10 CAL', cx, y0 + bh * 0.938);
}

/* ── The flank panel ─────────────────────────────────────────
   The dense, unglamorous half of a real can: barcode, nutrition
   grid, resin code, lot stamp, small print. It sits at the quarter
   points of the canvas so it never competes with the wordmark, and
   it is the reason the can still rewards a slow turn. */
function drawSidePanel(ctx, sx, S, y0, bh, flavor) {
  const accent = flavor.accent;
  const ink = flavor.ink || '#f7f7f8';
  const W = S * 0.170;
  const x = sx - W / 2;

  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';

  // Barcode. The 13 digits are derived from the flavour key so the
  // three cans carry three genuinely different codes.
  const code = String(seedOf(flavor.key || 'voltic')).padStart(10, '0').slice(0, 13);
  const bcH = bh * 0.105;
  drawBarcode(ctx, x + W * 0.06, y0 + bh * 0.105, W * 0.88, bcH, code, ink);

  // Volume and caffeine, the two things a drinker actually looks for.
  // One fitted line rather than two, because side by side on a panel
  // this narrow the pair overruns into the next repeat.
  const vol = fit(ctx, '500 ML · 200 MG CAFFEINE', W, bh * 0.030, 500, MONO);
  ctx.font = font(500, vol, MONO);
  ctx.fillStyle = ink;
  ctx.fillText('500 ML · 200 MG CAFFEINE', x, y0 + bh * 0.285);

  drawRecycle(ctx, x + W * 0.14, y0 + bh * 0.372, bh * 0.040, rgba(ink, 0.75), accent);
  ctx.font = font(400, bh * 0.024, MONO);
  ctx.fillStyle = rgba(ink, 0.55);
  ctx.fillText('ALU 41 · RECYCLED', x + W * 0.32, y0 + bh * 0.372);

  drawNutrition(ctx, x, y0 + bh * 0.430, W, bh * 0.330, ink, accent);

  // Lot stamp and best-before, in the flat, over-inked look of a date
  // coder rather than set type. Stacked and fitted, because side by
  // side they would overrun a panel this narrow.
  ctx.font = font(500, fit(ctx, 'LOT 04-117-B', W, bh * 0.026, 500, MONO), MONO);
  ctx.fillStyle = rgba(ink, 0.85);
  ctx.fillText('LOT 04-117-B', x, y0 + bh * 0.800);
  ctx.font = font(400, fit(ctx, 'BEST BEFORE 06 / 2027', W, bh * 0.024, 400, MONO), MONO);
  ctx.fillStyle = rgba(ink, 0.62);
  ctx.fillText('BEST BEFORE 06 / 2027', x, y0 + bh * 0.834);

  ctx.fillStyle = rgba(ink, 0.18);
  ctx.fillRect(x, y0 + bh * 0.858, W, Math.max(1, bh * 0.0016));

  const smallLine = (text, ty, alpha) => {
    ctx.font = font(400, fit(ctx, text, W, bh * 0.019, 400, MONO), MONO);
    ctx.fillStyle = rgba(ink, alpha);
    ctx.fillText(text, x, y0 + bh * ty);
  };
  smallLine('VOLTIC BEVERAGE CO. BV', 0.888, 0.50);
  smallLine('DOCKYARD 7 · 3011 ROTTERDAM NL', 0.918, 0.50);
  smallLine('NOT FOR CHILDREN UNDER 16', 0.948, 0.34);
}

/* ── Label texture ───────────────────────────────────────── */
export function makeLabelTexture(flavor, service = LABEL_SERVICE) {
  const S = service;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = S;
  const ctx = canvas.getContext('2d');

  const accent = flavor.accent;
  const ink = flavor.ink || '#f7f7f8';
  const rnd = lcg(seedOf(flavor.key || flavor.name || 'voltic'));

  const y0 = BAND.y0 * S;
  const y1 = BAND.y1 * S;
  const bh = y1 - y0;

  /* The legible arc. Past ±50 degrees of wrap the surface is
     foreshortened so hard that letters collapse into the silhouette,
     so nothing typographic is allowed outside it. */
  const FRONT = S * 0.28;

  // Base: matte near-black over the whole canvas. Bare aluminium
  // either side of the band only a hair lighter, and a shallow
  // vertical fall so the cylinder reads as lit from above.
  const base = ctx.createLinearGradient(0, 0, 0, S);
  base.addColorStop(0.00, '#131316');
  base.addColorStop(0.18, BLACK);
  base.addColorStop(0.72, BLACK);
  base.addColorStop(1.00, '#060607');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, S, S);

  // A whisper of the flavour's deep tone in the lower band. Enough
  // that the three cans aren't literally the same black, not enough
  // to read as a coloured band.
  const cast = ctx.createLinearGradient(0, y1, 0, y1 - bh * 1.1);
  cast.addColorStop(0.00, rgba(flavor.deep || '#101012', 0.38));
  cast.addColorStop(1.00, 'rgba(0,0,0,0)');
  ctx.fillStyle = cast;
  ctx.fillRect(0, y0, S, bh);

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, y0, S, bh);
  ctx.clip();

  // Rules top and bottom of the printed band, with a hairline set
  // just inside each — the pair reads as a printed band edge rather
  // than a drawn border.
  const rule = Math.max(4, bh * 0.0075);
  ctx.fillStyle = accent;
  ctx.fillRect(0, y0 + bh * 0.014, S, rule);
  ctx.fillRect(0, y1 - bh * 0.014 - rule, S, rule);
  ctx.fillStyle = rgba(accent, 0.45);
  ctx.fillRect(0, y0 + bh * 0.014 + rule * 2.1, S, Math.max(1, rule * 0.22));
  ctx.fillRect(0, y1 - bh * 0.014 - rule * 2.1, S, Math.max(1, rule * 0.22));

  /* The artwork is drawn three times, at 0, 0.5*S and S. The seams at
     the canvas edges and at the middle are the same point on the
     cylinder, so the outer two drawings reconstruct the split one
     across the wrap. The flank panels are drawn once at each quarter
     point instead — 90 degrees from every seam, and drawing them
     twice there would double every translucent hairline. */
  for (const cx of [0, S * 0.5, S]) {
    drawFrontPanel(ctx, cx, S, y0, bh, FRONT, flavor);
  }
  for (const sx of [S * 0.25, S * 0.75]) {
    drawSidePanel(ctx, sx, S, y0, bh, flavor);
  }

  // Registration marks, at the 45-degree points so they land between
  // the front panel and the flank panel.
  for (const mx of [S * 0.125, S * 0.375, S * 0.625, S * 0.875]) {
    drawRegMark(ctx, mx, y0 + bh * 0.035, bh * 0.011, ink);
    drawRegMark(ctx, mx, y1 - bh * 0.035, bh * 0.011, ink);
  }
  drawTrimCorner(ctx, S * 0.02, y0 + bh * 0.06, bh * 0.05, 1, 1, ink);
  drawTrimCorner(ctx, S * 0.98, y0 + bh * 0.06, bh * 0.05, -1, 1, ink);

  /* Grain last, over everything, the way handling marks sit on top of
     print. */
  ctx.globalCompositeOperation = 'overlay';
  ctx.globalAlpha = 0.55;
  const noise = makeNoiseCanvas(seedOf(flavor.key || 'voltic'), 1024);
  for (let ty = 0; ty < S; ty += 1024) {
    for (let tx = 0; tx < S; tx += 1024) ctx.drawImage(noise, tx, ty);
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';

  // Circumferential brushing: the grain on a drawn can runs around the
  // circumference, so these streaks are horizontal in canvas space.
  for (let i = 0; i < 260; i++) {
    const ly = y0 + rnd() * bh;
    const bright = rnd() > 0.45;
    ctx.fillStyle = bright
      ? `rgba(255,255,255,${0.010 + rnd() * 0.020})`
      : `rgba(0,0,0,${0.030 + rnd() * 0.060})`;
    ctx.fillRect(0, ly, S, 1 + rnd() * 2.5);
  }
  // A handful of deeper scratches, at shallow angles so they read as
  // damage rather than as more brushing.
  for (let i = 0; i < 26; i++) {
    const ly = y0 + rnd() * bh;
    const lx = rnd() * S;
    const len = S * (0.05 + rnd() * 0.30);
    ctx.strokeStyle = `rgba(255,255,255,${0.020 + rnd() * 0.045})`;
    ctx.lineWidth = 0.6 + rnd() * 1.8;
    ctx.beginPath();
    ctx.moveTo(lx, ly);
    ctx.lineTo(lx + len, ly + (rnd() - 0.5) * bh * 0.05);
    ctx.stroke();
  }

  ctx.restore();

  /* Everything outside the band is erased, not painted black.

     The can is clear glass, so this artwork is no longer the body's
     colour — it is a printed band laid over it, drawn on a second
     surface a hair outside the wall. Anything left opaque here
     would be a solid black can with a clear top and bottom, which
     is a different product. Cutting after the fact rather than
     skipping the fills is deliberate: the grain and the scratches
     are drawn across the whole canvas, and they have to be cut back
     to the band along with everything else.

     The edge is feathered over a few pixels because this ends up as
     an alpha channel — a hard cut aliases into a visible staircase
     once the lathe resamples it. */
  const feather = Math.max(1.5, bh * 0.004);
  ctx.globalCompositeOperation = 'destination-out';

  let cut = ctx.createLinearGradient(0, y0 - feather, 0, y0 + feather);
  cut.addColorStop(0, 'rgba(0,0,0,1)');
  cut.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = cut;
  ctx.fillRect(0, 0, S, y0 + feather);

  cut = ctx.createLinearGradient(0, y1 + feather, 0, y1 - feather);
  cut.addColorStop(0, 'rgba(0,0,0,1)');
  cut.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = cut;
  ctx.fillRect(0, y1 - feather, S, S - y1 + feather);

  ctx.globalCompositeOperation = 'source-over';

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.wrapS = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  return tex;
}

/* Rebake every flavour at once, for the post-webfont refresh. */
export function refreshLabels(flavors, service = LABEL_SERVICE) {
  return flavors.map((flavor) => makeLabelTexture(flavor, service));
}
