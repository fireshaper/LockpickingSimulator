import { describe, expect, it } from 'vitest';
import {
  DEEP_HOOK_PICK,
  DIAMOND_PICK,
  DRIVER_LEN,
  DRIVER_TYPES,
  GEO,
  KEY_TOP_PROFILE,
  PRESETS,
  RAKE_PICK,
  RAKE_T,
  SHAFT_T,
  SNAKE_PICK,
  bokWrench,
  customPreset,
  driverProfile,
  generateLock,
  isTrapDriver,
  pickMinY,
  pinX,
  shaftPivotY,
} from '../src/sim/lock';
import { LockSim, PICK, type SimInput } from '../src/sim/physics';

const FRAME = 1 / 120;

function run(sim: LockSim, seconds: number, input: SimInput) {
  for (let t = 0; t < seconds && !sim.opened; t += FRAME) sim.step(FRAME, input);
}

/** Single-pin-pick the lock the way a person would: find the binder, lift until it sets. */
function autoPick(sim: LockSim, torque: number, maxSeconds = 60, overshoot = 0, through = false) {
  const pk = sim.spec.pick;
  const input: SimInput = { torque, pickX: pk.minX, pickY: pk.minY, pickIn: true };
  run(sim, 0.2, input);
  const log: string[] = [];
  while (!sim.opened && sim.time < maxSeconds) {
    let target = -1;
    let best = 0.05;
    for (let i = 0; i < sim.n; i++) {
      if (sim.status(i) === 'binding' && sim.normal[i] > best) {
        best = sim.normal[i];
        target = i;
      }
    }
    if (target < 0) {
      // Nothing binding yet not open: set drivers resting on their edges are
      // holding the plug back. Do what a picker would and add a little tension.
      if (!sim.inFalseSet && input.torque < 0.03) {
        input.torque += 0.003;
        run(sim, 0.2, input);
        continue;
      }
      log.push(`no binder at t=${sim.time.toFixed(2)} [${statuses(sim)}]`);
      break;
    }
    input.pickX = sim.spec.pins[target].x + sim.spec.pins[target].pickOffset;
    input.pickY = pk.minY;
    run(sim, 0.05, input);
    // `through`: keep lifting through the clicks of a serrated driver, which
    // read as free for a moment, until the driver has cleared the shear line.
    const lifting = () => {
      const st = sim.status(target);
      if (!through) return st === 'binding';
      // Stop the moment the driver's bottom face clears the shear line.
      return st !== 'set' && st !== 'overset' && sim.yd[target] < sim.spec.geo.shearY;
    };
    while (!sim.opened && lifting() && input.pickY < pk.maxY) {
      input.pickY += 4e-3 * FRAME; // 4 mm/s lift
      sim.step(FRAME, input);
    }
    // A person cannot stop the instant a pin sets: keep pushing a little.
    for (let o = 0; o < overshoot && !sim.opened; o += 6e-3 * FRAME) {
      input.pickY += 6e-3 * FRAME;
      sim.step(FRAME, input);
    }
    // Ease the pick back down at hand speed rather than teleporting it.
    while (input.pickY > pk.minY && !sim.opened) {
      input.pickY -= 20e-3 * FRAME;
      sim.step(FRAME, input);
    }
    run(sim, 0.1, input);
    log.push(`pin ${target} -> ${sim.opened ? 'OPEN' : sim.status(target)}`);
    run(sim, 0.1, input);
  }
  return log;
}

const statuses = (sim: LockSim) =>
  Array.from({ length: sim.n }, (_, i) => sim.status(i)).join(',');

