import type { LevelBuilder } from './builder';
import { Feeling } from './gen/dungeon';
import { LENGTH } from './geometry';
import type { RegionStyle } from './regular';
import { T } from './terrain';

/* Depths 16–19: the dwarven city (CityLevel). */

export const CITY_STYLE: RegionStyle = {
  minRoomSize: 7,
  maxRoomSize: 9,
  water: (feeling) => [feeling === Feeling.WATER ? 0.65 : 0.45, 4],
  grass: (feeling) => [feeling === Feeling.GRASS ? 0.6 : 0.4, 3],
  trapChances: [1, 1, 1, 1, 1, 1, 1, 1],
  decorate: decorateCity,
};

/** Cracked paving here and there, carvings on the walls, and a sign by the entrance. */
function decorateCity(level: LevelBuilder): void {
  const { map, rng } = level;
  for (let i = 0; i < LENGTH; i++) {
    if (map[i] === T.EMPTY && rng.int(10) === 0) map[i] = T.EMPTY_DECO;
    else if (map[i] === T.WALL && rng.int(8) === 0) map[i] = T.WALL_DECO;
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
