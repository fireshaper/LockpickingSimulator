// Pin-tumbler lock physics.
//
// The model is built on the real reason locks can be picked: manufacturing
// tolerances. Each chamber is drilled slightly off the ideal line, so when the
// plug is torqued only ONE pin at a time is pinched at the shear line. That
// pin carries the torque (and so has friction); the rest are loose on their
// springs. Lift the binding pin until the gap between key pin and driver
// reaches the shear line and the plug turns a hair further until the next pin
// binds, leaving the driver resting on the plug.
//
// Per chamber we track two rigid bodies on one axis (key pin, driver pin) and
// for the plug one rotational degree of freedom. The pinch at the shear line
// is a stiff penalty contact whose clearance depends on the pin's profile at
// the shear line. Chamfers, spool waists and serrations are therefore not
// special cases: their slopes convert plug torque into axial force on the pin
// and vice versa, which is what produces set pins resting on their chamfer,
// false sets, and counter-rotation.

import {
  GEO as BASE_GEO,
  HOOK_PICK,
  TELESCOPE,
  KEY_BEVEL,
  KEY_BEVEL_LEN,
  DRIVER_CHAMFER,
  DRIVER_CHAMFER_LEN,
  evalProfile,
  flagAngle,
  tipRiseAt,
  rakeDepth,
  shaftPivotY,
  type WrenchSpec,
  type LockSpec,
  type LockGeometry,
  type PickSpec,
  type PinSpec,
} from './lock';

// --- Physical constants (SI) -------------------------------------------------
const DT = 6e-6; // 6 µs substep: the pinch contact is very stiff
const MAX_SUBSTEPS = 4500;
const GRAVITY = 9.81;
const PIN_LINEAR_DENSITY = 8500 * Math.PI * BASE_GEO.pinR * BASE_GEO.pinR; // brass, kg/m
const K_BIND = 8e5; // N/m, pin pinched between plug and housing
const MU_STATIC = 0.3; // effective: two lubricated brass contact faces
const MU_KINETIC = 0.24;
const V_STICK = 1e-4; // m/s
const PIN_DAMPING = 0.02; // N·s/m, lubricant drag
const PLUG_INERTIA = 1e-6; // kg·m², plug + wrench
const PLUG_DAMPING = 4e-3; // N·m·s/rad
const HAND_C = 2.0; // N·s/m
const WAFER_HOLD = 5e-6; // m of plug travel past a flush wafer before the housing holds its ends
const OPEN_ANGLE = 0.3; // rad; past this every chamber is sheared

export const MAX_TORQUE = 0.1; // N·m

// --- Pick geometry -----------------------------------------------------------
/** The hook pick, kept under its old name for callers that only use hooks. */
export const PICK = HOOK_PICK;

/**
 * How far along a pin's axis the pick's surface reaches under that pin (or
 * -Infinity if the pick is not under it). For a hook, `u` is the tip height.
 * For a flag, `u` sets the twist (see flagAngle) and the tip swings on an arc,
 * so the same twist reaches up into a top pin or across into a side pin.
 */
export function pickSurfaceY(
  pin: PinSpec,
  tipX: number,
  u: number,
  pick: PickSpec = PICK,
  wrench?: WrenchSpec | null,
): number {
  const dx = pin.x - tipX;
  const adx = Math.abs(dx);
  let h = -Infinity;
  if (pick.kind === 'flag') {
    if (adx >= pick.tipReach) return h;
    const phi = flagAngle(pick, u);
    const tipUp = pick.shaftY + pick.flagLen * Math.sin(phi);
    const tipAcross = -pick.flagLen * Math.cos(phi);
    const along = tipUp * Math.cos(pin.angle) + tipAcross * Math.sin(pin.angle);
    if (pin.part === 'inner') {
      // Only a tip close to the chamber centre goes up the outer pin's bore.
      if (adx >= TELESCOPE.innerReach) return h;
      return along - Math.max(0, adx - TELESCOPE.innerHalfW) * TELESCOPE.innerSlope;
    }
    if (pin.part === 'outer') {
      // The outer pin is a ring: a centred tip passes up the middle without
      // touching it; an off-centre tip catches the rim.
      if (adx >= TELESCOPE.outerReach) return h;
      return (
        along -
        Math.max(0, TELESCOPE.outerNear - adx) * TELESCOPE.outerNearSlope -
        Math.max(0, adx - TELESCOPE.outerFar) * pick.tipSlope
      );
    }
    return along - Math.max(0, adx - pick.tipHalfW) * pick.tipSlope;
  }
  if (pick.kind === 'rake') return u - rakeDepth(pick, dx);
  if (pick.kind === 'diamond' && dx > 0) {
    // Ahead of the point the face is short and steep.
    if (dx < pick.tipFront) h = u - (Math.max(0, dx - pick.tipHalfW) * pick.hookH) / pick.tipFront;
  } else if (pick.kind === 'diamond') {
    if (adx < pick.tipReach) h = u - Math.max(0, adx - pick.tipHalfW) * pick.tipSlope;
  } else {
    // A hook has no slopes of its own: its narrow tip pushes on whatever part
    // of the pin's underside is above it, which off-centre is the pin's cone.
    const r = Math.max(0, adx - pick.tipHalfW);
    if (r < pin.tipR) h = u - tipRiseAt(pin, r);
  }
  if (dx < -pick.shaftBack) {
    // The shaft pivots about the picker's hand outside the keyway.
    const baseX = tipX - pick.shaftBack;
    const baseY = u - pick.hookH;
    const pivotY = shaftPivotY(pick, baseX, baseY, wrench);
    const t = (pin.x - pick.pivotX) / (baseX - pick.pivotX);
    const sh = pivotY + (baseY - pivotY) * t;
    if (sh > h) h = sh;
  }
  return h;
}

