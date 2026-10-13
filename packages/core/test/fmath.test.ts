import { describe, expect, it } from 'vitest';
import { dexp, dlog, dpow, ipow } from '../src/fmath';
import { rounding } from '../src/fov';
import { cell, squaredDistance, trueDistance } from '../src/level/geometry';

/** ShadowCaster.rounding as the original's formula gave it (min(p, round(r cos(asin(p / (r + 0.5)))))), r up to 20. */
const ROUNDING = [
  [], [0, 1], [0, 1, 1], [0, 1, 2, 2], [0, 1, 2, 3, 2], [0, 1, 2, 3, 3, 2], [0, 1, 2, 3, 4, 4, 2], [0, 1, 2, 3, 4, 5, 4, 3],
  [0, 1, 2, 3, 4, 5, 6, 5, 3], [0, 1, 2, 3, 4, 5, 6, 6, 5, 3], [0, 1, 2, 3, 4, 5, 6, 7, 6, 5, 3],
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 7, 5, 3], [0, 1, 2, 3, 4, 5, 6, 7, 8, 8, 7, 6, 3], [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 9, 8, 6, 4],
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 9, 8, 6, 4], [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 9, 8, 6, 4],
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 11, 10, 8, 7, 4], [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 11, 10, 9, 7, 4],
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 12, 11, 9, 7, 4], [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 13, 12, 11, 9, 7, 4],
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 14, 13, 11, 10, 8, 4],
];

describe('integer maths', () => {
  it('the field of view rounding table is the original formula, computed in integers', () => {
    expect(rounding).toEqual(ROUNDING);
  });

  it('whole powers are repeated multiplication', () => {
    expect(ipow(1.5, 0)).toBe(1);
    expect(ipow(1.5, 3)).toBe(1.5 * 1.5 * 1.5);
    expect(ipow(0.5, -3)).toBe(8);
    expect(dpow(1.2, 4)).toBe(ipow(1.2, 4));
  });

  it('fractional powers come close to the engine (they only have to agree with each other)', () => {
    for (const [b, e] of [[0.85, 2.5], [0.85, 0.3], [0.85, 7.77], [1.1, 0.5]] as const) {
      expect(Math.abs(dpow(b, e) - Math.pow(b, e))).toBeLessThan(1e-12);
    }
    expect(Math.abs(dexp(1) - Math.E)).toBeLessThan(1e-14);
    expect(Math.abs(dlog(10) - Math.LN10)).toBeLessThan(1e-14);
  });

  it('distances are exact', () => {
    expect(squaredDistance(cell(3, 4), cell(0, 0))).toBe(25);
    expect(trueDistance(cell(3, 4), cell(0, 0))).toBe(5);
    expect(trueDistance(cell(1, 1), cell(0, 0))).toBe(Math.SQRT2);
  });
});
