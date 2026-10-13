import type { Hero } from './actors';

/*
 * items/artifacts/SkeletonKey: Shattered v4's artifact, which opens, locks and walls with its charges.
 */

/** Hero.actUnlock: a door this hero's (uncursed) skeleton key locked will not open to its bearer. */
export function skeletonKeyLocks(hero: Hero): boolean {
  return hero.items.some((item) => item.kind === 'artifact.skeletonKey' && !item.cursed);
}
