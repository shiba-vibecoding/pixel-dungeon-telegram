import type { Hero } from './actors';
import { CLASS_ARMOR } from './classArmor';
import type { Ctx } from './floor';
import { type Item, itemDef, type ItemKind, randomEnchantment, randomGlyph, wandMaxCharges } from './items';
import { gearUpgradable, upgradeGear } from './gear';
import { isBroken, mend } from './wear';
import { isIdentified } from './ident';
import type { World } from './world';

/*
 * Scrolls read on an item of the reader's choosing (InventoryScroll): upgrade,
 * enchantment and identify. The original opens the backpack (WndBag) on what
 * the scroll can act on, the equipped items included; here the client picks
 * the item before reading and sends it along with the action.
 */

/** An item the hero has: one in the pack, the weapon or armour worn, or one of the two rings worn. */
export type ItemRef = number | 'weapon' | 'armor' | 'ring0' | 'ring1';

const WORN_REFS: ReadonlySet<unknown> = new Set(['weapon', 'armor', 'ring0', 'ring1']);

/** An ItemRef as it may come from a client: checked, not trusted. */
export const isItemRef = (value: unknown): value is ItemRef => Number.isInteger(value) || WORN_REFS.has(value);

export function itemAt(hero: Hero, ref: ItemRef): Item | undefined {
  switch (ref) {
    case 'weapon':
      return hero.weapon ?? undefined;
    case 'armor':
      return hero.armor;
    case 'ring0':
      return hero.rings[0];
    case 'ring1':
      return hero.rings[1];
    default:
      return Number.isInteger(ref) ? hero.items[ref] : undefined;
  }
}

/** Everything the hero has, worn first (as WndBag lists the equipped items above the pack). */
export function heldRefs(hero: Hero): ItemRef[] {
  const worn: ItemRef[] = [
    ...(hero.weapon ? ['weapon' as const] : []), 'armor', ...hero.rings.map((_, i) => (i === 0 ? 'ring0' as const : 'ring1' as const)),
  ];
  return [...worn, ...hero.items.map((_, i) => i)];
}

/**
 * Item.isUpgradable: melee weapons, armour, thrown weapons (MissileWeapon: not darts), wands and rings — but not the
 * blacksmith's pickaxe, class armour, the spirit bow, or the rings of haggler and thorns.
 */
export function isUpgradable(item: Item): boolean {
  switch (itemDef(item.kind).category) {
    case 'weapon':
    case 'missile':
      return gearUpgradable(item);
    case 'armor':
      return !CLASS_ARMOR.includes(item.kind);
    case 'wand':
      return true;
    case 'ring':
      return item.kind !== 'ring.haggler' && item.kind !== 'ring.thorns';
    default:
      return false;
  }
}

/**
 * ScrollOfEnchantment.enchantable (and what a stone of augmentation takes): a weapon or armour that can be upgraded,
 * or the spirit bow; class armour too.
 */
export function isEnchantable(item: Item): boolean {
  const category = itemDef(item.kind).category;
  return category === 'bow' || category === 'armor' || ((category === 'weapon' || category === 'missile') && gearUpgradable(item));
}

/**
 * WndBag.Mode.UNIDENTIFED: what is not identified yet (Item.isIdentified): a
 * potion, scroll, wand or ring of a kind the party does not know, or a weapon,
 * armour, ring or wand whose level or curse is not known (see ident.ts). The
 * scroll read is known once read, so it is no choice of its own.
 */
export function isUnidentified(world: World, item: Item, reading?: ItemKind): boolean {
  return item.kind !== reading && !isIdentified(world, item);
}

/** The scrolls that are read on a chosen item. */
export type TargetedScroll = 'scroll.upgrade' | 'scroll.enchantment' | 'scroll.identify';

export const isTargetedScroll = (kind: ItemKind): kind is TargetedScroll =>
  kind === 'scroll.upgrade' || kind === 'scroll.enchantment' || kind === 'scroll.identify';

/** Whether a scroll of `kind` can be read on `item`. */
export function canTarget(world: World, kind: TargetedScroll, item: Item): boolean {
  switch (kind) {
    case 'scroll.upgrade':
      return isUpgradable(item);
    case 'scroll.enchantment':
      return isEnchantable(item);
    case 'scroll.identify':
      return isUnidentified(world, item, kind);
  }
}

