import { type Item, itemDef, type ItemKind } from './items';
import { dpow } from './fmath';
import { augmentDamage, augmentDelay, gearLevel, strReq } from './weapons';

/*
 * Thrown weapons as Shattered Pixel Dungeon has them (MissileWeapon and its
 * kinds, Dart, TippedDart): five tiers, found in sets of three that wear out
 * with use (durability, of 100 for the stack's first one, a use's worth taken
 * away by every hit), stacking only with their own set. Darts never wear out;
 * a tipped dart is spent in one hit and leaves a plain dart behind. How they
 * fly and what they do is in throwing.ts.
 */

const f32 = Math.fround;

/** MissileWeapon.MAX_DURABILITY. */
export const MAX_DURABILITY = 100;

interface MissileDef {
  /** MissileWeapon.baseUses: 8 unless said otherwise. */
  uses?: number;
  /** MissileWeapon.sticky: stuck in whom it hits, until they die (PinCushion); otherwise it drops. */
  sticky?: false;
  /** min(lvl), max(lvl), when not 2×tier + lvl and 5×tier + tier×lvl. */
  min?: (tier: number, lvl: number) => number;
  max?: (tier: number, lvl: number) => number;
  /** ThrowingKnife, Kunai: on a surprise attack, damage rolls from this far towards the max. */
  surprise?: number;
}

const tipped: MissileDef = { uses: 1, min: (_t, l) => 1 + l, max: (_t, l) => 2 + 2 * l };

export const MISSILES: Readonly<Partial<Record<ItemKind, MissileDef>>> = {
  'missile.throwingStone': { uses: 5, sticky: false },
  'missile.throwingKnife': { uses: 5, max: (t, l) => 6 * t + (t === 1 ? 2 * l : t * l), surprise: 0.75 },
  'missile.throwingSpike': { uses: 12 },
  // Dart: infinite, even with penalties.
  'missile.dart': { uses: 1000, min: (_t, l) => 1 + l, max: (_t, l) => 2 + 2 * l },
  'missile.fishingSpear': {},
  'missile.throwingClub': { uses: 12, sticky: false, max: (t, l) => 4 * t + t * l },
  'missile.shuriken': { uses: 5, max: (t, l) => 4 * t + (t === 1 ? 2 * l : t * l) },
  'missile.throwingSpear': {},
  'missile.kunai': { uses: 8, max: (t, l) => 4 * t + t * l, surprise: 0.6 },
  'missile.bolas': { uses: 5, min: (t) => 2 * (t - 1), max: (t, l) => 3 * t + (t - 1) * l },
  'missile.javelin': {},
  'missile.tomahawk': { uses: 5, min: (t, l) => Math.round(1.5 * t) + l, max: (t, l) => Math.round(4 * t) + (t - 1) * l },
  'missile.heavyBoomerang': { uses: 5, sticky: false, max: (t, l) => 4 * t + (t - 1) * l },
  'missile.trident': {},
  'missile.throwingHammer': { uses: 12, sticky: false, max: (t, l) => 4 * t + t * l },
  'missile.forceCube': { uses: 5, sticky: false, max: (t, l) => 6 * t + t * l },
  'missile.rotDart': tipped,
  'missile.healingDart': tipped,
  'missile.displacingDart': tipped,
  'missile.chillingDart': tipped,
  'missile.incendiaryDart': tipped,
  'missile.poisonDart': tipped,
  'missile.adrenalineDart': tipped,
  'missile.blindingDart': tipped,
  'missile.shockingDart': tipped,
  'missile.paralyticDart': tipped,
  'missile.cleansingDart': tipped,
  'missile.holyDart': tipped,
};

/** The seeds darts are tipped with, and what they make of them (TippedDart.types). */
export const TIPPED_DARTS: Readonly<Partial<Record<ItemKind, ItemKind>>> = {
  'seed.rotberry': 'missile.rotDart',
  'seed.sungrass': 'missile.healingDart',
  'seed.fadeleaf': 'missile.displacingDart',
  'seed.icecap': 'missile.chillingDart',
  'seed.firebloom': 'missile.incendiaryDart',
  'seed.sorrowmoss': 'missile.poisonDart',
  'seed.swiftthistle': 'missile.adrenalineDart',
  'seed.blindweed': 'missile.blindingDart',
  'seed.mageroyal': 'missile.cleansingDart',
  'seed.starflower': 'missile.holyDart',
  'seed.stormvine': 'missile.shockingDart',
  // Pixel Dungeon's dreamweed, still carried from older runs: stormvine's (its sprite).
  'seed.dreamweed': 'missile.shockingDart',
  'seed.earthroot': 'missile.paralyticDart',
};

