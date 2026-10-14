import { createItem, type Item, itemDef, type ItemKind } from '../../../../items';
import { T } from '../../../terrain';
import { Dungeon } from '../../dungeon';
import { type GenCategory, Generator } from '../../generator';
import type { GenLevel } from '../../genlevel';
import { Random } from '../../random';

/* What several special rooms share: keys, gold, the rewards' tiers, upgrades and curses, mimics. */

/** IronKey(Dungeon.depth). */
export const ironKey = (): Item => ({ ...createItem('key.iron'), depth: Dungeon.depth });
/** CrystalKey(Dungeon.depth). */
export const crystalKey = (): Item => ({ ...createItem('key.crystal'), depth: Dungeon.depth });

/** new Gold().random(): 30-60 coins on the first floor, ten to twenty more each floor down. */
export const randomGold = (): Item => createItem('gold', Random.IntRange(30 + Dungeon.depth * 10, 60 + Dungeon.depth * 20));

/** level.findPrizeItem(TrinketCatalyst.class). SEAM(alchemy): there is no catalyst to find yet. */
export const findCatalyst = (level: GenLevel): Item | null => level.findPrizeItem((item) => item.kind === 'trinket.catalyst');

export const categoryOf = (item: Item): string => itemDef(item.kind).category;

/** Item.cursedKnown = true. */
export function knowCurse(item: Item): void {
  delete item.curseUnknown;
}

/** Item.identify(false): its level, curse and charges known. */
export function identify(item: Item): void {
  delete item.levelUnknown;
  delete item.curseUnknown;
  delete item.chargesUnknown;
}

const pow2 = (n: number): number => {
  let p = 1;
  for (let i = 0; i < n; i++) p *= 2;
  return p;
};

/**
 * Item.upgrade as Weapon and Armor have it: an enchantment or glyph may be lost from +4 up (10, 20,
 * 40, 80, 100% from +4/5/6/7/8), the curse goes, the level rises. Pixel Dungeon's enchantments and
 * glyphs are never curses nor hardened, so those branches of Shattered's never apply here.
 */
export function upgrade(item: Item): Item {
  const category = categoryOf(item);
  if (category === 'weapon' || category === 'missile') {
    if (item.enchant !== undefined && item.level >= 4 && Random.Float(10) < pow2(item.level - 4)) delete item.enchant;
    item.cursed = false;
  } else if (category === 'armor') {
    // SEAM(talents): runic transference would move the start of the losses up.
    if (item.glyph !== undefined && item.level >= 4 && Random.Float(10) < pow2(item.level - 4)) delete item.glyph;
    item.cursed = false;
  }
  item.level++;
  return item;
}

/**
 * Weapon.Enchantment.randomCurse / Armor.Glyph.randomCurse: drawn always (so the level comes out
 * the same), but SEAM(gear): Pixel Dungeon has no curse enchantments or glyphs to put on, so a
 * cursed item is only marked cursed.
 */
export function drawWeaponCurse(): void {
  Random.Int(10);
}
export function drawArmorCurse(): void {
  Random.Int(8);
}

/** Generator.floorSetTierProbs: the tiers of gear, by set of five floors. */
const FLOOR_SET_TIER_PROBS: number[][] = [
  [0, 75, 20, 4, 1],
  [0, 25, 50, 20, 5],
  [0, 0, 40, 50, 10],
  [0, 0, 20, 40, 40],
  [0, 0, 0, 20, 80],
];

const tierFor = (floorSet: number): number => {
  const set = Math.max(0, Math.min(floorSet, FLOOR_SET_TIER_PROBS.length - 1));
  return Random.chances(FLOOR_SET_TIER_PROBS[set]!) + 1;
};

/** Generator.randomWeapon(floorSet): a melee weapon of a tier the set of floors favours. */
export function randomWeaponOfSet(floorSet: number): Item {
  return Generator.random(`WEP_T${tierFor(floorSet)}` as GenCategory);
}

