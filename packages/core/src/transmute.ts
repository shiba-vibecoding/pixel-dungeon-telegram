import { createItem, type Item, itemDef, ItemGenerator, type ItemKind, wandMaxCharges } from './items';
import { randomOfTier } from './gear';
import { isDart } from './missiles';
import type { Rng } from './rng';

/*
 * Water of transmutation (WaterOfTransmutation): an item dropped into the
 * well comes out as another of its kind. Melee weapons turn into their twin
 * of the same tier; rings, wands and seeds into some other ring, wand or
 * seed; a scroll of upgrade into one of enchantment and back; a potion of
 * strength into one of might and back; other scrolls and potions into
 * others. Levels, curses and stacks are kept, and as much as was known of
 * them; an enchantment comes out as a new one.
 */


const SWAPS: Partial<Record<ItemKind, ItemKind>> = {
  'scroll.upgrade': 'scroll.enchantment', 'scroll.enchantment': 'scroll.upgrade',
  'potion.strength': 'potion.might', 'potion.might': 'potion.strength',
};

/** What the water makes of an item, or null if it leaves it be. */
export function transmute(item: Item, rng: Rng, depth: number): Item | null {
  const category = itemDef(item.kind).category;
  const generator = new ItemGenerator(rng, depth);
  /** Another kind of the category, drawn as the generator would. */
  const other = (pick: () => ItemKind, also: (kind: ItemKind) => boolean = () => true): ItemKind => {
    for (let i = 0; i < 100; i++) {
      const kind = pick();
      if (kind !== item.kind && also(kind)) return kind;
    }
    return item.kind;
  };
  const keep = (kind: ItemKind): Item => {
    const changed: Item = { ...createItem(kind, item.qty, item.level) };
    if (item.cursed) changed.cursed = true;
    // WaterOfTransmutation: n.levelKnown = w.levelKnown, n.cursedKnown = w.cursedKnown.
    if (item.levelUnknown) changed.levelUnknown = true;
    if (item.curseUnknown) changed.curseUnknown = true;
    return changed;
  };
  switch (category) {
    case 'weapon':
    case 'missile': {
      // ScrollOfTransmutation.changeWeapon: another of the same tier, keeping its level, magic, augment and set's wear.
      if (item.kind === 'weapon.pickaxe' || isDart(item.kind)) return null;
      const tier = itemDef(item.kind).tier!;
      const kind = other(() => randomOfTier(rng, tier, category === 'missile'));
      if (kind === item.kind) return null;
      const changed = keep(kind);
      for (const key of ['enchant', 'infused', 'mastery', 'augment', 'hardened', 'durability'] as const) {
        if (item[key] !== undefined) (changed as unknown as Record<string, unknown>)[key] = item[key];
      }
      if (category === 'missile') changed.set = 1 + rng.int(0x3fffffff);
      return changed;
    }
    case 'ring':
    case 'seed':
      return keep(other(() => generator.of(category).kind));
    case 'wand': {
      const changed = keep(other(() => generator.of('wand').kind));
      changed.charges = wandMaxCharges(changed);
      // A new wand: how many charges it holds is not known (Wand.curChargeKnown).
      changed.chargesUnknown = true;
      return changed;
    }
    case 'scroll':
    case 'potion': {
      const swap = SWAPS[item.kind];
      if (swap) return keep(swap);
      return keep(other(() => generator.of(category).kind, (kind) => !SWAPS[kind]));
    }
    default:
      return null;
  }
}