export const isMissile = (kind: ItemKind): boolean => itemDef(kind).category === 'missile';
export const isTippedDart = (kind: ItemKind): boolean => MISSILES[kind] === tipped;
/** Dart and every TippedDart. */
export const isDart = (kind: ItemKind): boolean => kind === 'missile.dart' || isTippedDart(kind);
const def = (kind: ItemKind): MissileDef => MISSILES[kind] ?? {};

/** MissileWeapon.defaultQuantity: a set of three (Dart: two). */
export const defaultQuantity = (kind: ItemKind): number => (isDart(kind) ? 2 : 3);

/** Whether a thrown weapon kind can be upgraded: not a dart (Dart.isUpgradable). */
export const missileUpgradable = (kind: ItemKind): boolean => isMissile(kind) && !isDart(kind);

/** Whether it sticks in whom it hits. */
export const isSticky = (kind: ItemKind): boolean => def(kind).sticky !== false;

/** MissileWeapon.min(lvl) and max(lvl); darts shot with a crossbow in hand use the crossbow's numbers (Dart.min, max). */
export function missileMin(item: Item, lvl = gearLevel(item)): number {
  const tier = itemDef(item.kind).tier!;
  return Math.max(0, def(item.kind).min?.(tier, lvl) ?? 2 * tier + lvl);
}
export function missileMax(item: Item, lvl = gearLevel(item)): number {
  const tier = itemDef(item.kind).tier!;
  return Math.max(0, def(item.kind).max?.(tier, lvl) ?? 5 * tier + tier * lvl);
}

/** MissileWeapon.STRReq: one less than a melee weapon of its tier wants. */
export const missileStr = (item: Item, lvl = gearLevel(item)): number =>
  strReq(itemDef(item.kind).tier!, lvl) - 1 - (item.mastery ? 2 : 0);

/** The share of the way to the max a surprise throw rolls from, or 0. */
export const missileSurprise = (kind: ItemKind): number => def(kind).surprise ?? 0;

/**
 * MissileWeapon.durabilityPerUse(level): what a hit takes off the stack's durability; 0 for what never wears out
 * (a hundred uses or more). A speed augment makes them last half as long again, a damage one a third less; the
 * crystal enchantment halves it, to thirty uses at most; a ring of sharpshooting (`multi`, its durabilityMultiplier)
 * makes them last longer. Seams: the durable projectiles talent and a magical holster (talents, the bags) would
 * multiply the uses; the regrowth wand's lotus would spare tipped darts.
 */
export function durabilityPerUse(item: Item, lvl = gearLevel(item), multi = 1): number {
  if (item.kind === 'missile.rotDart') return MAX_DURABILITY / 5;
  let usages = f32((def(item.kind).uses ?? 8) * f32(dpow(1.5, lvl)));
  usages = f32(usages / augmentDelay(item, 1));
  if (multi !== 1) usages = f32(usages * multi);
  if (item.enchant === 'crystal') usages = Math.min(f32(usages / 2), 30);
  if (isTippedDart(item.kind)) {
    // TippedDart.durabilityPerUse: no rounding before its own.
    usages = Math.round(f32(MAX_DURABILITY / f32(MAX_DURABILITY / usages)));
    return usages >= 100 ? 0 : f32(MAX_DURABILITY / usages + 0.001);
  }
  if (usages >= 100) return 0;
  return f32(MAX_DURABILITY / Math.round(usages) + 0.001);
}

/** MissileWeapon.durabilityLeft. */
export const durabilityLeft = (item: Item): number => item.durability ?? MAX_DURABILITY;

