import { type Hero, heroArtifacts } from '../actors';
import type { Ctx } from '../floor';
import type { Item } from '../items';
import { dispelCloak } from './cloak';
import { endFreeze, frozenBy } from './hourglass';

/*
 * Invisibility as the artifacts add to it: the hero is unseen while invisible
 * (a potion, a phantom fish), while the cloak of shadows' stealth is on, and
 * while in the hourglass's stasis. Invisibility.dispel ends all of it, and the
 * hourglass's time freeze too: striking, shooting, zapping and most artifacts
 * give the hero away.
 */

/** The cloak whose stealth is on: worn, or carried with the light cloak talent. */
export const stealthCloak = (hero: Hero): Item | undefined =>
  [...heroArtifacts(hero), ...hero.items].find((item) => item.kind === 'artifact.cloak' && item.stealth);

/** Char.invisible > 0 for a hero. */
export const isInvisible = (hero: Hero): boolean => hero.invisible > 0 || (hero.stasis ?? 0) > 0 || stealthCloak(hero) !== undefined;

/** Invisibility.dispel(hero). */
export function dispelInvisibility(ctx: Ctx, hero: Hero): void {
  hero.invisible = 0;
  const cloak = stealthCloak(hero);
  if (cloak) dispelCloak(ctx, hero, cloak);
  const hourglass = frozenBy(hero);
  if (hourglass) endFreeze(ctx, hero, hourglass);
}
