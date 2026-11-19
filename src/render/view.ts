import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { GEO, flagAngle, shaftPivotY, type LockSpec, type PickSpec } from '../sim/lock';
import { LockSim, pickSurfaceY, MAX_TORQUE, type PinStatus } from '../sim/physics';
import { DISC, DiscSim, discX, type DiscLockSpec } from '../sim/disc';
import {
  buildCoreTail,
  buildDisc,
  buildDiscCore,
  buildDiscHousing,
  buildDiscPick,
  buildSidebar,
  buildTensionArm,
} from './discModels';
import {
  SPRING_BASE_H,
  buildChamberCap,
  buildDriver,
  buildHousing,
  buildKeyPin,
  buildPick,
  buildWafer,
  buildPlug,
  buildSpring,
  buildTailpiece,
  buildWrench,
} from './models';

const MM = 1000;
const FRONT_LAYER = 1;
const SIDE_LAYER = 2;

// The front view magnifies small plug rotations so a single pin setting
// (a few tenths of a degree) is easy to see. Up to FRONT_KNEE the angle is
// multiplied by FRONT_GAIN; beyond it the rest of the swing to 90 degrees is
// compressed so the plug still ends up a quarter turn round when open.
const FRONT_GAIN = 10;
const FRONT_KNEE = THREE.MathUtils.degToRad(6);

function exaggerate(theta: number) {
  if (theta <= FRONT_KNEE) return theta * FRONT_GAIN;
  const shown = FRONT_KNEE * FRONT_GAIN;
  const t = Math.min(1, (theta - FRONT_KNEE) / (Math.PI / 2 - FRONT_KNEE));
  return shown + (Math.PI / 2 - shown) * t;
}

export type ViewMode = 'cutaway' | 'xray' | 'solid';

const STATUS_COLOR: Record<PinStatus, number> = {
  free: 0x000000,
  binding: 0xff9d1e,
  set: 0x2fd66b,
  overset: 0xff3b3b,
};

export class LockView {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;

  private lockRoot = new THREE.Group();
  private plugGroup = new THREE.Group();
  private frontPlugGroup = new THREE.Group();
  private housingCut!: THREE.Mesh;
  private housingFull!: THREE.Mesh;
  private plugCut!: THREE.Mesh;
  private plugFull!: THREE.Mesh;
  private keyPins: THREE.Mesh[] = [];
  private drivers: THREE.Mesh[] = [];
  private springs: THREE.Mesh[] = [];
  private pick!: THREE.Mesh;
  private wrench!: THREE.Mesh;
  private labels: THREE.Sprite[] = [];
  private discMeshes: THREE.Mesh[] = [];
  private sidebar: THREE.Mesh | null = null;
  private frontDisc: THREE.Mesh | null = null;
  private disposables: Array<{ dispose(): void }> = [];

  private readonly raycaster = new THREE.Raycaster();
  private readonly pickPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  private readonly hit = new THREE.Vector3();
  private mode: ViewMode = 'cutaway';
  private spec!: LockSpec;
  private pickOut = 0;

  /** Page element whose rectangle the front-view inset is drawn into. */
  frontEl: HTMLElement | null = null;
  /** Page element for the top-down section through the side pin row. */
  sideEl: HTMLElement | null = null;
  hasSideRow = false;
  private readonly sideCamera = new THREE.OrthographicCamera(-13, 13, 13, -13, 1, 200);
  private readonly frontCamera = new THREE.OrthographicCamera(-10.5, 10.5, 10.5, -10.5, 1, 200);

