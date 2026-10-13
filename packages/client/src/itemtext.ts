import {
  armorStats, buffedLevel, chargeLimit, chargesKnown, chargesPerCast, durabilityOf, isBroken, isIdentified, kindKnown, levelKnown, maxCharges,
  maxDurability, CLASS_ARMOR, CLASS_ARMOR_OF, type Hero, type HeroClass, type Item, itemDef, type ItemKind, itemSprite, missileStats, SCROLL_RUNES,
  visiblyCursed, wandDamage, weaponStats, sealShield, WATERSKIN_VOLUME, type World,
} from '@pd/core';
import { t } from './i18n';

/*
 * How items are called and described, given what the party knows: the kinds
 * it has learned, and what is known of each item (its level, its curse, a
 * wand's charges; see the core's ident.ts).
 */

const CLASS_OF = Object.fromEntries(Object.entries(CLASS_ARMOR_OF).map(([cls, kind]) => [kind, cls])) as Partial<Record<ItemKind, HeroClass>>;

/** Whether the party knows what kind of thing it is (unknown potions, scrolls and rings go by their looks). */
export const isKnown = (world: World, item: Item): boolean => kindKnown(world, item);

export function itemName(world: World, item: Item): string {
  const category = itemDef(item.kind).category;
  if (category === 'gold') return `${item.qty} ${t.goldShort}`;
  if (category === 'vial') return `${t.items[item.kind]} (${item.volume ?? 0}/${WATERSKIN_VOLUME})`;
  if (!isKnown(world, item)) {
    const label = world.run.labels[item.kind] ?? 0;
    // Ring.name goes by the gem; Item.toString adds a known level all the same.
    if (category === 'ring') return levelled(t.unknownRing(t.gems[label]!), item);
    return category === 'potion' ? t.unknownPotion(t.colors[label]!) : t.unknownScroll(SCROLL_RUNES[label]!);
  }
  // MagesStaff.name: the staff of its wand.
  let name = item.kind === 'weapon.magesStaff' && item.wand ? t.staffNames[item.wand.kind] ?? t.items[item.kind] : t.items[item.kind];
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

/**
 * Wand.status: charges left of the most, once the wand's level is known, with «?» while the charges left are not;
 * MagesStaff.status: its wand's; null otherwise.
 */
export function chargesOf(item: Item): string | null {
  if (item.kind === 'weapon.magesStaff') return item.wand ? `${item.wand.charges ?? 0}/${maxCharges(item.wand, item)}` : null;
  if (item.charges === undefined || !levelKnown(item)) return null;
  return `${chargesKnown(item) ? item.charges : '?'}/${maxCharges(item, null)}`;
}

/** Wand.statsDesc of each kind: what it does, with its numbers (as strong as it zaps, once its level is known; plain, until then). */
export function wandStats(hero: Hero, wand: Item, staff: Item | null): string {
  const known = staff !== null || levelKnown(wand);
  const level = known ? buffedLevel(hero, wand, staff) : 0;
  const cursed = staff ? !!staff.cursed : !!wand.cursed;
  const stats = t.wandStats[wand.kind];
  if (!stats) return '';
  switch (wand.kind) {
    case 'wand.fireblast': {
      const charges = chargesPerCast(wand, cursed);
      const [min, max] = wandDamage(wand.kind, level, charges)!;
      return stats(charges, min, max);
    }
    case 'wand.corrosion':
      return stats(2 + level);
    case 'wand.warding':
      return stats(2 + (known ? (staff ?? wand).level : 0));
    case 'wand.transfusion': {
      const self = Math.round(hero.ht * 0.05);
      const [min, max] = wandDamage(wand.kind, level)!;
      return stats(self, self + 3 * level, 5 + level, min, max);
    }
    case 'wand.corruption':
      return stats();
    case 'wand.regrowth': {
      const text = stats(chargesPerCast(wand, cursed));
      // The charges it may still spend before its growth fails (once it is known through and through).
      const left = chargeLimit(hero.lvl, (staff ?? wand).level) - (wand.grown ?? 0);
      return (staff !== null || (levelKnown(wand) && chargesKnown(wand))) && left < 10000 ? `${text} ${t.regrowthLimit(Math.max(left, 0))}` : text;
    }
    default: {
      const [min, max] = wandDamage(wand.kind, level)!;
      return stats(min, max);
    }
  }
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
      // MagesStaff.info: the wand it holds, what it does (unless the staff's curse is known), and a battlemage's blow with it.
      ...(item.kind === 'weapon.magesStaff' ? [t.itemInfo[item.kind] ?? ''] : []),
      ...(item.kind === 'weapon.magesStaff' && item.wand
        ? [`${t.staffHasWand(t.items[item.wand.kind])} ${visiblyCursed(item) ? t.staffCursedWand : wandStats(hero, item.wand, item)}`]
        : []),
      ...(item.kind === 'weapon.magesStaff' && item.wand && hero.subclass === 'battlemage' ? [t.battlemageInfo[item.wand.kind] ?? ''] : []),
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
    // Wand.info: what it is, what it does, its curse (once known) or that it is free of one, a battlemage's staff of it.
    const status = chargesOf(item);
    return [
      t.itemInfo[item.kind] ?? '',
      wandStats(hero, item, null),
      ...(visiblyCursed(item) ? [t.wandCursed] : !item.curseUnknown && !isIdentified(world, item) ? [t.wandNotCursed] : []),
      ...(hero.subclass === 'battlemage' ? [t.battlemageInfo[item.kind] ?? ''] : []),
      ...(status === null ? [] : [t.charges(status)]),
    ];
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
