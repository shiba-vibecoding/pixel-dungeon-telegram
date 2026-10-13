import { type Hero, heroArtifacts, isStarving } from '../actors';
import { charAt, type Ctx, heroView } from '../floor';
import type { Item } from '../items';
import { stepOnPlant, uproot } from '../plants';
import { affectHunger } from '../hero';
import { trapAt, triggerTrap } from '../traps';
import { T } from '../level/terrain';
import { chargeCap, visiblyUpgraded } from './artifact';
import { isWorn, say } from './common';
import { dispelInvisibility } from './invisibility';
import { artifactChargeMultiplier, artifactProc, magicImmune, onArtifactUsed, regenOn } from './seams';

/*
 * TimekeepersHourglass: worn, its sand runs either way. In stasis the hero
 * stands outside time for five turns a charge (two charges at most), unseen
 * and untouchable, and hunger waits too. Freezing time, the hero acts while
 * nothing else does, two turns a charge, until they strike or something
 * gives them away; traps and plants stepped on meanwhile go off when time
 * starts again. Sandbags bought in the shops make it hold more charge.
 */

export function hourglassProblem(hero: Hero, item: Item): string | null {
  if (magicImmune(hero)) return 'art:magic_immune';
  if (!isWorn(hero, item)) return 'art:artifact.need_to_equip';
  // Time already frozen: the hourglass stops it; in stasis there is nothing to do.
  if (item.freeze) return null;
  if ((hero.stasis ?? 0) > 0) return 'art:cannot';
  if ((item.charge ?? 0) <= 0) return 'art:timekeepershourglass.no_charge';
  if (item.cursed) return 'art:timekeepershourglass.cursed';
  return null;
}

/** The hourglass whose time freeze is under way, if any (TimekeepersHourglass.timeFreeze). */
export const frozenBy = (hero: Hero): Item | undefined => heroArtifacts(hero).find((item) => item.freeze);

/** The window's choice: stasis (0) or freezing time (1); used again while time is frozen, it starts again. */
export function useHourglass(ctx: Ctx, hero: Hero, item: Item, stasis: boolean): number {
  if (item.freeze) {
    endFreeze(ctx, hero, item);
    say(ctx, hero, 'timekeepershourglass.deactivate');
    return 0;
  }
  if (stasis) {
    say(ctx, hero, 'timekeepershourglass.onstasis');
    // timeStasis.attachTo: invisibility and other freezes end; two charges at most, five turns each.
    dispelInvisibility(ctx, hero);
    const used = Math.min(item.charge!, 2);
    hero.stasis = 5 * used;
    // Being in stasis often should cost no food.
    if (!isStarving(hero)) affectHunger(ctx, hero, 5 * used);
    item.charge! -= used;
    onArtifactUsed(ctx, hero);
    ctx.effects.push({ type: 'stasis', hero: hero.id, on: true });
    return 0;
  }
  // Freezing time: whatever is in sight is touched by the artifact's magic.
  const fov = heroView(ctx.world, hero);
  for (const mob of ctx.floor.mobs) if (fov[mob.pos]) artifactProc(ctx, mob, visiblyUpgraded(item), 1);
  say(ctx, hero, 'timekeepershourglass.onfreeze');
  dispelInvisibility(ctx, hero);
  item.freeze = { turnsToCost: 2, presses: [] };
  onArtifactUsed(ctx, hero);
  item.charge! -= 1;
  ctx.effects.push({ type: 'timeFreeze', hero: hero.id, on: true });
  freezeTime(ctx, hero, item, 0);
  return 0;
}

/** timeFreeze.processTime: the hero's acts use up the frozen time, two turns a charge; out of charge, time starts again. */
export function freezeTime(ctx: Ctx, hero: Hero, item: Item, time: number): void {
  const freeze = item.freeze!;
  freeze.turnsToCost -= time;
  // A thousandth for rounding.
  while (freeze.turnsToCost < -0.001) {
    freeze.turnsToCost += 2;
    item.charge = (item.charge ?? 0) - 1;
  }
  if (item.charge! < 0 || (item.charge === 0 && freeze.turnsToCost <= 0)) {
    item.charge = 0;
    endFreeze(ctx, hero, item);
  }
}

/** timeFreeze.detach: time starts again, and what was stepped on meanwhile goes off (triggerPresses). */
export function endFreeze(ctx: Ctx, hero: Hero, item: Item): void {
  const presses = item.freeze?.presses ?? [];
  delete item.freeze;
  ctx.effects.push({ type: 'timeFreeze', hero: hero.id, on: false });
  if (hero.depth !== ctx.depth) return;
  for (const cell of presses) {
    const who = charAt(ctx.world, ctx.depth, cell) ?? null;
    stepOnPlant(ctx, who, cell);
    if (trapAt(ctx.level.map[cell]!)) triggerTrap(ctx, who, cell);
  }
}

/** timeFreeze.setDelayedPress: stepped on while time stands still, it goes off later. */
export function delayPress(item: Item, cell: number): void {
  if (!item.freeze!.presses.includes(cell)) item.freeze!.presses.push(cell);
}

/** Level.beforeTransition and timeFreeze.disarmPresses: leaving the level, what was pressed is undone (plants uprooted, traps spent). */
export function disarmPresses(ctx: Ctx, hero: Hero): void {
  const item = frozenBy(hero);
  if (!item?.freeze) return;
  for (const cell of item.freeze.presses) {
    const plant = ctx.world.floors[hero.depth]?.plants?.find((p) => p.pos === cell);
    if (plant && plant.kind !== 'rotberry') uproot(ctx.world.floors[hero.depth]!, cell);
    const level = ctx.world.levels[hero.depth]!;
    if (trapAt(level.map[cell]!)) level.map[cell] = T.INACTIVE_TRAP;
  }
  item.freeze.presses = [];
}

/** hourglassRecharge.act: a charge in 60 to 90 turns, the emptier the faster; cursed, it now and then steals a turn. */
export function hourglassAct(ctx: Ctx, hero: Hero, item: Item): number {
  const cap = chargeCap(item);
  const charge = item.charge ?? 0;
  if (charge < cap && !item.cursed && !magicImmune(hero) && regenOn(ctx, hero)) {
    item.partial = (item.partial ?? 0) + (1 / (90 - (cap - charge) * 3)) * artifactChargeMultiplier(hero);
    while (item.partial >= 1) {
      item.partial--;
      item.charge = (item.charge ?? 0) + 1;
      if (item.charge === cap) item.partial = 0;
    }
  } else if (item.cursed && ctx.rng.int(10) === 0) {
    // ((Hero) target).spend(TICK): a turn lost.
    return 1;
  }
  return 0;
}

/** TimekeepersHourglass.charge: a quarter of the boost. */
export function chargeHourglass(hero: Hero, item: Item, amount: number): void {
  const cap = chargeCap(item);
  if ((item.charge ?? 0) >= cap || item.cursed || magicImmune(hero)) return;
  item.partial = (item.partial ?? 0) + 0.25 * amount;
  while (item.partial >= 1) {
    item.partial--;
    item.charge = (item.charge ?? 0) + 1;
  }
  if (item.charge! >= cap) item.partial = 0;
}

/** Taken off (TimekeepersHourglass.doUnequip): whatever it had under way ends. */
export function hourglassOff(ctx: Ctx, hero: Hero, item: Item): void {
  if (item.freeze) endFreeze(ctx, hero, item);
}
