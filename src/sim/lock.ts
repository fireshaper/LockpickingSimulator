// Lock definition: geometry constants, pin profiles and lock generation.
// All lengths are in metres (SI) so the physics can use them directly.
// The renderer multiplies by 1000 and works in millimetres.

export type DriverType =
  | 'standard'
  | 'spool'
  | 'serrated'
  | 'spoolerrated'
  | 'mushroom'
  | 'doubleMushroom'
  | 'barrel'
  | 'gin'
  | 'tree';

/** Every driver, in the order a builder is offered them. */
export const DRIVER_TYPES: DriverType[] = [
  'standard',
  'spool',
  'serrated',
  'spoolerrated',
  'mushroom',
  'doubleMushroom',
  'barrel',
  'gin',
  'tree',
];
export const DRIVER_NAMES: Record<DriverType, string> = {
  standard: 'Standard',
  spool: 'Spool',
  serrated: 'Serrated',
  spoolerrated: 'Spool-errated',
  mushroom: 'Mushroom',
  doubleMushroom: 'Double mushroom',
  barrel: 'Barrel',
  gin: 'Gin',
  tree: 'Tree',
};
/**
 * Drivers with a waist: under tension the plug turns into it and the pin is
 * trapped in a false set until it is eased back out.
 */
export const isTrapDriver = (t: DriverType) => t !== 'standard' && t !== 'serrated';
export type KeyPinType = 'standard' | 'serrated';

/** Piecewise-linear profile: [axial position, radial reduction] pairs. */
export type Profile = ReadonlyArray<readonly [number, number]>;

export type PinRow = 'top' | 'side';

/**
 * A telescoping chamber holds two stacks: a hollow outer pin and an inner pin
 * sliding inside it. Each has its own key pin, driver, spring and shear point,
 * and both must be set before the chamber stops blocking the plug.
 */
export type PinPart = 'solid' | 'outer' | 'inner';

export const TELESCOPE = {
  boreR: 0.8e-3,
  innerR: 0.72e-3,
  // The pick's tip fits inside the outer pin's bore: centred on the chamber it
  // lifts only the inner pin; moved off-centre it catches the outer pin's rim.
  innerReach: 0.8e-3,
  innerHalfW: 0.2e-3,
  innerSlope: 2.5,
  outerReach: 1.75e-3,
  outerNear: 0.9e-3,
  outerFar: 1.4e-3,
  outerNearSlope: 3,
  /** How far off-centre to put the tip to work the outer pin. */
  outerOffset: 1.1e-3,
} as const;

export interface PinSpec {
  row: PinRow;
  part: PinPart;
  /** Chamber number as shown on the lock, and a name for messages. */
  chamber: number;
  label: string;
  /** Where along the keyway the pick engages this stack best, relative to x. */
  pickOffset: number;
  /** Position along the keyway, from the lock face. */
  x: number;
  /**
   * Direction of the pin's axis, as a rotation about the keyway axis: 0 is the
   * top row (pins move up to set), a quarter turn is a side row (pins move
   * sideways, away from the camera in the cutaway view).
   */
  angle: number;
  /** Where the key pin's tip rests along its axis, measured from the plug centre. */
  floor: number;
  /** Key (bottom) pin length. */
  keyLen: number;
  /** Bitting depth code 0-9 that produced keyLen. */
  bitting: number;
  keyPin: KeyPinType;
  /** Radial profile of the key pin, measured downward from its top face. */
  keyProfile: Profile;
  driver: DriverType;
  driverLen: number;
  /** Radial profile of the driver, measured upward from its bottom face. */
  profile: Profile;
  /**
   * Manufacturing tolerance: how far the plug surface can travel (arc length)
   * before a full-diameter pin in this chamber gets pinched at the shear line.
   * The pin with the smallest clearance binds first.
   */
  clearance: number;
  springK: number;
  springFree: number;
  /**
   * A wafer: one flat plate in place of a key pin and driver. It blocks the
   * plug while either end sticks out of it, so it has to be lifted until it is
   * flush at both ends, no less and no more. Its top is where a driver's
   * bottom would be, and `keyLen` is how far below that the pick bears on it.
   */
  wafer?: boolean;
  /** Half-width of the surface the pick bears on, and how much its edge is relieved. */
  tipR: number;
  tipRise: number;
}

export type LockKind = 'pin' | 'dimple' | 'wafer';

export interface LockGeometry {
  plugR: number;
  shearY: number;
  floorY: number;
  chamberTopY: number;
  pinR: number;
  chamberR: number;
  pitch: number;
  firstPinX: number;
  tailLen: number;
  housingR: number;
  bibleHalfW: number;
  bibleTopY: number;
  keywayHalfW: number;
  keywayBottomY: number;
  keywayTopY: number;
  springSolid: number;
  /** Key pin length for bitting code 0, and the increment per code. */
  keyLenBase: number;
  keyLenStep: number;
  bittingCount: number;
  /** Height of a spool driver's bottom flange. */
  spoolFlange: number;
  /** Side-row equivalents of floorY and keyLenBase. */
  sideFloor: number;
  sideKeyLenBase: number;
  /** Wafer locks: how far a wafer sticks out of the plug at rest, and can be pushed out the far side. */
  waferTravel: number;
}

/**
 * The picking tool. A hook is levered up and down in a tall keyway; a flag is
 * a small tab on a round shaft that is twisted to swing its tip up into a pin;
 * a rake is a wavy blade scrubbed in and out under several pins at once.
 */
