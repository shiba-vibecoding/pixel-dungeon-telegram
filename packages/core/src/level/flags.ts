import { LENGTH, NEIGHBOURS4, NEIGHBOURS9, WIDTH } from './geometry';
import { F, hasFlag, T, terrainFlags } from './terrain';

/*
 * Final touches on a generated map: water and chasm tiles take the shape of
 * their surroundings, and walls far from any open space become undiscoverable.
 */

function waterTile(map: readonly number[], pos: number): number {
  let tile: number = T.WATER_TILES;
  for (let j = 0; j < NEIGHBOURS4.length; j++) {
    if (hasFlag(map[pos + NEIGHBOURS4[j]!]!, F.UNSTITCHABLE)) {
      tile += 1 << j;
    }
  }
  return tile;
}

export function stitchTerrain(map: number[]): void {
  const water = map.map((t) => hasFlag(t, F.LIQUID));
  const pit = map.map((t) => hasFlag(t, F.PIT));
  for (let i = WIDTH; i < LENGTH - WIDTH; i++) {
    if (water[i]) {
      map[i] = waterTile(map, i);
    }
    if (pit[i] && !pit[i - WIDTH]) {
      const above = map[i - WIDTH]!;
      if (above === T.EMPTY_SP || above === T.STATUE_SP) {
        map[i] = T.CHASM_FLOOR_SP;
      } else if (water[i - WIDTH]) {
        map[i] = T.CHASM_WATER;
      } else if (hasFlag(above, F.UNSTITCHABLE)) {
        map[i] = T.CHASM_WALL;
      } else {
        map[i] = T.CHASM_FLOOR;
      }
    }
  }
}

/** Cells worth showing on the map: next to something that is not solid wall or pit. */
export function discoverable(map: readonly number[]): boolean[] {
  const result = new Array<boolean>(LENGTH).fill(false);
  for (let i = 0; i < LENGTH; i++) {
    let open = false;
    for (const n of NEIGHBOURS9) {
      const j = i + n;
      if (j >= 0 && j < LENGTH && map[j] !== T.WALL && map[j] !== T.WALL_DECO) {
        open = true;
        break;
      }
    }
    if (open) {
      open = false;
      for (const n of NEIGHBOURS9) {
        const j = i + n;
        if (j >= 0 && j < LENGTH && !hasFlag(map[j]!, F.PIT)) {
          open = true;
          break;
        }
      }
    }
    result[i] = open;
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
  map[cell] = terrain;
  stitchTerrain(map);
}
