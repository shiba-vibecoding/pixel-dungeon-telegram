import { describe, expect, it } from 'vitest';
import { AWAY_AFTER_MS, AWAY_MS, CALM_MS, EFFECT_MS, INPUT_MS, LIGHT_MS, Pace } from '../src/pace';

/** Frames of a 60 Hz screen from `from` for `ms`, how many are drawn. */
function drawn(pace: Pace, from: number, ms: number, busy = false): number {
  let count = 0;
  for (let now = from; now < from + ms; now += 1000 / 60) if (pace.due(now, busy)) count++;
  return count;
}

describe('the map pace', () => {
  it('draws every frame while something moves', () => {
    const pace = new Pace();
    expect(drawn(pace, 1000, 1000, true)).toBe(60);
  });

  it('draws the first frame at once and then breathes at the calm pace when nothing happens', () => {
    const pace = new Pace();
    expect(pace.due(5000, false)).toBe(true);
    // (Present at the start: the first frame begins the wait, full pace for a few seconds.)
    const frames = drawn(pace, 5000 + EFFECT_MS + 16, 1000);
    expect(frames).toBeGreaterThanOrEqual(1000 / (CALM_MS + 17) - 1);
    expect(frames).toBeLessThanOrEqual(1000 / CALM_MS + 1);
  });

  it('is at full pace for a while after a touch and after effects, then calm', () => {
    const pace = new Pace();
    pace.due(0, false);
    pace.touch(1000);
    expect(drawn(pace, 1000, INPUT_MS - 20)).toBe(Math.ceil((INPUT_MS - 20) / (1000 / 60)));
    pace.effect(3000);
    expect(drawn(pace, 3000, EFFECT_MS - 20)).toBeGreaterThan(Math.floor((EFFECT_MS - 20) / (1000 / 60)) - 2);
    const after = drawn(pace, 3000 + EFFECT_MS + 20, 1000);
    expect(after).toBeLessThan(30);
  });

  it('draws fewer frames on a phone that «auto» found slow', () => {
    const pace = new Pace();
    pace.due(0, false);
    const calm = EFFECT_MS + 100;
    pace.due(calm, false, true);
    let frames = 0;
    for (let now = calm + 16; now < calm + 1016; now += 1000 / 60) if (pace.due(now, false, true)) frames++;
    expect(frames).toBeLessThanOrEqual(1000 / LIGHT_MS + 1);
    expect(frames).toBeGreaterThan(8);
  });

  it('slows further once the player is away, and wakes at a touch', () => {
    const pace = new Pace();
    pace.due(0, false);
    const far = AWAY_AFTER_MS + 5000;
    pace.due(far, false);
    const frames = drawn(pace, far + 16, 1000);
    expect(frames).toBeLessThanOrEqual(1000 / AWAY_MS + 1);
    pace.touch(far + 1100);
    expect(drawn(pace, far + 1100, 200)).toBe(Math.ceil(200 / (1000 / 60)));
  });

  it('draws a forced frame whatever the pace', () => {
    const pace = new Pace();
    pace.due(0, false);
    const calm = EFFECT_MS + 100;
    pace.due(calm, false);
    expect(pace.due(calm + 16, false)).toBe(false);
    pace.force();
    expect(pace.due(calm + 17, false)).toBe(true);
    expect(pace.due(calm + 18, false)).toBe(false);
  });

  it('is not starved by a clock that jumps back', () => {
    const pace = new Pace();
    pace.due(100_000, false);
    expect(pace.due(500, false)).toBe(true);
  });

  it('counts what it was asked and what it drew', () => {
    const pace = new Pace();
    pace.due(0, false);
    drawn(pace, EFFECT_MS + 100, 1000);
    expect(pace.asked).toBeGreaterThanOrEqual(60);
    expect(pace.drew).toBeLessThan(pace.asked);
  });
});
