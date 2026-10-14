import type { Hero, Mob } from '../actors';
import type { Ctx } from '../floor';

/*
 * Seams for the other streams.
 */

/** SEAM(talents): Combo.hit — the gladiator's combo counts a blow (a shockwave's striking wave is one). */
export function comboHit(_ctx: Ctx, _hero: Hero, _foe: Mob): void {
  // Nothing until the talents stream ports Shattered's Combo.
}

/** SEAM(talents): Combo.addTime — Endure gives a gladiator's combo three turns more. */
export function comboAddTime(_hero: Hero, _turns: number): void {
  // Nothing until the talents stream ports Shattered's Combo.
}
