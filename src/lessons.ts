// Guided lessons: a short sequence of steps for each lock, each of which is
// ticked off when the simulation sees the player do it. The lessons know
// nothing about the page or the renderer; main.ts feeds them a snapshot of the
// lock every frame and shows whatever step and advice come back.

import type { PinStatus } from './sim/physics';

/** One pin stack or disc, as a lesson sees it. */
export interface LessonPin {
  label: string;
  row: 'top' | 'side';
  part: 'solid' | 'outer' | 'inner';
  spool: boolean;
  serratedDriver: boolean;
  serratedKey: boolean;
  status: PinStatus;
  /** The pick is pushing this pin, or gripping this disc, right now. */
  touched: boolean;
}

export interface LessonState {
  dt: number;
  torque: number;
  opened: boolean;
  inFalseSet: boolean;
  pins: LessonPin[];
}

/** Scratch values a step keeps while it is the current one. */
type Memory = Record<string, number>;

export interface LessonStep {
  title: string;
  text: string;
  done: (s: LessonState, m: Memory) => boolean;
  /** Optional running count shown under the step, e.g. "3 of 5 set". */
  progress?: (s: LessonState) => string;
}

export interface Lesson {
  steps: LessonStep[];
  /** Advice that applies whatever the step: the most pressing thing wrong. */
  coach: (s: LessonState, stepIndex: number) => string | null;
}

// --- Helpers -------------------------------------------------------------------
const mNm = (t: number) => t * 1000;
const count = (s: LessonState, st: PinStatus) => s.pins.filter((p) => p.status === st).length;
const any = (s: LessonState, f: (p: LessonPin) => boolean) => s.pins.some(f);

/** True once `cond` has held continuously for `seconds`. */
function held(m: Memory, s: LessonState, cond: boolean, seconds: number) {
  m.t = cond ? (m.t ?? 0) + s.dt : 0;
  return m.t >= seconds;
}

const spoolsSet = (s: LessonState) => s.pins.every((p) => !p.spool || p.status === 'set');

// --- Steps shared between locks ------------------------------------------------------
function tension(lo: number, hi: number, why: string): LessonStep {
  return {
    title: 'Apply light tension',
    text: `Roll the mouse wheel up, or hold W, until the Tension gauge reads between ${lo} and ${hi} mN·m, and hold it there. ${why}`,
    done: (s, m) => held(m, s, mNm(s.torque) >= lo && mNm(s.torque) <= hi, 0.5),
    progress: (s) => `${mNm(s.torque).toFixed(1)} mN·m`,
  };
}

const WHY_PIN =
  'Tension turns the plug a hair, so that one pin is pinched at the shear line while the others stay loose.';

const findBinder = (how: string): LessonStep => ({
  title: 'Find the binding pin',
  text: `${how} Loose pins are springy and fall straight back. One pin is stiff, and shows orange: that is the binding pin.`,
  done: (s) => any(s, (p) => p.touched && p.status === 'binding'),
});

const HOOK_HOW = 'Move the pick under each pin in turn and lift it a little.';
const FLAG_HOW =
  'Move the pick under a pin and push the mouse up: that twists the pick so the tip of its flag swings up into the pin.';

const setFirst = (extra = ''): LessonStep => ({
  title: 'Set it',
  text: `Lift the binding pin slowly until it clicks. The plug turns a hair and the pin goes green: its driver is now resting on top of the plug. Lower the pick and it stays there. ${extra}`.trim(),
  done: (s) => count(s, 'set') >= 1,
});

const setRest = (text: string): LessonStep => ({
  title: 'Set the rest and open the lock',
  text,
  done: (s) => s.opened,
  progress: (s) => `${s.opened ? s.pins.length : count(s, 'set')} of ${s.pins.length} set`,
});

const falseSet: LessonStep = {
  title: 'Reach the false set',
  text: 'Keep setting pins until the plug suddenly turns several degrees without opening. That is a false set: a spool driver has let the plug turn until it caught on the spool’s narrow waist. Watch the Plug rotation gauge and the front view.',
  // A spool that happens to bind last can be set without ever false setting.
  done: (s) => s.inFalseSet || spoolsSet(s),
};

const workSpool: LessonStep = {
  title: 'Ease the spool through',
  text: 'Find the pin that pushes back hard: it has a grey spool driver. Lift it gently and, at the same time, ease off tension with S or the wheel. The plug counter-rotates as the spool’s flange squeezes past the shear line, then the pin sets. Do not drop tension completely, or every pin falls.',
  done: (s, m) => held(m, s, spoolsSet(s) && !s.inFalseSet && s.torque > 0.001, 0.3),
  progress: (s) => {
    const spools = s.pins.filter((p) => p.spool);
    return `${spools.filter((p) => p.status === 'set').length} of ${spools.length} spools set`;
  },
};

