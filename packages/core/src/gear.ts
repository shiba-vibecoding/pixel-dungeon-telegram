import { glyphLossStart } from './talents';
import { armorTier } from './armor';
import type { Hero } from './actors';
import type { Ctx } from './floor';
import {
  createItem, isCurseEnchant, isCurseGlyph, type Item, itemDef, type ItemKind, randomArmorCurse, randomEnchantment, randomGlyph,
  randomWeaponCurse,
} from './items';
import { defaultQuantity, isDart, isMissile, MAX_DURABILITY, missileUpgradable, missileValue } from './missiles';
import { deriveSeed, Rng } from './rng';
import type { RunState } from './run';
import { gearLevel } from './weapons';

/*
 * Weapons, armour and thrown weapons among the finds (Generator.randomWeapon,
 * randomArmor, randomMissile; Weapon.random, Armor.random,
 * MissileWeapon.random), what they are worth (value) and how they take an
 * upgrade (Weapon.upgrade, Armor.upgrade, MissileWeapon.upgrade).
 */

/** Generator.floorSetTierProbs: the chance of each tier, by chapter (depth / 5). */
const FLOOR_SET_TIER_PROBS: ReadonlyArray<readonly number[]> = [
  [0, 75, 20, 4, 1],
  [0, 25, 50, 20, 5],
  [0, 0, 40, 50, 10],
  [0, 0, 20, 40, 40],
  [0, 0, 0, 20, 80],
];

interface Deck {
  kinds: readonly ItemKind[];
  probs: readonly number[];
}

/** Generator.Category.WEP_T1 to WEP_T5 (the mage's staff is the wands stream's, the pickaxe never comes up). */
export const WEAPON_TIERS: readonly Deck[] = [
  { kinds: ['weapon.wornShortsword', 'weapon.dagger', 'weapon.gloves', 'weapon.rapier', 'weapon.cudgel'], probs: [2, 2, 2, 2, 2] },
  {
    kinds: ['weapon.shortsword', 'weapon.handAxe', 'weapon.spear', 'weapon.quarterstaff', 'weapon.dirk', 'weapon.sickle'],
    probs: [2, 2, 2, 2, 2, 2],
  },
  { kinds: ['weapon.sword', 'weapon.mace', 'weapon.scimitar', 'weapon.roundShield', 'weapon.sai', 'weapon.whip'], probs: [2, 2, 2, 2, 2, 2] },
  {
    kinds: ['weapon.longsword', 'weapon.battleAxe', 'weapon.flail', 'weapon.runicBlade', 'weapon.assassinsBlade', 'weapon.crossbow', 'weapon.katana'],
    probs: [2, 2, 2, 2, 2, 2, 2],
  },
  {
    kinds: ['weapon.greatsword', 'weapon.warHammer', 'weapon.glaive', 'weapon.greataxe', 'weapon.greatshield', 'weapon.gauntlet', 'weapon.warScythe'],
    probs: [2, 2, 2, 2, 2, 2, 2],
  },
];

/** Generator.Category.MIS_T1 to MIS_T5 (darts never come up on their own). */
export const MISSILE_TIERS: readonly Deck[] = [
  { kinds: ['missile.throwingStone', 'missile.throwingKnife', 'missile.throwingSpike'], probs: [3, 3, 3] },
  { kinds: ['missile.fishingSpear', 'missile.throwingClub', 'missile.shuriken'], probs: [3, 3, 3] },
  { kinds: ['missile.throwingSpear', 'missile.kunai', 'missile.bolas'], probs: [3, 3, 3] },
  { kinds: ['missile.javelin', 'missile.tomahawk', 'missile.heavyBoomerang'], probs: [3, 3, 3] },
  { kinds: ['missile.trident', 'missile.throwingHammer', 'missile.forceCube'], probs: [3, 3, 3] },
];

/** Generator.Category.ARMOR, picked by tier. */
const ARMORS: readonly ItemKind[] = ['armor.cloth', 'armor.leather', 'armor.mail', 'armor.scale', 'armor.plate'];

/** Sub-stream of a run's seed for its decks (Generator.Category.seed). */
const DECK_STREAM = 41;

const floorSet = (depth: number): readonly number[] =>
  FLOOR_SET_TIER_PROBS[Math.max(0, Math.min(FLOOR_SET_TIER_PROBS.length - 1, Math.trunc(depth / 5)))]!;

/**
 * Generator.random(category) with its deck: each kind is dealt as often as the deck has it, and the deck is dealt
 * anew once it is spent. Dealt from a stream of its own (the category's seed, after the cards already dropped), so
 * that a drop is the same whenever it happens. Without the run's state, as Generator.randomUsingDefaults.
 */
