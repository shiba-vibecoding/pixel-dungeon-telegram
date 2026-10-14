import { HEIGHT, LENGTH, WIDTH } from './level/geometry';
import { F, hasFlag } from './level/terrain';

/*
 * Field of view: recursive shadow casting in eight octants, ported from Shattered's
 * ShadowCaster. Rows are scanned outward from the viewer; a line-of-sight blocker
 * narrows the slopes still open to the rows behind it.
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

/**
 * Level.viewDistance: the caves (depths 11-15) are dark, and the demon halls
 * darker the deeper they go (HallsLevel), down to a single cell; the last
 * shop's level before them (depth 21, LastShopLevel) keeps the default.
 *
 * `darkness` (the DARKNESS challenge, "Into darkness") only changes the
 * default the field starts with (2 instead of 8, Level.viewDistance): the caves and the halls set
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
export const DARKNESS_VIEW_DISTANCE = 2;

/** Light.DISTANCE: how far a torch lets one see, and the demons of the halls see anyway. */
export const LIGHT_DISTANCE = 4;

/**
 * Cells visible from `pos`, given which cells block line of sight: Shattered's ShadowCaster (the slope-based scan of
 * eight octants, in place of Pixel Dungeon's interval lists, which let a view peek past wall corners into the rooms
 * beyond). Each octant is mirrored in x, y and x=y; a blocking cell is seen, what lies behind it is not.
 */
export function castShadow(
pos: number, losBlocking: (cell: number) => boolean, distance = MAX_VIEW_DISTANCE): boolean[] {
  const fov = new Array<boolean>(LENGTH).fill(false);
  const cx = pos % WIDTH;
  const cy = Math.trunc(pos / WIDTH);
  if (distance > ROUNDING_MAX) distance = ROUNDING_MAX;
  fov[pos] = true;
  if (distance < 1) return fov;

  let limits = rounding[distance]!;
  if (distance === 2) {
    // At a view distance of 2 the corners of vision are filled in (otherwise it punishes diagonal movement).
    limits = limits.slice();
    limits[2] = 2;
  }

  // ShadowCaster.scanOctant: rows outward from the viewer, `lSlope`..`rSlope` the part of the octant still open.
  const scan = (row: number, lSlope: number, rSlope: number, mX: number, mY: number, mXY: boolean): void => {
    let inBlocking = false;
    for (; row <= distance; row++) {
      // No space left to look through.
      if (rSlope < lSlope) return;

      // Offset by slightly less than half a cell, so slopes just touching a cell count.
      const start = lSlope === 0 ? 0 : Math.floor((row - 0.5) * lSlope + 0.499);
      const end = rSlope === 1 ? limits[row]! : Math.min(limits[row]!, Math.ceil((row + 0.5) * rSlope - 0.499));

      for (let col = start; col <= end; col++) {
        // The slope at the end of a cell is a whole cell further than at its beginning, and the cell before is blocking.
        if (col === end && inBlocking && Math.ceil((row - 0.5) * rSlope - 0.499) !== end) break;

        const x = mXY ? cx + mY * row : cx + mX * col;
        const y = mXY ? cy + mX * col : cy + mY * row;
        const inside = x >= 0 && x < WIDTH && y >= 0 && y < HEIGHT;
        const cell = y * WIDTH + x;
        if (inside) fov[cell] = true;

        // Beyond the grid counts as a wall.
        if (!inside || losBlocking(cell)) {
          if (!inBlocking) {
            inBlocking = true;
            // A new scan one row deeper, ending at the left side of this cell.
            if (col !== start) scan(row + 1, lSlope, (col - 0.5) / (row + 0.5), mX, mY, mXY);
          }
        } else if (inBlocking) {
          inBlocking = false;
          // This scan goes on to the right of the cell it passed.
          lSlope = (col - 0.5) / (row - 0.5);
        }
      }

      // A row that ends in a wall ends the scan.
      if (inBlocking) return;
    }
  };

  scan(1, 0, 1, +1, -1, false);
  scan(1, 0, 1, -1, +1, true);
  scan(1, 0, 1, +1, +1, true);
  scan(1, 0, 1, +1, +1, false);
  scan(1, 0, 1, -1, +1, false);
  scan(1, 0, 1, +1, -1, true);
  scan(1, 0, 1, -1, -1, true);
  scan(1, 0, 1, -1, -1, false);
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
