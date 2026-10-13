import { type Item, itemDef, type ItemKind } from './items';

/*
 * Melee weapons as Shattered Pixel Dungeon has them (MeleeWeapon and every
 * kind of it, Weapon): five tiers, each kind with its own accuracy (ACC),
 * delay (DLY) and reach (RCH) and its own damage formula; the strength they
 * want falls as they are upgraded; augmented for speed or for damage by a
 * stone of augmentation. The Duelist's weapon abilities are the classes
 * stream's (see weaponAbility). The mage's staff is the wands stream's.
 */

const f32 = Math.fround;
/** Java's Math.round on a float. */
export const jround = (x: number): number => Math.floor(f32(x) + 0.5);

/** What a melee weapon kind differs in from the usual (MeleeWeapon). */
interface MeleeDef {
  /** Weapon.ACC, DLY, RCH. */
  acc?: number;
  dly?: number;
  rch?: number;
  /** min(lvl) and max(lvl), when not tier + lvl and 5×(tier+1) + lvl×(tier+1). */
  min?: (tier: number, lvl: number) => number;
  max?: (tier: number, lvl: number) => number;
  /** KindOfWeapon.defenseFactor: armour the weapon adds when parrying with it. */
  defense?: (lvl: number) => number;
  /** Dagger, Dirk, AssassinsBlade: on a surprise attack, damage rolls from this far towards the max. */
  surprise?: number;
  /** Strength wanted as for this many tiers more (Greataxe 1; the pickaxe asks two points more). */
  strTiers?: number;
  strExtra?: number;
}

const four = (tier: number, lvl: number): number => 4 * (tier + 1) + lvl * (tier + 1);
const light = (tier: number, lvl: number): number => jround(2.5 * (tier + 1)) + lvl * jround(0.5 * (tier + 1));

export const MELEE: Readonly<Partial<Record<ItemKind, MeleeDef>>> = {
  // Tier 1
  'weapon.wornShortsword': {},
  'weapon.gloves': { dly: 0.5, max: light },
  'weapon.dagger': { max: four, surprise: 0.75 },
  'weapon.rapier': { max: four, defense: () => 1 },
  'weapon.cudgel': { acc: 1.4, max: four },
  // Tier 2
  'weapon.shortsword': {},
  'weapon.handAxe': { acc: 1.32, max: four },
  'weapon.spear': { dly: 1.5, rch: 2, max: (t, l) => jround(6.67 * (t + 1)) + l * jround(1.33 * (t + 1)) },
  'weapon.quarterstaff': { max: four, defense: () => 2 },
  'weapon.dirk': { max: four, surprise: 0.67 },
  'weapon.sickle': { acc: 0.68, max: (t, l) => jround(6.67 * (t + 1)) + l * (t + 1) },
  // Pickaxe: tier 3 strength with tier 2 damage.
  'weapon.pickaxe': { strExtra: 2 },
  // Tier 3
  'weapon.sword': {},
  'weapon.mace': { acc: 1.28, max: four },
  'weapon.scimitar': { dly: 0.8, max: four },
  // RoundShield: 4 extra defence, plus 1 per level.
  'weapon.roundShield': { max: (t, l) => jround(3 * (t + 1)) + l * (t - 1), defense: (l) => 4 + l },
  'weapon.sai': { dly: 0.5, max: light },
  'weapon.whip': { rch: 3, max: (t, l) => 5 * t + l * t },
  // Tier 4
  'weapon.longsword': {},
  'weapon.battleAxe': { acc: 1.24, max: four },
  'weapon.flail': { acc: 0.8, max: (t, l) => jround(7 * (t + 1)) + l * jround(1.6 * (t + 1)) },
  'weapon.runicBlade': { max: (t, l) => 5 * t + jround(l * (t + 2)) },
  'weapon.assassinsBlade': { max: four, surprise: 0.5 },
  'weapon.crossbow': { max: (t, l) => 4 * (t + 1) + l * t },
  'weapon.katana': { max: four, defense: () => 3 },
  // Tier 5
  'weapon.greatsword': {},
  'weapon.warHammer': { acc: 1.2, max: four },
  'weapon.glaive': { dly: 1.5, rch: 2, max: (t, l) => jround(6.67 * (t + 1)) + l * jround(1.33 * (t + 1)) },
  'weapon.greataxe': { max: (t, l) => 5 * (t + 4) + l * (t + 1), strTiers: 1 },
  // Greatshield: 6 extra defence, plus 2 per level.
  'weapon.greatshield': { max: (t, l) => jround(3 * (t + 1)) + l * (t - 1), defense: (l) => 6 + 2 * l },
  'weapon.gauntlet': { dly: 0.5, max: light },
  'weapon.warScythe': { acc: 0.8, max: (t, l) => jround(6.67 * (t + 1)) + l * (t + 1) },
};

/** Weapon.Augment: SPEED (0.7× damage, 2/3 the delay), DAMAGE (1.5× damage, 5/3 the delay). */
const AUGMENT_DAMAGE = { speed: f32(0.7), damage: f32(1.5) } as const;
const AUGMENT_DELAY = { speed: f32(2 / 3), damage: f32(5 / 3) } as const;