export interface PickSpec {
  kind: 'hook' | 'diamond' | 'flag' | 'rake';
  name: string;
  tipHalfW: number;
  tipReach: number;
  tipSlope: number;
  /** Half-diamond only: how far its steep front face runs ahead of the point. */
  tipFront: number;
  minX: number;
  minY: number;
  maxY: number;
  /** Hook only: tip height above the shaft, shaft set-back and hand pivot. */
  hookH: number;
  shaftBack: number;
  pivotX: number;
  pivotY: number;
  /** Flag only: height of the shaft axis and length of the flag from it. */
  shaftY: number;
  flagLen: number;
  /** Rake only: height of its peaks above its valleys, their spacing and number. */
  rakeAmp: number;
  rakePitch: number;
  rakePeaks: number;
  /** Stiffness of the tool and the grip on it, and the most force the hand
   *  puts through it onto one pin. */
  handK: number;
  maxForce: number;
}

export interface LockSpec {
  kind: LockKind;
  name: string;
  description: string;
  pins: PinSpec[];
  plugLen: number;
  seed: number;
  geo: LockGeometry;
  pick: PickSpec;
  /** A tension tool lying in the bottom of the keyway, in the pick's way. */
  wrench?: WrenchSpec | null;
}

/** The blade of a bottom-of-keyway tension tool, as the pick meets it. */
export interface WrenchSpec {
  /** It runs from the elbow in front of the lock's face to this far inside. */
  front: number;
  reach: number;
  /** Height of its top face. */
  top: number;
}

/** Bottom-of-keyway wrench: how far in its blade goes, and how thick it is. */
export const BOK_WRENCH = { front: -2.3e-3, reach: 2.5e-3, thick: 1.0e-3 };
export const bokWrench = (geo: LockGeometry): WrenchSpec => ({
  front: BOK_WRENCH.front,
  reach: BOK_WRENCH.reach,
  top: geo.keywayBottomY + BOK_WRENCH.thick,
});

/** Height of a hook's shaft and a rake's blade, top edge to bottom edge. */
export const SHAFT_T = 1.0e-3;
export const RAKE_T = 0.95e-3;
/** Steepest the shaft can be tilted to clear the wrench (rise over run). */
const MAX_TILT = 0.7;
/** The pick starts to lift this far before it reaches the wrench. */
const LIFT_RAMP = 1.5e-3;

/** The hand settles into levering over this much travel past the fulcrum. */
const LEVER_BLEND = 4e-3;

/**
 * Height of the hand end of a hook's shaft. Outside the lock the shaft runs
 * from the hand's resting point to just behind the tip. Inside, the picker
 * levers it: the shaft rests on the keyway floor at the face of the lock, or
 * on the inner end of a wrench lying there, and the hand drops as the tip
 * rises. That keeps the shaft as far below the other pins as it can be.
 */
export function shaftPivotY(pick: PickSpec, baseX: number, baseY: number, w?: WrenchSpec | null) {
  // The edge the shaft bears on, and the height it has to pass that edge at.
  const fx = w ? (baseX > w.reach ? w.reach : w.front) : 0;
  const fy = (w ? w.top : GEO.keywayBottomY) + SHAFT_T;
  if (baseX <= fx) return pick.pivotY;
  const tilt = Math.min(MAX_TILT, (baseY - fy) / (baseX - fx));
  const lever = baseY + tilt * (pick.pivotX - baseX);
  const t = Math.min(1, (baseX - fx) / LEVER_BLEND);
  const pivotY = pick.pivotY + (lever - pick.pivotY) * t * t * (3 - 2 * t);
  // Easing in must never put the shaft through the edge it bears on.
  const at = pivotY + ((baseY - pivotY) * (fx - pick.pivotX)) / (baseX - pick.pivotX);
  return at < fy ? lever : pivotY;
}

/**
 * Lowest the pick's tip can be with its tip at `tipX` along the keyway.
 * Outside the lock that is the tool's own limit. Inside, the part of the tool
 * under the tip has to sit on or above the keyway floor. Over a wrench the
 * whole tip has to clear that too; just past the wrench the shaft still has
 * to, which the hand can only help so much by tilting the pick.
 */
export function pickMinY(pick: PickSpec, tipX: number, geo: LockGeometry, w?: WrenchSpec | null) {
  if (pick.kind === 'flag') return pick.minY;
  const rake = pick.kind === 'rake';
  // Height of the tool from its lowest edge to the top of its tip.
  const tall = rake ? RAKE_T + pick.rakeAmp : SHAFT_T + pick.hookH;
  // (A rake's strip has a rounded end a little beyond where its top edge stops.)
  const nose = tipX + (rake ? pick.tipReach + 0.5e-3 : pick.kind === 'diamond' ? pick.tipFront + 0.3e-3 : 0.6e-3);
  // The pick starts to lift a little before the edge it has to climb over.
  const over = (edge: number, clear: number) => {
    if (clear <= pick.minY || nose < edge - LIFT_RAMP) return pick.minY;
    if (nose < edge) return pick.minY + ((clear - pick.minY) * (nose - (edge - LIFT_RAMP))) / LIFT_RAMP;
    return clear;
  };
  let lowest = over(0, geo.keywayBottomY + tall);
  if (w) {
    // A rake is level, so it stays over the wrench all the way in.
    const past = rake ? 0 : Math.max(0, tipX - pick.shaftBack - w.reach);
    lowest = Math.max(lowest, over(w.front, w.top + tall) - MAX_TILT * past);
  }
  return Math.max(pick.minY, lowest);
}


