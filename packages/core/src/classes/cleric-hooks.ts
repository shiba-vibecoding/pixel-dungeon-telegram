import type { Hero } from '../actors';
import type { Char, Ctx } from '../floor';

/* The Cleric's part in Char.attack (filled in with the spells). */

/** What the Cleric's blessings do to a hero's blow: Illuminated foes, the power of many. */
export function clericBlowDamage(_ctx: Ctx, _hero: Hero, _defender: Char, damage: number): number {
  return damage;
}

/** What the Cleric's wards do to a blow that a monster deals. */
export function clericDefenseDamage(_ctx: Ctx, _attacker: Char, _defender: Char, damage: number): number {
  return damage;
}

/** Hero.drRoll's additions. */
export function drRollBonus(_hero: Hero): number {
  return 0;
}
