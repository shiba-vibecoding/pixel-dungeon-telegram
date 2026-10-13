import { isBossDepth, type LevelBuilder } from './builder';
import { Feeling } from './gen/dungeon';
import { cell, LENGTH, WIDTH } from './geometry';
import type { RegionStyle } from './regular';
import { RoomType } from './room';
import { T } from './terrain';

/* Depths 11–14: the caves (CavesLevel). */

export const CAVES_STYLE: RegionStyle = {
  minRoomSize: 7,
  maxRoomSize: 9,
  water: (feeling) => [feeling === Feeling.WATER ? 0.6 : 0.45, 6],
  grass: (feeling) => [feeling === Feeling.GRASS ? 0.55 : 0.35, 3],
  trapChances: [1, 1, 1, 1, 1, 1, 1, 1],
  decorate: decorateCaves,
};

/**
 * Rounded corners in the bigger rooms, rubble along the walls, ore veins in
 * the rock, a sign by the entrance, and chasms opening between neighbouring
 * rooms (but not just above a boss).
 */
function decorateCaves(level: LevelBuilder): void {
  const { map, rng } = level;
  for (const room of level.rooms) {
    if (room.type !== RoomType.STANDARD || room.width() <= 3 || room.height() <= 3) continue;
    const s = room.square();
    const corners: Array<[number, number, number]> = [
      [cell(room.left + 1, room.top + 1), -1, -WIDTH],
      [cell(room.right - 1, room.top + 1), 1, -WIDTH],
      [cell(room.left + 1, room.bottom - 1), -1, WIDTH],
      [cell(room.right - 1, room.bottom - 1), 1, WIDTH],
    ];
    for (const [corner, side, vertical] of corners) {
      if (rng.int(s) > 8 && map[corner + side] === T.WALL && map[corner + vertical] === T.WALL) map[corner] = T.WALL;
    }
    for (const [n, door] of room.connected) {
      if ((n.type === RoomType.STANDARD || n.type === RoomType.TUNNEL) && rng.int(3) === 0 && door) {
        map[cell(door.x, door.y)] = T.EMPTY_DECO;
      }
    }
  }
  for (let i = WIDTH + 1; i < LENGTH - WIDTH; i++) {
    if (map[i] !== T.EMPTY) continue;
    const n = [1, -1, WIDTH, -WIDTH].filter((d) => map[i + d] === T.WALL).length;
    if (rng.int(6) <= n) map[i] = T.EMPTY_DECO;
  }
  for (let i = 0; i < LENGTH; i++) {
    if (map[i] === T.WALL && rng.int(12) === 0) map[i] = T.WALL_DECO;
  }

  const roomEntrance = level.roomEntrance!;
  for (let attempt = 0; attempt < 100; attempt++) {
    const pos = roomEntrance.random(rng);
    if (pos !== level.entrance) {
      map[pos] = T.EMPTY;
      break;
    }
  }

  if (isBossDepth(level.depth + 1)) return;
  for (const r of level.rooms) {
    if (r.type !== RoomType.STANDARD) continue;
    for (const n of r.neighbours) {
      if (n.type !== RoomType.STANDARD || r.connected.has(n)) continue;
      const w = r.intersect(n);
      if (w.left === w.right && w.bottom - w.top >= 5) {
        level.fill(w.left, w.top + 2, 1, w.bottom - 1 - (w.top + 2), T.CHASM);
      } else if (w.top === w.bottom && w.right - w.left >= 5) {
        level.fill(w.left + 2, w.top, w.right - 1 - (w.left + 2), 1, T.CHASM);
      }
    }
  }
}