export type PinStatus = 'free' | 'binding' | 'set' | 'overset';

export interface SimEvent {
  type: 'set' | 'drop' | 'overset' | 'falseSet' | 'open';
  pin: number;
  /** 0..1, used for click loudness. */
  strength: number;
}

export interface SimInput {
  torque: number;
  pickX: number;
  pickY: number;
  /** False when the pick is withdrawn from the keyway. */
  pickIn: boolean;
}

const BODY_NONE = 0;
const BODY_DRIVER = 1;
const BODY_KEY = 2;

const prof = { depth: 0, slope: 0 };

function advance(v: number, fnf: number, n: number, m: number, dt: number): number {
  if (n <= 0) return v + (fnf / m) * dt;
  const capS = MU_STATIC * n;
  const capK = MU_KINETIC * n;
  if (Math.abs(v) < V_STICK) {
    if (Math.abs(fnf) <= capS) return 0;
    return v + ((fnf - Math.sign(fnf) * capK) / m) * dt;
  }
  const nv = v + ((fnf - Math.sign(v) * capK) / m) * dt;
  if (nv * v <= 0 && Math.abs(fnf) <= capS) return 0;
  return nv;
}

export class LockSim {
  readonly spec: LockSpec;
  private readonly geo: LockGeometry;
  private pick: PickSpec;
  readonly n: number;
  /** Key pin tip height. */
  readonly yk: Float64Array;
  readonly vk: Float64Array;
  /** Driver pin bottom height. */
  readonly yd: Float64Array;
  readonly vd: Float64Array;
  /** Pinch force on each chamber at the shear line. */
  readonly normal: Float64Array;
  /** Force the pick is applying to each key pin. */
  readonly pickF: Float64Array;
  private readonly body: Uint8Array;
  private readonly mk: Float64Array;
  private readonly md: Float64Array;
  private readonly lastStatus: PinStatus[];

  theta = 0;
  omega = 0;
  opened = false;
  time = 0;
  inFalseSet = false;

  private lastPickX = 0;
  private lastPickY: number;
  private lastTorque = 0;
  private accumulator = 0;
  private readonly falseSetArc: number;

  constructor(spec: LockSpec) {
    this.spec = spec;
    this.geo = spec.geo;
    this.pick = spec.pick;
    this.lastPickY = spec.pick.minY;
    const n = (this.n = spec.pins.length);
    this.yk = new Float64Array(n);
    this.vk = new Float64Array(n);
    this.yd = new Float64Array(n);
    this.vd = new Float64Array(n);
    this.normal = new Float64Array(n);
    this.pickF = new Float64Array(n);
    this.body = new Uint8Array(n);
    this.mk = new Float64Array(n);
    this.md = new Float64Array(n);
    this.lastStatus = new Array(n).fill('free');
    let maxC = 0;
    for (let i = 0; i < n; i++) {
      const p = spec.pins[i];
      this.mk[i] = PIN_LINEAR_DENSITY * p.keyLen;
      this.md[i] = PIN_LINEAR_DENSITY * p.driverLen;
      maxC = Math.max(maxC, p.clearance);
    }
    this.falseSetArc = maxC + 0.25e-3;
    this.reset();
  }

