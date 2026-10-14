import { LENGTH, NEIGHBOURS9, WIDTH } from './geometry';
import { F, T, terrainFlags } from './terrain';

/* Flag maps of a finished level: which walls are worth showing, and where one may walk. */

/** Level.cleanWalls: cells worth showing on the map, those next to something that is not solid wall. */
export function discoverable(map: readonly number[]): boolean[] {
  const result = new Array<boolean>(LENGTH).fill(false);
  for (let i = 0; i < LENGTH; i++) {
    for (const n of NEIGHBOURS9) {
      const j = i + n;
      if (j >= 0 && j < LENGTH && map[j] !== T.WALL && map[j] !== T.WALL_DECO) {
        result[i] = true;
        break;
      }
    }
  }
  return result;
}

/** Passability with the map border always closed. */
export function passable(map: readonly number[]): boolean[] {
  const result = map.map((t) => (terrainFlags[t]! & F.PASSABLE) !== 0);
  for (let i = 0; i < LENGTH; i++) {
    const x = i % WIDTH;
    if (i < WIDTH || i >= LENGTH - WIDTH || x === 0 || x === WIDTH - 1) {
      result[i] = false;
    }
  }
  return result;
}

/**
 * Level.set during play: a cell's terrain changes (Goo's lair floods, a fist boils water away), and
 * the water and chasm tiles take the shape of their new surroundings.
 */
export function setTerrain(map: number[], cell: number, terrain: number): void {
  // (Water and chasms take the shape of their surroundings as the client draws them: tilevisuals.ts.)
  map[cell] = terrain;
}
