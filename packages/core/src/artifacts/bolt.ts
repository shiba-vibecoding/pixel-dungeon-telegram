import { charAt, type Ctx } from '../floor';
import { cellX, cellY, HEIGHT, LENGTH, WIDTH } from '../level/geometry';
import { F, hasFlag } from '../level/terrain';

/*
 * Shattered's Ballistica and ConeAOE, as the artifacts aim them: a line from
 * one cell towards another that goes on to the edge of the map, recording
 * where it collides (at the target, at the first creature, or at solid
 * terrain, as asked); and a cone of such lines.
 */

/** Ballistica's collision parameters. */
export const STOP_TARGET = 1;
export const STOP_CHARS = 2;
export const STOP_SOLID = 4;
export const MAGIC_BOLT = STOP_CHARS | STOP_SOLID;

export interface Bolt {
  path: number[];
  collisionPos: number;
  /** Index of collisionPos in the path. */
  dist: number;
}

/** Level.insideMap: not on the map's outer edge. */
const insideMap = (cell: number): boolean =>
  cell >= WIDTH && cell < LENGTH - WIDTH && cell % WIDTH !== 0 && cell % WIDTH !== WIDTH - 1;

/** Ballistica(from, to, params). */
export function ballistica(ctx: Ctx, from: number, to: number, params: number): Bolt {
  const stopTarget = (params & STOP_TARGET) > 0;
  const stopChars = (params & STOP_CHARS) > 0;
  const stopTerrain = (params & STOP_SOLID) > 0;
  const map = ctx.level.map;
  let dx = cellX(to) - cellX(from);
  let dy = cellY(to) - cellY(from);
  const stepX = dx > 0 ? 1 : -1;
  const stepY = dy > 0 ? 1 : -1;
  dx = Math.abs(dx);
  dy = Math.abs(dy);
  const [stepA, stepB, dA, dB] = dx > dy ? [stepX, stepY * WIDTH, dx, dy] : [stepY * WIDTH, stepX, dy, dx];
  const path: number[] = [];
  let collision: number | null = null;
  let cell = from;
  let err = Math.trunc(dA / 2);
  while (insideMap(cell) || cell === from) {
    if (!(cell >= 0 && cell < LENGTH)) break;
    const terrain = map[cell]!;
    // In solid terrain with no one there: the collision is the cell before.
    if (collision === null && stopTerrain && cell !== from && !hasFlag(terrain, F.PASSABLE) && !hasFlag(terrain, F.AVOID) &&
      !charAt(ctx.world, ctx.depth, cell)) {
      collision = path[path.length - 1]!;
    }
    path.push(cell);
    if (collision === null && stopTerrain && cell !== from && hasFlag(terrain, F.SOLID)) collision = cell;
    if (collision === null && cell !== from && stopChars && charAt(ctx.world, ctx.depth, cell)) collision = cell;
    if (collision === null && cell === to && stopTarget) collision = cell;
    if (!insideMap(cell)) break;
    cell += stepA;
    err += dB;
    if (err >= dA) {
      err -= dA;
      cell += stepB;
    }
  }
  if (collision === null) collision = path[path.length - 1] ?? from;
  if (path.length === 0) path.push(from);
  return { path, collisionPos: collision, dist: Math.max(0, path.indexOf(collision)) };
}

/** Ballistica.subPath: the path from `start` to `end`, inclusive. */
export const subPath = (bolt: Bolt, start: number, end: number): number[] => bolt.path.slice(start, Math.min(end, bolt.path.length - 1) + 1);

/** Level.trueDistance: as the crow flies, between cells' centres. */
export const trueDistance = (a: number, b: number): number => Math.hypot(cellX(a) - cellX(b), cellY(a) - cellY(b));

/** ConeAOE(core, degrees): every cell the rays of a cone reach, the core ray's from-cell left out. */
export function coneCells(ctx: Ctx, core: Bolt, degrees: number, params: number): number[] {
  const from = core.path[0]!;
  const fx = cellX(from) + 0.5;
  const fy = cellY(from) + 0.5;
  const tx = cellX(core.collisionPos) + 0.5;
  const ty = cellY(core.collisionPos) + 0.5;
  const radius = Math.hypot(tx - fx, ty - fy) + 0.5;
  const initial = (Math.atan2(ty - fy, tx - fx) * 180) / Math.PI;
  const targets: number[] = [];
  const add = (r: number, a: number): void => {
    let x = r * Math.cos((a * Math.PI) / 180) + fx;
    let y = r * Math.sin((a * Math.PI) / 180) + fy;
    x += fx > x ? 0.5 : -0.5;
    y += fy > y ? 0.5 : -0.5;
    const cx = Math.max(0, Math.min(WIDTH - 1, Math.floor(x)));
    const cy = Math.max(0, Math.min(HEIGHT - 1, Math.floor(y)));
    const cell = cx + cy * WIDTH;
    if (!targets.includes(cell)) targets.push(cell);
  };
  // A ray every half a degree along the outer arc, clockwise; a big cone also just inside it.
  for (let a = initial + degrees / 2; a >= initial - degrees / 2; a -= 0.5) {
    add(radius, a);
    if (radius >= 4) add(radius - 1, a);
  }
  const cells = new Set<number>();
  for (const target of targets) {
    const ray = ballistica(ctx, from, target, params);
    for (const cell of subPath(ray, 1, ray.dist)) cells.add(cell);
  }
  return [...cells].sort((a, b) => a - b);
}
