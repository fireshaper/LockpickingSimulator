// Disc detainer lock: definition and physics.
//
// Instead of pin stacks, a row of discs sits inside the core. Each disc has a
// gate (a notch) cut into its rim at an angle set by the key code. A sidebar
// lies along the top of the discs, half in a slot in the core and half in a
// groove in the housing, so the core cannot turn. Only when every disc has
// been rotated to bring its gate under the sidebar can the sidebar drop into
// the gates, clear the housing and let the core turn.
//
// Picking works for the same reason as in a pin tumbler: tolerances. Turning
// force on the core pushes the sidebar's sloped top against the housing
// groove, which cams it down onto the discs. The discs are not all exactly
// the same size, so the sidebar rests on only the largest one: that disc
// binds, the others turn freely. Rotate the binding disc until its gate
// arrives, the sidebar drops a hair onto the next largest disc, and so on.
// False gates are shallow notches: the sidebar drops part-way into one, the
// core turns a little further (a false set), and the disc is trapped until
// tension is eased.
//
// Model: each disc has one rotational degree of freedom, the core has one,
// and the sidebar's radial position is solved statically each step from the
// force balance between the cam force, its return spring and the discs it is
// pressing on. Gate ramps convert sidebar force into disc torque and back,
// which is what produces clicks into gates, trapped discs and false sets.

import { mulberry32 } from './lock';
import type { PinStatus, SimEvent } from './physics';

const rad = (deg: number) => (deg * Math.PI) / 180;

/** Dimensions in metres and radians. */
export const DISC = {
  R0: 7.0e-3,
  thick: 1.4e-3,
  pitch: 2.0e-3,
  firstX: 3.2e-3,
  tail: 3.4e-3,
  gateDepth: 1.2e-3,
  gateHalf: rad(5),
  gateRamp: rad(3),
  falseDepth: 0.35e-3,
  falseHalf: rad(4),
  falseRamp: rad(2.5),
  /** Angle between neighbouring code positions. */
  step: rad(18),
  maxAngle: rad(108),
  coreIn: 7.25e-3,
  coreOut: 8.6e-3,
  housingIn: 8.66e-3,
  housingOut: 12.2e-3,
  grooveDepth: 1.0e-3,
  sidebarH: 2.5e-3,
  sidebarW: 1.5e-3,
  /** How far the sidebar must drop to clear the housing groove. */
  clearDrop: 0.95e-3,
  keyholeLen: 6.6e-3,
  keyholeW: 2.4e-3,
} as const;

export const discX = (i: number) => DISC.firstX + i * DISC.pitch;

export interface DiscSpec {
  code: number;
  /** Rotation that brings the true gate under the sidebar. */
  gate: number;
  /** Rotations at which a false gate is under the sidebar. */
  falseGates: number[];
  /** How much larger than nominal this disc's radius is. Largest binds first. */
  excess: number;
}

export interface DiscLockSpec {
  kind: 'disc';
  name: string;
  description: string;
  discs: DiscSpec[];
  plugLen: number;
  seed: number;
}

export interface DiscPreset {
  id: string;
  name: string;
  description: string;
  discCount: number;
  toleranceGap: number;
  falseGates: number;
}

export const DISC_PRESETS: DiscPreset[] = [
  {
    id: 'disc6',
    name: '12 · Disc detainer, 6 discs',
    description:
      'Rotating discs instead of pins. A sidebar rests on the discs and must drop into a gate cut in each one. Hold the mouse button on a disc and drag up to turn it: the binding disc is stiff, and clicks loose when its gate reaches the sidebar.',
    discCount: 6,
    toleranceGap: 0.03e-3,
    falseGates: 0,
  },
  {
    id: 'disc9false',
    name: '13 · Disc detainer, 9 discs, false gates',
    description:
      'Nine discs with shallow false gates. A disc that clicks into a false gate lets the core turn a little and then traps that disc. Ease off tension to free it and carry on to the true gate.',
    discCount: 9,
    toleranceGap: 0.02e-3,
    falseGates: 2,
  },
];