const serratedDriver: LessonStep = {
  title: 'Lift through the serrations',
  text: 'A serrated driver clicks several times on the way up. Each click is a groove catching at the shear line, not a set: the pin stays orange. Keep lifting through the clicks until it goes green.',
  done: (s) => any(s, (p) => p.serratedDriver && p.status === 'set'),
};

const countermill: LessonStep = {
  title: 'Past the countermilling',
  text: 'This core is countermilled: the top of each chamber is bored out wider, down to a ledge just below the shear line. Lift the binding pin and you get a click and the plug turns a hair, but the pin does not go green: its driver has only come up into the wider bore, and rests on the ledge when you let go. Carry on with the other pins. When that pin binds again, lift it the rest of the way until it goes green.',
  done: (s) => count(s, 'set') >= 1,
};

const serratedKey = (which: string): LessonStep => ({
  title: 'Stop at the set',
  text: `${which} serrations at the top. Push one even slightly past the shear line and a serration catches: the pin goes red and stays up. Lift slowly and stop the moment a pin goes green. Set one of the pins whose key pin is grooved.`,
  done: (s) => any(s, (p) => p.serratedKey && p.status === 'set'),
});

const sideRow: LessonStep = {
  title: 'Reach the side row',
  text: 'The side pins sit between the top pins, on the far side of the key. Put the pick between two top pins and keep pushing the mouse up, past upright, so the flag lays over onto the side row. The Side row inset shows it from above.',
  done: (s) => any(s, (p) => p.row === 'side' && p.touched),
};

const innerPin: LessonStep = {
  title: 'Lift an inner pin',
  text: 'Each chamber holds a pin inside a hollow pin. Centre the flag under a chamber and push up: the tip goes inside the outer pin and lifts only the inner one, which has the violet driver.',
  done: (s) => any(s, (p) => p.part === 'inner' && p.touched),
};

const outerPin: LessonStep = {
  title: 'Catch an outer pin',
  text: 'Now move the pick about a millimetre along the keyway from the centre of a chamber and push up again. The tip catches the rim of the hollow outer pin, which has the blue driver, and lifts that instead.',
  done: (s) => any(s, (p) => p.part === 'outer' && p.touched),
};

// --- Coaching ---------------------------------------------------------------------------
function pinCoach(heavy: number, wafers = false) {
  return (s: LessonState, step: number) => {
    if (s.opened) return null;
    const over = s.pins.find((p) => p.status === 'overset');
    if (over && wafers)
      return `Wafer ${over.label} is lifted too far (red): its top end is now caught in the housing. Ease off tension until it drops.`;
    if (over)
      return `Pin ${over.label} is overset (red): its key pin is jammed above the shear line. Ease off tension until it drops.`;
    if (mNm(s.torque) > heavy)
      return `Tension is heavy. Several pins bind at once and each needs far more force to move. Ease off to under ${heavy} mN·m.`;
    if (step > 0 && s.torque < 0.0015)
      return 'There is no tension on the plug, so nothing can bind and nothing stays set.';
    return null;
  };
}

function discCoach(s: LessonState, step: number) {
  if (s.opened) return null;
  const trapped = s.pins.find((p) => p.status === 'overset');
  if (trapped)
    return `Disc ${trapped.label} is in a false gate (red) and trapped. Ease off tension until it turns freely, then carry on to its true gate.`;
  if (mNm(s.torque) > 40)
    return 'Tension is heavy, so the binding disc is very stiff and false gates grip hard. Ease off to under 25 mN·m.';
  if (step > 0 && s.torque < 0.0015)
    return 'There is no tension on the core, so no disc binds and you cannot feel the gates.';
  return null;
}

/** The steps for a wafer lock, where a wafer can be lifted too far as well as not far enough. */
function waferSteps(extra: string): LessonStep[] {
  return [
    tension(
      5,
      25,
      'Tension turns the plug a hair, so that one wafer is pinched where its end sticks out into the housing while the others stay loose.',
    ),
    {
      title: 'Find the binding wafer',
      text: `Put the pick through the windows of the wafers and lift under the top edge of each window in turn. The windows are at different heights, so the pick meets each wafer at a different level. Loose wafers are springy; the stiff one, shown orange, is binding.${extra}`,
      done: (s) => any(s, (p) => p.touched && p.status === 'binding'),
    },
    {
      title: 'Lift it flush',
      text: 'Lift the binding wafer slowly. Its bottom end comes up out of the groove in the housing, and when it is flush with the plug the plug turns a hair and the wafer goes green. Stop there: every wafer needs the same small lift, about a millimetre and a half.',
      done: (s) => count(s, 'set') >= 1,
    },
    setRest(
      'A different wafer is binding now. Find it, lift it flush, and repeat until the plug turns. If a wafer goes red you lifted it too far and its top end has caught: ease off tension until it drops.',
    ),
  ];
}

