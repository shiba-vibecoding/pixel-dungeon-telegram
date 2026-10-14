import { HEIGHT, LENGTH, WIDTH } from './level/geometry';
import { F, hasFlag } from './level/terrain';

/*
 * Field of view: recursive shadow casting in eight sectors, ported from the
 * original ShadowCaster. Rows are scanned outward from the viewer; every
 * line-of-sight blocker adds an angular interval that hides the cells behind.
 */

export const MAX_VIEW_DISTANCE = 8;

/** Shattered's ShadowCaster.MAX_DISTANCE: far enough for magical sight (12) and clairvoyance (20). */
const ROUNDING_MAX = 20;

/**
 * rounding[r][p]: how far a row p cells out extends within a circle of radius r, which the original takes as
 * min(p, round(r cos(asin(p / (r + 0.5))))). Done in integers so that no engine's trigonometry can differ:
 * r cos(asin(q)) is r sqrt((2r+1)^2 - 4p^2) / (2r+1), and round(v) is the greatest k with (2k-1)(2r+1) <= 2r sqrt(D),
 * i.e. (2k-1)^2 (2r+1)^2 <= 4 r^2 D. The test pins the table.
 */
export const rounding: number[][] = (() => {
  const table: number[][] = [[]];
  for (let r = 1; r <= ROUNDING_MAX; r++) {
    const row = new Array<number>(r + 1).fill(0);
    for (let p = 1; p <= r; p++) {
      const d = (2 * r + 1) * (2 * r + 1) - 4 * p * p;
      let k = 0;
      while ((2 * k + 1) * (2 * k + 1) * (2 * r + 1) * (2 * r + 1) <= 4 * r * r * d) k++;
      row[p] = Math.min(p, k);
    }
    table.push(row);
  }
  return table;
})();

class Obstacles {
  private readonly a1: number[] = [];
  private readonly a2: number[] = [];
  private length = 0;
  private limit = 0;

  reset(): void {
    this.length = 0;
    this.limit = 0;
  }

  add(o1: number, o2: number): void {
    if (this.length > this.limit && o1 <= this.a2[this.length - 1]!) {
      // Adjacent blocking cells merge into one interval.
      this.a2[this.length - 1] = o2;
    } else {
      this.a1[this.length] = o1;
      this.a2[this.length++] = o2;
    }
  }

  isBlocked(a: number): boolean {
    for (let i = 0; i < this.limit; i++) {
      if (a >= this.a1[i]! && a <= this.a2[i]!) {
        return true;
      }
    }
    return false;
  }

  nextRow(): void {
    this.limit = this.length;
  }
}

/**
 * Level.viewDistance: the caves (depths 11-15) are dark, and the demon halls
 * darker the deeper they go (HallsLevel), down to a single cell; the last
 * shop's level before them (depth 21, LastShopLevel) keeps the default.
 *
 * `darkness` (the DARKNESS challenge, "Into darkness") only changes the
 * default the field starts with (3 instead of 8): the caves and the halls set
 * their own distance in their constructors, after it, so they stay as they are
 * вЂ” in the caves one even sees further than elsewhere under the challenge.
 * Only heroes see by this; monsters keep their own sight (see ai.ts).
 */
export function viewDistance(depth: number, darkness = false): number {
  // PrisonBossLevel: the whole of Tengu's arena is in sight (12, whatever the challenges).
  if (depth === 10) return 12;
  if (depth >= 11 && depth <= 15) return 6;
  if (depth >= 22 && depth <= 24) return Math.max(25 - depth, 1);
  // HallsBossLevel and LastLevel: min(4, the level's).
  if (depth >= 25) return Math.min(4, darkness ? DARKNESS_VIEW_DISTANCE : MAX_VIEW_DISTANCE);
  return darkness ? DARKNESS_VIEW_DISTANCE : MAX_VIEW_DISTANCE;
}

/** Level.viewDistance under the DARKNESS challenge. */
export const DARKNESS_VIEW_DISTANCE = 3;

/** Light.DISTANCE: how far a torch lets one see, and the demons of the halls see anyway. */
export const LIGHT_DISTANCE = 4;

/** Cells visible from `pos`, given which cells block line of sight. */
export function castShadow(
pos: number, losBlocking: (cell: number) => boolean, distance = MAX_VIEW_DISTANCE): boolean[] {
  const fov = new Array<boolean>(LENGTH).fill(false);
  const cx = pos % WIDTH;
  const cy = Math.trunc(pos / WIDTH);
  const limits = rounding[Math.min(distance, ROUNDING_MAX)]!;
  const obstacles = new Obstacles();
  fov[pos] = true;

  const scan = (m1: number, m2: number, m3: number, m4: number): void => {
    obstacles.reset();
    for (let p = 1; p <= distance; p++) {
      const dq2 = 0.5 / p;
      for (let q = 0; q <= limits[p]!; q++) {
        const x = cx + q * m1 + p * m3;
        const y = cy + p * m2 + q * m4;
        if (y < 0 || y >= HEIGHT || x < 0 || x >= WIDTH) continue;
        const a0 = q / p;
        const a1 = a0 - dq2;
        const a2 = a0 + dq2;
        const cell = y * WIDTH + x;
        if (!(obstacles.isBlocked(a0) && obstacles.isBlocked(a1) && obstacles.isBlocked(a2))) {
          fov[cell] = true;
        }
        if (losBlocking(cell)) {
          obstacles.add(a1, a2);
        }
      }
      obstacles.nextRow();
    }
  };

  scan(+1, +1, 0, 0);
  scan(-1, +1, 0, 0);
  scan(+1, -1, 0, 0);
  scan(-1, -1, 0, 0);
  scan(0, 0, +1, +1);
  scan(0, 0, -1, +1);
  scan(0, 0, +1, -1);
  scan(0, 0, -1, -1);
  return fov;
}

export function terrainBlocksSight(map: readonly number[]): (cell: number) => boolean {
  return (cell) => hasFlag(map[cell]!, F.LOS_BLOCKING);
}

/**
 * The cells within a circle of `radius` around `pos`, row by row as StoneOfClairvoyance.activate and Hero.search
 * (with foresight) lay it out from ShadowCaster.rounding.
 */
export function circleCells(pos: number, radius: number): number[] {
  const r = Math.min(radius, ROUNDING_MAX);
  const row = rounding[r]!;
  const cx = pos % WIDTH;
  const cy = Math.trunc(pos / WIDTH);
  const cells: number[] = [];
  for (let y = Math.max(0, cy - r); y <= Math.min(HEIGHT - 1, cy + r); y++) {
    const dy = Math.abs(cy - y);
    let left: number;
    if (row[dy]! < dy) {
      left = cx - row[dy]!;
    } else {
      left = r;
      while (row[left]! < row[dy]!) left--;
      left = cx - left;
    }
    const right = Math.min(WIDTH - 1, cx + cx - left);
    for (let x = Math.max(0, left); x <= right; x++) cells.push(x + y * WIDTH);
  }
  return cells;
}