describe('pin tumbler physics', () => {
  it('does not open without picking, at any tension', () => {
    for (const torque of [0, 0.01, 0.05, 0.1]) {
      const sim = new LockSim(generateLock(PRESETS[2], 7));
      run(sim, 0.5, { torque, pickX: 0, pickY: PICK.minY, pickIn: false });
      expect(sim.opened).toBe(false);
      expect(sim.theta).toBeLessThan(0.03);
    }
  });

  it('binds exactly the lowest-clearance pin under light tension', () => {
    const spec = generateLock(PRESETS[2], 11);
    const sim = new LockSim(spec);
    run(sim, 0.3, { torque: 0.012, pickX: 0, pickY: PICK.minY, pickIn: false });
    const expected = spec.pins
      .map((p, i) => [p.clearance, i])
      .sort((a, b) => a[0] - b[0])[0][1];
    const binding = [...Array(sim.n).keys()].filter((i) => sim.status(i) === 'binding');
    expect(binding).toEqual([expected]);
  });

  it('a free pin springs back; pins drop when tension is released', () => {
    const spec = generateLock(PRESETS[2], 11);
    const sim = new LockSim(spec);
    const order = spec.pins.map((p, i) => [p.clearance, i]).sort((a, b) => a[0] - b[0]);
    const binder = order[0][1];
    const loose = order[order.length - 1][1];
    const input: SimInput = { torque: 0.012, pickX: pinX(loose), pickY: PICK.minY, pickIn: true };
    run(sim, 0.2, input);
    // Lift a non-binding pin to its shear height and let go: it must fall back.
    input.pickY = sim.setHeight(loose);
    run(sim, 0.3, input);
    input.pickY = PICK.minY;
    run(sim, 0.3, input);
    expect(sim.status(loose)).toBe('free');
    expect(sim.yd[loose]).toBeLessThan(GEO.shearY - 1e-4);
    // Set the binder, then release tension: it must drop.
    input.pickX = pinX(binder);
    while (sim.status(binder) === 'binding' && input.pickY < PICK.maxY) {
      input.pickY += 4e-3 * FRAME;
      sim.step(FRAME, input);
    }
    input.pickY = PICK.minY;
    run(sim, 0.2, input);
    expect(sim.status(binder)).toBe('set');
    input.torque = 0;
    run(sim, 0.5, input);
    expect(sim.status(binder)).toBe('free');
    expect(sim.yd[binder]).toBeLessThan(GEO.shearY - 1e-4);
  });

  it('standard locks open by single-pin picking in binding order', () => {
    for (const preset of PRESETS.slice(0, 3)) {
      for (const seed of [1, 2, 3, 4, 5]) {
        const sim = new LockSim(generateLock(preset, seed));
        const log = autoPick(sim, 0.012);
        expect(sim.opened, `${preset.id} seed ${seed}: ${log.join(' | ')}`).toBe(true);
      }
    }
  });

  it('light tension forgives sloppy lifting', () => {
    let opened = 0;
    for (const seed of [1, 2, 3, 4, 5]) {
      const sim = new LockSim(generateLock(PRESETS[2], seed));
      autoPick(sim, 0.01, 30, 0.6e-3);
      if (sim.opened) opened++;
    }
    expect(opened).toBeGreaterThanOrEqual(4);
  });

  it('heavy tension binds several pins at once and needs far more pick force', () => {
    const count = (seed: number, torque: number) => {
      const sim = new LockSim(generateLock(PRESETS[4], seed));
      run(sim, 0.3, { torque, pickX: 0, pickY: PICK.minY, pickIn: false });
      return [...Array(sim.n).keys()].filter((i) => sim.status(i) === 'binding').length;
    };
    const seeds = [1, 2, 3, 4, 5, 6];
    expect(seeds.every((s) => count(s, 0.008) === 1)).toBe(true);
    expect(seeds.some((s) => count(s, 0.09) > 1)).toBe(true);

    const breakaway = (torque: number) => {
      const sim = new LockSim(generateLock(PRESETS[2], 1));
      const input: SimInput = { torque, pickX: PICK.minX, pickY: PICK.minY, pickIn: true };
      run(sim, 0.2, input);
      const binder = [...Array(sim.n).keys()].find((i) => sim.status(i) === 'binding')!;
      input.pickX = pinX(binder);
      const y0 = sim.yk[binder];
      let peak = 0;
      while (sim.yk[binder] - y0 < 0.2e-3 && input.pickY < PICK.maxY) {
        input.pickY += 4e-3 * FRAME;
        sim.step(FRAME, input);
        peak = Math.max(peak, sim.pickF[binder]);
      }
      return peak;
    };
    expect(breakaway(0.07)).toBeGreaterThan(3 * breakaway(0.01));
  });

  it('shoving a binding pin far past the shear line oversets it until tension is released', () => {
    const sim = new LockSim(generateLock(PRESETS[2], 1));
    const input: SimInput = { torque: 0.03, pickX: PICK.minX, pickY: PICK.minY, pickIn: true };
    run(sim, 0.2, input);
    const binder = [...Array(sim.n).keys()].find((i) => sim.status(i) === 'binding')!;
    input.pickX = pinX(binder);
    // setHeight is the tip height that puts the key pin top on the shear line.
    input.pickY = sim.setHeight(binder) + 1.6e-3;
    run(sim, 0.3, input);
    input.pickY = PICK.minY;
    run(sim, 0.3, input);
    expect(sim.status(binder)).toBe('overset');
    expect(sim.opened).toBe(false);
    input.torque = 0;
    run(sim, 0.4, input);
    expect(sim.status(binder)).toBe('free');
    expect(sim.yk[binder]).toBeCloseTo(GEO.floorY, 5);
  });

  it('spool pins produce a false set that naive picking cannot get past', () => {
    let falseSets = 0;
    for (const seed of [1, 2, 3, 4]) {
      const sim = new LockSim(generateLock(PRESETS[3], seed));
      const input: SimInput = { torque: 0.012, pickX: PICK.minX, pickY: PICK.minY, pickIn: true };
      run(sim, 0.2, input);
      let sawFalseSet = false;
      for (let round = 0; round < 12 && !sim.opened; round++) {
        let target = -1;
        for (let i = 0; i < sim.n; i++) if (sim.status(i) === 'binding') target = i;
        if (target < 0) break;
        input.pickX = pinX(target);
        input.pickY = PICK.minY;
        run(sim, 0.05, input);
        while (!sim.opened && sim.status(target) === 'binding' && input.pickY < PICK.maxY) {
          input.pickY += 4e-3 * FRAME;
          for (const e of sim.step(FRAME, input)) if (e.type === 'falseSet') sawFalseSet = true;
        }
        input.pickY = PICK.minY;
        run(sim, 0.1, input);
        if (sim.inFalseSet) sawFalseSet = true;
      }
      if (sawFalseSet) falseSets++;
    }
    expect(falseSets).toBeGreaterThan(0);
  });

  it('at light tension a serrated key pin hangs up overset where a plain one slides back', () => {
    // Make one key pin the first binder, lift it until its top groove is at
    // the shear line, then ease the pick away at hand speed.
    const settle = (serrated: boolean) => {
      const spec = generateLock(PRESETS[5], 3);
      const i = spec.pins.findIndex((p) => p.keyPin === 'serrated');
      expect(i).toBeGreaterThanOrEqual(0);
      const pin = spec.pins[i];
      pin.clearance = Math.min(...spec.pins.map((p) => p.clearance)) - 0.01e-3;
      if (!serrated) pin.keyProfile = KEY_TOP_PROFILE;
      const sim = new LockSim(spec);
      const input: SimInput = { torque: 0.012, pickX: pin.x, pickY: PICK.minY, pickIn: true };
      run(sim, 0.2, input);
      while (input.pickY < PICK.maxY && sim.yk[i] + pin.keyLen - GEO.shearY < 0.38e-3) {
        input.pickY += 4e-3 * FRAME;
        sim.step(FRAME, input);
      }
      while (input.pickY > PICK.minY) {
        input.pickY -= 20e-3 * FRAME;
        sim.step(FRAME, input);
      }
      run(sim, 0.4, input);
      return { sim, i, input };
    };
    const plain = settle(false);
    expect(plain.sim.status(plain.i)).not.toBe('overset');
    const serr = settle(true);
    expect(serr.sim.status(serr.i)).toBe('overset');
    serr.input.torque = 0;
    run(serr.sim, 0.5, serr.input);
    expect(serr.sim.status(serr.i)).toBe('free');
  });

  it('the serrated lock opens under very light tension; firmer tension jams a key pin', () => {
    let jammed = 0;
    // With the grooves right at the top of the key pin, the small jump a pin
    // makes as its serrated driver clears the shear line is enough to catch
    // one, unless tension is light enough for the spring to push it back.
    for (const seed of [2, 4, 5]) {
      const spec = generateLock(PRESETS[5], seed);
      expect(spec.pins.filter((p) => p.keyPin === 'serrated')).toHaveLength(3);
      const sim = new LockSim(spec);
      const log = autoPick(sim, 0.007, 60, 0, true);
      expect(sim.opened, `seed ${seed}: ${log.join(' | ')}`).toBe(true);
      const firm = new LockSim(spec);
      autoPick(firm, 0.012, 60, 0, true);
      if (!firm.opened && statuses(firm).includes('overset')) jammed++;
    }
    expect(jammed).toBeGreaterThan(0);
  });

  it('the single-row dimple lock has no side pins and opens by picking the top row', () => {
    for (const seed of [1, 2, 3]) {
      const spec = generateLock(PRESETS[6], seed);
      expect(spec.kind).toBe('dimple');
      expect(spec.pins.length).toBe(5);
      expect(spec.pins.every((p) => p.row === 'top')).toBe(true);
      const sim = new LockSim(spec);
      const log = autoPick(sim, 0.012);
      expect(sim.opened, `single-row dimple seed ${seed}: ${log.join(' | ')}`).toBe(true);
    }
  });

  it('dimple locks pick the same way, with short pin travel', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const spec = generateLock(PRESETS[7], seed);
      expect(spec.kind).toBe('dimple');
      const sim = new LockSim(spec);
      // Every pin sets within the flag pick's reach, and travel is under 2 mm.
      for (let i = 0; i < sim.n; i++) {
        const lift = sim.setHeight(i) - spec.pins[i].floor;
        expect(lift).toBeGreaterThan(0.3e-3);
        expect(lift).toBeLessThan(2e-3);
        expect(sim.setHeight(i)).toBeLessThan(spec.pick.flagLen - 0.3e-3);
      }
      expect(spec.pins.filter((p) => p.row === 'side').length).toBe(3);
      const log = autoPick(sim, 0.012);
      expect(sim.opened, `dimple5 seed ${seed}: ${log.join(' | ')}`).toBe(true);
      // Both rows had to be picked to get there.
      expect(log.length).toBeGreaterThanOrEqual(spec.pins.length);
    }
  });

  it('a flat flag pick touches nothing, and dimple spools still false set', () => {
    const spec = generateLock(PRESETS[8], 2);
    const sim = new LockSim(spec);
    const pk = spec.pick;
    const input: SimInput = { torque: 0, pickX: pinX(2), pickY: pk.minY, pickIn: true };
    run(sim, 0.2, input);
    expect(sim.totalPickForce).toBe(0);

    let falseSets = 0;
    for (const seed of [1, 2, 3, 4]) {
      const s = new LockSim(generateLock(PRESETS[8], seed));
      autoPick(s, 0.012, 20);
      if (s.inFalseSet) falseSets++;
    }
    expect(falseSets).toBeGreaterThan(0);
  });

  it('side pins are reached only by twisting the flag past upright', () => {
    const spec = generateLock(PRESETS[7], 3);
    const pk = spec.pick;
    const side = spec.pins.findIndex((p) => p.row === 'side');
    const upright = pk.shaftY + pk.flagLen;
    const sim = new LockSim(spec);
    const input: SimInput = { torque: 0, pickX: spec.pins[side].x, pickY: upright, pickIn: true };
    // Upright, between two top pins: the flag touches nothing at all.
    run(sim, 0.3, input);
    expect(sim.totalPickForce).toBe(0);
    for (let i = 0; i < sim.n; i++) expect(sim.yk[i]).toBeCloseTo(spec.pins[i].floor, 6);
    // Laid over toward the side row: that pin, and only that pin, is pushed out.
    input.pickY = pk.maxY;
    run(sim, 0.3, input);
    for (let i = 0; i < sim.n; i++) {
      if (i === side) expect(sim.yk[i]).toBeGreaterThan(spec.pins[i].floor + 0.5e-3);
      else expect(sim.yk[i]).toBeCloseTo(spec.pins[i].floor, 6);
    }
  });

  it('telescoping chambers: tip position chooses the inner or the outer pin', () => {
    const spec = generateLock(PRESETS[9], 2);
    expect(spec.pins.length).toBe(10);
    const outer = spec.pins.findIndex((p) => p.part === 'outer' && p.chamber === 3);
    const inner = spec.pins.findIndex((p) => p.part === 'inner' && p.chamber === 3);
    const pk = spec.pick;
    const high = pk.shaftY + pk.flagLen * 0.8;

    // Centred under the chamber: the tip goes up the bore and lifts only the inner pin.
    let sim = new LockSim(spec);
    let input: SimInput = { torque: 0, pickX: spec.pins[inner].x, pickY: high, pickIn: true };
    run(sim, 0.3, input);
    expect(sim.yk[inner]).toBeGreaterThan(spec.pins[inner].floor + 0.5e-3);
    expect(sim.yk[outer]).toBeCloseTo(spec.pins[outer].floor, 6);

    // Off-centre: it catches the rim and lifts only the outer pin.
    sim = new LockSim(spec);
    input = { torque: 0, pickX: spec.pins[outer].x + spec.pins[outer].pickOffset, pickY: high, pickIn: true };
    run(sim, 0.3, input);
    expect(sim.yk[outer]).toBeGreaterThan(spec.pins[outer].floor + 0.5e-3);
    expect(sim.yk[inner]).toBeCloseTo(spec.pins[inner].floor, 6);
    // ...and nothing in the neighbouring chambers moves either way.
    for (let i = 0; i < sim.n; i++) {
      if (spec.pins[i].chamber !== 3) expect(sim.yk[i]).toBeCloseTo(spec.pins[i].floor, 6);
    }
  });

  it('a telescoping lock opens only once both pins in every chamber are set', () => {
    for (const seed of [1, 2, 3]) {
      const spec = generateLock(PRESETS[9], seed);
      const sim = new LockSim(spec);
      const log = autoPick(sim, 0.012);
      expect(sim.opened, `telescoping seed ${seed}: ${log.join(' | ')}`).toBe(true);
      expect(log.length).toBeGreaterThanOrEqual(10);
    }
    // Setting every outer pin alone is not enough.
    const spec = generateLock(PRESETS[9], 1);
    const sim = new LockSim(spec);
    const pk = spec.pick;
    const input: SimInput = { torque: 0.012, pickX: pk.minX, pickY: pk.minY, pickIn: true };
    run(sim, 0.2, input);
    for (let round = 0; round < 12; round++) {
      const b = [...Array(sim.n).keys()].find(
        (i) => sim.status(i) === 'binding' && spec.pins[i].part === 'outer',
      );
      if (b === undefined) break;
      input.pickX = spec.pins[b].x + spec.pins[b].pickOffset;
      while (sim.status(b) === 'binding' && input.pickY < pk.maxY) {
        input.pickY += 4e-3 * FRAME;
        sim.step(FRAME, input);
      }
      while (input.pickY > pk.minY) {
        input.pickY -= 20e-3 * FRAME;
        sim.step(FRAME, input);
      }
      run(sim, 0.2, input);
    }
    expect(sim.opened).toBe(false);
    expect(spec.pins.some((p, i) => p.part === 'inner' && sim.status(i) === 'binding')).toBe(true);
  });

  it('the combined lock has telescoping chambers, a side row and spools, and false sets', () => {
    let falseSets = 0;
    for (const seed of [1, 2, 3, 4]) {
      const spec = generateLock(PRESETS[10], seed);
      expect(spec.pins.length).toBe(13);
      expect(spec.pins.filter((p) => p.part === 'inner').length).toBe(5);
      expect(spec.pins.filter((p) => p.row === 'side').length).toBe(3);
      const spools = spec.pins.filter((p) => p.driver === 'spool');
      expect(spools.length).toBe(2);
      expect(spools.every((p) => p.part !== 'inner')).toBe(true);

      const sim = new LockSim(spec);
      autoPick(sim, 0.012, 30);
      for (let i = 0; i < sim.n; i++) expect(Number.isFinite(sim.yk[i])).toBe(true);
      // Lifting binders in order either opens it or runs into a spool.
      expect(sim.opened || sim.inFalseSet || sim.time >= 30).toBe(true);
      if (sim.inFalseSet) falseSets++;
    }
    expect(falseSets).toBeGreaterThan(0);
  });
});