/** MissileWeapon.info's uses left: of the stack's first one, and of a whole one; null when they never wear out. */
export function usesLeft(item: Item, multi = 1): { left: number; max: number } | null {
  const perUse = durabilityPerUse(item, gearLevel(item), multi);
  if (perUse <= 0) return null;
  return { left: Math.ceil(durabilityLeft(item) / perUse), max: Math.ceil(MAX_DURABILITY / perUse) };
}

export interface MissileStats {
  min: number;
  max: number;
  str: number;
  tier: number;
}

/** MissileWeapon.info: augment.damageFactor(min) and (max), STRReq. */
export function missileStats(item: Item, sharp = 0): MissileStats {
  // MissileWeapon.min and max: with the ring of sharpshooting's levels (`sharp`).
  return {
    min: augmentDamage(item, missileMin(item, gearLevel(item) + sharp)),
    max: augmentDamage(item, missileMax(item, gearLevel(item) + sharp)),
    str: missileStr(item),
    tier: itemDef(item.kind).tier!,
  };
}

/** MissileWeapon.isSimilar: the same kind, level and set, so they stack. */
export const sameSet = (a: Item, b: Item): boolean => a.kind === b.kind && a.level === b.level && a.set === b.set;

/**
 * MissileWeapon.merge: a thrown one back on its stack. The durability adds up (a whole one is lost for every hundred
 * missing); a stack of a set never grows past its default quantity, which is then whole again. What is known of
 * either is known of both, and the better enchantment (or the curse) carries over.
 */
export function mergeMissiles(stack: Item, other: Item): void {
  stack.qty += other.qty;
  let durability = durabilityLeft(stack) + durabilityLeft(other) - MAX_DURABILITY;
  while (durability <= 0) {
    stack.qty--;
    durability += MAX_DURABILITY;
  }
  if (stack.qty > defaultQuantity(stack.kind) && stack.set !== undefined && !isDart(stack.kind)) {
    stack.qty = defaultQuantity(stack.kind);
    durability = MAX_DURABILITY;
  }
  if (durability >= MAX_DURABILITY) delete stack.durability;
  else stack.durability = durability;
  if (!other.levelUnknown) delete stack.levelUnknown;
  if (!other.curseUnknown) delete stack.curseUnknown;
  if (other.mastery) stack.mastery = true;
  if (other.hardened) stack.hardened = true;
  const good = (item: Item): boolean => item.enchant !== undefined && !CURSES.has(item.enchant);
  const curse = (item: Item): boolean => item.enchant !== undefined && CURSES.has(item.enchant);
  if (!stack.infused && other.infused && curse(other)) {
    stack.enchant = other.enchant;
    stack.infused = true;
    if (other.cursed) stack.cursed = true;
  } else if (!stack.infused && !good(stack) && good(other)) {
    stack.enchant = other.enchant;
    if (other.cursed) stack.cursed = true;
    else delete stack.cursed;
  } else if (!stack.infused && curse(stack) && !curse(other)) {
    if (other.enchant) stack.enchant = other.enchant;
    else delete stack.enchant;
    if (other.cursed) stack.cursed = true;
    else delete stack.cursed;
  }
}

const CURSES: ReadonlySet<string> = new Set([
  'annoying', 'displacing', 'dazzling', 'explosive', 'friendly', 'polarized', 'pressurized', 'sacrificial', 'wayward', 'wondrous',
]);

/** MissileWeapon.value (and Dart's and TippedDart's): 5×tier a piece, darts and stones half that, tipped darts 7.5 a piece. */
export function missileValue(item: Item): number {
  if (isTippedDart(item.kind)) return Math.round(7.5 * item.qty);
  let price = 5 * itemDef(item.kind).tier! * item.qty;
  if (item.enchant && !CURSES.has(item.enchant)) price = Math.trunc(price * 1.5);
  if (!item.curseUnknown && (item.cursed || (item.enchant !== undefined && CURSES.has(item.enchant)))) price = Math.trunc(price / 2);
  if (!item.levelUnknown && item.level > 0) price *= item.level + 1;
  price = Math.max(1, price);
  return item.kind === 'missile.dart' || item.kind === 'missile.throwingStone' ? Math.round(price / 2) : price;
}

/** The delay a thrown weapon's throw takes (Weapon.delayFactor, before strength): augmented. */
export const missileDelay = (item: Item): number => augmentDelay(item, 1);