export const GEO: LockGeometry = {
  plugR: 6.35e-3, // 0.5" plug
  /** The shear line sits at the top of the plug on the pin axis. */
  shearY: 6.35e-3,
  /** Height at which a key pin's tip rests when nothing is lifting it. */
  floorY: -2.0e-3,
  chamberTopY: 6.35e-3 + 12e-3,
  pinR: 1.46e-3,
  chamberR: 1.5e-3,
  pitch: 3.96e-3,
  firstPinX: 5.9e-3,
  tailLen: 5.3e-3,
  housingR: 11e-3,
  bibleHalfW: 4.6e-3,
  bibleTopY: 20.2e-3,
  keywayHalfW: 1.25e-3,
  // The keyway is cut right through the bottom of the plug, as in most pin
  // tumbler cylinders, so its floor is the bore of the housing.
  keywayBottomY: -6.35e-3,
  keywayTopY: 2.4e-3,
  springSolid: 2.6e-3,
  keyLenBase: 4.19e-3,
  keyLenStep: 0.381e-3,
  bittingCount: 10,
  spoolFlange: 1.0e-3,
  sideFloor: 0,
  sideKeyLenBase: 0,
  waferTravel: 0,
};

/**
 * Dimple lock: the key is a flat blade lying on its side, so the keyway is a
 * wide, shallow slot through the middle of the plug and the pins come down
 * onto the blade's face. Cuts are shallow dimples, so pin travel is short and
 * the differences between depths are small.
 */
export const DIMPLE_GEO: LockGeometry = {
  ...GEO,
  floorY: -0.5e-3,
  keywayHalfW: 4.2e-3,
  keywayBottomY: -1.4e-3,
  keywayTopY: 1.4e-3,
  keyLenBase: 5.25e-3,
  keyLenStep: 0.4e-3,
  bittingCount: 4,
  spoolFlange: 0.35e-3,
  // Side pins come in level with the plug centre, onto the edge of the key.
  sideFloor: 0.7e-3,
  sideKeyLenBase: 4.05e-3,
};

/**
 * Short hook: the tip rises 2 mm above the shaft. With so little height the
 * shaft runs close under the pins in front of the one being lifted.
 */
/**
 * Wafer lock: thin flat wafers stand across the plug, each with a window the
 * key passes through. A spring holds each wafer down so its bottom end sticks
 * out into a groove in the housing. Every wafer needs the same lift to come
 * flush, but its window is cut at a different height, so the pick meets each
 * one at a different level. `keyLen` here is the distance from the top of a
 * wafer down to the top edge of its window, where the pick bears.
 */
export const WAFER_GEO: LockGeometry = {
  ...GEO,
  pitch: 2.4e-3,
  firstPinX: 5.0e-3,
  tailLen: 4.6e-3,
  keywayBottomY: -4.8e-3,
  keywayTopY: 2.4e-3,
  keyLenBase: 4.4e-3,
  keyLenStep: 0.6e-3,
  bittingCount: 4,
  waferTravel: 1.6e-3,
};

/** Shape of a wafer, for drawing: thickness, the tangs at its ends, its body and its window. */
export const WAFER = {
  thick: 0.8e-3,
  tangHalfW: 1.3e-3,
  bodyHalfW: 3.2e-3,
  bodyHalfH: 3.6e-3,
  windowH: 3.2e-3,
  /** Half-width of the window's edge as the pick meets it, and the break on that edge. */
  tipR: 0.45e-3,
  tipRise: 0.15e-3,
};

export const HOOK_PICK: PickSpec = {
  kind: 'hook',
  name: 'Short hook',
  tipHalfW: 0.25e-3,
  tipReach: 1.5e-3,
  tipSlope: 1.2,
  tipFront: 0,
  minX: -8e-3,
  minY: -3.2e-3,
  maxY: 3.2e-3,
  hookH: 2.0e-3,
  shaftBack: 1.0e-3,
  pivotX: -10e-3,
  pivotY: -3.0e-3,
  shaftY: 0,
  flagLen: 0,
  rakeAmp: 0,
  rakePitch: 0,
  rakePeaks: 0,
  handK: 4000,
  maxForce: 10,
};

/**
 * Triple-peak rake. The peaks are closer together than the pins, so as it is
 * scrubbed in and out each pin is lifted to a different, changing height.
 * It is held level and with a light hand: the force limit is what lets it
 * ride under a pin that will not move instead of ramming it.
 */
export const RAKE_PICK: PickSpec = {
  ...HOOK_PICK,
  kind: 'rake',
  name: 'Triple-peak rake',
  tipReach: 0.7e-3,
  rakeAmp: 1.3e-3,
  rakePitch: 3.3e-3,
  rakePeaks: 3,
  handK: 1200,
  maxForce: 1.4,
};

/**
 * Snake rake: two long, gentle waves. It lifts less and more smoothly than
 * the triple-peak, so it is kinder to pins already set but reaches less high.
 */
export const SNAKE_PICK: PickSpec = {
  ...RAKE_PICK,
  name: 'Snake rake',
  rakeAmp: 0.9e-3,
  rakePitch: 4.4e-3,
  rakePeaks: 2,
};

/**
 * Deep hook: a taller tip, so the shaft stays further below the front pins
 * while the tip lifts a high-set pin at the back. The price is room: with its
 * shaft on the keyway floor the tip is already above where the pins rest.
 */
export const DEEP_HOOK_PICK: PickSpec = {
  ...HOOK_PICK,
  name: 'Deep hook',
  hookH: 3.8e-3,
};