  reset() {
    for (let i = 0; i < this.n; i++) {
      const p = this.spec.pins[i];
      this.yk[i] = p.floor;
      this.yd[i] = p.floor + p.keyLen;
      this.vk[i] = this.vd[i] = 0;
      this.normal[i] = this.pickF[i] = 0;
      this.lastStatus[i] = 'free';
    }
    this.theta = this.omega = 0;
    this.opened = false;
    this.inFalseSet = false;
    this.accumulator = 0;
    this.lastTorque = 0;
  }

  /**
   * Swap tools without disturbing the lock. The new tool starts at the given
   * position, so the change is not felt as a sudden movement.
   */
  setPick(pick: PickSpec, x: number, y: number) {
    this.pick = this.spec.pick = pick;
    this.lastPickX = x;
    this.lastPickY = y;
  }

  /**
   * Where a hook's tip gets to when the hand moves it from one place to
   * another. A hook lifts a pin only from underneath: if its tip comes
   * sideways into a pin above the cone on the pin's end, it meets the straight
   * side of the pin and stops there. Other tools are not held up.
   */
  blockPick(fromX: number, fromY: number, toX: number, toY: number): number {
    if (this.pick.kind !== 'hook' || toX === fromX) return toX;
    const dir = Math.sign(toX - fromX);
    let stop = toX;
    for (let i = 0; i < this.n; i++) {
      const pin = this.spec.pins[i];
      // The near side of this pin, as the tip approaches it.
      // (A hair clear of it, so that a stopped tip is beside the pin, not under its rim.)
      const edge = pin.x - dir * (pin.tipR + this.pick.tipHalfW + 2e-6);
      if ((edge - fromX) * dir < -1e-9 || (toX - edge) * dir <= 0) continue;
      const y = fromY + ((toY - fromY) * (edge - fromX)) / (toX - fromX);
      if (y > this.yk[i] + pin.tipRise + 2e-5 && (stop - edge) * dir > 0) stop = edge;
    }
    return stop;
  }

  /** Lift each key pin must receive to reach the shear line. */
  setHeight(i: number) {
    const G = this.geo;
    return G.shearY - this.spec.pins[i].keyLen;
  }

  status(i: number): PinStatus {
    const G = this.geo;
    const p = this.spec.pins[i];
    const keyTop = this.yk[i] + p.keyLen;
    const u = keyTop - G.shearY;
    const s = G.shearY - this.yd[i];
    // How far above the shear line the top of the key pin, or of a wafer, is still on its edge break.
    const bevel = p.wafer ? DRIVER_CHAMFER_LEN : KEY_BEVEL_LEN;
    if (u > 2e-5 && this.normal[i] > 0.05 && (this.pickF[i] <= 0 || u >= bevel))
      return 'overset';
    if (p.wafer) {
      // A wafer is set once it is flush to within its edge breaks and the plug
      // has turned on past where the wafer's full width would have stopped it.
      if (s <= DRIVER_CHAMFER_LEN && u <= bevel && G.plugR * this.theta > p.clearance + 3e-6)
        return 'set';
    } else if (s <= DRIVER_CHAMFER + 2e-6 && u <= bevel) {
      const supportedByPlug = this.yd[i] - keyTop > 3e-6 || this.pickF[i] <= 0;
      if (supportedByPlug && G.plugR * this.theta > p.clearance - 1e-6) return 'set';
    }
    if (this.body[i] === BODY_DRIVER && this.normal[i] > 0.05) return 'binding';
    return 'free';
  }

  get totalPickForce() {
    let f = 0;
    for (let i = 0; i < this.n; i++) f += this.pickF[i];
    return f;
  }

