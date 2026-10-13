import type { Hero } from '../actors';
import type { Ctx } from '../floor';
import { identify } from '../ident';
import { pointsIn } from '../talents';

/** Hero.upgradeTalent and Talent.onTalentUpgraded: a point goes into a talent, and what the talent does at once happens. */
export function upgradeTalent(ctx: Ctx, hero: Hero, id: string): void {
  (hero.talents ??= {})[id] = pointsIn(hero, id) + 1;
  ctx.effects.push({ type: 'classFx', depth: ctx.depth, hero: hero.id, fx: { k: 'talent', talent: id, points: pointsIn(hero, id) } });
  // Adventurer's intuition at +2: the weapons held are known through and through.
  if (id === 'ADVENTURERS_INTUITION' && pointsIn(hero, id) === 2) {
    if (hero.weapon) identify(ctx.world, hero.weapon);
    if (hero.secondWep) identify(ctx.world, hero.secondWep);
  }
}