/**
 * Half-diamond: the shaft ends in a low triangle, steep at the front and long
 * and gentle at the back. It lifts a single pin on its point like a hook,
 * though less precisely. Drawn out of the lock its long back slope rides
 * smoothly under the pins like a rake; pushed in, the steep front shoves them.
 */
export const DIAMOND_PICK: PickSpec = {
  ...HOOK_PICK,
  kind: 'diamond',
  name: 'Half-diamond',
  tipHalfW: 0.1e-3,
  tipReach: 3.0e-3,
  tipSlope: 2.0 / 3.0,
  tipFront: 1.1e-3,
  hookH: 2.0e-3,
  shaftBack: 3.0e-3,
};

/**
 * How far the rake's top edge is below its peaks, `d` along the blade from
 * the front peak (negative: back toward the handle). Infinity ahead of the nose.
 */
export function rakeDepth(pick: PickSpec, d: number) {
  if (d > pick.tipReach) return Infinity;
  if (d > 0) return (d / pick.tipReach) * pick.rakeAmp;
  if (d < -(pick.rakePeaks - 0.5) * pick.rakePitch) return pick.rakeAmp;
  return (pick.rakeAmp * (1 - Math.cos((2 * Math.PI * d) / pick.rakePitch))) / 2;
}

const FLAG_SHAFT_Y = -0.95e-3;
const FLAG_LEN = 2.7e-3;
export const FLAG_SHAFT_R = 0.45e-3;

export const FLAG_PICK: PickSpec = {
  kind: 'flag',
  name: 'Flag pick',
  tipHalfW: 0.45e-3,
  tipReach: 1.5e-3,
  tipSlope: 1.2,
  tipFront: 0,
  minX: -8e-3,
  // Flag lying flat: its tip is level with the shaft, below every pin.
  minY: FLAG_SHAFT_Y,
  // Past upright the control keeps going: see flagAngle. This is 170 degrees
  // of twist, with the flag pressed over onto the side row.
  maxY: FLAG_SHAFT_Y + FLAG_LEN * (1 + (80 * Math.PI) / 180),
  hookH: 0,
  shaftBack: 0,
  pivotX: 0,
  pivotY: 0,
  shaftY: FLAG_SHAFT_Y,
  flagLen: FLAG_LEN,
  rakeAmp: 0,
  rakePitch: 0,
  rakePeaks: 0,
  handK: 4000,
  maxForce: 10,
};

/**
 * The bottom of a key pin: a small flat, then a cone out to the pin's full
 * width. A hook's tip can ride up this cone, but no further: above it is the
 * straight side of the pin.
 */
export const KEY_TIP = { flat: 0.3e-3, height: 1.05e-3 };

/** Height of a key pin's underside above its very tip, `r` out from its axis. */
export function keyTipRise(r: number) {
  if (r <= KEY_TIP.flat) return 0;
  return (KEY_TIP.height * (r - KEY_TIP.flat)) / (GEO.pinR - KEY_TIP.flat);
}

/** The same for any pin or wafer: how far its underside has risen `r` out from its centre. */
export function tipRiseAt(pin: PinSpec, r: number) {
  const flat = Math.min(KEY_TIP.flat, pin.tipR / 2);
  if (r <= flat) return 0;
  return (pin.tipRise * (r - flat)) / (pin.tipR - flat);
}

export const pinX = (i: number) => GEO.firstPinX + i * GEO.pitch;

/**
 * Twist of a flag pick for a control value u. Up to upright, u is simply the
 * height of the flag's tip, so the tip follows the hand; pushing further keeps
 * twisting the shaft at the same rate, laying the flag over toward the side row.
 * 0 = flat toward the camera, PI/2 = upright, PI = flat toward the side row.
 */
export function flagAngle(pick: PickSpec, u: number) {
  const t = (u - pick.shaftY) / pick.flagLen;
  if (t <= 0) return 0;
  if (t <= 1) return Math.asin(t);
  return Math.PI / 2 + (t - 1);
}

const mm = 1e-3;
// Edge break on the driver: 0.05 mm radial over 0.025 mm of length. A set
// driver whose chamber the plug has only just passed rests on this edge and
// its spring pushes back on the plug, so the wider the edge, the more set
// pins resist at once in a lock with many stacks.
const CHAMFER = 0.05 * mm;
const CHAMFER_LEN = 0.025 * mm;
export const DRIVER_LEN = 5.0 * mm;

/** Bevel on top of the key pin, measured downward from its top face. */
export const KEY_TOP_PROFILE: Profile = [
  [0, 0.12 * mm],
  [0.15 * mm, 0],
];
/** Radial size of the key pin's top bevel, and its axial length. */
export const KEY_BEVEL = 0.12 * mm;
export const KEY_BEVEL_LEN = 0.15 * mm;
export const DRIVER_CHAMFER = CHAMFER;
export const DRIVER_CHAMFER_LEN = CHAMFER_LEN;
/** Both ends of a wafer are broken with the same small edge as a driver's. */
export const WAFER_END_PROFILE: Profile = [
  [0, CHAMFER],
  [CHAMFER_LEN, 0],
];

/**
 * Serrated key pin: a few fine grooves at the top of the pin, just under the
 * bevel. They only matter once the pin has been pushed above the shear line,
 * where the plug turns into a groove and holds the pin there, overset.
 */
export const KEY_SERRATIONS = 3;
const KEY_SERR_FIRST = 0.4 * mm;
const KEY_SERR_PITCH = 0.35 * mm;
const KEY_SERR_DEPTH = 0.12 * mm;

