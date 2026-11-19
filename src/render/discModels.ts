// Procedural models for the disc detainer lock, in millimetres. As with the
// pin locks, the disc outlines come from the same gate function the physics
// uses, so the notches you see are the ones being simulated.
// Axes: +X runs into the lock from its face, +Y is up (the sidebar is at the
// top), +Z is toward the camera in the cutaway view.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { DISC, gateDepthAt, type DiscLockSpec, type DiscSpec } from '../sim/disc';
import { cylX, sectionGeometry, type Section } from './models';

const MM = 1000;
const tmp = { depth: 0, slope: 0 };

/**
 * Shapes are drawn looking along the lock axis and then extruded along it.
 * A point at polar angle `beta` (0 = toward the camera, 90 degrees = top) and
 * radius r maps to these shape coordinates.
 */
const polar = (r: number, beta: number) => new THREE.Vector2(-r * Math.cos(beta), r * Math.sin(beta));

function extrudeAlongX(shape: THREE.Shape, depth: number, curveSegments = 48) {
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments });
  g.rotateY(Math.PI / 2);
  return g;
}

function bump(delta: number, half: number, ramp: number) {
  const a = Math.abs(delta);
  if (a <= half) return 1;
  if (a < half + ramp) return 1 - (a - half) / ramp;
  return 0;
}

/** Housing: a tube whose bore has a groove along the top for the sidebar. */
export function buildDiscHousing(spec: DiscLockSpec, cut: Section) {
  const L = spec.plugLen * MM;
  const shape = new THREE.Shape();
  shape.absarc(0, 0, DISC.housingOut * MM, 0, Math.PI * 2, false);
  const rin = DISC.housingIn * MM;
  const half = (DISC.sidebarW * MM) / 2 / rin + 0.02;
  const ramp = (DISC.grooveDepth * MM) / rin; // 45 degree edges
  const pts: THREE.Vector2[] = [];
  for (let k = 0; k < 240; k++) {
    const beta = (k / 240) * Math.PI * 2;
    const r = rin + DISC.grooveDepth * MM * bump(beta - Math.PI / 2, half, ramp);
    pts.push(polar(r, beta));
  }
  shape.holes.push(new THREE.Path(pts));
  return sectionGeometry(extrudeAlongX(shape, L), cut, L);
}

/** Core: a sleeve around the discs with a slot along the top for the sidebar. */
export function buildDiscCore(spec: DiscLockSpec, cut: Section) {
  const L = spec.plugLen * MM;
  const ro = DISC.coreOut * MM;
  const ri = DISC.coreIn * MM;
  const slot = (DISC.sidebarW * MM) / 2 / ri + 0.015;
  const pts: THREE.Vector2[] = [];
  const steps = 120;
  const a0 = Math.PI / 2 + slot;
  const a1 = Math.PI / 2 - slot + Math.PI * 2;
  for (let k = 0; k <= steps; k++) pts.push(polar(ro, a0 + ((a1 - a0) * k) / steps));
  for (let k = steps; k >= 0; k--) pts.push(polar(ri, a0 + ((a1 - a0) * k) / steps));
  return sectionGeometry(extrudeAlongX(new THREE.Shape(pts), L), cut, L);
}

/**
 * One disc, centred on the origin, at zero rotation. Its true gate (deep) and
 * any false gates (shallow) are notched into the rim where they will come
 * under the sidebar once the disc has been turned by the right amount. The
 * slot in the middle is where the key, or the pick's tip, turns it.
 */
