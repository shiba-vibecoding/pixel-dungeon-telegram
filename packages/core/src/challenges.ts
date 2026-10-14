import type { Item, ItemKind } from './items';

/*
 * Challenges (Challenges.java, Shattered Pixel Dungeon 4.0.2): optional handicaps chosen when a run starts,
 * kept as a bitmask on the world, so in co-op they bind the whole party. The masks are the original's, so a
 * run's choice reads the same in both games. What each one does is not here but where the thing it changes is
 * (food.ts, armor.ts, potions.ts, plants.ts, the level generators, ai.ts, champions.ts, bosses/*): this file
 * holds the list, the masks and Challenges.isItemBlocked.
 */

export type ChallengeId = 'champions' | 'strongerBosses' | 'noFood' | 'noArmor' | 'noHealing' | 'noHerbalism' | 'swarm' | 'darkness' | 'noScrolls';

export const NO_FOOD = 1;
export const NO_ARMOR = 2;
export const NO_HEALING = 4;
export const NO_HERBALISM = 8;
export const SWARM_INTELLIGENCE = 16;
export const DARKNESS = 32;
export const NO_SCROLLS = 64;
/** Shattered's «Hostile champions»: now and then a monster comes as a champion (ChampionEnemy, champions.ts). */
export const CHAMPION_ENEMIES = 128;
/** Shattered's «Badder bosses» (ru «Злые боссы»): every boss is tougher (bosses/*, LockedFloor, the traps of Tengu's prison). */
export const STRONGER_BOSSES = 256;

/** Challenges.MAX_VALUE: every mask on. */
export const MAX_CHALLENGES = 511;

/** Challenges.MASKS, in the original's order (Challenges.NAME_IDS: the order its window lists them in). */
export const CHALLENGES: ReadonlyArray<{ readonly id: ChallengeId; readonly mask: number }> = [
  { id: 'champions', mask: CHAMPION_ENEMIES },
  { id: 'strongerBosses', mask: STRONGER_BOSSES },
  { id: 'noFood', mask: NO_FOOD },
  { id: 'noArmor', mask: NO_ARMOR },
  { id: 'noHealing', mask: NO_HEALING },
  { id: 'noHerbalism', mask: NO_HERBALISM },
  { id: 'swarm', mask: SWARM_INTELLIGENCE },
  { id: 'darkness', mask: DARKNESS },
  { id: 'noScrolls', mask: NO_SCROLLS },
];

/** What a world needs to answer for its challenges; worlds saved before challenges existed have none. */
export interface Challenged {
  challenges?: number;
  known?: readonly ItemKind[];
}

/** Dungeon.isChallenged. */
export function isChallenged(world: Challenged, mask: number): boolean {
  return ((world.challenges ?? 0) & mask) !== 0;
}

/** Challenges.isItemBlocked: under «Barren land» dew drops are removed (Level.drop makes nothing of them). */
export function isItemBlocked(world: Challenged, item: Item): boolean {
  return isChallenged(world, NO_HERBALISM) && item.kind === 'dew';
}