function serratedKeyProfile(): Profile {
  const pts: Array<readonly [number, number]> = [...KEY_TOP_PROFILE];
  for (let k = 0; k < KEY_SERRATIONS; k++) {
    const g = KEY_SERR_FIRST + k * KEY_SERR_PITCH;
    pts.push(
      [g - 0.13 * mm, 0],
      [g - 0.06 * mm, KEY_SERR_DEPTH],
      [g + 0.06 * mm, KEY_SERR_DEPTH],
      [g + 0.13 * mm, 0],
    );
  }
  return pts;
}

export function keyPinProfile(type: KeyPinType): Profile {
  return type === 'serrated' ? serratedKeyProfile() : KEY_TOP_PROFILE;
}

function standardProfile(len: number): Profile {
  return [
    [0, CHAMFER],
    [CHAMFER_LEN, 0],
    [len - CHAMFER_LEN, 0],
    [len, CHAMFER],
  ];
}

function spoolProfile(len: number, flange: number): Profile {
  const waist = 0.5 * mm;
  return [
    [0, CHAMFER],
    [CHAMFER_LEN, 0],
    [flange, 0],
    [flange + 0.25 * mm, waist],
    [len - 1.4 * mm, waist],
    [len - 1.15 * mm, 0],
    [len - CHAMFER_LEN, 0],
    [len, CHAMFER],
  ];
}

/** How deep a serrated driver's grooves are drawn. */
export const SERRATION_DRAWN = 0.18 * mm;
/** The most a serration lets the plug turn, as an arc at the shear line. */
export const SERRATION_BITE = 0.05 * mm;
/** A serration's bite as a share of the gap to the next pin to bind. */
const SERRATION_SHARE = 0.7;

/**
 * Serrated driver. `depth` is how far the plug can turn into a groove. A
 * serration is a click on the way up, not a false set: unlike a spool's waist
 * it must not let the plug turn far enough for the next pin to bind, or pins
 * set while it sits in a groove would drop when it is lifted out again. The
 * tolerances here are far tighter than the grooves look, so a lock gives each
 * serrated driver a bite smaller than the gap to the next pin (see
 * generateLock) and the full-depth outline is only used for drawing.
 */
function serratedProfile(len: number, depth = SERRATION_DRAWN): Profile {
  const pts: Array<readonly [number, number]> = [
    [0, CHAMFER],
    [CHAMFER_LEN, 0],
  ];
  // Groove walls at about 60 degrees, however shallow the groove.
  const wall = Math.min(0.1 * mm, depth * 0.6);
  for (let g = 0.7 * mm; g < len - 0.9 * mm; g += 0.62 * mm) {
    pts.push(
      [g - 0.1 * mm - wall, 0],
      [g - 0.1 * mm, depth],
      [g + 0.1 * mm, depth],
      [g + 0.1 * mm + wall, 0],
    );
  }
  pts.push([len - CHAMFER_LEN, 0], [len, CHAMFER]);
  return pts;
}

// The profiles below are all measured up from the driver's bottom face. Only
// about the lowest 4 mm of a driver ever reaches the shear line, so that is
// where each one's features are.
type Pts = Array<readonly [number, number]>;
const BOTTOM: Pts = [
  [0, CHAMFER],
  [CHAMFER_LEN, 0],
];
const topOf = (len: number): Pts => [
  [len - CHAMFER_LEN, 0],
  [len, CHAMFER],
];

/** Spool whose bottom flange is itself grooved: a false set, with clicks on the way out of it. */
function spoolerratedProfile(len: number, flange: number): Profile {
  const waist = 0.5 * mm;
  const groove = 0.15 * mm;
  const pts: Pts = [...BOTTOM];
  for (const g of [0.32, 0.68]) {
    const at = g * flange;
    pts.push([at - 0.1 * mm, 0], [at - 0.04 * mm, groove], [at + 0.04 * mm, groove], [at + 0.1 * mm, 0]);
  }
  pts.push([flange, 0], [flange + 0.25 * mm, waist], [len - 1.4 * mm, waist], [len - 1.15 * mm, 0], ...topOf(len));
  return pts;
}

/**
 * Mushroom: a flat cap at the bottom, undercut sharply above it, the stem
 * then widening slowly back to full size. The long taper draws the pin up and
 * the plug round as it goes, and the cap then catches like a spool's flange.
 */
function mushroomProfile(len: number, flange: number): Profile {
  return [...BOTTOM, [flange, 0], [flange + 0.22 * mm, 0.5 * mm], [3.9 * mm, 0], ...topOf(len)];
}

/** Double mushroom: a cap at each end and the stem swelling to full size in the middle. */
function doubleMushroomProfile(len: number, flange: number): Profile {
  const waist = 0.5 * mm;
  return [
    ...BOTTOM,
    [flange, 0],
    [flange + 0.22 * mm, waist],
    [2.45 * mm, 0],
    [2.6 * mm, 0],
    [3.75 * mm, waist],
    [3.97 * mm, 0],
    ...topOf(len),
  ];
}

/** Barrel: two square grooves with a full-width band between them, so two false sets. */
function barrelProfile(len: number, flange: number): Profile {
  const groove = 0.42 * mm;
  return [
    ...BOTTOM,
    [flange, 0],
    [flange + 0.22 * mm, groove],
    [1.85 * mm, groove],
    [2.07 * mm, 0],
    [2.75 * mm, 0],
    [2.97 * mm, groove],
    [3.6 * mm, groove],
    [3.82 * mm, 0],
    ...topOf(len),
  ];
}