/** Rake the way a person would: scrub in and out while slowly raising and lowering. */
function rake(sim: LockSim, torque: number, seconds: number, pk = RAKE_PICK) {
  const pins = sim.spec.pins;
  const back = pins[0].x - 1e-3;
  const front = pins[pins.length - 1].x + 1e-3;
  sim.setPick(pk, pk.minX, pk.minY);
  const input: SimInput = { torque, pickX: pk.minX, pickY: pk.minY, pickIn: true };
  for (let t = 0; t < seconds && !sim.opened; t += FRAME) {
    input.pickX = back + ((front - back) * (1 - Math.cos(2 * Math.PI * 2.5 * t))) / 2;
    input.pickY = -1.4e-3 + (4.6e-3 * (1 - Math.cos(2 * Math.PI * 0.35 * t))) / 2;
    sim.step(FRAME, input);
  }
}

describe('raking', () => {
  it('opens the trainers at moderate tension', () => {
    for (const idx of [0, 1]) {
      for (const seed of [1, 2, 3, 4]) {
        const sim = new LockSim(generateLock(PRESETS[idx], seed));
        rake(sim, 0.012, 10);
        expect(sim.opened, `${PRESETS[idx].id} seed ${seed}`).toBe(true);
      }
    }
  });

  it('cannot lift the binding pin under heavy tension', () => {
    for (const seed of [1, 2, 3]) {
      const sim = new LockSim(generateLock(PRESETS[1], seed));
      rake(sim, 0.03, 8);
      expect(sim.opened).toBe(false);
    }
  });

  it('does not open spools or serrated pins, and false-sets a spool lock', () => {
    let falseSets = 0;
    for (const idx of [3, 4, 5]) {
      for (const seed of [1, 2, 3]) {
        const sim = new LockSim(generateLock(PRESETS[idx], seed));
        rake(sim, 0.012, 10);
        expect(sim.opened, `${PRESETS[idx].id} seed ${seed}`).toBe(false);
        if (idx === 3 && sim.inFalseSet) falseSets++;
      }
    }
    expect(falseSets).toBeGreaterThan(0);
  });

  it('leaves raked pins set when the hook takes over', () => {
    const sim = new LockSim(generateLock(PRESETS[2], 1));
    rake(sim, 0.012, 3);
    const input: SimInput = { torque: 0.012, pickX: RAKE_PICK.minX, pickY: RAKE_PICK.minY, pickIn: true };
    run(sim, 0.3, input);
    const before = statuses(sim);
    sim.setPick(PICK, PICK.minX, PICK.minY);
    run(sim, 0.3, input);
    expect(statuses(sim)).toBe(before);
  });
});

