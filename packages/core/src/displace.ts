import { isAlive } from './actors';
import { randomRespawnCell } from './ai';
import { hurt } from './combat';
import { type Char, charAt, type Ctx, enterCell, exploredCells, heroesOn, heroView, isHero, isPassable, leaveCell, observe } from './floor';
import { isBossDepth } from './level/builder';
import { cellX, cellY, HEIGHT, LENGTH, NEIGHBOURS8, WIDTH } from './level/geometry';
import { F, hasFlag, T } from './level/terrain';
import { mobPress, trapAt, triggerTrap } from './traps';
import { stepOnPlant } from './plants';

/*
 * Moving characters about, as gear needs it: Ballistica as Shattered traces
 * it (the whole line to the map's edge, and where it stops), knocking a
 * character back along one (WandOfBlastWave.throwChar), teleporting one
 * (ScrollOfTeleportation.teleportChar) and a geyser of water
 * (GeyserTrap.activate). Seams: the wands stream's blast wave and the levels
 * stream's geyser trap may take these over.
 */

/** Ballistica's stop flags. */
export const STOP_TARGET = 1;
export const STOP_CHARS = 2;
export const STOP_SOLID = 4;
export const PROJECTILE = STOP_TARGET | STOP_CHARS | STOP_SOLID;
export const MAGIC_BOLT = STOP_CHARS | STOP_SOLID;

export interface Trajectory {
  /** Every cell of the line, from where it starts to the edge of the map. */
  path: number[];
  /** Where it stops: path[dist]. */
  dist: number;
  collision: number;
}

/** Level.insideMap: anywhere but the outermost ring of cells. */
const insideMap = (cell: number): boolean =>
  cell >= WIDTH && cell < LENGTH - WIDTH && cell % WIDTH !== 0 && cell % WIDTH !== WIDTH - 1;

/** Ballistica.build: the line from `from` through `to` and on, and where it stops by `flags`. */
export function trajectory(ctx: Ctx, from: number, to: number, flags: number): Trajectory {
  const { level, world, depth } = ctx;
  let dx = cellX(to) - cellX(from);
  let dy = cellY(to) - cellY(from);
  const stepX = dx > 0 ? 1 : -1;
  const stepY = dy > 0 ? 1 : -1;
  dx = Math.abs(dx);
  dy = Math.abs(dy);
  const [stepA, stepB, dA, dB] = dx > dy ? [stepX, stepY * WIDTH, dx, dy] : [stepY * WIDTH, stepX, dy, dx];
  const path: number[] = [];
  let collision: number | undefined;
  let cell = from;
  let err = Math.trunc(dA / 2);
  const stopTerrain = (flags & STOP_SOLID) !== 0;
  // A line that goes nowhere stays where it is.
  if (dA === 0) return { path: [from], dist: 0, collision: from };
  while (insideMap(cell)) {
    const terrain = level.map[cell]!;
    if (collision === undefined && stopTerrain && cell !== from && !hasFlag(terrain, F.PASSABLE) && !hasFlag(terrain, F.AVOID) &&
      !charAt(world, depth, cell)) {
      collision = path[path.length - 1];
    }
    path.push(cell);
    if (collision === undefined && stopTerrain && cell !== from && hasFlag(terrain, F.SOLID)) collision = cell;
    if (collision === undefined && cell !== from && (flags & STOP_CHARS) !== 0 && charAt(world, depth, cell)) collision = cell;
    if (collision === undefined && cell === to && (flags & STOP_TARGET) !== 0) collision = cell;
    cell += stepA;
    err += dB;
    if (err >= dA) {
      err -= dA;
      cell += stepB;
    }
  }
  collision ??= path[path.length - 1] ?? from;
  return { path, dist: Math.max(0, path.indexOf(collision)), collision };
}

/** The line from `from` through `through`, trimmed to the part beyond `through`, stopping as a projectile does (Elastic, GeyserTrap). */
export function beyond(ctx: Ctx, from: number, through: number): Trajectory {
  const line = trajectory(ctx, from, through, STOP_TARGET);
  return trajectory(ctx, line.collision, line.path[line.path.length - 1]!, PROJECTILE);
}

/** Bosses (Char.Property.BOSS): they are knocked back only half as far. */
const BOSSES: ReadonlySet<string> = new Set(['goo', 'tengu', 'dm300', 'king', 'yog']);
/** Char.Property.IMMOVABLE: Yog-Dzewa and those who keep a shop or a quest never budge. */
const IMMOVABLE: ReadonlySet<string> = new Set(['yog', 'shopkeeper', 'impShopkeeper', 'wandmaker', 'blacksmith', 'imp', 'ghost', 'ratKing', 'pylon']);