/**
 * Gin: a full-width body that funnels down to a thin neck over a small conical
 * foot. The neck is deep, so the false set is a large one, but the foot is
 * sloped, so the pick can help push it back through.
 */
function ginProfile(len: number): Profile {
  const neck = 0.7 * mm;
  return [...BOTTOM, [0.12 * mm, 0], [0.55 * mm, neck], [0.9 * mm, neck], [1.75 * mm, 0], ...topOf(len)];
}

/** Tree: a gin's foot and neck, then a collar and a second undercut above it: ledge after ledge. */
function treeProfile(len: number): Profile {
  const neck = 0.65 * mm;
  return [
    ...BOTTOM,
    [0.12 * mm, 0],
    [0.5 * mm, neck],
    [0.8 * mm, neck],
    [1.3 * mm, 0.08 * mm],
    [1.6 * mm, 0.08 * mm],
    [1.8 * mm, 0.45 * mm],
    [2.5 * mm, 0.45 * mm],
    [2.7 * mm, 0],
    ...topOf(len),
  ];
}

export function driverProfile(
  type: DriverType,
  len: number,
  spoolFlange = GEO.spoolFlange,
  serrationDepth = SERRATION_DRAWN,
): Profile {
  switch (type) {
    case 'spool':
      return spoolProfile(len, spoolFlange);
    case 'serrated':
      return serratedProfile(len, serrationDepth);
    case 'spoolerrated':
      return spoolerratedProfile(len, spoolFlange);
    case 'mushroom':
      return mushroomProfile(len, spoolFlange);
    case 'doubleMushroom':
      return doubleMushroomProfile(len, spoolFlange);
    case 'barrel':
      return barrelProfile(len, spoolFlange);
    case 'gin':
      return ginProfile(len);
    case 'tree':
      return treeProfile(len);
    default:
      return standardProfile(len);
  }
}

/** Evaluate a profile: radial reduction and its slope at axial position t. */
export function evalProfile(p: Profile, t: number, out: { depth: number; slope: number }) {
  const n = p.length;
  if (t <= p[0][0]) {
    out.depth = p[0][1];
    out.slope = 0;
    return out;
  }
  for (let i = 1; i < n; i++) {
    const b = p[i];
    if (t <= b[0]) {
      const a = p[i - 1];
      const w = b[0] - a[0];
      const slope = w > 0 ? (b[1] - a[1]) / w : 0;
      out.depth = a[1] + slope * (t - a[0]);
      out.slope = slope;
      return out;
    }
  }
  out.depth = p[n - 1][1];
  out.slope = 0;
  return out;
}

export interface LockPreset {
  kind: LockKind;
  id: string;
  name: string;
  description: string;
  pinCount: number;
  /** Minimum difference in clearance between successive binding pins. */
  toleranceGap: number;
  spools: number;
  serrated: number;
  /** How many key pins are serrated as well. */
  serratedKeys?: number;
  /** Extra pins in a staggered side row (dimple locks). */
  sidePins?: number;
  /** Top-row chambers hold telescoping (pin-in-pin) stacks. */
  telescoping?: boolean;
  /** A lock someone built: the pins in each stack, front to back. */
  stacks?: StackChoice[];
}

/** The two pins someone chose for one stack of a lock they built. */
export interface StackChoice {
  key: KeyPinType;
  driver: DriverType;
  /**
   * Key pin length, 1 (shortest) to KEY_LENGTHS (longest), which sets how
   * deep that stack's cut is. Left out, the length is random.
   */
  length?: number;
}

/** How many key pin lengths a builder can choose from. */
export const KEY_LENGTHS = 9;

/** Most pin stacks a built lock can have. */
export const MAX_STACKS = 7;

const COUNT_WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven'];

/** Preset for a pin tumbler lock built stack by stack. The key cuts stay random. */
export function customPreset(stacks: StackChoice[]): LockPreset {
  const n = stacks.length;
  // Security drivers first, standard last.
  const drivers = [...DRIVER_TYPES.slice(1), DRIVER_TYPES[0]].flatMap((t) => {
    const k = stacks.filter((q) => q.driver === t).length;
    return k ? [`${k} ${DRIVER_NAMES[t].toLowerCase()}`] : [];
  });
  const keys = stacks.filter((q) => q.key === 'serrated').length;
  return {
    kind: 'pin',
    id: 'custom',
    name: `Your lock · ${n} pin${n === 1 ? '' : 's'}`,
    description: `${COUNT_WORDS[n] ?? n} pin stack${n === 1 ? '' : 's'}, built by you. Drivers: ${drivers.join(', ')}. Key pins: ${
      keys ? `${keys} serrated, ${n - keys} standard` : 'all standard'
    }. Key pin lengths, front to back: ${stacks.map((q) => q.length ?? '?').join('-')}. ${
      stacks.every((q) => q.length)
        ? 'The binding order is random each time.'
        : 'The lengths left to chance (?) and the binding order are random each time.'
    }`,
    pinCount: n,
    toleranceGap: 0.02 * mm,
    spools: 0,
    serrated: 0,
    stacks,
  };
}

