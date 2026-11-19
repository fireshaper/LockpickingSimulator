// Procedural 3D models. Everything is generated from the same dimensions and
// pin profiles the physics uses, so what you see is exactly what is simulated.
// Model units are millimetres. Axes: +X runs into the keyway from the lock
// face, +Y is up through the pin stacks, Z is across the lock.

import * as THREE from 'three';
import { ADDITION, Brush, Evaluator, SUBTRACTION } from 'three-bvh-csg';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  FLAG_SHAFT_R,
  GEO,
  TELESCOPE,
  type LockSpec,
  type PickSpec,
  BOK_WRENCH,
  WAFER,
  KEY_TIP,
  rakeDepth,
  type PinSpec,
} from '../sim/lock';

const MM = 1000;
const evaluator = new Evaluator();
evaluator.useGroups = false;
evaluator.attributes = ['position', 'normal'];

function brush(geo: THREE.BufferGeometry, x = 0, y = 0, z = 0) {
  // Bake the offset into the geometry: CSG results come back in the first
  // brush's local frame, so brushes must all share the identity transform.
  if (x || y || z) geo.translate(x, y, z);
  const b = new Brush(geo);
  b.updateMatrixWorld(true);
  return b;
}

const subtract = (a: Brush, b: Brush) => evaluator.evaluate(a, b, SUBTRACTION);
const unite = (a: Brush, b: Brush) => evaluator.evaluate(a, b, ADDITION);

/**
 * The CSG library still passes an option its BVH dependency has renamed, which
 * logs one deprecation warning per boolean operation. Filter just that line.
 */
function withoutBvhNoise<T>(fn: () => T): T {
  const warn = console.warn;
  console.warn = (...args: unknown[]) => {
    if (typeof args[0] === 'string' && args[0].includes('maxLeafSize')) return;
    warn(...args);
  };
  try {
    return fn();
  } finally {
    console.warn = warn;
  }
}

/** Cylinder whose axis runs along X. */
export function cylX(r: number, len: number, seg = 64) {
  return new THREE.CylinderGeometry(r, r, len, seg).rotateZ(Math.PI / 2);
}

function cutHalf(b: Brush, len: number) {
  // Remove the +Z half so the pin stacks are visible in section. The tiny
  // offset keeps the cut plane off the chamber centre lines.
  return subtract(b, brush(new THREE.BoxGeometry(len + 30, 90, 40), len / 2, 0, 20.003));
}

/** Remove everything above the keyway axis, to look down on a side row. */
function cutTop(b: Brush, len: number) {
  return subtract(b, brush(new THREE.BoxGeometry(len + 30, 40, 90), len / 2, 20.003, 0));
}

/** Which part of a body to cut away: none, the near half, or the top half. */
export type Section = 'none' | 'half' | 'top';

function section(b: Brush, cut: Section, len: number) {
  if (cut === 'half') return cutHalf(b, len);
  if (cut === 'top') return cutTop(b, len);
  return b;
}

/**
 * A chamber bore for one pin: a cylinder along the pin's own axis, from r0 to
 * r1 measured from the plug centre.
 */
function chamberBore(pin: PinSpec, r0: number, r1: number) {
  const cr = GEO.chamberR * MM;
  const c = new THREE.CylinderGeometry(cr, cr, r1 - r0, 32);
  c.deleteAttribute('uv');
  c.translate(0, (r0 + r1) / 2, 0);
  c.rotateX(-pin.angle);
  c.translate(pin.x * MM, 0, 0);
  return brush(c);
}

/** Cut a section through any solid whose long axis is X (used by other lock types). */
export function sectionGeometry(geo: THREE.BufferGeometry, cut: Section, len: number) {
  if (cut === 'none') return geo;
  return withoutBvhNoise(() => {
    geo.deleteAttribute('uv');
    return finish(section(brush(geo), cut, len));
  });
}

function finish(b: Brush) {
  const g = b.geometry;
  g.computeBoundingSphere();
  return g;
}

/** Housing: round shell with the bible (the tower holding drivers and springs). */
export function buildHousing(spec: LockSpec, cut: Section) {
  return withoutBvhNoise(() => housingGeometry(spec, cut));
}

