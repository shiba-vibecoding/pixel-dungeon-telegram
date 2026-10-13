import type { Hero } from '../actors';
import type { Ctx } from '../floor';
import type { Item } from '../items';
import { chargeCap, levelCap } from './artifact';
import { isWorn, say, upgradeArtifact } from './common';
import { artifactChargeMultiplier, lightCloakPoints, magicImmune, onArtifactUsed, onCloakStealth, regenOn } from './seams';

/*
 * CloakOfShadows, the rogue's own: worn (or carried, with the light cloak
 * talent), it makes its bearer invisible for as long as its charge lasts, a
 * charge every four turns; it recharges while not in use, and grows stronger
 * the more turns it is used near the hero's own level.
 */

/** Whether the cloak's stealth may be turned on or off now. */
export function cloakProblem(hero: Hero, item: Item): string | null {
  if (magicImmune(hero)) return 'art:magic_immune';
  if (item.stealth) return null;
  if (!isWorn(hero, item) && lightCloakPoints(hero) === 0) return 'art:artifact.need_to_equip';
  if (item.cursed) return 'art:cloakofshadows.cursed';
  if ((item.charge ?? 0) <= 0) return 'art:cloakofshadows.no_charge';
  return null;
}

/** CloakOfShadows.execute(STEALTH): it takes a turn to wrap oneself in it; casting it off takes none. */
export function useCloak(ctx: Ctx, hero: Hero, item: Item): number {
  if (item.stealth) {
    delete item.stealth;
    ctx.effects.push({ type: 'stealth', hero: hero.id, on: false });
    return 0;
  }
  // cloakStealth.attachTo: turnsToCost starts at 0, so its first turn costs a charge.
  item.stealth = { turnsToCost: 0 };
  onCloakStealth(ctx, hero);
  onArtifactUsed(ctx, hero);
  ctx.effects.push({ type: 'stealth', hero: hero.id, on: true });
  return 1;
}

/** cloakStealth.dispel: struck at or striking, the cloak gives the hero away (a charge, if its turn was due). */
export function dispelCloak(ctx: Ctx, hero: Hero, item: Item): void {
  if (!item.stealth) return;
  if (item.stealth.turnsToCost <= 0 && (item.charge ?? 0) > 0) item.charge!--;
  delete item.stealth;
  ctx.effects.push({ type: 'stealth', hero: hero.id, on: false });
}

/** Whether the cloak's stealth is on: the hero is unseen. */
export const cloaked = (item: Item | undefined): boolean => !!item?.stealth;

/** cloakRecharge.act and cloakStealth.act, once a turn. */
export function cloakAct(ctx: Ctx, hero: Hero, item: Item): void {
  if (item.stealth) stealthAct(ctx, hero, item);
  const cap = chargeCap(item);
  let charge = item.charge ?? 0;
  if (charge < cap && !item.cursed && !magicImmune(hero)) {
    if (!item.stealth && regenOn(ctx, hero)) {
      let missing = cap - charge;
      if (item.level > 7) missing += (5 * (item.level - 7)) / 3;
      const turnsToCharge = (45 - missing) / artifactChargeMultiplier(hero);
      let gain = 1 / turnsToCharge;
      if (!isWorn(hero, item)) gain *= (0.75 * lightCloakPoints(hero)) / 3;
      item.partial = (item.partial ?? 0) + gain;
    }
    while ((item.partial ?? 0) >= 1) {
      charge++;
      item.partial! -= 1;
      if (charge === cap) item.partial = 0;
    }
    item.charge = charge;
  } else {
    item.partial = 0;
  }
  if ((item.cooldown ?? 0) > 0) item.cooldown!--;
}

/** cloakStealth.act: every fourth turn costs a charge and teaches the cloak; out of charge, the hero is seen again. */
function stealthAct(ctx: Ctx, hero: Hero, item: Item): void {
  const stealth = item.stealth!;
  stealth.turnsToCost--;
  if (stealth.turnsToCost > 0) return;
  item.charge = (item.charge ?? 0) - 1;
  if (item.charge < 0) {
    item.charge = 0;
    delete item.stealth;
    say(ctx, hero, 'cloakofshadows$cloakstealth.no_charge', 'w');
    ctx.effects.push({ type: 'stealth', hero: hero.id, on: false });
    ctx.effects.push({ type: 'interrupted', hero: hero.id, reason: 'art:cloakofshadows$cloakstealth.no_charge' });
    return;
  }
  // The level the hero is aimed at is 1 + 2 a cloak level, and one more for each level past 6.
  let diff = hero.lvl - (1 + item.level * 2);
  if (item.level >= 7) diff -= item.level - 6;
  item.exp = (item.exp ?? 0) + (diff >= 0 ? Math.round(10 * Math.fround(1.1) ** diff) : Math.round(10 * 0.75 ** -diff));
  if (item.exp >= (item.level + 1) * 50 && item.level < levelCap(item)) {
    upgradeArtifact(ctx, item);
    item.exp -= item.level * 50;
    say(ctx, hero, 'cloakofshadows$cloakstealth.levelup', 'p');
  }
  stealth.turnsToCost = 4;
}

/** CloakOfShadows.charge: a quarter of the boost, less from the pack. */
export function chargeCloak(hero: Hero, item: Item, amount: number): void {
  if (item.cursed || magicImmune(hero)) return;
  const cap = chargeCap(item);
  let charge = item.charge ?? 0;
  if (charge >= cap) return;
  if (!isWorn(hero, item)) amount *= (0.75 * lightCloakPoints(hero)) / 3;
  item.partial = (item.partial ?? 0) + 0.25 * amount;
  while (item.partial >= 1) {
    charge++;
    item.partial--;
  }
  if (charge >= cap) {
    item.partial = 0;
    charge = cap;
  }
  item.charge = charge;
}

/** CloakOfShadows.directCharge (the rogue's talents). */
export function directChargeCloak(item: Item, amount: number): void {
  item.charge = Math.min((item.charge ?? 0) + amount, chargeCap(item));
}
