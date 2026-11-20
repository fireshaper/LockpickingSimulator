import {
  DEEP_HOOK_PICK,
  DIAMOND_PICK,
  DRIVER_LEN,
  DRIVER_NAMES,
  DRIVER_TYPES,
  GEO,
  HOOK_PICK,
  KEY_LENGTHS,
  MAX_STACKS,
  PRESETS,
  RAKE_PICK,
  SNAKE_PICK,
  bokWrench,
  customPreset,
  driverProfile,
  generateLock,
  isTrapDriver,
  keyPinProfile,
  pickMinY,
  type DriverType,
  type KeyPinType,
  type LockSpec,
  type PickSpec,
  type StackChoice,
} from './sim/lock';
import { LockSim, MAX_TORQUE, type SimEvent, type SimInput } from './sim/physics';
import {
  DISC,
  DISC_PRESETS,
  DiscSim,
  discX,
  generateDiscLock,
  type DiscInput,
  type DiscLockSpec,
} from './sim/disc';
import { LockView, type ViewMode } from './render/view';
import { LockAudio } from './audio';
import { renderToolThumbs } from './render/thumbs';
import { LessonRunner, customLesson, lessonFor, type LessonState } from './lessons';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const canvas = $<HTMLCanvasElement>('scene');
const view = new LockView(canvas);
const audio = new LockAudio();

const ui = {
  chooseLock: $<HTMLButtonElement>('choose-lock'),
  lockName: $('lock-name'),
  chooser: $<HTMLDialogElement>('chooser'),
  chooserList: $('chooser-list'),
  builder: $<HTMLDialogElement>('builder'),
  builderN: $('builder-n'),
  builderLess: $<HTMLButtonElement>('builder-less'),
  builderMore: $<HTMLButtonElement>('builder-more'),
  builderStacks: $('builder-stacks'),
  builderGo: $<HTMLButtonElement>('builder-go'),
  builderRandom: $<HTMLButtonElement>('builder-random'),
  builderCountermill: $<HTMLInputElement>('builder-countermill'),
  builderAllDrivers: $<HTMLSelectElement>('builder-all-drivers'),
  view: $<HTMLSelectElement>('view'),
  case: $('case'),
  caseEdit: $<HTMLButtonElement>('case-edit'),
  caseRoll: $<HTMLButtonElement>('case-roll'),
  casePicks: $('case-picks'),
  caseTension: $('case-tension'),
  caseNote: $('case-note'),
  caseUsing: $('case-using'),
  helpToolKey: $('help-tool-key'),
  helpTool: $('help-tool'),
  hints: $<HTMLInputElement>('hints'),
  sound: $<HTMLInputElement>('sound'),
  front: $<HTMLInputElement>('front'),
  frontView: $('front-view'),
  sideView: $('side-view'),
  frontDeg: $('front-deg'),
  tension: $<HTMLInputElement>('tension'),
  tensionVal: $('tension-val'),
  forceLabel: $('force-label'),
  forceVal: $('force-val'),
  forceBar: $('force-bar'),
  rotVal: $('rot-val'),
  rotBar: $('rot-bar'),
  pinsLabel: $('pins-label'),
  pinsVal: $('pins-val'),
  pinDots: $('pin-dots'),
  legendOverset: $('legend-overset'),
  helpMouse: $('help-mouse'),
  log: $('log'),
  lessonTitle: $('lesson-title'),
  lessonText: $('lesson-text'),
  banner: $('open-banner'),
  openNext: $<HTMLButtonElement>('open-next'),
  guideOn: $<HTMLInputElement>('guide-on'),
  guide: $('guide'),
  guideProgress: $('guide-progress'),
  guideSteps: $('guide-steps'),
  guideCoach: $('guide-coach'),
  openStats: $('open-stats'),
};

const PICK_SPEED = 0.3; // m/s, how fast a hand can move the pick
const KEY_TENSION_RATE = 0.03; // N·m per second while W/S is held
const TURN_PER_PIXEL = (0.45 * Math.PI) / 180; // disc pick twist per pixel of drag
const TURN_SPEED = 8; // rad/s, how fast a hand can twist the disc pick

// Every lock in the menu, whatever its mechanism.
interface LockEntry {
  id: string;
  kind: 'pin' | 'dimple' | 'disc' | 'wafer';
  name: string;
  description: string;
  make: (seed: number) => LockSpec | DiscLockSpec;
}
const fromPreset = (p: (typeof PRESETS)[number]): LockEntry => ({
  id: p.id,
  kind: p.kind,
  name: p.name,
  description: p.description,
  make: (seed: number) => generateLock(p, seed),
});
// In lesson order: pin tumblers and dimples, then disc detainers, then wafers.
const LOCKS: LockEntry[] = [
  ...PRESETS.filter((p) => p.kind !== 'wafer').map(fromPreset),
  ...DISC_PRESETS.map((p) => ({
    id: p.id,
    kind: 'disc' as const,
    name: p.name,
    description: p.description,
    make: (seed: number) => generateDiscLock(p, seed),
  })),
  ...PRESETS.filter((p) => p.kind === 'wafer').map(fromPreset),
];
/** Locks worked with a hook or a rake in a keyway, and a separate tension tool. */
const hooked = (kind: string) => kind === 'pin' || kind === 'wafer';
const KIND_TITLE: Record<LockEntry['kind'], string> = {
  wafer: 'Wafer',
  pin: 'Pin tumbler',
  dimple: 'Dimple',
  disc: 'Disc detainer',
};

let presetIndex = 0;
let seed = (Date.now() % 100000) + 1;
let spec: LockSpec | DiscLockSpec;
/** Exactly one of these is live, depending on the lock's mechanism. */
let pinSim: LockSim | null = null;
let discSim: DiscSim | null = null;
let torque = 0;
let displayTheta = 0;
let startTime: number | null = null;
let openHandled = false;
let stallTime = 0;
let stallSaid = false;
const target = { x: 0, y: 0 };
const pick = { x: 0, y: 0 };
/** Disc pick: which disc it is gripping, and the twist the hand is asking for. */
const turn = { gripping: false, disc: -1, startAngle: 0, startY: 0, want: 0, angle: 0 };
const keys = new Set<string>();
/** Guided lesson for the current lock, and the snapshot of the lock it reads. */
let runner: LessonRunner | null = null;
const lessonState: LessonState = { dt: 0, torque: 0, opened: false, inFalseSet: false, pins: [] };
let shownStep = -1;