describe('other picks', () => {
  it('the deep hook and the half-diamond single-pin pick a lock', () => {
    for (const pk of [DEEP_HOOK_PICK, DIAMOND_PICK]) {
      // The half-diamond's shallow tip is only asked to do the trainer.
      for (const idx of pk === DIAMOND_PICK ? [1] : [1, 2]) {
        for (const seed of [1, 2, 3]) {
          const spec = generateLock(PRESETS[idx], seed);
          spec.pick = pk;
          const sim = new LockSim(spec);
          const log = autoPick(sim, 0.006);
          expect(sim.opened, `${pk.name} ${PRESETS[idx].id} seed ${seed}: ${log.join('; ')}`).toBe(true);
        }
      }
    }
  });

  it('the deep hook lifts the pin in front far less than the short hook', () => {
    const lift = (pk: typeof PICK) => {
      const spec = generateLock(PRESETS[2], 1);
      spec.pick = pk;
      const sim = new LockSim(spec);
      const input: SimInput = { torque: 0, pickX: spec.pins[4].x, pickY: 3.0e-3, pickIn: true };
      run(sim, 0.3, input);
      return sim.yk[3] - spec.pins[3].floor;
    };
    expect(lift(PICK)).toBeGreaterThan(1e-3);
    expect(lift(DEEP_HOOK_PICK)).toBeLessThan(lift(PICK) / 2);
  });

  it('the snake rake opens the trainers', () => {
    let opened = 0;
    for (const idx of [0, 1]) {
      for (const seed of [1, 2, 3, 4]) {
        const sim = new LockSim(generateLock(PRESETS[idx], seed));
        rake(sim, 0.012, 12, SNAKE_PICK);
        if (sim.opened) opened++;
      }
    }
    expect(opened).toBeGreaterThanOrEqual(6);
  });
});