/**
 * Wafer lock housing: a plain round shell, with a groove along the top and
 * the bottom of its bore for the ends of the wafers to stick out into.
 */
function waferHousingGeometry(spec: LockSpec, cut: Section) {
  const L = spec.plugLen * MM;
  const R = GEO.plugR * MM;
  const shape = new THREE.Shape();
  shape.absarc(0, 0, GEO.housingR * MM, 0, Math.PI * 2, false);
  const bore = new THREE.Path();
  bore.absarc(0, 0, R + 0.06, 0, Math.PI * 2, true);
  shape.holes.push(bore);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: L, bevelEnabled: false, curveSegments: 48 });
  geo.rotateY(Math.PI / 2); // extrusion axis -> +X
  geo.deleteAttribute('uv');
  let b = brush(geo);
  const depth = spec.geo.waferTravel * MM + 0.5;
  const width = WAFER.tangHalfW * 2 * MM + 0.5;
  for (const sign of [1, -1]) {
    const groove = new THREE.BoxGeometry(L - 2.4, depth + 1, width);
    groove.deleteAttribute('uv');
    b = subtract(b, brush(groove, L / 2, sign * (R - 1 + (depth + 1) / 2), 0));
  }
  return finish(section(b, cut, L));
}

/**
 * One wafer, drawn as its far half so the cutaway shows it in section: a
 * strip with a gap where its window is. Origin at the top edge of the window,
 * which is where the pick bears.
 */
export function buildWafer(pin: PinSpec) {
  const R = GEO.plugR * MM;
  const top = pin.keyLen * MM;
  const mid = top - R;
  const tang = WAFER.tangHalfW * MM;
  const bw = WAFER.bodyHalfW * MM;
  const bh = WAFER.bodyHalfH * MM;
  const s = new THREE.Shape();
  s.moveTo(0, top);
  s.lineTo(tang, top);
  s.lineTo(tang, mid + bh);
  s.lineTo(bw, mid + bh);
  s.lineTo(bw, mid - bh);
  s.lineTo(tang, mid - bh);
  s.lineTo(tang, top - 2 * R);
  s.lineTo(0, top - 2 * R);
  // The window: a notch in this half, from its bottom edge up to the edge the pick lifts.
  s.lineTo(0, -WAFER.windowH * MM);
  s.lineTo(tang, -WAFER.windowH * MM);
  s.lineTo(tang, 0);
  s.lineTo(0, 0);
  s.closePath();
  const t = WAFER.thick * MM;
  const g = new THREE.ExtrudeGeometry(s, { depth: t, bevelEnabled: false });
  // Shape X -> away from the camera, extrusion -> along the keyway.
  g.rotateY(Math.PI / 2);
  g.translate(-t / 2, 0, 0);
  return g;
}

function housingGeometry(spec: LockSpec, cut: Section) {
  if (spec.kind === 'wafer') return waferHousingGeometry(spec, cut);
  const L = spec.plugLen * MM;
  const rh = GEO.housingR * MM;
  const w = GEO.bibleHalfW * MM;
  const top = GEO.bibleTopY * MM;
  const y0 = Math.sqrt(rh * rh - w * w);
  const a0 = Math.atan2(y0, w);

  const shape = new THREE.Shape();
  shape.moveTo(w, y0);
  shape.lineTo(w, top - 0.8);
  shape.quadraticCurveTo(w, top, w - 0.8, top);
  shape.lineTo(-w + 0.8, top);
  shape.quadraticCurveTo(-w, top, -w, top - 0.8);
  shape.lineTo(-w, y0);
  shape.absarc(0, 0, rh, Math.PI - a0, a0, false);
  const bore = new THREE.Path();
  bore.absarc(0, 0, GEO.plugR * MM + 0.06, 0, Math.PI * 2, true);
  shape.holes.push(bore);

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: L,
    bevelEnabled: false,
    curveSegments: 48,
  });
  geo.rotateY(Math.PI / 2); // extrusion axis -> +X
  geo.deleteAttribute('uv');

  let b = brush(geo);
  if (spec.pins.some((p) => p.row === 'side')) {
    // A second tower on the far side for the side row's drivers and springs.
    const inner = GEO.plugR * MM + 1.3;
    const boss = new THREE.BoxGeometry(L - 0.6, w * 2, top - inner);
    boss.deleteAttribute('uv');
    b = unite(b, brush(boss, L / 2, 0, -(inner + top) / 2));
  }
  for (const pin of spec.pins) {
    if (pin.part !== 'inner') b = subtract(b, chamberBore(pin, 3, top + 2));
  }
  return finish(section(b, cut, L));
}

