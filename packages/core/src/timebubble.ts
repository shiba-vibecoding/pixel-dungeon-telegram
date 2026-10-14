import type { Hero } from './actors';
import { charAt, type Ctx } from './floor';
import { stepOnPlant, uproot } from './plants';
import { disarmTrap, trapAt, triggerTrap } from './traps';

/*
 * Swiftthistle.TimeBubble: a few turns of accelerated time around the hero, whose actions take none of the
 * world's. Like the hourglass's freeze (artifacts/hourglass.ts), traps and plants stepped on meanwhile wait until
 * it bursts, and are undone if the hero leaves the level first; attacking or using magic bursts it
 * (Invisibility.dispel).
 */

/** TimeBubble.reset(turns): left = turns + 1, as the action that starts it is spent in it. */
export function startBubble(ctx: Ctx, hero: Hero, turns = 6): void {
  const had = hero.timeBubble !== undefined;
  hero.timeBubble = { left: turns + 1, presses: hero.timeBubble?.presses ?? [] };
  if (!had) ctx.effects.push({ type: 'timeFreeze', hero: hero.id, on: true });
}

/** TimeBubble.processTime: the hero's actions use up the bubble (a thousandth for rounding). */
export function bubbleTime(ctx: Ctx, hero: Hero, time: number): void {
  const bubble = hero.timeBubble!;
  bubble.left -= time;
  if (bubble.left < -0.001) endBubble(ctx, hero);
}

/** TimeBubble.detach: time flows again, and what was stepped on meanwhile goes off (triggerPresses). */
export function endBubble(ctx: Ctx, hero: Hero): void {
  const presses = hero.timeBubble?.presses ?? [];
  if (!hero.timeBubble) return;
  delete hero.timeBubble;
  ctx.effects.push({ type: 'timeFreeze', hero: hero.id, on: false });
  if (hero.depth !== ctx.depth) return;
  for (const cell of presses) {
    const who = charAt(ctx.world, ctx.depth, cell) ?? null;
    stepOnPlant(ctx, who, cell);
    if (trapAt(ctx.level, cell)) triggerTrap(ctx, who, cell);
  }
}

/** TimeBubble.setDelayedPress. */
export function bubblePress(hero: Hero, cell: number): void {
  const presses = hero.timeBubble!.presses;
  if (!presses.includes(cell)) presses.push(cell);
}

/** TimeBubble.disarmPresses: leaving the level, what was pressed is undone (plants uprooted, traps spent). */
export function disarmBubble(ctx: Ctx, hero: Hero): void {
  const bubble = hero.timeBubble;
  if (!bubble) return;
  const floor = ctx.world.floors[hero.depth];
  const level = ctx.world.levels[hero.depth];
  for (const cell of bubble.presses) {
    const plant = floor?.plants?.find((p) => p.pos === cell);
    if (floor && plant && plant.kind !== 'rotberry') uproot(floor, cell);
    const trap = level ? trapAt(level, cell) : undefined;
    if (level && trap) disarmTrap(level, trap);
  }
  bubble.presses = [];
}
