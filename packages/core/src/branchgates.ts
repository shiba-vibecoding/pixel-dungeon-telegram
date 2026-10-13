import type { Hero } from './actors';
import type { Ctx } from './floor';
import type { Level } from './level/generate';
import type { World } from './world';

/*
 * Level.activateTransition for the branch transitions: whether a hero may go down to a depth's side
 * level (CavesLevel: the blacksmith's quest begun, with his pickaxe; CityLevel: the imp's errand
 * given) or come back up (MiningLevel, VaultLevel). The quests' modules fill these in; until they do,
 * the way is open. `taken` is what a quest does once the way is taken (Blacksmith.Quest.start on the
 * way down, Quest.complete on the way back up); each module chains on to the one before it.
 */
export const BRANCH_GATES: {
  enter: (world: World, hero: Hero, level: Level) => string | null;
  leave: (world: World, hero: Hero, level: Level) => string | null;
  taken: (ctx: Ctx, hero: Hero, toBranch: number) => void;
} = {
  enter: () => null,
  leave: () => null,
  taken: () => undefined,
};