const sim = () => (discSim ?? pinSim)!;

// Lock chooser: a window with one button per lock, grouped by mechanism.
const lockButtons: HTMLButtonElement[] = [];
for (const kind of ['pin', 'dimple', 'disc', 'wafer'] as const) {
  const section = document.createElement('section');
  const h = document.createElement('h3');
  h.textContent = KIND_TITLE[kind];
  const grid = document.createElement('div');
  grid.className = 'lock-grid';
  section.append(h, grid);
  for (const [i, l] of LOCKS.entries()) {
    if (l.kind !== kind || l.id === 'custom') continue;
    const b = document.createElement('button');
    b.type = 'button';
    const name = document.createElement('b');
    name.textContent = l.name;
    const text = document.createElement('span');
    text.textContent = l.description;
    b.append(name, text);
    b.addEventListener('click', () => {
      presetIndex = i;
      ui.chooser.close();
      loadLock(true);
    });
    lockButtons[i] = b;
    grid.append(b);
  }
  ui.chooserList.append(section);
}

// --- Build your own lock ------------------------------------------------------
// A pin tumbler lock put together stack by stack. It is the last entry in
// LOCKS; the built-in lessons stop before it.
const CUSTOM_KEY = 'lockpick.custom';
const KEY_TYPES: KeyPinType[] = ['standard', 'serrated'];
const KEY_NAMES: Record<KeyPinType, string> = { standard: 'Standard', serrated: 'Serrated' };

/**
 * Picture of a pin for the builder, drawn from the outline the lock itself
 * uses. `outline` is [distance along the pin, how far in from full width], in
 * metres, running up the pin from its bottom.
 */
function pinArt(part: 'driver' | 'key', outline: ReadonlyArray<readonly [number, number]>, length: number) {
  const scale = 8200; // pixels per metre
  const r = GEO.pinR * scale;
  const h = length * scale;
  const side = (sign: number) => outline.map(([at, inset]) => `${sign * (r - inset * scale)},${h - at * scale}`);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `${-r - 1} -1 ${2 * r + 2} ${h + 2}`);
  svg.setAttribute('class', `pin-art ${part}`);
  svg.setAttribute('aria-hidden', 'true');
  svg.style.height = `${h + 2}px`;
  const shape = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
  shape.setAttribute('points', [...side(1), ...side(-1).reverse()].join(' '));
  shape.setAttribute('fill', part === 'driver' ? '#c9ced6' : '#e0b85c');
  svg.append(shape);
  return svg;
}

/** A key pin's outline from its tip up: the cone, the body, then the top (and any grooves). */
function keyOutline(type: KeyPinType, length: number): Array<readonly [number, number]> {
  const top = [...keyPinProfile(type)].reverse().map(([down, inset]) => [length - down, inset] as const);
  return [[0, GEO.pinR - 0.3e-3], [1.05e-3, 0], ...top];
}

/** The design: how many stacks, and the pins chosen for each (kept even when hidden). */
const design = {
  count: 5,
  countermilled: false,
  stacks: Array.from({ length: MAX_STACKS }, (): StackChoice => ({ key: 'standard', driver: 'standard' })),
};
try {
  const saved = JSON.parse(localStorage.getItem(CUSTOM_KEY) ?? 'null');
  if (saved && Array.isArray(saved.stacks)) {
    if (Number.isInteger(saved.count)) design.count = Math.min(MAX_STACKS, Math.max(1, saved.count));
    design.countermilled = saved.countermilled === true;
    saved.stacks.slice(0, MAX_STACKS).forEach((q: Partial<StackChoice> | null, i: number) => {
      if (q && DRIVER_TYPES.includes(q.driver as DriverType)) design.stacks[i].driver = q.driver as DriverType;
      if (q && KEY_TYPES.includes(q.key as KeyPinType)) design.stacks[i].key = q.key as KeyPinType;
      const len = q?.length;
      if (Number.isInteger(len) && len! >= 1 && len! <= KEY_LENGTHS) design.stacks[i].length = len;
    });
  }
} catch {
  // Nothing saved, or unreadable: start from five standard stacks.
}
const designPreset = () =>
  customPreset(
    design.stacks.slice(0, design.count).map((q) => ({ ...q })),
    design.countermilled,
  );

const CUSTOM = LOCKS.length;
LOCKS.push({
  id: 'custom',
  kind: 'pin',
  name: designPreset().name,
  description: designPreset().description,
  make: (seed) => generateLock(designPreset(), seed),
});

/** What the builder window is showing, until "Build it" makes it the design. */
const draft = {
  count: design.count,
  countermilled: design.countermilled,
  stacks: design.stacks.map((q) => ({ ...q })),
};
let built = false;