// --- Lessons, by lock id --------------------------------------------------------------
const ORDER = 'A different pin is binding now. Find it, set it, and repeat until the plug turns.';

const LESSONS: Record<string, Lesson> = {
  trainer2: {
    coach: pinCoach(30),
    steps: [tension(5, 25, WHY_PIN), findBinder(HOOK_HOW), setFirst(), setRest(ORDER)],
  },
  trainer3: {
    coach: pinCoach(30),
    steps: [
      tension(5, 25, WHY_PIN),
      findBinder(HOOK_HOW),
      setFirst(),
      setRest(
        `${ORDER} The binding order comes from tiny differences in the drilling, so it is rarely front to back: test every pin each time.`,
      ),
    ],
  },
  standard5: {
    coach: pinCoach(30),
    steps: [
      tension(5, 25, WHY_PIN),
      findBinder(HOOK_HOW),
      setFirst('With five pins the gap between one pin binding and the next is smaller, so the click is fainter.'),
      setRest(
        `${ORDER} If nothing binds but the lock is not open, the springs of the set pins are holding the plug back: add a little tension.`,
      ),
    ],
  },
  spool5: {
    coach: pinCoach(30),
    steps: [
      tension(5, 25, WHY_PIN),
      findBinder(HOOK_HOW),
      setFirst(),
      falseSet,
      workSpool,
      setRest('Set whatever is still binding. A second spool means a second false set: treat it the same way.'),
    ],
  },
  security5: {
    coach: pinCoach(25),
    steps: [
      tension(5, 18, `${WHY_PIN} Tolerances are tight on this lock, so keep it light.`),
      findBinder(HOOK_HOW),
      serratedDriver,
      falseSet,
      workSpool,
      setRest('Set whatever is still binding, easing through each false set and lifting through each run of clicks.'),
    ],
  },
  serrated5: {
    coach: pinCoach(14),
    steps: [
      tension(
        6,
        9,
        `${WHY_PIN} This lock needs very light tension: any more and a key pin jams the moment its driver clears.`,
      ),
      findBinder(HOOK_HOW),
      serratedDriver,
      serratedKey('Three of the key pins have'),
      setRest('Set the remaining pins the same way. If one jams red, ease off tension until it drops; you may lose the others and have to start again.'),
    ],
  },
  dimple5single: {
    coach: pinCoach(30),
    steps: [
      tension(5, 25, WHY_PIN),
      findBinder(FLAG_HOW),
      setFirst('Pin travel is short in a dimple lock, so the set comes after a very small movement.'),
      setRest(ORDER),
    ],
  },
  dimple5: {
    coach: pinCoach(30),
    steps: [
      tension(5, 25, WHY_PIN),
      findBinder(FLAG_HOW),
      setFirst(),
      sideRow,
      setRest('All eight pins bind in one order that jumps between the two rows. Check both rows each time you look for the binder.'),
    ],
  },
  dimple6: {
    coach: pinCoach(28),
    steps: [
      tension(5, 20, WHY_PIN),
      findBinder(FLAG_HOW),
      setFirst(),
      sideRow,
      falseSet,
      workSpool,
      setRest('Set whatever is still binding in either row, easing through each false set.'),
    ],
  },
  dimpleTelescoping: {
    coach: pinCoach(30),
    steps: [
      tension(5, 25, WHY_PIN),
      innerPin,
      outerPin,
      setFirst('Either an inner or an outer pin may be the first to bind.'),
      setRest('Both pins in every chamber must be set: ten stacks in one mixed binding order. For each binder, work out whether it is the inner or the outer pin and place the tip to suit.'),
    ],
  },
  dimpleTelescopingSide: {
    coach: pinCoach(28),
    steps: [
      tension(5, 20, WHY_PIN),
      innerPin,
      outerPin,
      sideRow,
      setFirst(),
      falseSet,
      workSpool,
      setRest('Thirteen stacks in one binding order: inner pins, outer pins and the side row. Take them one binder at a time.'),
    ],
  },
  wafer5: { coach: pinCoach(30, true), steps: waferSteps('') },
  wafer7: {
    coach: pinCoach(25, true),
    steps: waferSteps(' With seven wafers only 2.4 mm apart, check the pick is under the one you mean.'),
  },
  disc6: {
    coach: discCoach,
    steps: [
      tension(
        5,
        25,
        'Tension turns the core, which presses the sidebar down onto the discs. It rests on the largest disc only.',
      ),
      {
        title: 'Find the binding disc',
        text: 'Move the mouse along the lock to put the pick’s tip in a disc, hold the left button and drag up a little to turn it. Free discs turn easily. One resists and shows orange: the sidebar is resting on it.',
        done: (s) => any(s, (p) => p.touched && p.status === 'binding'),
      },
      {
        title: 'Turn it to its gate',
        text: 'Keep dragging up to turn the binding disc. When its gate reaches the sidebar the disc clicks loose and goes green. Turn it too far and it binds again: drag back down.',
        done: (s) => count(s, 'set') >= 1,
      },
      setRest('The sidebar has dropped a hair onto the next largest disc. Find that one, turn it to its gate, and repeat until the core turns.'),
    ],
  },
  disc9false: {
    coach: discCoach,
    steps: [
      tension(
        5,
        20,
        'Tension turns the core, which presses the sidebar down onto the discs. Keep it light: false gates grip harder under heavy tension.',
      ),
      {
        title: 'Find the binding disc',
        text: 'Put the pick’s tip in a disc, hold the left button and drag up a little. Free discs turn easily; the binding disc resists and shows orange.',
        done: (s) => any(s, (p) => p.touched && p.status === 'binding'),
      },
      {
        title: 'Meet a false gate',
        text: 'Each disc has shallow false gates as well as its true one. Turn binding discs until one clicks, goes red and the core turns slightly: the sidebar has dropped part-way into a false gate and the disc is trapped. Gates are shaded on the rims: near-black is true, mid-grey is false.',
        // Someone who lands only on true gates should not be held here.
        done: (s) => any(s, (p) => p.status === 'overset') || count(s, 'set') >= 4,
      },
      {
        title: 'Free the trapped disc',
        text: 'Ease off tension with S or the wheel until the red disc turns freely, turn it on past the false gate, then bring tension back and carry on to its true gate.',
        done: (s, m) => held(m, s, !any(s, (p) => p.status === 'overset') && s.torque > 0.003, 0.4),
      },
      setRest('Turn each binding disc to its true gate. A disc that goes red is in a false gate: ease off, move it on, and continue.'),
    ],
  },
};