/** Plug: the rotating core with the keyway and the lower pin chambers. */
export function buildPlug(spec: LockSpec, cut: Section) {
  return withoutBvhNoise(() => plugGeometry(spec, cut));
}

function plugGeometry(spec: LockSpec, cut: Section) {
  const L = spec.plugLen * MM;
  const geo = spec.geo;
  const R = GEO.plugR * MM;
  const base = cylX(R, L, 96);
  base.deleteAttribute('uv');
  let b = brush(base, L / 2, 0, 0);

  // A keyway that reaches the bottom of the plug is cut clean through it.
  const open = geo.keywayBottomY * MM <= -R + 0.01;
  const kwBottom = geo.keywayBottomY * MM - (open ? 1 : 0);
  const kwH = geo.keywayTopY * MM - kwBottom;
  const kwY = (geo.keywayTopY * MM + kwBottom) / 2;
  const kw = new THREE.BoxGeometry(L + 6, kwH, geo.keywayHalfW * 2 * MM);
  kw.deleteAttribute('uv');
  b = subtract(b, brush(kw, L / 2, kwY, 0));

  for (const pin of spec.pins) {
    if (pin.wafer) {
      // A slot right across the plug for the wafer to slide in.
      const slot = new THREE.BoxGeometry(WAFER.thick * MM + 0.12, 2 * R + 2, WAFER.bodyHalfW * 2 * MM + 0.3);
      slot.deleteAttribute('uv');
      b = subtract(b, brush(slot, pin.x * MM, 0, 0));
    } else if (pin.part !== 'inner') b = subtract(b, chamberBore(pin, pin.floor * MM, R + 2));
  }
  return finish(section(b, cut, L));
}

function lathe(points: Array<[number, number]>) {
  return new THREE.LatheGeometry(
    points.map(([r, y]) => new THREE.Vector2(Math.max(r, 0), y)),
    40,
  );
}

/**
 * A hollow pin, drawn as a half shell with its open side toward local +Z so
 * the pin inside it can be seen. `outer` is the outside profile from bottom to
 * top; the bore is a plain cylinder. The two flat cut faces are capped.
 */
function halfShell(outer: Array<[number, number]>, bore: number) {
  const loop: Array<[number, number]> = [...outer, [bore, outer[outer.length - 1][1]], [bore, outer[0][1]]];
  const ring = [...loop, loop[0]];
  const shell = new THREE.LatheGeometry(
    ring.map(([r, y]) => new THREE.Vector2(r, y)),
    24,
    Math.PI / 2,
    Math.PI,
  );
  const wall = new THREE.Shape(loop.map(([r, y]) => new THREE.Vector2(r, y)));
  const capA = new THREE.ShapeGeometry(wall);
  const capB = new THREE.ShapeGeometry(wall);
  capB.scale(-1, 1, 1);
  const parts = [shell, capA, capB].map((g) => g.toNonIndexed());
  const merged = mergeGeometries(parts);
  for (const g of [shell, capA, capB, ...parts]) g.dispose();
  merged.computeVertexNormals();
  return merged;
}

/** Key pin: pointed tip that rides the key, bevelled top. Origin at the tip. */
export function buildKeyPin(pin: PinSpec) {
  const L = pin.keyLen * MM;
  const inner = pin.part === 'inner';
  const r = (inner ? TELESCOPE.innerR : GEO.pinR) * MM;
  const bore = TELESCOPE.boreR * MM;
  const pts: Array<[number, number]> =
    pin.part === 'outer'
      ? [
          [bore, 0.3],
          [r, 1.05],
          [r, 1.06],
        ]
      : inner
        ? [
            [0, 0],
            [0.15, 0],
            [r, 0.55],
            [r, 0.56],
          ]
        : [
            [0, 0],
            [KEY_TIP.flat * MM, 0],
            [r, KEY_TIP.height * MM],
            [r, KEY_TIP.height * MM + 0.01],
          ];
  // Top bevel, and any serrations, come straight from the physics profile.
  for (let i = pin.keyProfile.length - 1; i >= 0; i--) {
    const [u, d] = pin.keyProfile[i];
    pts.push([r - d * MM, L - u * MM]);
  }
  if (pin.part === 'outer') return halfShell(pts, bore);
  pts.push([0, L]);
  return lathe(pts);
}

