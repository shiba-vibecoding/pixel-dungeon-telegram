import { javaRound } from './painter';
import { Random } from './random';

/*
 * levels/Patch: a random boolean map, smoothed in clustering passes (a 3x3 majority filter) into
 * patches. With forceFillRate the fill is pulled towards half before smoothing, and cells are then
 * filled in or emptied until the share asked for is reached.
 */
export function generatePatch(w: number, h: number, fill: number, clustering: number, forceFillRate: boolean): boolean[] {
  const f32 = Math.fround;
  const length = w * h;
  let cur = new Array<boolean>(length).fill(false);
  let off = new Array<boolean>(length).fill(false);

  let fillDiff = -javaRound(f32(length * fill));
  if (forceFillRate && clustering > 0) fill = f32(fill + f32(f32(0.5 - fill) * 0.5));

  for (let i = 0; i < length; i++) {
    off[i] = Random.Float() < fill;
    if (off[i]) fillDiff++;
  }

  for (let i = 0; i < clustering; i++) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const pos = x + y * w;
        let count = 0;
        let neighbours = 0;
        if (y > 0) {
          if (x > 0) {
            if (off[pos - w - 1]) count++;
            neighbours++;
          }
          if (off[pos - w]) count++;
          neighbours++;
          if (x < w - 1) {
            if (off[pos - w + 1]) count++;
            neighbours++;
          }
        }
        if (x > 0) {
          if (off[pos - 1]) count++;
          neighbours++;
        }
        if (off[pos]) count++;
        neighbours++;
        if (x < w - 1) {
          if (off[pos + 1]) count++;
          neighbours++;
        }
        if (y < h - 1) {
          if (x > 0) {
            if (off[pos + w - 1]) count++;
            neighbours++;
          }
          if (off[pos + w]) count++;
          neighbours++;
          if (x < w - 1) {
            if (off[pos + w + 1]) count++;
            neighbours++;
          }
        }
        cur[pos] = 2 * count >= neighbours;
        if (cur[pos] !== off[pos]) fillDiff += cur[pos] ? +1 : -1;
      }
    }
    [cur, off] = [off, cur];
  }

  // Forcing the rate only where the map has some border to work within.
  if (forceFillRate && Math.min(w, h) > 2) {
    const neighbours = [-w - 1, -w, -w + 1, -1, 0, +1, +w - 1, +w, +w + 1];
    const growing = fillDiff < 0;
    while (fillDiff !== 0) {
      let cell: number;
      let tries = 0;
      // A cell to grow from (or shrink), not to start a new patch or hole: length/10 tries.
      do {
        cell = Random.Int(1, w - 1) + Random.Int(1, h - 1) * w;
        tries++;
      } while (off[cell] !== growing && tries * 10 < length);
      for (const i of neighbours) {
        if (fillDiff !== 0 && off[cell + i] !== growing) {
          off[cell + i] = growing;
          fillDiff += growing ? +1 : -1;
        }
      }
    }
  }
  return off;
}