export const PRESETS: LockPreset[] = [
  {
    kind: 'pin',
    id: 'trainer2',
    name: '1 · Two-pin trainer',
    description:
      'Two standard pins with sloppy tolerances. Learn to find the binding pin and feel it set.',
    pinCount: 2,
    toleranceGap: 0.045 * mm,
    spools: 0,
    serrated: 0,
  },
  {
    kind: 'pin',
    id: 'trainer3',
    name: '2 · Three-pin trainer',
    description: 'Three standard pins. The binding order is no longer front-to-back — hunt for it.',
    pinCount: 3,
    toleranceGap: 0.035 * mm,
    spools: 0,
    serrated: 0,
  },
  {
    kind: 'pin',
    id: 'standard5',
    name: '3 · Standard five-pin',
    description: 'A typical budget door cylinder: five standard pins, moderate tolerances.',
    pinCount: 5,
    toleranceGap: 0.024 * mm,
    spools: 0,
    serrated: 0,
  },
  {
    kind: 'pin',
    id: 'spool5',
    name: '4 · Five-pin with spools',
    description:
      'Two spool drivers. Expect a false set: the plug turns a few degrees, then you must ease off tension and let it counter-rotate.',
    pinCount: 5,
    toleranceGap: 0.02 * mm,
    spools: 2,
    serrated: 0,
  },
  {
    kind: 'pin',
    id: 'security5',
    name: '5 · Security five-pin',
    description:
      'Spools and serrated drivers with tight tolerances. Light, well-controlled tension is essential.',
    pinCount: 5,
    toleranceGap: 0.013 * mm,
    spools: 2,
    serrated: 2,
  },
  {
    kind: 'pin',
    id: 'serrated5',
    name: '6 · Five-pin, serrated key pins',
    description:
      'Serrated drivers, and key pins with three fine serrations at the top. Push a pin even slightly past the shear line and a serration catches there, so the pin stays overset. Use very light tension and lift slowly through the clicks of the drivers; if a pin jams high, ease off until it drops.',
    pinCount: 5,
    toleranceGap: 0.014 * mm,
    spools: 0,
    serrated: 3,
    serratedKeys: 3,
  },
  {
    kind: 'dimple',
    id: 'dimple5single',
    name: '7 · Dimple five-pin',
    description:
      'A dimple lock with a single row: the keyway is a flat slot and the pins sit on the face of the key. Twist the flag pick to swing its tip up into a pin. Travel is short, so small movements matter.',
    pinCount: 5,
    toleranceGap: 0.02 * mm,
    spools: 0,
    serrated: 0,
  },
  {
    kind: 'dimple',
    id: 'dimple5',
    name: '8 · Dimple, 5 + 3 side pins',
    description:
      'Five pins on the face of the key and three more in a side row on its edge. Twist the flag pick up into the top pins; keep pushing the mouse up to lay the flag over onto the side row, which sits between the top pins.',
    pinCount: 5,
    sidePins: 3,
    toleranceGap: 0.02 * mm,
    spools: 0,
    serrated: 0,
  },
  {
    kind: 'dimple',
    id: 'dimple6',
    name: '9 · Dimple, 6 + 4 side pins, spools',
    description:
      'Ten pins in two rows, two of them spools, with tight tolerances. The binding order jumps between rows. With so little pin travel it is easy to overset: lift a little, feel, and ease tension through the false set.',
    pinCount: 6,
    sidePins: 4,
    toleranceGap: 0.015 * mm,
    spools: 2,
    serrated: 0,
  },
  {
    kind: 'dimple',
    id: 'dimpleTelescoping',
    name: '10 · Dimple, 5 telescoping pins',
    description:
      'Each chamber holds a pin inside a pin, and both must be set. Centre the flag under a chamber to lift the inner pin; shift it about a millimetre to one side to catch the rim of the outer pin. Ten stacks bind in one mixed order.',
    pinCount: 5,
    telescoping: true,
    toleranceGap: 0.016 * mm,
    spools: 0,
    serrated: 0,
  },
  {
    kind: 'dimple',
    id: 'dimpleTelescopingSide',
    name: '11 · Dimple, telescoping + side pins, spools',
    description:
      'Everything at once: five telescoping chambers, three side pins and two spool drivers, thirteen stacks in one binding order. Centre the flag for an inner pin, shift it for an outer rim, lay it over for the side row, and ease tension through each false set.',
    pinCount: 5,
    telescoping: true,
    sidePins: 3,
    toleranceGap: 0.014 * mm,
    spools: 2,
    serrated: 0,
  },
  {
    kind: 'wafer',
    id: 'wafer5',
    name: '14 · Wafer lock, 5 wafers',
    description:
      'A wafer lock, as on desks, cabinets and older cars. Flat wafers stand across the plug and their ends stick out into a groove in the housing. Lift each one until it is flush with the plug: too little and the bottom end still catches, too much and the top end does. Tolerances are loose.',
    pinCount: 5,
    toleranceGap: 0.03 * mm,
    spools: 0,
    serrated: 0,
  },
  {
    kind: 'wafer',
    id: 'wafer7',
    name: '15 · Wafer lock, 7 wafers',
    description:
      'Seven wafers, closer in tolerance. They sit only 2.4 mm apart, so place the pick carefully, and remember that a wafer lifted too far blocks the plug just as one not lifted enough does.',
    pinCount: 7,
    toleranceGap: 0.018 * mm,
    spools: 0,
    serrated: 0,
  },
];