/**
 * Lesson for a lock someone built: the basic steps, plus the steps for each
 * kind of security pin they put in it.
 */
export function customLesson(pins: LessonPin[], countermilled = false): Lesson {
  const spool = pins.some((p) => p.spool);
  const serrated = pins.some((p) => p.serratedDriver);
  const grooved = pins.some((p) => p.serratedKey);
  const steps: LessonStep[] = [
    grooved
      ? tension(6, 9, `${WHY_PIN} Serrated key pins need very light tension: any more and one jams the moment its driver clears.`)
      : tension(5, spool || serrated ? 18 : 25, WHY_PIN),
    findBinder(HOOK_HOW),
    ...(countermilled ? [countermill] : []),
    serrated ? serratedDriver : setFirst(),
  ];
  if (spool) steps.push(falseSet, workSpool);
  if (grooved) steps.push(serratedKey('Some of the key pins have'));
  steps.push(
    setRest(
      pins.length === 1
        ? 'With a single pin, setting it opens the lock.'
        : `${ORDER} If nothing binds but the lock is not open, the springs of the set pins are holding the plug back: add a little tension.`,
    ),
  );
  return { coach: pinCoach(grooved ? 14 : 30), steps };
}

export function lessonFor(lockId: string): Lesson | null {
  return LESSONS[lockId] ?? null;
}

/** Walks a lesson: call update() every frame with the lock's state. */
export class LessonRunner {
  index = 0;
  coach: string | null = null;
  private memory: Memory = {};

  constructor(readonly lesson: Lesson) {}

  get complete() {
    return this.index >= this.lesson.steps.length;
  }

  /** Returns true when the current step has just been completed. */
  update(s: LessonState) {
    let advanced = false;
    // More than one step can complete in a frame (e.g. a pin sets on first touch).
    while (!this.complete && this.lesson.steps[this.index].done(s, this.memory)) {
      this.index++;
      this.memory = {};
      advanced = true;
    }
    // Opening the lock by any route finishes the lesson.
    if (s.opened && !this.complete) {
      this.index = this.lesson.steps.length;
      advanced = true;
    }
    this.coach = this.lesson.coach(s, this.index);
    return advanced;
  }
}