export function generateDiscLock(preset: DiscPreset, seed: number): DiscLockSpec {
  const rnd = mulberry32(seed);
  const n = preset.discCount;
  const order = [...Array(n).keys()];
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const excess = new Array<number>(n);
  let e = 0;
  // order[0] binds last (smallest), the final one binds first (largest).
  for (const idx of order) {
    excess[idx] = e;
    e += preset.toleranceGap * (1 + rnd() * 0.6);
  }
  const discs: DiscSpec[] = [];
  for (let i = 0; i < n; i++) {
    const code = 1 + Math.floor(rnd() * 5);
    const others = [1, 2, 3, 4, 5].filter((c) => c !== code);
    const falseGates: number[] = [];
    for (let k = 0; k < preset.falseGates; k++) {
      const pickIdx = Math.floor(rnd() * others.length);
      falseGates.push(others.splice(pickIdx, 1)[0] * DISC.step);
    }
    discs.push({ code, gate: code * DISC.step, falseGates, excess: excess[i] });
  }
  return {
    kind: 'disc',
    name: preset.name,
    description: preset.description,
    discs,
    plugLen: DISC.firstX + (n - 1) * DISC.pitch + DISC.tail,
    seed,
  };
}

function notch(delta: number, half: number, ramp: number, depth: number, out: { depth: number; slope: number }) {
  const a = Math.abs(delta);
  if (a <= half) {
    out.depth = depth;
    out.slope = 0;
  } else if (a < half + ramp) {
    out.depth = depth * (1 - (a - half) / ramp);
    out.slope = (delta > 0 ? -1 : 1) * (depth / ramp);
  } else {
    out.depth = 0;
    out.slope = 0;
  }
  return out;
}

const tmp = { depth: 0, slope: 0 };

/**
 * How deep the rim is cut under the sidebar when a disc is rotated by phi,
 * and how fast that changes with rotation. Shared by physics and models.
 */
export function gateDepthAt(disc: DiscSpec, phi: number, out: { depth: number; slope: number }) {
  notch(phi - disc.gate, DISC.gateHalf, DISC.gateRamp, DISC.gateDepth, out);
  if (out.depth > 0 || out.slope !== 0) return out;
  for (const g of disc.falseGates) {
    notch(phi - g, DISC.falseHalf, DISC.falseRamp, DISC.falseDepth, out);
    if (out.depth > 0) return out;
  }
  out.depth = 0;
  out.slope = 0;
  return out;
}

// --- Physical constants (SI) -------------------------------------------------
const DT = 6e-6;
const MAX_SUBSTEPS = 4500;
const K_DISC = 2e6; // N/m, sidebar pressed onto a disc rim
const K_GROOVE = 5e5; // N/m, sidebar against the housing groove
const CAM = 1.0; // 45 degree groove edge: turning force -> equal inward force
// The sidebar's return spring is light: it only has to lift the bar back out of
// the gates when tension is released. It must stay well below the force that
// even feather tension cams the bar down with (0.1 N per mN·m), or the bar
// hovers over open gates and bounces instead of dropping in.
const SIDEBAR_SPRING_F = 0.02; // N, return spring preload
const SIDEBAR_SPRING_K = 15; // N/m
const MU_STATIC = 0.3;
const MU_KINETIC = 0.24;
const W_STICK = 0.02; // rad/s
const DISC_INERTIA = 4.5e-8; // kg·m², brass disc
const DISC_DRAG = 2e-5; // N·m·s/rad
const CORE_INERTIA = 3e-6;
const CORE_DAMPING = 6e-3;
const HAND_K = 0.2; // N·m/rad, pick + fingers in twist
const HAND_C = 1.2e-4;
const PICK_TORQUE_MAX = 0.05; // N·m
const OPEN_ANGLE = 0.3;

export interface DiscInput {
  torque: number;
  /** Disc the pick is gripping, or -1. */
  pickDisc: number;
  /** Angle the hand is trying to turn that disc to. */
  pickAngle: number;
}

function advance(w: number, tnf: number, cap: number, inertia: number, dt: number) {
  if (cap <= 0) return w + (tnf / inertia) * dt;
  const capS = MU_STATIC * cap;
  const capK = MU_KINETIC * cap;
  if (Math.abs(w) < W_STICK) {
    if (Math.abs(tnf) <= capS) return 0;
    return w + ((tnf - Math.sign(tnf) * capK) / inertia) * dt;
  }
  const nw = w + ((tnf - Math.sign(w) * capK) / inertia) * dt;
  if (nw * w <= 0 && Math.abs(tnf) <= capS) return 0;
  return nw;
}

export class DiscSim {
  readonly spec: DiscLockSpec;
  readonly n: number;
  /** Rotation of each disc. */
  readonly phi: Float64Array;
  readonly omegaD: Float64Array;
  /** Force of the sidebar on each disc. */
  readonly normal: Float64Array;
  private readonly lift: Float64Array; // rim height above nominal under the sidebar
  private readonly slope: Float64Array;
  private readonly lastStatus: PinStatus[];

