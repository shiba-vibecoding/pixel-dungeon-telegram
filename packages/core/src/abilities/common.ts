import { type Hero, isAlive, type Mob } from '../actors';
import { hurt } from '../combat';
import { type Char, charAt, type Ctx, enterCell, isHero, leaveCell } from '../floor';
import { cellX, cellY, LENGTH, WIDTH } from '../level/geometry';
import { F, hasFlag } from '../level/terrain';
import type { AbilityState } from './state';

/*
 * Small things the armour abilities share.
 */

/** The hero's ability trackers, started on first use. */
export const stateOf = (hero: Hero): AbilityState => (hero.abil ??= {});

/** Level.trueDistance: as the crow flies (level/geometry.ts: Math.sqrt of the squared distance, not Math.hypot). */
export { trueDistance } from '../level/geometry';

/** Not the hero's side: a monster that is no ally (Char.alignment != ALLY). */
export const notAlly = (ch: Char | undefined, hero: Hero): ch is Mob => ch !== undefined && ch !== hero && !isHero(ch) && !ch.ally && isAlive(ch);

/** Char.alignment == ENEMY: a monster that fights (not a quest giver nor a shopkeeper), no ally. */
export const isFoe = (ch: Char | undefined): ch is Mob =>
  ch !== undefined && !isHero(ch) && !ch.ally && ch.state !== 'passive' && isAlive(ch) && ch.kind !== 'mirror' && ch.kind !== 'bee';

/** The living creature on a cell. */
export function livingAt(ctx: Ctx, cell: number): Char | undefined {
  const ch = charAt(ctx.world, ctx.depth, cell);
  return ch && isAlive(ch) ? ch : undefined;
}

/**
 * Char.damage from the hero's armour ability: an attack effect for the number floating up, then the harm
 * (no less than nothing: Char.damage ignores a negative blow).
 */
export function harm(ctx: Ctx, hero: Hero, victim: Char, damage: number, source: Char | 'wand' = hero): void {
  if (damage < 0 || !isAlive(victim)) return;
  if (source !== 'wand') {
    ctx.effects.push({ type: 'attack', depth: ctx.depth, attacker: source.id, target: victim.id, hit: true, damage });
  }
  hurt(ctx, victim, damage, source);
}

/** Buff.prolong(ch, Class, turns) on a monster's turns-left counter. */
export function prolong<K extends string>(target: { [P in K]?: number }, key: K, turns: number): void {
  target[key] = Math.max(target[key] ?? 0, turns);
}

/** Char.move without the step's work: the creature stands on a new cell (doors open and shut behind it). */
export function relocate(ctx: Ctx, ch: Char, to: number): void {
  leaveCell(ctx.world, ctx.level, ctx.depth, ch.pos);
  ch.pos = to;
  enterCell(ctx.level, to);
}

/**
 * Level.openSpace: room enough for a large creature: a cell that is not solid, with three solid-free cells in a row
 * along one side of it (a corner, the middle and the next corner).
 */
export function openSpace(ctx: Ctx, cell: number): boolean {
  const solid = (c: number): boolean => c < 0 || c >= LENGTH || hasFlag(ctx.level.map[c]!, F.SOLID);
  if (solid(cell)) return false;
  // PathFinder.CIRCLE8: N, NE, E, SE, S, SW, W, NW.
  const circle = [-WIDTH, 1 - WIDTH, 1, 1 + WIDTH, WIDTH, WIDTH - 1, -1, -1 - WIDTH];
  for (let j = 1; j < 8; j += 2) {
    if (!solid(cell + circle[j]!) && !solid(cell + circle[(j + 1) % 8]!) && !solid(cell + circle[(j + 2) % 8]!)) return true;
  }
  return false;
}