export function buildDisc(disc: DiscSpec) {
  const pts: THREE.Vector2[] = [];
  const n = 360;
  for (let k = 0; k < n; k++) {
    const beta = (k / n) * Math.PI * 2;
    // Rotating the disc by phi brings the point at beta = 90deg - phi to the top.
    let phi = Math.PI / 2 - beta;
    if (phi < -Math.PI) phi += Math.PI * 2;
    gateDepthAt(disc, phi, tmp);
    pts.push(polar((DISC.R0 - tmp.depth) * MM, beta));
  }
  const shape = new THREE.Shape(pts);
  const hl = (DISC.keyholeLen * MM) / 2;
  const hw = (DISC.keyholeW * MM) / 2;
  const hole = new THREE.Path();
  hole.moveTo(-hl, -hw);
  hole.lineTo(-hl, hw);
  hole.lineTo(hl, hw);
  hole.lineTo(hl, -hw);
  hole.closePath();
  shape.holes.push(hole);
  const t = DISC.thick * MM;
  const g = extrudeAlongX(shape, t, 4);
  g.translate(-t / 2, 0, 0);

  // Shade the notches by depth so they read on the rim: a true gate is
  // near-black, a shallow false gate is mid-grey.
  const pos = g.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  const R = DISC.R0 * MM;
  for (let i = 0; i < pos.count; i++) {
    const depth = R - Math.hypot(pos.getY(i), pos.getZ(i));
    const inNotch = depth > 0.02 && depth < DISC.gateDepth * MM + 0.2;
    const shade = inNotch ? 1 - 0.88 * Math.min(1, depth / (DISC.gateDepth * MM)) : 1;
    colors[i * 3] = colors[i * 3 + 1] = colors[i * 3 + 2] = shade;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

/** Sidebar. Origin on its bottom face, which is the face that meets the discs. */
export function buildSidebar(spec: DiscLockSpec) {
  const n = spec.discs.length;
  const x0 = DISC.firstX * MM - 1.2;
  const x1 = (DISC.firstX + (n - 1) * DISC.pitch) * MM + 1.2;
  const h = DISC.sidebarH * MM;
  const w = DISC.sidebarW * MM;
  // Chamfered bottom edges, facing the discs: they match the sloped sides of
  // the gates the sidebar drops into. The top, in the housing groove, is square.
  const s = new THREE.Shape([
    new THREE.Vector2(-w / 2 + 0.5, 0),
    new THREE.Vector2(w / 2 - 0.5, 0),
    new THREE.Vector2(w / 2, 0.5),
    new THREE.Vector2(w / 2, h),
    new THREE.Vector2(-w / 2, h),
    new THREE.Vector2(-w / 2, 0.5),
  ]);
  const g = extrudeAlongX(s, x1 - x0, 2);
  g.translate(x0, 0, 0);
  return g;
}

/**
 * Disc detainer pick: a slim rod ending in a small flat foot that fits a
 * disc's slot, stepping up through a sleeve into a round handle with a banded
 * grip. A lever with a ball end stands out from the handle: it is what the
 * picker turns, and it shows how far the foot is twisted. Origin at the foot;
 * the rod runs out through the lock face. Two material groups: the steel,
 * then the dark bands of the grip.
 */
export function buildDiscPick() {
  // The foot: a flat blade a little smaller than the slot, on a short neck.
  const foot = new THREE.BoxGeometry(1.1, DISC.keyholeW * MM - 0.5, DISC.keyholeLen * MM - 0.5);
  const neck = cylX(0.75, 1.6, 16);
  neck.translate(-1.3, 0, 0);
  const rod = cylX(0.85, 44, 20);
  rod.translate(-2 - 22, 0, 0);

  // Everything behind the rod is turned on a lathe. [radius, distance back].
  const x0 = -46;
  const body = new THREE.LatheGeometry(
    (
      [
        [0.85, 0],
        [1.6, 1.2],
        [1.6, 14],
        [2.4, 15.5],
        // Depth collar.
        [4.3, 16],
        [4.3, 18.2],
        [3.5, 18.8],
        [3.5, 74],
        [4.0, 74.6],
        [4.0, 78.5],
        [3.2, 80],
        [0, 80.4],
      ] as Array<[number, number]>
    ).map(([rad, y]) => new THREE.Vector2(rad, y)),
    44,
  );
  // The lathe's axis is +Y; lay it along -X behind the rod.
  body.rotateZ(Math.PI / 2).translate(x0, 0, 0);

  // The lever, square to the foot's long side so its swing is easy to see.
  const lever = new THREE.CylinderGeometry(1.0, 1.15, 13, 16);
  lever.translate(x0 - 24, 3.4 + 6.5, 0);
  const ball = new THREE.SphereGeometry(2.0, 20, 14);
  ball.translate(x0 - 24, 3.4 + 13.6, 0);

  const bands: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 10; k++) {
    const band = new THREE.CylinderGeometry(3.58, 3.58, 1.6, 44, 1, true);
    band.rotateZ(Math.PI / 2).translate(x0 - 31 - k * 3.4, 0, 0);
    bands.push(band);
  }

  const flat = (parts: THREE.BufferGeometry[]) => {
    const merged = mergeGeometries(parts.map((q) => q.toNonIndexed()));
    for (const q of parts) q.dispose();
    return merged;
  };
  const steel = flat([foot, neck, rod, body, lever, ball]);
  const grip = flat(bands);
  const g = mergeGeometries([steel, grip], true);
  steel.dispose();
  grip.dispose();
  return g;
}

/** Tensioning arm on the front of the core. */
export function buildTensionArm() {
  const g = new THREE.BoxGeometry(1.6, 60, 2.4);
  g.translate(-0.9, -(DISC.coreOut * MM) - 28, 0);
  const foot = new THREE.BoxGeometry(1.6, 3.4, 5);
  foot.translate(-0.9, -(DISC.coreIn * MM + DISC.coreOut * MM) / 2, 0);
  const parts = [g, foot].map((p) => p.toNonIndexed());
  const m = mergeGeometries(parts);
  for (const p of [g, foot, ...parts]) p.dispose();
  return m;
}

/** Plate closing the back of the core, with a tail so rotation is easy to read. */
export function buildCoreTail(spec: DiscLockSpec) {
  const L = spec.plugLen * MM;
  const plate = cylX(DISC.coreOut * MM, 1.2, 48);
  plate.translate(L + 0.6, 0, 0);
  const tail = new THREE.BoxGeometry(8, 9.5, 2.2);
  tail.translate(L + 5.2, 0, 0);
  const parts = [plate, tail].map((p) => p.toNonIndexed());
  const m = mergeGeometries(parts);
  for (const p of [plate, tail, ...parts]) p.dispose();
  return m;
}