/** Driver pin, lathed from its physics profile. Origin at the bottom face. */
export function buildDriver(pin: PinSpec) {
  const r = (pin.part === 'inner' ? TELESCOPE.innerR : GEO.pinR) * MM;
  const profile: Array<[number, number]> = pin.profile.map(([s, d]) => [r - d * MM, s * MM]);
  if (pin.part === 'outer') return halfShell(profile, TELESCOPE.boreR * MM);
  return lathe([[0, 0], ...profile, [0, pin.driverLen * MM]]);
}

class Helix extends THREE.Curve<THREE.Vector3> {
  constructor(
    private r: number,
    private h: number,
    private turns: number,
  ) {
    super();
  }
  getPoint(t: number, target = new THREE.Vector3()) {
    const a = t * this.turns * Math.PI * 2;
    return target.set(Math.cos(a) * this.r, t * this.h, Math.sin(a) * this.r);
  }
}

export const SPRING_BASE_H = 8;

/**
 * Compression spring, unit-scaled along Y at runtime. Origin at the bottom.
 * The small one sits inside the large one in a telescoping chamber.
 */
export function buildSpring(small = false) {
  return small
    ? new THREE.TubeGeometry(new Helix(0.46, SPRING_BASE_H, 12), 300, 0.1, 5, false)
    : new THREE.TubeGeometry(new Helix(1.08, SPRING_BASE_H, 9), 260, 0.15, 6, false);
}

/**
 * The pick for a lock: a hook, half-diamond or rake for pin tumblers, a flag
 * for dimple locks. Pin tumbler picks come as two material groups: the steel
 * blade, then the handle (see pickMaterials in the view).
 */
export function buildPick(pick: PickSpec) {
  if (pick.kind === 'flag') return buildFlagPick(pick);
  const s = new THREE.Shape();
  let axisY: number;
  if (pick.kind === 'rake') axisY = rakeOutline(s, pick);
  else if (pick.kind === 'diamond') axisY = diamondOutline(s, pick);
  else axisY = hookOutline(s, pick);
  const blade = new THREE.ExtrudeGeometry(s, {
    depth: 0.6,
    bevelEnabled: true,
    bevelSize: 0.06,
    bevelThickness: 0.06,
    bevelSegments: 1,
    curveSegments: 14,
  });
  blade.translate(0, 0, -0.3);
  const handle = buildPickHandle(axisY);
  const g = mergeGeometries([blade, handle], true);
  blade.dispose();
  handle.dispose();
  return g;
}

// Where the working end of a pick stops and its shank begins, where the shank
// reaches full height, and where the tang ends inside the handle (mm from the tip).
const SHANK_FROM = -30;
const SHANK_FULL = -46;
const TANG_END = -70;
/** How much taller than the working end the shank is, above and below. */
const SHANK_FLARE = 0.9;

/**
 * Carry a pick's outline back from its working end into the handle: the blade
 * widens into a shank, as on a real pick, and ends in a tang the handle hides.
 * `bottomFirst` says which edge the outline arrives along.
 */
function shankOutline(s: THREE.Shape, yTop: number, yBot: number, bottomFirst: boolean) {
  const pts: Array<[number, number]> = [
    [SHANK_FROM, yBot],
    [SHANK_FULL, yBot - SHANK_FLARE],
    [TANG_END, yBot - SHANK_FLARE],
    [TANG_END, yTop + SHANK_FLARE],
    [SHANK_FULL, yTop + SHANK_FLARE],
    [SHANK_FROM, yTop],
  ];
  if (!bottomFirst) pts.reverse();
  for (const [x, y] of pts) s.lineTo(x, y);
}

