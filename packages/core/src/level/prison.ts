import type { LevelBuilder } from './builder';
import { Feeling } from './gen/dungeon';
import { LENGTH, WIDTH } from './geometry';
import type { RegionStyle } from './regular';
import { RoomType } from './room';
import { T } from './terrain';

/* Depths 6–9: the prison (PrisonLevel). */

export const PRISON_STYLE: RegionStyle = {
  minRoomSize: 7,
  maxRoomSize: 9,
  water: (feeling) => [feeling === Feeling.WATER ? 0.65 : 0.45, 4],
  grass: (feeling) => [feeling === Feeling.GRASS ? 0.6 : 0.4, 3],
  trapChances: [1, 1, 1, 1, 1, 1, 1, 1],
  // Prison corridors run along the walls rather than through the middle.
  roomTypes: (level) => {
    for (const room of level.rooms) {
      if (room.type === RoomType.TUNNEL) room.type = RoomType.PASSAGE;
    }
  },
  decorate: (level) => decoratePrison(level, 0.05, 6, 3),
};

/**
 * Blood stains in the corners, torches on the walls above the floor, and a
 * sign by the entrance. The boss level has more of everything.
 */
export function decoratePrison(level: LevelBuilder, stains: number, topTorches: number, torches: number): void {
  const { map, rng } = level;
  for (let i = WIDTH + 1; i < LENGTH - WIDTH - 1; i++) {
    if (map[i] !== T.EMPTY) continue;
    let c = stains;
    if (map[i + 1] === T.WALL && map[i + WIDTH] === T.WALL) c += 0.2;
    if (map[i - 1] === T.WALL && map[i + WIDTH] === T.WALL) c += 0.2;
    if (map[i + 1] === T.WALL && map[i - WIDTH] === T.WALL) c += 0.2;
    if (map[i - 1] === T.WALL && map[i - WIDTH] === T.WALL) c += 0.2;
    if (rng.float() < Math.fround(c)) map[i] = T.EMPTY_DECO;
  }
  const floorBelow = (i: number): boolean => map[i + WIDTH] === T.EMPTY || map[i + WIDTH] === T.EMPTY_SP;
  for (let i = 0; i < WIDTH; i++) {
    if (map[i] === T.WALL && floorBelow(i) && rng.int(topTorches) === 0) map[i] = T.WALL_DECO;
  }
  for (let i = WIDTH; i < LENGTH - WIDTH; i++) {
    if (map[i] === T.WALL && map[i - WIDTH] === T.WALL && floorBelow(i) && rng.int(torches) === 0) map[i] = T.WALL_DECO;
  }

  const roomEntrance = level.roomEntrance!;
  for (let attempt = 0; attempt < 100; attempt++) {
    const pos = roomEntrance.random(rng);
    if (pos !== level.entrance) {
      map[pos] = T.EMPTY;
      return;
    }
  }
}