  private mat = {
    housing: new THREE.MeshStandardMaterial({ color: 0x7d6843, metalness: 1, roughness: 0.5 }),
    plug: new THREE.MeshStandardMaterial({ color: 0xd2ab55, metalness: 1, roughness: 0.3 }),
    cap: new THREE.MeshStandardMaterial({ color: 0x7a6a45, metalness: 1, roughness: 0.55 }),
    spring: new THREE.MeshStandardMaterial({ color: 0xc9ced6, metalness: 1, roughness: 0.3 }),
    steel: new THREE.MeshStandardMaterial({ color: 0x8c949e, metalness: 1, roughness: 0.32 }),
    wrench: new THREE.MeshStandardMaterial({ color: 0x4d535c, metalness: 1, roughness: 0.4 }),
    handle: new THREE.MeshStandardMaterial({ color: 0x17191c, metalness: 0, roughness: 0.62 }),
    // The front view keeps its own opaque materials so X-ray mode cannot fade it.
    frontHousing: new THREE.MeshStandardMaterial({ color: 0x7d6843, metalness: 1, roughness: 0.5 }),
    frontPlug: new THREE.MeshStandardMaterial({ color: 0xd2ab55, metalness: 1, roughness: 0.3 }),
    // Matte, so the flat section faces do not mirror the bright surroundings.
    sectionHousing: new THREE.MeshStandardMaterial({ color: 0x6b5938, metalness: 0.6, roughness: 0.75 }),
    sectionPlug: new THREE.MeshStandardMaterial({ color: 0xb8944a, metalness: 0.6, roughness: 0.7 }),
    markPlug: new THREE.MeshBasicMaterial({ color: 0xff4d3d }),
    markHousing: new THREE.MeshBasicMaterial({ color: 0xf2f4f7 }),
  };

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.scene.background = new THREE.Color(0x15181d);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.03).texture;
    pmrem.dispose();

    const key = new THREE.DirectionalLight(0xfff2dd, 1.6);
    key.position.set(-30, 60, 80);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x9db8ff, 0.6);
    rim.position.set(60, 10, -40);
    this.scene.add(rim);
    // Lights must reach the front-view layer as well as the main one.
    key.layers.enableAll();
    rim.layers.enableAll();

    // Front view: straight down the keyway axis, tools and pins excluded by layer.
    this.frontCamera.position.set(-60, 1.5, 0);
    this.frontCamera.lookAt(0, 1.5, 0);
    this.frontCamera.layers.set(FRONT_LAYER);

    this.camera = new THREE.PerspectiveCamera(30, 1, 1, 2000);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableZoom = false; // the wheel sets tension
    this.controls.enablePan = false;
    this.controls.enableDamping = true;
    this.controls.mouseButtons = {
      LEFT: null as unknown as THREE.MOUSE,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.ROTATE,
    };
    this.controls.minDistance = 30;
    this.controls.maxDistance = 220;

    this.lockRoot.add(this.plugGroup);
    this.scene.add(this.lockRoot);
    this.resize();
  }

  resize() {
    const c = this.renderer.domElement;
    const w = c.clientWidth || 1;
    const h = c.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  zoom(factor: number) {
    const off = this.camera.position.clone().sub(this.controls.target);
    const d = THREE.MathUtils.clamp(
      off.length() * factor,
      this.controls.minDistance,
      this.controls.maxDistance,
    );
    this.camera.position.copy(this.controls.target).add(off.setLength(d));
  }

  resetCamera(spec: { plugLen: number }) {
    const L = spec.plugLen * MM;
    // Frame the lock plus room for the pick and wrench, clear of the UI.
    const t = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const spanX = L + 26;
    const spanY = 40;
    const dist = 1.22 * Math.max(spanY / 2 / t, spanX / 2 / (t * this.camera.aspect));
    this.controls.maxDistance = Math.max(220, dist * 1.5);
    this.controls.target.set(L / 2 - 7, 3.5, 0);
    if (this.mode === 'solid') {
      const d = new THREE.Vector3(-0.62, 0.25, 0.74).multiplyScalar(dist);
      this.camera.position.copy(this.controls.target).add(d);
    } else {
      this.camera.position.set(L / 2 - 13, 9, dist);
    }
    this.controls.update();
  }

  /** Build all meshes for a lock. */
  setLock(spec: LockSpec) {
    this.spec = spec;
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
    this.lockRoot.clear();
    this.plugGroup = new THREE.Group();
    this.lockRoot.add(this.plugGroup);
    this.keyPins = [];
    this.drivers = [];
    this.springs = [];
    this.labels = [];

    const add = <T extends THREE.BufferGeometry>(g: T) => {
      this.disposables.push(g);
      return g;
    };

    this.housingCut = new THREE.Mesh(add(buildHousing(spec, 'half')), this.mat.housing);
    this.housingFull = new THREE.Mesh(add(buildHousing(spec, 'none')), this.mat.housing);
    this.plugCut = new THREE.Mesh(add(buildPlug(spec, 'half')), this.mat.plug);
    this.plugFull = new THREE.Mesh(add(buildPlug(spec, 'none')), this.mat.plug);
    this.lockRoot.add(this.housingCut, this.housingFull);
    this.plugGroup.add(this.plugCut, this.plugFull);
    this.plugGroup.add(new THREE.Mesh(add(buildTailpiece(spec)), this.mat.cap));

    this.buildFrontView(add, GEO.plugR * MM, spec.geo.keywayTopY * MM + 0.7);

    this.wrench = new THREE.Mesh(add(buildWrench(spec)), this.mat.wrench);
    this.plugGroup.add(this.wrench);

    this.hasSideRow = spec.pins.some((p) => p.row === 'side');

    const capGeo = add(buildChamberCap());
    const springGeo = add(buildSpring());
    const innerSpringGeo = add(buildSpring(true));
    spec.pins.forEach((pin) => {
      if (pin.wafer) {
        // A wafer is one steel plate in the plug. The driver and spring slots
        // are filled with nothing, so the rest of the view need not know.
        const mat = new THREE.MeshStandardMaterial({
          color: 0xb9bfc8,
          metalness: 1,
          roughness: 0.32,
          emissive: 0x000000,
          side: THREE.DoubleSide,
        });
        const plate = new THREE.Mesh(add(buildWafer(pin)), mat);
        plate.position.x = pin.x * MM;
        this.plugGroup.add(plate);
        this.keyPins.push(plate);
        for (const list of [this.drivers, this.springs]) {
          const none = new THREE.Mesh(add(new THREE.BufferGeometry()), mat);
          none.visible = false;
          this.lockRoot.add(none);
          list.push(none);
        }
        const label = makeLabel(String(pin.chamber));
        label.position.set(pin.x * MM, GEO.housingR * MM + 2.4, 0);
        this.lockRoot.add(label);
        this.labels.push(label);
        this.disposables.push(mat, label.material.map!, label.material);
        return;
      }
      const side = pin.row === 'side';
      // Each stack lives in a frame whose +Y is the pin's own axis, so the
      // same code places top pins and side pins.
      const frame = (parent: THREE.Object3D) => {
        const g = new THREE.Group();
        g.position.x = pin.x * MM;
        g.rotation.x = -pin.angle;
        parent.add(g);
        return g;
      };
      const inPlug = frame(this.plugGroup);
      const inHousing = frame(this.lockRoot);

      // Hollow outer pins are drawn as half shells, so both faces must show.
      const faces = pin.part === 'outer' ? THREE.DoubleSide : THREE.FrontSide;
      const keyMat = new THREE.MeshStandardMaterial({
        color: pin.part === 'inner' ? 0xe9edf2 : 0xc8ccd2,
        metalness: 1,
        roughness: 0.28,
        emissive: 0x000000,
        side: faces,
      });
      const kp = new THREE.Mesh(add(buildKeyPin(pin)), keyMat);
      inPlug.add(kp);
      this.keyPins.push(kp);

      const drvMat = new THREE.MeshStandardMaterial({
        // Telescoping drivers are steel blue (outer) and violet (inner): brass and
        // copper sat too close to the amber used to mark a binding pin.
        color:
          pin.part === 'inner'
            ? 0x8a63c9
            : pin.part === 'outer'
              ? 0x4f6f8f
              : pin.driver === 'standard'
                ? 0xd9a441
                : 0x9aa3ad,
        metalness: 1,
        roughness: 0.3,
        emissive: 0x000000,
        side: faces,
      });
      const dr = new THREE.Mesh(add(buildDriver(pin)), drvMat);
      inHousing.add(dr);
      this.drivers.push(dr);
      this.disposables.push(keyMat, drvMat);

      const sp = new THREE.Mesh(pin.part === 'inner' ? innerSpringGeo : springGeo, this.mat.spring);
      inHousing.add(sp);
      this.springs.push(sp);

      if (side) for (const m of [kp, dr, sp]) m.layers.enable(SIDE_LAYER);

      // One cap and one number per chamber: an inner pin shares its outer pin's.
      if (pin.part === 'inner') return;
      const cap = new THREE.Mesh(capGeo, this.mat.cap);
      inHousing.add(cap);

      const label = makeLabel(String(pin.chamber));
      label.position.set(0, GEO.bibleTopY * MM + 2.6, 0);
      inHousing.add(label);
      this.labels.push(label);
      this.disposables.push(label.material.map!, label.material);

      if (side) {
        // Side stacks also appear in the top-down section; their numbers only there.
        cap.layers.enable(SIDE_LAYER);
        label.layers.set(SIDE_LAYER);
      }
    });

    this.pick = new THREE.Mesh(add(buildPick(spec.pick)), this.mat.steel);
    this.pick.material = this.pickMaterials();
    this.lockRoot.add(this.pick);

    if (this.hasSideRow) this.buildSideView(add);

    this.pickOut = 0;
    this.setMode(this.mode);
    this.resetCamera(spec);
  }

  /** Lock face for the front-view inset, with witness marks to read rotation. */
  private buildFrontView(
    add: <T extends THREE.BufferGeometry>(g: T) => T,
    R: number,
    markFrom: number,
  ) {
    const front = (m: THREE.Mesh, parent: THREE.Object3D) => {
      m.layers.set(FRONT_LAYER);
      parent.add(m);
      return m;
    };
    front(new THREE.Mesh(this.housingFull.geometry, this.mat.frontHousing), this.lockRoot);
    // The front view's plug has its own group so its rotation can be magnified.
    this.frontPlugGroup = new THREE.Group();
    this.lockRoot.add(this.frontPlugGroup);
    front(new THREE.Mesh(this.plugFull.geometry, this.mat.frontPlug), this.frontPlugGroup);

    const bar = (r0: number, r1: number, w: number) => {
      const g = add(new THREE.BoxGeometry(0.04, r1 - r0, w));
      g.translate(-0.03, (r0 + r1) / 2, 0);
      return g;
    };
    // Red line on the plug, turning with it.
    front(
      new THREE.Mesh(bar(markFrom, R - 0.25, 0.28), this.mat.markPlug),
      this.frontPlugGroup,
    );
    // Fixed scale on the housing, in TRUE degrees: a tick every half degree,
    // longer on whole degrees, covering the magnified range.
    const short = bar(R + 0.35, R + 1.0, 0.14);
    const long = bar(R + 0.35, R + 1.7, 0.22);
    const kneeDeg = THREE.MathUtils.radToDeg(FRONT_KNEE);
    for (let half = 0; half <= kneeDeg * 2; half++) {
      const tick = new THREE.Mesh(half % 2 === 0 ? long : short, this.mat.markHousing);
      tick.rotation.x = -exaggerate(THREE.MathUtils.degToRad(half / 2));
      front(tick, this.lockRoot);
    }
  }

  /** Top-down section through the keyway axis, showing the side pin row. */
  private buildSideView(add: <T extends THREE.BufferGeometry>(g: T) => T) {
    const spec = this.spec;
    const housing = new THREE.Mesh(add(buildHousing(spec, 'top')), this.mat.sectionHousing);
    housing.layers.set(SIDE_LAYER);
    this.lockRoot.add(housing);
    const plug = new THREE.Mesh(add(buildPlug(spec, 'top')), this.mat.sectionPlug);
    plug.layers.set(SIDE_LAYER);
    this.plugGroup.add(plug);
    this.pick.layers.enable(SIDE_LAYER);
    this.wrench.layers.enable(SIDE_LAYER);

    // Looking straight down, keyway running left to right, side row at the top.
    const cx = (spec.plugLen * MM) / 2 - 3;
    const cz = -8;
    this.sideCamera.up.set(0, 0, -1);
    this.sideCamera.position.set(cx, 80, cz);
    this.sideCamera.lookAt(cx, 0, cz);
    this.sideCamera.layers.set(SIDE_LAYER);
  }

  setMode(mode: ViewMode) {
    this.mode = mode;
    const cut = mode === 'cutaway';
    this.housingCut.visible = this.plugCut.visible = cut;
    this.housingFull.visible = this.plugFull.visible = !cut;
    const xray = mode === 'xray';
    for (const m of [this.mat.housing, this.mat.plug]) {
      m.transparent = xray;
      m.opacity = xray ? 0.22 : 1;
      m.depthWrite = !xray;
      m.needsUpdate = true;
    }
    for (const l of this.labels) l.visible = mode !== 'solid';
  }

  /** Project a pointer position (NDC) onto the lock's centre plane, in metres. */
  pointerToLock(ndcX: number, ndcY: number): { x: number; y: number } | null {
    this.raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
    if (!this.raycaster.ray.intersectPlane(this.pickPlane, this.hit)) return null;
    return { x: this.hit.x / MM, y: this.hit.y / MM };
  }

  /** A pick with a handle is two groups, steel then handle; others are all steel. */
  private pickMaterials() {
    return this.pick.geometry.groups.length > 1 ? [this.mat.steel, this.mat.handle] : this.mat.steel;
  }

  /** No pick in hand: hide it. */
  setPickVisible(visible: boolean) {
    this.pick.visible = visible;
  }

  /** Which tension tool is in a pin or dimple lock's keyway, if any. */
  setWrench(kind: 'bok' | 'tok' | null) {
    this.wrench.visible = kind !== null;
    if (!kind) return;
    this.wrench.geometry.dispose();
    this.wrench.geometry = buildWrench(this.spec, kind === 'tok');
    this.disposables.push(this.wrench.geometry);
  }

  /** Swap the drawn tool on a pin lock, after the simulation has swapped its own. */
  setPick(pick: PickSpec) {
    this.pick.geometry.dispose();
    this.pick.geometry = buildPick(pick);
    this.pick.material = this.pickMaterials();
    this.disposables.push(this.pick.geometry);
  }

  sync(
    sim: LockSim,
    pickX: number,
    pickY: number,
    torque: number,
    displayTheta: number,
    hints: boolean,
    dt: number,
  ) {
    // Positive tension swings the wrench handle toward the camera.
    this.plugGroup.rotation.x = -displayTheta;
    this.frontPlugGroup.rotation.x = -exaggerate(displayTheta);
    this.wrench.rotation.x = -(torque / MAX_TORQUE) * 0.05;

    const pk = this.spec.pick;
    for (let i = 0; i < sim.n; i++) {
      const p = sim.spec.pins[i];
      this.keyPins[i].position.y = sim.yk[i] * MM;
      this.drivers[i].position.y = sim.yd[i] * MM;
      const springBottom = sim.yd[i] + p.driverLen;
      const len = Math.max(GEO.chamberTopY - springBottom, 0.3e-3) * MM;
      this.springs[i].position.y = springBottom * MM;
      this.springs[i].scale.y = len / SPRING_BASE_H;

      const st: PinStatus = hints ? sim.status(i) : 'free';
      // An overset marks the key pin (the part that is jammed); other states
      // mark the driver.
      const c = STATUS_COLOR[st];
      // A wafer is a single plate, so it carries every state.
      tint(this.keyPins[i].material as THREE.MeshStandardMaterial, st === 'overset' || p.wafer ? c : 0);
      if (!p.wafer) tint(this.drivers[i].material as THREE.MeshStandardMaterial, st === 'overset' ? 0 : c);

    }

    // The steel tip cannot pass through a pin that refuses to move: back the
    // drawn pick off until it no longer overlaps any pin.
    let tipY = pickY;
    for (let pass = 0; pass < 4; pass++) {
      let over = 0;
      for (let i = 0; i < sim.n; i++) {
        over = Math.max(
          over,
          pickSurfaceY(sim.spec.pins[i], pickX, tipY, pk, sim.spec.wrench) - sim.yk[i],
        );
      }
      if (over <= 1e-6) break;
      tipY -= over;
    }

    // Slide the pick out of the way once the lock is open.
    this.pickOut += ((sim.opened ? 1 : 0) - this.pickOut) * Math.min(1, dt * 6);
    const tx = pickX * MM;
    const ty = tipY * MM;
    if (pk.kind === 'flag') {
      // Twist the shaft: flat toward the camera, up, then over to the side row.
      const out = this.pickOut * (tx + 14);
      this.pick.position.set(tx - out, pk.shaftY * MM, 0);
      this.pick.rotation.set(Math.PI / 2 - flagAngle(pk, tipY), 0, 0);
    } else if (pk.kind === 'rake') {
      // A rake is held level and scrubbed straight in and out.
      const out = this.pickOut * (tx + 14);
      this.pick.position.set(tx - out, ty - this.pickOut * 2, 0);
      this.pick.rotation.set(0, 0, 0);
    } else {
      const baseX = tx - pk.shaftBack * MM;
      const baseY = ty - pk.hookH * MM;
      // The hand lifts to carry the shaft over a wrench in the bottom of the keyway.
      const pivotY = shaftPivotY(pk, baseX / MM, baseY / MM, sim.spec.wrench) * MM;
      const angle = Math.atan2(baseY - pivotY, baseX - pk.pivotX * MM);
      const out = this.pickOut * (tx + 14);
      this.pick.position.set(
        tx - Math.cos(angle) * out,
        ty - Math.sin(angle) * out - this.pickOut * 2,
        0,
      );
      this.pick.rotation.set(0, 0, angle);
    }

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.renderInset(this.frontEl, this.frontCamera, 10.5);
    if (this.hasSideRow) this.renderInset(this.sideEl, this.sideCamera, 13);
  }

  /** Build all meshes for a disc detainer lock. */
  setDiscLock(spec: DiscLockSpec) {
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
    this.lockRoot.clear();
    this.plugGroup = new THREE.Group();
    this.lockRoot.add(this.plugGroup);
    this.keyPins = [];
    this.drivers = [];
    this.springs = [];
    this.labels = [];
    this.discMeshes = [];
    this.hasSideRow = false;

    const add = <T extends THREE.BufferGeometry>(g: T) => {
      this.disposables.push(g);
      return g;
    };

    this.housingCut = new THREE.Mesh(add(buildDiscHousing(spec, 'half')), this.mat.housing);
    this.housingFull = new THREE.Mesh(add(buildDiscHousing(spec, 'none')), this.mat.housing);
    this.plugCut = new THREE.Mesh(add(buildDiscCore(spec, 'half')), this.mat.plug);
    this.plugFull = new THREE.Mesh(add(buildDiscCore(spec, 'none')), this.mat.plug);
    this.lockRoot.add(this.housingCut, this.housingFull);
    this.plugGroup.add(this.plugCut, this.plugFull);
    this.plugGroup.add(new THREE.Mesh(add(buildCoreTail(spec)), this.mat.cap));

    this.buildFrontView(add, DISC.coreOut * MM, DISC.coreIn * MM + 0.15);

    // Reuses the wrench slot so the shared tension animation applies.
    this.wrench = new THREE.Mesh(add(buildTensionArm()), this.mat.wrench);
    this.plugGroup.add(this.wrench);

    spec.discs.forEach((disc, i) => {
      const mat = new THREE.MeshStandardMaterial({
        color: i % 2 ? 0xb4bac3 : 0xd3d7dd,
        metalness: 1,
        roughness: 0.34,
        emissive: 0x000000,
        vertexColors: true,
      });
      const geo = add(buildDisc(disc));
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.x = discX(i) * MM;
      this.plugGroup.add(mesh);
      this.discMeshes.push(mesh);
      this.disposables.push(mat);

      if (i === 0) {
        // The front disc also shows in the front view, turning inside the core.
        this.frontDisc = new THREE.Mesh(geo, mat);
        this.frontDisc.position.x = mesh.position.x;
        this.frontDisc.layers.set(FRONT_LAYER);
        this.frontPlugGroup.add(this.frontDisc);
      }

      const label = makeLabel(String(i + 1));
      label.position.set(discX(i) * MM, DISC.housingOut * MM + 2.4, 0);
      this.lockRoot.add(label);
      this.labels.push(label);
      this.disposables.push(label.material.map!, label.material);
    });

    this.sidebar = new THREE.Mesh(add(buildSidebar(spec)), this.mat.steel);
    this.plugGroup.add(this.sidebar);

    this.pick = new THREE.Mesh(add(buildDiscPick()), this.mat.steel);
    this.pick.material = this.pickMaterials();
    this.lockRoot.add(this.pick);

    this.pickOut = 0;
    this.setMode(this.mode);
    this.resetCamera(spec);
  }

  /**
   * Draw a disc detainer lock. `pickX` is where the pick's tip is along the
   * lock and `pickAngle` how far its paddle is turned.
   */
  syncDisc(
    sim: DiscSim,
    pickX: number,
    pickAngle: number,
    torque: number,
    displayTheta: number,
    hints: boolean,
    dt: number,
  ) {
    this.plugGroup.rotation.x = -displayTheta;
    this.frontPlugGroup.rotation.x = -exaggerate(displayTheta);
    this.wrench.rotation.x = -(torque / MAX_TORQUE) * 0.05;

    for (let i = 0; i < sim.n; i++) {
      this.discMeshes[i].rotation.x = -sim.phi[i];
      const st: PinStatus = hints ? sim.status(i) : 'free';
      tint(this.discMeshes[i].material as THREE.MeshStandardMaterial, STATUS_COLOR[st]);
    }
    if (this.frontDisc) this.frontDisc.rotation.x = -sim.phi[0];
    if (this.sidebar) this.sidebar.position.y = (DISC.R0 + sim.sidebarY) * MM;

    this.pickOut += ((sim.opened ? 1 : 0) - this.pickOut) * Math.min(1, dt * 6);
    this.pick.position.set(pickX * MM - this.pickOut * (pickX * MM + 14), 0, 0);
    this.pick.rotation.set(-pickAngle - (sim.opened ? displayTheta : sim.theta), 0, 0);

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.renderInset(this.frontEl, this.frontCamera, 10.5);
  }

  /** Draw the scene through an extra camera into a page element's rectangle. */
  private renderInset(el: HTMLElement | null, cam: THREE.OrthographicCamera, half: number) {
    if (!el || el.hidden) return;
    const r = el.getBoundingClientRect();
    const c = this.renderer.domElement.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    const x = r.left - c.left;
    const y = c.bottom - r.bottom;
    cam.top = half;
    cam.bottom = -half;
    cam.left = -half * (r.width / r.height);
    cam.right = half * (r.width / r.height);
    cam.updateProjectionMatrix();
    this.renderer.setViewport(x, y, r.width, r.height);
    this.renderer.setScissor(x, y, r.width, r.height);
    this.renderer.setScissorTest(true);
    this.renderer.render(this.scene, cam);
    this.renderer.setScissorTest(false);
    this.renderer.setViewport(0, 0, c.width, c.height);
  }
}

/**
 * Show a hint colour on a pin, or clear it with 0. The pin's own colour is
 * dimmed while hinted so the hint reads as the same amber, green or red on
 * every pin, whatever colour the pin is underneath.
 */
function tint(mat: THREE.MeshStandardMaterial, hint: number) {
  const base = (mat.userData.base ??= mat.color.getHex()) as number;
  if (mat.userData.hint === hint) return;
  mat.userData.hint = hint;
  mat.color.setHex(base);
  if (hint) mat.color.multiplyScalar(0.2);
  mat.emissive.setHex(hint);
  mat.emissiveIntensity = hint ? 0.75 : 0;
}

function makeLabel(text: string) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.font = '600 40px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = 'rgba(232,236,241,0.9)';
  g.fillText(text, 32, 34);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }),
  );
  s.scale.set(3.2, 3.2, 1);
  return s;
}