describe('bottom-of-keyway wrench', () => {
  const w = bokWrench(GEO);

  it('no pick can be put through it, wherever its tip is', () => {
    for (const pk of [PICK, DEEP_HOOK_PICK, DIAMOND_PICK, RAKE_PICK, SNAKE_PICK]) {
      for (let tipX = pk.minX; tipX < 24e-3; tipX += 0.1e-3) {
        const u = pickMinY(pk, tipX, GEO, w);
        // Lowest point of the tool at each place along the wrench.
        for (let x = w.front; x <= w.reach; x += 0.1e-3) {
          let bottom = Infinity;
          if (pk.kind === 'rake') {
            if (x <= tipX + pk.tipReach) bottom = u - pk.rakeAmp - RAKE_T;
          } else {
            const baseX = tipX - pk.shaftBack;
            const baseY = u - pk.hookH;
            const nose = tipX + (pk.kind === 'diamond' ? pk.tipFront + 0.3e-3 : 0.6e-3);
            if (x >= baseX && x <= nose) bottom = baseY - SHAFT_T;
            else if (x < baseX) {
              const pivotY = shaftPivotY(pk, baseX, baseY, w);
              const t = (x - pk.pivotX) / (baseX - pk.pivotX);
              bottom = pivotY + (baseY - pivotY) * t - SHAFT_T;
            }
          }
          expect(bottom, `${pk.name} tip at ${(tipX * 1e3).toFixed(1)} mm`).toBeGreaterThan(w.top - 1e-6);
        }
      }
    }
  });

  it('makes every pick climb over it on the way in', () => {
    for (const pk of [PICK, DEEP_HOOK_PICK, DIAMOND_PICK]) {
      expect(pickMinY(pk, 1e-3, GEO, w)).toBeGreaterThan(pickMinY(pk, 1e-3, GEO, null) + 0.8e-3);
      // Well past it there is no limit but the keyway floor.
      expect(pickMinY(pk, pinX(2), GEO, w)).toBe(pickMinY(pk, pinX(2), GEO, null));
    }
  });

  it('the short hook still picks a lock over it', () => {
    for (const seed of [1, 2, 3]) {
      const spec = generateLock(PRESETS[2], seed);
      spec.wrench = w;
      const sim = new LockSim(spec);
      // Hold the pick off the wrench the way the app does.
      const step = sim.step.bind(sim);
      sim.step = (dt, input) =>
        step(dt, { ...input, pickY: Math.max(input.pickY, pickMinY(spec.pick, input.pickX, GEO, w)) });
      autoPick(sim, 0.006);
      expect(sim.opened, `seed ${seed}`).toBe(true);
    }
  });
});

