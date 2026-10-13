import { createItem, type Item, itemDef, itemPrice, type ItemKind, knownIn } from './items';

/*
 * Challenges (Challenges.java): optional handicaps chosen when a run starts,
 * kept as a bitmask on the world, so in co-op they bind the whole party. The
 * masks are the original's, so a run's choice reads the same in both games.
 */

export type ChallengeId = 'noFood' | 'noArmor' | 'noHealing' | 'noHerbalism' | 'swarm' | 'darkness' | 'noScrolls' | 'champions';

export const NO_FOOD = 1;
export const NO_ARMOR = 2;
export const NO_HEALING = 4;
export const NO_HERBALISM = 8;
export const SWARM_INTELLIGENCE = 16;
export const DARKNESS = 32;
export const NO_SCROLLS = 64;
/** Shattered's «Hostile champions»: now and then a monster comes as a champion (ChampionEnemy, champions.ts). */
export const CHAMPION_ENEMIES = 128;

/** Challenges.MASKS, in the original's order (the order its window lists them in). */
export const CHALLENGES: ReadonlyArray<{ readonly id: ChallengeId; readonly mask: number }> = [
  { id: 'noFood', mask: NO_FOOD },
  { id: 'noArmor', mask: NO_ARMOR },
  { id: 'noHealing', mask: NO_HEALING },
  { id: 'noHerbalism', mask: NO_HERBALISM },
  { id: 'swarm', mask: SWARM_INTELLIGENCE },
  { id: 'darkness', mask: DARKNESS },
  { id: 'noScrolls', mask: NO_SCROLLS },
  { id: 'champions', mask: CHAMPION_ENEMIES },
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

/**
 * The checks of Level.drop, in its order: food, any armour, potions of
 * healing, the seed pouch, and every scroll but upgrade (and the scroll
 * holder) are forbidden on the floor under their challenges.
 */
function forbidden(world: Challenged, item: Item): boolean {
  const category = itemDef(item.kind).category;
  if (isChallenged(world, NO_FOOD) && category === 'food') return true;
  if (isChallenged(world, NO_ARMOR) && category === 'armor') return true;
  if (isChallenged(world, NO_HEALING) && item.kind === 'potion.healing') return true;
  if (isChallenged(world, NO_HERBALISM) && item.kind === 'bag.seeds') return true;
  // "These scrolls still can be found."
  return isChallenged(world, NO_SCROLLS) && ((category === 'scroll' && item.kind !== 'scroll.upgrade') || item.kind === 'bag.scrolls');
}

/**
 * Level.drop: whatever comes to lie on the floor — a new level's finds and a
 * shop's wares, a monster's loot, what a hero drops or throws — is, when a
 * challenge forbids it, gold of its worth instead (new Gold(item.price())).
 */
export function underChallenges(world: Challenged, item: Item): Item {
  if (!world.challenges || !forbidden(world, item)) return item;
  return createItem('gold', itemPrice(item, knownIn(world.known ?? [], item.kind)));
}