function renderBuilder() {
  ui.builderN.textContent = String(draft.count);
  ui.builderCountermill.checked = draft.countermilled;
  ui.builderLess.disabled = draft.count <= 1;
  ui.builderMore.disabled = draft.count >= MAX_STACKS;
  ui.builderStacks.replaceChildren(
    ...draft.stacks.slice(0, draft.count).map((q, i) => {
      const col = document.createElement('div');
      col.className = 'stack';
      const num = document.createElement('b');
      num.textContent = String(i + 1);
      const pinButton = (part: 'driver' | 'key') => {
        const type = q[part];
        const typeName = part === 'driver' ? DRIVER_NAMES[q.driver] : KEY_NAMES[q.key];
        const b = document.createElement('button');
        b.type = 'button';
        b.classList.toggle('security', type !== 'standard');
        b.classList.toggle('key-pin', part === 'key');
        // A key pin left to chance is drawn at a middling length.
        const keyLen = GEO.keyLenBase + GEO.keyLenStep * ((q.length ?? 5) - 1);
        const art =
          part === 'driver'
            ? pinArt('driver', driverProfile(q.driver, DRIVER_LEN), DRIVER_LEN)
            : pinArt('key', keyOutline(q.key, keyLen), keyLen);
        const what = document.createElement('small');
        what.textContent = part === 'driver' ? 'Driver' : 'Key pin';
        const name = document.createElement('span');
        name.textContent = typeName;
        b.append(art, what, name);
        b.title = `Stack ${i + 1} ${part === 'driver' ? 'driver' : 'key pin'}: ${typeName}. Click for the next type.`;
        b.addEventListener('click', () => {
          if (part === 'driver') q.driver = DRIVER_TYPES[(DRIVER_TYPES.indexOf(q.driver) + 1) % DRIVER_TYPES.length];
          else q.key = KEY_TYPES[(KEY_TYPES.indexOf(q.key) + 1) % KEY_TYPES.length];
          renderBuilder();
          // The column was rebuilt: put the focus back on the same pin.
          const again = ui.builderStacks.children[i]?.querySelectorAll('button')[part === 'driver' ? 0 : 1];
          (again as HTMLButtonElement | undefined)?.focus();
        });
        return b;
      };
      // With nine drivers to choose from, a list is quicker than clicking round them.
      const driverLabel = document.createElement('label');
      const driverSelect = document.createElement('select');
      driverSelect.title = `Stack ${i + 1} driver`;
      for (const t of DRIVER_TYPES) driverSelect.add(new Option(DRIVER_NAMES[t], t));
      driverSelect.value = q.driver;
      driverSelect.addEventListener('change', () => {
        q.driver = driverSelect.value as DriverType;
        renderBuilder();
        ui.builderStacks.children[i]?.querySelector('select')?.focus();
      });
      driverLabel.append(driverSelect);
      // Key pin length: sets how deep this stack's cut is.
      const lengthLabel = document.createElement('label');
      const select = document.createElement('select');
      select.title = `Stack ${i + 1} key pin length: 1 is the shortest, ${KEY_LENGTHS} the longest`;
      select.add(new Option('Random', ''));
      for (let len = 1; len <= KEY_LENGTHS; len++) select.add(new Option(String(len), String(len)));
      select.value = q.length ? String(q.length) : '';
      select.addEventListener('change', () => {
        q.length = select.value ? Number(select.value) : undefined;
        renderBuilder();
        ui.builderStacks.children[i]?.querySelectorAll('select')[1]?.focus();
      });
      lengthLabel.append('Length', select);
      col.append(num, pinButton('driver'), driverLabel, pinButton('key'), lengthLabel);
      return col;
    }),
  );
}

function openBuilder() {
  draft.count = design.count;
  draft.countermilled = design.countermilled;
  draft.stacks = design.stacks.map((q) => ({ ...q }));
  built = false;
  renderBuilder();
  ui.chooser.close();
  ui.builder.showModal();
  ui.builderGo.focus();
}

ui.builderLess.addEventListener('click', () => {
  draft.count = Math.max(1, draft.count - 1);
  renderBuilder();
});
ui.builderMore.addEventListener('click', () => {
  draft.count = Math.min(MAX_STACKS, draft.count + 1);
  renderBuilder();
});
for (const b of ui.builder.querySelectorAll<HTMLButtonElement>('[data-all]')) {
  b.addEventListener('click', () => {
    for (const q of draft.stacks) q.key = b.dataset.type as KeyPinType;
    renderBuilder();
  });
}
ui.builderAllDrivers.add(new Option('Choose…', ''));
for (const t of DRIVER_TYPES) ui.builderAllDrivers.add(new Option(DRIVER_NAMES[t], t));
ui.builderAllDrivers.addEventListener('change', () => {
  const t = ui.builderAllDrivers.value as DriverType | '';
  if (t) for (const q of draft.stacks) q.driver = t;
  ui.builderAllDrivers.value = '';
  renderBuilder();
});
ui.builderCountermill.addEventListener('change', () => {
  draft.countermilled = ui.builderCountermill.checked;
});
ui.builderRandom.addEventListener('click', () => {
  for (const q of draft.stacks) q.length = undefined;
  renderBuilder();
});
$('builder-cancel').addEventListener('click', () => ui.builder.close());
ui.builderGo.addEventListener('click', () => {
  design.count = draft.count;
  design.countermilled = draft.countermilled;
  design.stacks = draft.stacks.map((q) => ({ ...q }));
  try {
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(design));
  } catch {
    // Not saved; the lock still works for this visit.
  }
  const preset = designPreset();
  LOCKS[CUSTOM].name = preset.name;
  LOCKS[CUSTOM].description = preset.description;
  customName.textContent = preset.name;
  customText.textContent = preset.description;
  built = true;
  ui.builder.close();
  presetIndex = CUSTOM;
  loadLock(true);
});
// Backing out of the builder, by Cancel or Escape, returns to the list of locks.
ui.builder.addEventListener('close', () => {
  if (!built) openChooser();
});

// In the chooser: the lock as last built, and the way into the builder.
const customName = document.createElement('b');
const customText = document.createElement('span');
{
  const section = document.createElement('section');
  const h = document.createElement('h3');
  h.textContent = 'Build your own';
  const grid = document.createElement('div');
  grid.className = 'lock-grid';
  const pickIt = document.createElement('button');
  pickIt.type = 'button';
  customName.textContent = LOCKS[CUSTOM].name;
  customText.textContent = LOCKS[CUSTOM].description;
  pickIt.append(customName, customText);
  pickIt.addEventListener('click', () => {
    presetIndex = CUSTOM;
    ui.chooser.close();
    loadLock(true);
  });
  lockButtons[CUSTOM] = pickIt;
  const build = document.createElement('button');
  build.type = 'button';
  build.className = 'build';
  const buildName = document.createElement('b');
  buildName.textContent = 'Build a lock…';
  const buildText = document.createElement('span');
  buildText.textContent =
    'Choose how many pin stacks it has, up to seven, which key pin and driver go in each, and how long each key pin is.';
  build.append(buildName, buildText);
  build.addEventListener('click', openBuilder);
  grid.append(build, pickIt);
  section.append(h, grid);
  ui.chooserList.append(section);
}

function openChooser() {
  if (ui.chooser.open) return;
  ui.chooser.showModal();
  ui.chooserList.scrollTop = 0;
  lockButtons[presetIndex].focus();
}
ui.chooseLock.addEventListener('click', openChooser);
$('chooser-close').addEventListener('click', () => ui.chooser.close());

