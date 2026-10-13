import type { Hero } from '../actors';
import type { Ctx } from '../floor';
import type { Item } from '../items';
import type { World } from '../world';
import { levelCap } from './artifact';
import { isWorn, upgradeArtifact, wornOf } from './common';
import { alchemyEnergy, artifactChargeMultiplier, canBrewAnywhere, magicImmune, onArtifactUsed, spendAlchemyEnergy } from './seams';

/*
 * AlchemistsToolkit: worn, and once warmed up, it lets its bearer brew
 * anywhere; it gathers alchemical energy as they gain experience, two a hero
 * level and one more a toolkit level, which the alchemy draws on first. Six
 * energy crystals put into it make it a level stronger. Cursed, it forbids
 * alchemy altogether. (The alchemy itself is the alchemy stream's: see the
 * seams, and availableEnergy and consumeEnergy below.)
 */

/** AlchemistsToolkit.doEquip: put on, it starts warming up. */
export function toolkitPutOn(item: Item): void {
  item.warmUp = 101;
}

export function toolkitProblem(world: World, hero: Hero, item: Item, use: string, levels: number | undefined): string | null {
  if (magicImmune(hero)) return 'art:magic_immune';
  if (!isWorn(hero, item)) return 'art:alchemiststoolkit.need_to_equip';
  if (item.cursed) return 'art:alchemiststoolkit.cursed';
  if (use === 'brew') {
    if ((item.warmUp ?? 0) > 0) return 'art:alchemiststoolkit.not_ready';
    return canBrewAnywhere() ? null : 'art:cannot';
  }
  if (item.level >= levelCap(item)) return 'art:cannot';
  if (alchemyEnergy(world) < 6) return 'art:alchemiststoolkit.need_energy';
  const most = Math.min(levelCap(item) - item.level, Math.trunc(alchemyEnergy(world) / 6));
  return levels !== undefined && Number.isInteger(levels) && levels >= 1 && levels <= most ? null : 'art:cannot';
}

/** The ENERGIZE window: six energy a level. */
export function energizeToolkit(ctx: Ctx, _hero: Hero, item: Item, levels: number): number {
  spendAlchemyEnergy(ctx.world, 6 * levels);
  upgradeArtifact(ctx, item, levels);
  return 0;
}

/** kitEnergy.act: warming up, in (10 - level)² turns. */
export function toolkitAct(hero: Hero, item: Item): void {
  const warm = item.warmUp ?? 0;
  if (warm <= 0) return;
  if (item.level === 10) item.warmUp = 0;
  else if (warm === 101) item.warmUp = 100;
  else if (!item.cursed && !magicImmune(hero)) item.warmUp = warm - 100 / Math.trunc((10 - item.level) ** 2);
}

/** kitEnergy.gainCharge: energy with a share of a hero level's experience. */
export function toolkitGainsExp(hero: Hero, item: Item, levelPortion: number): void {
  if (item.cursed || magicImmune(hero)) return;
  item.partial = (item.partial ?? 0) + (2 + item.level) * levelPortion * artifactChargeMultiplier(hero);
  while (item.partial >= 1) {
    item.charge = (item.charge ?? 0) + 1;
    item.partial -= 1;
  }
}

/** AlchemistsToolkit.charge: a quarter of the boost. */
export function chargeToolkit(hero: Hero, item: Item, amount: number): void {
  if (magicImmune(hero)) return;
  item.partial = (item.partial ?? 0) + 0.25 * amount;
  while (item.partial >= 1) {
    item.partial--;
    item.charge = (item.charge ?? 0) + 1;
  }
}

/** For the alchemy stream: the toolkit worn (warmed up, uncursed), whose energy alchemy may draw on. */
export const readyToolkit = (hero: Hero): Item | undefined => {
  const item = wornOf(hero, 'artifact.toolkit');
  return item && !item.cursed && (item.warmUp ?? 0) <= 0 && !magicImmune(hero) ? item : undefined;
};

/** For the alchemy stream (Hero.actAlchemy): a cursed toolkit worn forbids alchemy at a pot too. */
export const toolkitForbidsAlchemy = (hero: Hero): boolean => wornOf(hero, 'artifact.toolkit')?.cursed === true && !magicImmune(hero);

/** AlchemistsToolkit.availableEnergy. */
export const availableEnergy = (item: Item): number => item.charge ?? 0;

/** AlchemistsToolkit.consumeEnergy: what it holds goes first; returns what is still owed. */
export function consumeEnergy(ctx: Ctx, hero: Hero, item: Item, amount: number): number {
  const result = amount - (item.charge ?? 0);
  item.charge = Math.max(0, (item.charge ?? 0) - amount);
  onArtifactUsed(ctx, hero);
  return Math.max(0, result);
}

/** AlchemistsToolkit.status: warming up, how far along (as a percentage). */
export const toolkitWarming = (hero: Hero, item: Item): number | null =>
  isWorn(hero, item) && (item.warmUp ?? 0) > 0 && !item.cursed ? Math.max(0, 100 - Math.trunc(item.warmUp!)) : null;
