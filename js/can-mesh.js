/* ============================================================
   VOLTIC — can geometry
   Every surface of the can is generated here, already positioned in
   the can's own space, so scene.js only has to add meshes and hand
   out materials. Nothing is loaded and nothing is authored by hand:
   the body is one lathe, and the lid, tab, rim, foot and under-base
   are primitives and extrusions merged down to one buffer each.

   The can is two units across and a shade under five tall, which is
   the proportion the camera framing and the PRESETS in app.js were
   tuned against. Hold that and every existing shot still works.
   ============================================================ */

import * as THREE from 'three';

/* ── Can metrics ────────────────────────────────────────────
   Radius and height are set by the framing above. The point COUNTS
   are set by the texture mapping: LatheGeometry assigns v by point
   index, not by arc length, so this 84-point layout is what decides
   where the printed sleeve lands. bandVBot and bandVTop are the ends
   of the straight wall — indices 9 and 69 — and can-label.js picks
   the sleeve's actual extent *inside* that range. None of the counts
   below can move without the artwork sliding out of place with them.
   The Y values and radii, by contrast, are free to move.
   ─────────────────────────────────────────────────────────── */
export const CAN = {
  bodyR: 1.0,
  bodyTop: 2.05,
  bodyBot: -2.10,
  neckR: 0.72,
  neckTop: 2.50,
  baseBot: -2.44,
  domeSteps: 10,   // indices  0..9   base skirt, contact ring → shoulder
  bodySteps: 60,   // indices  9..69  straight wall; index 69 is its TOP end
  neckSteps: 14,   // indices 70..83  neck taper up to the rim
  bandVBot: 9 / 83,
  bandVTop: 69 / 83,
  radialSegments: 128,
};

/* ── Derived proportions ────────────────────────────────────
   Everything from here down is a consequence of CAN, named so the
   numbers in the geometry read as intent rather than as magic.
   ─────────────────────────────────────────────────────────── */

/* The contact ring the can actually stands on. A real can does not
   sit on its full width: the wall rolls inward at the base into a
   narrow foot, so the lathe's underside starts here rather than at
   the axis. That leaves the bottom open, which is deliberate —
   buildUnderBase() then plugs it with the concave base panel, which
   is both how a can is really assembled and the only way to get a
   base that curves inward while the profile's y still rises
   monotonically (the lathe walks the profile bottom to top).  */
const FOOT_R = 0.80;

/* Radius of the rolled rim, and the height its bead sits at. The
   bead is centred on the last profile point, so the neck's open end
   disappears inside it instead of stopping dead in mid-air. */
const RIM_TUBE = 0.032;
const RIM_Y = CAN.neckTop - 0.018;

/* Lid: the panel is recessed well below the rim, and RING_EDGE is
   the point on the countersink that has to reach *inside* the rim
   bead. Its radius is beyond the bead's inner surface at that
   height, so the two solids interpenetrate and no hairline gap can
   open up between the lid and the wall of the neck. */
const PANEL_R = 0.585;
const PANEL_Y = 2.40;
const RING_EDGE = new THREE.Vector2(0.700, 2.478);

/* Tab. The plate is stamped flat and lies in the lid recess with the
   rivet through it; PLATE_Y clears the score line by a few
   thousandths. */
const PLATE_Y = PANEL_Y + 0.020;
const RIVET_X = 0.045;

/* Under-base. The panel curves up to the middle of the can by this
   much — real base panels are domed inward so the can's only contact
   with the ground is the foot ring. */
const BASE_RISE = 0.19;

/* Barrel and taper, as fractions of the body radius. A lathe spun
   from a mathematically straight cylinder reads as CGI at the size
   this can is shown: the eye wants the faint swell of a real
   drawn-aluminium wall. Both curves are zero at their ends, so the
   waist swells by ~0.35% and the shoulder narrows by the same,
   with no step at either seam. */
const BARREL = 0.0035;
const TAPER = 0.0035;

