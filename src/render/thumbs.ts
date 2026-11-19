// Miniatures of the tools for the pick case: each is the same 3D model the
// lock view uses, stood on its handle and rendered once to a small image.

import * as THREE from 'three';
import {
  DEEP_HOOK_PICK,
  DIAMOND_PICK,
  FLAG_PICK,
  HOOK_PICK,
  PRESETS,
  RAKE_PICK,
  SNAKE_PICK,
  generateLock,
} from '../sim/lock';
import { buildPick, buildWrench } from './models';
import { buildDiscPick } from './discModels';

export type ToolModel = 'hook' | 'deep' | 'diamond' | 'rake' | 'snake' | 'flag' | 'disc' | 'bok' | 'tok';

/** Size of a miniature in CSS pixels, and how much of the tool's length it shows. */
export const THUMB_W = 40;
export const THUMB_H = 124;
const SHOWN_MM = 40;
const PIXEL_RATIO = 3;

/**
 * Render every tool. Returns image URLs keyed by tool, or null where WebGL is
 * not available, in which case the case falls back to flat outlines.
 */
export function renderToolThumbs(): Record<ToolModel, string> | null {
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  } catch {
    return null;
  }
  renderer.setPixelRatio(1);
  renderer.setSize(THUMB_W * PIXEL_RATIO, THUMB_H * PIXEL_RATIO, false);
  renderer.setClearColor(0x000000, 0);

  const halfW = (SHOWN_MM * THUMB_W) / THUMB_H / 2;
  const camera = new THREE.OrthographicCamera(-halfW, halfW, 2, 2 - SHOWN_MM, 0.1, 400);
  camera.position.set(0, 0, 200);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x4a3520, 1.5));
  const key = new THREE.DirectionalLight(0xffffff, 2.6);
  key.position.set(-4, 6, 9);
  const rim = new THREE.DirectionalLight(0xffe2b0, 1.2);
  rim.position.set(6, -2, 4);
  scene.add(key, rim);

  const steel = new THREE.MeshStandardMaterial({ color: 0xd3d8de, metalness: 0.55, roughness: 0.32 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x8b929c, metalness: 0.5, roughness: 0.45 });
  const grip = new THREE.MeshStandardMaterial({ color: 0x17191c, metalness: 0, roughness: 0.62 });
  const pinLock = generateLock(PRESETS[0], 1);

  // Picks are modelled lying along -X from the tip; wrenches hang by their handle.
  const upright = (g: THREE.BufferGeometry) => g.rotateZ(Math.PI / 2);
  const tools: Array<[ToolModel, THREE.BufferGeometry, number, THREE.Material]> = [
    ['hook', upright(buildPick(HOOK_PICK)), 0.45, steel],
    ['deep', upright(buildPick(DEEP_HOOK_PICK)), 0.45, steel],
    ['diamond', upright(buildPick(DIAMOND_PICK)), 0.45, steel],
    ['rake', upright(buildPick(RAKE_PICK)), 0.45, steel],
    ['snake', upright(buildPick(SNAKE_PICK)), 0.45, steel],
    ['flag', upright(buildPick(FLAG_PICK)), 0.3, steel],
    ['disc', upright(buildDiscPick()), 1.1, steel],
    ['bok', buildWrench(pinLock), -0.5, dark],
    ['tok', buildWrench(pinLock, true).rotateX(Math.PI), -0.5, dark],
  ];

  const out = {} as Record<ToolModel, string>;
  for (const [id, g, yaw, mat] of tools) {
    g.rotateY(yaw);
    // Stand the tool with its tip at the top, centred on the part in view.
    const pos = g.getAttribute('position');
    let top = -Infinity;
    for (let i = 0; i < pos.count; i++) top = Math.max(top, pos.getY(i));
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < pos.count; i++) {
      if (pos.getY(i) < top - SHOWN_MM) continue;
      lo = Math.min(lo, pos.getX(i));
      hi = Math.max(hi, pos.getX(i));
    }
    const mesh = new THREE.Mesh(g, g.groups.length > 1 ? [mat, grip] : mat);
    mesh.position.set(-(lo + hi) / 2, -top, 0);
    scene.add(mesh);
    renderer.render(scene, camera);
    out[id] = renderer.domElement.toDataURL('image/png');
    scene.remove(mesh);
    g.dispose();
  }
  steel.dispose();
  grip.dispose();
  dark.dispose();
  renderer.dispose();
  renderer.forceContextLoss();
  return out;
}