  theta = 0;
  omega = 0;
  opened = false;
  time = 0;
  inFalseSet = false;
  /** Sidebar height relative to a nominal disc rim (negative = dropped in). */
  sidebarY: number;
  /** Torque the pick is applying. */
  pickTorque = 0;

  private readonly restY: number;
  private readonly freePlay: number;
  private sidebarCaptive = false;
  private accumulator = 0;
  private lastTorque = 0;
  private lastAngle = 0;

  constructor(spec: DiscLockSpec) {
    this.spec = spec;
    const n = (this.n = spec.discs.length);
    this.phi = new Float64Array(n);
    this.omegaD = new Float64Array(n);
    this.normal = new Float64Array(n);
    this.lift = new Float64Array(n);
    this.slope = new Float64Array(n);
    this.lastStatus = new Array(n).fill('free');
    let maxE = 0;
    for (const d of spec.discs) maxE = Math.max(maxE, d.excess);
    // Unloaded, the spring holds the sidebar clear of even the largest disc.
    this.restY = maxE + 0.1e-3;
    this.freePlay = this.restY + 0.09e-3;
    this.sidebarY = this.restY;
  }

  reset() {
    this.phi.fill(0);
    this.omegaD.fill(0);
    this.normal.fill(0);
    this.lastStatus.fill('free');
    this.theta = this.omega = 0;
    this.opened = false;
    this.inFalseSet = false;
    this.sidebarY = this.restY;
    this.sidebarCaptive = false;
    this.accumulator = 0;
    this.lastTorque = 0;
    this.pickTorque = 0;
  }

  get totalPickForce() {
    return Math.abs(this.pickTorque);
  }

  /** 'overset' is used for a disc caught in a false gate. */
  status(i: number): PinStatus {
    const d = this.spec.discs[i];
    const phi = this.phi[i];
    if (Math.abs(phi - d.gate) <= DISC.gateHalf + DISC.gateRamp * 0.7) return 'set';
    gateDepthAt(d, phi, tmp);
    if (tmp.depth > DISC.falseDepth * 0.5 && this.sidebarY < d.excess - tmp.depth + 0.12e-3)
      return 'overset';
    if (this.normal[i] > 0.05) return 'binding';
    return 'free';
  }

  step(frameDt: number, input: DiscInput): SimEvent[] {
    const events: SimEvent[] = [];
    if (this.opened) return events;
    this.accumulator += Math.min(frameDt, 0.05);
    const steps = Math.min(MAX_SUBSTEPS, Math.floor(this.accumulator / DT));
    this.accumulator -= steps * DT;
    if (this.accumulator > DT) this.accumulator = 0;

    const t0 = this.lastTorque;
    const a0 = input.pickDisc >= 0 ? this.lastAngle : input.pickAngle;
    for (let k = 1; k <= steps; k++) {
      const a = k / steps;
      this.substep(
        t0 + (input.torque - t0) * a,
        input.pickDisc,
        a0 + (input.pickAngle - a0) * a,
      );
      if (this.opened) break;
    }
    if (steps > 0) {
      this.lastTorque = input.torque;
      this.lastAngle = input.pickAngle;
    }
    if (input.pickDisc < 0) this.pickTorque = 0;
    this.time += steps * DT;

    for (let i = 0; i < this.n; i++) {
      const st = this.status(i);
      const prev = this.lastStatus[i];
      if (st !== prev) {
        if (st === 'set') events.push({ type: 'set', pin: i, strength: 0.7 });
        else if (st === 'overset') events.push({ type: 'overset', pin: i, strength: 0.6 });
        else if (prev === 'set') events.push({ type: 'drop', pin: i, strength: 0.4 });
        this.lastStatus[i] = st;
      }
    }
    // Resting part-way down, in a false gate: not clear of the housing.
    const deep =
      !this.opened &&
      !this.sidebarCaptive &&
      this.sidebarY < -DISC.falseDepth * 0.5 &&
      this.sidebarY > -DISC.clearDrop * 0.9;
    if (!deep) this.inFalseSet = false;
    else if (!this.inFalseSet && Math.abs(this.omega) < 0.5) {
      this.inFalseSet = true;
      events.push({ type: 'falseSet', pin: -1, strength: 0.8 });
    }
    if (this.opened) events.push({ type: 'open', pin: -1, strength: 1 });
    return events;
  }

