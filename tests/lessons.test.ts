import { describe, expect, it } from 'vitest';
import { PRESETS } from '../src/sim/lock';
import { DISC_PRESETS } from '../src/sim/disc';
import { LessonRunner, customLesson, lessonFor, type LessonPin, type LessonState } from '../src/lessons';

const pin = (over: Partial<LessonPin> = {}): LessonPin => ({
  label: '1',
  row: 'top',
  part: 'solid',
  spool: false,
  serratedDriver: false,
  serratedKey: false,
  status: 'free',
  touched: false,
  ...over,
});

describe('guided lessons', () => {
  it('every lock has a lesson that ends with opening it', () => {
    for (const id of [...PRESETS, ...DISC_PRESETS].map((p) => p.id)) {
      const lesson = lessonFor(id);
      expect(lesson, id).not.toBeNull();
      expect(lesson!.steps.length, id).toBeGreaterThanOrEqual(4);
      const opened: LessonState = { dt: 0.016, torque: 0.01, opened: true, inFalseSet: false, pins: [pin()] };
      expect(lesson!.steps.at(-1)!.done(opened, {}), id).toBe(true);
    }
  });

  it('steps advance in order as the player does each thing', () => {
    const runner = new LessonRunner(lessonFor('trainer2')!);
    const s: LessonState = { dt: 0.1, torque: 0, opened: false, inFalseSet: false, pins: [pin(), pin({ label: '2' })] };
    runner.update(s);
    expect(runner.index).toBe(0);
    // Tension must be held in range for half a second, not just passed through.
    s.torque = 0.012;
    runner.update(s);
    expect(runner.index).toBe(0);
    for (let k = 0; k < 6; k++) runner.update(s);
    expect(runner.index).toBe(1);
    // Touching a loose pin is not finding the binder.
    s.pins[0].touched = true;
    runner.update(s);
    expect(runner.index).toBe(1);
    s.pins[0].status = 'binding';
    runner.update(s);
    expect(runner.index).toBe(2);
    s.pins[0].status = 'set';
    runner.update(s);
    expect(runner.index).toBe(3);
    expect(runner.complete).toBe(false);
    s.opened = true;
    runner.update(s);
    expect(runner.complete).toBe(true);
  });

  it('coaches on an overset pin and on heavy or missing tension', () => {
    const runner = new LessonRunner(lessonFor('standard5')!);
    const s: LessonState = { dt: 0.1, torque: 0.012, opened: false, inFalseSet: false, pins: [pin(), pin({ label: '2' })] };
    for (let k = 0; k < 6; k++) runner.update(s);
    expect(runner.coach).toBeNull();
    s.pins[1].status = 'overset';
    runner.update(s);
    expect(runner.coach).toContain('Pin 2 is overset');
    s.pins[1].status = 'free';
    s.torque = 0.06;
    runner.update(s);
    expect(runner.coach).toContain('heavy');
    s.torque = 0;
    runner.update(s);
    expect(runner.coach).toContain('no tension');
  });
});

describe('lesson for a built lock', () => {
  const titles = (pins: LessonPin[]) => customLesson(pins).steps.map((q) => q.title);

  it('is the basic lesson for standard pins', () => {
    expect(titles([pin(), pin()])).toEqual([
      'Apply light tension',
      'Find the binding pin',
      'Set it',
      'Set the rest and open the lock',
    ]);
  });

  it('adds a step for each kind of security pin put in', () => {
    const t = titles([pin({ spool: true }), pin({ serratedDriver: true }), pin({ serratedKey: true })]);
    expect(t).toContain('Reach the false set');
    expect(t).toContain('Ease the spool through');
    expect(t).toContain('Lift through the serrations');
    expect(t).toContain('Stop at the set');
    expect(t[t.length - 1]).toBe('Set the rest and open the lock');
  });
});