describe('keyway floor', () => {
  it('no pick can be put through it', () => {
    for (const pk of [PICK, DEEP_HOOK_PICK, DIAMOND_PICK, RAKE_PICK, SNAKE_PICK]) {
      for (let tipX = 0; tipX < 24e-3; tipX += 0.5e-3) {
        const u = pickMinY(pk, tipX, GEO, null);
        const bottom = pk.kind === 'rake' ? u - pk.rakeAmp - RAKE_T : u - pk.hookH - SHAFT_T;
        expect(bottom, pk.name).toBeGreaterThan(GEO.keywayBottomY - 1e-9);
      }
    }
  });

  it('lets the short hook under the resting pins but not the deep hook', () => {
    expect(pickMinY(PICK, pinX(2), GEO, null)).toBeLessThan(GEO.floorY - 0.2e-3);
    const deep = pickMinY(DEEP_HOOK_PICK, pinX(2), GEO, null);
    expect(deep).toBeGreaterThan(GEO.floorY + 0.3e-3);
    // Still below the set height of the deepest cut, so every pin can be set.
    expect(deep).toBeLessThan(GEO.shearY - (GEO.keyLenBase + 9 * GEO.keyLenStep) - 0.2e-3);
  });

  it('the deep hook picks a lock while resting on it', () => {
    for (const seed of [1, 2, 3]) {
      const spec = generateLock(PRESETS[2], seed);
      spec.pick = DEEP_HOOK_PICK;
      const sim = new LockSim(spec);
      const step = sim.step.bind(sim);
      sim.step = (dt, input) =>
        step(dt, { ...input, pickY: Math.max(input.pickY, pickMinY(spec.pick, input.pickX, GEO, null)) });
      autoPick(sim, 0.006);
      expect(sim.opened, `seed ${seed}`).toBe(true);
    }
  });
});

describe('levering', () => {
  it('rests the shaft on the keyway floor at the face, so a high lift at the back leaves pin 1 alone', () => {
    const spec = generateLock(PRESETS[2], 1);
    const sim = new LockSim(spec);
    const input: SimInput = { torque: 0, pickX: spec.pins[4].x, pickY: 2.2e-3, pickIn: true };
    run(sim, 0.3, input);
    expect(sim.yk[4]).toBeGreaterThan(2e-3);
    expect(sim.yk[0] - spec.pins[0].floor).toBeLessThan(1e-6);
    // The shaft passes the face no lower than the floor allows.
    const baseX = input.pickX - PICK.shaftBack;
    const baseY = input.pickY - PICK.hookH;
    const pivotY = shaftPivotY(PICK, baseX, baseY, null);
    const atFace = pivotY + ((baseY - pivotY) * (0 - PICK.pivotX)) / (baseX - PICK.pivotX);
    expect(atFace - SHAFT_T).toBeGreaterThan(GEO.keywayBottomY - 1e-9);
  });
});

describe('hooks lift only from below', () => {
  const make = () => new LockSim(generateLock(PRESETS[2], 1));

  it('a hook raised between two pins is stopped by the side of each', () => {
    const sim = make();
    const pins = sim.spec.pins;
    const gap = (pins[1].x + pins[2].x) / 2;
    const y = 0.5e-3; // well above the resting pins' cones
    expect(sim.blockPick(gap, y, pins[2].x, y)).toBeCloseTo(pins[2].x - GEO.pinR - PICK.tipHalfW, 5);
    expect(sim.blockPick(gap, y, pins[1].x, y)).toBeCloseTo(pins[1].x + GEO.pinR + PICK.tipHalfW, 5);
    // Held there, the tip lifts neither pin. (The shaft passes under the pin
    // behind and may brush it, but that is all.)
    run(sim, 0.3, { torque: 0, pickX: gap, pickY: y, pickIn: true });
    expect(sim.yk[2]).toBeCloseTo(pins[2].floor, 6);
    expect(sim.yk[1] - pins[1].floor).toBeLessThan(0.2e-3);
    // Nor does it when pressed against the side of the pin ahead.
    const stopped = sim.blockPick(gap, y, pins[2].x, y);
    run(sim, 0.3, { torque: 0, pickX: stopped, pickY: y, pickIn: true });
    expect(sim.yk[2]).toBeCloseTo(pins[2].floor, 6);
  });

  it('a hook below the pins slides under them freely and lifts from the centre', () => {
    const sim = make();
    const pins = sim.spec.pins;
    expect(sim.blockPick(PICK.minX, PICK.minY, pins[4].x, PICK.minY)).toBe(pins[4].x);
    run(sim, 0.3, { torque: 0, pickX: pins[2].x, pickY: 0.5e-3, pickIn: true });
    expect(sim.yk[2]).toBeGreaterThan(pins[2].floor + 2e-3);
  });

  it('sliding a hook sideways under a pin lifts it no more than its cone', () => {
    const sim = make();
    const pins = sim.spec.pins;
    // Just under the top of the cone: allowed in, and the pin rides up the cone only.
    const y = pins[2].floor + 0.9e-3;
    const from = (pins[1].x + pins[2].x) / 2;
    expect(sim.blockPick(from, y, pins[2].x - 1e-3, y)).toBe(pins[2].x - 1e-3);
    run(sim, 0.3, { torque: 0, pickX: pins[2].x - 1e-3, pickY: y, pickIn: true });
    expect(sim.yk[2] - pins[2].floor).toBeLessThan(0.5e-3);
  });

  it('rakes and the half-diamond are not stopped', () => {
    for (const pk of [RAKE_PICK, DIAMOND_PICK]) {
      const sim = make();
      sim.setPick(pk, pk.minX, pk.minY);
      const pins = sim.spec.pins;
      expect(sim.blockPick(pins[1].x + 2e-3, 0.5e-3, pins[2].x, 0.5e-3)).toBe(pins[2].x);
    }
  });
});

