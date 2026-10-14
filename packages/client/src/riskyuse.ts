import { cursedKnown, type Hero, type Item, itemDef, type ItemKind, kindKnown, visibleEnemies, type World } from '@pd/core';

/*
 * Confirming risky use (the forum study, U1 and U3): putting on a weapon, armour or ring whose curse is not known,
 * drinking an unknown potion with an enemy in sight, and reading a scroll or stone on the thing it will change for
 * good. Pure rules here; the questions are asked by the backpack (screens.ts) and share the settings switch with
 * mis-tap protection's way of working: «don't ask again» is kept on this device only.
 */

const KEY = 'pd-confirm-risky';

/** Whether the questions about equipping the unknown and drinking it among enemies are asked: on unless turned off. */
export const confirmRisky = {
  on: ((): boolean => {
    try {
      return localStorage.getItem(KEY) !== 'off';
    } catch {
      return true;
    }
  })(),
  set(on: boolean): void {
    this.on = on;
    try {
      localStorage.setItem(KEY, on ? 'on' : 'off');
    } catch {
      // For this session only.
    }
  },
};

/** What can be worn and may be cursed (about 30% of what is found): the curse binds the thing on the hero at once. */
const WORN = new Set(['weapon', 'armor', 'ring', 'artifact']);

/** A weapon, armour, ring or artifact whose curse is not known yet: putting it on is a gamble. */
export function equipRisk(item: Item): boolean {
  return WORN.has(itemDef(item.kind).category) && !cursedKnown(item);
}

/** An unknown potion (not a brew, nor an exotic one in the catalog) while an enemy is in sight: drinking it is a gamble. */
export function drinkRisk(world: World, hero: Hero, item: Item): boolean {
  if (itemDef(item.kind).category !== 'potion' || kindKnown(world, item)) return false;
  return visibleEnemies(world, hero).length > 0;
}

/** What a scroll, stone or spell does to the item it is used on, for the question asked first (none for the rest). */
export type TargetEffect = 'upgrade' | 'enchant' | 'transmute' | 'curse';

const EFFECTS: Partial<Record<ItemKind, TargetEffect>> = {
  'scroll.upgrade': 'upgrade',
  'spell.magicalInfusion': 'upgrade',
  'scroll.enchantment': 'enchant',
  'stone.enchantment': 'enchant',
  'scroll.transmutation': 'transmute',
  'spell.curseInfusion': 'curse',
};

/** What using `kind` on an item does for good, if that is worth a question. */
export const targetEffect = (kind: ItemKind): TargetEffect | undefined => EFFECTS[kind];


/**
 * Weapon.upgrade and Armor.upgrade: the chance, in percent, that the next upgrade wipes the item's enchantment or glyph
 * away (10/20/40/80/100% from +4; a hardened or cursed one aside), or 0 when it cannot happen.
 */
export function enchantLossChance(item: Item): number {
  const category = itemDef(item.kind).category;
  if (category !== 'weapon' && category !== 'armor' && category !== 'missile') return 0;
  if (!item.enchant && !item.glyph) return 0;
  if (item.hardened || item.cursed) return 0;
  if (item.level < 4) return 0;
  return Math.min(100, 10 * 2 ** (item.level - 4));
}