export const isImmovable = (char: Char): boolean => !isHero(char) && IMMOVABLE.has(char.kind);

/**
 * WandOfBlastWave.throwChar: a character flung along a trajectory, up to `power` cells (half that for a boss); held
 * fast by roots, it stays. Stopped short by a wall or someone in the way, it is hurt (NormalIntRange(dist, 2×dist))
 * and stunned for a moment. Where it lands, it presses the cell (Level.occupyCell).
 */
export function throwChar(ctx: Ctx, char: Char, line: Trajectory, power: number, collideDamage = true): void {
  if (!isHero(char) && BOSSES.has(char.kind)) power = Math.trunc((power + 1) / 2);
  let dist = Math.min(line.dist, power);
  let collided = dist === line.dist;
  if (dist <= 0 || (char.rooted ?? 0) > 0 || isImmovable(char)) return;
  if (charAt(ctx.world, ctx.depth, line.path[dist]!)) {
    dist--;
    collided = true;
  }
  if (dist < 0) return;
  const to = line.path[dist]!;
  if (to === char.pos) return;
  const from = char.pos;
  char.pos = to;
  leaveCell(ctx.world, ctx.level, ctx.depth, from);
  enterCell(ctx.level, to);
  ctx.effects.push({ type: 'pushed', depth: ctx.depth, mob: char.id, from, to });
  if (collided && collideDamage && isAlive(char)) {
    const damage = ctx.rng.normalIntRange(dist, 2 * dist);
    ctx.effects.push({ type: 'hurt', depth: ctx.depth, who: char.id, damage });
    hurt(ctx, char, damage, 'knockback');
    if (isAlive(char)) char.paralysed = Math.max(char.paralysed ?? 0, Math.round(1 + dist / 2));
  }
  if (!isAlive(char)) return;
  press(ctx, char);
}

/** Level.occupyCell: a monster presses where it comes to; a hero sets off a trap or a plant there (a chasm takes them after the turn). */
export function press(ctx: Ctx, char: Char): void {
  if (!isHero(char)) {
    mobPress(ctx, char);
    return;
  }
  const terrain = ctx.level.map[char.pos]!;
  if ((char.levitating ?? 0) > 0) return;
  if (trapAt(ctx.level, char.pos)) triggerTrap(ctx, char, char.pos);
  stepOnPlant(ctx, char, char.pos);
  observe(ctx.world, char);
}

/**
 * ScrollOfTeleportation.teleportChar's test for «in locked levels, we must do a pathfind check»: on a boss's level (no
 * RegularLevel) and on any floor sealed by a fight (Level.locked), a character goes only where it could walk to.
 */
export const walkOnlyLevel = (ctx: Ctx): boolean => isBossDepth(ctx.depth) || ctx.floor.boss?.locked === true;

/**
 * ScrollOfTeleportation.teleportInNonRegularLevel: a cell the character could walk to from where it stands (never a
 * secret one, nor an occupied one); out of the hero's sight if there is one, and with `preferUnseen` one the party has
 * not seen. -1 if there is none.
 */
export function walkableTeleportCell(ctx: Ctx, char: Char, preferUnseen = false): number {
  const { world, level, depth, rng } = ctx;
  const reached = new Set([char.pos]);
  const queue = [char.pos];
  for (let head = 0; head < queue.length; head++) {
    const cell = queue[head]!;
    for (const n of NEIGHBOURS8) {
      const next = cell + n;
      if (next < 0 || next >= LENGTH || reached.has(next) || Math.abs(cellX(next) - cellX(cell)) > 1 || !isPassable(level, next)) continue;
      reached.add(next);
      queue.push(next);
    }
  }
  const sight = new Array<boolean>(LENGTH).fill(false);
  for (const hero of heroesOn(world, depth)) heroView(world, hero).forEach((v, i) => { if (v) sight[i] = true; });
  const explored = exploredCells(world, depth);
  const unseen: number[] = [];
  const hidden: number[] = [];
  const visible: number[] = [];
  for (const cell of [...reached].sort((a, b) => a - b)) {
    if (hasFlag(level.map[cell]!, F.SECRET) || charAt(world, depth, cell)) continue;
    if (preferUnseen && !explored[cell]) unseen.push(cell);
    else if (sight[cell]) visible.push(cell);
    else hidden.push(cell);
  }
  return rng.element(unseen.length > 0 ? unseen : hidden.length > 0 ? hidden : visible) ?? -1;
}