  /** Advance the simulation by a rendered frame. Returns events for audio/UI. */
  step(frameDt: number, input: SimInput): SimEvent[] {
    const events: SimEvent[] = [];
    const G = this.geo;
    if (this.opened) return events;

    this.accumulator += Math.min(frameDt, 0.05);
    const steps = Math.min(MAX_SUBSTEPS, Math.floor(this.accumulator / DT));
    this.accumulator -= steps * DT;
    if (this.accumulator > DT) this.accumulator = 0;

    const x0 = this.lastPickX;
    const y0 = this.lastPickY;
    const t0 = this.lastTorque;
    for (let k = 1; k <= steps; k++) {
      // Interpolate the hand so a mouse jump is not an impulse.
      const a = k / steps;
      this.substep(
        t0 + (input.torque - t0) * a,
        x0 + (input.pickX - x0) * a,
        y0 + (input.pickY - y0) * a,
        input.pickIn,
      );
      if (this.opened) break;
    }
    if (steps > 0) {
      this.lastPickX = input.pickX;
      this.lastPickY = input.pickY;
      this.lastTorque = input.torque;
    }
    this.time += steps * DT;

    for (let i = 0; i < this.n; i++) {
      const st = this.status(i);
      const prev = this.lastStatus[i];
      if (st !== prev) {
        const strength = Math.min(1, 0.35 + input.torque / (MAX_TORQUE * 0.5));
        if (st === 'set') events.push({ type: 'set', pin: i, strength });
        else if (prev === 'set' && st !== 'overset')
          events.push({ type: 'drop', pin: i, strength: 0.5 });
        else if (st === 'overset') events.push({ type: 'overset', pin: i, strength: 0.6 });
        this.lastStatus[i] = st;
      }
    }
    // A false set is the plug resting well past any normal set position. The
    // speed check stops the swing through that zone on opening from counting.
    const deep = !this.opened && G.plugR * this.theta > this.falseSetArc;
    if (!deep) this.inFalseSet = false;
    else if (!this.inFalseSet && Math.abs(this.omega) < 0.5) {
      this.inFalseSet = true;
      events.push({ type: 'falseSet', pin: -1, strength: 0.8 });
    }
    if (this.opened) events.push({ type: 'open', pin: -1, strength: 1 });
    return events;
  }

