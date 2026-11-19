# Lockpicking Simulator

A browser-based lockpicking trainer for locksmiths and locksport hobbyists. You pick 3D locks with a mouse while a cutaway view shows what every pin, wafer or disc is doing.

The locks are modelled procedurally and picked with a physics simulation, not scripted animations: pins bind because of small differences in tolerance, spools produce false sets because of their shape, and a pick that is too tall for the keyway really does lift the pins it should have passed under.

**This is only a simulator.** The feel, tolerances and forces are approximations, and skill here will not transfer exactly to a real lock.

## What's in it

**Fifteen locks, each with a guided lesson**

- Pin tumbler: two- and three-pin trainers, a standard five-pin, and five-pin locks with spools, mixed security pins, and serrated key pins
- Dimple: single row, side rows, telescoping (pin-in-pin) chambers, and combinations with spools
- Disc detainer: six discs, and nine discs with false gates
- Wafer: five and seven wafers

**A pick case**

- Short hook, deep hook, half-diamond, triple-peak rake and snake rake
- Dimple flag pick and disc detainer pick
- Bottom-of-keyway and top-of-keyway tension tools
- You choose which tools are in your case; a lock nothing in the case fits cannot be picked

**A lock builder**

Build your own pin tumbler lock with one to seven stacks. For each stack you choose the key pin (standard or serrated), its length, and the driver: standard, spool, serrated, spool-errated, mushroom, double mushroom, barrel, gin or tree.

**Views and feedback**

- Cutaway, X-ray and solid (blind) views, with front and side inset views
- Optional colour hints for binding, set and overset pins
- Sound, a log of what just happened, and gauges for tension, pick force and plug rotation

## Running it

You need [Node.js](https://nodejs.org/) 22.12 or later.

```sh
npm install
npm run dev
```

Then open the address Vite prints, usually <http://localhost:5173>.

Other commands:

| Command | What it does |
| --- | --- |
| `npm run build` | Type-check and build for production into `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm test` | Run the physics and lesson tests |

## Controls

| Input | Action |
| --- | --- |
| Mouse | Move the pick. On a disc detainer, hold and drag up to turn a disc |
| Wheel, or W / S | More or less tension |
| Space | Drop all tension |
| T | Next pick in the case |
| Right-drag | Orbit the camera |
| + / − | Zoom |
| R | Reset the lock |
| N | New pinning |

## How it's built

TypeScript, [Three.js](https://threejs.org/) and [Vite](https://vite.dev/), with [Vitest](https://vitest.dev/) for tests. There are no art assets: every lock, pin and tool is generated in code.

| Path | Contents |
| --- | --- |
| `src/sim/lock.ts` | Lock geometry, pin and pick definitions, lock generation |
| `src/sim/physics.ts` | Pin tumbler, dimple and wafer physics |
| `src/sim/disc.ts` | Disc detainer physics |
| `src/render/` | 3D models and the view |
| `src/lessons.ts` | Guided lessons |
| `src/main.ts` | The app: input, pick case, lock builder, interface |
| `tests/` | Tests that pick the locks and check how they behave |

The simulation works in SI units and the rendering in millimetres. Dimensions are estimates based on common locks, not measurements of any particular product.

## Licence

[MIT](LICENSE)