function loadLock(newSeed: boolean) {
  if (newSeed) seed = Math.floor(Math.random() * 1e6) + 1;
  spec = LOCKS[presetIndex].make(seed);
  ui.lockName.textContent = LOCKS[presetIndex].name;
  lockButtons.forEach((b, i) => b.classList.toggle('current', i === presetIndex));
  turn.gripping = false;
  if (spec.kind === 'disc') {
    pinSim = null;
    discSim = new DiscSim(spec);
    target.x = pick.x = -8e-3;
    target.y = pick.y = 0;
    view.setDiscLock(spec);
    ui.pinDots.replaceChildren(
      ...spec.discs.map((_, i) => {
        const dot = document.createElement('span');
        dot.title = `Disc ${i + 1}`;
        return dot;
      }),
    );
    lessonState.pins = spec.discs.map((_, i) => ({
      label: String(i + 1),
      row: 'top',
      part: 'solid',
      spool: false,
      serratedDriver: false,
      serratedKey: false,
      status: 'free',
      touched: false,
    }));
  } else {
    const s = spec;
    discSim = null;
    if (hooked(s.kind)) s.pick = PIN_PICKS[activeTool('pick') ?? 'hook'] ?? HOOK_PICK;
    pinSim = new LockSim(s);
    // Each lock type has its own tool: start it withdrawn and lowered.
    target.x = pick.x = s.pick.minX;
    target.y = pick.y = s.pick.minY;
    view.setLock(s);
    ui.pinDots.replaceChildren(
      ...s.pins.map((p, i) => {
        const dot = document.createElement('span');
        // A gap in the row of dots where the side row starts,
        // and between chambers when each chamber holds two stacks.
        const prev = s.pins[i - 1];
        if (prev && (p.row !== prev.row || (p.part === 'outer' && p.chamber !== prev.chamber)))
          dot.dataset.rowStart = '';
        dot.title = `${s.kind === 'wafer' ? 'Wafer' : 'Pin'} ${p.label}`;
        return dot;
      }),
    );
    lessonState.pins = s.pins.map((p) => ({
      label: p.label,
      row: p.row,
      part: p.part,
      spool: isTrapDriver(p.driver),
      serratedDriver: p.driver === 'serrated',
      serratedKey: p.keyPin === 'serrated',
      status: 'free',
      touched: false,
    }));
  }
  const disc = spec.kind === 'disc';
  ui.lessonTitle.textContent = spec.name;
  ui.lessonText.textContent = spec.description;
  ui.forceLabel.textContent = disc ? 'Pick torque' : 'Pick force';
  ui.pinsLabel.textContent = disc ? 'Discs' : spec.kind === 'wafer' ? 'Wafers' : 'Pins';
  ui.legendOverset.textContent = disc ? 'false gate' : 'overset';
  ui.helpMouse.textContent = disc ? 'Move the pick · hold and drag up to turn a disc' : 'Move the pick';
  // Only pin tumbler locks have a choice of tool.
  ui.helpToolKey.hidden = ui.helpTool.hidden = !hooked(spec.kind);
  applyTools(false);
  ui.sideView.hidden = !view.hasSideRow || !ui.front.checked;
  resetState();
  say(
    disc
      ? 'Apply light tension, then try turning each disc. The one that feels stiff is binding.'
      : spec.kind === 'wafer'
        ? 'Apply light tension, then lift each wafer by the top edge of its window. The one that feels stiff is binding.'
        : 'Apply light tension, then probe each pin. The one that feels stiff is binding.',
  );
}

/** Reach for a pin tumbler pick by name, if it is in the case. */
function setTool(next: ToolId) {
  if (!owned.has(next) || !PIN_PICKS[next]) return;
  prefs.pick = next;
  saveCase();
  applyTools(true);
}

/** T: the next pin tumbler pick in the case. */
function nextTool() {
  const ids = TOOLS.filter((t) => PIN_PICKS[t.id] && owned.has(t.id)).map((t) => t.id);
  if (ids.length < 2) return;
  setTool(ids[(ids.indexOf(activeTool('pick')!) + 1) % ids.length]);
}

// --- Pick case -----------------------------------------------------------------
// The tools you own. Each lock takes the pick and tension tool from the case
// that fit it; a lock nothing in the case fits cannot be picked.
type ToolId = 'hook' | 'deep' | 'diamond' | 'rake' | 'snake' | 'flag' | 'disc' | 'bok' | 'tok';
type ToolGroup = 'pick' | 'tension';
interface Tool {
  id: ToolId;
  group: ToolGroup;
  name: string;
  fits: Array<LockEntry['kind']>;
  /** Flat outline, lying down, used only if the 3D miniature cannot be drawn. */
  icon: string;
  /** Said when a pin tumbler pick is taken in hand. */
  how?: string;
}
const TOOLS: Tool[] = [
  {
    id: 'hook',
    group: 'pick',
    name: 'Short hook',
    fits: ['pin', 'wafer'],
    icon: 'M3 12 H54 Q59 12 59 5',
    how: 'One pin at a time. Anything already set is still set.',
  },
  {
    id: 'deep',
    group: 'pick',
    name: 'Deep hook',
    fits: ['pin', 'wafer'],
    icon: 'M3 14 H54 Q59 14 59 3',
    how: 'One pin at a time, with a taller tip: the shaft stays further from the front pins when a back pin has to go high. It is a tight fit: resting on the keyway floor its tip already lifts every pin a little.',
  },
  {
    id: 'diamond',
    group: 'pick',
    name: 'Half-diamond',
    fits: ['pin', 'wafer'],
    icon: 'M3 13 H46 L54 5 L62 13',
    how: 'Lift one pin on its point, or slide it in and out so its slopes ride under the pins like a rake.',
  },
  {
    id: 'rake',
    group: 'pick',
    name: 'Triple-peak rake',
    fits: ['pin', 'wafer'],
    icon: 'M3 12 H34 Q38 12 40 7 Q42 2 44 7 Q46 12 48 7 Q50 2 52 7 Q54 12 56 7 Q58 2 60 7',
    how: 'Hold moderate tension, slide it under the pins and scrub in and out while slowly raising and lowering it. Too little tension and it knocks set pins back out; too much and it cannot lift the binding pin.',
  },
  {
    id: 'snake',
    group: 'pick',
    name: 'Snake rake',
    fits: ['pin', 'wafer'],
    icon: 'M3 12 H30 Q36 12 39 8 Q42 4 46 8 Q50 12 54 8 Q57 4 61 8',
    how: 'A gentler rake: scrub in and out under moderate tension. Its low, long waves are kinder to set pins but do not reach as high.',
  },
  { id: 'flag', group: 'pick', name: 'Dimple flag', fits: ['dimple'], icon: 'M3 12 H60 M55 12 V5 H59 V12' },
  { id: 'disc', group: 'pick', name: 'Disc detainer pick', fits: ['disc'], icon: 'M3 9 H56 M56 3 V15 M10 4 V14' },
  { id: 'bok', group: 'tension', name: 'Bottom of keyway', fits: ['pin', 'wafer'], icon: 'M8 2 V14 H40' },
  { id: 'tok', group: 'tension', name: 'Top of keyway', fits: ['pin', 'dimple', 'wafer'], icon: 'M8 16 V4 H24' },
];
/** The picks that work a pin tumbler lock, and the tool each one is. */
const PIN_PICKS: Partial<Record<ToolId, PickSpec>> = {
  hook: HOOK_PICK,
  deep: DEEP_HOOK_PICK,
  diamond: DIAMOND_PICK,
  rake: RAKE_PICK,
  snake: SNAKE_PICK,
};
/** The first case had only these; anything newer starts out in the case. */
const FIRST_TOOLS: ToolId[] = ['hook', 'rake', 'flag', 'disc', 'bok', 'tok'];
const CASE_KEY = 'lockpick.case';