/**
 * ScrollOfTeleportation.teleportChar: somewhere else on the level, out of sight if it can be (RegularLevel's
 * respawn cells); on a boss's level or a sealed floor, somewhere it can walk to (teleportInNonRegularLevel). False if
 * there was nowhere.
 */
export function teleportChar(ctx: Ctx, char: Char): boolean {
  const { world, level, depth, rng } = ctx;
  if (isImmovable(char)) return false;
  let pos = -1;
  if (walkOnlyLevel(ctx)) {
    pos = walkableTeleportCell(ctx, char);
  } else {
    for (let count = 20; count > 0 && (pos === -1 || hasFlag(level.map[pos]!, F.SECRET)); count--) {
      pos = randomRespawnCell(rng, world, level, () => true);
    }
  }
  if (pos === -1) return false;
  const from = char.pos;
  char.pos = pos;
  leaveCell(world, level, depth, from);
  enterCell(level, pos);
  // Teleporting frees from roots.
  char.rooted = 0;
  if (isHero(char)) {
    observe(world, char);
    ctx.effects.push({ type: 'teleported', hero: char.id });
  } else {
    ctx.effects.push({ type: 'blinked', depth, who: char.id, from, to: pos });
    // Displacing.proc: a monster hunting is lost and wanders.
    if (char.state === 'hunting') char.state = 'wandering';
  }
  return true;
}

/** Level.setCellToWater: open ground, grass and embers become water (with `traps`, traps too). */
function setCellToWater(ctx: Ctx, cell: number, traps: boolean): void {
  const terrain = ctx.level.map[cell]!;
  const open = [T.EMPTY, T.GRASS, T.EMBERS, T.EMPTY_SP, T.HIGH_GRASS, T.EMPTY_DECO] as number[];
  if (open.includes(terrain) || (traps && (trapAt(ctx.level, cell) || terrain === T.INACTIVE_TRAP))) ctx.level.map[cell] = T.WATER;
}

/** Fiery creatures (Char.Property.FIERY), whom a geyser hurts as a bomb would. */
const FIERY: ReadonlySet<string> = new Set(['elemental', 'burningFist']);

/**
 * GeyserTrap.activate (a seam for the levels stream's trap): water floods the cells around (two cells out, two in
 * three of the outermost), puts out whoever burns and knocks everyone around two cells back; whoever stands on it is
 * knocked `towards` a cell (or some random way). Fiery creatures are hurt as by a bomb.
 */
export function geyser(ctx: Ctx, pos: number, towards = -1): void {
  const { rng, world, depth } = ctx;
  ctx.effects.push({ type: 'geyser', depth, pos });
  for (let y = Math.max(0, cellY(pos) - 2); y <= Math.min(HEIGHT - 1, cellY(pos) + 2); y++) {
    for (let x = Math.max(0, cellX(pos) - 2); x <= Math.min(WIDTH - 1, cellX(pos) + 2); x++) {
      const cell = x + y * WIDTH;
      if (hasFlag(ctx.level.map[cell]!, F.SOLID)) continue;
      const far = Math.max(Math.abs(x - cellX(pos)), Math.abs(y - cellY(pos)));
      if (far < 2 || rng.int(3) > 0) setCellToWater(ctx, cell, true);
    }
  }
  const scaling = depth;
  const douse = (char: Char): void => {
    if (!isHero(char) && FIERY.has(char.kind)) {
      const damage = rng.normalIntRange(5 + scaling, 10 + scaling * 2);
      ctx.effects.push({ type: 'hurt', depth, who: char.id, damage });
      hurt(ctx, char, damage, 'bomb');
    }
    if (isAlive(char)) char.burning = 0;
  };
  for (const n of NEIGHBOURS8) {
    const char = charAt(world, depth, pos + n);
    if (!char) continue;
    douse(char);
    if (isAlive(char)) throwChar(ctx, char, beyond(ctx, pos, char.pos), 2);
  }
  const centre = charAt(world, depth, pos);
  if (!centre) return;
  let target = towards;
  if (target === -1) {
    if (isHero(centre)) {
      const safe = NEIGHBOURS8.filter((n) => !hasFlag(ctx.level.map[pos + n]!, F.AVOID) && !hasFlag(ctx.level.map[pos + n + n] ?? 0, F.AVOID));
      target = safe.length > 0 ? pos + rng.element(safe)! : -1;
    } else {
      target = pos + NEIGHBOURS8[rng.int(8)]!;
    }
  }
  douse(centre);
  if (isAlive(centre) && target !== -1) throwChar(ctx, centre, trajectory(ctx, pos, target, MAGIC_BOLT), 2);
}
