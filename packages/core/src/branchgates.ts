import type { Hero } from './actors';
import type { Level } from './level/generate';
import type { World } from './world';

/*
 * Level.activateTransition for the branch transitions: whether a hero may go down to a depth's side
 * level (CavesLevel: the blacksmith's quest begun, with his pickaxe; CityLevel: the imp's errand
 * given) or come back up (MiningLevel, VaultLevel). The quests' modules fill these in; until they do,
 * the way is open.
 */
export const BRANCH_GATES: {
  enter: (world: World, hero: Hero, level: Level) => string | null;
  leave: (world: World, hero: Hero, level: Level) => string | null;
} = {
  enter: () => null,
  leave: () => null,
};