const owned = new Set<ToolId>(TOOLS.map((t) => t.id));
/** Which tool to reach for when more than one in the case fits. */
const prefs: Record<ToolGroup, ToolId> = { pick: 'hook', tension: 'bok' };
let editingCase = false;
/** Rolled up, the case shows only what is in hand. */
let caseRolled = false;
try {
  const saved = JSON.parse(localStorage.getItem(CASE_KEY) ?? 'null');
  if (saved && Array.isArray(saved.owned)) {
    caseRolled = saved.rolled === true;
    owned.clear();
    const known: ToolId[] = Array.isArray(saved.known) ? saved.known : FIRST_TOOLS;
    for (const t of TOOLS) if (saved.owned.includes(t.id) || !known.includes(t.id)) owned.add(t.id);
    for (const g of ['pick', 'tension'] as const) {
      if (TOOLS.some((t) => t.id === saved[g] && t.group === g)) prefs[g] = saved[g];
    }
  }
} catch {
  // Storage unavailable or unreadable: start with a full case.
}
function saveCase() {
  try {
    localStorage.setItem(
      CASE_KEY,
      JSON.stringify({
        owned: [...owned],
        known: TOOLS.map((t) => t.id),
        rolled: caseRolled,
        ...prefs,
      }),
    );
  } catch {
    // Not saved; the case still works for this visit.
  }
}

/** The tool from the case in use on the current lock, or null if none fits. */
function activeTool(group: ToolGroup): ToolId | null {
  const kind = LOCKS[presetIndex].kind;
  const fit = TOOLS.filter((t) => t.group === group && t.fits.includes(kind) && owned.has(t.id));
  return (fit.find((t) => t.id === prefs[group]) ?? fit[0])?.id ?? null;
}

/** A disc detainer pick tensions the core itself; other locks need a wrench. */
const canTension = () => activeTool(discSim ? 'pick' : 'tension') !== null;

/** Lowest the tip of the pick can go where it is: not through the keyway floor or a wrench lying on it. */
function pickFloor() {
  if (spec.kind === 'disc') return 0;
  return pickMinY(spec.pick, pick.x, spec.geo, spec.wrench);
}

const caseButtons = new Map<ToolId, HTMLButtonElement>();
const thumbs = renderToolThumbs();
/** Tool the pointer or keyboard focus is on, named under the case. */
let caseHover: Tool | null = null;
for (const t of TOOLS) {
  const b = document.createElement('button');
  b.type = 'button';
  if (thumbs) {
    const img = document.createElement('img');
    img.src = thumbs[t.id];
    img.alt = '';
    img.draggable = false;
    b.append(img);
  } else {
    b.innerHTML = `<svg viewBox="-28 -3 40 124" aria-hidden="true"><path transform="rotate(90) scale(1.9)" d="${t.icon}"/></svg>`;
  }
  const name = document.createElement('span');
  name.textContent = t.name;
  b.append(name);
  const hover = (on: boolean) => () => {
    caseHover = on ? t : caseHover === t ? null : caseHover;
    renderCase();
  };
  b.addEventListener('pointerenter', hover(true));
  b.addEventListener('pointerleave', hover(false));
  b.addEventListener('focus', hover(true));
  b.addEventListener('blur', hover(false));
  b.addEventListener('click', () => {
    audio.unlock();
    if (editingCase) {
      if (owned.has(t.id)) owned.delete(t.id);
      else owned.add(t.id);
    } else {
      prefs[t.group] = t.id;
    }
    saveCase();
    applyTools(true);
    b.blur();
  });
  caseButtons.set(t.id, b);
  (t.group === 'pick' ? ui.casePicks : ui.caseTension).append(b);
}
ui.caseEdit.addEventListener('click', () => {
  editingCase = !editingCase;
  renderCase();
  ui.caseEdit.blur();
});

ui.caseRoll.addEventListener('click', () => {
  caseRolled = !caseRolled;
  if (caseRolled) editingCase = false;
  saveCase();
  renderCase();
  ui.caseRoll.blur();
});

function renderCase() {
  ui.case.classList.toggle('rolled', caseRolled);
  ui.caseRoll.textContent = caseRolled ? 'Unroll' : 'Roll up';
  ui.caseRoll.setAttribute('aria-expanded', String(!caseRolled));
  const kind = LOCKS[presetIndex].kind;
  const using = [activeTool('pick'), activeTool('tension')];
  ui.case.classList.toggle('editing', editingCase);
  ui.caseEdit.textContent = editingCase ? 'Done' : 'Edit';
  for (const t of TOOLS) {
    const b = caseButtons.get(t.id)!;
    const has = owned.has(t.id);
    const fits = t.fits.includes(kind);
    b.classList.toggle('missing', !has);
    b.classList.toggle('unfit', has && !fits && !editingCase);
    b.classList.toggle('active', has && !editingCase && using.includes(t.id));
    b.disabled = !editingCase && (!has || !fits);
    b.setAttribute('aria-pressed', String(editingCase ? has : using.includes(t.id)));
    b.title = editingCase
      ? has
        ? `${t.name}: in your case. Click to take it out.`
        : `${t.name}: not in your case. Click to add it.`
      : !has
        ? `${t.name}: not in your case`
        : fits
          ? t.name
          : `${t.name}: does not fit this lock`;
  }
  const nameOf = (id: ToolId | null) => TOOLS.find((t) => t.id === id)?.name;
  ui.caseUsing.textContent = caseHover
    ? `${caseHover.name}${
        !owned.has(caseHover.id)
          ? ' · not in your case'
          : caseHover.fits.includes(kind)
            ? ''
            : ' · does not fit this lock'
      }`
    : `In hand: ${using.map(nameOf).filter(Boolean).join(' + ') || 'nothing'}`;
  ui.caseNote.textContent = editingCase
    ? 'Click a tool to add it to your case or take it out.'
    : !using[0]
      ? 'No pick in your case fits this lock.'
      : !canTension()
        ? 'No tension tool in your case fits this lock.'
        : '';
}

