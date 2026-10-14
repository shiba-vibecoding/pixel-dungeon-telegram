import { type Item, itemDef } from './items';
import { gearLevel, jround, strReq } from './weapons';

/*
 * Armour as Shattered Pixel Dungeon has it (Armor): five tiers, cloth to
 * plate, absorbing a roll between DRMin and DRMax; the strength it wants
 * falls as it is upgraded; augmented for evasion or for defence by a stone of
 * augmentation. Class armour protects as the armour it was made from (class
 * armour itself is the abilities stream's).
 */

/** Armour's tier: class armour's is the tier of what it was made from. */
export const armorTier = (item: Item): number => itemDef(item.base ?? item.kind).tier!;

/** Armor.Augment: EVASION (+2 evasion and -1 defence a level step), DEFENSE (the other way round). */
function augmentEvasion(item: Item, lvl: number): number {
  if (item.augment === 'evasion') return jround((2 + lvl) * 2);
  if (item.augment === 'defense') return jround((2 + lvl) * -2);
  return 0;
}
function augmentDefense(item: Item, lvl: number): number {
  if (item.augment === 'evasion') return jround((2 + lvl) * -1);
  if (item.augment === 'defense') return jround((2 + lvl) * 1);
  return 0;
}

/** Armor.DRMax(lvl); `noArmor` is the challenge that strips armour of most of its worth (Challenges.NO_ARMOR). */
export function armorDrMax(item: Item, lvl = gearLevel(item), noArmor = false): number {
  const tier = armorTier(item);
  if (noArmor) return 1 + tier + lvl + augmentDefense(item, lvl);
  const max = tier * (2 + lvl) + augmentDefense(item, lvl);
  return lvl > max ? Math.trunc((lvl - max + 1) / 2) : max;
}

/** Armor.DRMin(lvl). */
export function armorDrMin(item: Item, lvl = gearLevel(item), noArmor = false): number {
  if (noArmor) return 0;
  const max = armorDrMax(item, lvl);
  return lvl >= max ? lvl - max : lvl;
}

/** Armor.STRReq(lvl): two less after a potion of mastery. */
export const armorStr = (item: Item, lvl = gearLevel(item)): number => strReq(armorTier(item), lvl) - (item.mastery ? 2 : 0);

/** Armor.evasionFactor's augment part: evasion it adds (or takes away). */
export const armorEvasionBonus = (item: Item): number => augmentEvasion(item, gearLevel(item));

export interface ArmorStats {
  min: number;
  max: number;
  str: number;
  tier: number;
}

/** Armor.info: what it absorbs and the strength it wants (at its level, or what is typical of it at 0). */
export function armorStats(item: Item, noArmor = false): ArmorStats {
  return { min: armorDrMin(item, gearLevel(item), noArmor), max: armorDrMax(item, gearLevel(item), noArmor), str: armorStr(item), tier: armorTier(item) };
}
