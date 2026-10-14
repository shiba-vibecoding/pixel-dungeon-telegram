import { discoverable, LENGTH, T, TileSheet, WIDTH } from '@pd/core';

/*
 * The fog of war as Shattered lays it (tiles/FogOfWar.updateTexture): what the hero sees is clear, what the party
 * has seen is dimmed, the rest is black. Two things keep the rooms beyond a wall dark that a plain per-cell fog
 * lets glow:
 *  - a cell that is solid rock deep in the walls, with nothing walkable beside it (Level.discoverable), is always black;
 *  - a wall takes the darker of its own fog and the fog of the cell below it (the face one sees is the face of
 *    the wall that stands over that cell), and an inner wall (a wall over a wall) is lit by halves, each half only
 *    as far as the cells beside it are seen. So the back of a room's wall, seen from the room next to it, stays black.
 */

/** Fog values: the alpha of the black laid over a cell. */
export const FOG_CLEAR = 0;
export const FOG_REMEMBERED = 0.55;
export const FOG_BLACK = 1;

const isWall = (map: readonly number[], cell: number): boolean => TileSheet.wallStitcheable(map[cell] ?? T.WALL);

/**
 * The fog over every cell as two halves, left and right (index 2 * cell, 2 * cell + 1). `visible` is what the hero
 * sees now, `explored` what the party has seen.
 */
export function fogHalves(
  map: readonly number[], visible: readonly boolean[], explored: readonly boolean[], out: Float32Array = new Float32Array(LENGTH * 2),
): Float32Array {
  const open = discoverable(map);
  const dark = (cell: number): number => (visible[cell] ? FOG_CLEAR : explored[cell] ? FOG_REMEMBERED : FOG_BLACK);
  for (let cell = 0; cell < LENGTH; cell++) {
    let left: number;
    let right: number;
    if (!open[cell] || (!visible[cell] && !explored[cell])) {
      left = right = FOG_BLACK;
    } else if (isWall(map, cell)) {
      const below = cell + WIDTH;
      if (below >= LENGTH) {
        left = right = FOG_BLACK;
      } else if (isWall(map, below)) {
        // An inner wall: each half looks to the side it faces.
        if (cell % WIDTH === 0) left = FOG_BLACK;
        else if (isWall(map, cell - 1)) left = isWall(map, below - 1) ? FOG_BLACK : Math.max(dark(cell), dark(below - 1), dark(cell - 1));
        else left = Math.max(dark(cell), dark(cell - 1));
        if ((cell + 1) % WIDTH === 0) right = FOG_BLACK;
        else if (isWall(map, cell + 1)) right = isWall(map, below + 1) ? FOG_BLACK : Math.max(dark(cell), dark(below + 1), dark(cell + 1));
        else right = Math.max(dark(cell), dark(cell + 1));
      } else {
        // A wall facing the camera: as dark as the cell below it.
        left = right = Math.max(dark(cell), dark(below));
      }
    } else {
      left = right = dark(cell);
    }
    out[cell * 2] = left;
    out[cell * 2 + 1] = right;
  }
  return out;
}