function deal(run: RunState | undefined, rng: Rng, name: string, deck: Deck): ItemKind {
  if (!run) return deck.kinds[rng.chances(deck.probs)]!;
  const decks = (run.decks ??= {});
  const drops = (run.deckDrops ??= {});
  let probs = decks[name];
  if (!probs || probs.every((p) => p <= 0)) probs = decks[name] = [...deck.probs];
  const dropped = drops[name] ?? 0;
  const stream = Rng.seeded(deriveSeed(run.seed, DECK_STREAM, [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7), dropped));
  const i = stream.chances(probs);
  probs[i]!--;
  drops[name] = dropped + 1;
  return deck.kinds[i]!;
}

/** Random.pushGenerator(Random.Long()): a stream of its own for what the item's effects come to. */
const subStream = (rng: Rng): Rng => Rng.seeded(deriveSeed(Math.trunc(rng.next() * 0x1000000), Math.trunc(rng.next() * 0x1000000)));

/** Weapon.random and Armor.random: +0 three times in four, +1 in a fifth, +2 in a twentieth. */
function randomLevel(rng: Rng): number {
  let n = 0;
  if (rng.int(4) === 0) {
    n++;
    if (rng.int(5) === 0) n++;
  }
  return n;
}

/**
 * Weapon.random (and MissileWeapon.random): a level, then three in ten cursed (with a curse enchantment) and one in
 * ten enchanted. Seam: ParchmentScrap (a trinket, the alchemy stream's) would scale both chances.
 */
export function randomizeWeapon(item: Item, rng: Rng): Item {
  item.level = randomLevel(rng);
  const effects = subStream(rng);
  const roll = effects.float();
  if (roll < 0.3) {
    item.enchant = randomWeaponCurse(effects);
    item.cursed = true;
  } else if (roll >= 1 - 0.1) {
    item.enchant = randomEnchantment(effects);
  }
  return item;
}

/** Armor.random: a level, then three in ten cursed (with a curse glyph) and fifteen in a hundred inscribed. */
export function randomizeArmor(item: Item, rng: Rng): Item {
  item.level = randomLevel(rng);
  const effects = subStream(rng);
  const roll = effects.float();
  if (roll < 0.3) {
    item.glyph = randomArmorCurse(effects);
    item.cursed = true;
  } else if (roll >= 1 - 0.15) {
    item.glyph = randomGlyph(effects);
  }
  return item;
}

/** As found, a weapon, armour or thrown weapon tells neither its level nor its curse (Item.levelKnown, cursedKnown). */
function asFound(item: Item): Item {
  item.levelUnknown = true;
  item.curseUnknown = true;
  return item;
}

/** Generator.randomWeapon(floorSet): a tier by the chapter, a kind from its deck, and Weapon.random. */
export function randomWeapon(rng: Rng, depth: number, run?: RunState): Item {
  const tier = rng.chances(floorSet(depth));
  const kind = deal(run, rng, `WEP_T${tier + 1}`, WEAPON_TIERS[tier]!);
  return asFound(randomizeWeapon(createItem(kind), rng));
}

/** Generator.randomMissile(floorSet): a set of three, of its own (MissileWeapon.setID). */
export function randomMissile(rng: Rng, depth: number, run?: RunState): Item {
  const tier = rng.chances(floorSet(depth));
  const kind = deal(run, rng, `MIS_T${tier + 1}`, MISSILE_TIERS[tier]!);
  const item = randomizeWeapon(createItem(kind, defaultQuantity(kind)), rng);
  item.set = 1 + rng.int(0x3fffffff);
  return asFound(item);
}

/** Generator.randomArmor(floorSet): a tier by the chapter, and Armor.random. */
export function randomArmor(rng: Rng, depth: number): Item {
  const kind = ARMORS[rng.chances(floorSet(depth))]!;
  return asFound(randomizeArmor(createItem(kind), rng));
}

/** Generator.random(Generator.wepTiers[tier - 1]) and misTiers: a kind of the tier (ShopRoom, ScrollOfTransmutation). */
export function randomOfTier(rng: Rng, tier: number, missile: boolean, run?: RunState): ItemKind {
  const decks = missile ? MISSILE_TIERS : WEAPON_TIERS;
  return deal(run, rng, `${missile ? 'MIS' : 'WEP'}_T${tier}`, decks[Math.max(1, Math.min(5, tier)) - 1]!);
}

/** A thrown weapon set, as a shop sells it or a class starts with it: plain, known, a set of its own. */
export function plainMissiles(kind: ItemKind, qty = defaultQuantity(kind), set?: number): Item {
  const item = createItem(kind, qty);
  if (set !== undefined) item.set = set;
  return item;
}

/* Values (MeleeWeapon.value, Armor.value, MissileWeapon.value) */