  private substep(torque: number, pickX: number, pickY: number, pickIn: boolean) {
    const G = this.geo;
    const pick = this.pick;
    const S = G.shearY;
    const arc = G.plugR * this.theta;
    const pins = this.spec.pins;
    const cm = this.spec.countermill;
    let sumN = 0;

    for (let i = 0; i < this.n; i++) {
      const p = pins[i];
      const yk = this.yk[i];
      const yd = this.yd[i];
      const vk = this.vk[i];
      const vd = this.vd[i];
      const keyTop = yk + p.keyLen;
      const u = keyTop - S; // > 0: key pin pokes above the shear line
      const s = S - yd; // > 0: driver hangs below the shear line

      // Which body crosses the shear line, and how hard is it pinched?
      let N = 0;
      let axK = 0;
      let axD = 0;
      let body = BODY_NONE;
      if (u > 0) {
        body = BODY_KEY;
        evalProfile(p.keyProfile, u, prof);
        const pen = arc - (p.clearance + prof.depth);
        if (pen > 0) {
          N = K_BIND * pen;
          axK = N * prof.slope;
        }
      } else if (s > 0) {
        body = BODY_DRIVER;
        evalProfile(p.profile, s, prof);
        let depth = prof.depth;
        let slope = prof.slope;
        if (cm && !p.wafer) {
          if (s <= cm.depth) {
            // The driver's end is up in the wider bore: only the bore's rim, at
            // the shear line, can pinch it now, and that is further round.
            depth += cm.width;
          } else {
            // The driver reaches down past the ledge. The plug can turn as far
            // as the ledge allows (onto the edge of a driver resting on it, or
            // into a groove that is level with it), but no further than the rim.
            evalProfile(p.profile, s - cm.depth, prof);
            if (prof.depth > depth) {
              if (prof.depth < depth + cm.width) {
                depth = prof.depth;
                slope = prof.slope;
              } else depth += cm.width;
            }
          }
        }
        const pen = arc - (p.clearance + depth);
        if (pen > 0) {
          N = K_BIND * pen;
          axD = -N * slope;
        }
      }
      this.body[i] = body;
      this.normal[i] = N;
      sumN += N;

      // Pick pushing up on the key pin through the hand's compliance.
      let fp = 0;
      if (pickIn) {
        const h = pickSurfaceY(p, pickX, pickY, pick, this.spec.wrench);
        if (h > yk) {
          fp = pick.handK * (h - yk) - HAND_C * vk;
          if (fp < 0) fp = 0;
          else if (fp > pick.maxForce) fp = pick.maxForce;
        }
      }
      this.pickF[i] = fp;

      const mk = this.mk[i];
      const md = this.md[i];
      const springLen = G.chamberTopY - (yd + p.driverLen);
      const fs = p.springK * Math.max(0, p.springFree - springLen);
      // Only the component of gravity along the pin's axis acts on it.
      const g = GRAVITY * Math.cos(p.angle);
      const fkNf = fp - mk * g - PIN_DAMPING * vk + axK;
      const fdNf = -fs - md * g - PIN_DAMPING * vd + axD;
      const nK = body === BODY_KEY ? N : 0;
      const nD = body === BODY_DRIVER ? N : 0;

      if (p.wafer) {
        // One plate: the pick, the spring and the pinch at either end all act on it.
        let v = advance(vd, fkNf + fdNf, N, mk + md, DT);
        let ny = yd + v * DT;
        // Once the plug has turned past a flush wafer, the housing holds each
        // end: it can neither drop back out of the bottom nor rise out of the top.
        // (A wafer's ends are square but for a small edge break, so this takes
        // hold as soon as the plug has moved on at all.)
        const held = arc > p.clearance + WAFER_HOLD;
        if (held && s <= 0 && S - ny > 0) {
          ny = S;
          if (v < 0) v = 0;
        }
        if (held && u <= 0 && ny - S > 0) {
          ny = S;
          if (v > 0) v = 0;
        }
        const lo = p.floor + p.keyLen;
        const hi = S + G.waferTravel;
        if (ny < lo) {
          ny = lo;
          if (v < 0) v = 0;
        } else if (ny > hi) {
          ny = hi;
          if (v > 0) v = 0;
        }
        this.yd[i] = ny;
        this.yk[i] = ny - p.keyLen;
        this.vk[i] = this.vd[i] = v;
        continue;
      }

      let nvk = advance(vk, fkNf, nK, mk, DT);
      let nvd = advance(vd, fdNf, nD, md, DT);
      const touching = yd - keyTop <= 1e-7;
      if (touching && nvk > nvd) {
        // The key pin is pushing the driver: they move as one stack.
        const M = mk + md;
        const v = (mk * vk + md * vd) / M;
        nvk = nvd = advance(v, fkNf + fdNf, N, M, DT);
      }

      let nyk = yk + nvk * DT;
      let nyd = yd + nvd * DT;

      // A driver sitting above the shear line cannot drop back into a plug
      // hole that has rotated out from under it (this is a "set" pin).
      if (s <= 0 && S - nyd > 0 && arc > p.clearance + DRIVER_CHAMFER) {
        nyd = S;
        if (nvd < 0) nvd = 0;
      }
      // In a countermilled core the same goes for a driver whose end is in
      // the wider bore: it lands on the ledge below it.
      const onLedge = !!cm && s > 0 && s <= cm.depth && arc > p.clearance + DRIVER_CHAMFER;
      if (onLedge && nyd < S - cm!.depth) {
        nyd = S - cm!.depth;
        if (nvd < 0) nvd = 0;
      }
      // Likewise a key pin cannot rise into a misaligned housing hole.
      if (u <= 0 && nyk + p.keyLen - S > 0 && arc > p.clearance + KEY_BEVEL) {
        nyk = S - p.keyLen;
        if (nvk > 0) nvk = 0;
      }
      if (nyk < p.floor) {
        nyk = p.floor;
        if (nvk < 0) nvk = 0;
      }
      const maxYd = G.chamberTopY - G.springSolid - p.driverLen;
      if (nyd > maxYd) {
        nyd = maxYd;
        if (nvd > 0) nvd = 0;
      }
      // Key pin and driver cannot overlap: inelastic contact.
      const overlap = nyk + p.keyLen - nyd;
      if (overlap > 0) {
        const M = mk + md;
        const v = (mk * nvk + md * nvd) / M;
        if (
          (nyd <= S && s <= 0 && arc > p.clearance + DRIVER_CHAMFER) ||
          (onLedge && nyd <= S - cm!.depth)
        ) {
          // Driver is held by the plug ledge; the key pin yields.
          nyk -= overlap;
        } else if (nyk <= p.floor) {
          nyd += overlap;
        } else {
          nyk -= (overlap * md) / M;
          nyd += (overlap * mk) / M;
        }
        nvk = nvd = v;
      }

      this.yk[i] = nyk;
      this.yd[i] = nyd;
      this.vk[i] = nvk;
      this.vd[i] = nvd;
    }

    // Plug: wrench torque against the pinch forces.
    const alpha = (torque - G.plugR * sumN - PLUG_DAMPING * this.omega) / PLUG_INERTIA;
    this.omega += alpha * DT;
    this.theta += this.omega * DT;
    if (this.theta < 0) {
      this.theta = 0;
      if (this.omega < 0) this.omega = 0;
    }
    if (this.theta > OPEN_ANGLE) this.opened = true;
  }
}
