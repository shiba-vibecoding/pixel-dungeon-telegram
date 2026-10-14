import type { Hero } from '../actors';
import { regenOn } from '../hero';
import type { Ctx } from '../floor';
import { cs } from './state';
import { pointsInTalent as pointsIn } from '../talents';

/*
 * MeleeWeapon.Charger: the Duelist's weapon charges. Every weapon's ability costs one (a few cost none under
 * the right circumstances); charges come back with time, faster for the Champion, slower while the brawler's
 * stance is held; a Duelist starts with two and holds up to eight (ten for the Champion) by her level.
 */

/** The charges a Duelist starts with (Charger.charges). */
export const START_CHARGES = 2;

/** Charger.chargeCap: caps at level 19 with 8 or 10 charges. */
export function chargeCap(hero: Hero): number {
  const step = Math.trunc((hero.lvl - 1) / 3);
  return hero.subclass === 'champion' ? Math.min(10, 4 + step) : Math.min(8, 2 + step);
}

/** The charges the hero has (a Duelist's Charger exists from the moment her first weapon is in hand). */
export function charges(hero: Hero): number {
  // (Only a read: the checks of what an action may do look at the charges, and a refused action must change nothing.)
  return hero.cls?.charges ?? START_CHARGES;
}

/** Charger.charges + partialCharge, as the ability checks count them. */
export const chargeTotal = (hero: Hero): number => charges(hero) + (hero.cls?.partial ?? 0);

/** Charger.act, a turn's worth. */
export function chargerTurn(ctx: Ctx, hero: Hero): void {
  const state = cs(hero);
  const have = charges(hero);
  if (have < chargeCap(hero)) {
    if (regenOn(ctx.world, hero)) {
      // 60 to 45 turns per charge.
      let gain = Math.fround(1 / Math.fround(60 - 1.5 * (chargeCap(hero) - have)));
      // 40 to 30 turns per charge for the Champion.
      if (hero.subclass === 'champion') gain = Math.fround(gain * 1.5);
      // 50% slower charge gain with the brawler's stance enabled, even once it is only a memory.
      if (state.brawl) gain = Math.fround(gain * 0.5);
      state.partial = (state.partial ?? 0) + gain;
    }
    // weapon_recharging: "points > 0 && Recharging || ArtifactRecharge" as Shattered writes it.
    const points = pointsIn(hero, 'weapon_recharging');
    const recharging = (hero.recharging ?? 0) > 0;
    const artifactRecharge = (hero.buffs?.artifactRecharge ?? 0) > 0;
    if ((points > 0 && recharging) || artifactRecharge) {
      // 1 every 15 turns at +1, 10 turns at +2.
      state.partial = (state.partial ?? 0) + Math.fround(1 / (20 - 5 * points));
    }
    if ((state.partial ?? 0) >= 1) {
      state.charges = have + 1;
      state.partial = state.partial! - 1;
    }
  } else {
    state.partial = 0;
  }
}

/** Charger.gainCharge. */
export function gainCharge(hero: Hero, amount: number): void {
  const state = cs(hero);
  if (charges(hero) >= chargeCap(hero)) return;
  state.partial = (state.partial ?? 0) + amount;
  while (state.partial >= 1) {
    state.charges = charges(hero) + 1;
    state.partial -= 1;
  }
  if (charges(hero) >= chargeCap(hero)) {
    state.partial = 0;
    state.charges = chargeCap(hero);
  }
}

/** MeleeWeapon.beforeAbilityUsed's cost: charges are spent whole, borrowing from the partial charge. */
export function spendCharges(hero: Hero, amount: number): void {
  const state = cs(hero);
  state.partial = (state.partial ?? 0) - amount;
  while (state.partial < 0 && charges(hero) > 0) {
    state.charges = charges(hero) - 1;
    state.partial += 1;
  }
}
