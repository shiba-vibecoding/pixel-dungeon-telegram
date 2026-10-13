import { BACKPACK_SIZE, type Hero } from './actors';
import { isStackable, type Item, type ItemCategory, itemDef, type ItemKind } from './items';

/*
 * Bags (items/bags: VelvetPouch, ScrollHolder, PotionBandolier, MagicalHolster). Whatever a bag can
 * hold goes into it, up to its capacity (19 each, Bag.capacity), and takes no room in the backpack;
 * the scroll holder keeps scrolls from fire and the bandolier potions from the cold. Keys never
 * take room: every hero carries a key ring. A bag itself takes a slot.
 */

export interface BagDef {
  /** Bag.canHold: what goes in it. */
  holds: readonly ItemCategory[];
  /** Bag.capacity. */
  size: number;
}

export const BAGS: Readonly<Partial<Record<ItemKind, BagDef>>> = {
  // VelvetPouch: seeds and runestones (and goo blobs and metal shards; SEAM(alchemy): weightstones stand for runestones).
  'bag.seeds': { holds: ['seed', 'weightstone'], size: 19 },
  // ScrollHolder: scrolls (and spells, arcane resin, styli).
  'bag.scrolls': { holds: ['scroll', 'wipeout'], size: 19 },
  // PotionBandolier: potions, the waterskin (and liquid metal).
  'bag.potions': { holds: ['potion', 'vial'], size: 19 },
  // MagicalHolster: wands, thrown weapons and bombs.
  'bag.wands': { holds: ['wand', 'missile', 'bomb'], size: 19 },
};

/** The bag a category goes into, if the hero has one. */
function bagFor(hero: Hero, category: ItemCategory): BagDef | undefined {
  for (const item of hero.items) {
    const bag = BAGS[item.kind];
    if (bag?.holds.includes(category)) return bag;
  }
  return undefined;
}

/** Whether an item in the pack lies in a bag (or on the key ring), rather than in the backpack itself. */
export function inBag(hero: Hero, item: Item): boolean {
  const category = itemDef(item.kind).category;
  if (category === 'key') return true;
  const bag = bagFor(hero, category);
  if (!bag) return false;
  const same = hero.items.filter((other) => bag.holds.includes(itemDef(other.kind).category));
  return same.indexOf(item) < bag.size;
}

/** Backpack slots taken: everything not in a bag. */
export const slotsUsed = (hero: Hero): number => hero.items.filter((item) => !inBag(hero, item)).length;

/** Whether an item would fit: onto a stack, into a bag, or into a free slot. */
export function hasRoom(hero: Hero, item: Item): boolean {
  const category = itemDef(item.kind).category;
  if (category === 'gold' || category === 'key') return true;
  if (isStackable(item.kind) && hero.items.some((other) => other.kind === item.kind)) return true;
  const bag = bagFor(hero, category);
  if (bag && hero.items.filter((other) => bag.holds.includes(itemDef(other.kind).category)).length < bag.size) return true;
  return slotsUsed(hero) < BACKPACK_SIZE;
}

/** Belongings.randomUnequipped: what fire or a thief can get at, the bags themselves but not what is in them. */
export const looseItems = (hero: Hero): Item[] => hero.items.filter((item) => !inBag(hero, item));

/** Bag.value: what a bag is worth. */
export const BAG_VALUES: Readonly<Partial<Record<ItemKind, number>>> = {
  'bag.seeds': 30, 'bag.scrolls': 40, 'bag.potions': 40, 'bag.wands': 60,
};