const knownCursed = (item: Item, curse: boolean): boolean => !item.curseUnknown && (!!item.cursed || curse);

/** MeleeWeapon.value: 20 a tier, half as much again enchanted (crystal three times that), halved cursed, more upgraded. */
export function weaponValue(item: Item): number {
  let price = 20 * itemDef(item.kind).tier!;
  if (item.enchant && !isCurseEnchant(item.enchant)) {
    price = Math.trunc(price * 1.5);
    if (item.enchant === 'crystal') price *= 3;
  }
  if (knownCursed(item, isCurseEnchant(item.enchant))) price = Math.trunc(price / 2);
  if (!item.levelUnknown && gearLevel(item) > 0) price *= gearLevel(item) + 1;
  return Math.max(1, price);
}

/** Armor.value: 20 a tier, the same way. */
export function armorValue(item: Item): number {
  let price = 20 * armorTier(item);
  if (item.glyph && !isCurseGlyph(item.glyph)) price = Math.trunc(price * 1.5);
  if (knownCursed(item, isCurseGlyph(item.glyph))) price = Math.trunc(price / 2);
  if (!item.levelUnknown && gearLevel(item) > 0) price *= gearLevel(item) + 1;
  return Math.max(1, price);
}

export { missileValue };

/* Upgrades */

/** What an upgrade did to the item's magic, for the reader to hear. */
export type UpgradeLoss = 'enchant' | 'curse' | null;

/**
 * Weapon.upgrade(false) and Armor.upgrade(false), and MissileWeapon.upgrade: a hardened enchantment may soften from
 * +6 on (10/20/40/80/100%), a curse enchantment goes one time in three, any other may be lost from +4 on
 * (10/20/40/80/100%); a crystal one is mended; no longer cursed (a thrown weapon keeps a curse its enchantment still
 * carries); one level more. A thrown set is whole again, as many as a set has, and those of it left about are dust.
 */
export function upgradeGear(ctx: Ctx, hero: Hero, item: Item): UpgradeLoss {
  const { rng } = ctx;
  const level = gearLevel(item);
  const missile = isMissile(item.kind);
  let loss: UpgradeLoss = null;
  const magic = item.enchant ?? item.glyph;
  const curse = item.enchant ? isCurseEnchant(item.enchant) : isCurseGlyph(item.glyph);
  if (magic !== undefined) {
    if (item.hardened) {
      if (level >= 6 && rng.floatMax(10) < 2 ** (level - 6)) delete item.hardened;
    } else if (curse) {
      if (rng.int(3) === 0) {
        delete item.enchant;
        delete item.glyph;
        delete item.infused;
        loss = 'curse';
      }
    } else if (level >= (itemDef(item.kind).category === 'armor' ? glyphLossStart(hero) : 4) && rng.floatMax(10) < 2 ** (level - 4)) {
      // Armor.upgrade: a metamorphosed runic transference raises where armour starts to lose its glyph.
      delete item.enchant;
      delete item.glyph;
      loss = 'enchant';
    }
    if (item.enchant === 'crystal') delete item.crystal;
  }
  const wasCursed = item.cursed;
  delete item.cursed;
  if (missile) {
    delete item.durability;
    item.qty = defaultQuantity(item.kind);
    item.set ??= 1 + rng.int(0x3fffffff);
    // MissileWeapon.UpgradedSetTracker: the set's older copies turn to dust when picked up.
    (hero.upgradedSets ??= {})[item.set] = item.level + 1;
    if (wasCursed && isCurseEnchant(item.enchant)) item.cursed = true;
  }
  item.level++;
  return loss;
}

/** Item.isUpgradable for gear: melee weapons (not the pickaxe), armour (not class armour, see scrolls.ts), thrown weapons but darts. */
export function gearUpgradable(item: Item): boolean {
  const category = itemDef(item.kind).category;
  if (category === 'weapon') return item.kind !== 'weapon.pickaxe';
  if (category === 'armor') return true;
  return isMissile(item.kind) && missileUpgradable(item.kind);
}

/**
 * MissileWeapon.doPickUp: a copy of a thrown set that was upgraded since it was thrown turns to dust as it is picked
 * up (UpgradedSetTracker.pickupValid).
 */
export function outdatedCopy(hero: Hero, item: Item): boolean {
  if (!isMissile(item.kind) || item.set === undefined || isDart(item.kind)) return false;
  const threshold = hero.upgradedSets?.[item.set];
  return threshold !== undefined && item.level < threshold;
}

/** MissileWeapon.repair: up to whole. */
export function repairMissile(item: Item, amount: number): void {
  const durability = Math.min(MAX_DURABILITY, (item.durability ?? MAX_DURABILITY) + amount);
  if (durability >= MAX_DURABILITY) delete item.durability;
  else item.durability = durability;
}