/**
 * Put the case's tools for this lock in hand. Changing picks leaves the lock
 * as it is, so a few pins can be raked and the rest finished with the hook.
 */
function applyTools(announce: boolean) {
  const p = activeTool('pick');
  if (pinSim && spec.kind !== 'disc') {
    if (hooked(spec.kind)) {
      const pk = (p && PIN_PICKS[p]) || HOOK_PICK;
      if (spec.pick !== pk) {
        // The old tool comes out and the new one starts outside the keyway.
        target.x = pick.x = pk.minX;
        target.y = pick.y = pk.minY;
        pinSim.setPick(pk, pick.x, pick.y);
        view.setPick(pk);
        const t = TOOLS.find((q) => q.id === p);
        if (announce && t?.how) say(`${t.name}: ${t.how}`);
      }
    }
    spec.wrench = hooked(spec.kind) && activeTool('tension') === 'bok' ? bokWrench(spec.geo) : null;
    pick.y = Math.max(pick.y, pickFloor());
    pinInput.pickIn = p !== null;
    view.setWrench(activeTool('tension') as 'bok' | 'tok' | null);
  } else if (!p) {
    turn.gripping = false;
  }
  view.setPickVisible(p !== null);
  if (!canTension()) setTorque(0);
  ui.tension.disabled = !canTension();
  renderCase();
}

function resetLock() {
  sim().reset();
  turn.gripping = false;
  resetState();
  say('Lock reset. Same lock, same binding order.');
}

function resetState() {
  setTorque(0);
  displayTheta = 0;
  startTime = null;
  openHandled = false;
  ui.banner.hidden = true;
  ui.log.replaceChildren();
  startLesson();
}

// --- Guided lesson ---------------------------------------------------------------
function startLesson() {
  const id = LOCKS[presetIndex].id;
  const lesson =
    id === 'custom' ? customLesson(lessonState.pins, !!pinSim?.spec.countermill) : lessonFor(id);
  runner = lesson ? new LessonRunner(lesson) : null;
  shownStep = -1;
  showGuide();
}

/** The lesson replaces the lock's description in the panel while it is on. */
function showGuide() {
  const on = ui.guideOn.checked && runner !== null;
  ui.guide.hidden = !on;
  ui.lessonText.hidden = on;
}

function updateLesson(dt: number) {
  if (!runner) return;
  const s = sim();
  const st = lessonState;
  st.dt = dt;
  st.torque = torque;
  st.opened = s.opened;
  st.inFalseSet = s.inFalseSet;
  for (let i = 0; i < st.pins.length; i++) {
    st.pins[i].status = s.status(i);
    st.pins[i].touched = discSim
      ? turn.gripping && turn.disc === i
      : pinSim!.pickF[i] > 0.02;
  }
  runner.update(st);
  if (!ui.guideOn.checked) return;

  const steps = runner.lesson.steps;
  if (runner.index !== shownStep) {
    shownStep = runner.index;
    ui.guideSteps.replaceChildren(
      ...steps.map((step, i) => {
        const li = document.createElement('li');
        const title = document.createElement('b');
        title.textContent = step.title;
        li.append(title);
        if (i < shownStep) li.className = 'done';
        else if (i === shownStep) {
          li.className = 'current';
          const text = document.createElement('p');
          text.textContent = step.text;
          li.append(text);
          if (step.progress) {
            const prog = document.createElement('span');
            prog.className = 'step-progress';
            li.append(prog);
          }
        }
        return li;
      }),
    );
    if (runner.complete) {
      const li = document.createElement('li');
      li.className = 'finished';
      li.textContent = 'Lesson complete.';
      ui.guideSteps.append(li);
    }
    ui.guideProgress.textContent = runner.complete
      ? 'Done'
      : `Step ${shownStep + 1} of ${steps.length}`;
  }
  const step = steps[runner.index];
  if (step?.progress) {
    const prog = ui.guideSteps.querySelector('.current .step-progress');
    const text = step.progress(st);
    if (prog && prog.textContent !== text) prog.textContent = text;
  }
  const coach = runner.coach ?? '';
  if (ui.guideCoach.textContent !== coach) {
    ui.guideCoach.textContent = coach;
    ui.guideCoach.hidden = coach === '';
  }
}

function setTorque(t: number) {
  torque = canTension() ? Math.min(MAX_TORQUE, Math.max(0, t)) : 0;
  ui.tension.value = String(torque * 1000);
}

function say(text: string) {
  const li = document.createElement('li');
  li.textContent = text;
  ui.log.prepend(li);
  while (ui.log.children.length > 5) ui.log.lastElementChild!.remove();
}

function describe(e: SimEvent) {
  if (spec.kind === 'disc') return describeDisc(e);
  if (spec.kind === 'wafer') return describeWafer(e, e.pin >= 0 ? spec.pins[e.pin].label : '');
  const n = e.pin >= 0 ? spec.pins[e.pin].label : '';
  switch (e.type) {
    case 'set':
      return `Pin ${n} set. The plug turned a hair — find the next binding pin.`;
    case 'drop':
      return torque < 0.004
        ? `Pin ${n} dropped: not enough tension to hold it.`
        : `Pin ${n} dropped back.`;
    case 'overset':
      return `Pin ${n} is overset: its key pin is jammed across the shear line. Ease off tension until it falls.`;
    case 'falseSet':
      return 'False set: the plug turned several degrees but a security driver is caught by its waist. Push that pin gently while easing tension, and let the plug counter-rotate.';
    case 'open':
      return 'Every pin stack is split at the shear line. The plug is free to turn.';
  }
}

function describeWafer(e: SimEvent, n: string) {
  switch (e.type) {
    case 'set':
      return `Wafer ${n} is flush. The plug turned a hair — find the next binding wafer.`;
    case 'drop':
      return torque < 0.004
        ? `Wafer ${n} dropped: not enough tension to hold it.`
        : `Wafer ${n} dropped back.`;
    case 'overset':
      return `Wafer ${n} is lifted too far: its top end has caught in the housing. Ease off tension until it drops.`;
    case 'falseSet':
      return 'The plug has turned further than a set wafer allows, but is not open.';
    case 'open':
      return 'Every wafer is flush with the plug at both ends. The plug is free to turn.';
  }
}

