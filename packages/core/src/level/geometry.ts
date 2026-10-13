/* Map dimensions, neighbourhoods and the integer rectangle used by rooms. */

export const WIDTH = 48;
export const HEIGHT = 48;
export const LENGTH = WIDTH * HEIGHT;
/**
 * How many cells a side a level spreads over for one hero: the original's 32. The grid is
 * bigger so that a party's depths can spread wider (party.ts); the rest is solid rock.
 */
export const SOLO_SPAN = 32;

export const NEIGHBOURS4: readonly number[] = [-WIDTH, +1, +WIDTH, -1];
export const NEIGHBOURS8: readonly number[] = [
  +1, -1, +WIDTH, -WIDTH, +1 + WIDTH, +1 - WIDTH, -1 + WIDTH, -1 - WIDTH,
];
export const NEIGHBOURS9: readonly number[] = [0, ...NEIGHBOURS8];

export interface Point {
  x: number;
  y: number;
}

export const cell = (x: number, y: number): number => x + y * WIDTH;
export const cellX = (pos: number): number => pos % WIDTH;
export const cellY = (pos: number): number => Math.trunc(pos / WIDTH);

/** Chebyshev distance between two cells. */
export function distance(a: number, b: number): number {
  return Math.max(Math.abs(cellX(a) - cellX(b)), Math.abs(cellY(a) - cellY(b)));
}

/** Squared straight-line distance: exact in integers, to compare distances without a square root. */
export function squaredDistance(a: number, b: number): number {
  const dx = cellX(a) - cellX(b);
  const dy = cellY(a) - cellY(b);
  return dx * dx + dy * dy;
}

/** Level.trueDistance: as the crow flies (Math.sqrt is correctly rounded on every engine, Math.hypot is not). */
export function trueDistance(a: number, b: number): number {
  return Math.sqrt(squaredDistance(a, b));
}

export function adjacent(a: number, b: number): boolean {
  const diff = Math.abs(a - b);
  return diff === 1 || diff === WIDTH || diff === WIDTH + 1 || diff === WIDTH - 1;
}

/** Inclusive-edge rectangle: a room's walls lie on left/top/right/bottom. */
export class Rect {
  constructor(
    public left = 0,
    public top = 0,
    public right = 0,
    public bottom = 0,
  ) {}

  width(): number {
    return this.right - this.left;
  }

  height(): number {
    return this.bottom - this.top;
  }

  square(): number {
    return this.width() * this.height();
  }

  set(left: number, top: number, right: number, bottom: number): this {
    this.left = left;
    this.top = top;
    this.right = right;
    this.bottom = bottom;
    return this;
  }

  intersect(other: Rect): Rect {
    return new Rect(
      Math.max(this.left, other.left),
      Math.max(this.top, other.top),
      Math.min(this.right, other.right),
      Math.min(this.bottom, other.bottom),
    );
  }
}