describe('built locks', () => {
  it('has exactly the pins chosen for each stack', () => {
    const stacks = [
      { key: 'standard', driver: 'spool' },
      { key: 'serrated', driver: 'standard' },
      { key: 'standard', driver: 'serrated' },
      { key: 'serrated', driver: 'spool' },
    ] as const;
    for (const seed of [1, 2, 3]) {
      const spec = generateLock(customPreset(stacks.map((q) => ({ ...q }))), seed);
      expect(spec.pins.map((p) => p.driver)).toEqual(stacks.map((q) => q.driver));
      expect(spec.pins.map((p) => p.keyPin)).toEqual(stacks.map((q) => q.key));
    }
  });

  it('uses the key pin lengths chosen, and leaves the rest random', () => {
    const lengths = [1, 9, undefined, 5];
    const stacks = lengths.map((length) => ({ key: 'standard' as const, driver: 'standard' as const, length }));
    const seen = new Set<number>();
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const spec = generateLock(customPreset(stacks.map((q) => ({ ...q }))), seed);
      for (const i of [0, 1, 3]) {
        expect(spec.pins[i].keyLen).toBeCloseTo(GEO.keyLenBase + GEO.keyLenStep * (lengths[i]! - 1), 9);
      }
      seen.add(spec.pins[2].bitting);
    }
    expect(seen.size).toBeGreaterThan(1);
    // A longer key pin needs less lift to set.
    const sim = new LockSim(generateLock(customPreset(stacks.map((q) => ({ ...q }))), 1));
    expect(sim.setHeight(1)).toBeLessThan(sim.setHeight(0) - 3e-3);
  });

  it('opens with the lengths chosen', () => {
    const stacks = [3, 6, 2, 7, 4].map((length) => ({ key: 'standard' as const, driver: 'standard' as const, length }));
    for (const seed of [1, 2]) {
      const sim = new LockSim(generateLock(customPreset(stacks), seed));
      const log = autoPick(sim, 0.006);
      expect(sim.opened, log.join('; ')).toBe(true);
    }
  });

  it('can be built with one stack or seven, and both open', () => {
    for (const n of [1, 7]) {
      const stacks = Array.from({ length: n }, () => ({ key: 'standard', driver: 'standard' }) as const);
      const sim = new LockSim(generateLock(customPreset(stacks.map((q) => ({ ...q }))), 3));
      expect(sim.n).toBe(n);
      const log = autoPick(sim, 0.006);
      expect(sim.opened, `${n} pins: ${log.join('; ')}`).toBe(true);
    }
  });
});

describe('security drivers', () => {
  it('every driver has a sound outline', () => {
    for (const t of DRIVER_TYPES) {
      const prof = driverProfile(t, DRIVER_LEN);
      for (let i = 0; i < prof.length; i++) {
        // Runs up the pin without doubling back, and never cuts deeper than half its radius.
        if (i > 0) expect(prof[i][0], t).toBeGreaterThanOrEqual(prof[i - 1][0]);
        expect(prof[i][1], t).toBeGreaterThanOrEqual(0);
        expect(prof[i][1], t).toBeLessThan(GEO.pinR * 0.55);
      }
      expect(prof[prof.length - 1][0], t).toBeCloseTo(DRIVER_LEN, 9);
    }
  });

  it('each one traps a plain lift, and comes through when tension is eased by feel', () => {
    for (const t of DRIVER_TYPES) {
      if (t === 'standard') continue;
      const sim = new LockSim(generateLock(customPreset([{ key: 'standard', driver: t, length: 4 }]), 1));
      const pk = sim.spec.pick;
      const S = sim.spec.geo.shearY;
      const input: SimInput = { torque: 0.008, pickX: sim.spec.pins[0].x, pickY: pk.minY, pickIn: true };
      run(sim, 0.2, input);
      // A plain lift at steady tension: the pin stops part-way and the lock stays shut.
      while (input.pickY < pk.maxY && !sim.opened && sim.pickF[0] < 3 && sim.yk[0] < sim.setHeight(0)) {
        input.pickY += 4e-3 * FRAME;
        sim.step(FRAME, input);
      }
      run(sim, 0.3, input);
      expect(sim.opened, `${t} trapped`).toBe(false);
      // Drivers with a waist let the plug turn well round: a false set.
      if (isTrapDriver(t)) expect(sim.inFalseSet, `${t} false set`).toBe(true);

      // Keep a light push on the pin; ease tension while it is stuck, firm up when it moves.
      for (let k = 0; k < 3500 && !sim.opened; k++) {
        const before = sim.yk[0];
        input.pickY = Math.min(sim.setHeight(0) + 0.25e-3, sim.yk[0] + 0.3e-3);
        run(sim, 0.02, input);
        if (sim.yk[0] - before > 1e-6) input.torque = Math.min(0.008, input.torque * 1.06);
        else input.torque = Math.max(0.0005, input.torque * 0.985);
        if (sim.yd[0] >= S) {
          input.pickY = pk.minY;
          input.torque = 0.004;
          run(sim, 2, input);
          break;
        }
      }
      expect(sim.opened, `${t} opened`).toBe(true);
    }
  });
});