  /**
   * Net outward force on the sidebar if it sat at height y. `grooveY` is how
   * high the housing groove's sloped edge lets it sit at the core's current
   * rotation; above that the edge pushes it back down.
   */
  private sidebarBalance(y: number, grooveY: number) {
    let f = SIDEBAR_SPRING_F + SIDEBAR_SPRING_K * (this.restY - y);
    if (y > grooveY) f -= CAM * K_GROOVE * (y - grooveY);
    for (let i = 0; i < this.n; i++) {
      const pen = this.lift[i] - y;
      if (pen > 0) f += K_DISC * pen;
    }
    return f;
  }

  private substep(torque: number, pickDisc: number, pickAngle: number) {
    const discs = this.spec.discs;

    // Rim height under the sidebar for each disc at its current rotation.
    for (let i = 0; i < this.n; i++) {
      gateDepthAt(discs[i], this.phi[i], tmp);
      this.lift[i] = discs[i].excess - tmp.depth;
      this.slope[i] = -tmp.slope;
    }

    // Sidebar: squeezed between the housing groove's sloped edge above, which
    // comes down on it as the core turns, and whichever discs it rests on
    // below, with a light spring lifting it. It is far lighter than the core,
    // so its height is solved from that balance each step, and the same solve
    // gives the force the groove puts back on the core. (Solving the two
    // together matters: treating the groove as a separate force on the sidebar
    // let the bar hover and bounce over open gates under light tension.)
    const arc = DISC.housingIn * this.theta;
    // Once the core has turned the sidebar out from under the groove, the
    // housing bore holds it down: it cannot rise again until the core returns.
    this.sidebarCaptive = arc > this.freePlay + DISC.clearDrop;
    const ceiling = this.sidebarCaptive ? -DISC.clearDrop : this.restY;
    const grooveY = this.sidebarCaptive ? ceiling : (this.freePlay - arc) / CAM;
    const floor = -DISC.gateDepth - 0.05e-3;
    let y: number;
    if (this.sidebarBalance(ceiling, grooveY) >= 0) y = ceiling;
    else if (this.sidebarBalance(floor, grooveY) <= 0) y = floor;
    else {
      let lo = floor;
      let hi = ceiling;
      for (let k = 0; k < 30; k++) {
        const mid = (lo + hi) / 2;
        if (this.sidebarBalance(mid, grooveY) > 0) lo = mid;
        else hi = mid;
      }
      y = (lo + hi) / 2;
    }
    this.sidebarY = y;

    // Discs.
    for (let i = 0; i < this.n; i++) {
      const pen = this.lift[i] - y;
      const N = pen > 0 ? K_DISC * pen : 0;
      this.normal[i] = N;
      const w = this.omegaD[i];
      // A sloped gate edge turns sidebar force into torque on the disc.
      let t = -N * this.slope[i] - DISC_DRAG * w;
      if (i === pickDisc) {
        let tp = HAND_K * (pickAngle - this.phi[i]) - HAND_C * w;
        if (tp > PICK_TORQUE_MAX) tp = PICK_TORQUE_MAX;
        else if (tp < -PICK_TORQUE_MAX) tp = -PICK_TORQUE_MAX;
        this.pickTorque = tp;
        t += tp;
      }
      let nw = advance(w, t, N * DISC.R0, DISC_INERTIA, DT);
      let np = this.phi[i] + nw * DT;
      if (np < 0) {
        np = 0;
        if (nw < 0) nw = 0;
      } else if (np > DISC.maxAngle) {
        np = DISC.maxAngle;
        if (nw > 0) nw = 0;
      }
      this.phi[i] = np;
      this.omegaD[i] = nw;
    }

    // Core: the groove edge pushes back with the force it puts on the sidebar.
    // Past clearDrop the sidebar is below the edge and nothing catches it.
    const groove = !this.sidebarCaptive && y > grooveY ? K_GROOVE * (y - grooveY) : 0;
    const alpha = (torque - groove * DISC.housingIn - CORE_DAMPING * this.omega) / CORE_INERTIA;
    this.omega += alpha * DT;
    this.theta += this.omega * DT;
    if (this.theta < 0) {
      this.theta = 0;
      if (this.omega < 0) this.omega = 0;
    }
    if (this.theta > OPEN_ANGLE) this.opened = true;
  }
}
