import type { LevelBuilder } from './builder';
import { Feeling } from './gen/dungeon';
import { LENGTH, NEIGHBOURS8, WIDTH } from './geometry';
import type { RegionStyle } from './regular';
import { F, hasFlag, T } from './terrain';

/* Depths 22–24: the demon halls (HallsLevel), their water a cold lava. Depth 21 is the last shop (last-shop.ts). */

export const HALLS_STYLE: RegionStyle = {
  minRoomSize: 7,
  maxRoomSize: 9,
  water: (feeling) => [feeling === Feeling.WATER ? 0.55 : 0.4, 6],
  grass: (feeling) => [feeling === Feeling.GRASS ? 0.55 : 0.3, 3],
  trapChances: [1, 1, 1, 1, 1, 1, 1, 1],
  decorate: decorateHalls,
};

/** Cracks where the floor is open, glowing runes on the walls, and a sign by the entrance. */
function decorateHalls(level: LevelBuilder): void {
  const { map, rng } = level;
  for (let i = WIDTH + 1; i < LENGTH - WIDTH - 1; i++) {
    if (map[i] === T.EMPTY) {
      const count = NEIGHBOURS8.filter((n) => hasFlag(map[i + n]!, F.PASSABLE)).length;
      if (rng.int(80) < count) map[i] = T.EMPTY_DECO;
    } else if (map[i] === T.WALL && map[i - 1] !== T.WALL_DECO && map[i - WIDTH] !== T.WALL_DECO && rng.int(4) === 0) {
      map[i] = T.WALL_DECO;
    }
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