/** What the hero could read a scroll of `kind` on, for the client's picker; empty for other scrolls. */
export function scrollTargets(world: World, hero: Hero, kind: ItemKind): ItemRef[] {
  if (!isTargetedScroll(kind)) return [];
  return heldRefs(hero).filter((ref) => canTarget(world, kind, itemAt(hero, ref)!));
}

/** Why a scroll of `kind` cannot be read on that item. */
export const TARGET_PROBLEMS: Readonly<Record<TargetedScroll, string>> = {
  'scroll.upgrade': 'that cannot be upgraded',
  'scroll.enchantment': 'that cannot be enchanted',
  'scroll.identify': 'there is nothing to learn about that',
};

/**
 * When no item was chosen (an unknown scroll, whose kind the client could not
 * know to ask about, or an old client): the weapon in hand, else the armour,
 * if the scroll can act on them; for identify, the first unknown potion or
 * scroll in the pack, else the first thing held that is not identified.
 * Undefined if there is none: the scroll is wasted.
 */
export function defaultTarget(world: World, hero: Hero, kind: TargetedScroll): Item | undefined {
  if (kind === 'scroll.identify') {
    const unknown = heldRefs(hero).map((ref) => itemAt(hero, ref)!).filter((item) => isUnidentified(world, item, kind));
    return unknown.find((item) => ['potion', 'scroll'].includes(itemDef(item.kind).category)) ?? unknown[0];
  }
  return [hero.weapon, hero.armor].find((item): item is Item => !!item && canTarget(world, kind, item));
}

/** ScrollOfRemoveCurse.uncurse on the one item. */
const uncurse = (item: Item): void => {
  delete item.cursed;
};

/**
 * ScrollOfUpgrade.onItemSelected: the curse is lifted; a broken item is only
 * mended (Item.fix), anything else upgraded: Weapon.upgrade and Armor.upgrade
 * may lose their enchantment or glyph to the clash of magics, a wand gains a
 * charge as well as a level (Wand.upgrade), and every upgrade mends (Item.upgrade).
 */
export function upgradeItem(ctx: Ctx, hero: Hero, item: Item): void {
  uncurse(item);
  if (isBroken(item)) {
    mend(item);
    ctx.effects.push({ type: 'mended', hero: hero.id, item });
    return;
  }
  const category = itemDef(item.kind).category;
  if (category === 'weapon' || category === 'armor' || category === 'missile') {
    // Weapon.upgrade(false), Armor.upgrade(false), MissileWeapon.upgrade (gear.ts): the magic may be lost from +4 on.
    if (upgradeGear(ctx, hero, item) === 'enchant') ctx.effects.push({ type: 'disenchanted', hero: hero.id, item });
  } else {
    item.level++;
  }
  // Item.upgrade: no curse, and that is known (cursedKnown), though the level stays as known as it was.
  delete item.curseUnknown;
  mend(item);
  // Wand.upgrade: one more charge, up to the new maximum.
  if (item.charges !== undefined) item.charges = Math.min(item.charges + 1, wandMaxCharges(item));
  ctx.effects.push({ type: 'upgraded', hero: hero.id, item });
}

/**
 * The scroll of enchantment (as StoneOfEnchantment.onItemSelected does it): the curse is lifted, a weapon (or the
 * spirit bow) gets a new enchantment and armour a new glyph, never the one it had (Weapon.enchant(),
 * Armor.inscribe()); a curse enchantment or glyph is replaced with them. Seam: the exotic scroll of enchantment's
 * choice of three is the alchemy stream's.
 */
export function enchantItem(ctx: Ctx, hero: Hero, item: Item): void {
  uncurse(item);
  if (itemDef(item.kind).category === 'armor') item.glyph = randomGlyph(ctx.rng, item.glyph);
  else item.enchant = randomEnchantment(ctx.rng, item.enchant);
  delete item.infused;
  delete item.explosive;
  mend(item);
  ctx.effects.push({ type: 'imbued', hero: hero.id, item });
}
