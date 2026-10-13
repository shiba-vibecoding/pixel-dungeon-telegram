import {
  armorStats, chargesKnown, durabilityOf, isBroken, kindKnown, levelKnown, maxDurability, CLASS_ARMOR, CLASS_ARMOR_OF, type Hero, type HeroClass,
  type Item, itemDef, type ItemKind, itemSprite, magicMissileDamage, missileStats, SCROLL_RUNES, visiblyCursed, wandMaxCharges, weaponStats,
  sealShield, WATERSKIN_VOLUME, type World,
} from '@pd/core';
import { t } from './i18n';

/*
 * How items are called and described, given what the party knows: the kinds
 * it has learned, and what is known of each item (its level, its curse, a
 * wand's charges; see the core's ident.ts).
 */

const CLASS_OF = Object.fromEntries(Object.entries(CLASS_ARMOR_OF).map(([cls, kind]) => [kind, cls])) as Partial<Record<ItemKind, HeroClass>>;

/** Whether the party knows what kind of thing it is (unknown potions, scrolls, wands and rings go by their looks). */
export const isKnown = (world: World, item: Item): boolean => kindKnown(world, item);

export function itemName(world: World, item: Item): string {
  const category = itemDef(item.kind).category;
  if (category === 'gold') return `${item.qty} ${t.goldShort}`;
  if (category === 'vial') return `${t.items[item.kind]} (${item.volume ?? 0}/${WATERSKIN_VOLUME})`;
  if (!isKnown(world, item)) {
    const label = world.run.labels[item.kind] ?? 0;
    // Wand.name and Ring.name go by the wood or the gem; Item.toString adds a known level all the same.
    if (category === 'wand') return levelled(t.unknownWand(t.woods[label]!), item);
    if (category === 'ring') return levelled(t.unknownRing(t.gems[label]!), item);
    return category === 'potion' ? t.unknownPotion(t.colors[label]!) : t.unknownScroll(SCROLL_RUNES[label]!);
  }
  let name = t.items[item.kind];
  // Weapon.name and Armor.name: the enchantment or glyph is part of the name.
  if (item.enchant) name = t.enchantName(name, item.enchant, item.kind);
  if (item.glyph) name = t.glyphName(name, item.glyph);
  if (category === 'weapon' || category === 'armor' || category === 'wand' || category === 'ring' || item.kind === 'missile.boomerang') {
    // Weapon.toString: a worn-out item says so, once its level is known (Item.visiblyBroken).
    if (isBroken(item) && levelKnown(item)) name = t.brokenName(name, item.kind);
    return levelled(name, item);
  }
  return name;
}

/** Item.toString: the level after the name, once it is known and not plain. */
const levelled = (name: string, item: Item): string =>
  item.level === 0 || !levelKnown(item) ? name : `${name} ${item.level > 0 ? '+' : ''}${item.level}`;

/** Wand.status: charges left of the most, once the wand's level is known, with «?» while the charges left are not; null otherwise. */
export function chargesOf(item: Item): string | null {
  if (item.charges === undefined || !levelKnown(item)) return null;
  return `${chargesKnown(item) ? item.charges : '?'}/${wandMaxCharges(item)}`;
}

/** The item as it would be plain and whole: what is typical of its kind (MeleeWeapon.typicalSTR, Armor.typicalDR). */
const typical = (item: Item): Item => ({ ...item, level: 0, durability: undefined, glyph: undefined });

/** ItemSlot's top right: the strength a weapon or armour wants, or the typical one while its level is unknown; null for the rest. */
export function strengthOf(item: Item): { str: number; known: boolean } | null {
  const category = itemDef(item.kind).category;
  if (category !== 'weapon' && category !== 'armor') return null;
  const known = levelKnown(item);
  return { str: (category === 'weapon' ? weaponStats(known ? item : typical(item)) : armorStats(known ? item : typical(item))).str, known };
}

/** How worn an upgraded item is, once its level is known (WndBag's durability bars); null for items that do not wear. */
export function wearOf(_world: World, item: Item): { left: number; max: number } | null {
  if (item.level <= 0 || !levelKnown(item)) return null;
  const max = maxDurability(item);
  return Number.isFinite(max) ? { left: Math.max(0, Math.ceil(durabilityOf(item))), max } : null;
}

