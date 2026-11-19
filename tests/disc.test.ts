import { describe, expect, it } from 'vitest';
import { DISC, DISC_PRESETS, DiscSim, generateDiscLock, type DiscInput } from '../src/sim/disc';

const FRAME = 1 / 120;
const rad = (deg: number) => (deg * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

function run(sim: DiscSim, seconds: number, input: DiscInput) {
  for (let t = 0; t < seconds && !sim.opened; t += FRAME) sim.step(FRAME, input);
}

const binder = (sim: DiscSim) => {
  let best = -1;
  let n = 0.05;
  for (let i = 0; i < sim.n; i++) {
    if (sim.status(i) === 'binding' && sim.normal[i] > n) {
      n = sim.normal[i];
      best = i;
    }
  }
  return best;
};

/** Turn each binding disc forward until it stops binding, as a picker would. */
function autoPick(sim: DiscSim, torque: number, maxSeconds = 60) {
  const input: DiscInput = { torque, pickDisc: -1, pickAngle: 0 };
  run(sim, 0.2, input);
  const log: string[] = [];
  while (!sim.opened && sim.time < maxSeconds) {
    const b = binder(sim);
    if (b < 0) {
      log.push(`no binder [${[...Array(sim.n).keys()].map((i) => sim.status(i)[0]).join('')}]`);
      break;
    }
    input.pickDisc = b;
    input.pickAngle = sim.phi[b];
    while (!sim.opened && sim.status(b) === 'binding' && input.pickAngle < DISC.maxAngle + 0.1) {
      input.pickAngle += rad(40) * FRAME;
      sim.step(FRAME, input);
    }
    // The disc has gone loose at the lip of a notch: ease it on a few degrees
    // so it seats, as you would by feel, then let go.
    input.pickAngle = sim.phi[b] + rad(3);
    run(sim, 0.15, input);
    log.push(`d${b + 1}@${deg(sim.phi[b]).toFixed(0)}->${sim.opened ? 'OPEN' : sim.status(b)}`);
    input.pickDisc = -1;
    run(sim, 0.3, input);
    if (sim.inFalseSet) break;
  }
  return log;
}

describe('disc detainer physics', () => {
  it('stays shut under tension alone, and binds only the largest disc', () => {
    const spec = generateDiscLock(DISC_PRESETS[0], 5);
    for (const torque of [0, 0.012, 0.08]) {
      const sim = new DiscSim(spec);
      run(sim, 0.5, { torque, pickDisc: -1, pickAngle: 0 });
      expect(sim.opened).toBe(false);
      expect(sim.theta).toBeLessThan(0.06);
    }
    const sim = new DiscSim(spec);
    run(sim, 0.3, { torque: 0.012, pickDisc: -1, pickAngle: 0 });
    const largest = spec.discs.map((d, i) => [d.excess, i]).sort((a, b) => b[0] - a[0])[0][1];
    const binding = [...Array(sim.n).keys()].filter((i) => sim.status(i) === 'binding');
    expect(binding).toEqual([largest]);
  });

  it('a free disc turns easily and stays put; the binding disc resists', () => {
    const spec = generateDiscLock(DISC_PRESETS[0], 5);
    const order = spec.discs.map((d, i) => [d.excess, i]).sort((a, b) => b[0] - a[0]);
    const bind = order[0][1];
    const loose = order[order.length - 1][1];
    const peak = (disc: number) => {
      const sim = new DiscSim(spec);
      const input: DiscInput = { torque: 0.02, pickDisc: -1, pickAngle: 0 };
      run(sim, 0.2, input);
      input.pickDisc = disc;
      let p = 0;
      // Ten degrees: short of any gate.
      while (input.pickAngle < rad(10)) {
        input.pickAngle += rad(40) * FRAME;
        sim.step(FRAME, input);
        p = Math.max(p, sim.totalPickForce);
      }
      const reached = sim.phi[disc];
      input.pickDisc = -1;
      run(sim, 0.2, input);
      expect(sim.phi[disc]).toBeCloseTo(reached, 2);
      return p;
    };
    expect(peak(bind)).toBeGreaterThan(4 * peak(loose));
  });

  it('opens when every binding disc is turned to its gate', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const spec = generateDiscLock(DISC_PRESETS[0], seed);
      const sim = new DiscSim(spec);
      const log = autoPick(sim, 0.012);
      expect(sim.opened, `seed ${seed}: ${log.join(' | ')}`).toBe(true);
      for (let i = 0; i < sim.n; i++) {
        expect(Math.abs(sim.phi[i] - spec.discs[i].gate)).toBeLessThan(DISC.gateHalf + DISC.gateRamp);
      }
    }
  });

  it('turning a set disc on past its gate makes it bind again', () => {
    const spec = generateDiscLock(DISC_PRESETS[0], 2);
    const sim = new DiscSim(spec);
    const input: DiscInput = { torque: 0.012, pickDisc: -1, pickAngle: 0 };
    run(sim, 0.2, input);
    const b = binder(sim);
    input.pickDisc = b;
    input.pickAngle = spec.discs[b].gate;
    run(sim, 0.6, input);
    expect(sim.status(b)).toBe('set');
    input.pickAngle = Math.min(DISC.maxAngle, spec.discs[b].gate + rad(12));
    if (input.pickAngle - spec.discs[b].gate > rad(9)) {
      run(sim, 0.6, input);
      expect(sim.status(b)).toBe('binding');
    }
  });

  it('false gates give a false set that traps the disc until tension is eased', () => {
    let trapped = 0;
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const spec = generateDiscLock(DISC_PRESETS[1], seed);
      const sim = new DiscSim(spec);
      autoPick(sim, 0.012, 40);
      if (!sim.inFalseSet) continue;
      const stuck = [...Array(sim.n).keys()].find((i) => sim.status(i) === 'overset');
      if (stuck === undefined) continue;
      trapped++;
      expect(sim.opened).toBe(false);
      // Under firm tension the disc cannot be forced out of the false gate...
      const input: DiscInput = { torque: 0.06, pickDisc: stuck, pickAngle: sim.phi[stuck] };
      run(sim, 0.2, input);
      const before = sim.phi[stuck];
      input.pickAngle = before + rad(25);
      run(sim, 0.5, input);
      expect(sim.status(stuck)).toBe('overset');
      // ...but with tension off it turns freely.
      input.torque = 0;
      run(sim, 0.5, input);
      expect(sim.phi[stuck] - before).toBeGreaterThan(rad(15));
    }
    expect(trapped).toBeGreaterThan(0);
  });

  it('with every gate lined up it opens at any tension, without the sidebar bouncing', () => {
    for (const preset of DISC_PRESETS) {
      for (const torque of [0.001, 0.003, 0.006, 0.012, 0.03]) {
        const spec = generateDiscLock(preset, 4);
        const sim = new DiscSim(spec);
        // Discs a little off-centre in their gates, alternately either side.
        spec.discs.forEach((d, i) => (sim.phi[i] = d.gate + (i % 2 ? 1 : -1) * DISC.gateHalf * 0.8));
        const input: DiscInput = { torque, pickDisc: -1, pickAngle: 0 };
        // The sidebar must only ever go down: any rise is the old bounce.
        let lowest = sim.sidebarY;
        let rise = 0;
        for (let t = 0; t < 4 && !sim.opened; t += FRAME) {
          sim.step(FRAME, input);
          rise = Math.max(rise, sim.sidebarY - lowest);
          lowest = Math.min(lowest, sim.sidebarY);
        }
        expect(sim.opened, `${preset.id} at ${torque} N·m`).toBe(true);
        expect(rise, `${preset.id} at ${torque} N·m`).toBeLessThan(0.02e-3);
      }
    }
  });
});