function describeDisc(e: SimEvent) {
  const n = e.pin + 1;
  switch (e.type) {
    case 'set':
      return `Disc ${n}: its gate is under the sidebar. Find the next binding disc.`;
    case 'drop':
      return `Disc ${n} has turned off its gate.`;
    case 'overset':
      return `Disc ${n} is in a false gate: the sidebar has dropped part-way in and trapped it. Ease off tension, then turn it on to the true gate.`;
    case 'falseSet':
      return 'False set: the core turned a little because the sidebar is sitting in a false gate, not clear of the housing.';
    case 'open':
      return 'Every gate is under the sidebar. It has dropped clear of the housing and the core is free to turn.';
  }
}

// --- Input -------------------------------------------------------------------
/** Disc under the pick's tip, or -1 if it is between discs or outside the lock. */
function discUnderPick() {
  if (!discSim) return -1;
  const i = Math.round((pick.x - DISC.firstX) / DISC.pitch);
  if (i < 0 || i >= discSim.n) return -1;
  return Math.abs(pick.x - discX(i)) < DISC.pitch * 0.45 ? i : -1;
}

function onPointer(e: PointerEvent) {
  if (turn.gripping && discSim) {
    // Dragging up turns the gripped disc in the picking direction.
    turn.want = Math.min(
      DISC.maxAngle + 0.06,
      Math.max(-0.06, turn.startAngle + (turn.startY - e.clientY) * TURN_PER_PIXEL),
    );
    return;
  }
  const r = canvas.getBoundingClientRect();
  const p = view.pointerToLock(
    ((e.clientX - r.left) / r.width) * 2 - 1,
    -((e.clientY - r.top) / r.height) * 2 + 1,
  );
  if (!p) return;
  if (spec.kind === 'disc') {
    target.x = Math.min(discX(spec.discs.length - 1) + 0.6e-3, Math.max(-8e-3, p.x));
    return;
  }
  const maxX = Math.max(...spec.pins.map((q) => q.x)) + 2.2e-3;
  const pk = spec.pick;
  target.x = Math.min(maxX, Math.max(pk.minX, p.x));
  target.y = Math.min(pk.maxY, Math.max(pk.minY, p.y));
}

function gripDisc(i: number, clientY: number) {
  if (!discSim || i < 0 || i >= discSim.n || !activeTool('pick')) return false;
  turn.gripping = true;
  turn.disc = i;
  turn.startAngle = turn.want = turn.angle = discSim.phi[i];
  turn.startY = clientY;
  return true;
}

canvas.addEventListener('pointermove', onPointer);
canvas.addEventListener('pointerdown', (e) => {
  audio.unlock();
  onPointer(e);
  if (e.button === 0 && discSim && gripDisc(discUnderPick(), e.clientY)) {
    canvas.setPointerCapture(e.pointerId);
  }
});
const release = () => {
  turn.gripping = false;
};
canvas.addEventListener('pointerup', release);
canvas.addEventListener('pointercancel', release);
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    audio.unlock();
    const notches = e.deltaMode === 1 ? e.deltaY / 3 : e.deltaY / 100;
    setTorque(torque - notches * 0.002);
  },
  { passive: false },
);

// Welcome window, shown each time the page loads. While it is up the lock
// ignores the keyboard (a modal dialog already blocks the mouse).
const welcome = $('welcome') as HTMLDialogElement;
$('welcome-start').addEventListener('click', () => {
  audio.unlock();
  welcome.close();
});
// Closing the welcome, by the button or Escape, leads on to choosing a lock.
welcome.addEventListener('close', openChooser);
welcome.showModal();

window.addEventListener('keydown', (e) => {
  if (welcome.open || ui.chooser.open || ui.builder.open) return;
  if (e.target instanceof HTMLSelectElement || e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key.toLowerCase();
  audio.unlock();
  if (k === ' ') {
    e.preventDefault();
    setTorque(0);
  } else if (k === 'r') resetLock();
  else if (k === 'n') loadLock(true);
  else if (k === 't') nextTool();
  else if (k === 'c') view.resetCamera(spec);
  else if (k === '+' || k === '=') view.zoom(0.9);
  else if (k === '-' || k === '_') view.zoom(1.1);
  else {
    if (k.startsWith('arrow')) e.preventDefault();
    keys.add(k);
  }
});
window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
window.addEventListener('blur', () => keys.clear());
window.addEventListener('resize', () => view.resize());
// The top bar wraps onto more lines in a narrow window; keep the panels below it.
// Likewise the gauges and the pick case at the bottom.
const chrome: Array<[string, HTMLElement]> = [
  ['--bar-h', document.querySelector<HTMLElement>('.bar')!],
  ['--foot-h', document.querySelector<HTMLElement>('.gauges')!],
  ['--case-h', ui.case],
];
const fitChrome = () => {
  for (const [name, el] of chrome)
    document.documentElement.style.setProperty(name, `${el.offsetHeight}px`);
};
const chromeWatch = new ResizeObserver(fitChrome);
for (const [, el] of chrome) chromeWatch.observe(el);
fitChrome();

ui.tension.addEventListener('input', () => {
  audio.unlock();
  torque = Number(ui.tension.value) / 1000;
});
ui.view.addEventListener('change', () => {
  view.setMode(ui.view.value as ViewMode);
  view.resetCamera(spec);
  ui.view.blur();
});
ui.hints.addEventListener('change', () => {
  document.body.classList.toggle('nohints', !ui.hints.checked);
});
ui.sound.addEventListener('change', () => {
  audio.enabled = ui.sound.checked;
  audio.unlock();
});
view.frontEl = ui.frontView;
view.sideEl = ui.sideView;
ui.front.addEventListener('change', () => {
  ui.frontView.hidden = !ui.front.checked;
  ui.sideView.hidden = !view.hasSideRow || !ui.front.checked;
});
$('retry').addEventListener('click', resetLock);
$('newlock').addEventListener('click', () => loadLock(true));
$<HTMLButtonElement>('reset-camera').addEventListener('click', (e) => {
  view.resetCamera(spec);
  (e.currentTarget as HTMLButtonElement).blur();
});
$('open-retry').addEventListener('click', resetLock);
$('open-new').addEventListener('click', () => loadLock(true));
ui.openNext.addEventListener('click', () => {
  if (presetIndex >= CUSTOM - 1) return;
  presetIndex++;
  loadLock(true);
});
ui.guideOn.addEventListener('change', () => {
  shownStep = -1;
  showGuide();
});

// --- Frame loop --------------------------------------------------------------
const pinInput: SimInput = { torque: 0, pickX: 0, pickY: 0, pickIn: true };
const discInput: DiscInput = { torque: 0, pickDisc: -1, pickAngle: 0 };
let last = performance.now();

function frame(now: number) {
  const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000));
  last = now;
  tick(dt, now);
  requestAnimationFrame(frame);
}

