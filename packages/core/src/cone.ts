import type { Level } from './level/generate';
import { atan2, cos, sin } from './level/gen/trig';
import { HEIGHT, LENGTH, WIDTH } from './level/geometry';
import { F, hasFlag } from './level/terrain';

/*
 * mechanics/Ballistica and mechanics/ConeAOE as Shattered has them, on the world's grid, with
 * PathFinder's neighbour orders: what the dwarven vault's sentries, rays and the greater elemental aim
 * with (vault.ts, vaultboss.ts). Trigonometry from level/gen/trig.ts: the same on every engine.
 */

const f32 = Math.fround;

/** PathFinder.NEIGHBOURS4, NEIGHBOURS8, NEIGHBOURS9 and CIRCLE8, in Shattered's orders. */
export const PF_NEIGHBOURS4: readonly number[] = [-WIDTH, -1, +1, +WIDTH];
export const PF_NEIGHBOURS8: readonly number[] = [-WIDTH - 1, -WIDTH, -WIDTH + 1, -1, +1, +WIDTH - 1, +WIDTH, +WIDTH + 1];
export const PF_NEIGHBOURS9: readonly number[] = [-WIDTH - 1, -WIDTH, -WIDTH + 1, -1, 0, +1, +WIDTH - 1, +WIDTH, +WIDTH + 1];
export const PF_CIRCLE8: readonly number[] = [-WIDTH - 1, -WIDTH, -WIDTH + 1, +1, +WIDTH + 1, +WIDTH, +WIDTH - 1, -1];

/** Ballistica's parameters. */
export const STOP_TARGET = 1;
export const STOP_CHARS = 2;
export const STOP_SOLID = 4;
export const IGNORE_SOFT_SOLID = 8;
export const PROJECTILE = STOP_TARGET | STOP_CHARS | STOP_SOLID;
export const MAGIC_BOLT = STOP_CHARS | STOP_SOLID;
export const WONT_STOP = 0;

export interface Ballistica {
  /** The whole path, on past the collision to the edge of the map. */
  path: number[];
  sourcePos: number;
  collisionPos: number;
  dist: number;
  params: number;
}

/** Level.insideMap on the world's grid. */
export const insideMap = (cell: number): boolean => {
  const x = cell % WIDTH;
  const y = Math.trunc(cell / WIDTH);
  return cell >= 0 && cell < LENGTH && x >= 1 && y >= 1 && x < WIDTH - 1 && y < HEIGHT - 1;
};

const passable = (level: Level, cell: number): boolean => hasFlag(level.map[cell]!, F.PASSABLE);
const avoid = (level: Level, cell: number): boolean => hasFlag(level.map[cell]!, F.AVOID);
const solid = (level: Level, cell: number): boolean => hasFlag(level.map[cell]!, F.SOLID);

/** new Ballistica(from, to, params): `occupied` says where characters stand (Actor.findChar). */
export function ballistica(level: Level, occupied: (cell: number) => boolean, from: number, to: number, params: number): Ballistica {
  const stopTarget = (params & STOP_TARGET) > 0;
  const stopChars = (params & STOP_CHARS) > 0;
  const stopTerrain = (params & STOP_SOLID) > 0;
  const ignoreSoftSolid = (params & IGNORE_SOFT_SOLID) > 0;
  const path: number[] = [];
  let collisionPos: number | null = null;
  const collide = (cell: number): void => {
    collisionPos ??= cell;
  };
  const x0 = from % WIDTH;
  const x1 = to % WIDTH;
  const y0 = Math.trunc(from / WIDTH);
  const y1 = Math.trunc(to / WIDTH);
  let dx = x1 - x0;
  let dy = y1 - y0;
  const stepX = dx > 0 ? 1 : -1;
  const stepY = dy > 0 ? 1 : -1;
  dx = Math.abs(dx);
  dy = Math.abs(dy);
  const [stepA, stepB, dA, dB] = dx > dy ? [stepX, stepY * WIDTH, dx, dy] : [stepY * WIDTH, stepX, dy, dx];
  let cell = from;
  let err = Math.trunc(dA / 2);
  while (insideMap(cell)) {
    // In solid terrain with no one there: it collides with the cell before (not short of a closed door).
    if (collisionPos === null && stopTerrain && cell !== from && !passable(level, cell) && !avoid(level, cell) && !occupied(cell)) {
      collide(path[path.length - 1]!);
    }
    path.push(cell);
    if (collisionPos === null && stopTerrain && cell !== from && solid(level, cell)) {
      if (!(ignoreSoftSolid && (passable(level, cell) || avoid(level, cell)))) collide(cell);
    }
    if (collisionPos === null && cell !== from && stopChars && occupied(cell)) collide(cell);
    if (collisionPos === null && cell === to && stopTarget) collide(cell);
    cell += stepA;
    err += dB;
    if (err >= dA) {
      err -= dA;
      cell += stepB;
    }
  }
  let dist: number;
  let at: number;
  if (collisionPos !== null) {
    at = collisionPos;
    dist = path.indexOf(collisionPos);
  } else if (path.length > 0) {
    dist = path.length - 1;
    at = path[dist]!;
  } else {
    path.push(from);
    at = from;
    dist = 0;
  }
  return { path, sourcePos: from, collisionPos: at, dist, params };
}

