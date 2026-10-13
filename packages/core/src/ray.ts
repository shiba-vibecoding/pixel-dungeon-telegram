import { charAt, type Ctx } from './floor';
import { cellX, cellY, LENGTH, WIDTH } from './level/geometry';
import { F, hasFlag } from './level/terrain';

/*
 * Shattered's Ballistica with its collision modes: a straight line from a cell towards another, carried on past it
 * to the edge of the map, and where it stops (STOP_TARGET, STOP_CHARS, STOP_SOLID; PROJECTILE is all three,
 * MAGIC_BOLT the last two, WONT_STOP none). The stepping is the original's, as ai.ts ballistica's.
 */

export interface Ray {
  /** Every cell the line passes, from the source on, to the edge of the map. */
  path: number[];
  /** Index in `path` of where it stops. */
  dist: number;
  /** path[dist]. */
  collision: number;
}

export interface RayStops {
  target?: boolean;
  chars?: boolean;
  solid?: boolean;
  /** IGNORE_SOFT_SOLID: a closed door does not stop it. */
  ignoreSoft?: boolean;
}

export const PROJECTILE: RayStops = { target: true, chars: true, solid: true };
export const MAGIC_BOLT: RayStops = { chars: true, solid: true };
export const STOP_TARGET_ONLY: RayStops = { target: true };
export const WONT_STOP: RayStops = {};

export function castRay(ctx: Ctx, from: number, to: number, stops: RayStops): Ray {
  const map = ctx.level.map;
  const charThere = (cell: number): boolean => charAt(ctx.world, ctx.depth, cell) !== undefined;
  const inside = (cell: number): boolean =>
    cell >= WIDTH && cell < LENGTH - WIDTH && cellX(cell) > 0 && cellX(cell) < WIDTH - 1;
  let dx = cellX(to) - cellX(from);
  let dy = cellY(to) - cellY(from);
  const stepX = dx > 0 ? 1 : -1;
  const stepY = dy > 0 ? 1 : -1;
  dx = Math.abs(dx);
  dy = Math.abs(dy);
  const [stepA, stepB, dA, dB] = dx > dy ? [stepX, stepY * WIDTH, dx, dy] : [stepY * WIDTH, stepX, dy, dx];
  const path: number[] = [];
  let collision = -1;
  let cell = from;
  let err = Math.trunc(dA / 2);
  while (inside(cell)) {
    // Solid ground with nobody in it: the line stops at the cell before (not short of a closed door).
    if (collision === -1 && stops.solid && cell !== from && !hasFlag(map[cell]!, F.PASSABLE) && !hasFlag(map[cell]!, F.AVOID) &&
      !charThere(cell)) {
      collision = path.length - 1;
    }
    path.push(cell);
    if (collision === -1 && stops.solid && cell !== from && hasFlag(map[cell]!, F.SOLID) &&
      !(stops.ignoreSoft && (hasFlag(map[cell]!, F.PASSABLE) || hasFlag(map[cell]!, F.AVOID)))) collision = path.length - 1;
    if (collision === -1 && cell !== from && stops.chars && charThere(cell)) collision = path.length - 1;
    if (collision === -1 && cell === to && stops.target) collision = path.length - 1;
    cell += stepA;
    err += dB;
    if (err >= dA) {
      err -= dA;
      cell += stepB;
    }
  }
  // Ballistica: without a collision, it ends where the path does.
  const dist = collision === -1 ? path.length - 1 : Math.max(0, collision);
  return { path, dist, collision: path[dist]! };
}

/**
 * ConeAOE: the cells of a cone `degrees` wide around the core ray, up to `maxDist` (true distance), as rays cast
 * from the source to every cell along its outer arc (and just inside it, for a big cone) every half degree.
 */
export function coneCells(ctx: Ctx, core: Ray, maxDist: number, degrees: number, stops: RayStops): Set<number> {
  const source = core.path[0]!;
  const fx = cellX(source) + 0.5;
  const fy = cellY(source) + 0.5;
  let tx = cellX(core.collision) + 0.5;
  let ty = cellY(core.collision) + 0.5;
  const length = Math.hypot(tx - fx, ty - fy);
  if (length > maxDist) {
    tx = fx + ((tx - fx) * maxDist) / length;
    ty = fy + ((ty - fy) * maxDist) / length;
  }
  const radius = Math.fround(Math.hypot(tx - fx, ty - fy) + 0.5);
  const initial = (Math.atan2(ty - fy, tx - fx) * 180) / Math.PI;
  const targets: number[] = [];
  const arcCell = (a: number, r: number): number => {
    let x = fx + Math.cos((a * Math.PI) / 180) * r;
    let y = fy + Math.sin((a * Math.PI) / 180) * r;
    x += fx > x ? 0.5 : -0.5;
    y += fy > y ? 0.5 : -0.5;
    const cx = Math.min(WIDTH - 1, Math.max(0, Math.floor(x)));
    const cy = Math.min(LENGTH / WIDTH - 1, Math.max(0, Math.floor(y)));
    return cx + cy * WIDTH;
  };
  for (let a = initial + degrees / 2; a >= initial - degrees / 2; a -= 0.5) {
    for (const r of radius >= 4 ? [radius, radius - 1] : [radius]) {
      const cell = arcCell(a, r);
      if (!targets.includes(cell)) targets.push(cell);
    }
  }
  const cells = new Set<number>();
  for (const target of targets) {
    const ray = castRay(ctx, source, target, stops);
    for (let i = 1; i <= ray.dist; i++) cells.add(ray.path[i]!);
  }
  return cells;
}