function tick(dt: number, now: number) {
  if (keys.has('w') || keys.has('arrowup')) setTorque(torque + KEY_TENSION_RATE * dt);
  if (keys.has('s') || keys.has('arrowdown')) setTorque(torque - KEY_TENSION_RATE * dt);

  // The hand has a top speed: the pick eases toward the pointer.
  const dx = target.x - pick.x;
  const dy = target.y - pick.y;
  const dist = Math.hypot(dx, dy);
  const maxStep = PICK_SPEED * dt;
  const f = dist > maxStep ? maxStep / dist : 1;
  const toY = pick.y + dy * f;
  // A hook's tip stops against the side of a pin; it only lifts from below.
  pick.x = pinSim ? pinSim.blockPick(pick.x, pick.y, pick.x + dx * f, toY) : pick.x + dx * f;
  pick.y = toY;
  // The pick rests on the keyway floor and rides up over a wrench, never through them.
  if (pinSim) pick.y = Math.max(pick.y, pickFloor());
  if (torque > 0 && startTime === null) startTime = now;

  let events: SimEvent[];
  if (discSim) {
    // Likewise the wrist: the twist eases toward what the drag asks for.
    const da = turn.want - turn.angle;
    turn.angle += Math.sign(da) * Math.min(Math.abs(da), TURN_SPEED * dt);
    discInput.torque = torque;
    discInput.pickDisc = turn.gripping ? turn.disc : -1;
    discInput.pickAngle = turn.angle;
    events = discSim.step(dt, discInput);
  } else {
    pinInput.torque = torque;
    pinInput.pickX = pick.x;
    pinInput.pickY = pick.y;
    events = pinSim!.step(dt, pinInput);
  }
  for (const e of events) {
    audio.play(e);
    if (ui.hints.checked || e.type === 'open') say(describe(e));
  }

  const s = sim();
  if (s.opened) {
    displayTheta += (Math.PI / 2 - displayTheta) * Math.min(1, dt * 5);
    if (!openHandled) {
      openHandled = true;
      const secs = startTime === null ? 0 : (now - startTime) / 1000;
      ui.openStats.textContent = `${spec.name.replace(/^\d+ · /, '')} picked in ${secs.toFixed(1)} s`;
      ui.openNext.hidden = presetIndex >= CUSTOM - 1;
      ui.banner.hidden = false;
    }
  } else {
    displayTheta = s.theta;
  }

  if (discSim) {
    // The paddle sits in the slot of whichever disc it is in, turned with it.
    const under = turn.gripping ? turn.disc : discUnderPick();
    const paddle = under >= 0 ? discSim.phi[under] : 0;
    view.syncDisc(discSim, pick.x, paddle, torque, displayTheta, ui.hints.checked, dt);
  } else {
    if (ui.hints.checked) checkStall(dt);
    view.sync(pinSim!, pick.x, pick.y, torque, displayTheta, ui.hints.checked, dt);
  }
  updateLesson(dt);
  updateHud();
}

/**
 * With many pins set, several drivers can be resting on the edge of the plug
 * at once, and their springs together hold it back: nothing binds, yet the
 * lock is not open. Point that out once it has lasted a moment.
 */
function checkStall(dt: number) {
  const s = pinSim!;
  let set = 0;
  let active = 0;
  for (let i = 0; i < s.n; i++) {
    const st = s.status(i);
    if (st === 'set') set++;
    else if (st !== 'free') active++;
  }
  const stalled =
    !s.opened && !s.inFalseSet && torque > 0.002 && active === 0 && set > 0 && s.totalPickForce === 0;
  stallTime = stalled ? stallTime + dt : 0;
  if (!stalled) stallSaid = false;
  else if (stallTime > 1.5 && !stallSaid) {
    stallSaid = true;
    say('Nothing is binding: the springs of the pins you have set are holding the plug back. Add a little tension.');
  }
}

function updateHud() {
  const s = sim();
  const mNm = torque * 1000;
  ui.tensionVal.textContent = `${mNm.toFixed(1)} mN·m`;
  const force = s.totalPickForce;
  if (discSim) {
    ui.forceVal.textContent = `${(force * 1000).toFixed(1)} mN·m`;
    ui.forceBar.style.width = `${Math.min(100, (force / 0.03) * 100)}%`;
  } else {
    ui.forceVal.textContent = `${force.toFixed(1)} N`;
    ui.forceBar.style.width = `${Math.min(100, (force / 6) * 100)}%`;
  }
  const deg = (displayTheta * 180) / Math.PI;
  ui.rotVal.textContent = `${deg.toFixed(2)}°`;
  ui.frontDeg.textContent = `${deg.toFixed(2)}°`;
  ui.rotBar.style.width = `${Math.min(100, (deg / 6) * 100)}%`;

  let set = 0;
  for (let i = 0; i < s.n; i++) {
    const st = s.opened ? 'set' : s.status(i);
    if (st === 'set') set++;
    const dot = ui.pinDots.children[i] as HTMLElement;
    if (dot.className !== st) dot.className = st;
  }
  const noun = discSim ? 'discs' : spec.kind === 'wafer' ? 'wafers' : 'pins';
  ui.pinsVal.textContent = ui.hints.checked ? `${set} / ${s.n} set` : `${s.n} ${noun}`;
}

// Expose for debugging and automated checks.
Object.assign(window, {
  __lock: {
    view,
    get sim() {
      return sim();
    },
    get lesson() {
      return runner;
    },
    GEO,
    target,
    setTorque,
    setTool,
    tick,
    // Disc locks: grip a disc and ask for a twist, as a drag would.
    gripDisc: (i: number) => {
      target.x = pick.x = discX(i);
      return gripDisc(i, 0);
    },
    turnTo: (angle: number) => {
      turn.want = angle;
    },
    release,
  },
});

loadLock(false);
requestAnimationFrame(frame);
