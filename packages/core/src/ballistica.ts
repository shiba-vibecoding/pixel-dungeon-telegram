import { type Ctx, charAt } from './floor';
import type { Level } from './level/generate';
import { cellX, cellY, HEIGHT, LENGTH, WIDTH } from './level/geometry';
import { F, hasFlag } from './level/terrain';
import type { World } from './world';

/*
 * Shattered's Ballistica and ConeAOE (mechanics/): the path of a bolt, a beam
 * or a thrown thing, cell by cell from where it starts to the edge of the
 * map, and where it collides; and a cone of such paths.
 *
 * ConeAOE needs angles. Math.sin and friends may differ in their last bit
 * from one JavaScript engine to another, and the server must replay a run
 * exactly as the phone played it, so the trigonometry here is done by hand
 * with nothing but + - * /, which every engine rounds alike.
 */

/** Ballistica.STOP_TARGET: it stops at the cell aimed at. */
export const STOP_TARGET = 1;
/** Ballistica.STOP_CHARS: it stops at the first character in the way. */
export const STOP_CHARS = 2;
/** Ballistica.STOP_SOLID: it stops before a wall, or in a door. */
export const STOP_SOLID = 4;
/** Ballistica.IGNORE_SOFT_SOLID: doors (and webs) do not stop it. */
export const IGNORE_SOFT_SOLID = 8;

export const PROJECTILE = STOP_TARGET | STOP_CHARS | STOP_SOLID;
export const MAGIC_BOLT = STOP_CHARS | STOP_SOLID;
export const WONT_STOP = 0;

export interface Ballistica {
  /** The whole path, from the source to the edge of the map, cells after the collision included. */
  path: number[];
  sourcePos: number;
  collisionPos: number;
  /** The index of the collision in the path. */
  dist: number;
  params: number;
}

/** Level.insideMap: not on the map's border. */
export const insideMap = (cell: number): boolean =>
  cell >= WIDTH && cell < LENGTH - WIDTH && cell % WIDTH !== 0 && cell % WIDTH !== WIDTH - 1;

/** Ballistica(from, to, params) on a depth: who stands where counts for STOP_CHARS and for walls with someone in them. */
export function ballistica(ctx: Pick<Ctx, 'world' | 'depth' | 'level'>, from: number, to: number, params: number): Ballistica {
  return cast(ctx.level, (cell) => charAt(ctx.world, ctx.depth, cell) !== undefined, from, to, params);
}

/** The same on a level of a world that is not being played (only its map and who stands where). */
export function ballisticaOn(world: World, depth: number, level: Level, from: number, to: number, params: number): Ballistica {
  return cast(level, (cell) => charAt(world, depth, cell) !== undefined, from, to, params);
}

function cast(level: Level, occupied: (cell: number) => boolean, from: number, to: number, params: number): Ballistica {
  const stopTarget = (params & STOP_TARGET) > 0;
  const stopChars = (params & STOP_CHARS) > 0;
  const stopTerrain = (params & STOP_SOLID) > 0;
  const ignoreSoftSolid = (params & IGNORE_SOFT_SOLID) > 0;
  const map = level.map;
  const passable = (cell: number): boolean => hasFlag(map[cell]!, F.PASSABLE);
  const avoid = (cell: number): boolean => hasFlag(map[cell]!, F.AVOID);
  const solid = (cell: number): boolean => hasFlag(map[cell]!, F.SOLID);

  let dx = cellX(to) - cellX(from);
  let dy = cellY(to) - cellY(from);
  const stepX = dx > 0 ? 1 : -1;
  const stepY = dy > 0 ? 1 : -1;
  dx = Math.abs(dx);
  dy = Math.abs(dy);
  const [stepA, stepB, dA, dB] = dx > dy ? [stepX, stepY * WIDTH, dx, dy] : [stepY * WIDTH, stepX, dy, dx];

  const path: number[] = [];
  let collision: number | null = null;
  const collide = (cell: number): void => {
    if (collision === null) collision = cell;
  };
  let cell = from;
  let err = Math.trunc(dA / 2);
  while (insideMap(cell)) {
    // In solid terrain with nobody in it, it collides with the cell before (not short of a closed door).
    if (collision === null && stopTerrain && cell !== from && !passable(cell) && !avoid(cell) && !occupied(cell)) {
      collide(path[path.length - 1]!);
    }
    path.push(cell);
    if (collision === null && stopTerrain && cell !== from && solid(cell)) {
      if (!(ignoreSoftSolid && (passable(cell) || avoid(cell)))) collide(cell);
    }
    if (collision === null && cell !== from && stopChars && occupied(cell)) collide(cell);
    if (collision === null && cell === to && stopTarget) collide(cell);
    cell += stepA;
    err += dB;
    if (err >= dA) {
      err -= dA;
      cell += stepB;
    }
  }
  if (collision !== null) return { path, sourcePos: from, collisionPos: collision, dist: path.indexOf(collision), params };
  if (path.length > 0) return { path, sourcePos: from, collisionPos: path[path.length - 1]!, dist: path.length - 1, params };
  return { path: [from], sourcePos: from, collisionPos: from, dist: 0, params };
}

/** Ballistica.subPath: the path from `start` to `end`, both included (as far as the path goes). */
export function subPath(bolt: Ballistica, start: number, end: number): number[] {
  return bolt.path.slice(start, Math.min(end, bolt.path.length - 1) + 1);
}