/* Taper accumulates from the base to the rim; the barrel is a bulge
   that dies out at both ends of the straight wall. Both are applied
   as multipliers on x only, so the profile's y values — and the v
   mapping that depends on them — are untouched. */
const taperAt = (y) => 1 - TAPER * THREE.MathUtils.clamp(
  (y - CAN.bodyBot) / (CAN.neckTop - CAN.bodyBot), 0, 1);

const barrelAt = (y) => {
  const half = (CAN.bodyTop - CAN.bodyBot) / 2;
  const t = (y - (CAN.bodyBot + half)) / half;   // -1 at the base, +1 at the shoulder
  return 1 + BARREL * Math.max(0, 1 - t * t);
};

/* ── Profile ────────────────────────────────────────────────
   Bottom to top, in three runs that must total exactly 84 points:
   10 for the base skirt, 60 for the wall, 14 for the neck.
   ─────────────────────────────────────────────────────────── */
function buildProfile() {
  const pts = [];

  // Base skirt: contact ring out to the shoulder, easing so the wall
  // leaves the foot vertically and arrives at the body tangentially.
  for (let i = 0; i <= CAN.domeSteps - 1; i++) {
    const t = i / (CAN.domeSteps - 1);
    pts.push(new THREE.Vector2(
      FOOT_R + (CAN.bodyR - FOOT_R) * Math.sin((t * Math.PI) / 2),
      CAN.baseBot + (CAN.bodyBot - CAN.baseBot) * (1 - Math.cos((t * Math.PI) / 2))
    ));
  }

  // Straight wall — index 69, the last of these, is the top of it.
  for (let i = 1; i <= CAN.bodySteps; i++) {
    const y = CAN.bodyBot + (CAN.bodyTop - CAN.bodyBot) * (i / CAN.bodySteps);
    pts.push(new THREE.Vector2(CAN.bodyR * barrelAt(y) * taperAt(y), y));
  }

  // Neck taper up to the rim. Its first point shares a y with the
  // wall's last, so the taper multiplier matches across the seam and
  // the shoulder stays continuous.
  for (let i = 1; i <= CAN.neckSteps; i++) {
    const t = i / CAN.neckSteps;
    const y = CAN.bodyTop + (CAN.neckTop - CAN.bodyTop) * Math.sin((t * Math.PI) / 2);
    const r = CAN.bodyR + (CAN.neckR - CAN.bodyR) * (1 - Math.cos((t * Math.PI) / 2));
    pts.push(new THREE.Vector2(r * taperAt(y), y));
  }

  return pts;
}

/* ── Merging ────────────────────────────────────────────────
   Each can part is several primitives that the renderer should treat
   as one mesh, so they are copied into a single buffer here rather
   than merged with BufferGeometryUtils: that keeps the module on the
   one `three` import, and these parts are small enough that the one
   extra copy costs nothing. Everything is flattened to non-indexed
   first, because indexed and non-indexed geometry cannot share a
   merge. Normal and uv are guaranteed present afterwards, since the
   primitives below all emit both.
   ─────────────────────────────────────────────────────────── */