/** Moulded handle around the tang, centred on the shank at height `axisY`. */
function buildPickHandle(axisY: number) {
  const x0 = SHANK_FULL + 1.5;
  const x1 = -142;
  const neck = 2.6;
  const half = 4.6;
  const s = new THREE.Shape();
  s.moveTo(x0, axisY - neck);
  s.bezierCurveTo(x0 - 5, axisY - neck, x0 - 6, axisY - half, x0 - 14, axisY - half);
  s.lineTo(x1 + 9, axisY - half + 0.5);
  s.quadraticCurveTo(x1, axisY - half + 0.6, x1, axisY);
  s.quadraticCurveTo(x1, axisY + half - 0.6, x1 + 9, axisY + half - 0.5);
  s.lineTo(x0 - 14, axisY + half);
  s.bezierCurveTo(x0 - 6, axisY + half, x0 - 5, axisY + neck, x0, axisY + neck);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, {
    depth: 2.4,
    bevelEnabled: true,
    bevelSize: 0.7,
    bevelThickness: 0.7,
    bevelSegments: 3,
    curveSegments: 14,
  });
  g.translate(0, 0, -1.2);
  return g;
}

/**
 * Rake: a strip of steel bent into waves, the same thickness all the way
 * along. Its top edge is exactly the curve the physics lifts the pins with;
 * the bottom edge is that curve offset by the strip's thickness, measured
 * square to the strip, so the slopes are as stout as the peaks and the
 * insides of the bends come out tight, as on a real rake. The end is rounded.
 * Origin is the top of the front peak; the shaft runs toward -X.
 * Returns the height of the shank's centre line, as the other outlines do.
 */
function rakeOutline(s: THREE.Shape, pick: PickSpec) {
  const amp = pick.rakeAmp * MM;
  const thick = 0.85;
  const front = pick.tipReach * MM;
  // A little way onto the straight shaft behind the last wave.
  const back = -(pick.rakePeaks - 0.5) * pick.rakePitch * MM - 1.2;
  const n = 220;
  const top: Array<[number, number]> = [];
  for (let k = 0; k <= n; k++) {
    const x = front + ((back - front) * k) / n;
    top.push([x, -rakeDepth(pick, x / MM) * MM]);
  }
  // Lowest point reached by a disc of the strip's thickness rolled along the top edge.
  const under = (x: number) => {
    let y = Infinity;
    for (const [tx, ty] of top) {
      const dx = x - tx;
      if (Math.abs(dx) < thick) y = Math.min(y, ty - Math.sqrt(thick * thick - dx * dx));
    }
    return y;
  };
  s.moveTo(top[0][0], top[0][1]);
  for (const [x, y] of top) s.lineTo(x, y);
  shankOutline(s, -amp, -amp - thick, false);
  // Back along the underside, and round the end of the strip.
  const nose = front + thick * 0.6;
  for (let k = 0; k <= n; k++) {
    const x = back + ((nose - back) * k) / n;
    s.lineTo(x, under(x));
  }
  s.closePath();
  return -amp - thick / 2;
}

/**
 * Half-diamond: the end of the shaft rises to a point in a low triangle. The
 * front face runs steeply from the point down to the bottom corner of the
 * shaft; the back slopes away gently. Origin is the point.
 */
function diamondOutline(s: THREE.Shape, pick: PickSpec) {
  const hh = pick.hookH * MM;
  const back = pick.tipReach * MM;
  const front = pick.tipFront * MM;
  s.moveTo(-0.16, -0.1);
  s.quadraticCurveTo(0, 0.02, 0.14, -0.1);
  // One straight face from the point to the bottom front corner.
  s.lineTo(front + 0.2, -hh - 0.62);
  s.quadraticCurveTo(front + 0.3, -hh - 0.82, front, -hh - 0.82);
  shankOutline(s, -hh, -hh - 1.0, true);
  s.lineTo(-back, -hh);
  s.closePath();
  return -hh - 0.5;
}

/**
 * Hook: a slim shaft whose end sweeps up and forward into a rounded tip, at
 * an angle rather than a right-angled corner. Origin is the top of the tip.
 * The shaft's top edge is the line the physics uses for it, and the blade is
 * never taller than the physics allows for.
 */
