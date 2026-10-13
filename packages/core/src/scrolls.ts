import type { Hero } from './actors';
import { CLASS_ARMOR } from './classArmor';
import type { Ctx } from './floor';
import { energyValue, type Item, itemDef, type ItemKind, itemPrice, knownIn, randomEnchantment, randomGlyph, wandMaxCharges } from './items';
import { transmutable } from './reading';
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
 * Item.isUpgradable: melee weapons, armour, wands, rings and the boomerang —
 * but not other thrown weapons (MissileWeapon), the blacksmith's pickaxe,
 * class armour, or the rings of haggler and thorns.
 */
export function isUpgradable(item: Item): boolean {
  switch (itemDef(item.kind).category) {
    case 'weapon':
      return item.kind !== 'weapon.pickaxe';
    case 'armor':
      return !CLASS_ARMOR.includes(item.kind);
    case 'wand':
      return true;
    case 'ring':
      return item.kind !== 'ring.haggler' && item.kind !== 'ring.thorns';
    case 'missile':
      return item.kind === 'missile.boomerang';
    default:
      return false;
  }
}

/** WndBag.Mode.ENCHANTABLE: a melee weapon, the boomerang or any armour (class armour too). */
export function isEnchantable(item: Item): boolean {
  const category = itemDef(item.kind).category;
  return (category === 'weapon' && item.kind !== 'weapon.pickaxe') || category === 'armor' || item.kind === 'missile.boomerang';
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

/**
 * What is used on an item of the user's choosing (InventoryScroll, InventoryStone, InventorySpell and the like):
 * scrolls of upgrade, identify, remove curse and transmutation, the exotic enchantment, the potion of mastery, the
 * stones of augmentation, enchantment, detect magic and intuition, the curse infusion, magical infusion, recycling
 * and alchemizing spells, arcane resin and liquid metal.
 */
export const TARGETED = [
  'scroll.upgrade', 'scroll.enchantment', 'scroll.identify', 'scroll.removeCurse', 'scroll.transmutation', 'potion.mastery',
  'stone.augmentation', 'stone.enchantment', 'stone.detectMagic', 'stone.intuition', 'spell.curseInfusion', 'spell.magicalInfusion',
  'spell.recycle', 'spell.alchemize', 'resin', 'liquidMetal',
] as const satisfies readonly ItemKind[];
export type TargetedScroll = (typeof TARGETED)[number];

export const isTargetedScroll = (kind: ItemKind): kind is TargetedScroll => (TARGETED as readonly ItemKind[]).includes(kind);

/** ScrollOfRemoveCurse.uncursable: worn things and wands whose curse is not known, or that are cursed. */
export function uncursable(world: World, item: Item): boolean {
  const category = itemDef(item.kind).category;
  const equipable = ['weapon', 'armor', 'ring', 'wand', 'missile'].includes(category);
  return equipable && ((!isIdentified(world, item) && !!item.curseUnknown) || !!item.cursed);
}

/** Whether `kind` can be used on `item`. */
export function canTarget(world: World, kind: TargetedScroll, item: Item): boolean {
  const category = itemDef(item.kind).category;
  switch (kind) {
    case 'scroll.upgrade':
    case 'spell.magicalInfusion':
      return isUpgradable(item);
    case 'scroll.enchantment':
    case 'stone.augmentation':
    case 'stone.enchantment':
      return isEnchantable(item);
    case 'scroll.identify':
      return isUnidentified(world, item, kind);
    case 'scroll.removeCurse':
      return uncursable(world, item);
    case 'scroll.transmutation':
      return transmutable(world, item, kind);
    case 'potion.mastery':
      // PotionOfMastery: a weapon or armour not made easier already.
      return (category === 'weapon' || category === 'armor') && !item.mastery;
    case 'stone.detectMagic':
      // StoneOfDetectMagic: worn things and wands not known through and through, or whose curse is not known.
      return ['weapon', 'armor', 'ring', 'wand', 'missile'].includes(category) && (!isIdentified(world, item) || !!item.curseUnknown);
    case 'stone.intuition':
      // StoneOfIntuition: a potion, scroll or ring of a kind not known.
      return (category === 'potion' || category === 'scroll' || category === 'ring') && !knownIn(world.known, item.kind);
    case 'spell.curseInfusion':
      return (isUpgradable(item) && ['weapon', 'armor', 'ring', 'missile'].includes(category)) || category === 'wand';
    case 'spell.recycle':
      return ['potion', 'scroll', 'seed', 'stone'].includes(category) || item.kind === 'missile.curare' || item.kind === 'missile.incendiary';
    case 'spell.alchemize':
      return item.kind !== 'spell.alchemize' && (itemPrice(item, knownIn(world.known, item.kind)) > 0 || energyValue(item, knownIn(world.known, item.kind)) > 0);
    case 'resin':
      // ArcaneResin: a wand known through and through, below +3 from resin.
      return category === 'wand' && isIdentified(world, item);
    case 'liquidMetal':
      return category === 'missile' && item.kind !== 'missile.dart';
  }
}

/** What the hero could use `kind` on, for the client's picker; empty for what is not used on an item. */
export function scrollTargets(world: World, hero: Hero, kind: ItemKind): ItemRef[] {
  if (!isTargetedScroll(kind)) return [];
  return heldRefs(hero).filter((ref) => canTarget(world, kind, itemAt(hero, ref)!));
}

/** Why `kind` cannot be used on that item. */
export const TARGET_PROBLEMS: Readonly<Record<TargetedScroll, string>> = {
  'scroll.upgrade': 'that cannot be upgraded',
  'scroll.enchantment': 'that cannot be enchanted',
  'scroll.identify': 'there is nothing to learn about that',
  'scroll.removeCurse': 'there is no curse to lift from that',
  'scroll.transmutation': 'that cannot be transmuted',
  'potion.mastery': 'that cannot be made easier',
  'stone.augmentation': 'that cannot be augmented',
  'stone.enchantment': 'that cannot be enchanted',
  'stone.detectMagic': 'there is no magic to detect on that',
  'stone.intuition': 'there is nothing to guess about that',
  'spell.curseInfusion': 'that cannot be infused with a curse',
  'spell.magicalInfusion': 'that cannot be upgraded',
  'spell.recycle': 'that cannot be recycled',
  'spell.alchemize': 'that can be neither sold nor turned into energy',
  resin: 'resin works only on a wand known through and through',
  liquidMetal: 'liquid metal works only on thrown weapons',
};

/**
 * When no item was chosen (an unknown scroll, whose kind the client could not
 * know to ask about, or an old client): the weapon in hand, else the armour,
 * if the scroll can act on them; for identify, the first unknown potion or
 * scroll in the pack, else the first thing held that is not identified; for the
 * rest, the first thing it can act on. Undefined if there is none: the scroll is wasted.
 */
export function defaultTarget(world: World, hero: Hero, kind: TargetedScroll): Item | undefined {
  if (kind === 'scroll.identify') {
    const unknown = heldRefs(hero).map((ref) => itemAt(hero, ref)!).filter((item) => isUnidentified(world, item, kind));
    return unknown.find((item) => ['potion', 'scroll'].includes(itemDef(item.kind).category)) ?? unknown[0];
  }
  if (kind === 'scroll.upgrade' || kind === 'scroll.enchantment') {
    return [hero.weapon, hero.armor].find((item): item is Item => !!item && canTarget(world, kind, item));
  }
  return heldRefs(hero).map((ref) => itemAt(hero, ref)!).find((item) => canTarget(world, kind, item));
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
export function upgradeItem(ctx: Ctx, hero: Hero, item: Item, infusion = false): void {
  // MagicalInfusion.upgradeItem: an upgrade that keeps the enchantment, and the curse.
  const cursed = item.cursed;
  uncurse(item);
  if (isBroken(item)) {
    mend(item);
    ctx.effects.push({ type: 'mended', hero: hero.id, item });
    return;
  }
  // Weapon.upgrade(false) / Armor.upgrade(false): Random.Int(level()) > 0 drives the magic out.
  if (!infusion && (item.enchant || item.glyph) && item.level > 0 && ctx.rng.int(item.level) > 0) {
    delete item.enchant;
    delete item.glyph;
    ctx.effects.push({ type: 'disenchanted', hero: hero.id, item });
  }
  item.level++;
  // Item.upgrade: no curse, and that is known (cursedKnown), though the level stays as known as it was.
  delete item.curseUnknown;
  mend(item);
  // Wand.upgrade: one more charge, up to the new maximum.
  if (item.charges !== undefined) item.charges = Math.min(item.charges + 1, wandMaxCharges(item));
  if (infusion && cursed) item.cursed = true;
  ctx.effects.push({ type: 'upgraded', hero: hero.id, item });
}

/**
 * ScrollOfEnchantment.onItemSelected: the curse is lifted, a weapon (or the
 * boomerang) gets a new enchantment and armour a new glyph, never the one it
 * had (Weapon.enchant, Armor.inscribe), and the item comes out mended.
 */
export function enchantItem(ctx: Ctx, hero: Hero, item: Item): void {
  uncurse(item);
  if (itemDef(item.kind).category === 'armor') item.glyph = randomGlyph(ctx.rng, item.glyph);
  else item.enchant = randomEnchantment(ctx.rng, item.enchant);
  mend(item);
  ctx.effects.push({ type: 'imbued', hero: hero.id, item });
}