function mergeParts(parts) {
  const flat = parts.map((g) => (g.index ? g.toNonIndexed() : g));

  let total = 0;
  for (const g of flat) total += g.attributes.position.count;

  const position = new Float32Array(total * 3);
  const normal = new Float32Array(total * 3);
  const uv = new Float32Array(total * 2);

  let offset = 0;
  for (const g of flat) {
    const count = g.attributes.position.count;
    position.set(g.attributes.position.array, offset * 3);
    normal.set(g.attributes.normal.array, offset * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array, offset * 2);
    offset += count;
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(position, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  merged.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  merged.computeBoundingSphere();
  return merged;
}

/* ── Body ───────────────────────────────────────────────────
   The only part that carries the label, so it is the only part whose
   UVs matter. phiStart of PI puts the lathe's wrap seam around the
   back: the artwork draws the wordmark at u = 0.5, which then faces
   the camera at rest.
   ─────────────────────────────────────────────────────────── */
export function buildBodyGeometry(radialSegments = CAN.radialSegments) {
  return new THREE.LatheGeometry(buildProfile(), radialSegments, Math.PI, Math.PI * 2);
}

/* ── Liquid ──────────────────────────────────────────────────
   The drink inside a clear can. It follows the wall rather than
   being a straight cylinder, because the body is barrelled — a
   plain tube would either poke through the waist or float away
   from it, and either one reads instantly as fake.

   `inset` is the gap between the drink and the glass. It wants to
   be visible: the whole reason to model the liquid is the meniscus
   of wall you see down the side, and at zero gap there is no
   second surface to catch light. The last point closes the top
   into a flat disc, which is the surface you see from above.
   ─────────────────────────────────────────────────────────── */
export function buildLiquidGeometry(topY = CAN.bodyTop * 0.72, inset = 0.945, steps = 44) {
  const y0 = CAN.bodyBot + 0.10;
  const pts = [];

  for (let i = 0; i <= steps; i++) {
    const y = y0 + (topY - y0) * (i / steps);
    pts.push(new THREE.Vector2(CAN.bodyR * barrelAt(y) * taperAt(y) * inset, y));
  }
  // Close the surface. Same y as the ring below it, so the lathe
  // builds a flat disc between them rather than a wall.
  pts.push(new THREE.Vector2(0, topY));

  return new THREE.LatheGeometry(pts, 96, Math.PI, Math.PI * 2);
}

/* ── Lid ────────────────────────────────────────────────────
   Three pieces, in the order you meet them from the rim inward: the
   countersink that drops from under the rim bead to the panel, the
   recessed panel itself, and the score line circling the drink hole.
   The countersink is lathed from the edge inward — descending as it
   goes — because that is the winding that leaves its normals facing
   up, out of the can.
   ─────────────────────────────────────────────────────────── */
export function buildLid() {
  const countersink = new THREE.LatheGeometry([
    RING_EDGE,
    new THREE.Vector2(0.688, 2.462),
    new THREE.Vector2(0.672, 2.440),
    new THREE.Vector2(0.650, 2.420),
    new THREE.Vector2(0.622, 2.406),
    new THREE.Vector2(PANEL_R, PANEL_Y),
  ], 96);

  const panel = new THREE.CircleGeometry(PANEL_R, 96)
    .rotateX(-Math.PI / 2)
    .translate(0, PANEL_Y, 0);

  // A hair proud of the panel rather than cut into it: at this size a
  // raised line and a groove catch the light identically.
  const score = new THREE.TorusGeometry(0.34, 0.007, 6, 96)
    .rotateX(Math.PI / 2)
    .translate(0, PANEL_Y + 0.006, 0);

  return mergeParts([countersink, panel, score]);
}

/* ── Tab ────────────────────────────────────────────────────
   A stay-on tab is stamped, so its outline is splined rather than
   built from true arcs: narrow waist under the rivet, wide tail with
   the finger hole, which lands over the score line the way it does
   on a real can. The hole is a genuine hole in the extrusion, not a
   painted circle.
   ─────────────────────────────────────────────────────────── */
function tabShape() {
  const shape = new THREE.Shape();
  shape.moveTo(-0.145, 0.0);
  shape.splineThru([
    new THREE.Vector2(-0.060, 0.112),
    new THREE.Vector2(0.060, 0.124),
    new THREE.Vector2(0.180, 0.130),
    new THREE.Vector2(0.330, 0.150),
    new THREE.Vector2(0.450, 0.158),
    new THREE.Vector2(0.520, 0.0),
    new THREE.Vector2(0.450, -0.158),
    new THREE.Vector2(0.330, -0.150),
    new THREE.Vector2(0.180, -0.130),
    new THREE.Vector2(0.060, -0.124),
    new THREE.Vector2(-0.060, -0.112),
  ]);
  shape.closePath();

  // Sized against the panel rather than the tab's own proportions: the
  // tail has to reach close to the countersink and the hole has to sit
  // over the score line, or the lid reads as a disc with a toy on it.
  const hole = new THREE.Path();
  hole.absarc(0.355, 0, 0.082, 0, Math.PI * 2, true);
  shape.holes.push(hole);
  return shape;
}

export function buildTab() {
  // Bevel rather than a plain extrusion: a stamped tab has a rolled
  // edge, and without it the plate reads as a decal at close range.
  const plate = new THREE.ExtrudeGeometry(tabShape(), {
    depth: 0.014,
    bevelEnabled: true,
    bevelThickness: 0.003,
    bevelSize: 0.003,
    bevelSegments: 2,
    curveSegments: 24,
  })
    .rotateX(-Math.PI / 2)
    // The bevel dips below z = 0, so the plate's underside sits at
    // -bevelThickness until the two cancel.
    .translate(0, PLATE_Y + 0.003, 0);

  const rivet = new THREE.CylinderGeometry(0.090, 0.098, 0.046, 20)
    .translate(RIVET_X, PANEL_Y + 0.023, 0);

  // Squashed rather than a true hemisphere: a full dome here stands
  // proud of the rim, which no unopened can does.
  const button = new THREE.SphereGeometry(0.090, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2)
    .scale(1, 0.28, 1)
    .translate(RIVET_X, PANEL_Y + 0.046, 0);

  return mergeParts([plate, rivet, button]);
}

/* ── Rim ────────────────────────────────────────────────────
   A rolled bead sitting on the neck's last profile point. The lathe
   stops at that point with no cap and no thickness, which reads as a
   cut tube; the bead is what turns the end of the neck into the
   curled lip of a real can, and it is what the lid's countersink
   hides inside.
   ─────────────────────────────────────────────────────────── */
export function buildRim() {
  // The neck narrows as it rises, so the bead's centre circle is the
  // *tapered* radius, not CAN.neckR — otherwise the shell's end grazes
  // the bead's surface instead of sitting inside it.
  const rimR = CAN.neckR * taperAt(CAN.neckTop);
  return new THREE.TorusGeometry(rimR, RIM_TUBE, 12, 128)
    .rotateX(Math.PI / 2)
    .translate(0, RIM_Y, 0);
}

/* ── Foot ───────────────────────────────────────────────────
   The rolled ring the can stands on, sitting on the contact circle
   the profile starts from. Its lowest point is exactly CAN.baseBot,
   so the ring — not the base panel — is what touches the ground.
   ─────────────────────────────────────────────────────────── */
export function buildFoot() {
  const tube = 0.034;
  return new THREE.TorusGeometry(FOOT_R, tube, 12, 128)
    .rotateX(Math.PI / 2)
    .translate(0, CAN.baseBot + tube, 0);
}

/* ── Under-base ─────────────────────────────────────────────
   The concave panel that closes the bottom of the lathe. It runs
   centre-first out to the contact ring, so its normals face down and
   inward — the direction you actually look at it from — and it rises
   into the can, which is why a real can has a shadow under its
   middle instead of a flat base. Its rim tucks inside the foot bead,
   so the two never show a seam.
   ─────────────────────────────────────────────────────────── */
export function buildUnderBase() {
  const steps = 14;
  const rimY = CAN.baseBot + 0.008;
  const centreY = CAN.baseBot + BASE_RISE;
  const pts = [];

  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    // The 1.6 exponent flattens the middle of the panel, matching the
    // shallow saucer a base panel is actually formed into.
    pts.push(new THREE.Vector2(
      FOOT_R * u,
      centreY - (centreY - rimY) * Math.pow(u, 1.6)
    ));
  }

  return new THREE.LatheGeometry(pts, 96);
}