describe('serrated drivers', () => {
  const stacks = [0, 1, 2, 3, 4].map((i) => ({
    key: 'standard' as const,
    driver: i % 2 ? ('serrated' as const) : ('standard' as const),
    length: 5,
  }));

  it('bite less than the gap to the next pin to bind', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const spec = generateLock(customPreset(stacks), seed);
      const sorted = spec.pins.map((p) => p.clearance).sort((a, b) => a - b);
      for (const pin of spec.pins.filter((p) => p.driver === 'serrated')) {
        const bite = Math.max(...pin.profile.slice(2, -2).map(([, d]) => d));
        const next = sorted.find((c) => c > pin.clearance);
        expect(bite).toBeGreaterThan(5e-6);
        if (next !== undefined) expect(bite).toBeLessThan(next - pin.clearance);
      }
    }
  });

  it('click on the way up without dropping a pin that is already set', () => {
    for (const torque of [0.006, 0.012]) {
      for (const seed of [1, 2, 3, 4]) {
        const sim = new LockSim(generateLock(customPreset(stacks), seed));
        const pk = sim.spec.pick;
        const input: SimInput = { torque, pickX: pk.minX, pickY: pk.minY, pickIn: true };
        let drops = 0;
        let clicks = 0;
        const step = (lifting = -1) => {
          const before = sim.theta;
          for (const e of sim.step(FRAME, input)) if (e.type === 'drop') drops++;
          // A click: the plug turns a little while the pin being lifted is still not set.
          if (
            lifting >= 0 &&
            sim.spec.pins[lifting].driver === 'serrated' &&
            sim.yd[lifting] < GEO.shearY &&
            (sim.theta - before) * GEO.plugR > 2e-6
          )
            clicks++;
        };
        for (let t = 0; t < 0.2; t += FRAME) step();
        for (let round = 0; round < 8 && !sim.opened; round++) {
          let target = -1;
          let best = 0.05;
          for (let i = 0; i < sim.n; i++) {
            if (sim.status(i) === 'binding' && sim.normal[i] > best) {
              best = sim.normal[i];
              target = i;
            }
          }
          if (target < 0) break;
          input.pickX = sim.spec.pins[target].x;
          input.pickY = pk.minY;
          for (let t = 0; t < 0.05; t += FRAME) step();
          while (
            !sim.opened &&
            sim.status(target) !== 'set' &&
            sim.yd[target] < GEO.shearY &&
            input.pickY < pk.maxY
          ) {
            input.pickY += 4e-3 * FRAME;
            step(target);
          }
          while (input.pickY > pk.minY && !sim.opened) {
            input.pickY -= 20e-3 * FRAME;
            step();
          }
          for (let t = 0; t < 0.2; t += FRAME) step();
        }
        const at = `torque ${torque}, seed ${seed}`;
        expect(sim.opened, at).toBe(true);
        expect(drops, at).toBe(0);
        expect(clicks, at).toBeGreaterThan(0);
      }
    }
  });
});

describe('wafer locks', () => {
  const wafers = PRESETS.filter((q) => q.kind === 'wafer');

  it('do not open without picking, and every wafer rests out of the plug by the same amount', () => {
    for (const preset of wafers) {
      const sim = new LockSim(generateLock(preset, 1));
      run(sim, 0.5, { torque: 0.012, pickX: 0, pickY: PICK.minY, pickIn: false });
      expect(sim.opened).toBe(false);
      const S = sim.spec.geo.shearY;
      for (let i = 0; i < sim.n; i++) {
        expect(sim.spec.pins[i].wafer).toBe(true);
        expect(S - sim.yd[i]).toBeCloseTo(sim.spec.geo.waferTravel, 5);
        // The key pin and driver slots are one plate.
        expect(sim.yd[i] - sim.yk[i]).toBeCloseTo(sim.spec.pins[i].keyLen, 9);
      }
    }
  });

  it('open when each binding wafer is lifted flush', () => {
    for (const preset of wafers) {
      for (const seed of [1, 2, 3]) {
        const sim = new LockSim(generateLock(preset, seed));
        const log = autoPick(sim, 0.006);
        expect(sim.opened, `${preset.id} seed ${seed}: ${log.join('; ')}`).toBe(true);
      }
    }
  });

  it('a wafer lifted too far catches at its top end and blocks the plug', () => {
    const sim = new LockSim(generateLock(wafers[0], 1));
    const geo = sim.spec.geo;
    // Lift one wafer well past flush before any tension is on, and hold it there.
    const input: SimInput = { torque: 0, pickX: sim.spec.pins[0].x, pickY: sim.setHeight(0) + 1.2e-3, pickIn: true };
    run(sim, 0.3, input);
    expect(sim.yd[0]).toBeGreaterThan(geo.shearY + 0.3e-3);
    // Now tension the plug: the wafer's top end is in the housing and takes the load.
    input.torque = 0.03;
    run(sim, 0.3, input);
    expect(sim.status(0)).toBe('overset');
    expect(sim.opened).toBe(false);
    // Heavy tension pinches it hard enough to stay up when the pick lets go...
    input.pickY = PICK.minY;
    run(sim, 0.4, input);
    expect(sim.status(0)).toBe('overset');
    // ...until tension is released, when its spring takes it back to rest.
    input.torque = 0;
    run(sim, 0.4, input);
    expect(geo.shearY - sim.yd[0]).toBeCloseTo(geo.waferTravel, 5);
  });

  it('a flush wafer is held at both ends: a firm push does not move it on, nor does it fall', () => {
    const sim = new LockSim(generateLock(wafers[0], 2));
    const input: SimInput = { torque: 0.008, pickX: PICK.minX, pickY: PICK.minY, pickIn: true };
    run(sim, 0.3, input);
    const binder = [...Array(sim.n).keys()].find((i) => sim.status(i) === 'binding')!;
    input.pickX = sim.spec.pins[binder].x;
    while (sim.status(binder) === 'binding' && input.pickY < PICK.maxY) {
      input.pickY += 4e-3 * FRAME;
      sim.step(FRAME, input);
    }
    run(sim, 0.2, input);
    expect(sim.status(binder)).toBe('set');
    // A firm push, about a newton, does not move it on.
    input.pickY = sim.setHeight(binder) + 0.25e-3;
    run(sim, 0.4, input);
    expect(Math.abs(sim.yd[binder] - sim.spec.geo.shearY)).toBeLessThan(0.04e-3);
    input.pickY = PICK.minY;
    run(sim, 0.4, input);
    expect(sim.status(binder)).toBe('set');
  });
});
