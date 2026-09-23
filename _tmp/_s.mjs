/* ============================================================
   VOLTIC — WebGL scene
   A procedurally-built energy-drink can. No external model or
   texture files: the can profile is a lathe, the label is drawn
   to a canvas at runtime, and the environment is baked from a
   small emissive room through PMREM. That keeps it to a single
   network dependency (three) and lets flavor swaps be instant.
   ============================================================ */

import * as THREE from 'three';

/* The can itself lives in two modules of its own — geometry in
   can-mesh.js, printed artwork in can-label.js — because between them
   they are larger than everything else in the scene put together.
   This file's job is to light them, place them, and drive the
   choreography. The one contract across that seam is the lathe's
   84-point profile: it fixes both the silhouette and the v range the
   label artwork is drawn into, so the two files have to agree on it
   exactly. can-mesh.js owns those counts and derives the band from
   them; can-label.js mirrors the result. */
import { CAN, buildBodyGeometry, buildLiquidGeometry, buildLid, buildTab, buildRim, buildFoot, buildUnderBase } from './can-mesh.js';
import { makeLabelTexture, refreshLabels as rebakeLabels, LABEL_SERVICE } from './can-label.js';
import { makeCondensationMaps } from './can-condensation.js';

/* ── Flavor definitions ─────────────────────────────────────
   Each flavor drives the can artwork, the drink inside it, the
   scene lights, and the page accent — so switching one is a single
   source of truth.

   `accent` is the neon that goes on the page and in the lighting;
   `liquid` is the drink itself, which is always a duller, deeper
   version of it. A drink the colour of the accent reads as
   radioactive rather than drinkable. `deep` survives only as the
   faint tint the artwork casts into the bottom of the band. */
export const FLAVORS = [
  { key: 'citrus',  name: 'Citrus Storm', accent: '#c8ff00', liquid: '#6f9c08', base: '#5c7a06', deep: '#131a02', ink: '#f7f7f8' },
  { key: 'blue',    name: 'Blue Volt',    accent: '#00e5ff', liquid: '#0a7f9c', base: '#075f75', deep: '#03181f', ink: '#f7f7f8' },
  { key: 'crimson', name: 'Crimson Rush', accent: '#ff2d55', liquid: '#a3122f', base: '#8a0a22', deep: '#1f0208', ink: '#f7f7f8' },
];

/* ── Soft dot sprite for particles and the backdrop glow ── */
function makeRadialTexture(inner, outer) {
  const S = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = S;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0.0, inner);
  g.addColorStop(0.45, outer);
  g.addColorStop(1.0, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* ── Baked environment ──────────────────────────────────────
   A dark box with a few emissive panels. PMREM turns it into the
   reflection map, which is what makes the aluminium read as metal
   without shipping an HDR file.                                   */
function buildEnvironmentScene(accentColor) {
  const env = new THREE.Scene();
  const accent = new THREE.Color(accentColor);

  env.add(new THREE.Mesh(
    new THREE.BoxGeometry(16, 16, 16),
    new THREE.MeshBasicMaterial({ color: 0x08080a, side: THREE.BackSide })
  ));

  const panel = (color, intensity, w, h, x, y, z, rx, ry) => {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity) })
    );
    mesh.position.set(x, y, z);
    mesh.rotation.set(rx || 0, ry || 0, 0);
    env.add(mesh);
  };

  // Intensities are tuned so the can reads as brushed aluminium: a
  // bright but bounded key, coloured rims, and a weak backlight. Push
  // any of these much higher and the neck blows out to pure white.
  // Broad overhead key — the main highlight running down the can.
  panel(0xffffff, 2.4, 9, 9, 0, 7.6, 0, Math.PI / 2, 0);
  // Accent strip on each side — the coloured rim you see on chrome.
  panel(accent.getHex(), 2.0, 7, 3.2, -6.6, 1.4, 0, 0, Math.PI / 2);
  panel(accent.getHex(), 1.2, 7, 3.2, 6.6, -1.0, 0, 0, -Math.PI / 2);
  // Cool fill from behind so the back edge never goes fully black.
  // Kept low and desaturated — a saturated panel here draws a hard
  // coloured outline around the whole silhouette.
  panel(0x3a4a7a, 0.5, 6, 6, 0, 0, -6.6, 0, 0);
  // Faint floor bounce.
  panel(0xffffff, 0.3, 8, 8, 0, -7.6, 0, -Math.PI / 2, 0);

  return env;
}