/** The name without its «broken» and its level, for a window's title that shows the level struck through. */
export function plainName(world: World, item: Item): string {
  return itemName(world, { ...item, level: 0, durability: undefined });
}

export function itemInfo(world: World, hero: Hero, item: Item): string[] {
  const category = itemDef(item.kind).category;
  // MeleeWeapon.info and Armor.info: the numbers once the level is known, else what is typical of the kind
  // («probably» too heavy, if even that is); the curse once it is known.
  if (category === 'weapon') {
    const known = levelKnown(item);
    const stats = weaponStats(known ? item : typical(item));
    return [
      known ? t.weaponInfo(stats.min, stats.max, stats.str) : t.weaponTypicalInfo(stats.min, stats.max, stats.str),
      ...(item.enchant ? [t.enchantInfo[item.enchant]] : []),
      ...(item.imbue ? [t.imbueInfo[item.imbue]] : []),
      ...(item.kind === 'weapon.pickaxe' ? [t.pickaxeInfo(!!item.bloody)] : []),
      ...(visiblyCursed(item) ? [t.cursedInfo] : []),
      ...(stats.str > hero.str ? [known ? t.tooHeavy : t.probablyTooHeavy] : []),
    ];
  }
  if (category === 'armor') {
    const known = levelKnown(item);
    const stats = armorStats(known ? item : typical(item));
    return [
      known ? t.armorInfo(stats.dr, stats.str) : t.armorTypicalInfo(stats.dr, stats.str),
      ...(item.glyph ? [t.glyphInfo[item.glyph]] : []), ...(visiblyCursed(item) ? [t.cursedInfo] : []),
      ...(CLASS_ARMOR.includes(item.kind) ? [t.classArmorInfo[CLASS_OF[item.kind]!], t.specialCost] : []),
      ...(stats.str > hero.str ? [known ? t.tooHeavy : t.probablyTooHeavy] : []),
      // Armor.info: the warrior's seal on it, and the shield it gives.
      ...(item.seal ? [t.hero.sealAttached(sealShield(hero, item))] : []),
    ];
  }
  if (category === 'vial') {
    // Waterskin.info: plain water, or healing dew; full, it seems to radiate energy.
    const volume = item.volume ?? 0;
    return [t.itemInfo[item.kind] ?? '', volume === 0 ? t.hero.waterskinWater : t.hero.waterskinHeal, ...(volume >= WATERSKIN_VOLUME ? [t.hero.waterskinFullDesc] : [])];
  }
  if (category === 'missile') {
    const stats = missileStats(item);
    return [t.itemInfo[item.kind] ?? '', t.missileInfo(stats.min, stats.max)];
  }
  if (category === 'wand') {
    const status = chargesOf(item);
    const charges = status === null ? [] : [t.charges(status)];
    if (!isKnown(world, item)) return [t.unknownWandInfo, ...charges];
    if (item.kind !== 'wand.magicMissile' || !levelKnown(item)) return [t.itemInfo[item.kind] ?? '', ...charges];
    const [min, max] = magicMissileDamage(item);
    return [t.itemInfo[item.kind] ?? '', t.wandDamage(min, max), ...charges];
  }
  if (category === 'ring') {
    // Ring.info: the curse once it is known, whether or not the gem is.
    const cursed = visiblyCursed(item) ? [t.cursedInfo] : [];
    if (!isKnown(world, item)) return [t.unknownRingInfo, ...cursed];
    return [t.itemInfo[item.kind] ?? '', ...(item.level < 0 && levelKnown(item) ? [t.ringNegative] : []), ...cursed];
  }
  if (category === 'key') {
    if (item.kind === 'key.skeleton') return [t.skeletonKeyInfo];
    return [item.kind === 'key.golden' ? t.goldenKeyInfo(item.depth ?? 0) : t.keyInfo(item.depth ?? 0)];
  }
  if (category === 'gold') return [];
  if (category === 'beacon') return [t.itemInfo[item.kind] ?? '', ...(item.returnTo ? [t.beaconSetAt(item.returnTo.depth)] : [])];
  return [isKnown(world, item) ? (t.itemInfo[item.kind] ?? '') : t.unknownInfo];
}

/** Top-left corner of an item's sprite in items.png (Shattered's, 16 a row). */
export function spriteOffset(world: World, item: Item): [number, number] {
  const index = itemSprite(item, world.run.labels);
  return [(index % 16) * 16, Math.floor(index / 16) * 16];
}