/** Small deterministic PRNG so a seed always reproduces the same lock. */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(arr: T[], rnd: () => number) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function generateLock(preset: LockPreset, seed: number): LockSpec {
  const rnd = mulberry32(seed);
  const topCount = preset.pinCount;
  const sideCount = Math.min(preset.sidePins ?? 0, topCount - 1);

  // Lay out every stack: top-row chambers (one stack, or outer + inner when
  // telescoping), then side pins half a pitch along, centred on the row.
  const geo = preset.kind === 'dimple' ? DIMPLE_GEO : preset.kind === 'wafer' ? WAFER_GEO : GEO;
  const wafer = preset.kind === 'wafer';
  const layout: Array<Pick<PinSpec, 'row' | 'part' | 'chamber' | 'label' | 'pickOffset' | 'x'>> = [];
  for (let c = 0; c < topCount; c++) {
    const base = { row: 'top' as const, chamber: c + 1, x: geo.firstPinX + c * geo.pitch };
    if (preset.telescoping) {
      layout.push({ ...base, part: 'outer', label: `${c + 1} outer`, pickOffset: TELESCOPE.outerOffset });
      layout.push({ ...base, part: 'inner', label: `${c + 1} inner`, pickOffset: 0 });
    } else {
      layout.push({ ...base, part: 'solid', label: String(c + 1), pickOffset: 0 });
    }
  }
  const sideStart = Math.floor((topCount - 1 - sideCount) / 2);
  for (let k = 0; k < sideCount; k++) {
    const chamber = topCount + k + 1;
    layout.push({
      row: 'side',
      part: 'solid',
      chamber,
      label: String(chamber),
      pickOffset: 0,
      x: pinX(sideStart + k) + GEO.pitch / 2,
    });
  }
  const n = layout.length;
  const depths = geo.bittingCount;

  // Bitting: depths 0-9, limiting adjacent cut difference like a real key (MACS).
  const bitting: number[] = [];
  for (let i = 0; i < n; i++) {
    let d = Math.floor(rnd() * depths);
    if (i > 0) {
      const prev = bitting[i - 1];
      if (Math.abs(d - prev) > 7) d = prev + Math.sign(d - prev) * 7;
      if (d === prev) {
        const bump =
          depths >= 10 ? 2 + Math.floor(rnd() * 3) : 1 + Math.floor(rnd() * (depths - 1));
        d = (d + bump) % depths;
      }
    }
    bitting.push(d);
  }

  // A built lock uses the key pin lengths that were chosen for it.
  if (preset.stacks) {
    for (let i = 0; i < n && i < preset.stacks.length; i++) {
      const len = preset.stacks[i].length;
      if (len) bitting[i] = Math.min(depths, Math.max(1, Math.round(len))) - 1;
    }
  }

  // Binding order: a random permutation; rank k gets the k-th smallest clearance.
  const order = shuffle([...Array(n).keys()], rnd);
  const clearance = new Array<number>(n);
  let c = (0.03 + rnd() * 0.02) * mm;
  for (const idx of order) {
    clearance[idx] = c;
    c += preset.toleranceGap * (1 + rnd() * 0.6);
  }

  // Security pins go in random chambers.
  // Inner telescoping pins are too thin to be waisted, so they stay standard.
  const slots = shuffle([...Array(n).keys()], rnd).filter((i) => layout[i].part !== 'inner');
  const types = new Array<DriverType>(n).fill('standard');
  for (let k = 0; k < preset.spools && k < slots.length; k++) types[slots[k]] = 'spool';
  for (let k = 0; k < preset.serrated && preset.spools + k < slots.length; k++)
    types[slots[preset.spools + k]] = 'serrated';

  const keyTypes = new Array<KeyPinType>(n).fill('standard');
  if (preset.serratedKeys) {
    const keySlots = shuffle([...Array(n).keys()], rnd).filter((i) => layout[i].part === 'solid');
    for (let k = 0; k < preset.serratedKeys && k < keySlots.length; k++)
      keyTypes[keySlots[k]] = 'serrated';
  }

  // A built lock has exactly the pins that were chosen for each stack.
  if (preset.stacks) {
    for (let i = 0; i < n && i < preset.stacks.length; i++) {
      types[i] = preset.stacks[i].driver;
      keyTypes[i] = preset.stacks[i].key;
    }
  }

  // A serration bites less than the gap to the next pin to bind, so the plug
  // turning into one never reaches that pin.
  const bite = clearance.map((own) => {
    const next = Math.min(...clearance.filter((other) => other > own));
    return Math.min(SERRATION_BITE, SERRATION_SHARE * (next - own));
  });

  const pins: PinSpec[] = [];
  for (let i = 0; i < n; i++) {
    const side = layout[i].row === 'side';
    const keyLen = (side ? geo.sideKeyLenBase : geo.keyLenBase) + geo.keyLenStep * bitting[i];
    pins.push({
      ...layout[i],
      angle: side ? Math.PI / 2 : 0,
      // A wafer rests with its bottom end out of the plug by its full travel.
      floor: wafer ? geo.shearY - geo.waferTravel - keyLen : side ? geo.sideFloor : geo.floorY,
      wafer,
      tipR: wafer ? WAFER.tipR : GEO.pinR,
      tipRise: wafer ? WAFER.tipRise : KEY_TIP.height,
      keyLen,
      keyPin: keyTypes[i],
      keyProfile: wafer ? WAFER_END_PROFILE : keyPinProfile(keyTypes[i]),
      bitting: bitting[i],
      driver: types[i],
      driverLen: DRIVER_LEN,
      profile: driverProfile(types[i], DRIVER_LEN, geo.spoolFlange, bite[i]),
      clearance: clearance[i],
      springK: 100 + rnd() * 40,
      springFree: 13 * mm,
    });
  }

  return {
    kind: preset.kind,
    geo,
    pick: preset.kind === 'dimple' ? FLAG_PICK : HOOK_PICK,
    name: preset.name,
    description: preset.description,
    pins,
    plugLen: geo.firstPinX + (topCount - 1) * geo.pitch + geo.tailLen,
    seed,
  };
}