/* ── Scene ──────────────────────────────────────────────── */
export function createScene(canvas) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
  camera.position.set(0, 0, 10);

  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();

  let envTarget = null;
  function applyEnvironment(accentHex) {
    const next = pmrem.fromScene(buildEnvironmentScene(accentHex), 0.02);
    if (envTarget) envTarget.dispose();
    envTarget = next;
    scene.environment = next.texture;
    scene.environmentIntensity = 0.85;
  }
  applyEnvironment(FLAVORS[0].accent);

  /* Can ----------------------------------------------------
     The can is clear. Three surfaces stacked, in the order you
     pass through them going inward: a printed band wrapped on the
     outside, the glass wall, and the drink behind it. The label is
     2048px because the readable arc is only ~28% of the canvas
     width — at 1024 the nutrition grid and the barcode turned to
     mush once wrapped.

     They are separate meshes because they need different blending:
     the band is opaque ink and writes depth, the glass is a film
     that must not, and the drink is solid. Trying to do all three
     in one material is what makes procedural cans look like
     plastic. */
  const group = new THREE.Group();
  scene.add(group);

  const labels = FLAVORS.map((f) => makeLabelTexture(f));
  let activeFlavor = 0;

  /* The condensation, baked once and shared by everything on the
     outside of the can. Two 2048 maps is real work — about a second
     and a half — which is why app.js calls createScene() behind the
     preloader and not before it. */
  const cond = makeCondensationMaps(2048);

  /* Glass. Three.js has a `transmission` model and this deliberately
     does not use it: transmission resolves against the WebGL
     backbuffer, which holds the 3D scene and nothing else, so a
     transmissive can would refract the particles and then bury the
     page's giant wordmark behind an opaque slab — the one thing
     behind the can that has to stay visible. Compositing instead
     (low alpha, heavy environment, a fresnel rim) keeps the DOM
     showing through, which is what "clear" actually means here.

     roughness is set to 1 and handed entirely to the map: the map
     *multiplies* the scalar, so leaving a low scalar in place would
     scale every droplet back down to nothing. */
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0xd8e2e8,
    metalness: 0.0,
    roughness: 1.0,
    roughnessMap: cond.roughnessMap,
    ior: 1.45,
    reflectivity: 1.0,
    clearcoat: 1.0,
    clearcoatRoughness: 0.03,
    envMapIntensity: 1.9,
    transparent: true,
    opacity: 0.26,
    side: THREE.DoubleSide,
    depthWrite: false,
    normalMap: cond.normalMap,
    normalScale: new THREE.Vector2(0.5, 0.5),
    clearcoatNormalMap: cond.normalMap,
    clearcoatNormalScale: new THREE.Vector2(0.9, 0.9),
  });

  /* A clear cylinder at a flat opacity reads as a sheet of cling
     film. What sells glass is that it thickens at the silhouette:
     you are looking through more of it edge-on than face-on. The
     alpha is therefore driven by the viewing angle rather than
     left constant, and the constant term is small because most of
     the can's face should be genuinely see-through. */
  const GLASS_FACE = 0.07;
  const GLASS_RIM = 0.93;
  const GLASS_RIM_POW = 2.6;

  glassMat.onBeforeCompile = (shader) => {
    // `normal` is in scope: normal_fragment_begin and
    // normal_fragment_maps have both run by this point, so the
    // droplet normals are already folded in and the rim wobbles
    // over the beads the way it should.
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <opaque_fragment>',
      `#include <opaque_fragment>
       float fres = 1.0 - abs( dot( normalize( normal ), normalize( vViewPosition ) ) );
       gl_FragColor.a = clamp( ${GLASS_FACE.toFixed(3)} + pow( fres, ${GLASS_RIM_POW.toFixed(1)} ) * ${GLASS_RIM.toFixed(3)}, 0.0, 1.0 );`
    );
  };

  const glass = new THREE.Mesh(buildBodyGeometry(CAN.radialSegments), glassMat);
  glass.renderOrder = 3;
  group.add(glass);

  /* The drink. Solid rather than translucent — an energy drink is
     cloudy, and stacking a second transparent surface behind the
     first is how you get sorting artifacts. Lit from inside by its
     own emissive term so it glows through the glass. */
  const liquidMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(FLAVORS[0].liquid),
    emissive: new THREE.Color(FLAVORS[0].accent),
    emissiveIntensity: 0.22,
    metalness: 0.0,
    roughness: 0.16,
    clearcoat: 1.0,
    clearcoatRoughness: 0.08,
    envMapIntensity: 0.7,
  });
  const liquid = new THREE.Mesh(buildLiquidGeometry(), liquidMat);
  liquid.renderOrder = 1;
  group.add(liquid);

  /* The printed band. Same lathe as the wall, pushed out a hair so
     it sits on the glass instead of in it — and sharing the UVs, so
     the artwork lands where the label module expects.

     alphaTest cuts the erased area away rather than blending it,
     which keeps the band in the opaque pass where it can write
     depth. Without that the far side of the band draws over the
     near side through the transparent glass. */
  const bandMat = new THREE.MeshPhysicalMaterial({
    map: labels[0],
    transparent: true,
    alphaTest: 0.45,
    depthWrite: true,
    metalness: 0.1,
    roughness: 0.52,
    clearcoat: 0.6,
    clearcoatRoughness: 0.24,
    envMapIntensity: 0.8,
    normalMap: cond.normalMap,
    normalScale: new THREE.Vector2(0.45, 0.45),
  });
  const bandGeo = buildBodyGeometry(CAN.radialSegments);
  bandGeo.scale(1.006, 1.0, 1.006);
  const band = new THREE.Mesh(bandGeo, bandMat);
  band.renderOrder = 2;
  group.add(band);

  // One material for all the hardware. Bare aluminium is the same
  // everywhere on a real can, and sharing it means one dispose.
  const metalMat = new THREE.MeshPhysicalMaterial({
    color: 0xb9bec4,
    metalness: 1.0,
    roughness: 0.28,
    envMapIntensity: 1.15,
  });

  const hardware = [
    buildLid(),        // countersunk panel, score line, drink hole
    buildTab(),        // stay-on tab
    buildRim(),        // the rolled bead the neck ends in
    buildFoot(),       // the contact ring it stands on
    buildUnderBase(),  // concave base panel
  ].map((geo) => {
    const mesh = new THREE.Mesh(geo, metalMat);
    group.add(mesh);
    return mesh;
  });

  /* Backdrop glow ------------------------------------------ */
  const glowTex = makeRadialTexture('rgba(255,255,255,0.85)', 'rgba(255,255,255,0.18)');
  const glowMat = new THREE.MeshBasicMaterial({
    map: glowTex,
    transparent: true,
    opacity: 0.30,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
  });
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(7, 7), glowMat);
  glow.position.z = -3.4;
  glow.renderOrder = -1;
  scene.add(glow);

  /* Particles ---------------------------------------------- */
  const COUNT = 700;
  const positions = new Float32Array(COUNT * 3);
  const seeds = new Float32Array(COUNT);
  for (let i = 0; i < COUNT; i++) {
    const angle = Math.random() * Math.PI * 2;
    const radius = 1.7 + Math.random() * 3.4;
    const y = (Math.random() - 0.5) * 11;
    positions[i * 3]     = Math.cos(angle) * radius;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = Math.sin(angle) * radius;
    seeds[i] = Math.random() * Math.PI * 2;
  }
  const particleGeo = new THREE.BufferGeometry();
  particleGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const particleMat = new THREE.PointsMaterial({
    size: 0.055,
    map: makeRadialTexture('rgba(255,255,255,1)', 'rgba(255,255,255,0.35)'),
    color: new THREE.Color(FLAVORS[0].accent),
    transparent: true,
    opacity: 0.85,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    sizeAttenuation: true,
  });
  const particles = new THREE.Points(particleGeo, particleMat);
  scene.add(particles);

  /* Lights ------------------------------------------------- */
  const accentLight = new THREE.PointLight(new THREE.Color(FLAVORS[0].accent), 26, 22, 2);
  accentLight.position.set(-3.4, 1.8, -1.2);
  scene.add(accentLight);

  const accentLight2 = new THREE.PointLight(new THREE.Color(FLAVORS[0].accent), 16, 22, 2);
  accentLight2.position.set(3.2, -1.4, 2.2);
  scene.add(accentLight2);

  const keyLight = new THREE.DirectionalLight(0xffffff, 1.6);
  keyLight.position.set(3.5, 5, 6);
  scene.add(keyLight);

  const rimLight = new THREE.DirectionalLight(0xffffff, 0.8);
  rimLight.position.set(-4, 1, -5);
  scene.add(rimLight);

  /* State --------------------------------------------------
     `target` is written by the scroll choreography in app.js;
     `current` chases it every frame. Nothing in app.js touches
     Three.js directly.

     rotZ is the can's roll: 0 stands it upright, and -PI/2 lays it
     on its side with the lid to the right, which is how the
     reference composition opens. It is kept separate from rotX
     because the two do different jobs — rotX is the pitch that
     shows the viewer the lid, rotZ decides whether the can is
     standing at all. */
  const target  = { x: 0, y: 0, rotY: 0, rotX: 0, rotZ: 0, scale: 1, spin: 0.06 };
  const current = { x: 0, y: 0, rotY: 0, rotX: 0, rotZ: 0, scale: 1 };

  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
  let viewportScale = 1;

  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);

    const dpr = Math.min(window.devicePixelRatio || 1, w < 760 ? 1.75 : 2);
    renderer.setPixelRatio(dpr);

    camera.aspect = w / h;
    camera.updateProjectionMatrix();

    // Keep the can inside the frame on narrow screens: the fov is
    // vertical, so a tall viewport means very little horizontal room.
    const visibleH = 2 * camera.position.z * Math.tan((camera.fov * Math.PI) / 360);
    const visibleW = visibleH * camera.aspect;
    viewportScale = Math.min(1, (visibleW * 0.82) / 2.4);

    // Keep the glow proportional to the can instead of a fixed slab that
    // washes colour across the whole viewport.
    glow.scale.setScalar(0.36 / Math.max(viewportScale, 0.4));
  }

  function setFlavor(index) {
    const flavor = FLAVORS[index] || FLAVORS[0];
    activeFlavor = FLAVORS[index] ? index : 0;
    bandMat.map = labels[activeFlavor];
    bandMat.needsUpdate = true;

    // The drink restains with the flavour; the glass does not, since
    // it has no colour of its own to restain.
    liquidMat.color.set(flavor.liquid);
    liquidMat.emissive.set(flavor.accent);

    const accent = new THREE.Color(flavor.accent);
    particleMat.color.copy(accent);
    accentLight.color.copy(accent);
    accentLight2.color.copy(accent);
    glowMat.color.copy(accent);
    applyEnvironment(flavor.accent);
  }

  /* Re-bake the label artwork. The artwork is rasterised with Anton and
     JetBrains Mono, so if the webfonts hadn't landed when the scene was
     built the texture holds a fallback face. app.js calls this once the
     real fonts resolve. Re-baking 2048px of vector work three times is
     not free, so it is deliberately not done speculatively. */
  function refreshLabels() {
    const previous = labels;
    labels = rebakeLabels(FLAVORS, LABEL_SERVICE);
    bandMat.map = labels[activeFlavor];
    bandMat.needsUpdate = true;
    previous.forEach((t) => t.dispose());
  }

  function setPointer(nx, ny) {
    pointer.tx = THREE.MathUtils.clamp(nx, -1, 1);
    pointer.ty = THREE.MathUtils.clamp(ny, -1, 1);
  }

  // Frame-rate independent lerp — a plain `a += (b-a)*0.08` moves at
  // different speeds on 60Hz and 144Hz, which shows up as the can
  // settling at a visibly different time on different machines.
  function damp(currentValue, targetValue, lambda, dt) {
    return THREE.MathUtils.lerp(currentValue, targetValue, 1 - Math.exp(-lambda * dt));
  }

  let elapsed = 0;

  function update(dt) {
    elapsed += dt;
    // Clamp: a backgrounded tab can hand us a multi-second dt, which
    // would teleport the can instead of easing it.
    const step = Math.min(dt, 1 / 30);

    // The can drifts on its own; scroll adds to that drift elsewhere.
    target.rotY += target.spin * step;

    const k = 5.2;
    current.x     = damp(current.x,     target.x,     k, step);
    current.y     = damp(current.y,     target.y,     k, step);
    current.rotY  = damp(current.rotY,  target.rotY,  k, step);
    current.rotX  = damp(current.rotX,  target.rotX,  k, step);
    current.rotZ  = damp(current.rotZ,  target.rotZ,  k, step);
    current.scale = damp(current.scale, target.scale, k, step);

    pointer.x = damp(pointer.x, pointer.tx, 3.2, step);
    pointer.y = damp(pointer.y, pointer.ty, 3.2, step);

    const s = current.scale * viewportScale;
    group.scale.setScalar(s);
    group.position.set(
      current.x * viewportScale + pointer.x * 0.30,
      current.y * viewportScale + pointer.y * 0.18 + Math.sin(elapsed * 0.9) * 0.045,
      0
    );
    group.rotation.y = current.rotY + pointer.x * 0.30;
    group.rotation.x = current.rotX + pointer.y * 0.14;
    // Set last, and not offset by the pointer: rolling the can about
    // z after the other two axes means the pointer keeps tilting it
    // the way it looks rather than the way it is built.
    group.rotation.z = current.rotZ;

    /* Glow and particles are positioned off the group's origin, which
       is the can's centre whichever way it is rolled — so they track
       it correctly lying down as well as standing. */
    glow.position.x = group.position.x;
    glow.position.y = group.position.y;
    glowMat.opacity = 0.22 + Math.sin(elapsed * 1.4) * 0.05;

    particles.rotation.y = elapsed * 0.045;
    particles.position.x = group.position.x * 0.4;
    particles.position.y = group.position.y * 0.4;

    accentLight.position.y = 1.8 + Math.sin(elapsed * 0.8) * 0.5;
    accentLight2.position.x = 3.2 + Math.cos(elapsed * 0.6) * 0.4;

    renderer.render(scene, camera);
  }

  function dispose() {
    glass.geometry.dispose();
    glassMat.dispose();
    bandGeo.dispose();
    bandMat.dispose();
    liquid.geometry.dispose();
    liquidMat.dispose();
    hardware.forEach((m) => m.geometry.dispose());
    metalMat.dispose();
    cond.dispose();
    particleGeo.dispose();
    particleMat.dispose();
    glowTex.dispose();
    glowMat.dispose();
    labels.forEach((t) => t.dispose());
    if (envTarget) envTarget.dispose();
    pmrem.dispose();
    renderer.dispose();
  }

  resize();

  return {
    update, resize, setFlavor, setPointer, refreshLabels, dispose, target,
    // Exposed so app.js can retint the page without reaching into
    // WebGL state, and so the boot sequence can wait on the first
    // frame rather than on a timer.
    material: bandMat,
  };
}
