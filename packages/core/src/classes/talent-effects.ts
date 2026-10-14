import type { Hero } from '../actors';
import type { Ctx } from '../floor';
import { identify } from '../ident';
import { pointsInTalent as pointsIn } from '../talents/data';

/** Talent.onTalentUpgraded for the Duelist's and the Cleric's talents (talents/index.ts upgradeTalent calls it). */
export function classTalentUpgraded(ctx: Ctx, hero: Hero, id: string): void {
  // Adventurer's intuition at +2: the weapons held are known through and through.
  if (id === 'adventurers_intuition' && pointsIn(hero, id) === 2) {
    if (hero.weapon) identify(ctx.world, hero.weapon);
    if (hero.secondWep) identify(ctx.world, hero.secondWep);
  }
}
