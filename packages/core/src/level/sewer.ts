import type { LevelBuilder } from './builder';
import { Feeling } from './gen/dungeon';
import { LENGTH, WIDTH } from './geometry';
import type { RegionStyle } from './regular';
import { T } from './terrain';

/* Depths 1–4: the city sewers. */

export const SEWER_STYLE: RegionStyle = {
  minRoomSize: 7,
  maxRoomSize: 9,
  water: (feeling) => [feeling === Feeling.WATER ? 0.6 : 0.45, 5],
  grass: (feeling) => [feeling === Feeling.GRASS ? 0.6 : 0.4, 4],
  trapChances: [1, 1, 1, 1, 1, 1, 1, 1],
  decorate: decorateSewer,
};

function decorateSewer(level: LevelBuilder): void {
  const { map, rng } = level;

  // Drains above water.
  for (let i = 0; i < WIDTH; i++) {
    if (map[i] === T.WALL && map[i + WIDTH] === T.WATER && rng.int(4) === 0) {
      map[i] = T.WALL_DECO;
    }
  }
  for (let i = WIDTH; i < LENGTH - WIDTH; i++) {
    if (map[i] === T.WALL && map[i - WIDTH] === T.WALL && map[i + WIDTH] === T.WATER && rng.int(2) === 0) {
      map[i] = T.WALL_DECO;
    }
  }

  // Moss grows in corners.
  for (let i = WIDTH + 1; i < LENGTH - WIDTH - 1; i++) {
    if (map[i] === T.EMPTY) {
      const count =
        (map[i + 1] === T.WALL ? 1 : 0) +
        (map[i - 1] === T.WALL ? 1 : 0) +
        (map[i + WIDTH] === T.WALL ? 1 : 0) +
        (map[i - WIDTH] === T.WALL ? 1 : 0);
      if (rng.int(16) < count * count) {
        map[i] = T.EMPTY_DECO;
      }
    }
  }

  // A sign next to the entrance.
  const roomEntrance = level.roomEntrance!;
  for (let attempt = 0; attempt < 100; attempt++) {
    const pos = roomEntrance.random(rng);
    if (pos !== level.entrance) {
      map[pos] = T.EMPTY;
      return;
    }
  }
}
