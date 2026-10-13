import { type Hero, HUNGRY, STARVING, statsOf } from '../actors';
import { isChallenged, NO_FOOD } from '../challenges';
import type { Ctx } from '../floor';
import { type Item, itemDef } from '../items';
import { chargeCap, levelCap } from './artifact';
import { affectHunger } from '../hero';
import { isWorn, say, upgradeArtifact, wornOf } from './common';
import { artifactChargeMultiplier, eatingTime, magicImmune, onArtifactUsed, onFoodEaten } from './seams';

/*
 * HornOfPlenty: worn, it fills with food as its bearer gains experience, a
 * fifth of the most a hero can be hungry at a time; a snack takes one charge,
 * a meal as many as it takes to be full. Food offered to it makes it bigger,
 * a level for every HUNGRY's worth. Worn cursed, it takes a third of the good
 * out of everything eaten.
 */

/** Food.TIME_TO_EAT, as storing food in the horn takes (no talent shortens it). */
const TIME_TO_EAT = 3;

/** A charge's worth of food: a fifth of Hunger.STARVING, a third of that under the no-food challenge. */
function satietyPerCharge(ctx: Ctx): number {
  let satiety = Math.trunc(STARVING / 5);
  if (isChallenged(ctx.world, NO_FOOD)) satiety = Math.trunc(satiety / 3);
  return satiety;
}

export function hornProblem(hero: Hero, item: Item, use: string, food: Item | undefined): string | null {
  if (magicImmune(hero)) return 'art:magic_immune';
  if (!isWorn(hero, item)) return 'art:artifact.need_to_equip';
  if (use === 'snack' || use === 'eat') return (item.charge ?? 0) === 0 ? 'art:hornofplenty.no_food' : null;
  // STORE: food from the pack, while the horn can still grow.
  if (item.level >= levelCap(item) || item.cursed) return 'art:cannot';
  return food && itemDef(food.kind).category === 'food' ? null : 'art:hornofplenty.prompt';
}

/** HornOfPlenty.execute(EAT or SNACK) and doEatEffect: as much as it takes to be full (at least one charge), or a single one. */
export function eatFromHorn(ctx: Ctx, hero: Hero, item: Item, snack: boolean): number {
  const satiety = satietyPerCharge(ctx);
  let charges = Math.max(1, Math.trunc(hero.hunger / satiety));
  if (charges > item.charge!) charges = item.charge!;
  if (snack) charges = 1;
  // Hunger.satisfy.
  affectHunger(ctx, hero, satiety * charges);
  statsOf(hero).food++;
  item.charge! -= charges;
  onArtifactUsed(ctx, hero);
  ctx.effects.push({ type: 'ate', hero: hero.id, kind: item.kind, outcome: null });
  say(ctx, hero, 'hornofplenty.eat');
  onFoodEaten(ctx, hero, satiety * charges, item);
  return eatingTime(hero);
}

/** The item selector's onSelect and gainFoodValue: a food offered to the horn, for its level. */
export function storeInHorn(ctx: Ctx, hero: Hero, item: Item, index: number): number {
  const food = hero.items[index]!;
  if (--food.qty <= 0) hero.items.splice(index, 1);
  if (item.level >= 10) return TIME_TO_EAT;
  item.stored = (item.stored ?? 0) + (itemDef(food.kind).energy ?? 0);
  // Pasties and phantom meat are worth two upgrades instead of one and a half.
  if (food.kind === 'food.pasty' || food.kind === 'quest.fish') item.stored += HUNGRY / 2;
  if (item.stored >= HUNGRY) {
    const upgrades = Math.min(Math.trunc(item.stored / HUNGRY), 10 - item.level);
    upgradeArtifact(ctx, item, upgrades);
    item.stored -= upgrades * HUNGRY;
    if (item.level === 10) {
      item.stored = 0;
      say(ctx, hero, 'hornofplenty.maxlevel', 'p');
    } else {
      say(ctx, hero, 'hornofplenty.levelup', 'p');
    }
  } else {
    say(ctx, hero, 'hornofplenty.feed');
  }
  return TIME_TO_EAT;
}

/** HornOfPlenty.charge: a quarter of the boost. */
export function chargeHorn(ctx: Ctx, hero: Hero, item: Item, amount: number): void {
  const cap = chargeCap(item);
  if ((item.charge ?? 0) >= cap || item.cursed || magicImmune(hero)) return;
  item.partial = (item.partial ?? 0) + 0.25 * amount;
  while (item.partial >= 1) {
    item.partial--;
    item.charge = (item.charge ?? 0) + 1;
    if (item.charge === cap) {
      say(ctx, hero, 'hornofplenty.full', 'p');
      item.partial = 0;
    }
  }
}

/**
 * hornRecharge.gainCharge, with a share of a hero level's experience: a quarter of the most a hero can
 * be hungry, an eighth more a horn level, a charge a fifth of that.
 */
export function hornGainsExp(ctx: Ctx, hero: Hero, item: Item, levelPortion: number): void {
  if (item.cursed || magicImmune(hero)) return;
  const cap = chargeCap(item);
  if ((item.charge ?? 0) >= cap) {
    item.partial = 0;
    return;
  }
  let gain = STARVING * levelPortion * (0.25 + 0.125 * item.level);
  gain *= artifactChargeMultiplier(hero);
  gain /= STARVING / 5;
  item.partial = (item.partial ?? 0) + gain;
  while (item.partial >= 1) {
    item.charge = (item.charge ?? 0) + 1;
    item.partial -= 1;
    if (item.charge === cap) {
      say(ctx, hero, 'hornofplenty.full', 'p');
      item.partial = 0;
    }
  }
}

/** Food.satisfy: a cursed horn worn takes a third of what food is worth. */
export function foodValue(ctx: Ctx, hero: Hero, energy: number): number {
  const horn = wornOf(hero, 'artifact.horn');
  if (!horn?.cursed || magicImmune(hero)) return energy;
  ctx.effects.push({ type: 'artifact', hero: hero.id, msg: 'actors.buffs.hunger.cursedhorn', tone: 'n' });
  return Math.trunc(energy * 0.67);
}
