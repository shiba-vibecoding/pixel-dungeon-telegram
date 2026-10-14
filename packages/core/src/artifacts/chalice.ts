import { isChallenged, NO_ARMOR } from '../challenges';
import { spiritChalice } from '../classes/state';
import { type Hero, heroArmor, isAlive, isStarving } from '../actors';
import { hurt } from '../combat';
import type { Ctx } from '../floor';
import type { Item } from '../items';
import { earthrootAbsorbs } from '../plants';
import { levelCap } from './artifact';
import { isWorn, say, upgradeArtifact, wornOf } from './common';
import { artifactChargeMultiplier, magicImmune } from './seams';

/*
 * ChaliceOfBlood: pricking oneself on it feeds it one's life, the more each
 * time, and each prick makes it a level stronger; worn, it quickens the
 * hero's healing, five times over at its best. Worn cursed, it slows it.
 */

/** ChaliceOfBlood.minPrickDmg and maxPrickDmg. */
export const minPrick = (item: Item): number => Math.ceil(3 + 2.5 * item.level * item.level);
export const maxPrick = (item: Item): number => Math.floor(7 + 3.5 * item.level * item.level);

/** ChaliceOfBlood.execute(PRICK)'s warning: how likely the next prick is to kill (0 to 1). */
export function prickDeathChance(hero: Hero, item: Item): number {
  const min = minPrick(item);
  const max = maxPrick(item);
  // Hero.shielding: none here.
  const total = hero.hp;
  if (total > max) return 0;
  // The results that kill, of all there are; then squared on each side of a half.
  let chance = (max - (total - 1)) / (max - min + 1);
  if (chance < 0.5) chance = (2 * chance) ** 2 / 2;
  else if (chance < 1) chance = 1 - (2 * (1 - chance)) ** 2 / 2;
  else chance = 1;
  return chance;
}

export function chaliceProblem(hero: Hero, item: Item): string | null {
  if (magicImmune(hero)) return 'art:magic_immune';
  if (!isWorn(hero, item)) return 'art:artifact.need_to_equip';
  if (item.level >= levelCap(item) || item.cursed) return 'art:cannot';
  return null;
}

/** ChaliceOfBlood.prick: blood for the chalice, the hero's armour and earthroot's bark taking their share first. */
export function prick(ctx: Ctx, hero: Hero, item: Item): number {
  let damage = ctx.rng.normalIntRange(minPrick(item), maxPrick(item));
  damage = earthrootAbsorbs(hero, damage);
  damage -= ctx.rng.intRange(0, heroArmor(hero, isChallenged(ctx.world, NO_ARMOR)));
  say(ctx, hero, 'chaliceofblood.onprick', 'w');
  if (damage <= 0) damage = 1;
  ctx.effects.push({ type: 'hurt', depth: ctx.depth, who: hero.id, damage });
  hurt(ctx, hero, damage, 'chalice');
  if (!isAlive(hero)) {
    say(ctx, hero, 'chaliceofblood.ondeath', 'n');
  } else {
    upgradeArtifact(ctx, item);
  }
  return 1;
}

/** ChaliceOfBlood.charge: five turns' worth of its healing at once, if the hero is not starving. */
export function chargeChalice(ctx: Ctx, hero: Hero, item: Item, amount: number): void {
  if (item.cursed || magicImmune(hero) || isStarving(hero)) return;
  const healDelay = (10 - (1.33 + item.level * 0.667)) / amount;
  let heal = 5 / healDelay;
  if (ctx.rng.float() < heal % 1) heal++;
  if (heal >= 1 && hero.hp < hero.ht) {
    const amountHealed = Math.min(hero.ht - hero.hp, Math.trunc(heal));
    hero.hp += amountHealed;
    ctx.effects.push({ type: 'healed', hero: hero.id, amount: Math.trunc(heal) });
  }
}

/** Regeneration.act with the chalice worn: the delay between healed points, cursed half as long again, else shorter. */
export function chaliceRegenDelay(hero: Hero, delay: number): number {
  const chalice = wornOf(hero, 'artifact.chalice');
  if (magicImmune(hero)) return delay;
  // SpiritForm: the chalice's passive regeneration lent for twenty turns (Regeneration.act).
  const lent = chalice ? undefined : spiritChalice(hero);
  if (lent) return (delay - (1.33 + lent.level * 0.667)) / artifactChargeMultiplier(hero);
  if (!chalice) return delay;
  if (chalice.cursed) return delay * 1.5;
  // 15% faster at +0, five times as fast at +10.
  return (delay - (1.33 + chalice.level * 0.667)) / artifactChargeMultiplier(hero);
}
