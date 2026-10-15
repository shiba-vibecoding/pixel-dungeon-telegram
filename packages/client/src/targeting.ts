import {
  cellX, cellY, charAt, distance, F, hasFlag, type Hero, isAlive, isEnemy, type ItemKind, itemDef, type Level, type Mob, WIDTH, type World,
} from '@pd/core';
import { quickUse } from './quickslot';
import { seenEnemies } from './sight';

/*
 * Aiming from a quick slot, as Shattered Pixel Dungeon has it (QuickSlotButton.lastTarget, targetingSlot, autoAim and
 * Hero.checkVisibleMobs): a quick slot holding a thrown weapon, a bow, a wand or a bomb starts aiming, with the last
 * target marked (the aim in main.ts remembers the slot that asked) — the enemy last fought or shot at while it is still in sight and alive, else the nearest enemy in
 * sight a shot can reach — and the same slot tapped again fires at it. A tap on a cell fires there, as ever. The action
 * sent is the same throw, zap or shot at a cell: only the client picks the cell.
 */

/** The enemy last targeted (QuickSlotButton.lastTarget), remembered from turn to turn. */
let lastTarget: string | null = null;

/** Item.usesTargeting: aiming from a slot offers the marked target. A seed or a healing dart is never meant for an enemy; a ward is set in the open. */
export function usesTargeting(kind: ItemKind): boolean {
  const use = quickUse(kind);
  if (use === 'shoot') return true;
  if (use === 'zap') return kind !== 'wand.warding';
  return use === 'throw' && itemDef(kind).category !== 'seed' && kind !== 'missile.healingDart';
}

/** QuickSlotButton.target: this enemy is the one to aim at next (a shot at it, a blow, the danger badge's pick). */
export function rememberTarget(mob: Pick<Mob, 'id'> | null | undefined): void {
  if (mob) lastTarget = mob.id;
}

/** QuickSlotButton.reset: a new run, another depth's crowd. */
export function resetTargeting(): void {
  lastTarget = null;
}

/** The enemy last targeted if it is still in sight and alive. */
export function lastTargetIn(sight: readonly Mob[]): Mob | undefined {
  return lastTarget === null ? undefined : sight.find((mob) => mob.id === lastTarget && isAlive(mob) && isEnemy(mob));
}

/**
 * The cells a shot flies over, from `from` towards `to` (Ballistica with PROJECTILE): it ends at the first character,
 * wall or sight-blocking cell in its way, or at `to`.
 */
export function shotPath(world: World, level: Level, depth: number, from: number, to: number): number[] {
  let dx = cellX(to) - cellX(from);
  let dy = cellY(to) - cellY(from);
  const stepX = dx > 0 ? 1 : -1;
  const stepY = dy > 0 ? 1 : -1;
  dx = Math.abs(dx);
  dy = Math.abs(dy);
  const [stepA, stepB, dA, dB] = dx > dy ? [stepX, stepY * WIDTH, dx, dy] : [stepY * WIDTH, stepX, dy, dx];
  const trace = [from];
  let cell = from;
  let err = Math.trunc(dA / 2);
  while (cell !== to) {
    cell += stepA;
    err += dB;
    if (err >= dA) {
      err -= dA;
      cell += stepB;
    }
    trace.push(cell);
    const terrain = level.map[cell];
    if (terrain === undefined) {
      trace.pop();
      return trace;
    }
    if (!hasFlag(terrain, F.PASSABLE) && !hasFlag(terrain, F.AVOID)) {
      trace.pop();
      return trace;
    }
    if (hasFlag(terrain, F.LOS_BLOCKING) || charAt(world, depth, cell)) return trace;
  }
  return trace;
}

/**
 * QuickSlotButton.autoAim: the cell to aim at so that a shot ends on the target — the target's own cell if the straight
 * way is clear, else a cell within two of it that angles the shot round the corner or the one in the way. -1: none found.
 */
export function autoAim(world: World, level: Level, hero: Hero, target: number): number {
  const lands = (at: number): boolean => shotPath(world, level, hero.depth, hero.pos, at).at(-1) === target;
  if (lands(target)) return target;
  const x = cellX(target);
  const y = cellY(target);
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const nx = x + dx;
      const ny = y + dy;
      if ((dx === 0 && dy === 0) || nx < 0 || ny < 0 || nx >= WIDTH) continue;
      const at = nx + ny * WIDTH;
      if (level.map[at] === undefined) continue;
      if (lands(at)) return at;
    }
  }
  return -1;
}

/**
 * Hero.checkVisibleMobs: with no valid last target, the nearest enemy in sight that a shot can reach becomes it.
 * Called once the sight has changed (a turn passed).
 */
export function refreshTarget(world: World, level: Level, hero: Hero): void {
  const sight = seenEnemies(world, hero);
  if (lastTargetIn(sight)) return;
  let nearest: Mob | undefined;
  for (const mob of sight) {
    if (nearest && distance(hero.pos, nearest.pos) <= distance(hero.pos, mob.pos)) continue;
    if (autoAim(world, level, hero, mob.pos) !== -1) nearest = mob;
  }
  lastTarget = nearest?.id ?? null;
}

/**
 * QuickSlotButton.useTargeting: aiming from a slot starts; true if the last target is still a fair one, marked now
 * (otherwise there is none: it is forgotten).
 */
export function startTargeting(world: World, hero: Hero): boolean {
  if (lastTargetIn(seenEnemies(world, hero))) return true;
  lastTarget = null;
  return false;
}

/**
 * QuickSlotButton.onClick on the slot that is aiming: the cell to fire at — the marked target's, angled if need be
 * (QuickSlotButton.autoAim, or «just target the position and hope for the best»). Null: the target left sight or died,
 * so the tap works as an ordinary one.
 */
export function fireAtTarget(world: World, level: Level, hero: Hero): { cell: number; mob: Mob } | null {
  const mob = lastTargetIn(seenEnemies(world, hero));
  if (!mob) return null;
  const cell = autoAim(world, level, hero, mob.pos);
  return { cell: cell === -1 ? mob.pos : cell, mob };
}
