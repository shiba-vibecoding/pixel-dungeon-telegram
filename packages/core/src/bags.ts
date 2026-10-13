import { BACKPACK_SIZE, type Hero } from './actors';
import { isStackable, type Item, type ItemCategory, itemDef, type ItemKind } from './items';

/*
 * Bags (Bag: SeedPouch, ScrollHolder, WandHolster, Keyring). Whatever a bag
 * holds takes no room in the backpack, up to the bag's size, and is out of
 * reach of fire and thieves. Keys never take room: every hero carries a key
 * ring. A bag itself takes a slot.
 */

export const BAGS: Readonly<Partial<Record<ItemKind, { holds: ItemCategory; size: number }>>> = {
  'bag.seeds': { holds: 'seed', size: 8 },
  'bag.scrolls': { holds: 'scroll', size: 12 },
  'bag.wands': { holds: 'wand', size: 12 },
};

/** How many items of a category the hero's bags can hold. */
function bagRoom(hero: Hero, category: ItemCategory): number {
  return hero.items.reduce((room, item) => room + (BAGS[item.kind]?.holds === category ? BAGS[item.kind]!.size : 0), 0);
}

/** Whether an item in the pack lies in a bag (or on the key ring), rather than in the backpack itself. */
export function inBag(hero: Hero, item: Item): boolean {
  const category = itemDef(item.kind).category;
  if (category === 'key') return true;
  const room = bagRoom(hero, category);
  if (room === 0) return false;
  const same = hero.items.filter((other) => itemDef(other.kind).category === category);
  return same.indexOf(item) < room;
}

/** Backpack slots taken: everything not in a bag. */
export const slotsUsed = (hero: Hero): number => hero.items.filter((item) => !inBag(hero, item)).length + (hero.secondWep ? 1 : 0);

/** Whether an item would fit: onto a stack, into a bag, or into a free slot. */
export function hasRoom(hero: Hero, item: Item): boolean {
  const category = itemDef(item.kind).category;
  if (category === 'gold' || category === 'key') return true;
  if (isStackable(item.kind) && hero.items.some((other) => other.kind === item.kind)) return true;
  if (hero.items.filter((other) => itemDef(other.kind).category === category).length < bagRoom(hero, category)) return true;
  return slotsUsed(hero) < BACKPACK_SIZE;
}

/** Belongings.randomUnequipped: what fire or a thief can get at, the bags themselves but not what is in them. */
export const looseItems = (hero: Hero): Item[] => hero.items.filter((item) => !inBag(hero, item));