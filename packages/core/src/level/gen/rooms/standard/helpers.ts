import { T } from '../../../terrain';
import type { GenLevel } from '../../genlevel';
import { Painter } from '../../painter';
import type { Point } from '../../rect';
import type { Room } from '../../room';

/* What several of the standard rooms share: PathFinder over a room's own grid, Java's float rounding, the ways in and out. */

export const f32 = Math.fround;

/** Java's Math.round(float): the nearest whole number, halves up; 0 for NaN. */
export const jround = (x: number): number => (Number.isNaN(x) ? 0 : Math.floor(x + 0.5));

/**
 * PathFinder.buildDistanceMap(to, passable) on a grid `w` cells wide (PathFinder.setMapSize to a
 * room's inside): which cells can be reached from `to`, 8-way, never wrapping round an edge.
 */
export function reachable(w: number, size: number, to: number, passable: readonly boolean[]): boolean[] {
  const reached = new Array<boolean>(size).fill(false);
  if (to < 0 || to >= size) return reached;
  const dirLR = [-1 - w, -1, -1 + w, -w, +w, +1 - w, +1, +1 + w];
  const queue = [to];
  reached[to] = true;
  for (let head = 0; head < queue.length; head++) {
    const step = queue[head]!;
    const start = step % w === 0 ? 3 : 0;
    const end = (step + 1) % w === 0 ? 3 : 0;
    for (let i = start; i < dirLR.length - end; i++) {
      const n = step + dirLR[i]!;
      if (n >= 0 && n < size && passable[n] && !reached[n]) {
        reached[n] = true;
        queue.push(n);
      }
    }
  }
  return reached;
}

/** The way up as the XEntranceRooms put it (LevelTransition.REGULAR_ENTRANCE, whatever the depth). */
export function regularEntrance(level: GenLevel, cell: number, terrain: number): void {
  Painter.set(level, cell, terrain);
  level.addTransition(cell, 'entrance');
}

/** The way down (LevelTransition.REGULAR_EXIT) on a terrain of the room's choosing. */
export function regularExit(level: GenLevel, cell: number, terrain: number): void {
  Painter.set(level, cell, terrain);
  level.addTransition(cell, 'exit');
}

/**
 * Where the patchy entrance and exit rooms put the way in or out: two cells in from the walls, on
 * no `blocked` terrain and nobody; after 30 tries (a small, cramped room), anywhere beside a
 * cell that `opens`.
 */
export function crampedCell(level: GenLevel, room: Room, blocked: (t: number) => boolean, opens: (t: number) => boolean): number {
  let cell: number;
  let tries = 30;
  let valid: boolean;
  do {
    cell = level.pointToCell(room.random(2));
    if (tries-- > 0) {
      valid = !blocked(level.map[cell]!) && !level.findMob(cell);
    } else {
      valid = false;
      for (const i of level.neighbours4) if (opens(level.map[cell + i]!)) valid = true;
      valid = valid && !level.findMob(cell);
    }
  } while (!valid);
  return cell;
}

/** Clears the eight cells round one to floor. */
export function clearAround(level: GenLevel, cell: number): void {
  for (const i of level.neighbours8) Painter.set(level, cell + i, T.EMPTY);
}

/** The exit rooms' canPlaceCharacter: nobody is put on the way down. */
export const notOnExit = (p: Point, l: GenLevel): boolean => l.pointToCell(p) !== l.exit();