/** Generator.randomMissile(floorSet). SEAM(gear): Pixel Dungeon's thrown weapons have no tiers yet. */
export function randomMissileOfSet(floorSet: number): Item {
  return Generator.random(`MIS_T${tierFor(floorSet)}` as GenCategory);
}

const ARMOR_BY_TIER: readonly ItemKind[] = ['armor.cloth', 'armor.leather', 'armor.mail', 'armor.scale', 'armor.plate'];

/** Generator.randomArmor(floorSet): armour of a tier the set favours, then Armor.random (SEAM(gear): Pixel Dungeon's roll). */
export function randomArmorOfSet(floorSet: number): Item {
  const tier = tierFor(floorSet);
  const armor = Generator.randomArmor();
  return { ...armor, kind: ARMOR_BY_TIER[tier - 1]! };
}

/**
 * The equipment prize of the pool, sentry and traps rooms: a weapon or armour of the next set of
 * floors, never cursed (a curse enchantment or glyph would be removed: Pixel Dungeon has none), a
 * third of the time upgraded once.
 */
export function uncursedPrize(item: Item): Item {
  item.cursed = false;
  knowCurse(item);
  if (Random.Int(3) === 0) upgrade(item);
  return item;
}

/**
 * Mimic.spawnAt(pos, items): a mimic holding the items and a reward of its own (Mimic.generatePrize).
 * SEAM(mobs): a heap of kind 'mimic' stands for the mimic, as elsewhere in level generation.
 */
export function spawnMimic(level: GenLevel, pos: number, item: Item): void {
  let reward: Item | null = null;
  do {
    switch (Random.Int(5)) {
      case 0:
        reward = randomGold();
        break;
      case 1:
        reward = Generator.randomMissile();
        break;
      case 2:
        reward = Generator.randomArmor();
        break;
      case 3:
        reward = Generator.randomWeapon();
        break;
      case 4:
        reward = Generator.random('RING');
        break;
    }
  } while (!reward || Dungeon.itemBlocked(reward));
  const heap = level.drop(item, pos);
  heap.kind = 'mimic';
  if (level.heaps.get(pos) === heap) heap.items.push(reward);
}

/** Level.plant with nothing to plant (SEAM(plants)): the cell turns to grass as under a plant. */
export function grassUnderPlant(level: GenLevel, pos: number): void {
  if (Dungeon.noHerbalism()) return;
  const t = level.map[pos];
  if (t === T.HIGH_GRASS || t === T.FURROWED_GRASS || t === T.EMPTY || t === T.EMBERS || t === T.EMPTY_DECO) level.set(pos, T.GRASS);
}

/** ExoticCrystals.consumableExoticChance: 0 without the trinket (SEAM(alchemy)). */
export const CONSUMABLE_EXOTIC_CHANCE = 0;

/**
 * Generator.Category.POTION and SCROLL's defaultProbsTotal (both decks' chances added), by the kinds
 * standing for Shattered's classes: how common each is, for ordering rewards rarest last.
 */
export const DEFAULT_PROBS_TOTAL: Readonly<Partial<Record<string, number>>> = {
  'potion.strength': 0, 'potion.healing': 6, 'potion.mindVision': 4, 'potion.frost': 3, 'potion.liquidFlame': 3,
  'potion.toxicGas': 3, 'potion.invisibility': 2, 'potion.levitation': 2, 'potion.paralyticGas': 2, 'potion.purity': 2,
  'potion.experience': 1,
  'scroll.upgrade': 0, 'scroll.identify': 6, 'scroll.removeCurse': 4, 'scroll.mirrorImage': 3, 'scroll.recharging': 3,
  'scroll.teleportation': 3, 'scroll.lullaby': 2, 'scroll.mapping': 2,
  // ScrollOfRage, ScrollOfRetribution and ScrollOfTransmutation, as Pixel Dungeon's challenge, psionic blast and enchantment.
  'scroll.challenge': 2, 'scroll.psionicBlast': 2, 'scroll.terror': 2, 'scroll.enchantment': 1,
};