function hookOutline(s: THREE.Shape, pick: PickSpec) {
  const hh = pick.hookH * MM;
  // How far back the tip leans over its full height. A short hook rises at
  // about 50 degrees; a deep hook stands much steeper, about 70 degrees, on a
  // tall slender neck.
  const deep = hh > 3;
  const run = (deep ? 0.36 : 0.84) * hh;
  // Front and back edges of the angled part, at height y below the tip.
  const front = (y: number) => (deep ? 0.45 : 0.55) + (run * y) / hh;
  const back = (y: number) => (deep ? -0.36 : -0.4) + (run * y) / hh;

  // Rounded tip.
  s.moveTo(-0.32, -0.12);
  s.quadraticCurveTo(-0.1, 0.02, 0.12, -0.03);
  s.quadraticCurveTo(0.36, -0.14, front(-0.5), -0.5);
  // Down the front of the tip, then a long bend back under the shaft.
  s.lineTo(front(-0.55 * hh), -0.55 * hh);
  s.bezierCurveTo(front(-hh), -hh, front(-hh) - 0.9, -hh - 0.72, -run - 2.4, -hh - 0.76);
  // The shaft is slimmest at the bend and thickens toward the shank.
  s.lineTo(-14, -hh - 0.85);
  shankOutline(s, -hh, -hh - 1.0, true);
  // Inside of the bend, then up the back of the tip.
  s.lineTo(-run - 3.0, -hh);
  s.bezierCurveTo(-run - 1.5, -hh, back(-0.9 * hh) - 0.25, -0.9 * hh, back(-0.68 * hh), -0.68 * hh);
  s.lineTo(back(-0.45), -0.45);
  s.quadraticCurveTo(-0.42, -0.24, -0.32, -0.12);
  return -hh - 0.5;
}

/**
 * Dimple flag pick: a thin round wire with a small flat tab, the flag, milled
 * at its very end, held in a round handle like a pin vice with a banded grip.
 * The origin is on the shaft axis under the flag, the shaft runs toward -X
 * and the flag points along +Y; twisting the mesh about X swings the flag.
 * Two material groups: the steel, then the dark bands of the grip.
 */
function buildFlagPick(pick: PickSpec) {
  const r = FLAG_SHAFT_R * MM;
  const len = pick.flagLen * MM;
  const w = pick.tipHalfW * 2 * MM;
  const end = w / 2 + 0.1; // the wire stops just past the flag
  const shaftLen = 50;

  const shaft = cylX(r, shaftLen, 20);
  shaft.translate(end - shaftLen / 2, 0, 0);
  const cap = new THREE.SphereGeometry(r, 16, 10);
  cap.translate(end, 0, 0);

  // The flag: a flat tab, a touch narrower toward its rounded tip.
  const tipR = w * 0.4;
  const fs = new THREE.Shape();
  fs.moveTo(-w / 2, 0);
  fs.lineTo(-tipR, len - tipR);
  fs.absarc(0, len - tipR, tipR, Math.PI, 0, true);
  fs.lineTo(w / 2, 0);
  fs.closePath();
  const flag = new THREE.ExtrudeGeometry(fs, {
    depth: 0.42,
    bevelEnabled: true,
    bevelSize: 0.05,
    bevelThickness: 0.05,
    bevelSegments: 1,
    curveSegments: 10,
  });
  flag.translate(0, 0, -0.21);

  // Handle, turned on a lathe: a tapered nose gripping the wire, a collar,
  // then a long round body with a domed end. [radius, distance back].
  const body = new THREE.LatheGeometry(
    (
      [
        [r + 0.1, 0],
        [1.1, 0.4],
        [1.9, 6],
        [2.7, 7],
        [2.7, 9.2],
        [2.3, 9.8],
        [2.3, 10.6],
        [3.0, 11.4],
        [3.0, 76],
        [2.5, 78.4],
        [1.2, 79.4],
        [0, 79.6],
      ] as Array<[number, number]>
    ).map(([rad, y]) => new THREE.Vector2(rad, y)),
    40,
  );
  // The lathe's axis is +Y; lay it along -X behind the shaft.
  const x0 = end - shaftLen + 1;
  body.rotateZ(Math.PI / 2).translate(x0, 0, 0);

  // Dark bands around the front of the body for grip.
  const bands: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 9; k++) {
    const band = new THREE.CylinderGeometry(3.08, 3.08, 1.5, 40, 1, true);
    band.rotateZ(Math.PI / 2).translate(x0 - 14.5 - k * 3.1, 0, 0);
    bands.push(band);
  }

  const flat = (parts: THREE.BufferGeometry[]) => {
    const merged = mergeGeometries(parts.map((q) => q.toNonIndexed()));
    for (const q of parts) q.dispose();
    return merged;
  };
  const steel = flat([shaft, cap, flag, body]);
  const grip = flat(bands);
  const g = mergeGeometries([steel, grip], true);
  steel.dispose();
  grip.dispose();
  return g;
}

