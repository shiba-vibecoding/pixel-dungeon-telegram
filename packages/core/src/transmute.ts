import {
  createItem, drawUsingDefaults, EXOTIC_OF, type Item, itemDef, ItemGenerator, type ItemKind, REGULAR_OF, wandMaxCharges,
} from './items';
import type { Rng } from './rng';
import { TRINKETS } from './trinkets';

/*
 * ScrollOfTransmutation.changeItem, which a well of transmutation (WaterOfTransmutation) also works by: a melee
 * weapon turns into another of its tier, a thrown weapon likewise; a potion or scroll into its exotic counterpart
 * and back; a ring, wand, trinket, seed or runestone into another of its kind. Levels, curses and stacks are kept,
 * and as much as was known of them; an enchantment comes out as it was.
 */

/** Melee weapons by tier (Generator.wepTiers), the pickaxe aside. */
const MELEE_TIERS: readonly (readonly ItemKind[])[] = [
  ['weapon.knuckles', 'weapon.dagger', 'weapon.shortSword'], ['weapon.quarterstaff', 'weapon.spear'], ['weapon.mace', 'weapon.sword'],
  ['weapon.longsword', 'weapon.battleAxe'], ['weapon.warHammer', 'weapon.glaive'],
];
/** Thrown weapons by tier (Generator.misTiers; a seam for the gear stream's Shattered ones); tipped darts among themselves. */
const MISSILE_TIERS: readonly (readonly ItemKind[])[] = [
  ['missile.shuriken'], ['missile.javelin', 'missile.tomahawk'], ['missile.curare', 'missile.incendiary'],
];

/** What the transmutation makes of an item, or null if it leaves it be. */
export function transmuteItem(item: Item, rng: Rng, depth: number): Item | null {
  const category = itemDef(item.kind).category;
  const generator = new ItemGenerator(rng, depth);
  /** Another kind, drawn as the generator would, never the same. */
  const other = (pick: () => ItemKind): ItemKind => {
    for (let i = 0; i < 100; i++) {
      const kind = pick();
      if (kind !== item.kind) return kind;
    }
    return item.kind;
  };
  /** The new item keeps the level, curse and what was known of them (n.levelKnown = w.levelKnown, ...). */
  const keep = (kind: ItemKind, qty = item.qty): Item => {
    const changed: Item = { ...createItem(kind, qty, item.level) };
    if (item.cursed) changed.cursed = true;
    if (item.levelUnknown) changed.levelUnknown = true;
    if (item.curseUnknown) changed.curseUnknown = true;
    return changed;
  };
  switch (category) {
    case 'weapon':
    case 'missile': {
      const tiers = category === 'weapon' ? MELEE_TIERS : MISSILE_TIERS;
      const tier = tiers.find((kinds) => kinds.includes(item.kind));
      if (!tier || tier.length < 2) return null;
      const changed = keep(other(() => rng.oneOf(tier)));
      // Weapon: its enchantment, augmentation and the potion of mastery's help go with it.
      if (item.enchant) changed.enchant = item.enchant;
      if (item.augment) changed.augment = item.augment;
      if (item.mastery) changed.mastery = true;
      return changed;
    }
    case 'ring':
      return keep(other(() => generator.of('ring').kind));
    case 'wand': {
      const changed = keep(other(() => generator.of('wand').kind));
      // ScrollOfTransmutation.changeWand: the charges left go with it, and what was known of them.
      changed.charges = Math.min(item.charges ?? wandMaxCharges(changed), wandMaxCharges(changed));
      if (item.chargesUnknown) changed.chargesUnknown = true;
      return changed;
    }
    case 'seed':
      return keep(other(() => generator.of('seed').kind), 1);
    case 'stone':
      return keep(other(() => drawUsingDefaults(rng, 'stone')), 1);
    case 'trinket':
      return keep(other(() => rng.oneOf(TRINKETS)), 1);
    case 'scroll':
    case 'potion': {
      // changeScroll and changePotion: the exotic counterpart, or back; one of a stack.
      const swap = EXOTIC_OF[item.kind] ?? REGULAR_OF[item.kind];
      return swap ? createItem(swap) : null;
    }
    default:
      return null;
  }
}

/**
 * WaterOfTransmutation.affectItem: what the well makes of an item dropped into it (as the scroll would, a whole
 * stack of potions or scrolls at once), or null if it leaves it be.
 */
export function transmute(item: Item, rng: Rng, depth: number): Item | null {
  const changed = transmuteItem(item, rng, depth);
  if (changed && (itemDef(item.kind).category === 'potion' || itemDef(item.kind).category === 'scroll')) changed.qty = item.qty;
  return changed;
}
