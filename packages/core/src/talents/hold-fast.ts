import type { Hero } from '../actors';
import type { Rng } from '../rng';
import { armorTier } from '../armor';
import { gearLevel } from '../weapons';
import { pointsInTalent } from './data';
import { tbOf } from './state';

/*
 * HoldFast (actors/buffs/HoldFast.java): a hero who rests on a spot with the talent digs in until they move: the
 * armour is a little better (a roll of 1-2 to 2-4 more, up to six for the warrior, the armour's tier and level for
 * others), and some buffs wear off more slowly (berserk's shield, combo, the seal's shield).
 */

/** HoldFast.armorBonus: a roll for this blow, or nothing once the hero has moved from the spot. */
export function holdFastArmor(hero: Hero, rng: Rng): number {
  const b = tbOf(hero);
  if (b.holdFast === undefined) return 0;
  if (b.holdFast !== hero.pos) {
    delete b.holdFast;
    return 0;
  }
  const points = pointsInTalent(hero, 'hold_fast');
  const max = hero.heroClass === 'warrior' ? 6 : armorTier(hero.armor) + gearLevel(hero.armor);
  return Math.min(rng.normalIntRange(points, 2 * points), max);
}

/** HoldFast.buffDecayFactor: the buffs it slows run at half, a quarter, or not at all. */
export function holdFastDecay(hero: Hero): number {
  const b = tbOf(hero);
  if (b.holdFast === undefined) return 1;
  if (b.holdFast !== hero.pos) {
    delete b.holdFast;
    return 1;
  }
  switch (pointsInTalent(hero, 'hold_fast')) {
    case 1: return 0.5;
    case 2: return 0.25;
    case 3: return 0;
    default: return 1;
  }
}

/** Hero.rest: resting digs in (a warrior needs the seal's shield buff to hold fast; other classes only the talent). */
export function holdFastRest(hero: Hero, hasSealBuff: boolean): void {
  if (pointsInTalent(hero, 'hold_fast') <= 0) return;
  if (hero.heroClass !== 'warrior' || hasSealBuff) tbOf(hero).holdFast = hero.pos;
}