/**
 * A flat strip swept along the Y axis through a list of cross-sections, each
 * [y, thickness, width, twist about Y]. Used for the handles of the tension
 * tools, which are flat spring steel and, on a twisted wrench, turn through a
 * right angle part-way along. Faces are flat-shaded.
 */
function sweepStrip(cx: number, cz: number, secs: Array<[number, number, number, number]>) {
  const rings = secs.map(([y, w, d, a]) => {
    const c = Math.cos(a);
    const sn = Math.sin(a);
    return [
      [-w / 2, -d / 2],
      [w / 2, -d / 2],
      [w / 2, d / 2],
      [-w / 2, d / 2],
    ].map(([lx, lz]) => new THREE.Vector3(cx + lx * c + lz * sn, y, cz - lx * sn + lz * c));
  });
  // Corner order gives outward faces for a strip running downward; flip if it runs up.
  const up = secs[1][0] > secs[0][0];
  const pos: number[] = [];
  const tri = (p: THREE.Vector3, q: THREE.Vector3, r: THREE.Vector3) => {
    const [m, o] = up ? [r, q] : [q, r];
    pos.push(p.x, p.y, p.z, m.x, m.y, m.z, o.x, o.y, o.z);
  };
  for (let i = 0; i + 1 < rings.length; i++) {
    for (let k = 0; k < 4; k++) {
      const j = (k + 1) % 4;
      tri(rings[i][k], rings[i][j], rings[i + 1][j]);
      tri(rings[i][k], rings[i + 1][j], rings[i + 1][k]);
    }
  }
  const first = rings[0];
  const last = rings[rings.length - 1];
  tri(first[0], first[2], first[1]);
  tri(first[0], first[3], first[2]);
  tri(last[0], last[1], last[2]);
  tri(last[0], last[2], last[3]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

/** Extrude a tension tool's blade and elbow, and join its handle on. */
function wrenchGeometry(shape: THREE.Shape, zOff: number, handle: THREE.BufferGeometry) {
  const blade = new THREE.ExtrudeGeometry(shape, {
    depth: 2.2,
    bevelEnabled: true,
    bevelSize: 0.08,
    bevelThickness: 0.08,
    bevelSegments: 1,
    curveSegments: 8,
  });
  blade.translate(0, 0, -1.1 + zOff);
  blade.deleteAttribute('uv');
  const g = mergeGeometries([blade, handle]);
  blade.dispose();
  handle.dispose();
  return g;
}

/**
 * Tension tool, in the plug's frame. The bottom-of-keyway one is a twisted
 * wrench: a strip of spring steel with a short blade bent at a right angle,
 * lying in the bottom of the keyway, and a quarter twist in the handle so its
 * flat faces the finger that pushes it. In a dimple lock the same wrench goes
 * at one edge of the flat keyway so the pick has the middle to itself.
 */
export function buildWrench(spec: LockSpec, top = false) {
  if (top) return buildTopWrench(spec);
  const y0 = spec.geo.keywayBottomY * MM;
  const dimple = spec.kind === 'dimple';
  // Near edge of the flat keyway, and short, to stay clear of the side row.
  const zOff = dimple ? spec.geo.keywayHalfW * MM - 1.2 : 0;
  // In a pin tumbler the blade is the one the pick collides with.
  const reach = dimple ? 4.5 : BOK_WRENCH.reach * MM;
  const bladeTop = y0 + (dimple ? 1.25 : BOK_WRENCH.thick * MM);
  const straight = y0 - 12;
  const s = new THREE.Shape();
  s.moveTo(reach, y0 + 0.05);
  s.lineTo(reach, bladeTop);
  s.lineTo(-0.2, bladeTop);
  s.quadraticCurveTo(-2.3, bladeTop, -2.3, y0 - 1.5);
  s.lineTo(-2.3, straight);
  s.lineTo(-1.0, straight);
  s.lineTo(-1.0, y0 - 1.2);
  s.quadraticCurveTo(-1.0, y0 + 0.05, 0.2, y0 + 0.05);
  s.lineTo(reach, y0 + 0.05);

  // Handle: edge-on at first, a quarter twist, then the wide flat to the end.
  const secs: Array<[number, number, number, number]> = [[straight + 0.05, 1.3, 2.36, 0]];
  const twist = 11;
  for (let k = 1; k <= 32; k++) {
    const t = k / 32;
    const ease = t * t * (3 - 2 * t);
    secs.push([straight - twist * t, 1.3, 2.36 + 0.8 * ease, (Math.PI / 2) * ease]);
  }
  secs.push([y0 - 74, 1.3, 3.16, Math.PI / 2], [y0 - 77, 1.3, 2.3, Math.PI / 2], [y0 - 78, 1.3, 1.2, Math.PI / 2]);
  return wrenchGeometry(s, zOff, sweepStrip(-1.65, zOff, secs));
}

/**
 * Top-of-keyway tension tool: a pry bar. A stout flat bar with a short leg
 * bent at a right angle; the leg, toothed on the inside of the bend to grip, wedges into the top of the
 * keyway at the face and stops short of the first pin. The handle runs
 * straight up the front of the lock, untwisted, and the bottom of the keyway
 * stays clear.
 */
function buildTopWrench(spec: LockSpec) {
  const y1 = spec.geo.keywayTopY * MM;
  // A dimple lock's keyway is a flat slot: the leg goes in at one end of it,
  // leaving the middle to the pick.
  const zOff = spec.kind === 'dimple' ? spec.geo.keywayHalfW * MM - 1.25 : 0;
  const reach = 3.2;
  const under = y1 - 1.15;
  const straight = y1 + 5;
  const s = new THREE.Shape();
  s.moveTo(reach, y1 - 0.05);
  s.lineTo(reach, under);
  s.lineTo(-0.2, under);
  s.quadraticCurveTo(-2.4, under, -2.4, y1 + 1.5);
  s.lineTo(-2.4, straight);
  s.lineTo(-1.0, straight);
  s.lineTo(-1.0, y1 + 1.2);
  s.quadraticCurveTo(-1.0, y1 - 0.05, 0.2, y1 - 0.05);
  // Teeth along the leg's upper edge: the inside of the bend, facing the handle.
  for (const x of [0.9, 1.7, 2.5]) {
    s.lineTo(x - 0.5, y1 - 0.05);
    s.lineTo(x + 0.1, y1 - 0.35);
  }
  s.lineTo(reach, y1 - 0.05);
  // A plain straight bar, a little wider than the leg, with a rounded end.
  const secs: Array<[number, number, number, number]> = [
    [straight - 0.05, 1.4, 2.36, 0],
    [straight + 3, 1.4, 3.4, 0],
    [y1 + 74, 1.4, 3.4, 0],
    [y1 + 77, 1.4, 2.4, 0],
    [y1 + 78, 1.4, 1.2, 0],
  ];
  return wrenchGeometry(s, zOff, sweepStrip(-1.7, zOff, secs));
}

/** Flat tailpiece on the back of the plug so rotation is easy to read. */
export function buildTailpiece(spec: LockSpec) {
  const L = spec.plugLen * MM;
  const g = new THREE.BoxGeometry(9, 9.5, 2.2);
  g.translate(L + 4.5, 0, 0);
  return g;
}

export function buildChamberCap() {
  const cr = GEO.chamberR * MM;
  const h = (GEO.bibleTopY - GEO.chamberTopY) * MM - 0.15;
  const g = new THREE.CylinderGeometry(cr, cr, h, 24);
  g.translate(0, GEO.chamberTopY * MM + h / 2, 0);
  return g;
}