/** Ballistica.subPath: the path from one index to another, both included. */
export function subPath(b: Ballistica, start: number, end: number): number[] {
  return b.path.slice(start, Math.min(end, b.path.length - 1) + 1);
}

/** PointF.G2R. */
const G2R = f32(Math.PI / 180);

export interface Cone {
  cells: number[];
  rays: Ballistica[];
}

/**
 * ConeAOE(core, maxDist, degrees, params): rays from the core ray's source to every cell along the cone's
 * outer arc (and, wide enough, just inside it), every half degree clockwise; the cells they cross.
 */
export function coneAOE(level: Level, occupied: (cell: number) => boolean, core: Ballistica, maxDist: number, degrees: number, params: number): Cone {
  const fromX = f32((core.sourcePos % WIDTH) + 0.5);
  const fromY = f32(Math.trunc(core.sourcePos / WIDTH) + 0.5);
  let toX = f32((core.collisionPos % WIDTH) + 0.5);
  let toY = f32(Math.trunc(core.collisionPos / WIDTH) + 0.5);
  const dist = (): number => f32(Math.sqrt(f32(f32((toX - fromX) * (toX - fromX)) + f32((toY - fromY) * (toY - fromY)))));
  // The cone's length kept to maxDist (in true distance, not cells).
  if (dist() > maxDist) {
    const d = f32(maxDist / dist());
    toX = f32(fromX + f32(f32(toX - fromX) * d));
    toY = f32(fromY + f32(f32(toY - fromY) * d));
  }
  // To reach the edge of the target cell, not its middle.
  const radius = f32(dist() + 0.5);
  const initial = f32(f32(atan2(f32(toY - fromY), f32(toX - fromX))) / G2R);
  const targets: number[] = [];
  const seen = new Set<number>();
  const add = (r: number, a: number): void => {
    let x = f32(f32(r * f32(cos(f32(a * G2R)))) + fromX);
    let y = f32(f32(r * f32(sin(f32(a * G2R)))) + fromY);
    x = f32(x + (fromX > x ? 0.5 : -0.5));
    y = f32(y + (fromY > y ? 0.5 : -0.5));
    const cx = Math.min(Math.max(0, Math.floor(x)), WIDTH - 1);
    const cy = Math.min(Math.max(0, Math.floor(y)), HEIGHT - 1);
    const cell = cx + cy * WIDTH;
    if (!seen.has(cell)) {
      seen.add(cell);
      targets.push(cell);
    }
  };
  const half = f32(degrees / 2);
  for (let a = f32(initial + half); a >= f32(initial - half); a = f32(a - 0.5)) {
    add(radius, a);
    // A wide enough cone: rays just inside the arc too, to fill any holes.
    if (radius >= 4) add(f32(radius - 1), a);
  }
  const cells = new Set<number>();
  const rays: Ballistica[] = [];
  for (const c of targets) {
    const ray = ballistica(level, occupied, core.sourcePos, c, params);
    for (const cell of subPath(ray, 1, ray.dist)) cells.add(cell);
    rays.push(ray);
  }
  return { cells: [...cells], rays };
}