/** Augment.damageFactor(int): rounded. */
export function augmentDamage(item: Item, damage: number): number {
  const factor = item.augment === 'speed' || item.augment === 'damage' ? AUGMENT_DAMAGE[item.augment] : 1;
  return factor === 1 ? damage : jround(damage * factor);
}

/** Augment.delayFactor. */
export function augmentDelay(item: Item, delay: number): number {
  return item.augment === 'speed' || item.augment === 'damage' ? f32(delay * AUGMENT_DELAY[item.augment]) : delay;
}

/** Weapon.STRReq(tier, lvl) (and Armor's): the strength wanted falls by one at +1, +3, +6, +10 and so on. */
export function strReq(tier: number, lvl: number): number {
  const level = Math.max(0, lvl);
  return 8 + Math.round(tier * 2) - Math.trunc((Math.sqrt(8 * level + 1) - 1) / 2);
}

/** Weapon.level and Armor.level: a curse infused adds a level, and one more every six. */
export const gearLevel = (item: Item): number => (item.infused ? item.level + 1 + Math.trunc(item.level / 6) : item.level);

export const isMelee = (kind: ItemKind): boolean => itemDef(kind).category === 'weapon';
const meleeDef = (kind: ItemKind): MeleeDef => MELEE[kind] ?? {};

/** MeleeWeapon.min(lvl) and max(lvl). */
export function meleeMin(item: Item, lvl = gearLevel(item)): number {
  const tier = itemDef(item.kind).tier!;
  return meleeDef(item.kind).min?.(tier, lvl) ?? tier + lvl;
}
export function meleeMax(item: Item, lvl = gearLevel(item)): number {
  const tier = itemDef(item.kind).tier!;
  return meleeDef(item.kind).max?.(tier, lvl) ?? 5 * (tier + 1) + lvl * (tier + 1);
}

/** MeleeWeapon.STRReq(lvl): two less after a potion of mastery. */
export function meleeStr(item: Item, lvl = gearLevel(item)): number {
  const def = meleeDef(item.kind);
  return strReq(itemDef(item.kind).tier! + (def.strTiers ?? 0), lvl) + (def.strExtra ?? 0) - (item.mastery ? 2 : 0);
}

/** Weapon.ACC, DLY, RCH. */
export const weaponAcc = (kind: ItemKind): number => f32(meleeDef(kind).acc ?? 1);
export const weaponDly = (kind: ItemKind): number => f32(meleeDef(kind).dly ?? 1);
export const weaponRch = (kind: ItemKind): number => meleeDef(kind).rch ?? 1;
/** KindOfWeapon.defenseFactor at a level. */
export const weaponDefense = (item: Item, lvl = gearLevel(item)): number => meleeDef(item.kind).defense?.(lvl) ?? 0;
/** The share of the way to the max a surprise blow rolls from (Dagger, Dirk, AssassinsBlade), or 0. */
export const surpriseShare = (kind: ItemKind): number => meleeDef(kind).surprise ?? 0;

export interface WeaponStats {
  min: number;
  max: number;
  str: number;
  accuracy: number;
  delay: number;
  reach: number;
}

/**
 * A melee weapon's numbers as its info shows them (MeleeWeapon.info: augment.damageFactor(min) and (max), STRReq),
 * with its accuracy, delay and reach.
 */
export function weaponStats(item: Item): WeaponStats {
  return {
    min: augmentDamage(item, meleeMin(item)),
    max: augmentDamage(item, meleeMax(item)),
    str: meleeStr(item),
    accuracy: weaponAcc(item.kind),
    delay: augmentDelay(item, weaponDly(item.kind)),
    reach: weaponRch(item.kind),
  };
}

/** The Spirit Bow (SpiritBow): it grows with its bearer, not with upgrades. */
export const bowLevel = (heroLevel: number, item?: Item): number => {
  const level = Math.trunc(heroLevel / 5);
  return item?.infused ? level + 1 + Math.trunc(level / 6) : level;
};
export const bowMin = (heroLevel: number, item?: Item): number =>
  Math.max(0, 1 + Math.trunc(heroLevel / 5) + (item?.infused ? 1 + Math.trunc(heroLevel / 30) : 0));
export const bowMax = (heroLevel: number, item?: Item): number =>
  Math.max(0, 6 + Math.trunc(f32(heroLevel / 2.5)) + (item?.infused ? 2 + Math.trunc(heroLevel / 15) : 0));
/** SpiritBow.STRReq: a tier 1 weapon's, at the bow's level. */
export const bowStr = (heroLevel: number, item?: Item): number => strReq(1, bowLevel(heroLevel, item));

/** Crossbow.dartMin and dartMax: darts shot with a crossbow in hand hit harder. */
export const crossbowDartMin = (crossbow: Item): number => 4 + gearLevel(crossbow);
export const crossbowDartMax = (crossbow: Item): number => 12 + 3 * gearLevel(crossbow);

/**
 * Seam for the classes stream: the Duelist's weapon ability (MeleeWeapon.duelistAbility), its charges
 * (MeleeWeapon.Charger) and targeting. Nothing here uses it yet.
 */
export type WeaponAbility = (kind: ItemKind) => void;