/* ConeAOE */

export interface Cone {
  /** Every cell the cone covers, the source aside, in ascending order (a Java HashSet of Integers iterates so). */
  cells: number[];
  /** The rays cast to the cells along the cone's outer arc, clockwise. */
  outerRays: Ballistica[];
  rays: Ballistica[];
}

/**
 * ConeAOE(core, maxDist, degrees, params): rays from the core ray's source to
 * every cell along an arc `degrees` wide around it, as long as the core ray
 * (at most maxDist, in true distance).
 */
export function cone(ctx: Pick<Ctx, 'world' | 'depth' | 'level'>, core: Ballistica, maxDist: number, degrees: number, params: number): Cone {
  const fromX = cellX(core.sourcePos) + 0.5;
  const fromY = cellY(core.sourcePos) + 0.5;
  let toX = cellX(core.collisionPos) + 0.5;
  let toY = cellY(core.collisionPos) + 0.5;
  const length = Math.sqrt((toX - fromX) ** 2 + (toY - fromY) ** 2);
  if (length > maxDist) {
    // PointF.inter: the point that far along.
    toX = fromX + (toX - fromX) * (maxDist / length);
    toY = fromY + (toY - fromY) * (maxDist / length);
  }
  // Bumped half a cell: the cone reaches the edge of the target cell, not its centre.
  const radius = Math.sqrt((toX - fromX) ** 2 + (toY - fromY) ** 2) + 0.5;
  const initial = atan2(toY - fromY, toX - fromX) / G2R;
  const targets: number[] = [];
  const outer = new Set<number>();
  const add = (list: number[], value: number): void => {
    if (!list.includes(value)) list.push(value);
  };
  const scanCell = (a: number, r: number): number => {
    let x = r * cos(a * G2R) + fromX;
    let y = r * sin(a * G2R) + fromY;
    x += fromX > x ? 0.5 : -0.5;
    y += fromY > y ? 0.5 : -0.5;
    const ix = Math.min(WIDTH - 1, Math.max(0, Math.floor(x)));
    const iy = Math.min(HEIGHT - 1, Math.max(0, Math.floor(y)));
    return ix + iy * WIDTH;
  };
  // A ray every half a degree, clockwise along the arc; a wide cone also casts just inside it, to leave no holes.
  for (let a = initial + degrees / 2; a >= initial - degrees / 2; a -= 0.5) {
    const edge = scanCell(a, radius);
    add(targets, edge);
    outer.add(edge);
    if (radius >= 4) add(targets, scanCell(a, radius - 1));
  }
  const cells = new Set<number>();
  const rays: Ballistica[] = [];
  const outerRays: Ballistica[] = [];
  for (const target of targets) {
    const ray = ballistica(ctx, core.sourcePos, target, params);
    for (const c of subPath(ray, 1, ray.dist)) cells.add(c);
    rays.push(ray);
    if (outer.has(target)) outerRays.push(ray);
  }
  return { cells: [...cells].sort((a, b) => a - b), outerRays, rays };
}

/* Deterministic trigonometry */

const PI = 3.141592653589793;
/** PointF.G2R: degrees to radians. */
const G2R = PI / 180;

/** sin on [-π/4, π/4], as its Taylor series (enough terms for a double). */
function sinCore(x: number): number {
  const x2 = x * x;
  return x * (1 - x2 / 6 * (1 - x2 / 20 * (1 - x2 / 42 * (1 - x2 / 72 * (1 - x2 / 110 * (1 - x2 / 156 * (1 - x2 / 210)))))));
}

function cosCore(x: number): number {
  const x2 = x * x;
  return 1 - x2 / 2 * (1 - x2 / 12 * (1 - x2 / 30 * (1 - x2 / 56 * (1 - x2 / 90 * (1 - x2 / 132 * (1 - x2 / 182))))));
}

/** Reduces an angle to a quarter turn and the remainder in [-π/4, π/4]. */
function reduce(x: number): [number, number] {
  const quarter = Math.round(x / (PI / 2));
  return [((quarter % 4) + 4) % 4, x - quarter * (PI / 2)];
}

export function sin(x: number): number {
  const [q, r] = reduce(x);
  return q === 0 ? sinCore(r) : q === 1 ? cosCore(r) : q === 2 ? -sinCore(r) : -cosCore(r);
}

export function cos(x: number): number {
  const [q, r] = reduce(x);
  return q === 0 ? cosCore(r) : q === 1 ? -sinCore(r) : q === 2 ? -cosCore(r) : sinCore(r);
}

/** atan on [0, 1]: halved twice (atan x = 2 atan(x / (1 + √(1 + x²)))), then its series. */
function atanSmall(x: number): number {
  let t = x;
  for (let i = 0; i < 2; i++) t /= 1 + Math.sqrt(1 + t * t);
  const t2 = t * t;
  let sum = 0;
  for (let k = 12; k >= 0; k--) sum = 1 / (2 * k + 1) - t2 * sum;
  return 4 * t * sum;
}

export function atan2(y: number, x: number): number {
  if (x === 0 && y === 0) return 0;
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  const a = ay <= ax ? atanSmall(ay / ax) : PI / 2 - atanSmall(ax / ay);
  const angle = x >= 0 ? a : PI - a;
  return y >= 0 ? angle : -angle;
}
